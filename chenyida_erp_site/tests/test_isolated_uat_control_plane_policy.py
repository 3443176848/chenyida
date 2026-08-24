#!/usr/bin/python3
"""Static tests for the minimal isolated UAT control request."""

from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path


SITE_ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location(
    "isolated_uat_control_plane_policy",
    SITE_ROOT / "scripts/isolated-uat-control-plane-policy.py",
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("isolated UAT validator cannot be loaded")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
POLICY_FILE = SITE_ROOT / "operations/isolated-uat-control-plane-policy-v1.json"


def request(policy: dict) -> dict:
    project = "chenyida-erp-uat-contract-test"
    return {
        "schema_version": 1,
        "contract": MODULE.REQUEST_CONTRACT,
        "request_id": "uat-contract-request-001",
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


class IsolatedUatControlPlanePolicyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.policy = MODULE.read_policy(POLICY_FILE)

    def test_valid_contract_is_current_and_non_executing(self) -> None:
        self.assertFalse(self.policy["deployment_authorized"])
        self.assertEqual(self.policy["safety"]["runtime_actions_authorized"], [])
        self.assertEqual(self.policy["release"]["implementation_status"], "CONTRACT_ONLY_NOT_EXECUTABLE")
        self.assertEqual(MODULE.validate_request(request(self.policy), self.policy), request(self.policy))

    def test_request_failures_are_closed(self) -> None:
        cases = []
        production = request(self.policy)
        production["project"] = "chenyida-erp"
        cases.append((production, "ISOLATED_UAT_PROJECT_INVALID"))

        protected = request(self.policy)
        protected["roots"]["runtime_secret_root"] = "/etc/chenyida-erp/runtime-secrets"
        cases.append((protected, "ISOLATED_UAT_ROOT_TEMPLATE_MISMATCH"))

        stale = request(self.policy)
        stale["source"]["migration_target_head"] = "0045_runtime_worker_readiness.sql"
        cases.append((stale, "ISOLATED_UAT_REQUEST_SOURCE_INVALID"))

        mutable = request(self.policy)
        mutable["images"]["web"]["image_reference"] = "example.invalid/erp-web:latest"
        cases.append((mutable, "ISOLATED_UAT_REQUEST_IMAGE_INVALID"))

        action = request(self.policy)
        action["runtime_actions_authorized"] = ["CREATE_DATABASE"]
        cases.append((action, "ISOLATED_UAT_REQUEST_AUTHORIZATION_INVALID"))

        staffing = request(self.policy)
        staffing["staff_count"] = 2
        cases.append((staffing, "ISOLATED_UAT_REQUEST_FIELDS_INVALID"))

        for value, code in cases:
            with self.subTest(code=code), self.assertRaisesRegex(MODULE.ContractError, code):
                MODULE.validate_request(value, self.policy)

    def test_policy_role_and_source_drift_fail_closed(self) -> None:
        roles = copy.deepcopy(self.policy)
        roles["database"]["role_credentials"].pop("chenyida_erp_worker")
        with self.assertRaisesRegex(MODULE.ContractError, "ISOLATED_UAT_POLICY_DATABASE_INVALID"):
            MODULE.validate_policy(roles)

        sources = copy.deepcopy(self.policy)
        sources["source_binding"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(MODULE.ContractError, "ISOLATED_UAT_POLICY_SOURCE_BINDING_STALE"):
            MODULE.validate_policy(sources)

    def test_duplicate_json_key_fails_closed(self) -> None:
        with self.assertRaisesRegex(MODULE.ContractError, "ISOLATED_UAT_JSON_DUPLICATE_KEY"):
            MODULE.parse_json(b'{"schema_version":1,"schema_version":1}', "INVALID")


if __name__ == "__main__":
    unittest.main(verbosity=2)
