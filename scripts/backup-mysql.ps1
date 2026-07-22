# Backup MySQL do NexaOps
# Uso: .\scripts\backup-mysql.ps1 [-OutDir C:\backups\nexaops]
# Env: DATABASE_URL ou MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE / MYSQL_PORT

param(
    [string]$OutDir = (Join-Path (Split-Path $PSScriptRoot -Parent) "backups"),
    [string]$DatabaseUrl = $env:DATABASE_URL
)

$ErrorActionPreference = "Stop"

function Get-MysqlConfig {
    param([string]$Url)
    if ($Url -match '^mysql://([^:]+):([^@]+)@([^:/]+)(?::(\d+))?/([^?]+)') {
        return @{
            User     = $Matches[1]
            Password = $Matches[2]
            Host     = $Matches[3]
            Port     = $(if ($Matches[4]) { $Matches[4] } else { "3306" })
            Database = $Matches[5]
        }
    }
    return @{
        User     = $(if ($env:MYSQL_USER) { $env:MYSQL_USER } else { "nexaops" })
        Password = $(if ($env:MYSQL_PASSWORD) { $env:MYSQL_PASSWORD } else { "nexaops" })
        Host     = $(if ($env:MYSQL_HOST) { $env:MYSQL_HOST } else { "127.0.0.1" })
        Port     = $(if ($env:MYSQL_PORT) { $env:MYSQL_PORT } else { "3306" })
        Database = $(if ($env:MYSQL_DATABASE) { $env:MYSQL_DATABASE } else { "nexaops" })
    }
}

$cfg = Get-MysqlConfig -Url $DatabaseUrl

$mysqldumpPath = $null
$cmd = Get-Command mysqldump -ErrorAction SilentlyContinue
if ($cmd) { $mysqldumpPath = $cmd.Source }
if (-not $mysqldumpPath) {
    foreach ($c in @(
        "C:\xampp\mysql\bin\mysqldump.exe",
        "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe",
        "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe"
    )) {
        if (Test-Path $c) { $mysqldumpPath = $c; break }
    }
}
if (-not $mysqldumpPath) {
    Write-Host "mysqldump nao encontrado. Alternativa Docker:" -ForegroundColor Red
    Write-Host '  docker exec nexaops-mysql mysqldump -unexaops -pnexaops nexaops' -ForegroundColor Yellow
    exit 1
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$sqlFile = Join-Path $OutDir "nexaops-$stamp.sql"
$zipFile = Join-Path $OutDir "nexaops-$stamp.zip"

Write-Host "Backup -> $zipFile" -ForegroundColor Cyan
$env:MYSQL_PWD = $cfg.Password
& $mysqldumpPath -h $cfg.Host -P $cfg.Port -u $cfg.User `
    --single-transaction --routines --triggers `
    $cfg.Database | Set-Content -Path $sqlFile -Encoding UTF8
Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue

if ((Get-Item $sqlFile).Length -lt 100) { throw "Backup parece vazio — verifique credenciais" }

Compress-Archive -Path $sqlFile -DestinationPath $zipFile -Force
Remove-Item $sqlFile -Force

Write-Host "OK: $zipFile ($('{0:N1}' -f ((Get-Item $zipFile).Length / 1MB)) MB)" -ForegroundColor Green

Get-ChildItem $OutDir -Filter "nexaops-*.zip" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 14 |
    ForEach-Object { Remove-Item $_.FullName -Force }
