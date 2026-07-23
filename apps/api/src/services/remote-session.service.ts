import { prisma } from '../lib/prisma.js';
import { getIo } from '../lib/io.js';
import { emitAgentCommand } from '../socket.js';
import { logger } from '../lib/logger.js';
import { appendRemoteAudit } from '../lib/ops.js';
import { applyRemoteUrlTemplate, signRemoteAccess } from '../lib/remote-url.js';

export type RemoteProvider = 'native' | 'rdp' | 'meshcentral' | 'url' | 'guacamole' | 'novnc';

const ACK_TIMEOUT_MS = Number(process.env.REMOTE_SESSION_ACK_TIMEOUT_MS || 60_000);

function resolveProvider(): RemoteProvider {
  const p = (process.env.REMOTE_PROVIDER || 'native').toLowerCase();
  if (['native', 'meshcentral', 'url', 'rdp', 'guacamole', 'novnc'].includes(p)) {
    return p as RemoteProvider;
  }
  return 'native';
}

/** Base do painel web (viewer in-app). */
function webBaseUrl(): string {
  const raw =
    process.env.WEB_URL ||
    process.env.APP_URL ||
    process.env.CORS_ORIGIN ||
    'http://localhost:5173';
  return raw.split(',')[0].trim().replace(/\/$/, '');
}

