import { Router, Response, Request } from 'express';
import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { signAccessToken, signRefreshToken } from '../lib/jwt.js';
import { logger } from '../lib/logger.js';
import { issueSsoExchangeCode, consumeSsoExchangeCode } from '../lib/sso-exchange.js';

const router = Router();

function apiBase(): string {
  return (process.env.API_URL || `http://localhost:${process.env.API_PORT || 3001}`).replace(/\/$/, '');
}

function webBase(): string {
  return (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '');
}

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) throw new Error('JWT_SECRET não configurada');
  return secret;
}

function entraEnabled(): boolean {
  return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

/** GET /api/auth/oidc/entra/start?orgSlug=optional */
router.get('/entra/start', (req: Request, res: Response) => {
  try {
    if (!entraEnabled()) {
      res.status(503).json({ success: false, error: 'SSO Entra não configurado (MICROSOFT_CLIENT_ID/SECRET)' });
      return;
    }
    const tenant = process.env.MICROSOFT_TENANT || process.env.ENTRA_TENANT || 'common';
    const state = jwt.sign(
      {
        nonce: randomBytes(16).toString('hex'),
        orgSlug: typeof req.query.orgSlug === 'string' ? req.query.orgSlug : undefined,
        purpose: 'sso-login',
      },
      jwtSecret(),
      { expiresIn: '15m' }
    );
    const redirectUri = `${apiBase()}/api/auth/oidc/entra/callback`;
    const params = new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: 'openid profile email User.Read',
      state,
    });
    res.redirect(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params}`);
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/entra/callback', async (req: Request, res: Response) => {
  const web = webBase();
  try {
    const authCode = String(req.query.code || '');
    const state = String(req.query.state || '');
    if (!authCode || !state) {
      res.redirect(`${web}/login?error=sso_missing_code`);
      return;
    }
    jwt.verify(state, jwtSecret());

    const tenant = process.env.MICROSOFT_TENANT || process.env.ENTRA_TENANT || 'common';
    const redirectUri = `${apiBase()}/api/auth/oidc/entra/callback`;
    const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID!,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
        code: authCode,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      logger.error('entra_token_failed', { status: tokenRes.status });
      res.redirect(`${web}/login?error=sso_token`);
      return;
    }
    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) {
      res.redirect(`${web}/login?error=sso_token`);
      return;
    }

    const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!meRes.ok) {
      res.redirect(`${web}/login?error=sso_profile`);
      return;
    }
    const me = (await meRes.json()) as {
      mail?: string;
      userPrincipalName?: string;
      displayName?: string;
      id?: string;
    };
    const email = (me.mail || me.userPrincipalName || '').toLowerCase().trim();
    if (!email) {
      res.redirect(`${web}/login?error=sso_email`);
      return;
    }

    let user = await prisma.user.findUnique({
      where: { email },
      include: { organization: true },
    });

    if (!user) {
      // Auto-provision: org pelo domínio do e-mail (slug match parcial) ou rejeita
      const domain = email.split('@')[1];
      const org =
        (await prisma.organization.findFirst({
          where: { OR: [{ slug: domain.split('.')[0] }, { billingEmail: { endsWith: `@${domain}` } }] },
        })) || null;
      if (!org) {
        res.redirect(`${web}/login?error=sso_no_org`);
        return;
      }
      const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12);
      user = await prisma.user.create({
        data: {
          email,
          name: me.displayName || email,
          passwordHash,
          role: 'TECHNICIAN',
          organizationId: org.id,
          allowedSiteIds: [],
        },
        include: { organization: true },
      });
      logger.info('entra_user_provisioned', { email, orgId: org.id });
    }

    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role as 'ADMIN' | 'TECHNICIAN' | 'READ_ONLY',
      organizationId: user.organizationId,
    };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const exchangeCode = await issueSsoExchangeCode(accessToken, refreshToken);
    res.redirect(`${web}/login?sso=entra&code=${encodeURIComponent(exchangeCode)}`);
  } catch (err) {
    logger.error('entra_callback_error', { error: (err as Error).message });
    res.redirect(`${web}/login?error=sso_failed`);
  }
});

/** Troca código one-time por tokens (evita JWT na query/histórico) */
router.post('/entra/exchange', async (req: Request, res: Response) => {
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  if (!code) {
    res.status(400).json({ success: false, error: 'code é obrigatório' });
    return;
  }
  const tokens = await consumeSsoExchangeCode(code);
  if (!tokens) {
    res.status(401).json({ success: false, error: 'Código SSO inválido ou expirado' });
    return;
  }
  res.json({ success: true, data: tokens });
});

export default router;
