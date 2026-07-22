import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Radar, Plus, RefreshCw, ArrowUpCircle } from 'lucide-react';
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
import { formatDate } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useCanWrite } from '@/hooks/use-permissions';

interface DiscoveredDevice {
  id: string;
  ipAddress: string;
  hostname: string | null;
  deviceType: string;
  promoted: boolean;
}

interface NetworkScan {
  id: string;
  name: string;
  subnet: string;
  status: string;
  devicesFound: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  discoveredDevices: DiscoveredDevice[];
}

interface Site {
  id: string;
  name: string;
}

export function NetworkPage() {
  const [showScan, setShowScan] = useState(false);
  const [expandedScan, setExpandedScan] = useState<string | null>(null);
  const [scanForm, setScanForm] = useState({ name: '', subnet: '', siteId: '' });

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canWrite = useCanWrite();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['network-scans'],
    queryFn: () => api.get<{ success: boolean; data: NetworkScan[] }>('/api/network/scans'),
    refetchInterval: (query) => {
      const scans = query.state.data?.data || [];
      return scans.some((s) => s.status === 'RUNNING') ? 3000 : false;
    },
  });

  const { data: sitesData } = useQuery({
    queryKey: ['sites'],
    queryFn: () => api.get<{ success: boolean; data: Site[] }>('/api/sites'),
    enabled: showScan,
  });

  const startScan = useMutation({
    mutationFn: (body: { name?: string; subnet: string; siteId?: string }) =>
      api.post('/api/network/scans', body),
    onSuccess: () => {
      toast({ title: 'Varredura iniciada' });
      setShowScan(false);
      setScanForm({ name: '', subnet: '', siteId: '' });
      queryClient.invalidateQueries({ queryKey: ['network-scans'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const promoteDevice = useMutation({
    mutationFn: ({ device, siteId }: { device: DiscoveredDevice; siteId?: string }) =>
      api.post(`/api/network/discovered/${device.id}/promote`, siteId ? { siteId } : {}),
    onSuccess: () => {
      toast({ title: 'Dispositivo promovido para gerenciado' });
      queryClient.invalidateQueries({ queryKey: ['network-scans'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const scans = data?.data || [];
  const sites = sitesData?.data || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Descoberta de Rede</h1>
          <p className="text-sm text-muted-foreground">Varredura e dispositivos não gerenciados</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          {canWrite && (
            <Button size="sm" className="gap-1" onClick={() => setShowScan(true)}>
              <Plus className="h-4 w-4" />
              Nova Varredura
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : scans.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-muted-foreground">
          <Radar className="mb-2 h-10 w-10 opacity-50" />
          Nenhuma varredura realizada
        </div>
      ) : (
        <div className="space-y-3">
          {scans.map((scan) => (
            <div key={scan.id} className="rounded-lg border">
              <button
                className="flex w-full items-center justify-between p-4 text-left hover:bg-muted/30"
                onClick={() => setExpandedScan(expandedScan === scan.id ? null : scan.id)}
              >
                <div>
                  <p className="font-medium">{scan.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {scan.subnet} · {formatDate(scan.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm">{scan.devicesFound} encontrados</span>
                  <StatusBadge status={scan.status} />
                </div>
              </button>

              {expandedScan === scan.id && scan.discoveredDevices.length > 0 && (
                <div className="border-t">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="p-3 text-left font-medium">IP</th>
                        <th className="p-3 text-left font-medium">Hostname</th>
                        <th className="p-3 text-left font-medium">Tipo</th>
                        <th className="p-3 text-left font-medium">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scan.discoveredDevices.map((device) => (
                        <tr key={device.id} className="border-b">
                          <td className="p-3 font-mono text-xs">{device.ipAddress}</td>
                          <td className="p-3 text-xs">{device.hostname || '—'}</td>
                          <td className="p-3">
                            <Badge variant="secondary">{device.deviceType}</Badge>
                          </td>
                          <td className="p-3">
                            {device.promoted ? (
                              <Badge variant="success">Gerenciado</Badge>
                            ) : canWrite ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1"
                                onClick={() => promoteDevice.mutate({ device })}
                                disabled={promoteDevice.isPending}
                              >
                                <ArrowUpCircle className="h-3 w-3" />
                                Promover
                              </Button>
                            ) : (
                              <Badge variant="secondary">Não gerenciado</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {expandedScan === scan.id && scan.discoveredDevices.length === 0 && scan.status === 'RUNNING' && (
                <div className="border-t p-4 text-center text-sm text-muted-foreground">
                  Varredura em andamento...
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={showScan} onOpenChange={setShowScan}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Iniciar Varredura</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              startScan.mutate({
                name: scanForm.name || undefined,
                subnet: scanForm.subnet,
                siteId: scanForm.siteId || undefined,
              });
            }}
          >
            <div>
              <label className="text-sm font-medium">Nome (opcional)</label>
              <Input
                placeholder="Ex: Scan escritório"
                value={scanForm.name}
                onChange={(e) => setScanForm({ ...scanForm, name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Sub-rede *</label>
              <Input
                placeholder="192.168.1.0/24"
                value={scanForm.subnet}
                onChange={(e) => setScanForm({ ...scanForm, subnet: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium">Site (opcional)</label>
              <Select
                value={scanForm.siteId || 'none'}
                onValueChange={(v) => setScanForm({ ...scanForm, siteId: v === 'none' ? '' : v })}
              >
                <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {sites.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="w-full" disabled={startScan.isPending}>
              Iniciar varredura
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
