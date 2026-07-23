import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { parseNaturalLanguageFilter } from '@nexaops/shared';
import { parseFilterWithLlm } from '../lib/llm.js';
import { queueScriptExecution } from '../lib/queue.js';

export interface DeviceListParams {
  organizationId: string;
  search?: string;
  nlFilter?: string;
  siteId?: string;
  /** Restringe a estes sites (multi-tenant fino); null/undefined = todos */
  allowedSiteIds?: string[];
  type?: string;
  status?: string;
  favorites?: boolean;
  tags?: string[];
  folder?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export async function listDevices(params: DeviceListParams) {
  const {
    organizationId,
    search,
    nlFilter,
    siteId,
    allowedSiteIds,
    type,
    status,
    favorites,
    folder,
    page = 1,
    limit = 25,
    sortBy = 'updatedAt',
    sortOrder = 'desc',
  } = params;

  const where: Prisma.DeviceWhereInput = { organizationId };

  if (nlFilter) {
    const parsed = nlFilter.trim().toLowerCase().startsWith('@ai')
      ? await parseFilterWithLlm(nlFilter)
      : parseNaturalLanguageFilter(nlFilter);
    if (parsed.status) where.status = parsed.status;
    if (parsed.type) where.type = parsed.type;
    if (parsed.rebootPending) where.rebootPending = true;
    if (parsed.hasPatches) where.patchesAvailable = { gt: 0 };
    if (parsed.search) where.name = { contains: parsed.search };
    if (parsed.hasAlerts) {
      where.alerts = { some: { status: { in: ['NEW', 'ACKNOWLEDGED'] } } };
    }
  }

  if (search) {
    where.OR = [
      { name: { contains: search } },
      { hostname: { contains: search } },
      { lastUserLogin: { contains: search } },
    ];
  }
  if (allowedSiteIds && allowedSiteIds.length > 0) {
    where.siteId = siteId && allowedSiteIds.includes(siteId)
      ? siteId
      : { in: allowedSiteIds };
  } else if (siteId) {
    where.siteId = siteId;
  }
  if (type) where.type = type as Prisma.EnumDeviceTypeFilter;
  if (status) where.status = status as Prisma.EnumDeviceStatusFilter;
  if (favorites) where.isFavorite = true;
  if (folder) where.folder = folder;

  const allowedSort = ['name', 'status', 'type', 'lastSeenAt', 'updatedAt', 'patchesAvailable'];
  const orderField = allowedSort.includes(sortBy) ? sortBy : 'updatedAt';

  const [devices, total] = await Promise.all([
    prisma.device.findMany({
      where,
      include: {
        site: { select: { id: true, name: true } },
        alerts: {
          where: { status: { in: ['NEW', 'ACKNOWLEDGED'] } },
          select: { id: true, severity: true, status: true },
        },
        _count: { select: { alerts: true, patches: true } },
      },
      orderBy: { [orderField]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.device.count({ where }),
  ]);

  return {
    data: devices.map(formatDevice),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getDevice(id: string, organizationId: string) {
  const device = await prisma.device.findFirst({
    where: { id, organizationId },
    include: {
      site: true,
      hardwareInfo: true,
      softwareItems: { orderBy: { name: 'asc' } },
      alerts: { orderBy: { createdAt: 'desc' }, take: 20 },
      patches: { orderBy: { createdAt: 'desc' } },
      scriptExecutions: {
        include: { script: { select: { name: true } } },
        orderBy: { startedAt: 'desc' },
        take: 20,
      },
      remoteSessions: {
        include: { user: { select: { name: true } } },
        orderBy: { startedAt: 'desc' },
        take: 10,
      },
      resourceMetrics: {
        orderBy: { recordedAt: 'desc' },
        take: 48,
      },
      networkInterfaces: {
        orderBy: [{ internal: 'asc' }, { name: 'asc' }],
      },
      thresholdProfile: true,
    },
  });

  if (!device) return null;
  return formatDeviceDetail(device);
}

export async function createDevice(
  organizationId: string,
  data: {
    name: string;
    hostname?: string;
    type: string;
    siteId?: string;
    folder?: string;
    osType?: string;
    osVersion?: string;
    tags?: string[];
  }
) {
  const { assertDeviceSeatAvailable } = await import('../lib/ops.js');
  await assertDeviceSeatAvailable(organizationId);

  const device = await prisma.device.create({
    data: {
      name: data.name,
      hostname: data.hostname,
      type: data.type as 'PC' | 'SERVER' | 'MOBILE' | 'NETWORK',
      siteId: data.siteId,
      folder: data.folder,
      osType: data.osType as 'WINDOWS' | 'MACOS' | 'LINUX' | undefined,
      osVersion: data.osVersion,
      tags: data.tags || [],
      organizationId,
      status: 'OFFLINE',
    },
    include: { site: { select: { id: true, name: true } } },
  });
  return formatDevice(device);
}

export async function updateDevice(
  id: string,
  organizationId: string,
  data: Record<string, unknown>
) {
  const existing = await prisma.device.findFirst({ where: { id, organizationId } });
  if (!existing) throw new Error('Dispositivo não encontrado');

  if (data.siteId) {
    const site = await prisma.site.findFirst({
      where: { id: data.siteId as string, organizationId },
    });
    if (!site) throw new Error('Site não encontrado');
  }

  const device = await prisma.device.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name as string }),
      ...(data.hostname !== undefined && { hostname: data.hostname as string }),
      ...(data.type !== undefined && { type: data.type as 'PC' | 'SERVER' | 'MOBILE' | 'NETWORK' }),
      ...(data.siteId !== undefined && { siteId: (data.siteId as string) || null }),
      ...(data.folder !== undefined && { folder: data.folder as string }),
      ...(data.osType !== undefined && { osType: data.osType as 'WINDOWS' | 'MACOS' | 'LINUX' }),
      ...(data.osVersion !== undefined && { osVersion: data.osVersion as string }),
      ...(data.tags !== undefined && { tags: data.tags as string[] }),
      ...(data.isFavorite !== undefined && { isFavorite: data.isFavorite as boolean }),
    } as Prisma.DeviceUpdateInput,
    include: {
      site: { select: { id: true, name: true } },
      alerts: { where: { status: { in: ['NEW', 'ACKNOWLEDGED'] } } },
    },
  });

  return formatDevice(device);
}

export async function deleteDevice(id: string, organizationId: string) {
  const device = await prisma.device.findFirst({ where: { id, organizationId } });
  if (!device) throw new Error('Dispositivo não encontrado');
  await prisma.device.delete({ where: { id } });
}

export async function bulkDeviceAction(
  organizationId: string,
  deviceIds: string[],
  action: string,
  payload?: Record<string, unknown>,
  requestedById?: string
) {
  const devices = await prisma.device.findMany({
    where: { id: { in: deviceIds }, organizationId },
  });
  if (devices.length !== deviceIds.length) {
    throw new Error('Um ou mais dispositivos não encontrados');
  }

  switch (action) {
    case 'RUN_SCRIPT': {
      const scriptId = payload?.scriptId as string;
      if (!scriptId) throw new Error('scriptId é obrigatório');
      const script = await prisma.script.findFirst({
        where: { id: scriptId, organizationId },
      });
      if (!script) throw new Error('Script não encontrado');
      const executions = await Promise.all(
        deviceIds.map((deviceId) =>
          prisma.scriptExecution.create({
            data: {
              scriptId,
              deviceId,
              organizationId,
              status: 'PENDING',
              awaitingApproval: script.requiresApproval,
              requestedById: requestedById || null,
            },
          })
        )
      );
      for (const exec of executions) {
        if (!exec.awaitingApproval) {
          await queueScriptExecution(exec.id);
        }
      }
      return {
        action,
        count: executions.length,
        executionIds: executions.map((e) => e.id),
        awaitingApproval: script.requiresApproval,
      };
    }
    case 'ASSIGN_THRESHOLD': {
      const profileId = payload?.thresholdProfileId as string;
      if (profileId) {
        const profile = await prisma.thresholdProfile.findFirst({
          where: { id: profileId, organizationId },
        });
        if (!profile) throw new Error('Perfil de limite não encontrado');
      }
      await prisma.device.updateMany({
        where: { id: { in: deviceIds }, organizationId },
        data: { thresholdProfileId: profileId },
      });
      return { action, count: deviceIds.length };
    }
    case 'ASSIGN_AUTOMATION':
    case 'INSTALL_SOFTWARE':
      return { action, count: deviceIds.length, status: 'queued' };
    default:
      throw new Error('Ação não suportada');
  }
}

export async function generateAgentInstall(
  organizationId: string,
  osType: string,
  siteId?: string,
  folder?: string
) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new Error('Organização não encontrada');

