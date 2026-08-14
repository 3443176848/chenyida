#!/usr/bin/python3
"""Validate the fixed host-side runtime secret file boundary without leaking values."""

from __future__ import annotations

import argparse
import base64
import binascii
import fcntl
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path, PurePosixPath
from typing import Any


POLICY_CONTRACT = "chenyida-erp-runtime-secret-file-policy/v1"
EXPECTED_POLICY_SHA256 = "8dd07c6acd6e857a0b29b14e2b6d5b60ad919cf54aac9b552ce11672eb45b7c5"
MAX_POLICY_BYTES = 65_536
EXPECTED_FORBIDDEN_ENVIRONMENT = [
    "DATABASE_URL",
    "ERP_ADMIN_PASSWORD",
    "ERP_MIGRATION_DATABASE_URL",
    "ERP_SETUP_TOKEN",
    "POSTGRES_PASSWORD",
]
EXPECTED_BINDINGS = {
    "ADMIN_DATABASE_PASSWORD": ("admin", "ADMIN", "admin-database-password", 0, 65_532),
    "ADMIN_PASSWORD": ("admin", "ADMIN", "admin-password", 0, 65_532),
    "MIGRATION_DATABASE_PASSWORD": ("migrate", "MIGRATION", "migration-database-password", 0, 0),
    "POSTGRES_BOOTSTRAP_PASSWORD": ("postgres", "POSTGRES", "postgres-bootstrap-password", 0, 999),
    "WEB_DATABASE_PASSWORD": ("web", "WEB", "web-database-password", 0, 65_532),
    "WORKER_DATABASE_PASSWORD": ("worker", "WORKER", "worker-database-password", 0, 65_532),
}
EXPECTED_CONTENT = {
    "exact_bytes": 43,
    "decoded_bytes": 32,
    "encoding": "ASCII",
    "format": "CANONICAL_BASE64URL_NO_PADDING_OPTIONAL_FINAL_LF",
    "minimum_distinct_characters": 16,
    "required_generation": "OS_CSPRNG",
}


class SecretPolicyError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def fail(code: str) -> None:
    raise SecretPolicyError(code)


def strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            fail("RUNTIME_SECRET_POLICY_DUPLICATE_KEY")
        result[key] = value
    return result


def parse_policy(raw: bytes) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=strict_object, parse_constant=lambda _: fail("RUNTIME_SECRET_POLICY_JSON_INVALID"))
    except SecretPolicyError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail("RUNTIME_SECRET_POLICY_JSON_INVALID")
    if not isinstance(value, dict):
        fail("RUNTIME_SECRET_POLICY_INVALID")
    return value


