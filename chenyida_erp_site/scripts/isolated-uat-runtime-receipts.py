#!/usr/bin/python3
"""Pure receipt semantics and predecessor-chain validation for isolated UAT.

The module validates injected JSON values only.  It has no filesystem, Docker,
database, network, clock, random, publisher, or process capability.  Successful
validation proves canonical contract semantics and digest continuity; it does
not prove that any runtime observation actually occurred.
"""

import ast
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
import unicodedata
from typing import Any


POLICY_CONTRACT = "chenyida-erp-isolated-uat-runtime-receipt-policy/v1"
POLICY_ID = "chenyida-erp-isolated-uat-runtime-receipts-v1"
CHAIN_CONTRACT = "chenyida-erp-isolated-uat-runtime-receipt-chain-validation/v1"
PRODUCER_CONTRACT = "chenyida-erp-isolated-uat-receipt-producer/v1"
RUNTIME_PRIVILEGE_INTENT_CONTRACT = (
    "chenyida-erp-isolated-uat-runtime-privilege-intent/v1"
)
SHA256 = re.compile(r"^[0-9a-f]{64}$")
GIT_OBJECT = re.compile(r"^[0-9a-f]{40}$")
CONTAINER_ID = re.compile(r"^[0-9a-f]{64}$")
MIGRATION = re.compile(r"^[0-9]{4}_[a-z0-9_]+\.sql$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
PROJECT = re.compile(r"^chenyida-erp-uat-[a-z0-9][a-z0-9_-]{0,42}$")
IMAGE = re.compile(r"^[^@\s]+@sha256:[0-9a-f]{64}$")
OCI_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
DATABASE_OID = re.compile(r"^[1-9][0-9]{0,9}$")
CANONICAL_UTC = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$")
MAX_SAFE_INTEGER = 9_007_199_254_740_991
MAX_POSTGRESQL_OID = 4_294_967_295
MAX_POSTGRESQL_SYSTEM_IDENTIFIER = 18_446_744_073_709_551_615
ZERO_GIT_OBJECT = "0" * 40
ZERO_OCI_DIGEST = f"sha256:{'0' * 64}"

SOURCE_ROOT = "scripts/isolated-uat-runtime-receipts.py"
RECEIPT_POLICY_PATH = "operations/isolated-uat-runtime-receipt-policy-v1.json"
INTENT_POLICY_PATH = "operations/isolated-uat-runtime-contract-policy-v1.json"
PRIVILEGE_POLICY_PATH = "operations/postgresql-runtime-privilege-policy-v2.json"
BINDING_PATH = "operations/isolated-uat-one-shot-action-bindings-v3.json"
EXTERNAL_IMPORTS = ["ast", "datetime", "hashlib", "json", "re", "typing", "unicodedata"]
FORBIDDEN_PATHS = sorted([
    "scripts/postdeploy-release-verifier.mjs",
    "scripts/postgresql-runtime-privilege-runner.mjs",
    "scripts/publish-release-identity-from-manifest.mjs",
    "scripts/release-migration-authorization.ts",
    "scripts/release-supervisor-launcher.py",
    "scripts/uat-promotion-migration-execution-contract.mjs",
    "scripts/write-release-identity.sh",
])
DECLARED_NON_RUNTIME_CAPABILITIES = sorted([
    "CLOCK", "DATABASE", "DOCKER", "ENVIRONMENT", "FILESYSTEM", "NETWORK",
    "PROCESS", "RANDOM", "SECRET_VALUES", "SHELL",
])
BOUND_DEPENDENCY_FILE_SHA256 = {
    INTENT_POLICY_PATH: "4b7f6f741ff84c4ae7a4d8ee3d3641e7a9d3dc52b62c2b00d4c9f9c0f98020cc",
    PRIVILEGE_POLICY_PATH: "2aba8ed96202117761ba88212fb84e3d475afbf19e5447fabe2f658bbe9d8a7c",
    BINDING_PATH: "da69ce3a276ef68f9f6cece12f281ea89584930d481afef19fcf930dae8de5c4",
}

CAPABILITY_STATUS = {
    "intent_builders": "IMPLEMENTED_PURE_BY_BOUND_V1_MODULE",
    "receipt_field_semantics": "IMPLEMENTED_PURE",
    "receipt_validators": "IMPLEMENTED_PURE",
    "predecessor_chain_validator": "IMPLEMENTED_PURE",
    "external_anchor_validators": "NOT_IMPLEMENTED",
    "runtime_privilege_owner_journal_validator": "NOT_IMPLEMENTED",
    "caddy_host_sni_readiness_contract": "NOT_IMPLEMENTED_INTENT_V1",
    "action_source_closure": "NOT_IMPLEMENTED_DIRECT_REFERENCES_ONLY",
    "receipt_publishers": "NOT_IMPLEMENTED",
    "runtime_backends": "NOT_IMPLEMENTED",
    "execution_authorized": False,
}
VALIDATION_OUTPUT = {
    "receipt_contract_validation_status": "VALID",
    "predecessor_chain_status": (
        "VALIDATED_PURE_INTERNAL_CONTRACT_CHAIN_FROM_UNVERIFIED_EXTERNAL_DIGEST_ANCHORS"
    ),
    "external_anchor_validation_status": "NOT_EVALUATED",
    "execution_status": "NOT_EVALUATED",
    "publication_status": "NOT_EVALUATED",
    "runtime_evidence_status": "NOT_ESTABLISHED_BY_PURE_VALIDATION",
    "dependency_policy_roots_status": "VALIDATED_AGAINST_EXECUTING_VALIDATOR_CONSTANTS",
    "receipt_policy_root_status": "MATCHED_CALLER_SUPPLIED_EXPECTED_DIGESTS",
    "control_plan_anchor_status": "NOT_EVALUATED",
    "verification_time_source_status": "CALLER_INJECTED_NOT_ATTESTED",
    "freshness_validation_status": "VALIDATED_RELATIVE_TO_CALLER_INJECTED_TIME",
}

PRODUCERS = {
    "DATABASE_BOOTSTRAP": {
        "action_ordinal": 5,
        "handler_id": "ISOLATED_UAT_DATABASE_BOOTSTRAP_ADAPTER",
        "adapter_method": "initialize_database_identity_and_login_roles",
    },
    "MIGRATION": {
        "action_ordinal": 6,
        "handler_id": "ISOLATED_UAT_MIGRATION_ADAPTER",
        "adapter_method": "migrate_empty_database_to_bound_head",
    },
    "RUNTIME_PRIVILEGE": {
        "action_ordinal": 7,
        "handler_id": "POSTGRESQL_RUNTIME_PRIVILEGE_PRIMITIVES",
        "adapter_method": "reconcile_final_runtime_privileges",
    },
    "EVIDENCE": {
        "action_ordinal": 9,
        "handler_id": "ISOLATED_UAT_POSTDEPLOY_EVIDENCE_ADAPTER",
        "adapter_method": "verify_and_publish_isolated_uat_evidence",
    },
}

RECEIPT_SPECS = {
    "database_target_identity": {
        "family": "DATABASE_BOOTSTRAP",
        "contract": "chenyida-erp-isolated-uat-database-target-identity/v1",
        "producer": "DATABASE_BOOTSTRAP",
        "digest_field": "identity_sha256",
        "required_fields": [
            "schema_version", "contract", "bootstrap_intent_sha256", "producer",
            "database_name", "system_identifier", "database_oid", "marker", "owner",
            "identity_sha256",
        ],
        "semantic_profile": "DATABASE_TARGET_IDENTITY_STRICT_V1",
    },
    "database_bootstrap_receipt": {
        "family": "DATABASE_BOOTSTRAP",
        "contract": "chenyida-erp-isolated-uat-database-bootstrap-receipt/v1",
        "producer": "DATABASE_BOOTSTRAP",
        "digest_field": "receipt_sha256",
        "required_fields": [
            "schema_version", "contract", "bootstrap_intent_sha256", "producer",
            "database_target_identity_sha256", "observed_login_roles",
            "observed_login_roles_sha256", "observed_head", "schema_acl_status",
            "observation_bundle_sha256", "observed_at", "completed_at", "receipt_sha256",
        ],
        "semantic_profile": "DATABASE_BOOTSTRAP_RECEIPT_STRICT_V1",
    },
    "release_candidate_receipt": {
        "family": "MIGRATION",
        "contract": "chenyida-erp-isolated-uat-release-candidate-receipt/v1",
        "producer": "MIGRATION",
        "digest_field": "receipt_sha256",
        "required_fields": [
            "schema_version", "contract", "migration_intent_sha256", "producer",
            "package_version", "git_commit", "git_tree", "images",
            "resolved_compose_sha256", "database_target_identity_sha256",
            "candidate_root_identity_sha256", "published_at", "receipt_sha256",
        ],
        "semantic_profile": "RELEASE_CANDIDATE_RECEIPT_STRICT_V1",
    },
    "migration_execution_receipt": {
        "family": "MIGRATION",
        "contract": "chenyida-erp-isolated-uat-migration-execution-receipt/v1",
        "producer": "MIGRATION",
        "digest_field": "receipt_sha256",
        "required_fields": [
            "schema_version", "contract", "migration_intent_sha256", "producer",
            "release_candidate_receipt_sha256", "database_target_identity_sha256",
            "from_head", "to_head", "applied_count", "applied_ledger_sha256",
            "observed_head", "observation_bundle_sha256", "observed_at", "completed_at",
            "receipt_sha256",
        ],
        "semantic_profile": "MIGRATION_EXECUTION_RECEIPT_STRICT_V1",
    },
    "readiness_receipt": {
        "family": "EVIDENCE",
        "contract": "chenyida-erp-isolated-uat-readiness-receipt/v1",
        "producer": "EVIDENCE",
        "digest_field": "receipt_sha256",
        "required_fields": [
            "schema_version", "contract", "evidence_intent_sha256", "producer",
            "loopback", "expected_package_version", "expected_git_commit",
            "observed_package_version", "observed_git_commit", "observed_at",
            "receipt_sha256",
        ],
        "semantic_profile": "LOOPBACK_READINESS_RECEIPT_STRICT_V1",
    },
    "isolated_uat_postdeploy_receipt": {
        "family": "EVIDENCE",
        "contract": "chenyida-erp-isolated-uat-postdeploy-receipt/v1",
        "producer": "EVIDENCE",
        "digest_field": "receipt_sha256",
        "required_fields": [
            "schema_version", "contract", "evidence_intent_sha256", "producer",
            "readiness_receipt_sha256", "release_candidate_receipt_sha256",
            "migration_execution_receipt_sha256", "runtime_privilege_receipt_sha256",
            "container_identity_set_sha256", "observed_at", "receipt_sha256",
        ],
        "semantic_profile": "ISOLATED_POSTDEPLOY_RECEIPT_STRICT_V1",
    },
    "isolated_uat_runtime_identity_receipt": {
        "family": "EVIDENCE",
        "contract": "chenyida-erp-isolated-uat-runtime-identity-receipt/v1",
        "producer": "EVIDENCE",
        "digest_field": "receipt_sha256",
        "required_fields": [
            "schema_version", "contract", "evidence_intent_sha256", "producer",
            "postdeploy_receipt_sha256", "project", "runtime_source", "containers",
            "loopback", "release_identity_reader_gid", "identity_semantics",
            "production_release_identity_compatible", "published_at", "receipt_sha256",
        ],
        "semantic_profile": "ISOLATED_RUNTIME_IDENTITY_RECEIPT_STRICT_V1",
    },
    "runtime_privilege_receipt": {
        "family": "RUNTIME_PRIVILEGE",
        "contract": "chenyida-erp-isolated-uat-runtime-privilege-receipt/v1",
        "producer": "RUNTIME_PRIVILEGE",
        "digest_field": "receipt_sha256",
        "required_fields": [
            "schema_version", "contract", "runtime_privilege_intent_sha256", "producer",
            "project", "database_target_identity_sha256",
            "migration_execution_receipt_sha256", "runtime_privilege_policy_sha256",
            "observation_bundle_sha256", "observed_head",
            "observed_login_roles_sha256", "completed_at", "receipt_sha256",
        ],
        "semantic_profile": "ISOLATED_RUNTIME_PRIVILEGE_RECEIPT_STRICT_V1",
    },
}

EVIDENCE_SPECS = {
    "database_bootstrap_observation": {
        "contract": "chenyida-erp-isolated-uat-bootstrap-observation/v1",
        "producer": "DATABASE_BOOTSTRAP",
        "digest_field": "evidence_sha256",
        "semantic_profile": "DATABASE_BOOTSTRAP_OBSERVATION_STRICT_V1",
    },
    "migration_applied_ledger": {
        "contract": "chenyida-erp-isolated-uat-migration-applied-ledger/v1",
        "producer": "MIGRATION",
        "digest_field": "evidence_sha256",
        "semantic_profile": "MIGRATION_APPLIED_LEDGER_STRICT_V1",
    },
    "migration_observation": {
        "contract": "chenyida-erp-isolated-uat-migration-observation/v1",
        "producer": "MIGRATION",
        "digest_field": "evidence_sha256",
        "semantic_profile": "MIGRATION_OBSERVATION_STRICT_V1",
    },
    "runtime_privilege_observation": {
        "contract": "chenyida-erp-isolated-uat-runtime-privilege-observation/v1",
        "producer": "RUNTIME_PRIVILEGE",
        "digest_field": "evidence_sha256",
        "semantic_profile": "RUNTIME_PRIVILEGE_OBSERVATION_STRICT_V1",
    },
    "container_identity_set": {
        "contract": "chenyida-erp-isolated-uat-container-identity-set/v1",
        "producer": "EVIDENCE",
        "digest_field": "evidence_sha256",
        "semantic_profile": "CONTAINER_IDENTITY_SET_STRICT_V1",
    },
}

RUNTIME_PRIVILEGE_INTENT_FIELDS = [
    "schema_version", "contract", "operation_id", "request_id", "project",
    "plan_sha256", "runtime_intent_policy_sha256", "runtime_receipt_policy_sha256",
    "database_target_identity_sha256", "migration_execution_receipt_sha256",
    "target_head", "technical_login_roles", "runtime_privilege_policy_sha256",
    "contract_validation_status", "execution_status", "publication_status",
    "intent_sha256",
]

EXTERNAL_DIGEST_ANCHORS = sorted([
    "credential_generation_receipt_sha256",
    "database_cluster_identity_sha256",
    "release_candidate_root_identity_sha256",
    "one_shot_state_root_identity_sha256",
])

LOGIN_ROLE_ATTRIBUTES = [
    {
        "role": "chenyida_erp_admin", "can_login": True, "inherit": True,
        "connection_limit": 1, "superuser": False, "create_role": False,
        "create_database": False, "replication": False, "bypass_rls": False,
        "valid_until": None,
    },
    {
        "role": "chenyida_erp_backup", "can_login": True, "inherit": True,
        "connection_limit": 2, "superuser": False, "create_role": False,
        "create_database": False, "replication": False, "bypass_rls": False,
        "valid_until": None,
    },
    {
        "role": "chenyida_erp_owner", "can_login": True, "inherit": False,
        "connection_limit": 1, "superuser": False, "create_role": False,
        "create_database": False, "replication": False, "bypass_rls": False,
        "valid_until": None,
    },
    {
        "role": "chenyida_erp_web", "can_login": True, "inherit": True,
        "connection_limit": 12, "superuser": False, "create_role": False,
        "create_database": False, "replication": False, "bypass_rls": False,
        "valid_until": None,
    },
    {
        "role": "chenyida_erp_worker", "can_login": True, "inherit": True,
        "connection_limit": 6, "superuser": False, "create_role": False,
        "create_database": False, "replication": False, "bypass_rls": False,
        "valid_until": None,
    },
]


class ContractError(Exception):
    pass


def fail(code: str) -> None:
    raise ContractError(code)


def exact(value: Any, keys: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        fail(code)
    return value


def _validate_json(value: Any, code: str) -> None:
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, int):
        if abs(value) > MAX_SAFE_INTEGER:
            fail(code)
        return
    if isinstance(value, float):
        fail(code)
    if isinstance(value, str):
        if unicodedata.normalize("NFC", value) != value \
                or any(
                    ord(character) < 32
                    or 0xD800 <= ord(character) <= 0xDFFF
                    for character in value
                ):
            fail(code)
        return
    if isinstance(value, list):
        for item in value:
            _validate_json(item, code)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                fail(code)
            _validate_json(key, code)
            _validate_json(item, code)
        return
    fail(code)


def canonical_json(value: Any) -> str:
    _validate_json(value, "ISOLATED_UAT_RECEIPT_JSON_INVALID")
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _clone(value: Any, code: str) -> Any:
    try:
        _validate_json(value, code)
        return json.loads(canonical_json(value))
    except (TypeError, ValueError, json.JSONDecodeError):
        fail(code)


def _sha(value: Any, code: str) -> str:
    if not isinstance(value, str) or value == "0" * 64 or SHA256.fullmatch(value) is None:
        fail(code)
    return value


def _time(value: Any, code: str) -> datetime:
    if not isinstance(value, str) or CANONICAL_UTC.fullmatch(value) is None:
        fail(code)
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except ValueError:
        fail(code)
    if parsed.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z" != value:
        fail(code)
    return parsed


def _verify_digest(value: dict[str, Any], field: str, code: str) -> None:
    digest = _sha(value.get(field), code)
    body = {key: item for key, item in value.items() if key != field}
    if canonical_sha256(body) != digest:
        fail(code)


def _reject_synthetic(value: Any) -> None:
    if not isinstance(value, dict):
        return
    contract = value.get("contract")
    if value.get("fixture_scope") is not None \
            or isinstance(contract, str) and "synthetic" in contract.lower():
        fail("ISOLATED_UAT_SYNTHETIC_RECEIPT_FORBIDDEN")


def _canonical_repo_path(value: Any) -> bool:
    if not isinstance(value, str) or not value or value.startswith("/") or "\\" in value:
        return False
    return all(part not in ("", ".", "..") for part in value.split("/"))


def validate_source_closure(value: Any, sources: dict[str, bytes]) -> dict[str, Any]:
    code = "ISOLATED_UAT_RUNTIME_RECEIPT_SOURCE_CLOSURE_INVALID"
    value = exact(value, {
        "schema_version", "algorithm", "roots", "members", "edges", "external_imports",
        "forbidden_paths", "declared_non_runtime_capabilities", "validation_scope",
        "source_closure_sha256",
    }, code)
    if value["schema_version"] != 1 \
            or value["algorithm"] != "PYTHON_STATIC_RESOURCE_CLOSURE_V1" \
            or value["roots"] != [SOURCE_ROOT] \
            or value["external_imports"] != EXTERNAL_IMPORTS \
            or value["forbidden_paths"] != FORBIDDEN_PATHS \
            or value["declared_non_runtime_capabilities"] != DECLARED_NON_RUNTIME_CAPABILITIES \
            or value["validation_scope"] \
                != "SOURCE_HASH_IMPORT_ALLOWLIST_AND_STATIC_RESOURCE_EDGES_NOT_A_SANDBOX":
        fail(code)
    expected_paths = [BINDING_PATH, INTENT_POLICY_PATH, PRIVILEGE_POLICY_PATH, SOURCE_ROOT]
    members = value["members"]
    if not isinstance(members, list) or len(members) != 4:
        fail(code)
    member_map: dict[str, dict[str, Any]] = {}
    for member in members:
        exact(member, {"path", "kind", "sha256"}, code)
        path = member["path"]
        if not _canonical_repo_path(path) or path in member_map \
                or member["kind"] not in {"CODE", "DATA"}:
            fail(code)
        _sha(member["sha256"], code)
        member_map[path] = member
    if sorted(member_map) != expected_paths \
            or member_map[SOURCE_ROOT]["kind"] != "CODE" \
            or member_map[INTENT_POLICY_PATH]["kind"] != "DATA" \
            or member_map[PRIVILEGE_POLICY_PATH]["kind"] != "DATA" \
            or member_map[BINDING_PATH]["kind"] != "DATA" \
            or set(sources) != set(expected_paths):
        fail(code)
    edges = value["edges"]
    expected_edges = [
        {"from": SOURCE_ROOT, "to": INTENT_POLICY_PATH, "kind": "STATIC_RESOURCE"},
        {"from": SOURCE_ROOT, "to": PRIVILEGE_POLICY_PATH, "kind": "STATIC_RESOURCE"},
        {"from": SOURCE_ROOT, "to": BINDING_PATH, "kind": "STATIC_RESOURCE"},
    ]
    if edges != expected_edges:
        fail(code)
    for path, member in member_map.items():
        raw = sources[path]
        if not isinstance(raw, bytes) or hashlib.sha256(raw).hexdigest() != member["sha256"]:
            fail(code)
    try:
        tree = ast.parse(sources[SOURCE_ROOT].decode("utf-8"), filename=SOURCE_ROOT)
    except (UnicodeDecodeError, SyntaxError):
        fail(code)
    observed_external: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            observed_external.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                fail(code)
            if node.module:
                observed_external.add(node.module.split(".")[0])
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                and node.func.id in {"__import__", "eval", "exec", "open", "compile"}:
            fail(code)
    if sorted(observed_external) != EXTERNAL_IMPORTS:
        fail(code)
    body = {key: item for key, item in value.items() if key != "source_closure_sha256"}
    if canonical_sha256(body) != _sha(value["source_closure_sha256"], code):
        fail(code)
    return value


def _strict_json_bytes(raw: bytes, code: str) -> dict[str, Any]:
    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, item in items:
            if key in result:
                fail(code)
            result[key] = item
        return result

    try:
        value = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=pairs,
            parse_constant=lambda _: fail(code),
        )
    except ContractError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail(code)
    if not isinstance(value, dict):
        fail(code)
    _validate_json(value, code)
    return value


