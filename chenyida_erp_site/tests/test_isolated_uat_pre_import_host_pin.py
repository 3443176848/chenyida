#!/usr/bin/python3
"""Tests for the create-only isolated-UAT external manifest pin installer."""

from __future__ import annotations

import ast
from contextlib import contextmanager
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest import mock


SITE_ROOT = Path(__file__).resolve().parent.parent
INSTALLER_PATH = (
    SITE_ROOT / "scripts/install-isolated-uat-pre-import-host-pin.py"
)


def load_module(name: str, path: Path):
    specification = importlib.util.spec_from_file_location(name, path)
    if specification is None or specification.loader is None:
        raise RuntimeError(f"{name} cannot be loaded")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


INSTALLER = load_module("isolated_uat_pre_import_host_pin", INSTALLER_PATH)


@contextmanager
def isolated_fixture():
    with tempfile.TemporaryDirectory(
        dir=SITE_ROOT.parent, prefix=".d186-host-pin-",
    ) as temporary:
        fixture = Path(temporary)
        source_root = fixture / "site"
        source_root.mkdir(mode=0o700)
        for relative in (
            INSTALLER.MANIFEST_PATH,
            INSTALLER.BOOTSTRAP_PATH,
            INSTALLER.BOOTSTRAP_POLICY_PATH,
        ):
            source = SITE_ROOT / relative
            target = source_root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target, follow_symlinks=False)
        yield fixture, source_root, fixture / "host-pin"


def canonical_sha256(value: object) -> str:
    raw = (json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ) + "\n").encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def write_pin(path: Path, raw: bytes, mode: int = 0o400) -> None:
    path.parent.mkdir(mode=0o700)
    path.write_bytes(raw)
    path.chmod(mode)


