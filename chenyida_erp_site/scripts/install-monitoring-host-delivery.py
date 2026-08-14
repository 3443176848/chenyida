#!/usr/bin/python3
"""Authorized, crash-recoverable installer for the monitoring host delivery bundle."""

from __future__ import annotations

import ctypes
import errno
import fcntl
import grp
import hashlib
import json
import os
import pwd
import re
import resource
import shutil
import stat
import subprocess
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


INSTALL_ROOT = Path("/usr/local/libexec/chenyida-erp-monitoring-host-v1")
BUNDLES_ROOT = INSTALL_ROOT / "bundles"
RUNTIMES_ROOT = INSTALL_ROOT / "runtimes"
LAUNCHER_PATH = Path("/usr/local/sbin/chenyida-erp-monitoring-host-v1")
CONFIG_ROOT = Path("/etc/chenyida-erp/monitoring-v1")
PRIVATE_ROOT = CONFIG_ROOT / "private"
PRIVATE_CONFIG = PRIVATE_ROOT / "host-config.json"
VIEW_ROOT = CONFIG_ROOT / "views"
DATA_ROOT = Path("/var/lib/chenyida-erp/monitoring-v1")
ACTIVE_FILE = DATA_ROOT / "active.json"
ACTIVATION_ROOT = DATA_ROOT / "activations"
OBSERVATION_ROOT = DATA_ROOT / "observations"
STATE_ROOT = DATA_ROOT / "state"
OUTBOX_ROOT = DATA_ROOT / "outbox"
DELIVERY_ROOT = DATA_ROOT / "delivery"
PROJECTION_ROOT = DATA_ROOT / "projections"
RECEIPT_ROOT = DATA_ROOT / "install-receipts"
JOURNAL_ROOT = DATA_ROOT / "install-journal"
BACKUP_ROOT = JOURNAL_ROOT / "backups"
LOCK_ROOT = DATA_ROOT / "locks"
INSTALL_LOCK = Path("/run/lock/chenyida-erp/monitoring-host-install.lock")
GLOBAL_RELEASE_LOCK = Path("/run/lock/chenyida-erp-release-gate-v1.lock")
SYSTEMD_ROOT = Path("/etc/systemd/system")
MONITOR_MANIFEST_RELATIVE = Path("release/monitoring-host-delivery-bundle-v1.json")
LAUNCHER_RELATIVE = "chenyida_erp_site/scripts/monitoring-host-launcher.py"
POLICY_RELATIVE = "chenyida_erp_site/operations/monitoring-policy-v1.json"
HOST_CONFIG_CONTRACT = "chenyida-erp-monitoring-host-config/v1"
BUNDLE_CONTRACT = "chenyida-erp-monitoring-host-bundle/v1"
ACTIVATION_CONTRACT = "chenyida-erp-monitoring-host-activation/v1"
JOURNAL_CONTRACT = "chenyida-erp-monitoring-host-install-journal/v1"
INSTALL_RECEIPT_CONTRACT = "chenyida-erp-monitoring-host-install-receipt/v1"
DISABLE_RECEIPT_CONTRACT = "chenyida-erp-monitoring-host-disable-receipt/v1"
SAFE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
MAX_JSON_BYTES = 2 * 1024 * 1024
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_BUNDLE_BYTES = 32 * 1024 * 1024
MAX_RUNTIME_BYTES = 256 * 1024 * 1024
ZERO_SHA256 = "0" * 64
SHA256 = re.compile(r"^[0-9a-f]{64}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
GIT_OBJECT = re.compile(r"^[0-9a-f]{40}$")
ISO_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
VERSION = re.compile(r"^0\.1\.0-alpha\.\d+$")
MIGRATION = re.compile(r"^\d{4}_[a-z0-9_]+\.sql$")
IMAGE_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
IMAGE_REFERENCE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,190}@sha256:[0-9a-f]{64}$")
HOST = re.compile(r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
HTTPS_PATH = re.compile(r"^/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,1023}$")
SERVICES = ("caddy", "postgres", "web", "worker")
UNIT_RELATIVES = (
    "chenyida_erp_site/deployment/systemd/chenyida-erp-monitor-collector.service",
    "chenyida_erp_site/deployment/systemd/chenyida-erp-monitor-collector.timer",
    "chenyida_erp_site/deployment/systemd/chenyida-erp-monitor-continuity.service",
    "chenyida_erp_site/deployment/systemd/chenyida-erp-monitor-continuity.timer",
    "chenyida_erp_site/deployment/systemd/chenyida-erp-monitor-evaluator.service",
    "chenyida_erp_site/deployment/systemd/chenyida-erp-monitor-notifier.service",
    "chenyida_erp_site/deployment/systemd/chenyida-erp-monitor-notifier.timer",
)
TIMER_UNITS = (
    "chenyida-erp-monitor-collector.timer",
    "chenyida-erp-monitor-continuity.timer",
    "chenyida-erp-monitor-notifier.timer",
)
SERVICE_UNITS = (
    "chenyida-erp-monitor-collector.service",
    "chenyida-erp-monitor-evaluator.service",
    "chenyida-erp-monitor-notifier.service",
    "chenyida-erp-monitor-continuity.service",
)


class MonitoringInstallError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def reject(code: str) -> None:
    raise MonitoringInstallError(code)


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def strict_json(raw: bytes, code: str, maximum: int = MAX_JSON_BYTES) -> Any:
    if len(raw) < 2 or len(raw) > maximum:
        reject(code)

    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, item in items:
            if key in result:
                reject(code)
            result[key] = item
        return result

    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_constant=lambda _: reject(code))
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError, MemoryError):
        reject(code)
    if canonical_json(value) != raw:
        reject(code)
    return value


def exact_fields(value: Any, fields: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != fields:
        reject(code)
    return value


def trusted_directory(path: Path, modes: set[int], uid: int, gid: int, code: str) -> os.stat_result:
    try:
        metadata = os.lstat(path)
        if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) or metadata.st_uid != uid or metadata.st_gid != gid or stat.S_IMODE(metadata.st_mode) not in modes or Path(os.path.realpath(path)) != path:
            reject(code)
    except OSError:
        reject(code)
    return metadata


def sync_directory(directory: Path) -> None:
    descriptor = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def trusted_file(path: Path, modes: set[int], uid: int, gid: int, code: str, maximum: int = MAX_FILE_BYTES) -> tuple[bytes, os.stat_result]:
    try:
        before = os.lstat(path)
        if not stat.S_ISREG(before.st_mode) or stat.S_ISLNK(before.st_mode) or before.st_nlink != 1 or before.st_uid != uid or before.st_gid != gid or stat.S_IMODE(before.st_mode) not in modes or before.st_size < 1 or before.st_size > maximum:
            reject(code)
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError:
        reject(code)
    try:
        opened = os.fstat(descriptor)
        if (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) != (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns):
            reject(f"{code}_CHANGED")
        raw = b""
        while len(raw) <= maximum:
            chunk = os.read(descriptor, min(65536, maximum + 1 - len(raw)))
            if not chunk:
                break
            raw += chunk
        after = os.fstat(descriptor)
        path_after = os.lstat(path)
        if len(raw) != before.st_size or (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) or (path_after.st_dev, path_after.st_ino, path_after.st_nlink, path_after.st_uid, path_after.st_gid, stat.S_IMODE(path_after.st_mode)) != (opened.st_dev, opened.st_ino, 1, uid, gid, stat.S_IMODE(opened.st_mode)):
            reject(f"{code}_CHANGED")
        return raw, opened
    except OSError:
        reject(code)
    finally:
        os.close(descriptor)


def ensure_directory(path: Path, mode: int, uid: int, gid: int) -> None:
    try:
        os.mkdir(path, mode)
    except FileExistsError:
        pass
    metadata = os.lstat(path)
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        reject("MONITOR_INSTALL_DIRECTORY_INVALID")
    if metadata.st_uid != uid or metadata.st_gid != gid:
        os.chown(path, uid, gid, follow_symlinks=False)
    os.chmod(path, mode, follow_symlinks=False)
    metadata = os.lstat(path)
    if metadata.st_uid != uid or metadata.st_gid != gid or stat.S_IMODE(metadata.st_mode) != mode:
        reject("MONITOR_INSTALL_DIRECTORY_INVALID")


def write_new_file(path: Path, raw: bytes, mode: int, uid: int, gid: int, code: str) -> None:
    prepared_pattern = re.compile(rf"^\.{re.escape(path.name)}\.prepared\.[0-9a-f]{{64}}\.[0-9a-f]{{32}}\.tmp$")
    for entry in os.scandir(path.parent):
        if not prepared_pattern.fullmatch(entry.name):
            continue
        metadata = os.lstat(entry.path)
        if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_uid != uid or metadata.st_gid != gid or stat.S_IMODE(metadata.st_mode) != mode or metadata.st_size > max(len(raw), MAX_JSON_BYTES):
            reject(f"{code}_PREPARED_INVALID")
        os.unlink(entry.path)
        sync_directory(path.parent)
    temporary = path.parent / f".{path.name}.prepared.{sha256(raw)}.{uuid.uuid4().hex}.tmp"
    try:
        descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), mode)
    except OSError as error:
        reject(code)
    try:
        offset = 0
        while offset < len(raw):
            offset += os.write(descriptor, raw[offset:])
        os.fchown(descriptor, uid, gid)
        os.fchmod(descriptor, mode)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    sync_directory(path.parent)
    try:
        rename_noreplace(temporary, path)
    except MonitoringInstallError as error:
        if error.code != "MONITOR_INSTALL_TARGET_EXISTS":
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
            raise
        existing, _ = trusted_file(path, {mode}, uid, gid, code, max(len(raw), 256))
        os.unlink(temporary)
        sync_directory(path.parent)
        if existing == raw:
            return
        reject(f"{code}_COLLISION")


def atomic_replace(path: Path, raw: bytes, mode: int, uid: int, gid: int) -> None:
    temporary = path.parent / f".{path.name}.{uuid.uuid4().hex}.tmp"
    descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), mode)
    try:
        offset = 0
        while offset < len(raw):
            offset += os.write(descriptor, raw[offset:])
        os.fchown(descriptor, uid, gid)
        os.fchmod(descriptor, mode)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.replace(temporary, path)
    sync_directory(path.parent)


def rename_noreplace(source: Path, target: Path) -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    function = getattr(libc, "renameat2", None)
    if function is None:
        reject("MONITOR_INSTALL_RENAME_NOREPLACE_UNAVAILABLE")
    result = function(ctypes.c_int(-100), ctypes.c_char_p(os.fsencode(source)), ctypes.c_int(-100), ctypes.c_char_p(os.fsencode(target)), ctypes.c_uint(1))
    if result != 0:
        error = ctypes.get_errno()
        if error == errno.EEXIST:
            reject("MONITOR_INSTALL_TARGET_EXISTS")
        reject("MONITOR_INSTALL_RENAME_NOREPLACE_FAILED")
    sync_directory(source.parent)


@dataclass(frozen=True)
class Layout:
    install_root: Path = INSTALL_ROOT
    bundles_root: Path = BUNDLES_ROOT
    runtimes_root: Path = RUNTIMES_ROOT
    launcher_path: Path = LAUNCHER_PATH
    config_root: Path = CONFIG_ROOT
    private_root: Path = PRIVATE_ROOT
    private_config: Path = PRIVATE_CONFIG
    view_root: Path = VIEW_ROOT
    data_root: Path = DATA_ROOT
    active_file: Path = ACTIVE_FILE
    activation_root: Path = ACTIVATION_ROOT
    observation_root: Path = OBSERVATION_ROOT
    state_root: Path = STATE_ROOT
    outbox_root: Path = OUTBOX_ROOT
    delivery_root: Path = DELIVERY_ROOT
    projection_root: Path = PROJECTION_ROOT
    receipt_root: Path = RECEIPT_ROOT
    journal_root: Path = JOURNAL_ROOT
    backup_root: Path = BACKUP_ROOT
    lock_root: Path = LOCK_ROOT
    install_lock: Path = INSTALL_LOCK
    supervisor_lock: Path = GLOBAL_RELEASE_LOCK
    systemd_root: Path = SYSTEMD_ROOT


def validate_manifest(value: Any) -> dict[str, Any]:
    value = exact_fields(value, {"schema_version", "contract", "bundle_version", "source_commit", "source_tree", "launcher_sha256", "files"}, "MONITOR_INSTALL_BUNDLE_FIELDS_INVALID")
    if value["schema_version"] != 1 or value["contract"] != BUNDLE_CONTRACT or value["bundle_version"] != 1 or not isinstance(value["source_commit"], str) or not GIT_OBJECT.fullmatch(value["source_commit"]) or not isinstance(value["source_tree"], str) or not GIT_OBJECT.fullmatch(value["source_tree"]) or not isinstance(value["launcher_sha256"], str) or not SHA256.fullmatch(value["launcher_sha256"]):
        reject("MONITOR_INSTALL_BUNDLE_INVALID")
    if not isinstance(value["files"], list) or not 1 <= len(value["files"]) <= 128:
        reject("MONITOR_INSTALL_BUNDLE_FILES_INVALID")
    previous = ""
    total = 0
    for entry in value["files"]:
        entry = exact_fields(entry, {"path", "sha256", "bytes", "mode"}, "MONITOR_INSTALL_BUNDLE_FILE_FIELDS_INVALID")
        if not isinstance(entry["path"], str) or not re.fullmatch(r"[A-Za-z0-9._/-]{1,240}", entry["path"]) or entry["path"].startswith("/") or any(part in ("", ".", "..") for part in entry["path"].split("/")) or entry["path"] <= previous or not isinstance(entry["sha256"], str) or not SHA256.fullmatch(entry["sha256"]) or not isinstance(entry["bytes"], int) or isinstance(entry["bytes"], bool) or entry["bytes"] < 1 or entry["bytes"] > MAX_FILE_BYTES or entry["mode"] not in ("0444", "0555"):
            reject("MONITOR_INSTALL_BUNDLE_FILE_INVALID")
        total += entry["bytes"]
        previous = entry["path"]
    if total > MAX_BUNDLE_BYTES or LAUNCHER_RELATIVE not in {entry["path"] for entry in value["files"]} or not set(UNIT_RELATIVES).issubset({entry["path"] for entry in value["files"]}):
        reject("MONITOR_INSTALL_BUNDLE_FILES_INVALID")
    return value


