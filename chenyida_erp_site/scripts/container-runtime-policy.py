#!/usr/bin/python3
"""Fail-closed validation for the resolved production Compose runtime contract.

The resolved Compose document can contain credentials.  This program therefore
reads it only from stdin, never writes it, and emits only a verdict or a stable
error code.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path, PurePosixPath
from typing import Any


EXPECTED_POLICY_SHA256 = "74d3f8d24e7b15f0cc5ce4e0e21c963b0e95735c502a471666c02165c7e53c1b"
POLICY_CONTRACT = "chenyida-erp-container-runtime-policy/v1"
MAX_POLICY_BYTES = 131_072
MAX_COMPOSE_BYTES = 2_097_152
MAX_ENVIRONMENT_VALUE_BYTES = 16_384
SHA256_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
IMAGE_DIGEST_RE = re.compile(r"^[^@\s]+@sha256:[0-9a-f]{64}$")
GIT_REVISION_RE = re.compile(r"^[0-9a-f]{40}$")

POLICY_TOP_KEYS = {
    "schema_version",
    "contract",
    "policy_id",
    "platform",
    "parser",
    "sources",
    "project",
    "global_forbidden",
    "app_environment_keys",
    "services",
}
SERVICE_POLICY_KEYS = {
    "service",
    "allowed_compose_fields",
    "image",
    "image_declared_volumes",
    "user",
    "groups",
    "read_only_rootfs",
    "cap_drop",
    "cap_add",
    "security_options",
    "tmpfs",
    "mounts",
    "ports",
    "networks",
    "dependencies",
    "resources",
    "lifecycle",
    "logging",
    "process",
    "healthcheck",
    "environment_profile",
    "environment_additions",
    "exception",
}
COMPOSE_TOP_KEYS = {
    "name",
    "networks",
    "services",
    "volumes",
    "x-app-environment",
    "x-app-volumes",
    "x-release-build-args",
}

ENVIRONMENT_CONSTANTS = {
    "ERP_UPLOAD_ROOT": "/data/chenyida-erp/uploads",
    "ERP_ATTACHMENT_ROOT": "/data/chenyida-erp/attachments",
    "ERP_BACKUP_STATUS_FILE": "/data/chenyida-erp/backup-status/recovery-readiness.json",
}
SERVICE_ENVIRONMENT_CONSTANTS = {
    "caddy": {"ERP_HTTPS_PORT": "443"},
    "migrate": {
        "ERP_RELEASE_MANIFEST_FILE": "/run/chenyida-erp-release-candidate/release-manifest.json"
    },
    "web": {
        "ERP_PROCESS_NAME": "chenyida-erp-web",
        "NODE_OPTIONS": "--max-old-space-size=384",
        "PORT": "3000",
    },
    "worker": {
        "ERP_PROCESS_NAME": "chenyida-erp-worker",
        "ERP_WORKER_INSTANCE_FILE": "/tmp/chenyida-erp-worker-instance-id",
        "NODE_OPTIONS": "--max-old-space-size=384",
    },
}
KNOWN_EXCEPTIONS = {
    "admin": None,
    "caddy": "CADDY_ROOT_NET_BIND_SERVICE_V1",
    "migrate": "MIGRATE_ROOT_GROUP_RELEASE_READER_V1",
    "postgres": None,
    "web": "WEB_RELEASE_IDENTITY_READER_GROUP_V1",
    "worker": None,
}


class PolicyError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def fail(code: str) -> None:
    raise PolicyError(code)


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, _: str) -> None:
        fail("ARGUMENTS_INVALID")

    def exit(self, status: int = 0, message: str | None = None) -> None:
        fail("ARGUMENTS_INVALID")


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            fail("JSON_DUPLICATE_KEY")
        value[key] = item
    return value


def reject_json_constant(_: str) -> None:
    fail("JSON_NON_FINITE_NUMBER")


def parse_json(raw: bytes, invalid_code: str) -> Any:
    try:
        return json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=strict_object,
            parse_constant=reject_json_constant,
        )
    except PolicyError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail(invalid_code)


def read_regular_file(path: Path, maximum: int, code: str) -> bytes:
    try:
        metadata = path.lstat()
        if not stat.S_ISREG(metadata.st_mode) or path.is_symlink():
            fail(code)
        if metadata.st_size > maximum:
            fail(code)
        raw = path.read_bytes()
    except PolicyError:
        raise
    except OSError:
        fail(code)
    if len(raw) > maximum:
        fail(code)
    return raw


def exact_keys(value: Any, expected: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        fail(code)
    return value


def exact_list(value: Any, code: str, *, sorted_unique: bool = False) -> list[Any]:
    if not isinstance(value, list):
        fail(code)
    if sorted_unique:
        try:
            if value != sorted(value) or len(value) != len(set(value)):
                fail(code)
        except TypeError:
            fail(code)
    return value


def bounded_string(value: Any, code: str, *, allow_empty: bool = True) -> str:
    if not isinstance(value, str):
        fail(code)
    raw = value.encode("utf-8")
    if len(raw) > MAX_ENVIRONMENT_VALUE_BYTES or "\x00" in value or "\n" in value or "\r" in value:
        fail(code)
    if not allow_empty and not value:
        fail(code)
    return value


def decimal_integer(value: Any, code: str) -> int:
    if isinstance(value, bool):
        fail(code)
    if isinstance(value, int):
        return value
    if isinstance(value, str) and re.fullmatch(r"0|[1-9][0-9]*", value):
        return int(value)
    fail(code)


def safe_source_path(project_root: Path, relative: Any) -> Path:
    if not isinstance(relative, str):
        fail("POLICY_SOURCE_PATH_INVALID")
    pure = PurePosixPath(relative)
    if pure.is_absolute() or not pure.parts or any(part in {"", ".", ".."} for part in pure.parts):
        fail("POLICY_SOURCE_PATH_INVALID")
    current = project_root
    for index, part in enumerate(pure.parts):
        current = current / part
        try:
            metadata = current.lstat()
        except OSError:
            fail("POLICY_SOURCE_MISSING")
        if stat.S_ISLNK(metadata.st_mode):
            fail("POLICY_SOURCE_SYMLINK")
        if index < len(pure.parts) - 1 and not stat.S_ISDIR(metadata.st_mode):
            fail("POLICY_SOURCE_PATH_INVALID")
    try:
        if not stat.S_ISREG(current.stat().st_mode):
            fail("POLICY_SOURCE_NOT_REGULAR")
        resolved = current.resolve(strict=True)
        resolved.relative_to(project_root)
    except PolicyError:
        raise
    except (OSError, ValueError):
        fail("POLICY_SOURCE_PATH_INVALID")
    return resolved


def validate_policy_shape(policy: Any) -> dict[str, Any]:
    policy = exact_keys(policy, POLICY_TOP_KEYS, "POLICY_FIELDS_INVALID")
    if (
        policy["schema_version"] != 1
        or policy["contract"] != POLICY_CONTRACT
        or policy["policy_id"] != "chenyida-erp-production-container-runtime-v1"
        or policy["platform"] != "linux/amd64"
    ):
        fail("POLICY_IDENTITY_INVALID")

    parser = exact_keys(
        policy["parser"], {"docker_engine_version", "docker_compose_version"}, "POLICY_PARSER_INVALID"
    )
    for value in parser.values():
        bounded_string(value, "POLICY_PARSER_INVALID", allow_empty=False)

    sources = exact_list(policy["sources"], "POLICY_SOURCES_INVALID")
    paths: list[str] = []
    for source in sources:
        source = exact_keys(source, {"path", "sha256"}, "POLICY_SOURCES_INVALID")
        path = bounded_string(source["path"], "POLICY_SOURCES_INVALID", allow_empty=False)
        digest = bounded_string(source["sha256"], "POLICY_SOURCES_INVALID", allow_empty=False)
        if not SHA256_RE.fullmatch(f"sha256:{digest}"):
            fail("POLICY_SOURCES_INVALID")
        paths.append(path)
    if paths != sorted(paths) or len(paths) != len(set(paths)):
        fail("POLICY_SOURCES_INVALID")

    project = exact_keys(policy["project"], {"name", "services", "volumes", "networks"}, "POLICY_PROJECT_INVALID")
    if project["name"] != "chenyida-erp":
        fail("POLICY_PROJECT_INVALID")
    for field in ("services", "volumes", "networks"):
        values = exact_list(project[field], "POLICY_PROJECT_INVALID", sorted_unique=True)
        if not values or not all(isinstance(item, str) and item for item in values):
            fail("POLICY_PROJECT_INVALID")

    forbidden = exact_keys(
        policy["global_forbidden"],
        {"service_fields", "top_level_fields", "bind_sources", "security_options"},
        "POLICY_FORBIDDEN_INVALID",
    )
    for value in forbidden.values():
        exact_list(value, "POLICY_FORBIDDEN_INVALID", sorted_unique=True)

    exact_list(policy["app_environment_keys"], "POLICY_ENVIRONMENT_INVALID", sorted_unique=True)
    services = exact_list(policy["services"], "POLICY_SERVICES_INVALID")
    if len(services) != len(project["services"]):
        fail("POLICY_SERVICES_INVALID")
    for service in services:
        service = exact_keys(service, SERVICE_POLICY_KEYS, "POLICY_SERVICE_FIELDS_INVALID")
        name = service["service"]
        if not isinstance(name, str) or name not in project["services"]:
            fail("POLICY_SERVICES_INVALID")
        exact_list(service["allowed_compose_fields"], "POLICY_SERVICE_FIELDS_INVALID", sorted_unique=True)
        exact_list(service["image_declared_volumes"], "POLICY_IMAGE_INVALID", sorted_unique=True)
        exact_list(service["groups"], "POLICY_USER_INVALID")
        exact_list(service["cap_drop"], "POLICY_CAPABILITIES_INVALID", sorted_unique=True)
        exact_list(service["cap_add"], "POLICY_CAPABILITIES_INVALID", sorted_unique=True)
        exact_list(service["security_options"], "POLICY_SECURITY_OPTIONS_INVALID", sorted_unique=True)
        exact_list(service["tmpfs"], "POLICY_TMPFS_INVALID")
        exact_list(service["mounts"], "POLICY_MOUNTS_INVALID")
        exact_list(service["ports"], "POLICY_PORTS_INVALID")
        exact_list(service["networks"], "POLICY_NETWORKS_INVALID", sorted_unique=True)
        dependencies = service["dependencies"]
        if not isinstance(dependencies, dict) or not all(
            isinstance(name, str)
            and name in project["services"]
            and isinstance(condition, str)
            and condition in {"service_healthy", "service_completed_successfully"}
            for name, condition in dependencies.items()
        ):
            fail("POLICY_DEPENDENCIES_INVALID")
        exact_keys(
            service["resources"],
            {"cpus", "memory_bytes", "memory_swap_bytes", "pids", "shared_memory_bytes"},
            "POLICY_RESOURCES_INVALID",
        )
        exact_keys(
            service["lifecycle"],
            {"restart", "init", "profiles", "stop_grace_period"},
            "POLICY_LIFECYCLE_INVALID",
        )
        exact_keys(service["logging"], {"driver", "max_size", "max_file"}, "POLICY_LOGGING_INVALID")
        exact_keys(service["process"], {"entrypoint", "command"}, "POLICY_PROCESS_INVALID")
        exact_list(service["environment_additions"], "POLICY_ENVIRONMENT_INVALID", sorted_unique=True)
        if service["environment_profile"] not in {"app_release", "direct"}:
            fail("POLICY_ENVIRONMENT_INVALID")
        if service["exception"] != KNOWN_EXCEPTIONS.get(name):
            fail("POLICY_EXCEPTION_INVALID")

    if [service["service"] for service in services] != project["services"]:
        fail("POLICY_SERVICES_INVALID")
    return policy


def load_policy(policy_path: Path, project_root: Path) -> tuple[dict[str, Any], str]:
    if not policy_path.is_absolute() or not project_root.is_absolute():
        fail("POLICY_OR_PROJECT_PATH_NOT_ABSOLUTE")
    raw = read_regular_file(policy_path, MAX_POLICY_BYTES, "POLICY_FILE_INVALID")
    policy = validate_policy_shape(parse_json(raw, "POLICY_JSON_INVALID"))
    digest = sha256(raw)
    if digest != EXPECTED_POLICY_SHA256:
        fail("POLICY_DIGEST_MISMATCH")

    try:
        root_metadata = project_root.lstat()
        if project_root.is_symlink() or not stat.S_ISDIR(root_metadata.st_mode):
            fail("PROJECT_ROOT_INVALID")
        project_root = project_root.resolve(strict=True)
    except PolicyError:
        raise
    except OSError:
        fail("PROJECT_ROOT_INVALID")

    for source in policy["sources"]:
        source_path = safe_source_path(project_root, source["path"])
        raw_source = read_regular_file(source_path, MAX_COMPOSE_BYTES, "POLICY_SOURCE_NOT_REGULAR")
        if sha256(raw_source) != source["sha256"]:
            fail("POLICY_SOURCE_DIGEST_MISMATCH")
    return policy, digest


def expected_image(service: dict[str, Any], web_image: str, worker_image: str) -> str:
    image = exact_keys(service["image"], {"kind", "reference"}, "POLICY_IMAGE_INVALID")
    kind = image["kind"]
    if kind == "fixed":
        reference = image["reference"]
    elif kind == "web_candidate":
        reference = web_image
    elif kind == "worker_candidate":
        reference = worker_image
    else:
        fail("POLICY_IMAGE_INVALID")
    if not isinstance(reference, str) or not IMAGE_DIGEST_RE.fullmatch(reference):
        fail("IMAGE_REFERENCE_INVALID")
    return reference


def validate_environment_values(environment: Any) -> dict[str, str]:
    if not isinstance(environment, dict):
        fail("ENVIRONMENT_INVALID")
    for key, value in environment.items():
        if not isinstance(key, str) or not key:
            fail("ENVIRONMENT_INVALID")
        bounded_string(value, "ENVIRONMENT_VALUE_INVALID")
    return environment


def validate_mounts(
    actual: Any, expected: list[dict[str, Any]], project_root: Path, reader_gid: str, forbidden: dict[str, Any]
) -> None:
    if actual is None:
        actual = []
    if not isinstance(actual, list):
        fail("MOUNTS_INVALID")
    normalized: list[dict[str, Any]] = []
    for mount in actual:
        if not isinstance(mount, dict):
            fail("MOUNTS_INVALID")
        kind = mount.get("type")
        if kind == "bind":
            if set(mount) != {"type", "source", "target", "read_only", "bind"}:
                fail("BIND_MOUNT_FIELDS_INVALID")
            if mount["bind"] != {"create_host_path": False}:
                fail("BIND_MOUNT_CREATE_INVALID")
            source = mount.get("source")
            if not isinstance(source, str) or not os.path.isabs(source) or os.path.normpath(source) != source:
                fail("BIND_MOUNT_SOURCE_INVALID")
            for blocked in forbidden["bind_sources"]:
                if source == blocked or (blocked != "/" and source.startswith(f"{blocked.rstrip('/')}/")):
                    fail("BIND_MOUNT_FORBIDDEN")
            normalized.append(
                {
                    "type": "bind",
                    "source": source,
                    "target": mount.get("target"),
                    "read_only": mount.get("read_only"),
                    "create_host_path": False,
                }
            )
        elif kind == "volume":
            if not set(mount).issubset({"type", "source", "target", "read_only", "volume"}) or not {
                "type",
                "source",
                "target",
            }.issubset(mount):
                fail("VOLUME_MOUNT_FIELDS_INVALID")
            if mount.get("volume", {}) != {}:
                fail("VOLUME_MOUNT_OPTIONS_INVALID")
            normalized.append(
                {
                    "type": "volume",
                    "source": mount.get("source"),
                    "target": mount.get("target"),
                    "read_only": mount.get("read_only", False),
                    "create_host_path": None,
                }
            )
        else:
            fail("MOUNT_TYPE_INVALID")

    expanded: list[dict[str, Any]] = []
    for mount in expected:
        mount = exact_keys(
            mount, {"type", "source", "target", "read_only", "create_host_path"}, "POLICY_MOUNTS_INVALID"
        ).copy()
        if mount["source"] == "$PROJECT_ROOT/deploy/Caddyfile":
            mount["source"] = str(project_root / "deploy" / "Caddyfile")
        elif isinstance(mount["source"], str):
            mount["source"] = mount["source"].replace("$RELEASE_IDENTITY_READER_GID", reader_gid)
        expanded.append(mount)
    if normalized != expanded:
        fail("MOUNTS_POLICY_MISMATCH")


def validate_ports(actual: Any, expected: list[dict[str, Any]]) -> None:
    if actual is None:
        actual = []
    if not isinstance(actual, list):
        fail("PORTS_INVALID")
    normalized: list[dict[str, Any]] = []
    for port in actual:
        if not isinstance(port, dict) or set(port) != {"mode", "host_ip", "target", "published", "protocol"}:
            fail("PORT_FIELDS_INVALID")
        if port["mode"] != "ingress":
            fail("PORT_MODE_INVALID")
        normalized.append(
            {
                "host_ip": port["host_ip"],
                "target": port["target"],
                "protocol": port["protocol"],
                "published": port["published"],
            }
        )
    expected_normalized: list[dict[str, Any]] = []
    for port in expected:
        port = exact_keys(
            port,
            {"host_ip", "target", "protocol", "published_environment", "published_default"},
            "POLICY_PORTS_INVALID",
        )
        expected_normalized.append(
            {
                "host_ip": port["host_ip"],
                "target": port["target"],
                "protocol": port["protocol"],
                "published": port["published_default"],
            }
        )
    if normalized != expected_normalized:
        fail("PORTS_POLICY_MISMATCH")


def validate_healthcheck(actual: Any, expected: Any) -> None:
    if expected is None:
        if actual is not None:
            fail("HEALTHCHECK_POLICY_MISMATCH")
        return
    expected = exact_keys(
        expected, {"test", "interval", "timeout", "retries", "start_period"}, "POLICY_HEALTHCHECK_INVALID"
    )
    expected_actual = {key: value for key, value in expected.items() if value is not None}
    if not isinstance(actual, dict) or set(actual) != set(expected_actual) or actual != expected_actual:
        fail("HEALTHCHECK_POLICY_MISMATCH")


def validate_dependencies(actual: Any, expected: dict[str, str]) -> None:
    if not expected:
        if actual is not None:
            fail("DEPENDENCIES_POLICY_MISMATCH")
        return
    if not isinstance(actual, dict) or set(actual) != set(expected):
        fail("DEPENDENCIES_POLICY_MISMATCH")
    for name, condition in expected.items():
        if actual[name] != {"condition": condition, "required": True}:
            fail("DEPENDENCIES_POLICY_MISMATCH")


def validate_service(
    name: str,
    actual: Any,
    service: dict[str, Any],
    policy: dict[str, Any],
    project_root: Path,
    web_image: str,
    worker_image: str,
    web_config_digest: str,
    worker_config_digest: str,
    reader_gid: str,
) -> None:
    if not isinstance(actual, dict):
        fail("SERVICE_INVALID")
    if set(actual).intersection(policy["global_forbidden"]["service_fields"]):
        fail("FORBIDDEN_SERVICE_FIELD")
    if sorted(actual) != service["allowed_compose_fields"]:
        fail("SERVICE_FIELDS_POLICY_MISMATCH")

    image = expected_image(service, web_image, worker_image)
    if actual["image"] != image:
        fail("IMAGE_POLICY_MISMATCH")
    if actual["user"] != service["user"]:
        fail("USER_POLICY_MISMATCH")
    expected_groups = [reader_gid if group == "$RELEASE_IDENTITY_READER_GID" else group for group in service["groups"]]
    if actual.get("group_add", []) != expected_groups:
        fail("GROUPS_POLICY_MISMATCH")
    if actual["read_only"] is not service["read_only_rootfs"]:
        fail("ROOTFS_POLICY_MISMATCH")
    if actual["cap_drop"] != service["cap_drop"] or actual.get("cap_add", []) != service["cap_add"]:
        fail("CAPABILITIES_POLICY_MISMATCH")
    if actual["security_opt"] != service["security_options"]:
        fail("SECURITY_OPTIONS_POLICY_MISMATCH")
    if set(actual["security_opt"]).intersection(policy["global_forbidden"]["security_options"]):
        fail("FORBIDDEN_SECURITY_OPTION")
    if actual.get("tmpfs", []) != service["tmpfs"]:
        fail("TMPFS_POLICY_MISMATCH")

    validate_mounts(actual.get("volumes"), service["mounts"], project_root, reader_gid, policy["global_forbidden"])
    validate_ports(actual.get("ports"), service["ports"])
    if not isinstance(actual["networks"], dict) or list(actual["networks"]) != service["networks"]:
        fail("NETWORKS_POLICY_MISMATCH")
    if any(value is not None for value in actual["networks"].values()):
        fail("NETWORK_OPTIONS_INVALID")
    validate_dependencies(actual.get("depends_on"), service["dependencies"])

    resources = service["resources"]
    if (
        actual["cpus"] != resources["cpus"]
        or decimal_integer(actual["mem_limit"], "RESOURCES_POLICY_MISMATCH") != resources["memory_bytes"]
        or decimal_integer(actual["memswap_limit"], "RESOURCES_POLICY_MISMATCH")
        != resources["memory_swap_bytes"]
        or actual["pids_limit"] != resources["pids"]
        or (
            decimal_integer(actual["shm_size"], "RESOURCES_POLICY_MISMATCH")
            if actual.get("shm_size") is not None
            else None
        )
        != resources["shared_memory_bytes"]
    ):
        fail("RESOURCES_POLICY_MISMATCH")

    lifecycle = service["lifecycle"]
    if (
        actual["restart"] != lifecycle["restart"]
        or actual.get("init", False) is not lifecycle["init"]
        or actual.get("profiles", []) != lifecycle["profiles"]
        or actual.get("stop_grace_period") != lifecycle["stop_grace_period"]
    ):
        fail("LIFECYCLE_POLICY_MISMATCH")
    logging = service["logging"]
    if actual["logging"] != {
        "driver": logging["driver"],
        "options": {"max-file": logging["max_file"], "max-size": logging["max_size"]},
    }:
        fail("LOGGING_POLICY_MISMATCH")
    if actual["entrypoint"] != service["process"]["entrypoint"] or actual["command"] != service["process"]["command"]:
        fail("PROCESS_POLICY_MISMATCH")
    validate_healthcheck(actual.get("healthcheck"), service["healthcheck"])

    environment = validate_environment_values(actual["environment"])
    if service["environment_profile"] == "app_release":
        expected_environment = set(policy["app_environment_keys"]) | set(service["environment_additions"]) | {
            "ERP_RUNTIME_IMAGE_REFERENCE",
            "ERP_RUNTIME_IMAGE_CONFIG_DIGEST",
        }
    else:
        expected_environment = set(service["environment_additions"])
    if set(environment) != expected_environment:
        fail("ENVIRONMENT_KEYS_POLICY_MISMATCH")
    for key, value in ENVIRONMENT_CONSTANTS.items():
        if key in environment and environment[key] != value:
            fail("ENVIRONMENT_CONSTANT_POLICY_MISMATCH")
    for key, value in SERVICE_ENVIRONMENT_CONSTANTS.get(name, {}).items():
        if environment.get(key) != value:
            fail("ENVIRONMENT_CONSTANT_POLICY_MISMATCH")
    if service["environment_profile"] == "app_release":
        expected_config = web_config_digest if name == "web" else worker_config_digest
        if environment["ERP_RUNTIME_IMAGE_REFERENCE"] != image or environment["ERP_RUNTIME_IMAGE_CONFIG_DIGEST"] != expected_config:
            fail("RUNTIME_IDENTITY_POLICY_MISMATCH")


def validate_compose(
    compose: Any,
    policy: dict[str, Any],
    project_root: Path,
    web_image: str,
    worker_image: str,
    web_config_digest: str,
    worker_config_digest: str,
    reader_gid: str,
) -> None:
    if not isinstance(compose, dict):
        fail("COMPOSE_TOP_LEVEL_FIELDS_INVALID")
    if set(compose).intersection(policy["global_forbidden"]["top_level_fields"]):
        fail("FORBIDDEN_TOP_LEVEL_FIELD")
    compose = exact_keys(compose, COMPOSE_TOP_KEYS, "COMPOSE_TOP_LEVEL_FIELDS_INVALID")
    if compose["name"] != policy["project"]["name"]:
        fail("COMPOSE_PROJECT_NAME_MISMATCH")

    expected_volumes = {
        name: {"name": f"{policy['project']['name']}_{name}"} for name in policy["project"]["volumes"]
    }
    if compose["volumes"] != expected_volumes:
        fail("TOP_LEVEL_VOLUMES_POLICY_MISMATCH")
    expected_networks = {
        "backend": {"name": "chenyida-erp_backend", "ipam": {}, "internal": True},
        "edge": {"name": "chenyida-erp_edge", "ipam": {}},
    }
    if compose["networks"] != expected_networks or sorted(compose["networks"]) != policy["project"]["networks"]:
        fail("TOP_LEVEL_NETWORKS_POLICY_MISMATCH")

    app_environment = validate_environment_values(compose["x-app-environment"])
    if sorted(app_environment) != policy["app_environment_keys"]:
        fail("APP_ENVIRONMENT_POLICY_MISMATCH")
    for key, value in ENVIRONMENT_CONSTANTS.items():
        if app_environment.get(key) != value:
            fail("APP_ENVIRONMENT_POLICY_MISMATCH")
    build_args = validate_environment_values(compose["x-release-build-args"])
    if set(build_args) != {"ERP_BUILD_REVISION", "ERP_BUILD_VERSION"}:
        fail("BUILD_ARGUMENTS_POLICY_MISMATCH")
    if not GIT_REVISION_RE.fullmatch(build_args["ERP_BUILD_REVISION"]) or not build_args["ERP_BUILD_VERSION"]:
        fail("BUILD_ARGUMENTS_POLICY_MISMATCH")

    worker_policy = next(service for service in policy["services"] if service["service"] == "worker")
    validate_mounts(
        compose["x-app-volumes"], worker_policy["mounts"], project_root, reader_gid, policy["global_forbidden"]
    )

    services = compose["services"]
    if not isinstance(services, dict) or sorted(services) != policy["project"]["services"]:
        fail("SERVICE_SET_POLICY_MISMATCH")
    for service in policy["services"]:
        name = service["service"]
        validate_service(
            name,
            services[name],
            service,
            policy,
            project_root,
            web_image,
            worker_image,
            web_config_digest,
            worker_config_digest,
            reader_gid,
        )


def read_compose_stdin() -> Any:
    raw = sys.stdin.buffer.read(MAX_COMPOSE_BYTES + 1)
    if len(raw) > MAX_COMPOSE_BYTES:
        fail("COMPOSE_INPUT_TOO_LARGE")
    if not raw:
        fail("COMPOSE_INPUT_EMPTY")
    return parse_json(raw, "COMPOSE_JSON_INVALID")


def parse_arguments(argv: list[str]) -> argparse.Namespace:
    parser = SafeArgumentParser(add_help=False)
    parser.add_argument("command")
    parser.add_argument("--policy", required=True)
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--compose-version", required=True)
    parser.add_argument("--engine-version", required=True)
    parser.add_argument("--web-image", required=True)
    parser.add_argument("--worker-image", required=True)
    parser.add_argument("--web-config-digest", required=True)
    parser.add_argument("--worker-config-digest", required=True)
    parser.add_argument("--reader-gid", required=True)
    arguments = parser.parse_args(argv)
    if arguments.command != "validate":
        fail("COMMAND_INVALID")
    return arguments


def run(argv: list[str]) -> int:
    try:
        arguments = parse_arguments(argv)
        project_root = Path(arguments.project_root)
        policy, policy_digest = load_policy(Path(arguments.policy), project_root)
        if arguments.compose_version != policy["parser"]["docker_compose_version"]:
            fail("COMPOSE_VERSION_MISMATCH")
        if arguments.engine_version != policy["parser"]["docker_engine_version"]:
            fail("ENGINE_VERSION_MISMATCH")
        if not IMAGE_DIGEST_RE.fullmatch(arguments.web_image) or not IMAGE_DIGEST_RE.fullmatch(arguments.worker_image):
            fail("IMAGE_REFERENCE_INVALID")
        if not SHA256_RE.fullmatch(arguments.web_config_digest) or not SHA256_RE.fullmatch(arguments.worker_config_digest):
            fail("IMAGE_CONFIG_DIGEST_INVALID")
        if not re.fullmatch(r"[1-9][0-9]{0,9}", arguments.reader_gid):
            fail("READER_GID_INVALID")
        validate_compose(
            read_compose_stdin(),
            policy,
            project_root.resolve(strict=True),
            arguments.web_image,
            arguments.worker_image,
            arguments.web_config_digest,
            arguments.worker_config_digest,
            arguments.reader_gid,
        )
        print(
            f"CONTAINER_RUNTIME_POLICY_OK services={len(policy['services'])} policy_sha256={policy_digest}"
        )
        return 0
    except PolicyError as error:
        print(f"CONTAINER_RUNTIME_POLICY_FAILED:{error.code}", file=sys.stderr)
        return 1
    except (OSError, ValueError):
        print("CONTAINER_RUNTIME_POLICY_FAILED:IO_OR_VALUE_ERROR", file=sys.stderr)
        return 1
    except Exception:
        print("CONTAINER_RUNTIME_POLICY_FAILED:INTERNAL_ERROR", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(run(sys.argv[1:]))
