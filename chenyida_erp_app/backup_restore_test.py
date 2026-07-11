import gc
import shutil
import tempfile
import time
from contextlib import closing

from environment_guard import prepare_test_environment


def main():
    temp_dir = tempfile.mkdtemp(prefix="chenyida-erp-test-")
    try:
        prepare_test_environment(temp_dir, "backup-restore.sqlite3")

        import server

        server.init_db()
        with closing(server.db_connect()) as conn:
            conn.execute(
                "INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)",
                ("TEST-BACKUP-MARKER", "TEST-BEFORE-BACKUP", server.now_text()),
            )
            conn.commit()
            backup = server.create_database_backup(conn, "TEST-BACKUP-VERIFY")
            assert backup["size"] > 0, backup

            conn.execute(
                "INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)",
                ("TEST-BACKUP-MARKER", "TEST-AFTER-BACKUP", server.now_text()),
            )
            conn.commit()

        restored = server.restore_database_backup(backup["name"])
        assert restored["name"] == backup["name"], restored
        with closing(server.db_connect()) as conn:
            after_restore = conn.execute(
                "SELECT COUNT(*) FROM activity_log WHERE detail = 'TEST-AFTER-BACKUP'"
            ).fetchone()[0]
            assert after_restore == 0, after_restore

        try:
            server.restore_database_backup("not-a-valid-backup-name.sqlite3")
        except ValueError as exc:
            assert "备份文件名不合法" in str(exc), exc
        else:
            raise AssertionError("非法备份名称应返回明确错误")

    finally:
        last_error = None
        for _ in range(10):
            gc.collect()
            try:
                shutil.rmtree(temp_dir)
                last_error = None
                break
            except PermissionError as exc:
                last_error = exc
                time.sleep(0.2)
        if last_error:
            raise RuntimeError(f"测试数据清理失败: {last_error}") from last_error

    print("BACKUP_RESTORE_TEST_OK")


if __name__ == "__main__":
    main()
