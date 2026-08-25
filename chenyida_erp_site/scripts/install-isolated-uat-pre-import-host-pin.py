#!/usr/bin/python3
"""Create or verify the fixed external manifest pin for isolated-UAT planning."""

from __future__ import annotations

import ctypes
import errno
import hashlib
import json
import os
import re
import stat
import sys
from typing import Any


MANIFEST_PATH = "operations/isolated-uat-pre-import-launch-manifest-v1.json"
BOOTSTRAP_PATH = "scripts/isolated-uat-pre-import-bootstrap.py"
BOOTSTRAP_POLICY_PATH = (
    "operations/isolated-uat-pre-import-bootstrap-policy-v2.json"
)
EXPECTED_MANIFEST_RAW_SHA256 = (
    "ba8e7337798cf499deea039ad14ea859f0ba27ecba88aaec7196c3c02d33a7e5"
)
EXPECTED_MANIFEST_SHA256 = (
    "b71662a429a9180df3cd30f1824b0bc7ebb4b25d078d2cae1ae3595bf903672a"
)
EXPECTED_BOOTSTRAP_RAW_SHA256 = (
    "bc33d4da3a32cb4e894a897261afb2ab528fd8327becc975eb243f725b79e028"
)
EXPECTED_BOOTSTRAP_POLICY_RAW_SHA256 = (
    "809989aa82bf993471f7fd50bf61601e62d30af81a94fb1a74ae3bcf6d41241d"
)
EXPECTED_BOOTSTRAP_POLICY_SHA256 = (
    "4358ef2d41df39c6483171794d1e0a889db064f91c341045c8372263fd216fe1"
)
PIN_ROOT = "/etc/chenyida-erp-isolated-uat-pre-import-v1"
PIN_NAME = "manifest.sha256"
PROTECTED_ROOTS = (
    "/etc/chenyida-erp",
    "/var/lib/chenyida-erp",
    "/var/backups/chenyida-erp-v2",
)
EXPECTED_PIN_RAW = (EXPECTED_MANIFEST_RAW_SHA256 + "\n").encode("ascii")
EXPECTED_PIN_RAW_SHA256 = (
    "83bea3c086538c5eaea83446c5e54bbc5d8446ff69fcd0d1687baeab2bb56065"
)
REPORT_CONTRACT = "chenyida-erp-isolated-uat-pre-import-host-pin-report/v1"
MANIFEST_CONTRACT = "chenyida-erp-isolated-uat-pre-import-launch-manifest/v1"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
PATH_COMPONENT = re.compile(r"^[A-Za-z0-9._-]+$")
DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW
FILE_FLAGS = os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK
MAX_SOURCE_BYTES = 4 * 1024 * 1024
RENAME_NOREPLACE = 1


class HostPinError(Exception):
    """Stable fail-closed host-pin error."""


def fail(code: str) -> None:
    raise HostPinError(code)


def canonical_json(value: Any) -> bytes:
    try:
        return (json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ) + "\n").encode("utf-8")
    except (TypeError, ValueError, UnicodeError, RecursionError):
        fail("ISOLATED_UAT_HOST_PIN_JSON_INVALID")


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json(value)).hexdigest()


def _strict_object(
    pairs: list[tuple[str, Any]], invalid_code: str,
) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            fail(invalid_code)
        result[key] = value
    return result


