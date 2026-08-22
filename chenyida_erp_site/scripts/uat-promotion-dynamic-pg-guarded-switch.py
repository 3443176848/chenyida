#!/usr/bin/python3 -I
"""Produce TASK70 V3 evidence in one disposable PostgreSQL 17 cluster.

The producer is intentionally TEST-only.  It uses the already-present pinned
image, no network, no bind mount, no Docker volume and no published port.  The
resident ERP services and all protected volumes are observed but never targeted.
"""

from __future__ import annotations

import base64
import copy
import datetime as dt
import fcntl
import gzip
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import time
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SITE_ROOT = REPOSITORY_ROOT / "chenyida_erp_site"
POLICY_PATH = SITE_ROOT / "operations/uat-promotion-dynamic-validation-policy-v3.json"
ARTIFACT_PATH = SITE_ROOT / "operations/uat-promotion-dynamic-evidence-v3.json"
LEGACY_PRODUCER_PATH = SITE_ROOT / "scripts/uat-promotion-dynamic-pg-switch.py"
EXECUTOR_PATH = SITE_ROOT / "scripts/uat-promotion-rollback-fixed-executor.py"
FIXTURE_PATH = SITE_ROOT / "tests/test_uat_promotion_rollback_fixed_executor.py"
MIGRATION_ROOT = SITE_ROOT / "drizzle-postgres"
DOCKER = "/usr/bin/docker"
POLICY_EXPECTED_SHA256 = "192b1cab9ee7edd52786d6a14c906dfbec817ee189e64a714f6e8bf4b9ec773f"
CASE_ID = "DV70-PG-GUARDED-SWITCH-02"
FAULT_BARRIER = "DV70_V3_FIRST_RENAME_REACHED"
FIXED_EXECUTION_RECEIPT_CONTRACT = \
    "chenyida-erp-task70-v3-fixed-executor-psql-execution-receipt/v1"
FIXED_EXECUTION_ENVIRONMENT = {
    "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent",
}
SQL_EVIDENCE_MAX_BYTES = 1024 * 1024
SHA256 = re.compile(r"^[0-9a-f]{64}$")
HEX_IDENTIFIER = re.compile(r"^(?:[0-9a-f]{2}){1,4096}$")
OID = re.compile(r"^[1-9][0-9]{3,9}$")
CONTAINER_ID = re.compile(r"^[0-9a-f]{64}$")


