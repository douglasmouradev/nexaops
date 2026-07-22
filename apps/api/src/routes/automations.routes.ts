import { Router, Response } from 'express';
import { createAutomationSchema } from '@nexaops/shared';
import { authenticate, requireWrite, AuthRequest } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { auditLog } from '../middleware/audit.js';
import { prisma } from '../lib/prisma.js';
import { paramId } from '../lib/params.js';
import { parsePagination, paginationMeta } from '../lib/pagination.js';
import {
  TenantError,
  assertSiteAllowed,
  loadUserSiteScope,
  parseAllowedSiteIds,
} from '../lib/tenant.js';

const router = Router();
router.use(authenticate);

function handleTenantError(res: Response, err: unknown): boolean {
  if (err instanceof TenantError) {
    res.status(err.status).json({ success: false, error: err.message });
    return true;
  }
  return false;
}

function actionSiteId(actionConfig: unknown): string | undefined {
  if (!actionConfig || typeof actionConfig !== 'object') return undefined;
  const siteId = (actionConfig as { siteId?: unknown }).siteId;
  return typeof siteId === 'string' && siteId ? siteId : undefined;
}

function automationVisibleToScope(
  actionConfig: unknown,
  role: string,
  allowedSiteIds: unknown
): boolean {
  if (role === 'ADMIN') return true;
  const ids = parseAllowedSiteIds(allowedSiteIds);
  if (ids.length === 0) return true;
  const siteId = actionSiteId(actionConfig);
  // Org-wide (sem site) só ADMIN com escopo aberto; técnico restrito só vê do seu site
  if (!siteId) return false;
  return ids.includes(siteId);
}

router.get('/', async (req: AuthRequest, res: Response) => {
  const { page, limit, skip } = parsePagination(req);
  const scope = await loadUserSiteScope(req.user!.userId);
  const where = { organizationId: req.user!.organizationId };
  const [allRows, totalAll] = await Promise.all([
    prisma.automationProfile.findMany({
      where,
      include: { script: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.automationProfile.count({ where }),
  ]);
  const rows = allRows.filter((r) =>
    automationVisibleToScope(r.actionConfig, scope.role, scope.allowedSiteIds)
  );
  const total =
    scope.role === 'ADMIN' || parseAllowedSiteIds(scope.allowedSiteIds).length === 0
      ? totalAll
      : rows.length;
  const paged = rows.slice(skip, skip + limit);
  res.json({ success: true, data: paged, meta: paginationMeta(total, page, limit) });
});

router.post('/', requireWrite, validateBody(createAutomationSchema), auditLog('CREATE', 'AutomationProfile'), async (req: AuthRequest, res: Response) => {
  try {
    const scope = await loadUserSiteScope(req.user!.userId);
    const siteId = actionSiteId(req.body.actionConfig) || (req.body.siteId ? String(req.body.siteId) : undefined);
    const ids = parseAllowedSiteIds(scope.allowedSiteIds);
    if (scope.role !== 'ADMIN' && ids.length > 0) {
      if (!siteId) {
        res.status(400).json({ success: false, error: 'actionConfig.siteId é obrigatório no seu escopo' });
        return;
      }
      await assertSiteAllowed(siteId, req.user!.organizationId, scope.role, scope.allowedSiteIds);
    } else if (siteId) {
      await assertSiteAllowed(siteId, req.user!.organizationId, scope.role, scope.allowedSiteIds);
    }

    if (req.body.scriptId) {
      const script = await prisma.script.findFirst({
        where: { id: req.body.scriptId, organizationId: req.user!.organizationId },
      });
      if (!script) {
        res.status(400).json({ success: false, error: 'scriptId inválido' });
        return;
      }
    }

    const actionConfig = {
      ...(req.body.actionConfig && typeof req.body.actionConfig === 'object' ? req.body.actionConfig : {}),
      ...(siteId ? { siteId } : {}),
    };

    const profile = await prisma.automationProfile.create({
      data: {
        name: String(req.body.name),
        description: req.body.description || null,
        trigger: String(req.body.trigger),
        triggerConfig: req.body.triggerConfig || {},
        action: String(req.body.action),
        actionConfig,
        scriptId: req.body.scriptId || null,
        enabled: req.body.enabled !== false,
        organizationId: req.user!.organizationId,
      },
    });
    res.status(201).json({ success: true, data: profile });
  } catch (err) {
    if (handleTenantError(res, err)) return;
    throw err;
  }
});

router.patch('/:id', requireWrite, auditLog('UPDATE', 'AutomationProfile'), async (req: AuthRequest, res: Response) => {
  try {
    const id = paramId(req.params.id);
    const scope = await loadUserSiteScope(req.user!.userId);
    const existing = await prisma.automationProfile.findFirst({
      where: { id, organizationId: req.user!.organizationId },
    });
    if (!existing || !automationVisibleToScope(existing.actionConfig, scope.role, scope.allowedSiteIds)) {
      res.status(404).json({ success: false, error: 'Automação não encontrada' });
      return;
    }
    const nextConfig = req.body.actionConfig !== undefined ? req.body.actionConfig : existing.actionConfig;
    const siteId = actionSiteId(nextConfig);
    if (siteId) {
      await assertSiteAllowed(siteId, req.user!.organizationId, scope.role, scope.allowedSiteIds);
    }
    const profile = await prisma.automationProfile.update({
      where: { id },
      data: {
        ...(req.body.name !== undefined ? { name: String(req.body.name) } : {}),
        ...(req.body.description !== undefined ? { description: req.body.description } : {}),
        ...(req.body.enabled !== undefined ? { enabled: Boolean(req.body.enabled) } : {}),
        ...(req.body.triggerConfig !== undefined ? { triggerConfig: req.body.triggerConfig } : {}),
        ...(req.body.actionConfig !== undefined ? { actionConfig: req.body.actionConfig } : {}),
      },
    });
    res.json({ success: true, data: profile });
  } catch (err) {
    if (handleTenantError(res, err)) return;
    throw err;
  }
});

router.delete('/:id', requireWrite, auditLog('DELETE', 'AutomationProfile'), async (req: AuthRequest, res: Response) => {
  const id = paramId(req.params.id);
  const scope = await loadUserSiteScope(req.user!.userId);
  const existing = await prisma.automationProfile.findFirst({
    where: { id, organizationId: req.user!.organizationId },
  });
  if (!existing || !automationVisibleToScope(existing.actionConfig, scope.role, scope.allowedSiteIds)) {
    res.status(404).json({ success: false, error: 'Automação não encontrada' });
    return;
  }
  await prisma.automationProfile.delete({ where: { id } });
  res.json({ success: true });
});

export default router;
