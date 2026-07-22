import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Monitor, Ticket, BookOpen, Plus, ShieldAlert, ArrowLeft, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { cn } from '@/lib/utils';

interface PortalTicket {
  id: string;
  number: number;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
}

interface PortalTicketDetail extends PortalTicket {
  description: string | null;
  updatedAt: string;
  comments: {
    id: string;
    content: string;
    type: string;
    createdAt: string;
    author: { name: string };
  }[];
  attachments: {
    id: string;
    fileName: string;
    contentType: string | null;
    sizeBytes: number | null;
    createdAt: string;
    uploadedBy: string | null;
  }[];
}

interface PortalArticle {
  id: string;
  title: string;
  category: string | null;
  updatedAt: string;
}

const EMAIL_KEY = 'nexaops_portal_email';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const b64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(b64 || '');
    };
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.readAsDataURL(file);
  });
}

export function PortalPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const [searchParams] = useSearchParams();
  const tokenFromUrl = searchParams.get('token') || '';
  const [token] = useState(() => {
    if (tokenFromUrl) {
      sessionStorage.setItem('nexaops_portal_token', tokenFromUrl);
      // Remove token da URL (histórico / referrer)
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      return tokenFromUrl;
    }
    return sessionStorage.getItem('nexaops_portal_token') || '';
  });

  const [tab, setTab] = useState<'tickets' | 'knowledge' | 'devices'>('tickets');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [contactEmail, setContactEmail] = useState(
    () => sessionStorage.getItem(EMAIL_KEY) || ''
  );
  const [ticketForm, setTicketForm] = useState({ title: '', description: '', email: '' });
  const [reply, setReply] = useState('');

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const canLoad = !!orgSlug && !!token;
  const emailNormalized = contactEmail.trim().toLowerCase();

  const { data: ticketsData, isLoading: loadingTickets, error: ticketsError } = useQuery({
    queryKey: ['portal-tickets', orgSlug, token, emailNormalized],
    queryFn: () =>
      api.get<{ success: boolean; data: PortalTicket[]; meta?: { orgName: string } }>(
        '/api/portal/tickets',
        { org: orgSlug!, email: emailNormalized },
        { headers: { 'X-Portal-Token': token } }
      ),
    enabled: canLoad && !!emailNormalized && tab === 'tickets' && !selectedTicketId,
    retry: false,
  });

  const { data: detailData, isLoading: loadingDetail } = useQuery({
    queryKey: ['portal-ticket', orgSlug, token, emailNormalized, selectedTicketId],
    queryFn: () =>
      api.get<{ success: boolean; data: PortalTicketDetail }>(
        `/api/portal/tickets/${selectedTicketId}`,
        { org: orgSlug!, email: emailNormalized },
        { headers: { 'X-Portal-Token': token } }
      ),
    enabled: canLoad && !!emailNormalized && !!selectedTicketId,
    retry: false,
  });

  const { data: articlesData, isLoading: loadingArticles, error: articlesError } = useQuery({
    queryKey: ['portal-knowledge', orgSlug, token],
    queryFn: () =>
      api.get<{ success: boolean; data: PortalArticle[]; meta?: { orgName: string } }>(
        '/api/portal/knowledge',
        { org: orgSlug! },
        { headers: { 'X-Portal-Token': token } }
      ),
    enabled: canLoad && tab === 'knowledge',
    retry: false,
  });

  const { data: devicesData, isLoading: loadingDevices } = useQuery({
    queryKey: ['portal-devices', orgSlug, token, emailNormalized],
    queryFn: () =>
      api.get<{
        success: boolean;
        data: { id: string; name: string; status: string; site?: { name: string } | null; lastSeenAt: string | null }[];
      }>(
        '/api/portal/devices',
        { org: orgSlug!, email: emailNormalized },
        { headers: { 'X-Portal-Token': token } }
      ),
    enabled: canLoad && !!emailNormalized && tab === 'devices',
    retry: false,
  });

  const createTicket = useMutation({
    mutationFn: (body: {
      orgSlug: string;
      title: string;
      description: string;
      email: string;
    }) =>
      api.post('/api/portal/tickets', body, {
        headers: { 'X-Portal-Token': token },
      }),
    onSuccess: (_data, vars) => {
      toast({ title: 'Chamado aberto', description: 'Nossa equipe entrará em contato em breve' });
      setShowCreate(false);
      setTicketForm({ title: '', description: '', email: '' });
      const email = vars.email.trim().toLowerCase();
      sessionStorage.setItem(EMAIL_KEY, email);
      setContactEmail(email);
      queryClient.invalidateQueries({ queryKey: ['portal-tickets', orgSlug] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const addComment = useMutation({
    mutationFn: (content: string) =>
      api.post(
        `/api/portal/tickets/${selectedTicketId}/comments`,
        { email: emailNormalized, content, orgSlug: orgSlug },
        { headers: { 'X-Portal-Token': token } }
      ),
    onSuccess: () => {
      setReply('');
      queryClient.invalidateQueries({ queryKey: ['portal-ticket', orgSlug, token, emailNormalized, selectedTicketId] });
      toast({ title: 'Mensagem enviada' });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const uploadAttachment = useMutation({
    mutationFn: async (file: File) => {
      const dataBase64 = await fileToBase64(file);
      return api.post(
        `/api/portal/tickets/${selectedTicketId}/attachments`,
        {
          email: emailNormalized,
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          dataBase64,
          orgSlug: orgSlug,
        },
        { headers: { 'X-Portal-Token': token } }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-ticket', orgSlug, token, emailNormalized, selectedTicketId] });
      toast({ title: 'Anexo enviado' });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const tickets = ticketsData?.data || [];
  const detail = detailData?.data;
  const articles = articlesData?.data || [];
  const portalDevices = devicesData?.data || [];
  const orgName = ticketsData?.meta?.orgName || articlesData?.meta?.orgName || orgSlug;
  const authError = useMemo(() => {
    const msg = (ticketsError || articlesError)?.message || '';
    if (msg.toLowerCase().includes('token')) return msg;
    return null;
  }, [ticketsError, articlesError]);

  if (!orgSlug) {
    return <p className="p-8 text-center text-muted-foreground">Organização não especificada</p>;
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full">
          <CardContent className="space-y-4 py-10">
            <ShieldAlert className="mx-auto h-10 w-10 text-destructive" />
            <h1 className="text-center text-lg font-semibold">Acesso ao portal restrito</h1>
            <p className="text-center text-sm text-muted-foreground">
              Cole o token fornecido pelo seu MSP (não use token na URL em produção).
            </p>
            <Input
              type="password"
              placeholder="Token do portal"
              id="portal-token-input"
            />
            <Button
              className="w-full"
              onClick={() => {
                const el = document.getElementById('portal-token-input') as HTMLInputElement | null;
                const t = el?.value?.trim() || '';
                if (!t) return;
                sessionStorage.setItem('nexaops_portal_token', t);
                window.location.reload();
              }}
            >
              Entrar
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
            <Monitor className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Portal do Cliente</h1>
            <p className="text-xs text-muted-foreground">{orgName}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 p-4">
        {authError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {authError}
          </div>
        )}

        {!selectedTicketId && (
          <div className="flex gap-1 rounded-lg border p-1 w-fit">
            <button
              className={cn('flex items-center gap-1 rounded-md px-3 py-1.5 text-sm', tab === 'tickets' && 'bg-muted font-medium')}
              onClick={() => setTab('tickets')}
            >
              <Ticket className="h-3.5 w-3.5" /> Meus Chamados
            </button>
            <button
              className={cn('flex items-center gap-1 rounded-md px-3 py-1.5 text-sm', tab === 'knowledge' && 'bg-muted font-medium')}
              onClick={() => setTab('knowledge')}
            >
              <BookOpen className="h-3.5 w-3.5" /> Base de Conhecimento
            </button>
            <button
              className={cn('flex items-center gap-1 rounded-md px-3 py-1.5 text-sm', tab === 'devices' && 'bg-muted font-medium')}
              onClick={() => setTab('devices')}
            >
              <Monitor className="h-3.5 w-3.5" /> Dispositivos
            </button>
          </div>
        )}

        {selectedTicketId ? (
          <div className="space-y-4">
            <Button variant="ghost" size="sm" className="gap-1 px-0" onClick={() => setSelectedTicketId(null)}>
              <ArrowLeft className="h-4 w-4" /> Voltar aos chamados
            </Button>
            {loadingDetail || !detail ? (
              <Skeleton className="h-48" />
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">#{detail.number} — {detail.title}</h2>
                    <p className="text-xs text-muted-foreground">{formatDate(detail.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={detail.priority === 'URGENT' ? 'critical' : 'secondary'}>{detail.priority}</Badge>
                    <StatusBadge status={detail.status} />
                  </div>
                </div>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Descrição</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                      {detail.description || 'Sem descrição'}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Mensagens</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {detail.comments.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhuma mensagem ainda</p>
                    ) : (
                      detail.comments.map((c) => (
                        <div key={c.id} className="rounded-lg border p-3">
                          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                            <span>{c.author.name}</span>
                            <span>{formatDate(c.createdAt)}</span>
                          </div>
                          <p className="whitespace-pre-wrap text-sm">{c.content}</p>
                        </div>
                      ))
                    )}
                    {detail.status !== 'CLOSED' && (
                      <form
                        className="space-y-2 border-t pt-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!reply.trim()) return;
                          addComment.mutate(reply.trim());
                        }}
                      >
                        <textarea
                          className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          placeholder="Responder..."
                          value={reply}
                          onChange={(e) => setReply(e.target.value)}
                          required
                        />
                        <Button type="submit" size="sm" disabled={addComment.isPending}>
                          Enviar
                        </Button>
                      </form>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Paperclip className="h-4 w-4" /> Anexos
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {detail.attachments.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhum anexo</p>
                    ) : (
                      <ul className="space-y-1 text-sm">
                        {detail.attachments.map((a) => (
                          <li key={a.id} className="flex justify-between gap-2 border-b py-2 last:border-0">
                            <span className="truncate font-medium">{a.fileName}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {a.sizeBytes != null ? `${Math.round(a.sizeBytes / 1024)} KB` : ''} · {formatDate(a.createdAt)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {detail.status !== 'CLOSED' && (
                      <Input
                        type="file"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) uploadAttachment.mutate(file);
                          e.target.value = '';
                        }}
                        disabled={uploadAttachment.isPending}
                      />
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        ) : tab === 'tickets' ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-sm flex-1">
                <label className="text-sm font-medium">Seu e-mail</label>
                <Input
                  type="email"
                  placeholder="para ver seus chamados"
                  value={contactEmail}
                  onChange={(e) => {
                    setContactEmail(e.target.value);
                    sessionStorage.setItem(EMAIL_KEY, e.target.value);
                  }}
                />
              </div>
              <Button size="sm" className="gap-1" onClick={() => {
                setTicketForm((f) => ({ ...f, email: contactEmail }));
                setShowCreate(true);
              }}>
                <Plus className="h-4 w-4" />
                Abrir Chamado
              </Button>
            </div>

            {!emailNormalized ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  Informe seu e-mail para listar apenas os seus chamados
                </CardContent>
              </Card>
            ) : loadingTickets ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : ticketsError && !authError ? (
              <Card>
                <CardContent className="py-12 text-center text-destructive">
                  {(ticketsError as Error).message}
                </CardContent>
              </Card>
            ) : tickets.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  Nenhum chamado aberto
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {tickets.map((ticket) => (
                  <Card
                    key={ticket.id}
                    className="cursor-pointer transition-colors hover:bg-muted/40"
                    onClick={() => setSelectedTicketId(ticket.id)}
                  >
                    <CardContent className="flex items-center justify-between p-4">
                      <div>
                        <p className="font-medium">#{ticket.number} — {ticket.title}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(ticket.createdAt)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={ticket.priority === 'URGENT' ? 'critical' : 'secondary'}>
                          {ticket.priority}
                        </Badge>
                        <StatusBadge status={ticket.status} />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        ) : tab === 'devices' ? (
          <div className="space-y-4">
            {!emailNormalized ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  Informe seu e-mail na aba Chamados para ver dispositivos dos seus sites
                </CardContent>
              </Card>
            ) : loadingDevices ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
              </div>
            ) : portalDevices.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  Nenhum dispositivo vinculado aos seus sites
                </CardContent>
              </Card>
            ) : (
              portalDevices.map((d) => (
                <Card key={d.id}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div>
                      <p className="font-medium">{d.name}</p>
                      <p className="text-xs text-muted-foreground">{d.site?.name || '—'}</p>
                    </div>
                    <StatusBadge status={d.status} />
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {loadingArticles ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)
            ) : articlesError ? (
              <Card>
                <CardContent className="py-12 text-center text-destructive">
                  {(articlesError as Error).message}
                </CardContent>
              </Card>
            ) : articles.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  Nenhum artigo disponível
                </CardContent>
              </Card>
            ) : (
              articles.map((article) => (
                <Card key={article.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{article.title}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {article.category || 'Geral'} · {formatDate(article.updatedAt)}
                    </p>
                  </CardHeader>
                </Card>
              ))
            )}
          </div>
        )}
      </main>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abrir Chamado</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              createTicket.mutate({ orgSlug: orgSlug!, ...ticketForm });
            }}
          >
            <div>
              <label className="text-sm font-medium">Seu e-mail *</label>
              <Input
                type="email"
                value={ticketForm.email}
                onChange={(e) => setTicketForm({ ...ticketForm, email: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium">Assunto *</label>
              <Input
                value={ticketForm.title}
                onChange={(e) => setTicketForm({ ...ticketForm, title: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium">Descrição *</label>
              <textarea
                className="mt-1 flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={ticketForm.description}
                onChange={(e) => setTicketForm({ ...ticketForm, description: e.target.value })}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={createTicket.isPending}>
              Enviar chamado
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