def load_module(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("TASK70_V3_MODULE_LOAD_FAILED")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


LEGACY = load_module("task70_v3_legacy_helpers", LEGACY_PRODUCER_PATH)
EXECUTOR = load_module("task70_v3_fixed_executor", EXECUTOR_PATH)
FIXTURE = load_module("task70_v3_executor_fixture", FIXTURE_PATH)


class DynamicGuardedSwitchError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def reject(code: str) -> None:
    raise DynamicGuardedSwitchError(code)


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(
        timespec="milliseconds",
    ).replace("+00:00", "Z")


def utc_milliseconds(value: str, code: str) -> int:
    matched = re.fullmatch(
        r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z",
        value or "",
    )
    if matched is None:
        reject(code)
    try:
        whole = dt.datetime.strptime(
            matched.group(1), "%Y-%m-%dT%H:%M:%S",
        ).replace(tzinfo=dt.timezone.utc)
    except ValueError as error:
        raise DynamicGuardedSwitchError(code) from error
    fractional = (matched.group(2) or "")
    milliseconds = int((fractional + "000")[:3])
    return int(whole.timestamp()) * 1000 + milliseconds


def digest_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def digest_value(value: Any) -> str:
    return EXECUTOR.digest_value(value)


def with_digest(body: dict[str, Any], field: str) -> dict[str, Any]:
    return {**body, field: digest_value(body)}


def sql_normalization_roots(
        *, base: dict[str, Any], restored_oid: str,
        reconciliation: dict[str, Any], production: dict[str, Any],
        security_state: dict[str, Any], content_report_raw: bytes,
        migration_records: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "base": base,
        "fixture": {
            "restored_oid": restored_oid,
            "security_state": security_state,
            "content_report_rows": [line.split("\t") for line in
                                    content_report_raw[:-1].decode("utf-8").split("\n")],
        },
        "opcodes": {"reconciliation": reconciliation, "production": production},
        "source_documents": {
            "access": secure_json(
                SITE_ROOT / "operations/postgresql-runtime-privilege-access-v2.json",
                "TASK70_V3_SQL_NORMALIZATION_INVALID",
            ),
            "catalog": secure_json(
                SITE_ROOT / "operations/postgresql-runtime-privilege-compiled-catalog-v1.json",
                "TASK70_V3_SQL_NORMALIZATION_INVALID",
            ),
            "operator": secure_json(
                SITE_ROOT / "operations/postgresql-runtime-privilege-operator-policy-v1.json",
                "TASK70_V3_SQL_NORMALIZATION_INVALID",
            ),
            "policy": secure_json(
                SITE_ROOT / "operations/postgresql-runtime-privilege-policy-v2.json",
                "TASK70_V3_SQL_NORMALIZATION_INVALID",
            ),
        },
        "migration_records": [{
            "version": item["version"], "checksum": item["checksum"],
        } for item in migration_records],
    }


def content_report_hex_literals(
        roots: dict[str, Any], code: str,
) -> tuple[set[str], set[str]]:
    try:
        rows = roots["fixture"].get("content_report_rows")
    except (AttributeError, KeyError, TypeError) as error:
        raise DynamicGuardedSwitchError(code) from error
    if rows is None:
        return set(), set()
    if not isinstance(rows, list):
        reject(code)
    literals: set[str] = set()
    paths: set[str] = set()
    seen: set[tuple[str, str]] = set()
    large_objects = 0
    for row_index, fields in enumerate(rows):
        if not isinstance(fields, list) or any(
                not isinstance(field, str) for field in fields
        ):
            reject(code)
        kind = fields[0] if fields else ""
        identity = fields[1] if len(fields) > 1 else ""
        if kind == "RELATION" and len(fields) == 4:
            valid = HEX_IDENTIFIER.fullmatch(identity) is not None \
                and re.fullmatch(r"[0-9]+", fields[2]) is not None \
                and SHA256.fullmatch(fields[3]) is not None
            values = [identity]
            value_indexes = [1]
        elif kind == "SEQUENCE" and len(fields) == 4:
            valid = HEX_IDENTIFIER.fullmatch(identity) is not None \
                and re.fullmatch(r"-?[0-9]+", fields[2]) is not None \
                and fields[3] in {"true", "false", "t", "f"}
            values = [identity]
            value_indexes = [1]
        elif kind == "EXTENSION" and len(fields) == 4:
            valid = all(HEX_IDENTIFIER.fullmatch(field) is not None
                        for field in fields[1:])
            values = fields[1:]
            value_indexes = [1, 2, 3]
        elif kind == "LARGE_OBJECTS" and len(fields) == 4:
            large_objects += 1
            valid = large_objects == 1 \
                and re.fullmatch(r"[0-9]+", fields[1]) is not None \
                and re.fullmatch(r"[0-9]+", fields[2]) is not None \
                and SHA256.fullmatch(fields[3]) is not None
            values = []
            value_indexes = []
        else:
            valid = False
            values = []
            value_indexes = []
        row_identity = (kind, identity)
        if not valid or row_identity in seen:
            reject(code)
        seen.add(row_identity)
        literals.update(values)
        paths.update(
            f"roots.fixture.content_report_rows[{row_index}][{field_index}]"
            for field_index in value_indexes
        )
    if large_objects != 1:
        reject(code)
    return literals, paths


def replace_special_sql_slots(
        text: str, roots: dict[str, Any], sql_kind: str, code: str,
) -> str:
    if sql_kind == "GENERIC":
        return text
    if sql_kind not in {"RECONCILIATION", "PRODUCTION"}:
        reject(code)
    try:
        base = roots["base"]
        system_identifier = base["postgres"]["system_identifier"]
        databases = base["databases"]
        candidate_oid = databases["candidate_oid"]
        restored_oid = roots["fixture"]["restored_oid"]
    except (KeyError, TypeError) as error:
        raise DynamicGuardedSwitchError(code) from error
    values = (system_identifier, candidate_oid, restored_oid)
    if any(not isinstance(value, str) or not value for value in values):
        reject(code)

    def replace_one(pattern: str, label: str) -> None:
        nonlocal text
        matched = list(re.finditer(pattern, text))
        if len(matched) != 1:
            reject(code)
        start, end = matched[0].span("value")
        text = text[:start] + f"{{{{DV70:{label}}}}}" + text[end:]

    replace_one(
        rf"pg_control_system\(\)\)\s*<>\s*'"
        rf"(?P<value>{re.escape(system_identifier)})'",
        "SYSTEM_IDENTIFIER",
    )
    replace_one(
        rf"d\.datname='{re.escape(databases['staging_name'])}' AND "
        rf"d\.oid::text='(?P<value>{re.escape(restored_oid)})'",
        "RESTORED_OID",
    )
    if sql_kind == "PRODUCTION":
        replace_one(
            rf"d\.datname='{re.escape(databases['active_name'])}' AND "
            rf"d\.oid::text='(?P<value>{re.escape(candidate_oid)})'",
            "CANDIDATE_OID",
        )
        replace_one(
            rf'"target":\{{"database_oid":"'
            rf'(?P<value>{re.escape(restored_oid)})","marker_sha256":',
            "RESTORED_OID",
        )
    return text


def normalize_sql(
        raw: bytes, roots: dict[str, Any],
        code: str = "TASK70_V3_SQL_NORMALIZATION_INVALID",
        sql_kind: str = "GENERIC",
) -> bytes:
    try:
        text = raw.decode("utf-8", "strict")
    except (AttributeError, UnicodeError) as error:
        raise DynamicGuardedSwitchError(code) from error
    if not text.endswith("\n") or "\x00" in text or "{{DV70:" in text:
        reject(code)
    content_hex, content_hex_paths = content_report_hex_literals(roots, code)
    labels: dict[str, set[str]] = {}

    def collect(value: Any, path: str) -> None:
        if isinstance(value, dict):
            for key in sorted(value):
                collect(value[key], f"{path}.{key}")
        elif isinstance(value, list):
            for index, child in enumerate(value):
                collect(child, f"{path}[{index}]")
        elif isinstance(value, str) and SHA256.fullmatch(value) \
                and path not in content_hex_paths:
            labels.setdefault(value, set()).add(path)

    collect(roots, "roots")
    protected_values = sorted(item for item in content_hex if len(item) >= 64)
    protected_by_value = {
        value: f"{{{{DV70:CONTENT_HEX_LITERAL:{index}}}}}"
        for index, value in enumerate(protected_values)
    }
    text = re.sub(
        r"(?P<quote>['\"])(?P<value>[0-9a-f]{64,})(?P=quote)",
        lambda matched: matched.group("quote") + protected_by_value.get(
            matched.group("value"), matched.group("value"),
        ) + matched.group("quote"),
        text,
    )
    text = replace_special_sql_slots(text, roots, sql_kind, code)
    replacements: dict[str, str] = {}
    for value, paths in labels.items():
        if value == EXECUTOR.ZERO_SHA256:
            label = "ZERO_SHA256"
        elif value == digest_bytes(b""):
            label = "EMPTY_SHA256"
        elif len(paths) > 1:
            label = (
                f"PATH_SET_{len(paths)}_SHA256_"
                f"{digest_value(sorted(paths)).upper()}"
            )
        else:
            label = next(iter(paths))
        replacements[value] = f"{{{{DV70:{label}}}}}"
    text = re.sub(
        r"(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])",
        lambda matched: replacements.get(matched.group(0), matched.group(0)),
        text,
    )
    text = re.sub(
        r"\{\{DV70:CONTENT_HEX_LITERAL:([0-9]+)\}\}",
        lambda matched: protected_values[int(matched.group(1))]
        if int(matched.group(1)) < len(protected_values) else reject(code),
        text,
    )
    for matched in re.finditer(r"[0-9a-f]{64,}", text):
        value = matched.group(0)
        quoted = matched.start() > 0 and matched.end() < len(text) \
            and text[matched.start() - 1] in {"'", '"'} \
            and text[matched.end()] == text[matched.start() - 1]
        if not quoted or value not in content_hex:
            reject(code)
    return text.encode("utf-8")


def compressed_sql_evidence(
        raw: bytes, roots: dict[str, Any],
        code: str = "TASK70_V3_SQL_NORMALIZATION_INVALID",
        sql_kind: str = "GENERIC",
) -> dict[str, Any]:
    if not isinstance(raw, bytes) \
            or not 1 <= len(raw) <= SQL_EVIDENCE_MAX_BYTES:
        reject(code)
    normalized = normalize_sql(raw, roots, code, sql_kind)
    if not 1 <= len(normalized) <= SQL_EVIDENCE_MAX_BYTES:
        reject(code)
    compressed = gzip.compress(raw, compresslevel=9, mtime=0)
    if not 1 <= len(compressed) <= SQL_EVIDENCE_MAX_BYTES:
        reject(code)
    body = {
        "encoding": "GZIP_BASE64_MTIME_ZERO",
        "uncompressed_bytes": len(raw),
        "uncompressed_sha256": digest_bytes(raw),
        "normalized_sha256": digest_bytes(normalized),
        "gzip_bytes": len(compressed),
        "gzip_sha256": digest_bytes(compressed),
        "gzip_base64": base64.b64encode(compressed).decode("ascii"),
    }
    return {**body, "sql_evidence_sha256": digest_value(body)}


def validate_primary_sql_normalization(
        policy: dict[str, Any], reconciliation: dict[str, Any],
        production: dict[str, Any],
) -> None:
    if reconciliation.get("normalized_sha256") \
            != policy["sql_evidence"]["reconciliation_normalized_sha256"]:
        reject("TASK70_V3_RECONCILIATION_SQL_NORMALIZATION_INVALID")
    if production.get("normalized_sha256") \
            != policy["sql_evidence"]["production_normalized_sha256"]:
        reject("TASK70_V3_PRODUCTION_SQL_NORMALIZATION_INVALID")


def secure_json(path: Path, code: str) -> dict[str, Any]:
    try:
        raw = LEGACY.secure_text(path, 1024 * 1024, code)
        value = json.loads(raw)
    except (json.JSONDecodeError, LEGACY.DynamicPgSwitchError) as error:
        raise DynamicGuardedSwitchError(code) from error
    if not isinstance(value, dict):
        reject(code)
    return value


def load_policy() -> dict[str, Any]:
    policy = secure_json(POLICY_PATH, "TASK70_V3_POLICY_INVALID")
    if not SHA256.fullmatch(POLICY_EXPECTED_SHA256) \
            or digest_value(policy) != POLICY_EXPECTED_SHA256 \
            or policy.get("schema_version") != 3 \
            or policy.get("task_id") != "SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70" \
            or policy.get("production_opcode") != "PG_RB_GUARDED_SWITCH_V3" \
            or policy.get("source_paths") != sorted(policy.get("source_paths", [])) \
            or len(policy.get("case_catalog", [])) != 1 \
            or policy["case_catalog"][0].get("case_id") != CASE_ID:
        reject("TASK70_V3_POLICY_INVALID")
    return policy


def verify_source_commit_bindings(
        source: dict[str, Any], bindings: list[dict[str, str]],
        policy: dict[str, Any],
) -> None:
    paths = policy["source_paths"]
    if not isinstance(bindings, list) or len(bindings) != len(paths) \
            or [item.get("path") for item in bindings] != paths \
            or re.fullmatch(r"[0-9a-f]{40}", source.get("git_commit") or "") is None \
            or re.fullmatch(r"[0-9a-f]{40}", source.get("git_tree") or "") is None:
        reject("TASK70_V3_SOURCE_COMMIT_BINDING_INVALID")
    tree = LEGACY.git_output(
        ["rev-parse", f"{source['git_commit']}^{{tree}}"],
        "TASK70_V3_SOURCE_COMMIT_BINDING_INVALID",
    )
    if tree != source["git_tree"]:
        reject("TASK70_V3_SOURCE_COMMIT_BINDING_INVALID")
    for repository_path, binding in zip(paths, bindings, strict=True):
        if set(binding) != {"path", "sha256", "git_blob"} \
                or binding["path"] != repository_path \
                or SHA256.fullmatch(binding.get("sha256") or "") is None \
                or re.fullmatch(r"[0-9a-f]{40}", binding.get("git_blob") or "") is None:
            reject("TASK70_V3_SOURCE_COMMIT_BINDING_INVALID")
        path = REPOSITORY_ROOT / repository_path
        if not path.resolve().is_relative_to(REPOSITORY_ROOT) \
                or LEGACY.secure_file_sha256(
                    path, "TASK70_V3_SOURCE_COMMIT_BINDING_INVALID",
                ) != binding["sha256"]:
            reject("TASK70_V3_SOURCE_COMMIT_BINDING_INVALID")
        blob = LEGACY.git_output(
            ["rev-parse", f"{source['git_commit']}:{repository_path}"],
            "TASK70_V3_SOURCE_COMMIT_BINDING_INVALID",
        )
        result = LEGACY.run_command(
            [LEGACY.GIT, "cat-file", "blob", binding["git_blob"]],
            timeout=30, maximum_output=32 * 1024 * 1024,
        )
        if result.returncode != 0 or result.stderr \
                or blob != binding["git_blob"] \
                or digest_bytes(result.stdout) != binding["sha256"]:
            reject("TASK70_V3_SOURCE_COMMIT_BINDING_INVALID")


def integer(value: Any, code: str, *, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        reject(code)
    return value


class V3ResourceMonitor(LEGACY.ResourceMonitor):
    def start(self) -> None:
        self._capture()
        self.raise_if_failed()
        if len(self.samples) != 1:
            reject("TASK70_V3_RESOURCE_START_GATE_INVALID")
        first = self.samples[0]
        resource = self.policy["resource_policy"]
        selected_case = self.policy["case_catalog"][0]
        if first["available_memory_bytes"] \
                < resource["minimum_start_available_memory_bytes"] \
                or first["root_available_bytes"] \
                < resource["minimum_root_available_bytes"] \
                    + selected_case["maximum_disk_delta_bytes"]:
            reject("TASK70_V3_RESOURCE_START_GATE_FAILED")
        self.thread.start()


def normalize_resource_evidence(
        raw: dict[str, Any], policy: dict[str, Any], *,
        run_started_at: str, container_created_at: str,
) -> dict[str, Any]:
    code = "TASK70_V3_RESOURCE_EVIDENCE_INVALID"
    expected_raw_keys = {
        "boot_id_sha256", "sample_interval_seconds", "sample_count",
        "sample_window_seconds", "preflight_sample_window_seconds", "samples",
        "minimum_available_memory_bytes", "maximum_swap_percent_observed",
        "maximum_rolling_swap_growth_bytes", "minimum_root_available_bytes",
        "maximum_load1_observed", "oom_kill_delta", "service_restart_delta",
        "declared_maximum_disk_delta_bytes", "observed_peak_disk_delta_bytes",
        "result", "resource_evidence_sha256",
    }
    if not isinstance(raw, dict) or set(raw) != expected_raw_keys \
            or not SHA256.fullmatch(raw.get("resource_evidence_sha256") or ""):
        reject(code)
    raw_body = {key: value for key, value in raw.items()
                if key != "resource_evidence_sha256"}
    if LEGACY.digest_value(raw_body) != raw["resource_evidence_sha256"]:
        reject(code)
    resource = policy["resource_policy"]
    selected_case = policy["case_catalog"][0]
    wall_clock_tolerance = integer(
        resource.get("maximum_wall_clock_drift_milliseconds"), code, minimum=1,
    )
    if resource.get("require_wall_clock_elapsed_binding") is not True \
            or resource.get("require_preflight_before_container_creation") is not True:
        reject(code)
    run_started_ms = utc_milliseconds(run_started_at, code)
    container_created_ms = utc_milliseconds(container_created_at, code)
    if container_created_ms < run_started_ms:
        reject(code)
    samples = raw.get("samples")
    if not isinstance(samples, list) or len(samples) < 2:
        reject(code)
    normalized_samples: list[dict[str, Any]] = []
    service_names = policy["cleanup_policy"]["protected_service_names"]
    baseline_services: dict[str, dict[str, Any]] = {}
    previous_elapsed: int | None = None
    previous_captured_ms: int | None = None
    previous_oom: int | None = None
    captured_milliseconds: list[int] = []
    for sample in samples:
        if not isinstance(sample, dict) or set(sample) != {
                "captured_at", "elapsed_milliseconds", "available_memory_bytes",
                "swap_used_bytes", "swap_total_bytes", "root_available_bytes",
                "load1", "oom_kill_count", "services",
        } or re.fullmatch(
                r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z",
                sample.get("captured_at") or "",
        ) is None:
            reject(code)
        elapsed = integer(sample["elapsed_milliseconds"], code)
        captured_ms = utc_milliseconds(sample["captured_at"], code)
        available = integer(sample["available_memory_bytes"], code, minimum=1)
        swap_used = integer(sample["swap_used_bytes"], code)
        swap_total = integer(sample["swap_total_bytes"], code, minimum=1)
        root_available = integer(sample["root_available_bytes"], code, minimum=1)
        oom_count = integer(sample["oom_kill_count"], code)
        load1 = sample["load1"]
        if isinstance(load1, bool) or not isinstance(load1, (int, float)) \
                or not math.isfinite(load1) or load1 < 0:
            reject(code)
        load1_milli = int(round(load1 * 1000))
        if abs(load1_milli / 1000 - load1) > 0.000_000_1 \
                or swap_used > swap_total \
                or available < resource["minimum_available_memory_bytes"] \
                or swap_used * 100 \
                    > swap_total * resource["maximum_swap_percent"] \
                or root_available < resource["minimum_root_available_bytes"] \
                or load1_milli > resource["maximum_load1"] * 1000:
            reject(code)
        if previous_elapsed is not None:
            elapsed_delta = elapsed - previous_elapsed
            captured_delta = captured_ms - previous_captured_ms
            if elapsed_delta <= 0 \
                    or elapsed_delta > resource["maximum_sample_gap_seconds"] * 1000 \
                    or captured_delta <= 0 \
                    or captured_delta > resource["maximum_sample_gap_seconds"] * 1000 \
                        + wall_clock_tolerance \
                    or abs(captured_delta - elapsed_delta) > wall_clock_tolerance:
                reject(code)
        if previous_oom is not None and oom_count < previous_oom:
            reject(code)
        previous_elapsed = elapsed
        previous_captured_ms = captured_ms
        previous_oom = oom_count
        captured_milliseconds.append(captured_ms)
        services = sample["services"]
        if not isinstance(services, list) \
                or [item.get("service") for item in services] != service_names:
            reject(code)
        normalized_services = []
        for item in services:
            if not isinstance(item, dict) or set(item) != {
                    "service", "container_id", "restart_count", "oom_killed",
                    "running", "health",
            } or CONTAINER_ID.fullmatch(item.get("container_id") or "") is None \
                    or integer(item.get("restart_count"), code) < 0 \
                    or item.get("oom_killed") is not False \
                    or item.get("running") is not True \
                    or item.get("health") not in {"HEALTHY", "NONE"}:
                reject(code)
            projection = {
                "service": item["service"], "container_id": item["container_id"],
                "restart_count": item["restart_count"],
                "oom_killed": False, "running": True, "health": item["health"],
            }
            if not baseline_services:
                pass
            elif item["service"] not in baseline_services \
                    or projection != baseline_services[item["service"]]:
                reject(code)
            normalized_services.append(projection)
        if not baseline_services:
            baseline_services = {
                item["service"]: item for item in normalized_services
            }
        normalized_samples.append({
            "captured_at": sample["captured_at"],
            "elapsed_milliseconds": elapsed,
            "available_memory_bytes": available,
            "swap_used_bytes": swap_used,
            "swap_total_bytes": swap_total,
            "root_available_bytes": root_available,
            "load1_milli": load1_milli,
            "oom_kill_count": oom_count,
            "services": normalized_services,
        })
    first = normalized_samples[0]
    first_captured_ms = captured_milliseconds[0]
    last_captured_ms = captured_milliseconds[-1]
    elapsed_window_ms = normalized_samples[-1]["elapsed_milliseconds"] \
        - first["elapsed_milliseconds"]
    wall_window_ms = last_captured_ms - first_captured_ms
    window_seconds = (
        elapsed_window_ms
    ) // 1000
    preflight_indexes = [
        index for index, captured_ms in enumerate(captured_milliseconds)
        if captured_ms <= container_created_ms
    ]
    if not preflight_indexes:
        reject(code)
    preflight_index = preflight_indexes[-1]
    preflight_elapsed_ms = normalized_samples[preflight_index]["elapsed_milliseconds"] \
        - first["elapsed_milliseconds"]
    preflight_wall_ms = captured_milliseconds[preflight_index] - first_captured_ms
    minimum_preflight_ms = resource["minimum_preflight_sample_window_seconds"] * 1000
    minimum_total_ms = resource["minimum_total_sample_window_seconds"] * 1000
    if first["available_memory_bytes"] \
            < resource["minimum_start_available_memory_bytes"] \
            or first["root_available_bytes"] \
            < resource["minimum_root_available_bytes"] \
                + selected_case["maximum_disk_delta_bytes"] \
            or window_seconds < resource["minimum_total_sample_window_seconds"] \
            or raw["sample_interval_seconds"] != resource["sample_interval_seconds"] \
            or raw["sample_count"] != len(samples) \
            or raw["sample_window_seconds"] != window_seconds \
            or raw["preflight_sample_window_seconds"] \
                != resource["minimum_preflight_sample_window_seconds"] \
            or first_captured_ms < run_started_ms \
            or container_created_ms < first_captured_ms \
            or container_created_ms > last_captured_ms \
            or preflight_elapsed_ms < minimum_preflight_ms \
            or preflight_wall_ms < minimum_preflight_ms - wall_clock_tolerance \
            or container_created_ms - first_captured_ms \
                < minimum_preflight_ms - wall_clock_tolerance \
            or wall_window_ms < minimum_total_ms - wall_clock_tolerance \
            or abs(wall_window_ms - elapsed_window_ms) > wall_clock_tolerance:
        reject(code)
    minimum_window_ms = resource["minimum_swap_sample_window_seconds"] * 1000
    maximum_gap_ms = resource["maximum_sample_gap_seconds"] * 1000
    maximum_swap_growth = 0
    for index, current in enumerate(normalized_samples):
        eligible = [previous for previous in normalized_samples[:index]
                    if minimum_window_ms <= current["elapsed_milliseconds"]
                    - previous["elapsed_milliseconds"]
                    <= minimum_window_ms + maximum_gap_ms]
        if eligible:
            maximum_swap_growth = max(
                maximum_swap_growth,
                max(0, current["swap_used_bytes"] - eligible[-1]["swap_used_bytes"]),
            )
    minimum_memory = min(item["available_memory_bytes"] for item in normalized_samples)
    minimum_root = min(item["root_available_bytes"] for item in normalized_samples)
    maximum_load_milli = max(item["load1_milli"] for item in normalized_samples)
    maximum_swap_basis_points = max(
        (item["swap_used_bytes"] * 10_000 + item["swap_total_bytes"] - 1)
        // item["swap_total_bytes"] for item in normalized_samples
    )
    oom_delta = max(item["oom_kill_count"] for item in normalized_samples) \
        - first["oom_kill_count"]
    restart_sums = [sum(item["restart_count"] for item in sample["services"])
                    for sample in normalized_samples]
    restart_delta = max(restart_sums) - restart_sums[0]
    observed_disk_delta = max(
        0, first["root_available_bytes"] - minimum_root,
    )
    if raw["minimum_available_memory_bytes"] != minimum_memory \
            or raw["minimum_root_available_bytes"] != minimum_root \
            or raw["maximum_load1_observed"] \
                != max(item["load1"] for item in samples) \
            or raw["maximum_rolling_swap_growth_bytes"] != maximum_swap_growth \
            or raw["oom_kill_delta"] != oom_delta \
            or raw["service_restart_delta"] != restart_delta \
            or raw["observed_peak_disk_delta_bytes"] != observed_disk_delta \
            or raw["declared_maximum_disk_delta_bytes"] \
                != selected_case["maximum_disk_delta_bytes"] \
            or raw["result"] != "PASS" \
            or maximum_swap_growth > resource["maximum_swap_growth_bytes"] \
            or observed_disk_delta > selected_case["maximum_disk_delta_bytes"] \
            or resource["require_zero_oom_kill_delta"] is not True \
            or resource["require_zero_service_restart_delta"] is not True \
            or oom_delta != 0 or restart_delta != 0:
        reject(code)
    expected_swap_percent = max(
        item["swap_used_bytes"] / item["swap_total_bytes"] * 100
        for item in samples
    )
    if raw["maximum_swap_percent_observed"] != expected_swap_percent:
        reject(code)
    body = {
        "boot_id_sha256": raw["boot_id_sha256"],
        "sample_interval_seconds": resource["sample_interval_seconds"],
        "sample_count": len(normalized_samples),
        "sample_window_seconds": window_seconds,
        "preflight_sample_window_seconds":
            resource["minimum_preflight_sample_window_seconds"],
        "samples": normalized_samples,
        "minimum_available_memory_bytes": minimum_memory,
        "maximum_swap_basis_points_observed": maximum_swap_basis_points,
        "maximum_rolling_swap_growth_bytes": maximum_swap_growth,
        "minimum_root_available_bytes": minimum_root,
        "maximum_load1_milli_observed": maximum_load_milli,
        "oom_kill_delta": oom_delta,
        "service_restart_delta": restart_delta,
        "declared_maximum_disk_delta_bytes":
            selected_case["maximum_disk_delta_bytes"],
        "observed_peak_disk_delta_bytes": observed_disk_delta,
        "result": "PASS",
    }
    return with_digest(body, "resource_evidence_sha256")


def reject_float_numbers(value: Any) -> None:
    if isinstance(value, float):
        reject("TASK70_V3_ARTIFACT_NUMERIC_DOMAIN_INVALID")
    if isinstance(value, dict):
        for child in value.values():
            reject_float_numbers(child)
    elif isinstance(value, list):
        for child in value:
            reject_float_numbers(child)


def validate_execution_host() -> None:
    if sys.flags.isolated != 1 or os.geteuid() != 0:
        reject("TASK70_V3_EXECUTION_HOST_INVALID")
    os.umask(0o077)
    try:
        socket_meta = os.lstat("/var/run/docker.sock")
        docker_meta = os.lstat(DOCKER)
    except OSError as error:
        raise DynamicGuardedSwitchError("TASK70_V3_EXECUTION_HOST_INVALID") from error
    if not stat.S_ISSOCK(socket_meta.st_mode) or stat.S_ISLNK(socket_meta.st_mode) \
            or not stat.S_ISREG(docker_meta.st_mode) or docker_meta.st_uid != 0 \
            or docker_meta.st_mode & 0o022 \
            or ARTIFACT_PATH.exists() or ARTIFACT_PATH.is_symlink():
        reject("TASK70_V3_EXECUTION_HOST_INVALID")
    for historical in (
        SITE_ROOT / "operations/uat-promotion-dynamic-validation-policy-v2.json",
        SITE_ROOT / "operations/uat-promotion-dynamic-evidence-v2.json",
    ):
        if not historical.is_file() or historical.is_symlink():
            reject("TASK70_V3_HISTORICAL_V2_MISSING")


def acquire_runner_lock() -> int:
    path = Path(__file__).resolve()
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        opened = os.fstat(descriptor)
        named = os.stat(path, follow_symlinks=False)
        if not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1 \
                or (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino):
            reject("TASK70_V3_RUNNER_LOCK_UNSAFE")
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return descriptor
    except (OSError, BlockingIOError) as error:
        raise DynamicGuardedSwitchError("TASK70_V3_RUNNER_LOCK_BUSY") from error


def v3_expected_labels(policy: dict[str, Any], run_id: str) -> dict[str, str]:
    isolation = policy["cleanup_policy"]["isolation_label"]
    if isolation != "chenyida.erp.execution-scope=isolated-synthetic-v3-test" \
            or re.fullmatch(r"dv70-[A-Za-z0-9_]{8}", run_id or "") is None:
        reject("TASK70_V3_TASK_CONTAINER_IDENTITY_INVALID")
    key, value = isolation.split("=", 1)
    return {
        policy["cleanup_policy"]["task_label"]: run_id,
        key: value,
    }


def validate_v3_container_name(container_name: str) -> None:
    if re.fullmatch(
            r"cyd-dv70-pg-v3-dv70-[A-Za-z0-9_]{8}", container_name or "",
    ) is None:
        reject("TASK70_V3_TASK_CONTAINER_NAME_INVALID")


def v3_task_label_container_ids(policy: dict[str, Any], run_id: str) -> list[str]:
    v3_expected_labels(policy, run_id)
    return LEGACY.docker_ids([
        "ps", "--all", "--quiet", "--no-trunc", "--filter",
        f"label={policy['cleanup_policy']['task_label']}={run_id}",
    ], "TASK70_V3_TASK_CONTAINER_DISCOVERY_FAILED")


def v3_task_name_container_ids(container_name: str) -> list[str]:
    validate_v3_container_name(container_name)
    return LEGACY.docker_ids([
        "ps", "--all", "--quiet", "--no-trunc", "--filter",
        f"name=^/{container_name}$",
    ], "TASK70_V3_TASK_CONTAINER_RECONCILE_FAILED")


def v3_task_owned_container_ids(
        policy: dict[str, Any], run_id: str, container_name: str,
) -> list[str]:
    validate_v3_container_name(container_name)
    v3_expected_labels(policy, run_id)
    return LEGACY.docker_ids([
        "ps", "--all", "--quiet", "--no-trunc",
        "--filter", f"name=^/{container_name}$",
        "--filter", f"label={policy['cleanup_policy']['task_label']}={run_id}",
        "--filter", f"label={policy['cleanup_policy']['isolation_label']}",
    ], "TASK70_V3_TASK_CONTAINER_RECONCILE_FAILED")


def enumerate_prefixed_entries(parent: Path, prefix: str) -> list[str]:
    """Enumerate one fixed directory without following a parent or child symlink."""
    if not parent.is_absolute() or parent == Path("/") \
            or re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", prefix or "") is None:
        reject("TASK70_V3_TEMP_ROOT_DISCOVERY_INVALID")
    descriptor: int | None = None
    try:
        named = os.stat(parent, follow_symlinks=False)
        descriptor = os.open(
            parent,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
        )
        opened = os.fstat(descriptor)
        if not stat.S_ISDIR(named.st_mode) or stat.S_ISLNK(named.st_mode) \
                or named.st_uid != 0 \
                or (named.st_dev, named.st_ino) != (opened.st_dev, opened.st_ino):
            reject("TASK70_V3_TEMP_ROOT_DISCOVERY_INVALID")
        result = []
        for name in sorted(os.listdir(descriptor)):
            if not name.startswith(prefix):
                continue
            os.stat(name, dir_fd=descriptor, follow_symlinks=False)
            result.append(str(parent / name))
        after = os.fstat(descriptor)
        if (opened.st_dev, opened.st_ino) != (after.st_dev, after.st_ino):
            reject("TASK70_V3_TEMP_ROOT_DISCOVERY_INVALID")
        return result
    except (OSError, UnicodeError) as error:
        raise DynamicGuardedSwitchError(
            "TASK70_V3_TEMP_ROOT_DISCOVERY_INVALID",
        ) from error
    finally:
        if descriptor is not None:
            os.close(descriptor)


def v3_task_temp_roots(policy: dict[str, Any]) -> list[str]:
    cleanup = policy.get("cleanup_policy") or {}
    if cleanup.get("temp_root_parent") != "/tmp" \
            or cleanup.get("temp_root_prefix") != "cyd-dv70-pg-switch.":
        reject("TASK70_V3_TEMP_ROOT_DISCOVERY_INVALID")
    return enumerate_prefixed_entries(
        Path(cleanup["temp_root_parent"]), cleanup["temp_root_prefix"],
    )


def v3_all_task_docker_residue(policy: dict[str, Any]) -> dict[str, list[str]]:
    key = policy["cleanup_policy"]["task_label"]
    if key != "chenyida.erp.task70-v3-run-id":
        reject("TASK70_V3_TASK_RESIDUE_DISCOVERY_INVALID")
    containers = LEGACY.docker_ids([
        "ps", "--all", "--quiet", "--no-trunc", "--filter", f"label={key}",
    ], "TASK70_V3_TASK_RESIDUE_DISCOVERY_INVALID")
    network_result = LEGACY.require_success(LEGACY.docker_command([
        "network", "ls", "--quiet", "--filter", f"label={key}",
    ]), "TASK70_V3_TASK_RESIDUE_DISCOVERY_INVALID")
    volume_result = LEGACY.require_success(LEGACY.docker_command([
        "volume", "ls", "--quiet", "--filter", f"label={key}",
    ]), "TASK70_V3_TASK_RESIDUE_DISCOVERY_INVALID")
    networks = sorted({line.strip() for line in LEGACY.checked_text(
        network_result.stdout, "TASK70_V3_TASK_RESIDUE_DISCOVERY_INVALID",
    ).splitlines() if line.strip()})
    volumes = sorted({line.strip() for line in LEGACY.checked_text(
        volume_result.stdout, "TASK70_V3_TASK_RESIDUE_DISCOVERY_INVALID",
    ).splitlines() if line.strip()})
    return {
        "containers": containers, "networks": networks, "volumes": volumes,
    }


def v3_preflight_task_residue(policy: dict[str, Any]) -> dict[str, list[str]]:
    residue = {
        **v3_all_task_docker_residue(policy),
        "temp_roots": v3_task_temp_roots(policy),
    }
    if any(residue.values()):
        reject("TASK70_V3_PRIOR_TASK_RESIDUE_PRESENT")
    return residue


def v3_cleanup_receipt(
        *, policy: dict[str, Any], run_id: str, temp_root: Path,
        container_projection: dict[str, Any], removed_ids: list[str],
        preexisting_residue: dict[str, list[str]],
) -> dict[str, Any]:
    remaining = {
        **v3_all_task_docker_residue(policy),
        "temp_roots": v3_task_temp_roots(policy),
    }
    body = {
        "task_label": f"{policy['cleanup_policy']['task_label']}={run_id}",
        "isolation_label": policy["cleanup_policy"]["isolation_label"],
        "discovery_scope": {
            "task_label_key": policy["cleanup_policy"]["task_label"],
            "temp_root_parent": policy["cleanup_policy"]["temp_root_parent"],
            "temp_root_prefix": policy["cleanup_policy"]["temp_root_prefix"],
        },
        "preexisting_residue": preexisting_residue,
        "created_containers": [{
            "id": container_projection["container_id"],
            "name": container_projection["name"],
            "labels": container_projection["labels"],
            "created_at": container_projection["created_at"],
        }],
        "created_networks": [], "created_volumes": [],
        "temp_roots": [str(temp_root)],
        "removed_container_ids": removed_ids,
        "remaining_containers": remaining["containers"],
        "remaining_networks": remaining["networks"],
        "remaining_volumes": remaining["volumes"],
        "remaining_temp_roots": remaining["temp_roots"],
        "process_group_remaining": 0,
        "result": "ZERO_TASK_RESIDUE" if not any(remaining.values())
        else "RESIDUE_PRESENT",
    }
    if body["result"] != "ZERO_TASK_RESIDUE" \
            or any(preexisting_residue.values()) \
            or removed_ids != [container_projection["container_id"]]:
        reject("TASK70_V3_CLEANUP_FAILED")
    return with_digest(body, "cleanup_receipt_sha256")


def v3_task_container_projection(
        item: dict[str, Any], *, policy: dict[str, Any], run_id: str,
        container_name: str, image: dict[str, Any],
) -> dict[str, Any]:
    validate_v3_container_name(container_name)
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
    except (KeyError, TypeError, AttributeError) as error:
        raise DynamicGuardedSwitchError(
            "TASK70_V3_TASK_CONTAINER_INSPECT_INVALID",
        ) from error
    try:
        normalized_tmpfs = {
            target: LEGACY.normalize_tmpfs_options(
                options, "TASK70_V3_TASK_CONTAINER_TMPFS_INVALID",
            )
            for target, options in sorted(tmpfs.items())
        }
    except LEGACY.DynamicPgSwitchError as error:
        raise DynamicGuardedSwitchError(error.code) from error
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
    if CONTAINER_ID.fullmatch(identifier or "") is None \
            or projection["name"] != container_name \
            or projection["labels"] != v3_expected_labels(policy, run_id) \
            or projection["image_id"] != image["id"] \
            or projection["image_reference"] != case["postgres_image_reference"] \
            or projection["user"] != limits["user"] \
            or projection["network_mode"] != limits["network_mode"] \
            or projection["rootfs_read_only"] is not True \
            or projection["cap_drop"] != ["ALL"] or projection["cap_add"] != [] \
            or projection["security_opt"] != ["no-new-privileges"] \
            or projection["restart_policy"] != "no" \
            or projection["privileged"] is not False \
            or projection["memory_bytes"] != limits["memory_bytes"] \
            or projection["memory_swap_bytes"] != limits["memory_swap_bytes"] \
            or projection["nano_cpus"] != 1_000_000_000 \
            or projection["pids"] != limits["pids"] \
            or projection["shared_memory_bytes"] != limits["shared_memory_bytes"] \
            or projection["stop_timeout_seconds"] != limits["stop_timeout_seconds"] \
            or projection["log_driver"] != "none" \
            or projection["devices"] != [] or projection["binds"] != [] \
            or projection["mounts"] != [] or projection["published_ports"] != {} \
            or projection["publish_all_ports"] is not False \
            or projection["tmpfs"] != limits["tmpfs"] \
            or projection["synthetic_trust_auth"] is not True \
            or projection["initdb_args"] != "--encoding=UTF8 --locale=C" \
            or projection["pgdata"] != "/var/lib/postgresql/data/pgdata" \
            or projection["command"] != [
                "postgres", "-c", "listen_addresses=*", "-c",
                "unix_socket_directories=/var/run/postgresql", "-c",
                "max_connections=20", "-c", "shared_buffers=64MB", "-c",
                "log_statement=none",
            ] \
            or not isinstance(projection["created_at"], str) \
            or not projection["created_at"]:
        reject("TASK70_V3_TASK_CONTAINER_INSPECT_INVALID")
    return projection


def v3_inspect_task_container(
        identifier: str, *, policy: dict[str, Any], run_id: str,
        container_name: str, image: dict[str, Any],
) -> dict[str, Any]:
    value = LEGACY.docker_json(
        ["inspect", identifier], "TASK70_V3_TASK_CONTAINER_INSPECT_FAILED",
    )
    if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
        reject("TASK70_V3_TASK_CONTAINER_INSPECT_FAILED")
    return v3_task_container_projection(
        value[0], policy=policy, run_id=run_id,
        container_name=container_name, image=image,
    )


def v3_cleanup_identity_projection(
        item: dict[str, Any], *, policy: dict[str, Any], run_id: str,
        container_name: str, image: dict[str, Any],
) -> dict[str, Any]:
    validate_v3_container_name(container_name)
    try:
        identifier = item["Id"]
        config = item["Config"]
        state = item["State"]
        labels = config.get("Labels") or {}
    except (KeyError, TypeError, AttributeError) as error:
        raise DynamicGuardedSwitchError(
            "TASK70_V3_CLEANUP_IDENTITY_INVALID",
        ) from error
    projection = {
        "container_id": identifier,
        "name": str(item.get("Name", "")).lstrip("/"),
        "labels": dict(sorted(labels.items())),
        "image_id": item.get("Image"),
        "image_reference": config.get("Image"),
        "running": state.get("Running"),
    }
    if CONTAINER_ID.fullmatch(identifier or "") is None \
            or projection["name"] != container_name \
            or projection["labels"] != v3_expected_labels(policy, run_id) \
            or projection["image_id"] != image["id"] \
            or projection["image_reference"] \
                != policy["case_catalog"][0]["postgres_image_reference"] \
            or not isinstance(projection["running"], bool):
        reject("TASK70_V3_CLEANUP_IDENTITY_INVALID")
    return projection


def v3_inspect_cleanup_identity(
        identifier: str, *, policy: dict[str, Any], run_id: str,
        container_name: str, image: dict[str, Any],
) -> dict[str, Any]:
    value = LEGACY.docker_json(
        ["inspect", identifier], "TASK70_V3_CLEANUP_INSPECT_FAILED",
    )
    if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
        reject("TASK70_V3_CLEANUP_INSPECT_FAILED")
    return v3_cleanup_identity_projection(
        value[0], policy=policy, run_id=run_id,
        container_name=container_name, image=image,
    )


def v3_reconcile_cleanup_identity(
        identifier: str, *, policy: dict[str, Any], run_id: str,
        container_name: str, image: dict[str, Any],
) -> dict[str, Any] | None:
    last_error: BaseException | None = None
    for attempt in range(3):
        try:
            inspected = LEGACY.docker_command(["inspect", identifier], timeout=20)
            if inspected.returncode == 0:
                value = LEGACY.parse_json_output(
                    inspected.stdout, "TASK70_V3_CLEANUP_INSPECT_FAILED",
                )
                if not isinstance(value, list) or len(value) != 1 \
                        or not isinstance(value[0], dict):
                    reject("TASK70_V3_CLEANUP_INSPECT_FAILED")
                identity = v3_cleanup_identity_projection(
                    value[0], policy=policy, run_id=run_id,
                    container_name=container_name, image=image,
                )
                if v3_task_label_container_ids(policy, run_id) != [identifier] \
                        or v3_task_name_container_ids(container_name) != [identifier]:
                    reject("TASK70_V3_CLEANUP_CONTAINER_IDENTITY_DRIFT")
                return identity
            labelled = v3_task_label_container_ids(policy, run_id)
            named = v3_task_name_container_ids(container_name)
            if not labelled and not named:
                return None
            if labelled != [identifier] or named != [identifier]:
                reject("TASK70_V3_CLEANUP_CONTAINER_IDENTITY_DRIFT")
        except (DynamicGuardedSwitchError, LEGACY.DynamicPgSwitchError) as error:
            last_error = error
        if attempt < 2:
            time.sleep(1)
    raise DynamicGuardedSwitchError("TASK70_V3_CLEANUP_STATE_UNVERIFIED") from last_error


def v3_cleanup_task_container(
        identifier: str | None, *, policy: dict[str, Any], run_id: str,
        container_name: str, image: dict[str, Any], allow_absent: bool = False,
) -> list[str]:
    if identifier is None:
        if v3_task_label_container_ids(policy, run_id):
            reject("TASK70_V3_CLEANUP_UNOWNED_CONTAINER")
        return []
    if CONTAINER_ID.fullmatch(identifier or "") is None:
        reject("TASK70_V3_CLEANUP_IDENTITY_INVALID")
    identity = v3_reconcile_cleanup_identity(
        identifier, policy=policy, run_id=run_id,
        container_name=container_name, image=image,
    )
    if identity is None:
        if allow_absent:
            return []
        reject("TASK70_V3_CLEANUP_CONTAINER_MISSING")
    if identity["running"]:
        for attempt in range(2):
            try:
                LEGACY.docker_command([
                    "stop", "--timeout",
                    str(policy["case_catalog"][0]["container_limits"][
                        "stop_timeout_seconds"
                    ]), identifier,
                ], timeout=20)
            except LEGACY.DynamicPgSwitchError:
                pass
            identity = v3_reconcile_cleanup_identity(
                identifier, policy=policy, run_id=run_id,
                container_name=container_name, image=image,
            )
            if identity is None:
                reject("TASK70_V3_CLEANUP_STOP_STATE_INVALID")
            if identity["running"] is False:
                break
            if attempt == 1:
                reject("TASK70_V3_CLEANUP_STOP_FAILED")
    for attempt in range(2):
        try:
            LEGACY.docker_command(["rm", identifier], timeout=20)
        except LEGACY.DynamicPgSwitchError:
            pass
        identity = v3_reconcile_cleanup_identity(
            identifier, policy=policy, run_id=run_id,
            container_name=container_name, image=image,
        )
        if identity is None:
            return [identifier]
        if identity["running"]:
            reject("TASK70_V3_CLEANUP_REMOVE_STATE_INVALID")
        if attempt == 1:
            reject("TASK70_V3_CLEANUP_REMOVE_FAILED")
    reject("TASK70_V3_CLEANUP_CONTAINER_REMAINS")


def v3_reconcile_unknown_create(
        create_error: BaseException, *, policy: dict[str, Any], run_id: str,
        container_name: str, image: dict[str, Any],
) -> None:
    last_discovery_error: BaseException | None = None
    for attempt in range(10):
        try:
            discovered = v3_task_owned_container_ids(policy, run_id, container_name)
        except (DynamicGuardedSwitchError, LEGACY.DynamicPgSwitchError) as error:
            last_discovery_error = error
            if attempt < 9:
                time.sleep(1)
                continue
            break
        if len(discovered) > 1:
            reject("TASK70_V3_TASK_CONTAINER_CREATE_UNKNOWN")
        if len(discovered) == 1:
            try:
                v3_cleanup_task_container(
                    discovered[0], policy=policy, run_id=run_id,
                    container_name=container_name, image=image, allow_absent=True,
                )
            except (DynamicGuardedSwitchError, LEGACY.DynamicPgSwitchError) as error:
                raise error from create_error
            raise create_error
        if attempt < 9:
            time.sleep(1)
    try:
        labelled = v3_task_label_container_ids(policy, run_id)
        named = v3_task_name_container_ids(container_name)
    except (DynamicGuardedSwitchError, LEGACY.DynamicPgSwitchError) as error:
        raise DynamicGuardedSwitchError(
            "TASK70_V3_TASK_CONTAINER_CREATE_CLEANUP_UNVERIFIED",
        ) from error
    if labelled or named:
        reject("TASK70_V3_TASK_CONTAINER_CREATE_UNKNOWN")
    if last_discovery_error is not None:
        raise create_error from last_discovery_error
    raise create_error


def v3_create_task_container(
        policy: dict[str, Any], run_id: str, container_name: str,
        image: dict[str, Any],
) -> tuple[str, dict[str, Any], list[str]]:
    validate_v3_container_name(container_name)
    if v3_task_label_container_ids(policy, run_id) \
            or v3_task_name_container_ids(container_name):
        reject("TASK70_V3_TASK_CONTAINER_PREEXISTS")
    arguments = LEGACY.expected_create_arguments(policy, run_id, container_name)
    try:
        result = LEGACY.docker_command(arguments, timeout=60)
    except LEGACY.DynamicPgSwitchError as create_error:
        v3_reconcile_unknown_create(
            create_error, policy=policy, run_id=run_id,
            container_name=container_name, image=image,
        )
        raise AssertionError("unreachable")
    parse_error: BaseException | None = None
    discovery_error: BaseException | None = None
    try:
        identifiers = LEGACY.lines(
            result.stdout, CONTAINER_ID, "TASK70_V3_TASK_CONTAINER_CREATE_INVALID",
        ) if result.returncode == 0 else []
    except LEGACY.DynamicPgSwitchError as error:
        identifiers = []
        parse_error = error
    try:
        discovered = v3_task_label_container_ids(policy, run_id)
    except (DynamicGuardedSwitchError, LEGACY.DynamicPgSwitchError) as error:
        discovered = []
        discovery_error = error
    candidates = sorted(set(identifiers + discovered))
    if len(candidates) != 1:
        cleanup_candidate = discovered[0] if len(discovered) == 1 \
            else identifiers[0] if result.returncode == 0 \
            and len(identifiers) == 1 else None
        if cleanup_candidate is not None:
            try:
                v3_cleanup_task_container(
                    cleanup_candidate, policy=policy, run_id=run_id,
                    container_name=container_name, image=image, allow_absent=True,
                )
            except (DynamicGuardedSwitchError, LEGACY.DynamicPgSwitchError) as error:
                raise error from parse_error or discovery_error
        reject("TASK70_V3_TASK_CONTAINER_CREATE_UNKNOWN")
    identifier = candidates[0]
    try:
        v3_inspect_cleanup_identity(
            identifier,
            policy=policy, run_id=run_id,
            container_name=container_name, image=image,
        )
        if parse_error is not None:
            raise parse_error
        if discovery_error is not None:
            raise discovery_error
        if result.returncode != 0:
            reject("TASK70_V3_TASK_CONTAINER_CREATE_RESPONSE_LOST")
        if identifiers != [identifier] or discovered != [identifier]:
            reject("TASK70_V3_TASK_CONTAINER_CREATE_INVALID")
        projection = v3_inspect_task_container(
            identifier, policy=policy, run_id=run_id,
            container_name=container_name, image=image,
        )
        return identifier, projection, arguments
    except (DynamicGuardedSwitchError, LEGACY.DynamicPgSwitchError) as error:
        try:
            v3_cleanup_task_container(
                identifier, policy=policy, run_id=run_id,
                container_name=container_name, image=image, allow_absent=True,
            )
        except (DynamicGuardedSwitchError, LEGACY.DynamicPgSwitchError) as cleanup_error:
            raise cleanup_error from error
        raise


def quote_identifier(value: str) -> str:
    if re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", value or "") is None:
        reject("TASK70_V3_SQL_IDENTIFIER_INVALID")
    return f'"{value}"'


def quote_literal(value: str) -> str:
    if not isinstance(value, str) or not value or len(value.encode("utf-8")) > 1024 \
            or any(character in value for character in "\x00\r\n"):
        reject("TASK70_V3_SQL_LITERAL_INVALID")
    return "'" + value.replace("'", "''") + "'"


def psql_arguments(
        container_id: str, phase: str, *, database: str = "postgres",
        username: str = "postgres", variables: dict[str, str] | None = None,
        write_override: bool = False, verbosity: str = "terse",
) -> list[str]:
    selected = variables or {}
    if CONTAINER_ID.fullmatch(container_id or "") is None \
            or re.fullmatch(r"[a-z0-9_]{1,48}", phase or "") is None \
            or re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", database or "") is None \
            or re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", username or "") is None \
            or verbosity not in {"terse", "verbose"} \
            or len(selected) > 8 \
            or any(re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", key or "") is None
                   or not isinstance(value, str) or not 1 <= len(value) <= 512
                   or any(ord(character) < 32 or ord(character) > 126
                          for character in value)
                   for key, value in selected.items()):
        reject("TASK70_V3_PSQL_ARGUMENT_INVALID")
    return [
        "exec", "--interactive", "--user", "999:999", "--env",
        f"PGAPPNAME=cyd_dv70_v3_{phase}",
        *(["--env", "PGOPTIONS=-c default_transaction_read_only=off"]
          if write_override else []),
        "--", container_id, "psql", "--no-psqlrc", "--quiet", "--no-align",
        "--tuples-only", "--field-separator=\t", "--host=/var/run/postgresql",
        "--port=5432", f"--username={username}", "--no-password",
        f"--dbname={database}",
        *(f"--set={key}={selected[key]}" for key in sorted(selected)),
        "--set=ON_ERROR_STOP=on", f"--set=VERBOSITY={verbosity}",
    ]


def execute_psql_bound(
        container_id: str, phase: str, sql: bytes, *, database: str = "postgres",
        username: str = "postgres", variables: dict[str, str] | None = None,
        write_override: bool = False, timeout: int = 300,
        maximum_output: int = 32 * 1024 * 1024, verbosity: str = "terse",
) -> tuple[subprocess.CompletedProcess[bytes], list[str], dict[str, Any]]:
    if not isinstance(sql, bytes) or not sql.endswith(b"\n") \
            or not 1 <= len(sql) <= 1024 * 1024 \
            or not isinstance(write_override, bool) \
            or not isinstance(timeout, int) or isinstance(timeout, bool) \
            or not 1 <= timeout <= 1800 \
            or not isinstance(maximum_output, int) or isinstance(maximum_output, bool) \
            or not 1 <= maximum_output <= EXECUTOR.POSTGRES_CONTENT_REPORT_MAX_BYTES \
            or variables is not None and not isinstance(variables, dict):
        reject("TASK70_V3_PSQL_INPUT_INVALID")
    selected = {
        key: variables[key] for key in sorted(variables or {})
    }
    arguments = psql_arguments(
        container_id, phase, database=database, username=username,
        variables=selected, write_override=write_override,
        verbosity=verbosity,
    )
    try:
        result = LEGACY.docker_command(
            arguments,
            input_bytes=sql, timeout=timeout, maximum_output=maximum_output,
        )
    except LEGACY.DynamicPgSwitchError as error:
        raise DynamicGuardedSwitchError(error.code) from error
    execution = with_digest({
        "container_id": container_id,
        "database": database,
        "username": username,
        "write_override": write_override,
        "variables": selected,
        "verbosity": verbosity,
        "timeout_seconds": timeout,
        "maximum_output_bytes": maximum_output,
        "argv_sha256": digest_value(arguments),
        "stdin_sha256": digest_bytes(sql),
    }, "execution_sha256")
    return result, arguments, execution


def execute_psql(
        container_id: str, phase: str, sql: bytes, *, database: str = "postgres",
        username: str = "postgres", variables: dict[str, str] | None = None,
        write_override: bool = False, timeout: int = 300,
        maximum_output: int = 32 * 1024 * 1024, verbosity: str = "terse",
) -> subprocess.CompletedProcess[bytes]:
    result, _arguments, _execution = execute_psql_bound(
        container_id, phase, sql, database=database, username=username,
        variables=variables, write_override=write_override, timeout=timeout,
        maximum_output=maximum_output, verbosity=verbosity,
    )
    return result


def psql_command_receipt(
        phase: str, sql: bytes, result: subprocess.CompletedProcess[bytes],
        execution: dict[str, Any],
) -> dict[str, Any]:
    body = {
        "phase": phase,
        "sql_sha256": digest_bytes(sql),
        "execution": execution,
        "exit_code": result.returncode,
        "stdout_sha256": digest_bytes(result.stdout),
        "stderr_sha256": digest_bytes(result.stderr),
    }
    return with_digest(body, "receipt_sha256")


def ordinary_role_connection_rejection_evidence(
        result: subprocess.CompletedProcess[bytes], *, argv: list[str],
        database: str, role: str, stdin: bytes,
) -> dict[str, Any]:
    """Accept only PostgreSQL's database-limit SQLSTATE, never a generic exec failure."""
    code = "TASK70_V3_ORDINARY_ROLE_CONNECTION_NOT_REJECTED"
    try:
        stderr = result.stderr.decode("utf-8", "strict")
    except (AttributeError, UnicodeError) as error:
        raise DynamicGuardedSwitchError(code) from error
    expected_fatal = (
        f'FATAL:  53300: too many connections for database "{database}"'
    )
    lines = stderr.splitlines()
    fatal_lines = [line for line in lines if "FATAL:" in line]
    if role != "chenyida_erp_web" or f"--username={role}" not in argv \
            or f"--dbname={database}" not in argv \
            or "--set=VERBOSITY=verbose" not in argv \
            or result.returncode != 2 or result.stdout != b"" or not stderr.endswith("\n") \
            or len(stderr.encode("utf-8")) > 4096 or "\x00" in stderr \
            or len(fatal_lines) != 1 or expected_fatal not in fatal_lines[0] \
            or not fatal_lines[0].startswith(
                "psql: error: connection to server on socket ",
            ) \
            or any(token in stderr.lower() for token in (
                "permission denied", "role does not exist", "authentication failed",
                "no such container", "cannot connect to the docker daemon",
            )):
        reject(code)
    return {
        "error_code": "POSTGRESQL_DATABASE_CONNECTION_LIMIT_EXHAUSTED",
        "sqlstate": "53300",
        "exit_code": result.returncode,
        "argv_sha256": digest_value(argv),
        "stdin_sha256": digest_bytes(stdin),
        "stdout_sha256": digest_bytes(result.stdout),
        "stderr_sha256": digest_bytes(result.stderr),
        "stderr_base64": base64.b64encode(result.stderr).decode("ascii"),
    }


def execute_psql_success(
        container_id: str, phase: str, sql: bytes, **kwargs: Any,
) -> dict[str, Any]:
    result, _arguments, execution = execute_psql_bound(
        container_id, phase, sql, **kwargs,
    )
    if result.returncode != 0 or result.stderr:
        reject("TASK70_V3_PSQL_FAILED")
    return psql_command_receipt(phase, sql, result, execution)


def managed_role_sql(policy_document: dict[str, Any]) -> str:
    roles = policy_document.get("roles")
    memberships = policy_document.get("memberships")
    if not isinstance(roles, list) or len(roles) != 9 \
            or not isinstance(memberships, list) or len(memberships) != 4:
        reject("TASK70_V3_ROLE_FIXTURE_INVALID")
    statements: list[str] = []
    for role in roles:
        try:
            attributes = [
                "LOGIN" if role["intended_login"] else "NOLOGIN",
                "INHERIT" if role["inherit"] else "NOINHERIT",
                "SUPERUSER" if role["superuser"] else "NOSUPERUSER",
                "CREATEROLE" if role["create_role"] else "NOCREATEROLE",
                "CREATEDB" if role["create_database"] else "NOCREATEDB",
                "REPLICATION" if role["replication"] else "NOREPLICATION",
                "BYPASSRLS" if role["bypass_rls"] else "NOBYPASSRLS",
                f"CONNECTION LIMIT {int(role['connection_limit'])}",
            ]
            if role["valid_until"] is not None:
                attributes.append(f"VALID UNTIL {quote_literal(role['valid_until'])}")
            statements.append(
                f"CREATE ROLE {quote_identifier(role['name'])} {' '.join(attributes)};",
            )
        except (KeyError, TypeError, ValueError) as error:
            raise DynamicGuardedSwitchError("TASK70_V3_ROLE_FIXTURE_INVALID") from error
    for membership in memberships:
        if membership.get("grantor") != "PLATFORM_OWNER" \
                or membership.get("admin_option") is not False \
                or membership.get("inherit_option") is not True \
                or membership.get("set_option") is not False:
            reject("TASK70_V3_ROLE_FIXTURE_INVALID")
        statements.append(
            f"GRANT {quote_identifier(membership['role'])} "
            f"TO {quote_identifier(membership['member'])} "
            "WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;",
        )
    return "\n".join(statements)


def setup_cluster_sql(policy: dict[str, Any], privilege_policy: dict[str, Any]) -> bytes:
    active = "chenyida_erp"
    staging = "chenyida_erp_rb_deadbeefdeadbeef"
    tablespaces = privilege_policy.get("tablespaces")
    if tablespaces != {
            "built_in": ["pg_default", "pg_global"], "custom": [],
            "owner": "PLATFORM_OWNER", "privileges": [],
    }:
        reject("TASK70_V3_TABLESPACE_FIXTURE_INVALID")
    marker = policy["required_target_guard"]["management_database_comment"]
    candidate_marker = policy["required_target_guard"]["executor_fixture_candidate_marker"]
    staging_marker = (
        "chenyida-erp-uat-rollback/v1:rollback-runner-deadbeef:RESTORED_STAGING"
    )
    sql = f"""{managed_role_sql(privilege_policy)}
GRANT ALL PRIVILEGES ON TABLESPACE pg_default TO CURRENT_USER;
GRANT ALL PRIVILEGES ON TABLESPACE pg_global TO CURRENT_USER;
COMMENT ON DATABASE postgres IS {quote_literal(marker)};
CREATE DATABASE {quote_identifier(active)} WITH OWNER chenyida_erp_owner
  TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C'
  LC_CTYPE 'C' TABLESPACE pg_default CONNECTION LIMIT 0;
ALTER DATABASE {quote_identifier(active)} SET default_transaction_read_only TO on;
ALTER DATABASE {quote_identifier(active)} ALLOW_CONNECTIONS false;
COMMENT ON DATABASE {quote_identifier(active)} IS {quote_literal(candidate_marker)};
CREATE DATABASE {quote_identifier(staging)} WITH OWNER chenyida_erp_owner
  TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C'
  LC_CTYPE 'C' TABLESPACE pg_default CONNECTION LIMIT 64;
COMMENT ON DATABASE {quote_identifier(staging)} IS {quote_literal(staging_marker)};
"""
    return sql.encode("utf-8")


def migration_sources(policy: dict[str, Any]) -> tuple[list[dict[str, Any]], bytes]:
    expected = policy["migration_fixture"]
    paths = sorted(MIGRATION_ROOT.glob("[0-9][0-9][0-9][0-9]_*.sql"))
    if len(paths) != expected["expected_count"] \
            or paths[-1].name != expected["expected_head"] \
            or any(path.name[:4] != f"{index:04d}" for index, path in enumerate(paths, 1)):
        reject("TASK70_V3_MIGRATION_SET_INVALID")
    records: list[dict[str, Any]] = []
    ledger = bytearray()
    for path in paths:
        try:
            raw = path.read_bytes()
            metadata = path.lstat()
        except OSError as error:
            raise DynamicGuardedSwitchError("TASK70_V3_MIGRATION_SOURCE_INVALID") from error
        if not raw or len(raw) > 1024 * 1024 or not stat.S_ISREG(metadata.st_mode) \
                or stat.S_ISLNK(metadata.st_mode):
            reject("TASK70_V3_MIGRATION_SOURCE_INVALID")
        checksum = digest_bytes(raw)
        ledger.extend(f"{checksum}  {path.name}\n".encode("ascii"))
        records.append({
            "path": path, "version": path.name, "checksum": checksum,
            "sql": raw.replace(b"--> statement-breakpoint", b""),
        })
    return records, bytes(ledger)


def apply_migrations(
        container_id: str, policy: dict[str, Any], records: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    receipts: list[dict[str, Any]] = []
    owner = policy["migration_fixture"]["apply_owner"]
    staging = "chenyida_erp_rb_deadbeefdeadbeef"
    for index, record in enumerate(records, 1):
        sql = b"BEGIN;\nSET LOCAL client_min_messages=warning;\n" \
            + record["sql"] + b"\nCOMMIT;\n"
        receipt = execute_psql_success(
            container_id, f"migration_{index:04d}", sql,
            database=staging, username=owner, write_override=True,
        )
        receipts.append({
            "kind": "MIGRATION", "version": record["version"],
            "checksum": record["checksum"], "execution_receipt": receipt,
        })
    values = ",\n".join(
        f"({quote_literal(record['version'])},{quote_literal(record['checksum'])})"
        for record in records
    )
    ledger_sql = f"""BEGIN;
CREATE TABLE public.schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{{64}}$')
);
ALTER TABLE public.schema_migrations OWNER TO chenyida_erp_owner;
INSERT INTO public.schema_migrations(version,checksum) VALUES
{values};
COMMIT;
""".encode("utf-8")
    receipts.append({
        "kind": "LEDGER",
        "execution_receipt": execute_psql_success(
            container_id, "migration_ledger", ledger_sql,
            database=staging, username=owner, write_override=True,
        ),
    })
    seal_sql = f"""ALTER DATABASE {quote_identifier(staging)} CONNECTION LIMIT 0;
ALTER DATABASE {quote_identifier(staging)} SET default_transaction_read_only TO on;
""".encode("utf-8")
    receipts.append({
        "kind": "SEAL",
        "execution_receipt": execute_psql_success(
            container_id, "seal_staging", seal_sql,
        ),
    })
    return receipts


def capture_content_report(container_id: str, phase: str) -> tuple[bytes, dict[str, Any]]:
    sql = EXECUTOR.embedded_postgres_sql(
        EXECUTOR.POSTGRES_CONTENT_SQL_ZLIB_BASE64,
        EXECUTOR.POSTGRES_CONTENT_SQL_SHA256,
    )
    result = execute_psql(
        container_id, phase, sql,
        database="chenyida_erp_rb_deadbeefdeadbeef",
        maximum_output=EXECUTOR.POSTGRES_CONTENT_REPORT_MAX_BYTES,
    )
    if result.returncode != 0 or result.stderr:
        reject("TASK70_V3_CONTENT_CAPTURE_FAILED")
    try:
        report = EXECUTOR.validate_database_reconciliation_report(result.stdout)
    except EXECUTOR.FixedExecutorError as error:
        raise DynamicGuardedSwitchError(str(error)) from error
    return result.stdout, report


def database_size(container_id: str) -> int:
    result = execute_psql(
        container_id, "database_size",
        b"SELECT pg_catalog.pg_database_size(current_database())::text;\n",
        database="chenyida_erp_rb_deadbeefdeadbeef",
    )
    try:
        value = int(result.stdout.strip())
    except ValueError as error:
        raise DynamicGuardedSwitchError("TASK70_V3_DATABASE_SIZE_INVALID") from error
    if result.returncode != 0 or result.stderr or not 1 <= value <= 512 * 1024 * 1024:
        reject("TASK70_V3_DATABASE_SIZE_INVALID")
    return value


def materialize_inputs(
        *, identity: dict[str, Any], container_id: str, image_reference: str,
        image_id: str, git_commit: str, application_version: str,
        migration_ledger: bytes, report_raw: bytes, database_bytes: int,
) -> Any:
    inputs = LEGACY.materialize_fixture_inputs(
        FIXTURE, identity=identity, container_id=container_id,
        image_reference=image_reference, image_id=image_id,
        git_commit=git_commit, application_version=application_version,
    )
    lines = migration_ledger.decode("ascii").splitlines()
    migration_records = [
        {"checksum": line.split("  ", 1)[0], "version": line.split("  ", 1)[1]}
        for line in lines
    ]
    allowlist_sha256 = EXECUTOR.migration_allowlist_digest(migration_records)
    ledger_sha256 = digest_bytes(migration_ledger)
    head = migration_records[-1]["version"]
    inputs._raw["snapshot_migrations"] = migration_ledger
    inputs.package["sources"]["snapshot_migrations"].update({
        "sha256": ledger_sha256, "bytes": len(migration_ledger),
    })
    inputs.package["predecessor"].update({
        "migration_head": head,
        "migration_manifest_sha256": allowlist_sha256,
    })
    predecessor = inputs._documents["predecessor_release_manifest"]
    predecessor["migrations"].update({
        "head": head, "allowlist_sha256": allowlist_sha256,
    })
    predecessor_sha256 = digest_value(predecessor)
    inputs.package["predecessor"]["release_manifest_sha256"] = predecessor_sha256
    inputs.package["sources"]["predecessor_release_manifest"]["sha256"] = \
        predecessor_sha256

    report = EXECUTOR.validate_database_reconciliation_report(report_raw)
    reconciliation = inputs._documents["snapshot_reconciliation"]
    reconciliation["database"].update({
        "report_sha256": report["sha256"],
        "report": report_raw.decode("utf-8"),
    })
    reconciliation_sha256 = digest_value(reconciliation)
    inputs.package["content_reconciliation"].update({
        "source_reconciliation_sha256": reconciliation_sha256,
        "database": {"report_sha256": report["sha256"]},
    })
    inputs.package["sources"]["snapshot_reconciliation"].update({
        "sha256": reconciliation_sha256,
        "bytes": len(EXECUTOR.canonical(reconciliation)),
    })

    manifest = inputs._documents["snapshot_manifest"]
    manifest["deployment"]["database_bytes"] = database_bytes
    manifest["migration"].update({
        "head": head, "manifest_sha256": ledger_sha256,
    })
    manifest["reconciliation"]["sha256"] = reconciliation_sha256
    manifest_sha256 = digest_value(manifest)
    inputs.package["sources"]["snapshot_manifest"]["sha256"] = manifest_sha256
    inputs._plan["source_bindings"]["snapshot_manifest_sha256"] = manifest_sha256
    inputs._plan["source_bindings"]["snapshot_reconciliation_sha256"] = \
        reconciliation_sha256
    return inputs


class RealPostgres:
    def __init__(self, inputs: Any):
        deadline = (
            dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=25)
        ).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        try:
            self.docker_fd = os.open(
                DOCKER, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
            )
        except OSError as error:
            raise DynamicGuardedSwitchError("TASK70_V3_DOCKER_FD_INVALID") from error
        self.execution_receipts: list[dict[str, Any]] = []
        self.execution_cursor = 0
        try:
            self.runner = EXECUTOR.ClosedDockerRunner(
                self.docker_fd, inputs.plan, action_deadline=deadline,
                execution_observer=self._record_execution,
            )
            self.driver = EXECUTOR.ClosedPostgresCapabilityDriver(self.runner)
        except BaseException:
            os.close(self.docker_fd)
            raise

    def _record_execution(self, event: dict[str, Any]) -> None:
        code = "TASK70_V3_FIXED_EXECUTION_RECEIPT_INVALID"
        if not isinstance(event, dict) or set(event) != {
                "arguments", "environment", "stdin_present", "stdin_bytes",
                "stdin_sha256", "timeout_milliseconds", "maximum_output_bytes",
                "side_effects_started", "return_code", "stdout", "stderr",
                "daemon_state",
        }:
            reject(code)
        arguments = event["arguments"]
        environment = event["environment"]
        stdout = event["stdout"]
        stderr = event["stderr"]
        markers = [
            value for value in arguments if isinstance(value, str)
            and re.fullmatch(
                r"PGAPPNAME=cyd_rb_[a-z0-9]{1,32}_(?:reconcile|guardedswitch)",
                value,
            )
        ] if isinstance(arguments, list) else []
        if len(markers) != 1:
            reject(code)
        phase = markers[0].rsplit("_", 1)[-1]
        if phase not in {"reconcile", "guardedswitch"} \
                or any(not isinstance(value, str) for value in arguments) \
                or environment != FIXED_EXECUTION_ENVIRONMENT \
                or event["stdin_present"] is not True \
                or isinstance(event["stdin_bytes"], bool) \
                or not isinstance(event["stdin_bytes"], int) \
                or not 1 <= event["stdin_bytes"] <= 1024 * 1024 \
                or SHA256.fullmatch(event["stdin_sha256"] or "") is None \
                or event["timeout_milliseconds"] != 300_000 \
                or event["maximum_output_bytes"] != 4 * 1024 * 1024 \
                or event["side_effects_started"] is not True \
                or isinstance(event["return_code"], bool) \
                or not isinstance(event["return_code"], int) \
                or not 0 <= event["return_code"] <= 255 \
                or not isinstance(stdout, bytes) or not isinstance(stderr, bytes) \
                or len(stdout) > 64 * 1024 or len(stderr) > 64 * 1024 \
                or event["daemon_state"] != "COMPLETED_NO_UNTRACKED_PROCESS":
            reject(code)
        body = {
            "schema_version": 1,
            "contract": FIXED_EXECUTION_RECEIPT_CONTRACT,
            "sequence": len(self.execution_receipts) + 1,
            "phase": phase,
            "arguments": list(arguments),
            "arguments_sha256": digest_value(arguments),
            "environment": dict(sorted(environment.items())),
            "environment_sha256": digest_value(environment),
            "stdin_present": True,
            "stdin_bytes": event["stdin_bytes"],
            "stdin_sha256": event["stdin_sha256"],
            "timeout_milliseconds": event["timeout_milliseconds"],
            "maximum_output_bytes": event["maximum_output_bytes"],
            "side_effects_started": True,
            "return_code": event["return_code"],
            "stdout_base64": base64.b64encode(stdout).decode("ascii"),
            "stdout_bytes": len(stdout),
            "stdout_sha256": digest_bytes(stdout),
            "stderr_base64": base64.b64encode(stderr).decode("ascii"),
            "stderr_bytes": len(stderr),
            "stderr_sha256": digest_bytes(stderr),
            "daemon_state": event["daemon_state"],
        }
        self.execution_receipts.append(with_digest(body, "execution_receipt_sha256"))

    def take_execution_receipt(self, phase: str) -> dict[str, Any]:
        if phase not in {"reconcile", "guardedswitch"} \
                or self.execution_cursor >= len(self.execution_receipts):
            reject("TASK70_V3_FIXED_EXECUTION_RECEIPT_MISSING")
        receipt = self.execution_receipts[self.execution_cursor]
        self.execution_cursor += 1
        if receipt["sequence"] != self.execution_cursor or receipt["phase"] != phase:
            reject("TASK70_V3_FIXED_EXECUTION_RECEIPT_ORDER_INVALID")
        return copy.deepcopy(receipt)

    def assert_execution_receipts_consumed(self, expected: int) -> None:
        if self.execution_cursor != expected \
                or len(self.execution_receipts) != expected:
            reject("TASK70_V3_FIXED_EXECUTION_RECEIPT_COUNT_INVALID")

    def close(self) -> None:
        if self.docker_fd is not None:
            os.close(self.docker_fd)
            self.docker_fd = None


def fixed_executor_psql_arguments(
        base: dict[str, Any], opcode: dict[str, Any],
) -> list[str]:
    phase = opcode.get("phase")
    database = opcode.get("database")
    if phase not in {"reconcile", "guardedswitch"} \
            or database != base["databases"]["staging_name"]:
        reject("TASK70_V3_FIXED_EXECUTION_RECEIPT_INVALID")
    token = base["databases"]["staging_name"].rsplit("_", 1)[-1]
    variables = guarded_variables(base) if phase == "guardedswitch" else {}
    return [
        "exec", "--interactive", "--user", "999:999", "--env",
        f"PGAPPNAME=cyd_rb_{token}_{phase}",
        "--env", "PGOPTIONS=-c default_transaction_read_only=off",
        "--", base["postgres"]["container_id"],
        "psql", "--no-psqlrc", "--quiet", "--no-align", "--tuples-only",
        "--field-separator=\t", "--host=/var/run/postgresql", "--port=5432",
        "--username=postgres", "--no-password", f"--dbname={database}",
        *(f"--set={key}={variables[key]}" for key in sorted(variables)),
        "--set=ON_ERROR_STOP=on", "--set=VERBOSITY=terse",
    ]


def validate_fixed_execution_receipt(
        receipt: dict[str, Any], *, base: dict[str, Any],
        opcode: dict[str, Any], sql: bytes, sequence: int,
) -> tuple[bytes, bytes]:
    code = "TASK70_V3_FIXED_EXECUTION_RECEIPT_INVALID"
    expected_keys = {
        "schema_version", "contract", "sequence", "phase", "arguments",
        "arguments_sha256", "environment", "environment_sha256",
        "stdin_present", "stdin_bytes", "stdin_sha256", "timeout_milliseconds",
        "maximum_output_bytes", "side_effects_started", "return_code",
        "stdout_base64", "stdout_bytes", "stdout_sha256", "stderr_base64",
        "stderr_bytes", "stderr_sha256", "daemon_state",
        "execution_receipt_sha256",
    }
    if not isinstance(receipt, dict) or set(receipt) != expected_keys \
            or not isinstance(sql, bytes) or not sql.endswith(b"\n") \
            or receipt.get("schema_version") != 1 \
            or receipt.get("contract") != FIXED_EXECUTION_RECEIPT_CONTRACT \
            or receipt.get("sequence") != sequence \
            or receipt.get("phase") != opcode.get("phase") \
            or receipt.get("arguments") != fixed_executor_psql_arguments(base, opcode) \
            or receipt.get("arguments_sha256") \
                != digest_value(receipt.get("arguments")) \
            or receipt.get("environment") != FIXED_EXECUTION_ENVIRONMENT \
            or receipt.get("environment_sha256") \
                != digest_value(FIXED_EXECUTION_ENVIRONMENT) \
            or receipt.get("stdin_present") is not True \
            or receipt.get("stdin_bytes") != len(sql) \
            or receipt.get("stdin_sha256") != digest_bytes(sql) \
            or receipt.get("stdin_sha256") != opcode.get("sql_sha256") \
            or receipt.get("timeout_milliseconds") != 300_000 \
            or receipt.get("maximum_output_bytes") != 4 * 1024 * 1024 \
            or receipt.get("side_effects_started") is not True \
            or receipt.get("daemon_state") != "COMPLETED_NO_UNTRACKED_PROCESS" \
            or SHA256.fullmatch(receipt.get("execution_receipt_sha256") or "") is None:
        reject(code)
    try:
        stdout = base64.b64decode(receipt["stdout_base64"], validate=True)
        stderr = base64.b64decode(receipt["stderr_base64"], validate=True)
    except (KeyError, ValueError) as error:
        raise DynamicGuardedSwitchError(code) from error
    if len(stdout) != receipt.get("stdout_bytes") \
            or len(stderr) != receipt.get("stderr_bytes") \
            or base64.b64encode(stdout).decode("ascii") \
                != receipt.get("stdout_base64") \
            or base64.b64encode(stderr).decode("ascii") \
                != receipt.get("stderr_base64") \
            or digest_bytes(stdout) != receipt.get("stdout_sha256") \
            or digest_bytes(stderr) != receipt.get("stderr_sha256") \
            or len(stdout) > 64 * 1024 or len(stderr) > 64 * 1024 \
            or digest_value({key: value for key, value in receipt.items()
                             if key != "execution_receipt_sha256"}) \
                != receipt["execution_receipt_sha256"]:
        reject(code)
    return stdout, stderr


def validate_mutation_ack_execution_binding(
        ack: dict[str, Any], receipt: dict[str, Any], *,
        base: dict[str, Any], opcode: dict[str, Any], sql: bytes, sequence: int,
) -> None:
    stdout, stderr = validate_fixed_execution_receipt(
        receipt, base=base, opcode=opcode, sql=sql, sequence=sequence,
    )
    try:
        expected_ack = EXECUTOR.parse_pg_mutation_ack(stdout, opcode["opcode"])
    except EXECUTOR.FixedExecutorError as error:
        raise DynamicGuardedSwitchError(
            "TASK70_V3_MUTATION_ACK_EXECUTION_BINDING_INVALID",
        ) from error
    if receipt["return_code"] != 0 or stderr != b"" or ack != expected_ack:
        reject("TASK70_V3_MUTATION_ACK_EXECUTION_BINDING_INVALID")


def validate_guarded_failure_execution(
        receipt: dict[str, Any], *, base: dict[str, Any],
        opcode: dict[str, Any], sql: bytes, sequence: int, reason: str,
) -> None:
    code = "TASK70_V3_GUARDED_FAILURE_EXECUTION_INVALID"
    stdout, stderr = validate_fixed_execution_receipt(
        receipt, base=base, opcode=opcode, sql=sql, sequence=sequence,
    )
    if reason == "TARGET_DATABASE_MISSING":
        try:
            text = stderr.decode("utf-8", "strict")
        except UnicodeError as error:
            raise DynamicGuardedSwitchError(code) from error
        expected_line = (
            "psql: error: connection to server on socket "
            '"/var/run/postgresql/.s.PGSQL.5432" failed: '
            f'FATAL:  database "{base["databases"]["staging_name"]}" '
            "does not exist"
        )
        if receipt["return_code"] != 2 or stdout != b"" \
                or not text.endswith("\n") or len(stderr) > 4096 \
                or "\x00" in text or "\r" in text \
                or text.splitlines() != [expected_line] \
                or any(token in text.lower() for token in (
                    "permission denied", "role does not exist", "authentication failed",
                    "no such container", "cannot connect to the docker daemon",
                )):
            reject(code)
        return
    if reason == "CONTENT_GUARD_RELATION_MISMATCH":
        try:
            error_text = stderr.decode("ascii", "strict")
        except UnicodeError as error:
            raise DynamicGuardedSwitchError(code) from error
        if receipt["return_code"] != 3 \
                or any(character not in b" \t\n" for character in stdout) \
                or error_text.splitlines() \
                    != ["ERROR:  guarded switch relation content mismatch"] \
                or not error_text.endswith("\n") or len(stderr) > 4096:
            reject(code)
        return
    if reason == "RUNTIME_PRIVILEGE_MISMATCH":
        try:
            output_text = stdout.decode("ascii", "strict")
        except UnicodeError as error:
            raise DynamicGuardedSwitchError(code) from error
        nonempty = [line.strip() for line in output_text.splitlines() if line.strip()]
        if receipt["return_code"] != 3 or stderr != b"" \
                or len(stdout) > 4096 or not output_text.endswith("\n") \
                or "\x00" in output_text or "\r" in output_text \
                or any(character not in " \t\r\nabcdefghijklmnopqrstuvwxyz" \
                       for character in output_text) \
                or nonempty != ["guarded switch runtime privilege mismatch"]:
            reject(code)
        return
    reject(code)


def observe(
        real: RealPostgres, base: dict[str, Any], restored_oid: str, purpose: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    observation = real.driver.observe(
        base, purpose, digest_value({
            "case_id": CASE_ID, "purpose": purpose,
            "base_spec_sha256": base["base_spec_sha256"],
        }),
    )
    classification = EXECUTOR.classify_pg_rollback_layout(
        observation, base=base, restored_oid=restored_oid,
    )
    return observation, classification


def require_layout(classification: dict[str, Any], expected: str) -> None:
    if classification.get("layout") != expected:
        reject("TASK70_V3_LAYOUT_INVALID")


def reset_old_layout(
        container_id: str, base: dict[str, Any], restored_oid: str, phase: str,
) -> dict[str, Any]:
    return execute_psql_success(
        container_id, phase, LEGACY.reset_sql(base, restored_oid),
    )


def execute_guarded_failure(
        real: RealPostgres, base: dict[str, Any], inputs: Any,
        opcode: dict[str, Any], expected_codes: set[str], *, sql: bytes,
        sequence: int, reason: str,
) -> tuple[str, dict[str, Any]]:
    code: str
    try:
        real.runner.postgres_guarded_switch_opcode(base, inputs, opcode)
    except EXECUTOR.FixedExecutorError as error:
        code = str(error)
        if code not in expected_codes:
            reject("TASK70_V3_UNEXPECTED_GUARDED_FAILURE")
    except EXECUTOR.HandlerOutcomeUnknown as error:
        code = error.reason_code
        if code not in expected_codes or error.phase != "AFTER_SIDE_EFFECT" \
                or error.side_effects_started is not True:
            reject("TASK70_V3_UNEXPECTED_GUARDED_FAILURE")
    else:
        reject("TASK70_V3_EXPECTED_GUARDED_FAILURE_MISSING")
    receipt = real.take_execution_receipt("guardedswitch")
    validate_guarded_failure_execution(
        receipt, base=base, opcode=opcode, sql=sql,
        sequence=sequence, reason=reason,
    )
    return code, receipt


def derive_fault_stream(sql: bytes, base: dict[str, Any]) -> tuple[bytes, int]:
    names = base["databases"]
    first = (
        f"ALTER DATABASE {quote_identifier(names['active_name'])} "
        f"RENAME TO {quote_identifier(names['quarantine_name'])};\n"
    ).encode("utf-8")
    second = (
        f"ALTER DATABASE {quote_identifier(names['staging_name'])} "
        f"RENAME TO {quote_identifier(names['active_name'])};\n"
    ).encode("utf-8")
    if sql.count(first) != 1 or sql.count(second) != 1 \
            or sql.index(second) <= sql.index(first):
        reject("TASK70_V3_FAULT_ANCHOR_INVALID")
    boundary = sql.index(first) + len(first)
    barrier = f"SELECT {quote_literal(FAULT_BARRIER)}::text;\n".encode("utf-8")
    return sql[:boundary] + barrier, boundary


def execute_fault_stream(
        container_id: str, fault_sql: bytes, base: dict[str, Any],
) -> dict[str, Any]:
    variables = guarded_variables(base)
    result, _arguments, execution = execute_psql_bound(
        container_id, "guarded_fault", fault_sql,
        database=base["databases"]["staging_name"], variables=variables,
        write_override=True,
    )
    output = result.stdout.decode("utf-8", "strict")
    if result.returncode != 0 or result.stderr or output.count(FAULT_BARRIER) != 1:
        reject("TASK70_V3_FAULT_STREAM_FAILED")
    execution_receipt = psql_command_receipt(
        "guarded_fault", fault_sql, result, execution,
    )
    return with_digest({
        "opcode": "DERIVED_V3_FIRST_RENAME_BARRIER_EOF_V1",
        "execution_receipt": execution_receipt,
        "barrier": FAULT_BARRIER,
    }, "command_receipt_sha256")


def guarded_variables(base: dict[str, Any]) -> dict[str, str]:
    return {
        "capture_security_state": "1",
        "sealed_staging_mode": "1",
        "expected_database": base["databases"]["staging_name"],
        "expected_marker": base["databases"]["staging_marker"],
        "expected_system_identifier": base["postgres"]["system_identifier"],
        "migration_owner": base["security"]["database_owner"],
    }


def scenario(body: dict[str, Any]) -> dict[str, Any]:
    return with_digest(body, "scenario_sha256")


def assertion(identifier: str, evidence: dict[str, Any]) -> dict[str, Any]:
    body = {"id": identifier, "result": "PASS", "evidence": evidence}
    return {**body, "evidence_sha256": digest_value(evidence)}


def journal_request(inputs: Any, base: dict[str, Any], action: str) -> dict[str, Any]:
    if action not in {"EXECUTE", "PROBE"}:
        reject("TASK70_V3_JOURNAL_REQUEST_INVALID")
    operation_id = base["rollback_operation_id"]
    shared = {
        "operation": "ROLLBACK_EXECUTION",
        "operation_id": operation_id,
        "execution_mode": "ORIGINAL" if action == "EXECUTE" else "RECOVERY",
        "action": action,
        "label": "POSTGRESQL_RESTORE",
        "runtime_plan_sha256": base["runtime_plan_sha256"],
        "execution_package_sha256": inputs.package["package_sha256"],
        "source_set_sha256": base["source_set_sha256"],
        "transaction_intent_sha256": digest_value({"operation_id": operation_id, "kind": "transaction"}),
        "context_sha256": digest_value({"operation_id": operation_id, "kind": "context"}),
        "record_intent_sha256": digest_value({"operation_id": operation_id, "kind": "record"}),
        "previous_result_sha256": EXECUTOR.ZERO_SHA256,
    }
    return {
        **shared,
        "request_sha256": digest_value({"operation_id": operation_id, "action": action}),
    }


def prepare_journal_filesystem(filesystem_root: Path) -> None:
    if filesystem_root.parent.name != "journal-evidence" or filesystem_root.exists():
        reject("TASK70_V3_JOURNAL_ROOT_INVALID")
    filesystem_root.mkdir(mode=0o700)
    parent = filesystem_root / Path(EXECUTOR.HANDLER_STATE_ROOT.lstrip("/")).parent
    parent.mkdir(parents=True, mode=0o700)
    for path in [filesystem_root, *parent.parents]:
        if path == filesystem_root.parent.parent:
            break
        if path.is_relative_to(filesystem_root):
            os.chmod(path, 0o700)


def configure_runtime_inputs(inputs: Any, base: dict[str, Any]) -> None:
    writer = FIXTURE.valid_handler_evidence("WRITER_CONTAINMENT")
    writer.update({
        "database_oid": base["databases"]["candidate_oid"],
        "system_identifier": base["postgres"]["system_identifier"],
        "runtime_plan_sha256": base["runtime_plan_sha256"],
    })
    inputs.rollback_result = {
        "stages": [
            {"stage_result_sha256": digest_value({"unused_stage": index})}
            for index in range(9)
        ],
    }
    inputs.rollback_result["stages"][1] = {
        "stage_result_sha256": digest_value({
            "case_id": CASE_ID, "stage": "WRITER_CONTAINMENT",
        }),
        "evidence": writer,
    }


def build_restore_precondition_proof(
        base: dict[str, Any], *, restored_oid: str,
        create_receipt_sha256: str, dump_inventory_sha256: str,
) -> dict[str, Any]:
    opcode = EXECUTOR.derive_pg_opcode_spec(
        base, "PG_RB_OBSERVE_STAGING_RESTORE_PRECONDITION_V1", {
            "create_receipt_sha256": create_receipt_sha256,
            "staging_oid": restored_oid,
            "dump_inventory_sha256": dump_inventory_sha256,
            "expected_empty_projection_sha256":
                digest_value(EXECUTOR.postgres_empty_restore_projection()),
        },
    )
    raw = EXECUTOR.canonical({
        "system_identifier": base["postgres"]["system_identifier"],
        "server_version_num": base["postgres"]["server_version_num"],
        "database": {
            "name": base["databases"]["staging_name"],
            "oid": restored_oid, "marker": base["databases"]["staging_marker"],
            "owner": "postgres", "allow_connections": True,
            "connection_limit": 0, "default_transaction_read_only": True,
            "sessions": 0, "prepared_xacts": 0,
        },
        "profile": {
            "encoding": base["profile"]["encoding"],
            "locale_provider": base["profile"]["locale_provider"],
            "collate": base["profile"]["collate"],
            "ctype": base["profile"]["ctype"],
            "collation_version": base["profile"]["collation_version"],
            "tablespace": base["profile"]["default_tablespace"],
        },
        "projection": EXECUTOR.postgres_empty_restore_projection(),
    })
    return EXECUTOR.parse_pg_restore_precondition(
        raw, base=base, opcode_spec=opcode,
    )


def build_prefix_material_before_reconcile(
        inputs: Any, base: dict[str, Any], *, restored_oid: str,
        dump_inventory_sha256: str, recorded_at: str,
) -> dict[str, Any]:
    request = journal_request(inputs, base, "EXECUTE")
    create_target = {
        "base_spec_sha256": base["base_spec_sha256"],
        "target": base["databases"]["staging_name"],
    }
    create_argv = {"opcode": "PG_RB_CAPACITY_THEN_CREATE_STAGING_V1"}
    create_intent = EXECUTOR.create_side_effect_intent(
        request, "STAGING_DATABASE_CREATE", digest_value(create_target),
        digest_value(create_argv), recorded_at,
    )
    create_receipt = EXECUTOR.create_side_effect_receipt(
        create_intent,
        digest_value({"base_spec_sha256": base["base_spec_sha256"], "layout": "INITIAL"}),
        digest_value({"restored_oid": restored_oid, "layout": "OLD"}), recorded_at,
    )
    restore_proof = build_restore_precondition_proof(
        base, restored_oid=restored_oid,
        create_receipt_sha256=create_receipt["receipt_sha256"],
        dump_inventory_sha256=dump_inventory_sha256,
    )
    restore_target = {
        "staging_oid": restored_oid,
        "dump_sha256": base["snapshot"]["dump_sha256"],
        "dump_inventory_sha256": dump_inventory_sha256,
        "restore_precondition_sha256": restore_proof["restore_precondition_sha256"],
        "empty_projection_sha256": restore_proof["empty_projection_sha256"],
    }
    restore_argv = {"opcode": "PG_RB_RESTORE_DUMP_V1"}
    restore_intent = EXECUTOR.create_side_effect_intent(
        request, "LOGICAL_DUMP_RESTORE", digest_value(restore_target),
        digest_value(restore_argv), recorded_at,
    )
    restore_receipt = EXECUTOR.create_side_effect_receipt(
        restore_intent, create_receipt["receipt_sha256"],
        digest_value({
            "restored_oid": restored_oid,
            "content_report_sha256": base["snapshot"]["target_database_report_sha256"],
            "migration_ledger_file_sha256":
                base["snapshot"]["migration_ledger_file_sha256"],
        }), recorded_at,
    )
    reconcile_target = {
        "staging_oid": restored_oid,
        "sealed_security_projection_sha256": digest_value(base["security"]),
    }
    reconcile_argv = {"opcode": "PG_RB_RECONCILE_PRIVILEGES_V1"}
    reconcile_intent = EXECUTOR.create_side_effect_intent(
        request, "PRIVILEGE_RECONCILE", digest_value(reconcile_target),
        digest_value(reconcile_argv), recorded_at,
    )
    return {
        "request": request, "recorded_at": recorded_at,
        "create_intent": create_intent, "create_receipt": create_receipt,
        "restore_precondition": restore_proof,
        "restore_intent": restore_intent, "restore_receipt": restore_receipt,
        "reconcile_intent": reconcile_intent,
    }


def complete_prefix_material(
        prefix: dict[str, Any], reconcile: dict[str, Any],
) -> dict[str, Any]:
    after_identity = digest_value({
        "opcode_spec_sha256": reconcile["opcode"]["opcode_spec_sha256"],
        "ack_sha256": reconcile["ack"]["ack_sha256"],
        "observation_sha256": reconcile["observation"]["observation_sha256"],
    })
    receipt = EXECUTOR.create_side_effect_receipt(
        prefix["reconcile_intent"], prefix["restore_receipt"]["receipt_sha256"],
        after_identity, prefix["recorded_at"],
    )
    return {**prefix, "reconcile_receipt": receipt}


def seed_production_recovery_journal(
        filesystem_root: Path, inputs: Any, base: dict[str, Any],
        prefix: dict[str, Any], staging_proof: dict[str, Any],
        opcode: dict[str, Any], *, restored_oid: str,
) -> tuple[Any, dict[str, Any], str]:
    prepare_journal_filesystem(filesystem_root)
    request = prefix["request"]
    activation = digest_value({
        "operation_id": request["operation_id"], "kind": "activation",
    })
    journal = EXECUTOR.HandlerJournal(
        request["operation"], request["operation_id"], request["label"],
        str(filesystem_root),
    )
    effects = EXECUTOR.DurableSideEffectRecorder(
        journal, request, activation, clock=lambda: prefix["recorded_at"],
    )
    effects.begin("STAGING_DATABASE_CREATE", prefix["create_intent"])
    effects.complete("STAGING_DATABASE_CREATE", prefix["create_receipt"])
    effects.record_read_only_proof(
        EXECUTOR.POSTGRES_RESTORE_PRECONDITION_PROOF_NAME,
        prefix["restore_precondition"],
    )
    effects.begin("LOGICAL_DUMP_RESTORE", prefix["restore_intent"])
    effects.complete("LOGICAL_DUMP_RESTORE", prefix["restore_receipt"])
    effects.begin("PRIVILEGE_RECONCILE", prefix["reconcile_intent"])
    effects.complete("PRIVILEGE_RECONCILE", prefix["reconcile_receipt"])
    effects.record_read_only_proof(EXECUTOR.STAGING_CONTENT_PROOF_NAME, staging_proof)
    switch_target = EXECUTOR.postgres_guarded_switch_intent_target(
        opcode, restored_oid=restored_oid,
        candidate_oid=base["databases"]["candidate_oid"],
        staging_content_proof_sha256=staging_proof["proof_sha256"],
    )
    switch_argv = EXECUTOR.postgres_guarded_switch_intent_argv(opcode)
    switch_intent = EXECUTOR.create_side_effect_intent(
        request, "DATABASE_SWITCH", digest_value(switch_target),
        digest_value(switch_argv), prefix["recorded_at"],
    )
    effects.begin("DATABASE_SWITCH", switch_intent)
    return journal, switch_intent, activation


def probe_recorder(
        filesystem_root: Path, inputs: Any, base: dict[str, Any], activation: str,
        *, fault: Any = None,
) -> tuple[Any, Any]:
    request = journal_request(inputs, base, "PROBE")
    inputs.request = request
    journal = EXECUTOR.HandlerJournal(
        request["operation"], request["operation_id"], request["label"],
        str(filesystem_root),
    )
    return journal, EXECUTOR.DurableSideEffectRecorder(
        journal, request, activation, clock=utc_now, fault=fault,
    )


def journal_projection(journal: Any) -> dict[str, Any]:
    events = journal.load()
    if not events:
        reject("TASK70_V3_JOURNAL_PROJECTION_INVALID")
    for item in events:
        payload = item.get("payload") or {}
        identity_fields = {
            "SIDE_EFFECT_STARTED": "intent_sha256",
            "SIDE_EFFECT_RECORDED": "receipt_sha256",
            "SIDE_EFFECT_RECOVERY_STARTED": "recovery_attempt_sha256",
            "READ_ONLY_PROOF_RECORDED": None,
        }
        if item["event"] not in identity_fields:
            reject("TASK70_V3_JOURNAL_PROJECTION_INVALID")
        identity_field = identity_fields.get(item["event"])
        embedded_identity_sha256 = item["side_effect_identity_sha256"] \
            if identity_field is None else payload.get(identity_field)
        expected_event_identity_sha256 = digest_value(payload) \
            if item["event"] in {"SIDE_EFFECT_STARTED", "SIDE_EFFECT_RECORDED"} \
            else embedded_identity_sha256
        if SHA256.fullmatch(embedded_identity_sha256 or "") is None \
                or expected_event_identity_sha256 \
                    != item["side_effect_identity_sha256"]:
            reject("TASK70_V3_JOURNAL_PROJECTION_INVALID")
    started_names = [item["side_effect_name"] for item in events
                     if item["event"] == "SIDE_EFFECT_STARTED"]
    recorded = [item for item in events if item["event"] == "SIDE_EFFECT_RECORDED"]
    recorded_names = [item["side_effect_name"] for item in recorded]
    receipt_sha256 = [item["payload"]["receipt_sha256"] for item in recorded]
    closed = started_names == list(
        EXECUTOR.SIDE_EFFECTS_BY_LABEL["POSTGRESQL_RESTORE"],
    ) and recorded_names == started_names
    closure_sha256 = digest_value({
        "operation_id": events[0]["operation_id"],
        "label": events[0]["label"],
        "runtime_plan_sha256": events[0]["runtime_plan_sha256"],
        "ordered_receipt_sha256": receipt_sha256,
    }) if closed else None
    body = {
        "operation_id": events[0]["operation_id"],
        "label": events[0]["label"],
        "runtime_plan_sha256": events[0]["runtime_plan_sha256"],
        "event_count": len(events),
        "events": copy.deepcopy(events),
        "recovery_attempt_count": sum(
            item["event"] == "SIDE_EFFECT_RECOVERY_STARTED" for item in events
        ),
        "switch_receipt_count": sum(
            item["event"] == "SIDE_EFFECT_RECORDED"
            and item["side_effect_name"] == "DATABASE_SWITCH" for item in events
        ),
        "ordered_receipt_sha256": receipt_sha256,
        "side_effect_closure_sha256": closure_sha256,
    }
    return {**body, "journal_projection_sha256": digest_value(body)}


class ProductionRecoveryDriver:
    def __init__(self, delegate: Any, dump_inventory_sha256: str):
        self.delegate = delegate
        self.dump_inventory_sha256 = dump_inventory_sha256
        self.recovery_execution_count = 0
        self.last_switch_outcome: dict[str, Any] | None = None
        self.observations: list[dict[str, Any]] = []

    def __getattr__(self, name: str) -> Any:
        return getattr(self.delegate, name)

    def dump_inventory(self, _base: dict[str, Any], _dump_fd: int) -> dict[str, str]:
        return {"inventory_sha256": self.dump_inventory_sha256}

    def observe(
            self, base: dict[str, Any], phase: str, binding_sha256: str,
    ) -> dict[str, Any]:
        value = self.delegate.observe(base, phase, binding_sha256)
        self.observations.append(copy.deepcopy(value))
        return value

    def execute_guarded_switch(
            self, base: dict[str, Any], inputs: Any, *,
            opcode: dict[str, Any], restored_oid: str,
    ) -> dict[str, Any]:
        self.recovery_execution_count += 1
        outcome = self.delegate.execute_guarded_switch(
            base, inputs, opcode=opcode, restored_oid=restored_oid,
        )
        self.last_switch_outcome = outcome
        return outcome


class ResponseLossRecoveryDriver(ProductionRecoveryDriver):
    def __init__(self, delegate: Any, dump_inventory_sha256: str):
        super().__init__(delegate, dump_inventory_sha256)
        self.response_loss_raised = False

    def execute_guarded_switch(
            self, base: dict[str, Any], inputs: Any, *,
            opcode: dict[str, Any], restored_oid: str,
    ) -> dict[str, Any]:
        super().execute_guarded_switch(
            base, inputs, opcode=opcode, restored_oid=restored_oid,
        )
        self.response_loss_raised = True
        raise EXECUTOR.HandlerOutcomeUnknown(
            "SIDE_EFFECT_OUTCOME_UNKNOWN", "AFTER_SIDE_EFFECT",
            side_effects_started=True, uncertain_action="EXECUTE",
        )


def recovery_layout_evidence(
        driver: ProductionRecoveryDriver, *, base: dict[str, Any],
        restored_oid: str, observation_sha256: str,
) -> dict[str, Any]:
    matches = [item for item in driver.observations
               if item.get("observation_sha256") == observation_sha256]
    if len(matches) != 1:
        reject("TASK70_V3_RECOVERY_OBSERVATION_INVALID")
    observation = matches[0]
    classification = EXECUTOR.classify_pg_rollback_layout(
        observation, base=base, restored_oid=restored_oid,
    )
    require_layout(classification, "OLD")
    return {
        "observation": observation,
        "classification": classification,
    }


def run_production_recovery_probe(
        runtime: Any, inputs: Any, journal: Any, effects: Any,
) -> tuple[dict[str, Any], str]:
    outcome = runtime.probe(
        "POSTGRESQL_RESTORE", inputs, journal.load(), effects,
    )
    if not isinstance(outcome, dict) or set(outcome) != {"evidence"} \
            or not isinstance(outcome["evidence"], dict):
        reject("TASK70_V3_PRODUCTION_RECOVERY_RESULT_INVALID")
    try:
        evidence = EXECUTOR.validate_handler_evidence(
            "ROLLBACK_EXECUTION", "POSTGRESQL_RESTORE", outcome["evidence"],
        )
        effects.validate_terminal_evidence(evidence)
        closure_sha256 = effects.assert_closed()
    except EXECUTOR.FixedExecutorError as error:
        raise DynamicGuardedSwitchError(str(error)) from error
    if not SHA256.fullmatch(closure_sha256 or ""):
        reject("TASK70_V3_PRODUCTION_RECOVERY_RESULT_INVALID")
    return evidence, closure_sha256


def secure_remove_journal_tree(path: Path, expected_parent: Path) -> None:
    try:
        if path.parent != expected_parent or not path.is_dir() or path.is_symlink():
            reject("TASK70_V3_JOURNAL_CLEANUP_INVALID")
        for root, directories, files in os.walk(path, topdown=False, followlinks=False):
            root_path = Path(root)
            if not root_path.resolve().is_relative_to(path.resolve()):
                reject("TASK70_V3_JOURNAL_CLEANUP_INVALID")
            for name in files:
                child = root_path / name
                metadata = child.lstat()
                if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
                    reject("TASK70_V3_JOURNAL_CLEANUP_INVALID")
            for name in directories:
                child = root_path / name
                metadata = child.lstat()
                if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
                    reject("TASK70_V3_JOURNAL_CLEANUP_INVALID")
        shutil.rmtree(path)
    except OSError as error:
        raise DynamicGuardedSwitchError("TASK70_V3_JOURNAL_CLEANUP_INVALID") from error
    if path.exists() or path.is_symlink():
        reject("TASK70_V3_JOURNAL_CLEANUP_INVALID")


def guarded_command_projection(
        opcode: dict[str, Any], *, execution_count: int,
        response_delivered: bool, execution_receipt: dict[str, Any],
        ack: dict[str, Any] | None = None,
        failure_code: str | None = None,
) -> dict[str, Any]:
    if ack is not None and (
            set(ack) != {
                "schema_version", "contract", "opcode", "stdout_bytes",
                "stdout_sha256", "ack_sha256",
            }
            or ack.get("schema_version") != 1
            or ack.get("contract")
                != "chenyida-erp-uat-rollback-postgresql-mutation-ack/v1"
            or ack.get("opcode") != opcode["opcode"]
            or not isinstance(ack.get("stdout_bytes"), int)
            or ack["stdout_bytes"] < 1
            or SHA256.fullmatch(ack.get("stdout_sha256") or "") is None
            or SHA256.fullmatch(ack.get("ack_sha256") or "") is None
            or digest_value({key: value for key, value in ack.items()
                             if key != "ack_sha256"}) != ack["ack_sha256"]
    ):
        reject("TASK70_V3_GUARDED_COMMAND_ACK_INVALID")
    if not isinstance(execution_receipt, dict) \
            or SHA256.fullmatch(
                execution_receipt.get("execution_receipt_sha256") or "",
            ) is None \
            or ack is not None and (
                execution_receipt.get("stdout_bytes") != ack["stdout_bytes"]
                or execution_receipt.get("stdout_sha256") != ack["stdout_sha256"]
            ):
        reject("TASK70_V3_GUARDED_COMMAND_ACK_INVALID")
    body = {
        "opcode": opcode["opcode"],
        "opcode_spec_sha256": opcode["opcode_spec_sha256"],
        "sql_sha256": opcode["sql_sha256"],
        "runner_argv_template_sha256": opcode["argv_template_sha256"],
        "execution_count": execution_count,
        "response_delivered": response_delivered,
        "mutation_ack_sha256": None if ack is None else ack["ack_sha256"],
        "stdout_bytes": None if ack is None else ack["stdout_bytes"],
        "stdout_sha256": None if ack is None else ack["stdout_sha256"],
        "execution_receipt_sha256":
            execution_receipt["execution_receipt_sha256"],
        "failure_code": failure_code,
    }
    return {**body, "command_projection_sha256": digest_value(body)}


def build_assertions(
        policy: dict[str, Any], business: dict[str, Any],
        before_fingerprint: str, after_fingerprint: str,
        cleanup_sha256: str,
) -> list[dict[str, Any]]:
    by_id = {item["scenario_id"]: item for item in business["scenarios"]}
    values = [
        assertion("FULL_46_MIGRATION_FIXTURE_APPLIED", {
            "migration_count": business["migration"]["count"],
            "migration_head": business["migration"]["head"],
            "ledger_file_sha256": business["migration"]["ledger_file_sha256"],
            "allowlist_sha256": business["migration"]["allowlist_sha256"],
            "ledger_sha256": business["migration"]["ledger_sha256"],
            "apply_receipt_set_sha256": business["migration"]["apply_receipt_set_sha256"],
        }),
        assertion("NINE_ROLES_FOUR_MEMBERSHIPS_REPROVED", {
            "managed_role_count": len(business["security_state"]["roles"]),
            "managed_membership_count": len(business["security_state"]["memberships"]),
            "live_security_state_sha256": business["security_state_sha256"],
        }),
        assertion("CONTENT_REPORT_SHA_BOUND", business["content_report"]),
        assertion("PRODUCTION_V3_SQL_SHA_BOUND", {
            "opcode": business["guarded_opcode"]["opcode"],
            "opcode_spec_sha256": business["guarded_opcode"]["opcode_spec_sha256"],
            "sql_sha256": business["guarded_opcode"]["sql_sha256"],
            "sql_bytes": business["guarded_sql_bytes"],
            "source_reconciliation_sha256":
                business["guarded_opcode"]["bindings"]["source_reconciliation_sha256"],
        }),
        assertion("EXACT_SWITCH_NEW_SEALED", {
            "scenario_sha256": by_id["EXACT_V3_SUCCESS"]["scenario_sha256"],
            "before_layout": by_id["EXACT_V3_SUCCESS"]["before_layout"],
            "after_layout": by_id["EXACT_V3_SUCCESS"]["after_layout"],
        }),
        assertion("DATABASE_OIDS_PRESERVED", {
            "candidate_oid": business["base_spec"]["databases"]["candidate_oid"],
            "restored_oid": business["restored_oid"],
            "success_after_state_sha256":
                by_id["EXACT_V3_SUCCESS"]["after_state_sha256"],
        }),
        assertion("REPEAT_EXECUTION_FAILS_CLOSED", {
            "scenario_sha256": by_id["REPEAT_FAIL_CLOSED"]["scenario_sha256"],
            "failure_code": by_id["REPEAT_FAIL_CLOSED"]["failure_code"],
            "state_unchanged": by_id["REPEAT_FAIL_CLOSED"]["state_unchanged"],
        }),
        assertion("CONTENT_MIGRATION_AND_SECURITY_DRIFT_REJECTED", {
            "scenario_sha256": [
                by_id[name]["scenario_sha256"] for name in (
                    "CONTENT_DRIFT_REJECTED", "MIGRATION_LEDGER_DRIFT_REJECTED",
                    "SECURITY_DRIFT_REJECTED",
                )
            ],
            "all_old_layout": all(by_id[name]["after_layout"] == "OLD" for name in (
                "CONTENT_DRIFT_REJECTED", "MIGRATION_LEDGER_DRIFT_REJECTED",
                "SECURITY_DRIFT_REJECTED",
            )),
        }),
        assertion("ORDINARY_ROLE_CANNOT_ENTER_SEALED_STAGING", {
            "scenario_sha256":
                by_id["ORDINARY_ROLE_CONNECTION_REJECTED"]["scenario_sha256"],
            "role": "chenyida_erp_web", "connection_limit": 0,
        }),
        assertion("FIRST_RENAME_FAULT_ROLLS_BACK", {
            "scenario_sha256":
                by_id["FIRST_RENAME_FAULT_ROLLBACK"]["scenario_sha256"],
            "barrier": FAULT_BARRIER,
            "after_layout": by_id["FIRST_RENAME_FAULT_ROLLBACK"]["after_layout"],
        }),
        assertion("OLD_LAYOUT_HAS_ONE_DURABLE_RECOVERY_ATTEMPT", {
            "scenario_sha256":
                by_id["PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY"]["scenario_sha256"],
            "recovery_attempt_count": 1, "production_recovery_execution_count": 1,
            "restart_probe_invocation_count": 1,
            "restart_physical_switch_execution_count": 0,
        }),
        assertion("UNKNOWN_RECOVERY_ATTEMPT_IS_NOT_REPLAYED", {
            "scenario_sha256":
                by_id["RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY"]["scenario_sha256"],
            "second_reservation_granted": False,
            "total_production_recovery_execution_count": 0,
            "second_probe_invocation_count": 1,
            "second_probe_physical_switch_execution_count": 0,
        }),
        assertion("NEW_SEALED_CALLER_DISCARDED_RESPONSE_IS_NOT_REPLAYED", {
            "scenario_sha256":
                by_id["COMMIT_RESPONSE_LOSS_NO_REPLAY"]["scenario_sha256"],
            "recovery_attempt_count": 1, "production_execution_count": 1,
            "restart_probe_invocation_count": 1,
            "restart_physical_switch_execution_count": 0,
        }),
        assertion("NO_PERSISTENT_MIXED_LAYOUT", {
            "scenario_sha256": [item["scenario_sha256"] for item in business["scenarios"]],
            "mixed_layout_count": 0,
        }),
        assertion("EXISTING_RUNTIME_AND_PROTECTED_VOLUME_IDENTITIES_UNCHANGED", {
            "before_fingerprint_sha256": before_fingerprint,
            "after_fingerprint_sha256": after_fingerprint,
            "cleanup_receipt_sha256": cleanup_sha256,
        }),
    ]
    if [item["id"] for item in values] \
            != policy["case_catalog"][0]["required_assertions"]:
        reject("TASK70_V3_ASSERTION_ORDER_INVALID")
    return values


def run_business_case(
        *, container_id: str, policy: dict[str, Any], source: dict[str, Any],
        image: dict[str, Any], monitor: Any, temp_root: Path, run_id: str,
) -> dict[str, Any]:
    privilege_policy = secure_json(
        SITE_ROOT / "operations/postgresql-runtime-privilege-policy-v2.json",
        "TASK70_V3_PRIVILEGE_POLICY_INVALID",
    )
    setup_receipt = execute_psql_success(
        container_id, "cluster_setup", setup_cluster_sql(policy, privilege_policy),
    )
    monitor.raise_if_failed()
    target_guards = [LEGACY.verify_target_guard(container_id, policy)]
    identity = LEGACY.read_database_identity(container_id)
    records, migration_ledger = migration_sources(policy)
    migration_receipts = apply_migrations(container_id, policy, records)
    monitor.raise_if_failed()
    report_raw, content_report = capture_content_report(
        container_id, "baseline_content",
    )
    fixture_database_bytes = database_size(container_id)
    inputs = materialize_inputs(
        identity=identity, container_id=container_id,
        image_reference=policy["case_catalog"][0]["postgres_image_reference"],
        image_id=image["id"], git_commit=source["git_commit"],
        application_version=source["application_version"],
        migration_ledger=migration_ledger, report_raw=report_raw,
        database_bytes=fixture_database_bytes,
    )
    try:
        base = EXECUTOR.derive_pg_rollback_base_spec(inputs)
    except EXECUTOR.FixedExecutorError as error:
        raise DynamicGuardedSwitchError(str(error)) from error
    restored_oid = identity["staging_oid"]
    if base["postgres"]["container_id"] != container_id \
            or base["postgres"]["system_identifier"] != identity["system_identifier"] \
            or base["databases"]["candidate_oid"] != identity["active_oid"] \
            or restored_oid == base["databases"]["candidate_oid"]:
        reject("TASK70_V3_BASE_IDENTITY_INVALID")

    real = RealPostgres(inputs)
    journal_parent = temp_root / "journal-evidence"
    journal_parent.mkdir(mode=0o700)
    scenarios_by_id: dict[str, dict[str, Any]] = {}
    try:
        configure_runtime_inputs(inputs, base)
        journal_recorded_at = utc_now()
        dump_inventory_sha256 = digest_value({
            "case_id": CASE_ID,
            "fixture_class": "SYNTHETIC_POSTGRES_DUMP_INVENTORY",
            "dump_sha256": base["snapshot"]["dump_sha256"],
            "dump_bytes": base["snapshot"]["dump_bytes"],
        })
        prefix_before_reconcile = build_prefix_material_before_reconcile(
            inputs, base, restored_oid=restored_oid,
            dump_inventory_sha256=dump_inventory_sha256,
            recorded_at=journal_recorded_at,
        )
        reconcile = real.driver.reconcile(
            base, inputs,
            restore_receipt_sha256=
                prefix_before_reconcile["restore_receipt"]["receipt_sha256"],
            restored_oid=restored_oid,
        )
        reconciliation_sql = EXECUTOR.render_pg_reconciliation_sql(
            base, inputs, reconcile["opcode"]["bindings"],
        )
        if digest_bytes(reconciliation_sql) != reconcile["opcode"]["sql_sha256"]:
            reject("TASK70_V3_RECONCILIATION_SQL_BINDING_INVALID")
        reconciliation_execution_receipt = real.take_execution_receipt("reconcile")
        validate_mutation_ack_execution_binding(
            reconcile["ack"], reconciliation_execution_receipt,
            base=base, opcode=reconcile["opcode"], sql=reconciliation_sql,
            sequence=1,
        )
        prefix = complete_prefix_material(prefix_before_reconcile, reconcile)
        privilege_receipt_sha256 = prefix["reconcile_receipt"]["receipt_sha256"]
        proof_observed = real.driver.prove_staging_content(
            inputs, base, restored_oid=restored_oid,
            binding_sha256=privilege_receipt_sha256,
        )
        staging_proof = EXECUTOR.build_staging_content_proof(
            proof_observed, base, privilege_receipt_sha256,
        )
        guarded_opcode = real.driver.guarded_switch_opcode(
            base, inputs,
            privilege_receipt_sha256=privilege_receipt_sha256,
            staging_content_proof_sha256=staging_proof["proof_sha256"],
            restored_oid=restored_oid,
            before_observation_sha256=staging_proof["after_observation_sha256"],
        )
        guarded_sql = EXECUTOR.render_pg_guarded_switch_sql(
            base, inputs, guarded_opcode["bindings"],
        )
        if digest_bytes(guarded_sql) != guarded_opcode["sql_sha256"] \
                or len(guarded_sql) > base["runtime_limits"]["sql_max_bytes"]:
            reject("TASK70_V3_GUARDED_SQL_BINDING_INVALID")
        sql_roots = sql_normalization_roots(
            base=base, restored_oid=restored_oid,
            reconciliation=reconcile["opcode"], production=guarded_opcode,
            security_state=proof_observed["security"]["state"],
            content_report_raw=report_raw,
            migration_records=records,
        )
        reconciliation_sql_evidence = compressed_sql_evidence(
            reconciliation_sql, sql_roots,
            "TASK70_V3_RECONCILIATION_SQL_NORMALIZATION_INVALID",
            "RECONCILIATION",
        )
        production_sql_evidence = compressed_sql_evidence(
            guarded_sql, sql_roots,
            "TASK70_V3_PRODUCTION_SQL_NORMALIZATION_INVALID",
            "PRODUCTION",
        )
        validate_primary_sql_normalization(
            policy, reconciliation_sql_evidence, production_sql_evidence,
        )

        before, before_classification = observe(
            real, base, restored_oid, "v3-success-before",
        )
        require_layout(before_classification, "OLD")
        if before_classification["state_projection_sha256"] \
                != reconcile["classification"]["state_projection_sha256"]:
            reject("TASK70_V3_STATE_CHAIN_INVALID")
        switched = real.driver.execute_guarded_switch(
            base, inputs, opcode=guarded_opcode, restored_oid=restored_oid,
        )
        success_execution_receipt = real.take_execution_receipt("guardedswitch")
        validate_mutation_ack_execution_binding(
            switched["ack"], success_execution_receipt,
            base=base, opcode=guarded_opcode, sql=guarded_sql, sequence=2,
        )
        require_layout(switched["classification"], "NEW_SEALED")
        scenarios_by_id["EXACT_V3_SUCCESS"] = scenario({
            "scenario_id": "EXACT_V3_SUCCESS",
            "before_layout": "OLD", "after_layout": "NEW_SEALED",
            "before_state_sha256": before_classification["state_projection_sha256"],
            "after_state_sha256":
                switched["classification"]["state_projection_sha256"],
            "command": guarded_command_projection(
                guarded_opcode, execution_count=1, response_delivered=True,
                execution_receipt=success_execution_receipt, ack=switched["ack"],
            ),
            "execution_receipt": success_execution_receipt,
            "mutation_ack": switched["ack"],
            "mutation_ack_sha256": switched["ack"]["ack_sha256"],
        })

        repeat_before, repeat_before_classification = observe(
            real, base, restored_oid, "v3-repeat-before",
        )
        require_layout(repeat_before_classification, "NEW_SEALED")
        repeat_failure, repeat_execution_receipt = execute_guarded_failure(
            real, base, inputs, guarded_opcode,
            {"SIDE_EFFECT_OUTCOME_UNKNOWN"},
            sql=guarded_sql, sequence=3, reason="TARGET_DATABASE_MISSING",
        )
        repeat_after, repeat_after_classification = observe(
            real, base, restored_oid, "v3-repeat-after",
        )
        require_layout(repeat_after_classification, "NEW_SEALED")
        repeat_unchanged = repeat_before_classification["state_projection_sha256"] \
            == repeat_after_classification["state_projection_sha256"]
        if not repeat_unchanged:
            reject("TASK70_V3_REPEAT_CHANGED_STATE")
        scenarios_by_id["REPEAT_FAIL_CLOSED"] = scenario({
            "scenario_id": "REPEAT_FAIL_CLOSED",
            "before_layout": "NEW_SEALED", "after_layout": "NEW_SEALED",
            "failure_code": repeat_failure, "state_unchanged": repeat_unchanged,
            "failure_reason": "TARGET_DATABASE_MISSING",
            "execution_receipt": repeat_execution_receipt,
            "before_state_sha256":
                repeat_before_classification["state_projection_sha256"],
            "after_state_sha256": repeat_after_classification["state_projection_sha256"],
        })
        reset_receipts: list[dict[str, Any]] = [reset_old_layout(
            container_id, base, restored_oid, "reset_after_success",
        )]
        reset_observation, reset_classification = observe(
            real, base, restored_oid, "v3-reset-after-success",
        )
        require_layout(reset_classification, "OLD")

        content_apply = execute_psql_success(
            container_id, "content_drift_apply",
            b"INSERT INTO public.app_meta(key,value) "
            b"VALUES ('dv70_v3_content_drift','synthetic-only');\n",
            database=base["databases"]["staging_name"], write_override=True,
        )
        content_failure, content_execution_receipt = execute_guarded_failure(
            real, base, inputs, guarded_opcode,
            {"SIDE_EFFECT_OUTCOME_UNKNOWN"},
            sql=guarded_sql, sequence=4,
            reason="CONTENT_GUARD_RELATION_MISMATCH",
        )
        content_after, content_after_classification = observe(
            real, base, restored_oid, "v3-content-drift-after",
        )
        require_layout(content_after_classification, "OLD")
        content_restore = execute_psql_success(
            container_id, "content_drift_restore",
            b"DELETE FROM public.app_meta WHERE key='dv70_v3_content_drift';\n",
            database=base["databases"]["staging_name"], write_override=True,
        )
        restored_report_raw, restored_report = capture_content_report(
            container_id, "content_drift_reproof",
        )
        if restored_report_raw != report_raw or restored_report != content_report:
            reject("TASK70_V3_CONTENT_RESTORE_INVALID")
        scenarios_by_id["CONTENT_DRIFT_REJECTED"] = scenario({
            "scenario_id": "CONTENT_DRIFT_REJECTED",
            "failure_code": content_failure, "after_layout": "OLD",
            "failure_reason": "CONTENT_GUARD_RELATION_MISMATCH",
            "execution_receipt": content_execution_receipt,
            "drift_apply_receipt": content_apply,
            "drift_restore_receipt": content_restore,
            "restored_report_sha256": restored_report["sha256"],
            "after_state_sha256":
                content_after_classification["state_projection_sha256"],
        })

        original_checksum = records[0]["checksum"]
        drift_checksum = "0" * 64 if original_checksum != "0" * 64 else "1" * 64
        migration_apply = execute_psql_success(
            container_id, "migration_drift_apply",
            f"UPDATE public.schema_migrations SET checksum={quote_literal(drift_checksum)} "
            f"WHERE version={quote_literal(records[0]['version'])};\n".encode("utf-8"),
            database=base["databases"]["staging_name"], write_override=True,
        )
        migration_failure, migration_execution_receipt = execute_guarded_failure(
            real, base, inputs, guarded_opcode,
            {"SIDE_EFFECT_OUTCOME_UNKNOWN"},
            sql=guarded_sql, sequence=5,
            reason="CONTENT_GUARD_RELATION_MISMATCH",
        )
        migration_after, migration_after_classification = observe(
            real, base, restored_oid, "v3-migration-drift-after",
        )
        require_layout(migration_after_classification, "OLD")
        migration_restore = execute_psql_success(
            container_id, "migration_drift_restore",
            f"UPDATE public.schema_migrations SET checksum={quote_literal(original_checksum)} "
            f"WHERE version={quote_literal(records[0]['version'])};\n".encode("utf-8"),
            database=base["databases"]["staging_name"], write_override=True,
        )
        restored_ledger = real.runner.postgres_postverify_migrations(
            base["databases"]["staging_name"], sealed_staging=True,
        )
        if restored_ledger != migration_ledger:
            reject("TASK70_V3_MIGRATION_RESTORE_INVALID")
        scenarios_by_id["MIGRATION_LEDGER_DRIFT_REJECTED"] = scenario({
            "scenario_id": "MIGRATION_LEDGER_DRIFT_REJECTED",
            "failure_code": migration_failure, "after_layout": "OLD",
            "failure_reason": "CONTENT_GUARD_RELATION_MISMATCH",
            "execution_receipt": migration_execution_receipt,
            "drift_apply_receipt": migration_apply,
            "drift_restore_receipt": migration_restore,
            "ledger_file_sha256": digest_bytes(restored_ledger),
            "after_state_sha256":
                migration_after_classification["state_projection_sha256"],
        })

        security_apply = execute_psql_success(
            container_id, "security_drift_apply",
            b"REVOKE SELECT ON public.app_users FROM chenyida_erp_web_priv;\n",
            database=base["databases"]["staging_name"], write_override=True,
        )
        security_failure, security_execution_receipt = execute_guarded_failure(
            real, base, inputs, guarded_opcode,
            {"SIDE_EFFECT_OUTCOME_UNKNOWN"},
            sql=guarded_sql, sequence=6,
            reason="RUNTIME_PRIVILEGE_MISMATCH",
        )
        security_after, security_after_classification = observe(
            real, base, restored_oid, "v3-security-drift-after",
        )
        require_layout(security_after_classification, "OLD")
        security_restore = real.driver.reconcile(
            base, inputs, restore_receipt_sha256=digest_value({
                "case_id": CASE_ID, "phase": "SECURITY_DRIFT_RESTORE",
                "apply_receipt_sha256": security_apply["receipt_sha256"],
            }), restored_oid=restored_oid,
        )
        security_restore_sql = EXECUTOR.render_pg_reconciliation_sql(
            base, inputs, security_restore["opcode"]["bindings"],
        )
        security_restore_execution_receipt = real.take_execution_receipt("reconcile")
        validate_mutation_ack_execution_binding(
            security_restore["ack"], security_restore_execution_receipt,
            base=base, opcode=security_restore["opcode"],
            sql=security_restore_sql, sequence=7,
        )
        security_restore_sql_roots = copy.deepcopy(sql_roots)
        security_restore_sql_roots["opcodes"]["reconciliation"] = \
            security_restore["opcode"]
        security_restore_sql_evidence = compressed_sql_evidence(
            security_restore_sql, security_restore_sql_roots,
            "TASK70_V3_SECURITY_RESTORE_SQL_BINDING_INVALID",
            "RECONCILIATION",
        )
        if digest_bytes(security_restore_sql) \
                != security_restore["opcode"]["sql_sha256"] \
                or security_restore_sql_evidence["normalized_sha256"] \
                != policy["sql_evidence"]["reconciliation_normalized_sha256"]:
            reject("TASK70_V3_SECURITY_RESTORE_SQL_BINDING_INVALID")
        restored_security = real.driver.prove_staging_content(
            inputs, base, restored_oid=restored_oid,
            binding_sha256=digest_value({
                "case_id": CASE_ID,
                "security_restore_opcode_spec_sha256":
                    security_restore["opcode"]["opcode_spec_sha256"],
            }),
        )["security"]
        if restored_security != proof_observed["security"]:
            reject("TASK70_V3_SECURITY_RESTORE_INVALID")
        scenarios_by_id["SECURITY_DRIFT_REJECTED"] = scenario({
            "scenario_id": "SECURITY_DRIFT_REJECTED",
            "failure_code": security_failure, "after_layout": "OLD",
            "failure_reason": "RUNTIME_PRIVILEGE_MISMATCH",
            "execution_receipt": security_execution_receipt,
            "drift_apply_receipt": security_apply,
            "security_restore": {
                **security_restore,
                "execution_receipt": security_restore_execution_receipt,
            },
            "security_restore_sql_evidence": security_restore_sql_evidence,
            "restored_security_state_sha256": restored_security["state_sha256"],
            "after_state_sha256":
                security_after_classification["state_projection_sha256"],
        })

        ordinary_role = "chenyida_erp_web"
        role_state = next((item for item in restored_security["state"]["roles"]
                           if item["name"] == ordinary_role), None)
        if role_state is None or role_state.get("can_login") is not True:
            reject("TASK70_V3_ORDINARY_ROLE_CONNECTION_NOT_REJECTED")
        connection_before, connection_before_classification = observe(
            real, base, restored_oid, "ordinary-role-probe-before",
        )
        require_layout(connection_before_classification, "OLD")
        connection_stdin = b"SELECT true;\n"
        connection_result, connection_argv, _connection_execution = execute_psql_bound(
            container_id, "ordinary_role_probe", connection_stdin,
            database=base["databases"]["staging_name"], username=ordinary_role,
            verbosity="verbose",
        )
        connection_rejection = ordinary_role_connection_rejection_evidence(
            connection_result, argv=connection_argv,
            database=base["databases"]["staging_name"], role=ordinary_role,
            stdin=connection_stdin,
        )
        connection_after, connection_after_classification = observe(
            real, base, restored_oid, "ordinary-role-probe-after",
        )
        require_layout(connection_after_classification, "OLD")
        if connection_before_classification["state_projection_sha256"] \
                != connection_after_classification["state_projection_sha256"]:
            reject("TASK70_V3_ORDINARY_ROLE_CONNECTION_NOT_REJECTED")
        scenarios_by_id["ORDINARY_ROLE_CONNECTION_REJECTED"] = scenario({
            "scenario_id": "ORDINARY_ROLE_CONNECTION_REJECTED",
            "role": ordinary_role, "database_connection_limit": 0,
            "role_state_sha256": digest_value(role_state),
            "before_observation_sha256": connection_before["observation_sha256"],
            "after_observation_sha256": connection_after["observation_sha256"],
            "before_state_sha256":
                connection_before_classification["state_projection_sha256"],
            **connection_rejection,
            "after_layout": "OLD",
            "after_state_sha256":
                connection_after_classification["state_projection_sha256"],
        })

        fault_sql, fault_boundary = derive_fault_stream(guarded_sql, base)
        fault_before, fault_before_classification = observe(
            real, base, restored_oid, "v3-fault-before",
        )
        require_layout(fault_before_classification, "OLD")
        fault_receipt = execute_fault_stream(container_id, fault_sql, base)
        fault_after, fault_after_classification = observe(
            real, base, restored_oid, "v3-fault-after",
        )
        require_layout(fault_after_classification, "OLD")
        if fault_before_classification["state_projection_sha256"] \
                != fault_after_classification["state_projection_sha256"]:
            reject("TASK70_V3_FAULT_DID_NOT_ROLL_BACK")
        scenarios_by_id["FIRST_RENAME_FAULT_ROLLBACK"] = scenario({
            "scenario_id": "FIRST_RENAME_FAULT_ROLLBACK",
            "production_sql_sha256": guarded_opcode["sql_sha256"],
            "fault_sql_sha256": digest_bytes(fault_sql),
            "fault_boundary_offset_bytes": fault_boundary,
            "fault_sql_evidence": compressed_sql_evidence(
                fault_sql, sql_roots, "TASK70_V3_FAULT_SQL_BINDING_INVALID",
                "PRODUCTION",
            ),
            "fault_command_receipt": fault_receipt,
            "fault_command_receipt_sha256": fault_receipt["command_receipt_sha256"],
            "before_layout": "OLD", "after_layout": "OLD",
            "before_state_sha256":
                fault_before_classification["state_projection_sha256"],
            "after_state_sha256": fault_after_classification["state_projection_sha256"],
        })

        recovery_root = journal_parent / "recovery"
        recovery_journal, _recovery_switch_intent, recovery_activation = \
            seed_production_recovery_journal(
                recovery_root, inputs, base, prefix, staging_proof,
                guarded_opcode, restored_oid=restored_oid,
            )
        recovery_driver = ProductionRecoveryDriver(
            real.driver, dump_inventory_sha256,
        )
        recovery_runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            postgres_driver=recovery_driver, clock=utc_now,
        )
        _recovery_probe_journal, recovery_effects = probe_recorder(
            recovery_root, inputs, base, recovery_activation,
        )
        recovery_terminal_evidence, recovery_closure_sha256 = \
            run_production_recovery_probe(
                recovery_runtime, inputs, recovery_journal, recovery_effects,
            )
        recovery_execution_receipt = real.take_execution_receipt("guardedswitch")
        recovery_after, recovery_after_classification = observe(
            real, base, restored_oid, "v3-production-recovery-after",
        )
        require_layout(recovery_after_classification, "NEW_SEALED")
        if recovery_driver.recovery_execution_count != 1 \
                or not isinstance(recovery_driver.last_switch_outcome, dict):
            reject("TASK70_V3_RECOVERY_EXECUTION_COUNT_INVALID")
        validate_mutation_ack_execution_binding(
            recovery_driver.last_switch_outcome["ack"],
            recovery_execution_receipt, base=base, opcode=guarded_opcode,
            sql=guarded_sql, sequence=8,
        )
        reopened_journal, reopened_effects = probe_recorder(
            recovery_root, inputs, base, recovery_activation,
        )
        restarted_runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            postgres_driver=recovery_driver, clock=utc_now,
        )
        restart_probe_invocation_count = 0
        restart_physical_before = recovery_driver.recovery_execution_count
        restart_probe_invocation_count += 1
        restarted_terminal_evidence, restarted_closure_sha256 = \
            run_production_recovery_probe(
                restarted_runtime, inputs, reopened_journal, reopened_effects,
            )
        restart_physical_execution_count = \
            recovery_driver.recovery_execution_count - restart_physical_before
        if recovery_driver.recovery_execution_count != 1 \
                or restart_probe_invocation_count != 1 \
                or restart_physical_execution_count != 0 \
                or restarted_terminal_evidence != recovery_terminal_evidence \
                or restarted_closure_sha256 != recovery_closure_sha256:
            reject("TASK70_V3_RECOVERY_RESTART_REPLAYED")
        recovery_journal_evidence = journal_projection(reopened_journal)
        if recovery_journal_evidence["recovery_attempt_count"] != 1 \
                or recovery_journal_evidence["switch_receipt_count"] != 1:
            reject("TASK70_V3_RECOVERY_JOURNAL_INVALID")
        recovery_old_observation_sha256 = next(
            item["payload"]["recovery_observation_sha256"]
            for item in recovery_journal_evidence["events"]
            if item["event"] == "SIDE_EFFECT_RECOVERY_STARTED"
        )
        recovery_old_layout_evidence = recovery_layout_evidence(
            recovery_driver, base=base, restored_oid=restored_oid,
            observation_sha256=recovery_old_observation_sha256,
        )
        scenarios_by_id["PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY"] = scenario({
            "scenario_id": "PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY",
            "old_observation_sha256": recovery_old_observation_sha256,
            "recovery_observation": recovery_old_layout_evidence["observation"],
            "recovery_classification": recovery_old_layout_evidence["classification"],
            "old_state_sha256": fault_after_classification["state_projection_sha256"],
            "after_state_sha256":
                recovery_after_classification["state_projection_sha256"],
            "recovery_reservation_recorded": True,
            "recovery_process_model": "SAME_PROCESS_RUNTIME_RECONSTRUCTION",
            "production_recovery_execution_count": 1,
            "restart_probe_invocation_count": restart_probe_invocation_count,
            "restart_physical_switch_execution_count":
                restart_physical_execution_count,
            "response_delivered": True,
            "command": guarded_command_projection(
                guarded_opcode, execution_count=1, response_delivered=True,
                execution_receipt=recovery_execution_receipt,
                ack=recovery_driver.last_switch_outcome["ack"],
            ),
            "after_layout": "NEW_SEALED",
            "execution_receipt": recovery_execution_receipt,
            "mutation_ack": recovery_driver.last_switch_outcome["ack"],
            "terminal_evidence": recovery_terminal_evidence,
            "terminal_evidence_sha256": digest_value(recovery_terminal_evidence),
            "side_effect_closure_sha256": recovery_closure_sha256,
            "journal_projection_sha256":
                recovery_journal_evidence["journal_projection_sha256"],
        })

        reset_receipts.append(reset_old_layout(
            container_id, base, restored_oid, "reset_after_recovery",
        ))
        recovery_reset, recovery_reset_classification = observe(
            real, base, restored_oid, "v3-reset-after-recovery",
        )
        require_layout(recovery_reset_classification, "OLD")

        unknown_root = journal_parent / "recovery-attempt-unknown"
        unknown_journal, _unknown_switch_intent, unknown_activation = \
            seed_production_recovery_journal(
                unknown_root, inputs, base, prefix, staging_proof,
                guarded_opcode, restored_oid=restored_oid,
            )
        unknown_driver = ProductionRecoveryDriver(
            real.driver, dump_inventory_sha256,
        )
        unknown_execution_count_before = len(real.execution_receipts)
        crash_points: list[str] = []

        class SimulatedRecoveryCrash(RuntimeError):
            pass

        def crash_after_reservation(point: str, _request: dict[str, Any]) -> None:
            crash_points.append(point)
            if point == "AFTER_SIDE_EFFECT_RECOVERY_STARTED_DATABASE_SWITCH":
                raise SimulatedRecoveryCrash(point)

        _unknown_probe_journal, crashing_effects = probe_recorder(
            unknown_root, inputs, base, unknown_activation,
            fault=crash_after_reservation,
        )
        crashing_runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            postgres_driver=unknown_driver, clock=utc_now,
        )
        try:
            crashing_runtime.probe(
                "POSTGRESQL_RESTORE", inputs,
                unknown_journal.load(), crashing_effects,
            )
        except SimulatedRecoveryCrash:
            pass
        else:
            reject("TASK70_V3_RECOVERY_RESERVATION_CRASH_MISSING")
        if crash_points != ["AFTER_SIDE_EFFECT_RECOVERY_STARTED_DATABASE_SWITCH"] \
                or unknown_driver.recovery_execution_count != 0:
            reject("TASK70_V3_RECOVERY_RESERVATION_CRASH_INVALID")
        unknown_after_crash, unknown_after_crash_classification = observe(
            real, base, restored_oid, "v3-recovery-unknown-after-crash",
        )
        require_layout(unknown_after_crash_classification, "OLD")
        reopened_unknown_journal, reopened_unknown_effects = probe_recorder(
            unknown_root, inputs, base, unknown_activation,
        )
        second_probe_runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            postgres_driver=unknown_driver, clock=utc_now,
        )
        second_probe_invocation_count = 0
        second_physical_before = unknown_driver.recovery_execution_count
        try:
            second_probe_invocation_count += 1
            second_probe_runtime.probe(
                "POSTGRESQL_RESTORE", inputs,
                reopened_unknown_journal.load(), reopened_unknown_effects,
            )
        except EXECUTOR.HandlerOutcomeUnknown as error:
            if error.reason_code != "SIDE_EFFECT_OUTCOME_UNKNOWN" \
                    or error.phase != "PROBE" \
                    or error.side_effects_started is not True \
                    or error.uncertain_action != "EXECUTE":
                reject("TASK70_V3_SECOND_RECOVERY_OUTCOME_INVALID")
            second_failure_code = error.reason_code
        else:
            reject("TASK70_V3_SECOND_RECOVERY_REPLAYED")
        second_physical_execution_count = \
            unknown_driver.recovery_execution_count - second_physical_before
        if unknown_driver.recovery_execution_count != 0 \
                or second_probe_invocation_count != 1 \
                or second_physical_execution_count != 0 \
                or len(real.execution_receipts) != unknown_execution_count_before:
            reject("TASK70_V3_SECOND_RECOVERY_REPLAYED")
        unknown_journal_evidence = journal_projection(reopened_unknown_journal)
        if unknown_journal_evidence["recovery_attempt_count"] != 1 \
                or unknown_journal_evidence["switch_receipt_count"] != 0:
            reject("TASK70_V3_UNKNOWN_RECOVERY_JOURNAL_INVALID")
        unknown_old_observation_sha256 = next(
            item["payload"]["recovery_observation_sha256"]
            for item in unknown_journal_evidence["events"]
            if item["event"] == "SIDE_EFFECT_RECOVERY_STARTED"
        )
        unknown_old_layout_evidence = recovery_layout_evidence(
            unknown_driver, base=base, restored_oid=restored_oid,
            observation_sha256=unknown_old_observation_sha256,
        )
        scenarios_by_id["RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY"] = scenario({
            "scenario_id": "RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY",
            "old_observation_sha256": unknown_old_observation_sha256,
            "recovery_observation": unknown_old_layout_evidence["observation"],
            "recovery_classification": unknown_old_layout_evidence["classification"],
            "reservation_crash_point": crash_points[0],
            "crash_model": "IN_PROCESS_EXCEPTION_AFTER_DURABLE_RESERVATION",
            "second_reservation_granted": False,
            "second_probe_failure_code": second_failure_code,
            "second_probe_invocation_count": second_probe_invocation_count,
            "second_probe_physical_switch_execution_count":
                second_physical_execution_count,
            "total_production_recovery_execution_count": 0,
            "recovery_attempt_count":
                unknown_journal_evidence["recovery_attempt_count"],
            "switch_receipt_count":
                unknown_journal_evidence["switch_receipt_count"],
            "after_layout": "OLD",
            "after_state_sha256":
                unknown_after_crash_classification["state_projection_sha256"],
            "journal_projection_sha256":
                unknown_journal_evidence["journal_projection_sha256"],
        })

        commit_root = journal_parent / "commit-loss"
        commit_journal, _commit_switch_intent, commit_activation = \
            seed_production_recovery_journal(
                commit_root, inputs, base, prefix, staging_proof,
                guarded_opcode, restored_oid=restored_oid,
            )
        commit_before, commit_before_classification = observe(
            real, base, restored_oid, "v3-commit-loss-before",
        )
        require_layout(commit_before_classification, "OLD")
        commit_driver = ResponseLossRecoveryDriver(
            real.driver, dump_inventory_sha256,
        )
        _commit_loss_journal, commit_loss_effects = probe_recorder(
            commit_root, inputs, base, commit_activation,
        )
        commit_loss_runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            postgres_driver=commit_driver, clock=utc_now,
        )
        try:
            commit_loss_runtime.probe(
                "POSTGRESQL_RESTORE", inputs,
                commit_journal.load(), commit_loss_effects,
            )
        except EXECUTOR.HandlerOutcomeUnknown as error:
            if error.reason_code != "SIDE_EFFECT_OUTCOME_UNKNOWN" \
                    or error.phase != "AFTER_SIDE_EFFECT" \
                    or error.side_effects_started is not True \
                    or error.uncertain_action != "EXECUTE":
                reject("TASK70_V3_COMMIT_RESPONSE_LOSS_INVALID")
            commit_failure_code = error.reason_code
        else:
            reject("TASK70_V3_COMMIT_RESPONSE_LOSS_MISSING")
        commit_execution_receipt = real.take_execution_receipt("guardedswitch")
        if commit_driver.recovery_execution_count != 1 \
                or commit_driver.response_loss_raised is not True \
                or not isinstance(commit_driver.last_switch_outcome, dict):
            reject("TASK70_V3_COMMIT_RESPONSE_LOSS_INVALID")
        validate_mutation_ack_execution_binding(
            commit_driver.last_switch_outcome["ack"], commit_execution_receipt,
            base=base, opcode=guarded_opcode, sql=guarded_sql, sequence=9,
        )
        commit_after, commit_after_classification = observe(
            real, base, restored_oid, "v3-commit-loss-after",
        )
        require_layout(commit_after_classification, "NEW_SEALED")
        reopened_commit_journal, commit_probe_effects = probe_recorder(
            commit_root, inputs, base, commit_activation,
        )
        commit_runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            postgres_driver=commit_driver, clock=utc_now,
        )
        commit_restart_probe_invocation_count = 0
        commit_restart_physical_before = commit_driver.recovery_execution_count
        commit_restart_probe_invocation_count += 1
        commit_terminal_evidence, commit_closure_sha256 = \
            run_production_recovery_probe(
                commit_runtime, inputs, reopened_commit_journal,
                commit_probe_effects,
            )
        commit_restart_physical_execution_count = \
            commit_driver.recovery_execution_count - commit_restart_physical_before
        commit_journal_evidence = journal_projection(reopened_commit_journal)
        if commit_journal_evidence["recovery_attempt_count"] != 1 \
                or commit_journal_evidence["switch_receipt_count"] != 1 \
                or commit_driver.recovery_execution_count != 1 \
                or commit_restart_probe_invocation_count != 1 \
                or commit_restart_physical_execution_count != 0:
            reject("TASK70_V3_COMMIT_LOSS_JOURNAL_INVALID")
        commit_old_observation_sha256 = next(
            item["payload"]["recovery_observation_sha256"]
            for item in commit_journal_evidence["events"]
            if item["event"] == "SIDE_EFFECT_RECOVERY_STARTED"
        )
        commit_old_layout_evidence = recovery_layout_evidence(
            commit_driver, base=base, restored_oid=restored_oid,
            observation_sha256=commit_old_observation_sha256,
        )
        scenarios_by_id["COMMIT_RESPONSE_LOSS_NO_REPLAY"] = scenario({
            "scenario_id": "COMMIT_RESPONSE_LOSS_NO_REPLAY",
            "before_layout": "OLD", "after_layout": "NEW_SEALED",
            "old_observation_sha256": commit_old_observation_sha256,
            "recovery_observation": commit_old_layout_evidence["observation"],
            "recovery_classification": commit_old_layout_evidence["classification"],
            "production_execution_count": 1,
            "response_delivered": False, "recovery_attempt_count": 1,
            "response_loss_model":
                "CALLER_DISCARDS_COMPLETED_DELEGATE_RESULT_IN_SAME_PROCESS",
            "response_loss_failure_code": commit_failure_code,
            "restart_probe_invocation_count": commit_restart_probe_invocation_count,
            "restart_physical_switch_execution_count":
                commit_restart_physical_execution_count,
            "production_recovery_execution_count": 1,
            "command": guarded_command_projection(
                guarded_opcode, execution_count=1, response_delivered=False,
                execution_receipt=commit_execution_receipt,
                ack=commit_driver.last_switch_outcome["ack"],
            ),
            "switch_receipt_sha256":
                commit_terminal_evidence["switch_receipt_sha256"],
            "mutation_ack": commit_driver.last_switch_outcome["ack"],
            "execution_receipt": commit_execution_receipt,
            "terminal_evidence": commit_terminal_evidence,
            "terminal_evidence_sha256": digest_value(commit_terminal_evidence),
            "side_effect_closure_sha256": commit_closure_sha256,
            "journal_projection_sha256":
                commit_journal_evidence["journal_projection_sha256"],
            "before_state_sha256":
                commit_before_classification["state_projection_sha256"],
            "after_state_sha256":
                commit_after_classification["state_projection_sha256"],
        })

        old_state_sha256 = scenarios_by_id["EXACT_V3_SUCCESS"]["before_state_sha256"]
        new_state_sha256 = scenarios_by_id["EXACT_V3_SUCCESS"]["after_state_sha256"]
        old_states = [
            reset_classification["state_projection_sha256"],
            content_after_classification["state_projection_sha256"],
            migration_after_classification["state_projection_sha256"],
            security_after_classification["state_projection_sha256"],
            fault_before_classification["state_projection_sha256"],
            fault_after_classification["state_projection_sha256"],
            recovery_reset_classification["state_projection_sha256"],
            unknown_after_crash_classification["state_projection_sha256"],
            commit_before_classification["state_projection_sha256"],
            connection_before_classification["state_projection_sha256"],
            connection_after_classification["state_projection_sha256"],
            recovery_old_layout_evidence["classification"]["state_projection_sha256"],
            unknown_old_layout_evidence["classification"]["state_projection_sha256"],
            commit_old_layout_evidence["classification"]["state_projection_sha256"],
        ]
        new_states = [
            repeat_before_classification["state_projection_sha256"],
            repeat_after_classification["state_projection_sha256"],
            recovery_after_classification["state_projection_sha256"],
            commit_after_classification["state_projection_sha256"],
        ]
        if old_state_sha256 == new_state_sha256 \
                or any(value != old_state_sha256 for value in old_states) \
                or any(value != new_state_sha256 for value in new_states):
            reject("TASK70_V3_STATE_CHAIN_INVALID")
        real.assert_execution_receipts_consumed(9)

        target_guards.append(LEGACY.verify_target_guard(container_id, policy))
        required_scenarios = policy["case_catalog"][0]["required_scenarios"]
        if set(scenarios_by_id) != set(required_scenarios):
            reject("TASK70_V3_SCENARIO_SET_INVALID")
        ordered_scenarios = [scenarios_by_id[name] for name in required_scenarios]
        migration_evidence = {
            "count": len(records), "head": records[-1]["version"],
            "ledger_file_sha256": digest_bytes(migration_ledger),
            "ledger_sha256": digest_value([{
                "version": record["version"], "checksum": record["checksum"],
            } for record in records]),
            "allowlist_sha256": EXECUTOR.migration_allowlist_digest([
                {"version": record["version"], "checksum": record["checksum"]}
                for record in records
            ]),
            "ordered_apply_receipts": migration_receipts,
            "apply_receipt_set_sha256": digest_value(migration_receipts),
        }
        return {
            "base_spec": base, "restored_oid": restored_oid,
            "management_identity": identity,
            "setup_receipt": setup_receipt,
            "target_guards": target_guards,
            "migration": migration_evidence,
            "content_report": content_report,
            "content_report_raw_base64": base64.b64encode(report_raw).decode("ascii"),
            "authority_activation_sha256":
                inputs.package["sources"]["snapshot_policy_activation"]["sha256"],
            "security_state": proof_observed["security"]["state"],
            "security_state_sha256": proof_observed["security"]["state_sha256"],
            "reconciliation": {
                **reconcile,
                "execution_receipt": reconciliation_execution_receipt,
            },
            "reconciliation_sql": reconciliation_sql,
            "reconciliation_sql_evidence": reconciliation_sql_evidence,
            "staging_proof": staging_proof,
            "guarded_opcode": guarded_opcode,
            "guarded_sql": guarded_sql,
            "production_sql_evidence": production_sql_evidence,
            "guarded_sql_bytes": len(guarded_sql),
            "reset_receipts": reset_receipts,
            "journal_evidence": {
                "recovery": recovery_journal_evidence,
                "recovery_attempt_unknown": unknown_journal_evidence,
                "commit_response_loss": commit_journal_evidence,
            },
            "scenarios": ordered_scenarios,
        }
    finally:
        real.close()
        if journal_parent.exists():
            secure_remove_journal_tree(journal_parent, temp_root)


