import { prisma } from '../lib/prisma.js';
import { sendEmail } from './email.js';

export async function notifyAlertChannels(alert: {
  id: string;
  title: string;
  message: string;
  severity: string;
  organizationId: string;
  deviceName?: string | null;
}): Promise<void> {
  if (process.env.NOTIFY_CRITICAL_ALERTS === 'false') return;

  const [users, org] = await Promise.all([
    prisma.user.findMany({
      where: {
        organizationId: alert.organizationId,
        notifyCriticalAlerts: true,
        role: { in: ['ADMIN', 'TECHNICIAN'] },
      },
      select: { email: true, name: true, notifyAlertSeverities: true },
    }),
    prisma.organization.findUnique({
      where: { id: alert.organizationId },
      select: { name: true, billingEmail: true, alertWebhookUrl: true },
    }),
  ]);

  const recipients = new Set<string>();
  for (const u of users) {
    const allowed = (u.notifyAlertSeverities || 'CRITICAL')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (allowed.includes(alert.severity.toUpperCase())) {
      recipients.add(u.email.toLowerCase());
    }
  }
  if (org?.billingEmail && alert.severity === 'CRITICAL') {
    recipients.add(org.billingEmail.toLowerCase());
  }

  const appUrl = process.env.CORS_ORIGIN || 'http://localhost:5173';
  const deviceLine = alert.deviceName
    ? `<p><strong>Dispositivo:</strong> ${escapeHtml(alert.deviceName)}</p>`
    : '';
  const html = `
    <h2>Alerta ${escapeHtml(alert.severity)} — ${escapeHtml(org?.name || 'NexaOps')}</h2>
    <p><strong>${escapeHtml(alert.title)}</strong></p>
    <p>${escapeHtml(alert.message)}</p>
    ${deviceLine}
    <p><a href="${appUrl}/alerts">Abrir central de alertas</a></p>
  `;

  await Promise.all(
    [...recipients].map((to) =>
      sendEmail(to, `[NexaOps] ${alert.severity}: ${alert.title}`, html).catch((err) => {
        console.error(`[ALERT_EMAIL] falha para ${to}:`, err);
      })
    )
  );

  const webhook = org?.alertWebhookUrl || process.env.ALERT_WEBHOOK_URL;
  if (webhook) {
    await postWebhook(webhook, {
      text: `[${alert.severity}] ${alert.title} — ${alert.deviceName || 'N/A'}\n${alert.message}`,
      alert: {
        id: alert.id,
        title: alert.title,
        message: alert.message,
        severity: alert.severity,
        deviceName: alert.deviceName,
        organization: org?.name,
        url: `${appUrl}/alerts`,
      },
    }).catch((err) => console.error('[ALERT_WEBHOOK]', err));
  }
}

/** @deprecated use notifyAlertChannels */
export async function notifyCriticalAlertEmail(alert: {
  id: string;
  title: string;
  message: string;
  severity: string;
  organizationId: string;
  deviceName?: string | null;
}): Promise<void> {
  return notifyAlertChannels(alert);
}

async function postWebhook(url: string, payload: Record<string, unknown>) {
  // Slack incoming webhook usa { text }; Teams MessageCard também aceita text em muitos conectores
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Webhook HTTP ${res.status}`);
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
