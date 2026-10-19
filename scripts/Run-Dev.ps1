<#
.SYNOPSIS
    Starts the Telemetry Deck locally (backend + frontend) in this console.
.DESCRIPTION
    Starts uvicorn on 127.0.0.1:8000 and the Vite dev server on :5173.
    Ctrl+C stops both. Everything is expected to be preinstalled:
      .venv\Scripts\python.exe   (with uvicorn)
      frontend\node_modules       (with vite)
.EXAMPLE
    .\Run-Deck.cmd
    powershell -ExecutionPolicy Bypass -File .\scripts\Run-Dev.ps1
#>
param(
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5173
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Backend = $null
$Frontend = $null
$ExitCode = 0

function Write-Step([string]$Text) { Write-Host "[deck] $Text" -ForegroundColor Cyan }

function Stop-ProcessTree([int]$ParentPid) {
    Get-CimInstance Win32_Process -Filter "ParentProcessId=$ParentPid" -ErrorAction SilentlyContinue |
        ForEach-Object {
            Stop-ProcessTree -ParentPid $_.ProcessId
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
}
function Write-Fail([string]$Text) { Write-Host "[deck] $Text" -ForegroundColor Red }

try {
    $PythonCandidates = @(
        (Join-Path $Root '.venv\Scripts\python.exe'),
        (Join-Path $Root 'backend\.venv\Scripts\python.exe')
    )
    $Python = $PythonCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $Python) { throw "No Python venv found (.venv\Scripts\python.exe)." }

    $Node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    if (-not $Node) { throw "node.exe not found on PATH." }

    $Vite = Join-Path $Root 'frontend\node_modules\vite\bin\vite.js'
    if (-not (Test-Path $Vite)) { throw "frontend\node_modules is missing. Run: npm install (in frontend)." }

    if (-not (Test-Path (Join-Path $Root '.env'))) {
        Copy-Item (Join-Path $Root '.env.example') (Join-Path $Root '.env')
        Write-Step "Created .env from .env.example - set TomTom_API_Key for traffic."
    }

    & $Python -c "import uvicorn" 2>$null
    if ($LASTEXITCODE -ne 0) { throw "uvicorn is not installed in $Python." }

    foreach ($p in @($BackendPort, $FrontendPort)) {
        if (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) {
            throw "Port $p is already in use. Close the other app or pass -BackendPort/-FrontendPort."
        }
    }

    $env:PYTHONUNBUFFERED = '1'
    $env:BACKEND_PROXY = "http://127.0.0.1:$BackendPort"

    Write-Step "Starting backend on http://127.0.0.1:$BackendPort"
    $Backend = Start-Process -FilePath $Python `
        -ArgumentList @('-m','uvicorn','app.main:app','--host','127.0.0.1','--port',"$BackendPort",'--reload') `
        -WorkingDirectory (Join-Path $Root 'backend') -NoNewWindow -PassThru

    $Healthy = $false
    for ($i = 0; $i -lt 60; $i++) {
        if ($Backend.HasExited) { throw "Backend exited during startup (code $($Backend.ExitCode))." }
        try {
            $resp = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$BackendPort/api/health" -TimeoutSec 2
            if ($resp.StatusCode -eq 200) { $Healthy = $true; break }
        } catch { }
        Start-Sleep -Seconds 1
    }
    if (-not $Healthy) { throw "Backend did not become healthy within 60 seconds." }
    Write-Step "Backend is healthy."

    Write-Step "Starting frontend on http://localhost:$FrontendPort"
    $Frontend = Start-Process -FilePath $Node `
        -ArgumentList ('"{0}" --port {1} --strictPort' -f $Vite, $FrontendPort) `
        -WorkingDirectory (Join-Path $Root 'frontend') -NoNewWindow -PassThru

    Write-Host ""
    Write-Host "  Deck ready:  http://localhost:$FrontendPort" -ForegroundColor Green
    Write-Host "  API health:  http://localhost:$FrontendPort/api/health" -ForegroundColor Green
    Write-Host "  Ctrl+C stops both." -ForegroundColor DarkGray
    Write-Host ""

    while ($true) {
        if ($Backend.HasExited) { throw "Backend stopped (exit code $($Backend.ExitCode))." }
        if ($Frontend.HasExited) { throw "Frontend stopped (exit code $($Frontend.ExitCode))." }
        Start-Sleep -Milliseconds 500
    }
}
catch {
    Write-Fail $_.Exception.Message
    $ExitCode = 1
}
finally {
    foreach ($proc in @($Frontend, $Backend)) {
        if ($null -ne $proc) {
            # Kill descendants first: a uvicorn reloader worker keeps the port
            # after its parent dies, and still points at the parent PID.
            Stop-ProcessTree -ParentPid $proc.Id
            if (-not $proc.HasExited) {
                & taskkill /PID $proc.Id /T /F 2>$null | Out-Null
            }
        }
    }
    Start-Sleep -Milliseconds 500
    # Safety net: a reloader/worker pair can outlive its parent on Windows.
    foreach ($port in @($FrontendPort, $BackendPort)) {
        Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    }
    Write-Step "Stopped."
}
exit $ExitCode
