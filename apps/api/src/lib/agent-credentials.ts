import { randomBytes } from 'crypto';
import { prisma } from '../lib/prisma.js';

export type AgentCredentials = {
  agentId: string;
  deviceId: string;
  organizationId: string;
  authMode: 'device' | 'org';
};

function mintDeviceToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Valida token do agent: preferência por device.agentAuthToken;
 * fallback no agentToken da org (compat). Com REQUIRE_DEVICE_AGENT_TOKEN=true,
 * rejeita token de org se o device já tiver token próprio.
 */
export async function resolveAgentAuth(
  token: string,
  agentId: string
): Promise<AgentCredentials | null> {
  const device = await prisma.device.findFirst({
    where: { agentId },
    select: {
      id: true,
      organizationId: true,
      agentAuthToken: true,
      deletedAt: true,
      organization: { select: { agentToken: true } },
    },
  });
  if (!device || device.deletedAt) return null;

  if (device.agentAuthToken && device.agentAuthToken === token) {
    return {
      agentId,
      deviceId: device.id,
      organizationId: device.organizationId,
      authMode: 'device',
    };
  }

  const orgOk = device.organization.agentToken === token;
  if (!orgOk) return null;

  if (process.env.REQUIRE_DEVICE_AGENT_TOKEN === 'true' && device.agentAuthToken) {
    return null;
  }

  return {
    agentId,
    deviceId: device.id,
    organizationId: device.organizationId,
    authMode: 'org',
  };
}

/** Garante agentAuthToken no device (registro / re-registro). */
export async function ensureDeviceAgentToken(deviceId: string): Promise<string> {
  const existing = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { agentAuthToken: true },
  });
  if (existing?.agentAuthToken) return existing.agentAuthToken;

  const token = mintDeviceToken();
  try {
    await prisma.device.update({
      where: { id: deviceId },
      data: { agentAuthToken: token },
    });
    return token;
  } catch {
    // colisão rara de unique — tenta de novo
    const retry = mintDeviceToken();
    await prisma.device.update({
      where: { id: deviceId },
      data: { agentAuthToken: retry },
    });
    return retry;
  }
}
