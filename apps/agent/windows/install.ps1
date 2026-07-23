# Configura o NexaOps Agent para iniciar automaticamente (tarefa SYSTEM).
# ASCII-only: PowerShell 5.1 sem BOM quebra com caracteres UTF-8.
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallFolder,

    [Parameter(Mandatory = $true)]
    [string]$Token,

    [string]$ApiUrl = "https://nexaops.tdesksolutions.com.br"
)

$ErrorActionPreference = "Continue"
$TaskName = "NexaOpsAgent"
$LegacyService = "NexaOpsAgent"
$ConfigDir = Join-Path $env:ProgramData "NexaOps Agent"
$LogFile = Join-Path $ConfigDir "install.log"

function Write-InstallLog([string]$Message) {
    try {
        New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
        $line = "[{0}] {1}" -f (Get-Date -Format "o"), $Message
        Add-Content -Path $LogFile -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch {}
    Write-Host $Message
}

try {
    New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
    Write-InstallLog "Iniciando configuracao do agent..."

    $NodeExe = Join-Path $InstallFolder "node.exe"
    $Script = Join-Path $InstallFolder "index.js"

    if (-not (Test-Path $NodeExe)) { throw "node.exe nao encontrado em $InstallFolder" }
    if (-not (Test-Path $Script)) { throw "index.js nao encontrado em $InstallFolder" }
    if ([string]::IsNullOrWhiteSpace($Token)) { throw "TOKEN vazio" }

    $json = (@{
        token  = $Token.Trim()
        apiUrl = $ApiUrl.Trim().TrimEnd('/')
    } | ConvertTo-Json -Compress)
    [System.IO.File]::WriteAllText(
        (Join-Path $ConfigDir "config.json"),
        $json,
        [System.Text.UTF8Encoding]::new($false)
    )
    Write-InstallLog "config.json gravado"

    $svc = Get-Service -Name $LegacyService -ErrorAction SilentlyContinue
    if ($svc) {
        Write-InstallLog "Removendo servico legado..."
        if ($svc.Status -eq 'Running') { Stop-Service -Name $LegacyService -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 1
        cmd.exe /c "sc delete $LegacyService" | Out-Null
    }

    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like '*NexaOps*' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

    cmd.exe /c "schtasks /Delete /TN `"$TaskName`" /F" 2>$null | Out-Null
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

    $tr = "`"$NodeExe`" `"$Script`""
    $created = $false

    try {
        $action = New-ScheduledTaskAction -Execute $NodeExe -Argument "`"$Script`"" -WorkingDirectory $InstallFolder
        $trigger = New-ScheduledTaskTrigger -AtStartup
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
        $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
        $created = $true
        Write-InstallLog "Tarefa criada via Register-ScheduledTask"
    } catch {
        $msg = $_.Exception.Message
        Write-InstallLog "Register-ScheduledTask falhou: $msg"
    }

    if (-not $created) {
        $cmd = "schtasks /Create /TN `"$TaskName`" /TR `"$tr`" /SC ONSTART /RU SYSTEM /RL HIGHEST /F"
        Write-InstallLog "Fallback: $cmd"
        cmd.exe /c $cmd
        if ($LASTEXITCODE -eq 0) {
            $created = $true
            Write-InstallLog "Tarefa criada via schtasks"
        } else {
            Write-InstallLog "schtasks falhou codigo $LASTEXITCODE"
        }
    }

    if ($created) {
        cmd.exe /c "schtasks /Run /TN `"$TaskName`"" | Out-Null
        Start-Sleep -Seconds 2
        Write-InstallLog "Tarefa iniciada"
    } else {
        Write-InstallLog "AVISO: sem tarefa - iniciando processo agora"
        Start-Process -FilePath $NodeExe -ArgumentList "`"$Script`"" -WorkingDirectory $InstallFolder -WindowStyle Hidden
    }

    Write-InstallLog "Instalacao automatica concluida."
    exit 0
} catch {
    $msg = $_.Exception.Message
    Write-InstallLog "ERRO: $msg"
    exit 0
}
