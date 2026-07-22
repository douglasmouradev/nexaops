/**
 * Scanner de rede: varre subnet CIDR com ping ICMP + portas TCP comuns.
 */
import { createConnection } from 'net';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ScanHostResult {
  ipAddress: string;
  hostname: string | null;
  deviceType: 'PC' | 'SERVER' | 'NETWORK' | 'MOBILE';
  openPorts: number[];
}

function parseCidr(subnet: string): { base: number[]; prefix: number } | null {
  const m = subnet.trim().match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/);
  if (!m) return null;
  const base = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  const prefix = Number(m[5]);
  if (base.some((n) => n > 255) || prefix < 16 || prefix > 30) return null;
  return { base, prefix };
}

function hostsInCidr(subnet: string, maxHosts = 254): string[] {
  const parsed = parseCidr(subnet);
  if (!parsed) {
    // fallback: 192.168.1.0/24 style without slash → assume /24
    const m = subnet.trim().match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return [];
    const base = `${m[1]}.${m[2]}.${m[3]}`;
    return Array.from({ length: Math.min(254, maxHosts) }, (_, i) => `${base}.${i + 1}`);
  }

  const { base, prefix } = parsed;
  const hostBits = 32 - prefix;
  const count = Math.min((1 << hostBits) - 2, maxHosts);
  const ipNum =
    ((base[0] << 24) >>> 0) + ((base[1] << 16) >>> 0) + ((base[2] << 8) >>> 0) + (base[3] >>> 0);
  const network = ipNum & (~0 << hostBits);
  const ips: string[] = [];
  for (let i = 1; i <= count; i++) {
    const n = (network + i) >>> 0;
    ips.push([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
  }
  return ips;
}

function tcpProbe(ip: string, port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: ip, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}

async function icmpPing(ip: string): Promise<boolean> {
  const isWin = process.platform === 'win32';
  try {
    if (isWin) {
      await execFileAsync('ping', ['-n', '1', '-w', '500', ip], { timeout: 2000, windowsHide: true });
    } else {
      await execFileAsync('ping', ['-c', '1', '-W', '1', ip], { timeout: 2000 });
    }
    return true;
  } catch {
    return false;
  }
}

async function reverseLookup(ip: string): Promise<string | null> {
  try {
    const dns = await import('dns/promises');
    const names = await dns.reverse(ip);
    return names[0] || null;
  } catch {
    return null;
  }
}

function guessType(ports: number[], hostname: string | null): ScanHostResult['deviceType'] {
  const h = (hostname || '').toLowerCase();
  if (ports.includes(445) || ports.includes(3389) || ports.includes(5985)) return 'PC';
  if (ports.includes(22) || ports.includes(443) || ports.includes(8080)) return 'SERVER';
  if (h.includes('printer') || h.includes('switch') || h.includes('router') || ports.includes(161)) {
    return 'NETWORK';
  }
  if (ports.length > 0) return 'SERVER';
  return 'PC';
}

const COMMON_PORTS = [22, 80, 443, 445, 3389, 5985, 8080, 8443];

/**
 * Escaneia subnet. Limita concorrência para não saturar a rede.
 */
export async function scanSubnet(
  subnet: string,
  options: { maxHosts?: number; ports?: number[]; concurrency?: number } = {}
): Promise<ScanHostResult[]> {
  const maxHosts = options.maxHosts ?? 64;
  const ports = options.ports ?? COMMON_PORTS;
  const concurrency = options.concurrency ?? 32;
  const ips = hostsInCidr(subnet, maxHosts);
  const results: ScanHostResult[] = [];

  let idx = 0;
  async function worker() {
    while (idx < ips.length) {
      const i = idx++;
      const ip = ips[i];
      const alive = await icmpPing(ip);
      const openPorts: number[] = [];
      // Se ping falhar, ainda tenta portas (ICMP pode estar bloqueado)
      const portChecks = ports.map(async (p) => {
        if (await tcpProbe(ip, p)) openPorts.push(p);
      });
      await Promise.all(portChecks);
      if (!alive && openPorts.length === 0) continue;
      const hostname = await reverseLookup(ip);
      results.push({
        ipAddress: ip,
        hostname,
        deviceType: guessType(openPorts, hostname),
        openPorts: openPorts.sort((a, b) => a - b),
      });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, ips.length) }, () => worker()));
  return results.sort((a, b) => a.ipAddress.localeCompare(b.ipAddress, undefined, { numeric: true }));
}
