#!/usr/bin/python3
"""Static tests for the default-disabled isolated UAT one-shot entrypoint."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import io
import json
import tempfile
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
        cls.bindings = ONE_SHOT.read_bindings()

    def test_plan_is_deterministic_exact_and_non_executing(self) -> None:
        first = ONE_SHOT.build_plan(self.request, self.policy)
        second = ONE_SHOT.build_plan(copy.deepcopy(self.request), self.policy)
        self.assertEqual(first, second)
        self.assertEqual(ONE_SHOT.validate_plan(first, self.request, self.policy), first)
        self.assertEqual(first["mode"], "READ_ONLY_PLAN")
        self.assertFalse(first["execution_authorized"])
        self.assertEqual(first["action_binding_id"], self.bindings["binding_id"])
        self.assertEqual(first["action_binding_sha256"], self.bindings["binding_sha256"])
        self.assertEqual(first["action_binding_status"], ONE_SHOT.BINDING_IMPLEMENTATION_STATUS)
        self.assertEqual([item["ordinal"] for item in first["actions"]], list(range(1, 10)))
        self.assertEqual(first["roots"], self.request["roots"])
        self.assertNotIn("staff", ONE_SHOT.canonical_json(first).lower())

    def test_database_bootstrap_migration_and_final_privileges_are_ordered(self) -> None:
        actions = self.bindings["actions"]
        self.assertIn("validated_request", actions[1]["inputs"])
        for previous, current in zip(actions, actions[1:]):
            self.assertTrue(set(previous["outputs"]) & set(current["inputs"]))
        self.assertEqual([item["action"] for item in actions[4:8]], [
            "INITIALIZE_DATABASE_IDENTITY_AND_LOGIN_ROLES",
            "MIGRATE_EMPTY_DATABASE_TO_BOUND_HEAD",
            "RECONCILE_FINAL_RUNTIME_PRIVILEGES",
            "START_BOUND_RUNTIME_SERVICES",
        ])
        self.assertIn("database_bootstrap_receipt", actions[5]["inputs"])
        self.assertIn("migration_execution_receipt", actions[6]["inputs"])
        self.assertIn("runtime_privilege_receipt", actions[7]["inputs"])
        self.assertIn("package_version", actions[7]["inputs"])
        self.assertIn("git_commit", actions[7]["inputs"])
        self.assertEqual(actions[4]["sources"], ["scripts/isolated-uat-one-shot.py"])
        self.assertEqual(actions[5]["sources"], ["scripts/isolated-uat-one-shot.py"])
        self.assertNotIn("scripts/release-migration-authorization.ts", actions[5]["sources"])

    def test_isolated_evidence_requires_all_runtime_identities(self) -> None:
        actions = self.bindings["actions"]
        self.assertEqual(actions[7]["outputs"], [
            "caddy_container_identity", "web_container_identity", "worker_container_identity",
        ])
        for required in (
            "postgres_container_identity", "caddy_container_identity",
            "web_container_identity", "worker_container_identity",
        ):
            self.assertIn(required, actions[8]["inputs"])
        self.assertIn("runtime_privilege_receipt", actions[8]["inputs"])
        for required in ("roots", "package_version", "resolved_compose_sha256", "release_identity_reader_gid"):
            self.assertIn(required, actions[8]["inputs"])
        self.assertEqual(actions[8]["outputs"], [
            "readiness_receipt", "isolated_uat_postdeploy_receipt",
            "isolated_uat_runtime_identity_receipt",
        ])
        self.assertNotIn("scripts/release-identity-contract.mjs", actions[8]["sources"])

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
        bound_sources = {source for item in self.bindings["actions"] for source in item["sources"]}
        self.assertTrue(bound_sources.isdisjoint(ONE_SHOT.FORBIDDEN_PRODUCTION_ENTRYPOINTS))
        self.assertNotIn("/etc/chenyida-erp", plan["roots"].values())
        self.assertNotIn("/var/lib/chenyida-erp", plan["roots"].values())

    def test_action_bindings_have_direct_bound_sources_and_no_commands(self) -> None:
        self.assertEqual(self.bindings["execution_boundary"], {
            "evidence_scope": "ISOLATED_UAT_ONLY",
            "shell_allowed": False,
            "free_form_argv_allowed": False,
            "production_entrypoints_allowed": False,
            "production_release_identity_allowed": False,
            "runtime_path_implemented": False,
            "source_binding_scope": "DIRECT_CONTRACT_REFERENCES_ONLY",
        })
        policy_sources = {item["path"] for item in self.policy["source_binding"]}
        bound_sources = {source for item in self.bindings["actions"] for source in item["sources"]}
        self.assertTrue(bound_sources.issubset(policy_sources))
        self.assertEqual(
            [(item["ordinal"], item["action"], item["handler_id"], item["adapter_method"]) for item in self.bindings["actions"]],
            [(item["ordinal"], item["action"], item["handler_id"], item["adapter_method"]) for item in ONE_SHOT.build_plan(self.request, self.policy)["actions"]],
        )
        serialized = ONE_SHOT.canonical_json(self.bindings).lower()
        self.assertNotIn('"argv"', serialized)
        self.assertNotIn('"command"', serialized)
        self.assertNotIn("staff", serialized)
        legacy_path = SITE_ROOT / "operations/isolated-uat-one-shot-action-bindings-v1.json"
        legacy_raw = legacy_path.read_bytes()
        self.assertEqual(
            hashlib.sha256(legacy_raw).hexdigest(),
            "3244d550ae61bffa42fe1fa1c5c4c8bf0b610b60e1e96e8bac9a9c55ca177b3a",
        )
        legacy = json.loads(legacy_raw)
        legacy_body = {key: value for key, value in legacy.items() if key != "binding_sha256"}
        self.assertEqual(POLICY.canonical_sha256(legacy_body), legacy["binding_sha256"])

    def test_recomputed_tampered_binding_is_rejected(self) -> None:
        tampered = copy.deepcopy(self.bindings)
        tampered["actions"][3]["adapter_method"] = "start_all_services"
        body = {key: value for key, value in tampered.items() if key != "binding_sha256"}
        tampered["binding_sha256"] = POLICY.canonical_sha256(body)
        with tempfile.TemporaryDirectory(prefix="cyd-uat-action-binding-test.") as directory:
            path = Path(directory) / "bindings.json"
            path.write_text(ONE_SHOT.canonical_json(tampered), encoding="utf-8")
            with self.assertRaisesRegex(ONE_SHOT.ContractError, "ISOLATED_UAT_ACTION_BINDING_SHA256_INVALID"):
                ONE_SHOT.read_bindings(path)


if __name__ == "__main__":
    unittest.main(verbosity=2)
