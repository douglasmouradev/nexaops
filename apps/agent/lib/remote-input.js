/**
 * Input remoto (mouse/teclado) — melhor esforço via PowerShell / xdotool / osascript.
 */
const { execFile } = require('child_process');

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function run(cmd, args, timeout = 3000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err) => resolve(!err));
  });
}

function runPs(script) {
  return run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ]);
}

/**
 * @param {{ type: string; x?: number; y?: number; button?: number; deltaY?: number; key?: string; text?: string }} ev
 * x/y are normalized 0..1 relative to primary screen
 */
async function applyRemoteInput(ev) {
  if (!ev || !ev.type) return false;
  const platform = process.platform;

  if (platform === 'win32') {
    return applyWindows(ev);
  }
  if (platform === 'linux') {
    return applyLinux(ev);
  }
  if (platform === 'darwin') {
    return applyMac(ev);
  }
  return false;
}

async function applyWindows(ev) {
  const x = typeof ev.x === 'number' ? clamp(ev.x, 0, 1) : 0.5;
  const y = typeof ev.y === 'number' ? clamp(ev.y, 0, 1) : 0.5;

  if (ev.type === 'mousemove' || ev.type === 'click' || ev.type === 'mousedown' || ev.type === 'mouseup') {
    const click =
      ev.type === 'click'
        ? `
$btn = ${Number(ev.button) === 2 ? 2 : 1}
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point $px, $py
Add-Type -AssemblyName System.Windows.Forms
if ($btn -eq 2) { [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point $px, $py; /* right via mouse_event */ }
Add-Type @"
using System; using System.Runtime.InteropServices;
public class M {
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int dx, int dy, int d, int e);
}
"@
[M]::mouse_event($(Number(ev.button) === 2 ? '0x0008' : '0x0002'), 0, 0, 0, 0)
[M]::mouse_event($(Number(ev.button) === 2 ? '0x0010' : '0x0004'), 0, 0, 0, 0)
`
        : ev.type === 'mousedown'
          ? `[M]::mouse_event(0x0002,0,0,0,0)`
          : ev.type === 'mouseup'
            ? `[M]::mouse_event(0x0004,0,0,0,0)`
            : '';

    const script = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$px = [int]($b.X + $b.Width * ${x})
$py = [int]($b.Y + $b.Height * ${y})
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point $px, $py
${
  ev.type === 'click'
    ? `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class M {
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int dx, int dy, int d, int e);
}
"@
$down = ${Number(ev.button) === 2 ? 0x0008 : 0x0002}
$up = ${Number(ev.button) === 2 ? 0x0010 : 0x0004}
[M]::mouse_event($down, 0, 0, 0, 0)
[M]::mouse_event($up, 0, 0, 0, 0)
`
    : ''
}
`;
    return runPs(script);
  }

  if (ev.type === 'wheel' && typeof ev.deltaY === 'number') {
    const amount = Math.round(clamp(ev.deltaY, -1200, 1200));
    const script = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class M { [DllImport("user32.dll")] public static extern void mouse_event(int f, int dx, int dy, int d, int e); }
"@
[M]::mouse_event(0x0800, 0, 0, ${-amount}, 0)
`;
    return runPs(script);
  }

  if (ev.type === 'keydown' || ev.type === 'keypress') {
    const key = String(ev.key || ev.text || '').slice(0, 32);
    if (!key) return false;
    // SendKeys for printable / common keys
    const map = {
      Enter: '{ENTER}',
      Backspace: '{BACKSPACE}',
      Tab: '{TAB}',
      Escape: '{ESC}',
      Delete: '{DELETE}',
      ArrowUp: '{UP}',
      ArrowDown: '{DOWN}',
      ArrowLeft: '{LEFT}',
      ArrowRight: '{RIGHT}',
    };
    const send = map[key] || (key.length === 1 ? key.replace(/[{}+^%~()]/g, '{$&}') : null);
    if (!send) return false;
    const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${send.replace(/'/g, "''")}')
`;
    return runPs(script);
  }

  return false;
}

async function applyLinux(ev) {
  const x = typeof ev.x === 'number' ? clamp(ev.x, 0, 1) : 0.5;
  const y = typeof ev.y === 'number' ? clamp(ev.y, 0, 1) : 0.5;

  // Resolve screen size via xdotool
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
    // cliclick if available; else AppleScript approximate
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

module.exports = { applyRemoteInput };
