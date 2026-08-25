#!/usr/bin/python3
"""Verify fixed sources and optionally compile the read-only isolated-UAT plan.

The ``verify`` command remains a source-only observation.  The ``plan`` command
uses the same captured bytes through a fixed in-memory adapter; it never exposes
the one-shot ``execute`` command or a caller-selected source/policy path.  This
bootstrap and the CPython/stdlib runtime still require an external trust anchor.
"""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import pathlib
import re
import stat
import sys
import threading
from typing import Any


POLICY_PATH = "operations/isolated-uat-pre-import-bootstrap-policy-v2.json"
EXPECTED_POLICY_RAW_SHA256 = "809989aa82bf993471f7fd50bf61601e62d30af81a94fb1a74ae3bcf6d41241d"
EXPECTED_POLICY_SHA256 = "4358ef2d41df39c6483171794d1e0a889db064f91c341045c8372263fd216fe1"
D183_POLICY_PATH = "operations/isolated-uat-action-source-closure-policy-v1.json"
EXPECTED_D183_POLICY_RAW_SHA256 = "7c2a22928c5c80dc21ee21fc8cc99693a480717b7a76f39c4f9b784663c680a8"
EXPECTED_D183_POLICY_SHA256 = "a85d6abbad072ce5981690f0e266b3b657beb3a707f7ca04db96d97d0bb52d11"
EXPECTED_D183_CLOSURE_SHA256 = "19e518819ede89a2b5ad4925d0c71b27fa2b5bba41759ffb0e51e90bd7cc0fb3"
D183_VALIDATOR_PATH = "scripts/isolated-uat-action-source-closure-contracts.py"
EXPECTED_D183_VALIDATOR_RAW_SHA256 = "f4705be0c588947c0f7a968dde153df80b235ee65da760096bf29d7d64e481ad"
CONTROL_POLICY_PATH = "operations/isolated-uat-control-plane-policy-v1.json"
EXPECTED_CONTROL_POLICY_RAW_SHA256 = (
    "a4809ee36160804ee5a11a36f8432437aa4c2e516aeb68e261f2d962b0df67f0"
)
EXPECTED_CONTROL_POLICY_SHA256 = (
    "b9fabb5ec573ae98eaec044470b6ca28f0647e49980d557fc0e055d5e8fade8e"
)
ONE_SHOT_PATH = "scripts/isolated-uat-one-shot.py"
POLICY_CONTRACT = "chenyida-erp-isolated-uat-pre-import-bootstrap-policy/v2"
REPORT_CONTRACT = "chenyida-erp-isolated-uat-pre-import-source-snapshot/v1"
HANDOFF_CONTRACT = "chenyida-erp-isolated-uat-verified-plan-handoff/v1"
EXPECTED_MEMBER_COUNT = 83
EXPECTED_HANDOFF_MEMBER_COUNT = 84
EXPECTED_HANDOFF_PATHS_SHA256 = (
    "5cd4a2e2a6696a3c79e24d6893374d732fcba08dbe93ba1a328ca7ccb60203a0"
)
EXPECTED_HANDOFF_SOURCE_MAP_SHA256 = (
    "80fafed8f27377fac43b038327bfdc16984260bb4cd077bae04872c4fd088843"
)
EXPECTED_PLAN_READ_COUNT = 258
EXPECTED_PLAN_UNIQUE_READ_COUNT = 78
EXPECTED_PLAN_READ_SET_SHA256 = (
    "0403a5e1004973b3390b68ae769a3925d7a1b87d8235cf34ca8a777bb8b6969a"
)
EXPECTED_PLAN_READ_TRACE_SHA256 = (
    "b6d158d61345208e859e525edd91e2ee369d0ab4e0dd9fdf7b1b5eb357025b01"
)
MAX_POLICY_BYTES = 2 * 1024 * 1024
MAX_SOURCE_BYTES = 4 * 1024 * 1024
MAX_TOTAL_SOURCE_BYTES = 32 * 1024 * 1024
MAX_PLAN_BYTES = 4 * 1024 * 1024
VIRTUAL_SITE_ROOT = "/__chenyida_erp_verified_plan_source__"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
PATH_COMPONENT = re.compile(r"^[A-Za-z0-9._-]+$")
DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW
FILE_FLAGS = os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK


class BootstrapError(Exception):
    """Stable fail-closed bootstrap error."""


def fail(code: str) -> None:
    raise BootstrapError(code)


def canonical_json(value: Any) -> str:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ) + "\n"
    except (TypeError, ValueError, UnicodeError, RecursionError):
        fail("ISOLATED_UAT_PRE_IMPORT_JSON_INVALID")


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            fail("ISOLATED_UAT_PRE_IMPORT_JSON_INVALID")
        value[key] = item
    return value


def parse_json(raw: bytes) -> dict[str, Any]:
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_POLICY_BYTES:
        fail("ISOLATED_UAT_PRE_IMPORT_JSON_INVALID")
    try:
        value = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_strict_object,
            parse_constant=lambda _: fail("ISOLATED_UAT_PRE_IMPORT_JSON_INVALID"),
        )
    except BootstrapError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError, RecursionError):
        fail("ISOLATED_UAT_PRE_IMPORT_JSON_INVALID")
    if not isinstance(value, dict):
        fail("ISOLATED_UAT_PRE_IMPORT_JSON_INVALID")
    return value


