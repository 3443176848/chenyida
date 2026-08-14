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
        self.assertNotIn("/bin/sh", command)
        for operation, parameters in (
            ("CREATE_IMAGE_EVIDENCE", {
                "repository_root": "/opt/erp", "git_commit": "a" * 40, "git_tree": "b" * 40,
                "artifact_root": "/var/lib/chenyida-erp/releases/fixture", "run_id": "fixture-alpha45",
                "web_image": f"registry.example.invalid/chenyida/web@sha256:{'c' * 64}",
                "worker_image": f"registry.example.invalid/chenyida/worker@sha256:{'d' * 64}",
                "trivy_db_directory": "/var/lib/chenyida-erp/trivy-db",
            }),
            ("CREATE_RELEASE_MANIFEST", {
                "repository_root": "/opt/erp", "git_commit": "a" * 40, "git_tree": "b" * 40,
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

    def test_postdeploy_authorization_validates_runtime_secret_files_before_consumption(self):
        source = MODULE_PATH.read_text(encoding="utf-8")
        validation = source.index('validate_runtime_secret_boundary(bundle_root, authorization["operation"])')
        probe_validation = source.index('validate_runtime_probe_receipt(authorization["parameters"], bundle_digest)', validation)
        consumption = source.index("consume_authorization(authorization_path, authorization, authorization_digest)", validation)
        self.assertLess(validation, consumption)
        self.assertLess(probe_validation, consumption)
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
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_RUNTIME_PROBE_TIME_INVALID"):
            supervisor.validate_runtime_probe_receipt(parameters, "f" * 64, now + timedelta(hours=2), root)
        parameters["runtime_configuration_sha256"] = "9" * 64
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_RUNTIME_PROBE_BINDING_INVALID"):
            supervisor.validate_runtime_probe_receipt(parameters, "f" * 64, now, root)


if __name__ == "__main__":
    unittest.main()
