#!/usr/bin/python3
"""Bootstrap or switch the reviewed root-owned ERP release supervisor bundle."""

from __future__ import annotations

import hashlib
import fcntl
import importlib.util
from importlib.machinery import SourceFileLoader
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


INSTALL_CONTRACT = "chenyida-erp-release-supervisor-install-authorization/v1"
INSTALL_CONFIRMATION = "INSTALL_EXACT_RELEASE_SUPERVISOR_BUNDLE"
BUNDLE_CONTRACT = "chenyida-erp-release-supervisor-bundle/v1"
INSTALL_AUTHORIZATION_ROOT = Path("/var/lib/chenyida-erp/release-supervisor-install-authorizations")
INSTALL_PENDING_ROOT = INSTALL_AUTHORIZATION_ROOT / "pending"
INSTALL_CONSUMED_ROOT = Path("/var/lib/chenyida-erp/release-supervisor-install-authorizations/consumed")
INSTALL_RECEIPT_ROOT = Path("/var/lib/chenyida-erp/release-supervisor-install-receipts")
INSTALL_JOURNAL_ROOT = Path("/var/lib/chenyida-erp/release-supervisor-install-journal")
INSTALL_LOCK_FILE = Path("/var/lock/chenyida-erp-release-supervisor-install-v1.lock")
GLOBAL_RELEASE_LOCK = Path("/run/lock/chenyida-erp-release-gate-v1.lock")
RELEASE_AUTHORIZATION_ROOT = Path("/var/lib/chenyida-erp/release-authorizations")
RELEASE_AUTHORIZATION_PENDING_ROOT = RELEASE_AUTHORIZATION_ROOT / "pending"
RELEASE_AUTHORIZATION_CONSUMED_ROOT = RELEASE_AUTHORIZATION_ROOT / "consumed"
RUNTIME_PROBE_ROOT = Path("/var/lib/chenyida-erp/runtime-probes")
RUNTIME_PROBE_MARKER = RUNTIME_PROBE_ROOT / ".chenyida-erp-runtime-probe-root-v1"
RUNTIME_PROBE_MARKER_VALUE = b"chenyida-erp-runtime-probe-root/v1\n"
RUNTIME_PRIVILEGE_STATE_ROOT = Path("/var/lib/chenyida-erp/postgresql-runtime-privilege-operator")
RUNTIME_PRIVILEGE_STATE_MARKER = RUNTIME_PRIVILEGE_STATE_ROOT / ".chenyida-erp-postgresql-runtime-privilege-operator-v1"
RUNTIME_PRIVILEGE_STATE_MARKER_VALUE = b"chenyida-erp-postgresql-runtime-privilege-operator/v1\n"
RUNTIME_PRIVILEGE_STATE_DIRECTORIES = ("active", "completed", "preparing", "quarantine", "receipts")
CLUSTER_POLICY_STATE_ROOT = Path("/var/lib/chenyida-erp/postgresql-cluster-recovery-policy-v2")
CLUSTER_POLICY_STATE_MARKER = CLUSTER_POLICY_STATE_ROOT / ".chenyida-erp-postgresql-cluster-recovery-policy-v2"
CLUSTER_POLICY_STATE_MARKER_VALUE = b"chenyida-erp-postgresql-cluster-recovery-policy-activation/v1\n"
CLUSTER_POLICY_STATE_DIRECTORIES = ("history", "intents", "quarantine", "receipts", "recoveries")
CLUSTER_POLICY_TARGET_FILE = Path("/etc/chenyida-erp/recovery/postgresql-cluster-recovery-policy.json")
CLUSTER_POLICY_TEMPLATE_FILE_SHA256 = "1a092993b1dda00bd8a2aac0899cb4e1eee83e9b336022bdb72f3e4d23e317aa"
CLUSTER_POLICY_TEMPLATE_POLICY_SHA256 = "c30951ad74a827c06e8256cfc124f61bd5672bca9daa7abda21c0896523378b8"
NOTIFIER_EGRESS_STATE_ROOT = Path("/var/lib/chenyida-erp/monitoring-notifier-egress-v1")
NOTIFIER_EGRESS_STATE_MARKER = NOTIFIER_EGRESS_STATE_ROOT / ".chenyida-erp-monitoring-notifier-egress-v1"
NOTIFIER_EGRESS_STATE_MARKER_VALUE = b"chenyida-erp-monitoring-notifier-egress-activation/v1\n"
NOTIFIER_EGRESS_STATE_DIRECTORIES = ("history", "intents", "quarantine", "receipts", "recoveries")
NOTIFIER_EGRESS_POLICY_FILE = Path("/etc/chenyida-erp/monitoring-v1/views/notifier-egress-policy.json")
NOTIFIER_EGRESS_ACTIVATION_VIEW = Path("/etc/chenyida-erp/monitoring-v1/views/notifier-egress-activation.json")
NOTIFIER_EGRESS_BASE_UNIT = Path("/etc/systemd/system/chenyida-erp-monitor-notifier.service")
NOTIFIER_EGRESS_DROPIN = Path("/etc/systemd/system/chenyida-erp-monitor-notifier.service.d/50-chenyida-erp-notifier-egress.conf")
NOTIFIER_EGRESS_TEMPLATE_FILE_SHA256 = "ebb318471ef96a9d91e78c72d81802aa193480befe36017c43b74277eb0c4617"
NOTIFIER_EGRESS_TEMPLATE_POLICY_SHA256 = "abaf585ec2c5c735e18418265a688f01f2b4d1e0b26b2125432cde860f222b20"
SUPERVISOR_BASE = Path("/usr/local/libexec/chenyida-erp-release-supervisor")
BUNDLES_ROOT = SUPERVISOR_BASE / "bundles"
LAUNCHERS_ROOT = SUPERVISOR_BASE / "launchers"
INSTALLERS_ROOT = SUPERVISOR_BASE / "installers"
LAUNCHER_PATH = Path("/usr/local/sbin/chenyida-erp-release-supervisor-v1")
INSTALLER_REPOSITORY_PATH = "chenyida_erp_site/scripts/install-release-supervisor.py"
LAUNCHER_REPOSITORY_PATH = "chenyida_erp_site/scripts/release-supervisor-launcher.py"
BUNDLE_MANIFEST_REPOSITORY_PATH = "chenyida_erp_site/release/release-supervisor-bundle-v1.json"
SAFE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
GIT_OBJECT = re.compile(r"^[0-9a-f]{40}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
ISO_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
MAX_JSON_BYTES = 1024 * 1024
MAX_BUNDLE_FILE_BYTES = 8 * 1024 * 1024
MAX_BUNDLE_BYTES = 32 * 1024 * 1024
MAX_BUNDLE_FILES = 132
RECEIPT_CONTRACT = "chenyida-erp-release-supervisor-install-receipt/v2"
JOURNAL_CONTRACT = "chenyida-erp-release-supervisor-install-journal/v2"


class InstallError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def reject(code: str) -> None:
    raise InstallError(code)


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


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
        return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_constant=lambda _: reject(code))
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError):
        reject(code)


def exact(value: Any, fields: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != fields:
        reject(code)
    return value


def parse_time(value: Any) -> datetime:
    if not isinstance(value, str) or not ISO_UTC.fullmatch(value):
        reject("SUPERVISOR_INSTALL_AUTHORIZATION_TIME_INVALID")
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except ValueError:
        reject("SUPERVISOR_INSTALL_AUTHORIZATION_TIME_INVALID")


def trusted_file(path: Path, expected_mode: int | None, maximum: int, code: str, expected_gid: int = 0) -> bytes:
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError:
        reject(code)
    try:
        before = os.fstat(descriptor)
        mode = stat.S_IMODE(before.st_mode)
        if not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_gid != expected_gid or before.st_nlink != 1 or (expected_mode is not None and mode != expected_mode) or (expected_mode is None and mode & 0o022) or before.st_size < 1 or before.st_size > maximum:
            reject(code)
        raw = bytearray()
        while len(raw) < before.st_size:
            chunk = os.read(descriptor, min(1024 * 1024, before.st_size - len(raw)))
            if not chunk:
                reject(code)
            raw.extend(chunk)
        after = os.fstat(descriptor)
        current = os.lstat(path)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) or current.st_dev != before.st_dev or current.st_ino != before.st_ino or current.st_nlink != 1 or current.st_uid != 0 or current.st_gid != expected_gid or stat.S_ISLNK(current.st_mode):
            reject(code)
        return bytes(raw)
    finally:
        os.close(descriptor)


def trusted_directory(path: Path, mode: int, code: str) -> None:
    try:
        value = os.lstat(path)
    except OSError:
        reject(code)
    if not stat.S_ISDIR(value.st_mode) or stat.S_ISLNK(value.st_mode) or value.st_uid != 0 or value.st_gid != 0 or stat.S_IMODE(value.st_mode) != mode:
        reject(code)


def git(repository: Path, *arguments: str, binary: bool = False) -> bytes | str:
    environment = {"PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_NO_REPLACE_OBJECTS": "1"}
    result = subprocess.run(["/usr/bin/git", "-c", "core.useReplaceRefs=false", "-c", f"safe.directory={repository}", "-C", str(repository), *arguments], env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False)
    if result.returncode != 0:
        reject("SUPERVISOR_INSTALL_GIT_READ_FAILED")
    return result.stdout if binary else result.stdout.decode("utf-8").strip()


