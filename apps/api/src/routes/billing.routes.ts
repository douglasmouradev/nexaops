import { Router, Response } from 'express';
import { createTimeEntrySchema, createInvoiceSchema } from '@nexaops/shared';
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

router.get('/stripe/status', async (_req: AuthRequest, res: Response) => {
  const configured = Boolean(process.env.STRIPE_SECRET_KEY);
  res.json({
    success: true,
    data: {
      configured,
      webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
      mode: configured ? 'live' : 'stub',
    },
  });
});

// ─── Time entries ────────────────────────────────────────────────────────────

router.get('/time-entries', async (req: AuthRequest, res: Response) => {
  const { page, limit, skip } = parsePagination(req);
  const scope = await loadUserSiteScope(req.user!.userId);
  const where = {
    organizationId: req.user!.organizationId,
    ...siteScopeWhere(scope.role, scope.allowedSiteIds),
  };
  const [rows, total] = await Promise.all([
    prisma.timeEntry.findMany({
      where,
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { workedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.timeEntry.count({ where }),
  ]);
  res.json({ success: true, data: rows, meta: paginationMeta(total, page, limit) });
});

router.post('/time-entries', requireWrite, validateBody(createTimeEntrySchema), auditLog('CREATE', 'TimeEntry'), async (req: AuthRequest, res: Response) => {
  try {
    const hours = Number(req.body.hours);
    const scope = await loadUserSiteScope(req.user!.userId);
    if (req.body.siteId) {
      await assertSiteAllowed(
        String(req.body.siteId),
        req.user!.organizationId,
        scope.role,
        scope.allowedSiteIds
      );
    } else {
      const ids = parseAllowedSiteIds(scope.allowedSiteIds);
      if (scope.role !== 'ADMIN' && ids.length > 0) {
        res.status(400).json({ success: false, error: 'siteId é obrigatório no seu escopo de sites' });
        return;
      }
    }
    const entry = await prisma.timeEntry.create({
      data: {
        description: String(req.body.description),
        hours,
        billable: req.body.billable !== false,
        hourlyRate: req.body.hourlyRate != null ? Number(req.body.hourlyRate) : null,
        workedAt: req.body.workedAt ? new Date(req.body.workedAt) : new Date(),
        ticketId: req.body.ticketId || null,
        siteId: req.body.siteId || null,
        userId: req.user!.userId,
        organizationId: req.user!.organizationId,
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    if (handleTenantError(res, err)) return;
    throw err;
  }
});

router.delete('/time-entries/:id', requireWrite, auditLog('DELETE', 'TimeEntry'), async (req: AuthRequest, res: Response) => {
  const id = paramId(req.params.id);
  const scope = await loadUserSiteScope(req.user!.userId);
  const existing = await prisma.timeEntry.findFirst({
    where: { id, organizationId: req.user!.organizationId },
  });
  if (!existing || !isSiteAllowed(scope.role, scope.allowedSiteIds, existing.siteId)) {
    res.status(404).json({ success: false, error: 'Apontamento não encontrado' });
    return;
  }
  await prisma.timeEntry.delete({ where: { id } });
  res.json({ success: true });
});

// ─── Invoices ────────────────────────────────────────────────────────────────

router.get('/invoices', async (req: AuthRequest, res: Response) => {
  const { page, limit, skip } = parsePagination(req);
  const scope = await loadUserSiteScope(req.user!.userId);
  const where = {
    organizationId: req.user!.organizationId,
    ...siteScopeWhere(scope.role, scope.allowedSiteIds),
  };
  const [rows, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: { lines: true },
      orderBy: { number: 'desc' },
      skip,
      take: limit,
    }),
    prisma.invoice.count({ where }),
  ]);
  res.json({ success: true, data: rows, meta: paginationMeta(total, page, limit) });
});

router.post('/invoices', requireWrite, validateBody(createInvoiceSchema), auditLog('CREATE', 'Invoice'), async (req: AuthRequest, res: Response) => {
  try {
    const lines = Array.isArray(req.body.lines) ? req.body.lines : [];

    const scope = await loadUserSiteScope(req.user!.userId);
    if (req.body.siteId) {
      await assertSiteAllowed(
        String(req.body.siteId),
        req.user!.organizationId,
        scope.role,
        scope.allowedSiteIds
      );
    }

    const normalized = lines.map((l: { description?: string; quantity?: number; unitPrice?: number }) => {
      const quantity = Number(l.quantity) || 1;
      const unitPrice = Number(l.unitPrice) || 0;
      return {
        description: String(l.description || 'Item'),
        quantity,
        unitPrice,
        amount: quantity * unitPrice,
      };
    });
    const total = normalized.reduce((s: number, l: { amount: number }) => s + l.amount, 0);

    const last = await prisma.invoice.findFirst({
      where: { organizationId: req.user!.organizationId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const number = (last?.number || 0) + 1;

    const invoice = await prisma.invoice.create({
      data: {
        number,
        status: 'DRAFT',
        currency: req.body.currency || 'BRL',
        total,
        notes: req.body.notes || null,
        siteId: req.body.siteId || null,
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
        organizationId: req.user!.organizationId,
        lines: { create: normalized },
      },
      include: { lines: true },
    });

    res.status(201).json({ success: true, data: invoice });
  } catch (err) {
    if (handleTenantError(res, err)) return;
    throw err;
  }
});

router.patch('/invoices/:id', requireWrite, auditLog('UPDATE', 'Invoice'), async (req: AuthRequest, res: Response) => {
  const id = paramId(req.params.id);
  const scope = await loadUserSiteScope(req.user!.userId);
  const existing = await prisma.invoice.findFirst({
    where: { id, organizationId: req.user!.organizationId },
  });
  if (!existing || !isSiteAllowed(scope.role, scope.allowedSiteIds, existing.siteId)) {
    res.status(404).json({ success: false, error: 'Fatura não encontrada' });
    return;
  }

  const status = req.body.status as string | undefined;
  const allowed = ['DRAFT', 'SENT', 'PAID', 'VOID'];
  if (status && !allowed.includes(status)) {
    res.status(400).json({ success: false, error: 'status inválido' });
    return;
  }

  const invoice = await prisma.invoice.update({
    where: { id },
    data: {
      ...(status ? { status } : {}),
      ...(status === 'SENT' && !existing.issuedAt ? { issuedAt: new Date() } : {}),
      ...(status === 'PAID' ? { paidAt: new Date() } : {}),
      ...(req.body.notes !== undefined ? { notes: req.body.notes } : {}),
    },
    include: { lines: true },
  });
  res.json({ success: true, data: invoice });
});

/** Checkout Stripe (ou stub se STRIPE_SECRET_KEY ausente) */
router.post('/invoices/:id/checkout', requireWrite, auditLog('CHECKOUT', 'Invoice'), async (req: AuthRequest, res: Response) => {
  const id = paramId(req.params.id);
  const scope = await loadUserSiteScope(req.user!.userId);
  const invoice = await prisma.invoice.findFirst({
    where: { id, organizationId: req.user!.organizationId },
    include: { lines: true },
  });
  if (!invoice || !isSiteAllowed(scope.role, scope.allowedSiteIds, invoice.siteId)) {
    res.status(404).json({ success: false, error: 'Fatura não encontrada' });
    return;
  }
  if (invoice.status === 'PAID' || invoice.status === 'VOID') {
    res.status(400).json({ success: false, error: 'Fatura já finalizada' });
    return;
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  const successUrl =
    process.env.STRIPE_SUCCESS_URL ||
    `${process.env.CORS_ORIGIN || 'http://localhost:5173'}/finance/billing?paid=1`;
  const cancelUrl =
    process.env.STRIPE_CANCEL_URL ||
    `${process.env.CORS_ORIGIN || 'http://localhost:5173'}/finance/billing?canceled=1`;

  if (!secret) {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_STRIPE_STUB !== 'true') {
      res.status(503).json({
        success: false,
        error: 'STRIPE_SECRET_KEY não configurada. Defina a chave ou ALLOW_STRIPE_STUB=true',
      });
      return;
    }
    res.json({
      success: true,
      data: {
        url: null,
        stub: true,
        message: 'STRIPE_SECRET_KEY não configurada — use Marcar pago ou configure Stripe',
        invoiceId: invoice.id,
      },
    });
    return;
  }

  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(secret);
    const amountCents = Math.max(50, Math.round(invoice.total * 100));
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: (invoice.currency || 'brl').toLowerCase(),
            unit_amount: amountCents,
            product_data: {
              name: `Fatura #${invoice.number}`,
              description: invoice.notes || undefined,
            },
          },
        },
      ],
      metadata: { invoiceId: invoice.id, organizationId: invoice.organizationId },
    });
    await prisma.invoice.update({
      where: { id },
      data: { stripeSessionId: session.id, status: invoice.status === 'DRAFT' ? 'SENT' : invoice.status, issuedAt: invoice.issuedAt || new Date() },
    });
    res.json({ success: true, data: { url: session.url, sessionId: session.id, stub: false } });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});
router.post('/invoices/from-time-entries', requireWrite, auditLog('CREATE', 'Invoice'), async (req: AuthRequest, res: Response) => {
  const ids = Array.isArray(req.body.timeEntryIds) ? req.body.timeEntryIds.map(String) : [];
  if (ids.length === 0) {
    res.status(400).json({ success: false, error: 'timeEntryIds é obrigatório' });
    return;
  }

  const entries = await prisma.timeEntry.findMany({
    where: {
      id: { in: ids },
      organizationId: req.user!.organizationId,
      billable: true,
    },
  });
  if (entries.length === 0) {
    res.status(400).json({ success: false, error: 'Nenhum apontamento faturável encontrado' });
    return;
  }

  const defaultRate = Number(req.body.defaultHourlyRate) || 150;
  const normalized = entries.map((e) => {
    const unitPrice = e.hourlyRate ?? defaultRate;
    return {
      description: `${e.description} (${e.hours}h)`,
      quantity: e.hours,
      unitPrice,
      amount: e.hours * unitPrice,
    };
  });
  const total = normalized.reduce((s, l) => s + l.amount, 0);

  const last = await prisma.invoice.findFirst({
    where: { organizationId: req.user!.organizationId },
    orderBy: { number: 'desc' },
    select: { number: true },
  });

  const invoice = await prisma.invoice.create({
    data: {
      number: (last?.number || 0) + 1,
      status: 'DRAFT',
      currency: req.body.currency || 'BRL',
      total,
      notes: req.body.notes || `Gerada de ${entries.length} apontamento(s)`,
      organizationId: req.user!.organizationId,
      lines: { create: normalized },
    },
    include: { lines: true },
  });

  res.status(201).json({ success: true, data: invoice });
});

export default router;

/** Webhook público Stripe — montar em /api/billing/stripe/webhook sem authenticate */
export async function stripeWebhookHandler(req: import('express').Request, res: Response): Promise<void> {
  const secret = process.env.STRIPE_SECRET_KEY;
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;

  try {
    let invoiceId: string | undefined;
    const allowStub =
      process.env.NODE_ENV !== 'production' || process.env.ALLOW_STRIPE_WEBHOOK_STUB === 'true';

    if (secret && whSecret) {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(secret);
      const sig = req.headers['stripe-signature'] as string | undefined;
      if (!sig) {
        res.status(400).json({ success: false, error: 'stripe-signature ausente' });
        return;
      }
      const raw =
        Buffer.isBuffer(req.body)
          ? req.body
          : (req as { rawBody?: Buffer }).rawBody;
      if (!raw || !Buffer.isBuffer(raw)) {
        res.status(400).json({
          success: false,
          error: 'Webhook Stripe exige body bruto (express.raw) — JSON re-serializado invalida a assinatura',
        });
        return;
      }
      const event = stripe.webhooks.constructEvent(raw, sig, whSecret);
      if (event.type === 'checkout.session.completed') {
        invoiceId = (event.data.object as { metadata?: { invoiceId?: string } }).metadata?.invoiceId;
      }
    } else if (allowStub && !Buffer.isBuffer(req.body) && req.body?.invoiceId) {
      // Dev / lab: aceita { invoiceId } em JSON sem assinatura
      invoiceId = String(req.body.invoiceId);
    } else if (allowStub && !Buffer.isBuffer(req.body) && req.body?.data?.object?.metadata?.invoiceId) {
      invoiceId = String(req.body.data.object.metadata.invoiceId);
    } else if (!allowStub) {
      res.status(503).json({
        success: false,
        error:
          'Webhook Stripe exige STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET (ou ALLOW_STRIPE_WEBHOOK_STUB=true)',
      });
      return;
    }

    if (!invoiceId) {
      res.json({ received: true, ignored: true });
      return;
    }

    await prisma.invoice.updateMany({
      where: { id: invoiceId },
      data: { status: 'PAID', paidAt: new Date() },
    });
    res.json({ received: true, invoiceId });
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
}
