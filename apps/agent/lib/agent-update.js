/**
 * Auto-update do agent: MSI (Windows) ou tarball (Linux/macOS).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execFile, spawn } = require('child_process');
const { getConfigPath } = require('./config');

function downloadFile(url, dest, headers = {}) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try { fs.unlinkSync(dest); } catch { /* ignore */ }
        return downloadFile(res.headers.location, dest, headers).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        reject(new Error(`Download HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    });
    req.on('error', (err) => {
      try { fs.unlinkSync(dest); } catch { /* ignore */ }
      reject(err);
    });
  });
}

function extractTarball(archive, destDir) {
  return new Promise((resolve, reject) => {
    execFile('tar', ['-xzf', archive, '-C', destDir], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function applyUnixUpdate(update, { token, apiUrl, log, logError }) {
  const dataDir = path.dirname(getConfigPath());
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const archive = path.join(dataDir, 'nexaops-agent-update.tgz');
  const extractTo = path.join(dataDir, 'update-extract');
  log(`Atualizando agent para ${update.version} (${process.platform})...`);
  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    await downloadFile(update.downloadUrl, archive, headers);
    if (fs.existsSync(extractTo)) fs.rmSync(extractTo, { recursive: true, force: true });
    fs.mkdirSync(extractTo, { recursive: true });
    await extractTarball(archive, extractTo);

    const installDir =
      process.env.NEXAOPS_INSTALL_DIR ||
      (process.platform === 'darwin' ? '/usr/local/nexaops-agent' : '/opt/nexaops-agent');

    // Copia arquivos (precisa privilégio se installDir for system)
    const entries = fs.readdirSync(extractTo);
    const srcRoot = entries.length === 1 && fs.statSync(path.join(extractTo, entries[0])).isDirectory()
      ? path.join(extractTo, entries[0])
      : extractTo;

    if (!fs.existsSync(installDir)) fs.mkdirSync(installDir, { recursive: true });
    for (const name of fs.readdirSync(srcRoot)) {
      const from = path.join(srcRoot, name);
      const to = path.join(installDir, name);
      fs.cpSync(from, to, { recursive: true, force: true });
    }

    // Reinicia via systemd / launchctl se disponível; senão exit para supervisor restartar
    if (process.platform === 'linux') {
      spawn('systemctl', ['restart', 'nexaops-agent'], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      const plist = `${process.env.HOME}/Library/LaunchAgents/com.nexaops.agent.plist`;
      spawn('launchctl', ['unload', plist], { detached: true, stdio: 'ignore' }).unref();
      spawn('launchctl', ['load', plist], { detached: true, stdio: 'ignore' }).unref();
    }
    log('Update aplicado — reinício do serviço solicitado');
    setTimeout(() => process.exit(0), 2000);
    return true;
  } catch (e) {
    logError(`Update Unix falhou: ${e.message}`);
    return false;
  }
}

async function applyAgentUpdate(update, { token, apiUrl, log, logError }) {
  if (!update?.downloadUrl) return false;

  if (process.platform === 'win32') {
    const dataDir = path.dirname(getConfigPath());
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const msiPath = path.join(dataDir, 'NexaOpsAgent-update.msi');
    log(`Atualizando agent para ${update.version}...`);
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      await downloadFile(update.downloadUrl, msiPath, headers);
      const args = [
        '/i', msiPath,
        '/qn',
        `TOKEN=${token}`,
        `API_URL=${apiUrl}`,
      ];
      execFile('msiexec', args, { windowsHide: true }, (err) => {
        if (err) logError(`Falha msiexec update: ${err.message}`);
        else log('Update do agent agendado (msiexec)');
      });
      return true;
    } catch (e) {
      logError(`Update download falhou: ${e.message}`);
      return false;
    }
  }

  if (process.platform === 'linux' || process.platform === 'darwin') {
    return applyUnixUpdate(update, { token, apiUrl, log, logError });
  }

  return false;
}

module.exports = { applyAgentUpdate };