def git_blob(repository: Path, commit: str, relative: str, maximum: int = MAX_BUNDLE_FILE_BYTES, expected_size: int | None = None) -> bytes:
    if not re.fullmatch(r"[A-Za-z0-9._/-]{1,240}", relative) or relative.startswith("/") or any(part in ("", ".", "..") for part in relative.split("/")):
        reject("SUPERVISOR_INSTALL_BUNDLE_PATH_INVALID")
    size_raw = git(repository, "cat-file", "-s", f"{commit}:{relative}")
    try:
        size = int(str(size_raw))
    except ValueError:
        reject("SUPERVISOR_INSTALL_SOURCE_FILE_SIZE_INVALID")
    if size < 1 or size > maximum or (expected_size is not None and size != expected_size):
        reject("SUPERVISOR_INSTALL_SOURCE_FILE_SIZE_INVALID")
    raw = git(repository, "show", f"{commit}:{relative}", binary=True)
    if not isinstance(raw, bytes) or len(raw) != size:
        reject("SUPERVISOR_INSTALL_SOURCE_FILE_SIZE_INVALID")
    return raw


def validate_authorization(value: Any, now: datetime | None) -> dict[str, Any]:
    fields = {"schema_version", "contract", "authorization_id", "created_at", "expires_at", "repository_root", "source_commit", "source_tree", "manifest_commit", "manifest_tree", "bundle_manifest_sha256", "launcher_sha256", "installer_sha256", "nonce", "confirmation"}
    value = exact(value, fields, "SUPERVISOR_INSTALL_AUTHORIZATION_FIELDS_INVALID")
    if value["schema_version"] != 1 or value["contract"] != INSTALL_CONTRACT or value["confirmation"] != INSTALL_CONFIRMATION:
        reject("SUPERVISOR_INSTALL_AUTHORIZATION_VERSION_INVALID")
    if not isinstance(value["authorization_id"], str) or not IDENTIFIER.fullmatch(value["authorization_id"]):
        reject("SUPERVISOR_INSTALL_AUTHORIZATION_ID_INVALID")
    if not isinstance(value["repository_root"], str) or not value["repository_root"].startswith("/") or value["repository_root"] == "/" or os.path.normpath(value["repository_root"]) != value["repository_root"]:
        reject("SUPERVISOR_INSTALL_AUTHORIZATION_REPOSITORY_INVALID")
    for field in ("source_commit", "source_tree", "manifest_commit", "manifest_tree"):
        if not isinstance(value[field], str) or not GIT_OBJECT.fullmatch(value[field]):
            reject("SUPERVISOR_INSTALL_AUTHORIZATION_GIT_INVALID")
    for field in ("bundle_manifest_sha256", "launcher_sha256", "installer_sha256", "nonce"):
        if not isinstance(value[field], str) or not SHA256.fullmatch(value[field]):
            reject("SUPERVISOR_INSTALL_AUTHORIZATION_DIGEST_INVALID")
    created, expires = parse_time(value["created_at"]), parse_time(value["expires_at"])
    if expires <= created or expires - created > timedelta(hours=24):
        reject("SUPERVISOR_INSTALL_AUTHORIZATION_TIME_INVALID")
    if now is not None:
        now = now.astimezone(timezone.utc)
        if created > now + timedelta(minutes=5) or now >= expires or now - created > timedelta(hours=24):
            reject("SUPERVISOR_INSTALL_AUTHORIZATION_TIME_INVALID")
    return value


def load_authorization(path: Path, now: datetime) -> tuple[dict[str, Any], str]:
    trusted_directory(INSTALL_AUTHORIZATION_ROOT, 0o700, "SUPERVISOR_INSTALL_AUTHORIZATION_ROOT_INVALID")
    trusted_directory(INSTALL_PENDING_ROOT, 0o700, "SUPERVISOR_INSTALL_AUTHORIZATION_ROOT_INVALID")
    if not path.is_absolute() or path.parent != INSTALL_PENDING_ROOT:
        reject("SUPERVISOR_INSTALL_AUTHORIZATION_PATH_INVALID")
    raw = trusted_file(path, 0o400, MAX_JSON_BYTES, "SUPERVISOR_INSTALL_AUTHORIZATION_FILE_INVALID")
    value = validate_authorization(strict_json(raw, "SUPERVISOR_INSTALL_AUTHORIZATION_JSON_INVALID"), now)
    if raw != canonical_json(value) or path.name != f"{value['authorization_id']}.json":
        reject("SUPERVISOR_INSTALL_AUTHORIZATION_NOT_CANONICAL")
    return value, sha256(raw)


def ensure_directory(path: Path, mode: int) -> None:
    if not path.exists():
        path.mkdir(mode=mode)
        os.chown(path, 0, 0)
        os.chmod(path, mode)
        fsync_directory(path.parent)
    trusted_directory(path, mode, "SUPERVISOR_INSTALL_DIRECTORY_INVALID")


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_root_file(path: Path, raw: bytes, mode: int) -> None:
    try:
        os.lstat(path)
    except FileNotFoundError:
        pass
    else:
        raise FileExistsError(path)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    published = False
    try:
        offset = 0
        while offset < len(raw):
            written = os.write(descriptor, raw[offset:])
            if written < 1:
                reject("SUPERVISOR_INSTALL_FILE_WRITE_FAILED")
            offset += written
        os.fchmod(descriptor, mode)
        os.fchown(descriptor, 0, 0)
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        try:
            os.lstat(path)
        except FileNotFoundError:
            pass
        else:
            raise FileExistsError(path)
        os.rename(temporary, path)
        fsync_directory(path.parent)
        published = True
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if not published:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass


def ensure_root_marker(path: Path, expected: bytes) -> None:
    if path.exists():
        if trusted_file(path, 0o400, MAX_JSON_BYTES, "SUPERVISOR_INSTALL_MARKER_INVALID") != expected:
            reject("SUPERVISOR_INSTALL_MARKER_INVALID")
        return
    try:
        write_root_file(path, expected, 0o400)
    except FileExistsError:
        if trusted_file(path, 0o400, MAX_JSON_BYTES, "SUPERVISOR_INSTALL_MARKER_INVALID") != expected:
            reject("SUPERVISOR_INSTALL_MARKER_INVALID")


def assert_no_runtime_privilege_operator_interlock(state_root: Path | None = None) -> None:
    state_root = state_root or RUNTIME_PRIVILEGE_STATE_ROOT
    try:
        os.lstat(state_root)
    except FileNotFoundError:
        return
    except OSError:
        reject("SUPERVISOR_INSTALL_RUNTIME_PRIVILEGE_STATE_INVALID")
    trusted_directory(state_root, 0o700, "SUPERVISOR_INSTALL_RUNTIME_PRIVILEGE_STATE_INVALID")
    marker = state_root / RUNTIME_PRIVILEGE_STATE_MARKER.name
    if trusted_file(marker, 0o400, 256, "SUPERVISOR_INSTALL_RUNTIME_PRIVILEGE_STATE_INVALID") != RUNTIME_PRIVILEGE_STATE_MARKER_VALUE:
        reject("SUPERVISOR_INSTALL_RUNTIME_PRIVILEGE_STATE_INVALID")
    try:
        with os.scandir(state_root) as iterator:
            entries = sorted(item.name for item in iterator)
    except OSError:
        reject("SUPERVISOR_INSTALL_RUNTIME_PRIVILEGE_STATE_INVALID")
    expected = sorted((RUNTIME_PRIVILEGE_STATE_MARKER.name, *RUNTIME_PRIVILEGE_STATE_DIRECTORIES))
    if entries != expected:
        reject("SUPERVISOR_INSTALL_RUNTIME_PRIVILEGE_STATE_INVALID")
    for name in RUNTIME_PRIVILEGE_STATE_DIRECTORIES:
        directory = state_root / name
        trusted_directory(directory, 0o700, "SUPERVISOR_INSTALL_RUNTIME_PRIVILEGE_STATE_INVALID")
        if name in {"active", "preparing", "quarantine"}:
            try:
                with os.scandir(directory) as iterator:
                    if next(iterator, None) is not None:
                        reject("SUPERVISOR_INSTALL_RUNTIME_PRIVILEGE_RECOVERY_REQUIRED")
            except OSError:
                reject("SUPERVISOR_INSTALL_RUNTIME_PRIVILEGE_STATE_INVALID")


