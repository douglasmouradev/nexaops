/**
 * Sobe remote-helper.js na sessao interativa do usuario (fora do Session 0)
 * e faz proxy HTTP localhost para o agent SYSTEM.
 */
'use strict';

const http = require('http');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const HELPER_PORT = Number(process.env.NEXAOPS_HELPER_PORT || 17890);
const TASK_NAME = 'NexaOpsRemoteHelper';

let proxyTimer = null;
let activeSessionId = null;
let usingHelper = false;
let localFallback = false;

function installFolder() {
  return path.resolve(__dirname, '..');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpJson(method, urlPath, body, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port: HELPER_PORT,
        path: urlPath,
        method,
        timeout: timeoutMs,
        headers: data
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
          : undefined,
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          if (res.statusCode === 204) {
            resolve(null);
            return;
          }
          try {
            resolve(buf ? JSON.parse(buf) : null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    if (data) req.write(data);
    req.end();
  });
}

function getSessionIdOfSelf() {
  if (process.platform !== 'win32') return -1;
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        '[System.Diagnostics.Process]::GetCurrentProcess().SessionId',
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 }
    );
    return Number(String(out).trim());
  } catch {
    return -1;
  }
}

/** true se o agent esta no Session 0 (SYSTEM) — captura nao ve o desktop do usuario */
function isSessionZero() {
  if (process.platform !== 'win32') return false;
  const sid = getSessionIdOfSelf();
  return sid === 0;
}

function getConsoleUsername() {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('query', ['user'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    const lines = out.split(/\r?\n/);
    for (const line of lines) {
      const active = />/.test(line) || /\bActive\b/i.test(line);
      if (!active) continue;
      const cleaned = line.replace(/^>/, ' ').trim();
      const parts = cleaned.split(/\s+/);
      if (parts[0] && !/^USERNAME$/i.test(parts[0])) {
        return parts[0];
      }
    }
  } catch (_) {}
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        '$u = (Get-CimInstance Win32_ComputerSystem).UserName; if ($u) { ($u -split "\\\\")[-1] }',
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 8000 }
    );
    const u = String(out).trim();
    return u || null;
  } catch {
    return null;
  }
}

function deleteHelperTask() {
  try {
    execFileSync('schtasks.exe', ['/Delete', '/TN', TASK_NAME, '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch (_) {}
}

async function stopHelperHttp() {
  try {
    await httpJson('POST', '/stop', {}, 2000);
  } catch (_) {}
}

/**
 * Agenda e executa o helper na sessao do usuario logado.
 */
function launchHelperTask() {
  const root = installFolder();
  const nodeExe = path.join(root, 'node.exe');
  const helperJs = path.join(root, 'windows', 'remote-helper.js');
  const user = getConsoleUsername();

  deleteHelperTask();

  // TR com aspas para paths com espaco (Program Files)
  const tr = `"${nodeExe}" "${helperJs}" --port=${HELPER_PORT}`;
  const args = [
    '/Create',
    '/TN',
    TASK_NAME,
    '/TR',
    tr,
    '/SC',
    'ONCE',
    '/ST',
    '23:59',
    '/RL',
    'HIGHEST',
    '/F',
    '/IT',
  ];
  if (user) {
    args.push('/RU', user, '/NP');
  }

  execFileSync('schtasks.exe', args, { windowsHide: true, timeout: 15000 });
  execFileSync('schtasks.exe', ['/Run', '/TN', TASK_NAME], {
    windowsHide: true,
    timeout: 15000,
  });
}

async function waitHelperReady(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const h = await httpJson('GET', '/health', null, 1500);
      if (h && h.ok) return true;
    } catch (_) {}
    await sleep(400);
  }
  return false;
}

/**
 * Inicia sessao remota: helper interativo se Session 0, senao captura local.
 * @returns {{ mode: 'helper'|'local', sessionId: string }}
 */
async function startRemoteDesktop(sessionId, emitFrame, { startScreenShare, log, logError }) {
  await stopRemoteDesktop({ stopScreenShare: () => undefined });
  activeSessionId = sessionId;
  usingHelper = false;
  localFallback = false;

  if (process.platform === 'win32' && isSessionZero()) {
    try {
      log('Session 0 detectado — iniciando remote-helper na sessao do usuario...');
      launchHelperTask();
      const ready = await waitHelperReady();
      if (ready) {
        usingHelper = true;
        log('remote-helper OK — proxy de frames');
        proxyTimer = setInterval(async () => {
          if (!activeSessionId || !usingHelper) return;
          try {
            const frame = await httpJson('GET', '/frame', null, 2000);
            if (frame && frame.data) {
              emitFrame({
                sessionId: activeSessionId,
                mime: frame.mime || 'image/jpeg',
                data: frame.data,
              });
            }
          } catch (_) {}
        }, 200);
        return { mode: 'helper', sessionId };
      }
      logError('remote-helper nao respondeu — fallback captura local (pode ser tela preta)');
    } catch (e) {
      logError(`Falha ao iniciar helper: ${e.message}`);
    }
  }

  localFallback = true;
  startScreenShare(sessionId, emitFrame);
  return { mode: 'local', sessionId };
}

async function sendRemoteInput(ev) {
  if (usingHelper) {
    try {
      await httpJson('POST', '/input', { event: ev }, 2000);
      return true;
    } catch {
      return false;
    }
  }
  return null; // caller usa applyRemoteInput local
}

async function stopRemoteDesktop({ stopScreenShare }) {
  if (proxyTimer) {
    clearInterval(proxyTimer);
    proxyTimer = null;
  }
  activeSessionId = null;
  if (usingHelper) {
    await stopHelperHttp();
    deleteHelperTask();
    usingHelper = false;
  }
  if (localFallback && typeof stopScreenShare === 'function') {
    stopScreenShare();
    localFallback = false;
  }
}

module.exports = {
  startRemoteDesktop,
  stopRemoteDesktop,
  sendRemoteInput,
  isSessionZero,
  HELPER_PORT,
};
