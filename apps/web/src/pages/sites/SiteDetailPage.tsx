import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye, Key, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

interface Device {
  id: string;
  name: string;
  status: string;
  type: string;
}

interface VaultEntry {
  id: string;
  label: string;
  username: string | null;
  url: string | null;
}

interface SiteDetail {
  id: string;
  name: string;
  city: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  devices: Device[];
  passwordVaults: VaultEntry[];
}

export function SiteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [showVault, setShowVault] = useState(false);
  const [vaultForm, setVaultForm] = useState({ label: '', username: '', password: '', url: '', notes: '' });
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['site', id],
    queryFn: () => api.get<{ success: boolean; data: SiteDetail }>(`/api/sites/${id}`),
    enabled: !!id,
  });

  const addVault = useMutation({
    mutationFn: (body: typeof vaultForm) => api.post(`/api/sites/${id}/vault`, body),
    onSuccess: () => {
      toast({ title: 'Credencial adicionada ao cofre' });
      setShowVault(false);
      setVaultForm({ label: '', username: '', password: '', url: '', notes: '' });
      queryClient.invalidateQueries({ queryKey: ['site', id] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const revealVault = useMutation({
    mutationFn: (vaultId: string) =>
      api.post<{ success: boolean; data: { password: string; label: string } }>(
        `/api/sites/${id}/vault/${vaultId}/reveal`
      ),
    onSuccess: (res, vaultId) => {
      const password = res.data.password;
      setRevealed((prev) => ({ ...prev, [vaultId]: password }));
      navigator.clipboard.writeText(password).catch(() => undefined);
      toast({ title: 'Senha revelada', description: 'Copiada para a área de transferência' });
      setTimeout(() => {
        setRevealed((prev) => {
          const next = { ...prev };
          delete next[vaultId];
          return next;
        });
      }, 8000);
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const site = data?.data;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (!site) {
    return <p className="text-muted-foreground">Site não encontrado</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/sites')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{site.name}</h1>
          <p className="text-sm text-muted-foreground">
            {[site.city, site.phone, site.email].filter(Boolean).join(' · ') || 'Sem informações de contato'}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Monitor className="h-4 w-4" />
              Dispositivos ({site.devices.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {site.devices.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum dispositivo vinculado</p>
            ) : (
              <div className="space-y-2">
                {site.devices.map((d) => (
                  <div key={d.id} className="flex items-center justify-between rounded border p-2 text-sm">
                    <button
                      className="font-medium hover:text-primary"
                      onClick={() => navigate(`/devices/${d.id}`)}
                    >
                      {d.name}
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{d.type}</span>
                      <Badge variant={d.status === 'ONLINE' ? 'success' : 'destructive'}>{d.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Key className="h-4 w-4" />
              Cofre de Senhas ({site.passwordVaults.length})
            </CardTitle>
            <Button size="sm" onClick={() => setShowVault(true)}>Adicionar</Button>
          </CardHeader>
          <CardContent>
            {site.passwordVaults.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma credencial cadastrada</p>
            ) : (
              <div className="space-y-2">
                {site.passwordVaults.map((v) => (
                  <div key={v.id} className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">{v.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {v.username || '—'}{v.url ? ` · ${v.url}` : ''}
                      </p>
                      {revealed[v.id] && (
                        <code className="mt-1 block break-all text-xs text-primary">{revealed[v.id]}</code>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 shrink-0"
                      disabled={revealVault.isPending}
                      onClick={() => revealVault.mutate(v.id)}
                    >
                      <Eye className="h-3 w-3" />
                      Revelar
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {site.address && (
        <Card>
          <CardHeader><CardTitle className="text-base">Endereço</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm">{site.address}</p>
            {site.notes && <p className="mt-2 text-sm text-muted-foreground">{site.notes}</p>}
          </CardContent>
        </Card>
      )}

      <Dialog open={showVault} onOpenChange={setShowVault}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar ao Cofre</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              addVault.mutate(vaultForm);
            }}
          >
            <div>
              <label className="text-sm font-medium">Rótulo *</label>
              <Input value={vaultForm.label} onChange={(e) => setVaultForm({ ...vaultForm, label: e.target.value })} required />
            </div>
            <div>
              <label className="text-sm font-medium">Usuário</label>
              <Input value={vaultForm.username} onChange={(e) => setVaultForm({ ...vaultForm, username: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium">Senha *</label>
              <Input type="password" value={vaultForm.password} onChange={(e) => setVaultForm({ ...vaultForm, password: e.target.value })} required />
            </div>
            <div>
              <label className="text-sm font-medium">URL</label>
              <Input value={vaultForm.url} onChange={(e) => setVaultForm({ ...vaultForm, url: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium">Notas</label>
              <textarea
                className="mt-1 flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={vaultForm.notes}
                onChange={(e) => setVaultForm({ ...vaultForm, notes: e.target.value })}
              />
            </div>
            <Button type="submit" className="w-full" disabled={addVault.isPending}>
              Salvar credencial
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
