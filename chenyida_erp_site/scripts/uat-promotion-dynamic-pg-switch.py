#!/usr/bin/python3 -I
"""Run DV70-PG-SWITCH-01 in one disposable, isolated PostgreSQL 17 container.

This producer is deliberately TEST-only.  It never mounts a host path or Docker
volume, never pulls/builds an image, never addresses the resident ERP database,
and publishes evidence only after exact-ID cleanup and before/after object checks.
"""

from __future__ import annotations

import sys
import base64
import copy
import datetime as dt
import errno
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import select
import signal
import stat
import subprocess
import tempfile
import threading
import time
from typing import Any, Iterable


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SITE_ROOT = REPOSITORY_ROOT / "chenyida_erp_site"
POLICY_PATH = SITE_ROOT / "operations/uat-promotion-dynamic-validation-policy-v2.json"
ARTIFACT_PATH = SITE_ROOT / "operations/uat-promotion-dynamic-evidence-v2.json"
EXECUTOR_PATH = SITE_ROOT / "scripts/uat-promotion-rollback-fixed-executor.py"
FIXTURE_PATH = SITE_ROOT / "tests/test_uat_promotion_rollback_fixed_executor.py"
DOCKER = "/usr/bin/docker"
GIT = "/usr/bin/git"
DOCKER_HOST = "unix:///var/run/docker.sock"
PROTECTED_REPORT = "docs/ERP_CURRENT_STATUS_REPORT.md"
COMPOSE_PROJECT = "chenyida-erp-parallel"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
CONTAINER_ID = re.compile(r"^[0-9a-f]{64}$")
ISO_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
FAULT_BARRIER = "DV70_FIRST_RENAME_REACHED"
DRIFT_MARKER = "chenyida-erp-task70-isolated-test/v1:EXPECTED_PRECONDITION_DRIFT"
CALLER_RESULT_DISCARD_SCENARIO = \
    "CALLER_RESULT_DISCARDED_AFTER_EXACT_COMMAND_COMPLETION_READ_ONLY_OBSERVATION"
CALLER_RESULT_DISCARD_ASSERTION = "CALLER_RESULT_DISCARD_PROBED_READ_ONLY"
PRECONDITION_ERROR_OUTPUTS = {
    b"ERROR:  rollback switch precondition mismatch\n",
    b"ERROR: rollback switch precondition mismatch\n",
}
EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()
MAX_COMMAND_OUTPUT = 1024 * 1024
# Updated whenever the closed v2 policy changes.  The runner refuses every
# semantic policy variant before its first Docker command.
EXPECTED_POLICY_SHA256 = "bace6ac8d7749d4a777fd3a9b40a309db1aa00d44af2f62e82d5a78e339e7b01"
SAFE_ENV = {
    "PATH": "/usr/bin:/bin",
    "LC_ALL": "C",
    "LANG": "C",
    "TZ": "UTC",
    "DOCKER_CONFIG": "/nonexistent",
    "DOCKER_HOST": DOCKER_HOST,
    "COMPOSE_PARALLEL_LIMIT": "1",
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_CONFIG_GLOBAL": "/dev/null",
    "GIT_NO_REPLACE_OBJECTS": "1",
    "GIT_OPTIONAL_LOCKS": "0",
}


class DynamicPgSwitchError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def reject(code: str) -> None:
    raise DynamicPgSwitchError(code)


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        reject("TASK70_DYNAMIC_MODULE_LOAD_FAILED")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def canonical(value: Any, *, newline: bool = False) -> bytes:
    try:
        raw = json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8", "strict")
    except (TypeError, ValueError, UnicodeError):
        reject("TASK70_DYNAMIC_JSON_INVALID")
    return raw + (b"\n" if newline else b"")


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def digest_value(value: Any) -> str:
    return digest_bytes(canonical(value))


def executor_digest(value: Any) -> str:
    return digest_bytes(canonical(value, newline=True))


def with_digest(body: dict[str, Any], field: str) -> dict[str, Any]:
    return {**body, field: digest_value(body)}


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z",
    )


def checked_text(raw: bytes, code: str, maximum: int = MAX_COMMAND_OUTPUT) -> str:
    if not isinstance(raw, bytes) or len(raw) > maximum or b"\x00" in raw:
        reject(code)
    try:
        return raw.decode("utf-8", "strict")
    except UnicodeDecodeError:
        reject(code)


def parse_json_output(raw: bytes, code: str) -> Any:
    text = checked_text(raw, code)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        reject(code)


def run_command(
    argv: list[str], *, input_bytes: bytes | None = None, timeout: int = 30,
    maximum_output: int = MAX_COMMAND_OUTPUT,
) -> subprocess.CompletedProcess[bytes]:
    if not argv or any(not isinstance(item, str) or not item or "\x00" in item for item in argv):
        reject("TASK70_DYNAMIC_COMMAND_INVALID")
    try:
        result = subprocess.run(
            argv, input=input_bytes, stdin=subprocess.DEVNULL if input_bytes is None else None,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=SAFE_ENV,
            cwd=REPOSITORY_ROOT, check=False, timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired):
        reject("TASK70_DYNAMIC_COMMAND_FAILED")
    if len(result.stdout) > maximum_output or len(result.stderr) > maximum_output:
        reject("TASK70_DYNAMIC_COMMAND_OUTPUT_TOO_LARGE")
    return result


def require_success(
    result: subprocess.CompletedProcess[bytes], code: str,
) -> subprocess.CompletedProcess[bytes]:
    if result.returncode != 0:
        reject(code)
    return result


def docker_command(
    arguments: list[str], *, input_bytes: bytes | None = None, timeout: int = 30,
    maximum_output: int = MAX_COMMAND_OUTPUT,
) -> subprocess.CompletedProcess[bytes]:
    return run_command(
        [DOCKER, "--host", DOCKER_HOST, *arguments], input_bytes=input_bytes,
        timeout=timeout, maximum_output=maximum_output,
    )


def docker_json(arguments: list[str], code: str, *, timeout: int = 30) -> Any:
    result = require_success(docker_command(arguments, timeout=timeout), code)
    return parse_json_output(result.stdout, code)


def sorted_unique_strings(value: Iterable[Any], code: str) -> list[str]:
    items = list(value)
    if any(not isinstance(item, str) or not item for item in items):
        reject(code)
    normalized = sorted(set(items))
    if len(normalized) != len(items):
        reject(code)
    return normalized


def lines(raw: bytes, pattern: re.Pattern[str], code: str) -> list[str]:
    text = checked_text(raw, code)
    values = sorted({item.strip() for item in text.splitlines() if item.strip()})
    if any(pattern.fullmatch(item) is None for item in values):
        reject(code)
    return values


def docker_ids(
    arguments: list[str], code: str, pattern: re.Pattern[str] = CONTAINER_ID,
) -> list[str]:
    result = require_success(docker_command(arguments), code)
    return lines(result.stdout, pattern, code)


def inspect_objects(arguments: list[str], expected_ids: list[str], code: str) -> list[dict[str, Any]]:
    if not expected_ids:
        return []
    value = docker_json([*arguments, *expected_ids], code)
    if not isinstance(value, list) or len(value) != len(expected_ids):
        reject(code)
    by_id = {item.get("Id"): item for item in value if isinstance(item, dict)}
    if set(by_id) != set(expected_ids):
        reject(code)
    return [by_id[item] for item in expected_ids]


def label_digest(labels: Any) -> str:
    if labels is None:
        labels = {}
    if not isinstance(labels, dict) or any(
        not isinstance(key, str) or not isinstance(value, str)
        for key, value in labels.items()
    ):
        reject("TASK70_DYNAMIC_DOCKER_LABELS_INVALID")
    return digest_value(dict(sorted(labels.items())))


def reference_digest(references: Any) -> str:
    if references is None:
        references = []
    if not isinstance(references, list) or any(not isinstance(item, str) for item in references):
        reject("TASK70_DYNAMIC_DOCKER_REFERENCES_INVALID")
    return digest_value(sorted(set(references)))


def safe_service_projection(item: dict[str, Any], expected_service: str) -> dict[str, Any]:
    try:
        identifier = item["Id"]
        config = item["Config"]
        host = item["HostConfig"]
        state = item["State"]
        labels = config["Labels"] or {}
        service = labels["com.docker.compose.service"]
        project = labels["com.docker.compose.project"]
        health = state.get("Health", {}).get("Status", "none").upper()
        mounts = item.get("Mounts") or []
        networks = item.get("NetworkSettings", {}).get("Networks") or {}
        ports = host.get("PortBindings") or {}
    except (KeyError, TypeError, AttributeError):
        reject("TASK70_DYNAMIC_SERVICE_INSPECT_INVALID")
    if not CONTAINER_ID.fullmatch(identifier or "") or service != expected_service \
            or project != COMPOSE_PROJECT or health not in {"HEALTHY", "NONE"}:
        reject("TASK70_DYNAMIC_SERVICE_INSPECT_INVALID")
    return {
        "service": service,
        "container_id": identifier,
        "image_reference_sha256": digest_bytes(str(config.get("Image", "")).encode()),
        "image_id": item.get("Image"),
        "restart_count": item.get("RestartCount"),
        "oom_killed": state.get("OOMKilled"),
        "running": state.get("Running"),
        "health": health,
        "mount_set_sha256": digest_value(sorted([
            {
                "type": mount.get("Type"), "name": mount.get("Name"),
                "destination": mount.get("Destination"), "rw": mount.get("RW"),
            }
            for mount in mounts
        ], key=lambda entry: (str(entry["destination"]), str(entry["name"])))),
        "network_set_sha256": digest_value(sorted(networks)),
        "port_set_sha256": digest_value(sorted(ports)),
    }


def discover_services() -> list[dict[str, Any]]:
    first = docker_ids([
        "ps", "--all", "--quiet", "--no-trunc", "--filter",
        f"label=com.docker.compose.project={COMPOSE_PROJECT}",
    ], "TASK70_DYNAMIC_SERVICE_DISCOVERY_FAILED")
    inspected = inspect_objects(["inspect"], first, "TASK70_DYNAMIC_SERVICE_INSPECT_FAILED")
    second = docker_ids([
        "ps", "--all", "--quiet", "--no-trunc", "--filter",
        f"label=com.docker.compose.project={COMPOSE_PROJECT}",
    ], "TASK70_DYNAMIC_SERVICE_DISCOVERY_FAILED")
    if first != second:
        reject("TASK70_DYNAMIC_SERVICE_DISCOVERY_RACE")
    by_service: dict[str, dict[str, Any]] = {}
    for item in inspected:
        labels = item.get("Config", {}).get("Labels") or {}
        service = labels.get("com.docker.compose.service")
        if service in {"caddy", "postgres", "web", "worker"}:
            if service in by_service:
                reject("TASK70_DYNAMIC_SERVICE_SET_INVALID")
            by_service[service] = safe_service_projection(item, service)
    if set(by_service) != {"caddy", "postgres", "web", "worker"}:
        reject("TASK70_DYNAMIC_SERVICE_SET_INVALID")
    result = [by_service[name] for name in sorted(by_service)]
    if any(
        not item["running"] or item["oom_killed"] or item["restart_count"] != 0
        or item["health"] not in {"HEALTHY", "NONE"}
        for item in result
    ):
        reject("TASK70_DYNAMIC_SERVICE_STATE_UNSAFE")
    return result


def object_snapshot(protected_volumes: list[str]) -> dict[str, Any]:
    container_first = docker_ids(
        ["ps", "--all", "--quiet", "--no-trunc"],
        "TASK70_DYNAMIC_CONTAINER_LIST_FAILED",
    )
    image_first = docker_ids(
        ["image", "ls", "--all", "--quiet", "--no-trunc"],
        "TASK70_DYNAMIC_IMAGE_LIST_FAILED", DIGEST,
    )
    image_items = inspect_objects(
        ["image", "inspect"], image_first, "TASK70_DYNAMIC_IMAGE_INSPECT_FAILED",
    )
    volume_result = require_success(
        docker_command(["volume", "ls", "--quiet"]), "TASK70_DYNAMIC_VOLUME_LIST_FAILED",
    )
    volume_names = sorted({line.strip() for line in checked_text(
        volume_result.stdout, "TASK70_DYNAMIC_VOLUME_LIST_FAILED",
    ).splitlines() if line.strip()})
    volume_items = docker_json(
        ["volume", "inspect", *volume_names], "TASK70_DYNAMIC_VOLUME_INSPECT_FAILED",
    ) if volume_names else []
    network_first = docker_ids(
        ["network", "ls", "--quiet", "--no-trunc"],
        "TASK70_DYNAMIC_NETWORK_LIST_FAILED",
    )
    network_items = inspect_objects(
        ["network", "inspect"], network_first, "TASK70_DYNAMIC_NETWORK_INSPECT_FAILED",
    )
    container_second = docker_ids(
        ["ps", "--all", "--quiet", "--no-trunc"],
        "TASK70_DYNAMIC_CONTAINER_LIST_FAILED",
    )
    image_second = docker_ids(
        ["image", "ls", "--all", "--quiet", "--no-trunc"],
        "TASK70_DYNAMIC_IMAGE_LIST_FAILED", DIGEST,
    )
    volume_second_result = require_success(
        docker_command(["volume", "ls", "--quiet"]), "TASK70_DYNAMIC_VOLUME_LIST_FAILED",
    )
    volume_second = sorted({line.strip() for line in checked_text(
        volume_second_result.stdout, "TASK70_DYNAMIC_VOLUME_LIST_FAILED",
    ).splitlines() if line.strip()})
    network_second = docker_ids(
        ["network", "ls", "--quiet", "--no-trunc"],
        "TASK70_DYNAMIC_NETWORK_LIST_FAILED",
    )
    if container_first != container_second or image_first != image_second \
            or volume_names != volume_second or network_first != network_second:
        reject("TASK70_DYNAMIC_OBJECT_SNAPSHOT_RACE")
    if not isinstance(volume_items, list) or len(volume_items) != len(volume_names):
        reject("TASK70_DYNAMIC_VOLUME_INSPECT_FAILED")
    volume_by_name = {item.get("Name"): item for item in volume_items if isinstance(item, dict)}
    if set(volume_by_name) != set(volume_names):
        reject("TASK70_DYNAMIC_VOLUME_INSPECT_FAILED")
    volumes = [{
        "name": name,
        "driver": volume_by_name[name].get("Driver"),
        "scope": volume_by_name[name].get("Scope"),
        "created_at": volume_by_name[name].get("CreatedAt"),
        "label_set_sha256": label_digest(volume_by_name[name].get("Labels")),
    } for name in volume_names]
    protected = [item for item in volumes if item["name"] in protected_volumes]
    if [item["name"] for item in protected] != protected_volumes:
        reject("TASK70_DYNAMIC_PROTECTED_VOLUME_SET_INVALID")
    images = sorted([{
        "id": item.get("Id"),
        "repo_tag_set_sha256": reference_digest(item.get("RepoTags")),
        "repo_digest_set_sha256": reference_digest(item.get("RepoDigests")),
    } for item in image_items], key=lambda entry: str(entry["id"]))
    networks = sorted([{
        "id": item.get("Id"),
        "name_sha256": digest_bytes(str(item.get("Name", "")).encode()),
        "driver": item.get("Driver"),
        "scope": item.get("Scope"),
        "label_set_sha256": label_digest(item.get("Labels")),
    } for item in network_items], key=lambda entry: str(entry["id"]))
    body = {
        "containers": container_first,
        "images": images,
        "volumes": volumes,
        "networks": networks,
        "protected_volumes": protected,
        "services": discover_services(),
    }
    return with_digest(body, "fingerprint_sha256")


