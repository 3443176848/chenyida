#!/usr/bin/python3
"""Pure Host/SNI intent contract for the loopback-only isolated UAT edge.

The module consumes caller-injected JSON and source bytes only.  It cannot
observe Caddy, TLS, Docker, a host, DNS, HTTP, a clock, or a certificate store.
Passing validation proves only deterministic contract structure and bound
source continuity; it never proves that a probe ran or that TLS is trusted.
"""

import ast
import hashlib
import json
import re
from typing import Any


POLICY_CONTRACT = "chenyida-erp-isolated-uat-caddy-host-sni-policy/v1"
POLICY_ID = "chenyida-erp-isolated-uat-caddy-host-sni-v1"
EXPECTATION_CONTRACT = "chenyida-erp-isolated-uat-caddy-host-sni-expectation/v1"
EVIDENCE_INTENT_CONTRACT = "chenyida-erp-isolated-uat-evidence-intent/v2"
BASE_EVIDENCE_INTENT_CONTRACT = "chenyida-erp-isolated-uat-evidence-intent/v1"
SOURCE_ROOT = "scripts/isolated-uat-caddy-host-sni-contracts.py"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
GIT_OBJECT = re.compile(r"^[0-9a-f]{40}$")
IMAGE = re.compile(r"^[^@\s]+@sha256:[0-9a-f]{64}$")
OCI_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
PROJECT = re.compile(r"^chenyida-erp-uat-[a-z0-9][a-z0-9_-]{0,42}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")

CAPABILITY_STATUS = {
    "host_sni_expectation_builder": "IMPLEMENTED_PURE",
    "host_sni_expectation_validator": "IMPLEMENTED_PURE",
    "evidence_intent_v2_builder": "IMPLEMENTED_PURE",
    "evidence_intent_v2_validator": "IMPLEMENTED_PURE",
    "base_evidence_intent_v1_revalidation": "IMPLEMENTED_PURE_FIXED_V1_SEMANTICS",
    "static_compose_binding": "IMPLEMENTED_SOURCE_HASH_BOUND_RUNTIME_NOT_OBSERVED",
    "legacy_evidence_bridge": "DIGEST_CONTRACT_ONLY_FULL_ACTION_CLOSURE_NOT_IMPLEMENTED",
    "redirect_observer": "NOT_IMPLEMENTED",
    "tls_chain_and_hostname_observer": "NOT_IMPLEMENTED",
    "negative_probe_observer": "NOT_IMPLEMENTED",
    "publisher": "NOT_IMPLEMENTED",
    "runtime_backend": "NOT_IMPLEMENTED",
    "execution_authorized": False,
}

VALIDATION_OUTPUT = {
    "host_sni_contract_status": "PURE_HOST_SNI_INTENT_CONTRACT_VALID",
    "source_observation_status": "SOURCE_BYTES_CALLER_INJECTED_HASH_MATCHED_NOT_ATTESTED",
    "configuration_status": "STATIC_CONFIG_CONTRACT_BOUND_RUNTIME_NOT_OBSERVED",
    "redirect_status": "NOT_ESTABLISHED_CONTAINER_HOST_PORT_TRANSLATION_UNOBSERVED",
    "tls_trust_status": "NOT_ESTABLISHED_BY_PURE_VALIDATION",
    "authorization_status": "AUTHORIZATION_NOT_ESTABLISHED",
    "publication_status": "NOT_PUBLISHED",
    "runtime_evidence_status": "NOT_ESTABLISHED_BY_PURE_VALIDATION",
}

INVARIANTS = {
    "deployment_class": "UAT",
    "connect_host": "127.0.0.1",
    "server_name": "localhost",
    "caddy_internal_https_port": 443,
    "health_path": "/api/health",
    "http_expected_status": 308,
    "https_expected_status": 200,
    "public_origin_scheme": "https",
    "host_sni_relationship": "ERP_DOMAIN_EQUALS_SNI_EQUALS_AUTHORITY_HOST_EQUALS_PUBLIC_ORIGIN_HOST",
    "host_port_relationship": "PUBLIC_ORIGIN_PORT_EQUALS_PUBLISHED_CADDY_HTTPS_PORT",
    "server_name_shape": "HOSTNAME_ONLY_NO_SCHEME_PORT_PATH_WILDCARD_OR_TRAILING_DOT",
    "tls_verification": "TRUSTED_CHAIN_AND_EXACT_DNS_NAME_REQUIRED",
    "insecure_skip_verify": False,
    "leaf_digest_only_sufficient": False,
    "runtime_dns_allowed": False,
    "proxy_environment_allowed": False,
    "redirect_following_allowed": False,
    "forwarded_headers_are_trust_roots": False,
    "web_direct_port_role": "LOOPBACK_OPERATIONS_PROBE_NOT_PUBLIC_ORIGIN",
}

UPSTREAM_BINDINGS = [
    {
        "path": "operations/isolated-uat-runtime-contract-policy-v1.json",
        "raw_sha256": "4b7f6f741ff84c4ae7a4d8ee3d3641e7a9d3dc52b62c2b00d4c9f9c0f98020cc",
        "policy_sha256": "5f24335aa436309427465b6cb1c5c7ecb3778f0945f3d7ed48598008a0456586",
    },
    {
        "path": "operations/isolated-uat-runtime-receipt-policy-v1.json",
        "raw_sha256": "1eee47ed1ed9311529153cc3e7defeb95984e075276af23a453a872c94027aac",
        "policy_sha256": "58c34e4627b379f3b0cdd607673633c339c1e570e8675d2a7108a01f994e9f6e",
    },
]

