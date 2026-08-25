#!/usr/bin/python3
"""Plan and, only with a bound authorization, prepare one isolated UAT database.

The default ``plan`` command is read-only.  ``execute`` is deliberately narrow:
it stops after PostgreSQL bootstrap, the exact EMPTY-to-approved-head migration,
and final runtime privilege reconciliation.  It never starts Web, Worker, Caddy,
Admin, creates employee accounts, or touches an existing ERP project.
"""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import json
import os
import re
import runpy
import stat
import sys
import unicodedata
from pathlib import Path, PurePosixPath
from types import SimpleNamespace
from typing import Any, Callable, Protocol


REQUEST_CONTRACT = "chenyida-erp-isolated-uat-root-operations-request/v1"
AUTHORIZATION_CONTRACT = "chenyida-erp-isolated-uat-root-operations-authorization/v1"
PLAN_CONTRACT = "chenyida-erp-isolated-uat-root-operations-plan/v1"
GRANT_CONTRACT = "chenyida-erp-isolated-uat-migration-execution-grant/v1"
RESULT_CONTRACT = "chenyida-erp-isolated-uat-database-preparation-result/v1"
EXECUTION_CONFIRMATION = "EXECUTE_EXACT_ISOLATED_UAT_DATABASE_PREPARATION"
AUTHORIZED_ACTION = "PREPARE_EMPTY_ISOLATED_UAT_DATABASE"
TARGET_HEAD = "0046_runtime_lock_privilege_boundary.sql"
DATABASE_NAME = "chenyida_erp"
MIGRATION_ROLE = "chenyida_erp_owner"
CONTROL_ROLE = "postgres"
MAX_CONTROL_BYTES = 1024 * 1024
MAX_PACKAGE_MEMBER_BYTES = 16 * 1024 * 1024
MAX_PACKAGE_BYTES = 64 * 1024 * 1024

ROOT_OPERATIONS_PACKAGE_MEMBERS = (
    "Dockerfile",
    "compose.yml",
    "compose.release.yml",
    "compose.uat-isolated.yml",
    "compose.uat-operations.yml",
    "render.env",
    "operations/postgresql-runtime-privilege-access-v2.json",
    "operations/postgresql-runtime-privilege-compiled-catalog-v1.json",
    "operations/postgresql-runtime-privilege-operator-policy-v1.json",
    "operations/postgresql-runtime-privilege-policy-v2.json",
    "operations/runtime-secret-file-policy-v1.json",
    "scripts/backup-recovery-contract.mjs",
    "scripts/isolated-uat-compose-policy.py",
    "scripts/isolated-uat-database-operation-cli.mjs",
    "scripts/isolated-uat-database-operator.mjs",
    "scripts/isolated-uat-migration-execution-contract.mjs",
    "scripts/isolated-uat-root-operations-compose-policy.py",
    "scripts/isolated-uat-root-operations.py",
    "scripts/isolated-uat-root-system-port.py",
    "scripts/migrate-postgres.ts",
    "scripts/postgresql-cluster-recovery-contract.mjs",
    "scripts/postgresql-runtime-privilege-catalog.mjs",
    "scripts/postgresql-runtime-privilege-catalog.sql",
    "scripts/postgresql-runtime-privilege-operator.mjs",
    "scripts/postgresql-runtime-privilege-policy.mjs",
    "scripts/postgresql-runtime-privilege-reconciler.mjs",
    "scripts/postgresql-runtime-privilege-source.mjs",
    "scripts/postgresql-runtime-privilege-state.sql",
    "scripts/release-manifest-contract.mjs",
    "scripts/release-migration-authorization.ts",
    "scripts/uat-promotion-migration-execution-contract.mjs",
)

PROJECT = re.compile(r"^chenyida-erp-uat-[a-z0-9][a-z0-9_-]{0,42}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
GIT_SHA = re.compile(r"^[0-9a-f]{40}$")
VERSION = re.compile(r"^0\.1\.0-alpha\.[0-9]+$")
IMAGE = re.compile(
    r"^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?"
    r"(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[0-9a-f]{64}$"
)
IMAGE_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
SYSTEM_IDENTIFIER = re.compile(r"^[1-9][0-9]{9,23}$")
OID = re.compile(r"^[1-9][0-9]{0,9}$")
ISO_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")

PROTECTED_ROOTS = (
    PurePosixPath("/etc/chenyida-erp"),
    PurePosixPath("/var/lib/chenyida-erp"),
    PurePosixPath("/var/backups/chenyida-erp-v2"),
)
PROTECTED_VOLUMES = (
    "chenyida-erp-parallel_erp_postgres",
    "chenyida-erp-parallel_erp_uploads",
    "chenyida-erp-parallel_erp_attachments",
    "chenyida-erp-parallel_erp_backup_status",
)
FORBIDDEN_EXECUTION_ENVIRONMENT = (
    "ERP_ALLOW_ISOLATED_MIGRATION",
    "ERP_RELEASE_TEST_MODE",
    "ERP_MIGRATION_TEST_HARNESS",
    "ERP_RELEASE_SUPERVISOR_LAUNCHED",
    "ERP_RELEASE_GATE_LOCK_HELD",
)
PHASES = (
    "VALIDATE_EXACT_INPUTS",
    "START_POSTGRES_ONLY",
    "BOOTSTRAP_DATABASE_IDENTITY_AND_TECHNICAL_ROLES",
    "CONSUME_AND_RUN_EMPTY_MIGRATION",
    "UNFENCE_AND_RECONCILE_FINAL_RUNTIME_PRIVILEGES",
    "VERIFY_DATABASE_READY_WITH_RUNTIME_STOPPED",
)


class ContractError(Exception):
    """Stable, non-sensitive operator error."""


def fail(code: str) -> None:
    raise ContractError(code)


def canonical_json(value: Any) -> bytes:
    try:
        rendered = json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError):
        fail("ISOLATED_UAT_ROOT_OPERATIONS_CANONICAL_JSON_INVALID")
    return (rendered + "\n").encode("utf-8")


