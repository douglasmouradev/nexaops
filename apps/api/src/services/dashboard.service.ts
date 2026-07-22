import { prisma } from '../lib/prisma.js';

type DashboardStats = Awaited<ReturnType<typeof computeDashboardStats>>;

const memoryCache = new Map<string, { expires: number; data: DashboardStats }>();
const TTL_MS = Number(process.env.DASHBOARD_CACHE_TTL_MS || 30_000);

async function computeDashboardStats(
  organizationId: string,
  siteFilter: { siteId?: { in: string[] } } = {}
) {
  const deviceWhere = { organizationId, ...siteFilter };
  const ticketWhere = { organizationId, ...siteFilter };
  const patchWhere = {
    organizationId,
    ...(siteFilter.siteId ? { device: { siteId: siteFilter.siteId } } : {}),
  };
  const alertWhere = {
    organizationId,
    ...(siteFilter.siteId ? { device: { siteId: siteFilter.siteId } } : {}),
  };

  const [
    devicesOnline,
    devicesOffline,
    ticketsOpen,
    ticketsPending,
    ticketsResolved,
    slaAtRisk,
    patchesPending,
    criticalAlerts,
    recentAlerts,
  ] = await Promise.all([
    prisma.device.count({ where: { ...deviceWhere, status: 'ONLINE' } }),
    prisma.device.count({ where: { ...deviceWhere, status: 'OFFLINE' } }),
    prisma.ticket.count({ where: { ...ticketWhere, status: 'OPEN' } }),
    prisma.ticket.count({ where: { ...ticketWhere, status: 'PENDING' } }),
    prisma.ticket.count({ where: { ...ticketWhere, status: 'RESOLVED' } }),
    prisma.ticket.count({
      where: {
        ...ticketWhere,
        status: { in: ['OPEN', 'PENDING'] },
        slaDeadline: { lte: new Date(Date.now() + 4 * 60 * 60 * 1000) },
        slaBreached: false,
      },
    }),
    prisma.patch.count({ where: { ...patchWhere, status: 'PENDING' } }),
    prisma.alert.count({
      where: { ...alertWhere, severity: 'CRITICAL', status: { in: ['NEW', 'ACKNOWLEDGED'] } },
    }),
    prisma.alert.findMany({
      where: { ...alertWhere, severity: 'CRITICAL' },
      include: { device: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  return {
    kpis: {
      devicesOnline,
      devicesOffline,
      ticketsOpen,
      slaAtRisk,
      patchesPending,
      criticalAlerts,
    },
    ticketsByStatus: {
      open: ticketsOpen,
      pending: ticketsPending,
      resolved: ticketsResolved,
    },
    recentCriticalAlerts: recentAlerts,
  };
}

export async function getDashboardStats(
  organizationId: string,
  siteFilter: { siteId?: { in: string[] } } = {}
) {
  const cacheKey = `${organizationId}:${JSON.stringify(siteFilter)}`;
  const hit = memoryCache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.data;

  const data = await computeDashboardStats(organizationId, siteFilter);
  memoryCache.set(cacheKey, { expires: Date.now() + TTL_MS, data });
  return data;
}
