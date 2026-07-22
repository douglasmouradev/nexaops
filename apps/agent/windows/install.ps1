# Instala o serviço Windows do NexaOps Agent
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallFolder,

    [Parameter(Mandatory = $true)]
    [string]$Token,

    [string]$ApiUrl = "http://localhost:3001"
)

$ErrorActionPreference = "Stop"
$ServiceName = "NexaOpsAgent"
$ConfigDir = Join-Path $env:ProgramData "NexaOps Agent"

Write-Host "NexaOps Agent: configurando servico..."

New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null

@{
    token  = $Token
    apiUrl = $ApiUrl
} | ConvertTo-Json | Set-Content -Path (Join-Path $ConfigDir "config.json") -Encoding UTF8

$NodeExe = Join-Path $InstallFolder "node.exe"
$Script  = Join-Path $InstallFolder "index.js"

if (-not (Test-Path $NodeExe)) { throw "node.exe nao encontrado em $InstallFolder" }
if (-not (Test-Path $Script))  { throw "index.js nao encontrado em $InstallFolder" }

$BinPath = "`"$NodeExe`" `"$Script`""

& sc.exe stop $ServiceName 2>$null | Out-Null
Start-Sleep -Seconds 2
& sc.exe delete $ServiceName 2>$null | Out-Null
Start-Sleep -Seconds 1

& sc.exe create $ServiceName binPath= $BinPath start= auto DisplayName= "NexaOps Monitoring Agent"
if ($LASTEXITCODE -ne 0) { throw "Falha ao criar servico (codigo $LASTEXITCODE)" }

& sc.exe description $ServiceName "Monitoramento RMM NexaOps - CPU, RAM, disco e interfaces de rede"
& sc.exe failure $ServiceName reset= 86400 actions= restart/60000/restart/60000/restart/60000 | Out-Null

Start-Sleep -Seconds 1
& sc.exe start $ServiceName
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Servico criado, mas nao iniciou automaticamente. Verifique o log em $ConfigDir\agent.log"
} else {
    Write-Host "NexaOps Agent instalado e em execucao."
}
