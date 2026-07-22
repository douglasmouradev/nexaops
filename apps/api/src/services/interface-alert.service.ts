import type { AlertSeverity, DeviceNetworkInterface } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { getIo } from '../lib/io.js';
import { emitNewAlert } from '../socket.js';
import { alertOpenKey } from '../lib/alert-open-key.js';

export interface IncomingInterface {
  name: string;
  mac?: string | null;
  ipv4?: string | null;
  ipv6?: string | null;
  internal?: boolean;
  isUp?: boolean;
}

interface AlertPayload {
  title: string;
  message: string;
  severity: AlertSeverity;
  metric: string;
}

async function upsertInterfaceAlert(
  device: { id: string; name: string; organizationId: string },
  payload: AlertPayload
) {
  const openKey = alertOpenKey(device.id, payload.metric);
  if (!openKey) return;

  const prior = await prisma.alert.findUnique({ where: { openKey } });

  let alert;
  try {
    alert = await prisma.alert.upsert({
      where: { openKey },
      create: {
        title: payload.title,
        message: payload.message,
        severity: payload.severity,
        metric: payload.metric,
        deviceId: device.id,
        organizationId: device.organizationId,
        openKey,
      },
      update: {
        title: payload.title,
        message: payload.message,
        severity: payload.severity,
        status: 'NEW',
        resolvedAt: null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      alert = await prisma.alert.findUnique({ where: { openKey } });
      if (!alert) return;
    } else {
      throw err;
    }
  }

  const io = getIo();
  if (io) {
    await emitNewAlert(io, device.organizationId, {
      id: alert.id,
      title: alert.title,
      message: alert.message,
      severity: alert.severity,
      deviceId: device.id,
      deviceName: device.name,
      metric: alert.metric,
      createdAt: alert.createdAt,
    });
  }

  if (!prior) {
    const { notifyAlertChannels } = await import('../lib/alert-notify.js');
    await notifyAlertChannels({
      id: alert.id,
      title: alert.title,
      message: alert.message,
      severity: alert.severity,
      organizationId: device.organizationId,
      deviceName: device.name,
    });
    if (alert.severity === 'CRITICAL') {
      const { maybeCreateTicketFromAlert } = await import('../lib/alert-ticket.js');
      await maybeCreateTicketFromAlert({
        id: alert.id,
        title: alert.title,
        message: alert.message,
        severity: alert.severity,
        organizationId: device.organizationId,
        deviceId: device.id,
        ticketId: alert.ticketId,
      });
    }
  }

  return alert;
}

export async function processInterfaceAlerts(
  device: { id: string; name: string; organizationId: string },
  existing: DeviceNetworkInterface[],
  incoming: IncomingInterface[]
) {
  if (existing.length === 0) return [];

  const created = [];
  const existingMap = new Map(existing.map((i) => [i.name, i]));
  const incomingMap = new Map(incoming.map((i) => [i.name, i]));

  for (const iface of incoming) {
    if (iface.internal) continue;

    const prev = existingMap.get(iface.name);
    const ipv4 = iface.ipv4 ?? null;
    const ipv6 = iface.ipv6 ?? null;
    const mac = iface.mac ?? null;
    const isUp = iface.isUp ?? true;

    if (!prev) {
      if (ipv4 || ipv6) {
        const alert = await upsertInterfaceAlert(device, {
          metric: `NET_ADD:${iface.name}`,
          severity: 'INFO',
          title: `Nova interface: ${iface.name}`,
          message: `${device.name}: interface "${iface.name}" detectada com IP ${ipv4 || ipv6}`,
        });
        created.push(alert);
      }
      continue;
    }

    if (prev.ipv4 && prev.ipv4 !== ipv4) {
      const alert = await upsertInterfaceAlert(device, {
        metric: `NET_IP:${iface.name}`,
        severity: 'WARNING',
        title: `IP alterado: ${iface.name}`,
        message: `${device.name}: ${iface.name} mudou de ${prev.ipv4} para ${ipv4 || 'sem IP'}`,
      });
      created.push(alert);
    }

    if (prev.mac && mac && prev.mac !== mac) {
      const alert = await upsertInterfaceAlert(device, {
        metric: `NET_MAC:${iface.name}`,
        severity: 'WARNING',
        title: `MAC alterado: ${iface.name}`,
        message: `${device.name}: ${iface.name} MAC ${prev.mac} → ${mac}`,
      });
      created.push(alert);
    }

    if (prev.isUp && !isUp) {
      const alert = await upsertInterfaceAlert(device, {
        metric: `NET_DOWN:${iface.name}`,
        severity: 'WARNING',
        title: `Interface inativa: ${iface.name}`,
        message: `${device.name}: interface "${iface.name}" (${prev.ipv4 || 'sem IP'}) ficou inativa`,
      });
      created.push(alert);
    } else if (!prev.isUp && isUp && (ipv4 || ipv6)) {
      const alert = await upsertInterfaceAlert(device, {
        metric: `NET_UP:${iface.name}`,
        severity: 'INFO',
        title: `Interface ativa: ${iface.name}`,
        message: `${device.name}: interface "${iface.name}" voltou com IP ${ipv4 || ipv6}`,
      });
      created.push(alert);
    }
  }

  for (const prev of existing) {
    if (prev.internal) continue;
    if (!incomingMap.has(prev.name)) {
      const alert = await upsertInterfaceAlert(device, {
        metric: `NET_REMOVE:${prev.name}`,
        severity: 'WARNING',
        title: `Interface removida: ${prev.name}`,
        message: `${device.name}: interface "${prev.name}" (${prev.ipv4 || 'sem IP'}) não está mais presente`,
      });
      created.push(alert);
    }
  }

  return created;
}
