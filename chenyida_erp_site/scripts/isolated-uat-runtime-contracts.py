#!/usr/bin/python3
"""Pure intent and receipt-shape contracts for the isolated UAT runtime path.

This module has no host, Docker, database, network, clock, random, or filesystem
capability.  Source bytes and synthetic ports are injected by callers.  The
synthetic adapter proves contract ordering only; it never creates runtime
evidence and cannot authorize execution.
"""

import ast
import hashlib
import json
import re
from typing import Any


POLICY_CONTRACT = "chenyida-erp-isolated-uat-runtime-contract-policy/v1"
POLICY_ID = "chenyida-erp-isolated-uat-runtime-contracts-v1"
SYNTHETIC_FIXTURE_SCOPE = "SYNTHETIC_CONTRACT_FIXTURE_ONLY"
EVIDENCE_SCOPE = "ISOLATED_UAT_CONTRACT_ONLY"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
GIT_OBJECT = re.compile(r"^[0-9a-f]{40}$")
PROJECT = re.compile(r"^chenyida-erp-uat-[a-z0-9][a-z0-9_-]{0,42}$")
IMAGE = re.compile(r"^[^@\s]+@sha256:[0-9a-f]{64}$")
OCI_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")

CAPABILITY_STATUS = {
    "intent_builders": "IMPLEMENTED_PURE",
    "receipt_shape_descriptors": "IMPLEMENTED_PURE",
    "receipt_field_semantics": "INCOMPLETE_DESCRIPTOR_ONLY",
    "receipt_validators": "NOT_IMPLEMENTED",
    "receipt_publishers": "NOT_IMPLEMENTED",
    "runtime_backends": "NOT_IMPLEMENTED",
    "execution_authorized": False,
}
OUTPUT_STATUS = {
    "contract_validation_status": "STRUCTURE_VALID",
    "execution_status": "NOT_EXECUTED",
    "publication_status": "NOT_PUBLISHED",
    "runtime_evidence_status": "NOT_AVAILABLE",
    "evidence_scope": EVIDENCE_SCOPE,
    "predecessor_chain_status": "NOT_VALIDATED",
}
COMMON_INPUT_FIELDS = {
    "operation_id", "request_id", "project", "plan_sha256",
    "runtime_contract_policy_sha256", "source_closure_sha256",
}
FAMILY_SPECS = {
    "DATABASE_BOOTSTRAP": {
        "intent_contract": "chenyida-erp-isolated-uat-database-bootstrap-intent/v1",
        "input_fields": sorted(COMMON_INPUT_FIELDS | {
            "database_cluster_identity", "credential_generation_receipt_sha256",
            "database_target_expectation", "login_role_expectations",
        }),
        "receipt_shapes": [
            {
                "output": "database_target_identity",
                "contract": "chenyida-erp-isolated-uat-database-target-identity/v1",
                "required_fields": [
                    "schema_version", "contract", "bootstrap_intent_sha256", "producer",
                    "database_name", "system_identifier", "database_oid", "marker", "owner",
                    "identity_sha256",
                ],
            },
            {
                "output": "database_bootstrap_receipt",
                "contract": "chenyida-erp-isolated-uat-database-bootstrap-receipt/v1",
                "required_fields": [
                    "schema_version", "contract", "bootstrap_intent_sha256", "producer",
                    "database_target_identity_sha256", "observed_login_roles",
                    "observed_login_roles_sha256", "observed_head", "schema_acl_status",
                    "observation_bundle_sha256", "observed_at", "completed_at", "receipt_sha256",
                ],
            },
        ],
    },
    "MIGRATION": {
        "intent_contract": "chenyida-erp-isolated-uat-migration-intent/v1",
        "input_fields": sorted(COMMON_INPUT_FIELDS | {
            "database_bootstrap_receipt_sha256", "database_target_identity_sha256",
            "release_source", "migration", "release_candidate_root_identity_sha256",
        }),
        "receipt_shapes": [
            {
                "output": "release_candidate_receipt",
                "contract": "chenyida-erp-isolated-uat-release-candidate-receipt/v1",
                "required_fields": [
                    "schema_version", "contract", "migration_intent_sha256", "producer",
                    "package_version", "git_commit", "git_tree", "images",
                    "resolved_compose_sha256", "database_target_identity_sha256",
                    "candidate_root_identity_sha256", "published_at", "receipt_sha256",
                ],
            },
            {
                "output": "migration_execution_receipt",
                "contract": "chenyida-erp-isolated-uat-migration-execution-receipt/v1",
                "required_fields": [
                    "schema_version", "contract", "migration_intent_sha256", "producer",
                    "release_candidate_receipt_sha256", "database_target_identity_sha256",
                    "from_head", "to_head", "applied_count", "applied_ledger_sha256",
                    "observed_head", "observation_bundle_sha256", "observed_at", "completed_at",
                    "receipt_sha256",
                ],
            },
        ],
    },
    "EVIDENCE": {
        "intent_contract": "chenyida-erp-isolated-uat-evidence-intent/v1",
        "input_fields": sorted(COMMON_INPUT_FIELDS | {
            "release_candidate_receipt_sha256", "migration_execution_receipt_sha256",
            "runtime_privilege_receipt_sha256", "runtime_source", "containers", "loopback",
            "release_identity_reader_gid", "one_shot_state_root_identity_sha256",
        }),
        "receipt_shapes": [
            {
                "output": "readiness_receipt",
                "contract": "chenyida-erp-isolated-uat-readiness-receipt/v1",
                "required_fields": [
                    "schema_version", "contract", "evidence_intent_sha256", "producer",
                    "loopback", "expected_package_version", "expected_git_commit",
                    "observed_package_version", "observed_git_commit", "observed_at",
                    "receipt_sha256",
                ],
            },
            {
                "output": "isolated_uat_postdeploy_receipt",
                "contract": "chenyida-erp-isolated-uat-postdeploy-receipt/v1",
                "required_fields": [
                    "schema_version", "contract", "evidence_intent_sha256", "producer",
                    "readiness_receipt_sha256", "release_candidate_receipt_sha256",
                    "migration_execution_receipt_sha256", "runtime_privilege_receipt_sha256",
                    "container_identity_set_sha256", "observed_at", "receipt_sha256",
                ],
            },
            {
                "output": "isolated_uat_runtime_identity_receipt",
                "contract": "chenyida-erp-isolated-uat-runtime-identity-receipt/v1",
                "required_fields": [
                    "schema_version", "contract", "evidence_intent_sha256", "producer",
                    "postdeploy_receipt_sha256", "project", "runtime_source", "containers",
                    "loopback", "release_identity_reader_gid", "identity_semantics",
                    "production_release_identity_compatible", "published_at", "receipt_sha256",
                ],
            },
        ],
    },
}
FAMILY_ORDER = ["DATABASE_BOOTSTRAP", "MIGRATION", "EVIDENCE"]
FAMILY_DERIVED_FIELDS = {
    "DATABASE_BOOTSTRAP": {"database_cluster_identity_sha256", "full_schema_acl_status"},
    "MIGRATION": {"release_candidate_spec_status"},
    "EVIDENCE": {"identity_semantics", "production_release_identity_compatible"},
}
PORT_METHODS = [
    "validate_database_bootstrap_shapes",
    "validate_migration_shapes",
    "validate_evidence_shapes",
]
SOURCE_ROOT = "scripts/isolated-uat-runtime-contracts.py"
EXTERNAL_IMPORTS = ["ast", "hashlib", "json", "re", "typing"]
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