def exact_keys(value: Any, keys: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        fail(code)
    return value


def mode_value(value: Any, code: str) -> int:
    if not isinstance(value, str) or not re.fullmatch(r"0[0-7]{3}", value):
        fail(code)
    return int(value, 8)


def validate_policy(value: dict[str, Any]) -> dict[str, Any]:
    exact_keys(value, {
        "schema_version", "contract", "policy_id", "host_root", "container_root",
        "host_root_metadata", "container_root_metadata", "content", "forbidden_environment", "entries",
    }, "RUNTIME_SECRET_POLICY_FIELDS_INVALID")
    if value["schema_version"] != 1 or value["contract"] != POLICY_CONTRACT or value["policy_id"] != "chenyida-erp-controlled-runtime-secret-files-v1":
        fail("RUNTIME_SECRET_POLICY_IDENTITY_INVALID")
    if value["host_root"] != "/etc/chenyida-erp/runtime-secrets" or value["container_root"] != "/run/chenyida-erp-secrets":
        fail("RUNTIME_SECRET_POLICY_ROOT_INVALID")
    for field, expected in (("host_root_metadata", (0, 0, 0o700)), ("container_root_metadata", (0, 0, 0o555))):
        metadata = exact_keys(value[field], {"uid", "gid", "mode"}, "RUNTIME_SECRET_POLICY_METADATA_INVALID")
        if (metadata["uid"], metadata["gid"], mode_value(metadata["mode"], "RUNTIME_SECRET_POLICY_METADATA_INVALID")) != expected:
            fail("RUNTIME_SECRET_POLICY_METADATA_INVALID")
    content = exact_keys(value["content"], set(EXPECTED_CONTENT), "RUNTIME_SECRET_POLICY_CONTENT_INVALID")
    if content != EXPECTED_CONTENT:
        fail("RUNTIME_SECRET_POLICY_CONTENT_INVALID")
    if value["forbidden_environment"] != EXPECTED_FORBIDDEN_ENVIRONMENT:
        fail("RUNTIME_SECRET_POLICY_ENVIRONMENT_INVALID")
    entries = value["entries"]
    if not isinstance(entries, list) or len(entries) != len(EXPECTED_BINDINGS):
        fail("RUNTIME_SECRET_POLICY_ENTRIES_INVALID")
    ids: list[str] = []
    source_names: list[str] = []
    target_paths: list[str] = []
    for entry in entries:
        exact_keys(entry, {"id", "service", "service_kind", "source_name", "target_path", "uid", "gid", "mode"}, "RUNTIME_SECRET_POLICY_ENTRY_INVALID")
        identifier = entry["id"]
        if not isinstance(identifier, str) or identifier not in EXPECTED_BINDINGS:
            fail("RUNTIME_SECRET_POLICY_ENTRY_INVALID")
        service, service_kind, source_name, uid, gid = EXPECTED_BINDINGS[identifier]
        expected_target = f"{value['container_root']}/{source_name}"
        if (entry["service"], entry["service_kind"], entry["source_name"], entry["target_path"], entry["uid"], entry["gid"], mode_value(entry["mode"], "RUNTIME_SECRET_POLICY_ENTRY_INVALID")) != (service, service_kind, source_name, expected_target, uid, gid, 0o440):
            fail("RUNTIME_SECRET_POLICY_ENTRY_INVALID")
        ids.append(identifier)
        source_names.append(source_name)
        target_paths.append(expected_target)
    if ids != sorted(EXPECTED_BINDINGS) or len(set(source_names)) != len(source_names) or len(set(target_paths)) != len(target_paths):
        fail("RUNTIME_SECRET_POLICY_ENTRIES_INVALID")
    return value


def read_policy(path: Path, *, enforce_digest: bool = True) -> tuple[dict[str, Any], str]:
    descriptor = -1
    try:
        before = path.lstat()
        if not stat.S_ISREG(before.st_mode) or stat.S_ISLNK(before.st_mode) or before.st_nlink != 1 or before.st_uid != 0 or before.st_gid != 0 or stat.S_IMODE(before.st_mode) not in {0o444, 0o600, 0o644} or before.st_size < 1 or before.st_size > MAX_POLICY_BYTES:
            fail("RUNTIME_SECRET_POLICY_FILE_INVALID")
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        opened = os.fstat(descriptor)
        if stable_identity(before) != stable_identity(opened):
            fail("RUNTIME_SECRET_POLICY_FILE_INVALID")
        raw = b""
        while len(raw) <= MAX_POLICY_BYTES:
            chunk = os.read(descriptor, MAX_POLICY_BYTES + 1 - len(raw))
            if not chunk:
                break
            raw += chunk
        after = os.fstat(descriptor)
        after_path = path.lstat()
        if stable_identity(opened) != stable_identity(after) or stable_identity(opened) != stable_identity(after_path) or len(raw) != opened.st_size or len(raw) > MAX_POLICY_BYTES:
            fail("RUNTIME_SECRET_POLICY_FILE_INVALID")
    except SecretPolicyError:
        raise
    except OSError:
        fail("RUNTIME_SECRET_POLICY_FILE_INVALID")
    finally:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
    digest = hashlib.sha256(raw).hexdigest()
    if enforce_digest and digest != EXPECTED_POLICY_SHA256:
        fail("RUNTIME_SECRET_POLICY_DIGEST_MISMATCH")
    return validate_policy(parse_policy(raw)), digest


def stable_identity(metadata: os.stat_result) -> tuple[int, int, int, int, int, int, int, int, int]:
    return (metadata.st_dev, metadata.st_ino, metadata.st_mode, metadata.st_nlink, metadata.st_uid, metadata.st_gid, metadata.st_size, metadata.st_mtime_ns, metadata.st_ctime_ns)


def validate_directory(metadata: os.stat_result, *, uid: int, gid: int, mode: int | None = None) -> None:
    permissions = stat.S_IMODE(metadata.st_mode)
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != uid or metadata.st_gid != gid or permissions & 0o022 or (mode is not None and permissions != mode):
        fail("RUNTIME_SECRET_DIRECTORY_INVALID")


def open_root(root: str, expected: dict[str, Any], *, trusted_ancestor: str = "/") -> tuple[int, list[tuple[int, str, tuple[int, ...]]]]:
    pure = PurePosixPath(root)
    ancestor = PurePosixPath(trusted_ancestor)
    if not pure.is_absolute() or root == "/" or not ancestor.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts[1:]):
        fail("RUNTIME_SECRET_POLICY_ROOT_INVALID")
    if trusted_ancestor != "/" and root != trusted_ancestor:
        fail("RUNTIME_SECRET_POLICY_ROOT_INVALID")
    chain: list[tuple[int, str, tuple[int, ...]]] = []
    descriptor = -1
    current = trusted_ancestor
    try:
        descriptor = os.open(trusted_ancestor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        root_metadata = os.fstat(descriptor)
        validate_directory(
            root_metadata,
            uid=expected["uid"] if root == trusted_ancestor else 0,
            gid=expected["gid"] if root == trusted_ancestor else 0,
            mode=mode_value(expected["mode"], "RUNTIME_SECRET_POLICY_METADATA_INVALID") if root == trusted_ancestor else None,
        )
        chain.append((descriptor, current, stable_identity(root_metadata)))
        components = pure.parts[1:] if trusted_ancestor == "/" else ()
        for index, component in enumerate(components):
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptor)
            child_metadata = os.fstat(child)
            validate_directory(
                child_metadata,
                uid=expected["uid"] if index == len(components) - 1 else 0,
                gid=expected["gid"] if index == len(components) - 1 else 0,
                mode=mode_value(expected["mode"], "RUNTIME_SECRET_POLICY_METADATA_INVALID") if index == len(components) - 1 else None,
            )
            current = f"{current.rstrip('/')}/{component}"
            chain.append((child, current, stable_identity(child_metadata)))
            descriptor = child
        return descriptor, chain
    except SecretPolicyError:
        for item, _, _ in reversed(chain):
            try:
                os.close(item)
            except OSError:
                pass
        raise
    except OSError:
        for item, _, _ in reversed(chain):
            try:
                os.close(item)
            except OSError:
                pass
        fail("RUNTIME_SECRET_DIRECTORY_INVALID")