def validate_policy_root_match(
    receipt_policy: Any,
    intent_policy: Any,
    receipt_policy_raw: Any,
    expected_policy_roots: Any,
    policy_sources: dict[str, bytes],
) -> dict[str, Any]:
    """Match caller-supplied roots without claiming that the caller is trusted."""
    code = "ISOLATED_UAT_RECEIPT_POLICY_ROOT_INVALID"
    expected = exact(_clone(expected_policy_roots, code), {
        "intent_policy_sha256", "intent_policy_file_sha256",
        "receipt_policy_sha256", "receipt_policy_file_sha256",
    }, code)
    for value in expected.values():
        _sha(value, code)
    if not isinstance(receipt_policy_raw, bytes):
        fail(code)
    try:
        intent_policy_raw = policy_sources[INTENT_POLICY_PATH]
    except (KeyError, TypeError):
        fail(code)
    if not isinstance(intent_policy_raw, bytes):
        fail(code)
    parsed_receipt_policy = _strict_json_bytes(receipt_policy_raw, code)
    if parsed_receipt_policy != receipt_policy \
            or receipt_policy.get("policy_sha256") != expected["receipt_policy_sha256"] \
            or hashlib.sha256(receipt_policy_raw).hexdigest() \
                != expected["receipt_policy_file_sha256"] \
            or intent_policy.get("policy_sha256") != expected["intent_policy_sha256"] \
            or hashlib.sha256(intent_policy_raw).hexdigest() \
                != expected["intent_policy_file_sha256"]:
        fail(code)
    return expected


