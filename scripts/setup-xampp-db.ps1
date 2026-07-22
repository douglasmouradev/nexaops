# Configura o banco NexaOps no MySQL do XAMPP
#
# Uso:
#   .\scripts\setup-xampp-db.ps1 -RootPassword "sua_senha"
#   .\scripts\setup-xampp-db.ps1 -SkipDbCreate   (apos rodar SQL no phpMyAdmin)
#   .\scripts\setup-xampp-db.ps1                 (pede senha interativamente)

param(
    [string]$RootPassword,
    [string]$MysqlBin = "C:\xampp\mysql\bin\mysql.exe",
    [switch]$SkipDbCreate
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Write-EnvFiles {
    param([string]$DatabaseUrl)

    $envContent = @"
# Database
DATABASE_URL="$DatabaseUrl"

# Redis
REDIS_URL="redis://localhost:6379"

# JWT
JWT_SECRET="change-me-to-a-long-random-secret-in-production"
JWT_REFRESH_SECRET="change-me-to-another-long-random-secret"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"

# API
API_PORT=3001
API_URL="http://localhost:3001"
CORS_ORIGIN="http://localhost:5173"

# Web
VITE_API_URL="http://localhost:3001"

# Encryption (32 bytes hex for AES-256)
VAULT_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef"
"@

    Set-Content -Path (Join-Path $Root ".env") -Value $envContent -Encoding UTF8
    Set-Content -Path (Join-Path $Root "apps\api\.env") -Value $envContent -Encoding UTF8
    Write-Host "Arquivos .env atualizados." -ForegroundColor Green
}

function Invoke-Mysql {
    param(
        [string]$User,
        [string]$Password,
        [string]$Sql
    )

    $prev = $env:MYSQL_PWD
    try {
        if ($Password) { $env:MYSQL_PWD = $Password }
        $Sql | & $MysqlBin -u $User --protocol=tcp -h 127.0.0.1 2>&1
        return $LASTEXITCODE
    } finally {
        if ($null -eq $prev) { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue }
        else { $env:MYSQL_PWD = $prev }
    }
}

if (-not $SkipDbCreate) {
    if (-not (Test-Path $MysqlBin)) {
        Write-Host "MySQL do XAMPP nao encontrado em: $MysqlBin" -ForegroundColor Red
        exit 1
    }

    if (-not $RootPassword) {
        $secure = Read-Host "Senha do usuario root do MySQL (XAMPP)" -AsSecureString
        $RootPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        )
    }

    $sql = Get-Content (Join-Path $Root "scripts\setup-nexaops.sql") -Raw

    Write-Host "Conectando ao MySQL e criando banco/usuario nexaops..." -ForegroundColor Cyan
    $exitCode = Invoke-Mysql -User "root" -Password $RootPassword -Sql $sql

    if ($exitCode -ne 0) {
        Write-Host ""
        Write-Host "Senha do root incorreta ou MySQL inacessivel." -ForegroundColor Red
        Write-Host ""
        Write-Host "Faca manualmente pelo phpMyAdmin:" -ForegroundColor Yellow
        Write-Host "  1. Abra http://localhost/phpmyadmin"
        Write-Host "  2. Aba SQL -> cole o conteudo de scripts\setup-nexaops.sql"
        Write-Host "  3. Execute e depois rode:"
        Write-Host "     .\scripts\setup-xampp-db.ps1 -SkipDbCreate"
        Write-Host ""
        exit 1
    }

    Write-EnvFiles -DatabaseUrl "mysql://nexaops:nexaops@localhost:3306/nexaops"
} else {
    Write-Host "Pulando criacao do banco (modo -SkipDbCreate)." -ForegroundColor Cyan
    Write-EnvFiles -DatabaseUrl "mysql://nexaops:nexaops@localhost:3306/nexaops"
}

Push-Location $Root
try {
    Write-Host "Criando tabelas (db:push)..." -ForegroundColor Cyan
    npm run db:push
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Host "Populando dados demo (db:seed)..." -ForegroundColor Cyan
    npm run db:seed
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Setup concluido!" -ForegroundColor Green
Write-Host "  npm run dev"
Write-Host "  http://localhost:5173"
Write-Host "  Login: admin@nexaops.demo / Admin@123"