def _parse_manifest(raw: bytes) -> dict[str, Any]:
    try:
        value = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=lambda pairs: _strict_object(
                pairs, "ISOLATED_UAT_HOST_PIN_MANIFEST_INVALID",
            ),
            parse_constant=lambda _: fail(
                "ISOLATED_UAT_HOST_PIN_MANIFEST_INVALID"
            ),
        )
    except HostPinError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError, ValueError):
        fail("ISOLATED_UAT_HOST_PIN_MANIFEST_INVALID")
    if not isinstance(value, dict) or set(value) != {
        "schema_version", "contract", "manifest_id", "execution_authorized",
        "activation_status", "external_pin_contract", "bootstrap",
        "bootstrap_policy", "launch_contract", "trust_boundary",
        "manifest_sha256",
    }:
        fail("ISOLATED_UAT_HOST_PIN_MANIFEST_INVALID")
    digest = value.get("manifest_sha256")
    body = {key: item for key, item in value.items() if key != "manifest_sha256"}
    if digest != EXPECTED_MANIFEST_SHA256 or canonical_sha256(body) != digest:
        fail("ISOLATED_UAT_HOST_PIN_MANIFEST_INVALID")
    if value.get("schema_version") != 1 \
            or value.get("contract") != MANIFEST_CONTRACT \
            or value.get("execution_authorized") is not False \
            or value.get("activation_status") \
            != "CONTENT_ADDRESS_INPUT_READY_NOT_INSTALLED_OR_HOST_PINNED":
        fail("ISOLATED_UAT_HOST_PIN_MANIFEST_INVALID")
    external = value.get("external_pin_contract")
    bootstrap = value.get("bootstrap")
    policy = value.get("bootstrap_policy")
    launch = value.get("launch_contract")
    trust = value.get("trust_boundary")
    if external != {
        "required_anchor": (
            "MANIFEST_RAW_SHA256_STORED_OUTSIDE_PAYLOAD_AND_REPOSITORY_WORKTREE"
        ),
        "repository_copy_trust_status": "NOT_AN_EXTERNAL_TRUST_ROOT",
        "host_installation_requires_separate_authorization": True,
    } or bootstrap != {
        "path": BOOTSTRAP_PATH,
        "raw_sha256": EXPECTED_BOOTSTRAP_RAW_SHA256,
    } or policy != {
        "path": BOOTSTRAP_POLICY_PATH,
        "raw_sha256": EXPECTED_BOOTSTRAP_POLICY_RAW_SHA256,
        "policy_sha256": EXPECTED_BOOTSTRAP_POLICY_SHA256,
    }:
        fail("ISOLATED_UAT_HOST_PIN_MANIFEST_INVALID")
    if not isinstance(launch, dict) or launch.get("allowed_commands") \
            != ["verify", "plan"] or launch.get("execute_command") \
            != "UNAVAILABLE" or launch.get("caller_selected_source_root") \
            != "FORBIDDEN" or launch.get("caller_selected_policy") \
            != "FORBIDDEN":
        fail("ISOLATED_UAT_HOST_PIN_MANIFEST_INVALID")
    if not isinstance(trust, dict) \
            or trust.get("python_runtime_and_stdlib_identity") != "NOT_ATTESTED" \
            or trust.get("runtime_publisher") != "NOT_IMPLEMENTED" \
            or trust.get("runtime_evidence") != "NOT_ESTABLISHED" \
            or trust.get("uat_environment") != "NOT_CREATED":
        fail("ISOLATED_UAT_HOST_PIN_MANIFEST_INVALID")
    return value


def _directory_valid(value: os.stat_result, device: int | None = None) -> bool:
    return stat.S_ISDIR(value.st_mode) \
        and value.st_uid == 0 \
        and value.st_gid == 0 \
        and stat.S_IMODE(value.st_mode) & 0o022 == 0 \
        and (device is None or value.st_dev == device)


def _open_absolute_directory(path: str) -> tuple[int, os.stat_result]:
    if not isinstance(path, str) or not path.startswith("/") \
            or path.startswith("//") or os.path.normpath(path) != path:
        fail("ISOLATED_UAT_HOST_PIN_DIRECTORY_INVALID")
    parts = [part for part in path.split("/") if part]
    if any(PATH_COMPONENT.fullmatch(part) is None for part in parts):
        fail("ISOLATED_UAT_HOST_PIN_DIRECTORY_INVALID")
    try:
        current = os.open("/", DIRECTORY_FLAGS)
    except OSError:
        fail("ISOLATED_UAT_HOST_PIN_DIRECTORY_INVALID")
    try:
        root = os.fstat(current)
        if not _directory_valid(root):
            fail("ISOLATED_UAT_HOST_PIN_DIRECTORY_INVALID")
        for part in parts:
            try:
                following = os.open(part, DIRECTORY_FLAGS, dir_fd=current)
            except OSError:
                fail("ISOLATED_UAT_HOST_PIN_DIRECTORY_INVALID")
            try:
                metadata = os.fstat(following)
                if not _directory_valid(metadata, root.st_dev):
                    fail("ISOLATED_UAT_HOST_PIN_DIRECTORY_INVALID")
            except Exception:
                os.close(following)
                raise
            os.close(current)
            current = following
        return current, os.fstat(current)
    except Exception:
        os.close(current)
        raise


