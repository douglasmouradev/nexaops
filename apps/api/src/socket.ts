import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { verifyAccessToken } from './lib/jwt.js';
import { prisma } from './lib/prisma.js';
import { resolveAgentAuth } from './lib/agent-credentials.js';
import { corsOriginCallback } from './lib/cors-origin.js';

export function setupSocket(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOriginCallback,
      credentials: true,
    },
    // JPEG base64 de tela pode passar de 1MB
    maxHttpBufferSize: 5e6,
  });

  io.use(async (socket, next) => {
    const agentToken = socket.handshake.auth?.agentToken as string | undefined;
    const agentId = socket.handshake.auth?.agentId as string | undefined;

    if (agentToken && agentId) {
      const creds = await resolveAgentAuth(agentToken, agentId);
      if (!creds) {
        next(new Error('Agente inválido'));
        return;
      }
      socket.data.agent = {
        agentId: creds.agentId,
        deviceId: creds.deviceId,
        organizationId: creds.organizationId,
      };
      next();
      return;
    }

    const token = socket.handshake.auth?.token as string;
    if (!token) {
      next(new Error('Autenticação necessária'));
      return;
    }
    try {
      const payload = verifyAccessToken(token);
      socket.data.user = payload;
      next();
    } catch {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket: Socket) => {
    if (socket.data.agent) {
      const { agentId, organizationId } = socket.data.agent;
      socket.join(`agent:${agentId}`);
      socket.join(`org:${organizationId}`);

      socket.on('remote:signal', (payload) => {
        if (!payload?.sessionId) return;
        socket.to(`remote:${payload.sessionId}`).emit('remote:signal', {
          from: 'agent',
          sessionId: payload.sessionId,
          data: payload.data,
        });
      });

      socket.on('remote:frame', (payload) => {
        if (!payload?.sessionId) return;
        socket.to(`remote:${payload.sessionId}`).emit('remote:frame', payload);
      });
      return;
    }

    const orgId = socket.data.user.organizationId as string;
    socket.join(`org:${orgId}`);

    socket.on('subscribe:device', async (deviceId: string) => {
      if (!deviceId || typeof deviceId !== 'string') return;
      const device = await prisma.device.findFirst({
        where: { id: deviceId, organizationId: orgId },
        select: { id: true },
      });
      if (!device) return;
      socket.join(`device:${deviceId}`);
    });

    socket.on('remote:join', async (sessionId: string) => {
      if (!sessionId || typeof sessionId !== 'string') return;
      const session = await prisma.remoteSession.findFirst({
        where: { id: sessionId, organizationId: orgId },
        include: { device: { select: { agentId: true } } },
      });
      if (!session) return;
      socket.join(`remote:${sessionId}`);
      if (session.device.agentId) {
        socket.to(`agent:${session.device.agentId}`).emit('remote:signal', {
          from: 'technician',
          sessionId,
          data: { type: 'viewer-joined' },
        });
      }
    });

    socket.on('remote:signal', async (payload: { sessionId?: string; data?: unknown }) => {
      if (!payload?.sessionId) return;
      const session = await prisma.remoteSession.findFirst({
        where: { id: payload.sessionId, organizationId: orgId },
        include: { device: { select: { agentId: true } } },
      });
      if (!session?.device.agentId) return;
      socket.to(`agent:${session.device.agentId}`).emit('remote:signal', {
        from: 'technician',
        sessionId: payload.sessionId,
        data: payload.data,
      });
    });

    socket.on(
      'remote:input',
      async (payload: {
        sessionId?: string;
        type?: string;
        x?: number;
        y?: number;
        button?: number;
        deltaY?: number;
        key?: string;
        text?: string;
        event?: unknown;
      }) => {
        if (!payload?.sessionId) return;
        const session = await prisma.remoteSession.findFirst({
          where: {
            id: payload.sessionId,
            organizationId: orgId,
            status: { in: ['CONNECTED', 'PENDING'] },
          },
          include: { device: { select: { agentId: true } } },
        });
        if (!session?.device.agentId) return;
        socket.to(`agent:${session.device.agentId}`).emit('remote:input', {
          sessionId: payload.sessionId,
          event: payload.event || {
            type: payload.type,
            x: payload.x,
            y: payload.y,
            button: payload.button,
            deltaY: payload.deltaY,
            key: payload.key,
            text: payload.text,
          },
        });
      }
    );
  });

  return io;
}

export async function emitDeviceStatusChange(
  io: Server,
  organizationId: string,
  deviceId: string,
  status: string
) {
  io.to(`org:${organizationId}`).emit('device:status', { deviceId, status });
  io.to(`device:${deviceId}`).emit('device:status', { deviceId, status });
}

export async function emitNewAlert(
  io: Server,
  organizationId: string,
  alert: Record<string, unknown>
) {
  io.to(`org:${organizationId}`).emit('alert:new', alert);
}

export function emitAgentCommand(
  io: Server,
  agentId: string,
  payload: {
    type: string;
    execution?: unknown;
    patch?: unknown;
    patches?: unknown;
    session?: unknown;
    scan?: unknown;
  }
) {
  io.to(`agent:${agentId}`).emit('agent:command', payload);
}
