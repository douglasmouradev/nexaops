import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Gauge, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

interface ThresholdProfile {
  id: string;
  name: string;
  cpuThreshold: number | null;
  ramThreshold: number | null;
  diskThreshold: number | null;
  offlineMinutes: number | null;
}

export function AdminThresholdsPage() {
  const [form, setForm] = useState({
    name: '',
    cpuThreshold: '90',
    ramThreshold: '90',
    diskThreshold: '90',
    offlineMinutes: '15',
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['threshold-profiles'],
    queryFn: () =>
      api.get<{ success: boolean; data: ThresholdProfile[] }>('/api/admin/threshold-profiles'),
  });

  const create = useMutation({
    mutationFn: (body: {
      name: string;
      cpuThreshold?: number;
      ramThreshold?: number;
      diskThreshold?: number;
      offlineMinutes?: number;
    }) => api.post('/api/admin/threshold-profiles', body),
    onSuccess: () => {
      toast({ title: 'Perfil criado' });
      setForm({ name: '', cpuThreshold: '90', ramThreshold: '90', diskThreshold: '90', offlineMinutes: '15' });
      queryClient.invalidateQueries({ queryKey: ['threshold-profiles'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const profiles = data?.data || [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Perfis de Limite"
        description="Thresholds reutilizáveis de monitoramento"
        icon={Gauge}
        breadcrumb="Administração"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="glass-card lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plus className="h-4 w-4" />
              Novo perfil
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate({
                  name: form.name,
                  cpuThreshold: Number(form.cpuThreshold) || undefined,
                  ramThreshold: Number(form.ramThreshold) || undefined,
                  diskThreshold: Number(form.diskThreshold) || undefined,
                  offlineMinutes: Number(form.offlineMinutes) || undefined,
                });
              }}
            >
              <div>
                <label className="text-sm font-medium">Nome *</label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">CPU %</label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={form.cpuThreshold}
                    onChange={(e) => setForm({ ...form, cpuThreshold: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">RAM %</label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={form.ramThreshold}
                    onChange={(e) => setForm({ ...form, ramThreshold: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Disco %</label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={form.diskThreshold}
                    onChange={(e) => setForm({ ...form, diskThreshold: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Offline (min)</label>
                  <Input
                    type="number"
                    min={1}
                    value={form.offlineMinutes}
                    onChange={(e) => setForm({ ...form, offlineMinutes: e.target.value })}
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={create.isPending}>
                Criar perfil
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="glass-card overflow-hidden lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left font-medium">Perfil</th>
                  <th className="p-3 text-left font-medium">CPU %</th>
                  <th className="p-3 text-left font-medium">RAM %</th>
                  <th className="p-3 text-left font-medium">Disco %</th>
                  <th className="p-3 text-left font-medium">Offline (min)</th>
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} className="border-b">
                        <td colSpan={5} className="p-3">
                          <Skeleton className="h-8" />
                        </td>
                      </tr>
                    ))
                  : profiles.length === 0
                    ? (
                      <tr>
                        <td colSpan={5} className="p-12 text-center text-muted-foreground">
                          Nenhum perfil cadastrado
                        </td>
                      </tr>
                    )
                    : profiles.map((p) => (
                      <tr key={p.id} className="border-b">
                        <td className="p-3 font-medium">{p.name}</td>
                        <td className="p-3">{p.cpuThreshold ?? '—'}</td>
                        <td className="p-3">{p.ramThreshold ?? '—'}</td>
                        <td className="p-3">{p.diskThreshold ?? '—'}</td>
                        <td className="p-3">{p.offlineMinutes ?? '—'}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
