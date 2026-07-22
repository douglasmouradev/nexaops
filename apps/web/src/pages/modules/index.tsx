export { TicketsPage } from '@/pages/tickets/TicketsPage';
export { SitesPage } from '@/pages/sites/SitesPage';
export { AlertsPage } from '@/pages/alerts/AlertsPage';
export { PatchesPage } from '@/pages/patches/PatchesPage';
export { KnowledgePage } from '@/pages/knowledge/KnowledgePage';
export { NetworkPage } from '@/pages/network/NetworkPage';
export { AdminOrganizationPage } from '@/pages/admin/AdminOrganizationPage';
export { AdminUsersPage } from '@/pages/admin/AdminUsersPage';
export { AdminThresholdsPage } from '@/pages/admin/AdminThresholdsPage';
export { AdminAuditPage } from '@/pages/admin/AdminAuditPage';
export { AiCenterPage } from '@/pages/ai/AiCenterPage';
export { ReferralsPage } from '@/pages/referrals/ReferralsPage';
export { ReportPage } from '@/pages/reports/ReportPage';
export { StatusBadge } from '@/components/ModulePage';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Package, Plus, Link2 } from 'lucide-react';
import { ModulePage } from '@/components/ModulePage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useCanWrite } from '@/hooks/use-permissions';

interface Integration {
  id: string;
  name: string;
  slug: string;
  connected: boolean;
}

export function AssetsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    type: 'HARDWARE',
    manufacturer: '',
    model: '',
    serialNumber: '',
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canWrite = useCanWrite();

  const createAsset = useMutation({
    mutationFn: () =>
      api.post('/api/assets', {
        name: form.name,
        type: form.type,
        manufacturer: form.manufacturer || undefined,
        model: form.model || undefined,
        serialNumber: form.serialNumber || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Ativo criado' });
      setShowCreate(false);
      setForm({ name: '', type: 'HARDWARE', manufacturer: '', model: '', serialNumber: '' });
      queryClient.invalidateQueries({ queryKey: ['/api/assets'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  return (
    <>
      <ModulePage
        title="Inventário de Ativos"
        description="Hardware, software e licenças unificados"
        endpoint="/api/assets"
        columns={[
          { key: 'name', label: 'Ativo' },
          { key: 'type', label: 'Tipo' },
          { key: 'manufacturer', label: 'Fabricante' },
          { key: 'model', label: 'Modelo' },
          { key: 'serialNumber', label: 'Nº Série' },
        ]}
        actions={
          canWrite ? (
            <Button size="sm" className="gap-1" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" />
              Novo Ativo
            </Button>
          ) : undefined
        }
      />

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Novo Ativo
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              createAsset.mutate();
            }}
          >
            <div>
              <label className="text-sm font-medium">Nome *</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="text-sm font-medium">Tipo</label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="HARDWARE">Hardware</SelectItem>
                  <SelectItem value="SOFTWARE">Software</SelectItem>
                  <SelectItem value="LICENSE">Licença</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Fabricante</label>
                <Input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">Modelo</label>
                <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Nº de série</label>
              <Input value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} />
            </div>
            <Button type="submit" className="w-full" disabled={createAsset.isPending}>
              Criar ativo
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AppCenterPage() {
  const { toast } = useToast();
  const oauthBySlug: Record<string, string> = {
    microsoft: 'microsoft',
    'microsoft-365': 'microsoft',
    slack: 'slack',
  };

  const connectOAuth = async (provider: string) => {
    try {
      const res = await api.get<{ success: boolean; data: { url: string } }>(
        `/api/oauth/${provider}/start`,
        { format: 'json' }
      );
      if (res.data?.url) {
        window.location.href = res.data.url;
      } else {
        throw new Error('URL de autorização não retornada');
      }
    } catch (err) {
      toast({
        title: 'Não foi possível conectar',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  return (
    <ModulePage
      title="Centro de Aplicativos"
      description="Marketplace de integrações"
      endpoint="/api/integrations"
      columns={[
        { key: 'name', label: 'Integração' },
        {
          key: 'connected',
          label: 'Status',
          render: (i) => (
            <Badge variant={i.connected ? 'success' : 'secondary'}>
              {i.connected ? 'Conectado' : 'Desconectado'}
            </Badge>
          ),
        },
        {
          key: 'slug',
          label: 'Ação',
          render: (i) => {
            const item = i as unknown as Integration;
            const provider = oauthBySlug[item.slug];
            if (!provider) {
              return <span className="text-xs text-muted-foreground">—</span>;
            }
            if (item.connected) {
              return <Badge variant="success">Ativo</Badge>;
            }
            return (
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => connectOAuth(provider)}
              >
                <Link2 className="h-3 w-3" />
                Conectar
              </Button>
            );
          },
        },
      ]}
    />
  );
}