def _read_file_at(
    directory_fd: int,
    name: str,
    maximum: int,
    *,
    required_mode: int | None = None,
    required_device: int | None = None,
) -> tuple[bytes, os.stat_result]:
    if PATH_COMPONENT.fullmatch(name) is None:
        fail("ISOLATED_UAT_HOST_PIN_FILE_INVALID")
    try:
        descriptor = os.open(name, FILE_FLAGS, dir_fd=directory_fd)
    except OSError:
        fail("ISOLATED_UAT_HOST_PIN_FILE_INVALID")
    try:
        before = os.fstat(descriptor)
        mode = stat.S_IMODE(before.st_mode)
        if not stat.S_ISREG(before.st_mode) or before.st_uid != 0 \
                or before.st_gid != 0 \
                or before.st_nlink != 1 or mode & 0o022 != 0 \
                or (required_mode is not None and mode != required_mode) \
                or (required_device is not None \
                    and before.st_dev != required_device) \
                or before.st_size < 1 or before.st_size > maximum:
            fail("ISOLATED_UAT_HOST_PIN_FILE_INVALID")
        chunks: list[bytes] = []
        total = 0
        while True:
            try:
                chunk = os.read(descriptor, min(65536, maximum + 1 - total))
            except BlockingIOError:
                continue
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > maximum:
                fail("ISOLATED_UAT_HOST_PIN_FILE_INVALID")
        after = os.fstat(descriptor)
        if (
            before.st_dev, before.st_ino, before.st_mode, before.st_uid,
            before.st_gid, before.st_nlink, before.st_size,
            before.st_mtime_ns, before.st_ctime_ns,
        ) != (
            after.st_dev, after.st_ino, after.st_mode, after.st_uid,
            after.st_gid, after.st_nlink, after.st_size,
            after.st_mtime_ns, after.st_ctime_ns,
        ):
            fail("ISOLATED_UAT_HOST_PIN_FILE_CHANGED")
        try:
            named = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        except OSError:
            fail("ISOLATED_UAT_HOST_PIN_FILE_CHANGED")
        if (
            named.st_dev, named.st_ino, named.st_mode, named.st_uid,
            named.st_gid, named.st_nlink, named.st_size,
            named.st_mtime_ns, named.st_ctime_ns,
        ) != (
            after.st_dev, after.st_ino, after.st_mode, after.st_uid,
            after.st_gid, after.st_nlink, after.st_size,
            after.st_mtime_ns, after.st_ctime_ns,
        ):
            fail("ISOLATED_UAT_HOST_PIN_FILE_CHANGED")
        raw = b"".join(chunks)
        if len(raw) != before.st_size:
            fail("ISOLATED_UAT_HOST_PIN_FILE_CHANGED")
        return raw, after
    finally:
        os.close(descriptor)


