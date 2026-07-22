import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Shield, UserPlus, Loader2, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores';
import { useToast } from '@/hooks/use-toast';

export function SecurityPage() {
  const user = useAuthStore((s) => s.user);
  const loadUser = useAuthStore((s) => s.loadUser);
  const { toast } = useToast();

  const [totpCode, setTotpCode] = useState('');
  const [inviteForm, setInviteForm] = useState({ email: '', name: '', role: 'TECHNICIAN' });

  const { data: setupData, refetch: setup2FA } = useQuery({
    queryKey: ['2fa-setup'],
    queryFn: () => api.post<{ success: boolean; data: { secret: string; qrCode: string } }>('/api/auth/2fa/setup'),
    enabled: false,
  });

  const enable2FA = useMutation({
    mutationFn: (code: string) => api.post('/api/auth/2fa/enable', { totpCode: code }),
    onSuccess: async () => {
      toast({ title: '2FA ativado com sucesso' });
      setTotpCode('');
      await loadUser();
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const inviteMember = useMutation({
    mutationFn: (body: typeof inviteForm) => api.post('/api/auth/invite', body),
    onSuccess: () => {
      toast({ title: 'Convite enviado', description: `E-mail enviado para ${inviteForm.email}` });
      setInviteForm({ email: '', name: '', role: 'TECHNICIAN' });
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const savePrefs = useMutation({
    mutationFn: (body: { notifyCriticalAlerts?: boolean; notifyAlertSeverities?: string }) =>
      api.patch('/api/auth/me/preferences', body),
    onSuccess: async () => {
      toast({ title: 'Preferências salvas' });
      await loadUser();
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const qrCode = setupData?.data?.qrCode;
  const secret = setupData?.data?.secret;
  const notifyOn = user?.notifyCriticalAlerts !== false;
  const severities = new Set(
    (user?.notifyAlertSeverities || 'CRITICAL')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  );

  const toggleSeverity = (sev: string) => {
    const next = new Set(severities);
    if (next.has(sev)) next.delete(sev);
    else next.add(sev);
    if (next.size === 0) next.add('CRITICAL');
    savePrefs.mutate({ notifyAlertSeverities: [...next].join(',') });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Segurança</h1>
        <p className="text-sm text-muted-foreground">Autenticação em duas etapas, alertas e gestão de equipe</p>
      </div>

      {user?.mustEnable2FA && (
        <Card className="border-warning/50 bg-warning/10">
          <CardContent className="pt-6 text-sm">
            Sua organização exige autenticação em duas etapas. Ative o 2FA abaixo para continuar em conformidade.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" />
            E-mail de alertas
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Receba e-mail quando alertas forem criados (requer SMTP). Webhook da org cobre Slack/Teams.
          </p>
          <div className="flex items-center gap-3">
            <Button
              variant={notifyOn ? 'default' : 'outline'}
              size="sm"
              disabled={savePrefs.isPending}
              onClick={() => savePrefs.mutate({ notifyCriticalAlerts: true })}
            >
              Ativado
            </Button>
            <Button
              variant={!notifyOn ? 'default' : 'outline'}
              size="sm"
              disabled={savePrefs.isPending}
              onClick={() => savePrefs.mutate({ notifyCriticalAlerts: false })}
            >
              Desativado
            </Button>
          </div>
          {notifyOn && (
            <div className="flex flex-wrap gap-2 pt-1">
              {(['CRITICAL', 'WARNING', 'INFO'] as const).map((sev) => (
                <Button
                  key={sev}
                  variant={severities.has(sev) ? 'default' : 'outline'}
                  size="sm"
                  disabled={savePrefs.isPending}
                  onClick={() => toggleSeverity(sev)}
                >
                  {sev}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4" />
            Autenticação em Duas Etapas (2FA)
            {user?.twoFactorEnabled && <Badge variant="success">Ativo</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {user?.twoFactorEnabled ? (
            <p className="text-sm text-muted-foreground">
              A autenticação em duas etapas está ativa na sua conta.
            </p>
          ) : (
            <>
              {!qrCode ? (
                <Button onClick={() => setup2FA()}>Configurar 2FA</Button>
              ) : (
                <div className="space-y-4">
                  <img src={qrCode} alt="QR Code 2FA" className="mx-auto h-48 w-48 rounded-lg border" />
                  <p className="text-center text-xs text-muted-foreground font-mono">{secret}</p>
                  <Input
                    placeholder="Código do autenticador"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                  />
                  <Button
                    className="w-full"
                    disabled={enable2FA.isPending || totpCode.length < 6}
                    onClick={() => enable2FA.mutate(totpCode)}
                  >
                    {enable2FA.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Ativar 2FA
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {user?.role === 'ADMIN' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4" />
              Convidar membro
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                inviteMember.mutate(inviteForm);
              }}
            >
              <div>
                <label className="text-sm font-medium">E-mail</label>
                <Input
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium">Nome</label>
                <Input
                  value={inviteForm.name}
                  onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium">Papel</label>
                <Select
                  value={inviteForm.role}
                  onValueChange={(v) => setInviteForm({ ...inviteForm, role: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ADMIN">Administrador</SelectItem>
                    <SelectItem value="TECHNICIAN">Técnico</SelectItem>
                    <SelectItem value="READ_ONLY">Somente leitura</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={inviteMember.isPending}>
                {inviteMember.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Enviar convite
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
