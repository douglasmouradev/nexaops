/**
 * NexaOps — Monitor de interfaces de rede do equipamento
 *
 * Coleta adaptadores de rede (nome, MAC, IPv4/IPv6, máscara, status)
 * de forma cross-platform via Node.js os.networkInterfaces().
 *
 * Uso:
 *   const { collectInterfaces, detectChanges } = require('./lib/interface-monitor');
 *   const interfaces = collectInterfaces();
 */

const os = require('os');
const { execSync } = require('child_process');

/** @typedef {{ name: string; mac: string|null; ipv4: string|null; ipv6: string|null; netmask: string|null; cidr: string|null; internal: boolean; isUp: boolean; speedMbps: number|null; dhcp: boolean|null; gateway: string|null; dns: string[] }} NetworkInterfaceInfo */

/**
 * Converte máscara de sub-rede em notação CIDR.
 * @param {string} netmask
 * @returns {string|null}
 */
function netmaskToCidr(netmask) {
  if (!netmask) return null;
  const parts = netmask.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return null;
  const bits = parts.reduce((acc, octet) => acc + octet.toString(2).padStart(8, '0').replace(/0/g, '').length, 0);
  return bits > 0 ? String(bits) : null;
}

/**
 * Obtém velocidade do adaptador no Windows via PowerShell.
 * @param {string} name
 * @returns {number|null}
 */
function getWindowsAdapterSpeed(name) {
  if (process.platform !== 'win32') return null;
  try {
    const safeName = name.replace(/'/g, "''");
    const out = execSync(
      `powershell -NoProfile -Command "(Get-NetAdapter -Name '${safeName}' -ErrorAction SilentlyContinue).LinkSpeed"`,
      { encoding: 'utf8', timeout: 5000, windowsHide: true }
    ).trim();
    const match = out.match(/(\d+)/);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    return out.toLowerCase().includes('gbps') ? value * 1000 : value;
  } catch {
    return null;
  }
}

/**
 * Obtém gateway padrão do sistema.
 * @returns {string|null}
 */
function getDefaultGateway() {
  try {
    if (process.platform === 'win32') {
      const out = execSync('powershell -NoProfile -Command "(Get-NetRoute -DestinationPrefix 0.0.0.0/0 | Select-Object -First 1).NextHop"', {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      }).trim();
      return out && out !== '' ? out : null;
    }
    if (process.platform === 'linux' || process.platform === 'darwin') {
      const out = execSync("ip route | awk '/default/ {print $3; exit}'", {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
      return out || null;
    }
  } catch {
    /* fallback silencioso */
  }
  return null;
}

/**
 * Coleta todas as interfaces de rede ativas do equipamento.
 * @returns {NetworkInterfaceInfo[]}
 */
function collectInterfaces() {
  const raw = os.networkInterfaces();
  const gateway = getDefaultGateway();
  /** @type {NetworkInterfaceInfo[]} */
  const result = [];

  for (const [name, addrs] of Object.entries(raw)) {
    if (!addrs || addrs.length === 0) continue;

    const ipv4Entry = addrs.find((a) => a.family === 'IPv4' && !a.internal);
    const ipv6Entry = addrs.find((a) => a.family === 'IPv6' && !a.internal);
    const anyEntry = addrs[0];
    const mac = anyEntry.mac && anyEntry.mac !== '00:00:00:00:00:00' ? anyEntry.mac : null;
    const internal = addrs.every((a) => a.internal);
    const isUp = addrs.some((a) => !a.internal || a.address);

    result.push({
      name,
      mac,
      ipv4: ipv4Entry?.address ?? null,
      ipv6: ipv6Entry?.address ?? null,
      netmask: ipv4Entry?.netmask ?? null,
      cidr: ipv4Entry?.cidr ?? (ipv4Entry?.netmask ? netmaskToCidr(ipv4Entry.netmask) : null),
      internal,
      isUp,
      speedMbps: getWindowsAdapterSpeed(name),
      dhcp: null,
      gateway: !internal && ipv4Entry ? gateway : null,
      dns: [],
    });
  }

  return result.sort((a, b) => {
    if (a.internal !== b.internal) return a.internal ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Detecta alterações entre duas coletas (IP, MAC, status).
 * @param {NetworkInterfaceInfo[]} previous
 * @param {NetworkInterfaceInfo[]} current
 * @returns {{ type: string; interface: string; detail: string }[]}
 */
function detectChanges(previous, current) {
  const changes = [];
  const prevMap = new Map(previous.map((i) => [i.name, i]));
  const currMap = new Map(current.map((i) => [i.name, i]));

  for (const [name, curr] of currMap) {
    const prev = prevMap.get(name);
    if (!prev) {
      changes.push({ type: 'ADDED', interface: name, detail: `Nova interface: ${curr.ipv4 || curr.ipv6 || 'sem IP'}` });
      continue;
    }
    if (prev.ipv4 !== curr.ipv4) {
      changes.push({ type: 'IP_CHANGED', interface: name, detail: `${prev.ipv4 || '—'} → ${curr.ipv4 || '—'}` });
    }
    if (prev.mac !== curr.mac) {
      changes.push({ type: 'MAC_CHANGED', interface: name, detail: `${prev.mac || '—'} → ${curr.mac || '—'}` });
    }
    if (prev.isUp !== curr.isUp) {
      changes.push({ type: 'STATUS_CHANGED', interface: name, detail: curr.isUp ? 'Interface ativa' : 'Interface inativa' });
    }
  }

  for (const [name] of prevMap) {
    if (!currMap.has(name)) {
      changes.push({ type: 'REMOVED', interface: name, detail: 'Interface removida' });
    }
  }

  return changes;
}

/**
 * Formata payload para envio à API NexaOps.
 * @param {NetworkInterfaceInfo[]} interfaces
 * @returns {object[]}
 */
function formatForApi(interfaces) {
  return interfaces.map((iface) => ({
    name: iface.name,
    mac: iface.mac,
    ipv4: iface.ipv4,
    ipv6: iface.ipv6,
    netmask: iface.netmask,
    cidr: iface.cidr,
    internal: iface.internal,
    isUp: iface.isUp,
    speedMbps: iface.speedMbps,
    dhcp: iface.dhcp,
    gateway: iface.gateway,
    dns: iface.dns.length ? iface.dns.join(',') : null,
  }));
}

/**
 * Retorna resumo legível para log local.
 * @param {NetworkInterfaceInfo[]} interfaces
 * @returns {string}
 */
function summarize(interfaces) {
  const active = interfaces.filter((i) => !i.internal && i.isUp);
  const lines = active.map((i) => {
    const ip = i.ipv4 || i.ipv6 || 'sem IP';
    const speed = i.speedMbps ? ` @ ${i.speedMbps} Mbps` : '';
    return `  ${i.name}: ${ip} (${i.mac || 'sem MAC'})${speed}`;
  });
  return `Interfaces ativas (${active.length}):\n${lines.join('\n') || '  nenhuma'}`;
}

module.exports = {
  collectInterfaces,
  detectChanges,
  formatForApi,
  summarize,
};
