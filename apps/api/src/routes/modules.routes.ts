import { Router, Response } from 'express';
import {
  createTicketSchema,
  updateTicketSchema,
  createCommentSchema,
  updateAlertStatusSchema,
  createAlertRuleSchema,
  createScriptSchema,
  runScriptSchema,
  schedulePatchSchema,
  createArticleSchema,
  createThresholdProfileSchema,
  createAssetSchema,
} from '@nexaops/shared';
import { authenticate, requireRole, requireWrite, AuthRequest } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { prisma } from '../lib/prisma.js';
import { paramId } from '../lib/params.js';
import { queueScriptExecution } from '../lib/queue.js';
import {
  TenantError,
  assertTicketInOrg,
  assertTicketAccessible,
  assertAlertInOrg,
  assertScriptInOrg,
  assertPatchesInOrg,
  assertSiteInOrg,
  loadUserSiteScope,
  siteScopeWhere,
  deviceSiteScopeWhere,
  assertDevicesInSiteScope,
  isSiteAllowed,
  assertSiteAllowed,
  parseAllowedSiteIds,
} from '../lib/tenant.js';
import { createTicket } from '../services/ticket.service.js';
import { auditLog, writeAudit } from '../middleware/audit.js';
import { asyncHandler } from '../middleware/error.js';
import { resolvePortalOrg } from '../lib/portal-auth.js';
import { parsePagination, paginationMeta } from '../lib/pagination.js';
import { parseReportFilters } from '../lib/report-filters.js';
import { randomBytes } from 'crypto';

function handleTenantError(res: Response, err: unknown): boolean {
  if (err instanceof TenantError) {
    res.status(err.status).json({ success: false, error: err.message });
    return true;
  }
  return false;
}

// ─── Tickets ─────────────────────────────────────────────────────────────────
const ticketsRouter = Router();
ticketsRouter.use(authenticate);

ticketsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const { page, limit, skip } = parsePagination(req);
  const scope = await loadUserSiteScope(req.user!.userId);
  const where = {
    organizationId: req.user!.organizationId,
    ...siteScopeWhere(scope.role, scope.allowedSiteIds),
  };
  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: {
        site: { select: { name: true } },
        device: { select: { name: true } },
        assignee: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.ticket.count({ where }),
  ]);
  res.json({ success: true, data: tickets, meta: paginationMeta(total, page, limit) });
});

