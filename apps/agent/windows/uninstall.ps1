# Remove tarefa agendada / servico legado do NexaOps Agent
param(
    [string]$InstallFolder = ""
)

$TaskName = "NexaOpsAgent"
$LegacyService = "NexaOpsAgent"
$ConfigDir = Join-Path $env:ProgramData "NexaOps Agent"

Write-Host "NexaOps Agent: removendo..."

# Para processos do agent
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like '*NexaOps*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$svc = Get-Service -Name $LegacyService -ErrorAction SilentlyContinue
if ($svc) {
    if ($svc.Status -eq 'Running') { Stop-Service -Name $LegacyService -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 1
    & sc.exe delete $LegacyService 2>$null | Out-Null
}

if (Test-Path $ConfigDir) {
    Remove-Item $ConfigDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "NexaOps Agent removido."
