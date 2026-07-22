import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MessageSquare, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBadge } from '@/components/ModulePage';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useCanWrite } from '@/hooks/use-permissions';

interface Comment {
  id: string;
  content: string;
  type: 'INTERNAL' | 'CUSTOMER';
  createdAt: string;
  author: { name: string };
}

interface Attachment {
  id: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  storageKey: string | null;
  createdAt: string;
  uploadedBy: string | null;
}

interface TicketDetail {
  id: string;
  number: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  createdAt: string;
  slaDeadline: string | null;
  site: { name: string } | null;
  device: { name: string } | null;
  assignee: { id: string; name: string; email: string } | null;
  creator: { name: string };
  comments: Comment[];
  attachments: Attachment[];
}

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

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canWrite = useCanWrite();

  const [comment, setComment] = useState('');
  const [commentType, setCommentType] = useState<'INTERNAL' | 'CUSTOMER'>('INTERNAL');

  const { data, isLoading } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api.get<{ success: boolean; data: TicketDetail }>(`/api/tickets/${id}`),
    enabled: !!id,
  });

  const updateTicket = useMutation({
    mutationFn: (body: { status?: string; priority?: string }) =>
      api.patch(`/api/tickets/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      toast({ title: 'Ticket atualizado' });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const addComment = useMutation({
    mutationFn: (body: { content: string; type: string }) =>
      api.post(`/api/tickets/${id}/comments`, body),
    onSuccess: () => {
      setComment('');
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      toast({ title: 'Comentário adicionado' });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const uploadAttachment = useMutation({
    mutationFn: async (file: File) => {
      const dataBase64 = await fileToBase64(file);
      return api.post(`/api/tickets/${id}/attachments`, {
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        dataBase64,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      toast({ title: 'Anexo enviado' });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const downloadAttachment = async (attachmentId: string, fileName: string) => {
    try {
      const res = await api.get<{
        success: boolean;
        data: { url?: string; dataBase64?: string; contentType?: string; fileName?: string };
      }>(`/api/tickets/${id}/attachments/${attachmentId}/download`);
      const payload = res.data;
      if (payload.url) {
        window.open(payload.url, '_blank', 'noopener,noreferrer');
        return;
      }
      if (payload.dataBase64) {
        const a = document.createElement('a');
        a.href = `data:${payload.contentType || 'application/octet-stream'};base64,${payload.dataBase64}`;
        a.download = payload.fileName || fileName;
        a.click();
        return;
      }
      throw new Error('Conteúdo indisponível');
    } catch (err) {
      toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const ticket = data?.data;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (!ticket) {
    return <p className="text-muted-foreground">Ticket não encontrado</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/tickets')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">#{ticket.number} — {ticket.title}</h1>
            <StatusBadge status={ticket.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            Criado por {ticket.creator.name} · {formatDate(ticket.createdAt)}
            {ticket.slaDeadline && ` · SLA: ${formatDate(ticket.slaDeadline)}`}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Descrição</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {ticket.description || 'Sem descrição'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquare className="h-4 w-4" />
                Comentários ({ticket.comments.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {ticket.comments.map((c) => (
                <div key={c.id} className="rounded-lg border p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{c.author.name}</span>
                      <Badge variant={c.type === 'INTERNAL' ? 'secondary' : 'info'}>
                        {c.type === 'INTERNAL' ? 'Interno' : 'Cliente'}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatDate(c.createdAt)}</span>
                  </div>
                  <p className="text-sm">{c.content}</p>
                </div>
              ))}

              {canWrite && (
                <form
                  className="space-y-3 border-t pt-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!comment.trim()) return;
                    addComment.mutate({ content: comment, type: commentType });
                  }}
                >
                  <div className="flex gap-2">
                    <Select value={commentType} onValueChange={(v) => setCommentType(v as 'INTERNAL' | 'CUSTOMER')}>
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="INTERNAL">Interno</SelectItem>
                        <SelectItem value="CUSTOMER">Cliente</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <textarea
                    className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder="Adicionar comentário..."
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    required
                  />
                  <Button type="submit" size="sm" disabled={addComment.isPending}>
                    Enviar comentário
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Paperclip className="h-4 w-4" />
                Anexos ({ticket.attachments?.length || 0})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(ticket.attachments || []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum anexo</p>
              ) : (
                <ul className="space-y-2">
                  {ticket.attachments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{a.fileName}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.sizeBytes != null ? `${Math.round(a.sizeBytes / 1024)} KB` : '—'} · {formatDate(a.createdAt)}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => downloadAttachment(a.id, a.fileName)}>
                        Baixar
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {canWrite && (
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
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Detalhes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground">Status</label>
                {canWrite ? (
                  <Select
                    value={ticket.status}
                    onValueChange={(v) => updateTicket.mutate({ status: v })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OPEN">Aberto</SelectItem>
                      <SelectItem value="PENDING">Pendente</SelectItem>
                      <SelectItem value="RESOLVED">Resolvido</SelectItem>
                      <SelectItem value="CLOSED">Fechado</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="mt-1 text-sm"><StatusBadge status={ticket.status} /></p>
                )}
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Prioridade</label>
                {canWrite ? (
                  <Select
                    value={ticket.priority}
                    onValueChange={(v) => updateTicket.mutate({ priority: v })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LOW">Baixa</SelectItem>
                      <SelectItem value="MEDIUM">Média</SelectItem>
                      <SelectItem value="HIGH">Alta</SelectItem>
                      <SelectItem value="URGENT">Urgente</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="mt-1 text-sm">{ticket.priority}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Site</p>
                <p className="text-sm">{ticket.site?.name || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Dispositivo</p>
                <p className="text-sm">{ticket.device?.name || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Técnico responsável</p>
                <p className="text-sm">{ticket.assignee?.name || 'Não atribuído'}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
