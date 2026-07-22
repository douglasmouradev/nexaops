/**
 * Chave única de alerta aberto (device + metric).
 * Null = resolvido ou sem device/metric (não participa do dedupe).
 */
export function alertOpenKey(
  deviceId: string | null | undefined,
  metric: string | null | undefined
): string | null {
  if (!deviceId || !metric) return null;
  return `${deviceId}:${metric}`;
}
