#!/usr/bin/env python3
"""Create a task-scoped SQLite online-backup snapshot without writing the source."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import stat
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote


REAL_MODE = "REAL_READONLY_INVENTORY"
REAL_CONFIRMATION = "REAL_LOCAL_SQLITE_READONLY_SNAPSHOT"
TEST_MODE = "SYNTHETIC_READONLY_SNAPSHOT_TEST"
TEST_CONFIRMATION = "SYNTHETIC_READONLY_SNAPSHOT_TEST_ONLY"
TOOL_VERSION = "0.1.0-alpha.16"
AUTHORIZED_SOURCE = Path("/opt/erp/chenyida_erp_app/data/erp.sqlite3")
ROOT_MARKER = "chenyida_task04_readonly_"
TEST_ROOT_MARKER = "chenyida_task04_readonly_test_"
SNAPSHOT_NAME = "task04-source.snapshot.sqlite3"
MANIFEST_NAME = "snapshot-manifest.json"


class SnapshotError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def fail(code: str, message: str) -> None:
    raise SnapshotError(code, message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def schema_fingerprint(connection: sqlite3.Connection) -> str:
    rows = connection.execute(
        "SELECT type,name,tbl_name,coalesce(sql,'') FROM sqlite_master "
        "WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name,tbl_name"
    ).fetchall()
    encoded = json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def safe_root(path: Path, test_mode: bool) -> Path:
    if not path.is_absolute():
        fail("SNAPSHOT_PATH_NOT_ABSOLUTE", "输出目录必须为绝对路径")
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        fail("SNAPSHOT_ROOT_INVALID", "输出目录必须为非符号链接目录")
    if stat.S_IMODE(info.st_mode) != 0o700:
        fail("SNAPSHOT_ROOT_PERMISSION_INVALID", "输出目录权限必须为 0700")
    resolved = path.resolve(strict=True)
    temporary = Path(os.getenv("TMPDIR") or "/tmp").resolve(strict=True)
    if resolved.parent != temporary:
        fail("SNAPSHOT_ROOT_FORBIDDEN", "输出目录必须是系统临时目录的直接子目录")
    marker = TEST_ROOT_MARKER if test_mode else ROOT_MARKER
    if not resolved.name.startswith(marker):
        fail("SNAPSHOT_ROOT_MARKER_REQUIRED", "输出目录缺少 TASK04 标识")
    return resolved


def safe_source(path: Path, test_mode: bool) -> Path:
    if not path.is_absolute():
        fail("SNAPSHOT_SOURCE_NOT_ABSOLUTE", "SQLite 源必须为绝对路径")
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode):
        fail("SNAPSHOT_SOURCE_SYMLINK_FORBIDDEN", "SQLite 源不得为符号链接")
    if not stat.S_ISREG(info.st_mode):
        fail("SNAPSHOT_SOURCE_TYPE_INVALID", "SQLite 源必须为普通文件")
    resolved = path.resolve(strict=True)
    if test_mode:
        temporary = Path(os.getenv("TMPDIR") or "/tmp").resolve(strict=True)
        if resolved.parent.parent != temporary or not resolved.parent.name.startswith(TEST_ROOT_MARKER):
            fail("SNAPSHOT_TEST_SOURCE_FORBIDDEN", "合成测试源必须位于 TASK04 测试临时目录")
    else:
        if resolved != AUTHORIZED_SOURCE or resolved.parent != AUTHORIZED_SOURCE.parent:
            fail("SNAPSHOT_SOURCE_NOT_AUTHORIZED", "SQLite 源不是唯一获准路径")
        if any(part.lower() in {"backup", "backups", "test", "tests"} for part in resolved.parts):
            fail("SNAPSHOT_SOURCE_CLASS_FORBIDDEN", "禁止使用 backup 或测试数据库")
    return resolved


def create_snapshot(args: argparse.Namespace) -> dict[str, object]:
    test_mode = args.mode == TEST_MODE
    expected_confirmation = TEST_CONFIRMATION if test_mode else REAL_CONFIRMATION
    if args.confirm != expected_confirmation:
        fail("SNAPSHOT_CONFIRMATION_REQUIRED", f"需要确认文字 {expected_confirmation}")
    if args.tool_version != TOOL_VERSION:
        fail("SNAPSHOT_TOOL_VERSION_MISMATCH", "tool version 不匹配")
    if not args.no_materialize or not args.no_files:
        fail("SNAPSHOT_READONLY_FLAGS_REQUIRED", "必须显式设置 --no-materialize 和 --no-files")
    if not test_mode:
        if not args.git_commit or len(args.git_commit) != 40 or any(ch not in "0123456789abcdef" for ch in args.git_commit):
            fail("SNAPSHOT_GIT_COMMIT_INVALID", "Git commit 无效")
        if args.service_database_path != str(AUTHORIZED_SOURCE):
            fail("SNAPSHOT_SERVICE_PATH_MISMATCH", "systemd/Python 数据库路径与授权路径不一致")
        if args.service_pid <= 0 or not Path(f"/proc/{args.service_pid}").is_dir():
            fail("SNAPSHOT_SERVICE_PID_INVALID", "Python service PID 无效")

    root = safe_root(Path(args.output_root), test_mode)
    source = safe_source(Path(args.source), test_mode)
    snapshot = root / SNAPSHOT_NAME
    manifest_path = root / MANIFEST_NAME
    if snapshot.exists() or manifest_path.exists():
        fail("SNAPSHOT_OUTPUT_NOT_EMPTY", "快照输出已存在")
    before = source.stat()
    try:
        source_uri = f"file:{quote(str(source))}?mode=ro"
        source_db = sqlite3.connect(source_uri, uri=True, timeout=30)
        try:
            source_db.execute("PRAGMA query_only=ON")
            if source_db.execute("PRAGMA query_only").fetchone()[0] != 1:
                fail("SNAPSHOT_QUERY_ONLY_FAILED", "源连接未进入 query_only")
            destination = sqlite3.connect(snapshot)
            try:
                source_db.backup(destination, pages=256)
            finally:
                destination.close()
        finally:
            source_db.close()

        os.chmod(snapshot, 0o600)
        snapshot_db = sqlite3.connect(f"file:{quote(str(snapshot))}?mode=ro", uri=True)
        try:
            integrity_rows = snapshot_db.execute("PRAGMA integrity_check").fetchall()
            if integrity_rows != [("ok",)]:
                fail("SNAPSHOT_INTEGRITY_FAILED", "快照 integrity_check 未通过")
            page_count = int(snapshot_db.execute("PRAGMA page_count").fetchone()[0])
            page_size = int(snapshot_db.execute("PRAGMA page_size").fetchone()[0])
            fingerprint = schema_fingerprint(snapshot_db)
        finally:
            snapshot_db.close()
        after = source.stat()
        source_path_digest = hashlib.sha256(str(source).encode("utf-8")).hexdigest()
        manifest = {
            "schema_version": 1,
            "mode": REAL_MODE,
            "source_path_digest": source_path_digest,
            "snapshot_name": SNAPSHOT_NAME,
            "snapshot_sha256": sha256_file(snapshot),
            "snapshot_bytes": snapshot.stat().st_size,
            "page_count": page_count,
            "page_size": page_size,
            "sqlite_version": sqlite3.sqlite_version,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "integrity_check": "ok",
            "schema_fingerprint": fingerprint,
            "tool_version": TOOL_VERSION,
            "git_commit": args.git_commit if not test_mode else "0" * 40,
            "service_pid": args.service_pid if not test_mode else 0,
            "source_inode_unchanged": before.st_ino == after.st_ino,
            "source_mode_unchanged": before.st_mode == after.st_mode,
            "source_permissions_unchanged": stat.S_IMODE(before.st_mode) == stat.S_IMODE(after.st_mode),
        }
        temporary = manifest_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.chmod(temporary, 0o600)
        temporary.replace(manifest_path)
        return manifest
    except Exception:
        snapshot.unlink(missing_ok=True)
        manifest_path.unlink(missing_ok=True)
        raise


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser()
    result.add_argument("--mode", required=True, choices=[REAL_MODE, TEST_MODE])
    result.add_argument("--confirm", required=True)
    result.add_argument("--source", required=True)
    result.add_argument("--output-root", required=True)
    result.add_argument("--git-commit", default="")
    result.add_argument("--tool-version", required=True)
    result.add_argument("--service-pid", type=int, default=0)
    result.add_argument("--service-database-path", default="")
    result.add_argument("--no-materialize", action="store_true")
    result.add_argument("--no-files", action="store_true")
    return result


def main() -> int:
    try:
        manifest = create_snapshot(parser().parse_args())
        print(json.dumps({"state": "SNAPSHOT_READY", "snapshot_sha256": manifest["snapshot_sha256"], "schema_fingerprint": manifest["schema_fingerprint"]}))
        return 0
    except SnapshotError as error:
        print(json.dumps({"error": {"code": error.code, "message": str(error)}}), file=sys.stderr)
        return 1
    except Exception:
        print(json.dumps({"error": {"code": "SNAPSHOT_INTERNAL_ERROR", "message": "SQLite 快照失败"}}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
