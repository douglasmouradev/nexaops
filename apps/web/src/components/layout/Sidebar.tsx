import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Ticket,
  Building2,
  Monitor,
  Bell,
  Shield,
  Package,
  FileCode,
  Radar,
  BarChart3,
  MoreHorizontal,
  BookOpen,
  Gift,
  Sparkles,
  Grid3X3,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FileText,
  MonitorSmartphone,
  Workflow,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore, useSidebarStore } from '@/stores';
import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  badge?: string;
  children?: { label: string; path: string }[];
}

const mainNav: NavItem[] = [
  { label: 'Painel', path: '/', icon: LayoutDashboard },
  { label: 'Tickets', path: '/tickets', icon: Ticket },
  { label: 'Sites', path: '/sites', icon: Building2 },
  { label: 'Dispositivos', path: '/devices', icon: Monitor },
  { label: 'Acesso remoto', path: '/remote-sessions', icon: MonitorSmartphone },
  { label: 'Alertas', path: '/alerts', icon: Bell },
  { label: 'Gestão de Patch', path: '/patches', icon: Shield },
  { label: 'Scripts', path: '/scripts', icon: FileCode },
  { label: 'Automações', path: '/automations', icon: Workflow },
  { label: 'Inventário de Ativos', path: '/assets', icon: Package, badge: 'Novo' },
  { label: 'Descoberta de Rede', path: '/network', icon: Radar },
  {
    label: 'Relatórios',
    path: '/reports',
    icon: BarChart3,
    children: [
      { label: 'Dispositivos', path: '/reports/devices' },
      { label: 'Tickets / SLA', path: '/reports/tickets-sla' },
      { label: 'Patch / Compliance', path: '/reports/patch-compliance' },
      { label: 'Financeiros', path: '/reports/financial' },
    ],
  },
  {
    label: 'Finanças',
    path: '/finance',
    icon: FileText,
    children: [
      { label: 'Contratos', path: '/finance/contracts' },
      { label: 'Faturamento', path: '/finance/billing' },
    ],
  },
];

const bottomNav: NavItem[] = [
  { label: 'Centro de IA', path: '/ai-center', icon: Sparkles, badge: 'Novo' },
  { label: 'Centro de Aplicativos', path: '/app-center', icon: Grid3X3 },
  {
    label: 'Administração',
    path: '/admin',
    icon: Settings,
    children: [
      { label: 'Usuários', path: '/admin/users' },
      { label: 'Perfis de Limite', path: '/admin/thresholds' },
      { label: 'Organização', path: '/admin/organization' },
      { label: 'Log de Auditoria', path: '/admin/audit' },
    ],
  },
];

function NavItemLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const location = useLocation();
  const [expanded, setExpanded] = useState(
    item.children?.some((c) => location.pathname.startsWith(c.path)) ?? false
  );
  const Icon = item.icon;
  const isActive = item.children
    ? item.children.some((c) => location.pathname === c.path)
    : location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));

  if (item.children) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all',
            isActive
              ? 'bg-sidebar-accent/15 text-sidebar-accent'
              : 'text-sidebar-foreground hover:bg-sidebar-border/40'
          )}
        >
          <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-sidebar-accent')} />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">{item.label}</span>
              <ChevronDown className={cn('h-3 w-3 opacity-60 transition-transform', expanded && 'rotate-180')} />
            </>
          )}
        </button>
        {!collapsed && expanded && (
          <div className="ml-4 mt-1 space-y-0.5 border-l border-sidebar-border/60 pl-3">
            {item.children.map((child) => (
              <NavLink
                key={child.path}
                to={child.path}
                className={({ isActive }) =>
                  cn(
                    'block rounded-md px-3 py-1.5 text-xs transition-colors',
                    isActive
                      ? 'bg-sidebar-accent/20 font-medium text-sidebar-accent'
                      : 'text-sidebar-foreground/60 hover:bg-sidebar-border/30 hover:text-sidebar-foreground'
                  )
                }
              >
                {child.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all',
          isActive
            ? 'bg-sidebar-accent/20 font-medium text-sidebar-accent shadow-sm shadow-sidebar-accent/10'
            : 'text-sidebar-foreground hover:bg-sidebar-border/40'
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1">{item.label}</span>
          {item.badge && (
            <span className="rounded-md bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-bold text-white">
              {item.badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  const { collapsed, toggle } = useSidebarStore();
  const user = useAuthStore((s) => s.user);

  return (
    <aside
      className={cn(
        'flex h-screen flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sidebar-accent to-sidebar-accent/70 shadow-md shadow-sidebar-accent/20">
          <Monitor className="h-4 w-4 text-white" />
        </div>
        {!collapsed && (
          <div>
            <span className="text-base font-bold text-white">NexaOps</span>
            <p className="text-[10px] text-sidebar-foreground/50">RMM + PSA</p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {mainNav.map((item) => (
          <NavItemLink key={item.path} item={item} collapsed={collapsed} />
        ))}

        {!collapsed && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-border/40">
                <MoreHorizontal className="h-4 w-4" />
                <span>Mais</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-48">
              <DropdownMenuItem asChild>
                <NavLink to="/knowledge" className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4" /> Base de Conhecimento
                </NavLink>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <NavLink to="/referrals" className="flex items-center gap-2">
                  <Gift className="h-4 w-4" /> Indique um Amigo
                </NavLink>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </nav>

      <div className="space-y-0.5 border-t border-sidebar-border p-3">
        {bottomNav.map((item) => (
          <NavItemLink key={item.path} item={item} collapsed={collapsed} />
        ))}
      </div>

      {!collapsed && user && (
        <div className="border-t border-sidebar-border px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent/30 text-xs font-semibold text-sidebar-accent">
              {user.name?.charAt(0)?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-sidebar-foreground">{user.name}</p>
              <p className="truncate text-[10px] text-sidebar-foreground/50">{user.organizationName}</p>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={toggle}
        className="flex h-10 items-center justify-center border-t border-sidebar-border text-sidebar-foreground/60 transition-colors hover:bg-sidebar-border/40 hover:text-sidebar-foreground"
        title={collapsed ? 'Expandir menu' : 'Recolher menu'}
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>
    </aside>
  );
}
