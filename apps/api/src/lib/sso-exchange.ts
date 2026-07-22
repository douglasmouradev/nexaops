import { randomBytes } from 'crypto';
import IORedis from 'ioredis';

type SsoPayload = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

/** Fallback in-memory (single-node / Redis off) */
const memoryCodes = new Map<string, SsoPayload>();
const TTL_SEC = 60;
const TTL_MS = TTL_SEC * 1000;
const KEY_PREFIX = 'nexaops:sso:ex:';

let redis: IORedis | null = null;
let redisTried = false;

async function getRedis(): Promise<IORedis | null> {
  if (redis) return redis;
  if (redisTried) return null;
  redisTried = true;
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) return null;

  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  const conn = new IORedis(url, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    retryStrategy: () => null,
    enableOfflineQueue: false,
  });
  conn.on('error', () => {
    /* silencia */
  });
  try {
    await conn.connect();
    await conn.ping();
    redis = conn;
    return redis;
  } catch {
    await conn.quit().catch(() => undefined);
    return null;
  }
}

function pruneMemory(): void {
  if (memoryCodes.size <= 500) return;
  const now = Date.now();
  for (const [k, v] of memoryCodes) {
    if (v.expiresAt < now) memoryCodes.delete(k);
  }
}

/** Códigos one-time SSO (não vão para a query string com JWTs) */
export async function issueSsoExchangeCode(accessToken: string, refreshToken: string): Promise<string> {
  const code = randomBytes(32).toString('hex');
  const payload: SsoPayload = {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + TTL_MS,
  };

  const r = await getRedis();
  if (r) {
    await r.setex(`${KEY_PREFIX}${code}`, TTL_SEC, JSON.stringify(payload));
    return code;
  }

  memoryCodes.set(code, payload);
  pruneMemory();
  return code;
}

export async function consumeSsoExchangeCode(
  code: string
): Promise<{ accessToken: string; refreshToken: string } | null> {
  const r = await getRedis();
  if (r) {
    const key = `${KEY_PREFIX}${code}`;
    // GETDEL atômico (Redis ≥6.2; NexaOps exige Redis 7 para BullMQ)
    let raw: string | null = null;
    try {
      raw = await r.getdel(key);
    } catch {
      // Fallback Lua se o cliente não expuser getdel
      raw = (await r.eval(
        "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v",
        1,
        key
      )) as string | null;
    }
    if (!raw) return null;
    try {
      const entry = JSON.parse(raw) as SsoPayload;
      if (!entry?.accessToken || !entry?.refreshToken) return null;
      if (!entry.expiresAt || entry.expiresAt < Date.now()) return null;
      return { accessToken: entry.accessToken, refreshToken: entry.refreshToken };
    } catch {
      return null;
    }
  }

  // Map sync get+delete é atômico no event loop do Node
  const entry = memoryCodes.get(code);
  memoryCodes.delete(code);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return { accessToken: entry.accessToken, refreshToken: entry.refreshToken };
}
