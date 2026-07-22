# Remove o serviço Windows do NexaOps Agent
param(
    [string]$InstallFolder = ""
)

$ServiceName = "NexaOpsAgent"
$ConfigDir = Join-Path $env:ProgramData "NexaOps Agent"

Write-Host "NexaOps Agent: removendo servico..."

& sc.exe stop $ServiceName 2>$null | Out-Null
Start-Sleep -Seconds 2
& sc.exe delete $ServiceName 2>$null | Out-Null

if (Test-Path $ConfigDir) {
    Remove-Item $ConfigDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "NexaOps Agent removido."
