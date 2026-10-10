<#
.SYNOPSIS
  One-time project-local setup: .venv, Python packages, portable Node, frontend packages, models.
  Nothing is installed globally.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Py = Join-Path $Root ".venv\Scripts\python.exe"
$NodeVersion = "v24.21.0"
$NodeDir = Join-Path $Root "tools\node"

if (-not (Test-Path $Py)) {
    Write-Host "Creating .venv with Python 3.14 (py launcher)..."
    py -3.14 -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw "py -3.14 failed. Install Python 3.14 or edit this script to use 3.12/3.13." }
}
& $Py -m pip install --upgrade pip
& $Py -m pip install torch==2.14.1 torchvision==0.29.1 --index-url https://download.pytorch.org/whl/cpu
& $Py -m pip install -r requirements.txt
& $Py -m pip install --no-deps ultralytics==8.4.175
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

if (-not (Test-Path (Join-Path $NodeDir "node.exe"))) {
    Write-Host "Downloading portable Node $NodeVersion into tools\node ..."
    New-Item -ItemType Directory -Force (Join-Path $Root "tools") | Out-Null
    $zip = Join-Path $Root "tools\node.zip"
    $name = "node-$NodeVersion-win-x64"
    Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/$name.zip" -OutFile $zip
    $sums = (Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/SHASUMS256.txt" -UseBasicParsing).Content
    $expected = ($sums -split "`n" | Where-Object { $_ -match "$name.zip" }) -split "\s+" | Select-Object -First 1
    $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $expected) { throw "Node checksum mismatch" }
    Expand-Archive $zip -DestinationPath (Join-Path $Root "tools")
    Rename-Item (Join-Path $Root "tools\$name") $NodeDir
    Remove-Item $zip
}
$env:PATH = "$NodeDir;$env:PATH"
Push-Location frontend
& (Join-Path $NodeDir "npm.cmd") ci --no-fund --no-audit
& (Join-Path $NodeDir "npm.cmd") run build
Pop-Location

& $Py scripts\download_models.py
& $Py scripts\check_environment.py
