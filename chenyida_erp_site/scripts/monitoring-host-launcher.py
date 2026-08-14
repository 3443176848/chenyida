#!/usr/bin/python3
"""Stable, non-mutating launcher for the content-addressed monitoring host bundle."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import shlex
import stat
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


INSTALL_ROOT = Path("/usr/local/libexec/chenyida-erp-monitoring-host-v1")
BUNDLES_ROOT = INSTALL_ROOT / "bundles"
RUNTIMES_ROOT = INSTALL_ROOT / "runtimes"
LAUNCHER_PATH = Path("/usr/local/sbin/chenyida-erp-monitoring-host-v1")
CONFIG_ROOT = Path("/etc/chenyida-erp/monitoring-v1")
PRIVATE_ROOT = CONFIG_ROOT / "private"
PRIVATE_CONFIG = Path("/etc/chenyida-erp/monitoring-v1/private/host-config.json")
VIEW_ROOT = Path("/etc/chenyida-erp/monitoring-v1/views")
DATA_ROOT = Path("/var/lib/chenyida-erp/monitoring-v1")
ACTIVE_FILE = Path("/var/lib/chenyida-erp/monitoring-v1/active.json")
ACTIVATION_ROOT = Path("/var/lib/chenyida-erp/monitoring-v1/activations")
OBSERVATION_ROOT = Path("/var/lib/chenyida-erp/monitoring-v1/observations")
STATE_ROOT = Path("/var/lib/chenyida-erp/monitoring-v1/state")
OUTBOX_ROOT = Path("/var/lib/chenyida-erp/monitoring-v1/outbox")
DELIVERY_ROOT = Path("/var/lib/chenyida-erp/monitoring-v1/delivery")
LOCK_ROOT = Path("/var/lib/chenyida-erp/monitoring-v1/locks")
NOTIFIER_EGRESS_POLICY = Path("/etc/chenyida-erp/monitoring-v1/views/notifier-egress-policy.json")
NOTIFIER_EGRESS_ACTIVATION = Path("/etc/chenyida-erp/monitoring-v1/views/notifier-egress-activation.json")
NOTIFIER_EGRESS_UNIT = "chenyida-erp-monitor-notifier.service"
NOTIFIER_EGRESS_BASE_UNIT = Path(f"/etc/systemd/system/{NOTIFIER_EGRESS_UNIT}")
NOTIFIER_EGRESS_DROPIN = Path(f"/etc/systemd/system/{NOTIFIER_EGRESS_UNIT}.d/50-chenyida-erp-notifier-egress.conf")
POLICY_PATH = "chenyida_erp_site/operations/monitoring-policy-v1.json"
RESOURCE_PLAN_PATH = "chenyida_erp_site/release/release-gate-plan-v2.json"
HOST_RUNNER_PATH = "chenyida_erp_site/tools/ops-monitoring/host-runner.mjs"

BUNDLE_CONTRACT = "chenyida-erp-monitoring-host-bundle/v1"
ACTIVATION_CONTRACT = "chenyida-erp-monitoring-host-activation/v1"
SAFE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ZERO_SHA256 = "0" * 64
MAX_JSON_BYTES = 2 * 1024 * 1024
MAX_BUNDLE_FILE_BYTES = 8 * 1024 * 1024
MAX_BUNDLE_BYTES = 32 * 1024 * 1024
MAX_RUNTIME_BYTES = 256 * 1024 * 1024
SHA256 = re.compile(r"^[0-9a-f]{64}$")
GIT_OBJECT = re.compile(r"^[0-9a-f]{40}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
ISO_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")

MONITOR_BUNDLE_FILES: dict[str, str] = {
    "chenyida_erp_site/deployment/systemd/chenyida-erp-monitor-collector.service": "0444",
    "chenyida_erp_site/deployment/systemd/chenyida-erp-monitor-collector.timer": "0444",
    "chenyida_erp_site/deployment/systemd/chenyida-erp-monitor-continuity.service": "0444",
    "chenyida_erp_site/deployment/systemd/chenyida-erp-monitor-continuity.timer": "0444",
    "chenyida_erp_site/deployment/systemd/chenyida-erp-monitor-evaluator.service": "0444",
    "chenyida_erp_site/deployment/systemd/chenyida-erp-monitor-notifier.service": "0444",
    "chenyida_erp_site/deployment/systemd/chenyida-erp-monitor-notifier.timer": "0444",
    "chenyida_erp_site/operations/monitoring-host-config-schema-v1.json": "0444",
    "chenyida_erp_site/operations/monitoring-host-delivery-policy-v1.json": "0444",
    "chenyida_erp_site/operations/monitoring-notifier-egress-policy-v1.json": "0444",
    "chenyida_erp_site/operations/monitoring-policy-v1.json": "0444",
    "chenyida_erp_site/release/release-gate-plan-v2.json": "0444",
    "chenyida_erp_site/scripts/create-monitoring-host-bundle-manifest.py": "0555",
    "chenyida_erp_site/scripts/install-monitoring-host-delivery.py": "0444",
    "chenyida_erp_site/scripts/monitoring-host-launcher.py": "0444",
    "chenyida_erp_site/tests/selfhost-ops-monitoring-host-delivery.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-ops-monitoring-notifier-egress.test.mjs": "0444",
    "chenyida_erp_site/tests/test_release_supervisor_monitoring_host_delivery.py": "0444",
    "chenyida_erp_site/tools/ops-monitoring/backup-projection.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/collector.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/components-projection.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/contract.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/delivery-contract.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/delivery-store.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/host-runner.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/host-store.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/notifier.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/notifier-egress-contract.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/resource-policy.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/strict-json.mjs": "0444",
}


class MonitoringLauncherError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def reject(code: str) -> None:
    raise MonitoringLauncherError(code)


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def strict_json(raw: bytes, code: str, maximum: int = MAX_JSON_BYTES) -> Any:
    if len(raw) < 2 or len(raw) > maximum:
        reject(code)

    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                reject(code)
            result[key] = value
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


def trusted_file(path: Path, modes: set[int], uid: int, gid: int, code: str, maximum: int = MAX_BUNDLE_FILE_BYTES) -> tuple[bytes, os.stat_result]:
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


def trusted_file_digest(path: Path, modes: set[int], uid: int, gid: int, code: str, maximum: int) -> tuple[str, int, os.stat_result]:
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
        digest = hashlib.sha256()
        count = 0
        while count <= maximum:
            chunk = os.read(descriptor, min(1024 * 1024, maximum + 1 - count))
            if not chunk:
                break
            digest.update(chunk)
            count += len(chunk)
        after = os.fstat(descriptor)
        path_after = os.lstat(path)
        if count != before.st_size or (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) or (path_after.st_dev, path_after.st_ino, path_after.st_nlink, path_after.st_uid, path_after.st_gid, stat.S_IMODE(path_after.st_mode)) != (opened.st_dev, opened.st_ino, 1, uid, gid, stat.S_IMODE(opened.st_mode)):
            reject(f"{code}_CHANGED")
        return digest.hexdigest(), count, opened
    except OSError:
        reject(code)
    finally:
        os.close(descriptor)


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
    lock_root: Path = LOCK_ROOT
    notifier_egress_policy: Path = NOTIFIER_EGRESS_POLICY
    notifier_egress_activation: Path = NOTIFIER_EGRESS_ACTIVATION
    notifier_egress_base_unit: Path = NOTIFIER_EGRESS_BASE_UNIT
    notifier_egress_dropin: Path = NOTIFIER_EGRESS_DROPIN


def validate_manifest(value: Any) -> dict[str, Any]:
    value = exact_fields(value, {"schema_version", "contract", "bundle_version", "source_commit", "source_tree", "launcher_sha256", "files"}, "MONITOR_BUNDLE_FIELDS_INVALID")
    if value["schema_version"] != 1 or value["contract"] != BUNDLE_CONTRACT or value["bundle_version"] != 1 or not isinstance(value["source_commit"], str) or not GIT_OBJECT.fullmatch(value["source_commit"]) or not isinstance(value["source_tree"], str) or not GIT_OBJECT.fullmatch(value["source_tree"]) or not isinstance(value["launcher_sha256"], str) or not SHA256.fullmatch(value["launcher_sha256"]):
        reject("MONITOR_BUNDLE_IDENTITY_INVALID")
    files = value["files"]
    if not isinstance(files, list) or len(files) != len(MONITOR_BUNDLE_FILES):
        reject("MONITOR_BUNDLE_FILE_SET_INVALID")
    previous = ""
    total = 0
    for entry in files:
        entry = exact_fields(entry, {"path", "sha256", "bytes", "mode"}, "MONITOR_BUNDLE_FILE_FIELDS_INVALID")
        relative = entry["path"]
        if relative not in MONITOR_BUNDLE_FILES or relative <= previous or entry["mode"] != MONITOR_BUNDLE_FILES[relative] or not isinstance(entry["sha256"], str) or not SHA256.fullmatch(entry["sha256"]) or not isinstance(entry["bytes"], int) or isinstance(entry["bytes"], bool) or entry["bytes"] < 1 or entry["bytes"] > MAX_BUNDLE_FILE_BYTES:
            reject("MONITOR_BUNDLE_FILE_INVALID")
        total += entry["bytes"]
        previous = relative
    if {entry["path"] for entry in files} != set(MONITOR_BUNDLE_FILES) or total > MAX_BUNDLE_BYTES:
        reject("MONITOR_BUNDLE_FILE_SET_INVALID")
    return value


def validate_activation(value: Any) -> dict[str, Any]:
    fields = {"schema_version", "contract", "activation_sha256", "activation_id", "status", "installation_generation", "monitoring_bundle_sha256", "supervisor_bundle_sha256", "runtime_sha256", "runtime_bytes", "runtime_version", "private_config_sha256", "evaluator_config_sha256", "notifier_config_sha256", "evaluator_uid", "evaluator_gid", "notifier_uid", "notifier_gid", "state_schema_min", "state_schema_max", "unit_set_sha256", "previous_activation_sha256", "committed_at"}
    value = exact_fields(value, fields, "MONITOR_ACTIVATION_FIELDS_INVALID")
    if value["schema_version"] != 1 or value["contract"] != ACTIVATION_CONTRACT or value["status"] != "COMMITTED" or not isinstance(value["activation_id"], str) or not IDENTIFIER.fullmatch(value["activation_id"]) or not isinstance(value["installation_generation"], int) or isinstance(value["installation_generation"], bool) or value["installation_generation"] < 1 or value["state_schema_min"] != 1 or value["state_schema_max"] != 1 or not isinstance(value["runtime_bytes"], int) or isinstance(value["runtime_bytes"], bool) or value["runtime_bytes"] < 1 or value["runtime_bytes"] > MAX_RUNTIME_BYTES or not isinstance(value["runtime_version"], str) or not re.fullmatch(r"(?:22\.(?:1[3-9]|[2-9][0-9])|23\.[0-9]+|24\.[0-9]+)\.[0-9]+", value["runtime_version"]) or not isinstance(value["committed_at"], str) or not ISO_UTC.fullmatch(value["committed_at"]):
        reject("MONITOR_ACTIVATION_INVALID")
    for field in ("activation_sha256", "monitoring_bundle_sha256", "supervisor_bundle_sha256", "runtime_sha256", "private_config_sha256", "evaluator_config_sha256", "notifier_config_sha256", "unit_set_sha256", "previous_activation_sha256"):
        if not isinstance(value[field], str) or not SHA256.fullmatch(value[field]):
            reject("MONITOR_ACTIVATION_DIGEST_INVALID")
    for field in ("evaluator_uid", "evaluator_gid", "notifier_uid", "notifier_gid"):
        if not isinstance(value[field], int) or isinstance(value[field], bool) or value[field] < 1 or value[field] > 2**31 - 1:
            reject("MONITOR_ACTIVATION_IDENTITY_INVALID")
    if value["evaluator_uid"] == value["notifier_uid"] or value["evaluator_gid"] == value["notifier_gid"]:
        reject("MONITOR_ACTIVATION_IDENTITY_INVALID")
    body = dict(value)
    body.pop("activation_sha256")
    if value["activation_sha256"] != sha256(canonical_json(body)):
        reject("MONITOR_ACTIVATION_INTEGRITY_INVALID")
    return value


def verify_bundle(layout: Layout, bundle_sha256: str) -> tuple[Path, dict[str, Any]]:
    trusted_directory(layout.install_root, {0o555, 0o755}, 0, 0, "MONITOR_INSTALL_ROOT_INVALID")
    trusted_directory(layout.bundles_root, {0o555, 0o755}, 0, 0, "MONITOR_BUNDLES_ROOT_INVALID")
    bundle = layout.bundles_root / bundle_sha256
    trusted_directory(bundle, {0o555}, 0, 0, "MONITOR_BUNDLE_ROOT_INVALID")
    manifest_raw, _ = trusted_file(bundle / "bundle-manifest.json", {0o444}, 0, 0, "MONITOR_BUNDLE_MANIFEST_INVALID", MAX_JSON_BYTES)
    if sha256(manifest_raw) != bundle_sha256:
        reject("MONITOR_BUNDLE_MANIFEST_DIGEST_MISMATCH")
    manifest = validate_manifest(strict_json(manifest_raw, "MONITOR_BUNDLE_MANIFEST_JSON_INVALID"))
    actual: set[str] = set()
    for directory, names, files in os.walk(bundle, topdown=True, followlinks=False):
        directory_path = Path(directory)
        trusted_directory(directory_path, {0o555}, 0, 0, "MONITOR_BUNDLE_DIRECTORY_INVALID")
        if any(Path(directory, name).is_symlink() for name in names) or any(Path(directory, name).is_symlink() for name in files):
            reject("MONITOR_BUNDLE_SYMLINK_FORBIDDEN")
        for name in files:
            relative = (directory_path / name).relative_to(bundle).as_posix()
            if relative != "bundle-manifest.json":
                actual.add(relative)
    if actual != set(MONITOR_BUNDLE_FILES):
        reject("MONITOR_BUNDLE_EXTRA_OR_MISSING_FILE")
    entries = {entry["path"]: entry for entry in manifest["files"]}
    for relative, mode in MONITOR_BUNDLE_FILES.items():
        raw, _ = trusted_file(bundle / relative, {int(mode, 8)}, 0, 0, "MONITOR_BUNDLE_FILE_INVALID")
        if len(raw) != entries[relative]["bytes"] or sha256(raw) != entries[relative]["sha256"]:
            reject("MONITOR_BUNDLE_FILE_DIGEST_MISMATCH")
    launcher_raw, _ = trusted_file(bundle / "chenyida_erp_site/scripts/monitoring-host-launcher.py", {0o444}, 0, 0, "MONITOR_BUNDLE_LAUNCHER_INVALID")
    if sha256(launcher_raw) != manifest["launcher_sha256"]:
        reject("MONITOR_BUNDLE_LAUNCHER_DIGEST_MISMATCH")
    return bundle, manifest


def read_active(layout: Layout) -> tuple[dict[str, Any], bytes]:
    raw, _ = trusted_file(layout.active_file, {0o444}, 0, 0, "MONITOR_ACTIVE_FILE_INVALID", 64 * 1024)
    value = validate_activation(strict_json(raw, "MONITOR_ACTIVE_JSON_INVALID", 64 * 1024))
    receipt_raw, _ = trusted_file(layout.activation_root / f"{value['activation_sha256']}.json", {0o444}, 0, 0, "MONITOR_ACTIVATION_RECEIPT_INVALID", 64 * 1024)
    if receipt_raw != raw:
        reject("MONITOR_ACTIVE_RECEIPT_MISMATCH")
    return value, raw


def verify_activation(layout: Layout = Layout()) -> tuple[dict[str, Any], Path, Path]:
    trusted_directory(layout.config_root, {0o755}, 0, 0, "MONITOR_CONFIG_ROOT_INVALID")
    trusted_directory(layout.private_root, {0o700}, 0, 0, "MONITOR_PRIVATE_ROOT_INVALID")
    trusted_directory(layout.view_root, {0o755}, 0, 0, "MONITOR_VIEW_ROOT_INVALID")
    trusted_directory(layout.data_root, {0o755}, 0, 0, "MONITOR_DATA_ROOT_INVALID")
    trusted_directory(layout.activation_root, {0o755}, 0, 0, "MONITOR_ACTIVATION_ROOT_INVALID")
    active, _ = read_active(layout)
    bundle, _ = verify_bundle(layout, active["monitoring_bundle_sha256"])
    trusted_directory(layout.runtimes_root, {0o555, 0o755}, 0, 0, "MONITOR_RUNTIMES_ROOT_INVALID")
    runtime_root = layout.runtimes_root / active["runtime_sha256"]
    trusted_directory(runtime_root, {0o555}, 0, 0, "MONITOR_RUNTIME_ROOT_INVALID")
    if {entry.name for entry in os.scandir(runtime_root)} != {"node"}:
        reject("MONITOR_RUNTIME_ROOT_INVALID")
    runtime = runtime_root / "node"
    runtime_sha256, runtime_bytes, _ = trusted_file_digest(runtime, {0o555}, 0, 0, "MONITOR_RUNTIME_FILE_INVALID", MAX_RUNTIME_BYTES)
    if runtime_bytes != active["runtime_bytes"] or runtime_sha256 != active["runtime_sha256"]:
        reject("MONITOR_RUNTIME_DIGEST_MISMATCH")
    private_raw, _ = trusted_file(layout.private_config, {0o400}, 0, 0, "MONITOR_PRIVATE_CONFIG_INVALID", 256 * 1024)
    evaluator = layout.view_root / f"{active['private_config_sha256']}.evaluator.json"
    notifier = layout.view_root / f"{active['private_config_sha256']}.notifier.json"
    evaluator_raw, _ = trusted_file(evaluator, {0o440}, 0, active["evaluator_gid"], "MONITOR_EVALUATOR_CONFIG_INVALID", 256 * 1024)
    notifier_raw, _ = trusted_file(notifier, {0o440}, 0, active["notifier_gid"], "MONITOR_NOTIFIER_CONFIG_INVALID", 256 * 1024)
    if sha256(private_raw) != active["private_config_sha256"] or sha256(evaluator_raw) != active["evaluator_config_sha256"] or sha256(notifier_raw) != active["notifier_config_sha256"]:
        reject("MONITOR_CONFIG_DIGEST_MISMATCH")
    return active, bundle, runtime


def phase_identity(active: dict[str, Any], phase: str) -> tuple[int, int]:
    if phase == "collector":
        return 0, 0
    if phase in ("evaluator", "continuity"):
        return active["evaluator_uid"], active["evaluator_gid"]
    if phase == "notifier":
        return active["notifier_uid"], active["notifier_gid"]
    reject("MONITOR_LAUNCHER_PHASE_INVALID")


def acquire_lock(layout: Layout, active: dict[str, Any], phase: str) -> int:
    if phase in ("evaluator", "continuity"):
        lock = layout.state_root / ".monitor.flock"
        uid, gid = active["evaluator_uid"], active["evaluator_gid"]
    else:
        lock = layout.lock_root / f"{phase}.flock"
        uid, gid = phase_identity(active, phase)
    _, metadata = trusted_file(lock, {0o600}, uid, gid, "MONITOR_PHASE_LOCK_INVALID", 256)
    try:
        descriptor = os.open(lock, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        opened = os.fstat(descriptor)
        if (opened.st_dev, opened.st_ino) != (metadata.st_dev, metadata.st_ino):
            reject("MONITOR_PHASE_LOCK_CHANGED")
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        os.set_inheritable(descriptor, True)
        return descriptor
    except BlockingIOError:
        reject("MONITOR_PHASE_LOCKED")
    except OSError:
        reject("MONITOR_PHASE_LOCK_INVALID")


def notifier_egress_systemctl(arguments: list[str]) -> subprocess.CompletedProcess[bytes]:
    environment = {"PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent"}
    try:
        return subprocess.run(
            ["/usr/bin/systemctl", *arguments], env=environment, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        reject("MONITOR_NOTIFIER_EGRESS_SYSTEMCTL_FAILED")


def current_notifier_egress_effective_sha256(layout: Layout, active: dict[str, Any],
                                             command: Any = notifier_egress_systemctl) -> str:
    present = []
    for file in (layout.notifier_egress_policy, layout.notifier_egress_activation):
        try:
            os.lstat(file)
            present.append(True)
        except FileNotFoundError:
            present.append(False)
        except OSError:
            reject("MONITOR_NOTIFIER_EGRESS_FILE_INVALID")
    if not any(present):
        return ZERO_SHA256
    if not all(present):
        reject("MONITOR_NOTIFIER_EGRESS_PARTIAL")
    policy_raw, _ = trusted_file(layout.notifier_egress_policy, {0o440}, 0, active["notifier_gid"], "MONITOR_NOTIFIER_EGRESS_POLICY_INVALID", 256 * 1024)
    activation_raw, _ = trusted_file(layout.notifier_egress_activation, {0o440}, 0, active["notifier_gid"], "MONITOR_NOTIFIER_EGRESS_ACTIVATION_INVALID", 256 * 1024)
    policy = strict_json(policy_raw, "MONITOR_NOTIFIER_EGRESS_POLICY_INVALID", 256 * 1024)
    activation = strict_json(activation_raw, "MONITOR_NOTIFIER_EGRESS_ACTIVATION_INVALID", 256 * 1024)
    if canonical_json(policy) != policy_raw or canonical_json(activation) != activation_raw \
        or not isinstance(policy, dict) or policy.get("contract") != "chenyida-erp-monitoring-notifier-egress-policy/v1" \
        or not isinstance(activation, dict) or activation.get("contract") != "chenyida-erp-monitoring-notifier-egress-activation-receipt/v1" \
        or activation.get("policy_sha256") != sha256(policy_raw) or activation.get("receipt_sha256") != sha256(canonical_json({key: value for key, value in activation.items() if key != "receipt_sha256"})):
        reject("MONITOR_NOTIFIER_EGRESS_ACTIVATION_INVALID")
    systemd = policy.get("systemd")
    network = policy.get("network")
    binding = policy.get("binding")
    if not isinstance(systemd, dict) or set(systemd) != {"unit", "fragment_path", "dropin_path", "dropin_sha256", "effective_unit_sha256"} \
        or systemd.get("unit") != NOTIFIER_EGRESS_UNIT or systemd.get("fragment_path") != str(NOTIFIER_EGRESS_BASE_UNIT) \
        or systemd.get("dropin_path") != str(NOTIFIER_EGRESS_DROPIN) or not isinstance(systemd.get("dropin_sha256"), str) \
        or not SHA256.fullmatch(systemd["dropin_sha256"]) or systemd["dropin_sha256"] == ZERO_SHA256 \
        or not isinstance(systemd.get("effective_unit_sha256"), str) or not SHA256.fullmatch(systemd["effective_unit_sha256"]) \
        or systemd["effective_unit_sha256"] == ZERO_SHA256 or not isinstance(binding, dict) \
        or not isinstance(binding.get("base_unit_sha256"), str) or not SHA256.fullmatch(binding["base_unit_sha256"]) \
        or binding["base_unit_sha256"] == ZERO_SHA256 or not isinstance(network, dict) \
        or not isinstance(network.get("allowed_addresses"), list):
        reject("MONITOR_NOTIFIER_EGRESS_POLICY_INVALID")
    allowed = []
    for item in network["allowed_addresses"]:
        if not isinstance(item, dict) or set(item) != {"family", "address", "prefix_length", "systemd_prefix"} \
            or not isinstance(item["systemd_prefix"], str) or not item["systemd_prefix"] \
            or "\n" in item["systemd_prefix"] or "\r" in item["systemd_prefix"]:
            reject("MONITOR_NOTIFIER_EGRESS_POLICY_INVALID")
        allowed.append(item["systemd_prefix"])
    base_unit_raw, _ = trusted_file(
        layout.notifier_egress_base_unit, {0o444}, 0, 0,
        "MONITOR_NOTIFIER_EGRESS_BASE_UNIT_INVALID", 256 * 1024,
    )
    if sha256(base_unit_raw) != binding["base_unit_sha256"]:
        reject("MONITOR_NOTIFIER_EGRESS_BASE_UNIT_INVALID")
    dropin_root = layout.notifier_egress_dropin.parent
    trusted_directory(dropin_root, {0o755}, 0, 0, "MONITOR_NOTIFIER_EGRESS_DROPIN_ROOT_INVALID")
    try:
        if set(os.listdir(dropin_root)) != {layout.notifier_egress_dropin.name}:
            reject("MONITOR_NOTIFIER_EGRESS_UNKNOWN_DROPIN_PRESENT")
    except OSError:
        reject("MONITOR_NOTIFIER_EGRESS_DROPIN_ROOT_INVALID")
    dropin_raw, _ = trusted_file(
        layout.notifier_egress_dropin, {0o444}, 0, 0,
        "MONITOR_NOTIFIER_EGRESS_DROPIN_INVALID", 64 * 1024,
    )
    expected_dropin = ("\n".join([
        "# Managed by chenyida-erp release supervisor; manual edits are forbidden.",
        "[Service]", "IPAddressAllow=", *[f"IPAddressAllow={prefix}" for prefix in allowed], "",
    ])).encode("utf-8")
    if dropin_raw != expected_dropin or sha256(dropin_raw) != systemd["dropin_sha256"]:
        reject("MONITOR_NOTIFIER_EGRESS_DROPIN_INVALID")
    trusted_directory(dropin_root, {0o755}, 0, 0, "MONITOR_NOTIFIER_EGRESS_DROPIN_ROOT_INVALID")
    try:
        if set(os.listdir(dropin_root)) != {layout.notifier_egress_dropin.name}:
            reject("MONITOR_NOTIFIER_EGRESS_UNKNOWN_DROPIN_PRESENT")
    except OSError:
        reject("MONITOR_NOTIFIER_EGRESS_DROPIN_ROOT_INVALID")
    properties = [
        "LoadState", "FragmentPath", "DropInPaths", "Transient", "User", "Group", "PrivateNetwork",
        "NoNewPrivileges", "ProtectSystem", "MemoryDenyWriteExecute", "IPAddressDeny", "IPAddressAllow", "Environment",
    ]
    result = command(["show", NOTIFIER_EGRESS_UNIT, "--no-pager", *[f"--property={name}" for name in properties]])
    if result.returncode != 0 or getattr(result, "stderr", None) not in (b"", None) or not isinstance(result.stdout, bytes) or len(result.stdout) > 64 * 1024:
        reject("MONITOR_NOTIFIER_EGRESS_SYSTEMD_SHOW_FAILED")
    values: dict[str, str] = {}
    try:
        for line in result.stdout.decode("utf-8").splitlines():
            key, separator, value = line.partition("=")
            if separator != "=" or key not in properties or key in values:
                reject("MONITOR_NOTIFIER_EGRESS_EFFECTIVE_UNIT_INVALID")
            values[key] = value
        dropins = shlex.split(values["DropInPaths"], posix=True)
        address_allow = shlex.split(values["IPAddressAllow"], posix=True)
        environment = shlex.split(values["Environment"], posix=True)
    except (KeyError, UnicodeDecodeError, ValueError):
        reject("MONITOR_NOTIFIER_EGRESS_EFFECTIVE_UNIT_INVALID")
    proxy_names = {"http_proxy", "https_proxy", "all_proxy", "no_proxy"}
    if any(item.partition("=")[0].lower() in proxy_names for item in environment):
        reject("MONITOR_NOTIFIER_EGRESS_PROXY_ENVIRONMENT_FORBIDDEN")
    if environment:
        reject("MONITOR_NOTIFIER_EGRESS_ENVIRONMENT_FORBIDDEN")
    observed = {
        "schema_version": 1,
        "contract": "chenyida-erp-monitoring-notifier-egress-effective-unit/v1",
        "unit": NOTIFIER_EGRESS_UNIT,
        "load_state": values["LoadState"],
        "fragment_path": values["FragmentPath"],
        "dropin_paths": dropins,
        "transient": values["Transient"],
        "user": values["User"],
        "group": values["Group"],
        "private_network": values["PrivateNetwork"],
        "no_new_privileges": values["NoNewPrivileges"],
        "protect_system": values["ProtectSystem"],
        "memory_deny_write_execute": values["MemoryDenyWriteExecute"],
        "ip_address_deny": values["IPAddressDeny"],
        "ip_address_allow": address_allow,
        "proxy_environment": [],
    }
    expected = {
        **observed,
        "load_state": "loaded", "fragment_path": str(NOTIFIER_EGRESS_BASE_UNIT), "dropin_paths": [str(NOTIFIER_EGRESS_DROPIN)],
        "transient": "no", "user": "chenyida-monitor-notify", "group": "chenyida-monitor-notify", "private_network": "no",
        "no_new_privileges": "yes", "protect_system": "strict", "memory_deny_write_execute": "yes",
        "ip_address_deny": "any", "ip_address_allow": allowed,
    }
    if canonical_json(observed) != canonical_json(expected) or sha256(canonical_json(expected)) != systemd["effective_unit_sha256"]:
        reject("MONITOR_NOTIFIER_EGRESS_EFFECTIVE_UNIT_INVALID")
    return systemd["effective_unit_sha256"]


def launcher_environment(layout: Layout, active: dict[str, Any], bundle: Path, descriptor: int, phase: str) -> dict[str, str]:
    environment = {
        "PATH": SAFE_PATH,
        "LC_ALL": "C",
        "LANG": "C",
        "TZ": "UTC",
        "HOME": "/nonexistent",
        "ERP_MONITORING_HOST_LAUNCHED": "YES",
        "ERP_MONITORING_LOCK_FD": str(descriptor),
        "ERP_MONITORING_POLICY": str(bundle / POLICY_PATH),
        "ERP_MONITORING_RESOURCE_PLAN": str(bundle / RESOURCE_PLAN_PATH),
        "ERP_MONITORING_PRIVATE_CONFIG": str(layout.private_config),
        "ERP_MONITORING_EVALUATOR_CONFIG": str(layout.view_root / f"{active['private_config_sha256']}.evaluator.json"),
        "ERP_MONITORING_NOTIFIER_CONFIG": str(layout.view_root / f"{active['private_config_sha256']}.notifier.json"),
        "ERP_MONITORING_OBSERVATION_ROOT": str(layout.observation_root),
        "ERP_MONITORING_STATE_ROOT": str(layout.state_root),
        "ERP_MONITORING_OUTBOX_ROOT": str(layout.outbox_root),
        "ERP_MONITORING_DELIVERY_ROOT": str(layout.delivery_root),
        "ERP_MONITORING_NOTIFIER_EGRESS_POLICY": str(layout.notifier_egress_policy),
        "ERP_MONITORING_NOTIFIER_EGRESS_ACTIVATION": str(layout.notifier_egress_activation),
        "ERP_MONITORING_NOTIFIER_EGRESS_EFFECTIVE_UNIT_SHA256": current_notifier_egress_effective_sha256(layout, active) if phase in ("collector", "notifier") else ZERO_SHA256,
    }
    if phase == "notifier":
        trusted_file(layout.notifier_egress_policy, {0o440}, 0, active["notifier_gid"], "MONITOR_NOTIFIER_EGRESS_POLICY_INVALID", 256 * 1024)
        trusted_file(layout.notifier_egress_activation, {0o440}, 0, active["notifier_gid"], "MONITOR_NOTIFIER_EGRESS_ACTIVATION_INVALID", 256 * 1024)
        credential_directory = os.environ.get("CREDENTIALS_DIRECTORY", "")
        if not credential_directory.startswith("/run/credentials/") or os.path.normpath(credential_directory) != credential_directory:
            reject("MONITOR_CREDENTIAL_DIRECTORY_INVALID")
        environment["CREDENTIALS_DIRECTORY"] = credential_directory
    return environment


def parse_cli(arguments: list[str]) -> str:
    if len(arguments) != 1 or arguments[0] not in ("collector", "evaluator", "notifier", "continuity"):
        reject("MONITOR_LAUNCHER_ARGUMENT_INVALID")
    return arguments[0]


def main() -> None:
    phase = parse_cli(sys.argv[1:])
    layout = Layout()
    if Path(os.path.realpath(sys.argv[0])) != layout.launcher_path:
        reject("MONITOR_LAUNCHER_PATH_INVALID")
    active, bundle, runtime = verify_activation(layout)
    expected_uid, expected_gid = phase_identity(active, phase)
    if os.getuid() != expected_uid or os.getgid() != expected_gid:
        reject("MONITOR_LAUNCHER_IDENTITY_INVALID")
    descriptor = acquire_lock(layout, active, phase)
    runner = bundle / HOST_RUNNER_PATH
    command = [str(runtime), "--jitless", str(runner), phase]
    os.execve(command[0], command, launcher_environment(layout, active, bundle, descriptor, phase))


if __name__ == "__main__":
    try:
        main()
    except MonitoringLauncherError as error:
        print(error.code, file=sys.stderr)
        raise SystemExit(1) from None
    except Exception:
        print("MONITOR_LAUNCHER_INTERNAL_ERROR", file=sys.stderr)
        raise SystemExit(1) from None
