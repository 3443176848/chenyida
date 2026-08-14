import importlib.util
import os
import shutil
import stat
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "release-supervisor-launcher.py"
SPEC = importlib.util.spec_from_file_location("release_supervisor_monitoring_projection", MODULE_PATH)
supervisor = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(supervisor)


def utc(value):
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


class ReleaseSupervisorMonitoringProjectionTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="cyd-supervisor-projection-"))
        self.reader_gid = 21001
        self.identity_gid = 22001
        self.backup_gid = 23001
        self.monitoring_root = self.root / "var/lib/chenyida-erp/monitoring-v1"
        self.projection_root = self.monitoring_root / "projections"
        self.active_file = self.monitoring_root / "active.json"
        self.private_config = self.root / "etc/chenyida-erp/monitoring-v1/private/host-config.json"
        self.identity_root = self.root / "var/lib/chenyida-erp/release-identity"
        self.identity_file = self.identity_root / "release-identity.json"
        self.postdeploy_base = self.root / "var/lib/chenyida-erp/postdeploy"
        self.receipt_root = self.postdeploy_base / "postdeploy-fixture"
        self.receipt_file = self.receipt_root / "postdeploy-fixture.postdeploy-receipt.json"
        self.backup_file = self.root / "var/lib/chenyida-erp/backup-status/recovery-readiness.json"
        self.policy_file = self.root / "etc/chenyida-erp/recovery/postgresql-cluster-recovery-policy.json"
        self.policy_state_root = self.root / "var/lib/chenyida-erp/postgresql-cluster-recovery-policy-v2"
        self.policy_activation_file = self.policy_state_root / "current.json"
        self.policy_history_file = self.policy_state_root / "history" / f"0000000000000001.{'a' * 64}.json"
        self.policy_receipt_file = self.policy_state_root / "receipts" / f"0000000000000001.{'b' * 64}.json"
        self.constants = patch.multiple(
            supervisor,
            MONITORING_PROJECTION_ROOT=self.projection_root,
            MONITORING_ACTIVE_FILE=self.active_file,
            MONITORING_PRIVATE_CONFIG=self.private_config,
            MONITORING_BACKUP_READINESS_FILE=self.backup_file,
            MONITORING_CLUSTER_POLICY_FILE=self.policy_file,
            CLUSTER_POLICY_STATE_ROOT=self.policy_state_root,
            CLUSTER_POLICY_CURRENT_FILE=self.policy_activation_file,
            RELEASE_IDENTITY_ROOT=self.identity_root,
            RELEASE_IDENTITY_FILE=self.identity_file,
            POSTDEPLOY_ROOT_BASE=self.postdeploy_base,
        )
        self.constants.start()
        self.initialize_layout()

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
    def owned_directory(path, mode, gid=0):
        path.mkdir(parents=True, exist_ok=True)
        os.chown(path, 0, gid, follow_symlinks=False)
        path.chmod(mode)

    @staticmethod
    def owned_file(path, raw, mode, gid=0):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        os.chown(path, 0, gid, follow_symlinks=False)
        path.chmod(mode)

    def initialize_layout(self):
        self.owned_directory(self.monitoring_root, 0o755)
        self.owned_directory(self.projection_root, 0o750, self.reader_gid)
        for kind in ("components", "backup"):
            self.owned_directory(self.projection_root / kind, 0o750, self.reader_gid)
        self.owned_file(
            self.projection_root / supervisor.MONITORING_PROJECTION_MARKER,
            supervisor.MONITORING_PROJECTION_MARKER_VALUE, 0o400, self.reader_gid,
        )
        self.owned_directory(self.private_config.parent, 0o700)
        self.owned_directory(self.identity_root, 0o750, self.identity_gid)
        self.owned_file(
            self.identity_root / supervisor.RELEASE_IDENTITY_MARKER,
            supervisor.RELEASE_IDENTITY_MARKER_VALUE, 0o440, self.identity_gid,
        )
        self.owned_directory(self.receipt_root, 0o750)
        self.owned_file(
            self.receipt_root / supervisor.RELEASE_ARTIFACT_MARKER,
            supervisor.RELEASE_ARTIFACT_MARKER_VALUE, 0o440,
        )
        self.owned_directory(self.backup_file.parent, 0o2750, self.backup_gid)
        self.owned_file(
            self.backup_file.parent / supervisor.BACKUP_STATUS_MARKER,
            supervisor.BACKUP_STATUS_MARKER_VALUE, 0o400, self.backup_gid,
        )
        self.owned_directory(self.policy_file.parent, 0o750)
        self.owned_directory(self.policy_state_root, 0o700)
        self.owned_directory(self.policy_state_root / "history", 0o700)
        self.owned_directory(self.policy_state_root / "receipts", 0o700)
        self.owned_file(
            self.policy_state_root / supervisor.CLUSTER_POLICY_STATE_MARKER,
            supervisor.CLUSTER_POLICY_STATE_MARKER_VALUE, 0o400,
        )
        self.owned_file(self.active_file, b'{"active":true}\n', 0o444)
        self.owned_file(self.private_config, b'{"config":true}\n', 0o400)
        self.owned_file(self.identity_file, b'{"identity":true}\n', 0o440, self.identity_gid)
        self.owned_file(self.receipt_file, b'{"receipt":true}\n', 0o440)
        self.owned_file(self.backup_file, b'{"readiness":true}\n', 0o640, self.backup_gid)
        self.owned_file(self.policy_file, b'{"policy":true}\n', 0o440)
        self.owned_file(self.policy_activation_file, b'{"activation":true}\n', 0o400)
        self.owned_file(self.policy_history_file, b'{"policy-history":true}\n', 0o400)
        self.owned_file(self.policy_receipt_file, b'{"receipt-history":true}\n', 0o400)

    @staticmethod
    def source_spec(path):
        metadata = os.lstat(path)
        raw = path.read_bytes()
        return {
            "path": str(path), "sha256": supervisor.sha256(raw), "bytes": len(raw),
            "device": str(metadata.st_dev), "inode": str(metadata.st_ino),
            "uid": metadata.st_uid, "gid": metadata.st_gid,
            "mode": f"{stat.S_IMODE(metadata.st_mode):04o}", "nlink": metadata.st_nlink,
        }

    def parameters(self, backup=False):
        value = {
            "projection_root": str(self.projection_root),
            "projection_reader_gid": self.reader_gid,
            "projection_generation": 1,
            "previous_projection_sha256": "0" * 64,
            "projection_published_at": "2026-08-12T01:31:00.000Z",
            "expected_source_sha256": "1" * 64,
            "expected_projection_sha256": "2" * 64,
            "active_source": self.source_spec(self.active_file),
            "host_config_source": self.source_spec(self.private_config),
            "release_identity_source": self.source_spec(self.identity_file),
            "postdeploy_receipt_source": self.source_spec(self.receipt_file),
        }
        if backup:
            value.update({
                "backup_readiness_source": self.source_spec(self.backup_file),
                "cluster_policy_source": self.source_spec(self.policy_file),
                "cluster_policy_activation_source": self.source_spec(self.policy_activation_file),
                "cluster_policy_history_source": self.source_spec(self.policy_history_file),
                "cluster_policy_receipt_source": self.source_spec(self.policy_receipt_file),
            })
        return value

    def authorization(self, backup=False):
        now = datetime(2026, 8, 13, 1, 0, tzinfo=timezone.utc)
        operation = "PUBLISH_MONITORING_BACKUP_PROJECTION" if backup else "PUBLISH_MONITORING_COMPONENTS_PROJECTION"
        return {
            "schema_version": 2,
            "contract": supervisor.AUTHORIZATION_CONTRACT,
            "authorization_id": "monitoring-projection-fixture",
            "created_at": utc(now - timedelta(minutes=1)),
            "expires_at": utc(now + timedelta(minutes=10)),
            "supervisor_bundle_sha256": "a" * 64,
            "operation": operation,
            "parameters": self.parameters(backup),
            "nonce": "b" * 64,
            "confirmation": supervisor.CONFIRMATIONS[operation],
        }, now

    def test_authorization_is_exact_and_old_publication_time_supports_crash_recovery(self):
        authorization, now = self.authorization()
        validated = supervisor.validate_authorization(authorization, "a" * 64, now)
        self.assertEqual(validated, authorization)
        context = supervisor.monitoring_projection_context(validated, "c" * 64)
        self.assertEqual(context["operation"], "COMPONENTS")
        self.assertEqual(context["projection"]["reader_gid"], self.reader_gid)
        self.assertEqual(context["sources"]["postdeploy_receipt"]["path"], str(self.receipt_file))
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_COMMAND_OPERATION_INVALID"):
            supervisor.command_for(self.root / "bundle", validated)
        invalid = dict(authorization)
        invalid["parameters"] = {**authorization["parameters"], "caller_summary": "READY"}
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_AUTHORIZATION_PARAMETERS_INVALID"):
            supervisor.validate_authorization(invalid, "a" * 64, now)

    def test_authoritative_source_roots_and_metadata_are_rechecked(self):
        parameters = self.parameters()
        supervisor.verify_monitoring_projection_sources(parameters, "PUBLISH_MONITORING_COMPONENTS_PROJECTION")
        replacement = self.active_file.with_suffix(".replacement")
        self.owned_file(replacement, self.active_file.read_bytes(), 0o444)
        os.replace(replacement, self.active_file)
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_MONITORING_PROJECTION_SOURCE_CHANGED"):
            supervisor.verify_monitoring_projection_sources(parameters, "PUBLISH_MONITORING_COMPONENTS_PROJECTION")

    def test_backup_source_root_marker_and_link_count_are_enforced(self):
        parameters = self.parameters(backup=True)
        authorization, now = self.authorization(backup=True)
        validated = supervisor.validate_authorization(authorization, "a" * 64, now)
        context = supervisor.monitoring_projection_context(validated, "c" * 64)
        self.assertEqual(context["sources"]["cluster_policy_activation"]["path"], str(self.policy_activation_file))
        self.assertEqual(context["sources"]["cluster_policy_receipt"]["path"], str(self.policy_receipt_file))
        supervisor.verify_monitoring_projection_sources(parameters, "PUBLISH_MONITORING_BACKUP_PROJECTION")
        hardlink = self.backup_file.with_suffix(".hardlink")
        os.link(self.backup_file, hardlink)
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_MONITORING_PROJECTION_SOURCE_CHANGED"):
            supervisor.verify_monitoring_projection_sources(parameters, "PUBLISH_MONITORING_BACKUP_PROJECTION")
        hardlink.unlink()
        marker = self.backup_file.parent / supervisor.BACKUP_STATUS_MARKER
        marker.chmod(0o600)
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_MONITORING_PROJECTION_BACKUP_ROOT_INVALID"):
            supervisor.verify_monitoring_projection_sources(self.parameters(backup=True), "PUBLISH_MONITORING_BACKUP_PROJECTION")
        marker.chmod(0o400)
        activation_marker = self.policy_state_root / supervisor.CLUSTER_POLICY_STATE_MARKER
        activation_marker.chmod(0o600)
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_MONITORING_PROJECTION_POLICY_ACTIVATION_ROOT_INVALID"):
            supervisor.verify_monitoring_projection_sources(self.parameters(backup=True), "PUBLISH_MONITORING_BACKUP_PROJECTION")

    def test_runner_rechecks_before_and_after_consumption_and_validates_exact_response(self):
        authorization, _ = self.authorization()
        authorization_digest = "c" * 64
        expected = authorization["parameters"]
        response = {
            "result": "PUBLISHED", "kind": "components", "generation": 1,
            "projection_sha256": expected["expected_projection_sha256"],
            "source_sha256": expected["expected_source_sha256"],
        }
        events = []

        def verified(*_arguments):
            events.append("verify")

        def consumed(*_arguments):
            events.append("consume")
            return self.root / "consumed.json"

        def executed(*_arguments, **_keywords):
            events.append("execute")
            return SimpleNamespace(returncode=0, stdout=supervisor.canonical_json(response), stderr=b"")

        with patch.object(supervisor, "verify_monitoring_projection_sources", side_effect=verified) as verifier, \
             patch.object(supervisor, "prepare_runtime_privilege_node", return_value=(self.root / "runtime", self.root / "runtime/node")), \
             patch.object(supervisor, "consume_authorization", side_effect=consumed) as consumer, \
             patch.object(supervisor, "cleanup_runtime_privilege_node") as cleanup, \
             patch.object(supervisor.subprocess, "run", side_effect=executed) as runner:
            result = supervisor.run_monitoring_projection_authorization(
                self.root / "bundle", self.root / "pending.json", authorization, authorization_digest, 9,
            )
        self.assertEqual(result, response)
        self.assertEqual(events, ["verify", "verify", "consume", "verify", "execute"])
        self.assertEqual(verifier.call_count, 3)
        consumer.assert_called_once()
        cleanup.assert_called_once_with(self.root / "runtime")
        environment = runner.call_args.kwargs["env"]
        self.assertEqual(environment["ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED"], "YES")
        self.assertEqual(environment["ERP_RELEASE_GATE_LOCK_FD"], "9")
        self.assertEqual(runner.call_args.kwargs["input"], supervisor.canonical_json(supervisor.monitoring_projection_context(authorization, authorization_digest)))

    def test_post_consumption_source_drift_stops_before_node_execution(self):
        authorization, _ = self.authorization()
        with patch.object(
            supervisor, "verify_monitoring_projection_sources",
            side_effect=[None, None, supervisor.SupervisorError("SUPERVISOR_MONITORING_PROJECTION_SOURCE_CHANGED")],
        ), patch.object(
            supervisor, "prepare_runtime_privilege_node", return_value=(self.root / "runtime", self.root / "runtime/node"),
        ), patch.object(supervisor, "consume_authorization") as consumer, \
             patch.object(supervisor, "cleanup_runtime_privilege_node"), \
             patch.object(supervisor.subprocess, "run") as runner:
            with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_MONITORING_PROJECTION_SOURCE_CHANGED"):
                supervisor.run_monitoring_projection_authorization(
                    self.root / "bundle", self.root / "pending.json", authorization, "c" * 64, 9,
                )
        consumer.assert_called_once()
        runner.assert_not_called()


if __name__ == "__main__":
    unittest.main()
