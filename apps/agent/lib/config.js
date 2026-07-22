/**
 * Carrega configuração do agente (CLI, variáveis de ambiente ou arquivo).
 */
const fs = require('fs');
const path = require('path');

const MAX_LOG_BYTES = 10 * 1024 * 1024;

function getConfigPath() {
  if (process.platform === 'win32') {
    return path.join(process.env.ProgramData || 'C:\\ProgramData', 'NexaOps Agent', 'config.json');
  }
  if (process.platform === 'darwin') {
    return '/Library/Application Support/NexaOps Agent/config.json';
  }
  return '/etc/nexaops-agent/config.json';
}

function loadConfig() {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

function saveConfig(partial) {
  try {
    const configPath = getConfigPath();
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const current = loadConfig();
    const next = { ...current, ...partial };
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf8');
    return next;
  } catch {
    return null;
  }
}

function getLogPath() {
  if (process.platform === 'win32') {
    return path.join(process.env.ProgramData || 'C:\\ProgramData', 'NexaOps Agent', 'agent.log');
  }
  return path.join('/var/log', 'nexaops-agent.log');
}

function ensureLogDir() {
  const dir = path.dirname(getLogPath());
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function rotateLogIfNeeded() {
  try {
    const logPath = getLogPath();
    if (!fs.existsSync(logPath)) return;
    const stats = fs.statSync(logPath);
    if (stats.size < MAX_LOG_BYTES) return;
    const rotated = `${logPath}.1`;
    if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
    fs.renameSync(logPath, rotated);
  } catch {
    /* ignore */
  }
}

function writeLog(message) {
  try {
    ensureLogDir();
    rotateLogIfNeeded();
    const line = `[${new Date().toISOString()}] ${message}\n`;
    fs.appendFileSync(getLogPath(), line);
  } catch {
    /* ignore */
  }
}

module.exports = { loadConfig, saveConfig, getConfigPath, getLogPath, writeLog };
