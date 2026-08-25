#!/usr/bin/python3
"""Tests for the fail-closed isolated-UAT pre-import source bootstrap."""

from __future__ import annotations

import ast
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock


SITE_ROOT = Path(__file__).resolve().parent.parent
BOOTSTRAP_PATH = SITE_ROOT / "scripts/isolated-uat-pre-import-bootstrap.py"


def load_module(name: str, path: Path):
    specification = importlib.util.spec_from_file_location(name, path)
    if specification is None or specification.loader is None:
        raise RuntimeError(f"{name} cannot be loaded")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


BOOTSTRAP = load_module("isolated_uat_pre_import_bootstrap", BOOTSTRAP_PATH)


def canonical_sha256(value: object) -> str:
    raw = (json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ) + "\n").encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def member_paths() -> list[str]:
    policy = json.loads((SITE_ROOT / BOOTSTRAP.D183_POLICY_PATH).read_bytes())
    return [item["path"] for item in policy["source_closure"]["members"]]


@contextmanager
def isolated_fixture():
    with tempfile.TemporaryDirectory(
        dir=SITE_ROOT.parent, prefix=".d184-pre-import-",
    ) as temporary:
        root = Path(temporary) / "site"
        root.mkdir(mode=0o700)
        paths = [
            BOOTSTRAP.POLICY_PATH,
            BOOTSTRAP.D183_POLICY_PATH,
            BOOTSTRAP.D183_VALIDATOR_PATH,
            *member_paths(),
        ]
        for relative in dict.fromkeys(paths):
            source = SITE_ROOT / relative
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target, follow_symlinks=False)
        yield root


