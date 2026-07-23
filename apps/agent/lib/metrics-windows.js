/**
 * Coleta métricas reais no Windows via PowerShell/CIM + fs.statfs para disco.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

const PS = 'powershell -NoProfile -ExecutionPolicy Bypass -Command';

function runPs(script, timeout = 15000) {
  try {
    const out = execSync(`${PS} "${script.replace(/"/g, '\\"')}"`, {
      encoding: 'utf8',
      timeout,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out.trim();
  } catch {
    return '';
  }
}

function runPsJson(script, timeout = 20000) {
  const out = runPs(script, timeout);
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/** Disco via Node (confiável sob SYSTEM; evita falha do CIM no serviço/tarefa). */
function getDiskStatsFromFs(roots = ['C:\\']) {
  const disks = [];
  for (const root of roots) {
    try {
      if (typeof fs.statfsSync !== 'function') break;
      const s = fs.statfsSync(root);
      const bsize = Number(s.bsize) || 0;
      const blocks = Number(s.blocks) || 0;
      const bavail = Number(s.bavail ?? s.bfree) || 0;
      const totalBytes = bsize * blocks;
      const freeBytes = bsize * bavail;
      if (totalBytes <= 0) continue;
      const totalGb = Math.round((totalBytes / 1024 / 1024 / 1024) * 10) / 10;
      const freeGb = Math.round((freeBytes / 1024 / 1024 / 1024) * 10) / 10;
      const usedPercent =
        totalGb > 0 ? Math.round(((totalGb - freeGb) / totalGb) * 1000) / 10 : 0;
      const id = root.replace(/\\+$/, '') || root;
      disks.push({
        DeviceID: id.endsWith(':') ? id : `${id}:`,
        totalGb,
        freeGb,
        usedPercent,
      });
    } catch {
      /* tenta próximo */
    }
  }
  if (disks.length === 0) {
    return { diskPercent: 0, diskTotalGb: 0, diskFreeGb: 0, disks: [] };
  }
  const primary = disks.find((d) => d.DeviceID === 'C:') || disks[0];
  return {
    diskPercent: primary.usedPercent || 0,
    diskTotalGb: disks.reduce((s, d) => s + (d.totalGb || 0), 0),
    diskFreeGb: disks.reduce((s, d) => s + (d.freeGb || 0), 0),
    disks,
  };
}

let lastCpuSample = null;

/**
 * CPU % via duas amostras de contador de performance.
 */
function getCpuPercent() {
  if (lastCpuSample !== null) {
    const current = lastCpuSample;
    lastCpuSample = null;
    return current;
  }

  const data = runPsJson(`
    $c1 = (Get-Counter '\\Processor(_Total)\\% Processor Time' -ErrorAction SilentlyContinue).CounterSamples.CookedValue
    Start-Sleep -Milliseconds 500
    $c2 = (Get-Counter '\\Processor(_Total)\\% Processor Time' -ErrorAction SilentlyContinue).CounterSamples.CookedValue
    @{ cpu = [math]::Round(($c1 + $c2) / 2, 1) } | ConvertTo-Json -Compress
  `, 10000);

  if (data?.cpu != null) return Math.min(100, Math.max(0, data.cpu));

  const fallback = runPsJson(
    'Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average | ForEach-Object { @{ cpu = [math]::Round($_.Average, 1) } | ConvertTo-Json -Compress }'
  );
  if (fallback?.cpu != null) return Math.min(100, Math.max(0, fallback.cpu));

  return 0;
}

function getDiskStats() {
  // 1) Preferir fs.statfs (Node 18.15+ / 20) — funciona como SYSTEM
  const fromFs = getDiskStatsFromFs(['C:\\']);
  if (fromFs.diskTotalGb > 0) return fromFs;

  // 2) Fallback CIM (pode falhar sob SYSTEM / quoting)
  const data = runPsJson(
    "Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\" | ForEach-Object { [PSCustomObject]@{ DeviceID=$_.DeviceID; totalGb=[math]::Round($_.Size/1GB,1); freeGb=[math]::Round($_.FreeSpace/1GB,1); usedPercent=if($_.Size -gt 0){[math]::Round((($_.Size-$_.FreeSpace)/$_.Size)*100,1)}else{0} } } | ConvertTo-Json -Compress"
  );

  const disks = Array.isArray(data) ? data : data ? [data] : [];
  if (disks.length === 0) {
    return { diskPercent: 0, diskTotalGb: 0, diskFreeGb: 0, disks: [] };
  }

  const primary = disks.find((d) => d.DeviceID === 'C:') || disks[0];
  const totalGb = disks.reduce((s, d) => s + (Number(d.totalGb) || 0), 0);
  const freeGb = disks.reduce((s, d) => s + (Number(d.freeGb) || 0), 0);

  return {
    diskPercent: Number(primary.usedPercent) || 0,
    diskTotalGb: totalGb,
    diskFreeGb: freeGb,
    disks,
  };
}

function getHardwareInfo() {
  const sys = runPsJson(
    'Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer, Model | ConvertTo-Json -Compress'
  );
  const bios = runPsJson(
    'Get-CimInstance Win32_BIOS | Select-Object SerialNumber | ConvertTo-Json -Compress'
  );
  const cpu = runPsJson(
    'Get-CimInstance Win32_Processor | Select-Object -First 1 Name, NumberOfCores | ConvertTo-Json -Compress'
  );

  const disk = getDiskStats();
  const totalMem = os.totalmem();

  return {
    cpuModel: cpu?.Name || os.cpus()[0]?.model || 'Unknown',
    cpuCores: cpu?.NumberOfCores || os.cpus().length,
    ramTotalGb: Math.round((totalMem / 1024 / 1024 / 1024) * 10) / 10,
    diskTotalGb: disk.diskTotalGb,
    diskFreeGb: disk.diskFreeGb,
    manufacturer: sys?.Manufacturer || 'Unknown',
    model: sys?.Model || os.hostname(),
    serialNumber: bios?.SerialNumber || null,
  };
}

function getRamPercent() {
  const total = os.totalmem();
  const free = os.freemem();
  return Math.round(((total - free) / total) * 1000) / 10;
}

function isRebootPending() {
  const out = runPs(`
    if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired') { 'true' }
    elseif (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager' -Name PendingFileRenameOperations -ErrorAction SilentlyContinue) { 'true' }
    else { 'false' }
  `);
  return out.trim().toLowerCase() === 'true';
}

function getUptimeHours() {
  const data = runPsJson(`
    $os = Get-CimInstance Win32_OperatingSystem
    @{ hours = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1) } | ConvertTo-Json -Compress
  `);
  return data?.hours ?? 0;
}

function collectMetrics() {
  const disk = getDiskStats();
  return {
    cpuPercent: getCpuPercent(),
    ramPercent: getRamPercent(),
    diskPercent: disk.diskPercent,
    hardware: getHardwareInfo(),
    rebootPending: isRebootPending(),
    uptimeHours: getUptimeHours(),
  };
}

module.exports = {
  collectMetrics,
  getHardwareInfo,
  getDiskStats,
  isRebootPending,
};
