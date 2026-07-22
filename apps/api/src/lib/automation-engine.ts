import { prisma } from './prisma.js';
import { queueScriptExecution } from './queue.js';
import { logger } from './logger.js';
import { getIo } from './io.js';
import { emitAgentCommand } from '../socket.js';

type TriggerConfig = {
  minute?: number;
  hour?: number;
  weekday?: number; // 0=Dom
  days?: number[];
  startHour?: number;
  endHour?: number;
  offlineMinutes?: number;
};

type ActionConfig = {
  siteId?: string;
  deviceIds?: string[];
  scriptId?: string;
};

function matchesCron(cfg: TriggerConfig, now: Date): boolean {
  if (cfg.weekday != null && now.getDay() !== cfg.weekday) return false;
  if (cfg.hour != null && now.getHours() !== cfg.hour) return false;
  if (cfg.minute != null && now.getMinutes() !== cfg.minute) return false;
  // se só hour/minute definidos, já bateu; se nada, não dispara (evita loop)
  return cfg.hour != null || cfg.minute != null || cfg.weekday != null;
}

/** Evita multi-fire no mesmo minuto (engine pode rodar a cada poucos segundos). */
function alreadyRanThisMinute(lastRunAt: Date | null | undefined, now: Date): boolean {
  if (!lastRunAt) return false;
  return (
    lastRunAt.getFullYear() === now.getFullYear() &&
    lastRunAt.getMonth() === now.getMonth() &&
    lastRunAt.getDate() === now.getDate() &&
    lastRunAt.getHours() === now.getHours() &&
    lastRunAt.getMinutes() === now.getMinutes()
  );
}

export function inMaintenanceWindow(cfg: TriggerConfig, now = new Date()): boolean {
  const days = cfg.days;
  if (Array.isArray(days) && days.length > 0 && !days.includes(now.getDay())) return false;
  const start = cfg.startHour ?? 0;
  const end = cfg.endHour ?? 24;
  const h = now.getHours();
  if (start <= end) return h >= start && h < end;
  return h >= start || h < end;
}

/**
 * Avalia AutomationProfiles habilitados.
 * Triggers: cron | device_offline | alert_critical
 * Actions: run_script | schedule_pending_patches
 */
export async function runAutomationEngine(): Promise<number> {
  const now = new Date();
  // só dispara cron no minuto cheio (evita multi-fire no mesmo minuto via lastRun — simples: minute match)
  const profiles = await prisma.automationProfile.findMany({
    where: { enabled: true },
  });

  let actions = 0;

  for (const profile of profiles) {
    try {
      const tcfg = (profile.triggerConfig || {}) as TriggerConfig;
      const acfg = (profile.actionConfig || {}) as ActionConfig;
      let shouldRun = false;

      if (profile.trigger === 'cron') {
        shouldRun = matchesCron(tcfg, now);
      } else if (profile.trigger === 'device_offline') {
        const mins = tcfg.offlineMinutes || 30;
        const cutoff = new Date(Date.now() - mins * 60_000);
        const offline = await prisma.device.count({
          where: {
            organizationId: profile.organizationId,
            status: 'OFFLINE',
            lastSeenAt: { lt: cutoff },
            ...(acfg.siteId ? { siteId: acfg.siteId } : {}),
          },
        });
        shouldRun = offline > 0 && matchesCron({ minute: now.getMinutes(), hour: now.getHours() }, now);
        // device_offline: roda 1x/hora no minuto 0
        shouldRun = offline > 0 && now.getMinutes() === 0;
      } else if (profile.trigger === 'alert_critical') {
        const open = await prisma.alert.count({
          where: {
            organizationId: profile.organizationId,
            severity: 'CRITICAL',
            status: 'NEW',
          },
        });
        shouldRun = open > 0 && now.getMinutes() === 0;
      } else if (profile.trigger === 'maintenance_window') {
        // janela só como gate — ação de patches dentro da janela
        shouldRun = inMaintenanceWindow(tcfg, now) && now.getMinutes() === 0;
      }

      if (!shouldRun) continue;
      if (alreadyRanThisMinute(profile.lastRunAt, now)) continue;

      await prisma.automationProfile.update({
        where: { id: profile.id },
        data: { lastRunAt: now },
      });
      profile.lastRunAt = now;

      if (profile.action === 'run_script') {
        const scriptId = acfg.scriptId || profile.scriptId;
        if (!scriptId) continue;
        const script = await prisma.script.findFirst({
          where: { id: scriptId, organizationId: profile.organizationId },
        });
        if (!script) continue;

        const devices = await prisma.device.findMany({
          where: {
            organizationId: profile.organizationId,
            status: 'ONLINE',
            ...(acfg.siteId ? { siteId: acfg.siteId } : {}),
            ...(acfg.deviceIds?.length ? { id: { in: acfg.deviceIds } } : {}),
          },
          take: 50,
          select: { id: true },
        });

        for (const d of devices) {
          const exec = await prisma.scriptExecution.create({
            data: {
              scriptId: script.id,
              deviceId: d.id,
              organizationId: profile.organizationId,
              status: 'PENDING',
              awaitingApproval: script.requiresApproval,
            },
          });
          if (!script.requiresApproval) {
            await queueScriptExecution(exec.id);
          }
          actions += 1;
        }
      } else if (profile.action === 'schedule_pending_patches') {
        // respeita maintenance_window se triggerConfig tiver days/hours
        if (tcfg.days || tcfg.startHour != null) {
          if (!inMaintenanceWindow(tcfg, now)) continue;
        }
        const patches = await prisma.patch.findMany({
          where: {
            organizationId: profile.organizationId,
            status: 'PENDING',
            ...(acfg.siteId
              ? { device: { siteId: acfg.siteId } }
              : {}),
          },
          take: 100,
          include: { device: { select: { agentId: true } } },
        });

        const io = getIo();
        for (const p of patches) {
          await prisma.patch.update({
            where: { id: p.id },
            data: { status: 'SCHEDULED', scheduledAt: now },
          });
          if (io && p.device.agentId) {
            emitAgentCommand(io, p.device.agentId, {
              type: 'patch:install',
              patch: { id: p.id, title: p.title, kbId: p.kbId },
            });
          }
          actions += 1;
        }
      }
    } catch (err) {
      logger.error('automation_profile_failed', {
        id: profile.id,
        error: String(err),
      });
    }
  }

  if (actions > 0) logger.info('automation_ran', { actions });
  return actions;
}
