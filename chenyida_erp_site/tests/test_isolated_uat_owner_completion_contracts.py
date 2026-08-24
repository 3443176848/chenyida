#!/usr/bin/python3
"""Pure tests for the isolated-UAT owner completion outer contract."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import unittest
from pathlib import Path


SITE_ROOT = Path(__file__).resolve().parent.parent
OWNER_MODULE_PATH = SITE_ROOT / "scripts/isolated-uat-owner-completion-contracts.py"
OWNER_POLICY_PATH = SITE_ROOT / "operations/isolated-uat-owner-completion-policy-v1.json"
EXTERNAL_TEST_PATH = SITE_ROOT / "tests/test_isolated_uat_external_anchor_contracts.py"
RUNTIME_TEST_PATH = SITE_ROOT / "tests/test_isolated_uat_runtime_receipts.py"
INTENT_POLICY_PATH = SITE_ROOT / "operations/isolated-uat-runtime-contract-policy-v1.json"
RECEIPT_POLICY_PATH = SITE_ROOT / "operations/isolated-uat-runtime-receipt-policy-v1.json"
BINDING_PATH = SITE_ROOT / "operations/isolated-uat-one-shot-action-bindings-v3.json"
PRIVILEGE_POLICY_PATH = SITE_ROOT / "operations/postgresql-runtime-privilege-policy-v2.json"


def load_module(name: str, path: Path):
    specification = importlib.util.spec_from_file_location(name, path)
    if specification is None or specification.loader is None:
        raise RuntimeError(f"{name} cannot be loaded")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


OWNER = load_module("isolated_uat_owner_completion_test", OWNER_MODULE_PATH)
EXTERNAL_TEST = load_module("isolated_uat_external_fixture_dependency", EXTERNAL_TEST_PATH)
RUNTIME_TEST = load_module("isolated_uat_runtime_fixture_dependency", RUNTIME_TEST_PATH)


def hashed(body: dict, field: str) -> dict:
    return {**body, field: OWNER.canonical_sha256(body)}


def rehash(value: dict, field: str) -> None:
    value[field] = OWNER.canonical_sha256({
        key: item for key, item in value.items() if key != field
    })


def promote_plan(base: dict, policy: dict) -> dict:
    body = {key: copy.deepcopy(item) for key, item in base.items() if key != "plan_sha256"}
    body.update({
        "schema_version": 5,
        "contract": OWNER.PLAN_CONTRACT,
        "entrypoint_id": OWNER.PLAN_ENTRYPOINT,
        "action_binding_id": OWNER.ACTION_BINDING_ID,
        "action_binding_sha256": OWNER.ACTION_BINDING_SHA256,
        "action_binding_status": OWNER.ACTION_BINDING_STATUS,
        "owner_completion_policy_sha256": policy["policy_sha256"],
        "owner_completion_source_closure_sha256": policy["source_closure"][
            "source_closure_sha256"
        ],
        "owner_completion_capability_status": copy.deepcopy(policy["capability_status"]),
        "owner_completion_validation_status": "NOT_RUN_NO_OWNER_COMPLETION_LOG",
        "owner_completion_success_output_contract": copy.deepcopy(
            policy["validation_output"]
        ),
        "owner_completion_binding": copy.deepcopy(OWNER.OWNER_PLAN_BINDING),
        "external_anchor_base_plan_sha256": base["plan_sha256"],
    })
    return hashed(body, "plan_sha256")


def retime_external(value: dict) -> None:
    namespace = value["namespace_root_receipt"]
    credentials = value["credential_generation_receipt"]
    container = value["postgres_container_identity"]
    cluster = value["database_cluster_identity"]
    namespace["observed_at"] = "2026-08-24T09:50:00.000Z"
    rehash(namespace, "receipt_sha256")
    credentials["namespace_root_receipt_sha256"] = namespace["receipt_sha256"]
    credentials["observed_at"] = "2026-08-24T09:51:00.000Z"
    rehash(credentials, "receipt_sha256")
    container["credential_generation_receipt_sha256"] = credentials["receipt_sha256"]
    container["observed_at"] = "2026-08-24T09:52:00.000Z"
    rehash(container, "identity_sha256")
    cluster["credential_generation_receipt_sha256"] = credentials["receipt_sha256"]
    cluster["postgres_container_identity_sha256"] = container["identity_sha256"]
    cluster["identity"] = {
        "project": cluster["project"],
        "postgres_container_identity_sha256": container["identity_sha256"],
        "system_identifier": cluster["system_identifier"],
    }
    cluster["identity_sha256"] = OWNER.canonical_sha256(cluster["identity"])
    cluster["observed_at"] = "2026-08-24T09:53:00.000Z"
    rehash(cluster, "receipt_sha256")


def policy_sources(policy: dict) -> dict[str, bytes]:
    return {
        item["path"]: (SITE_ROOT / item["path"]).read_bytes()
        for item in policy["source_closure"]["members"]
    }


def build_owner_log(
    plan: dict,
    base: dict,
    external: dict,
    runtime_fixture: dict,
    runtime_validation: dict,
) -> dict:
    namespace = external["namespace_root_receipt"]
    credentials = external["credential_generation_receipt"]
    container = external["postgres_container_identity"]
    cluster = external["database_cluster_identity"]
    target = runtime_fixture["receipts"]["database_target_identity"]
    migration = runtime_fixture["receipts"]["migration_execution_receipt"]
    runtime_intent = runtime_fixture["intents"]["RUNTIME_PRIVILEGE"]
    observation = runtime_fixture["evidence_payloads"]["runtime_privilege_observation"]
    runtime_receipt = runtime_fixture["receipts"]["runtime_privilege_receipt"]
    operator_root = next(item for item in namespace["roots"] if item["name"] == "operator_state_root")
    desired_projection = {
        "contract": "chenyida-erp-isolated-uat-owner-desired-privilege-projection/v1",
        "project": runtime_intent["project"],
        "database_target_identity_sha256": runtime_intent[
            "database_target_identity_sha256"
        ],
        "migration_execution_receipt_sha256": runtime_intent[
            "migration_execution_receipt_sha256"
        ],
        "runtime_privilege_policy_sha256": runtime_intent[
            "runtime_privilege_policy_sha256"
        ],
        "target_head": runtime_intent["target_head"],
        "technical_login_roles": runtime_intent["technical_login_roles"],
        "required_acl_status": "MATCHED_BOUND_POLICY",
    }
    desired_state_sha256 = OWNER.canonical_sha256(desired_projection)
    intent_body = {
        "schema_version": 1,
        "contract": OWNER.INTENT_CONTRACT,
        "operation_id": runtime_validation["operation_id"],
        "request_id": base["request_id"],
        "project": base["project"],
        "control_plan_sha256": plan["plan_sha256"],
        "external_anchor_base_plan_sha256": base["plan_sha256"],
        "runtime_privilege_intent_sha256": runtime_intent["intent_sha256"],
        "database_target_identity_sha256": target["identity_sha256"],
        "migration_execution_receipt_sha256": migration["receipt_sha256"],
        "runtime_privilege_policy_sha256": runtime_intent[
            "runtime_privilege_policy_sha256"
        ],
        "namespace_root_receipt_sha256": namespace["receipt_sha256"],
        "operator_state_root_identity_sha256": operator_root["identity"][
            "identity_sha256"
        ],
        "credential_generation_receipt_sha256": credentials["receipt_sha256"],
        "credential_generation_id": credentials["generation_id"],
        "postgres_container_identity_sha256": container["identity_sha256"],
        "postgres_container_id": container["container_id"],
        "database_cluster_identity_sha256": cluster["identity_sha256"],
        "database_cluster_receipt_sha256": cluster["receipt_sha256"],
        "target": {
            "database_name": target["database_name"],
            "database_oid": target["database_oid"],
            "system_identifier": target["system_identifier"],
            "marker": target["marker"],
            "owner": target["owner"],
        },
        "target_head": runtime_intent["target_head"],
        "technical_login_roles": runtime_intent["technical_login_roles"],
        "operation": "RECONCILE",
        "runtime_guard_mode": "ISOLATED_UAT_POST_MIGRATION_PRE_RUNTIME_BOUND",
        "desired_state_sha256": desired_state_sha256,
        "owner_reconciliation_projection_sha256": "",
        "created_at": "2026-08-24T10:04:01.000Z",
    }
    reconciliation_projection = {
        "contract": "chenyida-erp-isolated-uat-owner-reconciliation-projection/v1",
        "runtime_privilege_intent_sha256": intent_body[
            "runtime_privilege_intent_sha256"
        ],
        "database_target_identity_sha256": intent_body[
            "database_target_identity_sha256"
        ],
        "migration_execution_receipt_sha256": intent_body[
            "migration_execution_receipt_sha256"
        ],
        "runtime_privilege_policy_sha256": intent_body[
            "runtime_privilege_policy_sha256"
        ],
        "target_head": intent_body["target_head"],
        "technical_login_roles": intent_body["technical_login_roles"],
        "desired_state_sha256": desired_state_sha256,
    }
    intent_body["owner_reconciliation_projection_sha256"] = OWNER.canonical_sha256(
        reconciliation_projection
    )
    intent = hashed(intent_body, "intent_sha256")
    state_times = [
        "2026-08-24T10:04:05.000Z",
        "2026-08-24T10:04:10.000Z",
        "2026-08-24T10:04:15.000Z",
        "2026-08-24T10:05:05.000Z",
        "2026-08-24T10:05:10.000Z",
        "2026-08-24T10:06:05.000Z",
    ]
    states = []
    previous = None
    for sequence, (phase, recorded_at) in enumerate(zip(OWNER.SUCCESS_PHASES, state_times)):
        state = hashed({
            "schema_version": 1,
            "contract": OWNER.STATE_CONTRACT,
            "operation_id": intent["operation_id"],
            "intent_sha256": intent["intent_sha256"],
            "sequence": sequence,
            "phase": phase,
            "observation_state_sha256": desired_state_sha256 if sequence >= 3 else None,
            "previous_state_sha256": previous,
            "recorded_at": recorded_at,
        }, "state_sha256")
        states.append(state)
        previous = state["state_sha256"]
    credential_projection = {
        "contract": "chenyida-erp-isolated-uat-owner-credential-metadata-continuity/v1",
        "credential_generation_receipt_sha256": credentials["receipt_sha256"],
        "credential_generation_id": credentials["generation_id"],
        "technical_login_roles": runtime_intent["technical_login_roles"],
        "observed_login_roles_sha256": runtime_receipt[
            "observed_login_roles_sha256"
        ],
    }
    owner_receipt = hashed({
        "schema_version": 1,
        "contract": OWNER.RECEIPT_CONTRACT,
        "operation_id": intent["operation_id"],
        "operation": "RECONCILE",
        "intent_sha256": intent["intent_sha256"],
        "final_state_sha256": states[-1]["state_sha256"],
        "owner_reconciliation_projection_sha256": intent[
            "owner_reconciliation_projection_sha256"
        ],
        "runtime_privilege_observation_sha256": observation["evidence_sha256"],
        "runtime_privilege_receipt_sha256": runtime_receipt["receipt_sha256"],
        "desired_state_sha256": desired_state_sha256,
        "final_privilege_projection_sha256": desired_state_sha256,
        "credential_metadata_continuity_sha256": OWNER.canonical_sha256(
            credential_projection
        ),
        "completed_at": "2026-08-24T10:06:10.000Z",
        "result": "VERIFIED",
    }, "receipt_sha256")
    log_body = {
        "schema_version": 1,
        "contract": OWNER.LOG_CONTRACT,
        "producer": {
            "action_ordinal": 7,
            "handler_id": "POSTGRESQL_RUNTIME_PRIVILEGE_PRIMITIVES",
            "adapter_method": "reconcile_final_runtime_privileges",
        },
        "operation_id": intent["operation_id"],
        "request_id": base["request_id"],
        "project": base["project"],
        "control_plan_sha256": plan["plan_sha256"],
        "external_anchor_base_plan_sha256": base["plan_sha256"],
        "operator_state_root": {
            "path": operator_root["path"],
            "namespace_root_receipt_sha256": namespace["receipt_sha256"],
            "prepared_identity_sha256": operator_root["identity"]["identity_sha256"],
            "completed_identity_sha256": operator_root["identity"]["identity_sha256"],
        },
        "journal": {
            "profile": "ISOLATED_UAT_CONTRACT_ONLY",
            "root_marker": OWNER.ROOT_MARKER,
            "intent_marker": OWNER.INTENT_MARKER,
            "location": "COMPLETED",
            "operation_directory": f"{intent['operation_id']}.{intent['intent_sha256']}",
            "receipt_index": (
                f"{intent['operation_id']}.{owner_receipt['receipt_sha256']}.json"
            ),
            "archive_status": "ACTIVE_RENAMED_TO_COMPLETED_RECEIPT_INDEX_MATCHED",
        },
        "owner_intent": intent,
        "states": states,
        "recovery_authorizations": [],
        "owner_receipt": owner_receipt,
        "terminal": {
            "location": "COMPLETED",
            "phase": "COMMITTED",
            "state_sha256": states[-1]["state_sha256"],
            "receipt_sha256": owner_receipt["receipt_sha256"],
            "completed_at": owner_receipt["completed_at"],
            "result": "VERIFIED",
        },
    }
    return hashed(log_body, "log_sha256")


def fixture() -> dict:
    owner_policy = json.loads(OWNER_POLICY_PATH.read_text(encoding="utf-8"))
    owner_sources = policy_sources(owner_policy)
    OWNER.validate_policy(owner_policy, owner_sources)
    external = EXTERNAL_TEST.fixture()
    retime_external(external)
    base = external["control_plan"]
    plan = promote_plan(base, owner_policy)
    external_result = EXTERNAL_TEST.MODULE.validate_external_anchor_contracts(
        control_plan=base,
        namespace_root_receipt=external["namespace_root_receipt"],
        credential_generation_receipt=external["credential_generation_receipt"],
        postgres_container_identity=external["postgres_container_identity"],
        database_cluster_identity=external["database_cluster_identity"],
        policy=external["policy"],
    )
    intent_policy = json.loads(INTENT_POLICY_PATH.read_text(encoding="utf-8"))
    receipt_policy = json.loads(RECEIPT_POLICY_PATH.read_text(encoding="utf-8"))
    receipt_policy_raw = RECEIPT_POLICY_PATH.read_bytes()
    binding = json.loads(BINDING_PATH.read_text(encoding="utf-8"))
    runtime_sources = {
        "operations/isolated-uat-runtime-contract-policy-v1.json": INTENT_POLICY_PATH.read_bytes(),
        "operations/postgresql-runtime-privilege-policy-v2.json": PRIVILEGE_POLICY_PATH.read_bytes(),
        "operations/isolated-uat-one-shot-action-bindings-v3.json": BINDING_PATH.read_bytes(),
        "scripts/isolated-uat-runtime-receipts.py": (
            SITE_ROOT / "scripts/isolated-uat-runtime-receipts.py"
        ).read_bytes(),
    }
    expected_roots = {
        "intent_policy_sha256": intent_policy["policy_sha256"],
        "intent_policy_file_sha256": hashlib.sha256(INTENT_POLICY_PATH.read_bytes()).hexdigest(),
        "receipt_policy_sha256": receipt_policy["policy_sha256"],
        "receipt_policy_file_sha256": hashlib.sha256(receipt_policy_raw).hexdigest(),
    }
    external_anchors = {
        "credential_generation_receipt_sha256": external[
            "credential_generation_receipt"
        ]["receipt_sha256"],
        "release_candidate_root_identity_sha256": external[
            "namespace_root_receipt"
        ]["release_candidate_root_identity_sha256"],
        "one_shot_state_root_identity_sha256": external[
            "namespace_root_receipt"
        ]["one_shot_state_root_identity_sha256"],
    }
    runtime_fixture = RUNTIME_TEST.build_fixture(
        intent_policy,
        receipt_policy,
        binding,
        project=base["project"],
        request_id=base["request_id"],
        plan_sha256=base["plan_sha256"],
        external_anchors=external_anchors,
        postgres_container_identity_sha256=external["postgres_container_identity"][
            "identity_sha256"
        ],
        system_identifier=external["database_cluster_identity"]["system_identifier"],
    )
    runtime_result = RUNTIME_TEST.RECEIPTS.validate_receipt_chain(
        **runtime_fixture,
        binding=binding,
        verification_time="2026-08-24T10:10:00.000Z",
        intent_policy=intent_policy,
        receipt_policy=receipt_policy,
        receipt_policy_raw=receipt_policy_raw,
        expected_policy_roots=expected_roots,
        policy_sources=runtime_sources,
    )
    if runtime_result["external_digest_anchors"] != external_result[
        "external_digest_anchors"
    ]:
        raise AssertionError("fixture external anchors are not joined")
    owner_log = build_owner_log(plan, base, external, runtime_fixture, runtime_result)
    return {
        "control_plan": plan,
        "external_anchor_base_plan": base,
        "namespace_root_receipt": external["namespace_root_receipt"],
        "credential_generation_receipt": external["credential_generation_receipt"],
        "postgres_container_identity": external["postgres_container_identity"],
        "database_cluster_identity": external["database_cluster_identity"],
        "external_anchor_policy": external["policy"],
        "runtime_intents": runtime_fixture["intents"],
        "runtime_receipts": runtime_fixture["receipts"],
        "runtime_evidence_payloads": runtime_fixture["evidence_payloads"],
        "expected_migration_allowlist": runtime_fixture["expected_migration_allowlist"],
        "runtime_receipt_binding": binding,
        "verification_time": "2026-08-24T10:10:00.000Z",
        "runtime_intent_policy": intent_policy,
        "runtime_receipt_policy": receipt_policy,
        "runtime_receipt_policy_raw": receipt_policy_raw,
        "expected_runtime_policy_roots": expected_roots,
        "runtime_policy_sources": runtime_sources,
        "owner_completion_log": owner_log,
        "policy": owner_policy,
        "policy_sources": owner_sources,
    }


class IsolatedUatOwnerCompletionContractsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = fixture()

    def validate(self, value: dict | None = None):
        return OWNER.validate_owner_completion_contracts(**(value or self.fixture))

    def test_valid_join_is_deterministic_and_never_claims_runtime_truth(self) -> None:
        first = self.validate()
        second = self.validate(copy.deepcopy(self.fixture))
        self.assertEqual(first, second)
        self.assertEqual(first["owner_completion_contract_status"], "PURE_OWNER_COMPLETION_CONTRACT_VALID")
        self.assertEqual(first["journal_success_chain_status"], "PURE_SUCCESS_CHAIN_VALID")
        self.assertEqual(first["source_observation_status"], "SOURCE_CALLER_INJECTED_NOT_ATTESTED")
        self.assertEqual(first["runtime_evidence_status"], "NOT_ESTABLISHED_BY_PURE_VALIDATION")
        self.assertEqual(
            first["operator_state_root_identity_sha256"],
            self.fixture["owner_completion_log"]["operator_state_root"][
                "completed_identity_sha256"
            ],
        )
        self.assertNotEqual(first["control_plan_sha256"], first["external_anchor_base_plan_sha256"])

    def test_state_root_replacement_and_production_root_fail_after_rehash(self) -> None:
        altered = copy.deepcopy(self.fixture)
        log = altered["owner_completion_log"]
        log["operator_state_root"]["completed_identity_sha256"] = "a" * 64
        rehash(log, "log_sha256")
        with self.assertRaisesRegex(
            OWNER.ContractError, "ISOLATED_UAT_OWNER_COMPLETION_STATE_ROOT_INVALID",
        ):
            self.validate(altered)

        altered = copy.deepcopy(self.fixture)
        log = altered["owner_completion_log"]
        log["operator_state_root"]["path"] = "/var/lib/chenyida-erp/postgresql-runtime-privilege-operator"
        rehash(log, "log_sha256")
        with self.assertRaisesRegex(
            OWNER.ContractError, "ISOLATED_UAT_OWNER_COMPLETION_STATE_ROOT_INVALID",
        ):
            self.validate(altered)

    def test_phase_skip_reorder_and_terminal_quarantine_fail_closed(self) -> None:
        altered = copy.deepcopy(self.fixture)
        log = altered["owner_completion_log"]
        log["states"][2]["phase"] = "POSTCOMMIT_CAPTURED"
        rehash(log["states"][2], "state_sha256")
        for index in range(3, len(log["states"])):
            log["states"][index]["previous_state_sha256"] = log["states"][index - 1][
                "state_sha256"
            ]
            rehash(log["states"][index], "state_sha256")
        log["owner_receipt"]["final_state_sha256"] = log["states"][-1]["state_sha256"]
        rehash(log["owner_receipt"], "receipt_sha256")
        log["terminal"]["state_sha256"] = log["states"][-1]["state_sha256"]
        log["terminal"]["receipt_sha256"] = log["owner_receipt"]["receipt_sha256"]
        log["journal"]["receipt_index"] = (
            f"{log['operation_id']}.{log['owner_receipt']['receipt_sha256']}.json"
        )
        rehash(log, "log_sha256")
        with self.assertRaisesRegex(
            OWNER.ContractError, "ISOLATED_UAT_OWNER_COMPLETION_JOURNAL_CHAIN_INVALID",
        ):
            self.validate(altered)

        altered = copy.deepcopy(self.fixture)
        log = altered["owner_completion_log"]
        log["terminal"]["phase"] = "QUARANTINED"
        rehash(log, "log_sha256")
        with self.assertRaisesRegex(
            OWNER.ContractError, "ISOLATED_UAT_OWNER_COMPLETION_OPERATOR_RECEIPT_INVALID",
        ):
            self.validate(altered)

    def test_nonmonotonic_and_reversed_causal_times_fail(self) -> None:
        altered = copy.deepcopy(self.fixture)
        log = altered["owner_completion_log"]
        log["states"][3]["recorded_at"] = log["states"][2]["recorded_at"]
        rehash(log["states"][3], "state_sha256")
        rehash(log, "log_sha256")
        with self.assertRaisesRegex(
            OWNER.ContractError,
            "ISOLATED_UAT_OWNER_COMPLETION_JOURNAL_CHAIN_INVALID",
        ):
            self.validate(altered)

        altered = copy.deepcopy(self.fixture)
        log = altered["owner_completion_log"]
        log["states"][3]["recorded_at"] = "2026-08-24T10:04:20.000Z"
        rehash(log["states"][3], "state_sha256")
        for index in range(4, len(log["states"])):
            log["states"][index]["previous_state_sha256"] = log["states"][index - 1][
                "state_sha256"
            ]
            rehash(log["states"][index], "state_sha256")
        log["owner_receipt"]["final_state_sha256"] = log["states"][-1]["state_sha256"]
        rehash(log["owner_receipt"], "receipt_sha256")
        log["terminal"]["state_sha256"] = log["states"][-1]["state_sha256"]
        log["terminal"]["receipt_sha256"] = log["owner_receipt"]["receipt_sha256"]
        log["journal"]["receipt_index"] = (
            f"{log['operation_id']}.{log['owner_receipt']['receipt_sha256']}.json"
        )
        rehash(log, "log_sha256")
        with self.assertRaisesRegex(
            OWNER.ContractError,
            "ISOLATED_UAT_OWNER_COMPLETION_JOURNAL_CHAIN_INVALID",
        ):
            self.validate(altered)

        altered = copy.deepcopy(self.fixture)
        log = altered["owner_completion_log"]
        log["states"][-1]["recorded_at"] = "2026-08-24T10:05:55.000Z"
        rehash(log["states"][-1], "state_sha256")
        log["owner_receipt"]["final_state_sha256"] = log["states"][-1]["state_sha256"]
        rehash(log["owner_receipt"], "receipt_sha256")
        log["terminal"]["state_sha256"] = log["states"][-1]["state_sha256"]
        log["terminal"]["receipt_sha256"] = log["owner_receipt"]["receipt_sha256"]
        log["journal"]["receipt_index"] = (
            f"{log['operation_id']}.{log['owner_receipt']['receipt_sha256']}.json"
        )
        rehash(log, "log_sha256")
        with self.assertRaisesRegex(
            OWNER.ContractError,
            "ISOLATED_UAT_OWNER_COMPLETION_JOURNAL_CHAIN_INVALID",
        ):
            self.validate(altered)

    def test_cross_chain_external_anchor_splice_fails_even_when_rehashed(self) -> None:
        altered = copy.deepcopy(self.fixture)
        cluster = altered["database_cluster_identity"]
        cluster["identity"]["system_identifier"] = "7992739871300000001"
        cluster["system_identifier"] = "7992739871300000001"
        cluster["identity_sha256"] = OWNER.canonical_sha256(cluster["identity"])
        rehash(cluster, "receipt_sha256")
        with self.assertRaisesRegex(
            OWNER.ContractError, "ISOLATED_UAT_OWNER_COMPLETION_UPSTREAM_INVALID",
        ):
            self.validate(altered)

    def test_fixed_upstream_validators_reject_resigned_semantic_drift(self) -> None:
        altered = copy.deepcopy(self.fixture)
        observation = altered["runtime_evidence_payloads"]["runtime_privilege_observation"]
        observation["contract"] = "chenyida-erp-forged-runtime-observation/v99"
        rehash(observation, "evidence_sha256")
        with self.assertRaisesRegex(
            OWNER.ContractError, "ISOLATED_UAT_OWNER_COMPLETION_UPSTREAM_INVALID",
        ):
            self.validate(altered)

        altered = copy.deepcopy(self.fixture)
        privilege_sha256 = "a" * 64
        intent = altered["runtime_intents"]["RUNTIME_PRIVILEGE"]
        observation = altered["runtime_evidence_payloads"]["runtime_privilege_observation"]
        receipt = altered["runtime_receipts"]["runtime_privilege_receipt"]
        intent["runtime_privilege_policy_sha256"] = privilege_sha256
        rehash(intent, "intent_sha256")
        observation["runtime_privilege_intent_sha256"] = intent["intent_sha256"]
        observation["runtime_privilege_policy_sha256"] = privilege_sha256
        rehash(observation, "evidence_sha256")
        receipt["runtime_privilege_intent_sha256"] = intent["intent_sha256"]
        receipt["runtime_privilege_policy_sha256"] = privilege_sha256
        receipt["observation_bundle_sha256"] = observation["evidence_sha256"]
        rehash(receipt, "receipt_sha256")
        with self.assertRaisesRegex(
            OWNER.ContractError, "ISOLATED_UAT_OWNER_COMPLETION_UPSTREAM_INVALID",
        ):
            self.validate(altered)

    def test_fixed_v4_plan_semantics_reject_resigned_plan_drift(self) -> None:
        for mutation in ("protected_root", "action", "external_policy"):
            with self.subTest(mutation=mutation):
                altered = copy.deepcopy(self.fixture)
                base = altered["external_anchor_base_plan"]
                plan = altered["control_plan"]
                if mutation == "protected_root":
                    base["roots"]["operator_state_root"] = (
                        "/var/lib/chenyida-erp/postgresql-runtime-privilege-operator"
                    )
                elif mutation == "action":
                    base["actions"][6]["action"] = "FORGED_OWNER_RECONCILIATION"
                else:
                    base["external_anchor_policy_sha256"] = "a" * 64
                rehash(base, "plan_sha256")
                plan["external_anchor_base_plan_sha256"] = base["plan_sha256"]
                rehash(plan, "plan_sha256")
                with self.assertRaisesRegex(
                    OWNER.ContractError,
                    "ISOLATED_UAT_OWNER_COMPLETION_CONTROL_PLAN_INVALID",
                ):
                    self.validate(altered)

    def test_external_policy_cannot_be_resigned_with_both_plans(self) -> None:
        altered = copy.deepcopy(self.fixture)
        external_policy = altered["external_anchor_policy"]
        external_policy["source_closure"]["members"][-1]["sha256"] = "a" * 64
        rehash(external_policy["source_closure"], "source_closure_sha256")
        rehash(external_policy, "policy_sha256")
        base = altered["external_anchor_base_plan"]
        plan = altered["control_plan"]
        for value in (base, plan):
            value["external_anchor_policy_sha256"] = external_policy["policy_sha256"]
            value["external_anchor_source_closure_sha256"] = external_policy[
                "source_closure"
            ]["source_closure_sha256"]
        rehash(base, "plan_sha256")
        plan["external_anchor_base_plan_sha256"] = base["plan_sha256"]
        rehash(plan, "plan_sha256")
        with self.assertRaisesRegex(
            OWNER.ContractError, "ISOLATED_UAT_OWNER_COMPLETION_UPSTREAM_INVALID",
        ):
            self.validate(altered)

    def test_runtime_chain_must_use_explicit_v4_base_plan_digest(self) -> None:
        altered = copy.deepcopy(self.fixture)
        runtime_intent = altered["runtime_intents"]["RUNTIME_PRIVILEGE"]
        runtime_intent["plan_sha256"] = altered["control_plan"]["plan_sha256"]
        rehash(runtime_intent, "intent_sha256")
        with self.assertRaisesRegex(
            OWNER.ContractError, "ISOLATED_UAT_OWNER_COMPLETION_UPSTREAM_INVALID",
        ):
            self.validate(altered)

    def test_external_anchor_must_precede_migration_and_owner_intent(self) -> None:
        altered = copy.deepcopy(self.fixture)
        cluster = altered["database_cluster_identity"]
        cluster["observed_at"] = "2026-08-24T10:04:02.000Z"
        rehash(cluster, "receipt_sha256")
        with self.assertRaisesRegex(
            OWNER.ContractError, "ISOLATED_UAT_OWNER_COMPLETION_TIME_INVALID",
        ):
            self.validate(altered)

    def test_control_and_reconciliation_plan_digests_cannot_be_conflated(self) -> None:
        altered = copy.deepcopy(self.fixture)
        log = altered["owner_completion_log"]
        intent = log["owner_intent"]
        intent["owner_reconciliation_projection_sha256"] = intent["control_plan_sha256"]
        rehash(intent, "intent_sha256")
        rehash(log, "log_sha256")
        with self.assertRaisesRegex(
            OWNER.ContractError, "ISOLATED_UAT_OWNER_COMPLETION_OPERATOR_INTENT_INVALID",
        ):
            self.validate(altered)

    def test_policy_self_resign_cannot_enable_publisher(self) -> None:
        altered = copy.deepcopy(self.fixture)
        policy = altered["policy"]
        policy["capability_status"]["publisher"] = "IMPLEMENTED"
        rehash(policy, "policy_sha256")
        with self.assertRaisesRegex(
            OWNER.ContractError, "ISOLATED_UAT_OWNER_COMPLETION_POLICY_INVALID",
        ):
            self.validate(altered)

    def test_policy_source_usage_cannot_be_relabelled_and_resigned(self) -> None:
        altered = copy.deepcopy(self.fixture)
        policy = altered["policy"]
        member = next(
            item for item in policy["source_closure"]["members"]
            if item["path"] == "scripts/postgresql-runtime-privilege-operator.mjs"
        )
        member["usage"] = "UPSTREAM_PURE_VALIDATION_CONTRACT"
        rehash(policy["source_closure"], "source_closure_sha256")
        rehash(policy, "policy_sha256")
        with self.assertRaisesRegex(
            OWNER.ContractError, "ISOLATED_UAT_OWNER_COMPLETION_POLICY_INVALID",
        ):
            self.validate(altered)

    def test_malformed_unicode_float_and_extra_fields_fail_stably(self) -> None:
        altered = copy.deepcopy(self.fixture)
        altered["owner_completion_log"]["operation_id"] = "uat-\ud800-invalid"
        with self.assertRaisesRegex(
            OWNER.ContractError, "ISOLATED_UAT_OWNER_COMPLETION_FIELDS_INVALID",
        ):
            self.validate(altered)

        altered = copy.deepcopy(self.fixture)
        altered["owner_completion_log"]["states"][0]["sequence"] = 0.0
        with self.assertRaisesRegex(
            OWNER.ContractError, "ISOLATED_UAT_OWNER_COMPLETION_FIELDS_INVALID",
        ):
            self.validate(altered)

        altered = copy.deepcopy(self.fixture)
        altered["owner_completion_log"]["unexpected"] = True
        with self.assertRaisesRegex(
            OWNER.ContractError, "ISOLATED_UAT_OWNER_COMPLETION_FIELDS_INVALID",
        ):
            self.validate(altered)

    def test_publish_and_runtime_observer_gates_remain_closed(self) -> None:
        with self.assertRaisesRegex(
            OWNER.ContractError, "ISOLATED_UAT_OWNER_COMPLETION_PUBLISHER_NOT_IMPLEMENTED",
        ):
            OWNER.require_owner_completion_publisher()
        with self.assertRaisesRegex(
            OWNER.ContractError,
            "ISOLATED_UAT_OWNER_COMPLETION_RUNTIME_OBSERVER_NOT_IMPLEMENTED",
        ):
            OWNER.require_owner_completion_runtime_observer()


if __name__ == "__main__":
    unittest.main(verbosity=2)
