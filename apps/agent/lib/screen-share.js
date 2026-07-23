/**
 * Captura de tela: loop PowerShell persistente (melhor FPS) + API para o helper.
 */
'use strict';

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let timer = null;
let currentSessionId = null;
let captureProc = null;
let latestB64 = null;
let emitFn = null;

const INTERVAL_MS = Number(process.env.NEXAOPS_REMOTE_INTERVAL_MS || 180);
const JPEG_QUALITY = Number(process.env.NEXAOPS_REMOTE_JPEG_QUALITY || 55);
const MAX_WIDTH = Number(process.env.NEXAOPS_REMOTE_MAX_WIDTH || 1280);

function buildCaptureLoopScript() {
  // ASCII-only: PS 5.1 sem BOM
  return `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$quality = ${JPEG_QUALITY}
$maxW = ${MAX_WIDTH}
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, [long]$quality)
while ($true) {
  try {
    $s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $scale = 1.0
    if ($s.Width -gt $maxW) { $scale = $maxW / [double]$s.Width }
    $w = [Math]::Max(1, [int]($s.Width * $scale))
    $h = [Math]::Max(1, [int]($s.Height * $scale))
    $full = New-Object System.Drawing.Bitmap $s.Width, $s.Height
    $gf = [System.Drawing.Graphics]::FromImage($full)
    $gf.CopyFromScreen($s.Location, [System.Drawing.Point]::Empty, $s.Size)
    $gf.Dispose()
    if ($scale -lt 1.0) {
      $b = New-Object System.Drawing.Bitmap $w, $h
      $g = [System.Drawing.Graphics]::FromImage($b)
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::Bilinear
      $g.DrawImage($full, 0, 0, $w, $h)
      $g.Dispose()
      $full.Dispose()
    } else {
      $b = $full
    }
    $ms = New-Object System.IO.MemoryStream
    $b.Save($ms, $codec, $ep)
    $b.Dispose()
    $bytes = $ms.ToArray()
    $ms.Dispose()
    [Console]::Out.WriteLine([Convert]::ToBase64String($bytes))
    [Console]::Out.Flush()
  } catch {}
  Start-Sleep -Milliseconds ${INTERVAL_MS}
}
`;
}

function stopCaptureProcess() {
  if (captureProc) {
    try {
      captureProc.kill();
    } catch (_) {}
    captureProc = null;
  }
  latestB64 = null;
}

function startCaptureProcess() {
  if (process.platform !== 'win32') return false;
  stopCaptureProcess();
  const script = buildCaptureLoopScript();
  captureProc = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
  );
  let buf = '';
  captureProc.stdout.setEncoding('utf8');
  captureProc.stdout.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line.length > 100) {
        latestB64 = line;
        if (emitFn && currentSessionId) {
          emitFn({ sessionId: currentSessionId, mime: 'image/jpeg', data: latestB64 });
        }
      }
    }
  });
  captureProc.on('exit', () => {
    captureProc = null;
  });
  return true;
}

function getLatestFrameB64() {
  return latestB64;
}

function captureOnceWindows(cb) {
  const out = path.join(os.tmpdir(), `nexaops-frame-${process.pid}.jpg`);
  const ps = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$b = New-Object System.Drawing.Bitmap $s.Width, $s.Height
$g = [System.Drawing.Graphics]::FromImage($b)
$g.CopyFromScreen($s.Location, [System.Drawing.Point]::Empty, $s.Size)
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, 50L)
$b.Save('${out.replace(/\\/g, '\\\\')}', $codec, $ep)
$g.Dispose(); $b.Dispose()
`;
  execFile(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { windowsHide: true, timeout: 8000 },
    (err) => {
      if (err || !fs.existsSync(out)) {
        cb(null);
        return;
      }
      try {
        const buf = fs.readFileSync(out);
        fs.unlinkSync(out);
        cb(buf.toString('base64'));
      } catch {
        cb(null);
      }
    }
  );
}

function captureLinux(cb) {
  const out = path.join(os.tmpdir(), `nexaops-frame-${process.pid}.jpg`);
  execFile('import', ['-window', 'root', '-quality', '40', out], { timeout: 5000 }, (err) => {
    if (err) {
      execFile('scrot', ['-o', out], { timeout: 5000 }, (err2) => {
        if (err2 || !fs.existsSync(out)) {
          cb(null);
          return;
        }
        try {
          const buf = fs.readFileSync(out);
          fs.unlinkSync(out);
          cb(buf.toString('base64'));
        } catch {
          cb(null);
        }
      });
      return;
    }
    try {
      const buf = fs.readFileSync(out);
      fs.unlinkSync(out);
      cb(buf.toString('base64'));
    } catch {
      cb(null);
    }
  });
}

function captureMac(cb) {
  const out = path.join(os.tmpdir(), `nexaops-frame-${process.pid}.jpg`);
  execFile('screencapture', ['-x', '-t', 'jpg', out], { timeout: 5000 }, (err) => {
    if (err || !fs.existsSync(out)) {
      cb(null);
      return;
    }
    try {
      const buf = fs.readFileSync(out);
      fs.unlinkSync(out);
      cb(buf.toString('base64'));
    } catch {
      cb(null);
    }
  });
}

function captureFrame(cb) {
  if (latestB64) {
    cb(latestB64);
    return;
  }
  if (process.platform === 'win32') captureOnceWindows(cb);
  else if (process.platform === 'linux') captureLinux(cb);
  else if (process.platform === 'darwin') captureMac(cb);
  else cb(null);
}

/**
 * Inicia captura local (sessao interativa ou fallback Session 0).
 */
function startScreenShare(sessionId, emitFrame) {
  stopScreenShare();
  currentSessionId = sessionId;
  emitFn = emitFrame;

  if (process.platform === 'win32' && startCaptureProcess()) {
    return;
  }

  const tick = () => {
    if (!currentSessionId) return;
    captureFrame((b64) => {
      if (b64 && currentSessionId && emitFn) {
        emitFn({ sessionId: currentSessionId, mime: 'image/jpeg', data: b64 });
      }
    });
  };
  tick();
  timer = setInterval(tick, 400);
}

function stopScreenShare() {
  if (timer) clearInterval(timer);
  timer = null;
  currentSessionId = null;
  emitFn = null;
  stopCaptureProcess();
}

module.exports = {
  startScreenShare,
  stopScreenShare,
  startCaptureProcess,
  stopCaptureProcess,
  getLatestFrameB64,
  captureFrame,
};