def image_projection(reference: str) -> dict[str, Any]:
    value = docker_json(["image", "inspect", reference], "TASK70_DYNAMIC_IMAGE_NOT_AVAILABLE")
    if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
        reject("TASK70_DYNAMIC_IMAGE_NOT_AVAILABLE")
    item = value[0]
    descriptor = item.get("Descriptor") or {}
    repo_digests = sorted(set(item.get("RepoDigests") or []))
    expected_digest = reference.rsplit("@", 1)[-1]
    projection = {
        "id": item.get("Id"),
        "descriptor_digest": descriptor.get("digest"),
        "repo_digest_suffixes": sorted({entry.rsplit("@", 1)[-1] for entry in repo_digests}),
        "architecture": item.get("Architecture"),
        "os": item.get("Os"),
        "size_bytes": item.get("Size"),
    }
    if not DIGEST.fullmatch(projection["id"] or "") \
            or projection["descriptor_digest"] != expected_digest \
            or expected_digest not in projection["repo_digest_suffixes"] \
            or projection["architecture"] != "amd64" or projection["os"] != "linux" \
            or not isinstance(projection["size_bytes"], int) or projection["size_bytes"] < 1:
        reject("TASK70_DYNAMIC_IMAGE_IDENTITY_INVALID")
    return projection


def read_meminfo() -> tuple[int, int, int]:
    try:
        values = {}
        for line in Path("/proc/meminfo").read_text(encoding="ascii").splitlines():
            key, raw = line.split(":", 1)
            parts = raw.strip().split()
            if parts and parts[0].isdigit():
                values[key] = int(parts[0]) * 1024
        return values["MemAvailable"], values["SwapTotal"], values["SwapTotal"] - values["SwapFree"]
    except (OSError, KeyError, ValueError):
        reject("TASK70_DYNAMIC_RESOURCE_MEMINFO_INVALID")


def read_oom_kill() -> int:
    try:
        for line in Path("/proc/vmstat").read_text(encoding="ascii").splitlines():
            key, value = line.split()
            if key == "oom_kill" and value.isdigit():
                return int(value)
    except (OSError, ValueError):
        pass
    reject("TASK70_DYNAMIC_RESOURCE_OOM_INVALID")


def read_boot_id_sha256() -> str:
    try:
        value = Path("/proc/sys/kernel/random/boot_id").read_text(encoding="ascii").strip()
    except OSError:
        reject("TASK70_DYNAMIC_RESOURCE_BOOT_ID_INVALID")
    if re.fullmatch(r"[0-9a-f-]{36}", value) is None:
        reject("TASK70_DYNAMIC_RESOURCE_BOOT_ID_INVALID")
    return digest_bytes(value.encode())


def resource_values() -> dict[str, Any]:
    available, swap_total, swap_used = read_meminfo()
    if swap_total < 1:
        reject("TASK70_DYNAMIC_RESOURCE_SWAP_INVALID")
    try:
        load1 = float(Path("/proc/loadavg").read_text(encoding="ascii").split()[0])
        root_stat = os.statvfs("/")
        root_available = root_stat.f_bavail * root_stat.f_frsize
    except (OSError, ValueError, IndexError):
        reject("TASK70_DYNAMIC_RESOURCE_HOST_INVALID")
    return {
        "available_memory_bytes": available,
        "swap_used_bytes": swap_used,
        "swap_total_bytes": swap_total,
        "root_available_bytes": root_available,
        "load1": load1,
        "oom_kill_count": read_oom_kill(),
    }


def service_sample(expected: list[dict[str, Any]]) -> list[dict[str, Any]]:
    identifiers = [entry["container_id"] for entry in expected]
    inspected = inspect_objects(["inspect"], sorted(identifiers), "TASK70_DYNAMIC_SERVICE_SAMPLE_FAILED")
    by_id = {item["Id"]: item for item in inspected}
    result = []
    for baseline in expected:
        item = by_id.get(baseline["container_id"])
        if item is None:
            reject("TASK70_DYNAMIC_SERVICE_SAMPLE_FAILED")
        state = item.get("State") or {}
        health = (state.get("Health") or {}).get("Status", "none").upper()
        result.append({
            "service": baseline["service"],
            "container_id": baseline["container_id"],
            "restart_count": item.get("RestartCount"),
            "oom_killed": state.get("OOMKilled"),
            "running": state.get("Running"),
            "health": health,
        })
    return sorted(result, key=lambda entry: entry["service"])


def validate_resource_sample(
    sample: dict[str, Any], policy: dict[str, Any], baseline_services: list[dict[str, Any]],
) -> None:
    resource = policy["resource_policy"]
    if sample["available_memory_bytes"] < resource["minimum_available_memory_bytes"] \
            or sample["swap_used_bytes"] * 100 \
                > sample["swap_total_bytes"] * resource["maximum_swap_percent"] \
            or sample["root_available_bytes"] < resource["minimum_root_available_bytes"] \
            or sample["load1"] > resource["maximum_load1"]:
        reject("TASK70_DYNAMIC_RESOURCE_THRESHOLD_BREACH")
    expected_by_name = {entry["service"]: entry for entry in baseline_services}
    if [entry["service"] for entry in sample["services"]] != sorted(expected_by_name):
        reject("TASK70_DYNAMIC_SERVICE_SAMPLE_FAILED")
    for entry in sample["services"]:
        baseline = expected_by_name[entry["service"]]
        if entry["container_id"] != baseline["container_id"] \
                or entry["restart_count"] != baseline["restart_count"] \
                or entry["oom_killed"] is not False or entry["running"] is not True \
                or entry["health"] not in {"HEALTHY", "NONE"}:
            reject("TASK70_DYNAMIC_SERVICE_STATE_CHANGED")


class ResourceMonitor:
    def __init__(self, policy: dict[str, Any], baseline_services: list[dict[str, Any]]):
        self.policy = policy
        self.baseline_services = copy.deepcopy(baseline_services)
        self.interval = policy["resource_policy"]["sample_interval_seconds"]
        self.started_monotonic = time.monotonic()
        self.boot_id_sha256 = read_boot_id_sha256()
        self.samples: list[dict[str, Any]] = []
        self.failure_code: str | None = None
        self.stop_event = threading.Event()
        self.condition = threading.Condition()
        self.thread = threading.Thread(target=self._run, name="task70-resource-monitor", daemon=False)

    def start(self) -> None:
        self._capture()
        first = self.samples[0]
        resource = self.policy["resource_policy"]
        case = self.policy["case_catalog"][0]
        if first["available_memory_bytes"] < resource["minimum_start_available_memory_bytes"] \
                or first["root_available_bytes"] \
                    < resource["minimum_root_available_bytes"] + case["maximum_disk_delta_bytes"]:
            reject("TASK70_DYNAMIC_RESOURCE_START_GATE_FAILED")
        self.thread.start()

    def _capture(self) -> None:
        try:
            if read_boot_id_sha256() != self.boot_id_sha256:
                reject("TASK70_DYNAMIC_RESOURCE_BOOT_CHANGED")
            body = resource_values()
            sample = {
                "captured_at": utc_now(),
                "elapsed_milliseconds": int(round((time.monotonic() - self.started_monotonic) * 1000)),
                **body,
                "services": service_sample(self.baseline_services),
            }
            validate_resource_sample(sample, self.policy, self.baseline_services)
            with self.condition:
                if self.samples:
                    gap = sample["elapsed_milliseconds"] - self.samples[-1]["elapsed_milliseconds"]
                    if gap <= 0 or gap > self.policy["resource_policy"]["maximum_sample_gap_seconds"] * 1000:
                        reject("TASK70_DYNAMIC_RESOURCE_SAMPLE_GAP_INVALID")
                self.samples.append(sample)
                minimum_window = self.policy["resource_policy"]["minimum_swap_sample_window_seconds"] * 1000
                previous = None
                for candidate in reversed(self.samples[:-1]):
                    if sample["elapsed_milliseconds"] - candidate["elapsed_milliseconds"] >= minimum_window:
                        previous = candidate
                        break
                if previous is not None and sample["swap_used_bytes"] - previous["swap_used_bytes"] \
                        > self.policy["resource_policy"]["maximum_swap_growth_bytes"]:
                    reject("TASK70_DYNAMIC_RESOURCE_SWAP_GROWTH_BREACH")
                self.condition.notify_all()
        except DynamicPgSwitchError as error:
            with self.condition:
                self.failure_code = self.failure_code or error.code
                self.condition.notify_all()

    def _run(self) -> None:
        deadline = self.started_monotonic + self.interval
        while not self.stop_event.is_set():
            remaining = deadline - time.monotonic()
            if remaining > 0 and self.stop_event.wait(remaining):
                break
            self._capture()
            deadline += self.interval
            if deadline < time.monotonic():
                deadline = time.monotonic() + self.interval

    def raise_if_failed(self) -> None:
        with self.condition:
            if self.failure_code:
                reject(self.failure_code)

    def wait_for_window(self, seconds: int) -> None:
        target_ms = seconds * 1000
        with self.condition:
            while not self.failure_code and (
                not self.samples or self.samples[-1]["elapsed_milliseconds"] < target_ms
            ):
                self.condition.wait(timeout=min(self.interval, 5))
            if self.failure_code:
                reject(self.failure_code)

    def stop(self) -> None:
        self.stop_event.set()
        if self.thread.is_alive():
            self.thread.join(timeout=self.interval + 5)
        if self.thread.is_alive():
            reject("TASK70_DYNAMIC_RESOURCE_MONITOR_NOT_REAPED")
        self.raise_if_failed()

    def evidence(self) -> dict[str, Any]:
        self.raise_if_failed()
        samples = copy.deepcopy(self.samples)
        resource = self.policy["resource_policy"]
        if len(samples) < 2:
            reject("TASK70_DYNAMIC_RESOURCE_EVIDENCE_INVALID")
        window_ms = samples[-1]["elapsed_milliseconds"] - samples[0]["elapsed_milliseconds"]
        if window_ms < resource["minimum_total_sample_window_seconds"] * 1000:
            reject("TASK70_DYNAMIC_RESOURCE_EVIDENCE_INVALID")
        swap_growth = 0
        minimum_window_ms = resource["minimum_swap_sample_window_seconds"] * 1000
        maximum_gap_ms = resource["maximum_sample_gap_seconds"] * 1000
        for index, current in enumerate(samples):
            eligible = [previous for previous in samples[:index]
                        if minimum_window_ms <= current["elapsed_milliseconds"]
                        - previous["elapsed_milliseconds"] <= minimum_window_ms + maximum_gap_ms]
            if eligible:
                swap_growth = max(
                    swap_growth,
                    max(0, current["swap_used_bytes"] - eligible[-1]["swap_used_bytes"]),
                )
        service_restart_sums = [sum(
            entry["restart_count"] for entry in sample["services"]
        ) for sample in samples]
        body = {
            "boot_id_sha256": self.boot_id_sha256,
            "sample_interval_seconds": self.interval,
            "sample_count": len(samples),
            "sample_window_seconds": window_ms // 1000,
            "preflight_sample_window_seconds": resource["minimum_preflight_sample_window_seconds"],
            "samples": samples,
            "minimum_available_memory_bytes": min(item["available_memory_bytes"] for item in samples),
            "maximum_swap_percent_observed": max(
                item["swap_used_bytes"] / item["swap_total_bytes"] * 100 for item in samples
            ),
            "maximum_rolling_swap_growth_bytes": swap_growth,
            "minimum_root_available_bytes": min(item["root_available_bytes"] for item in samples),
            "maximum_load1_observed": max(item["load1"] for item in samples),
            "oom_kill_delta": max(item["oom_kill_count"] for item in samples)
                - samples[0]["oom_kill_count"],
            "service_restart_delta": max(service_restart_sums) - service_restart_sums[0],
            "declared_maximum_disk_delta_bytes": self.policy["case_catalog"][0]["maximum_disk_delta_bytes"],
            "observed_peak_disk_delta_bytes": max(
                0, samples[0]["root_available_bytes"]
                - min(item["root_available_bytes"] for item in samples),
            ),
            "result": "PASS",
        }
        return with_digest(body, "resource_evidence_sha256")


def tmpfs_argument(target: str, spec: dict[str, Any]) -> str:
    return f"{target}:{spec['options']},size={spec['size_bytes']}"


