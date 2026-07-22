/**
 * CORS origin callback compartilhado (Express + Socket.io).
 * Localhost só é liberado fora de production (ou com ALLOW_LOCALHOST_CORS=true).
 */
export function isCorsOriginAllowed(origin: string | undefined): boolean {
  const allowed = (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!origin) return true;
  if (allowed.includes(origin)) return true;

  const allowLocalhost =
    process.env.NODE_ENV !== 'production' || process.env.ALLOW_LOCALHOST_CORS === 'true';
  if (allowLocalhost && /^http:\/\/localhost:\d+$/.test(origin)) return true;

  return false;
}

export function corsOriginCallback(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void
): void {
  callback(null, isCorsOriginAllowed(origin));
}
