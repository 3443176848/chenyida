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
BINDINGS_PATH = SITE_ROOT / "operations/isolated-uat-one-shot-action-bindings-v1.json"
PLAN_CONTRACT = "chenyida-erp-isolated-uat-one-shot-plan/v1"
BINDINGS_CONTRACT = "chenyida-erp-isolated-uat-one-shot-action-bindings/v1"
EXPECTED_BINDING_SHA256 = "b5b3a7eb5a1a782290e2a37c5fed0ae8e09230696ae9da26d80398b0b2070276"
ENTRYPOINT_ID = "chenyida-erp-isolated-uat-one-shot-v1"
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
        "execution_boundary", "actions", "binding_sha256",
    }, "ISOLATED_UAT_ACTION_BINDING_FIELDS_INVALID")
    if value["schema_version"] != 1 or value["contract"] != BINDINGS_CONTRACT \
            or value["binding_id"] != "chenyida-erp-isolated-uat-fixed-actions-v1" \
            or value["implementation_status"] != "FIXED_BINDINGS_RUNTIME_ADAPTER_NOT_IMPLEMENTED" \
            or value["execution_boundary"] != {
                "evidence_scope": "ISOLATED_UAT_ONLY",
                "shell_allowed": False,
                "free_form_argv_allowed": False,
                "production_entrypoints_allowed": False,
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
            "runtime_secret_filenames", "backup_service_filename", "password_format", "resolved_compose_sha256",
            "images", "ports", "technical_login_roles", "migration_current_head", "migration_target_head",
            "migration_allowlist_sha256", "git_commit", "git_tree", "host_ip", "web_port",
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
    return value


PLANNED_ACTIONS = [
    ("VERIFY_EXACT_INPUTS", "READ_ONLY"),
    ("PREPARE_PRIVATE_NAMESPACE_ROOTS", "MUTATING"),
    ("PROVISION_DISTINCT_CREDENTIAL_FILES", "MUTATING"),
    ("START_POSTGRES_ONLY", "MUTATING"),
    ("BOOTSTRAP_POSTGRESQL_RUNTIME_PRIVILEGES", "MUTATING"),
    ("MIGRATE_EMPTY_DATABASE_TO_BOUND_HEAD", "MUTATING"),
    ("PUBLISH_RELEASE_IDENTITY", "MUTATING"),
    ("START_WEB_AND_WORKER", "MUTATING"),
    ("VERIFY_LOOPBACK_READINESS", "READ_ONLY"),
]


def build_plan(request: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    policy = POLICY.validate_policy(policy)
    request = POLICY.validate_request(request, policy)
    bindings = read_bindings()
    policy_sources = {item["path"] for item in policy["source_binding"]}
    referenced_sources = {source for action in bindings["actions"] for source in action["sources"]}
    if not referenced_sources.issubset(policy_sources):
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
        "schema_version": 1,
        "contract": PLAN_CONTRACT,
        "entrypoint_id": ENTRYPOINT_ID,
        "mode": PLAN_MODE,
        "execution_authorized": False,
        "action_binding_id": bindings["binding_id"],
        "action_binding_sha256": bindings["binding_sha256"],
        "action_binding_status": bindings["implementation_status"],
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
    fail("ISOLATED_UAT_ONE_SHOT_EXECUTOR_NOT_IMPLEMENTED")


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
        output.write(canonical_json(plan))
    except ContractError as error:
        errors.write(f"{error}\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