def validate_activation(value: Any) -> dict[str, Any]:
    fields = {"schema_version", "contract", "activation_sha256", "activation_id", "status", "installation_generation", "monitoring_bundle_sha256", "supervisor_bundle_sha256", "runtime_sha256", "runtime_bytes", "runtime_version", "private_config_sha256", "evaluator_config_sha256", "notifier_config_sha256", "evaluator_uid", "evaluator_gid", "notifier_uid", "notifier_gid", "state_schema_min", "state_schema_max", "unit_set_sha256", "previous_activation_sha256", "committed_at"}
    value = exact_fields(value, fields, "MONITOR_ACTIVATION_FIELDS_INVALID")
    if value["schema_version"] != 1 or value["contract"] != ACTIVATION_CONTRACT or value["status"] != "COMMITTED" or not isinstance(value["activation_id"], str) or not IDENTIFIER.fullmatch(value["activation_id"]) or not isinstance(value["installation_generation"], int) or isinstance(value["installation_generation"], bool) or value["installation_generation"] < 1 or not isinstance(value["runtime_bytes"], int) or isinstance(value["runtime_bytes"], bool) or not 1 <= value["runtime_bytes"] <= MAX_RUNTIME_BYTES or not isinstance(value["runtime_version"], str) or not re.fullmatch(r"(?:22\.(?:1[3-9]|[2-9][0-9])|23\.[0-9]+|24\.[0-9]+)\.[0-9]+", value["runtime_version"]) or value["state_schema_min"] != 1 or value["state_schema_max"] != 1 or not isinstance(value["committed_at"], str) or not ISO_UTC.fullmatch(value["committed_at"]):
        reject("MONITOR_ACTIVATION_INVALID")
    for field in ("activation_sha256", "monitoring_bundle_sha256", "supervisor_bundle_sha256", "runtime_sha256", "private_config_sha256", "evaluator_config_sha256", "notifier_config_sha256", "unit_set_sha256", "previous_activation_sha256"):
        if not isinstance(value[field], str) or not SHA256.fullmatch(value[field]):
            reject("MONITOR_ACTIVATION_DIGEST_INVALID")
    for field in ("evaluator_uid", "evaluator_gid", "notifier_uid", "notifier_gid"):
        if not isinstance(value[field], int) or isinstance(value[field], bool) or not 1 <= value[field] <= 2**31 - 1:
            reject("MONITOR_ACTIVATION_IDENTITY_INVALID")
    if value["evaluator_uid"] == value["notifier_uid"] or value["evaluator_gid"] == value["notifier_gid"]:
        reject("MONITOR_ACTIVATION_IDENTITY_INVALID")
    body = dict(value)
    body.pop("activation_sha256")
    if value["activation_sha256"] != sha256(canonical_json(body)):
        reject("MONITOR_ACTIVATION_INTEGRITY_INVALID")
    return value


def validate_monitoring_config(value: Any, deployment: dict[str, Any]) -> dict[str, Any]:
    fields = {"schema_version", "contract", "config_id", "deployment_class", "deployment_id", "compose_project", "service_expectations", "release_expectation", "backup_expectation", "notification"}
    value = exact_fields(value, fields, "MONITOR_INSTALL_MONITORING_FIELDS_INVALID")
    if value["schema_version"] != 1 or value["contract"] != "chenyida-erp-operations-monitoring-config/v1" or not isinstance(value["config_id"], str) or not IDENTIFIER.fullmatch(value["config_id"]) or (value["deployment_class"], value["deployment_id"], value["compose_project"]) != (deployment["class"], deployment["id"], deployment["compose_project"]):
        reject("MONITOR_INSTALL_MONITORING_INVALID")
    expectations = value["service_expectations"]
    if not isinstance(expectations, list) or len(expectations) != len(SERVICES):
        reject("MONITOR_INSTALL_MONITORING_SERVICES_INVALID")
    images: dict[str, str] = {}
    for index, service in enumerate(SERVICES):
        entry = exact_fields(expectations[index], {"service", "container_name", "image_reference"}, "MONITOR_INSTALL_MONITORING_SERVICE_INVALID")
        if entry["service"] != service or not isinstance(entry["container_name"], str) or not IDENTIFIER.fullmatch(entry["container_name"]) or not isinstance(entry["image_reference"], str) or not IMAGE_REFERENCE.fullmatch(entry["image_reference"]):
            reject("MONITOR_INSTALL_MONITORING_SERVICE_INVALID")
        images[service] = entry["image_reference"].rsplit("@", 1)[1]
    release = exact_fields(value["release_expectation"], {"application_version", "git_commit", "release_manifest_sha256", "supervisor_bundle_sha256", "migration_head", "migration_manifest_sha256", "web_image_digest", "worker_image_digest"}, "MONITOR_INSTALL_MONITORING_RELEASE_INVALID")
    if not isinstance(release["application_version"], str) or not VERSION.fullmatch(release["application_version"]) or not isinstance(release["git_commit"], str) or not GIT_OBJECT.fullmatch(release["git_commit"]) or not isinstance(release["migration_head"], str) or not MIGRATION.fullmatch(release["migration_head"]):
        reject("MONITOR_INSTALL_MONITORING_RELEASE_INVALID")
    for field in ("release_manifest_sha256", "supervisor_bundle_sha256", "migration_manifest_sha256"):
        if not isinstance(release[field], str) or not SHA256.fullmatch(release[field]):
            reject("MONITOR_INSTALL_MONITORING_RELEASE_INVALID")
    for field in ("web_image_digest", "worker_image_digest"):
        if not isinstance(release[field], str) or not IMAGE_DIGEST.fullmatch(release[field]):
            reject("MONITOR_INSTALL_MONITORING_RELEASE_INVALID")
    if release["web_image_digest"] == release["worker_image_digest"] or images["web"] != release["web_image_digest"] or images["worker"] != release["worker_image_digest"]:
        reject("MONITOR_INSTALL_MONITORING_RELEASE_INVALID")
    backup = exact_fields(value["backup_expectation"], {"policy_id", "rpo_hours"}, "MONITOR_INSTALL_MONITORING_BACKUP_INVALID")
    if not isinstance(backup["policy_id"], str) or not IDENTIFIER.fullmatch(backup["policy_id"]) or not isinstance(backup["rpo_hours"], int) or isinstance(backup["rpo_hours"], bool) or not 1 <= backup["rpo_hours"] <= 168:
        reject("MONITOR_INSTALL_MONITORING_BACKUP_INVALID")
    notification = exact_fields(value["notification"], {"required", "target_id"}, "MONITOR_INSTALL_MONITORING_NOTIFICATION_INVALID")
    if notification["required"] is not True or not isinstance(notification["target_id"], str) or not IDENTIFIER.fullmatch(notification["target_id"]):
        reject("MONITOR_INSTALL_MONITORING_NOTIFICATION_INVALID")
    return value


def validate_host_config(value: Any, expected: dict[str, Any]) -> dict[str, Any]:
    fields = {"schema_version", "contract", "config_id", "config_generation", "previous_config_sha256", "deployment", "installation", "identities", "monitoring", "evidence", "notification"}
    value = exact_fields(value, fields, "MONITOR_INSTALL_CONFIG_FIELDS_INVALID")
    if value["schema_version"] != 1 or value["contract"] != HOST_CONFIG_CONTRACT or not isinstance(value["config_id"], str) or not IDENTIFIER.fullmatch(value["config_id"]) or not isinstance(value["config_generation"], int) or isinstance(value["config_generation"], bool) or value["config_generation"] < 1 or not isinstance(value["previous_config_sha256"], str) or not SHA256.fullmatch(value["previous_config_sha256"]):
        reject("MONITOR_INSTALL_CONFIG_INVALID")
    if (value["config_generation"] == 1) != (value["previous_config_sha256"] == ZERO_SHA256):
        reject("MONITOR_INSTALL_CONFIG_GENERATION_INVALID")
    installation = exact_fields(value["installation"], {"activation_id", "installation_generation", "monitoring_bundle_sha256", "supervisor_bundle_sha256", "state_schema_min", "state_schema_max"}, "MONITOR_INSTALL_CONFIG_INSTALLATION_INVALID")
    if installation != {"activation_id": expected["activation_id"], "installation_generation": expected["installation_generation"], "monitoring_bundle_sha256": expected["monitoring_bundle_sha256"], "supervisor_bundle_sha256": expected["supervisor_bundle_sha256"], "state_schema_min": 1, "state_schema_max": 1}:
        reject("MONITOR_INSTALL_CONFIG_INSTALLATION_MISMATCH")
    identities = exact_fields(value["identities"], {"evaluator", "notifier"}, "MONITOR_INSTALL_CONFIG_IDENTITIES_INVALID")
    for role, account in (("evaluator", "chenyida-monitor-eval"), ("notifier", "chenyida-monitor-notify")):
        identity = exact_fields(identities[role], {"user", "uid", "gid"}, "MONITOR_INSTALL_CONFIG_IDENTITY_INVALID")
        if identity["user"] != account or identity["uid"] != expected[f"{role}_uid"] or identity["gid"] != expected[f"{role}_gid"]:
            reject("MONITOR_INSTALL_CONFIG_IDENTITY_MISMATCH")
    if identities["evaluator"]["uid"] == identities["notifier"]["uid"] or identities["evaluator"]["gid"] == identities["notifier"]["gid"]:
        reject("MONITOR_INSTALL_CONFIG_IDENTITY_SEPARATION_INVALID")
    deployment = exact_fields(value["deployment"], {"class", "id", "compose_project"}, "MONITOR_INSTALL_CONFIG_DEPLOYMENT_INVALID")
    if deployment["class"] not in ("TEST", "UAT", "PRODUCTION") or not all(isinstance(deployment[field], str) and IDENTIFIER.fullmatch(deployment[field]) for field in ("id", "compose_project")):
        reject("MONITOR_INSTALL_CONFIG_DEPLOYMENT_INVALID")
    monitoring = validate_monitoring_config(value["monitoring"], deployment)
    evidence = exact_fields(value["evidence"], {"components_projection_path", "backup_projection_path", "release_activation_id", "release_activated_at", "postdeploy_receipt_sha256", "components_producer_bundle_sha256", "backup_producer_bundle_sha256", "minimum_components_projection_generation", "minimum_backup_projection_generation"}, "MONITOR_INSTALL_CONFIG_EVIDENCE_INVALID")
    if evidence["components_projection_path"] != "/var/lib/chenyida-erp/monitoring-v1/projections/components.json" or evidence["backup_projection_path"] != "/var/lib/chenyida-erp/monitoring-v1/projections/backup.json" or not isinstance(evidence["release_activation_id"], str) or not IDENTIFIER.fullmatch(evidence["release_activation_id"]) or not isinstance(evidence["release_activated_at"], str) or not ISO_UTC.fullmatch(evidence["release_activated_at"]):
        reject("MONITOR_INSTALL_CONFIG_EVIDENCE_INVALID")
    try:
        datetime.strptime(evidence["release_activated_at"], "%Y-%m-%dT%H:%M:%S.%fZ")
    except ValueError:
        reject("MONITOR_INSTALL_CONFIG_EVIDENCE_INVALID")
    for field in ("postdeploy_receipt_sha256", "components_producer_bundle_sha256", "backup_producer_bundle_sha256"):
        if not isinstance(evidence[field], str) or not SHA256.fullmatch(evidence[field]):
            reject("MONITOR_INSTALL_CONFIG_EVIDENCE_INVALID")
    for field in ("minimum_components_projection_generation", "minimum_backup_projection_generation"):
        if not isinstance(evidence[field], int) or isinstance(evidence[field], bool) or evidence[field] < 1:
            reject("MONITOR_INSTALL_CONFIG_EVIDENCE_INVALID")
    notification = exact_fields(value["notification"], {"required", "target_id", "target_generation", "adapter", "endpoint", "credential", "ack", "oncall_roster_generation", "escalation_table_sha256"}, "MONITOR_INSTALL_CONFIG_NOTIFICATION_INVALID")
    if notification["required"] is not True or not isinstance(notification["target_id"], str) or not IDENTIFIER.fullmatch(notification["target_id"]) or not isinstance(notification["target_generation"], int) or isinstance(notification["target_generation"], bool) or notification["target_generation"] < 1 or monitoring["notification"] != {"required": True, "target_id": notification["target_id"]}:
        reject("MONITOR_INSTALL_CONFIG_NOTIFICATION_INVALID")
    credential = exact_fields(notification["credential"], {"source_file", "sha256", "generation"}, "MONITOR_INSTALL_CONFIG_CREDENTIAL_INVALID")
    if credential["source_file"] != "/etc/chenyida-erp/monitoring-v1/private/notification.credential" or not isinstance(credential["sha256"], str) or not SHA256.fullmatch(credential["sha256"]) or not isinstance(credential["generation"], int) or isinstance(credential["generation"], bool) or credential["generation"] < 1:
        reject("MONITOR_INSTALL_CONFIG_CREDENTIAL_INVALID")
    adapter = exact_fields(notification["adapter"], {"id", "version", "source_sha256"}, "MONITOR_INSTALL_CONFIG_ADAPTER_INVALID")
    if adapter["id"] not in ("HTTPS_JSON_ACK_V1", "SYNTHETIC_FAKE_ACK_V1") or not isinstance(adapter["version"], int) or isinstance(adapter["version"], bool) or adapter["version"] != 1 or not isinstance(adapter["source_sha256"], str) or not SHA256.fullmatch(adapter["source_sha256"]) or adapter["id"] == "SYNTHETIC_FAKE_ACK_V1" and deployment["class"] != "TEST":
        reject("MONITOR_INSTALL_CONFIG_ADAPTER_INVALID")
    endpoint = exact_fields(notification["endpoint"], {"scheme", "host", "port", "path", "tls_server_name"}, "MONITOR_INSTALL_CONFIG_ENDPOINT_INVALID")
    if adapter["id"] == "SYNTHETIC_FAKE_ACK_V1":
        if any(item is not None for item in endpoint.values()):
            reject("MONITOR_INSTALL_CONFIG_ENDPOINT_INVALID")
    elif endpoint["scheme"] != "https" or not isinstance(endpoint["host"], str) or not HOST.fullmatch(endpoint["host"]) or endpoint["tls_server_name"] != endpoint["host"] or not isinstance(endpoint["path"], str) or not HTTPS_PATH.fullmatch(endpoint["path"]) or not isinstance(endpoint["port"], int) or isinstance(endpoint["port"], bool) or not 1 <= endpoint["port"] <= 65535:
        reject("MONITOR_INSTALL_CONFIG_ENDPOINT_INVALID")
    ack = exact_fields(notification["ack"], {"contract", "timeout_milliseconds", "claim_ttl_seconds", "retry_backoff_seconds", "max_attempts"}, "MONITOR_INSTALL_CONFIG_ACK_INVALID")
    if ack["contract"] != "chenyida-erp-monitoring-remote-ack/v1":
        reject("MONITOR_INSTALL_CONFIG_ACK_INVALID")
    for field, minimum, maximum in (("timeout_milliseconds", 500, 15000), ("claim_ttl_seconds", 15, 300), ("retry_backoff_seconds", 15, 3600), ("max_attempts", 1, 32)):
        if not isinstance(ack[field], int) or isinstance(ack[field], bool) or not minimum <= ack[field] <= maximum:
            reject("MONITOR_INSTALL_CONFIG_ACK_INVALID")
    if not isinstance(notification["oncall_roster_generation"], int) or isinstance(notification["oncall_roster_generation"], bool) or notification["oncall_roster_generation"] < 1 or not isinstance(notification["escalation_table_sha256"], str) or not SHA256.fullmatch(notification["escalation_table_sha256"]):
        reject("MONITOR_INSTALL_CONFIG_NOTIFICATION_INVALID")
    return value


def derive_views(config: dict[str, Any], raw_sha256: str) -> tuple[bytes, bytes]:
    common = {"schema_version": 1, "config_id": config["config_id"], "config_generation": config["config_generation"], "previous_config_sha256": config["previous_config_sha256"], "host_config_sha256": raw_sha256, "deployment": config["deployment"], "installation": config["installation"]}
    notifier = {**common, "contract": "chenyida-erp-monitoring-notifier-config/v1", "identity": config["identities"]["notifier"], "evaluator_identity": config["identities"]["evaluator"], "notification": config["notification"]}
    notifier_raw = canonical_json(notifier)
    evaluator = {**common, "contract": "chenyida-erp-monitoring-evaluator-config/v1", "identity": config["identities"]["evaluator"], "notifier_identity": config["identities"]["notifier"], "monitoring": config["monitoring"], "evidence": config["evidence"], "notification": {"required": config["notification"]["required"], "target_id": config["notification"]["target_id"], "target_generation": config["notification"]["target_generation"], "notifier_config_sha256": sha256(notifier_raw)}}
    return canonical_json(evaluator), notifier_raw


