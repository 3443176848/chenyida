#!/usr/bin/python3
"""Verify sources before any declared action payload or one-shot module runs.

This stage-1 bootstrap intentionally stops before loading the one-shot entrypoint.
Its own source and the CPython/stdlib runtime still require an external stage-0
anchor.  Passing this verifier does not authorize or execute an UAT action.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import sys
from typing import Any


POLICY_PATH = "operations/isolated-uat-pre-import-bootstrap-policy-v1.json"
EXPECTED_POLICY_RAW_SHA256 = "708c96cc3ff5d9fdfff1dfbc752e24f62421ee8c556ff2ea72cba2a73bdbcf1a"
EXPECTED_POLICY_SHA256 = "c5359216b393df265d707c764cee53b6430471e0ba16ca5252d98ee4fc232a45"
D183_POLICY_PATH = "operations/isolated-uat-action-source-closure-policy-v1.json"
EXPECTED_D183_POLICY_RAW_SHA256 = "7c2a22928c5c80dc21ee21fc8cc99693a480717b7a76f39c4f9b784663c680a8"
EXPECTED_D183_POLICY_SHA256 = "a85d6abbad072ce5981690f0e266b3b657beb3a707f7ca04db96d97d0bb52d11"
EXPECTED_D183_CLOSURE_SHA256 = "19e518819ede89a2b5ad4925d0c71b27fa2b5bba41759ffb0e51e90bd7cc0fb3"
D183_VALIDATOR_PATH = "scripts/isolated-uat-action-source-closure-contracts.py"
EXPECTED_D183_VALIDATOR_RAW_SHA256 = "f4705be0c588947c0f7a968dde153df80b235ee65da760096bf29d7d64e481ad"
POLICY_CONTRACT = "chenyida-erp-isolated-uat-pre-import-bootstrap-policy/v1"
REPORT_CONTRACT = "chenyida-erp-isolated-uat-pre-import-source-snapshot/v1"
EXPECTED_MEMBER_COUNT = 83
MAX_POLICY_BYTES = 2 * 1024 * 1024
MAX_SOURCE_BYTES = 4 * 1024 * 1024
MAX_TOTAL_SOURCE_BYTES = 32 * 1024 * 1024
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
    if value.get("schema_version") != 1 \
            or value.get("contract") != POLICY_CONTRACT \
            or value.get("execution_authorized") is not False \
            or value.get("policy_sha256") != EXPECTED_POLICY_SHA256 \
            or canonical_sha256(body) != EXPECTED_POLICY_SHA256:
        fail("ISOLATED_UAT_PRE_IMPORT_POLICY_INVALID")
    anchors = value.get("anchors")
    snapshot = value.get("snapshot_contract")
    if not isinstance(anchors, dict) or not isinstance(snapshot, dict) \
            or anchors.get("declared_source_policy") != {
                "path": D183_POLICY_PATH,
                "raw_sha256": EXPECTED_D183_POLICY_RAW_SHA256,
                "policy_sha256": EXPECTED_D183_POLICY_SHA256,
                "source_closure_sha256": EXPECTED_D183_CLOSURE_SHA256,
            } or anchors.get("declared_source_validator") != {
                "path": D183_VALIDATOR_PATH,
                "raw_sha256": EXPECTED_D183_VALIDATOR_RAW_SHA256,
            } or snapshot.get("member_count") != EXPECTED_MEMBER_COUNT \
            or snapshot.get("execution_handoff") != "NOT_IMPLEMENTED_FAIL_CLOSED":
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


def _verify_site_root(site_root: str, source_root_selection_status: str) -> dict[str, Any]:
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
            "execution_handoff_status": "NOT_IMPLEMENTED_FAIL_CLOSED",
            "authorization_status": "AUTHORIZATION_NOT_ESTABLISHED",
            "publication_status": "NOT_PUBLISHED",
            "runtime_evidence_status": "NOT_ESTABLISHED",
        }
        return {**body, "verification_sha256": canonical_sha256(body)}
    finally:
        os.close(root_fd)


def verify_site_root_for_tests(site_root: str) -> dict[str, Any]:
    """Exercise the reader without claiming the fixed trusted CLI launch path."""
    return _verify_site_root(
        site_root,
        "TEST_ONLY_CALLER_SUPPLIED_SOURCE_ROOT_AND_RUNTIME_NOT_ATTESTED",
    )


def require_execution_handoff() -> None:
    fail("ISOLATED_UAT_PRE_IMPORT_EXECUTION_HANDOFF_NOT_IMPLEMENTED")


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
        if arguments != ["verify"]:
            fail("ISOLATED_UAT_PRE_IMPORT_COMMAND_INVALID")
        report = _verify_site_root(
            _site_root_from_bootstrap_path(),
            "BOOTSTRAP_ABSOLUTE_PATH_DERIVED_CALLER_OVERRIDE_FORBIDDEN",
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
