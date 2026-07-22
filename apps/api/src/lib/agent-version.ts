/** Versão atual do agent empacotada / esperada pela API */
export const AGENT_CURRENT_VERSION =
  process.env.AGENT_CURRENT_VERSION || '0.5.0';

export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function needsAgentUpdate(
  current: string | null | undefined,
  minVersion: string | null | undefined
): boolean {
  if (!current) return true;
  const target = minVersion || AGENT_CURRENT_VERSION;
  return compareSemver(current, target) < 0;
}