def validate_rotation_envelope(value: Any, filename: str) -> dict[str, Any]:
    fields = {"schema_version", "contract", "envelope_id", "event_id", "event_sha256", "event", "deployment_id", "config_id", "config_generation", "host_config_sha256", "target_id", "target_generation", "created_at"}
    value = exact_fields(value, fields, "MONITOR_INSTALL_OUTBOX_ENVELOPE_INVALID")
    if value["schema_version"] != 1 or value["contract"] != "chenyida-erp-monitoring-delivery-envelope/v1" or filename != f"{value['event_id']}.json":
        reject("MONITOR_INSTALL_OUTBOX_ENVELOPE_INVALID")
    for field in ("envelope_id", "event_id", "event_sha256", "host_config_sha256"):
        if not isinstance(value[field], str) or not SHA256.fullmatch(value[field]):
            reject("MONITOR_INSTALL_OUTBOX_ENVELOPE_INVALID")
    event = exact_fields(value["event"], {"schema_version", "contract", "event_id", "sequence", "event_type", "dedupe_key", "code", "severity", "message_zh", "runbook_ref", "first_observed_at", "observed_at", "delivery"}, "MONITOR_INSTALL_OUTBOX_EVENT_INVALID")
    event_body = dict(event)
    event_body.pop("event_id")
    if event["event_id"] != value["event_id"] or event["event_id"] != sha256(canonical_json(event_body)) or value["event_sha256"] != sha256(canonical_json(event)):
        reject("MONITOR_INSTALL_OUTBOX_EVENT_INVALID")
    delivery = exact_fields(event["delivery"], {"status", "target_id"}, "MONITOR_INSTALL_OUTBOX_EVENT_INVALID")
    if delivery["status"] not in ("PENDING", "NOT_CONFIGURED") or delivery["target_id"] != value["target_id"]:
        reject("MONITOR_INSTALL_OUTBOX_EVENT_INVALID")
    envelope_body = dict(value)
    envelope_body.pop("envelope_id")
    if value["envelope_id"] != sha256(canonical_json(envelope_body)):
        reject("MONITOR_INSTALL_OUTBOX_ENVELOPE_INVALID")
    return value


def validate_rotation_ack(value: Any, filename: str, envelope: dict[str, Any]) -> dict[str, Any]:
    fields = {"schema_version", "contract", "ack_id", "event_id", "envelope_id", "attempt_id", "result_id", "target_id", "target_generation", "notifier_config_sha256", "credential_sha256", "credential_generation", "remote_ack_id_sha256", "acked_at", "verification"}
    value = exact_fields(value, fields, "MONITOR_INSTALL_DELIVERY_ACK_INVALID")
    if value["schema_version"] != 1 or value["contract"] != "chenyida-erp-monitoring-delivery-ack/v1" or filename != f"{value['event_id']}.json" or value["event_id"] != envelope["event_id"] or value["envelope_id"] != envelope["envelope_id"] or value["target_id"] != envelope["target_id"] or value["target_generation"] != envelope["target_generation"] or value["verification"] != "EXACT_REMOTE_ACK_V1" or not isinstance(value["target_id"], str) or not IDENTIFIER.fullmatch(value["target_id"]):
        reject("MONITOR_INSTALL_DELIVERY_ACK_INVALID")
    for field in ("ack_id", "event_id", "envelope_id", "attempt_id", "result_id", "notifier_config_sha256", "credential_sha256", "remote_ack_id_sha256"):
        if not isinstance(value[field], str) or not SHA256.fullmatch(value[field]):
            reject("MONITOR_INSTALL_DELIVERY_ACK_INVALID")
    for field in ("target_generation", "credential_generation"):
        if not isinstance(value[field], int) or isinstance(value[field], bool) or value[field] < 1:
            reject("MONITOR_INSTALL_DELIVERY_ACK_INVALID")
    if not isinstance(value["acked_at"], str) or not ISO_UTC.fullmatch(value["acked_at"]):
        reject("MONITOR_INSTALL_DELIVERY_ACK_INVALID")
    ack_body = dict(value)
    ack_body.pop("ack_id")
    if value["ack_id"] != sha256(canonical_json(ack_body)):
        reject("MONITOR_INSTALL_DELIVERY_ACK_INVALID")
    return value


def validate_rotation_attempt(value: Any, filename: str) -> dict[str, Any]:
    fields = {"schema_version", "contract", "attempt_id", "claim_id", "event_id", "envelope_id", "attempt_no", "prepared_at", "previous_attempt_sha256", "target_id", "target_generation", "notifier_config_sha256", "credential_sha256", "credential_generation", "adapter_id", "adapter_version", "adapter_sha256", "idempotency_key"}
    value = exact_fields(value, fields, "MONITOR_INSTALL_DELIVERY_ATTEMPT_INVALID")
    match = re.fullmatch(r"([0-9a-f]{64})\.([1-9]|[12][0-9]|3[0-2])\.json", filename)
    if match is None or value["schema_version"] != 1 or value["contract"] != "chenyida-erp-monitoring-delivery-attempt/v1" or value["event_id"] != match.group(1) or value["attempt_no"] != int(match.group(2)) or value["idempotency_key"] != value["event_id"]:
        reject("MONITOR_INSTALL_DELIVERY_ATTEMPT_INVALID")
    for field in ("attempt_id", "claim_id", "event_id", "envelope_id", "previous_attempt_sha256", "notifier_config_sha256", "credential_sha256", "adapter_sha256"):
        if not isinstance(value[field], str) or not SHA256.fullmatch(value[field]):
            reject("MONITOR_INSTALL_DELIVERY_ATTEMPT_INVALID")
    for field in ("attempt_no", "target_generation", "credential_generation"):
        if not isinstance(value[field], int) or isinstance(value[field], bool) or value[field] < 1:
            reject("MONITOR_INSTALL_DELIVERY_ATTEMPT_INVALID")
    if not isinstance(value["target_id"], str) or not IDENTIFIER.fullmatch(value["target_id"]) or value["adapter_id"] not in ("HTTPS_JSON_ACK_V1", "SYNTHETIC_FAKE_ACK_V1") or value["adapter_version"] != 1 or not isinstance(value["prepared_at"], str) or not ISO_UTC.fullmatch(value["prepared_at"]):
        reject("MONITOR_INSTALL_DELIVERY_ATTEMPT_INVALID")
    body = dict(value)
    body.pop("attempt_id")
    if value["attempt_id"] != sha256(canonical_json(body)):
        reject("MONITOR_INSTALL_DELIVERY_ATTEMPT_INVALID")
    return value


def validate_rotation_grant(value: Any, filename: str, envelope: dict[str, Any]) -> dict[str, Any]:
    value = exact_fields(value, {"schema_version", "contract", "grant_id", "event_id", "envelope_id", "host_state_sha256", "host_state_sequence", "granted_at"}, "MONITOR_INSTALL_DELIVERY_GRANT_INVALID")
    body = dict(value)
    body.pop("grant_id", None)
    if value.get("schema_version") != 1 or value.get("contract") != "chenyida-erp-monitoring-delivery-grant/v1" or filename != f"{value.get('event_id')}.json" or value.get("event_id") != envelope["event_id"] or value.get("envelope_id") != envelope["envelope_id"] or any(not isinstance(value.get(field), str) or not SHA256.fullmatch(value[field]) for field in ("grant_id", "event_id", "envelope_id", "host_state_sha256")) or not isinstance(value.get("host_state_sequence"), int) or isinstance(value.get("host_state_sequence"), bool) or value["host_state_sequence"] < 1 or not isinstance(value.get("granted_at"), str) or not ISO_UTC.fullmatch(value["granted_at"]) or value["grant_id"] != sha256(canonical_json(body)):
        reject("MONITOR_INSTALL_DELIVERY_GRANT_INVALID")
    return value


def validate_rotation_claim(value: Any, filename: str) -> dict[str, Any]:
    fields = {"schema_version", "contract", "claim_id", "event_id", "envelope_id", "attempt_no", "claimed_at", "lease_expires_at", "previous_attempt_sha256", "target_id", "target_generation", "notifier_config_sha256", "credential_sha256", "credential_generation", "idempotency_key"}
    value = exact_fields(value, fields, "MONITOR_INSTALL_DELIVERY_CLAIM_INVALID")
    match = re.fullmatch(r"([0-9a-f]{64})\.([1-9]|[12][0-9]|3[0-2])\.json", filename)
    body = dict(value)
    body.pop("claim_id", None)
    if match is None or value.get("schema_version") != 1 or value.get("contract") != "chenyida-erp-monitoring-delivery-claim/v1" or value.get("event_id") != match.group(1) or value.get("attempt_no") != int(match.group(2)) or value.get("idempotency_key") != value.get("event_id") or any(not isinstance(value.get(field), str) or not SHA256.fullmatch(value[field]) for field in ("claim_id", "event_id", "envelope_id", "previous_attempt_sha256", "notifier_config_sha256", "credential_sha256")) or any(not isinstance(value.get(field), int) or isinstance(value.get(field), bool) or value[field] < 1 for field in ("attempt_no", "target_generation", "credential_generation")) or not isinstance(value.get("target_id"), str) or not IDENTIFIER.fullmatch(value["target_id"]) or any(not isinstance(value.get(field), str) or not ISO_UTC.fullmatch(value[field]) for field in ("claimed_at", "lease_expires_at")) or datetime.strptime(value["lease_expires_at"], "%Y-%m-%dT%H:%M:%S.%fZ") <= datetime.strptime(value["claimed_at"], "%Y-%m-%dT%H:%M:%S.%fZ") or value["claim_id"] != sha256(canonical_json(body)):
        reject("MONITOR_INSTALL_DELIVERY_CLAIM_INVALID")
    return value