def validate_policy(
    value: Any,
    sources: dict[str, bytes],
    intent_policy: dict[str, Any],
) -> dict[str, Any]:
    code = "ISOLATED_UAT_RUNTIME_RECEIPT_POLICY_INVALID"
    value = exact(value, {
        "schema_version", "contract", "policy_id", "execution_authorized",
        "capability_status", "validation_output", "intent_policy_binding",
        "runtime_privilege_policy_binding", "action_binding", "producers", "receipt_specs",
        "evidence_specs", "runtime_privilege_intent", "external_digest_anchors",
        "invariants", "source_closure", "policy_sha256",
    }, code)
    if value["schema_version"] != 1 or value["contract"] != POLICY_CONTRACT \
            or value["policy_id"] != POLICY_ID or value["execution_authorized"] is not False \
            or value["capability_status"] != CAPABILITY_STATUS \
            or value["validation_output"] != VALIDATION_OUTPUT \
            or value["producers"] != PRODUCERS or value["receipt_specs"] != RECEIPT_SPECS \
            or value["evidence_specs"] != EVIDENCE_SPECS \
            or value["runtime_privilege_intent"] != {
                "contract": RUNTIME_PRIVILEGE_INTENT_CONTRACT,
                "required_fields": RUNTIME_PRIVILEGE_INTENT_FIELDS,
                "semantic_profile": "ISOLATED_RUNTIME_PRIVILEGE_INTENT_STRICT_V1",
            } or value["external_digest_anchors"] != EXTERNAL_DIGEST_ANCHORS:
        fail(code)
    try:
        if any(
            hashlib.sha256(sources[path]).hexdigest() != expected
            for path, expected in BOUND_DEPENDENCY_FILE_SHA256.items()
        ):
            fail(code)
    except (KeyError, TypeError):
        fail(code)
    binding = value["intent_policy_binding"]
    if binding != {
        "contract": intent_policy.get("contract"),
        "policy_id": intent_policy.get("policy_id"),
        "policy_sha256": intent_policy.get("policy_sha256"),
        "source_closure_sha256": intent_policy.get("source_closure", {}).get(
            "source_closure_sha256"
        ),
    }:
        fail(code)
    try:
        bound_intent = _strict_json_bytes(sources[INTENT_POLICY_PATH], code)
        privilege_policy = _strict_json_bytes(sources[PRIVILEGE_POLICY_PATH], code)
        action_binding = _strict_json_bytes(sources[BINDING_PATH], code)
    except KeyError:
        fail(code)
    if bound_intent != intent_policy \
            or privilege_policy.get("schema_version") != 2 \
            or privilege_policy.get("contract") \
                != "chenyida-erp-postgresql-runtime-privilege-policy/v2" \
            or privilege_policy.get("policy_id") != "chenyida-erp-postgresql-runtime-privilege-v2" \
            or privilege_policy.get("deployment_authorized") is not False \
            or value["runtime_privilege_policy_binding"] != {
                "contract": privilege_policy.get("contract"),
                "policy_id": privilege_policy.get("policy_id"),
                "policy_sha256": privilege_policy.get("policy_sha256"),
                "migration_applied_ledger_sha256": privilege_policy.get("source_binding", {})
                    .get("migrations", {}).get("applied_ledger_sha256"),
            } or value["action_binding"] != {
                "contract": action_binding.get("contract"),
                "binding_id": action_binding.get("binding_id"),
                "binding_sha256": action_binding.get("binding_sha256"),
                "file_sha256": hashlib.sha256(sources[BINDING_PATH]).hexdigest(),
            }:
        fail(code)
    _validate_binding(action_binding, value["action_binding"]["binding_sha256"])
    invariants = intent_policy.get("invariants", {})
    privilege_login_roles = [
        {
            "role": role["name"],
            "can_login": role["intended_login"],
            **{field: role[field] for field in (
                "inherit", "connection_limit", "superuser", "create_role",
                "create_database", "replication", "bypass_rls", "valid_until",
            )},
        }
        for role in privilege_policy.get("roles", [])
        if role.get("name") in invariants.get("technical_login_roles", [])
    ]
    if privilege_login_roles != LOGIN_ROLE_ATTRIBUTES or value["invariants"] != {
        "database_current_head": invariants.get("database_current_head"),
        "database_name": invariants.get("database_name"),
        "database_owner": invariants.get("database_owner"),
        "identity_semantics": invariants.get("identity_semantics"),
        "loopback_host": invariants.get("loopback_host"),
        "migration_allowlist_sha256": invariants.get("migration_allowlist_sha256"),
        "migration_applied_ledger_sha256": privilege_policy["source_binding"]["migrations"]
            ["applied_ledger_sha256"],
        "migration_count": invariants.get("migration_count"),
        "migration_target_head": invariants.get("migration_target_head"),
        "package_version": invariants.get("package_version"),
        "production_release_identity_compatible": False,
        "release_identity_reader_gid": invariants.get("release_identity_reader_gid"),
        "technical_login_roles": invariants.get("technical_login_roles"),
        "technical_login_role_attributes": LOGIN_ROLE_ATTRIBUTES,
        "max_future_skew_seconds": 300,
        "max_chain_age_seconds": 3600,
    }:
        fail(code)
    shapes: dict[str, dict[str, Any]] = {}
    for family in intent_policy.get("families", {}).values():
        for shape in family.get("receipt_shapes", []):
            shapes[shape.get("output")] = shape
    for name in (
        "database_target_identity", "database_bootstrap_receipt", "release_candidate_receipt",
        "migration_execution_receipt", "readiness_receipt", "isolated_uat_postdeploy_receipt",
        "isolated_uat_runtime_identity_receipt",
    ):
        if shapes.get(name) != {
            "output": name,
            "contract": RECEIPT_SPECS[name]["contract"],
            "required_fields": RECEIPT_SPECS[name]["required_fields"],
        }:
            fail(code)
    validate_source_closure(value["source_closure"], sources)
    body = {key: item for key, item in value.items() if key != "policy_sha256"}
    if canonical_sha256(body) != _sha(value["policy_sha256"], code):
        fail(code)
    return value


def _producer(binding: dict[str, Any], key: str) -> dict[str, Any]:
    code = "ISOLATED_UAT_RECEIPT_PRODUCER_INVALID"
    specification = PRODUCERS[key]
    actions = binding.get("actions") if isinstance(binding, dict) else None
    if not isinstance(actions, list) or len(actions) != 9:
        fail(code)
    action = actions[specification["action_ordinal"] - 1]
    body = {item: binding[item] for item in binding if item != "binding_sha256"}
    if binding.get("schema_version") != 3 \
            or binding.get("contract") != "chenyida-erp-isolated-uat-one-shot-action-bindings/v3" \
            or canonical_sha256(body) != _sha(binding.get("binding_sha256"), code) \
            or action.get("ordinal") != specification["action_ordinal"] \
            or action.get("handler_id") != specification["handler_id"] \
            or action.get("adapter_method") != specification["adapter_method"]:
        fail(code)
    return {
        "schema_version": 1,
        "contract": PRODUCER_CONTRACT,
        "binding_sha256": binding["binding_sha256"],
        **specification,
        "source_binding_scope": "DIRECT_CONTRACT_REFERENCES_ONLY",
    }


