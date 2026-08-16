import copy
import fcntl
import hashlib
import importlib.util
import json
import os
import shutil
import stat
import subprocess
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


SITE_ROOT = Path(__file__).resolve().parents[1]
ADAPTER_SOURCE = SITE_ROOT / "scripts/uat-promotion-rollback-runtime-adapter.py"
FIXED_EXECUTOR_SOURCE = SITE_ROOT / "scripts/uat-promotion-rollback-fixed-executor.py"
ACTIVATION_PATH = "/var/lib/chenyida-erp-release-supervisor/uat-rollback-runtime-adapter/activation-v2.json"
CURRENT_PATH = "/var/lib/chenyida-erp-release-supervisor/uat-rollback-runtime-adapter/current-v2.json"
EXECUTOR_PATH = "/usr/local/libexec/chenyida-erp-uat-rollback-executor-v1"
DOCKER_PATH = "/usr/bin/docker"
COMPOSE_PLUGIN_PATH = "/usr/libexec/docker/cli-plugins/docker-compose"
LOCK_PATH = "/run/lock/chenyida-erp-release-gate-v1.lock"


def load_adapter():
    spec = importlib.util.spec_from_file_location("uat_rollback_runtime_adapter", ADAPTER_SOURCE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ADAPTER = load_adapter()
ROLES = (
    "snapshot_readiness", "snapshot_manifest", "snapshot_migrations", "snapshot_reconciliation",
    "snapshot_postgresql", "snapshot_uploads", "snapshot_attachments", "snapshot_backup_status",
    "snapshot_policy", "snapshot_policy_activation", "snapshot_runtime_privilege_access",
    "snapshot_runtime_privilege_compiled_catalog", "snapshot_runtime_privilege_policy",
    "snapshot_runtime_privilege_operator_policy", "predecessor_postdeploy_receipt",
    "predecessor_release_manifest", "candidate_deployment_result", "candidate_postdeploy_identity",
    "compose_file", "compose_release_file", "deployment_environment", "runtime_policy",
    "runtime_adapter_activation",
)
STAGES = (
    "PRECONDITION_RECHECK", "WRITER_CONTAINMENT", "POSTGRESQL_RESTORE", "UPLOADS_RESTORE",
    "ATTACHMENTS_RESTORE", "BACKUP_STATUS_RESTORE", "RUNTIME_CONFIGURATION_RESTORE",
    "WEB_WORKER_PREDECESSOR_ACTIVATION", "PROTECTED_RESOURCE_RECHECK",
)
CHECKS = (
    "POSTGRESQL_CONTENT", "UPLOADS_CONTENT", "ATTACHMENTS_CONTENT", "BACKUP_STATUS_CONTENT",
    "MIGRATION_HEAD", "CADDY_IDENTITY", "POSTGRES_IDENTITY", "WEB_IDENTITY", "WORKER_IDENTITY",
    "RUNTIME_CONFIGURATION", "STRICT_RELEASE_IDENTITY", "HEALTH", "PROTECTED_RESOURCES",
)
EXECUTOR_CATALOG_SHA256 = "f788b9eef1d677535e0a907504ff10c56e60d7007b7e62f4dc3a01561b4384a1"
UNAVAILABLE_CAPABILITIES = sorted({
    "WRITER_CONTAINMENT", "POSTGRESQL_RESTORE", "UPLOADS_RESTORE",
    "ATTACHMENTS_RESTORE", "BACKUP_STATUS_RESTORE",
    "WEB_WORKER_PREDECESSOR_ACTIVATION", "POSTGRESQL_CONTENT",
    "UPLOADS_CONTENT", "ATTACHMENTS_CONTENT", "BACKUP_STATUS_CONTENT",
    "MIGRATION_HEAD", "CADDY_IDENTITY", "POSTGRES_IDENTITY", "WEB_IDENTITY",
    "WORKER_IDENTITY", "STRICT_RELEASE_IDENTITY", "HEALTH",
})


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha_bytes(value):
    return hashlib.sha256(value).hexdigest()


def sha(value):
    return sha_bytes(canonical(value))


def timestamp(value):
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def without(value, field):
    return {key: item for key, item in value.items() if key != field}


def derive_targets(operation_id):
    token = sha({
        "contract": "chenyida-erp-uat-promotion-rollback-target-derivation/v1",
        "operation_id": operation_id,
    })[:16]
    return {
        "database": {
            "active": "chenyida_erp",
            "staging": f"chenyida_erp_rb_{token}",
            "candidate_quarantine": f"chenyida_erp_candidate_{token}",
        },
        "volumes": {
            domain: {
                "target": f"chenyida-erp_erp_{domain}_rb_{token}",
                "utility_container": f"chenyida-erp-rollback-{domain.replace('_', '-')}-{token}",
            }
            for domain in ("uploads", "attachments", "backup_status")
        },
        "rollback_postdeploy_run_id": f"rollback-{token}",
    }


EXECUTOR_TEMPLATE = r'''#!/usr/bin/python3
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone

MODE = __MODE__
PID_FILE = __PID_FILE__

def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()

def sha(value):
    return hashlib.sha256(canonical(value)).hexdigest()

def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

if MODE == "NO_READ_TERM_RESISTANT":
    child = subprocess.Popen([
        "/usr/bin/python3", "-c",
        "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)",
    ])
    with open(PID_FILE, "w", encoding="utf-8") as handle:
        handle.write(str(child.pid))
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    time.sleep(60)
request = json.load(sys.stdin)
manifest_fd = int(os.environ["CHENYIDA_ERP_ROLLBACK_TRUSTED_FD_MANIFEST_FD"])
manifest_raw = bytearray()
while True:
    chunk = os.read(manifest_fd, 65536)
    if not chunk:
        break
    manifest_raw.extend(chunk)
fd_manifest = json.loads(manifest_raw)
manifest_body = {key: value for key, value in fd_manifest.items() if key != "manifest_sha256"}
if fd_manifest.get("schema_version") != 3 \
        or fd_manifest.get("contract") != "chenyida-erp-uat-promotion-rollback-trusted-fd-manifest/v3" \
        or fd_manifest.get("manifest_sha256") != sha(manifest_body) \
        or fd_manifest.get("executor", {}).get("path") != sys.argv[0] \
        or sorted(fd_manifest.get("sources", {})) != sorted(request["source_roles"]):
    raise SystemExit(90)
for item in [fd_manifest["executor"], fd_manifest["docker"], fd_manifest["compose_plugin"],
             *fd_manifest["activation_chain"].values(), *fd_manifest["sources"].values()]:
    with open(item["path"], "rb") as trusted_handle:
        if hashlib.sha256(trusted_handle.read()).hexdigest() != item["sha256"]:
            raise SystemExit(91)

def swap_named_path_back(fd_path, mode):
    physical_path = os.readlink(fd_path)
    preserved_path = physical_path + ".preserved"
    with open(fd_path, "rb") as trusted_handle:
        trusted_bytes = trusted_handle.read()
    os.replace(physical_path, preserved_path)
    with open(physical_path, "wb") as substituted:
        substituted.write(b"substituted-after-trusted-open")
    with open(physical_path, "wb") as restored_bytes:
        restored_bytes.write(trusted_bytes)
    os.chmod(physical_path, mode)
    with open(fd_path, "rb") as trusted_handle:
        if trusted_handle.read() != trusted_bytes:
            raise SystemExit(92)
    os.unlink(preserved_path)

if MODE == "SWAP_SOURCE_BACK":
    swap_named_path_back(fd_manifest["sources"]["snapshot_uploads"]["path"], 0o400)
if MODE == "SWAP_EXECUTOR_BACK":
    swap_named_path_back(fd_manifest["executor"]["path"], 0o555)
if MODE == "SWAP_DOCKER_BACK":
    swap_named_path_back(fd_manifest["docker"]["path"], 0o755)
if MODE == "SWAP_COMPOSE_PLUGIN_BACK":
    swap_named_path_back(fd_manifest["compose_plugin"]["path"], 0o755)
if MODE in {"LEADER_EXIT_WITH_CHILD", "DETACHED_DAEMON"}:
    child = subprocess.Popen(
        ["/usr/bin/python3", "-c", "import time; time.sleep(60)"],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=MODE == "DETACHED_DAEMON",
    )
    with open(PID_FILE, "w", encoding="utf-8") as handle:
        handle.write(str(child.pid))
if MODE == "SLOW":
    child = subprocess.Popen(["/usr/bin/python3", "-c", "import time; time.sleep(60)"])
    with open(PID_FILE, "w", encoding="utf-8") as handle:
        handle.write(str(child.pid))
    time.sleep(60)
if MODE == "OVERSIZE":
    os.write(1, b"x" * (4 * 1024 * 1024 + 1))
    time.sleep(60)
package = request["payload"]["execution_package"]
with open(fd_manifest["sources"]["runtime_adapter_activation"]["path"], encoding="utf-8") as handle:
    runtime_plan = json.load(handle)["plan"]
status = {
    "PREFLIGHT": "PARTIAL_OR_UNKNOWN_REQUIRES_CONTAINMENT"
        if request["execution_mode"] == "RECOVERY" else "SAFE_TO_EXECUTE",
    "RECHECK": "PARTIAL_OR_UNKNOWN_REQUIRES_CONTAINMENT"
        if request["execution_mode"] == "RECOVERY" else "SAFE_TO_EXECUTE",
    "PREPARE": "PREPARED",
    "EXECUTE": "COMMITTED",
    "PROBE": "COMMITTED" if request["operation"] == "ROLLBACK_EXECUTION" else "VERIFIED",
    "CONTAIN": "CONTAINED",
}[request["action"]]
if MODE == "STALE_CONTAINMENT" and request["action"] == "CONTAIN":
    status = "STALE_INTENT"
output = {"fixture": "OK"}
if request["action"] in {"PREFLIGHT", "RECHECK"} \
        or MODE == "STALE_CONTAINMENT" and request["action"] == "CONTAIN":
    deployment = {
        "class": "UAT", "id": "chenyida-erp", "compose_project": package["compose_project"],
        "compose_project_root": package["compose_project_root"], "database": package["database"],
    }
    token = sha({
        "contract": "chenyida-erp-uat-promotion-rollback-target-derivation/v1",
        "operation_id": request["operation_id"],
    })[:16]
    services = {
        service: {
            "service": service,
            "container_id": hashlib.sha256(f"container:{service}".encode()).hexdigest(),
            "image_reference": f"registry.example.com/chenyida/{service}@sha256:{hashlib.sha256(f'ref:{service}'.encode()).hexdigest()}",
            "image_digest": f"sha256:{hashlib.sha256(f'image:{service}'.encode()).hexdigest()}",
            "running": True, "health": "none" if service == "caddy" else "healthy",
            "restart_count": 0, "oom_killed": False,
        }
        for service in ("caddy", "postgres", "web", "worker")
    }
    volumes = runtime_plan["candidate"]["volumes"]
    writer_members = [
        {
            "writer_key": service,
            "service": service,
            "container_id": services[service]["container_id"],
            "running": True,
            "unexpected": False,
        }
        for service in ("web", "worker")
    ]
    writer_identity_set = [
        {key: value for key, value in member.items() if key != "running"}
        for member in writer_members
    ]
    observation = {
        "schema_version": 1,
        "contract": "chenyida-erp-uat-promotion-rollback-runtime-observation/v1",
        "active_generation": "CANDIDATE",
        "database": {
            **package["database"],
            "allow_connections": True, "writer_sessions": 0, "sealed": False,
        },
        "services": services,
        "writer_inventory": {
            "discovery_scope": "COMPOSE_PROJECT_COMPLETE_WRITER_SET",
            "discovery_complete": True,
            "members": writer_members,
            "writer_set_sha256": sha(writer_identity_set),
            "active_writer_count": 2,
            "unexpected_writer_count": 0,
        },
        "volumes": volumes,
        "retained_candidate_volumes": {
            domain: {**volume, "present": True}
            for domain, volume in volumes.items()
        },
        "derived_targets": {
            "database": {
                "staging": {"name": f"chenyida_erp_rb_{token}", "present": False, "oid": None},
                "candidate_quarantine": {
                    "name": f"chenyida_erp_candidate_{token}", "present": False, "oid": None,
                },
            },
            "volumes": {
                domain: {
                    "target": {
                        "name": f"chenyida-erp_erp_{domain}_rb_{token}",
                        "present": False, "identity_sha256": None,
                    },
                    "utility_container": {
                        "name": f"chenyida-erp-rollback-{domain.replace('_', '-')}-{token}",
                        "present": False, "container_id": None,
                    },
                }
                for domain in ("uploads", "attachments", "backup_status")
            },
        },
        "protected_resources_sha256": package["protected_resources_sha256"],
    }
    if MODE == "CONFLICTING_WRITER_SERVICE_ID" \
            or MODE == "STALE_CONTAINMENT" and request["action"] == "CONTAIN":
        observation["writer_inventory"]["members"].append({
            "writer_key": "shadow-writer",
            "service": "shadow-writer",
            "container_id": services["caddy"]["container_id"]
                if MODE == "CONFLICTING_WRITER_SERVICE_ID"
                else hashlib.sha256(b"stale-containment-shadow-writer").hexdigest(),
            "running": True,
            "unexpected": True,
        })
        observation["writer_inventory"]["members"].sort(key=lambda item: item["writer_key"])
        observation["writer_inventory"]["writer_set_sha256"] = sha([
            {key: value for key, value in member.items() if key != "running"}
            for member in observation["writer_inventory"]["members"]
        ])
        observation["writer_inventory"]["active_writer_count"] += 1
        observation["writer_inventory"]["unexpected_writer_count"] = 1
    observation["observation_sha256"] = sha(observation)
    if request["action"] == "CONTAIN":
        output = {"observed": observation}
    else:
        output = {
            "result": "ROLLBACK_RUNTIME_PREFLIGHT_PASSED" if request["action"] == "PREFLIGHT"
                else "ROLLBACK_RUNTIME_RECHECK_PASSED",
            "execution_package_sha256": package["package_sha256"],
            "source_set_sha256": package["source_set_sha256"],
            "runtime_plan_sha256": package["runtime_plan_sha256"],
            "runtime_activation_source_sha256": package["sources"]["runtime_adapter_activation"]["sha256"],
            "executor_sha256": hashlib.sha256(open(__file__, "rb").read()).hexdigest(),
            "deployment_identity_sha256": sha(deployment),
            "protected_resources_sha256": package["protected_resources_sha256"],
            "target_state": status, "observed": observation,
        }
observed = now()
body = {
    "schema_version": 1,
    "contract": "chenyida-erp-uat-promotion-rollback-runtime-response/v1",
    "action": request["action"], "operation": request["operation"],
    "operation_id": request["operation_id"], "label": request["label"],
    "request_sha256": request["request_sha256"],
    "runtime_plan_sha256": request["runtime_plan_sha256"],
    "activation_receipt_sha256": fd_manifest["activation"]["receipt_sha256"],
    "descriptor_manifest_sha256": fd_manifest["manifest_sha256"],
    "handler_id": fd_manifest["handler_id"],
    "idempotency_key": fd_manifest["idempotency_key"],
    "status": status, "started_at": observed, "completed_at": observed, "output": output,
}
body["output_sha256"] = sha(output)
body["response_sha256"] = sha(body)
sys.stdout.buffer.write(canonical(body))
'''


def actual_volume_document(domain):
    name = f"chenyida-erp_erp_{domain}"
    index = {"uploads": 1, "attachments": 2, "backup_status": 3}[domain]
    return {
        "CreatedAt": f"2026-08-16T02:03:0{index}.123456789Z",
        "Driver": "local", "Labels": None,
        "Mountpoint": f"/var/lib/docker/volumes/{name}/_data",
        "Name": name, "Options": None, "Scope": "local",
    }


def actual_volume_identity(domain):
    value = actual_volume_document(domain)
    projection = {
        "name": value["Name"], "driver": value["Driver"], "scope": value["Scope"],
        "mountpoint": value["Mountpoint"], "created_at": value["CreatedAt"],
        "labels": {}, "options": {},
    }
    return sha(projection)


ACTUAL_DOCKER_TEMPLATE = r'''#!/usr/bin/python3
import hashlib
import json
import sys

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def emit(value):
    sys.stdout.write(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n")

services = ("caddy", "postgres", "web", "worker")
by_service = {service: {
    "container_id": digest(f"container:{service}"),
    "image_reference": f"registry.example.com/chenyida/{service}@sha256:{digest(f'ref:{service}')}",
    "image_digest": f"sha256:{digest(f'image:{service}')}",
} for service in services}
by_id = {item["container_id"]: (service, item) for service, item in by_service.items()}
arguments = sys.argv[1:]

if arguments and arguments[0] == "ps":
    if any(item == "label=com.docker.compose.project=chenyida-erp" for item in arguments):
        sys.stdout.write("\n".join(sorted(by_id)) + "\n")
    raise SystemExit(0)

if arguments[:3] == ["inspect", "--type", "container"]:
    identifiers = arguments[arguments.index("--") + 1:]
    for identifier in identifiers:
        service, item = by_id[identifier]
        networks = {
            "caddy": {"chenyida-erp_edge": {}},
            "postgres": {"chenyida-erp_backend": {}},
            "web": {"chenyida-erp_backend": {}, "chenyida-erp_edge": {}},
            "worker": {"chenyida-erp_backend": {}},
        }[service]
        mounts = []
        if service in {"web", "worker"}:
            for domain, destination in (
                ("uploads", "/data/chenyida-erp/uploads"),
                ("attachments", "/data/chenyida-erp/attachments"),
            ):
                mounts.append({
                    "Type": "volume", "Name": f"chenyida-erp_erp_{domain}",
                    "Destination": destination, "RW": True,
                })
        if service == "web":
            mounts.append({
                "Type": "volume", "Name": "chenyida-erp_erp_backup_status",
                "Destination": "/data/chenyida-erp/backup-status", "RW": False,
            })
        emit([
            identifier, f"/chenyida-erp-{service}-1", item["image_digest"],
            item["image_reference"], {
                "com.docker.compose.project": "chenyida-erp",
                "com.docker.compose.service": service,
            }, "running", None if service == "caddy" else {"Status": "healthy"},
            0, False, mounts, networks, "65532:65532", True, ["ALL"], None,
            ["no-new-privileges:true"], next(iter(networks)),
        ])
    raise SystemExit(0)

if arguments[:2] == ["volume", "ls"]:
    selected = next(item for item in arguments if item.startswith("name=^"))[6:-1]
    if selected in {
        "chenyida-erp_erp_uploads", "chenyida-erp_erp_attachments",
        "chenyida-erp_erp_backup_status",
    }:
        sys.stdout.write(selected + "\n")
    raise SystemExit(0)

if arguments[:2] == ["volume", "inspect"]:
    name = arguments[-1]
    domain = name.removeprefix("chenyida-erp_erp_")
    index = {"uploads": 1, "attachments": 2, "backup_status": 3}[domain]
    emit({
        "CreatedAt": f"2026-08-16T02:03:0{index}.123456789Z",
        "Driver": "local", "Labels": None,
        "Mountpoint": f"/var/lib/docker/volumes/{name}/_data",
        "Name": name, "Options": None, "Scope": "local",
    })
    raise SystemExit(0)

if arguments and arguments[0] == "exec":
    emit({
        "system_identifier": "7612345678901234567",
        "databases": [{
            "name": "chenyida_erp", "oid": "16384",
            "marker": "chenyida-erp-deployment/v2:UAT:chenyida-erp",
            "allow_connections": True, "connection_limit": 64,
            "default_transaction_read_only": False,
            "writer_sessions": 0, "prepared_xacts": 0,
        }],
    })
    raise SystemExit(0)

raise SystemExit(97)
'''


class RuntimeAdapterFixture:
    def __init__(self, mode="NORMAL", *, expired_runtime=False):
        self.temporary = tempfile.TemporaryDirectory(prefix="uat-rollback-adapter-", dir="/tmp")
        self.root = Path(self.temporary.name)
        self.bundle_sha = hashlib.sha256(b"runtime-adapter-bundle").hexdigest()
        self.authorization_sha = hashlib.sha256(b"runtime-adapter-authorization").hexdigest()
        self.operation_id = "rollback-runtime-adapter-001"
        self.expired_runtime = expired_runtime
        self.logical_site = Path("/usr/local/libexec/chenyida-erp-release-supervisor/bundles") \
            / self.bundle_sha / "chenyida_erp_site"
        self.site = self.physical(str(self.logical_site))
        (self.site / "scripts").mkdir(parents=True)
        self.adapter = self.site / "scripts/uat-promotion-rollback-runtime-adapter.py"
        shutil.copyfile(ADAPTER_SOURCE, self.adapter)
        self.adapter.chmod(0o555)
        self.pid_file = self.root / "slow-grandchild.pid"
        self.executor = self.physical(EXECUTOR_PATH)
        self.executor.parent.mkdir(parents=True, exist_ok=True)
        if mode == "ACTUAL_FIXED_EXECUTOR":
            shutil.copyfile(FIXED_EXECUTOR_SOURCE, self.executor)
        else:
            executor_text = EXECUTOR_TEMPLATE.replace("__MODE__", repr(mode)).replace(
                "__PID_FILE__", repr(str(self.pid_file))
            )
            self.executor.write_text(executor_text, encoding="utf-8")
        self.executor.chmod(0o555)
        self.docker = self.physical(DOCKER_PATH)
        self.docker.parent.mkdir(parents=True, exist_ok=True)
        self.docker.write_text(
            ACTUAL_DOCKER_TEMPLATE if mode == "ACTUAL_FIXED_EXECUTOR"
            else "#!/bin/sh\nexit 99\n",
            encoding="utf-8",
        )
        self.docker.chmod(0o755)
        self.compose_plugin = self.physical(COMPOSE_PLUGIN_PATH)
        self.compose_plugin.parent.mkdir(parents=True, exist_ok=True)
        self.compose_plugin.write_text("#!/bin/sh\nexit 98\n", encoding="utf-8")
        self.compose_plugin.chmod(0o755)
        self.lock = self.physical(LOCK_PATH)
        self.lock.parent.mkdir(parents=True, exist_ok=True)
        self.lock.write_bytes(b"")
        self.lock.chmod(0o600)
        self.lock_fd = os.open(self.lock, os.O_RDWR)
        fcntl.flock(self.lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.request = self.build_request()

    def close(self):
        os.close(self.lock_fd)
        self.temporary.cleanup()

    def physical(self, logical):
        return self.root.joinpath(*Path(logical).parts[1:])

    def write_source(self, logical, raw):
        target = self.physical(logical)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        target.chmod(0o400)
        metadata = target.stat()
        return {
            "path": logical,
            "sha256": sha_bytes(raw),
            "bytes": len(raw),
            "device": str(metadata.st_dev),
            "inode": str(metadata.st_ino),
            "uid": 0,
            "gid": 0,
            "mode": "0400",
            "nlink": 1,
        }

    def build_request(self):
        now = datetime.now(timezone.utc)
        created = now - (timedelta(days=1, hours=1) if self.expired_runtime else timedelta(minutes=2))
        deadline = now - timedelta(days=1) if self.expired_runtime else now + timedelta(minutes=30)
        authorization_deadline = now + timedelta(minutes=5) if self.expired_runtime else deadline
        sources = {}
        artifacts = {
            "snapshot_postgresql": b"postgresql-dump-fixture",
            "snapshot_uploads": b"uploads-archive-fixture",
            "snapshot_attachments": b"attachments-archive-fixture",
            "snapshot_backup_status": b"backup-status-archive-fixture",
        }
        for role in ROLES:
            if role == "runtime_adapter_activation":
                continue
            raw = artifacts.get(role, f"runtime-adapter-source:{role}".encode())
            sources[role] = self.write_source(f"/var/lib/chenyida-erp/rollback-inputs/{role}", raw)
        snapshot_objects = {
            "postgresql": {
                "file": "postgresql.dump", "sha256": sources["snapshot_postgresql"]["sha256"],
                "bytes": sources["snapshot_postgresql"]["bytes"], "entries": None,
            },
            "uploads": {
                "file": "uploads.tar.gz", "sha256": sources["snapshot_uploads"]["sha256"],
                "bytes": sources["snapshot_uploads"]["bytes"], "entries": 2,
            },
            "attachments": {
                "file": "attachments.tar.gz", "sha256": sources["snapshot_attachments"]["sha256"],
                "bytes": sources["snapshot_attachments"]["bytes"], "entries": 3,
            },
            "backup_status": {
                "file": "backup-status.tar.gz", "sha256": sources["snapshot_backup_status"]["sha256"],
                "bytes": sources["snapshot_backup_status"]["bytes"], "entries": 4,
            },
        }
        predecessor = {
            "git_commit": "a" * 40, "git_tree": "b" * 40,
            "application_version": "0.1.0-alpha.47",
            "release_manifest_sha256": sources["predecessor_release_manifest"]["sha256"],
            "web_image": f"registry.example.com/chenyida/web@sha256:{'c' * 64}",
            "worker_image": f"registry.example.com/chenyida/worker@sha256:{'d' * 64}",
            "migration_head": "0047_runtime_adapter.sql",
            "migration_manifest_sha256": hashlib.sha256(b"migrations").hexdigest(),
            "runtime_configuration_sha256": hashlib.sha256(b"runtime-config").hexdigest(),
        }
        database = {
            "name": "chenyida_erp", "system_identifier": "7612345678901234567", "oid": "16384",
            "marker": "chenyida-erp-deployment/v2:UAT:chenyida-erp",
        }
        boundary = {
            "environment_restore": "EXACT_PREUPGRADE_SNAPSHOT_AND_PREDECESSOR_RUNTIME_ONLY",
            "posted_business_reversal": "NOT_PERFORMED_REQUIRES_SEPARATE_BUSINESS_AUTHORIZATION",
            "down_migration": False, "direct_sql_correction": False,
            "business_fact_deletion": False, "automatic_business_compensation": False,
        }
        protected = hashlib.sha256(b"protected-runtime").hexdigest()
        action_matrix = {
            "ROLLBACK_EXECUTION": {stage: ["PREPARE", "EXECUTE", "PROBE"] for stage in STAGES},
            "ROLLBACK_POSTVERIFY": {check: ["PREPARE", "PROBE"] for check in CHECKS},
            "RECOVERY": ["PREFLIGHT", "RECHECK", "PROBE", "CONTAIN"],
        }
        deployment = {
            "class": "UAT", "id": "chenyida-erp", "compose_project": "chenyida-erp",
            "compose_project_root": "/opt/erp/chenyida_erp_site", "database": database,
        }
        targets = derive_targets(self.operation_id)
        reconciliation_authority_body = {
            "schema_version": 1,
            "contract": "chenyida-erp-uat-promotion-rollback-reconciliation-authority/v1",
            "authority_id": "runtime-adapter-reconciliation-001",
            "status": "AUTHORIZED", "environment": "UAT",
            "promotion_id": "promotion-runtime-adapter-001", "promotion_generation": 1,
            "rollback_operation_id": self.operation_id, "deployment_id": "chenyida-erp",
            "approval_reference_sha256": hashlib.sha256(b"reconciliation-approval").hexdigest(),
            "requester_identity_sha256": hashlib.sha256(b"reconciliation-requester").hexdigest(),
            "approver_identity_sha256": hashlib.sha256(b"reconciliation-approver").hexdigest(),
            "approved_at": timestamp(created), "expires_at": timestamp(deadline), "one_time": True,
            "mutation_scope": {
                "active_database": targets["database"]["active"],
                "staging_database": targets["database"]["staging"],
                "candidate_quarantine_database": targets["database"]["candidate_quarantine"],
                "database_local_only": True, "allow_staging_database_create": True,
                "allow_staging_logical_restore": True,
                "allow_staging_privilege_reconcile": True,
                "allow_atomic_database_switch": True, "allow_active_database_unseal": True,
                "allow_role_create": False, "allow_role_alter": False,
                "allow_membership_change": False, "allow_password_change": False,
                "allow_tablespace_acl_change": False,
            },
        }
        reconciliation_authority = {
            **reconciliation_authority_body,
            "authority_sha256": sha(reconciliation_authority_body),
        }
        plan = {
            "schema_version": 3,
            "contract": "chenyida-erp-uat-promotion-rollback-runtime-plan/v3",
            "promotion_id": "promotion-runtime-adapter-001", "promotion_generation": 1,
            "rollback_operation_id": self.operation_id,
            "deployment": deployment,
            "candidate": {
                "services": {
                    service: {
                        "service": service,
                        "container_id": hashlib.sha256(f"container:{service}".encode()).hexdigest(),
                        "image_reference": f"registry.example.com/chenyida/{service}@sha256:{hashlib.sha256(f'ref:{service}'.encode()).hexdigest()}",
                        "image_digest": f"sha256:{hashlib.sha256(f'image:{service}'.encode()).hexdigest()}",
                    }
                    for service in ("caddy", "postgres", "web", "worker")
                },
                "volumes": {
                    domain: {
                        "domain": domain, "name": f"chenyida-erp_erp_{domain}",
                        "identity_sha256": actual_volume_identity(domain),
                    }
                    for domain in ("uploads", "attachments", "backup_status")
                },
                "protected_resources_sha256": protected,
            },
            "predecessor": {
                "release_manifest_sha256": predecessor["release_manifest_sha256"],
                "postdeploy_receipt_sha256": sources["predecessor_postdeploy_receipt"]["sha256"],
                "runtime_configuration_sha256": predecessor["runtime_configuration_sha256"],
                "web_image": predecessor["web_image"],
                "web_image_config_digest": f"sha256:{'6' * 64}",
                "worker_image": predecessor["worker_image"],
                "worker_image_config_digest": f"sha256:{'7' * 64}",
            },
            "targets": targets,
            "reconciliation_authority": reconciliation_authority,
            "toolchain": {
                "executor": {
                    "path": EXECUTOR_PATH, "sha256": sha_bytes(self.executor.read_bytes()),
                    "uid": 0, "gid": 0, "mode": "0555",
                },
                "docker": {
                    "path": DOCKER_PATH, "sha256": sha_bytes(self.docker.read_bytes()),
                    "uid": 0, "gid": 0, "mode": "0755",
                },
                "compose_plugin": {
                    "path": COMPOSE_PLUGIN_PATH,
                    "sha256": sha_bytes(self.compose_plugin.read_bytes()),
                    "uid": 0, "gid": 0, "mode": "0755",
                },
            },
            "helpers": {
                "volume_restore": {
                    "image_reference": f"registry.example.com/chenyida/volume-helper@sha256:{'e' * 64}",
                    "image_config_digest": f"sha256:{'f' * 64}",
                    "application_version": "0.1.0-alpha.47",
                    "git_commit": "1" * 40,
                    "git_tree": "2" * 40,
                    "image_role": "volume-restore-helper",
                    "platform": "linux/amd64",
                    "protocol": "chenyida-erp-volume-helper/v1",
                    "contract_sha256":
                        "143071fae30de9f0f4c04dff1df17d5d42fd8bfaa967ca0e70836d5ffd1ffb8d",
                    "evidence_run_id": "helper-evidence-fixture",
                    "backup_status_reader_gid": 1000,
                    "build_provenance_sha256": sha("helper-build-provenance"),
                    "sbom_evidence_sha256": sha("helper-sbom-evidence"),
                    "security_evidence_sha256": sha("helper-security-evidence"),
                    "supervisor_bundle_sha256": self.bundle_sha,
                },
            },
            "timeouts": {
                "PREFLIGHT": 120, "RECHECK": 120, "PREPARE": 120,
                "EXECUTE": 1800, "PROBE": 300, "CONTAIN": 300,
            },
            "max_output_bytes": 4 * 1024 * 1024,
            "source_bindings": {
                "snapshot_objects_sha256": sha(snapshot_objects),
                "snapshot_reconciliation_sha256": sources["snapshot_reconciliation"]["sha256"],
                "deployment_environment_sha256": sources["deployment_environment"]["sha256"],
                "snapshot_manifest_sha256": sources["snapshot_manifest"]["sha256"],
                "snapshot_policy_sha256": sources["snapshot_policy"]["sha256"],
                "runtime_privilege_access_sha256":
                    sources["snapshot_runtime_privilege_access"]["sha256"],
                "runtime_privilege_compiled_catalog_sha256":
                    sources["snapshot_runtime_privilege_compiled_catalog"]["sha256"],
                "runtime_privilege_policy_sha256":
                    sources["snapshot_runtime_privilege_policy"]["sha256"],
                "runtime_privilege_operator_policy_sha256":
                    sources["snapshot_runtime_privilege_operator_policy"]["sha256"],
                "compose_file_sha256": sources["compose_file"]["sha256"],
                "compose_release_file_sha256": sources["compose_release_file"]["sha256"],
                "runtime_policy_sha256": sources["runtime_policy"]["sha256"],
            },
            "action_matrix": action_matrix,
        }
        plan["runtime_plan_sha256"] = sha(plan)
        activation_id = "runtime-adapter-activation-001"
        approved_at = timestamp(created)
        expires_at = timestamp(deadline)
        intent_sha256 = hashlib.sha256(b"runtime-activation-intent").hexdigest()
        executor_sha256 = plan["toolchain"]["executor"]["sha256"]
        common = {
            "activation_id": activation_id, "generation": 1, "operation": "INSTALL",
            "approved_at": approved_at, "expires_at": expires_at,
            "requester_identity_sha256": hashlib.sha256(b"requester").hexdigest(),
            "approver_identity_sha256": hashlib.sha256(b"approver").hexdigest(),
            "supervisor_bundle_sha256": self.bundle_sha,
            "authorization_sha256": self.authorization_sha,
            "previous_activation_receipt_sha256": "0" * 64,
            "rollback_target_activation_receipt_sha256": "0" * 64,
            "executor_catalog_sha256": EXECUTOR_CATALOG_SHA256,
            "capability_status": "BLOCKED_MISSING_UAT_CAPABLE_HANDLERS",
            "unavailable_capabilities": UNAVAILABLE_CAPABILITIES,
            "executor_source_sha256": executor_sha256,
            "installed_executor_sha256": executor_sha256,
            "runtime_plan_sha256": plan["runtime_plan_sha256"],
        }
        history = {
            "schema_version": 2,
            "contract": "chenyida-erp-uat-promotion-rollback-runtime-activation-history/v2",
            "status": "COMMITTED", "activation_status": "BLOCKED_CAPABILITY_UNAVAILABLE",
            "activation_id": activation_id, "generation": 1, "operation": "INSTALL",
            "committed_at": approved_at, "intent_sha256": intent_sha256,
            "previous_activation_receipt_sha256": "0" * 64,
            "rollback_target_activation_receipt_sha256": "0" * 64,
            "supervisor_bundle_sha256": self.bundle_sha,
            "authorization_sha256": self.authorization_sha,
            "executor_catalog_sha256": EXECUTOR_CATALOG_SHA256,
            "capability_status": common["capability_status"],
            "unavailable_capabilities": UNAVAILABLE_CAPABILITIES,
            "installed_executor_sha256": executor_sha256,
            "runtime_plan_sha256": plan["runtime_plan_sha256"],
            "approved_at": approved_at, "expires_at": expires_at,
            "requester_identity_sha256": common["requester_identity_sha256"],
            "approver_identity_sha256": common["approver_identity_sha256"],
            "plan": plan,
        }
        history["history_sha256"] = sha(history)
        receipt = {
            "schema_version": 2,
            "contract": "chenyida-erp-uat-promotion-rollback-runtime-activation-receipt/v2",
            "status": "COMMITTED", "activation_status": "BLOCKED_CAPABILITY_UNAVAILABLE",
            "activation_id": activation_id, "generation": 1, "operation": "INSTALL",
            "committed_at": approved_at, "intent_sha256": intent_sha256,
            "history_sha256": history["history_sha256"],
            "previous_activation_receipt_sha256": "0" * 64,
            "rollback_target_activation_receipt_sha256": "0" * 64,
            "supervisor_bundle_sha256": self.bundle_sha,
            "authorization_sha256": self.authorization_sha,
            "executor_catalog_sha256": EXECUTOR_CATALOG_SHA256,
            "installed_executor_sha256": executor_sha256,
            "runtime_plan_sha256": plan["runtime_plan_sha256"],
            "expires_at": expires_at,
        }
        receipt["receipt_sha256"] = sha(receipt)
        current = {
            "schema_version": 2,
            "contract": "chenyida-erp-uat-promotion-rollback-runtime-activation-current/v2",
            "status": "BLOCKED_CAPABILITY_UNAVAILABLE", "activation_id": activation_id,
            "generation": 1, "history_sha256": history["history_sha256"],
            "receipt_sha256": receipt["receipt_sha256"],
            "executor_catalog_sha256": EXECUTOR_CATALOG_SHA256,
            "installed_executor_sha256": executor_sha256,
            "runtime_plan_sha256": plan["runtime_plan_sha256"], "expires_at": expires_at,
        }
        current["current_sha256"] = sha(current)
        ordinal = "0000000000000001"
        history_path = (
            "/var/lib/chenyida-erp-release-supervisor/uat-rollback-runtime-adapter/history/"
            f"{ordinal}.{history['history_sha256']}.json"
        )
        receipt_path = (
            "/var/lib/chenyida-erp-release-supervisor/uat-rollback-runtime-adapter/receipts/"
            f"{ordinal}.{receipt['receipt_sha256']}.json"
        )
        self.write_source(history_path, canonical(history))
        self.write_source(receipt_path, canonical(receipt))
        self.write_source(CURRENT_PATH, canonical(current))
        activation = {
            "schema_version": 2,
            "contract": "chenyida-erp-uat-promotion-rollback-runtime-activation/v2",
            "status": "BLOCKED_CAPABILITY_UNAVAILABLE",
            **common,
            "intent_sha256": intent_sha256,
            "history_sha256": history["history_sha256"], "history_file": history_path,
            "receipt_sha256": receipt["receipt_sha256"], "receipt_file": receipt_path,
            "current_sha256": current["current_sha256"], "current_file": CURRENT_PATH,
            "executor_file": EXECUTOR_PATH, "plan": plan,
        }
        activation["activation_sha256"] = sha(activation)
        sources["runtime_adapter_activation"] = self.write_source(ACTIVATION_PATH, canonical(activation))
        reconciliation = {
            "source_reconciliation_sha256": sources["snapshot_reconciliation"]["sha256"],
            "database": {"report_sha256": hashlib.sha256(b"database-logical-content").hexdigest()},
            "files": {
                domain: {
                    "tree_sha256": hashlib.sha256(f"tree:{domain}".encode()).hexdigest(),
                    "entries": snapshot_objects[domain]["entries"],
                }
                for domain in ("uploads", "attachments", "backup_status")
            },
        }
        reconciliation["binding_sha256"] = sha(reconciliation)
        package = {
            "schema_version": 3,
            "contract": "chenyida-erp-uat-promotion-rollback-execution-package/v3",
            "promotion_id": plan["promotion_id"], "promotion_generation": 1,
            "rollback_operation_id": self.operation_id,
            "created_at": timestamp(created), "execution_deadline": timestamp(deadline),
            "snapshot_readiness_sha256": hashlib.sha256(b"snapshot-readiness").hexdigest(),
            "snapshot_objects": snapshot_objects, "snapshot_objects_sha256": sha(snapshot_objects),
            "predecessor": predecessor, "predecessor_sha256": sha(predecessor),
            "database": database, "database_snapshot_sha256": sha(database),
            "boundary": boundary, "content_reconciliation": reconciliation,
            "protected_resources_sha256": protected, "runtime_plan_sha256": plan["runtime_plan_sha256"],
            "compose_project": "chenyida-erp", "compose_project_root": "/opt/erp/chenyida_erp_site",
            "restore_strategies": {
                "database": "RESTORE_TO_STAGING_DATABASE_ATOMIC_RENAME_RETAIN_CANDIDATE_QUARANTINED",
                "file_domains": "RESTORE_TO_NEW_NAMED_VOLUMES_RECREATE_WRITERS_RETAIN_CANDIDATE_VOLUMES",
                "runtime": "RECREATE_WEB_WORKER_FROM_PREDECESSOR_PINNED_DIGESTS",
            },
            "sources": sources, "source_set_sha256": sha(sources),
        }
        package["package_sha256"] = sha(package)
        context = {
            "schema_version": 1,
            "contract": "chenyida-erp-uat-promotion-transaction-context/v1",
            "operation": "ROLLBACK_EXECUTION", "operation_id": self.operation_id,
            "execution_mode": "RECOVERY" if self.expired_runtime else "ORIGINAL",
            "execution_authorization_id": self.operation_id,
            "execution_authorization_sha256": self.authorization_sha,
            "execution_created_at": timestamp(now),
            "original_authorization_sha256": hashlib.sha256(b"expired-original-authorization").hexdigest()
                if self.expired_runtime else self.authorization_sha,
            "supervisor_bundle_sha256": self.bundle_sha,
            "expected_intent_sha256": hashlib.sha256(b"expired-recovery-intent").hexdigest()
                if self.expired_runtime else None,
            "parameters": {
                "promotion_id": plan["promotion_id"], "promotion_generation": 1,
                "rollback_id": self.operation_id,
            },
        }
        transaction = {
            "schema_version": 1,
            "contract": "chenyida-erp-uat-promotion-rollback-intent/v1",
            "rollback_operation_id": self.operation_id,
        }
        transaction["rollback_intent_sha256"] = sha(transaction)
        payload = {"context": context, "transaction_intent": transaction, "execution_package": package}
        request = {
            "schema_version": 1,
            "contract": "chenyida-erp-uat-promotion-rollback-runtime-request/v1",
            "action": "PREFLIGHT", "operation": "ROLLBACK_EXECUTION",
            "operation_id": self.operation_id,
            "execution_mode": "RECOVERY" if self.expired_runtime else "ORIGINAL", "label": None,
            "execution_package_sha256": package["package_sha256"],
            "source_set_sha256": package["source_set_sha256"],
            "transaction_intent_sha256": transaction["rollback_intent_sha256"],
            "record_intent_sha256": "0" * 64,
            "runtime_plan_sha256": package["runtime_plan_sha256"],
            "previous_result_sha256": "0" * 64,
            "source_roles": list(ROLES),
            "context_sha256": sha(context), "payload_sha256": sha(payload), "payload": payload,
            "requested_at": timestamp(now), "execution_deadline": timestamp(deadline),
            "authorization_expires_at": timestamp(authorization_deadline),
            "action_deadline": timestamp(now + timedelta(minutes=2)),
        }
        request["request_sha256"] = sha(request)
        return request

    def invoke(self, request=None, *, timeout_ms=None, environment_patch=None):
        request = self.request if request is None else request
        environment = {
            "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent",
            "PYTHONDONTWRITEBYTECODE": "1", "PYTHONHASHSEED": "0",
            "ERP_RELEASE_SUPERVISOR_LAUNCHED": "YES",
            "ERP_RELEASE_GATE_LOCK_HELD": "YES",
            "ERP_RELEASE_GATE_LOCK_FD": str(self.lock_fd),
            "ERP_RELEASE_SUPERVISOR_SITE_ROOT": str(self.logical_site),
            "ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256": self.bundle_sha,
            "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256": self.authorization_sha,
            "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_EXPIRES_AT": request["authorization_expires_at"],
            "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED":
                "NO" if request["action"] == "PREFLIGHT" else "YES",
            "ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED":
                "YES" if request["execution_mode"] == "RECOVERY" else "NO",
            "CHENYIDA_ERP_ROLLBACK_ADAPTER_TEST_MODE": "YES",
            "CHENYIDA_ERP_ROLLBACK_ADAPTER_TEST_ROOT": str(self.root),
        }
        if timeout_ms is not None:
            environment["CHENYIDA_ERP_ROLLBACK_ADAPTER_TEST_TIMEOUT_MS"] = str(timeout_ms)
        if environment_patch is not None:
            environment.update(environment_patch)
        arguments = ["/usr/bin/python3", str(self.adapter), request["action"].lower(), self.operation_id]
        if request["label"] is not None:
            arguments.append(request["label"])
        return subprocess.run(
            arguments,
            input=canonical(request), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=environment, pass_fds=(self.lock_fd,), timeout=10, check=False,
        )

    def containment_request(self, observed):
        request = copy.deepcopy(self.request)
        requested = datetime.now(timezone.utc)
        intent_body = {
            "schema_version": 1,
            "contract": "chenyida-erp-uat-promotion-rollback-containment-intent/v1",
            "status": "PREPARED",
            "operation": request["operation"],
            "operation_id": request["operation_id"],
            "promotion_id": request["payload"]["execution_package"]["promotion_id"],
            "intent_sha256": request["transaction_intent_sha256"],
            "execution_package_sha256": request["execution_package_sha256"],
            "failure_code": "ROLLBACK_CONTROL_RUNTIME_PARTIAL_OR_UNKNOWN",
            "ledger_state": "EMPTY",
            "last_committed_ordinal": 0,
            "last_committed_label": None,
            "last_committed_record_sha256": "0" * 64,
            "containment_attempt": 1,
            "previous_containment_intent_sha256": None,
            "previous_containment_attempt_receipt_sha256": None,
            "runtime_target_state": "SAFE_TO_EXECUTE",
            "runtime_observation_sha256": observed["observation_sha256"],
            "expected_writer_inventory_sha256": sha(observed["writer_inventory"]),
            "expected_writer_set_sha256": observed["writer_inventory"]["writer_set_sha256"],
            "expected_active_generation": observed["active_generation"],
            "expected_database_oid": observed["database"]["oid"],
            "expected_web_container_id": observed["services"]["web"]["container_id"],
            "expected_worker_container_id": observed["services"]["worker"]["container_id"],
            "prepared_at": timestamp(requested),
        }
        containment_intent = {
            **intent_body, "containment_intent_sha256": sha(intent_body),
        }
        request["action"] = "CONTAIN"
        request["record_intent_sha256"] = containment_intent["containment_intent_sha256"]
        request["previous_result_sha256"] = "0" * 64
        request["source_roles"] = [
            role for role in ROLES if role in {
                "candidate_deployment_result", "candidate_postdeploy_identity",
                "runtime_adapter_activation",
            }
        ]
        request["payload"]["record_intent"] = containment_intent
        request["payload"]["containment_intent"] = containment_intent
        request["requested_at"] = timestamp(requested)
        request["action_deadline"] = timestamp(requested + timedelta(minutes=2))
        request["context_sha256"] = sha(request["payload"]["context"])
        request["payload_sha256"] = sha(request["payload"])
        request["request_sha256"] = sha(without(request, "request_sha256"))
        return request


class UatPromotionRollbackRuntimeAdapterTest(unittest.TestCase):
    def test_postgresql_content_probe_gets_the_same_twenty_minute_adapter_budget(self):
        fixture = RuntimeAdapterFixture()
        self.addCleanup(fixture.close)
        request = copy.deepcopy(fixture.request)
        requested = datetime.fromisoformat(request["requested_at"].replace("Z", "+00:00"))
        request["action"] = "PROBE"
        request["operation"] = "ROLLBACK_POSTVERIFY"
        request["label"] = "POSTGRESQL_CONTENT"
        request["source_roles"] = list(ADAPTER.derive_source_roles(
            request["action"], request["operation"], request["label"],
        ))
        request["action_deadline"] = timestamp(requested + timedelta(minutes=20))
        request["request_sha256"] = sha(without(request, "request_sha256"))

        validated = ADAPTER.validate_request(
            request, request["action"], request["operation_id"], request["label"],
        )

        self.assertIs(validated, request)
        self.assertEqual(ADAPTER.action_timeout_seconds("PROBE", "POSTGRESQL_CONTENT"), 1200)
        self.assertEqual(
            ADAPTER.bounded_executor_timeout_seconds(request, requested), 1200,
        )

    def test_non_postgresql_probe_cannot_reuse_the_twenty_minute_adapter_budget(self):
        fixture = RuntimeAdapterFixture()
        self.addCleanup(fixture.close)
        request = copy.deepcopy(fixture.request)
        requested = datetime.fromisoformat(request["requested_at"].replace("Z", "+00:00"))
        request["action"] = "PROBE"
        request["operation"] = "ROLLBACK_POSTVERIFY"
        request["label"] = "HEALTH"
        request["source_roles"] = list(ADAPTER.derive_source_roles(
            request["action"], request["operation"], request["label"],
        ))
        request["action_deadline"] = timestamp(requested + timedelta(minutes=20))
        request["request_sha256"] = sha(without(request, "request_sha256"))

        with self.assertRaisesRegex(
            ADAPTER.AdapterError, "ROLLBACK_RUNTIME_REQUEST_TIME_INVALID",
        ):
            ADAPTER.validate_request(
                request, request["action"], request["operation_id"], request["label"],
            )
        self.assertEqual(ADAPTER.action_timeout_seconds("PROBE", "HEALTH"), 300)
        self.assertEqual(
            ADAPTER.bounded_executor_timeout_seconds(request, requested), 300,
        )

    def test_runtime_configuration_uses_the_same_internal_argv_binding_as_executor(self):
        self.assertEqual(
            ADAPTER.fixed_argv_template({"label": "RUNTIME_CONFIGURATION"}),
            ["EXECUTOR_INTERNAL", "RUNTIME_CONFIGURATION"],
        )

    def test_actual_fixed_executor_reaches_operation_preflight_through_gateway_manifest(self):
        fixture = RuntimeAdapterFixture(mode="ACTUAL_FIXED_EXECUTOR")
        self.addCleanup(fixture.close)
        result = fixture.invoke()
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(result.stderr, b"")
        response = json.loads(result.stdout)
        self.assertEqual(response["status"], "SAFE_TO_EXECUTE")
        self.assertEqual(
            response["output"]["observed"]["active_generation"], "CANDIDATE",
        )
        self.assertEqual(
            response["output"]["observed"],
            response["output"]["observed"] | {
                "observation_sha256": sha(without(
                    response["output"]["observed"], "observation_sha256",
                )),
            },
        )

    def test_fake_root_preflight_binds_activation_plan_tools_and_target(self):
        fixture = RuntimeAdapterFixture()
        self.addCleanup(fixture.close)
        result = fixture.invoke()
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(result.stderr, b"")
        response = json.loads(result.stdout)
        self.assertEqual(result.stdout, canonical(response))
        self.assertEqual(response["status"], "SAFE_TO_EXECUTE")
        self.assertEqual(response["output"]["runtime_plan_sha256"], fixture.request["runtime_plan_sha256"])
        self.assertEqual(
            response["output"]["runtime_activation_source_sha256"],
            fixture.request["payload"]["execution_package"]["sources"]["runtime_adapter_activation"]["sha256"],
        )

    def test_recovery_uses_fresh_authorization_after_package_and_activation_expiry(self):
        fixture = RuntimeAdapterFixture(expired_runtime=True)
        self.addCleanup(fixture.close)
        self.assertLess(
            fixture.request["execution_deadline"], fixture.request["requested_at"],
        )
        self.assertGreater(
            fixture.request["authorization_expires_at"], fixture.request["action_deadline"],
        )
        result = fixture.invoke()
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        response = json.loads(result.stdout)
        self.assertEqual(response["status"], "PARTIAL_OR_UNKNOWN_REQUIRES_CONTAINMENT")
        self.assertEqual(response["action"], "PREFLIGHT")

    def test_request_digest_and_executor_replacement_fail_closed(self):
        fixture = RuntimeAdapterFixture()
        self.addCleanup(fixture.close)
        drift = copy.deepcopy(fixture.request)
        drift["source_set_sha256"] = hashlib.sha256(b"drift").hexdigest()
        rejected = fixture.invoke(drift)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn(b"ROLLBACK_RUNTIME_REQUEST_INVALID", rejected.stderr)
        fixture.executor.write_text(fixture.executor.read_text(encoding="utf-8") + "\n# replaced\n", encoding="utf-8")
        fixture.executor.chmod(0o555)
        replaced = fixture.invoke()
        self.assertNotEqual(replaced.returncode, 0)
        self.assertIn(b"ROLLBACK_RUNTIME_EXECUTOR_INVALID", replaced.stderr)

    def test_content_addressed_package_still_rejects_an_extra_nested_field(self):
        fixture = RuntimeAdapterFixture()
        self.addCleanup(fixture.close)
        drift = copy.deepcopy(fixture.request)
        package = drift["payload"]["execution_package"]
        package["predecessor"]["unexpected"] = "FORBIDDEN"
        package["predecessor_sha256"] = sha(package["predecessor"])
        package["package_sha256"] = sha({
            key: value for key, value in package.items() if key != "package_sha256"
        })
        drift["execution_package_sha256"] = package["package_sha256"]
        drift["payload_sha256"] = sha(drift["payload"])
        drift["request_sha256"] = sha({
            key: value for key, value in drift.items() if key != "request_sha256"
        })
        result = fixture.invoke(drift)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"ROLLBACK_RUNTIME_EXECUTION_PACKAGE_INVALID", result.stderr)

    def test_missing_activation_fails_before_executor(self):
        fixture = RuntimeAdapterFixture()
        self.addCleanup(fixture.close)
        fixture.physical(ACTIVATION_PATH).unlink()
        result = fixture.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"ROLLBACK_RUNTIME_ACTIVATION_SOURCE_INVALID", result.stderr)

    def test_every_tool_and_source_requires_a_root_owned_nonwritable_parent_chain(self):
        fixture = RuntimeAdapterFixture()
        self.addCleanup(fixture.close)
        fixture.executor.parent.chmod(0o777)
        result = fixture.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"ROLLBACK_RUNTIME_EXECUTOR_INVALID", result.stderr)

        second = RuntimeAdapterFixture()
        self.addCleanup(second.close)
        second.physical("/var/lib/chenyida-erp/rollback-inputs").chmod(0o777)
        result = second.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"ROLLBACK_RUNTIME_SOURCE_", result.stderr)

    def test_source_swap_back_uses_the_open_descriptor_and_fails_post_execution_recheck(self):
        fixture = RuntimeAdapterFixture(mode="SWAP_SOURCE_BACK")
        self.addCleanup(fixture.close)
        result = fixture.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"ROLLBACK_RUNTIME_SOURCE_SNAPSHOT_UPLOADS_CHANGED", result.stderr)

    def test_executor_swap_back_uses_the_open_descriptor_and_fails_named_path_recheck(self):
        fixture = RuntimeAdapterFixture(mode="SWAP_EXECUTOR_BACK")
        self.addCleanup(fixture.close)
        result = fixture.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"ROLLBACK_RUNTIME_EXECUTOR_CHANGED", result.stderr)

    def test_docker_swap_back_uses_the_open_descriptor_and_fails_named_path_recheck(self):
        fixture = RuntimeAdapterFixture(mode="SWAP_DOCKER_BACK")
        self.addCleanup(fixture.close)
        result = fixture.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"ROLLBACK_RUNTIME_DOCKER_CHANGED", result.stderr)

    def test_compose_plugin_swap_back_uses_the_open_descriptor_and_fails_named_path_recheck(self):
        fixture = RuntimeAdapterFixture(mode="SWAP_COMPOSE_PLUGIN_BACK")
        self.addCleanup(fixture.close)
        result = fixture.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"ROLLBACK_RUNTIME_COMPOSE_PLUGIN_CHANGED", result.stderr)

    def test_unexpected_writer_cannot_reuse_a_known_nonwriter_service_identity(self):
        fixture = RuntimeAdapterFixture(mode="CONFLICTING_WRITER_SERVICE_ID")
        self.addCleanup(fixture.close)
        result = fixture.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"ROLLBACK_RUNTIME_OBSERVATION_INVALID", result.stderr)

    def test_stale_containment_response_returns_a_validated_fresh_observation(self):
        fixture = RuntimeAdapterFixture(mode="STALE_CONTAINMENT")
        self.addCleanup(fixture.close)
        preflight = fixture.invoke()
        self.assertEqual(preflight.returncode, 0, preflight.stderr.decode())
        observed = json.loads(preflight.stdout)["output"]["observed"]
        containment = fixture.invoke(fixture.containment_request(observed))
        self.assertEqual(containment.returncode, 0, containment.stderr.decode())
        response = json.loads(containment.stdout)
        self.assertEqual(response["status"], "STALE_INTENT")
        self.assertNotEqual(response["output"]["observed"]["observation_sha256"], observed["observation_sha256"])
        self.assertEqual(response["output"]["observed"]["writer_inventory"]["unexpected_writer_count"], 1)

    def test_original_authorization_consumption_state_is_bound_to_execution_mode(self):
        fixture = RuntimeAdapterFixture()
        self.addCleanup(fixture.close)
        result = fixture.invoke(environment_patch={
            "ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED": "YES",
        })
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"ROLLBACK_RUNTIME_SUPERVISOR_INVALID", result.stderr)

    def test_timeout_terminates_executor_process_group(self):
        fixture = RuntimeAdapterFixture(mode="SLOW")
        self.addCleanup(fixture.close)
        result = fixture.invoke(timeout_ms=100)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"ROLLBACK_RUNTIME_EXECUTOR_TIMEOUT_OR_OUTPUT_LIMIT", result.stderr)
        for _ in range(50):
            if fixture.pid_file.exists():
                break
            time.sleep(0.02)
        self.assertTrue(fixture.pid_file.exists())
        grandchild = int(fixture.pid_file.read_text(encoding="utf-8"))
        for _ in range(100):
            if not Path(f"/proc/{grandchild}").exists():
                break
            time.sleep(0.02)
        self.assertFalse(Path(f"/proc/{grandchild}").exists(), "executor grandchild survived process-group timeout")

    def test_output_limit_terminates_executor(self):
        fixture = RuntimeAdapterFixture(mode="OVERSIZE")
        self.addCleanup(fixture.close)
        result = fixture.invoke(timeout_ms=1000)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"ROLLBACK_RUNTIME_EXECUTOR_TIMEOUT_OR_OUTPUT_LIMIT", result.stderr)

    def test_nonreading_term_resistant_executor_and_grandchild_are_killed(self):
        fixture = RuntimeAdapterFixture(mode="NO_READ_TERM_RESISTANT")
        self.addCleanup(fixture.close)
        started = time.monotonic()
        result = fixture.invoke(timeout_ms=100)
        self.assertLess(time.monotonic() - started, 8)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"ROLLBACK_RUNTIME_EXECUTOR_TIMEOUT_OR_OUTPUT_LIMIT", result.stderr)
        self.assertTrue(fixture.pid_file.exists())
        grandchild = int(fixture.pid_file.read_text(encoding="utf-8"))
        for _ in range(100):
            if not Path(f"/proc/{grandchild}").exists():
                break
            time.sleep(0.02)
        self.assertFalse(Path(f"/proc/{grandchild}").exists(), "TERM-resistant grandchild survived SIGKILL")

    def test_successful_executor_cannot_leave_same_group_child(self):
        fixture = RuntimeAdapterFixture(mode="LEADER_EXIT_WITH_CHILD")
        self.addCleanup(fixture.close)
        result = fixture.invoke(timeout_ms=1000)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"ROLLBACK_RUNTIME_EXECUTOR_FAILED", result.stderr)
        child = int(fixture.pid_file.read_text(encoding="utf-8"))
        for _ in range(100):
            if not Path(f"/proc/{child}").exists():
                break
            time.sleep(0.02)
        self.assertFalse(Path(f"/proc/{child}").exists(), "executor child survived successful leader exit")

    def test_detached_daemon_is_adopted_rejected_and_killed(self):
        fixture = RuntimeAdapterFixture(mode="DETACHED_DAEMON")
        self.addCleanup(fixture.close)
        result = fixture.invoke(timeout_ms=1000)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"ROLLBACK_RUNTIME_EXECUTOR_FAILED", result.stderr)
        daemon = int(fixture.pid_file.read_text(encoding="utf-8"))
        for _ in range(100):
            if not Path(f"/proc/{daemon}").exists():
                break
            time.sleep(0.02)
        self.assertFalse(Path(f"/proc/{daemon}").exists(), "detached executor daemon survived cleanup")


if __name__ == "__main__":
    unittest.main()