def validate_rotation_result(value: Any, filename: str) -> dict[str, Any]:
    fields = {"schema_version", "contract", "result_id", "attempt_id", "event_id", "recorded_at", "status", "detail_code", "response_sha256"}
    value = exact_fields(value, fields, "MONITOR_INSTALL_DELIVERY_RESULT_INVALID")
    match = re.fullmatch(r"([0-9a-f]{64})\.([1-9]|[12][0-9]|3[0-2])\.json", filename)
    if match is None or value["schema_version"] != 1 or value["contract"] != "chenyida-erp-monitoring-delivery-result/v1" or value["event_id"] != match.group(1):
        reject("MONITOR_INSTALL_DELIVERY_RESULT_INVALID")
    for field in ("result_id", "attempt_id", "event_id"):
        if not isinstance(value[field], str) or not SHA256.fullmatch(value[field]):
            reject("MONITOR_INSTALL_DELIVERY_RESULT_INVALID")
    if value["response_sha256"] is not None and (not isinstance(value["response_sha256"], str) or not SHA256.fullmatch(value["response_sha256"])):
        reject("MONITOR_INSTALL_DELIVERY_RESULT_INVALID")
    if value["status"] not in ("ACKNOWLEDGED", "AMBIGUOUS", "RETRYABLE", "REJECTED") or not isinstance(value["detail_code"], str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{2,79}", value["detail_code"]) or not isinstance(value["recorded_at"], str) or not ISO_UTC.fullmatch(value["recorded_at"]):
        reject("MONITOR_INSTALL_DELIVERY_RESULT_INVALID")
    body = dict(value)
    body.pop("result_id")
    if value["result_id"] != sha256(canonical_json(body)):
        reject("MONITOR_INSTALL_DELIVERY_RESULT_INVALID")
    return value


def validate_rotation_ack_chain(ack: dict[str, Any], envelope: dict[str, Any], grant: dict[str, Any] | None, claims: dict[str, dict[str, Any]], attempts: dict[str, dict[str, Any]], results: dict[str, dict[str, Any]]) -> None:
    attempt = attempts.get(ack["attempt_id"])
    result = results.get(ack["result_id"])
    claim = claims.get(attempt["claim_id"]) if attempt is not None else None
    if grant is None or attempt is None or claim is None or result is None:
        reject("MONITOR_INSTALL_DELIVERY_ACK_CHAIN_MISSING")
    if grant["event_id"] != envelope["event_id"] or grant["envelope_id"] != envelope["envelope_id"] or claim["claim_id"] != attempt["claim_id"] or claim["event_id"] != attempt["event_id"] or claim["envelope_id"] != attempt["envelope_id"] or claim["attempt_no"] != attempt["attempt_no"] or claim["claimed_at"] != attempt["prepared_at"] or claim["previous_attempt_sha256"] != attempt["previous_attempt_sha256"] or any(claim[field] != attempt[field] for field in ("target_id", "target_generation", "notifier_config_sha256", "credential_sha256", "credential_generation", "idempotency_key")):
        reject("MONITOR_INSTALL_DELIVERY_ACK_CHAIN_INVALID")
    if attempt["event_id"] != envelope["event_id"] or attempt["envelope_id"] != envelope["envelope_id"] or attempt["target_id"] != envelope["target_id"] or attempt["target_generation"] != envelope["target_generation"]:
        reject("MONITOR_INSTALL_DELIVERY_ACK_CHAIN_INVALID")
    if result["event_id"] != envelope["event_id"] or result["attempt_id"] != attempt["attempt_id"] or result["status"] != "ACKNOWLEDGED" or result["detail_code"] != "REMOTE_ACK_VERIFIED" or result["response_sha256"] is None:
        reject("MONITOR_INSTALL_DELIVERY_ACK_CHAIN_INVALID")
    if ack["target_id"] != attempt["target_id"] or ack["target_generation"] != attempt["target_generation"] or ack["notifier_config_sha256"] != attempt["notifier_config_sha256"] or ack["credential_sha256"] != attempt["credential_sha256"] or ack["credential_generation"] != attempt["credential_generation"]:
        reject("MONITOR_INSTALL_DELIVERY_ACK_CHAIN_INVALID")
    if datetime.strptime(result["recorded_at"], "%Y-%m-%dT%H:%M:%S.%fZ") < datetime.strptime(attempt["prepared_at"], "%Y-%m-%dT%H:%M:%S.%fZ"):
        reject("MONITOR_INSTALL_DELIVERY_ACK_CHAIN_INVALID")
    if datetime.strptime(claim["claimed_at"], "%Y-%m-%dT%H:%M:%S.%fZ") < datetime.strptime(grant["granted_at"], "%Y-%m-%dT%H:%M:%S.%fZ"):
        reject("MONITOR_INSTALL_DELIVERY_ACK_CHAIN_INVALID")


def pending_delivery_envelopes(layout: Layout, active: dict[str, Any]) -> list[dict[str, Any]]:
    outbox_owner = (active["evaluator_uid"], active["notifier_gid"])
    delivery_owner = (active["notifier_uid"], active["evaluator_gid"])
    events_root = layout.outbox_root / "events"
    grants_root = layout.outbox_root / "grants"
    acks_root = layout.delivery_root / "acks"
    claims_root = layout.delivery_root / "claims"
    attempts_root = layout.delivery_root / "attempts"
    results_root = layout.delivery_root / "results"
    trusted_directory(events_root, {0o2750}, *outbox_owner, "MONITOR_INSTALL_OUTBOX_DIRECTORY_INVALID")
    trusted_directory(grants_root, {0o2750}, *outbox_owner, "MONITOR_INSTALL_OUTBOX_DIRECTORY_INVALID")
    for directory in (acks_root, claims_root, attempts_root, results_root):
        trusted_directory(directory, {0o2750}, *delivery_owner, "MONITOR_INSTALL_DELIVERY_DIRECTORY_INVALID")
    event_names = sorted(entry.name for entry in os.scandir(events_root))
    grant_names = sorted(entry.name for entry in os.scandir(grants_root))
    ack_names = sorted(entry.name for entry in os.scandir(acks_root))
    claim_names = sorted(entry.name for entry in os.scandir(claims_root))
    attempt_names = sorted(entry.name for entry in os.scandir(attempts_root))
    result_names = sorted(entry.name for entry in os.scandir(results_root))
    if any(len(names) > 4096 for names in (event_names, grant_names, ack_names, claim_names, attempt_names, result_names)) or any(not re.fullmatch(r"[0-9a-f]{64}\.json", name) for name in [*event_names, *grant_names, *ack_names]) or any(not re.fullmatch(r"[0-9a-f]{64}\.(?:[1-9]|[12][0-9]|3[0-2])\.json", name) for name in [*claim_names, *attempt_names, *result_names]):
        reject("MONITOR_INSTALL_DELIVERY_ENTRY_INVALID")
    envelopes: dict[str, dict[str, Any]] = {}
    for name in event_names:
        raw, _ = trusted_file(events_root / name, {0o440}, *outbox_owner, "MONITOR_INSTALL_OUTBOX_ENVELOPE_INVALID", 64 * 1024)
        value = validate_rotation_envelope(strict_json(raw, "MONITOR_INSTALL_OUTBOX_ENVELOPE_INVALID", 64 * 1024), name)
        if raw != canonical_json(value):
            reject("MONITOR_INSTALL_OUTBOX_ENVELOPE_INVALID")
        envelopes[value["event_id"]] = value
    grants: dict[str, dict[str, Any]] = {}
    for name in grant_names:
        event_id = name.removesuffix(".json")
        if event_id not in envelopes:
            reject("MONITOR_INSTALL_DELIVERY_GRANT_INVALID")
        raw, _ = trusted_file(grants_root / name, {0o440}, *outbox_owner, "MONITOR_INSTALL_DELIVERY_GRANT_INVALID", 64 * 1024)
        value = validate_rotation_grant(strict_json(raw, "MONITOR_INSTALL_DELIVERY_GRANT_INVALID", 64 * 1024), name, envelopes[event_id])
        if raw != canonical_json(value):
            reject("MONITOR_INSTALL_DELIVERY_GRANT_INVALID")
        grants[event_id] = value
    claims: dict[str, dict[str, Any]] = {}
    for name in claim_names:
        raw, _ = trusted_file(claims_root / name, {0o440}, *delivery_owner, "MONITOR_INSTALL_DELIVERY_CLAIM_INVALID", 64 * 1024)
        value = validate_rotation_claim(strict_json(raw, "MONITOR_INSTALL_DELIVERY_CLAIM_INVALID", 64 * 1024), name)
        if raw != canonical_json(value) or value["claim_id"] in claims:
            reject("MONITOR_INSTALL_DELIVERY_CLAIM_INVALID")
        claims[value["claim_id"]] = value
    attempts: dict[str, dict[str, Any]] = {}
    for name in attempt_names:
        raw, _ = trusted_file(attempts_root / name, {0o440}, *delivery_owner, "MONITOR_INSTALL_DELIVERY_ATTEMPT_INVALID", 64 * 1024)
        value = validate_rotation_attempt(strict_json(raw, "MONITOR_INSTALL_DELIVERY_ATTEMPT_INVALID", 64 * 1024), name)
        if raw != canonical_json(value) or value["attempt_id"] in attempts:
            reject("MONITOR_INSTALL_DELIVERY_ATTEMPT_INVALID")
        attempts[value["attempt_id"]] = value
    results: dict[str, dict[str, Any]] = {}
    for name in result_names:
        raw, _ = trusted_file(results_root / name, {0o440}, *delivery_owner, "MONITOR_INSTALL_DELIVERY_RESULT_INVALID", 64 * 1024)
        value = validate_rotation_result(strict_json(raw, "MONITOR_INSTALL_DELIVERY_RESULT_INVALID", 64 * 1024), name)
        if raw != canonical_json(value) or value["result_id"] in results:
            reject("MONITOR_INSTALL_DELIVERY_RESULT_INVALID")
        results[value["result_id"]] = value
    acknowledged: set[str] = set()
    for name in ack_names:
        event_id = name.removesuffix(".json")
        if event_id not in envelopes:
            reject("MONITOR_INSTALL_DELIVERY_ACK_ORPHAN")
        raw, _ = trusted_file(acks_root / name, {0o440}, *delivery_owner, "MONITOR_INSTALL_DELIVERY_ACK_INVALID", 64 * 1024)
        value = validate_rotation_ack(strict_json(raw, "MONITOR_INSTALL_DELIVERY_ACK_INVALID", 64 * 1024), name, envelopes[event_id])
        if raw != canonical_json(value):
            reject("MONITOR_INSTALL_DELIVERY_ACK_INVALID")
        validate_rotation_ack_chain(value, envelopes[event_id], grants.get(event_id), claims, attempts, results)
        acknowledged.add(value["event_id"])
    return [envelope for event_id, envelope in envelopes.items() if event_id not in acknowledged]


def assert_pending_target_rotation_safe(layout: Layout, active: dict[str, Any], current: dict[str, Any], candidate: dict[str, Any]) -> None:
    previous_target = (current["notification"]["target_id"], current["notification"]["target_generation"])
    next_target = (candidate["notification"]["target_id"], candidate["notification"]["target_generation"])
    if previous_target == next_target:
        return
    if pending_delivery_envelopes(layout, active):
        reject("MONITOR_INSTALL_PENDING_TARGET_ROTATION_BLOCKED")


def assert_state_current_for_upgrade(layout: Layout, active: dict[str, Any], current_config: dict[str, Any]) -> dict[str, Any]:
    allowed = {".chenyida-erp-monitoring-host-state-v1", ".monitor.flock", "current.json"}
    try:
        entries = {entry.name for entry in os.scandir(layout.state_root)}
    except OSError:
        reject("MONITOR_INSTALL_STATE_NOT_CURRENT")
    if entries != allowed:
        reject("MONITOR_INSTALL_STATE_BUSY")
    raw, _ = trusted_file(layout.state_root / "current.json", {0o600}, active["evaluator_uid"], active["evaluator_gid"], "MONITOR_INSTALL_STATE_NOT_CURRENT", MAX_JSON_BYTES)
    value = exact_fields(strict_json(raw, "MONITOR_INSTALL_STATE_NOT_CURRENT", MAX_JSON_BYTES), {"schema_version", "contract", "wrapper_sequence", "previous_wrapper_sha256", "config_id", "config_generation", "host_config_sha256", "installation_generation", "monitoring_bundle_sha256", "activation_id", "monitoring_state", "components_watermark", "backup_watermark", "delivery_ack_watermark", "acknowledged_event_count", "updated_at", "integrity_sha256"}, "MONITOR_INSTALL_STATE_NOT_CURRENT")
    body = dict(value)
    integrity = body.pop("integrity_sha256", None)
    if value["schema_version"] != 1 or value["contract"] != "chenyida-erp-monitoring-host-state/v1" or not isinstance(value["wrapper_sequence"], int) or isinstance(value["wrapper_sequence"], bool) or value["wrapper_sequence"] < 1 or not isinstance(integrity, str) or not SHA256.fullmatch(integrity) or sha256(canonical_json(body)) != integrity:
        reject("MONITOR_INSTALL_STATE_NOT_CURRENT")
    expected = (current_config["config_id"], current_config["config_generation"], active["private_config_sha256"], active["installation_generation"], active["monitoring_bundle_sha256"], active["activation_id"])
    actual = (value["config_id"], value["config_generation"], value["host_config_sha256"], value["installation_generation"], value["monitoring_bundle_sha256"], value["activation_id"])
    if actual != expected:
        reject("MONITOR_INSTALL_STATE_NOT_CURRENT")
    return value


def validate_account(user: str, uid: int, gid: int) -> None:
    try:
        account = pwd.getpwnam(user)
        group = grp.getgrgid(gid)
    except KeyError:
        reject("MONITOR_INSTALL_ACCOUNT_MISSING")
    if account.pw_uid != uid or account.pw_gid != gid or group.gr_gid != gid or group.gr_name != user or account.pw_shell not in ("/usr/sbin/nologin", "/bin/false") or account.pw_dir not in ("/nonexistent", "/var/empty"):
        reject("MONITOR_INSTALL_ACCOUNT_INVALID")


def validate_runtime_version(runtime: Path, expected: dict[str, Any]) -> str:
    raw, _ = trusted_file(runtime, {0o555}, 0, 0, "MONITOR_INSTALL_RUNTIME_VERSION_SOURCE_INVALID", MAX_RUNTIME_BYTES)
    if len(raw) != expected["runtime_bytes"] or sha256(raw) != expected["runtime_sha256"] or raw[:4] != b"\x7fELF":
        reject("MONITOR_INSTALL_RUNTIME_VERSION_SOURCE_INVALID")

    def drop_privileges() -> None:
        os.setgroups([])
        os.setgid(expected["evaluator_gid"])
        os.setuid(expected["evaluator_uid"])
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
        resource.setrlimit(resource.RLIMIT_NPROC, (32, 32))
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))

    environment = {"PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent", "NODE_OPTIONS": "--max-old-space-size=64"}
    try:
        result = subprocess.run([str(runtime), "--version"], env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, timeout=10, preexec_fn=drop_privileges)
    except (OSError, subprocess.SubprocessError):
        reject("MONITOR_INSTALL_RUNTIME_VERSION_CHECK_FAILED")
    if result.returncode != 0 or len(result.stdout) > 64 or result.stderr != b"":
        reject("MONITOR_INSTALL_RUNTIME_VERSION_CHECK_FAILED")
    match = re.fullmatch(rb"v(\d+)\.(\d+)\.(\d+)\n", result.stdout)
    if match is None:
        reject("MONITOR_INSTALL_RUNTIME_VERSION_INVALID")
    major, minor, patch = (int(item) for item in match.groups())
    if major < 22 or major > 24 or major == 22 and (minor, patch) < (13, 0):
        reject("MONITOR_INSTALL_RUNTIME_VERSION_INVALID")
    return f"{major}.{minor}.{patch}"


