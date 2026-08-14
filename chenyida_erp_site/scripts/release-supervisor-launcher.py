#!/usr/bin/python3
"""Root-owned, content-addressed launcher for exact ERP release operations."""

from __future__ import annotations

import hashlib
import fcntl
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


SUPERVISOR_BASE = Path("/usr/local/libexec/chenyida-erp-release-supervisor")
BUNDLES_ROOT = SUPERVISOR_BASE / "bundles"
LAUNCHER_PATH = Path("/usr/local/sbin/chenyida-erp-release-supervisor-v1")
AUTHORIZATION_ROOT = Path("/var/lib/chenyida-erp/release-authorizations")
AUTHORIZATION_PENDING_ROOT = AUTHORIZATION_ROOT / "pending"
AUTHORIZATION_CONSUMED_ROOT = AUTHORIZATION_ROOT / "consumed"
RELEASE_ARTIFACT_ROOT_BASE = Path("/var/lib/chenyida-erp/release-artifacts")
POSTDEPLOY_ROOT_BASE = Path("/var/lib/chenyida-erp/postdeploy")
RELEASE_IDENTITY_ROOT = Path("/var/lib/chenyida-erp/release-identity")
RUNTIME_PROBE_ROOT = Path("/var/lib/chenyida-erp/runtime-probes")
BUNDLE_CONTRACT = "chenyida-erp-release-supervisor-bundle/v1"
AUTHORIZATION_CONTRACT = "chenyida-erp-release-supervisor-authorization/v2"
RUNTIME_PRIVILEGE_AUTHORIZATION_CONTRACT = "chenyida-erp-release-supervisor-authorization/v3"
RUNTIME_GUARD_CONTRACT = "chenyida-erp-release-runtime-guard/v1"
PRE_DEPLOY_RUNTIME_GUARD_MODE = "PRE_DEPLOY_EXISTING_RUNTIME_STABILITY"
POST_DEPLOY_RUNTIME_GUARD_MODE = "POST_DEPLOY_CURRENT_RUNTIME_STRICT"
PRE_DEPLOY_POSTGRESQL_BOOTSTRAP_GUARD_MODE = "PRE_DEPLOY_POSTGRESQL_BOOTSTRAP_BOUND"
RUNTIME_COMPOSE_PROJECT = "chenyida-erp"
RUNTIME_POLICY_SHA256 = "e4920820ed954c2689e3de53dea9b7f36945969c8287b06d87a3871e7d3ecf00"
RUNTIME_SECRET_POLICY_SHA256 = "8dd07c6acd6e857a0b29b14e2b6d5b60ad919cf54aac9b552ce11672eb45b7c5"
RUNTIME_PROBE_CONTRACT = "chenyida-erp-postdeploy-runtime-configuration-probe/v1"
RUNTIME_PRIVILEGE_STATE_ROOT = Path("/var/lib/chenyida-erp/postgresql-runtime-privilege-operator")
RUNTIME_SECRET_ROOT = Path("/etc/chenyida-erp/runtime-secrets")
RUNTIME_PRIVILEGE_BACKUP_ROOT = Path("/var/backups/chenyida-erp-v2")
RUNTIME_PRIVILEGE_NODE_IMAGE = "node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3"
GLOBAL_RELEASE_LOCK = Path("/run/lock/chenyida-erp-release-gate-v1.lock")
SAFE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
MAX_JSON_BYTES = 1024 * 1024
MAX_BUNDLE_FILE_BYTES = 8 * 1024 * 1024
MAX_BUNDLE_BYTES = 32 * 1024 * 1024
SHA256 = re.compile(r"^[0-9a-f]{64}$")
GIT_OBJECT = re.compile(r"^[0-9a-f]{40}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
IMAGE_REFERENCE = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[0-9a-f]{64}$")
ISO_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")

BUNDLE_FILES: dict[str, str] = {
    "chenyida_erp_site/operations/container-runtime-policy-v1.json": "0444",
    "chenyida_erp_site/operations/postgresql-runtime-privilege-access-v2.json": "0444",
    "chenyida_erp_site/operations/postgresql-runtime-privilege-compiled-catalog-v1.json": "0444",
    "chenyida_erp_site/operations/postgresql-runtime-privilege-operator-policy-v1.json": "0444",
    "chenyida_erp_site/operations/postgresql-runtime-privilege-policy-v2.json": "0444",
    "chenyida_erp_site/operations/runtime-secret-file-policy-v1.json": "0444",
    "chenyida_erp_site/release/release-gate-plan-v2.json": "0444",
    "chenyida_erp_site/release/release-test-inventory-v1.json": "0444",
    "chenyida_erp_site/release/test-runtime-policy-v1.json": "0444",
    "chenyida_erp_site/release/vulnerability-policy-v1.json": "0444",
    "chenyida_erp_site/scripts/check-credentials.mjs": "0444",
    "chenyida_erp_site/scripts/backup-recovery-contract.mjs": "0444",
    "chenyida_erp_site/scripts/container-runtime-policy-test.py": "0444",
    "chenyida_erp_site/scripts/container-runtime-policy.py": "0444",
    "chenyida_erp_site/scripts/create-release-image-evidence.sh": "0555",
    "chenyida_erp_site/scripts/create-release-manifest.sh": "0555",
    "chenyida_erp_site/scripts/create-release-supervisor-bundle-manifest.py": "0555",
    "chenyida_erp_site/scripts/install-release-supervisor.py": "0444",
    "chenyida_erp_site/scripts/postdeploy-release-contract.mjs": "0444",
    "chenyida_erp_site/scripts/postdeploy-release-verifier.mjs": "0444",
    "chenyida_erp_site/scripts/postdeploy-runtime-configuration-probe.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-cluster-recovery-contract.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-runtime-privilege-catalog.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-runtime-privilege-catalog.sql": "0444",
    "chenyida_erp_site/scripts/postgresql-runtime-privilege-interlock.sh": "0444",
    "chenyida_erp_site/scripts/postgresql-runtime-privilege-journal.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-runtime-privilege-operator.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-runtime-privilege-policy.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-runtime-privilege-reconciler.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-runtime-privilege-runner.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-runtime-privilege-source.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-runtime-privilege-state.sql": "0444",
    "chenyida_erp_site/scripts/probe-postdeploy-runtime-configuration.sh": "0555",
    "chenyida_erp_site/scripts/publish-release-identity-from-manifest.mjs": "0444",
    "chenyida_erp_site/scripts/release-browser-e2e-runner.mjs": "0444",
    "chenyida_erp_site/scripts/release-gate-runner.mjs": "0444",
    "chenyida_erp_site/scripts/release-gate-lock.sh": "0444",
    "chenyida_erp_site/scripts/release-identity-contract.mjs": "0444",
    "chenyida_erp_site/scripts/release-image-evidence-contract.mjs": "0444",
    "chenyida_erp_site/scripts/release-image-evidence-producer.mjs": "0444",
    "chenyida_erp_site/scripts/release-lifecycle-contract.mjs": "0444",
    "chenyida_erp_site/scripts/release-manifest-contract.mjs": "0444",
    "chenyida_erp_site/scripts/release-migration-authorization.ts": "0444",
    "chenyida_erp_site/scripts/release-postgres-regression-runner.mjs": "0444",
    "chenyida_erp_site/scripts/release-supervisor-launcher.py": "0444",
    "chenyida_erp_site/scripts/release-test-inventory.mjs": "0444",
    "chenyida_erp_site/scripts/runtime-secret-file-policy.py": "0444",
    "chenyida_erp_site/scripts/run-backup-recovery-postgres-test.sh": "0555",
    "chenyida_erp_site/scripts/run-compose-config-test.sh": "0555",
    "chenyida_erp_site/scripts/run-container-runtime-policy-test.sh": "0555",
    "chenyida_erp_site/scripts/run-python-baseline-test.sh": "0555",
    "chenyida_erp_site/scripts/run-release-browser-tests.sh": "0555",
    "chenyida_erp_site/scripts/run-release-gate.sh": "0555",
    "chenyida_erp_site/scripts/run-release-migration-postgres-test.sh": "0555",
    "chenyida_erp_site/scripts/run-release-node-sandbox.sh": "0555",
    "chenyida_erp_site/scripts/run-release-postgres-regression-tests.sh": "0555",
    "chenyida_erp_site/scripts/run-source-diff-check.sh": "0555",
    "chenyida_erp_site/scripts/write-release-identity.sh": "0555",
    "chenyida_erp_site/tests/release-gate-fixture.mjs": "0444",
    "chenyida_erp_site/tests/runtime-privilege-operator-postgres-fixture.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-release-gate-contract.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-release-identity-contract.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-release-image-evidence-producer.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-release-manifest-contract.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-release-migration-allowlist.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-postdeploy-runtime-configuration-probe.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-backup-recovery-postgres.sh": "0555",
    "chenyida_erp_site/tests/selfhost-postgresql-cluster-recovery-postgres.sh": "0555",
    "chenyida_erp_site/tests/selfhost-postgresql-runtime-privilege-catalog-postgres.sh": "0555",
    "chenyida_erp_site/tests/selfhost-postgresql-runtime-privilege-operator.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-postgresql-runtime-privilege-policy.test.mjs": "0444",
    "chenyida_erp_site/tests/test_release_supervisor_browser.py": "0444",
    "chenyida_erp_site/tests/test_release_supervisor_container_runtime.py": "0444",
    "chenyida_erp_site/tests/test_release_supervisor_installer.py": "0444",
    "chenyida_erp_site/tests/test_release_supervisor_launcher.py": "0444",
    "chenyida_erp_site/tests/test_release_supervisor_runtime_secret_file.py": "0444",
}

ENTRYPOINTS = {
    "CREATE_IMAGE_EVIDENCE": "chenyida_erp_site/scripts/create-release-image-evidence.sh",
    "RUN_RELEASE_GATE": "chenyida_erp_site/scripts/run-release-gate.sh",
    "CREATE_RELEASE_MANIFEST": "chenyida_erp_site/scripts/create-release-manifest.sh",
    "PROBE_POST_DEPLOY_RUNTIME_CONFIGURATION": "chenyida_erp_site/scripts/probe-postdeploy-runtime-configuration.sh",
    "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY": "chenyida_erp_site/scripts/write-release-identity.sh",
}

CONFIRMATIONS = {
    "CREATE_IMAGE_EVIDENCE": "AUTHORIZE_CREATE_TRIVY_IMAGE_EVIDENCE",
    "RUN_RELEASE_GATE": "AUTHORIZE_RUN_EXACT_RELEASE_GATE",
    "CREATE_RELEASE_MANIFEST": "AUTHORIZE_CREATE_IMMUTABLE_RELEASE_MANIFEST",
    "PROBE_POST_DEPLOY_RUNTIME_CONFIGURATION": "AUTHORIZE_PROBE_EXACT_POST_DEPLOY_RUNTIME_CONFIGURATION",
    "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY": "AUTHORIZE_VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY",
}

RUNTIME_PRIVILEGE_OPERATIONS = {
    "BOOTSTRAP_POSTGRESQL_RUNTIME_PRIVILEGES": "BOOTSTRAP",
    "RECONCILE_POSTGRESQL_RUNTIME_PRIVILEGES": "RECONCILE",
    "RECOVER_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT": "RECOVER",
}

RUNTIME_PRIVILEGE_CONFIRMATIONS = {
    "BOOTSTRAP_POSTGRESQL_RUNTIME_PRIVILEGES": "AUTHORIZE_BOOTSTRAP_EXACT_POSTGRESQL_RUNTIME_PRIVILEGES",
    "RECONCILE_POSTGRESQL_RUNTIME_PRIVILEGES": "AUTHORIZE_RECONCILE_EXACT_POSTGRESQL_RUNTIME_PRIVILEGES",
    "RECOVER_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT": "AUTHORIZE_RECOVER_EXACT_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT",
}

RUNTIME_PRIVILEGE_BASE_PARAMETER_FIELDS = {
    "backup_root", "backup_credential_root", "backup_capture_service_file", "backup_capture_service",
    "compose_project_root", "credential_generation_id", "deployment_class", "deployment_id",
    "expected_database", "expected_database_marker", "expected_database_oid", "expected_system_identifier",
    "postgres_container", "postgres_container_id", "release_manifest", "release_manifest_sha256", "runtime_configuration_sha256",
    "runtime_guard_mode", "runtime_policy_sha256",
}

RUNTIME_PRIVILEGE_POSTDEPLOY_PARAMETER_FIELDS = RUNTIME_PRIVILEGE_BASE_PARAMETER_FIELDS | {
    "runtime_probe_receipt", "runtime_probe_receipt_sha256",
}

RUNTIME_PRIVILEGE_RECOVERY_PARAMETER_FIELDS = {
    "expected_intent_sha256", "original_authorization_sha256", "original_operation", "original_operation_id",
}

PARAMETER_FIELDS = {
    "CREATE_IMAGE_EVIDENCE": {
        "repository_root", "git_commit", "git_tree", "artifact_root", "run_id",
        "web_image", "worker_image", "trivy_db_directory",
    },
    "RUN_RELEASE_GATE": {
        "repository_root", "git_commit", "git_tree", "artifact_root", "run_id",
        "runtime_guard_contract", "runtime_guard_mode", "gate_plan_sha256",
        "web_image", "worker_image", "sbom_evidence", "security_evidence",
    },
    "CREATE_RELEASE_MANIFEST": {
        "repository_root", "git_commit", "git_tree", "artifact_root", "release_id",
        "deployment_class", "web_image", "worker_image", "gate_plan", "gate_report",
        "sbom_evidence", "security_evidence", "expires_at", "runtime_guard_contract",
        "runtime_guard_mode", "gate_plan_sha256",
    },
    "PROBE_POST_DEPLOY_RUNTIME_CONFIGURATION": {
        "release_manifest", "release_manifest_sha256", "probe_root", "probe_id", "reader_gid",
        "runtime_guard_contract", "runtime_guard_mode", "runtime_policy_sha256", "deployment_class", "deployment_id", "compose_project",
        "compose_project_root", "caddy_container", "postgres_container", "web_container", "worker_container",
    },
    "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY": {
        "release_manifest", "release_manifest_sha256", "postdeploy_root", "identity_root", "reader_gid", "run_id",
        "runtime_guard_contract", "runtime_guard_mode", "runtime_policy_sha256", "deployment_class", "deployment_id", "compose_project",
        "runtime_configuration_sha256", "runtime_probe_receipt", "runtime_probe_receipt_sha256", "compose_project_root",
        "caddy_container", "postgres_container", "web_container", "worker_container",
    },
}


class SupervisorError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def reject(code: str) -> None:
    raise SupervisorError(code)


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def strict_json(raw: bytes, code: str) -> Any:
    if len(raw) < 2 or len(raw) > MAX_JSON_BYTES:
        reject(code)

    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        value: dict[str, Any] = {}
        for key, item in items:
            if key in value:
                reject(code)
            value[key] = item
        return value

    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_constant=lambda _: reject(code))
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError):
        reject(code)


