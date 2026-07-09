$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Workspace = Split-Path -Parent $AppDir
$Python = "C:\Users\tu661\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$DataDir = Join-Path $AppDir "data"
$PidFile = Join-Path $DataDir "server.pid"
$LogFile = Join-Path $DataDir "server.log"
$Port = 8765
$HealthUrl = "http://127.0.0.1:$Port/api/health"

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

if (Test-Path -LiteralPath $PidFile) {
  $ExistingPid = [int](Get-Content -LiteralPath $PidFile)
  $ExistingProcess = Get-Process -Id $ExistingPid -ErrorAction SilentlyContinue
  if ($ExistingProcess) {
    Stop-Process -Id $ExistingPid -Force
    Start-Sleep -Milliseconds 500
  }
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

$Connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($Connection) {
  Stop-Process -Id $Connection.OwningProcess -Force
  Start-Sleep -Milliseconds 500
}

$Arguments = @(
  "$AppDir\server.py",
  "--host", "127.0.0.1",
  "--port", "$Port",
  "--log-file", "$LogFile"
)

$Process = Start-Process -FilePath $Python -ArgumentList $Arguments -WorkingDirectory $Workspace -WindowStyle Hidden -PassThru
$Process.Id | Out-File -FilePath $PidFile -Encoding utf8 -Force

$LastError = $null
for ($Index = 0; $Index -lt 30; $Index++) {
  try {
    $Response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 2
    Write-Host "SERVER_STARTED http://127.0.0.1:$Port"
    Write-Host $Response.Content
    exit 0
  } catch {
    $LastError = $_.Exception.Message
    Start-Sleep -Milliseconds 500
  }
}

Write-Host "SERVER_START_FAILED $LastError"
Write-Host "查看日志: $LogFile"
exit 1