def _validate_binding(value: Any, expected_sha256: Any) -> dict[str, Any]:
    code = "ISOLATED_UAT_RECEIPT_BINDING_INVALID"
    value = exact(value, {
        "schema_version", "contract", "binding_id", "implementation_status",
        "execution_boundary", "actions", "receipt_chain", "binding_sha256",
    }, code)
    if value["schema_version"] != 3 \
            or value["contract"] != "chenyida-erp-isolated-uat-one-shot-action-bindings/v3" \
            or value["binding_id"] != "chenyida-erp-isolated-uat-fixed-actions-v3" \
            or value["implementation_status"] \
                != "FIXED_BINDINGS_RECEIPT_CHAIN_VALIDATORS_IMPLEMENTED_RUNTIME_PATH_NOT_IMPLEMENTED" \
            or value["binding_sha256"] != _sha(expected_sha256, code):
        fail(code)
    _verify_digest(value, "binding_sha256", code)
    actions = value["actions"]
    if not isinstance(actions, list) or len(actions) != 9:
        fail(code)
    outputs: dict[str, int] = {}
    for ordinal, action in enumerate(actions, 1):
        exact(action, {
            "ordinal", "action", "effect", "handler_id", "adapter_method",
            "sources", "inputs", "outputs",
        }, code)
        if action["ordinal"] != ordinal \
                or not all(isinstance(action[field], list) and action[field] for field in (
                    "sources", "inputs", "outputs",
                )) or any(output in outputs for output in action["outputs"]):
            fail(code)
        outputs.update({output: ordinal for output in action["outputs"]})
    chain = exact(value["receipt_chain"], {
        "schema_version", "contract", "validator_source", "validator_method",
        "intent_validator_source", "intent_validator_method", "receipt_policy",
        "validation_status", "external_roots", "nodes",
    }, code)
    if chain["schema_version"] != 1 \
            or chain["contract"] \
                != "chenyida-erp-isolated-uat-runtime-receipt-chain-binding/v1" \
            or chain["validator_source"] != SOURCE_ROOT \
            or chain["validator_method"] != "validate_receipt_chain" \
            or chain["intent_validator_source"] \
                != "scripts/isolated-uat-runtime-contracts.py" \
            or chain["intent_validator_method"] != "validate_intent" \
            or chain["receipt_policy"] \
                != "operations/isolated-uat-runtime-receipt-policy-v1.json" \
            or chain["validation_status"] \
                != "PURE_CONTRACT_CHAIN_VALIDATOR_IMPLEMENTED_RUNTIME_FACTS_NOT_ESTABLISHED":
        fail(code)
    external_roots = chain["external_roots"]
    if not isinstance(external_roots, list) or {
        root.get("anchor") for root in external_roots if isinstance(root, dict)
    } != set(EXTERNAL_DIGEST_ANCHORS):
        fail(code)
    external_outputs: set[str] = set()
    for root in external_roots:
        exact(root, {
            "anchor", "source_ordinal", "source_output", "source_digest_field",
            "validation_status",
        }, code)
        if root["validation_status"] != "VALIDATOR_NOT_IMPLEMENTED_THIS_SLICE" \
                or root["source_output"] not in outputs \
                or outputs[root["source_output"]] != root["source_ordinal"]:
            fail(code)
        external_outputs.add(root["source_output"])
    nodes = chain["nodes"]
    if not isinstance(nodes, list) or len(nodes) != 18:
        fail(code)
    prior = set(external_outputs)
    for sequence, node in enumerate(nodes, 1):
        exact(node, {
            "sequence", "node", "kind", "contract", "source_ordinal", "source_output",
            "digest_field", "validator_method", "predecessors",
        }, code)
        if node["sequence"] != sequence or node["node"] != node["source_output"] \
                or node["node"] in prior or node["source_output"] not in outputs \
                or outputs[node["source_output"]] != node["source_ordinal"] \
                or node["kind"] not in {"INTENT", "RECEIPT", "EVIDENCE", "VALIDATION"} \
                or not isinstance(node["predecessors"], list):
            fail(code)
        for predecessor in node["predecessors"]:
            exact(predecessor, {
                "source_node", "source_digest_field", "target_field",
            }, code)
            if predecessor["source_node"] not in prior:
                fail(code)
        prior.add(node["node"])
    return value


def validate_action_binding(value: Any, expected_sha256: Any) -> dict[str, Any]:
    """Validate and freeze the explicitly trusted binding-v3 digest."""
    return _clone(
        _validate_binding(value, expected_sha256),
        "ISOLATED_UAT_RECEIPT_BINDING_INVALID",
    )


def _validate_bound_intent(
    family: str,
    value: Any,
    policy: dict[str, Any],
) -> dict[str, Any]:
    code = f"ISOLATED_UAT_{family}_INTENT_INVALID"
    if family not in {"DATABASE_BOOTSTRAP", "MIGRATION", "EVIDENCE"}:
        fail(code)
    specification = policy["families"][family]
    derived_fields = {
        "DATABASE_BOOTSTRAP": {"database_cluster_identity_sha256", "full_schema_acl_status"},
        "MIGRATION": {"release_candidate_spec_status"},
        "EVIDENCE": {"identity_semantics", "production_release_identity_compatible"},
    }[family]
    value = exact(value, set(specification["input_fields"]) | derived_fields | {
        "schema_version", "contract", "intent_sha256", *policy["output_status"].keys(),
    }, code)
    if value["schema_version"] != 1 or value["contract"] != specification["intent_contract"] \
            or any(value[field] != expected for field, expected in policy["output_status"].items()):
        fail(code)
    _verify_digest(value, "intent_sha256", code)
    for field in ("operation_id", "request_id"):
        if not isinstance(value[field], str) or IDENTIFIER.fullmatch(value[field]) is None:
            fail(code)
    if not isinstance(value["project"], str) or PROJECT.fullmatch(value["project"]) is None \
            or value["runtime_contract_policy_sha256"] != policy["policy_sha256"] \
            or value["source_closure_sha256"] \
                != policy["source_closure"]["source_closure_sha256"]:
        fail(code)
    _sha(value["plan_sha256"], code)
    invariants = policy["invariants"]
    if family == "DATABASE_BOOTSTRAP":
        cluster = exact(value["database_cluster_identity"], {
            "project", "postgres_container_identity_sha256", "system_identifier",
        }, code)
        target = exact(value["database_target_expectation"], {
            "deployment_class", "deployment_id", "name", "marker", "owner", "current_head",
        }, code)
        roles = [
            {"role": role, "credential_file": invariants["role_credentials"][role]}
            for role in invariants["technical_login_roles"]
        ]
        if cluster["project"] != value["project"] \
                or re.fullmatch(r"[1-9][0-9]{9,29}", cluster["system_identifier"] or "") is None \
                or int(cluster["system_identifier"]) > MAX_POSTGRESQL_SYSTEM_IDENTIFIER \
                or canonical_sha256(cluster) != value["database_cluster_identity_sha256"] \
                or value["full_schema_acl_status"] != "DEFERRED_UNTIL_POST_MIGRATION" \
                or target != {
                    "deployment_class": invariants["deployment_class"],
                    "deployment_id": value["project"],
                    "name": invariants["database_name"],
                    "marker": f"chenyida-erp-deployment/v2:UAT:{value['project']}",
                    "owner": invariants["database_owner"],
                    "current_head": invariants["database_current_head"],
                } or value["login_role_expectations"] != roles:
            fail(code)
        _sha(cluster["postgres_container_identity_sha256"], code)
        _sha(value["credential_generation_receipt_sha256"], code)
    elif family == "MIGRATION":
        for field in (
            "database_bootstrap_receipt_sha256", "database_target_identity_sha256",
            "release_candidate_root_identity_sha256",
        ):
            _sha(value[field], code)
        migration = exact(value["migration"], {
            "from_head", "to_head", "count", "allowlist_sha256",
        }, code)
        if migration != {
            "from_head": invariants["database_current_head"],
            "to_head": invariants["migration_target_head"],
            "count": invariants["migration_count"],
            "allowlist_sha256": invariants["migration_allowlist_sha256"],
        } or value["release_candidate_spec_status"] != "SPECIFIED_NOT_PUBLISHED":
            fail(code)
        _validate_release_source(value["release_source"], invariants, code)
    else:
        for field in (
            "release_candidate_receipt_sha256", "migration_execution_receipt_sha256",
            "runtime_privilege_receipt_sha256", "one_shot_state_root_identity_sha256",
        ):
            _sha(value[field], code)
        source = exact(value["runtime_source"], {
            "package_version", "git_commit", "git_tree", "migration_head",
            "migration_allowlist_sha256", "resolved_compose_sha256",
        }, code)
        if source["migration_head"] != invariants["migration_target_head"] \
                or source["migration_allowlist_sha256"] \
                    != invariants["migration_allowlist_sha256"] \
                or value["identity_semantics"] != invariants["identity_semantics"] \
                or value["production_release_identity_compatible"] is not False \
                or value["release_identity_reader_gid"] \
                    != invariants["release_identity_reader_gid"]:
            fail(code)
        _validate_runtime_source_and_containers(value, invariants, code)
    return value


def _validate_release_source(value: Any, invariants: dict[str, Any], code: str) -> None:
    value = exact(value, {
        "package_version", "git_commit", "git_tree", "images", "resolved_compose_sha256",
    }, code)
    if value["package_version"] != invariants["package_version"] \
            or not isinstance(value["git_commit"], str) or GIT_OBJECT.fullmatch(value["git_commit"]) is None \
            or value["git_commit"] == ZERO_GIT_OBJECT \
            or not isinstance(value["git_tree"], str) or GIT_OBJECT.fullmatch(value["git_tree"]) is None \
            or value["git_tree"] == ZERO_GIT_OBJECT:
        fail(code)
    _sha(value["resolved_compose_sha256"], code)
    images = exact(value["images"], {"web", "worker"}, code)
    for image in images.values():
        exact(image, {"image_reference", "config_digest"}, code)
        if not isinstance(image["image_reference"], str) \
                or IMAGE.fullmatch(image["image_reference"]) is None \
                or image["image_reference"].endswith(ZERO_OCI_DIGEST) \
                or not isinstance(image["config_digest"], str) \
                or OCI_DIGEST.fullmatch(image["config_digest"]) is None \
                or image["config_digest"] == ZERO_OCI_DIGEST:
            fail(code)