def build_coverage(policy: dict[str, Any]) -> dict[str, Any]:
    stages = [{
        "id": item,
        "status": "PARTIAL" if item == "POSTGRESQL_RESTORE" else "MISSING",
    } for item in policy["required_stage_order"]]
    checks = [{
        "id": item,
        "status": "PARTIAL" if item in {"POSTGRESQL_CONTENT", "MIGRATION_HEAD"}
        else "MISSING",
    } for item in policy["required_check_order"]]
    return {"stages": stages, "checks": checks, "status": "PARTIAL"}


def build_case(
        policy: dict[str, Any], business: dict[str, Any],
        before: dict[str, Any], after: dict[str, Any], cleanup: dict[str, Any],
) -> dict[str, Any]:
    assertions = build_assertions(
        policy, business, before["fingerprint_sha256"],
        after["fingerprint_sha256"], cleanup["cleanup_receipt_sha256"],
    )
    body = {
        "case_id": CASE_ID,
        "evidence_class": policy["case_catalog"][0]["evidence_class"],
        "stage_id": "POSTGRESQL_RESTORE", "stage_coverage": "PARTIAL",
        "result": "PASS",
        "fixture": {
            "fixture_class": "FULL_46_REPOSITORY_MIGRATIONS_EMPTY_SYNTHETIC_DATA",
            "base_spec": business["base_spec"],
            "restored_oid": business["restored_oid"],
            "management_identity": business["management_identity"],
            "setup_receipt": business["setup_receipt"],
            "target_guards": business["target_guards"],
            "migration": business["migration"],
            "content_report": business["content_report"],
            "content_report_raw_base64": business["content_report_raw_base64"],
            "authority_activation_sha256":
                business["authority_activation_sha256"],
            "security_state": business["security_state"],
            "security_state_sha256": business["security_state_sha256"],
            "staging_proof": business["staging_proof"],
            "reset_receipts": business["reset_receipts"],
        },
        "opcodes": {
            "reconciliation": business["reconciliation"],
            "production": business["guarded_opcode"],
            "reconciliation_sql_evidence": business["reconciliation_sql_evidence"],
            "production_sql_evidence": business["production_sql_evidence"],
            "production_sql_bytes": business["guarded_sql_bytes"],
            "production_sql_embedded": True,
        },
        "journal_evidence": business["journal_evidence"],
        "scenarios": business["scenarios"],
        "assertions": assertions,
    }
    return {**body, "case_evidence_sha256": digest_value(body)}


