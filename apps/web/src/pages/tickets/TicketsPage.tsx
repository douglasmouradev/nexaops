import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, Ticket } from 'lucide-react';
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
import { StatusBadge } from '@/components/ModulePage';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useCanWrite } from '@/hooks/use-permissions';

interface TicketItem {
  id: string;
  number: number;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
  site: { name: string } | null;
  device: { name: string } | null;
  assignee: { name: string } | null;
}

interface Site {
  id: string;
  name: string;
}

const priorityVariant: Record<string, 'critical' | 'warning' | 'info' | 'secondary'> = {
  URGENT: 'critical',
  HIGH: 'warning',
  MEDIUM: 'info',
  LOW: 'secondary',
};

const priorityLabels: Record<string, string> = {
  URGENT: 'Urgente',
  HIGH: 'Alta',
  MEDIUM: 'Média',
  LOW: 'Baixa',
};

export function TicketsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [siteId, setSiteId] = useState('');

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canWrite = useCanWrite();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['tickets', page],
    queryFn: () =>
      api.get<{
        success: boolean;
        data: TicketItem[];
        meta: { page: number; totalPages: number; total: number };
      }>('/api/tickets', { page, limit: 25 }),
  });

  const { data: sitesData } = useQuery({
    queryKey: ['sites'],
    queryFn: () => api.get<{ success: boolean; data: Site[] }>('/api/sites'),
  });

  const createTicket = useMutation({
    mutationFn: (body: { title: string; description?: string; priority: string; siteId?: string }) =>
      api.post<{ success: boolean; data: { id: string } }>('/api/tickets', body),
    onSuccess: (res) => {
      toast({ title: 'Ticket criado' });
      setShowCreate(false);
      setTitle('');
      setDescription('');
      setSiteId('');
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      navigate(`/tickets/${res.data.id}`);
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const tickets = (data?.data || []).filter((t) => {
    if (search && !t.title.toLowerCase().includes(search.toLowerCase()) && !String(t.number).includes(search)) return false;
    if (statusFilter && t.status !== statusFilter) return false;
    if (priorityFilter && t.priority !== priorityFilter) return false;
    return true;
  });

  const meta = data?.meta;
  const sites = sitesData?.data || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tickets</h1>
          <p className="text-sm text-muted-foreground">Fila de chamados e help desk</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          {canWrite && (
            <Button size="sm" className="gap-1" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" />
              Novo Ticket
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Buscar por título ou número..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Select value={statusFilter || 'all'} onValueChange={(v) => setStatusFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="OPEN">Aberto</SelectItem>
            <SelectItem value="PENDING">Pendente</SelectItem>
            <SelectItem value="RESOLVED">Resolvido</SelectItem>
            <SelectItem value="CLOSED">Fechado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter || 'all'} onValueChange={(v) => setPriorityFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Prioridade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="URGENT">Urgente</SelectItem>
            <SelectItem value="HIGH">Alta</SelectItem>
            <SelectItem value="MEDIUM">Média</SelectItem>
            <SelectItem value="LOW">Baixa</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left font-medium">#</th>
                <th className="p-3 text-left font-medium">Título</th>
                <th className="p-3 text-left font-medium">Status</th>
                <th className="p-3 text-left font-medium">Prioridade</th>
                <th className="p-3 text-left font-medium">Site</th>
                <th className="p-3 text-left font-medium">Técnico</th>
                <th className="p-3 text-left font-medium">Criado</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td colSpan={7} className="p-3"><Skeleton className="h-8" /></td>
                    </tr>
                  ))
                : tickets.length === 0
                  ? (
                    <tr>
                      <td colSpan={7} className="p-12 text-center text-muted-foreground">
                        <Ticket className="mx-auto mb-2 h-8 w-8 opacity-50" />
                        Nenhum ticket encontrado
                      </td>
                    </tr>
                  )
                  : tickets.map((ticket) => (
                    <tr key={ticket.id} className="border-b transition-colors hover:bg-muted/30">
                      <td className="p-3 font-mono text-xs">#{ticket.number}</td>
                      <td className="p-3">
                        <button
                          className="font-medium hover:text-primary"
                          onClick={() => navigate(`/tickets/${ticket.id}`)}
                        >
                          {ticket.title}
                        </button>
                      </td>
                      <td className="p-3"><StatusBadge status={ticket.status} /></td>
                      <td className="p-3">
                        <Badge variant={priorityVariant[ticket.priority] || 'secondary'}>
                          {priorityLabels[ticket.priority] || ticket.priority}
                        </Badge>
                      </td>
                      <td className="p-3 text-xs">{ticket.site?.name || '—'}</td>
                      <td className="p-3 text-xs">{ticket.assignee?.name || '—'}</td>
                      <td className="p-3 text-xs text-muted-foreground">{formatRelative(ticket.createdAt)}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between border-t p-3">
            <p className="text-xs text-muted-foreground">
              Página {meta.page} de {meta.totalPages} ({meta.total} tickets)
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Ticket</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              createTicket.mutate({
                title,
                description: description || undefined,
                priority,
                siteId: siteId || undefined,
              });
            }}
          >
            <div>
              <label className="text-sm font-medium">Título</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div>
              <label className="text-sm font-medium">Descrição</label>
              <textarea
                className="mt-1 flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Prioridade</label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Baixa</SelectItem>
                    <SelectItem value="MEDIUM">Média</SelectItem>
                    <SelectItem value="HIGH">Alta</SelectItem>
                    <SelectItem value="URGENT">Urgente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Site</label>
                <Select value={siteId || 'none'} onValueChange={(v) => setSiteId(v === 'none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {sites.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={createTicket.isPending}>
              Criar Ticket
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
