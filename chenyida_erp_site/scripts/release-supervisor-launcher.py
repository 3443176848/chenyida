#!/usr/bin/python3
"""Root-owned, content-addressed launcher for exact ERP release operations."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import subprocess
import sys
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
BUNDLE_CONTRACT = "chenyida-erp-release-supervisor-bundle/v1"
AUTHORIZATION_CONTRACT = "chenyida-erp-release-supervisor-authorization/v2"
RUNTIME_GUARD_CONTRACT = "chenyida-erp-release-runtime-guard/v1"
PRE_DEPLOY_RUNTIME_GUARD_MODE = "PRE_DEPLOY_EXISTING_RUNTIME_STABILITY"
POST_DEPLOY_RUNTIME_GUARD_MODE = "POST_DEPLOY_CURRENT_RUNTIME_STRICT"
RUNTIME_COMPOSE_PROJECT = "chenyida-erp"
RUNTIME_POLICY_SHA256 = "e4920820ed954c2689e3de53dea9b7f36945969c8287b06d87a3871e7d3ecf00"
RUNTIME_SECRET_POLICY_SHA256 = "8dd07c6acd6e857a0b29b14e2b6d5b60ad919cf54aac9b552ce11672eb45b7c5"
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
    "chenyida_erp_site/operations/runtime-secret-file-policy-v1.json": "0444",
    "chenyida_erp_site/release/release-gate-plan-v2.json": "0444",
    "chenyida_erp_site/release/release-test-inventory-v1.json": "0444",
    "chenyida_erp_site/release/test-runtime-policy-v1.json": "0444",
    "chenyida_erp_site/release/vulnerability-policy-v1.json": "0444",
    "chenyida_erp_site/scripts/check-credentials.mjs": "0444",
    "chenyida_erp_site/scripts/container-runtime-policy-test.py": "0444",
    "chenyida_erp_site/scripts/container-runtime-policy.py": "0444",
    "chenyida_erp_site/scripts/create-release-image-evidence.sh": "0555",
    "chenyida_erp_site/scripts/create-release-manifest.sh": "0555",
    "chenyida_erp_site/scripts/create-release-supervisor-bundle-manifest.py": "0555",
    "chenyida_erp_site/scripts/install-release-supervisor.py": "0444",
    "chenyida_erp_site/scripts/postdeploy-release-contract.mjs": "0444",
    "chenyida_erp_site/scripts/postdeploy-release-verifier.mjs": "0444",
    "chenyida_erp_site/scripts/publish-release-identity-from-manifest.mjs": "0444",
    "chenyida_erp_site/scripts/release-browser-e2e-runner.mjs": "0444",
    "chenyida_erp_site/scripts/release-gate-runner.mjs": "0444",
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
    "chenyida_erp_site/tests/selfhost-release-gate-contract.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-release-identity-contract.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-release-image-evidence-producer.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-release-manifest-contract.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-release-migration-allowlist.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-backup-recovery-postgres.sh": "0555",
    "chenyida_erp_site/tests/selfhost-postgresql-cluster-recovery-postgres.sh": "0555",
    "chenyida_erp_site/tests/selfhost-postgresql-runtime-privilege-catalog-postgres.sh": "0555",
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
    "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY": "chenyida_erp_site/scripts/write-release-identity.sh",
}

CONFIRMATIONS = {
    "CREATE_IMAGE_EVIDENCE": "AUTHORIZE_CREATE_TRIVY_IMAGE_EVIDENCE",
    "RUN_RELEASE_GATE": "AUTHORIZE_RUN_EXACT_RELEASE_GATE",
    "CREATE_RELEASE_MANIFEST": "AUTHORIZE_CREATE_IMMUTABLE_RELEASE_MANIFEST",
    "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY": "AUTHORIZE_VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY",
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
    "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY": {
        "release_manifest", "release_manifest_sha256", "postdeploy_root", "identity_root", "reader_gid", "run_id",
        "runtime_guard_contract", "runtime_guard_mode", "runtime_policy_sha256", "deployment_class", "deployment_id", "compose_project",
        "runtime_configuration_sha256", "compose_project_root", "caddy_container", "postgres_container", "web_container", "worker_container",
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
    for key in ("artifact_root", "postdeploy_root", "identity_root", "release_manifest", "gate_plan", "gate_report", "sbom_evidence", "security_evidence", "trivy_db_directory", "repository_root", "compose_project_root"):
        if key in parameters:
            absolute_path(parameters[key], "SUPERVISOR_AUTHORIZATION_PATH_INVALID")
    for key in ("run_id", "release_id", "deployment_id", "compose_project", "caddy_container", "postgres_container", "web_container", "worker_container"):
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
    for key in ("release_manifest_sha256", "gate_plan_sha256", "runtime_policy_sha256", "runtime_configuration_sha256"):
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
    if operation == "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY":
        if len(parameters["run_id"]) > 101:
            reject("SUPERVISOR_AUTHORIZATION_IDENTIFIER_INVALID")
        if parameters.get("runtime_guard_mode") != POST_DEPLOY_RUNTIME_GUARD_MODE or parameters.get("runtime_policy_sha256") != RUNTIME_POLICY_SHA256:
            reject("SUPERVISOR_AUTHORIZATION_RUNTIME_GUARD_INVALID")
        if parameters["deployment_id"] != RUNTIME_COMPOSE_PROJECT or parameters["compose_project"] != RUNTIME_COMPOSE_PROJECT or len({parameters["caddy_container"], parameters["postgres_container"], parameters["web_container"], parameters["worker_container"]}) != 4:
            reject("SUPERVISOR_AUTHORIZATION_DEPLOYMENT_IDENTITY_INVALID")
        manifest = Path(parameters["release_manifest"])
        postdeploy = Path(parameters["postdeploy_root"])
        if manifest.parent.parent != RELEASE_ARTIFACT_ROOT_BASE or postdeploy.parent != POSTDEPLOY_ROOT_BASE or postdeploy.name != parameters["run_id"] or Path(parameters["identity_root"]) != RELEASE_IDENTITY_ROOT:
            reject("SUPERVISOR_AUTHORIZATION_POSTDEPLOY_PATH_INVALID")
    return parameters


def validate_authorization(value: Any, expected_bundle_digest: str, now: datetime) -> dict[str, Any]:
    value = exact_fields(value, {"schema_version", "contract", "authorization_id", "created_at", "expires_at", "supervisor_bundle_sha256", "operation", "parameters", "nonce", "confirmation"}, "SUPERVISOR_AUTHORIZATION_FIELDS_INVALID")
    if value["schema_version"] != 2 or value["contract"] != AUTHORIZATION_CONTRACT:
        reject("SUPERVISOR_AUTHORIZATION_VERSION_INVALID")
    if not isinstance(value["authorization_id"], str) or not IDENTIFIER.fullmatch(value["authorization_id"]):
        reject("SUPERVISOR_AUTHORIZATION_ID_INVALID")
    if not isinstance(value["supervisor_bundle_sha256"], str) or value["supervisor_bundle_sha256"] != expected_bundle_digest:
        reject("SUPERVISOR_AUTHORIZATION_BUNDLE_MISMATCH")
    operation = value["operation"]
    if operation not in ENTRYPOINTS or value["confirmation"] != CONFIRMATIONS[operation]:
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
    validate_parameters(operation, value["parameters"])
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
    else:
        command += ["--release-manifest", parameters["release_manifest"], "--release-manifest-sha256", parameters["release_manifest_sha256"], "--postdeploy-root", parameters["postdeploy_root"], "--identity-root", parameters["identity_root"], "--reader-gid", str(parameters["reader_gid"]), "--run-id", parameters["run_id"], "--runtime-guard-contract", parameters["runtime_guard_contract"], "--runtime-guard-mode", parameters["runtime_guard_mode"], "--runtime-policy-sha256", parameters["runtime_policy_sha256"], "--runtime-configuration-sha256", parameters["runtime_configuration_sha256"], "--deployment-class", parameters["deployment_class"], "--deployment-id", parameters["deployment_id"], "--compose-project", parameters["compose_project"], "--compose-project-root", parameters["compose_project_root"], "--caddy-container", parameters["caddy_container"], "--postgres-container", parameters["postgres_container"], "--web-container", parameters["web_container"], "--worker-container", parameters["worker_container"], "--confirm", "VERIFY_AND_PUBLISH_EXACT_POSTDEPLOY_IDENTITY"]
    return command


def validate_runtime_secret_boundary(bundle_root: Path, operation: str) -> None:
    if operation != "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY":
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
    validate_runtime_secret_boundary(bundle_root, authorization["operation"])
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
        "ERP_RELEASE_SUPERVISOR_SITE_ROOT": str(site_root),
        "ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256": bundle_digest,
        "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256": authorization_digest,
    }
    os.execve(command[0], command, environment)


if __name__ == "__main__":
    try:
        main()
    except SupervisorError as error:
        print(error.code, file=sys.stderr)
        raise SystemExit(1) from None
    except Exception:
        print("SUPERVISOR_INTERNAL_ERROR", file=sys.stderr)
        raise SystemExit(1) from None
