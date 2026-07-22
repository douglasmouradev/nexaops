import { createHmac, timingSafeEqual } from 'crypto';

const DEFAULT_TTL = Number(process.env.REMOTE_URL_TTL_SEC || 3600);

/** Nunca usa segredo hardcoded — exige REMOTE_URL_SIGNING_SECRET ou JWT_SECRET. */
function signingSecret(): string {
  const secret = process.env.REMOTE_URL_SIGNING_SECRET || process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'REMOTE_URL_SIGNING_SECRET ou JWT_SECRET (≥16) é obrigatório para assinar URLs remotas'
    );
  }
  return secret;
}

/** Assina sessão remota (HMAC) com expiração — use {token} e {expires} nos templates */
export function signRemoteAccess(sessionId: string, ttlSec = DEFAULT_TTL): {
  token: string;
  expires: number;
  expiresIso: string;
} {
  const expires = Math.floor(Date.now() / 1000) + Math.max(60, ttlSec);
  const payload = `${sessionId}.${expires}`;
  const sig = createHmac('sha256', signingSecret()).update(payload).digest('hex');
  const token = Buffer.from(`${payload}.${sig}`).toString('base64url');
  return { token, expires, expiresIso: new Date(expires * 1000).toISOString() };
}

export function verifyRemoteAccessToken(token: string, sessionId: string): boolean {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const [id, expStr, sig] = raw.split('.');
    if (!id || !expStr || !sig || id !== sessionId) return false;
    const expires = Number(expStr);
    if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false;
    const expected = createHmac('sha256', signingSecret())
      .update(`${id}.${expires}`)
      .digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function applyRemoteUrlTemplate(
  tpl: string,
  vars: Record<string, string>
): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  }
  return out;
}