SOURCE_USAGE = {
    ".env.uat-isolated.example": "STATIC_NON_SECRET_INPUT_EXAMPLE",
    "app/lib/infrastructure/config.ts": "STATIC_ORIGIN_CONFIGURATION_REFERENCE",
    "app/lib/infrastructure/request-origin.ts": "STATIC_ORIGIN_MATCHING_REFERENCE",
    "compose.uat-isolated.yml": "STATIC_ISOLATED_COMPOSE_REFERENCE",
    "compose.yml": "STATIC_BASE_COMPOSE_REFERENCE",
    "deploy/Caddyfile": "STATIC_CADDY_ROUTE_REFERENCE",
    "operations/isolated-uat-runtime-contract-policy-v1.json": "LEGACY_INTENT_CONTRACT_REFERENCE",
    "operations/isolated-uat-runtime-receipt-policy-v1.json": "LEGACY_RECEIPT_CONTRACT_REFERENCE",
    SOURCE_ROOT: "EXECUTING_PURE_HOST_SNI_VALIDATOR",
}

DECLARED_ABSENT_CAPABILITIES = sorted([
    "CERTIFICATE_STORE", "CLOCK", "DNS", "DOCKER", "ENVIRONMENT",
    "FILESYSTEM_RUNTIME_OBSERVATION", "HTTP", "NETWORK", "PROCESS",
    "PUBLISHER", "RANDOM", "SECRET_VALUES", "SHELL", "TLS",
])
EXTERNAL_IMPORTS = ["ast", "hashlib", "json", "re", "typing"]

EXPECTATION_INPUT_FIELDS = {
    "request_id", "project", "resolved_compose_sha256",
    "runtime_contract_policy_sha256", "runtime_receipt_policy_sha256", "ports",
}
EVIDENCE_V2_INPUT_FIELDS = {
    "active_control_plan_sha256", "owner_completion_base_plan_sha256",
    "external_anchor_base_plan_sha256", "active_control_plan",
    "owner_completion_base_plan", "external_anchor_base_plan",
    "host_sni_expectation", "base_evidence_intent",
}
BASE_EVIDENCE_INPUT_FIELDS = {
    "containers", "loopback", "migration_execution_receipt_sha256",
    "one_shot_state_root_identity_sha256", "operation_id", "plan_sha256",
    "project", "release_candidate_receipt_sha256", "release_identity_reader_gid",
    "request_id", "runtime_contract_policy_sha256",
    "runtime_privilege_receipt_sha256", "runtime_source", "source_closure_sha256",
}
BASE_EVIDENCE_OUTPUT_STATUS = {
    "contract_validation_status": "STRUCTURE_VALID",
    "execution_status": "NOT_EXECUTED",
    "publication_status": "NOT_PUBLISHED",
    "runtime_evidence_status": "NOT_AVAILABLE",
    "evidence_scope": "ISOLATED_UAT_CONTRACT_ONLY",
    "predecessor_chain_status": "NOT_VALIDATED",
}
RUNTIME_CONTRACT_SOURCE_CLOSURE_SHA256 = (
    "978741a0bf244cd40076cca49fbedd0a3e3045e047b795c488e40a40436bc939"
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
    "owner_completion_policy_sha256", "owner_completion_source_closure_sha256",
    "owner_completion_capability_status", "owner_completion_validation_status",
    "owner_completion_success_output_contract", "owner_completion_binding",
    "external_anchor_base_plan_sha256",
}
V6_ONLY_PLAN_FIELDS = {
    "host_sni_policy_sha256", "host_sni_source_closure_sha256",
    "host_sni_capability_status", "host_sni_expectation_validation_status",
    "host_sni_evidence_intent_v2_validation_status", "host_sni_success_output_contract",
    "caddy_host_sni_binding", "caddy_host_sni_expectation",
    "owner_completion_base_plan_sha256",
}
OWNER_PLAN_ALL_FIELDS = BASE_PLAN_FIELDS | OWNER_PLAN_FIELDS
ACTIVE_PLAN_FIELDS = OWNER_PLAN_ALL_FIELDS | V6_ONLY_PLAN_FIELDS

