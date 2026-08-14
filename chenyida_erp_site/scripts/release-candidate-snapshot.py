#!/usr/bin/python3
"""Prepare, verify, and remove one exact detached release candidate worktree."""

from __future__ import annotations

import fcntl
import ctypes
import errno
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator


CONTRACT = "chenyida-erp-release-candidate-snapshot/v1"
PREPARE_INTENT_CONTRACT = "chenyida-erp-release-candidate-snapshot-prepare-intent/v1"
REMOVE_INTENT_CONTRACT = "chenyida-erp-release-candidate-snapshot-remove-intent/v1"
REMOVAL_CONTRACT = "chenyida-erp-release-candidate-snapshot-removal/v1"
RECOVERY_INTENT_CONTRACT = "chenyida-erp-release-candidate-snapshot-recovery-intent/v1"
RECOVERY_CONTRACT = "chenyida-erp-release-candidate-snapshot-recovery/v1"
RESERVATION_CONTRACT = "chenyida-erp-release-candidate-snapshot-target-reservation/v1"
BUNDLE_CONTRACT = "chenyida-erp-release-supervisor-bundle/v1"
BUNDLE_MANIFEST_PATH = "chenyida_erp_site/release/release-supervisor-bundle-v1.json"
TEST_RUNTIME_POLICY_PATH = "chenyida_erp_site/release/test-runtime-policy-v1.json"
SNAPSHOT_BASE = Path("/var/lib/chenyida-erp/release-candidate-snapshots")
GLOBAL_RELEASE_LOCK = Path("/run/lock/chenyida-erp-release-gate-v1.lock")
INSTALLED_BUNDLES_ROOT = Path("/usr/local/libexec/chenyida-erp-release-supervisor/bundles")
SAFE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
PREPARE_CONFIRMATION = "PREPARE_EXACT_RELEASE_CANDIDATE_SNAPSHOT"
VERIFY_CONFIRMATION = "VERIFY_EXACT_RELEASE_CANDIDATE_SNAPSHOT"
REMOVE_CONFIRMATION = "REMOVE_EXACT_RELEASE_CANDIDATE_SNAPSHOT"
RECOVER_PREPARE_CONFIRMATION = "RECOVER_EXACT_RELEASE_CANDIDATE_PREPARE"
RECOVER_REMOVE_CONFIRMATION = "RECOVER_EXACT_RELEASE_CANDIDATE_REMOVE"
RESERVATION_CONFIRMATION = "RESERVE_EXACT_RELEASE_CANDIDATE_SNAPSHOT_TARGET"
LOCK_REASON_PREFIX = f"{CONTRACT}:"
MAX_JSON_BYTES = 1024 * 1024
SHA256 = re.compile(r"^[0-9a-f]{64}$")
GIT_OBJECT = re.compile(r"^[0-9a-f]{40}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
SAFE_RELATIVE = re.compile(r"^[A-Za-z0-9._/-]{1,240}$")
TREE_DIGEST_COMMAND = "{ /usr/bin/find -P . -xdev -printf '%y|%m|%P|%l\\n' | LC_ALL=C /usr/bin/sort; /usr/bin/find -P . -xdev -type f -print0 | LC_ALL=C /usr/bin/sort -z | /usr/bin/xargs -0 /usr/bin/sha256sum; } | /usr/bin/sha256sum"
RENAME_NOREPLACE = 1


class SnapshotError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def reject(code: str) -> None:
    raise SnapshotError(code)


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def strict_json(raw: bytes, code: str) -> Any:
    if len(raw) < 2 or len(raw) > MAX_JSON_BYTES:
        reject(code)

    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        value: dict[str, Any] = {}
        for key, item in items:
            if key in value:
                reject(code)
            value[key] = item
        return value

    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_constant=lambda _: reject(code))
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError):
        reject(code)


