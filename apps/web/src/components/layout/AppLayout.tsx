import { Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSocket } from '@/hooks/use-socket';
import { useToast } from '@/hooks/use-toast';
import {
  Plus,
  Download,
  AlertTriangle,
  Sun,
  Moon,
  LogOut,
  User,
  Settings,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Sidebar } from './Sidebar';
import { GlobalSearch } from './GlobalSearch';
import { NotificationPanel } from './NotificationPanel';
import { Button } from '@/components/ui/button';
import { useAuthStore, useThemeStore } from '@/stores';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function AppLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, logout } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();
  const { connected } = useSocket({
    onNewAlert: (alert) => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast({
        title: String(alert.title || 'Novo alerta'),
        description: String(alert.message || ''),
        variant: alert.severity === 'CRITICAL' ? 'destructive' : 'default',
      });
    },
  });

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur-md lg:px-6">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-1.5 shadow-sm">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Novo</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuItem onClick={() => navigate('/tickets')}>Novo Ticket</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/sites')}>Novo Site</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/devices')}>Instalar Agente</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <GlobalSearch />

          <div className="flex items-center gap-1">
            <div
              className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground lg:flex"
              title={connected ? 'Tempo real ativo' : 'Reconectando...'}
            >
              {connected ? (
                <Wifi className="h-3.5 w-3.5 text-success" />
              ) : (
                <WifiOff className="h-3.5 w-3.5 text-warning" />
              )}
              <span className="hidden xl:inline">{connected ? 'Online' : 'Offline'}</span>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="hidden gap-1.5 sm:flex"
              onClick={() => navigate('/devices')}
            >
              <Download className="h-4 w-4" />
              Agente
            </Button>

            <NotificationPanel />

            <Button variant="ghost" size="icon" onClick={() => navigate('/alerts')} title="Alertas">
              <AlertTriangle className="h-4 w-4" />
            </Button>

            <Button variant="ghost" size="icon" onClick={toggleTheme} title="Alternar tema">
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 pl-1">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-xs font-semibold text-primary-foreground shadow-sm">
                    {user?.name?.charAt(0)?.toUpperCase() || 'U'}
                  </div>
                  <span className="hidden max-w-[120px] truncate text-sm font-medium md:inline">
                    {user?.name?.split(' ')[0]}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-3 py-2">
                  <p className="text-sm font-medium">{user?.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {user?.organizationName}
                  </p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/settings/security')}>
                  <Settings className="mr-2 h-4 w-4" />
                  Segurança e equipe
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/admin/organization')}>
                  <User className="mr-2 h-4 w-4" />
                  Organização
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="page-container p-4 lg:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
