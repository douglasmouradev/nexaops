/**
 * NexaOps Agent v0.5 — Auto-update + network scan on-site + Socket.io
 */

const os = require('os');
const https = require('https');
const http = require('http');
const { collectInterfaces, detectChanges, formatForApi, summarize } = require('./lib/interface-monitor');
const { collectMetrics, getHardwareInfo } = require('./lib/metrics');
const { executeScript } = require('./lib/script-runner');
const { collectSoftware } = require('./lib/software-inventory');
const { enqueue, flushQueue, queueSize } = require('./lib/offline-queue');
const { loadConfig, saveConfig, writeLog } = require('./lib/config');
const { discoverWindowsPatches, discoverLinuxPatches, discoverMacPatches, installScheduledPatch } = require('./lib/patch-installer');
const { handleWebRtcOffer, isWrtcAvailable } = require('./lib/webrtc-session');
const { scanSubnet } = require('./lib/network-scan');
const { applyAgentUpdate } = require('./lib/agent-update');
const { startScreenShare, stopScreenShare } = require('./lib/screen-share');
const { applyRemoteInput, stopRemoteInputHost } = require('./lib/remote-input');
const {
  startRemoteDesktop,
  stopRemoteDesktop,
  sendRemoteInput,
} = require('./lib/interactive-session');

const AGENT_VERSION = '0.5.0';

const fileConfig = loadConfig();

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

const API_URL = args.api || process.env.API_URL || fileConfig.apiUrl || 'http://localhost:3001';
/** Token da organização (sempre usado no /register) */
const ORG_TOKEN = args.token || process.env.AGENT_TOKEN || fileConfig.token || null;
/** Após register, preferir deviceToken nas demais rotas */
let TOKEN = fileConfig.deviceToken || ORG_TOKEN;

function log(message) {
  writeLog(message);
  console.log(message);
}

function logError(message) {
  writeLog(`ERROR: ${message}`);
  console.error(message);
}

if (!ORG_TOKEN && !TOKEN) {
  logError('Token não configurado. Use --token=, AGENT_TOKEN ou config.json');
  process.exit(1);
}

if (!ORG_TOKEN) {
  logError('Token da organização ausente no config (campo "token"). Reinstale com o Agent token da org.');
  process.exit(1);
}

let agentId = null;
let deviceId = null;
let lastInterfaces = [];
let lastSoftwareSync = 0;
let lastHardwareSync = 0;
let lastPatchDiscover = 0;
let socket = null;

const SOFTWARE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const HARDWARE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PATCH_DISCOVER_MS = 12 * 60 * 60 * 1000;

function request(method, path, body, { queueOnFail = true } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_URL);
    const lib = url.protocol === 'https:' ? https : http;
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      ...(agentId ? { 'X-Agent-Id': agentId } : {}),
      ...(data && { 'Content-Length': Buffer.byteLength(data) }),
    };
    const req = lib.request(
      url,
      {
        method,
        headers,
        timeout: 30000,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(raw || '{}');
          } catch {
            parsed = { raw };
          }
          if (res.statusCode >= 400) {
            reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
          } else {
            resolve(parsed);
          }
        });
      }
    );
    req.on('error', (err) => {
      if (queueOnFail && method === 'POST' && body) {
        enqueue({ method, path, body });
      }
      reject(err);
    });
    req.on('timeout', () => {
      req.destroy();
      if (queueOnFail && method === 'POST' && body) {
        enqueue({ method, path, body });
      }
      reject(new Error('Timeout'));
    });
    if (data) req.write(data);
    req.end();
  });
}

async function apiPost(path, body, opts) {
  return request('POST', path, body, opts);
}

async function register() {
  const m = collectMetrics();
  // /register exige o agentToken da ORG — nunca o deviceToken
  const res = await apiPost('/api/agent/register', {
    token: ORG_TOKEN,
    hostname: os.hostname(),
    osType: process.platform === 'win32' ? 'WINDOWS' : process.platform === 'darwin' ? 'MACOS' : 'LINUX',
    osVersion: `${os.type()} ${os.release()}`,
    hardware: m.hardware,
    rebootPending: m.rebootPending,
  }, { queueOnFail: false });

  if (!res.success) throw new Error(res.error || 'Falha no registro');
  agentId = res.data.agentId;
  deviceId = res.data.deviceId;
  if (res.data.deviceToken) {
    TOKEN = res.data.deviceToken;
    saveConfig({
      token: ORG_TOKEN,
      deviceToken: res.data.deviceToken,
      apiUrl: API_URL,
      agentId,
      deviceId,
    });
    log('Token por device gravado no config do agent');
  }
  // Força re-sync de hardware no próximo ciclo (disco via CIM pode vir 0 no 1º register)
  lastHardwareSync = 0;
  log(`Registrado: device=${deviceId} agent=${agentId}`);
}

