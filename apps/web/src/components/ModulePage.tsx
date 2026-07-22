import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { PageHeader, EmptyState } from '@/components/ui/page-header';
import { Inbox } from 'lucide-react';

interface ModulePageProps {
  title: string;
  description: string;
  endpoint: string;
  breadcrumb?: string;
  columns?: { key: string; label: string; render?: (item: Record<string, unknown>) => React.ReactNode }[];
  actions?: React.ReactNode;
}

export function ModulePage({ title, description, endpoint, breadcrumb, columns, actions }: ModulePageProps) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [endpoint],
    queryFn: () => api.get<{ success: boolean; data: Record<string, unknown>[] | Record<string, unknown> }>(endpoint),
  });

  const items = Array.isArray(data?.data) ? data.data : data?.data ? [data.data] : [];

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} breadcrumb={breadcrumb} actions={actions} />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
        </div>
      ) : isError ? (
        <Card className="glass-card p-8 text-center">
          <p className="text-muted-foreground">Erro ao carregar dados.</p>
          <button onClick={() => refetch()} className="mt-2 text-sm text-primary hover:underline">
            Tentar novamente
          </button>
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nenhum registro"
          description="Não há dados para exibir neste módulo ainda."
        />
      ) : columns ? (
        <Card className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-enterprise w-full">
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th key={col.key}>{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i}>
                    {columns.map((col) => (
                      <td key={col.key}>
                        {col.render ? col.render(item) : String(item[col.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item, i) => (
            <Card key={i} className="glass-card p-4">
              <p className="font-medium">{String(item.title || item.name || `Item ${i + 1}`)}</p>
              <pre className="mt-2 max-h-32 overflow-auto text-xs text-muted-foreground">
                {JSON.stringify(item, null, 2)}
              </pre>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, 'success' | 'warning' | 'destructive' | 'info' | 'secondary' | 'critical'> = {
    OPEN: 'info', PENDING: 'warning', RESOLVED: 'success', CLOSED: 'secondary',
    ONLINE: 'success', OFFLINE: 'destructive', NEW: 'destructive', ACKNOWLEDGED: 'warning',
    CRITICAL: 'critical', WARNING: 'warning', INFO: 'info',
    PENDING_PATCH: 'warning', INSTALLED: 'success', RUNNING: 'info', COMPLETED: 'success',
  };
  return <Badge variant={variants[status] || 'secondary'}>{status}</Badge>;
}