def _validate_runtime_source_and_containers(
    value: dict[str, Any],
    invariants: dict[str, Any],
    code: str,
) -> None:
    source = value["runtime_source"]
    _validate_release_source({
        "package_version": source["package_version"],
        "git_commit": source["git_commit"],
        "git_tree": source["git_tree"],
        "images": {
            service: {
                "image_reference": value["containers"][service]["image_reference"],
                "config_digest": value["containers"][service]["image_config_digest"],
            }
            for service in ("web", "worker")
        },
        "resolved_compose_sha256": source["resolved_compose_sha256"],
    }, invariants, code)
    containers = exact(value["containers"], {"postgres", "caddy", "web", "worker"}, code)
    for container in containers.values():
        exact(container, {
            "project", "container_id", "image_reference", "image_config_digest",
        }, code)
        if container["project"] != value["project"] \
                or not isinstance(container["container_id"], str) \
                or CONTAINER_ID.fullmatch(container["container_id"]) is None \
                or container["container_id"] == "0" * 64 \
                or IMAGE.fullmatch(container["image_reference"] or "") is None \
                or container["image_reference"].endswith(ZERO_OCI_DIGEST) \
                or OCI_DIGEST.fullmatch(container["image_config_digest"] or "") is None \
                or container["image_config_digest"] == ZERO_OCI_DIGEST:
            fail(code)
    if len({container["container_id"] for container in containers.values()}) != 4:
        fail(code)
    loopback = exact(value["loopback"], {"host", "web", "caddy_http", "caddy_https"}, code)
    ports = [loopback["web"], loopback["caddy_http"], loopback["caddy_https"]]
    if loopback["host"] != invariants["loopback_host"] \
            or any(type(port) is not int or port < 1024 or port > 65535 or port == 3000
                   for port in ports) or len(set(ports)) != 3:
        fail(code)


def _validate_intent_continuity(
    database: dict[str, Any],
    migration: dict[str, Any],
    evidence: dict[str, Any],
) -> None:
    common = (
        "operation_id", "request_id", "project", "plan_sha256",
        "runtime_contract_policy_sha256", "source_closure_sha256",
    )
    if any(database[field] != migration[field] or database[field] != evidence[field]
           for field in common):
        fail("ISOLATED_UAT_RECEIPT_CHAIN_INTENT_CONTINUITY_INVALID")
    release = migration["release_source"]
    runtime = evidence["runtime_source"]
    if any(release[field] != runtime[field] for field in (
        "package_version", "git_commit", "git_tree", "resolved_compose_sha256",
    )) or migration["migration"]["to_head"] != runtime["migration_head"] \
            or migration["migration"]["allowlist_sha256"] \
                != runtime["migration_allowlist_sha256"] \
            or any(
                evidence["containers"][service]["image_reference"]
                    != release["images"][service]["image_reference"]
                or evidence["containers"][service]["image_config_digest"]
                    != release["images"][service]["config_digest"]
                for service in ("web", "worker")
            ):
        fail("ISOLATED_UAT_RECEIPT_CHAIN_INTENT_CONTINUITY_INVALID")


def migration_allowlist_sha256(entries: list[dict[str, Any]]) -> str:
    ordered = [
        {
            "ordinal": entry["ordinal"],
            "filename": entry["filename"],
            "sha256": entry["sha256"],
        }
        for entry in entries
    ]
    raw = json.dumps(ordered, ensure_ascii=False, separators=(",", ":")) + "\n"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def migration_applied_ledger_sha256(entries: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for entry in entries:
        digest.update(canonical_json({
            "version": entry["filename"],
            "checksum": entry["sha256"],
        }).encode("utf-8"))
    return digest.hexdigest()


def validate_migration_allowlist(
    value: Any,
    intent_policy: dict[str, Any],
    receipt_policy: dict[str, Any],
) -> list[dict[str, Any]]:
    code = "ISOLATED_UAT_MIGRATION_ALLOWLIST_INVALID"
    if not isinstance(value, list):
        fail(code)
    entries = _clone(value, code)
    for ordinal, entry in enumerate(entries, 1):
        exact(entry, {"ordinal", "filename", "sha256"}, code)
        if type(entry["ordinal"]) is not int or entry["ordinal"] != ordinal \
                or not isinstance(entry["filename"], str) \
                or MIGRATION.fullmatch(entry["filename"]) is None \
                or int(entry["filename"][:4]) != ordinal:
            fail(code)
        _sha(entry["sha256"], code)
    invariants = receipt_policy["invariants"]
    if len(entries) != invariants["migration_count"] \
            or entries[-1]["filename"] != invariants["migration_target_head"] \
            or migration_allowlist_sha256(entries) != invariants["migration_allowlist_sha256"] \
            or migration_applied_ledger_sha256(entries) \
                != invariants["migration_applied_ledger_sha256"] \
            or intent_policy["invariants"]["migration_allowlist_sha256"] \
                != invariants["migration_allowlist_sha256"]:
        fail(code)
    return entries


def _validate_observed_roles(
    value: Any,
    expected: list[dict[str, Any]],
    receipt_policy: dict[str, Any],
    code: str,
) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        fail(code)
    roles = _clone(value, code)
    expected_roles = receipt_policy["invariants"]["technical_login_role_attributes"]
    if [item["role"] for item in expected] != [item["role"] for item in expected_roles]:
        fail(code)
    if roles != expected_roles:
        fail(code)
    return roles


def _validate_runtime_privilege_intent(
    value: Any,
    migration_intent: dict[str, Any],
    database_identity: dict[str, Any],
    migration_receipt: dict[str, Any],
    intent_policy: dict[str, Any],
    receipt_policy: dict[str, Any],
) -> dict[str, Any]:
    code = "ISOLATED_UAT_RUNTIME_PRIVILEGE_INTENT_INVALID"
    value = exact(value, set(RUNTIME_PRIVILEGE_INTENT_FIELDS), code)
    if value["schema_version"] != 1 or value["contract"] != RUNTIME_PRIVILEGE_INTENT_CONTRACT \
            or value["operation_id"] != migration_intent["operation_id"] \
            or value["request_id"] != migration_intent["request_id"] \
            or value["project"] != migration_intent["project"] \
            or value["plan_sha256"] != migration_intent["plan_sha256"] \
            or value["runtime_intent_policy_sha256"] != intent_policy["policy_sha256"] \
            or value["runtime_receipt_policy_sha256"] != receipt_policy["policy_sha256"] \
            or value["database_target_identity_sha256"] != database_identity["identity_sha256"] \
            or value["migration_execution_receipt_sha256"] != migration_receipt["receipt_sha256"] \
            or value["target_head"] != migration_intent["migration"]["to_head"] \
            or value["technical_login_roles"] != intent_policy["invariants"]["technical_login_roles"] \
            or value["runtime_privilege_policy_sha256"] \
                != receipt_policy["runtime_privilege_policy_binding"]["policy_sha256"] \
            or value["contract_validation_status"] != "STRUCTURE_VALID" \
            or value["execution_status"] != "NOT_EXECUTED" \
            or value["publication_status"] != "NOT_PUBLISHED":
        fail(code)
    body = {key: item for key, item in value.items() if key != "intent_sha256"}
    if canonical_sha256(body) != _sha(value["intent_sha256"], code):
        fail(code)
    return value


def _validate_database_chain(
    intent: dict[str, Any],
    receipts: dict[str, Any],
    evidence: dict[str, Any],
    binding: dict[str, Any],
    verification_time: datetime,
    receipt_policy: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], datetime]:
    fields = "ISOLATED_UAT_DATABASE_RECEIPT_FIELDS_INVALID"
    semantics = "ISOLATED_UAT_DATABASE_RECEIPT_SEMANTICS_INVALID"
    digest = "ISOLATED_UAT_DATABASE_RECEIPT_DIGEST_INVALID"
    target = exact(receipts["database_target_identity"],
                   set(RECEIPT_SPECS["database_target_identity"]["required_fields"]), fields)
    _reject_synthetic(target)
    expected_producer = _producer(binding, "DATABASE_BOOTSTRAP")
    expected_target = intent["database_target_expectation"]
    if target["schema_version"] != 1 \
            or target["contract"] != RECEIPT_SPECS["database_target_identity"]["contract"] \
            or target["bootstrap_intent_sha256"] != intent["intent_sha256"] \
            or target["producer"] != expected_producer \
            or target["database_name"] != expected_target["name"] \
            or target["system_identifier"] != intent["database_cluster_identity"]["system_identifier"] \
            or not isinstance(target["database_oid"], str) \
            or DATABASE_OID.fullmatch(target["database_oid"]) is None \
            or int(target["database_oid"]) > MAX_POSTGRESQL_OID \
            or target["marker"] != expected_target["marker"] \
            or target["owner"] != expected_target["owner"]:
        fail(semantics)
    _verify_digest(target, "identity_sha256", digest)

    observation = exact(evidence["database_bootstrap_observation"], {
        "schema_version", "contract", "bootstrap_intent_sha256", "producer", "project",
        "database_target_identity_sha256", "database_name", "system_identifier",
        "database_oid", "marker", "owner", "observed_login_roles", "observed_head",
        "schema_acl_status", "observed_at", "evidence_sha256",
    }, fields)
    _reject_synthetic(observation)
    roles = _validate_observed_roles(
        observation["observed_login_roles"], intent["login_role_expectations"],
        receipt_policy, semantics,
    )
    if observation["schema_version"] != 1 \
            or observation["contract"] != EVIDENCE_SPECS["database_bootstrap_observation"]["contract"] \
            or observation["bootstrap_intent_sha256"] != intent["intent_sha256"] \
            or observation["producer"] != expected_producer \
            or observation["project"] != intent["project"] \
            or observation["database_target_identity_sha256"] != target["identity_sha256"] \
            or any(observation[field] != target[field] for field in (
                "database_name", "system_identifier", "database_oid", "marker", "owner",
            )) or observation["observed_head"] != "EMPTY" \
            or observation["schema_acl_status"] != "DEFERRED_UNTIL_POST_MIGRATION":
        fail(semantics)
    observed_at = _time(observation["observed_at"], "ISOLATED_UAT_RECEIPT_TIME_INVALID")
    if observed_at > verification_time + timedelta(
        seconds=receipt_policy["invariants"]["max_future_skew_seconds"]
    ):
        fail("ISOLATED_UAT_RECEIPT_TIME_INVALID")
    _verify_digest(observation, "evidence_sha256", digest)

    receipt = exact(receipts["database_bootstrap_receipt"],
                    set(RECEIPT_SPECS["database_bootstrap_receipt"]["required_fields"]), fields)
    _reject_synthetic(receipt)
    completed_at = _time(receipt["completed_at"], "ISOLATED_UAT_RECEIPT_TIME_INVALID")
    receipt_observed_at = _time(receipt["observed_at"], "ISOLATED_UAT_RECEIPT_TIME_INVALID")
    if receipt["schema_version"] != 1 \
            or receipt["contract"] != RECEIPT_SPECS["database_bootstrap_receipt"]["contract"] \
            or receipt["bootstrap_intent_sha256"] != intent["intent_sha256"] \
            or receipt["producer"] != expected_producer \
            or receipt["database_target_identity_sha256"] != target["identity_sha256"] \
            or receipt["observed_login_roles"] != roles \
            or receipt["observed_login_roles_sha256"] != canonical_sha256({
                "contract": "chenyida-erp-isolated-uat-login-role-observation/v1",
                "roles": roles,
            }) or receipt["observed_head"] != observation["observed_head"] \
            or receipt["schema_acl_status"] != observation["schema_acl_status"] \
            or receipt["observation_bundle_sha256"] != observation["evidence_sha256"] \
            or receipt["observed_at"] != observation["observed_at"] \
            or receipt_observed_at > completed_at \
            or completed_at > verification_time + timedelta(
                seconds=receipt_policy["invariants"]["max_future_skew_seconds"]
            ):
        fail(semantics)
    _verify_digest(receipt, "receipt_sha256", digest)
    return target, receipt, completed_at


