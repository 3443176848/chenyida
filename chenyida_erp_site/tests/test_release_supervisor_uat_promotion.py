import importlib.util
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "release-supervisor-launcher.py"
SPEC = importlib.util.spec_from_file_location("release_supervisor_uat_promotion", MODULE_PATH)
supervisor = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(supervisor)


def utc(value):
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


class ReleaseSupervisorUatPromotionTest(unittest.TestCase):
    def source(self, path, mode="0400", gid=0, seed="1"):
        return {
            "path": path,
            "sha256": seed * 64,
            "bytes": 100,
            "device": "1",
            "inode": "2",
            "uid": 0,
            "gid": gid,
            "mode": mode,
            "nlink": 1,
        }

    def parameters(self, recovery=False):
        promotion_id = "promotion-supervisor-fixture"
        candidate = "/var/lib/chenyida-erp/release-candidate-snapshots/receipts/promotion-supervisor.prepared.json"
        manifest = "/var/lib/chenyida-erp/release-artifacts/promotion-supervisor/release-manifest.json"
        value = {
            "promotion_state_root": str(supervisor.UAT_PROMOTION_STATE_ROOT),
            "promotion_id": promotion_id,
            "promotion_generation": 1,
            "previous_promotion_receipt_sha256": "0" * 64,
            "repository_root": "/opt/erp",
            "git_commit": "a" * 40,
            "git_tree": "b" * 40,
            "candidate_snapshot_receipt": candidate,
            "candidate_snapshot_receipt_sha256": "1" * 64,
            "candidate_snapshot_source": self.source(candidate, seed="1"),
            "test_runtime_root": "/opt/erp",
            "application_version": "0.1.0-alpha.47",
            "release_manifest": manifest,
            "release_manifest_sha256": "2" * 64,
            "release_manifest_source": self.source(manifest, mode="0440", seed="2"),
            "web_image": f"registry.example.invalid/chenyida/web@sha256:{'3' * 64}",
            "worker_image": f"registry.example.invalid/chenyida/worker@sha256:{'4' * 64}",
            "migration_head": "0046_runtime_lock_privilege_boundary.sql",
            "migration_manifest_sha256": "5" * 64,
            "current_runtime_identity_source": self.source(
                "/var/lib/chenyida-erp/release-identity/release-identity.json", mode="0440", gid=1234, seed="6",
            ),
            "recovery_readiness_source": self.source(
                "/var/lib/chenyida-erp/backup-status/recovery-readiness.json", mode="0440", gid=1234, seed="7",
            ),
            "preupgrade_recovery_readiness_sha256": "8" * 64,
            "preupgrade_recovery_snapshot_sha256": "9" * 64,
            "database_name": "chenyida_erp",
            "database_oid": "16384",
            "database_system_identifier": "7612345678901234567",
            "database_marker": "chenyida-erp-deployment/v2:UAT:chenyida-erp",
            "promotion_created_at": "2026-08-15T01:00:00.000Z",
            "promotion_expires_at": "2026-08-15T01:50:00.000Z",
            "requester_identity_sha256": "a" * 64,
            "approver_identity_sha256": "b" * 64,
            "executor_identity_sha256": "c" * 64,
            "policy_file_sha256": supervisor.UAT_PROMOTION_POLICY_FILE_SHA256,
            "policy_sha256": supervisor.UAT_PROMOTION_POLICY_SHA256,
            "current_promotion_source": None,
        }
        if recovery:
            value.update({
                "expected_intent_sha256": "d" * 64,
                "original_authorization_sha256": "e" * 64,
                "original_operation": "BEGIN",
                "original_operation_id": promotion_id,
            })
        return value

    def authorization(self, bundle_digest, now, recovery=False):
        operation = "RECOVER_UAT_PROMOTION" if recovery else "BEGIN_UAT_PROMOTION"
        identifier = "promotion-supervisor-recovery" if recovery else "promotion-supervisor-fixture"
        parameters = self.parameters(recovery)
        created = now if recovery else datetime(2026, 8, 15, 1, 0, tzinfo=timezone.utc)
        return {
            "schema_version": 6,
            "contract": supervisor.UAT_PROMOTION_AUTHORIZATION_CONTRACT,
            "authorization_id": identifier,
            "created_at": utc(created),
            "expires_at": utc(created + timedelta(minutes=55)),
            "supervisor_bundle_sha256": bundle_digest,
            "operation": operation,
            "parameters": parameters,
            "nonce": "f" * 64,
            "confirmation": supervisor.UAT_PROMOTION_CONFIRMATIONS[operation],
        }

    def snapshot_parameters(self, recovery=False):
        promotion_id = "promotion-supervisor-fixture"
        capture_id = "promotion-supervisor-capture"
        readiness = "/var/lib/chenyida-erp/backup-status/snapshot-backup.snapshot-restore.recovery-readiness-v4.json"
        value = {
            "promotion_state_root": str(supervisor.UAT_PROMOTION_STATE_ROOT),
            "promotion_id": promotion_id,
            "promotion_generation": 1,
            "previous_checkpoint_receipt_sha256": "1" * 64,
            "promotion_intent_sha256": "2" * 64,
            "promotion_original_authorization_sha256": "3" * 64,
            "candidate_binding_sha256": "4" * 64,
            "database_binding_sha256": "5" * 64,
            "runtime_binding_sha256": "6" * 64,
            "preupgrade_recovery_binding_sha256": "7" * 64,
            "current_checkpoint_source": self.source(str(supervisor.UAT_PROMOTION_CURRENT_FILE), seed="8"),
            "runtime_identity_source": self.source(str(supervisor.RELEASE_IDENTITY_FILE), mode="0440", gid=1234, seed="6"),
            "snapshot_readiness": readiness,
            "snapshot_readiness_file_sha256": "9" * 64,
            "snapshot_readiness_sha256": "a" * 64,
            "snapshot_readiness_source": self.source(readiness, mode="0640", gid=1234, seed="9"),
            "snapshot_policy": str(supervisor.MONITORING_CLUSTER_POLICY_FILE),
            "snapshot_policy_file_sha256": "b" * 64,
            "snapshot_policy_sha256": "c" * 64,
            "snapshot_policy_source": self.source(str(supervisor.MONITORING_CLUSTER_POLICY_FILE), mode="0440", seed="b"),
            "snapshot_policy_activation": str(supervisor.CLUSTER_POLICY_CURRENT_FILE),
            "snapshot_policy_activation_file_sha256": "d" * 64,
            "snapshot_policy_activation_receipt_sha256": "e" * 64,
            "snapshot_policy_activation_source": self.source(str(supervisor.CLUSTER_POLICY_CURRENT_FILE), seed="d"),
            "snapshot_backup_id": "snapshot-backup",
            "snapshot_restore_run_id": "snapshot-restore",
            "snapshot_objects": {
                "postgresql": {"file": "postgresql.dump", "sha256": "1" * 64, "bytes": 101, "entries": None},
                "uploads": {"file": "uploads.tar.gz", "sha256": "2" * 64, "bytes": 102, "entries": 2},
                "attachments": {"file": "attachments.tar.gz", "sha256": "3" * 64, "bytes": 103, "entries": 3},
                "backup_status": {"file": "backup-status.tar.gz", "sha256": "4" * 64, "bytes": 104, "entries": 4},
            },
            "snapshot_created_at": "2026-08-15T01:10:00.000Z",
            "snapshot_expires_at": "2026-08-15T01:45:00.000Z",
            "requester_identity_sha256": "7" * 64,
            "approver_identity_sha256": "8" * 64,
            "executor_identity_sha256": "9" * 64,
            "policy_file_sha256": supervisor.UAT_PROMOTION_POLICY_FILE_SHA256,
            "policy_sha256": supervisor.UAT_PROMOTION_POLICY_SHA256,
        }
        if recovery:
            value.update({
                "expected_intent_sha256": "a" * 64,
                "original_authorization_sha256": "b" * 64,
                "original_operation": "CAPTURE_SNAPSHOT",
                "original_operation_id": capture_id,
            })
        return value

    def snapshot_authorization(self, bundle_digest, now, recovery=False):
        operation = "RECOVER_UAT_PROMOTION" if recovery else "CAPTURE_UAT_PROMOTION_SNAPSHOT"
        return {
            "schema_version": 6,
            "contract": supervisor.UAT_PROMOTION_AUTHORIZATION_CONTRACT,
            "authorization_id": "promotion-supervisor-capture-recovery" if recovery else "promotion-supervisor-capture",
            "created_at": utc(now),
            "expires_at": utc(now + timedelta(minutes=40)),
            "supervisor_bundle_sha256": bundle_digest,
            "operation": operation,
            "parameters": self.snapshot_parameters(recovery),
            "nonce": "f" * 64,
            "confirmation": supervisor.UAT_PROMOTION_CONFIRMATIONS[operation],
        }

    def quiesce_parameters(self, recovery=False):
        promotion_id = "promotion-supervisor-fixture"
        snapshot_id = "promotion-supervisor-capture"
        snapshot_intent_sha256 = "d" * 64
        snapshot_intent = (
            f"{supervisor.UAT_PROMOTION_STATE_ROOT}/intents/"
            f"{snapshot_id}.{snapshot_intent_sha256}.json"
        )
        value = {
            "promotion_state_root": str(supervisor.UAT_PROMOTION_STATE_ROOT),
            "promotion_id": promotion_id,
            "promotion_generation": 1,
            "previous_checkpoint_receipt_sha256": "1" * 64,
            "promotion_intent_sha256": "2" * 64,
            "promotion_original_authorization_sha256": "3" * 64,
            "snapshot_operation_id": snapshot_id,
            "snapshot_intent_sha256": snapshot_intent_sha256,
            "snapshot_intent_source": self.source(snapshot_intent, seed="9"),
            "candidate_binding_sha256": "4" * 64,
            "database_binding_sha256": "5" * 64,
            "runtime_binding_sha256": "6" * 64,
            "preupgrade_recovery_binding_sha256": "7" * 64,
            "promotion_snapshot_binding_sha256": "8" * 64,
            "current_checkpoint_source": self.source(str(supervisor.UAT_PROMOTION_CURRENT_FILE), seed="a"),
            "runtime_identity_source": self.source(
                str(supervisor.RELEASE_IDENTITY_FILE), mode="0440", gid=1234, seed="6",
            ),
            "deployment_class": "UAT",
            "deployment_id": "chenyida-erp",
            "compose_project": "chenyida-erp",
            "compose_project_root": "/opt/erp/chenyida_erp_site",
            "web_container": "chenyida-erp-web-1",
            "web_container_id": "e" * 64,
            "worker_container": "chenyida-erp-worker-1",
            "worker_container_id": "f" * 64,
            "quiesce_created_at": "2026-08-15T01:32:00.000Z",
            "quiesce_expires_at": "2026-08-15T01:44:00.000Z",
            "requester_identity_sha256": "a" * 64,
            "approver_identity_sha256": "b" * 64,
            "executor_identity_sha256": "c" * 64,
            "policy_file_sha256": supervisor.UAT_PROMOTION_POLICY_FILE_SHA256,
            "policy_sha256": supervisor.UAT_PROMOTION_POLICY_SHA256,
        }
        if recovery:
            value.update({
                "expected_intent_sha256": "9" * 64,
                "original_authorization_sha256": "a" * 64,
                "original_operation": "QUIESCE_WRITERS",
                "original_operation_id": "promotion-supervisor-quiesce",
            })
        return value

    def quiesce_authorization(self, bundle_digest, now, recovery=False):
        operation = "RECOVER_UAT_PROMOTION" if recovery else "QUIESCE_UAT_WRITERS"
        return {
            "schema_version": 6,
            "contract": supervisor.UAT_PROMOTION_AUTHORIZATION_CONTRACT,
            "authorization_id": "promotion-supervisor-quiesce-recovery" if recovery else "promotion-supervisor-quiesce",
            "created_at": utc(now),
            "expires_at": utc(now + timedelta(minutes=30)),
            "supervisor_bundle_sha256": bundle_digest,
            "operation": operation,
            "parameters": self.quiesce_parameters(recovery),
            "nonce": "f" * 64,
            "confirmation": supervisor.UAT_PROMOTION_CONFIRMATIONS[operation],
        }

    def migration_authorization_parameters(self, recovery=False):
        promotion_id = "promotion-supervisor-fixture"
        quiesce_id = "promotion-supervisor-quiesce"
        quiesce_intent_sha256 = "d" * 64
        quiesce_intent = (
            f"{supervisor.UAT_PROMOTION_STATE_ROOT}/intents/"
            f"{quiesce_id}.{quiesce_intent_sha256}.json"
        )
        manifest = "/var/lib/chenyida-erp/release-artifacts/promotion-supervisor/release-manifest.json"
        value = {
            "promotion_state_root": str(supervisor.UAT_PROMOTION_STATE_ROOT),
            "promotion_id": promotion_id,
            "promotion_generation": 1,
            "previous_checkpoint_receipt_sha256": "1" * 64,
            "promotion_intent_sha256": "2" * 64,
            "promotion_original_authorization_sha256": "3" * 64,
            "quiesce_operation_id": quiesce_id,
            "quiesce_intent_sha256": quiesce_intent_sha256,
            "quiesce_intent_source": self.source(quiesce_intent, seed="d"),
            "candidate_binding_sha256": "4" * 64,
            "database_binding_sha256": "5" * 64,
            "runtime_binding_sha256": "6" * 64,
            "preupgrade_recovery_binding_sha256": "7" * 64,
            "promotion_snapshot_binding_sha256": "8" * 64,
            "writer_quiesce_binding_sha256": "9" * 64,
            "current_checkpoint_source": self.source(str(supervisor.UAT_PROMOTION_CURRENT_FILE), seed="a"),
            "runtime_identity_source": self.source(
                str(supervisor.RELEASE_IDENTITY_FILE), mode="0440", gid=1234, seed="6",
            ),
            "release_manifest": manifest,
            "release_manifest_sha256": "b" * 64,
            "release_manifest_source": self.source(manifest, mode="0440", seed="b"),
            "deployment_class": "UAT",
            "deployment_id": "chenyida-erp",
            "database_name": "chenyida_erp",
            "database_oid": "16384",
            "database_system_identifier": "7612345678901234567",
            "database_marker": "chenyida-erp-deployment/v2:UAT:chenyida-erp",
            "expected_current_migration_head": "0040_runtime_contract.sql",
            "target_migration_head": "0046_runtime_lock_privilege_boundary.sql",
            "migration_manifest_sha256": "c" * 64,
            "migration_role": "chenyida_erp_owner",
            "authorization_created_at": "2026-08-15T01:37:00.000Z",
            "authorization_expires_at": "2026-08-15T01:43:00.000Z",
            "requester_identity_sha256": "a" * 64,
            "approver_identity_sha256": "b" * 64,
            "executor_identity_sha256": "c" * 64,
            "policy_file_sha256": supervisor.UAT_PROMOTION_POLICY_FILE_SHA256,
            "policy_sha256": supervisor.UAT_PROMOTION_POLICY_SHA256,
        }
        if recovery:
            value.update({
                "expected_intent_sha256": "e" * 64,
                "original_authorization_sha256": "f" * 64,
                "original_operation": "MIGRATION_AUTHORIZATION",
                "original_operation_id": "promotion-supervisor-migration-authorization",
            })
        return value

    def migration_authorization(self, bundle_digest, now, recovery=False):
        operation = "RECOVER_UAT_PROMOTION" if recovery else "AUTHORIZE_UAT_PROMOTION_MIGRATION"
        return {
            "schema_version": 6,
            "contract": supervisor.UAT_PROMOTION_AUTHORIZATION_CONTRACT,
            "authorization_id": "promotion-supervisor-migration-recovery" if recovery
            else "promotion-supervisor-migration-authorization",
            "created_at": utc(now),
            "expires_at": utc(now + timedelta(minutes=10)),
            "supervisor_bundle_sha256": bundle_digest,
            "operation": operation,
            "parameters": self.migration_authorization_parameters(recovery),
            "nonce": "f" * 64,
            "confirmation": supervisor.UAT_PROMOTION_CONFIRMATIONS[operation],
        }

    def migration_execution_parameters(self, recovery=False):
        promotion_id = "promotion-supervisor-fixture"
        approval_id = "promotion-supervisor-migration-authorization"
        approval_intent_sha256 = "d" * 64
        approval_intent = (
            f"{supervisor.UAT_PROMOTION_STATE_ROOT}/intents/"
            f"{approval_id}.{approval_intent_sha256}.json"
        )
        manifest = "/var/lib/chenyida-erp/release-artifacts/promotion-supervisor/release-manifest.json"
        value = {
            "promotion_state_root": str(supervisor.UAT_PROMOTION_STATE_ROOT),
            "promotion_id": promotion_id,
            "promotion_generation": 1,
            "previous_checkpoint_receipt_sha256": "1" * 64,
            "promotion_intent_sha256": "2" * 64,
            "promotion_original_authorization_sha256": "3" * 64,
            "migration_authorization_operation_id": approval_id,
            "migration_authorization_intent_sha256": approval_intent_sha256,
            "migration_authorization_intent_source": self.source(approval_intent, seed="e"),
            "migration_approval_authorization_sha256": "f" * 64,
            "candidate_binding_sha256": "4" * 64,
            "database_binding_sha256": "5" * 64,
            "runtime_binding_sha256": "6" * 64,
            "preupgrade_recovery_binding_sha256": "7" * 64,
            "promotion_snapshot_binding_sha256": "8" * 64,
            "writer_quiesce_binding_sha256": "9" * 64,
            "migration_authorization_binding_sha256": "a" * 64,
            "current_checkpoint_source": self.source(str(supervisor.UAT_PROMOTION_CURRENT_FILE), seed="b"),
            "runtime_identity_source": self.source(
                str(supervisor.RELEASE_IDENTITY_FILE), mode="0440", gid=1234, seed="6",
            ),
            "release_manifest": manifest,
            "release_manifest_sha256": "c" * 64,
            "release_manifest_source": self.source(manifest, mode="0440", seed="c"),
            "deployment_class": "UAT",
            "deployment_id": "chenyida-erp",
            "database_name": "chenyida_erp",
            "database_oid": "16384",
            "database_system_identifier": "7612345678901234567",
            "database_marker": "chenyida-erp-deployment/v2:UAT:chenyida-erp",
            "expected_current_migration_head": "0040_runtime_contract.sql",
            "target_migration_head": "0046_runtime_lock_privilege_boundary.sql",
            "migration_manifest_sha256": "d" * 64,
            "migration_role": "chenyida_erp_owner",
            "control_role": "postgres",
            "worker_image": f"registry.example.invalid/chenyida/worker@sha256:{'4' * 64}",
            "postgres_container": "chenyida-erp-postgres-1",
            "postgres_container_id": "e" * 64,
            "postgres_image_digest": f"sha256:{'f' * 64}",
            "backend_network": "chenyida-erp_backend",
            "execution_created_at": "2026-08-15T01:40:00.000Z",
            "execution_expires_at": "2026-08-15T01:42:00.000Z",
            "requester_identity_sha256": "7" * 64,
            "approver_identity_sha256": "8" * 64,
            "executor_identity_sha256": "9" * 64,
            "policy_file_sha256": supervisor.UAT_PROMOTION_POLICY_FILE_SHA256,
            "policy_sha256": supervisor.UAT_PROMOTION_POLICY_SHA256,
        }
        if recovery:
            value.update({
                "expected_intent_sha256": "a" * 64,
                "original_authorization_sha256": "b" * 64,
                "original_operation": "MIGRATION_EXECUTION",
                "original_operation_id": "promotion-supervisor-migration-execution",
            })
        return value

    def migration_execution_authorization(self, bundle_digest, now, recovery=False):
        operation = "RECOVER_UAT_PROMOTION" if recovery else "RUN_UAT_PROMOTION_MIGRATION"
        return {
            "schema_version": 6,
            "contract": supervisor.UAT_PROMOTION_AUTHORIZATION_CONTRACT,
            "authorization_id": "promotion-supervisor-migration-execution-recovery" if recovery
            else "promotion-supervisor-migration-execution",
            "created_at": utc(now),
            "expires_at": utc(now + timedelta(minutes=2)),
            "supervisor_bundle_sha256": bundle_digest,
            "operation": operation,
            "parameters": self.migration_execution_parameters(recovery),
            "nonce": "f" * 64,
            "confirmation": supervisor.UAT_PROMOTION_CONFIRMATIONS[operation],
        }

    def compose_deployment_parameters(self):
        promotion_id = "promotion-supervisor-fixture"
        migration_id = "promotion-supervisor-migration-execution"
        migration_intent_sha256 = "1" * 64
        migration_result_sha256 = "2" * 64
        active_fence_sha256 = "3" * 64
        manifest = "/var/lib/chenyida-erp/release-artifacts/promotion-supervisor/release-manifest.json"
        compose_root = "/opt/erp/chenyida_erp_site"
        environment = "/run/chenyida-erp/release-supervisor/uat-deployment.env"
        return {
            "promotion_state_root": str(supervisor.UAT_PROMOTION_STATE_ROOT),
            "promotion_id": promotion_id,
            "promotion_generation": 1,
            "previous_checkpoint_receipt_sha256": "4" * 64,
            "promotion_intent_sha256": "5" * 64,
            "promotion_original_authorization_sha256": "6" * 64,
            "migration_operation_id": migration_id,
            "migration_execution_intent_sha256": migration_intent_sha256,
            "migration_execution_intent_source": self.source(
                f"{supervisor.UAT_PROMOTION_STATE_ROOT}/intents/{migration_id}.{migration_intent_sha256}.json",
                seed="7",
            ),
            "migration_execution_authorization_sha256": "8" * 64,
            "migration_grant_sha256": "9" * 64,
            "migration_result_sha256": migration_result_sha256,
            "migration_result_source": self.source(
                f"{supervisor.UAT_PROMOTION_STATE_ROOT}/results/{migration_id}.{migration_result_sha256}.json",
                seed="a",
            ),
            "active_migration_fence_sha256": active_fence_sha256,
            "active_migration_fence_source": self.source(
                f"{supervisor.UAT_PROMOTION_ACTIVE_FENCES_ROOT}/{migration_id}.{active_fence_sha256}.json",
                seed="b",
            ),
            "candidate_binding_sha256": "c" * 64,
            "database_binding_sha256": "d" * 64,
            "runtime_binding_sha256": "e" * 64,
            "preupgrade_recovery_binding_sha256": "f" * 64,
            "promotion_snapshot_binding_sha256": "1" * 64,
            "writer_quiesce_binding_sha256": "2" * 64,
            "migration_authorization_binding_sha256": "3" * 64,
            "migration_fence_binding_sha256": "4" * 64,
            "migration_result_binding_sha256": "5" * 64,
            "current_checkpoint_source": self.source(str(supervisor.UAT_PROMOTION_CURRENT_FILE), seed="6"),
            "runtime_identity_source": self.source(
                str(supervisor.RELEASE_IDENTITY_FILE), mode="0440", gid=1234, seed="e",
            ),
            "release_manifest": manifest,
            "release_manifest_sha256": "7" * 64,
            "release_manifest_source": self.source(manifest, mode="0440", seed="7"),
            "deployment_class": "UAT",
            "deployment_id": "chenyida-erp",
            "compose_project": "chenyida-erp",
            "compose_project_root": compose_root,
            "compose_file_source": self.source(f"{compose_root}/compose.yml", mode="0444", seed="8"),
            "compose_release_file_source": self.source(
                f"{compose_root}/compose.release.yml", mode="0444", seed="9",
            ),
            "deployment_environment": environment,
            "deployment_environment_sha256": "a" * 64,
            "deployment_environment_source": self.source(environment, seed="a"),
            "web_image": f"registry.example.invalid/chenyida/web@sha256:{'b' * 64}",
            "worker_image": f"registry.example.invalid/chenyida/worker@sha256:{'c' * 64}",
            "web_container": "chenyida-erp-web-1",
            "old_web_container_id": "d" * 64,
            "old_web_image_digest": f"sha256:{'e' * 64}",
            "worker_container": "chenyida-erp-worker-1",
            "old_worker_container_id": "f" * 64,
            "old_worker_image_digest": f"sha256:{'1' * 64}",
            "postgres_container": "chenyida-erp-postgres-1",
            "postgres_container_id": "2" * 64,
            "postgres_image_digest": f"sha256:{'3' * 64}",
            "caddy_container": "chenyida-erp-caddy-1",
            "caddy_container_id": "4" * 64,
            "caddy_image_digest": f"sha256:{'5' * 64}",
            "backend_network": "chenyida-erp_backend",
            "edge_network": "chenyida-erp_edge",
            "reader_gid": 1234,
            "database_name": "chenyida_erp",
            "database_oid": "16384",
            "database_system_identifier": "7612345678901234567",
            "database_marker": "chenyida-erp-deployment/v2:UAT:chenyida-erp",
            "control_role": "postgres",
            "deployment_created_at": "2026-08-15T01:42:00.000Z",
            "deployment_expires_at": "2026-08-15T01:50:00.000Z",
            "requester_identity_sha256": "6" * 64,
            "approver_identity_sha256": "7" * 64,
            "executor_identity_sha256": "8" * 64,
            "policy_file_sha256": supervisor.UAT_PROMOTION_POLICY_FILE_SHA256,
            "policy_sha256": supervisor.UAT_PROMOTION_POLICY_SHA256,
        }

    def compose_deployment_authorization(self, bundle_digest, now):
        return {
            "schema_version": 6,
            "contract": supervisor.UAT_PROMOTION_AUTHORIZATION_CONTRACT,
            "authorization_id": "promotion-supervisor-compose-deployment",
            "created_at": utc(now),
            "expires_at": utc(now + timedelta(minutes=8)),
            "supervisor_bundle_sha256": bundle_digest,
            "operation": "DEPLOY_UAT_RELEASE",
            "parameters": self.compose_deployment_parameters(),
            "nonce": "f" * 64,
            "confirmation": supervisor.UAT_PROMOTION_CONFIRMATIONS["DEPLOY_UAT_RELEASE"],
        }

    def postdeploy_parameters(self, identity=False):
        promotion_id = "promotion-supervisor-fixture"
        deployment_id = "promotion-supervisor-compose-deployment"
        deployment_result_sha256 = "2" * 64
        transfer_sha256 = "3" * 64
        manifest = "/var/lib/chenyida-erp/release-artifacts/promotion-supervisor/release-manifest.json"
        value = {
            "promotion_state_root": str(supervisor.UAT_PROMOTION_STATE_ROOT),
            "promotion_id": promotion_id,
            "promotion_generation": 1,
            "previous_checkpoint_receipt_sha256": "1" * 64,
            "promotion_intent_sha256": "4" * 64,
            "promotion_original_authorization_sha256": "5" * 64,
            "candidate_binding_sha256": "6" * 64,
            "database_binding_sha256": "7" * 64,
            "runtime_binding_sha256": "8" * 64,
            "preupgrade_recovery_binding_sha256": "9" * 64,
            "promotion_snapshot_binding_sha256": "a" * 64,
            "writer_quiesce_binding_sha256": "b" * 64,
            "migration_authorization_binding_sha256": "c" * 64,
            "migration_fence_binding_sha256": "d" * 64,
            "migration_result_binding_sha256": "e" * 64,
            "compose_deployment_binding_sha256": "f" * 64,
            "current_checkpoint_source": self.source(str(supervisor.UAT_PROMOTION_CURRENT_FILE), seed="a"),
            "deployment_operation_id": deployment_id,
            "deployment_result_sha256": deployment_result_sha256,
            "deployment_result_source": self.source(
                f"{supervisor.UAT_PROMOTION_STATE_ROOT}/results/{deployment_id}.{deployment_result_sha256}.json",
                seed="b",
            ),
            "fence_transfer_sha256": transfer_sha256,
            "fence_transfer_source": self.source(
                f"{supervisor.UAT_PROMOTION_FENCE_TRANSFERS_ROOT}/{deployment_id}.{transfer_sha256}.json",
                seed="c",
            ),
            "release_manifest": manifest,
            "release_manifest_sha256": "7" * 64,
            "release_manifest_source": self.source(manifest, mode="0440", seed="7"),
            "deployment_class": "UAT",
            "deployment_id": "chenyida-erp",
            "compose_project": "chenyida-erp",
            "compose_project_root": "/opt/erp/chenyida_erp_site",
            "runtime_guard_contract": supervisor.RUNTIME_GUARD_CONTRACT,
            "runtime_guard_mode": supervisor.POST_DEPLOY_RUNTIME_GUARD_MODE,
            "runtime_policy_sha256": supervisor.RUNTIME_POLICY_SHA256,
            "reader_gid": 1234,
            "caddy_container": "chenyida-erp-caddy-1",
            "postgres_container": "chenyida-erp-postgres-1",
            "web_container": "chenyida-erp-web-1",
            "worker_container": "chenyida-erp-worker-1",
            "verification_created_at": "2026-08-15T01:43:00.000Z",
            "verification_expires_at": "2026-08-15T01:48:00.000Z",
            "requester_identity_sha256": "1" * 64,
            "approver_identity_sha256": "2" * 64,
            "executor_identity_sha256": "3" * 64,
            "policy_file_sha256": supervisor.UAT_PROMOTION_POLICY_FILE_SHA256,
            "policy_sha256": supervisor.UAT_PROMOTION_POLICY_SHA256,
        }
        if not identity:
            value.update({
                "probe_root": str(supervisor.RUNTIME_PROBE_ROOT),
                "probe_id": "promotion-supervisor-runtime-probe",
            })
            return value
        probe_id = "promotion-supervisor-runtime-probe"
        runtime_intent_sha256 = "4" * 64
        runtime_result_sha256 = "5" * 64
        run_id = "promotion-supervisor-postdeploy-identity"
        value.update({
            "previous_checkpoint_receipt_sha256": "6" * 64,
            "runtime_probe_operation_id": probe_id,
            "runtime_probe_intent_sha256": runtime_intent_sha256,
            "runtime_probe_intent_source": self.source(
                f"{supervisor.UAT_PROMOTION_STATE_ROOT}/intents/{probe_id}.{runtime_intent_sha256}.json",
                seed="a",
            ),
            "runtime_probe_result_sha256": runtime_result_sha256,
            "runtime_probe_result_source": self.source(
                f"{supervisor.UAT_PROMOTION_STATE_ROOT}/results/{probe_id}.{runtime_result_sha256}.json",
                seed="5",
            ),
            "runtime_probe_receipt": str(
                supervisor.RUNTIME_PROBE_ROOT / f"{probe_id}.runtime-configuration-probe.json"
            ),
            "runtime_probe_receipt_sha256": runtime_result_sha256,
            "runtime_probe_receipt_source": self.source(
                str(supervisor.RUNTIME_PROBE_ROOT / f"{probe_id}.runtime-configuration-probe.json"),
                seed="5",
            ),
            "runtime_configuration_sha256": "6" * 64,
            "postdeploy_root": str(supervisor.POSTDEPLOY_ROOT_BASE / run_id),
            "identity_root": str(supervisor.RELEASE_IDENTITY_ROOT),
            "run_id": run_id,
        })
        return value

    def postdeploy_authorization(self, bundle_digest, identity=False):
        parameters = self.postdeploy_parameters(identity)
        operation = "VERIFY_UAT_POSTDEPLOY_IDENTITY" if identity \
            else "VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION"
        identifier = parameters["run_id"] if identity else parameters["probe_id"]
        created = datetime(2026, 8, 15, 1, 43, tzinfo=timezone.utc)
        return {
            "schema_version": 6,
            "contract": supervisor.UAT_PROMOTION_AUTHORIZATION_CONTRACT,
            "authorization_id": identifier,
            "created_at": utc(created),
            "expires_at": utc(created + timedelta(minutes=5)),
            "supervisor_bundle_sha256": bundle_digest,
            "operation": operation,
            "parameters": parameters,
            "nonce": "f" * 64,
            "confirmation": supervisor.UAT_PROMOTION_CONFIRMATIONS[operation],
        }

    def test_postdeploy_authorizations_accept_distinct_contract_and_raw_source_digests(self):
        bundle = "f" * 64
        now = datetime(2026, 8, 15, 1, 43, tzinfo=timezone.utc)
        runtime = self.postdeploy_authorization(bundle)
        identity = self.postdeploy_authorization(bundle, identity=True)
        self.assertEqual(supervisor.validate_authorization(runtime, bundle, now), runtime)
        self.assertEqual(supervisor.validate_authorization(identity, bundle, now), identity)
        runtime_context = supervisor.uat_promotion_context(runtime, "8" * 64)
        identity_context = supervisor.uat_promotion_context(identity, "9" * 64)
        self.assertEqual(runtime_context["operation"], "POSTDEPLOY_RUNTIME_CONFIGURATION")
        self.assertEqual(identity_context["operation"], "POSTDEPLOY_IDENTITY")
        self.assertNotEqual(runtime_context["operation_id"], identity_context["operation_id"])
        self.assertNotEqual(
            identity["parameters"]["runtime_probe_intent_source"]["sha256"],
            identity["parameters"]["runtime_probe_intent_sha256"],
        )
        changed_manifest = {
            **runtime,
            "parameters": {
                **runtime["parameters"],
                "release_manifest_source": {
                    **runtime["parameters"]["release_manifest_source"], "sha256": "9" * 64,
                },
            },
        }
        with self.assertRaisesRegex(
                supervisor.SupervisorError, "SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_SOURCE_BINDING_INVALID"):
            supervisor.validate_authorization(changed_manifest, bundle, now)

    def test_postdeploy_journal_failure_attempts_containment_after_authorization_consumption(self):
        bundle = "f" * 64
        authorization = self.postdeploy_authorization(bundle)
        events = []

        def runner(_node, _bundle, _context, phase, _lock, **kwargs):
            events.append(phase)
            if phase == "prepare":
                return {"result": "PREPARED", "intent_sha256": "7" * 64}
            if phase == "execute":
                raise supervisor.SupervisorError("JOURNAL_EXECUTION_FAILED")
            self.assertEqual(kwargs, {
                "failure_stage": "JOURNAL_EXECUTION",
                "failure_code": "UAT_PROMOTION_POSTDEPLOY_JOURNAL_EXECUTION_FAILED",
            })
            return {"result": "CONTAINED"}

        patches = [
            patch.object(
                supervisor, "verify_uat_promotion_postdeploy_sources",
                side_effect=lambda *_: events.append("postdeploy-sources"),
            ),
            patch.object(
                supervisor, "prepare_runtime_privilege_node",
                side_effect=lambda *_: (events.append("node") or (
                    Path("/tmp/runtime"), Path("/tmp/runtime/node"),
                )),
            ),
            patch.object(supervisor, "run_uat_promotion_runner", side_effect=runner),
            patch.object(supervisor, "consume_authorization", side_effect=lambda *_: events.append("consume")),
            patch.object(
                supervisor, "run_uat_promotion_postdeploy_control",
                side_effect=lambda node, *_: (
                    self.assertEqual(node, Path("/tmp/runtime/node"))
                    or events.append("control")
                    or {"probe_sha256": "6" * 64}
                ),
            ),
            patch.object(
                supervisor, "cleanup_runtime_privilege_node", side_effect=lambda *_: events.append("cleanup"),
            ),
        ]
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5]:
            with self.assertRaisesRegex(supervisor.SupervisorError, "JOURNAL_EXECUTION_FAILED"):
                supervisor.run_uat_promotion_authorization(
                    Path("/trusted/bundle"), Path("/trusted/pending/postdeploy.json"),
                    authorization, "8" * 64, lock_descriptor=51,
                )
        self.assertEqual(events, [
            "postdeploy-sources", "node", "prepare", "postdeploy-sources", "consume",
            "postdeploy-sources", "control", "execute", "contain", "cleanup",
        ])

    def test_postdeploy_source_drift_after_consumption_is_contained_with_exact_stage(self):
        authorization = self.postdeploy_authorization("f" * 64)
        events = []
        source_checks = 0

        def verify(*_):
            nonlocal source_checks
            source_checks += 1
            events.append(f"source-{source_checks}")
            if source_checks == 3:
                raise supervisor.SupervisorError("POST_CONSUME_SOURCE_DRIFT")

        def runner(_node, _bundle, _context, phase, _lock, **kwargs):
            events.append(phase)
            if phase == "prepare":
                return {"result": "PREPARED", "intent_sha256": "7" * 64}
            self.assertEqual(phase, "contain")
            self.assertEqual(kwargs, {
                "failure_stage": "POST_AUTHORIZATION_SOURCE_RECHECK",
                "failure_code": "UAT_PROMOTION_POSTDEPLOY_POST_AUTHORIZATION_SOURCE_RECHECK_FAILED",
            })
            return {"result": "CONTAINED"}

        with patch.object(supervisor, "verify_uat_promotion_postdeploy_sources", side_effect=verify), \
                patch.object(supervisor, "prepare_runtime_privilege_node", return_value=(
                    Path("/tmp/runtime"), Path("/tmp/runtime/node"),
                )), \
                patch.object(supervisor, "run_uat_promotion_runner", side_effect=runner), \
                patch.object(supervisor, "consume_authorization", side_effect=lambda *_: events.append("consume")), \
                patch.object(supervisor, "run_uat_promotion_postdeploy_control") as control, \
                patch.object(supervisor, "cleanup_runtime_privilege_node", side_effect=lambda *_: events.append("cleanup")):
            with self.assertRaisesRegex(supervisor.SupervisorError, "POST_CONSUME_SOURCE_DRIFT"):
                supervisor.run_uat_promotion_authorization(
                    Path("/trusted/bundle"), Path("/trusted/pending/postdeploy.json"),
                    authorization, "8" * 64, lock_descriptor=51,
                )
        control.assert_not_called()
        self.assertEqual(events, [
            "source-1", "prepare", "source-2", "consume", "source-3", "contain", "cleanup",
        ])

    def test_postdeploy_crosscheck_containment_failure_is_not_suppressed(self):
        authorization = self.postdeploy_authorization("f" * 64)
        events = []

        def runner(_node, _bundle, _context, phase, _lock, **kwargs):
            events.append(phase)
            if phase == "prepare":
                return {"result": "PREPARED", "intent_sha256": "7" * 64}
            if phase == "execute":
                return {"runtime_probe_result_sha256": "5" * 64}
            self.assertEqual(kwargs, {
                "failure_stage": "RESULT_CROSSCHECK",
                "failure_code": "UAT_PROMOTION_POSTDEPLOY_RESULT_CROSSCHECK_FAILED",
            })
            raise supervisor.SupervisorError("CONTAINMENT_RECORD_FAILED")

        with patch.object(supervisor, "verify_uat_promotion_postdeploy_sources"), \
                patch.object(supervisor, "prepare_runtime_privilege_node", return_value=(
                    Path("/tmp/runtime"), Path("/tmp/runtime/node"),
                )), \
                patch.object(supervisor, "run_uat_promotion_runner", side_effect=runner), \
                patch.object(supervisor, "consume_authorization"), \
                patch.object(supervisor, "run_uat_promotion_postdeploy_control", return_value={
                    "probe_sha256": "6" * 64,
                }), \
                patch.object(supervisor, "cleanup_runtime_privilege_node"):
            with self.assertRaisesRegex(supervisor.SupervisorError, "CONTAINMENT_RECORD_FAILED"):
                supervisor.run_uat_promotion_authorization(
                    Path("/trusted/bundle"), Path("/trusted/pending/postdeploy.json"),
                    authorization, "8" * 64, lock_descriptor=51,
                )
        self.assertEqual(events, ["prepare", "execute", "contain"])

    def test_committed_postdeploy_anomaly_blocks_the_global_release_interlock(self):
        with tempfile.TemporaryDirectory(prefix="cyd-uat-promotion-anomaly-") as temporary:
            root = Path(temporary)
            root.chmod(0o700)
            marker = root / supervisor.UAT_PROMOTION_STATE_MARKER
            marker.write_bytes(supervisor.UAT_PROMOTION_STATE_MARKER_VALUE)
            marker.chmod(0o400)
            containment_root = root / "containments"
            containment_root.mkdir(mode=0o700)
            body = {
                "schema_version": 1,
                "contract": "chenyida-erp-uat-promotion-postdeploy-containment/v1",
                "status": "POSTDEPLOY_COMMITTED_SUPERVISOR_ANOMALY",
                "contained_at": "2026-08-15T01:43:32.000Z",
                "operation": "POSTDEPLOY_RUNTIME_CONFIGURATION",
                "operation_id": "promotion-supervisor-runtime-probe",
                "promotion_id": "promotion-supervisor-fixture",
                "intent_sha256": "1" * 64,
                "execution_authorization_sha256": "2" * 64,
                "preserved_checkpoint_receipt_sha256": "3" * 64,
                "deployment_result_sha256": "4" * 64,
                "fence_transfer_sha256": "5" * 64,
                "observed_checkpoint_id": "POST_DEPLOY_RUNTIME_CONFIGURATION",
                "observed_checkpoint_ordinal": 10,
                "external_artifact_state": "TRUSTED_FINAL_ARTIFACT_PRESENT",
                "failure_stage": "RESULT_CROSSCHECK",
                "failure_code": "UAT_PROMOTION_POSTDEPLOY_RESULT_CROSSCHECK_FAILED",
                "preservation": (
                    "COMMITTED_POSTDEPLOY_CHECKPOINT_LEFT_UNCHANGED_NO_ROLLBACK_NO_DELETE_NO_DATABASE_ACTION"
                ),
            }
            digest = supervisor.sha256(supervisor.canonical_json(body))
            record = {**body, "containment_sha256": digest}
            record_path = containment_root / f"{body['operation_id']}.{digest}.json"
            record_path.write_bytes(supervisor.canonical_json(record))
            record_path.chmod(0o400)
            with patch.object(supervisor, "UAT_PROMOTION_STATE_ROOT", root):
                with self.assertRaisesRegex(
                        supervisor.SupervisorError,
                        "SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_ANOMALY_REQUIRES_REVIEW"):
                    supervisor.assert_no_uat_migration_execution_interlock({}, None)

    def test_postdeploy_timeout_signals_the_exact_process_group_before_failure(self):
        authorization = self.postdeploy_authorization("f" * 64)
        context = supervisor.uat_promotion_context(authorization, "8" * 64)
        calls = []

        class Process:
            pid = 43210
            returncode = -15

            def communicate(self, timeout=None):
                calls.append(("communicate", timeout))
                if timeout == 8 * 60:
                    raise supervisor.subprocess.TimeoutExpired("postdeploy", timeout)
                return b"", b""

        captured = {}

        def popen(command, **kwargs):
            captured["command"] = command
            captured.update(kwargs)
            return Process()

        with patch.object(supervisor.subprocess, "Popen", side_effect=popen), \
                patch.object(supervisor.os, "killpg", side_effect=lambda pid, sig: calls.append((pid, sig))):
            with self.assertRaisesRegex(
                    supervisor.SupervisorError, "SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_CONTROL_FAILED"):
                supervisor.run_uat_promotion_postdeploy_control(
                    Path("/tmp/chenyida-erp-runtime-privilege-node.fixture/node"),
                    Path("/trusted/bundle"), context, 51,
                )
        self.assertTrue(captured["start_new_session"])
        self.assertEqual(
            captured["env"]["ERP_RELEASE_SUPERVISOR_NODE_RUNTIME"],
            "/tmp/chenyida-erp-runtime-privilege-node.fixture/node",
        )
        self.assertIn((43210, supervisor.signal.SIGTERM), calls)
        self.assertNotIn((43210, supervisor.signal.SIGKILL), calls)

    def test_v6_authorization_is_exact_and_recovery_binds_the_original_intent(self):
        bundle = "f" * 64
        original_now = datetime(2026, 8, 15, 1, 1, tzinfo=timezone.utc)
        original = self.authorization(bundle, original_now)
        self.assertEqual(supervisor.validate_authorization(original, bundle, original_now), original)
        context = supervisor.uat_promotion_context(original, "1" * 64)
        self.assertEqual(context["execution_mode"], "ORIGINAL")
        self.assertEqual(context["operation_id"], original["authorization_id"])
        self.assertEqual(set(context["parameters"]), supervisor.UAT_PROMOTION_BASE_PARAMETER_FIELDS)

        recovery_now = datetime(2026, 8, 15, 2, 0, tzinfo=timezone.utc)
        recovery = self.authorization(bundle, recovery_now, recovery=True)
        self.assertEqual(supervisor.validate_authorization(recovery, bundle, recovery_now), recovery)
        recovery_context = supervisor.uat_promotion_context(recovery, "2" * 64)
        self.assertEqual(recovery_context["execution_mode"], "RECOVERY")
        self.assertEqual(recovery_context["operation_id"], original["authorization_id"])
        self.assertEqual(recovery_context["expected_intent_sha256"], "d" * 64)

        extra = {**original, "parameters": {**original["parameters"], "command": "/bin/sh"}}
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_UAT_PROMOTION_PARAMETERS_INVALID"):
            supervisor.validate_authorization(extra, bundle, original_now)
        reused_actor = {**original, "parameters": {**original["parameters"], "executor_identity_sha256": original["parameters"]["approver_identity_sha256"]}}
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_UAT_PROMOTION_ACTORS_INVALID"):
            supervisor.validate_authorization(reused_actor, bundle, original_now)

    def test_recovery_requires_the_exact_consumed_v6_authorization(self):
        bundle = "f" * 64
        now = datetime(2026, 8, 15, 1, 1, tzinfo=timezone.utc)
        original = self.authorization(bundle, now)
        raw = supervisor.canonical_json(original)
        digest = supervisor.sha256(raw)
        recovery_parameters = self.parameters(recovery=True)
        recovery_parameters["original_authorization_sha256"] = digest
        with tempfile.TemporaryDirectory(prefix="cyd-uat-promotion-consumed-") as temporary:
            consumed = Path(temporary)
            consumed.chmod(0o700)
            file = consumed / f"{original['authorization_id']}.{digest}.json"
            file.write_bytes(raw)
            file.chmod(0o400)
            self.assertEqual(
                supervisor.validate_original_uat_promotion_authorization_consumed(recovery_parameters, bundle, consumed),
                original,
            )
            changed = {**recovery_parameters, "git_tree": "c" * 40}
            with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_UAT_PROMOTION_ORIGINAL_AUTHORIZATION_INVALID"):
                supervisor.validate_original_uat_promotion_authorization_consumed(changed, bundle, consumed)

    def test_supervisor_persists_before_consumption_for_original_and_recovery(self):
        bundle = "f" * 64
        now = datetime(2026, 8, 15, 1, 1, tzinfo=timezone.utc)
        for recovery in (False, True):
            authorization = self.authorization(bundle, datetime(2026, 8, 15, 2, 0, tzinfo=timezone.utc) if recovery else now, recovery)
            authorization_digest = "1" * 64 if not recovery else "2" * 64
            context = supervisor.uat_promotion_context(authorization, authorization_digest)
            events = []

            def runner(_node, _bundle, _context, phase, _lock):
                events.append(phase)
                if phase == "recover-prepare":
                    return {"result": "RECOVERY_PREPARED"}
                return {"result": "COMMITTED"}

            patches = [
                patch.object(supervisor, "prepare_runtime_privilege_node", side_effect=lambda *_: (events.append("node") or (Path("/tmp/runtime"), Path("/tmp/runtime/node")))),
                patch.object(supervisor, "run_uat_promotion_runner", side_effect=runner),
                patch.object(supervisor, "consume_authorization", side_effect=lambda *_: events.append("consume")),
                patch.object(supervisor, "cleanup_runtime_privilege_node", side_effect=lambda *_: events.append("cleanup")),
            ]
            if recovery:
                patches.append(patch.object(supervisor, "validate_original_uat_promotion_authorization_consumed", side_effect=lambda *_: events.append("original-consumed")))
            else:
                patches.append(patch.object(supervisor, "validate_uat_promotion_source_documents", side_effect=lambda *_: events.append("sources")))
            with patches[0], patches[1], patches[2], patches[3], patches[4]:
                supervisor.run_uat_promotion_authorization(
                    Path("/trusted/bundle"), Path("/trusted/pending/promotion.json"), authorization,
                    authorization_digest, lock_descriptor=51,
                )
            if recovery:
                self.assertEqual(events, ["original-consumed", "node", "recover-prepare", "consume", "recover-execute", "cleanup"])
            else:
                self.assertEqual(events, ["sources", "node", "prepare", "sources", "consume", "sources", "execute", "cleanup"])

    def test_snapshot_authorization_is_distinct_exact_and_recoverable(self):
        bundle = "f" * 64
        now = datetime(2026, 8, 15, 1, 10, tzinfo=timezone.utc)
        capture = self.snapshot_authorization(bundle, now)
        self.assertEqual(supervisor.validate_authorization(capture, bundle, now), capture)
        context = supervisor.uat_promotion_context(capture, "1" * 64)
        self.assertEqual(context["operation"], "CAPTURE_SNAPSHOT")
        self.assertEqual(context["operation_id"], capture["authorization_id"])
        self.assertEqual(set(context["parameters"]), supervisor.UAT_PROMOTION_SNAPSHOT_PARAMETER_FIELDS)

        recovery_now = datetime(2026, 8, 15, 1, 35, tzinfo=timezone.utc)
        recovery = self.snapshot_authorization(bundle, recovery_now, recovery=True)
        self.assertEqual(supervisor.validate_authorization(recovery, bundle, recovery_now), recovery)
        recovery_context = supervisor.uat_promotion_context(recovery, "2" * 64)
        self.assertEqual(recovery_context["operation"], "CAPTURE_SNAPSHOT")
        self.assertEqual(recovery_context["operation_id"], capture["authorization_id"])
        self.assertEqual(recovery_context["expected_intent_sha256"], "a" * 64)

        reused_id = {**capture, "authorization_id": capture["parameters"]["promotion_id"]}
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_UAT_PROMOTION_TIME_INVALID"):
            supervisor.validate_authorization(reused_id, bundle, now)
        missing_domain = {**capture, "parameters": {**capture["parameters"], "snapshot_objects": {k: v for k, v in capture["parameters"]["snapshot_objects"].items() if k != "backup_status"}}}
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_UAT_PROMOTION_SNAPSHOT_OBJECTS_INVALID"):
            supervisor.validate_authorization(missing_domain, bundle, now)

    def test_snapshot_recovery_requires_exact_consumed_capture_and_persists_before_consume(self):
        bundle = "f" * 64
        now = datetime(2026, 8, 15, 1, 10, tzinfo=timezone.utc)
        capture = self.snapshot_authorization(bundle, now)
        raw = supervisor.canonical_json(capture)
        capture_digest = supervisor.sha256(raw)
        recovery_parameters = self.snapshot_parameters(recovery=True)
        recovery_parameters["original_authorization_sha256"] = capture_digest
        with tempfile.TemporaryDirectory(prefix="cyd-uat-snapshot-consumed-") as temporary:
            consumed = Path(temporary)
            consumed.chmod(0o700)
            file = consumed / f"{capture['authorization_id']}.{capture_digest}.json"
            file.write_bytes(raw)
            file.chmod(0o400)
            self.assertEqual(
                supervisor.validate_original_uat_promotion_authorization_consumed(recovery_parameters, bundle, consumed),
                capture,
            )
            changed = {**recovery_parameters, "snapshot_restore_run_id": "different-restore"}
            with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_UAT_PROMOTION_ORIGINAL_AUTHORIZATION_INVALID"):
                supervisor.validate_original_uat_promotion_authorization_consumed(changed, bundle, consumed)

        events = []
        capture_digest = "1" * 64
        patches = [
            patch.object(supervisor, "verify_uat_promotion_snapshot_sources", side_effect=lambda *_: events.append("snapshot-sources")),
            patch.object(supervisor, "prepare_runtime_privilege_node", side_effect=lambda *_: (events.append("node") or (Path("/tmp/runtime"), Path("/tmp/runtime/node")))),
            patch.object(supervisor, "run_uat_promotion_runner", side_effect=lambda _node, _bundle, _context, phase, _lock: (events.append(phase) or {"result": "COMMITTED"})),
            patch.object(supervisor, "consume_authorization", side_effect=lambda *_: events.append("consume")),
            patch.object(supervisor, "cleanup_runtime_privilege_node", side_effect=lambda *_: events.append("cleanup")),
        ]
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            supervisor.run_uat_promotion_authorization(
                Path("/trusted/bundle"), Path("/trusted/pending/snapshot.json"), capture,
                capture_digest, lock_descriptor=51,
            )
        self.assertEqual(events, ["snapshot-sources", "node", "prepare", "snapshot-sources", "consume", "snapshot-sources", "execute", "cleanup"])

    def test_quiesce_authorization_is_exact_distinct_and_recoverable(self):
        bundle = "f" * 64
        now = datetime(2026, 8, 15, 1, 32, tzinfo=timezone.utc)
        authorization = self.quiesce_authorization(bundle, now)
        self.assertEqual(supervisor.validate_authorization(authorization, bundle, now), authorization)
        context = supervisor.uat_promotion_context(authorization, "1" * 64)
        self.assertEqual(context["operation"], "QUIESCE_WRITERS")
        self.assertEqual(context["operation_id"], authorization["authorization_id"])
        self.assertEqual(set(context["parameters"]), supervisor.UAT_PROMOTION_QUIESCE_PARAMETER_FIELDS)

        recovery_now = datetime(2026, 8, 15, 1, 40, tzinfo=timezone.utc)
        recovery = self.quiesce_authorization(bundle, recovery_now, recovery=True)
        self.assertEqual(supervisor.validate_authorization(recovery, bundle, recovery_now), recovery)
        recovery_context = supervisor.uat_promotion_context(recovery, "2" * 64)
        self.assertEqual(recovery_context["operation"], "QUIESCE_WRITERS")
        self.assertEqual(recovery_context["operation_id"], authorization["authorization_id"])
        self.assertEqual(recovery_context["expected_intent_sha256"], "9" * 64)

        reused_snapshot_id = {**authorization, "authorization_id": authorization["parameters"]["snapshot_operation_id"]}
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_UAT_PROMOTION_TIME_INVALID"):
            supervisor.validate_authorization(reused_snapshot_id, bundle, now)
        invalid_container = {
            **authorization,
            "parameters": {**authorization["parameters"], "worker_container_id": "short"},
        }
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_UAT_PROMOTION_QUIESCE_CONTAINER_INVALID"):
            supervisor.validate_authorization(invalid_container, bundle, now)
        root_target = {
            **authorization,
            "parameters": {**authorization["parameters"], "compose_project_root": "/"},
        }
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_UAT_PROMOTION_QUIESCE_PROJECT_ROOT_INVALID"):
            supervisor.validate_authorization(root_target, bundle, now)

    def test_quiesce_requires_exact_consumed_authorization_and_rechecks_sources_around_consumption(self):
        bundle = "f" * 64
        now = datetime(2026, 8, 15, 1, 32, tzinfo=timezone.utc)
        authorization = self.quiesce_authorization(bundle, now)
        raw = supervisor.canonical_json(authorization)
        authorization_digest = supervisor.sha256(raw)
        recovery_parameters = self.quiesce_parameters(recovery=True)
        recovery_parameters["original_authorization_sha256"] = authorization_digest
        with tempfile.TemporaryDirectory(prefix="cyd-uat-quiesce-consumed-") as temporary:
            consumed = Path(temporary)
            consumed.chmod(0o700)
            file = consumed / f"{authorization['authorization_id']}.{authorization_digest}.json"
            file.write_bytes(raw)
            file.chmod(0o400)
            self.assertEqual(
                supervisor.validate_original_uat_promotion_authorization_consumed(recovery_parameters, bundle, consumed),
                authorization,
            )
            changed = {**recovery_parameters, "compose_project_root": "/opt/erp/replaced"}
            with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_UAT_PROMOTION_ORIGINAL_AUTHORIZATION_INVALID"):
                supervisor.validate_original_uat_promotion_authorization_consumed(changed, bundle, consumed)

        events = []
        patches = [
            patch.object(supervisor, "verify_uat_promotion_quiesce_sources", side_effect=lambda *_: events.append("quiesce-sources")),
            patch.object(supervisor, "prepare_runtime_privilege_node", side_effect=lambda *_: (events.append("node") or (Path("/tmp/runtime"), Path("/tmp/runtime/node")))),
            patch.object(supervisor, "run_uat_promotion_runner", side_effect=lambda _node, _bundle, _context, phase, _lock: (events.append(phase) or {"result": "COMMITTED"})),
            patch.object(supervisor, "consume_authorization", side_effect=lambda *_: events.append("consume")),
            patch.object(supervisor, "cleanup_runtime_privilege_node", side_effect=lambda *_: events.append("cleanup")),
        ]
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            supervisor.run_uat_promotion_authorization(
                Path("/trusted/bundle"), Path("/trusted/pending/quiesce.json"), authorization,
                "1" * 64, lock_descriptor=51,
            )
        self.assertEqual(
            events,
            ["quiesce-sources", "node", "prepare", "quiesce-sources", "consume", "quiesce-sources", "execute", "cleanup"],
        )

    def test_migration_approval_authorization_is_exact_distinct_and_approval_only(self):
        bundle = "f" * 64
        now = datetime(2026, 8, 15, 1, 37, tzinfo=timezone.utc)
        authorization = self.migration_authorization(bundle, now)
        self.assertEqual(supervisor.validate_authorization(authorization, bundle, now), authorization)
        context = supervisor.uat_promotion_context(authorization, "1" * 64)
        self.assertEqual(context["operation"], "MIGRATION_AUTHORIZATION")
        self.assertEqual(context["operation_id"], authorization["authorization_id"])
        self.assertEqual(
            set(context["parameters"]), supervisor.UAT_PROMOTION_MIGRATION_AUTHORIZATION_PARAMETER_FIELDS,
        )
        self.assertIn("APPROVAL_ONLY_NO_SQL", authorization["confirmation"])

        recovery_now = datetime(2026, 8, 15, 1, 40, tzinfo=timezone.utc)
        recovery = self.migration_authorization(bundle, recovery_now, recovery=True)
        self.assertEqual(supervisor.validate_authorization(recovery, bundle, recovery_now), recovery)
        recovery_context = supervisor.uat_promotion_context(recovery, "2" * 64)
        self.assertEqual(recovery_context["operation"], "MIGRATION_AUTHORIZATION")
        self.assertEqual(recovery_context["operation_id"], authorization["authorization_id"])
        self.assertEqual(recovery_context["expected_intent_sha256"], "e" * 64)

        reused_quiesce_id = {
            **authorization,
            "authorization_id": authorization["parameters"]["quiesce_operation_id"],
        }
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_UAT_PROMOTION_TIME_INVALID"):
            supervisor.validate_authorization(reused_quiesce_id, bundle, now)
        crossed_manifest = {
            **authorization,
            "parameters": {
                **authorization["parameters"],
                "release_manifest_sha256": "c" * 64,
            },
        }
        with self.assertRaisesRegex(
                supervisor.SupervisorError,
                "SUPERVISOR_UAT_PROMOTION_MIGRATION_AUTHORIZATION_SOURCE_BINDING_INVALID"):
            supervisor.validate_authorization(crossed_manifest, bundle, now)

    def test_migration_approval_requires_exact_consumed_authorization_and_rechecks_sources(self):
        bundle = "f" * 64
        now = datetime(2026, 8, 15, 1, 37, tzinfo=timezone.utc)
        authorization = self.migration_authorization(bundle, now)
        raw = supervisor.canonical_json(authorization)
        authorization_digest = supervisor.sha256(raw)
        recovery_parameters = self.migration_authorization_parameters(recovery=True)
        recovery_parameters["original_authorization_sha256"] = authorization_digest
        with tempfile.TemporaryDirectory(prefix="cyd-uat-migration-authorization-consumed-") as temporary:
            consumed = Path(temporary)
            consumed.chmod(0o700)
            file = consumed / f"{authorization['authorization_id']}.{authorization_digest}.json"
            file.write_bytes(raw)
            file.chmod(0o400)
            self.assertEqual(
                supervisor.validate_original_uat_promotion_authorization_consumed(
                    recovery_parameters, bundle, consumed,
                ),
                authorization,
            )
            changed = {**recovery_parameters, "migration_role": "different_owner"}
            with self.assertRaisesRegex(
                    supervisor.SupervisorError, "SUPERVISOR_UAT_PROMOTION_ORIGINAL_AUTHORIZATION_INVALID"):
                supervisor.validate_original_uat_promotion_authorization_consumed(changed, bundle, consumed)

        events = []
        patches = [
            patch.object(
                supervisor, "verify_uat_promotion_migration_authorization_sources",
                side_effect=lambda *_: events.append("migration-authorization-sources"),
            ),
            patch.object(
                supervisor, "prepare_runtime_privilege_node",
                side_effect=lambda *_: (
                    events.append("node") or (Path("/tmp/runtime"), Path("/tmp/runtime/node"))
                ),
            ),
            patch.object(
                supervisor, "run_uat_promotion_runner",
                side_effect=lambda _node, _bundle, _context, phase, _lock: (
                    events.append(phase) or {"result": "COMMITTED"}
                ),
            ),
            patch.object(supervisor, "consume_authorization", side_effect=lambda *_: events.append("consume")),
            patch.object(
                supervisor, "cleanup_runtime_privilege_node", side_effect=lambda *_: events.append("cleanup"),
            ),
        ]
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            supervisor.run_uat_promotion_authorization(
                Path("/trusted/bundle"), Path("/trusted/pending/migration-authorization.json"),
                authorization, "1" * 64, lock_descriptor=51,
            )
        self.assertEqual(events, [
            "migration-authorization-sources", "node", "prepare", "migration-authorization-sources",
            "consume", "migration-authorization-sources", "execute", "cleanup",
        ])

    def test_migration_execution_authorization_is_separate_exact_and_recoverable(self):
        bundle = "f" * 64
        now = datetime(2026, 8, 15, 1, 40, tzinfo=timezone.utc)
        authorization = self.migration_execution_authorization(bundle, now)
        self.assertEqual(supervisor.validate_authorization(authorization, bundle, now), authorization)
        context = supervisor.uat_promotion_context(authorization, "1" * 64)
        self.assertEqual(context["operation"], "MIGRATION_EXECUTION")
        self.assertEqual(set(context["parameters"]), supervisor.UAT_PROMOTION_MIGRATION_EXECUTION_PARAMETER_FIELDS)
        self.assertNotEqual(
            supervisor.sha256(supervisor.canonical_json(authorization)),
            authorization["parameters"]["migration_approval_authorization_sha256"],
        )

        recovery_now = datetime(2026, 8, 15, 1, 41, tzinfo=timezone.utc)
        recovery = self.migration_execution_authorization(bundle, recovery_now, recovery=True)
        self.assertEqual(supervisor.validate_authorization(recovery, bundle, recovery_now), recovery)
        recovery_context = supervisor.uat_promotion_context(recovery, "2" * 64)
        self.assertEqual(recovery_context["operation"], "MIGRATION_EXECUTION")
        self.assertEqual(recovery_context["operation_id"], "promotion-supervisor-migration-execution")
        self.assertEqual(recovery_context["expected_intent_sha256"], "a" * 64)

        reused_approval_id = {
            **authorization,
            "authorization_id": authorization["parameters"]["migration_authorization_operation_id"],
        }
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_UAT_PROMOTION_TIME_INVALID"):
            supervisor.validate_authorization(reused_approval_id, bundle, now)
        wrong_network = {
            **authorization,
            "parameters": {**authorization["parameters"], "backend_network": "other_backend"},
        }
        with self.assertRaisesRegex(
                supervisor.SupervisorError, "SUPERVISOR_UAT_PROMOTION_MIGRATION_EXECUTION_TARGET_INVALID"):
            supervisor.validate_authorization(wrong_network, bundle, now)

    def test_compose_deployment_authorization_is_exact_and_source_bound(self):
        bundle = "f" * 64
        now = datetime(2026, 8, 15, 1, 42, tzinfo=timezone.utc)
        authorization = self.compose_deployment_authorization(bundle, now)
        self.assertEqual(supervisor.validate_authorization(authorization, bundle, now), authorization)
        context = supervisor.uat_promotion_context(authorization, "9" * 64)
        self.assertEqual(context["operation"], "COMPOSE_DEPLOYMENT")
        self.assertEqual(
            set(context["parameters"]), supervisor.UAT_PROMOTION_COMPOSE_DEPLOYMENT_PARAMETER_FIELDS,
        )
        self.assertIn("WEB_WORKER_ONLY", authorization["confirmation"])

        crossed_environment = {
            **authorization,
            "parameters": {
                **authorization["parameters"],
                "deployment_environment_sha256": "b" * 64,
            },
        }
        with self.assertRaisesRegex(
                supervisor.SupervisorError,
                "SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_SOURCE_BINDING_INVALID"):
            supervisor.validate_authorization(crossed_environment, bundle, now)

        protected_container = {
            **authorization,
            "parameters": {**authorization["parameters"], "postgres_container": "other-postgres"},
        }
        with self.assertRaisesRegex(
                supervisor.SupervisorError,
                "SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_TARGET_INVALID"):
            supervisor.validate_authorization(protected_container, bundle, now)

    def test_compose_deployment_consumes_before_control_and_binds_checkpoint_result(self):
        bundle = "f" * 64
        now = datetime(2026, 8, 15, 1, 42, tzinfo=timezone.utc)
        authorization = self.compose_deployment_authorization(bundle, now)
        events = []
        result_sha256 = "d" * 64
        transfer_sha256 = "e" * 64

        def runner(_node, _bundle, _context, phase, _lock):
            events.append(phase)
            if phase == "prepare":
                return {"result": "PREPARED", "intent_sha256": "c" * 64}
            return {
                "result": "COMMITTED",
                "deployment_result_sha256": result_sha256,
                "fence_transfer_sha256": transfer_sha256,
            }

        control = {
            "result": "COMPOSE_DEPLOYMENT_RESULT_PERSISTED",
            "promotion_id": authorization["parameters"]["promotion_id"],
            "deployment_result_sha256": result_sha256,
            "fence_transfer_sha256": transfer_sha256,
        }
        patches = [
            patch.object(
                supervisor, "verify_uat_promotion_compose_deployment_sources",
                side_effect=lambda *_: events.append("compose-deployment-sources"),
            ),
            patch.object(
                supervisor, "prepare_runtime_privilege_node",
                side_effect=lambda *_: (
                    events.append("node") or (Path("/tmp/runtime"), Path("/tmp/runtime/node"))
                ),
            ),
            patch.object(supervisor, "run_uat_promotion_runner", side_effect=runner),
            patch.object(supervisor, "consume_authorization", side_effect=lambda *_: events.append("consume")),
            patch.object(
                supervisor, "run_uat_promotion_compose_deployment_control",
                side_effect=lambda *_: (events.append("control") or control),
            ),
            patch.object(
                supervisor, "cleanup_runtime_privilege_node", side_effect=lambda *_: events.append("cleanup"),
            ),
        ]
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5]:
            result = supervisor.run_uat_promotion_authorization(
                Path("/trusted/bundle"), Path("/trusted/pending/compose-deployment.json"),
                authorization, "9" * 64, lock_descriptor=51,
            )
        self.assertEqual(result["deployment_result_sha256"], result_sha256)
        self.assertEqual(events, [
            "compose-deployment-sources", "node", "prepare", "compose-deployment-sources",
            "consume", "compose-deployment-sources", "control", "execute", "cleanup",
        ])

    def test_migration_execution_consumes_before_control_and_publishes_before_container_cleanup(self):
        bundle = "f" * 64
        now = datetime(2026, 8, 15, 1, 40, tzinfo=timezone.utc)
        authorization = self.migration_execution_authorization(bundle, now)
        events = []
        migration_result_sha256 = "7" * 64

        def runner(_node, _bundle, _context, phase, _lock):
            events.append(phase)
            if phase == "prepare":
                return {"result": "PREPARED", "grant_sha256": "6" * 64}
            return {"result": "COMMITTED", "migration_result_sha256": migration_result_sha256}

        control = {
            "migration_result_sha256": migration_result_sha256,
            "grant_sha256": "6" * 64,
            "container_id": "8" * 64,
            "container_name": "cyd-uat-migration-" + "9" * 24,
        }
        patches = [
            patch.object(
                supervisor, "verify_uat_promotion_migration_execution_sources",
                side_effect=lambda *_: events.append("migration-execution-sources"),
            ),
            patch.object(
                supervisor, "prepare_runtime_privilege_node",
                side_effect=lambda *_: (
                    events.append("node") or (Path("/tmp/runtime"), Path("/tmp/runtime/node"))
                ),
            ),
            patch.object(supervisor, "run_uat_promotion_runner", side_effect=runner),
            patch.object(supervisor, "consume_authorization", side_effect=lambda *_: events.append("consume")),
            patch.object(
                supervisor, "run_uat_promotion_migration_control",
                side_effect=lambda *_: (events.append("control") or control),
            ),
            patch.object(
                supervisor, "cleanup_uat_promotion_migration_container",
                side_effect=lambda *_: events.append("container-cleanup"),
            ),
            patch.object(
                supervisor, "cleanup_runtime_privilege_node", side_effect=lambda *_: events.append("cleanup"),
            ),
        ]
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = supervisor.run_uat_promotion_authorization(
                Path("/trusted/bundle"), Path("/trusted/pending/migration-execution.json"),
                authorization, "1" * 64, lock_descriptor=51,
            )
        self.assertEqual(result["migration_result_sha256"], migration_result_sha256)
        self.assertEqual(events, [
            "migration-execution-sources", "node", "prepare", "migration-execution-sources",
            "consume", "migration-execution-sources", "control", "execute", "container-cleanup", "cleanup",
        ])

    def test_pending_migration_execution_blocks_everything_except_its_exact_recovery(self):
        bundle = "f" * 64
        now = datetime(2026, 8, 15, 1, 41, tzinfo=timezone.utc)
        recovery = self.migration_execution_authorization(bundle, now, recovery=True)
        recovery["parameters"]["original_authorization_sha256"] = "d" * 64
        unrelated = self.authorization(bundle, datetime(2026, 8, 15, 1, 1, tzinfo=timezone.utc))
        with tempfile.TemporaryDirectory(prefix="cyd-uat-migration-interlock-") as temporary:
            root = Path(temporary) / "state"
            intents = root / "intents"
            intents.mkdir(parents=True, mode=0o700)
            root.chmod(0o700)
            intents.chmod(0o700)
            marker = root / supervisor.UAT_PROMOTION_STATE_MARKER
            marker.write_bytes(supervisor.UAT_PROMOTION_STATE_MARKER_VALUE)
            marker.chmod(0o400)
            intent = {
                "schema_version": 1,
                "contract": "chenyida-erp-uat-promotion-migration-execution-intent/v1",
                "migration_operation_id": "promotion-supervisor-migration-execution",
                "execution_authorization_sha256": "d" * 64,
                "migration_execution_intent_sha256": "a" * 64,
            }
            intent_file = intents / (
                f"{intent['migration_operation_id']}.{intent['migration_execution_intent_sha256']}.json"
            )
            intent_file.write_bytes(supervisor.canonical_json(intent))
            intent_file.chmod(0o400)
            current_file = root / "current.json"
            current_file.write_bytes(supervisor.canonical_json({"authorization_sha256_chain": ["c" * 64]}))
            current_file.chmod(0o400)
            with patch.object(supervisor, "UAT_PROMOTION_STATE_ROOT", root), \
                    patch.object(supervisor, "UAT_PROMOTION_CURRENT_FILE", current_file):
                with self.assertRaisesRegex(
                        supervisor.SupervisorError, "SUPERVISOR_UAT_PROMOTION_MIGRATION_RECOVERY_REQUIRED"):
                    supervisor.assert_no_uat_migration_execution_interlock(unrelated)
                supervisor.assert_no_uat_migration_execution_interlock(recovery)
                current_file.chmod(0o600)
                current_file.write_bytes(supervisor.canonical_json({"authorization_sha256_chain": ["d" * 64]}))
                current_file.chmod(0o400)
                supervisor.assert_no_uat_migration_execution_interlock(unrelated)

    def test_active_migration_fence_blocks_everything_except_its_exact_recovery(self):
        bundle = "f" * 64
        now = datetime(2026, 8, 15, 1, 41, tzinfo=timezone.utc)
        recovery = self.migration_execution_authorization(bundle, now, recovery=True)
        recovery["parameters"]["original_authorization_sha256"] = "d" * 64
        unrelated = self.authorization(bundle, datetime(2026, 8, 15, 1, 1, tzinfo=timezone.utc))
        with tempfile.TemporaryDirectory(prefix="cyd-uat-active-fence-") as temporary:
            root = Path(temporary) / "state"
            intents = root / "intents"
            active_root = root / "active-fences"
            intents.mkdir(parents=True, mode=0o700)
            active_root.mkdir(mode=0o700)
            root.chmod(0o700)
            intents.chmod(0o700)
            active_root.chmod(0o700)
            marker = root / supervisor.UAT_PROMOTION_STATE_MARKER
            marker.write_bytes(supervisor.UAT_PROMOTION_STATE_MARKER_VALUE)
            marker.chmod(0o400)
            active_body = {
                "schema_version": 1,
                "contract": "chenyida-erp-uat-promotion-active-migration-fence/v1",
                "status": "ACTIVE_UNTIL_EXPLICIT_CHECKPOINT_9_TRANSFER_OR_QUARANTINE_RESOLUTION",
                "promotion_id": recovery["parameters"]["promotion_id"],
                "migration_operation_id": recovery["parameters"]["original_operation_id"],
                "execution_authorization_sha256": recovery["parameters"]["original_authorization_sha256"],
                "grant_sha256": "1" * 64,
                "database_name": "chenyida_erp",
                "database_system_identifier": recovery["parameters"]["database_system_identifier"],
                "database_oid": recovery["parameters"]["database_oid"],
                "database_marker": "chenyida-erp-deployment/v2:UAT:chenyida-erp",
                "released_baseline_sha256": "2" * 64,
                "fence_before_sha256": "3" * 64,
                "activated_at": "2026-08-15T01:40:00.000Z",
            }
            active = {
                **active_body,
                "active_fence_sha256": supervisor.sha256(supervisor.canonical_json(active_body)),
            }
            active_file = active_root / (
                f"{active['migration_operation_id']}.{active['active_fence_sha256']}.json"
            )
            active_file.write_bytes(supervisor.canonical_json(active))
            active_file.chmod(0o400)
            with patch.object(supervisor, "UAT_PROMOTION_STATE_ROOT", root), \
                    patch.object(supervisor, "UAT_PROMOTION_ACTIVE_FENCES_ROOT", active_root):
                with self.assertRaisesRegex(
                        supervisor.SupervisorError, "SUPERVISOR_UAT_PROMOTION_ACTIVE_MIGRATION_FENCE_PRESENT"):
                    supervisor.assert_no_uat_migration_execution_interlock(unrelated)
                supervisor.assert_no_uat_migration_execution_interlock(recovery)
                active_file.chmod(0o600)
                active_file.write_bytes(active_file.read_bytes() + b" ")
                active_file.chmod(0o400)
                with self.assertRaisesRegex(
                        supervisor.SupervisorError, "SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID"):
                    supervisor.assert_no_uat_migration_execution_interlock(recovery)

    def test_pending_postdeploy_intent_blocks_new_work_except_exact_original_or_recovery(self):
        original_authorization = "d" * 64
        operation_id = "promotion-supervisor-runtime-probe"
        intent_sha256 = "e" * 64
        unrelated = self.authorization(
            "f" * 64, datetime(2026, 8, 15, 1, 1, tzinfo=timezone.utc),
        )
        exact = {
            "contract": supervisor.UAT_PROMOTION_AUTHORIZATION_CONTRACT,
            "operation": "VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION",
            "authorization_id": operation_id,
            "parameters": {},
        }
        recovery = {
            "contract": supervisor.UAT_PROMOTION_AUTHORIZATION_CONTRACT,
            "operation": "RECOVER_UAT_PROMOTION",
            "authorization_id": "promotion-supervisor-runtime-probe-recovery",
            "parameters": {
                "original_operation": "POSTDEPLOY_RUNTIME_CONFIGURATION",
                "original_operation_id": operation_id,
                "original_authorization_sha256": original_authorization,
            },
        }
        with tempfile.TemporaryDirectory(prefix="cyd-uat-postdeploy-interlock-") as temporary:
            root = Path(temporary) / "state"
            intents = root / "intents"
            active = root / "active-fences"
            transfers = root / "fence-transfers"
            intents.mkdir(parents=True, mode=0o700)
            root.chmod(0o700)
            intents.chmod(0o700)
            marker = root / supervisor.UAT_PROMOTION_STATE_MARKER
            marker.write_bytes(supervisor.UAT_PROMOTION_STATE_MARKER_VALUE)
            marker.chmod(0o400)
            intent = {
                "schema_version": 1,
                "contract": "chenyida-erp-uat-promotion-postdeploy-runtime-intent/v1",
                "verification_operation_id": operation_id,
                "execution_authorization_sha256": original_authorization,
                "postdeploy_runtime_intent_sha256": intent_sha256,
            }
            intent_file = intents / f"{operation_id}.{intent_sha256}.json"
            intent_file.write_bytes(supervisor.canonical_json(intent))
            intent_file.chmod(0o400)
            current = root / "current.json"
            current.write_bytes(supervisor.canonical_json({"authorization_sha256_chain": ["c" * 64]}))
            current.chmod(0o400)
            with patch.object(supervisor, "UAT_PROMOTION_STATE_ROOT", root), \
                    patch.object(supervisor, "UAT_PROMOTION_CURRENT_FILE", current), \
                    patch.object(supervisor, "UAT_PROMOTION_ACTIVE_FENCES_ROOT", active), \
                    patch.object(supervisor, "UAT_PROMOTION_FENCE_TRANSFERS_ROOT", transfers):
                with self.assertRaisesRegex(
                        supervisor.SupervisorError, "SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_RECOVERY_REQUIRED"):
                    supervisor.assert_no_uat_migration_execution_interlock(unrelated)
                supervisor.assert_no_uat_migration_execution_interlock(exact, original_authorization)
                supervisor.assert_no_uat_migration_execution_interlock(recovery, "f" * 64)

    def test_migration_recovery_contains_after_consumption_before_journal_execution(self):
        bundle = "f" * 64
        now = datetime(2026, 8, 15, 1, 41, tzinfo=timezone.utc)
        authorization = self.migration_execution_authorization(bundle, now, recovery=True)
        events = []
        patches = [
            patch.object(
                supervisor, "validate_original_uat_promotion_authorization_consumed",
                side_effect=lambda *_: events.append("original-consumed"),
            ),
            patch.object(
                supervisor, "prepare_runtime_privilege_node",
                side_effect=lambda *_: (events.append("node") or (Path("/tmp/runtime"), Path("/tmp/runtime/node"))),
            ),
            patch.object(
                supervisor, "run_uat_promotion_runner",
                side_effect=lambda _node, _bundle, _context, phase, _lock: (
                    events.append(phase) or {"result": "RECOVERED"}
                ),
            ),
            patch.object(supervisor, "consume_authorization", side_effect=lambda *_: events.append("consume")),
            patch.object(
                supervisor, "run_uat_promotion_migration_recovery_control",
                side_effect=lambda *_: events.append("recovery-control"),
            ),
            patch.object(
                supervisor, "cleanup_runtime_privilege_node", side_effect=lambda *_: events.append("cleanup"),
            ),
        ]
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5]:
            supervisor.run_uat_promotion_authorization(
                Path("/trusted/bundle"), Path("/trusted/pending/recovery.json"),
                authorization, "1" * 64, lock_descriptor=51,
            )
        self.assertEqual(events, [
            "original-consumed", "node", "recover-prepare", "consume", "recovery-control",
            "recover-execute", "cleanup",
        ])


if __name__ == "__main__":
    unittest.main()
