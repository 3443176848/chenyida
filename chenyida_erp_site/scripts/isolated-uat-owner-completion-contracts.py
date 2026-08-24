#!/usr/bin/python3
"""Pure owner-completion continuity contracts for one isolated UAT action.

The module revalidates caller-supplied values through the fixed D-179 and
D-180 pure validators before joining them to an isolated owner journal
projection.  It does not observe a host path, PostgreSQL, Docker, a clock or a
journal, and therefore does not establish runtime truth.
"""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


POLICY_CONTRACT = "chenyida-erp-isolated-uat-owner-completion-policy/v1"
POLICY_ID = "chenyida-erp-isolated-uat-owner-completion-v1"
VALIDATION_CONTRACT = "chenyida-erp-isolated-uat-owner-completion-validation/v1"
LOG_CONTRACT = "chenyida-erp-isolated-uat-owner-completion-log/v1"
INTENT_CONTRACT = "chenyida-erp-isolated-uat-owner-completion-intent/v1"
STATE_CONTRACT = "chenyida-erp-isolated-uat-owner-completion-state/v1"
RECEIPT_CONTRACT = "chenyida-erp-isolated-uat-owner-completion-receipt/v1"
PLAN_CONTRACT = "chenyida-erp-isolated-uat-one-shot-plan/v5"
PLAN_ENTRYPOINT = "chenyida-erp-isolated-uat-one-shot-v5"
ACTION_BINDING_ID = "chenyida-erp-isolated-uat-fixed-actions-v5"
ACTION_BINDING_SHA256 = "349fb247d271d3c749129c151ebb0b3c7054b64f5ee0c5646ea9e1d238c49c3f"
ACTION_BINDING_STATUS = (
    "V4_EXACTLY_INHERITED_OWNER_COMPLETION_PURE_CONTRACT_VALID_"
    "RUNTIME_FACTS_NOT_ESTABLISHED"
)
BASE_PLAN_CONTRACT = "chenyida-erp-isolated-uat-one-shot-plan/v4"
BASE_PLAN_ENTRYPOINT = "chenyida-erp-isolated-uat-one-shot-v4"
BASE_ACTION_BINDING_ID = "chenyida-erp-isolated-uat-fixed-actions-v4"
BASE_ACTION_BINDING_SHA256 = "fb83e0f20823b632525823f3d6c012769501fff1aec9763abc64d8d10d2b050b"
BASE_ACTION_BINDING_STATUS = (
    "V3_ACTIONS_EXACTLY_INHERITED_EXTERNAL_ANCHOR_CONTRACTS_VALID_"
    "RUNTIME_FACTS_NOT_ESTABLISHED"
)
RUNTIME_RECEIPT_BINDING_SHA256 = (
    "50ddd73fb4745c8fcc0b91fd7e4130e2cb3a9ef0d2f52773c64cd6112afc74bd"
)
RUNTIME_PRIVILEGE_POLICY_SHA256 = (
    "1e147e55b5285fc548ba8bc473e044e9f4e6a4b80be6b3520ec257fcbc1c29f7"
)
EXTERNAL_VALIDATION_CONTRACT = "chenyida-erp-isolated-uat-external-anchor-validation/v1"
RUNTIME_VALIDATION_CONTRACT = "chenyida-erp-isolated-uat-runtime-receipt-chain-validation/v1"
OPERATOR_ROOT_TEMPLATE = "/var/lib/{project}/postgresql-runtime-privilege-operator"
ROOT_MARKER = ".chenyida-erp-postgresql-runtime-privilege-operator-v1"
INTENT_MARKER = ".chenyida-erp-postgresql-runtime-privilege-intent-v1"
SUCCESS_PHASES = [
    "PREPARED",
    "AUTHORIZATION_CONSUMED",
    "TRANSACTION_DISPATCHED",
    "POSTCOMMIT_CAPTURED",
    "VERIFIED",
    "COMMITTED",
]
TECHNICAL_LOGIN_ROLES = [
    "chenyida_erp_admin",
    "chenyida_erp_backup",
    "chenyida_erp_owner",
    "chenyida_erp_web",
    "chenyida_erp_worker",
]
TARGET_HEAD = "0046_runtime_lock_privilege_boundary.sql"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
PROJECT = re.compile(r"^chenyida-erp-uat-[a-z0-9][a-z0-9_-]{0,42}$")
TIME = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$")
DATABASE_OID = re.compile(r"^[1-9][0-9]{0,9}$")
SYSTEM_IDENTIFIER = re.compile(r"^[1-9][0-9]{9,19}$")
MAX_POSTGRESQL_OID = 4_294_967_295
MAX_SYSTEM_IDENTIFIER = 18_446_744_073_709_551_615
MAX_DEPTH = 40
MAX_ITEMS = 40_000

CAPABILITY_STATUS = {
    "owner_completion_log_validator": "IMPLEMENTED_PURE",
    "journal_success_chain_validator": "IMPLEMENTED_PURE",
    "operator_state_root_continuity_validator": "IMPLEMENTED_PURE",
    "upstream_contract_revalidation": "IMPLEMENTED_PURE_BY_FIXED_BOUND_MODULES",
    "production_operator_primitives": "REFERENCE_SEMANTICS_ONLY_ENTRYPOINT_FORBIDDEN",
    "runtime_observer": "NOT_IMPLEMENTED",
    "publisher": "NOT_IMPLEMENTED",
    "runtime_backend": "NOT_IMPLEMENTED",
    "execution_authorized": False,
}

VALIDATION_OUTPUT = {
    "owner_completion_contract_status": "PURE_OWNER_COMPLETION_CONTRACT_VALID",
    "journal_success_chain_status": "PURE_SUCCESS_CHAIN_VALID",
    "operator_state_root_continuity_status": "PURE_IDENTITY_CONTINUITY_VALID",
    "upstream_join_status": "PURE_D179_D180_REVALIDATED_CONTINUITY_VALID_SOURCE_NOT_ATTESTED",
    "source_observation_status": "SOURCE_CALLER_INJECTED_NOT_ATTESTED",
    "authorization_status": "AUTHORIZATION_NOT_ESTABLISHED",
    "publication_status": "NOT_PUBLISHED",
    "runtime_evidence_status": "NOT_ESTABLISHED_BY_PURE_VALIDATION",
}

OWNER_PLAN_BINDING = {
    "contract": POLICY_CONTRACT,
    "validator_method": "validate_owner_completion_contracts",
    "producer_action_ordinal": 7,
    "consumer_action_ordinal": 9,
    "validation_status": (
        "PURE_OWNER_COMPLETION_CONTRACT_JOIN_VALID_SOURCE_CALLER_INJECTED_NOT_ATTESTED"
    ),
}

