# Assina NexaOpsAgent.msi com certificado Authenticode (reduz aviso SmartScreen).
# Requer Windows SDK (signtool) e certificado .pfx ou certificado no store.
#
# Uso:
#   .\sign-msi.ps1
#   .\sign-msi.ps1 -MsiPath .\dist\NexaOpsAgent.msi -PfxPath C:\certs\code.pfx -PfxPassword '***'
#
# Variáveis de ambiente:
#   CODE_SIGN_PFX_PATH, CODE_SIGN_PFX_PASSWORD, CODE_SIGN_THUMBPRINT, CODE_SIGN_TIMESTAMP_URL

param(
    [string]$MsiPath = (Join-Path $PSScriptRoot "dist\NexaOpsAgent.msi"),
    [string]$PfxPath = $env:CODE_SIGN_PFX_PATH,
    [string]$PfxPassword = $env:CODE_SIGN_PFX_PASSWORD,
    [string]$Thumbprint = $env:CODE_SIGN_THUMBPRINT,
    [string]$TimestampUrl = $(if ($env:CODE_SIGN_TIMESTAMP_URL) { $env:CODE_SIGN_TIMESTAMP_URL } else { "http://timestamp.digicert.com" })
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $MsiPath)) {
    Write-Host "MSI nao encontrado: $MsiPath" -ForegroundColor Red
    Write-Host "Execute primeiro: npm run build:agent-msi" -ForegroundColor Yellow
    exit 1
}

function Find-SignTool {
    $candidates = @(
        "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe",
        "${env:ProgramFiles(x86)}\Windows Kits\10\App Certification Kit\signtool.exe",
        "${env:ProgramFiles}\Windows Kits\10\bin\*\x64\signtool.exe"
    )
    foreach ($pattern in $candidates) {
        $found = Get-Item $pattern -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    $inPath = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($inPath) { return $inPath.Source }
    return $null
}

$SignTool = Find-SignTool
if (-not $SignTool) {
    Write-Host "signtool.exe nao encontrado. Instale o Windows SDK." -ForegroundColor Red
    exit 1
}

Write-Host "Assinando $MsiPath ..." -ForegroundColor Cyan
Write-Host "signtool: $SignTool"

$args = @("sign", "/fd", "SHA256", "/td", "SHA256", "/tr", $TimestampUrl)

if ($PfxPath) {
    if (-not (Test-Path $PfxPath)) { throw "PFX nao encontrado: $PfxPath" }
    $args += @("/f", $PfxPath)
    if ($PfxPassword) { $args += @("/p", $PfxPassword) }
} elseif ($Thumbprint) {
    $args += @("/sha1", $Thumbprint)
} else {
    Write-Host ""
    Write-Host "Nenhum certificado configurado." -ForegroundColor Yellow
    Write-Host "Defina CODE_SIGN_PFX_PATH (+ CODE_SIGN_PFX_PASSWORD) ou CODE_SIGN_THUMBPRINT." -ForegroundColor Yellow
    Write-Host "Sem assinatura EV/OV, o Windows pode exibir SmartScreen ate o MSI ganhar reputacao." -ForegroundColor Yellow
    exit 2
}

$args += $MsiPath
& $SignTool @args
if ($LASTEXITCODE -ne 0) { throw "signtool falhou com codigo $LASTEXITCODE" }

& $SignTool verify /pa /v $MsiPath
Write-Host "MSI assinado com sucesso." -ForegroundColor Green
