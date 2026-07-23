import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Monitor,
  Download,
  Play,
  Zap,
  Package,
  Gauge,
  MoreHorizontal,
  ExternalLink,
  Star,
  Sparkles,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useCanWrite } from '@/hooks/use-permissions';
import { AgentInstallModal } from '@/components/devices/AgentInstallModal';

interface Device {
  id: string;
  name: string;
  lastUserLogin: string | null;
  lastSeenAt: string | null;
  status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  type: string;
  folder: string | null;
  site: { id: string; name: string } | null;
  alerts: { id: string; severity: string }[];
  patchesAvailable: number;
  rebootPending: boolean;
  isFavorite: boolean;
}

interface Site {
  id: string;
  name: string;
}

interface ScriptOption {
  id: string;
  name: string;
}

interface ThresholdOption {
  id: string;
  name: string;
}

const typeLabels: Record<string, string> = {
  PC: 'PC',
  SERVER: 'Servidor',
  MOBILE: 'Mobile',
  NETWORK: 'Rede',
};

const severityVariant: Record<string, 'critical' | 'warning' | 'info'> = {
  CRITICAL: 'critical',
  WARNING: 'warning',
  INFO: 'info',
};

export function DevicesPage() {
  const [search, setSearch] = useState('');
  const [nlFilter, setNlFilter] = useState('');
  const [useNlFilter, setUseNlFilter] = useState(false);
  const [siteFilter, setSiteFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [page, setPage] = useState(1);
  const [bulkDialog, setBulkDialog] = useState<'RUN_SCRIPT' | 'ASSIGN_THRESHOLD' | 'DELETE' | null>(null);
  const [selectedScriptId, setSelectedScriptId] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [aiParsePending, setAiParsePending] = useState(false);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canWrite = useCanWrite();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const clearSelection = () => setSelectedIds([]);
  const toggleSelection = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const selectAllVisible = (ids: string[]) => setSelectedIds([...ids]);
  const isSelected = (id: string) => selectedIds.includes(id);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['devices', search, nlFilter, siteFilter, statusFilter, typeFilter, favoritesOnly, page],
    queryFn: () =>
      api.get<{ success: boolean; data: Device[]; meta: { page: number; totalPages: number; total: number } }>(
        '/api/devices',
        {
          search: search || undefined,
          nlFilter: useNlFilter && nlFilter ? nlFilter : undefined,
          siteId: siteFilter || undefined,
          status: statusFilter || undefined,
          type: typeFilter || undefined,
          favorites: favoritesOnly || undefined,
          page,
          limit: 25,
        }
      ),
  });

  const { data: sitesData } = useQuery({
    queryKey: ['sites'],
    queryFn: () => api.get<{ success: boolean; data: Site[] }>('/api/sites'),
  });

  const { data: scriptsData } = useQuery({
    queryKey: ['scripts-options'],
    queryFn: () => api.get<{ success: boolean; data: ScriptOption[] }>('/api/scripts', { limit: 100 }),
    enabled: bulkDialog === 'RUN_SCRIPT',
  });

  const { data: thresholdsData } = useQuery({
    queryKey: ['thresholds-options'],
    queryFn: () =>
      api.get<{ success: boolean; data: ThresholdOption[] }>('/api/admin/threshold-profiles'),
    enabled: bulkDialog === 'ASSIGN_THRESHOLD',
  });

  const remoteSession = useMutation({
    mutationFn: (deviceId: string) =>
      api.post<{
        success: boolean;
        data: { id: string; connectionUrl?: string; connectionCommand?: string; provider?: string };
      }>(`/api/devices/${deviceId}/remote-session`),
    onSuccess: (res) => {
      const s = res.data;
      toast({
        title: 'Sessão remota iniciada',
        description: s.connectionCommand || 'Abrindo viewer…',
      });
      // Sempre viewer in-app — nunca abrir /api/... no browser (falta JWT → "Token não fornecido")
      const provider = (s.provider || 'native').toLowerCase();
      const url = s.connectionUrl || '';
      const isApiUrl = url.includes('/api/');
      const isExternalGateway =
        !isApiUrl &&
        ['guacamole', 'meshcentral', 'novnc', 'url'].includes(provider) &&
        /^https?:\/\//i.test(url) &&
        !url.includes('/remote-sessions');

      if (isExternalGateway) {
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
      navigate(`/remote-sessions?session=${encodeURIComponent(s.id)}`);
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const bulkAction = useMutation({
    mutationFn: async (body: { action: string; payload?: Record<string, string> }) => {
      if (body.action === 'DELETE') {
        // DELETE individual — funciona mesmo se o schema bulk antigo nao tiver DELETE
        const ids = [...selectedIds];
        for (const id of ids) {
          await api.delete(`/api/devices/${id}`);
        }
        return { action: 'DELETE', count: ids.length };
      }
      return api.post('/api/devices/bulk-action', {
        deviceIds: selectedIds,
        action: body.action,
        payload: body.payload,
      });
    },
    onSuccess: (_res, vars) => {
      toast({
        title: vars.action === 'DELETE' ? 'Dispositivos apagados' : 'Ação em lote executada',
      });
      clearSelection();
      setBulkDialog(null);
      setSelectedScriptId('');
      setSelectedProfileId('');
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const devices = data?.data || [];
  const meta = data?.meta;
  const sites = sitesData?.data || [];
  const scripts = scriptsData?.data || [];
  const thresholds = thresholdsData?.data || [];
  const allSelected = devices.length > 0 && devices.every((d) => isSelected(d.id));

  if (!isLoading && devices.length === 0 && !search && !siteFilter && !statusFilter) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="mb-6 flex h-32 w-32 items-center justify-center rounded-full bg-muted">
          <Monitor className="h-16 w-16 text-muted-foreground/50" />
        </div>
        <h2 className="mb-2 text-xl font-semibold">Nenhum dispositivo encontrado</h2>
        <p className="mb-6 max-w-md text-center text-muted-foreground">
          Instale o agente NexaOps nos seus dispositivos para começar o monitoramento em tempo real.
        </p>
        <Button onClick={() => setShowAgentModal(true)} className="gap-2">
          <Download className="h-4 w-4" />
          Instalar um Agente
        </Button>
        <AgentInstallModal open={showAgentModal} onOpenChange={setShowAgentModal} sites={sites} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dispositivos</h1>
          <p className="text-sm text-muted-foreground">
            {meta?.total ?? 0} dispositivos gerenciados
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="sm" className="gap-1" onClick={() => setShowAgentModal(true)} disabled={!canWrite}>
            <Download className="h-4 w-4" />
            Instalar Agente
          </Button>
        </div>
      </div>

      {canWrite && selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-accent/50 p-3">
          <span className="text-sm font-medium">{selectedIds.length} selecionado(s)</span>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="gap-1"
              disabled={bulkAction.isPending}
              onClick={() => {
                const n = selectedIds.length;
                if (
                  !window.confirm(
                    `Apagar ${n} dispositivo(s) selecionado(s) do painel?\n\nEsta ação não pode ser desfeita.`
                  )
                ) {
                  return;
                }
                bulkAction.mutate({ action: 'DELETE' });
              }}
            >
              <Trash2 className="h-3 w-3" />
              {bulkAction.isPending ? 'Apagando…' : 'Apagar selecionados'}
            </Button>
            <Button variant="outline" size="sm" className="gap-1" onClick={() => setBulkDialog('RUN_SCRIPT')}>
              <Play className="h-3 w-3" /> Executar script
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => bulkAction.mutate({ action: 'ASSIGN_AUTOMATION' })}
            >
              <Zap className="h-3 w-3" /> Atribuir automação
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => bulkAction.mutate({ action: 'INSTALL_SOFTWARE' })}
            >
              <Package className="h-3 w-3" /> Instalar software
            </Button>
            <Button variant="outline" size="sm" className="gap-1" onClick={() => setBulkDialog('ASSIGN_THRESHOLD')}>
              <Gauge className="h-3 w-3" /> Atribuir perfil de limite
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.preventDefault();
                clearSelection();
              }}
            >
              Desmarcar
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Input
            placeholder="Buscar dispositivos..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>

        <div className="relative flex-1 min-w-[250px] max-w-md">
          <Sparkles className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
          <Input
            placeholder="Descreva o que você deseja filtrar..."
            value={nlFilter}
            onChange={(e) => setNlFilter(e.target.value)}
            className="pl-9"
            disabled={!useNlFilter}
          />
        </div>
        <Button
          variant={useNlFilter ? 'default' : 'outline'}
          size="sm"
          onClick={() => { setUseNlFilter(!useNlFilter); setPage(1); }}
        >
          Perguntar
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          disabled={!nlFilter.trim() || aiParsePending}
          onClick={async () => {
            try {
              setAiParsePending(true);
              const res = await api.post<{
                success: boolean;
                data: {
                  filter: {
                    status?: string;
                    type?: string;
                    search?: string;
                    hasAlerts?: boolean;
                    hasPatches?: boolean;
                    rebootPending?: boolean;
                  };
                };
              }>('/api/ai/parse-filter', { query: nlFilter });
              const f = res.data.filter;
              if (f.status) setStatusFilter(f.status);
              if (f.type) setTypeFilter(f.type);
              if (f.search) setSearch(f.search);
              setUseNlFilter(true);
              setNlFilter(`@ai ${nlFilter.replace(/^@ai\s*/i, '')}`);
              setPage(1);
              toast({ title: 'Filtro IA aplicado' });
            } catch (err) {
              toast({ title: 'Erro na IA', description: (err as Error).message, variant: 'destructive' });
            } finally {
              setAiParsePending(false);
            }
          }}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {aiParsePending ? 'IA...' : 'IA'}
        </Button>

        <Select value={siteFilter} onValueChange={(v) => { setSiteFilter(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Site" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os Sites</SelectItem>
            {sites.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="ONLINE">Online</SelectItem>
            <SelectItem value="OFFLINE">Offline</SelectItem>
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="PC">PC</SelectItem>
            <SelectItem value="SERVER">Servidor</SelectItem>
            <SelectItem value="MOBILE">Mobile</SelectItem>
            <SelectItem value="NETWORK">Rede</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant={favoritesOnly ? 'default' : 'outline'}
          size="sm"
          onClick={() => { setFavoritesOnly(!favoritesOnly); setPage(1); }}
          className="gap-1"
        >
          <Star className="h-3 w-3" /> Favoritos
        </Button>
      </div>

      <div className="rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="w-10 p-3">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={() => {
                      if (allSelected) clearSelection();
                      else selectAllVisible(devices.map((d) => d.id));
                    }}
                  />
                </th>
                <th className="p-3 text-left font-medium">Dispositivo</th>
                <th className="p-3 text-left font-medium">Último login</th>
                <th className="p-3 text-left font-medium">Disponibilidade</th>
                <th className="p-3 text-left font-medium">Tipo</th>
                <th className="p-3 text-left font-medium">Site</th>
                <th className="p-3 text-left font-medium">Pasta</th>
                <th className="p-3 text-left font-medium">Alertas</th>
                <th className="p-3 text-left font-medium">Patches</th>
                <th className="p-3 text-left font-medium">Reinício</th>
                <th className="p-3 text-left font-medium">Remoto</th>
                <th className="w-10 p-3"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td colSpan={12} className="p-3"><Skeleton className="h-8" /></td>
                    </tr>
                  ))
                : devices.map((device) => (
                    <tr
                      key={device.id}
                      className="border-b transition-colors hover:bg-muted/30"
                    >
                      <td className="p-3">
                        <Checkbox
                          checked={isSelected(device.id)}
                          onCheckedChange={() => toggleSelection(device.id)}
                        />
                      </td>
                      <td className="p-3">
                        <button
                          className="flex items-center gap-2 font-medium hover:text-primary"
                          onClick={() => navigate(`/devices/${device.id}`)}
                        >
                          {device.isFavorite && <Star className="h-3 w-3 fill-warning text-warning" />}
                          {device.name}
                        </button>
                      </td>
                      <td className="p-3">
                        <div>
                          <p className="text-xs">{device.lastUserLogin || '—'}</p>
                          <p className="text-xs text-muted-foreground">{formatRelative(device.lastSeenAt)}</p>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              device.status === 'ONLINE' ? 'bg-success' : device.status === 'OFFLINE' ? 'bg-destructive' : 'bg-muted-foreground'
                            }`}
                          />
                          <span className="text-xs">{device.status === 'ONLINE' ? 'Online' : device.status === 'OFFLINE' ? 'Offline' : 'Desconhecido'}</span>
                        </div>
                      </td>
                      <td className="p-3 text-xs">{typeLabels[device.type] || device.type}</td>
                      <td className="p-3 text-xs">{device.site?.name || '—'}</td>
                      <td className="p-3 text-xs">{device.folder || '—'}</td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          {device.alerts.slice(0, 3).map((a) => (
                            <Badge key={a.id} variant={severityVariant[a.severity] || 'info'} className="text-[10px]">
                              {a.severity === 'CRITICAL' ? '!' : a.severity === 'WARNING' ? '⚠' : 'i'}
                            </Badge>
                          ))}
                          {device.alerts.length > 3 && (
                            <Badge variant="secondary" className="text-[10px]">+{device.alerts.length - 3}</Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        {device.patchesAvailable > 0 ? (
                          <Badge variant="warning">{device.patchesAvailable}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="p-3">
                        {device.rebootPending && <Badge variant="warning">Pendente</Badge>}
                      </td>
                      <td className="p-3">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => remoteSession.mutate(device.id)}
                          disabled={device.status !== 'ONLINE'}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                      <td className="p-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => navigate(`/devices/${device.id}`)}>
                              Ver detalhes
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => remoteSession.mutate(device.id)}>
                              Acesso remoto
                            </DropdownMenuItem>
                            {canWrite && (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => {
                                  if (
                                    !window.confirm(
                                      `Excluir o dispositivo "${device.name}"? Esta ação não pode ser desfeita.`
                                    )
                                  ) {
                                    return;
                                  }
                                  api
                                    .delete(`/api/devices/${device.id}`)
                                    .then(() => {
                                      toast({ title: 'Dispositivo excluído' });
                                      queryClient.invalidateQueries({ queryKey: ['devices'] });
                                    })
                                    .catch((err) =>
                                      toast({
                                        title: 'Erro',
                                        description: (err as Error).message,
                                        variant: 'destructive',
                                      })
                                    );
                                }}
                              >
                                Excluir
                              </DropdownMenuItem>
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
              Página {meta.page} de {meta.totalPages} ({meta.total} dispositivos)
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Anterior
              </Button>
              <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>
                Próxima
              </Button>
            </div>
          </div>
        )}
      </div>

      <AgentInstallModal open={showAgentModal} onOpenChange={setShowAgentModal} sites={sites} />

      <Dialog open={bulkDialog === 'RUN_SCRIPT'} onOpenChange={(o) => !o && setBulkDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Executar script em {selectedIds.length} dispositivo(s)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={selectedScriptId} onValueChange={setSelectedScriptId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um script" />
              </SelectTrigger>
              <SelectContent>
                {scripts.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="w-full"
              disabled={!selectedScriptId || bulkAction.isPending}
              onClick={() =>
                bulkAction.mutate({ action: 'RUN_SCRIPT', payload: { scriptId: selectedScriptId } })
              }
            >
              Executar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDialog === 'ASSIGN_THRESHOLD'} onOpenChange={(o) => !o && setBulkDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atribuir perfil de limite</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um perfil" />
              </SelectTrigger>
              <SelectContent>
                {thresholds.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="w-full"
              disabled={!selectedProfileId || bulkAction.isPending}
              onClick={() =>
                bulkAction.mutate({
                  action: 'ASSIGN_THRESHOLD',
                  payload: { thresholdProfileId: selectedProfileId },
                })
              }
            >
              Atribuir
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDialog === 'DELETE'} onOpenChange={(o) => !o && setBulkDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir {selectedIds.length} dispositivo(s)</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Os dispositivos selecionados serão removidos do painel. O agente no PC deixa de
            aparecer até ser reinstalado. Esta ação não pode ser desfeita.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setBulkDialog(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={bulkAction.isPending}
              onClick={() => bulkAction.mutate({ action: 'DELETE' })}
            >
              {bulkAction.isPending ? 'Excluindo…' : 'Excluir'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