BOUND_SOURCE_SHA256 = {
    "operations/isolated-uat-external-anchor-policy-v1.json": (
        "92c59a9f9f800a243324c0a6e24ca8258e58483fe759cf30c2c98d53aead6ef3"
    ),
    "operations/isolated-uat-one-shot-action-bindings-v4.json": (
        "4858b8c14846a69ed969f5476828631362830675399e788f705c35e1cfe34262"
    ),
    "operations/isolated-uat-runtime-receipt-policy-v1.json": (
        "1eee47ed1ed9311529153cc3e7defeb95984e075276af23a453a872c94027aac"
    ),
    "operations/postgresql-runtime-privilege-policy-v2.json": (
        "2aba8ed96202117761ba88212fb84e3d475afbf19e5447fabe2f658bbe9d8a7c"
    ),
    "scripts/isolated-uat-external-anchor-contracts.py": (
        "fc6e76d4620cbfbb447beb53f5b0b35d1f6df138a028cfb811bffbc51959be61"
    ),
    "scripts/isolated-uat-runtime-receipts.py": (
        "c19d4599abf2b7063a4d82476b651ae0013303f181bcca1b8c45f5d94148e79d"
    ),
    "scripts/postgresql-runtime-privilege-journal.mjs": (
        "16d8a311181874f4e6ed49c2251581df0777f038f7d3b10e7a4e7a88f6ef1bfc"
    ),
    "scripts/postgresql-runtime-privilege-operator.mjs": (
        "13a896aee3c0c36d6c120eb2d9c46b2e514fc9c15f8e7a2becad06e3b84d0dc5"
    ),
    "scripts/postgresql-runtime-privilege-reconciler.mjs": (
        "22ddda1cf7f77899cbb58f2e6e5ac75f81ea7629d8a4abbf05b07021efc0a6b9"
    ),
}

BOUND_SOURCE_USAGE = {
    "operations/isolated-uat-external-anchor-policy-v1.json": (
        "UPSTREAM_PURE_VALIDATION_CONTRACT"
    ),
    "operations/isolated-uat-one-shot-action-bindings-v4.json": (
        "UPSTREAM_PURE_VALIDATION_CONTRACT"
    ),
    "operations/isolated-uat-runtime-receipt-policy-v1.json": (
        "UPSTREAM_PURE_VALIDATION_CONTRACT"
    ),
    "operations/postgresql-runtime-privilege-policy-v2.json": (
        "UPSTREAM_PURE_VALIDATION_CONTRACT"
    ),
    "scripts/isolated-uat-external-anchor-contracts.py": (
        "UPSTREAM_PURE_VALIDATION_CONTRACT"
    ),
    "scripts/isolated-uat-runtime-receipts.py": "UPSTREAM_PURE_VALIDATION_CONTRACT",
    "scripts/postgresql-runtime-privilege-journal.mjs": (
        "REFERENCE_PRIMITIVES_ONLY_NOT_EXECUTABLE"
    ),
    "scripts/postgresql-runtime-privilege-operator.mjs": (
        "REFERENCE_PRIMITIVES_ONLY_NOT_EXECUTABLE"
    ),
    "scripts/postgresql-runtime-privilege-reconciler.mjs": (
        "REFERENCE_PRIMITIVES_ONLY_NOT_EXECUTABLE"
    ),
}

SITE_ROOT = Path(__file__).resolve().parent.parent


def _load_fixed_module(name: str, relative_path: str) -> Any:
    specification = importlib.util.spec_from_file_location(name, SITE_ROOT / relative_path)
    if specification is None or specification.loader is None:
        raise RuntimeError(f"{name} cannot be loaded")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


EXTERNAL_ANCHORS = _load_fixed_module(
    "isolated_uat_owner_bound_external_anchors",
    "scripts/isolated-uat-external-anchor-contracts.py",
)
RUNTIME_RECEIPTS = _load_fixed_module(
    "isolated_uat_owner_bound_runtime_receipts",
    "scripts/isolated-uat-runtime-receipts.py",
)

BASE_PLAN_FIELDS = {
    "schema_version", "contract", "entrypoint_id", "mode", "execution_authorized",
    "action_binding_id", "action_binding_sha256", "action_binding_status",
    "runtime_contract_policy_sha256", "runtime_contract_source_closure_sha256",
    "runtime_contract_capability_status", "runtime_receipt_policy_sha256",
    "runtime_receipt_source_closure_sha256", "runtime_receipt_capability_status",
    "runtime_receipt_validation_status", "runtime_receipt_success_output_contract",
    "external_anchor_policy_sha256", "external_anchor_source_closure_sha256",
    "external_anchor_capability_status", "external_anchor_validation_status",
    "external_anchor_success_output_contract", "receipt_chain_binding", "request_id",
    "policy_sha256", "project", "roots", "source", "images", "ports", "database",
    "migration_allowlist_entries", "actions", "failure_boundary",
    "forbidden_production_entrypoints", "plan_sha256",
}
OWNER_PLAN_FIELDS = {
    "owner_completion_policy_sha256",
    "owner_completion_source_closure_sha256",
    "owner_completion_capability_status",
    "owner_completion_validation_status",
    "owner_completion_success_output_contract",
    "owner_completion_binding",
    "external_anchor_base_plan_sha256",
}
PLAN_FIELDS = BASE_PLAN_FIELDS | OWNER_PLAN_FIELDS

EXTERNAL_RESULT_FIELDS = {
    "schema_version", "contract", "project", "request_id", "plan_sha256",
    "policy_sha256", "namespace_root_receipt_sha256",
    "credential_generation_receipt_sha256", "postgres_container_identity_sha256",
    "database_cluster_identity_receipt_sha256", "external_digest_anchors",
    "external_anchor_contract_status", "source_observation_status",
    "control_plan_status", "authorization_status", "runtime_evidence_status",
    "validation_sha256",
}
RUNTIME_RESULT_FIELDS = {
    "schema_version", "contract", "binding_sha256", "runtime_intent_policy_sha256",
    "runtime_receipt_policy_sha256", "project", "plan_sha256", "operation_id",
    "request_id", "validated_receipt_sha256", "validated_evidence_sha256",
    "external_digest_anchors", "chain_head_sha256", "verified_at",
    "receipt_contract_validation_status", "predecessor_chain_status",
    "external_anchor_validation_status", "execution_status", "publication_status",
    "runtime_evidence_status", "dependency_policy_roots_status",
    "receipt_policy_root_status", "control_plan_anchor_status",
    "verification_time_source_status", "freshness_validation_status",
    "validation_sha256",
}
RUNTIME_RECEIPT_NAMES = {
    "database_bootstrap_receipt", "database_target_identity",
    "isolated_uat_postdeploy_receipt", "isolated_uat_runtime_identity_receipt",
    "migration_execution_receipt", "readiness_receipt", "release_candidate_receipt",
    "runtime_privilege_receipt",
}
RUNTIME_EVIDENCE_NAMES = {
    "container_identity_set", "database_bootstrap_observation",
    "migration_applied_ledger", "migration_observation", "runtime_privilege_observation",
}


class ContractError(Exception):
    pass


def fail(code: str) -> None:
    raise ContractError(code)


