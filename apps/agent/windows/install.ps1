# Configura o NexaOps Agent para iniciar automaticamente (tarefa SYSTEM).
# Chamado pelo MSI: install.ps1 -InstallFolder "..." -Token "..." -ApiUrl "..."
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallFolder,

    [Parameter(Mandatory = $true)]
    [string]$Token,

    [string]$ApiUrl = "https://nexaops.tdesksolutions.com.br"
)

$ErrorActionPreference = "Stop"
$TaskName = "NexaOpsAgent"
$LegacyService = "NexaOpsAgent"
$ConfigDir = Join-Path $env:ProgramData "NexaOps Agent"
$LogFile = Join-Path $ConfigDir "install.log"

function Write-InstallLog([string]$Message) {
    $line = "[{0}] {1}" -f (Get-Date -Format "o"), $Message
    Add-Content -Path $LogFile -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
    Write-Host $Message
}

New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
Write-InstallLog "Iniciando configuracao do agent..."

$NodeExe = Join-Path $InstallFolder "node.exe"
$Script = Join-Path $InstallFolder "index.js"

if (-not (Test-Path $NodeExe)) { throw "node.exe nao encontrado em $InstallFolder" }
if (-not (Test-Path $Script)) { throw "index.js nao encontrado em $InstallFolder" }
if ([string]::IsNullOrWhiteSpace($Token)) { throw "TOKEN vazio — passe TOKEN= no msiexec" }

# config.json sem BOM (Node JSON.parse falha com BOM do Set-Content -Encoding UTF8)
$json = @{
    token  = $Token.Trim()
    apiUrl = $ApiUrl.Trim().TrimEnd('/')
} | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText(
    (Join-Path $ConfigDir "config.json"),
    $json,
    [System.Text.UTF8Encoding]::new($false)
)
Write-InstallLog "config.json gravado (apiUrl=$ApiUrl)"

# Remove servico legado (sc/New-Service + node = erro 1053)
$svc = Get-Service -Name $LegacyService -ErrorAction SilentlyContinue
if ($svc) {
    Write-InstallLog "Removendo servico legado NexaOpsAgent..."
    if ($svc.Status -eq 'Running') {
        Stop-Service -Name $LegacyService -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
    & sc.exe delete $LegacyService 2>$null | Out-Null
    Start-Sleep -Seconds 2
}

# Encerra processos manuais do agent
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and ($_.CommandLine -like '*NexaOps Agent*' -or $_.CommandLine -like '*NexaOps*index.js*') } |
    ForEach-Object {
        Write-InstallLog ("Encerrando PID {0}" -f $_.ProcessId)
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction `
    -Execute $NodeExe `
    -Argument ("`"{0}`"" -f $Script) `
    -WorkingDirectory $InstallFolder

$trigger = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 3650)

$principal = New-ScheduledTaskPrincipal `
    -UserId "SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "NexaOps RMM Agent — monitoramento automatico" `
    -Force | Out-Null

Write-InstallLog "Tarefa agendada '$TaskName' registrada (AtStartup / SYSTEM)"

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

$running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like '*NexaOps*' }

if ($running) {
    Write-InstallLog ("Agent em execucao (PID {0})" -f ($running | Select-Object -First 1).ProcessId)
} else {
    Write-InstallLog "AVISO: processo node ainda nao visivel — verifique agent.log em alguns segundos"
}

Write-InstallLog "Instalacao automatica concluida."
