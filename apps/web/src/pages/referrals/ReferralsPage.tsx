import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Gift, Copy, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

interface Referral {
  id: string;
  email: string;
  status: string;
  createdAt: string;
}

interface ReferralsData {
  referralCode: string | null | undefined;
  referrals: Referral[];
}

const statusLabels: Record<string, string> = {
  PENDING: 'Pendente',
  ACCEPTED: 'Aceito',
  REWARDED: 'Recompensado',
};

export function ReferralsPage() {
  const [email, setEmail] = useState('');
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['referrals'],
    queryFn: () => api.get<{ success: boolean; data: ReferralsData }>('/api/referrals'),
  });

  const invite = useMutation({
    mutationFn: (body: { email: string }) => api.post('/api/referrals', body),
    onSuccess: () => {
      toast({ title: 'Indicação registrada' });
      setEmail('');
      queryClient.invalidateQueries({ queryKey: ['referrals'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const payload = data?.data;
  const referralCode = payload?.referralCode || '';
  const referrals = payload?.referrals || [];

  const copyCode = () => {
    if (!referralCode) return;
    navigator.clipboard.writeText(referralCode);
    setCopied(true);
    toast({ title: 'Código copiado' });
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Indique um Amigo"
        description="Programa de indicação"
        icon={Gift}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="glass-card lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Seu código</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg bg-muted/50 p-3 text-sm font-mono">
                {referralCode || '—'}
              </code>
              <Button variant="outline" size="icon" onClick={copyCode} disabled={!referralCode}>
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                invite.mutate({ email });
              }}
            >
              <div>
                <label className="text-sm font-medium">Indicar por e-mail</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="amigo@empresa.com"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={invite.isPending}>
                Enviar indicação
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="glass-card overflow-hidden lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Indicações</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left font-medium">E-mail</th>
                  <th className="p-3 text-left font-medium">Status</th>
                  <th className="p-3 text-left font-medium">Data</th>
                </tr>
              </thead>
              <tbody>
                {referrals.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="p-12 text-center text-muted-foreground">
                      Nenhuma indicação ainda
                    </td>
                  </tr>
                ) : (
                  referrals.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="p-3 font-medium">{r.email}</td>
                      <td className="p-3">
                        <Badge variant="secondary">{statusLabels[r.status] || r.status}</Badge>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">{formatDate(r.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
