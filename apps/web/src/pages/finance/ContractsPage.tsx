import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
import { formatDate } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useCanWrite } from '@/hooks/use-permissions';

interface Contract {
  id: string;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  value: number | null;
  currency: string;
  status: string;
  site: { id: string; name: string };
}

interface Site {
  id: string;
  name: string;
}

const statusLabels: Record<string, string> = {
  ACTIVE: 'Ativo',
  EXPIRED: 'Expirado',
  CANCELLED: 'Cancelado',
  DRAFT: 'Rascunho',
};

export function ContractsPage() {
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
    value: '',
    currency: 'BRL',
    status: 'ACTIVE',
    siteId: '',
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canWrite = useCanWrite();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['contracts', page],
    queryFn: () =>
      api.get<{
        success: boolean;
        data: Contract[];
        meta: { page: number; totalPages: number; total: number };
      }>('/api/contracts', { page, limit: 25 }),
  });

  const { data: sitesData } = useQuery({
    queryKey: ['sites'],
    queryFn: () => api.get<{ success: boolean; data: Site[] }>('/api/sites', { limit: 100 }),
  });

  const createContract = useMutation({
    mutationFn: () =>
      api.post('/api/contracts', {
        name: form.name,
        description: form.description || undefined,
        startDate: new Date(form.startDate).toISOString(),
        endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
        value: form.value ? Number(form.value) : null,
        currency: form.currency,
        status: form.status,
        siteId: form.siteId,
      }),
    onSuccess: () => {
      toast({ title: 'Contrato criado' });
      setShowCreate(false);
      setForm({
        name: '',
        description: '',
        startDate: new Date().toISOString().slice(0, 10),
        endDate: '',
        value: '',
        currency: 'BRL',
        status: 'ACTIVE',
        siteId: '',
      });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const contracts = data?.data || [];
  const meta = data?.meta;
  const sites = sitesData?.data || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Contratos</h1>
          <p className="text-sm text-muted-foreground">Contratos e faturamento por site</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          {canWrite && (
            <Button size="sm" className="gap-1" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" />
              Novo Contrato
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left font-medium">Nome</th>
                <th className="p-3 text-left font-medium">Site</th>
                <th className="p-3 text-left font-medium">Status</th>
                <th className="p-3 text-left font-medium">Valor</th>
                <th className="p-3 text-left font-medium">Início</th>
                <th className="p-3 text-left font-medium">Fim</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td colSpan={6} className="p-3"><Skeleton className="h-8" /></td>
                    </tr>
                  ))
                : contracts.length === 0
                  ? (
                    <tr>
                      <td colSpan={6} className="p-12 text-center text-muted-foreground">
                        <FileText className="mx-auto mb-2 h-8 w-8 opacity-50" />
                        Nenhum contrato cadastrado
                      </td>
                    </tr>
                  )
                  : contracts.map((c) => (
                    <tr key={c.id} className="border-b">
                      <td className="p-3 font-medium">{c.name}</td>
                      <td className="p-3 text-xs">{c.site?.name || '—'}</td>
                      <td className="p-3">
                        <Badge variant={c.status === 'ACTIVE' ? 'success' : 'secondary'}>
                          {statusLabels[c.status] || c.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-xs tabular-nums">
                        {c.value != null
                          ? `${c.currency} ${c.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                          : '—'}
                      </td>
                      <td className="p-3 text-xs">{formatDate(c.startDate)}</td>
                      <td className="p-3 text-xs">{c.endDate ? formatDate(c.endDate) : '—'}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between border-t p-3">
            <p className="text-xs text-muted-foreground">
              Página {meta.page} de {meta.totalPages} ({meta.total} contratos)
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

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo Contrato</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              createContract.mutate();
            }}
          >
            <div>
              <label className="text-sm font-medium">Nome *</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="text-sm font-medium">Site *</label>
              <Select value={form.siteId || 'none'} onValueChange={(v) => setForm({ ...form, siteId: v === 'none' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Selecione</SelectItem>
                  {sites.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Início *</label>
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium">Fim</label>
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Valor</label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Status</label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Ativo</SelectItem>
                    <SelectItem value="DRAFT">Rascunho</SelectItem>
                    <SelectItem value="EXPIRED">Expirado</SelectItem>
                    <SelectItem value="CANCELLED">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Descrição</label>
              <textarea
                className="mt-1 flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <Button type="submit" className="w-full" disabled={createContract.isPending || !form.siteId}>
              Criar contrato
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
