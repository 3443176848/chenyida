$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $AppDir "data\server.pid"
$Port = 18888

if (-not (Test-Path -LiteralPath $PidFile)) {
  $Connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($Connection) {
    Stop-Process -Id $Connection.OwningProcess -Force
    Write-Host "SERVER_STOPPED_BY_PORT"
  } else {
    Write-Host "SERVER_NOT_RUNNING"
  }
  return
}

$ProcessId = [int](Get-Content -LiteralPath $PidFile)
$Process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue

if ($Process) {
  Stop-Process -Id $ProcessId -Force
  Write-Host "SERVER_STOPPED"
} else {
  $Connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($Connection) {
    Stop-Process -Id $Connection.OwningProcess -Force
    Write-Host "SERVER_STOPPED_BY_PORT"
  } else {
    Write-Host "SERVER_PID_NOT_FOUND"
  }
}

Remove-Item -LiteralPath $PidFile -Force