def _canonical_relative_path(value: Any) -> bool:
    if not isinstance(value, str) or not value or len(value) > 240:
        return False
    if not value.isascii() or value.startswith("/") or "\\" in value:
        return False
    parts = value.split("/")
    return all(
        part not in ("", ".", "..") and PATH_COMPONENT.fullmatch(part) is not None
        for part in parts
    )


def _identity(value: os.stat_result) -> tuple[int, ...]:
    return (
        value.st_dev,
        value.st_ino,
        value.st_mode,
        value.st_uid,
        value.st_gid,
        value.st_nlink,
        value.st_size,
        value.st_mtime_ns,
        value.st_ctime_ns,
    )


def _directory_valid(value: os.stat_result, device: int | None = None) -> bool:
    return stat.S_ISDIR(value.st_mode) \
        and value.st_uid == 0 \
        and stat.S_IMODE(value.st_mode) & 0o022 == 0 \
        and (device is None or value.st_dev == device)


def _open_source_root(path: str) -> tuple[int, os.stat_result]:
    if not isinstance(path, str) or not path.startswith("/") or path.startswith("//") \
            or os.path.normpath(path) != path:
        fail("ISOLATED_UAT_PRE_IMPORT_SOURCE_ROOT_INVALID")
    parts = [part for part in path.split("/") if part]
    if any(PATH_COMPONENT.fullmatch(part) is None for part in parts):
        fail("ISOLATED_UAT_PRE_IMPORT_SOURCE_ROOT_INVALID")
    try:
        current = os.open("/", DIRECTORY_FLAGS)
    except OSError:
        fail("ISOLATED_UAT_PRE_IMPORT_SOURCE_ROOT_INVALID")
    try:
        root_stat = os.fstat(current)
        if not _directory_valid(root_stat):
            fail("ISOLATED_UAT_PRE_IMPORT_SOURCE_ROOT_INVALID")
        device = root_stat.st_dev
        for part in parts:
            try:
                following = os.open(part, DIRECTORY_FLAGS, dir_fd=current)
            except OSError:
                fail("ISOLATED_UAT_PRE_IMPORT_SOURCE_ROOT_INVALID")
            try:
                following_stat = os.fstat(following)
                if not _directory_valid(following_stat, device):
                    fail("ISOLATED_UAT_PRE_IMPORT_SOURCE_ROOT_INVALID")
            except BaseException:
                os.close(following)
                raise
            os.close(current)
            current = following
        return current, os.fstat(current)
    except BaseException:
        os.close(current)
        raise


def _open_relative_parent(root_fd: int, root_device: int, parts: list[str]) -> int:
    current = os.dup(root_fd)
    try:
        for part in parts:
            try:
                following = os.open(part, DIRECTORY_FLAGS, dir_fd=current)
            except OSError:
                fail("ISOLATED_UAT_PRE_IMPORT_DIRECTORY_INVALID")
            try:
                if not _directory_valid(os.fstat(following), root_device):
                    fail("ISOLATED_UAT_PRE_IMPORT_DIRECTORY_INVALID")
            except BaseException:
                os.close(following)
                raise
            os.close(current)
            current = following
        return current
    except BaseException:
        os.close(current)
        raise