  const apiUrl = process.env.API_URL || 'http://localhost:3001';
  const params = new URLSearchParams({ token: org.agentToken });
  if (siteId) params.set('siteId', siteId);
  if (folder) params.set('folder', folder);

  const installers: Record<string, { extension: string; command: string; downloadUrl: string; silentCommand?: string; bootstrapUrl?: string }> = {
    WINDOWS: {
      extension: 'msi',
      command: `msiexec /i NexaOpsAgent.msi /qn TOKEN=${org.agentToken} API_URL=${apiUrl}`,
      silentCommand: `msiexec /i NexaOpsAgent.msi /qn TOKEN=${org.agentToken} API_URL=${apiUrl}`,
      downloadUrl: `${apiUrl}/api/agent/download/windows?${params}`,
      bootstrapUrl: `${apiUrl}/api/agent/download/windows/bootstrap?token=${org.agentToken}&apiUrl=${encodeURIComponent(apiUrl)}`,
    },
    MACOS: {
      extension: 'sh',
      command: `curl -fsSL "${apiUrl}/api/agent/download/macos/bootstrap?token=${org.agentToken}" | bash -s -- --token ${org.agentToken} --api ${apiUrl}`,
      downloadUrl: `${apiUrl}/api/agent/download/macos/bootstrap?${params}`,
    },
    LINUX: {
      extension: 'sh',
      command: `curl -fsSL "${apiUrl}/api/agent/download/linux/bootstrap?token=${org.agentToken}&apiUrl=${encodeURIComponent(apiUrl)}" | bash -s -- --token ${org.agentToken} --api ${apiUrl}`,
      downloadUrl: `${apiUrl}/api/agent/download/linux/bootstrap?${params}`,
    },
  };

