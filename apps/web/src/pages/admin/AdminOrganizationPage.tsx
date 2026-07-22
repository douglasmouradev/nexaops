import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Check, Building2, Key, Link2, Users, RefreshCw, Webhook } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

interface Org {
  id: string;
  name: string;
  slug: string;
  agentToken: string;
  portalToken: string;
  referralCode: string;
  billingEmail: string | null;
  plan: string;
  aiCredits: number;
  alertWebhookUrl: string | null;
  agentMinVersion: string | null;
  requireTwoFactor: boolean;
  createdAt: string;
}

export function AdminOrganizationPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [minVersion, setMinVersion] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['organization'],
    queryFn: () => api.get<{ success: boolean; data: Org }>('/api/admin/organization'),
  });

  const org = data?.data;

  useEffect(() => {
    if (org) {
      setWebhookUrl(org.alertWebhookUrl || '');
      setMinVersion(org.agentMinVersion || '');
    }
  }, [org?.id, org?.alertWebhookUrl, org?.agentMinVersion]);

  const rotateToken = useMutation({
    mutationFn: (type: 'agent' | 'portal') =>
      api.post<{ success: boolean; data: { token: string } }>('/api/admin/organization/rotate-token', { type }),
    onSuccess: (_res, type) => {
      toast({
        title: 'Token regenerado',
        description: type === 'agent' ? 'Token do agente atualizado' : 'Token do portal atualizado',
      });
      queryClient.invalidateQueries({ queryKey: ['organization'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const saveWebhook = useMutation({
    mutationFn: (alertWebhookUrl: string) =>
      api.patch('/api/admin/organization', { alertWebhookUrl: alertWebhookUrl || null }),
    onSuccess: () => {
      toast({ title: 'Webhook salvo' });
      queryClient.invalidateQueries({ queryKey: ['organization'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const saveMinVersion = useMutation({
    mutationFn: (agentMinVersion: string) =>
      api.patch('/api/admin/organization', { agentMinVersion: agentMinVersion || null }),
    onSuccess: () => {
      toast({ title: 'Versão mínima do agent salva' });
      queryClient.invalidateQueries({ queryKey: ['organization'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const saveRequire2FA = useMutation({
    mutationFn: (requireTwoFactor: boolean) =>
      api.patch('/api/admin/organization', { requireTwoFactor }),
    onSuccess: () => {
      toast({ title: 'Política de 2FA atualizada' });
      queryClient.invalidateQueries({ queryKey: ['organization'] });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    toast({ title: 'Copiado!', description: label });
    setTimeout(() => setCopied(null), 2000);
  };

  if (isLoading) {
    return <Skeleton className="h-64" />;
  }

  if (!org) return null;

  const portalBaseUrl = `${window.location.origin}/portal/${org.slug}`;
  const portalToken = org.portalToken;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organização"
        description="Configurações da sua empresa MSP"
        icon={Building2}
        breadcrumb="Administração"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base">Dados da empresa</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { label: 'Nome', value: org.name },
              { label: 'Slug', value: org.slug },
              { label: 'Plano', value: org.plan },
              { label: 'E-mail faturamento', value: org.billingEmail || '—' },
              { label: 'Créditos IA', value: String(org.aiCredits) },
            ].map((row) => (
              <div key={row.label} className="flex justify-between border-b border-border/50 pb-3 last:border-0">
                <span className="text-sm text-muted-foreground">{row.label}</span>
                <span className="text-sm font-medium capitalize">{row.value}</span>
              </div>
            ))}
            <Badge variant="success">Ativa</Badge>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Webhook className="h-4 w-4" />
              Webhook de alertas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              URL do Slack Incoming Webhook, Teams ou qualquer endpoint que aceite JSON POST.
            </p>
            <Input
              placeholder="https://hooks.slack.com/services/..."
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
            />
            <Button
              size="sm"
              disabled={saveWebhook.isPending}
              onClick={() => saveWebhook.mutate(webhookUrl.trim())}
            >
              Salvar webhook
            </Button>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base">2FA obrigatório</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Quando ativo, a API e o painel bloqueiam o uso até o usuário ativar TOTP em Segurança.
            </p>
            <div className="flex items-center gap-2">
              <Badge variant={org.requireTwoFactor ? 'warning' : 'secondary'}>
                {org.requireTwoFactor ? 'Obrigatório' : 'Opcional'}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                disabled={saveRequire2FA.isPending}
                onClick={() => saveRequire2FA.mutate(!org.requireTwoFactor)}
              >
                {org.requireTwoFactor ? 'Tornar opcional' : 'Exigir 2FA'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base">Versão mínima do agent</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Agents abaixo desta versão recebem update automático no heartbeat (ex: 0.5.0).
            </p>
            <Input
              placeholder="0.5.0"
              value={minVersion}
              onChange={(e) => setMinVersion(e.target.value)}
            />
            <Button
              size="sm"
              disabled={saveMinVersion.isPending}
              onClick={() => saveMinVersion.mutate(minVersion.trim())}
            >
              Salvar versão mínima
            </Button>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Key className="h-4 w-4" />
              Token do agente
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Use este token para registrar dispositivos com o agente NexaOps.
            </p>
            <div className="relative rounded-lg bg-muted/50 p-3">
              <code className="break-all text-xs">{org.agentToken}</code>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-2 h-7 w-7"
                onClick={() => copy(org.agentToken, 'Token do agente')}
              >
                {copied === 'Token do agente' ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Comando de instalação</p>
              <code className="block break-all text-xs">
                node apps/agent/index.js --token={org.agentToken}
              </code>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={rotateToken.isPending}
              onClick={() => {
                if (confirm('Regenerar o token do agente? Agentes com o token antigo deixarão de autenticar.')) {
                  rotateToken.mutate('agent');
                }
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Regenerar token do agente
            </Button>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 className="h-4 w-4" />
              Portal do cliente
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Envie o link e o token separadamente. O portal usa o header{' '}
              <code className="text-xs">X-Portal-Token</code> (a UI guarda o token após o primeiro acesso).
            </p>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">URL (sem token)</p>
              <div className="relative rounded-lg bg-muted/50 p-3 pr-10">
                <code className="break-all text-xs">{portalBaseUrl}</code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-2 h-7 w-7"
                  onClick={() => copy(portalBaseUrl, 'URL do portal')}
                >
                  {copied === 'URL do portal' ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Token do portal</p>
              <div className="relative rounded-lg bg-muted/50 p-3 pr-10">
                <code className="break-all text-xs">{portalToken}</code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-2 h-7 w-7"
                  onClick={() => copy(portalToken, 'Token do portal')}
                >
                  {copied === 'Token do portal' ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Compatibilidade: <code className="text-[10px]">{portalBaseUrl}?token=…</code> só se{' '}
              <code className="text-[10px]">PORTAL_ALLOW_QUERY_TOKEN=true</code>.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={rotateToken.isPending}
              onClick={() => {
                if (confirm('Regenerar o token do portal? Links antigos deixarão de funcionar.')) {
                  rotateToken.mutate('portal');
                }
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Regenerar token do portal
            </Button>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" />
              Indicação
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">Código de indicação da organização</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg bg-muted/50 p-3 text-sm font-mono">{org.referralCode}</code>
              <Button variant="outline" size="sm" onClick={() => copy(org.referralCode, 'Código de indicação')}>
                Copiar
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