function connectSocket() {
  try {
    const { io } = require('socket.io-client');
    socket = io(API_URL, {
      auth: { agentToken: TOKEN, agentId },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 5000,
    });

    socket.on('connect', () => log('Socket.io conectado'));
    socket.on('disconnect', (reason) => log(`Socket.io desconectado: ${reason}`));
    socket.on('connect_error', (err) => logError(`Socket.io: ${err.message}`));

    socket.on('agent:command', async (payload) => {
      try {
        if (payload?.type === 'script:run' && payload.execution) {
          await runScriptExecution(payload.execution);
        } else if (payload?.type === 'patch:install') {
          const list = payload.patches || (payload.patch ? [payload.patch] : []);
          await installPatches(list);
        } else if (payload?.type === 'remote:session' && payload.session) {
          await ackRemoteSession(payload.session);
        } else if (payload?.type === 'remote:end' && payload.session) {
          log(`Sessão remota encerrada pelo painel: ${payload.session.id}`);
          await cleanupRemoteSession();
        } else if (payload?.type === 'network:scan' && payload.scan) {
          await runNetworkScan(payload.scan);
        }
      } catch (e) {
        logError(`Comando socket: ${e.message}`);
      }
    });
  } catch (e) {
    logError(`Socket.io indisponível — usando só heartbeat: ${e.message}`);
  }
}

async function syncHardware() {
  const hardware = getHardwareInfo();
  await apiPost('/api/agent/hardware', { agentId, hardware });
  lastHardwareSync = Date.now();
  log('Hardware sincronizado');
}

async function heartbeat() {
  const res = await apiPost('/api/agent/heartbeat', {
    agentId,
    agentVersion: AGENT_VERSION,
    lastUserLogin: os.userInfo().username,
  });

  const commands = res.data?.commands || [];
  for (const cmd of commands) {
    await runScriptExecution(cmd);
  }

  const patches = res.data?.patches || [];
  if (patches.length > 0) {
    await installPatches(patches);
  }

  const scans = res.data?.networkScans || [];
  for (const scan of scans) {
    await runNetworkScan(scan);
  }

  if (res.data?.update) {
    await applyAgentUpdate(res.data.update, { token: TOKEN, apiUrl: API_URL, log, logError });
  }
}

async function runNetworkScan(scan) {
  log(`Network scan ${scan.id}: ${scan.subnet}`);
  try {
    const hosts = await scanSubnet(scan.subnet, { maxHosts: scan.maxHosts || 64 });
    await apiPost(`/api/agent/network-scan/${scan.id}/result`, { agentId, hosts });
    log(`Network scan ${scan.id}: ${hosts.length} host(s)`);
  } catch (e) {
    await apiPost(`/api/agent/network-scan/${scan.id}/result`, {
      agentId,
      failed: true,
      error: e.message,
    }).catch(() => undefined);
    logError(`Network scan: ${e.message}`);
  }
}

async function runScriptExecution(cmd) {
  const script = cmd.script;
  if (!script) return;

  log(`Executando script: ${script.name} (${script.language || 'POWERSHELL'})`);
  const result = await executeScript({
    content: script.content,
    language: script.language,
    name: script.name,
  });

  await apiPost(`/api/agent/execution/${cmd.id}/result`, {
    status: result.status === 'TIMEOUT' ? 'FAILED' : result.status,
    output: result.output,
    agentId,
  });
  log(`Script ${script.name}: ${result.status}`);
}

async function installPatches(patches) {
  if (!patches.length) return;
  log(`Instalando ${patches.length} patch(es)...`);
  const results = [];
  for (const p of patches) {
    const r = await installScheduledPatch(p);
    results.push(r);
    log(`Patch ${p.kbId || p.title}: ${r.status}`);
  }
  await apiPost('/api/agent/patches/result', { agentId, results });
}

let remoteSignalHandler = null;
let remoteInputHandler = null;
let activeRemoteSessionId = null;

async function cleanupRemoteSession() {
  if (socket) {
    if (remoteSignalHandler) {
      socket.off('remote:signal', remoteSignalHandler);
      remoteSignalHandler = null;
    }
    if (remoteInputHandler) {
      socket.off('remote:input', remoteInputHandler);
      remoteInputHandler = null;
    }
  }
  activeRemoteSessionId = null;
  try {
    stopRemoteInputHost();
  } catch (_) {}
  await stopRemoteDesktop({ stopScreenShare });
}