def _read_all(fd: int, maximum: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        try:
            chunk = os.read(fd, min(64 * 1024, maximum + 1 - total))
        except OSError:
            fail("ISOLATED_UAT_PRE_IMPORT_FILE_READ_INVALID")
        if not chunk:
            return b"".join(chunks)
        chunks.append(chunk)
        total += len(chunk)
        if total > maximum:
            fail("ISOLATED_UAT_PRE_IMPORT_FILE_SIZE_INVALID")


def _read_relative(
    root_fd: int,
    root_device: int,
    relative_path: str,
    maximum: int,
) -> tuple[bytes, dict[str, Any]]:
    if not _canonical_relative_path(relative_path):
        fail("ISOLATED_UAT_PRE_IMPORT_PATH_INVALID")
    parts = relative_path.split("/")
    parent_fd = _open_relative_parent(root_fd, root_device, parts[:-1])
    try:
        try:
            file_fd = os.open(parts[-1], FILE_FLAGS, dir_fd=parent_fd)
        except OSError:
            fail("ISOLATED_UAT_PRE_IMPORT_FILE_INVALID")
        try:
            before = os.fstat(file_fd)
            if not stat.S_ISREG(before.st_mode) or before.st_uid != 0 \
                    or stat.S_IMODE(before.st_mode) & 0o022 != 0 \
                    or before.st_nlink != 1 or before.st_dev != root_device \
                    or before.st_size <= 0 or before.st_size > maximum:
                fail("ISOLATED_UAT_PRE_IMPORT_FILE_INVALID")
            raw = _read_all(file_fd, maximum)
            after = os.fstat(file_fd)
            if _identity(before) != _identity(after) or len(raw) != before.st_size:
                fail("ISOLATED_UAT_PRE_IMPORT_FILE_CHANGED_DURING_READ")
            return raw, {
                "path": relative_path,
                "sha256": hashlib.sha256(raw).hexdigest(),
                "device": before.st_dev,
                "inode": before.st_ino,
                "mode": format(stat.S_IMODE(before.st_mode), "04o"),
                "uid": before.st_uid,
                "gid": before.st_gid,
                "link_count": before.st_nlink,
                "size": before.st_size,
                "mtime_ns": before.st_mtime_ns,
                "ctime_ns": before.st_ctime_ns,
            }
        finally:
            os.close(file_fd)
    finally:
        os.close(parent_fd)


def _validate_bootstrap_policy(raw: bytes) -> dict[str, Any]:
    if hashlib.sha256(raw).hexdigest() != EXPECTED_POLICY_RAW_SHA256:
        fail("ISOLATED_UAT_PRE_IMPORT_POLICY_RAW_DIGEST_MISMATCH")
    value = parse_json(raw)
    body = {key: item for key, item in value.items() if key != "policy_sha256"}
    if value.get("schema_version") != 2 \
            or value.get("contract") != POLICY_CONTRACT \
            or value.get("execution_authorized") is not False \
            or value.get("policy_sha256") != EXPECTED_POLICY_SHA256 \
            or canonical_sha256(body) != EXPECTED_POLICY_SHA256:
        fail("ISOLATED_UAT_PRE_IMPORT_POLICY_INVALID")
    launch = value.get("launch_contract")
    anchors = value.get("anchors")
    snapshot = value.get("snapshot_contract")
    if not isinstance(launch, dict) or not isinstance(anchors, dict) \
            or not isinstance(snapshot, dict) \
            or launch.get("commands") != ["verify", "plan"] \
            or launch.get("plan_request_max_bytes") != MAX_POLICY_BYTES \
            or launch.get("plan_output_max_bytes") != MAX_PLAN_BYTES \
            or launch.get("caller_selected_source_root") != "FORBIDDEN" \
            or launch.get("caller_selected_policy") != "FORBIDDEN" \
            or launch.get("execute_command") != "UNAVAILABLE" \
            or anchors.get("declared_source_policy") != {
                "path": D183_POLICY_PATH,
                "raw_sha256": EXPECTED_D183_POLICY_RAW_SHA256,
                "policy_sha256": EXPECTED_D183_POLICY_SHA256,
                "source_closure_sha256": EXPECTED_D183_CLOSURE_SHA256,
            } or anchors.get("declared_source_validator") != {
                "path": D183_VALIDATOR_PATH,
                "raw_sha256": EXPECTED_D183_VALIDATOR_RAW_SHA256,
            } or anchors.get("control_policy") != {
                "path": CONTROL_POLICY_PATH,
                "raw_sha256": EXPECTED_CONTROL_POLICY_RAW_SHA256,
                "policy_sha256": EXPECTED_CONTROL_POLICY_SHA256,
            } or snapshot.get("declared_member_count") != EXPECTED_MEMBER_COUNT \
            or snapshot.get("plan_handoff_member_count") \
                != EXPECTED_HANDOFF_MEMBER_COUNT \
            or snapshot.get("plan_handoff_paths_sha256") \
                != EXPECTED_HANDOFF_PATHS_SHA256 \
            or snapshot.get("plan_handoff_source_map_sha256") \
                != EXPECTED_HANDOFF_SOURCE_MAP_SHA256 \
            or snapshot.get(
                "repository_reads_during_plan_compiler_after_capture"
            ) != "FIXED_IN_MEMORY_ADAPTER_ONLY" \
            or snapshot.get("execution_handoff") \
                != "IN_MEMORY_FIXED_READ_ONLY_PLAN_ADAPTER" \
            or snapshot.get("adapter_threading") \
                != "SINGLE_ACTIVE_MAIN_THREAD_REQUIRED" \
            or snapshot.get("plan_repository_read_count") \
                != EXPECTED_PLAN_READ_COUNT \
            or snapshot.get("plan_repository_unique_read_count") \
                != EXPECTED_PLAN_UNIQUE_READ_COUNT \
            or snapshot.get("plan_repository_read_set_sha256") \
                != EXPECTED_PLAN_READ_SET_SHA256 \
            or snapshot.get("plan_repository_read_trace_sha256") \
                != EXPECTED_PLAN_READ_TRACE_SHA256 \
            or snapshot.get("runtime_publisher") != "NOT_IMPLEMENTED":
        fail("ISOLATED_UAT_PRE_IMPORT_POLICY_INVALID")
    return value


def _member_bindings(value: dict[str, Any]) -> list[dict[str, str]]:
    try:
        closure = value["source_closure"]
        members = closure["members"]
    except (KeyError, TypeError):
        fail("ISOLATED_UAT_PRE_IMPORT_D183_MEMBER_SET_INVALID")
    if not isinstance(closure, dict) or not isinstance(members, list) \
            or len(members) != EXPECTED_MEMBER_COUNT \
            or closure.get("source_closure_sha256") != EXPECTED_D183_CLOSURE_SHA256:
        fail("ISOLATED_UAT_PRE_IMPORT_D183_MEMBER_SET_INVALID")
    observed: set[str] = set()
    result: list[dict[str, str]] = []
    for member in members:
        if not isinstance(member, dict) or set(member) != {"path", "sha256", "usage"}:
            fail("ISOLATED_UAT_PRE_IMPORT_D183_MEMBER_SET_INVALID")
        path = member["path"]
        digest = member["sha256"]
        usage = member["usage"]
        if not _canonical_relative_path(path) or path in observed \
                or not isinstance(digest, str) or SHA256.fullmatch(digest) is None \
                or digest == "0" * 64 or not isinstance(usage, str) or not usage:
            fail("ISOLATED_UAT_PRE_IMPORT_D183_MEMBER_SET_INVALID")
        observed.add(path)
        result.append({"path": path, "sha256": digest, "usage": usage})
    return result


def _run_verified_d183_validator(
    validator_raw: bytes,
    policy_raw: bytes,
    sources: dict[str, bytes],
) -> dict[str, Any]:
    namespace: dict[str, Any] = {
        "__name__": "_verified_isolated_uat_action_source_closure_contracts",
        "__file__": "verified-bytes://isolated-uat-action-source-closure-contracts.py",
        "__package__": None,
    }
    try:
        code = compile(
            validator_raw,
            "verified-bytes://isolated-uat-action-source-closure-contracts.py",
            "exec",
            dont_inherit=True,
            optimize=0,
        )
        exec(code, namespace)
        value = namespace["parse_json"](policy_raw)
        validated = namespace["validate_policy"](value, sources)
    except Exception:
        fail("ISOLATED_UAT_PRE_IMPORT_D183_VALIDATION_FAILED")
    if not isinstance(validated, dict) \
            or validated.get("policy_sha256") != EXPECTED_D183_POLICY_SHA256:
        fail("ISOLATED_UAT_PRE_IMPORT_D183_VALIDATION_FAILED")
    return validated


def _capture_site_root(
    site_root: str,
    source_root_selection_status: str,
    *,
    include_plan_policy: bool = False,
) -> tuple[dict[str, Any], dict[str, bytes], dict[str, Any] | None]:
    root_fd, root_stat = _open_source_root(site_root)
    try:
        policy_raw, _ = _read_relative(
            root_fd, root_stat.st_dev, POLICY_PATH, MAX_POLICY_BYTES,
        )
        bootstrap_policy = _validate_bootstrap_policy(policy_raw)

        d183_policy_raw, _ = _read_relative(
            root_fd, root_stat.st_dev, D183_POLICY_PATH, MAX_POLICY_BYTES,
        )
        if hashlib.sha256(d183_policy_raw).hexdigest() \
                != EXPECTED_D183_POLICY_RAW_SHA256:
            fail("ISOLATED_UAT_PRE_IMPORT_D183_POLICY_RAW_DIGEST_MISMATCH")
        d183_policy = parse_json(d183_policy_raw)
        if d183_policy.get("policy_sha256") != EXPECTED_D183_POLICY_SHA256:
            fail("ISOLATED_UAT_PRE_IMPORT_D183_POLICY_INVALID")
        members = _member_bindings(d183_policy)

        validator_raw, _ = _read_relative(
            root_fd, root_stat.st_dev, D183_VALIDATOR_PATH, MAX_SOURCE_BYTES,
        )
        if hashlib.sha256(validator_raw).hexdigest() \
                != EXPECTED_D183_VALIDATOR_RAW_SHA256:
            fail("ISOLATED_UAT_PRE_IMPORT_D183_VALIDATOR_RAW_DIGEST_MISMATCH")

        sources: dict[str, bytes] = {}
        identities: list[dict[str, Any]] = []
        total = 0
        for member in members:
            raw, identity = _read_relative(
                root_fd, root_stat.st_dev, member["path"], MAX_SOURCE_BYTES,
            )
            if identity["sha256"] != member["sha256"]:
                fail("ISOLATED_UAT_PRE_IMPORT_MEMBER_DIGEST_MISMATCH")
            sources[member["path"]] = raw
            identities.append(identity)
            total += len(raw)
            if total > MAX_TOTAL_SOURCE_BYTES:
                fail("ISOLATED_UAT_PRE_IMPORT_TOTAL_SIZE_INVALID")

        validated = _run_verified_d183_validator(
            validator_raw, d183_policy_raw, sources,
        )
        control_identity: dict[str, Any] | None = None
        if include_plan_policy:
            if CONTROL_POLICY_PATH in sources:
                fail("ISOLATED_UAT_PRE_IMPORT_CONTROL_POLICY_DUPLICATE")
            control_policy_raw, control_identity = _read_relative(
                root_fd, root_stat.st_dev, CONTROL_POLICY_PATH, MAX_POLICY_BYTES,
            )
            if hashlib.sha256(control_policy_raw).hexdigest() \
                    != EXPECTED_CONTROL_POLICY_RAW_SHA256:
                fail("ISOLATED_UAT_PRE_IMPORT_CONTROL_POLICY_RAW_DIGEST_MISMATCH")
            control_policy = parse_json(control_policy_raw)
            control_body = {
                key: item for key, item in control_policy.items()
                if key != "policy_sha256"
            }
            safety = control_policy.get("safety")
            if not isinstance(safety, dict) \
                    or control_policy.get("policy_sha256") \
                    != EXPECTED_CONTROL_POLICY_SHA256 \
                    or canonical_sha256(control_body) \
                    != EXPECTED_CONTROL_POLICY_SHA256 \
                    or control_policy.get("deployment_authorized") is not False \
                    or safety.get("runtime_actions_authorized") != []:
                fail("ISOLATED_UAT_PRE_IMPORT_CONTROL_POLICY_INVALID")
            sources[CONTROL_POLICY_PATH] = control_policy_raw
        snapshot_body = {
            "source_root": {
                "device": root_stat.st_dev,
                "inode": root_stat.st_ino,
                "mode": format(stat.S_IMODE(root_stat.st_mode), "04o"),
                "uid": root_stat.st_uid,
                "gid": root_stat.st_gid,
            },
            "member_identities": identities,
        }
        body = {
            "schema_version": 1,
            "contract": REPORT_CONTRACT,
            "mode": "VERIFY_ONLY",
            "execution_authorized": False,
            "bootstrap_policy_sha256": bootstrap_policy["policy_sha256"],
            "bootstrap_policy_raw_sha256": EXPECTED_POLICY_RAW_SHA256,
            "declared_source_policy_sha256": validated["policy_sha256"],
            "declared_source_policy_raw_sha256": EXPECTED_D183_POLICY_RAW_SHA256,
            "declared_source_closure_sha256": EXPECTED_D183_CLOSURE_SHA256,
            "declared_source_validator_raw_sha256": EXPECTED_D183_VALIDATOR_RAW_SHA256,
            "member_count": len(identities),
            "total_member_bytes": total,
            "source_snapshot_sha256": canonical_sha256(snapshot_body),
            "source_root_selection_status": source_root_selection_status,
            "source_observation_status": (
                "FILESYSTEM_FD_BYTES_HASH_MATCHED_BOOTSTRAP_NOT_EXTERNALLY_ATTESTED"
            ),
            "pre_import_status": (
                "D183_VALIDATOR_EXECUTED_FROM_VERIFIED_BYTES_AFTER_MEMBER_"
                "SNAPSHOT_HASH_MATCH"
            ),
            "trust_root_status": "BOOTSTRAP_IDENTITY_NOT_EXTERNALLY_ATTESTED",
            "python_runtime_and_stdlib_identity": "NOT_ATTESTED",
            "payload_execution_status": "NOT_EXECUTED_BY_THIS_BOOTSTRAP",
            "prior_process_execution_status": "NOT_ATTESTED",
            "execution_handoff_status": (
                "FIXED_READ_ONLY_PLAN_COMMAND_DECLARED_NOT_VALIDATED_BY_VERIFY"
            ),
            "authorization_status": "AUTHORIZATION_NOT_ESTABLISHED",
            "publication_status": "NOT_PUBLISHED",
            "runtime_evidence_status": "NOT_ESTABLISHED",
        }
        report = {**body, "verification_sha256": canonical_sha256(body)}
        return report, sources, control_identity
    finally:
        os.close(root_fd)


def _verify_site_root(site_root: str, source_root_selection_status: str) -> dict[str, Any]:
    report, _, _ = _capture_site_root(site_root, source_root_selection_status)
    return report


def _virtual_relative(path: pathlib.Path) -> str:
    value = os.fspath(path)
    prefix = f"{VIRTUAL_SITE_ROOT}/"
    if not isinstance(value, str) or not value.startswith(prefix) \
            or value.startswith("//"):
        fail("ISOLATED_UAT_PRE_IMPORT_VIRTUAL_SOURCE_PATH_INVALID")
    relative = value[len(prefix):]
    if not _canonical_relative_path(relative):
        fail("ISOLATED_UAT_PRE_IMPORT_VIRTUAL_SOURCE_PATH_INVALID")
    return relative


class _VerifiedModuleLoader:
    def __init__(self, relative_path: str, raw: bytes) -> None:
        self.relative_path = relative_path
        self.raw = raw

    def create_module(self, specification: Any) -> None:
        del specification
        return None

    def exec_module(self, module: Any) -> None:
        filename = f"verified-bytes://{self.relative_path}"
        module.__file__ = f"{VIRTUAL_SITE_ROOT}/{self.relative_path}"
        try:
            code = compile(
                self.raw,
                filename,
                "exec",
                dont_inherit=True,
                optimize=0,
            )
            exec(code, module.__dict__)
        except BootstrapError:
            raise
        except Exception:
            fail("ISOLATED_UAT_PRE_IMPORT_VERIFIED_MODULE_LOAD_FAILED")


def _parse_plan_output(raw: bytes) -> dict[str, Any]:
    if not raw or len(raw) > MAX_PLAN_BYTES:
        fail("ISOLATED_UAT_PRE_IMPORT_PLAN_OUTPUT_INVALID")
    try:
        value = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_strict_object,
            parse_constant=lambda _: fail(
                "ISOLATED_UAT_PRE_IMPORT_PLAN_OUTPUT_INVALID"
            ),
        )
    except BootstrapError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError, RecursionError):
        fail("ISOLATED_UAT_PRE_IMPORT_PLAN_OUTPUT_INVALID")
    if not isinstance(value, dict) or canonical_json(value).encode("utf-8") != raw:
        fail("ISOLATED_UAT_PRE_IMPORT_PLAN_OUTPUT_INVALID")
    body = {key: item for key, item in value.items() if key != "plan_sha256"}
    if value.get("schema_version") != 6 \
            or value.get("contract") \
                != "chenyida-erp-isolated-uat-one-shot-plan/v6" \
            or value.get("mode") != "READ_ONLY_PLAN" \
            or value.get("execution_authorized") is not False \
            or value.get("policy_sha256") != EXPECTED_CONTROL_POLICY_SHA256 \
            or value.get("plan_sha256") != canonical_sha256(body):
        fail("ISOLATED_UAT_PRE_IMPORT_PLAN_OUTPUT_INVALID")
    return value