def expected_create_arguments(
    policy: dict[str, Any], run_id: str, container_name: str,
) -> list[str]:
    case = policy["case_catalog"][0]
    limits = case["container_limits"]
    arguments = [
        "create", "--pull=never", "--platform", "linux/amd64",
        "--name", container_name,
        "--label", f"{policy['cleanup_policy']['task_label']}={run_id}",
        "--label", policy["cleanup_policy"]["isolation_label"],
        "--user", limits["user"], "--network", limits["network_mode"],
        "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--restart", "no", "--log-driver", "none",
        "--memory", str(limits["memory_bytes"]),
        "--memory-swap", str(limits["memory_swap_bytes"]),
        "--cpus", str(limits["cpus"]), "--pids-limit", str(limits["pids"]),
        "--shm-size", str(limits["shared_memory_bytes"]),
        "--stop-timeout", str(limits["stop_timeout_seconds"]),
    ]
    for target in sorted(limits["tmpfs"]):
        arguments.extend(["--tmpfs", tmpfs_argument(target, limits["tmpfs"][target])])
    arguments.extend([
        "--env", "POSTGRES_HOST_AUTH_METHOD=trust",
        "--env", "POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=C",
        "--env", "PGDATA=/var/lib/postgresql/data/pgdata",
        case["postgres_image_reference"],
        "postgres", "-c", "listen_addresses=*", "-c",
        "unix_socket_directories=/var/run/postgresql", "-c", "max_connections=20",
        "-c", "shared_buffers=64MB", "-c", "log_statement=none",
    ])
    return arguments


def normalize_tmpfs_options(value: str, code: str) -> dict[str, Any]:
    if not isinstance(value, str):
        reject(code)
    parts = value.split(",")
    flags = set()
    key_values: dict[str, str] = {}
    for part in parts:
        if "=" in part:
            key, child = part.split("=", 1)
            if key in key_values:
                reject(code)
            key_values[key] = child
        else:
            flags.add(part)
    if flags != {"rw", "nosuid", "nodev", "noexec"} \
            or set(key_values) != {"uid", "gid", "mode", "size"}:
        reject(code)
    try:
        size = int(key_values["size"])
    except ValueError:
        reject(code)
    return {
        "size_bytes": size,
        "options": ",".join([
            "rw", "nosuid", "nodev", "noexec",
            f"uid={key_values['uid']}", f"gid={key_values['gid']}",
            f"mode={key_values['mode']}",
        ]),
    }


def task_container_projection(
    item: dict[str, Any], *, policy: dict[str, Any], run_id: str, container_name: str,
    image: dict[str, Any],
) -> dict[str, Any]:
    case = policy["case_catalog"][0]
    limits = case["container_limits"]
    try:
        identifier = item["Id"]
        config = item["Config"]
        host = item["HostConfig"]
        labels = config.get("Labels") or {}
        tmpfs = host.get("Tmpfs") or {}
        restart = host.get("RestartPolicy") or {}
        log_config = host.get("LogConfig") or {}
    except (KeyError, TypeError, AttributeError):
        reject("TASK70_DYNAMIC_TASK_CONTAINER_INSPECT_INVALID")
    normalized_tmpfs = {
        target: normalize_tmpfs_options(options, "TASK70_DYNAMIC_TASK_CONTAINER_TMPFS_INVALID")
        for target, options in sorted(tmpfs.items())
    }
    env = config.get("Env") or []
    projection = {
        "container_id": identifier,
        "name": str(item.get("Name", "")).lstrip("/"),
        "created_at": item.get("Created"),
        "labels": dict(sorted(labels.items())),
        "image_id": item.get("Image"),
        "image_reference": config.get("Image"),
        "user": config.get("User"),
        "network_mode": host.get("NetworkMode"),
        "rootfs_read_only": host.get("ReadonlyRootfs"),
        "cap_drop": sorted(host.get("CapDrop") or []),
        "cap_add": sorted(host.get("CapAdd") or []),
        "security_opt": sorted(host.get("SecurityOpt") or []),
        "restart_policy": restart.get("Name"),
        "privileged": host.get("Privileged"),
        "memory_bytes": host.get("Memory"),
        "memory_swap_bytes": host.get("MemorySwap"),
        "nano_cpus": host.get("NanoCpus"),
        "pids": host.get("PidsLimit"),
        "shared_memory_bytes": host.get("ShmSize"),
        "stop_timeout_seconds": config.get("StopTimeout"),
        "log_driver": log_config.get("Type"),
        "devices": host.get("Devices") or [],
        "binds": host.get("Binds") or [],
        "mounts": item.get("Mounts") or [],
        "published_ports": host.get("PortBindings") or {},
        "publish_all_ports": host.get("PublishAllPorts"),
        "tmpfs": normalized_tmpfs,
        "synthetic_trust_auth": "POSTGRES_HOST_AUTH_METHOD=trust" in env,
        "initdb_args": next((entry.split("=", 1)[1] for entry in env
                             if entry.startswith("POSTGRES_INITDB_ARGS=")), None),
        "pgdata": next((entry.split("=", 1)[1] for entry in env
                        if entry.startswith("PGDATA=")), None),
        "command": config.get("Cmd"),
    }
    expected_labels = {
        policy["cleanup_policy"]["task_label"]: run_id,
        "chenyida.erp.execution-scope": "isolated-synthetic-test",
    }
    if not CONTAINER_ID.fullmatch(identifier or "") or projection["name"] != container_name \
            or projection["labels"] != expected_labels \
            or projection["image_id"] != image["id"] \
            or projection["image_reference"] != case["postgres_image_reference"] \
            or projection["user"] != limits["user"] \
            or projection["network_mode"] != limits["network_mode"] \
            or projection["rootfs_read_only"] is not True \
            or projection["cap_drop"] != ["ALL"] or projection["cap_add"] != [] \
            or projection["security_opt"] != ["no-new-privileges"] \
            or projection["restart_policy"] != "no" or projection["privileged"] is not False \
            or projection["memory_bytes"] != limits["memory_bytes"] \
            or projection["memory_swap_bytes"] != limits["memory_swap_bytes"] \
            or projection["nano_cpus"] != 1_000_000_000 or projection["pids"] != limits["pids"] \
            or projection["shared_memory_bytes"] != limits["shared_memory_bytes"] \
            or projection["stop_timeout_seconds"] != limits["stop_timeout_seconds"] \
            or projection["log_driver"] != "none" or projection["devices"] != [] \
            or projection["binds"] != [] or projection["mounts"] != [] \
            or projection["published_ports"] != {} or projection["publish_all_ports"] is not False \
            or projection["tmpfs"] != limits["tmpfs"] \
            or projection["synthetic_trust_auth"] is not True \
            or projection["initdb_args"] != "--encoding=UTF8 --locale=C" \
            or projection["pgdata"] != "/var/lib/postgresql/data/pgdata" \
            or projection["command"] != [
                "postgres", "-c", "listen_addresses=*", "-c",
                "unix_socket_directories=/var/run/postgresql", "-c", "max_connections=20",
                "-c", "shared_buffers=64MB", "-c", "log_statement=none",
            ]:
        reject("TASK70_DYNAMIC_TASK_CONTAINER_INSPECT_INVALID")
    if not isinstance(projection["created_at"], str) or not projection["created_at"]:
        reject("TASK70_DYNAMIC_TASK_CONTAINER_INSPECT_INVALID")
    return projection


def inspect_task_container(
    identifier: str, *, policy: dict[str, Any], run_id: str, container_name: str,
    image: dict[str, Any],
) -> dict[str, Any]:
    value = docker_json(["inspect", identifier], "TASK70_DYNAMIC_TASK_CONTAINER_INSPECT_FAILED")
    if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
        reject("TASK70_DYNAMIC_TASK_CONTAINER_INSPECT_FAILED")
    return task_container_projection(
        value[0], policy=policy, run_id=run_id, container_name=container_name, image=image,
    )


def task_label_container_ids(policy: dict[str, Any], run_id: str) -> list[str]:
    return docker_ids([
        "ps", "--all", "--quiet", "--no-trunc", "--filter",
        f"label={policy['cleanup_policy']['task_label']}={run_id}",
    ], "TASK70_DYNAMIC_TASK_CONTAINER_DISCOVERY_FAILED")


def task_owned_container_ids(
    policy: dict[str, Any], run_id: str, container_name: str,
) -> list[str]:
    if re.fullmatch(r"cyd-dv70-pg-switch-dv70-[A-Za-z0-9_]{8}", container_name) is None:
        reject("TASK70_DYNAMIC_TASK_CONTAINER_NAME_INVALID")
    return docker_ids([
        "ps", "--all", "--quiet", "--no-trunc",
        "--filter", f"name=^/{container_name}$",
        "--filter", f"label={policy['cleanup_policy']['task_label']}={run_id}",
        "--filter", f"label={policy['cleanup_policy']['isolation_label']}",
    ], "TASK70_DYNAMIC_TASK_CONTAINER_RECONCILE_FAILED")


def task_name_container_ids(container_name: str) -> list[str]:
    if re.fullmatch(r"cyd-dv70-pg-switch-dv70-[A-Za-z0-9_]{8}", container_name) is None:
        reject("TASK70_DYNAMIC_TASK_CONTAINER_NAME_INVALID")
    return docker_ids([
        "ps", "--all", "--quiet", "--no-trunc", "--filter",
        f"name=^/{container_name}$",
    ], "TASK70_DYNAMIC_TASK_CONTAINER_RECONCILE_FAILED")


def reconcile_unknown_create(
    create_error: DynamicPgSwitchError, *, policy: dict[str, Any], run_id: str,
    container_name: str, image: dict[str, Any],
) -> None:
    """Resolve a client-side create error without assuming daemon-side failure."""
    last_discovery_error: DynamicPgSwitchError | None = None
    for attempt in range(10):
        try:
            discovered = task_owned_container_ids(policy, run_id, container_name)
        except DynamicPgSwitchError as discovery_error:
            last_discovery_error = discovery_error
            if attempt < 9:
                time.sleep(1)
                continue
            break
        if len(discovered) > 1:
            reject("TASK70_DYNAMIC_TASK_CONTAINER_CREATE_UNKNOWN")
        if len(discovered) == 1:
            identifier = discovered[0]
            try:
                cleanup_task_container(
                    identifier, policy=policy, run_id=run_id,
                    container_name=container_name, image=image, allow_absent=True,
                )
            except DynamicPgSwitchError as cleanup_error:
                raise cleanup_error from create_error
            raise create_error
        if attempt < 9:
            time.sleep(1)
    try:
        labelled = task_label_container_ids(policy, run_id)
        named = task_name_container_ids(container_name)
    except DynamicPgSwitchError as discovery_error:
        raise DynamicPgSwitchError(
            "TASK70_DYNAMIC_TASK_CONTAINER_CREATE_CLEANUP_UNVERIFIED",
        ) from discovery_error
    if labelled or named:
        reject("TASK70_DYNAMIC_TASK_CONTAINER_CREATE_UNKNOWN")
    if last_discovery_error is not None:
        raise create_error from last_discovery_error
    raise create_error


def cleanup_identity_projection(
    item: dict[str, Any], *, policy: dict[str, Any], run_id: str,
    container_name: str, image: dict[str, Any],
) -> dict[str, Any]:
    """Validate only immutable ownership fields needed for exact-ID cleanup.

    Cleanup intentionally does not depend on the full runtime projection: if a
    post-create security projection fails, the exact task-owned container must
    still be removable without weakening the evidence acceptance checks.
    """
    try:
        identifier = item["Id"]
        config = item["Config"]
        state = item["State"]
        labels = config.get("Labels") or {}
    except (KeyError, TypeError, AttributeError):
        reject("TASK70_DYNAMIC_CLEANUP_IDENTITY_INVALID")
    expected_labels = {
        policy["cleanup_policy"]["task_label"]: run_id,
        "chenyida.erp.execution-scope": "isolated-synthetic-test",
    }
    projection = {
        "container_id": identifier,
        "name": str(item.get("Name", "")).lstrip("/"),
        "labels": dict(sorted(labels.items())),
        "image_id": item.get("Image"),
        "image_reference": config.get("Image"),
        "running": state.get("Running"),
    }
    if not CONTAINER_ID.fullmatch(identifier or "") \
            or projection["name"] != container_name \
            or projection["labels"] != expected_labels \
            or projection["image_id"] != image["id"] \
            or projection["image_reference"] \
                != policy["case_catalog"][0]["postgres_image_reference"] \
            or not isinstance(projection["running"], bool):
        reject("TASK70_DYNAMIC_CLEANUP_IDENTITY_INVALID")
    return projection


def inspect_cleanup_identity(
    identifier: str, *, policy: dict[str, Any], run_id: str,
    container_name: str, image: dict[str, Any],
) -> dict[str, Any]:
    value = docker_json(["inspect", identifier], "TASK70_DYNAMIC_CLEANUP_INSPECT_FAILED")
    if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
        reject("TASK70_DYNAMIC_CLEANUP_INSPECT_FAILED")
    return cleanup_identity_projection(
        value[0], policy=policy, run_id=run_id,
        container_name=container_name, image=image,
    )


def reconcile_cleanup_identity(
    identifier: str, *, policy: dict[str, Any], run_id: str,
    container_name: str, image: dict[str, Any],
) -> dict[str, Any] | None:
    """Return exact identity, or None only after independently proving absence."""
    last_error: DynamicPgSwitchError | None = None
    for attempt in range(3):
        try:
            inspected = docker_command(["inspect", identifier], timeout=20)
            if inspected.returncode == 0:
                value = parse_json_output(
                    inspected.stdout, "TASK70_DYNAMIC_CLEANUP_INSPECT_FAILED",
                )
                if not isinstance(value, list) or len(value) != 1 \
                        or not isinstance(value[0], dict):
                    reject("TASK70_DYNAMIC_CLEANUP_INSPECT_FAILED")
                identity = cleanup_identity_projection(
                    value[0], policy=policy, run_id=run_id,
                    container_name=container_name, image=image,
                )
                if task_label_container_ids(policy, run_id) != [identifier] \
                        or task_name_container_ids(container_name) != [identifier]:
                    reject("TASK70_DYNAMIC_CLEANUP_CONTAINER_IDENTITY_DRIFT")
                return identity
            labelled = task_label_container_ids(policy, run_id)
            named = task_name_container_ids(container_name)
            if not labelled and not named:
                return None
            if labelled != [identifier] or named != [identifier]:
                reject("TASK70_DYNAMIC_CLEANUP_CONTAINER_IDENTITY_DRIFT")
        except DynamicPgSwitchError as error:
            last_error = error
        if attempt < 2:
            time.sleep(1)
    raise DynamicPgSwitchError("TASK70_DYNAMIC_CLEANUP_STATE_UNVERIFIED") from last_error


