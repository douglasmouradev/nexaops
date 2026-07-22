import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, RefreshCw, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
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

interface Patch {
  id: string;
  title: string;
  kbId: string | null;
  severity: string;
  status: string;
  scheduledAt: string | null;
  device: { name: string };
}

interface Compliance {
  total: number;
  withPending: number;
  compliance: number;
}

export function PatchesPage() {
  const [selectedPatches, setSelectedPatches] = useState<Set<string>>(new Set());
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [page, setPage] = useState(1);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canWrite = useCanWrite();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['patches', page],
    queryFn: () =>
      api.get<{
        success: boolean;
        data: Patch[];
        meta: { page: number; totalPages: number; total: number };
      }>('/api/patches', { page, limit: 25 }),
  });

  const { data: complianceData } = useQuery({
    queryKey: ['patches-compliance'],
    queryFn: () => api.get<{ success: boolean; data: Compliance }>('/api/patches/compliance'),
  });

  const schedulePatches = useMutation({
    mutationFn: (body: { patchIds: string[]; scheduledAt: string }) =>
      api.post('/api/patches/schedule', body),
    onSuccess: () => {
      toast({ title: 'Patches agendados' });
      setShowSchedule(false);
      setSelectedPatches(new Set());
      setScheduledAt('');
      queryClient.invalidateQueries({ queryKey: ['patches'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const patches = data?.data || [];
  const meta = data?.meta;
  const compliance = complianceData?.data;

  const togglePatch = (id: string) => {
    setSelectedPatches((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = patches.length > 0 && patches.every((p) => selectedPatches.has(p.id));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Gestão de Patch</h1>
          <p className="text-sm text-muted-foreground">Atualizações pendentes e compliance</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          {canWrite && selectedPatches.size > 0 && (
            <Button size="sm" className="gap-1" onClick={() => setShowSchedule(true)}>
              <Calendar className="h-4 w-4" />
              Agendar ({selectedPatches.size})
            </Button>
          )}
        </div>
      </div>

      {compliance && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Compliance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Shield className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-3xl font-bold">{compliance.compliance}%</p>
                  <p className="text-xs text-muted-foreground">dispositivos em dia</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total de Dispositivos</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{compliance.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Com Patches Pendentes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-warning">{compliance.withPending}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="w-10 p-3">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={() => {
                      if (allSelected) setSelectedPatches(new Set());
                      else setSelectedPatches(new Set(patches.map((p) => p.id)));
                    }}
                  />
                </th>
                <th className="p-3 text-left font-medium">Patch</th>
                <th className="p-3 text-left font-medium">KB</th>
                <th className="p-3 text-left font-medium">Severidade</th>
                <th className="p-3 text-left font-medium">Status</th>
                <th className="p-3 text-left font-medium">Dispositivo</th>
                <th className="p-3 text-left font-medium">Agendado</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td colSpan={7} className="p-3"><Skeleton className="h-8" /></td>
                    </tr>
                  ))
                : patches.length === 0
                  ? (
                    <tr>
                      <td colSpan={7} className="p-12 text-center text-muted-foreground">
                        <Shield className="mx-auto mb-2 h-8 w-8 opacity-50" />
                        Nenhum patch pendente
                      </td>
                    </tr>
                  )
                  : patches.map((patch) => (
                    <tr key={patch.id} className="border-b transition-colors hover:bg-muted/30">
                      <td className="p-3">
                        <Checkbox
                          checked={selectedPatches.has(patch.id)}
                          onCheckedChange={() => togglePatch(patch.id)}
                        />
                      </td>
                      <td className="p-3 font-medium">{patch.title}</td>
                      <td className="p-3 text-xs font-mono">{patch.kbId || '—'}</td>
                      <td className="p-3"><StatusBadge status={patch.severity} /></td>
                      <td className="p-3"><StatusBadge status={patch.status} /></td>
                      <td className="p-3 text-xs">{patch.device.name}</td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {patch.scheduledAt ? formatDate(patch.scheduledAt) : '—'}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between border-t p-3">
            <p className="text-xs text-muted-foreground">
              Página {meta.page} de {meta.totalPages} ({meta.total} patches)
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

      <Dialog open={showSchedule} onOpenChange={setShowSchedule}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agendar Patches</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              schedulePatches.mutate({
                patchIds: Array.from(selectedPatches),
                scheduledAt: new Date(scheduledAt).toISOString(),
              });
            }}
          >
            <p className="text-sm text-muted-foreground">
              {selectedPatches.size} patch(es) selecionado(s)
            </p>
            <div>
              <label className="text-sm font-medium">Data e hora *</label>
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={schedulePatches.isPending}>
              Confirmar agendamento
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