async function ackRemoteSession(session) {
  log(`Sessão remota solicitada: ${session.id} (${session.provider || 'native'}) host=${session.host || '?'}`);
  await cleanupRemoteSession();

  await apiPost('/api/agent/remote-session/ack', {
    agentId,
    sessionId: session.id,
    status: 'CONNECTED',
  });

  if (!socket) return;

  activeRemoteSessionId = session.id;
  const emitFrame = (frame) => {
    if (socket && activeRemoteSessionId) socket.emit('remote:frame', frame);
  };

  const modeInfo = await startRemoteDesktop(session.id, emitFrame, {
    startScreenShare,
    log,
    logError,
  });
  log(`Remoto ativo mode=${modeInfo.mode}`);

  remoteSignalHandler = async (payload) => {
    if (payload?.sessionId !== session.id) return;
    const data = payload?.data;
    if (data?.type === 'offer') {
      const iceServers = data.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }];
      const ok = await handleWebRtcOffer(socket, session.id, data.sdp, iceServers).catch(() => false);
      if (!ok) {
        log(`WebRTC: fallback JPEG (wrtc=${isWrtcAvailable() ? 'ok' : 'off'})`);
      } else {
        log('WebRTC: answer SDP enviada (experimental)');
      }
    }
  };

  remoteInputHandler = async (payload) => {
    if (payload?.sessionId !== session.id) return;
    try {
      const ev = payload.event || payload;
      const viaHelper = await sendRemoteInput(ev);
      if (viaHelper === null) {
        await applyRemoteInput(ev);
      }
    } catch (e) {
      log(`remote:input erro: ${e.message}`);
    }
  };

  socket.on('remote:signal', remoteSignalHandler);
  socket.on('remote:input', remoteInputHandler);
}

async function discoverPatches() {
  let found = [];
  if (process.platform === 'win32') found = await discoverWindowsPatches();
  else if (process.platform === 'linux') found = await discoverLinuxPatches();
  else if (process.platform === 'darwin') found = await discoverMacPatches();
  if (found.length === 0) {
    lastPatchDiscover = Date.now();
    return;
  }
  await apiPost('/api/agent/patches/discovered', { agentId, patches: found });
  lastPatchDiscover = Date.now();
  log(`Patches descobertos: ${found.length}`);
}

async function sendMetrics() {
  const m = collectMetrics();
  await apiPost('/api/agent/metrics', {
    agentId,
    cpuPercent: m.cpuPercent,
    ramPercent: m.ramPercent,
    diskPercent: m.diskPercent,
    rebootPending: m.rebootPending,
    uptimeHours: m.uptimeHours,
  });
}

async function sendInterfaces() {
  const interfaces = collectInterfaces();
  const changes = detectChanges(lastInterfaces, interfaces);

  if (changes.length > 0) {
    log('Alterações de interface detectadas');
    for (const c of changes) {
      log(`  [${c.type}] ${c.interface}: ${c.detail}`);
    }
  }

  await apiPost('/api/agent/interfaces', {
    agentId,
    interfaces: formatForApi(interfaces),
  });

  lastInterfaces = interfaces;
}

async function sendSoftware() {
  const items = collectSoftware();
  if (items.length === 0) {
    log('Inventário de software: 0 itens (coleta vazia ou indisponível)');
    return;
  }

  await apiPost('/api/agent/software', { agentId, items });
  lastSoftwareSync = Date.now();
  log(`Software sincronizado: ${items.length} itens`);
}

async function flushOfflineQueue() {
  const sent = await flushQueue((method, path, body) =>
    request(method, path, body, { queueOnFail: false })
  );
  if (sent > 0) {
    log(`Fila offline: ${sent} item(ns) reenviado(s)`);
  }
}

async function main() {
  log(`NexaOps Agent v${AGENT_VERSION} | API: ${API_URL} | Host: ${os.hostname()}`);

  await register();
  connectSocket();
  await heartbeat();
  await sendMetrics();

  lastInterfaces = collectInterfaces();
  log(summarize(lastInterfaces));
  await sendInterfaces();
  await sendSoftware().catch(() => log('Inventário de software indisponível nesta plataforma'));
  await discoverPatches().catch((e) => logError(`Patch discover: ${e.message}`));

  if (queueSize() > 0) {
    await flushOfflineQueue();
  }

  setInterval(heartbeat, 30000);
  setInterval(sendMetrics, 60000);
  setInterval(sendInterfaces, 120000);
  setInterval(flushOfflineQueue, 60000);

  setInterval(async () => {
    if (Date.now() - lastSoftwareSync >= SOFTWARE_INTERVAL_MS) {
      try { await sendSoftware(); } catch (e) { logError(`Software sync: ${e.message}`); }
    }
  }, 60 * 60 * 1000);

  setInterval(async () => {
    if (Date.now() - lastHardwareSync >= HARDWARE_INTERVAL_MS) {
      try { await syncHardware(); } catch (e) { logError(`Hardware sync: ${e.message}`); }
    }
  }, 60 * 60 * 1000);

  setInterval(async () => {
    if (Date.now() - lastPatchDiscover >= PATCH_DISCOVER_MS) {
      try { await discoverPatches(); } catch (e) { logError(`Patch discover: ${e.message}`); }
    }
  }, 60 * 60 * 1000);

  log('Monitoramento ativo — Heartbeat 30s | Socket.io | Patches | Métricas 60s');
}

process.on('uncaughtException', (err) => logError(err.message));
process.on('unhandledRejection', (err) => logError(String(err)));

main().catch((e) => {
  logError(e.message);
  process.exit(1);
});