def create_task_container(
    policy: dict[str, Any], run_id: str, container_name: str, image: dict[str, Any],
) -> tuple[str, dict[str, Any], list[str]]:
    if task_label_container_ids(policy, run_id):
        reject("TASK70_DYNAMIC_TASK_CONTAINER_PREEXISTS")
    if task_name_container_ids(container_name):
        reject("TASK70_DYNAMIC_TASK_CONTAINER_PREEXISTS")
    arguments = expected_create_arguments(policy, run_id, container_name)
    try:
        result = docker_command(arguments, timeout=60)
    except DynamicPgSwitchError as create_error:
        reconcile_unknown_create(
            create_error, policy=policy, run_id=run_id,
            container_name=container_name, image=image,
        )
        raise AssertionError("unreachable")
    parse_error: DynamicPgSwitchError | None = None
    discovery_error: DynamicPgSwitchError | None = None
    try:
        identifiers = lines(
            result.stdout, CONTAINER_ID,
            "TASK70_DYNAMIC_TASK_CONTAINER_CREATE_INVALID",
        ) if result.returncode == 0 else []
    except DynamicPgSwitchError as error:
        identifiers = []
        parse_error = error
    try:
        discovered = task_label_container_ids(policy, run_id)
    except DynamicPgSwitchError as error:
        discovered = []
        discovery_error = error
    candidates = sorted(set(identifiers + discovered))
    if len(candidates) != 1:
        cleanup_candidate = discovered[0] if len(discovered) == 1 \
            else identifiers[0] if result.returncode == 0 and len(identifiers) == 1 else None
        if cleanup_candidate is not None:
            try:
                cleanup_task_container(
                    cleanup_candidate, policy=policy, run_id=run_id,
                    container_name=container_name, image=image, allow_absent=True,
                )
            except DynamicPgSwitchError as cleanup_error:
                raise cleanup_error from parse_error or discovery_error
        reject("TASK70_DYNAMIC_TASK_CONTAINER_CREATE_UNKNOWN")
    identifier = candidates[0]
    try:
        inspect_cleanup_identity(
            identifier, policy=policy, run_id=run_id,
            container_name=container_name, image=image,
        )
        if parse_error is not None:
            raise parse_error
        if discovery_error is not None:
            raise discovery_error
        if result.returncode != 0:
            reject("TASK70_DYNAMIC_TASK_CONTAINER_CREATE_RESPONSE_LOST")
        if identifiers != [identifier] or discovered != [identifier]:
            reject("TASK70_DYNAMIC_TASK_CONTAINER_CREATE_INVALID")
        projection = inspect_task_container(
            identifier, policy=policy, run_id=run_id,
            container_name=container_name, image=image,
        )
        return identifier, projection, arguments
    except DynamicPgSwitchError as error:
        try:
            cleanup_task_container(
                identifier, policy=policy, run_id=run_id,
                container_name=container_name, image=image, allow_absent=True,
            )
        except DynamicPgSwitchError as cleanup_error:
            raise cleanup_error from error
        raise


def cleanup_task_container(
    identifier: str | None, *, policy: dict[str, Any], run_id: str,
    container_name: str, image: dict[str, Any], allow_absent: bool = False,
) -> list[str]:
    if identifier is None:
        discovered = task_label_container_ids(policy, run_id)
        if discovered:
            reject("TASK70_DYNAMIC_CLEANUP_UNOWNED_CONTAINER")
        return []
    if not CONTAINER_ID.fullmatch(identifier):
        reject("TASK70_DYNAMIC_CLEANUP_IDENTITY_INVALID")
    identity = reconcile_cleanup_identity(
        identifier, policy=policy, run_id=run_id,
        container_name=container_name, image=image,
    )
    if identity is None:
        if allow_absent:
            return []
        reject("TASK70_DYNAMIC_CLEANUP_CONTAINER_MISSING")
    if identity["running"]:
        for attempt in range(2):
            try:
                docker_command([
                    "stop", "--timeout",
                    str(policy["case_catalog"][0]["container_limits"][
                        "stop_timeout_seconds"
                    ]),
                    identifier,
                ], timeout=20)
            except DynamicPgSwitchError:
                pass
            identity = reconcile_cleanup_identity(
                identifier, policy=policy, run_id=run_id,
                container_name=container_name, image=image,
            )
            if identity is None:
                reject("TASK70_DYNAMIC_CLEANUP_STOP_STATE_INVALID")
            if identity["running"] is False:
                break
            if attempt == 1:
                reject("TASK70_DYNAMIC_CLEANUP_STOP_FAILED")
    removed = False
    for attempt in range(2):
        try:
            docker_command(["rm", identifier], timeout=20)
        except DynamicPgSwitchError:
            pass
        identity = reconcile_cleanup_identity(
            identifier, policy=policy, run_id=run_id,
            container_name=container_name, image=image,
        )
        if identity is None:
            removed = True
            break
        if identity["running"]:
            reject("TASK70_DYNAMIC_CLEANUP_REMOVE_STATE_INVALID")
        if attempt == 1:
            reject("TASK70_DYNAMIC_CLEANUP_REMOVE_FAILED")
    if not removed:
        reject("TASK70_DYNAMIC_CLEANUP_CONTAINER_REMAINS")
    return [identifier]


def psql_arguments(container_id: str, phase: str, database: str = "postgres") -> list[str]:
    if not CONTAINER_ID.fullmatch(container_id) or re.fullmatch(r"[a-z0-9_]{1,32}", phase) is None \
            or re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", database) is None:
        reject("TASK70_DYNAMIC_PSQL_ARGUMENTS_INVALID")
    return [
        "exec", "--interactive", "--user", "999:999", "--env",
        f"PGAPPNAME=cyd_rb_deadbeefdeadbeef_{phase}", "--", container_id,
        "psql", "--no-psqlrc", "--quiet", "--no-align", "--tuples-only",
        "--field-separator=\t", "--host=/var/run/postgresql", "--port=5432",
        "--username=postgres", "--no-password", f"--dbname={database}",
        "--set=ON_ERROR_STOP=on", "--set=VERBOSITY=terse",
    ]


def execute_psql(
    container_id: str, phase: str, sql: bytes, *, timeout: int = 300,
) -> subprocess.CompletedProcess[bytes]:
    if not isinstance(sql, bytes) or not sql.endswith(b"\n") or len(sql) > 1024 * 1024:
        reject("TASK70_DYNAMIC_PSQL_SQL_INVALID")
    return docker_command(
        psql_arguments(container_id, phase), input_bytes=sql, timeout=timeout,
    )


def quote_identifier(value: str) -> str:
    if re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", value) is None:
        reject("TASK70_DYNAMIC_DATABASE_IDENTIFIER_INVALID")
    return f'"{value}"'


def quote_literal(value: str) -> str:
    if not isinstance(value, str) or not value or len(value.encode()) > 512 \
            or "\x00" in value or "\n" in value or "\r" in value:
        reject("TASK70_DYNAMIC_DATABASE_LITERAL_INVALID")
    return "'" + value.replace("'", "''") + "'"


def setup_sql(policy: dict[str, Any]) -> bytes:
    guard = policy["required_target_guard"]["management_database_comment"]
    active = "chenyida_erp"
    staging = "chenyida_erp_rb_deadbeefdeadbeef"
    candidate_marker = policy["required_target_guard"]["executor_fixture_candidate_marker"]
    staging_marker = "chenyida-erp-uat-rollback/v1:rollback-runner-deadbeef:RESTORED_STAGING"
    statements = [
        f"COMMENT ON DATABASE postgres IS {quote_literal(guard)};",
        f"CREATE DATABASE {quote_identifier(active)} WITH OWNER postgres TEMPLATE template0 "
        "ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C' LC_CTYPE 'C' "
        "TABLESPACE pg_default CONNECTION LIMIT 0;",
        f"ALTER DATABASE {quote_identifier(active)} SET default_transaction_read_only TO on;",
        f"ALTER DATABASE {quote_identifier(active)} ALLOW_CONNECTIONS false;",
        f"ALTER DATABASE {quote_identifier(active)} CONNECTION LIMIT 0;",
        f"COMMENT ON DATABASE {quote_identifier(active)} IS {quote_literal(candidate_marker)};",
        f"CREATE DATABASE {quote_identifier(staging)} WITH OWNER postgres TEMPLATE template0 "
        "ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C' LC_CTYPE 'C' "
        "TABLESPACE pg_default CONNECTION LIMIT 0;",
        f"ALTER DATABASE {quote_identifier(staging)} SET default_transaction_read_only TO on;",
        f"ALTER DATABASE {quote_identifier(staging)} ALLOW_CONNECTIONS true;",
        f"ALTER DATABASE {quote_identifier(staging)} CONNECTION LIMIT 0;",
        f"COMMENT ON DATABASE {quote_identifier(staging)} IS {quote_literal(staging_marker)};",
    ]
    return ("\n".join(statements) + "\n").encode()


def reset_sql(base: dict[str, Any], restored_oid: str) -> bytes:
    names = base["databases"]
    active = quote_identifier(names["active_name"])
    staging = quote_identifier(names["staging_name"])
    quarantine = quote_identifier(names["quarantine_name"])
    sql = f"""BEGIN;
DO $cyd$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_database d
       WHERE d.datname={quote_literal(names['active_name'])} AND d.oid::text={quote_literal(restored_oid)}
         AND pg_catalog.shobj_description(d.oid,'pg_database')={quote_literal(names['candidate_marker'])}
         AND d.datallowconn=false AND d.datconnlimit=0)
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_database d
       WHERE d.datname={quote_literal(names['quarantine_name'])} AND d.oid::text={quote_literal(names['candidate_oid'])}
         AND pg_catalog.shobj_description(d.oid,'pg_database')={quote_literal(names['quarantine_marker'])}
         AND d.datallowconn=false AND d.datconnlimit=0)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname={quote_literal(names['staging_name'])})
  THEN RAISE EXCEPTION 'task70 fixture reset precondition mismatch'; END IF;
END
$cyd$;
ALTER DATABASE {active} RENAME TO {staging};
ALTER DATABASE {quarantine} RENAME TO {active};
ALTER DATABASE {staging} ALLOW_CONNECTIONS true;
COMMENT ON DATABASE {active} IS {quote_literal(names['candidate_marker'])};
COMMENT ON DATABASE {staging} IS {quote_literal(names['staging_marker'])};
COMMIT;
"""
    return sql.encode()


def marker_sql(database: str, marker: str) -> bytes:
    return f"COMMENT ON DATABASE {quote_identifier(database)} IS {quote_literal(marker)};\n".encode()


def guard_sql(policy: dict[str, Any]) -> bytes:
    marker = quote_literal(policy["required_target_guard"]["management_database_comment"])
    return f"""SELECT pg_catalog.json_build_object(
  'system_identifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
  'server_version_num',current_setting('server_version_num'),
  'listen_addresses',current_setting('listen_addresses'),
  'management_database',current_database(),
  'management_comment',pg_catalog.shobj_description(
    (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()),'pg_database'),
  'guard_matches',pg_catalog.shobj_description(
    (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()),'pg_database')={marker}
)::text;
""".encode()


def database_identity_sql() -> bytes:
    return b"""SELECT pg_catalog.json_build_object(
  'system_identifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
  'server_version_num',current_setting('server_version_num'),
  'listen_addresses',current_setting('listen_addresses'),
  'encoding',pg_catalog.pg_encoding_to_char(d.encoding),
  'collate',d.datcollate,
  'ctype',d.datctype,
  'locale_provider',CASE d.datlocprovider WHEN 'c' THEN 'libc' ELSE d.datlocprovider::text END,
  'collation_version',d.datcollversion,
  'active_oid',(SELECT oid::text FROM pg_catalog.pg_database WHERE datname='chenyida_erp'),
  'staging_oid',(SELECT oid::text FROM pg_catalog.pg_database WHERE datname='chenyida_erp_rb_deadbeefdeadbeef')
)::text FROM pg_catalog.pg_database d WHERE d.datname=current_database();
"""


def execute_fixture_sql(container_id: str, phase: str, sql: bytes) -> dict[str, Any]:
    result = execute_psql(container_id, phase, sql)
    if result.returncode != 0 or result.stderr:
        reject("TASK70_DYNAMIC_FIXTURE_SQL_FAILED")
    body = {
        "phase": phase,
        "sql_sha256": digest_bytes(sql),
        "exit_code": result.returncode,
        "stdout_sha256": digest_bytes(result.stdout),
        "stderr_sha256": digest_bytes(result.stderr),
    }
    return with_digest(body, "fixture_receipt_sha256")


def verify_target_guard(container_id: str, policy: dict[str, Any]) -> dict[str, Any]:
    result = execute_psql(container_id, "target_guard", guard_sql(policy))
    if result.returncode != 0 or result.stderr:
        reject("TASK70_DYNAMIC_TARGET_GUARD_QUERY_FAILED")
    value = parse_json_output(result.stdout, "TASK70_DYNAMIC_TARGET_GUARD_QUERY_INVALID")
    expected = policy["required_target_guard"]
    if not isinstance(value, dict) or value.get("server_version_num") != "170010" \
            or value.get("listen_addresses") != expected["postgres_listen_addresses"] \
            or value.get("management_database") != expected["management_database"] \
            or value.get("management_comment") != expected["management_database_comment"] \
            or value.get("guard_matches") is not True \
            or re.fullmatch(r"[1-9][0-9]{9,24}", value.get("system_identifier") or "") is None:
        reject("TASK70_DYNAMIC_TARGET_GUARD_INVALID")
    body = {
        "system_identifier": value["system_identifier"],
        "server_version_num": value["server_version_num"],
        "listen_addresses": value["listen_addresses"],
        "management_database": value["management_database"],
        "management_comment": value["management_comment"],
        "guard_matches": True,
    }
    return with_digest(body, "guard_receipt_sha256")


