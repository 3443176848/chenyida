#!/usr/bin/python3
"""Execute one content-addressed UAT migration behind the checkpoint-8 database fence."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import signal
import stat
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


STATE_ROOT = Path("/var/lib/chenyida-erp/uat-promotion-transactions-v1")
GRANTS_ROOT = STATE_ROOT / "grants"
RESULTS_ROOT = STATE_ROOT / "results"
EXECUTIONS_ROOT = STATE_ROOT / "executions"
ACTIVE_FENCES_ROOT = STATE_ROOT / "active-fences"
SECRET_ROOT = Path("/etc/chenyida-erp/runtime-secrets")
MIGRATION_SECRET = SECRET_ROOT / "migration-database-password"
DOCKER = Path("/usr/bin/docker")
LOCK_FILE = Path("/run/lock/chenyida-erp-release-gate-v1.lock")
SAFE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
MAX_JSON_BYTES = 4 * 1024 * 1024
MAX_ARTIFACT_FILE_BYTES = 64 * 1024 * 1024
MAX_ARTIFACT_BUNDLE_BYTES = 256 * 1024 * 1024
MAX_ARTIFACT_FILES = 512
CONTROL_QUERY_TIMEOUT_SECONDS = 30
CANDIDATE_MAX_RUNTIME_SECONDS = 10 * 60
CANDIDATE_FINALIZATION_MARGIN_SECONDS = 120
SHA256 = re.compile(r"^[0-9a-f]{64}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
MIGRATION = re.compile(r"^[0-9]{4}_[a-z0-9_]+\.sql$")
IMAGE = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[0-9a-f]{64}$")
CONTAINER_ID = re.compile(r"^[0-9a-f]{64}$")
IMAGE_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
ISO_UTC = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$")
ZERO_SHA256 = "0" * 64

MANAGED_ROLES = [
    "chenyida_erp_admin", "chenyida_erp_admin_priv", "chenyida_erp_backup", "chenyida_erp_backup_priv",
    "chenyida_erp_owner", "chenyida_erp_web", "chenyida_erp_web_priv", "chenyida_erp_worker",
    "chenyida_erp_worker_priv",
]
LOGIN_ROLES = [
    "chenyida_erp_admin", "chenyida_erp_backup", "chenyida_erp_owner", "chenyida_erp_web",
    "chenyida_erp_worker",
]
BASELINE_CONNECT_ROLES = [
    "chenyida_erp_admin", "chenyida_erp_backup", "chenyida_erp_owner", "chenyida_erp_web",
    "chenyida_erp_worker",
]
BASELINE_DATABASE_ACL = [
    {"grantee": "chenyida_erp_admin_priv", "grantor": "chenyida_erp_owner", "privilege": "CONNECT", "grantable": False},
    {"grantee": "chenyida_erp_backup_priv", "grantor": "chenyida_erp_owner", "privilege": "CONNECT", "grantable": False},
    {"grantee": "chenyida_erp_web_priv", "grantor": "chenyida_erp_owner", "privilege": "CONNECT", "grantable": False},
    {"grantee": "chenyida_erp_worker_priv", "grantor": "chenyida_erp_owner", "privilege": "CONNECT", "grantable": False},
]
EXPECTED_ROLE_RECORDS = [
    {"role": "chenyida_erp_admin", "login": True, "inherit": True, "connection_limit": 1,
     "superuser": False, "create_role": False, "create_database": False, "replication": False,
     "bypass_rls": False, "valid_until_absent": True, "settings_absent": True},
    {"role": "chenyida_erp_admin_priv", "login": False, "inherit": True, "connection_limit": -1,
     "superuser": False, "create_role": False, "create_database": False, "replication": False,
     "bypass_rls": False, "valid_until_absent": True, "settings_absent": True},
    {"role": "chenyida_erp_backup", "login": True, "inherit": True, "connection_limit": 2,
     "superuser": False, "create_role": False, "create_database": False, "replication": False,
     "bypass_rls": False, "valid_until_absent": True, "settings_absent": True},
    {"role": "chenyida_erp_backup_priv", "login": False, "inherit": True, "connection_limit": -1,
     "superuser": False, "create_role": False, "create_database": False, "replication": False,
     "bypass_rls": False, "valid_until_absent": True, "settings_absent": True},
    {"role": "chenyida_erp_owner", "login": True, "inherit": False, "connection_limit": 1,
     "superuser": False, "create_role": False, "create_database": False, "replication": False,
     "bypass_rls": False, "valid_until_absent": True, "settings_absent": True},
    {"role": "chenyida_erp_web", "login": True, "inherit": True, "connection_limit": 12,
     "superuser": False, "create_role": False, "create_database": False, "replication": False,
     "bypass_rls": False, "valid_until_absent": True, "settings_absent": True},
    {"role": "chenyida_erp_web_priv", "login": False, "inherit": True, "connection_limit": -1,
     "superuser": False, "create_role": False, "create_database": False, "replication": False,
     "bypass_rls": False, "valid_until_absent": True, "settings_absent": True},
    {"role": "chenyida_erp_worker", "login": True, "inherit": True, "connection_limit": 6,
     "superuser": False, "create_role": False, "create_database": False, "replication": False,
     "bypass_rls": False, "valid_until_absent": True, "settings_absent": True},
    {"role": "chenyida_erp_worker_priv", "login": False, "inherit": True, "connection_limit": -1,
     "superuser": False, "create_role": False, "create_database": False, "replication": False,
     "bypass_rls": False, "valid_until_absent": True, "settings_absent": True},
]
EXPECTED_MEMBERSHIPS = [
    {"role": "chenyida_erp_admin_priv", "member": "chenyida_erp_admin", "grantor": "postgres",
     "admin_option": False, "inherit_option": True, "set_option": False},
    {"role": "chenyida_erp_backup_priv", "member": "chenyida_erp_backup", "grantor": "postgres",
     "admin_option": False, "inherit_option": True, "set_option": False},
    {"role": "chenyida_erp_web_priv", "member": "chenyida_erp_web", "grantor": "postgres",
     "admin_option": False, "inherit_option": True, "set_option": False},
    {"role": "chenyida_erp_worker_priv", "member": "chenyida_erp_worker", "grantor": "postgres",
     "admin_option": False, "inherit_option": True, "set_option": False},
]

CONTEXT_FIELDS = {
    "schema_version", "contract", "operation_id", "operation", "execution_mode", "execution_authorization_id",
    "execution_authorization_sha256", "execution_created_at", "original_authorization_sha256",
    "supervisor_bundle_sha256", "expected_intent_sha256", "parameters",
}
PARAMETER_FIELDS = {
    "promotion_state_root", "promotion_id", "promotion_generation", "previous_checkpoint_receipt_sha256",
    "promotion_intent_sha256", "promotion_original_authorization_sha256",
    "migration_authorization_operation_id", "migration_authorization_intent_sha256",
    "migration_authorization_intent_source", "migration_approval_authorization_sha256",
    "candidate_binding_sha256", "database_binding_sha256", "runtime_binding_sha256",
    "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256",
    "writer_quiesce_binding_sha256", "migration_authorization_binding_sha256",
    "current_checkpoint_source", "runtime_identity_source", "release_manifest", "release_manifest_sha256",
    "release_manifest_source", "deployment_class", "deployment_id", "database_name", "database_oid",
    "database_system_identifier", "database_marker", "expected_current_migration_head", "target_migration_head",
    "migration_manifest_sha256", "migration_role", "control_role", "worker_image", "postgres_container",
    "postgres_container_id", "postgres_image_digest", "backend_network", "execution_created_at",
    "execution_expires_at", "requester_identity_sha256", "approver_identity_sha256",
    "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
}
GRANT_FIELDS = {
    "schema_version", "contract", "execution_scope", "promotion_id", "migration_operation_id",
    "execution_authorization_sha256", "migration_approval_authorization_sha256",
    "migration_approval_receipt_sha256", "migration_authorization_binding_sha256",
    "promotion_intent_sha256", "candidate_binding_sha256", "database_binding_sha256",
    "runtime_binding_sha256", "recovery_binding_sha256", "promotion_snapshot_binding_sha256",
    "writer_quiesce_binding_sha256", "supervisor_bundle_sha256", "release_manifest_sha256",
    "worker_image", "migration_manifest_sha256", "expected_current_head", "target_head", "database",
    "created_at", "expires_at", "grant_sha256",
}
ENGINE_FIELDS = {
    "schema_version", "contract", "status", "promotion_id", "migration_operation_id",
    "execution_authorization_sha256", "grant_sha256", "database_name", "database_system_identifier",
    "database_oid", "database_marker", "migration_role", "application_name", "current_head_before",
    "target_head", "started_at", "completed_at", "files", "final_migration_rows_sha256",
    "final_migration_rows_count", "other_backend_count_before", "other_backend_count_after",
    "database_default_transaction_read_only", "migration_transaction_read_only", "engine_result_sha256",
}
ACTIVE_FENCE_FIELDS = {
    "schema_version", "contract", "status", "promotion_id", "migration_operation_id",
    "execution_authorization_sha256", "grant_sha256", "database_name",
    "database_system_identifier", "database_oid", "database_marker", "released_baseline_sha256",
    "fence_before_sha256", "activated_at", "active_fence_sha256",
}
CANDIDATE_FIELDS = {
    "schema_version", "contract", "status", "promotion_id", "migration_operation_id", "grant_sha256",
    "container_id", "container_name", "worker_image", "created_at", "candidate_sha256",
}
MIGRATION_EXECUTION_INTENT_FIELDS = {
    "schema_version", "contract", "execution_scope", "migration_operation_id",
    "migration_authorization_operation_id", "promotion_id", "promotion_generation", "created_at", "expires_at",
    "execution_authorization_sha256", "migration_approval_authorization_sha256", "supervisor_bundle_sha256",
    "parameters", "promotion_intent_sha256", "previous_checkpoint_receipt_sha256",
    "migration_authorization_intent_sha256", "candidate_binding_sha256", "database_binding_sha256",
    "runtime_binding_sha256", "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256",
    "writer_quiesce_binding_sha256", "migration_authorization_binding_sha256", "grant_sha256",
    "migration_execution_intent_sha256",
}


class MigrationControlError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def reject(code: str) -> None:
    raise MigrationControlError(code)


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def object_sha256(value: Any) -> str:
    return sha256(canonical_json(value))


def operation_artifact_matches(name: str, operation_id: str) -> bool:
    matched = re.fullmatch(r"(.+)\.([0-9a-f]{64})\.json", name)
    return matched is not None and matched.group(1) == operation_id


def strict_json(raw: bytes, code: str) -> Any:
    if len(raw) < 2 or len(raw) > MAX_JSON_BYTES:
        reject(code)

    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                reject(code)
            result[key] = value
        return result

    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs)
    except (UnicodeDecodeError, json.JSONDecodeError):
        reject(code)
    return value


def exact(value: Any, fields: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != fields:
        reject(code)
    return value


def instant(value: Any, code: str) -> datetime:
    if not isinstance(value, str) or not ISO_UTC.fullmatch(value):
        reject(code)
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except ValueError:
        reject(code)
    return parsed


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def trusted_directory(path: Path, modes: set[int], code: str, *, gid: int = 0) -> os.stat_result:
    try:
        value = os.lstat(path)
    except OSError:
        reject(code)
    if not path.is_absolute() or path == Path("/") or not stat.S_ISDIR(value.st_mode) or stat.S_ISLNK(value.st_mode) \
            or value.st_uid != 0 or value.st_gid != gid or stat.S_IMODE(value.st_mode) not in modes:
        reject(code)
    return value


def trusted_file(path: Path, mode: int, code: str, *, maximum: int = MAX_JSON_BYTES,
                 expected_sha256: str | None = None, read: bool = True) -> bytes:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    try:
        before = os.lstat(path)
        descriptor = os.open(path, flags)
    except OSError:
        reject(code)
    try:
        opened = os.fstat(descriptor)
        identities = (before.st_dev, before.st_ino, before.st_mode, before.st_nlink, before.st_uid, before.st_gid,
                      before.st_size, before.st_mtime_ns, before.st_ctime_ns)
        opened_identity = (opened.st_dev, opened.st_ino, opened.st_mode, opened.st_nlink, opened.st_uid,
                           opened.st_gid, opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns)
        if identities != opened_identity or not stat.S_ISREG(opened.st_mode) or stat.S_ISLNK(before.st_mode) \
                or opened.st_uid != 0 or opened.st_gid != 0 or opened.st_nlink != 1 \
                or stat.S_IMODE(opened.st_mode) != mode or opened.st_size < 1 or opened.st_size > maximum:
            reject(code)
        raw = b""
        if read:
            while len(raw) <= maximum:
                block = os.read(descriptor, min(65536, maximum + 1 - len(raw)))
                if not block:
                    break
                raw += block
            if len(raw) != opened.st_size:
                reject(code)
        after = os.fstat(descriptor)
        pointed = os.lstat(path)
        after_identity = (after.st_dev, after.st_ino, after.st_mode, after.st_nlink, after.st_uid,
                          after.st_gid, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
        pointed_identity = (pointed.st_dev, pointed.st_ino, pointed.st_mode, pointed.st_nlink, pointed.st_uid,
                            pointed.st_gid, pointed.st_size, pointed.st_mtime_ns, pointed.st_ctime_ns)
        if opened_identity != after_identity or opened_identity != pointed_identity:
            reject(code)
        if expected_sha256 is not None and (not read or sha256(raw) != expected_sha256):
            reject(code)
        return raw
    finally:
        os.close(descriptor)


def sync_directory(path: Path, code: str) -> None:
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    except OSError:
        reject(code)


def ensure_directory(path: Path, mode: int, code: str) -> None:
    try:
        os.mkdir(path, mode)
        os.chown(path, 0, 0)
        os.chmod(path, mode)
        sync_directory(path.parent, code)
    except FileExistsError:
        pass
    except OSError:
        reject(code)
    trusted_directory(path, {mode}, code)


def immutable_file(path: Path, raw: bytes, mode: int, code: str, *, maximum: int = MAX_JSON_BYTES) -> None:
    if len(raw) < 1 or len(raw) > maximum:
        reject(code)
    try:
        descriptor = os.open(
            path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0),
            0o600,
        )
    except FileExistsError:
        existing = trusted_file(path, mode, code, maximum=maximum)
        if existing != raw:
            reject(code)
        return
    except OSError:
        reject(code)
    try:
        offset = 0
        while offset < len(raw):
            offset += os.write(descriptor, raw[offset:])
        os.fchown(descriptor, 0, 0)
        os.fchmod(descriptor, mode)
        os.fsync(descriptor)
    except OSError:
        reject(code)
    finally:
        os.close(descriptor)
    sync_directory(path.parent, code)
    if trusted_file(path, mode, code, maximum=maximum) != raw:
        reject(code)


def directory_identity(path: Path, modes: set[int], code: str) -> tuple[int, ...]:
    value = trusted_directory(path, modes, code)
    try:
        if Path(os.path.realpath(path)) != path:
            reject(code)
    except OSError:
        reject(code)
    return (
        value.st_dev, value.st_ino, value.st_mode, value.st_nlink, value.st_uid, value.st_gid,
        value.st_size, value.st_mtime_ns, value.st_ctime_ns,
    )


def trusted_source(spec: Any, expected_path: Path, mode: int, code: str) -> bytes:
    fields = {"path", "sha256", "bytes", "device", "inode", "uid", "gid", "mode", "nlink"}
    value = exact(spec, fields, code)
    if value.get("path") != str(expected_path) or value.get("mode") != f"{mode:04o}" \
            or value.get("uid") != 0 or value.get("gid") != 0 or value.get("nlink") != 1 \
            or not isinstance(value.get("bytes"), int) or not 2 <= value["bytes"] <= MAX_JSON_BYTES \
            or not isinstance(value.get("sha256"), str) or not SHA256.fullmatch(value["sha256"]):
        reject(code)
    raw = trusted_file(expected_path, mode, code, maximum=MAX_JSON_BYTES, expected_sha256=value["sha256"])
    metadata = os.lstat(expected_path)
    if len(raw) != value["bytes"] or str(metadata.st_dev) != value.get("device") \
            or str(metadata.st_ino) != value.get("inode"):
        reject(code)
    return raw


def stage_release_bundle(source_root: Path, target_root: Path, manifest_raw: bytes) -> None:
    before = directory_identity(source_root, {0o750}, "MIGRATION_CONTROL_MANIFEST_ROOT_INVALID")
    try:
        names = sorted(os.listdir(source_root))
    except OSError:
        reject("MIGRATION_CONTROL_MANIFEST_ROOT_INVALID")
    if not 2 <= len(names) <= MAX_ARTIFACT_FILES \
            or any(name in (".", "..") or "/" in name or "\x00" in name for name in names):
        reject("MIGRATION_CONTROL_MANIFEST_ROOT_INVALID")
    total = 0
    for name in names:
        raw = trusted_file(
            source_root / name, 0o440, "MIGRATION_CONTROL_MANIFEST_BUNDLE_INVALID",
            maximum=MAX_ARTIFACT_FILE_BYTES,
        )
        total += len(raw)
        if total > MAX_ARTIFACT_BUNDLE_BYTES:
            reject("MIGRATION_CONTROL_MANIFEST_BUNDLE_INVALID")
        if name == "release-manifest.json" and raw != manifest_raw:
            reject("MIGRATION_CONTROL_MANIFEST_BUNDLE_INVALID")
        if name == ".chenyida-erp-release-artifact-root-v1" \
                and raw != b"chenyida-erp-release-artifact-root/v1\n":
            reject("MIGRATION_CONTROL_MANIFEST_BUNDLE_INVALID")
        immutable_file(
            target_root / name, raw, 0o440, "MIGRATION_CONTROL_MANIFEST_BUNDLE_INVALID",
            maximum=MAX_ARTIFACT_FILE_BYTES,
        )
    if "release-manifest.json" not in names or ".chenyida-erp-release-artifact-root-v1" not in names \
            or directory_identity(source_root, {0o750}, "MIGRATION_CONTROL_MANIFEST_ROOT_CHANGED") != before:
        reject("MIGRATION_CONTROL_MANIFEST_ROOT_CHANGED")


def validate_lock() -> int:
    if os.environ.get("ERP_RELEASE_GATE_LOCK_HELD") != "YES":
        reject("MIGRATION_CONTROL_LOCK_INVALID")
    try:
        descriptor = int(os.environ.get("ERP_RELEASE_GATE_LOCK_FD", ""))
        opened = os.fstat(descriptor)
        pointed = os.lstat(LOCK_FILE)
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (ValueError, OSError, BlockingIOError):
        reject("MIGRATION_CONTROL_LOCK_INVALID")
    if not stat.S_ISREG(opened.st_mode) or opened.st_uid != 0 or opened.st_gid != 0 \
            or stat.S_IMODE(opened.st_mode) != 0o600 or opened.st_dev != pointed.st_dev \
            or opened.st_ino != pointed.st_ino or stat.S_ISLNK(pointed.st_mode):
        reject("MIGRATION_CONTROL_LOCK_INVALID")
    return descriptor


def validate_context(value: Any, expected_grant_sha256: str) -> tuple[dict[str, Any], dict[str, Any]]:
    context = exact(value, CONTEXT_FIELDS, "MIGRATION_CONTROL_CONTEXT_INVALID")
    parameters = exact(context["parameters"], PARAMETER_FIELDS, "MIGRATION_CONTROL_PARAMETERS_INVALID")
    if context["schema_version"] != 1 or context["contract"] != "chenyida-erp-uat-promotion-transaction-context/v1" \
            or context["operation"] != "MIGRATION_EXECUTION" or context["execution_mode"] != "ORIGINAL" \
            or context["operation_id"] != context["execution_authorization_id"] \
            or context["execution_authorization_sha256"] != context["original_authorization_sha256"] \
            or context["expected_intent_sha256"] is not None:
        reject("MIGRATION_CONTROL_CONTEXT_INVALID")
    for field in ("operation_id", "execution_authorization_id"):
        if not isinstance(context[field], str) or not IDENTIFIER.fullmatch(context[field]):
            reject("MIGRATION_CONTROL_CONTEXT_INVALID")
    for field in ("execution_authorization_sha256", "supervisor_bundle_sha256"):
        if not isinstance(context[field], str) or not SHA256.fullmatch(context[field]) or context[field] == ZERO_SHA256:
            reject("MIGRATION_CONTROL_CONTEXT_INVALID")
    if parameters.get("promotion_state_root") != str(STATE_ROOT):
        reject("MIGRATION_CONTROL_CONTEXT_INVALID")
    if os.environ.get("ERP_RELEASE_SUPERVISOR_LAUNCHED") != "YES" \
            or os.environ.get("ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED") != "YES" \
            or os.environ.get("ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256") != context["execution_authorization_sha256"] \
            or os.environ.get("ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256") != context["supervisor_bundle_sha256"]:
        reject("MIGRATION_CONTROL_CONTEXT_INVALID")
    if not SHA256.fullmatch(expected_grant_sha256) or expected_grant_sha256 == ZERO_SHA256:
        reject("MIGRATION_CONTROL_GRANT_INVALID")
    created = instant(parameters["execution_created_at"], "MIGRATION_CONTROL_TIME_INVALID")
    expires = instant(parameters["execution_expires_at"], "MIGRATION_CONTROL_TIME_INVALID")
    current = datetime.now(timezone.utc)
    if expires <= created or (expires - created).total_seconds() > 15 * 60 \
            or current >= expires or (created - current).total_seconds() > 5:
        reject("MIGRATION_CONTROL_TIME_INVALID")
    return context, parameters


def validate_recovery_context(value: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    context = exact(value, CONTEXT_FIELDS, "MIGRATION_CONTROL_RECOVERY_CONTEXT_INVALID")
    parameters = exact(context["parameters"], PARAMETER_FIELDS, "MIGRATION_CONTROL_RECOVERY_CONTEXT_INVALID")
    if context["schema_version"] != 1 \
            or context["contract"] != "chenyida-erp-uat-promotion-transaction-context/v1" \
            or context["operation"] != "MIGRATION_EXECUTION" or context["execution_mode"] != "RECOVERY" \
            or context["operation_id"] == context["execution_authorization_id"] \
            or context["execution_authorization_sha256"] == context["original_authorization_sha256"] \
            or parameters.get("promotion_state_root") != str(STATE_ROOT):
        reject("MIGRATION_CONTROL_RECOVERY_CONTEXT_INVALID")
    for field in ("operation_id", "execution_authorization_id"):
        if not isinstance(context[field], str) or not IDENTIFIER.fullmatch(context[field]):
            reject("MIGRATION_CONTROL_RECOVERY_CONTEXT_INVALID")
    for field in ("execution_authorization_sha256", "original_authorization_sha256",
                  "supervisor_bundle_sha256", "expected_intent_sha256"):
        if not isinstance(context[field], str) or not SHA256.fullmatch(context[field]) \
                or context[field] == ZERO_SHA256:
            reject("MIGRATION_CONTROL_RECOVERY_CONTEXT_INVALID")
    if os.environ.get("ERP_RELEASE_SUPERVISOR_LAUNCHED") != "YES" \
            or os.environ.get("ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED") != "YES" \
            or os.environ.get("ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED") != "YES" \
            or os.environ.get("ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256") \
            != context["execution_authorization_sha256"] \
            or os.environ.get("ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256") != context["supervisor_bundle_sha256"]:
        reject("MIGRATION_CONTROL_RECOVERY_CONTEXT_INVALID")
    instant(context["execution_created_at"], "MIGRATION_CONTROL_RECOVERY_CONTEXT_INVALID")
    return context, parameters


def validate_manifest(raw: bytes, parameters: dict[str, Any]) -> dict[str, Any]:
    value = strict_json(raw, "MIGRATION_CONTROL_MANIFEST_INVALID")
    if raw != canonical_json(value) or not isinstance(value, dict) or value.get("schema_version") != 2 \
            or value.get("contract") != "chenyida-erp-release-manifest/v2" or value.get("promotion_status") != "ELIGIBLE" \
            or value.get("allowed_deployment_classes") != ["UAT"]:
        reject("MIGRATION_CONTROL_MANIFEST_INVALID")
    try:
        worker = value["images"]["worker"]
        migrations = value["migrations"]
        source = value["source"]
        entries = migrations["entries"]
    except (KeyError, TypeError):
        reject("MIGRATION_CONTROL_MANIFEST_INVALID")
    if not isinstance(worker, dict) or not isinstance(migrations, dict) or not isinstance(source, dict) \
            or worker.get("image_reference") != parameters["worker_image"] \
            or not isinstance(worker.get("image_digest"), str) \
            or not IMAGE_DIGEST.fullmatch(worker["image_digest"]) \
            or migrations.get("head") != parameters["target_migration_head"] \
            or migrations.get("allowlist_sha256") != parameters["migration_manifest_sha256"] \
            or not isinstance(source.get("package_version"), str) or not re.fullmatch(r"0\.1\.0-alpha\.[0-9]+", source["package_version"]) \
            or not isinstance(source.get("git_commit"), str) or not re.fullmatch(r"[0-9a-f]{40}", source["git_commit"]):
        reject("MIGRATION_CONTROL_MANIFEST_INVALID")
    if not isinstance(entries, list) or not 1 <= len(entries) <= 10_000:
        reject("MIGRATION_CONTROL_MANIFEST_INVALID")
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict) or set(entry) != {"ordinal", "filename", "sha256"} \
                or entry["ordinal"] != index + 1 or not isinstance(entry["filename"], str) \
                or not MIGRATION.fullmatch(entry["filename"]) or not isinstance(entry["sha256"], str) \
                or not SHA256.fullmatch(entry["sha256"]):
            reject("MIGRATION_CONTROL_MANIFEST_INVALID")
        if index and entry["filename"] <= entries[index - 1]["filename"]:
            reject("MIGRATION_CONTROL_MANIFEST_INVALID")
    if entries[-1]["filename"] != parameters["target_migration_head"] \
            or parameters["expected_current_migration_head"] != "EMPTY" \
            and not any(entry["filename"] == parameters["expected_current_migration_head"] for entry in entries):
        reject("MIGRATION_CONTROL_MANIFEST_INVALID")
    return value


def validate_grant(raw: bytes, context: dict[str, Any], parameters: dict[str, Any], expected_sha256: str) -> dict[str, Any]:
    value = exact(strict_json(raw, "MIGRATION_CONTROL_GRANT_INVALID"), GRANT_FIELDS, "MIGRATION_CONTROL_GRANT_INVALID")
    body = {key: item for key, item in value.items() if key != "grant_sha256"}
    database = value.get("database")
    if raw != canonical_json(value) or value.get("schema_version") != 1 \
            or value.get("contract") != "chenyida-erp-uat-promotion-migration-execution-grant/v1" \
            or value.get("execution_scope") != "SUPERVISOR_CONTROLLED_UAT_MIGRATION" \
            or value.get("grant_sha256") != expected_sha256 or object_sha256(body) != expected_sha256 \
            or not isinstance(database, dict):
        reject("MIGRATION_CONTROL_GRANT_INVALID")
    expected = {
        "promotion_id": parameters["promotion_id"],
        "migration_operation_id": context["operation_id"],
        "execution_authorization_sha256": context["execution_authorization_sha256"],
        "migration_approval_authorization_sha256": parameters["migration_approval_authorization_sha256"],
        "migration_approval_receipt_sha256": parameters["previous_checkpoint_receipt_sha256"],
        "migration_authorization_binding_sha256": parameters["migration_authorization_binding_sha256"],
        "promotion_intent_sha256": parameters["promotion_intent_sha256"],
        "candidate_binding_sha256": parameters["candidate_binding_sha256"],
        "database_binding_sha256": parameters["database_binding_sha256"],
        "runtime_binding_sha256": parameters["runtime_binding_sha256"],
        "recovery_binding_sha256": parameters["preupgrade_recovery_binding_sha256"],
        "promotion_snapshot_binding_sha256": parameters["promotion_snapshot_binding_sha256"],
        "writer_quiesce_binding_sha256": parameters["writer_quiesce_binding_sha256"],
        "supervisor_bundle_sha256": context["supervisor_bundle_sha256"],
        "release_manifest_sha256": parameters["release_manifest_sha256"],
        "worker_image": parameters["worker_image"],
        "migration_manifest_sha256": parameters["migration_manifest_sha256"],
        "expected_current_head": parameters["expected_current_migration_head"],
        "target_head": parameters["target_migration_head"],
        "created_at": parameters["execution_created_at"],
        "expires_at": parameters["execution_expires_at"],
    }
    if any(value.get(key) != item for key, item in expected.items()) or database != {
        "deployment_class": parameters["deployment_class"], "deployment_id": parameters["deployment_id"],
        "database_name": parameters["database_name"],
        "database_system_identifier": parameters["database_system_identifier"],
        "database_oid": parameters["database_oid"], "database_marker": parameters["database_marker"],
        "migration_role": parameters["migration_role"], "control_role": parameters["control_role"],
    }:
        reject("MIGRATION_CONTROL_GRANT_BINDING_INVALID")
    return value


def docker_identity() -> tuple[int, ...]:
    try:
        value = os.lstat(DOCKER)
    except OSError:
        reject("MIGRATION_CONTROL_DOCKER_INVALID")
    if not stat.S_ISREG(value.st_mode) or stat.S_ISLNK(value.st_mode) or value.st_uid != 0 or value.st_gid != 0 \
            or value.st_nlink != 1 or stat.S_IMODE(value.st_mode) & 0o022:
        reject("MIGRATION_CONTROL_DOCKER_INVALID")
    return value.st_dev, value.st_ino, value.st_mode, value.st_uid, value.st_gid, value.st_size, value.st_mtime_ns, value.st_ctime_ns


def docker(arguments: list[str], *, timeout: int, input_raw: bytes | None = None,
           require_success: bool = True, maximum: int = 2 * 1024 * 1024) -> subprocess.CompletedProcess[bytes]:
    before = docker_identity()
    environment = {"PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent"}
    try:
        result = subprocess.run(
            [str(DOCKER), *arguments], env=environment, input=input_raw, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, check=False, timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError):
        reject("MIGRATION_CONTROL_DOCKER_FAILED")
    if docker_identity() != before or len(result.stdout) > maximum or len(result.stderr) > maximum \
            or require_success and (result.returncode != 0 or result.stderr != b""):
        reject("MIGRATION_CONTROL_DOCKER_FAILED")
    return result


def docker_inspect(kind: str, target: str) -> dict[str, Any]:
    result = docker([kind, "inspect", target], timeout=20)
    value = strict_json(result.stdout, "MIGRATION_CONTROL_DOCKER_INSPECT_INVALID")
    if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
        reject("MIGRATION_CONTROL_DOCKER_INSPECT_INVALID")
    return value[0]


def load_quiesce_evidence(parameters: dict[str, Any]) -> dict[str, Any]:
    approval_source = parameters.get("migration_authorization_intent_source")
    if not isinstance(approval_source, dict) or not isinstance(approval_source.get("path"), str):
        reject("MIGRATION_CONTROL_QUIESCE_SOURCE_INVALID")
    approval_path = Path(approval_source["path"])
    expected_approval_path = STATE_ROOT / "intents" / (
        f"{parameters['migration_authorization_operation_id']}."
        f"{parameters['migration_authorization_intent_sha256']}.json"
    )
    if approval_path != expected_approval_path:
        reject("MIGRATION_CONTROL_QUIESCE_SOURCE_INVALID")
    approval_raw = trusted_source(
        approval_source, approval_path, 0o400,
        "MIGRATION_CONTROL_QUIESCE_SOURCE_INVALID",
    )
    approval = strict_json(approval_raw, "MIGRATION_CONTROL_QUIESCE_SOURCE_INVALID")
    if approval_raw != canonical_json(approval) or not isinstance(approval, dict) \
            or approval.get("migration_authorization_intent_sha256") \
            != parameters["migration_authorization_intent_sha256"] \
            or approval.get("writer_quiesce_binding_sha256") != parameters["writer_quiesce_binding_sha256"] \
            or object_sha256({key: value for key, value in approval.items()
                              if key != "migration_authorization_intent_sha256"}) \
            != parameters["migration_authorization_intent_sha256"] \
            or not isinstance(approval.get("parameters"), dict):
        reject("MIGRATION_CONTROL_QUIESCE_SOURCE_INVALID")
    quiesce_source = approval["parameters"].get("quiesce_intent_source")
    quiesce_operation_id = approval["parameters"].get("quiesce_operation_id")
    quiesce_intent_sha256 = approval["parameters"].get("quiesce_intent_sha256")
    if not isinstance(quiesce_source, dict) or not isinstance(quiesce_operation_id, str) \
            or not IDENTIFIER.fullmatch(quiesce_operation_id) or not isinstance(quiesce_intent_sha256, str) \
            or not SHA256.fullmatch(quiesce_intent_sha256):
        reject("MIGRATION_CONTROL_QUIESCE_SOURCE_INVALID")
    quiesce_path = STATE_ROOT / "intents" / f"{quiesce_operation_id}.{quiesce_intent_sha256}.json"
    quiesce_raw = trusted_source(
        quiesce_source, quiesce_path, 0o400, "MIGRATION_CONTROL_QUIESCE_SOURCE_INVALID",
    )
    quiesce = strict_json(quiesce_raw, "MIGRATION_CONTROL_QUIESCE_SOURCE_INVALID")
    if quiesce_raw != canonical_json(quiesce) or not isinstance(quiesce, dict) \
            or quiesce.get("quiesce_intent_sha256") != quiesce_intent_sha256 \
            or quiesce.get("writer_quiesce_binding_sha256") != parameters["writer_quiesce_binding_sha256"] \
            or object_sha256({key: value for key, value in quiesce.items() if key != "quiesce_intent_sha256"}) \
            != quiesce_intent_sha256 or not isinstance(quiesce.get("quiesce_evidence"), dict):
        reject("MIGRATION_CONTROL_QUIESCE_SOURCE_INVALID")
    evidence = quiesce["quiesce_evidence"]
    if evidence.get("status") != "CONTINUED_QUIESCE_VERIFIED" \
            or evidence.get("compose_project") != "chenyida-erp" \
            or evidence.get("project_container_count") != 4 \
            or evidence.get("allowed_running_services") != ["caddy", "postgres"] \
            or not isinstance(evidence.get("compose_project_root"), str) \
            or not isinstance(evidence.get("project_inventory_sha256"), str) \
            or not SHA256.fullmatch(evidence["project_inventory_sha256"]):
        reject("MIGRATION_CONTROL_QUIESCE_SOURCE_INVALID")
    return evidence


def verify_live_writer_quiesce(evidence: dict[str, Any]) -> None:
    listed = docker([
        "container", "ls", "--all", "--no-trunc", "--quiet", "--filter",
        "label=com.docker.compose.project=chenyida-erp",
    ], timeout=20).stdout.decode("ascii", errors="strict").strip()
    ids = [] if listed == "" else listed.splitlines()
    if len(ids) != 4 or len(set(ids)) != 4 or any(not CONTAINER_ID.fullmatch(item) for item in ids):
        reject("MIGRATION_CONTROL_WRITER_QUIESCE_STALE")
    records: list[dict[str, Any]] = []
    by_service: dict[str, dict[str, Any]] = {}
    for container_id in ids:
        value = docker_inspect("container", container_id)
        try:
            labels = value["Config"]["Labels"]
            state = value["State"]
        except (KeyError, TypeError):
            reject("MIGRATION_CONTROL_WRITER_QUIESCE_STALE")
        service = labels.get("com.docker.compose.service") if isinstance(labels, dict) else None
        name = value.get("Name")
        name = name[1:] if isinstance(name, str) and name.startswith("/") else name
        record = {
            "id": value.get("Id"), "name": name, "service": service, "image_digest": value.get("Image"),
            "project": labels.get("com.docker.compose.project"),
            "working_directory": labels.get("com.docker.compose.project.working_dir"),
            "config_hash": labels.get("com.docker.compose.config-hash"),
            "container_number": labels.get("com.docker.compose.container-number"),
            "oneoff": labels.get("com.docker.compose.oneoff"),
            "running": state.get("Running"), "restarting": state.get("Restarting"),
            "paused": state.get("Paused"), "dead": state.get("Dead"), "oom_killed": state.get("OOMKilled"),
            "status": state.get("Status"), "restart_count": value.get("RestartCount"),
        }
        if service not in {"caddy", "postgres", "web", "worker"} or service in by_service \
                or record["project"] != "chenyida-erp" \
                or record["working_directory"] != evidence["compose_project_root"] \
                or record["container_number"] != "1" or record["oneoff"] != "False" \
                or not isinstance(record["config_hash"], str) \
                or not SHA256.fullmatch(record["config_hash"]):
            reject("MIGRATION_CONTROL_WRITER_QUIESCE_STALE")
        by_service[service] = {"value": value, "record": record, "labels": labels, "state": state}
        records.append(record)
    if object_sha256(sorted(records, key=lambda item: item["service"])) != evidence["project_inventory_sha256"]:
        reject("MIGRATION_CONTROL_WRITER_QUIESCE_STALE")
    for service in ("web", "worker"):
        expected = evidence.get(service)
        actual = by_service[service]
        value = actual["value"]
        state = actual["state"]
        labels = actual["labels"]
        if not isinstance(expected, dict) or actual["record"]["id"] != expected.get("container_id") \
                or actual["record"]["name"] != expected.get("container_name") \
                or actual["record"]["image_digest"] != expected.get("image_digest") \
                or value.get("Created") != expected.get("created_at") \
                or state.get("StartedAt") != expected.get("last_started_at") \
                or state.get("FinishedAt") != expected.get("last_finished_at") \
                or state.get("Running") is not False or state.get("Restarting") is not False \
                or state.get("Paused") is not False or state.get("Dead") is not False \
                or state.get("OOMKilled") is not False or state.get("Status") != "exited" \
                or state.get("ExitCode") != 0 or value.get("RestartCount") != 0 \
                or labels.get("org.opencontainers.image.version") != expected.get("application_version") \
                or labels.get("org.opencontainers.image.revision") != expected.get("git_commit"):
            reject("MIGRATION_CONTROL_WRITER_QUIESCE_STALE")


def validate_postgres_container(parameters: dict[str, Any]) -> None:
    value = docker_inspect("container", parameters["postgres_container_id"])
    try:
        labels = value["Config"]["Labels"]
        state = value["State"]
        networks = value["NetworkSettings"]["Networks"]
    except (KeyError, TypeError):
        reject("MIGRATION_CONTROL_POSTGRES_INVALID")
    if value.get("Id") != parameters["postgres_container_id"] or value.get("Name") != f"/{parameters['postgres_container']}" \
            or value.get("Image") != parameters["postgres_image_digest"] or state.get("Running") is not True \
            or state.get("Restarting") is not False or state.get("Paused") is not False or state.get("Dead") is not False \
            or state.get("OOMKilled") is not False or value.get("RestartCount") != 0 \
            or not isinstance(state.get("Health"), dict) or state["Health"].get("Status") != "healthy" \
            or not isinstance(labels, dict) or labels.get("com.docker.compose.project") != "chenyida-erp" \
            or labels.get("com.docker.compose.service") != "postgres" \
            or not isinstance(networks, dict) or set(networks) != {parameters["backend_network"]}:
        reject("MIGRATION_CONTROL_POSTGRES_INVALID")


def validate_candidate_image(parameters: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any]:
    value = docker_inspect("image", parameters["worker_image"])
    config = value.get("Config")
    expected = manifest["images"]["worker"]
    if value.get("Id") != expected["image_digest"] or parameters["worker_image"] not in (value.get("RepoDigests") or []) \
            or not isinstance(config, dict) or config.get("User") != "65532:65532" \
            or config.get("WorkingDir") != "/app" or not isinstance(config.get("Labels"), dict) \
            or config["Labels"].get("org.opencontainers.image.version") != manifest["source"]["package_version"] \
            or config["Labels"].get("org.opencontainers.image.revision") != manifest["source"]["git_commit"]:
        reject("MIGRATION_CONTROL_CANDIDATE_IMAGE_INVALID")
    return value


BASELINE_PROBE_SQL = r"""
with target as (
  select * from pg_catalog.pg_database where datname='chenyida_erp'
), expected_roles as (
  select unnest(array[
    'chenyida_erp_admin','chenyida_erp_admin_priv','chenyida_erp_backup','chenyida_erp_backup_priv',
    'chenyida_erp_owner','chenyida_erp_web','chenyida_erp_web_priv','chenyida_erp_worker','chenyida_erp_worker_priv'
  ]::text[]) as rolname
), expanded as (
  select a.grantor,a.grantee,a.privilege_type,a.is_grantable from target t
  cross join lateral pg_catalog.aclexplode(coalesce(t.datacl,pg_catalog.acldefault('d',t.datdba))) a
)
select pg_catalog.json_build_object(
  'database_name',t.datname::text,
  'database_system_identifier',(select system_identifier::text from pg_catalog.pg_control_system()),
  'database_oid',t.oid::text,
  'database_marker',pg_catalog.shobj_description(t.oid,'pg_database'),
  'database_owner',pg_catalog.pg_get_userbyid(t.datdba)::text,
  'database_allow_connections',t.datallowconn,
  'database_connection_limit',t.datconnlimit::integer,
  'database_setting_count',(select count(*)::integer from pg_catalog.pg_db_role_setting s
    cross join lateral unnest(s.setconfig) value where s.setdatabase=t.oid),
  'other_backend_count',(select count(*)::integer from pg_catalog.pg_stat_activity a where a.datid=t.oid),
  'prepared_transaction_count',(select count(*)::integer from pg_catalog.pg_prepared_xacts x where x.database=t.datname),
  'role_records',coalesce((select pg_catalog.json_agg(pg_catalog.json_build_object(
    'role',r.rolname::text,'login',r.rolcanlogin,'inherit',r.rolinherit,
    'connection_limit',r.rolconnlimit::integer,'superuser',r.rolsuper,'create_role',r.rolcreaterole,
    'create_database',r.rolcreatedb,'replication',r.rolreplication,'bypass_rls',r.rolbypassrls,
    'valid_until_absent',r.rolvaliduntil is null,
    'settings_absent',r.rolconfig is null and not exists(
      select 1 from pg_catalog.pg_db_role_setting s where s.setrole=r.oid
    )) order by r.rolname) from pg_catalog.pg_roles r join expected_roles e on e.rolname=r.rolname),'[]'::json),
  'memberships',coalesce((select pg_catalog.json_agg(pg_catalog.json_build_object(
    'role',granted.rolname::text,'member',member.rolname::text,'grantor',grantor.rolname::text,
    'admin_option',m.admin_option,'inherit_option',m.inherit_option,'set_option',m.set_option
  ) order by granted.rolname,member.rolname) from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles granted on granted.oid=m.roleid
    join pg_catalog.pg_roles member on member.oid=m.member
    join pg_catalog.pg_roles grantor on grantor.oid=m.grantor
    where granted.rolname in (select rolname from expected_roles)
       or member.rolname in (select rolname from expected_roles)),'[]'::json),
  'database_acl',coalesce((select pg_catalog.json_agg(pg_catalog.json_build_object(
    'grantee',pg_catalog.pg_get_userbyid(e.grantee)::text,
    'grantor',pg_catalog.pg_get_userbyid(e.grantor)::text,
    'privilege',e.privilege_type::text,'grantable',e.is_grantable
  ) order by pg_catalog.pg_get_userbyid(e.grantee),e.privilege_type)
    from expanded e where e.grantee<>t.datdba and e.grantee<>0),'[]'::json),
  'connect_roles',coalesce((select pg_catalog.array_agg(r.rolname::text order by r.rolname)
    from pg_catalog.pg_roles r join expected_roles e on e.rolname=r.rolname
    where r.rolcanlogin and pg_catalog.has_database_privilege(r.oid,t.oid,'CONNECT')),array[]::text[]),
  'platform_superuser_roles',coalesce((select pg_catalog.array_agg(r.rolname::text order by r.rolname)
    from pg_catalog.pg_roles r where r.rolsuper),array[]::text[]),
  'public_connect',exists(select 1 from expanded e where e.grantee=0 and e.privilege_type='CONNECT'),
  'public_temporary',exists(select 1 from expanded e where e.grantee=0 and e.privilege_type='TEMPORARY'),
  'unknown_connect_login_count',(select count(*)::integer from pg_catalog.pg_roles r where r.rolcanlogin
    and not r.rolsuper and not exists(select 1 from expected_roles e where e.rolname=r.rolname)
    and pg_catalog.has_database_privilege(r.oid,t.oid,'CONNECT')),
  'owner_privileges',array[
    case when pg_catalog.has_database_privilege(t.datdba,t.oid,'CONNECT') then 'CONNECT' end,
    case when pg_catalog.has_database_privilege(t.datdba,t.oid,'CREATE') then 'CREATE' end,
    case when pg_catalog.has_database_privilege(t.datdba,t.oid,'TEMPORARY') then 'TEMPORARY' end
  ]::text[]
) from target t;
"""

FENCE_INSTALL_SQL = r"""
\set ON_ERROR_STOP on
begin;
create temporary table pg_temp.chenyida_erp_migration_expected (
  database_oid text not null,
  system_identifier text not null,
  marker text not null
) on commit drop;
insert into pg_temp.chenyida_erp_migration_expected values (
  :'expected_database_oid', :'expected_system_identifier', :'expected_marker'
);
do $fence$
declare target pg_catalog.pg_database%rowtype;
begin
  select * into strict target from pg_catalog.pg_database where datname='chenyida_erp';
  if target.oid::text is distinct from (select database_oid from pg_temp.chenyida_erp_migration_expected)
     or (select system_identifier::text from pg_catalog.pg_control_system())
       is distinct from (select system_identifier from pg_temp.chenyida_erp_migration_expected)
     or pg_catalog.shobj_description(target.oid,'pg_database')
       is distinct from (select marker from pg_temp.chenyida_erp_migration_expected)
     or target.datdba <> (select oid from pg_catalog.pg_roles where rolname='chenyida_erp_owner')
     or target.datallowconn is not true or target.datconnlimit<>64
     or exists (select 1 from pg_catalog.pg_db_role_setting s where s.setdatabase=target.oid)
     or exists (select 1 from pg_catalog.pg_prepared_xacts where database='chenyida_erp')
     or exists (select 1 from pg_catalog.pg_stat_activity where datid=target.oid)
     or (select count(*) from pg_catalog.pg_roles where rolname in (
       'chenyida_erp_admin','chenyida_erp_admin_priv','chenyida_erp_backup','chenyida_erp_backup_priv',
       'chenyida_erp_owner','chenyida_erp_web','chenyida_erp_web_priv','chenyida_erp_worker','chenyida_erp_worker_priv'
     ))<>9
     or exists (
       select 1 from pg_catalog.pg_roles r where r.rolname in (
         'chenyida_erp_admin','chenyida_erp_admin_priv','chenyida_erp_backup','chenyida_erp_backup_priv',
         'chenyida_erp_owner','chenyida_erp_web','chenyida_erp_web_priv','chenyida_erp_worker','chenyida_erp_worker_priv'
       ) and (r.rolsuper or r.rolcreaterole or r.rolcreatedb or r.rolreplication or r.rolbypassrls
         or r.rolvaliduntil is not null or r.rolconfig is not null
         or r.rolcanlogin is distinct from (r.rolname in (
           'chenyida_erp_admin','chenyida_erp_backup','chenyida_erp_owner','chenyida_erp_web','chenyida_erp_worker'))
         or r.rolinherit is distinct from (r.rolname<>'chenyida_erp_owner')
         or r.rolconnlimit<>case r.rolname when 'chenyida_erp_admin' then 1
           when 'chenyida_erp_backup' then 2 when 'chenyida_erp_owner' then 1
           when 'chenyida_erp_web' then 12 when 'chenyida_erp_worker' then 6 else -1 end
         or exists(select 1 from pg_catalog.pg_db_role_setting s where s.setrole=r.oid))
     )
     or (select count(*) from pg_catalog.pg_auth_members m
       join pg_catalog.pg_roles g on g.oid=m.roleid join pg_catalog.pg_roles n on n.oid=m.member
       where g.rolname like 'chenyida\_erp\_%' escape '\' or n.rolname like 'chenyida\_erp\_%' escape '\')<>4
     or exists (
       select 1 from pg_catalog.pg_auth_members m
       join pg_catalog.pg_roles g on g.oid=m.roleid join pg_catalog.pg_roles n on n.oid=m.member
       join pg_catalog.pg_roles x on x.oid=m.grantor
       where (g.rolname like 'chenyida\_erp\_%' escape '\' or n.rolname like 'chenyida\_erp\_%' escape '\')
         and (x.rolname<>'postgres' or m.admin_option or not m.inherit_option or m.set_option
           or (g.rolname,n.rolname) not in (
             ('chenyida_erp_admin_priv','chenyida_erp_admin'),
             ('chenyida_erp_backup_priv','chenyida_erp_backup'),
             ('chenyida_erp_web_priv','chenyida_erp_web'),
             ('chenyida_erp_worker_priv','chenyida_erp_worker')))
     )
     or (select count(*) from pg_catalog.pg_database d
       cross join lateral pg_catalog.aclexplode(coalesce(d.datacl,pg_catalog.acldefault('d',d.datdba))) a
       where d.oid=target.oid and a.grantee<>d.datdba and a.grantee<>0)<>4
     or exists (
       select 1 from pg_catalog.pg_database d
       cross join lateral pg_catalog.aclexplode(coalesce(d.datacl,pg_catalog.acldefault('d',d.datdba))) a
       where d.oid=target.oid and a.grantee<>d.datdba and a.grantee<>0
         and (a.privilege_type<>'CONNECT' or a.is_grantable
           or pg_catalog.pg_get_userbyid(a.grantor)<>'chenyida_erp_owner'
           or pg_catalog.pg_get_userbyid(a.grantee) not in (
             'chenyida_erp_admin_priv','chenyida_erp_backup_priv','chenyida_erp_web_priv','chenyida_erp_worker_priv'))
     )
     or exists(select 1 from pg_catalog.pg_database d
       cross join lateral pg_catalog.aclexplode(coalesce(d.datacl,pg_catalog.acldefault('d',d.datdba))) a
       where d.oid=target.oid and a.grantee=0 and a.privilege_type in ('CONNECT','TEMPORARY'))
     or (select count(*) from pg_catalog.pg_roles r where r.rolsuper)<>1
     or not (select rolsuper from pg_catalog.pg_roles where rolname='postgres')
     or (select count(*) from pg_catalog.pg_roles r where r.rolcanlogin and not r.rolsuper
       and r.rolname not in ('chenyida_erp_admin','chenyida_erp_backup','chenyida_erp_owner','chenyida_erp_web','chenyida_erp_worker')
       and pg_catalog.has_database_privilege(r.oid,target.oid,'CONNECT'))<>0
     or not pg_catalog.has_database_privilege(target.datdba,target.oid,'CONNECT')
     or not pg_catalog.has_database_privilege(target.datdba,target.oid,'CREATE')
     or not pg_catalog.has_database_privilege(target.datdba,target.oid,'TEMPORARY') then
    raise exception 'migration fence precondition invalid';
  end if;
end
$fence$;
alter database chenyida_erp allow_connections false;
alter database chenyida_erp connection limit 0;
alter database chenyida_erp set default_transaction_read_only to 'on';
revoke connect on database chenyida_erp from chenyida_erp_admin_priv,chenyida_erp_backup_priv,
  chenyida_erp_web_priv,chenyida_erp_worker_priv;
commit;
do $terminate$
begin
  perform pg_catalog.pg_terminate_backend(pid)
    from pg_catalog.pg_stat_activity
   where datname='chenyida_erp' and pid<>pg_catalog.pg_backend_pid();
end
$terminate$;
do $sealed$
declare target pg_catalog.pg_database%rowtype;
begin
  select * into strict target from pg_catalog.pg_database where datname='chenyida_erp';
  if target.datallowconn is not false or target.datconnlimit<>0
     or exists(select 1 from pg_catalog.pg_stat_activity where datid=target.oid)
     or (select count(*) from pg_catalog.pg_db_role_setting s
       cross join lateral unnest(s.setconfig) v where s.setdatabase=target.oid)<>1
     or not exists(select 1 from pg_catalog.pg_db_role_setting s
       cross join lateral unnest(s.setconfig) v where s.setdatabase=target.oid and s.setrole=0
       and v='default_transaction_read_only=on') then
    raise exception 'migration fence sealing invalid';
  end if;
end
$sealed$;
begin;
alter database chenyida_erp allow_connections true;
alter database chenyida_erp connection limit 1;
commit;
"""

FENCE_SEAL_SQL = r"""
\set ON_ERROR_STOP on
begin;
do $seal$
declare target pg_catalog.pg_database%rowtype;
begin
  select * into strict target from pg_catalog.pg_database where datname='chenyida_erp';
  if target.oid::text is distinct from :'expected_database_oid'
     or (select system_identifier::text from pg_catalog.pg_control_system()) is distinct from :'expected_system_identifier'
     or pg_catalog.shobj_description(target.oid,'pg_database') is distinct from :'expected_marker'
     or target.datallowconn is not true or target.datconnlimit<>1
     or exists(select 1 from pg_catalog.pg_stat_activity where datid=target.oid)
     or (select count(*) from pg_catalog.pg_db_role_setting s
       cross join lateral unnest(s.setconfig) v where s.setdatabase=target.oid)<>1
     or not exists(select 1 from pg_catalog.pg_db_role_setting s
       cross join lateral unnest(s.setconfig) v where s.setdatabase=target.oid and s.setrole=0
       and v='default_transaction_read_only=on') then
    raise exception 'migration final fence precondition invalid';
  end if;
end
$seal$;
alter database chenyida_erp allow_connections false;
alter database chenyida_erp connection limit 0;
commit;
do $terminate$
begin
  perform pg_catalog.pg_terminate_backend(pid)
    from pg_catalog.pg_stat_activity where datname='chenyida_erp';
end
$terminate$;
do $verify$
declare target pg_catalog.pg_database%rowtype;
begin
  select * into strict target from pg_catalog.pg_database where datname='chenyida_erp';
  if target.datallowconn is not false or target.datconnlimit<>0
     or exists(select 1 from pg_catalog.pg_stat_activity where datid=target.oid) then
    raise exception 'migration final fence invalid';
  end if;
end
$verify$;
"""

EMERGENCY_SEAL_SQL = r"""
\set ON_ERROR_STOP on
begin;
do $identity$
declare target pg_catalog.pg_database%rowtype;
begin
  select * into strict target from pg_catalog.pg_database where datname='chenyida_erp';
  if target.oid::text is distinct from :'expected_database_oid'
     or (select system_identifier::text from pg_catalog.pg_control_system()) is distinct from :'expected_system_identifier'
     or pg_catalog.shobj_description(target.oid,'pg_database') is distinct from :'expected_marker'
     or target.datdba<>(select oid from pg_catalog.pg_roles where rolname='chenyida_erp_owner') then
    raise exception 'migration emergency fence identity invalid';
  end if;
end
$identity$;
alter database chenyida_erp allow_connections false;
alter database chenyida_erp connection limit 0;
alter database chenyida_erp set default_transaction_read_only to 'on';
revoke connect on database chenyida_erp from chenyida_erp_admin_priv,chenyida_erp_backup_priv,
  chenyida_erp_web_priv,chenyida_erp_worker_priv;
commit;
do $terminate$
begin
  perform pg_catalog.pg_terminate_backend(pid)
    from pg_catalog.pg_stat_activity where datname='chenyida_erp';
end
$terminate$;
do $verify$
declare target pg_catalog.pg_database%rowtype;
begin
  select * into strict target from pg_catalog.pg_database where datname='chenyida_erp';
  if target.datallowconn is not false or target.datconnlimit<>0
     or exists(select 1 from pg_catalog.pg_stat_activity where datid=target.oid) then
    raise exception 'migration emergency fence invalid';
  end if;
end
$verify$;
"""

FENCE_PROBE_SQL = r"""
with target as (
  select * from pg_catalog.pg_database where datname='chenyida_erp'
), expected_roles as (
  select unnest(array[
    'chenyida_erp_admin','chenyida_erp_admin_priv','chenyida_erp_backup','chenyida_erp_backup_priv',
    'chenyida_erp_owner','chenyida_erp_web','chenyida_erp_web_priv','chenyida_erp_worker','chenyida_erp_worker_priv'
  ]::text[]) as rolname
), expanded as (
  select a.grantor,a.grantee,a.privilege_type,a.is_grantable from target t
  cross join lateral pg_catalog.aclexplode(coalesce(t.datacl,pg_catalog.acldefault('d',t.datdba))) a
)
select pg_catalog.json_build_object(
  'database_name',t.datname::text,
  'database_system_identifier',(select system_identifier::text from pg_catalog.pg_control_system()),
  'database_oid',t.oid::text,
  'database_marker',pg_catalog.shobj_description(t.oid,'pg_database'),
  'control_role',current_user::text,
  'control_superuser',(select rolsuper from pg_catalog.pg_roles where rolname=current_user),
  'database_allow_connections',t.datallowconn,
  'default_transaction_read_only',coalesce((select split_part(v,'=',2) from pg_catalog.pg_db_role_setting s
    cross join lateral unnest(s.setconfig) v where s.setdatabase=t.oid and s.setrole=0
    and v like 'default_transaction_read_only=%'),'RESET')::text,
  'database_setting_count',(select count(*)::integer from pg_catalog.pg_db_role_setting s
    cross join lateral unnest(s.setconfig) value where s.setdatabase=t.oid),
  'database_connection_limit',t.datconnlimit::integer,
  'other_backend_count',(select count(*)::integer from pg_catalog.pg_stat_activity a where a.datid=t.oid),
  'managed_roles',coalesce((select pg_catalog.array_agg(r.rolname::text order by r.rolname) from pg_catalog.pg_roles r join expected_roles e on e.rolname=r.rolname),array[]::text[]),
  'login_roles',coalesce((select pg_catalog.array_agg(r.rolname::text order by r.rolname) from pg_catalog.pg_roles r join expected_roles e on e.rolname=r.rolname where r.rolcanlogin),array[]::text[]),
  'connect_roles',coalesce((select pg_catalog.array_agg(r.rolname::text order by r.rolname) from pg_catalog.pg_roles r join expected_roles e on e.rolname=r.rolname where r.rolcanlogin and pg_catalog.has_database_privilege(r.oid,t.oid,'CONNECT')),array[]::text[]),
  'platform_superuser_roles',coalesce((select pg_catalog.array_agg(r.rolname::text order by r.rolname) from pg_catalog.pg_roles r where r.rolsuper),array[]::text[]),
  'public_connect',exists(select 1 from expanded e where e.grantee=0 and e.privilege_type='CONNECT'),
  'public_temporary',exists(select 1 from expanded e where e.grantee=0 and e.privilege_type='TEMPORARY'),
  'unknown_connect_acl_count',(select count(*)::integer from expanded e where e.grantee<>0 and e.privilege_type='CONNECT'
    and not exists(select 1 from pg_catalog.pg_roles r join expected_roles x on x.rolname=r.rolname where r.oid=e.grantee)),
  'unknown_connect_login_count',(select count(*)::integer from pg_catalog.pg_roles r where r.rolcanlogin and not r.rolsuper
    and not exists(select 1 from expected_roles e where e.rolname=r.rolname)
    and pg_catalog.has_database_privilege(r.oid,t.oid,'CONNECT')),
  'prepared_transaction_count',(select count(*)::integer from pg_catalog.pg_prepared_xacts x where x.database=t.datname),
  'role_records',coalesce((select pg_catalog.json_agg(pg_catalog.json_build_object(
    'role',r.rolname::text,'login',r.rolcanlogin,'inherit',r.rolinherit,
    'connection_limit',r.rolconnlimit::integer,'superuser',r.rolsuper,'create_role',r.rolcreaterole,
    'create_database',r.rolcreatedb,'replication',r.rolreplication,'bypass_rls',r.rolbypassrls,
    'valid_until_absent',r.rolvaliduntil is null,
    'settings_absent',r.rolconfig is null and not exists(
      select 1 from pg_catalog.pg_db_role_setting s where s.setrole=r.oid
    )) order by r.rolname) from pg_catalog.pg_roles r join expected_roles e on e.rolname=r.rolname),'[]'::json),
  'memberships',coalesce((select pg_catalog.json_agg(pg_catalog.json_build_object(
    'role',granted.rolname::text,'member',member.rolname::text,'grantor',grantor.rolname::text,
    'admin_option',m.admin_option,'inherit_option',m.inherit_option,'set_option',m.set_option
  ) order by granted.rolname,member.rolname) from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles granted on granted.oid=m.roleid
    join pg_catalog.pg_roles member on member.oid=m.member
    join pg_catalog.pg_roles grantor on grantor.oid=m.grantor
    where granted.rolname in (select rolname from expected_roles)
       or member.rolname in (select rolname from expected_roles)),'[]'::json),
  'non_owner_database_acl',coalesce((select pg_catalog.json_agg(pg_catalog.json_build_object(
    'grantee',pg_catalog.pg_get_userbyid(e.grantee)::text,
    'grantor',pg_catalog.pg_get_userbyid(e.grantor)::text,
    'privilege',e.privilege_type::text,'grantable',e.is_grantable
  ) order by pg_catalog.pg_get_userbyid(e.grantee),e.privilege_type)
    from expanded e where e.grantee<>t.datdba and e.grantee<>0),'[]'::json),
  'database_owner_privileges',array[
    case when pg_catalog.has_database_privilege(t.datdba,t.oid,'CONNECT') then 'CONNECT' end,
    case when pg_catalog.has_database_privilege(t.datdba,t.oid,'CREATE') then 'CREATE' end,
    case when pg_catalog.has_database_privilege(t.datdba,t.oid,'TEMPORARY') then 'TEMPORARY' end
  ]::text[]
) from target t;
"""

LEDGER_PROBE_SQL = r"""
with relation as (
  select c.* from pg_catalog.pg_class c where c.oid=pg_catalog.to_regclass('public.schema_migrations')
), structure as (
  select c.relkind='r' and c.relpersistence='p' and not c.relispartition
     and c.relowner=(select r.oid from pg_catalog.pg_roles r where r.rolname='chenyida_erp_owner')
     and c.relacl is null and not c.relrowsecurity and not c.relforcerowsecurity
     and not exists(select 1 from pg_catalog.pg_inherits i where i.inhrelid=c.oid or i.inhparent=c.oid)
     and (select count(*)=3 and bool_and(
       (a.attnum=1 and a.attname='version' and a.atttypid='text'::pg_catalog.regtype and a.attnotnull and a.attacl is null and d.adrelid is null)
       or (a.attnum=2 and a.attname='checksum' and a.atttypid='text'::pg_catalog.regtype and a.attnotnull and a.attacl is null and d.adrelid is null)
       or (a.attnum=3 and a.attname='applied_at' and a.atttypid='timestamptz'::pg_catalog.regtype and a.attnotnull and a.attacl is null and pg_catalog.pg_get_expr(d.adbin,d.adrelid,true)='now()')
     ) from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
       where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)
     and (select count(*)=1 and bool_and(i.indisprimary and i.indisunique and i.indisvalid and i.indisready and i.indislive and i.indkey::text='1')
       from pg_catalog.pg_index i where i.indrelid=c.oid)
     and (select count(*)=1 and bool_and(k.contype='p' and k.conkey=array[1]::smallint[])
       from pg_catalog.pg_constraint k where k.conrelid=c.oid)
     and not exists(select 1 from pg_catalog.pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)
     as valid from relation c
)
select pg_catalog.json_build_object(
  'structure_valid',coalesce((select valid from structure),false),
  'rows',(select pg_catalog.coalesce(pg_catalog.json_agg(pg_catalog.json_build_object(
    'version',version::text,'checksum',checksum::text) order by version),'[]'::json)
    from only public.schema_migrations)
);
"""


def psql(parameters: dict[str, Any], database: str, sql: str, variables: dict[str, str] | None = None) -> bytes:
    arguments = [
        "exec", "-i", "--user", "999:999", "--env", "PGAPPNAME=chenyida-erp-migration-control",
        "--env", "PGOPTIONS=-c statement_timeout=20000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=25000",
        parameters["postgres_container_id"], "/usr/local/bin/psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
        "--username", "postgres", "--dbname", database, "--file", "-", "--quiet", "--tuples-only", "--no-align",
    ]
    for name, value in sorted((variables or {}).items()):
        arguments.extend(["--set", f"{name}={value}"])
    return docker(
        arguments, timeout=CONTROL_QUERY_TIMEOUT_SECONDS, input_raw=sql.encode("utf-8"), maximum=MAX_JSON_BYTES,
    ).stdout.strip()


def baseline_evidence(parameters: dict[str, Any]) -> dict[str, Any]:
    raw = psql(parameters, "postgres", BASELINE_PROBE_SQL)
    probe = strict_json(raw + b"\n", "MIGRATION_CONTROL_BASELINE_INVALID")
    expected = {
        "database_name": parameters["database_name"],
        "database_system_identifier": parameters["database_system_identifier"],
        "database_oid": parameters["database_oid"],
        "database_marker": parameters["database_marker"],
        "database_owner": "chenyida_erp_owner", "database_allow_connections": True,
        "database_connection_limit": 64, "database_setting_count": 0,
        "other_backend_count": 0, "prepared_transaction_count": 0,
        "role_records": EXPECTED_ROLE_RECORDS, "memberships": EXPECTED_MEMBERSHIPS,
        "database_acl": BASELINE_DATABASE_ACL, "connect_roles": BASELINE_CONNECT_ROLES,
        "platform_superuser_roles": ["postgres"], "public_connect": False, "public_temporary": False,
        "unknown_connect_login_count": 0,
        "owner_privileges": ["CONNECT", "CREATE", "TEMPORARY"],
    }
    if probe != expected:
        reject("MIGRATION_CONTROL_BASELINE_INVALID")
    body = {
        "schema_version": 1, "contract": "chenyida-erp-uat-promotion-migration-released-baseline/v1",
        "status": "EXACT_RELEASED_BASELINE", "observed_at": now_iso(), **probe,
    }
    return {**body, "baseline_sha256": object_sha256(body)}


def install_fence(parameters: dict[str, Any]) -> None:
    psql(parameters, "postgres", FENCE_INSTALL_SQL, {
        "expected_database_oid": parameters["database_oid"],
        "expected_system_identifier": parameters["database_system_identifier"],
        "expected_marker": parameters["database_marker"],
    })


def seal_fence(parameters: dict[str, Any]) -> None:
    psql(parameters, "postgres", FENCE_SEAL_SQL, {
        "expected_database_oid": parameters["database_oid"],
        "expected_system_identifier": parameters["database_system_identifier"],
        "expected_marker": parameters["database_marker"],
    })


def emergency_seal_fence(parameters: dict[str, Any]) -> None:
    psql(parameters, "postgres", EMERGENCY_SEAL_SQL, {
        "expected_database_oid": parameters["database_oid"],
        "expected_system_identifier": parameters["database_system_identifier"],
        "expected_marker": parameters["database_marker"],
    })


def fence_evidence(parameters: dict[str, Any], context: dict[str, Any], phase: str) -> dict[str, Any]:
    if phase not in {"BEFORE", "AFTER"}:
        reject("MIGRATION_CONTROL_FENCE_INVALID")
    raw = psql(parameters, "postgres", FENCE_PROBE_SQL)
    probe = strict_json(raw + b"\n", "MIGRATION_CONTROL_FENCE_INVALID")
    expected = {
        "database_name": parameters["database_name"],
        "database_system_identifier": parameters["database_system_identifier"],
        "database_oid": parameters["database_oid"],
        "database_marker": parameters["database_marker"],
        "control_role": "postgres", "control_superuser": True,
        "database_allow_connections": phase == "BEFORE",
        "default_transaction_read_only": "on", "database_setting_count": 1,
        "database_connection_limit": 1 if phase == "BEFORE" else 0, "other_backend_count": 0,
        "managed_roles": MANAGED_ROLES, "login_roles": LOGIN_ROLES,
        "connect_roles": ["chenyida_erp_owner"], "platform_superuser_roles": ["postgres"],
        "public_connect": False, "public_temporary": False, "unknown_connect_acl_count": 0,
        "unknown_connect_login_count": 0, "prepared_transaction_count": 0,
        "role_records": EXPECTED_ROLE_RECORDS, "memberships": EXPECTED_MEMBERSHIPS,
        "non_owner_database_acl": [],
        "database_owner_privileges": ["CONNECT", "CREATE", "TEMPORARY"],
    }
    if probe != expected:
        reject("MIGRATION_CONTROL_FENCE_INVALID")
    body = {
        "schema_version": 1, "contract": "chenyida-erp-uat-promotion-migration-database-fence/v1",
        "phase": phase, "promotion_id": parameters["promotion_id"],
        "migration_operation_id": context["operation_id"],
        "execution_authorization_sha256": context["execution_authorization_sha256"],
        **probe, "observed_at": now_iso(),
    }
    return {**body, "fence_sha256": object_sha256(body)}


def persist_active_fence(context: dict[str, Any], parameters: dict[str, Any], grant: dict[str, Any],
                         baseline: dict[str, Any], before: dict[str, Any]) -> dict[str, Any]:
    body = {
        "schema_version": 1,
        "contract": "chenyida-erp-uat-promotion-active-migration-fence/v1",
        "status": "ACTIVE_UNTIL_EXPLICIT_CHECKPOINT_9_TRANSFER_OR_QUARANTINE_RESOLUTION",
        "promotion_id": parameters["promotion_id"],
        "migration_operation_id": context["operation_id"],
        "execution_authorization_sha256": context["execution_authorization_sha256"],
        "grant_sha256": grant["grant_sha256"],
        "database_name": parameters["database_name"],
        "database_system_identifier": parameters["database_system_identifier"],
        "database_oid": parameters["database_oid"],
        "database_marker": parameters["database_marker"],
        "released_baseline_sha256": baseline["baseline_sha256"],
        "fence_before_sha256": before["fence_sha256"],
        "activated_at": before["observed_at"],
    }
    record = {**body, "active_fence_sha256": object_sha256(body)}
    immutable_file(
        ACTIVE_FENCES_ROOT / f"{context['operation_id']}.{record['active_fence_sha256']}.json",
        canonical_json(record), 0o400, "MIGRATION_CONTROL_ACTIVE_FENCE_INVALID",
    )
    return record


def load_active_fence_for_recovery(context: dict[str, Any], parameters: dict[str, Any],
                                   grant_sha256: str) -> dict[str, Any] | None:
    trusted_directory(ACTIVE_FENCES_ROOT, {0o700}, "MIGRATION_CONTROL_ACTIVE_FENCE_INVALID")
    try:
        names = sorted(os.listdir(ACTIVE_FENCES_ROOT))
    except OSError:
        reject("MIGRATION_CONTROL_ACTIVE_FENCE_INVALID")
    if len(names) > 20_000 or any(
            re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json", name) is None
            for name in names):
        reject("MIGRATION_CONTROL_ACTIVE_FENCE_INVALID")
    matches = [name for name in names if operation_artifact_matches(name, context["operation_id"])]
    if len(matches) > 1:
        reject("MIGRATION_CONTROL_ACTIVE_FENCE_INVALID")
    if not matches:
        return None
    raw = trusted_file(
        ACTIVE_FENCES_ROOT / matches[0], 0o400, "MIGRATION_CONTROL_ACTIVE_FENCE_INVALID",
    )
    value = exact(
        strict_json(raw, "MIGRATION_CONTROL_ACTIVE_FENCE_INVALID"), ACTIVE_FENCE_FIELDS,
        "MIGRATION_CONTROL_ACTIVE_FENCE_INVALID",
    )
    body = {key: item for key, item in value.items() if key != "active_fence_sha256"}
    if raw != canonical_json(value) or value["schema_version"] != 1 \
            or value["contract"] != "chenyida-erp-uat-promotion-active-migration-fence/v1" \
            or value["status"] != "ACTIVE_UNTIL_EXPLICIT_CHECKPOINT_9_TRANSFER_OR_QUARANTINE_RESOLUTION" \
            or value["promotion_id"] != parameters["promotion_id"] \
            or value["migration_operation_id"] != context["operation_id"] \
            or value["execution_authorization_sha256"] != context["original_authorization_sha256"] \
            or value["grant_sha256"] != grant_sha256 \
            or value["database_name"] != parameters["database_name"] \
            or value["database_system_identifier"] != parameters["database_system_identifier"] \
            or value["database_oid"] != parameters["database_oid"] \
            or value["database_marker"] != parameters["database_marker"] \
            or any(not isinstance(value[field], str) or not SHA256.fullmatch(value[field])
                   for field in ("released_baseline_sha256", "fence_before_sha256", "active_fence_sha256")) \
            or value["active_fence_sha256"] != object_sha256(body) \
            or matches[0] != f"{context['operation_id']}.{value['active_fence_sha256']}.json":
        reject("MIGRATION_CONTROL_ACTIVE_FENCE_INVALID")
    instant(value["activated_at"], "MIGRATION_CONTROL_ACTIVE_FENCE_INVALID")
    return value


def load_recovery_intent_and_grant(context: dict[str, Any], parameters: dict[str, Any]) \
        -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    trusted_directory(STATE_ROOT, {0o700}, "MIGRATION_CONTROL_STATE_INVALID")
    intents_root = STATE_ROOT / "intents"
    trusted_directory(intents_root, {0o700}, "MIGRATION_CONTROL_STATE_INVALID")
    trusted_directory(GRANTS_ROOT, {0o700}, "MIGRATION_CONTROL_STATE_INVALID")
    intent_path = intents_root / f"{context['operation_id']}.{context['expected_intent_sha256']}.json"
    intent_raw = trusted_file(intent_path, 0o400, "MIGRATION_CONTROL_RECOVERY_INTENT_INVALID")
    intent = exact(
        strict_json(intent_raw, "MIGRATION_CONTROL_RECOVERY_INTENT_INVALID"),
        MIGRATION_EXECUTION_INTENT_FIELDS, "MIGRATION_CONTROL_RECOVERY_INTENT_INVALID",
    )
    intent_body = {key: item for key, item in intent.items() if key != "migration_execution_intent_sha256"}
    if intent_raw != canonical_json(intent) or intent["schema_version"] != 1 \
            or intent["contract"] != "chenyida-erp-uat-promotion-migration-execution-intent/v1" \
            or intent["execution_scope"] != "DATABASE_FENCE_AND_EXACT_ALLOWLIST_MIGRATION" \
            or intent["migration_operation_id"] != context["operation_id"] \
            or intent["execution_authorization_sha256"] != context["original_authorization_sha256"] \
            or intent["supervisor_bundle_sha256"] != context["supervisor_bundle_sha256"] \
            or intent["parameters"] != parameters or intent["promotion_id"] != parameters["promotion_id"] \
            or not isinstance(intent["grant_sha256"], str) or intent["grant_sha256"] == ZERO_SHA256 \
            or not SHA256.fullmatch(intent["grant_sha256"]) \
            or intent["migration_execution_intent_sha256"] != context["expected_intent_sha256"] \
            or intent["migration_execution_intent_sha256"] != object_sha256(intent_body):
        reject("MIGRATION_CONTROL_RECOVERY_INTENT_INVALID")
    grant_path = GRANTS_ROOT / f"{context['operation_id']}.{intent['grant_sha256']}.json"
    grant_raw = trusted_file(grant_path, 0o440, "MIGRATION_CONTROL_GRANT_INVALID")
    original_context = {
        **context,
        "execution_mode": "ORIGINAL",
        "execution_authorization_id": context["operation_id"],
        "execution_authorization_sha256": context["original_authorization_sha256"],
        "execution_created_at": parameters["execution_created_at"],
        "expected_intent_sha256": None,
    }
    grant = validate_grant(grant_raw, original_context, parameters, intent["grant_sha256"])
    return intent, grant, original_context


def create_execution_root(context: dict[str, Any], grant_sha256: str, manifest_raw: bytes,
                          grant_raw: bytes, release_root: Path) -> Path:
    trusted_directory(STATE_ROOT, {0o700}, "MIGRATION_CONTROL_STATE_INVALID")
    trusted_directory(GRANTS_ROOT, {0o700}, "MIGRATION_CONTROL_STATE_INVALID")
    trusted_directory(RESULTS_ROOT, {0o700}, "MIGRATION_CONTROL_STATE_INVALID")
    trusted_directory(EXECUTIONS_ROOT, {0o700}, "MIGRATION_CONTROL_STATE_INVALID")
    trusted_directory(ACTIVE_FENCES_ROOT, {0o700}, "MIGRATION_CONTROL_STATE_INVALID")
    root = EXECUTIONS_ROOT / f"{context['operation_id']}.{grant_sha256}"
    try:
        os.mkdir(root, 0o700)
        os.chown(root, 0, 0)
        os.chmod(root, 0o700)
        sync_directory(EXECUTIONS_ROOT, "MIGRATION_CONTROL_STATE_INVALID")
    except FileExistsError:
        reject("MIGRATION_CONTROL_EXECUTION_ALREADY_EXISTS")
    except OSError:
        reject("MIGRATION_CONTROL_STATE_INVALID")
    ensure_directory(root / "mounts", 0o750, "MIGRATION_CONTROL_STATE_INVALID")
    ensure_directory(root / "mounts" / "candidate", 0o750, "MIGRATION_CONTROL_STATE_INVALID")
    ensure_directory(root / "mounts" / "promotion", 0o750, "MIGRATION_CONTROL_STATE_INVALID")
    stage_release_bundle(release_root, root / "mounts" / "candidate", manifest_raw)
    immutable_file(root / "mounts" / "promotion" / "migration-execution-grant.json", grant_raw, 0o440, "MIGRATION_CONTROL_STATE_INVALID")
    return root


def candidate_environment(context: dict[str, Any], parameters: dict[str, Any], manifest: dict[str, Any], grant: dict[str, Any]) -> dict[str, str]:
    worker = manifest["images"]["worker"]
    return {
        "ERP_ENV": "production", "ERP_DEPLOYMENT_CLASS": "uat", "ERP_SERVICE_KIND": "MIGRATION",
        "ERP_MIGRATION_DATABASE_STATE": "MIGRATION_FENCED",
        "ERP_RELEASE_EXPECTED_DEPLOYMENT_ID": parameters["deployment_id"],
        "ERP_ALLOW_PRODUCTION_MIGRATION": "YES",
        "ERP_RELEASE_MANIFEST_FILE": "/run/chenyida-erp-release-candidate/release-manifest.json",
        "ERP_RELEASE_MANIFEST_SHA256": parameters["release_manifest_sha256"],
        "ERP_RELEASE_EXPECTED_MANIFEST_SHA256": parameters["release_manifest_sha256"],
        "ERP_MIGRATION_CONFIRM": "MIGRATE_EXACT_RELEASE_MANIFEST",
        "ERP_MIGRATION_EXPECTED_DATABASE": parameters["database_name"],
        "ERP_MIGRATION_EXPECTED_SYSTEM_IDENTIFIER": parameters["database_system_identifier"],
        "ERP_MIGRATION_EXPECTED_DATABASE_OID": parameters["database_oid"],
        "ERP_MIGRATION_EXPECTED_DATABASE_MARKER": parameters["database_marker"],
        "ERP_MIGRATION_EXPECTED_ROLE": parameters["migration_role"],
        "ERP_MIGRATION_EXPECTED_CURRENT_HEAD": parameters["expected_current_migration_head"],
        "ERP_MIGRATION_EXPECTED_TARGET_HEAD": parameters["target_migration_head"],
        "ERP_RELEASE_EXPECTED_VERSION": manifest["source"]["package_version"],
        "ERP_RELEASE_EXPECTED_GIT_COMMIT": manifest["source"]["git_commit"],
        "ERP_RUNTIME_IMAGE_REFERENCE": parameters["worker_image"],
        "ERP_RUNTIME_IMAGE_CONFIG_DIGEST": worker["image_digest"],
        "ERP_RELEASE_EXPECTED_SUPERVISOR_BUNDLE_SHA256": context["supervisor_bundle_sha256"],
        "ERP_UAT_PROMOTION_MIGRATION_GRANT_SHA256": grant["grant_sha256"],
        "ERP_UAT_PROMOTION_MIGRATION_EXECUTION_AUTHORIZATION_SHA256": context["execution_authorization_sha256"],
    }


def environment_map(entries: Any, code: str) -> dict[str, str]:
    if entries is None:
        return {}
    if not isinstance(entries, list):
        reject(code)
    result: dict[str, str] = {}
    for entry in entries:
        if not isinstance(entry, str) or "=" not in entry:
            reject(code)
        key, value = entry.split("=", 1)
        if key in result:
            reject(code)
        result[key] = value
    return result


def assert_candidate_ownership(value: dict[str, Any], container_id: str, name: str,
                               context: dict[str, Any], parameters: dict[str, Any],
                               manifest: dict[str, Any], grant: dict[str, Any]) -> None:
    labels = value.get("Config", {}).get("Labels", {})
    if value.get("Id") != container_id or value.get("Name") != f"/{name}" \
            or value.get("Image") != manifest["images"]["worker"]["image_digest"] \
            or not isinstance(labels, dict) \
            or labels.get("chenyida.erp.uat-migration-operation") != context["operation_id"] \
            or labels.get("chenyida.erp.uat-migration-grant") != grant["grant_sha256"]:
        reject("MIGRATION_CONTROL_CANDIDATE_OWNERSHIP_INVALID")


def validate_candidate_container(value: dict[str, Any], container_id: str, name: str,
                                 context: dict[str, Any], parameters: dict[str, Any],
                                 manifest: dict[str, Any], grant: dict[str, Any], execution_root: Path,
                                 image_value: dict[str, Any]) -> None:
    assert_candidate_ownership(value, container_id, name, context, parameters, manifest, grant)
    try:
        config = value["Config"]
        host = value["HostConfig"]
        state = value["State"]
        networks = value["NetworkSettings"]["Networks"]
        mounts = value["Mounts"]
        image_config = image_value["Config"]
    except (KeyError, TypeError):
        reject("MIGRATION_CONTROL_CANDIDATE_INVALID")
    expected_environment = environment_map(image_config.get("Env"), "MIGRATION_CONTROL_CANDIDATE_INVALID")
    expected_environment.update(candidate_environment(context, parameters, manifest, grant))
    actual_environment = environment_map(config.get("Env"), "MIGRATION_CONTROL_CANDIDATE_INVALID")
    expected_labels = dict(image_config.get("Labels") or {})
    expected_labels.update({
        "chenyida.erp.uat-migration-operation": context["operation_id"],
        "chenyida.erp.uat-migration-grant": grant["grant_sha256"],
    })
    expected_mounts = [
        (str(execution_root / "mounts" / "candidate"), "/run/chenyida-erp-release-candidate"),
        (str(execution_root / "mounts" / "promotion"), "/run/chenyida-erp-promotion"),
        (str(MIGRATION_SECRET), "/run/chenyida-erp-secrets/migration-database-password"),
    ]
    actual_mounts = []
    if not isinstance(mounts, list):
        reject("MIGRATION_CONTROL_CANDIDATE_INVALID")
    for mount in mounts:
        if not isinstance(mount, dict) or mount.get("Type") != "bind" or mount.get("RW") is not False \
                or mount.get("Propagation") not in ("", "rprivate"):
            reject("MIGRATION_CONTROL_CANDIDATE_INVALID")
        actual_mounts.append((mount.get("Source"), mount.get("Destination")))
    command = [
        "node", "--max-old-space-size=256", "--experimental-strip-types", "scripts/migrate-postgres.ts",
    ]
    if config.get("User") != "65532:0" or config.get("WorkingDir") != "/app" \
            or config.get("Cmd") != command or config.get("Entrypoint") != image_config.get("Entrypoint") \
            or actual_environment != expected_environment or config.get("Labels") != expected_labels \
            or config.get("NetworkDisabled") is not False \
            or host.get("ReadonlyRootfs") is not True or host.get("Privileged") is not False \
            or host.get("CapAdd") not in (None, []) or host.get("CapDrop") != ["ALL"] \
            or host.get("SecurityOpt") != ["no-new-privileges"] \
            or host.get("Memory") != 512 * 1024 * 1024 or host.get("MemorySwap") != 512 * 1024 * 1024 \
            or host.get("NanoCpus") != 500_000_000 or host.get("PidsLimit") != 96 \
            or host.get("NetworkMode") != parameters["backend_network"] \
            or host.get("RestartPolicy") != {"Name": "no", "MaximumRetryCount": 0} \
            or host.get("AutoRemove") is not False \
            or host.get("Tmpfs") != {"/tmp": "rw,nosuid,nodev,noexec,size=64m,mode=1777"} \
            or host.get("LogConfig") != {"Type": "local", "Config": {"max-file": "2", "max-size": "2m"}} \
            or host.get("PortBindings") not in (None, {}) \
            or sorted(actual_mounts) != sorted(expected_mounts) \
            or not isinstance(networks, dict) or set(networks) != {parameters["backend_network"]} \
            or state.get("Status") != "created" or state.get("Running") is not False \
            or state.get("Restarting") is not False or state.get("Paused") is not False \
            or state.get("Dead") is not False or state.get("OOMKilled") is not False \
            or value.get("RestartCount") != 0:
        reject("MIGRATION_CONTROL_CANDIDATE_INVALID")


def create_candidate(context: dict[str, Any], parameters: dict[str, Any], manifest: dict[str, Any],
                     grant: dict[str, Any], execution_root: Path,
                     image_value: dict[str, Any]) -> tuple[str, str]:
    name = f"cyd-uat-migration-{context['execution_authorization_sha256'][:24]}"
    arguments = [
        "create", "--pull=never", "--name", name,
        "--label", f"chenyida.erp.uat-migration-operation={context['operation_id']}",
        "--label", f"chenyida.erp.uat-migration-grant={grant['grant_sha256']}",
        "--network", parameters["backend_network"], "--user", "65532:0", "--read-only",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "512m",
        "--memory-swap", "512m", "--cpus", "0.5", "--pids-limit", "96",
        "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777",
        "--log-driver", "local", "--log-opt", "max-size=2m", "--log-opt", "max-file=2",
        "--mount", f"type=bind,src={execution_root / 'mounts' / 'candidate'},dst=/run/chenyida-erp-release-candidate,readonly",
        "--mount", f"type=bind,src={execution_root / 'mounts' / 'promotion'},dst=/run/chenyida-erp-promotion,readonly",
        "--mount", f"type=bind,src={MIGRATION_SECRET},dst=/run/chenyida-erp-secrets/migration-database-password,readonly",
    ]
    for key, value in sorted(candidate_environment(context, parameters, manifest, grant).items()):
        arguments.extend(["--env", f"{key}={value}"])
    arguments.extend([
        parameters["worker_image"], "node", "--max-old-space-size=256", "--experimental-strip-types",
        "scripts/migrate-postgres.ts",
    ])
    created = docker(arguments, timeout=45)
    try:
        container_id = created.stdout.decode("ascii", errors="strict").strip()
    except UnicodeDecodeError:
        reject("MIGRATION_CONTROL_CANDIDATE_CREATE_FAILED")
    if not CONTAINER_ID.fullmatch(container_id):
        reject("MIGRATION_CONTROL_CANDIDATE_CREATE_FAILED")
    value = docker_inspect("container", container_id)
    validate_candidate_container(
        value, container_id, name, context, parameters, manifest, grant, execution_root, image_value,
    )
    return container_id, name


def contain_candidate(container_id: str, name: str, context: dict[str, Any], parameters: dict[str, Any],
                      manifest: dict[str, Any], grant: dict[str, Any]) -> None:
    value = docker_inspect("container", container_id)
    assert_candidate_ownership(value, container_id, name, context, parameters, manifest, grant)
    state = value.get("State", {})
    if state.get("Running") is True or state.get("Restarting") is True:
        docker(["container", "stop", "--time", "10", container_id], timeout=20, require_success=False)
        value = docker_inspect("container", container_id)
        assert_candidate_ownership(value, container_id, name, context, parameters, manifest, grant)
        state = value.get("State", {})
    if state.get("Running") is True or state.get("Restarting") is True:
        docker(["container", "kill", "--signal", "KILL", container_id], timeout=15, require_success=False)
        value = docker_inspect("container", container_id)
        assert_candidate_ownership(value, container_id, name, context, parameters, manifest, grant)
        state = value.get("State", {})
    if state.get("Running") is not False or state.get("Restarting") is not False \
            or state.get("Status") not in {"exited", "dead"}:
        reject("MIGRATION_CONTROL_CANDIDATE_CONTAINMENT_FAILED")


def recovery_candidate_ids(context: dict[str, Any], grant: dict[str, Any]) -> list[str]:
    result = docker([
        "container", "ls", "--all", "--no-trunc", "--quiet",
        "--filter", f"label=chenyida.erp.uat-migration-operation={context['operation_id']}",
        "--filter", f"label=chenyida.erp.uat-migration-grant={grant['grant_sha256']}",
    ], timeout=20)
    try:
        rendered = result.stdout.decode("ascii", errors="strict").strip()
    except UnicodeDecodeError:
        reject("MIGRATION_CONTROL_RECOVERY_CANDIDATE_INVALID")
    values = [] if rendered == "" else rendered.splitlines()
    if len(values) > 1 or any(not CONTAINER_ID.fullmatch(value) for value in values):
        reject("MIGRATION_CONTROL_RECOVERY_CANDIDATE_INVALID")
    return values


def load_recovery_candidate(execution_root: Path, context: dict[str, Any], parameters: dict[str, Any],
                            grant: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    trusted_directory(execution_root, {0o700}, "MIGRATION_CONTROL_RECOVERY_EXECUTION_INVALID")
    candidate_root = execution_root / "mounts" / "candidate"
    promotion_root = execution_root / "mounts" / "promotion"
    trusted_directory(candidate_root, {0o750}, "MIGRATION_CONTROL_RECOVERY_EXECUTION_INVALID")
    trusted_directory(promotion_root, {0o750}, "MIGRATION_CONTROL_RECOVERY_EXECUTION_INVALID")
    manifest_raw = trusted_file(
        candidate_root / "release-manifest.json", 0o440,
        "MIGRATION_CONTROL_RECOVERY_EXECUTION_INVALID",
        expected_sha256=parameters["release_manifest_sha256"],
    )
    manifest = validate_manifest(manifest_raw, parameters)
    staged_grant = trusted_file(
        promotion_root / "migration-execution-grant.json", 0o440,
        "MIGRATION_CONTROL_RECOVERY_EXECUTION_INVALID",
    )
    if staged_grant != canonical_json(grant):
        reject("MIGRATION_CONTROL_RECOVERY_EXECUTION_INVALID")
    candidate_path = execution_root / "candidate.json"
    try:
        os.lstat(candidate_path)
    except FileNotFoundError:
        return None, manifest
    except OSError:
        reject("MIGRATION_CONTROL_RECOVERY_CANDIDATE_INVALID")
    raw = trusted_file(candidate_path, 0o400, "MIGRATION_CONTROL_RECOVERY_CANDIDATE_INVALID")
    value = exact(
        strict_json(raw, "MIGRATION_CONTROL_RECOVERY_CANDIDATE_INVALID"), CANDIDATE_FIELDS,
        "MIGRATION_CONTROL_RECOVERY_CANDIDATE_INVALID",
    )
    body = {key: item for key, item in value.items() if key != "candidate_sha256"}
    expected_name = f"cyd-uat-migration-{context['original_authorization_sha256'][:24]}"
    if raw != canonical_json(value) or value["schema_version"] != 1 \
            or value["contract"] != "chenyida-erp-uat-promotion-migration-candidate/v1" \
            or value["status"] != "CREATED" or value["promotion_id"] != parameters["promotion_id"] \
            or value["migration_operation_id"] != context["operation_id"] \
            or value["grant_sha256"] != grant["grant_sha256"] \
            or value["worker_image"] != parameters["worker_image"] \
            or value["container_name"] != expected_name \
            or not isinstance(value["container_id"], str) or not CONTAINER_ID.fullmatch(value["container_id"]) \
            or value["candidate_sha256"] != object_sha256(body):
        reject("MIGRATION_CONTROL_RECOVERY_CANDIDATE_INVALID")
    instant(value["created_at"], "MIGRATION_CONTROL_RECOVERY_CANDIDATE_INVALID")
    return value, manifest


def persist_recovery_containment(context: dict[str, Any], parameters: dict[str, Any], grant: dict[str, Any],
                                 active: dict[str, Any] | None, candidate_status: str,
                                 container_id: str | None) -> dict[str, Any]:
    root = EXECUTIONS_ROOT / f"{context['operation_id']}.recovery.{context['execution_authorization_sha256']}"
    try:
        os.mkdir(root, 0o700)
        os.chown(root, 0, 0)
        os.chmod(root, 0o700)
        sync_directory(EXECUTIONS_ROOT, "MIGRATION_CONTROL_RECOVERY_ARTIFACT_INVALID")
    except FileExistsError:
        reject("MIGRATION_CONTROL_RECOVERY_ALREADY_EXECUTED")
    except OSError:
        reject("MIGRATION_CONTROL_RECOVERY_ARTIFACT_INVALID")
    body = {
        "schema_version": 1,
        "contract": "chenyida-erp-uat-promotion-migration-recovery-containment/v1",
        "status": "DATABASE_SEALED_AND_EXACT_CANDIDATE_CONTAINED",
        "promotion_id": parameters["promotion_id"],
        "migration_operation_id": context["operation_id"],
        "original_execution_authorization_sha256": context["original_authorization_sha256"],
        "recovery_execution_authorization_sha256": context["execution_authorization_sha256"],
        "migration_execution_intent_sha256": context["expected_intent_sha256"],
        "grant_sha256": grant["grant_sha256"],
        "active_fence_sha256": active["active_fence_sha256"] if active is not None else ZERO_SHA256,
        "database_fence_containment": "SEALED_ZERO_CONNECTIONS",
        "candidate_containment": candidate_status,
        "container_id": container_id if container_id is not None else ZERO_SHA256,
        "recorded_at": now_iso(),
    }
    record = {**body, "recovery_containment_sha256": object_sha256(body)}
    immutable_file(
        root / "recovery-containment.json", canonical_json(record), 0o400,
        "MIGRATION_CONTROL_RECOVERY_ARTIFACT_INVALID",
    )
    return record


def run_candidate(container_id: str, name: str, context: dict[str, Any], parameters: dict[str, Any],
                  manifest: dict[str, Any], grant: dict[str, Any]) -> bytes:
    expires = instant(grant["expires_at"], "MIGRATION_CONTROL_TIME_INVALID")
    deadline = min(
        time.monotonic() + CANDIDATE_MAX_RUNTIME_SECONDS,
        time.monotonic() + max(0.0, (expires - datetime.now(timezone.utc)).total_seconds()
                               - CANDIDATE_FINALIZATION_MARGIN_SECONDS),
    )
    if deadline - time.monotonic() < 1:
        reject("MIGRATION_CONTROL_TIME_INVALID")
    started = docker(["container", "start", container_id], timeout=20)
    try:
        started_id = started.stdout.decode("ascii", errors="strict").strip()
    except UnicodeDecodeError:
        reject("MIGRATION_CONTROL_CANDIDATE_FAILED")
    if started_id not in {container_id, name}:
        reject("MIGRATION_CONTROL_CANDIDATE_FAILED")
    while True:
        value = docker_inspect("container", container_id)
        assert_candidate_ownership(value, container_id, name, context, parameters, manifest, grant)
        state = value.get("State", {})
        if state.get("Running") is False and state.get("Status") in {"exited", "dead"}:
            break
        if state.get("Running") is not True or state.get("Restarting") is True \
                or state.get("Paused") is not False or state.get("Dead") is not False \
                or time.monotonic() >= deadline:
            reject("MIGRATION_CONTROL_CANDIDATE_TIMEOUT")
        time.sleep(1)
    if state.get("Status") != "exited" or state.get("ExitCode") != 0 \
            or state.get("OOMKilled") is not False or value.get("RestartCount") != 0:
        reject("MIGRATION_CONTROL_CANDIDATE_FAILED")
    logs = docker(["container", "logs", container_id], timeout=20, require_success=False, maximum=MAX_JSON_BYTES)
    if logs.returncode != 0 or logs.stderr != b"" or len(logs.stdout) < 2:
        reject("MIGRATION_CONTROL_CANDIDATE_FAILED")
    return logs.stdout


def validate_engine(raw: bytes, context: dict[str, Any], parameters: dict[str, Any], manifest: dict[str, Any], grant: dict[str, Any]) -> dict[str, Any]:
    value = exact(strict_json(raw, "MIGRATION_CONTROL_ENGINE_RESULT_INVALID"), ENGINE_FIELDS, "MIGRATION_CONTROL_ENGINE_RESULT_INVALID")
    body = {key: item for key, item in value.items() if key != "engine_result_sha256"}
    if raw != canonical_json(value) or value["schema_version"] != 1 \
            or value["contract"] != "chenyida-erp-uat-promotion-migration-engine-result/v1" \
            or value["status"] != "MIGRATION_COMMITTED" or value["engine_result_sha256"] != object_sha256(body) \
            or value["promotion_id"] != parameters["promotion_id"] \
            or value["migration_operation_id"] != context["operation_id"] \
            or value["execution_authorization_sha256"] != context["execution_authorization_sha256"] \
            or value["grant_sha256"] != grant["grant_sha256"] or value["database_name"] != parameters["database_name"] \
            or value["database_system_identifier"] != parameters["database_system_identifier"] \
            or value["database_oid"] != parameters["database_oid"] or value["database_marker"] != parameters["database_marker"] \
            or value["migration_role"] != parameters["migration_role"] or value["application_name"] != "chenyida-erp-migration" \
            or value["current_head_before"] != parameters["expected_current_migration_head"] \
            or value["target_head"] != parameters["target_migration_head"] \
            or value["other_backend_count_before"] != 0 or value["other_backend_count_after"] != 0 \
            or value["database_default_transaction_read_only"] != "on" \
            or value["migration_transaction_read_only"] != "off":
        reject("MIGRATION_CONTROL_ENGINE_RESULT_INVALID")
    started = instant(value["started_at"], "MIGRATION_CONTROL_ENGINE_RESULT_INVALID")
    completed = instant(value["completed_at"], "MIGRATION_CONTROL_ENGINE_RESULT_INVALID")
    if started < instant(grant["created_at"], "MIGRATION_CONTROL_ENGINE_RESULT_INVALID") or completed < started \
            or completed >= instant(grant["expires_at"], "MIGRATION_CONTROL_ENGINE_RESULT_INVALID"):
        reject("MIGRATION_CONTROL_ENGINE_RESULT_INVALID")
    entries = manifest["migrations"]["entries"]
    files = value.get("files")
    if not isinstance(files, list) or len(files) != len(entries):
        reject("MIGRATION_CONTROL_ENGINE_RESULT_INVALID")
    current_index = -1 if parameters["expected_current_migration_head"] == "EMPTY" else next(
        (index for index, entry in enumerate(entries)
         if entry["filename"] == parameters["expected_current_migration_head"]), -1,
    )
    if parameters["expected_current_migration_head"] != "EMPTY" and current_index < 0:
        reject("MIGRATION_CONTROL_ENGINE_RESULT_INVALID")
    for index, (file, entry) in enumerate(zip(files, entries, strict=True)):
        expected_outcome = "ALREADY_APPLIED" if index <= current_index else "APPLIED"
        if not isinstance(file, dict) or set(file) != {"filename", "sha256", "outcome"} \
                or file != {"filename": entry["filename"], "sha256": entry["sha256"], "outcome": expected_outcome}:
            reject("MIGRATION_CONTROL_ENGINE_RESULT_INVALID")
    rows = [{"version": entry["filename"], "checksum": entry["sha256"]} for entry in entries]
    if value["final_migration_rows_count"] != len(rows) or value["final_migration_rows_sha256"] != object_sha256(rows):
        reject("MIGRATION_CONTROL_ENGINE_RESULT_INVALID")
    return value


def ledger_rows(parameters: dict[str, Any], manifest: dict[str, Any]) -> None:
    raw = psql(parameters, parameters["database_name"], LEDGER_PROBE_SQL)
    evidence = strict_json(raw + b"\n", "MIGRATION_CONTROL_LEDGER_INVALID")
    expected = [{"version": entry["filename"], "checksum": entry["sha256"]} for entry in manifest["migrations"]["entries"]]
    if evidence != {"structure_valid": True, "rows": expected}:
        reject("MIGRATION_CONTROL_LEDGER_INVALID")


def migration_result(context: dict[str, Any], parameters: dict[str, Any], grant: dict[str, Any], before: dict[str, Any], engine: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    committed_at = now_iso()
    if instant(committed_at, "MIGRATION_CONTROL_RESULT_INVALID") < instant(engine["completed_at"], "MIGRATION_CONTROL_RESULT_INVALID") \
            or instant(committed_at, "MIGRATION_CONTROL_RESULT_INVALID") < instant(after["observed_at"], "MIGRATION_CONTROL_RESULT_INVALID") \
            or instant(committed_at, "MIGRATION_CONTROL_RESULT_INVALID") >= instant(grant["expires_at"], "MIGRATION_CONTROL_RESULT_INVALID"):
        reject("MIGRATION_CONTROL_RESULT_INVALID")
    body = {
        "schema_version": 1, "contract": "chenyida-erp-uat-promotion-migration-result/v1",
        "status": "MIGRATION_COMMITTED", "promotion_id": parameters["promotion_id"],
        "migration_operation_id": context["operation_id"],
        "execution_authorization_sha256": context["execution_authorization_sha256"],
        "grant_sha256": grant["grant_sha256"],
        "migration_approval_receipt_sha256": grant["migration_approval_receipt_sha256"],
        "migration_authorization_binding_sha256": grant["migration_authorization_binding_sha256"],
        "fence_before": before, "engine_result": engine, "fence_after": after,
        "database_fence_binding_sha256": object_sha256({
            "before": before["fence_sha256"], "after": after["fence_sha256"],
        }),
        "migration_result_binding_sha256": engine["engine_result_sha256"], "committed_at": committed_at,
    }
    return {**body, "result_sha256": object_sha256(body)}


def validate_secret_metadata() -> None:
    trusted_directory(SECRET_ROOT, {0o700}, "MIGRATION_CONTROL_SECRET_INVALID")
    raw = trusted_file(MIGRATION_SECRET, 0o440, "MIGRATION_CONTROL_SECRET_INVALID", maximum=44, read=False)
    if raw != b"":
        reject("MIGRATION_CONTROL_SECRET_INVALID")


def execute(context_input: Any, expected_grant_sha256: str) -> dict[str, Any]:
    validate_lock()
    context, parameters = validate_context(context_input, expected_grant_sha256)
    trusted_directory(STATE_ROOT, {0o700}, "MIGRATION_CONTROL_STATE_INVALID")
    trusted_directory(GRANTS_ROOT, {0o700}, "MIGRATION_CONTROL_STATE_INVALID")
    grant_path = GRANTS_ROOT / f"{context['operation_id']}.{expected_grant_sha256}.json"
    grant_raw = trusted_file(grant_path, 0o440, "MIGRATION_CONTROL_GRANT_INVALID", expected_sha256=None)
    grant = validate_grant(grant_raw, context, parameters, expected_grant_sha256)
    manifest_path = Path(parameters["release_manifest"])
    manifest_raw = trusted_file(
        manifest_path, 0o440, "MIGRATION_CONTROL_MANIFEST_INVALID",
        expected_sha256=parameters["release_manifest_sha256"],
    )
    manifest = validate_manifest(manifest_raw, parameters)
    quiesce = load_quiesce_evidence(parameters)
    validate_secret_metadata()
    validate_postgres_container(parameters)
    image_value = validate_candidate_image(parameters, manifest)
    execution_root = create_execution_root(
        context, expected_grant_sha256, manifest_raw, grant_raw, manifest_path.parent,
    )
    container_id: str | None = None
    container_name: str | None = None
    baseline: dict[str, Any] | None = None
    before: dict[str, Any] | None = None
    active: dict[str, Any] | None = None
    containment_status = "NOT_REQUIRED"
    fence_containment_status = "NOT_REQUIRED"
    try:
        verify_live_writer_quiesce(quiesce)
        validate_postgres_container(parameters)
        baseline = baseline_evidence(parameters)
        immutable_file(
            execution_root / "released-baseline.json", canonical_json(baseline), 0o400,
            "MIGRATION_CONTROL_ARTIFACT_INVALID",
        )
        verify_live_writer_quiesce(quiesce)
        validate_postgres_container(parameters)
        install_fence(parameters)
        before = fence_evidence(parameters, context, "BEFORE")
        immutable_file(execution_root / "fence-before.json", canonical_json(before), 0o400, "MIGRATION_CONTROL_ARTIFACT_INVALID")
        active = persist_active_fence(context, parameters, grant, baseline, before)
        validate_postgres_container(parameters)
        container_id, container_name = create_candidate(
            context, parameters, manifest, grant, execution_root, image_value,
        )
        candidate_body = {
            "schema_version": 1, "contract": "chenyida-erp-uat-promotion-migration-candidate/v1",
            "status": "CREATED", "promotion_id": parameters["promotion_id"],
            "migration_operation_id": context["operation_id"], "grant_sha256": expected_grant_sha256,
            "container_id": container_id, "container_name": container_name,
            "worker_image": parameters["worker_image"], "created_at": now_iso(),
        }
        candidate = {**candidate_body, "candidate_sha256": object_sha256(candidate_body)}
        immutable_file(execution_root / "candidate.json", canonical_json(candidate), 0o400, "MIGRATION_CONTROL_ARTIFACT_INVALID")
        validate_secret_metadata()
        engine_raw = run_candidate(container_id, container_name, context, parameters, manifest, grant)
        engine = validate_engine(engine_raw, context, parameters, manifest, grant)
        immutable_file(execution_root / "engine-result.json", canonical_json(engine), 0o400, "MIGRATION_CONTROL_ARTIFACT_INVALID")
        validate_postgres_container(parameters)
        fence_evidence(parameters, context, "BEFORE")
        ledger_rows(parameters, manifest)
        seal_fence(parameters)
        fence_containment_status = "SEALED_ZERO_CONNECTIONS"
        after = fence_evidence(parameters, context, "AFTER")
        immutable_file(execution_root / "fence-after.json", canonical_json(after), 0o400, "MIGRATION_CONTROL_ARTIFACT_INVALID")
        result = migration_result(context, parameters, grant, before, engine, after)
        immutable_file(
            RESULTS_ROOT / f"{context['operation_id']}.{result['result_sha256']}.json",
            canonical_json(result), 0o400, "MIGRATION_CONTROL_RESULT_INVALID",
        )
        response = {
            "result": "MIGRATION_RESULT_PERSISTED", "promotion_id": parameters["promotion_id"],
            "migration_operation_id": context["operation_id"], "grant_sha256": expected_grant_sha256,
            "migration_result_sha256": result["result_sha256"], "container_id": container_id,
            "container_name": container_name, "execution_artifact_sha256": object_sha256({
                "baseline": baseline["baseline_sha256"], "active": active["active_fence_sha256"],
                "candidate": candidate["candidate_sha256"], "before": before["fence_sha256"],
                "engine": engine["engine_result_sha256"], "after": after["fence_sha256"],
                "result": result["result_sha256"],
            }),
        }
        return response
    except Exception as cause:
        error = cause if isinstance(cause, MigrationControlError) \
            else MigrationControlError("MIGRATION_CONTROL_INTERNAL_ERROR")
        if container_id is not None and container_name is not None:
            try:
                contain_candidate(container_id, container_name, context, parameters, manifest, grant)
                containment_status = "EXACT_CANDIDATE_STOPPED"
            except Exception:
                containment_status = "CONTAINMENT_FAILED_MANUAL_RESPONSE_REQUIRED"
        if baseline is not None:
            try:
                emergency_seal_fence(parameters)
                fence_containment_status = "SEALED_ZERO_CONNECTIONS"
            except Exception:
                fence_containment_status = "FENCE_CONTAINMENT_FAILED_MANUAL_RESPONSE_REQUIRED"
        failure_body = {
            "schema_version": 1, "contract": "chenyida-erp-uat-promotion-migration-failure/v1",
            "status": "QUARANTINE_REQUIRED", "promotion_id": parameters["promotion_id"],
            "migration_operation_id": context["operation_id"], "grant_sha256": expected_grant_sha256,
            "container_id": container_id, "container_name": container_name,
            "error_code": error.code, "recorded_at": now_iso(),
            "candidate_containment": containment_status,
            "database_fence_containment": fence_containment_status,
            "released_baseline_sha256": baseline["baseline_sha256"] if baseline is not None else None,
            "active_fence_sha256": active["active_fence_sha256"] if active is not None else None,
            "fence_before_sha256": before["fence_sha256"] if before is not None else None,
            "preservation": "WRITER_QUIESCE_AND_AVAILABLE_FENCE_CONTAINER_ARTIFACTS_LEFT_IN_PLACE_NO_AUTOMATIC_DELETE",
        }
        failure = {**failure_body, "failure_sha256": object_sha256(failure_body)}
        immutable_file(execution_root / "failure.json", canonical_json(failure), 0o400, "MIGRATION_CONTROL_ARTIFACT_INVALID")
        raise error


def recover(context_input: Any) -> dict[str, Any]:
    validate_lock()
    context, parameters = validate_recovery_context(context_input)
    trusted_directory(STATE_ROOT, {0o700}, "MIGRATION_CONTROL_STATE_INVALID")
    trusted_directory(EXECUTIONS_ROOT, {0o700}, "MIGRATION_CONTROL_STATE_INVALID")
    intent, grant, original_context = load_recovery_intent_and_grant(context, parameters)
    if intent["grant_sha256"] != grant["grant_sha256"]:
        reject("MIGRATION_CONTROL_RECOVERY_INTENT_INVALID")
    active = load_active_fence_for_recovery(context, parameters, grant["grant_sha256"])
    validate_secret_metadata()
    validate_postgres_container(parameters)
    emergency_seal_fence(parameters)
    validate_postgres_container(parameters)

    exact_candidates = recovery_candidate_ids(context, grant)
    execution_root = EXECUTIONS_ROOT / f"{context['operation_id']}.{grant['grant_sha256']}"
    try:
        execution_metadata = os.lstat(execution_root)
    except FileNotFoundError:
        execution_metadata = None
    except OSError:
        reject("MIGRATION_CONTROL_RECOVERY_EXECUTION_INVALID")
    candidate: dict[str, Any] | None = None
    manifest: dict[str, Any] | None = None
    if execution_metadata is not None:
        candidate, manifest = load_recovery_candidate(
            execution_root, context, parameters, grant,
        )
    if exact_candidates and execution_metadata is None:
        reject("MIGRATION_CONTROL_RECOVERY_EXECUTION_INVALID")
    container_id = exact_candidates[0] if exact_candidates else None
    if container_id is not None:
        if manifest is None or candidate is not None and candidate["container_id"] != container_id:
            reject("MIGRATION_CONTROL_RECOVERY_CANDIDATE_INVALID")
        name = f"cyd-uat-migration-{context['original_authorization_sha256'][:24]}"
        contain_candidate(container_id, name, original_context, parameters, manifest, grant)
        candidate_status = "EXACT_CANDIDATE_STOPPED"
    else:
        candidate_status = "EXACT_CANDIDATE_ALREADY_ABSENT" if candidate is not None else "EXACT_CANDIDATE_NOT_CREATED"
    record = persist_recovery_containment(
        context, parameters, grant, active, candidate_status, container_id,
    )
    return {
        "result": "RECOVERY_CONTAINMENT_PERSISTED",
        "promotion_id": parameters["promotion_id"],
        "migration_operation_id": context["operation_id"],
        "recovery_authorization_sha256": context["execution_authorization_sha256"],
        "active_fence_sha256": record["active_fence_sha256"],
        "database_fence_containment": record["database_fence_containment"],
        "candidate_containment": record["candidate_containment"],
        "recovery_containment_sha256": record["recovery_containment_sha256"],
    }


def main(arguments: list[str]) -> None:
    execute_arguments = ["execute", "EXACT_UAT_PROMOTION_MIGRATION_AFTER_AUTHORIZATION"]
    recover_arguments = ["recover", "CONTAIN_EXACT_UAT_PROMOTION_MIGRATION_BEFORE_RECOVERY"]
    if os.geteuid() != 0 or arguments not in (execute_arguments, recover_arguments):
        reject("MIGRATION_CONTROL_CLI_INVALID")
    def interrupted(_signal: int, _frame: Any) -> None:
        reject("MIGRATION_CONTROL_INTERRUPTED")

    for name in ("SIGTERM", "SIGINT", "SIGHUP"):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), interrupted)
    raw = sys.stdin.buffer.read(MAX_JSON_BYTES + 1)
    context = strict_json(raw, "MIGRATION_CONTROL_CONTEXT_INVALID")
    if raw != canonical_json(context):
        reject("MIGRATION_CONTROL_CONTEXT_INVALID")
    if arguments == execute_arguments:
        expected_grant_sha256 = os.environ.get("ERP_UAT_PROMOTION_MIGRATION_GRANT_SHA256", "")
        result = execute(context, expected_grant_sha256)
    else:
        result = recover(context)
    sys.stdout.buffer.write(canonical_json(result))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except MigrationControlError as error:
        print(error.code, file=sys.stderr)
        raise SystemExit(1)