def _read_relative(root_fd: int, relative: str) -> tuple[bytes, os.stat_result]:
    parts = relative.split("/")
    if not parts or any(PATH_COMPONENT.fullmatch(part) is None for part in parts):
        fail("ISOLATED_UAT_HOST_PIN_SOURCE_INVALID")
    current = os.dup(root_fd)
    try:
        root = os.fstat(current)
        for part in parts[:-1]:
            following = -1
            try:
                following = os.open(part, DIRECTORY_FLAGS, dir_fd=current)
                metadata = os.fstat(following)
                if not _directory_valid(metadata, root.st_dev):
                    fail("ISOLATED_UAT_HOST_PIN_SOURCE_INVALID")
            except Exception:
                if following >= 0:
                    os.close(following)
                raise
            if following < 0:
                fail("ISOLATED_UAT_HOST_PIN_SOURCE_INVALID")
            os.close(current)
            current = following
        return _read_file_at(
            current,
            parts[-1],
            MAX_SOURCE_BYTES,
            required_device=root.st_dev,
        )
    except OSError:
        fail("ISOLATED_UAT_HOST_PIN_SOURCE_INVALID")
    finally:
        os.close(current)


def _verify_sources(site_root: str) -> dict[str, Any]:
    root_fd, _ = _open_absolute_directory(site_root)
    try:
        manifest_raw, _ = _read_relative(root_fd, MANIFEST_PATH)
        bootstrap_raw, _ = _read_relative(root_fd, BOOTSTRAP_PATH)
        policy_raw, _ = _read_relative(root_fd, BOOTSTRAP_POLICY_PATH)
    finally:
        os.close(root_fd)
    if hashlib.sha256(manifest_raw).hexdigest() != EXPECTED_MANIFEST_RAW_SHA256:
        fail("ISOLATED_UAT_HOST_PIN_MANIFEST_DIGEST_MISMATCH")
    manifest = _parse_manifest(manifest_raw)
    if hashlib.sha256(bootstrap_raw).hexdigest() != EXPECTED_BOOTSTRAP_RAW_SHA256:
        fail("ISOLATED_UAT_HOST_PIN_BOOTSTRAP_DIGEST_MISMATCH")
    if hashlib.sha256(policy_raw).hexdigest() \
            != EXPECTED_BOOTSTRAP_POLICY_RAW_SHA256:
        fail("ISOLATED_UAT_HOST_PIN_POLICY_DIGEST_MISMATCH")
    try:
        policy = json.loads(
            policy_raw.decode("utf-8"),
            object_pairs_hook=lambda pairs: _strict_object(
                pairs, "ISOLATED_UAT_HOST_PIN_POLICY_INVALID",
            ),
            parse_constant=lambda _: fail(
                "ISOLATED_UAT_HOST_PIN_POLICY_INVALID"
            ),
        )
    except HostPinError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError, ValueError):
        fail("ISOLATED_UAT_HOST_PIN_POLICY_INVALID")
    if not isinstance(policy, dict) or policy.get("policy_sha256") \
            != EXPECTED_BOOTSTRAP_POLICY_SHA256:
        fail("ISOLATED_UAT_HOST_PIN_POLICY_INVALID")
    policy_body = {key: value for key, value in policy.items() if key != "policy_sha256"}
    if canonical_sha256(policy_body) != EXPECTED_BOOTSTRAP_POLICY_SHA256:
        fail("ISOLATED_UAT_HOST_PIN_POLICY_INVALID")
    return {
        "manifest_contract": manifest["contract"],
        "manifest_raw_sha256": EXPECTED_MANIFEST_RAW_SHA256,
        "manifest_sha256": EXPECTED_MANIFEST_SHA256,
        "bootstrap_raw_sha256": EXPECTED_BOOTSTRAP_RAW_SHA256,
        "bootstrap_policy_raw_sha256": EXPECTED_BOOTSTRAP_POLICY_RAW_SHA256,
        "bootstrap_policy_sha256": EXPECTED_BOOTSTRAP_POLICY_SHA256,
    }


def _sync_directory(descriptor: int) -> None:
    try:
        os.fsync(descriptor)
    except OSError:
        fail("ISOLATED_UAT_HOST_PIN_FSYNC_FAILED")