def historical_v2_projection() -> dict[str, str]:
    paths = {
        "policy": SITE_ROOT / "operations/uat-promotion-dynamic-validation-policy-v2.json",
        "artifact": SITE_ROOT / "operations/uat-promotion-dynamic-evidence-v2.json",
        "producer": SITE_ROOT / "scripts/uat-promotion-dynamic-pg-switch.py",
        "verifier": SITE_ROOT / "scripts/uat-promotion-dynamic-evidence.mjs",
        "audit_test": SITE_ROOT / "tests/selfhost-uat-promotion-rollback-audit.test.mjs",
    }
    try:
        projection = {
            key: LEGACY.secure_file_sha256(path, "TASK70_V3_HISTORICAL_V2_INVALID")
            for key, path in paths.items()
        }
    except LEGACY.DynamicPgSwitchError as error:
        raise DynamicGuardedSwitchError(error.code) from error
    return projection


def build_artifact(
        *, policy: dict[str, Any], run_id: str, started_at: str,
        source: dict[str, Any], source_bindings: list[dict[str, str]],
        image_before: dict[str, Any], image_after: dict[str, Any],
        docker_binary_sha256: str, create_arguments: list[str],
        container_projection: dict[str, Any], resource_evidence: dict[str, Any],
        object_before: dict[str, Any], object_after: dict[str, Any],
        v2_before: dict[str, str], v2_after: dict[str, str],
        business: dict[str, Any], cleanup: dict[str, Any],
) -> dict[str, Any]:
    if image_before != image_after or object_before != object_after \
            or v2_before != v2_after:
        reject("TASK70_V3_EXISTING_OBJECTS_CHANGED")
    case = build_case(policy, business, object_before, object_after, cleanup)
    body = {
        "schema_version": 3,
        "contract": policy["artifact_contract"],
        "task_id": policy["task_id"], "run_id": run_id,
        "case_id": CASE_ID,
        "evidence_scope": policy["evidence_scope"],
        "deployment_class": policy["deployment_class"],
        "audit_clearance": policy["audit_clearance"],
        "started_at": started_at, "completed_at": utc_now(),
        "source": source, "source_bindings": source_bindings,
        "policy_sha256": POLICY_EXPECTED_SHA256,
        "target_guard": policy["required_target_guard"],
        "historical_v2": {
            "before": v2_before, "after": v2_after,
            "result": "FROZEN_UNCHANGED",
        },
        "runtime": {
            "platform": "linux/amd64",
            "postgres_image_reference":
                policy["case_catalog"][0]["postgres_image_reference"],
            "postgres_image_before": image_before,
            "postgres_image_after": image_after,
            "docker_binary_sha256": docker_binary_sha256,
            "container_limits": policy["case_catalog"][0]["container_limits"],
            "docker_create_arguments": create_arguments,
            "docker_create_arguments_sha256": digest_value(create_arguments),
            "container_inspect": container_projection,
            "build_performed": False, "pull_performed": False,
            "mounted_volume_names": [],
        },
        "resource_gate": resource_evidence,
        "object_protection": {
            "before": object_before, "after": object_after,
            "result": "UNCHANGED",
        },
        "cases": [case],
        "coverage": build_coverage(policy),
        "cleanup": cleanup,
        "non_claims": policy["required_non_claims"],
        "result": "PASS_PARTIAL",
    }
    return {**body, "artifact_sha256": digest_value(body)}


