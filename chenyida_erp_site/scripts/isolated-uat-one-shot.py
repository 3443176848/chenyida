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
PLAN_CONTRACT = "chenyida-erp-isolated-uat-one-shot-plan/v1"
ENTRYPOINT_ID = "chenyida-erp-isolated-uat-one-shot-v1"
PLAN_MODE = "READ_ONLY_PLAN"
FORBIDDEN_PRODUCTION_ENTRYPOINTS = [
    "scripts/postgresql-runtime-privilege-runner.mjs",
    "scripts/release-supervisor-launcher.py",
]
PLANNED_ACTIONS = [
    ("VERIFY_EXACT_INPUTS", False, "ISOLATED_UAT_CONTROL_REQUEST_VALIDATOR"),
    ("PREPARE_PRIVATE_NAMESPACE_ROOTS", True, "DEDICATED_ISOLATED_UAT_ONE_SHOT"),
    ("PROVISION_DISTINCT_CREDENTIAL_FILES", True, "DEDICATED_ISOLATED_UAT_ONE_SHOT"),
    ("START_POSTGRES_ONLY", True, "ISOLATED_UAT_COMPOSE"),
    ("BOOTSTRAP_POSTGRESQL_RUNTIME_PRIVILEGES", True, "POSTGRESQL_RUNTIME_PRIVILEGE_PRIMITIVES"),
    ("MIGRATE_EMPTY_DATABASE_TO_BOUND_HEAD", True, "CONTROLLED_MIGRATION_ENGINE"),
    ("PUBLISH_RELEASE_IDENTITY", True, "DEDICATED_ISOLATED_UAT_ONE_SHOT"),
    ("START_WEB_AND_WORKER", True, "ISOLATED_UAT_COMPOSE"),
    ("VERIFY_LOOPBACK_READINESS", False, "ISOLATED_UAT_READ_ONLY_VERIFIER"),
]


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


def build_plan(request: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    policy = POLICY.validate_policy(policy)
    request = POLICY.validate_request(request, policy)
    actions = [
        {
            "ordinal": ordinal,
            "action": action,
            "mutates_runtime": mutates_runtime,
            "executor_contract": executor,
        }
        for ordinal, (action, mutates_runtime, executor) in enumerate(PLANNED_ACTIONS, 1)
    ]
    body = {
        "schema_version": 1,
        "contract": PLAN_CONTRACT,
        "entrypoint_id": ENTRYPOINT_ID,
        "mode": PLAN_MODE,
        "execution_authorized": False,
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
