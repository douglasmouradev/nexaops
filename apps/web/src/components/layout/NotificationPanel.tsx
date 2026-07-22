import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, AlertTriangle, Ticket, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Notification {
  id: string;
  type: 'alert' | 'ticket';
  title: string;
  subtitle?: string;
  severity?: string;
  createdAt: string;
  href: string;
}

export function NotificationPanel() {
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ success: boolean; data: Notification[] }>('/api/notifications'),
    refetchInterval: 30000,
  });

  const notifications = data?.data || [];
  const unread = notifications.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3">
          <p className="font-semibold">Notificações</p>
          <p className="text-xs text-muted-foreground">{unread} item(ns) recente(s)</p>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <Check className="h-8 w-8 text-success/60" />
              <p className="text-sm text-muted-foreground">Tudo em ordem</p>
            </div>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => navigate(n.href)}
                className="flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-muted/50 last:border-0"
              >
                <div className={`mt-0.5 rounded-md p-1.5 ${n.type === 'alert' ? 'bg-destructive/10 text-destructive' : 'bg-info/10 text-info'}`}>
                  {n.type === 'alert' ? <AlertTriangle className="h-3.5 w-3.5" /> : <Ticket className="h-3.5 w-3.5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{n.title}</p>
                  {n.subtitle && <p className="truncate text-xs text-muted-foreground">{n.subtitle}</p>}
                  <p className="mt-1 text-[10px] text-muted-foreground">{formatRelative(n.createdAt)}</p>
                </div>
                {n.severity === 'CRITICAL' && <Badge variant="critical" className="text-[10px]">!</Badge>}
              </button>
            ))
          )}
        </div>
        {notifications.length > 0 && (
          <div className="border-t p-2">
            <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => navigate('/alerts')}>
              Ver todos os alertas
            </Button>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