ticketsRouter.get('/:id', async (req: AuthRequest, res: Response) => {
  const scope = await loadUserSiteScope(req.user!.userId);
  const ticket = await prisma.ticket.findFirst({
    where: {
      id: paramId(req.params.id),
      organizationId: req.user!.organizationId,
      ...siteScopeWhere(scope.role, scope.allowedSiteIds),
    },
    include: {
      site: true,
      device: true,
      assignee: { select: { id: true, name: true, email: true } },
      creator: { select: { name: true } },
      comments: {
        include: { author: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      },
      attachments: {
        select: {
          id: true,
          fileName: true,
          contentType: true,
          sizeBytes: true,
          storageKey: true,
          createdAt: true,
          uploadedBy: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!ticket) { res.status(404).json({ success: false, error: 'Ticket não encontrado' }); return; }
  res.json({ success: true, data: ticket });
});

ticketsRouter.post('/', requireWrite, validateBody(createTicketSchema), auditLog('CREATE', 'Ticket'), async (req: AuthRequest, res: Response) => {
  try {
    const scope = await loadUserSiteScope(req.user!.userId);
    if (req.body.siteId) {
      await assertSiteAllowed(req.body.siteId, req.user!.organizationId, scope.role, scope.allowedSiteIds);
    }
    if (req.body.deviceId) {
      await assertDevicesInSiteScope(
        [req.body.deviceId],
        req.user!.organizationId,
        scope.role,
        scope.allowedSiteIds
      );
    }
    const ticket = await createTicket({
      organizationId: req.user!.organizationId,
      creatorId: req.user!.userId,
      title: req.body.title,
      description: req.body.description,
      priority: req.body.priority,
      siteId: req.body.siteId,
      deviceId: req.body.deviceId,
      assigneeId: req.body.assigneeId,
    });
    res.status(201).json({ success: true, data: ticket });
  } catch (err) {
    if (handleTenantError(res, err)) return;
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

ticketsRouter.patch('/:id', requireWrite, validateBody(updateTicketSchema), auditLog('UPDATE', 'Ticket'), async (req: AuthRequest, res: Response) => {
  try {
    const id = paramId(req.params.id);
    const scope = await loadUserSiteScope(req.user!.userId);
    await assertTicketAccessible(id, req.user!.organizationId, scope.role, scope.allowedSiteIds);
    if (req.body.siteId) {
      await assertSiteAllowed(req.body.siteId, req.user!.organizationId, scope.role, scope.allowedSiteIds);
    }
    const ticket = await prisma.ticket.update({ where: { id }, data: req.body });
    res.json({ success: true, data: ticket });
  } catch (err) {
    if (handleTenantError(res, err)) return;
    throw err;
  }
});

ticketsRouter.post('/:id/comments', requireWrite, validateBody(createCommentSchema), auditLog('COMMENT', 'Ticket'), async (req: AuthRequest, res: Response) => {
  try {
    const ticketId = paramId(req.params.id);
    const scope = await loadUserSiteScope(req.user!.userId);
    await assertTicketAccessible(ticketId, req.user!.organizationId, scope.role, scope.allowedSiteIds);
    const comment = await prisma.ticketComment.create({
      data: {
        ...req.body,
        ticketId,
        authorId: req.user!.userId,
      },
    });
    res.status(201).json({ success: true, data: comment });
  } catch (err) {
    if (handleTenantError(res, err)) return;
    throw err;
  }
});

ticketsRouter.get('/:ticketId/attachments/:attachmentId/download', async (req: AuthRequest, res: Response) => {
  try {
    const ticketId = paramId(req.params.ticketId);
    const attachmentId = paramId(req.params.attachmentId);
    const scope = await loadUserSiteScope(req.user!.userId);
    await assertTicketAccessible(ticketId, req.user!.organizationId, scope.role, scope.allowedSiteIds);
    const attachment = await prisma.ticketAttachment.findFirst({
      where: { id: attachmentId, ticketId },
    });
    if (!attachment) {
      res.status(404).json({ success: false, error: 'Anexo não encontrado' });
      return;
    }
    if (attachment.storageKey) {
      const { getAttachmentSignedUrl } = await import('../lib/storage.js');
      const url = await getAttachmentSignedUrl(attachment.storageKey);
      res.json({ success: true, data: { url, fileName: attachment.fileName } });
      return;
    }
    if (attachment.dataBase64) {
      res.json({
        success: true,
        data: {
          fileName: attachment.fileName,
          contentType: attachment.contentType,
          dataBase64: attachment.dataBase64,
        },
      });
      return;
    }
    res.status(404).json({ success: false, error: 'Conteúdo do anexo indisponível' });
  } catch (err) {
    if (handleTenantError(res, err)) return;
    throw err;
  }
});

ticketsRouter.post('/:id/attachments', requireWrite, auditLog('ATTACH', 'Ticket'), async (req: AuthRequest, res: Response) => {
  try {
    const ticketId = paramId(req.params.id);
    const scope = await loadUserSiteScope(req.user!.userId);
    await assertTicketAccessible(ticketId, req.user!.organizationId, scope.role, scope.allowedSiteIds);

    const fileName = String(req.body?.fileName || '').trim();
    const dataBase64 = String(req.body?.dataBase64 || '');
    if (!fileName || !dataBase64) {
      res.status(400).json({ success: false, error: 'fileName e dataBase64 são obrigatórios' });
      return;
    }
    if (dataBase64.length > 2_000_000) {
      res.status(400).json({ success: false, error: 'Anexo muito grande (máx ~1.5MB)' });
      return;
    }

    const contentType = req.body.contentType ? String(req.body.contentType).slice(0, 128) : null;
    const buf = Buffer.from(dataBase64, 'base64');
    let storageKey: string | null = null;
    let storedBase64: string | null = dataBase64;
    let sizeBytes = buf.length;

    const { isObjectStorageEnabled, putAttachmentObject } = await import('../lib/storage.js');
    if (isObjectStorageEnabled()) {
      const put = await putAttachmentObject({
        organizationId: req.user!.organizationId,
        ticketId,
        fileName,
        contentType,
        body: buf,
      });
      storageKey = put.storageKey;
      sizeBytes = put.sizeBytes;
      storedBase64 = null;
    } else if (
      process.env.NODE_ENV === 'production' &&
      process.env.ALLOW_DB_ATTACHMENTS !== 'true'
    ) {
      res.status(503).json({
        success: false,
        error: 'Object storage (S3/MinIO) obrigatório em produção para anexos',
      });
      return;
    }

    const attachment = await prisma.ticketAttachment.create({
      data: {
        ticketId,
        fileName: fileName.slice(0, 255),
        contentType,
        sizeBytes,
        dataBase64: storedBase64,
        storageKey,
        uploadedBy: req.user!.email || req.user!.userId,
      },
      select: {
        id: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        storageKey: true,
        createdAt: true,
        uploadedBy: true,
      },
    });
    res.status(201).json({ success: true, data: attachment });
  } catch (err) {
    if (handleTenantError(res, err)) return;
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// ─── Alerts ──────────────────────────────────────────────────────────────────
const alertsRouter = Router();
alertsRouter.use(authenticate);

alertsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const { severity, status } = req.query;
  const { page, limit, skip } = parsePagination(req);
  const scope = await loadUserSiteScope(req.user!.userId);
  const siteFilter = deviceSiteScopeWhere(scope.role, scope.allowedSiteIds);
  const where = {
    organizationId: req.user!.organizationId,
    ...(severity && { severity: severity as 'CRITICAL' | 'WARNING' | 'INFO' }),
    ...(status && { status: status as 'NEW' | 'ACKNOWLEDGED' | 'RESOLVED' }),
    ...siteFilter,
  };
  const [alerts, total] = await Promise.all([
    prisma.alert.findMany({
      where,
      include: { device: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.alert.count({ where }),
  ]);
  res.json({ success: true, data: alerts, meta: paginationMeta(total, page, limit) });
});

alertsRouter.patch('/:id/status', requireWrite, validateBody(updateAlertStatusSchema), auditLog('UPDATE_STATUS', 'Alert'), async (req: AuthRequest, res: Response) => {
  try {
    const id = paramId(req.params.id);
    await assertAlertInOrg(id, req.user!.organizationId);
    const scope = await loadUserSiteScope(req.user!.userId);
    const alertRow = await prisma.alert.findFirst({
      where: { id, organizationId: req.user!.organizationId },
      include: { device: { select: { siteId: true } } },
    });
    if (!alertRow || !isSiteAllowed(scope.role, scope.allowedSiteIds, alertRow.device?.siteId)) {
      res.status(404).json({ success: false, error: 'Alerta não encontrado' });
      return;
    }
    const alert = await prisma.alert.update({
      where: { id },
      data: {
        status: req.body.status,
        ...(req.body.status === 'RESOLVED'
          ? { resolvedAt: new Date(), openKey: null }
          : {}),
      },
    });
    res.json({ success: true, data: alert });
  } catch (err) {
    if (handleTenantError(res, err)) return;
    throw err;
  }
});

alertsRouter.get('/rules', asyncHandler(async (req: AuthRequest, res: Response) => {
  const rules = await prisma.alertRule.findMany({
    where: { organizationId: req.user!.organizationId },
  });
  res.json({ success: true, data: rules });
}));

alertsRouter.post(
  '/rules',
  requireWrite,
  validateBody(createAlertRuleSchema),
  auditLog('CREATE', 'AlertRule'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const rule = await prisma.alertRule.create({
      data: { ...req.body, organizationId: req.user!.organizationId },
    });
    res.status(201).json({ success: true, data: rule });
  })
);

// ─── Scripts ─────────────────────────────────────────────────────────────────
const scriptsRouter = Router();
scriptsRouter.use(authenticate);

scriptsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const { page, limit, skip } = parsePagination(req, { limit: 50 });
  const where = { organizationId: req.user!.organizationId };
  const [scripts, total] = await Promise.all([
    prisma.script.findMany({
      where,
      orderBy: { name: 'asc' },
      skip,
      take: limit,
    }),
    prisma.script.count({ where }),
  ]);
  res.json({ success: true, data: scripts, meta: paginationMeta(total, page, limit) });
});

scriptsRouter.post('/', requireWrite, validateBody(createScriptSchema), auditLog('CREATE', 'Script'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const script = await prisma.script.create({
    data: { ...req.body, organizationId: req.user!.organizationId },
  });
  res.status(201).json({ success: true, data: script });
}));

scriptsRouter.post('/run', requireWrite, validateBody(runScriptSchema), auditLog('RUN', 'Script'), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    await assertScriptInOrg(req.body.scriptId, orgId);
    const scope = await loadUserSiteScope(req.user!.userId);
    await assertDevicesInSiteScope(req.body.deviceIds, orgId, scope.role, scope.allowedSiteIds);

    const script = await prisma.script.findFirst({
      where: { id: req.body.scriptId, organizationId: orgId },
    });
    if (!script) {
      res.status(404).json({ success: false, error: 'Script não encontrado' });
      return;
    }

    const executions = await Promise.all(
      req.body.deviceIds.map((deviceId: string) =>
        prisma.scriptExecution.create({
          data: {
            scriptId: req.body.scriptId,
            deviceId,
            organizationId: orgId,
            status: 'PENDING',
            awaitingApproval: script.requiresApproval,
            requestedById: req.user!.userId,
          },
        })
      )
    );
    for (const exec of executions) {
      if (!exec.awaitingApproval) {
        await queueScriptExecution(exec.id);
      }
    }
    res.status(201).json({
      success: true,
      data: {
        executions,
        awaitingApproval: script.requiresApproval,
      },
    });
  } catch (err) {
    if (handleTenantError(res, err)) return;
    throw err;
  }
});

scriptsRouter.post(
  '/executions/:id/approve',
  requireRole('ADMIN'),
  auditLog('APPROVE', 'ScriptExecution'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = paramId(req.params.id);
    const orgId = req.user!.organizationId;
    const userId = req.user!.userId;

    const exec = await prisma.scriptExecution.findFirst({
      where: { id, organizationId: orgId, awaitingApproval: true },
    });
    if (!exec) {
      res.status(404).json({ success: false, error: 'Execução aguardando aprovação não encontrada' });
      return;
    }
    if (exec.requestedById && exec.requestedById === userId) {
      res.status(403).json({
        success: false,
        error: 'Dual-control: o solicitante não pode aprovar a própria execução',
      });
      return;
    }

    // Update condicional: só um aprovador vence a race
    const claimed = await prisma.scriptExecution.updateMany({
      where: { id, organizationId: orgId, awaitingApproval: true },
      data: {
        awaitingApproval: false,
        approvedById: userId,
        approvedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      res.status(409).json({
        success: false,
        error: 'Execução já foi aprovada ou não está mais pendente',
      });
      return;
    }

    const updated = await prisma.scriptExecution.findFirst({
      where: { id, organizationId: orgId },
    });
    await queueScriptExecution(id);
    res.json({ success: true, data: updated });
  })
);

scriptsRouter.get('/executions', async (req: AuthRequest, res: Response) => {
  const { page, limit, skip } = parsePagination(req, { limit: 50 });
  const scope = await loadUserSiteScope(req.user!.userId);
  const where = {
    organizationId: req.user!.organizationId,
    ...deviceSiteScopeWhere(scope.role, scope.allowedSiteIds),
  };
  const [executions, total] = await Promise.all([
    prisma.scriptExecution.findMany({
      where,
      include: {
        script: { select: { name: true } },
        device: { select: { name: true, siteId: true } },
      },
      orderBy: { startedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.scriptExecution.count({ where }),
  ]);
  res.json({ success: true, data: executions, meta: paginationMeta(total, page, limit) });
});

// ─── Patches ─────────────────────────────────────────────────────────────────
const patchesRouter = Router();
patchesRouter.use(authenticate);

patchesRouter.get('/', async (req: AuthRequest, res: Response) => {
  const { page, limit, skip } = parsePagination(req);
  const scope = await loadUserSiteScope(req.user!.userId);
  const where = {
    organizationId: req.user!.organizationId,
    ...deviceSiteScopeWhere(scope.role, scope.allowedSiteIds),
  };
  const [patches, total] = await Promise.all([
    prisma.patch.findMany({
      where,
      include: { device: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.patch.count({ where }),
  ]);
  res.json({ success: true, data: patches, meta: paginationMeta(total, page, limit) });
});

patchesRouter.get('/compliance', async (req: AuthRequest, res: Response) => {
  const scope = await loadUserSiteScope(req.user!.userId);
  const deviceWhere = {
    organizationId: req.user!.organizationId,
    ...siteScopeWhere(scope.role, scope.allowedSiteIds),
  };
  const total = await prisma.device.count({ where: deviceWhere });
  const withPending = await prisma.device.count({
    where: { ...deviceWhere, patchesAvailable: { gt: 0 } },
  });
  const compliance = total > 0 ? Math.round(((total - withPending) / total) * 100) : 100;
  res.json({ success: true, data: { total, withPending, compliance } });
});

patchesRouter.post('/schedule', requireWrite, validateBody(schedulePatchSchema), auditLog('SCHEDULE', 'Patch'), async (req: AuthRequest, res: Response) => {
  try {
    await assertPatchesInOrg(req.body.patchIds, req.user!.organizationId);
    await prisma.patch.updateMany({
      where: {
        id: { in: req.body.patchIds },
        organizationId: req.user!.organizationId,
      },
      data: { status: 'SCHEDULED', scheduledAt: new Date(req.body.scheduledAt) },
    });

    const patches = await prisma.patch.findMany({
      where: { id: { in: req.body.patchIds }, organizationId: req.user!.organizationId },
      include: { device: { select: { agentId: true } } },
    });
    const { getIo } = await import('../lib/io.js');
    const { emitAgentCommand } = await import('../socket.js');
    const io = getIo();
    if (io) {
      const byAgent = new Map<string, typeof patches>();
      for (const p of patches) {
        if (!p.device.agentId) continue;
        const list = byAgent.get(p.device.agentId) || [];
        list.push(p);
        byAgent.set(p.device.agentId, list);
      }
      for (const [agentId, list] of byAgent) {
        emitAgentCommand(io, agentId, {
          type: 'patch:install',
          patches: list.map((p) => ({
            id: p.id,
            title: p.title,
            kbId: p.kbId,
            severity: p.severity,
          })),
        });
      }
    }

    res.json({ success: true, data: { message: 'Patches agendados' } });
  } catch (err) {
    if (handleTenantError(res, err)) return;
    throw err;
  }
});

// ─── Knowledge Base ──────────────────────────────────────────────────────────
const knowledgeRouter = Router();
knowledgeRouter.use(authenticate);

knowledgeRouter.get('/', async (req: AuthRequest, res: Response) => {
  const { page, limit, skip } = parsePagination(req);
  const where = { organizationId: req.user!.organizationId };
  const [articles, total] = await Promise.all([
    prisma.knowledgeArticle.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.knowledgeArticle.count({ where }),
  ]);
  res.json({ success: true, data: articles, meta: paginationMeta(total, page, limit) });
});

knowledgeRouter.post('/', requireWrite, validateBody(createArticleSchema), auditLog('CREATE', 'KnowledgeArticle'), async (req: AuthRequest, res: Response) => {
  const article = await prisma.knowledgeArticle.create({
    data: { ...req.body, organizationId: req.user!.organizationId },
  });
  res.status(201).json({ success: true, data: article });
});

knowledgeRouter.patch('/:id', requireWrite, validateBody(createArticleSchema.partial()), auditLog('UPDATE', 'KnowledgeArticle'), async (req: AuthRequest, res: Response) => {
  const id = paramId(req.params.id);
  const existing = await prisma.knowledgeArticle.findFirst({
    where: { id, organizationId: req.user!.organizationId },
  });
  if (!existing) {
    res.status(404).json({ success: false, error: 'Artigo não encontrado' });
    return;
  }
  const article = await prisma.knowledgeArticle.update({ where: { id }, data: req.body });
  res.json({ success: true, data: article });
});

knowledgeRouter.delete('/:id', requireWrite, auditLog('DELETE', 'KnowledgeArticle'), async (req: AuthRequest, res: Response) => {
  const id = paramId(req.params.id);
  const existing = await prisma.knowledgeArticle.findFirst({
    where: { id, organizationId: req.user!.organizationId },
  });
  if (!existing) {
    res.status(404).json({ success: false, error: 'Artigo não encontrado' });
    return;
  }
  await prisma.knowledgeArticle.delete({ where: { id } });
  res.json({ success: true, data: { message: 'Artigo removido' } });
});

// ─── Assets ──────────────────────────────────────────────────────────────────
const assetsRouter = Router();
assetsRouter.use(authenticate);

assetsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const { page, limit, skip } = parsePagination(req);
  const scope = await loadUserSiteScope(req.user!.userId);
  const where = {
    organizationId: req.user!.organizationId,
    ...siteScopeWhere(scope.role, scope.allowedSiteIds),
  };
  const [assets, total] = await Promise.all([
    prisma.asset.findMany({
      where,
      orderBy: { name: 'asc' },
      skip,
      take: limit,
    }),
    prisma.asset.count({ where }),
  ]);
  res.json({ success: true, data: assets, meta: paginationMeta(total, page, limit) });
});

assetsRouter.post('/', requireWrite, validateBody(createAssetSchema), auditLog('CREATE', 'Asset'), async (req: AuthRequest, res: Response) => {
  try {
    const scope = await loadUserSiteScope(req.user!.userId);
    if (req.body.siteId) {
      await assertSiteAllowed(req.body.siteId, req.user!.organizationId, scope.role, scope.allowedSiteIds);
    } else if (parseAllowedSiteIds(scope.allowedSiteIds).length > 0 && scope.role !== 'ADMIN') {
      res.status(400).json({ success: false, error: 'siteId é obrigatório para o seu escopo' });
      return;
    }
    const asset = await prisma.asset.create({
      data: {
        name: req.body.name,
        type: req.body.type,
        manufacturer: req.body.manufacturer,
        model: req.body.model,
        serialNumber: req.body.serialNumber,
        purchaseDate: req.body.purchaseDate ? new Date(req.body.purchaseDate) : null,
        warrantyEnd: req.body.warrantyEnd ? new Date(req.body.warrantyEnd) : null,
        licenseKey: req.body.licenseKey,
        siteId: req.body.siteId || null,
        organizationId: req.user!.organizationId,
      },
    });
    res.status(201).json({ success: true, data: asset });
  } catch (err) {
    if (handleTenantError(res, err)) return;
    throw err;
  }
});

// ─── Network Discovery ───────────────────────────────────────────────────────
const networkRouter = Router();
networkRouter.use(authenticate);

networkRouter.get('/scans', async (req: AuthRequest, res: Response) => {
  const { page, limit, skip } = parsePagination(req, { limit: 20 });
  const scope = await loadUserSiteScope(req.user!.userId);
  const where = {
    organizationId: req.user!.organizationId,
    ...siteScopeWhere(scope.role, scope.allowedSiteIds),
  };
  const [scans, total] = await Promise.all([
    prisma.networkScan.findMany({
      where,
      include: { discoveredDevices: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.networkScan.count({ where }),
  ]);
  res.json({ success: true, data: scans, meta: paginationMeta(total, page, limit) });
});

networkRouter.post('/scans', requireWrite, auditLog('CREATE', 'NetworkScan'), async (req: AuthRequest, res: Response) => {
  try {
  const subnet = String(req.body.subnet || '').trim();
  if (!subnet) {
    res.status(400).json({ success: false, error: 'subnet é obrigatório (ex: 192.168.1.0/24)' });
    return;
  }

  const scope = await loadUserSiteScope(req.user!.userId);
  if (req.body.siteId) {
    await assertSiteAllowed(
      String(req.body.siteId),
      req.user!.organizationId,
      scope.role,
      scope.allowedSiteIds
    );
  }

  let mode: 'agent' | 'api' =
    req.body.viaAgent || req.body.mode === 'agent' || req.body.deviceId ? 'agent' : 'api';
  if (
    mode === 'api' &&
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_API_NETWORK_SCAN !== 'true'
  ) {
    res.status(400).json({
      success: false,
      error: 'Em production use scan via agent (deviceId). Lab: ALLOW_API_NETWORK_SCAN=true',
    });
    return;
  }

  let scannerDeviceId: string | undefined;
  if (mode === 'agent' && req.body.deviceId) {
    const device = await prisma.device.findFirst({
      where: {
        id: String(req.body.deviceId),
        organizationId: req.user!.organizationId,
        agentId: { not: null },
      },
    });
    if (!device) {
      res.status(400).json({ success: false, error: 'deviceId inválido ou sem agent' });
      return;
    }
    if (device.siteId) {
      await assertSiteAllowed(
        device.siteId,
        req.user!.organizationId,
        scope.role,
        scope.allowedSiteIds
      );
    }
    scannerDeviceId = device.id;
  }

  const scan = await prisma.networkScan.create({
    data: {
      name: req.body.name || `Scan ${subnet}`,
      subnet,
      siteId: req.body.siteId,
      organizationId: req.user!.organizationId,
      status: mode === 'agent' ? 'PENDING' : 'RUNNING',
      mode,
      scannerDeviceId,
      startedAt: mode === 'api' ? new Date() : undefined,
    },
  });

  if (mode === 'agent') {
    // Agent busca no heartbeat / socket
    if (scannerDeviceId) {
      const device = await prisma.device.findUnique({
        where: { id: scannerDeviceId },
        select: { agentId: true },
      });
      if (device?.agentId) {
        const { getIo } = await import('../lib/io.js');
        const { emitAgentCommand } = await import('../socket.js');
        const io = getIo();
        if (io) {
          emitAgentCommand(io, device.agentId, {
            type: 'network:scan',
            scan: { id: scan.id, subnet, maxHosts: Number(req.body.maxHosts) || 64 },
          });
        }
      }
    }
    res.status(201).json({ success: true, data: scan });
    return;
  }

  // Scan assíncrono na API (útil em lab / mesma rede)
  setImmediate(async () => {
    try {
      const { scanSubnet } = await import('../lib/network-scanner.js');
      const found = await scanSubnet(subnet, { maxHosts: Number(req.body.maxHosts) || 64 });
      if (found.length > 0) {
        await prisma.discoveredDevice.createMany({
          data: found.map((d) => ({
            ipAddress: d.ipAddress,
            hostname: d.hostname,
            deviceType: d.deviceType,
            scanId: scan.id,
          })),
        });
      }
      await prisma.networkScan.update({
        where: { id: scan.id },
        data: {
          status: 'COMPLETED',
          devicesFound: found.length,
          completedAt: new Date(),
        },
      });
    } catch (err) {
      await prisma.networkScan.update({
        where: { id: scan.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
        },
      });
      console.error('Network scan failed:', err);
    }
  });

  res.status(201).json({ success: true, data: scan });
  } catch (err) {
    if (handleTenantError(res, err)) return;
    throw err;
  }
});

networkRouter.post('/discovered/:id/promote', requireWrite, auditLog('PROMOTE', 'DiscoveredDevice'), async (req: AuthRequest, res: Response) => {
  try {
    const id = paramId(req.params.id);
    const discovered = await prisma.discoveredDevice.findFirst({
      where: { id, scan: { organizationId: req.user!.organizationId } },
      include: { scan: true },
    });
    if (!discovered) {
      res.status(404).json({ success: false, error: 'Dispositivo descoberta não encontrado' });
      return;
    }
    if (discovered.promoted) {
      res.status(400).json({ success: false, error: 'Já promovido' });
      return;
    }

    const device = await prisma.device.create({
      data: {
        name: discovered.hostname || discovered.ipAddress,
        hostname: discovered.hostname || discovered.ipAddress,
        type: (discovered.deviceType as 'PC' | 'SERVER' | 'MOBILE' | 'NETWORK') || 'PC',
        siteId: req.body.siteId || discovered.scan.siteId || null,
        organizationId: req.user!.organizationId,
        status: 'UNKNOWN',
      },
    });
    await prisma.discoveredDevice.update({
      where: { id },
      data: { promoted: true },
    });
    res.status(201).json({ success: true, data: device });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// ─── Referrals ───────────────────────────────────────────────────────────────
const referralsRouter = Router();
referralsRouter.use(authenticate);

referralsRouter.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const org = await prisma.organization.findUnique({ where: { id: req.user!.organizationId } });
  const referrals = await prisma.referral.findMany({
    where: { organizationId: req.user!.organizationId },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data: { referralCode: org?.referralCode, referrals } });
}));

referralsRouter.post('/', auditLog('CREATE', 'Referral'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const referral = await prisma.referral.create({
    data: { email: req.body.email, organizationId: req.user!.organizationId },
  });
  res.status(201).json({ success: true, data: referral });
}));

// ─── Integrations ────────────────────────────────────────────────────────────
const integrationsRouter = Router();
integrationsRouter.use(authenticate);

integrationsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const integrations = await prisma.integration.findMany({
    where: { organizationId: req.user!.organizationId },
    orderBy: { name: 'asc' },
  });
  // Nunca expõe tokens OAuth — só metadados públicos
  const safe = integrations.map((i) => {
    const cfg = (i.config && typeof i.config === 'object' ? i.config : {}) as Record<string, unknown>;
    return {
      id: i.id,
      name: i.name,
      slug: i.slug,
      connected: i.connected,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
      config: {
        provider: cfg.provider,
        connectedAt: cfg.connectedAt,
        encrypted: Boolean(cfg.encrypted || cfg.payload),
        scope: cfg.scope,
        team: cfg.team,
        tokenType: cfg.tokenType,
      },
    };
  });
  res.json({ success: true, data: safe });
});

integrationsRouter.patch(
  '/:slug',
  requireWrite,
  auditLog('UPDATE', 'Integration'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const integration = await prisma.integration.update({
      where: {
        slug_organizationId: { slug: paramId(req.params.slug), organizationId: req.user!.organizationId },
      },
      data: {
        connected: req.body.connected,
        ...(req.body.connected === false ? { config: { disconnectedAt: new Date().toISOString() } } : {}),
      },
    });
    res.json({
      success: true,
      data: {
        id: integration.id,
        name: integration.name,
        slug: integration.slug,
        connected: integration.connected,
      },
    });
  })
);

// ─── Admin ───────────────────────────────────────────────────────────────────
const adminRouter = Router();
adminRouter.use(authenticate);
adminRouter.use(requireRole('ADMIN'));

adminRouter.get('/users', async (req: AuthRequest, res: Response) => {
  const { page, limit, skip } = parsePagination(req, { limit: 50 });
  const where = { organizationId: req.user!.organizationId };
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: { id: true, email: true, name: true, role: true, twoFactorEnabled: true, allowedSiteIds: true, createdAt: true },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where }),
  ]);
  res.json({ success: true, data: users, meta: paginationMeta(total, page, limit) });
});

adminRouter.patch('/users/:id', auditLog('UPDATE', 'User'), async (req: AuthRequest, res: Response) => {
  const id = paramId(req.params.id);
  const existing = await prisma.user.findFirst({
    where: { id, organizationId: req.user!.organizationId },
  });
  if (!existing) {
    res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    return;
  }
  const data: { role?: 'ADMIN' | 'TECHNICIAN' | 'READ_ONLY'; allowedSiteIds?: string[] } = {};
  if (req.body?.role && ['ADMIN', 'TECHNICIAN', 'READ_ONLY'].includes(req.body.role)) {
    data.role = req.body.role;
  }
  if (Array.isArray(req.body?.allowedSiteIds)) {
    data.allowedSiteIds = req.body.allowedSiteIds.filter((s: unknown) => typeof s === 'string');
  }
  if (Object.keys(data).length === 0) {
    res.status(400).json({ success: false, error: 'Informe role e/ou allowedSiteIds' });
    return;
  }
  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, email: true, name: true, role: true, allowedSiteIds: true },
  });
  res.json({ success: true, data: user });
});

adminRouter.get('/threshold-profiles', async (req: AuthRequest, res: Response) => {
  const profiles = await prisma.thresholdProfile.findMany({
    where: { organizationId: req.user!.organizationId },
  });
  res.json({ success: true, data: profiles });
});

adminRouter.post('/threshold-profiles', validateBody(createThresholdProfileSchema), auditLog('CREATE', 'ThresholdProfile'), async (req: AuthRequest, res: Response) => {
  const profile = await prisma.thresholdProfile.create({
    data: { ...req.body, organizationId: req.user!.organizationId },
  });
  res.status(201).json({ success: true, data: profile });
});

adminRouter.get('/audit-logs', async (req: AuthRequest, res: Response) => {
  const { page, limit, skip } = parsePagination(req, { limit: 50 });
  const where = { organizationId: req.user!.organizationId };
  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);
  res.json({ success: true, data: logs, meta: paginationMeta(total, page, limit) });
});

adminRouter.get('/organization', async (req: AuthRequest, res: Response) => {
  const org = await prisma.organization.findUnique({
    where: { id: req.user!.organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
      agentToken: true,
      portalToken: true,
      referralCode: true,
      billingEmail: true,
      plan: true,
      aiCredits: true,
      alertWebhookUrl: true,
      agentMinVersion: true,
      requireTwoFactor: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  res.json({ success: true, data: org });
});

adminRouter.patch('/organization', auditLog('UPDATE', 'Organization'), async (req: AuthRequest, res: Response) => {
  const alertWebhookUrl =
    req.body?.alertWebhookUrl === null || req.body?.alertWebhookUrl === ''
      ? null
      : typeof req.body?.alertWebhookUrl === 'string'
        ? String(req.body.alertWebhookUrl).trim()
        : undefined;
  const billingEmail =
    typeof req.body?.billingEmail === 'string' ? String(req.body.billingEmail).trim() : undefined;
  const agentMinVersion =
    req.body?.agentMinVersion === null || req.body?.agentMinVersion === ''
      ? null
      : typeof req.body?.agentMinVersion === 'string'
        ? String(req.body.agentMinVersion).trim()
        : undefined;
  const requireTwoFactor =
    typeof req.body?.requireTwoFactor === 'boolean' ? req.body.requireTwoFactor : undefined;

  const org = await prisma.organization.update({
    where: { id: req.user!.organizationId },
    data: {
      ...(alertWebhookUrl !== undefined ? { alertWebhookUrl } : {}),
      ...(billingEmail !== undefined ? { billingEmail: billingEmail || null } : {}),
      ...(agentMinVersion !== undefined ? { agentMinVersion } : {}),
      ...(requireTwoFactor !== undefined ? { requireTwoFactor } : {}),
    },
    select: {
      id: true,
      name: true,
      slug: true,
      billingEmail: true,
      alertWebhookUrl: true,
      agentMinVersion: true,
      requireTwoFactor: true,
    },
  });
  res.json({ success: true, data: org });
});

adminRouter.post('/organization/rotate-token', auditLog('ROTATE_TOKEN', 'Organization'), async (req: AuthRequest, res: Response) => {
  const type = req.body?.type;
  if (type !== 'agent' && type !== 'portal') {
    res.status(400).json({ success: false, error: "type deve ser 'agent' ou 'portal'" });
    return;
  }
  const newToken = randomBytes(24).toString('hex');
  const org = await prisma.organization.update({
    where: { id: req.user!.organizationId },
    data: type === 'agent' ? { agentToken: newToken } : { portalToken: newToken },
    select: {
      id: true,
      agentToken: true,
      portalToken: true,
    },
  });
  res.json({
    success: true,
    data: {
      type,
      token: type === 'agent' ? org.agentToken : org.portalToken,
      organization: org,
    },
  });
});

// ─── Reports ─────────────────────────────────────────────────────────────────
const reportsRouter = Router();
reportsRouter.use(authenticate);

reportsRouter.get('/:category', async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  const category = paramId(req.params.category);
  const filters = parseReportFilters(req);
  const scope = await loadUserSiteScope(req.user!.userId);
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true },
  });

  const allowedIds = parseAllowedSiteIds(scope.allowedSiteIds);
  let siteFilter: string | { in: string[] } | undefined = filters.siteId || undefined;
  if (filters.siteId) {
    try {
      await assertSiteAllowed(filters.siteId, orgId, scope.role, scope.allowedSiteIds);
    } catch (err) {
      if (handleTenantError(res, err)) return;
      throw err;
    }
  } else if (scope.role !== 'ADMIN' && allowedIds.length > 0) {
    siteFilter = { in: allowedIds };
  }

  let data: Record<string, unknown> = {};
  const deviceWhere = {
    organizationId: orgId,
    ...(siteFilter ? { siteId: siteFilter } : {}),
    ...(filters.createdAt ? { createdAt: filters.createdAt } : {}),
  };
  const ticketWhere = {
    organizationId: orgId,
    ...(siteFilter ? { siteId: siteFilter } : {}),
    ...(filters.createdAt ? { createdAt: filters.createdAt } : {}),
  };
  const patchWhere = {
    organizationId: orgId,
    status: { in: ['PENDING', 'SCHEDULED'] as ('PENDING' | 'SCHEDULED')[] },
    ...(filters.createdAt ? { createdAt: filters.createdAt } : {}),
    ...(siteFilter ? { device: { siteId: siteFilter } } : {}),
  };
  const invoiceWhere = {
    organizationId: orgId,
    ...(filters.createdAt ? { createdAt: filters.createdAt } : {}),
    ...(siteFilter ? { siteId: siteFilter } : {}),
  };

  switch (category) {
    case 'devices': {
      const [devices, bySite, byType] = await Promise.all([
        prisma.device.groupBy({ by: ['status'], where: deviceWhere, _count: true }),
        prisma.device.groupBy({ by: ['siteId'], where: deviceWhere, _count: true }),
        prisma.device.groupBy({ by: ['type'], where: deviceWhere, _count: true }),
      ]);
      const siteIds = bySite.map((s) => s.siteId).filter(Boolean) as string[];
      const sites = siteIds.length
        ? await prisma.site.findMany({ where: { id: { in: siteIds } }, select: { id: true, name: true } })
        : [];
      const siteName = Object.fromEntries(sites.map((s) => [s.id, s.name]));
      data = {
        devices,
        byType,
        bySite: bySite.map((s) => ({
          siteId: s.siteId,
          siteName: s.siteId ? siteName[s.siteId] || s.siteId : 'Sem site',
          _count: s._count,
        })),
        organizationName: org?.name,
        filters: { from: filters.from?.toISOString(), to: filters.to?.toISOString(), siteId: filters.siteId },
      };
      break;
    }
    case 'tickets-sla': {
      const [byStatus, byPriority, breached, openBySite] = await Promise.all([
        prisma.ticket.groupBy({ by: ['status'], where: ticketWhere, _count: true }),
        prisma.ticket.groupBy({ by: ['priority'], where: ticketWhere, _count: true }),
        prisma.ticket.count({ where: { ...ticketWhere, slaBreached: true } }),
        prisma.ticket.groupBy({
          by: ['siteId'],
          where: { ...ticketWhere, status: { in: ['OPEN', 'PENDING'] } },
          _count: true,
        }),
      ]);
      data = {
        byStatus,
        byPriority,
        breached,
        openBySite,
        organizationName: org?.name,
        filters: { from: filters.from?.toISOString(), to: filters.to?.toISOString(), siteId: filters.siteId },
      };
      break;
    }
    case 'patch-compliance': {
      const total = await prisma.device.count({
        where: {
          organizationId: orgId,
          ...(siteFilter ? { siteId: siteFilter } : {}),
        },
      });
      const updated = await prisma.device.count({
        where: {
          organizationId: orgId,
          patchesAvailable: 0,
          ...(siteFilter ? { siteId: siteFilter } : {}),
        },
      });
      const pendingPatches = await prisma.patch.count({ where: patchWhere });
      const bySeverity = await prisma.patch.groupBy({
        by: ['severity'],
        where: patchWhere,
        _count: true,
      });
      data = {
        total,
        updated,
        compliance: total > 0 ? Math.round((updated / total) * 100) : 100,
        pendingPatches,
        bySeverity,
        organizationName: org?.name,
        filters: { from: filters.from?.toISOString(), to: filters.to?.toISOString(), siteId: filters.siteId },
      };
      break;
    }
    case 'financial': {
      const [contractsCount, revenueAgg, invoicesByStatus, paidSum] = await Promise.all([
        prisma.contract.count({ where: { organizationId: orgId, status: 'ACTIVE' } }),
        prisma.contract.aggregate({
          where: { organizationId: orgId, status: 'ACTIVE' },
          _sum: { value: true },
        }),
        prisma.invoice.groupBy({
          by: ['status'],
          where: invoiceWhere,
          _count: true,
          _sum: { total: true },
        }),
        prisma.invoice.aggregate({
          where: { ...invoiceWhere, status: 'PAID' },
          _sum: { total: true },
        }),
      ]);
      data = {
        revenue: revenueAgg._sum.value || 0,
        contracts: contractsCount,
        invoicesByStatus,
        paidTotal: paidSum._sum.total || 0,
        organizationName: org?.name,
        filters: { from: filters.from?.toISOString(), to: filters.to?.toISOString(), siteId: filters.siteId },
      };
      break;
    }
    default:
      res.status(404).json({ success: false, error: 'Categoria não encontrada' });
      return;
  }

  res.json({ success: true, data });
});

reportsRouter.get('/:category/pdf', async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  const category = paramId(req.params.category);
  const filters = parseReportFilters(req);
  const scope = await loadUserSiteScope(req.user!.userId);
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
  const { streamReportPdf } = await import('../lib/report-pdf.js');

  const allowedIds = parseAllowedSiteIds(scope.allowedSiteIds);
  let siteFilter: string | { in: string[] } | undefined = filters.siteId || undefined;
  if (filters.siteId) {
    try {
      await assertSiteAllowed(filters.siteId, orgId, scope.role, scope.allowedSiteIds);
    } catch (err) {
      if (handleTenantError(res, err)) return;
      throw err;
    }
  } else if (scope.role !== 'ADMIN' && allowedIds.length > 0) {
    siteFilter = { in: allowedIds };
  }

  const periodNote =
    filters.from || filters.to || filters.siteId || siteFilter
      ? `Período: ${filters.from?.toLocaleDateString('pt-BR') || '…'} — ${filters.to?.toLocaleDateString('pt-BR') || '…'}${filters.siteId ? ` · site ${filters.siteId}` : ''}`
      : undefined;

  try {
    if (category === 'devices') {
      const devices = await prisma.device.groupBy({
        by: ['status'],
        where: {
          organizationId: orgId,
          ...(siteFilter ? { siteId: siteFilter } : {}),
          ...(filters.createdAt ? { createdAt: filters.createdAt } : {}),
        },
        _count: true,
      });
      streamReportPdf(res, {
        title: 'Relatório de Dispositivos',
        organizationName: org?.name,
        lines: [
          ...(periodNote ? [{ label: 'Filtro', value: periodNote }] : []),
          ...devices.map((d) => ({ label: d.status, value: String(d._count) })),
        ],
      });
      return;
    }
    if (category === 'tickets-sla') {
      const ticketWhere = {
        organizationId: orgId,
        ...(siteFilter ? { siteId: siteFilter } : {}),
        ...(filters.createdAt ? { createdAt: filters.createdAt } : {}),
      };
      const byStatus = await prisma.ticket.groupBy({
        by: ['status'],
        where: ticketWhere,
        _count: true,
      });
      const breached = await prisma.ticket.count({ where: { ...ticketWhere, slaBreached: true } });
      streamReportPdf(res, {
        title: 'Relatório Tickets / SLA',
        organizationName: org?.name,
        lines: [
          ...(periodNote ? [{ label: 'Filtro', value: periodNote }] : []),
          ...byStatus.map((s) => ({ label: s.status, value: String(s._count) })),
          { label: 'SLA estourado', value: String(breached) },
        ],
      });
      return;
    }
    if (category === 'patch-compliance') {
      const total = await prisma.device.count({
        where: {
          organizationId: orgId,
          ...(siteFilter ? { siteId: siteFilter } : {}),
        },
      });
      const updated = await prisma.device.count({
        where: {
          organizationId: orgId,
          patchesAvailable: 0,
          ...(siteFilter ? { siteId: siteFilter } : {}),
        },
      });
      const compliance = total > 0 ? Math.round((updated / total) * 100) : 100;
      streamReportPdf(res, {
        title: 'Relatório Patch / Compliance',
        organizationName: org?.name,
        lines: [
          ...(periodNote ? [{ label: 'Filtro', value: periodNote }] : []),
          { label: 'Dispositivos', value: String(total) },
          { label: 'Em dia', value: String(updated) },
          { label: 'Compliance %', value: String(compliance) },
        ],
      });
      return;
    }
    if (category === 'financial') {
      const revenueAgg = await prisma.contract.aggregate({
        where: { organizationId: orgId, status: 'ACTIVE' },
        _sum: { value: true },
      });
      const contracts = await prisma.contract.count({ where: { organizationId: orgId, status: 'ACTIVE' } });
      const paid = await prisma.invoice.aggregate({
        where: {
          organizationId: orgId,
          status: 'PAID',
          ...(filters.createdAt ? { createdAt: filters.createdAt } : {}),
        },
        _sum: { total: true },
      });
      streamReportPdf(res, {
        title: 'Relatório Financeiro',
        organizationName: org?.name,
        lines: [
          ...(periodNote ? [{ label: 'Filtro', value: periodNote }] : []),
          { label: 'Contratos ativos', value: String(contracts) },
          { label: 'MRR/contratos (soma)', value: String(revenueAgg._sum.value || 0) },
          { label: 'Faturado pago', value: String(paid._sum.total || 0) },
        ],
      });
      return;
    }
    res.status(404).json({ success: false, error: 'Categoria não encontrada' });
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  }
});

