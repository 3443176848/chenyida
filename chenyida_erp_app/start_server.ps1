$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = "C:\Users\tu661\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
& $Python "$AppDir\start_background.py"
