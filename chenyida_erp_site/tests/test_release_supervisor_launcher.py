import importlib.util
import os
import shutil
import stat
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "release-supervisor-launcher.py"
SPEC = importlib.util.spec_from_file_location("release_supervisor_launcher", MODULE_PATH)
supervisor = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(supervisor)


def utc(value):
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


class ReleaseSupervisorLauncherTest(unittest.TestCase):
    def setUp(self):
        self.temporary = Path(tempfile.mkdtemp(prefix="cyd-release-supervisor-"))

    def tearDown(self):
        for directory, names, files in os.walk(self.temporary, topdown=False):
            for name in files:
                (Path(directory) / name).chmod(0o600)
            for name in names:
                (Path(directory) / name).chmod(0o700)
            Path(directory).chmod(0o700)
        shutil.rmtree(self.temporary)

    def bundle(self):
        launcher = self.temporary / "launcher"
        if launcher.exists():
            launcher.chmod(0o600)
            launcher.unlink()
        launcher.write_bytes(b"#!/usr/bin/python3\nprint('fixture')\n")
        launcher.chmod(0o555)
        staging = self.temporary / "staging"
        staging.mkdir(mode=0o755)
        entries = []
        for relative, mode in sorted(supervisor.BUNDLE_FILES.items()):
            file = staging / relative
            file.parent.mkdir(parents=True, exist_ok=True)
            raw = f"fixture:{relative}\n".encode()
            file.write_bytes(raw)
            file.chmod(int(mode, 8))
            entries.append({"path": relative, "sha256": supervisor.sha256(raw), "bytes": len(raw), "mode": mode})
        manifest = {
            "schema_version": 1,
            "contract": supervisor.BUNDLE_CONTRACT,
            "bundle_version": 1,
            "source_commit": "a" * 40,
            "source_tree": "b" * 40,
            "launcher_sha256": supervisor.sha256(launcher.read_bytes()),
            "files": entries,
        }
        manifest_raw = supervisor.canonical_json(manifest)
        (staging / "bundle-manifest.json").write_bytes(manifest_raw)
        (staging / "bundle-manifest.json").chmod(0o444)
        for directory, names, _ in os.walk(staging, topdown=False):
            for name in names:
                (Path(directory) / name).chmod(0o555)
            Path(directory).chmod(0o555)
        digest = supervisor.sha256(manifest_raw)
        root = self.temporary / digest
        staging.rename(root)
        return root, digest, launcher, manifest

    def authorization(self, pending, digest, now, extra_parameter=False):
        parameters = {
            "repository_root": "/opt/erp",
            "git_commit": "a" * 40,
            "git_tree": "b" * 40,
            "candidate_snapshot_receipt": "/var/lib/chenyida-erp/release-candidate-snapshots/receipts/fixture.prepared.json",
            "candidate_snapshot_receipt_sha256": "0" * 64,
            "test_runtime_root": "/opt/erp",
            "artifact_root": "/var/lib/chenyida-erp/releases/fixture",
            "run_id": "fixture-alpha45",
            "runtime_guard_contract": supervisor.RUNTIME_GUARD_CONTRACT,
            "runtime_guard_mode": supervisor.PRE_DEPLOY_RUNTIME_GUARD_MODE,
            "gate_plan_sha256": "1" * 64,
            "web_image": f"registry.example.invalid/chenyida/web@sha256:{'c' * 64}",
            "worker_image": f"registry.example.invalid/chenyida/worker@sha256:{'d' * 64}",
            "sbom_evidence": "/var/lib/chenyida-erp/releases/fixture/fixture.sbom.json",
            "security_evidence": "/var/lib/chenyida-erp/releases/fixture/fixture.security.json",
        }
        if extra_parameter:
            parameters["command"] = "/bin/sh"
        value = {
            "schema_version": 2,
            "contract": supervisor.AUTHORIZATION_CONTRACT,
            "authorization_id": "fixture-run",
            "created_at": utc(now - timedelta(minutes=1)),
            "expires_at": utc(now + timedelta(minutes=10)),
            "supervisor_bundle_sha256": digest,
            "operation": "RUN_RELEASE_GATE",
            "parameters": parameters,
            "nonce": "e" * 64,
            "confirmation": supervisor.CONFIRMATIONS["RUN_RELEASE_GATE"],
        }
        file = pending / "fixture-run.json"
        file.write_bytes(supervisor.canonical_json(value))
        file.chmod(0o400)
        return file, value

    def runtime_privilege_parameters(self, recovery=False, original_operation="BOOTSTRAP"):
        parameters = {
            "backup_root": str(supervisor.RUNTIME_PRIVILEGE_BACKUP_ROOT),
            "backup_credential_root": "/run/chenyida-erp/credentials",
            "backup_capture_service_file": "/run/chenyida-erp/credentials/pg_backup_capture_service.conf",
            "backup_capture_service": "erp_backup_capture",
            "compose_project_root": "/opt/erp/chenyida_erp_site",
            "credential_generation_id": "credential-generation-001",
            "deployment_class": "UAT",
            "deployment_id": "chenyida-erp",
            "expected_database": "chenyida_erp",
            "expected_database_marker": "chenyida-erp-deployment/v2:UAT:chenyida-erp",
            "expected_database_oid": "16384",
            "expected_system_identifier": "1234567890123456789",
            "postgres_container": "chenyida-erp-parallel-postgres-1",
            "postgres_container_id": "2" * 64,
            "release_manifest": "/var/lib/chenyida-erp/release-artifacts/fixture/release-manifest.json",
            "release_manifest_sha256": "3" * 64,
            "runtime_configuration_sha256": "4" * 64,
            "runtime_guard_mode": (
                supervisor.PRE_DEPLOY_POSTGRESQL_BOOTSTRAP_GUARD_MODE
                if original_operation == "BOOTSTRAP"
                else supervisor.POST_DEPLOY_RUNTIME_GUARD_MODE
            ),
            "runtime_policy_sha256": supervisor.RUNTIME_POLICY_SHA256,
        }
        if original_operation == "RECONCILE":
            parameters.update({
                "runtime_probe_receipt": "/var/lib/chenyida-erp/runtime-probes/runtime-privilege.runtime-configuration-probe.json",
                "runtime_probe_receipt_sha256": "5" * 64,
            })
        if recovery:
            parameters.update({
                "expected_intent_sha256": "6" * 64,
                "original_authorization_sha256": "7" * 64,
                "original_operation": original_operation,
                "original_operation_id": "runtime-privilege-original-001",
            })
        return parameters

    def runtime_privilege_authorization(self, digest, now, recovery=False):
        operation = "RECOVER_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT" if recovery else "BOOTSTRAP_POSTGRESQL_RUNTIME_PRIVILEGES"
        return {
            "schema_version": 3,
            "contract": supervisor.RUNTIME_PRIVILEGE_AUTHORIZATION_CONTRACT,
            "authorization_id": "runtime-privilege-recovery-001" if recovery else "runtime-privilege-original-001",
            "created_at": utc(now - timedelta(minutes=1)),
            "expires_at": utc(now + timedelta(minutes=10)),
            "supervisor_bundle_sha256": digest,
            "operation": operation,
            "parameters": self.runtime_privilege_parameters(recovery),
            "nonce": "8" * 64,
            "confirmation": supervisor.RUNTIME_PRIVILEGE_CONFIRMATIONS[operation],
        }

    def test_content_addressed_bundle_rejects_tampering_and_extra_files(self):
        root, digest, launcher, manifest = self.bundle()
        self.assertEqual(supervisor.verify_bundle(root, digest, launcher), manifest)
        staged = self.temporary / f".{digest}.staging-abcdefgh"
        root.rename(staged)
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_BUNDLE_PATH_INVALID"):
            supervisor.verify_bundle(staged, digest, launcher)
        self.assertEqual(supervisor.verify_staged_bundle(staged, digest, launcher), manifest)
        staged.rename(root)
        target = root / next(iter(supervisor.BUNDLE_FILES))
        target.chmod(0o644)
        target.write_bytes(b"tampered\n")
        target.chmod(int(supervisor.BUNDLE_FILES[target.relative_to(root).as_posix()], 8))
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_BUNDLE_FILE_DIGEST_MISMATCH"):
            supervisor.verify_bundle(root, digest, launcher)

        for directory, names, files in os.walk(root, topdown=False):
            for name in files:
                (Path(directory) / name).chmod(0o600)
            for name in names:
                (Path(directory) / name).chmod(0o700)
            Path(directory).chmod(0o700)
        shutil.rmtree(root)
        root, digest, launcher, _ = self.bundle()
        extra = root / "extra"
        root.chmod(0o755)
        extra.write_text("unexpected\n", encoding="utf-8")
        extra.chmod(0o444)
        root.chmod(0o555)
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_BUNDLE_EXTRA_OR_MISSING_FILE"):
            supervisor.verify_bundle(root, digest, launcher)

    def test_one_time_authorization_is_canonical_exact_and_maps_to_one_command(self):
        pending = self.temporary / "pending"
        consumed = self.temporary / "consumed"
        pending.mkdir(mode=0o700)
        consumed.mkdir(mode=0o700)
        now = datetime(2026, 8, 12, 1, 0, tzinfo=timezone.utc)
        digest = "f" * 64
        file, value = self.authorization(pending, digest, now)
        loaded, authorization_digest, _ = supervisor.load_authorization(file, digest, pending, now)
        self.assertEqual(loaded, value)
        command = supervisor.command_for(Path("/trusted/bundle"), loaded)
        self.assertEqual(command[0], "/trusted/bundle/chenyida_erp_site/scripts/run-release-gate.sh")
        self.assertEqual(command[command.index("--git-commit") + 1], "a" * 40)
        self.assertEqual(command[command.index("--git-tree") + 1], "b" * 40)
        self.assertEqual(command[command.index("--candidate-snapshot-receipt-sha256") + 1], "0" * 64)
        self.assertEqual(command[command.index("--test-runtime-root") + 1], "/opt/erp")
        self.assertNotIn("/bin/sh", command)
        for operation, parameters in (
            ("CREATE_IMAGE_EVIDENCE", {
                "repository_root": "/opt/erp", "git_commit": "a" * 40, "git_tree": "b" * 40,
                "candidate_snapshot_receipt": "/var/lib/chenyida-erp/release-candidate-snapshots/receipts/fixture.prepared.json",
                "candidate_snapshot_receipt_sha256": "0" * 64, "test_runtime_root": "/opt/erp",
                "artifact_root": "/var/lib/chenyida-erp/releases/fixture", "run_id": "fixture-alpha45",
                "web_image": f"registry.example.invalid/chenyida/web@sha256:{'c' * 64}",
                "worker_image": f"registry.example.invalid/chenyida/worker@sha256:{'d' * 64}",
                "trivy_db_directory": "/var/lib/chenyida-erp/trivy-db",
            }),
            ("CREATE_RELEASE_MANIFEST", {
                "repository_root": "/opt/erp", "git_commit": "a" * 40, "git_tree": "b" * 40,
                "candidate_snapshot_receipt": "/var/lib/chenyida-erp/release-candidate-snapshots/receipts/fixture.prepared.json",
                "candidate_snapshot_receipt_sha256": "0" * 64, "test_runtime_root": "/opt/erp",
                "artifact_root": "/var/lib/chenyida-erp/releases/fixture", "release_id": "fixture-alpha45",
                "deployment_class": "UAT",
                "web_image": f"registry.example.invalid/chenyida/web@sha256:{'c' * 64}",
                "worker_image": f"registry.example.invalid/chenyida/worker@sha256:{'d' * 64}",
                "gate_plan": "/trusted/plan.json", "gate_report": "/trusted/report.json",
                "sbom_evidence": "/trusted/sbom.json", "security_evidence": "/trusted/security.json",
                "expires_at": "2026-08-12T02:00:00.000Z",
                "runtime_guard_contract": supervisor.RUNTIME_GUARD_CONTRACT,
                "runtime_guard_mode": supervisor.PRE_DEPLOY_RUNTIME_GUARD_MODE,
                "gate_plan_sha256": "1" * 64,
            }),
        ):
            operation_command = supervisor.command_for(Path("/trusted/bundle"), {"operation": operation, "parameters": parameters})
            self.assertEqual(operation_command[operation_command.index("--git-commit") + 1], "a" * 40)
            self.assertEqual(operation_command[operation_command.index("--git-tree") + 1], "b" * 40)
            self.assertEqual(operation_command[operation_command.index("--candidate-snapshot-receipt-sha256") + 1], "0" * 64)
            self.assertEqual(operation_command[operation_command.index("--test-runtime-root") + 1], "/opt/erp")
        postdeploy_parameters = {
            "release_manifest": "/var/lib/chenyida-erp/release-artifacts/fixture/release-manifest.json",
            "release_manifest_sha256": "2" * 64,
            "postdeploy_root": "/var/lib/chenyida-erp/postdeploy/postdeploy-fixture",
            "identity_root": "/var/lib/chenyida-erp/release-identity",
            "reader_gid": 1234,
            "run_id": "postdeploy-fixture",
            "runtime_guard_contract": supervisor.RUNTIME_GUARD_CONTRACT,
            "runtime_guard_mode": supervisor.POST_DEPLOY_RUNTIME_GUARD_MODE,
            "runtime_policy_sha256": supervisor.RUNTIME_POLICY_SHA256,
            "runtime_configuration_sha256": "3" * 64,
            "runtime_probe_receipt": "/var/lib/chenyida-erp/runtime-probes/probe-fixture.runtime-configuration-probe.json",
            "runtime_probe_receipt_sha256": "4" * 64,
            "deployment_class": "UAT",
            "deployment_id": "chenyida-erp",
            "compose_project": "chenyida-erp",
            "compose_project_root": "/opt/erp/chenyida_erp_site",
            "caddy_container": "erp-uat-caddy-1",
            "postgres_container": "erp-uat-postgres-1",
            "web_container": "erp-uat-web-1",
            "worker_container": "erp-uat-worker-1",
        }
        supervisor.validate_parameters("VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY", postdeploy_parameters)
        postdeploy_command = supervisor.command_for(Path("/trusted/bundle"), {"operation": "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY", "parameters": postdeploy_parameters})
        self.assertEqual(postdeploy_command[0], "/trusted/bundle/chenyida_erp_site/scripts/write-release-identity.sh")
        self.assertEqual(postdeploy_command[postdeploy_command.index("--runtime-guard-mode") + 1], supervisor.POST_DEPLOY_RUNTIME_GUARD_MODE)
        self.assertEqual(postdeploy_command[postdeploy_command.index("--runtime-configuration-sha256") + 1], "3" * 64)
        self.assertEqual(postdeploy_command[postdeploy_command.index("--compose-project-root") + 1], "/opt/erp/chenyida_erp_site")
        self.assertNotIn(postdeploy_parameters["runtime_probe_receipt"], postdeploy_command)
        probe_parameters = {
            key: value for key, value in postdeploy_parameters.items()
            if key not in {"postdeploy_root", "identity_root", "run_id", "runtime_configuration_sha256", "runtime_probe_receipt", "runtime_probe_receipt_sha256"}
        }
        probe_parameters.update({"probe_root": "/var/lib/chenyida-erp/runtime-probes", "probe_id": "probe-fixture"})
        supervisor.validate_parameters("PROBE_POST_DEPLOY_RUNTIME_CONFIGURATION", probe_parameters)
        probe_command = supervisor.command_for(Path("/trusted/bundle"), {"operation": "PROBE_POST_DEPLOY_RUNTIME_CONFIGURATION", "parameters": probe_parameters})
        self.assertEqual(probe_command[0], "/trusted/bundle/chenyida_erp_site/scripts/probe-postdeploy-runtime-configuration.sh")
        self.assertEqual(probe_command[probe_command.index("--probe-id") + 1], "probe-fixture")
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_AUTHORIZATION_RUNTIME_GUARD_INVALID"):
            supervisor.validate_parameters("VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY", {**postdeploy_parameters, "runtime_guard_mode": supervisor.PRE_DEPLOY_RUNTIME_GUARD_MODE})
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_AUTHORIZATION_DIGEST_INVALID"):
            supervisor.validate_parameters("VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY", {**postdeploy_parameters, "runtime_configuration_sha256": "short"})
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_AUTHORIZATION_IDENTIFIER_INVALID"):
            supervisor.validate_parameters("VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY", {**postdeploy_parameters, "run_id": "r" * 102})
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_AUTHORIZATION_DEPLOYMENT_IDENTITY_INVALID"):
            supervisor.validate_parameters("VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY", {**postdeploy_parameters, "deployment_id": "other", "compose_project": "other"})
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_AUTHORIZATION_POSTDEPLOY_PATH_INVALID"):
            supervisor.validate_parameters("VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY", {**postdeploy_parameters, "identity_root": "/tmp/release-identity"})
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_AUTHORIZATION_POSTDEPLOY_PATH_INVALID"):
            supervisor.validate_parameters("VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY", {**postdeploy_parameters, "postdeploy_root": "/var/lib/chenyida-erp/postdeploy/other-run"})
        destination = supervisor.consume_authorization(file, loaded, authorization_digest, pending, consumed)
        self.assertTrue(destination.is_file())
        self.assertFalse(file.exists())
        with self.assertRaises(supervisor.SupervisorError):
            supervisor.load_authorization(file, digest, pending, now)

    def test_candidate_snapshot_verifier_uses_exact_lock_fd_environment_and_response(self):
        parameters = {
            "repository_root": "/var/lib/chenyida-erp/release-candidate-snapshots/worktrees/fixture",
            "git_commit": "a" * 40,
            "git_tree": "b" * 40,
            "candidate_snapshot_receipt": "/var/lib/chenyida-erp/release-candidate-snapshots/receipts/fixture.prepared.json",
            "candidate_snapshot_receipt_sha256": "c" * 64,
            "test_runtime_root": "/opt/erp",
        }
        bundle_root = Path("/usr/local/libexec/chenyida-erp-release-supervisor/bundles") / ("d" * 64)
        response = supervisor.canonical_json({
            "result": "VERIFIED",
            "snapshot_id": "fixture",
            "receipt_sha256": "c" * 64,
        })
        completed = supervisor.subprocess.CompletedProcess([], 0, response, b"")
        with patch.object(supervisor.subprocess, "run", return_value=completed) as run:
            supervisor.verify_candidate_snapshot(parameters, bundle_root, 9)
        command = run.call_args.args[0]
        self.assertEqual(command[0:3], ["/usr/bin/python3", str(bundle_root / "chenyida_erp_site/scripts/release-candidate-snapshot.py"), "verify"])
        self.assertEqual(command[command.index("--receipt") + 1], parameters["candidate_snapshot_receipt"])
        self.assertEqual(command[command.index("--receipt-sha256") + 1], "c" * 64)
        self.assertEqual(command[command.index("--test-runtime-root") + 1], "/opt/erp")
        self.assertEqual(command[command.index("--bundle-root") + 1], str(bundle_root))
        self.assertEqual(run.call_args.kwargs["pass_fds"], (9,))
        self.assertEqual(run.call_args.kwargs["env"]["ERP_RELEASE_GATE_LOCK_FD"], "9")
        self.assertEqual(run.call_args.kwargs["env"]["ERP_RELEASE_GATE_LOCK_HELD"], "YES")

        bad = supervisor.subprocess.CompletedProcess([], 0, response.replace(b"c" * 64, b"e" * 64), b"")
        with patch.object(supervisor.subprocess, "run", return_value=bad):
            with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_CANDIDATE_SNAPSHOT_INVALID"):
                supervisor.verify_candidate_snapshot(parameters, bundle_root, 9)

    def test_authorization_rejects_extra_command_field_and_noncanonical_json(self):
        pending = self.temporary / "pending"
        pending.mkdir(mode=0o700)
        now = datetime(2026, 8, 12, 1, 0, tzinfo=timezone.utc)
        digest = "f" * 64
        file, _ = self.authorization(pending, digest, now, extra_parameter=True)
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_AUTHORIZATION_PARAMETERS_INVALID"):
            supervisor.load_authorization(file, digest, pending, now)
        file.unlink()
        _, value = self.authorization(pending, digest, now)
        file.chmod(0o600)
        file.write_text(__import__("json").dumps(value, indent=2) + "\n", encoding="utf-8")
        file.chmod(0o400)
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_AUTHORIZATION_NOT_CANONICAL"):
            supervisor.load_authorization(file, digest, pending, now)

    def test_runtime_privilege_v3_authorization_is_exact_and_recovery_binds_the_original_intent(self):
        now = datetime(2026, 8, 13, 1, 0, tzinfo=timezone.utc)
        digest = "f" * 64
        original = self.runtime_privilege_authorization(digest, now)
        self.assertEqual(supervisor.validate_authorization(original, digest, now), original)
        original_context = supervisor.runtime_privilege_context(original, "9" * 64)
        self.assertEqual(original_context["schema_version"], 2)
        self.assertEqual(original_context["execution_mode"], "ORIGINAL")
        self.assertEqual(original_context["operation"], "BOOTSTRAP")
        self.assertEqual(original_context["execution_authorization_sha256"], "9" * 64)
        self.assertIsNone(original_context["expected_intent_sha256"])

        recovery = self.runtime_privilege_authorization(digest, now, recovery=True)
        self.assertEqual(supervisor.validate_authorization(recovery, digest, now), recovery)
        recovery_context = supervisor.runtime_privilege_context(recovery, "a" * 64)
        self.assertEqual(recovery_context["execution_mode"], "RECOVERY")
        self.assertEqual(recovery_context["operation_id"], recovery["parameters"]["original_operation_id"])
        self.assertEqual(recovery_context["authorization_sha256"], "7" * 64)
        self.assertEqual(recovery_context["execution_authorization_sha256"], "a" * 64)
        self.assertEqual(recovery_context["expected_intent_sha256"], "6" * 64)
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_RUNTIME_PRIVILEGE_PARAMETERS_INVALID"):
            supervisor.validate_authorization({**recovery, "parameters": {key: value for key, value in recovery["parameters"].items() if key != "expected_intent_sha256"}}, digest, now)
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_RUNTIME_PRIVILEGE_IDENTIFIER_INVALID"):
            supervisor.validate_authorization({**recovery, "authorization_id": recovery["parameters"]["original_operation_id"]}, digest, now)

    def test_bootstrap_uses_a_database_bound_predeploy_guard_and_reconcile_requires_postdeploy_evidence(self):
        now = datetime(2026, 8, 13, 1, 0, tzinfo=timezone.utc)
        bootstrap = self.runtime_privilege_parameters()
        self.assertNotIn("runtime_probe_receipt", bootstrap)
        self.assertEqual(
            supervisor.validate_runtime_privilege_parameters(
                bootstrap, "BOOTSTRAP_POSTGRESQL_RUNTIME_PRIVILEGES",
            ),
            bootstrap,
        )
        first = supervisor.runtime_privilege_probe_binding(bootstrap, "BOOTSTRAP")
        second = supervisor.runtime_privilege_probe_binding(dict(bootstrap), "BOOTSTRAP")
        self.assertRegex(first, r"^[0-9a-f]{64}$")
        self.assertEqual(first, second)
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_RUNTIME_PRIVILEGE_BACKUP_ROOT_INVALID"):
            supervisor.validate_runtime_privilege_parameters(
                {**bootstrap, "backup_root": "/var/backups/another-root"},
                "BOOTSTRAP_POSTGRESQL_RUNTIME_PRIVILEGES",
            )
        with patch.object(
            supervisor,
            "validate_runtime_privilege_release_manifest",
            return_value={"promotion_status": "ELIGIBLE"},
        ):
            self.assertEqual(
                supervisor.validate_runtime_privilege_probe_receipt(
                    bootstrap, "f" * 64, now,
                    operation="BOOTSTRAP_POSTGRESQL_RUNTIME_PRIVILEGES",
                ),
                {"promotion_status": "ELIGIBLE"},
            )
        reconcile = self.runtime_privilege_parameters(original_operation="RECONCILE")
        self.assertEqual(
            supervisor.validate_runtime_privilege_parameters(
                reconcile, "RECONCILE_POSTGRESQL_RUNTIME_PRIVILEGES",
            ),
            reconcile,
        )
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_RUNTIME_PRIVILEGE_PARAMETERS_INVALID"):
            supervisor.validate_runtime_privilege_parameters(
                {key: value for key, value in reconcile.items() if key != "runtime_probe_receipt"},
                "RECONCILE_POSTGRESQL_RUNTIME_PRIVILEGES",
            )

    def test_recovery_requires_the_exact_consumed_original_authorization(self):
        now = datetime(2026, 8, 13, 1, 0, tzinfo=timezone.utc)
        digest = "f" * 64
        consumed = self.temporary / "consumed"
        consumed.mkdir(mode=0o700)
        original = self.runtime_privilege_authorization(digest, now)
        original_raw = supervisor.canonical_json(original)
        original_digest = supervisor.sha256(original_raw)
        file = consumed / f"{original['authorization_id']}.{original_digest}.json"
        file.write_bytes(original_raw)
        file.chmod(0o400)
        recovery_parameters = self.runtime_privilege_parameters(recovery=True)
        recovery_parameters["original_authorization_sha256"] = original_digest
        self.assertEqual(
            supervisor.validate_original_runtime_privilege_authorization_consumed(recovery_parameters, digest, consumed),
            original,
        )
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_RUNTIME_PRIVILEGE_ORIGINAL_AUTHORIZATION_INVALID"):
            supervisor.validate_original_runtime_privilege_authorization_consumed({**recovery_parameters, "postgres_container_id": "a" * 64}, digest, consumed)

    def test_runtime_privilege_supervisor_prepares_before_consumption_for_original_and_recovery(self):
        now = datetime(2026, 8, 13, 1, 0, tzinfo=timezone.utc)
        digest = "f" * 64
        authorization_path = Path("/trusted/pending/runtime-privilege.json")
        for recovery in (False, True):
            authorization = self.runtime_privilege_authorization(digest, now, recovery=recovery)
            authorization_digest = "a" * 64 if recovery else "9" * 64
            events = []
            context = supervisor.runtime_privilege_context(authorization, authorization_digest)

            def run_runner(_node, _bundle, actual_context, phase, descriptor):
                self.assertEqual(actual_context, context)
                self.assertEqual(descriptor, 23)
                events.append(phase)
                if phase.endswith("prepare"):
                    return {"result": "RECOVERY_PREPARED" if recovery else "PREPARED"}
                return {"result": "VERIFIED"}

            with patch.object(supervisor, "acquire_global_release_lock", return_value=23), \
                patch.object(supervisor, "validate_original_runtime_privilege_authorization_consumed", side_effect=lambda *_: events.append("original-consumed")), \
                patch.object(supervisor, "prepare_runtime_privilege_node", return_value=(Path("/tmp/runtime-node"), Path("/tmp/runtime-node/node"))), \
                patch.object(supervisor, "runtime_privilege_context", return_value=context), \
                patch.object(supervisor, "run_runtime_privilege_runner", side_effect=run_runner), \
                patch.object(supervisor, "consume_authorization", side_effect=lambda *_: events.append("authorization-consumed")), \
                patch.object(supervisor, "cleanup_runtime_privilege_node", side_effect=lambda *_: events.append("node-cleaned")), \
                patch.object(supervisor.os, "close", side_effect=lambda descriptor: events.append(f"lock-closed-{descriptor}")):
                result = supervisor.run_runtime_privilege_authorization(Path("/trusted/bundle"), authorization_path, authorization, authorization_digest)
            self.assertEqual(result, {"result": "VERIFIED"})
            expected = (["original-consumed"] if recovery else []) + [
                "recover-prepare" if recovery else "prepare",
                "authorization-consumed",
                "recover-execute" if recovery else "execute",
                "node-cleaned",
                "lock-closed-23",
            ]
            self.assertEqual(events, expected)

    def test_runtime_privilege_supervisor_reuses_caller_global_lock_without_closing_it(self):
        now = datetime(2026, 8, 13, 1, 0, tzinfo=timezone.utc)
        digest = "f" * 64
        authorization = self.runtime_privilege_authorization(digest, now)
        authorization_path = Path("/trusted/pending/runtime-privilege.json")
        authorization_digest = "9" * 64
        phases = []
        with patch.object(supervisor, "acquire_global_release_lock", side_effect=AssertionError("caller lock must be reused")), \
            patch.object(supervisor, "prepare_runtime_privilege_node", return_value=(Path("/tmp/runtime-node"), Path("/tmp/runtime-node/node"))), \
            patch.object(supervisor, "runtime_privilege_context", return_value={"operation_id": authorization["authorization_id"]}), \
            patch.object(supervisor, "run_runtime_privilege_runner", side_effect=lambda *_args: phases.append(_args[3]) or {"result": "VERIFIED"}), \
            patch.object(supervisor, "consume_authorization"), \
            patch.object(supervisor, "cleanup_runtime_privilege_node"), \
            patch.object(supervisor.os, "close") as close:
            result = supervisor.run_runtime_privilege_authorization(
                Path("/trusted/bundle"), authorization_path, authorization, authorization_digest, 23,
            )
        self.assertEqual(result, {"result": "VERIFIED"})
        self.assertEqual(phases, ["prepare", "execute"])
        close.assert_not_called()

    def test_postdeploy_authorization_validates_runtime_secret_files_before_consumption(self):
        source = MODULE_PATH.read_text(encoding="utf-8")
        main_source = source[source.index("def main() -> None:"):]
        global_lock = main_source.index("lock_descriptor = acquire_global_release_lock()")
        validation = source.index('validate_runtime_secret_boundary(bundle_root, authorization["operation"])')
        probe_validation = source.index('validate_runtime_probe_receipt(authorization["parameters"], bundle_digest)', validation)
        consumption = source.index("consume_authorization(authorization_path, authorization, authorization_digest)", validation)
        self.assertLess(global_lock, main_source.index('validate_runtime_secret_boundary(bundle_root, authorization["operation"])'))
        self.assertLess(validation, consumption)
        self.assertLess(probe_validation, consumption)
        self.assertIn('"ERP_RELEASE_GATE_LOCK_FD": str(lock_descriptor)', main_source)
        self.assertLess(main_source.index("consume_authorization(authorization_path, authorization, authorization_digest)"), main_source.index("os.execve(command[0], command, environment)"))
        bundle = Path("/trusted/bundle")
        expected = f"RUNTIME_SECRET_FILES_VERIFIED entries=6 policy_sha256={supervisor.RUNTIME_SECRET_POLICY_SHA256}\n"
        completed = supervisor.subprocess.CompletedProcess([], 0, expected, "")
        with patch.object(supervisor.subprocess, "run", return_value=completed) as run:
            supervisor.validate_runtime_secret_boundary(bundle, "RUN_RELEASE_GATE")
            run.assert_not_called()
            supervisor.validate_runtime_secret_boundary(bundle, "PROBE_POST_DEPLOY_RUNTIME_CONFIGURATION")
            self.assertEqual(run.call_count, 1)
            supervisor.validate_runtime_secret_boundary(bundle, "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY")
            arguments = run.call_args.args[0]
            self.assertEqual(arguments[0], "/usr/bin/python3")
            self.assertEqual(arguments[1], "/trusted/bundle/chenyida_erp_site/scripts/runtime-secret-file-policy.py")
            self.assertEqual(arguments[-1], "/trusted/bundle/chenyida_erp_site/operations/runtime-secret-file-policy-v1.json")
            self.assertFalse({"DATABASE_URL", "ERP_ADMIN_PASSWORD", "ERP_SETUP_TOKEN", "POSTGRES_PASSWORD"}.intersection(run.call_args.kwargs["env"]))
        failed = supervisor.subprocess.CompletedProcess([], 1, "", "RUNTIME_SECRET_FILE_UNAVAILABLE\n")
        with patch.object(supervisor.subprocess, "run", return_value=failed):
            with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_RUNTIME_SECRET_FILES_INVALID"):
                supervisor.validate_runtime_secret_boundary(bundle, "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY")

    def test_postdeploy_runtime_digest_requires_an_unexpired_root_owned_probe_receipt(self):
        root = self.temporary / "runtime-probes"
        root.mkdir(mode=0o700)
        now = datetime(2026, 8, 12, 1, 0, tzinfo=timezone.utc)
        parameters = {
            "release_manifest": "/var/lib/chenyida-erp/release-artifacts/fixture/release-manifest.json",
            "release_manifest_sha256": "2" * 64,
            "postdeploy_root": "/var/lib/chenyida-erp/postdeploy/postdeploy-fixture",
            "identity_root": "/var/lib/chenyida-erp/release-identity",
            "reader_gid": 1234,
            "run_id": "postdeploy-fixture",
            "runtime_guard_contract": supervisor.RUNTIME_GUARD_CONTRACT,
            "runtime_guard_mode": supervisor.POST_DEPLOY_RUNTIME_GUARD_MODE,
            "runtime_policy_sha256": supervisor.RUNTIME_POLICY_SHA256,
            "runtime_configuration_sha256": "3" * 64,
            "runtime_probe_receipt": str(root / "probe-fixture.runtime-configuration-probe.json"),
            "runtime_probe_receipt_sha256": "0" * 64,
            "deployment_class": "UAT",
            "deployment_id": "chenyida-erp",
            "compose_project": "chenyida-erp",
            "compose_project_root": "/opt/erp/chenyida_erp_site",
            "caddy_container": "erp-uat-caddy-1",
            "postgres_container": "erp-uat-postgres-1",
            "web_container": "erp-uat-web-1",
            "worker_container": "erp-uat-worker-1",
        }
        services = []
        for index, service in enumerate(("caddy", "postgres", "web", "worker")):
            services.append({
                "service": service,
                "container_id": str(index + 1) * 64,
                "image_id": f"sha256:{str(index + 5) * 64}",
                "image_reference": f"registry.example.invalid/chenyida/{service}@sha256:{str(index + 5) * 64}",
                "restart_count": 0,
                "oom_killed": False,
                "running": True,
                "restarting": False,
                "paused": False,
                "dead": False,
                "status": "running",
                "health": "none" if service == "caddy" else "healthy",
                "healthcheck_present": service != "caddy",
            })
        receipt = {
            "schema_version": 1,
            "contract": supervisor.RUNTIME_PROBE_CONTRACT,
            "probe_id": "probe-fixture",
            "probed_at": utc(now),
            "expires_at": utc(now + timedelta(hours=1)),
            "control": {"supervisor_bundle_sha256": "f" * 64, "authorization_sha256": "a" * 64},
            "deployment": {"class": "UAT", "id": "chenyida-erp", "compose_project": "chenyida-erp"},
            "release": {"manifest_sha256": "2" * 64, "git_commit": "b" * 40, "package_version": "0.1.0-alpha.47"},
            "runtime_guard": {"contract": supervisor.RUNTIME_GUARD_CONTRACT, "mode": supervisor.POST_DEPLOY_RUNTIME_GUARD_MODE},
            "runtime_policy_sha256": supervisor.RUNTIME_POLICY_SHA256,
            "runtime_secret_policy_sha256": supervisor.RUNTIME_SECRET_POLICY_SHA256,
            "runtime_configuration_sha256": "3" * 64,
            "compose_project_root_sha256": supervisor.sha256(parameters["compose_project_root"].encode("utf-8")),
            "selectors": {service: parameters[f"{service}_container"] for service in ("caddy", "postgres", "web", "worker")},
            "services": services,
        }
        raw = supervisor.canonical_json(receipt)
        file = Path(parameters["runtime_probe_receipt"])
        file.write_bytes(raw)
        file.chmod(0o400)
        parameters["runtime_probe_receipt_sha256"] = supervisor.sha256(raw)
        self.assertEqual(supervisor.validate_runtime_probe_receipt(parameters, "f" * 64, now, root), receipt)
        runtime_parameters = self.runtime_privilege_parameters(original_operation="RECONCILE")
        runtime_parameters.update({
            "compose_project_root": parameters["compose_project_root"],
            "deployment_class": parameters["deployment_class"],
            "deployment_id": parameters["deployment_id"],
            "postgres_container": parameters["postgres_container"],
            "postgres_container_id": services[1]["container_id"],
            "release_manifest_sha256": parameters["release_manifest_sha256"],
            "runtime_configuration_sha256": parameters["runtime_configuration_sha256"],
            "runtime_probe_receipt": parameters["runtime_probe_receipt"],
            "runtime_probe_receipt_sha256": parameters["runtime_probe_receipt_sha256"],
        })
        with patch.object(supervisor, "RUNTIME_PROBE_ROOT", root), \
            patch.object(supervisor, "validate_runtime_privilege_release_manifest", return_value={"promotion_status": "ELIGIBLE"}):
            self.assertEqual(supervisor.validate_runtime_privilege_probe_receipt(
                runtime_parameters, "f" * 64, now,
                operation="RECONCILE_POSTGRESQL_RUNTIME_PRIVILEGES", probe_root=root,
            ), receipt)
            with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_RUNTIME_PRIVILEGE_CONTAINER_MISMATCH"):
                supervisor.validate_runtime_privilege_probe_receipt(
                    {**runtime_parameters, "postgres_container_id": "a" * 64}, "f" * 64, now,
                    operation="RECONCILE_POSTGRESQL_RUNTIME_PRIVILEGES", probe_root=root,
                )
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_RUNTIME_PROBE_TIME_INVALID"):
            supervisor.validate_runtime_probe_receipt(parameters, "f" * 64, now + timedelta(hours=2), root)
        parameters["runtime_configuration_sha256"] = "9" * 64
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_RUNTIME_PROBE_BINDING_INVALID"):
            supervisor.validate_runtime_probe_receipt(parameters, "f" * 64, now, root)


if __name__ == "__main__":
    unittest.main()