def _validate_migration_chain(
    intent: dict[str, Any],
    receipts: dict[str, Any],
    evidence: dict[str, Any],
    binding: dict[str, Any],
    expected_allowlist: list[dict[str, Any]],
    database_identity: dict[str, Any],
    bootstrap_receipt: dict[str, Any],
    previous_time: datetime,
    verification_time: datetime,
    receipt_policy: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], datetime]:
    fields = "ISOLATED_UAT_MIGRATION_RECEIPT_FIELDS_INVALID"
    semantics = "ISOLATED_UAT_MIGRATION_RECEIPT_SEMANTICS_INVALID"
    digest = "ISOLATED_UAT_MIGRATION_RECEIPT_DIGEST_INVALID"
    if intent["database_target_identity_sha256"] != database_identity["identity_sha256"] \
            or intent["database_bootstrap_receipt_sha256"] != bootstrap_receipt["receipt_sha256"]:
        fail("ISOLATED_UAT_RECEIPT_PREDECESSOR_INVALID")
    producer = _producer(binding, "MIGRATION")
    source = intent["release_source"]
    candidate = exact(receipts["release_candidate_receipt"],
                      set(RECEIPT_SPECS["release_candidate_receipt"]["required_fields"]), fields)
    _reject_synthetic(candidate)
    candidate_time = _time(candidate["published_at"], "ISOLATED_UAT_RECEIPT_TIME_INVALID")
    if candidate["schema_version"] != 1 \
            or candidate["contract"] != RECEIPT_SPECS["release_candidate_receipt"]["contract"] \
            or candidate["migration_intent_sha256"] != intent["intent_sha256"] \
            or candidate["producer"] != producer \
            or any(candidate[field] != source[field] for field in (
                "package_version", "git_commit", "git_tree", "images", "resolved_compose_sha256",
            )) or candidate["database_target_identity_sha256"] != database_identity["identity_sha256"] \
            or candidate["candidate_root_identity_sha256"] \
                != intent["release_candidate_root_identity_sha256"] \
            or candidate_time < previous_time:
        fail(semantics)
    _verify_digest(candidate, "receipt_sha256", digest)

    ledger = exact(evidence["migration_applied_ledger"], {
        "schema_version", "contract", "migration_intent_sha256", "producer",
        "database_target_identity_sha256", "rows", "applied_ledger_sha256",
        "evidence_sha256",
    }, fields)
    _reject_synthetic(ledger)
    rows = [
        {"version": entry["filename"], "checksum": entry["sha256"]}
        for entry in expected_allowlist
    ]
    if ledger["schema_version"] != 1 \
            or ledger["contract"] != EVIDENCE_SPECS["migration_applied_ledger"]["contract"] \
            or ledger["migration_intent_sha256"] != intent["intent_sha256"] \
            or ledger["producer"] != producer \
            or ledger["database_target_identity_sha256"] != database_identity["identity_sha256"] \
            or ledger["rows"] != rows \
            or ledger["applied_ledger_sha256"] \
                != receipt_policy["invariants"]["migration_applied_ledger_sha256"]:
        fail(semantics)
    _verify_digest(ledger, "evidence_sha256", digest)

    observation = exact(evidence["migration_observation"], {
        "schema_version", "contract", "migration_intent_sha256", "producer",
        "release_candidate_receipt_sha256", "database_target_identity_sha256",
        "from_head", "to_head", "applied_count", "applied_ledger_sha256",
        "applied_ledger_evidence_sha256", "observed_head", "observed_at",
        "evidence_sha256",
    }, fields)
    _reject_synthetic(observation)
    observed_time = _time(observation["observed_at"], "ISOLATED_UAT_RECEIPT_TIME_INVALID")
    migration = intent["migration"]
    if observation["schema_version"] != 1 \
            or observation["contract"] != EVIDENCE_SPECS["migration_observation"]["contract"] \
            or observation["migration_intent_sha256"] != intent["intent_sha256"] \
            or observation["producer"] != producer \
            or observation["release_candidate_receipt_sha256"] != candidate["receipt_sha256"] \
            or observation["database_target_identity_sha256"] != database_identity["identity_sha256"] \
            or observation["from_head"] != migration["from_head"] \
            or observation["to_head"] != migration["to_head"] \
            or observation["applied_count"] != migration["count"] \
            or observation["applied_ledger_sha256"] != ledger["applied_ledger_sha256"] \
            or observation["applied_ledger_evidence_sha256"] != ledger["evidence_sha256"] \
            or observation["observed_head"] != migration["to_head"] \
            or observed_time < candidate_time:
        fail(semantics)
    _verify_digest(observation, "evidence_sha256", digest)

    receipt = exact(receipts["migration_execution_receipt"],
                    set(RECEIPT_SPECS["migration_execution_receipt"]["required_fields"]), fields)
    _reject_synthetic(receipt)
    completed_time = _time(receipt["completed_at"], "ISOLATED_UAT_RECEIPT_TIME_INVALID")
    receipt_observed_time = _time(receipt["observed_at"], "ISOLATED_UAT_RECEIPT_TIME_INVALID")
    if receipt["schema_version"] != 1 \
            or receipt["contract"] != RECEIPT_SPECS["migration_execution_receipt"]["contract"] \
            or receipt["migration_intent_sha256"] != intent["intent_sha256"] \
            or receipt["producer"] != producer \
            or receipt["release_candidate_receipt_sha256"] != candidate["receipt_sha256"] \
            or receipt["database_target_identity_sha256"] != database_identity["identity_sha256"] \
            or receipt["from_head"] != migration["from_head"] \
            or receipt["to_head"] != migration["to_head"] \
            or receipt["applied_count"] != migration["count"] \
            or receipt["applied_ledger_sha256"] != ledger["applied_ledger_sha256"] \
            or receipt["observed_head"] != migration["to_head"] \
            or receipt["observation_bundle_sha256"] != observation["evidence_sha256"] \
            or receipt["observed_at"] != observation["observed_at"] \
            or receipt_observed_time > completed_time:
        fail(semantics)
    _verify_digest(receipt, "receipt_sha256", digest)
    return candidate, receipt, completed_time


def _validate_runtime_privilege_chain(
    intent: dict[str, Any],
    receipt: Any,
    observation: Any,
    binding: dict[str, Any],
    migration_intent: dict[str, Any],
    database_identity: dict[str, Any],
    migration_receipt: dict[str, Any],
    previous_time: datetime,
    verification_time: datetime,
    intent_policy: dict[str, Any],
    receipt_policy: dict[str, Any],
) -> tuple[dict[str, Any], datetime]:
    fields = "ISOLATED_UAT_RUNTIME_PRIVILEGE_RECEIPT_FIELDS_INVALID"
    semantics = "ISOLATED_UAT_RUNTIME_PRIVILEGE_RECEIPT_SEMANTICS_INVALID"
    digest = "ISOLATED_UAT_RUNTIME_PRIVILEGE_RECEIPT_DIGEST_INVALID"
    intent = _validate_runtime_privilege_intent(
        intent, migration_intent, database_identity, migration_receipt,
        intent_policy, receipt_policy,
    )
    producer = _producer(binding, "RUNTIME_PRIVILEGE")
    observation = exact(observation, {
        "schema_version", "contract", "runtime_privilege_intent_sha256", "producer",
        "project", "database_target_identity_sha256", "migration_execution_receipt_sha256",
        "runtime_privilege_policy_sha256", "observed_head", "observed_login_roles",
        "database_acl_status", "schema_acl_status", "default_acl_status",
        "relation_acl_status", "observed_at", "evidence_sha256",
    }, fields)
    _reject_synthetic(observation)
    expected_roles = receipt_policy["invariants"]["technical_login_role_attributes"]
    observed_time = _time(observation["observed_at"], "ISOLATED_UAT_RECEIPT_TIME_INVALID")
    if observation["schema_version"] != 1 \
            or observation["contract"] != EVIDENCE_SPECS["runtime_privilege_observation"]["contract"] \
            or observation["runtime_privilege_intent_sha256"] != intent["intent_sha256"] \
            or observation["producer"] != producer \
            or observation["project"] != intent["project"] \
            or observation["database_target_identity_sha256"] != database_identity["identity_sha256"] \
            or observation["migration_execution_receipt_sha256"] != migration_receipt["receipt_sha256"] \
            or observation["runtime_privilege_policy_sha256"] \
                != intent["runtime_privilege_policy_sha256"] \
            or observation["observed_head"] != intent["target_head"] \
            or observation["observed_login_roles"] != expected_roles \
            or any(observation[field] != "MATCHED_BOUND_POLICY" for field in (
                "database_acl_status", "schema_acl_status", "default_acl_status",
                "relation_acl_status",
            )) or observed_time < previous_time:
        fail(semantics)
    _verify_digest(observation, "evidence_sha256", digest)

    receipt = exact(receipt, set(RECEIPT_SPECS["runtime_privilege_receipt"]["required_fields"]), fields)
    _reject_synthetic(receipt)
    completed_time = _time(receipt["completed_at"], "ISOLATED_UAT_RECEIPT_TIME_INVALID")
    if receipt["schema_version"] != 1 \
            or receipt["contract"] != RECEIPT_SPECS["runtime_privilege_receipt"]["contract"] \
            or receipt["runtime_privilege_intent_sha256"] != intent["intent_sha256"] \
            or receipt["producer"] != producer \
            or receipt["project"] != intent["project"] \
            or receipt["database_target_identity_sha256"] != database_identity["identity_sha256"] \
            or receipt["migration_execution_receipt_sha256"] != migration_receipt["receipt_sha256"] \
            or receipt["runtime_privilege_policy_sha256"] \
                != intent["runtime_privilege_policy_sha256"] \
            or receipt["observation_bundle_sha256"] != observation["evidence_sha256"] \
            or receipt["observed_head"] != observation["observed_head"] \
            or receipt["observed_login_roles_sha256"] != canonical_sha256({
                "contract": "chenyida-erp-isolated-uat-runtime-login-role-observation/v1",
                "roles": expected_roles,
            }) or completed_time < observed_time \
            or completed_time > verification_time + timedelta(
                seconds=receipt_policy["invariants"]["max_future_skew_seconds"]
            ):
        fail(semantics)
    _verify_digest(receipt, "receipt_sha256", digest)
    return receipt, completed_time