def acquire_install_lock(layout: Layout) -> int:
    trusted_directory(layout.install_lock.parent.parent, {0o700, 0o755, 0o775}, 0, 0, "MONITOR_INSTALL_LOCK_PARENT_INVALID")
    ensure_directory(layout.install_lock.parent, 0o700, 0, 0)
    descriptor = os.open(layout.install_lock, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    metadata = os.fstat(descriptor)
    os.fchown(descriptor, 0, 0)
    os.fchmod(descriptor, 0o600)
    if not stat.S_ISREG(metadata.st_mode):
        os.close(descriptor)
        reject("MONITOR_INSTALL_LOCK_INVALID")
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(descriptor)
        reject("MONITOR_INSTALL_LOCKED")
    return descriptor


def assert_supervisor_lock(layout: Layout) -> None:
    if os.environ.get("ERP_RELEASE_GATE_LOCK_HELD") != "YES":
        reject("MONITOR_INSTALL_SUPERVISOR_LOCK_REQUIRED")
    try:
        descriptor = int(os.environ.get("ERP_RELEASE_GATE_LOCK_FD", ""))
    except ValueError:
        reject("MONITOR_INSTALL_SUPERVISOR_LOCK_REQUIRED")
    if descriptor < 3:
        reject("MONITOR_INSTALL_SUPERVISOR_LOCK_REQUIRED")
    try:
        opened = os.fstat(descriptor)
        named = os.lstat(layout.supervisor_lock)
        with open(f"/proc/self/fdinfo/{descriptor}", "r", encoding="utf-8") as stream:
            lock_lines = [line.rstrip("\n") for line in stream if line.startswith("lock:")]
    except (OSError, ValueError):
        reject("MONITOR_INSTALL_SUPERVISOR_LOCK_INVALID")
    if not stat.S_ISREG(opened.st_mode) or not stat.S_ISREG(named.st_mode) or stat.S_ISLNK(named.st_mode) or opened.st_dev != named.st_dev or opened.st_ino != named.st_ino or opened.st_nlink != 1 or named.st_nlink != 1 or opened.st_uid != 0 or opened.st_gid != 0 or named.st_uid != 0 or named.st_gid != 0 or stat.S_IMODE(opened.st_mode) != 0o600 or stat.S_IMODE(named.st_mode) != 0o600:
        reject("MONITOR_INSTALL_SUPERVISOR_LOCK_INVALID")
    if len(lock_lines) != 1 or re.fullmatch(r"lock:\s+[0-9]+: FLOCK\s+ADVISORY\s+WRITE -?[0-9]+ .*", lock_lines[0]) is None:
        reject("MONITOR_INSTALL_SUPERVISOR_LOCK_NOT_HELD")


def freeze_monitoring_phases(layout: Layout, active: dict[str, Any], command: Callable[[list[str]], Any], stop_units: bool = True) -> list[int]:
    if stop_units:
        for unit in (*TIMER_UNITS, *SERVICE_UNITS):
            if command(["stop", unit]).returncode != 0:
                reject("MONITOR_INSTALL_PHASE_FREEZE_FAILED")
    specifications = (
        (layout.lock_root / "collector.flock", 0, 0),
        (layout.state_root / ".monitor.flock", active["evaluator_uid"], active["evaluator_gid"]),
        (layout.lock_root / "notifier.flock", active["notifier_uid"], active["notifier_gid"]),
    )
    descriptors: list[int] = []
    try:
        for lock_path, uid, gid in specifications:
            named = os.lstat(lock_path)
            descriptor = os.open(lock_path, os.O_RDWR | getattr(os, "O_NOFOLLOW", 0))
            opened = os.fstat(descriptor)
            if not stat.S_ISREG(opened.st_mode) or stat.S_ISLNK(named.st_mode) or opened.st_dev != named.st_dev or opened.st_ino != named.st_ino or opened.st_nlink != 1 or opened.st_uid != uid or opened.st_gid != gid or stat.S_IMODE(opened.st_mode) != 0o600:
                os.close(descriptor)
                reject("MONITOR_INSTALL_PHASE_LOCK_INVALID")
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                os.close(descriptor)
                reject("MONITOR_INSTALL_PHASE_LOCK_BUSY")
            descriptors.append(descriptor)
        return descriptors
    except Exception:
        for descriptor in descriptors:
            os.close(descriptor)
        raise


def verify_materialized_bundle(target: Path, manifest_raw: bytes, manifest: dict[str, Any]) -> None:
    trusted_directory(target, {0o555}, 0, 0, "MONITOR_INSTALL_EXISTING_BUNDLE_INVALID")
    actual: set[str] = set()
    for directory, names, files in os.walk(target, topdown=True, followlinks=False):
        current = Path(directory)
        trusted_directory(current, {0o555}, 0, 0, "MONITOR_INSTALL_EXISTING_BUNDLE_INVALID")
        for name in names:
            candidate = current / name
            metadata = os.lstat(candidate)
            if stat.S_ISLNK(metadata.st_mode):
                reject("MONITOR_INSTALL_EXISTING_BUNDLE_INVALID")
        for name in files:
            candidate = current / name
            relative = candidate.relative_to(target).as_posix()
            if relative in actual:
                reject("MONITOR_INSTALL_EXISTING_BUNDLE_INVALID")
            actual.add(relative)
    expected = {entry["path"] for entry in manifest["files"]} | {"bundle-manifest.json"}
    if actual != expected:
        reject("MONITOR_INSTALL_EXISTING_BUNDLE_FILE_SET_INVALID")
    existing, _ = trusted_file(target / "bundle-manifest.json", {0o444}, 0, 0, "MONITOR_INSTALL_EXISTING_BUNDLE_INVALID", MAX_JSON_BYTES)
    if existing != manifest_raw:
        reject("MONITOR_INSTALL_EXISTING_BUNDLE_MISMATCH")
    for entry in manifest["files"]:
        raw, _ = trusted_file(target / entry["path"], {int(entry["mode"], 8)}, 0, 0, "MONITOR_INSTALL_EXISTING_BUNDLE_INVALID")
        if len(raw) != entry["bytes"] or sha256(raw) != entry["sha256"]:
            reject("MONITOR_INSTALL_EXISTING_BUNDLE_MISMATCH")


def materialize_bundle(layout: Layout, manifest_raw: bytes, manifest: dict[str, Any], source_root: Path, bundle_sha256: str) -> Path:
    target = layout.bundles_root / bundle_sha256
    if target.exists():
        verify_materialized_bundle(target, manifest_raw, manifest)
        return target
    staging = layout.bundles_root / f".stage.{bundle_sha256}.{uuid.uuid4().hex}"
    os.mkdir(staging, 0o700)
    try:
        total = 0
        for entry in manifest["files"]:
            source = source_root / entry["path"]
            raw, _ = trusted_file(source, {int(entry["mode"], 8)}, 0, 0, "MONITOR_INSTALL_SOURCE_BUNDLE_FILE_INVALID")
            if len(raw) != entry["bytes"] or sha256(raw) != entry["sha256"]:
                reject("MONITOR_INSTALL_SOURCE_BUNDLE_DIGEST_MISMATCH")
            total += len(raw)
            destination = staging / entry["path"]
            destination.parent.mkdir(parents=True, exist_ok=True)
            write_new_file(destination, raw, int(entry["mode"], 8), 0, 0, "MONITOR_INSTALL_STAGE_FILE_INVALID")
        write_new_file(staging / "bundle-manifest.json", manifest_raw, 0o444, 0, 0, "MONITOR_INSTALL_STAGE_MANIFEST_INVALID")
        for directory, names, _ in os.walk(staging, topdown=False):
            os.chown(directory, 0, 0)
            os.chmod(directory, 0o555)
            sync_directory(Path(directory))
        rename_noreplace(staging, target)
    except Exception:
        if staging.exists():
            shutil.rmtree(staging)
        raise
    return target


def materialize_runtime(layout: Layout, source: Path, expected: dict[str, Any]) -> Path:
    raw, metadata = trusted_file(source, {0o555}, 0, 0, "MONITOR_INSTALL_RUNTIME_SOURCE_INVALID", MAX_RUNTIME_BYTES)
    if len(raw) != expected["runtime_bytes"] or sha256(raw) != expected["runtime_sha256"] or metadata.st_dev != expected["runtime_dev"] or metadata.st_ino != expected["runtime_ino"]:
        reject("MONITOR_INSTALL_RUNTIME_BINDING_MISMATCH")
    target_root = layout.runtimes_root / expected["runtime_sha256"]
    target = target_root / "node"
    if target_root.exists():
        trusted_directory(target_root, {0o555}, 0, 0, "MONITOR_INSTALL_EXISTING_RUNTIME_INVALID")
        if {entry.name for entry in os.scandir(target_root)} != {"node"}:
            reject("MONITOR_INSTALL_EXISTING_RUNTIME_INVALID")
        existing, _ = trusted_file(target, {0o555}, 0, 0, "MONITOR_INSTALL_EXISTING_RUNTIME_INVALID", MAX_RUNTIME_BYTES)
        if existing != raw:
            reject("MONITOR_INSTALL_EXISTING_RUNTIME_MISMATCH")
        return target
    staging = layout.runtimes_root / f".stage.{expected['runtime_sha256']}.{uuid.uuid4().hex}"
    os.mkdir(staging, 0o700)
    try:
        write_new_file(staging / "node", raw, 0o555, 0, 0, "MONITOR_INSTALL_RUNTIME_STAGE_INVALID")
        os.chmod(staging, 0o555)
        sync_directory(staging)
        rename_noreplace(staging, target_root)
    except Exception:
        if staging.exists():
            shutil.rmtree(staging)
        raise
    return target


def snapshot_file(path: Path, backup: Path) -> dict[str, Any]:
    if not path.exists():
        return {"exists": False, "sha256": ZERO_SHA256, "mode": 0, "uid": 0, "gid": 0, "backup": None}
    raw, metadata = trusted_file(path, {0o400, 0o440, 0o444, 0o555}, 0, metadata_gid(path), "MONITOR_INSTALL_EXISTING_FILE_INVALID", MAX_FILE_BYTES)
    write_new_file(backup, raw, 0o400, 0, 0, "MONITOR_INSTALL_BACKUP_FILE_INVALID")
    return {"exists": True, "sha256": sha256(raw), "mode": stat.S_IMODE(metadata.st_mode), "uid": metadata.st_uid, "gid": metadata.st_gid, "backup": backup.name}


def metadata_gid(path: Path) -> int:
    try:
        return os.lstat(path).st_gid
    except OSError:
        reject("MONITOR_INSTALL_EXISTING_FILE_INVALID")


def unit_set_sha(bundle: Path) -> str:
    values = []
    for relative in UNIT_RELATIVES:
        raw, _ = trusted_file(bundle / relative, {0o444}, 0, 0, "MONITOR_INSTALL_UNIT_SOURCE_INVALID")
        values.append({"name": Path(relative).name, "sha256": sha256(raw)})
    return sha256(canonical_json(values))


def restore_transaction(layout: Layout, journal: dict[str, Any], command: Callable[[list[str]], Any]) -> None:
    transaction_id = journal["transaction_id"]
    backup_directory = layout.backup_root / transaction_id
    before = journal["before"]
    after = journal["after"]
    if set(before) != set(after):
        reject("MONITOR_INSTALL_RECOVERY_JOURNAL_INVALID")
    for name in sorted(before):
        target = Path(name)
        if target not in {layout.launcher_path, layout.private_config, layout.active_file, *[layout.systemd_root / Path(relative).name for relative in UNIT_RELATIVES]}:
            reject("MONITOR_INSTALL_RECOVERY_TARGET_INVALID")
        current = None
        if target.exists():
            metadata = os.lstat(target)
            if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_uid != after[name]["uid"] or metadata.st_gid != after[name]["gid"] or stat.S_IMODE(metadata.st_mode) != after[name]["mode"]:
                if before[name]["exists"] and metadata.st_uid == before[name]["uid"] and metadata.st_gid == before[name]["gid"] and stat.S_IMODE(metadata.st_mode) == before[name]["mode"]:
                    existing, _ = trusted_file(target, {before[name]["mode"]}, before[name]["uid"], before[name]["gid"], "MONITOR_INSTALL_RECOVERY_FILE_INVALID")
                    if sha256(existing) == before[name]["sha256"]:
                        continue
                reject("MONITOR_INSTALL_RECOVERY_FILE_DRIFT")
            current, _ = trusted_file(target, {after[name]["mode"]}, after[name]["uid"], after[name]["gid"], "MONITOR_INSTALL_RECOVERY_FILE_INVALID")
            if sha256(current) != after[name]["sha256"]:
                if before[name]["exists"] and sha256(current) == before[name]["sha256"]:
                    continue
                reject("MONITOR_INSTALL_RECOVERY_FILE_DRIFT")
        if before[name]["exists"]:
            backup_name = before[name]["backup"]
            if not isinstance(backup_name, str) or Path(backup_name).name != backup_name:
                reject("MONITOR_INSTALL_RECOVERY_BACKUP_INVALID")
            raw, _ = trusted_file(backup_directory / backup_name, {0o400}, 0, 0, "MONITOR_INSTALL_RECOVERY_BACKUP_INVALID")
            if sha256(raw) != before[name]["sha256"]:
                reject("MONITOR_INSTALL_RECOVERY_BACKUP_INVALID")
            atomic_replace(target, raw, before[name]["mode"], before[name]["uid"], before[name]["gid"])
        elif current is not None:
            os.unlink(target)
            sync_directory(target.parent)
    try:
        result = command(["daemon-reload"])
    except Exception:
        reject("MONITOR_INSTALL_RECOVERY_SYSTEMD_RELOAD_FAILED")
    if result.returncode != 0:
        reject("MONITOR_INSTALL_RECOVERY_SYSTEMD_RELOAD_FAILED")


def rollback_transaction(layout: Layout, journal: dict[str, Any], command: Callable[[list[str]], Any]) -> None:
    for unit in reversed(TIMER_UNITS):
        try:
            result = command(["disable", "--now", unit])
        except Exception:
            reject("MONITOR_INSTALL_RECOVERY_SYSTEMD_DISABLE_FAILED")
        if result.returncode != 0:
            reject("MONITOR_INSTALL_RECOVERY_SYSTEMD_DISABLE_FAILED")
    restore_transaction(layout, journal, command)
    if journal["before"][str(layout.active_file)]["exists"]:
        run_systemd(command, layout)
    restored = {**journal, "status": "ROLLED_BACK", "rolled_back_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")}
    write_new_file(layout.journal_root / f"{journal['transaction_id']}.rolled-back.json", canonical_json(restored), 0o400, 0, 0, "MONITOR_INSTALL_RECOVERY_RECEIPT_INVALID")


def validate_journal_receipt(receipt: Any, journal: dict[str, Any], active: dict[str, Any]) -> dict[str, Any]:
    fields = {"schema_version", "contract", "status", "operation", "transaction_id", "activation_sha256", "monitoring_bundle_sha256", "runtime_sha256", "runtime_version", "host_config_sha256", "authorization_sha256", "committed_at"}
    receipt = exact_fields(receipt, fields, "MONITOR_INSTALL_RECOVERY_RECEIPT_INVALID")
    if receipt["schema_version"] != 1 or receipt["contract"] != INSTALL_RECEIPT_CONTRACT or receipt["status"] != "COMMITTED" or receipt["operation"] not in ("INSTALL", "ROLLBACK") or receipt["transaction_id"] != journal["transaction_id"] or receipt["activation_sha256"] != journal["activation_sha256"] or receipt["authorization_sha256"] != journal["authorization_sha256"] or receipt["committed_at"] != journal["prepared_at"]:
        reject("MONITOR_INSTALL_RECOVERY_RECEIPT_INVALID")
    if receipt["monitoring_bundle_sha256"] != active["monitoring_bundle_sha256"] or receipt["runtime_sha256"] != active["runtime_sha256"] or receipt["runtime_version"] != active["runtime_version"] or receipt["host_config_sha256"] != active["private_config_sha256"] or receipt["committed_at"] != active["committed_at"]:
        reject("MONITOR_INSTALL_RECOVERY_RECEIPT_INVALID")
    return receipt


def assert_activation_was_committed(layout: Layout, activation: dict[str, Any]) -> None:
    matches = 0
    for terminal_path in sorted(layout.journal_root.glob("*.committed.json")):
        transaction_id = terminal_path.name.removesuffix(".committed.json")
        if not SHA256.fullmatch(transaction_id):
            reject("MONITOR_ROLLBACK_COMMIT_PROOF_INVALID")
        raw, _ = trusted_file(terminal_path, {0o400}, 0, 0, "MONITOR_ROLLBACK_COMMIT_PROOF_INVALID", 256 * 1024)
        value = exact_fields(strict_json(raw, "MONITOR_ROLLBACK_COMMIT_PROOF_INVALID", 256 * 1024), {"schema_version", "contract", "transaction_id", "status", "activation_sha256", "authorization_sha256", "before", "after", "receipt", "prepared_at", "receipt_sha256"}, "MONITOR_ROLLBACK_COMMIT_PROOF_INVALID")
        if raw != canonical_json(value) or value["schema_version"] != 1 or value["contract"] != JOURNAL_CONTRACT or value["transaction_id"] != transaction_id or value["status"] != "COMMITTED" or not isinstance(value["receipt_sha256"], str) or not SHA256.fullmatch(value["receipt_sha256"]):
            reject("MONITOR_ROLLBACK_COMMIT_PROOF_INVALID")
        if value["activation_sha256"] != activation["activation_sha256"]:
            continue
        if (layout.journal_root / f"{transaction_id}.rolled-back.json").exists():
            reject("MONITOR_ROLLBACK_COMMIT_PROOF_AMBIGUOUS")
        receipt_raw, _ = trusted_file(layout.receipt_root / f"{transaction_id}.json", {0o400}, 0, 0, "MONITOR_ROLLBACK_COMMIT_PROOF_INVALID", 64 * 1024)
        receipt = validate_journal_receipt(strict_json(receipt_raw, "MONITOR_ROLLBACK_COMMIT_PROOF_INVALID", 64 * 1024), value, activation)
        if receipt_raw != canonical_json(receipt) or receipt != value["receipt"] or sha256(receipt_raw) != value["receipt_sha256"]:
            reject("MONITOR_ROLLBACK_COMMIT_PROOF_INVALID")
        matches += 1
    if matches != 1:
        reject("MONITOR_ROLLBACK_TARGET_NOT_COMMITTED")


def finalize_recovered_commit(layout: Layout, journal: dict[str, Any], command: Callable[[list[str]], Any]) -> bool:
    receipt_path = layout.receipt_root / f"{journal['transaction_id']}.json"
    if not receipt_path.exists():
        return False
    for name, expected in journal["after"].items():
        target = Path(name)
        if target not in {layout.launcher_path, layout.private_config, layout.active_file, *[layout.systemd_root / Path(relative).name for relative in UNIT_RELATIVES]}:
            reject("MONITOR_INSTALL_RECOVERY_TARGET_INVALID")
        raw, _ = trusted_file(target, {expected["mode"]}, expected["uid"], expected["gid"], "MONITOR_INSTALL_RECOVERY_COMMITTED_FILE_INVALID")
        if sha256(raw) != expected["sha256"]:
            reject("MONITOR_INSTALL_RECOVERY_COMMITTED_FILE_INVALID")
    active_raw, _ = trusted_file(layout.active_file, {0o444}, 0, 0, "MONITOR_INSTALL_RECOVERY_COMMITTED_ACTIVE_INVALID", 64 * 1024)
    active = validate_activation(strict_json(active_raw, "MONITOR_INSTALL_RECOVERY_COMMITTED_ACTIVE_INVALID", 64 * 1024))
    if active["activation_sha256"] != journal["activation_sha256"]:
        reject("MONITOR_INSTALL_RECOVERY_COMMITTED_ACTIVE_INVALID")
    receipt_raw, _ = trusted_file(receipt_path, {0o400}, 0, 0, "MONITOR_INSTALL_RECOVERY_RECEIPT_INVALID", 64 * 1024)
    receipt = validate_journal_receipt(strict_json(receipt_raw, "MONITOR_INSTALL_RECOVERY_RECEIPT_INVALID", 64 * 1024), journal, active)
    if receipt_raw != canonical_json(receipt) or receipt != journal["receipt"]:
        reject("MONITOR_INSTALL_RECOVERY_RECEIPT_INVALID")
    run_systemd(command, layout)
    committed = {**journal, "status": "COMMITTED", "receipt_sha256": sha256(receipt_raw)}
    write_new_file(layout.journal_root / f"{journal['transaction_id']}.committed.json", canonical_json(committed), 0o400, 0, 0, "MONITOR_INSTALL_JOURNAL_INVALID")
    write_new_file(layout.activation_root / f"{active['activation_sha256']}.json", active_raw, 0o444, 0, 0, "MONITOR_INSTALL_RECOVERY_COMMITTED_ACTIVE_INVALID")
    return True


