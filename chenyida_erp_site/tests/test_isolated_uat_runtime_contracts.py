#!/usr/bin/python3
"""Pure tests for isolated UAT intent, receipt-shape, and synthetic-port contracts."""

from __future__ import annotations

import copy
import importlib.util
import json
import unittest
from pathlib import Path


SITE_ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = SITE_ROOT / "scripts/isolated-uat-runtime-contracts.py"
POLICY_PATH = SITE_ROOT / "operations/isolated-uat-runtime-contract-policy-v1.json"
SPEC = importlib.util.spec_from_file_location("isolated_uat_runtime_contracts", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("isolated UAT runtime contracts cannot be loaded")
CONTRACTS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTRACTS)


def load_policy() -> dict:
    policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    return CONTRACTS.validate_policy(
        policy,
        {"scripts/isolated-uat-runtime-contracts.py": MODULE_PATH.read_bytes()},
    )


def common(policy: dict) -> dict:
    return {
        "operation_id": "uat-runtime-contract-fixture-001",
        "request_id": "uat-one-shot-request-001",
        "project": "chenyida-erp-uat-runtime-contract-test",
        "plan_sha256": "a" * 64,
        "runtime_contract_policy_sha256": policy["policy_sha256"],
        "source_closure_sha256": policy["source_closure"]["source_closure_sha256"],
    }


def inputs(policy: dict) -> dict:
    shared = common(policy)
    project = shared["project"]
    roles = [
        {"role": role, "credential_file": filename}
        for role, filename in (
            ("chenyida_erp_admin", "admin-database-password"),
            ("chenyida_erp_backup", "backup-capture-service.conf"),
            ("chenyida_erp_owner", "migration-database-password"),
            ("chenyida_erp_web", "web-database-password"),
            ("chenyida_erp_worker", "worker-database-password"),
        )
    ]
    images = {
        "web": {
            "image_reference": f"example.invalid/erp-web@sha256:{'4' * 64}",
            "config_digest": f"sha256:{'5' * 64}",
        },
        "worker": {
            "image_reference": f"example.invalid/erp-worker@sha256:{'6' * 64}",
            "config_digest": f"sha256:{'7' * 64}",
        },
    }
    return {
        "DATABASE_BOOTSTRAP": {
            **shared,
            "database_cluster_identity": {
                "project": project,
                "postgres_container_identity_sha256": "1" * 64,
                "system_identifier": "7391051976607354401",
            },
            "credential_generation_receipt_sha256": "2" * 64,
            "database_target_expectation": {
                "deployment_class": "UAT",
                "deployment_id": project,
                "name": "chenyida_erp",
                "marker": f"chenyida-erp-deployment/v2:UAT:{project}",
                "owner": "chenyida_erp_owner",
                "current_head": "EMPTY",
            },
            "login_role_expectations": roles,
        },
        "MIGRATION": {
            **shared,
            "database_bootstrap_receipt_sha256": "8" * 64,
            "database_target_identity_sha256": "9" * 64,
            "release_source": {
                "package_version": "0.1.0-alpha.47",
                "git_commit": "a" * 40,
                "git_tree": "b" * 40,
                "images": images,
                "resolved_compose_sha256": "c" * 64,
            },
            "migration": {
                "from_head": "EMPTY",
                "to_head": policy["invariants"]["migration_target_head"],
                "count": policy["invariants"]["migration_count"],
                "allowlist_sha256": policy["invariants"]["migration_allowlist_sha256"],
            },
            "release_candidate_root_identity_sha256": "e" * 64,
        },
        "EVIDENCE": {
            **shared,
            "release_candidate_receipt_sha256": "f" * 64,
            "migration_execution_receipt_sha256": "1" * 64,
            "runtime_privilege_receipt_sha256": "2" * 64,
            "runtime_source": {
                "package_version": "0.1.0-alpha.47",
                "git_commit": "a" * 40,
                "git_tree": "b" * 40,
                "migration_head": policy["invariants"]["migration_target_head"],
                "migration_allowlist_sha256": policy["invariants"]["migration_allowlist_sha256"],
                "resolved_compose_sha256": "c" * 64,
            },
            "containers": {
                "postgres": {
                    "project": project,
                    "container_id": "postgres-container-001",
                    "image_reference": f"postgres@sha256:{'3' * 64}",
                    "image_config_digest": f"sha256:{'3' * 64}",
                },
                "caddy": {
                    "project": project,
                    "container_id": "caddy-container-001",
                    "image_reference": f"caddy@sha256:{'4' * 64}",
                    "image_config_digest": f"sha256:{'4' * 64}",
                },
                "web": {
                    "project": project,
                    "container_id": "web-container-001",
                    "image_reference": images["web"]["image_reference"],
                    "image_config_digest": images["web"]["config_digest"],
                },
                "worker": {
                    "project": project,
                    "container_id": "worker-container-001",
                    "image_reference": images["worker"]["image_reference"],
                    "image_config_digest": images["worker"]["config_digest"],
                },
            },
            "loopback": {"host": "127.0.0.1", "web": 33001, "caddy_http": 33080, "caddy_https": 33443},
            "release_identity_reader_gid": 65532,
            "one_shot_state_root_identity_sha256": "7" * 64,
        },
    }


