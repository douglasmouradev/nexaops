import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowLeft, Monitor, Cpu, HardDrive, MemoryStick, Network, Wifi, WifiOff, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { formatDate, formatRelative } from '@/lib/utils';
import { useCanWrite } from '@/hooks/use-permissions';
import { useToast } from '@/hooks/use-toast';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { chartTooltipStyle } from '@/components/charts/ChartTooltip';

export function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canWrite = useCanWrite();
  const [deleting, setDeleting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['device', id],
    queryFn: () => api.get<{ success: boolean; data: Record<string, unknown> }>(`/api/devices/${id}`),
    enabled: !!id,
  });

  const device = data?.data;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    );
  }

  if (!device) {
    return <p>Dispositivo não encontrado</p>;
  }

  const hw = device.hardwareInfo as Record<string, unknown> | null;
  const metrics = (device.resourceMetrics as { cpuPercent: number; ramPercent: number; diskPercent: number; recordedAt: string }[]) || [];
  const interfaces = (device.networkInterfaces as {
    id: string; name: string; mac: string | null; ipv4: string | null; ipv6: string | null;
    netmask: string | null; cidr: string | null; internal: boolean; isUp: boolean;
    speedMbps: number | null; gateway: string | null; updatedAt: string;
  }[]) || [];
  const chartData = metrics.map((m) => ({
    time: new Date(m.recordedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    CPU: Math.round(m.cpuPercent),
    RAM: Math.round(m.ramPercent),
    Disco: Math.round(m.diskPercent),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/devices')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{device.name as string}</h1>
            <Badge variant={device.status === 'ONLINE' ? 'success' : 'destructive'}>
              {device.status as string}
            </Badge>
            {(device.rebootPending as boolean) && (
              <Badge variant="warning" className="ml-2">Reinício pendente</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {(device.osVersion as string) || 'SO desconhecido'} · Última conexão: {formatRelative(device.lastSeenAt as string)}
            {hw?.serialNumber ? ` · S/N: ${hw.serialNumber}` : ''}
          </p>
        </div>
        {canWrite && (
          <Button
            variant="destructive"
            size="sm"
            className="gap-1 shrink-0"
            disabled={deleting}
            onClick={() => {
              const name = device.name as string;
              if (!window.confirm(`Excluir o dispositivo "${name}"?\n\nEle sera removido do painel.`)) {
                return;
              }
              setDeleting(true);
              api
                .delete(`/api/devices/${id}`)
                .then(() => {
                  toast({ title: 'Dispositivo excluído', description: name });
                  queryClient.invalidateQueries({ queryKey: ['devices'] });
                  navigate('/devices');
                })
                .catch((err) =>
                  toast({
                    title: 'Erro ao excluir',
                    description: (err as Error).message,
                    variant: 'destructive',
                  })
                )
                .finally(() => setDeleting(false));
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deleting ? 'Excluindo…' : 'Excluir'}
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: 'CPU', value: hw?.cpuModel, icon: Cpu },
          { label: 'RAM', value: hw ? `${hw.ramTotalGb} GB` : '—', icon: MemoryStick },
          { label: 'Disco', value: hw ? `${hw.diskFreeGb}/${hw.diskTotalGb} GB livre` : '—', icon: HardDrive },
          { label: 'Modelo', value: hw ? `${hw.manufacturer} ${hw.model}` : '—', icon: Monitor },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <item.icon className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="text-sm font-medium">{item.value as string || '—'}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Uso de Recursos (24h)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="time" className="text-xs" />
                <YAxis domain={[0, 100]} className="text-xs" />
                <Tooltip
                  contentStyle={chartTooltipStyle.contentStyle}
                  labelStyle={chartTooltipStyle.labelStyle}
                  itemStyle={chartTooltipStyle.itemStyle}
                />
                <Legend />
                <Line type="monotone" dataKey="CPU" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="RAM" stroke="hsl(var(--warning))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Disco" stroke="hsl(var(--info))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="glass-card lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Network className="h-4 w-4" />
              Interfaces de Rede
            </CardTitle>
          </CardHeader>
          <CardContent>
            {interfaces.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Nenhuma interface reportada pelo agente ainda.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-enterprise w-full">
                  <thead>
                    <tr>
                      <th>Interface</th>
                      <th>IPv4</th>
                      <th>MAC</th>
                      <th>Gateway</th>
                      <th>Velocidade</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {interfaces.map((iface) => (
                      <tr key={iface.id} className={iface.internal ? 'opacity-50' : ''}>
                        <td className="font-medium">
                          {iface.name}
                          {iface.internal && (
                            <span className="ml-2 text-[10px] text-muted-foreground">(loopback)</span>
                          )}
                        </td>
                        <td>
                          {iface.ipv4 || '—'}
                          {iface.cidr && <span className="text-muted-foreground"> /{iface.cidr}</span>}
                        </td>
                        <td className="font-mono text-xs">{iface.mac || '—'}</td>
                        <td className="font-mono text-xs">{iface.gateway || '—'}</td>
                        <td>{iface.speedMbps ? `${iface.speedMbps} Mbps` : '—'}</td>
                        <td>
                          {iface.isUp ? (
                            <Badge variant="success" className="gap-1">
                              <Wifi className="h-3 w-3" /> Ativa
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="gap-1">
                              <WifiOff className="h-3 w-3" /> Inativa
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Software Instalado</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {((device.softwareItems as { name: string; version: string; publisher: string }[]) || []).map((sw, i) => (
                <div key={i} className="flex justify-between rounded border p-2 text-sm">
                  <span>{sw.name}</span>
                  <span className="text-muted-foreground">{sw.version}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Alertas Recentes</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {((device.alerts as { id: string; title: string; severity: string; createdAt: string }[]) || []).map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded border p-2 text-sm">
                  <span>{a.title}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={a.severity === 'CRITICAL' ? 'critical' : 'warning'}>{a.severity}</Badge>
                    <span className="text-xs text-muted-foreground">{formatDate(a.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
