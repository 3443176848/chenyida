import hashlib
import importlib.util
import os
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "release-supervisor-launcher.py"
SPEC = importlib.util.spec_from_file_location("release_supervisor_cluster_policy_activation", MODULE_PATH)
supervisor = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(supervisor)


def utc(value):
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def digest(label):
    return hashlib.sha256(label.encode("utf-8")).hexdigest()


class ReleaseSupervisorClusterPolicyActivationTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="cyd-supervisor-cluster-policy-"))
        self.identity_root = self.root / "var/lib/chenyida-erp/release-identity"
        self.identity_file = self.identity_root / "release-identity.json"
        self.identity_root.mkdir(parents=True, mode=0o750)
        self.identity_root.chmod(0o750)
        self.owned_file(
            self.identity_root / supervisor.RELEASE_IDENTITY_MARKER,
            supervisor.RELEASE_IDENTITY_MARKER_VALUE, 0o440,
        )
        self.owned_file(self.identity_file, b'{"fixture":"release-identity"}\n', 0o440)
        self.constants = patch.multiple(
            supervisor,
            RELEASE_IDENTITY_ROOT=self.identity_root,
            RELEASE_IDENTITY_FILE=self.identity_file,
        )
        self.constants.start()

    def tearDown(self):
        self.constants.stop()
        for directory, names, files in os.walk(self.root, topdown=False):
            for name in files:
                candidate = Path(directory) / name
                try:
                    candidate.chmod(0o600)
                    os.chown(candidate, 0, 0, follow_symlinks=False)
                except FileNotFoundError:
                    pass
            for name in names:
                candidate = Path(directory) / name
                try:
                    candidate.chmod(0o700)
                    os.chown(candidate, 0, 0, follow_symlinks=False)
                except FileNotFoundError:
                    pass
            Path(directory).chmod(0o700)
            os.chown(directory, 0, 0, follow_symlinks=False)
        shutil.rmtree(self.root)

    @staticmethod
    def owned_file(path, raw, mode):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        os.chown(path, 0, 0, follow_symlinks=False)
        path.chmod(mode)

    @staticmethod
    def source(path, mode):
        raw = path.read_bytes()
        metadata = path.stat()
        return {
            "path": str(path),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw),
            "device": str(metadata.st_dev),
            "inode": str(metadata.st_ino),
            "uid": metadata.st_uid,
            "gid": metadata.st_gid,
            "mode": mode,
            "nlink": metadata.st_nlink,
        }

    def parameters(self, *, generation=1, operation="ACTIVATE", recovery=False):
        operation_id = f"cluster-policy-{operation.lower()}-{generation}"
        activated = datetime(2026, 8, 15, generation, 0, tzinfo=timezone.utc)
        parameters = {
            "policy_state_root": str(supervisor.CLUSTER_POLICY_STATE_ROOT),
            "policy_target": str(supervisor.MONITORING_CLUSTER_POLICY_FILE),
            "activation_id": operation_id,
            "environment": "UAT",
            "policy_generation": generation,
            "previous_policy_sha256": "0" * 64 if generation == 1 else digest("previous-policy"),
            "previous_activation_receipt_sha256": "0" * 64 if generation == 1 else digest("previous-receipt"),
            "template_file_sha256": supervisor.CLUSTER_POLICY_TEMPLATE_FILE_SHA256,
            "template_policy_sha256": supervisor.CLUSTER_POLICY_TEMPLATE_POLICY_SHA256,
            "approval_reference_sha256": digest(f"approval-{operation_id}"),
            "responsible_operator_identity_sha256": digest(f"operator-{operation_id}"),
            "approver_identity_sha256": digest(f"approver-{operation_id}"),
            "rpo_hours": 24,
            "rto_minutes": 120,
            "target_disposition": "DESTROY_AFTER_EVIDENCE",
            "activated_at": utc(activated),
            "policy_expires_at": utc(activated + timedelta(hours=12)),
            "release_identity_source": self.source(self.identity_file, "0440"),
            "current_policy_source": None,
            "current_activation_source": None,
            "rollback_target_source": None,
        }
        if generation > 1:
            parameters["current_policy_source"] = {
                "path": str(supervisor.MONITORING_CLUSTER_POLICY_FILE), "sha256": parameters["previous_policy_sha256"],
                "bytes": 100, "device": "1", "inode": "2", "uid": 0, "gid": 0, "mode": "0440", "nlink": 1,
            }
            parameters["current_activation_source"] = {
                "path": str(supervisor.CLUSTER_POLICY_CURRENT_FILE), "sha256": digest("previous-receipt-file"),
                "bytes": 100, "device": "1", "inode": "3", "uid": 0, "gid": 0, "mode": "0400", "nlink": 1,
            }
        if operation == "ROLLBACK":
            parameters["rollback_target_source"] = {
                "path": str(supervisor.CLUSTER_POLICY_STATE_ROOT / f"receipts/0000000000000001.{digest('rollback-receipt')}.json"),
                "sha256": digest("rollback-receipt-file"), "bytes": 100, "device": "1", "inode": "4",
                "uid": 0, "gid": 0, "mode": "0400", "nlink": 1,
            }
        if recovery:
            parameters.update({
                "expected_intent_sha256": digest("expected-intent"),
                "original_authorization_sha256": digest("original-authorization-placeholder"),
                "original_operation": operation,
                "original_operation_id": operation_id,
            })
        return parameters

    def authorization(self, bundle_digest, now, *, operation="ACTIVATE", generation=1, recovery=False):
        operation_name = (
            "RECOVER_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2_ACTIVATION" if recovery
            else f"{operation}_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2"
        )
        parameters = self.parameters(generation=generation, operation=operation, recovery=recovery)
        authorization_id = f"cluster-policy-recovery-{generation}" if recovery else parameters["activation_id"]
        created = now - timedelta(minutes=1)
        if recovery:
            created = now
        else:
            parameters["activated_at"] = utc(created)
            parameters["policy_expires_at"] = utc(now + timedelta(minutes=9))
        return {
            "schema_version": 4,
            "contract": supervisor.CLUSTER_POLICY_AUTHORIZATION_CONTRACT,
            "authorization_id": authorization_id,
            "created_at": utc(created),
            "expires_at": utc(now + timedelta(minutes=10)),
            "supervisor_bundle_sha256": bundle_digest,
            "operation": operation_name,
            "parameters": parameters,
            "nonce": digest(f"nonce-{authorization_id}"),
            "confirmation": supervisor.CLUSTER_POLICY_CONFIRMATIONS[operation_name],
        }

    def test_v4_authorization_is_exact_short_lived_and_binds_template_actors_sources_and_environment(self):
        now = datetime(2026, 8, 15, 1, 0, tzinfo=timezone.utc)
        value = self.authorization("a" * 64, now)
        self.assertEqual(supervisor.validate_authorization(value, "a" * 64, now), value)
        invalid = {**value, "parameters": {**value["parameters"], "command": "/bin/sh"}}
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_CLUSTER_POLICY_PARAMETERS_INVALID"):
            supervisor.validate_authorization(invalid, "a" * 64, now)
        invalid = {**value, "parameters": {**value["parameters"], "template_file_sha256": "0" * 64}}
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_CLUSTER_POLICY_TEMPLATE_INVALID"):
            supervisor.validate_authorization(invalid, "a" * 64, now)
        invalid = {**value, "parameters": {**value["parameters"], "approver_identity_sha256": value["parameters"]["responsible_operator_identity_sha256"]}}
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_CLUSTER_POLICY_ACTORS_INVALID"):
            supervisor.validate_authorization(invalid, "a" * 64, now)
        invalid = {**value, "parameters": {**value["parameters"], "environment": "TEST"}}
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_CLUSTER_POLICY_ENVIRONMENT_INVALID"):
            supervisor.validate_authorization(invalid, "a" * 64, now)
        invalid = {**value, "parameters": {**value["parameters"], "activated_at": utc(now + timedelta(minutes=6))}}
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_CLUSTER_POLICY_TIME_INVALID"):
            supervisor.validate_authorization(invalid, "a" * 64, now)

    def test_generation_and_rollback_sources_are_structural_and_receipt_file_hash_is_independent(self):
        generation2 = self.parameters(generation=2)
        self.assertEqual(
            supervisor.validate_cluster_policy_parameters(generation2, "ACTIVATE_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2"),
            generation2,
        )
        self.assertNotEqual(generation2["current_activation_source"]["sha256"], generation2["previous_activation_receipt_sha256"])
        rollback = self.parameters(generation=3, operation="ROLLBACK")
        self.assertEqual(
            supervisor.validate_cluster_policy_parameters(rollback, "ROLLBACK_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2"),
            rollback,
        )
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_CLUSTER_POLICY_GENERATION_INVALID"):
            supervisor.validate_cluster_policy_parameters({**generation2, "policy_generation": 1}, "ACTIVATE_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2")
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_CLUSTER_POLICY_ROLLBACK_INVALID"):
            supervisor.validate_cluster_policy_parameters({**rollback, "rollback_target_source": None}, "ROLLBACK_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2")

    def test_release_identity_source_root_and_inode_are_rechecked(self):
        parameters = self.parameters()
        supervisor.verify_cluster_policy_sources(parameters)
        replacement = self.identity_file.with_suffix(".replacement")
        self.owned_file(replacement, self.identity_file.read_bytes(), 0o440)
        os.replace(replacement, self.identity_file)
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_CLUSTER_POLICY_SOURCE_CHANGED"):
            supervisor.verify_cluster_policy_sources(parameters)

    def test_recovery_requires_exact_canonical_consumed_original_authorization(self):
        now = datetime(2026, 8, 15, 1, 0, tzinfo=timezone.utc)
        bundle = "a" * 64
        original = self.authorization(bundle, now)
        raw = supervisor.canonical_json(original)
        original_digest = supervisor.sha256(raw)
        consumed = self.root / "consumed"
        consumed.mkdir(mode=0o700)
        file = consumed / f"{original['authorization_id']}.{original_digest}.json"
        self.owned_file(file, raw, 0o400)
        recovery = self.authorization(bundle, now + timedelta(minutes=1), recovery=True)
        recovery["parameters"].update({
            **original["parameters"],
            "expected_intent_sha256": digest("expected-intent"),
            "original_authorization_sha256": original_digest,
            "original_operation": "ACTIVATE",
            "original_operation_id": original["authorization_id"],
        })
        self.assertEqual(supervisor.validate_authorization(recovery, bundle, now + timedelta(minutes=1)), recovery)
        self.assertEqual(supervisor.validate_original_cluster_policy_authorization_consumed(recovery["parameters"], bundle, consumed), original)
        delayed_now = now + timedelta(days=2)
        delayed = self.authorization(bundle, delayed_now, recovery=True)
        delayed["parameters"].update(recovery["parameters"])
        self.assertEqual(supervisor.validate_authorization(delayed, bundle, delayed_now), delayed)
        drifted = {**recovery["parameters"], "rto_minutes": 121}
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_CLUSTER_POLICY_ORIGINAL_AUTHORIZATION_INVALID"):
            supervisor.validate_original_cluster_policy_authorization_consumed(drifted, bundle, consumed)

    def test_original_runner_prepares_then_consumes_with_three_source_checks(self):
        now = datetime(2026, 8, 15, 1, 0, tzinfo=timezone.utc)
        authorization = self.authorization("a" * 64, now)
        events = []

        def verify(*_arguments, **_keywords):
            events.append("verify")

        def run(_node, _bundle, context, phase, _lock):
            events.append(phase)
            self.assertEqual(context["parameters"], authorization["parameters"])
            return {"result": "fixture"}

        def consume(*_arguments):
            events.append("consume")

        with patch.object(supervisor, "verify_cluster_policy_sources", side_effect=verify), \
             patch.object(supervisor, "prepare_runtime_privilege_node", side_effect=lambda _digest: (events.append("node") or (self.root / "runtime", self.root / "runtime/node"))), \
             patch.object(supervisor, "run_cluster_policy_runner", side_effect=run), \
             patch.object(supervisor, "consume_authorization", side_effect=consume) as consumer, \
             patch.object(supervisor, "cleanup_runtime_privilege_node") as cleanup:
            result = supervisor.run_cluster_policy_authorization(
                self.root / "bundle", self.root / "pending.json", authorization, digest("authorization"), 9,
            )
        self.assertEqual(result, {"result": "fixture"})
        self.assertEqual(events, ["verify", "node", "prepare", "verify", "consume", "verify", "execute"])
        consumer.assert_called_once()
        cleanup.assert_called_once_with(self.root / "runtime")

    def test_runner_environment_and_response_are_exact(self):
        now = datetime(2026, 8, 15, 1, 0, tzinfo=timezone.utc)
        authorization = self.authorization("a" * 64, now)
        context = supervisor.cluster_policy_context(authorization, digest("authorization"))
        response = {
            "result": "PREPARED", "operation_id": context["operation_id"],
            "intent_sha256": digest("intent"), "policy_sha256": digest("policy"), "receipt_sha256": digest("receipt"),
        }
        with patch.object(
            supervisor.subprocess, "run",
            return_value=SimpleNamespace(returncode=0, stdout=supervisor.canonical_json(response), stderr=b""),
        ) as runner:
            self.assertEqual(
                supervisor.run_cluster_policy_runner(self.root / "node", self.root / "bundle", context, "prepare", 9),
                response,
            )
        environment = runner.call_args.kwargs["env"]
        self.assertEqual(environment["ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED"], "NO")
        self.assertEqual(environment["ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED"], "NO")
        self.assertEqual(environment["ERP_RELEASE_GATE_LOCK_FD"], "9")
        self.assertEqual(runner.call_args.kwargs["input"], supervisor.canonical_json(context))
        command = runner.call_args.args[0]
        self.assertEqual(command[-2:], ["prepare", "PREPARE_CLUSTER_POLICY_ACTIVATION_INTENT"])


if __name__ == "__main__":
    unittest.main()
