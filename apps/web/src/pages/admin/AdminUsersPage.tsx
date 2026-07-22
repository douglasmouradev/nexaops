import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useToast } from '@/hooks/use-toast';

interface UserItem {
  id: string;
  email: string;
  name: string;
  role: string;
  twoFactorEnabled: boolean;
  createdAt: string;
}

interface PaginationMeta {
  page: number;
  totalPages: number;
  total: number;
}

const roleLabels: Record<string, string> = {
  ADMIN: 'Administrador',
  TECHNICIAN: 'Técnico',
  READ_ONLY: 'Somente leitura',
};

export function AdminUsersPage() {
  const [page, setPage] = useState(1);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('TECHNICIAN');

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', page],
    queryFn: () =>
      api.get<{ success: boolean; data: UserItem[]; meta: PaginationMeta }>('/api/admin/users', {
        page,
        limit: 25,
      }),
  });

  const invite = useMutation({
    mutationFn: (body: { email: string; name: string; role: string }) =>
      api.post('/api/auth/invite', body),
    onSuccess: () => {
      toast({ title: 'Convite enviado' });
      setEmail('');
      setName('');
      setRole('TECHNICIAN');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const users = data?.data || [];
  const meta = data?.meta;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuários"
        description="Gestão de técnicos e permissões"
        icon={Users}
        breadcrumb="Administração"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="glass-card lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4" />
              Convidar usuário
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                invite.mutate({ email, name, role });
              }}
            >
              <div>
                <label className="text-sm font-medium">Nome</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
              </div>
              <div>
                <label className="text-sm font-medium">E-mail</label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div>
                <label className="text-sm font-medium">Papel</label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ADMIN">Administrador</SelectItem>
                    <SelectItem value="TECHNICIAN">Técnico</SelectItem>
                    <SelectItem value="READ_ONLY">Somente leitura</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={invite.isPending}>
                Enviar convite
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="glass-card overflow-hidden lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left font-medium">Nome</th>
                  <th className="p-3 text-left font-medium">E-mail</th>
                  <th className="p-3 text-left font-medium">Papel</th>
                  <th className="p-3 text-left font-medium">2FA</th>
                  <th className="p-3 text-left font-medium">Criado</th>
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-b">
                        <td colSpan={5} className="p-3">
                          <Skeleton className="h-8" />
                        </td>
                      </tr>
                    ))
                  : users.length === 0
                    ? (
                      <tr>
                        <td colSpan={5} className="p-12 text-center text-muted-foreground">
                          Nenhum usuário encontrado
                        </td>
                      </tr>
                    )
                    : users.map((user) => (
                      <tr key={user.id} className="border-b">
                        <td className="p-3 font-medium">{user.name}</td>
                        <td className="p-3 text-xs">{user.email}</td>
                        <td className="p-3">
                          <Badge variant="secondary">{roleLabels[user.role] || user.role}</Badge>
                        </td>
                        <td className="p-3">
                          <Badge variant={user.twoFactorEnabled ? 'success' : 'secondary'}>
                            {user.twoFactorEnabled ? 'Sim' : 'Não'}
                          </Badge>
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">{formatDate(user.createdAt)}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between border-t p-3">
              <p className="text-xs text-muted-foreground">
                Página {meta.page} de {meta.totalPages} ({meta.total} usuários)
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
    </div>
  );
}