def validate_content(raw: bytes, content: dict[str, Any]) -> bytes:
    value = raw[:-1] if raw.endswith(b"\n") else raw
    if len(value) != content["exact_bytes"] or not re.fullmatch(rb"[A-Za-z0-9_-]+", value) or len(set(value)) < content["minimum_distinct_characters"]:
        fail("RUNTIME_SECRET_CONTENT_INVALID")
    try:
        decoded = base64.b64decode(value + b"=", altchars=b"-_", validate=True)
    except (ValueError, binascii.Error):
        fail("RUNTIME_SECRET_CONTENT_INVALID")
    if len(decoded) != content["decoded_bytes"] or base64.urlsafe_b64encode(decoded).rstrip(b"=") != value:
        fail("RUNTIME_SECRET_CONTENT_INVALID")
    return value


def validate_secret_files(policy: dict[str, Any], *, root: str | None = None, trusted_ancestor: str = "/") -> int:
    if any(name in os.environ for name in policy["forbidden_environment"]):
        fail("RUNTIME_SECRET_ENVIRONMENT_FORBIDDEN")
    root_path = root or policy["host_root"]
    root_descriptor, chain = open_root(root_path, policy["host_root_metadata"], trusted_ancestor=trusted_ancestor)
    identities: set[tuple[int, int]] = set()
    values: set[bytes] = set()
    try:
        for entry in policy["entries"]:
            name = entry["source_name"]
            try:
                before = os.stat(name, dir_fd=root_descriptor, follow_symlinks=False)
                expected_mode = mode_value(entry["mode"], "RUNTIME_SECRET_POLICY_ENTRY_INVALID")
                if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_uid != entry["uid"] or before.st_gid != entry["gid"] or stat.S_IMODE(before.st_mode) != expected_mode or before.st_size not in {policy["content"]["exact_bytes"], policy["content"]["exact_bytes"] + 1}:
                    fail("RUNTIME_SECRET_FILE_METADATA_INVALID")
                descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=root_descriptor)
                try:
                    try:
                        fcntl.flock(descriptor, fcntl.LOCK_SH | fcntl.LOCK_NB)
                    except OSError:
                        fail("RUNTIME_SECRET_FILE_LOCK_UNAVAILABLE")
                    opened = os.fstat(descriptor)
                    if stable_identity(before) != stable_identity(opened):
                        fail("RUNTIME_SECRET_FILE_CHANGED")
                    chunks: list[bytes] = []
                    remaining = policy["content"]["exact_bytes"] + 2
                    while remaining > 0:
                        chunk = os.read(descriptor, remaining)
                        if not chunk:
                            break
                        chunks.append(chunk)
                        remaining -= len(chunk)
                    raw = b"".join(chunks)
                    after = os.fstat(descriptor)
                    after_path = os.stat(name, dir_fd=root_descriptor, follow_symlinks=False)
                    if stable_identity(opened) != stable_identity(after) or stable_identity(opened) != stable_identity(after_path) or len(raw) != opened.st_size:
                        fail("RUNTIME_SECRET_FILE_CHANGED")
                    normalized = validate_content(raw, policy["content"])
                    identity = (opened.st_dev, opened.st_ino)
                    if identity in identities:
                        fail("RUNTIME_SECRET_FILE_IDENTITY_REUSED")
                    identities.add(identity)
                    if normalized in values:
                        fail("RUNTIME_SECRET_VALUE_REUSED")
                    values.add(normalized)
                finally:
                    os.close(descriptor)
            except SecretPolicyError:
                raise
            except OSError:
                fail("RUNTIME_SECRET_FILE_UNAVAILABLE")
        for descriptor, path, identity in chain:
            handle = os.fstat(descriptor)
            current = os.stat(path, follow_symlinks=False)
            if stable_identity(handle) != identity or stable_identity(current) != identity:
                fail("RUNTIME_SECRET_DIRECTORY_CHANGED")
        return len(identities)
    finally:
        for descriptor, _, _ in reversed(chain):
            try:
                os.close(descriptor)
            except OSError:
                pass


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("command")
    parser.add_argument("--policy")
    try:
        arguments = parser.parse_args(argv)
    except SystemExit:
        fail("RUNTIME_SECRET_ARGUMENTS_INVALID")
    if arguments.command != "validate" or not arguments.policy or os.geteuid() != 0:
        fail("RUNTIME_SECRET_ARGUMENTS_INVALID")
    policy_path = Path(arguments.policy)
    if not policy_path.is_absolute():
        fail("RUNTIME_SECRET_ARGUMENTS_INVALID")
    policy, digest = read_policy(policy_path)
    count = validate_secret_files(policy)
    sys.stdout.write(f"RUNTIME_SECRET_FILES_VERIFIED entries={count} policy_sha256={digest}\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except SecretPolicyError as error:
        sys.stderr.write(f"{error.code}\n")
        raise SystemExit(1)