class ContractError(Exception):
    pass


def fail(code: str) -> None:
    raise ContractError(code)


def exact(value: Any, keys: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        fail(code)
    return value


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _is_sha(value: Any) -> bool:
    return isinstance(value, str) and value != "0" * 64 and SHA256.fullmatch(value) is not None


def _validate_policy_hash(value: dict[str, Any]) -> None:
    body = {key: item for key, item in value.items() if key != "policy_sha256"}
    if not _is_sha(value.get("policy_sha256")) or canonical_sha256(body) != value["policy_sha256"]:
        fail("ISOLATED_UAT_RUNTIME_CONTRACT_SHA256_INVALID")


def _canonical_repo_path(value: Any) -> bool:
    if not isinstance(value, str) or not value or value.startswith("/") or "\\" in value:
        return False
    parts = value.split("/")
    return all(part not in ("", ".", "..") for part in parts)


def validate_source_closure(value: Any, sources: dict[str, bytes]) -> dict[str, Any]:
    value = exact(value, {
        "schema_version", "algorithm", "roots", "members", "edges", "external_imports",
        "forbidden_paths", "declared_non_runtime_capabilities", "validation_scope",
        "source_closure_sha256",
    }, "ISOLATED_UAT_RUNTIME_CONTRACT_SOURCE_CLOSURE_INVALID")
    if value["schema_version"] != 1 \
            or value["algorithm"] != "PYTHON_SINGLE_FILE_FIXED_IMPORT_ALLOWLIST_V1":
        fail("ISOLATED_UAT_RUNTIME_CONTRACT_SOURCE_CLOSURE_INVALID")
    roots = value["roots"]
    members = value["members"]
    edges = value["edges"]
    external = value["external_imports"]
    forbidden_paths = value["forbidden_paths"]
    if roots != [SOURCE_ROOT] or edges != [] or external != EXTERNAL_IMPORTS \
            or forbidden_paths != FORBIDDEN_PATHS \
            or value["declared_non_runtime_capabilities"] != DECLARED_NON_RUNTIME_CAPABILITIES \
            or value["validation_scope"] \
                != "SOURCE_HASH_IMPORT_ALLOWLIST_AND_DIRECT_BUILTIN_GUARD_NOT_A_SANDBOX":
        fail("ISOLATED_UAT_RUNTIME_CONTRACT_SOURCE_CLOSURE_INVALID")
    if not isinstance(roots, list) or not roots or roots != sorted(set(roots)) \
            or not isinstance(members, list) or not members \
            or not isinstance(edges, list) or not isinstance(external, list) \
            or external != sorted(set(external)) \
            or not isinstance(forbidden_paths, list) or forbidden_paths != sorted(set(forbidden_paths)):
        fail("ISOLATED_UAT_RUNTIME_CONTRACT_SOURCE_CLOSURE_INVALID")
    member_paths: list[str] = []
    member_hashes: dict[str, str] = {}
    for member in members:
        exact(member, {"path", "sha256"}, "ISOLATED_UAT_RUNTIME_CONTRACT_SOURCE_CLOSURE_INVALID")
        path = member["path"]
        if not _canonical_repo_path(path) or not _is_sha(member["sha256"]) or path in member_hashes:
            fail("ISOLATED_UAT_RUNTIME_CONTRACT_SOURCE_CLOSURE_INVALID")
        if path.startswith("tests/") or path in forbidden_paths:
            fail("ISOLATED_UAT_RUNTIME_CONTRACT_SOURCE_CLOSURE_INVALID")
        member_paths.append(path)
        member_hashes[path] = member["sha256"]
    if member_paths != [SOURCE_ROOT] or any(root not in member_hashes for root in roots) \
            or set(sources) != set(member_paths):
        fail("ISOLATED_UAT_RUNTIME_CONTRACT_SOURCE_CLOSURE_INVALID")
    adjacency = {path: set() for path in member_paths}
    for edge in edges:
        exact(edge, {"from", "to", "kind"}, "ISOLATED_UAT_RUNTIME_CONTRACT_SOURCE_CLOSURE_INVALID")
        if edge["kind"] != "STATIC_IMPORT" or edge["from"] not in adjacency or edge["to"] not in adjacency \
                or edge["to"] in adjacency[edge["from"]]:
            fail("ISOLATED_UAT_RUNTIME_CONTRACT_SOURCE_CLOSURE_INVALID")
        adjacency[edge["from"]].add(edge["to"])
    reachable: set[str] = set()
    pending = list(roots)
    while pending:
        path = pending.pop(0)
        if path in reachable:
            continue
        reachable.add(path)
        pending.extend(sorted(adjacency[path] - reachable))
    if reachable != set(member_paths):
        fail("ISOLATED_UAT_RUNTIME_CONTRACT_SOURCE_CLOSURE_INVALID")
    observed_external: set[str] = set()
    for path in member_paths:
        raw = sources[path]
        if not isinstance(raw, bytes) or hashlib.sha256(raw).hexdigest() != member_hashes[path]:
            fail("ISOLATED_UAT_RUNTIME_CONTRACT_SOURCE_CLOSURE_INVALID")
        try:
            tree = ast.parse(raw.decode("utf-8"), filename=path)
        except (UnicodeDecodeError, SyntaxError):
            fail("ISOLATED_UAT_RUNTIME_CONTRACT_SOURCE_CLOSURE_INVALID")
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                observed_external.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    fail("ISOLATED_UAT_RUNTIME_CONTRACT_SOURCE_CLOSURE_INVALID")
                if node.module:
                    observed_external.add(node.module.split(".")[0])
            elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                    and node.func.id in {"__import__", "eval", "exec", "open", "compile"}:
                fail("ISOLATED_UAT_RUNTIME_CONTRACT_SOURCE_CLOSURE_INVALID")
    if sorted(observed_external) != external:
        fail("ISOLATED_UAT_RUNTIME_CONTRACT_SOURCE_CLOSURE_INVALID")
    body = {key: item for key, item in value.items() if key != "source_closure_sha256"}
    if not _is_sha(value["source_closure_sha256"]) \
            or canonical_sha256(body) != value["source_closure_sha256"]:
        fail("ISOLATED_UAT_RUNTIME_CONTRACT_SOURCE_CLOSURE_INVALID")
    return value


def validate_policy(value: Any, sources: dict[str, bytes]) -> dict[str, Any]:
    value = exact(value, {
        "schema_version", "contract", "policy_id", "execution_authorized",
        "capability_status", "output_status", "synthetic_fixture_scope", "invariants",
        "families", "source_closure", "policy_sha256",
    }, "ISOLATED_UAT_RUNTIME_CONTRACT_FIELDS_INVALID")
    if value["schema_version"] != 1 or value["contract"] != POLICY_CONTRACT \
            or value["policy_id"] != POLICY_ID or value["execution_authorized"] is not False \
            or value["capability_status"] != CAPABILITY_STATUS or value["output_status"] != OUTPUT_STATUS \
            or value["synthetic_fixture_scope"] != SYNTHETIC_FIXTURE_SCOPE:
        fail("ISOLATED_UAT_RUNTIME_CONTRACT_FIELDS_INVALID")
    if value["invariants"] != {
        "database_current_head": "EMPTY",
        "database_name": "chenyida_erp",
        "database_owner": "chenyida_erp_owner",
        "deployment_class": "UAT",
        "identity_semantics": "ISOLATED_UAT_ONLY",
        "loopback_host": "127.0.0.1",
        "migration_allowlist_sha256": "8bb2b2d662df03e397d49c4ed5d11f1af1a9406ecbaff37aee8fc0d2d7388eed",
        "migration_count": 46,
        "migration_target_head": "0046_runtime_lock_privilege_boundary.sql",
        "package_version": "0.1.0-alpha.47",
        "production_release_identity_compatible": False,
        "release_identity_reader_gid": 65532,
        "role_credentials": {
            "chenyida_erp_admin": "admin-database-password",
            "chenyida_erp_backup": "backup-capture-service.conf",
            "chenyida_erp_owner": "migration-database-password",
            "chenyida_erp_web": "web-database-password",
            "chenyida_erp_worker": "worker-database-password",
        },
        "technical_login_roles": [
            "chenyida_erp_admin", "chenyida_erp_backup", "chenyida_erp_owner",
            "chenyida_erp_web", "chenyida_erp_worker",
        ],
    } or value["families"] != FAMILY_SPECS:
        fail("ISOLATED_UAT_RUNTIME_CONTRACT_FIELDS_INVALID")
    validate_source_closure(value["source_closure"], sources)
    _validate_policy_hash(value)
    return value


def _validate_common(value: dict[str, Any], policy: dict[str, Any], code: str) -> None:
    if not isinstance(value["operation_id"], str) or not IDENTIFIER.fullmatch(value["operation_id"]) \
            or not isinstance(value["request_id"], str) or not IDENTIFIER.fullmatch(value["request_id"]) \
            or not isinstance(value["project"], str) or not PROJECT.fullmatch(value["project"]) \
            or not all(_is_sha(value[field]) for field in (
                "plan_sha256", "runtime_contract_policy_sha256", "source_closure_sha256",
            )) \
            or value["runtime_contract_policy_sha256"] != policy["policy_sha256"] \
            or value["source_closure_sha256"] != policy["source_closure"]["source_closure_sha256"]:
        fail(code)


def _validate_database_inputs(value: dict[str, Any], policy: dict[str, Any]) -> None:
    code = "ISOLATED_UAT_DATABASE_BOOTSTRAP_INTENT_INVALID"
    _validate_common(value, policy, code)
    cluster = exact(value["database_cluster_identity"], {
        "project", "postgres_container_identity_sha256", "system_identifier",
    }, code)
    target = exact(value["database_target_expectation"], {
        "deployment_class", "deployment_id", "name", "marker", "owner", "current_head",
    }, code)
    roles = value["login_role_expectations"]
    if cluster["project"] != value["project"] or not _is_sha(cluster["postgres_container_identity_sha256"]) \
            or not isinstance(cluster["system_identifier"], str) \
            or re.fullmatch(r"[1-9][0-9]{9,29}", cluster["system_identifier"]) is None \
            or not _is_sha(value["credential_generation_receipt_sha256"]) \
            or target != {
                "deployment_class": policy["invariants"]["deployment_class"],
                "deployment_id": value["project"],
                "name": policy["invariants"]["database_name"],
                "marker": f"chenyida-erp-deployment/v2:UAT:{value['project']}",
                "owner": policy["invariants"]["database_owner"],
                "current_head": policy["invariants"]["database_current_head"],
            } or roles != [
                {"role": role, "credential_file": policy["invariants"]["role_credentials"][role]}
                for role in policy["invariants"]["technical_login_roles"]
            ]:
        fail(code)


def _validate_release_source(value: Any, policy: dict[str, Any], code: str) -> None:
    value = exact(value, {
        "package_version", "git_commit", "git_tree", "images", "resolved_compose_sha256",
    }, code)
    if value["package_version"] != policy["invariants"]["package_version"] \
            or not isinstance(value["git_commit"], str) or not GIT_OBJECT.fullmatch(value["git_commit"]) \
            or not isinstance(value["git_tree"], str) or not GIT_OBJECT.fullmatch(value["git_tree"]) \
            or not _is_sha(value["resolved_compose_sha256"]):
        fail(code)
    images = exact(value["images"], {"web", "worker"}, code)
    for image in images.values():
        exact(image, {"image_reference", "config_digest"}, code)
        if not isinstance(image["image_reference"], str) or not IMAGE.fullmatch(image["image_reference"]) \
                or not isinstance(image["config_digest"], str) or not OCI_DIGEST.fullmatch(image["config_digest"]):
            fail(code)


def _validate_migration_inputs(value: dict[str, Any], policy: dict[str, Any]) -> None:
    code = "ISOLATED_UAT_MIGRATION_INTENT_INVALID"
    _validate_common(value, policy, code)
    migration = exact(value["migration"], {"from_head", "to_head", "count", "allowlist_sha256"}, code)
    if not all(_is_sha(value[field]) for field in (
        "database_bootstrap_receipt_sha256", "database_target_identity_sha256",
        "release_candidate_root_identity_sha256",
    )) or migration["from_head"] != policy["invariants"]["database_current_head"] \
            or not isinstance(migration["to_head"], str) \
            or re.fullmatch(r"[0-9]{4}_[a-z0-9_]+\.sql", migration["to_head"]) is None \
            or migration["to_head"] != policy["invariants"]["migration_target_head"] \
            or migration["count"] != policy["invariants"]["migration_count"] \
            or migration["allowlist_sha256"] != policy["invariants"]["migration_allowlist_sha256"]:
        fail(code)
    _validate_release_source(value["release_source"], policy, code)


def _validate_evidence_inputs(value: dict[str, Any], policy: dict[str, Any]) -> None:
    code = "ISOLATED_UAT_EVIDENCE_INTENT_INVALID"
    _validate_common(value, policy, code)
    if not all(_is_sha(value[field]) for field in (
        "release_candidate_receipt_sha256", "migration_execution_receipt_sha256",
        "runtime_privilege_receipt_sha256", "one_shot_state_root_identity_sha256",
    )):
        fail(code)
    runtime_source = exact(value["runtime_source"], {
        "package_version", "git_commit", "git_tree", "migration_head",
        "migration_allowlist_sha256", "resolved_compose_sha256",
    }, code)
    if runtime_source["package_version"] != policy["invariants"]["package_version"] \
            or not isinstance(runtime_source["git_commit"], str) or not GIT_OBJECT.fullmatch(runtime_source["git_commit"]) \
            or not isinstance(runtime_source["git_tree"], str) or not GIT_OBJECT.fullmatch(runtime_source["git_tree"]) \
            or runtime_source["migration_head"] != policy["invariants"]["migration_target_head"] \
            or runtime_source["migration_allowlist_sha256"] != policy["invariants"]["migration_allowlist_sha256"] \
            or not _is_sha(runtime_source["resolved_compose_sha256"]):
        fail(code)
    containers = exact(value["containers"], {"postgres", "caddy", "web", "worker"}, code)
    for container in containers.values():
        exact(container, {"project", "container_id", "image_reference", "image_config_digest"}, code)
        if container["project"] != value["project"] or not isinstance(container["container_id"], str) \
                or not IDENTIFIER.fullmatch(container["container_id"]) \
                or not isinstance(container["image_reference"], str) or not IMAGE.fullmatch(container["image_reference"]) \
                or not isinstance(container["image_config_digest"], str) or not OCI_DIGEST.fullmatch(container["image_config_digest"]):
            fail(code)
    loopback = exact(value["loopback"], {"host", "web", "caddy_http", "caddy_https"}, code)
    ports = [loopback["web"], loopback["caddy_http"], loopback["caddy_https"]]
    if loopback["host"] != policy["invariants"]["loopback_host"] \
            or any(type(port) is not int or port < 1024 or port > 65535 or port == 3000 for port in ports) \
            or len(set(ports)) != 3 \
            or value["release_identity_reader_gid"] != policy["invariants"]["release_identity_reader_gid"]:
        fail(code)


INPUT_VALIDATORS = {
    "DATABASE_BOOTSTRAP": _validate_database_inputs,
    "MIGRATION": _validate_migration_inputs,
    "EVIDENCE": _validate_evidence_inputs,
}


def build_intent(family: str, inputs: Any, policy: dict[str, Any]) -> dict[str, Any]:
    if family not in FAMILY_SPECS:
        fail("ISOLATED_UAT_RUNTIME_CONTRACT_FIELDS_INVALID")
    code = f"ISOLATED_UAT_{family}_INTENT_INVALID"
    inputs = exact(inputs, set(FAMILY_SPECS[family]["input_fields"]), code)
    INPUT_VALIDATORS[family](inputs, policy)
    try:
        frozen_inputs = json.loads(canonical_json(inputs))
    except (TypeError, ValueError):
        fail(code)
    if family == "DATABASE_BOOTSTRAP":
        derived = {
            "database_cluster_identity_sha256": canonical_sha256(frozen_inputs["database_cluster_identity"]),
            "full_schema_acl_status": "DEFERRED_UNTIL_POST_MIGRATION",
        }
    elif family == "MIGRATION":
        derived = {
            "release_candidate_spec_status": "SPECIFIED_NOT_PUBLISHED",
        }
    else:
        derived = {
            "identity_semantics": policy["invariants"]["identity_semantics"],
            "production_release_identity_compatible": policy["invariants"][
                "production_release_identity_compatible"
            ],
        }
    body = {
        "schema_version": 1,
        "contract": FAMILY_SPECS[family]["intent_contract"],
        **frozen_inputs,
        **derived,
        **OUTPUT_STATUS,
    }
    return {**body, "intent_sha256": canonical_sha256(body)}


def validate_intent(family: str, value: Any, policy: dict[str, Any]) -> dict[str, Any]:
    if family not in FAMILY_SPECS:
        fail("ISOLATED_UAT_RUNTIME_CONTRACT_FIELDS_INVALID")
    code = f"ISOLATED_UAT_{family}_INTENT_INVALID"
    expected_fields = set(FAMILY_SPECS[family]["input_fields"]) | FAMILY_DERIVED_FIELDS[family] | {
        "schema_version", "contract", "intent_sha256", *OUTPUT_STATUS.keys(),
    }
    value = exact(value, expected_fields, code)
    inputs = {key: value[key] for key in FAMILY_SPECS[family]["input_fields"]}
    expected = build_intent(family, inputs, policy)
    if canonical_json(value) != canonical_json(expected):
        fail(code)
    return value


def build_synthetic_shape_bundle(
    family: str,
    intent: dict[str, Any],
    policy: dict[str, Any],
) -> dict[str, Any]:
    validate_intent(family, intent, policy)
    shapes = []
    for shape in FAMILY_SPECS[family]["receipt_shapes"]:
        shape_body = {
            **shape,
            "required_fields": list(shape["required_fields"]),
            "fixture_scope": SYNTHETIC_FIXTURE_SCOPE,
            "intent_sha256": intent["intent_sha256"],
            "execution_status": "NOT_EXECUTED",
            "publication_status": "NOT_PUBLISHED",
            "runtime_evidence_status": "NOT_AVAILABLE",
        }
        shapes.append({**shape_body, "shape_sha256": canonical_sha256(shape_body)})
    body = {
        "schema_version": 1,
        "contract": "chenyida-erp-isolated-uat-synthetic-receipt-shape-bundle/v1",
        "family": family,
        "fixture_scope": SYNTHETIC_FIXTURE_SCOPE,
        "intent_sha256": intent["intent_sha256"],
        "shapes": shapes,
        "execution_status": "NOT_EXECUTED",
        "publication_status": "NOT_PUBLISHED",
        "runtime_evidence_status": "NOT_AVAILABLE",
        "predecessor_chain_status": "NOT_VALIDATED",
    }
    return {**body, "bundle_sha256": canonical_sha256(body)}


def validate_synthetic_shape_bundle(
    family: str,
    value: Any,
    intent: dict[str, Any],
    policy: dict[str, Any],
) -> dict[str, Any]:
    expected = build_synthetic_shape_bundle(family, intent, policy)
    if not isinstance(value, dict) or canonical_json(value) != canonical_json(expected):
        fail("ISOLATED_UAT_RUNTIME_CONTRACT_FIELDS_INVALID")
    return value


def run_synthetic_adapter(
    inputs: Any,
    port: Any,
    policy: dict[str, Any],
) -> dict[str, Any]:
    """Exercise three typed contract ports without producing runtime evidence."""
    inputs = exact(inputs, set(FAMILY_ORDER), "ISOLATED_UAT_RUNTIME_CONTRACT_FIELDS_INVALID")
    bootstrap_intent = build_intent("DATABASE_BOOTSTRAP", inputs["DATABASE_BOOTSTRAP"], policy)
    migration_intent = build_intent("MIGRATION", inputs["MIGRATION"], policy)
    evidence_intent = build_intent("EVIDENCE", inputs["EVIDENCE"], policy)
    common_values = [
        tuple(intent[field] for field in sorted(COMMON_INPUT_FIELDS))
        for intent in (bootstrap_intent, migration_intent, evidence_intent)
    ]
    migration_source = migration_intent["release_source"]
    evidence_source = evidence_intent["runtime_source"]
    migration = migration_intent["migration"]
    evidence_containers = evidence_intent["containers"]
    release_images = migration_source["images"]
    if len(set(common_values)) != 1 or any(
        migration_source.get(field) != evidence_source.get(field)
        for field in ("package_version", "git_commit", "git_tree", "resolved_compose_sha256")
    ) or migration.get("to_head") != evidence_source.get("migration_head") \
            or migration.get("allowlist_sha256") != evidence_source.get("migration_allowlist_sha256") \
            or any(
                not isinstance(evidence_containers.get(service), dict)
                or not isinstance(release_images.get(service), dict)
                or evidence_containers[service].get("image_reference") != release_images[service].get("image_reference")
                or evidence_containers[service].get("image_config_digest") != release_images[service].get("config_digest")
                for service in ("web", "worker")
            ):
        fail("ISOLATED_UAT_EVIDENCE_PREDECESSOR_MISMATCH")
    try:
        bootstrap_shapes = port.validate_database_bootstrap_shapes(json.loads(canonical_json(bootstrap_intent)))
    except AttributeError:
        fail("ISOLATED_UAT_RUNTIME_CONTRACT_FIELDS_INVALID")
    validate_synthetic_shape_bundle("DATABASE_BOOTSTRAP", bootstrap_shapes, bootstrap_intent, policy)

    try:
        migration_shapes = port.validate_migration_shapes(json.loads(canonical_json(migration_intent)))
    except AttributeError:
        fail("ISOLATED_UAT_RUNTIME_CONTRACT_FIELDS_INVALID")
    validate_synthetic_shape_bundle("MIGRATION", migration_shapes, migration_intent, policy)

    try:
        evidence_shapes = port.validate_evidence_shapes(json.loads(canonical_json(evidence_intent)))
    except AttributeError:
        fail("ISOLATED_UAT_RUNTIME_CONTRACT_FIELDS_INVALID")
    validate_synthetic_shape_bundle("EVIDENCE", evidence_shapes, evidence_intent, policy)

    body = {
        "schema_version": 1,
        "contract": "chenyida-erp-isolated-uat-synthetic-contract-adapter-result/v1",
        "fixture_scope": SYNTHETIC_FIXTURE_SCOPE,
        "port_methods": list(PORT_METHODS),
        "intent_sha256": {
            "database_bootstrap": bootstrap_intent["intent_sha256"],
            "migration": migration_intent["intent_sha256"],
            "evidence": evidence_intent["intent_sha256"],
        },
        "shape_bundle_sha256": {
            "database_bootstrap": bootstrap_shapes["bundle_sha256"],
            "migration": migration_shapes["bundle_sha256"],
            "evidence": evidence_shapes["bundle_sha256"],
        },
        "execution_status": "NOT_EXECUTED",
        "publication_status": "NOT_PUBLISHED",
        "runtime_evidence_status": "NOT_AVAILABLE",
        "predecessor_chain_status": "NOT_VALIDATED",
    }
    return {**body, "result_sha256": canonical_sha256(body)}


def require_runtime_backend() -> None:
    fail("ISOLATED_UAT_RUNTIME_BACKEND_NOT_IMPLEMENTED")
