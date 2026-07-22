import { Router, Response } from 'express';
import { createContractSchema, updateContractSchema } from '@nexaops/shared';
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
  siteScopeWhere,
  isSiteAllowed,
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

router.get('/', async (req: AuthRequest, res: Response) => {
  const { page, limit, skip } = parsePagination(req);
  const scope = await loadUserSiteScope(req.user!.userId);
  const where = {
    organizationId: req.user!.organizationId,
    ...siteScopeWhere(scope.role, scope.allowedSiteIds),
  };
  const [contracts, total] = await Promise.all([
    prisma.contract.findMany({
      where,
      include: { site: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.contract.count({ where }),
  ]);
  res.json({ success: true, data: contracts, meta: paginationMeta(total, page, limit) });
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  const scope = await loadUserSiteScope(req.user!.userId);
  const contract = await prisma.contract.findFirst({
    where: {
      id: paramId(req.params.id),
      organizationId: req.user!.organizationId,
      ...siteScopeWhere(scope.role, scope.allowedSiteIds),
    },
    include: { site: { select: { id: true, name: true } } },
  });
  if (!contract) {
    res.status(404).json({ success: false, error: 'Contrato não encontrado' });
    return;
  }
  res.json({ success: true, data: contract });
});

router.post('/', requireWrite, validateBody(createContractSchema), auditLog('CREATE', 'Contract'), async (req: AuthRequest, res: Response) => {
  try {
    const scope = await loadUserSiteScope(req.user!.userId);
    await assertSiteAllowed(req.body.siteId, req.user!.organizationId, scope.role, scope.allowedSiteIds);
    const contract = await prisma.contract.create({
      data: {
        name: req.body.name,
        description: req.body.description,
        startDate: new Date(req.body.startDate),
        endDate: req.body.endDate ? new Date(req.body.endDate) : null,
        value: req.body.value,
        currency: req.body.currency ?? 'BRL',
        status: req.body.status ?? 'ACTIVE',
        siteId: req.body.siteId,
        organizationId: req.user!.organizationId,
      },
      include: { site: { select: { id: true, name: true } } },
    });
    res.status(201).json({ success: true, data: contract });
  } catch (err) {
    if (handleTenantError(res, err)) return;
    throw err;
  }
});

router.patch('/:id', requireWrite, validateBody(updateContractSchema), auditLog('UPDATE', 'Contract'), async (req: AuthRequest, res: Response) => {
  try {
    const id = paramId(req.params.id);
    const scope = await loadUserSiteScope(req.user!.userId);
    const existing = await prisma.contract.findFirst({
      where: { id, organizationId: req.user!.organizationId },
    });
    if (!existing || !isSiteAllowed(scope.role, scope.allowedSiteIds, existing.siteId)) {
      res.status(404).json({ success: false, error: 'Contrato não encontrado' });
      return;
    }

    if (req.body.siteId) {
      await assertSiteAllowed(req.body.siteId, req.user!.organizationId, scope.role, scope.allowedSiteIds);
    }

    const data: Record<string, unknown> = { ...req.body };
    if (req.body.startDate) data.startDate = new Date(req.body.startDate);
    if (req.body.endDate !== undefined) {
      data.endDate = req.body.endDate ? new Date(req.body.endDate) : null;
    }

    const contract = await prisma.contract.update({
      where: { id },
      data,
      include: { site: { select: { id: true, name: true } } },
    });
    res.json({ success: true, data: contract });
  } catch (err) {
    if (handleTenantError(res, err)) return;
    throw err;
  }
});

router.delete('/:id', requireWrite, auditLog('DELETE', 'Contract'), async (req: AuthRequest, res: Response) => {
  const id = paramId(req.params.id);
  const scope = await loadUserSiteScope(req.user!.userId);
  const existing = await prisma.contract.findFirst({
    where: { id, organizationId: req.user!.organizationId },
  });
  if (!existing || !isSiteAllowed(scope.role, scope.allowedSiteIds, existing.siteId)) {
    res.status(404).json({ success: false, error: 'Contrato não encontrado' });
    return;
  }
  await prisma.contract.delete({ where: { id } });
  res.json({ success: true, data: { message: 'Contrato removido' } });
});

export default router;
