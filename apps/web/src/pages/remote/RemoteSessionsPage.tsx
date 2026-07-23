import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { MonitorSmartphone, ExternalLink, Square, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, formatRelative } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RemoteViewer } from '@/components/remote/RemoteViewer';
import { useCanWrite } from '@/hooks/use-permissions';
import { useToast } from '@/hooks/use-toast';

interface RemoteSession {
  id: string;
  status: string;
  provider: string;
  connectionUrl: string | null;
  connectionCommand: string | null;
  auditEvents?: { at: string; event: string; detail?: string }[];
  startedAt: string;
  endedAt: string | null;
  connectedAt: string | null;
  device: { id: string; name: string; hostname: string | null; status: string };
  user: { id: string; name: string; email: string };
}

interface PaginationMeta {
  page: number;
  totalPages: number;
  total: number;
}

const statusVariant: Record<string, 'success' | 'warning' | 'secondary' | 'destructive'> = {
  CONNECTED: 'success',
  PENDING: 'warning',
  DISCONNECTED: 'secondary',
  FAILED: 'destructive',
};

/** Iframe so para gateways externos — native/rdp usam stream Socket.io. */
function canEmbed(url: string | null, provider?: string): boolean {
  const p = (provider || '').toLowerCase();
  if (p === 'native' || p === 'rdp') return false;
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.pathname.includes('/remote-sessions')) return false;
    if (u.pathname.includes('/rdp')) return false;
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function RemoteSessionsPage() {
  const [page, setPage] = useState(1);
  const [viewer, setViewer] = useState<RemoteSession | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['remote-sessions', page],
    queryFn: () =>
      api.get<{ success: boolean; data: RemoteSession[]; meta: PaginationMeta }>(
        '/api/remote-sessions',
        { page, limit: 20 }
      ),
  });

  const sessionFromQuery = searchParams.get('session');

  const { data: sessionDetail } = useQuery({
    queryKey: ['remote-session', sessionFromQuery],
    queryFn: () =>
      api.get<{ success: boolean; data: RemoteSession }>(`/api/remote-sessions/${sessionFromQuery}`),
    enabled: !!sessionFromQuery,
    refetchInterval: (q) => {
      const st = q.state.data?.data?.status;
      return st === 'PENDING' ? 2000 : false;
    },
  });

  useEffect(() => {
    if (sessionDetail?.data) {
      setViewer(sessionDetail.data);
    }
  }, [sessionDetail?.data]);

  const endSession = useMutation({
    mutationFn: (id: string) => api.post(`/api/remote-sessions/${id}/end`),
    onSuccess: () => {
      toast({ title: 'Sessão encerrada' });
      queryClient.invalidateQueries({ queryKey: ['remote-sessions'] });
      setViewer(null);
      if (searchParams.get('session')) {
        searchParams.delete('session');
        setSearchParams(searchParams, { replace: true });
      }
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const sessions = data?.data || [];
  const meta = data?.meta;

  const closeViewer = () => {
    setViewer(null);
    if (searchParams.get('session')) {
      searchParams.delete('session');
      setSearchParams(searchParams, { replace: true });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Acesso remoto"
        description="Viewer nativo (stream) e histórico de sessões"
        icon={MonitorSmartphone}
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        }
      />

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base">Sessões recentes</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma sessão ainda. Inicie em Dispositivos → Acesso remoto.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="p-3 font-medium">Dispositivo</th>
                    <th className="p-3 font-medium">Técnico</th>
                    <th className="p-3 font-medium">Provider</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Início</th>
                    <th className="p-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} className="border-b border-border/50">
                      <td className="p-3 font-medium">{s.device.name}</td>
                      <td className="p-3">{s.user.name}</td>
                      <td className="p-3 uppercase text-xs">{s.provider}</td>
                      <td className="p-3">
                        <Badge variant={statusVariant[s.status] || 'secondary'}>{s.status}</Badge>
                      </td>
                      <td className="p-3 text-muted-foreground" title={formatDate(s.startedAt)}>
                        {formatRelative(s.startedAt)}
                      </td>
                      <td className="p-3 text-right space-x-2">
                        {(s.status === 'CONNECTED' || s.status === 'PENDING' || canEmbed(s.connectionUrl, s.provider)) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setViewer(s);
                              setSearchParams({ session: s.id }, { replace: true });
                            }}
                          >
                            Viewer
                          </Button>
                        )}
                        {s.connectionUrl && canEmbed(s.connectionUrl, s.provider) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => window.open(s.connectionUrl!, '_blank')}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canWrite && s.status !== 'DISCONNECTED' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={endSession.isPending}
                            onClick={() => endSession.mutate(s.id)}
                          >
                            <Square className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {meta && meta.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Página {meta.page} de {meta.totalPages}
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
        </CardContent>
      </Card>

      <Dialog open={!!viewer} onOpenChange={(o) => !o && closeViewer()}>
        <DialogContent className="max-w-5xl h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <span>Viewer — {viewer?.device.name}</span>
              {viewer?.status === 'PENDING' && (
                <Badge variant="warning">Aguardando agent…</Badge>
              )}
              {canWrite && viewer && viewer.status !== 'DISCONNECTED' && (
                <Button
                  size="sm"
                  variant="destructive"
                  className="ml-auto"
                  disabled={endSession.isPending}
                  onClick={() => endSession.mutate(viewer.id)}
                >
                  Encerrar
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>
          {viewer && (
            <RemoteViewer
              sessionId={viewer.id}
              connectionUrl={viewer.connectionUrl}
              canEmbedUrl={canEmbed(viewer.connectionUrl, viewer.provider)}
            />
          )}
          {viewer?.auditEvents && viewer.auditEvents.length > 0 && (
            <div className="mt-3 max-h-32 overflow-y-auto rounded-md border p-2 text-xs text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">Auditoria</p>
              {viewer.auditEvents.map((e, i) => (
                <div key={i}>
                  {new Date(e.at).toLocaleString()} — {e.event}
                  {e.detail ? `: ${e.detail}` : ''}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