def recover_incomplete_transactions(layout: Layout, command: Callable[[list[str]], Any]) -> None:
    for prepared_path in sorted(layout.journal_root.glob("*.prepared.json")):
        transaction_id = prepared_path.name.removesuffix(".prepared.json")
        if not SHA256.fullmatch(transaction_id):
            reject("MONITOR_INSTALL_JOURNAL_ENTRY_INVALID")
        raw, _ = trusted_file(prepared_path, {0o400}, 0, 0, "MONITOR_INSTALL_RECOVERY_JOURNAL_INVALID", 256 * 1024)
        journal = strict_json(raw, "MONITOR_INSTALL_RECOVERY_JOURNAL_INVALID", 256 * 1024)
        exact_fields(journal, {"schema_version", "contract", "transaction_id", "status", "activation_sha256", "authorization_sha256", "before", "after", "receipt", "prepared_at"}, "MONITOR_INSTALL_RECOVERY_JOURNAL_INVALID")
        if raw != canonical_json(journal) or journal["schema_version"] != 1 or journal["contract"] != JOURNAL_CONTRACT or journal["transaction_id"] != transaction_id or journal["status"] != "PREPARED" or transaction_id != sha256(canonical_json({"activation": journal["activation_sha256"], "authorization": journal["authorization_sha256"]})):
            reject("MONITOR_INSTALL_RECOVERY_JOURNAL_INVALID")
        committed_path = layout.journal_root / f"{transaction_id}.committed.json"
        rolled_back_path = layout.journal_root / f"{transaction_id}.rolled-back.json"
        if committed_path.exists() and rolled_back_path.exists():
            reject("MONITOR_INSTALL_RECOVERY_TERMINAL_AMBIGUOUS")
        terminal_path = committed_path if committed_path.exists() else rolled_back_path if rolled_back_path.exists() else None
        if terminal_path is not None:
            terminal_raw, _ = trusted_file(terminal_path, {0o400}, 0, 0, "MONITOR_INSTALL_RECOVERY_TERMINAL_INVALID", 256 * 1024)
            terminal = strict_json(terminal_raw, "MONITOR_INSTALL_RECOVERY_TERMINAL_INVALID", 256 * 1024)
            expected_fields = set(journal) | ({"receipt_sha256"} if terminal_path == committed_path else {"rolled_back_at"})
            exact_fields(terminal, expected_fields, "MONITOR_INSTALL_RECOVERY_TERMINAL_INVALID")
            if terminal_raw != canonical_json(terminal) or any(terminal[field] != value for field, value in journal.items() if field != "status") or terminal["status"] != ("COMMITTED" if terminal_path == committed_path else "ROLLED_BACK"):
                reject("MONITOR_INSTALL_RECOVERY_TERMINAL_INVALID")
            if terminal_path == committed_path:
                receipt_raw, _ = trusted_file(layout.receipt_root / f"{transaction_id}.json", {0o400}, 0, 0, "MONITOR_INSTALL_RECOVERY_TERMINAL_INVALID", 64 * 1024)
                if not isinstance(terminal["receipt_sha256"], str) or not SHA256.fullmatch(terminal["receipt_sha256"]) or sha256(receipt_raw) != terminal["receipt_sha256"] or receipt_raw != canonical_json(journal["receipt"]):
                    reject("MONITOR_INSTALL_RECOVERY_TERMINAL_INVALID")
                activation_path = layout.activation_root / f"{journal['activation_sha256']}.json"
                if not activation_path.exists():
                    current_raw, _ = trusted_file(layout.active_file, {0o444}, 0, 0, "MONITOR_INSTALL_RECOVERY_TERMINAL_INVALID", 64 * 1024)
                    current = validate_activation(strict_json(current_raw, "MONITOR_INSTALL_RECOVERY_TERMINAL_INVALID", 64 * 1024))
                    if current["activation_sha256"] != journal["activation_sha256"]:
                        reject("MONITOR_INSTALL_RECOVERY_TERMINAL_INVALID")
                    write_new_file(activation_path, current_raw, 0o444, 0, 0, "MONITOR_INSTALL_RECOVERY_TERMINAL_INVALID")
                activation_raw, _ = trusted_file(activation_path, {0o444}, 0, 0, "MONITOR_INSTALL_RECOVERY_TERMINAL_INVALID", 64 * 1024)
                activation = validate_activation(strict_json(activation_raw, "MONITOR_INSTALL_RECOVERY_TERMINAL_INVALID", 64 * 1024))
                if activation["activation_sha256"] != journal["activation_sha256"] or activation_raw != canonical_json(activation):
                    reject("MONITOR_INSTALL_RECOVERY_TERMINAL_INVALID")
            elif not isinstance(terminal["rolled_back_at"], str) or not ISO_UTC.fullmatch(terminal["rolled_back_at"]):
                reject("MONITOR_INSTALL_RECOVERY_TERMINAL_INVALID")
            continue
        if finalize_recovered_commit(layout, journal, command):
            continue
        rollback_transaction(layout, journal, command)


def create_activation(expected: dict[str, Any], private_sha: str, evaluator_raw: bytes, notifier_raw: bytes, unit_sha: str, committed_at: str) -> dict[str, Any]:
    value = {
        "schema_version": 1,
        "contract": ACTIVATION_CONTRACT,
        "activation_sha256": "",
        "activation_id": expected["activation_id"],
        "status": "COMMITTED",
        "installation_generation": expected["installation_generation"],
        "monitoring_bundle_sha256": expected["monitoring_bundle_sha256"],
        "supervisor_bundle_sha256": expected["supervisor_bundle_sha256"],
        "runtime_sha256": expected["runtime_sha256"],
        "runtime_bytes": expected["runtime_bytes"],
        "runtime_version": expected["runtime_version"],
        "private_config_sha256": private_sha,
        "evaluator_config_sha256": sha256(evaluator_raw),
        "notifier_config_sha256": sha256(notifier_raw),
        "evaluator_uid": expected["evaluator_uid"],
        "evaluator_gid": expected["evaluator_gid"],
        "notifier_uid": expected["notifier_uid"],
        "notifier_gid": expected["notifier_gid"],
        "state_schema_min": 1,
        "state_schema_max": 1,
        "unit_set_sha256": unit_sha,
        "previous_activation_sha256": expected["previous_activation_sha256"],
        "committed_at": committed_at,
    }
    body = dict(value)
    body.pop("activation_sha256")
    value["activation_sha256"] = sha256(canonical_json(body))
    return value


def initialize_layout(layout: Layout, expected: dict[str, Any]) -> None:
    evaluator_uid, evaluator_gid = expected["evaluator_uid"], expected["evaluator_gid"]
    notifier_uid, notifier_gid = expected["notifier_uid"], expected["notifier_gid"]
    for path, mode in ((layout.install_root, 0o755), (layout.bundles_root, 0o755), (layout.runtimes_root, 0o755), (layout.config_root, 0o755), (layout.private_root, 0o700), (layout.view_root, 0o755), (layout.data_root, 0o755), (layout.activation_root, 0o755), (layout.receipt_root, 0o700), (layout.journal_root, 0o700), (layout.backup_root, 0o700), (layout.lock_root, 0o755)):
        ensure_directory(path, mode, 0, 0)
    ensure_directory(layout.observation_root, 0o750, 0, evaluator_gid)
    ensure_directory(layout.state_root, 0o700, evaluator_uid, evaluator_gid)
    ensure_directory(layout.outbox_root, 0o2750, evaluator_uid, notifier_gid)
    ensure_directory(layout.delivery_root, 0o2750, notifier_uid, evaluator_gid)
    ensure_directory(layout.projection_root, 0o750, 0, evaluator_gid)
    ensure_directory(layout.projection_root / "components", 0o750, 0, evaluator_gid)
    ensure_directory(layout.projection_root / "backup", 0o750, 0, evaluator_gid)
    for directory in ("events", "grants"):
        ensure_directory(layout.outbox_root / directory, 0o2750, evaluator_uid, notifier_gid)
    for directory in ("claims", "attempts", "results", "acks", "readiness"):
        ensure_directory(layout.delivery_root / directory, 0o2750, notifier_uid, evaluator_gid)
    markers = (
        (layout.observation_root / ".chenyida-erp-monitoring-observation-v1", b"chenyida-erp-monitoring-observation/v1\n", 0, evaluator_gid),
        (layout.state_root / ".chenyida-erp-monitoring-host-state-v1", b"chenyida-erp-monitoring-host-state/v1\n", evaluator_uid, evaluator_gid),
        (layout.outbox_root / ".chenyida-erp-monitoring-outbox-v1", b"chenyida-erp-monitoring-outbox/v1\n", evaluator_uid, notifier_gid),
        (layout.delivery_root / ".chenyida-erp-monitoring-delivery-v1", b"chenyida-erp-monitoring-delivery/v1\n", notifier_uid, evaluator_gid),
        (layout.projection_root / ".chenyida-erp-monitoring-projection-v1", b"chenyida-erp-monitoring-projection/v1\n", 0, evaluator_gid),
    )
    for path, raw, uid, gid in markers:
        write_new_file(path, raw, 0o400, uid, gid, "MONITOR_INSTALL_MARKER_INVALID")
    write_new_file(layout.state_root / ".monitor.flock", b"chenyida-erp-monitoring-flock/v1\n", 0o600, evaluator_uid, evaluator_gid, "MONITOR_INSTALL_STATE_LOCK_INVALID")
    write_new_file(layout.lock_root / "collector.flock", b"chenyida-erp-monitoring-flock/v1\n", 0o600, 0, 0, "MONITOR_INSTALL_COLLECTOR_LOCK_INVALID")
    write_new_file(layout.lock_root / "notifier.flock", b"chenyida-erp-monitoring-flock/v1\n", 0o600, notifier_uid, notifier_gid, "MONITOR_INSTALL_NOTIFIER_LOCK_INVALID")


def systemctl(arguments: list[str]) -> subprocess.CompletedProcess[bytes]:
    environment = {"PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent"}
    try:
        return subprocess.run(["/usr/bin/systemctl", *arguments], env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False, timeout=60)
    except (OSError, subprocess.SubprocessError):
        reject("MONITOR_INSTALL_SYSTEMCTL_FAILED")


def run_systemd(command: Callable[[list[str]], Any], layout: Layout = Layout()) -> None:
    if command(["daemon-reload"]).returncode != 0:
        reject("MONITOR_INSTALL_SYSTEMD_RELOAD_FAILED")
    for unit in TIMER_UNITS:
        if command(["enable", "--now", unit]).returncode != 0:
            reject("MONITOR_INSTALL_SYSTEMD_ENABLE_FAILED")
    verify_systemd(command, layout)


def systemd_effective_properties(command: Callable[[list[str]], Any], unit: str, properties: tuple[str, ...]) -> dict[str, str]:
    result = command(["show", "--no-pager", *[f"--property={name}" for name in properties], unit])
    raw = getattr(result, "stdout", b"")
    if result.returncode != 0 or not isinstance(raw, bytes) or len(raw) < 2 or len(raw) > 64 * 1024:
        reject("MONITOR_INSTALL_SYSTEMD_EFFECTIVE_INVALID")
    try:
        lines = raw.decode("utf-8").splitlines()
    except UnicodeDecodeError:
        reject("MONITOR_INSTALL_SYSTEMD_EFFECTIVE_INVALID")
    values: dict[str, str] = {}
    for line in lines:
        if "=" not in line:
            reject("MONITOR_INSTALL_SYSTEMD_EFFECTIVE_INVALID")
        name, value = line.split("=", 1)
        if name in values:
            reject("MONITOR_INSTALL_SYSTEMD_EFFECTIVE_INVALID")
        values[name] = value
    if set(values) != set(properties):
        reject("MONITOR_INSTALL_SYSTEMD_EFFECTIVE_INVALID")
    return values


def verify_systemd(command: Callable[[list[str]], Any], layout: Layout = Layout()) -> None:
    for unit in TIMER_UNITS:
        if command(["is-enabled", "--quiet", unit]).returncode != 0 or command(["is-active", "--quiet", unit]).returncode != 0:
            reject("MONITOR_INSTALL_SYSTEMD_VERIFY_FAILED")
    common = ("LoadState", "FragmentPath", "DropInPaths", "Transient")
    for unit in (*TIMER_UNITS, *SERVICE_UNITS):
        values = systemd_effective_properties(command, unit, common)
        if values != {"LoadState": "loaded", "FragmentPath": str(layout.systemd_root / unit), "DropInPaths": "", "Transient": "no"}:
            reject("MONITOR_INSTALL_SYSTEMD_EFFECTIVE_INVALID")
    service_properties = common + ("User", "Group", "ExecStart", "NoNewPrivileges", "PrivateNetwork", "ProtectSystem", "MemoryDenyWriteExecute", "IPAddressDeny", "ReadWritePaths", "InaccessiblePaths", "LoadCredential")
    phases = {
        "chenyida-erp-monitor-collector.service": ("root", "root", "collector", "yes", "", "/var/lib/chenyida-erp/monitoring-v1/observations", "/etc/chenyida-erp/monitoring-v1/private/notification.credential /var/lib/chenyida-erp/monitoring-v1/state /var/lib/chenyida-erp/monitoring-v1/outbox"),
        "chenyida-erp-monitor-evaluator.service": ("chenyida-monitor-eval", "chenyida-monitor-eval", "evaluator", "yes", "any", "/var/lib/chenyida-erp/monitoring-v1/state /var/lib/chenyida-erp/monitoring-v1/outbox", "/var/run/docker.sock /etc/chenyida-erp/monitoring-v1/private"),
        "chenyida-erp-monitor-notifier.service": ("chenyida-monitor-notify", "chenyida-monitor-notify", "notifier", "no", "any", "/var/lib/chenyida-erp/monitoring-v1/delivery", "/var/run/docker.sock /var/lib/chenyida-erp/monitoring-v1/state /var/lib/chenyida-erp/monitoring-v1/observations /var/lib/chenyida-erp/monitoring-v1/projections /etc/chenyida-erp/monitoring-v1/private/host-config.json"),
        "chenyida-erp-monitor-continuity.service": ("chenyida-monitor-eval", "chenyida-monitor-eval", "continuity", "yes", "any", "", "/var/run/docker.sock /etc/chenyida-erp/monitoring-v1/private /var/lib/chenyida-erp/monitoring-v1/delivery"),
    }
    for unit, (user, group, phase, private_network, deny, read_write_paths, inaccessible_paths) in phases.items():
        values = systemd_effective_properties(command, unit, service_properties)
        if any(values[field] != expected for field, expected in (("LoadState", "loaded"), ("FragmentPath", str(layout.systemd_root / unit)), ("DropInPaths", ""), ("Transient", "no"), ("User", user), ("Group", group), ("NoNewPrivileges", "yes"), ("PrivateNetwork", private_network), ("ProtectSystem", "strict"), ("MemoryDenyWriteExecute", "yes"), ("IPAddressDeny", deny))):
            reject("MONITOR_INSTALL_SYSTEMD_EFFECTIVE_INVALID")
        launcher = str(LAUNCHER_PATH)
        if values["ExecStart"].count(launcher) != 2 or f"argv[]={launcher} {phase}" not in values["ExecStart"]:
            reject("MONITOR_INSTALL_SYSTEMD_EFFECTIVE_INVALID")
        if unit == "chenyida-erp-monitor-notifier.service" and values["LoadCredential"] != "notification:/etc/chenyida-erp/monitoring-v1/private/notification.credential":
            reject("MONITOR_INSTALL_SYSTEMD_EFFECTIVE_INVALID")
        if unit != "chenyida-erp-monitor-notifier.service" and values["LoadCredential"] != "":
            reject("MONITOR_INSTALL_SYSTEMD_EFFECTIVE_INVALID")
        if values["ReadWritePaths"] != read_write_paths or values["InaccessiblePaths"] != inaccessible_paths:
            reject("MONITOR_INSTALL_SYSTEMD_EFFECTIVE_INVALID")


