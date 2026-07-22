import './load-env.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { createServer } from 'http';

import { swaggerSpec } from './swagger.js';
import { errorHandler } from './middleware/error.js';
import { setupSocket } from './socket.js';
import { setIo } from './lib/io.js';
import { initWorkers, checkOfflineDevices, pingRedis, areQueuesEnabled } from './lib/queue.js';
import { checkSlaBreaches } from './lib/sla.js';
import { prisma } from './lib/prisma.js';
import { logger } from './lib/logger.js';
import { corsOriginCallback } from './lib/cors-origin.js';

import authRoutes from './routes/auth.routes.js';
import oidcRoutes from './routes/oidc.routes.js';
import devicesRoutes from './routes/devices.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import sitesRoutes from './routes/sites.routes.js';
import agentRoutes from './routes/agent.routes.js';
import oauthRoutes from './routes/oauth.routes.js';
import contractsRoutes from './routes/contracts.routes.js';
import remoteSessionsRoutes from './routes/remote-sessions.routes.js';
import billingRoutes, { stripeWebhookHandler } from './routes/billing.routes.js';
import automationsRoutes from './routes/automations.routes.js';
import { aiRouter } from './routes/ai.routes.js';
import {
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
} from './routes/modules.routes.js';

const app = express();
const httpServer = createServer(app);
const PORT = process.env.API_PORT || 3001;

async function initOptionalSentry(): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/node') as {
      init: (opts: Record<string, unknown>) => void;
    };
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    });
    logger.info('sentry_initialized');
  } catch {
    logger.info('sentry_dsn_configured', {
      note: 'Instale @sentry/node para ativar o Sentry (npm i @sentry/node -w @nexaops/api)',
    });
  }
}

void initOptionalSentry();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: corsOriginCallback,
    credentials: true,
  })
);

/** Stripe webhook precisa do body bruto antes do JSON parser */
app.post(
  '/api/billing/stripe/webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    void stripeWebhookHandler(req, res);
  }
);

app.use(
  express.json({
    limit: '10mb',
    verify: (req, _res, buf) => {
      (req as { rawBody?: Buffer }).rawBody = buf;
    },
  })
);
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));

app.get('/health', async (_req, res) => {
  let db = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = 'error';
  }
  const redis = await pingRedis();
  const queues = areQueuesEnabled() ? 'ok' : 'disabled';
  const redisRequired = process.env.REDIS_REQUIRED === 'true';
  const redisOk = redisRequired ? redis === 'ok' : redis !== 'error';

  const { getSmtpStatus, verifySmtp } = await import('./lib/email.js');
  const smtpMeta = getSmtpStatus();
  let smtp: string = smtpMeta.configured ? 'unknown' : 'disabled';
  if (smtpMeta.configured) {
    const v = await verifySmtp();
    smtp = v.ok ? 'ok' : 'error';
  }
  const smtpRequired = smtpMeta.required;
  const smtpOk = smtpRequired ? smtp === 'ok' : smtp !== 'error';

  const healthy = db === 'ok' && redisOk && smtpOk && (!redisRequired || queues === 'ok');
  const isProd = process.env.NODE_ENV === 'production';
  const warnings: string[] = [];
  if (!process.env.S3_BUCKET) warnings.push('storage_db_base64');
  if (!smtpMeta.configured) warnings.push('smtp_disabled');
  if (queues !== 'ok') warnings.push('queues_disabled');
  if (isProd && process.env.REDIS_REQUIRED !== 'true') warnings.push('redis_not_required');
  if (isProd && process.env.SMTP_REQUIRED !== 'true') warnings.push('smtp_not_required');

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    ready: healthy,
    service: 'nexaops-api',
    environment: process.env.NODE_ENV || 'development',
    database: db,
    redis,
    queues,
    smtp,
    smtpConfigured: smtpMeta.configured,
    storage: process.env.S3_BUCKET ? 's3' : 'db',
    warnings,
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));

app.use('/api/auth', authRoutes);
app.use('/api/auth/oidc', oidcRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/remote-sessions', remoteSessionsRoutes);
app.use('/api/sites', sitesRoutes);
app.use('/api/contracts', contractsRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/automations', automationsRoutes);
app.use('/api/tickets', ticketsRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/scripts', scriptsRouter);
app.use('/api/patches', patchesRouter);
app.use('/api/knowledge', knowledgeRouter);
app.use('/api/assets', assetsRouter);
app.use('/api/network', networkRouter);
app.use('/api/referrals', referralsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/oauth', oauthRoutes);
app.use('/api/admin', adminRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/reports', reportsRouter);
app.use(
  '/api/portal',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Muitas requisições ao portal. Tente novamente em breve.' },
  }),
  portalRouter
);
app.use('/api/agent', agentRoutes);

app.use(errorHandler);

const io = setupSocket(httpServer);
setIo(io);

const isTest = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;

if (!isTest) {
  initWorkers(io)
    .then(() => {
      setInterval(() => {
        checkOfflineDevices(io).catch((err) =>
          logger.error('offline_check_failed', { error: String(err) })
        );
      }, 60000);
      setInterval(() => {
        checkSlaBreaches()
          .then((n) => {
            if (n > 0) logger.info('sla_breaches', { count: n });
          })
          .catch((err) => logger.error('sla_check_failed', { error: String(err) }));
      }, 5 * 60 * 1000);
      setInterval(() => {
        import('./lib/automation-engine.js')
          .then(({ runAutomationEngine }) => runAutomationEngine())
          .catch((err) => logger.error('automation_failed', { error: String(err) }));
      }, 60_000);
      setInterval(() => {
        import('./lib/ops.js')
          .then(({ pruneOldMetrics }) => pruneOldMetrics(14))
          .catch((err) => logger.error('metrics_prune_failed', { error: String(err) }));
      }, 24 * 60 * 60 * 1000);
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('workers_failed', { error: msg });
      if (process.env.REDIS_REQUIRED === 'true') {
        logger.error('redis_required_exit');
        process.exit(1);
      }
    });

  httpServer.listen(PORT, () => {
    logger.info('api_started', { port: Number(PORT) });
    console.log(`🚀 NexaOps API rodando em http://localhost:${PORT}`);
    console.log(`📚 Swagger em http://localhost:${PORT}/api/docs`);
  });
}

export { app, httpServer, io };