def _run_verified_one_shot_plan(
    sources: dict[str, bytes], request_raw: bytes,
) -> tuple[dict[str, Any], list[tuple[str, str]], list[str]]:
    if not isinstance(sources, dict) or any(
        not isinstance(path, str) or not isinstance(raw, bytes)
        for path, raw in sources.items()
    ):
        fail("ISOLATED_UAT_PRE_IMPORT_PLAN_INPUT_INVALID")
    source_map_sha256 = canonical_sha256({
        "members": [
            {
                "path": path,
                "sha256": hashlib.sha256(raw).hexdigest(),
            }
            for path, raw in sorted(sources.items())
        ],
    })
    if not isinstance(request_raw, bytes) or not request_raw \
            or len(request_raw) > MAX_POLICY_BYTES \
            or len(sources) != EXPECTED_HANDOFF_MEMBER_COUNT \
            or canonical_sha256({"paths": sorted(sources)}) \
                != EXPECTED_HANDOFF_PATHS_SHA256 \
            or source_map_sha256 != EXPECTED_HANDOFF_SOURCE_MAP_SHA256 \
            or ONE_SHOT_PATH not in sources \
            or CONTROL_POLICY_PATH not in sources:
        fail("ISOLATED_UAT_PRE_IMPORT_PLAN_INPUT_INVALID")
    if threading.active_count() != 1 \
            or threading.current_thread() is not threading.main_thread():
        fail("ISOLATED_UAT_PRE_IMPORT_PLAN_PROCESS_NOT_SINGLE_THREADED")

    expected_module_loads = [
        ("isolated_uat_control_plane_policy", "scripts/isolated-uat-control-plane-policy.py"),
        ("isolated_uat_runtime_contracts", "scripts/isolated-uat-runtime-contracts.py"),
        ("isolated_uat_runtime_receipts", "scripts/isolated-uat-runtime-receipts.py"),
        ("isolated_uat_external_anchor_contracts", "scripts/isolated-uat-external-anchor-contracts.py"),
        ("isolated_uat_owner_completion_contracts", "scripts/isolated-uat-owner-completion-contracts.py"),
        ("isolated_uat_owner_bound_external_anchors", "scripts/isolated-uat-external-anchor-contracts.py"),
        ("isolated_uat_owner_bound_runtime_receipts", "scripts/isolated-uat-runtime-receipts.py"),
        ("isolated_uat_caddy_host_sni_contracts", "scripts/isolated-uat-caddy-host-sni-contracts.py"),
    ]
    allowed_module_loads = set(expected_module_loads)
    module_loads: list[tuple[str, str]] = []
    source_reads: list[str] = []

    original_spec = importlib.util.spec_from_file_location
    original_resolve = pathlib.Path.resolve
    original_read_bytes = pathlib.Path.read_bytes
    original_read_text = pathlib.Path.read_text
    original_is_file = pathlib.Path.is_file
    original_is_symlink = pathlib.Path.is_symlink
    original_glob = pathlib.Path.glob

    def verified_spec(name: str, location: Any, *args: Any, **kwargs: Any) -> Any:
        if args or kwargs:
            fail("ISOLATED_UAT_PRE_IMPORT_MODULE_EDGE_INVALID")
        relative = _virtual_relative(pathlib.Path(location))
        if (name, relative) not in allowed_module_loads or relative not in sources:
            fail("ISOLATED_UAT_PRE_IMPORT_MODULE_EDGE_INVALID")
        module_loads.append((name, relative))
        return importlib.util.spec_from_loader(
            name,
            _VerifiedModuleLoader(relative, sources[relative]),
            origin=f"{VIRTUAL_SITE_ROOT}/{relative}",
        )

    def verified_resolve(path: pathlib.Path, strict: bool = False) -> pathlib.Path:
        if strict is not False:
            fail("ISOLATED_UAT_PRE_IMPORT_VIRTUAL_SOURCE_PATH_INVALID")
        _virtual_relative(path)
        return path

    def verified_read_bytes(path: pathlib.Path) -> bytes:
        relative = _virtual_relative(path)
        if relative not in sources:
            fail("ISOLATED_UAT_PRE_IMPORT_UNDECLARED_SOURCE_READ")
        source_reads.append(relative)
        return sources[relative]

    def verified_read_text(
        path: pathlib.Path,
        encoding: str | None = None,
        errors: str | None = None,
    ) -> str:
        if encoding not in (None, "utf-8") or errors is not None:
            fail("ISOLATED_UAT_PRE_IMPORT_SOURCE_TEXT_MODE_INVALID")
        try:
            return verified_read_bytes(path).decode("utf-8")
        except UnicodeDecodeError:
            fail("ISOLATED_UAT_PRE_IMPORT_SOURCE_TEXT_INVALID")

    def verified_is_file(path: pathlib.Path) -> bool:
        return _virtual_relative(path) in sources

    def verified_is_symlink(path: pathlib.Path) -> bool:
        _virtual_relative(path)
        return False

    def verified_glob(path: pathlib.Path, pattern: str) -> list[pathlib.Path]:
        relative = _virtual_relative(path)
        if relative != "drizzle-postgres" or pattern != "*.sql":
            fail("ISOLATED_UAT_PRE_IMPORT_SOURCE_GLOB_INVALID")
        prefix = f"{relative}/"
        return [
            pathlib.Path(f"{VIRTUAL_SITE_ROOT}/{item}")
            for item in sorted(sources)
            if item.startswith(prefix) and "/" not in item[len(prefix):]
            and item.endswith(".sql")
        ]

    output = io.StringIO()
    errors = io.StringIO()
    try:
        importlib.util.spec_from_file_location = verified_spec
        pathlib.Path.resolve = verified_resolve
        pathlib.Path.read_bytes = verified_read_bytes
        pathlib.Path.read_text = verified_read_text
        pathlib.Path.is_file = verified_is_file
        pathlib.Path.is_symlink = verified_is_symlink
        pathlib.Path.glob = verified_glob
        namespace: dict[str, Any] = {
            "__name__": "_verified_isolated_uat_one_shot",
            "__file__": f"{VIRTUAL_SITE_ROOT}/{ONE_SHOT_PATH}",
            "__package__": None,
        }
        try:
            code = compile(
                sources[ONE_SHOT_PATH],
                f"verified-bytes://{ONE_SHOT_PATH}",
                "exec",
                dont_inherit=True,
                optimize=0,
            )
            exec(code, namespace)
            result = namespace["main"](
                ["plan", "--policy", f"{VIRTUAL_SITE_ROOT}/{CONTROL_POLICY_PATH}"],
                input_stream=io.BytesIO(request_raw),
                output_stream=output,
                error_stream=errors,
            )
        except BootstrapError:
            raise
        except Exception:
            fail("ISOLATED_UAT_PRE_IMPORT_PLAN_COMPILER_FAILED")
    finally:
        importlib.util.spec_from_file_location = original_spec
        pathlib.Path.resolve = original_resolve
        pathlib.Path.read_bytes = original_read_bytes
        pathlib.Path.read_text = original_read_text
        pathlib.Path.is_file = original_is_file
        pathlib.Path.is_symlink = original_is_symlink
        pathlib.Path.glob = original_glob

    error_value = errors.getvalue()
    output_value = output.getvalue()
    if result != 0 or error_value or len(error_value.encode("utf-8")) > 4096:
        fail("ISOLATED_UAT_PRE_IMPORT_PLAN_COMPILER_REJECTED")
    if module_loads != expected_module_loads:
        fail("ISOLATED_UAT_PRE_IMPORT_MODULE_ORDER_INVALID")
    read_set_sha256 = canonical_sha256({"paths": sorted(set(source_reads))})
    read_trace_sha256 = canonical_sha256({"paths": source_reads})
    if len(source_reads) != EXPECTED_PLAN_READ_COUNT \
            or len(set(source_reads)) != EXPECTED_PLAN_UNIQUE_READ_COUNT \
            or read_set_sha256 != EXPECTED_PLAN_READ_SET_SHA256 \
            or read_trace_sha256 != EXPECTED_PLAN_READ_TRACE_SHA256:
        fail("ISOLATED_UAT_PRE_IMPORT_SOURCE_READ_TRACE_INVALID")
    plan = _parse_plan_output(output_value.encode("utf-8"))
    return plan, module_loads, source_reads


