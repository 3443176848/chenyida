#!/usr/bin/python3
"""Validate the small, non-executing request for one isolated UAT namespace."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path, PurePosixPath
from typing import Any


SITE_ROOT = Path(__file__).resolve().parent.parent
POLICY_CONTRACT = "chenyida-erp-isolated-uat-control-plane-policy/v1"
REQUEST_CONTRACT = "chenyida-erp-isolated-uat-control-plane-request/v1"
MAX_JSON_BYTES = 2 * 1024 * 1024
SHA256 = re.compile(r"^[0-9a-f]{64}$")
GIT_OBJECT = re.compile(r"^[0-9a-f]{40}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
PROJECT = re.compile(r"^chenyida-erp-uat-[a-z0-9][a-z0-9_-]{0,42}$")
IMAGE = re.compile(r"^[^@\s]+@sha256:[0-9a-f]{64}$")
MIGRATION = re.compile(r"^[0-9]{4}_[a-z0-9_]+\.sql$")

ROOTS = {
    "runtime_secret_root": "/etc/{project}/runtime-secrets",
    "backup_credential_root": "/etc/{project}/operator-credentials",
    "release_candidate_root": "/var/lib/{project}/release-candidate",
    "release_identity_root": "/var/lib/{project}/release-identity",
    "operator_state_root": "/var/lib/{project}/postgresql-runtime-privilege-operator",
    "backup_root": "/var/backups/{project}",
}
PROTECTED_ROOTS = [
    "/etc/chenyida-erp",
    "/var/lib/chenyida-erp",
    "/var/backups/chenyida-erp-v2",
]
RUNTIME_FILES = [
    "admin-database-password",
    "admin-password",
    "migration-database-password",
    "postgres-bootstrap-password",
    "web-database-password",
    "worker-database-password",
]
ROLE_CREDENTIALS = {
    "chenyida_erp_admin": "admin-database-password",
    "chenyida_erp_backup": "backup-capture-service.conf",
    "chenyida_erp_owner": "migration-database-password",
    "chenyida_erp_web": "web-database-password",
    "chenyida_erp_worker": "worker-database-password",
}
SOURCE_PATHS = [
    ".env.uat-isolated.example",
    "compose.uat-isolated.yml",
    "operations/postgresql-runtime-privilege-policy-v2.json",
    "operations/runtime-secret-file-policy-v1.json",
    "scripts/isolated-uat-compose-policy.py",
    "scripts/isolated-uat-control-plane-policy.py",
    "scripts/isolated-uat-one-shot.py",
]


class ContractError(Exception):
    pass


def fail(code: str) -> None:
    raise ContractError(code)


def strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            fail("ISOLATED_UAT_JSON_DUPLICATE_KEY")
        result[key] = value
    return result


def parse_json(raw: bytes, code: str) -> dict[str, Any]:
    if not raw or len(raw) > MAX_JSON_BYTES:
        fail(code)
    try:
        value = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=strict_object,
            parse_constant=lambda _: fail(code),
        )
    except ContractError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail(code)
    if not isinstance(value, dict):
        fail(code)
    return value


def exact(value: Any, keys: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        fail(code)
    return value


def canonical_sha256(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def file_sha256(path: Path) -> str:
    try:
        if not path.is_file() or path.is_symlink():
            fail("ISOLATED_UAT_POLICY_SOURCE_INVALID")
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        fail("ISOLATED_UAT_POLICY_SOURCE_INVALID")


def source_state() -> dict[str, Any]:
    directory = SITE_ROOT / "drizzle-postgres"
    files = sorted(directory.glob("*.sql"))
    if not files or any(
        path.is_symlink() or not MIGRATION.fullmatch(path.name) or int(path.name[:4]) != index
        for index, path in enumerate(files, 1)
    ):
        fail("ISOLATED_UAT_MIGRATION_SOURCE_INVALID")
    entries = [
        {"ordinal": index, "filename": path.name, "sha256": file_sha256(path)}
        for index, path in enumerate(files, 1)
    ]
    try:
        package = parse_json((SITE_ROOT / "package.json").read_bytes(), "ISOLATED_UAT_PACKAGE_SOURCE_INVALID")
        journal = parse_json(
            (directory / "meta/_journal.json").read_bytes(),
            "ISOLATED_UAT_MIGRATION_SOURCE_INVALID",
        )
    except OSError:
        fail("ISOLATED_UAT_PACKAGE_SOURCE_INVALID")
    journal_entries = journal.get("entries")
    if journal.get("version") != "7" or journal.get("dialect") != "postgresql" \
            or not isinstance(journal_entries, list) or len(journal_entries) != len(files):
        fail("ISOLATED_UAT_MIGRATION_SOURCE_INVALID")
    if any(
        not isinstance(entry, dict) or entry.get("idx") != index or entry.get("version") != "7"
        or entry.get("tag") != path.stem or entry.get("breakpoints") is not True
        for index, (entry, path) in enumerate(zip(journal_entries, files), 1)
    ):
        fail("ISOLATED_UAT_MIGRATION_SOURCE_INVALID")
    version = package.get("version")
    if not isinstance(version, str) or not version:
        fail("ISOLATED_UAT_PACKAGE_SOURCE_INVALID")
    allowlist = json.dumps(entries, ensure_ascii=False, separators=(",", ":")) + "\n"
    return {
        "package_version": version,
        "current_head": "EMPTY",
        "target_head": files[-1].name,
        "migration_count": len(files),
        "migration_allowlist_sha256": hashlib.sha256(allowlist.encode("utf-8")).hexdigest(),
    }


def normalized_path(value: Any, code: str) -> PurePosixPath:
    if not isinstance(value, str) or not value.startswith("/") or value == "/" or len(value) > 512:
        fail(code)
    path = PurePosixPath(value)
    if str(path) != value or any(character in value for character in ("\x00", "\n", "\r")):
        fail(code)
    return path


def overlaps(left: PurePosixPath, right: PurePosixPath) -> bool:
    return left == right or left in right.parents or right in left.parents


def validate_roots(project: str, value: Any) -> dict[str, str]:
    roots = exact(value, set(ROOTS), "ISOLATED_UAT_ROOT_FIELDS_INVALID")
    expected = {key: template.format(project=project) for key, template in ROOTS.items()}
    if roots != expected:
        fail("ISOLATED_UAT_ROOT_TEMPLATE_MISMATCH")
    paths = [normalized_path(roots[key], "ISOLATED_UAT_ROOT_INVALID") for key in ROOTS]
    protected = [PurePosixPath(path) for path in PROTECTED_ROOTS]
    if any(overlaps(path, item) for path in paths for item in protected):
        fail("ISOLATED_UAT_ROOT_OVERLAPS_PROTECTED")
    if any(overlaps(path, other) for index, path in enumerate(paths) for other in paths[index + 1 :]):
        fail("ISOLATED_UAT_ROOTS_OVERLAP")
    return roots


def validate_policy(value: dict[str, Any]) -> dict[str, Any]:
    exact(value, {
        "schema_version", "contract", "policy_id", "deployment_authorized", "namespace",
        "release", "database", "secrets", "safety", "source_binding", "policy_sha256",
    }, "ISOLATED_UAT_POLICY_FIELDS_INVALID")
    if value["schema_version"] != 1 or value["contract"] != POLICY_CONTRACT \
            or value["policy_id"] != "chenyida-erp-isolated-uat-one-shot-bootstrap-v1" \
            or value["deployment_authorized"] is not False:
        fail("ISOLATED_UAT_POLICY_IDENTITY_INVALID")
    state = source_state()
    if value["namespace"] != {
        "project_pattern": PROJECT.pattern,
        "roots": ROOTS,
        "protected_roots": PROTECTED_ROOTS,
        "shared_lock": "/run/lock/chenyida-erp-release-gate-v1.lock",
        "shared_lock_use": "SERIALIZATION_ONLY",
    }:
        fail("ISOLATED_UAT_POLICY_NAMESPACE_INVALID")
    if value["release"] != {
        "producer": "DEDICATED_ISOLATED_UAT_ONE_SHOT",
        "implementation_status": "CONTRACT_ONLY_NOT_EXECUTABLE",
        "production_supervisor_allowed": False,
        "package_version": state["package_version"],
        "required_inputs": [
            "control_policy_sha256", "git_commit", "git_tree", "migration_allowlist_sha256",
            "web_image_reference", "web_image_config_digest", "worker_image_reference",
            "worker_image_config_digest", "resolved_compose_sha256",
        ],
    }:
        fail("ISOLATED_UAT_POLICY_RELEASE_INVALID")
    if value["database"] != {
        "name": "chenyida_erp",
        "current_head": state["current_head"],
        "target_head": state["target_head"],
        "migration_count": state["migration_count"],
        "migration_allowlist_sha256": state["migration_allowlist_sha256"],
        "operator": "DEDICATED_ISOLATED_UAT_ONE_SHOT",
        "implementation_status": "CONTRACT_ONLY_NOT_EXECUTABLE",
        "production_runner_allowed": False,
        "role_credentials": ROLE_CREDENTIALS,
    }:
        fail("ISOLATED_UAT_POLICY_DATABASE_INVALID")
    if value["secrets"] != {
        "runtime_files": RUNTIME_FILES,
        "backup_service_file": "backup-capture-service.conf",
        "password_format": "32_BYTE_CSPRNG_CANONICAL_BASE64URL",
        "all_values_distinct": True,
        "values_in_request": False,
    }:
        fail("ISOLATED_UAT_POLICY_SECRETS_INVALID")
    if value["safety"] != {
        "deployment_class": "UAT",
        "recovery": "DISPOSABLE_SYNTHETIC_RECREATE_FROM_EMPTY",
        "staffing": "APPLICATION_CONFIGURATION_NOT_INFRASTRUCTURE_CARDINALITY",
        "production_data_allowed": False,
        "runtime_actions_authorized": [],
    }:
        fail("ISOLATED_UAT_POLICY_SAFETY_INVALID")
    bindings = value["source_binding"]
    if not isinstance(bindings, list) or [item.get("path") if isinstance(item, dict) else None for item in bindings] != SOURCE_PATHS:
        fail("ISOLATED_UAT_POLICY_SOURCE_BINDING_INVALID")
    for binding in bindings:
        exact(binding, {"path", "sha256"}, "ISOLATED_UAT_POLICY_SOURCE_BINDING_INVALID")
        if not SHA256.fullmatch(binding["sha256"]) or file_sha256(SITE_ROOT / binding["path"]) != binding["sha256"]:
            fail("ISOLATED_UAT_POLICY_SOURCE_BINDING_STALE")
    body = {key: item for key, item in value.items() if key != "policy_sha256"}
    if not SHA256.fullmatch(value["policy_sha256"]) or canonical_sha256(body) != value["policy_sha256"]:
        fail("ISOLATED_UAT_POLICY_SHA256_INVALID")
    return value


def validate_request(value: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    exact(value, {
        "schema_version", "contract", "request_id", "policy_sha256", "project", "roots",
        "source", "images", "ports", "runtime_actions_authorized", "request_only",
    }, "ISOLATED_UAT_REQUEST_FIELDS_INVALID")
    if value["schema_version"] != 1 or value["contract"] != REQUEST_CONTRACT \
            or not isinstance(value["request_id"], str) or not IDENTIFIER.fullmatch(value["request_id"]) \
            or value["policy_sha256"] != policy["policy_sha256"]:
        fail("ISOLATED_UAT_REQUEST_IDENTITY_INVALID")
    project = value["project"]
    if not isinstance(project, str) or not PROJECT.fullmatch(project):
        fail("ISOLATED_UAT_PROJECT_INVALID")
    validate_roots(project, value["roots"])
    source = exact(value["source"], {
        "package_version", "git_commit", "git_tree", "migration_current_head",
        "migration_target_head", "migration_allowlist_sha256", "resolved_compose_sha256",
    }, "ISOLATED_UAT_REQUEST_SOURCE_INVALID")
    state = policy["database"]
    if source["package_version"] != policy["release"]["package_version"] \
            or source["migration_current_head"] != state["current_head"] \
            or source["migration_target_head"] != state["target_head"] \
            or source["migration_allowlist_sha256"] != state["migration_allowlist_sha256"] \
            or not GIT_OBJECT.fullmatch(source["git_commit"] if isinstance(source["git_commit"], str) else "") \
            or not GIT_OBJECT.fullmatch(source["git_tree"] if isinstance(source["git_tree"], str) else "") \
            or not SHA256.fullmatch(source["resolved_compose_sha256"] if isinstance(source["resolved_compose_sha256"], str) else ""):
        fail("ISOLATED_UAT_REQUEST_SOURCE_INVALID")
    images = exact(value["images"], {"web", "worker"}, "ISOLATED_UAT_REQUEST_IMAGES_INVALID")
    for image in images.values():
        exact(image, {"image_reference", "config_digest"}, "ISOLATED_UAT_REQUEST_IMAGE_INVALID")
        if not IMAGE.fullmatch(image.get("image_reference") if isinstance(image.get("image_reference"), str) else "") \
                or not re.fullmatch(r"sha256:[0-9a-f]{64}", image.get("config_digest") if isinstance(image.get("config_digest"), str) else ""):
            fail("ISOLATED_UAT_REQUEST_IMAGE_INVALID")
    ports = exact(value["ports"], {"host_ip", "web", "caddy_http", "caddy_https"}, "ISOLATED_UAT_REQUEST_PORTS_INVALID")
    numbers = [ports.get("web"), ports.get("caddy_http"), ports.get("caddy_https")]
    if ports.get("host_ip") != "127.0.0.1" \
            or any(type(port) is not int or port < 1024 or port > 65535 or port == 3000 for port in numbers) \
            or len(set(numbers)) != 3:
        fail("ISOLATED_UAT_REQUEST_PORTS_INVALID")
    if value["runtime_actions_authorized"] != [] or value["request_only"] is not True:
        fail("ISOLATED_UAT_REQUEST_AUTHORIZATION_INVALID")
    return value


def read_policy(path: Path) -> dict[str, Any]:
    try:
        raw = path.read_bytes()
    except OSError:
        fail("ISOLATED_UAT_POLICY_FILE_INVALID")
    return validate_policy(parse_json(raw, "ISOLATED_UAT_POLICY_FILE_INVALID"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("verify-policy", "validate-request"))
    parser.add_argument("--policy", required=True)
    try:
        arguments = parser.parse_args(argv)
        policy = read_policy(Path(arguments.policy))
        if arguments.command == "validate-request":
            request = parse_json(sys.stdin.buffer.read(MAX_JSON_BYTES + 1), "ISOLATED_UAT_REQUEST_JSON_INVALID")
            validate_request(request, policy)
    except ContractError as error:
        print(str(error), file=sys.stderr)
        return 1
    print("ISOLATED_UAT_CONTROL_PLANE_POLICY_PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
