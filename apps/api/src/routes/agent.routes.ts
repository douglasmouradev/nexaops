import { Router, Response, Request } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { resolveAgentMsiPath, isAgentMsiBuilt } from '../lib/agent-installer.js';
import { buildAgentTarball, extractAgentOrgToken, resolveTrustedAgentApiUrl } from '../lib/agent-package.js';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { processInterfaceAlerts } from '../services/interface-alert.service.js';
import { authenticateAgent, AgentAuthRequest } from '../middleware/agent-auth.js';
import { ensureDeviceAgentToken } from '../lib/agent-credentials.js';
import { validateBody } from '../middleware/validate.js';
import { agentMetricsSchema } from '@nexaops/shared';

const router = Router();

const agentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 400,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Muitas requisições do agente. Tente novamente em breve.' },
});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Muitas tentativas de registro. Tente novamente em breve.' },
});

// ─── Público (token de org no body/query) ────────────────────────────────────

router.post('/register', registerLimiter, async (req: Request, res: Response) => {
  try {
    const { token, hostname, osType, osVersion, siteId, folder, hardware } = req.body;
    if (!token) {
      res.status(400).json({ success: false, error: 'token é obrigatório' });
      return;
    }

    const org = await prisma.organization.findFirst({ where: { agentToken: token } });
    if (!org) {
      res.status(401).json({ success: false, error: 'Token inválido' });
      return;
    }

    const agentId = uuidv4();
    const name = hostname || os.hostname();

    let resolvedSiteId: string | undefined;
    if (siteId) {
      const site = await prisma.site.findFirst({
        where: { id: siteId, organizationId: org.id },
      });
      if (!site) {
        res.status(400).json({ success: false, error: 'siteId inválido para esta organização' });
        return;
      }
      resolvedSiteId = site.id;
    }

    const existing = await prisma.device.findFirst({
      where: { organizationId: org.id, hostname: name },
    });

    let device;
    if (existing) {
      device = await prisma.device.update({
        where: { id: existing.id },
        data: {
          status: 'ONLINE',
          lastSeenAt: new Date(),
          agentId,
          osType,
          osVersion,
          ...(resolvedSiteId && { siteId: resolvedSiteId }),
          ...(folder !== undefined && { folder }),
        },
      });
    } else {
      device = await prisma.device.create({
        data: {
          name,
          hostname: name,
          type: 'PC',
          status: 'ONLINE',
          osType,
          osVersion,
          siteId: resolvedSiteId,
          folder,
          agentId,
          organizationId: org.id,
          lastSeenAt: new Date(),
        },
      });
    }

    if (hardware) {
      await prisma.hardwareInfo.upsert({
        where: { deviceId: device.id },
        create: {
          deviceId: device.id,
          cpuModel: hardware.cpuModel,
          cpuCores: hardware.cpuCores,
          ramTotalGb: hardware.ramTotalGb,
          diskTotalGb: hardware.diskTotalGb,
          diskFreeGb: hardware.diskFreeGb,
          manufacturer: hardware.manufacturer,
          model: hardware.model,
          serialNumber: hardware.serialNumber,
        },
        update: {
          cpuModel: hardware.cpuModel,
          cpuCores: hardware.cpuCores,
          ramTotalGb: hardware.ramTotalGb,
          diskTotalGb: hardware.diskTotalGb,
          diskFreeGb: hardware.diskFreeGb,
          manufacturer: hardware.manufacturer,
          model: hardware.model,
          serialNumber: hardware.serialNumber,
        },
      });
    }

    if (req.body.rebootPending === true) {
      await prisma.device.update({
        where: { id: device.id },
        data: { rebootPending: true },
      });
    }

    const deviceToken = await ensureDeviceAgentToken(device.id);

    res.status(201).json({
      success: true,
      data: {
        deviceId: device.id,
        agentId,
        organizationId: org.id,
        deviceToken,
        /** Preferir deviceToken nas próximas auth; org token ainda funciona até REQUIRE_DEVICE_AGENT_TOKEN */
        preferDeviceToken: true,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/install.sh', (req: Request, res: Response) => {
  const apiUrl = process.env.API_URL || 'http://localhost:3001';
  // Respeita AGENT_ALLOW_QUERY_TOKEN — não embute token da query quando o gate bloqueia
  const token = extractAgentOrgToken(req) || '';
  res.setHeader('Content-Type', 'text/x-shellscript');
  res.send(`#!/bin/bash
set -euo pipefail
API_URL="\${NEXAOPS_API_URL:-${apiUrl}}"
TOKEN="\${1:-${token}}"
if [[ -z "$TOKEN" ]]; then
  echo "Uso: bash install.sh <TOKEN>"
  echo "Ou: curl -fsSL -H \\"Authorization: Bearer <TOKEN>\\" \\"$API_URL/api/agent/install.sh\\" | bash -s -- <TOKEN>"
  exit 1
fi
ENC_API=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$API_URL" 2>/dev/null || echo "$API_URL")
# Preferir Bearer (query ?token= bloqueada em production por default)
curl -fsSL -H "Authorization: Bearer $TOKEN" "$API_URL/api/agent/download/linux/bootstrap?apiUrl=$ENC_API" -o /tmp/nexaops-install.sh
bash /tmp/nexaops-install.sh --token "$TOKEN" --api "$API_URL"
`);
});

router.get('/download/linux/bootstrap', async (req: Request, res: Response) => {
  try {
    const token = extractAgentOrgToken(req);
    const apiUrl = resolveTrustedAgentApiUrl(
      typeof req.query.apiUrl === 'string' ? req.query.apiUrl : undefined
    );
    if (!apiUrl) {
      res.status(400).json({
        success: false,
        error: 'apiUrl não permitido. Use API_URL do servidor ou AGENT_API_URL_ALLOWLIST',
      });
      return;
    }
    if (!token) {
      res.status(400).json({ success: false, error: 'token é obrigatório (Bearer ou ?token=)' });
      return;
    }
    const org = await prisma.organization.findFirst({ where: { agentToken: token } });
    if (!org) {
      res.status(401).json({ success: false, error: 'Token inválido' });
      return;
    }
    const pathMod = await import('path');
    const candidates = [
      pathMod.join(process.cwd(), 'apps/agent/install.sh'),
      pathMod.join(process.cwd(), '../agent/install.sh'),
      pathMod.join(__dirname, '../../../../agent/install.sh'),
    ];
    const file = candidates.find((p) => fs.existsSync(p));
    if (!file) {
      res.status(404).json({ success: false, error: 'install.sh não encontrado' });
      return;
    }
    let body = fs.readFileSync(file, 'utf8');
    body = body.replace(/API_URL="http:\/\/localhost:3001"/, `API_URL="${apiUrl}"`);
    res.setHeader('Content-Type', 'text/x-shellscript');
    res.setHeader('Content-Disposition', 'attachment; filename="nexaops-agent-linux.sh"');
    res.send(body);
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/download/macos/bootstrap', async (req: Request, res: Response) => {
  try {
    const token = extractAgentOrgToken(req);
    const apiUrl = resolveTrustedAgentApiUrl(
      typeof req.query.apiUrl === 'string' ? req.query.apiUrl : undefined
    );
    if (!apiUrl) {
      res.status(400).json({
        success: false,
        error: 'apiUrl não permitido. Use API_URL do servidor ou AGENT_API_URL_ALLOWLIST',
      });
      return;
    }
    if (!token) {
      res.status(400).json({ success: false, error: 'token é obrigatório (Bearer ou ?token=)' });
      return;
    }
    const org = await prisma.organization.findFirst({ where: { agentToken: token } });
    if (!org) {
      res.status(401).json({ success: false, error: 'Token inválido' });
      return;
    }
    const pathMod = await import('path');
    const candidates = [
      pathMod.join(process.cwd(), 'apps/agent/install-macos.sh'),
      pathMod.join(process.cwd(), '../agent/install-macos.sh'),
      pathMod.join(__dirname, '../../../../agent/install-macos.sh'),
    ];
    const file = candidates.find((p) => fs.existsSync(p));
    if (!file) {
      res.status(404).json({ success: false, error: 'install-macos.sh não encontrado' });
      return;
    }
    let body = fs.readFileSync(file, 'utf8');
    body = body.replace(/API_URL="http:\/\/localhost:3001"/, `API_URL="${apiUrl}"`);
    res.setHeader('Content-Type', 'text/x-shellscript');
    res.setHeader('Content-Disposition', 'attachment; filename="nexaops-agent-macos.sh"');
    res.send(body);
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

async function sendAgentTarball(req: Request, res: Response, platformLabel: string) {
  const token = extractAgentOrgToken(req);
  if (!token) {
    res.status(401).json({ success: false, error: 'token é obrigatório (Authorization: Bearer ou ?token=)' });
    return;
  }
  const org = await prisma.organization.findFirst({ where: { agentToken: token } });
  if (!org) {
    res.status(401).json({ success: false, error: 'Token inválido' });
    return;
  }
  const tarball = buildAgentTarball();
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="nexaops-agent-${platformLabel}.tgz"`);
  const stream = fs.createReadStream(tarball);
  stream.on('close', () => {
    try {
      fs.rmSync(path.dirname(tarball), { recursive: true, force: true });
    } catch { /* ignore */ }
  });
  stream.pipe(res);
}

router.get('/download/linux', async (req: Request, res: Response) => {
  try {
    await sendAgentTarball(req, res, 'linux');
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/download/macos', async (req: Request, res: Response) => {
  try {
    await sendAgentTarball(req, res, 'macos');
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/download/windows', async (req: Request, res: Response) => {
  try {
    const token = extractAgentOrgToken(req);
    if (!token) {
      res.status(401).json({ success: false, error: 'token é obrigatório (Bearer ou ?token=)' });
      return;
    }

    const org = await prisma.organization.findFirst({ where: { agentToken: token } });
    if (!org) {
      res.status(401).json({ success: false, error: 'Token inválido' });
      return;
    }

    const msiPath = resolveAgentMsiPath();
    if (!msiPath) {
      res.status(404).json({
        success: false,
        error: 'Instalador MSI não compilado. Execute: npm run build:agent-msi',
        built: false,
      });
      return;
    }

    res.download(msiPath, 'NexaOpsAgent.msi');
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/download/windows/bootstrap', async (req: Request, res: Response) => {
  try {
    const token = extractAgentOrgToken(req);
    const apiUrl = resolveTrustedAgentApiUrl(
      typeof req.query.apiUrl === 'string' ? req.query.apiUrl : undefined
    );

    if (!apiUrl) {
      res.status(400).json({
        success: false,
        error: 'apiUrl não permitido. Use API_URL do servidor ou AGENT_API_URL_ALLOWLIST',
      });
      return;
    }

    if (!token) {
      res.status(400).json({ success: false, error: 'token é obrigatório' });
      return;
    }

    const org = await prisma.organization.findFirst({ where: { agentToken: token } });
    if (!org) {
      res.status(401).json({ success: false, error: 'Token inválido' });
      return;
    }

    if (!isAgentMsiBuilt()) {
      res.status(404).json({
        success: false,
        error: 'MSI não compilado. Execute: npm run build:agent-msi',
      });
      return;
    }

    // Preferir header no curl; token ainda no MSI args (necessário no msiexec)
    const msiUrl = `${apiUrl}/api/agent/download/windows`;
    const bat = `@echo off
title NexaOps Agent Installer
echo Baixando NexaOps Agent...
curl -fsSL -H "Authorization: Bearer ${token}" -o "%TEMP%\\NexaOpsAgent.msi" "${msiUrl}"
if errorlevel 1 (
  echo Falha no download.
  pause
  exit /b 1
)
echo Instalando (inicio automatico no boot)...
msiexec /i "%TEMP%\\NexaOpsAgent.msi" /qn TOKEN=${token} API_URL=${apiUrl}
if errorlevel 1 (
  echo Falha na instalacao. Tente como Administrador.
  pause
  exit /b 1
)
echo Concluido. O equipamento aparecera no painel em instantes.
pause
`;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="Instalar-NexaOps-Agent.bat"');
    res.send(bat);
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/download/status', (_req, res: Response) => {
  res.json({
    success: true,
    data: {
      windowsMsi: isAgentMsiBuilt(),
      path: resolveAgentMsiPath(),
      linuxMacPackage: true,
    },
  });
});

// ─── Autenticado (Bearer agentToken + agentId) ───────────────────────────────

const protectedRouter = Router();
protectedRouter.use(agentLimiter);
protectedRouter.use(authenticateAgent);

protectedRouter.post('/heartbeat', async (req: AgentAuthRequest, res: Response) => {
  try {
    const deviceId = req.agent!.deviceId;
    const organizationId = req.agent!.organizationId;
    const { lastUserLogin, agentVersion, meshNodeId } = req.body;

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { agentToken: true, agentMinVersion: true },
    });

    await prisma.device.update({
      where: { id: deviceId },
      data: {
        status: 'ONLINE',
        lastSeenAt: new Date(),
        ...(lastUserLogin && { lastUserLogin }),
        ...(typeof agentVersion === 'string' && { agentVersion }),
        ...(typeof meshNodeId === 'string' && { meshNodeId }),
      },
    });

    const pendingExecutions = await prisma.scriptExecution.findMany({
      where: { deviceId, status: 'PENDING', awaitingApproval: false },
      include: { script: { select: { id: true, name: true, content: true, language: true } } },
      take: 5,
    });

    if (pendingExecutions.length > 0) {
      await prisma.scriptExecution.updateMany({
        where: { id: { in: pendingExecutions.map((e) => e.id) } },
        data: { status: 'RUNNING' },
      });
    }

    const scheduledPatches = await prisma.patch.findMany({
      where: { deviceId, status: 'SCHEDULED' },
      take: 20,
      orderBy: { scheduledAt: 'asc' },
    });

    const pendingScans = await prisma.networkScan.findMany({
      where: {
        organizationId,
        mode: 'agent',
        status: 'PENDING',
        OR: [{ scannerDeviceId: deviceId }, { scannerDeviceId: null }],
      },
      take: 3,
      orderBy: { createdAt: 'asc' },
    });

    if (pendingScans.length > 0) {
      await prisma.networkScan.updateMany({
        where: { id: { in: pendingScans.map((s) => s.id) } },
        data: { status: 'RUNNING', startedAt: new Date(), scannerDeviceId: deviceId },
      });
    }

    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      select: { osType: true },
    });

    const { AGENT_CURRENT_VERSION, needsAgentUpdate } = await import('../lib/agent-version.js');
    const currentVer = typeof agentVersion === 'string' ? agentVersion : null;
    const updateNeeded = needsAgentUpdate(currentVer, org?.agentMinVersion);
    const apiUrl = process.env.API_URL || 'http://localhost:3001';
    let downloadPath = '/api/agent/download/windows';
    const osType = (device?.osType || '').toUpperCase();
    if (osType === 'LINUX') downloadPath = '/api/agent/download/linux';
    else if (osType === 'MACOS' || osType === 'DARWIN') downloadPath = '/api/agent/download/macos';

    const update = updateNeeded && org?.agentToken
      ? {
          version: org.agentMinVersion || AGENT_CURRENT_VERSION,
          // Token via Authorization no agent-update; URL sem query
          downloadUrl: `${apiUrl}${downloadPath}`,
          mandatory: Boolean(org.agentMinVersion),
        }
      : null;

    res.json({
      success: true,
      data: {
        commands: pendingExecutions,
        patches: scheduledPatches,
        networkScans: pendingScans.map((s) => ({
          id: s.id,
          subnet: s.subnet,
          maxHosts: 64,
        })),
        update,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

protectedRouter.post('/metrics', validateBody(agentMetricsSchema), async (req: AgentAuthRequest, res: Response) => {
  try {
    const deviceId = req.agent!.deviceId;
    const { cpuPercent, ramPercent, diskPercent, rebootPending } = req.body;

    await prisma.resourceMetric.create({
      data: { deviceId, cpuPercent, ramPercent, diskPercent },
    });

    await prisma.device.update({
      where: { id: deviceId },
      data: {
        lastSeenAt: new Date(),
        status: 'ONLINE',
        ...(rebootPending !== undefined && { rebootPending: Boolean(rebootPending) }),
      },
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

protectedRouter.post('/hardware', async (req: AgentAuthRequest, res: Response) => {
  try {
    const deviceId = req.agent!.deviceId;
    const { hardware } = req.body;
    if (!hardware) {
      res.status(400).json({ success: false, error: 'hardware é obrigatório' });
      return;
    }

    await prisma.hardwareInfo.upsert({
      where: { deviceId },
      create: {
        deviceId,
        cpuModel: hardware.cpuModel,
        cpuCores: hardware.cpuCores,
        ramTotalGb: hardware.ramTotalGb,
        diskTotalGb: hardware.diskTotalGb,
        diskFreeGb: hardware.diskFreeGb,
        manufacturer: hardware.manufacturer,
        model: hardware.model,
        serialNumber: hardware.serialNumber,
      },
      update: {
        cpuModel: hardware.cpuModel,
        cpuCores: hardware.cpuCores,
        ramTotalGb: hardware.ramTotalGb,
        diskTotalGb: hardware.diskTotalGb,
        diskFreeGb: hardware.diskFreeGb,
        manufacturer: hardware.manufacturer,
        model: hardware.model,
        serialNumber: hardware.serialNumber,
      },
    });

    await prisma.device.update({
      where: { id: deviceId },
      data: { lastSeenAt: new Date(), status: 'ONLINE' },
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

protectedRouter.post('/software', async (req: AgentAuthRequest, res: Response) => {
  try {
    const deviceId = req.agent!.deviceId;
    const { items } = req.body as {
      items: { name: string; version?: string | null; publisher?: string | null }[];
    };

    if (!Array.isArray(items)) {
      res.status(400).json({ success: false, error: 'items é obrigatório' });
      return;
    }

    await prisma.$transaction([
      prisma.softwareItem.deleteMany({ where: { deviceId } }),
      prisma.softwareItem.createMany({
        data: items.map((item) => ({
          deviceId,
          name: item.name,
          version: item.version ?? null,
          publisher: item.publisher ?? null,
        })),
      }),
    ]);

    await prisma.device.update({
      where: { id: deviceId },
      data: { lastSeenAt: new Date(), status: 'ONLINE' },
    });

    const { syncAssetsFromDevice } = await import('../services/asset-sync.service.js');
    const synced = await syncAssetsFromDevice(deviceId).catch(() => ({ hardware: 0, software: 0 }));

    res.json({ success: true, data: { count: items.length, assetsSynced: synced } });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

protectedRouter.post('/interfaces', async (req: AgentAuthRequest, res: Response) => {
  try {
    const deviceId = req.agent!.deviceId;
    const organizationId = req.agent!.organizationId;
    const { interfaces } = req.body as {
      interfaces: {
        name: string;
        mac?: string | null;
        ipv4?: string | null;
        ipv6?: string | null;
        netmask?: string | null;
        cidr?: string | null;
        internal?: boolean;
        isUp?: boolean;
        speedMbps?: number | null;
        dhcp?: boolean | null;
        gateway?: string | null;
        dns?: string | null;
      }[];
    };

    if (!Array.isArray(interfaces)) {
      res.status(400).json({ success: false, error: 'interfaces é obrigatório' });
      return;
    }

    const device = await prisma.device.findFirst({
      where: { id: deviceId, organizationId },
    });
    if (!device) {
      res.status(404).json({ success: false, error: 'Dispositivo não encontrado' });
      return;
    }

    const existingInterfaces = await prisma.deviceNetworkInterface.findMany({
      where: { deviceId },
    });

    const alerts = await processInterfaceAlerts(device, existingInterfaces, interfaces);

    const reportedNames = new Set<string>();

    for (const iface of interfaces) {
      reportedNames.add(iface.name);
      await prisma.deviceNetworkInterface.upsert({
        where: { deviceId_name: { deviceId, name: iface.name } },
        create: {
          deviceId,
          name: iface.name,
          mac: iface.mac ?? null,
          ipv4: iface.ipv4 ?? null,
          ipv6: iface.ipv6 ?? null,
          netmask: iface.netmask ?? null,
          cidr: iface.cidr ?? null,
          internal: iface.internal ?? false,
          isUp: iface.isUp ?? true,
          speedMbps: iface.speedMbps ?? null,
          dhcp: iface.dhcp ?? null,
          gateway: iface.gateway ?? null,
          dns: iface.dns ?? null,
        },
        update: {
          mac: iface.mac ?? null,
          ipv4: iface.ipv4 ?? null,
          ipv6: iface.ipv6 ?? null,
          netmask: iface.netmask ?? null,
          cidr: iface.cidr ?? null,
          internal: iface.internal ?? false,
          isUp: iface.isUp ?? true,
          speedMbps: iface.speedMbps ?? null,
          dhcp: iface.dhcp ?? null,
          gateway: iface.gateway ?? null,
          dns: iface.dns ?? null,
        },
      });
    }

    await prisma.deviceNetworkInterface.deleteMany({
      where: {
        deviceId,
        name: { notIn: [...reportedNames] },
      },
    });

    await prisma.device.update({
      where: { id: deviceId },
      data: { lastSeenAt: new Date(), status: 'ONLINE' },
    });

    res.json({ success: true, data: { count: interfaces.length, alertsCreated: alerts.length } });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

protectedRouter.post('/execution/:id/result', async (req: AgentAuthRequest, res: Response) => {
  try {
    const deviceId = req.agent!.deviceId;
    const { status, output } = req.body;

    const execution = await prisma.scriptExecution.findFirst({
      where: { id: req.params.id as string, deviceId },
    });
    if (!execution) {
      res.status(404).json({ success: false, error: 'Execução não encontrada' });
      return;
    }

    const updated = await prisma.scriptExecution.update({
      where: { id: execution.id },
      data: {
        status: status || 'SUCCESS',
        output,
        completedAt: new Date(),
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

protectedRouter.post('/patches/result', async (req: AgentAuthRequest, res: Response) => {
  try {
    const deviceId = req.agent!.deviceId;
    const { results } = req.body as {
      results?: Array<{ id: string; status: 'INSTALLED' | 'FAILED'; output?: string }>;
    };
    if (!Array.isArray(results) || results.length === 0) {
      res.status(400).json({ success: false, error: 'results é obrigatório' });
      return;
    }

    let installed = 0;
    for (const r of results) {
      const patch = await prisma.patch.findFirst({
        where: { id: r.id, deviceId },
      });
      if (!patch) continue;
      await prisma.patch.update({
        where: { id: patch.id },
        data: {
          status: r.status === 'INSTALLED' ? 'INSTALLED' : 'FAILED',
          ...(r.status === 'INSTALLED' ? { installedAt: new Date() } : {}),
        },
      });
      if (r.status === 'INSTALLED') installed += 1;
    }

    const pendingCount = await prisma.patch.count({
      where: {
        deviceId,
        status: { in: ['PENDING', 'SCHEDULED', 'FAILED'] },
      },
    });
    await prisma.device.update({
      where: { id: deviceId },
      data: {
        patchesAvailable: pendingCount,
        lastSeenAt: new Date(),
        status: 'ONLINE',
      },
    });

    res.json({ success: true, data: { processed: results.length, installed } });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

protectedRouter.post('/remote-session/ack', async (req: AgentAuthRequest, res: Response) => {
  try {
    const deviceId = req.agent!.deviceId;
    const { sessionId, status } = req.body as {
      sessionId?: string;
      status?: string;
    };
    if (!sessionId) {
      res.status(400).json({ success: false, error: 'sessionId é obrigatório' });
      return;
    }
    const session = await prisma.remoteSession.findFirst({
      where: { id: sessionId, deviceId },
    });
    if (!session) {
      res.status(404).json({ success: false, error: 'Sessão não encontrada' });
      return;
    }
    const nextStatus = status === 'FAILED' ? 'DISCONNECTED' : 'CONNECTED';
    const updated = await prisma.remoteSession.update({
      where: { id: session.id },
      data: {
        status: nextStatus,
        ...(nextStatus === 'CONNECTED' ? { connectedAt: new Date() } : { endedAt: new Date() }),
      },
    });
    const { appendRemoteAudit } = await import('../lib/ops.js');
    await appendRemoteAudit(
      session.id,
      nextStatus === 'CONNECTED' ? 'agent_ack' : 'agent_failed',
      status
    );
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

protectedRouter.post('/patches/discovered', async (req: AgentAuthRequest, res: Response) => {
  try {
    const deviceId = req.agent!.deviceId;
    const organizationId = req.agent!.organizationId;
    const { patches } = req.body as {
      patches?: Array<{ title: string; kbId?: string; severity?: string }>;
    };

    const list = Array.isArray(patches) ? patches : [];
    let created = 0;
    for (const p of list.slice(0, 100)) {
      if (!p.title) continue;
      const existing = p.kbId
        ? await prisma.patch.findFirst({
            where: { deviceId, kbId: p.kbId },
          })
        : await prisma.patch.findFirst({
            where: { deviceId, title: p.title, status: { in: ['PENDING', 'SCHEDULED'] } },
          });
      if (existing) continue;
      await prisma.patch.create({
        data: {
          title: p.title,
          kbId: p.kbId ?? null,
          severity: p.severity ?? null,
          status: 'PENDING',
          deviceId,
          organizationId,
        },
      });
      created += 1;
    }

    const pendingCount = await prisma.patch.count({
      where: {
        deviceId,
        status: { in: ['PENDING', 'SCHEDULED', 'FAILED'] },
      },
    });
    await prisma.device.update({
      where: { id: deviceId },
      data: { patchesAvailable: pendingCount },
    });

    res.json({ success: true, data: { created, patchesAvailable: pendingCount } });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

protectedRouter.post('/network-scan/:id/result', async (req: AgentAuthRequest, res: Response) => {
  try {
    const organizationId = req.agent!.organizationId;
    const deviceId = req.agent!.deviceId;
    const scanId = req.params.id as string;
    const { hosts, failed, error } = req.body as {
      hosts?: Array<{ ipAddress: string; hostname?: string | null; deviceType?: string }>;
      failed?: boolean;
      error?: string;
    };

    const scan = await prisma.networkScan.findFirst({
      where: { id: scanId, organizationId, mode: 'agent' },
    });
    if (!scan) {
      res.status(404).json({ success: false, error: 'Scan não encontrado' });
      return;
    }

    if (failed) {
      await prisma.networkScan.update({
        where: { id: scan.id },
        data: { status: 'FAILED', completedAt: new Date(), scannerDeviceId: deviceId },
      });
      res.json({ success: true, data: { status: 'FAILED', error } });
      return;
    }

    const list = Array.isArray(hosts) ? hosts : [];
    if (list.length > 0) {
      await prisma.discoveredDevice.createMany({
        data: list.slice(0, 500).map((d) => ({
          ipAddress: d.ipAddress,
          hostname: d.hostname ?? null,
          deviceType: d.deviceType ?? 'PC',
          scanId: scan.id,
        })),
      });
    }

    await prisma.networkScan.update({
      where: { id: scan.id },
      data: {
        status: 'COMPLETED',
        devicesFound: list.length,
        completedAt: new Date(),
        scannerDeviceId: deviceId,
      },
    });

    res.json({ success: true, data: { devicesFound: list.length } });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.use(protectedRouter);

export default router;
