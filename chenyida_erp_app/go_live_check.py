import argparse
import json
import sys
import urllib.request
from contextlib import closing

import server


def check_http_health(host, port):
    url = f"http://{host}:{port}/api/health"
    try:
        with urllib.request.urlopen(url, timeout=3) as response:
            payload = json.loads(response.read().decode("utf-8"))
            return True, payload
    except Exception as exc:
        return False, str(exc)


def main():
    parser = argparse.ArgumentParser(description="晨亿达 ERP 上线检查")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--require-running", action="store_true", help="要求本地服务已启动")
    parser.add_argument("--no-backup", action="store_true", help="只检查数据库，不创建备份")
    args = parser.parse_args()

    checks = []
    errors = []

    try:
        server.init_db()
        checks.append(f"数据库已初始化: {server.DB_PATH}")
    except Exception as exc:
        errors.append(f"数据库初始化失败: {exc}")

    if not errors:
        with closing(server.db_connect()) as conn:
            summary = server.api_summary(conn)
            if summary["total_items"] < 4:
                errors.append("内部物料基础数据不足")
            else:
                checks.append(f"内部物料: {summary['total_items']} 条")

            admin = conn.execute("SELECT username FROM app_users WHERE username = 'admin' AND is_active = 1").fetchone()
            if not admin:
                errors.append("管理员账号 admin 不存在或未启用")
            else:
                checks.append("管理员账号: admin 已启用")

            if not args.no_backup:
                backup = server.create_database_backup(conn, "go_live_check")
                checks.append(f"数据库备份已创建: {backup['name']}")

    running, health = check_http_health(args.host, args.port)
    if running:
        checks.append(f"服务健康检查通过: http://{args.host}:{args.port}")
    elif args.require_running:
        errors.append(f"服务未启动或健康检查失败: {health}")
    else:
        checks.append("服务未启动；可运行 start_server.ps1 后再检查")

    if errors:
        print("GO_LIVE_CHECK_FAILED")
        for error in errors:
            print(f"- {error}")
        return 1

    print("GO_LIVE_CHECK_OK")
    for check in checks:
        print(f"- {check}")
    print("- 登录地址: http://127.0.0.1:8765")
    print("- 首次投用请用 admin / admin123 登录后立即修改密码")
    return 0


if __name__ == "__main__":
    sys.exit(main())
