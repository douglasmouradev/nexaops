/**
 * Descoberta e instalação de patches (Windows WUA / Linux apt|dnf / macOS softwareupdate).
 */
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

function runPs(script, timeoutMs = 120000) {
  return execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout: timeoutMs, windowsHide: true, maxBuffer: 5 * 1024 * 1024 }
  );
}

function run(cmd, args, timeoutMs = 120000) {
  return execFileAsync(cmd, args, { timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024 });
}

async function discoverWindowsPatches() {
  if (process.platform !== 'win32') return [];

  const script = `
$ErrorActionPreference = 'Stop'
try {
  $session = New-Object -ComObject Microsoft.Update.Session
  $searcher = $session.CreateUpdateSearcher()
  $result = $searcher.Search('IsInstalled=0 and Type=''Software''')
  $items = @()
  foreach ($u in $result.Updates) {
    $kb = ($u.KBArticleIDs | Select-Object -First 1)
    $items += [PSCustomObject]@{
      title = $u.Title
      kbId = if ($kb) { "KB$kb" } else { $null }
      severity = if ($u.MsrcSeverity) { $u.MsrcSeverity } else { 'Unknown' }
    }
  }
  $items | ConvertTo-Json -Compress -Depth 3
} catch {
  '[]'
}
`;
  try {
    const { stdout } = await runPs(script, 180000);
    const raw = (stdout || '').trim() || '[]';
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch {
    return [];
  }
}

async function discoverLinuxPatches() {
  if (process.platform !== 'linux') return [];
  const items = [];

  try {
    const { stdout } = await run('bash', ['-c', 'apt list --upgradable 2>/dev/null | tail -n +2'], 60000);
    for (const line of (stdout || '').split('\n')) {
      const m = line.match(/^([^\s/]+)\/[^\s]+\s+(\S+)/);
      if (!m) continue;
      items.push({
        title: `${m[1]} ${m[2]}`,
        kbId: m[1],
        severity: 'Unknown',
      });
    }
  } catch {
    /* try dnf */
  }

  if (items.length === 0) {
    try {
      const { stdout } = await run(
        'bash',
        ['-c', 'dnf check-update -q 2>/dev/null | awk \'NF>=3 && $1!~/^Last/ {print $1" "$2}\''],
        90000
      );
      for (const line of (stdout || '').split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2) continue;
        items.push({ title: `${parts[0]} ${parts[1]}`, kbId: parts[0], severity: 'Unknown' });
      }
    } catch {
      /* empty */
    }
  }

  return items.slice(0, 200);
}

async function discoverMacPatches() {
  if (process.platform !== 'darwin') return [];
  try {
    const { stdout, stderr } = await run('softwareupdate', ['-l'], 120000);
    const text = `${stdout || ''}\n${stderr || ''}`;
    const items = [];
    const re = /\*\s+Label:\s*(.+)|^\s+\*\s+(.+)$/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
      const label = (m[1] || m[2] || '').trim();
      if (!label || /Software Update Tool/i.test(label)) continue;
      items.push({ title: label, kbId: label, severity: /Security/i.test(label) ? 'Critical' : 'Unknown' });
    }
    // Fallback: lines like "   * LabelName-1.0"
    if (items.length === 0) {
      for (const line of text.split('\n')) {
        const mm = line.match(/^\s*\*\s+(.+)$/);
        if (mm) items.push({ title: mm[1].trim(), kbId: mm[1].trim(), severity: 'Unknown' });
      }
    }
    return items.slice(0, 100);
  } catch {
    return [];
  }
}

async function installWindows(patch) {
  const kb = (patch.kbId || '').replace(/^KB/i, '');
  if (!kb) {
    return { id: patch.id, status: 'FAILED', output: 'Patch sem KB — não é possível instalar automaticamente' };
  }

  const script = `
$ErrorActionPreference = 'Stop'
$kb = '${kb}'
try {
  $session = New-Object -ComObject Microsoft.Update.Session
  $searcher = $session.CreateUpdateSearcher()
  $result = $searcher.Search("IsInstalled=0 and Type='Software'")
  $toInstall = New-Object -ComObject Microsoft.Update.UpdateColl
  foreach ($u in $result.Updates) {
    if ($u.KBArticleIDs -contains $kb) { [void]$toInstall.Add($u) }
  }
  if ($toInstall.Count -eq 0) {
    Write-Output "NOT_FOUND"
    exit 0
  }
  $downloader = $session.CreateUpdateDownloader()
  $downloader.Updates = $toInstall
  $downloader.Download() | Out-Null
  $installer = $session.CreateUpdateInstaller()
  $installer.Updates = $toInstall
  $installResult = $installer.Install()
  if ($installResult.ResultCode -eq 2) { Write-Output "INSTALLED" }
  else { Write-Output "FAILED:$($installResult.ResultCode)" }
} catch {
  Write-Output "FAILED:$($_.Exception.Message)"
}
`;

  try {
    const { stdout } = await runPs(script, 600000);
    const out = (stdout || '').trim();
    if (out.includes('INSTALLED')) return { id: patch.id, status: 'INSTALLED', output: out };
    if (out.includes('NOT_FOUND')) return { id: patch.id, status: 'FAILED', output: `KB${kb} não encontrado no WUA` };
    return { id: patch.id, status: 'FAILED', output: out || 'Falha na instalação' };
  } catch (err) {
    return { id: patch.id, status: 'FAILED', output: err.message || String(err) };
  }
}

async function installLinux(patch) {
  const pkg = String(patch.kbId || '').replace(/[^a-zA-Z0-9._+-]/g, '');
  if (!pkg) {
    return { id: patch.id, status: 'FAILED', output: 'Pacote inválido' };
  }
  try {
    try {
      const { stdout, stderr } = await run('bash', ['-c', `DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkg}`], 600000);
      return { id: patch.id, status: 'INSTALLED', output: (stdout || stderr || '').slice(0, 2000) };
    } catch {
      const { stdout, stderr } = await run('bash', ['-c', `dnf update -y ${pkg}`], 600000);
      return { id: patch.id, status: 'INSTALLED', output: (stdout || stderr || '').slice(0, 2000) };
    }
  } catch (err) {
    return { id: patch.id, status: 'FAILED', output: err.message || String(err) };
  }
}

async function installMac(patch) {
  const label = String(patch.kbId || patch.title || '').trim();
  if (!label) {
    return { id: patch.id, status: 'FAILED', output: 'Label softwareupdate inválido' };
  }
  try {
    const { stdout, stderr } = await run('softwareupdate', ['-i', label, '--agree-to-license'], 600000);
    return {
      id: patch.id,
      status: 'INSTALLED',
      output: `${stdout || ''}\n${stderr || ''}`.trim().slice(0, 2000) || 'OK',
    };
  } catch (err) {
    return { id: patch.id, status: 'FAILED', output: err.message || String(err) };
  }
}

async function installScheduledPatch(patch) {
  if (process.platform === 'win32') return installWindows(patch);
  if (process.platform === 'linux') return installLinux(patch);
  if (process.platform === 'darwin') return installMac(patch);
  return {
    id: patch.id,
    status: 'FAILED',
    output: `Plataforma não suportada: ${process.platform}`,
  };
}

module.exports = {
  discoverWindowsPatches,
  discoverLinuxPatches,
  discoverMacPatches,
  installScheduledPatch,
};
