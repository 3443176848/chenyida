#!/usr/bin/python3
"""Create immutable, fail-closed supply-chain evidence for the rollback volume helper."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable


BUILD_CONTRACT = "chenyida-erp-volume-helper-build-provenance/v1"
SBOM_CONTRACT = "chenyida-erp-volume-helper-sbom-evidence/v1"
SECURITY_CONTRACT = "chenyida-erp-volume-helper-security-evidence/v1"
HELPER_CONTRACT = "chenyida-erp-volume-restore-helper-contract/v1"
HELPER_CONTRACT_SHA256 = "143071fae30de9f0f4c04dff1df17d5d42fd8bfaa967ca0e70836d5ffd1ffb8d"
HELPER_PROTOCOL = "chenyida-erp-volume-helper/v1"
HELPER_ROLE = "volume-restore-helper"
POLICY_CONTRACT = "chenyida-erp-volume-helper-vulnerability-policy/v1"
POLICY_ID = "chenyida-erp-volume-helper-zero-known-vulnerabilities-v1"
POLICY_SHA256 = "ada47c01bd5c5e5701f24e94c7245b41c4dcf70746a425de6846c890399faed8"
TRIVY_VERSION = "0.70.0"
TRIVY_IMAGE = "ghcr.io/aquasecurity/trivy@sha256:85e87be1a96459c38a4eea47dc64eb2d342bb14cd4b4cef96adcf6ff03378b7c"
BASE_IMAGE = "cgr.dev/chainguard/wolfi-base@sha256:5f3cb6adc6057b4084b8a1844ea16069d5d6be5a48da5a4856495b9a44bce4ed"
REGISTRY_IMAGE = "registry@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373"
DOCKERFILE_FRONTEND = "docker.io/docker/dockerfile:1.7@sha256:b5f3b260a9678e1d83d2fce86eeddf79420b79147eaba2a25986f47133d73720"
APK_REPOSITORY = "https://apk.cgr.dev/chainguard"
TOOLCHAIN = {
    "gnutar": "1.35-r11",
    "gzip": "1.14-r8",
    "coreutils": "9.11-r3",
    "findutils": "4.11.0-r1",
}
ARTIFACT_MARKER = ".chenyida-erp-release-artifact-root-v1"
ARTIFACT_MARKER_VALUE = b"chenyida-erp-release-artifact-root/v1\n"
MAX_JSON_BYTES = 32 * 1024 * 1024
MAX_ARCHIVE_BYTES = 16 * 1024 * 1024 * 1024
MAX_TRIVY_DATABASE_BYTES = 4 * 1024 * 1024 * 1024
MAX_TRIVY_DATABASE_ENTRIES = 20_000
RESOURCE_SAMPLE_SECONDS = 60
RESOURCE_SAMPLE_MAX_SECONDS = 75
RESOURCE_STAGE_MAX_SECONDS = 2 * 60 * 60
RESOURCE_MIN_AVAILABLE_KIB = 768 * 1024
RESOURCE_MAX_SWAP_GROWTH_KIB = 256 * 1024
RESOURCE_MIN_ROOT_FREE_BYTES = 10 * 1024 * 1024 * 1024
RESOURCE_MAX_LOAD_ONE = 4.0
ERP_COMPOSE_SERVICES = {"caddy", "postgres", "web", "worker"}
RESOURCE_GATE_STATE_CONTRACT = "chenyida-erp-volume-helper-resource-gate-state/v1"
RESOURCE_GATE_PHASES = {
    "BUILD_BEFORE": "BUILD_AFTER",
    "TRIVY_JSON_BEFORE": "TRIVY_JSON_AFTER",
    "TRIVY_CYCLONEDX_BEFORE": "TRIVY_CYCLONEDX_AFTER",
}

SHA256 = re.compile(r"^[0-9a-f]{64}$")
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
GIT_OBJECT = re.compile(r"^[0-9a-f]{40}$")
VERSION = re.compile(r"^0\.1\.0-alpha\.\d+$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
ISO_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
IMAGE_REFERENCE = re.compile(
    r"^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?"
    r"(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[0-9a-f]{64}$"
)
ARTIFACT_FILENAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.json$")


class VolumeHelperEvidenceError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def reject(code: str) -> None:
    raise VolumeHelperEvidenceError(code)


def canonical_json(value: Any) -> bytes:
    return (json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
    ) + "\n").encode("utf-8")


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def digest_value(value: Any) -> str:
    return sha256(canonical_json(value))


def exact(value: Any, fields: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != fields:
        reject(code)
    return value


def string(value: Any, pattern: re.Pattern[str], code: str) -> str:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        reject(code)
    return value


def nonzero_sha(value: Any, code: str) -> str:
    result = string(value, SHA256, code)
    if result == "0" * 64:
        reject(code)
    return result


def image_digest(value: Any, code: str) -> str:
    return string(value, DIGEST, code)


def positive_integer(value: Any, maximum: int, code: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
        reject(code)
    return value


def instant(value: Any, code: str) -> datetime:
    string(value, ISO_UTC, code)
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except ValueError:
        reject(code)
    raise AssertionError("unreachable")


def strict_json(raw: bytes, code: str) -> Any:
    if not 2 <= len(raw) <= MAX_JSON_BYTES:
        reject(code)

    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                reject(code)
            result[key] = value
        return result

    try:
        return json.loads(
            raw.decode("utf-8"), object_pairs_hook=pairs,
            parse_constant=lambda _value: reject(code),
        )
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError):
        reject(code)
    raise AssertionError("unreachable")


def trusted_file(path: Path, maximum: int, code: str) -> bytes:
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError:
        reject(code)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_gid != 0 \
                or before.st_nlink != 1 \
                or stat.S_IMODE(before.st_mode) not in {0o400, 0o440, 0o444} \
                or not 1 <= before.st_size <= maximum:
            reject(code)
        raw = bytearray()
        while len(raw) < before.st_size:
            chunk = os.read(descriptor, min(1024 * 1024, before.st_size - len(raw)))
            if not chunk:
                reject(code)
            raw.extend(chunk)
        after = os.fstat(descriptor)
        try:
            named = os.lstat(path)
        except OSError:
            reject(f"{code}_CHANGED")
        identity = lambda item: (
            item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns, item.st_ctime_ns,
        )
        if identity(before) != identity(after) or identity(before) != identity(named) \
                or stat.S_ISLNK(named.st_mode):
            reject(f"{code}_CHANGED")
        return bytes(raw)
    finally:
        os.close(descriptor)


def trusted_json(path: Path, code: str) -> tuple[dict[str, Any], bytes]:
    raw = trusted_file(path, MAX_JSON_BYTES, code)
    value = strict_json(raw, code)
    if not isinstance(value, dict):
        reject(code)
    return value, raw


def _stable_stat_identity(value: os.stat_result) -> tuple[int, ...]:
    return (
        value.st_dev, value.st_ino, value.st_mode, value.st_uid, value.st_gid,
        value.st_nlink, value.st_size, value.st_mtime_ns, value.st_ctime_ns,
    )


def trusted_trivy_database_tree(
        root: Path, *, maximum_bytes: int = MAX_TRIVY_DATABASE_BYTES,
        maximum_entries: int = MAX_TRIVY_DATABASE_ENTRIES,
        _before_file_read: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """Hash one root-owned immutable Trivy DB tree through stable directory FDs."""
    code = "VOLUME_HELPER_TRIVY_DATABASE_INVALID"
    if not root.is_absolute() or root == Path("/") \
            or isinstance(maximum_bytes, bool) or not 1 <= maximum_bytes <= MAX_TRIVY_DATABASE_BYTES \
            or isinstance(maximum_entries, bool) or not 2 <= maximum_entries <= MAX_TRIVY_DATABASE_ENTRIES:
        reject(code)
    try:
        if root.resolve(strict=True) != root or any(part in ("", ".", "..") for part in root.parts[1:]):
            reject(code)
    except OSError:
        reject(code)
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) \
        | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    try:
        descriptor = os.open("/", flags)
    except OSError:
        reject(code)
    try:
        for component in root.parts[1:]:
            try:
                named = os.stat(component, dir_fd=descriptor, follow_symlinks=False)
            except OSError:
                reject(code)
            mode = stat.S_IMODE(named.st_mode)
            if not stat.S_ISDIR(named.st_mode) or named.st_uid != 0 or named.st_gid != 0 \
                    or mode & 0o022 or mode & 0o500 != 0o500:
                reject(code)
            try:
                child = os.open(component, flags, dir_fd=descriptor)
            except OSError:
                reject(code)
            opened = os.fstat(child)
            if _stable_stat_identity(opened) != _stable_stat_identity(named):
                os.close(child)
                reject(f"{code}_CHANGED")
            os.close(descriptor)
            descriptor = child
        root_descriptor = descriptor
        descriptor = -1
    finally:
        if descriptor >= 0:
            os.close(descriptor)
    entries: list[dict[str, Any]] = []
    payload_bytes = 0

    def validate_directory(metadata: os.stat_result) -> None:
        mode = stat.S_IMODE(metadata.st_mode)
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_gid != 0 \
                or mode & 0o022 or mode & 0o500 != 0o500:
            reject(code)

    def walk(descriptor: int, prefix: str) -> None:
        nonlocal payload_bytes
        try:
            names = sorted(os.listdir(descriptor))
        except OSError:
            reject(code)
        for name in names:
            if not isinstance(name, str) or name in ("", ".", "..") or "/" in name \
                    or "\x00" in name:
                reject(code)
            relative = f"{prefix}/{name}" if prefix else name
            try:
                named_before = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
            except OSError:
                reject(code)
            if stat.S_ISDIR(named_before.st_mode):
                validate_directory(named_before)
                try:
                    child = os.open(name, flags, dir_fd=descriptor)
                except OSError:
                    reject(code)
                try:
                    opened_before = os.fstat(child)
                    if _stable_stat_identity(opened_before) != _stable_stat_identity(named_before):
                        reject(f"{code}_CHANGED")
                    entries.append({
                        "path": f"{relative}/", "kind": "DIRECTORY",
                        "uid": opened_before.st_uid, "gid": opened_before.st_gid,
                        "mode": f"{stat.S_IMODE(opened_before.st_mode):04o}",
                    })
                    if len(entries) > maximum_entries:
                        reject(f"{code}_TOO_LARGE")
                    walk(child, relative)
                    opened_after = os.fstat(child)
                    named_after = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
                    if _stable_stat_identity(opened_before) != _stable_stat_identity(opened_after) \
                            or _stable_stat_identity(opened_before) \
                                != _stable_stat_identity(named_after):
                        reject(f"{code}_CHANGED")
                finally:
                    os.close(child)
                continue
            if not stat.S_ISREG(named_before.st_mode) or named_before.st_uid != 0 \
                    or named_before.st_gid != 0 or named_before.st_nlink != 1 \
                    or stat.S_IMODE(named_before.st_mode) & 0o022 \
                    or not 1 <= named_before.st_size <= maximum_bytes \
                    or payload_bytes + named_before.st_size > maximum_bytes:
                reject(f"{code}_TOO_LARGE" if stat.S_ISREG(named_before.st_mode)
                       and named_before.st_size > maximum_bytes else code)
            file_flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) \
                | getattr(os, "O_CLOEXEC", 0)
            try:
                child = os.open(name, file_flags, dir_fd=descriptor)
            except OSError:
                reject(code)
            try:
                opened_before = os.fstat(child)
                if _stable_stat_identity(opened_before) != _stable_stat_identity(named_before):
                    reject(f"{code}_CHANGED")
                if _before_file_read is not None:
                    _before_file_read(relative)
                digest = hashlib.sha256()
                observed = 0
                while observed < opened_before.st_size:
                    chunk = os.read(child, min(1024 * 1024, opened_before.st_size - observed))
                    if not chunk:
                        reject(f"{code}_CHANGED")
                    digest.update(chunk)
                    observed += len(chunk)
                if os.read(child, 1) != b"":
                    reject(f"{code}_CHANGED")
                opened_after = os.fstat(child)
                try:
                    named_after = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
                except OSError:
                    reject(f"{code}_CHANGED")
                if _stable_stat_identity(opened_before) != _stable_stat_identity(opened_after) \
                        or _stable_stat_identity(opened_before) \
                            != _stable_stat_identity(named_after):
                    reject(f"{code}_CHANGED")
                payload_bytes += observed
                entries.append({
                    "path": relative, "kind": "FILE", "uid": opened_before.st_uid,
                    "gid": opened_before.st_gid,
                    "mode": f"{stat.S_IMODE(opened_before.st_mode):04o}",
                    "bytes": observed, "sha256": digest.hexdigest(),
                })
                if len(entries) > maximum_entries:
                    reject(f"{code}_TOO_LARGE")
            finally:
                os.close(child)

    try:
        root_before = os.fstat(root_descriptor)
        validate_directory(root_before)
        entries.append({
            "path": "./", "kind": "DIRECTORY", "uid": root_before.st_uid,
            "gid": root_before.st_gid,
            "mode": f"{stat.S_IMODE(root_before.st_mode):04o}",
        })
        walk(root_descriptor, "")
        root_after = os.fstat(root_descriptor)
        try:
            root_named = os.lstat(root)
        except OSError:
            reject(f"{code}_CHANGED")
        if _stable_stat_identity(root_before) != _stable_stat_identity(root_after) \
                or _stable_stat_identity(root_before) != _stable_stat_identity(root_named) \
                or stat.S_ISLNK(root_named.st_mode) \
                or sum(item["kind"] == "FILE" for item in entries) < 2 \
                or not any(item["path"] == "metadata.json" for item in entries):
            reject(f"{code}_CHANGED")
    finally:
        os.close(root_descriptor)
    body = {
        "schema_version": 1,
        "contract": "chenyida-erp-trivy-database-trusted-tree/v1",
        "entry_count": len(entries),
        "payload_bytes": payload_bytes,
        "entries": entries,
    }
    return {
        "schema_version": 1,
        "contract": body["contract"],
        "entry_count": len(entries),
        "payload_bytes": payload_bytes,
        "tree_sha256": digest_value(body),
        "trust_scope": "ROOT_OWNED_STABLE_FD_TREE_NO_UPDATE_RECEIPT",
    }


def validate_volume_helper_resource_window(
        before: dict[str, Any], after: dict[str, Any], *,
        minimum_elapsed_seconds: float = RESOURCE_SAMPLE_SECONDS,
        maximum_elapsed_seconds: float = RESOURCE_SAMPLE_MAX_SECONDS,
) -> dict[str, Any]:
    """Validate two host snapshots around the mandatory 60-second stop-line window."""
    code = "VOLUME_HELPER_RESOURCE_GATE_FAILED"
    fields = {
        "captured_monotonic", "mem_available_kib", "swap_total_kib", "swap_used_kib",
        "root_free_bytes", "load_one", "oom_kill", "containers",
        "free_sha256", "df_sha256", "uptime_sha256", "docker_stats_sha256",
        "compose_project", "compose_ps_sha256",
    }
    snapshots = []
    for value in (before, after):
        value = exact(value, fields, code)
        numeric = (
            "captured_monotonic", "mem_available_kib", "swap_total_kib", "swap_used_kib",
            "root_free_bytes", "load_one", "oom_kill",
        )
        if any(isinstance(value[field], bool) or not isinstance(value[field], (int, float))
               or value[field] < 0 for field in numeric) \
                or value["mem_available_kib"] < RESOURCE_MIN_AVAILABLE_KIB \
                or value["swap_used_kib"] > value["swap_total_kib"] \
                or value["swap_total_kib"] > 0 \
                    and value["swap_used_kib"] * 100 > value["swap_total_kib"] * 80 \
                or value["root_free_bytes"] < RESOURCE_MIN_ROOT_FREE_BYTES \
                or value["load_one"] > RESOURCE_MAX_LOAD_ONE:
            reject(code)
        for field in ("free_sha256", "df_sha256", "uptime_sha256",
                      "docker_stats_sha256", "compose_ps_sha256"):
            nonzero_sha(value[field], code)
        compose_project = string(value["compose_project"], IDENTIFIER, code)
        containers = value["containers"]
        if not isinstance(containers, list) or len(containers) != len(ERP_COMPOSE_SERVICES):
            reject(code)
        identities = set()
        projects: dict[str, set[str]] = {}
        for item in containers:
            item = exact(item, {
                "id", "name", "project", "service", "state", "health",
                "oom_killed", "restart_count",
            }, code)
            for field in ("id", "name", "project", "service", "state", "health"):
                if not isinstance(item[field], str) or not item[field]:
                    reject(code)
            expected_health = "healthy" if item["service"] in {"postgres", "web"} \
                else "none"
            if item["service"] not in ERP_COMPOSE_SERVICES \
                    or item["id"] in identities or item["state"] != "running" \
                    or item["health"] != expected_health \
                    or item["oom_killed"] is not False \
                    or isinstance(item["restart_count"], bool) \
                    or not isinstance(item["restart_count"], int) \
                    or item["restart_count"] < 0:
                reject(code)
            if item["project"] != compose_project:
                reject(code)
            identities.add(item["id"])
            projects.setdefault(item["project"], set()).add(item["service"])
        if len(projects) != 1 \
                or projects.get(compose_project) != ERP_COMPOSE_SERVICES:
            reject(code)
        snapshots.append(value)
    elapsed = after["captured_monotonic"] - before["captured_monotonic"]
    if not minimum_elapsed_seconds <= elapsed <= maximum_elapsed_seconds \
            or after["swap_used_kib"] - before["swap_used_kib"] \
                > RESOURCE_MAX_SWAP_GROWTH_KIB \
            or after["oom_kill"] != before["oom_kill"]:
        reject(code)
    before_containers = {
        item["id"]: (item["project"], item["service"], item["restart_count"])
        for item in before["containers"]
    }
    after_containers = {
        item["id"]: (item["project"], item["service"], item["restart_count"])
        for item in after["containers"]
    }
    if before_containers != after_containers:
        reject(code)
    return {
        "result": "PASS", "elapsed_seconds": round(elapsed, 6),
        "swap_growth_kib": after["swap_used_kib"] - before["swap_used_kib"],
        "container_count": len(after_containers),
        "before_sha256": digest_value(before), "after_sha256": digest_value(after),
    }


def _bounded_command(arguments: list[str], *, environment: dict[str, str] | None = None) -> bytes:
    code = "VOLUME_HELPER_RESOURCE_GATE_FAILED"
    try:
        result = subprocess.run(
            arguments, env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, check=False, timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        reject(code)
    if result.returncode != 0 or result.stderr not in (b"",) \
            or not 1 <= len(result.stdout) <= 4 * 1024 * 1024:
        reject(code)
    return result.stdout


def _small_system_text(path: Path) -> str:
    try:
        raw = path.read_bytes()
    except OSError:
        reject("VOLUME_HELPER_RESOURCE_GATE_FAILED")
    if not 1 <= len(raw) <= 1024 * 1024:
        reject("VOLUME_HELPER_RESOURCE_GATE_FAILED")
    try:
        return raw.decode("ascii")
    except UnicodeDecodeError:
        reject("VOLUME_HELPER_RESOURCE_GATE_FAILED")
    raise AssertionError("unreachable")


def capture_volume_helper_resource_snapshot(
        repository_root: Path, expected_compose_project: str,
) -> dict[str, Any]:
    code = "VOLUME_HELPER_RESOURCE_GATE_FAILED"
    if not repository_root.is_absolute() or repository_root == Path("/") \
            or repository_root.resolve() != repository_root \
            or IDENTIFIER.fullmatch(expected_compose_project) is None:
        reject(code)
    compose_file = repository_root / "chenyida_erp_site/compose.yml"
    if not compose_file.is_file() or compose_file.is_symlink():
        reject(code)
    meminfo = {}
    for line in _small_system_text(Path("/proc/meminfo")).splitlines():
        match = re.fullmatch(r"([A-Za-z_()]+):\s+(\d+)\s+kB", line)
        if match:
            meminfo[match.group(1)] = int(match.group(2))
    if not {"MemAvailable", "SwapTotal", "SwapFree"}.issubset(meminfo) \
            or meminfo["SwapFree"] > meminfo["SwapTotal"]:
        reject(code)
    load_fields = _small_system_text(Path("/proc/loadavg")).split()
    if len(load_fields) < 1:
        reject(code)
    try:
        load_one = float(load_fields[0])
    except ValueError:
        reject(code)
    oom_kill = None
    for line in _small_system_text(Path("/proc/vmstat")).splitlines():
        match = re.fullmatch(r"oom_kill\s+(\d+)", line)
        if match:
            oom_kill = int(match.group(1))
            break
    if oom_kill is None:
        reject(code)
    environment = {
        "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent",
        "COMPOSE_PARALLEL_LIMIT": "1", "ERP_DEPLOYMENT_CLASS": "uat",
        "ERP_RELEASE_IDENTITY_READER_GID": "1",
    }
    free_output = _bounded_command(["/usr/bin/free", "-h"], environment=environment)
    df_output = _bounded_command(["/usr/bin/df", "-h", "/"], environment=environment)
    uptime_output = _bounded_command(["/usr/bin/uptime"], environment=environment)
    docker_stats = _bounded_command(
        ["/usr/bin/docker", "stats", "--no-stream"], environment=environment,
    )
    projects_raw = _bounded_command([
        "/usr/bin/docker", "ps", "--all", "--filter",
        f"label=com.docker.compose.project={expected_compose_project}",
        "--format", '{{.Label "com.docker.compose.project"}}',
    ], environment=environment)
    try:
        projects = set(projects_raw.decode("ascii").splitlines())
    except UnicodeDecodeError:
        reject(code)
    if projects != {expected_compose_project}:
        reject(code)
    compose_outputs = []
    containers = []
    project_environment = {
        **environment, "ERP_RELEASE_EXPECTED_DEPLOYMENT_ID": expected_compose_project,
    }
    compose_outputs.append(_bounded_command([
        "/usr/bin/docker", "compose", "--project-name", expected_compose_project,
        "--file", str(compose_file), "ps", "--all", "--format", "json",
    ], environment=project_environment))
    identifiers_raw = _bounded_command([
        "/usr/bin/docker", "ps", "--all", "--filter",
        f"label=com.docker.compose.project={expected_compose_project}",
        "--format", "{{.ID}}",
    ], environment=environment)
    try:
        identifiers = sorted(set(identifiers_raw.decode("ascii").splitlines()))
    except UnicodeDecodeError:
        reject(code)
    if len(identifiers) != len(ERP_COMPOSE_SERVICES) \
            or any(re.fullmatch(r"[0-9a-f]{12,64}", item) is None for item in identifiers):
        reject(code)
    for identifier in identifiers:
        identity_raw = _bounded_command([
            "/usr/bin/docker", "inspect", "--format",
            '{{.Id}}|{{.Name}}|{{index .Config.Labels "com.docker.compose.project"}}|'
            '{{index .Config.Labels "com.docker.compose.service"}}|{{.RestartCount}}',
            "--", identifier,
        ], environment=environment)
        state_raw = _bounded_command([
            "/usr/bin/docker", "inspect", "--format", "{{json .State}}", "--", identifier,
        ], environment=environment)
        try:
            fields = identity_raw.decode("ascii").strip().split("|")
            state = strict_json(state_raw, code)
        except UnicodeDecodeError:
            reject(code)
        if len(fields) != 5 or not isinstance(state, dict):
            reject(code)
        image_id, name, observed_project, service, restarts = fields
        try:
            restart_count = int(restarts)
        except ValueError:
            reject(code)
        health_value = state.get("Health")
        health = health_value.get("Status") if isinstance(health_value, dict) else "none"
        containers.append({
            "id": image_id, "name": name.removeprefix("/"),
            "project": observed_project, "service": service, "state": state.get("Status"),
            "health": health, "oom_killed": state.get("OOMKilled"),
            "restart_count": restart_count,
        })
    file_system = os.statvfs("/")
    return {
        "captured_monotonic": time.monotonic(),
        "mem_available_kib": meminfo["MemAvailable"],
        "swap_total_kib": meminfo["SwapTotal"],
        "swap_used_kib": meminfo["SwapTotal"] - meminfo["SwapFree"],
        "root_free_bytes": file_system.f_bavail * file_system.f_frsize,
        "load_one": load_one, "oom_kill": oom_kill,
        "containers": sorted(containers, key=lambda item: item["id"]),
        "free_sha256": sha256(free_output), "df_sha256": sha256(df_output),
        "uptime_sha256": sha256(uptime_output),
        "docker_stats_sha256": sha256(docker_stats),
        "compose_project": expected_compose_project,
        "compose_ps_sha256": sha256(b"".join(compose_outputs)),
    }


def _resource_gate_state_path(value: Path) -> Path:
    code = "VOLUME_HELPER_RESOURCE_GATE_FAILED"
    if not value.is_absolute() or value.name != "resource-gate-state.json" \
            or value == Path("/"):
        reject(code)
    try:
        parent = value.parent.resolve(strict=True)
        metadata = os.lstat(parent)
    except OSError:
        reject(code)
    if parent != value.parent or stat.S_ISLNK(metadata.st_mode) \
            or not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 \
            or metadata.st_gid != 0 or stat.S_IMODE(metadata.st_mode) != 0o700:
        reject(code)
    return value


def _write_resource_gate_state(path: Path, state: dict[str, Any]) -> bytes:
    code = "VOLUME_HELPER_RESOURCE_GATE_FAILED"
    raw = canonical_json(state)
    descriptor = -1
    try:
        descriptor = os.open(
            path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0),
            0o400,
        )
        offset = 0
        while offset < len(raw):
            written = os.write(descriptor, raw[offset:])
            if written <= 0:
                reject(code)
            offset += written
        os.fchown(descriptor, 0, 0)
        os.fchmod(descriptor, 0o400)
        os.fsync(descriptor)
    except OSError:
        reject(code)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
    parent_descriptor = os.open(
        path.parent, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0),
    )
    try:
        os.fsync(parent_descriptor)
    finally:
        os.close(parent_descriptor)
    if trusted_file(path, len(raw), code) != raw:
        reject(code)
    return raw


def _load_resource_gate_state(path: Path) -> tuple[dict[str, Any], bytes]:
    code = "VOLUME_HELPER_RESOURCE_GATE_FAILED"
    state, raw = trusted_json(path, code)
    state = exact(state, {
        "schema_version", "contract", "before_phase", "after_phase",
        "compose_project", "supervisor_bundle_sha256", "authorization_sha256",
        "baseline", "state_sha256",
    }, code)
    if state["schema_version"] != 1 or state["contract"] != RESOURCE_GATE_STATE_CONTRACT \
            or digest_value({key: item for key, item in state.items()
                             if key != "state_sha256"}) != state["state_sha256"] \
            or raw != canonical_json(state):
        reject(code)
    return state, raw


def _remove_resource_gate_state(path: Path) -> None:
    try:
        os.unlink(path)
        descriptor = os.open(
            path.parent, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    except OSError:
        reject("VOLUME_HELPER_RESOURCE_GATE_FAILED")


def run_volume_helper_resource_gate(
        repository_root: Path, phase: str, compose_project: str, state_file: Path,
        supervisor_bundle_sha256: str, authorization_sha256: str,
) -> dict[str, Any]:
    code = "VOLUME_HELPER_RESOURCE_GATE_FAILED"
    state_path = _resource_gate_state_path(state_file)
    string(compose_project, IDENTIFIER, code)
    nonzero_sha(supervisor_bundle_sha256, code)
    nonzero_sha(authorization_sha256, code)
    before_phases = set(RESOURCE_GATE_PHASES)
    after_phases = set(RESOURCE_GATE_PHASES.values())
    if phase not in before_phases | after_phases:
        reject(code)
    if phase in before_phases:
        if os.path.lexists(state_path):
            reject(code)
        window_before = capture_volume_helper_resource_snapshot(
            repository_root, compose_project,
        )
        time.sleep(RESOURCE_SAMPLE_SECONDS)
        baseline = capture_volume_helper_resource_snapshot(
            repository_root, compose_project,
        )
        window = validate_volume_helper_resource_window(window_before, baseline)
        body = {
            "schema_version": 1, "contract": RESOURCE_GATE_STATE_CONTRACT,
            "before_phase": phase, "after_phase": RESOURCE_GATE_PHASES[phase],
            "compose_project": compose_project,
            "supervisor_bundle_sha256": supervisor_bundle_sha256,
            "authorization_sha256": authorization_sha256,
            "baseline": baseline,
        }
        state = {**body, "state_sha256": digest_value(body)}
        raw = _write_resource_gate_state(state_path, state)
        return {
            "phase": phase, **window, "state_sha256": sha256(raw),
            "stage_baseline_sha256": digest_value(baseline),
        }
    state, raw = _load_resource_gate_state(state_path)
    expected_before = next(
        before for before, after in RESOURCE_GATE_PHASES.items() if after == phase
    )
    if state["before_phase"] != expected_before or state["after_phase"] != phase \
            or state["compose_project"] != compose_project \
            or state["supervisor_bundle_sha256"] != supervisor_bundle_sha256 \
            or state["authorization_sha256"] != authorization_sha256:
        reject(code)
    after_first = capture_volume_helper_resource_snapshot(repository_root, compose_project)
    transition = validate_volume_helper_resource_window(
        state["baseline"], after_first, minimum_elapsed_seconds=0,
        maximum_elapsed_seconds=RESOURCE_STAGE_MAX_SECONDS,
    )
    time.sleep(RESOURCE_SAMPLE_SECONDS)
    after_second = capture_volume_helper_resource_snapshot(repository_root, compose_project)
    window = validate_volume_helper_resource_window(after_first, after_second)
    _remove_resource_gate_state(state_path)
    return {
        "phase": phase, **window, "state_sha256": sha256(raw),
        "stage_elapsed_seconds": transition["elapsed_seconds"],
        "stage_swap_growth_kib": transition["swap_growth_kib"],
        "stage_baseline_sha256": transition["before_sha256"],
        "stage_after_sha256": transition["after_sha256"],
    }


def validate_artifact_root(root: Path) -> Path:
    if not root.is_absolute() or root == Path("/"):
        reject("VOLUME_HELPER_EVIDENCE_ARTIFACT_ROOT_INVALID")
    try:
        resolved = root.resolve(strict=True)
        metadata = os.lstat(root)
    except OSError:
        reject("VOLUME_HELPER_EVIDENCE_ARTIFACT_ROOT_INVALID")
    if resolved != root or not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) \
            or metadata.st_uid != 0 or metadata.st_gid != 0 \
            or stat.S_IMODE(metadata.st_mode) != 0o750:
        reject("VOLUME_HELPER_EVIDENCE_ARTIFACT_ROOT_INVALID")
    marker = trusted_file(
        root / ARTIFACT_MARKER, len(ARTIFACT_MARKER_VALUE),
        "VOLUME_HELPER_EVIDENCE_ARTIFACT_MARKER_INVALID",
    )
    if marker != ARTIFACT_MARKER_VALUE:
        reject("VOLUME_HELPER_EVIDENCE_ARTIFACT_MARKER_INVALID")
    return root


def artifact_filename(value: Any, code: str) -> str:
    if not isinstance(value, str) or ARTIFACT_FILENAME.fullmatch(value) is None \
            or Path(value).name != value:
        reject(code)
    return value


def validate_helper_contract(value: Any) -> dict[str, Any]:
    value = exact(value, {
        "schema_version", "contract", "image_role", "protocol", "platform", "base_image",
        "toolchain", "entrypoint", "operations", "metadata_policy", "limits",
        "contract_sha256",
    }, "VOLUME_HELPER_EVIDENCE_HELPER_CONTRACT_INVALID")
    if value["schema_version"] != 1 or value["contract"] != HELPER_CONTRACT \
            or value["image_role"] != HELPER_ROLE or value["protocol"] != HELPER_PROTOCOL \
            or value["platform"] != "linux/amd64" or value["base_image"] != BASE_IMAGE \
            or value["toolchain"] != TOOLCHAIN \
            or value["entrypoint"] != "/usr/local/bin/chenyida-erp-volume-helper" \
            or value["contract_sha256"] != HELPER_CONTRACT_SHA256 \
            or digest_value({key: item for key, item in value.items()
                             if key != "contract_sha256"}) != HELPER_CONTRACT_SHA256:
        reject("VOLUME_HELPER_EVIDENCE_HELPER_CONTRACT_INVALID")
    return value


def validate_policy(value: Any) -> dict[str, Any]:
    value = exact(value, {
        "schema_version", "contract", "policy_id", "target_role", "scanner",
        "required_ecosystems", "fail_on", "maximum_database_age_hours",
        "maximum_evidence_age_hours", "policy_sha256",
    }, "VOLUME_HELPER_EVIDENCE_POLICY_INVALID")
    scanner = exact(value["scanner"], {"name", "version", "image_reference"},
                    "VOLUME_HELPER_EVIDENCE_POLICY_INVALID")
    if value["schema_version"] != 1 or value["contract"] != POLICY_CONTRACT \
            or value["policy_id"] != POLICY_ID or value["target_role"] != HELPER_ROLE \
            or scanner != {"name": "trivy", "version": TRIVY_VERSION,
                           "image_reference": TRIVY_IMAGE} \
            or value["required_ecosystems"] != ["wolfi"] \
            or value["fail_on"] != ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"] \
            or value["maximum_database_age_hours"] != 72 \
            or value["maximum_evidence_age_hours"] != 72 \
            or value["policy_sha256"] != POLICY_SHA256 \
            or digest_value({key: item for key, item in value.items()
                             if key != "policy_sha256"}) != POLICY_SHA256:
        reject("VOLUME_HELPER_EVIDENCE_POLICY_INVALID")
    return value


def validate_image_reference(value: Any, code: str) -> tuple[str, str]:
    reference = string(value, IMAGE_REFERENCE, code)
    match = re.fullmatch(
        r"127\.0\.0\.1:([1-9][0-9]{0,4})/chenyida-erp/volume-restore-helper"
        r"@(sha256:[0-9a-f]{64})", reference,
    )
    if match is None or int(match.group(1)) > 65535:
        reject(code)
    return reference, match.group(2)


def validate_image_inspect(value: Any, expected: dict[str, Any]) -> dict[str, Any]:
    code = "VOLUME_HELPER_EVIDENCE_IMAGE_INSPECT_INVALID"
    value = exact(value, {
        "image_reference", "registry_manifest_digest", "image_config_digest", "os",
        "architecture", "repo_digests", "labels", "user", "entrypoint", "cmd",
        "working_directory", "rootfs_layers",
    }, code)
    labels = exact(value["labels"], {
        "org.opencontainers.image.version", "org.opencontainers.image.revision",
        "io.chenyida.erp.git-tree", "io.chenyida.erp.image-role",
        "io.chenyida.erp.volume-helper.protocol",
        "io.chenyida.erp.volume-helper.toolchain-contract-sha256",
    }, code)
    expected_labels = {
        "org.opencontainers.image.version": expected["application_version"],
        "org.opencontainers.image.revision": expected["git_commit"],
        "io.chenyida.erp.git-tree": expected["git_tree"],
        "io.chenyida.erp.image-role": HELPER_ROLE,
        "io.chenyida.erp.volume-helper.protocol": HELPER_PROTOCOL,
        "io.chenyida.erp.volume-helper.toolchain-contract-sha256": HELPER_CONTRACT_SHA256,
    }
    if value["image_reference"] != expected["image_reference"] \
            or value["registry_manifest_digest"] != expected["registry_manifest_digest"] \
            or value["image_config_digest"] != expected["image_config_digest"] \
            or value["os"] != "linux" or value["architecture"] != "amd64" \
            or value["repo_digests"] != [expected["image_reference"]] \
            or labels != expected_labels or value["user"] != "0:0" \
            or value["entrypoint"] != ["/usr/local/bin/chenyida-erp-volume-helper"] \
            or value["cmd"] != ["unsupported"] or value["working_directory"] != "/" \
            or not isinstance(value["rootfs_layers"], list) or not value["rootfs_layers"] \
            or any(not isinstance(item, str) or DIGEST.fullmatch(item) is None
                   for item in value["rootfs_layers"]):
        reject(code)
    return value


def validate_scanner_inspect(value: Any, expected_config_digest: str) -> dict[str, Any]:
    code = "VOLUME_HELPER_EVIDENCE_SCANNER_INSPECT_INVALID"
    value = exact(value, {
        "image_reference", "registry_manifest_digest", "image_config_digest", "os",
        "architecture", "repo_digests",
    }, code)
    manifest = TRIVY_IMAGE.rsplit("@", 1)[1]
    if value != {
        "image_reference": TRIVY_IMAGE,
        "registry_manifest_digest": manifest,
        "image_config_digest": expected_config_digest,
        "os": "linux", "architecture": "amd64", "repo_digests": [TRIVY_IMAGE],
    }:
        reject(code)
    return value


def validate_trivy_version(value: Any) -> dict[str, Any]:
    code = "VOLUME_HELPER_EVIDENCE_SCANNER_VERSION_INVALID"
    if not isinstance(value, dict) or value.get("Version", value.get("version")) != TRIVY_VERSION:
        reject(code)
    return value


def metadata_field(value: dict[str, Any], upper: str, lower: str, code: str) -> Any:
    present = [name for name in (upper, lower) if name in value]
    if len(present) != 1:
        reject(code)
    return value[present[0]]


def validate_database_metadata(value: Any, generated_at: datetime) -> dict[str, Any]:
    code = "VOLUME_HELPER_EVIDENCE_DATABASE_METADATA_INVALID"
    if not isinstance(value, dict):
        reject(code)
    version = metadata_field(value, "Version", "version", code)
    updated_raw = metadata_field(value, "UpdatedAt", "updated_at", code)
    downloaded_raw = metadata_field(value, "DownloadedAt", "downloaded_at", code)
    next_raw = metadata_field(value, "NextUpdate", "next_update", code)
    if isinstance(version, bool) or not isinstance(version, int) or not 1 <= version <= 99:
        reject(code)

    def parse_any(raw: Any) -> datetime:
        if not isinstance(raw, str):
            reject(code)
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(timezone.utc)
        except ValueError:
            reject(code)
        raise AssertionError("unreachable")

    updated, downloaded, next_update = map(parse_any, (updated_raw, downloaded_raw, next_raw))
    if downloaded < updated or next_update <= updated or generated_at < downloaded \
            or generated_at - updated > timedelta(hours=72) \
            or generated_at - updated < timedelta(0):
        reject(code)
    return {
        "schema_version": version,
        "updated_at": updated.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "downloaded_at": downloaded.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "next_update": next_update.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }


def validate_native_vulnerability(value: Any, expected_config: str,
                                  expected_reference: str) -> dict[str, int]:
    code = "VOLUME_HELPER_EVIDENCE_VULNERABILITY_REPORT_INVALID"
    if not isinstance(value, dict) or value.get("SchemaVersion") != 2 \
            or value.get("ArtifactType") != "container_image" \
            or not isinstance(value.get("Results"), list) or len(value["Results"]) != 1:
        reject(code)
    metadata = value.get("Metadata")
    if not isinstance(metadata, dict) or metadata.get("ImageID") not in {None, expected_config}:
        reject(code)
    repo_digests = metadata.get("RepoDigests")
    if repo_digests is not None and repo_digests != [expected_reference]:
        reject(code)
    if metadata.get("OS") != {"Family": "wolfi", "Name": "20230201"}:
        reject(code)
    result = value["Results"][0]
    if not isinstance(result, dict) or result.get("Class") != "os-pkgs" \
            or result.get("Type") != "wolfi" or not isinstance(result.get("Packages"), list) \
            or len(result["Packages"]) < len(TOOLCHAIN) + 1:
        reject(code)
    vulnerabilities = result.get("Vulnerabilities")
    if vulnerabilities not in (None, []):
        reject("VOLUME_HELPER_EVIDENCE_VULNERABILITIES_FOUND")
    return {"critical": 0, "high": 0, "medium": 0, "low": 0, "unknown": 0}


def validate_cyclonedx(value: Any, expected_config: str,
                       expected_reference: str) -> tuple[dict[str, Any], int]:
    code = "VOLUME_HELPER_EVIDENCE_CYCLONEDX_INVALID"
    value = exact(value, {
        "$schema", "bomFormat", "specVersion", "serialNumber", "version", "metadata",
        "components", "dependencies", "vulnerabilities",
    }, code)
    if value["$schema"] != "http://cyclonedx.org/schema/bom-1.6.schema.json" \
            or value["bomFormat"] != "CycloneDX" or value["specVersion"] != "1.6" \
            or value["version"] != 1 \
            or not isinstance(value["serialNumber"], str) \
            or re.fullmatch(
                r"urn:uuid:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-"
                r"[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}",
                value["serialNumber"],
            ) is None:
        reject(code)
    metadata = exact(value["metadata"], {"timestamp", "tools", "component"}, code)
    if not isinstance(metadata["timestamp"], str):
        reject(code)
    try:
        datetime.fromisoformat(metadata["timestamp"].replace("Z", "+00:00"))
    except ValueError:
        reject(code)
    tools = exact(metadata["tools"], {"components"}, code)
    if not isinstance(tools["components"], list) or len(tools["components"]) != 1:
        reject(code)
    tool = tools["components"][0]
    if not isinstance(tool, dict) or tool.get("type") != "application" \
            or tool.get("group") != "aquasecurity" or tool.get("name") != "trivy" \
            or tool.get("version") != TRIVY_VERSION \
            or tool.get("manufacturer") != {"name": "Aqua Security Software Ltd."}:
        reject(code)
    root = metadata["component"]
    if not isinstance(root, dict) or root.get("type") != "container" \
            or not isinstance(root.get("bom-ref"), str) or not root["bom-ref"]:
        reject(code)
    properties = root.get("properties", [])
    if not isinstance(properties, list) or any(
            not isinstance(item, dict) or set(item) != {"name", "value"}
            or not isinstance(item["name"], str) or not isinstance(item["value"], str)
            for item in properties):
        reject(code)
    image_ids = [item["value"] for item in properties
                 if item["name"] == "aquasecurity:trivy:ImageID"]
    repo_digests = [item["value"] for item in properties
                    if item["name"] == "aquasecurity:trivy:RepoDigest"]
    if len(image_ids) != 1 or image_ids[0] != expected_config or len(repo_digests) > 1 \
            or repo_digests and not repo_digests[0].endswith(
                f"@{expected_reference.rsplit('@', 1)[1]}"):
        reject(code)
    components = value["components"]
    if not isinstance(components, list) or not len(TOOLCHAIN) + 1 <= len(components) <= 200_000:
        reject(code)
    references = {root["bom-ref"]}
    os_components = 0
    wolfi_packages = 0
    for component in components:
        if not isinstance(component, dict) or not isinstance(component.get("bom-ref"), str) \
                or not component["bom-ref"] or component["bom-ref"] in references \
                or not isinstance(component.get("name"), str) or not component["name"]:
            reject(code)
        references.add(component["bom-ref"])
        if component.get("type") == "operating-system":
            os_components += 1
            if component.get("name") != "wolfi" or component.get("version") != "20230201":
                reject(code)
        purl = component.get("purl")
        if purl is not None:
            if not isinstance(purl, str) or not purl.startswith("pkg:apk/wolfi/") \
                    or not isinstance(component.get("version"), str) or not component["version"]:
                reject(code)
            wolfi_packages += 1
    if os_components != 1 or wolfi_packages < len(TOOLCHAIN):
        reject(code)
    dependencies = value["dependencies"]
    if not isinstance(dependencies, list):
        reject(code)
    seen_dependencies: set[str] = set()
    for dependency in dependencies:
        if not isinstance(dependency, dict) or set(dependency) != {"ref", "dependsOn"} \
                or dependency["ref"] not in references or dependency["ref"] in seen_dependencies \
                or not isinstance(dependency["dependsOn"], list) \
                or len(dependency["dependsOn"]) != len(set(dependency["dependsOn"])) \
                or any(item not in references for item in dependency["dependsOn"]):
            reject(code)
        seen_dependencies.add(dependency["ref"])
    if value["vulnerabilities"] != []:
        reject("VOLUME_HELPER_EVIDENCE_VULNERABILITIES_FOUND")
    return value, wolfi_packages


def validate_descriptor(value: Any, code: str) -> dict[str, Any]:
    value = exact(value, {"file", "sha256"}, code)
    artifact_filename(value["file"], code)
    nonzero_sha(value["sha256"], code)
    return value


def validate_image_identity(value: Any, code: str) -> dict[str, Any]:
    value = exact(value, {
        "image_reference", "registry_manifest_digest", "image_config_digest", "platform",
        "image_role", "protocol", "contract_sha256", "application_version", "git_commit",
        "git_tree",
    }, code)
    reference, manifest = validate_image_reference(value["image_reference"], code)
    if value["registry_manifest_digest"] != manifest \
            or image_digest(value["image_config_digest"], code) == manifest \
            or value["platform"] != "linux/amd64" or value["image_role"] != HELPER_ROLE \
            or value["protocol"] != HELPER_PROTOCOL \
            or value["contract_sha256"] != HELPER_CONTRACT_SHA256:
        reject(code)
    string(value["application_version"], VERSION, code)
    string(value["git_commit"], GIT_OBJECT, code)
    string(value["git_tree"], GIT_OBJECT, code)
    if value["git_commit"] == value["git_tree"] or reference != value["image_reference"]:
        reject(code)
    return value


def validate_build_provenance(value: Any, expected: dict[str, Any] | None = None) -> dict[str, Any]:
    code = "VOLUME_HELPER_BUILD_PROVENANCE_INVALID"
    value = exact(value, {
        "schema_version", "contract", "generated_at", "run_id", "scope", "source",
        "producer", "builder", "image", "limitations", "result",
    }, code)
    if value["schema_version"] != 1 or value["contract"] != BUILD_CONTRACT \
            or value["scope"] != "LOCAL_ISOLATED_UAT_ROLLBACK_HELPER" \
            or value["result"] != "LOCAL_LOOPBACK_DIGEST_VERIFIED":
        reject(code)
    instant(value["generated_at"], code)
    string(value["run_id"], IDENTIFIER, code)
    source = exact(value["source"], {
        "git_commit", "git_tree", "application_version", "archive_sha256", "archive_bytes",
        "dockerfile_sha256", "dockerignore_sha256", "helper_script_sha256",
        "helper_contract_file_sha256", "helper_contract_sha256",
    }, code)
    string(source["git_commit"], GIT_OBJECT, code)
    string(source["git_tree"], GIT_OBJECT, code)
    string(source["application_version"], VERSION, code)
    if source["git_commit"] == source["git_tree"]:
        reject(code)
    for field in (
        "archive_sha256", "dockerfile_sha256", "dockerignore_sha256", "helper_script_sha256",
        "helper_contract_file_sha256",
    ):
        nonzero_sha(source[field], code)
    positive_integer(source["archive_bytes"], MAX_ARCHIVE_BYTES, code)
    if source["helper_contract_sha256"] != HELPER_CONTRACT_SHA256:
        reject(code)
    producer = exact(value["producer"], {
        "supervisor_bundle_sha256", "authorization_sha256", "orchestrator_sha256",
        "evidence_producer_sha256",
    }, code)
    for item in producer.values():
        nonzero_sha(item, code)
    if len(set(producer.values())) != len(producer):
        reject(code)
    builder = exact(value["builder"], {
        "docker_server_version", "buildx_version", "builder_name", "builder_driver",
        "buildkit_version", "platform", "context", "pull_policy", "build_network",
        "frontend_reference", "frontend_manifest_digest", "base_image_reference",
        "base_image_manifest_digest", "base_image_config_digest", "apk_repository",
        "toolchain", "registry_image_reference", "registry_manifest_digest",
        "registry_image_config_digest", "registry_state",
    }, code)
    for field in ("docker_server_version", "buildx_version", "buildkit_version"):
        string(builder[field], re.compile(r"^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$"), code)
    if builder["builder_name"] != "default" or builder["builder_driver"] != "docker" \
            or builder["platform"] != "linux/amd64" or builder["context"] != "GIT_ARCHIVE" \
            or builder["pull_policy"] != "LOCAL_REQUIRED_PULL_FALSE" \
            or builder["build_network"] != "PUBLIC_WOLFI_APK_FETCH_WITH_SIGNED_EXACT_PACKAGES" \
            or builder["frontend_reference"] != DOCKERFILE_FRONTEND \
            or builder["frontend_manifest_digest"] != DOCKERFILE_FRONTEND.rsplit("@", 1)[1] \
            or builder["base_image_reference"] != BASE_IMAGE \
            or builder["base_image_manifest_digest"] != BASE_IMAGE.rsplit("@", 1)[1] \
            or builder["apk_repository"] != APK_REPOSITORY or builder["toolchain"] != TOOLCHAIN \
            or builder["registry_image_reference"] != REGISTRY_IMAGE \
            or builder["registry_manifest_digest"] != REGISTRY_IMAGE.rsplit("@", 1)[1] \
            or builder["registry_state"] != "EPHEMERAL_LOOPBACK_REMOVED":
        reject(code)
    image_digest(builder["base_image_config_digest"], code)
    image_digest(builder["registry_image_config_digest"], code)
    image = exact(value["image"], {
        "identity", "docker_target", "user", "entrypoint", "cmd", "working_directory",
        "inspect", "archive_sha256", "archive_bytes", "archive_config_digest",
        "rootfs_layers_sha256",
    }, code)
    identity = validate_image_identity(image["identity"], code)
    if identity["git_commit"] != source["git_commit"] \
            or identity["git_tree"] != source["git_tree"] \
            or identity["application_version"] != source["application_version"] \
            or image["docker_target"] != "volume-restore-helper" or image["user"] != "0:0" \
            or image["entrypoint"] != ["/usr/local/bin/chenyida-erp-volume-helper"] \
            or image["cmd"] != ["unsupported"] or image["working_directory"] != "/":
        reject(code)
    validate_descriptor(image["inspect"], code)
    nonzero_sha(image["archive_sha256"], code)
    positive_integer(image["archive_bytes"], MAX_ARCHIVE_BYTES, code)
    if image_digest(image["archive_config_digest"], code) != identity["image_config_digest"]:
        reject(code)
    nonzero_sha(image["rootfs_layers_sha256"], code)
    if value["limitations"] != [
        "NO_EXTERNAL_REGISTRY_ANCHOR", "NO_REPRODUCIBLE_BUILD_ATTESTATION",
        "NO_TRIVY_DATABASE_UPDATE_RECEIPT", "LOCAL_ENGINE_ONLY",
        "PUBLIC_WOLFI_APK_FETCH_WITH_SIGNED_EXACT_PACKAGES",
    ]:
        reject(code)
    if expected:
        for field in ("run_id", "generated_at"):
            if field in expected and value[field] != expected[field]:
                reject("VOLUME_HELPER_BUILD_PROVENANCE_MISMATCH")
        for field in ("image_reference", "image_config_digest", "git_commit", "git_tree",
                      "application_version"):
            if field in expected and identity[field] != expected[field]:
                reject("VOLUME_HELPER_BUILD_PROVENANCE_MISMATCH")
    return value


def validate_sbom_evidence(value: Any, expected: dict[str, Any] | None = None) -> dict[str, Any]:
    code = "VOLUME_HELPER_SBOM_EVIDENCE_INVALID"
    value = exact(value, {
        "schema_version", "contract", "generated_at", "run_id", "scope", "image",
        "build_provenance", "format", "document", "component_count", "ecosystems",
        "result",
    }, code)
    if value["schema_version"] != 1 or value["contract"] != SBOM_CONTRACT \
            or value["scope"] != "VOLUME_RESTORE_HELPER_IMAGE" \
            or value["format"] != "TRIVY_CYCLONEDX_1_6_JSON" \
            or value["ecosystems"] != ["wolfi"] or value["result"] != "VERIFIED":
        reject(code)
    instant(value["generated_at"], code)
    string(value["run_id"], IDENTIFIER, code)
    identity = validate_image_identity(value["image"], code)
    validate_descriptor(value["build_provenance"], code)
    validate_descriptor(value["document"], code)
    positive_integer(value["component_count"], 200_000, code)
    if expected:
        for field in ("run_id", "generated_at"):
            if field in expected and value[field] != expected[field]:
                reject("VOLUME_HELPER_SBOM_EVIDENCE_MISMATCH")
        if "image_reference" in expected and identity["image_reference"] != expected["image_reference"]:
            reject("VOLUME_HELPER_SBOM_EVIDENCE_MISMATCH")
        if "build_provenance_sha256" in expected \
                and value["build_provenance"]["sha256"] != expected["build_provenance_sha256"]:
            reject("VOLUME_HELPER_SBOM_EVIDENCE_MISMATCH")
    return value


def validate_security_evidence(value: Any,
                               expected: dict[str, Any] | None = None) -> dict[str, Any]:
    code = "VOLUME_HELPER_SECURITY_EVIDENCE_INVALID"
    value = exact(value, {
        "schema_version", "contract", "generated_at", "run_id", "image",
        "build_provenance", "sbom_evidence_sha256", "scanner", "database", "policy",
        "native_report", "counts", "result",
    }, code)
    if value["schema_version"] != 1 or value["contract"] != SECURITY_CONTRACT \
            or value["result"] != "PASS":
        reject(code)
    instant(value["generated_at"], code)
    string(value["run_id"], IDENTIFIER, code)
    identity = validate_image_identity(value["image"], code)
    validate_descriptor(value["build_provenance"], code)
    nonzero_sha(value["sbom_evidence_sha256"], code)
    scanner = exact(value["scanner"], {
        "name", "version", "image_reference", "registry_manifest_digest",
        "image_config_digest", "binary_sha256", "platform", "inspect", "version_report",
    }, code)
    if scanner["name"] != "trivy" or scanner["version"] != TRIVY_VERSION \
            or scanner["image_reference"] != TRIVY_IMAGE \
            or scanner["registry_manifest_digest"] != TRIVY_IMAGE.rsplit("@", 1)[1] \
            or scanner["platform"] != "linux/amd64":
        reject(code)
    image_digest(scanner["image_config_digest"], code)
    nonzero_sha(scanner["binary_sha256"], code)
    validate_descriptor(scanner["inspect"], code)
    validate_descriptor(scanner["version_report"], code)
    database = exact(value["database"], {
        "schema_version", "updated_at", "downloaded_at", "next_update", "metadata",
        "payload_tree_sha256",
    }, code)
    positive_integer(database["schema_version"], 99, code)
    for field in ("updated_at", "downloaded_at", "next_update"):
        instant(database[field], code)
    validate_descriptor(database["metadata"], code)
    nonzero_sha(database["payload_tree_sha256"], code)
    policy = exact(value["policy"], {"id", "sha256", "fail_on"}, code)
    if policy != {
        "id": POLICY_ID, "sha256": POLICY_SHA256,
        "fail_on": ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"],
    }:
        reject(code)
    validate_descriptor(value["native_report"], code)
    expected_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "unknown": 0}
    if value["counts"] != expected_counts:
        reject(code)
    if expected:
        for field in ("run_id", "generated_at"):
            if field in expected and value[field] != expected[field]:
                reject("VOLUME_HELPER_SECURITY_EVIDENCE_MISMATCH")
        if "image_reference" in expected and identity["image_reference"] != expected["image_reference"]:
            reject("VOLUME_HELPER_SECURITY_EVIDENCE_MISMATCH")
        if "build_provenance_sha256" in expected \
                and value["build_provenance"]["sha256"] != expected["build_provenance_sha256"]:
            reject("VOLUME_HELPER_SECURITY_EVIDENCE_MISMATCH")
        if "sbom_evidence_sha256" in expected \
                and value["sbom_evidence_sha256"] != expected["sbom_evidence_sha256"]:
            reject("VOLUME_HELPER_SECURITY_EVIDENCE_MISMATCH")
    return value


def verify_evidence(options: dict[str, Any], *, now: datetime | None = None) -> dict[str, str]:
    """Revalidate the complete immutable artifact set before runtime activation."""
    root = validate_artifact_root(Path(options["artifact_root"]))
    run_id = string(options["run_id"], IDENTIFIER, "VOLUME_HELPER_EVIDENCE_RUN_ID_INVALID")
    if root.name != run_id:
        reject("VOLUME_HELPER_EVIDENCE_ARTIFACT_ROOT_INVALID")
    expected = {
        "image_reference": string(
            options["image_reference"], IMAGE_REFERENCE,
            "VOLUME_HELPER_EVIDENCE_EXPECTATION_INVALID",
        ),
        "image_config_digest": image_digest(
            options["image_config_digest"], "VOLUME_HELPER_EVIDENCE_EXPECTATION_INVALID",
        ),
        "application_version": string(
            options["application_version"], VERSION,
            "VOLUME_HELPER_EVIDENCE_EXPECTATION_INVALID",
        ),
        "git_commit": string(
            options["git_commit"], GIT_OBJECT, "VOLUME_HELPER_EVIDENCE_EXPECTATION_INVALID",
        ),
        "git_tree": string(
            options["git_tree"], GIT_OBJECT, "VOLUME_HELPER_EVIDENCE_EXPECTATION_INVALID",
        ),
        "supervisor_bundle_sha256": nonzero_sha(
            options["supervisor_bundle_sha256"],
            "VOLUME_HELPER_EVIDENCE_EXPECTATION_INVALID",
        ),
        "build_provenance_sha256": nonzero_sha(
            options["build_provenance_sha256"],
            "VOLUME_HELPER_EVIDENCE_EXPECTATION_INVALID",
        ),
        "sbom_evidence_sha256": nonzero_sha(
            options["sbom_evidence_sha256"],
            "VOLUME_HELPER_EVIDENCE_EXPECTATION_INVALID",
        ),
        "security_evidence_sha256": nonzero_sha(
            options["security_evidence_sha256"],
            "VOLUME_HELPER_EVIDENCE_EXPECTATION_INVALID",
        ),
    }
    if expected["git_commit"] == expected["git_tree"] \
            or len({expected["build_provenance_sha256"],
                    expected["sbom_evidence_sha256"],
                    expected["security_evidence_sha256"],
                    expected["supervisor_bundle_sha256"]}) != 4:
        reject("VOLUME_HELPER_EVIDENCE_EXPECTATION_INVALID")

    names = {
        "inspect": f"{run_id}.volume-helper.inspect.json",
        "scanner_inspect": f"{run_id}.volume-helper.trivy.inspect.json",
        "scanner_version": f"{run_id}.volume-helper.trivy.version.json",
        "database": f"{run_id}.volume-helper.trivy-db.metadata.json",
        "vulnerability": f"{run_id}.volume-helper.trivy.json",
        "cyclonedx": f"{run_id}.volume-helper.cdx.json",
        "build": f"{run_id}.volume-helper.build-provenance.json",
        "sbom": f"{run_id}.volume-helper.sbom-evidence.json",
        "security": f"{run_id}.volume-helper.security-evidence.json",
    }
    if {path.name for path in root.iterdir()} != {ARTIFACT_MARKER, *names.values()}:
        reject("VOLUME_HELPER_EVIDENCE_ARTIFACT_SET_INVALID")

    def read(name: str, code: str) -> tuple[dict[str, Any], bytes]:
        value, raw = trusted_json(root / names[name], code)
        if raw != canonical_json(value):
            reject(f"{code}_NOT_CANONICAL")
        return value, raw

    build, build_raw = read("build", "VOLUME_HELPER_BUILD_PROVENANCE_INVALID")
    sbom, sbom_raw = read("sbom", "VOLUME_HELPER_SBOM_EVIDENCE_INVALID")
    security, security_raw = read("security", "VOLUME_HELPER_SECURITY_EVIDENCE_INVALID")
    for raw, field in (
        (build_raw, "build_provenance_sha256"),
        (sbom_raw, "sbom_evidence_sha256"),
        (security_raw, "security_evidence_sha256"),
    ):
        if sha256(raw) != expected[field]:
            reject("VOLUME_HELPER_EVIDENCE_DIGEST_MISMATCH")

    validate_build_provenance(build, {"run_id": run_id, **expected})
    generated_at = build["generated_at"]
    validate_sbom_evidence(sbom, {
        "run_id": run_id, "generated_at": generated_at,
        "image_reference": expected["image_reference"],
        "build_provenance_sha256": expected["build_provenance_sha256"],
    })
    validate_security_evidence(security, {
        "run_id": run_id, "generated_at": generated_at,
        "image_reference": expected["image_reference"],
        "build_provenance_sha256": expected["build_provenance_sha256"],
        "sbom_evidence_sha256": expected["sbom_evidence_sha256"],
    })
    expected_identity = {
        "image_reference": expected["image_reference"],
        "registry_manifest_digest": expected["image_reference"].rsplit("@", 1)[1],
        "image_config_digest": expected["image_config_digest"],
        "platform": "linux/amd64", "image_role": HELPER_ROLE,
        "protocol": HELPER_PROTOCOL, "contract_sha256": HELPER_CONTRACT_SHA256,
        "application_version": expected["application_version"],
        "git_commit": expected["git_commit"], "git_tree": expected["git_tree"],
    }
    if build["image"]["identity"] != expected_identity \
            or sbom["image"] != expected_identity or security["image"] != expected_identity \
            or build["producer"]["supervisor_bundle_sha256"] \
                != expected["supervisor_bundle_sha256"]:
        reject("VOLUME_HELPER_EVIDENCE_IDENTITY_MISMATCH")

    site_root = Path(__file__).resolve().parents[1]
    bundled = {
        "evidence_producer_sha256": sha256(Path(__file__).read_bytes()),
        "orchestrator_sha256": sha256(
            (site_root / "scripts/build-volume-restore-helper-image.sh").read_bytes(),
        ),
    }
    if build["producer"]["evidence_producer_sha256"] \
            != bundled["evidence_producer_sha256"] \
            or build["producer"]["orchestrator_sha256"] != bundled["orchestrator_sha256"]:
        reject("VOLUME_HELPER_EVIDENCE_PRODUCER_MISMATCH")
    helper_raw = (site_root / "operations/volume-restore-helper-contract-v1.json").read_bytes()
    policy_raw = (site_root / "operations/volume-helper-vulnerability-policy-v1.json").read_bytes()
    helper_value = strict_json(helper_raw, "VOLUME_HELPER_EVIDENCE_HELPER_CONTRACT_INVALID")
    policy_value = strict_json(policy_raw, "VOLUME_HELPER_EVIDENCE_POLICY_INVALID")
    validate_helper_contract(helper_value)
    validate_policy(policy_value)
    source = build["source"]
    if source["dockerfile_sha256"] != sha256((site_root / "Dockerfile").read_bytes()) \
            or source["dockerignore_sha256"] != sha256((site_root / ".dockerignore").read_bytes()) \
            or source["helper_script_sha256"] \
                != sha256((site_root / "scripts/volume-restore-helper.sh").read_bytes()) \
            or source["helper_contract_file_sha256"] != sha256(helper_raw):
        reject("VOLUME_HELPER_EVIDENCE_SOURCE_BUNDLE_MISMATCH")

    raw_artifacts: dict[str, tuple[dict[str, Any], bytes]] = {
        name: read(name, f"VOLUME_HELPER_EVIDENCE_{name.upper()}_INVALID")
        for name in ("inspect", "scanner_inspect", "scanner_version", "database",
                     "vulnerability", "cyclonedx")
    }

    def descriptor_matches(descriptor: dict[str, Any], name: str) -> bool:
        return descriptor == {"file": names[name], "sha256": sha256(raw_artifacts[name][1])}

    if not descriptor_matches(build["image"]["inspect"], "inspect") \
            or sbom["build_provenance"] \
                != {"file": names["build"], "sha256": expected["build_provenance_sha256"]} \
            or not descriptor_matches(sbom["document"], "cyclonedx") \
            or security["build_provenance"] \
                != {"file": names["build"], "sha256": expected["build_provenance_sha256"]} \
            or not descriptor_matches(security["scanner"]["inspect"], "scanner_inspect") \
            or not descriptor_matches(security["scanner"]["version_report"], "scanner_version") \
            or not descriptor_matches(security["database"]["metadata"], "database") \
            or not descriptor_matches(security["native_report"], "vulnerability"):
        reject("VOLUME_HELPER_EVIDENCE_DESCRIPTOR_MISMATCH")

    inspect = validate_image_inspect(raw_artifacts["inspect"][0], expected_identity)
    if build["image"]["rootfs_layers_sha256"] != digest_value(inspect["rootfs_layers"]):
        reject("VOLUME_HELPER_EVIDENCE_IMAGE_INSPECT_MISMATCH")
    validate_scanner_inspect(
        raw_artifacts["scanner_inspect"][0], security["scanner"]["image_config_digest"],
    )
    validate_trivy_version(raw_artifacts["scanner_version"][0])
    generated = instant(generated_at, "VOLUME_HELPER_EVIDENCE_TIME_INVALID")
    database = validate_database_metadata(raw_artifacts["database"][0], generated)
    if any(security["database"][field] != database[field] for field in (
            "schema_version", "updated_at", "downloaded_at", "next_update")):
        reject("VOLUME_HELPER_EVIDENCE_DATABASE_MISMATCH")
    counts = validate_native_vulnerability(
        raw_artifacts["vulnerability"][0], expected["image_config_digest"],
        expected["image_reference"],
    )
    cyclonedx, component_count = validate_cyclonedx(
        raw_artifacts["cyclonedx"][0], expected["image_config_digest"],
        expected["image_reference"],
    )
    if counts != security["counts"] or component_count != sbom["component_count"] \
            or cyclonedx["metadata"]["timestamp"] != generated_at:
        reject("VOLUME_HELPER_EVIDENCE_REPORT_MISMATCH")

    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        reject("VOLUME_HELPER_EVIDENCE_TIME_INVALID")
    current = current.astimezone(timezone.utc)
    database_updated = instant(
        security["database"]["updated_at"], "VOLUME_HELPER_EVIDENCE_TIME_INVALID",
    )
    for observed in (generated, database_updated):
        age = current - observed
        if age < -timedelta(minutes=5) or age > timedelta(hours=72):
            reject("VOLUME_HELPER_EVIDENCE_EXPIRED")
    return {
        "result": "VERIFIED", "run_id": run_id,
        "image_reference": expected["image_reference"],
        "image_config_digest": expected["image_config_digest"],
        "build_provenance_sha256": expected["build_provenance_sha256"],
        "sbom_evidence_sha256": expected["sbom_evidence_sha256"],
        "security_evidence_sha256": expected["security_evidence_sha256"],
        "supervisor_bundle_sha256": expected["supervisor_bundle_sha256"],
    }


def write_immutable(root: Path, filename: str, raw: bytes) -> None:
    artifact_filename(filename, "VOLUME_HELPER_EVIDENCE_ARTIFACT_FILENAME_INVALID")
    target = root / filename
    descriptor = -1
    try:
        descriptor = os.open(
            target, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), 0o400,
        )
        offset = 0
        while offset < len(raw):
            written = os.write(descriptor, raw[offset:])
            if written <= 0:
                reject("VOLUME_HELPER_EVIDENCE_ARTIFACT_WRITE_FAILED")
            offset += written
        os.fchown(descriptor, 0, 0)
        os.fchmod(descriptor, 0o440)
        os.fsync(descriptor)
    except OSError:
        reject("VOLUME_HELPER_EVIDENCE_ARTIFACT_WRITE_FAILED")
    finally:
        if descriptor >= 0:
            os.close(descriptor)
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    stored = trusted_file(target, max(len(raw), 1),
                          "VOLUME_HELPER_EVIDENCE_ARTIFACT_WRITE_FAILED")
    if stored != raw:
        reject("VOLUME_HELPER_EVIDENCE_ARTIFACT_WRITE_FAILED")


def create_evidence(options: dict[str, Any]) -> dict[str, str]:
    root = validate_artifact_root(Path(options["artifact_root"]))
    run_id = string(options["run_id"], IDENTIFIER, "VOLUME_HELPER_EVIDENCE_RUN_ID_INVALID")
    generated_at = instant(options["generated_at"], "VOLUME_HELPER_EVIDENCE_TIME_INVALID")
    git_commit = string(options["git_commit"], GIT_OBJECT, "VOLUME_HELPER_EVIDENCE_SOURCE_INVALID")
    git_tree = string(options["git_tree"], GIT_OBJECT, "VOLUME_HELPER_EVIDENCE_SOURCE_INVALID")
    application_version = string(
        options["application_version"], VERSION, "VOLUME_HELPER_EVIDENCE_SOURCE_INVALID",
    )
    if git_commit == git_tree:
        reject("VOLUME_HELPER_EVIDENCE_SOURCE_INVALID")
    image_reference, manifest_digest = validate_image_reference(
        options["image_reference"], "VOLUME_HELPER_EVIDENCE_IMAGE_INVALID",
    )
    config_digest = image_digest(
        options["image_config_digest"], "VOLUME_HELPER_EVIDENCE_IMAGE_INVALID",
    )
    if manifest_digest == config_digest:
        reject("VOLUME_HELPER_EVIDENCE_IMAGE_INVALID")
    helper_contract, helper_contract_raw = trusted_json(
        Path(options["helper_contract"]), "VOLUME_HELPER_EVIDENCE_HELPER_CONTRACT_INVALID",
    )
    validate_helper_contract(helper_contract)
    policy, policy_raw = trusted_json(
        Path(options["policy"]), "VOLUME_HELPER_EVIDENCE_POLICY_INVALID",
    )
    validate_policy(policy)
    inspect, _inspect_input_raw = trusted_json(
        Path(options["image_inspect"]), "VOLUME_HELPER_EVIDENCE_IMAGE_INSPECT_INVALID",
    )
    identity = {
        "image_reference": image_reference,
        "registry_manifest_digest": manifest_digest,
        "image_config_digest": config_digest,
        "platform": "linux/amd64", "image_role": HELPER_ROLE, "protocol": HELPER_PROTOCOL,
        "contract_sha256": HELPER_CONTRACT_SHA256,
        "application_version": application_version, "git_commit": git_commit,
        "git_tree": git_tree,
    }
    validate_image_inspect(inspect, identity)
    if options["archive_config_digest"] != config_digest:
        reject("VOLUME_HELPER_EVIDENCE_IMAGE_ARCHIVE_INVALID")
    scanner_inspect, _ = trusted_json(
        Path(options["scanner_inspect"]), "VOLUME_HELPER_EVIDENCE_SCANNER_INSPECT_INVALID",
    )
    scanner_config = image_digest(
        options["scanner_image_config_digest"],
        "VOLUME_HELPER_EVIDENCE_SCANNER_INSPECT_INVALID",
    )
    validate_scanner_inspect(scanner_inspect, scanner_config)
    scanner_version, _ = trusted_json(
        Path(options["scanner_version"]), "VOLUME_HELPER_EVIDENCE_SCANNER_VERSION_INVALID",
    )
    validate_trivy_version(scanner_version)
    database_input, _ = trusted_json(
        Path(options["database_metadata"]),
        "VOLUME_HELPER_EVIDENCE_DATABASE_METADATA_INVALID",
    )
    database = validate_database_metadata(database_input, generated_at)
    vulnerability, _ = trusted_json(
        Path(options["vulnerability"]),
        "VOLUME_HELPER_EVIDENCE_VULNERABILITY_REPORT_INVALID",
    )
    counts = validate_native_vulnerability(vulnerability, config_digest, image_reference)
    cyclonedx, _ = trusted_json(
        Path(options["cyclonedx"]), "VOLUME_HELPER_EVIDENCE_CYCLONEDX_INVALID",
    )
    cyclonedx, component_count = validate_cyclonedx(
        cyclonedx, config_digest, image_reference,
    )
    producer_sha256 = sha256(Path(__file__).read_bytes())

    names = {
        "inspect": f"{run_id}.volume-helper.inspect.json",
        "scanner_inspect": f"{run_id}.volume-helper.trivy.inspect.json",
        "scanner_version": f"{run_id}.volume-helper.trivy.version.json",
        "database": f"{run_id}.volume-helper.trivy-db.metadata.json",
        "vulnerability": f"{run_id}.volume-helper.trivy.json",
        "cyclonedx": f"{run_id}.volume-helper.cdx.json",
        "build": f"{run_id}.volume-helper.build-provenance.json",
        "sbom": f"{run_id}.volume-helper.sbom-evidence.json",
        "security": f"{run_id}.volume-helper.security-evidence.json",
    }
    for filename in names.values():
        artifact_filename(filename, "VOLUME_HELPER_EVIDENCE_ARTIFACT_FILENAME_INVALID")
        if (root / filename).exists() or (root / filename).is_symlink():
            reject("VOLUME_HELPER_EVIDENCE_ARTIFACT_EXISTS")

    normalized = {
        "inspect": canonical_json(inspect),
        "scanner_inspect": canonical_json(scanner_inspect),
        "scanner_version": canonical_json(scanner_version),
        "database": canonical_json(database_input),
        "vulnerability": canonical_json(vulnerability),
        "cyclonedx": canonical_json(cyclonedx),
    }
    rootfs_layers_sha256 = digest_value(inspect["rootfs_layers"])
    build = validate_build_provenance({
        "schema_version": 1, "contract": BUILD_CONTRACT,
        "generated_at": options["generated_at"], "run_id": run_id,
        "scope": "LOCAL_ISOLATED_UAT_ROLLBACK_HELPER",
        "source": {
            "git_commit": git_commit, "git_tree": git_tree,
            "application_version": application_version,
            "archive_sha256": nonzero_sha(
                options["source_archive_sha256"], "VOLUME_HELPER_EVIDENCE_SOURCE_INVALID",
            ),
            "archive_bytes": positive_integer(
                options["source_archive_bytes"], MAX_ARCHIVE_BYTES,
                "VOLUME_HELPER_EVIDENCE_SOURCE_INVALID",
            ),
            "dockerfile_sha256": nonzero_sha(
                options["dockerfile_sha256"], "VOLUME_HELPER_EVIDENCE_SOURCE_INVALID",
            ),
            "dockerignore_sha256": nonzero_sha(
                options["dockerignore_sha256"], "VOLUME_HELPER_EVIDENCE_SOURCE_INVALID",
            ),
            "helper_script_sha256": nonzero_sha(
                options["helper_script_sha256"], "VOLUME_HELPER_EVIDENCE_SOURCE_INVALID",
            ),
            "helper_contract_file_sha256": sha256(helper_contract_raw),
            "helper_contract_sha256": HELPER_CONTRACT_SHA256,
        },
        "producer": {
            "supervisor_bundle_sha256": nonzero_sha(
                options["supervisor_bundle_sha256"], "VOLUME_HELPER_EVIDENCE_PRODUCER_INVALID",
            ),
            "authorization_sha256": nonzero_sha(
                options["authorization_sha256"], "VOLUME_HELPER_EVIDENCE_PRODUCER_INVALID",
            ),
            "orchestrator_sha256": nonzero_sha(
                options["orchestrator_sha256"], "VOLUME_HELPER_EVIDENCE_PRODUCER_INVALID",
            ),
            "evidence_producer_sha256": producer_sha256,
        },
        "builder": {
            "docker_server_version": options["docker_server_version"],
            "buildx_version": options["buildx_version"], "builder_name": "default",
            "builder_driver": "docker", "buildkit_version": options["buildkit_version"],
            "platform": "linux/amd64", "context": "GIT_ARCHIVE",
            "pull_policy": "LOCAL_REQUIRED_PULL_FALSE",
            "build_network": "PUBLIC_WOLFI_APK_FETCH_WITH_SIGNED_EXACT_PACKAGES",
            "frontend_reference": DOCKERFILE_FRONTEND,
            "frontend_manifest_digest": DOCKERFILE_FRONTEND.rsplit("@", 1)[1],
            "base_image_reference": BASE_IMAGE,
            "base_image_manifest_digest": BASE_IMAGE.rsplit("@", 1)[1],
            "base_image_config_digest": options["base_image_config_digest"],
            "apk_repository": APK_REPOSITORY, "toolchain": TOOLCHAIN,
            "registry_image_reference": REGISTRY_IMAGE,
            "registry_manifest_digest": REGISTRY_IMAGE.rsplit("@", 1)[1],
            "registry_image_config_digest": options["registry_image_config_digest"],
            "registry_state": "EPHEMERAL_LOOPBACK_REMOVED",
        },
        "image": {
            "identity": identity, "docker_target": "volume-restore-helper", "user": "0:0",
            "entrypoint": ["/usr/local/bin/chenyida-erp-volume-helper"],
            "cmd": ["unsupported"], "working_directory": "/",
            "inspect": {"file": names["inspect"], "sha256": sha256(normalized["inspect"])},
            "archive_sha256": nonzero_sha(
                options["archive_sha256"], "VOLUME_HELPER_EVIDENCE_IMAGE_ARCHIVE_INVALID",
            ),
            "archive_bytes": positive_integer(
                options["archive_bytes"], MAX_ARCHIVE_BYTES,
                "VOLUME_HELPER_EVIDENCE_IMAGE_ARCHIVE_INVALID",
            ),
            "archive_config_digest": config_digest,
            "rootfs_layers_sha256": rootfs_layers_sha256,
        },
        "limitations": [
            "NO_EXTERNAL_REGISTRY_ANCHOR", "NO_REPRODUCIBLE_BUILD_ATTESTATION",
            "NO_TRIVY_DATABASE_UPDATE_RECEIPT", "LOCAL_ENGINE_ONLY",
            "PUBLIC_WOLFI_APK_FETCH_WITH_SIGNED_EXACT_PACKAGES",
        ],
        "result": "LOCAL_LOOPBACK_DIGEST_VERIFIED",
    })
    build_raw = canonical_json(build)
    build_sha256 = sha256(build_raw)
    sbom = validate_sbom_evidence({
        "schema_version": 1, "contract": SBOM_CONTRACT,
        "generated_at": options["generated_at"], "run_id": run_id,
        "scope": "VOLUME_RESTORE_HELPER_IMAGE", "image": identity,
        "build_provenance": {"file": names["build"], "sha256": build_sha256},
        "format": "TRIVY_CYCLONEDX_1_6_JSON",
        "document": {"file": names["cyclonedx"], "sha256": sha256(normalized["cyclonedx"])},
        "component_count": component_count, "ecosystems": ["wolfi"], "result": "VERIFIED",
    })
    sbom_raw = canonical_json(sbom)
    sbom_sha256 = sha256(sbom_raw)
    security = validate_security_evidence({
        "schema_version": 1, "contract": SECURITY_CONTRACT,
        "generated_at": options["generated_at"], "run_id": run_id, "image": identity,
        "build_provenance": {"file": names["build"], "sha256": build_sha256},
        "sbom_evidence_sha256": sbom_sha256,
        "scanner": {
            "name": "trivy", "version": TRIVY_VERSION, "image_reference": TRIVY_IMAGE,
            "registry_manifest_digest": TRIVY_IMAGE.rsplit("@", 1)[1],
            "image_config_digest": scanner_config,
            "binary_sha256": nonzero_sha(
                options["scanner_binary_sha256"], "VOLUME_HELPER_EVIDENCE_SCANNER_INVALID",
            ),
            "platform": "linux/amd64",
            "inspect": {"file": names["scanner_inspect"],
                        "sha256": sha256(normalized["scanner_inspect"])},
            "version_report": {"file": names["scanner_version"],
                               "sha256": sha256(normalized["scanner_version"])},
        },
        "database": {
            **database,
            "metadata": {"file": names["database"], "sha256": sha256(normalized["database"])},
            "payload_tree_sha256": nonzero_sha(
                options["database_payload_tree_sha256"],
                "VOLUME_HELPER_EVIDENCE_DATABASE_INVALID",
            ),
        },
        "policy": {
            "id": POLICY_ID, "sha256": POLICY_SHA256,
            "fail_on": ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"],
        },
        "native_report": {"file": names["vulnerability"],
                          "sha256": sha256(normalized["vulnerability"])},
        "counts": counts, "result": "PASS",
    })
    security_raw = canonical_json(security)
    security_sha256 = sha256(security_raw)
    if len({
        build_sha256, sbom_sha256, security_sha256, options["supervisor_bundle_sha256"],
        sha256(policy_raw), sha256(helper_contract_raw),
    }) != 6:
        reject("VOLUME_HELPER_EVIDENCE_DIGEST_COLLISION")

    artifacts = [
        (names["inspect"], normalized["inspect"]),
        (names["scanner_inspect"], normalized["scanner_inspect"]),
        (names["scanner_version"], normalized["scanner_version"]),
        (names["database"], normalized["database"]),
        (names["vulnerability"], normalized["vulnerability"]),
        (names["cyclonedx"], normalized["cyclonedx"]),
        (names["build"], build_raw), (names["sbom"], sbom_raw),
        (names["security"], security_raw),
    ]
    for filename, raw in artifacts:
        write_immutable(root, filename, raw)
    return {
        "result": "PASS", "image_reference": image_reference,
        "image_config_digest": config_digest,
        "build_provenance_file": names["build"],
        "build_provenance_sha256": build_sha256,
        "sbom_evidence_file": names["sbom"], "sbom_evidence_sha256": sbom_sha256,
        "security_evidence_file": names["security"],
        "security_evidence_sha256": security_sha256,
    }


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(allow_abbrev=False)
    commands = result.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create", allow_abbrev=False)
    for name in (
        "artifact-root", "run-id", "generated-at", "git-commit", "git-tree",
        "application-version", "source-archive-sha256", "dockerfile-sha256",
        "dockerignore-sha256", "helper-script-sha256", "helper-contract", "policy",
        "orchestrator-sha256", "supervisor-bundle-sha256", "authorization-sha256",
        "docker-server-version", "buildx-version", "buildkit-version",
        "base-image-config-digest", "registry-image-config-digest", "image-reference",
        "image-config-digest", "image-inspect", "archive-sha256",
        "archive-config-digest", "scanner-image-config-digest", "scanner-binary-sha256",
        "scanner-inspect", "scanner-version", "database-metadata",
        "database-payload-tree-sha256", "vulnerability", "cyclonedx", "confirm",
    ):
        create.add_argument(f"--{name}", required=True)
    create.add_argument("--source-archive-bytes", required=True, type=int)
    create.add_argument("--archive-bytes", required=True, type=int)
    verify = commands.add_parser("verify", allow_abbrev=False)
    for name in (
        "artifact-root", "run-id", "image-reference", "image-config-digest",
        "application-version", "git-commit", "git-tree", "build-provenance-sha256",
        "sbom-evidence-sha256", "security-evidence-sha256",
        "supervisor-bundle-sha256", "confirm",
    ):
        verify.add_argument(f"--{name}", required=True)
    trusted_tree = commands.add_parser("trusted-tree", allow_abbrev=False)
    for name in ("root", "supervisor-bundle-sha256", "authorization-sha256", "confirm"):
        trusted_tree.add_argument(f"--{name}", required=True)
    resource_gate = commands.add_parser("resource-gate", allow_abbrev=False)
    for name in (
            "repository-root", "phase", "compose-project", "state-file",
            "supervisor-bundle-sha256", "authorization-sha256", "confirm",
    ):
        resource_gate.add_argument(f"--{name}", required=True)
    return result


def main() -> None:
    args = vars(parser().parse_args())
    command = args.pop("command")
    confirmation = args.pop("confirm")
    if os.getuid() != 0 \
            or os.environ.get("ERP_RELEASE_SUPERVISOR_LAUNCHED") != "YES" \
            or os.environ.get("ERP_RELEASE_GATE_LOCK_HELD") != "YES" \
            or os.environ.get("ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256") \
                != args["supervisor_bundle_sha256"]:
        reject("VOLUME_HELPER_EVIDENCE_CONFIRMATION_INVALID")
    normalized = {key.replace("-", "_"): value for key, value in args.items()}
    if command == "create":
        if confirmation != "CREATE_VOLUME_HELPER_IMAGE_EVIDENCE" \
                or os.environ.get("ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256") \
                    != args["authorization_sha256"]:
            reject("VOLUME_HELPER_EVIDENCE_CONFIRMATION_INVALID")
        output = create_evidence(normalized)
    elif command == "verify" and confirmation == "VERIFY_EXACT_VOLUME_HELPER_IMAGE_EVIDENCE":
        output = verify_evidence(normalized)
    elif command == "trusted-tree" \
            and confirmation == "HASH_TRUSTED_TRIVY_DATABASE_TREE" \
            and os.environ.get("ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256") \
                == args["authorization_sha256"]:
        output = trusted_trivy_database_tree(Path(args["root"]))
    elif command == "resource-gate" \
            and confirmation == "CHECK_VOLUME_HELPER_HOST_RESOURCE_STOP_LINES" \
            and os.environ.get("ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256") \
                == args["authorization_sha256"]:
        output = run_volume_helper_resource_gate(
            Path(args["repository_root"]), args["phase"], args["compose_project"],
            Path(args["state_file"]), args["supervisor_bundle_sha256"],
            args["authorization_sha256"],
        )
    else:
        reject("VOLUME_HELPER_EVIDENCE_CONFIRMATION_INVALID")
    sys.stdout.buffer.write(canonical_json(output))


if __name__ == "__main__":
    try:
        main()
    except VolumeHelperEvidenceError as error:
        sys.stderr.write(f"{error.code}\n")
        raise SystemExit(1) from None
    except Exception:
        sys.stderr.write("VOLUME_HELPER_EVIDENCE_INTERNAL_ERROR\n")
        raise SystemExit(1) from None
