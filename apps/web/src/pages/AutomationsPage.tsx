import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Workflow, Plus, Loader2, Power } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useCanWrite } from '@/hooks/use-permissions';

interface Automation {
  id: string;
  name: string;
  trigger: string;
  action: string;
  enabled: boolean;
  script?: { id: string; name: string } | null;
}

export function AutomationsPage() {
  const canWrite = useCanWrite();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    trigger: 'cron',
    action: 'schedule_pending_patches',
    hour: '2',
    minute: '0',
    scriptId: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['automations'],
    queryFn: () => api.get<{ success: boolean; data: Automation[] }>('/api/automations'),
  });

  const { data: scriptsData } = useQuery({
    queryKey: ['scripts-list'],
    queryFn: () =>
      api.get<{ success: boolean; data: { id: string; name: string }[] }>('/api/scripts'),
    enabled: open && form.action === 'run_script',
  });

  const create = useMutation({
    mutationFn: () => {
      if (form.action === 'run_script' && !form.scriptId) {
        throw new Error('Selecione um script');
      }
      return api.post('/api/automations', {
        name: form.name,
        trigger: form.trigger,
        action: form.action,
        scriptId: form.action === 'run_script' ? form.scriptId : undefined,
        triggerConfig: {
          hour: Number(form.hour),
          minute: Number(form.minute),
          days: [0, 1, 2, 3, 4, 5, 6],
          startHour: Number(form.hour),
          endHour: Number(form.hour) + 2,
        },
        actionConfig:
          form.action === 'run_script' && form.scriptId
            ? { scriptId: form.scriptId }
            : {},
        enabled: true,
      });
    },
    onSuccess: () => {
      toast({ title: 'Automação criada' });
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ['automations'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/api/automations/${id}`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automations'] }),
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const rows = data?.data || [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automações"
        description="Maintenance windows, cron e ações em massa"
        icon={Workflow}
        actions={
          canWrite ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Nova
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profiles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <Skeleton className="h-24" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma automação. Ex.: patch às 02:00 em maintenance window.
            </p>
          ) : (
            rows.map((a) => (
              <div key={a.id} className="flex items-center justify-between border-b border-border/50 pb-2 text-sm last:border-0">
                <div>
                  <p className="font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.trigger} → {a.action}
                    {a.script ? ` · ${a.script.name}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={a.enabled ? 'success' : 'secondary'}>
                    {a.enabled ? 'Ativa' : 'Off'}
                  </Badge>
                  {canWrite && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggle.mutate({ id: a.id, enabled: !a.enabled })}
                    >
                      <Power className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova automação</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Input
              placeholder="Nome"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <Select value={form.trigger} onValueChange={(v) => setForm({ ...form, trigger: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cron">Cron (hora/minuto)</SelectItem>
                <SelectItem value="maintenance_window">Maintenance window</SelectItem>
                <SelectItem value="device_offline">Device offline</SelectItem>
                <SelectItem value="alert_critical">Alerta crítico</SelectItem>
              </SelectContent>
            </Select>
            <Select value={form.action} onValueChange={(v) => setForm({ ...form, action: v, scriptId: '' })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="schedule_pending_patches">Agendar patches pendentes</SelectItem>
                <SelectItem value="run_script">Rodar script</SelectItem>
              </SelectContent>
            </Select>
            {form.action === 'run_script' && (
              <Select
                value={form.scriptId || undefined}
                onValueChange={(v) => setForm({ ...form, scriptId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Script" />
                </SelectTrigger>
                <SelectContent>
                  {(scriptsData?.data || []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                min="0"
                max="23"
                placeholder="Hora"
                value={form.hour}
                onChange={(e) => setForm({ ...form, hour: e.target.value })}
              />
              <Input
                type="number"
                min="0"
                max="59"
                placeholder="Minuto"
                value={form.minute}
                onChange={(e) => setForm({ ...form, minute: e.target.value })}
              />
            </div>
            <Button type="submit" className="w-full" disabled={create.isPending}>
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Criar
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
