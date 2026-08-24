#!/usr/bin/python3
"""Pure contracts for isolated-UAT external digest anchors.

The validator consumes caller-supplied JSON values only.  It can prove strict
shape, canonical digests and cross-object continuity; it cannot observe a host
directory, secret value, container or PostgreSQL cluster.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import datetime
from pathlib import PurePosixPath
from typing import Any


POLICY_CONTRACT = "chenyida-erp-isolated-uat-external-anchor-policy/v1"
POLICY_ID = "chenyida-erp-isolated-uat-external-anchors-v1"
VALIDATION_CONTRACT = "chenyida-erp-isolated-uat-external-anchor-validation/v1"
PLAN_CONTRACT = "chenyida-erp-isolated-uat-one-shot-plan/v4"
PLAN_ENTRYPOINT = "chenyida-erp-isolated-uat-one-shot-v4"
ACTION_BINDING_ID = "chenyida-erp-isolated-uat-fixed-actions-v4"
ACTION_BINDING_SHA256 = "fb83e0f20823b632525823f3d6c012769501fff1aec9763abc64d8d10d2b050b"
ACTION_BINDING_STATUS = "V3_ACTIONS_EXACTLY_INHERITED_EXTERNAL_ANCHOR_CONTRACTS_VALID_RUNTIME_FACTS_NOT_ESTABLISHED"
RUNTIME_CONTRACT_POLICY_SHA256 = "5f24335aa436309427465b6cb1c5c7ecb3778f0945f3d7ed48598008a0456586"
RUNTIME_RECEIPT_POLICY_SHA256 = "58c34e4627b379f3b0cdd607673633c339c1e570e8675d2a7108a01f994e9f6e"
RUNTIME_CONTRACT_SOURCE_CLOSURE_SHA256 = "978741a0bf244cd40076cca49fbedd0a3e3045e047b795c488e40a40436bc939"
RUNTIME_CONTRACT_CAPABILITY_STATUS = {
    "intent_builders": "IMPLEMENTED_PURE",
    "receipt_shape_descriptors": "IMPLEMENTED_PURE",
    "receipt_field_semantics": "INCOMPLETE_DESCRIPTOR_ONLY",
    "receipt_validators": "NOT_IMPLEMENTED",
    "receipt_publishers": "NOT_IMPLEMENTED",
    "runtime_backends": "NOT_IMPLEMENTED",
    "execution_authorized": False,
}
RUNTIME_RECEIPT_SOURCE_CLOSURE_SHA256 = "0a343c32d7efdaa9310e5fe81f703904630ac1c016268f883eb09c54f9d090d8"
RUNTIME_RECEIPT_CAPABILITY_STATUS = {
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
RUNTIME_RECEIPT_SUCCESS_OUTPUT_CONTRACT = {
    "receipt_contract_validation_status": "VALID",
    "predecessor_chain_status": "VALIDATED_PURE_INTERNAL_CONTRACT_CHAIN_FROM_UNVERIFIED_EXTERNAL_DIGEST_ANCHORS",
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
RECEIPT_CHAIN_BINDING = {
    "internal_contract": "chenyida-erp-isolated-uat-runtime-receipt-chain-binding/v1",
    "internal_validator_method": "validate_receipt_chain",
    "internal_validation_status": "PURE_CONTRACT_CHAIN_VALIDATOR_IMPLEMENTED_RUNTIME_FACTS_NOT_ESTABLISHED",
    "internal_node_count": 18,
    "internal_external_root_validation_statuses": ["VALIDATOR_NOT_IMPLEMENTED_THIS_SLICE"],
    "external_contract": "chenyida-erp-isolated-uat-external-anchor-policy/v1",
    "external_validator_method": "validate_external_anchor_contracts",
    "external_validation_status": "NOT_RUN_NO_EXTERNAL_EVIDENCE",
    "external_node_count": 5,
    "external_root_contract_statuses": ["PURE_CONTRACT_VALID_SOURCE_CALLER_INJECTED_NOT_ATTESTED"],
}
PROJECT = re.compile(r"^chenyida-erp-uat-[a-z0-9][a-z0-9_-]{0,42}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
IMAGE = re.compile(r"^[^@\s]+@sha256:[0-9a-f]{64}$")
GIT_OBJECT = re.compile(r"^[0-9a-f]{40}$")
MIGRATION = re.compile(r"^[0-9]{4}_[a-z0-9_]+\.sql$")
CONTAINER_ID = re.compile(r"^[0-9a-f]{64}$")
SYSTEM_IDENTIFIER = re.compile(r"^[1-9][0-9]{9,19}$")
MAX_SYSTEM_IDENTIFIER = 18_446_744_073_709_551_615
ZERO_SHA256 = "0" * 64
POSTGRES_IMAGE_REFERENCE = "postgres@sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394"
POSTGRES_IMAGE_CONFIG_DIGEST = "sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394"
TIME = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$")
MAX_DEPTH = 32
MAX_ITEMS = 20_000
MIGRATION_ALLOWLIST_SHA256 = "8bb2b2d662df03e397d49c4ed5d11f1af1a9406ecbaff37aee8fc0d2d7388eed"

ROOT_TEMPLATES = {
    "runtime_secret_root": "/etc/{project}/runtime-secrets",
    "backup_credential_root": "/etc/{project}/operator-credentials",
    "release_candidate_root": "/var/lib/{project}/release-candidate",
    "release_identity_root": "/var/lib/{project}/release-identity",
    "operator_state_root": "/var/lib/{project}/postgresql-runtime-privilege-operator",
    "one_shot_state_root": "/var/lib/{project}/isolated-uat-one-shot",
    "backup_root": "/var/backups/{project}",
}
PROTECTED_ROOTS = (
    "/etc/chenyida-erp",
    "/var/lib/chenyida-erp",
    "/var/backups/chenyida-erp-v2",
)
ROOT_PROFILES = {
    "runtime_secret_root": (0, 0, "0700"),
    "backup_credential_root": (0, 0, "0700"),
    "release_candidate_root": (0, 0, "0750"),
    "release_identity_root": (0, 65_532, "0750"),
    "operator_state_root": (0, 0, "0700"),
    "one_shot_state_root": (0, 0, "0700"),
    "backup_root": (0, 0, "0700"),
}
PRODUCERS = {
    "namespace": (2, "ISOLATED_UAT_HOST_ROOT_ADAPTER", "prepare_private_namespace_roots"),
    "credential": (3, "ISOLATED_UAT_CREDENTIAL_ADAPTER", "provision_distinct_credential_files"),
    "container": (4, "ISOLATED_UAT_COMPOSE_ADAPTER", "start_postgres_only"),
    "cluster": (4, "ISOLATED_UAT_COMPOSE_ADAPTER", "start_postgres_only"),
}
CREDENTIALS = [
    ("ADMIN_DATABASE_PASSWORD", "chenyida_erp_admin", "runtime_secret_root", "admin-database-password", 0, 65_532, "0440", "RUNTIME_SECRET"),
    ("ADMIN_PASSWORD", "admin_setup", "runtime_secret_root", "admin-password", 0, 65_532, "0440", "RUNTIME_SECRET"),
    ("BACKUP_CAPTURE_SERVICE", "chenyida_erp_backup", "backup_credential_root", "backup-capture-service.conf", 0, 0, "0400", "BACKUP_SERVICE_FILE"),
    ("MIGRATION_DATABASE_PASSWORD", "chenyida_erp_owner", "runtime_secret_root", "migration-database-password", 0, 0, "0440", "RUNTIME_SECRET"),
    ("POSTGRES_BOOTSTRAP_PASSWORD", "postgres_bootstrap", "runtime_secret_root", "postgres-bootstrap-password", 0, 999, "0440", "RUNTIME_SECRET"),
    ("WEB_DATABASE_PASSWORD", "chenyida_erp_web", "runtime_secret_root", "web-database-password", 0, 65_532, "0440", "RUNTIME_SECRET"),
    ("WORKER_DATABASE_PASSWORD", "chenyida_erp_worker", "runtime_secret_root", "worker-database-password", 0, 65_532, "0440", "RUNTIME_SECRET"),
]
PLAN_FIELDS = {
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
PLAN_ACTIONS = [
    (1, "VERIFY_EXACT_INPUTS", False, "CONTROL_REQUEST_VALIDATOR", "validate_exact_request"),
    (2, "PREPARE_PRIVATE_NAMESPACE_ROOTS", True, "ISOLATED_UAT_HOST_ROOT_ADAPTER", "prepare_private_namespace_roots"),
    (3, "PROVISION_DISTINCT_CREDENTIAL_FILES", True, "ISOLATED_UAT_CREDENTIAL_ADAPTER", "provision_distinct_credential_files"),
    (4, "START_POSTGRES_ONLY", True, "ISOLATED_UAT_COMPOSE_ADAPTER", "start_postgres_only"),
    (5, "INITIALIZE_DATABASE_IDENTITY_AND_LOGIN_ROLES", True, "ISOLATED_UAT_DATABASE_BOOTSTRAP_ADAPTER", "initialize_database_identity_and_login_roles"),
    (6, "MIGRATE_EMPTY_DATABASE_TO_BOUND_HEAD", True, "ISOLATED_UAT_MIGRATION_ADAPTER", "migrate_empty_database_to_bound_head"),
    (7, "RECONCILE_FINAL_RUNTIME_PRIVILEGES", True, "POSTGRESQL_RUNTIME_PRIVILEGE_PRIMITIVES", "reconcile_final_runtime_privileges"),
    (8, "START_BOUND_RUNTIME_SERVICES", True, "ISOLATED_UAT_COMPOSE_ADAPTER", "start_bound_runtime_services"),
    (9, "VERIFY_AND_PUBLISH_ISOLATED_UAT_EVIDENCE", True, "ISOLATED_UAT_POSTDEPLOY_EVIDENCE_ADAPTER", "verify_and_publish_isolated_uat_evidence"),
]
VALIDATION_OUTPUT = {
    "external_anchor_contract_status": "PURE_EXTERNAL_ANCHOR_CONTRACTS_VALID",
    "source_observation_status": "SOURCE_CALLER_INJECTED_NOT_ATTESTED",
    "control_plan_status": "CONTROL_PLAN_CONTRACT_CONTINUITY_VALID_SOURCE_NOT_ATTESTED",
    "authorization_status": "AUTHORIZATION_NOT_ESTABLISHED",
    "runtime_evidence_status": "NOT_ESTABLISHED_BY_PURE_VALIDATION",
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
            if any(not isinstance(key, str) or unicodedata.normalize("NFC", key) != key for key in current):
                fail(code)
            stack.extend((item, depth + 1) for item in current.values())
            continue
        fail(code)


def canonical_json(value: Any) -> str:
    _validate_json(value, "ISOLATED_UAT_EXTERNAL_JSON_INVALID")
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _sha(value: Any, code: str) -> str:
    if not isinstance(value, str) or SHA256.fullmatch(value) is None or value == ZERO_SHA256:
        fail(code)
    return value


def _digest(value: dict[str, Any], field: str, code: str) -> None:
    _sha(value.get(field), code)
    body = {key: item for key, item in value.items() if key != field}
    if canonical_sha256(body) != value[field]:
        fail(code)


def _time(value: Any, code: str) -> datetime:
    if not isinstance(value, str) or TIME.fullmatch(value) is None:
        fail(code)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        fail(code)
    if parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z") != value:
        fail(code)
    return parsed


def _producer(value: Any, kind: str, code: str) -> None:
    producer = exact(value, {"ordinal", "handler_id", "adapter_method"}, code)
    ordinal, handler, method = PRODUCERS[kind]
    if producer != {"ordinal": ordinal, "handler_id": handler, "adapter_method": method}:
        fail(code)


def _path(value: Any, code: str) -> PurePosixPath:
    if not isinstance(value, str) or not value.startswith("/") \
            or value.startswith("//") or value == "/" or len(value) > 512:
        fail(code)
    path = PurePosixPath(value)
    if str(path) != value or ".." in path.parts \
            or any(character in value for character in ("\x00", "\n", "\r")):
        fail(code)
    return path


def _overlaps(left: PurePosixPath, right: PurePosixPath) -> bool:
    return left == right or left in right.parents or right in left.parents


def _identity(value: Any, *, expected: tuple[int, int, str] | None, code: str) -> dict[str, Any]:
    value = exact(value, {
        "device", "inode", "uid", "gid", "mode", "nlink", "mount_id",
        "mount_point", "mount_root", "mount_source", "object_type", "symlink",
        "identity_sha256",
    }, code)
    if any(type(value[field]) is not int or value[field] < 1 for field in ("device", "inode", "mount_id")) \
            or type(value["uid"]) is not int or value["uid"] < 0 \
            or type(value["gid"]) is not int or value["gid"] < 0 \
            or type(value["nlink"]) is not int or value["nlink"] < 2 \
            or not isinstance(value["mode"], str) or re.fullmatch(r"0[0-7]{3}", value["mode"]) is None \
            or not isinstance(value["mount_source"], str) or not value["mount_source"] \
            or len(value["mount_source"]) > 512 \
            or any(character in value["mount_source"] for character in ("\x00", "\n", "\r")) \
            or value["object_type"] != "DIRECTORY" \
            or value["symlink"] is not False:
        fail(code)
    if expected is not None and (value["uid"], value["gid"], value["mode"]) != expected:
        fail(code)
    _digest(value, "identity_sha256", code)
    return value


def _mount_path(value: Any, code: str) -> PurePosixPath:
    if value == "/":
        return PurePosixPath("/")
    return _path(value, code)


def _validate_mount_location(
    value: dict[str, Any], observed_path: PurePosixPath, code: str,
) -> None:
    mount_point = _mount_path(value.get("mount_point"), code)
    mount_root = _mount_path(value.get("mount_root"), code)
    if mount_point != observed_path and mount_point not in observed_path.parents:
        fail(code)
    protected = [PurePosixPath(path) for path in PROTECTED_ROOTS]
    if any(mount_root == root or root in mount_root.parents for root in protected):
        fail(code)
    source = value.get("mount_source")
    if isinstance(source, str) and source.startswith("/"):
        source_path = _mount_path(source, code)
        if any(source_path == root or root in source_path.parents for root in protected):
            fail(code)


def _validate_policy_semantics(value: Any) -> dict[str, Any]:
    code = "ISOLATED_UAT_EXTERNAL_POLICY_INVALID"
    value = exact(value, {
        "schema_version", "contract", "policy_id", "execution_authorized",
        "capability_status", "validation_output", "upstream_bindings", "invariants",
        "source_closure", "policy_sha256",
    }, code)
    expected_capabilities = {
        "control_plan_validator": "IMPLEMENTED_PURE",
        "namespace_root_validator": "IMPLEMENTED_PURE",
        "credential_metadata_validator": "IMPLEMENTED_PURE_WITHOUT_SECRET_VALUES_OR_DIGESTS",
        "postgres_container_identity_validator": "IMPLEMENTED_PURE",
        "database_cluster_identity_validator": "IMPLEMENTED_PURE",
        "runtime_observation": "NOT_IMPLEMENTED",
        "publisher": "NOT_IMPLEMENTED",
        "execution_authorized": False,
    }
    expected_profiles = {
        key: {"uid": item[0], "gid": item[1], "mode": item[2]}
        for key, item in ROOT_PROFILES.items()
    }
    expected_credentials = [
        {
            "credential_id": item[0], "consumer": item[1], "root": item[2],
            "filename": item[3], "uid": item[4], "gid": item[5], "mode": item[6],
            "kind": item[7],
        }
        for item in CREDENTIALS
    ]
    if value["schema_version"] != 1 or value["contract"] != POLICY_CONTRACT \
            or value["policy_id"] != POLICY_ID or value["execution_authorized"] is not False \
            or value["capability_status"] != expected_capabilities \
            or value["validation_output"] != VALIDATION_OUTPUT \
            or value["invariants"] != {
                "project_pattern": PROJECT.pattern,
                "root_templates": ROOT_TEMPLATES,
                "protected_roots": list(PROTECTED_ROOTS),
                "root_profiles": expected_profiles,
                "credential_profile": expected_credentials,
                "postgres_image_reference": POSTGRES_IMAGE_REFERENCE,
                "postgres_image_config_digest": POSTGRES_IMAGE_CONFIG_DIGEST,
                "database_name": "chenyida_erp",
            }:
        fail(code)
    bindings = value["upstream_bindings"]
    expected_bindings = [
        ("operations/isolated-uat-runtime-contract-policy-v1.json", "4b7f6f741ff84c4ae7a4d8ee3d3641e7a9d3dc52b62c2b00d4c9f9c0f98020cc"),
        ("operations/isolated-uat-runtime-receipt-policy-v1.json", "1eee47ed1ed9311529153cc3e7defeb95984e075276af23a453a872c94027aac"),
        ("operations/runtime-secret-file-policy-v1.json", "8dd07c6acd6e857a0b29b14e2b6d5b60ad919cf54aac9b552ce11672eb45b7c5"),
    ]
    if not isinstance(bindings, list) or len(bindings) != len(expected_bindings):
        fail(code)
    for binding, expected in zip(bindings, expected_bindings):
        exact(binding, {"path", "sha256"}, code)
        if (binding["path"], binding["sha256"]) != expected:
            fail(code)
    closure = exact(value["source_closure"], {
        "schema_version", "algorithm", "roots", "members", "declared_absent_capabilities",
        "validation_scope", "source_closure_sha256",
    }, code)
    expected_member_paths = [item[0] for item in expected_bindings] + [
        "scripts/isolated-uat-external-anchor-contracts.py"
    ]
    if closure["schema_version"] != 1 or closure["algorithm"] != "PYTHON_STATIC_RESOURCE_CLOSURE_V1" \
            or closure["roots"] != ["scripts/isolated-uat-external-anchor-contracts.py"] \
            or not isinstance(closure["members"], list) \
            or [item.get("path") if isinstance(item, dict) else None for item in closure["members"]] != expected_member_paths \
            or closure["declared_absent_capabilities"] != [
                "CLOCK", "DATABASE", "DOCKER", "FILESYSTEM_RUNTIME_OBSERVATION", "NETWORK",
                "PROCESS", "RANDOM", "SECRET_VALUES", "SHELL",
            ] or closure["validation_scope"] != "SOURCE_HASH_AND_FIXED_UPSTREAM_RESOURCES_NOT_A_SANDBOX":
        fail(code)
    for index, member in enumerate(closure["members"]):
        exact(member, {"path", "sha256"}, code)
        _sha(member["sha256"], code)
        if index < len(expected_bindings) and member["sha256"] != expected_bindings[index][1]:
            fail(code)
    closure_body = {key: item for key, item in closure.items() if key != "source_closure_sha256"}
    if canonical_sha256(closure_body) != closure["source_closure_sha256"]:
        fail(code)
    _digest(value, "policy_sha256", code)
    return value


def validate_policy(value: Any, sources: dict[str, bytes]) -> dict[str, Any]:
    code = "ISOLATED_UAT_EXTERNAL_POLICY_INVALID"
    if not isinstance(sources, dict):
        fail(code)
    value = _validate_policy_semantics(value)
    if value["schema_version"] != 1 or value["contract"] != POLICY_CONTRACT \
            or value["policy_id"] != POLICY_ID or value["execution_authorized"] is not False:
        fail(code)
    if value["validation_output"] != VALIDATION_OUTPUT:
        fail(code)
    capabilities = exact(value["capability_status"], {
        "control_plan_validator", "namespace_root_validator", "credential_metadata_validator",
        "postgres_container_identity_validator", "database_cluster_identity_validator",
        "runtime_observation", "publisher", "execution_authorized",
    }, code)
    if capabilities != {
        "control_plan_validator": "IMPLEMENTED_PURE",
        "namespace_root_validator": "IMPLEMENTED_PURE",
        "credential_metadata_validator": "IMPLEMENTED_PURE_WITHOUT_SECRET_VALUES_OR_DIGESTS",
        "postgres_container_identity_validator": "IMPLEMENTED_PURE",
        "database_cluster_identity_validator": "IMPLEMENTED_PURE",
        "runtime_observation": "NOT_IMPLEMENTED",
        "publisher": "NOT_IMPLEMENTED",
        "execution_authorized": False,
    }:
        fail(code)
    invariants = exact(value["invariants"], {
        "project_pattern", "root_templates", "protected_roots", "root_profiles",
        "credential_profile", "postgres_image_reference", "postgres_image_config_digest",
        "database_name",
    }, code)
    expected_profiles = {
        key: {"uid": item[0], "gid": item[1], "mode": item[2]}
        for key, item in ROOT_PROFILES.items()
    }
    expected_credentials = [
        {
            "credential_id": item[0], "consumer": item[1], "root": item[2],
            "filename": item[3], "uid": item[4], "gid": item[5], "mode": item[6],
            "kind": item[7],
        }
        for item in CREDENTIALS
    ]
    if invariants != {
        "project_pattern": PROJECT.pattern,
        "root_templates": ROOT_TEMPLATES,
        "protected_roots": list(PROTECTED_ROOTS),
        "root_profiles": expected_profiles,
        "credential_profile": expected_credentials,
        "postgres_image_reference": POSTGRES_IMAGE_REFERENCE,
        "postgres_image_config_digest": POSTGRES_IMAGE_CONFIG_DIGEST,
        "database_name": "chenyida_erp",
    }:
        fail(code)
    bindings = value["upstream_bindings"]
    if not isinstance(bindings, list) or len(bindings) != 3:
        fail(code)
    expected_paths = [
        "operations/isolated-uat-runtime-contract-policy-v1.json",
        "operations/isolated-uat-runtime-receipt-policy-v1.json",
        "operations/runtime-secret-file-policy-v1.json",
    ]
    if [item.get("path") if isinstance(item, dict) else None for item in bindings] != expected_paths:
        fail(code)
    for binding in bindings:
        exact(binding, {"path", "sha256"}, code)
        raw = sources.get(binding["path"])
        if not isinstance(raw, bytes) or hashlib.sha256(raw).hexdigest() != binding["sha256"]:
            fail(code)
    closure = exact(value["source_closure"], {
        "schema_version", "algorithm", "roots", "members", "declared_absent_capabilities",
        "validation_scope", "source_closure_sha256",
    }, code)
    if closure["schema_version"] != 1 or closure["algorithm"] != "PYTHON_STATIC_RESOURCE_CLOSURE_V1" \
            or closure["roots"] != ["scripts/isolated-uat-external-anchor-contracts.py"] \
            or closure["declared_absent_capabilities"] != [
                "CLOCK", "DATABASE", "DOCKER", "FILESYSTEM_RUNTIME_OBSERVATION", "NETWORK",
                "PROCESS", "RANDOM", "SECRET_VALUES", "SHELL",
            ] or closure["validation_scope"] != "SOURCE_HASH_AND_FIXED_UPSTREAM_RESOURCES_NOT_A_SANDBOX":
        fail(code)
    members = closure["members"]
    if not isinstance(members, list) or [item.get("path") if isinstance(item, dict) else None for item in members] != [
        "operations/isolated-uat-runtime-contract-policy-v1.json",
        "operations/isolated-uat-runtime-receipt-policy-v1.json",
        "operations/runtime-secret-file-policy-v1.json",
        "scripts/isolated-uat-external-anchor-contracts.py",
    ]:
        fail(code)
    for member in members:
        exact(member, {"path", "sha256"}, code)
        raw = sources.get(member["path"])
        if not isinstance(raw, bytes) or hashlib.sha256(raw).hexdigest() != member["sha256"]:
            fail(code)
    closure_body = {key: item for key, item in closure.items() if key != "source_closure_sha256"}
    if canonical_sha256(closure_body) != closure["source_closure_sha256"]:
        fail(code)
    _digest(value, "policy_sha256", code)
    return value


def validate_control_plan(value: Any) -> dict[str, Any]:
    code = "ISOLATED_UAT_EXTERNAL_CONTROL_PLAN_INVALID"
    value = exact(value, PLAN_FIELDS, code)
    if value["schema_version"] != 4 or value["contract"] != PLAN_CONTRACT \
            or value["entrypoint_id"] != PLAN_ENTRYPOINT \
            or value["action_binding_id"] != ACTION_BINDING_ID \
            or value["action_binding_sha256"] != ACTION_BINDING_SHA256 \
            or value["action_binding_status"] != ACTION_BINDING_STATUS \
            or value["runtime_contract_policy_sha256"] != RUNTIME_CONTRACT_POLICY_SHA256 \
            or value["runtime_contract_source_closure_sha256"] != RUNTIME_CONTRACT_SOURCE_CLOSURE_SHA256 \
            or value["runtime_contract_capability_status"] != RUNTIME_CONTRACT_CAPABILITY_STATUS \
            or value["runtime_receipt_policy_sha256"] != RUNTIME_RECEIPT_POLICY_SHA256 \
            or value["runtime_receipt_source_closure_sha256"] != RUNTIME_RECEIPT_SOURCE_CLOSURE_SHA256 \
            or value["runtime_receipt_capability_status"] != RUNTIME_RECEIPT_CAPABILITY_STATUS \
            or value["mode"] != "READ_ONLY_PLAN" or value["execution_authorized"] is not False \
            or value["runtime_receipt_validation_status"] != "NOT_RUN_NO_RECEIPTS" \
            or value["runtime_receipt_success_output_contract"] != RUNTIME_RECEIPT_SUCCESS_OUTPUT_CONTRACT \
            or value["receipt_chain_binding"] != RECEIPT_CHAIN_BINDING \
            or value["external_anchor_validation_status"] != "NOT_RUN_NO_EXTERNAL_EVIDENCE":
        fail(code)
    _sha(value["policy_sha256"], code)
    _sha(value["external_anchor_policy_sha256"], code)
    if not isinstance(value["request_id"], str) or IDENTIFIER.fullmatch(value["request_id"]) is None \
            or not isinstance(value["project"], str) or PROJECT.fullmatch(value["project"]) is None:
        fail(code)
    _digest(value, "plan_sha256", code)
    roots = exact(value["roots"], set(ROOT_TEMPLATES), code)
    if roots != {key: template.format(project=value["project"]) for key, template in ROOT_TEMPLATES.items()}:
        fail(code)
    source = exact(value["source"], {
        "package_version", "git_commit", "git_tree", "migration_current_head",
        "migration_target_head", "migration_allowlist_sha256", "resolved_compose_sha256",
    }, code)
    if source["package_version"] != "0.1.0-alpha.47" \
            or source["migration_current_head"] != "EMPTY" \
            or source["migration_target_head"] != "0046_runtime_lock_privilege_boundary.sql" \
            or source["migration_allowlist_sha256"] != MIGRATION_ALLOWLIST_SHA256 \
            or not isinstance(source["git_commit"], str) or GIT_OBJECT.fullmatch(source["git_commit"]) is None \
            or source["git_commit"] == "0" * 40 \
            or not isinstance(source["git_tree"], str) or GIT_OBJECT.fullmatch(source["git_tree"]) is None \
            or source["git_tree"] == "0" * 40:
        fail(code)
    _sha(source["resolved_compose_sha256"], code)
    images = exact(value["images"], {"web", "worker"}, code)
    for image in images.values():
        exact(image, {"image_reference", "config_digest"}, code)
        if not isinstance(image["image_reference"], str) or IMAGE.fullmatch(image["image_reference"]) is None \
                or image["image_reference"].endswith(f"@sha256:{ZERO_SHA256}") \
                or not isinstance(image["config_digest"], str) \
                or re.fullmatch(r"sha256:[0-9a-f]{64}", image["config_digest"]) is None \
                or image["config_digest"] == f"sha256:{ZERO_SHA256}":
            fail(code)
    ports = exact(value["ports"], {"host_ip", "web", "caddy_http", "caddy_https"}, code)
    port_numbers = [ports["web"], ports["caddy_http"], ports["caddy_https"]]
    if ports["host_ip"] != "127.0.0.1" \
            or any(type(port) is not int or port < 1024 or port > 65_535 or port == 3000 for port in port_numbers) \
            or len(set(port_numbers)) != 3:
        fail(code)
    if value["database"] != {
        "name": "chenyida_erp",
        "current_head": "EMPTY",
        "target_head": "0046_runtime_lock_privilege_boundary.sql",
        "technical_login_roles": [
            "chenyida_erp_admin", "chenyida_erp_backup", "chenyida_erp_owner",
            "chenyida_erp_web", "chenyida_erp_worker",
        ],
    }:
        fail(code)
    allowlist = value["migration_allowlist_entries"]
    if not isinstance(allowlist, list) or len(allowlist) != 46:
        fail(code)
    for ordinal, item in enumerate(allowlist, 1):
        exact(item, {"ordinal", "filename", "sha256"}, code)
        if item["ordinal"] != ordinal or not isinstance(item["filename"], str) \
                or MIGRATION.fullmatch(item["filename"]) is None \
                or int(item["filename"][:4]) != ordinal:
            fail(code)
        _sha(item["sha256"], code)
    allowlist_raw = json.dumps(allowlist, ensure_ascii=False, separators=(",", ":")) + "\n"
    if hashlib.sha256(allowlist_raw.encode("utf-8")).hexdigest() != MIGRATION_ALLOWLIST_SHA256:
        fail(code)
    actions = value["actions"]
    if not isinstance(actions, list) or len(actions) != len(PLAN_ACTIONS):
        fail(code)
    for action, expected_action in zip(actions, PLAN_ACTIONS):
        exact(action, {"ordinal", "action", "mutates_runtime", "handler_id", "adapter_method"}, code)
        if (
            action["ordinal"], action["action"], action["mutates_runtime"],
            action["handler_id"], action["adapter_method"],
        ) != expected_action:
            fail(code)
    if value["failure_boundary"] != {
        "cleanup_scope": "EXACT_PROJECT_NAMESPACE_ONLY",
        "recovery": "DISPOSABLE_SYNTHETIC_RECREATE_FROM_EMPTY",
        "quarantine_before_cleanup": True,
    } or value["forbidden_production_entrypoints"] != [
        "scripts/postgresql-runtime-privilege-runner.mjs",
        "scripts/release-supervisor-launcher.py",
    ]:
        fail(code)
    return value


def validate_namespace_root_receipt(value: Any, plan: dict[str, Any]) -> dict[str, Any]:
    code = "ISOLATED_UAT_EXTERNAL_NAMESPACE_ROOT_RECEIPT_INVALID"
    value = exact(value, {
        "schema_version", "contract", "producer", "request_id", "project", "plan_sha256",
        "roots", "release_candidate_root_identity_sha256",
        "one_shot_state_root_identity_sha256", "observed_at", "receipt_sha256",
    }, code)
    _producer(value["producer"], "namespace", code)
    if value["schema_version"] != 1 or value["contract"] != "chenyida-erp-isolated-uat-namespace-root-receipt/v1" \
            or (value["request_id"], value["project"], value["plan_sha256"]) != (
                plan["request_id"], plan["project"], plan["plan_sha256"],
            ):
        fail(code)
    _time(value["observed_at"], code)
    roots = value["roots"]
    if not isinstance(roots, list) or len(roots) != len(ROOT_TEMPLATES):
        fail(code)
    identities: dict[str, str] = {}
    observed_ancestors: dict[str, dict[str, Any]] = {}
    physical_paths: dict[tuple[int, int], str] = {}
    mount_by_id: dict[int, tuple[str, str, str]] = {}
    id_by_mount: dict[tuple[str, str, str], int] = {}

    def register_mount(identity: dict[str, Any]) -> None:
        descriptor = (
            identity["mount_point"], identity["mount_root"], identity["mount_source"],
        )
        prior_descriptor = mount_by_id.get(identity["mount_id"])
        prior_id = id_by_mount.get(descriptor)
        if (prior_descriptor is not None and prior_descriptor != descriptor) \
                or (prior_id is not None and prior_id != identity["mount_id"]):
            fail(code)
        mount_by_id[identity["mount_id"]] = descriptor
        id_by_mount[descriptor] = identity["mount_id"]

    paths: list[PurePosixPath] = []
    for expected_name, item in zip(ROOT_TEMPLATES, roots):
        exact(item, {
            "name", "path", "ancestor_chain", "parent_identity_sha256", "identity",
        }, code)
        if item["name"] != expected_name \
                or item["path"] != ROOT_TEMPLATES[expected_name].format(project=plan["project"]):
            fail(code)
        path = _path(item["path"], code)
        expected_ancestors = list(reversed(path.parents))
        ancestor_chain = item["ancestor_chain"]
        if not isinstance(ancestor_chain, list) or len(ancestor_chain) != len(expected_ancestors):
            fail(code)
        for expected_path, ancestor in zip(expected_ancestors, ancestor_chain):
            ancestor = exact(ancestor, {"path", "identity"}, code)
            if ancestor["path"] != str(expected_path):
                fail(code)
            ancestor_identity = _identity(ancestor["identity"], expected=None, code=code)
            if ancestor_identity["uid"] != 0 or int(ancestor_identity["mode"], 8) & 0o022:
                fail(code)
            _validate_mount_location(ancestor_identity, expected_path, code)
            register_mount(ancestor_identity)
            prior = observed_ancestors.get(ancestor["path"])
            if prior is not None and ancestor_identity != prior:
                fail(code)
            observed_ancestors[ancestor["path"]] = ancestor_identity
            ancestor_key = (ancestor_identity["device"], ancestor_identity["inode"])
            prior_path = physical_paths.get(ancestor_key)
            if prior_path is not None and prior_path != ancestor["path"]:
                fail(code)
            physical_paths[ancestor_key] = ancestor["path"]
        if item["parent_identity_sha256"] != ancestor_chain[-1]["identity"]["identity_sha256"]:
            fail(code)
        identity = _identity(item["identity"], expected=ROOT_PROFILES[expected_name], code=code)
        _validate_mount_location(identity, path, code)
        register_mount(identity)
        key = (identity["device"], identity["inode"])
        if key in physical_paths and physical_paths[key] != item["path"]:
            fail(code)
        physical_paths[key] = item["path"]
        paths.append(path)
        identities[expected_name] = identity["identity_sha256"]
    protected = [PurePosixPath(path) for path in PROTECTED_ROOTS]
    if any(_overlaps(path, item) for path in paths for item in protected) \
            or any(_overlaps(path, other) for index, path in enumerate(paths) for other in paths[index + 1 :]):
        fail(code)
    if value["release_candidate_root_identity_sha256"] != identities["release_candidate_root"] \
            or value["one_shot_state_root_identity_sha256"] != identities["one_shot_state_root"]:
        fail(code)
    _digest(value, "receipt_sha256", code)
    return value


def validate_credential_receipt(
    value: Any, plan: dict[str, Any], namespace: dict[str, Any],
) -> dict[str, Any]:
    code = "ISOLATED_UAT_EXTERNAL_CREDENTIAL_RECEIPT_INVALID"
    value = exact(value, {
        "schema_version", "contract", "producer", "request_id", "project", "plan_sha256",
        "namespace_root_receipt_sha256", "generation_id", "password_format", "entries",
        "all_values_distinct", "value_observation_status", "secret_material_in_receipt",
        "observed_at", "receipt_sha256",
    }, code)
    _producer(value["producer"], "credential", code)
    if value["schema_version"] != 1 or value["contract"] != "chenyida-erp-isolated-uat-credential-generation-receipt/v1" \
            or (value["request_id"], value["project"], value["plan_sha256"]) != (
                plan["request_id"], plan["project"], plan["plan_sha256"],
            ) or value["namespace_root_receipt_sha256"] != namespace["receipt_sha256"] \
            or not isinstance(value["generation_id"], str) or IDENTIFIER.fullmatch(value["generation_id"]) is None \
            or value["password_format"] != "32_BYTE_CSPRNG_CANONICAL_BASE64URL" \
            or value["all_values_distinct"] is not True \
            or value["value_observation_status"] != "PRODUCER_ASSERTED_NOT_REVALIDATED_WITHOUT_SECRET_EXPOSURE" \
            or value["secret_material_in_receipt"] is not False:
        fail(code)
    _time(value["observed_at"], code)
    roots_by_name = {item["name"]: item for item in namespace["roots"]}
    root_identities = {
        name: item["identity"]["identity_sha256"] for name, item in roots_by_name.items()
    }
    entries = value["entries"]
    if not isinstance(entries, list) or len(entries) != len(CREDENTIALS):
        fail(code)
    physical: set[tuple[int, int]] = {
        (identity["device"], identity["inode"])
        for root in namespace["roots"]
        for identity in (
            root["identity"],
            *(ancestor["identity"] for ancestor in root["ancestor_chain"]),
        )
    }
    for expected, item in zip(CREDENTIALS, entries):
        item = exact(item, {
            "credential_id", "consumer", "kind", "root", "filename", "path",
            "root_identity_sha256", "device", "inode", "uid", "gid", "mode", "nlink",
            "mount_id", "mount_point", "mount_root", "mount_source", "size",
            "object_type", "symlink", "source_identity_sha256",
        }, code)
        identifier, consumer, root_name, filename, uid, gid, mode, kind = expected
        expected_path = f"{plan['roots'][root_name]}/{filename}"
        if (
            item["credential_id"], item["consumer"], item["kind"], item["root"],
            item["filename"], item["path"], item["root_identity_sha256"], item["uid"],
            item["gid"], item["mode"], item["object_type"], item["symlink"],
        ) != (
            identifier, consumer, kind, root_name, filename, expected_path,
            root_identities[root_name], uid, gid, mode, "REGULAR_FILE", False,
        ):
            fail(code)
        if any(type(item[field]) is not int or item[field] < 1 for field in ("device", "inode", "nlink", "mount_id", "size")):
            fail(code)
        root_identity = roots_by_name[root_name]["identity"]
        if (
            item["device"], item["mount_id"], item["mount_point"],
            item["mount_root"], item["mount_source"],
        ) != (
            root_identity["device"], root_identity["mount_id"],
            root_identity["mount_point"], root_identity["mount_root"],
            root_identity["mount_source"],
        ):
            fail(code)
        if item["nlink"] != 1:
            fail(code)
        if kind == "RUNTIME_SECRET" and item["size"] not in {43, 44}:
            fail(code)
        if kind == "BACKUP_SERVICE_FILE" and item["size"] > 4096:
            fail(code)
        if not isinstance(item["mount_source"], str) or not item["mount_source"] \
                or len(item["mount_source"]) > 512 \
                or any(character in item["mount_source"] for character in ("\x00", "\n", "\r")):
            fail(code)
        observed_path = _path(item["path"], code)
        _validate_mount_location(item, observed_path, code)
        _digest(item, "source_identity_sha256", code)
        physical_key = (item["device"], item["inode"])
        if physical_key in physical:
            fail(code)
        physical.add(physical_key)
    _digest(value, "receipt_sha256", code)
    return value


def validate_postgres_container_identity(
    value: Any, plan: dict[str, Any], namespace: dict[str, Any], credentials: dict[str, Any],
    policy: dict[str, Any],
) -> dict[str, Any]:
    code = "ISOLATED_UAT_EXTERNAL_POSTGRES_CONTAINER_IDENTITY_INVALID"
    value = exact(value, {
        "schema_version", "contract", "producer", "request_id", "project", "plan_sha256",
        "credential_generation_receipt_sha256", "resolved_compose_sha256", "service",
        "compose_project", "container_id", "image_reference", "image_config_digest",
        "network_observation_status", "network_mode", "networks", "published_ports",
        "mount_observation_status", "mounts", "tmpfs_mounts",
        "runtime_secret_root_identity_sha256", "running", "health", "observed_at",
        "identity_sha256",
    }, code)
    _producer(value["producer"], "container", code)
    runtime_roots = [
        item for item in namespace["roots"] if item["name"] == "runtime_secret_root"
    ]
    bootstrap_credentials = [
        item for item in credentials["entries"]
        if item["credential_id"] == "POSTGRES_BOOTSTRAP_PASSWORD"
    ]
    if len(runtime_roots) != 1 or len(bootstrap_credentials) != 1:
        fail(code)
    runtime_root = runtime_roots[0]
    bootstrap_credential = bootstrap_credentials[0]
    source = plan["source"]
    if value["schema_version"] != 1 or value["contract"] != "chenyida-erp-isolated-uat-postgres-container-identity/v1" \
            or (value["request_id"], value["project"], value["plan_sha256"]) != (
                plan["request_id"], plan["project"], plan["plan_sha256"],
            ) or value["credential_generation_receipt_sha256"] != credentials["receipt_sha256"] \
            or value["resolved_compose_sha256"] != source["resolved_compose_sha256"] \
            or value["service"] != "postgres" or value["compose_project"] != plan["project"] \
            or not isinstance(value["container_id"], str) or CONTAINER_ID.fullmatch(value["container_id"]) is None \
            or value["container_id"] == ZERO_SHA256 \
            or value["image_reference"] != policy["invariants"]["postgres_image_reference"] \
            or value["image_config_digest"] != policy["invariants"]["postgres_image_config_digest"] \
            or value["network_observation_status"] != "COMPLETE_DOCKER_INSPECT_NETWORKS_AND_PORT_BINDINGS" \
            or value["network_mode"] != f"{plan['project']}_backend" \
            or value["published_ports"] != [] \
            or value["mount_observation_status"] != "COMPLETE_DOCKER_INSPECT_MOUNTS_AND_HOSTCONFIG_TMPFS" \
            or value["runtime_secret_root_identity_sha256"] != runtime_root["identity"]["identity_sha256"] \
            or value["running"] is not True or value["health"] != "healthy":
        fail(code)
    _time(value["observed_at"], code)
    networks = value["networks"]
    if not isinstance(networks, list) or len(networks) != 1:
        fail(code)
    network = exact(networks[0], {"name", "internal", "network_id"}, code)
    if network["name"] != f"{plan['project']}_backend" or network["internal"] is not True:
        fail(code)
    _sha(network["network_id"], code)
    mounts = value["mounts"]
    if not isinstance(mounts, list) or len(mounts) != 3:
        fail(code)
    expected_mounts = [
        (
            "VOLUME", f"{plan['project']}_erp_postgres", "/var/lib/postgresql/data",
            False, "local", None,
        ),
        (
            "VOLUME", f"{plan['project']}_erp_postgres_tablespaces",
            "/var/lib/postgresql/tablespaces", False, "local", None,
        ),
        (
            "BIND", bootstrap_credential["path"],
            "/run/chenyida-erp-secrets/postgres-bootstrap-password", True, None,
            bootstrap_credential["source_identity_sha256"],
        ),
    ]
    source_identities: set[str] = set()
    for mount, expected in zip(mounts, expected_mounts):
        exact(mount, {
            "type", "source", "target", "read_only", "driver",
            "source_identity_sha256",
        }, code)
        mount_prefix = (
            mount["type"], mount["source"], mount["target"], mount["read_only"],
            mount["driver"],
        )
        if mount_prefix != expected[:5]:
            fail(code)
        source_identity = _sha(mount["source_identity_sha256"], code)
        if expected[5] is not None and source_identity != expected[5]:
            fail(code)
        source_identities.add(source_identity)
    if len(source_identities) != len(mounts):
        fail(code)
    if value["tmpfs_mounts"] != [
        {
            "target": "/tmp",
            "options": "rw,nosuid,nodev,noexec,size=32m,mode=1777",
        },
        {
            "target": "/run/chenyida-erp-secrets",
            "options": "rw,nosuid,nodev,noexec,size=1m,uid=0,gid=0,mode=0555",
        },
        {
            "target": "/var/run/postgresql",
            "options": "rw,nosuid,nodev,noexec,size=16m,uid=999,gid=999,mode=3775",
        },
    ]:
        fail(code)
    _digest(value, "identity_sha256", code)
    return value


def validate_database_cluster_identity(
    value: Any, plan: dict[str, Any], credentials: dict[str, Any], container: dict[str, Any],
) -> dict[str, Any]:
    code = "ISOLATED_UAT_EXTERNAL_DATABASE_CLUSTER_IDENTITY_INVALID"
    value = exact(value, {
        "schema_version", "contract", "producer", "request_id", "project", "plan_sha256",
        "credential_generation_receipt_sha256", "postgres_container_identity_sha256",
        "database_name", "system_identifier", "identity", "identity_sha256", "observed_at",
        "receipt_sha256",
    }, code)
    _producer(value["producer"], "cluster", code)
    if value["schema_version"] != 1 or value["contract"] != "chenyida-erp-isolated-uat-database-cluster-identity/v1" \
            or (value["request_id"], value["project"], value["plan_sha256"]) != (
                plan["request_id"], plan["project"], plan["plan_sha256"],
            ) or value["credential_generation_receipt_sha256"] != credentials["receipt_sha256"] \
            or value["postgres_container_identity_sha256"] != container["identity_sha256"] \
            or value["database_name"] != "chenyida_erp" \
            or not isinstance(value["system_identifier"], str) \
            or SYSTEM_IDENTIFIER.fullmatch(value["system_identifier"]) is None \
            or int(value["system_identifier"]) > MAX_SYSTEM_IDENTIFIER:
        fail(code)
    _time(value["observed_at"], code)
    projection = {
        "project": plan["project"],
        "postgres_container_identity_sha256": container["identity_sha256"],
        "system_identifier": value["system_identifier"],
    }
    if value["identity"] != projection or value["identity_sha256"] != canonical_sha256(projection):
        fail(code)
    _digest(value, "receipt_sha256", code)
    return value


def validate_external_anchor_contracts(
    *,
    control_plan: Any,
    namespace_root_receipt: Any,
    credential_generation_receipt: Any,
    postgres_container_identity: Any,
    database_cluster_identity: Any,
    policy: Any,
) -> dict[str, Any]:
    """Validate caller-injected contracts without claiming runtime attestation."""
    try:
        policy = _validate_policy_semantics(policy)
        plan = validate_control_plan(control_plan)
        if plan["external_anchor_policy_sha256"] != policy["policy_sha256"]:
            fail("ISOLATED_UAT_EXTERNAL_CONTROL_PLAN_INVALID")
        if plan["external_anchor_source_closure_sha256"] != policy["source_closure"]["source_closure_sha256"] \
                or plan["external_anchor_capability_status"] != policy["capability_status"] \
                or plan["external_anchor_success_output_contract"] != policy["validation_output"]:
            fail("ISOLATED_UAT_EXTERNAL_CONTROL_PLAN_INVALID")
        namespace = validate_namespace_root_receipt(namespace_root_receipt, plan)
        credentials = validate_credential_receipt(
            credential_generation_receipt, plan, namespace,
        )
        container = validate_postgres_container_identity(
            postgres_container_identity, plan, namespace, credentials, policy,
        )
        cluster = validate_database_cluster_identity(
            database_cluster_identity, plan, credentials, container,
        )
        times = [
            _time(namespace["observed_at"], "ISOLATED_UAT_EXTERNAL_TIME_INVALID"),
            _time(credentials["observed_at"], "ISOLATED_UAT_EXTERNAL_TIME_INVALID"),
            _time(container["observed_at"], "ISOLATED_UAT_EXTERNAL_TIME_INVALID"),
            _time(cluster["observed_at"], "ISOLATED_UAT_EXTERNAL_TIME_INVALID"),
        ]
        if times != sorted(times):
            fail("ISOLATED_UAT_EXTERNAL_TIME_INVALID")
        anchors = {
            "credential_generation_receipt_sha256": credentials["receipt_sha256"],
            "database_cluster_identity_sha256": cluster["identity_sha256"],
            "one_shot_state_root_identity_sha256": namespace[
                "one_shot_state_root_identity_sha256"
            ],
            "release_candidate_root_identity_sha256": namespace[
                "release_candidate_root_identity_sha256"
            ],
        }
        body = {
            "schema_version": 1,
            "contract": VALIDATION_CONTRACT,
            "project": plan["project"],
            "request_id": plan["request_id"],
            "plan_sha256": plan["plan_sha256"],
            "policy_sha256": policy["policy_sha256"],
            "namespace_root_receipt_sha256": namespace["receipt_sha256"],
            "credential_generation_receipt_sha256": credentials["receipt_sha256"],
            "postgres_container_identity_sha256": container["identity_sha256"],
            "database_cluster_identity_receipt_sha256": cluster["receipt_sha256"],
            "external_digest_anchors": anchors,
            **VALIDATION_OUTPUT,
        }
        return {**body, "validation_sha256": canonical_sha256(body)}
    except ContractError:
        raise
    except (AttributeError, IndexError, KeyError, OverflowError, RecursionError, TypeError, UnicodeError, ValueError):
        fail("ISOLATED_UAT_EXTERNAL_FIELDS_INVALID")


def require_external_anchor_publisher() -> None:
    fail("ISOLATED_UAT_EXTERNAL_ANCHOR_PUBLISHER_NOT_IMPLEMENTED")
