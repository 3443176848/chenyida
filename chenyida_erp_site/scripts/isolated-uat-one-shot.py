#!/usr/bin/python3
"""Compile the fixed one-shot plan for one isolated UAT namespace.

The default command is read-only.  The execute command is deliberately
fail-closed while the bound control policy keeps deployment authorization off.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any, BinaryIO, TextIO


SITE_ROOT = Path(__file__).resolve().parent.parent
POLICY_VALIDATOR_PATH = SITE_ROOT / "scripts/isolated-uat-control-plane-policy.py"
LEGACY_RECEIPT_BINDINGS_PATH = SITE_ROOT / "operations/isolated-uat-one-shot-action-bindings-v3.json"
ACTIVE_ACTION_BINDINGS_PATH = SITE_ROOT / "operations/isolated-uat-one-shot-action-bindings-v4.json"
BINDINGS_PATH = ACTIVE_ACTION_BINDINGS_PATH
RUNTIME_CONTRACTS_PATH = SITE_ROOT / "scripts/isolated-uat-runtime-contracts.py"
RUNTIME_CONTRACT_POLICY_PATH = SITE_ROOT / "operations/isolated-uat-runtime-contract-policy-v1.json"
RUNTIME_RECEIPTS_PATH = SITE_ROOT / "scripts/isolated-uat-runtime-receipts.py"
RUNTIME_RECEIPT_POLICY_PATH = SITE_ROOT / "operations/isolated-uat-runtime-receipt-policy-v1.json"
EXTERNAL_ANCHORS_PATH = SITE_ROOT / "scripts/isolated-uat-external-anchor-contracts.py"
EXTERNAL_ANCHOR_POLICY_PATH = SITE_ROOT / "operations/isolated-uat-external-anchor-policy-v1.json"
PRIVILEGE_POLICY_PATH = SITE_ROOT / "operations/postgresql-runtime-privilege-policy-v2.json"
PLAN_CONTRACT = "chenyida-erp-isolated-uat-one-shot-plan/v4"
BINDINGS_CONTRACT = "chenyida-erp-isolated-uat-one-shot-action-bindings/v4"
BINDING_IMPLEMENTATION_STATUS = (
    "V3_ACTIONS_EXACTLY_INHERITED_EXTERNAL_ANCHOR_CONTRACTS_VALID_RUNTIME_FACTS_NOT_ESTABLISHED"
)
LEGACY_BINDING_IMPLEMENTATION_STATUS = (
    "FIXED_BINDINGS_RECEIPT_CHAIN_VALIDATORS_IMPLEMENTED_RUNTIME_PATH_NOT_IMPLEMENTED"
)
EXPECTED_BINDING_SHA256 = "fb83e0f20823b632525823f3d6c012769501fff1aec9763abc64d8d10d2b050b"
EXPECTED_BINDING_RAW_SHA256 = "4858b8c14846a69ed969f5476828631362830675399e788f705c35e1cfe34262"
EXPECTED_LEGACY_BINDING_SHA256 = "50ddd73fb4745c8fcc0b91fd7e4130e2cb3a9ef0d2f52773c64cd6112afc74bd"
EXPECTED_LEGACY_BINDING_RAW_SHA256 = "da69ce3a276ef68f9f6cece12f281ea89584930d481afef19fcf930dae8de5c4"
EXPECTED_EXTERNAL_ANCHOR_POLICY_RAW_SHA256 = "92c59a9f9f800a243324c0a6e24ca8258e58483fe759cf30c2c98d53aead6ef3"
ENTRYPOINT_ID = "chenyida-erp-isolated-uat-one-shot-v4"
PLAN_MODE = "READ_ONLY_PLAN"
FORBIDDEN_PRODUCTION_ENTRYPOINTS = [
    "scripts/postgresql-runtime-privilege-runner.mjs",
    "scripts/release-supervisor-launcher.py",
]
ACTION_BINDING_FIELDS = {
    "ordinal", "action", "effect", "handler_id", "adapter_method",
    "sources", "inputs", "outputs",
}


def load_policy_validator() -> Any:
    specification = importlib.util.spec_from_file_location(
        "isolated_uat_control_plane_policy",
        POLICY_VALIDATOR_PATH,
    )
    if specification is None or specification.loader is None:
        raise RuntimeError("isolated UAT control-plane validator cannot be loaded")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


POLICY = load_policy_validator()
ContractError = POLICY.ContractError


def load_runtime_contracts() -> Any:
    specification = importlib.util.spec_from_file_location(
        "isolated_uat_runtime_contracts",
        RUNTIME_CONTRACTS_PATH,
    )
    if specification is None or specification.loader is None:
        raise RuntimeError("isolated UAT runtime contracts cannot be loaded")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


RUNTIME_CONTRACTS = load_runtime_contracts()


def load_runtime_receipts() -> Any:
    specification = importlib.util.spec_from_file_location(
        "isolated_uat_runtime_receipts",
        RUNTIME_RECEIPTS_PATH,
    )
    if specification is None or specification.loader is None:
        raise RuntimeError("isolated UAT runtime receipts cannot be loaded")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


RUNTIME_RECEIPTS = load_runtime_receipts()


def load_external_anchors() -> Any:
    specification = importlib.util.spec_from_file_location(
        "isolated_uat_external_anchor_contracts",
        EXTERNAL_ANCHORS_PATH,
    )
    if specification is None or specification.loader is None:
        raise RuntimeError("isolated UAT external anchor contracts cannot be loaded")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


EXTERNAL_ANCHORS = load_external_anchors()


def fail(code: str) -> None:
    raise ContractError(code)


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def read_legacy_receipt_bindings(
    path: Path = LEGACY_RECEIPT_BINDINGS_PATH,
) -> dict[str, Any]:
    try:
        value = POLICY.parse_json(path.read_bytes(), "ISOLATED_UAT_ACTION_BINDING_FILE_INVALID")
    except OSError:
        fail("ISOLATED_UAT_ACTION_BINDING_FILE_INVALID")
    POLICY.exact(value, {
        "schema_version", "contract", "binding_id", "implementation_status",
        "execution_boundary", "actions", "receipt_chain", "binding_sha256",
    }, "ISOLATED_UAT_ACTION_BINDING_FIELDS_INVALID")
    if value["schema_version"] != 3 \
            or value["contract"] != "chenyida-erp-isolated-uat-one-shot-action-bindings/v3" \
            or value["binding_id"] != "chenyida-erp-isolated-uat-fixed-actions-v3" \
            or value["implementation_status"] != LEGACY_BINDING_IMPLEMENTATION_STATUS \
            or value["execution_boundary"] != {
                "evidence_scope": "ISOLATED_UAT_ONLY",
                "shell_allowed": False,
                "free_form_argv_allowed": False,
                "production_entrypoints_allowed": False,
                "production_release_identity_allowed": False,
                "runtime_path_implemented": False,
                "source_binding_scope": "DIRECT_CONTRACT_REFERENCES_ONLY",
                "receipt_validation_scope": (
                    "PURE_CONTRACT_SEMANTICS_RUNTIME_FACTS_NOT_ESTABLISHED"
                ),
            }:
        fail("ISOLATED_UAT_ACTION_BINDING_IDENTITY_INVALID")
    actions = value["actions"]
    if not isinstance(actions, list) or len(actions) != 9:
        fail("ISOLATED_UAT_ACTION_BINDING_ACTIONS_INVALID")
    previous_outputs: set[str] = set()
    for ordinal, action in enumerate(actions, 1):
        POLICY.exact(action, ACTION_BINDING_FIELDS, "ISOLATED_UAT_ACTION_BINDING_ACTION_INVALID")
        if action["ordinal"] != ordinal \
                or action["action"] not in {item[0] for item in PLANNED_ACTIONS} \
                or action["action"] != PLANNED_ACTIONS[ordinal - 1][0] \
                or action["effect"] != PLANNED_ACTIONS[ordinal - 1][1] \
                or not all(isinstance(action[field], str) and action[field] for field in ("handler_id", "adapter_method")):
            fail("ISOLATED_UAT_ACTION_BINDING_ACTION_INVALID")
        for field in ("sources", "inputs", "outputs"):
            items = action[field]
            if not isinstance(items, list) or not items or any(not isinstance(item, str) or not item for item in items) \
                    or len(set(items)) != len(items):
                fail("ISOLATED_UAT_ACTION_BINDING_ACTION_INVALID")
        if any(source in FORBIDDEN_PRODUCTION_ENTRYPOINTS for source in action["sources"]):
            fail("ISOLATED_UAT_ACTION_BINDING_PRODUCTION_SOURCE_FORBIDDEN")
        available = {
            "policy", "request", "project", "roots", "runtime_secret_root", "backup_credential_root",
            "release_candidate_root", "release_identity_root", "operator_state_root", "backup_root",
            "one_shot_state_root", "release_identity_reader_gid",
            "runtime_secret_filenames", "backup_service_filename", "password_format", "resolved_compose_sha256",
            "images", "ports", "technical_login_roles", "package_version", "migration_current_head", "migration_target_head",
            "migration_allowlist_sha256", "git_commit", "git_tree", "host_ip", "web_port",
            "migration_allowlist_entries", "plan_sha256", "runtime_contract_policy",
            "runtime_receipt_policy",
        } | previous_outputs
        if any(item not in available for item in action["inputs"]):
            fail("ISOLATED_UAT_ACTION_BINDING_INPUT_ORDER_INVALID")
        if any(item in previous_outputs for item in action["outputs"]):
            fail("ISOLATED_UAT_ACTION_BINDING_OUTPUT_REUSED")
        previous_outputs.update(action["outputs"])
    body = {key: item for key, item in value.items() if key != "binding_sha256"}
    if value["binding_sha256"] != EXPECTED_LEGACY_BINDING_SHA256 \
            or not POLICY.SHA256.fullmatch(value["binding_sha256"] if isinstance(value["binding_sha256"], str) else "") \
            or POLICY.canonical_sha256(body) != value["binding_sha256"]:
        fail("ISOLATED_UAT_ACTION_BINDING_SHA256_INVALID")
    try:
        RUNTIME_RECEIPTS.validate_action_binding(value, EXPECTED_LEGACY_BINDING_SHA256)
    except RUNTIME_RECEIPTS.ContractError as error:
        fail(str(error))
    return value


def read_bindings(path: Path = ACTIVE_ACTION_BINDINGS_PATH) -> dict[str, Any]:
    try:
        raw = path.read_bytes()
        value = POLICY.parse_json(raw, "ISOLATED_UAT_ACTION_BINDING_FILE_INVALID")
    except OSError:
        fail("ISOLATED_UAT_ACTION_BINDING_FILE_INVALID")
    POLICY.exact(value, {
        "schema_version", "contract", "binding_id", "implementation_status",
        "execution_boundary", "base_binding", "source_extensions",
        "external_anchor_contract", "binding_sha256",
    }, "ISOLATED_UAT_ACTION_BINDING_FIELDS_INVALID")
    if value["schema_version"] != 4 or value["contract"] != BINDINGS_CONTRACT \
            or value["binding_id"] != "chenyida-erp-isolated-uat-fixed-actions-v4" \
            or value["implementation_status"] != BINDING_IMPLEMENTATION_STATUS \
            or hashlib.sha256(raw).hexdigest() != EXPECTED_BINDING_RAW_SHA256:
        fail("ISOLATED_UAT_ACTION_BINDING_IDENTITY_INVALID")
    body = {key: item for key, item in value.items() if key != "binding_sha256"}
    if value["binding_sha256"] != EXPECTED_BINDING_SHA256 \
            or POLICY.canonical_sha256(body) != value["binding_sha256"]:
        fail("ISOLATED_UAT_ACTION_BINDING_SHA256_INVALID")
    legacy = read_legacy_receipt_bindings()
    try:
        legacy_raw_sha256 = hashlib.sha256(LEGACY_RECEIPT_BINDINGS_PATH.read_bytes()).hexdigest()
    except OSError:
        fail("ISOLATED_UAT_ACTION_BINDING_FILE_INVALID")
    base = value["base_binding"]
    if not isinstance(base, dict) or base.get("contract") != legacy["contract"] \
            or base.get("binding_id") != legacy["binding_id"] \
            or base.get("binding_sha256") != legacy["binding_sha256"] \
            or base.get("raw_sha256") != legacy_raw_sha256 \
            or legacy_raw_sha256 != EXPECTED_LEGACY_BINDING_RAW_SHA256 \
            or base.get("action_inheritance") != {
                "mode": "EXACT_NO_OVERRIDE", "action_count": 9,
                "ordinal_sequence": list(range(1, 10)), "status": "EXACTLY_INHERITED",
            } or base.get("receipt_chain_inheritance") != {
                "mode": "EXACT_NO_OVERRIDE", "node_count": 18, "status": "EXACTLY_INHERITED",
            }:
        fail("ISOLATED_UAT_ACTION_BINDING_BASE_INVALID")
    expected_sources = [
        "operations/isolated-uat-external-anchor-policy-v1.json",
        "scripts/isolated-uat-external-anchor-contracts.py",
    ]
    extensions = value["source_extensions"]
    if not isinstance(extensions, list) or [item.get("ordinal") if isinstance(item, dict) else None for item in extensions] != [1, 2, 3, 4, 9]:
        fail("ISOLATED_UAT_ACTION_BINDING_EXTENSION_INVALID")
    extension_by_ordinal: dict[int, list[str]] = {}
    for extension in extensions:
        POLICY.exact(extension, {"ordinal", "inheritance_status", "additional_sources"}, "ISOLATED_UAT_ACTION_BINDING_EXTENSION_INVALID")
        if extension["inheritance_status"] != "BASE_ACTION_EXACT_NO_OVERRIDE" \
                or extension["additional_sources"] != expected_sources:
            fail("ISOLATED_UAT_ACTION_BINDING_EXTENSION_INVALID")
        extension_by_ordinal[extension["ordinal"]] = extension["additional_sources"]
    external = value["external_anchor_contract"]
    if not isinstance(external, dict) \
            or external.get("policy_source") != expected_sources[0] \
            or external.get("policy_contract") != EXTERNAL_ANCHORS.POLICY_CONTRACT \
            or external.get("validator_source") != expected_sources[1] \
            or external.get("validator_method") != "validate_external_anchor_contracts" \
            or external.get("validation_status") != "PURE_EXTERNAL_ANCHOR_CONTRACTS_VALID_SOURCE_CALLER_INJECTED_NOT_ATTESTED" \
            or external.get("runtime_fact_status") != "NOT_ESTABLISHED_BY_PURE_VALIDATION" \
            or not isinstance(external.get("external_nodes"), list) \
            or len(external["external_nodes"]) != 5 \
            or not isinstance(external.get("external_anchor_mappings"), list) \
            or [item.get("anchor") if isinstance(item, dict) else None for item in external["external_anchor_mappings"]] != [
                "credential_generation_receipt_sha256", "database_cluster_identity_sha256",
                "release_candidate_root_identity_sha256", "one_shot_state_root_identity_sha256",
            ]:
        fail("ISOLATED_UAT_ACTION_BINDING_EXTERNAL_CONTRACT_INVALID")
    actions = []
    for action in legacy["actions"]:
        sources = action["sources"] + extension_by_ordinal.get(action["ordinal"], [])
        if len(sources) != len(set(sources)):
            fail("ISOLATED_UAT_ACTION_BINDING_EXTENSION_INVALID")
        actions.append({**action, "sources": sources})
    return {
        "schema_version": value["schema_version"],
        "contract": value["contract"],
        "binding_id": value["binding_id"],
        "implementation_status": value["implementation_status"],
        "execution_boundary": value["execution_boundary"],
        "base_binding": value["base_binding"],
        "actions": actions,
        "receipt_chain": legacy["receipt_chain"],
        "external_anchor_contract": external,
        "binding_sha256": value["binding_sha256"],
    }


def read_runtime_contract_policy(path: Path = RUNTIME_CONTRACT_POLICY_PATH) -> dict[str, Any]:
    try:
        value = POLICY.parse_json(
            path.read_bytes(),
            "ISOLATED_UAT_RUNTIME_CONTRACT_JSON_INVALID",
        )
        sources = {
            "scripts/isolated-uat-runtime-contracts.py": RUNTIME_CONTRACTS_PATH.read_bytes(),
        }
    except OSError:
        fail("ISOLATED_UAT_RUNTIME_CONTRACT_JSON_INVALID")
    try:
        return RUNTIME_CONTRACTS.validate_policy(value, sources)
    except RUNTIME_CONTRACTS.ContractError as error:
        fail(str(error))


def read_runtime_receipt_policy(path: Path = RUNTIME_RECEIPT_POLICY_PATH) -> dict[str, Any]:
    try:
        value = POLICY.parse_json(
            path.read_bytes(),
            "ISOLATED_UAT_RUNTIME_RECEIPT_POLICY_JSON_INVALID",
        )
        intent_policy = read_runtime_contract_policy()
        sources = {
            "operations/isolated-uat-runtime-contract-policy-v1.json": (
                RUNTIME_CONTRACT_POLICY_PATH.read_bytes()
            ),
            "operations/postgresql-runtime-privilege-policy-v2.json": (
                PRIVILEGE_POLICY_PATH.read_bytes()
            ),
            "operations/isolated-uat-one-shot-action-bindings-v3.json": (
                LEGACY_RECEIPT_BINDINGS_PATH.read_bytes()
            ),
            "scripts/isolated-uat-runtime-receipts.py": RUNTIME_RECEIPTS_PATH.read_bytes(),
        }
    except OSError:
        fail("ISOLATED_UAT_RUNTIME_RECEIPT_POLICY_JSON_INVALID")
    try:
        return RUNTIME_RECEIPTS.validate_policy(value, sources, intent_policy)
    except RUNTIME_RECEIPTS.ContractError as error:
        fail(str(error))


def read_external_anchor_policy(
    path: Path = EXTERNAL_ANCHOR_POLICY_PATH,
) -> dict[str, Any]:
    try:
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != EXPECTED_EXTERNAL_ANCHOR_POLICY_RAW_SHA256:
            fail("ISOLATED_UAT_EXTERNAL_POLICY_DIGEST_MISMATCH")
        value = POLICY.parse_json(raw, "ISOLATED_UAT_EXTERNAL_POLICY_JSON_INVALID")
        sources = {
            "operations/isolated-uat-runtime-contract-policy-v1.json": (
                RUNTIME_CONTRACT_POLICY_PATH.read_bytes()
            ),
            "operations/isolated-uat-runtime-receipt-policy-v1.json": (
                RUNTIME_RECEIPT_POLICY_PATH.read_bytes()
            ),
            "operations/runtime-secret-file-policy-v1.json": (
                SITE_ROOT / "operations/runtime-secret-file-policy-v1.json"
            ).read_bytes(),
            "scripts/isolated-uat-external-anchor-contracts.py": (
                EXTERNAL_ANCHORS_PATH.read_bytes()
            ),
        }
    except OSError:
        fail("ISOLATED_UAT_EXTERNAL_POLICY_JSON_INVALID")
    try:
        return EXTERNAL_ANCHORS.validate_policy(value, sources)
    except EXTERNAL_ANCHORS.ContractError as error:
        fail(str(error))


PLANNED_ACTIONS = [
    ("VERIFY_EXACT_INPUTS", "READ_ONLY"),
    ("PREPARE_PRIVATE_NAMESPACE_ROOTS", "MUTATING"),
    ("PROVISION_DISTINCT_CREDENTIAL_FILES", "MUTATING"),
    ("START_POSTGRES_ONLY", "MUTATING"),
    ("INITIALIZE_DATABASE_IDENTITY_AND_LOGIN_ROLES", "MUTATING"),
    ("MIGRATE_EMPTY_DATABASE_TO_BOUND_HEAD", "MUTATING"),
    ("RECONCILE_FINAL_RUNTIME_PRIVILEGES", "MUTATING"),
    ("START_BOUND_RUNTIME_SERVICES", "MUTATING"),
    ("VERIFY_AND_PUBLISH_ISOLATED_UAT_EVIDENCE", "MUTATING"),
]


def build_plan(request: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    policy = POLICY.validate_policy(policy)
    request = POLICY.validate_request(request, policy)
    bindings = read_bindings()
    legacy_receipt_bindings = read_legacy_receipt_bindings()
    runtime_contract_policy = read_runtime_contract_policy()
    runtime_receipt_policy = read_runtime_receipt_policy()
    external_anchor_policy = read_external_anchor_policy()
    source_state = POLICY.source_state()
    if source_state["package_version"] != policy["release"]["package_version"] \
            or source_state["package_version"] != request["source"]["package_version"] \
            or source_state["current_head"] != policy["database"]["current_head"] \
            or source_state["current_head"] != request["source"]["migration_current_head"] \
            or source_state["target_head"] != policy["database"]["target_head"] \
            or source_state["target_head"] != request["source"]["migration_target_head"] \
            or source_state["migration_count"] != policy["database"]["migration_count"] \
            or source_state["migration_allowlist_sha256"] \
                != policy["database"]["migration_allowlist_sha256"] \
            or source_state["migration_allowlist_sha256"] \
                != request["source"]["migration_allowlist_sha256"]:
        fail("ISOLATED_UAT_SOURCE_STATE_CHANGED_DURING_PLAN")
    policy_sources = {item["path"] for item in policy["source_binding"]}
    referenced_sources = {source for action in bindings["actions"] for source in action["sources"]}
    runtime_contract_sources = {
        "operations/isolated-uat-runtime-contract-policy-v1.json",
        "scripts/isolated-uat-runtime-contracts.py",
        "operations/isolated-uat-runtime-receipt-policy-v1.json",
        "scripts/isolated-uat-runtime-receipts.py",
        "operations/isolated-uat-one-shot-action-bindings-v3.json",
        "operations/isolated-uat-one-shot-action-bindings-v4.json",
        "operations/isolated-uat-external-anchor-policy-v1.json",
        "scripts/isolated-uat-external-anchor-contracts.py",
    }
    if not (referenced_sources | runtime_contract_sources).issubset(policy_sources):
        fail("ISOLATED_UAT_ACTION_BINDING_SOURCE_UNBOUND")
    actions = [
        {
            "ordinal": binding["ordinal"],
            "action": binding["action"],
            "mutates_runtime": binding["effect"] == "MUTATING",
            "handler_id": binding["handler_id"],
            "adapter_method": binding["adapter_method"],
        }
        for binding in bindings["actions"]
    ]
    body = {
        "schema_version": 4,
        "contract": PLAN_CONTRACT,
        "entrypoint_id": ENTRYPOINT_ID,
        "mode": PLAN_MODE,
        "execution_authorized": False,
        "action_binding_id": bindings["binding_id"],
        "action_binding_sha256": bindings["binding_sha256"],
        "action_binding_status": bindings["implementation_status"],
        "runtime_contract_policy_sha256": runtime_contract_policy["policy_sha256"],
        "runtime_contract_source_closure_sha256": runtime_contract_policy["source_closure"][
            "source_closure_sha256"
        ],
        "runtime_contract_capability_status": runtime_contract_policy["capability_status"],
        "runtime_receipt_policy_sha256": runtime_receipt_policy["policy_sha256"],
        "runtime_receipt_source_closure_sha256": runtime_receipt_policy["source_closure"][
            "source_closure_sha256"
        ],
        "runtime_receipt_capability_status": runtime_receipt_policy["capability_status"],
        "runtime_receipt_validation_status": "NOT_RUN_NO_RECEIPTS",
        "runtime_receipt_success_output_contract": runtime_receipt_policy["validation_output"],
        "external_anchor_policy_sha256": external_anchor_policy["policy_sha256"],
        "external_anchor_source_closure_sha256": external_anchor_policy["source_closure"][
            "source_closure_sha256"
        ],
        "external_anchor_capability_status": external_anchor_policy["capability_status"],
        "external_anchor_validation_status": "NOT_RUN_NO_EXTERNAL_EVIDENCE",
        "external_anchor_success_output_contract": external_anchor_policy["validation_output"],
        "receipt_chain_binding": {
            "internal_contract": legacy_receipt_bindings["receipt_chain"]["contract"],
            "internal_validator_method": legacy_receipt_bindings["receipt_chain"]["validator_method"],
            "internal_validation_status": legacy_receipt_bindings["receipt_chain"]["validation_status"],
            "internal_node_count": len(legacy_receipt_bindings["receipt_chain"]["nodes"]),
            "internal_external_root_validation_statuses": sorted({
                item["validation_status"]
                for item in legacy_receipt_bindings["receipt_chain"]["external_roots"]
            }),
            "external_contract": bindings["external_anchor_contract"]["policy_contract"],
            "external_validator_method": bindings["external_anchor_contract"]["validator_method"],
            "external_validation_status": "NOT_RUN_NO_EXTERNAL_EVIDENCE",
            "external_node_count": len(bindings["external_anchor_contract"]["external_nodes"]),
            "external_root_contract_statuses": sorted({
                item["validation_status"]
                for item in bindings["external_anchor_contract"]["external_anchor_mappings"]
            }),
        },
        "request_id": request["request_id"],
        "policy_sha256": policy["policy_sha256"],
        "project": request["project"],
        "roots": request["roots"],
        "source": request["source"],
        "images": request["images"],
        "ports": request["ports"],
        "database": {
            "name": policy["database"]["name"],
            "current_head": policy["database"]["current_head"],
            "target_head": policy["database"]["target_head"],
            "technical_login_roles": sorted(policy["database"]["role_credentials"]),
        },
        "migration_allowlist_entries": source_state["migration_allowlist_entries"],
        "actions": actions,
        "failure_boundary": {
            "cleanup_scope": "EXACT_PROJECT_NAMESPACE_ONLY",
            "recovery": policy["safety"]["recovery"],
            "quarantine_before_cleanup": True,
        },
        "forbidden_production_entrypoints": FORBIDDEN_PRODUCTION_ENTRYPOINTS,
    }
    return {**body, "plan_sha256": POLICY.canonical_sha256(body)}


def validate_plan(value: dict[str, Any], request: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    expected = build_plan(request, policy)
    if canonical_json(value) != canonical_json(expected):
        fail("ISOLATED_UAT_ONE_SHOT_PLAN_INVALID")
    return value


def assert_execution_allowed(policy: dict[str, Any]) -> None:
    if policy["deployment_authorized"] is not True \
            or policy["safety"]["runtime_actions_authorized"] != [item[0] for item in PLANNED_ACTIONS] \
            or policy["release"]["implementation_status"] != "EXECUTABLE" \
            or policy["database"]["implementation_status"] != "EXECUTABLE":
        fail("ISOLATED_UAT_ONE_SHOT_EXECUTION_NOT_AUTHORIZED")


def require_runtime_backend() -> None:
    try:
        EXTERNAL_ANCHORS.require_external_anchor_publisher()
        RUNTIME_RECEIPTS.require_receipt_publisher()
        RUNTIME_CONTRACTS.require_runtime_backend()
    except (
        EXTERNAL_ANCHORS.ContractError,
        RUNTIME_RECEIPTS.ContractError,
        RUNTIME_CONTRACTS.ContractError,
    ) as error:
        fail(str(error))


def read_request(stream: BinaryIO) -> dict[str, Any]:
    return POLICY.parse_json(
        stream.read(POLICY.MAX_JSON_BYTES + 1),
        "ISOLATED_UAT_ONE_SHOT_REQUEST_JSON_INVALID",
    )


def main(
    argv: list[str] | None = None,
    *,
    input_stream: BinaryIO | None = None,
    output_stream: TextIO | None = None,
    error_stream: TextIO | None = None,
) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", default="plan", choices=("plan", "execute"))
    parser.add_argument("--policy", required=True)
    arguments = parser.parse_args(argv)
    source = input_stream or sys.stdin.buffer
    output = output_stream or sys.stdout
    errors = error_stream or sys.stderr
    try:
        policy = POLICY.read_policy(Path(arguments.policy))
        request = read_request(source)
        plan = build_plan(request, policy)
        if arguments.command == "execute":
            assert_execution_allowed(policy)
            require_runtime_backend()
        output.write(canonical_json(plan))
    except ContractError as error:
        errors.write(f"{error}\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
