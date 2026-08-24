#!/usr/bin/python3
"""Compile the fixed one-shot plan for one isolated UAT namespace.

The default command is read-only.  The execute command is deliberately
fail-closed while the bound control policy keeps deployment authorization off.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any, BinaryIO, TextIO


SITE_ROOT = Path(__file__).resolve().parent.parent
POLICY_VALIDATOR_PATH = SITE_ROOT / "scripts/isolated-uat-control-plane-policy.py"
BINDINGS_PATH = SITE_ROOT / "operations/isolated-uat-one-shot-action-bindings-v3.json"
RUNTIME_CONTRACTS_PATH = SITE_ROOT / "scripts/isolated-uat-runtime-contracts.py"
RUNTIME_CONTRACT_POLICY_PATH = SITE_ROOT / "operations/isolated-uat-runtime-contract-policy-v1.json"
RUNTIME_RECEIPTS_PATH = SITE_ROOT / "scripts/isolated-uat-runtime-receipts.py"
RUNTIME_RECEIPT_POLICY_PATH = SITE_ROOT / "operations/isolated-uat-runtime-receipt-policy-v1.json"
PRIVILEGE_POLICY_PATH = SITE_ROOT / "operations/postgresql-runtime-privilege-policy-v2.json"
PLAN_CONTRACT = "chenyida-erp-isolated-uat-one-shot-plan/v3"
BINDINGS_CONTRACT = "chenyida-erp-isolated-uat-one-shot-action-bindings/v3"
BINDING_IMPLEMENTATION_STATUS = (
    "FIXED_BINDINGS_RECEIPT_CHAIN_VALIDATORS_IMPLEMENTED_RUNTIME_PATH_NOT_IMPLEMENTED"
)
EXPECTED_BINDING_SHA256 = "50ddd73fb4745c8fcc0b91fd7e4130e2cb3a9ef0d2f52773c64cd6112afc74bd"
ENTRYPOINT_ID = "chenyida-erp-isolated-uat-one-shot-v3"
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


def fail(code: str) -> None:
    raise ContractError(code)


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def read_bindings(path: Path = BINDINGS_PATH) -> dict[str, Any]:
    try:
        value = POLICY.parse_json(path.read_bytes(), "ISOLATED_UAT_ACTION_BINDING_FILE_INVALID")
    except OSError:
        fail("ISOLATED_UAT_ACTION_BINDING_FILE_INVALID")
    POLICY.exact(value, {
        "schema_version", "contract", "binding_id", "implementation_status",
        "execution_boundary", "actions", "receipt_chain", "binding_sha256",
    }, "ISOLATED_UAT_ACTION_BINDING_FIELDS_INVALID")
    if value["schema_version"] != 3 or value["contract"] != BINDINGS_CONTRACT \
            or value["binding_id"] != "chenyida-erp-isolated-uat-fixed-actions-v3" \
            or value["implementation_status"] != BINDING_IMPLEMENTATION_STATUS \
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
    if value["binding_sha256"] != EXPECTED_BINDING_SHA256 \
            or not POLICY.SHA256.fullmatch(value["binding_sha256"] if isinstance(value["binding_sha256"], str) else "") \
            or POLICY.canonical_sha256(body) != value["binding_sha256"]:
        fail("ISOLATED_UAT_ACTION_BINDING_SHA256_INVALID")
    try:
        RUNTIME_RECEIPTS.validate_action_binding(value, EXPECTED_BINDING_SHA256)
    except RUNTIME_RECEIPTS.ContractError as error:
        fail(str(error))
    return value


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
                BINDINGS_PATH.read_bytes()
            ),
            "scripts/isolated-uat-runtime-receipts.py": RUNTIME_RECEIPTS_PATH.read_bytes(),
        }
    except OSError:
        fail("ISOLATED_UAT_RUNTIME_RECEIPT_POLICY_JSON_INVALID")
    try:
        return RUNTIME_RECEIPTS.validate_policy(value, sources, intent_policy)
    except RUNTIME_RECEIPTS.ContractError as error:
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
    runtime_contract_policy = read_runtime_contract_policy()
    runtime_receipt_policy = read_runtime_receipt_policy()
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
        "schema_version": 3,
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
        "receipt_chain_binding": {
            "contract": bindings["receipt_chain"]["contract"],
            "validator_method": bindings["receipt_chain"]["validator_method"],
            "validation_status": bindings["receipt_chain"]["validation_status"],
            "node_count": len(bindings["receipt_chain"]["nodes"]),
            "external_root_validation_statuses": sorted({
                item["validation_status"]
                for item in bindings["receipt_chain"]["external_roots"]
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
        RUNTIME_RECEIPTS.require_receipt_publisher()
        RUNTIME_CONTRACTS.require_runtime_backend()
    except (RUNTIME_RECEIPTS.ContractError, RUNTIME_CONTRACTS.ContractError) as error:
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