ACTIVE_PLAN_IDENTITY = {
    "schema_version": 6,
    "contract": "chenyida-erp-isolated-uat-one-shot-plan/v6",
    "entrypoint_id": "chenyida-erp-isolated-uat-one-shot-v6",
    "action_binding_id": "chenyida-erp-isolated-uat-fixed-actions-v6",
    "action_binding_status": (
        "V5_EXACTLY_INHERITED_CADDY_HOST_SNI_PURE_INTENT_V2_CONTRACT_VALID_"
        "RUNTIME_FACTS_NOT_ESTABLISHED"
    ),
}
OWNER_PLAN_IDENTITY = {
    "schema_version": 5,
    "contract": "chenyida-erp-isolated-uat-one-shot-plan/v5",
    "entrypoint_id": "chenyida-erp-isolated-uat-one-shot-v5",
    "action_binding_id": "chenyida-erp-isolated-uat-fixed-actions-v5",
    "action_binding_sha256": (
        "349fb247d271d3c749129c151ebb0b3c7054b64f5ee0c5646ea9e1d238c49c3f"
    ),
    "action_binding_status": (
        "V4_EXACTLY_INHERITED_OWNER_COMPLETION_PURE_CONTRACT_VALID_"
        "RUNTIME_FACTS_NOT_ESTABLISHED"
    ),
}
EXTERNAL_PLAN_IDENTITY = {
    "schema_version": 4,
    "contract": "chenyida-erp-isolated-uat-one-shot-plan/v4",
    "entrypoint_id": "chenyida-erp-isolated-uat-one-shot-v4",
    "action_binding_id": "chenyida-erp-isolated-uat-fixed-actions-v4",
    "action_binding_sha256": (
        "fb83e0f20823b632525823f3d6c012769501fff1aec9763abc64d8d10d2b050b"
    ),
    "action_binding_status": (
        "V3_ACTIONS_EXACTLY_INHERITED_EXTERNAL_ANCHOR_CONTRACTS_VALID_"
        "RUNTIME_FACTS_NOT_ESTABLISHED"
    ),
}
PLAN_ACTIONS = [
    {
        "ordinal": 1, "action": "VERIFY_EXACT_INPUTS", "mutates_runtime": False,
        "handler_id": "CONTROL_REQUEST_VALIDATOR", "adapter_method": "validate_exact_request",
    },
    {
        "ordinal": 2, "action": "PREPARE_PRIVATE_NAMESPACE_ROOTS", "mutates_runtime": True,
        "handler_id": "ISOLATED_UAT_HOST_ROOT_ADAPTER",
        "adapter_method": "prepare_private_namespace_roots",
    },
    {
        "ordinal": 3, "action": "PROVISION_DISTINCT_CREDENTIAL_FILES",
        "mutates_runtime": True, "handler_id": "ISOLATED_UAT_CREDENTIAL_ADAPTER",
        "adapter_method": "provision_distinct_credential_files",
    },
    {
        "ordinal": 4, "action": "START_POSTGRES_ONLY", "mutates_runtime": True,
        "handler_id": "ISOLATED_UAT_COMPOSE_ADAPTER",
        "adapter_method": "start_postgres_only",
    },
    {
        "ordinal": 5, "action": "INITIALIZE_DATABASE_IDENTITY_AND_LOGIN_ROLES",
        "mutates_runtime": True, "handler_id": "ISOLATED_UAT_DATABASE_BOOTSTRAP_ADAPTER",
        "adapter_method": "initialize_database_identity_and_login_roles",
    },
    {
        "ordinal": 6, "action": "MIGRATE_EMPTY_DATABASE_TO_BOUND_HEAD",
        "mutates_runtime": True, "handler_id": "ISOLATED_UAT_MIGRATION_ADAPTER",
        "adapter_method": "migrate_empty_database_to_bound_head",
    },
    {
        "ordinal": 7, "action": "RECONCILE_FINAL_RUNTIME_PRIVILEGES",
        "mutates_runtime": True, "handler_id": "POSTGRESQL_RUNTIME_PRIVILEGE_PRIMITIVES",
        "adapter_method": "reconcile_final_runtime_privileges",
    },
    {
        "ordinal": 8, "action": "START_BOUND_RUNTIME_SERVICES", "mutates_runtime": True,
        "handler_id": "ISOLATED_UAT_COMPOSE_ADAPTER",
        "adapter_method": "start_bound_runtime_services",
    },
    {
        "ordinal": 9, "action": "VERIFY_AND_PUBLISH_ISOLATED_UAT_EVIDENCE",
        "mutates_runtime": True, "handler_id": "ISOLATED_UAT_POSTDEPLOY_EVIDENCE_ADAPTER",
        "adapter_method": "verify_and_publish_isolated_uat_evidence",
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


def canonical_json(value: Any) -> str:
    try:
        return json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
            allow_nan=False,
        ) + "\n"
    except (TypeError, ValueError, UnicodeError, RecursionError):
        fail("ISOLATED_UAT_CADDY_HOST_SNI_JSON_INVALID")


def canonical_sha256(value: Any) -> str:
    try:
        raw = canonical_json(value).encode("utf-8")
    except (UnicodeError, RecursionError):
        fail("ISOLATED_UAT_CADDY_HOST_SNI_JSON_INVALID")
    return hashlib.sha256(raw).hexdigest()


def _is_sha(value: Any) -> bool:
    return isinstance(value, str) and value != "0" * 64 and SHA256.fullmatch(value) is not None


def _canonical_repo_path(value: Any) -> bool:
    if not isinstance(value, str) or not value or value.startswith("/") or "\\" in value:
        return False
    return all(part not in ("", ".", "..") for part in value.split("/"))


def validate_source_closure(value: Any, sources: dict[str, bytes]) -> dict[str, Any]:
    code = "ISOLATED_UAT_CADDY_HOST_SNI_SOURCE_CLOSURE_INVALID"
    if not isinstance(sources, dict):
        fail(code)
    value = exact(value, {
        "schema_version", "algorithm", "roots", "members", "external_imports",
        "declared_absent_capabilities", "validation_scope", "source_closure_sha256",
    }, code)
    if value["schema_version"] != 1 \
            or value["algorithm"] != "FIXED_RAW_SHA256_RESOURCE_SET_AND_PYTHON_IMPORT_GUARD_V1" \
            or value["roots"] != [SOURCE_ROOT] \
            or value["external_imports"] != EXTERNAL_IMPORTS \
            or value["declared_absent_capabilities"] != DECLARED_ABSENT_CAPABILITIES \
            or value["validation_scope"] \
                != "CALLER_INJECTED_SOURCE_HASH_AND_DIRECT_IMPORT_GUARD_NOT_A_SANDBOX_OR_RUNTIME_ATTESTATION":
        fail(code)
    members = value["members"]
    if not isinstance(members, list) or len(members) != len(SOURCE_USAGE):
        fail(code)
    observed_paths: list[str] = []
    for member in members:
        member = exact(member, {"path", "sha256", "usage"}, code)
        path = member["path"]
        if not _canonical_repo_path(path) or path in observed_paths \
                or member["usage"] != SOURCE_USAGE.get(path) or not _is_sha(member["sha256"]):
            fail(code)
        observed_paths.append(path)
    if observed_paths != sorted(SOURCE_USAGE) or set(sources) != set(SOURCE_USAGE):
        fail(code)
    members_by_path = {item["path"]: item for item in members}
    for path, raw in sources.items():
        if not isinstance(raw, bytes) \
                or hashlib.sha256(raw).hexdigest() != members_by_path[path]["sha256"]:
            fail(code)
    try:
        tree = ast.parse(sources[SOURCE_ROOT].decode("utf-8"), filename=SOURCE_ROOT)
    except (UnicodeDecodeError, SyntaxError):
        fail(code)
    imports: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level or not node.module:
                fail(code)
            imports.add(node.module.split(".")[0])
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                and node.func.id in {"__import__", "compile", "eval", "exec", "open"}:
            fail(code)
    if sorted(imports) != EXTERNAL_IMPORTS:
        fail(code)
    body = {key: item for key, item in value.items() if key != "source_closure_sha256"}
    if not _is_sha(value["source_closure_sha256"]) \
            or canonical_sha256(body) != value["source_closure_sha256"]:
        fail(code)
    return value


def validate_policy(value: Any, sources: dict[str, bytes]) -> dict[str, Any]:
    code = "ISOLATED_UAT_CADDY_HOST_SNI_POLICY_INVALID"
    value = exact(value, {
        "schema_version", "contract", "policy_id", "execution_authorized",
        "capability_status", "validation_output", "invariants", "upstream_bindings",
        "source_closure", "policy_sha256",
    }, code)
    if value["schema_version"] != 1 or value["contract"] != POLICY_CONTRACT \
            or value["policy_id"] != POLICY_ID or value["execution_authorized"] is not False \
            or value["capability_status"] != CAPABILITY_STATUS \
            or value["validation_output"] != VALIDATION_OUTPUT \
            or value["invariants"] != INVARIANTS \
            or value["upstream_bindings"] != UPSTREAM_BINDINGS:
        fail(code)
    closure = validate_source_closure(value["source_closure"], sources)
    closure_members = {item["path"]: item for item in closure["members"]}
    if any(
        closure_members[binding["path"]]["sha256"] != binding["raw_sha256"]
        for binding in UPSTREAM_BINDINGS
    ):
        fail(code)
    body = {key: item for key, item in value.items() if key != "policy_sha256"}
    if not _is_sha(value["policy_sha256"]) or canonical_sha256(body) != value["policy_sha256"]:
        fail(code)
    return value


def _authority(port: int) -> str:
    return f"localhost:{port}"


def _legacy_loopback_ports(ports: dict[str, Any]) -> dict[str, Any]:
    """Project the control request port shape into evidence-intent v1 shape."""
    return {
        "host": ports["host_ip"],
        "web": ports["web"],
        "caddy_http": ports["caddy_http"],
        "caddy_https": ports["caddy_https"],
    }


def _validate_expectation_inputs(value: Any, policy: dict[str, Any]) -> dict[str, Any]:
    code = "ISOLATED_UAT_CADDY_HOST_SNI_EXPECTATION_INVALID"
    value = exact(value, EXPECTATION_INPUT_FIELDS, code)
    if not isinstance(value["request_id"], str) or not IDENTIFIER.fullmatch(value["request_id"]) \
            or not isinstance(value["project"], str) or not PROJECT.fullmatch(value["project"]) \
            or not all(_is_sha(value[field]) for field in (
                "resolved_compose_sha256", "runtime_contract_policy_sha256",
                "runtime_receipt_policy_sha256",
            )) \
            or value["runtime_contract_policy_sha256"] != UPSTREAM_BINDINGS[0]["policy_sha256"] \
            or value["runtime_receipt_policy_sha256"] != UPSTREAM_BINDINGS[1]["policy_sha256"]:
        fail(code)
    ports = exact(value["ports"], {"host_ip", "web", "caddy_http", "caddy_https"}, code)
    numbers = [ports["web"], ports["caddy_http"], ports["caddy_https"]]
    if ports["host_ip"] != INVARIANTS["connect_host"] \
            or any(type(port) is not int or port < 1024 or port > 65535 or port == 3000 for port in numbers) \
            or len(set(numbers)) != len(numbers):
        fail(code)
    if policy["policy_sha256"] == "0" * 64:
        fail(code)
    return value


def build_expectation(
    inputs: Any,
    policy: dict[str, Any],
    policy_sources: dict[str, bytes],
) -> dict[str, Any]:
    policy = validate_policy(policy, policy_sources)
    inputs = _validate_expectation_inputs(inputs, policy)
    ports = inputs["ports"]
    http_authority = _authority(ports["caddy_http"])
    https_authority = _authority(ports["caddy_https"])
    public_origin = f"https://{https_authority}"
    body = {
        "schema_version": 1,
        "contract": EXPECTATION_CONTRACT,
        **json.loads(canonical_json(inputs)),
        "host_sni_policy_sha256": policy["policy_sha256"],
        "host_sni_source_closure_sha256": policy["source_closure"][
            "source_closure_sha256"
        ],
        "caddy_configuration": {
            "ERP_DOMAIN": INVARIANTS["server_name"],
            "ERP_HTTPS_PORT": str(INVARIANTS["caddy_internal_https_port"]),
            "ERP_PUBLIC_ORIGIN": public_origin,
            "ERP_UAT_ALLOW_LOOPBACK_ORIGIN": "true",
            "materialization_status": "STATIC_CONFIG_CONTRACT_BOUND_RUNTIME_NOT_OBSERVED",
        },
        "endpoint_binding": {
            "connect_host": INVARIANTS["connect_host"],
            "server_name": INVARIANTS["server_name"],
            "tls_server_name": INVARIANTS["server_name"],
            "http_authority": http_authority,
            "https_authority": https_authority,
            "public_origin": public_origin,
            "web_direct_port_role": INVARIANTS["web_direct_port_role"],
        },
        "probe_intent": [
            {
                "id": "CADDY_HTTP_HOST_ROUTE",
                "scheme": "http",
                "connect_host": INVARIANTS["connect_host"],
                "connect_port": ports["caddy_http"],
                "authority": http_authority,
                "host_header": http_authority,
                "method": "GET",
                "path": INVARIANTS["health_path"],
                "follow_redirects": False,
                "expected_status": INVARIANTS["http_expected_status"],
                "desired_location": f"{public_origin}{INVARIANTS['health_path']}",
                "redirect_materialization_status": (
                    "NOT_ESTABLISHED_CONTAINER_HOST_PORT_TRANSLATION_UNOBSERVED"
                ),
            },
            {
                "id": "CADDY_HTTPS_HOST_SNI_ROUTE",
                "scheme": "https",
                "connect_host": INVARIANTS["connect_host"],
                "connect_port": ports["caddy_https"],
                "authority": https_authority,
                "host_header": https_authority,
                "tls_server_name": INVARIANTS["server_name"],
                "method": "GET",
                "path": INVARIANTS["health_path"],
                "follow_redirects": False,
                "proxy_environment_allowed": False,
                "runtime_dns_allowed": False,
                "expected_status": INVARIANTS["https_expected_status"],
                "certificate_validation": INVARIANTS["tls_verification"],
                "insecure_skip_verify": False,
                "leaf_digest_only_sufficient": False,
                "trust_source_status": "NOT_ESTABLISHED_BY_PURE_VALIDATION",
            },
        ],
        "required_negative_runtime_observations": [
            "WRONG_SNI_REJECTED",
            "CORRECT_SNI_WRONG_HOST_REJECTED",
            "WRONG_AUTHORITY_PORT_REJECTED",
            "UNTRUSTED_CERTIFICATE_REJECTED",
        ],
        "legacy_evidence_bridge": {
            "base_intent_contract": BASE_EVIDENCE_INTENT_CONTRACT,
            "target_intent_contract": EVIDENCE_INTENT_CONTRACT,
            "base_receipt_contract": "chenyida-erp-isolated-uat-readiness-receipt/v1",
            "base_server_name_status": "NOT_VALIDATED_MISSING_BOUND_SERVER_NAME",
            "bridge_status": "DIGEST_CONTRACT_ONLY_FULL_ACTION_CLOSURE_NOT_IMPLEMENTED",
        },
        "contract_validation_status": "STRUCTURE_VALID",
        "execution_status": "NOT_EXECUTED",
        "source_observation_status": VALIDATION_OUTPUT["source_observation_status"],
        "authorization_status": VALIDATION_OUTPUT["authorization_status"],
        "publication_status": VALIDATION_OUTPUT["publication_status"],
        "runtime_evidence_status": VALIDATION_OUTPUT["runtime_evidence_status"],
        "tls_trust_status": VALIDATION_OUTPUT["tls_trust_status"],
    }
    return {**body, "expectation_sha256": canonical_sha256(body)}


def validate_expectation(
    value: Any,
    policy: dict[str, Any],
    policy_sources: dict[str, bytes],
) -> dict[str, Any]:
    code = "ISOLATED_UAT_CADDY_HOST_SNI_EXPECTATION_INVALID"
    policy = validate_policy(policy, policy_sources)
    expected_fields = EXPECTATION_INPUT_FIELDS | {
        "schema_version", "contract", "caddy_configuration", "endpoint_binding",
        "probe_intent", "required_negative_runtime_observations", "legacy_evidence_bridge",
        "contract_validation_status", "execution_status", "source_observation_status",
        "authorization_status", "publication_status", "runtime_evidence_status",
        "tls_trust_status", "host_sni_policy_sha256",
        "host_sni_source_closure_sha256", "expectation_sha256",
    }
    value = exact(value, expected_fields, code)
    inputs = {field: value[field] for field in EXPECTATION_INPUT_FIELDS}
    if canonical_json(value) != canonical_json(
        build_expectation(inputs, policy, policy_sources)
    ):
        fail(code)
    return value


def _validate_base_evidence_intent(
    value: Any,
    expectation: dict[str, Any],
    external_anchor_base_plan_sha256: str,
) -> dict[str, Any]:
    code = "ISOLATED_UAT_CADDY_HOST_SNI_BASE_EVIDENCE_INTENT_INVALID"
    fields = BASE_EVIDENCE_INPUT_FIELDS | {
        "schema_version", "contract", "identity_semantics",
        "production_release_identity_compatible", "intent_sha256",
        *BASE_EVIDENCE_OUTPUT_STATUS.keys(),
    }
    value = exact(value, fields, code)
    if value["schema_version"] != 1 or value["contract"] != BASE_EVIDENCE_INTENT_CONTRACT \
            or value["identity_semantics"] != "ISOLATED_UAT_ONLY" \
            or value["production_release_identity_compatible"] is not False \
            or any(value[key] != item for key, item in BASE_EVIDENCE_OUTPUT_STATUS.items()) \
            or not isinstance(value["operation_id"], str) \
            or not IDENTIFIER.fullmatch(value["operation_id"]) \
            or value["request_id"] != expectation["request_id"] \
            or value["project"] != expectation["project"] \
            or value["plan_sha256"] != external_anchor_base_plan_sha256 \
            or value["runtime_contract_policy_sha256"] != UPSTREAM_BINDINGS[0]["policy_sha256"] \
            or value["source_closure_sha256"] != RUNTIME_CONTRACT_SOURCE_CLOSURE_SHA256 \
            or value["release_identity_reader_gid"] != 65532 \
            or value["loopback"] != _legacy_loopback_ports(expectation["ports"]):
        fail(code)
    for field in (
        "release_candidate_receipt_sha256", "migration_execution_receipt_sha256",
        "runtime_privilege_receipt_sha256", "one_shot_state_root_identity_sha256",
    ):
        if not _is_sha(value[field]):
            fail(code)
    source = exact(value["runtime_source"], {
        "package_version", "git_commit", "git_tree", "migration_head",
        "migration_allowlist_sha256", "resolved_compose_sha256",
    }, code)
    if source["package_version"] != "0.1.0-alpha.47" \
            or not isinstance(source["git_commit"], str) \
            or not GIT_OBJECT.fullmatch(source["git_commit"]) \
            or source["git_commit"] == "0" * 40 \
            or not isinstance(source["git_tree"], str) \
            or not GIT_OBJECT.fullmatch(source["git_tree"]) \
            or source["git_tree"] == "0" * 40 \
            or source["migration_head"] != "0046_runtime_lock_privilege_boundary.sql" \
            or source["migration_allowlist_sha256"] \
                != "8bb2b2d662df03e397d49c4ed5d11f1af1a9406ecbaff37aee8fc0d2d7388eed" \
            or source["resolved_compose_sha256"] != expectation["resolved_compose_sha256"]:
        fail(code)
    containers = exact(value["containers"], {"postgres", "caddy", "web", "worker"}, code)
    for container in containers.values():
        container = exact(container, {
            "project", "container_id", "image_reference", "image_config_digest",
        }, code)
        if container["project"] != value["project"] \
                or not isinstance(container["container_id"], str) \
                or not IDENTIFIER.fullmatch(container["container_id"]) \
                or not isinstance(container["image_reference"], str) \
                or not IMAGE.fullmatch(container["image_reference"]) \
                or container["image_reference"].endswith(f"@sha256:{'0' * 64}") \
                or not isinstance(container["image_config_digest"], str) \
                or not OCI_DIGEST.fullmatch(container["image_config_digest"]) \
                or container["image_config_digest"] == f"sha256:{'0' * 64}":
            fail(code)
    body = {key: item for key, item in value.items() if key != "intent_sha256"}
    if not _is_sha(value["intent_sha256"]) or canonical_sha256(body) != value["intent_sha256"]:
        fail(code)
    return value


def _validate_plan_object(
    value: Any,
    fields: set[str],
    identity: dict[str, Any],
) -> dict[str, Any]:
    code = "ISOLATED_UAT_CADDY_HOST_SNI_PLAN_CHAIN_INVALID"
    value = exact(value, fields, code)
    if any(value.get(key) != item for key, item in identity.items()) \
            or value["mode"] != "READ_ONLY_PLAN" \
            or value["execution_authorized"] is not False \
            or not _is_sha(value["action_binding_sha256"]) \
            or value["actions"] != PLAN_ACTIONS \
            or value["forbidden_production_entrypoints"] != [
                "scripts/postgresql-runtime-privilege-runner.mjs",
                "scripts/release-supervisor-launcher.py",
            ]:
        fail(code)
    body = {key: item for key, item in value.items() if key != "plan_sha256"}
    if not _is_sha(value["plan_sha256"]) or canonical_sha256(body) != value["plan_sha256"]:
        fail(code)
    return value


def _validate_plan_chain(
    inputs: dict[str, Any],
    expectation: dict[str, Any],
    policy: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    code = "ISOLATED_UAT_CADDY_HOST_SNI_PLAN_CHAIN_INVALID"
    active = _validate_plan_object(
        inputs["active_control_plan"], ACTIVE_PLAN_FIELDS, ACTIVE_PLAN_IDENTITY,
    )
    owner = _validate_plan_object(
        inputs["owner_completion_base_plan"], OWNER_PLAN_ALL_FIELDS, OWNER_PLAN_IDENTITY,
    )
    external = _validate_plan_object(
        inputs["external_anchor_base_plan"], BASE_PLAN_FIELDS, EXTERNAL_PLAN_IDENTITY,
    )
    if inputs["active_control_plan_sha256"] != active["plan_sha256"] \
            or inputs["owner_completion_base_plan_sha256"] != owner["plan_sha256"] \
            or inputs["external_anchor_base_plan_sha256"] != external["plan_sha256"] \
            or len({active["plan_sha256"], owner["plan_sha256"], external["plan_sha256"]}) != 3:
        fail(code)

    active_body = {
        key: item for key, item in active.items() if key != "plan_sha256"
    }
    owner_body = {
        key: item for key, item in active_body.items() if key not in V6_ONLY_PLAN_FIELDS
    }
    owner_body.update(OWNER_PLAN_IDENTITY)
    projected_owner = {
        **owner_body,
        "plan_sha256": canonical_sha256(owner_body),
    }
    if canonical_json(projected_owner) != canonical_json(owner):
        fail(code)

    external_body = {
        key: item for key, item in owner_body.items() if key not in OWNER_PLAN_FIELDS
    }
    external_body.update(EXTERNAL_PLAN_IDENTITY)
    projected_external = {
        **external_body,
        "plan_sha256": canonical_sha256(external_body),
    }
    if canonical_json(projected_external) != canonical_json(external) \
            or active["owner_completion_base_plan_sha256"] != owner["plan_sha256"] \
            or active["external_anchor_base_plan_sha256"] != external["plan_sha256"] \
            or owner["external_anchor_base_plan_sha256"] != external["plan_sha256"]:
        fail(code)

    source = exact(active["source"], {
        "package_version", "git_commit", "git_tree", "migration_current_head",
        "migration_target_head", "migration_allowlist_sha256",
        "resolved_compose_sha256",
    }, code)
    expected_binding = {
        "policy_contract": POLICY_CONTRACT,
        "expectation_contract": EXPECTATION_CONTRACT,
        "evidence_intent_v2_contract": EVIDENCE_INTENT_CONTRACT,
        "expectation_action_ordinal": 8,
        "evidence_action_ordinal": 9,
        "legacy_receipt_chain_status": "NOT_VALIDATED_MISSING_BOUND_SERVER_NAME",
        "runtime_fact_status": "NOT_ESTABLISHED_BY_PURE_VALIDATION",
    }
    if active["request_id"] != expectation["request_id"] \
            or active["project"] != expectation["project"] \
            or active["ports"] != expectation["ports"] \
            or source["resolved_compose_sha256"] != expectation["resolved_compose_sha256"] \
            or active["runtime_contract_policy_sha256"] \
                != expectation["runtime_contract_policy_sha256"] \
            or active["runtime_receipt_policy_sha256"] \
                != expectation["runtime_receipt_policy_sha256"] \
            or active["host_sni_policy_sha256"] != policy["policy_sha256"] \
            or active["host_sni_source_closure_sha256"] \
                != policy["source_closure"]["source_closure_sha256"] \
            or active["host_sni_capability_status"] != policy["capability_status"] \
            or active["host_sni_success_output_contract"] != policy["validation_output"] \
            or active["host_sni_expectation_validation_status"] != "STRUCTURE_VALID" \
            or active["host_sni_evidence_intent_v2_validation_status"] \
                != "NOT_RUN_NO_BASE_EVIDENCE_INTENT" \
            or active["caddy_host_sni_binding"] != expected_binding \
            or canonical_json(active["caddy_host_sni_expectation"]) \
                != canonical_json(expectation):
        fail(code)
    return active, owner, external


def _validate_plan_base_continuity(
    active: dict[str, Any],
    base: dict[str, Any],
) -> None:
    code = "ISOLATED_UAT_CADDY_HOST_SNI_PLAN_CHAIN_INVALID"
    source = active["source"]
    runtime_source = base["runtime_source"]
    if source["package_version"] != runtime_source["package_version"] \
            or source["git_commit"] != runtime_source["git_commit"] \
            or source["git_tree"] != runtime_source["git_tree"] \
            or source["migration_target_head"] != runtime_source["migration_head"] \
            or source["migration_allowlist_sha256"] \
                != runtime_source["migration_allowlist_sha256"] \
            or source["resolved_compose_sha256"] \
                != runtime_source["resolved_compose_sha256"]:
        fail(code)
    images = exact(active["images"], {"web", "worker"}, code)
    for role in ("web", "worker"):
        image = exact(images[role], {"image_reference", "config_digest"}, code)
        container = base["containers"][role]
        if image["image_reference"] != container["image_reference"] \
                or image["config_digest"] != container["image_config_digest"]:
            fail(code)


def build_evidence_intent_v2(
    inputs: Any,
    policy: dict[str, Any],
    policy_sources: dict[str, bytes],
) -> dict[str, Any]:
    code = "ISOLATED_UAT_CADDY_HOST_SNI_EVIDENCE_INTENT_INVALID"
    policy = validate_policy(policy, policy_sources)
    inputs = exact(inputs, EVIDENCE_V2_INPUT_FIELDS, code)
    for field in (
        "active_control_plan_sha256", "owner_completion_base_plan_sha256",
        "external_anchor_base_plan_sha256",
    ):
        if not _is_sha(inputs[field]):
            fail(code)
    if len({
        inputs["active_control_plan_sha256"],
        inputs["owner_completion_base_plan_sha256"],
        inputs["external_anchor_base_plan_sha256"],
    }) != 3:
        fail(code)
    expectation = validate_expectation(
        inputs["host_sni_expectation"], policy, policy_sources,
    )
    active_plan, owner_plan, external_plan = _validate_plan_chain(
        inputs, expectation, policy,
    )
    base = _validate_base_evidence_intent(
        inputs["base_evidence_intent"],
        expectation,
        external_plan["plan_sha256"],
    )
    _validate_plan_base_continuity(active_plan, base)
    body = {
        "schema_version": 2,
        "contract": EVIDENCE_INTENT_CONTRACT,
        "active_control_plan_sha256": inputs["active_control_plan_sha256"],
        "owner_completion_base_plan_sha256": inputs[
            "owner_completion_base_plan_sha256"
        ],
        "external_anchor_base_plan_sha256": inputs[
            "external_anchor_base_plan_sha256"
        ],
        "active_control_plan": json.loads(canonical_json(active_plan)),
        "owner_completion_base_plan": json.loads(canonical_json(owner_plan)),
        "external_anchor_base_plan": json.loads(canonical_json(external_plan)),
        "base_evidence_intent": json.loads(canonical_json(base)),
        "base_evidence_intent_sha256": base["intent_sha256"],
        "host_sni_expectation": json.loads(canonical_json(expectation)),
        "host_sni_expectation_sha256": expectation["expectation_sha256"],
        "host_sni_policy_sha256": policy["policy_sha256"],
        "host_sni_source_closure_sha256": policy["source_closure"][
            "source_closure_sha256"
        ],
        "contract_validation_status": "STRUCTURE_VALID",
        "plan_chain_validation_status": (
            "ROLE_IDENTITY_AND_DIGEST_PROJECTION_VALID_"
            "FULL_ACTIVE_PLAN_SEMANTICS_NOT_REVALIDATED"
        ),
        "host_route_observation_status": "NOT_OBSERVED",
        "certificate_hostname_validation_status": "NOT_EVALUATED",
        "execution_status": "NOT_EXECUTED",
        "source_observation_status": VALIDATION_OUTPUT["source_observation_status"],
        "authorization_status": VALIDATION_OUTPUT["authorization_status"],
        "publication_status": VALIDATION_OUTPUT["publication_status"],
        "runtime_evidence_status": VALIDATION_OUTPUT["runtime_evidence_status"],
    }
    return {**body, "intent_sha256": canonical_sha256(body)}


def validate_evidence_intent_v2(
    value: Any,
    policy: dict[str, Any],
    policy_sources: dict[str, bytes],
) -> dict[str, Any]:
    code = "ISOLATED_UAT_CADDY_HOST_SNI_EVIDENCE_INTENT_INVALID"
    policy = validate_policy(policy, policy_sources)
    fields = {
        "schema_version", "contract", "active_control_plan_sha256",
        "owner_completion_base_plan_sha256", "external_anchor_base_plan_sha256",
        "active_control_plan", "owner_completion_base_plan", "external_anchor_base_plan",
        "base_evidence_intent", "base_evidence_intent_sha256",
        "host_sni_expectation", "host_sni_expectation_sha256",
        "host_sni_policy_sha256", "host_sni_source_closure_sha256",
        "contract_validation_status", "plan_chain_validation_status",
        "host_route_observation_status",
        "certificate_hostname_validation_status", "execution_status",
        "source_observation_status", "authorization_status", "publication_status",
        "runtime_evidence_status", "intent_sha256",
    }
    value = exact(value, fields, code)
    inputs = {
        "active_control_plan_sha256": value["active_control_plan_sha256"],
        "owner_completion_base_plan_sha256": value[
            "owner_completion_base_plan_sha256"
        ],
        "external_anchor_base_plan_sha256": value[
            "external_anchor_base_plan_sha256"
        ],
        "active_control_plan": value["active_control_plan"],
        "owner_completion_base_plan": value["owner_completion_base_plan"],
        "external_anchor_base_plan": value["external_anchor_base_plan"],
        "host_sni_expectation": value["host_sni_expectation"],
        "base_evidence_intent": value["base_evidence_intent"],
    }
    if canonical_json(value) != canonical_json(
        build_evidence_intent_v2(inputs, policy, policy_sources)
    ):
        fail(code)
    return value


def require_runtime_observer() -> None:
    fail("ISOLATED_UAT_CADDY_HOST_SNI_RUNTIME_OBSERVER_NOT_IMPLEMENTED")


def require_publisher() -> None:
    fail("ISOLATED_UAT_CADDY_HOST_SNI_PUBLISHER_NOT_IMPLEMENTED")


def require_runtime_backend() -> None:
    fail("ISOLATED_UAT_CADDY_HOST_SNI_RUNTIME_BACKEND_NOT_IMPLEMENTED")
