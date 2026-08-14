from __future__ import annotations

import copy
import base64
import hashlib
import importlib.util
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path


SITE_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = SITE_ROOT / "scripts" / "runtime-secret-file-policy.py"
POLICY_PATH = SITE_ROOT / "operations" / "runtime-secret-file-policy-v1.json"
SPEC = importlib.util.spec_from_file_location("runtime_secret_file_policy", MODULE_PATH)
runtime_secret = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(runtime_secret)


class RuntimeSecretFilePolicyTests(unittest.TestCase):
    @staticmethod
    def synthetic_value(index: int) -> str:
        raw = hashlib.sha256(f"task56-runtime-secret-{index}".encode("ascii")).digest()
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")

    def policy(self, root: Path) -> dict:
        policy, _ = runtime_secret.read_policy(POLICY_PATH, enforce_digest=False)
        policy = copy.deepcopy(policy)
        policy["host_root"] = str(root)
        policy["host_root_metadata"] = {"uid": os.getuid(), "gid": os.getgid(), "mode": "0700"}
        for entry in policy["entries"]:
            entry["uid"] = os.getuid()
            entry["gid"] = os.getgid()
        return policy

    def fixture(self) -> tuple[tempfile.TemporaryDirectory, Path, dict]:
        temporary = tempfile.TemporaryDirectory(prefix="cyd-runtime-secret-policy-")
        root = Path(temporary.name)
        root.chmod(0o700)
        policy = self.policy(root)
        for index, entry in enumerate(policy["entries"]):
            target = root / entry["source_name"]
            target.write_text(f"{self.synthetic_value(index)}\n", encoding="ascii")
            target.chmod(0o440)
        return temporary, root, policy

    def assert_code(self, code: str):
        return lambda error: isinstance(error, runtime_secret.SecretPolicyError) and error.code == code and str(error) == code

    def verify(self, policy: dict, root: Path) -> int:
        saved = {name: os.environ.pop(name, None) for name in policy["forbidden_environment"]}
        try:
            return runtime_secret.validate_secret_files(policy, root=str(root), trusted_ancestor=str(root))
        finally:
            for name, value in saved.items():
                if value is not None:
                    os.environ[name] = value

    def test_fixed_policy_shape_and_digest_are_valid(self) -> None:
        raw = POLICY_PATH.read_bytes()
        policy = runtime_secret.validate_policy(runtime_secret.parse_policy(raw))
        loaded, digest = runtime_secret.read_policy(POLICY_PATH)
        self.assertEqual(loaded, policy)
        self.assertEqual(digest, runtime_secret.EXPECTED_POLICY_SHA256)
        self.assertEqual(len(policy["entries"]), 6)
        self.assertEqual(len({entry["source_name"] for entry in policy["entries"]}), 6)
        self.assertEqual(len({entry["target_path"] for entry in policy["entries"]}), 6)

    def test_six_independent_synthetic_files_pass(self) -> None:
        temporary, root, policy = self.fixture()
        try:
            self.assertEqual(self.verify(policy, root), 6)
        finally:
            temporary.cleanup()

    def test_missing_symlink_hardlink_and_wrong_metadata_fail_closed(self) -> None:
        mutations = ("missing", "symlink", "hardlink", "mode")
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                temporary, root, policy = self.fixture()
                try:
                    first = root / policy["entries"][0]["source_name"]
                    second = root / policy["entries"][1]["source_name"]
                    if mutation == "missing":
                        first.unlink()
                        code = "RUNTIME_SECRET_FILE_UNAVAILABLE"
                    elif mutation == "symlink":
                        first.unlink()
                        first.symlink_to(second.name)
                        code = "RUNTIME_SECRET_FILE_METADATA_INVALID"
                    elif mutation == "hardlink":
                        second.unlink()
                        os.link(first, second)
                        code = "RUNTIME_SECRET_FILE_METADATA_INVALID"
                    else:
                        first.chmod(0o640)
                        code = "RUNTIME_SECRET_FILE_METADATA_INVALID"
                    with self.assertRaises(runtime_secret.SecretPolicyError) as caught:
                        self.verify(policy, root)
                    self.assertTrue(self.assert_code(code)(caught.exception))
                    self.assertNotIn(str(root), str(caught.exception))
                finally:
                    temporary.cleanup()

    def test_malformed_values_fail_closed(self) -> None:
        valid = self.synthetic_value(0)
        values = (
            "short\n",
            f" {valid}\n",
            f"{valid}\nsecond\n",
            f"{valid}\x00",
            f"{'a' * 43}\n",
            f"{valid[:-1]}B\n",
            f"{valid[:-1]}+\n",
        )
        for value in values:
            with self.subTest(value=repr(value)):
                temporary, root, policy = self.fixture()
                try:
                    target = root / policy["entries"][0]["source_name"]
                    target.chmod(0o600)
                    target.write_bytes(value.encode("utf-8"))
                    target.chmod(0o440)
                    with self.assertRaises(runtime_secret.SecretPolicyError) as caught:
                        self.verify(policy, root)
                    expected = "RUNTIME_SECRET_FILE_METADATA_INVALID" if len(value.encode("utf-8")) not in {43, 44} else "RUNTIME_SECRET_CONTENT_INVALID"
                    self.assertTrue(self.assert_code(expected)(caught.exception))
                finally:
                    temporary.cleanup()

    def test_empty_or_nonempty_forbidden_environment_fails_before_file_access(self) -> None:
        temporary, root, policy = self.fixture()
        try:
            for value in ("", "forbidden-value"):
                with self.subTest(value=value):
                    os.environ["DATABASE_URL"] = value
                    with self.assertRaises(runtime_secret.SecretPolicyError) as caught:
                        runtime_secret.validate_secret_files(policy, root=str(root), trusted_ancestor=str(root))
                    self.assertTrue(self.assert_code("RUNTIME_SECRET_ENVIRONMENT_FORBIDDEN")(caught.exception))
                    os.environ.pop("DATABASE_URL", None)
        finally:
            os.environ.pop("DATABASE_URL", None)
            temporary.cleanup()

    def test_equal_values_in_distinct_files_are_rejected(self) -> None:
        temporary, root, policy = self.fixture()
        try:
            first = root / policy["entries"][0]["source_name"]
            second = root / policy["entries"][1]["source_name"]
            second.chmod(0o600)
            second.write_bytes(first.read_bytes())
            second.chmod(0o440)
            with self.assertRaises(runtime_secret.SecretPolicyError) as caught:
                self.verify(policy, root)
            self.assertTrue(self.assert_code("RUNTIME_SECRET_VALUE_REUSED")(caught.exception))
        finally:
            temporary.cleanup()

    def test_weak_or_replaced_root_is_rejected_without_path_disclosure(self) -> None:
        temporary, root, policy = self.fixture()
        try:
            root.chmod(0o770)
            with self.assertRaises(runtime_secret.SecretPolicyError) as caught:
                self.verify(policy, root)
            self.assertTrue(self.assert_code("RUNTIME_SECRET_DIRECTORY_INVALID")(caught.exception))
            self.assertNotIn(str(root), str(caught.exception))
        finally:
            temporary.cleanup()

    def test_policy_rejects_secret_environment_or_binding_drift(self) -> None:
        source = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
        mutations = []
        environment = copy.deepcopy(source)
        environment["forbidden_environment"].remove("ERP_SETUP_TOKEN")
        mutations.append(environment)
        target = copy.deepcopy(source)
        target["entries"][0]["target_path"] = "/tmp/not-controlled"
        mutations.append(target)
        gid = copy.deepcopy(source)
        gid["entries"][0]["gid"] = 0
        mutations.append(gid)
        content = copy.deepcopy(source)
        content["content"]["minimum_distinct_characters"] = 1
        mutations.append(content)
        order = copy.deepcopy(source)
        order["entries"].reverse()
        mutations.append(order)
        for mutation in mutations:
            with self.assertRaises(runtime_secret.SecretPolicyError):
                runtime_secret.validate_policy(mutation)


if __name__ == "__main__":
    unittest.main()
