import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Monitor, Loader2, Shield, Zap, BarChart3, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useAuthStore } from '@/stores';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';

const features = [
  { icon: Monitor, title: 'Monitoramento RMM', desc: 'Dispositivos em tempo real' },
  { icon: Shield, title: 'PSA Integrado', desc: 'Tickets, SLA e clientes' },
  { icon: Zap, title: 'Automação', desc: 'Scripts e patches em massa' },
  { icon: BarChart3, title: 'Relatórios', desc: 'Compliance e métricas' },
];

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [requires2FA, setRequires2FA] = useState(false);
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const loadUser = useAuthStore((s) => s.loadUser);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const error = searchParams.get('error');
    const ssoCode = searchParams.get('code');
    const legacyAccess = searchParams.get('accessToken');
    const legacyRefresh = searchParams.get('refreshToken');

    if (error) {
      toast({ title: 'SSO falhou', description: error, variant: 'destructive' });
      return;
    }

    // Novo fluxo: código one-time (sem JWT na URL)
    if (ssoCode && searchParams.get('sso') === 'entra') {
      void (async () => {
        try {
          const res = await api.post<{
            success: boolean;
            data: { accessToken: string; refreshToken: string };
          }>('/api/auth/oidc/entra/exchange', { code: ssoCode });
          api.setTokens(res.data.accessToken, res.data.refreshToken);
          const url = new URL(window.location.href);
          url.searchParams.delete('code');
          url.searchParams.delete('sso');
          window.history.replaceState({}, '', url.pathname + url.search);
          await loadUser();
          navigate('/');
        } catch (err) {
          toast({
            title: 'SSO falhou',
            description: (err as Error).message,
            variant: 'destructive',
          });
        }
      })();
      return;
    }

    // Legado (remover em breve): tokens na query
    if (legacyAccess && legacyRefresh) {
      api.setTokens(legacyAccess, legacyRefresh);
      const url = new URL(window.location.href);
      url.searchParams.delete('accessToken');
      url.searchParams.delete('refreshToken');
      window.history.replaceState({}, '', url.pathname + url.search);
      void loadUser().then(() => navigate('/'));
    }
  }, [searchParams, loadUser, navigate, toast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password, totpCode || undefined);
      navigate('/');
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === '2FA_REQUIRED') {
        setRequires2FA(true);
      } else {
        toast({ title: 'Erro ao entrar', description: msg, variant: 'destructive' });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      <div className="login-gradient hidden flex-1 flex-col justify-between p-12 lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/25">
            <Monitor className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-bold">NexaOps</span>
        </div>

        <div className="space-y-8">
          <div>
            <h1 className="text-4xl font-bold leading-tight tracking-tight">
              Gestão de TI<br />
              <span className="text-primary">all-in-one</span>
            </h1>
            <p className="mt-4 max-w-md text-muted-foreground">
              Plataforma RMM + PSA para MSPs e equipes de TI. Monitore, automatize e atenda em um só lugar.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {features.map((f) => (
              <div key={f.title} className="rounded-xl border bg-card/50 p-4 backdrop-blur-sm">
                <f.icon className="mb-2 h-5 w-5 text-primary" />
                <p className="text-sm font-semibold">{f.title}</p>
                <p className="text-xs text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">© 2026 NexaOps. Todos os direitos reservados.</p>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-md border-0 shadow-xl lg:border lg:shadow-lg">
          <CardContent className="p-8">
            <div className="mb-8 text-center lg:text-left">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary shadow-md lg:mx-0">
                <Lock className="h-6 w-6 text-primary-foreground" />
              </div>
              <h2 className="text-2xl font-bold">Bem-vindo de volta</h2>
              <p className="text-sm text-muted-foreground">Entre na sua conta NexaOps</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">E-mail</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Senha</label>
                  <Link to="/forgot-password" className="text-xs text-primary hover:underline">
                    Esqueceu?
                  </Link>
                </div>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              {requires2FA && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Código 2FA</label>
                  <Input
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    maxLength={6}
                    placeholder="000000"
                    className="text-center tracking-[0.5em]"
                  />
                </div>
              )}
              <Button type="submit" className="w-full shadow-sm" disabled={loading} size="lg">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Entrar
              </Button>
            </form>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">ou</span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                window.location.href = `${import.meta.env.VITE_API_URL || ''}/api/auth/oidc/entra/start`;
              }}
            >
              Entrar com Microsoft (Entra)
            </Button>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              Não tem conta?{' '}
              <Link to="/register" className="font-medium text-primary hover:underline">
                Criar conta grátis
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
