/**
 * Executa scripts remotos de forma real (PowerShell, CMD, Bash).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_OUTPUT = 64000;
const DEFAULT_TIMEOUT_MS = 300000;

const BLOCKED_PATTERNS = [
  /\bformat\s+[a-z]:/i,
  /\bdiskpart\b/i,
  /\bRemove-Computer\b/i,
  /\bStop-Computer\b\s+-Force/i,
  /\bshutdown\s+\/[sfr]/i,
  /\brm\s+-rf\s+[\/~]/,
  /\bdel\s+\/f\s+\/s\s+\/q\s+c:\\/i,
  /\bInvoke-WebRequest\b.*\|\s*iex/i,
  /\bcurl\b.*\|\s*(ba)?sh/i,
  /\breg\s+delete\b/i,
  /\bnet\s+user\b.*\/add/i,
  /\bAdd-LocalGroupMember\b/i,
  /\bcipher\s+\/w/i,
];

function isBlocked(content) {
  return BLOCKED_PATTERNS.some((p) => p.test(content));
}

function truncateOutput(text) {
  if (!text) return '';
  if (text.length <= MAX_OUTPUT) return text;
  return text.slice(0, MAX_OUTPUT) + '\n...[truncado]';
}

function runCommand(command, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      const output = truncateOutput(
        [stdout, stderr ? `\n--- stderr ---\n${stderr}` : ''].filter(Boolean).join('')
      );
      resolve({
        status: killed ? 'TIMEOUT' : code === 0 ? 'SUCCESS' : 'FAILED',
        output: output || (code === 0 ? 'Concluído sem saída.' : `Exit code: ${code}`),
        exitCode: killed ? -1 : code ?? -1,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ status: 'FAILED', output: err.message, exitCode: -1 });
    });
  });
}

async function executeScript(script) {
  const { content, language, name } = script;
  const lang = (language || 'POWERSHELL').toUpperCase();
  const timeout = script.timeoutMs || DEFAULT_TIMEOUT_MS;

  if (!content?.trim()) {
    return { status: 'FAILED', output: 'Script vazio.', exitCode: -1 };
  }

  if (isBlocked(content)) {
    return {
      status: 'FAILED',
      output: `Script "${name}" bloqueado por política de segurança.`,
      exitCode: -1,
    };
  }

  if (lang === 'POWERSHELL' || lang === 'PS1') {
    if (process.platform === 'win32') {
      return runCommand('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-Command', content,
      ], timeout);
    }
    return runCommand('pwsh', ['-NoProfile', '-Command', content], timeout);
  }

  if (lang === 'CMD' || lang === 'BATCH' || lang === 'BAT') {
    if (process.platform !== 'win32') {
      return { status: 'FAILED', output: 'CMD suportado apenas no Windows.', exitCode: -1 };
    }
    const tmpFile = path.join(os.tmpdir(), `nexaops-${Date.now()}.bat`);
    fs.writeFileSync(tmpFile, content, 'utf8');
    try {
      const result = await runCommand('cmd.exe', ['/c', tmpFile], timeout);
      return result;
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  if (lang === 'BASH' || lang === 'SHELL') {
    if (process.platform === 'win32') {
      return runCommand('bash', ['-c', content], timeout);
    }
    return runCommand('/bin/bash', ['-c', content], timeout);
  }

  return {
    status: 'FAILED',
    output: `Linguagem não suportada: ${language}`,
    exitCode: -1,
  };
}

module.exports = { executeScript, isBlocked };
