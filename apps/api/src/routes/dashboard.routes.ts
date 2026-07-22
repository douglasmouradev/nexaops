import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { getDashboardStats } from '../services/dashboard.service.js';
import { loadUserSiteScope, siteScopeWhere } from '../lib/tenant.js';

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * /api/dashboard:
 *   get:
 *     tags: [Dashboard]
 *     summary: KPIs e dados do painel principal
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const scope = await loadUserSiteScope(req.user!.userId);
    const siteFilter = siteScopeWhere(scope.role, scope.allowedSiteIds);
    const stats = await getDashboardStats(req.user!.organizationId, siteFilter);
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default router;