def _rename_noreplace(directory_fd: int, source: str, target: str) -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = getattr(libc, "renameat2", None)
    if renameat2 is None:
        fail("ISOLATED_UAT_HOST_PIN_RENAME_NOREPLACE_UNAVAILABLE")
    renameat2.argtypes = [
        ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p,
        ctypes.c_uint,
    ]
    renameat2.restype = ctypes.c_int
    result = renameat2(
        ctypes.c_int(directory_fd), ctypes.c_char_p(source.encode("ascii")),
        ctypes.c_int(directory_fd), ctypes.c_char_p(target.encode("ascii")),
        ctypes.c_uint(RENAME_NOREPLACE),
    )
    if result == 0:
        return
    error = ctypes.get_errno()
    if error == errno.EEXIST:
        fail("ISOLATED_UAT_HOST_PIN_TARGET_EXISTS")
    fail("ISOLATED_UAT_HOST_PIN_PUBLISH_FAILED")


def _open_pin_root(path: str, create: bool) -> tuple[int, bool]:
    parent, name = os.path.split(path)
    if PATH_COMPONENT.fullmatch(name) is None:
        fail("ISOLATED_UAT_HOST_PIN_DIRECTORY_INVALID")
    parent_fd, parent_metadata = _open_absolute_directory(parent)
    created = False
    try:
        try:
            pin_fd = os.open(name, DIRECTORY_FLAGS, dir_fd=parent_fd)
        except FileNotFoundError:
            if not create:
                fail("ISOLATED_UAT_HOST_PIN_NOT_INSTALLED")
            try:
                os.mkdir(name, 0o700, dir_fd=parent_fd)
            except OSError:
                fail("ISOLATED_UAT_HOST_PIN_DIRECTORY_CREATE_FAILED")
            created = True
            _sync_directory(parent_fd)
            try:
                pin_fd = os.open(name, DIRECTORY_FLAGS, dir_fd=parent_fd)
            except OSError:
                fail("ISOLATED_UAT_HOST_PIN_DIRECTORY_INVALID")
        except OSError:
            fail("ISOLATED_UAT_HOST_PIN_DIRECTORY_INVALID")
        try:
            metadata = os.fstat(pin_fd)
            if not _directory_valid(metadata, parent_metadata.st_dev) \
                    or stat.S_IMODE(metadata.st_mode) != 0o700:
                fail("ISOLATED_UAT_HOST_PIN_DIRECTORY_INVALID")
            entries = sorted(os.listdir(pin_fd))
            if any(item != PIN_NAME for item in entries):
                fail("ISOLATED_UAT_HOST_PIN_DIRECTORY_NOT_EXACT")
        except Exception:
            os.close(pin_fd)
            raise
        return pin_fd, created
    except Exception:
        raise
    finally:
        os.close(parent_fd)


def _write_all(descriptor: int, raw: bytes) -> None:
    offset = 0
    while offset < len(raw):
        try:
            written = os.write(descriptor, raw[offset:])
        except OSError:
            fail("ISOLATED_UAT_HOST_PIN_WRITE_FAILED")
        if written <= 0:
            fail("ISOLATED_UAT_HOST_PIN_WRITE_FAILED")
        offset += written


def _entry_exists(directory_fd: int, name: str) -> bool:
    if PATH_COMPONENT.fullmatch(name) is None:
        fail("ISOLATED_UAT_HOST_PIN_FILE_INVALID")
    try:
        os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    except FileNotFoundError:
        return False
    except OSError:
        fail("ISOLATED_UAT_HOST_PIN_FILE_INVALID")
    return True


