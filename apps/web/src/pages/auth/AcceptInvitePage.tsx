import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Monitor, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores';
import { useToast } from '@/hooks/use-toast';

export function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast({ title: 'Erro', description: 'As senhas não coincidem', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const res = await api.post<{
        success: boolean;
        data: { user: import('@nexaops/shared').AuthUser; tokens: { accessToken: string; refreshToken: string } };
      }>('/api/auth/accept-invite', { token, password });

      api.setTokens(res.data.tokens.accessToken, res.data.tokens.refreshToken);
      useAuthStore.setState({ user: res.data.user, isAuthenticated: true, isLoading: false });
      toast({ title: 'Convite aceito', description: 'Bem-vindo à equipe!' });
      navigate('/');
    } catch (err) {
      toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground">Convite inválido ou expirado.</p>
            <Link to="/login" className="mt-4 inline-block text-sm text-primary hover:underline">
              Ir para login
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Monitor className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl">Aceitar Convite</CardTitle>
          <p className="text-sm text-muted-foreground">Defina sua senha para entrar na organização</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium">Senha</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium">Confirmar senha</label>
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Aceitar convite
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
