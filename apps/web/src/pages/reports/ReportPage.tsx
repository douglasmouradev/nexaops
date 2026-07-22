import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileBarChart, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useToast } from '@/hooks/use-toast';

const titles: Record<string, string> = {
  devices: 'Relatórios de Dispositivos',
  'tickets-sla': 'Relatórios de Tickets / SLA',
  'patch-compliance': 'Relatórios de Patch / Compliance',
  financial: 'Relatórios Financeiros',
};

interface StatusCount {
  status: string;
  _count: number;
}

interface SiteOption {
  id: string;
  name: string;
}

interface DevicesReport {
  devices: StatusCount[];
}

interface TicketsSlaReport {
  byStatus: StatusCount[];
  breached: number;
}

interface PatchComplianceReport {
  total: number;
  updated: number;
  compliance: number;
}

interface FinancialReport {
  revenue: number;
  contracts: number;
  message?: string;
}

function isDevicesReport(data: unknown): data is DevicesReport {
  return !!data && typeof data === 'object' && Array.isArray((data as DevicesReport).devices);
}

function isTicketsSlaReport(data: unknown): data is TicketsSlaReport {
  return !!data && typeof data === 'object' && Array.isArray((data as TicketsSlaReport).byStatus);
}

function isPatchComplianceReport(data: unknown): data is PatchComplianceReport {
  return !!data && typeof data === 'object' && typeof (data as PatchComplianceReport).compliance === 'number';
}

function isFinancialReport(data: unknown): data is FinancialReport {
  return !!data && typeof data === 'object' && 'revenue' in (data as object);
}

function flattenForCsv(category: string, data: unknown): { headers: string[]; rows: string[][] } {
  if (category === 'devices' && isDevicesReport(data)) {
    return {
      headers: ['status', 'count'],
      rows: data.devices.map((d) => [d.status, String(d._count)]),
    };
  }
  if (category === 'tickets-sla' && isTicketsSlaReport(data)) {
    const rows = data.byStatus.map((s) => [s.status, String(s._count)]);
    rows.push(['SLA_BREACHED', String(data.breached ?? 0)]);
    return { headers: ['status', 'count'], rows };
  }
  if (category === 'patch-compliance' && isPatchComplianceReport(data)) {
    return {
      headers: ['total', 'updated', 'compliance'],
      rows: [[String(data.total), String(data.updated), String(data.compliance)]],
    };
  }
  if (category === 'financial' && isFinancialReport(data)) {
    return {
      headers: ['revenue', 'contracts', 'message'],
      rows: [[String(data.revenue ?? 0), String(data.contracts ?? 0), data.message || '']],
    };
  }
  const obj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    headers: ['key', 'value'],
    rows: Object.entries(obj).map(([k, v]) => [
      k,
      typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''),
    ]),
  };
}

function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const escape = (cell: string) => `"${cell.replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ReportPage({ category }: { category: string }) {
  const { toast } = useToast();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [siteId, setSiteId] = useState<string>('all');

  const filters = {
    from: from || undefined,
    to: to || undefined,
    siteId: siteId !== 'all' ? siteId : undefined,
  };

  const { data: sitesData } = useQuery({
    queryKey: ['sites-report-filter'],
    queryFn: () => api.get<{ success: boolean; data: SiteOption[] }>('/api/sites', { limit: 100 }),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['reports', category, filters.from, filters.to, filters.siteId],
    queryFn: () =>
      api.get<{ success: boolean; data: unknown }>(`/api/reports/${category}`, filters),
  });

  const report = data?.data;
  const sites = sitesData?.data || [];

  const exportCsv = () => {
    if (!report) return;
    const { headers, rows } = flattenForCsv(category, report);
    downloadCsv(`relatorio-${category}.csv`, headers, rows);
    toast({ title: 'CSV exportado' });
  };

  const exportPdf = async () => {
    try {
      const token = api.getAccessToken();
      const base = import.meta.env.VITE_API_URL || '';
      const qs = new URLSearchParams();
      if (filters.from) qs.set('from', filters.from);
      if (filters.to) qs.set('to', filters.to);
      if (filters.siteId) qs.set('siteId', filters.siteId);
      const q = qs.toString();
      const res = await fetch(`${base}/api/reports/${category}/pdf${q ? `?${q}` : ''}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Falha ao gerar PDF');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `relatorio-${category}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'PDF exportado' });
    } catch (err) {
      toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={titles[category] || 'Relatórios'}
        description="Dados exportáveis com filtros de período e site"
        icon={FileBarChart}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1" onClick={exportPdf} disabled={!report}>
              <Download className="h-4 w-4" />
              PDF
            </Button>
            <Button size="sm" className="gap-1" onClick={exportCsv} disabled={!report}>
              <Download className="h-4 w-4" />
              Exportar CSV
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:flex-wrap sm:items-end">
          <div>
            <label className="text-xs text-muted-foreground">De</label>
            <Input type="date" className="mt-1 w-[160px]" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Até</label>
            <Input type="date" className="mt-1 w-[160px]" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Site</label>
            <Select value={siteId} onValueChange={setSiteId}>
              <SelectTrigger className="mt-1 w-[200px]">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os sites</SelectItem>
                {sites.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton className="h-48" />
      ) : !report ? (
        <Card className="glass-card p-8 text-center text-muted-foreground">
          Sem dados para este relatório
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {category === 'devices' && isDevicesReport(report) &&
            report.devices.map((d) => (
              <Card key={d.status} className="glass-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{d.status}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold tabular-nums">{d._count}</p>
                  <p className="text-xs text-muted-foreground">dispositivos</p>
                </CardContent>
              </Card>
            ))}

          {category === 'tickets-sla' && isTicketsSlaReport(report) && (
            <>
              {report.byStatus.map((s) => (
                <Card key={s.status} className="glass-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">{s.status}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold tabular-nums">{s._count}</p>
                  </CardContent>
                </Card>
              ))}
              <Card className="glass-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">SLA violado</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold tabular-nums text-destructive">{report.breached}</p>
                </CardContent>
              </Card>
            </>
          )}

          {category === 'patch-compliance' && isPatchComplianceReport(report) && (
            <>
              <Card className="glass-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Compliance</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold tabular-nums">{report.compliance}%</p>
                </CardContent>
              </Card>
              <Card className="glass-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold tabular-nums">{report.total}</p>
                </CardContent>
              </Card>
              <Card className="glass-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Atualizados</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold tabular-nums">{report.updated}</p>
                </CardContent>
              </Card>
            </>
          )}

          {category === 'financial' && isFinancialReport(report) && (
            <>
              <Card className="glass-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Receita</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold tabular-nums">{report.revenue}</p>
                </CardContent>
              </Card>
              <Card className="glass-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Contratos</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold tabular-nums">{report.contracts}</p>
                </CardContent>
              </Card>
              {report.message && (
                <Card className="glass-card md:col-span-2">
                  <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground">{report.message}</p>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
