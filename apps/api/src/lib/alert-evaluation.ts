import { prisma } from './prisma.js';
import { emitNewAlert } from '../socket.js';
import type { Server } from 'socket.io';
import { getIo } from './io.js';
import { alertOpenKey } from './alert-open-key.js';
import { Prisma } from '@prisma/client';

/** Avalia regras de alerta de uma org (métricas recentes vs thresholds). */
export async function evaluateAlertsForOrganization(
  organizationId: string,
  io?: Server | null
): Promise<number> {
  const socket = io ?? getIo();
  const rules = await prisma.alertRule.findMany({
    where: { organizationId, enabled: true },
  });
  if (rules.length === 0) return 0;

  const devices = await prisma.device.findMany({
    where: { organizationId, status: 'ONLINE' },
    include: { resourceMetrics: { orderBy: { recordedAt: 'desc' }, take: 1 } },
  });

  let created = 0;
  for (const device of devices) {
    const metric = device.resourceMetrics[0];
    if (!metric) continue;

    for (const rule of rules) {
      let value: number | null = null;
      if (rule.metric === 'CPU') value = metric.cpuPercent;
      if (rule.metric === 'RAM') value = metric.ramPercent;
      if (rule.metric === 'DISK') value = metric.diskPercent;
      if (value === null || !rule.threshold) continue;

      if (value >= rule.threshold) {
        const openKey = alertOpenKey(device.id, rule.metric);
        if (!openKey) continue;

        let alert;
        try {
          alert = await prisma.alert.create({
            data: {
              title: `${rule.metric} acima de ${rule.threshold}%`,
              message: `${device.name}: ${rule.metric} em ${value.toFixed(1)}%`,
              severity: rule.severity,
              deviceId: device.id,
              organizationId,
              metric: rule.metric,
              value,
              openKey,
            },
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            continue; // já existe alerta aberto para device+metric
          }
          throw err;
        }

        created += 1;
        if (socket) {
          emitNewAlert(socket, organizationId, {
            id: alert.id,
            title: alert.title,
            severity: alert.severity,
            deviceId: device.id,
            deviceName: device.name,
          });
        }
        if (alert.severity === 'CRITICAL' || alert.severity === 'WARNING') {
          const { notifyAlertChannels } = await import('./alert-notify.js');
          await notifyAlertChannels({
            id: alert.id,
            title: alert.title,
            message: alert.message,
            severity: alert.severity,
            organizationId,
            deviceName: device.name,
          });
        }
        if (alert.severity === 'CRITICAL') {
          const { maybeCreateTicketFromAlert } = await import('./alert-ticket.js');
          await maybeCreateTicketFromAlert({
            id: alert.id,
            title: alert.title,
            message: alert.message,
            severity: alert.severity,
            organizationId,
            deviceId: device.id,
            ticketId: alert.ticketId,
          });
        }
      }
    }
  }
  return created;
}

/** Fallback sem BullMQ: avalia todas as orgs periodicamente. */
export async function evaluateAllOrgAlerts(io?: Server | null): Promise<number> {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  let total = 0;
  for (const org of orgs) {
    total += await evaluateAlertsForOrganization(org.id, io);
  }
  return total;
}