def verify_systemd_disabled(command: Callable[[list[str]], Any]) -> None:
    for unit in TIMER_UNITS:
        if command(["is-enabled", "--quiet", unit]).returncode == 0 or command(["is-active", "--quiet", unit]).returncode == 0:
            reject("MONITOR_DISABLE_SYSTEMD_VERIFY_FAILED")
    for unit in SERVICE_UNITS:
        if command(["is-active", "--quiet", unit]).returncode == 0:
            reject("MONITOR_DISABLE_SYSTEMD_VERIFY_FAILED")


def verify_committed_installation(layout: Layout, active: dict[str, Any], bundle: Path, runtime: Path, host_raw: bytes, evaluator_raw: bytes, notifier_raw: bytes, command: Callable[[list[str]], Any], require_activation_receipt: bool = True) -> None:
    active_raw = canonical_json(active)
    if bundle != layout.bundles_root / active["monitoring_bundle_sha256"] or runtime != layout.runtimes_root / active["runtime_sha256"] / "node":
        reject("MONITOR_INSTALL_COMMITTED_TARGET_INVALID")
    if active["private_config_sha256"] != sha256(host_raw) or active["evaluator_config_sha256"] != sha256(evaluator_raw) or active["notifier_config_sha256"] != sha256(notifier_raw) or active["unit_set_sha256"] != unit_set_sha(bundle):
        reject("MONITOR_INSTALL_COMMITTED_BINDING_INVALID")

    checks = [
        (layout.active_file, active_raw, {0o444}, 0, 0, "MONITOR_INSTALL_COMMITTED_ACTIVE_INVALID"),
        (layout.private_config, host_raw, {0o400}, 0, 0, "MONITOR_INSTALL_COMMITTED_CONFIG_INVALID"),
        (layout.view_root / f"{active['private_config_sha256']}.evaluator.json", evaluator_raw, {0o440}, 0, active["evaluator_gid"], "MONITOR_INSTALL_COMMITTED_EVALUATOR_VIEW_INVALID"),
        (layout.view_root / f"{active['private_config_sha256']}.notifier.json", notifier_raw, {0o440}, 0, active["notifier_gid"], "MONITOR_INSTALL_COMMITTED_NOTIFIER_VIEW_INVALID"),
    ]
    if require_activation_receipt:
        checks.append((layout.activation_root / f"{active['activation_sha256']}.json", active_raw, {0o444}, 0, 0, "MONITOR_INSTALL_COMMITTED_ACTIVATION_RECEIPT_INVALID"))
    for path, expected_raw, modes, uid, gid, code in checks:
        actual, _ = trusted_file(path, modes, uid, gid, code, max(len(expected_raw), 256))
        if actual != expected_raw:
            reject(code)

    launcher_raw, _ = trusted_file(bundle / LAUNCHER_RELATIVE, {0o444}, 0, 0, "MONITOR_INSTALL_LAUNCHER_SOURCE_INVALID")
    installed_launcher, _ = trusted_file(layout.launcher_path, {0o555}, 0, 0, "MONITOR_INSTALL_COMMITTED_LAUNCHER_INVALID")
    if installed_launcher != launcher_raw:
        reject("MONITOR_INSTALL_COMMITTED_LAUNCHER_INVALID")
    for relative in UNIT_RELATIVES:
        source_raw, _ = trusted_file(bundle / relative, {0o444}, 0, 0, "MONITOR_INSTALL_UNIT_SOURCE_INVALID")
        installed_raw, _ = trusted_file(layout.systemd_root / Path(relative).name, {0o444}, 0, 0, "MONITOR_INSTALL_COMMITTED_UNIT_INVALID")
        if installed_raw != source_raw:
            reject("MONITOR_INSTALL_COMMITTED_UNIT_INVALID")

    runtime_raw, _ = trusted_file(runtime, {0o555}, 0, 0, "MONITOR_INSTALL_COMMITTED_RUNTIME_INVALID", MAX_RUNTIME_BYTES)
    if len(runtime_raw) != active["runtime_bytes"] or sha256(runtime_raw) != active["runtime_sha256"]:
        reject("MONITOR_INSTALL_COMMITTED_RUNTIME_INVALID")
    verify_systemd(command, layout)


def activation_expected(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "activation_id": value["activation_id"],
        "installation_generation": value["installation_generation"],
        "monitoring_bundle_sha256": value["monitoring_bundle_sha256"],
        "supervisor_bundle_sha256": value["supervisor_bundle_sha256"],
        "evaluator_uid": value["evaluator_uid"],
        "evaluator_gid": value["evaluator_gid"],
        "notifier_uid": value["notifier_uid"],
        "notifier_gid": value["notifier_gid"],
    }


