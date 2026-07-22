import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Receipt, Clock, Plus, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
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
import { useToast } from '@/hooks/use-toast';
import { useCanWrite } from '@/hooks/use-permissions';

interface TimeEntry {
  id: string;
  description: string;
  hours: number;
  billable: boolean;
  workedAt: string;
  user: { name: string };
}

interface Invoice {
  id: string;
  number: number;
  status: string;
  total: number;
  currency: string;
  createdAt: string;
  lines: { description: string; amount: number }[];
}

export function BillingPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const [showTime, setShowTime] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [timeForm, setTimeForm] = useState({ description: '', hours: '1' });
  const [invoiceForm, setInvoiceForm] = useState({ description: '', quantity: '1', unitPrice: '100' });

  const { data: timeData, isLoading: loadingTime } = useQuery({
    queryKey: ['time-entries'],
    queryFn: () =>
      api.get<{ success: boolean; data: TimeEntry[] }>('/api/billing/time-entries', { limit: 50 }),
  });

  const { data: invoiceData, isLoading: loadingInv } = useQuery({
    queryKey: ['invoices'],
    queryFn: () =>
      api.get<{ success: boolean; data: Invoice[] }>('/api/billing/invoices', { limit: 50 }),
  });

  const createTime = useMutation({
    mutationFn: () =>
      api.post('/api/billing/time-entries', {
        description: timeForm.description,
        hours: Number(timeForm.hours),
        billable: true,
      }),
    onSuccess: () => {
      toast({ title: 'Apontamento criado' });
      setShowTime(false);
      setTimeForm({ description: '', hours: '1' });
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const createInvoice = useMutation({
    mutationFn: () =>
      api.post('/api/billing/invoices', {
        lines: [
          {
            description: invoiceForm.description,
            quantity: Number(invoiceForm.quantity),
            unitPrice: Number(invoiceForm.unitPrice),
          },
        ],
      }),
    onSuccess: () => {
      toast({ title: 'Fatura criada' });
      setShowInvoice(false);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const createInvoiceFromTime = useMutation({
    mutationFn: (timeEntryIds: string[]) =>
      api.post('/api/billing/invoices/from-time-entries', { timeEntryIds, defaultHourlyRate: 150 }),
    onSuccess: () => {
      toast({ title: 'Fatura gerada a partir dos apontamentos' });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const markPaid = useMutation({
    mutationFn: (id: string) => api.patch(`/api/billing/invoices/${id}`, { status: 'PAID' }),
    onSuccess: () => {
      toast({ title: 'Fatura marcada como paga' });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const stripeCheckout = useMutation({
    mutationFn: (id: string) =>
      api.post<{ success: boolean; data: { url?: string | null; stub?: boolean; message?: string } }>(
        `/api/billing/invoices/${id}/checkout`,
        {}
      ),
    onSuccess: (res) => {
      if (res.data?.url) {
        window.location.href = res.data.url;
        return;
      }
      if (res.data?.stub) {
        toast({
          title: 'Checkout Stripe indisponível',
          description: res.data.message || 'Configure STRIPE_SECRET_KEY ou use Marcar pago',
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: 'Checkout',
        description: res.data?.message || 'Sem URL de pagamento',
      });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const { data: stripeStatus } = useQuery({
    queryKey: ['stripe-status'],
    queryFn: () =>
      api.get<{ success: boolean; data: { configured: boolean; mode: string } }>('/api/billing/stripe/status'),
  });
  const stripeConfigured = Boolean(stripeStatus?.data?.configured);

  const entries = timeData?.data || [];
  const invoices = invoiceData?.data || [];
  const billableIds = entries.filter((e) => e.billable).map((e) => e.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Faturamento"
        description={
          stripeConfigured
            ? 'Apontamentos, faturas e checkout Stripe'
            : 'Apontamentos e faturas (Stripe não configurado — use Marcar pago)'
        }
        icon={Receipt}
        breadcrumb="Financeiro"
        actions={
          canWrite ? (
            <div className="flex gap-2">
              <Badge variant={stripeConfigured ? 'info' : 'secondary'}>
                {stripeConfigured ? 'Stripe ativo' : 'Sem Stripe'}
              </Badge>
              <Button size="sm" variant="outline" onClick={() => setShowTime(true)}>
                <Clock className="h-3.5 w-3.5" /> Horas
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={billableIds.length === 0 || createInvoiceFromTime.isPending}
                onClick={() => createInvoiceFromTime.mutate(billableIds)}
              >
                Horas → Fatura
              </Button>
              <Button size="sm" onClick={() => setShowInvoice(true)}>
                <Plus className="h-3.5 w-3.5" /> Fatura
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Apontamentos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loadingTime ? (
              <Skeleton className="h-24" />
            ) : entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum apontamento</p>
            ) : (
              entries.map((e) => (
                <div key={e.id} className="flex justify-between border-b border-border/50 pb-2 text-sm last:border-0">
                  <div>
                    <p className="font-medium">{e.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.user.name} · {formatDate(e.workedAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{e.hours}h</p>
                    {e.billable && <Badge variant="secondary">Faturável</Badge>}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Faturas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loadingInv ? (
              <Skeleton className="h-24" />
            ) : invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma fatura</p>
            ) : (
              invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between border-b border-border/50 pb-2 text-sm last:border-0">
                  <div>
                    <p className="font-medium">#{inv.number}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(inv.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={inv.status === 'PAID' ? 'success' : 'secondary'}>{inv.status}</Badge>
                    <span className="font-medium">
                      {inv.currency} {inv.total.toFixed(2)}
                    </span>
                    {inv.status !== 'PAID' && inv.status !== 'VOID' && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!stripeConfigured || stripeCheckout.isPending}
                          title={!stripeConfigured ? 'Configure STRIPE_SECRET_KEY no servidor' : undefined}
                          onClick={() => stripeCheckout.mutate(inv.id)}
                        >
                          Stripe
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => markPaid.mutate(inv.id)}>
                          Marcar pago
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showTime} onOpenChange={setShowTime}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo apontamento</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              createTime.mutate();
            }}
          >
            <Input
              placeholder="Descrição"
              value={timeForm.description}
              onChange={(e) => setTimeForm({ ...timeForm, description: e.target.value })}
              required
            />
            <Input
              type="number"
              step="0.25"
              min="0.25"
              placeholder="Horas"
              value={timeForm.hours}
              onChange={(e) => setTimeForm({ ...timeForm, hours: e.target.value })}
              required
            />
            <Button type="submit" className="w-full" disabled={createTime.isPending}>
              {createTime.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showInvoice} onOpenChange={setShowInvoice}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova fatura</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              createInvoice.mutate();
            }}
          >
            <Input
              placeholder="Descrição do item"
              value={invoiceForm.description}
              onChange={(e) => setInvoiceForm({ ...invoiceForm, description: e.target.value })}
              required
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                min="1"
                placeholder="Qtd"
                value={invoiceForm.quantity}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, quantity: e.target.value })}
              />
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Preço unit."
                value={invoiceForm.unitPrice}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, unitPrice: e.target.value })}
              />
            </div>
            <Button type="submit" className="w-full" disabled={createInvoice.isPending}>
              {createInvoice.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Criar fatura
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
