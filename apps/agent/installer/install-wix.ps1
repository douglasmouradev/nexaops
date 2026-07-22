# Baixa WiX Toolset portable (sem precisar de admin)
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$WixDir = Join-Path $Root "tools\wix"
$Url = "https://github.com/wixtoolset/wix3/releases/download/wix3141rtm/wix314-binaries.zip"
$Zip = Join-Path $env:TEMP "wix314-binaries.zip"

Write-Host "=== Instalacao WiX Toolset (portable) ===" -ForegroundColor Cyan

if (Test-Path (Join-Path $WixDir "candle.exe")) {
    Write-Host "WiX ja instalado em: $WixDir" -ForegroundColor Green
    exit 0
}

Write-Host "Baixando WiX v3.14.1..."
Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing

New-Item -ItemType Directory -Force -Path $WixDir | Out-Null
Expand-Archive -Path $Zip -DestinationPath $WixDir -Force

if (-not (Test-Path (Join-Path $WixDir "candle.exe"))) {
    Write-Host "Erro: candle.exe nao encontrado apos extracao." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "WiX instalado com sucesso!" -ForegroundColor Green
Write-Host "  Local: $WixDir"
Write-Host ""
Write-Host "Proximo passo: npm run build:agent-msi" -ForegroundColor Cyan
