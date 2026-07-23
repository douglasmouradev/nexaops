/**
 * Setup pos-MSI: grava config.json, cria tarefa SYSTEM e inicia o agent.
 * Usa apenas Node (embutido no MSI) — sem PowerShell / ExecutionPolicy.
 *
 * Uso: node setup.js [token] [apiUrl]
 * Pasta de install = pai de windows/ (onde esta este arquivo).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawn } = require('child_process');

const installFolder = path.resolve(__dirname, '..');
const nodeExe = path.join(installFolder, 'node.exe');
const indexJs = path.join(installFolder, 'index.js');
const configDir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'NexaOps Agent');
const logFile = path.join(configDir, 'install.log');
const taskName = 'NexaOpsAgent';

const token = String(process.argv[2] || '').trim();
const apiUrl = String(process.argv[3] || 'https://nexaops.tdesksolutions.com.br')
  .trim()
  .replace(/\/+$/, '');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try {
    fs.mkdirSync(configDir, { recursive: true });
    fs.appendFileSync(logFile, line + '\n', 'utf8');
  } catch (_) {}
  console.log(line);
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stopLegacy() {
  try {
    execFileSync('sc.exe', ['stop', taskName], { stdio: 'ignore' });
  } catch (_) {}
  try {
    execFileSync('sc.exe', ['delete', taskName], { stdio: 'ignore' });
  } catch (_) {}
  try {
    execFileSync('schtasks.exe', ['/Delete', '/TN', taskName, '/F'], { stdio: 'ignore' });
  } catch (_) {}
}

function createTaskXml() {
  const cmd = escapeXml(nodeExe);
  const args = escapeXml(`"${indexJs}"`);
  const cwd = escapeXml(installFolder);
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>NexaOps Agent</Description>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${cmd}</Command>
      <Arguments>${args}</Arguments>
      <WorkingDirectory>${cwd}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

function main() {
  log('Iniciando setup.js...');
  log(`InstallFolder: ${installFolder}`);

  if (!fs.existsSync(nodeExe)) throw new Error('node.exe nao encontrado: ' + nodeExe);
  if (!fs.existsSync(indexJs)) throw new Error('index.js nao encontrado: ' + indexJs);
  if (!token) throw new Error('TOKEN vazio');

  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, 'config.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify({ token, apiUrl }),
    { encoding: 'utf8' }
  );
  log('config.json gravado');

  stopLegacy();

  const xmlPath = path.join(os.tmpdir(), 'nexaops-agent-task.xml');
  // schtasks /XML exige UTF-16 LE com BOM
  const xmlBom = Buffer.from([0xff, 0xfe]);
  const xmlBody = Buffer.from(createTaskXml(), 'utf16le');
  fs.writeFileSync(xmlPath, Buffer.concat([xmlBom, xmlBody]));

  try {
    execFileSync(
      'schtasks.exe',
      ['/Create', '/TN', taskName, '/XML', xmlPath, '/F'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    log('Tarefa criada via XML');
  } catch (e) {
    const err = (e.stderr && e.stderr.toString()) || e.message;
    log('Falha schtasks XML: ' + err);
    // Fallback: sobe processo agora (sem persistencia no reboot)
    spawn(nodeExe, [indexJs], {
      cwd: installFolder,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    log('AVISO: agent iniciado sem tarefa agendada');
    return;
  } finally {
    try {
      fs.unlinkSync(xmlPath);
    } catch (_) {}
  }

  try {
    execFileSync('schtasks.exe', ['/Run', '/TN', taskName], { stdio: 'ignore' });
    log('Tarefa iniciada');
  } catch (e) {
    log('AVISO: schtasks /Run falhou — iniciando processo direto');
    spawn(nodeExe, [indexJs], {
      cwd: installFolder,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  }

  log('Setup concluido.');
}

try {
  main();
  process.exit(0);
} catch (e) {
  try {
    log('ERRO: ' + (e && e.message ? e.message : String(e)));
  } catch (_) {}
  process.exit(0); // nao derruba o MSI
}