def digest(value: Any) -> str:
    raw = value if isinstance(value, bytes) else canonical_json(value)
    return hashlib.sha256(raw).hexdigest()


def strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            fail("ISOLATED_UAT_ROOT_OPERATIONS_JSON_DUPLICATE_KEY")
        value[key] = item
    return value


def reject_float(_: str) -> None:
    fail("ISOLATED_UAT_ROOT_OPERATIONS_JSON_NUMBER_INVALID")


def parse_json(raw: bytes, maximum: int = MAX_CONTROL_BYTES) -> Any:
    if not isinstance(maximum, int) or maximum < 1 or not raw or len(raw) > maximum or b"\x00" in raw or b"\r" in raw:
        fail("ISOLATED_UAT_ROOT_OPERATIONS_JSON_INVALID")
    try:
        return json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=strict_object,
            parse_float=reject_float,
            parse_constant=reject_float,
        )
    except ContractError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail("ISOLATED_UAT_ROOT_OPERATIONS_JSON_INVALID")


def exact(value: Any, fields: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != fields:
        fail(code)
    return value


def string(value: Any, pattern: re.Pattern[str], code: str) -> str:
    if (
        not isinstance(value, str)
        or value != unicodedata.normalize("NFC", value)
        or "\x00" in value
        or not pattern.fullmatch(value)
    ):
        fail(code)
    return value


def absolute_path(value: Any, code: str) -> PurePosixPath:
    if (
        not isinstance(value, str)
        or not value.startswith("/")
        or value.startswith("//")
        or len(value.encode()) > 4096
    ):
        fail(code)
    candidate = PurePosixPath(value)
    if str(candidate) != value or value == "/" or any(part in {"", ".", ".."} for part in candidate.parts):
        fail(code)
    return candidate


def overlaps(left: PurePosixPath, right: PurePosixPath) -> bool:
    return left == right or left in right.parents or right in left.parents


def validate_mutable_roots(roots: dict[str, Any]) -> dict[str, str]:
    fields = {
        "runtime_secret_root",
        "backup_credential_root",
        "release_candidate_root",
        "migration_grant_root",
        "state_root",
    }
    exact(roots, fields, "ISOLATED_UAT_ROOT_OPERATIONS_ROOTS_INVALID")
    normalized = {key: absolute_path(roots[key], "ISOLATED_UAT_ROOT_OPERATIONS_ROOT_INVALID") for key in fields}
    for candidate in normalized.values():
        if any(overlaps(candidate, protected) for protected in PROTECTED_ROOTS):
            fail("ISOLATED_UAT_ROOT_OPERATIONS_PROTECTED_ROOT")
    values = list(normalized.values())
    if any(overlaps(left, right) for index, left in enumerate(values) for right in values[index + 1 :]):
        fail("ISOLATED_UAT_ROOT_OPERATIONS_ROOTS_OVERLAP")
    return {key: str(value) for key, value in normalized.items()}


def reject_staffing_fields(value: Any) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if any(token in key.lower() for token in ("staff", "employee_count", "seat_count", "headcount")):
                fail("ISOLATED_UAT_ROOT_OPERATIONS_STAFFING_FIELD_FORBIDDEN")
            reject_staffing_fields(item)
    elif isinstance(value, list):
        for item in value:
            reject_staffing_fields(item)


def validate_request(value: Any) -> dict[str, Any]:
    request = exact(value, {
        "schema_version", "contract", "request_id", "project", "package_root",
        "compose_env_file", "source", "roots", "database",
    }, "ISOLATED_UAT_ROOT_OPERATIONS_REQUEST_FIELDS_INVALID")
    reject_staffing_fields(request)
    if request["schema_version"] != 1 or request["contract"] != REQUEST_CONTRACT:
        fail("ISOLATED_UAT_ROOT_OPERATIONS_REQUEST_IDENTITY_INVALID")
    request_id = string(
        request["request_id"], IDENTIFIER, "ISOLATED_UAT_ROOT_OPERATIONS_REQUEST_ID_INVALID"
    )
    if len(request_id) > 110:
        fail("ISOLATED_UAT_ROOT_OPERATIONS_REQUEST_ID_INVALID")
    project = string(request["project"], PROJECT, "ISOLATED_UAT_ROOT_OPERATIONS_PROJECT_INVALID")
    package_root = absolute_path(request["package_root"], "ISOLATED_UAT_ROOT_OPERATIONS_PACKAGE_ROOT_INVALID")
    compose_env = absolute_path(request["compose_env_file"], "ISOLATED_UAT_ROOT_OPERATIONS_COMPOSE_ENV_INVALID")
    expected_roots = {
        "runtime_secret_root": f"/etc/{project}/runtime-secrets",
        "backup_credential_root": f"/etc/{project}/operator-credentials",
        "release_candidate_root": f"/var/lib/{project}/release-candidate",
        "migration_grant_root": f"/var/lib/{project}/migration-grant",
        "state_root": f"/var/lib/{project}/root-operations-state",
    }
    if (
        str(package_root) != f"/var/lib/{project}/deployment-package"
        or str(compose_env) != f"{package_root}/render.env"
        or any(overlaps(package_root, protected) for protected in PROTECTED_ROOTS)
    ):
        fail("ISOLATED_UAT_ROOT_OPERATIONS_PACKAGE_ROOT_INVALID")
    if package_root not in compose_env.parents:
        fail("ISOLATED_UAT_ROOT_OPERATIONS_COMPOSE_ENV_INVALID")
    roots = validate_mutable_roots(request["roots"])
    if roots != expected_roots:
        fail("ISOLATED_UAT_ROOT_OPERATIONS_ROOTS_INVALID")

    source = exact(request["source"], {
        "package_version", "git_commit", "git_tree", "resolved_compose_sha256",
        "root_operations_package_sha256", "web_image", "web_image_config_digest",
        "worker_image", "worker_image_config_digest", "release_manifest_file",
        "release_manifest_sha256",
    }, "ISOLATED_UAT_ROOT_OPERATIONS_SOURCE_INVALID")
    string(source["package_version"], VERSION, "ISOLATED_UAT_ROOT_OPERATIONS_VERSION_INVALID")
    for field in ("git_commit", "git_tree"):
        value = string(source[field], GIT_SHA, "ISOLATED_UAT_ROOT_OPERATIONS_GIT_INVALID")
        if value == "0" * 40:
            fail("ISOLATED_UAT_ROOT_OPERATIONS_GIT_INVALID")
    for field in ("resolved_compose_sha256", "root_operations_package_sha256", "release_manifest_sha256"):
        value = string(source[field], SHA256, "ISOLATED_UAT_ROOT_OPERATIONS_DIGEST_INVALID")
        if value == "0" * 64:
            fail("ISOLATED_UAT_ROOT_OPERATIONS_DIGEST_INVALID")
    for field in ("web_image", "worker_image"):
        string(source[field], IMAGE, "ISOLATED_UAT_ROOT_OPERATIONS_IMAGE_INVALID")
    if source["web_image"] == source["worker_image"]:
        fail("ISOLATED_UAT_ROOT_OPERATIONS_IMAGE_INVALID")
    for field in ("web_image_config_digest", "worker_image_config_digest"):
        string(source[field], IMAGE_DIGEST, "ISOLATED_UAT_ROOT_OPERATIONS_IMAGE_INVALID")
    manifest = absolute_path(source["release_manifest_file"], "ISOLATED_UAT_ROOT_OPERATIONS_MANIFEST_PATH_INVALID")
    if manifest != PurePosixPath(roots["release_candidate_root"]) / "release-manifest.json":
        fail("ISOLATED_UAT_ROOT_OPERATIONS_MANIFEST_PATH_INVALID")

    database = exact(request["database"], {
        "name", "current_head", "target_head", "migration_count", "migration_allowlist_sha256", "marker",
    }, "ISOLATED_UAT_ROOT_OPERATIONS_DATABASE_INVALID")
    if (
        database["name"] != DATABASE_NAME
        or database["current_head"] != "EMPTY"
        or database["target_head"] != TARGET_HEAD
        or database["migration_count"] != 46
        or database["marker"] != f"chenyida-erp-deployment/v2:UAT:{project}"
    ):
        fail("ISOLATED_UAT_ROOT_OPERATIONS_DATABASE_INVALID")
    string(database["migration_allowlist_sha256"], SHA256, "ISOLATED_UAT_ROOT_OPERATIONS_DATABASE_INVALID")
    return copy.deepcopy(request)


def build_plan(request_input: Any) -> dict[str, Any]:
    request = validate_request(request_input)
    body = {
        "schema_version": 1,
        "contract": PLAN_CONTRACT,
        "mode": "READ_ONLY_PLAN",
        "execution_authorized": False,
        "request_sha256": digest(request),
        "request_id": request["request_id"],
        "project": request["project"],
        "root_operations_package_sha256": request["source"]["root_operations_package_sha256"],
        "protected_volumes": list(PROTECTED_VOLUMES),
        "phases": list(PHASES),
        "terminal_status": "DATABASE_READY_RUNTIME_SERVICES_NOT_STARTED",
        "excluded_actions": [
            "CREATE_OR_MODIFY_EMPLOYEE_ACCOUNTS",
            "START_WEB_WORKER_CADDY_OR_ADMIN",
            "USE_PRODUCTION_RUNNER_OR_TEST_MODE",
            "READ_OR_MODIFY_EXISTING_UAT_DATA",
            "DELETE_VOLUMES_OR_PRUNE",
        ],
    }
    return {**body, "plan_sha256": digest(body)}


def parse_instant(value: Any, code: str) -> dt.datetime:
    string(value, ISO_UTC, code)
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        fail(code)
    return parsed


def validate_authorization(value: Any, request_input: Any, now: dt.datetime) -> dict[str, Any]:
    request = validate_request(request_input)
    authorization = exact(value, {
        "schema_version", "contract", "authorization_id", "action", "request_sha256",
        "root_operations_package_sha256", "created_at", "expires_at", "authorization_sha256",
    }, "ISOLATED_UAT_ROOT_OPERATIONS_AUTHORIZATION_FIELDS_INVALID")
    if authorization["schema_version"] != 1 or authorization["contract"] != AUTHORIZATION_CONTRACT:
        fail("ISOLATED_UAT_ROOT_OPERATIONS_AUTHORIZATION_IDENTITY_INVALID")
    string(authorization["authorization_id"], IDENTIFIER, "ISOLATED_UAT_ROOT_OPERATIONS_AUTHORIZATION_ID_INVALID")
    if authorization["action"] != AUTHORIZED_ACTION:
        fail("ISOLATED_UAT_ROOT_OPERATIONS_ACTION_NOT_AUTHORIZED")
    if authorization["request_sha256"] != digest(request):
        fail("ISOLATED_UAT_ROOT_OPERATIONS_AUTHORIZATION_REQUEST_MISMATCH")
    if authorization["root_operations_package_sha256"] != request["source"]["root_operations_package_sha256"]:
        fail("ISOLATED_UAT_ROOT_OPERATIONS_AUTHORIZATION_PACKAGE_MISMATCH")
    created = parse_instant(authorization["created_at"], "ISOLATED_UAT_ROOT_OPERATIONS_AUTHORIZATION_TIME_INVALID")
    expires = parse_instant(authorization["expires_at"], "ISOLATED_UAT_ROOT_OPERATIONS_AUTHORIZATION_TIME_INVALID")
    if expires <= created or expires - created > dt.timedelta(minutes=30) or now < created - dt.timedelta(seconds=5) or now >= expires:
        fail("ISOLATED_UAT_ROOT_OPERATIONS_AUTHORIZATION_EXPIRED")
    body = {key: item for key, item in authorization.items() if key != "authorization_sha256"}
    if authorization["authorization_sha256"] != digest(body):
        fail("ISOLATED_UAT_ROOT_OPERATIONS_AUTHORIZATION_SHA256_INVALID")
    return copy.deepcopy(authorization)


def validate_execution_authorization_window(
    authorization_input: Any,
    request_input: Any,
    now: dt.datetime,
) -> dict[str, Any]:
    if not isinstance(now, dt.datetime) or now.tzinfo is None or now.utcoffset() != dt.timedelta(0):
        fail("ISOLATED_UAT_ROOT_OPERATIONS_CLOCK_INVALID")
    authorization = validate_authorization(authorization_input, request_input, now)
    expires = parse_instant(
        authorization["expires_at"], "ISOLATED_UAT_ROOT_OPERATIONS_AUTHORIZATION_TIME_INVALID"
    )
    if expires - now < dt.timedelta(minutes=15):
        fail("ISOLATED_UAT_ROOT_OPERATIONS_AUTHORIZATION_EXPIRES_TOO_SOON")
    return authorization


def database_identity(observation: Any, request_input: Any) -> dict[str, str]:
    request = validate_request(request_input)
    value = exact(observation, {
        "database_name", "database_system_identifier", "database_oid", "database_marker", "migration_role",
    }, "ISOLATED_UAT_ROOT_OPERATIONS_DATABASE_IDENTITY_INVALID")
    if (
        value["database_name"] != DATABASE_NAME
        or value["database_marker"] != request["database"]["marker"]
        or value["migration_role"] != MIGRATION_ROLE
    ):
        fail("ISOLATED_UAT_ROOT_OPERATIONS_DATABASE_IDENTITY_INVALID")
    string(value["database_system_identifier"], SYSTEM_IDENTIFIER, "ISOLATED_UAT_ROOT_OPERATIONS_DATABASE_IDENTITY_INVALID")
    string(value["database_oid"], OID, "ISOLATED_UAT_ROOT_OPERATIONS_DATABASE_IDENTITY_INVALID")
    return copy.deepcopy(value)


def build_migration_grant(
    request_input: Any,
    authorization_input: Any,
    identity_input: Any,
    created_at: dt.datetime,
) -> dict[str, Any]:
    request = validate_request(request_input)
    authorization = validate_authorization(authorization_input, request, created_at)
    identity = database_identity(identity_input, request)
    if created_at.microsecond % 1000:
        fail("ISOLATED_UAT_ROOT_OPERATIONS_CLOCK_INVALID")
    created = created_at.astimezone(dt.timezone.utc)
    authorization_expires = parse_instant(
        authorization["expires_at"], "ISOLATED_UAT_ROOT_OPERATIONS_AUTHORIZATION_TIME_INVALID"
    )
    expires = min(created + dt.timedelta(minutes=10), authorization_expires)
    if expires - created < dt.timedelta(minutes=2):
        fail("ISOLATED_UAT_ROOT_OPERATIONS_AUTHORIZATION_EXPIRES_TOO_SOON")
    body = {
        "schema_version": 1,
        "contract": GRANT_CONTRACT,
        "execution_scope": "DEDICATED_ISOLATED_UAT_MIGRATION",
        "promotion_id": request["request_id"],
        "migration_operation_id": f"{request['request_id']}-migration",
        "execution_authorization_sha256": authorization["authorization_sha256"],
        "root_operations_package_sha256": request["source"]["root_operations_package_sha256"],
        "release_manifest_sha256": request["source"]["release_manifest_sha256"],
        "worker_image": request["source"]["worker_image"],
        "migration_manifest_sha256": request["database"]["migration_allowlist_sha256"],
        "expected_current_head": "EMPTY",
        "target_head": TARGET_HEAD,
        "database": {
            "deployment_class": "UAT",
            "deployment_id": request["project"],
            "database_name": identity["database_name"],
            "database_system_identifier": identity["database_system_identifier"],
            "database_oid": identity["database_oid"],
            "database_marker": identity["database_marker"],
            "migration_role": identity["migration_role"],
            "control_role": CONTROL_ROLE,
        },
        "created_at": created.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "expires_at": expires.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }
    if len(body["migration_operation_id"]) > 120:
        fail("ISOLATED_UAT_ROOT_OPERATIONS_MIGRATION_OPERATION_ID_INVALID")
    return {**body, "grant_sha256": digest(body)}


class OperationsPort(Protocol):
    def validate_preflight(self, request: dict[str, Any]) -> dict[str, Any]: ...
    def validate_release_manifest(self, request: dict[str, Any]) -> None: ...
    def start_postgres_only(self, request: dict[str, Any]) -> None: ...
    def observe_empty_database(self, request: dict[str, Any]) -> dict[str, Any]: ...
    def bootstrap_database(self, request: dict[str, Any], observation: dict[str, Any]) -> dict[str, Any]: ...
    def observe_bootstrapped_database(self, request: dict[str, Any]) -> dict[str, str]: ...
    def stage_migration_grant(self, request: dict[str, Any], grant: dict[str, Any]) -> None: ...
    def run_migration(self, request: dict[str, Any], identity: dict[str, str], grant: dict[str, Any]) -> dict[str, Any]: ...
    def verify_migration(
        self,
        request: dict[str, Any],
        identity: dict[str, str],
        bootstrap: dict[str, Any],
        grant: dict[str, Any],
        result: dict[str, Any],
    ) -> dict[str, Any]: ...
    def unfence_database(self, request: dict[str, Any], migration: dict[str, Any]) -> dict[str, Any]: ...
    def reconcile_final_privileges(
        self, request: dict[str, Any], migration: dict[str, Any], unfence: dict[str, Any]
    ) -> dict[str, Any]: ...
    def verify_final_database(
        self,
        request: dict[str, Any],
        identity: dict[str, str],
        migration: dict[str, Any],
        unfence: dict[str, Any],
        reconciliation: dict[str, Any],
    ) -> dict[str, Any]: ...
    def contain_failure(self, request: dict[str, Any]) -> dict[str, Any]: ...


def stable_directory_identity(
    path: Path,
    *,
    mode: int,
    enforce_root: bool,
) -> tuple[int, int, int, int, int]:
    if not path.is_absolute():
        fail("ISOLATED_UAT_ROOT_OPERATIONS_STATE_ROOT_INVALID")
    expected_uid = 0 if enforce_root else os.getuid()
    expected_gid = 0 if enforce_root else os.getgid()
    allowed_ancestor_uids = {0} if enforce_root else {0, expected_uid}
    cursor = Path(path.anchor)
    try:
        for component in path.parts[1:]:
            cursor /= component
            metadata = cursor.lstat()
            if (
                not stat.S_ISDIR(metadata.st_mode)
                or stat.S_ISLNK(metadata.st_mode)
                or metadata.st_uid not in allowed_ancestor_uids
                or (enforce_root and metadata.st_gid != 0)
                or stat.S_IMODE(metadata.st_mode) & 0o022
            ):
                fail("ISOLATED_UAT_ROOT_OPERATIONS_STATE_ANCESTOR_INVALID")
        metadata = path.lstat()
        resolved = path.resolve(strict=True)
    except OSError:
        fail("ISOLATED_UAT_ROOT_OPERATIONS_STATE_ROOT_INVALID")
    if (
        resolved != path
        or metadata.st_uid != expected_uid
        or metadata.st_gid != expected_gid
        or stat.S_IMODE(metadata.st_mode) != mode
    ):
        fail("ISOLATED_UAT_ROOT_OPERATIONS_STATE_ROOT_INVALID")
    return (metadata.st_dev, metadata.st_ino, metadata.st_mode, metadata.st_uid, metadata.st_gid)


class DurableState:
    """Small create-only journal; an ambiguous run is recovery-only, never replayed."""

    def __init__(self, root: Path, *, enforce_root: bool = True):
        self.root = root
        self.enforce_root = enforce_root
        self.identity: tuple[int, int, int, int, int] | None = None

    def validate_empty(self) -> None:
        identity = stable_directory_identity(self.root, mode=0o700, enforce_root=self.enforce_root)
        directory = -1
        try:
            directory = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
            opened = os.fstat(directory)
            entries = os.listdir(directory)
        except OSError:
            fail("ISOLATED_UAT_ROOT_OPERATIONS_STATE_ROOT_INVALID")
        finally:
            if directory >= 0:
                os.close(directory)
        opened_identity = (opened.st_dev, opened.st_ino, opened.st_mode, opened.st_uid, opened.st_gid)
        if opened_identity != identity:
            fail("ISOLATED_UAT_ROOT_OPERATIONS_STATE_ROOT_CHANGED")
        if entries:
            fail("ISOLATED_UAT_ROOT_OPERATIONS_RECOVERY_REQUIRED")
        self.identity = identity

    def append(self, filename: str, value: Any, mode: int = 0o400) -> None:
        if not re.fullmatch(r"[a-z][a-z0-9-]{0,62}\.json", filename):
            fail("ISOLATED_UAT_ROOT_OPERATIONS_STATE_FILENAME_INVALID")
        if self.identity is None or stable_directory_identity(
            self.root, mode=0o700, enforce_root=self.enforce_root,
        ) != self.identity:
            fail("ISOLATED_UAT_ROOT_OPERATIONS_STATE_ROOT_CHANGED")
        raw = canonical_json(value)
        directory = -1
        descriptor = -1
        try:
            directory = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
            opened = os.fstat(directory)
            if (opened.st_dev, opened.st_ino, opened.st_mode, opened.st_uid, opened.st_gid) != self.identity:
                fail("ISOLATED_UAT_ROOT_OPERATIONS_STATE_ROOT_CHANGED")
            descriptor = os.open(
                filename,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                mode,
                dir_fd=directory,
            )
            os.fchmod(descriptor, mode)
            if self.enforce_root:
                os.fchown(descriptor, 0, 0)
            written = 0
            while written < len(raw):
                count = os.write(descriptor, raw[written:])
                if count <= 0:
                    fail("ISOLATED_UAT_ROOT_OPERATIONS_STATE_WRITE_FAILED")
                written += count
            os.fsync(descriptor)
            os.close(descriptor)
            descriptor = -1
            os.fsync(directory)
        except FileExistsError:
            fail("ISOLATED_UAT_ROOT_OPERATIONS_RECOVERY_REQUIRED")
        except OSError:
            fail("ISOLATED_UAT_ROOT_OPERATIONS_STATE_WRITE_FAILED")
        finally:
            if descriptor >= 0:
                os.close(descriptor)
            if directory >= 0:
                os.close(directory)


def execute_database_preparation(
    request_input: Any,
    authorization_input: Any,
    port: OperationsPort,
    state: DurableState,
    *,
    clock: Callable[[], dt.datetime],
) -> dict[str, Any]:
    request = validate_request(request_input)
    now = clock()
    authorization = validate_execution_authorization_window(authorization_input, request, now)
    state.validate_empty()
    preflight = port.validate_preflight(request)
    if preflight.get("status") != "ELIGIBLE_INPUTS_VERIFIED":
        fail("ISOLATED_UAT_ROOT_OPERATIONS_PREFLIGHT_INVALID")
    # Preflight is deliberately read-only but may be slow.  Revalidate the
    # exact authorization with a fresh clock before the first durable intent,
    # helper container, Compose mutation, or database write.
    authorization = validate_execution_authorization_window(
        authorization_input,
        request,
        clock(),
    )
    state.append("execution-intent.json", {
        "request_sha256": digest(request),
        "authorization_sha256": authorization["authorization_sha256"],
        "package_sha256": request["source"]["root_operations_package_sha256"],
        "state": "PREPARED",
    })
    state.append("execution-authorization-consumed.json", {
        "authorization_sha256": authorization["authorization_sha256"],
        "state": "CONSUMED_BEFORE_FIRST_RUNTIME_ACTION",
    })
    try:
        port.validate_release_manifest(request)
        port.start_postgres_only(request)
        empty = port.observe_empty_database(request)
        bootstrap = port.bootstrap_database(request, empty)
        if bootstrap.get("status") != "BOOTSTRAP_VERIFIED":
            fail("ISOLATED_UAT_ROOT_OPERATIONS_BOOTSTRAP_RESULT_INVALID")
        state.append("database-bootstrap-verified.json", bootstrap)
        identity = database_identity(port.observe_bootstrapped_database(request), request)
        # A second observation closes the bootstrap-to-grant identity race.
        if database_identity(port.observe_bootstrapped_database(request), request) != identity:
            fail("ISOLATED_UAT_ROOT_OPERATIONS_DATABASE_IDENTITY_CHANGED")
        grant = build_migration_grant(request, authorization, identity, clock())
        port.stage_migration_grant(request, grant)
        state.append("migration-grant-prepared.json", {
            "grant_sha256": grant["grant_sha256"],
            "database": grant["database"],
            "state": "PREPARED",
        })
        state.append("migration-grant-consumed.json", {
            "grant_sha256": grant["grant_sha256"],
            "authorization_sha256": authorization["authorization_sha256"],
            "state": "CONSUMED_BEFORE_MIGRATION_DISPATCH",
        })
        migration_result = port.run_migration(request, identity, grant)
        migration = port.verify_migration(request, identity, bootstrap, grant, migration_result)
        if migration.get("status") != "MIGRATION_COMMITTED_EXACT_LEDGER_VERIFIED":
            fail("ISOLATED_UAT_ROOT_OPERATIONS_MIGRATION_RESULT_INVALID")
        state.append("database-migration-verified.json", migration)
        unfence = port.unfence_database(request, migration)
        if unfence.get("status") != "UNFENCE_VERIFIED":
            fail("ISOLATED_UAT_ROOT_OPERATIONS_UNFENCE_RESULT_INVALID")
        state.append("database-unfence-verified.json", unfence)
        reconciliation = port.reconcile_final_privileges(request, migration, unfence)
        if reconciliation.get("status") != "FINAL_RECONCILIATION_APPLIED_PENDING_VERIFICATION":
            fail("ISOLATED_UAT_ROOT_OPERATIONS_RECONCILIATION_RESULT_INVALID")
        state.append("database-final-reconciliation-applied.json", reconciliation)
        final = port.verify_final_database(request, identity, migration, unfence, reconciliation)
        if final.get("status") != "FINAL_RUNTIME_PRIVILEGES_VERIFIED":
            fail("ISOLATED_UAT_ROOT_OPERATIONS_FINAL_VERIFICATION_INVALID")
        state.append("database-final-privileges-verified.json", final)
        body = {
            "schema_version": 1,
            "contract": RESULT_CONTRACT,
            "status": "DATABASE_READY_RUNTIME_SERVICES_NOT_STARTED",
            "request_sha256": digest(request),
            "authorization_sha256": authorization["authorization_sha256"],
            "grant_sha256": grant["grant_sha256"],
            "database": identity,
            "migration_result_sha256": digest(migration_result),
            "migration_verification_sha256": digest(migration),
            "unfence_verification_sha256": digest(unfence),
            "reconciliation_verification_sha256": digest(reconciliation),
            "final_verification_sha256": digest(final),
        }
        result = {**body, "result_sha256": digest(body)}
        state.append("database-preparation-result.json", result)
        return result
    except BaseException as error:
        containment: dict[str, Any]
        try:
            containment = port.contain_failure(request)
            if not isinstance(containment, dict) or containment.get("status") != "QUARANTINED_RUNTIME_STOPPED":
                containment = {"status": "CONTAINMENT_FAILED_MANUAL_INTERVENTION_REQUIRED"}
        except BaseException:
            containment = {"status": "CONTAINMENT_FAILED_MANUAL_INTERVENTION_REQUIRED"}
        try:
            state.append("quarantined.json", {
                "state": "QUARANTINED_MANUAL_RECOVERY_REQUIRED",
                "error_code": str(error) if isinstance(error, ContractError) else "ISOLATED_UAT_ROOT_OPERATIONS_RUNTIME_FAILED",
                "containment": containment,
            })
        except ContractError:
            pass
        if containment["status"] != "QUARANTINED_RUNTIME_STOPPED":
            raise ContractError("ISOLATED_UAT_ROOT_OPERATIONS_CONTAINMENT_FAILED") from error
        raise


def read_control_file(path: Path, *, modes: set[int], enforce_root: bool = True) -> Any:
    if not path.is_absolute():
        fail("ISOLATED_UAT_ROOT_OPERATIONS_CONTROL_FILE_INVALID")
    expected_uid = 0 if enforce_root else os.getuid()
    expected_gid = 0 if enforce_root else os.getgid()
    cursor = Path(path.anchor)
    for component in path.parts[1:-1]:
        cursor /= component
        try:
            ancestor = cursor.lstat()
        except OSError:
            fail("ISOLATED_UAT_ROOT_OPERATIONS_CONTROL_FILE_INVALID")
        if (
            not stat.S_ISDIR(ancestor.st_mode)
            or stat.S_ISLNK(ancestor.st_mode)
            or ancestor.st_uid != expected_uid
            or ancestor.st_gid != expected_gid
            or stat.S_IMODE(ancestor.st_mode) & 0o022
        ):
            fail("ISOLATED_UAT_ROOT_OPERATIONS_CONTROL_ANCESTOR_INVALID")
    try:
        before = path.lstat()
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    except OSError:
        fail("ISOLATED_UAT_ROOT_OPERATIONS_CONTROL_FILE_INVALID")
    try:
        opened = os.fstat(descriptor)
        raw = b""
        while True:
            chunk = os.read(descriptor, 64 * 1024)
            if not chunk:
                break
            raw += chunk
            if len(raw) > MAX_CONTROL_BYTES:
                fail("ISOLATED_UAT_ROOT_OPERATIONS_CONTROL_FILE_INVALID")
        after = os.fstat(descriptor)
        pointed = path.lstat()
    finally:
        os.close(descriptor)
    identities = (before, opened, after, pointed)
    if any(
        not stat.S_ISREG(item.st_mode)
        or item.st_uid != expected_uid
        or item.st_gid != expected_gid
        or item.st_nlink != 1
        or stat.S_IMODE(item.st_mode) not in modes
        for item in identities
    ):
        fail("ISOLATED_UAT_ROOT_OPERATIONS_CONTROL_FILE_INVALID")
    keys = ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns")
    if any(getattr(item, key) != getattr(before, key) for item in identities[1:] for key in keys):
        fail("ISOLATED_UAT_ROOT_OPERATIONS_CONTROL_FILE_CHANGED")
    value = parse_json(raw)
    if raw != canonical_json(value):
        fail("ISOLATED_UAT_ROOT_OPERATIONS_CONTROL_FILE_NONCANONICAL")
    return value


def verify_root_operations_package(request_input: Any) -> None:
    """Check the trusted root package once without building an in-memory copy."""

    request = validate_request(request_input)
    package_root = Path(request["package_root"])
    cursor = Path(package_root.anchor)
    try:
        for component in package_root.parts[1:-1]:
            cursor /= component
            ancestor = cursor.lstat()
            if (
                not stat.S_ISDIR(ancestor.st_mode)
                or stat.S_ISLNK(ancestor.st_mode)
                or ancestor.st_uid != 0
                or ancestor.st_gid != 0
                or stat.S_IMODE(ancestor.st_mode) & 0o022
            ):
                fail("ISOLATED_UAT_ROOT_OPERATIONS_PACKAGE_ANCESTOR_INVALID")
        metadata = package_root.lstat()
        resolved = package_root.resolve(strict=True)
        running_root = Path(__file__).resolve(strict=True).parent.parent
    except OSError:
        fail("ISOLATED_UAT_ROOT_OPERATIONS_PACKAGE_ROOT_INVALID")
    if (
        resolved != package_root
        or running_root != package_root
        or not stat.S_ISDIR(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or metadata.st_uid != 0
        or metadata.st_gid != 0
        or stat.S_IMODE(metadata.st_mode) != 0o700
    ):
        fail("ISOLATED_UAT_ROOT_OPERATIONS_PACKAGE_ROOT_INVALID")
    members: list[dict[str, Any]] = []
    total = 0
    for relative in ROOT_OPERATIONS_PACKAGE_MEMBERS:
        member = package_root / relative
        try:
            metadata = member.lstat()
            if (
                member.resolve(strict=True) != member
                or not stat.S_ISREG(metadata.st_mode)
                or metadata.st_uid != 0
                or metadata.st_gid != 0
                or metadata.st_nlink != 1
                or stat.S_IMODE(metadata.st_mode) & 0o022
                or metadata.st_size > MAX_PACKAGE_MEMBER_BYTES
            ):
                fail("ISOLATED_UAT_ROOT_OPERATIONS_PACKAGE_MEMBER_INVALID")
            raw = member.read_bytes()
        except OSError:
            fail("ISOLATED_UAT_ROOT_OPERATIONS_PACKAGE_MEMBER_INVALID")
        if len(raw) != metadata.st_size:
            fail("ISOLATED_UAT_ROOT_OPERATIONS_PACKAGE_MEMBER_CHANGED")
        total += len(raw)
        if total > MAX_PACKAGE_BYTES:
            fail("ISOLATED_UAT_ROOT_OPERATIONS_PACKAGE_INVALID")
        members.append({
            "path": relative,
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        })
    package_sha256 = digest({"schema_version": 1, "members": members})
    if package_sha256 != request["source"]["root_operations_package_sha256"]:
        fail("ISOLATED_UAT_ROOT_OPERATIONS_PACKAGE_SHA256_MISMATCH")


def assert_execution_environment() -> None:
    if os.geteuid() != 0:
        fail("ISOLATED_UAT_ROOT_OPERATIONS_ROOT_REQUIRED")
    if os.environ.get("NODE_ENV") == "test" or any(os.environ.get(name) for name in FORBIDDEN_EXECUTION_ENVIRONMENT):
        fail("ISOLATED_UAT_ROOT_OPERATIONS_FORBIDDEN_EXECUTION_MODE")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    subcommands = result.add_subparsers(dest="command", required=True)
    plan = subcommands.add_parser("plan")
    plan.add_argument("--request", required=True, type=Path)
    execute = subcommands.add_parser("execute")
    execute.add_argument("--request", required=True, type=Path)
    execute.add_argument("--authorization", required=True, type=Path)
    execute.add_argument("--confirm", required=True)
    return result


def utc_now() -> dt.datetime:
    value = dt.datetime.now(dt.timezone.utc)
    return value.replace(microsecond=(value.microsecond // 1000) * 1000)


def load_system_port(request: dict[str, Any]) -> OperationsPort:
    """Load the fixed source path without creating bytecode in the package."""

    source = Path(request["package_root"]) / "scripts/isolated-uat-root-system-port.py"
    try:
        namespace = runpy.run_path(
            str(source),
            run_name="isolated_uat_root_system_port",
        )
        factory = namespace.get("create_system_port")
        if not callable(factory):
            fail("ISOLATED_UAT_ROOT_OPERATIONS_SYSTEM_PORT_INVALID")
        port = factory(
            request,
            SimpleNamespace(
                canonical_json=canonical_json,
                digest=digest,
                parse_json=parse_json,
                fail=fail,
            ),
        )
    except ContractError:
        raise
    except Exception:
        fail("ISOLATED_UAT_ROOT_OPERATIONS_SYSTEM_PORT_INVALID")
    return port


def prepare_execution(
    request_input: Any,
    authorization_input: Any,
    now: dt.datetime,
) -> tuple[dict[str, Any], dict[str, Any], OperationsPort]:
    request = validate_request(request_input)
    authorization = validate_execution_authorization_window(authorization_input, request, now)
    verify_root_operations_package(request)
    return request, authorization, load_system_port(request)


def main(arguments: list[str] | None = None) -> int:
    try:
        args = parser().parse_args(arguments)
        request = read_control_file(args.request, modes={0o400, 0o440})
        if args.command == "plan":
            sys.stdout.buffer.write(canonical_json(build_plan(request)))
            return 0
        if args.confirm != EXECUTION_CONFIRMATION:
            fail("ISOLATED_UAT_ROOT_OPERATIONS_CONFIRMATION_INVALID")
        assert_execution_environment()
        authorization = read_control_file(args.authorization, modes={0o400, 0o440})
        validated_request, validated_authorization, port = prepare_execution(request, authorization, utc_now())
        result = execute_database_preparation(
            validated_request,
            validated_authorization,
            port,
            DurableState(Path(validated_request["roots"]["state_root"])),
            clock=utc_now,
        )
        sys.stdout.buffer.write(canonical_json(result))
        return 0
    except ContractError as error:
        print(str(error), file=sys.stderr)
        return 1
    except Exception:
        print("ISOLATED_UAT_ROOT_OPERATIONS_INTERNAL_ERROR", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
