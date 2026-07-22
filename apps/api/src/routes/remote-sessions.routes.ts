import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { paramId } from '../lib/params.js';
import { parsePagination, paginationMeta } from '../lib/pagination.js';
import { auditLog } from '../middleware/audit.js';
import { getIceServers } from '../lib/ice-servers.js';
import { loadUserSiteScope, isSiteAllowed, parseAllowedSiteIds } from '../lib/tenant.js';

const router = Router();
router.use(authenticate);

router.get('/ice-servers', (_req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    data: {
      iceServers: getIceServers(),
      mediaPath: 'socket-frames',
      note: 'Path oficial: JPEG via Socket.io / Guacamole-Mesh-noVNC. WebRTC nativo é experimental.',
    },
  });
});

/** Lista sessões remotas da organização (filtradas por site do device) */
router.get('/', async (req: AuthRequest, res: Response) => {
  const { page, limit, skip } = parsePagination(req);
  const orgId = req.user!.organizationId;
  const status = req.query.status as string | undefined;
  const scope = await loadUserSiteScope(req.user!.userId);
  const allowed = scope.role === 'ADMIN' ? [] : parseAllowedSiteIds(scope.allowedSiteIds);

  const where = {
    organizationId: orgId,
    ...(status ? { status: status as 'PENDING' | 'CONNECTED' | 'DISCONNECTED' } : {}),
    ...(allowed.length > 0 ? { device: { siteId: { in: allowed } } } : {}),
  };

  const [sessions, total] = await Promise.all([
    prisma.remoteSession.findMany({
      where,
      include: {
        device: {
          select: { id: true, name: true, hostname: true, status: true, meshNodeId: true, siteId: true },
        },
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { startedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.remoteSession.count({ where }),
  ]);

  res.json({ success: true, data: sessions, meta: paginationMeta(total, page, limit) });
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  const id = paramId(req.params.id);
  const scope = await loadUserSiteScope(req.user!.userId);
  const session = await prisma.remoteSession.findFirst({
    where: { id, organizationId: req.user!.organizationId },
    include: {
      device: {
        select: {
          id: true,
          name: true,
          hostname: true,
          status: true,
          agentId: true,
          meshNodeId: true,
          siteId: true,
        },
      },
      user: { select: { id: true, name: true, email: true } },
    },
  });
  if (!session || !isSiteAllowed(scope.role, scope.allowedSiteIds, session.device.siteId)) {
    res.status(404).json({ success: false, error: 'Sessão não encontrada' });
    return;
  }
  res.json({ success: true, data: session });
});

/** Encerra sessão remota */
router.post('/:id/end', auditLog('END', 'RemoteSession'), async (req: AuthRequest, res: Response) => {
  try {
    const id = paramId(req.params.id);
    const scope = await loadUserSiteScope(req.user!.userId);
    const session = await prisma.remoteSession.findFirst({
      where: { id, organizationId: req.user!.organizationId },
      include: { device: { select: { siteId: true } } },
    });
    if (!session || !isSiteAllowed(scope.role, scope.allowedSiteIds, session.device.siteId)) {
      res.status(404).json({ success: false, error: 'Sessão não encontrada' });
      return;
    }
    const { endRemoteSession } = await import('../services/remote-session.service.js');
    const updated = await endRemoteSession(id, req.user!.organizationId, req.user!.userId);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(404).json({ success: false, error: (err as Error).message });
  }
});

export default router;
