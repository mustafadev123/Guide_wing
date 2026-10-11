<#
.SYNOPSIS
  Stop the iMessage agent started by scripts\start_imessage_agent.ps1. Only the recorded process tree is stopped.
#>
$Root = Split-Path -Parent $PSScriptRoot
$PidFile = Join-Path $Root "run\imessage-agent.pid"
if (-not (Test-Path $PidFile)) { Write-Host "No recorded iMessage agent (run\imessage-agent.pid missing)."; exit 0 }
$id = [int](Get-Content $PidFile)
$p = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
if ($p -and $p.Name -eq "cmd.exe" -and $p.CommandLine -like "*src\main.ts*") {
    taskkill /PID $id /T /F | Out-Null
    Write-Host "Stopped iMessage agent (process tree of PID $id)."
} elseif ($p) {
    Write-Host "PID $id is not the iMessage agent ($($p.Name)); not stopping it."
} else {
    Write-Host "Recorded PID $id is not running."
}
Remove-Item $PidFile -Force
