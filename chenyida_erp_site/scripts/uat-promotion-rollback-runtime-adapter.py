#!/usr/bin/python3
"""Fail-closed gateway for the separately activated UAT rollback executor.

The gateway validates the content-addressed Supervisor request, the per-operation
activation plan, fixed tool identities, and the executor response.  It does not
contain database, volume, or Compose mutation logic itself.  Until an approved
root-owned activation and the fixed executor are installed, PREFLIGHT fails before
authorization consumption.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import ctypes
import selectors
import signal
import stat
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


ACTIVATION_FILE = Path(
    "/var/lib/chenyida-erp-release-supervisor/uat-rollback-runtime-adapter/activation-v1.json"
)
EXECUTOR_FILE = Path("/usr/local/libexec/chenyida-erp-uat-rollback-executor-v1")
DOCKER_FILE = Path("/usr/bin/docker")
GLOBAL_LOCK = Path("/run/lock/chenyida-erp-release-gate-v1.lock")
SUPERVISOR_BUNDLE_ROOT = Path("/usr/local/libexec/chenyida-erp-release-supervisor/bundles")
REQUEST_CONTRACT = "chenyida-erp-uat-promotion-rollback-runtime-request/v1"
RESPONSE_CONTRACT = "chenyida-erp-uat-promotion-rollback-runtime-response/v1"
ACTIVATION_CONTRACT = "chenyida-erp-uat-promotion-rollback-runtime-activation/v1"
PLAN_CONTRACT = "chenyida-erp-uat-promotion-rollback-runtime-plan/v1"
PACKAGE_CONTRACT = "chenyida-erp-uat-promotion-rollback-execution-package/v2"
MAX_BYTES = 4 * 1024 * 1024
ZERO_SHA256 = "0" * 64
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}\Z")
LABEL = re.compile(r"[A-Z][A-Z0-9_]{1,79}\Z")
ISO_UTC = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\Z")
COMMIT = re.compile(r"[0-9a-f]{40}\Z")
VERSION = re.compile(r"0\.1\.0-alpha\.\d+\Z")
MIGRATION = re.compile(r"\d{4}_[a-z0-9_]+\.sql\Z")
CONTAINER_ID = re.compile(r"[0-9a-f]{64}\Z")
IMAGE_DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
IMAGE_REFERENCE = re.compile(
    r"[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?"
    r"(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[0-9a-f]{64}\Z"
)
DATABASE_IDENTIFIER = re.compile(r"[a-z][a-z0-9_]{0,62}\Z")
DOCKER_NAME = re.compile(r"[a-z0-9][a-z0-9_.-]{0,127}\Z")
TIMEOUTS = {
    "PREFLIGHT": 120, "RECHECK": 120, "PREPARE": 120,
    "EXECUTE": 1800, "PROBE": 300, "CONTAIN": 300,
}
STAGES = (
    "PRECONDITION_RECHECK",
    "WRITER_CONTAINMENT",
    "POSTGRESQL_RESTORE",
    "UPLOADS_RESTORE",
    "ATTACHMENTS_RESTORE",
    "BACKUP_STATUS_RESTORE",
    "RUNTIME_CONFIGURATION_RESTORE",
    "WEB_WORKER_PREDECESSOR_ACTIVATION",
    "PROTECTED_RESOURCE_RECHECK",
)
CHECKS = (
    "POSTGRESQL_CONTENT",
    "UPLOADS_CONTENT",
    "ATTACHMENTS_CONTENT",
    "BACKUP_STATUS_CONTENT",
    "MIGRATION_HEAD",
    "CADDY_IDENTITY",
    "POSTGRES_IDENTITY",
    "WEB_IDENTITY",
    "WORKER_IDENTITY",
    "RUNTIME_CONFIGURATION",
    "STRICT_RELEASE_IDENTITY",
    "HEALTH",
    "PROTECTED_RESOURCES",
)
ACTION_MATRIX = {
    "ROLLBACK_EXECUTION": {stage: ["PREPARE", "EXECUTE", "PROBE"] for stage in STAGES},
    "ROLLBACK_POSTVERIFY": {check: ["PREPARE", "PROBE"] for check in CHECKS},
    "RECOVERY": ["PREFLIGHT", "RECHECK", "PROBE", "CONTAIN"],
}
PACKAGE_SOURCE_ROLES = (
    "snapshot_readiness",
    "snapshot_manifest",
    "snapshot_migrations",
    "snapshot_reconciliation",
    "snapshot_postgresql",
    "snapshot_uploads",
    "snapshot_attachments",
    "snapshot_backup_status",
    "snapshot_policy",
    "snapshot_policy_activation",
    "predecessor_postdeploy_receipt",
    "predecessor_release_manifest",
    "candidate_deployment_result",
    "candidate_postdeploy_identity",
    "compose_file",
    "compose_release_file",
    "deployment_environment",
    "runtime_policy",
    "runtime_adapter_activation",
)
SOURCE_FIELDS = {"path", "sha256", "bytes", "device", "inode", "uid", "gid", "mode", "nlink"}
STAGE_SOURCE_ROLES = {
    "PRECONDITION_RECHECK": (
        "snapshot_readiness", "snapshot_manifest", "snapshot_migrations", "snapshot_reconciliation",
        "snapshot_policy", "snapshot_policy_activation", "predecessor_postdeploy_receipt",
        "predecessor_release_manifest", "candidate_deployment_result", "candidate_postdeploy_identity",
        "compose_file", "compose_release_file", "deployment_environment", "runtime_policy",
    ),
    "WRITER_CONTAINMENT": ("candidate_deployment_result", "candidate_postdeploy_identity"),
    "POSTGRESQL_RESTORE": (
        "snapshot_readiness", "snapshot_manifest", "snapshot_migrations", "snapshot_reconciliation",
        "snapshot_postgresql", "snapshot_policy", "snapshot_policy_activation",
    ),
    "UPLOADS_RESTORE": ("snapshot_manifest", "snapshot_uploads"),
    "ATTACHMENTS_RESTORE": ("snapshot_manifest", "snapshot_attachments"),
    "BACKUP_STATUS_RESTORE": ("snapshot_manifest", "snapshot_backup_status"),
    "RUNTIME_CONFIGURATION_RESTORE": (
        "compose_file", "compose_release_file", "deployment_environment", "runtime_policy",
    ),
    "WEB_WORKER_PREDECESSOR_ACTIVATION": (
        "predecessor_postdeploy_receipt", "predecessor_release_manifest", "compose_file",
        "compose_release_file", "deployment_environment", "runtime_policy",
    ),
    "PROTECTED_RESOURCE_RECHECK": ("candidate_deployment_result", "candidate_postdeploy_identity"),
}
CHECK_SOURCE_ROLES = {
    "POSTGRESQL_CONTENT": (
        "snapshot_postgresql", "snapshot_manifest", "snapshot_migrations", "snapshot_reconciliation",
    ),
    "UPLOADS_CONTENT": ("snapshot_uploads", "snapshot_manifest", "snapshot_reconciliation"),
    "ATTACHMENTS_CONTENT": ("snapshot_attachments", "snapshot_manifest", "snapshot_reconciliation"),
    "BACKUP_STATUS_CONTENT": ("snapshot_backup_status", "snapshot_manifest", "snapshot_reconciliation"),
    "MIGRATION_HEAD": ("snapshot_migrations", "predecessor_release_manifest"),
    "CADDY_IDENTITY": ("candidate_deployment_result",),
    "POSTGRES_IDENTITY": ("candidate_deployment_result",),
    "WEB_IDENTITY": ("predecessor_postdeploy_receipt", "predecessor_release_manifest"),
    "WORKER_IDENTITY": ("predecessor_postdeploy_receipt", "predecessor_release_manifest"),
    "RUNTIME_CONFIGURATION": ("deployment_environment", "runtime_policy"),
    "STRICT_RELEASE_IDENTITY": ("predecessor_postdeploy_receipt", "predecessor_release_manifest"),
    "HEALTH": ("predecessor_postdeploy_receipt",),
    "PROTECTED_RESOURCES": ("candidate_deployment_result", "candidate_postdeploy_identity"),
}


class AdapterError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def reject(code: str) -> None:
    raise AdapterError(code)


def exact(value: Any, fields: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != fields:
        reject(code)
    return value


def strict_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            reject("ROLLBACK_RUNTIME_JSON_DUPLICATE_KEY")
        value[key] = item
    return value


def strict_integer(token: str) -> int:
    if token == "-0":
        reject("ROLLBACK_RUNTIME_JSON_INVALID")
    value = int(token, 10)
    if not -(2**53 - 1) <= value <= 2**53 - 1:
        reject("ROLLBACK_RUNTIME_JSON_INVALID")
    return value


def reject_json_number(_token: str) -> None:
    reject("ROLLBACK_RUNTIME_JSON_INVALID")


def validate_json_value(value: Any) -> None:
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, int):
        if not -(2**53 - 1) <= value <= 2**53 - 1:
            reject("ROLLBACK_RUNTIME_JSON_INVALID")
        return
    if isinstance(value, str):
        try:
            value.encode("utf-8", "strict")
        except UnicodeError:
            reject("ROLLBACK_RUNTIME_JSON_INVALID")
        return
    if isinstance(value, list):
        for item in value:
            validate_json_value(item)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                reject("ROLLBACK_RUNTIME_JSON_INVALID")
            validate_json_value(key)
            validate_json_value(item)
        return
    reject("ROLLBACK_RUNTIME_JSON_INVALID")


def parse_json(raw: bytes, code: str) -> Any:
    if not 2 <= len(raw) <= MAX_BYTES:
        reject(code)
    try:
        value = json.loads(
            raw.decode("utf-8"), object_pairs_hook=strict_pairs,
            parse_int=strict_integer, parse_float=reject_json_number,
            parse_constant=reject_json_number,
        )
        validate_json_value(value)
        return value
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError, TypeError, AdapterError):
        reject(code)


def canonical(value: Any) -> bytes:
    try:
        validate_json_value(value)
        return (
            json.dumps(
                value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
            ) + "\n"
        ).encode("utf-8")
    except (TypeError, ValueError, UnicodeError):
        reject("ROLLBACK_RUNTIME_JSON_INVALID")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_value(value: Any) -> str:
    return sha256_bytes(canonical(value))


def without(value: dict[str, Any], field: str) -> dict[str, Any]:
    return {key: item for key, item in value.items() if key != field}


def digest(value: Any, code: str, *, allow_zero: bool = False) -> str:
    if not isinstance(value, str) or SHA256.fullmatch(value) is None or (not allow_zero and value == ZERO_SHA256):
        reject(code)
    return value


def identifier(value: Any, code: str) -> str:
    if not isinstance(value, str) or IDENTIFIER.fullmatch(value) is None:
        reject(code)
    return value


def safe_integer(value: Any, minimum: int, maximum: int, code: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        reject(code)
    return value


def matching_string(value: Any, pattern: re.Pattern[str], code: str) -> str:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        reject(code)
    return value


def normalized_absolute(value: Any, code: str) -> str:
    if not isinstance(value, str) or not value.startswith("/") or value == "/" \
            or "\0" in value or str(Path(value)) != value or ".." in Path(value).parts:
        reject(code)
    return value


def instant(value: Any, code: str) -> datetime:
    if not isinstance(value, str) or ISO_UTC.fullmatch(value) is None:
        reject(code)
    try:
        observed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        reject(code)
    if observed.tzinfo is None:
        reject(code)
    return observed.astimezone(timezone.utc)


def test_root() -> Path | None:
    if os.environ.get("CHENYIDA_ERP_ROLLBACK_ADAPTER_TEST_MODE") != "YES":
        return None
    raw = os.environ.get("CHENYIDA_ERP_ROLLBACK_ADAPTER_TEST_ROOT", "")
    root = Path(raw)
    if not root.is_absolute() or root == Path("/") or ".." in root.parts:
        reject("ROLLBACK_RUNTIME_TEST_ROOT_INVALID")
    resolved = root.resolve(strict=True)
    if not resolved.is_dir() or not str(resolved).startswith("/tmp/"):
        reject("ROLLBACK_RUNTIME_TEST_ROOT_INVALID")
    return resolved


def physical(logical: Path, root: Path | None) -> Path:
    if not logical.is_absolute() or ".." in logical.parts:
        reject("ROLLBACK_RUNTIME_PATH_INVALID")
    if root is None:
        return logical
    return root.joinpath(*logical.parts[1:])


def mode_text(metadata: os.stat_result) -> str:
    return f"{stat.S_IMODE(metadata.st_mode):04o}"


def trusted_source(
    spec: Any, root: Path | None, code: str,
) -> tuple[bytes, tuple[Path, tuple[Any, ...], int]]:
    exact(spec, SOURCE_FIELDS, code)
    logical = Path(spec["path"] if isinstance(spec.get("path"), str) else "")
    if not logical.is_absolute() or str(logical) != spec.get("path") or logical == Path("/"):
        reject(code)
    digest(spec.get("sha256"), code)
    if not isinstance(spec.get("bytes"), int) or not 1 <= spec["bytes"] <= 2**53 - 1:
        reject(code)
    if spec.get("uid") != 0 or not isinstance(spec.get("gid"), int) or spec["gid"] < 0 \
            or spec.get("nlink") != 1 or spec.get("mode") not in {"0400", "0440", "0444"}:
        reject(code)
    target = physical(logical, root)
    trusted_parent_chain(target, root, code)
    descriptor = -1
    try:
        before = target.lstat()
        descriptor = os.open(target, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError:
        reject(code)
    try:
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or stat.S_ISLNK(before.st_mode) \
                or before.st_uid != spec["uid"] or before.st_gid != spec["gid"] \
                or before.st_nlink != spec["nlink"] or mode_text(before) != spec["mode"] \
                or str(before.st_dev) != spec.get("device") or str(before.st_ino) != spec.get("inode") \
                or before.st_size != spec["bytes"] or opened.st_dev != before.st_dev \
                or opened.st_ino != before.st_ino:
            reject(code)
        result = bytearray()
        hashed = hashlib.sha256()
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            hashed.update(chunk)
            if len(result) <= MAX_BYTES:
                result.extend(chunk)
        after_fd = os.fstat(descriptor)
        after_path = target.lstat()
        identity = (
            opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns,
            opened.st_ctime_ns, stat.S_IMODE(opened.st_mode), hashed.hexdigest(),
        )
        if after_fd.st_dev != opened.st_dev or after_fd.st_ino != opened.st_ino \
                or after_fd.st_size != opened.st_size or after_fd.st_mtime_ns != opened.st_mtime_ns \
                or after_fd.st_ctime_ns != opened.st_ctime_ns or after_path.st_dev != opened.st_dev \
                or after_path.st_ino != opened.st_ino or hashed.hexdigest() != spec["sha256"]:
            reject(f"{code}_CHANGED")
        os.lseek(descriptor, 0, os.SEEK_SET)
        return bytes(result) if spec["bytes"] <= MAX_BYTES else b"", (target, identity, descriptor)
    except Exception:
        if descriptor >= 0:
            os.close(descriptor)
        raise


def trusted_tool(
    tool: Any, expected_path: Path, root: Path | None, code: str,
) -> tuple[Path, tuple[Any, ...], int]:
    exact(tool, {"path", "sha256", "uid", "gid", "mode"}, code)
    if tool.get("path") != str(expected_path) or tool.get("uid") != 0 or tool.get("gid") != 0 \
            or tool.get("mode") != "0555":
        reject(code)
    expected_sha = digest(tool.get("sha256"), code)
    target = physical(expected_path, root)
    trusted_parent_chain(target, root, code)
    descriptor = -1
    try:
        metadata = target.lstat()
    except OSError:
        reject(code)
    if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) or metadata.st_uid != 0 \
            or metadata.st_gid != 0 or metadata.st_nlink != 1 or mode_text(metadata) != "0555":
        reject(code)
    hashed = hashlib.sha256()
    try:
        descriptor = os.open(target, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            hashed.update(chunk)
        opened = os.fstat(descriptor)
    except OSError:
        if descriptor >= 0:
            os.close(descriptor)
        reject(code)
    identity = (
        metadata.st_dev, metadata.st_ino, metadata.st_size, metadata.st_mtime_ns,
        metadata.st_ctime_ns, stat.S_IMODE(metadata.st_mode), hashed.hexdigest(),
    )
    if opened.st_dev != metadata.st_dev or opened.st_ino != metadata.st_ino \
            or hashed.hexdigest() != expected_sha:
        os.close(descriptor)
        reject(code)
    os.lseek(descriptor, 0, os.SEEK_SET)
    return target, identity, descriptor


def recheck_open_file(target: Path, identity: tuple[Any, ...], descriptor: int, code: str) -> None:
    try:
        metadata = target.lstat()
    except OSError:
        reject(code)
    hashed = hashlib.sha256()
    try:
        os.lseek(descriptor, 0, os.SEEK_SET)
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            hashed.update(chunk)
        opened = os.fstat(descriptor)
        os.lseek(descriptor, 0, os.SEEK_SET)
    except OSError:
        reject(code)
    observed = (
        metadata.st_dev, metadata.st_ino, metadata.st_size, metadata.st_mtime_ns,
        metadata.st_ctime_ns, stat.S_IMODE(metadata.st_mode), hashed.hexdigest(),
    )
    if observed != identity or not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        reject(code)
    if opened.st_dev != metadata.st_dev or opened.st_ino != metadata.st_ino:
        reject(code)


def derive_targets(operation_id: str) -> dict[str, Any]:
    token = sha256_value({
        "contract": "chenyida-erp-uat-promotion-rollback-target-derivation/v1",
        "operation_id": operation_id,
    })[:16]
    return {
        "database": {
            "active": "chenyida_erp",
            "staging": f"chenyida_erp_rb_{token}",
            "candidate_quarantine": f"chenyida_erp_candidate_{token}",
        },
        "volumes": {
            domain: {
                "target": f"chenyida-erp_erp_{domain}_rb_{token}",
                "utility_container": f"chenyida-erp-rollback-{domain.replace('_', '-')}-{token}",
            }
            for domain in ("uploads", "attachments", "backup_status")
        },
        "rollback_postdeploy_run_id": f"rollback-{token}",
    }


def derive_source_roles(action: str, operation: str, label: str | None) -> list[str]:
    if action == "PREFLIGHT":
        selected = set(PACKAGE_SOURCE_ROLES)
    elif action in {"RECHECK", "CONTAIN"} or action == "PROBE" and label is None:
        selected = {
            "candidate_deployment_result", "candidate_postdeploy_identity",
            "runtime_adapter_activation",
        }
    else:
        mapping = STAGE_SOURCE_ROLES if operation == "ROLLBACK_EXECUTION" else CHECK_SOURCE_ROLES
        selected = set(mapping.get(label or "", ())) | {"runtime_adapter_activation"}
    result = [role for role in PACKAGE_SOURCE_ROLES if role in selected]
    if len(result) != len(selected):
        reject("ROLLBACK_RUNTIME_SOURCE_ROLES_INVALID")
    return result


def validate_database(value: Any, code: str) -> dict[str, Any]:
    value = exact(value, {"name", "system_identifier", "oid", "marker"}, code)
    if value.get("name") != "chenyida_erp" \
            or value.get("marker") != "chenyida-erp-deployment/v2:UAT:chenyida-erp" \
            or not isinstance(value.get("system_identifier"), str) \
            or re.fullmatch(r"[1-9][0-9]{9,29}", value["system_identifier"]) is None \
            or not isinstance(value.get("oid"), str) \
            or re.fullmatch(r"[1-9][0-9]{0,9}", value["oid"]) is None:
        reject(code)
    return value


def validate_observed_database(value: Any, code: str) -> dict[str, Any]:
    value = exact(value, {
        "name", "system_identifier", "oid", "marker", "allow_connections", "writer_sessions", "sealed",
    }, code)
    validate_database({
        "name": value.get("name"), "system_identifier": value.get("system_identifier"),
        "oid": value.get("oid"), "marker": value.get("marker"),
    }, code)
    if not isinstance(value.get("allow_connections"), bool) \
            or not isinstance(value.get("sealed"), bool) \
            or value["allow_connections"] == value["sealed"]:
        reject(code)
    safe_integer(value.get("writer_sessions"), 0, 1_000_000, code)
    if value["sealed"] and value["writer_sessions"] != 0:
        reject(code)
    return value


def validate_predecessor(value: Any, code: str) -> dict[str, Any]:
    value = exact(value, {
        "git_commit", "git_tree", "application_version", "release_manifest_sha256",
        "web_image", "worker_image", "migration_head", "migration_manifest_sha256",
        "runtime_configuration_sha256",
    }, code)
    matching_string(value.get("git_commit"), COMMIT, code)
    matching_string(value.get("git_tree"), COMMIT, code)
    matching_string(value.get("application_version"), VERSION, code)
    matching_string(value.get("web_image"), IMAGE_REFERENCE, code)
    matching_string(value.get("worker_image"), IMAGE_REFERENCE, code)
    matching_string(value.get("migration_head"), MIGRATION, code)
    for field in (
        "release_manifest_sha256", "migration_manifest_sha256", "runtime_configuration_sha256",
    ):
        digest(value.get(field), code)
    return value


def validate_snapshot_objects(value: Any, code: str) -> dict[str, Any]:
    files = {
        "postgresql": "postgresql.dump", "uploads": "uploads.tar.gz",
        "attachments": "attachments.tar.gz", "backup_status": "backup-status.tar.gz",
    }
    value = exact(value, set(files), code)
    for domain, expected_file in files.items():
        item = exact(value.get(domain), {"file", "sha256", "bytes", "entries"}, code)
        if item.get("file") != expected_file:
            reject(code)
        digest(item.get("sha256"), code)
        safe_integer(item.get("bytes"), 1, 2**53 - 1, code)
        if domain == "postgresql":
            if item.get("entries") is not None:
                reject(code)
        else:
            safe_integer(item.get("entries"), 0, 2**53 - 1, code)
    return value


def validate_boundary(value: Any, code: str) -> dict[str, Any]:
    expected = {
        "environment_restore": "EXACT_PREUPGRADE_SNAPSHOT_AND_PREDECESSOR_RUNTIME_ONLY",
        "posted_business_reversal": "NOT_PERFORMED_REQUIRES_SEPARATE_BUSINESS_AUTHORIZATION",
        "down_migration": False,
        "direct_sql_correction": False,
        "business_fact_deletion": False,
        "automatic_business_compensation": False,
    }
    if exact(value, set(expected), code) != expected:
        reject(code)
    return value


def validate_content_reconciliation(value: Any, code: str) -> dict[str, Any]:
    value = exact(value, {
        "source_reconciliation_sha256", "database", "files", "binding_sha256",
    }, code)
    digest(value.get("source_reconciliation_sha256"), code)
    database = exact(value.get("database"), {"report_sha256"}, code)
    digest(database.get("report_sha256"), code)
    files = exact(value.get("files"), {"uploads", "attachments", "backup_status"}, code)
    for domain in ("uploads", "attachments", "backup_status"):
        item = exact(files.get(domain), {"tree_sha256", "entries"}, code)
        digest(item.get("tree_sha256"), code)
        safe_integer(item.get("entries"), 0, 2**53 - 1, code)
    digest(value.get("binding_sha256"), code)
    if sha256_value(without(value, "binding_sha256")) != value["binding_sha256"]:
        reject(code)
    return value


def validate_source_spec(value: Any, code: str) -> dict[str, Any]:
    value = exact(value, SOURCE_FIELDS, code)
    normalized_absolute(value.get("path"), code)
    digest(value.get("sha256"), code)
    safe_integer(value.get("bytes"), 1, 2**53 - 1, code)
    if not isinstance(value.get("device"), str) or re.fullmatch(r"[1-9][0-9]*", value["device"]) is None \
            or not isinstance(value.get("inode"), str) \
            or re.fullmatch(r"[1-9][0-9]*", value["inode"]) is None \
            or value.get("uid") != 0 or isinstance(value.get("gid"), bool) \
            or not isinstance(value.get("gid"), int) or not 0 <= value["gid"] <= 2_147_483_647 \
            or value.get("nlink") != 1 or value.get("mode") not in {"0400", "0440", "0444"}:
        reject(code)
    return value


def validate_request(value: Any, cli_action: str, cli_operation_id: str, cli_label: str | None) -> dict[str, Any]:
    fields = {
        "schema_version", "contract", "action", "operation", "operation_id", "execution_mode", "label",
        "execution_package_sha256", "source_set_sha256", "transaction_intent_sha256",
        "record_intent_sha256", "runtime_plan_sha256", "previous_result_sha256", "context_sha256",
        "source_roles", "payload_sha256", "payload", "requested_at", "execution_deadline",
        "authorization_expires_at", "action_deadline", "request_sha256",
    }
    request = exact(value, fields, "ROLLBACK_RUNTIME_REQUEST_INVALID")
    if request.get("schema_version") != 1 or request.get("contract") != REQUEST_CONTRACT \
            or request.get("action") != cli_action or request.get("operation_id") != cli_operation_id \
            or request.get("label") != cli_label \
            or request.get("operation") not in {"ROLLBACK_EXECUTION", "ROLLBACK_POSTVERIFY"} \
            or request.get("execution_mode") not in {"ORIGINAL", "RECOVERY"}:
        reject("ROLLBACK_RUNTIME_REQUEST_INVALID")
    identifier(request["operation_id"], "ROLLBACK_RUNTIME_REQUEST_INVALID")
    if cli_label is not None and LABEL.fullmatch(cli_label) is None:
        reject("ROLLBACK_RUNTIME_REQUEST_INVALID")
    for field in (
        "execution_package_sha256", "source_set_sha256", "transaction_intent_sha256",
        "context_sha256", "payload_sha256", "request_sha256",
    ):
        digest(request.get(field), "ROLLBACK_RUNTIME_REQUEST_INVALID")
    digest(request.get("previous_result_sha256"), "ROLLBACK_RUNTIME_REQUEST_INVALID", allow_zero=True)
    digest(request.get("record_intent_sha256"), "ROLLBACK_RUNTIME_REQUEST_INVALID", allow_zero=True)
    digest(request.get("runtime_plan_sha256"), "ROLLBACK_RUNTIME_REQUEST_INVALID")
    if request.get("source_roles") != derive_source_roles(
        request["action"], request["operation"], request["label"],
    ):
        reject("ROLLBACK_RUNTIME_REQUEST_INVALID")
    if not isinstance(request.get("payload"), dict) or sha256_value(request["payload"]) != request["payload_sha256"] \
            or sha256_value(request["payload"].get("context")) != request["context_sha256"] \
            or sha256_value(without(request, "request_sha256")) != request["request_sha256"]:
        reject("ROLLBACK_RUNTIME_REQUEST_INVALID")
    requested = instant(request["requested_at"], "ROLLBACK_RUNTIME_REQUEST_TIME_INVALID")
    execution_deadline = instant(request["execution_deadline"], "ROLLBACK_RUNTIME_REQUEST_TIME_INVALID")
    authorization_expires = instant(
        request["authorization_expires_at"], "ROLLBACK_RUNTIME_REQUEST_TIME_INVALID",
    )
    action_deadline = instant(request["action_deadline"], "ROLLBACK_RUNTIME_REQUEST_TIME_INVALID")
    if action_deadline <= requested or action_deadline > authorization_expires \
            or request["execution_mode"] == "ORIGINAL" and action_deadline > execution_deadline \
            or (action_deadline - requested).total_seconds() > TIMEOUTS[request["action"]] \
            or datetime.now(timezone.utc) >= action_deadline:
        reject("ROLLBACK_RUNTIME_REQUEST_TIME_INVALID")
    operation = request["operation"]
    mode = request["execution_mode"]
    if mode == "RECOVERY":
        if cli_label is not None or cli_action == "EXECUTE" \
                or cli_action not in ACTION_MATRIX["RECOVERY"]:
            reject("ROLLBACK_RUNTIME_ACTION_FORBIDDEN")
    elif cli_action in {"PREFLIGHT", "RECHECK"}:
        if cli_label is not None:
            reject("ROLLBACK_RUNTIME_ACTION_FORBIDDEN")
    elif cli_action == "CONTAIN" or cli_action == "PROBE" and cli_label is None:
        if cli_label is not None:
            reject("ROLLBACK_RUNTIME_ACTION_FORBIDDEN")
    elif cli_label is None or cli_action not in ACTION_MATRIX[operation].get(cli_label, []):
        reject("ROLLBACK_RUNTIME_ACTION_FORBIDDEN")
    return request


def validate_context(request: dict[str, Any], package: dict[str, Any]) -> dict[str, Any]:
    code = "ROLLBACK_RUNTIME_CONTEXT_INVALID"
    context = exact(request["payload"].get("context"), {
        "schema_version", "contract", "operation_id", "operation", "execution_mode",
        "execution_authorization_id", "execution_authorization_sha256", "execution_created_at",
        "original_authorization_sha256", "supervisor_bundle_sha256", "expected_intent_sha256",
        "parameters",
    }, code)
    if context.get("schema_version") != 1 \
            or context.get("contract") != "chenyida-erp-uat-promotion-transaction-context/v1" \
            or context.get("operation") != request["operation"] \
            or context.get("operation_id") != request["operation_id"] \
            or context.get("execution_mode") != request["execution_mode"]:
        reject(code)
    identifier(context.get("execution_authorization_id"), code)
    instant(context.get("execution_created_at"), code)
    for field in (
        "execution_authorization_sha256", "original_authorization_sha256", "supervisor_bundle_sha256",
    ):
        digest(context.get(field), code)
    if context["execution_mode"] == "ORIGINAL":
        if context.get("expected_intent_sha256") is not None \
                or context["execution_authorization_sha256"] != context["original_authorization_sha256"]:
            reject(code)
    else:
        digest(context.get("expected_intent_sha256"), code)
        if context["execution_authorization_sha256"] == context["original_authorization_sha256"]:
            reject(code)
    parameters = context.get("parameters")
    if not isinstance(parameters, dict) \
            or parameters.get("promotion_id") != package.get("promotion_id") \
            or parameters.get("promotion_generation") != package.get("promotion_generation"):
        reject(code)
    expected_operation_id = parameters.get("rollback_id") if request["operation"] == "ROLLBACK_EXECUTION" \
        else parameters.get("postverify_id")
    if expected_operation_id != request["operation_id"]:
        reject(code)
    return context


def validate_transaction_intent(request: dict[str, Any]) -> dict[str, Any]:
    code = "ROLLBACK_RUNTIME_TRANSACTION_INTENT_INVALID"
    value = request["payload"].get("transaction_intent")
    if not isinstance(value, dict):
        reject(code)
    digest_field = "rollback_intent_sha256" if request["operation"] == "ROLLBACK_EXECUTION" \
        else "postverify_intent_sha256"
    expected_contract = "chenyida-erp-uat-promotion-rollback-intent/v1" \
        if request["operation"] == "ROLLBACK_EXECUTION" \
        else "chenyida-erp-uat-promotion-rollback-postverify-intent/v1"
    operation_field = "rollback_operation_id" if request["operation"] == "ROLLBACK_EXECUTION" \
        else "postverify_operation_id"
    if value.get("schema_version") != 1 or value.get("contract") != expected_contract \
            or value.get(operation_field) != request["operation_id"] \
            or value.get(digest_field) != request["transaction_intent_sha256"] \
            or sha256_value(without(value, digest_field)) != value[digest_field]:
        reject(code)
    return value


def validate_record_intent(request: dict[str, Any]) -> dict[str, Any] | None:
    code = "ROLLBACK_RUNTIME_RECORD_INTENT_INVALID"
    value = request["payload"].get("record_intent")
    if request["action"] in {"PREFLIGHT", "RECHECK"}:
        if value is not None or request["record_intent_sha256"] != ZERO_SHA256:
            reject(code)
        return None
    if not isinstance(value, dict) or request["record_intent_sha256"] == ZERO_SHA256:
        reject(code)
    if request["action"] == "CONTAIN" or request["action"] == "PROBE" and request["label"] is None:
        fields = {
            "schema_version", "contract", "status", "operation", "operation_id", "promotion_id",
            "intent_sha256", "execution_package_sha256", "failure_code",
            "ledger_state", "last_committed_ordinal", "last_committed_label",
            "last_committed_record_sha256", "runtime_target_state",
            "runtime_observation_sha256", "expected_writer_inventory_sha256",
            "expected_writer_set_sha256", "expected_active_generation",
            "expected_database_oid", "expected_web_container_id", "expected_worker_container_id",
            "containment_attempt", "previous_containment_intent_sha256",
            "previous_containment_attempt_receipt_sha256",
            "prepared_at", "containment_intent_sha256",
        }
        value = exact(value, fields, code)
        labels = STAGES if request["operation"] == "ROLLBACK_EXECUTION" else CHECKS
        if value.get("schema_version") != 1 \
                or value.get("contract") != "chenyida-erp-uat-promotion-rollback-containment-intent/v1" \
                or value.get("status") != "PREPARED" \
                or value.get("operation") != request["operation"] \
                or value.get("operation_id") != request["operation_id"] \
                or value.get("promotion_id") != request["payload"]["execution_package"].get("promotion_id") \
                or value.get("intent_sha256") != request["transaction_intent_sha256"] \
                or value.get("execution_package_sha256") != request["execution_package_sha256"] \
                or not isinstance(value.get("failure_code"), str) \
                or LABEL.fullmatch(value["failure_code"]) is None \
                or value.get("ledger_state") not in {"EMPTY", "EXACT_PREFIX", "UNKNOWN"} \
                or value.get("runtime_target_state") not in {
                    "SAFE_TO_EXECUTE", "EXACT_RESULT_ALREADY_DURABLE",
                    "PARTIAL_OR_UNKNOWN_REQUIRES_CONTAINMENT",
                    "BLOCKED_TARGET_IDENTITY_MISMATCH",
                } \
                or value.get("expected_active_generation") not in {
                    "CANDIDATE", "PREDECESSOR", "PARTIAL_OR_UNKNOWN",
                } \
                or safe_integer(value.get("containment_attempt"), 1, 3, code) \
                != value["containment_attempt"] \
                or value["containment_attempt"] == 1 \
                and (value.get("previous_containment_intent_sha256") is not None \
                    or value.get("previous_containment_attempt_receipt_sha256") is not None) \
                or value["containment_attempt"] > 1 \
                and (digest(value.get("previous_containment_intent_sha256"), code) \
                    != value["previous_containment_intent_sha256"] \
                    or value["previous_containment_intent_sha256"] == ZERO_SHA256 \
                    or digest(value.get("previous_containment_attempt_receipt_sha256"), code) \
                    != value["previous_containment_attempt_receipt_sha256"] \
                    or value["previous_containment_attempt_receipt_sha256"] == ZERO_SHA256) \
                or matching_string(value.get("expected_database_oid"), re.compile(r"[1-9][0-9]{0,9}\Z"), code) \
                != value["expected_database_oid"] \
                or matching_string(value.get("expected_web_container_id"), CONTAINER_ID, code) \
                != value["expected_web_container_id"] \
                or matching_string(value.get("expected_worker_container_id"), CONTAINER_ID, code) \
                != value["expected_worker_container_id"] \
                or value["expected_web_container_id"] == value["expected_worker_container_id"] \
                or digest(value.get("runtime_observation_sha256"), code) \
                != value["runtime_observation_sha256"] \
                or digest(value.get("expected_writer_inventory_sha256"), code) \
                != value["expected_writer_inventory_sha256"] \
                or digest(value.get("expected_writer_set_sha256"), code) \
                != value["expected_writer_set_sha256"] \
                or isinstance(value.get("last_committed_ordinal"), bool) \
                or not isinstance(value.get("last_committed_ordinal"), int) \
                or not 0 <= value["last_committed_ordinal"] <= len(labels) \
                or value.get("last_committed_label") \
                != (None if value["last_committed_ordinal"] == 0
                    else labels[value["last_committed_ordinal"] - 1]) \
                or value["last_committed_ordinal"] == 0 \
                and value.get("last_committed_record_sha256") != ZERO_SHA256 \
                or value["last_committed_ordinal"] > 0 \
                and (SHA256.fullmatch(value.get("last_committed_record_sha256", "")) is None
                    or value.get("last_committed_record_sha256") == ZERO_SHA256) \
                or value.get("last_committed_record_sha256") != request["previous_result_sha256"] \
                or instant(value.get("prepared_at"), code) \
                > instant(request["action_deadline"], code) \
                or request["payload"].get("containment_intent") != value \
                or value.get("containment_intent_sha256") != request["record_intent_sha256"] \
                or sha256_value(without(value, "containment_intent_sha256")) \
                != value["containment_intent_sha256"]:
            reject(code)
        return value
    postverify = request["operation"] == "ROLLBACK_POSTVERIFY"
    label_field = "check" if postverify else "stage"
    digest_field = "check_intent_sha256" if postverify else "stage_intent_sha256"
    expected_contract = "chenyida-erp-uat-promotion-rollback-check-intent/v2" if postverify \
        else "chenyida-erp-uat-promotion-rollback-stage-intent/v2"
    fields = {
        "schema_version", "contract", "status", "promotion_id", "promotion_generation",
        "operation_id", "execution_authorization_sha256", "rollback_plan_sha256",
        "execution_package_sha256", "runtime_plan_sha256", "ordinal", label_field,
        "previous_result_sha256", "input_sha256", "prepared_at", digest_field,
    }
    value = exact(value, fields, code)
    labels = CHECKS if postverify else STAGES
    if value.get("schema_version") != 2 or value.get("contract") != expected_contract \
            or value.get("status") != "PREPARED" or value.get("operation_id") != request["operation_id"] \
            or value.get(label_field) != request["label"] \
            or safe_integer(value.get("ordinal"), 1, len(labels), code) != labels.index(request["label"]) + 1 \
            or value.get("execution_package_sha256") != request["execution_package_sha256"] \
            or value.get("runtime_plan_sha256") != request["runtime_plan_sha256"] \
            or value.get("previous_result_sha256") != request["previous_result_sha256"] \
            or value.get(digest_field) != request["record_intent_sha256"] \
            or sha256_value(without(value, digest_field)) != value[digest_field]:
        reject(code)
    return value


def validate_package(request: dict[str, Any]) -> dict[str, Any]:
    package = request["payload"].get("execution_package")
    code = "ROLLBACK_RUNTIME_EXECUTION_PACKAGE_INVALID"
    package = exact(package, {
        "schema_version", "contract", "promotion_id", "promotion_generation", "rollback_operation_id",
        "created_at", "execution_deadline", "snapshot_readiness_sha256", "snapshot_objects",
        "snapshot_objects_sha256", "predecessor", "predecessor_sha256", "database",
        "database_snapshot_sha256", "boundary", "content_reconciliation",
        "protected_resources_sha256", "runtime_plan_sha256", "compose_project",
        "compose_project_root", "restore_strategies", "sources", "source_set_sha256",
        "package_sha256",
    }, code)
    if package.get("schema_version") != 2 or package.get("contract") != PACKAGE_CONTRACT \
            or package.get("package_sha256") != request["execution_package_sha256"] \
            or sha256_value(without(package, "package_sha256")) != package.get("package_sha256") \
            or package.get("source_set_sha256") != request["source_set_sha256"] \
            or package.get("runtime_plan_sha256") != request["runtime_plan_sha256"] \
            or package.get("execution_deadline") != request["execution_deadline"]:
        reject(code)
    identifier(package.get("promotion_id"), code)
    identifier(package.get("rollback_operation_id"), code)
    safe_integer(package.get("promotion_generation"), 1, 1_000_000, code)
    created = instant(package.get("created_at"), code)
    deadline = instant(package.get("execution_deadline"), code)
    if deadline <= created or deadline - created > timedelta(hours=2) \
            or package["rollback_operation_id"] != request["payload"]["context"].get("parameters", {}).get("rollback_id"):
        reject(code)
    normalized_absolute(package.get("compose_project_root"), code)
    if package.get("compose_project") != "chenyida-erp":
        reject(code)
    for field in (
        "snapshot_readiness_sha256", "snapshot_objects_sha256", "predecessor_sha256",
        "database_snapshot_sha256", "protected_resources_sha256", "runtime_plan_sha256",
        "source_set_sha256", "package_sha256",
    ):
        digest(package.get(field), code)
    validate_snapshot_objects(package.get("snapshot_objects"), code)
    validate_predecessor(package.get("predecessor"), code)
    validate_database(package.get("database"), code)
    validate_boundary(package.get("boundary"), code)
    validate_content_reconciliation(package.get("content_reconciliation"), code)
    expected_strategies = {
        "database": "RESTORE_TO_STAGING_DATABASE_ATOMIC_RENAME_RETAIN_CANDIDATE_QUARANTINED",
        "file_domains": "RESTORE_TO_NEW_NAMED_VOLUMES_RECREATE_WRITERS_RETAIN_CANDIDATE_VOLUMES",
        "runtime": "RECREATE_WEB_WORKER_FROM_PREDECESSOR_PINNED_DIGESTS",
    }
    if exact(package.get("restore_strategies"), set(expected_strategies), code) != expected_strategies:
        reject(code)
    sources = package.get("sources")
    if not isinstance(sources, dict) or set(sources) != set(PACKAGE_SOURCE_ROLES) \
            or sha256_value(sources) != package.get("source_set_sha256"):
        reject(code)
    paths: set[str] = set()
    for role in PACKAGE_SOURCE_ROLES:
        spec = validate_source_spec(sources.get(role), code)
        if spec["path"] in paths:
            reject(code)
        paths.add(spec["path"])
    reconciliation = package["content_reconciliation"]
    if package["snapshot_objects_sha256"] != sha256_value(package["snapshot_objects"]) \
            or package["predecessor_sha256"] != sha256_value(package["predecessor"]) \
            or package["database_snapshot_sha256"] != sha256_value(package["database"]) \
            or reconciliation["source_reconciliation_sha256"] \
            != sources["snapshot_reconciliation"]["sha256"] \
            or any(
                reconciliation["files"][domain]["entries"]
                != package["snapshot_objects"][domain]["entries"]
                for domain in ("uploads", "attachments", "backup_status")
            ):
        reject(code)
    validate_context(request, package)
    validate_transaction_intent(request)
    validate_record_intent(request)
    return package


def validate_plan(plan: Any, package: dict[str, Any]) -> dict[str, Any]:
    required = {
        "schema_version", "contract", "promotion_id", "promotion_generation", "rollback_operation_id",
        "deployment", "candidate", "predecessor", "targets", "toolchain", "timeouts",
        "max_output_bytes", "source_bindings", "action_matrix", "runtime_plan_sha256",
    }
    plan = exact(plan, required, "ROLLBACK_RUNTIME_PLAN_INVALID")
    if plan.get("schema_version") != 1 or plan.get("contract") != PLAN_CONTRACT \
            or sha256_value(without(plan, "runtime_plan_sha256")) != plan.get("runtime_plan_sha256") \
            or plan.get("runtime_plan_sha256") != package.get("runtime_plan_sha256") \
            or plan.get("promotion_id") != package.get("promotion_id") \
            or plan.get("promotion_generation") != package.get("promotion_generation") \
            or plan.get("rollback_operation_id") != package.get("rollback_operation_id") \
            or plan.get("targets") != derive_targets(plan["rollback_operation_id"]) \
            or plan.get("timeouts") != TIMEOUTS or plan.get("max_output_bytes") != MAX_BYTES \
            or plan.get("action_matrix") != ACTION_MATRIX:
        reject("ROLLBACK_RUNTIME_PLAN_INVALID")
    deployment = plan.get("deployment")
    deployment = exact(deployment, {"class", "id", "compose_project", "compose_project_root", "database"},
                       "ROLLBACK_RUNTIME_PLAN_INVALID")
    validate_database(deployment.get("database"), "ROLLBACK_RUNTIME_PLAN_INVALID")
    normalized_absolute(deployment.get("compose_project_root"), "ROLLBACK_RUNTIME_PLAN_INVALID")
    if deployment.get("class") != "UAT" or deployment.get("id") != "chenyida-erp" \
            or deployment.get("compose_project") != package.get("compose_project") \
            or deployment.get("compose_project_root") != package.get("compose_project_root") \
            or deployment.get("database") != package.get("database"):
        reject("ROLLBACK_RUNTIME_PLAN_BINDING_INVALID")
    candidate = exact(plan.get("candidate"), {"services", "volumes", "protected_resources_sha256"},
                      "ROLLBACK_RUNTIME_PLAN_INVALID")
    services = exact(candidate.get("services"), {"caddy", "postgres", "web", "worker"},
                     "ROLLBACK_RUNTIME_PLAN_INVALID")
    for service in ("caddy", "postgres", "web", "worker"):
        item = exact(services.get(service), {
            "service", "container_id", "image_reference", "image_digest",
        }, "ROLLBACK_RUNTIME_PLAN_INVALID")
        if item.get("service") != service:
            reject("ROLLBACK_RUNTIME_PLAN_INVALID")
        matching_string(item.get("container_id"), CONTAINER_ID, "ROLLBACK_RUNTIME_PLAN_INVALID")
        matching_string(item.get("image_reference"), IMAGE_REFERENCE, "ROLLBACK_RUNTIME_PLAN_INVALID")
        matching_string(item.get("image_digest"), IMAGE_DIGEST, "ROLLBACK_RUNTIME_PLAN_INVALID")
    if len({item["container_id"] for item in services.values()}) != 4 \
            or len({item["image_digest"] for item in services.values()}) != 4:
        reject("ROLLBACK_RUNTIME_PLAN_INVALID")
    volumes = exact(candidate.get("volumes"), {"uploads", "attachments", "backup_status"},
                    "ROLLBACK_RUNTIME_PLAN_INVALID")
    for domain in ("uploads", "attachments", "backup_status"):
        item = exact(volumes.get(domain), {"domain", "name", "identity_sha256"},
                     "ROLLBACK_RUNTIME_PLAN_INVALID")
        if item.get("domain") != domain:
            reject("ROLLBACK_RUNTIME_PLAN_INVALID")
        matching_string(item.get("name"), DOCKER_NAME, "ROLLBACK_RUNTIME_PLAN_INVALID")
        digest(item.get("identity_sha256"), "ROLLBACK_RUNTIME_PLAN_INVALID")
        if plan["targets"]["volumes"][domain]["target"] == item["name"]:
            reject("ROLLBACK_RUNTIME_PLAN_INVALID")
    if len({item["name"] for item in volumes.values()}) != 3 \
            or len({item["identity_sha256"] for item in volumes.values()}) != 3:
        reject("ROLLBACK_RUNTIME_PLAN_INVALID")
    digest(candidate.get("protected_resources_sha256"), "ROLLBACK_RUNTIME_PLAN_INVALID")
    predecessor = exact(plan.get("predecessor"), {
        "release_manifest_sha256", "postdeploy_receipt_sha256", "runtime_configuration_sha256",
        "web_image", "worker_image",
    }, "ROLLBACK_RUNTIME_PLAN_INVALID")
    for field in ("release_manifest_sha256", "postdeploy_receipt_sha256", "runtime_configuration_sha256"):
        digest(predecessor.get(field), "ROLLBACK_RUNTIME_PLAN_INVALID")
    matching_string(predecessor.get("web_image"), IMAGE_REFERENCE, "ROLLBACK_RUNTIME_PLAN_INVALID")
    matching_string(predecessor.get("worker_image"), IMAGE_REFERENCE, "ROLLBACK_RUNTIME_PLAN_INVALID")
    toolchain = exact(plan.get("toolchain"), {"executor", "docker"}, "ROLLBACK_RUNTIME_PLAN_INVALID")
    for key, expected_path in (("executor", EXECUTOR_FILE), ("docker", DOCKER_FILE)):
        tool = exact(toolchain.get(key), {"path", "sha256", "uid", "gid", "mode"},
                     "ROLLBACK_RUNTIME_PLAN_INVALID")
        if tool.get("path") != str(expected_path) or tool.get("uid") != 0 \
                or tool.get("gid") != 0 or tool.get("mode") != "0555":
            reject("ROLLBACK_RUNTIME_PLAN_INVALID")
        digest(tool.get("sha256"), "ROLLBACK_RUNTIME_PLAN_INVALID")
    bindings = exact(plan.get("source_bindings"), {
        "snapshot_objects_sha256", "snapshot_reconciliation_sha256",
        "deployment_environment_sha256", "compose_file_sha256",
        "compose_release_file_sha256", "runtime_policy_sha256",
    }, "ROLLBACK_RUNTIME_PLAN_INVALID")
    for item in bindings.values():
        digest(item, "ROLLBACK_RUNTIME_PLAN_INVALID")
    sources = package["sources"]
    if candidate.get("protected_resources_sha256") \
            != package.get("protected_resources_sha256") or not isinstance(predecessor, dict) \
            or predecessor.get("release_manifest_sha256") != package["predecessor"]["release_manifest_sha256"] \
            or predecessor.get("postdeploy_receipt_sha256") != sources["predecessor_postdeploy_receipt"]["sha256"] \
            or predecessor.get("runtime_configuration_sha256") \
            != package["predecessor"]["runtime_configuration_sha256"] \
            or predecessor.get("web_image") != package["predecessor"]["web_image"] \
            or predecessor.get("worker_image") != package["predecessor"]["worker_image"] \
            or bindings != {
                "snapshot_objects_sha256": package["snapshot_objects_sha256"],
                "snapshot_reconciliation_sha256": sources["snapshot_reconciliation"]["sha256"],
                "deployment_environment_sha256": sources["deployment_environment"]["sha256"],
                "compose_file_sha256": sources["compose_file"]["sha256"],
                "compose_release_file_sha256": sources["compose_release_file"]["sha256"],
                "runtime_policy_sha256": sources["runtime_policy"]["sha256"],
            }:
        reject("ROLLBACK_RUNTIME_PLAN_BINDING_INVALID")
    return plan


def trusted_parent_chain(target: Path, root: Path | None, code: str) -> None:
    boundary = root if root is not None else Path("/")
    current = target.parent
    while True:
        try:
            metadata = current.lstat()
        except OSError:
            reject(code)
        if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) \
                or metadata.st_uid != 0 or metadata.st_gid != 0 \
                or stat.S_IMODE(metadata.st_mode) & 0o022:
            reject(code)
        if current == boundary or current == Path("/"):
            break
        current = current.parent


def load_activation(
    package: dict[str, Any], request: dict[str, Any], root: Path | None,
) -> tuple[dict[str, Any], str, tuple[Path, tuple[Any, ...], int]]:
    spec = package["sources"]["runtime_adapter_activation"]
    if spec.get("path") != str(ACTIVATION_FILE) or spec.get("uid") != 0 \
            or spec.get("gid") != 0 or spec.get("mode") != "0400":
        reject("ROLLBACK_RUNTIME_ACTIVATION_SOURCE_INVALID")
    raw, handle = trusted_source(spec, root, "ROLLBACK_RUNTIME_ACTIVATION_SOURCE_INVALID")
    try:
        activation = parse_json(raw, "ROLLBACK_RUNTIME_ACTIVATION_INVALID")
        fields = {
            "schema_version", "contract", "status", "activation_id", "approved_at", "expires_at",
            "requester_identity_sha256", "approver_identity_sha256", "plan", "activation_sha256",
        }
        activation = exact(activation, fields, "ROLLBACK_RUNTIME_ACTIVATION_INVALID")
        now = datetime.now(timezone.utc)
        approved = instant(activation.get("approved_at"), "ROLLBACK_RUNTIME_ACTIVATION_INVALID")
        expires = instant(activation.get("expires_at"), "ROLLBACK_RUNTIME_ACTIVATION_INVALID")
        package_deadline = instant(package.get("execution_deadline"), "ROLLBACK_RUNTIME_ACTIVATION_INVALID")
        action_deadline = instant(request.get("action_deadline"), "ROLLBACK_RUNTIME_ACTIVATION_INVALID")
        identifier(activation.get("activation_id"), "ROLLBACK_RUNTIME_ACTIVATION_INVALID")
        if activation.get("schema_version") != 1 or activation.get("contract") != ACTIVATION_CONTRACT \
                or activation.get("status") != "ACTIVE" or approved > now + timedelta(minutes=5) \
                or expires <= approved or expires - approved > timedelta(hours=24) \
                or request["execution_mode"] == "ORIGINAL" and (
                    now >= expires or expires < package_deadline or expires < action_deadline
                ) \
                or request["execution_mode"] == "RECOVERY" and approved >= package_deadline \
                or digest(activation.get("requester_identity_sha256"), "ROLLBACK_RUNTIME_ACTIVATION_INVALID") \
                == digest(activation.get("approver_identity_sha256"), "ROLLBACK_RUNTIME_ACTIVATION_INVALID") \
                or sha256_value(without(activation, "activation_sha256")) \
                != activation.get("activation_sha256") \
                or canonical(activation) != raw:
            reject("ROLLBACK_RUNTIME_ACTIVATION_INVALID")
        validate_plan(activation.get("plan"), package)
        return activation, sha256_bytes(raw), handle
    except Exception:
        os.close(handle[2])
        raise


def verify_supervisor(request: dict[str, Any], root: Path | None) -> int:
    if os.geteuid() != 0:
        reject("ROLLBACK_RUNTIME_ROOT_REQUIRED")
    descriptor_text = os.environ.get("ERP_RELEASE_GATE_LOCK_FD", "")
    if re.fullmatch(r"(?:[3-9]|[1-5][0-9]|6[0-3])", descriptor_text) is None:
        reject("ROLLBACK_RUNTIME_LOCK_INVALID")
    descriptor = int(descriptor_text)
    expected_consumed = "NO" if request["action"] == "PREFLIGHT" else "YES"
    site_root = Path(os.environ.get("ERP_RELEASE_SUPERVISOR_SITE_ROOT", ""))
    bundle_sha = os.environ.get("ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256", "")
    authorization_sha = os.environ.get("ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256", "")
    context = request["payload"]["context"]
    expected_original_consumed = "YES" if request["execution_mode"] == "RECOVERY" else "NO"
    if os.environ.get("ERP_RELEASE_SUPERVISOR_LAUNCHED") != "YES" \
            or os.environ.get("ERP_RELEASE_GATE_LOCK_HELD") != "YES" \
            or os.environ.get("ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED") != expected_consumed \
            or os.environ.get("ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED") \
            != expected_original_consumed \
            or os.environ.get("ERP_RELEASE_SUPERVISOR_AUTHORIZATION_EXPIRES_AT") \
            != request["authorization_expires_at"] \
            or digest(bundle_sha, "ROLLBACK_RUNTIME_SUPERVISOR_INVALID") != context.get("supervisor_bundle_sha256") \
            or digest(authorization_sha, "ROLLBACK_RUNTIME_SUPERVISOR_INVALID") \
            != context.get("execution_authorization_sha256"):
        reject("ROLLBACK_RUNTIME_SUPERVISOR_INVALID")
    expected_site = Path(__file__).resolve().parent.parent
    if root is None:
        if site_root.resolve() != expected_site or site_root.parent.parent != SUPERVISOR_BUNDLE_ROOT \
                or site_root.parent.name != bundle_sha:
            reject("ROLLBACK_RUNTIME_SUPERVISOR_INVALID")
    else:
        expected_logical_site = Path("/usr/local/libexec/chenyida-erp-release-supervisor/bundles") \
            / bundle_sha / "chenyida_erp_site"
        if site_root != expected_logical_site or expected_site != physical(expected_logical_site, root):
            reject("ROLLBACK_RUNTIME_SUPERVISOR_INVALID")
    lock_path = physical(GLOBAL_LOCK, root)
    try:
        opened = os.fstat(descriptor)
        named = lock_path.lstat()
        fdinfo = Path(f"/proc/self/fdinfo/{descriptor}").read_text(encoding="utf-8")
    except OSError:
        reject("ROLLBACK_RUNTIME_LOCK_INVALID")
    lock_lines = [line for line in fdinfo.splitlines() if line.startswith("lock:")]
    if not stat.S_ISREG(opened.st_mode) or not stat.S_ISREG(named.st_mode) \
            or opened.st_dev != named.st_dev or opened.st_ino != named.st_ino \
            or named.st_uid != 0 or named.st_gid != 0 or named.st_nlink != 1 \
            or stat.S_IMODE(named.st_mode) != 0o600 or len(lock_lines) != 1 \
            or re.search(r"FLOCK\s+ADVISORY\s+WRITE", lock_lines[0]) is None:
        reject("ROLLBACK_RUNTIME_LOCK_INVALID")
    return descriptor


def terminate_group(process: subprocess.Popen[bytes], sig: signal.Signals) -> None:
    try:
        os.killpg(process.pid, sig)
    except ProcessLookupError:
        pass


def process_group_exists(process: subprocess.Popen[bytes]) -> bool:
    try:
        os.killpg(process.pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def enable_child_subreaper() -> None:
    try:
        libc = ctypes.CDLL(None, use_errno=True)
        if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
            reject("ROLLBACK_RUNTIME_EXECUTOR_ISOLATION_FAILED")
    except (AttributeError, OSError):
        reject("ROLLBACK_RUNTIME_EXECUTOR_ISOLATION_FAILED")


def process_parent_map() -> dict[int, int]:
    parents: dict[int, int] = {}
    try:
        entries = os.scandir("/proc")
    except OSError:
        return parents
    with entries:
        for entry in entries:
            if not entry.name.isdigit():
                continue
            try:
                source = Path(entry.path, "stat").read_text(encoding="utf-8")
                tail = source[source.rfind(")") + 2:].split()
                parents[int(entry.name)] = int(tail[1])
            except (OSError, ValueError, IndexError):
                continue
    return parents


def executor_descendants(process: subprocess.Popen[bytes]) -> set[int]:
    parents = process_parent_map()
    descendants = {process.pid}
    adopted_parent = os.getpid()
    changed = True
    while changed:
        changed = False
        for pid, parent in parents.items():
            if pid == adopted_parent or pid in descendants:
                continue
            if parent in descendants or parent == adopted_parent:
                descendants.add(pid)
                changed = True
    descendants.discard(process.pid)
    return descendants


def reap_executor_children(process: subprocess.Popen[bytes]) -> None:
    for child_pid in executor_descendants(process):
        try:
            os.waitpid(child_pid, os.WNOHANG)
        except ChildProcessError:
            continue
        except OSError:
            continue


def signal_executor_descendants(process: subprocess.Popen[bytes], sig: signal.Signals) -> None:
    for pid in executor_descendants(process):
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            pass


def stop_executor_group(process: subprocess.Popen[bytes]) -> bool:
    terminate_group(process, signal.SIGTERM)
    signal_executor_descendants(process, signal.SIGTERM)
    term_deadline = time.monotonic() + 5
    while (process_group_exists(process) or executor_descendants(process)) \
            and time.monotonic() < term_deadline:
        try:
            process.wait(timeout=0.05)
        except subprocess.TimeoutExpired:
            pass
        reap_executor_children(process)
    if process_group_exists(process) or executor_descendants(process):
        terminate_group(process, signal.SIGKILL)
        signal_executor_descendants(process, signal.SIGKILL)
    kill_deadline = time.monotonic() + 2
    while (process_group_exists(process) or executor_descendants(process)) \
            and time.monotonic() < kill_deadline:
        try:
            process.wait(timeout=0.05)
        except subprocess.TimeoutExpired:
            pass
        reap_executor_children(process)
    if process.poll() is None:
        try:
            process.wait(timeout=max(0.001, kill_deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            terminate_group(process, signal.SIGKILL)
    reap_executor_children(process)
    return not process_group_exists(process) and not executor_descendants(process)


def run_executor(
    executable_descriptor: int,
    docker_descriptor: int,
    source_handles: dict[str, tuple[Path, tuple[Any, ...], int]],
    request: dict[str, Any],
    descriptor: int,
    timeout_seconds: float,
) -> bytes:
    deadline = time.monotonic() + timeout_seconds
    executable_path = f"/proc/self/fd/{executable_descriptor}"
    arguments = [executable_path, request["action"].lower(), request["operation_id"]]
    if request["label"] is not None:
        arguments.append(request["label"])
    environment = {
        key: os.environ[key]
        for key in (
            "ERP_RELEASE_SUPERVISOR_LAUNCHED",
            "ERP_RELEASE_GATE_LOCK_HELD",
            "ERP_RELEASE_GATE_LOCK_FD",
            "ERP_RELEASE_SUPERVISOR_SITE_ROOT",
            "ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256",
            "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256",
            "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_EXPIRES_AT",
            "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED",
            "ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED",
        )
        if key in os.environ
    }
    environment.update({
        "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent",
        "PYTHONDONTWRITEBYTECODE": "1", "PYTHONHASHSEED": "0",
    })
    package = request["payload"]["execution_package"]
    if _CURRENT_PLAN is None:
        reject("ROLLBACK_RUNTIME_PLAN_INVALID")
    descriptor_manifest_body = {
        "schema_version": 1,
        "contract": "chenyida-erp-uat-promotion-rollback-trusted-fd-manifest/v1",
        "executor": {
            "path": executable_path,
            "sha256": _CURRENT_PLAN["toolchain"]["executor"]["sha256"],
        },
        "docker": {
            "path": f"/proc/self/fd/{docker_descriptor}",
            "sha256": _CURRENT_PLAN["toolchain"]["docker"]["sha256"],
        },
        "sources": {
            role: {
                "path": f"/proc/self/fd/{source_handles[role][2]}",
                "logical_path": package["sources"][role]["path"],
                "sha256": package["sources"][role]["sha256"],
            }
            for role in request["source_roles"]
        },
    }
    descriptor_manifest = {
        **descriptor_manifest_body,
        "manifest_sha256": sha256_value(descriptor_manifest_body),
    }
    environment["CHENYIDA_ERP_ROLLBACK_TRUSTED_FD_MANIFEST"] = \
        canonical(descriptor_manifest).decode("utf-8").removesuffix("\n")
    inherited_descriptors = tuple(sorted({
        descriptor, executable_descriptor, docker_descriptor,
        *(handle[2] for handle in source_handles.values()),
    }))
    enable_child_subreaper()
    try:
        process = subprocess.Popen(
            arguments,
            cwd="/",
            env=environment,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            pass_fds=inherited_descriptors,
            start_new_session=True,
        )
    except OSError:
        reject("ROLLBACK_RUNTIME_EXECUTOR_FAILED")
    assert process.stdin is not None and process.stdout is not None and process.stderr is not None
    selector: selectors.BaseSelector | None = None
    old_handlers: dict[signal.Signals, Any] = {}
    success = False

    class ExecutorInterrupted(Exception):
        pass

    def forward_signal(_signum: int, _frame: Any) -> None:
        terminate_group(process, signal.SIGTERM)
        raise ExecutorInterrupted

    try:
        for watched_signal in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            old_handlers[watched_signal] = signal.signal(watched_signal, forward_signal)
        request_raw = canonical(request)
        request_offset = 0
        os.set_blocking(process.stdin.fileno(), False)
        os.set_blocking(process.stdout.fileno(), False)
        os.set_blocking(process.stderr.fileno(), False)
        selector = selectors.DefaultSelector()
        selector.register(process.stdin, selectors.EVENT_WRITE, "stdin")
        selector.register(process.stdout, selectors.EVENT_READ, "stdout")
        selector.register(process.stderr, selectors.EVENT_READ, "stderr")
        streams = {"stdout": bytearray(), "stderr": bytearray()}
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                reject("ROLLBACK_RUNTIME_EXECUTOR_TIMEOUT_OR_OUTPUT_LIMIT")
            for key, _ in selector.select(timeout=min(remaining, 0.25)):
                if key.data == "stdin":
                    try:
                        written = os.write(
                            key.fileobj.fileno(),
                            request_raw[request_offset:request_offset + 65536],
                        )
                    except BlockingIOError:
                        continue
                    except (BrokenPipeError, OSError):
                        reject("ROLLBACK_RUNTIME_EXECUTOR_FAILED")
                    if written <= 0:
                        reject("ROLLBACK_RUNTIME_EXECUTOR_FAILED")
                    request_offset += written
                    if request_offset == len(request_raw):
                        selector.unregister(key.fileobj)
                        key.fileobj.close()
                    continue
                try:
                    chunk = os.read(key.fileobj.fileno(), 65536)
                except BlockingIOError:
                    continue
                except OSError:
                    reject("ROLLBACK_RUNTIME_EXECUTOR_FAILED")
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                streams[key.data].extend(chunk)
                if len(streams[key.data]) > MAX_BYTES:
                    reject("ROLLBACK_RUNTIME_EXECUTOR_TIMEOUT_OR_OUTPUT_LIMIT")
        try:
            returncode = process.wait(timeout=max(0.001, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            reject("ROLLBACK_RUNTIME_EXECUTOR_TIMEOUT_OR_OUTPUT_LIMIT")
        reap_executor_children(process)
        if returncode != 0 or streams["stderr"] or not 2 <= len(streams["stdout"]) <= MAX_BYTES \
                or process_group_exists(process) or executor_descendants(process):
            reject("ROLLBACK_RUNTIME_EXECUTOR_FAILED")
        success = True
        return bytes(streams["stdout"])
    except ExecutorInterrupted:
        reject("ROLLBACK_RUNTIME_EXECUTOR_INTERRUPTED")
    except AdapterError:
        raise
    except (OSError, ValueError, RuntimeError):
        reject("ROLLBACK_RUNTIME_EXECUTOR_FAILED")
    finally:
        for watched_signal, old_handler in old_handlers.items():
            try:
                signal.signal(watched_signal, old_handler)
            except (OSError, ValueError):
                success = False
        if selector is not None:
            selector.close()
        for pipe in (process.stdin, process.stdout, process.stderr):
            try:
                pipe.close()
            except OSError:
                pass
        if (not success or process_group_exists(process) or executor_descendants(process)) \
                and not stop_executor_group(process):
            reject("ROLLBACK_RUNTIME_EXECUTOR_CLEANUP_FAILED")


def validate_observation(value: Any, plan: dict[str, Any]) -> dict[str, Any]:
    code = "ROLLBACK_RUNTIME_OBSERVATION_INVALID"
    value = exact(value, {
        "schema_version", "contract", "active_generation", "database", "services", "volumes",
        "writer_inventory", "retained_candidate_volumes", "derived_targets",
        "protected_resources_sha256", "observation_sha256",
    }, code)
    if value.get("schema_version") != 1 \
            or value.get("contract") != "chenyida-erp-uat-promotion-rollback-runtime-observation/v1" \
            or value.get("active_generation") not in {"CANDIDATE", "PREDECESSOR", "PARTIAL_OR_UNKNOWN"}:
        reject(code)
    validate_observed_database(value.get("database"), code)
    services = exact(value.get("services"), {"caddy", "postgres", "web", "worker"}, code)
    for service in ("caddy", "postgres", "web", "worker"):
        item = exact(services.get(service), {
            "service", "container_id", "image_reference", "image_digest", "running", "health",
            "restart_count", "oom_killed",
        }, code)
        if item.get("service") != service or not isinstance(item.get("running"), bool) \
                or not isinstance(item.get("oom_killed"), bool) \
                or item.get("health") not in {"none", "healthy", "unhealthy", "starting", "stopped"}:
            reject(code)
        matching_string(item.get("container_id"), CONTAINER_ID, code)
        matching_string(item.get("image_reference"), IMAGE_REFERENCE, code)
        matching_string(item.get("image_digest"), IMAGE_DIGEST, code)
        safe_integer(item.get("restart_count"), 0, 1_000_000, code)
    if len({item["container_id"] for item in services.values()}) != 4:
        reject(code)
    writer_inventory = exact(value.get("writer_inventory"), {
        "discovery_scope", "discovery_complete", "members", "writer_set_sha256",
        "active_writer_count", "unexpected_writer_count",
    }, code)
    members = writer_inventory.get("members")
    if writer_inventory.get("discovery_scope") != "COMPOSE_PROJECT_COMPLETE_WRITER_SET" \
            or writer_inventory.get("discovery_complete") is not True \
            or not isinstance(members, list) or not 2 <= len(members) <= 64:
        reject(code)
    for member in members:
        member = exact(member, {"writer_key", "service", "container_id", "running", "unexpected"}, code)
        matching_string(member.get("writer_key"), IDENTIFIER, code)
        matching_string(member.get("service"), IDENTIFIER, code)
        matching_string(member.get("container_id"), CONTAINER_ID, code)
        if not isinstance(member.get("running"), bool) or not isinstance(member.get("unexpected"), bool):
            reject(code)
    by_key = {member["writer_key"]: member for member in members}
    known_service_container_ids = {item["container_id"] for item in services.values()}
    identity_set = [{
        "writer_key": member["writer_key"], "service": member["service"],
        "container_id": member["container_id"], "unexpected": member["unexpected"],
    } for member in members]
    if members != sorted(members, key=lambda member: member["writer_key"]) \
            or len(by_key) != len(members) \
            or len({member["container_id"] for member in members}) != len(members) \
            or not {"web", "worker"}.issubset(by_key) \
            or any(
                by_key[service]["service"] != service
                or by_key[service]["container_id"] != services[service]["container_id"]
                or by_key[service]["running"] != services[service]["running"]
                or by_key[service]["unexpected"] is not False
                for service in ("web", "worker")
            ) \
            or any(member["writer_key"] not in {"web", "worker"} and not member["unexpected"]
                   for member in members) \
            or any(member["writer_key"] not in {"web", "worker"}
                   and member["container_id"] in known_service_container_ids
                   for member in members) \
            or writer_inventory.get("active_writer_count") \
            != sum(1 for member in members if member["running"]) \
            or writer_inventory.get("unexpected_writer_count") \
            != sum(1 for member in members if member["unexpected"]) \
            or writer_inventory.get("writer_set_sha256") != sha256_value(identity_set):
        reject(code)
    safe_integer(writer_inventory.get("active_writer_count"), 0, len(members), code)
    safe_integer(writer_inventory.get("unexpected_writer_count"), 0, len(members) - 2, code)
    digest(writer_inventory.get("writer_set_sha256"), code)
    volumes = exact(value.get("volumes"), {"uploads", "attachments", "backup_status"}, code)
    for domain in ("uploads", "attachments", "backup_status"):
        item = exact(volumes.get(domain), {"domain", "name", "identity_sha256"}, code)
        if item.get("domain") != domain:
            reject(code)
        matching_string(item.get("name"), DOCKER_NAME, code)
        digest(item.get("identity_sha256"), code)
    if len({item["name"] for item in volumes.values()}) != 3 \
            or len({item["identity_sha256"] for item in volumes.values()}) != 3:
        reject(code)
    retained = exact(value.get("retained_candidate_volumes"), {
        "uploads", "attachments", "backup_status",
    }, code)
    for domain in ("uploads", "attachments", "backup_status"):
        item = exact(retained.get(domain), {"domain", "name", "present", "identity_sha256"}, code)
        if item.get("domain") != domain or not isinstance(item.get("present"), bool):
            reject(code)
        matching_string(item.get("name"), DOCKER_NAME, code)
        if item["present"]:
            digest(item.get("identity_sha256"), code)
        elif item.get("identity_sha256") is not None:
            reject(code)
    if len({item["name"] for item in retained.values()}) != 3 \
            or any(retained[domain]["name"] != plan["candidate"]["volumes"][domain]["name"]
                   for domain in ("uploads", "attachments", "backup_status")) \
            or any(
                volumes[domain]["name"] != retained[domain]["name"]
                and retained[domain]["present"]
                and volumes[domain]["identity_sha256"] == retained[domain]["identity_sha256"]
                for domain in ("uploads", "attachments", "backup_status")
            ):
        reject(code)
    targets = exact(value.get("derived_targets"), {"database", "volumes"}, code)
    databases = exact(targets.get("database"), {"staging", "candidate_quarantine"}, code)
    for key in ("staging", "candidate_quarantine"):
        item = exact(databases.get(key), {"name", "present", "oid"}, code)
        matching_string(item.get("name"), DATABASE_IDENTIFIER, code)
        if not isinstance(item.get("present"), bool) or item["present"] != (item.get("oid") is not None):
            reject(code)
        if item["present"]:
            matching_string(item.get("oid"), re.compile(r"[1-9][0-9]{0,9}\Z"), code)
        if item["name"] != plan["targets"]["database"][key]:
            reject(code)
    volume_targets = exact(targets.get("volumes"), {"uploads", "attachments", "backup_status"}, code)
    for domain in ("uploads", "attachments", "backup_status"):
        item = exact(volume_targets.get(domain), {"target", "utility_container"}, code)
        target = exact(item.get("target"), {"name", "present", "identity_sha256"}, code)
        utility = exact(item.get("utility_container"), {"name", "present", "container_id"}, code)
        matching_string(target.get("name"), DOCKER_NAME, code)
        matching_string(utility.get("name"), DOCKER_NAME, code)
        if not isinstance(target.get("present"), bool) \
                or target["present"] != (target.get("identity_sha256") is not None) \
                or not isinstance(utility.get("present"), bool) \
                or utility["present"] != (utility.get("container_id") is not None):
            reject(code)
        if target["present"]:
            digest(target.get("identity_sha256"), code)
        if utility["present"]:
            matching_string(utility.get("container_id"), CONTAINER_ID, code)
        if target["name"] != plan["targets"]["volumes"][domain]["target"] \
                or utility["name"] != plan["targets"]["volumes"][domain]["utility_container"]:
            reject(code)
    digest(value.get("protected_resources_sha256"), code)
    digest(value.get("observation_sha256"), code)
    if value["protected_resources_sha256"] != plan["candidate"]["protected_resources_sha256"] \
            or sha256_value(without(value, "observation_sha256")) != value["observation_sha256"]:
        reject(code)
    return value


def original_observation(plan: dict[str, Any]) -> dict[str, Any]:
    writer_members = [{
        "writer_key": service,
        "service": service,
        "container_id": plan["candidate"]["services"][service]["container_id"],
        "running": True,
        "unexpected": False,
    } for service in ("web", "worker")]
    writer_identity_set = [{
        "writer_key": member["writer_key"], "service": member["service"],
        "container_id": member["container_id"], "unexpected": member["unexpected"],
    } for member in writer_members]
    body = {
        "schema_version": 1,
        "contract": "chenyida-erp-uat-promotion-rollback-runtime-observation/v1",
        "active_generation": "CANDIDATE",
        "database": {
            **plan["deployment"]["database"],
            "allow_connections": True, "writer_sessions": 0, "sealed": False,
        },
        "services": {
            service: {
                **identity,
                "running": True,
                "health": "none" if service == "caddy" else "healthy",
                "restart_count": 0,
                "oom_killed": False,
            }
            for service, identity in plan["candidate"]["services"].items()
        },
        "writer_inventory": {
            "discovery_scope": "COMPOSE_PROJECT_COMPLETE_WRITER_SET",
            "discovery_complete": True,
            "members": writer_members,
            "writer_set_sha256": sha256_value(writer_identity_set),
            "active_writer_count": 2,
            "unexpected_writer_count": 0,
        },
        "volumes": plan["candidate"]["volumes"],
        "retained_candidate_volumes": {
            domain: {**volume, "present": True}
            for domain, volume in plan["candidate"]["volumes"].items()
        },
        "derived_targets": {
            "database": {
                "staging": {"name": plan["targets"]["database"]["staging"], "present": False, "oid": None},
                "candidate_quarantine": {
                    "name": plan["targets"]["database"]["candidate_quarantine"],
                    "present": False,
                    "oid": None,
                },
            },
            "volumes": {
                domain: {
                    "target": {
                        "name": plan["targets"]["volumes"][domain]["target"],
                        "present": False,
                        "identity_sha256": None,
                    },
                    "utility_container": {
                        "name": plan["targets"]["volumes"][domain]["utility_container"],
                        "present": False,
                        "container_id": None,
                    },
                }
                for domain in ("uploads", "attachments", "backup_status")
            },
        },
        "protected_resources_sha256": plan["candidate"]["protected_resources_sha256"],
    }
    return {**body, "observation_sha256": sha256_value(body)}


def validate_response(raw: bytes, request: dict[str, Any], activation_sha: str, executor_sha: str) -> dict[str, Any]:
    response = parse_json(raw, "ROLLBACK_RUNTIME_RESPONSE_INVALID")
    fields = {
        "schema_version", "contract", "action", "operation", "operation_id", "label", "request_sha256",
        "runtime_plan_sha256", "status", "started_at", "completed_at", "output", "response_sha256",
    }
    response = exact(response, fields, "ROLLBACK_RUNTIME_RESPONSE_INVALID")
    if response.get("schema_version") != 1 or response.get("contract") != RESPONSE_CONTRACT \
            or response.get("action") != request["action"] or response.get("operation") != request["operation"] \
            or response.get("operation_id") != request["operation_id"] \
            or response.get("label") != request["label"] \
            or response.get("request_sha256") != request["request_sha256"] \
            or response.get("runtime_plan_sha256") != request["runtime_plan_sha256"] \
            or not isinstance(response.get("output"), dict) \
            or sha256_value(without(response, "response_sha256")) != response.get("response_sha256") \
            or canonical(response) != raw:
        reject("ROLLBACK_RUNTIME_RESPONSE_INVALID")
    started = instant(response.get("started_at"), "ROLLBACK_RUNTIME_RESPONSE_INVALID")
    completed = instant(response.get("completed_at"), "ROLLBACK_RUNTIME_RESPONSE_INVALID")
    if started < instant(request["requested_at"], "ROLLBACK_RUNTIME_RESPONSE_INVALID") \
            or completed < started \
            or completed > instant(request["action_deadline"], "ROLLBACK_RUNTIME_RESPONSE_INVALID"):
        reject("ROLLBACK_RUNTIME_RESPONSE_INVALID")
    status = response.get("status")
    allowed = {
        "PREFLIGHT": {
            "SAFE_TO_EXECUTE", "EXACT_RESULT_ALREADY_DURABLE",
            "PARTIAL_OR_UNKNOWN_REQUIRES_CONTAINMENT", "BLOCKED_TARGET_IDENTITY_MISMATCH",
        },
        "RECHECK": {
            "SAFE_TO_EXECUTE", "EXACT_RESULT_ALREADY_DURABLE",
            "PARTIAL_OR_UNKNOWN_REQUIRES_CONTAINMENT", "BLOCKED_TARGET_IDENTITY_MISMATCH",
        },
        "PREPARE": {"PREPARED"},
        "EXECUTE": {"COMMITTED", "ALREADY_COMMITTED"},
        "PROBE": {"COMMITTED", "VERIFIED", "PARTIAL_OR_UNKNOWN", "CONTAINED"},
        "CONTAIN": {"CONTAINED", "STALE_INTENT"},
    }
    if status not in allowed[request["action"]]:
        reject("ROLLBACK_RUNTIME_RESPONSE_STATUS_INVALID")
    if request["action"] in {"PREFLIGHT", "RECHECK"}:
        output = exact(response["output"], {
            "result", "execution_package_sha256", "source_set_sha256", "runtime_plan_sha256",
            "runtime_activation_source_sha256", "executor_sha256", "deployment_identity_sha256",
            "protected_resources_sha256", "target_state", "observed",
        }, "ROLLBACK_RUNTIME_PREFLIGHT_RESPONSE_INVALID")
        package = request["payload"]["execution_package"]
        plan = activation_plan(request)
        observed = validate_observation(output.get("observed"), plan)
        if output != {
            "result": "ROLLBACK_RUNTIME_PREFLIGHT_PASSED" if request["action"] == "PREFLIGHT"
                else "ROLLBACK_RUNTIME_RECHECK_PASSED",
            "execution_package_sha256": package["package_sha256"],
            "source_set_sha256": package["source_set_sha256"],
            "runtime_plan_sha256": package["runtime_plan_sha256"],
            "runtime_activation_source_sha256": activation_sha,
            "executor_sha256": executor_sha,
            "deployment_identity_sha256": sha256_value(plan["deployment"]),
            "protected_resources_sha256": package["protected_resources_sha256"],
            "target_state": status,
            "observed": observed,
        }:
            reject("ROLLBACK_RUNTIME_PREFLIGHT_RESPONSE_INVALID")
        if status == "SAFE_TO_EXECUTE" and observed != original_observation(plan):
            reject("ROLLBACK_RUNTIME_PREFLIGHT_RESPONSE_INVALID")
        if status == "EXACT_RESULT_ALREADY_DURABLE":
            services = observed["services"]
            volumes = observed["volumes"]
            targets = observed["derived_targets"]
            predecessor_digests = {
                service: "sha256:" + plan["predecessor"][f"{service}_image"].rsplit("@sha256:", 1)[1]
                for service in ("web", "worker")
            }
            if observed["active_generation"] != "PREDECESSOR" \
                    or observed["database"]["name"] != plan["deployment"]["database"]["name"] \
                    or observed["database"]["system_identifier"] \
                    != plan["deployment"]["database"]["system_identifier"] \
                    or observed["database"]["marker"] != plan["deployment"]["database"]["marker"] \
                    or observed["database"]["oid"] == plan["deployment"]["database"]["oid"] \
                    or observed["database"]["allow_connections"] is not True \
                    or observed["database"]["writer_sessions"] != 0 \
                    or observed["database"]["sealed"] is not False \
                    or targets["database"]["staging"]["present"] \
                    or not targets["database"]["candidate_quarantine"]["present"] \
                    or targets["database"]["candidate_quarantine"]["oid"] \
                    != plan["deployment"]["database"]["oid"] \
                    or observed["writer_inventory"]["active_writer_count"] != 2 \
                    or observed["writer_inventory"]["unexpected_writer_count"] != 0 \
                    or len(observed["writer_inventory"]["members"]) != 2:
                reject("ROLLBACK_RUNTIME_PREFLIGHT_RESPONSE_INVALID")
            for service in ("caddy", "postgres"):
                if {field: services[service][field] for field in (
                    "service", "container_id", "image_reference", "image_digest",
                )} != plan["candidate"]["services"][service]:
                    reject("ROLLBACK_RUNTIME_PREFLIGHT_RESPONSE_INVALID")
            for service in ("web", "worker"):
                if services[service]["image_reference"] != plan["predecessor"][f"{service}_image"] \
                        or services[service]["image_digest"] != predecessor_digests[service] \
                        or services[service]["container_id"] \
                        == plan["candidate"]["services"][service]["container_id"]:
                    reject("ROLLBACK_RUNTIME_PREFLIGHT_RESPONSE_INVALID")
            for service, item in services.items():
                if not item["running"] or item["oom_killed"] or item["restart_count"] != 0 \
                        or item["health"] != ("none" if service == "caddy" else "healthy"):
                    reject("ROLLBACK_RUNTIME_PREFLIGHT_RESPONSE_INVALID")
            for domain in ("uploads", "attachments", "backup_status"):
                target = targets["volumes"][domain]["target"]
                utility = targets["volumes"][domain]["utility_container"]
                if volumes[domain]["name"] != plan["targets"]["volumes"][domain]["target"] \
                        or volumes[domain]["identity_sha256"] \
                        == plan["candidate"]["volumes"][domain]["identity_sha256"] \
                        or not target["present"] \
                        or target["identity_sha256"] != volumes[domain]["identity_sha256"] \
                        or utility["present"] \
                        or observed["retained_candidate_volumes"][domain]["present"] is not True \
                        or observed["retained_candidate_volumes"][domain]["name"] \
                        != plan["candidate"]["volumes"][domain]["name"] \
                        or observed["retained_candidate_volumes"][domain]["identity_sha256"] \
                        != plan["candidate"]["volumes"][domain]["identity_sha256"]:
                    reject("ROLLBACK_RUNTIME_PREFLIGHT_RESPONSE_INVALID")
    elif request["action"] == "CONTAIN" and status == "STALE_INTENT":
        output = exact(response["output"], {"observed"}, "ROLLBACK_RUNTIME_CONTAINMENT_RESPONSE_INVALID")
        observed = validate_observation(output.get("observed"), activation_plan(request))
        if observed["observation_sha256"] \
                == request["payload"]["record_intent"]["runtime_observation_sha256"]:
            reject("ROLLBACK_RUNTIME_CONTAINMENT_RESPONSE_INVALID")
    return response


_CURRENT_PLAN: dict[str, Any] | None = None


def activation_plan(_request: dict[str, Any]) -> dict[str, Any]:
    if _CURRENT_PLAN is None:
        reject("ROLLBACK_RUNTIME_PLAN_INVALID")
    return _CURRENT_PLAN


def read_stdin() -> bytes:
    result = bytearray()
    while True:
        chunk = sys.stdin.buffer.read(65536)
        if not chunk:
            break
        result.extend(chunk)
        if len(result) > MAX_BYTES:
            reject("ROLLBACK_RUNTIME_REQUEST_INVALID")
    return bytes(result)


def main(arguments: list[str]) -> None:
    if len(arguments) not in {2, 3}:
        reject("ROLLBACK_RUNTIME_USAGE_INVALID")
    action = arguments[0].upper()
    operation_id = arguments[1]
    label = arguments[2] if len(arguments) == 3 else None
    if action not in TIMEOUTS or IDENTIFIER.fullmatch(operation_id) is None \
            or label is not None and LABEL.fullmatch(label) is None:
        reject("ROLLBACK_RUNTIME_USAGE_INVALID")
    request = validate_request(parse_json(read_stdin(), "ROLLBACK_RUNTIME_REQUEST_INVALID"), action, operation_id, label)
    package = validate_package(request)
    root = test_root()
    descriptor = verify_supervisor(request, root)
    opened_handles: list[tuple[Path, tuple[Any, ...], int]] = []
    try:
        activation, activation_source_sha, activation_handle = load_activation(package, request, root)
        opened_handles.append(activation_handle)
        global _CURRENT_PLAN
        _CURRENT_PLAN = activation["plan"]
        plan = validate_plan(_CURRENT_PLAN, package)
        executor_handle = trusted_tool(
            plan["toolchain"]["executor"], EXECUTOR_FILE, root, "ROLLBACK_RUNTIME_EXECUTOR_INVALID"
        )
        opened_handles.append(executor_handle)
        docker_handle = trusted_tool(
            plan["toolchain"]["docker"], DOCKER_FILE, root, "ROLLBACK_RUNTIME_DOCKER_INVALID"
        )
        opened_handles.append(docker_handle)
        source_handles = {"runtime_adapter_activation": activation_handle}
        for role in request["source_roles"]:
            if role == "runtime_adapter_activation":
                continue
            _, handle = trusted_source(
                package["sources"][role], root,
                f"ROLLBACK_RUNTIME_SOURCE_{role.upper()}_INVALID",
            )
            opened_handles.append(handle)
            source_handles[role] = handle
        deadline = instant(request["action_deadline"], "ROLLBACK_RUNTIME_REQUEST_TIME_INVALID")
        remaining = (deadline - datetime.now(timezone.utc)).total_seconds()
        if remaining <= 0:
            reject("ROLLBACK_RUNTIME_REQUEST_TIME_INVALID")
        action_timeout = float(TIMEOUTS[action])
        if root is not None:
            test_timeout = os.environ.get("CHENYIDA_ERP_ROLLBACK_ADAPTER_TEST_TIMEOUT_MS", "")
            if test_timeout:
                if re.fullmatch(r"[1-9][0-9]{1,4}", test_timeout) is None:
                    reject("ROLLBACK_RUNTIME_TEST_TIMEOUT_INVALID")
                action_timeout = min(action_timeout, int(test_timeout) / 1000)
        raw = run_executor(
            executor_handle[2], docker_handle[2], source_handles,
            request, descriptor, max(0.001, min(action_timeout, remaining)),
        )
        recheck_open_file(*executor_handle, "ROLLBACK_RUNTIME_EXECUTOR_CHANGED")
        recheck_open_file(*docker_handle, "ROLLBACK_RUNTIME_DOCKER_CHANGED")
        for role, handle in source_handles.items():
            recheck_open_file(
                *handle, f"ROLLBACK_RUNTIME_SOURCE_{role.upper()}_CHANGED",
            )
        response = validate_response(
            raw, request, activation_source_sha, plan["toolchain"]["executor"]["sha256"]
        )
        sys.stdout.buffer.write(canonical(response))
    finally:
        for _target, _identity, opened_descriptor in reversed(opened_handles):
            try:
                os.close(opened_descriptor)
            except OSError:
                pass


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except AdapterError as error:
        sys.stderr.write(f"{error.code}\n")
        raise SystemExit(1) from None