def _publish_pin(directory_fd: int) -> str:
    directory_device = os.fstat(directory_fd).st_dev
    if _entry_exists(directory_fd, PIN_NAME):
        existing, _ = _read_file_at(
            directory_fd, PIN_NAME, len(EXPECTED_PIN_RAW), required_mode=0o400,
            required_device=directory_device,
        )
        if existing != EXPECTED_PIN_RAW:
            fail("ISOLATED_UAT_HOST_PIN_EXISTING_CONTENT_MISMATCH")
        return "ALREADY_PRESENT_VERIFIED"

    temporary = f".{PIN_NAME}.prepared.{os.getpid()}.{os.urandom(16).hex()}.tmp"
    descriptor = -1
    try:
        try:
            descriptor = os.open(
                temporary,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC
                | os.O_NOFOLLOW,
                0o400,
                dir_fd=directory_fd,
            )
        except OSError:
            fail("ISOLATED_UAT_HOST_PIN_PREPARE_FAILED")
        _write_all(descriptor, EXPECTED_PIN_RAW)
        try:
            os.fchown(descriptor, 0, 0)
            os.fchmod(descriptor, 0o400)
            os.fsync(descriptor)
        except OSError:
            fail("ISOLATED_UAT_HOST_PIN_PREPARE_FAILED")
        os.close(descriptor)
        descriptor = -1
        _sync_directory(directory_fd)
        try:
            _rename_noreplace(directory_fd, temporary, PIN_NAME)
        except HostPinError as error:
            if error.args[0] != "ISOLATED_UAT_HOST_PIN_TARGET_EXISTS":
                raise
            existing, _ = _read_file_at(
                directory_fd, PIN_NAME, len(EXPECTED_PIN_RAW),
                required_mode=0o400, required_device=directory_device,
            )
            if existing != EXPECTED_PIN_RAW:
                fail("ISOLATED_UAT_HOST_PIN_EXISTING_CONTENT_MISMATCH")
            return "ALREADY_PRESENT_VERIFIED"
        _sync_directory(directory_fd)
        return "CREATED_AND_VERIFIED"
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            os.unlink(temporary, dir_fd=directory_fd)
            _sync_directory(directory_fd)
        except FileNotFoundError:
            pass
        except OSError:
            fail("ISOLATED_UAT_HOST_PIN_TEMP_CLEANUP_FAILED")


def _pin_identity(metadata: os.stat_result) -> dict[str, int]:
    return {
        "device": metadata.st_dev,
        "inode": metadata.st_ino,
        "mode": stat.S_IMODE(metadata.st_mode),
        "uid": metadata.st_uid,
        "gid": metadata.st_gid,
        "nlink": metadata.st_nlink,
        "size": metadata.st_size,
        "mtime_ns": metadata.st_mtime_ns,
        "ctime_ns": metadata.st_ctime_ns,
    }


def _run(
    command: str,
    site_root: str,
    pin_root: str,
    source_selection_status: str,
) -> dict[str, Any]:
    sources = _verify_sources(site_root)
    pin_fd, _ = _open_pin_root(pin_root, command == "install")
    try:
        pin_device = os.fstat(pin_fd).st_dev
        if command == "install":
            install_status = _publish_pin(pin_fd)
        else:
            install_status = "READ_ONLY_VERIFY"
        pin_raw, pin_metadata = _read_file_at(
            pin_fd, PIN_NAME, len(EXPECTED_PIN_RAW), required_mode=0o400,
            required_device=pin_device,
        )
        if pin_raw != EXPECTED_PIN_RAW \
                or hashlib.sha256(pin_raw).hexdigest() != EXPECTED_PIN_RAW_SHA256:
            fail("ISOLATED_UAT_HOST_PIN_READBACK_MISMATCH")
        if sorted(os.listdir(pin_fd)) != [PIN_NAME]:
            fail("ISOLATED_UAT_HOST_PIN_DIRECTORY_NOT_EXACT")
    finally:
        os.close(pin_fd)
    body = {
        "schema_version": 1,
        "contract": REPORT_CONTRACT,
        "mode": "INSTALL_AND_VERIFY" if command == "install" else "VERIFY_ONLY",
        "source_selection_status": source_selection_status,
        "pin_root": pin_root,
        "pin_path": f"{pin_root}/{PIN_NAME}",
        "pin_file_raw_sha256": EXPECTED_PIN_RAW_SHA256,
        "pin_identity": _pin_identity(pin_metadata),
        "install_status": install_status,
        "host_pin_status": "EXTERNAL_MANIFEST_PIN_INSTALLED_AND_READ_BACK",
        **sources,
        "external_path_trust_status": (
            "OUTSIDE_REPOSITORY_WORKTREE_NOT_INDEPENDENT_WRITER_TRUST_ROOT"
        ),
        "installer_identity_status": "WORKTREE_CODE_NOT_EXTERNALLY_ATTESTED",
        "writer_separation_status": "NOT_ESTABLISHED",
        "crash_recovery_status": (
            "NOT_IMPLEMENTED_FAIL_CLOSED_ON_PREPARED_RESIDUE"
        ),
        "launch_enforcement_status": "NOT_IMPLEMENTED",
        "trusted_plan_launch_status": "NOT_ESTABLISHED",
        "bootstrap_identity_status": "PIN_INPUT_INSTALLED_NOT_LAUNCH_ATTESTED",
        "python_runtime_and_stdlib_identity": "NOT_ATTESTED",
        "execution_command_status": "UNAVAILABLE",
        "execution_authorized": False,
        "runtime_publisher_status": "NOT_IMPLEMENTED",
        "runtime_evidence_status": "NOT_ESTABLISHED",
        "uat_status": "NOT_CREATED",
    }
    return {**body, "report_sha256": canonical_sha256(body)}