export async function startRemoteSession(deviceId: string, userId: string, organizationId: string) {
  const device = await prisma.device.findFirst({
    where: { id: deviceId, organizationId },
    include: {
      networkInterfaces: {
        where: { internal: false, isUp: true },
        take: 5,
        orderBy: { updatedAt: 'desc' },
      },
    },
  });
  if (!device) throw new Error('Dispositivo não encontrado');

  const provider = resolveProvider();
  const host =
    device.networkInterfaces.find((i) => i.ipv4)?.ipv4 ||
    device.hostname ||
    device.name;

  const session = await prisma.remoteSession.create({
    data: {
      deviceId,
      userId,
      organizationId,
      status: 'PENDING',
      provider,
      auditEvents: [
        { at: new Date().toISOString(), event: 'created', detail: `provider=${provider}`, by: userId },
      ],
    },
  });

  const apiUrl = process.env.API_URL || 'http://localhost:3001';
  const node = device.meshNodeId || device.id;
  const { token, expires, expiresIso } = signRemoteAccess(session.id);

  const vars: Record<string, string> = {
    base: '',
    node: encodeURIComponent(node),
    sessionId: session.id,
    hostname: encodeURIComponent(host),
    deviceId: device.id,
    apiUrl,
    token: encodeURIComponent(token),
    expires: String(expires),
    expiresIso: encodeURIComponent(expiresIso),
    meshNodeId: encodeURIComponent(device.meshNodeId || ''),
    // Credenciais só se explicitamente pedidas no template customizado
    user: encodeURIComponent(process.env.REMOTE_DEFAULT_USER || ''),
    password: '', // nunca embutir senha na URL por default
  };

  let connectionUrl: string | null = null;
  let connectionCommand: string | null = null;

  if (provider === 'meshcentral') {
    const base = (process.env.MESHCENTRAL_URL || '').replace(/\/$/, '');
    if (!base) throw new Error('MESHCENTRAL_URL não configurada');
    vars.base = base;
    const tpl =
      process.env.MESHCENTRAL_URL_TEMPLATE ||
      '{base}/?viewmode=11&node={node}&session={sessionId}&token={token}&expires={expires}';
    connectionUrl = applyRemoteUrlTemplate(tpl, vars);
    connectionCommand = `Abrir MeshCentral (TTL até ${expiresIso}): ${connectionUrl}`;
  } else if (provider === 'guacamole') {
    const base = (process.env.GUACAMOLE_URL || '').replace(/\/$/, '');
    if (!base) throw new Error('GUACAMOLE_URL não configurada');
    vars.base = base;
    const tpl =
      process.env.GUACAMOLE_URL_TEMPLATE ||
      '{base}/#/client/{node}?session={sessionId}&token={token}&expires={expires}';
    connectionUrl = applyRemoteUrlTemplate(tpl, vars);
    connectionCommand = `Guacamole (TTL até ${expiresIso}): ${connectionUrl}`;
  } else if (provider === 'novnc') {
    const base = (process.env.NOVNC_URL || '').replace(/\/$/, '');
    if (!base) throw new Error('NOVNC_URL não configurada');
    vars.base = base;
    const tpl =
      process.env.NOVNC_URL_TEMPLATE ||
      '{base}/vnc.html?host={hostname}&session={sessionId}&token={token}&expires={expires}';
    connectionUrl = applyRemoteUrlTemplate(tpl, vars);
    connectionCommand = `noVNC (TTL até ${expiresIso}): ${connectionUrl}`;
  } else if (provider === 'url') {
    const tpl =
      process.env.REMOTE_SESSION_URL_TEMPLATE ||
      '{apiUrl}/remote/{sessionId}?device={deviceId}&token={token}&expires={expires}';
    connectionUrl = applyRemoteUrlTemplate(tpl, vars);
    connectionCommand = `Abrir (TTL até ${expiresIso}): ${connectionUrl}`;
  } else if (provider === 'native' || provider === 'rdp') {
    // Stream JPEG/input via Socket.io no painel (funciona atras de NAT)
    const web = webBaseUrl();
    connectionUrl = `${web}/remote-sessions?session=${encodeURIComponent(session.id)}`;
    connectionCommand =
      provider === 'native'
        ? `Abrir viewer NexaOps no navegador (stream nativo)`
        : `Abrir viewer NexaOps (stream); RDP arquivo opcional em /api/devices/.../rdp`;
  } else {
    connectionCommand = `mstsc /v:${host}`;
    connectionUrl = `${apiUrl}/api/devices/${device.id}/remote-session/${session.id}/rdp`;
  }

  const updated = await prisma.remoteSession.update({
    where: { id: session.id },
    data: { connectionUrl, connectionCommand },
  });
  await appendRemoteAudit(session.id, 'url_signed', `expires=${expiresIso}`, userId);

  if (device.agentId) {
    const io = getIo();
    if (io) {
      emitAgentCommand(io, device.agentId, {
        type: 'remote:session',
        session: {
          id: session.id,
          provider,
          host,
          connectionUrl,
          meshNodeId: device.meshNodeId,
          expires,
        },
      });
      io.to(`agent:${device.agentId}`).emit('remote:signal-ready', { sessionId: session.id });
    }
  }

  setTimeout(() => {
    void (async () => {
      try {
        const current = await prisma.remoteSession.findUnique({ where: { id: session.id } });
        if (current && current.status === 'PENDING') {
          await prisma.remoteSession.update({
            where: { id: session.id },
            data: { status: 'DISCONNECTED', endedAt: new Date() },
          });
          await appendRemoteAudit(session.id, 'ack_timeout', 'Agent não confirmou a tempo');
          logger.info('remote_session_ack_timeout', { sessionId: session.id, deviceId });
        }
      } catch (err) {
        logger.error('remote_session_ack_timeout_failed', { error: String(err) });
      }
    })();
  }, ACK_TIMEOUT_MS);

  return updated;
}

export async function endRemoteSession(sessionId: string, organizationId: string, userId?: string) {
  const session = await prisma.remoteSession.findFirst({
    where: { id: sessionId, organizationId },
    include: { device: { select: { agentId: true } } },
  });
  if (!session) throw new Error('Sessão não encontrada');

  const updated = await prisma.remoteSession.update({
    where: { id: session.id },
    data: { status: 'DISCONNECTED', endedAt: new Date() },
  });
  await appendRemoteAudit(session.id, 'ended', undefined, userId);

  if (session.device.agentId) {
    const io = getIo();
    if (io) {
      emitAgentCommand(io, session.device.agentId, {
        type: 'remote:end',
        session: { id: session.id },
      });
    }
  }

  return updated;
}

export function buildRdpFileContent(host: string, deviceName: string): string {
  return [
    'full address:s:' + host,
    'prompt for credentials:i:1',
    'administrative session:i:0',
    'username:s:',
    'desktopwidth:i:1920',
    'desktopheight:i:1080',
    'session bpp:i:32',
    'compression:i:1',
    'authentication level:i:2',
    'negotiate security layer:i:1',
    `alternate shell:s:`,
    `# NexaOps RDP — ${deviceName}`,
  ].join('\r\n');
}
