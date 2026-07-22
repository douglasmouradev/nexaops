import { prisma } from './prisma.js';
import { logger } from './logger.js';

type AuditEvent = { at: string; event: string; detail?: string; by?: string };

export async function appendRemoteAudit(
  sessionId: string,
  event: string,
  detail?: string,
  by?: string
): Promise<void> {
  const session = await prisma.remoteSession.findUnique({ where: { id: sessionId } });
  if (!session) return;
  const prev = Array.isArray(session.auditEvents) ? (session.auditEvents as AuditEvent[]) : [];
  const next = [...prev, { at: new Date().toISOString(), event, detail, by }].slice(-100);
  await prisma.remoteSession.update({
    where: { id: sessionId },
    data: { auditEvents: next },
  });
}

/** Limites default por plano (override com Organization.maxDevices) */
export function planDeviceLimit(plan: string, override?: number | null): number | null {
  if (override != null) return override;
  const map: Record<string, number | null> = {
    trial: 25,
    starter: 50,
    professional: 200,
    business: 1000,
    enterprise: null,
  };
  return map[plan.toLowerCase()] ?? 25;
}

export async function assertDeviceSeatAvailable(organizationId: string): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true, maxDevices: true },
  });
  if (!org) throw new Error('Organização não encontrada');
  const limit = planDeviceLimit(org.plan, org.maxDevices);
  if (limit == null) return;
  const count = await prisma.device.count({ where: { organizationId } });
  if (count >= limit) {
    throw new Error(
      `Limite de dispositivos do plano "${org.plan}" atingido (${limit}). Faça upgrade ou remova devices.`
    );
  }
}

export async function pruneOldMetrics(days = 14): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result = await prisma.resourceMetric.deleteMany({
    where: { recordedAt: { lt: cutoff } },
  });
  if (result.count > 0) logger.info('metrics_pruned', { count: result.count, days });
  return result.count;
}