def read_database_identity(container_id: str) -> dict[str, Any]:
    result = execute_psql(container_id, "fixture_identity", database_identity_sql())
    if result.returncode != 0 or result.stderr:
        reject("TASK70_DYNAMIC_DATABASE_IDENTITY_QUERY_FAILED")
    value = parse_json_output(result.stdout, "TASK70_DYNAMIC_DATABASE_IDENTITY_INVALID")
    expected = {
        "server_version_num": "170010", "listen_addresses": "*", "encoding": "UTF8",
        "collate": "C", "ctype": "C", "locale_provider": "libc",
        "collation_version": None,
    }
    if not isinstance(value, dict) or any(value.get(key) != child for key, child in expected.items()) \
            or re.fullmatch(r"[1-9][0-9]{9,24}", value.get("system_identifier") or "") is None \
            or re.fullmatch(r"[1-9][0-9]{3,9}", value.get("active_oid") or "") is None \
            or re.fullmatch(r"[1-9][0-9]{3,9}", value.get("staging_oid") or "") is None \
            or value["active_oid"] == value["staging_oid"]:
        reject("TASK70_DYNAMIC_DATABASE_IDENTITY_INVALID")
    return value


def materialize_fixture_inputs(
    fixture_module: Any, *, identity: dict[str, Any], container_id: str,
    image_reference: str, image_id: str, git_commit: str, application_version: str,
) -> Any:
    inputs = fixture_module.PostgresRollbackBaseSpecTest.inputs()
    database = inputs.package["database"]
    database.update({
        "system_identifier": identity["system_identifier"],
        "oid": identity["active_oid"],
    })
    inputs._plan["deployment"]["database"] = database
    manifest = inputs._documents["snapshot_manifest"]
    manifest["deployment"]["database_system_identifier"] = identity["system_identifier"]
    manifest["deployment"]["database_oid"] = identity["active_oid"]
    manifest["application"]["version"] = application_version
    manifest["application"]["git_commit"] = git_commit
    manifest_sha256 = fixture_module.EXECUTOR.digest_value(manifest)
    inputs.package["sources"]["snapshot_manifest"]["sha256"] = manifest_sha256
    inputs._plan["source_bindings"]["snapshot_manifest_sha256"] = manifest_sha256
    inputs.package["predecessor"]["application_version"] = application_version
    inputs.package["predecessor"]["git_commit"] = git_commit
    postgres = inputs._plan["candidate"]["services"]["postgres"]
    postgres.update({
        "container_id": container_id,
        "image_reference": image_reference,
        "image_digest": image_id,
    })
    return inputs


def derive_specs(
    executor: Any, fixture_module: Any, *, identity: dict[str, Any], container_id: str,
    image_reference: str, image_id: str, git_commit: str, application_version: str,
    before_observation_sha256: str,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], bytes, bytes]:
    inputs = materialize_fixture_inputs(
        fixture_module, identity=identity, container_id=container_id,
        image_reference=image_reference, image_id=image_id, git_commit=git_commit,
        application_version=application_version,
    )
    base = executor.derive_pg_rollback_base_spec(inputs)
    if base["postgres"]["system_identifier"] != identity["system_identifier"] \
            or base["databases"]["candidate_oid"] != identity["active_oid"] \
            or base["postgres"]["server_version_num"] != identity["server_version_num"]:
        reject("TASK70_DYNAMIC_BASE_SPEC_IDENTITY_INVALID")
    observation_purpose = "task70-dynamic-case"
    observation_binding_sha256 = executor_digest({
        "task_id": "SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70",
        "case_id": "DV70-PG-SWITCH-01",
        "base_spec_sha256": base["base_spec_sha256"],
        "restored_oid": identity["staging_oid"],
    })
    observe_bindings = {
        "journal_state_sha256": executor_digest({
            "base_spec_sha256": base["base_spec_sha256"],
            "purpose": observation_purpose,
            "binding_sha256": observation_binding_sha256,
        }),
        "observation_scope_sha256": executor_digest({
            "system_identifier": base["postgres"]["system_identifier"],
            "databases": sorted((
                base["databases"]["active_name"],
                base["databases"]["staging_name"],
                base["databases"]["quarantine_name"],
            )),
        }),
    }
    observe_spec = executor.derive_pg_opcode_spec(
        base, "PG_RB_OBSERVE_STATE_V1", observe_bindings,
    )
    switch_bindings = {
        "privilege_receipt_sha256": executor_digest({
            "task_id": "SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70",
            "case_id": "DV70-PG-SWITCH-01",
            "scope": "SYNTHETIC_PRIVILEGE_RECEIPT_PLACEHOLDER",
        }),
        "staging_oid": identity["staging_oid"],
        "before_observation_sha256": before_observation_sha256,
        "expected_switched_identity_sha256": executor_digest({
            "active_name": base["databases"]["active_name"],
            "active_oid": identity["staging_oid"],
            "quarantine_name": base["databases"]["quarantine_name"],
            "quarantine_oid": base["databases"]["candidate_oid"],
            "state": "NEW_SEALED",
        }),
    }
    switch_spec = executor.derive_pg_opcode_spec(
        base, "PG_RB_ATOMIC_SWITCH_V1", switch_bindings,
    )
    observe_sql = executor.render_pg_sql(base, observe_spec["opcode"], observe_spec["bindings"])
    switch_sql = executor.render_pg_sql(base, switch_spec["opcode"], switch_spec["bindings"])
    if digest_bytes(observe_sql) != observe_spec["sql_sha256"] \
            or digest_bytes(switch_sql) != switch_spec["sql_sha256"]:
        reject("TASK70_DYNAMIC_OPCODE_SQL_BINDING_INVALID")
    return base, observe_spec, switch_spec, observe_sql, switch_sql


def state_projection(observation: dict[str, Any]) -> dict[str, Any]:
    return {
        "system_identifier": observation["system_identifier"],
        "server_version_num": observation["server_version_num"],
        "databases": observation["databases"],
    }


def topology(observation: dict[str, Any], base: dict[str, Any], restored_oid: str) -> str:
    by_name = {entry["name"]: entry["oid"] for entry in observation["databases"]}
    names = base["databases"]
    if by_name == {
        names["active_name"]: names["candidate_oid"],
        names["staging_name"]: restored_oid,
    }:
        return "OLD_TOPOLOGY"
    if by_name == {
        names["active_name"]: restored_oid,
        names["quarantine_name"]: names["candidate_oid"],
    }:
        return "NEW_TOPOLOGY"
    return "MIXED_OR_UNKNOWN_TOPOLOGY"


def observe_state(
    executor: Any, *, container_id: str, base: dict[str, Any], restored_oid: str,
    observe_sql: bytes,
) -> tuple[dict[str, Any], dict[str, Any]]:
    result = execute_psql(container_id, "observe", observe_sql)
    if result.returncode != 0 or result.stderr:
        reject("TASK70_DYNAMIC_OBSERVATION_COMMAND_FAILED")
    observed = executor.parse_pg_state_observation(
        result.stdout, base=base, observed_at=utc_now(),
    )
    classification = executor.classify_pg_rollback_layout(
        observed, base=base, restored_oid=restored_oid,
    )
    return observed, {
        "layout": classification["layout"],
        "topology": topology(observed, base, restored_oid),
        "state_projection_sha256": digest_value(state_projection(observed)),
        "classification_sha256": classification["classification_sha256"],
    }


def command_receipt(
    *, command_class: str, opcode: str, stdin_sha256: str, result: subprocess.CompletedProcess[bytes],
    failure_code: str | None, response_delivered: bool, caller_boundary: str,
) -> dict[str, Any]:
    for output in (result.stdout, result.stderr):
        if not isinstance(output, bytes) or len(output) > 64 * 1024 \
                or b"\x00" in output or b"\r" in output:
            reject("TASK70_DYNAMIC_COMMAND_RECEIPT_OUTPUT_INVALID")
        checked_text(output, "TASK70_DYNAMIC_COMMAND_RECEIPT_OUTPUT_INVALID", 64 * 1024)
    body = {
        "command_class": command_class,
        "opcode": opcode,
        "stdin_sha256": stdin_sha256,
        "exit_code": result.returncode,
        "stdout_sha256": digest_bytes(result.stdout),
        "stderr_sha256": digest_bytes(result.stderr),
        "stdout_base64": base64.b64encode(result.stdout).decode("ascii"),
        "stderr_base64": base64.b64encode(result.stderr).decode("ascii"),
        "failure_code": failure_code,
        "response_delivered": response_delivered,
        "caller_boundary": caller_boundary,
    }
    return with_digest(body, "command_receipt_sha256")


