#!/usr/bin/python3
"""Validate a resolved same-host UAT Compose document without side effects."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import PurePosixPath
from typing import Any


MAX_COMPOSE_BYTES = 2_097_152
PROJECT_RE = re.compile(r"^chenyida-erp-uat-[a-z0-9][a-z0-9_-]{0,42}$")
IMAGE_RE = re.compile(r"^[^@\s]+@sha256:[0-9a-f]{64}$")
EXPECTED_SERVICES = {"admin", "caddy", "migrate", "postgres", "web", "worker"}
EXPECTED_VOLUMES = {
    "caddy_config",
    "caddy_data",
    "erp_attachments",
    "erp_backup_status",
    "erp_postgres",
    "erp_postgres_tablespaces",
    "erp_uploads",
}
EXPECTED_NETWORKS = {"backend", "edge"}
EXPECTED_TOP_LEVEL_FIELDS = {
    "name",
    "networks",
    "services",
    "volumes",
    "x-app-environment",
    "x-app-volumes",
    "x-release-build-args",
}
PROTECTED_ROOTS = (
    PurePosixPath("/etc/chenyida-erp"),
    PurePosixPath("/var/lib/chenyida-erp"),
    PurePosixPath("/var/backups/chenyida-erp-v2"),
)


class ContractError(Exception):
    pass


def fail(code: str) -> None:
    raise ContractError(code)


def strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            fail("COMPOSE_JSON_DUPLICATE_KEY")
        result[key] = value
    return result


def reject_constant(_: str) -> None:
    fail("COMPOSE_JSON_NON_FINITE")


def parse_compose() -> dict[str, Any]:
    raw = sys.stdin.buffer.read(MAX_COMPOSE_BYTES + 1)
    if not raw or len(raw) > MAX_COMPOSE_BYTES:
        fail("COMPOSE_JSON_SIZE_INVALID")
    try:
        value = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=strict_object,
            parse_constant=reject_constant,
        )
    except ContractError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail("COMPOSE_JSON_INVALID")
    if not isinstance(value, dict):
        fail("COMPOSE_DOCUMENT_INVALID")
    return value


def normalized_absolute_path(value: str, code: str) -> PurePosixPath:
    if not isinstance(value, str) or not value.startswith("/") or len(value.encode("utf-8")) > 512:
        fail(code)
    if any(character in value for character in ("\x00", "\n", "\r")):
        fail(code)
    path = PurePosixPath(value)
    if str(path) != value or value == "/" or any(part in {"", ".", ".."} for part in path.parts):
        fail(code)
    return path


def paths_overlap(left: PurePosixPath, right: PurePosixPath) -> bool:
    return left == right or left in right.parents or right in left.parents


def reject_protected_values(value: Any) -> None:
    if isinstance(value, dict):
        for item in value.values():
            reject_protected_values(item)
        return
    if isinstance(value, list):
        for item in value:
            reject_protected_values(item)
        return
    if isinstance(value, str):
        for protected in PROTECTED_ROOTS:
            protected_value = str(protected)
            if value == protected_value or value.startswith(f"{protected_value}/"):
                fail("PROTECTED_RUNTIME_VALUE_FORBIDDEN")


def validate_roots(values: list[str]) -> list[PurePosixPath]:
    roots = [normalized_absolute_path(value, "UAT_ROOT_INVALID") for value in values]
    for root in roots:
        if any(paths_overlap(root, protected) for protected in PROTECTED_ROOTS):
            fail("UAT_ROOT_OVERLAPS_PROTECTED")
    for index, root in enumerate(roots):
        if any(paths_overlap(root, other) for other in roots[index + 1 :]):
            fail("UAT_ROOTS_OVERLAP")
    return roots


def integer_port(value: str) -> int:
    if not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]{3,4}", value):
        fail("UAT_PORT_INVALID")
    port = int(value)
    if port < 1024 or port > 65535 or port in {3000}:
        fail("UAT_PORT_INVALID")
    return port


def exact_mapping(value: Any, code: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(code)
    return value


def expected_bind(source: str, target: str) -> dict[str, Any]:
    return {
        "type": "bind",
        "source": source,
        "target": target,
        "read_only": True,
        "bind": {"create_host_path": False},
    }


def expected_volume(source: str, target: str, *, read_only: bool = False) -> dict[str, Any]:
    result: dict[str, Any] = {"type": "volume", "source": source, "target": target}
    if read_only:
        result["read_only"] = True
    return result


def normalized_mount(mount: Any) -> dict[str, Any]:
    value = exact_mapping(mount, "SERVICE_MOUNT_INVALID")
    allowed = {"type", "source", "target", "read_only", "bind", "volume"}
    if set(value) - allowed:
        fail("SERVICE_MOUNT_FIELDS_INVALID")
    result = {key: item for key, item in value.items() if key != "volume" or item != {}}
    return result


def validate_mounts(service: str, actual: Any, expected: list[dict[str, Any]]) -> None:
    if not isinstance(actual, list):
        fail(f"{service.upper()}_MOUNTS_INVALID")
    normalized = [normalized_mount(mount) for mount in actual]
    if normalized != expected:
        fail(f"{service.upper()}_MOUNTS_INVALID")


def validate_ports(service: str, actual: Any, expected: list[dict[str, Any]]) -> None:
    if actual != expected:
        fail(f"{service.upper()}_PORTS_INVALID")
    for port in actual:
        if port.get("host_ip") != "127.0.0.1":
            fail("NON_LOOPBACK_PORT_FORBIDDEN")


def validate_environment(service: str, value: Any, project: str, web_port: int) -> None:
    environment = exact_mapping(value, f"{service.upper()}_ENVIRONMENT_INVALID")
    expected = {
        "ERP_DEPLOYMENT_CLASS": "uat",
        "ERP_ENV": "production",
        "ERP_PUBLIC_ORIGIN": f"http://127.0.0.1:{web_port}",
        "ERP_RELEASE_EXPECTED_DEPLOYMENT_ID": project,
        "ERP_UAT_ALLOW_LOOPBACK_ORIGIN": "true",
    }
    if any(environment.get(key) != item for key, item in expected.items()):
        fail(f"{service.upper()}_UAT_ENVIRONMENT_INVALID")


def validate(args: argparse.Namespace, compose: dict[str, Any]) -> None:
    project = args.project
    if not PROJECT_RE.fullmatch(project) or project == "chenyida-erp":
        fail("UAT_PROJECT_INVALID")

    secret_root, candidate_root, identity_root = validate_roots(
        [args.runtime_secret_root, args.release_candidate_root, args.release_identity_root]
    )
    project_root = normalized_absolute_path(args.project_root, "PROJECT_ROOT_INVALID")
    web_port, caddy_http_port, caddy_https_port = (
        integer_port(args.web_port),
        integer_port(args.caddy_http_port),
        integer_port(args.caddy_https_port),
    )
    if len({web_port, caddy_http_port, caddy_https_port}) != 3:
        fail("UAT_PORTS_COLLIDE")

    if compose.get("name") != project:
        fail("COMPOSE_PROJECT_MISMATCH")
    if set(compose) != EXPECTED_TOP_LEVEL_FIELDS:
        fail("COMPOSE_TOP_LEVEL_FIELDS_INVALID")
    reject_protected_values(compose)
    services = exact_mapping(compose.get("services"), "SERVICES_INVALID")
    if set(services) != EXPECTED_SERVICES:
        fail("SERVICES_INVALID")
    volumes = exact_mapping(compose.get("volumes"), "VOLUMES_INVALID")
    if set(volumes) != EXPECTED_VOLUMES:
        fail("VOLUMES_INVALID")
    for name, value in volumes.items():
        if value != {"name": f"{project}_{name}"}:
            fail("VOLUME_PROJECT_SCOPE_INVALID")
    networks = exact_mapping(compose.get("networks"), "NETWORKS_INVALID")
    if set(networks) != EXPECTED_NETWORKS:
        fail("NETWORKS_INVALID")
    if networks["backend"] != {"name": f"{project}_backend", "ipam": {}, "internal": True}:
        fail("BACKEND_NETWORK_INVALID")
    if networks["edge"] != {"name": f"{project}_edge", "ipam": {}}:
        fail("EDGE_NETWORK_INVALID")

    expected_mounts = {
        "admin": [
            expected_bind(f"{secret_root}/admin-database-password", "/run/chenyida-erp-secrets/admin-database-password"),
            expected_bind(f"{secret_root}/admin-password", "/run/chenyida-erp-secrets/admin-password"),
        ],
        "caddy": [
            expected_bind(f"{project_root}/deploy/Caddyfile", "/etc/caddy/Caddyfile"),
            expected_volume("caddy_data", "/data"),
            expected_volume("caddy_config", "/config"),
        ],
        "migrate": [
            expected_bind(str(candidate_root), "/run/chenyida-erp-release-candidate"),
            expected_bind(f"{secret_root}/migration-database-password", "/run/chenyida-erp-secrets/migration-database-password"),
        ],
        "postgres": [
            expected_volume("erp_postgres", "/var/lib/postgresql/data"),
            expected_volume("erp_postgres_tablespaces", "/var/lib/postgresql/tablespaces"),
            expected_bind(f"{secret_root}/postgres-bootstrap-password", "/run/chenyida-erp-secrets/postgres-bootstrap-password"),
        ],
        "web": [
            expected_volume("erp_uploads", "/data/chenyida-erp/uploads"),
            expected_volume("erp_attachments", "/data/chenyida-erp/attachments"),
            expected_volume("erp_backup_status", "/data/chenyida-erp/backup-status", read_only=True),
            expected_bind(str(identity_root), "/run/chenyida-erp-release"),
            expected_bind(f"{secret_root}/web-database-password", "/run/chenyida-erp-secrets/web-database-password"),
        ],
        "worker": [
            expected_volume("erp_uploads", "/data/chenyida-erp/uploads"),
            expected_volume("erp_attachments", "/data/chenyida-erp/attachments"),
            expected_bind(f"{secret_root}/worker-database-password", "/run/chenyida-erp-secrets/worker-database-password"),
        ],
    }
    expected_network_membership = {
        "admin": {"backend": None},
        "caddy": {"edge": None},
        "migrate": {"backend": None},
        "postgres": {"backend": None},
        "web": {"backend": None, "edge": None},
        "worker": {"backend": None},
    }
    validate_mounts("x_app", compose.get("x-app-volumes"), expected_mounts["worker"])
    for service, policy in services.items():
        policy = exact_mapping(policy, f"{service.upper()}_INVALID")
        if "build" in policy or not IMAGE_RE.fullmatch(policy.get("image", "")):
            fail(f"{service.upper()}_IMAGE_INVALID")
        validate_mounts(service, policy.get("volumes"), expected_mounts[service])
        if policy.get("networks") != expected_network_membership[service]:
            fail(f"{service.upper()}_NETWORKS_INVALID")
        if service in {"admin", "migrate", "web", "worker"}:
            validate_environment(service, policy.get("environment"), project, web_port)

    validate_ports(
        "web",
        services["web"].get("ports"),
        [{"mode": "ingress", "host_ip": "127.0.0.1", "target": 3000, "published": str(web_port), "protocol": "tcp"}],
    )
    validate_ports(
        "caddy",
        services["caddy"].get("ports"),
        [
            {"mode": "ingress", "host_ip": "127.0.0.1", "target": 80, "published": str(caddy_http_port), "protocol": "tcp"},
            {"mode": "ingress", "host_ip": "127.0.0.1", "target": 443, "published": str(caddy_https_port), "protocol": "tcp"},
            {"mode": "ingress", "host_ip": "127.0.0.1", "target": 443, "published": str(caddy_https_port), "protocol": "udp"},
        ],
    )
    if services["caddy"].get("profiles") != ["uat-edge"]:
        fail("CADDY_PROFILE_INVALID")
    for service in EXPECTED_SERVICES - {"web", "caddy"}:
        if services[service].get("ports") not in (None, []):
            fail(f"{service.upper()}_PORTS_FORBIDDEN")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--project", required=True)
    result.add_argument("--project-root", required=True)
    result.add_argument("--runtime-secret-root", required=True)
    result.add_argument("--release-candidate-root", required=True)
    result.add_argument("--release-identity-root", required=True)
    result.add_argument("--web-port", required=True)
    result.add_argument("--caddy-http-port", required=True)
    result.add_argument("--caddy-https-port", required=True)
    return result


def main() -> int:
    try:
        args = parser().parse_args()
        validate(args, parse_compose())
    except ContractError as error:
        print(str(error), file=sys.stderr)
        return 1
    print("ISOLATED_UAT_COMPOSE_POLICY_PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
