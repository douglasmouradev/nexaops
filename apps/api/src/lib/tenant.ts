import { prisma } from '../lib/prisma.js';

export class TenantError extends Error {
  status: number;
  constructor(message: string, status = 404) {
    super(message);
    this.status = status;
  }
}

export async function assertTicketInOrg(ticketId: string, organizationId: string) {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, organizationId },
    select: { id: true, siteId: true },
  });
  if (!ticket) throw new TenantError('Ticket não encontrado');
  return ticket;
}

/** Ticket acessível considerando allowedSiteIds */
export async function assertTicketAccessible(
  ticketId: string,
  organizationId: string,
  role: string,
  allowedSiteIds: unknown
) {
  const ticket = await assertTicketInOrg(ticketId, organizationId);
  if (!isSiteAllowed(role, allowedSiteIds, ticket.siteId)) {
    throw new TenantError('Ticket não encontrado');
  }
  return ticket;
}

export async function assertAlertInOrg(alertId: string, organizationId: string) {
  const alert = await prisma.alert.findFirst({
    where: { id: alertId, organizationId },
    select: { id: true },
  });
  if (!alert) throw new TenantError('Alerta não encontrado');
  return alert;
}

export async function assertSiteInOrg(siteId: string, organizationId: string) {
  const site = await prisma.site.findFirst({
    where: { id: siteId, organizationId },
    select: { id: true },
  });
  if (!site) throw new TenantError('Site não encontrado');
  return site;
}

export async function assertScriptInOrg(scriptId: string, organizationId: string) {
  const script = await prisma.script.findFirst({
    where: { id: scriptId, organizationId },
    select: { id: true },
  });
  if (!script) throw new TenantError('Script não encontrado');
  return script;
}

export async function assertDevicesInOrg(deviceIds: string[], organizationId: string) {
  const devices = await prisma.device.findMany({
    where: { id: { in: deviceIds }, organizationId },
    select: { id: true },
  });
  if (devices.length !== deviceIds.length) {
    throw new TenantError('Um ou mais dispositivos não encontrados');
  }
  return devices;
}

export async function assertPatchesInOrg(patchIds: string[], organizationId: string) {
  const patches = await prisma.patch.findMany({
    where: { id: { in: patchIds }, organizationId },
    select: { id: true },
  });
  if (patches.length !== patchIds.length) {
    throw new TenantError('Um ou mais patches não encontrados');
  }
  return patches;
}

/** [] = acesso a todos os sites; ADMIN ignora restrição */
export function parseAllowedSiteIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

export function siteScopeWhere(
  role: string,
  allowedSiteIds: unknown
): { siteId?: { in: string[] } } | Record<string, never> {
  if (role === 'ADMIN') return {};
  const ids = parseAllowedSiteIds(allowedSiteIds);
  if (ids.length === 0) return {};
  return { siteId: { in: ids } };
}

/** Escopo de sites para entidades ligadas a device (alerts) */
export function deviceSiteScopeWhere(
  role: string,
  allowedSiteIds: unknown
): { device?: { siteId: { in: string[] } } } | Record<string, never> {
  if (role === 'ADMIN') return {};
  const ids = parseAllowedSiteIds(allowedSiteIds);
  if (ids.length === 0) return {};
  return { device: { siteId: { in: ids } } };
}

export function isSiteAllowed(role: string, allowedSiteIds: unknown, siteId: string | null | undefined): boolean {
  if (role === 'ADMIN') return true;
  const ids = parseAllowedSiteIds(allowedSiteIds);
  if (ids.length === 0) return true;
  if (!siteId) return false;
  return ids.includes(siteId);
}

export async function assertSiteAllowed(
  siteId: string,
  organizationId: string,
  role: string,
  allowedSiteIds: unknown
) {
  await assertSiteInOrg(siteId, organizationId);
  if (!isSiteAllowed(role, allowedSiteIds, siteId)) {
    throw new TenantError('Site não encontrado');
  }
}

export async function assertDevicesInSiteScope(
  deviceIds: string[],
  organizationId: string,
  role: string,
  allowedSiteIds: unknown
) {
  const devices = await prisma.device.findMany({
    where: { id: { in: deviceIds }, organizationId },
    select: { id: true, siteId: true },
  });
  if (devices.length !== deviceIds.length) {
    throw new TenantError('Um ou mais dispositivos não encontrados');
  }
  for (const d of devices) {
    if (!isSiteAllowed(role, allowedSiteIds, d.siteId)) {
      throw new TenantError('Um ou mais dispositivos fora do seu escopo de sites');
    }
  }
  return devices;
}

export async function loadUserSiteScope(userId: string): Promise<{
  role: string;
  allowedSiteIds: unknown;
  organizationId: string;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, allowedSiteIds: true, organizationId: true },
  });
  if (!user) throw new TenantError('Usuário não encontrado', 401);
  return user;
}