def exact(value: Any, keys: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        fail(code)
    return value


def _validate_json(value: Any, code: str) -> None:
    stack: list[tuple[Any, int]] = [(value, 0)]
    count = 0
    while stack:
        current, depth = stack.pop()
        count += 1
        if count > MAX_ITEMS or depth > MAX_DEPTH:
            fail(code)
        if current is None or isinstance(current, bool):
            continue
        if type(current) is int:
            if abs(current) > 9_007_199_254_740_991:
                fail(code)
            continue
        if isinstance(current, str):
            try:
                current.encode("utf-8")
            except UnicodeError:
                fail(code)
            if unicodedata.normalize("NFC", current) != current:
                fail(code)
            continue
        if isinstance(current, list):
            stack.extend((item, depth + 1) for item in current)
            continue
        if isinstance(current, dict):
            if any(
                not isinstance(key, str) or unicodedata.normalize("NFC", key) != key
                for key in current
            ):
                fail(code)
            stack.extend((item, depth + 1) for item in current.values())
            continue
        fail(code)


def canonical_json(value: Any) -> str:
    _validate_json(value, "ISOLATED_UAT_OWNER_COMPLETION_JSON_INVALID")
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _clone(value: Any, code: str) -> Any:
    try:
        _validate_json(value, code)
        return json.loads(canonical_json(value))
    except ContractError:
        raise
    except (OverflowError, RecursionError, TypeError, UnicodeError, ValueError):
        fail(code)


def _sha(value: Any, code: str) -> str:
    if not isinstance(value, str) or SHA256.fullmatch(value) is None:
        fail(code)
    return value


def _identifier(value: Any, code: str) -> str:
    if not isinstance(value, str) or IDENTIFIER.fullmatch(value) is None:
        fail(code)
    return value


def _time(value: Any, code: str) -> datetime:
    if not isinstance(value, str) or TIME.fullmatch(value) is None:
        fail(code)
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except ValueError:
        fail(code)
    if parsed.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z" != value:
        fail(code)
    return parsed


def _digest(value: dict[str, Any], field: str, code: str) -> None:
    body = {key: item for key, item in value.items() if key != field}
    if canonical_sha256(body) != _sha(value.get(field), code):
        fail(code)


def validate_policy(value: Any, sources: dict[str, bytes]) -> dict[str, Any]:
    code = "ISOLATED_UAT_OWNER_COMPLETION_POLICY_INVALID"
    value = exact(_clone(value, code), {
        "schema_version", "contract", "policy_id", "execution_authorized",
        "capability_status", "validation_output", "upstream_bindings", "invariants",
        "source_closure", "policy_sha256",
    }, code)
    if value["schema_version"] != 1 or value["contract"] != POLICY_CONTRACT \
            or value["policy_id"] != POLICY_ID or value["execution_authorized"] is not False \
            or value["capability_status"] != CAPABILITY_STATUS \
            or value["validation_output"] != VALIDATION_OUTPUT:
        fail(code)
    expected_bindings = [
        "operations/isolated-uat-runtime-receipt-policy-v1.json",
        "operations/isolated-uat-external-anchor-policy-v1.json",
        "operations/postgresql-runtime-privilege-policy-v2.json",
        "operations/isolated-uat-one-shot-action-bindings-v4.json",
    ]
    bindings = value["upstream_bindings"]
    if not isinstance(bindings, list) or [
        item.get("path") if isinstance(item, dict) else None for item in bindings
    ] != expected_bindings:
        fail(code)
    for binding in bindings:
        exact(binding, {"path", "sha256"}, code)
        if binding["sha256"] != BOUND_SOURCE_SHA256[binding["path"]]:
            fail(code)
    invariants = exact(value["invariants"], {
        "operator_state_root_template", "root_marker", "intent_marker",
        "journal_profile", "terminal_location", "success_phases", "operation",
        "runtime_guard_mode", "target_head", "technical_login_roles",
        "max_owner_journal_duration_seconds", "recovery_authorizations",
    }, code)
    if invariants != {
        "operator_state_root_template": OPERATOR_ROOT_TEMPLATE,
        "root_marker": ROOT_MARKER,
        "intent_marker": INTENT_MARKER,
        "journal_profile": "ISOLATED_UAT_CONTRACT_ONLY",
        "terminal_location": "COMPLETED",
        "success_phases": SUCCESS_PHASES,
        "operation": "RECONCILE",
        "runtime_guard_mode": "ISOLATED_UAT_POST_MIGRATION_PRE_RUNTIME_BOUND",
        "target_head": TARGET_HEAD,
        "technical_login_roles": TECHNICAL_LOGIN_ROLES,
        "max_owner_journal_duration_seconds": 900,
        "recovery_authorizations": "EMPTY_FOR_NORMAL_SUCCESS_PATH",
    }:
        fail(code)
    closure = exact(value["source_closure"], {
        "schema_version", "algorithm", "roots", "members",
        "declared_absent_capabilities", "validation_scope", "source_closure_sha256",
    }, code)
    expected_paths = sorted([
        *BOUND_SOURCE_SHA256,
        "scripts/isolated-uat-owner-completion-contracts.py",
    ])
    if closure["schema_version"] != 1 \
            or closure["algorithm"] != "PYTHON_STATIC_RESOURCE_CLOSURE_V1" \
            or closure["roots"] != ["scripts/isolated-uat-owner-completion-contracts.py"] \
            or closure["declared_absent_capabilities"] != [
                "CLOCK", "DATABASE", "DOCKER", "FILESYSTEM_RUNTIME_OBSERVATION",
                "NETWORK", "PROCESS", "RANDOM", "SECRET_VALUES", "SHELL",
            ] \
            or closure["validation_scope"] != (
                "SOURCE_HASH_AND_FIXED_REFERENCE_RESOURCES_NOT_A_SANDBOX_OR_RUNTIME_ATTESTATION"
            ):
        fail(code)
    members = closure["members"]
    if not isinstance(members, list) or [
        item.get("path") if isinstance(item, dict) else None for item in members
    ] != expected_paths:
        fail(code)
    for member in members:
        exact(member, {"path", "sha256", "usage"}, code)
        raw = sources.get(member["path"])
        if not isinstance(raw, bytes) or hashlib.sha256(raw).hexdigest() != member["sha256"]:
            fail(code)
        if member["path"] in BOUND_SOURCE_SHA256:
            if member["sha256"] != BOUND_SOURCE_SHA256[member["path"]] \
                    or member["usage"] != BOUND_SOURCE_USAGE[member["path"]]:
                fail(code)
        elif member["usage"] != "EXECUTING_PURE_OWNER_COMPLETION_VALIDATOR":
            fail(code)
    closure_body = {key: item for key, item in closure.items() if key != "source_closure_sha256"}
    if canonical_sha256(closure_body) != closure["source_closure_sha256"]:
        fail(code)
    _digest(value, "policy_sha256", code)
    return value


def _validate_plan(
    value: Any,
    base_value: Any,
    policy: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    code = "ISOLATED_UAT_OWNER_COMPLETION_CONTROL_PLAN_INVALID"
    try:
        validated_base = EXTERNAL_ANCHORS.validate_control_plan(copy.deepcopy(base_value))
    except EXTERNAL_ANCHORS.ContractError:
        fail(code)
    value = exact(_clone(value, code), PLAN_FIELDS, code)
    base_value = exact(copy.deepcopy(validated_base), BASE_PLAN_FIELDS, code)
    if value["schema_version"] != 5 or value["contract"] != PLAN_CONTRACT \
            or value["entrypoint_id"] != PLAN_ENTRYPOINT or value["mode"] != "READ_ONLY_PLAN" \
            or value["execution_authorized"] is not False \
            or value["action_binding_id"] != ACTION_BINDING_ID \
            or value["action_binding_sha256"] != ACTION_BINDING_SHA256 \
            or value["action_binding_status"] != ACTION_BINDING_STATUS \
            or value["owner_completion_policy_sha256"] != policy["policy_sha256"] \
            or value["owner_completion_source_closure_sha256"] \
                != policy["source_closure"]["source_closure_sha256"] \
            or value["owner_completion_capability_status"] != policy["capability_status"] \
            or value["owner_completion_validation_status"] != "NOT_RUN_NO_OWNER_COMPLETION_LOG" \
            or value["owner_completion_success_output_contract"] != policy["validation_output"] \
            or value["owner_completion_binding"] != OWNER_PLAN_BINDING:
        fail(code)
    _digest(value, "plan_sha256", code)
    reconstructed_body = {
        key: item for key, item in value.items()
        if key not in OWNER_PLAN_FIELDS | {"plan_sha256"}
    }
    reconstructed_body.update({
        "schema_version": 4,
        "contract": BASE_PLAN_CONTRACT,
        "entrypoint_id": BASE_PLAN_ENTRYPOINT,
        "action_binding_id": BASE_ACTION_BINDING_ID,
        "action_binding_sha256": BASE_ACTION_BINDING_SHA256,
        "action_binding_status": BASE_ACTION_BINDING_STATUS,
    })
    reconstructed = {
        **reconstructed_body,
        "plan_sha256": canonical_sha256(reconstructed_body),
    }
    if base_value != reconstructed \
            or value["external_anchor_base_plan_sha256"] != base_value["plan_sha256"]:
        fail(code)
    _digest(base_value, "plan_sha256", code)
    return value, base_value


def _validate_upstream_results(
    external: Any,
    runtime: Any,
    plan: dict[str, Any],
    base_plan: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    code = "ISOLATED_UAT_OWNER_COMPLETION_UPSTREAM_INVALID"
    external = exact(_clone(external, code), EXTERNAL_RESULT_FIELDS, code)
    runtime = exact(_clone(runtime, code), RUNTIME_RESULT_FIELDS, code)
    if external["schema_version"] != 1 \
            or external["contract"] != EXTERNAL_VALIDATION_CONTRACT \
            or (external["project"], external["request_id"], external["plan_sha256"]) != (
                base_plan["project"], base_plan["request_id"], base_plan["plan_sha256"],
            ) \
            or external["external_anchor_contract_status"] \
                != "PURE_EXTERNAL_ANCHOR_CONTRACTS_VALID" \
            or external["source_observation_status"] != "SOURCE_CALLER_INJECTED_NOT_ATTESTED" \
            or external["control_plan_status"] \
                != "CONTROL_PLAN_CONTRACT_CONTINUITY_VALID_SOURCE_NOT_ATTESTED" \
            or external["authorization_status"] != "AUTHORIZATION_NOT_ESTABLISHED" \
            or external["runtime_evidence_status"] != "NOT_ESTABLISHED_BY_PURE_VALIDATION":
        fail(code)
    _digest(external, "validation_sha256", code)
    if runtime["schema_version"] != 1 \
            or runtime["contract"] != RUNTIME_VALIDATION_CONTRACT \
            or (runtime["project"], runtime["request_id"], runtime["plan_sha256"]) != (
                base_plan["project"], base_plan["request_id"], base_plan["plan_sha256"],
            ) \
            or runtime["receipt_contract_validation_status"] != "VALID" \
            or runtime["predecessor_chain_status"] != (
                "VALIDATED_PURE_INTERNAL_CONTRACT_CHAIN_FROM_UNVERIFIED_EXTERNAL_DIGEST_ANCHORS"
            ) \
            or runtime["external_anchor_validation_status"] != "NOT_EVALUATED" \
            or runtime["execution_status"] != "NOT_EVALUATED" \
            or runtime["publication_status"] != "NOT_EVALUATED" \
            or runtime["runtime_evidence_status"] != "NOT_ESTABLISHED_BY_PURE_VALIDATION" \
            or runtime["dependency_policy_roots_status"] \
                != "VALIDATED_AGAINST_EXECUTING_VALIDATOR_CONSTANTS" \
            or runtime["receipt_policy_root_status"] \
                != "MATCHED_CALLER_SUPPLIED_EXPECTED_DIGESTS" \
            or runtime["control_plan_anchor_status"] != "NOT_EVALUATED" \
            or runtime["verification_time_source_status"] != "CALLER_INJECTED_NOT_ATTESTED" \
            or runtime["freshness_validation_status"] \
                != "VALIDATED_RELATIVE_TO_CALLER_INJECTED_TIME":
        fail(code)
    _digest(runtime, "validation_sha256", code)
    receipts = exact(runtime["validated_receipt_sha256"], RUNTIME_RECEIPT_NAMES, code)
    evidence = exact(runtime["validated_evidence_sha256"], RUNTIME_EVIDENCE_NAMES, code)
    anchors = exact(runtime["external_digest_anchors"], {
        "credential_generation_receipt_sha256", "database_cluster_identity_sha256",
        "release_candidate_root_identity_sha256", "one_shot_state_root_identity_sha256",
    }, code)
    external_anchors = exact(external["external_digest_anchors"], set(anchors), code)
    for digest in [*receipts.values(), *evidence.values(), *anchors.values(), *external_anchors.values()]:
        _sha(digest, code)
    if external["policy_sha256"] != base_plan["external_anchor_policy_sha256"] \
            or runtime["binding_sha256"] != RUNTIME_RECEIPT_BINDING_SHA256 \
            or runtime["runtime_intent_policy_sha256"] \
                != base_plan["runtime_contract_policy_sha256"] \
            or runtime["runtime_receipt_policy_sha256"] \
                != base_plan["runtime_receipt_policy_sha256"] \
            or runtime["chain_head_sha256"] \
                != receipts["isolated_uat_runtime_identity_receipt"] \
            or anchors != external_anchors:
        fail(code)
    _identifier(runtime["operation_id"], code)
    _time(runtime["verified_at"], code)
    _sha(plan["plan_sha256"], code)
    return external, runtime


def _validate_bridge_objects(
    *,
    base_plan: dict[str, Any],
    external: dict[str, Any],
    runtime: dict[str, Any],
    namespace_root_receipt: Any,
    credential_generation_receipt: Any,
    postgres_container_identity: Any,
    database_cluster_identity: Any,
    database_target_identity: Any,
    migration_execution_receipt: Any,
    runtime_privilege_intent: Any,
    runtime_privilege_observation: Any,
    runtime_privilege_receipt: Any,
) -> dict[str, Any]:
    code = "ISOLATED_UAT_OWNER_COMPLETION_PREDECESSOR_INVALID"
    namespace = exact(_clone(namespace_root_receipt, code), {
        "schema_version", "contract", "producer", "request_id", "project", "plan_sha256",
        "roots", "release_candidate_root_identity_sha256",
        "one_shot_state_root_identity_sha256", "observed_at", "receipt_sha256",
    }, code)
    credentials = exact(_clone(credential_generation_receipt, code), {
        "schema_version", "contract", "producer", "request_id", "project", "plan_sha256",
        "namespace_root_receipt_sha256", "generation_id", "password_format", "entries",
        "all_values_distinct", "value_observation_status", "secret_material_in_receipt",
        "observed_at", "receipt_sha256",
    }, code)
    container = exact(_clone(postgres_container_identity, code), {
        "schema_version", "contract", "producer", "request_id", "project", "plan_sha256",
        "credential_generation_receipt_sha256", "resolved_compose_sha256", "service",
        "compose_project", "container_id", "image_reference", "image_config_digest",
        "network_observation_status", "network_mode", "networks", "published_ports",
        "mount_observation_status", "mounts", "tmpfs_mounts",
        "runtime_secret_root_identity_sha256", "running", "health", "observed_at",
        "identity_sha256",
    }, code)
    cluster = exact(_clone(database_cluster_identity, code), {
        "schema_version", "contract", "producer", "request_id", "project", "plan_sha256",
        "credential_generation_receipt_sha256", "postgres_container_identity_sha256",
        "database_name", "system_identifier", "identity", "identity_sha256", "observed_at",
        "receipt_sha256",
    }, code)
    target = exact(_clone(database_target_identity, code), {
        "schema_version", "contract", "bootstrap_intent_sha256", "producer",
        "database_name", "system_identifier", "database_oid", "marker", "owner",
        "identity_sha256",
    }, code)
    migration = exact(_clone(migration_execution_receipt, code), {
        "schema_version", "contract", "migration_intent_sha256", "producer",
        "release_candidate_receipt_sha256", "database_target_identity_sha256",
        "from_head", "to_head", "applied_count", "applied_ledger_sha256",
        "observed_head", "observation_bundle_sha256", "observed_at", "completed_at",
        "receipt_sha256",
    }, code)
    intent = exact(_clone(runtime_privilege_intent, code), {
        "schema_version", "contract", "operation_id", "request_id", "project", "plan_sha256",
        "runtime_intent_policy_sha256", "runtime_receipt_policy_sha256",
        "database_target_identity_sha256", "migration_execution_receipt_sha256",
        "target_head", "technical_login_roles", "runtime_privilege_policy_sha256",
        "contract_validation_status", "execution_status", "publication_status",
        "intent_sha256",
    }, code)
    observation = exact(_clone(runtime_privilege_observation, code), {
        "schema_version", "contract", "runtime_privilege_intent_sha256", "producer",
        "project", "database_target_identity_sha256", "migration_execution_receipt_sha256",
        "runtime_privilege_policy_sha256", "observed_head", "observed_login_roles",
        "database_acl_status", "schema_acl_status", "default_acl_status",
        "relation_acl_status", "observed_at", "evidence_sha256",
    }, code)
    receipt = exact(_clone(runtime_privilege_receipt, code), {
        "schema_version", "contract", "runtime_privilege_intent_sha256", "producer",
        "project", "database_target_identity_sha256", "migration_execution_receipt_sha256",
        "runtime_privilege_policy_sha256", "observation_bundle_sha256", "observed_head",
        "observed_login_roles_sha256", "completed_at", "receipt_sha256",
    }, code)
    for value, field in (
        (namespace, "receipt_sha256"), (credentials, "receipt_sha256"),
        (container, "identity_sha256"), (cluster, "receipt_sha256"),
        (target, "identity_sha256"), (migration, "receipt_sha256"),
        (intent, "intent_sha256"), (observation, "evidence_sha256"),
        (receipt, "receipt_sha256"),
    ):
        _digest(value, field, code)
    roots = namespace["roots"]
    if not isinstance(roots, list):
        fail(code)
    operator_roots = [
        item for item in roots if isinstance(item, dict) and item.get("name") == "operator_state_root"
    ]
    if len(operator_roots) != 1:
        fail(code)
    operator_root = exact(operator_roots[0], {
        "name", "path", "ancestor_chain", "parent_identity_sha256", "identity",
    }, code)
    operator_identity = operator_root["identity"]
    if not isinstance(operator_identity, dict):
        fail(code)
    operator_identity_sha256 = _sha(operator_identity.get("identity_sha256"), code)
    if operator_root["path"] != OPERATOR_ROOT_TEMPLATE.format(project=base_plan["project"]):
        fail(code)
    common = (base_plan["request_id"], base_plan["project"], base_plan["plan_sha256"])
    if any((value["request_id"], value["project"], value["plan_sha256"]) != common for value in (
        namespace, credentials, container, cluster,
    )):
        fail(code)
    if external["namespace_root_receipt_sha256"] != namespace["receipt_sha256"] \
            or external["credential_generation_receipt_sha256"] != credentials["receipt_sha256"] \
            or external["postgres_container_identity_sha256"] != container["identity_sha256"] \
            or external["database_cluster_identity_receipt_sha256"] != cluster["receipt_sha256"]:
        fail(code)
    validated_receipts = runtime["validated_receipt_sha256"]
    validated_evidence = runtime["validated_evidence_sha256"]
    if validated_receipts["database_target_identity"] != target["identity_sha256"] \
            or validated_receipts["migration_execution_receipt"] != migration["receipt_sha256"] \
            or validated_receipts["runtime_privilege_receipt"] != receipt["receipt_sha256"] \
            or validated_evidence["runtime_privilege_observation"] != observation["evidence_sha256"]:
        fail(code)
    if runtime["external_digest_anchors"] != {
        "credential_generation_receipt_sha256": credentials["receipt_sha256"],
        "database_cluster_identity_sha256": cluster["identity_sha256"],
        "release_candidate_root_identity_sha256": namespace[
            "release_candidate_root_identity_sha256"
        ],
        "one_shot_state_root_identity_sha256": namespace[
            "one_shot_state_root_identity_sha256"
        ],
    }:
        fail(code)
    if (intent["operation_id"], intent["request_id"], intent["project"], intent["plan_sha256"]) != (
        runtime["operation_id"], runtime["request_id"], runtime["project"], runtime["plan_sha256"],
    ) or intent["database_target_identity_sha256"] != target["identity_sha256"] \
            or intent["migration_execution_receipt_sha256"] != migration["receipt_sha256"] \
            or intent["target_head"] != TARGET_HEAD \
            or intent["technical_login_roles"] != TECHNICAL_LOGIN_ROLES \
            or intent["contract_validation_status"] != "STRUCTURE_VALID" \
            or intent["execution_status"] != "NOT_EXECUTED" \
            or intent["publication_status"] != "NOT_PUBLISHED":
        fail(code)
    if observation["runtime_privilege_intent_sha256"] != intent["intent_sha256"] \
            or receipt["runtime_privilege_intent_sha256"] != intent["intent_sha256"] \
            or observation["project"] != intent["project"] or receipt["project"] != intent["project"] \
            or any(value["database_target_identity_sha256"] != target["identity_sha256"] for value in (
                migration, observation, receipt,
            )) \
            or any(value["migration_execution_receipt_sha256"] != migration["receipt_sha256"] for value in (
                observation, receipt,
            )) \
            or any(value["runtime_privilege_policy_sha256"] != intent["runtime_privilege_policy_sha256"] for value in (
                observation, receipt,
            )) \
            or intent["runtime_privilege_policy_sha256"] != RUNTIME_PRIVILEGE_POLICY_SHA256 \
            or observation["observed_head"] != intent["target_head"] \
            or receipt["observed_head"] != intent["target_head"] \
            or observation["observed_login_roles"] != TECHNICAL_LOGIN_ROLES and (
                not isinstance(observation["observed_login_roles"], list)
                or [item.get("role") if isinstance(item, dict) else None
                    for item in observation["observed_login_roles"]] != TECHNICAL_LOGIN_ROLES
            ) \
            or any(observation[field] != "MATCHED_BOUND_POLICY" for field in (
                "database_acl_status", "schema_acl_status", "default_acl_status",
                "relation_acl_status",
            )) \
            or receipt["observation_bundle_sha256"] != observation["evidence_sha256"]:
        fail(code)
    if cluster["identity_sha256"] != runtime["external_digest_anchors"][
        "database_cluster_identity_sha256"
    ] or cluster["system_identifier"] != target["system_identifier"] \
            or cluster["postgres_container_identity_sha256"] != container["identity_sha256"] \
            or cluster["credential_generation_receipt_sha256"] != credentials["receipt_sha256"] \
            or credentials["namespace_root_receipt_sha256"] != namespace["receipt_sha256"]:
        fail(code)
    if not isinstance(target["database_oid"], str) or DATABASE_OID.fullmatch(target["database_oid"]) is None \
            or int(target["database_oid"]) > MAX_POSTGRESQL_OID \
            or not isinstance(target["system_identifier"], str) \
            or SYSTEM_IDENTIFIER.fullmatch(target["system_identifier"]) is None \
            or int(target["system_identifier"]) > MAX_SYSTEM_IDENTIFIER:
        fail(code)
    cluster_observed_at = _time(
        cluster["observed_at"], "ISOLATED_UAT_OWNER_COMPLETION_TIME_INVALID",
    )
    migration_observed_at = _time(
        migration["observed_at"], "ISOLATED_UAT_OWNER_COMPLETION_TIME_INVALID",
    )
    migration_completed_at = _time(
        migration["completed_at"], "ISOLATED_UAT_OWNER_COMPLETION_TIME_INVALID",
    )
    if cluster_observed_at > migration_observed_at \
            or migration_observed_at > migration_completed_at:
        fail("ISOLATED_UAT_OWNER_COMPLETION_TIME_INVALID")
    return {
        "namespace": namespace,
        "credentials": credentials,
        "container": container,
        "cluster": cluster,
        "target": target,
        "migration": migration,
        "intent": intent,
        "observation": observation,
        "receipt": receipt,
        "operator_root_path": operator_root["path"],
        "operator_root_identity_sha256": operator_identity_sha256,
    }


def _desired_projection(bridge: dict[str, Any]) -> dict[str, Any]:
    intent = bridge["intent"]
    return {
        "contract": "chenyida-erp-isolated-uat-owner-desired-privilege-projection/v1",
        "project": intent["project"],
        "database_target_identity_sha256": intent["database_target_identity_sha256"],
        "migration_execution_receipt_sha256": intent["migration_execution_receipt_sha256"],
        "runtime_privilege_policy_sha256": intent["runtime_privilege_policy_sha256"],
        "target_head": intent["target_head"],
        "technical_login_roles": intent["technical_login_roles"],
        "required_acl_status": "MATCHED_BOUND_POLICY",
    }


def _owner_reconciliation_projection(intent: dict[str, Any]) -> dict[str, Any]:
    return {
        "contract": "chenyida-erp-isolated-uat-owner-reconciliation-projection/v1",
        "runtime_privilege_intent_sha256": intent["runtime_privilege_intent_sha256"],
        "database_target_identity_sha256": intent["database_target_identity_sha256"],
        "migration_execution_receipt_sha256": intent["migration_execution_receipt_sha256"],
        "runtime_privilege_policy_sha256": intent["runtime_privilege_policy_sha256"],
        "target_head": intent["target_head"],
        "technical_login_roles": intent["technical_login_roles"],
        "desired_state_sha256": intent["desired_state_sha256"],
    }


def _credential_metadata_projection(bridge: dict[str, Any]) -> dict[str, Any]:
    return {
        "contract": "chenyida-erp-isolated-uat-owner-credential-metadata-continuity/v1",
        "credential_generation_receipt_sha256": bridge["credentials"]["receipt_sha256"],
        "credential_generation_id": bridge["credentials"]["generation_id"],
        "technical_login_roles": bridge["intent"]["technical_login_roles"],
        "observed_login_roles_sha256": bridge["receipt"]["observed_login_roles_sha256"],
    }


def _validate_owner_log(
    value: Any,
    plan: dict[str, Any],
    base_plan: dict[str, Any],
    runtime: dict[str, Any],
    bridge: dict[str, Any],
    policy: dict[str, Any],
) -> dict[str, Any]:
    fields = "ISOLATED_UAT_OWNER_COMPLETION_FIELDS_INVALID"
    predecessor = "ISOLATED_UAT_OWNER_COMPLETION_PREDECESSOR_INVALID"
    value = exact(_clone(value, fields), {
        "schema_version", "contract", "producer", "operation_id", "request_id", "project",
        "control_plan_sha256", "external_anchor_base_plan_sha256", "operator_state_root",
        "journal", "owner_intent", "states", "recovery_authorizations", "owner_receipt",
        "terminal", "log_sha256",
    }, fields)
    if value["schema_version"] != 1 or value["contract"] != LOG_CONTRACT \
            or value["producer"] != {
                "action_ordinal": 7,
                "handler_id": "POSTGRESQL_RUNTIME_PRIVILEGE_PRIMITIVES",
                "adapter_method": "reconcile_final_runtime_privileges",
            } \
            or (value["operation_id"], value["request_id"], value["project"]) != (
                runtime["operation_id"], base_plan["request_id"], base_plan["project"],
            ) \
            or value["control_plan_sha256"] != plan["plan_sha256"] \
            or value["external_anchor_base_plan_sha256"] != base_plan["plan_sha256"]:
        fail(fields)
    root = exact(value["operator_state_root"], {
        "path", "namespace_root_receipt_sha256", "prepared_identity_sha256",
        "completed_identity_sha256",
    }, "ISOLATED_UAT_OWNER_COMPLETION_STATE_ROOT_INVALID")
    if root != {
        "path": bridge["operator_root_path"],
        "namespace_root_receipt_sha256": bridge["namespace"]["receipt_sha256"],
        "prepared_identity_sha256": bridge["operator_root_identity_sha256"],
        "completed_identity_sha256": bridge["operator_root_identity_sha256"],
    }:
        fail("ISOLATED_UAT_OWNER_COMPLETION_STATE_ROOT_INVALID")
    intent = exact(value["owner_intent"], {
        "schema_version", "contract", "operation_id", "request_id", "project",
        "control_plan_sha256", "external_anchor_base_plan_sha256",
        "runtime_privilege_intent_sha256", "database_target_identity_sha256",
        "migration_execution_receipt_sha256", "runtime_privilege_policy_sha256",
        "namespace_root_receipt_sha256", "operator_state_root_identity_sha256",
        "credential_generation_receipt_sha256", "credential_generation_id",
        "postgres_container_identity_sha256", "postgres_container_id",
        "database_cluster_identity_sha256", "database_cluster_receipt_sha256",
        "target", "target_head", "technical_login_roles", "operation",
        "runtime_guard_mode", "desired_state_sha256",
        "owner_reconciliation_projection_sha256", "created_at", "intent_sha256",
    }, "ISOLATED_UAT_OWNER_COMPLETION_OPERATOR_INTENT_INVALID")
    desired_state_sha256 = canonical_sha256(_desired_projection(bridge))
    expected_target = {
        "database_name": bridge["target"]["database_name"],
        "database_oid": bridge["target"]["database_oid"],
        "system_identifier": bridge["target"]["system_identifier"],
        "marker": bridge["target"]["marker"],
        "owner": bridge["target"]["owner"],
    }
    if intent["schema_version"] != 1 or intent["contract"] != INTENT_CONTRACT \
            or (intent["operation_id"], intent["request_id"], intent["project"]) != (
                value["operation_id"], value["request_id"], value["project"],
            ) \
            or intent["control_plan_sha256"] != plan["plan_sha256"] \
            or intent["external_anchor_base_plan_sha256"] != base_plan["plan_sha256"] \
            or intent["runtime_privilege_intent_sha256"] != bridge["intent"]["intent_sha256"] \
            or intent["database_target_identity_sha256"] != bridge["target"]["identity_sha256"] \
            or intent["migration_execution_receipt_sha256"] != bridge["migration"]["receipt_sha256"] \
            or intent["runtime_privilege_policy_sha256"] \
                != bridge["intent"]["runtime_privilege_policy_sha256"] \
            or intent["namespace_root_receipt_sha256"] != bridge["namespace"]["receipt_sha256"] \
            or intent["operator_state_root_identity_sha256"] \
                != bridge["operator_root_identity_sha256"] \
            or intent["credential_generation_receipt_sha256"] \
                != bridge["credentials"]["receipt_sha256"] \
            or intent["credential_generation_id"] != bridge["credentials"]["generation_id"] \
            or intent["postgres_container_identity_sha256"] != bridge["container"]["identity_sha256"] \
            or intent["postgres_container_id"] != bridge["container"]["container_id"] \
            or intent["database_cluster_identity_sha256"] != bridge["cluster"]["identity_sha256"] \
            or intent["database_cluster_receipt_sha256"] != bridge["cluster"]["receipt_sha256"] \
            or intent["target"] != expected_target or intent["target_head"] != TARGET_HEAD \
            or intent["technical_login_roles"] != TECHNICAL_LOGIN_ROLES \
            or intent["operation"] != "RECONCILE" \
            or intent["runtime_guard_mode"] != "ISOLATED_UAT_POST_MIGRATION_PRE_RUNTIME_BOUND" \
            or intent["desired_state_sha256"] != desired_state_sha256 \
            or intent["owner_reconciliation_projection_sha256"] \
                != canonical_sha256(_owner_reconciliation_projection(intent)):
        fail("ISOLATED_UAT_OWNER_COMPLETION_OPERATOR_INTENT_INVALID")
    _digest(intent, "intent_sha256", "ISOLATED_UAT_OWNER_COMPLETION_OPERATOR_INTENT_INVALID")
    created_at = _time(intent["created_at"], "ISOLATED_UAT_OWNER_COMPLETION_TIME_INVALID")
    migration_completed = _time(
        bridge["migration"]["completed_at"], "ISOLATED_UAT_OWNER_COMPLETION_TIME_INVALID",
    )
    if created_at < migration_completed:
        fail("ISOLATED_UAT_OWNER_COMPLETION_TIME_INVALID")
    states = value["states"]
    if not isinstance(states, list) or len(states) != len(SUCCESS_PHASES):
        fail("ISOLATED_UAT_OWNER_COMPLETION_JOURNAL_CHAIN_INVALID")
    previous_sha256: str | None = None
    previous_time = created_at
    recorded_times: list[datetime] = []
    for sequence, (state, phase) in enumerate(zip(states, SUCCESS_PHASES)):
        state = exact(state, {
            "schema_version", "contract", "operation_id", "intent_sha256", "sequence",
            "phase", "observation_state_sha256", "previous_state_sha256", "recorded_at",
            "state_sha256",
        }, "ISOLATED_UAT_OWNER_COMPLETION_JOURNAL_CHAIN_INVALID")
        recorded_at = _time(
            state["recorded_at"], "ISOLATED_UAT_OWNER_COMPLETION_TIME_INVALID",
        )
        expected_observation = desired_state_sha256 if sequence >= 3 else None
        if state["schema_version"] != 1 or state["contract"] != STATE_CONTRACT \
                or state["operation_id"] != intent["operation_id"] \
                or state["intent_sha256"] != intent["intent_sha256"] \
                or state["sequence"] != sequence or state["phase"] != phase \
                or state["observation_state_sha256"] != expected_observation \
                or state["previous_state_sha256"] != previous_sha256 \
                or recorded_at <= previous_time:
            fail("ISOLATED_UAT_OWNER_COMPLETION_JOURNAL_CHAIN_INVALID")
        _digest(state, "state_sha256", "ISOLATED_UAT_OWNER_COMPLETION_JOURNAL_CHAIN_INVALID")
        previous_sha256 = state["state_sha256"]
        previous_time = recorded_at
        recorded_times.append(recorded_at)
    if value["recovery_authorizations"] != []:
        fail("ISOLATED_UAT_OWNER_COMPLETION_JOURNAL_CHAIN_INVALID")
    observation_at = _time(
        bridge["observation"]["observed_at"], "ISOLATED_UAT_OWNER_COMPLETION_TIME_INVALID",
    )
    runtime_completed_at = _time(
        bridge["receipt"]["completed_at"], "ISOLATED_UAT_OWNER_COMPLETION_TIME_INVALID",
    )
    runtime_verified_at = _time(
        runtime["verified_at"], "ISOLATED_UAT_OWNER_COMPLETION_TIME_INVALID",
    )
    if recorded_times[2] > observation_at or recorded_times[3] < observation_at \
            or observation_at > runtime_completed_at \
            or recorded_times[-1] < runtime_completed_at:
        fail("ISOLATED_UAT_OWNER_COMPLETION_JOURNAL_CHAIN_INVALID")
    receipt = exact(value["owner_receipt"], {
        "schema_version", "contract", "operation_id", "operation", "intent_sha256",
        "final_state_sha256", "owner_reconciliation_projection_sha256",
        "runtime_privilege_observation_sha256", "runtime_privilege_receipt_sha256",
        "desired_state_sha256", "final_privilege_projection_sha256",
        "credential_metadata_continuity_sha256", "completed_at", "result",
        "receipt_sha256",
    }, "ISOLATED_UAT_OWNER_COMPLETION_OPERATOR_RECEIPT_INVALID")
    completed_at = _time(
        receipt["completed_at"], "ISOLATED_UAT_OWNER_COMPLETION_TIME_INVALID",
    )
    if receipt["schema_version"] != 1 or receipt["contract"] != RECEIPT_CONTRACT \
            or receipt["operation_id"] != intent["operation_id"] \
            or receipt["operation"] != "RECONCILE" \
            or receipt["intent_sha256"] != intent["intent_sha256"] \
            or receipt["final_state_sha256"] != states[-1]["state_sha256"] \
            or receipt["owner_reconciliation_projection_sha256"] \
                != intent["owner_reconciliation_projection_sha256"] \
            or receipt["runtime_privilege_observation_sha256"] \
                != bridge["observation"]["evidence_sha256"] \
            or receipt["runtime_privilege_receipt_sha256"] != bridge["receipt"]["receipt_sha256"] \
            or receipt["desired_state_sha256"] != desired_state_sha256 \
            or receipt["final_privilege_projection_sha256"] != desired_state_sha256 \
            or receipt["credential_metadata_continuity_sha256"] \
                != canonical_sha256(_credential_metadata_projection(bridge)) \
            or receipt["result"] != "VERIFIED" \
            or completed_at < previous_time or completed_at > runtime_verified_at \
            or completed_at - created_at > timedelta(
                seconds=policy["invariants"]["max_owner_journal_duration_seconds"]
            ):
        fail("ISOLATED_UAT_OWNER_COMPLETION_OPERATOR_RECEIPT_INVALID")
    _digest(receipt, "receipt_sha256", "ISOLATED_UAT_OWNER_COMPLETION_OPERATOR_RECEIPT_INVALID")
    journal = exact(value["journal"], {
        "profile", "root_marker", "intent_marker", "location", "operation_directory",
        "receipt_index", "archive_status",
    }, "ISOLATED_UAT_OWNER_COMPLETION_JOURNAL_CHAIN_INVALID")
    if journal != {
        "profile": "ISOLATED_UAT_CONTRACT_ONLY",
        "root_marker": ROOT_MARKER,
        "intent_marker": INTENT_MARKER,
        "location": "COMPLETED",
        "operation_directory": f"{intent['operation_id']}.{intent['intent_sha256']}",
        "receipt_index": f"{intent['operation_id']}.{receipt['receipt_sha256']}.json",
        "archive_status": "ACTIVE_RENAMED_TO_COMPLETED_RECEIPT_INDEX_MATCHED",
    }:
        fail("ISOLATED_UAT_OWNER_COMPLETION_JOURNAL_CHAIN_INVALID")
    terminal = exact(value["terminal"], {
        "location", "phase", "state_sha256", "receipt_sha256", "completed_at", "result",
    }, "ISOLATED_UAT_OWNER_COMPLETION_OPERATOR_RECEIPT_INVALID")
    if terminal != {
        "location": "COMPLETED",
        "phase": "COMMITTED",
        "state_sha256": states[-1]["state_sha256"],
        "receipt_sha256": receipt["receipt_sha256"],
        "completed_at": receipt["completed_at"],
        "result": "VERIFIED",
    }:
        fail("ISOLATED_UAT_OWNER_COMPLETION_OPERATOR_RECEIPT_INVALID")
    _digest(value, "log_sha256", "ISOLATED_UAT_OWNER_COMPLETION_LOG_DIGEST_INVALID")
    return value


def validate_owner_completion_contracts(
    *,
    control_plan: Any,
    external_anchor_base_plan: Any,
    namespace_root_receipt: Any,
    credential_generation_receipt: Any,
    postgres_container_identity: Any,
    database_cluster_identity: Any,
    external_anchor_policy: Any,
    runtime_intents: Any,
    runtime_receipts: Any,
    runtime_evidence_payloads: Any,
    expected_migration_allowlist: Any,
    runtime_receipt_binding: Any,
    verification_time: Any,
    runtime_intent_policy: Any,
    runtime_receipt_policy: Any,
    runtime_receipt_policy_raw: Any,
    expected_runtime_policy_roots: Any,
    runtime_policy_sources: dict[str, bytes],
    owner_completion_log: Any,
    policy: Any,
    policy_sources: dict[str, bytes],
) -> dict[str, Any]:
    """Revalidate both upstream chains, then validate the pure owner join."""
    try:
        policy = validate_policy(policy, policy_sources)
        plan, base_plan = _validate_plan(control_plan, external_anchor_base_plan, policy)
        try:
            bound_external_anchor_policy = json.loads(
                policy_sources[
                    "operations/isolated-uat-external-anchor-policy-v1.json"
                ].decode("utf-8")
            )
        except (AttributeError, KeyError, TypeError, UnicodeDecodeError, json.JSONDecodeError):
            fail("ISOLATED_UAT_OWNER_COMPLETION_UPSTREAM_INVALID")
        if _clone(
            external_anchor_policy, "ISOLATED_UAT_OWNER_COMPLETION_UPSTREAM_INVALID",
        ) != bound_external_anchor_policy:
            fail("ISOLATED_UAT_OWNER_COMPLETION_UPSTREAM_INVALID")
        try:
            external_anchor_validation = EXTERNAL_ANCHORS.validate_external_anchor_contracts(
                control_plan=base_plan,
                namespace_root_receipt=namespace_root_receipt,
                credential_generation_receipt=credential_generation_receipt,
                postgres_container_identity=postgres_container_identity,
                database_cluster_identity=database_cluster_identity,
                policy=bound_external_anchor_policy,
            )
            runtime_receipt_validation = RUNTIME_RECEIPTS.validate_receipt_chain(
                intents=runtime_intents,
                receipts=runtime_receipts,
                evidence_payloads=runtime_evidence_payloads,
                expected_migration_allowlist=expected_migration_allowlist,
                binding=runtime_receipt_binding,
                verification_time=verification_time,
                intent_policy=runtime_intent_policy,
                receipt_policy=runtime_receipt_policy,
                receipt_policy_raw=runtime_receipt_policy_raw,
                expected_policy_roots=expected_runtime_policy_roots,
                policy_sources=runtime_policy_sources,
            )
        except (EXTERNAL_ANCHORS.ContractError, RUNTIME_RECEIPTS.ContractError):
            fail("ISOLATED_UAT_OWNER_COMPLETION_UPSTREAM_INVALID")
        external, runtime = _validate_upstream_results(
            external_anchor_validation, runtime_receipt_validation, plan, base_plan,
        )
        runtime_receipts = _clone(
            runtime_receipts, "ISOLATED_UAT_OWNER_COMPLETION_UPSTREAM_INVALID",
        )
        runtime_intents = _clone(
            runtime_intents, "ISOLATED_UAT_OWNER_COMPLETION_UPSTREAM_INVALID",
        )
        runtime_evidence_payloads = _clone(
            runtime_evidence_payloads, "ISOLATED_UAT_OWNER_COMPLETION_UPSTREAM_INVALID",
        )
        bridge = _validate_bridge_objects(
            base_plan=base_plan,
            external=external,
            runtime=runtime,
            namespace_root_receipt=namespace_root_receipt,
            credential_generation_receipt=credential_generation_receipt,
            postgres_container_identity=postgres_container_identity,
            database_cluster_identity=database_cluster_identity,
            database_target_identity=runtime_receipts["database_target_identity"],
            migration_execution_receipt=runtime_receipts["migration_execution_receipt"],
            runtime_privilege_intent=runtime_intents["RUNTIME_PRIVILEGE"],
            runtime_privilege_observation=runtime_evidence_payloads[
                "runtime_privilege_observation"
            ],
            runtime_privilege_receipt=runtime_receipts["runtime_privilege_receipt"],
        )
        owner = _validate_owner_log(
            owner_completion_log, plan, base_plan, runtime, bridge, policy,
        )
        body = {
            "schema_version": 1,
            "contract": VALIDATION_CONTRACT,
            "project": base_plan["project"],
            "request_id": base_plan["request_id"],
            "operation_id": runtime["operation_id"],
            "control_plan_sha256": plan["plan_sha256"],
            "external_anchor_base_plan_sha256": base_plan["plan_sha256"],
            "policy_sha256": policy["policy_sha256"],
            "external_anchor_validation_sha256": external["validation_sha256"],
            "runtime_receipt_validation_sha256": runtime["validation_sha256"],
            "namespace_root_receipt_sha256": bridge["namespace"]["receipt_sha256"],
            "operator_state_root_identity_sha256": bridge[
                "operator_root_identity_sha256"
            ],
            "runtime_privilege_intent_sha256": bridge["intent"]["intent_sha256"],
            "runtime_privilege_observation_sha256": bridge["observation"]["evidence_sha256"],
            "runtime_privilege_receipt_sha256": bridge["receipt"]["receipt_sha256"],
            "owner_completion_log_sha256": owner["log_sha256"],
            **VALIDATION_OUTPUT,
        }
        return {**body, "validation_sha256": canonical_sha256(body)}
    except ContractError:
        raise
    except (
        AttributeError, IndexError, KeyError, OverflowError, RecursionError, TypeError,
        UnicodeError, ValueError,
    ):
        fail("ISOLATED_UAT_OWNER_COMPLETION_FIELDS_INVALID")


def require_owner_completion_publisher() -> None:
    fail("ISOLATED_UAT_OWNER_COMPLETION_PUBLISHER_NOT_IMPLEMENTED")


def require_owner_completion_runtime_observer() -> None:
    fail("ISOLATED_UAT_OWNER_COMPLETION_RUNTIME_OBSERVER_NOT_IMPLEMENTED")