def install_for_tests(site_root: str, pin_root: str) -> dict[str, Any]:
    return _run(
        "install", site_root, pin_root,
        "TEST_ONLY_CALLER_SUPPLIED_ROOTS_NOT_HOST_TRUST",
    )


def verify_for_tests(site_root: str, pin_root: str) -> dict[str, Any]:
    return _run(
        "verify", site_root, pin_root,
        "TEST_ONLY_CALLER_SUPPLIED_ROOTS_NOT_HOST_TRUST",
    )


def _require_runtime() -> None:
    flags = sys.flags
    if os.getuid() != 0 or os.geteuid() != 0:
        fail("ISOLATED_UAT_HOST_PIN_ROOT_REQUIRED")
    if sys.executable != "/usr/bin/python3" \
            or flags.isolated != 1 or flags.ignore_environment != 1 \
            or flags.no_site != 1 or flags.no_user_site != 1 \
            or getattr(flags, "safe_path", False) is not True \
            or sys.dont_write_bytecode is not True or flags.optimize != 0:
        fail("ISOLATED_UAT_HOST_PIN_PYTHON_RUNTIME_INVALID")


def _require_fixed_contract() -> None:
    if PIN_ROOT != "/etc/chenyida-erp-isolated-uat-pre-import-v1" \
            or PIN_NAME != "manifest.sha256" \
            or not PIN_ROOT.startswith("/") \
            or any(
                PIN_ROOT == root or PIN_ROOT.startswith(root + "/")
                for root in PROTECTED_ROOTS
            ):
        fail("ISOLATED_UAT_HOST_PIN_FIXED_CONTRACT_INVALID")


def _site_root_from_installer_path() -> str:
    source = __file__
    if not os.path.isabs(source) or source.startswith("//") \
            or os.path.normpath(source) != source \
            or os.path.basename(source) \
            != "install-isolated-uat-pre-import-host-pin.py" \
            or os.path.basename(os.path.dirname(source)) != "scripts":
        fail("ISOLATED_UAT_HOST_PIN_INSTALLER_PATH_INVALID")
    return os.path.dirname(os.path.dirname(source))


def main(argv: list[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    os.umask(0o077)
    try:
        _require_runtime()
        _require_fixed_contract()
        if arguments not in (["install"], ["verify"]):
            fail("ISOLATED_UAT_HOST_PIN_COMMAND_INVALID")
        report = _run(
            arguments[0],
            _site_root_from_installer_path(),
            PIN_ROOT,
            "FIXED_REPOSITORY_AND_HOST_PIN_PATHS_CALLER_OVERRIDE_FORBIDDEN",
        )
        sys.stdout.buffer.write(canonical_json(report))
    except HostPinError as error:
        sys.stderr.write(f"{error}\n")
        return 1
    except Exception:
        sys.stderr.write("ISOLATED_UAT_HOST_PIN_INTERNAL_ERROR\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