def execute_production_switch(
    executor: Any, *, container_id: str, sql: bytes, expected: str,
    response_delivered: bool = True,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    result = execute_psql(container_id, "switch", sql)
    failure_code = None
    ack = None
    if expected == "success":
        if result.returncode != 0 or result.stderr:
            reject("TASK70_DYNAMIC_PRODUCTION_SWITCH_FAILED")
        try:
            mutation_output = result.stdout.decode("ascii", "strict")
        except UnicodeDecodeError:
            reject("TASK70_DYNAMIC_PRODUCTION_SWITCH_OUTPUT_INVALID")
        if any(character not in " \t\r\nt" for character in mutation_output):
            reject("TASK70_DYNAMIC_PRODUCTION_SWITCH_OUTPUT_INVALID")
        if response_delivered:
            ack = executor.parse_pg_mutation_ack(result.stdout, "PG_RB_ATOMIC_SWITCH_V1")
    elif expected == "precondition":
        if result.returncode != 3 or result.stdout != b"\n" \
                or result.stderr not in PRECONDITION_ERROR_OUTPUTS:
            reject("TASK70_DYNAMIC_PRODUCTION_SWITCH_DID_NOT_FAIL_CLOSED")
        failure_code = "ROLLBACK_SWITCH_PRECONDITION_MISMATCH"
    else:
        reject("TASK70_DYNAMIC_PRODUCTION_SWITCH_EXPECTATION_INVALID")
    boundary = "CALLER_RECEIVED_PROCESS_RESULT" if response_delivered \
        else "AFTER_PSQL_COMPLETION_BEFORE_ACK_PARSE_RESULT_DISCARDED"
    receipt = command_receipt(
        command_class="PRODUCTION", opcode="PG_RB_ATOMIC_SWITCH_V1",
        stdin_sha256=digest_bytes(sql), result=result, failure_code=failure_code,
        response_delivered=response_delivered, caller_boundary=boundary,
    )
    return receipt, ack


def derive_fault_stream(production_sql: bytes, base: dict[str, Any]) -> tuple[bytes, int]:
    names = base["databases"]
    anchor = (
        f"ALTER DATABASE {quote_identifier(names['active_name'])} "
        f"RENAME TO {quote_identifier(names['quarantine_name'])};\n"
    ).encode()
    if production_sql.count(anchor) != 1:
        reject("TASK70_DYNAMIC_FAULT_ANCHOR_INVALID")
    boundary = production_sql.index(anchor) + len(anchor)
    second_anchor = (
        f"ALTER DATABASE {quote_identifier(names['staging_name'])} "
        f"RENAME TO {quote_identifier(names['active_name'])};\n"
    ).encode()
    if production_sql.count(second_anchor) != 1 or production_sql.index(second_anchor) < boundary:
        reject("TASK70_DYNAMIC_FAULT_ANCHOR_INVALID")
    barrier = f"SELECT {quote_literal(FAULT_BARRIER)}::text;\n".encode()
    return production_sql[:boundary] + barrier, boundary


def terminate_process_group(process: subprocess.Popen[bytes]) -> None:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    if process.poll() is None:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    if process.poll() is None:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            reject("TASK70_DYNAMIC_FAULT_PROCESS_GROUP_TERMINATION_FAILED")


def require_process_group_gone(process_group_id: int) -> None:
    try:
        os.killpg(process_group_id, 0)
    except ProcessLookupError:
        return
    except PermissionError:
        reject("TASK70_DYNAMIC_FAULT_PROCESS_GROUP_REMAINS")
    except OSError as error:
        if error.errno == errno.ESRCH:
            return
        reject("TASK70_DYNAMIC_FAULT_PROCESS_GROUP_CHECK_FAILED")
    reject("TASK70_DYNAMIC_FAULT_PROCESS_GROUP_REMAINS")


def execute_fault_stream(
    *, container_id: str, fault_sql: bytes, observe_callback,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    argv = [DOCKER, "--host", DOCKER_HOST, *psql_arguments(container_id, "switchfault")]
    try:
        process = subprocess.Popen(
            argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=SAFE_ENV, cwd=REPOSITORY_ROOT, start_new_session=True,
        )
    except OSError:
        reject("TASK70_DYNAMIC_FAULT_PROCESS_START_FAILED")
    if process.stdin is None or process.stdout is None or process.stderr is None:
        terminate_process_group(process)
        require_process_group_gone(process.pid)
        reject("TASK70_DYNAMIC_FAULT_PROCESS_PIPE_INVALID")
    stdout = bytearray()
    try:
        process.stdin.write(fault_sql)
        process.stdin.flush()
        deadline = time.monotonic() + 30
        marker = (FAULT_BARRIER + "\n").encode()
        while marker not in stdout:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                reject("TASK70_DYNAMIC_FAULT_BARRIER_NOT_OBSERVED")
            readable, _, _ = select.select([process.stdout], [], [], min(remaining, 1))
            if not readable:
                if process.poll() is not None:
                    reject("TASK70_DYNAMIC_FAULT_PROCESS_EXITED_EARLY")
                continue
            chunk = os.read(process.stdout.fileno(), 4096)
            if not chunk:
                reject("TASK70_DYNAMIC_FAULT_BARRIER_NOT_OBSERVED")
            stdout.extend(chunk)
            if len(stdout) > MAX_COMMAND_OUTPUT:
                reject("TASK70_DYNAMIC_FAULT_OUTPUT_TOO_LARGE")
        witness_observation, witness_classification = observe_callback()
        process.stdin.close()
        process.stdin = None
        try:
            remaining_stdout, stderr = process.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            terminate_process_group(process)
            require_process_group_gone(process.pid)
            reject("TASK70_DYNAMIC_FAULT_PROCESS_TIMEOUT")
        stdout.extend(remaining_stdout)
        if len(stdout) > MAX_COMMAND_OUTPUT or len(stderr) > MAX_COMMAND_OUTPUT \
                or process.returncode != 0 or stderr:
            reject("TASK70_DYNAMIC_FAULT_PROCESS_FAILED")
        stdout_text = checked_text(
            bytes(stdout), "TASK70_DYNAMIC_FAULT_OUTPUT_INVALID", 64 * 1024,
        )
        if stdout_text.count(FAULT_BARRIER) != 1 \
                or stdout_text.strip() != FAULT_BARRIER:
            reject("TASK70_DYNAMIC_FAULT_OUTPUT_INVALID")
        require_process_group_gone(process.pid)
        result = subprocess.CompletedProcess(argv, process.returncode, bytes(stdout), stderr)
        receipt = command_receipt(
            command_class="DERIVED_FAULT_STREAM",
            opcode="DERIVED_FIRST_RENAME_BARRIER_EOF_V1",
            stdin_sha256=digest_bytes(fault_sql), result=result, failure_code=None,
            response_delivered=True, caller_boundary="EOF_AFTER_FIRST_RENAME_BARRIER",
        )
        return receipt, witness_observation, witness_classification
    except BaseException as error:
        terminate_process_group(process)
        require_process_group_gone(process.pid)
        if isinstance(error, (DynamicPgSwitchError, KeyboardInterrupt, SystemExit)):
            raise
        raise DynamicPgSwitchError("TASK70_DYNAMIC_FAULT_PROCESS_IO_FAILED") from error


def scenario_digest(body: dict[str, Any]) -> dict[str, Any]:
    return with_digest(body, "scenario_sha256")


def assertion_digest(identifier: str, evidence: dict[str, Any]) -> dict[str, Any]:
    body = {"id": identifier, "result": "PASS", "evidence": evidence}
    return {**body, "evidence_sha256": digest_value(evidence)}


def build_assertions(
    scenarios: list[dict[str, Any]], *, production_spec: dict[str, Any], base: dict[str, Any],
    restored_oid: str, before_fingerprint_sha256: str, after_fingerprint_sha256: str,
    cleanup_receipt_sha256: str,
) -> list[dict[str, Any]]:
    by_id = {item["scenario_id"]: item for item in scenarios}
    success = by_id["EXACT_SUCCESS"]
    repeat = by_id["REPEAT_FAIL_CLOSED"]
    drift = by_id["PRECONDITION_DRIFT_REJECTED"]
    fault = by_id["FIRST_RENAME_FAULT_ROLLBACK"]
    response = by_id[CALLER_RESULT_DISCARD_SCENARIO]
    production_refs = [
        success["scenario_sha256"], repeat["scenario_sha256"],
        drift["scenario_sha256"], response["scenario_sha256"],
    ]
    values = [
        assertion_digest("PRODUCTION_SQL_SHA_BOUND", {
            "scenario_refs": production_refs,
            "production_sql_sha256": production_spec["sql_sha256"],
            "opcode_spec_sha256": production_spec["opcode_spec_sha256"],
            "production_dispatch_count": 4,
        }),
        assertion_digest("EXACT_SWITCH_NEW_SEALED", {
            "scenario_refs": [success["scenario_sha256"]],
            "before_layout": success["before_classification"]["layout"],
            "after_layout": success["after_classification"]["layout"],
            "mutation_ack_sha256": success["mutation_ack"]["ack_sha256"],
        }),
        assertion_digest("DATABASE_OIDS_PRESERVED", {
            "scenario_refs": [success["scenario_sha256"]],
            "candidate_oid": base["databases"]["candidate_oid"],
            "restored_oid": restored_oid,
            "candidate_before_name": base["databases"]["active_name"],
            "candidate_after_name": base["databases"]["quarantine_name"],
            "restored_before_name": base["databases"]["staging_name"],
            "restored_after_name": base["databases"]["active_name"],
        }),
        assertion_digest("REPEAT_EXECUTION_FAILS_CLOSED", {
            "scenario_refs": [repeat["scenario_sha256"]],
            "failure_code": repeat["command"]["failure_code"],
            "state_unchanged": repeat["before_classification"]["state_projection_sha256"]
                == repeat["after_classification"]["state_projection_sha256"],
            "after_layout": repeat["after_classification"]["layout"],
        }),
        assertion_digest("PRECONDITION_DRIFT_REJECTED", {
            "scenario_refs": [drift["scenario_sha256"]],
            "drift_marker": DRIFT_MARKER,
            "failure_code": drift["command"]["failure_code"],
            "drifted_state_unchanged":
                drift["drifted_before_classification"]["state_projection_sha256"]
                == drift["drifted_after_classification"]["state_projection_sha256"],
            "restored_layout": drift["restored_classification"]["layout"],
        }),
        assertion_digest("FIRST_RENAME_FAULT_ROLLS_BACK", {
            "scenario_refs": [fault["scenario_sha256"]],
            "fault_derivation": fault["fault_derivation"],
            "barrier_observed": fault["barrier_observed"],
            "witness_topology": fault["witness_classification"]["topology"],
            "after_layout": fault["after_classification"]["layout"],
            "state_rolled_back": fault["before_classification"]["state_projection_sha256"]
                == fault["after_classification"]["state_projection_sha256"],
        }),
        assertion_digest(CALLER_RESULT_DISCARD_ASSERTION, {
            "scenario_refs": [response["scenario_sha256"]],
            "simulation_class": response["simulation_class"],
            "caller_result_discarded": response["caller_result_discarded"],
            "mutation_ack_parsed": response["mutation_ack_parsed"],
            "production_command_receipt_count": 1,
            "read_only_observation_count": 1,
            "after_layout": response["after_classification"]["layout"],
        }),
        assertion_digest("NO_PERSISTENT_MIXED_LAYOUT", {
            "scenario_refs": [item["scenario_sha256"] for item in scenarios],
            "stable_topologies": [
                success["before_classification"]["topology"],
                success["after_classification"]["topology"],
                repeat["after_classification"]["topology"],
                drift["restored_classification"]["topology"],
                fault["after_classification"]["topology"],
                response["after_classification"]["topology"],
            ],
            "mixed_stable_layout_count": 0,
        }),
        assertion_digest("EXISTING_RUNTIME_AND_PROTECTED_VOLUMES_UNCHANGED", {
            "scenario_refs": [item["scenario_sha256"] for item in scenarios],
            "before_fingerprint_sha256": before_fingerprint_sha256,
            "after_fingerprint_sha256": after_fingerprint_sha256,
            "cleanup_receipt_sha256": cleanup_receipt_sha256,
            "remaining_task_container_count": 0,
            "remaining_task_network_count": 0,
            "remaining_task_volume_count": 0,
        }),
    ]
    return values


def secure_file_sha256(path: Path, code: str) -> str:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError:
        reject(code)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 \
                or before.st_mode & 0o022 or before.st_size < 1:
            reject(code)
        hasher = hashlib.sha256()
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            hasher.update(chunk)
        after = os.fstat(descriptor)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) \
                != (after.st_dev, after.st_ino, after.st_size,
                    after.st_mtime_ns, after.st_ctime_ns):
            reject(code)
        return hasher.hexdigest()
    finally:
        os.close(descriptor)


def secure_text(path: Path, maximum: int, code: str) -> str:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError:
        reject(code)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 \
                or before.st_mode & 0o022 or not 1 <= before.st_size <= maximum:
            reject(code)
        raw = bytearray()
        while len(raw) < before.st_size:
            chunk = os.read(descriptor, before.st_size - len(raw))
            if not chunk:
                reject(code)
            raw.extend(chunk)
        after = os.fstat(descriptor)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) \
                != (after.st_dev, after.st_ino, after.st_size,
                    after.st_mtime_ns, after.st_ctime_ns):
            reject(code)
        return bytes(raw).decode("utf-8", "strict")
    except UnicodeDecodeError:
        reject(code)
    finally:
        os.close(descriptor)


def git_output(arguments: list[str], code: str) -> str:
    result = require_success(run_command([GIT, *arguments], timeout=30), code)
    return checked_text(result.stdout, code).strip()


def repository_source(policy: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, str]]]:
    tracked_status = git_output(
        [
            "status", "--porcelain=v1", "--untracked-files=all", "--", ".",
            f":(exclude){PROTECTED_REPORT}",
        ],
        "TASK70_DYNAMIC_GIT_STATUS_FAILED",
    )
    if tracked_status:
        reject("TASK70_DYNAMIC_TRACKED_WORKTREE_NOT_CLEAN")
    branch = git_output(["branch", "--show-current"], "TASK70_DYNAMIC_GIT_BRANCH_FAILED")
    if branch != "main":
        reject("TASK70_DYNAMIC_GIT_BRANCH_INVALID")
    commit = git_output(["rev-parse", "HEAD"], "TASK70_DYNAMIC_GIT_COMMIT_FAILED")
    tree = git_output(["rev-parse", "HEAD^{tree}"], "TASK70_DYNAMIC_GIT_TREE_FAILED")
    if re.fullmatch(r"[0-9a-f]{40}", commit) is None or re.fullmatch(r"[0-9a-f]{40}", tree) is None:
        reject("TASK70_DYNAMIC_GIT_IDENTITY_INVALID")
    package_raw = secure_text(SITE_ROOT / "package.json", 1024 * 1024,
                              "TASK70_DYNAMIC_PACKAGE_INVALID")
    try:
        application_version = json.loads(package_raw)["version"]
    except (json.JSONDecodeError, KeyError, TypeError):
        reject("TASK70_DYNAMIC_PACKAGE_INVALID")
    bindings = []
    for repository_path in policy["source_paths"]:
        path = REPOSITORY_ROOT / repository_path
        if not path.resolve().is_relative_to(REPOSITORY_ROOT):
            reject("TASK70_DYNAMIC_SOURCE_PATH_INVALID")
        current_sha = secure_file_sha256(path, "TASK70_DYNAMIC_SOURCE_FILE_INVALID")
        blob_sha = git_output(
            ["rev-parse", f"HEAD:{repository_path}"], "TASK70_DYNAMIC_SOURCE_NOT_COMMITTED",
        )
        if re.fullmatch(r"[0-9a-f]{40}", blob_sha) is None:
            reject("TASK70_DYNAMIC_SOURCE_NOT_COMMITTED")
        bindings.append({"path": repository_path, "sha256": current_sha, "git_blob": blob_sha})
    source = {
        "git_commit": commit,
        "git_tree": tree,
        "application_version": application_version,
        "migration_head": "0046_runtime_lock_privilege_boundary.sql",
    }
    return source, bindings


def validate_policy(policy: Any) -> dict[str, Any]:
    if not isinstance(policy, dict) or not SHA256.fullmatch(EXPECTED_POLICY_SHA256) \
            or digest_value(policy) != EXPECTED_POLICY_SHA256:
        reject("TASK70_DYNAMIC_POLICY_INVALID")
    return policy


def load_policy() -> dict[str, Any]:
    raw = secure_text(POLICY_PATH, 1024 * 1024, "TASK70_DYNAMIC_POLICY_INVALID")
    try:
        return validate_policy(json.loads(raw))
    except json.JSONDecodeError:
        reject("TASK70_DYNAMIC_POLICY_INVALID")


def validate_execution_host() -> None:
    if sys.flags.isolated != 1:
        reject("TASK70_DYNAMIC_PYTHON_ISOLATION_REQUIRED")
    if os.geteuid() != 0:
        reject("TASK70_DYNAMIC_ROOT_REQUIRED")
    os.umask(0o077)
    try:
        socket_stat = os.lstat("/var/run/docker.sock")
        docker_stat = os.lstat(DOCKER)
    except OSError:
        reject("TASK70_DYNAMIC_EXECUTION_HOST_INVALID")
    if not stat.S_ISSOCK(socket_stat.st_mode) or stat.S_ISLNK(socket_stat.st_mode) \
            or not stat.S_ISREG(docker_stat.st_mode) or docker_stat.st_uid != 0 \
            or docker_stat.st_mode & 0o022:
        reject("TASK70_DYNAMIC_EXECUTION_HOST_INVALID")
    if ARTIFACT_PATH.exists() or ARTIFACT_PATH.is_symlink():
        reject("TASK70_DYNAMIC_ARTIFACT_ALREADY_EXISTS")


def acquire_runner_lock() -> int:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(Path(__file__).resolve(), flags)
        opened = os.fstat(descriptor)
        named = os.stat(Path(__file__).resolve(), follow_symlinks=False)
        if not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1 \
                or (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino):
            reject("TASK70_DYNAMIC_RUNNER_LOCK_UNSAFE")
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return descriptor
    except (OSError, BlockingIOError):
        reject("TASK70_DYNAMIC_RUNNER_LOCK_BUSY")


