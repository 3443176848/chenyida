#!/usr/bin/python3
"""Concrete, root-only system adapter for one empty isolated UAT database.

The module has no CLI and performs no work at import time.  It is loaded only
by ``isolated-uat-root-operations.py`` after a bound authorization has been
validated.  All commands use fixed argv vectors; transaction SQL containing
credentials is connected directly from the exact Worker helper to psql and is
never captured, logged, or written to disk.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import re
import stat
import subprocess
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any


DOCKER = "/usr/bin/docker"
PYTHON = "/usr/bin/python3"
DATABASE = "chenyida_erp"
CONTROL_ROLE = "postgres"
MIGRATION_ROLE = "chenyida_erp_owner"
TARGET_HEAD = "0046_runtime_lock_privilege_boundary.sql"
MAX_COMMAND_OUTPUT = 16 * 1024 * 1024
MIN_AVAILABLE_MEMORY = 768 * 1024 * 1024
MIN_AVAILABLE_DISK = 10 * 1024 * 1024 * 1024
MAX_SWAP_PERCENT = 80
MAX_LOAD_ONE = 4.0
MAX_SWAP_GROWTH = 256 * 1024 * 1024

COMPOSE_FILES = (
    "compose.yml",
    "compose.release.yml",
    "compose.uat-isolated.yml",
    "compose.uat-operations.yml",
)
PROTECTED_VOLUMES = (
    "chenyida-erp-parallel_erp_postgres",
    "chenyida-erp-parallel_erp_uploads",
    "chenyida-erp-parallel_erp_attachments",
    "chenyida-erp-parallel_erp_backup_status",
)
PROTECTED_PROJECT = "chenyida-erp-parallel"
PROTECTED_SERVICES = ("caddy", "postgres", "web", "worker")
EXPECTED_SECRET_POLICY_CONTENT = {
    "exact_bytes": 43,
    "decoded_bytes": 32,
    "encoding": "ASCII",
    "format": "CANONICAL_BASE64URL_NO_PADDING_OPTIONAL_FINAL_LF",
    "minimum_distinct_characters": 16,
    "required_generation": "OS_CSPRNG",
}
EXPECTED_SECRET_BINDINGS = {
    "ADMIN_DATABASE_PASSWORD": ("admin", "ADMIN", "admin-database-password", 0, 65_532),
    "ADMIN_PASSWORD": ("admin", "ADMIN", "admin-password", 0, 65_532),
    "MIGRATION_DATABASE_PASSWORD": ("migrate", "MIGRATION", "migration-database-password", 0, 0),
    "POSTGRES_BOOTSTRAP_PASSWORD": ("postgres", "POSTGRES", "postgres-bootstrap-password", 0, 999),
    "WEB_DATABASE_PASSWORD": ("web", "WEB", "web-database-password", 0, 65_532),
    "WORKER_DATABASE_PASSWORD": ("worker", "WORKER", "worker-database-password", 0, 65_532),
}
EXPECTED_FORBIDDEN_SECRET_ENVIRONMENT = (
    "DATABASE_URL",
    "ERP_ADMIN_PASSWORD",
    "ERP_MIGRATION_DATABASE_URL",
    "ERP_SETUP_TOKEN",
    "POSTGRES_PASSWORD",
)
ENVIRONMENT_KEY = re.compile(r"^[A-Z][A-Z0-9_]{0,127}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


class SystemOperationsPort:
    """Minimal Docker/PostgreSQL implementation of the operations protocol."""

    def __init__(self, request: dict[str, Any], api: SimpleNamespace):
        self.request = request
        self.api = api
        self.package_root = Path(request["package_root"])
        self.compose_env_file = Path(request["compose_env_file"])
        self.project = request["project"]
        self.source = request["source"]
        self.roots = request["roots"]
        self.render_environment: dict[str, str] = {}
        self.protected_volume_snapshot: bytes | None = None
        self.protected_runtime_snapshot: bytes | None = None
        self.runtime_secret_snapshot: dict[str, tuple[Any, ...]] | None = None
        self.initial_swap_used: int | None = None
        self.three_layer_config: dict[str, Any] | None = None
        self.postgres_container_id: str | None = None
        self.bootstrap_plan: dict[str, Any] | None = None
        self.bootstrap_receipt: dict[str, Any] | None = None
        self.migration_grant: dict[str, Any] | None = None
        self.engine_result: dict[str, Any] | None = None
        self.operations_compose_sha256: str | None = None
        self.migration_receipt: dict[str, Any] | None = None
        self.unfence_receipt: dict[str, Any] | None = None
        self.reconciliation: dict[str, Any] | None = None
        self.baseline_state: dict[str, Any] | None = None
        self.baseline_structure: str | None = None
        self.root_identities: dict[str, tuple[int, int, int, int, int]] = {}

    def _fail(self, code: str) -> None:
        self.api.fail(code)

    @staticmethod
    def _safe_environment(extra: dict[str, str] | None = None) -> dict[str, str]:
        value = {
            "PATH": "/usr/bin:/bin",
            "LC_ALL": "C",
            "LANG": "C",
            "TZ": "UTC",
            "COMPOSE_PARALLEL_LIMIT": "1",
            "COMPOSE_DISABLE_ENV_FILE": "1",
        }
        if extra:
            value.update(extra)
        return value

    def _run(
        self,
        argv: list[str],
        *,
        input_bytes: bytes | None = None,
        environment: dict[str, str] | None = None,
        timeout: int = 90,
        code: str,
        maximum: int = MAX_COMMAND_OUTPUT,
    ) -> bytes:
        try:
            result = subprocess.run(
                argv,
                input=input_bytes,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                env=environment or self._safe_environment(),
                close_fds=True,
                check=False,
                timeout=timeout,
            )
        except (OSError, subprocess.SubprocessError):
            self._fail(code)
        if result.returncode != 0 or len(result.stdout) > maximum:
            self._fail(code)
        return result.stdout

    def _stable_bytes(self, path: Path, maximum: int = MAX_COMMAND_OUTPUT) -> bytes:
        if not path.is_absolute():
            self._fail("ISOLATED_UAT_SYSTEM_FILE_INVALID")
        cursor = Path(path.anchor)
        for component in path.parts[1:-1]:
            cursor /= component
            try:
                metadata = cursor.lstat()
            except OSError:
                self._fail("ISOLATED_UAT_SYSTEM_FILE_INVALID")
            if (
                not stat.S_ISDIR(metadata.st_mode)
                or stat.S_ISLNK(metadata.st_mode)
                or metadata.st_uid != 0
                or metadata.st_gid != 0
                or stat.S_IMODE(metadata.st_mode) & 0o022
            ):
                self._fail("ISOLATED_UAT_SYSTEM_FILE_ANCESTOR_INVALID")
        descriptor = -1
        try:
            before = path.lstat()
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
            opened = os.fstat(descriptor)
            chunks: list[bytes] = []
            size = 0
            while True:
                chunk = os.read(descriptor, 64 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > maximum:
                    self._fail("ISOLATED_UAT_SYSTEM_FILE_INVALID")
                chunks.append(chunk)
            after = os.fstat(descriptor)
            pointed = path.lstat()
        except OSError:
            self._fail("ISOLATED_UAT_SYSTEM_FILE_INVALID")
        finally:
            if descriptor >= 0:
                os.close(descriptor)
        identities = (before, opened, after, pointed)
        if any(
            not stat.S_ISREG(item.st_mode)
            or stat.S_ISLNK(item.st_mode)
            or item.st_uid != 0
            or item.st_gid != 0
            or item.st_nlink != 1
            or stat.S_IMODE(item.st_mode) & 0o022
            for item in identities
        ):
            self._fail("ISOLATED_UAT_SYSTEM_FILE_INVALID")
        keys = ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns")
        if any(getattr(item, key) != getattr(before, key) for item in identities[1:] for key in keys):
            self._fail("ISOLATED_UAT_SYSTEM_FILE_CHANGED")
        return b"".join(chunks)

    def _validate_root_directory(
        self,
        value: str,
        *,
        mode: int = 0o700,
        empty: bool = False,
    ) -> tuple[int, int, int, int, int]:
        path = Path(value)
        if not path.is_absolute():
            self._fail("ISOLATED_UAT_SYSTEM_ROOT_INVALID")
        cursor = Path(path.anchor)
        try:
            for component in path.parts[1:]:
                cursor /= component
                ancestor = cursor.lstat()
                if (
                    not stat.S_ISDIR(ancestor.st_mode)
                    or stat.S_ISLNK(ancestor.st_mode)
                    or ancestor.st_uid != 0
                    or ancestor.st_gid != 0
                    or stat.S_IMODE(ancestor.st_mode) & 0o022
                ):
                    self._fail("ISOLATED_UAT_SYSTEM_ROOT_ANCESTOR_INVALID")
            metadata = path.lstat()
            resolved = path.resolve(strict=True)
            directory = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
            try:
                opened = os.fstat(directory)
                entries = os.listdir(directory) if empty else []
            finally:
                os.close(directory)
        except OSError:
            self._fail("ISOLATED_UAT_SYSTEM_ROOT_INVALID")
        identity = (metadata.st_dev, metadata.st_ino, metadata.st_mode, metadata.st_uid, metadata.st_gid)
        if (
            resolved != path
            or not stat.S_ISDIR(metadata.st_mode)
            or stat.S_ISLNK(metadata.st_mode)
            or metadata.st_uid != 0
            or metadata.st_gid != 0
            or stat.S_IMODE(metadata.st_mode) != mode
            or (empty and entries)
            or (opened.st_dev, opened.st_ino, opened.st_mode, opened.st_uid, opened.st_gid) != identity
        ):
            self._fail("ISOLATED_UAT_SYSTEM_ROOT_INVALID")
        return identity

    def _assert_roots_unchanged(self) -> None:
        expected_modes = {
            "runtime_secret_root": 0o700,
            "backup_credential_root": 0o700,
            "release_candidate_root": 0o750,
            "migration_grant_root": 0o700,
        }
        if set(self.root_identities) != set(expected_modes):
            self._fail("ISOLATED_UAT_SYSTEM_ROOT_IDENTITY_MISSING")
        for key, mode in expected_modes.items():
            if self._validate_root_directory(self.roots[key], mode=mode) != self.root_identities[key]:
                self._fail("ISOLATED_UAT_SYSTEM_ROOT_CHANGED")

    @staticmethod
    def _stable_identity(metadata: os.stat_result) -> tuple[int, ...]:
        return (
            metadata.st_dev,
            metadata.st_ino,
            metadata.st_mode,
            metadata.st_nlink,
            metadata.st_uid,
            metadata.st_gid,
            metadata.st_size,
            metadata.st_mtime_ns,
            metadata.st_ctime_ns,
        )

    def _runtime_secret_policy(self) -> list[dict[str, Any]]:
        raw = self._stable_bytes(
            self.package_root / "operations/runtime-secret-file-policy-v1.json",
            64 * 1024,
        )
        value = self.api.parse_json(raw, 64 * 1024)
        expected_fields = {
            "schema_version", "contract", "policy_id", "host_root", "container_root",
            "host_root_metadata", "container_root_metadata", "content",
            "forbidden_environment", "entries",
        }
        if not isinstance(value, dict) or set(value) != expected_fields:
            self._fail("ISOLATED_UAT_RUNTIME_SECRET_POLICY_INVALID")
        if (
            value["schema_version"] != 1
            or value["contract"] != "chenyida-erp-runtime-secret-file-policy/v1"
            or value["policy_id"] != "chenyida-erp-controlled-runtime-secret-files-v1"
            or value["host_root"] != "/etc/chenyida-erp/runtime-secrets"
            or value["container_root"] != "/run/chenyida-erp-secrets"
            or value["host_root_metadata"] != {"uid": 0, "gid": 0, "mode": "0700"}
            or value["container_root_metadata"] != {"uid": 0, "gid": 0, "mode": "0555"}
            or value["content"] != EXPECTED_SECRET_POLICY_CONTENT
            or value["forbidden_environment"] != list(EXPECTED_FORBIDDEN_SECRET_ENVIRONMENT)
            or not isinstance(value["entries"], list)
            or len(value["entries"]) != len(EXPECTED_SECRET_BINDINGS)
        ):
            self._fail("ISOLATED_UAT_RUNTIME_SECRET_POLICY_INVALID")
        entries: list[dict[str, Any]] = []
        observed_ids: list[str] = []
        observed_names: list[str] = []
        for entry in value["entries"]:
            if not isinstance(entry, dict) or set(entry) != {
                "id", "service", "service_kind", "source_name", "target_path", "uid", "gid", "mode",
            }:
                self._fail("ISOLATED_UAT_RUNTIME_SECRET_POLICY_INVALID")
            identifier = entry.get("id")
            expected = EXPECTED_SECRET_BINDINGS.get(identifier) if isinstance(identifier, str) else None
            if expected is None:
                self._fail("ISOLATED_UAT_RUNTIME_SECRET_POLICY_INVALID")
            service, service_kind, source_name, uid, gid = expected
            if entry != {
                "id": identifier,
                "service": service,
                "service_kind": service_kind,
                "source_name": source_name,
                "target_path": f"/run/chenyida-erp-secrets/{source_name}",
                "uid": uid,
                "gid": gid,
                "mode": "0440",
            }:
                self._fail("ISOLATED_UAT_RUNTIME_SECRET_POLICY_INVALID")
            observed_ids.append(identifier)
            observed_names.append(source_name)
            entries.append(entry)
        if observed_ids != sorted(EXPECTED_SECRET_BINDINGS) or len(set(observed_names)) != len(observed_names):
            self._fail("ISOLATED_UAT_RUNTIME_SECRET_POLICY_INVALID")
        return entries

    def _capture_runtime_secrets(self) -> dict[str, tuple[Any, ...]]:
        entries = self._runtime_secret_policy()
        if any(name in os.environ for name in EXPECTED_FORBIDDEN_SECRET_ENVIRONMENT):
            self._fail("ISOLATED_UAT_RUNTIME_SECRET_ENVIRONMENT_FORBIDDEN")
        root = Path(self.roots["runtime_secret_root"])
        expected_root = self.root_identities.get("runtime_secret_root")
        if expected_root is None:
            self._fail("ISOLATED_UAT_RUNTIME_SECRET_ROOT_INVALID")
        directory = -1
        snapshots: dict[str, tuple[Any, ...]] = {}
        identities: set[tuple[int, int]] = set()
        normalized_values: set[bytes] = set()
        try:
            directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
            opened_root = os.fstat(directory)
            if (
                opened_root.st_dev,
                opened_root.st_ino,
                opened_root.st_mode,
                opened_root.st_uid,
                opened_root.st_gid,
            ) != expected_root:
                self._fail("ISOLATED_UAT_RUNTIME_SECRET_ROOT_INVALID")
            for entry in entries:
                name = entry["source_name"]
                descriptor = -1
                try:
                    before = os.stat(name, dir_fd=directory, follow_symlinks=False)
                    if (
                        not stat.S_ISREG(before.st_mode)
                        or stat.S_ISLNK(before.st_mode)
                        or before.st_nlink != 1
                        or before.st_uid != 0
                        or before.st_gid != entry["gid"]
                        or stat.S_IMODE(before.st_mode) != 0o440
                        or before.st_size not in {43, 44}
                    ):
                        self._fail("ISOLATED_UAT_RUNTIME_SECRET_FILE_INVALID")
                    descriptor = os.open(
                        name,
                        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
                        dir_fd=directory,
                    )
                    opened = os.fstat(descriptor)
                    raw = b""
                    while len(raw) <= 44:
                        chunk = os.read(descriptor, 45 - len(raw))
                        if not chunk:
                            break
                        raw += chunk
                    after = os.fstat(descriptor)
                    pointed = os.stat(name, dir_fd=directory, follow_symlinks=False)
                except OSError:
                    self._fail("ISOLATED_UAT_RUNTIME_SECRET_FILE_INVALID")
                finally:
                    if descriptor >= 0:
                        os.close(descriptor)
                stable = self._stable_identity(before)
                if (
                    stable != self._stable_identity(opened)
                    or stable != self._stable_identity(after)
                    or stable != self._stable_identity(pointed)
                    or len(raw) != opened.st_size
                ):
                    self._fail("ISOLATED_UAT_RUNTIME_SECRET_FILE_CHANGED")
                normalized = raw[:-1] if raw.endswith(b"\n") else raw
                if (
                    len(normalized) != EXPECTED_SECRET_POLICY_CONTENT["exact_bytes"]
                    or re.fullmatch(rb"[A-Za-z0-9_-]{43}", normalized) is None
                    or len(set(normalized)) < EXPECTED_SECRET_POLICY_CONTENT["minimum_distinct_characters"]
                ):
                    self._fail("ISOLATED_UAT_RUNTIME_SECRET_CONTENT_INVALID")
                try:
                    decoded = base64.b64decode(normalized + b"=", altchars=b"-_", validate=True)
                except (ValueError, binascii.Error):
                    self._fail("ISOLATED_UAT_RUNTIME_SECRET_CONTENT_INVALID")
                if (
                    len(decoded) != EXPECTED_SECRET_POLICY_CONTENT["decoded_bytes"]
                    or base64.urlsafe_b64encode(decoded).rstrip(b"=") != normalized
                ):
                    self._fail("ISOLATED_UAT_RUNTIME_SECRET_CONTENT_INVALID")
                inode = (opened.st_dev, opened.st_ino)
                if inode in identities:
                    self._fail("ISOLATED_UAT_RUNTIME_SECRET_IDENTITY_REUSED")
                if normalized in normalized_values:
                    self._fail("ISOLATED_UAT_RUNTIME_SECRET_VALUE_REUSED")
                identities.add(inode)
                normalized_values.add(normalized)
                snapshots[name] = (*stable, hashlib.sha256(raw).digest())
            final_root = os.fstat(directory)
            if (
                final_root.st_dev,
                final_root.st_ino,
                final_root.st_mode,
                final_root.st_uid,
                final_root.st_gid,
            ) != expected_root:
                self._fail("ISOLATED_UAT_RUNTIME_SECRET_ROOT_CHANGED")
        finally:
            if directory >= 0:
                os.close(directory)
        return snapshots

    def _assert_runtime_secrets_unchanged(self) -> None:
        if self.runtime_secret_snapshot is None:
            self._fail("ISOLATED_UAT_RUNTIME_SECRET_SNAPSHOT_MISSING")
        if self._capture_runtime_secrets() != self.runtime_secret_snapshot:
            self._fail("ISOLATED_UAT_RUNTIME_SECRET_FILE_CHANGED")

    def _load_render_environment(self) -> dict[str, str]:
        raw = self._stable_bytes(self.compose_env_file, 128 * 1024)
        if b"\x00" in raw or b"\r" in raw:
            self._fail("ISOLATED_UAT_RENDER_ENV_INVALID")
        try:
            text = raw.decode("ascii")
        except UnicodeDecodeError:
            self._fail("ISOLATED_UAT_RENDER_ENV_INVALID")
        result: dict[str, str] = {}
        for line in text.splitlines():
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                self._fail("ISOLATED_UAT_RENDER_ENV_INVALID")
            key, value = line.split("=", 1)
            if not ENVIRONMENT_KEY.fullmatch(key) or key in result or any(ord(item) < 0x20 or ord(item) > 0x7E for item in value):
                self._fail("ISOLATED_UAT_RENDER_ENV_INVALID")
            result[key] = value
        expected = {
            "ERP_UAT_COMPOSE_PROJECT": self.project,
            "ERP_UAT_RUNTIME_SECRET_ROOT": self.roots["runtime_secret_root"],
            "ERP_UAT_BACKUP_CREDENTIAL_ROOT": self.roots["backup_credential_root"],
            "ERP_UAT_RELEASE_CANDIDATE_ROOT": self.roots["release_candidate_root"],
            "ERP_UAT_MIGRATION_GRANT_ROOT": self.roots["migration_grant_root"],
            "ERP_RELEASE_EXPECTED_VERSION": self.source["package_version"],
            "ERP_RELEASE_EXPECTED_GIT_COMMIT": self.source["git_commit"],
            "ERP_WEB_IMAGE": self.source["web_image"],
            "ERP_WORKER_IMAGE": self.source["worker_image"],
            "ERP_WEB_IMAGE_CONFIG_DIGEST": self.source["web_image_config_digest"],
            "ERP_WORKER_IMAGE_CONFIG_DIGEST": self.source["worker_image_config_digest"],
        }
        if any(result.get(key) != value for key, value in expected.items()):
            self._fail("ISOLATED_UAT_RENDER_ENV_BINDING_INVALID")
        for required in (
            "ERP_UAT_RELEASE_IDENTITY_ROOT",
            "ERP_UAT_HTTP_PORT",
            "ERP_UAT_CADDY_HTTP_PORT",
            "ERP_UAT_CADDY_HTTPS_PORT",
            "ERP_RELEASE_IDENTITY_READER_GID",
        ):
            if not result.get(required):
                self._fail("ISOLATED_UAT_RENDER_ENV_INVALID")
        return result

    def _resource_gate(self) -> None:
        try:
            memory: dict[str, int] = {}
            for line in Path("/proc/meminfo").read_text(encoding="ascii").splitlines():
                key, value = line.split(":", 1)
                memory[key] = int(value.strip().split()[0]) * 1024
            statvfs = os.statvfs("/")
            load_one = os.getloadavg()[0]
        except (OSError, ValueError, KeyError):
            self._fail("ISOLATED_UAT_RESOURCE_GATE_UNAVAILABLE")
        available = memory.get("MemAvailable", 0)
        swap_total = memory.get("SwapTotal", 0)
        swap_used = max(0, swap_total - memory.get("SwapFree", 0))
        disk_available = statvfs.f_bavail * statvfs.f_frsize
        if (
            available < MIN_AVAILABLE_MEMORY
            or disk_available < MIN_AVAILABLE_DISK
            or load_one > MAX_LOAD_ONE
            or (swap_total > 0 and swap_used * 100 > swap_total * MAX_SWAP_PERCENT)
            or (self.initial_swap_used is not None and swap_used - self.initial_swap_used > MAX_SWAP_GROWTH)
        ):
            self._fail("ISOLATED_UAT_RESOURCE_GATE_BLOCKED")
        if self.initial_swap_used is None:
            self.initial_swap_used = swap_used

    def _docker_json(self, argv: list[str], code: str) -> Any:
        raw = self._run(argv, code=code)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._fail(code)

    def _snapshot_protected_volumes(self) -> bytes:
        value = self._docker_json([DOCKER, "volume", "inspect", *PROTECTED_VOLUMES], "ISOLATED_UAT_PROTECTED_VOLUME_INVALID")
        if not isinstance(value, list) or {item.get("Name") for item in value if isinstance(item, dict)} != set(PROTECTED_VOLUMES):
            self._fail("ISOLATED_UAT_PROTECTED_VOLUME_INVALID")
        return self.api.canonical_json(value)

    @staticmethod
    def _mount_identity(mount: Any) -> dict[str, Any] | None:
        if not isinstance(mount, dict) or mount.get("Type") not in {"bind", "volume"}:
            return None
        return {
            "type": mount.get("Type"),
            "name": mount.get("Name") if mount.get("Type") == "volume" else None,
            "source": mount.get("Source") if mount.get("Type") == "bind" else None,
            "destination": mount.get("Destination"),
            "read_write": mount.get("RW"),
        }

    def _snapshot_protected_runtime(self) -> bytes:
        raw = self._run(
            [
                DOCKER, "ps", "-aq", "--no-trunc",
                "--filter", f"label=com.docker.compose.project={PROTECTED_PROJECT}",
            ],
            code="ISOLATED_UAT_PROTECTED_RUNTIME_INVALID",
        )
        try:
            container_ids = [line for line in raw.decode("ascii", "strict").splitlines() if line]
        except UnicodeDecodeError:
            self._fail("ISOLATED_UAT_PROTECTED_RUNTIME_INVALID")
        if (
            len(container_ids) != len(PROTECTED_SERVICES)
            or len(set(container_ids)) != len(container_ids)
            or any(re.fullmatch(r"[0-9a-f]{64}", item) is None for item in container_ids)
        ):
            self._fail("ISOLATED_UAT_PROTECTED_RUNTIME_INVALID")
        inspected = self._docker_json(
            [DOCKER, "inspect", *container_ids],
            "ISOLATED_UAT_PROTECTED_RUNTIME_INVALID",
        )
        if not isinstance(inspected, list) or len(inspected) != len(container_ids):
            self._fail("ISOLATED_UAT_PROTECTED_RUNTIME_INVALID")
        records: list[dict[str, Any]] = []
        services: set[str] = set()
        for item in inspected:
            if not isinstance(item, dict):
                self._fail("ISOLATED_UAT_PROTECTED_RUNTIME_INVALID")
            config = item.get("Config") if isinstance(item.get("Config"), dict) else {}
            labels = config.get("Labels") if isinstance(config.get("Labels"), dict) else {}
            state = item.get("State") if isinstance(item.get("State"), dict) else {}
            service = labels.get("com.docker.compose.service")
            health_value = state.get("Health")
            if (
                item.get("Id") not in container_ids
                or labels.get("com.docker.compose.project") != PROTECTED_PROJECT
                or service not in PROTECTED_SERVICES
                or service in services
                or state.get("Running") is not True
                or state.get("Restarting") is not False
                or state.get("OOMKilled") is not False
                or item.get("RestartCount") != 0
                or (health_value is not None and (
                    not isinstance(health_value, dict) or health_value.get("Status") != "healthy"
                ))
            ):
                self._fail("ISOLATED_UAT_PROTECTED_RUNTIME_INVALID")
            mounts = item.get("Mounts") if isinstance(item.get("Mounts"), list) else None
            networks = (
                item.get("NetworkSettings", {}).get("Networks")
                if isinstance(item.get("NetworkSettings"), dict)
                else None
            )
            if mounts is None or not isinstance(networks, dict):
                self._fail("ISOLATED_UAT_PROTECTED_RUNTIME_INVALID")
            normalized_mounts = [self._mount_identity(mount) for mount in mounts]
            if any(mount is None for mount in normalized_mounts):
                self._fail("ISOLATED_UAT_PROTECTED_RUNTIME_INVALID")
            normalized_networks: dict[str, str] = {}
            for name, network in networks.items():
                network_id = network.get("NetworkID") if isinstance(network, dict) else None
                if not isinstance(name, str) or re.fullmatch(r"[0-9a-f]{64}", network_id or "") is None:
                    self._fail("ISOLATED_UAT_PROTECTED_RUNTIME_INVALID")
                normalized_networks[name] = network_id
            services.add(service)
            records.append({
                "id": item["Id"],
                "name": item.get("Name"),
                "service": service,
                "image": item.get("Image"),
                "configured_image": config.get("Image"),
                "started_at": state.get("StartedAt"),
                "running": True,
                "restarting": False,
                "oom_killed": False,
                "restart_count": 0,
                "health": health_value.get("Status") if isinstance(health_value, dict) else None,
                "mounts": sorted(normalized_mounts, key=lambda mount: (mount["destination"] or "")),
                "networks": normalized_networks,
            })
        if services != set(PROTECTED_SERVICES):
            self._fail("ISOLATED_UAT_PROTECTED_RUNTIME_INVALID")
        records.sort(key=lambda item: item["service"])
        return self.api.canonical_json(records)

    def _assert_protected_volumes_unchanged(self) -> None:
        if self.protected_volume_snapshot is None or self._snapshot_protected_volumes() != self.protected_volume_snapshot:
            self._fail("ISOLATED_UAT_PROTECTED_VOLUME_CHANGED")
        if self.protected_runtime_snapshot is None or self._snapshot_protected_runtime() != self.protected_runtime_snapshot:
            self._fail("ISOLATED_UAT_PROTECTED_RUNTIME_CHANGED")

    def _validate_manifest_binding(self, raw: bytes) -> None:
        manifest = self.api.parse_json(raw, 4 * 1024 * 1024)
        source = manifest.get("source") if isinstance(manifest, dict) else None
        images = manifest.get("images") if isinstance(manifest, dict) else None
        migrations = manifest.get("migrations") if isinstance(manifest, dict) else None
        web = images.get("web") if isinstance(images, dict) else None
        worker = images.get("worker") if isinstance(images, dict) else None
        entries = migrations.get("entries") if isinstance(migrations, dict) else None
        database = self.request.get("database")
        if (
            not isinstance(source, dict)
            or source.get("git_commit") != self.source["git_commit"]
            or source.get("git_tree") != self.source["git_tree"]
            or source.get("package_version") != self.source["package_version"]
            or not isinstance(web, dict)
            or web.get("image_reference") != self.source["web_image"]
            or not isinstance(worker, dict)
            or worker.get("image_reference") != self.source["worker_image"]
            or not isinstance(migrations, dict)
            or not isinstance(database, dict)
            or migrations.get("head") != database.get("target_head")
            or migrations.get("allowlist_sha256") != database.get("migration_allowlist_sha256")
            or not isinstance(entries, list)
            or len(entries) != database.get("migration_count")
        ):
            self._fail("ISOLATED_UAT_RELEASE_MANIFEST_BINDING_INVALID")

    def _assert_project_absent(self) -> None:
        filters = ["container", "volume", "network"]
        commands = {
            "container": [DOCKER, "ps", "-aq", "--filter", f"label=com.docker.compose.project={self.project}"],
            "volume": [DOCKER, "volume", "ls", "-q", "--filter", f"label=com.docker.compose.project={self.project}"],
            "network": [DOCKER, "network", "ls", "-q", "--filter", f"label=com.docker.compose.project={self.project}"],
        }
        for kind in filters:
            if self._run(commands[kind], code="ISOLATED_UAT_PROJECT_COLLISION").strip():
                self._fail("ISOLATED_UAT_PROJECT_COLLISION")

    def _assert_resolved_resource_names_absent(self, compose: dict[str, Any]) -> None:
        resolved: dict[str, set[str]] = {"volume": set(), "network": set()}
        for singular, plural in (("volume", "volumes"), ("network", "networks")):
            section = compose.get(plural)
            if not isinstance(section, dict) or not section:
                self._fail("ISOLATED_UAT_RESOLVED_RESOURCE_INVALID")
            for logical_name, specification in section.items():
                if not isinstance(logical_name, str) or not isinstance(specification, dict):
                    self._fail("ISOLATED_UAT_RESOLVED_RESOURCE_INVALID")
                concrete_name = specification.get("name")
                if not isinstance(concrete_name, str) or not concrete_name:
                    self._fail("ISOLATED_UAT_RESOLVED_RESOURCE_INVALID")
                resolved[singular].add(concrete_name)

        commands = {
            "volume": [DOCKER, "volume", "ls", "-q"],
            "network": [DOCKER, "network", "ls", "-q"],
        }
        for kind, command in commands.items():
            try:
                existing = set(self._run(command, code="ISOLATED_UAT_PROJECT_COLLISION").decode("utf-8", "strict").splitlines())
            except UnicodeDecodeError:
                self._fail("ISOLATED_UAT_PROJECT_COLLISION")
            if resolved[kind] & existing:
                self._fail("ISOLATED_UAT_PROJECT_COLLISION")

        services = compose.get("services")
        if not isinstance(services, dict) or not services:
            self._fail("ISOLATED_UAT_RESOLVED_RESOURCE_INVALID")
        explicit_names: set[str] = set()
        for service_name, specification in services.items():
            if not isinstance(service_name, str) or not isinstance(specification, dict):
                self._fail("ISOLATED_UAT_RESOLVED_RESOURCE_INVALID")
            explicit_name = specification.get("container_name")
            if explicit_name is not None:
                if not isinstance(explicit_name, str) or not explicit_name:
                    self._fail("ISOLATED_UAT_RESOLVED_RESOURCE_INVALID")
                explicit_names.add(explicit_name)
        try:
            container_names = self._run(
                [DOCKER, "ps", "-a", "--format", "{{.Names}}"],
                code="ISOLATED_UAT_PROJECT_COLLISION",
            ).decode("utf-8", "strict").splitlines()
        except UnicodeDecodeError:
            self._fail("ISOLATED_UAT_PROJECT_COLLISION")
        compose_prefixes = (f"{self.project}-", f"{self.project}_", f"cyd-{self.project}-")
        if any(name in explicit_names or name.startswith(compose_prefixes) for name in container_names):
            self._fail("ISOLATED_UAT_PROJECT_COLLISION")

    def _inspect_image(self, reference: str, config_digest: str) -> None:
        value = self._docker_json([DOCKER, "image", "inspect", reference], "ISOLATED_UAT_IMAGE_INVALID")
        if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
            self._fail("ISOLATED_UAT_IMAGE_INVALID")
        image = value[0]
        config = image.get("Config") if isinstance(image.get("Config"), dict) else {}
        labels = config.get("Labels") if isinstance(config.get("Labels"), dict) else {}
        descriptor = image.get("Descriptor") if isinstance(image.get("Descriptor"), dict) else {}
        annotations = descriptor.get("annotations") if isinstance(descriptor.get("annotations"), dict) else {}
        _, separator, manifest_digest = reference.rpartition("@")
        if (
            separator != "@"
            or re.fullmatch(r"sha256:[0-9a-f]{64}", manifest_digest) is None
            or manifest_digest == config_digest
            or image.get("Id") != manifest_digest
            or descriptor.get("digest") != manifest_digest
            or annotations.get("config.digest") != config_digest
            or image.get("Os") != "linux"
            or image.get("Architecture") != "amd64"
            or not isinstance(image.get("RepoDigests"), list)
            or reference not in image["RepoDigests"]
            or labels.get("org.opencontainers.image.version") != self.source["package_version"]
            or labels.get("org.opencontainers.image.revision") != self.source["git_commit"]
        ):
            self._fail("ISOLATED_UAT_IMAGE_INVALID")

    def _compose_prefix(self, count: int, *, dynamic: bool = False) -> tuple[list[str], dict[str, str]]:
        argv = [
            DOCKER, "compose",
            "--env-file", str(self.compose_env_file),
            "--project-name", self.project,
            "--project-directory", str(self.package_root),
        ]
        for name in COMPOSE_FILES[:count]:
            argv.extend(["-f", str(self.package_root / name)])
        environment = self._safe_environment(self._dynamic_environment() if dynamic else None)
        return argv, environment

    def _render_compose(self, count: int, *, dynamic: bool = False) -> dict[str, Any]:
        prefix, environment = self._compose_prefix(count, dynamic=dynamic)
        raw = self._run(
            [*prefix, "--profile", "*", "config", "--format", "json"],
            environment=environment,
            code="ISOLATED_UAT_COMPOSE_RENDER_FAILED",
        )
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._fail("ISOLATED_UAT_COMPOSE_RENDER_FAILED")
        if not isinstance(value, dict):
            self._fail("ISOLATED_UAT_COMPOSE_RENDER_FAILED")
        return value

    def _validate_three_layer_policy(self, compose: dict[str, Any]) -> None:
        env = self.render_environment
        command = [
            PYTHON, "-I", "-S", "-B",
            str(self.package_root / "scripts/isolated-uat-compose-policy.py"),
            "--project", self.project,
            "--project-root", str(self.package_root),
            "--runtime-secret-root", self.roots["runtime_secret_root"],
            "--release-candidate-root", self.roots["release_candidate_root"],
            "--release-identity-root", env["ERP_UAT_RELEASE_IDENTITY_ROOT"],
            "--web-port", env["ERP_UAT_HTTP_PORT"],
            "--caddy-http-port", env["ERP_UAT_CADDY_HTTP_PORT"],
            "--caddy-https-port", env["ERP_UAT_CADDY_HTTPS_PORT"],
        ]
        self._run(
            command,
            input_bytes=self.api.canonical_json(compose),
            code="ISOLATED_UAT_THREE_LAYER_POLICY_FAILED",
        )

    def validate_preflight(self, request: dict[str, Any]) -> dict[str, Any]:
        if request != self.request:
            self._fail("ISOLATED_UAT_SYSTEM_REQUEST_CHANGED")
        for key in ("runtime_secret_root", "backup_credential_root"):
            self.root_identities[key] = self._validate_root_directory(self.roots[key])
        # The migrate service is 65532:0 and must be able to traverse this
        # root-owned directory to read its 0440 release manifest.
        self.root_identities["release_candidate_root"] = self._validate_root_directory(
            self.roots["release_candidate_root"], mode=0o750,
        )
        self.root_identities["migration_grant_root"] = self._validate_root_directory(
            self.roots["migration_grant_root"], empty=True,
        )
        self._assert_roots_unchanged()
        self.render_environment = self._load_render_environment()
        self.runtime_secret_snapshot = self._capture_runtime_secrets()
        manifest_raw = self._stable_bytes(Path(self.source["release_manifest_file"]), 4 * 1024 * 1024)
        if hashlib.sha256(manifest_raw).hexdigest() != self.source["release_manifest_sha256"]:
            self._fail("ISOLATED_UAT_RELEASE_MANIFEST_SHA256_MISMATCH")
        self._validate_manifest_binding(manifest_raw)
        self._resource_gate()
        self.protected_volume_snapshot = self._snapshot_protected_volumes()
        self.protected_runtime_snapshot = self._snapshot_protected_runtime()
        self._assert_project_absent()
        self._inspect_image(self.source["web_image"], self.source["web_image_config_digest"])
        self._inspect_image(self.source["worker_image"], self.source["worker_image_config_digest"])
        compose = self._render_compose(3)
        self._assert_resolved_resource_names_absent(compose)
        if self.api.digest(compose) != self.source["resolved_compose_sha256"]:
            self._fail("ISOLATED_UAT_RESOLVED_COMPOSE_SHA256_MISMATCH")
        self._validate_three_layer_policy(compose)
        self.three_layer_config = compose
        self._assert_runtime_secrets_unchanged()
        self._assert_protected_volumes_unchanged()
        return {"status": "ELIGIBLE_INPUTS_VERIFIED"}

    def _helper_base(self, command: str, *, credentials: bool = False, name_suffix: str | None = None) -> list[str]:
        name = f"cyd-{self.project}-{name_suffix or command}"
        if len(name) > 120:
            self._fail("ISOLATED_UAT_HELPER_NAME_INVALID")
        argv = [
            DOCKER, "run", "--rm", "--pull", "never", "--name", name,
            "--label", f"chenyida.erp.isolated-uat-root-helper={self.request['request_id']}",
            "--log-driver", "none",
            "--network", "none", "--read-only", "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges", "--pids-limit", "64",
            "--memory", "384m", "--memory-swap", "512m", "--cpus", "0.50",
            "--user", "0:0" if credentials else "65532:65532",
            "--env", "NODE_OPTIONS=--max-old-space-size=256",
        ]
        if credentials:
            for root in (self.roots["runtime_secret_root"], self.roots["backup_credential_root"]):
                argv.extend(["--mount", f"type=bind,src={root},dst={root},readonly"])
        argv.extend([
            self.source["worker_image"],
            "node", "/app/scripts/isolated-uat-database-operation-cli.mjs", command,
        ])
        return argv

    def _helper_json(self, command: str, value: Any) -> dict[str, Any]:
        raw = self._run(
            self._helper_base(command),
            input_bytes=self.api.canonical_json(value),
            code="ISOLATED_UAT_DATABASE_HELPER_FAILED",
            timeout=120,
        )
        parsed = self.api.parse_json(raw, MAX_COMMAND_OUTPUT)
        if not isinstance(parsed, dict) or raw != self.api.canonical_json(parsed):
            self._fail("ISOLATED_UAT_DATABASE_HELPER_OUTPUT_INVALID")
        return parsed

    def _helper_sql(self, phase: str) -> bytes:
        raw = self._run(
            self._helper_base("observation-sql", name_suffix=f"observe-{phase.lower()[:16]}"),
            input_bytes=self.api.canonical_json({"phase": phase, "project": self.project}),
            code="ISOLATED_UAT_DATABASE_OBSERVATION_SQL_FAILED",
            timeout=60,
        )
        if not raw or len(raw) > 2 * 1024 * 1024 or b"\x00" in raw:
            self._fail("ISOLATED_UAT_DATABASE_OBSERVATION_SQL_FAILED")
        return raw

    def validate_release_manifest(self, request: dict[str, Any]) -> None:
        self._assert_roots_unchanged()
        candidate = self.roots["release_candidate_root"]
        manifest = self.source["release_manifest_file"]
        command = [
            DOCKER, "run", "--rm", "--pull", "never",
            "--name", f"cyd-{self.project}-manifest-verify",
            "--label", f"chenyida.erp.isolated-uat-root-helper={request['request_id']}",
            "--log-driver", "none",
            "--network", "none", "--read-only", "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges", "--pids-limit", "64",
            "--memory", "384m", "--memory-swap", "512m", "--cpus", "0.50",
            "--user", "0:0",
            "--mount", f"type=bind,src={candidate},dst={candidate},readonly",
            self.source["worker_image"],
            "node", "/app/scripts/release-manifest-contract.mjs", "verify",
            "--manifest", manifest,
            "--expected-sha256", self.source["release_manifest_sha256"],
            "--migrations", "/app/drizzle-postgres",
            "--require-eligible", "YES",
        ]
        raw = self._run(command, code="ISOLATED_UAT_RELEASE_MANIFEST_INVALID", timeout=120)
        try:
            result = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._fail("ISOLATED_UAT_RELEASE_MANIFEST_INVALID")
        if result.get("result") != "VERIFIED" or result.get("promotion_status") != "ELIGIBLE" or result.get("migration_head") != TARGET_HEAD:
            self._fail("ISOLATED_UAT_RELEASE_MANIFEST_INVALID")
        self._assert_protected_volumes_unchanged()

    def _find_postgres(self) -> str:
        raw = self._run(
            [
                DOCKER, "ps", "-aq", "--no-trunc",
                "--filter", f"label=com.docker.compose.project={self.project}",
                "--filter", "label=com.docker.compose.service=postgres",
            ],
            code="ISOLATED_UAT_POSTGRES_CONTAINER_INVALID",
        )
        values = [line for line in raw.decode("ascii", "strict").splitlines() if line]
        if len(values) != 1 or not re.fullmatch(r"[0-9a-f]{64}", values[0]):
            self._fail("ISOLATED_UAT_POSTGRES_CONTAINER_INVALID")
        return values[0]

    @staticmethod
    def _normalize_tmpfs(value: Any) -> dict[str, tuple[str, ...]] | None:
        result: dict[str, tuple[str, ...]] = {}
        if isinstance(value, list):
            entries = []
            for item in value:
                if not isinstance(item, str) or ":" not in item:
                    return None
                target, options = item.split(":", 1)
                entries.append((target, options))
        elif isinstance(value, dict):
            entries = list(value.items())
        else:
            return None
        for target, options in entries:
            if (
                not isinstance(target, str)
                or not target.startswith("/")
                or not isinstance(options, str)
                or target in result
            ):
                return None
            tokens = options.split(",") if options else []
            if not tokens or any(not token for token in tokens) or len(tokens) != len(set(tokens)):
                return None
            result[target] = tuple(sorted(tokens))
        return result

    def _expected_postgres_runtime(self) -> dict[str, Any]:
        compose = self.three_layer_config
        if not isinstance(compose, dict):
            self._fail("ISOLATED_UAT_POSTGRES_CONTAINER_INVALID")
        services = compose.get("services")
        volumes = compose.get("volumes")
        networks = compose.get("networks")
        service = services.get("postgres") if isinstance(services, dict) else None
        if not isinstance(service, dict) or not isinstance(volumes, dict) or not isinstance(networks, dict):
            self._fail("ISOLATED_UAT_POSTGRES_CONTAINER_INVALID")
        image = service.get("image")
        user = service.get("user")
        service_networks = service.get("networks")
        service_mounts = service.get("volumes")
        if (
            not isinstance(image, str)
            or "@sha256:" not in image
            or not isinstance(user, str)
            or not isinstance(service_networks, dict)
            or set(service_networks) != {"backend"}
            or not isinstance(service_mounts, list)
        ):
            self._fail("ISOLATED_UAT_POSTGRES_CONTAINER_INVALID")
        backend = networks.get("backend")
        network_name = backend.get("name") if isinstance(backend, dict) else None
        if not isinstance(network_name, str) or not network_name:
            self._fail("ISOLATED_UAT_POSTGRES_CONTAINER_INVALID")
        expected_mounts: list[dict[str, Any]] = []
        for mount in service_mounts:
            if not isinstance(mount, dict) or mount.get("type") not in {"bind", "volume"}:
                self._fail("ISOLATED_UAT_POSTGRES_CONTAINER_INVALID")
            mount_type = mount["type"]
            source = mount.get("source")
            target = mount.get("target")
            if not isinstance(source, str) or not isinstance(target, str):
                self._fail("ISOLATED_UAT_POSTGRES_CONTAINER_INVALID")
            name: str | None = None
            bind_source: str | None = None
            if mount_type == "volume":
                volume = volumes.get(source)
                name = volume.get("name") if isinstance(volume, dict) else None
                if not isinstance(name, str) or not name:
                    self._fail("ISOLATED_UAT_POSTGRES_CONTAINER_INVALID")
            else:
                bind_source = source
            expected_mounts.append({
                "type": mount_type,
                "name": name,
                "source": bind_source,
                "destination": target,
                "read_write": mount.get("read_only") is not True,
            })
        expected_tmpfs = self._normalize_tmpfs(service.get("tmpfs"))
        if expected_tmpfs is None:
            self._fail("ISOLATED_UAT_POSTGRES_CONTAINER_INVALID")
        return {
            "image_reference": image,
            "image_manifest_digest": image.rsplit("@", 1)[1],
            "user": user,
            "network": network_name,
            "mounts": sorted(expected_mounts, key=lambda mount: mount["destination"]),
            "tmpfs": expected_tmpfs,
        }

    def _verify_postgres(self, *, allow_starting: bool = False) -> bool:
        if self.postgres_container_id is None:
            self._fail("ISOLATED_UAT_POSTGRES_CONTAINER_INVALID")
        value = self._docker_json([DOCKER, "inspect", self.postgres_container_id], "ISOLATED_UAT_POSTGRES_CONTAINER_INVALID")
        if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
            self._fail("ISOLATED_UAT_POSTGRES_CONTAINER_INVALID")
        item = value[0]
        expected = self._expected_postgres_runtime()
        state = item.get("State") if isinstance(item.get("State"), dict) else {}
        health = state.get("Health") if isinstance(state.get("Health"), dict) else {}
        config = item.get("Config") if isinstance(item.get("Config"), dict) else {}
        labels = config.get("Labels") if isinstance(config.get("Labels"), dict) else {}
        mounts = item.get("Mounts") if isinstance(item.get("Mounts"), list) else []
        normalized_mounts = [self._mount_identity(mount) for mount in mounts]
        host = item.get("HostConfig") if isinstance(item.get("HostConfig"), dict) else {}
        network_settings = item.get("NetworkSettings") if isinstance(item.get("NetworkSettings"), dict) else {}
        actual_networks = network_settings.get("Networks") if isinstance(network_settings.get("Networks"), dict) else {}
        actual_ports = network_settings.get("Ports")
        no_published_ports = (
            actual_ports in ({}, None)
            or (
                isinstance(actual_ports, dict)
                and all(bindings in (None, []) for bindings in actual_ports.values())
            )
        )
        if (
            item.get("Id") != self.postgres_container_id
            or item.get("Image") != expected["image_manifest_digest"]
            or config.get("Image") != expected["image_reference"]
            or config.get("User") != expected["user"]
            or labels.get("com.docker.compose.project") != self.project
            or labels.get("com.docker.compose.service") != "postgres"
            or state.get("Running") is not True
            or state.get("Paused") is not False
            or state.get("Restarting") is not False
            or state.get("OOMKilled") is not False
            or state.get("Dead") is not False
            or item.get("RestartCount") != 0
            or any(mount is None for mount in normalized_mounts)
            or sorted(normalized_mounts, key=lambda mount: mount["destination"]) != expected["mounts"]
            or any(mount.get("Name") in PROTECTED_VOLUMES for mount in mounts if isinstance(mount, dict))
            or host.get("NetworkMode") != expected["network"]
            or set(actual_networks) != {expected["network"]}
            or host.get("PortBindings") not in ({}, None)
            or host.get("PublishAllPorts") is not False
            or not no_published_ports
            or host.get("ReadonlyRootfs") is not True
            or host.get("Privileged") is not False
            or self._normalize_tmpfs(host.get("Tmpfs")) != expected["tmpfs"]
        ):
            self._fail("ISOLATED_UAT_POSTGRES_CONTAINER_INVALID")
        if health.get("Status") == "healthy":
            return True
        if allow_starting and health.get("Status") == "starting":
            return False
        self._fail("ISOLATED_UAT_POSTGRES_CONTAINER_INVALID")

    def _assert_only_postgres(self) -> None:
        raw = self._run(
            [DOCKER, "ps", "-aq", "--no-trunc", "--filter", f"label=com.docker.compose.project={self.project}"],
            code="ISOLATED_UAT_PROJECT_RUNTIME_INVALID",
        )
        ids = [line for line in raw.decode("ascii", "strict").splitlines() if line]
        if ids != [self.postgres_container_id]:
            self._fail("ISOLATED_UAT_RUNTIME_SERVICE_STARTED")

    def _container_ids(self, *filters: str, running_only: bool = False) -> list[str]:
        argv = [DOCKER, "ps", "-q" if running_only else "-aq", "--no-trunc"]
        for value in filters:
            argv.extend(["--filter", value])
        raw = self._run(argv, code="ISOLATED_UAT_CONTAINMENT_INVENTORY_FAILED")
        try:
            values = [line for line in raw.decode("ascii", "strict").splitlines() if line]
        except UnicodeDecodeError:
            self._fail("ISOLATED_UAT_CONTAINMENT_INVENTORY_FAILED")
        if len(values) != len(set(values)) or any(not re.fullmatch(r"[0-9a-f]{64}", value) for value in values):
            self._fail("ISOLATED_UAT_CONTAINMENT_INVENTORY_FAILED")
        return values

    def _inspect_owned_container(self, container_id: str, *, helper: bool) -> dict[str, Any]:
        value = self._docker_json([DOCKER, "inspect", container_id], "ISOLATED_UAT_CONTAINMENT_OWNERSHIP_INVALID")
        if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
            self._fail("ISOLATED_UAT_CONTAINMENT_OWNERSHIP_INVALID")
        item = value[0]
        config = item.get("Config") if isinstance(item.get("Config"), dict) else {}
        labels = config.get("Labels") if isinstance(config.get("Labels"), dict) else {}
        mounts = item.get("Mounts") if isinstance(item.get("Mounts"), list) else []
        name = item.get("Name")
        if (
            item.get("Id") != container_id
            or not isinstance(name, str)
            or any(mount.get("Name") in PROTECTED_VOLUMES for mount in mounts if isinstance(mount, dict))
        ):
            self._fail("ISOLATED_UAT_CONTAINMENT_OWNERSHIP_INVALID")
        if helper:
            if (
                labels.get("chenyida.erp.isolated-uat-root-helper") != self.request["request_id"]
                or not name.startswith(f"/cyd-{self.project}-")
                or config.get("Image") != self.source["worker_image"]
            ):
                self._fail("ISOLATED_UAT_CONTAINMENT_OWNERSHIP_INVALID")
            return item
        if self.three_layer_config is None:
            self._fail("ISOLATED_UAT_CONTAINMENT_OWNERSHIP_INVALID")
        service = labels.get("com.docker.compose.service")
        services = self.three_layer_config.get("services")
        specification = services.get(service) if isinstance(services, dict) and isinstance(service, str) else None
        expected_image = specification.get("image") if isinstance(specification, dict) else None
        if (
            labels.get("com.docker.compose.project") != self.project
            or not isinstance(service, str)
            or expected_image != config.get("Image")
            or not name.startswith((f"/{self.project}-", f"/{self.project}_", f"/cyd-{self.project}-"))
        ):
            self._fail("ISOLATED_UAT_CONTAINMENT_OWNERSHIP_INVALID")
        return item

    def _container_exists(self, container_id: str) -> bool:
        return container_id in self._container_ids(f"id={container_id}")

    def _inspect_transient_if_present(self, container_id: str, *, helper: bool) -> dict[str, Any] | None:
        try:
            return self._inspect_owned_container(container_id, helper=helper)
        except Exception:
            if self._container_exists(container_id):
                raise
            return None

    def _remove_transient_if_present(self, container_id: str) -> None:
        try:
            self._run(
                [DOCKER, "rm", "--force", container_id],
                code="ISOLATED_UAT_CONTAINMENT_TRANSIENT_REMOVE_FAILED",
                timeout=30,
            )
        except Exception:
            if self._container_exists(container_id):
                raise

    def _assert_containment_terminal(self, postgres_ids: list[str]) -> None:
        remaining_project = self._container_ids(f"label=com.docker.compose.project={self.project}")
        remaining_helpers = self._container_ids(
            f"label=chenyida.erp.isolated-uat-root-helper={self.request['request_id']}",
        )
        if set(remaining_project) != set(postgres_ids) or len(remaining_project) != len(postgres_ids):
            self._fail("ISOLATED_UAT_CONTAINMENT_PROJECT_RESIDUE_INVALID")
        if remaining_helpers:
            self._fail("ISOLATED_UAT_CONTAINMENT_HELPER_RESIDUE_INVALID")
        for container_id in postgres_ids:
            state = self._inspect_owned_container(container_id, helper=False).get("State")
            if (
                not isinstance(state, dict)
                or state.get("Running") is not False
                or state.get("Restarting") is not False
                or state.get("OOMKilled") is not False
            ):
                self._fail("ISOLATED_UAT_CONTAINMENT_POSTGRES_STOP_FAILED")

    def contain_failure(self, request: dict[str, Any]) -> dict[str, Any]:
        if request != self.request:
            self._fail("ISOLATED_UAT_CONTAINMENT_REQUEST_INVALID")
        # Stop the stateful service before inspecting short-lived helpers.  A
        # helper may legitimately disappear between list and inspect because
        # every helper is --rm; that race must never prevent PostgreSQL stop.
        postgres_ids = self._container_ids(
            f"label=com.docker.compose.project={self.project}",
            "label=com.docker.compose.service=postgres",
        )
        if len(postgres_ids) > 1 or (
            self.postgres_container_id is not None and postgres_ids != [self.postgres_container_id]
        ):
            self._fail("ISOLATED_UAT_CONTAINMENT_POSTGRES_IDENTITY_INVALID")
        for container_id in postgres_ids:
            record = self._inspect_owned_container(container_id, helper=False)
            state = record.get("State")
            if not isinstance(state, dict):
                self._fail("ISOLATED_UAT_CONTAINMENT_POSTGRES_IDENTITY_INVALID")
            if state.get("Running") is True:
                self._run(
                    [DOCKER, "stop", "--signal", "SIGINT", "--time", "10", container_id],
                    code="ISOLATED_UAT_CONTAINMENT_POSTGRES_STOP_FAILED",
                    timeout=30,
                )
            stopped = self._inspect_owned_container(container_id, helper=False).get("State")
            if not isinstance(stopped, dict) or stopped.get("Running") is not False or stopped.get("Restarting") is not False:
                self._fail("ISOLATED_UAT_CONTAINMENT_POSTGRES_STOP_FAILED")
        project_ids = self._container_ids(f"label=com.docker.compose.project={self.project}")
        helper_ids = self._container_ids(
            f"label=chenyida.erp.isolated-uat-root-helper={self.request['request_id']}",
        )
        transient_ids = [container_id for container_id in project_ids if container_id not in postgres_ids]
        transient_ids.extend(container_id for container_id in helper_ids if container_id not in transient_ids)
        for container_id in transient_ids:
            helper = container_id in helper_ids and container_id not in project_ids
            if self._inspect_transient_if_present(container_id, helper=helper) is not None:
                self._remove_transient_if_present(container_id)
        self._assert_containment_terminal(postgres_ids)
        time.sleep(1)
        self._assert_containment_terminal(postgres_ids)
        self._assert_protected_volumes_unchanged()
        return {
            "status": "QUARANTINED_RUNTIME_STOPPED",
            "postgres_containers_stopped": len(postgres_ids),
            "transient_containers_removed": len(transient_ids),
        }

    def start_postgres_only(self, request: dict[str, Any]) -> None:
        self._assert_roots_unchanged()
        self._resource_gate()
        prefix, environment = self._compose_prefix(3)
        self._assert_runtime_secrets_unchanged()
        self._run(
            [*prefix, "up", "-d", "--no-deps", "--pull", "never", "postgres"],
            environment=environment,
            code="ISOLATED_UAT_POSTGRES_START_FAILED",
            timeout=180,
        )
        self._assert_runtime_secrets_unchanged()
        self.postgres_container_id = self._find_postgres()
        deadline = time.monotonic() + 120
        while True:
            if self._verify_postgres(allow_starting=True):
                break
            if time.monotonic() >= deadline:
                self._fail("ISOLATED_UAT_POSTGRES_HEALTH_TIMEOUT")
            time.sleep(2)
        self._assert_only_postgres()
        self._assert_protected_volumes_unchanged()

    def _psql(self, sql: bytes, *, code: str, maximum: int = MAX_COMMAND_OUTPUT) -> bytes:
        if self.postgres_container_id is None:
            self._fail("ISOLATED_UAT_POSTGRES_CONTAINER_INVALID")
        return self._run(
            [
                DOCKER, "exec", "-i", self.postgres_container_id,
                "psql", "--no-psqlrc", "--username", CONTROL_ROLE, "--dbname", DATABASE,
                "--set", "ON_ERROR_STOP=1",
            ],
            input_bytes=sql,
            code=code,
            maximum=maximum,
            timeout=120,
        )

    def _observation(self, phase: str) -> dict[str, Any]:
        sql = self._helper_sql(phase)
        raw = self._psql(sql, code="ISOLATED_UAT_DATABASE_OBSERVATION_FAILED")
        parsed = self.api.parse_json(raw, MAX_COMMAND_OUTPUT)
        if not isinstance(parsed, dict) or set(parsed) != {"observation", "ledger"} or not isinstance(parsed["ledger"], list):
            self._fail("ISOLATED_UAT_DATABASE_OBSERVATION_INVALID")
        return parsed

    def observe_empty_database(self, request: dict[str, Any]) -> dict[str, Any]:
        value = self._observation("EMPTY_PRE_BOOTSTRAP")
        if value["ledger"]:
            self._fail("ISOLATED_UAT_DATABASE_NOT_EMPTY")
        # The exact semantic validation happens in bootstrap-plan before writes.
        self.bootstrap_plan = self._helper_json("bootstrap-plan", {"observation": value["observation"]})
        return {"status": "EMPTY_POSTGRES_TARGET_VERIFIED", "observation": value["observation"]}

    def _transaction_input(self, command: str, value: Any, *, credentials: bool) -> None:
        if self.postgres_container_id is None:
            self._fail("ISOLATED_UAT_POSTGRES_CONTAINER_INVALID")
        self._assert_roots_unchanged()
        self._assert_runtime_secrets_unchanged()
        try:
            memfd = os.memfd_create("cyd-isolated-uat-transaction-input", os.MFD_CLOEXEC)
            raw = self.api.canonical_json(value)
            offset = 0
            while offset < len(raw):
                written = os.write(memfd, raw[offset:])
                if written <= 0:
                    self._fail("ISOLATED_UAT_DATABASE_TRANSACTION_INPUT_FAILED")
                offset += written
            os.lseek(memfd, 0, os.SEEK_SET)
            producer = subprocess.Popen(
                self._helper_base(command, credentials=credentials),
                stdin=memfd,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                env=self._safe_environment(),
                close_fds=True,
            )
            os.close(memfd)
            memfd = -1
            if producer.stdout is None:
                self._fail("ISOLATED_UAT_DATABASE_TRANSACTION_PIPE_FAILED")
            consumer = subprocess.Popen(
                [
                    DOCKER, "exec", "-i", self.postgres_container_id,
                    "psql", "--no-psqlrc", "--username", CONTROL_ROLE, "--dbname", DATABASE,
                    "--set", "ON_ERROR_STOP=1",
                ],
                stdin=producer.stdout,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env=self._safe_environment(),
                close_fds=True,
            )
            producer.stdout.close()
            try:
                consumer_status = consumer.wait(timeout=180)
                producer_status = producer.wait(timeout=10)
            except subprocess.TimeoutExpired:
                consumer.kill()
                producer.kill()
                consumer.wait()
                producer.wait()
                self._fail("ISOLATED_UAT_DATABASE_TRANSACTION_TIMEOUT")
            if producer_status != 0 or consumer_status != 0:
                self._fail("ISOLATED_UAT_DATABASE_TRANSACTION_FAILED")
        except OSError:
            self._fail("ISOLATED_UAT_DATABASE_TRANSACTION_PIPE_FAILED")
        finally:
            for process_name in ("consumer", "producer"):
                process = locals().get(process_name)
                if isinstance(process, subprocess.Popen) and process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
            if "memfd" in locals() and memfd >= 0:
                os.close(memfd)
        self._assert_runtime_secrets_unchanged()

    def bootstrap_database(self, request: dict[str, Any], observation: dict[str, Any]) -> dict[str, Any]:
        if self.bootstrap_plan is None or observation.get("observation") is None:
            self._fail("ISOLATED_UAT_DATABASE_BOOTSTRAP_PLAN_MISSING")
        credential_generation_id = f"{request['request_id']}-cred"
        self._transaction_input(
            "bootstrap-transaction",
            {
                "plan": self.bootstrap_plan,
                "runtime_secret_root": self.roots["runtime_secret_root"],
                "backup_credential_root": self.roots["backup_credential_root"],
                "credential_generation_id": credential_generation_id,
            },
            credentials=True,
        )
        result = self._observation("BOOTSTRAP_FENCED")
        if result["ledger"]:
            self._fail("ISOLATED_UAT_DATABASE_BOOTSTRAP_LEDGER_NOT_EMPTY")
        self.bootstrap_receipt = self._helper_json(
            "bootstrap-verify",
            {"plan": self.bootstrap_plan, "observation": result["observation"]},
        )
        return self.bootstrap_receipt

    @staticmethod
    def _identity(observation: dict[str, Any]) -> dict[str, str]:
        return {
            "database_name": observation["database_name"],
            "database_system_identifier": observation["system_identifier"],
            "database_oid": observation["database_oid"],
            "database_marker": observation["marker"],
            "migration_role": MIGRATION_ROLE,
        }

    def observe_bootstrapped_database(self, request: dict[str, Any]) -> dict[str, str]:
        if self.bootstrap_plan is None:
            self._fail("ISOLATED_UAT_DATABASE_BOOTSTRAP_PLAN_MISSING")
        result = self._observation("BOOTSTRAP_FENCED")
        if result["ledger"]:
            self._fail("ISOLATED_UAT_DATABASE_BOOTSTRAP_LEDGER_NOT_EMPTY")
        self._helper_json(
            "bootstrap-verify",
            {"plan": self.bootstrap_plan, "observation": result["observation"]},
        )
        return self._identity(result["observation"])

    def stage_migration_grant(self, request: dict[str, Any], grant: dict[str, Any]) -> None:
        self._assert_roots_unchanged()
        root = Path(self.roots["migration_grant_root"])
        self._validate_root_directory(str(root), empty=True)
        raw = self.api.canonical_json(grant)
        descriptor = -1
        directory = -1
        try:
            directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
            descriptor = os.open(
                "migration-execution-grant.json",
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                0o440,
                dir_fd=directory,
            )
            os.fchmod(descriptor, 0o440)
            os.fchown(descriptor, 0, 0)
            offset = 0
            while offset < len(raw):
                written = os.write(descriptor, raw[offset:])
                if written <= 0:
                    self._fail("ISOLATED_UAT_MIGRATION_GRANT_WRITE_FAILED")
                offset += written
            os.fsync(descriptor)
            os.close(descriptor)
            descriptor = -1
            os.fsync(directory)
        except OSError:
            self._fail("ISOLATED_UAT_MIGRATION_GRANT_WRITE_FAILED")
        finally:
            if descriptor >= 0:
                os.close(descriptor)
            if directory >= 0:
                os.close(directory)
        pointed = self._stable_bytes(root / "migration-execution-grant.json", 1024 * 1024)
        if pointed != raw:
            self._fail("ISOLATED_UAT_MIGRATION_GRANT_WRITE_FAILED")
        self._assert_roots_unchanged()
        self.migration_grant = grant

    def _dynamic_environment(self) -> dict[str, str]:
        if self.migration_grant is None:
            return {}
        database = self.migration_grant["database"]
        return {
            "ERP_UAT_COMPOSE_PROJECT": self.project,
            "ERP_UAT_RUNTIME_SECRET_ROOT": self.roots["runtime_secret_root"],
            "ERP_UAT_RELEASE_CANDIDATE_ROOT": self.roots["release_candidate_root"],
            "ERP_UAT_MIGRATION_GRANT_ROOT": self.roots["migration_grant_root"],
            "ERP_RELEASE_EXPECTED_VERSION": self.source["package_version"],
            "ERP_RELEASE_EXPECTED_GIT_COMMIT": self.source["git_commit"],
            "ERP_RELEASE_MANIFEST_SHA256": self.source["release_manifest_sha256"],
            "ERP_RELEASE_EXPECTED_MANIFEST_SHA256": self.source["release_manifest_sha256"],
            "ERP_MIGRATION_EXPECTED_SYSTEM_IDENTIFIER": database["database_system_identifier"],
            "ERP_MIGRATION_EXPECTED_DATABASE_OID": database["database_oid"],
            "ERP_UAT_PROMOTION_MIGRATION_GRANT_SHA256": self.migration_grant["grant_sha256"],
            "ERP_UAT_PROMOTION_MIGRATION_EXECUTION_AUTHORIZATION_SHA256": self.migration_grant["execution_authorization_sha256"],
            "ERP_ISOLATED_UAT_ROOT_OPERATIONS_PACKAGE_SHA256": self.source["root_operations_package_sha256"],
            "ERP_WEB_IMAGE": self.source["web_image"],
            "ERP_WORKER_IMAGE": self.source["worker_image"],
            "ERP_WEB_IMAGE_CONFIG_DIGEST": self.source["web_image_config_digest"],
            "ERP_WORKER_IMAGE_CONFIG_DIGEST": self.source["worker_image_config_digest"],
        }

    def _validate_four_layer_policy(self, compose: dict[str, Any]) -> None:
        env = self.render_environment
        grant = self.migration_grant
        if grant is None:
            self._fail("ISOLATED_UAT_MIGRATION_GRANT_MISSING")
        command = [
            PYTHON, "-I", "-S", "-B",
            str(self.package_root / "scripts/isolated-uat-root-operations-compose-policy.py"),
            "--project", self.project,
            "--project-root", str(self.package_root),
            "--runtime-secret-root", self.roots["runtime_secret_root"],
            "--release-candidate-root", self.roots["release_candidate_root"],
            "--release-identity-root", env["ERP_UAT_RELEASE_IDENTITY_ROOT"],
            "--migration-grant-root", self.roots["migration_grant_root"],
            "--web-port", env["ERP_UAT_HTTP_PORT"],
            "--caddy-http-port", env["ERP_UAT_CADDY_HTTP_PORT"],
            "--caddy-https-port", env["ERP_UAT_CADDY_HTTPS_PORT"],
            "--release-manifest-sha256", self.source["release_manifest_sha256"],
            "--migration-grant-sha256", grant["grant_sha256"],
            "--execution-authorization-sha256", grant["execution_authorization_sha256"],
            "--root-operations-package-sha256", self.source["root_operations_package_sha256"],
            "--database-system-identifier", grant["database"]["database_system_identifier"],
            "--database-oid", grant["database"]["database_oid"],
        ]
        self._run(
            command,
            input_bytes=self.api.canonical_json(compose),
            code="ISOLATED_UAT_FOUR_LAYER_POLICY_FAILED",
        )

    def run_migration(
        self,
        request: dict[str, Any],
        identity: dict[str, str],
        grant: dict[str, Any],
    ) -> dict[str, Any]:
        if self.migration_grant != grant or grant["database"]["database_system_identifier"] != identity["database_system_identifier"]:
            self._fail("ISOLATED_UAT_MIGRATION_GRANT_BINDING_INVALID")
        self._assert_roots_unchanged()
        self._resource_gate()
        compose = self._render_compose(4, dynamic=True)
        self._validate_four_layer_policy(compose)
        self.operations_compose_sha256 = self.api.digest(compose)
        prefix, environment = self._compose_prefix(4, dynamic=True)
        raw = self._run(
            [
                *prefix, "--profile", "uat-migration", "run",
                "--name", f"cyd-{self.project}-migrate",
                "--rm", "--no-deps", "--pull", "never", "migrate",
            ],
            environment=environment,
            code="ISOLATED_UAT_MIGRATION_EXECUTION_FAILED",
            timeout=900,
        )
        result = self.api.parse_json(raw, MAX_COMMAND_OUTPUT)
        if not isinstance(result, dict):
            self._fail("ISOLATED_UAT_MIGRATION_ENGINE_RESULT_INVALID")
        self.engine_result = result
        self._verify_postgres()
        self._assert_only_postgres()
        self._assert_protected_volumes_unchanged()
        self._assert_roots_unchanged()
        return result

    def verify_migration(
        self,
        request: dict[str, Any],
        identity: dict[str, str],
        bootstrap: dict[str, Any],
        grant: dict[str, Any],
        result: dict[str, Any],
    ) -> dict[str, Any]:
        if self.bootstrap_receipt is None or bootstrap != self.bootstrap_receipt or self.engine_result != result or self.migration_grant != grant:
            self._fail("ISOLATED_UAT_MIGRATION_VERIFICATION_INPUT_INVALID")
        live = self._observation("POST_MIGRATION_FENCED")
        receipt = self._helper_json(
            "migration-verify",
            {
                "bootstrap_receipt": self.bootstrap_receipt,
                "grant": grant,
                "engine_result": result,
                "observation": live["observation"],
                "ledger": live["ledger"],
            },
        )
        if receipt.get("status") != "MIGRATION_VERIFIED":
            self._fail("ISOLATED_UAT_MIGRATION_VERIFICATION_FAILED")
        self.migration_receipt = receipt
        return {
            "status": "MIGRATION_COMMITTED_EXACT_LEDGER_VERIFIED",
            "receipt": receipt,
            "resolved_operations_compose_sha256": self.operations_compose_sha256,
        }

    def unfence_database(self, request: dict[str, Any], migration: dict[str, Any]) -> dict[str, Any]:
        if self.migration_receipt is None or migration.get("receipt") != self.migration_receipt:
            self._fail("ISOLATED_UAT_UNFENCE_INPUT_INVALID")
        plan = self._helper_json("unfence-plan", {"migration_receipt": self.migration_receipt})
        self._transaction_input(
            "unfence-transaction",
            {"plan": plan, "migration_receipt": self.migration_receipt},
            credentials=False,
        )
        live = self._observation("POST_MIGRATION_UNFENCED")
        receipt = self._helper_json(
            "unfence-verify",
            {"plan": plan, "migration_receipt": self.migration_receipt, "observation": live["observation"]},
        )
        self.unfence_receipt = receipt
        return receipt

    def _capture_state(self) -> dict[str, Any]:
        if self.migration_grant is None:
            self._fail("ISOLATED_UAT_MIGRATION_GRANT_MISSING")
        database = self.migration_grant["database"]
        sql = self._stable_bytes(self.package_root / "scripts/postgresql-runtime-privilege-state.sql", 4 * 1024 * 1024)
        command = [
            DOCKER, "exec", "-i", self.postgres_container_id,
            "psql", "--no-psqlrc", "--username", CONTROL_ROLE, "--dbname", DATABASE,
            "--no-align", "--tuples-only", "--field-separator=\t", "--set=ON_ERROR_STOP=1",
            f"--set=expected_database={DATABASE}",
            f"--set=migration_owner={MIGRATION_ROLE}",
            f"--set=expected_marker={database['database_marker']}",
            f"--set=expected_system_identifier={database['database_system_identifier']}",
            "--set=controlled_runtime_mode=1",
        ]
        raw = self._run(
            command,
            input_bytes=sql,
            code="ISOLATED_UAT_RUNTIME_PRIVILEGE_STATE_CAPTURE_FAILED",
            timeout=120,
        )
        value = self.api.parse_json(raw, MAX_COMMAND_OUTPUT)
        if not isinstance(value, dict):
            self._fail("ISOLATED_UAT_RUNTIME_PRIVILEGE_STATE_CAPTURE_FAILED")
        return value

    def _capture_structure(self) -> str:
        if self.migration_grant is None:
            self._fail("ISOLATED_UAT_MIGRATION_GRANT_MISSING")
        database = self.migration_grant["database"]
        sql = self._stable_bytes(self.package_root / "scripts/postgresql-runtime-privilege-catalog.sql", 4 * 1024 * 1024)
        command = [
            DOCKER, "exec", "-i", self.postgres_container_id,
            "psql", "--no-psqlrc", "--username", CONTROL_ROLE, "--dbname", DATABASE,
            "--no-align", "--tuples-only", "--field-separator=\t", "--set=ON_ERROR_STOP=1",
            f"--set=expected_database={DATABASE}",
            f"--set=migration_owner={MIGRATION_ROLE}",
            f"--set=expected_marker={database['database_marker']}",
            f"--set=expected_system_identifier={database['database_system_identifier']}",
            "--set=controlled_runtime_mode=1",
        ]
        raw = self._run(
            command,
            input_bytes=sql,
            code="ISOLATED_UAT_RUNTIME_PRIVILEGE_STRUCTURE_CAPTURE_FAILED",
            timeout=180,
        )
        try:
            return raw.decode("utf-8", "strict")
        except UnicodeDecodeError:
            self._fail("ISOLATED_UAT_RUNTIME_PRIVILEGE_STRUCTURE_CAPTURE_FAILED")

    def reconcile_final_privileges(
        self,
        request: dict[str, Any],
        migration: dict[str, Any],
        unfence: dict[str, Any],
    ) -> dict[str, Any]:
        if self.unfence_receipt is None or unfence != self.unfence_receipt:
            self._fail("ISOLATED_UAT_FINAL_RECONCILIATION_INPUT_INVALID")
        self.baseline_state = self._capture_state()
        self.baseline_structure = self._capture_structure()
        self.reconciliation = self._helper_json(
            "final-plan",
            {
                "unfence_receipt": self.unfence_receipt,
                "baseline_state": self.baseline_state,
                "structural_report": self.baseline_structure,
            },
        )
        self._transaction_input(
            "final-transaction",
            {
                "reconciliation": self.reconciliation,
                "unfence_receipt": self.unfence_receipt,
                "baseline_state": self.baseline_state,
                "structural_report": self.baseline_structure,
                "runtime_secret_root": self.roots["runtime_secret_root"],
                "backup_credential_root": self.roots["backup_credential_root"],
                "credential_generation_id": f"{request['request_id']}-cred",
            },
            credentials=True,
        )
        return {
            "status": "FINAL_RECONCILIATION_APPLIED_PENDING_VERIFICATION",
            "reconciliation_sha256": self.reconciliation["reconciliation_sha256"],
        }

    def verify_final_database(
        self,
        request: dict[str, Any],
        identity: dict[str, str],
        migration: dict[str, Any],
        unfence: dict[str, Any],
        reconciliation: dict[str, Any],
    ) -> dict[str, Any]:
        if any(value is None for value in (
            self.reconciliation,
            self.unfence_receipt,
            self.baseline_state,
            self.baseline_structure,
        )):
            self._fail("ISOLATED_UAT_FINAL_VERIFICATION_INPUT_INVALID")
        if unfence != self.unfence_receipt or reconciliation.get("reconciliation_sha256") != self.reconciliation.get("reconciliation_sha256"):
            self._fail("ISOLATED_UAT_FINAL_VERIFICATION_INPUT_INVALID")
        final_state = self._capture_state()
        final_structure = self._capture_structure()
        receipt = self._helper_json(
            "final-verify",
            {
                "reconciliation": self.reconciliation,
                "unfence_receipt": self.unfence_receipt,
                "baseline_state": self.baseline_state,
                "baseline_structural_report": self.baseline_structure,
                "final_state": final_state,
                "final_structural_report": final_structure,
            },
        )
        if receipt.get("status") != "FINAL_DATABASE_PRIVILEGES_VERIFIED":
            self._fail("ISOLATED_UAT_FINAL_VERIFICATION_FAILED")
        self._verify_postgres()
        self._assert_only_postgres()
        self._assert_protected_volumes_unchanged()
        self._resource_gate()
        return {"status": "FINAL_RUNTIME_PRIVILEGES_VERIFIED", "receipt": receipt}


def create_system_port(request: dict[str, Any], api: SimpleNamespace) -> SystemOperationsPort:
    """Return the concrete adapter without performing any system action."""

    return SystemOperationsPort(request, api)
