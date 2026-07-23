/**
 * Inventário de software instalado (Windows via Registry).
 */
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function collectSoftwareWindows() {
  const ps1 = path.join(os.tmpdir(), `nexaops-soft-${process.pid}.ps1`);
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$paths = @(
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$items = foreach ($p in $paths) {
  Get-ItemProperty $p |
    Where-Object { $_.DisplayName -and $_.DisplayName -notmatch '^(Update for|Security Update|KB[0-9])' } |
    Select-Object @{N='name';E={$_.DisplayName}},
      @{N='version';E={$_.DisplayVersion}},
      @{N='publisher';E={$_.Publisher}}
}
@($items | Sort-Object name -Unique | Select-Object -First 500) | ConvertTo-Json -Compress
`;

  try {
    fs.writeFileSync(ps1, script, 'utf8');
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
      {
        encoding: 'utf8',
        timeout: 90000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      }
    ).trim();

    if (!out) return [];
    const parsed = JSON.parse(out);
    return (Array.isArray(parsed) ? parsed : [parsed])
      .filter((i) => i?.name)
      .map((i) => ({
        name: String(i.name).slice(0, 255),
        version: i.version ? String(i.version).slice(0, 64) : null,
        publisher: i.publisher ? String(i.publisher).slice(0, 128) : null,
      }));
  } catch {
    return [];
  } finally {
    try {
      fs.unlinkSync(ps1);
    } catch {
      /* ignore */
    }
  }
}

function collectSoftwareLinux() {
  try {
    const out = execSync(
      "dpkg-query -W -f='${Package}\\t${Version}\\t${Maintainer}\\n' 2>/dev/null | head -n 500",
      { encoding: 'utf8', timeout: 30000 }
    );
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, version, publisher] = line.split('\t');
        return {
          name: String(name || '').slice(0, 255),
          version: version ? String(version).slice(0, 64) : null,
          publisher: publisher ? String(publisher).slice(0, 128) : null,
        };
      })
      .filter((i) => i.name);
  } catch {
    try {
      const out = execSync(
        "rpm -qa --qf '%{NAME}\\t%{VERSION}\\t%{VENDOR}\\n' 2>/dev/null | head -n 500",
        { encoding: 'utf8', timeout: 30000 }
      );
      return out
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [name, version, publisher] = line.split('\t');
          return {
            name: String(name || '').slice(0, 255),
            version: version ? String(version).slice(0, 64) : null,
            publisher: publisher ? String(publisher).slice(0, 128) : null,
          };
        })
        .filter((i) => i.name);
    } catch {
      return [];
    }
  }
}

function collectSoftwareDarwin() {
  try {
    const out = execSync('system_profiler SPApplicationsDataType -json 2>/dev/null', {
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const parsed = JSON.parse(out);
    const apps = parsed?.SPApplicationsDataType || [];
    return apps.slice(0, 500).map((a) => ({
      name: String(a._name || a.path || 'App').slice(0, 255),
      version: a.version ? String(a.version).slice(0, 64) : null,
      publisher: a.obtained_from ? String(a.obtained_from).slice(0, 128) : null,
    }));
  } catch {
    return [];
  }
}

function collectSoftware() {
  if (process.platform === 'win32') return collectSoftwareWindows();
  if (process.platform === 'darwin') return collectSoftwareDarwin();
  if (process.platform === 'linux') return collectSoftwareLinux();
  return [];
}

module.exports = { collectSoftware };
