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

# Aspas obrigatórias: "Program Files" quebra sc.exe se mal escapado (erro 1639)
$BinPath = "`"$NodeExe`" `"$Script`""

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    if ($existing.Status -eq 'Running') { Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
    & sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}

try {
    New-Service -Name $ServiceName -BinaryPathName $BinPath -DisplayName "NexaOps Monitoring Agent" -StartupType Automatic | Out-Null
} catch {
    # Fallback via cmd (espaço após = é exigido pelo sc.exe)
    $create = 'sc.exe create {0} binPath= {1} start= auto DisplayName= "NexaOps Monitoring Agent"' -f $ServiceName, $BinPath
    cmd.exe /c $create
    if ($LASTEXITCODE -ne 0) { throw "Falha ao criar servico (codigo $LASTEXITCODE): $_" }
}

& sc.exe description $ServiceName "Monitoramento RMM NexaOps - CPU, RAM, disco e interfaces de rede" | Out-Null
& sc.exe failure $ServiceName reset= 86400 actions= restart/60000/restart/60000/restart/60000 | Out-Null

Start-Sleep -Seconds 1
try {
    Start-Service -Name $ServiceName
    Write-Host "NexaOps Agent instalado e em execucao."
} catch {
    Write-Warning "Servico criado, mas nao iniciou automaticamente. Verifique o log em $ConfigDir\agent.log"
    Write-Warning $_.Exception.Message
}