def exact_fields(value: Any, expected: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        reject(code)
    return value


def safe_relative(value: Any, code: str) -> str:
    if not isinstance(value, str) or not SAFE_RELATIVE.fullmatch(value) or value.startswith("/") or any(part in ("", ".", "..") for part in value.split("/")):
        reject(code)
    return value


def canonical_path(value: Path, code: str) -> Path:
    if not value.is_absolute() or value == Path("/") or value.resolve(strict=False) != value:
        reject(code)
    return value


def path_exists(path: Path) -> bool:
    return os.path.lexists(path)


def trusted_directory(path: Path, code: str, modes: set[int] | None = None, uid: int = 0) -> os.stat_result:
    canonical_path(path, code)
    try:
        value = os.lstat(path)
    except OSError:
        reject(code)
    mode = stat.S_IMODE(value.st_mode)
    if not stat.S_ISDIR(value.st_mode) or stat.S_ISLNK(value.st_mode) or value.st_uid != uid or value.st_gid != 0 or mode & 0o022 or (modes is not None and mode not in modes):
        reject(code)
    return value


def trusted_regular_file(
    path: Path,
    mode: int | set[int],
    code: str,
    uid: int = 0,
    maximum: int = MAX_JSON_BYTES,
    allowed_links: set[int] | None = None,
) -> tuple[bytes, os.stat_result]:
    canonical_path(path, code)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError:
        reject(code)
    try:
        before = os.fstat(descriptor)
        allowed_modes = {mode} if isinstance(mode, int) else mode
        links = allowed_links or {1}
        if not stat.S_ISREG(before.st_mode) or before.st_uid != uid or before.st_gid != 0 or before.st_nlink not in links or stat.S_IMODE(before.st_mode) not in allowed_modes or before.st_size < 1 or before.st_size > maximum:
            reject(code)
        chunks: list[bytes] = []
        remaining = before.st_size
        while remaining:
            chunk = os.read(descriptor, min(1024 * 1024, remaining))
            if not chunk:
                reject(code)
            chunks.append(chunk)
            remaining -= len(chunk)
        after = os.fstat(descriptor)
        pointed = os.lstat(path)
        identity = lambda item: (item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns, item.st_ctime_ns)
        if identity(before) != identity(after) or pointed.st_dev != before.st_dev or pointed.st_ino != before.st_ino or pointed.st_nlink not in links or stat.S_ISLNK(pointed.st_mode):
            reject(code)
        return b"".join(chunks), before
    finally:
        os.close(descriptor)


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_rename_no_replace(
    source: Path,
    destination: Path,
    *,
    uid: int,
    parent_code: str,
    source_parent_modes: set[int] | None,
    destination_parent_modes: set[int] | None,
    cross_device_code: str,
    unavailable_code: str,
    occupied_code: str,
    failed_code: str,
) -> None:
    source_parent = trusted_directory(source.parent, parent_code, source_parent_modes, uid)
    destination_parent = trusted_directory(destination.parent, parent_code, destination_parent_modes, uid)
    if source.name != Path(source.name).name or destination.name != Path(destination.name).name:
        reject(parent_code)
    if source_parent.st_dev != destination_parent.st_dev:
        reject(cross_device_code)
    libc = ctypes.CDLL(None, use_errno=True)
    function = getattr(libc, "renameat2", None)
    if function is None:
        reject(unavailable_code)
    function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    function.restype = ctypes.c_int
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    source_descriptor: int | None = None
    destination_descriptor: int | None = None
    try:
        source_descriptor = os.open(source.parent, flags)
        destination_descriptor = os.open(destination.parent, flags)
    except OSError:
        if destination_descriptor is not None:
            os.close(destination_descriptor)
        if source_descriptor is not None:
            os.close(source_descriptor)
        reject(parent_code)
    assert source_descriptor is not None and destination_descriptor is not None
    try:
        opened_source = os.fstat(source_descriptor)
        opened_destination = os.fstat(destination_descriptor)
        if (
            opened_source.st_dev != source_parent.st_dev
            or opened_source.st_ino != source_parent.st_ino
            or opened_destination.st_dev != destination_parent.st_dev
            or opened_destination.st_ino != destination_parent.st_ino
        ):
            reject(parent_code)
        if function(
            source_descriptor,
            os.fsencode(source.name),
            destination_descriptor,
            os.fsencode(destination.name),
            RENAME_NOREPLACE,
        ) != 0:
            error = ctypes.get_errno()
            if error == errno.EEXIST:
                reject(occupied_code)
            if error == errno.EXDEV:
                reject(cross_device_code)
            reject(failed_code)
        os.fsync(source_descriptor)
        if destination_descriptor != source_descriptor:
            os.fsync(destination_descriptor)
    finally:
        os.close(destination_descriptor)
        os.close(source_descriptor)


def rename_no_replace(source: Path, destination: Path, uid: int = 0) -> None:
    atomic_rename_no_replace(
        source,
        destination,
        uid=uid,
        parent_code="SNAPSHOT_RECOVERY_RENAME_INVALID",
        source_parent_modes=None,
        destination_parent_modes={0o700},
        cross_device_code="SNAPSHOT_RECOVERY_CROSS_DEVICE",
        unavailable_code="SNAPSHOT_RECOVERY_NOREPLACE_UNAVAILABLE",
        occupied_code="SNAPSHOT_RECOVERY_QUARANTINE_EXISTS",
        failed_code="SNAPSHOT_RECOVERY_RENAME_FAILED",
    )


def promote_reservation_no_replace(source: Path, destination: Path, uid: int) -> None:
    atomic_rename_no_replace(
        source,
        destination,
        uid=uid,
        parent_code="SNAPSHOT_RESERVATION_PARENT_INVALID",
        source_parent_modes={0o700},
        destination_parent_modes={0o700},
        cross_device_code="SNAPSHOT_RESERVATION_CROSS_DEVICE",
        unavailable_code="SNAPSHOT_RESERVATION_NOREPLACE_UNAVAILABLE",
        occupied_code="SNAPSHOT_RESERVATION_TARGET_OCCUPIED",
        failed_code="SNAPSHOT_RESERVATION_PROMOTION_FAILED",
    )


def write_no_clobber(path: Path, raw: bytes, mode: int = 0o400, uid: int = 0) -> None:
    trusted_directory(path.parent, "SNAPSHOT_STATE_ROOT_INVALID", {0o700}, uid)
    temporary = path.parent / f".{path.name}.publishing"
    if path_exists(path) and not path_exists(temporary):
        reject("SNAPSHOT_STATE_ALREADY_EXISTS")
    if path_exists(temporary):
        try:
            temporary_raw, temporary_stat = trusted_regular_file(
                temporary,
                mode,
                "SNAPSHOT_STATE_RECOVERY_REQUIRED",
                uid,
                max(MAX_JSON_BYTES, len(raw)),
                {1, 2},
            )
        except SnapshotError:
            try:
                partial = os.lstat(temporary)
            except OSError:
                reject("SNAPSHOT_STATE_RECOVERY_REQUIRED")
            if path_exists(path) or not stat.S_ISREG(partial.st_mode) or partial.st_uid != uid or partial.st_gid != 0 or partial.st_nlink != 1:
                reject("SNAPSHOT_STATE_RECOVERY_REQUIRED")
            os.unlink(temporary)
            fsync_directory(path.parent)
            temporary_raw = b""
            temporary_stat = partial
        if temporary_raw and temporary_raw != raw:
            if path_exists(path) or temporary_stat.st_nlink != 1:
                reject("SNAPSHOT_STATE_RECOVERY_REQUIRED")
            os.unlink(temporary)
            fsync_directory(path.parent)
        elif temporary_raw and path_exists(path):
            final_raw, final_stat = trusted_regular_file(
                path,
                mode,
                "SNAPSHOT_STATE_RECOVERY_REQUIRED",
                uid,
                max(MAX_JSON_BYTES, len(raw)),
                {1, 2},
            )
            if final_raw != raw or final_stat.st_dev != temporary_stat.st_dev or final_stat.st_ino != temporary_stat.st_ino:
                reject("SNAPSHOT_STATE_RECOVERY_REQUIRED")
            os.unlink(temporary)
            fsync_directory(path.parent)
            trusted_regular_file(path, mode, "SNAPSHOT_STATE_RECOVERY_REQUIRED", uid, max(MAX_JSON_BYTES, len(raw)))
            return
    if not path_exists(temporary):
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(temporary, flags, mode)
        except FileExistsError:
            reject("SNAPSHOT_STATE_RECOVERY_REQUIRED")
        except OSError:
            reject("SNAPSHOT_STATE_WRITE_FAILED")
        try:
            os.fchown(descriptor, uid, 0)
            os.fchmod(descriptor, mode)
            offset = 0
            while offset < len(raw):
                written = os.write(descriptor, raw[offset:])
                if written < 1:
                    reject("SNAPSHOT_STATE_WRITE_FAILED")
                offset += written
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    try:
        os.link(temporary, path, follow_symlinks=False)
    except FileExistsError:
        reject("SNAPSHOT_STATE_ALREADY_EXISTS")
    except OSError:
        reject("SNAPSHOT_STATE_WRITE_FAILED")
    fsync_directory(path.parent)
    os.unlink(temporary)
    fsync_directory(path.parent)
    final_raw, _ = trusted_regular_file(path, mode, "SNAPSHOT_STATE_WRITE_FAILED", uid, max(MAX_JSON_BYTES, len(raw)))
    if final_raw != raw:
        reject("SNAPSHOT_STATE_WRITE_FAILED")


def finish_state_publication(path: Path, mode: int = 0o400, uid: int = 0) -> None:
    temporary = path.parent / f".{path.name}.publishing"
    if not path_exists(path) or not path_exists(temporary):
        return
    try:
        final = os.lstat(path)
        publishing = os.lstat(temporary)
    except OSError:
        reject("SNAPSHOT_STATE_RECOVERY_REQUIRED")
    if (
        final.st_dev != publishing.st_dev
        or final.st_ino != publishing.st_ino
        or final.st_nlink != 2
        or publishing.st_nlink != 2
        or not stat.S_ISREG(final.st_mode)
        or final.st_uid != uid
        or final.st_gid != 0
        or stat.S_IMODE(final.st_mode) != mode
    ):
        reject("SNAPSHOT_STATE_RECOVERY_REQUIRED")
    os.unlink(temporary)
    fsync_directory(path.parent)


@dataclass(frozen=True)
class SnapshotPaths:
    base: Path = SNAPSHOT_BASE
    global_lock: Path = GLOBAL_RELEASE_LOCK
    uid: int = 0
    trust_root: Path = Path("/")

    @property
    def worktrees(self) -> Path:
        return self.base / "worktrees"

    @property
    def staging(self) -> Path:
        return self.base / "staging"

    @property
    def reservations(self) -> Path:
        return self.base / "reservations"

    @property
    def receipts(self) -> Path:
        return self.base / "receipts"

    @property
    def state(self) -> Path:
        return self.base / "state"

    @property
    def audit(self) -> Path:
        return self.base / "audit"

    @property
    def quarantine(self) -> Path:
        return self.base / "quarantine"

    @property
    def lifecycle_lock(self) -> Path:
        return self.base / "lifecycle.lock"


def ensure_storage(paths: SnapshotPaths, create: bool) -> None:
    if create and not path_exists(paths.base):
        trusted_directory(paths.base.parent, "SNAPSHOT_STATE_PARENT_INVALID", uid=paths.uid)
        try:
            paths.base.mkdir(mode=0o700)
            os.chown(paths.base, paths.uid, 0)
            fsync_directory(paths.base.parent)
        except OSError:
            reject("SNAPSHOT_STATE_ROOT_INVALID")
    trusted_directory(paths.base, "SNAPSHOT_STATE_ROOT_INVALID", {0o700}, paths.uid)
    for directory in (paths.worktrees, paths.staging, paths.reservations, paths.receipts, paths.state, paths.audit, paths.quarantine):
        if create and not path_exists(directory):
            try:
                directory.mkdir(mode=0o700)
                os.chown(directory, paths.uid, 0)
                fsync_directory(paths.base)
            except OSError:
                reject("SNAPSHOT_STATE_ROOT_INVALID")
        trusted_directory(directory, "SNAPSHOT_STATE_ROOT_INVALID", {0o700}, paths.uid)


@contextmanager
def acquire_file_lock(path: Path, uid: int, create: bool = True) -> Iterator[int]:
    trusted_directory(path.parent, "SNAPSHOT_LOCK_ROOT_INVALID", uid=uid)
    flags = os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    if create:
        flags |= os.O_CREAT
    try:
        descriptor = os.open(path, flags, 0o600)
    except OSError:
        reject("SNAPSHOT_LOCK_INVALID")
    try:
        os.fchown(descriptor, uid, 0)
        os.fchmod(descriptor, 0o600)
        opened = os.fstat(descriptor)
        pointed = os.lstat(path)
        if not stat.S_ISREG(opened.st_mode) or opened.st_uid != uid or opened.st_gid != 0 or opened.st_nlink != 1 or stat.S_IMODE(opened.st_mode) != 0o600 or pointed.st_dev != opened.st_dev or pointed.st_ino != opened.st_ino or stat.S_ISLNK(pointed.st_mode):
            reject("SNAPSHOT_LOCK_INVALID")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            reject("SNAPSHOT_LOCK_BUSY")
        yield descriptor
    finally:
        os.close(descriptor)


@contextmanager
def lifecycle_locks(paths: SnapshotPaths, create_storage: bool) -> Iterator[None]:
    ensure_storage(paths, create_storage)
    with acquire_file_lock(paths.global_lock, paths.uid):
        with acquire_file_lock(paths.lifecycle_lock, paths.uid):
            yield


@contextmanager
def inherited_lifecycle_lock(paths: SnapshotPaths) -> Iterator[None]:
    ensure_storage(paths, False)
    if os.environ.get("ERP_RELEASE_SUPERVISOR_LAUNCHED") != "YES" or os.environ.get("ERP_RELEASE_GATE_LOCK_HELD") != "YES":
        reject("SNAPSHOT_SUPERVISOR_LOCK_REQUIRED")
    descriptor_raw = os.environ.get("ERP_RELEASE_GATE_LOCK_FD", "")
    if not descriptor_raw.isdigit() or not 3 <= int(descriptor_raw) <= 63:
        reject("SNAPSHOT_SUPERVISOR_LOCK_INVALID")
    descriptor = int(descriptor_raw)
    try:
        inherited = os.fstat(descriptor)
        pointed = os.lstat(paths.global_lock)
    except OSError:
        reject("SNAPSHOT_SUPERVISOR_LOCK_INVALID")
    if inherited.st_dev != pointed.st_dev or inherited.st_ino != pointed.st_ino or not stat.S_ISREG(inherited.st_mode) or stat.S_ISLNK(pointed.st_mode):
        reject("SNAPSHOT_SUPERVISOR_LOCK_INVALID")
    contender = os.open(paths.global_lock, os.O_RDWR | getattr(os, "O_NOFOLLOW", 0))
    try:
        try:
            fcntl.flock(contender, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            pass
        else:
            reject("SNAPSHOT_SUPERVISOR_LOCK_NOT_HELD")
    finally:
        os.close(contender)
    with acquire_file_lock(paths.lifecycle_lock, paths.uid):
        yield


def git_environment() -> dict[str, str]:
    return {
        "PATH": SAFE_PATH,
        "LC_ALL": "C",
        "LANG": "C",
        "TZ": "UTC",
        "HOME": "/nonexistent",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_NO_REPLACE_OBJECTS": "1",
        "GIT_OPTIONAL_LOCKS": "0",
    }


def git_result(repository: Path, *arguments: str, timeout: int = 120) -> subprocess.CompletedProcess[bytes]:
    command = [
        "/usr/bin/git", "-c", "core.useReplaceRefs=false", "-c", "core.fsmonitor=false",
        "-c", "core.hooksPath=/dev/null", "-c", f"safe.directory={repository}",
        "-C", str(repository), *arguments,
    ]
    try:
        return subprocess.run(command, env=git_environment(), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        reject("SNAPSHOT_GIT_FAILED")


def git(repository: Path, *arguments: str, binary: bool = False, code: str = "SNAPSHOT_GIT_FAILED") -> bytes | str:
    result = git_result(repository, *arguments)
    if result.returncode != 0:
        reject(code)
    return result.stdout if binary else result.stdout.decode("utf-8").strip()


def root_identity(path: Path) -> dict[str, Any]:
    value = trusted_directory(path, "SNAPSHOT_PATH_INVALID")
    return {"path": str(path), "device": value.st_dev, "inode": value.st_ino, "mode": f"{stat.S_IMODE(value.st_mode):04o}"}


def git_runtime_identity() -> dict[str, Any]:
    executable = Path("/usr/bin/git")
    raw, value = trusted_regular_file(
        executable,
        {0o555, 0o755},
        "SNAPSHOT_GIT_RUNTIME_INVALID",
        0,
        64 * 1024 * 1024,
    )
    try:
        result = subprocess.run(
            [str(executable), "--version"],
            env=git_environment(),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        reject("SNAPSHOT_GIT_RUNTIME_INVALID")
    try:
        version = result.stdout.decode("ascii").strip()
    except UnicodeDecodeError:
        reject("SNAPSHOT_GIT_RUNTIME_INVALID")
    if result.returncode != 0 or result.stderr or not re.fullmatch(r"git version [0-9]+\.[0-9]+\.[0-9]+(?:\.[A-Za-z0-9._-]+)?", version):
        reject("SNAPSHOT_GIT_RUNTIME_INVALID")
    return {
        "path": str(executable),
        "device": value.st_dev,
        "inode": value.st_ino,
        "mode": f"{stat.S_IMODE(value.st_mode):04o}",
        "bytes": len(raw),
        "sha256": sha256(raw),
        "version": version,
    }


def source_repository_identity(repository: Path) -> dict[str, Any]:
    root = trusted_directory(repository, "SNAPSHOT_SOURCE_REPOSITORY_INVALID")
    if git(repository, "rev-parse", "--show-toplevel", code="SNAPSHOT_SOURCE_REPOSITORY_INVALID") != str(repository):
        reject("SNAPSHOT_SOURCE_REPOSITORY_INVALID")
    dot_git = repository / ".git"
    common = git(repository, "rev-parse", "--git-common-dir", code="SNAPSHOT_SOURCE_REPOSITORY_INVALID")
    common_path = Path(str(common))
    if not common_path.is_absolute():
        common_path = (repository / common_path).resolve()
    common_stat = trusted_directory(common_path, "SNAPSHOT_SOURCE_COMMON_GIT_INVALID")
    if common_path != dot_git or not stat.S_ISDIR(os.lstat(dot_git).st_mode):
        reject("SNAPSHOT_SOURCE_COMMON_GIT_INVALID")
    return {
        "root": str(repository), "root_device": root.st_dev, "root_inode": root.st_ino,
        "common_git_dir": str(common_path), "common_git_device": common_stat.st_dev, "common_git_inode": common_stat.st_ino,
        "git_runtime": git_runtime_identity(),
    }


def source_worktree_state(repository: Path) -> dict[str, Any]:
    head = str(git(repository, "rev-parse", "--verify", "HEAD^{commit}", code="SNAPSHOT_SOURCE_STATE_INVALID"))
    tree = str(git(repository, "rev-parse", "--verify", "HEAD^{tree}", code="SNAPSHOT_SOURCE_STATE_INVALID"))
    branch_result = git_result(repository, "symbolic-ref", "-q", "HEAD")
    if branch_result.returncode not in (0, 1):
        reject("SNAPSHOT_SOURCE_STATE_INVALID")
    branch = branch_result.stdout.decode("utf-8").strip() if branch_result.returncode == 0 else None
    status = git(repository, "status", "--porcelain=v2", "-z", "--untracked-files=all", binary=True, code="SNAPSHOT_SOURCE_STATE_INVALID")
    assert isinstance(status, bytes)
    return {"head": head, "tree": tree, "branch": branch, "status_sha256": sha256(status), "status_bytes": len(status)}


def parse_bundle_manifest(raw: bytes) -> dict[str, Any]:
    value = exact_fields(strict_json(raw, "SNAPSHOT_BUNDLE_MANIFEST_INVALID"), {"schema_version", "contract", "bundle_version", "source_commit", "source_tree", "launcher_sha256", "files"}, "SNAPSHOT_BUNDLE_MANIFEST_INVALID")
    if raw != canonical_json(value) or value["schema_version"] != 1 or value["contract"] != BUNDLE_CONTRACT or value["bundle_version"] != 1:
        reject("SNAPSHOT_BUNDLE_MANIFEST_INVALID")
    if not isinstance(value["source_commit"], str) or not GIT_OBJECT.fullmatch(value["source_commit"]) or not isinstance(value["source_tree"], str) or not GIT_OBJECT.fullmatch(value["source_tree"]) or not isinstance(value["launcher_sha256"], str) or not SHA256.fullmatch(value["launcher_sha256"]):
        reject("SNAPSHOT_BUNDLE_MANIFEST_INVALID")
    if not isinstance(value["files"], list) or not value["files"]:
        reject("SNAPSHOT_BUNDLE_MANIFEST_INVALID")
    previous = ""
    for entry in value["files"]:
        entry = exact_fields(entry, {"path", "sha256", "bytes", "mode"}, "SNAPSHOT_BUNDLE_MANIFEST_INVALID")
        relative = safe_relative(entry["path"], "SNAPSHOT_BUNDLE_MANIFEST_INVALID")
        if relative <= previous or not isinstance(entry["sha256"], str) or not SHA256.fullmatch(entry["sha256"]) or not isinstance(entry["bytes"], int) or isinstance(entry["bytes"], bool) or entry["bytes"] < 1 or entry["mode"] not in ("0444", "0555"):
            reject("SNAPSHOT_BUNDLE_MANIFEST_INVALID")
        previous = relative
    return value


def verify_bundle_payload(bundle_root: Path, manifest: dict[str, Any], uid: int = 0) -> None:
    expected = {entry["path"] for entry in manifest["files"]}
    actual: set[str] = set()
    for directory, names, files in os.walk(bundle_root, topdown=True, followlinks=False):
        directory_path = Path(directory)
        trusted_directory(directory_path, "SNAPSHOT_BUNDLE_ROOT_INVALID", uid=uid)
        for name in names:
            child = directory_path / name
            value = os.lstat(child)
            if not stat.S_ISDIR(value.st_mode) or stat.S_ISLNK(value.st_mode):
                reject("SNAPSHOT_BUNDLE_PAYLOAD_INVALID")
        for name in files:
            relative = (directory_path / name).relative_to(bundle_root).as_posix()
            if relative != "bundle-manifest.json":
                actual.add(relative)
    if actual != expected:
        reject("SNAPSHOT_BUNDLE_PAYLOAD_INVALID")
    total = 0
    for entry in manifest["files"]:
        raw, value = trusted_regular_file(bundle_root / entry["path"], int(entry["mode"], 8), "SNAPSHOT_BUNDLE_PAYLOAD_INVALID", uid, 8 * 1024 * 1024)
        total += len(raw)
        if total > 32 * 1024 * 1024 or len(raw) != entry["bytes"] or sha256(raw) != entry["sha256"] or stat.S_IMODE(value.st_mode) != int(entry["mode"], 8):
            reject("SNAPSHOT_BUNDLE_PAYLOAD_INVALID")


def bundle_candidate_identity(repository: Path, candidate_commit: str, candidate_tree: str, bundle_root: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    if not GIT_OBJECT.fullmatch(candidate_commit) or not GIT_OBJECT.fullmatch(candidate_tree):
        reject("SNAPSHOT_CANDIDATE_IDENTITY_INVALID")
    bundle_stat = trusted_directory(bundle_root, "SNAPSHOT_BUNDLE_ROOT_INVALID", {0o555})
    if not SHA256.fullmatch(bundle_root.name):
        reject("SNAPSHOT_BUNDLE_ROOT_INVALID")
    manifest_raw, _ = trusted_regular_file(bundle_root / "bundle-manifest.json", 0o444, "SNAPSHOT_BUNDLE_MANIFEST_INVALID")
    if sha256(manifest_raw) != bundle_root.name:
        reject("SNAPSHOT_BUNDLE_DIGEST_MISMATCH")
    manifest = parse_bundle_manifest(manifest_raw)
    verify_bundle_payload(bundle_root, manifest)
    actual_commit = str(git(repository, "rev-parse", "--verify", f"{candidate_commit}^{{commit}}", code="SNAPSHOT_CANDIDATE_IDENTITY_INVALID"))
    actual_tree = str(git(repository, "rev-parse", "--verify", f"{candidate_commit}^{{tree}}", code="SNAPSHOT_CANDIDATE_IDENTITY_INVALID"))
    if actual_commit != candidate_commit or actual_tree != candidate_tree:
        reject("SNAPSHOT_CANDIDATE_IDENTITY_INVALID")
    commit_raw = git(repository, "cat-file", "commit", candidate_commit, binary=True, code="SNAPSHOT_CANDIDATE_RELATIONSHIP_INVALID")
    assert isinstance(commit_raw, bytes)
    header = commit_raw.decode("utf-8").split("\n\n", 1)[0].splitlines()
    trees = [line[5:] for line in header if line.startswith("tree ")]
    parents = [line[7:] for line in header if line.startswith("parent ")]
    if trees != [candidate_tree] or parents != [manifest["source_commit"]]:
        reject("SNAPSHOT_CANDIDATE_RELATIONSHIP_INVALID")
    source_tree = str(git(repository, "rev-parse", "--verify", f"{manifest['source_commit']}^{{tree}}", code="SNAPSHOT_CANDIDATE_RELATIONSHIP_INVALID"))
    if source_tree != manifest["source_tree"]:
        reject("SNAPSHOT_CANDIDATE_RELATIONSHIP_INVALID")
    changed = str(git(repository, "diff-tree", "--no-commit-id", "--name-status", "--no-renames", "-r", manifest["source_commit"], candidate_commit, code="SNAPSHOT_CANDIDATE_RELATIONSHIP_INVALID")).splitlines()
    if changed not in ([f"A\t{BUNDLE_MANIFEST_PATH}"], [f"M\t{BUNDLE_MANIFEST_PATH}"]):
        reject("SNAPSHOT_CANDIDATE_RELATIONSHIP_INVALID")
    committed_manifest = git(repository, "show", f"{candidate_commit}:{BUNDLE_MANIFEST_PATH}", binary=True, code="SNAPSHOT_CANDIDATE_RELATIONSHIP_INVALID")
    assert isinstance(committed_manifest, bytes)
    if committed_manifest != manifest_raw:
        reject("SNAPSHOT_CANDIDATE_MANIFEST_MISMATCH")
    site_tree = str(git(repository, "rev-parse", "--verify", f"{candidate_commit}:chenyida_erp_site", code="SNAPSHOT_CANDIDATE_IDENTITY_INVALID"))
    if not GIT_OBJECT.fullmatch(site_tree):
        reject("SNAPSHOT_CANDIDATE_SITE_TREE_INVALID")
    return (
        {"commit": candidate_commit, "tree": candidate_tree, "site_tree": site_tree, "bundle_manifest_path": BUNDLE_MANIFEST_PATH},
        {
            "root": str(bundle_root), "root_device": bundle_stat.st_dev, "root_inode": bundle_stat.st_ino,
            "sha256": bundle_root.name, "source_commit": manifest["source_commit"], "source_tree": manifest["source_tree"],
            "manifest_commit": candidate_commit, "manifest_tree": candidate_tree,
        },
    )


def decode_mount_path(value: str) -> str:
    return value.replace("\\040", " ").replace("\\011", "\t").replace("\\012", "\n").replace("\\134", "\\")


def assert_no_nested_mount(path: Path, mountinfo: str | None = None) -> None:
    try:
        text = mountinfo if mountinfo is not None else Path("/proc/self/mountinfo").read_text(encoding="utf-8")
    except OSError:
        reject("SNAPSHOT_MOUNTINFO_UNAVAILABLE")
    target = str(path)
    for line in text.splitlines():
        fields = line.split(" ")
        if len(fields) < 5:
            reject("SNAPSHOT_MOUNTINFO_INVALID")
        mount = decode_mount_path(fields[4])
        if mount == target or mount.startswith(f"{target}/"):
            reject("SNAPSHOT_NESTED_MOUNT")


def containing_mount_identity(path: Path, mountinfo: str | None = None) -> dict[str, Any]:
    try:
        text = mountinfo if mountinfo is not None else Path("/proc/self/mountinfo").read_text(encoding="utf-8")
    except OSError:
        reject("SNAPSHOT_MOUNTINFO_UNAVAILABLE")
    target = str(path)
    matches: list[tuple[int, dict[str, Any]]] = []
    for line in text.splitlines():
        fields = line.split(" ")
        if len(fields) < 10 or "-" not in fields:
            reject("SNAPSHOT_MOUNTINFO_INVALID")
        mount = decode_mount_path(fields[4])
        if mount == "/" or target == mount or target.startswith(f"{mount}/"):
            matches.append((len(mount), {
                "mount_id": fields[0],
                "parent_id": fields[1],
                "major_minor": fields[2],
                "root": decode_mount_path(fields[3]),
                "mount_point": mount,
                "mount_options": fields[5],
            }))
    if not matches:
        reject("SNAPSHOT_MOUNTINFO_INVALID")
    return max(matches, key=lambda item: item[0])[1]


def trusted_directory_chain(path: Path, trust_root: Path, code: str, uid: int = 0) -> list[dict[str, Any]]:
    if (
        not path.is_absolute()
        or not trust_root.is_absolute()
        or path.resolve(strict=False) != path
        or trust_root.resolve(strict=False) != trust_root
        or (trust_root != Path("/") and path != trust_root and not str(path).startswith(f"{trust_root}/"))
    ):
        reject(code)
    relative = path.relative_to(trust_root)
    current = trust_root
    chain: list[dict[str, Any]] = []
    for part in (None, *relative.parts):
        if part is not None:
            current /= part
        if current == Path("/"):
            try:
                value = os.lstat(current)
            except OSError:
                reject(code)
            if not stat.S_ISDIR(value.st_mode) or stat.S_ISLNK(value.st_mode) or value.st_uid != uid or value.st_gid != 0 or stat.S_IMODE(value.st_mode) & 0o022:
                reject(code)
        else:
            value = trusted_directory(current, code, uid=uid)
        chain.append({
            "path": str(current),
            "device": value.st_dev,
            "inode": value.st_ino,
            "mode": f"{stat.S_IMODE(value.st_mode):04o}",
        })
    return chain


def _hash_field(digest: Any, raw: bytes) -> None:
    digest.update(len(raw).to_bytes(8, "big"))
    digest.update(raw)


def tree_metadata_identity(
    directory: Path,
    uid: int,
    code: str,
    allowed_external_symlink_targets: set[Path] | None = None,
    excluded_relatives: set[str] | None = None,
) -> dict[str, Any]:
    root = trusted_directory(directory, code, uid=uid)
    allowed_external = allowed_external_symlink_targets or set()
    excluded = excluded_relatives or set()
    digest = hashlib.sha256()
    entries = 0
    for current, names, files in os.walk(directory, topdown=True, followlinks=False):
        names.sort(key=os.fsencode)
        files.sort(key=os.fsencode)
        for name in [*names, *files]:
            path = Path(current) / name
            relative_text = path.relative_to(directory).as_posix()
            if relative_text in excluded:
                continue
            try:
                value = os.lstat(path)
            except OSError:
                reject(code)
            if value.st_uid != uid or value.st_gid != 0 or value.st_dev != root.st_dev:
                reject(code)
            if stat.S_ISDIR(value.st_mode):
                kind = b"directory"
            elif stat.S_ISREG(value.st_mode):
                kind = b"regular"
                if value.st_nlink != 1:
                    reject(code)
            elif stat.S_ISLNK(value.st_mode):
                kind = b"symlink"
            else:
                reject(code)
            if not stat.S_ISLNK(value.st_mode) and stat.S_IMODE(value.st_mode) & 0o022:
                reject(code)
            link_raw = b""
            if stat.S_ISLNK(value.st_mode):
                try:
                    link_raw = os.fsencode(os.readlink(path))
                    resolved = Path(os.path.realpath(path))
                except OSError:
                    reject(code)
                internal = resolved != directory and str(resolved).startswith(f"{directory}/")
                if (not internal and resolved not in allowed_external) or not resolved.exists():
                    reject(code)
            relative_raw = os.fsencode(path.relative_to(directory))
            for raw in (
                relative_raw,
                kind,
                f"{stat.S_IMODE(value.st_mode):04o}".encode("ascii"),
                str(value.st_uid).encode("ascii"),
                str(value.st_gid).encode("ascii"),
                str(value.st_dev).encode("ascii"),
                str(value.st_ino).encode("ascii"),
                str(value.st_nlink).encode("ascii"),
                str(value.st_size).encode("ascii"),
                str(value.st_mtime_ns).encode("ascii"),
                str(value.st_ctime_ns).encode("ascii"),
                link_raw,
            ):
                _hash_field(digest, raw)
            entries += 1
    after = os.lstat(directory)
    if (
        after.st_dev != root.st_dev
        or after.st_ino != root.st_ino
        or after.st_mtime_ns != root.st_mtime_ns
        or after.st_ctime_ns != root.st_ctime_ns
    ):
        reject(code)
    return {
        "entries": entries,
        "metadata_sha256": digest.hexdigest(),
        "root_device": root.st_dev,
        "root_inode": root.st_ino,
    }


def runtime_tree_digest(directory: Path) -> str:
    try:
        result = subprocess.run(["/bin/sh", "-c", TREE_DIGEST_COMMAND], cwd=directory, env={"PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent"}, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False, timeout=300)
    except (OSError, subprocess.SubprocessError):
        reject("SNAPSHOT_TEST_RUNTIME_DIGEST_FAILED")
    match = re.fullmatch(rb"([0-9a-f]{64})  -\n?", result.stdout)
    if result.returncode != 0 or match is None:
        reject("SNAPSHOT_TEST_RUNTIME_DIGEST_FAILED")
    return match.group(1).decode("ascii")


def assert_runtime_tree_safe(
    directory: Path,
    uid: int,
    allowed_external_symlink_targets: set[Path] | None = None,
    mountinfo: str | None = None,
) -> dict[str, Any]:
    assert_no_nested_mount(directory, mountinfo)
    return tree_metadata_identity(
        directory,
        uid,
        "SNAPSHOT_TEST_RUNTIME_INVALID",
        allowed_external_symlink_targets,
    )


def bundle_file_entry(manifest: dict[str, Any], relative: str) -> dict[str, Any]:
    matches = [entry for entry in manifest["files"] if entry["path"] == relative]
    if len(matches) != 1:
        reject("SNAPSHOT_BUNDLE_RUNTIME_POLICY_INVALID")
    return matches[0]


def test_runtime_identity(
    repository: Path,
    candidate_commit: str,
    runtime_root: Path,
    bundle_root: Path,
    uid: int = 0,
    trust_root: Path = Path("/"),
    mountinfo: str | None = None,
) -> dict[str, Any]:
    runtime_stat = trusted_directory(runtime_root, "SNAPSHOT_TEST_RUNTIME_ROOT_INVALID", uid=uid)
    runtime_chain = trusted_directory_chain(runtime_root, trust_root, "SNAPSHOT_TEST_RUNTIME_PATH_UNTRUSTED", uid)
    assert_no_nested_mount(runtime_root, mountinfo)
    bundle_raw, _ = trusted_regular_file(bundle_root / "bundle-manifest.json", 0o444, "SNAPSHOT_BUNDLE_MANIFEST_INVALID", uid)
    manifest = parse_bundle_manifest(bundle_raw)
    policy_path = bundle_root / TEST_RUNTIME_POLICY_PATH
    policy_raw, policy_stat = trusted_regular_file(policy_path, 0o444, "SNAPSHOT_BUNDLE_RUNTIME_POLICY_INVALID", uid)
    entry = bundle_file_entry(manifest, TEST_RUNTIME_POLICY_PATH)
    if len(policy_raw) != entry["bytes"] or sha256(policy_raw) != entry["sha256"] or stat.S_IMODE(policy_stat.st_mode) != int(entry["mode"], 8):
        reject("SNAPSHOT_BUNDLE_RUNTIME_POLICY_INVALID")
    candidate_policy = git(repository, "show", f"{candidate_commit}:{TEST_RUNTIME_POLICY_PATH}", binary=True, code="SNAPSHOT_BUNDLE_RUNTIME_POLICY_INVALID")
    assert isinstance(candidate_policy, bytes)
    if candidate_policy != policy_raw:
        reject("SNAPSHOT_BUNDLE_RUNTIME_POLICY_INVALID")
    policy = strict_json(policy_raw, "SNAPSHOT_TEST_RUNTIME_POLICY_INVALID")
    if not isinstance(policy, dict) or policy.get("schema_version") != 1 or policy.get("contract") != "chenyida-erp-release-test-runtime-policy/v1":
        reject("SNAPSHOT_TEST_RUNTIME_POLICY_INVALID")
    node = exact_fields(
        policy.get("node_dependencies"),
        {"path", "tree_sha256", "package_lock_sha256"},
        "SNAPSHOT_TEST_RUNTIME_POLICY_INVALID",
    )
    python = exact_fields(
        policy.get("python_runtime"),
        {"venv_path", "venv_tree_sha256", "interpreter_path", "interpreter_sha256", "requirements_sha256", "requirements_dev_sha256"},
        "SNAPSHOT_TEST_RUNTIME_POLICY_INVALID",
    )
    node_relative = safe_relative(node.get("path"), "SNAPSHOT_TEST_RUNTIME_POLICY_INVALID")
    venv_relative = safe_relative(python.get("venv_path"), "SNAPSHOT_TEST_RUNTIME_POLICY_INVALID")
    digest_fields = [node.get("tree_sha256"), node.get("package_lock_sha256"), python.get("venv_tree_sha256"), python.get("interpreter_sha256"), python.get("requirements_sha256"), python.get("requirements_dev_sha256")]
    if not all(isinstance(value, str) and SHA256.fullmatch(value) for value in digest_fields):
        reject("SNAPSHOT_TEST_RUNTIME_POLICY_INVALID")
    if not isinstance(python.get("interpreter_path"), str):
        reject("SNAPSHOT_TEST_RUNTIME_POLICY_INVALID")
    interpreter = canonical_path(Path(python["interpreter_path"]), "SNAPSHOT_TEST_RUNTIME_INTERPRETER_INVALID")
    interpreter_chain = trusted_directory_chain(interpreter.parent, trust_root, "SNAPSHOT_TEST_RUNTIME_PATH_UNTRUSTED", uid)
    interpreter_raw, interpreter_stat = trusted_regular_file(
        interpreter,
        {0o555, 0o755},
        "SNAPSHOT_TEST_RUNTIME_INTERPRETER_INVALID",
        uid,
        32 * 1024 * 1024,
    )
    if sha256(interpreter_raw) != python["interpreter_sha256"]:
        reject("SNAPSHOT_TEST_RUNTIME_INTERPRETER_DIGEST_MISMATCH")
    package_lock = git(repository, "show", f"{candidate_commit}:chenyida_erp_site/package-lock.json", binary=True, code="SNAPSHOT_TEST_RUNTIME_SOURCE_INVALID")
    requirements = git(repository, "show", f"{candidate_commit}:chenyida_erp_app/requirements.txt", binary=True, code="SNAPSHOT_TEST_RUNTIME_SOURCE_INVALID")
    requirements_dev = git(repository, "show", f"{candidate_commit}:chenyida_erp_app/requirements-dev.txt", binary=True, code="SNAPSHOT_TEST_RUNTIME_SOURCE_INVALID")
    assert isinstance(package_lock, bytes) and isinstance(requirements, bytes) and isinstance(requirements_dev, bytes)
    if sha256(package_lock) != node["package_lock_sha256"] or sha256(requirements) != python["requirements_sha256"] or sha256(requirements_dev) != python["requirements_dev_sha256"]:
        reject("SNAPSHOT_TEST_RUNTIME_SOURCE_INVALID")
    node_root = canonical_path(runtime_root / node_relative, "SNAPSHOT_TEST_RUNTIME_INVALID")
    venv_root = canonical_path(runtime_root / venv_relative, "SNAPSHOT_TEST_RUNTIME_INVALID")
    for child in (node_root, venv_root):
        if child == runtime_root or not str(child).startswith(f"{runtime_root}/"):
            reject("SNAPSHOT_TEST_RUNTIME_INVALID")
    node_chain = trusted_directory_chain(node_root, runtime_root, "SNAPSHOT_TEST_RUNTIME_PATH_UNTRUSTED", uid)
    venv_chain = trusted_directory_chain(venv_root, runtime_root, "SNAPSHOT_TEST_RUNTIME_PATH_UNTRUSTED", uid)
    if Path(os.path.realpath(venv_root / "bin/python")) != interpreter:
        reject("SNAPSHOT_TEST_RUNTIME_INTERPRETER_INVALID")
    node_metadata = assert_runtime_tree_safe(node_root, uid, mountinfo=mountinfo)
    venv_metadata = assert_runtime_tree_safe(venv_root, uid, {interpreter}, mountinfo)
    node_digest = runtime_tree_digest(node_root)
    venv_digest = runtime_tree_digest(venv_root)
    node_metadata_after = assert_runtime_tree_safe(node_root, uid, mountinfo=mountinfo)
    venv_metadata_after = assert_runtime_tree_safe(venv_root, uid, {interpreter}, mountinfo)
    if node_metadata_after != node_metadata or venv_metadata_after != venv_metadata:
        reject("SNAPSHOT_TEST_RUNTIME_CHANGED")
    if node_digest != node["tree_sha256"] or venv_digest != python["venv_tree_sha256"]:
        reject("SNAPSHOT_TEST_RUNTIME_DIGEST_MISMATCH")
    return {
        "mode": "BORROWED_NEVER_REMOVE", "root": str(runtime_root), "root_device": runtime_stat.st_dev, "root_inode": runtime_stat.st_ino,
        "trust_root": str(trust_root), "root_path_chain": runtime_chain,
        "policy_sha256": sha256(policy_raw), "package_lock_sha256": node["package_lock_sha256"],
        "requirements_sha256": python["requirements_sha256"], "requirements_dev_sha256": python["requirements_dev_sha256"],
        "node_modules": {"path": str(node_root), "path_chain": node_chain, **node_metadata, "tree_sha256": node_digest},
        "python_venv": {"path": str(venv_root), "path_chain": venv_chain, **venv_metadata, "tree_sha256": venv_digest},
        "python_interpreter": {
            "path": str(interpreter), "path_chain": interpreter_chain, "device": interpreter_stat.st_dev,
            "inode": interpreter_stat.st_ino, "mode": f"{stat.S_IMODE(interpreter_stat.st_mode):04o}",
            "bytes": len(interpreter_raw), "sha256": python["interpreter_sha256"],
        },
    }


def parse_worktrees(repository: Path) -> list[dict[str, Any]]:
    raw = str(git(repository, "worktree", "list", "--porcelain", code="SNAPSHOT_WORKTREE_ADMIN_INVALID"))
    result: list[dict[str, Any]] = []
    for block in raw.split("\n\n"):
        if not block.strip():
            continue
        value: dict[str, Any] = {"detached": False, "locked": None}
        for line in block.splitlines():
            if line == "detached":
                value["detached"] = True
            elif line == "bare":
                value["bare"] = True
            elif line.startswith("locked"):
                value["locked"] = line[7:] if line.startswith("locked ") else ""
            elif " " in line:
                key, item = line.split(" ", 1)
                if key in value:
                    reject("SNAPSHOT_WORKTREE_ADMIN_INVALID")
                value[key] = item
            else:
                reject("SNAPSHOT_WORKTREE_ADMIN_INVALID")
        result.append(value)
    return result


def admin_tree_identity(admin: Path, uid: int, require_locked: bool) -> dict[str, Any]:
    expected = {"HEAD", "ORIG_HEAD", "commondir", "gitdir", "index", "logs", "logs/HEAD"}
    actual: set[str] = set()
    for current, names, files in os.walk(admin, topdown=True, followlinks=False):
        for name in [*names, *files]:
            actual.add((Path(current) / name).relative_to(admin).as_posix())
    allowed = expected | {"locked"}
    if actual - allowed or not expected.issubset(actual) or (require_locked and "locked" not in actual):
        reject("SNAPSHOT_WORKTREE_ADMIN_STATE_INVALID")
    metadata = tree_metadata_identity(
        admin,
        uid,
        "SNAPSHOT_WORKTREE_ADMIN_STATE_INVALID",
        excluded_relatives={"locked"},
    )
    files: list[dict[str, Any]] = []
    for relative in sorted(expected - {"logs"}):
        raw, value = trusted_regular_file(
            admin / relative,
            {0o600, 0o644},
            "SNAPSHOT_WORKTREE_ADMIN_STATE_INVALID",
            uid,
            64 * 1024 * 1024,
        )
        files.append({
            "path": relative,
            "device": value.st_dev,
            "inode": value.st_ino,
            "mode": f"{stat.S_IMODE(value.st_mode):04o}",
            "bytes": len(raw),
            "sha256": sha256(raw),
        })
    lock_file: dict[str, Any] | None = None
    if "locked" in actual:
        raw, value = trusted_regular_file(
            admin / "locked",
            {0o600, 0o644},
            "SNAPSHOT_WORKTREE_ADMIN_STATE_INVALID",
            uid,
            4096,
        )
        lock_file = {
            "device": value.st_dev,
            "inode": value.st_ino,
            "mode": f"{stat.S_IMODE(value.st_mode):04o}",
            "bytes": len(raw),
            "sha256": sha256(raw),
        }
    return {**metadata, "files_sha256": sha256(canonical_json(files)), "files": files, "lock_file": lock_file}


def snapshot_identity(source: Path, target: Path, candidate: dict[str, Any], lock_reason: str, require_locked: bool = True, uid: int = 0, mountinfo: str | None = None) -> dict[str, Any]:
    target_stat = trusted_directory(target, "SNAPSHOT_WORKTREE_ROOT_INVALID", uid=uid)
    assert_no_nested_mount(target, mountinfo)
    git_file = target / ".git"
    raw, git_stat = trusted_regular_file(git_file, {0o600, 0o644}, "SNAPSHOT_WORKTREE_GITFILE_INVALID", uid, 4096)
    try:
        git_text = raw.decode("utf-8")
    except UnicodeDecodeError:
        reject("SNAPSHOT_WORKTREE_GITFILE_INVALID")
    if not git_text.startswith("gitdir: ") or not git_text.endswith("\n") or "\n" in git_text[:-1]:
        reject("SNAPSHOT_WORKTREE_GITFILE_INVALID")
    admin = canonical_path(Path(git_text[8:-1]), "SNAPSHOT_WORKTREE_ADMIN_INVALID")
    common = Path(str(git(source, "rev-parse", "--git-common-dir", code="SNAPSHOT_WORKTREE_ADMIN_INVALID")))
    if not common.is_absolute():
        common = (source / common).resolve()
    if admin.parent != common / "worktrees" or not IDENTIFIER.fullmatch(admin.name):
        reject("SNAPSHOT_WORKTREE_ADMIN_INVALID")
    admin_stat = trusted_directory(admin, "SNAPSHOT_WORKTREE_ADMIN_INVALID", uid=uid)
    backlink_raw, _ = trusted_regular_file(admin / "gitdir", {0o600, 0o644}, "SNAPSHOT_WORKTREE_ADMIN_INVALID", uid, 4096)
    if backlink_raw != f"{git_file}\n".encode("utf-8"):
        reject("SNAPSHOT_WORKTREE_ADMIN_INVALID")
    commondir_raw, _ = trusted_regular_file(admin / "commondir", {0o600, 0o644}, "SNAPSHOT_WORKTREE_ADMIN_INVALID", uid, 4096)
    if (admin / commondir_raw.decode("utf-8").strip()).resolve() != common:
        reject("SNAPSHOT_WORKTREE_ADMIN_INVALID")
    locked_path = admin / "locked"
    actual_lock: str | None = None
    if path_exists(locked_path):
        locked_raw, _ = trusted_regular_file(locked_path, {0o600, 0o644}, "SNAPSHOT_WORKTREE_LOCK_INVALID", uid, 4096)
        actual_lock = locked_raw.decode("utf-8").rstrip("\n")
    if require_locked and actual_lock != lock_reason:
        reject("SNAPSHOT_WORKTREE_LOCK_INVALID")
    if not require_locked and actual_lock not in (None, lock_reason):
        reject("SNAPSHOT_WORKTREE_LOCK_INVALID")
    if git(target, "rev-parse", "--show-toplevel", code="SNAPSHOT_WORKTREE_GIT_INVALID") != str(target):
        reject("SNAPSHOT_WORKTREE_GIT_INVALID")
    if git(target, "rev-parse", "--verify", "HEAD^{commit}", code="SNAPSHOT_WORKTREE_GIT_INVALID") != candidate["commit"] or git(target, "rev-parse", "--verify", "HEAD^{tree}", code="SNAPSHOT_WORKTREE_GIT_INVALID") != candidate["tree"] or git(target, "rev-parse", "--verify", "HEAD:chenyida_erp_site", code="SNAPSHOT_WORKTREE_GIT_INVALID") != candidate["site_tree"]:
        reject("SNAPSHOT_WORKTREE_GIT_MISMATCH")
    branch = git_result(target, "symbolic-ref", "-q", "HEAD")
    if branch.returncode != 1 or branch.stdout:
        reject("SNAPSHOT_WORKTREE_NOT_DETACHED")
    for arguments in (("diff", "--quiet", "--no-ext-diff", "--no-textconv", "--"), ("diff", "--cached", "--quiet", "--no-ext-diff", "--no-textconv", "--")):
        if git_result(target, *arguments).returncode != 0:
            reject("SNAPSHOT_WORKTREE_DIRTY")
    status = git(target, "status", "--porcelain=v2", "--untracked-files=all", "--ignored=matching", binary=True, code="SNAPSHOT_WORKTREE_GIT_INVALID")
    if status != b"":
        reject("SNAPSHOT_WORKTREE_DIRTY")
    tracked = git(target, "ls-files", "-v", "-z", binary=True, code="SNAPSHOT_WORKTREE_GIT_INVALID")
    assert isinstance(tracked, bytes)
    records = [record for record in tracked.split(b"\0") if record]
    if not records or any(not record.startswith(b"H ") for record in records):
        reject("SNAPSHOT_WORKTREE_INDEX_STATE_INVALID")
    matches = [entry for entry in parse_worktrees(source) if entry.get("worktree") == str(target)]
    if (
        len(matches) != 1
        or set(matches[0]) != {"worktree", "HEAD", "detached", "locked"}
        or matches[0].get("HEAD") != candidate["commit"]
        or matches[0].get("detached") is not True
    ):
        reject("SNAPSHOT_WORKTREE_ADMIN_INVALID")
    if require_locked and matches[0].get("locked") != lock_reason:
        reject("SNAPSHOT_WORKTREE_LOCK_INVALID")
    if not require_locked and matches[0].get("locked") not in (None, lock_reason):
        reject("SNAPSHOT_WORKTREE_LOCK_INVALID")
    filesystem = tree_metadata_identity(target, uid, "SNAPSHOT_WORKTREE_FILESYSTEM_INVALID")
    admin_tree = admin_tree_identity(admin, uid, require_locked)
    return {
        "root": str(target), "root_device": target_stat.st_dev, "root_inode": target_stat.st_ino,
        "root_mode": f"{stat.S_IMODE(target_stat.st_mode):04o}",
        "git_file_device": git_stat.st_dev, "git_file_inode": git_stat.st_ino,
        "admin_dir": str(admin), "admin_device": admin_stat.st_dev, "admin_inode": admin_stat.st_ino,
        "admin_mode": f"{stat.S_IMODE(admin_stat.st_mode):04o}",
        "filesystem": filesystem, "admin_tree": admin_tree,
        "lock_reason": lock_reason, "locked": actual_lock == lock_reason,
    }


def common_git_directory(source: Path) -> Path:
    value = Path(str(git(source, "rev-parse", "--git-common-dir", code="SNAPSHOT_WORKTREE_ADMIN_INVALID")))
    if not value.is_absolute():
        value = (source / value).resolve()
    trusted_directory(value, "SNAPSHOT_WORKTREE_ADMIN_INVALID")
    return value


def recovery_tree_identity(path: Path, uid: int, code: str) -> dict[str, Any]:
    value = trusted_directory(path, code, uid=uid)
    assert_no_nested_mount(path)
    return {
        "root_device": value.st_dev,
        "root_inode": value.st_ino,
        "root_mode": f"{stat.S_IMODE(value.st_mode):04o}",
        "filesystem": tree_metadata_identity(path, uid, code),
    }


def target_only_recovery_identity(source: Path, target: Path, uid: int) -> tuple[Path, dict[str, Any]]:
    common = common_git_directory(source)
    raw, _ = trusted_regular_file(target / ".git", {0o600, 0o644}, "SNAPSHOT_RECOVERY_TARGET_INVALID", uid, 4096)
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        reject("SNAPSHOT_RECOVERY_TARGET_INVALID")
    if not text.startswith("gitdir: ") or not text.endswith("\n") or "\n" in text[:-1]:
        reject("SNAPSHOT_RECOVERY_TARGET_INVALID")
    admin = canonical_path(Path(text[8:-1]), "SNAPSHOT_RECOVERY_TARGET_INVALID")
    if admin.parent != common / "worktrees" or not IDENTIFIER.fullmatch(admin.name) or path_exists(admin):
        reject("SNAPSHOT_RECOVERY_TARGET_INVALID")
    return admin, recovery_tree_identity(target, uid, "SNAPSHOT_RECOVERY_TARGET_INVALID")


def admin_only_recovery_identity(
    source: Path,
    target: Path,
    admin: Path,
    candidate_commit: str,
    lock_reason: str,
    uid: int,
) -> dict[str, Any]:
    common = common_git_directory(source)
    if admin.parent != common / "worktrees" or not IDENTIFIER.fullmatch(admin.name):
        reject("SNAPSHOT_RECOVERY_ADMIN_INVALID")
    value = trusted_directory(admin, "SNAPSHOT_RECOVERY_ADMIN_INVALID", uid=uid)
    assert_no_nested_mount(admin)
    head_raw, _ = trusted_regular_file(admin / "HEAD", {0o600, 0o644}, "SNAPSHOT_RECOVERY_ADMIN_INVALID", uid, 4096)
    gitdir_raw, _ = trusted_regular_file(admin / "gitdir", {0o600, 0o644}, "SNAPSHOT_RECOVERY_ADMIN_INVALID", uid, 4096)
    commondir_raw, _ = trusted_regular_file(admin / "commondir", {0o600, 0o644}, "SNAPSHOT_RECOVERY_ADMIN_INVALID", uid, 4096)
    try:
        commondir = (admin / commondir_raw.decode("utf-8").strip()).resolve()
    except UnicodeDecodeError:
        reject("SNAPSHOT_RECOVERY_ADMIN_INVALID")
    if head_raw != f"{candidate_commit}\n".encode("ascii") or gitdir_raw != f"{target / '.git'}\n".encode("utf-8") or commondir != common:
        reject("SNAPSHOT_RECOVERY_ADMIN_INVALID")
    actual_lock: str | None = None
    if path_exists(admin / "locked"):
        lock_raw, _ = trusted_regular_file(admin / "locked", {0o600, 0o644}, "SNAPSHOT_RECOVERY_ADMIN_INVALID", uid, 4096)
        try:
            actual_lock = lock_raw.decode("utf-8").rstrip("\n")
        except UnicodeDecodeError:
            reject("SNAPSHOT_RECOVERY_ADMIN_INVALID")
    if actual_lock not in (None, lock_reason):
        reject("SNAPSHOT_RECOVERY_ADMIN_INVALID")
    matches = [entry for entry in parse_worktrees(source) if entry.get("worktree") == str(target)]
    if len(matches) != 1:
        reject("SNAPSHOT_RECOVERY_ADMIN_INVALID")
    registration = matches[0]
    if (
        set(registration) not in (
            {"worktree", "HEAD", "detached", "locked"},
            {"worktree", "HEAD", "detached", "locked", "prunable"},
        )
        or registration.get("HEAD") != candidate_commit
        or registration.get("detached") is not True
        or registration.get("locked") != actual_lock
    ):
        reject("SNAPSHOT_RECOVERY_ADMIN_INVALID")
    return {
        "root": str(admin),
        "root_device": value.st_dev,
        "root_inode": value.st_ino,
        "root_mode": f"{stat.S_IMODE(value.st_mode):04o}",
        "lock_reason": actual_lock,
        "admin_tree": admin_tree_identity(admin, uid, False),
    }


def find_admin_for_missing_target(source: Path, target: Path, uid: int) -> Path:
    worktrees = common_git_directory(source) / "worktrees"
    trusted_directory(worktrees, "SNAPSHOT_RECOVERY_ADMIN_INVALID", uid=uid)
    expected = f"{target / '.git'}\n".encode("utf-8")
    matches: list[Path] = []
    for child in sorted(worktrees.iterdir(), key=lambda item: os.fsencode(item.name)):
        if not IDENTIFIER.fullmatch(child.name) or not path_exists(child / "gitdir"):
            continue
        raw, _ = trusted_regular_file(child / "gitdir", {0o600, 0o644}, "SNAPSHOT_RECOVERY_ADMIN_INVALID", uid, 4096)
        if raw == expected:
            matches.append(child)
    if len(matches) != 1:
        reject("SNAPSHOT_RECOVERY_ADMIN_INVALID")
    return matches[0]


def ensure_private_directory(path: Path, uid: int) -> None:
    trusted_directory(path.parent, "SNAPSHOT_RECOVERY_QUARANTINE_INVALID", uid=uid)
    if not path_exists(path):
        try:
            path.mkdir(mode=0o700)
            os.chown(path, uid, 0)
            fsync_directory(path.parent)
        except OSError:
            reject("SNAPSHOT_RECOVERY_QUARANTINE_INVALID")
    trusted_directory(path, "SNAPSHOT_RECOVERY_QUARANTINE_INVALID", {0o700}, uid)


def validate_identifier(value: str) -> str:
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        reject("SNAPSHOT_ID_INVALID")
    return value


def now_iso(clock: Callable[[], datetime]) -> str:
    value = clock().astimezone(timezone.utc)
    return value.strftime("%Y-%m-%dT%H:%M:%S.") + f"{value.microsecond // 1000:03d}Z"


def contains(parent: Path, child: Path) -> bool:
    return child == parent or str(child).startswith(f"{parent}/")


RESERVATION_FIELDS = {
    "schema_version", "contract", "state", "reservation_id", "generation", "snapshot_id",
    "request_id", "reserved_at", "confirmation", "prepare_intent", "prepare_intent_sha256",
    "source_repository", "candidate", "supervisor_bundle", "test_runtime",
    "source_state_before", "lock_reason", "expected_admin_dir", "previous_terminal_recovery",
    "git_worktrees_parent_before_dispatch",
    "staging_root", "snapshot_root", "staging_parent", "snapshot_parent",
    "staging_path_chain", "snapshot_path_chain", "reserved_root",
    "target_absent_at_publication", "promotion", "retention",
}
RESERVATION_REFERENCE_FIELDS = {
    "receipt", "receipt_sha256", "reservation_id", "generation",
    "root_device", "root_inode", "root_mode",
}


def reservation_parent_identity(path: Path, uid: int, mountinfo: str | None = None) -> dict[str, Any]:
    value = trusted_directory(path, "SNAPSHOT_RESERVATION_PARENT_INVALID", {0o700}, uid)
    assert_no_nested_mount(path, mountinfo)
    return {
        "path": str(path),
        "device": value.st_dev,
        "inode": value.st_ino,
        "mode": f"{stat.S_IMODE(value.st_mode):04o}",
        "uid": value.st_uid,
        "gid": value.st_gid,
        "mount": containing_mount_identity(path, mountinfo),
    }


def reservation_root_identity(
    path: Path,
    uid: int,
    *,
    require_empty: bool,
    mountinfo: str | None = None,
) -> dict[str, Any]:
    value = trusted_directory(path, "SNAPSHOT_RESERVATION_ROOT_INVALID", {0o700}, uid)
    assert_no_nested_mount(path, mountinfo)
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError:
        reject("SNAPSHOT_RESERVATION_ROOT_INVALID")
    try:
        opened = os.fstat(descriptor)
        pointed = os.lstat(path)
        if (
            opened.st_dev != value.st_dev
            or opened.st_ino != value.st_ino
            or pointed.st_dev != value.st_dev
            or pointed.st_ino != value.st_ino
        ):
            reject("SNAPSHOT_RESERVATION_ROOT_INVALID")
        if require_empty:
            try:
                with os.scandir(descriptor) as entries:
                    if next(entries, None) is not None:
                        reject("SNAPSHOT_RESERVATION_ROOT_NOT_EMPTY")
            except OSError:
                reject("SNAPSHOT_RESERVATION_ROOT_INVALID")
    finally:
        os.close(descriptor)
    return {
        "device": value.st_dev,
        "inode": value.st_ino,
        "mode": f"{stat.S_IMODE(value.st_mode):04o}",
        "uid": value.st_uid,
        "gid": value.st_gid,
        "empty": True,
        "mount": containing_mount_identity(path, mountinfo),
    }


def reservation_receipt_path(paths: SnapshotPaths, snapshot_id: str, intent_digest: str, generation: int) -> Path:
    return paths.reservations / f"{snapshot_id}.{intent_digest}.g{generation:06d}.reserved.json"


def reservation_staging_path(paths: SnapshotPaths, snapshot_id: str, intent_digest: str, generation: int) -> Path:
    return paths.staging / f"{snapshot_id}.{intent_digest}.g{generation:06d}.reserved"


def reservation_identifier(value: dict[str, Any]) -> str:
    identity = {key: value[key] for key in RESERVATION_FIELDS - {"reservation_id", "reserved_at"}}
    return sha256(canonical_json(identity))


def current_git_worktrees_parent_identity(
    source_repository: dict[str, Any],
    uid: int,
    mountinfo: str | None = None,
) -> dict[str, Any]:
    common = canonical_path(Path(source_repository["common_git_dir"]), "SNAPSHOT_WORKTREE_PARENT_CHANGED")
    parent = common / "worktrees"
    if not path_exists(parent):
        common_stat = trusted_directory(common, "SNAPSHOT_WORKTREE_PARENT_CHANGED", uid=uid)
        return {
            "path": str(parent),
            "exists": False,
            "parent_device": common_stat.st_dev,
            "parent_inode": common_stat.st_ino,
        }
    value = trusted_directory(parent, "SNAPSHOT_WORKTREE_PARENT_CHANGED", uid=uid)
    assert_no_nested_mount(parent, mountinfo)
    return {
        "path": str(parent),
        "exists": True,
        "device": value.st_dev,
        "inode": value.st_ino,
        "mode": f"{stat.S_IMODE(value.st_mode):04o}",
        "uid": value.st_uid,
        "gid": value.st_gid,
        "mount": containing_mount_identity(parent, mountinfo),
    }


def load_target_reservation(path: Path, paths: SnapshotPaths) -> tuple[dict[str, Any], bytes]:
    if path.parent != paths.reservations or path.name != Path(path.name).name:
        reject("SNAPSHOT_RESERVATION_RECEIPT_PATH_INVALID")
    value, raw = load_canonical_record(
        path,
        RESERVATION_FIELDS,
        RESERVATION_CONTRACT,
        "SNAPSHOT_RESERVATION_RECEIPT_INVALID",
        paths,
    )
    snapshot_id = validate_identifier(value.get("snapshot_id"))
    generation = value.get("generation")
    intent_digest = value.get("prepare_intent_sha256")
    root = value.get("reserved_root")
    staging_parent = value.get("staging_parent")
    snapshot_parent = value.get("snapshot_parent")
    git_parent = value.get("git_worktrees_parent_before_dispatch")
    if (
        value.get("state") != "RESERVED"
        or value.get("confirmation") != RESERVATION_CONFIRMATION
        or not isinstance(generation, int)
        or isinstance(generation, bool)
        or not 1 <= generation <= 999999
        or value.get("request_id") != f"{snapshot_id}:g{generation:06d}"
        or not isinstance(intent_digest, str)
        or not SHA256.fullmatch(intent_digest)
        or value.get("prepare_intent") != str(paths.state / f"{snapshot_id}.prepare-intent.json")
        or value.get("snapshot_root") != str(paths.worktrees / snapshot_id)
        or value.get("staging_root") != str(reservation_staging_path(paths, snapshot_id, intent_digest, generation))
        or path != reservation_receipt_path(paths, snapshot_id, intent_digest, generation)
        or value.get("promotion") != "ATOMIC_RENAME_NOREPLACE_SAME_INODE"
        or value.get("retention") != "BOUND_UNTIL_PREPARED_OR_RECOVERED"
        or not isinstance(value.get("reserved_at"), str)
        or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z", value["reserved_at"])
        or not isinstance(value.get("source_repository"), dict)
        or not isinstance(value["source_repository"].get("common_git_dir"), str)
        or not isinstance(value.get("candidate"), dict)
        or not isinstance(value.get("supervisor_bundle"), dict)
        or not isinstance(value.get("test_runtime"), dict)
        or not isinstance(root, dict)
        or set(root) != {"device", "inode", "mode", "uid", "gid", "empty", "mount"}
        or not isinstance(root.get("device"), int)
        or not isinstance(root.get("inode"), int)
        or root.get("mode") != "0700"
        or root.get("uid") != paths.uid
        or root.get("gid") != 0
        or root.get("empty") is not True
        or not isinstance(staging_parent, dict)
        or set(staging_parent) != {"path", "device", "inode", "mode", "uid", "gid", "mount"}
        or not isinstance(snapshot_parent, dict)
        or set(snapshot_parent) != {"path", "device", "inode", "mode", "uid", "gid", "mount"}
        or staging_parent.get("path") != str(paths.staging)
        or snapshot_parent.get("path") != str(paths.worktrees)
        or staging_parent.get("mode") != "0700"
        or snapshot_parent.get("mode") != "0700"
        or staging_parent.get("uid") != paths.uid
        or snapshot_parent.get("uid") != paths.uid
        or staging_parent.get("gid") != 0
        or snapshot_parent.get("gid") != 0
        or root.get("device") != staging_parent.get("device")
        or root.get("device") != snapshot_parent.get("device")
        or not isinstance(value.get("staging_path_chain"), list)
        or not isinstance(value.get("snapshot_path_chain"), list)
        or value.get("reservation_id") != reservation_identifier(value)
        or value.get("target_absent_at_publication") is not True
        or not isinstance(value.get("source_state_before"), dict)
        or value.get("lock_reason") != f"{LOCK_REASON_PREFIX}{snapshot_id}"
        or not isinstance(value.get("expected_admin_dir"), str)
        or value.get("expected_admin_dir")
        != str(Path(value["source_repository"].get("common_git_dir", "/invalid")) / "worktrees" / snapshot_id)
        or (generation == 1 and value.get("previous_terminal_recovery") is not None)
        or not isinstance(git_parent, dict)
        or not isinstance(git_parent.get("exists"), bool)
        or git_parent.get("path")
        != str(Path(value["source_repository"]["common_git_dir"]) / "worktrees")
        or set(git_parent)
        != (
            {"path", "exists", "device", "inode", "mode", "uid", "gid", "mount"}
            if git_parent["exists"]
            else {"path", "exists", "parent_device", "parent_inode"}
        )
        or (
            generation > 1
            and (
                not isinstance(value.get("previous_terminal_recovery"), dict)
                or set(value["previous_terminal_recovery"]) != {"audit", "audit_sha256"}
                or not isinstance(value["previous_terminal_recovery"].get("audit"), str)
                or not isinstance(value["previous_terminal_recovery"].get("audit_sha256"), str)
                or not SHA256.fullmatch(value["previous_terminal_recovery"]["audit_sha256"])
            )
        )
    ):
        reject("SNAPSHOT_RESERVATION_RECEIPT_INVALID")
    if generation > 1:
        terminal = value["previous_terminal_recovery"]
        audit_path = canonical_path(Path(terminal["audit"]), "SNAPSHOT_RESERVATION_RECEIPT_INVALID")
        if audit_path.parent != paths.audit:
            reject("SNAPSHOT_RESERVATION_RECEIPT_INVALID")
        audit_raw, _ = trusted_regular_file(
            audit_path, 0o400, "SNAPSHOT_RESERVATION_RECEIPT_INVALID", paths.uid,
        )
        if sha256(audit_raw) != terminal["audit_sha256"]:
            reject("SNAPSHOT_RESERVATION_RECEIPT_INVALID")
    current_staging_parent = reservation_parent_identity(paths.staging, paths.uid)
    current_snapshot_parent = reservation_parent_identity(paths.worktrees, paths.uid)
    current_staging_chain = trusted_directory_chain(
        paths.staging, paths.trust_root, "SNAPSHOT_RESERVATION_PATH_UNTRUSTED", paths.uid,
    )
    current_snapshot_chain = trusted_directory_chain(
        paths.worktrees, paths.trust_root, "SNAPSHOT_RESERVATION_PATH_UNTRUSTED", paths.uid,
    )
    if (
        staging_parent != current_staging_parent
        or snapshot_parent != current_snapshot_parent
        or value["staging_path_chain"] != current_staging_chain
        or value["snapshot_path_chain"] != current_snapshot_chain
    ):
        reject("SNAPSHOT_RESERVATION_PARENT_CHANGED")
    return value, raw


def target_reservation_reference(path: Path, raw: bytes, value: dict[str, Any]) -> dict[str, Any]:
    root = value["reserved_root"]
    return {
        "receipt": str(path),
        "receipt_sha256": sha256(raw),
        "reservation_id": value["reservation_id"],
        "generation": value["generation"],
        "root_device": root["device"],
        "root_inode": root["inode"],
        "root_mode": root["mode"],
    }


def load_target_reservation_reference(
    reference: Any,
    paths: SnapshotPaths,
) -> tuple[Path, dict[str, Any], bytes]:
    value = exact_fields(reference, RESERVATION_REFERENCE_FIELDS, "SNAPSHOT_RESERVATION_REFERENCE_INVALID")
    if (
        not isinstance(value.get("receipt"), str)
        or not isinstance(value.get("receipt_sha256"), str)
        or not SHA256.fullmatch(value["receipt_sha256"])
    ):
        reject("SNAPSHOT_RESERVATION_REFERENCE_INVALID")
    receipt_path = canonical_path(Path(value["receipt"]), "SNAPSHOT_RESERVATION_REFERENCE_INVALID")
    receipt, raw = load_target_reservation(receipt_path, paths)
    if sha256(raw) != value["receipt_sha256"] or value != target_reservation_reference(receipt_path, raw, receipt):
        reject("SNAPSHOT_RESERVATION_REFERENCE_INVALID")
    return receipt_path, receipt, raw


def assert_reserved_root(
    path: Path,
    reservation: dict[str, Any],
    uid: int,
    *,
    require_empty: bool,
    mountinfo: str | None = None,
) -> None:
    if reservation_root_identity(path, uid, require_empty=require_empty, mountinfo=mountinfo) != reservation["reserved_root"]:
        reject("SNAPSHOT_RESERVATION_ROOT_REPLACED")


@contextmanager
def held_reserved_root(
    path: Path,
    reservation: dict[str, Any],
    uid: int,
    mountinfo: str | None = None,
) -> Iterator[None]:
    assert_reserved_root(path, reservation, uid, require_empty=True, mountinfo=mountinfo)
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError:
        reject("SNAPSHOT_RESERVATION_ROOT_INVALID")
    try:
        opened = os.fstat(descriptor)
        root = reservation["reserved_root"]
        if opened.st_dev != root["device"] or opened.st_ino != root["inode"]:
            reject("SNAPSHOT_RESERVATION_ROOT_REPLACED")
        yield
        pointed = os.lstat(path)
        held = os.fstat(descriptor)
        if (
            pointed.st_dev != root["device"]
            or pointed.st_ino != root["inode"]
            or held.st_dev != root["device"]
            or held.st_ino != root["inode"]
        ):
            reject("SNAPSHOT_RESERVATION_ROOT_REPLACED")
    except OSError:
        reject("SNAPSHOT_RESERVATION_ROOT_REPLACED")
    finally:
        os.close(descriptor)


def prepare_recovery_terminal(
    reference: dict[str, Any],
    snapshot_id: str,
    intent_digest: str,
    paths: SnapshotPaths,
) -> dict[str, Any] | None:
    prefix = f"{snapshot_id}.{intent_digest}.prepare.g"
    suffix = ".recovery-intent.json"
    matches: list[dict[str, Any] | None] = []
    for item in sorted(paths.state.iterdir(), key=lambda value: os.fsencode(value.name)):
        if not item.name.startswith(prefix) or not item.name.endswith(suffix):
            continue
        plan, plan_raw = load_recovery_intent(item, paths)
        if plan.get("target_reservation") != reference:
            continue
        expected_intent, expected_audit = recovery_paths(
            paths,
            snapshot_id,
            intent_digest,
            "PREPARE",
            plan["generation"],
            plan["object_identity_sha256"],
        )
        if item != expected_intent:
            reject("SNAPSHOT_RECOVERY_INTENT_CONFLICT")
        if path_exists(expected_audit):
            _, audit_raw = validate_completed_recovery(plan, plan_raw, item, expected_audit, paths)
            matches.append({"audit": str(expected_audit), "audit_sha256": sha256(audit_raw)})
        else:
            matches.append(None)
    if len(matches) > 1:
        reject("SNAPSHOT_RESERVATION_RECOVERY_AMBIGUOUS")
    return matches[0] if matches else None


def reservation_closed_by_prepare_recovery(
    reference: dict[str, Any],
    snapshot_id: str,
    intent_digest: str,
    paths: SnapshotPaths,
) -> bool:
    return prepare_recovery_terminal(reference, snapshot_id, intent_digest, paths) is not None


def validated_target_reservation_catalog(
    snapshot_id: str,
    intent_raw: bytes,
    source_identity: dict[str, Any],
    candidate: dict[str, Any],
    bundle: dict[str, Any],
    runtime: dict[str, Any],
    paths: SnapshotPaths,
) -> list[tuple[Path, bytes, dict[str, Any], dict[str, Any]]]:
    intent_digest = sha256(intent_raw)
    prefix = f"{snapshot_id}.{intent_digest}.g"
    suffix = ".reserved.json"
    catalog: list[tuple[Path, bytes, dict[str, Any], dict[str, Any]]] = []
    for item in sorted(paths.reservations.iterdir(), key=lambda value: os.fsencode(value.name)):
        if not item.name.startswith(prefix) or not item.name.endswith(suffix):
            continue
        value, raw = load_target_reservation(item, paths)
        reference = target_reservation_reference(item, raw, value)
        if (
            value.get("prepare_intent_sha256") != intent_digest
            or value.get("source_repository") != source_identity
            or value.get("candidate") != candidate
            or value.get("supervisor_bundle") != bundle
            or value.get("test_runtime") != runtime
            or value.get("snapshot_root") != str(paths.worktrees / snapshot_id)
            or value.get("source_state_before")
            != load_prepare_intent(snapshot_id, paths)[0].get("source_state_before")
            or value.get("lock_reason") != f"{LOCK_REASON_PREFIX}{snapshot_id}"
            or value.get("expected_admin_dir")
            != str(Path(source_identity["common_git_dir"]) / "worktrees" / snapshot_id)
        ):
            reject("SNAPSHOT_RESERVATION_BINDING_INVALID")
        catalog.append((item, raw, value, reference))
    generations = [entry[2]["generation"] for entry in catalog]
    if generations and (len(set(generations)) != len(generations) or sorted(generations) != list(range(1, max(generations) + 1))):
        reject("SNAPSHOT_RESERVATION_GENERATION_CHAIN_INVALID")
    for index, (_, _, value, _) in enumerate(catalog):
        if index == 0:
            continue
        terminal = prepare_recovery_terminal(catalog[index - 1][3], snapshot_id, intent_digest, paths)
        if terminal is None or value.get("previous_terminal_recovery") != terminal:
            reject("SNAPSHOT_RESERVATION_GENERATION_STATE_CONFLICT")
    return catalog


def latest_target_reservation(
    snapshot_id: str,
    intent_raw: bytes,
    source_identity: dict[str, Any],
    candidate: dict[str, Any],
    bundle: dict[str, Any],
    runtime: dict[str, Any],
    paths: SnapshotPaths,
) -> tuple[Path, bytes, dict[str, Any], dict[str, Any]]:
    catalog = validated_target_reservation_catalog(
        snapshot_id, intent_raw, source_identity, candidate, bundle, runtime, paths,
    )
    if not catalog:
        reject("SNAPSHOT_RESERVATION_RECEIPT_MISSING")
    return catalog[-1]


def resume_target_reservation_publication(
    receipt_path: Path,
    snapshot_id: str,
    generation: int,
    intent: dict[str, Any],
    intent_raw: bytes,
    source_identity: dict[str, Any],
    candidate: dict[str, Any],
    bundle: dict[str, Any],
    runtime: dict[str, Any],
    paths: SnapshotPaths,
    mountinfo: str | None = None,
) -> tuple[Path, bytes, dict[str, Any], dict[str, Any]] | None:
    temporary = receipt_path.parent / f".{receipt_path.name}.publishing"
    if path_exists(receipt_path) or not path_exists(temporary):
        return None
    raw, _ = trusted_regular_file(
        temporary,
        0o400,
        "SNAPSHOT_RESERVATION_PUBLICATION_INVALID",
        paths.uid,
        MAX_JSON_BYTES,
        {1},
    )
    value = exact_fields(
        strict_json(raw, "SNAPSHOT_RESERVATION_PUBLICATION_INVALID"),
        RESERVATION_FIELDS,
        "SNAPSHOT_RESERVATION_PUBLICATION_INVALID",
    )
    staging_root = reservation_staging_path(paths, snapshot_id, sha256(intent_raw), generation)
    if (
        raw != canonical_json(value)
        or value.get("schema_version") != 1
        or value.get("contract") != RESERVATION_CONTRACT
        or value.get("state") != "RESERVED"
        or value.get("snapshot_id") != snapshot_id
        or value.get("generation") != generation
        or value.get("prepare_intent_sha256") != sha256(intent_raw)
        or value.get("source_repository") != source_identity
        or value.get("candidate") != candidate
        or value.get("supervisor_bundle") != bundle
        or value.get("test_runtime") != runtime
        or value.get("staging_root") != str(staging_root)
        or value.get("snapshot_root") != str(paths.worktrees / snapshot_id)
        or value.get("expected_admin_dir") != intent.get("expected_admin_dir")
        or not isinstance(value.get("reserved_root"), dict)
        or not path_exists(staging_root)
        or path_exists(paths.worktrees / snapshot_id)
        or path_exists(Path(intent["expected_admin_dir"]))
        or any(
            entry.get("worktree") == str(paths.worktrees / snapshot_id)
            for entry in parse_worktrees(Path(source_identity["root"]))
        )
    ):
        reject("SNAPSHOT_RESERVATION_PUBLICATION_INVALID")
    if reservation_root_identity(
        staging_root, paths.uid, require_empty=True, mountinfo=mountinfo,
    ) != value["reserved_root"]:
        reject("SNAPSHOT_RESERVATION_PUBLICATION_INVALID")
    write_no_clobber(receipt_path, raw, uid=paths.uid)
    loaded, loaded_raw = load_target_reservation(receipt_path, paths)
    reference = target_reservation_reference(receipt_path, loaded_raw, loaded)
    return receipt_path, loaded_raw, loaded, reference


def build_or_load_target_reservation(
    snapshot_id: str,
    intent: dict[str, Any],
    intent_raw: bytes,
    source_identity: dict[str, Any],
    candidate: dict[str, Any],
    bundle: dict[str, Any],
    runtime: dict[str, Any],
    paths: SnapshotPaths,
    clock: Callable[[], datetime],
    failpoint: Callable[[str], None] | None,
    allow_create: bool,
    mountinfo: str | None = None,
) -> tuple[Path, bytes, dict[str, Any], dict[str, Any]]:
    intent_digest = sha256(intent_raw)
    catalog = validated_target_reservation_catalog(
        snapshot_id, intent_raw, source_identity, candidate, bundle, runtime, paths,
    )
    previous_terminal_recovery: dict[str, Any] | None = None
    if catalog:
        latest = catalog[-1]
        previous_terminal_recovery = prepare_recovery_terminal(
            latest[3], snapshot_id, intent_digest, paths,
        )
        if previous_terminal_recovery is None:
            return latest
        generation = latest[2]["generation"] + 1
    else:
        generation = 1
    receipt_path = reservation_receipt_path(paths, snapshot_id, intent_digest, generation)
    resumed_publication = resume_target_reservation_publication(
        receipt_path,
        snapshot_id,
        generation,
        intent,
        intent_raw,
        source_identity,
        candidate,
        bundle,
        runtime,
        paths,
        mountinfo,
    )
    if resumed_publication is not None:
        return resumed_publication
    if not allow_create:
        reject("SNAPSHOT_RESERVATION_RECEIPT_MISSING")
    if generation > 999999:
        reject("SNAPSHOT_RESERVATION_GENERATION_EXHAUSTED")
    if path_exists(paths.worktrees / snapshot_id):
        reject("SNAPSHOT_RESERVATION_TARGET_OCCUPIED")
    staging_parent = reservation_parent_identity(paths.staging, paths.uid, mountinfo)
    snapshot_parent = reservation_parent_identity(paths.worktrees, paths.uid, mountinfo)
    staging_path_chain = trusted_directory_chain(
        paths.staging, paths.trust_root, "SNAPSHOT_RESERVATION_PATH_UNTRUSTED", paths.uid,
    )
    snapshot_path_chain = trusted_directory_chain(
        paths.worktrees, paths.trust_root, "SNAPSHOT_RESERVATION_PATH_UNTRUSTED", paths.uid,
    )
    if staging_parent["device"] != snapshot_parent["device"]:
        reject("SNAPSHOT_RESERVATION_CROSS_DEVICE")
    staging_root = reservation_staging_path(paths, snapshot_id, intent_digest, generation)
    if path_exists(staging_root):
        reject("SNAPSHOT_RESERVATION_PROVENANCE_UNPROVEN")
    try:
        staging_root.mkdir(mode=0o700)
        os.chown(staging_root, paths.uid, 0)
        os.chmod(staging_root, 0o700)
        fsync_directory(paths.staging)
    except OSError:
        reject("SNAPSHOT_RESERVATION_CREATE_FAILED")
    reserved_root = reservation_root_identity(staging_root, paths.uid, require_empty=True, mountinfo=mountinfo)
    if failpoint:
        failpoint("RESERVATION_ROOT_CREATED")
    source = Path(source_identity["root"])
    target = paths.worktrees / snapshot_id
    expected_admin = Path(intent["expected_admin_dir"])
    registrations = [entry for entry in parse_worktrees(source) if entry.get("worktree") == str(target)]
    if path_exists(target) or path_exists(expected_admin) or registrations:
        reject("SNAPSHOT_RESERVATION_TARGET_OCCUPIED")
    git_worktrees_parent = current_git_worktrees_parent_identity(source_identity, paths.uid, mountinfo)
    reservation = {
        "schema_version": 1,
        "contract": RESERVATION_CONTRACT,
        "state": "RESERVED",
        "reservation_id": "",
        "generation": generation,
        "snapshot_id": snapshot_id,
        "request_id": f"{snapshot_id}:g{generation:06d}",
        "reserved_at": now_iso(clock),
        "confirmation": RESERVATION_CONFIRMATION,
        "prepare_intent": str(paths.state / f"{snapshot_id}.prepare-intent.json"),
        "prepare_intent_sha256": intent_digest,
        "source_repository": source_identity,
        "candidate": candidate,
        "supervisor_bundle": bundle,
        "test_runtime": runtime,
        "source_state_before": intent["source_state_before"],
        "lock_reason": intent["lock_reason"],
        "expected_admin_dir": intent["expected_admin_dir"],
        "previous_terminal_recovery": previous_terminal_recovery,
        "git_worktrees_parent_before_dispatch": git_worktrees_parent,
        "staging_root": str(staging_root),
        "snapshot_root": str(paths.worktrees / snapshot_id),
        "staging_parent": staging_parent,
        "snapshot_parent": snapshot_parent,
        "staging_path_chain": staging_path_chain,
        "snapshot_path_chain": snapshot_path_chain,
        "reserved_root": reserved_root,
        "target_absent_at_publication": True,
        "promotion": "ATOMIC_RENAME_NOREPLACE_SAME_INODE",
        "retention": "BOUND_UNTIL_PREPARED_OR_RECOVERED",
    }
    reservation["reservation_id"] = reservation_identifier(reservation)
    raw = canonical_json(reservation)
    write_no_clobber(receipt_path, raw, uid=paths.uid)
    if failpoint:
        failpoint("RESERVATION_RECEIPT_WRITTEN")
    loaded, loaded_raw = load_target_reservation(receipt_path, paths)
    reference = target_reservation_reference(receipt_path, loaded_raw, loaded)
    return receipt_path, loaded_raw, loaded, reference


def promote_target_reservation(
    reservation: dict[str, Any],
    paths: SnapshotPaths,
    failpoint: Callable[[str], None] | None,
    mountinfo: str | None = None,
) -> None:
    staging_root = Path(reservation["staging_root"])
    target = Path(reservation["snapshot_root"])
    staging_exists = path_exists(staging_root)
    target_exists = path_exists(target)
    if staging_exists and target_exists:
        reject("SNAPSHOT_RESERVATION_TARGET_OCCUPIED")
    if staging_exists:
        assert_reserved_root(staging_root, reservation, paths.uid, require_empty=True, mountinfo=mountinfo)
        if reservation_parent_identity(paths.staging, paths.uid, mountinfo) != reservation["staging_parent"]:
            reject("SNAPSHOT_RESERVATION_PARENT_CHANGED")
        if reservation_parent_identity(paths.worktrees, paths.uid, mountinfo) != reservation["snapshot_parent"]:
            reject("SNAPSHOT_RESERVATION_PARENT_CHANGED")
        promote_reservation_no_replace(staging_root, target, paths.uid)
        if failpoint:
            failpoint("RESERVATION_PROMOTED")
        target_exists = True
    if not target_exists:
        reject("SNAPSHOT_RESERVATION_OBJECT_MISSING")
    if path_exists(staging_root):
        reject("SNAPSHOT_RESERVATION_PROMOTION_FAILED")
    assert_reserved_root(target, reservation, paths.uid, require_empty=True, mountinfo=mountinfo)


def prepare_snapshot(
    source: Path,
    candidate_commit: str,
    candidate_tree: str,
    runtime_root: Path,
    bundle_root: Path,
    snapshot_id: str,
    paths: SnapshotPaths = SnapshotPaths(),
    clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    failpoint: Callable[[str], None] | None = None,
    mountinfo: str | None = None,
) -> tuple[Path, str, dict[str, Any]]:
    validate_identifier(snapshot_id)
    canonical_path(source, "SNAPSHOT_SOURCE_REPOSITORY_INVALID")
    canonical_path(runtime_root, "SNAPSHOT_TEST_RUNTIME_ROOT_INVALID")
    canonical_path(bundle_root, "SNAPSHOT_BUNDLE_ROOT_INVALID")
    target = paths.worktrees / snapshot_id
    receipt_path = paths.receipts / f"{snapshot_id}.prepared.json"
    intent_path = paths.state / f"{snapshot_id}.prepare-intent.json"
    lock_reason = f"{LOCK_REASON_PREFIX}{snapshot_id}"
    with lifecycle_locks(paths, True):
        if path_exists(receipt_path):
            finish_state_publication(receipt_path, uid=paths.uid)
            existing_raw, _ = trusted_regular_file(receipt_path, 0o400, "SNAPSHOT_RECEIPT_INVALID", paths.uid)
            existing_digest = sha256(existing_raw)
            existing_receipt, _ = load_prepared_receipt(receipt_path, existing_digest, paths)
            if (
                existing_receipt["source_repository"].get("root") != str(source)
                or existing_receipt["candidate"].get("commit") != candidate_commit
                or existing_receipt["candidate"].get("tree") != candidate_tree
                or existing_receipt["test_runtime"].get("root") != str(runtime_root)
                or existing_receipt["supervisor_bundle"].get("root") != str(bundle_root)
            ):
                reject("SNAPSHOT_PREPARE_INTENT_CONFLICT")
            verify_snapshot(
                receipt_path,
                existing_digest,
                target,
                candidate_commit,
                candidate_tree,
                runtime_root,
                bundle_root,
                paths,
            )
            return receipt_path, existing_digest, existing_receipt
        source_identity = source_repository_identity(source)
        if contains(source, target) or contains(target, source) or contains(target, runtime_root) or contains(runtime_root, target):
            reject("SNAPSHOT_PATH_BOUNDARY_INVALID")
        candidate, bundle = bundle_candidate_identity(source, candidate_commit, candidate_tree, bundle_root)
        runtime = test_runtime_identity(source, candidate_commit, runtime_root, bundle_root, paths.uid, paths.trust_root)
        invocation_before = source_worktree_state(source)
        initial_before = invocation_before
        resumed = False
        requested_at = now_iso(clock)
        common = Path(source_identity["common_git_dir"])
        worktrees_parent = common / "worktrees"
        expected_admin = worktrees_parent / snapshot_id
        intent_base = {
            "schema_version": 1, "contract": PREPARE_INTENT_CONTRACT, "snapshot_id": snapshot_id,
            "request_id": snapshot_id, "confirmation": PREPARE_CONFIRMATION,
            "source_repository": source_identity, "candidate": candidate, "supervisor_bundle": bundle,
            "test_runtime": runtime, "snapshot_root": str(target), "expected_admin_dir": str(expected_admin),
            "target_absent_before": True, "lock_reason": lock_reason,
        }
        if path_exists(intent_path):
            existing, intent_raw, _ = load_prepare_intent(snapshot_id, paths)
            for field, expected in intent_base.items():
                if existing.get(field) != expected:
                    reject("SNAPSHOT_PREPARE_INTENT_CONFLICT")
            initial_before = existing.get("source_state_before")
            if not isinstance(initial_before, dict):
                reject("SNAPSHOT_PREPARE_INTENT_INVALID")
            requested_at = existing.get("requested_at")
            intent = existing
            resumed = True
        else:
            registrations_before = [entry for entry in parse_worktrees(source) if entry.get("worktree") == str(target)]
            if path_exists(target) or path_exists(expected_admin) or registrations_before:
                reject("SNAPSHOT_PREPARE_PRECONDITION_INVALID")
            common_stat = trusted_directory(common, "SNAPSHOT_SOURCE_COMMON_GIT_INVALID")
            if path_exists(worktrees_parent):
                parent_stat = trusted_directory(worktrees_parent, "SNAPSHOT_WORKTREE_ADMIN_INVALID", uid=paths.uid)
                worktrees_parent_before = {
                    "path": str(worktrees_parent), "exists": True,
                    "device": parent_stat.st_dev, "inode": parent_stat.st_ino,
                    "mode": f"{stat.S_IMODE(parent_stat.st_mode):04o}",
                }
            else:
                worktrees_parent_before = {
                    "path": str(worktrees_parent), "exists": False,
                    "parent_device": common_stat.st_dev, "parent_inode": common_stat.st_ino,
                }
            intent = {
                **intent_base,
                "requested_at": requested_at,
                "source_state_before": initial_before,
                "worktrees_parent_before": worktrees_parent_before,
            }
            intent_raw = canonical_json(intent)
            write_no_clobber(intent_path, intent_raw, uid=paths.uid)
        registrations_before_reservation = [
            entry for entry in parse_worktrees(source) if entry.get("worktree") == str(target)
        ]
        existing_reservations = validated_target_reservation_catalog(
            snapshot_id, intent_raw, source_identity, candidate, bundle, runtime, paths,
        )
        prior_generation_terminal = bool(
            existing_reservations
            and reservation_closed_by_prepare_recovery(
                existing_reservations[-1][3], snapshot_id, sha256(intent_raw), paths,
            )
        )
        assert_prepare_worktrees_parent(
            intent,
            source,
            paths.uid,
            path_exists(target)
            or path_exists(expected_admin)
            or bool(registrations_before_reservation)
            or prior_generation_terminal,
        )
        if failpoint:
            failpoint("INTENT_WRITTEN")
        allow_reservation_create = not (
            path_exists(target) or path_exists(expected_admin) or registrations_before_reservation
        )
        _, _, reservation, reservation_reference = build_or_load_target_reservation(
            snapshot_id,
            intent,
            intent_raw,
            source_identity,
            candidate,
            bundle,
            runtime,
            paths,
            clock,
            failpoint,
            allow_reservation_create,
            mountinfo,
        )
        registrations = [entry for entry in parse_worktrees(source) if entry.get("worktree") == str(target)]
        target_exists = path_exists(target)
        admin_exists = path_exists(expected_admin)
        staging_exists = path_exists(Path(reservation["staging_root"]))
        if target_exists:
            assert_reserved_root(target, reservation, paths.uid, require_empty=False, mountinfo=mountinfo)
        if (
            (not target_exists and (registrations or admin_exists))
            or (target_exists and ((len(registrations) == 1) != admin_exists))
            or len(registrations) > 1
            or (target_exists and staging_exists)
        ):
            reject("SNAPSHOT_PREPARE_RECOVERY_REQUIRED")
        add_worktree = False
        if not target_exists:
            if not staging_exists:
                reject("SNAPSHOT_RESERVATION_OBJECT_MISSING")
            promote_target_reservation(reservation, paths, failpoint, mountinfo)
            add_worktree = True
        elif not registrations and not admin_exists:
            try:
                with os.scandir(target) as entries:
                    target_empty = next(entries, None) is None
            except OSError:
                reject("SNAPSHOT_RESERVATION_ROOT_INVALID")
            if not target_empty:
                reject("SNAPSHOT_PREPARE_RECOVERY_REQUIRED")
            add_worktree = True
        elif len(registrations) != 1 or not admin_exists:
            reject("SNAPSHOT_PREPARE_RECOVERY_REQUIRED")
        if add_worktree:
            if current_git_worktrees_parent_identity(source_identity, paths.uid, mountinfo) != reservation[
                "git_worktrees_parent_before_dispatch"
            ]:
                reject("SNAPSHOT_WORKTREE_PARENT_CHANGED")
            with held_reserved_root(target, reservation, paths.uid, mountinfo):
                previous_umask = os.umask(0o022)
                try:
                    result = git_result(source, "worktree", "add", "--detach", "--lock", "--reason", lock_reason, "--", str(target), candidate_commit, timeout=300)
                finally:
                    os.umask(previous_umask)
            if result.returncode != 0:
                reject("SNAPSHOT_WORKTREE_ADD_FAILED")
        assert_reserved_root(target, reservation, paths.uid, require_empty=False, mountinfo=mountinfo)
        if failpoint:
            failpoint("WORKTREE_ADDED")
        snapshot = snapshot_identity(source, target, candidate, lock_reason, True, paths.uid, mountinfo)
        if snapshot.get("admin_dir") != str(expected_admin):
            reject("SNAPSHOT_WORKTREE_ADMIN_INVALID")
        invocation_after = source_worktree_state(source)
        if invocation_after != invocation_before:
            reject("SNAPSHOT_SOURCE_WORKTREE_CHANGED")
        receipt = {
            "schema_version": 1, "contract": CONTRACT, "state": "PREPARED", "snapshot_id": snapshot_id,
            "prepared_at": now_iso(clock), "confirmation": PREPARE_CONFIRMATION,
            "prepare_intent": str(intent_path), "prepare_intent_sha256": sha256(intent_raw),
            "source_repository": {
                **source_identity,
                "initial_state_before": initial_before,
                "invocation_state_before": invocation_before,
                "invocation_state_after": invocation_after,
                "resumed": resumed,
            },
            "candidate": candidate, "snapshot": snapshot, "target_reservation": reservation_reference,
            "supervisor_bundle": bundle, "test_runtime": runtime,
        }
        raw = canonical_json(receipt)
        if failpoint:
            failpoint("BEFORE_RECEIPT")
        write_no_clobber(receipt_path, raw, uid=paths.uid)
        return receipt_path, sha256(raw), receipt


def load_prepared_receipt(receipt_path: Path, expected_sha256: str, paths: SnapshotPaths) -> tuple[dict[str, Any], bytes]:
    if not SHA256.fullmatch(expected_sha256) or receipt_path.parent != paths.receipts or receipt_path.name != Path(receipt_path.name).name or not receipt_path.name.endswith(".prepared.json"):
        reject("SNAPSHOT_RECEIPT_PATH_INVALID")
    finish_state_publication(receipt_path, uid=paths.uid)
    raw, _ = trusted_regular_file(receipt_path, 0o400, "SNAPSHOT_RECEIPT_INVALID", paths.uid)
    if sha256(raw) != expected_sha256:
        reject("SNAPSHOT_RECEIPT_DIGEST_MISMATCH")
    value = exact_fields(
        strict_json(raw, "SNAPSHOT_RECEIPT_INVALID"),
        {
            "schema_version", "contract", "state", "snapshot_id", "prepared_at", "confirmation",
            "prepare_intent", "prepare_intent_sha256", "source_repository", "candidate", "snapshot",
            "target_reservation", "supervisor_bundle", "test_runtime",
        },
        "SNAPSHOT_RECEIPT_INVALID",
    )
    if raw != canonical_json(value) or value["schema_version"] != 1 or value["contract"] != CONTRACT or value["state"] != "PREPARED" or value["confirmation"] != PREPARE_CONFIRMATION:
        reject("SNAPSHOT_RECEIPT_INVALID")
    snapshot_id = validate_identifier(value["snapshot_id"])
    if (
        receipt_path != paths.receipts / f"{snapshot_id}.prepared.json"
        or value.get("prepare_intent") != str(paths.state / f"{snapshot_id}.prepare-intent.json")
        or not isinstance(value.get("prepare_intent_sha256"), str)
        or not SHA256.fullmatch(value["prepare_intent_sha256"])
        or not isinstance(value.get("target_reservation"), dict)
    ):
        reject("SNAPSHOT_RECEIPT_PATH_INVALID")
    return value, raw


def load_canonical_record(
    path: Path,
    fields: set[str],
    contract: str,
    code: str,
    paths: SnapshotPaths,
) -> tuple[dict[str, Any], bytes]:
    finish_state_publication(path, uid=paths.uid)
    raw, _ = trusted_regular_file(path, 0o400, code, paths.uid)
    value = exact_fields(strict_json(raw, code), fields, code)
    if raw != canonical_json(value) or value.get("schema_version") != 1 or value.get("contract") != contract:
        reject(code)
    return value, raw


def load_prepare_intent(snapshot_id: str, paths: SnapshotPaths) -> tuple[dict[str, Any], bytes, Path]:
    validate_identifier(snapshot_id)
    path = paths.state / f"{snapshot_id}.prepare-intent.json"
    value, raw = load_canonical_record(
        path,
        {
            "schema_version", "contract", "snapshot_id", "request_id", "requested_at", "confirmation",
            "source_repository", "candidate", "supervisor_bundle", "test_runtime",
            "snapshot_root", "expected_admin_dir", "target_absent_before", "lock_reason",
            "source_state_before", "worktrees_parent_before",
        },
        PREPARE_INTENT_CONTRACT,
        "SNAPSHOT_PREPARE_INTENT_INVALID",
        paths,
    )
    if (
        value.get("snapshot_id") != snapshot_id
        or value.get("request_id") != snapshot_id
        or value.get("confirmation") != PREPARE_CONFIRMATION
        or value.get("snapshot_root") != str(paths.worktrees / snapshot_id)
        or value.get("target_absent_before") is not True
        or value.get("lock_reason") != f"{LOCK_REASON_PREFIX}{snapshot_id}"
    ):
        reject("SNAPSHOT_PREPARE_INTENT_INVALID")
    source = value.get("source_repository")
    parent_before = value.get("worktrees_parent_before")
    if (
        not isinstance(source, dict)
        or not isinstance(source.get("common_git_dir"), str)
        or value.get("expected_admin_dir") != str(Path(source["common_git_dir"]) / "worktrees" / snapshot_id)
        or not isinstance(parent_before, dict)
        or parent_before.get("path") != str(Path(source["common_git_dir"]) / "worktrees")
        or not isinstance(parent_before.get("exists"), bool)
    ):
        reject("SNAPSHOT_PREPARE_INTENT_INVALID")
    expected_parent_fields = {"path", "exists", "device", "inode", "mode"} if parent_before["exists"] else {"path", "exists", "parent_device", "parent_inode"}
    if set(parent_before) != expected_parent_fields:
        reject("SNAPSHOT_PREPARE_INTENT_INVALID")
    return value, raw, path


def assert_prepare_worktrees_parent(
    intent: dict[str, Any],
    source: Path,
    uid: int,
    allow_created: bool = False,
) -> None:
    common = common_git_directory(source)
    parent = common / "worktrees"
    before = intent["worktrees_parent_before"]
    if not path_exists(parent):
        if before["exists"]:
            reject("SNAPSHOT_WORKTREE_PARENT_CHANGED")
        return
    current = trusted_directory(parent, "SNAPSHOT_WORKTREE_PARENT_CHANGED", uid=uid)
    if not before["exists"] and not allow_created:
        reject("SNAPSHOT_WORKTREE_PARENT_CHANGED")
    if before["exists"] and before != {
        "path": str(parent), "exists": True,
        "device": current.st_dev, "inode": current.st_ino,
        "mode": f"{stat.S_IMODE(current.st_mode):04o}",
    }:
        reject("SNAPSHOT_WORKTREE_PARENT_CHANGED")


def load_remove_intent(snapshot_id: str, receipt_path: Path, receipt_sha256: str, paths: SnapshotPaths) -> tuple[dict[str, Any], bytes, Path]:
    path = paths.state / f"{snapshot_id}.{receipt_sha256}.remove-intent.json"
    value, raw = load_canonical_record(
        path,
        {
            "schema_version", "contract", "snapshot_id", "request_id", "requested_at", "confirmation",
            "prepared_receipt", "prepared_receipt_sha256", "snapshot_root",
            "expected_admin_dir", "candidate_commit", "candidate_tree", "target_reservation",
            "source_state_before",
        },
        REMOVE_INTENT_CONTRACT,
        "SNAPSHOT_REMOVE_INTENT_INVALID",
        paths,
    )
    if (
        value.get("snapshot_id") != snapshot_id
        or value.get("request_id") != snapshot_id
        or value.get("confirmation") != REMOVE_CONFIRMATION
        or value.get("prepared_receipt") != str(receipt_path)
        or value.get("prepared_receipt_sha256") != receipt_sha256
        or not isinstance(value.get("target_reservation"), dict)
    ):
        reject("SNAPSHOT_REMOVE_INTENT_INVALID")
    load_target_reservation_reference(value["target_reservation"], paths)
    return value, raw, path


def assert_mapping_equal(actual: dict[str, Any], expected: dict[str, Any], code: str) -> None:
    if actual != expected:
        reject(code)


def persistent_receipt_identities(
    receipt: dict[str, Any],
    paths: SnapshotPaths,
    mountinfo: str | None = None,
) -> tuple[Path, dict[str, Any], dict[str, Any], dict[str, Any]]:
    source_value = receipt.get("source_repository")
    candidate_value = receipt.get("candidate")
    bundle_value = receipt.get("supervisor_bundle")
    runtime_value = receipt.get("test_runtime")
    if (
        not isinstance(source_value, dict)
        or not isinstance(source_value.get("root"), str)
        or not isinstance(candidate_value, dict)
        or not isinstance(candidate_value.get("commit"), str)
        or not isinstance(candidate_value.get("tree"), str)
        or not isinstance(bundle_value, dict)
        or not isinstance(bundle_value.get("root"), str)
        or not isinstance(runtime_value, dict)
        or not isinstance(runtime_value.get("root"), str)
    ):
        reject("SNAPSHOT_RECEIPT_INVALID")
    source = Path(source_value["root"])
    current_source = source_repository_identity(source)
    expected_source = {key: source_value.get(key) for key in current_source}
    assert_mapping_equal(current_source, expected_source, "SNAPSHOT_SOURCE_IDENTITY_CHANGED")
    candidate, bundle = bundle_candidate_identity(
        source,
        candidate_value["commit"],
        candidate_value["tree"],
        Path(bundle_value["root"]),
    )
    assert_mapping_equal(candidate, candidate_value, "SNAPSHOT_CANDIDATE_IDENTITY_CHANGED")
    assert_mapping_equal(bundle, bundle_value, "SNAPSHOT_BUNDLE_IDENTITY_CHANGED")
    runtime = test_runtime_identity(
        source,
        candidate_value["commit"],
        Path(runtime_value["root"]),
        Path(bundle_value["root"]),
        paths.uid,
        paths.trust_root,
        mountinfo,
    )
    assert_mapping_equal(runtime, runtime_value, "SNAPSHOT_TEST_RUNTIME_CHANGED")
    prepare_intent, prepare_intent_raw, prepare_intent_path = load_prepare_intent(receipt["snapshot_id"], paths)
    _, reservation, _ = load_target_reservation_reference(receipt.get("target_reservation"), paths)
    snapshot_value = receipt.get("snapshot")
    if (
        receipt.get("prepare_intent") != str(prepare_intent_path)
        or receipt.get("prepare_intent_sha256") != sha256(prepare_intent_raw)
        or prepare_intent.get("source_repository") != current_source
        or prepare_intent.get("candidate") != candidate
        or prepare_intent.get("supervisor_bundle") != bundle
        or prepare_intent.get("test_runtime") != runtime
        or prepare_intent.get("snapshot_root") != receipt.get("snapshot", {}).get("root")
        or prepare_intent.get("expected_admin_dir") != receipt.get("snapshot", {}).get("admin_dir")
        or reservation.get("prepare_intent") != str(prepare_intent_path)
        or reservation.get("prepare_intent_sha256") != sha256(prepare_intent_raw)
        or reservation.get("source_repository") != current_source
        or reservation.get("candidate") != candidate
        or reservation.get("supervisor_bundle") != bundle
        or reservation.get("test_runtime") != runtime
        or reservation.get("source_state_before") != prepare_intent.get("source_state_before")
        or reservation.get("lock_reason") != prepare_intent.get("lock_reason")
        or reservation.get("expected_admin_dir") != prepare_intent.get("expected_admin_dir")
        or not isinstance(snapshot_value, dict)
        or reservation.get("snapshot_root") != snapshot_value.get("root")
        or reservation.get("reserved_root", {}).get("device") != snapshot_value.get("root_device")
        or reservation.get("reserved_root", {}).get("inode") != snapshot_value.get("root_inode")
        or reservation.get("reserved_root", {}).get("mode") != snapshot_value.get("root_mode")
    ):
        reject("SNAPSHOT_PREPARE_INTENT_CHANGED")
    return source, candidate, bundle, runtime


def assert_removed_tombstone(source: Path, receipt: dict[str, Any]) -> None:
    target = Path(receipt["snapshot"]["root"])
    admin = Path(receipt["snapshot"]["admin_dir"])
    if (
        path_exists(target)
        or path_exists(admin)
        or any(entry.get("worktree") == str(target) for entry in parse_worktrees(source))
    ):
        reject("SNAPSHOT_REMOVAL_STATE_CHANGED")


def ensure_removal_receipt(
    receipt_path: Path,
    receipt_sha256: str,
    receipt: dict[str, Any],
    source: Path,
    candidate: dict[str, Any],
    paths: SnapshotPaths,
    clock: Callable[[], datetime],
) -> tuple[Path, str, dict[str, Any]]:
    snapshot_id = receipt["snapshot_id"]
    removal_path = paths.audit / f"{snapshot_id}.{receipt_sha256}.removed.json"
    if path_exists(removal_path):
        value, raw = load_canonical_record(
            removal_path,
            {
                "schema_version", "contract", "state", "snapshot_id", "removed_at", "confirmation",
                "prepared_receipt", "prepared_receipt_sha256", "source_repository", "candidate",
                "removed_snapshot_root", "target_reservation", "test_runtime_mode",
            },
            REMOVAL_CONTRACT,
            "SNAPSHOT_REMOVAL_RECEIPT_INVALID",
            paths,
        )
        if (
            value.get("state") != "REMOVED"
            or value.get("snapshot_id") != snapshot_id
            or value.get("confirmation") != REMOVE_CONFIRMATION
            or value.get("prepared_receipt") != str(receipt_path)
            or value.get("prepared_receipt_sha256") != receipt_sha256
            or value.get("source_repository") != source_repository_identity(source)
            or value.get("candidate") != candidate
            or value.get("removed_snapshot_root") != receipt["snapshot"]["root"]
            or value.get("target_reservation") != receipt["target_reservation"]
            or value.get("test_runtime_mode") != "BORROWED_NEVER_REMOVE"
        ):
            reject("SNAPSHOT_REMOVAL_RECEIPT_INVALID")
        assert_removed_tombstone(source, receipt)
        return removal_path, sha256(raw), value
    assert_removed_tombstone(source, receipt)
    removal = {
        "schema_version": 1, "contract": REMOVAL_CONTRACT, "state": "REMOVED", "snapshot_id": snapshot_id,
        "removed_at": now_iso(clock), "confirmation": REMOVE_CONFIRMATION,
        "prepared_receipt": str(receipt_path), "prepared_receipt_sha256": receipt_sha256,
        "source_repository": source_repository_identity(source), "candidate": candidate,
        "removed_snapshot_root": receipt["snapshot"]["root"],
        "target_reservation": receipt["target_reservation"],
        "test_runtime_mode": "BORROWED_NEVER_REMOVE",
    }
    raw = canonical_json(removal)
    write_no_clobber(removal_path, raw, uid=paths.uid)
    return removal_path, sha256(raw), removal


def verify_snapshot(receipt_path: Path, receipt_sha256: str, repository_root: Path, git_commit: str, git_tree: str, runtime_root: Path, bundle_root: Path, paths: SnapshotPaths = SnapshotPaths(), require_locked: bool = True, mountinfo: str | None = None) -> dict[str, Any]:
    receipt, _ = load_prepared_receipt(receipt_path, receipt_sha256, paths)
    snapshot_id = receipt["snapshot_id"]
    if repository_root != paths.worktrees / snapshot_id or receipt["snapshot"].get("root") != str(repository_root) or receipt["candidate"].get("commit") != git_commit or receipt["candidate"].get("tree") != git_tree or receipt["test_runtime"].get("root") != str(runtime_root) or receipt["supervisor_bundle"].get("root") != str(bundle_root):
        reject("SNAPSHOT_RECEIPT_BINDING_MISMATCH")
    source, candidate, _, _ = persistent_receipt_identities(receipt, paths, mountinfo)
    snapshot = snapshot_identity(source, repository_root, candidate, f"{LOCK_REASON_PREFIX}{snapshot_id}", require_locked, paths.uid, mountinfo)
    if require_locked:
        assert_mapping_equal(snapshot, receipt["snapshot"], "SNAPSHOT_WORKTREE_IDENTITY_CHANGED")
    else:
        comparable = dict(snapshot)
        comparable["locked"] = receipt["snapshot"].get("locked")
        if comparable["admin_tree"].get("lock_file") is None:
            comparable_admin = dict(comparable["admin_tree"])
            comparable_admin["lock_file"] = receipt["snapshot"].get("admin_tree", {}).get("lock_file")
            comparable["admin_tree"] = comparable_admin
        assert_mapping_equal(comparable, receipt["snapshot"], "SNAPSHOT_WORKTREE_IDENTITY_CHANGED")
    removal = paths.audit / f"{snapshot_id}.{receipt_sha256}.removed.json"
    if path_exists(removal):
        reject("SNAPSHOT_ALREADY_REMOVED")
    return receipt


def remove_snapshot(
    receipt_path: Path,
    receipt_sha256: str,
    snapshot_id: str,
    paths: SnapshotPaths = SnapshotPaths(),
    clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    failpoint: Callable[[str], None] | None = None,
    expected_bundle_root: Path | None = None,
) -> tuple[Path, str, dict[str, Any]]:
    validate_identifier(snapshot_id)
    removal_path = paths.audit / f"{snapshot_id}.{receipt_sha256}.removed.json"
    intent_path = paths.state / f"{snapshot_id}.{receipt_sha256}.remove-intent.json"
    with lifecycle_locks(paths, False):
        receipt, _ = load_prepared_receipt(receipt_path, receipt_sha256, paths)
        if receipt["snapshot_id"] != snapshot_id:
            reject("SNAPSHOT_RECEIPT_BINDING_MISMATCH")
        bundle = Path(receipt["supervisor_bundle"]["root"])
        if expected_bundle_root is not None and expected_bundle_root != bundle:
            reject("SNAPSHOT_RECEIPT_BINDING_MISMATCH")
        source, candidate, _, _ = persistent_receipt_identities(receipt, paths)
        target = Path(receipt["snapshot"]["root"])
        runtime = Path(receipt["test_runtime"]["root"])
        if path_exists(removal_path):
            return ensure_removal_receipt(receipt_path, receipt_sha256, receipt, source, candidate, paths, clock)
        intent = {
            "schema_version": 1, "contract": REMOVE_INTENT_CONTRACT, "snapshot_id": snapshot_id,
            "request_id": snapshot_id, "requested_at": now_iso(clock), "confirmation": REMOVE_CONFIRMATION,
            "prepared_receipt": str(receipt_path), "prepared_receipt_sha256": receipt_sha256,
            "snapshot_root": str(target), "expected_admin_dir": receipt["snapshot"]["admin_dir"],
            "candidate_commit": candidate["commit"], "candidate_tree": candidate["tree"],
            "target_reservation": receipt["target_reservation"],
            "source_state_before": source_worktree_state(source),
        }
        if path_exists(intent_path):
            finish_state_publication(intent_path, uid=paths.uid)
            existing_raw, _ = trusted_regular_file(intent_path, 0o400, "SNAPSHOT_REMOVE_INTENT_INVALID", paths.uid)
            existing = exact_fields(
                strict_json(existing_raw, "SNAPSHOT_REMOVE_INTENT_INVALID"),
                {
                    "schema_version", "contract", "snapshot_id", "request_id", "requested_at", "confirmation",
                    "prepared_receipt", "prepared_receipt_sha256", "snapshot_root",
                    "expected_admin_dir", "candidate_commit", "candidate_tree", "target_reservation",
                    "source_state_before",
                },
                "SNAPSHOT_REMOVE_INTENT_INVALID",
            )
            if existing_raw != canonical_json(existing) or any(existing.get(key) != intent.get(key) for key in set(intent) - {"requested_at", "source_state_before"}):
                reject("SNAPSHOT_REMOVE_INTENT_INVALID")
        else:
            verify_snapshot(receipt_path, receipt_sha256, target, candidate["commit"], candidate["tree"], runtime, bundle, paths)
            write_no_clobber(intent_path, canonical_json(intent), uid=paths.uid)
        if failpoint:
            failpoint("REMOVE_INTENT_WRITTEN")
        admin_path = Path(receipt["snapshot"]["admin_dir"])
        registrations = [entry for entry in parse_worktrees(source) if entry.get("worktree") == str(target)]
        if (
            (path_exists(target) and (len(registrations) != 1 or not path_exists(admin_path)))
            or (not path_exists(target) and (registrations or path_exists(admin_path)))
        ):
            reject("SNAPSHOT_REMOVE_RECOVERY_REQUIRED")
        if path_exists(target):
            verify_snapshot(receipt_path, receipt_sha256, target, candidate["commit"], candidate["tree"], runtime, bundle, paths, require_locked=False)
            current = snapshot_identity(source, target, candidate, receipt["snapshot"]["lock_reason"], False, paths.uid)
            if current["locked"]:
                result = git_result(source, "worktree", "unlock", "--", str(target))
                if result.returncode != 0:
                    reject("SNAPSHOT_WORKTREE_UNLOCK_FAILED")
            if failpoint:
                failpoint("WORKTREE_UNLOCKED")
            before = source_worktree_state(source)
            result = git_result(source, "worktree", "remove", "--", str(target), timeout=300)
            if result.returncode != 0:
                reject("SNAPSHOT_WORKTREE_REMOVE_FAILED")
            after = source_worktree_state(source)
            if before != after:
                reject("SNAPSHOT_SOURCE_WORKTREE_CHANGED")
        if failpoint:
            failpoint("WORKTREE_REMOVED")
        assert_removed_tombstone(source, receipt)
        source, candidate, _, _ = persistent_receipt_identities(receipt, paths)
        assert_removed_tombstone(source, receipt)
        return ensure_removal_receipt(receipt_path, receipt_sha256, receipt, source, candidate, paths, clock)


RECOVERY_INTENT_FIELDS = {
    "schema_version", "contract", "recovery_id", "generation", "object_identity_sha256", "snapshot_id", "phase", "observed_state",
    "requested_at", "confirmation", "lifecycle_intent", "lifecycle_intent_sha256",
    "prepared_receipt", "prepared_receipt_sha256", "source_repository", "candidate",
    "snapshot_root", "admin_dir", "target_reservation", "action", "source_object_identity", "validated_identity",
    "registration_before", "quarantine_path", "retention",
}
RECOVERY_FIELDS = {
    "schema_version", "contract", "state", "recovery_id", "generation", "object_identity_sha256", "snapshot_id", "phase",
    "observed_state", "recovered_at", "confirmation", "recovery_intent",
    "recovery_intent_sha256", "lifecycle_intent", "lifecycle_intent_sha256",
    "prepared_receipt", "prepared_receipt_sha256", "source_repository", "candidate",
    "snapshot_root", "admin_dir", "target_reservation", "action", "source_state_before", "source_state_after",
    "source_state_unchanged", "registration_before", "registration_after", "quarantine",
    "git_command", "retention", "outcome", "tombstone_verified",
}


def assert_remove_target_recovery_identity(identity: dict[str, Any], receipt: dict[str, Any]) -> None:
    expected = receipt["snapshot"]
    if identity != {
        "root_device": expected.get("root_device"),
        "root_inode": expected.get("root_inode"),
        "root_mode": expected.get("root_mode"),
        "filesystem": expected.get("filesystem"),
    }:
        reject("SNAPSHOT_RECOVERY_TARGET_IDENTITY_CHANGED")


def assert_reservation_target_recovery_identity(identity: dict[str, Any], reservation: dict[str, Any]) -> None:
    expected = reservation["reserved_root"]
    if (
        identity.get("root_device") != expected.get("device")
        or identity.get("root_inode") != expected.get("inode")
        or identity.get("root_mode") != expected.get("mode")
    ):
        reject("SNAPSHOT_PREPARE_TARGET_PROVENANCE_UNPROVEN")


def assert_remove_admin_recovery_identity(identity: dict[str, Any], receipt: dict[str, Any]) -> None:
    expected = receipt["snapshot"]
    admin_tree = identity.get("admin_tree")
    if isinstance(admin_tree, dict) and admin_tree.get("lock_file") is None:
        admin_tree = dict(admin_tree)
        admin_tree["lock_file"] = expected.get("admin_tree", {}).get("lock_file")
    if (
        identity.get("root") != expected.get("admin_dir")
        or identity.get("root_device") != expected.get("admin_device")
        or identity.get("root_inode") != expected.get("admin_inode")
        or identity.get("root_mode") != expected.get("admin_mode")
        or admin_tree != expected.get("admin_tree")
    ):
        reject("SNAPSHOT_RECOVERY_ADMIN_IDENTITY_CHANGED")


def recovery_paths(paths: SnapshotPaths, snapshot_id: str, lifecycle_digest: str, phase: str, generation: int, object_digest: str) -> tuple[Path, Path]:
    stem = f"{snapshot_id}.{lifecycle_digest}.{phase.lower()}.g{generation:06d}.{object_digest}"
    return paths.state / f"{stem}.recovery-intent.json", paths.audit / f"{stem}.recovered.json"


def load_recovery_intent(path: Path, paths: SnapshotPaths) -> tuple[dict[str, Any], bytes]:
    value, raw = load_canonical_record(path, RECOVERY_INTENT_FIELDS, RECOVERY_INTENT_CONTRACT, "SNAPSHOT_RECOVERY_INTENT_INVALID", paths)
    if (
        value.get("phase") not in ("PREPARE", "REMOVE")
        or value.get("observed_state") not in ("ADMIN_ONLY", "TARGET_ONLY")
        or value.get("action") not in ("QUARANTINE_ADMIN", "QUARANTINE_TARGET")
        or value.get("retention") != "RETAINED_REQUIRES_SEPARATE_AUTHORIZATION"
        or not isinstance(value.get("recovery_id"), str)
        or not SHA256.fullmatch(value["recovery_id"])
        or not isinstance(value.get("generation"), int)
        or isinstance(value.get("generation"), bool)
        or not 1 <= value["generation"] <= 999999
        or not isinstance(value.get("object_identity_sha256"), str)
        or not SHA256.fullmatch(value["object_identity_sha256"])
        or value["object_identity_sha256"] != sha256(canonical_json(value.get("source_object_identity")))
        or (value.get("observed_state") == "ADMIN_ONLY") != (value.get("action") == "QUARANTINE_ADMIN")
        or not isinstance(value.get("source_object_identity"), dict)
        or not isinstance(value.get("validated_identity"), dict)
        or not isinstance(value.get("target_reservation"), dict)
        or not isinstance(value.get("quarantine_path"), str)
    ):
        reject("SNAPSHOT_RECOVERY_INTENT_INVALID")
    load_target_reservation_reference(value["target_reservation"], paths)
    canonical_path(Path(value["quarantine_path"]), "SNAPSHOT_RECOVERY_INTENT_INVALID")
    if value["phase"] == "PREPARE":
        if value.get("prepared_receipt") is not None or value.get("prepared_receipt_sha256") is not None or value.get("confirmation") != RECOVER_PREPARE_CONFIRMATION:
            reject("SNAPSHOT_RECOVERY_INTENT_INVALID")
    elif (
        not isinstance(value.get("prepared_receipt"), str)
        or not isinstance(value.get("prepared_receipt_sha256"), str)
        or not SHA256.fullmatch(value["prepared_receipt_sha256"])
        or value.get("confirmation") != RECOVER_REMOVE_CONFIRMATION
    ):
        reject("SNAPSHOT_RECOVERY_INTENT_INVALID")
    return value, raw


def load_recovery_receipt(path: Path, paths: SnapshotPaths) -> tuple[dict[str, Any], bytes]:
    value, raw = load_canonical_record(path, RECOVERY_FIELDS, RECOVERY_CONTRACT, "SNAPSHOT_RECOVERY_RECEIPT_INVALID", paths)
    if (
        value.get("state") != "RECOVERED"
        or value.get("phase") not in ("PREPARE", "REMOVE")
        or value.get("observed_state") not in ("ADMIN_ONLY", "TARGET_ONLY")
        or value.get("action") not in ("QUARANTINE_ADMIN", "QUARANTINE_TARGET")
        or value.get("source_state_unchanged") is not True
        or value.get("tombstone_verified") is not True
        or value.get("retention") != "RETAINED_REQUIRES_SEPARATE_AUTHORIZATION"
        or not isinstance(value.get("generation"), int)
        or isinstance(value.get("generation"), bool)
        or not 1 <= value["generation"] <= 999999
        or not isinstance(value.get("object_identity_sha256"), str)
        or not SHA256.fullmatch(value["object_identity_sha256"])
        or not isinstance(value.get("source_state_before"), dict)
        or not isinstance(value.get("source_state_after"), dict)
        or not isinstance(value.get("registration_after"), list)
        or not isinstance(value.get("quarantine"), dict)
        or not isinstance(value["quarantine"].get("identity"), dict)
        or not isinstance(value.get("git_command"), dict)
        or not isinstance(value.get("target_reservation"), dict)
    ):
        reject("SNAPSHOT_RECOVERY_RECEIPT_INVALID")
    load_target_reservation_reference(value["target_reservation"], paths)
    if value["object_identity_sha256"] != sha256(canonical_json(value["quarantine"]["identity"])):
        reject("SNAPSHOT_RECOVERY_RECEIPT_INVALID")
    return value, raw


def validate_completed_recovery(
    plan: dict[str, Any],
    plan_raw: bytes,
    plan_path: Path,
    audit_path: Path,
    paths: SnapshotPaths,
) -> tuple[dict[str, Any], bytes]:
    value, raw = load_recovery_receipt(audit_path, paths)
    destination = Path(plan["quarantine_path"])
    expected_git_command = {
        "executed": False,
        "reason": "ATOMIC_NOREPLACE_QUARANTINE",
        "stdout_sha256": sha256(b""),
        "stderr_sha256": sha256(b""),
    }
    expected_outcome = "PREPARE_ROLLED_BACK_TO_ABSENT" if plan["phase"] == "PREPARE" else "REMOVE_COMPLETED"
    if (
        value.get("recovery_intent") != str(plan_path)
        or value.get("recovery_intent_sha256") != sha256(plan_raw)
        or value.get("recovery_id") != plan["recovery_id"]
        or value.get("generation") != plan["generation"]
        or value.get("object_identity_sha256") != plan["object_identity_sha256"]
        or value.get("snapshot_id") != plan["snapshot_id"]
        or value.get("phase") != plan["phase"]
        or value.get("observed_state") != plan["observed_state"]
        or value.get("confirmation") != plan["confirmation"]
        or value.get("lifecycle_intent") != plan["lifecycle_intent"]
        or value.get("lifecycle_intent_sha256") != plan["lifecycle_intent_sha256"]
        or value.get("prepared_receipt") != plan["prepared_receipt"]
        or value.get("prepared_receipt_sha256") != plan["prepared_receipt_sha256"]
        or value.get("source_repository") != plan["source_repository"]
        or value.get("candidate") != plan["candidate"]
        or value.get("snapshot_root") != plan["snapshot_root"]
        or value.get("admin_dir") != plan["admin_dir"]
        or value.get("target_reservation") != plan["target_reservation"]
        or value.get("action") != plan["action"]
        or value.get("registration_before") != plan["registration_before"]
        or value.get("registration_after") != []
        or value.get("source_state_before") != value.get("source_state_after")
        or value.get("git_command") != expected_git_command
        or value.get("retention") != plan["retention"]
        or value.get("outcome") != expected_outcome
        or value.get("quarantine", {}).get("path") != str(destination)
        or value.get("quarantine", {}).get("identity") != plan["source_object_identity"]
        or recovery_tree_identity(destination, paths.uid, "SNAPSHOT_RECOVERY_QUARANTINE_CHANGED") != value.get("quarantine", {}).get("identity")
    ):
        reject("SNAPSHOT_RECOVERY_RECEIPT_INVALID")
    return value, raw


def build_or_load_recovery_intent(
    source: Path,
    candidate: dict[str, Any],
    snapshot_id: str,
    phase: str,
    confirmation: str,
    lifecycle_intent_path: Path,
    lifecycle_intent_raw: bytes,
    expected_admin: Path,
    paths: SnapshotPaths,
    clock: Callable[[], datetime],
    target_reservation: dict[str, Any],
    prepared_receipt: Path | None = None,
    prepared_receipt_sha256: str | None = None,
    receipt: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], bytes, Path, Path]:
    lifecycle_digest = sha256(lifecycle_intent_raw)
    target = paths.worktrees / snapshot_id
    source_identity = source_repository_identity(source)
    _, current_reservation, _ = load_target_reservation_reference(target_reservation, paths)
    if (
        current_reservation.get("snapshot_id") != snapshot_id
        or current_reservation.get("source_repository") != source_identity
        or current_reservation.get("candidate") != candidate
        or current_reservation.get("snapshot_root") != str(target)
        or (phase == "PREPARE" and current_reservation.get("prepare_intent_sha256") != lifecycle_digest)
        or (phase == "REMOVE" and (receipt is None or receipt.get("target_reservation") != target_reservation))
    ):
        reject("SNAPSHOT_RECOVERY_RESERVATION_BINDING_INVALID")
    prefix = f"{snapshot_id}.{lifecycle_digest}.{phase.lower()}.g"
    suffix = ".recovery-intent.json"
    catalog: list[tuple[dict[str, Any], bytes, Path, Path]] = []
    for item in sorted(paths.state.iterdir(), key=lambda value: os.fsencode(value.name)):
        if not item.name.startswith(prefix) or not item.name.endswith(suffix):
            continue
        value, raw = load_recovery_intent(item, paths)
        expected_path, expected_audit = recovery_paths(
            paths,
            snapshot_id,
            lifecycle_digest,
            phase,
            value["generation"],
            value["object_identity_sha256"],
        )
        expected_recovery_id = sha256(
            f"{phase}:{snapshot_id}:{lifecycle_digest}:{value['generation']}:{value['object_identity_sha256']}".encode("ascii")
        )
        expected_quarantine = (
            paths.quarantine / "worktrees" / f"{snapshot_id}.{expected_recovery_id}.target"
            if value["action"] == "QUARANTINE_TARGET"
            else common_git_directory(source) / "chenyida-erp-snapshot-quarantine-v1" / f"{snapshot_id}.{expected_recovery_id}.admin"
        )
        _, recorded_reservation, _ = load_target_reservation_reference(value.get("target_reservation"), paths)
        if (
            item != expected_path
            or value.get("recovery_id") != expected_recovery_id
            or value.get("snapshot_id") != snapshot_id
            or value.get("phase") != phase
            or value.get("confirmation") != confirmation
            or value.get("lifecycle_intent") != str(lifecycle_intent_path)
            or value.get("lifecycle_intent_sha256") != lifecycle_digest
            or value.get("prepared_receipt") != (str(prepared_receipt) if prepared_receipt else None)
            or value.get("prepared_receipt_sha256") != prepared_receipt_sha256
            or value.get("source_repository") != source_identity
            or value.get("candidate") != candidate
            or value.get("snapshot_root") != str(target)
            or value.get("admin_dir") != str(expected_admin)
            or value.get("quarantine_path") != str(expected_quarantine)
            or recorded_reservation.get("snapshot_id") != snapshot_id
            or recorded_reservation.get("source_repository") != source_identity
            or recorded_reservation.get("candidate") != candidate
            or recorded_reservation.get("snapshot_root") != str(target)
            or (phase == "PREPARE" and recorded_reservation.get("prepare_intent_sha256") != lifecycle_digest)
            or (phase == "PREPARE" and recorded_reservation.get("generation") != value.get("generation"))
            or (phase == "REMOVE" and value.get("target_reservation") != target_reservation)
        ):
            reject("SNAPSHOT_RECOVERY_INTENT_CONFLICT")
        catalog.append((value, raw, item, expected_audit))

    generations = [entry[0]["generation"] for entry in catalog]
    if generations and (len(set(generations)) != len(generations) or sorted(generations) != list(range(1, max(generations) + 1))):
        reject("SNAPSHOT_RECOVERY_GENERATION_CHAIN_INVALID")
    for value, raw, intent_path, audit_path in catalog:
        audit_exists = path_exists(audit_path)
        quarantine_exists = path_exists(Path(value["quarantine_path"]))
        if audit_exists and not quarantine_exists:
            reject("SNAPSHOT_RECOVERY_RETAINED_EVIDENCE_MISSING")
        if audit_exists:
            validate_completed_recovery(value, raw, intent_path, audit_path, paths)

    registrations = [entry for entry in parse_worktrees(source) if entry.get("worktree") == str(target)]
    if path_exists(target) and not registrations and not path_exists(expected_admin):
        admin, target_identity = target_only_recovery_identity(source, target, paths.uid)
        if admin != expected_admin:
            reject("SNAPSHOT_RECOVERY_TARGET_INVALID")
        if phase == "PREPARE":
            if path_exists(Path(current_reservation["staging_root"])):
                reject("SNAPSHOT_PREPARE_TARGET_PROVENANCE_UNPROVEN")
            assert_reservation_target_recovery_identity(target_identity, current_reservation)
        if phase == "REMOVE":
            if receipt is None:
                reject("SNAPSHOT_RECOVERY_RECEIPT_INVALID")
            assert_remove_target_recovery_identity(target_identity, receipt)
        observed_state = "TARGET_ONLY"
        action = "QUARANTINE_TARGET"
        object_identity = target_identity
        validated_identity = target_identity
        registration_before: dict[str, Any] | None = None
    elif not path_exists(target) and len(registrations) == 1 and path_exists(expected_admin):
        admin = find_admin_for_missing_target(source, target, paths.uid)
        if admin != expected_admin:
            reject("SNAPSHOT_RECOVERY_ADMIN_INVALID")
        admin_identity = admin_only_recovery_identity(source, target, admin, candidate["commit"], f"{LOCK_REASON_PREFIX}{snapshot_id}", paths.uid)
        if phase == "PREPARE" and admin_identity.get("lock_reason") != f"{LOCK_REASON_PREFIX}{snapshot_id}":
            reject("SNAPSHOT_PREPARE_ADMIN_PROVENANCE_UNPROVEN")
        if phase == "REMOVE":
            if receipt is None:
                reject("SNAPSHOT_RECOVERY_RECEIPT_INVALID")
            assert_remove_admin_recovery_identity(admin_identity, receipt)
        object_identity = recovery_tree_identity(admin, paths.uid, "SNAPSHOT_RECOVERY_ADMIN_INVALID")
        observed_state = "ADMIN_ONLY"
        action = "QUARANTINE_ADMIN"
        validated_identity = admin_identity
        registration_before = registrations[0]
    else:
        if path_exists(target) or path_exists(expected_admin) or registrations:
            reject(f"SNAPSHOT_{phase}_RECOVERY_STATE_UNSAFE")
        missing = [entry for entry in catalog if not path_exists(entry[3]) and not path_exists(Path(entry[0]["quarantine_path"]))]
        if missing:
            reject("SNAPSHOT_RECOVERY_OBJECT_OR_QUARANTINE_MISSING")
        pending = [entry for entry in catalog if not path_exists(entry[3]) and path_exists(Path(entry[0]["quarantine_path"]))]
        if len(pending) > 1:
            reject("SNAPSHOT_RECOVERY_GENERATION_AMBIGUOUS")
        if len(pending) == 1:
            return pending[0]
        completed = [entry for entry in catalog if path_exists(entry[3]) and path_exists(Path(entry[0]["quarantine_path"]))]
        if not completed:
            reject(f"SNAPSHOT_{phase}_RECOVERY_STATE_UNSAFE")
        latest_generation = max(entry[0]["generation"] for entry in completed)
        latest = [entry for entry in completed if entry[0]["generation"] == latest_generation]
        if len(latest) != 1:
            reject("SNAPSHOT_RECOVERY_GENERATION_AMBIGUOUS")
        return latest[0]

    object_digest = sha256(canonical_json(object_identity))
    quarantined_unfinished = [
        entry for entry in catalog
        if not path_exists(entry[3]) and path_exists(Path(entry[0]["quarantine_path"]))
    ]
    if quarantined_unfinished:
        reject("SNAPSHOT_RECOVERY_GENERATION_STATE_CONFLICT")
    unfinished = [
        entry for entry in catalog
        if not path_exists(entry[3]) and not path_exists(Path(entry[0]["quarantine_path"]))
    ]
    pending_for_object = [
        entry for entry in unfinished if entry[0]["source_object_identity"] == object_identity
    ]
    if len(pending_for_object) > 1:
        reject("SNAPSHOT_RECOVERY_GENERATION_AMBIGUOUS")
    if len(pending_for_object) == 1 and len(unfinished) == 1:
        return pending_for_object[0]
    if unfinished:
        reject("SNAPSHOT_RECOVERY_OBJECT_CHANGED")
    generation = max((entry[0]["generation"] for entry in catalog), default=0) + 1
    if generation > 999999:
        reject("SNAPSHOT_RECOVERY_GENERATION_EXHAUSTED")
    if phase == "PREPARE" and target_reservation.get("generation") != generation:
        reject("SNAPSHOT_RESERVATION_GENERATION_STATE_CONFLICT")
    recovery_id = sha256(f"{phase}:{snapshot_id}:{lifecycle_digest}:{generation}:{object_digest}".encode("ascii"))
    if action == "QUARANTINE_TARGET":
        quarantine_parent = paths.quarantine / "worktrees"
        ensure_private_directory(quarantine_parent, paths.uid)
        quarantine_path = quarantine_parent / f"{snapshot_id}.{recovery_id}.target"
    else:
        quarantine_parent = common_git_directory(source) / "chenyida-erp-snapshot-quarantine-v1"
        ensure_private_directory(quarantine_parent, paths.uid)
        quarantine_path = quarantine_parent / f"{snapshot_id}.{recovery_id}.admin"
    intent_path, audit_path = recovery_paths(paths, snapshot_id, lifecycle_digest, phase, generation, object_digest)

    plan = {
        "schema_version": 1, "contract": RECOVERY_INTENT_CONTRACT, "recovery_id": recovery_id,
        "generation": generation, "object_identity_sha256": object_digest,
        "snapshot_id": snapshot_id, "phase": phase, "observed_state": observed_state,
        "requested_at": now_iso(clock), "confirmation": confirmation,
        "lifecycle_intent": str(lifecycle_intent_path), "lifecycle_intent_sha256": lifecycle_digest,
        "prepared_receipt": str(prepared_receipt) if prepared_receipt else None,
        "prepared_receipt_sha256": prepared_receipt_sha256,
        "source_repository": source_identity, "candidate": candidate,
        "snapshot_root": str(target), "admin_dir": str(expected_admin),
        "target_reservation": target_reservation, "action": action,
        "source_object_identity": object_identity, "validated_identity": validated_identity,
        "registration_before": registration_before, "quarantine_path": str(quarantine_path),
        "retention": "RETAINED_REQUIRES_SEPARATE_AUTHORIZATION",
    }
    raw = canonical_json(plan)
    write_no_clobber(intent_path, raw, uid=paths.uid)
    return plan, raw, intent_path, audit_path


def execute_recovery_intent(
    plan: dict[str, Any],
    plan_raw: bytes,
    plan_path: Path,
    audit_path: Path,
    source: Path,
    paths: SnapshotPaths,
    clock: Callable[[], datetime],
    failpoint: Callable[[str], None] | None = None,
) -> tuple[Path, str, dict[str, Any]]:
    destination = Path(plan["quarantine_path"])
    if path_exists(audit_path):
        value, raw = validate_completed_recovery(plan, plan_raw, plan_path, audit_path, paths)
        target = Path(plan["snapshot_root"])
        admin = Path(plan["admin_dir"])
        if path_exists(target) or path_exists(admin) or any(entry.get("worktree") == str(target) for entry in parse_worktrees(source)):
            reject("SNAPSHOT_RECOVERY_STALE_RECEIPT")
        return audit_path, sha256(raw), value

    source_path = Path(plan["admin_dir"] if plan["action"] == "QUARANTINE_ADMIN" else plan["snapshot_root"])
    if failpoint:
        failpoint("RECOVERY_INTENT_WRITTEN")
    source_before = source_worktree_state(source)
    source_exists = path_exists(source_path)
    destination_exists = path_exists(destination)
    if source_exists == destination_exists:
        reject("SNAPSHOT_RECOVERY_QUARANTINE_STATE_INVALID")
    if source_exists:
        if plan["action"] == "QUARANTINE_ADMIN":
            current_validated = admin_only_recovery_identity(
                source,
                Path(plan["snapshot_root"]),
                source_path,
                plan["candidate"]["commit"],
                f"{LOCK_REASON_PREFIX}{plan['snapshot_id']}",
                paths.uid,
            )
            if current_validated != plan["validated_identity"]:
                reject("SNAPSHOT_RECOVERY_ADMIN_IDENTITY_CHANGED")
            current_object = recovery_tree_identity(source_path, paths.uid, "SNAPSHOT_RECOVERY_ADMIN_INVALID")
        else:
            admin, current_object = target_only_recovery_identity(source, source_path, paths.uid)
            if admin != Path(plan["admin_dir"]):
                reject("SNAPSHOT_RECOVERY_TARGET_INVALID")
        if current_object != plan["source_object_identity"]:
            reject("SNAPSHOT_RECOVERY_OBJECT_CHANGED")
        rename_no_replace(source_path, destination, paths.uid)
        if failpoint:
            failpoint("RECOVERY_OBJECT_QUARANTINED")
    quarantine_identity = recovery_tree_identity(destination, paths.uid, "SNAPSHOT_RECOVERY_QUARANTINE_CHANGED")
    if quarantine_identity != plan["source_object_identity"]:
        reject("SNAPSHOT_RECOVERY_QUARANTINE_CHANGED")
    target = Path(plan["snapshot_root"])
    admin = Path(plan["admin_dir"])
    registration_after = [entry for entry in parse_worktrees(source) if entry.get("worktree") == str(target)]
    if path_exists(target) or path_exists(admin) or registration_after:
        reject("SNAPSHOT_RECOVERY_TOMBSTONE_INVALID")
    source_after = source_worktree_state(source)
    if source_after != source_before:
        reject("SNAPSHOT_SOURCE_WORKTREE_CHANGED")
    outcome = "PREPARE_ROLLED_BACK_TO_ABSENT" if plan["phase"] == "PREPARE" else "REMOVE_COMPLETED"
    audit = {
        "schema_version": 1, "contract": RECOVERY_CONTRACT, "state": "RECOVERED",
        "recovery_id": plan["recovery_id"], "generation": plan["generation"],
        "object_identity_sha256": plan["object_identity_sha256"], "snapshot_id": plan["snapshot_id"],
        "phase": plan["phase"], "observed_state": plan["observed_state"],
        "recovered_at": now_iso(clock), "confirmation": plan["confirmation"],
        "recovery_intent": str(plan_path), "recovery_intent_sha256": sha256(plan_raw),
        "lifecycle_intent": plan["lifecycle_intent"], "lifecycle_intent_sha256": plan["lifecycle_intent_sha256"],
        "prepared_receipt": plan["prepared_receipt"], "prepared_receipt_sha256": plan["prepared_receipt_sha256"],
        "source_repository": plan["source_repository"], "candidate": plan["candidate"],
        "snapshot_root": plan["snapshot_root"], "admin_dir": plan["admin_dir"],
        "target_reservation": plan["target_reservation"], "action": plan["action"],
        "source_state_before": source_before, "source_state_after": source_after, "source_state_unchanged": True,
        "registration_before": plan["registration_before"], "registration_after": registration_after,
        "quarantine": {"path": str(destination), "identity": quarantine_identity},
        "git_command": {"executed": False, "reason": "ATOMIC_NOREPLACE_QUARANTINE", "stdout_sha256": sha256(b""), "stderr_sha256": sha256(b"")},
        "retention": "RETAINED_REQUIRES_SEPARATE_AUTHORIZATION", "outcome": outcome,
        "tombstone_verified": True,
    }
    raw = canonical_json(audit)
    write_no_clobber(audit_path, raw, uid=paths.uid)
    return audit_path, sha256(raw), audit


def recover_prepare_snapshot(
    source: Path,
    candidate_commit: str,
    candidate_tree: str,
    runtime_root: Path,
    bundle_root: Path,
    snapshot_id: str,
    paths: SnapshotPaths = SnapshotPaths(),
    clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    failpoint: Callable[[str], None] | None = None,
) -> tuple[Path, str, dict[str, Any]]:
    validate_identifier(snapshot_id)
    for value, code in (
        (source, "SNAPSHOT_SOURCE_REPOSITORY_INVALID"),
        (runtime_root, "SNAPSHOT_TEST_RUNTIME_ROOT_INVALID"),
        (bundle_root, "SNAPSHOT_BUNDLE_ROOT_INVALID"),
    ):
        canonical_path(value, code)
    with lifecycle_locks(paths, False):
        intent, intent_raw, intent_path = load_prepare_intent(snapshot_id, paths)
        assert_prepare_worktrees_parent(intent, source, paths.uid, True)
        source_identity = source_repository_identity(source)
        candidate, bundle = bundle_candidate_identity(source, candidate_commit, candidate_tree, bundle_root)
        runtime = test_runtime_identity(source, candidate_commit, runtime_root, bundle_root, paths.uid, paths.trust_root)
        expected_admin = common_git_directory(source) / "worktrees" / snapshot_id
        if (
            intent.get("source_repository") != source_identity
            or intent.get("candidate") != candidate
            or intent.get("supervisor_bundle") != bundle
            or intent.get("test_runtime") != runtime
            or intent.get("snapshot_root") != str(paths.worktrees / snapshot_id)
            or intent.get("expected_admin_dir") != str(expected_admin)
            or path_exists(paths.receipts / f"{snapshot_id}.prepared.json")
        ):
            reject("SNAPSHOT_PREPARE_RECOVERY_BINDING_INVALID")
        _, _, _, reservation_reference = latest_target_reservation(
            snapshot_id,
            intent_raw,
            source_identity,
            candidate,
            bundle,
            runtime,
            paths,
        )
        plan, plan_raw, plan_path, audit_path = build_or_load_recovery_intent(
            source, candidate, snapshot_id, "PREPARE", RECOVER_PREPARE_CONFIRMATION,
            intent_path, intent_raw, expected_admin, paths, clock, reservation_reference,
        )
        return execute_recovery_intent(plan, plan_raw, plan_path, audit_path, source, paths, clock, failpoint)


def recover_remove_snapshot(
    receipt_path: Path,
    receipt_sha256: str,
    snapshot_id: str,
    paths: SnapshotPaths = SnapshotPaths(),
    clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    failpoint: Callable[[str], None] | None = None,
    expected_bundle_root: Path | None = None,
) -> tuple[tuple[Path, str, dict[str, Any]], tuple[Path, str, dict[str, Any]]]:
    validate_identifier(snapshot_id)
    with lifecycle_locks(paths, False):
        receipt, _ = load_prepared_receipt(receipt_path, receipt_sha256, paths)
        if receipt.get("snapshot_id") != snapshot_id:
            reject("SNAPSHOT_RECEIPT_BINDING_MISMATCH")
        bundle_root = Path(receipt["supervisor_bundle"]["root"])
        if expected_bundle_root is not None and expected_bundle_root != bundle_root:
            reject("SNAPSHOT_RECEIPT_BINDING_MISMATCH")
        source, candidate, _, _ = persistent_receipt_identities(receipt, paths)
        intent, intent_raw, intent_path = load_remove_intent(snapshot_id, receipt_path, receipt_sha256, paths)
        expected_admin = Path(receipt["snapshot"]["admin_dir"])
        if (
            intent.get("snapshot_root") != receipt["snapshot"]["root"]
            or intent.get("expected_admin_dir") != str(expected_admin)
            or intent.get("candidate_commit") != candidate["commit"]
            or intent.get("candidate_tree") != candidate["tree"]
            or intent.get("target_reservation") != receipt["target_reservation"]
        ):
            reject("SNAPSHOT_REMOVE_RECOVERY_BINDING_INVALID")
        plan, plan_raw, plan_path, audit_path = build_or_load_recovery_intent(
            source, candidate, snapshot_id, "REMOVE", RECOVER_REMOVE_CONFIRMATION,
            intent_path, intent_raw, expected_admin, paths, clock,
            receipt["target_reservation"],
            receipt_path, receipt_sha256, receipt,
        )
        recovery = execute_recovery_intent(plan, plan_raw, plan_path, audit_path, source, paths, clock, failpoint)
        if failpoint:
            failpoint("RECOVERY_RECEIPT_WRITTEN")
        source, candidate, _, _ = persistent_receipt_identities(receipt, paths)
        removal = ensure_removal_receipt(receipt_path, receipt_sha256, receipt, source, candidate, paths, clock)
        return recovery, removal


def cli_options(arguments: list[str], expected: set[str]) -> dict[str, str]:
    if len(arguments) != len(expected) * 2:
        reject("SNAPSHOT_CLI_ARGUMENT_INVALID")
    result: dict[str, str] = {}
    for index in range(0, len(arguments), 2):
        key = arguments[index]
        if key not in expected or key in result:
            reject("SNAPSHOT_CLI_ARGUMENT_INVALID")
        result[key] = arguments[index + 1]
    if set(result) != expected:
        reject("SNAPSHOT_CLI_ARGUMENT_INVALID")
    return result


def assert_installed_bundle_cli(bundle_root: Path) -> None:
    expected_script = bundle_root / "chenyida_erp_site/scripts/release-candidate-snapshot.py"
    if bundle_root.parent != INSTALLED_BUNDLES_ROOT or Path(os.path.realpath(sys.argv[0])) != expected_script:
        reject("SNAPSHOT_CLI_CONTEXT_INVALID")


def main() -> None:
    if os.getuid() != 0 or len(sys.argv) < 2:
        reject("SNAPSHOT_CLI_CONTEXT_INVALID")
    command = sys.argv[1]
    paths = SnapshotPaths()
    if command == "prepare":
        options = cli_options(sys.argv[2:], {"--source-repository", "--candidate-commit", "--candidate-tree", "--test-runtime-root", "--bundle-root", "--snapshot-id", "--confirm"})
        if options["--confirm"] != PREPARE_CONFIRMATION:
            reject("SNAPSHOT_CONFIRMATION_INVALID")
        assert_installed_bundle_cli(Path(options["--bundle-root"]))
        receipt, digest, value = prepare_snapshot(Path(options["--source-repository"]), options["--candidate-commit"], options["--candidate-tree"], Path(options["--test-runtime-root"]), Path(options["--bundle-root"]), options["--snapshot-id"], paths)
        os.write(sys.stdout.fileno(), canonical_json({"result": value["state"], "snapshot_id": value["snapshot_id"], "receipt": str(receipt), "receipt_sha256": digest}))
        return
    if command == "recover-prepare":
        options = cli_options(sys.argv[2:], {"--source-repository", "--candidate-commit", "--candidate-tree", "--test-runtime-root", "--bundle-root", "--snapshot-id", "--confirm"})
        if options["--confirm"] != RECOVER_PREPARE_CONFIRMATION:
            reject("SNAPSHOT_CONFIRMATION_INVALID")
        assert_installed_bundle_cli(Path(options["--bundle-root"]))
        receipt, digest, value = recover_prepare_snapshot(
            Path(options["--source-repository"]), options["--candidate-commit"], options["--candidate-tree"],
            Path(options["--test-runtime-root"]), Path(options["--bundle-root"]), options["--snapshot-id"], paths,
        )
        os.write(sys.stdout.fileno(), canonical_json({"result": value["outcome"], "snapshot_id": value["snapshot_id"], "receipt": str(receipt), "receipt_sha256": digest}))
        return
    if command == "verify":
        options = cli_options(sys.argv[2:], {"--receipt", "--receipt-sha256", "--repository-root", "--git-commit", "--git-tree", "--test-runtime-root", "--bundle-root", "--confirm"})
        if options["--confirm"] != VERIFY_CONFIRMATION:
            reject("SNAPSHOT_CONFIRMATION_INVALID")
        assert_installed_bundle_cli(Path(options["--bundle-root"]))
        context = inherited_lifecycle_lock(paths) if os.environ.get("ERP_RELEASE_SUPERVISOR_LAUNCHED") == "YES" else lifecycle_locks(paths, False)
        with context:
            value = verify_snapshot(Path(options["--receipt"]), options["--receipt-sha256"], Path(options["--repository-root"]), options["--git-commit"], options["--git-tree"], Path(options["--test-runtime-root"]), Path(options["--bundle-root"]), paths)
        os.write(sys.stdout.fileno(), canonical_json({"result": "VERIFIED", "snapshot_id": value["snapshot_id"], "receipt_sha256": options["--receipt-sha256"]}))
        return
    if command == "remove":
        options = cli_options(sys.argv[2:], {"--receipt", "--receipt-sha256", "--snapshot-id", "--bundle-root", "--confirm"})
        if options["--confirm"] != REMOVE_CONFIRMATION:
            reject("SNAPSHOT_CONFIRMATION_INVALID")
        assert_installed_bundle_cli(Path(options["--bundle-root"]))
        receipt, digest, value = remove_snapshot(
            Path(options["--receipt"]),
            options["--receipt-sha256"],
            options["--snapshot-id"],
            paths,
            expected_bundle_root=Path(options["--bundle-root"]),
        )
        os.write(sys.stdout.fileno(), canonical_json({"result": value["state"], "snapshot_id": value["snapshot_id"], "receipt": str(receipt), "receipt_sha256": digest}))
        return
    if command == "recover-remove":
        options = cli_options(sys.argv[2:], {"--receipt", "--receipt-sha256", "--snapshot-id", "--bundle-root", "--confirm"})
        if options["--confirm"] != RECOVER_REMOVE_CONFIRMATION:
            reject("SNAPSHOT_CONFIRMATION_INVALID")
        assert_installed_bundle_cli(Path(options["--bundle-root"]))
        recovery, removal = recover_remove_snapshot(
            Path(options["--receipt"]), options["--receipt-sha256"], options["--snapshot-id"], paths,
            expected_bundle_root=Path(options["--bundle-root"]),
        )
        recovery_path, recovery_digest, recovery_value = recovery
        removal_path, removal_digest, removal_value = removal
        os.write(sys.stdout.fileno(), canonical_json({
            "result": removal_value["state"], "snapshot_id": removal_value["snapshot_id"],
            "recovery_receipt": str(recovery_path), "recovery_receipt_sha256": recovery_digest,
            "removal_receipt": str(removal_path), "removal_receipt_sha256": removal_digest,
            "recovery_outcome": recovery_value["outcome"],
        }))
        return
    reject("SNAPSHOT_CLI_ARGUMENT_INVALID")


if __name__ == "__main__":
    try:
        main()
    except SnapshotError as error:
        print(error.code, file=sys.stderr)
        raise SystemExit(1) from None
    except Exception:
        print("SNAPSHOT_INTERNAL_ERROR", file=sys.stderr)
        raise SystemExit(1) from None
