import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { useSocket } from '@/hooks/use-socket';
import { useCanWrite } from '@/hooks/use-permissions';

interface Alert {
  id: string;
  title: string;
  message: string | null;
  severity: string;
  status: string;
  createdAt: string;
  device: { id: string; name: string } | null;
}

export function AlertsPage() {
  const [severityFilter, setSeverityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showRuleDialog, setShowRuleDialog] = useState(false);
  const [ruleForm, setRuleForm] = useState({
    name: '',
    metric: 'CPU',
    threshold: 90,
    durationMinutes: 5,
    severity: 'WARNING',
    enabled: true,
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canWrite = useCanWrite();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['alerts', severityFilter, statusFilter, page],
    queryFn: () =>
      api.get<{
        success: boolean;
        data: Alert[];
        meta: { page: number; totalPages: number; total: number };
      }>('/api/alerts', {
        severity: severityFilter || undefined,
        status: statusFilter || undefined,
        page,
        limit: 25,
      }),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/api/alerts/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      toast({ title: 'Status atualizado' });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const createRule = useMutation({
    mutationFn: (body: typeof ruleForm) => api.post('/api/alerts/rules', body),
    onSuccess: () => {
      toast({ title: 'Regra de alerta criada' });
      setShowRuleDialog(false);
      setRuleForm({ name: '', metric: 'CPU', threshold: 90, durationMinutes: 5, severity: 'WARNING', enabled: true });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const onNewAlert = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['alerts'] });
    toast({ title: 'Novo alerta recebido', description: 'A lista foi atualizada' });
  }, [queryClient, toast]);

  useSocket({ onNewAlert });

  const alerts = data?.data || [];
  const meta = data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Alertas</h1>
          <p className="text-sm text-muted-foreground">Central de monitoramento e alertas</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          {canWrite && (
            <Button size="sm" className="gap-1" onClick={() => setShowRuleDialog(true)}>
              <Plus className="h-4 w-4" />
              Nova Regra
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select
          value={severityFilter || 'all'}
          onValueChange={(v) => {
            setSeverityFilter(v === 'all' ? '' : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Severidade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="CRITICAL">Crítica</SelectItem>
            <SelectItem value="WARNING">Aviso</SelectItem>
            <SelectItem value="INFO">Info</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={statusFilter || 'all'}
          onValueChange={(v) => {
            setStatusFilter(v === 'all' ? '' : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="NEW">Novo</SelectItem>
            <SelectItem value="ACKNOWLEDGED">Reconhecido</SelectItem>
            <SelectItem value="RESOLVED">Resolvido</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left font-medium">Alerta</th>
                <th className="p-3 text-left font-medium">Severidade</th>
                <th className="p-3 text-left font-medium">Status</th>
                <th className="p-3 text-left font-medium">Dispositivo</th>
                <th className="p-3 text-left font-medium">Quando</th>
                <th className="p-3 text-left font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td colSpan={6} className="p-3"><Skeleton className="h-8" /></td>
                    </tr>
                  ))
                : alerts.length === 0
                  ? (
                    <tr>
                      <td colSpan={6} className="p-12 text-center text-muted-foreground">
                        <Bell className="mx-auto mb-2 h-8 w-8 opacity-50" />
                        Nenhum alerta encontrado
                      </td>
                    </tr>
                  )
                  : alerts.map((alert) => (
                    <tr key={alert.id} className="border-b transition-colors hover:bg-muted/30">
                      <td className="p-3">
                        <p className="font-medium">{alert.title}</p>
                        {alert.message && <p className="text-xs text-muted-foreground">{alert.message}</p>}
                      </td>
                      <td className="p-3"><StatusBadge status={alert.severity} /></td>
                      <td className="p-3"><StatusBadge status={alert.status} /></td>
                      <td className="p-3 text-xs">{alert.device?.name || '—'}</td>
                      <td className="p-3 text-xs text-muted-foreground">{formatRelative(alert.createdAt)}</td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          {canWrite && alert.status === 'NEW' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateStatus.mutate({ id: alert.id, status: 'ACKNOWLEDGED' })}
                            >
                              Reconhecer
                            </Button>
                          )}
                          {canWrite && alert.status !== 'RESOLVED' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateStatus.mutate({ id: alert.id, status: 'RESOLVED' })}
                            >
                              Resolver
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between border-t p-3">
            <p className="text-xs text-muted-foreground">
              Página {meta.page} de {meta.totalPages} ({meta.total} alertas)
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

      <Dialog open={showRuleDialog} onOpenChange={setShowRuleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Regra de Alerta</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              createRule.mutate(ruleForm);
            }}
          >
            <div>
              <label className="text-sm font-medium">Nome *</label>
              <Input value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Métrica</label>
                <Select value={ruleForm.metric} onValueChange={(v) => setRuleForm({ ...ruleForm, metric: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CPU">CPU</SelectItem>
                    <SelectItem value="RAM">RAM</SelectItem>
                    <SelectItem value="DISK">Disco</SelectItem>
                    <SelectItem value="SERVICE">Serviço</SelectItem>
                    <SelectItem value="OFFLINE">Offline</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Severidade</label>
                <Select value={ruleForm.severity} onValueChange={(v) => setRuleForm({ ...ruleForm, severity: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CRITICAL">Crítica</SelectItem>
                    <SelectItem value="WARNING">Aviso</SelectItem>
                    <SelectItem value="INFO">Info</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Limite (%)</label>
                <Input
                  type="number"
                  value={ruleForm.threshold}
                  onChange={(e) => setRuleForm({ ...ruleForm, threshold: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Duração (min)</label>
                <Input
                  type="number"
                  value={ruleForm.durationMinutes}
                  onChange={(e) => setRuleForm({ ...ruleForm, durationMinutes: Number(e.target.value) })}
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={createRule.isPending}>
              Criar regra
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
