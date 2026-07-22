import { Router, Response } from 'express';
import {
  createDeviceSchema,
  updateDeviceSchema,
  deviceFilterSchema,
  bulkDeviceActionSchema,
  agentInstallSchema,
} from '@nexaops/shared';
import { authenticate, requireWrite, AuthRequest } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { auditLog } from '../middleware/audit.js';
import * as deviceService from '../services/device.service.js';
import { paramId } from '../lib/params.js';
import { prisma } from '../lib/prisma.js';

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * /api/devices:
 *   get:
 *     tags: [Devices]
 *     summary: Listar dispositivos com filtros e paginação
 */
router.get('/', validateQuery(deviceFilterSchema), async (req: AuthRequest, res: Response) => {
  try {
    const query = req.query as Record<string, unknown>;
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { role: true, allowedSiteIds: true },
    });
    const { parseAllowedSiteIds } = await import('../lib/tenant.js');
    const allowed =
      user && user.role !== 'ADMIN' ? parseAllowedSiteIds(user.allowedSiteIds) : undefined;

    const result = await deviceService.listDevices({
      organizationId: req.user!.organizationId,
      search: query.search as string | undefined,
      nlFilter: query.nlFilter as string | undefined,
      siteId: query.siteId as string | undefined,
      allowedSiteIds: allowed && allowed.length > 0 ? allowed : undefined,
      type: query.type as string | undefined,
      status: query.status as string | undefined,
      favorites: query.favorites === 'true' || query.favorites === true,
      folder: query.folder as string | undefined,
      page: Number(query.page) || 1,
      limit: Number(query.limit) || 25,
      sortBy: query.sortBy as string | undefined,
      sortOrder: (query.sortOrder as 'asc' | 'desc') || 'desc',
    });
    res.json({ success: true, data: result.data, meta: result.meta });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const device = await deviceService.getDevice(paramId(req.params.id), req.user!.organizationId);
    if (!device) {
      res.status(404).json({ success: false, error: 'Dispositivo não encontrado' });
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { role: true, allowedSiteIds: true },
    });
    const { isSiteAllowed } = await import('../lib/tenant.js');
    if (user && !isSiteAllowed(user.role, user.allowedSiteIds, device.site?.id ?? null)) {
      res.status(404).json({ success: false, error: 'Dispositivo não encontrado' });
      return;
    }
    res.json({ success: true, data: device });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.post('/', requireWrite, validateBody(createDeviceSchema), auditLog('CREATE', 'Device'), async (req: AuthRequest, res: Response) => {
  try {
    const device = await deviceService.createDevice(req.user!.organizationId, req.body);
    res.status(201).json({ success: true, data: device });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

router.patch('/:id', requireWrite, validateBody(updateDeviceSchema), auditLog('UPDATE', 'Device'), async (req: AuthRequest, res: Response) => {
  try {
    const device = await deviceService.updateDevice(paramId(req.params.id), req.user!.organizationId, req.body);
    res.json({ success: true, data: device });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

router.delete('/:id', requireWrite, auditLog('DELETE', 'Device'), async (req: AuthRequest, res: Response) => {
  try {
    await deviceService.deleteDevice(paramId(req.params.id), req.user!.organizationId);
    res.json({ success: true, data: { message: 'Dispositivo removido' } });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

router.post('/bulk-action', requireWrite, validateBody(bulkDeviceActionSchema), auditLog('BULK_ACTION', 'Device'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await deviceService.bulkDeviceAction(
      req.user!.organizationId,
      req.body.deviceIds,
      req.body.action,
      req.body.payload,
      req.user!.userId
    );
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

router.post('/agent/install', requireWrite, validateBody(agentInstallSchema), auditLog('GENERATE_INSTALLER', 'Agent'), async (req: AuthRequest, res: Response) => {
  try {
    const installer = await deviceService.generateAgentInstall(
      req.user!.organizationId,
      req.body.osType,
      req.body.siteId,
      req.body.folder
    );
    res.json({ success: true, data: installer });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

router.post('/:id/remote-session', requireWrite, auditLog('REMOTE_SESSION', 'Device'), async (req: AuthRequest, res: Response) => {
  try {
    const session = await deviceService.startRemoteSession(
      paramId(req.params.id),
      req.user!.userId,
      req.user!.organizationId
    );
    res.status(201).json({ success: true, data: session });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

router.get('/:id/remote-session/:sessionId/rdp', async (req: AuthRequest, res: Response) => {
  try {
    const deviceId = paramId(req.params.id);
    const sessionId = paramId(req.params.sessionId);
    const device = await prisma.device.findFirst({
      where: { id: deviceId, organizationId: req.user!.organizationId },
      include: {
        networkInterfaces: { where: { internal: false, isUp: true }, take: 3, orderBy: { updatedAt: 'desc' } },
      },
    });
    if (!device) {
      res.status(404).json({ success: false, error: 'Dispositivo não encontrado' });
      return;
    }
    const session = await prisma.remoteSession.findFirst({
      where: { id: sessionId, deviceId },
    });
    if (!session) {
      res.status(404).json({ success: false, error: 'Sessão não encontrada' });
      return;
    }
    const host =
      device.networkInterfaces.find((i) => i.ipv4)?.ipv4 ||
      device.hostname ||
      device.name;
    const { buildRdpFileContent } = await import('../services/remote-session.service.js');
    const content = buildRdpFileContent(host, device.name);
    res.setHeader('Content-Type', 'application/x-rdp');
    res.setHeader('Content-Disposition', `attachment; filename="nexaops-${device.name}.rdp"`);
    res.send(content);
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

export default router;
