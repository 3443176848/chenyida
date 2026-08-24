#!/usr/bin/python3
"""Static tests for the default-disabled isolated UAT one-shot entrypoint."""

from __future__ import annotations

import copy
import importlib.util
import io
import json
import unittest
from pathlib import Path


SITE_ROOT = Path(__file__).resolve().parent.parent


def load_module(name: str, path: Path):
    specification = importlib.util.spec_from_file_location(name, path)
    if specification is None or specification.loader is None:
        raise RuntimeError(f"{name} cannot be loaded")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


POLICY = load_module(
    "isolated_uat_control_plane_policy_test_dependency",
    SITE_ROOT / "scripts/isolated-uat-control-plane-policy.py",
)
ONE_SHOT = load_module(
    "isolated_uat_one_shot",
    SITE_ROOT / "scripts/isolated-uat-one-shot.py",
)
POLICY_FILE = SITE_ROOT / "operations/isolated-uat-control-plane-policy-v1.json"


def request(policy: dict) -> dict:
    project = "chenyida-erp-uat-one-shot-test"
    return {
        "schema_version": 1,
        "contract": POLICY.REQUEST_CONTRACT,
        "request_id": "uat-one-shot-request-001",
        "policy_sha256": policy["policy_sha256"],
        "project": project,
        "roots": {key: value.format(project=project) for key, value in policy["namespace"]["roots"].items()},
        "source": {
            "package_version": policy["release"]["package_version"],
            "git_commit": "a" * 40,
            "git_tree": "b" * 40,
            "migration_current_head": policy["database"]["current_head"],
            "migration_target_head": policy["database"]["target_head"],
            "migration_allowlist_sha256": policy["database"]["migration_allowlist_sha256"],
            "resolved_compose_sha256": "c" * 64,
        },
        "images": {
            "web": {
                "image_reference": f"example.invalid/erp-web@sha256:{'d' * 64}",
                "config_digest": f"sha256:{'e' * 64}",
            },
            "worker": {
                "image_reference": f"example.invalid/erp-worker@sha256:{'f' * 64}",
                "config_digest": f"sha256:{'1' * 64}",
            },
        },
        "ports": {"host_ip": "127.0.0.1", "web": 33001, "caddy_http": 33080, "caddy_https": 33443},
        "runtime_actions_authorized": [],
        "request_only": True,
    }


class IsolatedUatOneShotTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.policy = POLICY.read_policy(POLICY_FILE)
        cls.request = request(cls.policy)

    def test_plan_is_deterministic_exact_and_non_executing(self) -> None:
        first = ONE_SHOT.build_plan(self.request, self.policy)
        second = ONE_SHOT.build_plan(copy.deepcopy(self.request), self.policy)
        self.assertEqual(first, second)
        self.assertEqual(ONE_SHOT.validate_plan(first, self.request, self.policy), first)
        self.assertEqual(first["mode"], "READ_ONLY_PLAN")
        self.assertFalse(first["execution_authorized"])
        self.assertEqual([item["ordinal"] for item in first["actions"]], list(range(1, 10)))
        self.assertEqual(first["roots"], self.request["roots"])
        self.assertNotIn("staff", ONE_SHOT.canonical_json(first).lower())

    def test_execute_fails_before_any_plan_is_emitted(self) -> None:
        output = io.StringIO()
        errors = io.StringIO()
        result = ONE_SHOT.main(
            ["execute", "--policy", str(POLICY_FILE)],
            input_stream=io.BytesIO(ONE_SHOT.canonical_json(self.request).encode("utf-8")),
            output_stream=output,
            error_stream=errors,
        )
        self.assertEqual(result, 1)
        self.assertEqual(output.getvalue(), "")
        self.assertEqual(errors.getvalue(), "ISOLATED_UAT_ONE_SHOT_EXECUTION_NOT_AUTHORIZED\n")

    def test_default_command_emits_only_the_validated_plan(self) -> None:
        output = io.StringIO()
        errors = io.StringIO()
        result = ONE_SHOT.main(
            ["--policy", str(POLICY_FILE)],
            input_stream=io.BytesIO(ONE_SHOT.canonical_json(self.request).encode("utf-8")),
            output_stream=output,
            error_stream=errors,
        )
        self.assertEqual(result, 0)
        self.assertEqual(errors.getvalue(), "")
        self.assertEqual(json.loads(output.getvalue()), ONE_SHOT.build_plan(self.request, self.policy))

    def test_invalid_request_and_tampered_plan_fail_closed(self) -> None:
        invalid = copy.deepcopy(self.request)
        invalid["runtime_actions_authorized"] = ["START_POSTGRES_ONLY"]
        with self.assertRaisesRegex(ONE_SHOT.ContractError, "ISOLATED_UAT_REQUEST_AUTHORIZATION_INVALID"):
            ONE_SHOT.build_plan(invalid, self.policy)

        plan = ONE_SHOT.build_plan(self.request, self.policy)
        plan["actions"][3]["action"] = "START_ALL_SERVICES"
        with self.assertRaisesRegex(ONE_SHOT.ContractError, "ISOLATED_UAT_ONE_SHOT_PLAN_INVALID"):
            ONE_SHOT.validate_plan(plan, self.request, self.policy)

    def test_production_entrypoints_are_forbidden_not_executors(self) -> None:
        plan = ONE_SHOT.build_plan(self.request, self.policy)
        self.assertEqual(plan["forbidden_production_entrypoints"], ONE_SHOT.FORBIDDEN_PRODUCTION_ENTRYPOINTS)
        executors = {item["executor_contract"] for item in plan["actions"]}
        self.assertTrue(executors.isdisjoint(ONE_SHOT.FORBIDDEN_PRODUCTION_ENTRYPOINTS))
        self.assertNotIn("/etc/chenyida-erp", plan["roots"].values())
        self.assertNotIn("/var/lib/chenyida-erp", plan["roots"].values())


if __name__ == "__main__":
    unittest.main(verbosity=2)
