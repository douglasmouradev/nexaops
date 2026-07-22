import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Sparkles, Coins, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

interface AiFeature {
  feature: string;
  enabled: boolean;
}

interface AiUsage {
  id: string;
  feature: string;
  credits: number;
  createdAt: string;
}

interface AiCenterData {
  features: AiFeature[];
  usage: AiUsage[];
  credits: number | null;
}

export function AiCenterPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [prompt, setPrompt] = useState('');
  const [reply, setReply] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['ai-center'],
    queryFn: () => api.get<{ success: boolean; data: AiCenterData }>('/api/ai'),
  });

  const toggleFeature = useMutation({
    mutationFn: ({ feature, enabled }: { feature: string; enabled: boolean }) =>
      api.patch(`/api/ai/features/${feature}`, { enabled }),
    onSuccess: () => {
      toast({ title: 'Funcionalidade atualizada' });
      queryClient.invalidateQueries({ queryKey: ['ai-center'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const assist = useMutation({
    mutationFn: (text: string) =>
      api.post<{ success: boolean; data: { reply: string; credits: number } }>('/api/ai/assist', {
        prompt: text,
      }),
    onSuccess: (res) => {
      setReply(res.data.reply);
      toast({ title: 'Resposta gerada', description: `${res.data.credits} créditos restantes` });
      queryClient.invalidateQueries({ queryKey: ['ai-center'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const payload = data?.data;
  const features = payload?.features || [];
  const usage = payload?.usage || [];
  const credits = payload?.credits ?? 0;

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
        title="Centro de IA"
        description="Funcionalidades de inteligência artificial"
        icon={Sparkles}
      />

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Coins className="h-4 w-4" />
            Créditos disponíveis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold tabular-nums">{credits}</p>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base">Assistente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Descreva sua dúvida ou peça uma sugestão..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <Button
            className="gap-1"
            disabled={!prompt.trim() || assist.isPending || credits < 1}
            onClick={() => assist.mutate(prompt.trim())}
          >
            <Send className="h-4 w-4" />
            {assist.isPending ? 'Gerando...' : 'Perguntar (1 crédito)'}
          </Button>
          {reply && (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
              {reply}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base">Funcionalidades</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {features.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma funcionalidade configurada</p>
            ) : (
              features.map((f) => (
                <div key={f.feature} className="flex items-center justify-between rounded border p-3">
                  <div>
                    <p className="text-sm font-medium">{f.feature}</p>
                    <Badge variant={f.enabled ? 'success' : 'secondary'} className="mt-1">
                      {f.enabled ? 'Ativa' : 'Desativada'}
                    </Badge>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={toggleFeature.isPending}
                    onClick={() => toggleFeature.mutate({ feature: f.feature, enabled: !f.enabled })}
                  >
                    {f.enabled ? 'Desativar' : 'Ativar'}
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base">Uso recente</CardTitle>
          </CardHeader>
          <CardContent>
            {usage.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum uso registrado</p>
            ) : (
              <div className="space-y-2">
                {usage.map((u) => (
                  <div key={u.id} className="flex items-center justify-between border-b border-border/50 py-2 last:border-0">
                    <div>
                      <p className="text-sm font-medium">{u.feature}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(u.createdAt)}</p>
                    </div>
                    <span className="text-sm tabular-nums">{u.credits} créd.</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
