import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path


APP_DIR = Path(__file__).resolve().parent
WORKSPACE = APP_DIR.parent
PYTHON = Path(sys.executable)
PORT = 8765
DATA_DIR = APP_DIR / "data"
PID_FILE = DATA_DIR / "server.pid"
LOG_FILE = DATA_DIR / "server.log"


def stop_existing():
    if not PID_FILE.exists():
        return
    try:
        pid = int(PID_FILE.read_text(encoding="utf-8").strip())
    except ValueError:
        PID_FILE.unlink(missing_ok=True)
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        try:
            os.kill(pid, 15)
        except OSError:
            pass
    PID_FILE.unlink(missing_ok=True)


def wait_until_ready():
    url = f"http://127.0.0.1:{PORT}/api/health"
    last_error = None
    for _ in range(20):
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                return response.read().decode("utf-8")
        except Exception as exc:
            last_error = exc
            time.sleep(0.5)
    raise RuntimeError(f"服务启动超时: {last_error}")


def main():
    DATA_DIR.mkdir(exist_ok=True)
    stop_existing()

    creationflags = 0
    if os.name == "nt":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS

    log = LOG_FILE.open("a", encoding="utf-8")
    proc = subprocess.Popen(
        [
            str(PYTHON),
            str(APP_DIR / "server.py"),
            "--host",
            "127.0.0.1",
            "--port",
            str(PORT),
            "--log-file",
            str(LOG_FILE),
        ],
        cwd=str(WORKSPACE),
        stdout=log,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        creationflags=creationflags,
    )
    PID_FILE.write_text(str(proc.pid), encoding="utf-8")
    summary = wait_until_ready()
    print(f"SERVER_STARTED http://127.0.0.1:{PORT}")
    print(summary)


if __name__ == "__main__":
    main()
