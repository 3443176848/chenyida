import importlib.util
import os
import shutil
import stat
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


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
            "run_id": "fixture-alpha44",
            "web_image": f"registry.example.invalid/chenyida/web@sha256:{'c' * 64}",
            "worker_image": f"registry.example.invalid/chenyida/worker@sha256:{'d' * 64}",
            "sbom_evidence": "/var/lib/chenyida-erp/releases/fixture/fixture.sbom.json",
            "security_evidence": "/var/lib/chenyida-erp/releases/fixture/fixture.security.json",
        }
        if extra_parameter:
            parameters["command"] = "/bin/sh"
        value = {
            "schema_version": 1,
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
                "artifact_root": "/var/lib/chenyida-erp/releases/fixture", "run_id": "fixture-alpha44",
                "web_image": f"registry.example.invalid/chenyida/web@sha256:{'c' * 64}",
                "worker_image": f"registry.example.invalid/chenyida/worker@sha256:{'d' * 64}",
                "trivy_db_directory": "/var/lib/chenyida-erp/trivy-db",
            }),
            ("CREATE_RELEASE_MANIFEST", {
                "repository_root": "/opt/erp", "git_commit": "a" * 40, "git_tree": "b" * 40,
                "artifact_root": "/var/lib/chenyida-erp/releases/fixture", "release_id": "fixture-alpha44",
                "deployment_class": "UAT",
                "web_image": f"registry.example.invalid/chenyida/web@sha256:{'c' * 64}",
                "worker_image": f"registry.example.invalid/chenyida/worker@sha256:{'d' * 64}",
                "gate_plan": "/trusted/plan.json", "gate_report": "/trusted/report.json",
                "sbom_evidence": "/trusted/sbom.json", "security_evidence": "/trusted/security.json",
                "expires_at": "2026-08-12T02:00:00.000Z",
            }),
        ):
            operation_command = supervisor.command_for(Path("/trusted/bundle"), {"operation": operation, "parameters": parameters})
            self.assertEqual(operation_command[operation_command.index("--git-commit") + 1], "a" * 40)
            self.assertEqual(operation_command[operation_command.index("--git-tree") + 1], "b" * 40)
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


if __name__ == "__main__":
    unittest.main()
