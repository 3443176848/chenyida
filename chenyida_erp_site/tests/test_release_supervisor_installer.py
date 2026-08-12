import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "install-release-supervisor.py"
SPEC = importlib.util.spec_from_file_location("install_release_supervisor", MODULE_PATH)
installer = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(installer)

GENERATOR_PATH = Path(__file__).resolve().parents[1] / "scripts" / "create-release-supervisor-bundle-manifest.py"
GENERATOR_SPEC = importlib.util.spec_from_file_location("create_release_supervisor_bundle_manifest", GENERATOR_PATH)
generator = importlib.util.module_from_spec(GENERATOR_SPEC)
assert GENERATOR_SPEC.loader is not None
GENERATOR_SPEC.loader.exec_module(generator)
SITE_ROOT = Path(__file__).resolve().parents[1]


def bundled_source(relative):
    prefix = "chenyida_erp_site/"
    if not relative.startswith(prefix):
        raise AssertionError(f"unexpected bundle path: {relative}")
    return SITE_ROOT / relative.removeprefix(prefix)


def utc(value):
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


class ReleaseSupervisorInstallerTest(unittest.TestCase):
    def authorization(self, now):
        return {
            "schema_version": 1,
            "contract": installer.INSTALL_CONTRACT,
            "authorization_id": "install-alpha45",
            "created_at": utc(now - timedelta(minutes=1)),
            "expires_at": utc(now + timedelta(minutes=10)),
            "repository_root": "/opt/erp",
            "source_commit": "a" * 40,
            "source_tree": "b" * 40,
            "manifest_commit": "c" * 40,
            "manifest_tree": "d" * 40,
            "bundle_manifest_sha256": "e" * 64,
            "launcher_sha256": "f" * 64,
            "installer_sha256": "1" * 64,
            "nonce": "2" * 64,
            "confirmation": installer.INSTALL_CONFIRMATION,
        }

    def test_install_authorization_is_exact_short_lived_and_canonical(self):
        now = datetime(2026, 8, 12, 1, 0, tzinfo=timezone.utc)
        value = self.authorization(now)
        self.assertEqual(installer.validate_authorization(value, now), value)
        self.assertEqual(installer.strict_json(installer.canonical_json(value), "INVALID"), value)
        with self.assertRaisesRegex(installer.InstallError, "SUPERVISOR_INSTALL_AUTHORIZATION_FIELDS_INVALID"):
            installer.validate_authorization({**value, "command": "/bin/sh"}, now)
        with self.assertRaisesRegex(installer.InstallError, "SUPERVISOR_INSTALL_AUTHORIZATION_TIME_INVALID"):
            installer.validate_authorization({**value, "expires_at": utc(now - timedelta(seconds=1))}, now)

    def test_installer_cli_accepts_only_the_fixed_install_action(self):
        repository, authorization = installer.parse_cli(["--repository-root", "/opt/erp", "--authorization-file", "/trusted/install.json", "--confirm", installer.INSTALL_CONFIRMATION])
        self.assertEqual(repository, Path("/opt/erp"))
        self.assertEqual(authorization, Path("/trusted/install.json"))
        with self.assertRaisesRegex(installer.InstallError, "SUPERVISOR_INSTALL_CLI_ARGUMENT_INVALID"):
            installer.parse_cli(["--repository-root", "/opt/erp", "--authorization-file", "/trusted/install.json", "--confirm", "RUN_SHELL"])

    def test_root_file_writer_preserves_exact_content_and_mode(self):
        with tempfile.TemporaryDirectory(prefix="cyd-supervisor-installer-") as directory:
            target = Path(directory) / "bundle-file"
            with patch.object(installer.os, "fchown") as fchown:
                installer.write_root_file(target, b"exact bundle bytes\n", 0o444)
            fchown.assert_called_once()
            self.assertEqual(target.read_bytes(), b"exact bundle bytes\n")
            self.assertEqual(target.stat().st_mode & 0o777, 0o444)
            with self.assertRaises(FileExistsError):
                installer.write_root_file(target, b"replacement\n", 0o555)
            failed = Path(directory) / "partial"
            with patch.object(installer.os, "write", return_value=0), patch.object(installer.os, "fchown"):
                with self.assertRaisesRegex(installer.InstallError, "SUPERVISOR_INSTALL_FILE_WRITE_FAILED"):
                    installer.write_root_file(failed, b"partial bytes\n", 0o400)
            self.assertFalse(failed.exists())

    def test_new_install_directories_are_persisted_in_their_parent(self):
        with tempfile.TemporaryDirectory(prefix="cyd-supervisor-directory-") as directory:
            root = Path(directory)
            target = root / "state"
            with patch.object(installer.os, "chown"), patch.object(installer, "fsync_directory") as sync:
                installer.ensure_directory(target, 0o700)
            sync.assert_called_once_with(root)
            self.assertEqual(target.stat().st_mode & 0o777, 0o700)
            with patch.object(installer, "fsync_directory") as sync_existing:
                installer.ensure_directory(target, 0o700)
            sync_existing.assert_not_called()

    def test_install_lock_rejects_concurrent_installer(self):
        with tempfile.TemporaryDirectory(prefix="cyd-supervisor-lock-") as directory:
            lock = Path(directory) / "install.lock"
            first = installer.acquire_install_lock(lock)
            try:
                with self.assertRaisesRegex(installer.InstallError, "SUPERVISOR_INSTALL_LOCK_BUSY"):
                    installer.acquire_install_lock(lock)
            finally:
                installer.os.close(first)
            second = installer.acquire_install_lock(lock)
            installer.os.close(second)

    def test_bundle_manifest_generator_uses_literal_allowlist_and_exact_blob_bytes(self):
        launcher_raw = (Path(__file__).resolve().parents[1] / "scripts" / "release-supervisor-launcher.py").read_bytes()
        files = generator.parse_bundle_files(launcher_raw)
        self.assertIn("chenyida_erp_site/scripts/release-migration-authorization.ts", files)
        self.assertIn("chenyida_erp_site/tests/test_release_supervisor_installer.py", files)
        blobs = {relative: f"blob:{relative}\n".encode() for relative in files}
        blobs[generator.LAUNCHER_REPOSITORY_PATH] = launcher_raw
        manifest = generator.build_manifest("a" * 40, "b" * 40, launcher_raw, blobs.__getitem__)
        self.assertEqual([entry["path"] for entry in manifest["files"]], sorted(files))
        self.assertEqual(manifest["launcher_sha256"], generator.sha256(launcher_raw))
        rendered = generator.canonical_json(manifest)
        self.assertTrue(rendered.endswith(b"\n"))
        self.assertEqual(json.loads(rendered), manifest)

    def test_manifest_commit_must_be_the_single_file_direct_child_of_source(self):
        authorization = self.authorization(datetime.now(timezone.utc))

        def valid_git(_repository, *arguments, **_kwargs):
            if arguments[:2] == ("cat-file", "commit"):
                return f"tree {authorization['manifest_tree']}\nparent {authorization['source_commit']}\nauthor Test <test@example.invalid> 0 +0000\ncommitter Test <test@example.invalid> 0 +0000\n\nmanifest"
            if arguments[:5] == ("diff-tree", "--no-commit-id", "--name-status", "--no-renames", "-r"):
                return f"A\t{installer.BUNDLE_MANIFEST_REPOSITORY_PATH}"
            raise AssertionError(arguments)

        with patch.object(installer, "git", side_effect=valid_git):
            installer.validate_manifest_commit_relationship(Path("/opt/erp"), authorization)
        with patch.object(installer, "git", return_value=f"tree {authorization['manifest_tree']}\nparent {'9' * 40}\n\nmanifest"):
            with self.assertRaisesRegex(installer.InstallError, "SUPERVISOR_INSTALL_MANIFEST_COMMIT_RELATIONSHIP_INVALID"):
                installer.validate_manifest_commit_relationship(Path("/opt/erp"), authorization)

        calls = iter((f"tree {authorization['manifest_tree']}\nparent {authorization['source_commit']}\n\nmanifest", f"A\t{installer.BUNDLE_MANIFEST_REPOSITORY_PATH}\nM\tchenyida_erp_site/package.json"))
        with patch.object(installer, "git", side_effect=lambda *_args, **_kwargs: next(calls)):
            with self.assertRaisesRegex(installer.InstallError, "SUPERVISOR_INSTALL_MANIFEST_COMMIT_SCOPE_INVALID"):
                installer.validate_manifest_commit_relationship(Path("/opt/erp"), authorization)

    def test_manifest_topology_ignores_replace_refs_and_reads_raw_commit_parent(self):
        with tempfile.TemporaryDirectory(prefix="cyd-supervisor-git-topology-") as directory:
            repository = Path(directory).resolve()
            subprocess.run(["git", "init", "-q", str(repository)], check=True)
            subprocess.run(["git", "-C", str(repository), "config", "user.name", "Task 42 Test"], check=True)
            subprocess.run(["git", "-C", str(repository), "config", "user.email", "task42@example.invalid"], check=True)
            source_file = repository / "source.txt"
            source_file.write_text("source\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(repository), "add", "source.txt"], check=True)
            subprocess.run(["git", "-C", str(repository), "commit", "-qm", "source"], check=True)
            source_commit = subprocess.check_output(["git", "-C", str(repository), "rev-parse", "HEAD"], text=True).strip()
            manifest_file = repository / installer.BUNDLE_MANIFEST_REPOSITORY_PATH
            manifest_file.parent.mkdir(parents=True)
            manifest_file.write_text("{}\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(repository), "add", installer.BUNDLE_MANIFEST_REPOSITORY_PATH], check=True)
            manifest_tree = subprocess.check_output(["git", "-C", str(repository), "write-tree"], text=True).strip()
            source_tree = subprocess.check_output(["git", "-C", str(repository), "rev-parse", f"{source_commit}^{{tree}}"], text=True).strip()
            wrong_parent = subprocess.check_output(["git", "-C", str(repository), "commit-tree", source_tree, "-m", "wrong parent"], text=True).strip()
            invalid_commit = subprocess.check_output(["git", "-C", str(repository), "commit-tree", manifest_tree, "-p", wrong_parent, "-m", "invalid manifest"], text=True).strip()
            replacement = subprocess.check_output(["git", "-C", str(repository), "commit-tree", manifest_tree, "-p", source_commit, "-m", "forged replacement"], text=True).strip()
            subprocess.run(["git", "-C", str(repository), "replace", invalid_commit, replacement], check=True)
            authorization = self.authorization(datetime.now(timezone.utc))
            authorization.update({"source_commit": source_commit, "source_tree": source_tree, "manifest_commit": invalid_commit, "manifest_tree": manifest_tree})
            with self.assertRaisesRegex(installer.InstallError, "SUPERVISOR_INSTALL_MANIFEST_COMMIT_RELATIONSHIP_INVALID"):
                installer.validate_manifest_commit_relationship(repository, authorization)

    def test_bundle_total_size_is_rejected_before_any_blob_is_loaded(self):
        authorization = self.authorization(datetime.now(timezone.utc))
        entries = [
            {"path": "chenyida_erp_site/a", "sha256": "1" * 64, "bytes": 2, "mode": "0444"},
            {"path": "chenyida_erp_site/b", "sha256": "2" * 64, "bytes": 2, "mode": "0444"},
        ]
        manifest = {"schema_version": 1, "contract": installer.BUNDLE_CONTRACT, "bundle_version": 1, "source_commit": authorization["source_commit"], "source_tree": authorization["source_tree"], "launcher_sha256": authorization["launcher_sha256"], "files": entries}
        with patch.object(installer, "MAX_BUNDLE_BYTES", 3), patch.object(installer, "git_blob") as blob:
            with self.assertRaisesRegex(installer.InstallError, "SUPERVISOR_INSTALL_MANIFEST_TOTAL_BYTES_INVALID"):
                installer.validate_bundle_payload(Path("/opt/erp"), authorization, installer.canonical_json(manifest))
        blob.assert_not_called()

    def test_invalid_bundle_is_rejected_before_install_state_is_created(self):
        with tempfile.TemporaryDirectory(prefix="cyd-supervisor-invalid-bundle-") as directory:
            repository = Path(directory).resolve()
            authorization = self.authorization(datetime.now(timezone.utc))
            installer_raw = MODULE_PATH.read_bytes()
            launcher_raw = b"#!/usr/bin/python3\n"
            manifest = {
                "schema_version": 1,
                "contract": "chenyida-erp-release-supervisor-bundle/v1",
                "bundle_version": 1,
                "source_commit": authorization["source_commit"],
                "source_tree": authorization["source_tree"],
                "launcher_sha256": installer.sha256(launcher_raw),
                "files": [],
            }
            manifest_raw = installer.canonical_json(manifest)
            authorization.update({
                "repository_root": str(repository),
                "installer_sha256": installer.sha256(installer_raw),
                "launcher_sha256": installer.sha256(launcher_raw),
                "bundle_manifest_sha256": installer.sha256(manifest_raw),
            })

            def fake_git(_repository, *arguments, **_kwargs):
                if arguments == ("rev-parse", "--show-toplevel"):
                    return str(repository)
                if arguments[:2] == ("rev-parse", "--verify"):
                    requested = arguments[2]
                    for commit_field, tree_field in (("source_commit", "source_tree"), ("manifest_commit", "manifest_tree")):
                        if requested == f"{authorization[commit_field]}^{{commit}}":
                            return authorization[commit_field]
                        if requested == f"{authorization[commit_field]}^{{tree}}":
                            return authorization[tree_field]
                if arguments[:2] == ("cat-file", "commit"):
                    return f"tree {authorization['manifest_tree']}\nparent {authorization['source_commit']}\n\nmanifest"
                if arguments[:5] == ("diff-tree", "--no-commit-id", "--name-status", "--no-renames", "-r"):
                    return f"A\t{installer.BUNDLE_MANIFEST_REPOSITORY_PATH}"
                raise AssertionError(arguments)

            def fake_blob(_repository, commit, relative, **_kwargs):
                if commit == authorization["source_commit"] and relative == installer.INSTALLER_REPOSITORY_PATH:
                    return installer_raw
                if commit == authorization["source_commit"] and relative == installer.LAUNCHER_REPOSITORY_PATH:
                    return launcher_raw
                if commit == authorization["manifest_commit"] and relative == installer.BUNDLE_MANIFEST_REPOSITORY_PATH:
                    return manifest_raw
                raise AssertionError((commit, relative))

            with patch.object(installer, "git", side_effect=fake_git), patch.object(installer, "git_blob", side_effect=fake_blob), patch.object(installer, "ensure_directory") as ensure_directory:
                with self.assertRaisesRegex(installer.InstallError, "SUPERVISOR_INSTALL_MANIFEST_FILES_INVALID"):
                    installer.install(repository, authorization, None, installer.sha256(installer.canonical_json(authorization)), MODULE_PATH)
            ensure_directory.assert_not_called()

    def test_main_recovers_with_the_content_addressed_authorized_installer_after_checkout_changes(self):
        with tempfile.TemporaryDirectory(prefix="cyd-supervisor-installer-recovery-") as directory:
            root = Path(directory)
            authorization = self.authorization(datetime.now(timezone.utc))
            authorized_raw = b"#!/usr/bin/python3\n# exact authorized installer\n"
            current_raw = b"#!/usr/bin/python3\n# later checkout installer\n"
            authorization["repository_root"] = str(root / "repository")
            authorization["installer_sha256"] = installer.sha256(authorized_raw)
            authorization_digest = installer.sha256(installer.canonical_json(authorization))
            current_installer = root / "current-installer.py"
            current_installer.write_bytes(current_raw)
            current_installer.chmod(0o555)
            installers_root = root / "installers"
            installers_root.mkdir()
            stored_installer = installers_root / authorization["installer_sha256"]
            stored_installer.write_bytes(authorized_raw)
            stored_installer.chmod(0o555)
            pending_root = root / "pending"
            pending_root.mkdir()
            recovered = SimpleNamespace(install=Mock(return_value={"result": "INSTALLED"}))
            arguments = [str(current_installer), "--repository-root", "/ignored", "--authorization-file", "/ignored/install.json", "--confirm", installer.INSTALL_CONFIRMATION]
            output = StringIO()
            with patch.object(installer, "INSTALLERS_ROOT", installers_root), patch.object(installer, "INSTALL_PENDING_ROOT", pending_root), patch.object(installer, "unresolved_prepared_install", return_value=(root / "prepared.json", {}, authorization, authorization_digest)), patch.object(installer, "acquire_install_lock", return_value=19), patch.object(installer.os, "close"), patch.object(installer.os, "getuid", return_value=0), patch.object(installer, "load_installer_module", return_value=recovered), patch.object(sys, "argv", arguments), redirect_stdout(output):
                installer.main()
            recovered.install.assert_called_once_with(Path(authorization["repository_root"]), authorization, None, authorization_digest, stored_installer)
            self.assertEqual(json.loads(output.getvalue()), {"result": "INSTALLED"})

    def test_install_resumes_exact_prepared_transaction_after_authorization_is_consumed_and_expired(self):
        with tempfile.TemporaryDirectory(prefix="cyd-supervisor-transaction-") as directory:
            root = Path(directory)
            repository = root / "repository"
            repository.mkdir()
            launcher_source = Path(__file__).resolve().parents[1] / "scripts" / "release-supervisor-launcher.py"
            launcher_raw = launcher_source.read_bytes()
            bundle_files = generator.parse_bundle_files(launcher_raw)
            for relative in bundle_files:
                source = bundled_source(relative)
                target = repository / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read_bytes())
            subprocess.run(["git", "init", "-q", str(repository)], check=True)
            subprocess.run(["git", "-C", str(repository), "config", "user.name", "Task 42 Test"], check=True)
            subprocess.run(["git", "-C", str(repository), "config", "user.email", "task42@example.invalid"], check=True)
            subprocess.run(["git", "-C", str(repository), "add", "chenyida_erp_site"], check=True)
            subprocess.run(["git", "-C", str(repository), "commit", "-qm", "source"], check=True)
            source_commit = subprocess.check_output(["git", "-C", str(repository), "rev-parse", "HEAD"], text=True).strip()
            source_tree = subprocess.check_output(["git", "-C", str(repository), "rev-parse", "HEAD^{tree}"], text=True).strip()
            manifest_raw = generator.render(repository, source_commit)
            manifest_path = repository / installer.BUNDLE_MANIFEST_REPOSITORY_PATH
            manifest_path.parent.mkdir(parents=True, exist_ok=True)
            manifest_path.write_bytes(manifest_raw)
            subprocess.run(["git", "-C", str(repository), "add", installer.BUNDLE_MANIFEST_REPOSITORY_PATH], check=True)
            subprocess.run(["git", "-C", str(repository), "commit", "-qm", "manifest"], check=True)
            manifest_commit = subprocess.check_output(["git", "-C", str(repository), "rev-parse", "HEAD"], text=True).strip()
            manifest_tree = subprocess.check_output(["git", "-C", str(repository), "rev-parse", "HEAD^{tree}"], text=True).strip()

            state = root / "state"; libexec = root / "usr" / "local" / "libexec"; sbin = root / "usr" / "local" / "sbin"
            libexec.mkdir(parents=True, mode=0o755); sbin.mkdir(parents=True, mode=0o755)
            install_authorizations = state / "install-authorizations"
            pending = install_authorizations / "pending"; pending.mkdir(parents=True, mode=0o700)
            release_authorizations = state / "release-authorizations"
            authorization = self.authorization(datetime.now(timezone.utc))
            authorization.update({
                "repository_root": str(repository), "source_commit": source_commit, "source_tree": source_tree,
                "manifest_commit": manifest_commit, "manifest_tree": manifest_tree,
                "bundle_manifest_sha256": installer.sha256(manifest_raw), "launcher_sha256": installer.sha256(launcher_raw),
                "installer_sha256": installer.sha256(MODULE_PATH.read_bytes()),
            })
            authorization_raw = installer.canonical_json(authorization)
            authorization_file = pending / f"{authorization['authorization_id']}.json"
            authorization_file.write_bytes(authorization_raw); authorization_file.chmod(0o400)
            authorization_digest = installer.sha256(authorization_raw)
            launcher_path = sbin / "chenyida-erp-release-supervisor-v1"
            previous_raw = b"#!/bin/sh\nexit 1\n"; launcher_path.write_bytes(previous_raw); launcher_path.chmod(0o555)

            patches = {
                "INSTALL_AUTHORIZATION_ROOT": install_authorizations,
                "INSTALL_PENDING_ROOT": pending,
                "INSTALL_CONSUMED_ROOT": install_authorizations / "consumed",
                "INSTALL_RECEIPT_ROOT": state / "receipts",
                "INSTALL_JOURNAL_ROOT": state / "journal",
                "RELEASE_AUTHORIZATION_ROOT": release_authorizations,
                "RELEASE_AUTHORIZATION_PENDING_ROOT": release_authorizations / "pending",
                "RELEASE_AUTHORIZATION_CONSUMED_ROOT": release_authorizations / "consumed",
                "SUPERVISOR_BASE": libexec / "supervisor",
                "BUNDLES_ROOT": libexec / "supervisor" / "bundles",
                "LAUNCHERS_ROOT": libexec / "supervisor" / "launchers",
                "INSTALLERS_ROOT": libexec / "supervisor" / "installers",
                "LAUNCHER_PATH": launcher_path,
            }
            patchers = [patch.object(installer, key, value) for key, value in patches.items()]
            for active in patchers: active.start()
            try:
                real_rename = os.rename

                def capability_safe_rename(source, destination):
                    source_path = Path(source)
                    destination_path = Path(destination)
                    if source_path.is_dir() and (source_path.stat().st_mode & 0o200) == 0 and source_path.parent != destination_path.parent:
                        raise PermissionError("immutable directory move requires DAC override")
                    return real_rename(source, destination)

                with patch.object(installer.os, "chown"), patch.object(installer.os, "fchown"), patch.object(installer.os, "rename", side_effect=capability_safe_rename):
                    with patch.object(installer.os, "replace", side_effect=OSError("injected launcher switch failure")):
                        with self.assertRaisesRegex(OSError, "injected launcher switch failure"):
                            installer.install(repository, authorization, authorization_file, authorization_digest, MODULE_PATH)
                    self.assertFalse(authorization_file.exists())
                    self.assertEqual(launcher_path.read_bytes(), previous_raw)
                    with self.assertRaisesRegex(installer.InstallError, "SUPERVISOR_INSTALL_AUTHORIZATION_TIME_INVALID"):
                        installer.validate_authorization(authorization, datetime.now(timezone.utc) + timedelta(days=2))
                    receipt = installer.install(repository, authorization, None, authorization_digest, MODULE_PATH)
                self.assertEqual(receipt["result"], "INSTALLED")
                self.assertEqual(receipt["previous_launcher_sha256"], installer.sha256(previous_raw))
                self.assertFalse(authorization_file.exists())
                prepared, committed, receipt_file, consumed = installer.install_record_paths(authorization, authorization_digest)
                self.assertTrue(prepared.is_file() and committed.is_file() and receipt_file.is_file() and consumed.is_file())
                stored_previous = patches["LAUNCHERS_ROOT"] / installer.sha256(previous_raw)
                self.assertTrue(stored_previous.is_file())
                self.assertEqual(stored_previous.stat().st_nlink, 1)
                stored_installer = patches["INSTALLERS_ROOT"] / installer.sha256(MODULE_PATH.read_bytes())
                self.assertTrue(stored_installer.is_file())
                self.assertEqual(stored_installer.stat().st_mode & 0o777, 0o555)
                committed.chmod(0o600); committed.write_bytes(b'{"truncated":'); committed.chmod(0o400)
                with self.assertRaisesRegex(installer.InstallError, "SUPERVISOR_INSTALL_JOURNAL_INVALID"):
                    installer.unresolved_prepared_install()
            finally:
                for active in reversed(patchers): active.stop()


if __name__ == "__main__":
    unittest.main()