def _validate_container_set(
    value: Any,
    intent: dict[str, Any],
    producer: dict[str, Any],
) -> dict[str, Any]:
    fields = "ISOLATED_UAT_CONTAINER_IDENTITY_FIELDS_INVALID"
    semantics = "ISOLATED_UAT_CONTAINER_IDENTITY_SEMANTICS_INVALID"
    value = exact(value, {
        "schema_version", "contract", "evidence_intent_sha256", "producer", "project",
        "containers", "evidence_sha256",
    }, fields)
    _reject_synthetic(value)
    if value["schema_version"] != 1 \
            or value["contract"] != EVIDENCE_SPECS["container_identity_set"]["contract"] \
            or value["evidence_intent_sha256"] != intent["intent_sha256"] \
            or value["producer"] != producer or value["project"] != intent["project"]:
        fail(semantics)
    containers = exact(value["containers"], {"postgres", "caddy", "web", "worker"}, fields)
    expected_networks = {
        "postgres": [f"{intent['project']}_backend"],
        "worker": [f"{intent['project']}_backend"],
        "web": [f"{intent['project']}_backend", f"{intent['project']}_edge"],
        "caddy": [f"{intent['project']}_edge"],
    }
    expected_health = {
        "postgres": "HEALTHY", "web": "HEALTHY", "worker": "HEALTHY", "caddy": "NONE",
    }
    ports = intent["loopback"]
    expected_ports = {
        "postgres": [],
        "worker": [],
        "web": [{
            "host_ip": "127.0.0.1", "host_port": ports["web"],
            "container_port": 3000, "protocol": "tcp",
        }],
        "caddy": [
            {"host_ip": "127.0.0.1", "host_port": ports["caddy_http"],
             "container_port": 80, "protocol": "tcp"},
            {"host_ip": "127.0.0.1", "host_port": ports["caddy_https"],
             "container_port": 443, "protocol": "tcp"},
            {"host_ip": "127.0.0.1", "host_port": ports["caddy_https"],
             "container_port": 443, "protocol": "udp"},
        ],
    }
    for service, container in containers.items():
        exact(container, {
            "project", "service", "container_id", "image_reference", "image_config_digest",
            "state", "health", "networks", "published_ports",
        }, fields)
        expected = intent["containers"][service]
        if container["project"] != intent["project"] or container["service"] != service \
                or not isinstance(container["container_id"], str) \
                or CONTAINER_ID.fullmatch(container["container_id"]) is None \
                or container["container_id"] != expected["container_id"] \
                or container["image_reference"] != expected["image_reference"] \
                or container["image_config_digest"] != expected["image_config_digest"] \
                or container["state"] != "RUNNING" or container["health"] != expected_health[service] \
                or container["networks"] != expected_networks[service] \
                or container["published_ports"] != expected_ports[service]:
            fail(semantics)
    _verify_digest(value, "evidence_sha256", "ISOLATED_UAT_CONTAINER_IDENTITY_DIGEST_INVALID")
    return value


def _validate_loopback_readiness(
    value: Any,
    intent: dict[str, Any],
    receipt_policy: dict[str, Any],
) -> dict[str, Any]:
    fields = "ISOLATED_UAT_READINESS_FIELDS_INVALID"
    semantics = "ISOLATED_UAT_READINESS_SEMANTICS_INVALID"
    value = exact(value, {"host", "ports", "probes", "health", "health_sha256"}, fields)
    ports = intent["loopback"]
    if value["host"] != ports["host"] or value["ports"] != {
        "web": ports["web"], "caddy_http": ports["caddy_http"],
        "caddy_https": ports["caddy_https"],
    }:
        fail(semantics)
    health = exact(value["health"], {
        "deployment_class", "deployment_id", "version", "revision", "migration_head",
        "migration_manifest_sha256", "components", "database_time",
    }, fields)
    components = {
        "postgresql": "READY", "migration": "READY", "worker": "READY",
        "uploads": "READY", "attachments": "READY", "runtime": "READY",
    }
    source = intent["runtime_source"]
    _time(health["database_time"], "ISOLATED_UAT_RECEIPT_TIME_INVALID")
    if health != {
        "deployment_class": "UAT",
        "deployment_id": intent["project"],
        "version": source["package_version"],
        "revision": source["git_commit"][:12],
        "migration_head": source["migration_head"],
        "migration_manifest_sha256": source["migration_allowlist_sha256"],
        "components": components,
        "database_time": health["database_time"],
    } or canonical_sha256({
        "contract": "chenyida-erp-isolated-uat-normalized-health/v1",
        "health": health,
    }) != _sha(value["health_sha256"], semantics):
        fail(semantics)
    probes = value["probes"]
    if not isinstance(probes, list) or len(probes) != 3:
        fail(fields)
    if any(not isinstance(probe, dict) for probe in probes):
        fail(fields)
    common_health = value["health_sha256"]
    expected = [
        {
            "id": "WEB_DIRECT", "scheme": "http", "port": ports["web"],
            "path": "/api/health", "status": 200,
            "normalized_health_sha256": common_health,
        },
        {
            "id": "CADDY_HTTP", "scheme": "http", "port": ports["caddy_http"],
            "path": "/api/health", "status": 308,
            "observed_location_sha256": probes[1].get("observed_location_sha256"),
            "route_binding_status": "NOT_VALIDATED_MISSING_BOUND_SERVER_NAME",
        },
        {
            "id": "CADDY_HTTPS", "scheme": "https", "port": ports["caddy_https"],
            "path": "/api/health", "status": 200, "tls_mode": "OBSERVED_LEAF_SHA256",
            "peer_certificate_sha256": probes[2].get("peer_certificate_sha256"),
            "normalized_health_sha256": common_health,
            "server_name_binding_status": "NOT_VALIDATED_MISSING_BOUND_SERVER_NAME",
        },
    ]
    if probes != expected:
        fail(semantics)
    _sha(probes[1]["observed_location_sha256"], semantics)
    _sha(probes[2]["peer_certificate_sha256"], semantics)
    return value


def _validate_evidence_chain(
    intent: dict[str, Any],
    receipts: dict[str, Any],
    evidence: dict[str, Any],
    binding: dict[str, Any],
    candidate: dict[str, Any],
    migration_receipt: dict[str, Any],
    runtime_privilege_receipt: dict[str, Any],
    previous_time: datetime,
    verification_time: datetime,
    receipt_policy: dict[str, Any],
) -> tuple[dict[str, Any], datetime]:
    fields = "ISOLATED_UAT_EVIDENCE_RECEIPT_FIELDS_INVALID"
    semantics = "ISOLATED_UAT_EVIDENCE_RECEIPT_SEMANTICS_INVALID"
    digest = "ISOLATED_UAT_EVIDENCE_RECEIPT_DIGEST_INVALID"
    if intent["release_candidate_receipt_sha256"] != candidate["receipt_sha256"] \
            or intent["migration_execution_receipt_sha256"] != migration_receipt["receipt_sha256"] \
            or intent["runtime_privilege_receipt_sha256"] != runtime_privilege_receipt["receipt_sha256"]:
        fail("ISOLATED_UAT_RECEIPT_PREDECESSOR_INVALID")
    producer = _producer(binding, "EVIDENCE")
    container_set = _validate_container_set(evidence["container_identity_set"], intent, producer)
    readiness = exact(receipts["readiness_receipt"],
                      set(RECEIPT_SPECS["readiness_receipt"]["required_fields"]), fields)
    _reject_synthetic(readiness)
    readiness_time = _time(readiness["observed_at"], "ISOLATED_UAT_RECEIPT_TIME_INVALID")
    loopback = _validate_loopback_readiness(readiness["loopback"], intent, receipt_policy)
    database_time = _time(
        loopback["health"]["database_time"], "ISOLATED_UAT_RECEIPT_TIME_INVALID"
    )
    source = intent["runtime_source"]
    if readiness["schema_version"] != 1 \
            or readiness["contract"] != RECEIPT_SPECS["readiness_receipt"]["contract"] \
            or readiness["evidence_intent_sha256"] != intent["intent_sha256"] \
            or readiness["producer"] != producer \
            or readiness["expected_package_version"] != source["package_version"] \
            or readiness["expected_git_commit"] != source["git_commit"] \
            or readiness["observed_package_version"] != source["package_version"] \
            or readiness["observed_git_commit"] != source["git_commit"] \
            or readiness_time < previous_time \
            or database_time < previous_time \
            or database_time > readiness_time:
        fail(semantics)
    _verify_digest(readiness, "receipt_sha256", digest)

    postdeploy = exact(receipts["isolated_uat_postdeploy_receipt"],
                       set(RECEIPT_SPECS["isolated_uat_postdeploy_receipt"]["required_fields"]), fields)
    _reject_synthetic(postdeploy)
    postdeploy_time = _time(postdeploy["observed_at"], "ISOLATED_UAT_RECEIPT_TIME_INVALID")
    if postdeploy["schema_version"] != 1 \
            or postdeploy["contract"] != RECEIPT_SPECS["isolated_uat_postdeploy_receipt"]["contract"] \
            or postdeploy["evidence_intent_sha256"] != intent["intent_sha256"] \
            or postdeploy["producer"] != producer \
            or postdeploy["readiness_receipt_sha256"] != readiness["receipt_sha256"] \
            or postdeploy["release_candidate_receipt_sha256"] != candidate["receipt_sha256"] \
            or postdeploy["migration_execution_receipt_sha256"] != migration_receipt["receipt_sha256"] \
            or postdeploy["runtime_privilege_receipt_sha256"] != runtime_privilege_receipt["receipt_sha256"] \
            or postdeploy["container_identity_set_sha256"] != container_set["evidence_sha256"] \
            or postdeploy_time < readiness_time:
        fail(semantics)
    _verify_digest(postdeploy, "receipt_sha256", digest)

    identity = exact(receipts["isolated_uat_runtime_identity_receipt"],
                     set(RECEIPT_SPECS["isolated_uat_runtime_identity_receipt"]["required_fields"]), fields)
    _reject_synthetic(identity)
    identity_time = _time(identity["published_at"], "ISOLATED_UAT_RECEIPT_TIME_INVALID")
    if identity["schema_version"] != 1 \
            or identity["contract"] != RECEIPT_SPECS["isolated_uat_runtime_identity_receipt"]["contract"] \
            or identity["evidence_intent_sha256"] != intent["intent_sha256"] \
            or identity["producer"] != producer \
            or identity["postdeploy_receipt_sha256"] != postdeploy["receipt_sha256"] \
            or identity["project"] != intent["project"] \
            or identity["runtime_source"] != intent["runtime_source"] \
            or identity["containers"] != container_set["containers"] \
            or identity["loopback"] != loopback \
            or identity["release_identity_reader_gid"] != intent["release_identity_reader_gid"] \
            or identity["identity_semantics"] != "ISOLATED_UAT_ONLY" \
            or identity["production_release_identity_compatible"] is not False \
            or identity_time < postdeploy_time \
            or identity_time > verification_time + timedelta(
                seconds=receipt_policy["invariants"]["max_future_skew_seconds"]
            ):
        fail(semantics)
    _verify_digest(identity, "receipt_sha256", digest)
    return identity, identity_time


