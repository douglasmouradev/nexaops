/**
 * Captura de tela periódica para viewer remoto via Socket.io (fallback sem WebRTC nativo).
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let timer = null;
let currentSessionId = null;

function captureWindows(cb) {
  const out = path.join(os.tmpdir(), `nexaops-frame-${process.pid}.jpg`);
  const ps = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$b = New-Object System.Drawing.Bitmap $s.Width, $s.Height
$g = [System.Drawing.Graphics]::FromImage($b)
$g.CopyFromScreen($s.Location, [System.Drawing.Point]::Empty, $s.Size)
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, 40L)
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
  if (process.platform === 'win32') captureWindows(cb);
  else if (process.platform === 'linux') captureLinux(cb);
  else if (process.platform === 'darwin') captureMac(cb);
  else cb(null);
}

function startScreenShare(sessionId, emitFrame) {
  stopScreenShare();
  currentSessionId = sessionId;
  const tick = () => {
    if (!currentSessionId) return;
    captureFrame((b64) => {
      if (b64 && currentSessionId) {
        emitFrame({ sessionId: currentSessionId, mime: 'image/jpeg', data: b64 });
      }
    });
  };
  tick();
  timer = setInterval(tick, 1500);
}

function stopScreenShare() {
  if (timer) clearInterval(timer);
  timer = null;
  currentSessionId = null;
}

module.exports = { startScreenShare, stopScreenShare };
