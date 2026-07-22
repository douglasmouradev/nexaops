import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from './prisma.js';
import { emitDeviceStatusChange, emitAgentCommand } from '../socket.js';
import { getIo } from './io.js';
import { evaluateAlertsForOrganization, evaluateAllOrgAlerts } from './alert-evaluation.js';
import type { Server } from 'socket.io';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const isTest = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;
const MIN_REDIS_MAJOR = 7;
const REDIS_REQUIRED = process.env.REDIS_REQUIRED === 'true';

let connection: IORedis | null = null;
let scriptQueue: Queue | null = null;
let alertQueue: Queue | null = null;
let queuesEnabled = false;
let alertFallbackStarted = false;

export function areQueuesEnabled() {
  return queuesEnabled;
}

function parseRedisMajor(info: string): number | null {
  const match = info.match(/redis_version:(\d+)\./);
  if (!match) return null;
  return Number(match[1]);
}

async function createValidatedConnection(): Promise<IORedis | null> {
  if (isTest) return null;

  const conn = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    retryStrategy: () => null,
    enableOfflineQueue: false,
  });

  conn.on('error', () => {
    /* silencia erros de conexão em modo fallback */
  });

  try {
    await conn.connect();
    const info = await conn.info('server');
    const major = parseRedisMajor(info);
    if (major === null || major < MIN_REDIS_MAJOR) {
      console.log(
        `⚠️  Redis ${major ?? '?'}.x detectado — BullMQ exige ≥ ${MIN_REDIS_MAJOR}. Filas desativadas (modo fallback).`
      );
      await conn.quit().catch(() => undefined);
      if (REDIS_REQUIRED) {
        throw new Error(`REDIS_REQUIRED=true mas Redis ${major ?? '?'}.x é incompatível`);
      }
      return null;
    }
    return conn;
  } catch (err) {
    await conn.quit().catch(() => undefined);
    if (REDIS_REQUIRED) {
      throw err instanceof Error ? err : new Error('Redis obrigatório indisponível');
    }
    console.log('⚠️  Redis indisponível — filas BullMQ desativadas (modo fallback)');
    return null;
  }
}

export async function initWorkers(io: Server): Promise<void> {
  try {
    const conn = await createValidatedConnection();
    if (!conn) {
      startAlertFallback(io);
      return;
    }

    connection = conn;
    const defaultJobOpts = {
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    };

    scriptQueue = new Queue('script-execution', { connection: conn, defaultJobOptions: defaultJobOpts });
    alertQueue = new Queue('alert-evaluation', { connection: conn, defaultJobOptions: defaultJobOpts });
    queuesEnabled = true;

    // Notifica o agente via socket; execução real fica com o agent (PENDING até result)
    const scriptWorker = new Worker(
      'script-execution',
      async (job: Job<{ executionId: string }>) => {
        const execution = await prisma.scriptExecution.findUnique({
          where: { id: job.data.executionId },
          include: {
            script: { select: { id: true, name: true, content: true, language: true } },
            device: { select: { id: true, agentId: true, organizationId: true } },
          },
        });
        if (!execution?.device.agentId || execution.status !== 'PENDING') return;
        if (execution.awaitingApproval) return;

        emitAgentCommand(io, execution.device.agentId, {
          type: 'script:run',
          execution: {
            id: execution.id,
            script: execution.script,
          },
        });
      },
      { connection: conn }
    );
    scriptWorker.on('failed', (job, err) => {
      console.error(`[BullMQ] script-execution failed job=${job?.id}:`, err.message);
    });

    const alertWorker = new Worker(
      'alert-evaluation',
      async (job: Job<{ organizationId: string }>) => {
        await evaluateAlertsForOrganization(job.data.organizationId, io);
      },
      { connection: conn }
    );
    alertWorker.on('failed', (job, err) => {
      console.error(`[BullMQ] alert-evaluation failed job=${job?.id}:`, err.message);
    });

    setInterval(async () => {
      if (!alertQueue) return;
      const orgs = await prisma.organization.findMany({ select: { id: true } });
      for (const org of orgs) {
        await alertQueue.add('evaluate', { organizationId: org.id });
      }
    }, 60_000);

    console.log('✅ BullMQ workers iniciados (retry 3x + dead-letter via failed set)');
  } catch (err) {
    queuesEnabled = false;
    scriptQueue = null;
    alertQueue = null;
    connection = null;
    if (REDIS_REQUIRED) {
      throw err;
    }
    console.log(
      '⚠️  Falha ao iniciar BullMQ — filas desativadas:',
      err instanceof Error ? err.message : err
    );
    startAlertFallback(io);
  }
}

/** Sem Redis/BullMQ: avalia alertas a cada 60s no processo da API. */
export function startAlertFallback(io?: Server): void {
  if (isTest || alertFallbackStarted) return;
  alertFallbackStarted = true;
  console.log('ℹ️  Fallback de alertas ativo (sem BullMQ)');
  setInterval(() => {
    evaluateAllOrgAlerts(io ?? getIo()).catch((err) => {
      console.error('[alerts-fallback]', err instanceof Error ? err.message : err);
    });
  }, 60_000);
}

/**
 * Enfileira notificação ao agente. A execução permanece PENDING até o agent reportar resultado.
 * Sem Redis: o agent busca PENDING no heartbeat.
 */
export async function queueScriptExecution(executionId: string): Promise<void> {
  if (queuesEnabled && scriptQueue) {
    try {
      await scriptQueue.add('run', { executionId });
      return;
    } catch {
      /* heartbeat fallback */
    }
  }

  // Sem fila: tenta push socket imediato se IO disponível
  try {
    const io = getIo();
    const execution = await prisma.scriptExecution.findUnique({
      where: { id: executionId },
      include: {
        script: { select: { id: true, name: true, content: true, language: true } },
        device: { select: { agentId: true } },
      },
    });
    if (
      io &&
      execution?.device.agentId &&
      execution.status === 'PENDING' &&
      !execution.awaitingApproval
    ) {
      emitAgentCommand(io, execution.device.agentId, {
        type: 'script:run',
        execution: { id: execution.id, script: execution.script },
      });
    }
  } catch {
    /* agent pega no próximo heartbeat */
  }
}

export async function checkOfflineDevices(io: Server): Promise<void> {
  const offlineThreshold = 15 * 60 * 1000;
  const devices = await prisma.device.findMany({
    where: { status: 'ONLINE' },
  });

  for (const device of devices) {
    if (device.lastSeenAt && Date.now() - device.lastSeenAt.getTime() > offlineThreshold) {
      await prisma.device.update({
        where: { id: device.id },
        data: { status: 'OFFLINE' },
      });
      emitDeviceStatusChange(io, device.organizationId, device.id, 'OFFLINE');
    }
  }
}

export async function pingRedis(): Promise<'ok' | 'disabled' | 'error'> {
  if (isTest) return 'disabled';
  if (!queuesEnabled || !connection) return 'disabled';
  try {
    const pong = await connection.ping();
    return pong === 'PONG' ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}

