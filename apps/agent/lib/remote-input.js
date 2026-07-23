/**
 * Input remoto (mouse/teclado) — PowerShell persistente no Windows.
 */
'use strict';

const { spawn, execFile } = require('child_process');

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function run(cmd, args, timeout = 3000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err) => resolve(!err));
  });
}

let winInputProc = null;
let winInputReady = false;

function ensureWinInputHost() {
  if (winInputProc && !winInputProc.killed) return;
  winInputReady = false;
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class NexaMouse {
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int dx, int dy, int d, int e);
}
"@
function Invoke-NexaEvent([string]$line) {
  try {
    $ev = $line | ConvertFrom-Json
    $type = [string]$ev.type
    $x = [double]($ev.x); if (-not $ev.x) { $x = 0.5 }
    $y = [double]($ev.y); if (-not $ev.y) { $y = 0.5 }
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $px = [int]($b.X + $b.Width * $x)
    $py = [int]($b.Y + $b.Height * $y)
    if ($type -eq 'mousemove' -or $type -eq 'click' -or $type -eq 'mousedown' -or $type -eq 'mouseup') {
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point $px, $py
    }
    if ($type -eq 'click') {
      $btn = [int]$ev.button
      $down = 0x0002; $up = 0x0004
      if ($btn -eq 2) { $down = 0x0008; $up = 0x0010 }
      [NexaMouse]::mouse_event($down, 0, 0, 0, 0)
      [NexaMouse]::mouse_event($up, 0, 0, 0, 0)
    } elseif ($type -eq 'mousedown') {
      [NexaMouse]::mouse_event(0x0002, 0, 0, 0, 0)
    } elseif ($type -eq 'mouseup') {
      [NexaMouse]::mouse_event(0x0004, 0, 0, 0, 0)
    } elseif ($type -eq 'wheel') {
      $amount = [int]$ev.deltaY
      if ($amount -gt 1200) { $amount = 1200 }
      if ($amount -lt -1200) { $amount = -1200 }
      [NexaMouse]::mouse_event(0x0800, 0, 0, (-1 * $amount), 0)
    } elseif ($type -eq 'keydown' -or $type -eq 'keypress') {
      $key = [string]$ev.key
      if (-not $key) { $key = [string]$ev.text }
      $map = @{
        Enter = '{ENTER}'; Backspace = '{BACKSPACE}'; Tab = '{TAB}'; Escape = '{ESC}'
        Delete = '{DELETE}'; ArrowUp = '{UP}'; ArrowDown = '{DOWN}'; ArrowLeft = '{LEFT}'; ArrowRight = '{RIGHT}'
      }
      if ($map.ContainsKey($key)) { [System.Windows.Forms.SendKeys]::SendWait($map[$key]) }
      elseif ($key.Length -eq 1) {
        $ch = $key
        if ($ch -match '[{}+^%~()]') { $ch = '{' + $ch + '}' }
        [System.Windows.Forms.SendKeys]::SendWait($ch)
      }
    }
  } catch {}
}
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line -eq 'EXIT') { break }
  if ($line.Length -gt 0) { Invoke-NexaEvent $line }
}
`;
  winInputProc = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }
  );
  winInputProc.stdout.setEncoding('utf8');
  winInputProc.stdout.on('data', (chunk) => {
    if (String(chunk).includes('READY')) winInputReady = true;
  });
  winInputProc.on('exit', () => {
    winInputProc = null;
    winInputReady = false;
  });
}

function applyWindowsPersistent(ev) {
  ensureWinInputHost();
  if (!winInputProc || !winInputProc.stdin.writable) return Promise.resolve(false);
  try {
    winInputProc.stdin.write(JSON.stringify(ev) + '\n');
    return Promise.resolve(true);
  } catch {
    return Promise.resolve(false);
  }
}

/**
 * @param {{ type: string; x?: number; y?: number; button?: number; deltaY?: number; key?: string; text?: string }} ev
 */
async function applyRemoteInput(ev) {
  if (!ev || !ev.type) return false;
  const platform = process.platform;

  if (platform === 'win32') {
    return applyWindowsPersistent(ev);
  }
  if (platform === 'linux') {
    return applyLinux(ev);
  }
  if (platform === 'darwin') {
    return applyMac(ev);
  }
  return false;
}

async function applyLinux(ev) {
  const x = typeof ev.x === 'number' ? clamp(ev.x, 0, 1) : 0.5;
  const y = typeof ev.y === 'number' ? clamp(ev.y, 0, 1) : 0.5;

  if (ev.type === 'mousemove' || ev.type === 'click') {
    const okGeom = await run('bash', [
      '-c',
      `eval $(xdotool getdisplaygeometry --shell 2>/dev/null); X=$(echo "$WIDTH * ${x}" | bc); Y=$(echo "$HEIGHT * ${y}" | bc); xdotool mousemove --sync $(printf %.0f $X) $(printf %.0f $Y)`,
    ]);
    if (!okGeom) return false;
    if (ev.type === 'click') {
      const btn = Number(ev.button) === 2 ? 3 : 1;
      return run('xdotool', ['click', String(btn)]);
    }
    return true;
  }

  if (ev.type === 'keydown' || ev.type === 'keypress') {
    const key = String(ev.key || '').slice(0, 32);
    if (!key) return false;
    return run('xdotool', ['key', key]);
  }

  if (ev.type === 'wheel') {
    const btn = (ev.deltaY || 0) > 0 ? 5 : 4;
    return run('xdotool', ['click', String(btn)]);
  }

  return false;
}

async function applyMac(ev) {
  if (ev.type === 'click' || ev.type === 'mousemove') {
    const x = typeof ev.x === 'number' ? clamp(ev.x, 0, 1) : 0.5;
    const y = typeof ev.y === 'number' ? clamp(ev.y, 0, 1) : 0.5;
    const script = `
tell application "Finder" to set {sx, sy} to {item 3, item 4} of (get bounds of window of desktop)
set px to (sx * ${x}) as integer
set py to (sy * ${y}) as integer
do shell script "which cliclick >/dev/null 2>&1 && cliclick m:" & px & "," & py & ${
      ev.type === 'click' ? ` " c:" & px & "," & py` : ' ""'
    } & " || true"
`;
    return run('osascript', ['-e', script]);
  }
  if (ev.type === 'keydown' || ev.type === 'keypress') {
    const key = String(ev.key || '').slice(0, 1);
    if (!key) return false;
    return run('osascript', ['-e', `tell application "System Events" to keystroke "${key.replace(/"/g, '\\"')}"`]);
  }
  return false;
}

function stopRemoteInputHost() {
  if (winInputProc) {
    try {
      winInputProc.stdin.write('EXIT\n');
    } catch (_) {}
    try {
      winInputProc.kill();
    } catch (_) {}
    winInputProc = null;
    winInputReady = false;
  }
}

module.exports = { applyRemoteInput, stopRemoteInputHost };
