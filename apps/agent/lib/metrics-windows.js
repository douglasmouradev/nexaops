/**
 * Coleta métricas reais no Windows via PowerShell/CIM.
 */
const { execSync } = require('child_process');
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
  const data = runPsJson(`
    Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" |
      Select-Object DeviceID,
        @{N='totalGb';E={[math]::Round($_.Size/1GB,1)}},
        @{N='freeGb';E={[math]::Round($_.FreeSpace/1GB,1)}},
        @{N='usedPercent';E={if($_.Size -gt 0){[math]::Round((($_.Size-$_.FreeSpace)/$_.Size)*100,1)}else{0}}} |
      ConvertTo-Json -Compress
  `);

  const disks = Array.isArray(data) ? data : data ? [data] : [];
  if (disks.length === 0) {
    return { diskPercent: 0, diskTotalGb: 0, diskFreeGb: 0, disks: [] };
  }

  const primary = disks.find((d) => d.DeviceID === 'C:') || disks[0];
  const totalGb = disks.reduce((s, d) => s + (d.totalGb || 0), 0);
  const freeGb = disks.reduce((s, d) => s + (d.freeGb || 0), 0);

  return {
    diskPercent: primary.usedPercent || 0,
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
