import hashlib
import importlib.util
import json
import multiprocessing
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "release-candidate-snapshot.py"
SPEC = importlib.util.spec_from_file_location("release_candidate_snapshot", MODULE_PATH)
snapshot = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = snapshot
SPEC.loader.exec_module(snapshot)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def concurrent_prepare(arguments, start, output):
    start.wait(10)
    try:
        receipt, receipt_digest, _ = snapshot.prepare_snapshot(*arguments)
        output.put(("ok", str(receipt), receipt_digest))
    except snapshot.SnapshotError as error:
        output.put(("error", error.code))
    except Exception as error:  # pragma: no cover - diagnostic path
        output.put(("unexpected", type(error).__name__, str(error)))


class InjectedInterruption(Exception):
    pass


class ReleaseCandidateSnapshotTest(unittest.TestCase):
    def setUp(self):
        self.temporary = Path(tempfile.mkdtemp(prefix="cyd-release-candidate-snapshot-"))
        self.temporary.chmod(0o700)
        self.source = self.temporary / "source"
        self.runtime = self.temporary / "runtime"
        self.bundle_parent = self.temporary / "bundles"
        self.source.mkdir(mode=0o700)
        self.runtime.mkdir(mode=0o700)
        self.bundle_parent.mkdir(mode=0o700)
        self.paths = snapshot.SnapshotPaths(
            base=self.temporary / "snapshot-state",
            global_lock=self.temporary / "release-gate.lock",
            uid=os.getuid(),
            trust_root=self.temporary,
        )
        self._build_fixture()

    def tearDown(self):
        if not self.temporary.exists():
            return
        for directory, names, files in os.walk(self.temporary, topdown=False):
            for name in files:
                try:
                    (Path(directory) / name).chmod(0o600)
                except FileNotFoundError:
                    pass
            for name in names:
                try:
                    (Path(directory) / name).chmod(0o700)
                except FileNotFoundError:
                    pass
            try:
                Path(directory).chmod(0o700)
            except FileNotFoundError:
                pass
        shutil.rmtree(self.temporary)

    def git(self, *arguments, repository=None, check=True):
        root = repository or self.source
        result = subprocess.run(
            ["/usr/bin/git", "-c", "core.hooksPath=/dev/null", "-c", "core.useReplaceRefs=false", "-C", str(root), *arguments],
            env={"PATH": snapshot.SAFE_PATH, "LC_ALL": "C", "LANG": "C", "HOME": "/nonexistent", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null"},
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=check,
        )
        return result.stdout.decode("utf-8").strip()

    def write(self, relative, raw, root=None, mode=0o644):
        target = (root or self.source) / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        target.chmod(mode)
        return target

    def _build_fixture(self):
        node_file = self.write("chenyida_erp_site/node_modules/pkg/index.js", b"export default 1;\n", self.runtime)
        venv_file = self.write(".venv/lib/site.py", b"synthetic-package\n", self.runtime)
        interpreter = self.write("runtime-python", b"synthetic-python\n", self.runtime, 0o555)
        venv_bin = self.runtime / ".venv/bin"
        venv_bin.mkdir(parents=True, exist_ok=True)
        (venv_bin / "python3").symlink_to(interpreter)
        (venv_bin / "python").symlink_to("python3")
        (venv_bin / "python3.11").symlink_to("python3")
        node_root = self.runtime / "chenyida_erp_site/node_modules"
        venv_root = self.runtime / ".venv"
        node_digest = snapshot.runtime_tree_digest(node_root)
        venv_digest = snapshot.runtime_tree_digest(venv_root)
        package_lock = b'{"lockfileVersion":3,"name":"fixture"}\n'
        requirements = b"fixture==1.0\n"
        requirements_dev = b"fixture-test==1.0\n"
        policy = {
            "schema_version": 1,
            "contract": "chenyida-erp-release-test-runtime-policy/v1",
            "node_dependencies": {
                "path": "chenyida_erp_site/node_modules",
                "tree_sha256": node_digest,
                "package_lock_sha256": digest(package_lock),
            },
            "python_runtime": {
                "venv_path": ".venv",
                "venv_tree_sha256": venv_digest,
                "interpreter_path": str(interpreter),
                "interpreter_sha256": digest(interpreter.read_bytes()),
                "requirements_sha256": digest(requirements),
                "requirements_dev_sha256": digest(requirements_dev),
            },
        }
        policy_raw = json.dumps(policy, indent=2, sort_keys=True).encode("utf-8") + b"\n"
        self.policy_raw = policy_raw
        self.interpreter = interpreter
        self.runtime_files = {
            node_file: node_file.read_bytes(),
            venv_file: venv_file.read_bytes(),
            interpreter: interpreter.read_bytes(),
        }

        self.git("init", "-q")
        self.write(".gitignore", b"*.ignored\n")
        self.write("chenyida_erp_site/package-lock.json", package_lock)
        self.write("chenyida_erp_site/release/test-runtime-policy-v1.json", policy_raw)
        self.write("chenyida_erp_app/requirements.txt", requirements)
        self.write("chenyida_erp_app/requirements-dev.txt", requirements_dev)
        self.write("chenyida_erp_site/app.txt", b"candidate\n")
        self.git("add", ".")
        self.git("-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "source")
        self.source_commit = self.git("rev-parse", "HEAD^{commit}")
        self.source_tree = self.git("rev-parse", "HEAD^{tree}")

        manifest = {
            "schema_version": 1,
            "contract": snapshot.BUNDLE_CONTRACT,
            "bundle_version": 1,
            "source_commit": self.source_commit,
            "source_tree": self.source_tree,
            "launcher_sha256": "a" * 64,
            "files": [{
                "path": snapshot.TEST_RUNTIME_POLICY_PATH,
                "sha256": digest(policy_raw),
                "bytes": len(policy_raw),
                "mode": "0444",
            }],
        }
        manifest_raw = snapshot.canonical_json(manifest)
        self.write(snapshot.BUNDLE_MANIFEST_PATH, manifest_raw)
        self.git("add", snapshot.BUNDLE_MANIFEST_PATH)
        self.git("-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "manifest")
        self.candidate_commit = self.git("rev-parse", "HEAD^{commit}")
        self.candidate_tree = self.git("rev-parse", "HEAD^{tree}")

        bundle_digest = digest(manifest_raw)
        self.bundle = self.bundle_parent / bundle_digest
        self.bundle.mkdir(mode=0o755)
        self.write("bundle-manifest.json", manifest_raw, self.bundle, 0o444)
        self.write(snapshot.TEST_RUNTIME_POLICY_PATH, policy_raw, self.bundle, 0o444)
        for directory, names, _ in os.walk(self.bundle, topdown=False):
            for name in names:
                (Path(directory) / name).chmod(0o555)
            Path(directory).chmod(0o555)
        self.user_file = self.write("existing-user-file.txt", b"keep-user-bytes\n")

    def arguments(self, snapshot_id="fixture"):
        return (
            self.source,
            self.candidate_commit,
            self.candidate_tree,
            self.runtime,
            self.bundle,
            snapshot_id,
            self.paths,
        )

    def prepare(self, snapshot_id="fixture", **kwargs):
        return snapshot.prepare_snapshot(*self.arguments(snapshot_id), **kwargs)

    def verify(self, receipt, receipt_digest):
        return snapshot.verify_snapshot(
            receipt,
            receipt_digest,
            self.paths.worktrees / "fixture",
            self.candidate_commit,
            self.candidate_tree,
            self.runtime,
            self.bundle,
            self.paths,
        )

    def remove(self, receipt, receipt_digest, **kwargs):
        return snapshot.remove_snapshot(receipt, receipt_digest, "fixture", self.paths, **kwargs)

    def test_normal_lifecycle_preserves_main_worktree_and_borrowed_runtime(self):
        before_head = self.git("rev-parse", "HEAD")
        before_branch = self.git("symbolic-ref", "HEAD")
        before_status = self.git("status", "--porcelain=v2", "--untracked-files=all")
        runtime_before = {path: path.read_bytes() for path in self.runtime_files}
        receipt, receipt_digest, value = self.prepare()
        self.assertEqual(value["state"], "PREPARED")
        self.assertEqual(value["test_runtime"]["mode"], "BORROWED_NEVER_REMOVE")
        self.assertEqual(self.verify(receipt, receipt_digest)["snapshot_id"], "fixture")
        self.assertEqual(self.git("rev-parse", "HEAD", repository=self.paths.worktrees / "fixture"), self.candidate_commit)
        self.assertNotEqual(self.git("symbolic-ref", "-q", "HEAD", repository=self.paths.worktrees / "fixture", check=False), "refs/heads/main")
        removal, removal_digest, removed = self.remove(receipt, receipt_digest)
        self.assertEqual(removed["state"], "REMOVED")
        self.assertTrue(removal.exists())
        self.assertEqual(digest(removal.read_bytes()), removal_digest)
        self.assertFalse((self.paths.worktrees / "fixture").exists())
        rebuilt = self.paths.worktrees / "fixture"
        rebuilt.mkdir(mode=0o700)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_REMOVAL_STATE_CHANGED"):
            self.remove(receipt, receipt_digest)
        rebuilt.rmdir()
        repeated_removal, repeated_digest, repeated_value = self.remove(receipt, receipt_digest)
        self.assertEqual(repeated_removal, removal)
        self.assertEqual(repeated_digest, removal_digest)
        self.assertEqual(repeated_value, removed)
        self.assertEqual(self.git("rev-parse", "HEAD"), before_head)
        self.assertEqual(self.git("symbolic-ref", "HEAD"), before_branch)
        self.assertEqual(self.git("status", "--porcelain=v2", "--untracked-files=all"), before_status)
        self.assertEqual(self.user_file.read_bytes(), b"keep-user-bytes\n")
        self.assertEqual({path: path.read_bytes() for path in self.runtime_files}, runtime_before)

    def test_wrong_identity_and_non_manifest_child_fail_before_worktree_creation(self):
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_CANDIDATE_IDENTITY_INVALID"):
            snapshot.prepare_snapshot(self.source, self.candidate_commit, "0" * 40, self.runtime, self.bundle, "wrong-tree", self.paths)
        self.assertFalse((self.paths.worktrees / "wrong-tree").exists())
        self.git("-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "governance")
        later = self.git("rev-parse", "HEAD")
        later_tree = self.git("rev-parse", "HEAD^{tree}")
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_CANDIDATE_RELATIONSHIP_INVALID"):
            snapshot.prepare_snapshot(self.source, later, later_tree, self.runtime, self.bundle, "wrong-parent", self.paths)

    def test_duplicate_id_and_lock_contention_are_no_clobber(self):
        receipt, receipt_digest, _ = self.prepare()
        publishing = receipt.parent / f".{receipt.name}.publishing"
        os.link(receipt, publishing)
        self.assertEqual(receipt.stat().st_nlink, 2)
        repeated, repeated_digest, _ = self.prepare()
        self.assertEqual(repeated, receipt)
        self.assertEqual(repeated_digest, receipt_digest)
        self.assertEqual(receipt.stat().st_nlink, 1)
        self.assertFalse(publishing.exists())
        self.remove(receipt, receipt_digest)

        ctx = multiprocessing.get_context("fork")
        start = ctx.Event()
        output = ctx.Queue()
        arguments = self.arguments("concurrent")
        processes = [ctx.Process(target=concurrent_prepare, args=(arguments, start, output)) for _ in range(2)]
        for process in processes:
            process.start()
        start.set()
        for process in processes:
            process.join(30)
            self.assertEqual(process.exitcode, 0)
        outcomes = [output.get(timeout=5), output.get(timeout=5)]
        self.assertGreaterEqual(sum(item[0] == "ok" for item in outcomes), 1)
        self.assertTrue(all(item[0] == "ok" or (item[0] == "error" and item[1] == "SNAPSHOT_LOCK_BUSY") for item in outcomes))
        successful_digests = {item[2] for item in outcomes if item[0] == "ok"}
        self.assertLessEqual(len(successful_digests), 1)
        prepared = self.paths.receipts / "concurrent.prepared.json"
        prepared_digest = digest(prepared.read_bytes())
        snapshot.remove_snapshot(prepared, prepared_digest, "concurrent", self.paths)

    def test_dirty_branch_and_ignored_paths_fail_closed(self):
        receipt, receipt_digest, _ = self.prepare()
        target = self.paths.worktrees / "fixture"
        tracked = target / "chenyida_erp_site/app.txt"
        tracked.write_text("dirty\n", encoding="utf-8")
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_WORKTREE_DIRTY"):
            self.verify(receipt, receipt_digest)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_WORKTREE_DIRTY"):
            self.remove(receipt, receipt_digest)
        self.git("checkout", "--", "chenyida_erp_site/app.txt", repository=target)
        ignored = target / "cache.ignored"
        ignored.write_text("ignored\n", encoding="utf-8")
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_WORKTREE_DIRTY"):
            self.verify(receipt, receipt_digest)
        ignored.unlink()
        self.git("switch", "-c", "bad-branch", repository=target)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_WORKTREE_NOT_DETACHED"):
            self.verify(receipt, receipt_digest)
        self.git("switch", "--detach", self.candidate_commit, repository=target)

    def test_receipt_path_runtime_and_mount_tampering_are_rejected(self):
        receipt, receipt_digest, _ = self.prepare()
        original = receipt.read_bytes()
        receipt.chmod(0o600)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_RECEIPT_INVALID"):
            self.verify(receipt, receipt_digest)
        receipt.chmod(0o400)
        receipt_link = self.paths.receipts / "fixture.hardlink.json"
        os.link(receipt, receipt_link)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_RECEIPT_INVALID"):
            self.verify(receipt, receipt_digest)
        receipt_link.unlink()

        receipt.chmod(0o600)
        receipt.write_bytes(original + b" ")
        receipt.chmod(0o400)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_RECEIPT_DIGEST_MISMATCH"):
            self.verify(receipt, receipt_digest)
        receipt.chmod(0o600)
        receipt.write_bytes(original)
        receipt.chmod(0o400)

        target = self.paths.worktrees / "fixture"
        mountinfo = f"1 0 0:1 / {target} rw - ext4 /dev/test rw\n"
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_NESTED_MOUNT"):
            snapshot.verify_snapshot(receipt, receipt_digest, target, self.candidate_commit, self.candidate_tree, self.runtime, self.bundle, self.paths, mountinfo=mountinfo)
        runtime_mountinfo = f"1 0 0:1 / {self.runtime / 'chenyida_erp_site/node_modules'} rw - ext4 /dev/test rw\n"
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_NESTED_MOUNT"):
            snapshot.verify_snapshot(receipt, receipt_digest, target, self.candidate_commit, self.candidate_tree, self.runtime, self.bundle, self.paths, mountinfo=runtime_mountinfo)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_RECEIPT_BINDING_MISMATCH"):
            snapshot.verify_snapshot(receipt, receipt_digest, self.source, self.candidate_commit, self.candidate_tree, self.runtime, self.bundle, self.paths)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_RECEIPT_BINDING_MISMATCH"):
            snapshot.remove_snapshot(
                receipt,
                receipt_digest,
                "fixture",
                self.paths,
                expected_bundle_root=self.bundle_parent / ("0" * 64),
            )

        interpreter_mode = self.interpreter.stat().st_mode & 0o7777
        self.interpreter.chmod(interpreter_mode | 0o200)
        self.interpreter.write_bytes(b"different-interpreter\n")
        self.interpreter.chmod(interpreter_mode)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_TEST_RUNTIME_INTERPRETER_DIGEST_MISMATCH"):
            self.verify(receipt, receipt_digest)
        self.interpreter.chmod(interpreter_mode | 0o200)
        self.interpreter.write_bytes(self.runtime_files[self.interpreter])
        self.interpreter.chmod(interpreter_mode)

        runtime_intermediate = self.runtime / "chenyida_erp_site"
        runtime_intermediate_mode = runtime_intermediate.stat().st_mode & 0o7777
        runtime_intermediate.chmod(runtime_intermediate_mode | 0o020)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_TEST_RUNTIME_PATH_UNTRUSTED"):
            self.verify(receipt, receipt_digest)
        runtime_intermediate.chmod(runtime_intermediate_mode)

        moved_runtime = self.temporary / "runtime-moved"
        self.runtime.rename(moved_runtime)
        self.runtime.symlink_to(moved_runtime, target_is_directory=True)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_TEST_RUNTIME_ROOT_INVALID"):
            self.verify(receipt, receipt_digest)
        self.runtime.unlink()
        moved_runtime.rename(self.runtime)

        runtime_fifo = self.runtime / "chenyida_erp_site/node_modules/unsafe-fifo"
        os.mkfifo(runtime_fifo, 0o600)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_TEST_RUNTIME_INVALID"):
            self.verify(receipt, receipt_digest)
        runtime_fifo.unlink()

        runtime_file = next(iter(self.runtime_files))
        runtime_file.write_bytes(b"changed\n")
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_TEST_RUNTIME_DIGEST_MISMATCH"):
            self.verify(receipt, receipt_digest)
        runtime_file.write_bytes(self.runtime_files[runtime_file])

        bundle_policy = self.bundle / snapshot.TEST_RUNTIME_POLICY_PATH
        bundle_policy.chmod(0o644)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_BUNDLE_PAYLOAD_INVALID"):
            self.verify(receipt, receipt_digest)
        bundle_policy.chmod(0o444)


    def test_snapshot_path_and_gitfile_replacement_are_rejected(self):
        receipt, receipt_digest, _ = self.prepare()
        target = self.paths.worktrees / "fixture"
        moved = self.paths.worktrees / "fixture-moved"
        target.rename(moved)
        target.symlink_to(moved, target_is_directory=True)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_WORKTREE_ROOT_INVALID"):
            self.verify(receipt, receipt_digest)
        target.unlink()
        moved.rename(target)
        git_file = target / ".git"
        original = git_file.read_bytes()
        git_file.unlink()
        git_file.write_bytes(original)
        git_file.chmod(0o644)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_WORKTREE_IDENTITY_CHANGED"):
            self.verify(receipt, receipt_digest)

    def test_worktree_filesystem_admin_and_index_metadata_drift_are_rejected(self):
        receipt, receipt_digest, value = self.prepare()
        target = self.paths.worktrees / "fixture"
        tracked = target / "chenyida_erp_site/app.txt"
        tracked_mode = tracked.stat().st_mode & 0o7777
        tracked.chmod(tracked_mode | 0o020)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_WORKTREE_FILESYSTEM_INVALID"):
            self.verify(receipt, receipt_digest)
        tracked.chmod(tracked_mode)

        admin = Path(value["snapshot"]["admin_dir"])
        merge_head = admin / "MERGE_HEAD"
        merge_head.write_text(f"{self.candidate_commit}\n", encoding="utf-8")
        merge_head.chmod(0o600)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_WORKTREE_ADMIN_STATE_INVALID"):
            self.verify(receipt, receipt_digest)
        merge_head.unlink()

        self.git("update-index", "--assume-unchanged", "chenyida_erp_site/app.txt", repository=target)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_WORKTREE_INDEX_STATE_INVALID"):
            self.verify(receipt, receipt_digest)

    def test_prepare_and_remove_interruption_resume_exact_state(self):
        def interrupt_prepare(phase):
            if phase == "BEFORE_RECEIPT":
                raise InjectedInterruption()

        with self.assertRaises(InjectedInterruption):
            self.prepare(failpoint=interrupt_prepare)
        self.assertTrue((self.paths.worktrees / "fixture").exists())
        intent_path = self.paths.state / "fixture.prepare-intent.json"
        intent_raw = intent_path.read_bytes()
        intent_value = json.loads(intent_raw)
        intent_value["unexpected"] = True
        intent_path.chmod(0o600)
        intent_path.write_bytes(snapshot.canonical_json(intent_value))
        intent_path.chmod(0o400)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_PREPARE_INTENT_INVALID"):
            self.prepare()
        intent_path.chmod(0o600)
        intent_path.write_bytes(intent_raw)
        intent_path.chmod(0o400)
        self.git("-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "governance-before-resume")
        receipt, receipt_digest, prepared = self.prepare()
        self.assertTrue(prepared["source_repository"]["resumed"])
        repeated, repeated_digest, repeated_value = self.prepare()
        self.assertEqual((repeated, repeated_digest, repeated_value), (receipt, receipt_digest, prepared))

        def interrupt_remove(phase):
            if phase == "WORKTREE_UNLOCKED":
                raise InjectedInterruption()

        with self.assertRaises(InjectedInterruption):
            self.remove(receipt, receipt_digest, failpoint=interrupt_remove)
        removal, _, value = self.remove(receipt, receipt_digest)
        self.assertEqual(value["state"], "REMOVED")
        self.assertTrue(removal.exists())

        receipt, receipt_digest, _ = self.prepare("after-worktree-remove")

        def interrupt_after_worktree_remove(phase):
            if phase == "WORKTREE_REMOVED":
                raise InjectedInterruption()

        with self.assertRaises(InjectedInterruption):
            snapshot.remove_snapshot(
                receipt,
                receipt_digest,
                "after-worktree-remove",
                self.paths,
                failpoint=interrupt_after_worktree_remove,
            )
        self.assertFalse((self.paths.worktrees / "after-worktree-remove").exists())
        moved_source = self.temporary / "source-original"
        self.source.rename(moved_source)
        self.git("clone", "-q", "--no-local", str(moved_source), str(self.source), repository=self.temporary)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_SOURCE_IDENTITY_CHANGED"):
            snapshot.remove_snapshot(receipt, receipt_digest, "after-worktree-remove", self.paths)
        shutil.rmtree(self.source)
        moved_source.rename(self.source)
        removal, _, value = snapshot.remove_snapshot(receipt, receipt_digest, "after-worktree-remove", self.paths)
        self.assertEqual(value["state"], "REMOVED")
        self.assertTrue(removal.exists())

    def test_state_publication_recovers_partial_and_linked_temporary_files(self):
        snapshot.ensure_storage(self.paths, True)
        first = self.paths.state / "atomic-one.json"
        first_raw = b'{"state":"complete"}\n'
        first_temp = first.parent / f".{first.name}.publishing"
        first_temp.write_bytes(first_raw)
        first_temp.chmod(0o400)
        os.link(first_temp, first)
        snapshot.write_no_clobber(first, first_raw, uid=self.paths.uid)
        self.assertEqual(first.read_bytes(), first_raw)
        self.assertEqual(first.stat().st_nlink, 1)
        self.assertFalse(first_temp.exists())

        second = self.paths.state / "atomic-two.json"
        second_raw = b'{"state":"recovered"}\n'
        second_temp = second.parent / f".{second.name}.publishing"
        second_temp.write_bytes(b"partial")
        second_temp.chmod(0o400)
        snapshot.write_no_clobber(second, second_raw, uid=self.paths.uid)
        self.assertEqual(second.read_bytes(), second_raw)
        self.assertEqual(second.stat().st_nlink, 1)

    def test_prepare_admin_only_recovery_quarantines_and_retries(self):
        def interrupt_after_add(phase):
            if phase == "WORKTREE_ADDED":
                raise InjectedInterruption()

        with self.assertRaises(InjectedInterruption):
            snapshot.prepare_snapshot(*self.arguments("prepare-admin-only"), failpoint=interrupt_after_add)
        target = self.paths.worktrees / "prepare-admin-only"
        admin = Path((target / ".git").read_text(encoding="utf-8").removeprefix("gitdir: ").strip())
        lock_path = admin / "locked"
        lock_raw = lock_path.read_bytes()
        lock_mode = lock_path.stat().st_mode & 0o777
        moved_target = self.paths.worktrees / "prepare-admin-only-moved"
        target.rename(moved_target)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_PREPARE_RECOVERY_REQUIRED"):
            snapshot.prepare_snapshot(*self.arguments("prepare-admin-only"))
        lock_path.unlink()
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_PREPARE_ADMIN_PROVENANCE_UNPROVEN"):
            snapshot.recover_prepare_snapshot(*self.arguments("prepare-admin-only"))
        lock_path.write_bytes(lock_raw)
        lock_path.chmod(lock_mode)
        recovery = snapshot.recover_prepare_snapshot(*self.arguments("prepare-admin-only"))
        self.assertEqual(recovery[2]["outcome"], "PREPARE_ROLLED_BACK_TO_ABSENT")
        self.assertEqual(recovery[2]["action"], "QUARANTINE_ADMIN")
        self.assertEqual(snapshot.recover_prepare_snapshot(*self.arguments("prepare-admin-only")), recovery)
        receipt, receipt_digest, _ = snapshot.prepare_snapshot(*self.arguments("prepare-admin-only"))
        snapshot.remove_snapshot(receipt, receipt_digest, "prepare-admin-only", self.paths)

    def test_prepare_target_only_recovery_requires_separate_provenance(self):
        def interrupt_after_add(phase):
            if phase == "WORKTREE_ADDED":
                raise InjectedInterruption()

        with self.assertRaises(InjectedInterruption):
            snapshot.prepare_snapshot(*self.arguments("prepare-target-only"), failpoint=interrupt_after_add)
        target = self.paths.worktrees / "prepare-target-only"
        git_text = (target / ".git").read_text(encoding="utf-8")
        admin = Path(git_text.removeprefix("gitdir: ").strip())
        moved_admin = self.temporary / "prepare-target-only-admin-moved"
        admin.rename(moved_admin)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_PREPARE_RECOVERY_REQUIRED"):
            snapshot.prepare_snapshot(*self.arguments("prepare-target-only"))
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_PREPARE_TARGET_PROVENANCE_UNPROVEN"):
            snapshot.recover_prepare_snapshot(*self.arguments("prepare-target-only"))
        self.assertTrue(target.is_dir())
        self.assertFalse(any(self.paths.quarantine.iterdir()))
        moved_admin.rename(admin)
        receipt, receipt_digest, _ = snapshot.prepare_snapshot(*self.arguments("prepare-target-only"))
        snapshot.remove_snapshot(receipt, receipt_digest, "prepare-target-only", self.paths)

    def test_prepare_recovery_generation_does_not_reuse_stale_audit(self):
        snapshot_id = "prepare-generation"

        def interrupt_after_add(phase):
            if phase == "WORKTREE_ADDED":
                raise InjectedInterruption()

        recoveries = []
        for generation in (1, 2):
            with self.assertRaises(InjectedInterruption):
                snapshot.prepare_snapshot(*self.arguments(snapshot_id), failpoint=interrupt_after_add)
            target = self.paths.worktrees / snapshot_id
            target.rename(self.paths.worktrees / f"{snapshot_id}-moved-{generation}")
            recovery = snapshot.recover_prepare_snapshot(*self.arguments(snapshot_id))
            self.assertEqual(recovery[2]["generation"], generation)
            self.assertFalse(target.exists())
            recoveries.append(recovery)
        self.assertNotEqual(recoveries[0][0], recoveries[1][0])
        self.assertNotEqual(recoveries[0][2]["recovery_id"], recoveries[1][2]["recovery_id"])
        self.assertNotEqual(recoveries[0][2]["quarantine"]["path"], recoveries[1][2]["quarantine"]["path"])
        receipt, receipt_digest, _ = snapshot.prepare_snapshot(*self.arguments(snapshot_id))
        snapshot.remove_snapshot(receipt, receipt_digest, snapshot_id, self.paths)

    def test_recovery_rejects_missing_newest_retained_evidence_without_fallback(self):
        snapshot_id = "prepare-quarantine-loss"

        def interrupt_after_add(phase):
            if phase == "WORKTREE_ADDED":
                raise InjectedInterruption()

        recoveries = []
        for generation in (1, 2):
            with self.assertRaises(InjectedInterruption):
                snapshot.prepare_snapshot(*self.arguments(snapshot_id), failpoint=interrupt_after_add)
            target = self.paths.worktrees / snapshot_id
            target.rename(self.paths.worktrees / f"{snapshot_id}-moved-{generation}")
            recovery = snapshot.recover_prepare_snapshot(*self.arguments(snapshot_id))
            self.assertEqual(recovery[2]["generation"], generation)
            recoveries.append(recovery)
        newest_quarantine = Path(recoveries[-1][2]["quarantine"]["path"])
        displaced_quarantine = self.temporary / "displaced-newest-quarantine"
        newest_quarantine.rename(displaced_quarantine)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_RECOVERY_RETAINED_EVIDENCE_MISSING"):
            snapshot.recover_prepare_snapshot(*self.arguments(snapshot_id))
        self.assertTrue(displaced_quarantine.is_dir())
        self.assertEqual(recoveries[0][2]["generation"], 1)

    def test_remove_admin_only_recovery_quarantines_and_publishes_tombstone(self):
        receipt, receipt_digest, _ = snapshot.prepare_snapshot(*self.arguments("remove-admin-only"))

        def interrupt_after_remove_intent(phase):
            if phase == "REMOVE_INTENT_WRITTEN":
                raise InjectedInterruption()

        with self.assertRaises(InjectedInterruption):
            snapshot.remove_snapshot(receipt, receipt_digest, "remove-admin-only", self.paths, failpoint=interrupt_after_remove_intent)
        target = self.paths.worktrees / "remove-admin-only"
        moved_target = self.paths.worktrees / "remove-admin-only-moved"
        target.rename(moved_target)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_REMOVE_RECOVERY_REQUIRED"):
            snapshot.remove_snapshot(receipt, receipt_digest, "remove-admin-only", self.paths)
        def interrupt_after_recovery_receipt(phase):
            if phase == "RECOVERY_RECEIPT_WRITTEN":
                raise InjectedInterruption()

        with self.assertRaises(InjectedInterruption):
            snapshot.recover_remove_snapshot(
                receipt,
                receipt_digest,
                "remove-admin-only",
                self.paths,
                failpoint=interrupt_after_recovery_receipt,
            )
        recovery, removal = snapshot.recover_remove_snapshot(receipt, receipt_digest, "remove-admin-only", self.paths)
        self.assertEqual(recovery[2]["action"], "QUARANTINE_ADMIN")
        self.assertEqual(recovery[2]["outcome"], "REMOVE_COMPLETED")
        self.assertEqual(removal[2]["state"], "REMOVED")
        self.assertEqual(snapshot.recover_remove_snapshot(receipt, receipt_digest, "remove-admin-only", self.paths), (recovery, removal))
        self.assertEqual(snapshot.remove_snapshot(receipt, receipt_digest, "remove-admin-only", self.paths), removal)

    def test_remove_target_only_recovery_quarantines_and_publishes_tombstone(self):
        receipt, receipt_digest, prepared = snapshot.prepare_snapshot(*self.arguments("remove-target-only"))

        def interrupt_after_remove_intent(phase):
            if phase == "REMOVE_INTENT_WRITTEN":
                raise InjectedInterruption()

        with self.assertRaises(InjectedInterruption):
            snapshot.remove_snapshot(receipt, receipt_digest, "remove-target-only", self.paths, failpoint=interrupt_after_remove_intent)
        target = self.paths.worktrees / "remove-target-only"
        admin = Path(prepared["snapshot"]["admin_dir"])
        moved_admin = self.temporary / "remove-target-only-admin-moved"
        admin.rename(moved_admin)
        with self.assertRaisesRegex(snapshot.SnapshotError, "SNAPSHOT_REMOVE_RECOVERY_REQUIRED"):
            snapshot.remove_snapshot(receipt, receipt_digest, "remove-target-only", self.paths)
        recovery, removal = snapshot.recover_remove_snapshot(receipt, receipt_digest, "remove-target-only", self.paths)
        self.assertEqual(recovery[2]["action"], "QUARANTINE_TARGET")
        self.assertEqual(recovery[2]["outcome"], "REMOVE_COMPLETED")
        self.assertTrue(Path(recovery[2]["quarantine"]["path"]).is_dir())
        self.assertFalse(target.exists())
        self.assertEqual(removal[2]["state"], "REMOVED")

    def test_main_head_may_advance_after_prepare_without_invalidating_snapshot(self):
        receipt, receipt_digest, _ = self.prepare()
        self.git("-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "governance")
        self.assertNotEqual(self.git("rev-parse", "HEAD"), self.candidate_commit)
        self.assertEqual(self.verify(receipt, receipt_digest)["candidate"]["commit"], self.candidate_commit)
        self.remove(receipt, receipt_digest)

    def test_static_supervisor_and_wrapper_contracts_close_execution_race(self):
        site = Path(__file__).resolve().parents[1]
        launcher = (site / "scripts/release-supervisor-launcher.py").read_text(encoding="utf-8")
        main = launcher[launcher.index("def main() -> None:"):]
        self.assertLess(main.index("lock_descriptor = acquire_global_release_lock()"), main.index("verify_candidate("))
        self.assertLess(main.index("verify_candidate("), main.index("consume_authorization("))
        self.assertIn('"candidate_snapshot_receipt", "candidate_snapshot_receipt_sha256", "test_runtime_root"', launcher)
        publish_markers = {
            "create-release-image-evidence.sh": 'release-image-evidence-producer.mjs" create',
            "run-release-gate.sh": 'release-gate-runner.mjs" commit',
            "create-release-manifest.sh": 'release-manifest-contract.mjs" publish-manifest',
        }
        for name, publish_marker in publish_markers.items():
            source = (site / "scripts" / name).read_text(encoding="utf-8")
            self.assertEqual(source.count("verify_candidate_snapshot ||"), 2, name)
            self.assertIn("--candidate-snapshot-receipt-sha256", source)
            self.assertLess(source.index("verify_candidate_snapshot ||"), source.index('if [ ! -e "$ARTIFACT_ROOT" ]'), name)
            self.assertLess(source.rindex("verify_candidate_snapshot ||"), source.index(publish_marker), name)
        implementation = MODULE_PATH.read_text(encoding="utf-8")
        removal = implementation[implementation.index("def remove_snapshot("):implementation.index("def cli_options(")]
        self.assertNotIn("--force", removal)
        self.assertNotIn("prune", removal)
        self.assertIn('"worktree", "remove", "--", str(target)', removal)
        for name in (
            "run-release-node-sandbox.sh", "run-release-browser-tests.sh", "run-release-postgres-regression-tests.sh",
            "run-release-migration-postgres-test.sh", "run-backup-recovery-postgres-test.sh", "run-python-baseline-test.sh",
        ):
            source = (site / "scripts" / name).read_text(encoding="utf-8")
            self.assertIn("ERP_RELEASE_TEST_RUNTIME_ROOT", source, name)
            self.assertIn('[ "$TEST_RUNTIME_ROOT" = "$AUTHORIZED_TEST_RUNTIME_ROOT" ]', source, name)
            if name == "run-python-baseline-test.sh":
                self.assertIn('--ro-bind "$TEST_RUNTIME_ROOT/.venv" /opt/venv', source, name)
            else:
                self.assertIn('NODE_MODULES="$TEST_RUNTIME_ROOT/chenyida_erp_site/node_modules"', source, name)
                self.assertIn('$NODE_MODULES:/workspace', source, name)
                self.assertIn(':ro"', source, name)


if __name__ == "__main__":
    unittest.main()
