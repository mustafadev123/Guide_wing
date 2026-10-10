<#
.SYNOPSIS
  Type-check and build the frontend with the project-local Node (tools\node). Nothing global.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\build_frontend.ps1
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Node = Join-Path $Root "tools\node"
if (-not (Test-Path (Join-Path $Node "node.exe"))) { throw "Missing $Node. Run scripts\setup.ps1 first." }
$env:PATH = "$Node;$env:PATH"   # this process only
Push-Location (Join-Path $Root "frontend")
try {
    if (-not (Test-Path "node_modules")) { & (Join-Path $Node "npm.cmd") ci --no-fund --no-audit }
    & (Join-Path $Node "npm.cmd") run build
    if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
} finally { Pop-Location }