def publish_artifact(
        artifact: dict[str, Any], policy: dict[str, Any], run_id: str,
) -> None:
    reject_float_numbers(artifact)
    try:
        raw = json.dumps(
            artifact, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False,
        ).encode("utf-8") + b"\n"
    except (TypeError, ValueError, UnicodeError) as error:
        raise DynamicGuardedSwitchError("TASK70_V3_ARTIFACT_INVALID") from error
    if len(raw) > policy["artifact_max_bytes"] or ARTIFACT_PATH.exists() \
            or ARTIFACT_PATH.is_symlink():
        reject("TASK70_V3_ARTIFACT_INVALID")
    temporary = ARTIFACT_PATH.with_name(f".{ARTIFACT_PATH.name}.{run_id}.tmp")
    descriptor: int | None = None
    created_identity: tuple[int, int] | None = None
    published = False
    publish_error: OSError | None = None

    def owned_metadata(path: Path) -> os.stat_result | None:
        try:
            metadata = path.lstat()
        except FileNotFoundError:
            return None
        if created_identity is None \
                or not stat.S_ISREG(metadata.st_mode) \
                or (metadata.st_dev, metadata.st_ino) != created_identity \
                or metadata.st_uid != 0 or metadata.st_size != len(raw):
            return None
        return metadata

    def require_owned(path: Path, link_count: int) -> os.stat_result:
        metadata = owned_metadata(path)
        if metadata is None or metadata.st_nlink != link_count \
                or stat.S_IMODE(metadata.st_mode) != 0o400:
            raise OSError("artifact publish metadata mismatch")
        return metadata

    def cleanup_owned_paths() -> bool:
        cleanup_ok = True
        removed = False
        for candidate in (temporary, ARTIFACT_PATH):
            try:
                metadata = candidate.lstat()
            except FileNotFoundError:
                continue
            except OSError:
                cleanup_ok = False
                continue
            if created_identity is None \
                    or not stat.S_ISREG(metadata.st_mode) \
                    or (metadata.st_dev, metadata.st_ino) != created_identity \
                    or metadata.st_uid != 0:
                cleanup_ok = False
                continue
            try:
                os.unlink(candidate)
                removed = True
            except OSError:
                cleanup_ok = False
        if removed:
            directory_fd: int | None = None
            try:
                directory_fd = os.open(
                    ARTIFACT_PATH.parent,
                    os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
                )
                os.fsync(directory_fd)
            except OSError:
                cleanup_ok = False
            finally:
                if directory_fd is not None:
                    try:
                        os.close(directory_fd)
                    except OSError:
                        cleanup_ok = False
        return cleanup_ok

    try:
        descriptor = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o400,
        )
        created = os.fstat(descriptor)
        created_identity = (created.st_dev, created.st_ino)
        if not stat.S_ISREG(created.st_mode) or created.st_nlink != 1 \
                or created.st_uid != 0 or stat.S_IMODE(created.st_mode) != 0o400:
            raise OSError("artifact temporary metadata mismatch")
        offset = 0
        while offset < len(raw):
            written = os.write(descriptor, raw[offset:])
            if written <= 0:
                raise OSError("short write")
            offset += written
        os.fsync(descriptor)
        written_metadata = os.fstat(descriptor)
        if written_metadata.st_size != len(raw):
            raise OSError("artifact temporary size mismatch")
        try:
            os.close(descriptor)
        finally:
            descriptor = None
        require_owned(temporary, 1)
        os.link(temporary, ARTIFACT_PATH, follow_symlinks=False)
        require_owned(temporary, 2)
        require_owned(ARTIFACT_PATH, 2)
        os.unlink(temporary)
        try:
            temporary.lstat()
        except FileNotFoundError:
            pass
        else:
            raise OSError("artifact temporary unlink failed")
        require_owned(ARTIFACT_PATH, 1)
        directory_fd = os.open(
            ARTIFACT_PATH.parent,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
        )
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        require_owned(ARTIFACT_PATH, 1)
        published = True
    except OSError as error:
        publish_error = error
    finally:
        if descriptor is not None:
            try:
                os.close(descriptor)
            except OSError:
                pass
        cleanup_ok = True if published else cleanup_owned_paths()
    if publish_error is not None or not cleanup_ok:
        raise DynamicGuardedSwitchError(
            "TASK70_V3_ARTIFACT_PUBLISH_FAILED",
        ) from publish_error


