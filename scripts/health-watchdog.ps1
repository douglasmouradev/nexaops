# Watchdog Windows: monitora /health e posta webhook se cair.
# Agende no Task Scheduler a cada 2 minutos.
# Env: HEALTH_URL, WATCHDOG_WEBHOOK_URL

param(
    [string]$HealthUrl = $(if ($env:HEALTH_URL) { $env:HEALTH_URL } else { "http://127.0.0.1:3001/health" }),
    [string]$WebhookUrl = $env:WATCHDOG_WEBHOOK_URL,
    [string]$StateFile = $(Join-Path $env:TEMP "nexaops-health-state.txt")
)

function Notify([string]$msg) {
    Write-Host "[watchdog] $msg"
    if ($WebhookUrl) {
        try {
            Invoke-RestMethod -Uri $WebhookUrl -Method Post -ContentType "application/json" `
                -Body (@{ text = "NexaOps watchdog: $msg" } | ConvertTo-Json) | Out-Null
        } catch { }
    }
}

$prev = if (Test-Path $StateFile) { (Get-Content $StateFile -Raw).Trim() } else { "ok" }

try {
    $res = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 8
    $json = $res.Content | ConvertFrom-Json
    $ok = $res.StatusCode -eq 200 -and $json.status -eq "ok"
} catch {
    $ok = $false
}

if (-not $ok) {
    Set-Content $StateFile "down"
    if ($prev -ne "down") { Notify "API DOWN — $HealthUrl" }
    exit 1
}

Set-Content $StateFile "ok"
if ($prev -eq "down") { Notify "API recuperou — $HealthUrl" }
exit 0
