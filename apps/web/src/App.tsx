import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ToastContextProvider } from '@/hooks/use-toast';
import { useAuthStore } from '@/stores';

const LoginPage = lazy(() =>
  import('@/pages/auth/LoginPage').then((m) => ({ default: m.LoginPage }))
);
const RegisterPage = lazy(() =>
  import('@/pages/auth/RegisterPage').then((m) => ({ default: m.RegisterPage }))
);
const ForgotPasswordPage = lazy(() =>
  import('@/pages/auth/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage }))
);
const ResetPasswordPage = lazy(() =>
  import('@/pages/auth/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage }))
);
const AcceptInvitePage = lazy(() =>
  import('@/pages/auth/AcceptInvitePage').then((m) => ({ default: m.AcceptInvitePage }))
);
const SecurityPage = lazy(() =>
  import('@/pages/auth/SecurityPage').then((m) => ({ default: m.SecurityPage }))
);
const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage }))
);
const DevicesPage = lazy(() =>
  import('@/pages/DevicesPage').then((m) => ({ default: m.DevicesPage }))
);
const DeviceDetailPage = lazy(() =>
  import('@/pages/DeviceDetailPage').then((m) => ({ default: m.DeviceDetailPage }))
);
const TicketDetailPage = lazy(() =>
  import('@/pages/tickets/TicketDetailPage').then((m) => ({ default: m.TicketDetailPage }))
);
const SiteDetailPage = lazy(() =>
  import('@/pages/sites/SiteDetailPage').then((m) => ({ default: m.SiteDetailPage }))
);
const ScriptsPage = lazy(() =>
  import('@/pages/scripts/ScriptsPage').then((m) => ({ default: m.ScriptsPage }))
);
const PortalPage = lazy(() =>
  import('@/pages/portal/PortalPage').then((m) => ({ default: m.PortalPage }))
);
const RemoteSessionsPage = lazy(() =>
  import('@/pages/remote/RemoteSessionsPage').then((m) => ({ default: m.RemoteSessionsPage }))
);
const AutomationsPage = lazy(() =>
  import('@/pages/AutomationsPage').then((m) => ({ default: m.AutomationsPage }))
);
const TicketsPage = lazy(() =>
  import('@/pages/modules').then((m) => ({ default: m.TicketsPage }))
);
const SitesPage = lazy(() =>
  import('@/pages/modules').then((m) => ({ default: m.SitesPage }))
);
const AlertsPage = lazy(() =>
  import('@/pages/modules').then((m) => ({ default: m.AlertsPage }))
);
const PatchesPage = lazy(() =>
  import('@/pages/modules').then((m) => ({ default: m.PatchesPage }))
);
const AssetsPage = lazy(() =>
  import('@/pages/modules').then((m) => ({ default: m.AssetsPage }))
);
const NetworkPage = lazy(() =>
  import('@/pages/modules').then((m) => ({ default: m.NetworkPage }))
);
const KnowledgePage = lazy(() =>
  import('@/pages/modules').then((m) => ({ default: m.KnowledgePage }))
);
const ReferralsPage = lazy(() =>
  import('@/pages/modules').then((m) => ({ default: m.ReferralsPage }))
);
const AiCenterPage = lazy(() =>
  import('@/pages/modules').then((m) => ({ default: m.AiCenterPage }))
);
const AppCenterPage = lazy(() =>
  import('@/pages/modules').then((m) => ({ default: m.AppCenterPage }))
);
const AdminUsersPage = lazy(() =>
  import('@/pages/modules').then((m) => ({ default: m.AdminUsersPage }))
);
const AdminThresholdsPage = lazy(() =>
  import('@/pages/modules').then((m) => ({ default: m.AdminThresholdsPage }))
);
const AdminOrganizationPage = lazy(() =>
  import('@/pages/modules').then((m) => ({ default: m.AdminOrganizationPage }))
);
const AdminAuditPage = lazy(() =>
  import('@/pages/modules').then((m) => ({ default: m.AdminAuditPage }))
);
const ReportPage = lazy(() =>
  import('@/pages/modules').then((m) => ({ default: m.ReportPage }))
);
const ContractsPage = lazy(() =>
  import('@/pages/finance/ContractsPage').then((m) => ({ default: m.ContractsPage }))
);
const BillingPage = lazy(() =>
  import('@/pages/finance/BillingPage').then((m) => ({ default: m.BillingPage }))
);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } },
});

function PageFallback() {
  return (
    <div className="flex h-screen items-center justify-center">
      <p className="text-muted-foreground">Carregando...</p>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, loadUser, user } = useAuthStore();
  const location = window.location.pathname;

  useEffect(() => { loadUser(); }, [loadUser]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (user?.mustEnable2FA && location !== '/settings/security') {
    return <Navigate to="/settings/security" replace />;
  }

  return <>{children}</>;
}

function ReportRoute({ category }: { category: string }) {
  return <ReportPage category={category} />;
}

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastContextProvider>
          <BrowserRouter>
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/accept-invite" element={<AcceptInvitePage />} />
                <Route path="/portal/:orgSlug" element={<PortalPage />} />
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <AppLayout />
                    </ProtectedRoute>
                  }
                >
                  <Route index element={<DashboardPage />} />
                  <Route path="devices" element={<DevicesPage />} />
                  <Route path="devices/:id" element={<DeviceDetailPage />} />
                  <Route path="remote-sessions" element={<RemoteSessionsPage />} />
                  <Route path="tickets" element={<TicketsPage />} />
                  <Route path="tickets/:id" element={<TicketDetailPage />} />
                  <Route path="sites" element={<SitesPage />} />
                  <Route path="sites/:id" element={<SiteDetailPage />} />
                  <Route path="scripts" element={<ScriptsPage />} />
                  <Route path="automations" element={<AutomationsPage />} />
                  <Route path="alerts" element={<AlertsPage />} />
                  <Route path="patches" element={<PatchesPage />} />
                  <Route path="assets" element={<AssetsPage />} />
                  <Route path="network" element={<NetworkPage />} />
                  <Route path="knowledge" element={<KnowledgePage />} />
                  <Route path="finance/contracts" element={<ContractsPage />} />
                  <Route path="finance/billing" element={<BillingPage />} />
                  <Route path="referrals" element={<ReferralsPage />} />
                  <Route path="ai-center" element={<AiCenterPage />} />
                  <Route path="app-center" element={<AppCenterPage />} />
                  <Route path="admin/users" element={<AdminUsersPage />} />
                  <Route path="admin/thresholds" element={<AdminThresholdsPage />} />
                  <Route path="admin/organization" element={<AdminOrganizationPage />} />
                  <Route path="admin/audit" element={<AdminAuditPage />} />
                  <Route path="settings/security" element={<SecurityPage />} />
                  <Route path="reports/devices" element={<ReportRoute category="devices" />} />
                  <Route path="reports/tickets-sla" element={<ReportRoute category="tickets-sla" />} />
                  <Route path="reports/patch-compliance" element={<ReportRoute category="patch-compliance" />} />
                  <Route path="reports/financial" element={<ReportRoute category="financial" />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </ToastContextProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