def _plan_site_root(
    site_root: str,
    source_root_selection_status: str,
    request_raw: bytes,
    *,
    after_capture: Any = None,
) -> dict[str, Any]:
    report, sources, control_identity = _capture_site_root(
        site_root,
        source_root_selection_status,
        include_plan_policy=True,
    )
    if control_identity is None or len(sources) != EXPECTED_HANDOFF_MEMBER_COUNT:
        fail("ISOLATED_UAT_PRE_IMPORT_HANDOFF_SOURCE_SET_INVALID")
    if after_capture is not None:
        after_capture()
    plan, module_loads, source_reads = _run_verified_one_shot_plan(
        sources, request_raw,
    )
    source_binding_body = {
        "source_snapshot_verification_sha256": report["verification_sha256"],
        "declared_source_closure_sha256": EXPECTED_D183_CLOSURE_SHA256,
        "control_policy_identity": control_identity,
    }
    body = {
        "schema_version": 1,
        "contract": HANDOFF_CONTRACT,
        "mode": "READ_ONLY_PLAN",
        "execution_authorized": False,
        "bootstrap_policy_sha256": EXPECTED_POLICY_SHA256,
        "bootstrap_policy_raw_sha256": EXPECTED_POLICY_RAW_SHA256,
        "source_snapshot_verification_sha256": report["verification_sha256"],
        "declared_source_closure_sha256": EXPECTED_D183_CLOSURE_SHA256,
        "control_policy_sha256": EXPECTED_CONTROL_POLICY_SHA256,
        "control_policy_raw_sha256": EXPECTED_CONTROL_POLICY_RAW_SHA256,
        "handoff_member_count": len(sources),
        "handoff_paths_sha256": EXPECTED_HANDOFF_PATHS_SHA256,
        "handoff_source_map_sha256": EXPECTED_HANDOFF_SOURCE_MAP_SHA256,
        "handoff_total_source_bytes": sum(len(raw) for raw in sources.values()),
        "handoff_source_binding_sha256": canonical_sha256(source_binding_body),
        "verified_module_load_count": len(module_loads),
        "verified_repository_read_count": len(source_reads),
        "verified_repository_unique_read_count": len(set(source_reads)),
        "verified_repository_read_set_sha256": EXPECTED_PLAN_READ_SET_SHA256,
        "verified_repository_read_trace_sha256": EXPECTED_PLAN_READ_TRACE_SHA256,
        "handoff_status": (
            "VERIFIED_SOURCE_BYTES_DELIVERED_TO_FIXED_READ_ONLY_PLAN_COMPILER"
        ),
        "payload_execution_status": (
            "ONE_SHOT_PLAN_GENERATED_NO_UAT_ACTION_EXECUTED"
        ),
        "execution_command_status": "UNAVAILABLE",
        "authorization_status": "AUTHORIZATION_NOT_ESTABLISHED",
        "trust_root_status": "BOOTSTRAP_IDENTITY_NOT_EXTERNALLY_ATTESTED",
        "python_runtime_and_stdlib_identity": "NOT_ATTESTED",
        "external_anchor_status": (
            "CONTENT_ADDRESS_MANIFEST_DECLARED_NOT_VERIFIED_OR_HOST_PINNED"
        ),
        "publisher_status": (
            "NO_FILESYSTEM_PUBLISHER_USED_RUNTIME_PUBLISHER_NOT_IMPLEMENTED"
        ),
        "runtime_evidence_status": "NOT_ESTABLISHED",
        "uat_status": "NOT_CREATED",
        "temporary_resource_status": (
            "NO_TEMP_RESOURCE_OR_CHILD_PROCESS_PATH_IMPLEMENTED_BY_BOOTSTRAP"
        ),
        "plan_sha256": plan["plan_sha256"],
        "plan": plan,
    }
    return {**body, "handoff_sha256": canonical_sha256(body)}


