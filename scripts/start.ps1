<#
.SYNOPSIS
  Start the GuideWing backend (which also serves the built web pages) on one port.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\start.ps1                 # webcam 0, loopback only
  powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -NoVision       # button-only workflow
  powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Video demo.mp4 # labeled REPLAY input
  powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Lan            # trusted LAN (Unreal on another laptop)
  powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Foreground     # logs in this window, Ctrl+C stops

Stop a background server with scripts\stop.ps1 (it stops only the PID this script recorded).
#>
param(
    [string]$Camera = "0",
    [string]$Video,
    [switch]$NoVision,
    [switch]$Lan,
    [int]$Port = 8000,
    [switch]$Rebuild,
    [switch]$Foreground
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Py = Join-Path $Root ".venv\Scripts\python.exe"
$Node = Join-Path $Root "tools\node"
$RunDir = Join-Path $Root "run"
$LogDir = Join-Path $Root "logs"
$PidFile = Join-Path $RunDir "backend.pid"

if (-not (Test-Path $Py)) { throw "Missing $Py. Run the setup steps in README.md first." }
New-Item -ItemType Directory -Force $RunDir, $LogDir | Out-Null

# Optional .env (git-ignored): KEY=VALUE lines for this process only. Values are never printed.
$EnvFile = Join-Path $Root ".env"
if (Test-Path $EnvFile) {
    $loaded = @()
    foreach ($line in Get-Content $EnvFile) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*(\s#.*)?$' -and $line -notmatch '^\s*#') {
            if ($Matches[2] -ne "") {
                [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim('"'), "Process")
                $loaded += $Matches[1]
            }
        }
    }
    if ($loaded) { Write-Host "Loaded from .env: $($loaded -join ', ')" }
}

# Refuse to start twice or on a busy port (shows who owns it).
if (Test-Path $PidFile) {
    $old = Get-Content $PidFile -ErrorAction SilentlyContinue
    if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) {
        throw "GuideWing backend already running (PID $old). Stop it with scripts\stop.ps1"
    }
    Remove-Item $PidFile -Force
}
$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($busy) {
    $owner = Get-Process -Id $busy.OwningProcess -ErrorAction SilentlyContinue
    throw "Port $Port is already in use by PID $($busy.OwningProcess) ($($owner.ProcessName)). Stop that process or pass -Port 8001."
}

# Build the web pages once (or with -Rebuild).
if ($Rebuild -or -not (Test-Path (Join-Path $Root "frontend\dist\index.html"))) {
    if (-not (Test-Path (Join-Path $Node "npm.cmd"))) { throw "Missing project-local Node at $Node. See README.md setup." }
    Write-Host "Building frontend..."
    $env:PATH = "$Node;$env:PATH"
    Push-Location (Join-Path $Root "frontend")
    try {
        if (-not (Test-Path "node_modules")) { & (Join-Path $Node "npm.cmd") ci --no-fund --no-audit }
        & (Join-Path $Node "npm.cmd") run build
        if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
    } finally { Pop-Location }
}

# Vision input selection (labeled honestly in the UI).
if ($NoVision) { $source = "" }
elseif ($Video) { $source = (Resolve-Path $Video).Path }
else { $source = $Camera }
$env:GUIDEWING_VISION_SOURCE = $source

$BindHost = if ($Lan) { "0.0.0.0" } else { "127.0.0.1" }
$uvArgs = @("-m", "uvicorn", "backend.app.main:create_default_app", "--factory", "--host", $BindHost, "--port", "$Port")

Write-Host ""
Write-Host "GuideWing backend" -ForegroundColor Cyan
Write-Host "  python : $Py"
Write-Host "  vision : $(if ($source) { $source } else { 'disabled (button-only)' })"
Write-Host "  bind   : ${BindHost}:$Port"
Write-Host "  user       http://127.0.0.1:$Port/user"
Write-Host "  responder  http://127.0.0.1:$Port/responder"
Write-Host "  2D view    http://127.0.0.1:$Port/sim"
Write-Host "  dev        http://127.0.0.1:$Port/dev"
Write-Host "  snapshot   http://127.0.0.1:$Port/api/simulation/state?journey_id=current"
if ($Lan) {
    Write-Host ""
    Write-Host "LAN mode: reachable by other devices on this network. Use only on a trusted network." -ForegroundColor Yellow
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.PrefixOrigin -in "Dhcp", "Manual" -and $_.IPAddress -notlike "169.254.*" } |
        ForEach-Object { Write-Host "  Unreal backend URL: http://$($_.IPAddress):$Port   ($($_.InterfaceAlias))" }
    Write-Host "  (Windows Firewall must allow inbound TCP $Port; campus Wi-Fi may block device-to-device traffic.)"
}
Write-Host ""

if ($Foreground) {
    & $Py @uvArgs
    exit $LASTEXITCODE
}

# Launch through cmd.exe with ShellExecute (no handle inheritance); cmd redirects logs to files.
# The recorded PID is the cmd.exe that owns the whole process tree, so stop.ps1 can end
# exactly this server (including the venv launcher's child python.exe) and nothing else.
$out = Join-Path $LogDir "backend.out.log"
$err = Join-Path $LogDir "backend.err.log"
$cmdLine = "/d /c `"`"$Py`" $($uvArgs -join ' ') 1> `"$out`" 2> `"$err`"`""
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList $cmdLine -WorkingDirectory $Root -PassThru -WindowStyle Hidden
Set-Content -Path $PidFile -Value $proc.Id

$deadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if ($proc.HasExited) { throw "Backend exited early. See logs\backend.err.log" }
    try {
        $h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
        Write-Host "Backend up (PID $($proc.Id), boot $($h.boot_id.Substring(0,8))). Logs: logs\backend.err.log" -ForegroundColor Green
        Write-Host "Stop with: powershell -ExecutionPolicy Bypass -File scripts\stop.ps1"
        exit 0
    } catch { }
}
throw "Backend did not answer /api/health within 45 s. See logs\backend.err.log"
