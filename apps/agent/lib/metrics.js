/**
 * Coleta de métricas cross-platform (Windows real, fallback genérico).
 */
const os = require('os');

let metricsWindows = null;
if (process.platform === 'win32') {
  try {
    metricsWindows = require('./metrics-windows');
  } catch {
    metricsWindows = null;
  }
}

function fallbackMetrics() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    cpuPercent: 0,
    ramPercent: Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10,
    diskPercent: 0,
    hardware: {
      cpuModel: os.cpus()[0]?.model,
      cpuCores: os.cpus().length,
      ramTotalGb: Math.round(totalMem / 1024 / 1024 / 1024),
      diskTotalGb: 0,
      diskFreeGb: 0,
      manufacturer: 'Generic',
      model: os.hostname(),
      serialNumber: null,
    },
    rebootPending: false,
    uptimeHours: os.uptime() / 3600,
  };
}

function collectMetrics() {
  if (metricsWindows) {
    try {
      return metricsWindows.collectMetrics();
    } catch {
      return fallbackMetrics();
    }
  }
  return fallbackMetrics();
}

function getHardwareInfo() {
  if (metricsWindows) {
    try {
      return metricsWindows.getHardwareInfo();
    } catch {
      /* fallback */
    }
  }
  return fallbackMetrics().hardware;
}

module.exports = { collectMetrics, getHardwareInfo };
