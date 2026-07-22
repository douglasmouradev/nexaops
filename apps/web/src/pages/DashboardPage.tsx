import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Monitor, MonitorOff, Ticket, Clock, Shield, AlertTriangle,
  LayoutDashboard, ArrowRight, Activity,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader, KpiCard } from '@/components/ui/page-header';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/utils';
import { useAuthStore } from '@/stores';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { ChartTooltip, chartTooltipStyle } from '@/components/charts/ChartTooltip';

interface DashboardData {
  kpis: {
    devicesOnline: number;
    devicesOffline: number;
    ticketsOpen: number;
    slaAtRisk: number;
    patchesPending: number;
    criticalAlerts: number;
  };
  ticketsByStatus: { open: number; pending: number; resolved: number };
  recentCriticalAlerts: {
    id: string;
    title: string;
    severity: string;
    createdAt: string;
    device?: { name: string };
  }[];
}

const CHART_COLORS = ['hsl(var(--primary))', 'hsl(var(--warning))', 'hsl(var(--success))'];

export function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<{ success: boolean; data: DashboardData }>('/api/dashboard'),
    refetchInterval: 60000,
  });

  const stats = data?.data;
  const totalDevices = (stats?.kpis.devicesOnline ?? 0) + (stats?.kpis.devicesOffline ?? 0);
  const uptimePercent = totalDevices > 0
    ? Math.round(((stats?.kpis.devicesOnline ?? 0) / totalDevices) * 100)
    : 0;

  const chartData = stats
    ? [
        { name: 'Aberto', value: stats.ticketsByStatus.open, fill: CHART_COLORS[0] },
        { name: 'Pendente', value: stats.ticketsByStatus.pending, fill: CHART_COLORS[1] },
        { name: 'Resolvido', value: stats.ticketsByStatus.resolved, fill: CHART_COLORS[2] },
      ]
    : [];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16 w-72" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-muted-foreground">Não foi possível carregar o painel.</p>
        <Button onClick={() => refetch()}>Tentar novamente</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Olá, ${user?.name?.split(' ')[0] || 'usuário'}`}
        description={`${user?.organizationName} · Uptime ${uptimePercent}%`}
        icon={LayoutDashboard}
        breadcrumb="Painel"
        actions={
          <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate('/devices')}>
            <Activity className="h-4 w-4" />
            Ver dispositivos
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Online" value={stats?.kpis.devicesOnline ?? 0} icon={Monitor} variant="success" onClick={() => navigate('/devices')} />
        <KpiCard label="Offline" value={stats?.kpis.devicesOffline ?? 0} icon={MonitorOff} variant="danger" onClick={() => navigate('/devices')} />
        <KpiCard label="Tickets abertos" value={stats?.kpis.ticketsOpen ?? 0} icon={Ticket} variant="info" onClick={() => navigate('/tickets')} />
        <KpiCard label="SLA em risco" value={stats?.kpis.slaAtRisk ?? 0} icon={Clock} variant="warning" onClick={() => navigate('/tickets')} />
        <KpiCard label="Patches" value={stats?.kpis.patchesPending ?? 0} icon={Shield} variant="default" onClick={() => navigate('/patches')} />
        <KpiCard label="Alertas críticos" value={stats?.kpis.criticalAlerts ?? 0} icon={AlertTriangle} variant="danger" onClick={() => navigate('/alerts')} />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="glass-card lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Tickets por status</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} barSize={40}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={chartTooltipStyle.cursor}
                  content={<ChartTooltip valueLabel="Tickets" />}
                />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="glass-card lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Distribuição</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  dataKey="value"
                  paddingAngle={4}
                >
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip valueLabel="Tickets" />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-2 flex flex-wrap justify-center gap-3">
              {chartData.map((d) => (
                <div key={d.name} className="flex items-center gap-1.5 text-xs">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.fill }} />
                  {d.name}: {d.value}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-semibold">Alertas críticos recentes</CardTitle>
          <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => navigate('/alerts')}>
            Ver todos <ArrowRight className="h-3 w-3" />
          </Button>
        </CardHeader>
        <CardContent>
          {!stats?.recentCriticalAlerts.length ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              Nenhum alerta crítico — operação estável
            </div>
          ) : (
            <div className="space-y-2">
              {stats.recentCriticalAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-center justify-between rounded-lg border bg-muted/20 px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{alert.title}</p>
                    {alert.device && (
                      <p className="text-xs text-muted-foreground">{alert.device.name}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Badge variant="critical">Crítico</Badge>
                    <span className="text-xs text-muted-foreground">{formatRelative(alert.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
