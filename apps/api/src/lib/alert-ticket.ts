import { prisma } from '../lib/prisma.js';
import { createTicket } from '../services/ticket.service.js';
import { logger } from './logger.js';

/**
 * Se AUTO_TICKET_ON_CRITICAL=true (default), cria ticket URGENT ligado ao alerta CRITICAL.
 */
export async function maybeCreateTicketFromAlert(alert: {
  id: string;
  title: string;
  message: string | null;
  severity: string;
  organizationId: string;
  deviceId?: string | null;
  ticketId?: string | null;
}): Promise<string | null> {
  const enabled = process.env.AUTO_TICKET_ON_CRITICAL !== 'false';
  if (!enabled || alert.severity !== 'CRITICAL' || alert.ticketId) return null;

  try {
    const admin = await prisma.user.findFirst({
      where: { organizationId: alert.organizationId, role: 'ADMIN' },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!admin) {
      logger.info('auto_ticket_skipped_no_admin', { alertId: alert.id });
      return null;
    }

    let siteId: string | null = null;
    if (alert.deviceId) {
      const device = await prisma.device.findUnique({
        where: { id: alert.deviceId },
        select: { siteId: true },
      });
      siteId = device?.siteId || null;
    }

    const ticket = await createTicket({
      organizationId: alert.organizationId,
      creatorId: admin.id,
      title: `[Alerta] ${alert.title}`,
      description: `${alert.message || ''}\n\nGerado automaticamente a partir do alerta ${alert.id}.`,
      priority: 'URGENT',
      deviceId: alert.deviceId || null,
      siteId,
      slaHours: 4,
    });

    await prisma.alert.update({
      where: { id: alert.id },
      data: { ticketId: ticket.id },
    });

    logger.info('auto_ticket_from_alert', { alertId: alert.id, ticketId: ticket.id });
    return ticket.id;
  } catch (err) {
    logger.error('auto_ticket_from_alert_failed', {
      alertId: alert.id,
      error: (err as Error).message,
    });
    return null;
  }
}
