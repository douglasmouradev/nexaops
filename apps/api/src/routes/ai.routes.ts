import { Router, Response } from 'express';
import { authenticate, requireWrite, AuthRequest } from '../middleware/auth.js';
import { auditLog } from '../middleware/audit.js';
import { prisma } from '../lib/prisma.js';
import { paramId } from '../lib/params.js';
import { parseFilterWithLlm, chatAssist } from '../lib/llm.js';

const aiRouter = Router();
aiRouter.use(authenticate);

aiRouter.get('/', async (req: AuthRequest, res: Response) => {
  const [features, usage, org] = await Promise.all([
    prisma.aiFeatureToggle.findMany({ where: { organizationId: req.user!.organizationId } }),
    prisma.aiUsageLog.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.organization.findUnique({ where: { id: req.user!.organizationId } }),
  ]);
  res.json({ success: true, data: { features, usage, credits: org?.aiCredits } });
});

aiRouter.patch(
  '/features/:feature',
  requireWrite,
  auditLog('UPDATE', 'AiFeature'),
  async (req: AuthRequest, res: Response) => {
    const feature = await prisma.aiFeatureToggle.upsert({
      where: {
        feature_organizationId: {
          feature: paramId(req.params.feature),
          organizationId: req.user!.organizationId,
        },
      },
      create: {
        feature: paramId(req.params.feature),
        organizationId: req.user!.organizationId,
        enabled: req.body.enabled ?? true,
      },
      update: { enabled: req.body.enabled },
    });
    res.json({ success: true, data: feature });
  }
);

async function ensureAiFeatureEnabled(organizationId: string, feature: string): Promise<void> {
  const toggle = await prisma.aiFeatureToggle.upsert({
    where: { feature_organizationId: { feature, organizationId } },
    create: { feature, organizationId, enabled: true },
    update: {},
  });
  if (!toggle.enabled) {
    throw new Error(`Funcionalidade de IA desativada: ${feature}`);
  }
}

async function consumeAiCredit(organizationId: string, feature: string, details?: string): Promise<number> {
  const claimed = await prisma.organization.updateMany({
    where: { id: organizationId, aiCredits: { gte: 1 } },
    data: { aiCredits: { decrement: 1 } },
  });
  if (claimed.count === 0) {
    throw new Error('Créditos de IA insuficientes');
  }
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { aiCredits: true },
  });
  await prisma.aiUsageLog.create({
    data: { feature, credits: 1, details, organizationId },
  });
  return org?.aiCredits ?? 0;
}

aiRouter.post('/parse-filter', requireWrite, async (req: AuthRequest, res: Response) => {
  try {
    const query = String(req.body.query || req.body.prompt || '').trim();
    if (!query) {
      res.status(400).json({ success: false, error: 'query é obrigatório' });
      return;
    }
    const orgId = req.user!.organizationId;
    await ensureAiFeatureEnabled(orgId, 'parse-filter');
    const credits = await consumeAiCredit(orgId, 'parse-filter', query.slice(0, 500));
    const filter = await parseFilterWithLlm(query.startsWith('@ai') ? query : `@ai ${query}`);
    res.json({ success: true, data: { filter, credits } });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

aiRouter.post('/assist', requireWrite, async (req: AuthRequest, res: Response) => {
  try {
    const prompt = String(req.body.prompt || '').trim();
    if (!prompt) {
      res.status(400).json({ success: false, error: 'prompt é obrigatório' });
      return;
    }
    const orgId = req.user!.organizationId;
    await ensureAiFeatureEnabled(orgId, 'assist');
    const credits = await consumeAiCredit(orgId, 'assist', prompt.slice(0, 500));
    const reply = await chatAssist(prompt);
    res.json({ success: true, data: { reply, credits } });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

export default aiRouter;
export { aiRouter };
