import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Plus, RefreshCw, Pencil, Trash2 } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useCanWrite } from '@/hooks/use-permissions';

interface Article {
  id: string;
  title: string;
  content: string;
  category: string | null;
  visibility: string;
  updatedAt: string;
}

const emptyForm = {
  title: '',
  content: '',
  category: '',
  visibility: 'INTERNAL',
};

export function KnowledgePage() {
  const [search, setSearch] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canWrite = useCanWrite();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['knowledge'],
    queryFn: () => api.get<{ success: boolean; data: Article[] }>('/api/knowledge'),
  });

  const saveArticle = useMutation({
    mutationFn: () => {
      if (editingId) {
        return api.patch(`/api/knowledge/${editingId}`, form);
      }
      return api.post('/api/knowledge', form);
    },
    onSuccess: () => {
      toast({ title: editingId ? 'Artigo atualizado' : 'Artigo criado' });
      setShowDialog(false);
      setEditingId(null);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const deleteArticle = useMutation({
    mutationFn: (id: string) => api.delete(`/api/knowledge/${id}`),
    onSuccess: () => {
      toast({ title: 'Artigo removido' });
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const articles = (data?.data || []).filter((a) => {
    if (search && !a.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (visibilityFilter && a.visibility !== visibilityFilter) return false;
    return true;
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowDialog(true);
  };

  const openEdit = (article: Article) => {
    setEditingId(article.id);
    setForm({
      title: article.title,
      content: article.content,
      category: article.category || '',
      visibility: article.visibility,
    });
    setShowDialog(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Base de Conhecimento</h1>
          <p className="text-sm text-muted-foreground">Artigos internos e públicos</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          {canWrite && (
            <Button size="sm" className="gap-1" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Novo Artigo
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Buscar artigos..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Select value={visibilityFilter || 'all'} onValueChange={(v) => setVisibilityFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Visibilidade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="INTERNAL">Interno</SelectItem>
            <SelectItem value="PUBLIC">Público</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : articles.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-muted-foreground">
          <BookOpen className="mb-2 h-10 w-10 opacity-50" />
          Nenhum artigo encontrado
        </div>
      ) : (
        <div className="space-y-2">
          {articles.map((article) => (
            <div key={article.id} className="rounded-lg border">
              <div className="flex items-center gap-2 p-4">
                <button
                  className="flex flex-1 items-center justify-between text-left hover:opacity-80"
                  onClick={() => setExpandedId(expandedId === article.id ? null : article.id)}
                >
                  <div>
                    <p className="font-medium">{article.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {article.category || 'Sem categoria'} · Atualizado {formatDate(article.updatedAt)}
                    </p>
                  </div>
                  <Badge variant={article.visibility === 'PUBLIC' ? 'info' : 'secondary'}>
                    {article.visibility === 'PUBLIC' ? 'Público' : 'Interno'}
                  </Badge>
                </button>
                {canWrite && (
                  <>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(article)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => {
                        if (confirm('Remover este artigo?')) deleteArticle.mutate(article.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
              {expandedId === article.id && (
                <div className="border-t p-4 text-sm whitespace-pre-wrap text-muted-foreground">
                  {article.content}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Artigo' : 'Novo Artigo'}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveArticle.mutate();
            }}
          >
            <div>
              <label className="text-sm font-medium">Título *</label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Categoria</label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">Visibilidade</label>
                <Select value={form.visibility} onValueChange={(v) => setForm({ ...form, visibility: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INTERNAL">Interno</SelectItem>
                    <SelectItem value="PUBLIC">Público</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Conteúdo *</label>
              <textarea
                className="mt-1 flex min-h-[150px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={saveArticle.isPending}>
              {editingId ? 'Salvar alterações' : 'Publicar artigo'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