class RecordingSyntheticPort:
    def __init__(
        self,
        policy: dict,
        fail_at: int | None = None,
        malformed_at: int | None = None,
        mutate_at: int | None = None,
    ) -> None:
        self.policy = policy
        self.fail_at = fail_at
        self.malformed_at = malformed_at
        self.mutate_at = mutate_at
        self.calls: list[str] = []

    def _call(self, family: str, intent: dict) -> dict:
        self.calls.append(family)
        if self.fail_at == len(self.calls):
            raise CONTRACTS.ContractError("SYNTHETIC_PORT_FAILURE")
        if self.mutate_at == len(self.calls):
            intent["operation_id"] = "uat-runtime-contract-fixture-mutated"
            intent_body = {key: value for key, value in intent.items() if key != "intent_sha256"}
            intent["intent_sha256"] = CONTRACTS.canonical_sha256(intent_body)
        bundle = CONTRACTS.build_synthetic_shape_bundle(family, intent, self.policy)
        if self.malformed_at == len(self.calls):
            shape = bundle["shapes"][0]
            shape["required_fields"].append("undeclared_runtime_claim")
            shape_body = {key: value for key, value in shape.items() if key != "shape_sha256"}
            shape["shape_sha256"] = CONTRACTS.canonical_sha256(shape_body)
            bundle_body = {key: value for key, value in bundle.items() if key != "bundle_sha256"}
            bundle["bundle_sha256"] = CONTRACTS.canonical_sha256(bundle_body)
        return bundle

    def validate_database_bootstrap_shapes(self, intent: dict) -> dict:
        return self._call("DATABASE_BOOTSTRAP", intent)

    def validate_migration_shapes(self, intent: dict) -> dict:
        return self._call("MIGRATION", intent)

    def validate_evidence_shapes(self, intent: dict) -> dict:
        return self._call("EVIDENCE", intent)


class IsolatedUatRuntimeContractsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.policy = load_policy()
        cls.inputs = inputs(cls.policy)

    def test_policy_is_fixed_import_allowlist_and_not_authorized(self) -> None:
        self.assertFalse(self.policy["execution_authorized"])
        self.assertEqual(self.policy["capability_status"], CONTRACTS.CAPABILITY_STATUS)
        self.assertEqual(self.policy["capability_status"]["receipt_validators"], "NOT_IMPLEMENTED")
        self.assertNotIn("receipt_shape_validators", self.policy["capability_status"])
        self.assertEqual(self.policy["source_closure"]["members"], [{
            "path": "scripts/isolated-uat-runtime-contracts.py",
            "sha256": self.policy["source_closure"]["members"][0]["sha256"],
        }])
        self.assertEqual(self.policy["source_closure"]["edges"], [])
        self.assertIn("DATABASE", self.policy["source_closure"]["declared_non_runtime_capabilities"])
        self.assertEqual(
            self.policy["source_closure"]["validation_scope"],
            "SOURCE_HASH_IMPORT_ALLOWLIST_AND_DIRECT_BUILTIN_GUARD_NOT_A_SANDBOX",
        )
        serialized = CONTRACTS.canonical_json(self.policy).lower()
        self.assertNotIn('"pass"', serialized)
        self.assertNotIn("succeeded", serialized)
        self.assertNotIn("staff_count", serialized)

    def test_three_intents_and_receipt_shapes_are_deterministic_contract_only(self) -> None:
        for family in CONTRACTS.FAMILY_ORDER:
            with self.subTest(family=family):
                first = CONTRACTS.build_intent(family, self.inputs[family], self.policy)
                second = CONTRACTS.build_intent(family, copy.deepcopy(self.inputs[family]), self.policy)
                self.assertEqual(first, second)
                self.assertEqual(CONTRACTS.validate_intent(family, first, self.policy), first)
                self.assertEqual(first["execution_status"], "NOT_EXECUTED")
                self.assertEqual(first["publication_status"], "NOT_PUBLISHED")
                self.assertEqual(first["runtime_evidence_status"], "NOT_AVAILABLE")
                self.assertEqual(first["contract_validation_status"], "STRUCTURE_VALID")
                self.assertEqual(first["predecessor_chain_status"], "NOT_VALIDATED")
                bundle = CONTRACTS.build_synthetic_shape_bundle(family, first, self.policy)
                self.assertEqual(
                    [shape["output"] for shape in bundle["shapes"]],
                    [shape["output"] for shape in CONTRACTS.FAMILY_SPECS[family]["receipt_shapes"]],
                )
                self.assertTrue(all(shape["fixture_scope"] == CONTRACTS.SYNTHETIC_FIXTURE_SCOPE for shape in bundle["shapes"]))
        database = CONTRACTS.build_intent("DATABASE_BOOTSTRAP", self.inputs["DATABASE_BOOTSTRAP"], self.policy)
        migration = CONTRACTS.build_intent("MIGRATION", self.inputs["MIGRATION"], self.policy)
        evidence = CONTRACTS.build_intent("EVIDENCE", self.inputs["EVIDENCE"], self.policy)
        self.assertEqual(database["full_schema_acl_status"], "DEFERRED_UNTIL_POST_MIGRATION")
        self.assertEqual(migration["release_candidate_spec_status"], "SPECIFIED_NOT_PUBLISHED")
        self.assertEqual(evidence["identity_semantics"], "ISOLATED_UAT_ONLY")
        self.assertFalse(evidence["production_release_identity_compatible"])

        mutable = copy.deepcopy(self.inputs["DATABASE_BOOTSTRAP"])
        frozen = CONTRACTS.build_intent("DATABASE_BOOTSTRAP", mutable, self.policy)
        mutable["database_target_expectation"]["name"] = "tampered_after_build"
        self.assertEqual(frozen["database_target_expectation"]["name"], "chenyida_erp")
        self.assertEqual(CONTRACTS.validate_intent("DATABASE_BOOTSTRAP", frozen, self.policy), frozen)

    def test_synthetic_adapter_uses_only_three_typed_ports(self) -> None:
        port = RecordingSyntheticPort(self.policy)
        result = CONTRACTS.run_synthetic_adapter(self.inputs, port, self.policy)
        self.assertEqual(port.calls, CONTRACTS.FAMILY_ORDER)
        self.assertEqual(result["port_methods"], CONTRACTS.PORT_METHODS)
        self.assertEqual(result["fixture_scope"], "SYNTHETIC_CONTRACT_FIXTURE_ONLY")
        self.assertEqual(result["execution_status"], "NOT_EXECUTED")
        self.assertEqual(result["runtime_evidence_status"], "NOT_AVAILABLE")
        self.assertEqual(result["predecessor_chain_status"], "NOT_VALIDATED")

    def test_synthetic_adapter_stops_at_first_failure(self) -> None:
        for fail_at in (1, 2, 3):
            with self.subTest(fail_at=fail_at):
                port = RecordingSyntheticPort(self.policy, fail_at=fail_at)
                with self.assertRaisesRegex(CONTRACTS.ContractError, "SYNTHETIC_PORT_FAILURE"):
                    CONTRACTS.run_synthetic_adapter(self.inputs, port, self.policy)
                self.assertEqual(port.calls, CONTRACTS.FAMILY_ORDER[:fail_at])

                malformed = RecordingSyntheticPort(self.policy, malformed_at=fail_at)
                with self.assertRaisesRegex(CONTRACTS.ContractError, "ISOLATED_UAT_RUNTIME_CONTRACT_FIELDS_INVALID"):
                    CONTRACTS.run_synthetic_adapter(self.inputs, malformed, self.policy)
                self.assertEqual(malformed.calls, CONTRACTS.FAMILY_ORDER[:fail_at])

                mutated = RecordingSyntheticPort(self.policy, mutate_at=fail_at)
                original_inputs = copy.deepcopy(self.inputs)
                with self.assertRaises(CONTRACTS.ContractError):
                    CONTRACTS.run_synthetic_adapter(self.inputs, mutated, self.policy)
                self.assertEqual(mutated.calls, CONTRACTS.FAMILY_ORDER[:fail_at])
                self.assertEqual(self.inputs, original_inputs)

        inconsistent = copy.deepcopy(self.inputs)
        inconsistent["EVIDENCE"]["runtime_source"]["git_commit"] = "f" * 40
        port = RecordingSyntheticPort(self.policy)
        with self.assertRaisesRegex(CONTRACTS.ContractError, "ISOLATED_UAT_EVIDENCE_PREDECESSOR_MISMATCH"):
            CONTRACTS.run_synthetic_adapter(inconsistent, port, self.policy)
        self.assertEqual(port.calls, [])

    def test_contract_and_shape_tampering_fail_closed(self) -> None:
        cases = []
        database = copy.deepcopy(self.inputs["DATABASE_BOOTSTRAP"])
        database["database_target_expectation"]["current_head"] = "0046_runtime_lock_privilege_boundary.sql"
        cases.append(("DATABASE_BOOTSTRAP", database, "ISOLATED_UAT_DATABASE_BOOTSTRAP_INTENT_INVALID"))
        migration = copy.deepcopy(self.inputs["MIGRATION"])
        migration["migration"]["from_head"] = "0045_runtime_worker_readiness.sql"
        cases.append(("MIGRATION", migration, "ISOLATED_UAT_MIGRATION_INTENT_INVALID"))
        evidence = copy.deepcopy(self.inputs["EVIDENCE"])
        evidence["loopback"]["host"] = "0.0.0.0"
        cases.append(("EVIDENCE", evidence, "ISOLATED_UAT_EVIDENCE_INTENT_INVALID"))
        roles = copy.deepcopy(self.inputs["DATABASE_BOOTSTRAP"])
        roles["login_role_expectations"][4]["credential_file"] = "admin-database-password"
        cases.append(("DATABASE_BOOTSTRAP", roles, "ISOLATED_UAT_DATABASE_BOOTSTRAP_INTENT_INVALID"))
        zero = copy.deepcopy(self.inputs["MIGRATION"])
        zero["plan_sha256"] = "0" * 64
        cases.append(("MIGRATION", zero, "ISOLATED_UAT_MIGRATION_INTENT_INVALID"))
        for family, value, code in cases:
            with self.subTest(family=family), self.assertRaisesRegex(CONTRACTS.ContractError, code):
                CONTRACTS.build_intent(family, value, self.policy)

        intent = CONTRACTS.build_intent("EVIDENCE", self.inputs["EVIDENCE"], self.policy)
        specs_before = CONTRACTS.canonical_json(CONTRACTS.FAMILY_SPECS)
        bundle = CONTRACTS.build_synthetic_shape_bundle("EVIDENCE", intent, self.policy)
        bundle["shapes"][2]["required_fields"].append("production_runtime_policy_sha256")
        shape = bundle["shapes"][2]
        shape_body = {key: value for key, value in shape.items() if key != "shape_sha256"}
        shape["shape_sha256"] = CONTRACTS.canonical_sha256(shape_body)
        bundle_body = {key: value for key, value in bundle.items() if key != "bundle_sha256"}
        bundle["bundle_sha256"] = CONTRACTS.canonical_sha256(bundle_body)
        with self.assertRaisesRegex(CONTRACTS.ContractError, "ISOLATED_UAT_RUNTIME_CONTRACT_FIELDS_INVALID"):
            CONTRACTS.validate_synthetic_shape_bundle("EVIDENCE", bundle, intent, self.policy)
        self.assertEqual(CONTRACTS.canonical_json(CONTRACTS.FAMILY_SPECS), specs_before)

    def test_source_closure_rejects_stale_or_import_expansion(self) -> None:
        closure = copy.deepcopy(self.policy["source_closure"])
        sources = {"scripts/isolated-uat-runtime-contracts.py": MODULE_PATH.read_bytes()}
        stale = copy.deepcopy(closure)
        stale["members"][0]["sha256"] = "1" * 64
        stale_body = {key: value for key, value in stale.items() if key != "source_closure_sha256"}
        stale["source_closure_sha256"] = CONTRACTS.canonical_sha256(stale_body)
        with self.assertRaisesRegex(CONTRACTS.ContractError, "ISOLATED_UAT_RUNTIME_CONTRACT_SOURCE_CLOSURE_INVALID"):
            CONTRACTS.validate_source_closure(stale, sources)

        expanded_raw = sources["scripts/isolated-uat-runtime-contracts.py"] + b"\nimport subprocess\n"
        expanded = copy.deepcopy(closure)
        expanded["members"][0]["sha256"] = __import__("hashlib").sha256(expanded_raw).hexdigest()
        expanded["external_imports"] = sorted([*expanded["external_imports"], "subprocess"])
        expanded_body = {key: value for key, value in expanded.items() if key != "source_closure_sha256"}
        expanded["source_closure_sha256"] = CONTRACTS.canonical_sha256(expanded_body)
        with self.assertRaisesRegex(CONTRACTS.ContractError, "ISOLATED_UAT_RUNTIME_CONTRACT_SOURCE_CLOSURE_INVALID"):
            CONTRACTS.validate_source_closure(
                expanded,
                {"scripts/isolated-uat-runtime-contracts.py": expanded_raw},
            )

    def test_runtime_backend_is_explicitly_unimplemented(self) -> None:
        with self.assertRaisesRegex(CONTRACTS.ContractError, "ISOLATED_UAT_RUNTIME_BACKEND_NOT_IMPLEMENTED"):
            CONTRACTS.require_runtime_backend()


if __name__ == "__main__":
    unittest.main(verbosity=2)