def exact_fields(value: Any, expected: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        reject(code)
    return value


def trusted_regular_file(path: Path, mode: int, maximum: int = MAX_JSON_BYTES, code: str = "SUPERVISOR_FILE_INVALID") -> tuple[bytes, os.stat_result]:
    if not path.is_absolute() or path == Path("/"):
        reject(code)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError:
        reject(code)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_gid != 0 or before.st_nlink != 1 or stat.S_IMODE(before.st_mode) != mode or before.st_size < 1 or before.st_size > maximum:
            reject(code)
        chunks: list[bytes] = []
        remaining = before.st_size
        while remaining:
            chunk = os.read(descriptor, min(1024 * 1024, remaining))
            if not chunk:
                reject(code)
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
        after = os.fstat(descriptor)
        path_stat = os.lstat(path)
        identity_before = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
        identity_after = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
        if identity_before != identity_after or path_stat.st_dev != before.st_dev or path_stat.st_ino != before.st_ino or path_stat.st_nlink != 1 or stat.S_ISLNK(path_stat.st_mode):
            reject(code)
        return raw, before
    finally:
        os.close(descriptor)


def trusted_directory(path: Path, allowed_modes: set[int], code: str) -> os.stat_result:
    try:
        value = os.lstat(path)
    except OSError:
        reject(code)
    if not path.is_absolute() or path == Path("/") or not stat.S_ISDIR(value.st_mode) or stat.S_ISLNK(value.st_mode) or value.st_uid != 0 or value.st_gid != 0 or stat.S_IMODE(value.st_mode) not in allowed_modes:
        reject(code)
    return value


def safe_relative(value: Any, code: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 240 or value.startswith("/") or "\\" in value or any(part in ("", ".", "..") for part in value.split("/")) or not re.fullmatch(r"[A-Za-z0-9._/-]+", value):
        reject(code)
    return value


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def validate_bundle_manifest(value: Any) -> dict[str, Any]:
    value = exact_fields(value, {"schema_version", "contract", "bundle_version", "source_commit", "source_tree", "launcher_sha256", "files"}, "SUPERVISOR_BUNDLE_FIELDS_INVALID")
    if value["schema_version"] != 1 or value["contract"] != BUNDLE_CONTRACT or value["bundle_version"] != 1:
        reject("SUPERVISOR_BUNDLE_VERSION_INVALID")
    if not isinstance(value["source_commit"], str) or not GIT_OBJECT.fullmatch(value["source_commit"]) or not isinstance(value["source_tree"], str) or not GIT_OBJECT.fullmatch(value["source_tree"]) or not isinstance(value["launcher_sha256"], str) or not SHA256.fullmatch(value["launcher_sha256"]):
        reject("SUPERVISOR_BUNDLE_SOURCE_INVALID")
    if not isinstance(value["files"], list) or len(value["files"]) != len(BUNDLE_FILES):
        reject("SUPERVISOR_BUNDLE_FILES_INVALID")
    previous = ""
    seen: set[str] = set()
    total_bytes = 0
    for entry in value["files"]:
        entry = exact_fields(entry, {"path", "sha256", "bytes", "mode"}, "SUPERVISOR_BUNDLE_FILE_FIELDS_INVALID")
        relative = safe_relative(entry["path"], "SUPERVISOR_BUNDLE_FILE_PATH_INVALID")
        if relative <= previous or relative in seen or relative not in BUNDLE_FILES or entry["mode"] != BUNDLE_FILES[relative]:
            reject("SUPERVISOR_BUNDLE_FILE_ORDER_INVALID")
        if not isinstance(entry["sha256"], str) or not SHA256.fullmatch(entry["sha256"]) or not isinstance(entry["bytes"], int) or isinstance(entry["bytes"], bool) or entry["bytes"] < 1 or entry["bytes"] > MAX_BUNDLE_FILE_BYTES:
            reject("SUPERVISOR_BUNDLE_FILE_IDENTITY_INVALID")
        total_bytes += entry["bytes"]
        if total_bytes > MAX_BUNDLE_BYTES:
            reject("SUPERVISOR_BUNDLE_TOTAL_BYTES_INVALID")
        previous = relative
        seen.add(relative)
    if seen != set(BUNDLE_FILES):
        reject("SUPERVISOR_BUNDLE_FILES_INVALID")
    return value


def _verify_bundle(bundle_root: Path, expected_digest: str, launcher_path: Path, staging: bool) -> dict[str, Any]:
    if not SHA256.fullmatch(expected_digest):
        reject("SUPERVISOR_BUNDLE_PATH_INVALID")
    if staging:
        if not re.fullmatch(rf"\.{expected_digest}\.staging-[a-z0-9_]{{8}}", bundle_root.name):
            reject("SUPERVISOR_BUNDLE_PATH_INVALID")
    elif bundle_root.name != expected_digest:
        reject("SUPERVISOR_BUNDLE_PATH_INVALID")
    trusted_directory(bundle_root, {0o555}, "SUPERVISOR_BUNDLE_ROOT_INVALID")
    manifest_path = bundle_root / "bundle-manifest.json"
    raw, _ = trusted_regular_file(manifest_path, 0o444, code="SUPERVISOR_BUNDLE_MANIFEST_INVALID")
    if sha256(raw) != expected_digest:
        reject("SUPERVISOR_BUNDLE_DIGEST_MISMATCH")
    manifest = validate_bundle_manifest(strict_json(raw, "SUPERVISOR_BUNDLE_MANIFEST_INVALID"))
    if raw != canonical_json(manifest):
        reject("SUPERVISOR_BUNDLE_MANIFEST_NOT_CANONICAL")
    launcher_raw, _ = trusted_regular_file(launcher_path, 0o555, maximum=4 * 1024 * 1024, code="SUPERVISOR_LAUNCHER_INVALID")
    if sha256(launcher_raw) != manifest["launcher_sha256"]:
        reject("SUPERVISOR_LAUNCHER_DIGEST_MISMATCH")

    actual_files: set[str] = set()
    for directory, names, files in os.walk(bundle_root, topdown=True, followlinks=False):
        directory_path = Path(directory)
        trusted_directory(directory_path, {0o555}, "SUPERVISOR_BUNDLE_DIRECTORY_INVALID")
        for name in names:
            trusted_directory(directory_path / name, {0o555}, "SUPERVISOR_BUNDLE_DIRECTORY_INVALID")
        for name in files:
            file = directory_path / name
            relative = file.relative_to(bundle_root).as_posix()
            if relative != "bundle-manifest.json":
                actual_files.add(relative)
    if actual_files != set(BUNDLE_FILES):
        reject("SUPERVISOR_BUNDLE_EXTRA_OR_MISSING_FILE")
    by_path = {entry["path"]: entry for entry in manifest["files"]}
    for relative, expected_mode in BUNDLE_FILES.items():
        entry = by_path[relative]
        raw_file, file_stat = trusted_regular_file(bundle_root / relative, int(expected_mode, 8), maximum=MAX_BUNDLE_FILE_BYTES, code="SUPERVISOR_BUNDLE_FILE_INVALID")
        if len(raw_file) != entry["bytes"] or sha256(raw_file) != entry["sha256"] or stat.S_IMODE(file_stat.st_mode) != int(entry["mode"], 8):
            reject("SUPERVISOR_BUNDLE_FILE_DIGEST_MISMATCH")
    return manifest


def verify_bundle(bundle_root: Path, expected_digest: str, launcher_path: Path = LAUNCHER_PATH) -> dict[str, Any]:
    return _verify_bundle(bundle_root, expected_digest, launcher_path, False)


def verify_staged_bundle(bundle_root: Path, expected_digest: str, launcher_path: Path = LAUNCHER_PATH) -> dict[str, Any]:
    return _verify_bundle(bundle_root, expected_digest, launcher_path, True)


def parse_time(value: Any, code: str) -> datetime:
    if not isinstance(value, str) or not ISO_UTC.fullmatch(value):
        reject(code)
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except ValueError:
        reject(code)


def absolute_path(value: Any, code: str) -> str:
    if not isinstance(value, str) or len(value) > 4096 or not value.startswith("/") or value == "/" or os.path.normpath(value) != value:
        reject(code)
    return value


def validate_parameters(operation: str, parameters: Any) -> dict[str, Any]:
    parameters = exact_fields(parameters, PARAMETER_FIELDS[operation], "SUPERVISOR_AUTHORIZATION_PARAMETERS_INVALID")
    for key in ("artifact_root", "postdeploy_root", "identity_root", "release_manifest", "probe_root", "runtime_probe_receipt", "gate_plan", "gate_report", "sbom_evidence", "security_evidence", "trivy_db_directory", "repository_root", "compose_project_root"):
        if key in parameters:
            absolute_path(parameters[key], "SUPERVISOR_AUTHORIZATION_PATH_INVALID")
    for key in ("run_id", "probe_id", "release_id", "deployment_id", "compose_project", "caddy_container", "postgres_container", "web_container", "worker_container"):
        if key in parameters and (not isinstance(parameters[key], str) or not IDENTIFIER.fullmatch(parameters[key])):
            reject("SUPERVISOR_AUTHORIZATION_IDENTIFIER_INVALID")
    for key in ("web_image", "worker_image"):
        if key in parameters and (not isinstance(parameters[key], str) or not IMAGE_REFERENCE.fullmatch(parameters[key])):
            reject("SUPERVISOR_AUTHORIZATION_IMAGE_INVALID")
    if "web_image" in parameters and parameters["web_image"] == parameters["worker_image"]:
        reject("SUPERVISOR_AUTHORIZATION_IMAGE_INVALID")
    for key in ("git_commit", "git_tree"):
        if key in parameters and (not isinstance(parameters[key], str) or not GIT_OBJECT.fullmatch(parameters[key])):
            reject("SUPERVISOR_AUTHORIZATION_GIT_INVALID")
    for key in ("release_manifest_sha256", "runtime_probe_receipt_sha256", "gate_plan_sha256", "runtime_policy_sha256", "runtime_configuration_sha256"):
        if key in parameters and (not isinstance(parameters[key], str) or not SHA256.fullmatch(parameters[key])):
            reject("SUPERVISOR_AUTHORIZATION_DIGEST_INVALID")
    if "reader_gid" in parameters and (not isinstance(parameters["reader_gid"], int) or isinstance(parameters["reader_gid"], bool) or parameters["reader_gid"] < 1 or parameters["reader_gid"] > 2**31 - 1):
        reject("SUPERVISOR_AUTHORIZATION_GID_INVALID")
    if "deployment_class" in parameters and parameters["deployment_class"] not in ("UAT", "PRODUCTION"):
        reject("SUPERVISOR_AUTHORIZATION_DEPLOYMENT_CLASS_INVALID")
    if "expires_at" in parameters:
        parse_time(parameters["expires_at"], "SUPERVISOR_AUTHORIZATION_RELEASE_EXPIRY_INVALID")
    if "runtime_guard_contract" in parameters and parameters["runtime_guard_contract"] != RUNTIME_GUARD_CONTRACT:
        reject("SUPERVISOR_AUTHORIZATION_RUNTIME_GUARD_INVALID")
    if operation in ("RUN_RELEASE_GATE", "CREATE_RELEASE_MANIFEST") and parameters.get("runtime_guard_mode") != PRE_DEPLOY_RUNTIME_GUARD_MODE:
        reject("SUPERVISOR_AUTHORIZATION_RUNTIME_GUARD_INVALID")
    if operation in ("PROBE_POST_DEPLOY_RUNTIME_CONFIGURATION", "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY"):
        identifier_field = "probe_id" if operation == "PROBE_POST_DEPLOY_RUNTIME_CONFIGURATION" else "run_id"
        if len(parameters[identifier_field]) > 101:
            reject("SUPERVISOR_AUTHORIZATION_IDENTIFIER_INVALID")
        if parameters.get("runtime_guard_mode") != POST_DEPLOY_RUNTIME_GUARD_MODE or parameters.get("runtime_policy_sha256") != RUNTIME_POLICY_SHA256:
            reject("SUPERVISOR_AUTHORIZATION_RUNTIME_GUARD_INVALID")
        if parameters["deployment_id"] != RUNTIME_COMPOSE_PROJECT or parameters["compose_project"] != RUNTIME_COMPOSE_PROJECT or len({parameters["caddy_container"], parameters["postgres_container"], parameters["web_container"], parameters["worker_container"]}) != 4:
            reject("SUPERVISOR_AUTHORIZATION_DEPLOYMENT_IDENTITY_INVALID")
        manifest = Path(parameters["release_manifest"])
        if manifest.parent.parent != RELEASE_ARTIFACT_ROOT_BASE:
            reject("SUPERVISOR_AUTHORIZATION_POSTDEPLOY_PATH_INVALID")
    if operation == "PROBE_POST_DEPLOY_RUNTIME_CONFIGURATION":
        if Path(parameters["probe_root"]) != RUNTIME_PROBE_ROOT:
            reject("SUPERVISOR_AUTHORIZATION_POSTDEPLOY_PATH_INVALID")
    if operation == "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY":
        postdeploy = Path(parameters["postdeploy_root"])
        probe_receipt = Path(parameters["runtime_probe_receipt"])
        if postdeploy.parent != POSTDEPLOY_ROOT_BASE or postdeploy.name != parameters["run_id"] or Path(parameters["identity_root"]) != RELEASE_IDENTITY_ROOT \
            or probe_receipt.parent != RUNTIME_PROBE_ROOT or not probe_receipt.name.endswith(".runtime-configuration-probe.json"):
            reject("SUPERVISOR_AUTHORIZATION_POSTDEPLOY_PATH_INVALID")
    return parameters


def validate_runtime_privilege_parameters(parameters: Any, operation: str | None = None) -> dict[str, Any]:
    recovery = operation == "RECOVER_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT"
    if recovery:
        if not isinstance(parameters, dict) or parameters.get("original_operation") not in ("BOOTSTRAP", "RECONCILE"):
            reject("SUPERVISOR_RUNTIME_PRIVILEGE_OPERATION_INVALID")
        effective_operation = parameters["original_operation"]
    else:
        effective_operation = RUNTIME_PRIVILEGE_OPERATIONS.get(operation or "")
    if effective_operation not in ("BOOTSTRAP", "RECONCILE"):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_OPERATION_INVALID")
    expected_fields = set(RUNTIME_PRIVILEGE_BASE_PARAMETER_FIELDS)
    if effective_operation == "RECONCILE":
        expected_fields |= RUNTIME_PRIVILEGE_POSTDEPLOY_PARAMETER_FIELDS - RUNTIME_PRIVILEGE_BASE_PARAMETER_FIELDS
    if recovery:
        expected_fields |= RUNTIME_PRIVILEGE_RECOVERY_PARAMETER_FIELDS
    parameters = exact_fields(parameters, expected_fields, "SUPERVISOR_RUNTIME_PRIVILEGE_PARAMETERS_INVALID")
    path_fields = ["backup_root", "backup_credential_root", "backup_capture_service_file", "compose_project_root", "release_manifest"]
    if effective_operation == "RECONCILE":
        path_fields.append("runtime_probe_receipt")
    for field in path_fields:
        absolute_path(parameters[field], "SUPERVISOR_RUNTIME_PRIVILEGE_PATH_INVALID")
    for field in ("backup_capture_service", "credential_generation_id", "deployment_id", "postgres_container"):
        if not isinstance(parameters[field], str) or not IDENTIFIER.fullmatch(parameters[field]):
            reject("SUPERVISOR_RUNTIME_PRIVILEGE_IDENTIFIER_INVALID")
    digest_fields = ["postgres_container_id", "release_manifest_sha256", "runtime_configuration_sha256", "runtime_policy_sha256"]
    if effective_operation == "RECONCILE":
        digest_fields.append("runtime_probe_receipt_sha256")
    for field in digest_fields:
        if not isinstance(parameters[field], str) or not SHA256.fullmatch(parameters[field]):
            reject("SUPERVISOR_RUNTIME_PRIVILEGE_DIGEST_INVALID")
    if parameters["deployment_class"] not in ("UAT", "PRODUCTION") or parameters["deployment_id"] != RUNTIME_COMPOSE_PROJECT:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_DEPLOYMENT_INVALID")
    if recovery:
        if not isinstance(parameters["original_operation_id"], str) or not IDENTIFIER.fullmatch(parameters["original_operation_id"]):
            reject("SUPERVISOR_RUNTIME_PRIVILEGE_IDENTIFIER_INVALID")
        for field in ("expected_intent_sha256", "original_authorization_sha256"):
            if not isinstance(parameters[field], str) or not SHA256.fullmatch(parameters[field]):
                reject("SUPERVISOR_RUNTIME_PRIVILEGE_DIGEST_INVALID")
    if parameters["runtime_policy_sha256"] != RUNTIME_POLICY_SHA256 or parameters["expected_database"] != "chenyida_erp":
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_TARGET_INVALID")
    expected_guard_mode = PRE_DEPLOY_POSTGRESQL_BOOTSTRAP_GUARD_MODE if effective_operation == "BOOTSTRAP" else POST_DEPLOY_RUNTIME_GUARD_MODE
    if parameters["runtime_guard_mode"] != expected_guard_mode:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RUNTIME_GUARD_INVALID")
    if Path(parameters["backup_root"]) != RUNTIME_PRIVILEGE_BACKUP_ROOT:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_BACKUP_ROOT_INVALID")
    backup_credential_root = Path(parameters["backup_credential_root"])
    backup_capture_file = Path(parameters["backup_capture_service_file"])
    if backup_capture_file.parent != backup_credential_root or backup_capture_file.name == ".chenyida-erp-credential-root-v2":
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_BACKUP_CREDENTIAL_INVALID")
    manifest = Path(parameters["release_manifest"])
    if manifest.name != "release-manifest.json" or manifest.parent.parent != RELEASE_ARTIFACT_ROOT_BASE:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RELEASE_MANIFEST_INVALID")
    if not isinstance(parameters["expected_database_oid"], str) or not re.fullmatch(r"[1-9][0-9]{0,9}", parameters["expected_database_oid"]):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_TARGET_INVALID")
    if not isinstance(parameters["expected_system_identifier"], str) or not re.fullmatch(r"[1-9][0-9]{9,29}", parameters["expected_system_identifier"]):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_TARGET_INVALID")
    expected_marker = f"chenyida-erp-deployment/v2:{parameters['deployment_class']}:{parameters['deployment_id']}"
    if parameters["expected_database_marker"] != expected_marker:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_TARGET_INVALID")
    if effective_operation == "RECONCILE":
        receipt = Path(parameters["runtime_probe_receipt"])
        if receipt.parent != RUNTIME_PROBE_ROOT or not receipt.name.endswith(".runtime-configuration-probe.json"):
            reject("SUPERVISOR_RUNTIME_PRIVILEGE_PATH_INVALID")
    return parameters


def validate_authorization(value: Any, expected_bundle_digest: str, now: datetime) -> dict[str, Any]:
    value = exact_fields(value, {"schema_version", "contract", "authorization_id", "created_at", "expires_at", "supervisor_bundle_sha256", "operation", "parameters", "nonce", "confirmation"}, "SUPERVISOR_AUTHORIZATION_FIELDS_INVALID")
    is_v2 = value["schema_version"] == 2 and value["contract"] == AUTHORIZATION_CONTRACT
    is_v3 = value["schema_version"] == 3 and value["contract"] == RUNTIME_PRIVILEGE_AUTHORIZATION_CONTRACT
    if not is_v2 and not is_v3:
        reject("SUPERVISOR_AUTHORIZATION_VERSION_INVALID")
    if not isinstance(value["authorization_id"], str) or not IDENTIFIER.fullmatch(value["authorization_id"]):
        reject("SUPERVISOR_AUTHORIZATION_ID_INVALID")
    if not isinstance(value["supervisor_bundle_sha256"], str) or value["supervisor_bundle_sha256"] != expected_bundle_digest:
        reject("SUPERVISOR_AUTHORIZATION_BUNDLE_MISMATCH")
    operation = value["operation"]
    if is_v2:
        if operation not in ENTRYPOINTS or value["confirmation"] != CONFIRMATIONS[operation]:
            reject("SUPERVISOR_AUTHORIZATION_OPERATION_INVALID")
    elif operation not in RUNTIME_PRIVILEGE_OPERATIONS or value["confirmation"] != RUNTIME_PRIVILEGE_CONFIRMATIONS[operation]:
        reject("SUPERVISOR_AUTHORIZATION_OPERATION_INVALID")
    if not isinstance(value["nonce"], str) or not SHA256.fullmatch(value["nonce"]):
        reject("SUPERVISOR_AUTHORIZATION_NONCE_INVALID")
    created = parse_time(value["created_at"], "SUPERVISOR_AUTHORIZATION_TIME_INVALID")
    expires = parse_time(value["expires_at"], "SUPERVISOR_AUTHORIZATION_TIME_INVALID")
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    now = now.astimezone(timezone.utc)
    if created > now + timedelta(minutes=5) or now >= expires or expires <= created or expires - created > timedelta(hours=24) or now - created > timedelta(hours=24):
        reject("SUPERVISOR_AUTHORIZATION_TIME_INVALID")
    if is_v2:
        validate_parameters(operation, value["parameters"])
    else:
        validate_runtime_privilege_parameters(value["parameters"], operation)
        if operation == "RECOVER_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT" and value["authorization_id"] == value["parameters"]["original_operation_id"]:
            reject("SUPERVISOR_RUNTIME_PRIVILEGE_IDENTIFIER_INVALID")
    return value


def load_authorization(path: Path, expected_bundle_digest: str, pending_root: Path = AUTHORIZATION_PENDING_ROOT, now: datetime | None = None) -> tuple[dict[str, Any], str, bytes]:
    if pending_root == AUTHORIZATION_PENDING_ROOT:
        trusted_directory(AUTHORIZATION_ROOT, {0o700}, "SUPERVISOR_AUTHORIZATION_ROOT_INVALID")
    trusted_directory(pending_root, {0o700}, "SUPERVISOR_AUTHORIZATION_ROOT_INVALID")
    if not path.is_absolute() or path.parent != pending_root or path.name != Path(path.name).name:
        reject("SUPERVISOR_AUTHORIZATION_PATH_INVALID")
    raw, _ = trusted_regular_file(path, 0o400, code="SUPERVISOR_AUTHORIZATION_FILE_INVALID")
    value = validate_authorization(strict_json(raw, "SUPERVISOR_AUTHORIZATION_JSON_INVALID"), expected_bundle_digest, now or datetime.now(timezone.utc))
    if raw != canonical_json(value) or path.name != f"{value['authorization_id']}.json":
        reject("SUPERVISOR_AUTHORIZATION_NOT_CANONICAL")
    return value, sha256(raw), raw


def verify_candidate(parameters: dict[str, Any]) -> None:
    if "repository_root" not in parameters:
        return
    repository = Path(parameters["repository_root"])
    if not repository.is_dir() or repository.resolve() != repository:
        reject("SUPERVISOR_CANDIDATE_ROOT_INVALID")
    for candidate in (repository, repository / ".git"):
        value = os.lstat(candidate)
        if stat.S_ISLNK(value.st_mode) or value.st_uid != 0 or value.st_gid != 0 or stat.S_IMODE(value.st_mode) & 0o022:
            reject("SUPERVISOR_CANDIDATE_OWNERSHIP_INVALID")
    environment = {"PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_NO_REPLACE_OBJECTS": "1"}
    git_prefix = ["/usr/bin/git", "-c", "core.useReplaceRefs=false", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", f"safe.directory={repository}", "-C", str(repository)]

    def git(*arguments: str) -> str:
        result = subprocess.run([*git_prefix, *arguments], env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False, text=True)
        if result.returncode != 0:
            reject("SUPERVISOR_CANDIDATE_GIT_INVALID")
        return result.stdout.strip()

    if git("rev-parse", "--show-toplevel") != str(repository) or git("rev-parse", "--verify", "HEAD^{commit}") != parameters["git_commit"] or git("rev-parse", "--verify", "HEAD^{tree}") != parameters["git_tree"]:
        reject("SUPERVISOR_CANDIDATE_GIT_MISMATCH")
    if subprocess.run([*git_prefix, "diff", "--quiet", "--no-ext-diff", "--no-textconv", "--"], env=environment, stdin=subprocess.DEVNULL, check=False).returncode != 0:
        reject("SUPERVISOR_CANDIDATE_DIRTY")
    if subprocess.run([*git_prefix, "diff", "--cached", "--quiet", "--no-ext-diff", "--no-textconv", "--"], env=environment, stdin=subprocess.DEVNULL, check=False).returncode != 0:
        reject("SUPERVISOR_CANDIDATE_DIRTY")
    if git("ls-files", "--others", "--exclude-standard", "--", "chenyida_erp_site"):
        reject("SUPERVISOR_CANDIDATE_DIRTY")


def command_for(bundle_root: Path, authorization: dict[str, Any]) -> list[str]:
    operation = authorization["operation"]
    parameters = authorization["parameters"]
    command = [str(bundle_root / ENTRYPOINTS[operation])]
    if operation == "CREATE_IMAGE_EVIDENCE":
        command += ["--repository-root", parameters["repository_root"], "--git-commit", parameters["git_commit"], "--git-tree", parameters["git_tree"], "--artifact-root", parameters["artifact_root"], "--run-id", parameters["run_id"], "--web-image", parameters["web_image"], "--worker-image", parameters["worker_image"], "--trivy-db-directory", parameters["trivy_db_directory"], "--confirm", "CREATE_TRIVY_IMAGE_EVIDENCE"]
    elif operation == "RUN_RELEASE_GATE":
        command += ["--repository-root", parameters["repository_root"], "--git-commit", parameters["git_commit"], "--git-tree", parameters["git_tree"], "--artifact-root", parameters["artifact_root"], "--run-id", parameters["run_id"], "--runtime-guard-contract", parameters["runtime_guard_contract"], "--runtime-guard-mode", parameters["runtime_guard_mode"], "--gate-plan-sha256", parameters["gate_plan_sha256"], "--web-image", parameters["web_image"], "--worker-image", parameters["worker_image"], "--sbom-evidence", parameters["sbom_evidence"], "--security-evidence", parameters["security_evidence"], "--confirm", "RUN_EXACT_RELEASE_GATE"]
    elif operation == "CREATE_RELEASE_MANIFEST":
        command += ["--repository-root", parameters["repository_root"], "--git-commit", parameters["git_commit"], "--git-tree", parameters["git_tree"], "--artifact-root", parameters["artifact_root"], "--release-id", parameters["release_id"], "--deployment-class", parameters["deployment_class"], "--runtime-guard-contract", parameters["runtime_guard_contract"], "--runtime-guard-mode", parameters["runtime_guard_mode"], "--gate-plan-sha256", parameters["gate_plan_sha256"], "--web-image", parameters["web_image"], "--worker-image", parameters["worker_image"], "--gate-plan", parameters["gate_plan"], "--gate-report", parameters["gate_report"], "--sbom-evidence", parameters["sbom_evidence"], "--security-evidence", parameters["security_evidence"], "--expires-at", parameters["expires_at"], "--confirm", "CREATE_IMMUTABLE_RELEASE_MANIFEST"]
    elif operation == "PROBE_POST_DEPLOY_RUNTIME_CONFIGURATION":
        command += ["--release-manifest", parameters["release_manifest"], "--release-manifest-sha256", parameters["release_manifest_sha256"], "--probe-root", parameters["probe_root"], "--probe-id", parameters["probe_id"], "--reader-gid", str(parameters["reader_gid"]), "--runtime-guard-contract", parameters["runtime_guard_contract"], "--runtime-guard-mode", parameters["runtime_guard_mode"], "--runtime-policy-sha256", parameters["runtime_policy_sha256"], "--deployment-class", parameters["deployment_class"], "--deployment-id", parameters["deployment_id"], "--compose-project", parameters["compose_project"], "--compose-project-root", parameters["compose_project_root"], "--caddy-container", parameters["caddy_container"], "--postgres-container", parameters["postgres_container"], "--web-container", parameters["web_container"], "--worker-container", parameters["worker_container"], "--confirm", "PROBE_EXACT_POSTDEPLOY_RUNTIME_CONFIGURATION"]
    else:
        command += ["--release-manifest", parameters["release_manifest"], "--release-manifest-sha256", parameters["release_manifest_sha256"], "--postdeploy-root", parameters["postdeploy_root"], "--identity-root", parameters["identity_root"], "--reader-gid", str(parameters["reader_gid"]), "--run-id", parameters["run_id"], "--runtime-guard-contract", parameters["runtime_guard_contract"], "--runtime-guard-mode", parameters["runtime_guard_mode"], "--runtime-policy-sha256", parameters["runtime_policy_sha256"], "--runtime-configuration-sha256", parameters["runtime_configuration_sha256"], "--deployment-class", parameters["deployment_class"], "--deployment-id", parameters["deployment_id"], "--compose-project", parameters["compose_project"], "--compose-project-root", parameters["compose_project_root"], "--caddy-container", parameters["caddy_container"], "--postgres-container", parameters["postgres_container"], "--web-container", parameters["web_container"], "--worker-container", parameters["worker_container"], "--confirm", "VERIFY_AND_PUBLISH_EXACT_POSTDEPLOY_IDENTITY"]
    return command


def validate_runtime_secret_boundary(bundle_root: Path, operation: str) -> None:
    if operation not in ("PROBE_POST_DEPLOY_RUNTIME_CONFIGURATION", "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY", *RUNTIME_PRIVILEGE_OPERATIONS):
        return
    validator = bundle_root / "chenyida_erp_site/scripts/runtime-secret-file-policy.py"
    policy = bundle_root / "chenyida_erp_site/operations/runtime-secret-file-policy-v1.json"
    environment = {
        "PATH": SAFE_PATH,
        "LC_ALL": "C",
        "LANG": "C",
        "TZ": "UTC",
        "HOME": "/nonexistent",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONHASHSEED": "0",
    }
    try:
        result = subprocess.run(
            ["/usr/bin/python3", str(validator), "validate", "--policy", str(policy)],
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        reject("SUPERVISOR_RUNTIME_SECRET_FILES_INVALID")
    expected = f"RUNTIME_SECRET_FILES_VERIFIED entries=6 policy_sha256={RUNTIME_SECRET_POLICY_SHA256}\n"
    if result.returncode != 0 or result.stdout != expected or result.stderr != "":
        reject("SUPERVISOR_RUNTIME_SECRET_FILES_INVALID")


def validate_runtime_probe_receipt(parameters: dict[str, Any], expected_bundle_digest: str, now: datetime | None = None, probe_root: Path = RUNTIME_PROBE_ROOT) -> dict[str, Any]:
    if set(PARAMETER_FIELDS["VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY"]) != set(parameters):
        reject("SUPERVISOR_RUNTIME_PROBE_BINDING_INVALID")
    trusted_directory(probe_root, {0o700}, "SUPERVISOR_RUNTIME_PROBE_ROOT_INVALID")
    receipt_path = Path(parameters["runtime_probe_receipt"])
    if not receipt_path.is_absolute() or receipt_path.parent != probe_root:
        reject("SUPERVISOR_RUNTIME_PROBE_PATH_INVALID")
    raw, _ = trusted_regular_file(receipt_path, 0o400, maximum=64 * 1024, code="SUPERVISOR_RUNTIME_PROBE_FILE_INVALID")
    if sha256(raw) != parameters["runtime_probe_receipt_sha256"]:
        reject("SUPERVISOR_RUNTIME_PROBE_DIGEST_MISMATCH")
    value = strict_json(raw, "SUPERVISOR_RUNTIME_PROBE_JSON_INVALID")
    fields = {"schema_version", "contract", "probe_id", "probed_at", "expires_at", "control", "deployment", "release", "runtime_guard", "runtime_policy_sha256", "runtime_secret_policy_sha256", "runtime_configuration_sha256", "compose_project_root_sha256", "selectors", "services"}
    value = exact_fields(value, fields, "SUPERVISOR_RUNTIME_PROBE_FIELDS_INVALID")
    if raw != canonical_json(value) or value["schema_version"] != 1 or value["contract"] != RUNTIME_PROBE_CONTRACT:
        reject("SUPERVISOR_RUNTIME_PROBE_NOT_CANONICAL")
    probe_id = value["probe_id"]
    if not isinstance(probe_id, str) or not IDENTIFIER.fullmatch(probe_id) or len(probe_id) > 101 or receipt_path.name != f"{probe_id}.runtime-configuration-probe.json":
        reject("SUPERVISOR_RUNTIME_PROBE_ID_INVALID")
    probed = parse_time(value["probed_at"], "SUPERVISOR_RUNTIME_PROBE_TIME_INVALID")
    expires = parse_time(value["expires_at"], "SUPERVISOR_RUNTIME_PROBE_TIME_INVALID")
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if expires - probed != timedelta(hours=1) or probed > current + timedelta(minutes=5) or current >= expires:
        reject("SUPERVISOR_RUNTIME_PROBE_TIME_INVALID")
    control = exact_fields(value["control"], {"supervisor_bundle_sha256", "authorization_sha256"}, "SUPERVISOR_RUNTIME_PROBE_CONTROL_INVALID")
    if control["supervisor_bundle_sha256"] != expected_bundle_digest or not isinstance(control["authorization_sha256"], str) or not SHA256.fullmatch(control["authorization_sha256"]):
        reject("SUPERVISOR_RUNTIME_PROBE_CONTROL_INVALID")
    deployment = exact_fields(value["deployment"], {"class", "id", "compose_project"}, "SUPERVISOR_RUNTIME_PROBE_DEPLOYMENT_INVALID")
    if deployment != {"class": parameters["deployment_class"], "id": parameters["deployment_id"], "compose_project": parameters["compose_project"]}:
        reject("SUPERVISOR_RUNTIME_PROBE_DEPLOYMENT_INVALID")
    release = exact_fields(value["release"], {"manifest_sha256", "git_commit", "package_version"}, "SUPERVISOR_RUNTIME_PROBE_RELEASE_INVALID")
    if release["manifest_sha256"] != parameters["release_manifest_sha256"] or not isinstance(release["git_commit"], str) or not GIT_OBJECT.fullmatch(release["git_commit"]) or not isinstance(release["package_version"], str) or not 1 <= len(release["package_version"]) <= 120:
        reject("SUPERVISOR_RUNTIME_PROBE_RELEASE_INVALID")
    runtime_guard = exact_fields(value["runtime_guard"], {"contract", "mode"}, "SUPERVISOR_RUNTIME_PROBE_GUARD_INVALID")
    if runtime_guard != {"contract": parameters["runtime_guard_contract"], "mode": parameters["runtime_guard_mode"]} \
        or value["runtime_policy_sha256"] != parameters["runtime_policy_sha256"] or value["runtime_secret_policy_sha256"] != RUNTIME_SECRET_POLICY_SHA256 \
        or value["runtime_configuration_sha256"] != parameters["runtime_configuration_sha256"] \
        or value["compose_project_root_sha256"] != sha256(parameters["compose_project_root"].encode("utf-8")):
        reject("SUPERVISOR_RUNTIME_PROBE_BINDING_INVALID")
    selectors = exact_fields(value["selectors"], {"caddy", "postgres", "web", "worker"}, "SUPERVISOR_RUNTIME_PROBE_SELECTORS_INVALID")
    expected_selectors = {service: parameters[f"{service}_container"] for service in ("caddy", "postgres", "web", "worker")}
    if selectors != expected_selectors:
        reject("SUPERVISOR_RUNTIME_PROBE_SELECTORS_INVALID")
    services = value["services"]
    service_fields = {"service", "container_id", "image_id", "image_reference", "restart_count", "oom_killed", "running", "restarting", "paused", "dead", "status", "health", "healthcheck_present"}
    if not isinstance(services, list) or len(services) != 4:
        reject("SUPERVISOR_RUNTIME_PROBE_SERVICES_INVALID")
    container_ids: set[str] = set()
    image_ids: set[str] = set()
    for index, service in enumerate(("caddy", "postgres", "web", "worker")):
        state = exact_fields(services[index], service_fields, "SUPERVISOR_RUNTIME_PROBE_SERVICES_INVALID")
        if state["service"] != service or not isinstance(state["container_id"], str) or not re.fullmatch(r"[0-9a-f]{64}", state["container_id"]) \
            or not isinstance(state["image_id"], str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", state["image_id"]) \
            or not isinstance(state["image_reference"], str) or not IMAGE_REFERENCE.fullmatch(state["image_reference"]) \
            or state["restart_count"] != 0 or state["oom_killed"] is not False or state["running"] is not True or state["restarting"] is not False \
            or state["paused"] is not False or state["dead"] is not False or state["status"] != "running" or not isinstance(state["healthcheck_present"], bool):
            reject("SUPERVISOR_RUNTIME_PROBE_SERVICES_INVALID")
        if service == "caddy":
            if state["health"] != "none" or state["healthcheck_present"] is not False:
                reject("SUPERVISOR_RUNTIME_PROBE_SERVICES_INVALID")
        elif state["health"] != "healthy" or state["healthcheck_present"] is not True:
            reject("SUPERVISOR_RUNTIME_PROBE_SERVICES_INVALID")
        if state["container_id"] in container_ids or state["image_id"] in image_ids:
            reject("SUPERVISOR_RUNTIME_PROBE_SERVICES_INVALID")
        container_ids.add(state["container_id"])
        image_ids.add(state["image_id"])
    return value


def validate_runtime_privilege_release_manifest(parameters: dict[str, Any], expected_bundle_digest: str,
                                                *, require_fresh: bool, now: datetime | None = None) -> dict[str, Any]:
    manifest_path = Path(parameters["release_manifest"])
    raw, _ = trusted_regular_file(manifest_path, 0o440, maximum=MAX_JSON_BYTES, code="SUPERVISOR_RUNTIME_PRIVILEGE_RELEASE_MANIFEST_INVALID")
    if sha256(raw) != parameters["release_manifest_sha256"]:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RELEASE_MANIFEST_INVALID")
    value = strict_json(raw, "SUPERVISOR_RUNTIME_PRIVILEGE_RELEASE_MANIFEST_INVALID")
    if (
        raw != canonical_json(value)
        or not isinstance(value, dict)
        or value.get("schema_version") != 2
        or value.get("contract") != "chenyida-erp-release-manifest/v2"
        or value.get("promotion_status") != "ELIGIBLE"
        or value.get("allowed_deployment_classes") != [parameters["deployment_class"]]
    ):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RELEASE_MANIFEST_INVALID")
    control = exact_fields(value.get("control"), {
        "supervisor_bundle_sha256", "image_evidence_authorization_sha256",
        "release_gate_authorization_sha256", "manifest_authorization_sha256",
    }, "SUPERVISOR_RUNTIME_PRIVILEGE_RELEASE_MANIFEST_INVALID")
    if control["supervisor_bundle_sha256"] != expected_bundle_digest:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RELEASE_MANIFEST_INVALID")
    generated = parse_time(value.get("generated_at"), "SUPERVISOR_RUNTIME_PRIVILEGE_RELEASE_MANIFEST_INVALID")
    expires = parse_time(value.get("expires_at"), "SUPERVISOR_RUNTIME_PRIVILEGE_RELEASE_MANIFEST_INVALID")
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if (
        expires <= generated
        or expires - generated > timedelta(days=7)
        or generated > current + timedelta(minutes=5)
        or (require_fresh and current >= expires)
    ):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RELEASE_MANIFEST_INVALID")
    return value


def validate_runtime_privilege_probe_receipt(parameters: dict[str, Any], expected_bundle_digest: str, now: datetime | None = None,
                                             operation: str | None = None, probe_root: Path = RUNTIME_PROBE_ROOT) -> dict[str, Any]:
    validate_runtime_privilege_parameters(parameters, operation)
    recovery = operation == "RECOVER_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT"
    effective_operation = parameters["original_operation"] if recovery else RUNTIME_PRIVILEGE_OPERATIONS[operation]
    manifest = validate_runtime_privilege_release_manifest(
        parameters, expected_bundle_digest, require_fresh=not recovery, now=now,
    )
    if effective_operation == "BOOTSTRAP":
        return manifest
    receipt_path = Path(parameters["runtime_probe_receipt"])
    raw, _ = trusted_regular_file(receipt_path, 0o400, maximum=64 * 1024, code="SUPERVISOR_RUNTIME_PROBE_FILE_INVALID")
    if sha256(raw) != parameters["runtime_probe_receipt_sha256"]:
        reject("SUPERVISOR_RUNTIME_PROBE_DIGEST_MISMATCH")
    preview = strict_json(raw, "SUPERVISOR_RUNTIME_PROBE_JSON_INVALID")
    if not isinstance(preview, dict):
        reject("SUPERVISOR_RUNTIME_PROBE_JSON_INVALID")
    selectors = exact_fields(preview.get("selectors"), {"caddy", "postgres", "web", "worker"}, "SUPERVISOR_RUNTIME_PROBE_SELECTORS_INVALID")
    synthetic_parameters = {
        "release_manifest": "/unused/release-manifest.json",
        "release_manifest_sha256": parameters["release_manifest_sha256"],
        "postdeploy_root": "/unused/postdeploy",
        "identity_root": "/unused/identity",
        "reader_gid": 1,
        "run_id": "runtime-privilege-probe-validation",
        "runtime_guard_contract": RUNTIME_GUARD_CONTRACT,
        "runtime_guard_mode": POST_DEPLOY_RUNTIME_GUARD_MODE,
        "runtime_policy_sha256": parameters["runtime_policy_sha256"],
        "deployment_class": parameters["deployment_class"],
        "deployment_id": parameters["deployment_id"],
        "compose_project": RUNTIME_COMPOSE_PROJECT,
        "runtime_configuration_sha256": parameters["runtime_configuration_sha256"],
        "runtime_probe_receipt": parameters["runtime_probe_receipt"],
        "runtime_probe_receipt_sha256": parameters["runtime_probe_receipt_sha256"],
        "compose_project_root": parameters["compose_project_root"],
        "caddy_container": selectors["caddy"],
        "postgres_container": parameters["postgres_container"],
        "web_container": selectors["web"],
        "worker_container": selectors["worker"],
    }
    value = validate_runtime_probe_receipt(synthetic_parameters, expected_bundle_digest, now, probe_root)
    postgres = value["services"][1]
    if postgres["service"] != "postgres" or postgres["container_id"] != parameters["postgres_container_id"]:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_CONTAINER_MISMATCH")
    return value


def validate_original_runtime_privilege_authorization_consumed(parameters: dict[str, Any], expected_bundle_digest: str,
                                                                 consumed_root: Path = AUTHORIZATION_CONSUMED_ROOT) -> dict[str, Any]:
    validate_runtime_privilege_parameters(parameters, "RECOVER_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT")
    if consumed_root == AUTHORIZATION_CONSUMED_ROOT:
        trusted_directory(AUTHORIZATION_ROOT, {0o700}, "SUPERVISOR_AUTHORIZATION_ROOT_INVALID")
    trusted_directory(consumed_root, {0o700}, "SUPERVISOR_AUTHORIZATION_ROOT_INVALID")
    original_id = parameters["original_operation_id"]
    original_digest = parameters["original_authorization_sha256"]
    file = consumed_root / f"{original_id}.{original_digest}.json"
    raw, _ = trusted_regular_file(file, 0o400, code="SUPERVISOR_RUNTIME_PRIVILEGE_ORIGINAL_AUTHORIZATION_INVALID")
    if sha256(raw) != original_digest:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_ORIGINAL_AUTHORIZATION_INVALID")
    preview = strict_json(raw, "SUPERVISOR_RUNTIME_PRIVILEGE_ORIGINAL_AUTHORIZATION_INVALID")
    try:
        created = parse_time(preview["created_at"], "SUPERVISOR_RUNTIME_PRIVILEGE_ORIGINAL_AUTHORIZATION_INVALID")
        expires = parse_time(preview["expires_at"], "SUPERVISOR_RUNTIME_PRIVILEGE_ORIGINAL_AUTHORIZATION_INVALID")
    except (KeyError, TypeError):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_ORIGINAL_AUTHORIZATION_INVALID")
    validation_time = created + (expires - created) / 2
    try:
        value = validate_authorization(preview, expected_bundle_digest, validation_time)
    except SupervisorError:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_ORIGINAL_AUTHORIZATION_INVALID")
    if raw != canonical_json(value) or value["authorization_id"] != original_id \
        or value["operation"] == "RECOVER_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT" \
        or RUNTIME_PRIVILEGE_OPERATIONS.get(value["operation"]) != parameters["original_operation"]:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_ORIGINAL_AUTHORIZATION_INVALID")
    original_parameters = value["parameters"]
    stable_fields = RUNTIME_PRIVILEGE_BASE_PARAMETER_FIELDS
    if any(original_parameters[field] != parameters[field] for field in stable_fields):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_ORIGINAL_AUTHORIZATION_INVALID")
    return value


def acquire_global_release_lock(path: Path = GLOBAL_RELEASE_LOCK) -> int:
    try:
        parent = os.lstat(path.parent)
    except OSError:
        reject("SUPERVISOR_GLOBAL_RELEASE_LOCK_INVALID")
    if not stat.S_ISDIR(parent.st_mode) or stat.S_ISLNK(parent.st_mode) or parent.st_uid != 0 or parent.st_gid != 0 or stat.S_IMODE(parent.st_mode) & 0o022:
        reject("SUPERVISOR_GLOBAL_RELEASE_LOCK_INVALID")
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    except OSError:
        reject("SUPERVISOR_GLOBAL_RELEASE_LOCK_INVALID")
    try:
        os.fchown(descriptor, 0, 0)
        os.fchmod(descriptor, 0o600)
        opened = os.fstat(descriptor)
        pointed = os.lstat(path)
        if not stat.S_ISREG(opened.st_mode) or opened.st_uid != 0 or opened.st_gid != 0 or opened.st_nlink != 1 or stat.S_IMODE(opened.st_mode) != 0o600 \
            or pointed.st_dev != opened.st_dev or pointed.st_ino != opened.st_ino or stat.S_ISLNK(pointed.st_mode):
            reject("SUPERVISOR_GLOBAL_RELEASE_LOCK_INVALID")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            reject("SUPERVISOR_GLOBAL_RELEASE_LOCK_BUSY")
        os.set_inheritable(descriptor, True)
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def assert_no_runtime_privilege_interlock(bundle_root: Path) -> None:
    helper = bundle_root / "chenyida_erp_site/scripts/postgresql-runtime-privilege-interlock.sh"
    environment = {"PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent"}
    try:
        result = subprocess.run(
            ["/bin/sh", "-c", '. "$1"; assert_no_chenyida_postgresql_runtime_privilege_interlock', "sh", str(helper)],
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_INTERLOCK_INVALID")
    if result.returncode != 0:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RECOVERY_REQUIRED")


def _docker(arguments: list[str], *, timeout: int, stdout: int = subprocess.PIPE) -> subprocess.CompletedProcess[bytes]:
    environment = {"PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent"}
    try:
        return subprocess.run(["/usr/bin/docker", *arguments], env=environment, stdin=subprocess.DEVNULL, stdout=stdout, stderr=subprocess.DEVNULL, check=False, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_NODE_RUNTIME_FAILED")


def prepare_runtime_privilege_node(authorization_digest: str) -> tuple[Path, Path]:
    if not SHA256.fullmatch(authorization_digest):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_NODE_RUNTIME_FAILED")
    inspected = _docker(["image", "inspect", RUNTIME_PRIVILEGE_NODE_IMAGE], timeout=15, stdout=subprocess.DEVNULL)
    if inspected.returncode != 0:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_NODE_IMAGE_UNAVAILABLE")
    runtime_root = Path(tempfile.mkdtemp(prefix="chenyida-erp-runtime-privilege-node.", dir="/tmp"))
    os.chown(runtime_root, 0, 0)
    os.chmod(runtime_root, 0o700)
    container_name = f"cyd-runtime-privilege-node-{authorization_digest}"
    container_id: str | None = None
    try:
        try:
            created = _docker([
                "create", "--pull=never", "--name", container_name,
                "--label", f"chenyida.erp.runtime-privilege-node={authorization_digest}",
                "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                "--memory", "64m", "--memory-swap", "64m", "--cpus", "0.25", "--pids-limit", "16",
                RUNTIME_PRIVILEGE_NODE_IMAGE, "true",
            ], timeout=30)
            candidate = created.stdout.decode("ascii", errors="strict").strip() if created.returncode == 0 else ""
            if not re.fullmatch(r"[0-9a-f]{64}", candidate):
                reject("SUPERVISOR_RUNTIME_PRIVILEGE_NODE_RUNTIME_FAILED")
            container_id = candidate
            copied = _docker(["cp", f"{container_id}:/usr/local/bin/node", str(runtime_root / "node")], timeout=30)
            if copied.returncode != 0:
                reject("SUPERVISOR_RUNTIME_PRIVILEGE_NODE_RUNTIME_FAILED")
            node_path = runtime_root / "node"
            node_metadata = os.lstat(node_path)
            if not stat.S_ISREG(node_metadata.st_mode) or stat.S_ISLNK(node_metadata.st_mode) or node_metadata.st_nlink != 1:
                reject("SUPERVISOR_RUNTIME_PRIVILEGE_NODE_RUNTIME_FAILED")
            os.chown(node_path, 0, 0)
            os.chmod(node_path, 0o555)
            node_metadata = os.lstat(node_path)
            if node_metadata.st_uid != 0 or node_metadata.st_gid != 0 or stat.S_IMODE(node_metadata.st_mode) != 0o555 or node_metadata.st_nlink != 1:
                reject("SUPERVISOR_RUNTIME_PRIVILEGE_NODE_RUNTIME_FAILED")
            with open(node_path, "rb") as handle:
                os.fsync(handle.fileno())
        finally:
            if container_id is not None:
                ownership = _docker(["inspect", "--format", '{{index .Config.Labels "chenyida.erp.runtime-privilege-node"}}|{{.Name}}', container_id], timeout=15)
                expected = f"{authorization_digest}|/{container_name}\n".encode("ascii")
                if ownership.returncode != 0 or ownership.stdout != expected:
                    reject("SUPERVISOR_RUNTIME_PRIVILEGE_NODE_OWNERSHIP_INVALID")
                removed = _docker(["rm", "-f", container_id], timeout=30, stdout=subprocess.DEVNULL)
                if removed.returncode != 0:
                    reject("SUPERVISOR_RUNTIME_PRIVILEGE_NODE_CLEANUP_FAILED")
    except Exception:
        cleanup_runtime_privilege_node(runtime_root)
        raise
    return runtime_root, node_path


def cleanup_runtime_privilege_node(runtime_root: Path | None) -> None:
    if runtime_root is None:
        return
    try:
        resolved = runtime_root.resolve(strict=True)
    except OSError:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_NODE_CLEANUP_FAILED")
    if resolved.parent != Path("/tmp") or not resolved.name.startswith("chenyida-erp-runtime-privilege-node.") or resolved == Path("/tmp"):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_NODE_CLEANUP_FAILED")
    shutil.rmtree(resolved)


def runtime_privilege_probe_binding(parameters: dict[str, Any], operation: str) -> str:
    if operation == "RECONCILE":
        return parameters["runtime_probe_receipt_sha256"]
    body = {
        "schema_version": 1,
        "contract": "chenyida-erp-postgresql-bootstrap-runtime-binding/v1",
        "runtime_guard_mode": parameters["runtime_guard_mode"],
        "release_manifest_sha256": parameters["release_manifest_sha256"],
        "runtime_configuration_sha256": parameters["runtime_configuration_sha256"],
        "deployment_class": parameters["deployment_class"],
        "deployment_id": parameters["deployment_id"],
        "postgres_container": parameters["postgres_container"],
        "postgres_container_id": parameters["postgres_container_id"],
        "expected_database": parameters["expected_database"],
        "expected_database_oid": parameters["expected_database_oid"],
        "expected_system_identifier": parameters["expected_system_identifier"],
        "expected_database_marker": parameters["expected_database_marker"],
    }
    return sha256(canonical_json(body))


def runtime_privilege_context(authorization: dict[str, Any], authorization_digest: str) -> dict[str, Any]:
    parameters = authorization["parameters"]
    recovery = authorization["operation"] == "RECOVER_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT"
    operation = parameters["original_operation"] if recovery else RUNTIME_PRIVILEGE_OPERATIONS[authorization["operation"]]
    return {
        "schema_version": 2,
        "contract": "chenyida-erp-postgresql-runtime-privilege-control-context/v2",
        "evidence_scope": "ACTUAL_CONTROLLED",
        "operation_id": parameters["original_operation_id"] if recovery else authorization["authorization_id"],
        "operation": operation,
        "execution_mode": "RECOVERY" if recovery else "ORIGINAL",
        "execution_authorization_id": authorization["authorization_id"],
        "execution_authorization_sha256": authorization_digest,
        "expected_intent_sha256": parameters["expected_intent_sha256"] if recovery else None,
        "deployment_class": parameters["deployment_class"],
        "deployment_id": parameters["deployment_id"],
        "state_root": str(RUNTIME_PRIVILEGE_STATE_ROOT),
        "runtime_secret_root": str(RUNTIME_SECRET_ROOT),
        "backup_credential_root": parameters["backup_credential_root"],
        "backup_capture_service_file": parameters["backup_capture_service_file"],
        "backup_capture_service": parameters["backup_capture_service"],
        "credential_generation_id": parameters["credential_generation_id"],
        "backup_root": parameters["backup_root"],
        "release_manifest": parameters["release_manifest"],
        "release_manifest_sha256": parameters["release_manifest_sha256"],
        "runtime_guard_mode": parameters["runtime_guard_mode"],
        "postgres_container_name": parameters["postgres_container"],
        "postgres_container_id": parameters["postgres_container_id"],
        "expected_database": parameters["expected_database"],
        "expected_database_oid": parameters["expected_database_oid"],
        "expected_system_identifier": parameters["expected_system_identifier"],
        "expected_database_marker": parameters["expected_database_marker"],
        "supervisor_bundle_sha256": authorization["supervisor_bundle_sha256"],
        "authorization_sha256": parameters["original_authorization_sha256"] if recovery else authorization_digest,
        "runtime_configuration_sha256": parameters["runtime_configuration_sha256"],
        "runtime_probe_binding_sha256": runtime_privilege_probe_binding(parameters, operation),
    }


def run_runtime_privilege_runner(node_path: Path, bundle_root: Path, context: dict[str, Any], phase: str, lock_descriptor: int) -> dict[str, Any]:
    confirmations = {
        "prepare": "PREPARE_DURABLE_INTENT_BEFORE_AUTHORIZATION",
        "execute": "EXECUTE_EXACT_PREPARED_RUNTIME_PRIVILEGE_INTENT",
        "recover-prepare": "PREPARE_DURABLE_RECOVERY_AUTHORIZATION",
        "recover-execute": "EXECUTE_EXACT_PREPARED_RUNTIME_PRIVILEGE_RECOVERY",
    }
    if phase not in confirmations:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RUNNER_PHASE_INVALID")
    confirmation = confirmations[phase]
    runner = bundle_root / "chenyida_erp_site/scripts/postgresql-runtime-privilege-runner.mjs"
    environment = {
        "PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent",
        "ERP_RELEASE_SUPERVISOR_LAUNCHED": "YES", "ERP_RELEASE_GATE_LOCK_HELD": "YES",
        "ERP_RELEASE_GATE_LOCK_FD": str(lock_descriptor),
        "ERP_RELEASE_SUPERVISOR_SITE_ROOT": str(bundle_root / "chenyida_erp_site"),
        "ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256": context["supervisor_bundle_sha256"],
        "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256": context["execution_authorization_sha256"],
        "ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED": "YES" if context["execution_mode"] == "RECOVERY" else "NO",
    }
    try:
        result = subprocess.run(
            [str(node_path), str(runner), phase, confirmation],
            env=environment,
            input=canonical_json(context),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=900,
            pass_fds=(lock_descriptor,),
        )
    except (OSError, subprocess.SubprocessError):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RUNNER_FAILED")
    if result.returncode != 0 or result.stderr != b"" or len(result.stdout) < 2 or len(result.stdout) > 64 * 1024:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RUNNER_FAILED")
    value = strict_json(result.stdout, "SUPERVISOR_RUNTIME_PRIVILEGE_RUNNER_RESPONSE_INVALID")
    if result.stdout != canonical_json(value) or not isinstance(value, dict) or value.get("operation_id") != context["operation_id"]:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RUNNER_RESPONSE_INVALID")
    if phase == "prepare":
        expected_result = {"PREPARED", "ALREADY_PREPARED"}
        expected_fields = {"result", "operation_id", "intent_sha256", "plan_sha256"}
        digest_fields = {"intent_sha256", "plan_sha256"}
    elif phase == "execute":
        expected_result = {"VERIFIED"}
        expected_fields = {"result", "operation_id", "intent_sha256", "receipt_sha256"}
        digest_fields = {"intent_sha256", "receipt_sha256"}
    elif phase == "recover-prepare":
        expected_result = {"RECOVERY_PREPARED"}
        expected_fields = {"result", "operation_id", "intent_sha256", "recovery_record_sha256", "decision"}
        digest_fields = {"intent_sha256", "recovery_record_sha256"}
        if value.get("decision") not in {"ARCHIVE_COMMITTED", "CAPTURE_AND_VERIFY", "DISPATCH_TRANSACTION", "FINISH_PUBLICATION", "QUARANTINE", "RESUME_AUTHORIZATION", "RETRY_TRANSACTION"}:
            reject("SUPERVISOR_RUNTIME_PRIVILEGE_RUNNER_RESPONSE_INVALID")
    elif value.get("result") == "VERIFIED":
        expected_result = {"VERIFIED"}
        expected_fields = {"result", "operation_id", "intent_sha256", "recovery_record_sha256", "receipt_sha256"}
        digest_fields = {"intent_sha256", "recovery_record_sha256", "receipt_sha256"}
    else:
        expected_result = {"QUARANTINED"}
        expected_fields = {"result", "operation_id", "intent_sha256", "recovery_record_sha256", "quarantine_state_sha256"}
        digest_fields = {"intent_sha256", "recovery_record_sha256", "quarantine_state_sha256"}
    if set(value) != expected_fields or value.get("result") not in expected_result or any(not isinstance(value.get(field), str) or not SHA256.fullmatch(value[field]) for field in digest_fields):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RUNNER_RESPONSE_INVALID")
    return value


def run_runtime_privilege_authorization(bundle_root: Path, authorization_path: Path, authorization: dict[str, Any], authorization_digest: str, lock_descriptor: int | None = None) -> dict[str, Any]:
    owns_lock = lock_descriptor is None
    if lock_descriptor is None:
        lock_descriptor = acquire_global_release_lock()
    runtime_root: Path | None = None
    try:
        recovery = authorization["operation"] == "RECOVER_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT"
        if recovery:
            validate_original_runtime_privilege_authorization_consumed(authorization["parameters"], authorization["supervisor_bundle_sha256"])
        runtime_root, node_path = prepare_runtime_privilege_node(authorization_digest)
        context = runtime_privilege_context(authorization, authorization_digest)
        run_runtime_privilege_runner(node_path, bundle_root, context, "recover-prepare" if recovery else "prepare", lock_descriptor)
        consume_authorization(authorization_path, authorization, authorization_digest)
        return run_runtime_privilege_runner(node_path, bundle_root, context, "recover-execute" if recovery else "execute", lock_descriptor)
    finally:
        try:
            cleanup_runtime_privilege_node(runtime_root)
        finally:
            if owns_lock:
                os.close(lock_descriptor)


def consume_authorization(path: Path, authorization: dict[str, Any], digest: str, pending_root: Path = AUTHORIZATION_PENDING_ROOT, consumed_root: Path = AUTHORIZATION_CONSUMED_ROOT) -> Path:
    if pending_root == AUTHORIZATION_PENDING_ROOT and consumed_root == AUTHORIZATION_CONSUMED_ROOT:
        trusted_directory(AUTHORIZATION_ROOT, {0o700}, "SUPERVISOR_AUTHORIZATION_ROOT_INVALID")
    trusted_directory(pending_root, {0o700}, "SUPERVISOR_AUTHORIZATION_ROOT_INVALID")
    trusted_directory(consumed_root, {0o700}, "SUPERVISOR_AUTHORIZATION_ROOT_INVALID")
    destination = consumed_root / f"{authorization['authorization_id']}.{digest}.json"
    if destination.exists():
        reject("SUPERVISOR_AUTHORIZATION_ALREADY_CONSUMED")
    try:
        os.rename(path, destination)
        for directory in (pending_root, consumed_root):
            descriptor = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
    except OSError:
        reject("SUPERVISOR_AUTHORIZATION_CONSUME_FAILED")
    return destination


def parse_cli(arguments: list[str]) -> tuple[str, Path]:
    if len(arguments) != 4 or arguments[0] != "--bundle-sha256" or arguments[2] != "--authorization-file" or not SHA256.fullmatch(arguments[1]):
        reject("SUPERVISOR_CLI_ARGUMENT_INVALID")
    return arguments[1], Path(arguments[3])


def main() -> None:
    if os.getuid() != 0 or Path(os.path.realpath(sys.argv[0])) != LAUNCHER_PATH:
        reject("SUPERVISOR_LAUNCHER_CONTEXT_INVALID")
    trusted_directory(SUPERVISOR_BASE, {0o555, 0o755}, "SUPERVISOR_INSTALL_ROOT_INVALID")
    trusted_directory(BUNDLES_ROOT, {0o555, 0o755}, "SUPERVISOR_INSTALL_ROOT_INVALID")
    bundle_digest, authorization_path = parse_cli(sys.argv[1:])
    bundle_root = BUNDLES_ROOT / bundle_digest
    verify_bundle(bundle_root, bundle_digest)
    authorization, authorization_digest, _ = load_authorization(authorization_path, bundle_digest)
    verify_candidate(authorization["parameters"])
    lock_descriptor = acquire_global_release_lock()
    try:
        validate_runtime_secret_boundary(bundle_root, authorization["operation"])
        if authorization["contract"] == RUNTIME_PRIVILEGE_AUTHORIZATION_CONTRACT:
            validate_runtime_privilege_probe_receipt(authorization["parameters"], bundle_digest, operation=authorization["operation"])
            result = run_runtime_privilege_authorization(
                bundle_root, authorization_path, authorization, authorization_digest, lock_descriptor,
            )
            sys.stdout.buffer.write(canonical_json(result))
            return
        if authorization["operation"] == "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY":
            validate_runtime_probe_receipt(authorization["parameters"], bundle_digest)
        assert_no_runtime_privilege_interlock(bundle_root)
        consume_authorization(authorization_path, authorization, authorization_digest)
        site_root = bundle_root / "chenyida_erp_site"
        command = command_for(bundle_root, authorization)
        environment = {
            "PATH": SAFE_PATH,
            "LC_ALL": "C",
            "LANG": "C",
            "TZ": "UTC",
            "HOME": "/nonexistent",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "ERP_RELEASE_SUPERVISOR_LAUNCHED": "YES",
            "ERP_RELEASE_GATE_LOCK_HELD": "YES",
            "ERP_RELEASE_GATE_LOCK_FD": str(lock_descriptor),
            "ERP_RELEASE_SUPERVISOR_SITE_ROOT": str(site_root),
            "ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256": bundle_digest,
            "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256": authorization_digest,
        }
        os.execve(command[0], command, environment)
    finally:
        os.close(lock_descriptor)


if __name__ == "__main__":
    try:
        main()
    except SupervisorError as error:
        print(error.code, file=sys.stderr)
        raise SystemExit(1) from None
    except Exception:
        print("SUPERVISOR_INTERNAL_ERROR", file=sys.stderr)
        raise SystemExit(1) from None