// ─── Portal (cliente) ────────────────────────────────────────────────────────
const portalRouter = Router();

portalRouter.get('/tickets', async (req, res: Response) => {
  const org = await resolvePortalOrg(req, res);
  if (!org) return;

  const email = ((req.query.email as string) || '').trim().toLowerCase();
  if (!email) {
    res.status(400).json({ success: false, error: 'email é obrigatório para listar chamados' });
    return;
  }

  const tickets = await prisma.ticket.findMany({
    where: {
      organizationId: org.id,
      status: { not: 'CLOSED' },
      contactEmail: email,
    },
    select: { id: true, number: true, title: true, status: true, priority: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data: tickets, meta: { orgName: org.name } });
});

portalRouter.get('/tickets/:id', async (req, res: Response) => {
  const org = await resolvePortalOrg(req, res);
  if (!org) return;

  const email = ((req.query.email as string) || '').trim().toLowerCase();
  if (!email) {
    res.status(400).json({ success: false, error: 'email é obrigatório' });
    return;
  }

  const ticket = await prisma.ticket.findFirst({
    where: {
      id: paramId(req.params.id),
      organizationId: org.id,
      contactEmail: email,
    },
    select: {
      id: true,
      number: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      createdAt: true,
      updatedAt: true,
      comments: {
        where: { type: 'CUSTOMER' },
        select: {
          id: true,
          content: true,
          type: true,
          createdAt: true,
          author: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      attachments: {
        select: {
          id: true,
          fileName: true,
          contentType: true,
          sizeBytes: true,
          createdAt: true,
          uploadedBy: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!ticket) {
    res.status(404).json({ success: false, error: 'Ticket não encontrado' });
    return;
  }
  res.json({ success: true, data: ticket, meta: { orgName: org.name } });
});

portalRouter.post('/tickets', async (req, res: Response) => {
  try {
    const org = await resolvePortalOrg(req, res);
    if (!org) return;

    const { title, description, email } = req.body;
    if (!title || !email) {
      res.status(400).json({ success: false, error: 'title e email são obrigatórios' });
      return;
    }

    const contactEmail = String(email).trim().toLowerCase();
    const admin = await prisma.user.findFirst({ where: { organizationId: org.id, role: 'ADMIN' } });
    if (!admin) {
      res.status(500).json({ success: false, error: 'Configuração inválida' });
      return;
    }

    const ticket = await createTicket({
      organizationId: org.id,
      creatorId: admin.id,
      title,
      description: description || null,
      contactEmail,
      priority: 'MEDIUM',
    });
    await writeAudit(org.id, 'CREATE', 'Ticket', admin.id, ticket.id, {
      source: 'portal',
      email: contactEmail,
    });
    res.status(201).json({ success: true, data: ticket });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

portalRouter.post('/tickets/:id/comments', async (req, res: Response) => {
  try {
    const org = await resolvePortalOrg(req, res);
    if (!org) return;

    const email = String(req.body?.email || '').trim().toLowerCase();
    const content = String(req.body?.content || '').trim();
    if (!email || !content) {
      res.status(400).json({ success: false, error: 'email e content são obrigatórios' });
      return;
    }

    const ticket = await prisma.ticket.findFirst({
      where: {
        id: paramId(req.params.id),
        organizationId: org.id,
        contactEmail: email,
      },
    });
    if (!ticket) {
      res.status(404).json({ success: false, error: 'Ticket não encontrado' });
      return;
    }
    if (ticket.status === 'CLOSED') {
      res.status(400).json({ success: false, error: 'Chamado fechado — não é possível comentar' });
      return;
    }

    const admin = await prisma.user.findFirst({
      where: { organizationId: org.id, role: 'ADMIN' },
      select: { id: true },
    });
    if (!admin) {
      res.status(500).json({ success: false, error: 'Configuração inválida' });
      return;
    }

    const comment = await prisma.ticketComment.create({
      data: {
        ticketId: ticket.id,
        authorId: admin.id,
        type: 'CUSTOMER',
        content: `[Portal · ${email}]\n${content}`,
      },
      select: {
        id: true,
        content: true,
        type: true,
        createdAt: true,
        author: { select: { name: true } },
      },
    });
    res.status(201).json({ success: true, data: comment });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

portalRouter.get('/knowledge', asyncHandler(async (req, res: Response) => {
  const org = await resolvePortalOrg(req, res);
  if (!org) return;

  const articles = await prisma.knowledgeArticle.findMany({
    where: { organizationId: org.id, visibility: 'PUBLIC' },
    select: { id: true, title: true, category: true, updatedAt: true },
  });
  res.json({ success: true, data: articles, meta: { orgName: org.name } });
}));

/** Devices dos sites onde o contato já abriu tickets */
portalRouter.get('/devices', asyncHandler(async (req, res: Response) => {
  const org = await resolvePortalOrg(req, res);
  if (!org) return;

  const email = ((req.query.email as string) || '').trim().toLowerCase();
  if (!email) {
    res.status(400).json({ success: false, error: 'email é obrigatório' });
    return;
  }

  const tickets = await prisma.ticket.findMany({
    where: { organizationId: org.id, contactEmail: email, siteId: { not: null } },
    select: { siteId: true },
    distinct: ['siteId'],
  });
  const siteIds = tickets.map((t) => t.siteId!).filter(Boolean);
  if (siteIds.length === 0) {
    res.json({ success: true, data: [], meta: { orgName: org.name, note: 'Sem sites vinculados a este e-mail' } });
    return;
  }

  const devices = await prisma.device.findMany({
    where: { organizationId: org.id, siteId: { in: siteIds } },
    select: {
      id: true,
      name: true,
      hostname: true,
      status: true,
      lastSeenAt: true,
      site: { select: { id: true, name: true } },
    },
    orderBy: { name: 'asc' },
    take: 200,
  });
  res.json({ success: true, data: devices, meta: { orgName: org.name } });
}));

portalRouter.post('/tickets/:id/attachments', async (req, res: Response) => {
  try {
    const org = await resolvePortalOrg(req, res);
    if (!org) return;

    const email = String(req.body?.email || '').trim().toLowerCase();
    const fileName = String(req.body?.fileName || '').trim();
    const dataBase64 = String(req.body?.dataBase64 || '');
    if (!email || !fileName || !dataBase64) {
      res.status(400).json({ success: false, error: 'email, fileName e dataBase64 são obrigatórios' });
      return;
    }
    if (dataBase64.length > 2_000_000) {
      res.status(400).json({ success: false, error: 'Anexo muito grande (máx ~1.5MB)' });
      return;
    }

    const ticket = await prisma.ticket.findFirst({
      where: {
        id: paramId(req.params.id),
        organizationId: org.id,
        contactEmail: email,
      },
    });
    if (!ticket) {
      res.status(404).json({ success: false, error: 'Ticket não encontrado' });
      return;
    }

    const contentType = req.body.contentType ? String(req.body.contentType).slice(0, 128) : null;
    const buf = Buffer.from(dataBase64, 'base64');
    let storageKey: string | null = null;
    let storedBase64: string | null = dataBase64;
    let sizeBytes = buf.length;

    const { isObjectStorageEnabled, putAttachmentObject } = await import('../lib/storage.js');
    if (isObjectStorageEnabled()) {
      const put = await putAttachmentObject({
        organizationId: org.id,
        ticketId: ticket.id,
        fileName,
        contentType,
        body: buf,
      });
      storageKey = put.storageKey;
      sizeBytes = put.sizeBytes;
      storedBase64 = null;
    } else if (
      process.env.NODE_ENV === 'production' &&
      process.env.ALLOW_DB_ATTACHMENTS !== 'true'
    ) {
      res.status(503).json({
        success: false,
        error: 'Object storage (S3/MinIO) obrigatório em produção para anexos',
      });
      return;
    }

    const attachment = await prisma.ticketAttachment.create({
      data: {
        ticketId: ticket.id,
        fileName: fileName.slice(0, 255),
        contentType,
        sizeBytes,
        dataBase64: storedBase64,
        storageKey,
        uploadedBy: email,
      },
      select: { id: true, fileName: true, contentType: true, sizeBytes: true, storageKey: true, createdAt: true },
    });
    res.status(201).json({ success: true, data: attachment });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

// ─── Notifications ───────────────────────────────────────────────────────────
const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;

  const [alerts, tickets] = await Promise.all([
    prisma.alert.findMany({
      where: { organizationId: orgId, status: { in: ['NEW', 'ACKNOWLEDGED'] } },
      include: { device: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    prisma.ticket.findMany({
      where: { organizationId: orgId, status: { in: ['OPEN', 'PENDING'] } },
      include: { site: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ]);

  const notifications = [
    ...alerts.map((a) => ({
      id: `alert-${a.id}`,
      type: 'alert' as const,
      title: a.title,
      subtitle: a.device?.name,
      severity: a.severity,
      createdAt: a.createdAt.toISOString(),
      href: '/alerts',
    })),
    ...tickets.map((t) => ({
      id: `ticket-${t.id}`,
      type: 'ticket' as const,
      title: `#${t.number} ${t.title}`,
      subtitle: t.site?.name,
      createdAt: t.createdAt.toISOString(),
      href: `/tickets/${t.id}`,
    })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 12);

  res.json({ success: true, data: notifications });
});

export {
  ticketsRouter,
  alertsRouter,
  scriptsRouter,
  patchesRouter,
  knowledgeRouter,
  assetsRouter,
  networkRouter,
  referralsRouter,
  integrationsRouter,
  adminRouter,
  reportsRouter,
  portalRouter,
  notificationsRouter,
};
