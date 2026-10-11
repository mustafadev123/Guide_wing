<#
.SYNOPSIS
  Start the GuideWing iMessage agent (Photon Spectrum) with the project-local Node.
  The GuideWing backend must already be running (scripts\start.ps1).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\start_imessage_agent.ps1              # background, iMessage
  powershell -ExecutionPolicy Bypass -File scripts\start_imessage_agent.ps1 -Foreground  # logs in this window
  powershell -ExecutionPolicy Bypass -File scripts\start_imessage_agent.ps1 -Terminal    # local chat, no Photon account

Stop a background agent with scripts\stop_imessage_agent.ps1 (stops only the recorded process tree).
#>
param([switch]$Foreground, [switch]$Terminal)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Agent = Join-Path $Root "imessage-agent"
$Node = Join-Path $Root "tools\node\node.exe"
$RunDir = Join-Path $Root "run"; $LogDir = Join-Path $Root "logs"
$PidFile = Join-Path $RunDir "imessage-agent.pid"

if (-not (Test-Path $Node)) { throw "Missing project-local Node at $Node. Run scripts\setup.ps1 first." }
if (-not (Test-Path (Join-Path $Agent "node_modules\spectrum-ts"))) {
    Write-Host "Installing agent packages (project-local)..."
    $env:PATH = "$(Split-Path $Node);$env:PATH"
    Push-Location $Agent
    try { & (Join-Path (Split-Path $Node) "npm.cmd") ci --no-fund --no-audit } finally { Pop-Location }
}
if (-not $Terminal -and -not (Test-Path (Join-Path $Agent ".env"))) {
    throw "Missing imessage-agent\.env. Copy imessage-agent\.env.example and fill in the Photon project values and your iPhone number."
}
try { Invoke-RestMethod "http://127.0.0.1:8000/api/health" -TimeoutSec 3 | Out-Null }
catch { Write-Warning "GuideWing backend is not answering on 127.0.0.1:8000. Start it first: scripts\start.ps1" }

New-Item -ItemType Directory -Force $RunDir, $LogDir | Out-Null
if (Test-Path $PidFile) {
    $old = Get-Content $PidFile -ErrorAction SilentlyContinue
    if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) { throw "iMessage agent already running (PID $old). Stop it with scripts\stop_imessage_agent.ps1" }
    Remove-Item $PidFile -Force
}

$mode = if ($Terminal) { "--terminal" } else { "" }
if ($Foreground -or $Terminal) {
    Push-Location $Agent
    try { & $Node src\main.ts $mode } finally { Pop-Location }
    exit $LASTEXITCODE
}
$log = Join-Path $LogDir "imessage-agent.log"
$cmdLine = "/d /c `"`"$Node`" src\main.ts 1> `"$log`" 2>&1`""
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList $cmdLine -WorkingDirectory $Agent -PassThru -WindowStyle Hidden
Set-Content -Path $PidFile -Value $proc.Id
Start-Sleep 4
if ($proc.HasExited) { throw "Agent exited early. See logs\imessage-agent.log" }
Write-Host "iMessage agent running (PID $($proc.Id)). Log: logs\imessage-agent.log" -ForegroundColor Green
Write-Host "Text the assigned Photon iMessage line from the registered iPhone. Stop with: powershell -ExecutionPolicy Bypass -File scripts\stop_imessage_agent.ps1"
