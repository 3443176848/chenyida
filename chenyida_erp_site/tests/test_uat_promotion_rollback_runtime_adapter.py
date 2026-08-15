import copy
import fcntl
import hashlib
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
ACTIVATION_PATH = "/var/lib/chenyida-erp-release-supervisor/uat-rollback-runtime-adapter/activation-v1.json"
EXECUTOR_PATH = "/usr/local/libexec/chenyida-erp-uat-rollback-executor-v1"
DOCKER_PATH = "/usr/bin/docker"
LOCK_PATH = "/run/lock/chenyida-erp-release-gate-v1.lock"
ROLES = (
    "snapshot_readiness", "snapshot_manifest", "snapshot_migrations", "snapshot_reconciliation",
    "snapshot_postgresql", "snapshot_uploads", "snapshot_attachments", "snapshot_backup_status",
    "snapshot_policy", "snapshot_policy_activation", "predecessor_postdeploy_receipt",
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
fd_manifest = json.loads(os.environ["CHENYIDA_ERP_ROLLBACK_TRUSTED_FD_MANIFEST"])
manifest_body = {key: value for key, value in fd_manifest.items() if key != "manifest_sha256"}
if fd_manifest.get("contract") != "chenyida-erp-uat-promotion-rollback-trusted-fd-manifest/v1" \
        or fd_manifest.get("manifest_sha256") != sha(manifest_body) \
        or fd_manifest.get("executor", {}).get("path") != sys.argv[0] \
        or sorted(fd_manifest.get("sources", {})) != sorted(request["source_roles"]):
    raise SystemExit(90)
for item in [fd_manifest["executor"], fd_manifest["docker"], *fd_manifest["sources"].values()]:
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
    swap_named_path_back(fd_manifest["docker"]["path"], 0o555)
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
    volumes = {
        domain: {
            "domain": domain, "name": f"chenyida-erp_erp_{domain}",
            "identity_sha256": hashlib.sha256(f"volume:{domain}".encode()).hexdigest(),
        }
        for domain in ("uploads", "attachments", "backup_status")
    }
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
    "status": status, "started_at": observed, "completed_at": observed, "output": output,
}
body["response_sha256"] = sha(body)
sys.stdout.buffer.write(canonical(body))
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
        executor_text = EXECUTOR_TEMPLATE.replace("__MODE__", repr(mode)).replace(
            "__PID_FILE__", repr(str(self.pid_file))
        )
        self.executor.write_text(executor_text, encoding="utf-8")
        self.executor.chmod(0o555)
        self.docker = self.physical(DOCKER_PATH)
        self.docker.parent.mkdir(parents=True, exist_ok=True)
        self.docker.write_text("#!/bin/sh\nexit 99\n", encoding="utf-8")
        self.docker.chmod(0o555)
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
        plan = {
            "schema_version": 1,
            "contract": "chenyida-erp-uat-promotion-rollback-runtime-plan/v1",
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
                        "identity_sha256": hashlib.sha256(f"volume:{domain}".encode()).hexdigest(),
                    }
                    for domain in ("uploads", "attachments", "backup_status")
                },
                "protected_resources_sha256": protected,
            },
            "predecessor": {
                "release_manifest_sha256": predecessor["release_manifest_sha256"],
                "postdeploy_receipt_sha256": sources["predecessor_postdeploy_receipt"]["sha256"],
                "runtime_configuration_sha256": predecessor["runtime_configuration_sha256"],
                "web_image": predecessor["web_image"], "worker_image": predecessor["worker_image"],
            },
            "targets": derive_targets(self.operation_id),
            "toolchain": {
                "executor": {
                    "path": EXECUTOR_PATH, "sha256": sha_bytes(self.executor.read_bytes()),
                    "uid": 0, "gid": 0, "mode": "0555",
                },
                "docker": {
                    "path": DOCKER_PATH, "sha256": sha_bytes(self.docker.read_bytes()),
                    "uid": 0, "gid": 0, "mode": "0555",
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
                "compose_file_sha256": sources["compose_file"]["sha256"],
                "compose_release_file_sha256": sources["compose_release_file"]["sha256"],
                "runtime_policy_sha256": sources["runtime_policy"]["sha256"],
            },
            "action_matrix": action_matrix,
        }
        plan["runtime_plan_sha256"] = sha(plan)
        activation = {
            "schema_version": 1,
            "contract": "chenyida-erp-uat-promotion-rollback-runtime-activation/v1",
            "status": "ACTIVE", "activation_id": "runtime-adapter-activation-001",
            "approved_at": timestamp(created), "expires_at": timestamp(deadline),
            "requester_identity_sha256": hashlib.sha256(b"requester").hexdigest(),
            "approver_identity_sha256": hashlib.sha256(b"approver").hexdigest(),
            "plan": plan,
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
            "schema_version": 2,
            "contract": "chenyida-erp-uat-promotion-rollback-execution-package/v2",
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
