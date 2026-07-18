$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = "C:\Users\tu661\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

Write-Host "Open http://127.0.0.1:18888 after the server starts."
Write-Host "Keep this window open while using the app. Press Ctrl+C to stop."
& $Python "$AppDir\server.py" --host 127.0.0.1 --port 18888