  return installers[osType] || installers.WINDOWS;
}

export async function startRemoteSession(deviceId: string, userId: string, organizationId: string) {
  const { startRemoteSession: start } = await import('./remote-session.service.js');
  return start(deviceId, userId, organizationId);
}

function formatDevice(device: {
  id: string;
  name: string;
  hostname: string | null;
  type: string;
  status: string;
  osType: string | null;
  osVersion: string | null;
  folder: string | null;
  tags: unknown;
  lastUserLogin: string | null;
  lastSeenAt: Date | null;
  isFavorite: boolean;
  rebootPending: boolean;
  patchesAvailable: number;
  siteId: string | null;
  site?: { id: string; name: string } | null;
  alerts?: { id: string; severity: string; status: string }[];
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: device.id,
    name: device.name,
    hostname: device.hostname,
    type: device.type,
    status: device.status,
    osType: device.osType,
    osVersion: device.osVersion,
    folder: device.folder,
    tags: device.tags,
    lastUserLogin: device.lastUserLogin,
    lastSeenAt: device.lastSeenAt,
    isFavorite: device.isFavorite,
    rebootPending: device.rebootPending,
    patchesAvailable: device.patchesAvailable,
    site: device.site,
    alerts: device.alerts || [],
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
  };
}

function formatDeviceDetail(device: Record<string, unknown>) {
  return {
    ...formatDevice(device as Parameters<typeof formatDevice>[0]),
    hardwareInfo: device.hardwareInfo,
    softwareItems: device.softwareItems,
    alerts: device.alerts,
    patches: device.patches,
    scriptExecutions: device.scriptExecutions,
    remoteSessions: device.remoteSessions,
    resourceMetrics: (device.resourceMetrics as { cpuPercent: number; ramPercent: number; diskPercent: number; recordedAt: Date }[])?.reverse(),
    networkInterfaces: device.networkInterfaces,
    thresholdProfile: device.thresholdProfile,
  };
}
