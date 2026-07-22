import { prisma } from '../lib/prisma.js';
import { sendEmail } from './email.js';

/**
 * Marca tickets com SLA estourado e notifica assignees/admins.
 */
export async function checkSlaBreaches(): Promise<number> {
  const now = new Date();
  const due = await prisma.ticket.findMany({
    where: {
      slaBreached: false,
      slaDeadline: { lt: now },
      status: { in: ['OPEN', 'PENDING'] },
    },
    include: {
      assignee: { select: { email: true, name: true } },
      organization: { select: { id: true, name: true, billingEmail: true } },
      site: { select: { name: true } },
    },
    take: 100,
  });

  if (due.length === 0) return 0;

  const appUrl = process.env.CORS_ORIGIN || 'http://localhost:5173';

  for (const ticket of due) {
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { slaBreached: true },
    });

    const recipients = new Set<string>();
    if (ticket.assignee?.email) recipients.add(ticket.assignee.email.toLowerCase());
    if (ticket.organization.billingEmail) {
      recipients.add(ticket.organization.billingEmail.toLowerCase());
    }

    const admins = await prisma.user.findMany({
      where: {
        organizationId: ticket.organizationId,
        role: 'ADMIN',
        notifyCriticalAlerts: true,
      },
      select: { email: true },
    });
    for (const a of admins) recipients.add(a.email.toLowerCase());

    const html = `
      <h2>SLA estourado — ${ticket.organization.name}</h2>
      <p>Ticket <strong>#${ticket.number}</strong>: ${ticket.title}</p>
      <p>Prazo: ${ticket.slaDeadline?.toISOString()}</p>
      <p>Site: ${ticket.site?.name || '—'}</p>
      <p><a href="${appUrl}/tickets/${ticket.id}">Abrir ticket</a></p>
    `;

    await Promise.all(
      [...recipients].map((to) =>
        sendEmail(to, `[NexaOps] SLA estourado #${ticket.number}`, html).catch(() => undefined)
      )
    );
  }

  return due.length;
}
