#!/usr/bin/python3
"""Static tests for the default-disabled isolated UAT one-shot entrypoint."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import io
import inspect
import json
import tempfile
import unittest
from unittest import mock
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
        cls.owner_completion_bindings = ONE_SHOT.read_owner_completion_bindings()
        cls.legacy_receipt_bindings = ONE_SHOT.read_legacy_receipt_bindings()
        cls.runtime_contract_policy = ONE_SHOT.read_runtime_contract_policy()
        cls.runtime_receipt_policy = ONE_SHOT.read_runtime_receipt_policy()
        cls.external_anchor_policy = ONE_SHOT.read_external_anchor_policy()
        cls.owner_completion_policy = ONE_SHOT.read_owner_completion_policy()
        cls.host_sni_policy = ONE_SHOT.read_host_sni_policy()
        cls.external_anchor_bindings = ONE_SHOT.read_external_anchor_bindings()

    def test_plan_is_deterministic_exact_and_non_executing(self) -> None:
        first = ONE_SHOT.build_plan(self.request, self.policy)
        second = ONE_SHOT.build_plan(copy.deepcopy(self.request), self.policy)
        self.assertEqual(first, second)
        self.assertEqual(ONE_SHOT.validate_plan(first, self.request, self.policy), first)
        self.assertEqual(first["mode"], "READ_ONLY_PLAN")
        self.assertEqual(first["schema_version"], 6)
        self.assertEqual(first["contract"], "chenyida-erp-isolated-uat-one-shot-plan/v6")
        self.assertEqual(first["entrypoint_id"], "chenyida-erp-isolated-uat-one-shot-v6")
        self.assertFalse(first["execution_authorized"])
        self.assertEqual(first["action_binding_id"], self.bindings["binding_id"])
        self.assertEqual(first["action_binding_sha256"], self.bindings["binding_sha256"])
        self.assertEqual(first["action_binding_status"], ONE_SHOT.BINDING_IMPLEMENTATION_STATUS)
        self.assertEqual(
            first["runtime_contract_policy_sha256"],
            self.runtime_contract_policy["policy_sha256"],
        )
        self.assertEqual(
            first["runtime_contract_source_closure_sha256"],
            self.runtime_contract_policy["source_closure"]["source_closure_sha256"],
        )
        self.assertFalse(first["runtime_contract_capability_status"]["execution_authorized"])
        self.assertEqual(
            first["runtime_contract_capability_status"]["runtime_backends"],
            "NOT_IMPLEMENTED",
        )
        self.assertEqual(
            first["runtime_receipt_policy_sha256"],
            self.runtime_receipt_policy["policy_sha256"],
        )
        self.assertEqual(first["receipt_chain_binding"]["internal_node_count"], 18)
        self.assertEqual(first["receipt_chain_binding"]["external_node_count"], 5)
        self.assertEqual(
            first["runtime_receipt_success_output_contract"]["external_anchor_validation_status"],
            "NOT_EVALUATED",
        )
        self.assertEqual(first["runtime_receipt_validation_status"], "NOT_RUN_NO_RECEIPTS")
        self.assertEqual(first["external_anchor_policy_sha256"], self.external_anchor_policy["policy_sha256"])
        self.assertEqual(first["external_anchor_validation_status"], "NOT_RUN_NO_EXTERNAL_EVIDENCE")
        self.assertEqual(
            first["external_anchor_success_output_contract"]["source_observation_status"],
            "SOURCE_CALLER_INJECTED_NOT_ATTESTED",
        )
        self.assertEqual(
            first["owner_completion_policy_sha256"],
            self.owner_completion_policy["policy_sha256"],
        )
        self.assertEqual(
            first["owner_completion_validation_status"],
            "NOT_RUN_NO_OWNER_COMPLETION_LOG",
        )
        self.assertEqual(
            first["owner_completion_success_output_contract"]["runtime_evidence_status"],
            "NOT_ESTABLISHED_BY_PURE_VALIDATION",
        )
        owner_base = ONE_SHOT.owner_completion_base_plan(first)
        external_base = ONE_SHOT.external_anchor_base_plan(first)
        self.assertEqual(
            first["owner_completion_base_plan_sha256"], owner_base["plan_sha256"],
        )
        self.assertEqual(
            first["external_anchor_base_plan_sha256"], external_base["plan_sha256"],
        )
        self.assertEqual(
            owner_base["external_anchor_base_plan_sha256"], external_base["plan_sha256"],
        )
        self.assertEqual(len({
            first["plan_sha256"], owner_base["plan_sha256"], external_base["plan_sha256"],
        }), 3)
        self.assertEqual(first["host_sni_policy_sha256"], self.host_sni_policy["policy_sha256"])
        self.assertEqual(first["host_sni_expectation_validation_status"], "STRUCTURE_VALID")
        self.assertEqual(
            first["host_sni_evidence_intent_v2_validation_status"],
            "NOT_RUN_NO_BASE_EVIDENCE_INTENT",
        )
        expectation = first["caddy_host_sni_expectation"]
        self.assertEqual(expectation["endpoint_binding"]["server_name"], "localhost")
        self.assertEqual(expectation["endpoint_binding"]["tls_server_name"], "localhost")
        self.assertEqual(expectation["endpoint_binding"]["public_origin"], "https://localhost:33443")
        self.assertEqual(len(first["migration_allowlist_entries"]), 46)
        self.assertEqual([item["ordinal"] for item in first["actions"]], list(range(1, 10)))
        self.assertEqual(first["roots"], self.request["roots"])
        self.assertNotIn("staff", ONE_SHOT.canonical_json(first).lower())

    def test_plan_fails_if_source_state_changes_after_policy_validation(self) -> None:
        current = ONE_SHOT.POLICY.source_state()
        changed = copy.deepcopy(current)
        changed["migration_allowlist_sha256"] = "f" * 64
        with mock.patch.object(
            ONE_SHOT.POLICY, "source_state", side_effect=[current, changed],
        ), self.assertRaisesRegex(
            ONE_SHOT.ContractError, "ISOLATED_UAT_SOURCE_STATE_CHANGED_DURING_PLAN",
        ):
            ONE_SHOT.build_plan(self.request, self.policy)

    def test_active_plan_is_accepted_by_external_anchor_contract(self) -> None:
        plan = ONE_SHOT.build_plan(self.request, self.policy)
        base = ONE_SHOT.external_anchor_base_plan(plan)
        self.assertEqual(ONE_SHOT.EXTERNAL_ANCHORS.validate_control_plan(base), base)

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
        self.assertIn("owner_completion_log", actions[6]["outputs"])
        self.assertIn("runtime_privilege_receipt", actions[7]["inputs"])
        self.assertIn("package_version", actions[7]["inputs"])
        self.assertIn("git_commit", actions[7]["inputs"])
        for index in (4, 5):
            self.assertIn("scripts/isolated-uat-one-shot.py", actions[index]["sources"])
            self.assertIn("scripts/isolated-uat-runtime-receipts.py", actions[index]["sources"])
            self.assertIn(
                "operations/isolated-uat-runtime-receipt-policy-v1.json",
                actions[index]["sources"],
            )
        self.assertNotIn("scripts/release-migration-authorization.ts", actions[5]["sources"])

    def test_owner_validator_inputs_pipeline_and_dual_plan_digests_are_explicit(self) -> None:
        owner = self.bindings["owner_completion_contract"]
        arguments = owner["validator_arguments"]
        expected_parameters = set(inspect.signature(
            ONE_SHOT.OWNER_COMPLETION.validate_owner_completion_contracts
        ).parameters)
        self.assertEqual(
            set(arguments["direct"]) | set(arguments["bundled"]),
            expected_parameters,
        )
        action_9 = self.bindings["actions"][8]
        available = set(action_9["inputs"]) | set(action_9["outputs"])
        self.assertTrue(set(arguments["direct"].values()).issubset(available))
        for bundle_name, members in owner["input_bundles"].items():
            self.assertIn(bundle_name, arguments["bundled"])
            self.assertTrue(set(members.values()).issubset(available))
        self.assertEqual(
            [item["validator"] for item in owner["validation_pipeline"]],
            [
                "validate_control_plan",
                "validate_external_anchor_contracts",
                "validate_receipt_chain",
                "validate_owner_completion_contracts",
            ],
        )
        routing = self.bindings["plan_digest_routing"]
        self.assertEqual(
            routing["active_control_plan"]["input_name"], "active_control_plan_sha256",
        )
        self.assertEqual(
            routing["owner_completion_base_plan"]["legacy_input_name"],
            "control_plan_sha256",
        )
        self.assertEqual(
            routing["external_anchor_base_plan"]["legacy_input_name"], "plan_sha256",
        )
        self.assertEqual(
            routing["external_anchor_base_plan"]["receipt_producer_ordinals"],
            list(range(2, 10)),
        )
        self.assertIn("control_plan_sha256", self.bindings["actions"][6]["inputs"])
        self.assertIn(
            "external_anchor_base_plan_sha256", self.bindings["actions"][6]["inputs"],
        )
        self.assertIn("active_control_plan_sha256", self.bindings["actions"][8]["inputs"])
        self.assertIn(
            "owner_completion_base_plan_sha256", self.bindings["actions"][8]["inputs"],
        )

    def test_isolated_evidence_requires_all_runtime_identities(self) -> None:
        actions = self.bindings["actions"]
        self.assertEqual(actions[7]["outputs"], [
            "caddy_container_identity", "web_container_identity", "worker_container_identity",
            "caddy_host_sni_expectation",
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
            "evidence_intent", "container_identity_set", "readiness_receipt",
            "isolated_uat_postdeploy_receipt", "isolated_uat_runtime_identity_receipt",
            "receipt_chain_validation", "owner_completion_validation", "evidence_intent_v2",
            "caddy_host_sni_validation",
        ])
        self.assertIn("owner_completion_log", actions[8]["inputs"])
        self.assertIn("caddy_host_sni_expectation", actions[8]["inputs"])
        self.assertNotIn("scripts/release-identity-contract.mjs", actions[8]["sources"])

    def test_execute_fails_before_any_plan_is_emitted(self) -> None:
        output = io.StringIO()
        errors = io.StringIO()
        original = ONE_SHOT.require_runtime_backend
        ONE_SHOT.require_runtime_backend = lambda: self.fail("runtime backend was called")
        try:
            result = ONE_SHOT.main(
                ["execute", "--policy", str(POLICY_FILE)],
                input_stream=io.BytesIO(ONE_SHOT.canonical_json(self.request).encode("utf-8")),
                output_stream=output,
                error_stream=errors,
            )
        finally:
            ONE_SHOT.require_runtime_backend = original
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

        zero_identity = copy.deepcopy(self.request)
        zero_identity["images"]["web"]["image_reference"] = f"example.invalid/web@sha256:{'0' * 64}"
        with self.assertRaisesRegex(ONE_SHOT.ContractError, "ISOLATED_UAT_REQUEST_IMAGE_INVALID"):
            ONE_SHOT.build_plan(zero_identity, self.policy)

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
        boundary = self.bindings["execution_boundary"]
        self.assertFalse(boundary["shell_allowed"])
        self.assertFalse(boundary["free_form_argv_allowed"])
        self.assertFalse(boundary["runtime_path_implemented"])
        self.assertEqual(
            boundary["extension_mode"],
            "EXACT_V5_INHERITANCE_WITH_ACTION_8_HOST_SNI_EXPECTATION_AND_ACTION_9_EVIDENCE_INTENT_V2_VALIDATION",
        )
        self.assertEqual(boundary["runtime_fact_status"], "NOT_ESTABLISHED_BY_PURE_VALIDATION")
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
        v3_raw = ONE_SHOT.LEGACY_RECEIPT_BINDINGS_PATH.read_bytes()
        self.assertEqual(
            hashlib.sha256(v3_raw).hexdigest(),
            "da69ce3a276ef68f9f6cece12f281ea89584930d481afef19fcf930dae8de5c4",
        )
        owner_raw = ONE_SHOT.OWNER_COMPLETION_BINDINGS_PATH.read_bytes()
        self.assertEqual(
            hashlib.sha256(owner_raw).hexdigest(),
            "95bbf9a263818886072a29f486a53acb752687dcd4d5cd086283336dcbb77363",
        )
        current_raw = ONE_SHOT.ACTIVE_ACTION_BINDINGS_PATH.read_bytes()
        self.assertEqual(
            hashlib.sha256(current_raw).hexdigest(),
            "459bb65d42c71551797bf4cbf56a022700780caeb8a3d987b51bd96560d9f1f0",
        )
        v4_raw = ONE_SHOT.EXTERNAL_ANCHOR_BINDINGS_PATH.read_bytes()
        self.assertEqual(
            hashlib.sha256(v4_raw).hexdigest(),
            "4858b8c14846a69ed969f5476828631362830675399e788f705c35e1cfe34262",
        )
        v2_raw = (SITE_ROOT / "operations/isolated-uat-one-shot-action-bindings-v2.json").read_bytes()
        self.assertEqual(
            hashlib.sha256(v2_raw).hexdigest(),
            "9cc4e3c12793785186fcf74560919376cfa5cc82ef5f344b11fcb5b4501e5232",
        )

    def test_runtime_contract_and_receipt_closures_are_pure_and_binding_v3_is_explicit(self) -> None:
        closure = self.runtime_contract_policy["source_closure"]
        self.assertEqual(closure["roots"], ["scripts/isolated-uat-runtime-contracts.py"])
        self.assertEqual(closure["edges"], [])
        self.assertIn("FILESYSTEM", closure["declared_non_runtime_capabilities"])
        self.assertIn("DOCKER", closure["declared_non_runtime_capabilities"])
        self.assertEqual(
            closure["validation_scope"],
            "SOURCE_HASH_IMPORT_ALLOWLIST_AND_DIRECT_BUILTIN_GUARD_NOT_A_SANDBOX",
        )
        policy_sources = {item["path"] for item in self.policy["source_binding"]}
        self.assertIn("operations/isolated-uat-runtime-contract-policy-v1.json", policy_sources)
        self.assertIn("scripts/isolated-uat-runtime-contracts.py", policy_sources)
        self.assertIn("operations/isolated-uat-owner-completion-policy-v1.json", policy_sources)
        self.assertIn("scripts/isolated-uat-owner-completion-contracts.py", policy_sources)
        self.assertIn("operations/isolated-uat-caddy-host-sni-policy-v1.json", policy_sources)
        self.assertIn("scripts/isolated-uat-caddy-host-sni-contracts.py", policy_sources)
        self.assertIn("operations/isolated-uat-one-shot-action-bindings-v6.json", policy_sources)
        self.assertIn("deploy/Caddyfile", policy_sources)
        self.assertEqual(self.legacy_receipt_bindings["execution_boundary"]["source_binding_scope"], "DIRECT_CONTRACT_REFERENCES_ONLY")
        receipt_closure = self.runtime_receipt_policy["source_closure"]
        self.assertEqual(receipt_closure["roots"], ["scripts/isolated-uat-runtime-receipts.py"])
        self.assertEqual(len(receipt_closure["members"]), 4)
        self.assertIn(
            "operations/isolated-uat-one-shot-action-bindings-v3.json",
            {item["path"] for item in receipt_closure["members"]},
        )
        self.assertEqual(
            self.runtime_receipt_policy["action_binding"]["binding_sha256"],
            self.legacy_receipt_bindings["binding_sha256"],
        )
        self.assertEqual(
            self.runtime_receipt_policy["capability_status"]["external_anchor_validators"],
            "NOT_IMPLEMENTED",
        )

    def test_recomputed_tampered_binding_is_rejected(self) -> None:
        tampered = json.loads(ONE_SHOT.ACTIVE_ACTION_BINDINGS_PATH.read_text(encoding="utf-8"))
        tampered["source_extensions"][0]["ordinal"] = 7
        body = {key: value for key, value in tampered.items() if key != "binding_sha256"}
        tampered["binding_sha256"] = POLICY.canonical_sha256(body)
        with tempfile.TemporaryDirectory(prefix="cyd-uat-action-binding-test.") as directory:
            path = Path(directory) / "bindings.json"
            path.write_text(ONE_SHOT.canonical_json(tampered), encoding="utf-8")
            with self.assertRaisesRegex(ONE_SHOT.ContractError, "ISOLATED_UAT_ACTION_BINDING_(IDENTITY|SHA256)_INVALID"):
                ONE_SHOT.read_bindings(path)


if __name__ == "__main__":
    unittest.main(verbosity=2)