def verify_site_root_for_tests(site_root: str) -> dict[str, Any]:
    """Exercise the reader without claiming the fixed trusted CLI launch path."""
    return _verify_site_root(
        site_root,
        "TEST_ONLY_CALLER_SUPPLIED_SOURCE_ROOT_AND_RUNTIME_NOT_ATTESTED",
    )


def plan_site_root_for_tests(
    site_root: str,
    request_raw: bytes,
    *,
    after_capture: Any = None,
) -> dict[str, Any]:
    """Exercise the fixed byte handoff without claiming external trust."""
    return _plan_site_root(
        site_root,
        "TEST_ONLY_CALLER_SUPPLIED_SOURCE_ROOT_AND_RUNTIME_NOT_ATTESTED",
        request_raw,
        after_capture=after_capture,
    )


def require_execution_handoff() -> None:
    fail("ISOLATED_UAT_PRE_IMPORT_RUNTIME_EXECUTION_HANDOFF_NOT_IMPLEMENTED")


def _require_runtime() -> None:
    flags = sys.flags
    if sys.executable != "/usr/bin/python3" \
            or flags.isolated != 1 or flags.ignore_environment != 1 \
            or flags.no_site != 1 or flags.no_user_site != 1 \
            or getattr(flags, "safe_path", False) is not True \
            or sys.dont_write_bytecode is not True or flags.optimize != 0:
        fail("ISOLATED_UAT_PRE_IMPORT_PYTHON_RUNTIME_INVALID")


