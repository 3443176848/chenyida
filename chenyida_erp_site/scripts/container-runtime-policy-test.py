#!/usr/bin/python3
"""Exercise the production container policy with isolated, task-owned resources.

Only one temporary container is present at a time.  The test never mounts an ERP
runtime volume and never prints container configuration, environment, or logs.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.util
import json
import os
import re
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
POLICY_MODULE_PATH = SCRIPT_DIR / "container-runtime-policy.py"
SPEC = importlib.util.spec_from_file_location("container_runtime_policy", POLICY_MODULE_PATH)
runtime_policy = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(runtime_policy)

LABEL = "chenyida.erp.container-runtime-policy-test"
NAME_PREFIX = "cyd-runtime-policy-"
MAX_DOCKER_OUTPUT = 1_048_576
PROTECTED_VOLUMES = {
    "chenyida-erp-parallel_erp_postgres",
    "chenyida-erp-parallel_erp_postgres_tablespaces",
    "chenyida-erp-parallel_erp_uploads",
    "chenyida-erp-parallel_erp_attachments",
    "chenyida-erp-parallel_erp_backup_status",
}
SECRET_TARGETS = {
    "/run/chenyida-erp-secrets/admin-database-password",
    "/run/chenyida-erp-secrets/admin-password",
    "/run/chenyida-erp-secrets/migration-database-password",
    "/run/chenyida-erp-secrets/postgres-bootstrap-password",
    "/run/chenyida-erp-secrets/web-database-password",
    "/run/chenyida-erp-secrets/worker-database-password",
}
NODE_HOLD = "setInterval(() => {}, 60000)"
NODE_PROBE = r"""
const fs = require('node:fs');
const child = require('node:child_process');
const spec = JSON.parse(process.argv[1]);
if (process.getuid() !== spec.uid || process.getgid() !== spec.gid) process.exit(50);
if (!spec.groups.every((group) => process.getgroups().includes(group))) process.exit(51);
function mustFail(path, exitCode) {
  try { fs.writeFileSync(path, 'forbidden', { flag: 'wx' }); }
  catch { return; }
  try { fs.unlinkSync(path); } catch {}
  process.exit(exitCode);
}
mustFail('/.chenyida-runtime-rootfs-probe', 41);
const temporary = '/tmp/chenyida-runtime-policy-probe';
try { fs.writeFileSync(temporary, '#!/bin/sh\nexit 0\n', { flag: 'wx', mode: 0o700 }); }
catch { process.exit(42); }
const execution = child.spawnSync(temporary, [], { stdio: 'ignore' });
if (!execution.error || execution.error.code !== 'EACCES') process.exit(43);
fs.unlinkSync(temporary);
for (const directory of spec.writable) {
  const file = `${directory}/.chenyida-runtime-policy-probe`;
  try { fs.writeFileSync(file, 'ok', { flag: 'wx' }); fs.unlinkSync(file); }
  catch { process.exit(44); }
}
for (const directory of spec.readonly) mustFail(`${directory}/.chenyida-runtime-policy-probe`, 45);
for (const fixture of spec.readable) {
  const file = fixture.path;
  let directoryStat;
  let fileStat;
  try { directoryStat = fs.lstatSync(require('node:path').dirname(file)); }
  catch { process.exit(52); }
  try { fileStat = fs.lstatSync(file); }
  catch { process.exit(53); }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()
    || directoryStat.uid !== fixture.directory_uid || directoryStat.gid !== fixture.directory_gid
    || (directoryStat.mode & 0o7777) !== fixture.directory_mode
    || !fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.nlink !== 1
    || fileStat.uid !== fixture.uid || fileStat.gid !== fixture.gid) process.exit(54);
  if ((fileStat.mode & 0o7777) !== fixture.mode || fs.realpathSync(file) !== file) process.exit(55);
  let content;
  try { content = fs.readFileSync(file, 'utf8'); }
  catch (error) {
    if (error && error.code === 'EACCES') process.exit(46);
    if (error && error.code === 'ENOENT') process.exit(48);
    process.exit(49);
  }
  if (content !== fixture.content) process.exit(47);
  try { fs.writeFileSync(file, 'forbidden'); }
  catch { continue; }
  process.exit(57);
}
for (const file of spec.absent) if (fs.existsSync(file)) process.exit(56);
""".strip()


class RuntimeTestError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def fail(code: str) -> None:
    raise RuntimeTestError(code)


def synthetic_secret(label: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(f"task56:{label}".encode("ascii")).digest()).rstrip(b"=").decode("ascii")


def directory_identity(path: Path, code: str) -> tuple[int, int, int, int, int]:
    try:
        value = path.lstat()
    except OSError:
        fail(code)
    if not stat.S_ISDIR(value.st_mode) or stat.S_ISLNK(value.st_mode):
        fail(code)
    return value.st_dev, value.st_ino, value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)


def task_volume_mountpoint(name: str) -> Path:
    if name in PROTECTED_VOLUMES or not re.fullmatch(r"cyd-runtime-policy-([0-9a-f]{16})-[a-z0-9-]+", name):
        fail("VOLUME_IDENTITY_INVALID")
    token = name.split("-", 3)[3].split("-", 1)[0]
    value = docker_json(["volume", "inspect", "--", name], "VOLUME_INSPECT_FAILED")
    if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
        fail("VOLUME_INSPECT_INVALID")
    item = value[0]
    mountpoint = item.get("Mountpoint")
    if (
        item.get("Name") != name
        or item.get("Driver") != "local"
        or (item.get("Labels") or {}).get(LABEL) != token
        or not isinstance(mountpoint, str)
        or not os.path.isabs(mountpoint)
        or os.path.normpath(mountpoint) != mountpoint
        or mountpoint == "/"
    ):
        fail("VOLUME_MOUNTPOINT_INVALID")
    path = Path(mountpoint)
    try:
        if path.is_symlink() or path.resolve(strict=True) != path or not path.is_dir():
            fail("VOLUME_MOUNTPOINT_INVALID")
    except OSError:
        fail("VOLUME_MOUNTPOINT_INVALID")
    return path


def safe_environment() -> dict[str, str]:
    return {
        "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "HOME": "/nonexistent",
        "LC_ALL": "C",
        "LANG": "C",
        "TZ": "UTC",
        "DOCKER_CONTENT_TRUST": "0",
    }


def docker(
    arguments: list[str], code: str, *, timeout: int = 60, exit_codes: dict[int, str] | None = None
) -> str:
    try:
        result = subprocess.run(
            ["/usr/bin/docker", *arguments],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=safe_environment(),
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        fail(code)
    if len(result.stdout) > MAX_DOCKER_OUTPUT or len(result.stderr) > MAX_DOCKER_OUTPUT:
        fail(code)
    if result.returncode != 0:
        fail((exit_codes or {}).get(result.returncode, code))
    try:
        return result.stdout.decode("utf-8").strip()
    except UnicodeDecodeError:
        fail(code)


def docker_json(arguments: list[str], code: str, *, timeout: int = 60) -> Any:
    raw = docker(arguments, code, timeout=timeout)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        fail(code)


def parse_status(raw: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for line in raw.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        value = value.strip()
        if key in {"Uid", "Gid", "Groups"}:
            try:
                result[key] = [int(item) for item in value.split()]
            except ValueError:
                fail("PROCESS_STATUS_INVALID")
        elif key in {"CapEff", "NoNewPrivs"}:
            try:
                result[key] = int(value, 16 if key == "CapEff" else 10)
            except ValueError:
                fail("PROCESS_STATUS_INVALID")
    if set(result) != {"Uid", "Gid", "Groups", "CapEff", "NoNewPrivs"}:
        fail("PROCESS_STATUS_INVALID")
    return result


def process_status(pid: Any) -> dict[str, Any]:
    if isinstance(pid, bool) or not isinstance(pid, int) or pid < 2:
        fail("PROCESS_PID_INVALID")
    path = Path("/proc") / str(pid) / "status"
    try:
        metadata = path.lstat()
        if not stat.S_ISREG(metadata.st_mode):
            fail("PROCESS_STATUS_INVALID")
        raw = path.read_text(encoding="utf-8")
    except RuntimeTestError:
        raise
    except OSError:
        fail("PROCESS_STATUS_INVALID")
    return parse_status(raw)


def assert_process(contract: dict[str, Any], inspect: dict[str, Any], reader_gid: int) -> None:
    status = process_status(inspect.get("State", {}).get("Pid"))
    try:
        expected_uid, expected_gid = [int(item) for item in contract["user"].split(":", 1)]
    except (ValueError, AttributeError):
        fail("POLICY_RUNTIME_USER_INVALID")
    if status["Uid"] != [expected_uid] * 4 or status["Gid"] != [expected_gid] * 4:
        fail("PROCESS_USER_MISMATCH")
    expected_groups = {
        reader_gid if item == "$RELEASE_IDENTITY_READER_GID" else int(item) for item in contract["groups"]
    }
    expected_groups.add(expected_gid)
    if not expected_groups.issubset(set(status["Groups"])):
        fail("PROCESS_GROUPS_MISMATCH")
    expected_capabilities = 1 << 10 if contract["cap_add"] == ["NET_BIND_SERVICE"] else 0
    if status["CapEff"] != expected_capabilities:
        fail("PROCESS_CAPABILITIES_MISMATCH")
    if status["NoNewPrivs"] != 1:
        fail("PROCESS_NO_NEW_PRIVILEGES_MISMATCH")


def inspect_container(name: str) -> dict[str, Any]:
    value = docker_json(["container", "inspect", "--", name], "CONTAINER_INSPECT_FAILED")
    if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
        fail("CONTAINER_INSPECT_INVALID")
    return value[0]


def inspect_image(
    reference: str,
    expected_config: str | None,
    declared_volumes: list[str],
    environment_keys: list[str],
) -> None:
    value = docker_json(["image", "inspect", "--", reference], "IMAGE_INSPECT_FAILED")
    if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
        fail("IMAGE_INSPECT_INVALID")
    image = value[0]
    if image.get("Os") != "linux" or image.get("Architecture") != "amd64":
        fail("IMAGE_PLATFORM_MISMATCH")
    if not runtime_policy.IMAGE_DIGEST_RE.fullmatch(reference):
        fail("IMAGE_REFERENCE_INVALID")
    manifest_digest = f"sha256:{reference.rsplit('@sha256:', 1)[1]}"
    descriptor = image.get("Descriptor")
    repo_digests = image.get("RepoDigests")
    if (
        image.get("Id") != manifest_digest
        or not isinstance(descriptor, dict)
        or descriptor.get("digest") != manifest_digest
        or not isinstance(repo_digests, list)
        or any(not isinstance(item, str) for item in repo_digests)
        or reference not in repo_digests
    ):
        fail("IMAGE_MANIFEST_DIGEST_MISMATCH")
    if expected_config is not None:
        annotations = descriptor.get("annotations")
        if not isinstance(annotations, dict) or annotations.get("config.digest") != expected_config:
            fail("IMAGE_CONFIG_DIGEST_MISMATCH")
    volumes = image.get("Config", {}).get("Volumes") or {}
    if not isinstance(volumes, dict) or sorted(volumes) != declared_volumes or any(value != {} for value in volumes.values()):
        fail("IMAGE_DECLARED_VOLUMES_MISMATCH")
    environment = image.get("Config", {}).get("Env") or []
    if not isinstance(environment, list) or any(not isinstance(item, str) or "=" not in item for item in environment):
        fail("IMAGE_ENVIRONMENT_INVALID")
    actual_environment_keys = [item.split("=", 1)[0] for item in environment]
    if len(actual_environment_keys) != len(set(actual_environment_keys)) or sorted(actual_environment_keys) != environment_keys:
        fail("IMAGE_ENVIRONMENT_KEYS_MISMATCH")


def required_tmpfs_targets(contract: dict[str, Any]) -> set[str]:
    result: set[str] = set()
    for entry in contract["tmpfs"]:
        target, separator, options = entry.partition(":")
        if not separator or not target.startswith("/"):
            fail("POLICY_TMPFS_INVALID")
        required = {"rw", "nosuid", "nodev", "noexec"}
        if not required.issubset(set(options.split(","))):
            fail("POLICY_TMPFS_INVALID")
        result.add(target)
    return result


def assert_runtime_contract(
    contract: dict[str, Any], inspect: dict[str, Any], network_names: set[str], reader_gid: int
) -> None:
    host = inspect.get("HostConfig")
    config = inspect.get("Config")
    if not isinstance(host, dict) or not isinstance(config, dict):
        fail("CONTAINER_INSPECT_INVALID")
    if config.get("User") != contract["user"] or host.get("ReadonlyRootfs") is not True:
        fail("RUNTIME_IDENTITY_OR_ROOTFS_MISMATCH")
    actual_drop = [item.removeprefix("CAP_") for item in (host.get("CapDrop") or [])]
    actual_add = [item.removeprefix("CAP_") for item in (host.get("CapAdd") or [])]
    if actual_drop != contract["cap_drop"] or actual_add != contract["cap_add"]:
        fail(f"{contract['service'].upper()}_RUNTIME_CAPABILITIES_MISMATCH")
    if host.get("NanoCpus") != int(contract["resources"]["cpus"] * 1_000_000_000):
        fail("RUNTIME_RESOURCES_MISMATCH")
    if (
        host.get("Memory") != contract["resources"]["memory_bytes"]
        or host.get("MemorySwap") != contract["resources"]["memory_swap_bytes"]
        or host.get("PidsLimit") != contract["resources"]["pids"]
        or host.get("ShmSize") != (contract["resources"]["shared_memory_bytes"] or 67_108_864)
    ):
        fail("RUNTIME_RESOURCES_MISMATCH")
    if host.get("RestartPolicy") != {"Name": contract["lifecycle"]["restart"], "MaximumRetryCount": 0}:
        fail("RUNTIME_RESTART_POLICY_MISMATCH")
    expected_init = contract["lifecycle"]["init"]
    if bool(host.get("Init")) is not expected_init:
        fail("RUNTIME_INIT_POLICY_MISMATCH")
    expected_timeout = 30 if contract["lifecycle"]["stop_grace_period"] == "30s" else None
    if config.get("StopTimeout") != expected_timeout:
        fail("RUNTIME_STOP_TIMEOUT_MISMATCH")
    logging = host.get("LogConfig")
    if logging != {
        "Type": contract["logging"]["driver"],
        "Config": {"max-file": contract["logging"]["max_file"], "max-size": contract["logging"]["max_size"]},
    }:
        fail("RUNTIME_LOGGING_POLICY_MISMATCH")
    if set((host.get("Tmpfs") or {}).keys()) != required_tmpfs_targets(contract):
        fail("RUNTIME_TMPFS_POLICY_MISMATCH")
    actual_networks = set((inspect.get("NetworkSettings", {}).get("Networks") or {}).keys())
    if actual_networks != network_names:
        fail("RUNTIME_NETWORK_POLICY_MISMATCH")

    expected_mounts = {
        mount["target"]: not mount["read_only"] for mount in contract["mounts"]
    }
    actual_mounts: dict[str, bool] = {}
    for mount in inspect.get("Mounts") or []:
        destination = mount.get("Destination")
        if destination in expected_mounts:
            actual_mounts[destination] = mount.get("RW") is True
    if actual_mounts != expected_mounts:
        fail("RUNTIME_MOUNTS_POLICY_MISMATCH")
    assert_process(contract, inspect, reader_gid)


def wait_running(name: str, *, healthy: bool = False, timeout: int = 60) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        inspect = inspect_container(name)
        state = inspect.get("State") or {}
        if state.get("Running"):
            if not healthy or (state.get("Health") or {}).get("Status") == "healthy":
                return inspect
            if (state.get("Health") or {}).get("Status") == "unhealthy":
                fail("CONTAINER_UNHEALTHY")
        elif state.get("Status") in {"exited", "dead"}:
            fail("CONTAINER_EXITED")
        time.sleep(0.25)
    fail("CONTAINER_START_TIMEOUT")


def listener_ports(pid: int) -> tuple[set[int], set[int]]:
    tcp: set[int] = set()
    udp: set[int] = set()
    for filename, target in (("tcp", tcp), ("tcp6", tcp), ("udp", udp), ("udp6", udp)):
        path = Path("/proc") / str(pid) / "net" / filename
        try:
            lines = path.read_text(encoding="ascii").splitlines()[1:]
        except OSError:
            fail("LISTENER_INSPECTION_FAILED")
        for line in lines:
            fields = line.split()
            if len(fields) < 4:
                fail("LISTENER_INSPECTION_FAILED")
            try:
                port = int(fields[1].rsplit(":", 1)[1], 16)
                state = fields[3]
            except (IndexError, ValueError):
                fail("LISTENER_INSPECTION_FAILED")
            if filename.startswith("tcp") and state == "0A":
                target.add(port)
            elif filename.startswith("udp"):
                target.add(port)
    return tcp, udp


class IsolatedResources:
    def __init__(self, reader_gid: int):
        self.token = secrets.token_hex(8)
        self.prefix = f"{NAME_PREFIX}{self.token}"
        self.reader_gid = reader_gid
        self.container: str | None = None
        self.volumes: set[str] = set()
        self.networks: dict[str, str] = {}
        self.temporary = Path(tempfile.mkdtemp(prefix=f"{self.prefix}-", dir="/tmp"))
        self.temporary.chmod(0o711)

    def checked_name(self, suffix: str) -> str:
        name = f"{self.prefix}-{suffix}"
        if not re.fullmatch(r"cyd-runtime-policy-[0-9a-f]{16}-[a-z0-9-]+", name):
            fail("TASK_RESOURCE_NAME_INVALID")
        if name in PROTECTED_VOLUMES:
            fail("PROTECTED_VOLUME_COLLISION")
        return name

    def create_networks(self) -> None:
        for logical, internal in (("backend", True), ("edge", False)):
            name = self.checked_name(logical)
            arguments = ["network", "create", "--label", f"{LABEL}={self.token}"]
            if internal:
                arguments.append("--internal")
            arguments.append(name)
            docker(arguments, "NETWORK_CREATE_FAILED")
            self.networks[logical] = name

    def create_volume(self, suffix: str) -> str:
        name = self.checked_name(suffix)
        docker(["volume", "create", "--label", f"{LABEL}={self.token}", name], "VOLUME_CREATE_FAILED")
        self.volumes.add(name)
        return name

    def assert_single_container(self) -> None:
        ids = docker(["ps", "-aq", "--filter", f"label={LABEL}={self.token}"], "TASK_CONTAINER_INVENTORY_FAILED")
        found = ids.splitlines() if ids else []
        expected = 1 if self.container else 0
        if len(found) != expected:
            fail("TASK_CONTAINER_COUNT_INVALID")

    def remove_container(self) -> None:
        if self.container is None:
            return
        name = self.container
        docker(["container", "rm", "-f", "--", name], "CONTAINER_REMOVE_FAILED")
        self.container = None
        self.assert_single_container()

    def cleanup(self) -> bool:
        success = True
        if self.container is not None:
            name = self.container
            try:
                docker(["container", "rm", "-f", "--", name], "CONTAINER_REMOVE_FAILED")
                self.container = None
            except RuntimeTestError:
                success = False
        remaining_volumes: set[str] = set()
        for name in sorted(self.volumes, reverse=True):
            try:
                docker(["volume", "rm", "--", name], "VOLUME_REMOVE_FAILED")
            except RuntimeTestError:
                success = False
                remaining_volumes.add(name)
        self.volumes = remaining_volumes
        remaining_networks: dict[str, str] = {}
        for name in sorted(self.networks.values(), reverse=True):
            try:
                docker(["network", "rm", "--", name], "NETWORK_REMOVE_FAILED")
            except RuntimeTestError:
                success = False
                logical = next((key for key, value in self.networks.items() if value == name), name)
                remaining_networks[logical] = name
        self.networks = remaining_networks
        try:
            resolved = self.temporary.resolve(strict=True)
            if resolved.parent != Path("/tmp") or not resolved.name.startswith(self.prefix):
                return False
            shutil.rmtree(resolved)
        except OSError:
            success = False
        if self.temporary.exists():
            success = False
        return success


def common_create_arguments(
    resources: IsolatedResources, contract: dict[str, Any], service: str
) -> tuple[str, list[str], set[str]]:
    name = resources.checked_name(service)
    arguments = [
        "container",
        "create",
        "--pull",
        "never",
        "--name",
        name,
        "--label",
        f"{LABEL}={resources.token}",
        "--user",
        contract["user"],
        "--read-only",
        "--security-opt",
        "no-new-privileges:true",
        "--cpus",
        str(contract["resources"]["cpus"]),
        "--memory",
        str(contract["resources"]["memory_bytes"]),
        "--memory-swap",
        str(contract["resources"]["memory_swap_bytes"]),
        "--pids-limit",
        str(contract["resources"]["pids"]),
        "--restart",
        contract["lifecycle"]["restart"],
        "--log-driver",
        contract["logging"]["driver"],
        "--log-opt",
        f"max-size={contract['logging']['max_size']}",
        "--log-opt",
        f"max-file={contract['logging']['max_file']}",
        "--network",
        resources.networks[contract["networks"][0]],
    ]
    for capability in contract["cap_drop"]:
        arguments.extend(["--cap-drop", capability])
    for capability in contract["cap_add"]:
        arguments.extend(["--cap-add", capability])
    for group in contract["groups"]:
        value = str(resources.reader_gid) if group == "$RELEASE_IDENTITY_READER_GID" else group
        arguments.extend(["--group-add", value])
    for tmpfs in contract["tmpfs"]:
        arguments.extend(["--tmpfs", tmpfs])
    if contract["resources"]["shared_memory_bytes"] is not None:
        arguments.extend(["--shm-size", str(contract["resources"]["shared_memory_bytes"])])
    if contract["lifecycle"]["init"]:
        arguments.append("--init")
    if contract["lifecycle"]["stop_grace_period"] == "30s":
        arguments.extend(["--stop-timeout", "30"])
    network_names = {resources.networks[item] for item in contract["networks"]}
    return name, arguments, network_names


def attach_additional_networks(resources: IsolatedResources, name: str, contract: dict[str, Any]) -> None:
    for logical in contract["networks"][1:]:
        docker(["network", "connect", resources.networks[logical], name], "NETWORK_CONNECT_FAILED")


def candidate_mount_arguments(
    resources: IsolatedResources, contract: dict[str, Any], service: str
) -> tuple[list[str], dict[str, Any]]:
    arguments: list[str] = []
    uid, gid = [int(item) for item in contract["user"].split(":", 1)]
    groups = [resources.reader_gid if item == "$RELEASE_IDENTITY_READER_GID" else int(item) for item in contract["groups"]]
    probe = {
        "uid": uid,
        "gid": gid,
        "groups": groups,
        "writable": [],
        "readonly": [],
        "readable": [],
        "absent": sorted(SECRET_TARGETS - {
            mount["target"] for mount in contract["mounts"] if mount["target"] in SECRET_TARGETS
        }),
    }
    volume_index = 0
    for mount in contract["mounts"]:
        target = mount["target"]
        if mount["type"] == "volume":
            volume_index += 1
            volume = resources.create_volume(f"{service}-v{volume_index}")
            specification = f"type=volume,source={volume},target={target}"
            if mount["read_only"]:
                specification += ",readonly"
                probe["readonly"].append(target)
            else:
                probe["writable"].append(target)
            arguments.extend(["--mount", specification])
            continue

        if mount["source"].startswith("/etc/chenyida-erp/runtime-secrets/"):
            source = resources.temporary / "runtime-secrets"
            source.mkdir(mode=0o700, exist_ok=True)
            os.chown(source, 0, 0)
            source.chmod(0o700)
            filename = source / Path(mount["source"]).name
            content = f"{synthetic_secret(f'{service}:{filename.name}')}\n"
            filename.write_text(content, encoding="ascii")
            fixture_gid = 0 if service == "migrate" else 65_532
            os.chown(filename, 0, fixture_gid)
            filename.chmod(0o440)
            arguments.extend(["--mount", f"type=bind,source={filename},target={target},readonly"])
            probe["readonly"].append(target)
            probe["readable"].append({
                "path": target, "directory_uid": 0, "directory_gid": 0, "directory_mode": 0o555,
                "uid": 0, "gid": fixture_gid, "mode": 0o440, "content": content,
            })
            continue
        if service == "migrate":
            source = resources.temporary / "release-candidate"
            filename = source / "release-manifest.json"
        else:
            source = resources.temporary / "release-identity"
            filename = source / "release-identity.json"
        source.mkdir(mode=0o750, exist_ok=True)
        os.chown(source, 0, 0 if service == "migrate" else resources.reader_gid)
        source.chmod(0o750)
        content = "runtime-policy-fixture\n"
        filename.write_text(content, encoding="utf-8")
        os.chown(filename, 0, 0 if service == "migrate" else resources.reader_gid)
        filename.chmod(0o440)
        arguments.extend(["--mount", f"type=bind,source={source},target={target},readonly"])
        probe["readonly"].append(target)
        fixture_gid = 0 if service == "migrate" else resources.reader_gid
        probe["readable"].append({
            "path": str(Path(target) / filename.name), "directory_uid": 0, "directory_gid": fixture_gid,
            "directory_mode": 0o750, "uid": 0, "gid": fixture_gid, "mode": 0o440, "content": content,
        })
    return arguments, probe


def run_candidate_service(
    resources: IsolatedResources,
    contract: dict[str, Any],
    service: str,
    image: str,
) -> None:
    name, arguments, networks = common_create_arguments(resources, contract, service)
    mount_arguments, probe = candidate_mount_arguments(resources, contract, service)
    arguments.extend(mount_arguments)
    arguments.extend(["--entrypoint", "node", image, "-e", NODE_HOLD])
    docker(arguments, "CANDIDATE_CONTAINER_CREATE_FAILED")
    resources.container = name
    resources.assert_single_container()
    attach_additional_networks(resources, name, contract)
    docker(["container", "start", name], "CANDIDATE_CONTAINER_START_FAILED")
    inspect = wait_running(name)
    assert_runtime_contract(contract, inspect, networks, resources.reader_gid)
    docker(
        ["container", "exec", name, "node", "-e", NODE_PROBE, json.dumps(probe, separators=(",", ":"))],
        f"{service.upper()}_RUNTIME_PROBE_FAILED",
        exit_codes={
            41: f"{service.upper()}_ROOTFS_WRITE_SUCCEEDED",
            42: f"{service.upper()}_TMPFS_WRITE_FAILED",
            43: f"{service.upper()}_TMPFS_EXECUTION_SUCCEEDED",
            44: f"{service.upper()}_DATA_VOLUME_WRITE_FAILED",
            45: f"{service.upper()}_READ_ONLY_MOUNT_WRITE_SUCCEEDED",
            46: f"{service.upper()}_READ_ONLY_FIXTURE_UNREADABLE",
            47: f"{service.upper()}_READ_ONLY_FIXTURE_CONTENT_MISMATCH",
            48: f"{service.upper()}_READ_ONLY_FIXTURE_MISSING",
            49: f"{service.upper()}_READ_ONLY_FIXTURE_IO_FAILED",
            50: f"{service.upper()}_EXEC_USER_MISMATCH",
            51: f"{service.upper()}_EXEC_GROUPS_MISMATCH",
            52: f"{service.upper()}_READ_ONLY_DIRECTORY_STAT_FAILED",
            53: f"{service.upper()}_READ_ONLY_FILE_STAT_FAILED",
            54: f"{service.upper()}_READ_ONLY_FIXTURE_GROUP_MISMATCH",
            55: f"{service.upper()}_READ_ONLY_FIXTURE_MODE_MISMATCH",
            56: f"{service.upper()}_SIBLING_SECRET_VISIBLE",
            57: f"{service.upper()}_READ_ONLY_FIXTURE_WRITE_SUCCEEDED",
        },
    )
    docker(["container", "stop", "--time", "5", name], "CANDIDATE_CONTAINER_STOP_FAILED")
    resources.remove_container()


def postgres_health_arguments(contract: dict[str, Any]) -> list[str]:
    health = contract["healthcheck"]
    if not isinstance(health, dict) or health["test"][0] != "CMD-SHELL":
        fail("POSTGRES_HEALTH_POLICY_INVALID")
    command = health["test"][1].replace("$${POSTGRES_USER}", "$POSTGRES_USER").replace(
        "$${POSTGRES_DB}", "$POSTGRES_DB"
    )
    return [
        "--health-cmd",
        command,
        "--health-interval",
        health["interval"],
        "--health-timeout",
        health["timeout"],
        "--health-retries",
        str(health["retries"]),
    ]


def run_postgres(resources: IsolatedResources, contract: dict[str, Any], image: str) -> None:
    name, arguments, networks = common_create_arguments(resources, contract, "postgres")
    volume = resources.create_volume("postgres-data")
    tablespace_volume = resources.create_volume("postgres-tablespaces")
    tablespace_root = task_volume_mountpoint(tablespace_volume)
    approved_tablespace = tablespace_root / "runtime_policy_ts"
    os.chown(tablespace_root, 0, 999)
    tablespace_root.chmod(0o750)
    approved_tablespace.mkdir(mode=0o700)
    os.chown(approved_tablespace, 999, 999)
    approved_tablespace.chmod(0o700)
    tablespace_root_identity = directory_identity(tablespace_root, "TABLESPACE_NAMESPACE_METADATA_INVALID")
    approved_tablespace_identity = directory_identity(approved_tablespace, "TABLESPACE_ENTRY_METADATA_INVALID")
    if tablespace_root_identity[2:] != (0, 999, 0o750) or approved_tablespace_identity[2:] != (999, 999, 0o700):
        fail("TABLESPACE_METADATA_INVALID")
    secret_root = resources.temporary / "postgres-secrets"
    secret_root.mkdir(mode=0o700)
    os.chown(secret_root, 0, 0)
    bootstrap_secret = secret_root / "postgres-bootstrap-password"
    bootstrap_secret.write_text(f"{synthetic_secret('postgres:bootstrap')}\n", encoding="ascii")
    os.chown(bootstrap_secret, 0, 999)
    bootstrap_secret.chmod(0o440)
    arguments.extend(postgres_health_arguments(contract))
    arguments.extend(
        [
            "--env",
            "POSTGRES_DB=chenyida_erp",
            "--env",
            "POSTGRES_USER=postgres",
            "--env",
            "POSTGRES_PASSWORD_FILE=/run/chenyida-erp-secrets/postgres-bootstrap-password",
            "--mount",
            f"type=volume,source={volume},target=/var/lib/postgresql/data",
            "--mount",
            f"type=volume,source={tablespace_volume},target=/var/lib/postgresql/tablespaces",
            "--mount",
            f"type=bind,source={bootstrap_secret},target=/run/chenyida-erp-secrets/postgres-bootstrap-password,readonly",
            image,
        ]
    )
    docker(arguments, "POSTGRES_CONTAINER_CREATE_FAILED")
    resources.container = name
    resources.assert_single_container()
    docker(["container", "start", name], "POSTGRES_CONTAINER_START_FAILED")
    inspect = wait_running(name, healthy=True, timeout=90)
    assert_runtime_contract(contract, inspect, networks, resources.reader_gid)
    docker(
        [
            "container",
            "exec",
            name,
            "psql",
            "-U",
            "postgres",
            "-d",
            "chenyida_erp",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            "create tablespace runtime_policy_ts location '/var/lib/postgresql/tablespaces/runtime_policy_ts'",
            "-c",
            "create table runtime_policy_probe(id integer primary key) tablespace runtime_policy_ts; insert into runtime_policy_probe values (1);",
        ],
        "POSTGRES_SQL_PROBE_FAILED",
    )
    try:
        tablespace_children = list(approved_tablespace.iterdir())
    except OSError:
        fail("POSTGRES_TABLESPACE_CHILD_INSPECTION_FAILED")
    if (
        len(tablespace_children) != 1
        or not tablespace_children[0].is_dir()
        or not re.fullmatch(r"PG_[0-9]+_[0-9]+", tablespace_children[0].name)
    ):
        fail("POSTGRES_TABLESPACE_CHILD_NOT_USED")
    tablespace_child = tablespace_children[0]
    child_identity = directory_identity(tablespace_child, "POSTGRES_TABLESPACE_CHILD_METADATA_INVALID")
    if (
        directory_identity(tablespace_root, "TABLESPACE_NAMESPACE_METADATA_INVALID") != tablespace_root_identity
        or directory_identity(approved_tablespace, "TABLESPACE_ENTRY_METADATA_INVALID") != approved_tablespace_identity
        or child_identity[2:] != (999, 999, 0o700)
    ):
        fail("POSTGRES_TABLESPACE_METADATA_INVALID")
    docker(
        [
            "container",
            "exec",
            name,
            "sh",
            "-eu",
            "-c",
            "if touch /.chenyida-runtime-rootfs-probe 2>/dev/null; then rm /.chenyida-runtime-rootfs-probe; exit 41; fi; "
            "if ! touch /tmp/chenyida-runtime-policy-probe; then exit 42; fi; "
            "rm /tmp/chenyida-runtime-policy-probe; "
            "if ! touch /var/lib/postgresql/data/.chenyida-runtime-policy-probe; then exit 43; fi; "
            "rm /var/lib/postgresql/data/.chenyida-runtime-policy-probe; "
            "if touch /var/lib/postgresql/tablespaces/.chenyida-runtime-policy-probe 2>/dev/null; then rm /var/lib/postgresql/tablespaces/.chenyida-runtime-policy-probe; exit 44; fi; "
            "test -r /run/chenyida-erp-secrets/postgres-bootstrap-password || exit 45; "
            "for sibling in admin-database-password admin-password migration-database-password web-database-password worker-database-password; do test ! -e /run/chenyida-erp-secrets/$sibling || exit 46; done; "
            "test \"$(stat -c '%u:%g:%a' /run/chenyida-erp-secrets)\" = '0:0:555' || exit 47; "
            "test \"$(stat -c '%u:%g:%a' /run/chenyida-erp-secrets/postgres-bootstrap-password)\" = '0:999:440' || exit 48; "
            "if { printf x >> /run/chenyida-erp-secrets/postgres-bootstrap-password; } 2>/dev/null; then exit 49; fi",
        ],
        "POSTGRES_FILESYSTEM_PROBE_FAILED",
        exit_codes={
            41: "POSTGRES_ROOTFS_WRITE_SUCCEEDED",
            42: "POSTGRES_TMPFS_WRITE_FAILED",
            43: "POSTGRES_DATA_VOLUME_WRITE_FAILED",
            44: "POSTGRES_TABLESPACE_NAMESPACE_WRITE_SUCCEEDED",
            45: "POSTGRES_BOOTSTRAP_SECRET_UNREADABLE",
            46: "POSTGRES_SIBLING_SECRET_VISIBLE",
            47: "POSTGRES_SECRET_DIRECTORY_METADATA_MISMATCH",
            48: "POSTGRES_BOOTSTRAP_SECRET_METADATA_MISMATCH",
            49: "POSTGRES_BOOTSTRAP_SECRET_WRITE_SUCCEEDED",
        },
    )
    docker(["container", "restart", "--time", "5", name], "POSTGRES_WARM_RESTART_FAILED")
    inspect = wait_running(name, healthy=True, timeout=90)
    assert_runtime_contract(contract, inspect, networks, resources.reader_gid)
    count = docker(
        [
            "container",
            "exec",
            name,
            "psql",
            "-U",
            "postgres",
            "-d",
            "chenyida_erp",
            "-Atqc",
            "select count(*) from runtime_policy_probe",
        ],
        "POSTGRES_WARM_DATA_PROBE_FAILED",
    )
    if count != "1":
        fail("POSTGRES_WARM_DATA_COUNT_MISMATCH")
    if (
        directory_identity(tablespace_root, "POSTGRES_WARM_TABLESPACE_MISSING") != tablespace_root_identity
        or directory_identity(approved_tablespace, "POSTGRES_WARM_TABLESPACE_MISSING") != approved_tablespace_identity
        or directory_identity(tablespace_child, "POSTGRES_WARM_TABLESPACE_MISSING") != child_identity
    ):
        fail("POSTGRES_WARM_TABLESPACE_IDENTITY_CHANGED")
    docker(["container", "stop", "--time", "5", name], "POSTGRES_CONTAINER_STOP_FAILED")
    resources.remove_container()


def volume_nonempty(name: str) -> bool:
    mountpoint = task_volume_mountpoint(name)
    try:
        with os.scandir(mountpoint) as entries:
            return next(entries, None) is not None
    except OSError:
        fail("VOLUME_CONTENT_PROBE_FAILED")


def run_caddy(resources: IsolatedResources, contract: dict[str, Any], image: str, project_root: Path) -> None:
    name, arguments, networks = common_create_arguments(resources, contract, "caddy")
    data = resources.create_volume("caddy-data")
    config = resources.create_volume("caddy-config")
    arguments.extend(
        [
            "--env",
            "ERP_DOMAIN=localhost",
            "--env",
            "ERP_HTTPS_PORT=443",
            "--mount",
            f"type=bind,source={project_root / 'deploy' / 'Caddyfile'},target=/etc/caddy/Caddyfile,readonly",
            "--mount",
            f"type=volume,source={data},target=/data",
            "--mount",
            f"type=volume,source={config},target=/config",
            image,
        ]
    )
    docker(arguments, "CADDY_CONTAINER_CREATE_FAILED")
    resources.container = name
    resources.assert_single_container()
    docker(["container", "start", name], "CADDY_CONTAINER_START_FAILED")
    inspect = wait_running(name)
    time.sleep(1)
    inspect = wait_running(name)
    assert_runtime_contract(contract, inspect, networks, resources.reader_gid)
    tcp, udp = listener_ports(inspect["State"]["Pid"])
    if not {80, 443}.issubset(tcp) or 443 not in udp:
        fail("CADDY_LISTENER_POLICY_MISMATCH")
    docker(["container", "restart", "--time", "5", name], "CADDY_WARM_RESTART_FAILED")
    inspect = wait_running(name)
    time.sleep(1)
    inspect = wait_running(name)
    assert_runtime_contract(contract, inspect, networks, resources.reader_gid)
    tcp, udp = listener_ports(inspect["State"]["Pid"])
    if not {80, 443}.issubset(tcp) or 443 not in udp:
        fail("CADDY_WARM_LISTENER_POLICY_MISMATCH")
    docker(["container", "stop", "--time", "5", name], "CADDY_CONTAINER_STOP_FAILED")
    resources.remove_container()
    if not volume_nonempty(data) or not volume_nonempty(config):
        fail("CADDY_WRITABLE_VOLUME_PROBE_FAILED")


def preflight(policy: dict[str, Any], web_image: str, worker_image: str, web_config: str, worker_config: str) -> None:
    inventories = {
        "CONTAINER": docker(["ps", "-aq", "--filter", f"label={LABEL}"], "TASK_CONTAINER_INVENTORY_FAILED"),
        "VOLUME": docker(["volume", "ls", "-q", "--filter", f"label={LABEL}"], "TASK_VOLUME_INVENTORY_FAILED"),
        "NETWORK": docker(["network", "ls", "-q", "--filter", f"label={LABEL}"], "TASK_NETWORK_INVENTORY_FAILED"),
    }
    for resource, existing in inventories.items():
        if existing:
            fail(f"PREEXISTING_RUNTIME_POLICY_{resource}")
    version = docker(["version", "--format", "{{.Server.Version}}"], "ENGINE_VERSION_DISCOVERY_FAILED")
    if version != policy["parser"]["docker_engine_version"]:
        fail("ENGINE_VERSION_MISMATCH")
    contracts = {service["service"]: service for service in policy["services"]}
    inspect_image(web_image, web_config, contracts["web"]["image_declared_volumes"], contracts["web"]["image_environment_keys"])
    inspect_image(worker_image, worker_config, contracts["worker"]["image_declared_volumes"], contracts["worker"]["image_environment_keys"])
    inspect_image(contracts["postgres"]["image"]["reference"], None, contracts["postgres"]["image_declared_volumes"], contracts["postgres"]["image_environment_keys"])
    inspect_image(contracts["caddy"]["image"]["reference"], None, contracts["caddy"]["image_declared_volumes"], contracts["caddy"]["image_environment_keys"])


def parse_arguments(argv: list[str]) -> argparse.Namespace:
    parser = runtime_policy.SafeArgumentParser(add_help=False)
    parser.add_argument("--policy", required=True)
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--web-image", required=True)
    parser.add_argument("--worker-image", required=True)
    parser.add_argument("--web-config-digest", required=True)
    parser.add_argument("--worker-config-digest", required=True)
    parser.add_argument("--reader-gid", required=True)
    return parser.parse_args(argv)


def run(argv: list[str]) -> int:
    resources: IsolatedResources | None = None
    failure_code: str | None = None
    success_digest: str | None = None
    try:
        arguments = parse_arguments(argv)
        project_root = Path(arguments.project_root)
        policy, digest = runtime_policy.load_policy(Path(arguments.policy), project_root)
        if not runtime_policy.IMAGE_DIGEST_RE.fullmatch(arguments.web_image) or not runtime_policy.IMAGE_DIGEST_RE.fullmatch(
            arguments.worker_image
        ):
            fail("IMAGE_REFERENCE_INVALID")
        if not runtime_policy.SHA256_RE.fullmatch(arguments.web_config_digest) or not runtime_policy.SHA256_RE.fullmatch(
            arguments.worker_config_digest
        ):
            fail("IMAGE_CONFIG_DIGEST_INVALID")
        if not re.fullmatch(r"[1-9][0-9]{0,9}", arguments.reader_gid):
            fail("READER_GID_INVALID")
        reader_gid = int(arguments.reader_gid)
        preflight(
            policy,
            arguments.web_image,
            arguments.worker_image,
            arguments.web_config_digest,
            arguments.worker_config_digest,
        )
        resources = IsolatedResources(reader_gid)
        resources.create_networks()
        contracts = {service["service"]: service for service in policy["services"]}
        run_candidate_service(resources, contracts["admin"], "admin", arguments.worker_image)
        run_candidate_service(resources, contracts["migrate"], "migrate", arguments.worker_image)
        run_candidate_service(resources, contracts["web"], "web", arguments.web_image)
        run_candidate_service(resources, contracts["worker"], "worker", arguments.worker_image)
        run_postgres(resources, contracts["postgres"], contracts["postgres"]["image"]["reference"])
        run_caddy(resources, contracts["caddy"], contracts["caddy"]["image"]["reference"], project_root.resolve())
        temporary = resources.temporary
        if not resources.cleanup():
            fail("RUNTIME_POLICY_CLEANUP_FAILED")
        resources = None
        if temporary.exists():
            fail("RESIDUAL_RUNTIME_POLICY_DIRECTORY")
        inventories = {
            "CONTAINER": docker(["ps", "-aq", "--filter", f"label={LABEL}"], "TASK_CONTAINER_INVENTORY_FAILED"),
            "VOLUME": docker(["volume", "ls", "-q", "--filter", f"label={LABEL}"], "TASK_VOLUME_INVENTORY_FAILED"),
            "NETWORK": docker(["network", "ls", "-q", "--filter", f"label={LABEL}"], "TASK_NETWORK_INVENTORY_FAILED"),
        }
        for resource, remaining in inventories.items():
            if remaining:
                fail(f"RESIDUAL_RUNTIME_POLICY_{resource}")
        success_digest = digest
    except (RuntimeTestError, runtime_policy.PolicyError) as error:
        failure_code = error.code
    except (OSError, ValueError):
        failure_code = "IO_OR_VALUE_ERROR"
    except Exception:
        failure_code = "INTERNAL_ERROR"
    finally:
        if resources is not None and not resources.cleanup():
            failure_code = "RUNTIME_POLICY_CLEANUP_FAILED"
    if failure_code is not None:
        print(f"CONTAINER_RUNTIME_POLICY_TEST_FAILED:{failure_code}", file=sys.stderr)
        return 1
    if success_digest is None:
        print("CONTAINER_RUNTIME_POLICY_TEST_FAILED:INTERNAL_ERROR", file=sys.stderr)
        return 1
    print(f"CONTAINER_RUNTIME_POLICY_TEST_OK services=6 policy_sha256={success_digest} max_containers=1")
    return 0


if __name__ == "__main__":
    def interrupted(_: int, __: Any) -> None:
        raise RuntimeTestError("INTERRUPTED")

    for signal_number in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
        signal.signal(signal_number, interrupted)
    raise SystemExit(run(sys.argv[1:]))