def execute_run() -> dict[str, Any]:
    validate_execution_host()
    lock_descriptor = acquire_runner_lock()
    policy: dict[str, Any] | None = None
    image: dict[str, Any] | None = None
    monitor: Any | None = None
    temp_root: Path | None = None
    container_id: str | None = None
    container_projection: dict[str, Any] | None = None
    run_id = ""
    container_name = ""
    preexisting_residue: dict[str, list[str]] | None = None
    try:
        policy = load_policy()
        source, source_bindings = LEGACY.repository_source(policy)
        verify_source_commit_bindings(source, source_bindings, policy)
        preexisting_residue = v3_preflight_task_residue(policy)
        temp_root, _suffix, run_id = LEGACY.create_temp_root()
        if temp_root.parent != Path(policy["cleanup_policy"]["temp_root_parent"]) \
                or not temp_root.name.startswith(
                    policy["cleanup_policy"]["temp_root_prefix"],
                ):
            reject("TASK70_V3_TEMP_ROOT_INVALID")
        container_name = f"cyd-dv70-pg-v3-{run_id}"
        started_at = utc_now()
        print(f"TASK70 {CASE_ID} START run_id={run_id}", flush=True)
        image = LEGACY.image_projection(
            policy["case_catalog"][0]["postgres_image_reference"],
        )
        docker_binary_sha256 = LEGACY.secure_file_sha256(
            Path(DOCKER), "TASK70_V3_DOCKER_BINARY_INVALID",
        )
        object_before = LEGACY.object_snapshot(
            policy["cleanup_policy"]["protected_volume_names"],
        )
        v2_before = historical_v2_projection()
        monitor = V3ResourceMonitor(policy, object_before["services"])
        monitor.start()
        monitor.wait_for_window(
            policy["resource_policy"]["minimum_preflight_sample_window_seconds"],
        )
        monitor.raise_if_failed()
        print("TASK70 V3 RESOURCE PREFLIGHT PASS window=60s", flush=True)
        container_id, container_projection, create_arguments = \
            v3_create_task_container(
                policy, run_id, container_name, image,
            )
        started = LEGACY.docker_command(["start", container_id], timeout=30)
        if started.returncode != 0 or LEGACY.lines(
                started.stdout, CONTAINER_ID,
                "TASK70_V3_TASK_CONTAINER_START_INVALID",
        ) != [container_id]:
            reject("TASK70_V3_TASK_CONTAINER_START_FAILED")
        LEGACY.wait_postgres_ready(container_id)
        monitor.raise_if_failed()
        print("TASK70 V3 ISOLATED POSTGRES READY version=17.10 network=none", flush=True)
        business = run_business_case(
            container_id=container_id, policy=policy, source=source,
            image=image, monitor=monitor, temp_root=temp_root, run_id=run_id,
        )
        print(
            f"TASK70 V3 GUARDED SWITCH PASS scenarios={len(business['scenarios'])} "
            f"migrations={business['migration']['count']}",
            flush=True,
        )
        removed_ids = v3_cleanup_task_container(
            container_id, policy=policy, run_id=run_id,
            container_name=container_name, image=image,
        )
        container_id = None
        monitor.wait_for_window(
            policy["resource_policy"]["minimum_total_sample_window_seconds"],
        )
        monitor.stop()
        resource_evidence = normalize_resource_evidence(
            monitor.evidence(), policy, run_started_at=started_at,
            container_created_at=container_projection["created_at"],
        )
        monitor = None
        object_after = LEGACY.object_snapshot(
            policy["cleanup_policy"]["protected_volume_names"],
        )
        image_after = LEGACY.image_projection(
            policy["case_catalog"][0]["postgres_image_reference"],
        )
        v2_after = historical_v2_projection()
        source_after, bindings_after = LEGACY.repository_source(policy)
        verify_source_commit_bindings(source_after, bindings_after, policy)
        if source_after != source or bindings_after != source_bindings:
            reject("TASK70_V3_SOURCE_CHANGED_DURING_RUN")
        LEGACY.remove_temp_root(temp_root)
        cleanup = v3_cleanup_receipt(
            policy=policy, run_id=run_id, temp_root=temp_root,
            container_projection=container_projection, removed_ids=removed_ids,
            preexisting_residue=preexisting_residue,
        )
        temp_root = None
        artifact = build_artifact(
            policy=policy, run_id=run_id, started_at=started_at,
            source=source, source_bindings=source_bindings,
            image_before=image, image_after=image_after,
            docker_binary_sha256=docker_binary_sha256,
            create_arguments=create_arguments,
            container_projection=container_projection,
            resource_evidence=resource_evidence,
            object_before=object_before, object_after=object_after,
            v2_before=v2_before, v2_after=v2_after,
            business=business, cleanup=cleanup,
        )
        publish_artifact(artifact, policy, run_id)
        print(
            "TASK70 V3 DYNAMIC EVIDENCE PUBLISHED "
            f"artifact_sha256={artifact['artifact_sha256']}",
            flush=True,
        )
        return artifact
    except LEGACY.DynamicPgSwitchError as error:
        raise DynamicGuardedSwitchError(error.code) from error
    finally:
        cleanup_error: BaseException | None = None
        if container_id is not None and policy is not None and image is not None and run_id:
            try:
                v3_cleanup_task_container(
                    container_id, policy=policy, run_id=run_id,
                    container_name=container_name, image=image, allow_absent=True,
                )
            except BaseException as error:
                cleanup_error = error
        if monitor is not None:
            try:
                monitor.stop()
            except BaseException as error:
                cleanup_error = cleanup_error or error
        if temp_root is not None and temp_root.exists():
            journal_parent = temp_root / "journal-evidence"
            try:
                if journal_parent.exists():
                    secure_remove_journal_tree(journal_parent, temp_root)
                LEGACY.remove_temp_root(temp_root)
            except BaseException as error:
                cleanup_error = cleanup_error or error
        os.close(lock_descriptor)
        if cleanup_error is not None:
            raise cleanup_error


def main(arguments: list[str]) -> int:
    if arguments != ["--execute"]:
        print(
            "usage: uat-promotion-dynamic-pg-guarded-switch.py --execute",
            file=sys.stderr,
        )
        return 2
    try:
        execute_run()
        return 0
    except DynamicGuardedSwitchError as error:
        print(error.code, file=sys.stderr, flush=True)
        return 1
    except EXECUTOR.FixedExecutorError as error:
        print(str(error), file=sys.stderr, flush=True)
        return 1
    except EXECUTOR.HandlerOutcomeUnknown as error:
        print(error.reason_code, file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