class IsolatedUatPreImportHostPinTest(unittest.TestCase):
    def test_contract_digests_and_fixed_disjoint_target(self) -> None:
        sources = {
            INSTALLER.MANIFEST_PATH: INSTALLER.EXPECTED_MANIFEST_RAW_SHA256,
            INSTALLER.BOOTSTRAP_PATH: INSTALLER.EXPECTED_BOOTSTRAP_RAW_SHA256,
            INSTALLER.BOOTSTRAP_POLICY_PATH: (
                INSTALLER.EXPECTED_BOOTSTRAP_POLICY_RAW_SHA256
            ),
        }
        for relative, expected in sources.items():
            self.assertEqual(
                hashlib.sha256((SITE_ROOT / relative).read_bytes()).hexdigest(),
                expected,
            )
        self.assertEqual(
            hashlib.sha256(INSTALLER.EXPECTED_PIN_RAW).hexdigest(),
            INSTALLER.EXPECTED_PIN_RAW_SHA256,
        )
        self.assertEqual(
            INSTALLER.EXPECTED_PIN_RAW,
            (INSTALLER.EXPECTED_MANIFEST_RAW_SHA256 + "\n").encode("ascii"),
        )
        INSTALLER._require_fixed_contract()
        self.assertFalse(
            INSTALLER.PIN_ROOT == str(SITE_ROOT)
            or INSTALLER.PIN_ROOT.startswith(str(SITE_ROOT) + "/")
        )
        for protected in INSTALLER.PROTECTED_ROOTS:
            self.assertFalse(
                INSTALLER.PIN_ROOT == protected
                or INSTALLER.PIN_ROOT.startswith(protected + "/")
            )
            with mock.patch.object(INSTALLER, "PIN_ROOT", protected):
                with self.assertRaisesRegex(
                    INSTALLER.HostPinError,
                    "ISOLATED_UAT_HOST_PIN_FIXED_CONTRACT_INVALID",
                ):
                    INSTALLER._require_fixed_contract()

    def test_first_install_creates_exact_pin_and_honest_report(self) -> None:
        with isolated_fixture() as (_, source_root, pin_root):
            report = INSTALLER.install_for_tests(
                str(source_root), str(pin_root),
            )
            pin = pin_root / INSTALLER.PIN_NAME
            metadata = pin.stat(follow_symlinks=False)
            self.assertEqual(pin.read_bytes(), INSTALLER.EXPECTED_PIN_RAW)
            self.assertEqual(stat.S_IMODE(pin_root.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(metadata.st_mode), 0o400)
            self.assertEqual((metadata.st_uid, metadata.st_gid), (0, 0))
            self.assertEqual(metadata.st_nlink, 1)
            self.assertEqual(list(pin_root.iterdir()), [pin])
        self.assertEqual(report["install_status"], "CREATED_AND_VERIFIED")
        self.assertEqual(
            report["host_pin_status"],
            "EXTERNAL_MANIFEST_PIN_INSTALLED_AND_READ_BACK",
        )
        self.assertEqual(report["trusted_plan_launch_status"], "NOT_ESTABLISHED")
        self.assertEqual(report["writer_separation_status"], "NOT_ESTABLISHED")
        self.assertEqual(
            report["crash_recovery_status"],
            "NOT_IMPLEMENTED_FAIL_CLOSED_ON_PREPARED_RESIDUE",
        )
        self.assertEqual(report["python_runtime_and_stdlib_identity"], "NOT_ATTESTED")
        self.assertEqual(report["execution_command_status"], "UNAVAILABLE")
        self.assertFalse(report["execution_authorized"])
        self.assertEqual(report["uat_status"], "NOT_CREATED")
        body = {key: item for key, item in report.items() if key != "report_sha256"}
        self.assertEqual(report["report_sha256"], canonical_sha256(body))

    def test_install_is_idempotent_and_verify_is_deterministic(self) -> None:
        with isolated_fixture() as (_, source_root, pin_root):
            first = INSTALLER.install_for_tests(str(source_root), str(pin_root))
            before = (pin_root / INSTALLER.PIN_NAME).stat()
            second = INSTALLER.install_for_tests(str(source_root), str(pin_root))
            after = (pin_root / INSTALLER.PIN_NAME).stat()
            verify_one = INSTALLER.verify_for_tests(str(source_root), str(pin_root))
            verify_two = INSTALLER.verify_for_tests(str(source_root), str(pin_root))
        self.assertEqual(first["install_status"], "CREATED_AND_VERIFIED")
        self.assertEqual(second["install_status"], "ALREADY_PRESENT_VERIFIED")
        self.assertEqual(
            (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns),
            (after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns),
        )
        self.assertEqual(verify_one, verify_two)
        self.assertEqual(verify_one["install_status"], "READ_ONLY_VERIFY")

    def test_existing_wrong_content_is_not_overwritten(self) -> None:
        wrong = b"0" * 64 + b"\n"
        with isolated_fixture() as (_, source_root, pin_root):
            pin = pin_root / INSTALLER.PIN_NAME
            write_pin(pin, wrong)
            before = pin.stat()
            with self.assertRaisesRegex(
                INSTALLER.HostPinError,
                "ISOLATED_UAT_HOST_PIN_EXISTING_CONTENT_MISMATCH",
            ):
                INSTALLER.install_for_tests(str(source_root), str(pin_root))
            after = pin.stat()
            self.assertEqual(pin.read_bytes(), wrong)
            self.assertEqual((before.st_ino, before.st_mtime_ns), (
                after.st_ino, after.st_mtime_ns,
            ))

        with isolated_fixture() as (fixture, _, pin_root):
            pin = pin_root / INSTALLER.PIN_NAME
            write_pin(pin, INSTALLER.EXPECTED_PIN_RAW)
            other = fixture / "other-file"
            other.write_bytes(INSTALLER.EXPECTED_PIN_RAW)
            other.chmod(0o400)
            directory_fd = os.open(
                pin_root,
                os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW,
            )
            try:
                with mock.patch.object(
                    INSTALLER.os, "stat", return_value=other.stat(),
                ):
                    with self.assertRaisesRegex(
                        INSTALLER.HostPinError,
                        "ISOLATED_UAT_HOST_PIN_FILE_CHANGED",
                    ):
                        INSTALLER._read_file_at(
                            directory_fd,
                            INSTALLER.PIN_NAME,
                            len(INSTALLER.EXPECTED_PIN_RAW),
                            required_mode=0o400,
                        )
            finally:
                os.close(directory_fd)

    def test_existing_wrong_file_types_and_metadata_fail_closed(self) -> None:
        cases = ("mode", "owner", "group", "hardlink", "fifo", "directory")
        for case in cases:
            with self.subTest(case=case), isolated_fixture() as (
                fixture, source_root, pin_root,
            ):
                pin_root.mkdir(mode=0o700)
                pin = pin_root / INSTALLER.PIN_NAME
                if case == "fifo":
                    os.mkfifo(pin, 0o400)
                elif case == "directory":
                    pin.mkdir(mode=0o700)
                else:
                    pin.write_bytes(INSTALLER.EXPECTED_PIN_RAW)
                    pin.chmod(0o400 if case != "mode" else 0o600)
                    if case == "owner":
                        os.chown(pin, 1, 0)
                    elif case == "group":
                        os.chown(pin, 0, 1)
                    elif case == "hardlink":
                        os.link(pin, fixture / "second-link")
                with self.assertRaisesRegex(
                    INSTALLER.HostPinError,
                    "ISOLATED_UAT_HOST_PIN_FILE_INVALID",
                ):
                    INSTALLER.install_for_tests(str(source_root), str(pin_root))
                self.assertTrue(pin.exists() or pin.is_fifo())

    def test_symlinks_and_writable_ancestors_fail_closed(self) -> None:
        with isolated_fixture() as (fixture, source_root, pin_root):
            pin_root.mkdir(mode=0o700)
            target = fixture / "target"
            target.write_bytes(INSTALLER.EXPECTED_PIN_RAW)
            (pin_root / INSTALLER.PIN_NAME).symlink_to(target)
            with self.assertRaisesRegex(
                INSTALLER.HostPinError, "ISOLATED_UAT_HOST_PIN_FILE_INVALID",
            ):
                INSTALLER.install_for_tests(str(source_root), str(pin_root))

        with isolated_fixture() as (fixture, source_root, pin_root):
            real_root = fixture / "real-pin"
            real_root.mkdir(mode=0o700)
            pin_root.symlink_to(real_root, target_is_directory=True)
            with self.assertRaisesRegex(
                INSTALLER.HostPinError,
                "ISOLATED_UAT_HOST_PIN_DIRECTORY_INVALID",
            ):
                INSTALLER.install_for_tests(str(source_root), str(pin_root))

        with isolated_fixture() as (fixture, source_root, _):
            writable = fixture / "writable"
            writable.mkdir(mode=0o777)
            writable.chmod(0o777)
            with self.assertRaisesRegex(
                INSTALLER.HostPinError,
                "ISOLATED_UAT_HOST_PIN_DIRECTORY_INVALID",
            ):
                INSTALLER.install_for_tests(
                    str(source_root), str(writable / "host-pin"),
                )

    def test_fixed_cli_rejects_non_contract_commands_and_overrides(self) -> None:
        prefix = [
            "/usr/bin/python3", "-I", "-S", "-B", str(INSTALLER_PATH),
        ]
        for arguments in (["execute"], ["install", "/tmp/pin"], []):
            result = subprocess.run(
                prefix + arguments, check=False, capture_output=True, cwd="/",
            )
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, b"")
            self.assertEqual(
                result.stderr, b"ISOLATED_UAT_HOST_PIN_COMMAND_INVALID\n",
            )
        wrong_runtime = subprocess.run(
            ["/usr/bin/python3", "-B", str(INSTALLER_PATH), "verify"],
            check=False,
            capture_output=True,
            cwd="/",
        )
        self.assertEqual(wrong_runtime.returncode, 1)
        self.assertEqual(
            wrong_runtime.stderr,
            b"ISOLATED_UAT_HOST_PIN_PYTHON_RUNTIME_INVALID\n",
        )

        output = SimpleNamespace(buffer=io.BytesIO())
        with mock.patch.object(INSTALLER, "_require_runtime"), \
                mock.patch.object(INSTALLER.os, "umask"), \
                mock.patch.object(INSTALLER.sys, "stdout", output), \
                mock.patch.object(
                    INSTALLER, "_run", return_value={"result": "test"},
                ) as run:
            self.assertEqual(INSTALLER.main(["verify"]), 0)
        run.assert_called_once_with(
            "verify",
            str(SITE_ROOT),
            INSTALLER.PIN_ROOT,
            "FIXED_REPOSITORY_AND_HOST_PIN_PATHS_CALLER_OVERRIDE_FORBIDDEN",
        )

    def test_non_root_runtime_is_rejected(self) -> None:
        with mock.patch.object(INSTALLER.os, "getuid", return_value=1):
            with self.assertRaisesRegex(
                INSTALLER.HostPinError, "ISOLATED_UAT_HOST_PIN_ROOT_REQUIRED",
            ):
                INSTALLER._require_runtime()
        with mock.patch.object(INSTALLER.os, "geteuid", return_value=1):
            with self.assertRaisesRegex(
                INSTALLER.HostPinError, "ISOLATED_UAT_HOST_PIN_ROOT_REQUIRED",
            ):
                INSTALLER._require_runtime()

    def test_concurrent_install_has_one_exact_result_and_no_temp(self) -> None:
        with isolated_fixture() as (_, source_root, pin_root):
            results: list[dict[str, object]] = []
            errors: list[str] = []

            def install() -> None:
                try:
                    results.append(INSTALLER.install_for_tests(
                        str(source_root), str(pin_root),
                    ))
                except INSTALLER.HostPinError as error:
                    errors.append(str(error))

            threads = [threading.Thread(target=install) for _ in range(8)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            self.assertTrue(results)
            self.assertTrue(set(errors).issubset({
                "ISOLATED_UAT_HOST_PIN_DIRECTORY_CREATE_FAILED",
                "ISOLATED_UAT_HOST_PIN_DIRECTORY_NOT_EXACT",
            }), errors)
            pin = pin_root / INSTALLER.PIN_NAME
            self.assertEqual(pin.read_bytes(), INSTALLER.EXPECTED_PIN_RAW)
            self.assertEqual(sorted(item.name for item in pin_root.iterdir()), [
                INSTALLER.PIN_NAME,
            ])
            self.assertEqual(
                INSTALLER.verify_for_tests(
                    str(source_root), str(pin_root),
                )["host_pin_status"],
                "EXTERNAL_MANIFEST_PIN_INSTALLED_AND_READ_BACK",
            )

    def test_publish_failure_cleans_temp_and_retry_succeeds(self) -> None:
        with isolated_fixture() as (_, source_root, pin_root):
            with mock.patch.object(
                INSTALLER,
                "_write_all",
                side_effect=INSTALLER.HostPinError(
                    "ISOLATED_UAT_HOST_PIN_WRITE_FAILED"
                ),
            ):
                with self.assertRaisesRegex(
                    INSTALLER.HostPinError,
                    "ISOLATED_UAT_HOST_PIN_WRITE_FAILED",
                ):
                    INSTALLER.install_for_tests(str(source_root), str(pin_root))
            self.assertEqual(list(pin_root.iterdir()), [])
            report = INSTALLER.install_for_tests(str(source_root), str(pin_root))
            self.assertEqual(report["install_status"], "CREATED_AND_VERIFIED")
            self.assertEqual(sorted(item.name for item in pin_root.iterdir()), [
                INSTALLER.PIN_NAME,
            ])

        with isolated_fixture() as (_, source_root, pin_root):
            pin_root.mkdir(mode=0o700)
            stale = pin_root / (
                ".manifest.sha256.prepared.1234."
                "0123456789abcdef0123456789abcdef.tmp"
            )
            stale.write_bytes(INSTALLER.EXPECTED_PIN_RAW)
            stale.chmod(0o400)
            with self.assertRaisesRegex(
                INSTALLER.HostPinError,
                "ISOLATED_UAT_HOST_PIN_DIRECTORY_NOT_EXACT",
            ):
                INSTALLER.install_for_tests(str(source_root), str(pin_root))
            self.assertEqual(stale.read_bytes(), INSTALLER.EXPECTED_PIN_RAW)
            self.assertFalse((pin_root / INSTALLER.PIN_NAME).exists())

    def test_source_drift_prevents_target_creation(self) -> None:
        cases = (
            (INSTALLER.MANIFEST_PATH, "MANIFEST_DIGEST_MISMATCH"),
            (INSTALLER.BOOTSTRAP_PATH, "BOOTSTRAP_DIGEST_MISMATCH"),
            (INSTALLER.BOOTSTRAP_POLICY_PATH, "POLICY_DIGEST_MISMATCH"),
        )
        for relative, suffix in cases:
            with self.subTest(relative=relative), isolated_fixture() as (
                _, source_root, pin_root,
            ):
                with (source_root / relative).open("ab") as stream:
                    stream.write(b"\n")
                with self.assertRaisesRegex(
                    INSTALLER.HostPinError,
                    f"ISOLATED_UAT_HOST_PIN_{suffix}",
                ):
                    INSTALLER.install_for_tests(str(source_root), str(pin_root))
                self.assertFalse(pin_root.exists())

    def test_static_surface_has_no_runtime_actions_and_no_fd_leak(self) -> None:
        source = INSTALLER_PATH.read_text(encoding="utf-8")
        tree = ast.parse(source)
        imports: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imports.add(node.module.split(".")[0])
        self.assertEqual(imports, {
            "__future__", "ctypes", "errno", "hashlib", "json", "os", "re",
            "stat", "sys", "typing",
        })
        for forbidden in (
            "subprocess", "socket", "sqlite3", "requests", "urllib",
            "docker", "systemctl", "Popen",
        ):
            self.assertNotIn(forbidden, source)
        dangerous_builtins = [
            node.func.id
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in {"compile", "eval", "exec"}
        ]
        self.assertEqual(dangerous_builtins, [])

        with isolated_fixture() as (_, source_root, pin_root):
            INSTALLER.install_for_tests(str(source_root), str(pin_root))
            before = len(os.listdir("/proc/self/fd"))
            for _ in range(25):
                report = INSTALLER.verify_for_tests(
                    str(source_root), str(pin_root),
                )
            after = len(os.listdir("/proc/self/fd"))
        self.assertEqual(before, after)
        self.assertEqual(report["launch_enforcement_status"], "NOT_IMPLEMENTED")
        self.assertEqual(
            report["crash_recovery_status"],
            "NOT_IMPLEMENTED_FAIL_CLOSED_ON_PREPARED_RESIDUE",
        )
        self.assertEqual(report["runtime_publisher_status"], "NOT_IMPLEMENTED")
        self.assertEqual(report["runtime_evidence_status"], "NOT_ESTABLISHED")
        self.assertEqual(report["uat_status"], "NOT_CREATED")


if __name__ == "__main__":
    unittest.main()
