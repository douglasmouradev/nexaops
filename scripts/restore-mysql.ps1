# Restore MySQL NexaOps a partir de backup .zip ou .sql.gz
# Uso: .\scripts\restore-mysql.ps1 -BackupFile .\backups\nexaops-....zip
# ATENÇÃO: sobrescreve o banco atual.

param(
    [Parameter(Mandatory = $true)]
    [string]$BackupFile,
    [string]$DatabaseUrl = $env:DATABASE_URL
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $BackupFile)) { throw "Arquivo nao encontrado: $BackupFile" }

function Parse-DatabaseUrl([string]$url) {
    if ($url -match '^mysql://([^:]+):([^@]+)@([^:/]+)(?::(\d+))?/([^?]+)') {
        return @{
            User = $Matches[1]; Password = $Matches[2]; Host = $Matches[3]
            Port = $(if ($Matches[4]) { $Matches[4] } else { "3306" }); Database = $Matches[5]
        }
    }
    return @{
        User = $(if ($env:MYSQL_USER) { $env:MYSQL_USER } else { "nexaops" })
        Password = $(if ($env:MYSQL_PASSWORD) { $env:MYSQL_PASSWORD } else { "nexaops" })
        Host = $(if ($env:MYSQL_HOST) { $env:MYSQL_HOST } else { "127.0.0.1" })
        Port = $(if ($env:MYSQL_PORT) { $env:MYSQL_PORT } else { "3306" })
        Database = $(if ($env:MYSQL_DATABASE) { $env:MYSQL_DATABASE } else { "nexaops" })
    }
}

$cfg = Parse-DatabaseUrl $DatabaseUrl
$sqlFile = $null
$tempDir = Join-Path $env:TEMP "nexaops-restore-$(Get-Random)"

try {
    if ($BackupFile -like "*.zip") {
        New-Item -ItemType Directory -Path $tempDir | Out-Null
        Expand-Archive -Path $BackupFile -DestinationPath $tempDir -Force
        $sqlFile = Get-ChildItem $tempDir -Filter "*.sql" | Select-Object -First 1 -ExpandProperty FullName
    } elseif ($BackupFile -like "*.sql.gz") {
        throw "Use gunzip no Linux ou extraia .sql.gz antes. Prefira .zip gerado pelo backup-mysql.ps1"
    } elseif ($BackupFile -like "*.sql") {
        $sqlFile = $BackupFile
    } else {
        throw "Formato nao suportado (use .zip ou .sql)"
    }

    if (-not $sqlFile) { throw "Nenhum .sql no backup" }

    $mysql = Get-Command mysql -ErrorAction SilentlyContinue
    if (-not $mysql) {
        foreach ($c in @(
            "C:\xampp\mysql\bin\mysql.exe",
            "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
        )) {
            if (Test-Path $c) { $mysql = @{ Source = $c }; break }
        }
    }
    if (-not $mysql) { throw "mysql client nao encontrado" }

    Write-Host "RESTAURANDO $($cfg.Database) a partir de $sqlFile" -ForegroundColor Yellow
    Write-Host "Isso APAGA dados atuais do schema. Ctrl+C em 5s para cancelar..." -ForegroundColor Red
    Start-Sleep -Seconds 5

    $env:MYSQL_PWD = $cfg.Password
    Get-Content $sqlFile -Raw | & $mysql.Source -h $cfg.Host -P $cfg.Port -u $cfg.User $cfg.Database
    Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
    Write-Host "Restore concluido." -ForegroundColor Green
} finally {
    if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue }
}
