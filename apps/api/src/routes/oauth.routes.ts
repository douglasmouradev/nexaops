import { Router, Response } from 'express';
import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { paramId } from '../lib/params.js';
import { logger } from '../lib/logger.js';
import { encrypt } from '../lib/crypto.js';

const router = Router();

const PROVIDERS = ['microsoft', 'slack'] as const;
type Provider = (typeof PROVIDERS)[number];

interface OAuthState {
  orgId: string;
  provider: Provider;
  nonce: string;
}

function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}

function wantsJson(req: { headers: { accept?: string }; query: Record<string, unknown> }): boolean {
  if (String(req.query.format || '') === 'json') return true;
  const accept = req.headers.accept || '';
  return accept.includes('application/json') && !accept.includes('text/html');
}

function apiBase(): string {
  return (process.env.API_URL || `http://localhost:${process.env.API_PORT || 3001}`).replace(/\/$/, '');
}

function webBase(): string {
  return (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '');
}

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('JWT_SECRET não configurada');
  }
  return secret;
}

function signState(payload: OAuthState): string {
  return jwt.sign(payload, jwtSecret(), { expiresIn: '15m' });
}

function verifyState(token: string): OAuthState {
  return jwt.verify(token, jwtSecret()) as OAuthState;
}

function providerDisplayName(provider: Provider): string {
  return provider === 'microsoft' ? 'Microsoft' : 'Slack';
}

function buildAuthorizeUrl(provider: Provider, state: string): string {
  const redirectUri = `${apiBase()}/api/oauth/${provider}/callback`;

  if (provider === 'microsoft') {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    if (!clientId) throw new Error('MICROSOFT_CLIENT_ID não configurado');
    const tenant = process.env.MICROSOFT_TENANT || 'common';
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: 'offline_access User.Read',
      state,
    });
    return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params}`;
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) throw new Error('SLACK_CLIENT_ID não configurado');
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'chat:write,channels:read,users:read',
    redirect_uri: redirectUri,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

async function exchangeCode(provider: Provider, code: string): Promise<Record<string, unknown>> {
  const redirectUri = `${apiBase()}/api/oauth/${provider}/callback`;

  if (provider === 'microsoft') {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('Credenciais Microsoft incompletas');
    const tenant = process.env.MICROSOFT_TENANT || 'common';
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Falha no token Microsoft: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Credenciais Slack incompletas');
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!data.ok) {
    throw new Error(`Falha no token Slack: ${String(data.error || 'unknown')}`);
  }
  return data;
}

router.get('/:provider/start', authenticate, requireRole('ADMIN', 'TECHNICIAN'), async (req: AuthRequest, res: Response) => {
  try {
    const provider = paramId(req.params.provider);
    if (!isProvider(provider)) {
      res.status(400).json({ success: false, error: 'Provedor inválido (microsoft|slack)' });
      return;
    }

    const state = signState({
      orgId: req.user!.organizationId,
      provider,
      nonce: randomBytes(8).toString('hex'),
    });
    const url = buildAuthorizeUrl(provider, state);

    if (wantsJson(req)) {
      res.json({ success: true, data: { url } });
      return;
    }
    res.redirect(url);
  } catch (err) {
    res.status(400).json({ success: false, error: (err as Error).message });
  }
});

router.get('/:provider/callback', async (req, res: Response) => {
  try {
    const provider = paramId(req.params.provider);
    if (!isProvider(provider)) {
      res.status(400).json({ success: false, error: 'Provedor inválido' });
      return;
    }

    const code = String(req.query.code || '');
    const stateToken = String(req.query.state || '');
    if (!code || !stateToken) {
      res.status(400).json({ success: false, error: 'code e state são obrigatórios' });
      return;
    }

    const state = verifyState(stateToken);
    if (state.provider !== provider) {
      res.status(400).json({ success: false, error: 'State inválido para o provedor' });
      return;
    }

    const tokens = await exchangeCode(provider, code);
    const sensitive = {
      ...tokens,
      connectedAt: new Date().toISOString(),
      provider,
    };
    const config = {
      encrypted: true,
      payload: encrypt(JSON.stringify(sensitive)),
      connectedAt: sensitive.connectedAt,
      provider,
      tokenType: typeof tokens.token_type === 'string' ? tokens.token_type : undefined,
      scope: typeof tokens.scope === 'string' ? tokens.scope : undefined,
      team: typeof (tokens as { team?: { name?: string } }).team?.name === 'string'
        ? (tokens as { team: { name: string } }).team.name
        : undefined,
    };

    await prisma.integration.upsert({
      where: {
        slug_organizationId: { slug: provider, organizationId: state.orgId },
      },
      create: {
        name: providerDisplayName(provider),
        slug: provider,
        connected: true,
        config,
        organizationId: state.orgId,
      },
      update: {
        connected: true,
        config,
        name: providerDisplayName(provider),
      },
    });

    logger.info('oauth_connected', { provider, organizationId: state.orgId });
    res.redirect(`${webBase()}/app-center?oauth=${provider}&status=connected`);
  } catch (err) {
    logger.error('oauth_callback_failed', { error: (err as Error).message });
    res.redirect(`${webBase()}/app-center?oauth=error&message=${encodeURIComponent((err as Error).message)}`);
  }
});

export default router;
