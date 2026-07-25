#!/usr/bin/env python3
"""Run the single authorized TASK04 snapshot/inventory and always destroy runtime data."""

from __future__ import annotations

import json
import os
import re
import stat
import subprocess
import sys
import tempfile
from pathlib import Path


REPO = Path("/opt/erp")
SITE = REPO / "chenyida_erp_site"
SOURCE = REPO / "chenyida_erp_app/data/erp.sqlite3"
SNAPSHOT_SCRIPT = SITE / "scripts/readonly-sqlite-snapshot.py"
TOOL_VERSION = "0.1.0-alpha.14"


def command_output(arguments: list[str], cwd: Path | None = None) -> str:
    return subprocess.run(arguments, cwd=cwd, check=True, text=True, capture_output=True).stdout.strip()


def service_pid() -> int:
    return int(command_output(["systemctl", "show", "chenyida-erp", "--property=MainPID", "--value"]))


def source_identity() -> tuple[int, int, int]:
    info = SOURCE.stat()
    return info.st_ino, info.st_mode, stat.S_IMODE(info.st_mode)


def scan_reports(reports: list[dict[str, object]]) -> dict[str, bool]:
    serialized = json.dumps(reports, ensure_ascii=False)
    items = [item for report in reports for item in report.get("items", [])]
    return {
        "absolute_source_path_absent": str(SOURCE) not in serialized,
        "remote_url_absent": re.search(r"(?:postgres(?:ql)?|https?)://", serialized, re.I) is None,
        "phone_pattern_absent": re.search(r"1[3-9][0-9]{9}", serialized) is None,
        "credential_assignment_absent": re.search(r"(?:password|token|secret|authorization)\s*[:=]\s*[^\s,}]+", serialized, re.I) is None,
        "opaque_refs_valid": all(re.fullmatch(r"ref_[0-9a-f]{32}", str(item.get("opaque_reference", ""))) for item in items),
    }


def run() -> tuple[dict[str, object], Path]:
    temporary = tempfile.TemporaryDirectory(prefix="chenyida_task04_readonly_", dir="/tmp")
    root = Path(temporary.name)
    os.chmod(root, 0o700)
    setattr(run, "temporary", temporary)
    before_identity = source_identity()
    before_pid = service_pid()
    commit = command_output(["git", "rev-parse", "HEAD"], REPO)
    command_output([
        sys.executable, str(SNAPSHOT_SCRIPT),
        "--mode", "REAL_READONLY_INVENTORY",
        "--confirm", "REAL_LOCAL_SQLITE_READONLY_SNAPSHOT",
        "--source", str(SOURCE),
        "--output-root", str(root),
        "--git-commit", commit,
        "--tool-version", TOOL_VERSION,
        "--service-pid", str(before_pid),
        "--service-database-path", str(SOURCE),
        "--no-materialize", "--no-files",
    ], REPO)
    manifest_path = root / "snapshot-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    reports_directory = root / "reports"
    reports_directory.mkdir(mode=0o700)
    cli = subprocess.run([
        "docker", "run", "--rm", "--network", "none", "--read-only",
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
        "-e", "ERP_ENV=readonly-inventory",
        "-v", f"{REPO}:{REPO}:ro",
        "-v", f"{root}:{root}:rw",
        "-w", str(SITE),
        "node:22-bookworm",
        "node", "--experimental-strip-types", "tools/selfhost-migration/cli.mjs",
        "--mode", "REAL_READONLY_INVENTORY",
        "--confirm", "REAL_LOCAL_SQLITE_READONLY_INVENTORY",
        "--source-kind", "sqlite-snapshot",
        "--source", str(root / "task04-source.snapshot.sqlite3"),
        "--snapshot-manifest", str(manifest_path),
        "--source-sha256", manifest["snapshot_sha256"],
        "--git-commit", commit,
        "--tool-version", TOOL_VERSION,
        "--workspace", str(reports_directory),
        "--no-materialize", "true",
        "--no-files", "true",
    ], cwd=SITE, check=True, text=True, capture_output=True)
    summary = json.loads(cli.stdout)
    reports = [json.loads(path.read_text(encoding="utf-8")) for path in sorted(reports_directory.glob("*.json"))]
    checks = scan_reports(reports)
    if not all(checks.values()):
        raise RuntimeError("redaction scan failed")
    after_identity = source_identity()
    after_pid = service_pid()
    if before_identity != after_identity or before_pid != after_pid:
        raise RuntimeError("source identity or Python PID changed")
    evidence = {
        "state": summary["state"],
        "source_schema_fingerprint": summary["source_schema_fingerprint"],
        "source_snapshot_sha256": summary["source_snapshot_sha256"],
        "table_count": summary["table_count"],
        "total_records": summary["total_records"],
        "dry_run": summary["dry_run"],
        "domain_counts": summary["domain_counts"],
        "schema_summary": summary["schema_summary"],
        "mapping_summary": summary["mapping_summary"],
        "manual_disposition_count": summary["manual_disposition_count"],
        "redaction_scan": checks,
        "source_inode_unchanged": manifest["source_inode_unchanged"],
        "source_mode_unchanged": manifest["source_mode_unchanged"],
        "source_permissions_unchanged": manifest["source_permissions_unchanged"],
        "integrity_check": manifest["integrity_check"],
        "snapshot_bytes": manifest["snapshot_bytes"],
        "page_count": manifest["page_count"],
        "page_size": manifest["page_size"],
        "sqlite_version": manifest["sqlite_version"],
        "python_pid_before": before_pid,
        "python_pid_after": after_pid,
        "postgres_target_connection": "NONE",
        "materialized_records": 0,
        "file_bodies_read": 0,
    }
    return evidence, root


def main() -> int:
    root: Path | None = None
    temporary = None
    try:
        evidence, root = run()
        temporary = getattr(run, "temporary")
        temporary.cleanup()
        evidence["temporary_snapshot_deleted"] = not root.exists()
        evidence["temporary_snapshot_recoverable"] = False
        print(json.dumps(evidence, ensure_ascii=False, sort_keys=True))
        return 0
    except Exception:
        temporary = getattr(run, "temporary", temporary)
        if temporary is not None:
            root = Path(temporary.name)
            temporary.cleanup()
        print(json.dumps({"error": {"code": "TASK04_REAL_READONLY_FAILED", "message": "真实只读盘点失败"}, "temporary_snapshot_deleted": root is None or not root.exists()}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
