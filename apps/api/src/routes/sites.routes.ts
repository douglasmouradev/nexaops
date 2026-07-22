import { Router, Response } from 'express';
import { createSiteSchema, updateSiteSchema } from '@nexaops/shared';
import { authenticate, requireWrite, AuthRequest } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { prisma } from '../lib/prisma.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { paramId } from '../lib/params.js';
import { TenantError, loadUserSiteScope, siteScopeWhere, assertSiteAllowed } from '../lib/tenant.js';
import { auditLog } from '../middleware/audit.js';
import { parsePagination, paginationMeta } from '../lib/pagination.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req: AuthRequest, res: Response) => {
  const { page, limit, skip } = parsePagination(req, { limit: 50 });
  const scope = await loadUserSiteScope(req.user!.userId);
  const siteScope = siteScopeWhere(scope.role, scope.allowedSiteIds);
  const where = {
    organizationId: req.user!.organizationId,
    ...(siteScope.siteId ? { id: siteScope.siteId } : {}),
  };
  const [sites, total] = await Promise.all([
    prisma.site.findMany({
      where,
      include: { _count: { select: { devices: true, tickets: true } } },
      orderBy: { name: 'asc' },
      skip,
      take: limit,
    }),
    prisma.site.count({ where }),
  ]);
  res.json({ success: true, data: sites, meta: paginationMeta(total, page, limit) });
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const scope = await loadUserSiteScope(req.user!.userId);
    const id = paramId(req.params.id);
    await assertSiteAllowed(id, req.user!.organizationId, scope.role, scope.allowedSiteIds);
    const site = await prisma.site.findFirst({
      where: { id, organizationId: req.user!.organizationId },
      include: {
        devices: { select: { id: true, name: true, status: true, type: true } },
        contracts: true,
        passwordVaults: { select: { id: true, label: true, username: true, url: true } },
      },
    });
    if (!site) { res.status(404).json({ success: false, error: 'Site não encontrado' }); return; }
    res.json({ success: true, data: site });
  } catch (err) {
    if (err instanceof TenantError) {
      res.status(err.status).json({ success: false, error: err.message });
      return;
    }
    throw err;
  }
});

router.post('/', requireWrite, validateBody(createSiteSchema), auditLog('CREATE', 'Site'), async (req: AuthRequest, res: Response) => {
  const site = await prisma.site.create({
    data: { ...req.body, organizationId: req.user!.organizationId },
  });
  res.status(201).json({ success: true, data: site });
});

router.patch('/:id', requireWrite, validateBody(updateSiteSchema), auditLog('UPDATE', 'Site'), async (req: AuthRequest, res: Response) => {
  try {
    const id = paramId(req.params.id);
    const scope = await loadUserSiteScope(req.user!.userId);
    await assertSiteAllowed(id, req.user!.organizationId, scope.role, scope.allowedSiteIds);
    const site = await prisma.site.update({
      where: { id },
      data: req.body,
    });
    res.json({ success: true, data: site });
  } catch (err) {
    if (err instanceof TenantError) {
      res.status(err.status).json({ success: false, error: err.message });
      return;
    }
    throw err;
  }
});

router.delete('/:id', requireWrite, auditLog('DELETE', 'Site'), async (req: AuthRequest, res: Response) => {
  try {
    const id = paramId(req.params.id);
    const scope = await loadUserSiteScope(req.user!.userId);
    await assertSiteAllowed(id, req.user!.organizationId, scope.role, scope.allowedSiteIds);
    await prisma.site.delete({ where: { id } });
    res.json({ success: true, data: { message: 'Site removido' } });
  } catch (err) {
    if (err instanceof TenantError) {
      res.status(err.status).json({ success: false, error: err.message });
      return;
    }
    throw err;
  }
});

router.post('/:id/vault', requireWrite, auditLog('CREATE', 'PasswordVault'), async (req: AuthRequest, res: Response) => {
  try {
    const siteId = paramId(req.params.id);
    const scope = await loadUserSiteScope(req.user!.userId);
    await assertSiteAllowed(siteId, req.user!.organizationId, scope.role, scope.allowedSiteIds);

    const { label, username, password, url, notes } = req.body;
    if (!label || !password) {
      res.status(400).json({ success: false, error: 'label e password são obrigatórios' });
      return;
    }

    const entry = await prisma.passwordVault.create({
      data: {
        label,
        username,
        encryptedPassword: encrypt(password),
        url,
        notes,
        siteId,
        organizationId: req.user!.organizationId,
      },
    });
    res.status(201).json({ success: true, data: { id: entry.id, label: entry.label } });
  } catch (err) {
    if (err instanceof TenantError) {
      res.status(err.status).json({ success: false, error: err.message });
      return;
    }
    throw err;
  }
});

router.post('/:id/vault/:vaultId/reveal', requireWrite, auditLog('REVEAL', 'PasswordVault'), async (req: AuthRequest, res: Response) => {
  try {
    const siteId = paramId(req.params.id);
    const vaultId = paramId(req.params.vaultId);
    const scope = await loadUserSiteScope(req.user!.userId);
    await assertSiteAllowed(siteId, req.user!.organizationId, scope.role, scope.allowedSiteIds);

    const entry = await prisma.passwordVault.findFirst({
      where: { id: vaultId, siteId, organizationId: req.user!.organizationId },
    });
    if (!entry) {
      res.status(404).json({ success: false, error: 'Entrada não encontrada' });
      return;
    }

    const password = decrypt(entry.encryptedPassword);

    res.json({
      success: true,
      data: {
        id: entry.id,
        label: entry.label,
        username: entry.username,
        password,
        url: entry.url,
        notes: entry.notes,
      },
    });
  } catch (err) {
    if (err instanceof TenantError) {
      res.status(err.status).json({ success: false, error: err.message });
      return;
    }
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

export default router;
