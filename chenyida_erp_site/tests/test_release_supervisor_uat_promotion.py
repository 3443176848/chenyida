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


if __name__ == "__main__":
    unittest.main()
