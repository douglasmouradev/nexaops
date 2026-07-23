# Compila NexaOpsAgent.msi (requer WiX Toolset v3.14+)
# Uso:
#   $env:AGENT_TOKEN="seu_token"
#   $env:API_URL="https://nexaops.tdesksolutions.com.br"
#   .\build-msi.ps1
# Ou: .\build-msi.ps1 -AgentToken "..." -ApiUrl "https://..."

param(
    [string]$NodeVersion = "20.18.0",
    [string]$AgentToken = $env:AGENT_TOKEN,
    [string]$ApiUrl = $(if ($env:API_URL) { $env:API_URL } else { "https://nexaops.tdesksolutions.com.br" })
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$AgentRoot = Split-Path $Root -Parent
$Staging = Join-Path $Root "staging"
$Dist = Join-Path $Root "dist"
$Obj = Join-Path $Root "obj"
$FilesWxs = Join-Path $Root "Files.wxs"

Write-Host "=== NexaOps Agent MSI Builder ===" -ForegroundColor Cyan

if ([string]::IsNullOrWhiteSpace($AgentToken)) {
    Write-Host ""
    Write-Host "AVISO: AGENT_TOKEN / -AgentToken nao definido." -ForegroundColor Yellow
    Write-Host "O MSI NAO iniciara o agent no duplo clique (so copia arquivos)." -ForegroundColor Yellow
    Write-Host "Exemplo:" -ForegroundColor Yellow
    Write-Host '  $env:AGENT_TOKEN="seu_token"; $env:API_URL="https://nexaops.tdesksolutions.com.br"; npm run build:agent-msi' -ForegroundColor DarkGray
    Write-Host ""
} else {
    $preview = $AgentToken.Substring(0, [Math]::Min(8, $AgentToken.Length))
    Write-Host "Bake TOKEN: $preview... (embutido no MSI)" -ForegroundColor Green
    Write-Host "Bake API_URL: $ApiUrl" -ForegroundColor Green
}

$LocalWix = Join-Path $Root "tools\wix"
$WixPaths = @(
    $LocalWix,
    "${env:ProgramFiles(x86)}\WiX Toolset v3.14\bin",
    "${env:ProgramFiles(x86)}\WiX Toolset v3.11\bin",
    "${env:ProgramFiles}\WiX Toolset v3.14\bin"
)
$WixBin = $WixPaths | Where-Object { Test-Path (Join-Path $_ "candle.exe") } | Select-Object -First 1

if (-not $WixBin) {
    Write-Host ""
    Write-Host "WiX Toolset nao encontrado." -ForegroundColor Red
    Write-Host "Execute: npm run install:wix" -ForegroundColor Yellow
    exit 1
}

Write-Host "WiX: $WixBin"

if (Test-Path $Staging) { Remove-Item $Staging -Recurse -Force }
New-Item -ItemType Directory -Path $Staging | Out-Null
New-Item -ItemType Directory -Path $Dist -Force | Out-Null
New-Item -ItemType Directory -Path $Obj -Force | Out-Null

Copy-Item (Join-Path $AgentRoot "index.js") $Staging
Copy-Item (Join-Path $AgentRoot "lib") (Join-Path $Staging "lib") -Recurse
Copy-Item (Join-Path $AgentRoot "windows") (Join-Path $Staging "windows") -Recurse

# socket.io-client obrigatorio para stream remoto
$AgentNm = Join-Path $AgentRoot "node_modules"
if (-not (Test-Path (Join-Path $AgentNm "socket.io-client"))) {
    Write-Host "Instalando deps do agent (socket.io-client)..."
    Push-Location $AgentRoot
    npm install --omit=dev --no-fund --no-audit
    Pop-Location
}
if (Test-Path (Join-Path $AgentNm "socket.io-client")) {
    Copy-Item $AgentNm (Join-Path $Staging "node_modules") -Recurse -Force
    Write-Host "node_modules (socket.io-client) incluido no MSI" -ForegroundColor Green
} else {
    Write-Host "AVISO: socket.io-client ausente — stream remoto pode falhar" -ForegroundColor Yellow
}

$NodeZip = Join-Path $env:TEMP "node-v$NodeVersion-win-x64.zip"
$NodeExtract = Join-Path $env:TEMP "node-v$NodeVersion-win-x64"
$NodeUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"

if (-not (Test-Path (Join-Path $NodeExtract "node.exe"))) {
    Write-Host "Baixando Node.js v$NodeVersion..."
    Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeZip -UseBasicParsing
    if (Test-Path $NodeExtract) { Remove-Item $NodeExtract -Recurse -Force }
    Expand-Archive -Path $NodeZip -DestinationPath $env:TEMP -Force
}

Copy-Item (Join-Path $NodeExtract "node.exe") (Join-Path $Staging "node.exe") -Force
Write-Host "node.exe incluido ($('{0:N1}' -f ((Get-Item (Join-Path $Staging 'node.exe')).Length / 1MB)) MB)"

& "$WixBin\heat.exe" dir $Staging `
    -cg AgentFiles `
    -gg -sfrag -srd `
    -dr INSTALLFOLDER `
    -var var.StagingDir `
    -platform x64 `
    -out $FilesWxs

if ($LASTEXITCODE -ne 0) { throw "heat.exe falhou" }

Write-Host "Compilando MSI..."
& "$WixBin\candle.exe" `
    (Join-Path $Root "NexaOpsAgent.wxs") `
    $FilesWxs `
    -ext WixUtilExtension `
    "-dStagingDir=$Staging" `
    "-dBakeToken=$AgentToken" `
    "-dBakeApiUrl=$ApiUrl" `
    -out "$Obj\"

if ($LASTEXITCODE -ne 0) { throw "candle.exe falhou" }

$MsiOut = Join-Path $Dist "NexaOpsAgent.msi"
& "$WixBin\light.exe" `
    (Join-Path $Obj "NexaOpsAgent.wixobj") `
    (Join-Path $Obj "Files.wixobj") `
    -ext WixUtilExtension `
    "-dStagingDir=$Staging" `
    -sice:ICE80 `
    -sice:ICE61 `
    -out $MsiOut

if ($LASTEXITCODE -ne 0) { throw "light.exe falhou" }

$SizeMb = '{0:N1}' -f ((Get-Item $MsiOut).Length / 1MB)
Write-Host ""
Write-Host "MSI gerado com sucesso!" -ForegroundColor Green
Write-Host "  Arquivo: $MsiOut ($SizeMb MB)"

$SignScript = Join-Path $Root "sign-msi.ps1"
if ($env:CODE_SIGN_PFX_PATH -or $env:CODE_SIGN_THUMBPRINT) {
    Write-Host ""
    Write-Host "Assinando MSI..." -ForegroundColor Cyan
    & $SignScript -MsiPath $MsiOut
} else {
    Write-Host ""
    Write-Host "MSI nao assinado (opcional: CODE_SIGN_PFX_PATH)." -ForegroundColor Yellow
}

Write-Host ""
if (-not [string]::IsNullOrWhiteSpace($AgentToken)) {
    Write-Host "Instalar em qualquer PC:" -ForegroundColor Cyan
    Write-Host "  Botao direito no MSI > Executar como administrador" -ForegroundColor White
    Write-Host "  (TOKEN + API ja embutidos - sem PowerShell)" -ForegroundColor DarkGray
} else {
    Write-Host "Rebuild com token para duplo clique automatico." -ForegroundColor Yellow
}
