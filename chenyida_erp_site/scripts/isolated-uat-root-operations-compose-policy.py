#!/usr/bin/python3
"""Validate the four-layer isolated-UAT root-operations Compose document."""

from __future__ import annotations

import argparse
import copy
import importlib.util
import re
import sys
from pathlib import Path, PurePosixPath
from types import ModuleType
from typing import Any


SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
GIT_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
VERSION_RE = re.compile(r"^0\.1\.0-alpha\.[0-9]+$")
SYSTEM_IDENTIFIER_RE = re.compile(r"^[1-9][0-9]{9,23}$")
OID_RE = re.compile(r"^[1-9][0-9]{0,9}$")
TARGET_HEAD = "0046_runtime_lock_privilege_boundary.sql"
GRANT_TARGET = "/run/chenyida-erp-promotion/migration-execution-grant.json"
PROTECTED_VOLUMES = frozenset(
    {
        "chenyida-erp-parallel_erp_postgres",
        "chenyida-erp-parallel_erp_uploads",
        "chenyida-erp-parallel_erp_attachments",
        "chenyida-erp-parallel_erp_backup_status",
    }
)


def load_base_policy() -> ModuleType:
    source = Path(__file__).with_name("isolated-uat-compose-policy.py")
    specification = importlib.util.spec_from_file_location("isolated_uat_compose_policy", source)
    if specification is None or specification.loader is None:
        raise RuntimeError("BASE_COMPOSE_POLICY_UNAVAILABLE")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


BASE = load_base_policy()
ContractError = BASE.ContractError


def fail(code: str) -> None:
    raise ContractError(code)


def nonzero_digest(value: str, code: str) -> str:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value) or value == "0" * 64:
        fail(code)
    return value


def reject_protected_volumes(value: Any) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if key in PROTECTED_VOLUMES:
                fail("PROTECTED_VOLUME_FORBIDDEN")
            reject_protected_volumes(item)
        return
    if isinstance(value, list):
        for item in value:
            reject_protected_volumes(item)
        return
    if isinstance(value, str) and value in PROTECTED_VOLUMES:
        fail("PROTECTED_VOLUME_FORBIDDEN")


def exact_dependency(service: str, value: Any, dependency: str, condition: str) -> None:
    expected = {dependency: {"condition": condition, "required": True}}
    if value != expected:
        fail(f"{service.upper()}_DEPENDENCY_INVALID")


def validate_profiles(services: dict[str, Any]) -> None:
    expected = {
        "postgres": None,
        "migrate": ["uat-migration"],
        "web": None,
        "worker": None,
        "admin": ["tools"],
        "caddy": ["uat-edge"],
    }
    for service, profiles in expected.items():
        if services[service].get("profiles") != profiles:
            fail(f"{service.upper()}_PROFILE_INVALID")


def validate_dependencies(services: dict[str, Any]) -> None:
    if services["postgres"].get("depends_on") not in (None, {}):
        fail("POSTGRES_DEPENDENCY_INVALID")
    for service in ("migrate", "web", "worker", "admin"):
        exact_dependency(service, services[service].get("depends_on"), "postgres", "service_healthy")
    exact_dependency("caddy", services["caddy"].get("depends_on"), "web", "service_healthy")


def validate_migrate_environment(args: argparse.Namespace, service: dict[str, Any]) -> None:
    environment = BASE.exact_mapping(service.get("environment"), "MIGRATE_ENVIRONMENT_INVALID")
    expected = {
        "ERP_ENV": "production",
        "ERP_DEPLOYMENT_CLASS": "uat",
        "ERP_RELEASE_EXPECTED_DEPLOYMENT_ID": args.project,
        "ERP_SERVICE_KIND": "MIGRATION",
        "ERP_ALLOW_PRODUCTION_MIGRATION": "YES",
        "ERP_MIGRATION_DATABASE_STATE": "MIGRATION_FENCED",
        "ERP_RELEASE_MANIFEST_FILE": "/run/chenyida-erp-release-candidate/release-manifest.json",
        "ERP_RELEASE_MANIFEST_SHA256": args.release_manifest_sha256,
        "ERP_RELEASE_EXPECTED_MANIFEST_SHA256": args.release_manifest_sha256,
        "ERP_MIGRATION_CONFIRM": "MIGRATE_EXACT_RELEASE_MANIFEST",
        "ERP_MIGRATION_EXPECTED_DATABASE": "chenyida_erp",
        "ERP_MIGRATION_EXPECTED_SYSTEM_IDENTIFIER": args.database_system_identifier,
        "ERP_MIGRATION_EXPECTED_DATABASE_OID": args.database_oid,
        "ERP_MIGRATION_EXPECTED_DATABASE_MARKER": f"chenyida-erp-deployment/v2:UAT:{args.project}",
        "ERP_MIGRATION_EXPECTED_ROLE": "chenyida_erp_owner",
        "ERP_MIGRATION_EXPECTED_CURRENT_HEAD": "EMPTY",
        "ERP_MIGRATION_EXPECTED_TARGET_HEAD": TARGET_HEAD,
        "ERP_UAT_PROMOTION_MIGRATION_GRANT_SHA256": args.migration_grant_sha256,
        "ERP_UAT_PROMOTION_MIGRATION_EXECUTION_AUTHORIZATION_SHA256": args.execution_authorization_sha256,
        "ERP_ISOLATED_UAT_ROOT_OPERATIONS_PACKAGE_SHA256": args.root_operations_package_sha256,
    }
    if any(environment.get(key) != value for key, value in expected.items()):
        fail("MIGRATE_ROOT_OPERATIONS_ENVIRONMENT_INVALID")
    if not VERSION_RE.fullmatch(environment.get("ERP_RELEASE_EXPECTED_VERSION", "")):
        fail("MIGRATE_RELEASE_VERSION_INVALID")
    revision = environment.get("ERP_RELEASE_EXPECTED_GIT_COMMIT", "")
    if not GIT_COMMIT_RE.fullmatch(revision) or revision == "0" * 40:
        fail("MIGRATE_RELEASE_REVISION_INVALID")
    if environment.get("ERP_RUNTIME_IMAGE_REFERENCE") != service.get("image"):
        fail("MIGRATE_RUNTIME_IMAGE_REFERENCE_INVALID")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", environment.get("ERP_RUNTIME_IMAGE_CONFIG_DIGEST", "")):
        fail("MIGRATE_RUNTIME_IMAGE_CONFIG_DIGEST_INVALID")
    forbidden = {
        "DATABASE_URL",
        "ERP_MIGRATION_DATABASE_URL",
        "ERP_ALLOW_ISOLATED_MIGRATION",
        "ERP_RELEASE_TEST_MODE",
        "POSTGRES_PASSWORD",
    }
    if forbidden.intersection(environment):
        fail("MIGRATE_BYPASS_ENVIRONMENT_FORBIDDEN")
    if any(any(token in key.lower() for token in ("staff", "headcount", "seat_count")) for key in environment):
        fail("STAFFING_CONFIGURATION_FORBIDDEN")


