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
SPEC = importlib.util.spec_from_file_location("release_supervisor_monitoring_notifier_egress", MODULE_PATH)
supervisor = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(supervisor)


def utc(value):
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def digest(label):
    return hashlib.sha256(label.encode("utf-8")).hexdigest()


class ReleaseSupervisorMonitoringNotifierEgressTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="cyd-supervisor-notifier-egress-"))
        self.state_root = self.root / "var/lib/chenyida-erp/monitoring-notifier-egress-v1"
        self.view_root = self.root / "etc/chenyida-erp/monitoring-v1/views"
        self.systemd_root = self.root / "etc/systemd/system"
        self.state_root.mkdir(parents=True, mode=0o700)
        (self.state_root / "history").mkdir(mode=0o700)
        (self.state_root / "receipts").mkdir(mode=0o700)
        self.view_root.mkdir(parents=True, mode=0o755)
        self.systemd_root.mkdir(parents=True, mode=0o755)
        self.policy_file = self.view_root / "notifier-egress-policy.json"
        self.activation_view = self.view_root / "notifier-egress-activation.json"
        self.base_unit = self.systemd_root / "chenyida-erp-monitor-notifier.service"
        self.dropin = self.systemd_root / "chenyida-erp-monitor-notifier.service.d/50-chenyida-erp-notifier-egress.conf"
        real_base = MODULE_PATH.parents[1] / "deployment/systemd/chenyida-erp-monitor-notifier.service"
        self.owned_file(self.base_unit, real_base.read_bytes(), 0o444)
        self.notifier_file = self.view_root / f"{digest('host-config')}.notifier.json"
        self.owned_file(self.notifier_file, b'{"fixture":"notifier-config"}\n', 0o440, gid=21002)
        self.constants = patch.multiple(
            supervisor,
            NOTIFIER_EGRESS_STATE_ROOT=self.state_root,
            NOTIFIER_EGRESS_CURRENT_FILE=self.state_root / "current.json",
            NOTIFIER_EGRESS_POLICY_FILE=self.policy_file,
            NOTIFIER_EGRESS_ACTIVATION_VIEW=self.activation_view,
            NOTIFIER_EGRESS_BASE_UNIT=self.base_unit,
            NOTIFIER_EGRESS_DROPIN=self.dropin,
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
    def owned_file(path, raw, mode, gid=0):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        os.chown(path, 0, gid, follow_symlinks=False)
        path.chmod(mode)

    @staticmethod
    def source(path, mode):
        raw = path.read_bytes()
        metadata = path.stat()
        return {
            "path": str(path), "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw),
            "device": str(metadata.st_dev), "inode": str(metadata.st_ino), "uid": metadata.st_uid,
            "gid": metadata.st_gid, "mode": mode, "nlink": metadata.st_nlink,
        }

    def parameters(self, *, generation=1, operation="ACTIVATE", recovery=False):
        operation_id = f"notifier-egress-{operation.lower()}-{generation}"
        activated = datetime(2026, 8, 15, generation, 0, tzinfo=timezone.utc)
        value = {
            "policy_state_root": str(self.state_root),
            "policy_target": str(self.policy_file),
            "activation_view": str(self.activation_view),
            "dropin_target": str(self.dropin),
            "activation_id": operation_id,
            "environment": "UAT",
            "egress_generation": generation,
            "previous_policy_sha256": "0" * 64 if generation == 1 else digest("previous-policy"),
            "previous_activation_receipt_sha256": "0" * 64 if generation == 1 else digest("previous-receipt"),
            "rollback_target_activation_receipt_sha256": "0" * 64,
            "deployment_id": "erp-uat-fixture",
            "target_id": "primary-oncall",
            "target_generation": 1,
            "endpoint": {"scheme": "https", "host": "alerts.example.com", "port": 443, "path": "/ack", "tls_server_name": "alerts.example.com"},
            "allowed_addresses": ["1.1.1.1", "2606:4700:4700::1111"],
            "monitoring_bundle_sha256": digest("monitoring-bundle"),
            "adapter_id": "HTTPS_JSON_ACK_V1",
            "adapter_sha256": digest("adapter"),
            "credential_sha256": digest("credential"),
            "credential_generation": 1,
            "oncall_roster_generation": 1,
            "escalation_table_sha256": digest("escalation"),
            "notifier_gid": 21002,
            "template_file_sha256": supervisor.NOTIFIER_EGRESS_TEMPLATE_FILE_SHA256,
            "template_policy_sha256": supervisor.NOTIFIER_EGRESS_TEMPLATE_POLICY_SHA256,
            "approval_reference_sha256": digest(f"approval-{operation_id}"),
            "responsible_operator_identity_sha256": digest(f"operator-{operation_id}"),
            "approver_identity_sha256": digest(f"approver-{operation_id}"),
            "activated_at": utc(activated),
            "expires_at": utc(activated + timedelta(hours=12)),
            "notifier_config_source": self.source(self.notifier_file, "0440"),
            "base_unit_source": self.source(self.base_unit, "0444"),
            "current_policy_source": None,
            "current_activation_source": None,
            "rollback_policy_source": None,
            "rollback_activation_source": None,
        }
        if generation > 1:
            value["current_policy_source"] = {
                "path": str(self.policy_file), "sha256": value["previous_policy_sha256"], "bytes": 100,
                "device": "1", "inode": "2", "uid": 0, "gid": 21002, "mode": "0440", "nlink": 1,
            }
            value["current_activation_source"] = {
                "path": str(self.activation_view), "sha256": digest("previous-receipt-file"), "bytes": 100,
                "device": "1", "inode": "3", "uid": 0, "gid": 21002, "mode": "0440", "nlink": 1,
            }
        if operation == "ROLLBACK":
            receipt_digest = digest("rollback-receipt")
            value["rollback_target_activation_receipt_sha256"] = receipt_digest
            value["rollback_policy_source"] = {
                "path": str(self.state_root / f"history/0000000000000001.{digest('rollback-policy')}.json"),
                "sha256": digest("rollback-policy"), "bytes": 100, "device": "1", "inode": "4",
                "uid": 0, "gid": 0, "mode": "0400", "nlink": 1,
            }
            value["rollback_activation_source"] = {
                "path": str(self.state_root / f"receipts/0000000000000001.{receipt_digest}.json"),
                "sha256": digest("rollback-receipt-file"), "bytes": 100, "device": "1", "inode": "5",
                "uid": 0, "gid": 0, "mode": "0400", "nlink": 1,
            }
        if recovery:
            value.update({
                "expected_intent_sha256": digest("expected-intent"),
                "original_authorization_sha256": digest("original-authorization-placeholder"),
                "original_operation": operation,
                "original_operation_id": operation_id,
            })
        return value

    def authorization(self, bundle_digest, now, *, operation="ACTIVATE", generation=1, recovery=False):
        operation_name = (
            "RECOVER_MONITORING_NOTIFIER_EGRESS_V1_ACTIVATION" if recovery
            else f"{operation}_MONITORING_NOTIFIER_EGRESS_V1"
        )
        parameters = self.parameters(generation=generation, operation=operation, recovery=recovery)
        created = now if recovery else now - timedelta(minutes=1)
        if not recovery:
            parameters["activated_at"] = utc(created)
            parameters["expires_at"] = utc(now + timedelta(minutes=9))
        authorization_id = f"notifier-egress-recovery-{generation}" if recovery else parameters["activation_id"]
        return {
            "schema_version": 5,
            "contract": supervisor.NOTIFIER_EGRESS_AUTHORIZATION_CONTRACT,
            "authorization_id": authorization_id,
            "created_at": utc(created),
            "expires_at": utc(now + timedelta(minutes=10)),
            "supervisor_bundle_sha256": bundle_digest,
            "operation": operation_name,
            "parameters": parameters,
            "nonce": digest(f"nonce-{authorization_id}"),
            "confirmation": supervisor.NOTIFIER_EGRESS_CONFIRMATIONS[operation_name],
        }

    def test_v5_authorization_binds_exact_endpoint_addresses_unit_and_sources(self):
        now = datetime(2026, 8, 15, 1, 0, tzinfo=timezone.utc)
        value = self.authorization("a" * 64, now)
        self.assertEqual(supervisor.validate_authorization(value, "a" * 64, now), value)
        invalid = {**value, "parameters": {**value["parameters"], "allowed_addresses": ["0.0.0.0"]}}
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_NOTIFIER_EGRESS_ADDRESS_INVALID"):
            supervisor.validate_authorization(invalid, "a" * 64, now)
        invalid = {**value, "parameters": {**value["parameters"], "endpoint": {**value["parameters"]["endpoint"], "port": 80}}}
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_NOTIFIER_EGRESS_ENDPOINT_INVALID"):
            supervisor.validate_authorization(invalid, "a" * 64, now)
        invalid = {**value, "parameters": {**value["parameters"], "template_file_sha256": "0" * 64}}
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_NOTIFIER_EGRESS_TEMPLATE_INVALID"):
            supervisor.validate_authorization(invalid, "a" * 64, now)
        forged_source = {**value["parameters"]["notifier_config_source"], "uid": False, "nlink": True}
        invalid = {**value, "parameters": {**value["parameters"], "notifier_config_source": forged_source}}
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_NOTIFIER_EGRESS_NOTIFIER_SOURCE_INVALID"):
            supervisor.validate_authorization(invalid, "a" * 64, now)

    def test_effective_systemd_contract_rejects_unknown_dropin_and_proxy(self):
        parameters = self.parameters()
        expected = supervisor.expected_notifier_egress_effective_unit(parameters)
        expected_digest = supervisor.sha256(supervisor.canonical_json(expected))
        events = []

        def command(arguments):
            events.append(arguments)
            if arguments == ["daemon-reload"]:
                return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")
            properties = {
                "LoadState": "loaded", "FragmentPath": str(self.base_unit), "DropInPaths": str(self.dropin),
                "Transient": "no", "User": "chenyida-monitor-notify", "Group": "chenyida-monitor-notify",
                "PrivateNetwork": "no", "NoNewPrivileges": "yes", "ProtectSystem": "strict",
                "MemoryDenyWriteExecute": "yes", "IPAddressDeny": "any",
                "IPAddressAllow": "1.1.1.1/32 2606:4700:4700::1111/128", "Environment": "",
            }
            raw = "".join(f"{key}={value}\n" for key, value in properties.items()).encode("utf-8")
            return SimpleNamespace(returncode=0, stdout=raw, stderr=b"")

        self.assertEqual(supervisor.activate_and_verify_notifier_egress_systemd(parameters, expected_digest, command), expected_digest)
        self.assertEqual(events[0], ["daemon-reload"])

        def proxy_command(arguments):
            result = command(arguments)
            if arguments != ["daemon-reload"]:
                result.stdout = result.stdout.replace(b"Environment=", b"Environment=HTTPS_PROXY=http://proxy.invalid")
            return result

        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_NOTIFIER_EGRESS_PROXY_ENVIRONMENT_FORBIDDEN"):
            supervisor.activate_and_verify_notifier_egress_systemd(parameters, expected_digest, proxy_command)

        def tls_override_command(arguments):
            result = command(arguments)
            if arguments != ["daemon-reload"]:
                result.stdout = result.stdout.replace(b"Environment=", b"Environment=NODE_TLS_REJECT_UNAUTHORIZED=0")
            return result

        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_NOTIFIER_EGRESS_ENVIRONMENT_FORBIDDEN"):
            supervisor.activate_and_verify_notifier_egress_systemd(parameters, expected_digest, tls_override_command)

    def test_original_flow_prepares_consumes_applies_verifies_then_finalizes(self):
        now = datetime(2026, 8, 15, 1, 0, tzinfo=timezone.utc)
        authorization = self.authorization("a" * 64, now)
        events = []
        standard = {
            "operation_id": authorization["authorization_id"], "intent_sha256": digest("intent"),
            "policy_sha256": digest("policy"), "receipt_sha256": digest("receipt"),
            "dropin_sha256": digest("dropin"), "effective_unit_sha256": digest("effective"),
        }

        def runner(_node, _bundle, _context, phase, _lock, effective=None):
            events.append((phase, effective))
            return {"result": {"prepare": "PREPARED", "apply": "APPLIED", "finalize": "COMMITTED"}[phase], **standard}

        with patch.object(supervisor, "verify_notifier_egress_sources", side_effect=lambda *_args, **_kwargs: events.append(("verify", None))), \
             patch.object(supervisor, "prepare_runtime_privilege_node", return_value=(self.root / "runtime", self.root / "runtime/node")), \
             patch.object(supervisor, "run_notifier_egress_runner", side_effect=runner), \
             patch.object(supervisor, "consume_authorization", side_effect=lambda *_args: events.append(("consume", None))), \
             patch.object(supervisor, "activate_and_verify_notifier_egress_systemd", side_effect=lambda *_args: (events.append(("systemctl", None)) or digest("effective"))), \
             patch.object(supervisor, "cleanup_runtime_privilege_node"):
            result = supervisor.run_notifier_egress_authorization(
                self.root / "bundle", self.root / "pending.json", authorization, digest("authorization"), 9,
            )
        self.assertEqual(result["result"], "COMMITTED")
        self.assertEqual(events, [
            ("verify", None), ("prepare", None), ("verify", None), ("consume", None), ("verify", None),
            ("apply", None), ("systemctl", None), ("finalize", digest("effective")),
        ])

    def test_already_committed_recovery_still_verifies_effective_systemd(self):
        now = datetime(2026, 8, 15, 1, 0, tzinfo=timezone.utc)
        authorization = self.authorization("a" * 64, now, recovery=True)
        events = []
        standard = {
            "operation_id": authorization["parameters"]["original_operation_id"], "intent_sha256": digest("intent"),
            "policy_sha256": digest("policy"), "receipt_sha256": digest("receipt"),
            "dropin_sha256": digest("dropin"), "effective_unit_sha256": digest("effective"),
            "recovery_sha256": digest("recovery"),
        }

        def runner(_node, _bundle, _context, phase, _lock, effective=None):
            events.append((phase, effective))
            if phase == "recover-prepare":
                return {"result": "RECOVERY_PREPARED", "operation_id": standard["operation_id"], "intent_sha256": standard["intent_sha256"], "recovery_sha256": standard["recovery_sha256"], "decision": "ALREADY_COMMITTED"}
            return {"result": "ALREADY_COMMITTED", **standard}

        with patch.object(supervisor, "validate_original_notifier_egress_authorization_consumed"), \
             patch.object(supervisor, "prepare_runtime_privilege_node", return_value=(self.root / "runtime", self.root / "runtime/node")), \
             patch.object(supervisor, "run_notifier_egress_runner", side_effect=runner), \
             patch.object(supervisor, "consume_authorization", side_effect=lambda *_args: events.append(("consume", None))), \
             patch.object(supervisor, "activate_and_verify_notifier_egress_systemd", side_effect=lambda *_args: (events.append(("systemctl", None)) or digest("effective"))), \
             patch.object(supervisor, "cleanup_runtime_privilege_node"):
            result = supervisor.run_notifier_egress_authorization(
                self.root / "bundle", self.root / "pending.json", authorization, digest("recovery-authorization"), 9,
            )
        self.assertEqual(result["result"], "ALREADY_COMMITTED")
        self.assertEqual(events, [("recover-prepare", None), ("consume", None), ("recover-apply", None), ("systemctl", None)])

    def test_runner_uses_consumed_boundary_and_effective_digest_only_for_finalize(self):
        now = datetime(2026, 8, 15, 1, 0, tzinfo=timezone.utc)
        authorization = self.authorization("a" * 64, now)
        context = supervisor.notifier_egress_context(authorization, digest("authorization"))
        response = {
            "result": "COMMITTED", "operation_id": context["operation_id"], "intent_sha256": digest("intent"),
            "policy_sha256": digest("policy"), "receipt_sha256": digest("receipt"),
            "dropin_sha256": digest("dropin"), "effective_unit_sha256": digest("effective"),
        }
        with patch.object(supervisor.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=supervisor.canonical_json(response), stderr=b"")) as runner:
            self.assertEqual(supervisor.run_notifier_egress_runner(
                self.root / "node", self.root / "bundle", context, "finalize", 9, digest("effective"),
            ), response)
        environment = runner.call_args.kwargs["env"]
        self.assertEqual(environment["ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED"], "YES")
        self.assertEqual(environment["ERP_MONITORING_NOTIFIER_EGRESS_EFFECTIVE_UNIT_SHA256"], digest("effective"))
        self.assertEqual(runner.call_args.args[0][-2:], ["finalize", "FINALIZE_NOTIFIER_EGRESS_AFTER_EFFECTIVE_VERIFICATION"])


if __name__ == "__main__":
    unittest.main()