def wait_postgres_ready(container_id: str, timeout_seconds: int = 60) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        result = docker_command([
            "exec", "--user", "999:999", "--env", "PGAPPNAME=cyd_dv70_readiness",
            "--", container_id, "pg_isready", "--quiet", "--host=/var/run/postgresql",
            "--port=5432", "--username=postgres", "--dbname=postgres",
        ], timeout=10)
        if result.returncode == 0:
            return
        inspected = docker_json(["inspect", container_id], "TASK70_DYNAMIC_READINESS_INSPECT_FAILED")
        state = inspected[0].get("State", {})
        if state.get("OOMKilled") or state.get("Running") is not True:
            reject("TASK70_DYNAMIC_POSTGRES_STOPPED_BEFORE_READY")
        time.sleep(1)
    reject("TASK70_DYNAMIC_POSTGRES_READINESS_TIMEOUT")


def task_network_names(policy: dict[str, Any], run_id: str) -> list[str]:
    result = require_success(docker_command([
        "network", "ls", "--quiet", "--filter",
        f"label={policy['cleanup_policy']['task_label']}={run_id}",
    ]), "TASK70_DYNAMIC_TASK_NETWORK_DISCOVERY_FAILED")
    return sorted({line.strip() for line in checked_text(
        result.stdout, "TASK70_DYNAMIC_TASK_NETWORK_DISCOVERY_FAILED",
    ).splitlines() if line.strip()})


def task_volume_names(policy: dict[str, Any], run_id: str) -> list[str]:
    result = require_success(docker_command([
        "volume", "ls", "--quiet", "--filter",
        f"label={policy['cleanup_policy']['task_label']}={run_id}",
    ]), "TASK70_DYNAMIC_TASK_VOLUME_DISCOVERY_FAILED")
    return sorted({line.strip() for line in checked_text(
        result.stdout, "TASK70_DYNAMIC_TASK_VOLUME_DISCOVERY_FAILED",
    ).splitlines() if line.strip()})


def create_temp_root() -> tuple[Path, str, str]:
    value = Path(tempfile.mkdtemp(prefix="cyd-dv70-pg-switch.", dir="/tmp"))
    suffix = value.name.rsplit(".", 1)[-1]
    run_id = f"dv70-{suffix}"
    opened = os.lstat(value)
    if value.parent != Path("/tmp") or re.fullmatch(r"[A-Za-z0-9_]{8}", suffix) is None \
            or not stat.S_ISDIR(opened.st_mode) or stat.S_IMODE(opened.st_mode) != 0o700 \
            or opened.st_uid != 0 or opened.st_gid != 0 or opened.st_nlink != 2:
        reject("TASK70_DYNAMIC_TEMP_ROOT_INVALID")
    return value, suffix, run_id


def remove_temp_root(path: Path) -> None:
    try:
        opened = os.lstat(path)
        if path.parent != Path("/tmp") or not stat.S_ISDIR(opened.st_mode) \
                or opened.st_uid != 0 or opened.st_gid != 0 or opened.st_nlink != 2 \
                or any(path.iterdir()):
            reject("TASK70_DYNAMIC_TEMP_ROOT_CLEANUP_INVALID")
        os.rmdir(path)
    except OSError:
        reject("TASK70_DYNAMIC_TEMP_ROOT_CLEANUP_FAILED")
    if path.exists() or path.is_symlink():
        reject("TASK70_DYNAMIC_TEMP_ROOT_CLEANUP_FAILED")