def install(expected: dict[str, Any], layout: Layout = Layout(), command: Callable[[list[str]], Any] = systemctl, validate_accounts: bool = True, credential_path_override: Path | None = None, runtime_validator: Callable[[Path, dict[str, Any]], str] = validate_runtime_version) -> dict[str, Any]:
    if os.getuid() != 0 or os.environ.get("ERP_RELEASE_SUPERVISOR_LAUNCHED") != "YES":
        reject("MONITOR_INSTALL_SUPERVISOR_CONTEXT_REQUIRED")
    assert_supervisor_lock(layout)
    source_root_value = os.environ.get("ERP_RELEASE_SUPERVISOR_SITE_ROOT", "")
    supervisor_sha = os.environ.get("ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256", "")
    authorization_sha = os.environ.get("ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256", "")
    if not source_root_value or not Path(source_root_value).is_absolute() or not SHA256.fullmatch(supervisor_sha) or not SHA256.fullmatch(authorization_sha) or supervisor_sha != expected["supervisor_bundle_sha256"]:
        reject("MONITOR_INSTALL_SUPERVISOR_CONTEXT_INVALID")
    source_site = Path(source_root_value)
    source_root = source_site.parent
    if validate_accounts:
        validate_account("chenyida-monitor-eval", expected["evaluator_uid"], expected["evaluator_gid"])
        validate_account("chenyida-monitor-notify", expected["notifier_uid"], expected["notifier_gid"])
    lock_descriptor = acquire_install_lock(layout)
    try:
        if layout.active_file.exists():
            preflight_raw, _ = trusted_file(layout.active_file, {0o444}, 0, 0, "MONITOR_INSTALL_ACTIVE_INVALID", 64 * 1024)
            preflight = validate_activation(strict_json(preflight_raw, "MONITOR_INSTALL_ACTIVE_JSON_INVALID", 64 * 1024))
            if any(preflight[field] != expected[field] for field in ("evaluator_uid", "evaluator_gid", "notifier_uid", "notifier_gid")):
                reject("MONITOR_INSTALL_IDENTITY_ROTATION_FORBIDDEN")
        initialize_layout(layout, expected)
        recover_incomplete_transactions(layout, command)
        rollback_target = None
        if expected.get("operation") == "ROLLBACK":
            target_sha = expected.get("rollback_target_activation_sha256", "")
            if not SHA256.fullmatch(target_sha) or target_sha in (expected["previous_activation_sha256"], ZERO_SHA256):
                reject("MONITOR_ROLLBACK_TARGET_INVALID")
            target_raw, _ = trusted_file(layout.activation_root / f"{target_sha}.json", {0o444}, 0, 0, "MONITOR_ROLLBACK_TARGET_RECEIPT_INVALID", 64 * 1024)
            rollback_target = validate_activation(strict_json(target_raw, "MONITOR_ROLLBACK_TARGET_RECEIPT_INVALID", 64 * 1024))
            if rollback_target["activation_sha256"] != target_sha or rollback_target["monitoring_bundle_sha256"] != expected["monitoring_bundle_sha256"] or rollback_target["runtime_sha256"] != expected["runtime_sha256"]:
                reject("MONITOR_ROLLBACK_TARGET_MISMATCH")
            assert_activation_was_committed(layout, rollback_target)
            manifest_path = layout.bundles_root / expected["monitoring_bundle_sha256"] / "bundle-manifest.json"
        else:
            manifest_path = source_site / MONITOR_MANIFEST_RELATIVE
        manifest_raw, _ = trusted_file(manifest_path, {0o444}, 0, 0, "MONITOR_INSTALL_MANIFEST_INVALID", MAX_JSON_BYTES)
        if sha256(manifest_raw) != expected["monitoring_bundle_sha256"]:
            reject("MONITOR_INSTALL_MANIFEST_DIGEST_MISMATCH")
        manifest = validate_manifest(strict_json(manifest_raw, "MONITOR_INSTALL_MANIFEST_JSON_INVALID"))
        host_config_path = Path(expected["host_config"])
        host_raw, _ = trusted_file(host_config_path, {0o400}, 0, 0, "MONITOR_INSTALL_HOST_CONFIG_FILE_INVALID", 256 * 1024)
        if sha256(host_raw) != expected["host_config_sha256"]:
            reject("MONITOR_INSTALL_HOST_CONFIG_DIGEST_MISMATCH")
        host = validate_host_config(strict_json(host_raw, "MONITOR_INSTALL_HOST_CONFIG_JSON_INVALID", 256 * 1024), expected)
        if credential_path_override is not None and validate_accounts:
            reject("MONITOR_INSTALL_CREDENTIAL_OVERRIDE_FORBIDDEN")
        credential = credential_path_override or Path(host["notification"]["credential"]["source_file"])
        credential_raw, _ = trusted_file(credential, {0o400}, 0, 0, "MONITOR_INSTALL_CREDENTIAL_FILE_INVALID", 4096)
        if sha256(credential_raw) != host["notification"]["credential"]["sha256"]:
            reject("MONITOR_INSTALL_CREDENTIAL_DIGEST_MISMATCH")
        evaluator_raw, notifier_raw = derive_views(host, expected["host_config_sha256"])
        private_sha = expected["host_config_sha256"]
        existing_active = None
        current_host = None
        stable_match = False
        if layout.active_file.exists():
            active_raw, _ = trusted_file(layout.active_file, {0o444}, 0, 0, "MONITOR_INSTALL_ACTIVE_INVALID", 64 * 1024)
            existing_active = validate_activation(strict_json(active_raw, "MONITOR_INSTALL_ACTIVE_JSON_INVALID", 64 * 1024))
            stable_match = existing_active.get("activation_id") == expected["activation_id"] and existing_active.get("installation_generation") == expected["installation_generation"] and existing_active.get("monitoring_bundle_sha256") == expected["monitoring_bundle_sha256"] and existing_active.get("supervisor_bundle_sha256") == expected["supervisor_bundle_sha256"] and existing_active.get("runtime_sha256") == expected["runtime_sha256"] and existing_active.get("runtime_bytes") == expected["runtime_bytes"] and existing_active.get("private_config_sha256") == private_sha and existing_active.get("previous_activation_sha256") == expected["previous_activation_sha256"]
            if not stable_match and (existing_active.get("activation_sha256") != expected["previous_activation_sha256"] or expected["installation_generation"] != existing_active.get("installation_generation", 0) + 1):
                reject("MONITOR_INSTALL_ACTIVATION_PREDECESSOR_MISMATCH")
        elif expected["previous_activation_sha256"] != ZERO_SHA256 or expected["installation_generation"] != 1:
            reject("MONITOR_INSTALL_FIRST_ACTIVATION_INVALID")
        if existing_active is not None and not stable_match:
            current_raw, _ = trusted_file(layout.private_config, {0o400}, 0, 0, "MONITOR_INSTALL_CURRENT_CONFIG_INVALID", 256 * 1024)
            if sha256(current_raw) != existing_active["private_config_sha256"]:
                reject("MONITOR_INSTALL_CURRENT_CONFIG_DIGEST_MISMATCH")
            current_host = validate_host_config(strict_json(current_raw, "MONITOR_INSTALL_CURRENT_CONFIG_INVALID", 256 * 1024), activation_expected(existing_active))
            if host["config_id"] != current_host["config_id"] or host["config_generation"] != current_host["config_generation"] + 1 or host["previous_config_sha256"] != existing_active["private_config_sha256"]:
                reject("MONITOR_INSTALL_CONFIG_TRANSITION_INVALID")
            assert_state_current_for_upgrade(layout, existing_active, current_host)
            assert_pending_target_rotation_safe(layout, existing_active, current_host, host)
        bundle = materialize_bundle(layout, manifest_raw, manifest, source_root, expected["monitoring_bundle_sha256"])
        if existing_active is not None and not stable_match and (layout.state_root / "current.json").exists():
            prior_policy, _ = trusted_file(layout.bundles_root / existing_active["monitoring_bundle_sha256"] / POLICY_RELATIVE, {0o444}, 0, 0, "MONITOR_INSTALL_POLICY_SOURCE_INVALID", 256 * 1024)
            candidate_policy, _ = trusted_file(bundle / POLICY_RELATIVE, {0o444}, 0, 0, "MONITOR_INSTALL_POLICY_SOURCE_INVALID", 256 * 1024)
            if prior_policy != candidate_policy:
                reject("MONITOR_INSTALL_POLICY_MIGRATION_REQUIRED")
        runtime = materialize_runtime(layout, Path(expected["runtime_path"]), expected)
        runtime_version = runtime_validator(Path(expected["runtime_path"]), expected)
        if not isinstance(runtime_version, str) or not re.fullmatch(r"(?:22\.(?:1[3-9]|[2-9][0-9])|23\.[0-9]+|24\.[0-9]+)\.[0-9]+", runtime_version):
            reject("MONITOR_INSTALL_RUNTIME_VERSION_INVALID")
        if existing_active is not None and stable_match:
            if existing_active["runtime_version"] != runtime_version:
                reject("MONITOR_INSTALL_RUNTIME_VERSION_MISMATCH")
            assert_activation_was_committed(layout, existing_active)
            active_raw, _ = trusted_file(layout.active_file, {0o444}, 0, 0, "MONITOR_INSTALL_ACTIVE_INVALID", 64 * 1024)
            write_new_file(layout.activation_root / f"{existing_active['activation_sha256']}.json", active_raw, 0o444, 0, 0, "MONITOR_INSTALL_ACTIVATION_RECEIPT_INVALID")
            run_systemd(command, layout)
            verify_committed_installation(layout, existing_active, bundle, runtime, host_raw, evaluator_raw, notifier_raw, command)
            return {"schema_version": 1, "contract": INSTALL_RECEIPT_CONTRACT, "status": "ALREADY_COMMITTED", "operation": expected.get("operation", "INSTALL"), "activation_sha256": existing_active["activation_sha256"], "monitoring_bundle_sha256": expected["monitoring_bundle_sha256"], "runtime_sha256": existing_active["runtime_sha256"], "runtime_version": existing_active["runtime_version"], "authorization_sha256": authorization_sha}
        activation = create_activation({**expected, "runtime_version": runtime_version}, private_sha, evaluator_raw, notifier_raw, unit_set_sha(bundle), datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"))
        activation_raw = canonical_json(activation)
        transaction_id = sha256(canonical_json({"activation": activation["activation_sha256"], "authorization": authorization_sha}))
        receipt = {"schema_version": 1, "contract": INSTALL_RECEIPT_CONTRACT, "status": "COMMITTED", "operation": expected.get("operation", "INSTALL"), "transaction_id": transaction_id, "activation_sha256": activation["activation_sha256"], "monitoring_bundle_sha256": expected["monitoring_bundle_sha256"], "runtime_sha256": expected["runtime_sha256"], "runtime_version": runtime_version, "host_config_sha256": private_sha, "authorization_sha256": authorization_sha, "committed_at": activation["committed_at"]}
        backup_directory = layout.backup_root / transaction_id
        ensure_directory(backup_directory, 0o700, 0, 0)
        fixed_targets = [layout.launcher_path, layout.private_config, *[layout.systemd_root / Path(relative).name for relative in UNIT_RELATIVES], layout.active_file]
        before = {}
        for index, target in enumerate(fixed_targets):
            before[str(target)] = snapshot_file(target, backup_directory / f"{index}.bin")
        launcher_raw, _ = trusted_file(bundle / LAUNCHER_RELATIVE, {0o444}, 0, 0, "MONITOR_INSTALL_LAUNCHER_SOURCE_INVALID")
        new_files: dict[str, tuple[bytes, int, int, int]] = {
            str(layout.launcher_path): (launcher_raw, 0o555, 0, 0),
            str(layout.private_config): (host_raw, 0o400, 0, 0),
            str(layout.active_file): (activation_raw, 0o444, 0, 0),
        }
        for relative in UNIT_RELATIVES:
            raw, _ = trusted_file(bundle / relative, {0o444}, 0, 0, "MONITOR_INSTALL_UNIT_SOURCE_INVALID")
            new_files[str(layout.systemd_root / Path(relative).name)] = (raw, 0o444, 0, 0)
        after = {name: {"sha256": sha256(raw), "mode": mode, "uid": uid, "gid": gid} for name, (raw, mode, uid, gid) in new_files.items()}
        journal = {"schema_version": 1, "contract": JOURNAL_CONTRACT, "transaction_id": transaction_id, "status": "PREPARED", "activation_sha256": activation["activation_sha256"], "authorization_sha256": authorization_sha, "before": before, "after": after, "receipt": receipt, "prepared_at": activation["committed_at"]}
        write_new_file(layout.journal_root / f"{transaction_id}.prepared.json", canonical_json(journal), 0o400, 0, 0, "MONITOR_INSTALL_JOURNAL_INVALID")
        durably_committed = False
        phase_descriptors: list[int] = []
        try:
            phase_descriptors = freeze_monitoring_phases(layout, existing_active or activation, command, stop_units=existing_active is not None)
            if existing_active is not None and current_host is not None:
                assert_state_current_for_upgrade(layout, existing_active, current_host)
                assert_pending_target_rotation_safe(layout, existing_active, current_host, host)
            for name, (raw, mode, uid, gid) in new_files.items():
                if Path(name) == layout.active_file:
                    continue
                atomic_replace(Path(name), raw, mode, uid, gid)
            write_new_file(layout.view_root / f"{private_sha}.evaluator.json", evaluator_raw, 0o440, 0, expected["evaluator_gid"], "MONITOR_INSTALL_EVALUATOR_VIEW_INVALID")
            write_new_file(layout.view_root / f"{private_sha}.notifier.json", notifier_raw, 0o440, 0, expected["notifier_gid"], "MONITOR_INSTALL_NOTIFIER_VIEW_INVALID")
            atomic_replace(layout.active_file, activation_raw, 0o444, 0, 0)
            run_systemd(command, layout)
            verify_committed_installation(layout, activation, bundle, runtime, host_raw, evaluator_raw, notifier_raw, command, require_activation_receipt=False)
            write_new_file(layout.receipt_root / f"{transaction_id}.json", canonical_json(receipt), 0o400, 0, 0, "MONITOR_INSTALL_RECEIPT_INVALID")
            committed = {**journal, "status": "COMMITTED", "receipt_sha256": sha256(canonical_json(receipt))}
            write_new_file(layout.journal_root / f"{transaction_id}.committed.json", canonical_json(committed), 0o400, 0, 0, "MONITOR_INSTALL_JOURNAL_INVALID")
            durably_committed = True
            write_new_file(layout.activation_root / f"{activation['activation_sha256']}.json", activation_raw, 0o444, 0, 0, "MONITOR_INSTALL_ACTIVATION_RECEIPT_INVALID")
            verify_committed_installation(layout, activation, bundle, runtime, host_raw, evaluator_raw, notifier_raw, command)
            return receipt
        except Exception:
            if not durably_committed:
                rollback_transaction(layout, journal, command)
            raise
        finally:
            for phase_descriptor in phase_descriptors:
                os.close(phase_descriptor)
    finally:
        os.close(lock_descriptor)


def preserved_runtime_evidence(layout: Layout, active: dict[str, Any]) -> dict[str, Any]:
    def optional_digest(path: Path, modes: set[int], uid: int, gid: int, code: str) -> str:
        if not path.exists():
            return ZERO_SHA256
        raw, _ = trusted_file(path, modes, uid, gid, code, MAX_JSON_BYTES)
        return sha256(raw)

    counts: dict[str, int] = {}
    directories = {
        "events": (layout.outbox_root / "events", active["evaluator_uid"], active["notifier_gid"]),
        "grants": (layout.outbox_root / "grants", active["evaluator_uid"], active["notifier_gid"]),
        "claims": (layout.delivery_root / "claims", active["notifier_uid"], active["evaluator_gid"]),
        "attempts": (layout.delivery_root / "attempts", active["notifier_uid"], active["evaluator_gid"]),
        "results": (layout.delivery_root / "results", active["notifier_uid"], active["evaluator_gid"]),
        "acks": (layout.delivery_root / "acks", active["notifier_uid"], active["evaluator_gid"]),
        "readiness": (layout.delivery_root / "readiness", active["notifier_uid"], active["evaluator_gid"]),
    }
    for name, (directory, uid, gid) in directories.items():
        trusted_directory(directory, {0o2750}, uid, gid, "MONITOR_DISABLE_PRESERVATION_INVALID")
        entries = list(os.scandir(directory))
        if len(entries) > 4160 or any(not entry.is_file(follow_symlinks=False) for entry in entries):
            reject("MONITOR_DISABLE_PRESERVATION_INVALID")
        counts[name] = len(entries)
    return {
        "active_sha256": active["activation_sha256"],
        "state_sha256": optional_digest(layout.state_root / "current.json", {0o600}, active["evaluator_uid"], active["evaluator_gid"], "MONITOR_DISABLE_STATE_INVALID"),
        "components_projection_sha256": optional_digest(layout.projection_root / "components.json", {0o440}, 0, active["evaluator_gid"], "MONITOR_DISABLE_PROJECTION_INVALID"),
        "backup_projection_sha256": optional_digest(layout.projection_root / "backup.json", {0o440}, 0, active["evaluator_gid"], "MONITOR_DISABLE_PROJECTION_INVALID"),
        "ledger_entry_counts": counts,
    }


def disable(expected_active_sha256: str, disable_id: str, layout: Layout = Layout(), command: Callable[[list[str]], Any] = systemctl) -> dict[str, Any]:
    if os.getuid() != 0 or os.environ.get("ERP_RELEASE_SUPERVISOR_LAUNCHED") != "YES" or not SHA256.fullmatch(expected_active_sha256) or not IDENTIFIER.fullmatch(disable_id):
        reject("MONITOR_DISABLE_CONTEXT_INVALID")
    authorization_sha = os.environ.get("ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256", "")
    if not SHA256.fullmatch(authorization_sha):
        reject("MONITOR_DISABLE_CONTEXT_INVALID")
    assert_supervisor_lock(layout)
    descriptor = acquire_install_lock(layout)
    try:
        active_raw, _ = trusted_file(layout.active_file, {0o444}, 0, 0, "MONITOR_DISABLE_ACTIVE_INVALID", 64 * 1024)
        active = validate_activation(strict_json(active_raw, "MONITOR_DISABLE_ACTIVE_JSON_INVALID", 64 * 1024))
        if active.get("activation_sha256") != expected_active_sha256:
            reject("MONITOR_DISABLE_ACTIVE_MISMATCH")
        receipt_path = layout.receipt_root / f"{disable_id}.disable.json"
        if receipt_path.exists():
            raw, _ = trusted_file(receipt_path, {0o400}, 0, 0, "MONITOR_DISABLE_RECEIPT_INVALID", 64 * 1024)
            prior = exact_fields(strict_json(raw, "MONITOR_DISABLE_RECEIPT_INVALID", 64 * 1024), {"schema_version", "contract", "status", "disable_id", "activation_sha256", "authorization_sha256", "disabled_at", "preserved", "preservation_evidence"}, "MONITOR_DISABLE_RECEIPT_INVALID")
            if raw != canonical_json(prior) or prior["schema_version"] != 1 or prior["contract"] != DISABLE_RECEIPT_CONTRACT or prior["status"] != "DISABLED_PRESERVED" or prior["disable_id"] != disable_id or prior["activation_sha256"] != expected_active_sha256 or prior["authorization_sha256"] != authorization_sha:
                reject("MONITOR_DISABLE_RECEIPT_COLLISION")
            verify_systemd_disabled(command)
            if prior["preservation_evidence"] != preserved_runtime_evidence(layout, active):
                reject("MONITOR_DISABLE_PRESERVATION_DRIFT")
            return prior
        disabled_units: list[str] = []
        for unit in reversed(TIMER_UNITS):
            if command(["disable", "--now", unit]).returncode != 0:
                for disabled in reversed(disabled_units):
                    try:
                        command(["enable", "--now", disabled])
                    except Exception:
                        pass
                reject("MONITOR_DISABLE_SYSTEMD_FAILED")
            disabled_units.append(unit)
        for unit in SERVICE_UNITS:
            if command(["stop", unit]).returncode != 0:
                for disabled in reversed(disabled_units):
                    try:
                        command(["enable", "--now", disabled])
                    except Exception:
                        pass
                reject("MONITOR_DISABLE_SYSTEMD_FAILED")
        verify_systemd_disabled(command)
        disabled_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        receipt = {"schema_version": 1, "contract": DISABLE_RECEIPT_CONTRACT, "status": "DISABLED_PRESERVED", "disable_id": disable_id, "activation_sha256": expected_active_sha256, "authorization_sha256": authorization_sha, "disabled_at": disabled_at, "preserved": ["bundles", "runtimes", "config", "state", "outbox", "delivery", "journal", "receipts"], "preservation_evidence": preserved_runtime_evidence(layout, active)}
        write_new_file(receipt_path, canonical_json(receipt), 0o400, 0, 0, "MONITOR_DISABLE_RECEIPT_INVALID")
        return receipt
    finally:
        os.close(descriptor)


def parse_install(arguments: list[str], operation: str = "INSTALL") -> dict[str, Any]:
    base_names = ("monitoring-bundle-sha256", "host-config", "host-config-sha256", "runtime-path", "runtime-sha256", "runtime-bytes", "runtime-dev", "runtime-ino", "evaluator-uid", "evaluator-gid", "notifier-uid", "notifier-gid", "activation-id", "installation-generation", "previous-activation-sha256", "supervisor-bundle-sha256")
    names = (*base_names, "rollback-target-activation-sha256") if operation == "ROLLBACK" else base_names
    if len(arguments) != len(names) * 2 + 2:
        reject("MONITOR_INSTALL_ARGUMENT_INVALID")
    values: dict[str, str] = {}
    for index in range(0, len(arguments) - 2, 2):
        key = arguments[index]
        if not key.startswith("--") or key[2:] not in names or key[2:] in values:
            reject("MONITOR_INSTALL_ARGUMENT_INVALID")
        values[key[2:]] = arguments[index + 1]
    confirmation = "ROLLBACK_EXACT_MONITORING_HOST_DELIVERY" if operation == "ROLLBACK" else "INSTALL_EXACT_MONITORING_HOST_DELIVERY"
    if set(values) != set(names) or arguments[-2:] != ["--confirm", confirmation]:
        reject("MONITOR_INSTALL_ARGUMENT_INVALID")
    result: dict[str, Any] = {key.replace("-", "_"): value for key, value in values.items()}
    for field in ("runtime_bytes", "runtime_dev", "runtime_ino", "evaluator_uid", "evaluator_gid", "notifier_uid", "notifier_gid", "installation_generation"):
        try:
            result[field] = int(result[field])
        except ValueError:
            reject("MONITOR_INSTALL_ARGUMENT_INVALID")
    digest_fields = ["monitoring_bundle_sha256", "host_config_sha256", "runtime_sha256", "previous_activation_sha256", "supervisor_bundle_sha256"]
    if operation == "ROLLBACK":
        digest_fields.append("rollback_target_activation_sha256")
    for field in digest_fields:
        if not SHA256.fullmatch(result[field]):
            reject("MONITOR_INSTALL_ARGUMENT_INVALID")
    if not IDENTIFIER.fullmatch(result["activation_id"]):
        reject("MONITOR_INSTALL_ARGUMENT_INVALID")
    for field in ("host_config", "runtime_path"):
        candidate = Path(result[field])
        if not candidate.is_absolute() or candidate == Path("/") or candidate != Path(os.path.normpath(candidate)):
            reject("MONITOR_INSTALL_ARGUMENT_INVALID")
    result["operation"] = operation
    return result


def main() -> None:
    if not sys.argv[1:]:
        reject("MONITOR_INSTALL_ARGUMENT_INVALID")
    operation, arguments = sys.argv[1], sys.argv[2:]
    if operation == "install":
        result = install(parse_install(arguments, "INSTALL"))
    elif operation == "rollback":
        result = install(parse_install(arguments, "ROLLBACK"))
    elif operation == "disable":
        if len(arguments) != 6 or arguments[0] != "--expected-active-sha256" or arguments[2] != "--disable-id" or arguments[4:] != ["--confirm", "DISABLE_EXACT_MONITORING_HOST_DELIVERY"]:
            reject("MONITOR_DISABLE_ARGUMENT_INVALID")
        result = disable(arguments[1], arguments[3])
    else:
        reject("MONITOR_INSTALL_ARGUMENT_INVALID")
    os.write(sys.stdout.fileno(), canonical_json(result))


if __name__ == "__main__":
    try:
        main()
    except MonitoringInstallError as error:
        print(error.code, file=sys.stderr)
        raise SystemExit(1) from None
    except Exception:
        print("MONITOR_INSTALL_INTERNAL_ERROR", file=sys.stderr)
        raise SystemExit(1) from None