def _validate_receipt_chain_impl(
    *,
    intents: Any,
    receipts: Any,
    evidence_payloads: Any,
    expected_migration_allowlist: Any,
    binding: dict[str, Any],
    verification_time: str,
    intent_policy: dict[str, Any],
    receipt_policy: dict[str, Any],
    receipt_policy_raw: bytes,
    expected_policy_roots: dict[str, Any],
    policy_sources: dict[str, bytes],
) -> dict[str, Any]:
    """Validate the full pure contract chain without establishing runtime truth."""
    intents = exact(_clone(intents, "ISOLATED_UAT_RECEIPT_CHAIN_FIELDS_INVALID"), {
        "DATABASE_BOOTSTRAP", "MIGRATION", "RUNTIME_PRIVILEGE", "EVIDENCE",
    }, "ISOLATED_UAT_RECEIPT_CHAIN_FIELDS_INVALID")
    receipts = exact(_clone(receipts, "ISOLATED_UAT_RECEIPT_CHAIN_FIELDS_INVALID"),
                     set(RECEIPT_SPECS), "ISOLATED_UAT_RECEIPT_CHAIN_FIELDS_INVALID")
    evidence_payloads = exact(
        _clone(evidence_payloads, "ISOLATED_UAT_RECEIPT_CHAIN_FIELDS_INVALID"),
        set(EVIDENCE_SPECS), "ISOLATED_UAT_RECEIPT_CHAIN_FIELDS_INVALID",
    )
    intent_policy = _clone(intent_policy, "ISOLATED_UAT_RECEIPT_CHAIN_FIELDS_INVALID")
    receipt_policy = _clone(receipt_policy, "ISOLATED_UAT_RECEIPT_CHAIN_FIELDS_INVALID")
    validate_policy_root_match(
        receipt_policy, intent_policy, receipt_policy_raw,
        expected_policy_roots, policy_sources,
    )
    validate_policy(receipt_policy, policy_sources, intent_policy)
    binding = _validate_binding(
        _clone(binding, "ISOLATED_UAT_RECEIPT_CHAIN_FIELDS_INVALID"),
        receipt_policy["action_binding"]["binding_sha256"],
    )
    verification = _time(verification_time, "ISOLATED_UAT_RECEIPT_TIME_INVALID")
    database_intent = _validate_bound_intent(
        "DATABASE_BOOTSTRAP", intents["DATABASE_BOOTSTRAP"], intent_policy,
    )
    migration_intent = _validate_bound_intent(
        "MIGRATION", intents["MIGRATION"], intent_policy,
    )
    evidence_intent = _validate_bound_intent(
        "EVIDENCE", intents["EVIDENCE"], intent_policy,
    )
    _validate_intent_continuity(database_intent, migration_intent, evidence_intent)
    allowlist = validate_migration_allowlist(
        expected_migration_allowlist, intent_policy, receipt_policy,
    )
    database_identity, bootstrap_receipt, bootstrap_time = _validate_database_chain(
        database_intent, receipts, evidence_payloads, binding, verification, receipt_policy,
    )
    candidate, migration_receipt, migration_time = _validate_migration_chain(
        migration_intent, receipts, evidence_payloads, binding, allowlist,
        database_identity, bootstrap_receipt, bootstrap_time, verification, receipt_policy,
    )
    runtime_privilege_receipt, privilege_time = _validate_runtime_privilege_chain(
        intents["RUNTIME_PRIVILEGE"], receipts["runtime_privilege_receipt"],
        evidence_payloads["runtime_privilege_observation"], binding, migration_intent,
        database_identity, migration_receipt, migration_time, verification,
        intent_policy, receipt_policy,
    )
    runtime_identity, identity_time = _validate_evidence_chain(
        evidence_intent, receipts, evidence_payloads, binding, candidate,
        migration_receipt, runtime_privilege_receipt, privilege_time,
        verification, receipt_policy,
    )
    chain_start_time = _time(
        evidence_payloads["database_bootstrap_observation"]["observed_at"],
        "ISOLATED_UAT_RECEIPT_TIME_INVALID",
    )
    if verification - chain_start_time > timedelta(
        seconds=receipt_policy["invariants"]["max_chain_age_seconds"]
    ):
        fail("ISOLATED_UAT_RECEIPT_CHAIN_STALE")
    external_anchors = {
        "credential_generation_receipt_sha256": database_intent[
            "credential_generation_receipt_sha256"
        ],
        "database_cluster_identity_sha256": database_intent[
            "database_cluster_identity_sha256"
        ],
        "release_candidate_root_identity_sha256": migration_intent[
            "release_candidate_root_identity_sha256"
        ],
        "one_shot_state_root_identity_sha256": evidence_intent[
            "one_shot_state_root_identity_sha256"
        ],
    }
    if sorted(external_anchors) != receipt_policy["external_digest_anchors"] \
            or any(not _sha(value, "ISOLATED_UAT_RECEIPT_EXTERNAL_ANCHOR_INVALID")
                   for value in external_anchors.values()):
        fail("ISOLATED_UAT_RECEIPT_EXTERNAL_ANCHOR_INVALID")
    body = {
        "schema_version": 1,
        "contract": CHAIN_CONTRACT,
        "binding_sha256": binding["binding_sha256"],
        "runtime_intent_policy_sha256": intent_policy["policy_sha256"],
        "runtime_receipt_policy_sha256": receipt_policy["policy_sha256"],
        "project": evidence_intent["project"],
        "plan_sha256": evidence_intent["plan_sha256"],
        "operation_id": evidence_intent["operation_id"],
        "request_id": evidence_intent["request_id"],
        "validated_receipt_sha256": {
            name: receipts[name][RECEIPT_SPECS[name]["digest_field"]]
            for name in sorted(RECEIPT_SPECS)
        },
        "validated_evidence_sha256": {
            name: evidence_payloads[name][EVIDENCE_SPECS[name]["digest_field"]]
            for name in sorted(EVIDENCE_SPECS)
        },
        "external_digest_anchors": external_anchors,
        "chain_head_sha256": runtime_identity["receipt_sha256"],
        "verified_at": verification_time,
        **VALIDATION_OUTPUT,
    }
    return {**_clone(body, "ISOLATED_UAT_RECEIPT_CHAIN_FIELDS_INVALID"),
            "validation_sha256": canonical_sha256(body)}


def validate_receipt_chain(
    *,
    intents: Any,
    receipts: Any,
    evidence_payloads: Any,
    expected_migration_allowlist: Any,
    binding: dict[str, Any],
    verification_time: str,
    intent_policy: dict[str, Any],
    receipt_policy: dict[str, Any],
    receipt_policy_raw: bytes,
    expected_policy_roots: dict[str, Any],
    policy_sources: dict[str, bytes],
) -> dict[str, Any]:
    """Fail closed with stable contract errors for all malformed injected values."""
    try:
        return _validate_receipt_chain_impl(
            intents=intents,
            receipts=receipts,
            evidence_payloads=evidence_payloads,
            expected_migration_allowlist=expected_migration_allowlist,
            binding=binding,
            verification_time=verification_time,
            intent_policy=intent_policy,
            receipt_policy=receipt_policy,
            receipt_policy_raw=receipt_policy_raw,
            expected_policy_roots=expected_policy_roots,
            policy_sources=policy_sources,
        )
    except ContractError:
        raise
    except (
        AttributeError, IndexError, KeyError, OverflowError, RecursionError, TypeError,
        UnicodeError, ValueError,
    ):
        fail("ISOLATED_UAT_RECEIPT_CHAIN_FIELDS_INVALID")


def require_receipt_publisher() -> None:
    fail("ISOLATED_UAT_RUNTIME_RECEIPT_PUBLISHER_NOT_IMPLEMENTED")
