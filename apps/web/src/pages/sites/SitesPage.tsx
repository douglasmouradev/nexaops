import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, Building2, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useCanWrite } from '@/hooks/use-permissions';

interface Site {
  id: string;
  name: string;
  city: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  state: string | null;
  zipCode: string | null;
  notes: string | null;
  _count: { devices: number; tickets: number };
}

const emptyForm = {
  name: '',
  address: '',
  city: '',
  state: '',
  zipCode: '',
  phone: '',
  email: '',
  notes: '',
};

export function SitesPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canWrite = useCanWrite();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['sites', page],
    queryFn: () =>
      api.get<{
        success: boolean;
        data: Site[];
        meta: { page: number; totalPages: number; total: number };
      }>('/api/sites', { page, limit: 25 }),
  });

  const saveSite = useMutation({
    mutationFn: (body: typeof emptyForm & { id?: string }) => {
      const { id, ...data } = body;
      if (id) return api.patch(`/api/sites/${id}`, data);
      return api.post('/api/sites', data);
    },
    onSuccess: () => {
      toast({ title: editingId ? 'Site atualizado' : 'Site criado' });
      setShowDialog(false);
      setEditingId(null);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ['sites'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const deleteSite = useMutation({
    mutationFn: (id: string) => api.delete(`/api/sites/${id}`),
    onSuccess: () => {
      toast({ title: 'Site removido' });
      queryClient.invalidateQueries({ queryKey: ['sites'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const sites = (data?.data || []).filter((s) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.city?.toLowerCase().includes(search.toLowerCase())
  );
  const meta = data?.meta;

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowDialog(true);
  };

  const openEdit = (site: Site) => {
    setEditingId(site.id);
    setForm({
      name: site.name,
      address: site.address || '',
      city: site.city || '',
      state: site.state || '',
      zipCode: site.zipCode || '',
      phone: site.phone || '',
      email: site.email || '',
      notes: site.notes || '',
    });
    setShowDialog(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sites</h1>
          <p className="text-sm text-muted-foreground">Clientes e organizações gerenciadas</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          {canWrite && (
            <Button size="sm" className="gap-1" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Novo Site
            </Button>
          )}
        </div>
      </div>

      <Input
        placeholder="Buscar sites..."
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        className="max-w-sm"
      />

      <div className="rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left font-medium">Nome</th>
                <th className="p-3 text-left font-medium">Cidade</th>
                <th className="p-3 text-left font-medium">Telefone</th>
                <th className="p-3 text-left font-medium">E-mail</th>
                <th className="p-3 text-left font-medium">Dispositivos</th>
                <th className="p-3 text-left font-medium">Tickets</th>
                <th className="w-10 p-3"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td colSpan={7} className="p-3"><Skeleton className="h-8" /></td>
                    </tr>
                  ))
                : sites.length === 0
                  ? (
                    <tr>
                      <td colSpan={7} className="p-12 text-center text-muted-foreground">
                        <Building2 className="mx-auto mb-2 h-8 w-8 opacity-50" />
                        Nenhum site cadastrado
                      </td>
                    </tr>
                  )
                  : sites.map((site) => (
                    <tr key={site.id} className="border-b transition-colors hover:bg-muted/30">
                      <td className="p-3">
                        <button
                          className="font-medium hover:text-primary"
                          onClick={() => navigate(`/sites/${site.id}`)}
                        >
                          {site.name}
                        </button>
                      </td>
                      <td className="p-3 text-xs">{site.city || '—'}</td>
                      <td className="p-3 text-xs">{site.phone || '—'}</td>
                      <td className="p-3 text-xs">{site.email || '—'}</td>
                      <td className="p-3 text-xs">{site._count.devices}</td>
                      <td className="p-3 text-xs">{site._count.tickets}</td>
                      <td className="p-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">···</Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => navigate(`/sites/${site.id}`)}>
                              Ver detalhes
                            </DropdownMenuItem>
                            {canWrite && (
                              <>
                                <DropdownMenuItem onClick={() => openEdit(site)}>
                                  <Pencil className="mr-2 h-3 w-3" /> Editar
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => {
                                    if (confirm('Remover este site?')) deleteSite.mutate(site.id);
                                  }}
                                >
                                  <Trash2 className="mr-2 h-3 w-3" /> Excluir
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between border-t p-3">
            <p className="text-xs text-muted-foreground">
              Página {meta.page} de {meta.totalPages} ({meta.total} sites)
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= meta.totalPages}
                onClick={() => setPage(page + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Site' : 'Novo Site'}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveSite.mutate({ ...form, id: editingId || undefined });
            }}
          >
            <div>
              <label className="text-sm font-medium">Nome *</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Cidade</label>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">Estado</label>
                <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Endereço</label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Telefone</label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">E-mail</label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Observações</label>
              <textarea
                className="mt-1 flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <Button type="submit" className="w-full" disabled={saveSite.isPending}>
              {editingId ? 'Salvar alterações' : 'Criar site'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