def _site_root_from_bootstrap_path() -> str:
    source = __file__
    if not os.path.isabs(source) or source.startswith("//") \
            or os.path.normpath(source) != source \
            or os.path.basename(source) != "isolated-uat-pre-import-bootstrap.py" \
            or os.path.basename(os.path.dirname(source)) != "scripts":
        fail("ISOLATED_UAT_PRE_IMPORT_BOOTSTRAP_PATH_INVALID")
    return os.path.dirname(os.path.dirname(source))


def main(argv: list[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    try:
        _require_runtime()
        if arguments not in (["verify"], ["plan"]):
            fail("ISOLATED_UAT_PRE_IMPORT_COMMAND_INVALID")
        site_root = _site_root_from_bootstrap_path()
        source_status = "BOOTSTRAP_ABSOLUTE_PATH_DERIVED_CALLER_OVERRIDE_FORBIDDEN"
        if arguments == ["verify"]:
            report = _verify_site_root(site_root, source_status)
        else:
            request_raw = sys.stdin.buffer.read(MAX_POLICY_BYTES + 1)
            if not request_raw or len(request_raw) > MAX_POLICY_BYTES:
                fail("ISOLATED_UAT_PRE_IMPORT_PLAN_INPUT_INVALID")
            report = _plan_site_root(
                site_root,
                source_status,
                request_raw,
            )
        sys.stdout.write(canonical_json(report))
    except BootstrapError as error:
        sys.stderr.write(f"{error}\n")
        return 1
    except Exception:
        sys.stderr.write("ISOLATED_UAT_PRE_IMPORT_INTERNAL_ERROR\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
