/**
 * Scan de subnet no endpoint (ICMP ping). Usado quando a API pede mode=agent.
 */
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

function hostsFromSubnet(subnet, maxHosts = 64) {
  const m = String(subnet || '').trim().match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)(?:\/(\d+))?$/);
  if (!m) return [];
  const base = `${m[1]}.${m[2]}.${m[3]}`;
  const prefix = m[5] ? Number(m[5]) : 24;
  const count = Math.min(prefix >= 24 ? 254 : 64, maxHosts);
  return Array.from({ length: count }, (_, i) => `${base}.${i + 1}`);
}

async function pingHost(ip) {
  const isWin = process.platform === 'win32';
  try {
    if (isWin) {
      await execFileAsync('ping', ['-n', '1', '-w', '400', ip], { timeout: 2000, windowsHide: true });
    } else {
      await execFileAsync('ping', ['-c', '1', '-W', '1', ip], { timeout: 2000 });
    }
    return true;
  } catch {
    return false;
  }
}

async function scanSubnet(subnet, { maxHosts = 64 } = {}) {
  const hosts = hostsFromSubnet(subnet, maxHosts);
  const found = [];
  // paralelo limitado
  const concurrency = 16;
  for (let i = 0; i < hosts.length; i += concurrency) {
    const chunk = hosts.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map(async (ip) => {
        const up = await pingHost(ip);
        return up ? { ipAddress: ip, hostname: null, deviceType: 'PC' } : null;
      })
    );
    found.push(...results.filter(Boolean));
  }
  return found;
}

module.exports = { scanSubnet };
