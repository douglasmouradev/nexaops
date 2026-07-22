import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Play, RefreshCw, Terminal, History, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
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
import { formatDate, formatRelative } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useCanWrite, useIsAdmin } from '@/hooks/use-permissions';
import { cn } from '@/lib/utils';

interface Script {
  id: string;
  name: string;
  description: string | null;
  language: string;
  category: string | null;
  requiresApproval?: boolean;
}

interface Device {
  id: string;
  name: string;
}

interface Execution {
  id: string;
  status: string;
  awaitingApproval?: boolean;
  startedAt: string | null;
  completedAt: string | null;
  output: string | null;
  script: { name: string };
  device: { name: string };
}

export function ScriptsPage() {
  const [tab, setTab] = useState<'library' | 'history'>('library');
  const [showCreate, setShowCreate] = useState(false);
  const [showRun, setShowRun] = useState(false);
  const [selectedScript, setSelectedScript] = useState<Script | null>(null);
  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({
    name: '',
    description: '',
    language: 'POWERSHELL',
    content: '',
    category: '',
    requiresApproval: false,
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canWrite = useCanWrite();
  const isAdmin = useIsAdmin();

  const { data: scriptsData, isLoading, refetch } = useQuery({
    queryKey: ['scripts'],
    queryFn: () => api.get<{ success: boolean; data: Script[] }>('/api/scripts'),
  });

  const { data: executionsData, isLoading: loadingExec, refetch: refetchExec } = useQuery({
    queryKey: ['script-executions'],
    queryFn: () => api.get<{ success: boolean; data: Execution[] }>('/api/scripts/executions'),
    enabled: tab === 'history',
  });

  const { data: devicesData } = useQuery({
    queryKey: ['devices-list'],
    queryFn: () => api.get<{ success: boolean; data: Device[] }>('/api/devices', { limit: 100 }),
    enabled: showRun,
  });

  const createScript = useMutation({
    mutationFn: (body: typeof form) => api.post('/api/scripts', body),
    onSuccess: () => {
      toast({ title: 'Script criado' });
      setShowCreate(false);
      setForm({
        name: '',
        description: '',
        language: 'POWERSHELL',
        content: '',
        category: '',
        requiresApproval: false,
      });
      queryClient.invalidateQueries({ queryKey: ['scripts'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const runScript = useMutation({
    mutationFn: ({ scriptId, deviceIds }: { scriptId: string; deviceIds: string[] }) =>
      api.post<{ success: boolean; data: { awaitingApproval?: boolean } }>('/api/scripts/run', {
        scriptId,
        deviceIds,
      }),
    onSuccess: (res) => {
      toast({
        title: res.data?.awaitingApproval ? 'Aguardando aprovação de admin' : 'Execução iniciada',
      });
      setShowRun(false);
      setSelectedDevices(new Set());
      setTab('history');
      queryClient.invalidateQueries({ queryKey: ['script-executions'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const approveExecution = useMutation({
    mutationFn: (id: string) => api.post(`/api/scripts/executions/${id}/approve`, {}),
    onSuccess: () => {
      toast({ title: 'Execução aprovada' });
      queryClient.invalidateQueries({ queryKey: ['script-executions'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const scripts = scriptsData?.data || [];
  const executions = executionsData?.data || [];
  const devices = devicesData?.data || [];

  const toggleDevice = (id: string) => {
    setSelectedDevices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Biblioteca de Scripts</h1>
          <p className="text-sm text-muted-foreground">Scripts de automação e histórico de execuções</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => (tab === 'history' ? refetchExec() : refetch())}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          {canWrite && (
            <Button size="sm" className="gap-1" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" />
              Novo Script
            </Button>
          )}
        </div>
      </div>

      <div className="flex gap-1 rounded-lg border p-1 w-fit">
        <button
          className={cn('flex items-center gap-1 rounded-md px-3 py-1.5 text-sm', tab === 'library' && 'bg-muted font-medium')}
          onClick={() => setTab('library')}
        >
          <Terminal className="h-3.5 w-3.5" /> Biblioteca
        </button>
        <button
          className={cn('flex items-center gap-1 rounded-md px-3 py-1.5 text-sm', tab === 'history' && 'bg-muted font-medium')}
          onClick={() => setTab('history')}
        >
          <History className="h-3.5 w-3.5" /> Histórico
        </button>
      </div>

      {tab === 'library' ? (
        <div className="rounded-lg border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left font-medium">Nome</th>
                  <th className="p-3 text-left font-medium">Linguagem</th>
                  <th className="p-3 text-left font-medium">Categoria</th>
                  <th className="p-3 text-left font-medium">Controle</th>
                  <th className="p-3 text-left font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} className="border-b">
                        <td colSpan={5} className="p-3"><Skeleton className="h-8" /></td>
                      </tr>
                    ))
                  : scripts.length === 0
                    ? (
                      <tr>
                        <td colSpan={5} className="p-12 text-center text-muted-foreground">
                          <Terminal className="mx-auto mb-2 h-8 w-8 opacity-50" />
                          Nenhum script cadastrado
                        </td>
                      </tr>
                    )
                    : scripts.map((script) => (
                      <tr key={script.id} className="border-b transition-colors hover:bg-muted/30">
                        <td className="p-3">
                          <p className="font-medium">{script.name}</p>
                          {script.description && <p className="text-xs text-muted-foreground">{script.description}</p>}
                        </td>
                        <td className="p-3">
                          <Badge variant="secondary">{script.language}</Badge>
                        </td>
                        <td className="p-3 text-xs">{script.category || '—'}</td>
                        <td className="p-3">
                          {script.requiresApproval ? (
                            <Badge variant="warning">Requer aprovação</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Direto</span>
                          )}
                        </td>
                        <td className="p-3">
                          {canWrite && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1"
                              onClick={() => {
                                setSelectedScript(script);
                                setShowRun(true);
                              }}
                            >
                              <Play className="h-3 w-3" /> Executar
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left font-medium">Script</th>
                  <th className="p-3 text-left font-medium">Dispositivo</th>
                  <th className="p-3 text-left font-medium">Status</th>
                  <th className="p-3 text-left font-medium">Iniciado</th>
                  <th className="p-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loadingExec
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} className="border-b">
                        <td colSpan={5} className="p-3"><Skeleton className="h-8" /></td>
                      </tr>
                    ))
                  : executions.length === 0
                    ? (
                      <tr>
                        <td colSpan={5} className="p-12 text-center text-muted-foreground">
                          Nenhuma execução registrada
                        </td>
                      </tr>
                    )
                    : executions.map((exec) => (
                      <tr key={exec.id} className="border-b transition-colors hover:bg-muted/30">
                        <td className="p-3 font-medium">{exec.script.name}</td>
                        <td className="p-3 text-xs">{exec.device.name}</td>
                        <td className="p-3">
                          {exec.awaitingApproval ? (
                            <Badge variant="warning">Aguardando aprovação</Badge>
                          ) : (
                            <StatusBadge status={exec.status} />
                          )}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {exec.startedAt ? formatRelative(exec.startedAt) : formatDate(exec.completedAt)}
                        </td>
                        <td className="p-3 text-right">
                          {exec.awaitingApproval && isAdmin && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              disabled={approveExecution.isPending}
                              onClick={() => approveExecution.mutate(exec.id)}
                            >
                              <CheckCircle className="h-3 w-3" />
                              Aprovar
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo Script</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              createScript.mutate(form);
            }}
          >
            <div>
              <label className="text-sm font-medium">Nome *</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Linguagem</label>
                <Select value={form.language} onValueChange={(v) => setForm({ ...form, language: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="POWERSHELL">PowerShell</SelectItem>
                    <SelectItem value="BASH">Bash</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Categoria</label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Conteúdo *</label>
              <textarea
                className="mt-1 flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                required
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.requiresApproval}
                onCheckedChange={(v) => setForm({ ...form, requiresApproval: v === true })}
              />
              Requer aprovação de admin (dual-control)
            </label>
            <Button type="submit" className="w-full" disabled={createScript.isPending}>
              Criar script
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showRun} onOpenChange={setShowRun}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Executar: {selectedScript?.name}</DialogTitle>
          </DialogHeader>
          {selectedScript?.requiresApproval && (
            <p className="text-sm text-muted-foreground">
              Este script requer aprovação de um administrador antes de rodar.
            </p>
          )}
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {devices.map((d) => (
              <label key={d.id} className="flex items-center gap-2 rounded border p-2 text-sm">
                <Checkbox
                  checked={selectedDevices.has(d.id)}
                  onCheckedChange={() => toggleDevice(d.id)}
                />
                {d.name}
              </label>
            ))}
          </div>
          <Button
            className="w-full gap-1"
            disabled={selectedDevices.size === 0 || runScript.isPending}
            onClick={() => {
              if (selectedScript) {
                runScript.mutate({
                  scriptId: selectedScript.id,
                  deviceIds: Array.from(selectedDevices),
                });
              }
            }}
          >
            <Play className="h-4 w-4" />
            Executar em {selectedDevices.size} dispositivo(s)
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