class IsolatedUatPreImportBootstrapTest(unittest.TestCase):
    def test_valid_snapshot_is_observed_before_any_payload_handoff(self) -> None:
        with isolated_fixture() as root:
            first = BOOTSTRAP.verify_site_root_for_tests(str(root))
            second = BOOTSTRAP.verify_site_root_for_tests(str(root))
        self.assertEqual(first, second)
        self.assertEqual(first["member_count"], 83)
        self.assertGreater(first["total_member_bytes"], 0)
        self.assertEqual(first["mode"], "VERIFY_ONLY")
        self.assertFalse(first["execution_authorized"])
        self.assertEqual(
            first["payload_execution_status"], "NOT_EXECUTED_BY_THIS_BOOTSTRAP",
        )
        self.assertEqual(first["prior_process_execution_status"], "NOT_ATTESTED")
        self.assertEqual(
            first["source_root_selection_status"],
            "TEST_ONLY_CALLER_SUPPLIED_SOURCE_ROOT_AND_RUNTIME_NOT_ATTESTED",
        )
        self.assertEqual(
            first["execution_handoff_status"], "NOT_IMPLEMENTED_FAIL_CLOSED",
        )
        self.assertEqual(
            first["trust_root_status"],
            "BOOTSTRAP_IDENTITY_NOT_EXTERNALLY_ATTESTED",
        )
        body = {key: item for key, item in first.items() if key != "verification_sha256"}
        self.assertEqual(first["verification_sha256"], canonical_sha256(body))

    def test_fixed_isolated_cli_succeeds_and_other_launch_modes_fail(self) -> None:
        command = [
            "/usr/bin/python3", "-I", "-S", "-B", str(BOOTSTRAP_PATH), "verify",
        ]
        first = subprocess.run(command, check=False, capture_output=True, cwd="/")
        second = subprocess.run(command, check=False, capture_output=True, cwd="/")
        self.assertEqual(first.returncode, 0, first.stderr.decode())
        self.assertEqual(first.stdout, second.stdout)
        report = json.loads(first.stdout)
        self.assertEqual(report["member_count"], 83)
        self.assertEqual(
            report["source_root_selection_status"],
            "BOOTSTRAP_ABSOLUTE_PATH_DERIVED_CALLER_OVERRIDE_FORBIDDEN",
        )
        self.assertEqual(first.stderr, b"")

        wrong_runtime = subprocess.run(
            ["/usr/bin/python3", "-B", str(BOOTSTRAP_PATH), "verify"],
            check=False,
            capture_output=True,
            cwd="/",
        )
        self.assertEqual(wrong_runtime.returncode, 1)
        self.assertEqual(wrong_runtime.stdout, b"")
        self.assertEqual(
            wrong_runtime.stderr,
            b"ISOLATED_UAT_PRE_IMPORT_PYTHON_RUNTIME_INVALID\n",
        )
        wrong_command = subprocess.run(
            ["/usr/bin/python3", "-I", "-S", "-B", str(BOOTSTRAP_PATH), "execute"],
            check=False,
            capture_output=True,
            cwd="/",
        )
        self.assertEqual(wrong_command.returncode, 1)
        self.assertEqual(wrong_command.stdout, b"")
        self.assertEqual(
            wrong_command.stderr,
            b"ISOLATED_UAT_PRE_IMPORT_COMMAND_INVALID\n",
        )
        double_slash = subprocess.run(
            [
                "/usr/bin/python3", "-I", "-S", "-B",
                f"/{BOOTSTRAP_PATH}", "verify",
            ],
            check=False,
            capture_output=True,
            cwd="/",
        )
        self.assertEqual(double_slash.returncode, 1)
        self.assertEqual(double_slash.stdout, b"")
        self.assertEqual(
            double_slash.stderr,
            b"ISOLATED_UAT_PRE_IMPORT_BOOTSTRAP_PATH_INVALID\n",
        )

    def test_bootstrap_import_surface_is_stdlib_only_and_has_no_path_loader(self) -> None:
        source = BOOTSTRAP_PATH.read_text(encoding="utf-8")
        tree = ast.parse(source)
        imports: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imports.add(node.module.split(".")[0])
        self.assertEqual(
            imports,
            {"__future__", "hashlib", "json", "os", "re", "stat", "sys", "typing"},
        )
        top_level_calls: list[str] = []
        for statement in tree.body:
            if isinstance(statement, (ast.FunctionDef, ast.ClassDef)):
                continue
            for node in ast.walk(statement):
                if not isinstance(node, ast.Call):
                    continue
                if isinstance(node.func, ast.Name):
                    top_level_calls.append(node.func.id)
                elif isinstance(node.func, ast.Attribute) \
                        and isinstance(node.func.value, ast.Name):
                    top_level_calls.append(f"{node.func.value.id}.{node.func.attr}")
        self.assertEqual(
            sorted(top_level_calls),
            ["SystemExit", "main", "re.compile", "re.compile"],
        )
        for forbidden in (
            "spec_from_file_location", "exec_module", "subprocess", "Path.read_bytes",
        ):
            self.assertNotIn(forbidden, source)
        validator_function = next(
            node for node in tree.body
            if isinstance(node, ast.FunctionDef)
            and node.name == "_run_verified_d183_validator"
        )
        validator_nodes = set(ast.walk(validator_function))
        compile_or_exec = [
            node for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in {"compile", "exec"}
        ]
        self.assertEqual(
            sorted(node.func.id for node in compile_or_exec), ["compile", "exec"],
        )
        self.assertTrue(all(node in validator_nodes for node in compile_or_exec))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            if isinstance(node.func, ast.Name):
                self.assertNotIn(node.func.id, {"eval", "__import__", "open"})
            if isinstance(node.func, ast.Attribute) \
                    and isinstance(node.func.value, ast.Name) \
                    and node.func.value.id == "os":
                self.assertFalse(
                    node.func.attr == "system" or node.func.attr == "popen"
                    or node.func.attr == "fork" or node.func.attr.startswith("exec")
                    or node.func.attr.startswith("spawn")
                )

    def test_validator_and_payload_tamper_cannot_execute_sentinels(self) -> None:
        with isolated_fixture() as root:
            sentinel = root.parent / "validator-executed"
            validator = root / BOOTSTRAP.D183_VALIDATOR_PATH
            validator.write_bytes(
                validator.read_bytes()
                + f'\nopen({str(sentinel)!r}, "wb").write(b"bad")\n'.encode()
            )
            with self.assertRaisesRegex(
                BOOTSTRAP.BootstrapError,
                "D183_VALIDATOR_RAW_DIGEST_MISMATCH",
            ):
                BOOTSTRAP.verify_site_root_for_tests(str(root))
            self.assertFalse(sentinel.exists())

        with isolated_fixture() as root:
            sentinel = root.parent / "payload-executed"
            payload = root / "scripts/isolated-uat-one-shot.py"
            payload.write_bytes(
                payload.read_bytes()
                + f'\nopen({str(sentinel)!r}, "wb").write(b"bad")\n'.encode()
            )
            with self.assertRaisesRegex(
                BOOTSTRAP.BootstrapError, "MEMBER_DIGEST_MISMATCH",
            ):
                BOOTSTRAP.verify_site_root_for_tests(str(root))
            self.assertFalse(sentinel.exists())

    def test_policy_and_member_self_resign_still_fails_fixed_raw_anchor(self) -> None:
        with isolated_fixture() as root:
            policy_path = root / BOOTSTRAP.POLICY_PATH
            policy_path.write_bytes(policy_path.read_bytes() + b"\n")
            with mock.patch.object(
                BOOTSTRAP, "_run_verified_d183_validator",
            ) as validator, self.assertRaisesRegex(
                BOOTSTRAP.BootstrapError, "POLICY_RAW_DIGEST_MISMATCH",
            ):
                BOOTSTRAP.verify_site_root_for_tests(str(root))
            validator.assert_not_called()

        with isolated_fixture() as root:
            payload = root / "scripts/isolated-uat-one-shot.py"
            payload.write_bytes(payload.read_bytes() + b"\n# attacker change\n")
            policy_path = root / BOOTSTRAP.D183_POLICY_PATH
            policy = json.loads(policy_path.read_bytes())
            member = next(
                item for item in policy["source_closure"]["members"]
                if item["path"] == "scripts/isolated-uat-one-shot.py"
            )
            member["sha256"] = hashlib.sha256(payload.read_bytes()).hexdigest()
            closure = policy["source_closure"]
            closure_body = {
                key: item for key, item in closure.items()
                if key != "source_closure_sha256"
            }
            closure["source_closure_sha256"] = canonical_sha256(closure_body)
            body = {key: item for key, item in policy.items() if key != "policy_sha256"}
            policy["policy_sha256"] = canonical_sha256(body)
            policy_path.write_text(json.dumps(policy), encoding="utf-8")
            with self.assertRaisesRegex(
                BOOTSTRAP.BootstrapError, "D183_POLICY_RAW_DIGEST_MISMATCH",
            ):
                BOOTSTRAP.verify_site_root_for_tests(str(root))

        with isolated_fixture() as root:
            final_member = root / member_paths()[-1]
            final_member.write_bytes(final_member.read_bytes() + b"\n")
            with mock.patch.object(
                BOOTSTRAP, "_run_verified_d183_validator",
            ) as validator, self.assertRaisesRegex(
                BOOTSTRAP.BootstrapError, "MEMBER_DIGEST_MISMATCH",
            ):
                BOOTSTRAP.verify_site_root_for_tests(str(root))
            validator.assert_not_called()

    def test_symlinked_root_ancestor_and_member_fail_closed(self) -> None:
        with isolated_fixture() as root:
            alias = root.parent / "site-link"
            alias.symlink_to(root, target_is_directory=True)
            with self.assertRaisesRegex(
                BOOTSTRAP.BootstrapError, "SOURCE_ROOT_INVALID",
            ):
                BOOTSTRAP.verify_site_root_for_tests(str(alias))

        with isolated_fixture() as root:
            scripts = root / "scripts"
            real_scripts = root / "scripts-real"
            scripts.rename(real_scripts)
            scripts.symlink_to("scripts-real", target_is_directory=True)
            with self.assertRaisesRegex(
                BOOTSTRAP.BootstrapError, "DIRECTORY_INVALID",
            ):
                BOOTSTRAP.verify_site_root_for_tests(str(root))

        with isolated_fixture() as root:
            target = root / "scripts/isolated-uat-one-shot.py"
            target.unlink()
            target.symlink_to("isolated-uat-runtime-contracts.py")
            with self.assertRaisesRegex(
                BOOTSTRAP.BootstrapError, "FILE_INVALID",
            ):
                BOOTSTRAP.verify_site_root_for_tests(str(root))

    def test_writable_ancestor_wrong_file_type_and_hardlink_fail_closed(self) -> None:
        with isolated_fixture() as root:
            root.chmod(0o770)
            with self.assertRaisesRegex(
                BOOTSTRAP.BootstrapError, "SOURCE_ROOT_INVALID",
            ):
                BOOTSTRAP.verify_site_root_for_tests(str(root))

        with isolated_fixture() as root:
            target = root / "scripts/isolated-uat-one-shot.py"
            target.chmod(0o666)
            with self.assertRaisesRegex(
                BOOTSTRAP.BootstrapError, "FILE_INVALID",
            ):
                BOOTSTRAP.verify_site_root_for_tests(str(root))

        with isolated_fixture() as root:
            (root / "scripts").chmod(0o770)
            with self.assertRaisesRegex(
                BOOTSTRAP.BootstrapError, "DIRECTORY_INVALID",
            ):
                BOOTSTRAP.verify_site_root_for_tests(str(root))

        with isolated_fixture() as root:
            target = root / "scripts/isolated-uat-one-shot.py"
            os.chown(target, 65534, -1)
            with self.assertRaisesRegex(
                BOOTSTRAP.BootstrapError, "FILE_INVALID",
            ):
                BOOTSTRAP.verify_site_root_for_tests(str(root))

        for kind in ("fifo", "hardlink"):
            with self.subTest(kind=kind), isolated_fixture() as root:
                target = root / "scripts/isolated-uat-one-shot.py"
                if kind == "fifo":
                    target.unlink()
                    os.mkfifo(target, 0o600)
                else:
                    holder = root / "one-shot-hardlink-holder"
                    os.link(target, holder)
                with self.assertRaisesRegex(
                    BOOTSTRAP.BootstrapError, "FILE_INVALID",
                ):
                    BOOTSTRAP.verify_site_root_for_tests(str(root))

    def test_in_place_change_during_fd_read_is_detected(self) -> None:
        with tempfile.TemporaryDirectory(
            dir=SITE_ROOT.parent, prefix=".d184-read-race-",
        ) as temporary:
            root = Path(temporary) / "root"
            root.mkdir(mode=0o700)
            target = root / "member.txt"
            target.write_bytes(b"stable")
            root_fd, root_stat = BOOTSTRAP._open_source_root(str(root))
            original = BOOTSTRAP._read_all

            def mutate_after_read(fd: int, maximum: int) -> bytes:
                raw = original(fd, maximum)
                target.write_bytes(raw + b"changed")
                return raw

            try:
                with mock.patch.object(
                    BOOTSTRAP, "_read_all", side_effect=mutate_after_read,
                ), self.assertRaisesRegex(
                    BOOTSTRAP.BootstrapError, "FILE_CHANGED_DURING_READ",
                ):
                    BOOTSTRAP._read_relative(
                        root_fd, root_stat.st_dev, "member.txt", 1024,
                    )
            finally:
                os.close(root_fd)

    def test_failed_snapshot_closes_all_file_descriptors(self) -> None:
        with isolated_fixture() as root:
            target = root / "scripts/isolated-uat-one-shot.py"
            target.write_bytes(target.read_bytes() + b"\n")
            before = len(list(Path("/proc/self/fd").iterdir()))
            with self.assertRaises(BOOTSTRAP.BootstrapError):
                BOOTSTRAP.verify_site_root_for_tests(str(root))
            after = len(list(Path("/proc/self/fd").iterdir()))
            self.assertEqual(after, before)

    def test_execution_handoff_remains_explicitly_unimplemented(self) -> None:
        with self.assertRaisesRegex(
            BOOTSTRAP.BootstrapError,
            "ISOLATED_UAT_PRE_IMPORT_EXECUTION_HANDOFF_NOT_IMPLEMENTED",
        ):
            BOOTSTRAP.require_execution_handoff()


if __name__ == "__main__":
    unittest.main()
