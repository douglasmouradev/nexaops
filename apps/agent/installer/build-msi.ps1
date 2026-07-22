# Compila NexaOpsAgent.msi (requer WiX Toolset v3.14+)
# Uso: .\build-msi.ps1 [-NodeVersion "20.18.0"]

param(
    [string]$NodeVersion = "20.18.0"
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$AgentRoot = Split-Path $Root -Parent
$Staging = Join-Path $Root "staging"
$Dist = Join-Path $Root "dist"
$Obj = Join-Path $Root "obj"
$FilesWxs = Join-Path $Root "Files.wxs"

Write-Host "=== NexaOps Agent MSI Builder ===" -ForegroundColor Cyan

# Localizar WiX Toolset (portable local > instalacao do sistema)
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
    Write-Host "Ou instale: winget install WiXToolset.WiXToolset (admin)" -ForegroundColor Yellow
    exit 1
}

Write-Host "WiX: $WixBin"

# Preparar staging
if (Test-Path $Staging) { Remove-Item $Staging -Recurse -Force }
New-Item -ItemType Directory -Path $Staging | Out-Null
New-Item -ItemType Directory -Path $Dist -Force | Out-Null
New-Item -ItemType Directory -Path $Obj -Force | Out-Null

# Copiar arquivos do agente
Copy-Item (Join-Path $AgentRoot "index.js") $Staging
Copy-Item (Join-Path $AgentRoot "lib") (Join-Path $Staging "lib") -Recurse
Copy-Item (Join-Path $AgentRoot "windows") (Join-Path $Staging "windows") -Recurse

# Baixar Node.js portable (win-x64)
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

# Gerar fragmento de arquivos com heat.exe
& "$WixBin\heat.exe" dir $Staging `
    -cg AgentFiles `
    -gg -sfrag -srd `
    -dr INSTALLFOLDER `
    -var var.StagingDir `
    -platform x64 `
    -out $FilesWxs

if ($LASTEXITCODE -ne 0) { throw "heat.exe falhou" }

# Compilar
Write-Host "Compilando MSI..."
& "$WixBin\candle.exe" `
    (Join-Path $Root "NexaOpsAgent.wxs") `
    $FilesWxs `
    -ext WixUtilExtension `
    "-dStagingDir=$Staging" `
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

# Assinatura opcional (Authenticode) — reduz SmartScreen
$SignScript = Join-Path $Root "sign-msi.ps1"
if ($env:CODE_SIGN_PFX_PATH -or $env:CODE_SIGN_THUMBPRINT) {
    Write-Host ""
    Write-Host "Assinando MSI..." -ForegroundColor Cyan
    & $SignScript -MsiPath $MsiOut
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Aviso: assinatura falhou (MSI ainda utilizavel, SmartScreen pode alertar)." -ForegroundColor Yellow
    }
} else {
    Write-Host ""
    Write-Host "MSI nao assinado (defina CODE_SIGN_PFX_PATH ou CODE_SIGN_THUMBPRINT para assinar)." -ForegroundColor Yellow
    Write-Host "  .\sign-msi.ps1" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Instalar (admin):" -ForegroundColor Cyan
Write-Host '  msiexec /i dist\NexaOpsAgent.msi TOKEN=SEU_TOKEN API_URL=http://localhost:3001'
Write-Host ""
Write-Host "Instalar silencioso:" -ForegroundColor Cyan
Write-Host '  msiexec /i dist\NexaOpsAgent.msi /qn TOKEN=SEU_TOKEN API_URL=http://localhost:3001'