def assert_no_cluster_policy_activation_interlock(state_root: Path | None = None, target_file: Path | None = None) -> None:
    state_root = state_root or CLUSTER_POLICY_STATE_ROOT
    target_file = target_file or CLUSTER_POLICY_TARGET_FILE
    try:
        os.lstat(state_root)
    except FileNotFoundError:
        return
    except OSError:
        reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
    trusted_directory(state_root, 0o700, "SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
    marker = state_root / CLUSTER_POLICY_STATE_MARKER.name
    if trusted_file(marker, 0o400, 256, "SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID") != CLUSTER_POLICY_STATE_MARKER_VALUE:
        reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
    try:
        with os.scandir(state_root) as iterator:
            entries = sorted(item.name for item in iterator)
    except OSError:
        reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
    current_file = state_root / "current.json"
    expected = sorted((CLUSTER_POLICY_STATE_MARKER.name, *CLUSTER_POLICY_STATE_DIRECTORIES, *(('current.json',) if current_file.exists() else ())))
    if entries != expected:
        reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
    for name in CLUSTER_POLICY_STATE_DIRECTORIES:
        trusted_directory(state_root / name, 0o700, "SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
    try:
        with os.scandir(state_root / "quarantine") as iterator:
            quarantine_entries = list(iterator)
    except OSError:
        reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
    if quarantine_entries:
        reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_RECOVERY_REQUIRED")

    generation = 0
    current_raw: bytes | None = None
    if current_file.exists():
        current_raw = trusted_file(current_file, 0o400, MAX_JSON_BYTES, "SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
        current = strict_json(current_raw, "SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
        if not isinstance(current, dict) or current_raw != canonical_json(current) \
            or current.get("contract") != "chenyida-erp-postgresql-cluster-recovery-policy-activation-receipt/v1" \
            or not isinstance(current.get("generation"), int) or isinstance(current.get("generation"), bool) \
            or not 1 <= current["generation"] <= 1_000_000 \
            or not isinstance(current.get("receipt_sha256"), str) or not SHA256.fullmatch(current["receipt_sha256"]):
            reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
        generation = current["generation"]

    history_pattern = re.compile(r"^[0-9]{16}\.([0-9a-f]{64})\.json$")
    intent_pattern = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$")
    with os.scandir(state_root / "history") as iterator:
        history_names = sorted(item.name for item in iterator)
    with os.scandir(state_root / "receipts") as iterator:
        receipt_names = sorted(item.name for item in iterator)
    if len(history_names) != generation or len(receipt_names) != generation \
        or any(not history_pattern.fullmatch(name) for name in (*history_names, *receipt_names)):
        reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_RECOVERY_REQUIRED")
    receipt_fields = {
        "schema_version", "contract", "activation_id", "operation", "status", "committed_at", "environment",
        "generation", "policy_id", "policy_sha256", "policy_file_sha256", "previous_policy_sha256",
        "previous_activation_receipt_sha256", "rollback_target_activation_receipt_sha256",
        "template_file_sha256", "template_policy_sha256", "supervisor_bundle_sha256", "authorization_sha256",
        "release_identity_sha256", "approval_reference_sha256", "responsible_operator_identity_sha256", "approver_identity_sha256",
        "rpo_hours", "rto_minutes", "target_disposition", "activated_at", "expires_at",
        "state_root", "policy_target", "history_file", "receipt_sha256",
    }
    history_raw_by_generation: dict[int, bytes] = {}
    receipt_by_name: dict[str, dict[str, Any]] = {}
    receipts_by_generation: list[dict[str, Any]] = []
    previous_policy_sha256 = "0" * 64
    previous_receipt_sha256 = "0" * 64
    environment: str | None = None
    for index in range(generation):
        prefix = f"{index + 1:016d}."
        if not history_names[index].startswith(prefix) or not receipt_names[index].startswith(prefix):
            reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
        history_match = history_pattern.fullmatch(history_names[index])
        history_raw = trusted_file(state_root / "history" / history_names[index], 0o400, MAX_JSON_BYTES, "SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
        history_value = strict_json(history_raw, "SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
        if history_match is None or not isinstance(history_value, dict) or history_raw != canonical_json(history_value) \
            or sha256(history_raw) != history_match.group(1):
            reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
        receipt_raw = trusted_file(state_root / "receipts" / receipt_names[index], 0o400, MAX_JSON_BYTES, "SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
        receipt = strict_json(receipt_raw, "SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
        receipt_match = history_pattern.fullmatch(receipt_names[index])
        if not isinstance(receipt, dict) or set(receipt) != receipt_fields or receipt_raw != canonical_json(receipt) \
            or receipt.get("schema_version") != 1 \
            or receipt.get("contract") != "chenyida-erp-postgresql-cluster-recovery-policy-activation-receipt/v1" \
            or receipt.get("status") != "COMMITTED" or receipt.get("operation") not in ("ACTIVATE", "ROLLBACK") \
            or receipt.get("generation") != index + 1 or receipt_match is None \
            or receipt.get("receipt_sha256") != receipt_match.group(1) \
            or sha256(canonical_json({key: value for key, value in receipt.items() if key != "receipt_sha256"})) != receipt["receipt_sha256"] \
            or receipt.get("policy_sha256") != history_match.group(1) or receipt.get("policy_file_sha256") != sha256(history_raw) \
            or receipt.get("previous_policy_sha256") != previous_policy_sha256 \
            or receipt.get("previous_activation_receipt_sha256") != previous_receipt_sha256 \
            or receipt.get("template_file_sha256") != CLUSTER_POLICY_TEMPLATE_FILE_SHA256 \
            or receipt.get("template_policy_sha256") != CLUSTER_POLICY_TEMPLATE_POLICY_SHA256 \
            or receipt.get("state_root") != str(CLUSTER_POLICY_STATE_ROOT) \
            or receipt.get("policy_target") != str(CLUSTER_POLICY_TARGET_FILE) \
            or receipt.get("history_file") != str(CLUSTER_POLICY_STATE_ROOT / "history" / history_names[index]) \
            or not isinstance(receipt.get("activation_id"), str) or not IDENTIFIER.fullmatch(receipt["activation_id"]) \
            or not isinstance(receipt.get("policy_id"), str) or not IDENTIFIER.fullmatch(receipt["policy_id"]) \
            or receipt.get("environment") not in ("UAT", "PRODUCTION") \
            or environment is not None and receipt["environment"] != environment \
            or not isinstance(receipt.get("rpo_hours"), int) or isinstance(receipt.get("rpo_hours"), bool) or not 1 <= receipt["rpo_hours"] <= 168 \
            or not isinstance(receipt.get("rto_minutes"), int) or isinstance(receipt.get("rto_minutes"), bool) or not 1 <= receipt["rto_minutes"] <= 10_080 \
            or receipt.get("target_disposition") not in ("DESTROY_AFTER_EVIDENCE", "RETAIN_QUARANTINED_FOR_APPROVED_INCIDENT") \
            or any(not isinstance(receipt.get(field), str) or not SHA256.fullmatch(receipt[field]) for field in receipt_fields if field.endswith("_sha256")) \
            or any(receipt[field] == "0" * 64 for field in receipt_fields if field.endswith("_sha256") and field not in {"previous_policy_sha256", "previous_activation_receipt_sha256", "rollback_target_activation_receipt_sha256"}) \
            or any(not isinstance(receipt.get(field), str) or not ISO_UTC.fullmatch(receipt[field]) for field in ("committed_at", "activated_at", "expires_at")) \
            or receipt.get("committed_at") != receipt.get("activated_at"):
            reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
        if receipt["operation"] == "ACTIVATE" and receipt["rollback_target_activation_receipt_sha256"] != "0" * 64 \
            or receipt["operation"] == "ROLLBACK" and (index < 2 or receipt["rollback_target_activation_receipt_sha256"] == "0" * 64):
            reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
        try:
            activated_at = datetime.strptime(receipt["activated_at"], "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
            expires_at = datetime.strptime(receipt["expires_at"], "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
        except ValueError:
            reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
        if expires_at <= activated_at or expires_at - activated_at > timedelta(hours=24):
            reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
        if receipt["operation"] == "ROLLBACK":
            rollback_target = receipts_by_generation[index - 2]
            if receipt["rollback_target_activation_receipt_sha256"] != rollback_target["receipt_sha256"] \
                or receipt["environment"] != rollback_target["environment"] \
                or receipt["rpo_hours"] != rollback_target["rpo_hours"] \
                or receipt["rto_minutes"] != rollback_target["rto_minutes"] \
                or receipt["target_disposition"] != rollback_target["target_disposition"]:
                reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
        actors = {receipt["approval_reference_sha256"], receipt["responsible_operator_identity_sha256"], receipt["approver_identity_sha256"]}
        if len(actors) != 3 or "0" * 64 in actors:
            reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
        history_raw_by_generation[index + 1] = history_raw
        receipt_by_name[receipt_names[index]] = receipt
        receipts_by_generation.append(receipt)
        previous_policy_sha256 = receipt["policy_sha256"]
        previous_receipt_sha256 = receipt["receipt_sha256"]
        environment = receipt["environment"]
        if index == generation - 1 and current_raw != receipt_raw:
            reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_RECOVERY_REQUIRED")

    try:
        os.lstat(target_file)
    except FileNotFoundError:
        if generation != 0:
            reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_RECOVERY_REQUIRED")
    except OSError:
        reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
    else:
        target_raw = trusted_file(target_file, 0o440, MAX_JSON_BYTES, "SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
        if generation == 0 or target_raw != history_raw_by_generation[generation]:
            reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_RECOVERY_REQUIRED")

    intent_by_sha256: dict[str, dict[str, Any]] = {}
    intent_receipt_sha256: set[str] = set()
    with os.scandir(state_root / "intents") as iterator:
        for item in iterator:
            if not intent_pattern.fullmatch(item.name):
                reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
            raw = trusted_file(Path(item.path), 0o400, MAX_JSON_BYTES, "SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
            intent = strict_json(raw, "SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
            fields = {
                "schema_version", "contract", "operation_id", "operation", "created_at", "original_authorization_sha256",
                "supervisor_bundle_sha256", "parameters", "policy", "receipt", "intent_sha256",
            }
            if not isinstance(intent, dict) or set(intent) != fields or raw != canonical_json(intent) \
                or intent.get("contract") != "chenyida-erp-postgresql-cluster-recovery-policy-activation-intent/v1" \
                or not isinstance(intent.get("operation_id"), str) or not IDENTIFIER.fullmatch(intent["operation_id"]) \
                or intent.get("operation") not in ("ACTIVATE", "ROLLBACK") \
                or item.name != f"{intent.get('operation_id')}.{intent.get('intent_sha256')}.json" \
                or not isinstance(intent.get("intent_sha256"), str) or not SHA256.fullmatch(intent["intent_sha256"]) \
                or sha256(canonical_json({key: value for key, value in intent.items() if key != "intent_sha256"})) != intent["intent_sha256"]:
                reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
            receipt = intent.get("receipt")
            if not isinstance(receipt, dict) or not isinstance(receipt.get("generation"), int) or isinstance(receipt.get("generation"), bool) \
                or not 1 <= receipt["generation"] <= 1_000_000 \
                or not isinstance(receipt.get("receipt_sha256"), str) or not SHA256.fullmatch(receipt["receipt_sha256"]):
                reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
            candidate = f"{receipt['generation']:016d}.{receipt['receipt_sha256']}.json"
            stored_receipt = receipt_by_name.get(candidate)
            if stored_receipt is None:
                reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_RECOVERY_REQUIRED")
            if intent["receipt"] != stored_receipt or canonical_json(intent["policy"]) != history_raw_by_generation[receipt["generation"]] \
                or intent["operation_id"] != receipt["activation_id"] or intent["operation"] != receipt["operation"] \
                or intent["original_authorization_sha256"] != receipt["authorization_sha256"] \
                or intent["supervisor_bundle_sha256"] != receipt["supervisor_bundle_sha256"] \
                or receipt["receipt_sha256"] in intent_receipt_sha256:
                reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
            intent_by_sha256[intent["intent_sha256"]] = intent
            intent_receipt_sha256.add(receipt["receipt_sha256"])
    if intent_receipt_sha256 != {receipt["receipt_sha256"] for receipt in receipts_by_generation}:
        reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_RECOVERY_REQUIRED")

    with os.scandir(state_root / "recoveries") as iterator:
        for item in iterator:
            if not intent_pattern.fullmatch(item.name):
                reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
            raw = trusted_file(Path(item.path), 0o400, MAX_JSON_BYTES, "SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
            value = strict_json(raw, "SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")
            fields = {
                "schema_version", "contract", "execution_authorization_id", "execution_authorization_sha256", "prepared_at",
                "original_operation_id", "original_authorization_sha256", "intent_sha256", "decision", "reason", "recovery_sha256",
            }
            if not isinstance(value, dict) or set(value) != fields or raw != canonical_json(value) \
                or value.get("schema_version") != 1 \
                or value.get("contract") != "chenyida-erp-postgresql-cluster-recovery-policy-activation-recovery/v1" \
                or value.get("decision") not in ("RESUME_PUBLICATION", "ALREADY_COMMITTED", "QUARANTINE") \
                or (value.get("decision") == "QUARANTINE") != isinstance(value.get("reason"), str) \
                or not isinstance(value.get("execution_authorization_id"), str) or not IDENTIFIER.fullmatch(value["execution_authorization_id"]) \
                or not isinstance(value.get("original_operation_id"), str) or not IDENTIFIER.fullmatch(value["original_operation_id"]) \
                or any(not isinstance(value.get(field), str) or not SHA256.fullmatch(value[field]) for field in ("execution_authorization_sha256", "original_authorization_sha256", "intent_sha256", "recovery_sha256")) \
                or not isinstance(value.get("prepared_at"), str) or not ISO_UTC.fullmatch(value["prepared_at"]) \
                or sha256(canonical_json({key: field_value for key, field_value in value.items() if key != "recovery_sha256"})) != value["recovery_sha256"] \
                or item.name != f"{value.get('execution_authorization_id')}.{value.get('recovery_sha256')}.json" \
                or value["intent_sha256"] not in intent_by_sha256 \
                or intent_by_sha256[value["intent_sha256"]]["operation_id"] != value["original_operation_id"]:
                reject("SUPERVISOR_INSTALL_CLUSTER_POLICY_STATE_INVALID")


def assert_no_notifier_egress_activation_interlock(
    state_root: Path | None = None,
    policy_file: Path | None = None,
    activation_view: Path | None = None,
    base_unit: Path | None = None,
    dropin: Path | None = None,
) -> None:
    state_root = state_root or NOTIFIER_EGRESS_STATE_ROOT
    policy_file = policy_file or NOTIFIER_EGRESS_POLICY_FILE
    activation_view = activation_view or NOTIFIER_EGRESS_ACTIVATION_VIEW
    base_unit = base_unit or NOTIFIER_EGRESS_BASE_UNIT
    dropin = dropin or NOTIFIER_EGRESS_DROPIN
    try:
        os.lstat(state_root)
    except FileNotFoundError:
        return
    except OSError:
        reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
    trusted_directory(state_root, 0o700, "SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
    marker = state_root / NOTIFIER_EGRESS_STATE_MARKER.name
    if trusted_file(marker, 0o400, 256, "SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID") != NOTIFIER_EGRESS_STATE_MARKER_VALUE:
        reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
    current_file = state_root / "current.json"
    current_exists = current_file.exists()
    expected_entries = sorted((NOTIFIER_EGRESS_STATE_MARKER.name, *NOTIFIER_EGRESS_STATE_DIRECTORIES, *(("current.json",) if current_exists else ())))
    try:
        with os.scandir(state_root) as iterator:
            if sorted(item.name for item in iterator) != expected_entries:
                reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
    except OSError:
        reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
    for name in NOTIFIER_EGRESS_STATE_DIRECTORIES:
        trusted_directory(state_root / name, 0o700, "SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
    try:
        with os.scandir(state_root / "quarantine") as iterator:
            if next(iterator, None) is not None:
                reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_RECOVERY_REQUIRED")
    except OSError:
        reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")

    generation = 0
    current_raw: bytes | None = None
    current: dict[str, Any] | None = None
    if current_exists:
        current_raw = trusted_file(current_file, 0o400, MAX_JSON_BYTES, "SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
        current = strict_json(current_raw, "SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
        if not isinstance(current, dict) or current_raw != canonical_json(current) \
            or current.get("contract") != "chenyida-erp-monitoring-notifier-egress-activation-receipt/v1" \
            or not isinstance(current.get("generation"), int) or isinstance(current.get("generation"), bool) \
            or not 1 <= current["generation"] <= 1_000_000:
            reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
        generation = current["generation"]

    file_pattern = re.compile(r"^[0-9]{16}\.([0-9a-f]{64})\.json$")
    intent_pattern = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json$")
    try:
        with os.scandir(state_root / "history") as iterator:
            history_names = sorted(item.name for item in iterator)
        with os.scandir(state_root / "receipts") as iterator:
            receipt_names = sorted(item.name for item in iterator)
        with os.scandir(state_root / "intents") as iterator:
            intent_names = sorted(item.name for item in iterator)
        with os.scandir(state_root / "recoveries") as iterator:
            recovery_names = sorted(item.name for item in iterator)
    except OSError:
        reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
    if len(history_names) != generation or len(receipt_names) != generation or len(intent_names) != generation \
        or any(not file_pattern.fullmatch(name) for name in (*history_names, *receipt_names)) \
        or any(not intent_pattern.fullmatch(name) for name in (*intent_names, *recovery_names)):
        reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_RECOVERY_REQUIRED")

    receipt_fields = {
        "schema_version", "contract", "activation_id", "operation", "status", "committed_at", "environment", "generation",
        "policy_id", "policy_sha256", "policy_file_sha256", "previous_policy_sha256", "previous_activation_receipt_sha256",
        "rollback_target_activation_receipt_sha256", "deployment_id", "target_id", "target_generation", "endpoint_sha256",
        "address_set_sha256", "monitoring_bundle_sha256", "supervisor_bundle_sha256", "notifier_config_sha256",
        "adapter_id", "adapter_sha256", "credential_sha256", "credential_generation", "oncall_roster_generation",
        "escalation_table_sha256", "base_unit_sha256", "dropin_sha256", "effective_unit_sha256", "template_file_sha256",
        "template_policy_sha256", "authorization_sha256", "approval_reference_sha256", "responsible_operator_identity_sha256",
        "approver_identity_sha256", "activated_at", "expires_at", "state_root", "policy_target", "activation_view",
        "dropin_target", "history_file", "receipt_sha256",
    }
    previous_policy = "0" * 64
    previous_receipt = "0" * 64
    latest_policy_raw: bytes | None = None
    latest_receipt_raw: bytes | None = None
    latest_policy: dict[str, Any] | None = None
    committed_receipts: dict[str, dict[str, Any]] = {}
    for index in range(generation):
        expected_prefix = f"{index + 1:016d}."
        history_match = file_pattern.fullmatch(history_names[index])
        receipt_match = file_pattern.fullmatch(receipt_names[index])
        if history_match is None or receipt_match is None or not history_names[index].startswith(expected_prefix) or not receipt_names[index].startswith(expected_prefix):
            reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
        policy_raw = trusted_file(state_root / "history" / history_names[index], 0o400, MAX_JSON_BYTES, "SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
        receipt_raw = trusted_file(state_root / "receipts" / receipt_names[index], 0o400, MAX_JSON_BYTES, "SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
        policy = strict_json(policy_raw, "SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
        receipt = strict_json(receipt_raw, "SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
        if not isinstance(policy, dict) or policy_raw != canonical_json(policy) or sha256(policy_raw) != history_match.group(1) \
            or policy.get("contract") != "chenyida-erp-monitoring-notifier-egress-policy/v1" or policy.get("generation") != index + 1 \
            or not isinstance(receipt, dict) or set(receipt) != receipt_fields or receipt_raw != canonical_json(receipt) \
            or receipt.get("schema_version") != 1 or receipt.get("contract") != "chenyida-erp-monitoring-notifier-egress-activation-receipt/v1" \
            or receipt.get("status") != "COMMITTED" or receipt.get("operation") not in ("ACTIVATE", "ROLLBACK") \
            or receipt.get("generation") != index + 1 or receipt.get("receipt_sha256") != receipt_match.group(1) \
            or sha256(canonical_json({key: value for key, value in receipt.items() if key != "receipt_sha256"})) != receipt["receipt_sha256"] \
            or receipt.get("policy_sha256") != history_match.group(1) or receipt.get("policy_file_sha256") != sha256(policy_raw) \
            or receipt.get("previous_policy_sha256") != previous_policy or receipt.get("previous_activation_receipt_sha256") != previous_receipt \
            or receipt.get("template_file_sha256") != NOTIFIER_EGRESS_TEMPLATE_FILE_SHA256 \
            or receipt.get("template_policy_sha256") != NOTIFIER_EGRESS_TEMPLATE_POLICY_SHA256 \
            or receipt.get("state_root") != str(state_root) or receipt.get("policy_target") != str(policy_file) \
            or receipt.get("activation_view") != str(activation_view) or receipt.get("dropin_target") != str(dropin) \
            or receipt.get("history_file") != str(state_root / "history" / history_names[index]) \
            or receipt.get("adapter_id") != "HTTPS_JSON_ACK_V1" \
            or any(not isinstance(receipt.get(field), str) or not SHA256.fullmatch(receipt[field]) for field in receipt_fields if field.endswith("_sha256")):
            reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
        if receipt["operation"] == "ACTIVATE" and receipt["rollback_target_activation_receipt_sha256"] != "0" * 64 \
            or receipt["operation"] == "ROLLBACK" and (index < 2 or receipt["rollback_target_activation_receipt_sha256"] == "0" * 64):
            reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
        if receipt["operation"] == "ROLLBACK":
            target = committed_receipts.get(receipt["rollback_target_activation_receipt_sha256"])
            if target is None or target["generation"] != index - 1:
                reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
        previous_policy, previous_receipt = receipt["policy_sha256"], receipt["receipt_sha256"]
        latest_policy_raw, latest_receipt_raw, latest_policy = policy_raw, receipt_raw, policy
        committed_receipts[receipt["receipt_sha256"]] = receipt
    if generation and (current_raw != latest_receipt_raw or current is None or current.get("receipt_sha256") != previous_receipt):
        reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_RECOVERY_REQUIRED")

    for name in intent_names:
        raw = trusted_file(state_root / "intents" / name, 0o400, MAX_JSON_BYTES, "SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
        value = strict_json(raw, "SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
        if not isinstance(value, dict) or raw != canonical_json(value) \
            or value.get("contract") != "chenyida-erp-monitoring-notifier-egress-activation-intent/v1" \
            or name != f"{value.get('operation_id')}.{value.get('intent_sha256')}.json" \
            or not isinstance(value.get("receipt"), dict) or value["receipt"].get("receipt_sha256") not in committed_receipts:
            reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_RECOVERY_REQUIRED")
    for name in recovery_names:
        raw = trusted_file(state_root / "recoveries" / name, 0o400, MAX_JSON_BYTES, "SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
        value = strict_json(raw, "SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
        if not isinstance(value, dict) or raw != canonical_json(value) \
            or value.get("contract") != "chenyida-erp-monitoring-notifier-egress-activation-recovery/v1" \
            or name != f"{value.get('execution_authorization_id')}.{value.get('recovery_sha256')}.json":
            reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")

    def optional_lstat(file: Path) -> os.stat_result | None:
        try:
            return os.lstat(file)
        except FileNotFoundError:
            return None
        except OSError:
            reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")

    policy_metadata, activation_metadata = optional_lstat(policy_file), optional_lstat(activation_view)
    if generation == 0:
        if policy_metadata is not None or activation_metadata is not None or optional_lstat(dropin.parent) is not None:
            reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_RECOVERY_REQUIRED")
        return
    if policy_metadata is None or activation_metadata is None or policy_metadata.st_uid != 0 or activation_metadata.st_uid != 0 \
        or policy_metadata.st_gid <= 0 or policy_metadata.st_gid != activation_metadata.st_gid \
        or stat.S_IMODE(policy_metadata.st_mode) != 0o440 or stat.S_IMODE(activation_metadata.st_mode) != 0o440:
        reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_RECOVERY_REQUIRED")
    policy_view_raw = trusted_file(policy_file, 0o440, MAX_JSON_BYTES, "SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID", policy_metadata.st_gid)
    activation_raw = trusted_file(activation_view, 0o440, MAX_JSON_BYTES, "SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID", policy_metadata.st_gid)
    if policy_view_raw != latest_policy_raw or activation_raw != latest_receipt_raw or latest_policy is None or current is None:
        reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_RECOVERY_REQUIRED")
    if sha256(trusted_file(base_unit, 0o444, MAX_JSON_BYTES, "SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")) != current["base_unit_sha256"]:
        reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_RECOVERY_REQUIRED")
    trusted_directory(dropin.parent, 0o755, "SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
    try:
        with os.scandir(dropin.parent) as iterator:
            dropin_names = [item.name for item in iterator]
    except OSError:
        reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
    if dropin_names != [dropin.name]:
        reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_RECOVERY_REQUIRED")
    dropin_raw = trusted_file(dropin, 0o444, 64 * 1024, "SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
    addresses = latest_policy.get("network", {}).get("allowed_addresses")
    if not isinstance(addresses, list) or any(not isinstance(item, dict) or not isinstance(item.get("systemd_prefix"), str) for item in addresses):
        reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_STATE_INVALID")
    expected_dropin = ("\n".join([
        "# Managed by chenyida-erp release supervisor; manual edits are forbidden.", "[Service]", "IPAddressAllow=",
        *[f"IPAddressAllow={item['systemd_prefix']}" for item in addresses], "",
    ])).encode("utf-8")
    if dropin_raw != expected_dropin or sha256(dropin_raw) != current["dropin_sha256"]:
        reject("SUPERVISOR_INSTALL_NOTIFIER_EGRESS_RECOVERY_REQUIRED")


def acquire_install_lock(path: Path = INSTALL_LOCK_FILE) -> int:
    flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags, 0o600)
    except OSError:
        reject("SUPERVISOR_INSTALL_LOCK_INVALID")
    try:
        os.fchown(descriptor, 0, 0)
        os.fchmod(descriptor, 0o600)
        value = os.fstat(descriptor)
        current = os.lstat(path)
        if not stat.S_ISREG(value.st_mode) or value.st_uid != 0 or value.st_gid != 0 or value.st_nlink != 1 or stat.S_IMODE(value.st_mode) != 0o600 or current.st_dev != value.st_dev or current.st_ino != value.st_ino or stat.S_ISLNK(current.st_mode):
            reject("SUPERVISOR_INSTALL_LOCK_INVALID")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            reject("SUPERVISOR_INSTALL_LOCK_BUSY")
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def acquire_global_release_lock(path: Path = GLOBAL_RELEASE_LOCK) -> int:
    try:
        parent = os.lstat(path.parent)
    except OSError:
        reject("SUPERVISOR_INSTALL_GLOBAL_LOCK_INVALID")
    if not stat.S_ISDIR(parent.st_mode) or stat.S_ISLNK(parent.st_mode) or parent.st_uid != 0 or parent.st_gid != 0 or stat.S_IMODE(parent.st_mode) & 0o022:
        reject("SUPERVISOR_INSTALL_GLOBAL_LOCK_INVALID")
    flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags, 0o600)
    except OSError:
        reject("SUPERVISOR_INSTALL_GLOBAL_LOCK_INVALID")
    try:
        os.fchown(descriptor, 0, 0)
        os.fchmod(descriptor, 0o600)
        value = os.fstat(descriptor)
        current = os.lstat(path)
        if not stat.S_ISREG(value.st_mode) or value.st_uid != 0 or value.st_gid != 0 or value.st_nlink != 1 or stat.S_IMODE(value.st_mode) != 0o600 or current.st_dev != value.st_dev or current.st_ino != value.st_ino or stat.S_ISLNK(current.st_mode):
            reject("SUPERVISOR_INSTALL_GLOBAL_LOCK_INVALID")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            reject("SUPERVISOR_INSTALL_GLOBAL_LOCK_BUSY")
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def read_canonical_root_json(path: Path, code: str) -> dict[str, Any]:
    raw = trusted_file(path, 0o400, MAX_JSON_BYTES, code)
    value = strict_json(raw, code)
    if not isinstance(value, dict) or raw != canonical_json(value):
        reject(code)
    return value


def ensure_stored_launcher(raw: bytes, digest: str) -> Path:
    if not SHA256.fullmatch(digest) or sha256(raw) != digest:
        reject("SUPERVISOR_INSTALL_STORED_LAUNCHER_INVALID")
    launcher_store = LAUNCHERS_ROOT / digest
    if launcher_store.exists():
        if sha256(trusted_file(launcher_store, 0o555, 4 * 1024 * 1024, "SUPERVISOR_INSTALL_STORED_LAUNCHER_INVALID")) != digest:
            reject("SUPERVISOR_INSTALL_STORED_LAUNCHER_INVALID")
    else:
        try:
            write_root_file(launcher_store, raw, 0o555)
        except FileExistsError:
            if sha256(trusted_file(launcher_store, 0o555, 4 * 1024 * 1024, "SUPERVISOR_INSTALL_STORED_LAUNCHER_INVALID")) != digest:
                reject("SUPERVISOR_INSTALL_STORED_LAUNCHER_INVALID")
    return launcher_store


def ensure_stored_installer(raw: bytes, digest: str) -> Path:
    if not SHA256.fullmatch(digest) or sha256(raw) != digest:
        reject("SUPERVISOR_INSTALL_STORED_INSTALLER_INVALID")
    installer_store = INSTALLERS_ROOT / digest
    if installer_store.exists():
        if sha256(trusted_file(installer_store, 0o555, 4 * 1024 * 1024, "SUPERVISOR_INSTALL_STORED_INSTALLER_INVALID")) != digest:
            reject("SUPERVISOR_INSTALL_STORED_INSTALLER_INVALID")
    else:
        try:
            write_root_file(installer_store, raw, 0o555)
        except FileExistsError:
            if sha256(trusted_file(installer_store, 0o555, 4 * 1024 * 1024, "SUPERVISOR_INSTALL_STORED_INSTALLER_INVALID")) != digest:
                reject("SUPERVISOR_INSTALL_STORED_INSTALLER_INVALID")
    return installer_store


def remove_staging_tree(path: Path) -> None:
    if not path.exists():
        return
    for directory, names, _ in os.walk(path, topdown=True, followlinks=False):
        directory_path = Path(directory)
        directory_path.chmod(0o700)
        for name in names:
            child = directory_path / name
            if child.is_dir() and not child.is_symlink():
                child.chmod(0o700)
    shutil.rmtree(path)


def install_record_paths(authorization: dict[str, Any], authorization_digest: str) -> tuple[Path, Path, Path, Path]:
    stem = f"{authorization['authorization_id']}.{authorization_digest}"
    return (
        INSTALL_JOURNAL_ROOT / f"{stem}.prepared.json",
        INSTALL_JOURNAL_ROOT / f"{stem}.committed.json",
        INSTALL_RECEIPT_ROOT / f"{authorization['authorization_id']}.{authorization['bundle_manifest_sha256']}.json",
        INSTALL_CONSUMED_ROOT / f"{authorization['authorization_id']}.{authorization_digest}.json",
    )


def receipt_identity(authorization: dict[str, Any], authorization_digest: str, previous_launcher_sha256: str | None) -> dict[str, Any]:
    return {
        "schema_version": 2,
        "contract": RECEIPT_CONTRACT,
        "authorization_id": authorization["authorization_id"],
        "authorization_sha256": authorization_digest,
        "source_commit": authorization["source_commit"],
        "source_tree": authorization["source_tree"],
        "bundle_manifest_sha256": authorization["bundle_manifest_sha256"],
        "launcher_sha256": authorization["launcher_sha256"],
        "previous_launcher_sha256": previous_launcher_sha256,
        "result": "INSTALLED",
    }


def validate_prepared_record(path: Path) -> tuple[dict[str, Any], dict[str, Any], str]:
    value = read_canonical_root_json(path, "SUPERVISOR_INSTALL_JOURNAL_INVALID")
    fields = {"schema_version", "contract", "phase", "authorization", "authorization_sha256", "prepared_at", "previous_launcher_sha256"}
    if set(value) != fields or value["schema_version"] != 2 or value["contract"] != JOURNAL_CONTRACT or value["phase"] != "PREPARED":
        reject("SUPERVISOR_INSTALL_JOURNAL_INVALID")
    authorization = validate_authorization(value["authorization"], None)
    digest = value["authorization_sha256"]
    if not isinstance(digest, str) or not SHA256.fullmatch(digest) or sha256(canonical_json(authorization)) != digest:
        reject("SUPERVISOR_INSTALL_JOURNAL_INVALID")
    expected_path = install_record_paths(authorization, digest)[0]
    if path != expected_path:
        reject("SUPERVISOR_INSTALL_JOURNAL_INVALID")
    try:
        parse_time(value["prepared_at"])
    except InstallError:
        reject("SUPERVISOR_INSTALL_JOURNAL_INVALID")
    previous = value["previous_launcher_sha256"]
    if previous is not None and (not isinstance(previous, str) or not SHA256.fullmatch(previous)):
        reject("SUPERVISOR_INSTALL_JOURNAL_INVALID")
    return value, authorization, digest


def validate_install_receipt(path: Path, authorization: dict[str, Any], authorization_digest: str, previous_launcher_sha256: str | None) -> dict[str, Any]:
    value = read_canonical_root_json(path, "SUPERVISOR_INSTALL_RECEIPT_INVALID")
    expected = receipt_identity(authorization, authorization_digest, previous_launcher_sha256)
    if set(value) != {*expected, "installed_at"} or any(value.get(field) != item for field, item in expected.items()):
        reject("SUPERVISOR_INSTALL_RECEIPT_INVALID")
    try:
        parse_time(value["installed_at"])
    except InstallError:
        reject("SUPERVISOR_INSTALL_RECEIPT_INVALID")
    return value


def validate_committed_record(prepared_path: Path, prepared: dict[str, Any], authorization: dict[str, Any], authorization_digest: str) -> dict[str, Any]:
    _, committed_path, receipt_path, _ = install_record_paths(authorization, authorization_digest)
    value = read_canonical_root_json(committed_path, "SUPERVISOR_INSTALL_JOURNAL_INVALID")
    fields = {"schema_version", "contract", "phase", "authorization_id", "authorization_sha256", "prepared_sha256", "committed_at", "receipt_sha256"}
    if set(value) != fields or value["schema_version"] != 2 or value["contract"] != JOURNAL_CONTRACT or value["phase"] != "COMMITTED" or value["authorization_id"] != authorization["authorization_id"] or value["authorization_sha256"] != authorization_digest or value["prepared_sha256"] != sha256(canonical_json(prepared)):
        reject("SUPERVISOR_INSTALL_JOURNAL_INVALID")
    try:
        parse_time(value["committed_at"])
    except InstallError:
        reject("SUPERVISOR_INSTALL_JOURNAL_INVALID")
    receipt = validate_install_receipt(receipt_path, authorization, authorization_digest, prepared["previous_launcher_sha256"])
    if value["receipt_sha256"] != sha256(canonical_json(receipt)):
        reject("SUPERVISOR_INSTALL_JOURNAL_INVALID")
    return value


def unresolved_prepared_install() -> tuple[Path, dict[str, Any], dict[str, Any], str] | None:
    if not INSTALL_JOURNAL_ROOT.exists():
        return None
    trusted_directory(INSTALL_JOURNAL_ROOT, 0o700, "SUPERVISOR_INSTALL_JOURNAL_INVALID")
    unresolved: list[tuple[Path, dict[str, Any], dict[str, Any], str]] = []
    for prepared_path in sorted(INSTALL_JOURNAL_ROOT.glob("*.prepared.json")):
        prepared, authorization, digest = validate_prepared_record(prepared_path)
        committed_path = install_record_paths(authorization, digest)[1]
        if committed_path.exists():
            validate_committed_record(prepared_path, prepared, authorization, digest)
        else:
            unresolved.append((prepared_path, prepared, authorization, digest))
    if len(unresolved) > 1:
        reject("SUPERVISOR_INSTALL_RECOVERY_REQUIRED")
    return unresolved[0] if unresolved else None


def archive_install_authorization(authorization: dict[str, Any], authorization_path: Path | None, authorization_digest: str, destination: Path) -> None:
    raw = canonical_json(authorization)
    if destination.exists():
        if trusted_file(destination, 0o400, MAX_JSON_BYTES, "SUPERVISOR_INSTALL_CONSUMED_AUTHORIZATION_INVALID") != raw:
            reject("SUPERVISOR_INSTALL_CONSUMED_AUTHORIZATION_INVALID")
        if authorization_path is not None and authorization_path.exists():
            reject("SUPERVISOR_INSTALL_AUTHORIZATION_DUPLICATED")
        return
    if authorization_path is not None and authorization_path.exists():
        if trusted_file(authorization_path, 0o400, MAX_JSON_BYTES, "SUPERVISOR_INSTALL_AUTHORIZATION_FILE_INVALID") != raw:
            reject("SUPERVISOR_INSTALL_AUTHORIZATION_FILE_INVALID")
        os.rename(authorization_path, destination)
        fsync_directory(INSTALL_PENDING_ROOT)
        fsync_directory(INSTALL_CONSUMED_ROOT)
    else:
        write_root_file(destination, raw, 0o400)


def load_launcher_module(file: Path):
    loader = SourceFileLoader("installed_release_supervisor", str(file))
    specification = importlib.util.spec_from_loader("installed_release_supervisor", loader)
    if specification is None or specification.loader is None:
        reject("SUPERVISOR_INSTALL_LAUNCHER_IMPORT_FAILED")
    module = importlib.util.module_from_spec(specification)
    previous = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        specification.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous
    return module


def load_installer_module(file: Path):
    loader = SourceFileLoader("authorized_release_supervisor_installer", str(file))
    specification = importlib.util.spec_from_loader("authorized_release_supervisor_installer", loader)
    if specification is None or specification.loader is None:
        reject("SUPERVISOR_INSTALL_RECOVERY_INSTALLER_INVALID")
    module = importlib.util.module_from_spec(specification)
    previous = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        specification.loader.exec_module(module)
    except Exception:
        reject("SUPERVISOR_INSTALL_RECOVERY_INSTALLER_INVALID")
    finally:
        sys.dont_write_bytecode = previous
    if not callable(getattr(module, "install", None)):
        reject("SUPERVISOR_INSTALL_RECOVERY_INSTALLER_INVALID")
    return module


def validate_manifest_commit_relationship(repository: Path, authorization: dict[str, Any]) -> None:
    commit_object = str(git(repository, "cat-file", "commit", authorization["manifest_commit"]))
    header = commit_object.split("\n\n", 1)[0].splitlines()
    trees = [line.removeprefix("tree ") for line in header if line.startswith("tree ")]
    parents = [line.removeprefix("parent ") for line in header if line.startswith("parent ")]
    if trees != [authorization["manifest_tree"]] or parents != [authorization["source_commit"]]:
        reject("SUPERVISOR_INSTALL_MANIFEST_COMMIT_RELATIONSHIP_INVALID")
    changed = str(git(repository, "diff-tree", "--no-commit-id", "--name-status", "--no-renames", "-r", authorization["source_commit"], authorization["manifest_commit"])).splitlines()
    if len(changed) != 1 or changed[0] not in {f"A\t{BUNDLE_MANIFEST_REPOSITORY_PATH}", f"M\t{BUNDLE_MANIFEST_REPOSITORY_PATH}"}:
        reject("SUPERVISOR_INSTALL_MANIFEST_COMMIT_SCOPE_INVALID")


def validate_bundle_payload(repository: Path, authorization: dict[str, Any], manifest_raw: bytes) -> tuple[dict[str, Any], list[tuple[str, bytes, int]]]:
    manifest = strict_json(manifest_raw, "SUPERVISOR_INSTALL_MANIFEST_INVALID")
    manifest = exact(manifest, {"schema_version", "contract", "bundle_version", "source_commit", "source_tree", "launcher_sha256", "files"}, "SUPERVISOR_INSTALL_MANIFEST_FIELDS_INVALID")
    if manifest.get("schema_version") != 1 or manifest.get("contract") != BUNDLE_CONTRACT or manifest.get("bundle_version") != 1:
        reject("SUPERVISOR_INSTALL_MANIFEST_VERSION_INVALID")
    if manifest_raw != canonical_json(manifest) or manifest["source_commit"] != authorization["source_commit"] or manifest["source_tree"] != authorization["source_tree"] or manifest["launcher_sha256"] != authorization["launcher_sha256"]:
        reject("SUPERVISOR_INSTALL_MANIFEST_IDENTITY_MISMATCH")
    files = manifest.get("files")
    if not isinstance(files, list) or len(files) < 1 or len(files) > MAX_BUNDLE_FILES:
        reject("SUPERVISOR_INSTALL_MANIFEST_FILES_INVALID")
    validated: list[dict[str, Any]] = []
    previous = ""
    total_bytes = 0
    for item in files:
        entry = exact(item, {"path", "sha256", "bytes", "mode"}, "SUPERVISOR_INSTALL_MANIFEST_FILE_FIELDS_INVALID")
        relative = entry["path"]
        if not isinstance(relative, str) or relative <= previous or not re.fullmatch(r"[A-Za-z0-9._/-]{1,240}", relative) or relative.startswith("/") or any(part in ("", ".", "..") for part in relative.split("/")) or entry["mode"] not in ("0444", "0555") or not isinstance(entry["sha256"], str) or not SHA256.fullmatch(entry["sha256"]) or not isinstance(entry["bytes"], int) or isinstance(entry["bytes"], bool) or entry["bytes"] < 1 or entry["bytes"] > MAX_BUNDLE_FILE_BYTES:
            reject("SUPERVISOR_INSTALL_MANIFEST_FILE_INVALID")
        previous = relative
        total_bytes += entry["bytes"]
        if total_bytes > MAX_BUNDLE_BYTES:
            reject("SUPERVISOR_INSTALL_MANIFEST_TOTAL_BYTES_INVALID")
        validated.append(entry)
    payloads: list[tuple[str, bytes, int]] = []
    for entry in validated:
        relative = entry["path"]
        raw = git_blob(repository, authorization["source_commit"], relative, expected_size=entry["bytes"])
        if len(raw) != entry["bytes"] or sha256(raw) != entry["sha256"]:
            reject("SUPERVISOR_INSTALL_SOURCE_FILE_MISMATCH")
        payloads.append((relative, raw, int(entry["mode"], 8)))
    return manifest, payloads


def stage_bundle(bundle: Path, manifest_raw: bytes, payloads: list[tuple[str, bytes, int]]) -> None:
    if bundle.exists():
        trusted_directory(bundle, 0o700, "SUPERVISOR_INSTALL_STAGING_INVALID")
        if any(bundle.iterdir()):
            reject("SUPERVISOR_INSTALL_STAGING_INVALID")
        bundle.chmod(0o755)
    else:
        bundle.mkdir(mode=0o755)
    for relative, raw, mode in payloads:
        target = bundle / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        write_root_file(target, raw, mode)
    write_root_file(bundle / "bundle-manifest.json", manifest_raw, 0o444)
    for directory, _, _ in os.walk(bundle, topdown=False):
        os.chown(directory, 0, 0)
        os.chmod(directory, 0o555)
        fsync_directory(Path(directory))


def preflight_bundle(manifest_raw: bytes, payloads: list[tuple[str, bytes, int]], launcher_raw: bytes, manifest_digest: str) -> None:
    staging_parent = Path(tempfile.mkdtemp(prefix="cyd-release-supervisor-preflight."))
    launcher_staging = staging_parent / "launcher"
    try:
        bundle_staging = staging_parent / manifest_digest
        stage_bundle(bundle_staging, manifest_raw, payloads)
        write_root_file(launcher_staging, launcher_raw, 0o555)
        try:
            launcher_module = load_launcher_module(launcher_staging)
            launcher_module.verify_bundle(bundle_staging, manifest_digest, launcher_staging)
        except Exception:
            reject("SUPERVISOR_INSTALL_BUNDLE_PREFLIGHT_INVALID")
    finally:
        remove_staging_tree(staging_parent)


def install(repository: Path, authorization: dict[str, Any], authorization_path: Path | None, authorization_digest: str, installer_path: Path) -> dict[str, Any]:
    if repository.resolve() != repository or str(repository) != authorization["repository_root"] or git(repository, "rev-parse", "--show-toplevel") != str(repository):
        reject("SUPERVISOR_INSTALL_REPOSITORY_MISMATCH")
    for commit_field, tree_field in (("source_commit", "source_tree"), ("manifest_commit", "manifest_tree")):
        if git(repository, "rev-parse", "--verify", f"{authorization[commit_field]}^{{commit}}") != authorization[commit_field] or git(repository, "rev-parse", "--verify", f"{authorization[commit_field]}^{{tree}}") != authorization[tree_field]:
            reject("SUPERVISOR_INSTALL_GIT_IDENTITY_MISMATCH")
    validate_manifest_commit_relationship(repository, authorization)

    installer_raw = trusted_file(installer_path, None, 4 * 1024 * 1024, "SUPERVISOR_INSTALLER_FILE_INVALID")
    if sha256(installer_raw) != authorization["installer_sha256"] or git_blob(repository, authorization["source_commit"], INSTALLER_REPOSITORY_PATH, maximum=4 * 1024 * 1024) != installer_raw:
        reject("SUPERVISOR_INSTALLER_DIGEST_MISMATCH")
    launcher_raw = git_blob(repository, authorization["source_commit"], LAUNCHER_REPOSITORY_PATH, maximum=4 * 1024 * 1024)
    if sha256(launcher_raw) != authorization["launcher_sha256"]:
        reject("SUPERVISOR_INSTALL_LAUNCHER_DIGEST_MISMATCH")
    manifest_raw = git_blob(repository, authorization["manifest_commit"], BUNDLE_MANIFEST_REPOSITORY_PATH, maximum=MAX_JSON_BYTES)
    if sha256(manifest_raw) != authorization["bundle_manifest_sha256"]:
        reject("SUPERVISOR_INSTALL_MANIFEST_DIGEST_MISMATCH")
    _, payloads = validate_bundle_payload(repository, authorization, manifest_raw)
    preflight_bundle(manifest_raw, payloads, launcher_raw, authorization["bundle_manifest_sha256"])
    assert_no_runtime_privilege_operator_interlock()
    assert_no_cluster_policy_activation_interlock()
    assert_no_notifier_egress_activation_interlock()

    ensure_directory(Path("/usr/local/libexec"), 0o755)
    ensure_directory(SUPERVISOR_BASE, 0o755)
    ensure_directory(BUNDLES_ROOT, 0o755)
    ensure_directory(LAUNCHERS_ROOT, 0o755)
    ensure_directory(INSTALLERS_ROOT, 0o755)
    ensure_directory(INSTALL_CONSUMED_ROOT, 0o700)
    ensure_directory(INSTALL_RECEIPT_ROOT, 0o700)
    ensure_directory(INSTALL_JOURNAL_ROOT, 0o700)
    ensure_directory(RELEASE_AUTHORIZATION_ROOT, 0o700)
    ensure_directory(RELEASE_AUTHORIZATION_PENDING_ROOT, 0o700)
    ensure_directory(RELEASE_AUTHORIZATION_CONSUMED_ROOT, 0o700)
    ensure_directory(RUNTIME_PROBE_ROOT, 0o700)
    ensure_root_marker(RUNTIME_PROBE_MARKER, RUNTIME_PROBE_MARKER_VALUE)
    ensure_directory(RUNTIME_PRIVILEGE_STATE_ROOT, 0o700)
    ensure_root_marker(RUNTIME_PRIVILEGE_STATE_MARKER, RUNTIME_PRIVILEGE_STATE_MARKER_VALUE)
    for directory in RUNTIME_PRIVILEGE_STATE_DIRECTORIES:
        ensure_directory(RUNTIME_PRIVILEGE_STATE_ROOT / directory, 0o700)
    trusted_directory(Path("/usr/local/sbin"), 0o755, "SUPERVISOR_INSTALL_DIRECTORY_INVALID")

    prepared_file, committed_file, receipt_file, destination = install_record_paths(authorization, authorization_digest)
    unresolved = unresolved_prepared_install()
    if unresolved is not None and unresolved[0] != prepared_file:
        reject("SUPERVISOR_INSTALL_RECOVERY_REQUIRED")

    previous_launcher_sha256: str | None
    prepared_exists = prepared_file.exists()
    if prepared_exists:
        prepared, prepared_authorization, prepared_digest = validate_prepared_record(prepared_file)
        if prepared_authorization != authorization or prepared_digest != authorization_digest:
            reject("SUPERVISOR_INSTALL_JOURNAL_INVALID")
        previous_launcher_sha256 = prepared["previous_launcher_sha256"]
    else:
        try:
            os.lstat(LAUNCHER_PATH)
        except FileNotFoundError:
            previous_launcher_sha256 = None
        else:
            previous_raw = trusted_file(LAUNCHER_PATH, 0o555, 4 * 1024 * 1024, "SUPERVISOR_INSTALL_PREVIOUS_LAUNCHER_INVALID")
            previous_launcher_sha256 = sha256(previous_raw)
            ensure_stored_launcher(previous_raw, previous_launcher_sha256)
        prepared_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        prepared = {"schema_version": 2, "contract": JOURNAL_CONTRACT, "phase": "PREPARED", "authorization": authorization, "authorization_sha256": authorization_digest, "prepared_at": prepared_at, "previous_launcher_sha256": previous_launcher_sha256}

    current_launcher_sha256: str | None
    try:
        current_launcher_sha256 = sha256(trusted_file(LAUNCHER_PATH, 0o555, 4 * 1024 * 1024, "SUPERVISOR_INSTALL_ACTIVE_LAUNCHER_INVALID"))
    except InstallError as error:
        if error.code != "SUPERVISOR_INSTALL_ACTIVE_LAUNCHER_INVALID":
            raise
        try:
            os.lstat(LAUNCHER_PATH)
        except FileNotFoundError:
            current_launcher_sha256 = None
        else:
            raise
    if current_launcher_sha256 not in {previous_launcher_sha256, authorization["launcher_sha256"]}:
        reject("SUPERVISOR_INSTALL_RECOVERY_STATE_INVALID")

    expected_receipt_identity = receipt_identity(authorization, authorization_digest, previous_launcher_sha256)
    if receipt_file.exists():
        validate_install_receipt(receipt_file, authorization, authorization_digest, previous_launcher_sha256)
    if committed_file.exists() and not prepared_exists:
        reject("SUPERVISOR_INSTALL_JOURNAL_INVALID")
    authorization_raw = canonical_json(authorization)
    if destination.exists():
        if trusted_file(destination, 0o400, MAX_JSON_BYTES, "SUPERVISOR_INSTALL_CONSUMED_AUTHORIZATION_INVALID") != authorization_raw:
            reject("SUPERVISOR_INSTALL_CONSUMED_AUTHORIZATION_INVALID")
        if authorization_path is not None and authorization_path.exists():
            reject("SUPERVISOR_INSTALL_AUTHORIZATION_DUPLICATED")
    elif authorization_path is not None and authorization_path.exists() and trusted_file(authorization_path, 0o400, MAX_JSON_BYTES, "SUPERVISOR_INSTALL_AUTHORIZATION_FILE_INVALID") != authorization_raw:
        reject("SUPERVISOR_INSTALL_AUTHORIZATION_FILE_INVALID")

    bundle_staging = Path(tempfile.mkdtemp(prefix=f".{authorization['bundle_manifest_sha256']}.staging-", dir=BUNDLES_ROOT))
    launcher_staging_parent = Path(tempfile.mkdtemp(prefix=f".launcher-{authorization['bundle_manifest_sha256']}.", dir=BUNDLES_ROOT))
    launcher_staging = launcher_staging_parent / "launcher"
    launcher_temporary = LAUNCHER_PATH.parent / f".{LAUNCHER_PATH.name}.{os.getpid()}.tmp"
    try:
        stage_bundle(bundle_staging, manifest_raw, payloads)
        write_root_file(launcher_staging, launcher_raw, 0o555)
        launcher_module = load_launcher_module(launcher_staging)
        launcher_module.verify_staged_bundle(bundle_staging, authorization["bundle_manifest_sha256"], launcher_staging)
        target_bundle = BUNDLES_ROOT / authorization["bundle_manifest_sha256"]
        if target_bundle.exists():
            launcher_module.verify_bundle(target_bundle, authorization["bundle_manifest_sha256"], launcher_staging)
        else:
            os.rename(bundle_staging, target_bundle)
            fsync_directory(BUNDLES_ROOT)

        ensure_stored_launcher(launcher_raw, authorization["launcher_sha256"])
        ensure_stored_installer(installer_raw, authorization["installer_sha256"])

        if launcher_temporary.exists():
            reject("SUPERVISOR_INSTALL_LAUNCHER_TEMP_EXISTS")
    finally:
        remove_staging_tree(bundle_staging)
        remove_staging_tree(launcher_staging_parent)

    if not prepared_exists:
        write_root_file(prepared_file, canonical_json(prepared), 0o400)

    archive_install_authorization(authorization, authorization_path, authorization_digest, destination)

    try:
        if current_launcher_sha256 != authorization["launcher_sha256"]:
            write_root_file(launcher_temporary, launcher_raw, 0o555)
            os.replace(launcher_temporary, LAUNCHER_PATH)
            fsync_directory(LAUNCHER_PATH.parent)
        active_launcher = ensure_stored_launcher(launcher_raw, authorization["launcher_sha256"])
        launcher_module = load_launcher_module(active_launcher)
        launcher_module.verify_bundle(BUNDLES_ROOT / authorization["bundle_manifest_sha256"], authorization["bundle_manifest_sha256"], LAUNCHER_PATH)
    finally:
        try:
            launcher_temporary.unlink()
        except FileNotFoundError:
            pass

    installed_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    receipt = {**expected_receipt_identity, "installed_at": installed_at}
    if receipt_file.exists():
        receipt = validate_install_receipt(receipt_file, authorization, authorization_digest, previous_launcher_sha256)
    else:
        write_root_file(receipt_file, canonical_json(receipt), 0o400)

    committed_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    committed = {"schema_version": 2, "contract": JOURNAL_CONTRACT, "phase": "COMMITTED", "authorization_id": authorization["authorization_id"], "authorization_sha256": authorization_digest, "prepared_sha256": sha256(canonical_json(prepared)), "committed_at": committed_at, "receipt_sha256": sha256(canonical_json(receipt))}
    if committed_file.exists():
        validate_committed_record(prepared_file, prepared, authorization, authorization_digest)
    else:
        write_root_file(committed_file, canonical_json(committed), 0o400)
        validate_committed_record(prepared_file, prepared, authorization, authorization_digest)
    return receipt


def parse_cli(arguments: list[str]) -> tuple[Path, Path]:
    if len(arguments) != 6 or arguments[0] != "--repository-root" or arguments[2] != "--authorization-file" or arguments[4] != "--confirm" or arguments[5] != INSTALL_CONFIRMATION:
        reject("SUPERVISOR_INSTALL_CLI_ARGUMENT_INVALID")
    return Path(arguments[1]), Path(arguments[3])


def main() -> None:
    if os.getuid() != 0:
        reject("SUPERVISOR_INSTALL_ROOT_REQUIRED")
    repository, authorization_path = parse_cli(sys.argv[1:])
    lock_descriptor = acquire_install_lock()
    try:
        global_lock_descriptor = acquire_global_release_lock()
        try:
            unresolved = unresolved_prepared_install()
            if unresolved is not None:
                _, _, authorization, authorization_digest = unresolved
                repository = Path(authorization["repository_root"])
                pending_path = INSTALL_PENDING_ROOT / f"{authorization['authorization_id']}.json"
                authorization_path = pending_path if pending_path.exists() else None
                current_installer = Path(os.path.realpath(sys.argv[0]))
                current_raw = trusted_file(current_installer, None, 4 * 1024 * 1024, "SUPERVISOR_INSTALLER_FILE_INVALID")
                if sha256(current_raw) == authorization["installer_sha256"]:
                    receipt = install(repository, authorization, authorization_path, authorization_digest, current_installer)
                else:
                    stored_installer = INSTALLERS_ROOT / authorization["installer_sha256"]
                    stored_raw = trusted_file(stored_installer, 0o555, 4 * 1024 * 1024, "SUPERVISOR_INSTALL_RECOVERY_INSTALLER_INVALID")
                    if sha256(stored_raw) != authorization["installer_sha256"]:
                        reject("SUPERVISOR_INSTALL_RECOVERY_INSTALLER_INVALID")
                    authorized_installer = load_installer_module(stored_installer)
                    try:
                        receipt = authorized_installer.install(repository, authorization, authorization_path, authorization_digest, stored_installer)
                    except Exception as error:
                        code = getattr(error, "code", None)
                        if isinstance(code, str) and re.fullmatch(r"[A-Z][A-Z0-9_]{2,127}", code):
                            reject(code)
                        raise
            else:
                authorization, authorization_digest = load_authorization(authorization_path, datetime.now(timezone.utc))
                receipt = install(repository, authorization, authorization_path, authorization_digest, Path(os.path.realpath(sys.argv[0])))
            print(json.dumps(receipt, ensure_ascii=False, separators=(",", ":")))
        finally:
            os.close(global_lock_descriptor)
    finally:
        os.close(lock_descriptor)


if __name__ == "__main__":
    try:
        main()
    except InstallError as error:
        print(error.code, file=sys.stderr)
        raise SystemExit(1) from None
    except Exception:
        print("SUPERVISOR_INSTALL_INTERNAL_ERROR", file=sys.stderr)
        raise SystemExit(1) from None
