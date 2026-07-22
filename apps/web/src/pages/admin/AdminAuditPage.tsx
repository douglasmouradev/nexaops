import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  createdAt: string;
  user: { name: string } | null;
}

interface PaginationMeta {
  page: number;
  totalPages: number;
  total: number;
}

export function AdminAuditPage() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-audit', page],
    queryFn: () =>
      api.get<{ success: boolean; data: AuditLog[]; meta: PaginationMeta }>('/api/admin/audit-logs', {
        page,
        limit: 25,
      }),
  });

  const logs = data?.data || [];
  const meta = data?.meta;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Log de Auditoria"
        description="Registro de ações no sistema"
        icon={ScrollText}
        breadcrumb="Administração"
      />

      <Card className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left font-medium">Ação</th>
                <th className="p-3 text-left font-medium">Entidade</th>
                <th className="p-3 text-left font-medium">Usuário</th>
                <th className="p-3 text-left font-medium">Data</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td colSpan={4} className="p-3">
                        <Skeleton className="h-8" />
                      </td>
                    </tr>
                  ))
                : logs.length === 0
                  ? (
                    <tr>
                      <td colSpan={4} className="p-12 text-center text-muted-foreground">
                        Nenhum registro de auditoria
                      </td>
                    </tr>
                  )
                  : logs.map((log) => (
                    <tr key={log.id} className="border-b">
                      <td className="p-3">
                        <Badge variant="secondary">{log.action}</Badge>
                      </td>
                      <td className="p-3 text-xs">
                        {log.entity}
                        {log.entityId ? ` · ${log.entityId.slice(0, 8)}…` : ''}
                      </td>
                      <td className="p-3 text-xs">{log.user?.name || 'Sistema'}</td>
                      <td className="p-3 text-xs text-muted-foreground">{formatDate(log.createdAt)}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between border-t p-3">
            <p className="text-xs text-muted-foreground">
              Página {meta.page} de {meta.totalPages} ({meta.total} registros)
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
      </Card>
    </div>
  );
}