def publish_artifact(artifact: dict[str, Any], run_id: str) -> None:
    raw = json.dumps(artifact, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False).encode() + b"\n"
    if len(raw) > 1048576:
        reject("TASK70_DYNAMIC_ARTIFACT_TOO_LARGE")
    temporary = ARTIFACT_PATH.with_name(f".{ARTIFACT_PATH.name}.{run_id}.tmp")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    descriptor = None
    linked = False
    try:
        descriptor = os.open(temporary, flags, 0o400)
        offset = 0
        while offset < len(raw):
            offset += os.write(descriptor, raw[offset:])
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = None
        os.link(temporary, ARTIFACT_PATH, follow_symlinks=False)
        linked = True
        os.unlink(temporary)
        directory = os.open(ARTIFACT_PATH.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except OSError:
        reject("TASK70_DYNAMIC_ARTIFACT_PUBLISH_FAILED")
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if temporary.exists() and not linked:
            try:
                os.unlink(temporary)
            except OSError:
                pass
    opened = os.lstat(ARTIFACT_PATH)
    if not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1 \
            or stat.S_IMODE(opened.st_mode) != 0o400 or opened.st_uid != 0:
        reject("TASK70_DYNAMIC_ARTIFACT_PUBLISH_FAILED")


def require_classification(value: dict[str, Any], layout: str, topology_value: str) -> None:
    if value.get("layout") != layout or value.get("topology") != topology_value:
        reject("TASK70_DYNAMIC_LAYOUT_ASSERTION_FAILED")


def opcode_evidence(spec: dict[str, Any], sql: bytes) -> dict[str, Any]:
    if digest_bytes(sql) != spec.get("sql_sha256"):
        reject("TASK70_DYNAMIC_OPCODE_EVIDENCE_INVALID")
    return {
        "spec": spec,
        "sql_utf8_base64": base64.b64encode(sql).decode("ascii"),
    }


def run_business_case(
    *, executor: Any, fixture_module: Any, policy: dict[str, Any], source: dict[str, Any],
    container_id: str, image: dict[str, Any], monitor: ResourceMonitor,
) -> dict[str, Any]:
    setup_receipt = execute_fixture_sql(container_id, "fixture_setup", setup_sql(policy))
    guard_receipts = [verify_target_guard(container_id, policy)]
    identity = read_database_identity(container_id)
    placeholder = digest_bytes(b"task70-dynamic-before-observation-placeholder")
    prelim_base, prelim_observe_spec, _, prelim_observe_sql, _ = derive_specs(
        executor, fixture_module, identity=identity, container_id=container_id,
        image_reference=policy["case_catalog"][0]["postgres_image_reference"],
        image_id=image["id"], git_commit=source["git_commit"],
        application_version=source["application_version"],
        before_observation_sha256=placeholder,
    )
    baseline_observation, baseline_classification = observe_state(
        executor, container_id=container_id, base=prelim_base,
        restored_oid=identity["staging_oid"], observe_sql=prelim_observe_sql,
    )
    require_classification(baseline_classification, "OLD", "OLD_TOPOLOGY")
    base, observe_spec, switch_spec, observe_sql, switch_sql = derive_specs(
        executor, fixture_module, identity=identity, container_id=container_id,
        image_reference=policy["case_catalog"][0]["postgres_image_reference"],
        image_id=image["id"], git_commit=source["git_commit"],
        application_version=source["application_version"],
        before_observation_sha256=baseline_observation["observation_sha256"],
    )
    if base != prelim_base or observe_spec != prelim_observe_spec or observe_sql != prelim_observe_sql:
        reject("TASK70_DYNAMIC_SPEC_DERIVATION_UNSTABLE")
    restored_oid = identity["staging_oid"]
    scenarios: list[dict[str, Any]] = []
    reset_receipts: list[dict[str, Any]] = []

    monitor.raise_if_failed()
    guard_receipts.append(verify_target_guard(container_id, policy))
    success_command, success_ack = execute_production_switch(
        executor, container_id=container_id, sql=switch_sql, expected="success",
    )
    success_after, success_after_classification = observe_state(
        executor, container_id=container_id, base=base, restored_oid=restored_oid,
        observe_sql=observe_sql,
    )
    require_classification(success_after_classification, "NEW_SEALED", "NEW_TOPOLOGY")
    if success_ack is None:
        reject("TASK70_DYNAMIC_SUCCESS_ACK_MISSING")
    scenarios.append(scenario_digest({
        "scenario_id": "EXACT_SUCCESS",
        "before": baseline_observation,
        "before_classification": baseline_classification,
        "command": success_command,
        "mutation_ack": success_ack,
        "after": success_after,
        "after_classification": success_after_classification,
    }))

    monitor.raise_if_failed()
    guard_receipts.append(verify_target_guard(container_id, policy))
    repeat_before, repeat_before_classification = observe_state(
        executor, container_id=container_id, base=base, restored_oid=restored_oid,
        observe_sql=observe_sql,
    )
    require_classification(repeat_before_classification, "NEW_SEALED", "NEW_TOPOLOGY")
    repeat_command, _ = execute_production_switch(
        executor, container_id=container_id, sql=switch_sql, expected="precondition",
    )
    repeat_after, repeat_after_classification = observe_state(
        executor, container_id=container_id, base=base, restored_oid=restored_oid,
        observe_sql=observe_sql,
    )
    require_classification(repeat_after_classification, "NEW_SEALED", "NEW_TOPOLOGY")
    if repeat_before_classification["state_projection_sha256"] \
            != repeat_after_classification["state_projection_sha256"]:
        reject("TASK70_DYNAMIC_REPEAT_CHANGED_STATE")
    scenarios.append(scenario_digest({
        "scenario_id": "REPEAT_FAIL_CLOSED",
        "before": repeat_before,
        "before_classification": repeat_before_classification,
        "command": repeat_command,
        "after": repeat_after,
        "after_classification": repeat_after_classification,
    }))

    monitor.raise_if_failed()
    guard_receipts.append(verify_target_guard(container_id, policy))
    reset_receipts.append(execute_fixture_sql(
        container_id, "fixture_reset", reset_sql(base, restored_oid),
    ))
    reset_observation, reset_classification = observe_state(
        executor, container_id=container_id, base=base, restored_oid=restored_oid,
        observe_sql=observe_sql,
    )
    require_classification(reset_classification, "OLD", "OLD_TOPOLOGY")

    monitor.raise_if_failed()
    guard_receipts.append(verify_target_guard(container_id, policy))
    drift_before, drift_before_classification = observe_state(
        executor, container_id=container_id, base=base, restored_oid=restored_oid,
        observe_sql=observe_sql,
    )
    require_classification(drift_before_classification, "OLD", "OLD_TOPOLOGY")
    drift_apply = execute_fixture_sql(
        container_id, "fixture_drift_apply",
        marker_sql(base["databases"]["active_name"], DRIFT_MARKER),
    )
    drifted_before, drifted_before_classification = observe_state(
        executor, container_id=container_id, base=base, restored_oid=restored_oid,
        observe_sql=observe_sql,
    )
    require_classification(
        drifted_before_classification, "INVALID", "OLD_TOPOLOGY",
    )
    drift_command, _ = execute_production_switch(
        executor, container_id=container_id, sql=switch_sql, expected="precondition",
    )
    drifted_after, drifted_after_classification = observe_state(
        executor, container_id=container_id, base=base, restored_oid=restored_oid,
        observe_sql=observe_sql,
    )
    require_classification(
        drifted_after_classification, "INVALID", "OLD_TOPOLOGY",
    )
    if drifted_before_classification["state_projection_sha256"] \
            != drifted_after_classification["state_projection_sha256"]:
        reject("TASK70_DYNAMIC_DRIFT_REJECTION_CHANGED_STATE")
    drift_restore = execute_fixture_sql(
        container_id, "fixture_drift_restore",
        marker_sql(base["databases"]["active_name"], base["databases"]["candidate_marker"]),
    )
    drift_restored, drift_restored_classification = observe_state(
        executor, container_id=container_id, base=base, restored_oid=restored_oid,
        observe_sql=observe_sql,
    )
    require_classification(drift_restored_classification, "OLD", "OLD_TOPOLOGY")
    scenarios.append(scenario_digest({
        "scenario_id": "PRECONDITION_DRIFT_REJECTED",
        "before": drift_before,
        "before_classification": drift_before_classification,
        "drift_marker": DRIFT_MARKER,
        "drift_apply": drift_apply,
        "drifted_before": drifted_before,
        "drifted_before_classification": drifted_before_classification,
        "command": drift_command,
        "drifted_after": drifted_after,
        "drifted_after_classification": drifted_after_classification,
        "drift_restore": drift_restore,
        "restored": drift_restored,
        "restored_classification": drift_restored_classification,
    }))

    monitor.raise_if_failed()
    guard_receipts.append(verify_target_guard(container_id, policy))
    fault_before, fault_before_classification = observe_state(
        executor, container_id=container_id, base=base, restored_oid=restored_oid,
        observe_sql=observe_sql,
    )
    require_classification(fault_before_classification, "OLD", "OLD_TOPOLOGY")
    fault_sql, fault_boundary = derive_fault_stream(switch_sql, base)
    fault_command, fault_witness, fault_witness_classification = execute_fault_stream(
        container_id=container_id, fault_sql=fault_sql,
        observe_callback=lambda: observe_state(
            executor, container_id=container_id, base=base, restored_oid=restored_oid,
            observe_sql=observe_sql,
        ),
    )
    require_classification(fault_witness_classification, "OLD", "OLD_TOPOLOGY")
    fault_after, fault_after_classification = observe_state(
        executor, container_id=container_id, base=base, restored_oid=restored_oid,
        observe_sql=observe_sql,
    )
    require_classification(fault_after_classification, "OLD", "OLD_TOPOLOGY")
    if fault_before_classification["state_projection_sha256"] \
            != fault_after_classification["state_projection_sha256"]:
        reject("TASK70_DYNAMIC_FAULT_DID_NOT_ROLL_BACK")
    scenarios.append(scenario_digest({
        "scenario_id": "FIRST_RENAME_FAULT_ROLLBACK",
        "before": fault_before,
        "before_classification": fault_before_classification,
        "production_sql_sha256": digest_bytes(switch_sql),
        "fault_sql_sha256": digest_bytes(fault_sql),
        "fault_boundary_offset_bytes": fault_boundary,
        "fault_derivation": policy["case_catalog"][0]["fault_derivation"],
        "barrier": FAULT_BARRIER,
        "barrier_observed": True,
        "command": fault_command,
        "witness": fault_witness,
        "witness_classification": fault_witness_classification,
        "after": fault_after,
        "after_classification": fault_after_classification,
    }))

    monitor.raise_if_failed()
    guard_receipts.append(verify_target_guard(container_id, policy))
    response_before, response_before_classification = observe_state(
        executor, container_id=container_id, base=base, restored_oid=restored_oid,
        observe_sql=observe_sql,
    )
    require_classification(response_before_classification, "OLD", "OLD_TOPOLOGY")
    response_command, response_ack = execute_production_switch(
        executor, container_id=container_id, sql=switch_sql, expected="success",
        response_delivered=False,
    )
    if response_ack is not None:
        reject("TASK70_DYNAMIC_RESPONSE_LOSS_ACK_WAS_PARSED")
    response_after, response_after_classification = observe_state(
        executor, container_id=container_id, base=base, restored_oid=restored_oid,
        observe_sql=observe_sql,
    )
    require_classification(response_after_classification, "NEW_SEALED", "NEW_TOPOLOGY")
    scenarios.append(scenario_digest({
        "scenario_id": CALLER_RESULT_DISCARD_SCENARIO,
        "simulation_class": "CALLER_RESULT_DISCARDED_AFTER_EXACT_COMMAND_COMPLETION",
        "before": response_before,
        "before_classification": response_before_classification,
        "command": response_command,
        "caller_result_discarded": True,
        "mutation_ack_parsed": False,
        "after": response_after,
        "after_classification": response_after_classification,
    }))
    monitor.raise_if_failed()

    if [item["scenario_id"] for item in scenarios] \
            != policy["case_catalog"][0]["required_scenarios"]:
        reject("TASK70_DYNAMIC_SCENARIO_ORDER_INVALID")
    return {
        "base": base,
        "restored_oid": restored_oid,
        "identity": identity,
        "setup_receipt": setup_receipt,
        "reset_receipts": reset_receipts,
        "guard_receipts": guard_receipts,
        "observe_spec": observe_spec,
        "switch_spec": switch_spec,
        "observe_sql": observe_sql,
        "switch_sql": switch_sql,
        "scenarios": scenarios,
    }


def cleanup_receipt(
    *, policy: dict[str, Any], run_id: str, temp_root: Path,
    container_projection: dict[str, Any], removed_ids: list[str],
) -> dict[str, Any]:
    remaining_containers = task_label_container_ids(policy, run_id)
    remaining_networks = task_network_names(policy, run_id)
    remaining_volumes = task_volume_names(policy, run_id)
    body = {
        "task_label": f"{policy['cleanup_policy']['task_label']}={run_id}",
        "isolation_label": policy["cleanup_policy"]["isolation_label"],
        "created_containers": [{
            "id": container_projection["container_id"],
            "name": container_projection["name"],
            "labels": container_projection["labels"],
            "created_at": container_projection["created_at"],
        }],
        "created_networks": [],
        "created_volumes": [],
        "temp_roots": [str(temp_root)],
        "removed_container_ids": removed_ids,
        "remaining_containers": remaining_containers,
        "remaining_networks": remaining_networks,
        "remaining_volumes": remaining_volumes,
        "remaining_temp_roots": [] if not temp_root.exists() else [str(temp_root)],
        "process_group_remaining": 0,
        "result": "ZERO_TASK_RESIDUE" if not (
            remaining_containers or remaining_networks or remaining_volumes or temp_root.exists()
        ) else "RESIDUE_PRESENT",
    }
    if body["result"] != "ZERO_TASK_RESIDUE" or removed_ids != [container_projection["container_id"]]:
        reject("TASK70_DYNAMIC_CLEANUP_FAILED")
    return with_digest(body, "cleanup_receipt_sha256")


def build_coverage(policy: dict[str, Any]) -> dict[str, Any]:
    case = policy["case_catalog"][0]
    return {
        "stages": [{
            "id": identifier,
            "status": "PARTIAL" if identifier == case["stage_id"] else "MISSING",
        } for identifier in policy["required_stage_order"]],
        "checks": [{"id": identifier, "status": "MISSING"}
                   for identifier in policy["required_check_order"]],
        "status": "PARTIAL",
    }


def build_case(
    business: dict[str, Any], *, policy: dict[str, Any], before: dict[str, Any],
    after: dict[str, Any], cleanup: dict[str, Any],
) -> dict[str, Any]:
    policy_case = policy["case_catalog"][0]
    assertions = build_assertions(
        business["scenarios"], production_spec=business["switch_spec"],
        base=business["base"], restored_oid=business["restored_oid"],
        before_fingerprint_sha256=before["fingerprint_sha256"],
        after_fingerprint_sha256=after["fingerprint_sha256"],
        cleanup_receipt_sha256=cleanup["cleanup_receipt_sha256"],
    )
    if [item["id"] for item in assertions] != policy_case["required_assertions"]:
        reject("TASK70_DYNAMIC_ASSERTION_ORDER_INVALID")
    body = {
        "case_id": policy_case["case_id"],
        "evidence_class": policy_case["evidence_class"],
        "stage_id": policy_case["stage_id"],
        "stage_coverage": policy_case["stage_coverage"],
        "result": "PASS",
        "fixture": {
            "fixture_source_path": "chenyida_erp_site/tests/test_uat_promotion_rollback_fixed_executor.py",
            "base_spec": business["base"],
            "restored_oid": business["restored_oid"],
            "management_identity": business["identity"],
            "setup_receipt": business["setup_receipt"],
            "reset_receipts": business["reset_receipts"],
            "guard_receipts": business["guard_receipts"],
        },
        "opcodes": {
            "production": opcode_evidence(business["switch_spec"], business["switch_sql"]),
            "observation": opcode_evidence(business["observe_spec"], business["observe_sql"]),
        },
        "scenarios": business["scenarios"],
        "assertions": assertions,
    }
    return with_digest(body, "case_evidence_sha256")


def build_artifact(
    *, policy: dict[str, Any], run_id: str, started_at: str, source: dict[str, Any],
    source_bindings: list[dict[str, str]], image_before: dict[str, Any],
    image_after: dict[str, Any], docker_binary_sha256: str,
    create_arguments: list[str], container_projection: dict[str, Any],
    resource_evidence: dict[str, Any], object_before: dict[str, Any],
    object_after: dict[str, Any], business: dict[str, Any], cleanup: dict[str, Any],
) -> dict[str, Any]:
    if image_before != image_after or object_before != object_after:
        reject("TASK70_DYNAMIC_EXISTING_OBJECTS_CHANGED")
    case = build_case(
        business, policy=policy, before=object_before, after=object_after,
        cleanup=cleanup,
    )
    body = {
        "schema_version": 2,
        "contract": policy["artifact_contract"],
        "task_id": policy["task_id"],
        "run_id": run_id,
        "evidence_scope": policy["evidence_scope"],
        "deployment_class": policy["deployment_class"],
        "audit_clearance": policy["audit_clearance"],
        "started_at": started_at,
        "completed_at": utc_now(),
        "source": source,
        "source_bindings": source_bindings,
        "target_guard": policy["required_target_guard"],
        "runtime": {
            "platform": "linux/amd64",
            "postgres_image_reference": policy["case_catalog"][0]["postgres_image_reference"],
            "postgres_image_before": image_before,
            "postgres_image_after": image_after,
            "docker_binary_sha256": docker_binary_sha256,
            "container_limits": policy["case_catalog"][0]["container_limits"],
            "docker_create_arguments": create_arguments,
            "docker_create_arguments_sha256": digest_value(create_arguments),
            "container_inspect": container_projection,
            "build_performed": False,
            "pull_performed": False,
            "mounted_volume_names": [],
        },
        "resource_gate": resource_evidence,
        "object_protection": {
            "before": object_before,
            "after": object_after,
            "result": "UNCHANGED",
        },
        "cases": [case],
        "coverage": build_coverage(policy),
        "cleanup": cleanup,
        "non_claims": policy["required_non_claims"],
        "result": "PASS_PARTIAL",
    }
    return with_digest(body, "artifact_sha256")


def no_prior_task_residue(policy: dict[str, Any]) -> None:
    key = policy["cleanup_policy"]["task_label"]
    containers = docker_ids([
        "ps", "--all", "--quiet", "--no-trunc", "--filter", f"label={key}",
    ], "TASK70_DYNAMIC_PRIOR_CONTAINER_DISCOVERY_FAILED")
    network_result = require_success(docker_command([
        "network", "ls", "--quiet", "--filter", f"label={key}",
    ]), "TASK70_DYNAMIC_PRIOR_NETWORK_DISCOVERY_FAILED")
    volume_result = require_success(docker_command([
        "volume", "ls", "--quiet", "--filter", f"label={key}",
    ]), "TASK70_DYNAMIC_PRIOR_VOLUME_DISCOVERY_FAILED")
    networks = checked_text(network_result.stdout, "TASK70_DYNAMIC_PRIOR_NETWORK_DISCOVERY_FAILED").strip()
    volumes = checked_text(volume_result.stdout, "TASK70_DYNAMIC_PRIOR_VOLUME_DISCOVERY_FAILED").strip()
    if containers or networks or volumes:
        reject("TASK70_DYNAMIC_PRIOR_TASK_RESIDUE_PRESENT")


def execute_run() -> dict[str, Any]:
    validate_execution_host()
    lock_descriptor = acquire_runner_lock()
    temp_root: Path | None = None
    monitor: ResourceMonitor | None = None
    container_id: str | None = None
    container_projection: dict[str, Any] | None = None
    image: dict[str, Any] | None = None
    policy: dict[str, Any] | None = None
    run_id = ""
    container_name = ""
    removed_ids: list[str] = []
    completed_cleanup = False
    try:
        policy = load_policy()
        source, source_bindings = repository_source(policy)
        no_prior_task_residue(policy)
        temp_root, _, run_id = create_temp_root()
        container_name = f"cyd-dv70-pg-switch-{run_id}"
        started_at = utc_now()
        print(f"TASK70 DV70-PG-SWITCH-01 START run_id={run_id}", flush=True)
        image = image_projection(policy["case_catalog"][0]["postgres_image_reference"])
        docker_binary_sha256 = secure_file_sha256(Path(DOCKER), "TASK70_DYNAMIC_DOCKER_BINARY_INVALID")
        object_before = object_snapshot(policy["cleanup_policy"]["protected_volume_names"])
        monitor = ResourceMonitor(policy, object_before["services"])
        monitor.start()
        monitor.wait_for_window(policy["resource_policy"]["minimum_preflight_sample_window_seconds"])
        monitor.raise_if_failed()
        print("TASK70 RESOURCE PREFLIGHT PASS window=60s", flush=True)
        container_id, container_projection, create_arguments = create_task_container(
            policy, run_id, container_name, image,
        )
        monitor.raise_if_failed()
        started = docker_command(["start", container_id], timeout=30)
        if started.returncode != 0 or lines(
            started.stdout, CONTAINER_ID, "TASK70_DYNAMIC_TASK_CONTAINER_START_INVALID",
        ) != [container_id]:
            reject("TASK70_DYNAMIC_TASK_CONTAINER_START_FAILED")
        wait_postgres_ready(container_id)
        monitor.raise_if_failed()
        print("TASK70 ISOLATED POSTGRES READY version=17.10 network=none", flush=True)
        executor = load_module("task70_dynamic_fixed_executor", EXECUTOR_PATH)
        fixture_module = load_module("task70_dynamic_executor_fixture", FIXTURE_PATH)
        business = run_business_case(
            executor=executor, fixture_module=fixture_module, policy=policy, source=source,
            container_id=container_id, image=image, monitor=monitor,
        )
        print("TASK70 PG SWITCH SCENARIOS PASS count=5", flush=True)
        removed_ids = cleanup_task_container(
            container_id, policy=policy, run_id=run_id, container_name=container_name,
            image=image,
        )
        container_id = None
        completed_cleanup = True
        monitor.wait_for_window(policy["resource_policy"]["minimum_total_sample_window_seconds"])
        monitor.stop()
        resource_evidence = monitor.evidence()
        monitor = None
        object_after = object_snapshot(policy["cleanup_policy"]["protected_volume_names"])
        image_after = image_projection(policy["case_catalog"][0]["postgres_image_reference"])
        source_after, bindings_after = repository_source(policy)
        if source_after != source or bindings_after != source_bindings:
            reject("TASK70_DYNAMIC_SOURCE_CHANGED_DURING_RUN")
        remove_temp_root(temp_root)
        cleanup = cleanup_receipt(
            policy=policy, run_id=run_id, temp_root=temp_root,
            container_projection=container_projection, removed_ids=removed_ids,
        )
        temp_root = None
        artifact = build_artifact(
            policy=policy, run_id=run_id, started_at=started_at, source=source,
            source_bindings=source_bindings, image_before=image, image_after=image_after,
            docker_binary_sha256=docker_binary_sha256,
            create_arguments=create_arguments, container_projection=container_projection,
            resource_evidence=resource_evidence, object_before=object_before,
            object_after=object_after, business=business, cleanup=cleanup,
        )
        publish_artifact(artifact, run_id)
        print(
            f"TASK70 DYNAMIC EVIDENCE PUBLISHED artifact_sha256={artifact['artifact_sha256']}",
            flush=True,
        )
        return artifact
    finally:
        cleanup_error: DynamicPgSwitchError | None = None
        if container_id is not None and policy is not None and image is not None and run_id:
            try:
                cleanup_task_container(
                    container_id, policy=policy, run_id=run_id,
                    container_name=container_name, image=image,
                )
            except DynamicPgSwitchError as error:
                cleanup_error = error
        if monitor is not None:
            try:
                monitor.stop()
            except DynamicPgSwitchError as error:
                cleanup_error = cleanup_error or error
        if temp_root is not None and temp_root.exists():
            try:
                remove_temp_root(temp_root)
            except DynamicPgSwitchError as error:
                cleanup_error = cleanup_error or error
        os.close(lock_descriptor)
        if cleanup_error is not None:
            raise cleanup_error
        if completed_cleanup and container_id is not None:
            reject("TASK70_DYNAMIC_CLEANUP_STATE_INVALID")


def main(arguments: list[str]) -> int:
    if arguments != ["--execute"]:
        print("usage: uat-promotion-dynamic-pg-switch.py --execute", file=os.sys.stderr)
        return 2
    try:
        execute_run()
        return 0
    except DynamicPgSwitchError as error:
        print(error.code, file=os.sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(os.sys.argv[1:]))