def validate_grant_mount(
    args: argparse.Namespace,
    services: dict[str, Any],
    roots: tuple[PurePosixPath, PurePosixPath, PurePosixPath, PurePosixPath],
) -> None:
    secret_root, candidate_root, _identity_root, grant_root = roots
    expected = [
        BASE.expected_bind(str(candidate_root), "/run/chenyida-erp-release-candidate"),
        BASE.expected_bind(
            f"{secret_root}/migration-database-password",
            "/run/chenyida-erp-secrets/migration-database-password",
        ),
        BASE.expected_bind(f"{grant_root}/migration-execution-grant.json", GRANT_TARGET),
    ]
    actual = services["migrate"].get("volumes")
    if not isinstance(actual, list) or [BASE.normalized_mount(item) for item in actual] != expected:
        fail("MIGRATE_ROOT_OPERATIONS_MOUNTS_INVALID")

    # Re-run the frozen three-layer policy against the exact legacy projection.
    # Only the newly-added grant mount is removed; no old policy source is changed.
    projection = copy.deepcopy(args.compose)
    projection["services"]["migrate"]["volumes"] = copy.deepcopy(actual[:2])
    legacy_args = argparse.Namespace(
        project=args.project,
        project_root=args.project_root,
        runtime_secret_root=args.runtime_secret_root,
        release_candidate_root=args.release_candidate_root,
        release_identity_root=args.release_identity_root,
        web_port=args.web_port,
        caddy_http_port=args.caddy_http_port,
        caddy_https_port=args.caddy_https_port,
    )
    BASE.validate(legacy_args, projection)


def validate(args: argparse.Namespace, compose: dict[str, Any]) -> None:
    args.compose = compose
    args.release_manifest_sha256 = nonzero_digest(
        args.release_manifest_sha256, "RELEASE_MANIFEST_SHA256_INVALID"
    )
    args.migration_grant_sha256 = nonzero_digest(
        args.migration_grant_sha256, "MIGRATION_GRANT_SHA256_INVALID"
    )
    args.execution_authorization_sha256 = nonzero_digest(
        args.execution_authorization_sha256, "MIGRATION_EXECUTION_AUTHORIZATION_SHA256_INVALID"
    )
    args.root_operations_package_sha256 = nonzero_digest(
        args.root_operations_package_sha256, "ROOT_OPERATIONS_PACKAGE_SHA256_INVALID"
    )
    if not SYSTEM_IDENTIFIER_RE.fullmatch(args.database_system_identifier):
        fail("DATABASE_SYSTEM_IDENTIFIER_INVALID")
    if not OID_RE.fullmatch(args.database_oid):
        fail("DATABASE_OID_INVALID")

    roots = tuple(
        BASE.validate_roots(
            [
                args.runtime_secret_root,
                args.release_candidate_root,
                args.release_identity_root,
                args.migration_grant_root,
            ]
        )
    )
    reject_protected_volumes(compose)
    services = BASE.exact_mapping(compose.get("services"), "SERVICES_INVALID")
    if set(services) != BASE.EXPECTED_SERVICES:
        fail("SERVICES_INVALID")
    validate_grant_mount(args, services, roots)
    validate_migrate_environment(args, services["migrate"])
    validate_profiles(services)
    validate_dependencies(services)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--project", required=True)
    result.add_argument("--project-root", required=True)
    result.add_argument("--runtime-secret-root", required=True)
    result.add_argument("--release-candidate-root", required=True)
    result.add_argument("--release-identity-root", required=True)
    result.add_argument("--migration-grant-root", required=True)
    result.add_argument("--web-port", required=True)
    result.add_argument("--caddy-http-port", required=True)
    result.add_argument("--caddy-https-port", required=True)
    result.add_argument("--release-manifest-sha256", required=True)
    result.add_argument("--migration-grant-sha256", required=True)
    result.add_argument("--execution-authorization-sha256", required=True)
    result.add_argument("--root-operations-package-sha256", required=True)
    result.add_argument("--database-system-identifier", required=True)
    result.add_argument("--database-oid", required=True)
    return result


def main() -> int:
    try:
        args = parser().parse_args()
        validate(args, BASE.parse_compose())
    except ContractError as error:
        print(str(error), file=sys.stderr)
        return 1
    print("ISOLATED_UAT_ROOT_OPERATIONS_COMPOSE_POLICY_PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
