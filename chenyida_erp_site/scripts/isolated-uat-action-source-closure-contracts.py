#!/usr/bin/python3
"""Validate the frozen-v6 isolated-UAT action source graph without side effects.

The module consumes caller-injected JSON and source bytes only.  It does not
read a repository, import a bound module, inspect an image, or execute an UAT
action.  Passing validation proves a bounded declared-source closure for the
frozen v6 nine-action catalog; it is not filesystem attestation or a trusted
pre-import runtime gate.
"""

from __future__ import annotations

import ast
import hashlib
import json
import math
import posixpath
import re
from typing import Any


POLICY_CONTRACT = "chenyida-erp-isolated-uat-action-source-closure-policy/v1"
POLICY_ID = "chenyida-erp-isolated-uat-frozen-v6-action-source-closure-v1"
EXPECTED_POLICY_SHA256 = "a85d6abbad072ce5981690f0e266b3b657beb3a707f7ca04db96d97d0bb52d11"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
MAX_JSON_BYTES = 2 * 1024 * 1024
MAX_SOURCE_BYTES = 4 * 1024 * 1024
MAX_TOTAL_SOURCE_BYTES = 32 * 1024 * 1024
MAX_JSON_DEPTH = 32
MAX_JSON_NODES = 50_000

BINDING_ANCHORS = [
    {
        "schema_version": 3,
        "path": "operations/isolated-uat-one-shot-action-bindings-v3.json",
        "contract": "chenyida-erp-isolated-uat-one-shot-action-bindings/v3",
        "binding_id": "chenyida-erp-isolated-uat-fixed-actions-v3",
        "binding_sha256": "50ddd73fb4745c8fcc0b91fd7e4130e2cb3a9ef0d2f52773c64cd6112afc74bd",
        "raw_sha256": "da69ce3a276ef68f9f6cece12f281ea89584930d481afef19fcf930dae8de5c4",
    },
    {
        "schema_version": 4,
        "path": "operations/isolated-uat-one-shot-action-bindings-v4.json",
        "contract": "chenyida-erp-isolated-uat-one-shot-action-bindings/v4",
        "binding_id": "chenyida-erp-isolated-uat-fixed-actions-v4",
        "binding_sha256": "fb83e0f20823b632525823f3d6c012769501fff1aec9763abc64d8d10d2b050b",
        "raw_sha256": "4858b8c14846a69ed969f5476828631362830675399e788f705c35e1cfe34262",
    },
    {
        "schema_version": 5,
        "path": "operations/isolated-uat-one-shot-action-bindings-v5.json",
        "contract": "chenyida-erp-isolated-uat-one-shot-action-bindings/v5",
        "binding_id": "chenyida-erp-isolated-uat-fixed-actions-v5",
        "binding_sha256": "349fb247d271d3c749129c151ebb0b3c7054b64f5ee0c5646ea9e1d238c49c3f",
        "raw_sha256": "95bbf9a263818886072a29f486a53acb752687dcd4d5cd086283336dcbb77363",
    },
    {
        "schema_version": 6,
        "path": "operations/isolated-uat-one-shot-action-bindings-v6.json",
        "contract": "chenyida-erp-isolated-uat-one-shot-action-bindings/v6",
        "binding_id": "chenyida-erp-isolated-uat-fixed-actions-v6",
        "binding_sha256": "f1a3fd38d0a49eea284caa704016d92de336e2eafb4d46a4fd23c59113266dc5",
        "raw_sha256": "459bb65d42c71551797bf4cbf56a022700780caeb8a3d987b51bd96560d9f1f0",
    },
]

ACTION_NAMES = [
    "VERIFY_EXACT_INPUTS",
    "PREPARE_PRIVATE_NAMESPACE_ROOTS",
    "PROVISION_DISTINCT_CREDENTIAL_FILES",
    "START_POSTGRES_ONLY",
    "INITIALIZE_DATABASE_IDENTITY_AND_LOGIN_ROLES",
    "MIGRATE_EMPTY_DATABASE_TO_BOUND_HEAD",
    "RECONCILE_FINAL_RUNTIME_PRIVILEGES",
    "START_BOUND_RUNTIME_SERVICES",
    "VERIFY_AND_PUBLISH_ISOLATED_UAT_EVIDENCE",
]

CONTROL_SOURCE_BINDING_PATHS = [
    ".env.uat-isolated.example",
    "app/lib/infrastructure/config.ts",
    "app/lib/infrastructure/request-origin.ts",
    "compose.release.yml",
    "compose.uat-isolated.yml",
    "compose.yml",
    "deploy/Caddyfile",
    "operations/isolated-uat-caddy-host-sni-policy-v1.json",
    "operations/isolated-uat-external-anchor-policy-v1.json",
    "operations/isolated-uat-one-shot-action-bindings-v3.json",
    "operations/isolated-uat-one-shot-action-bindings-v4.json",
    "operations/isolated-uat-one-shot-action-bindings-v5.json",
    "operations/isolated-uat-one-shot-action-bindings-v6.json",
    "operations/isolated-uat-owner-completion-policy-v1.json",
    "operations/isolated-uat-runtime-contract-policy-v1.json",
    "operations/isolated-uat-runtime-receipt-policy-v1.json",
    "operations/postgresql-runtime-privilege-policy-v2.json",
    "operations/runtime-secret-file-policy-v1.json",
    "scripts/isolated-uat-caddy-host-sni-contracts.py",
    "scripts/isolated-uat-compose-policy.py",
    "scripts/isolated-uat-control-plane-policy.py",
    "scripts/isolated-uat-external-anchor-contracts.py",
    "scripts/isolated-uat-owner-completion-contracts.py",
    "scripts/isolated-uat-one-shot.py",
    "scripts/isolated-uat-runtime-contracts.py",
    "scripts/isolated-uat-runtime-receipts.py",
    "scripts/postgresql-runtime-privilege-journal.mjs",
    "scripts/postgresql-runtime-privilege-operator.mjs",
    "scripts/postgresql-runtime-privilege-reconciler.mjs",
]

MIGRATION_FILENAMES = [
    "0001_selfhost_baseline.sql",
    "0002_material_master_workflow.sql",
    "0003_material_import_mapping.sql",
    "0004_material_import_normalization.sql",
    "0005_material_import_review.sql",
    "0006_identity_security.sql",
    "0007_master_data_bom.sql",
    "0008_inventory_ledger.sql",
    "0009_procurement.sql",
    "0010_production.sql",
    "0011_sales.sql",
    "0012_quality.sql",
    "0013_finance.sql",
    "0014_migration_openings.sql",
    "0015_market_project_handoff.sql",
    "0016_project_planning_handoff.sql",
    "0017_planning_material_requirements.sql",
    "0018_procurement_sourcing.sql",
    "0019_sourcing_purchase_fulfillment.sql",
    "0020_production_handoff_reservations.sql",
    "0021_production_reporting_completions.sql",
    "0022_production_quality_release.sql",
    "0023_sales_delivery_receivable.sql",
    "0024_finance_project_settlements.sql",
    "0025_production_routings.sql",
    "0026_production_operation_execution.sql",
    "0027_production_final_output_reporting.sql",
    "0028_production_operation_quality_gates.sql",
    "0029_production_nonconformance_rework_handoff.sql",
    "0030_production_rework_execution.sql",
    "0031_production_batch_genealogy.sql",
    "0032_finished_goods_inventory_lots.sql",
    "0033_finished_goods_lot_fqc_shipment.sql",
    "0034_supplier_receipt_lot_iqc.sql",
    "0035_bom_material_governance.sql",
    "0036_project_requirement_unit_resolution.sql",
    "0037_project_planning_revision_response_lineage.sql",
    "0038_supplier_mapping_governance.sql",
    "0039_rfq_traceability.sql",
    "0040_warehouse_receipt_readiness.sql",
    "0041_ai_governance_suggestion_evidence.sql",
    "0042_material_import_fallback_safety.sql",
    "0043_material_import_terminal_integrity.sql",
    "0044_identity_session_absolute_lifetime.sql",
    "0045_runtime_worker_readiness.sql",
    "0046_runtime_lock_privilege_boundary.sql",
]
MIGRATION_PATHS = [f"drizzle-postgres/{name}" for name in MIGRATION_FILENAMES]
CONTROL_SOURCE_STATE_PATHS = [
    "package.json",
    "drizzle-postgres/meta/_journal.json",
    *MIGRATION_PATHS,
]

TYPESCRIPT_MEMBERS = [
    "app/lib/infrastructure/config.ts",
    "app/lib/infrastructure/request-origin.ts",
    "app/lib/infrastructure/runtime-secret.ts",
]
TYPESCRIPT_LOCAL_IMPORTS = [
    {
        "source": "app/lib/infrastructure/config.ts",
        "target": "app/lib/infrastructure/request-origin.ts",
    },
    {
        "source": "app/lib/infrastructure/config.ts",
        "target": "app/lib/infrastructure/runtime-secret.ts",
    },
]
TYPESCRIPT_EXTERNAL_IMPORTS = [
    {"source": "app/lib/infrastructure/config.ts", "imports": ["node:path"]},
    {"source": "app/lib/infrastructure/request-origin.ts", "imports": []},
    {
        "source": "app/lib/infrastructure/runtime-secret.ts",
        "imports": ["node:fs", "node:path", "node:util"],
    },
]

ESM_MEMBERS = [
    "scripts/backup-recovery-contract.mjs",
    "scripts/postgresql-cluster-recovery-contract.mjs",
    "scripts/postgresql-runtime-privilege-catalog.mjs",
    "scripts/postgresql-runtime-privilege-journal.mjs",
    "scripts/postgresql-runtime-privilege-operator.mjs",
    "scripts/postgresql-runtime-privilege-policy.mjs",
    "scripts/postgresql-runtime-privilege-reconciler.mjs",
    "scripts/postgresql-runtime-privilege-source.mjs",
]
ESM_LOCAL_IMPORTS = [
    {"source": "scripts/postgresql-cluster-recovery-contract.mjs", "target": "scripts/backup-recovery-contract.mjs"},
    {"source": "scripts/postgresql-runtime-privilege-catalog.mjs", "target": "scripts/backup-recovery-contract.mjs"},
    {"source": "scripts/postgresql-runtime-privilege-catalog.mjs", "target": "scripts/postgresql-cluster-recovery-contract.mjs"},
    {"source": "scripts/postgresql-runtime-privilege-catalog.mjs", "target": "scripts/postgresql-runtime-privilege-source.mjs"},
    {"source": "scripts/postgresql-runtime-privilege-journal.mjs", "target": "scripts/backup-recovery-contract.mjs"},
    {"source": "scripts/postgresql-runtime-privilege-journal.mjs", "target": "scripts/postgresql-cluster-recovery-contract.mjs"},
    {"source": "scripts/postgresql-runtime-privilege-journal.mjs", "target": "scripts/postgresql-runtime-privilege-operator.mjs"},
    {"source": "scripts/postgresql-runtime-privilege-journal.mjs", "target": "scripts/postgresql-runtime-privilege-reconciler.mjs"},
    {"source": "scripts/postgresql-runtime-privilege-operator.mjs", "target": "scripts/backup-recovery-contract.mjs"},
    {"source": "scripts/postgresql-runtime-privilege-operator.mjs", "target": "scripts/postgresql-cluster-recovery-contract.mjs"},
    {"source": "scripts/postgresql-runtime-privilege-operator.mjs", "target": "scripts/postgresql-runtime-privilege-catalog.mjs"},
    {"source": "scripts/postgresql-runtime-privilege-operator.mjs", "target": "scripts/postgresql-runtime-privilege-policy.mjs"},
    {"source": "scripts/postgresql-runtime-privilege-operator.mjs", "target": "scripts/postgresql-runtime-privilege-reconciler.mjs"},
    {"source": "scripts/postgresql-runtime-privilege-operator.mjs", "target": "scripts/postgresql-runtime-privilege-source.mjs"},
    {"source": "scripts/postgresql-runtime-privilege-policy.mjs", "target": "scripts/backup-recovery-contract.mjs"},
    {"source": "scripts/postgresql-runtime-privilege-policy.mjs", "target": "scripts/postgresql-cluster-recovery-contract.mjs"},
    {"source": "scripts/postgresql-runtime-privilege-policy.mjs", "target": "scripts/postgresql-runtime-privilege-catalog.mjs"},
    {"source": "scripts/postgresql-runtime-privilege-policy.mjs", "target": "scripts/postgresql-runtime-privilege-source.mjs"},
    {"source": "scripts/postgresql-runtime-privilege-reconciler.mjs", "target": "scripts/backup-recovery-contract.mjs"},
    {"source": "scripts/postgresql-runtime-privilege-reconciler.mjs", "target": "scripts/postgresql-cluster-recovery-contract.mjs"},
    {"source": "scripts/postgresql-runtime-privilege-reconciler.mjs", "target": "scripts/postgresql-runtime-privilege-catalog.mjs"},
    {"source": "scripts/postgresql-runtime-privilege-reconciler.mjs", "target": "scripts/postgresql-runtime-privilege-policy.mjs"},
    {"source": "scripts/postgresql-runtime-privilege-reconciler.mjs", "target": "scripts/postgresql-runtime-privilege-source.mjs"},
]
ESM_EXTERNAL_IMPORTS = [
    {"source": "scripts/backup-recovery-contract.mjs", "imports": ["node:child_process", "node:crypto", "node:fs", "node:fs/promises", "node:path", "node:url"]},
    {"source": "scripts/postgresql-cluster-recovery-contract.mjs", "imports": ["node:crypto", "node:fs", "node:fs/promises", "node:os", "node:path"]},
    {"source": "scripts/postgresql-runtime-privilege-catalog.mjs", "imports": ["node:crypto", "node:fs", "node:fs/promises", "node:path", "node:url"]},
    {"source": "scripts/postgresql-runtime-privilege-journal.mjs", "imports": ["node:crypto", "node:fs", "node:fs/promises", "node:path"]},
    {"source": "scripts/postgresql-runtime-privilege-operator.mjs", "imports": ["node:crypto", "node:fs", "node:fs/promises", "node:os", "node:path", "node:url"]},
    {"source": "scripts/postgresql-runtime-privilege-policy.mjs", "imports": ["node:crypto", "node:fs", "node:fs/promises", "node:path", "node:url"]},
    {"source": "scripts/postgresql-runtime-privilege-reconciler.mjs", "imports": ["node:crypto", "node:fs", "node:fs/promises", "node:path", "node:url"]},
    {"source": "scripts/postgresql-runtime-privilege-source.mjs", "imports": ["node:crypto", "node:fs/promises", "node:path", "node:url"]},
]

PYTHON_MEMBERS = [
    "scripts/isolated-uat-caddy-host-sni-contracts.py",
    "scripts/isolated-uat-compose-policy.py",
    "scripts/isolated-uat-control-plane-policy.py",
    "scripts/isolated-uat-external-anchor-contracts.py",
    "scripts/isolated-uat-one-shot.py",
    "scripts/isolated-uat-owner-completion-contracts.py",
    "scripts/isolated-uat-runtime-contracts.py",
    "scripts/isolated-uat-runtime-receipts.py",
]
PYTHON_EXTERNAL_IMPORTS = [
    {"source": "scripts/isolated-uat-caddy-host-sni-contracts.py", "imports": ["ast", "hashlib", "json", "re", "typing"]},
    {"source": "scripts/isolated-uat-compose-policy.py", "imports": ["argparse", "json", "pathlib", "re", "sys", "typing"]},
    {"source": "scripts/isolated-uat-control-plane-policy.py", "imports": ["argparse", "hashlib", "json", "pathlib", "re", "sys", "typing"]},
    {"source": "scripts/isolated-uat-external-anchor-contracts.py", "imports": ["datetime", "hashlib", "json", "pathlib", "re", "typing", "unicodedata"]},
    {"source": "scripts/isolated-uat-one-shot.py", "imports": ["argparse", "hashlib", "importlib", "json", "pathlib", "sys", "typing"]},
    {"source": "scripts/isolated-uat-owner-completion-contracts.py", "imports": ["copy", "datetime", "hashlib", "importlib", "json", "pathlib", "re", "typing", "unicodedata"]},
    {"source": "scripts/isolated-uat-runtime-contracts.py", "imports": ["ast", "hashlib", "json", "re", "typing"]},
    {"source": "scripts/isolated-uat-runtime-receipts.py", "imports": ["ast", "datetime", "hashlib", "json", "re", "typing", "unicodedata"]},
]
PYTHON_FIXED_MODULE_LOADS = [
    {"source": "scripts/isolated-uat-one-shot.py", "target": "scripts/isolated-uat-caddy-host-sni-contracts.py"},
    {"source": "scripts/isolated-uat-one-shot.py", "target": "scripts/isolated-uat-control-plane-policy.py"},
    {"source": "scripts/isolated-uat-one-shot.py", "target": "scripts/isolated-uat-external-anchor-contracts.py"},
    {"source": "scripts/isolated-uat-one-shot.py", "target": "scripts/isolated-uat-owner-completion-contracts.py"},
    {"source": "scripts/isolated-uat-one-shot.py", "target": "scripts/isolated-uat-runtime-contracts.py"},
    {"source": "scripts/isolated-uat-one-shot.py", "target": "scripts/isolated-uat-runtime-receipts.py"},
    {"source": "scripts/isolated-uat-owner-completion-contracts.py", "target": "scripts/isolated-uat-external-anchor-contracts.py"},
    {"source": "scripts/isolated-uat-owner-completion-contracts.py", "target": "scripts/isolated-uat-runtime-receipts.py"},
]

TRANSITIVE_ESM_PATHS = sorted(set(ESM_MEMBERS) - {
    "scripts/postgresql-runtime-privilege-journal.mjs",
    "scripts/postgresql-runtime-privilege-operator.mjs",
    "scripts/postgresql-runtime-privilege-reconciler.mjs",
})
SUPPORT_PATHS = sorted(set(CONTROL_SOURCE_BINDING_PATHS) - set(PYTHON_MEMBERS) - set(ESM_MEMBERS))
MEMBER_PATHS = sorted(set(CONTROL_SOURCE_BINDING_PATHS) | {
    "app/lib/infrastructure/runtime-secret.ts",
    *TRANSITIVE_ESM_PATHS,
    *CONTROL_SOURCE_STATE_PATHS,
})

CAPABILITY_STATUS = {
    "frozen_v6_action_catalog_reconstruction": "IMPLEMENTED_PURE_FIXED_RAW_ANCHORS",
    "member_hash_validation": "IMPLEMENTED_PURE_CALLER_INJECTED_BYTES",
    "python_fixed_module_load_validation": "IMPLEMENTED_PURE_BOUNDED",
    "typescript_local_import_validation": "IMPLEMENTED_PURE_BOUNDED",
    "esm_static_import_validation": "IMPLEMENTED_PURE_BOUNDED",
    "migration_dataset_validation": "IMPLEMENTED_PURE_FIXED_46_MEMBER_SET",
    "filesystem_attestation": "NOT_IMPLEMENTED",
    "trusted_pre_import_bootstrap": "NOT_IMPLEMENTED",
    "image_content_validation": "NOT_IMPLEMENTED_SEPARATE_EXACT_IMAGE_BLOCKER",
    "publisher": "NOT_IMPLEMENTED",
    "runtime_backend": "NOT_IMPLEMENTED",
    "execution_authorized": False,
}

VALIDATION_OUTPUT = {
    "action_source_closure_status": "FULL_DECLARED_NINE_ACTION_TRANSITIVE_SOURCE_CLOSURE_FOR_FROZEN_V6_VALID",
    "source_observation_status": "SOURCE_BYTES_CALLER_INJECTED_HASH_MATCHED_NOT_ATTESTED",
    "graph_scope_status": "FIXED_CODE_IMPORTS_CONTROL_READS_AND_MIGRATION_DATASET_ONLY",
    "authorization_status": "AUTHORIZATION_NOT_ESTABLISHED",
    "publication_status": "NOT_PUBLISHED",
    "runtime_enforcement_status": "NOT_IMPLEMENTED",
    "runtime_evidence_status": "NOT_ESTABLISHED_BY_PURE_VALIDATION",
}

BOUNDARY = {
    "subject": "FROZEN_V6_NINE_ACTION_DECLARED_SOURCE_GRAPH",
    "action_count": 9,
    "action_source_reference_count": 54,
    "direct_source_count": 21,
    "member_count": 83,
    "migration_count": 46,
    "closure_descriptor_is_member": False,
    "validator_is_member": False,
    "control_policy_descriptor_is_member": False,
    "pre_import_enforcement": "NOT_IMPLEMENTED_EXISTING_ONE_SHOT_IMPORTS_PRECEDE_DERIVED_PROOF",
    "json_provenance_traversal": "NON_TRAVERSAL_REFERENCE_ONLY_PENDING_FIXED_RUNTIME_ADAPTER",
    "resolved_compose_and_image_digests": "SEPARATELY_BOUND_INPUTS_CONTENT_NOT_OBSERVED",
    "staffing": "APPLICATION_CONFIGURATION_NOT_INFRASTRUCTURE_CARDINALITY",
}

EXTERNAL_BOUNDARY = {
    "python_runtime": "EXCLUDED_NOT_PINNED_OR_ATTESTED",
    "node_runtime": "EXCLUDED_NOT_PINNED_OR_ATTESTED",
    "compose_and_docker_implementation": "EXCLUDED_NOT_PINNED_OR_ATTESTED",
    "oci_image_contents": "EXCLUDED_SEPARATE_EXACT_IMAGE_BLOCKER",
    "runtime_filesystem_reads": "EXCLUDED_UNTIL_FIXED_ADAPTER_CALL_GRAPH",
    "postgresql_policy_json_provenance": "NON_TRAVERSAL_REFERENCE_ONLY",
    "production_runner": "FORBIDDEN_AS_ISOLATED_UAT_ACTION_ENTRYPOINT",
    "production_supervisor": "FORBIDDEN_AS_ISOLATED_UAT_ACTION_ENTRYPOINT",
}


class ContractError(Exception):
    pass


def fail(code: str) -> None:
    raise ContractError(code)


def strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_JSON_DUPLICATE_KEY")
        result[key] = value
    return result


def _bounded_json(value: Any, depth: int = 0, state: list[int] | None = None) -> None:
    if state is None:
        state = [0]
    state[0] += 1
    if state[0] > MAX_JSON_NODES or depth > MAX_JSON_DEPTH:
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_JSON_BOUNDS_INVALID")
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_JSON_INVALID")
            _bounded_json(item, depth + 1, state)
    elif isinstance(value, list):
        for item in value:
            _bounded_json(item, depth + 1, state)
    elif isinstance(value, float) and not math.isfinite(value):
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_JSON_INVALID")
    elif isinstance(value, str):
        try:
            value.encode("utf-8")
        except UnicodeEncodeError:
            fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_JSON_INVALID")


def parse_json(raw: bytes, code: str = "ISOLATED_UAT_ACTION_SOURCE_CLOSURE_JSON_INVALID") -> dict[str, Any]:
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_JSON_BYTES:
        fail(code)
    try:
        value = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=strict_object,
            parse_constant=lambda _: fail(code),
        )
    except ContractError:
        raise
    except (UnicodeDecodeError, UnicodeEncodeError, json.JSONDecodeError, ValueError, RecursionError):
        fail(code)
    if not isinstance(value, dict):
        fail(code)
    _bounded_json(value)
    return value


def exact(value: Any, keys: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        fail(code)
    return value


def canonical_json(value: Any) -> str:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ) + "\n"
    except (TypeError, ValueError, UnicodeError, RecursionError):
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_JSON_INVALID")


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _is_sha(value: Any) -> bool:
    return isinstance(value, str) and value != "0" * 64 and SHA256.fullmatch(value) is not None


def _canonical_repo_path(value: Any) -> bool:
    if not isinstance(value, str) or not value or len(value.encode("utf-8", "ignore")) > 240:
        return False
    if not value.isascii() or value.startswith("/") or "\\" in value:
        return False
    if not re.fullmatch(r"[A-Za-z0-9._/-]+", value):
        return False
    return all(part not in ("", ".", "..") for part in value.split("/"))


def _member_usage(path: str, roots: set[str]) -> str:
    if path in roots:
        if path in ESM_MEMBERS:
            return "DIRECT_ACTION_REFERENCE_PRIMITIVE_NOT_EXECUTABLE"
        if path.endswith(".py"):
            return "DIRECT_ACTION_PYTHON_SOURCE"
        if path.endswith(".json"):
            return "DIRECT_ACTION_POLICY_RESOURCE"
        return "DIRECT_ACTION_COMPOSE_RESOURCE"
    if path in {item["path"] for item in BINDING_ANCHORS}:
        return "FROZEN_ACTION_CATALOG_RESOURCE"
    if path == "app/lib/infrastructure/runtime-secret.ts":
        return "TRANSITIVE_TYPESCRIPT_IMPORT"
    if path in TRANSITIVE_ESM_PATHS:
        return "TRANSITIVE_REFERENCE_PRIMITIVE_DEPENDENCY_NOT_EXECUTABLE"
    if path in MIGRATION_PATHS:
        return "SEALED_MIGRATION_DATASET_MEMBER"
    if path == "drizzle-postgres/meta/_journal.json":
        return "MIGRATION_JOURNAL_RESOURCE"
    if path == "package.json":
        return "PACKAGE_METADATA_RESOURCE"
    if path in SUPPORT_PATHS:
        return "STATIC_CONTROL_RESOURCE"
    fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_MEMBER_INVALID")


def _binding_body_sha(value: dict[str, Any]) -> str:
    return canonical_sha256({key: item for key, item in value.items() if key != "binding_sha256"})


def reconstruct_action_catalog(sources: dict[str, bytes]) -> list[dict[str, Any]]:
    bindings: list[dict[str, Any]] = []
    for anchor in BINDING_ANCHORS:
        raw = sources.get(anchor["path"])
        if not isinstance(raw, bytes) or hashlib.sha256(raw).hexdigest() != anchor["raw_sha256"]:
            fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_BINDING_ANCHOR_INVALID")
        value = parse_json(raw, "ISOLATED_UAT_ACTION_SOURCE_CLOSURE_BINDING_JSON_INVALID")
        if value.get("schema_version") != anchor["schema_version"] \
                or value.get("contract") != anchor["contract"] \
                or value.get("binding_id") != anchor["binding_id"] \
                or value.get("binding_sha256") != anchor["binding_sha256"] \
                or _binding_body_sha(value) != anchor["binding_sha256"]:
            fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_BINDING_ANCHOR_INVALID")
        bindings.append(value)
    base_actions = bindings[0].get("actions")
    if not isinstance(base_actions, list) or len(base_actions) != len(ACTION_NAMES):
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_ACTION_CATALOG_INVALID")
    catalog: list[dict[str, Any]] = []
    for ordinal, action in enumerate(base_actions, 1):
        if not isinstance(action, dict) or action.get("ordinal") != ordinal \
                or action.get("action") != ACTION_NAMES[ordinal - 1] \
                or not isinstance(action.get("sources"), list) \
                or any(not _canonical_repo_path(path) for path in action["sources"]) \
                or len(action["sources"]) != len(set(action["sources"])):
            fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_ACTION_CATALOG_INVALID")
        catalog.append({
            "ordinal": ordinal,
            "action": action["action"],
            "sources": list(action["sources"]),
        })
    for binding in bindings[1:]:
        extensions = binding.get("source_extensions")
        if not isinstance(extensions, list):
            fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_ACTION_CATALOG_INVALID")
        for extension in extensions:
            if not isinstance(extension, dict) or type(extension.get("ordinal")) is not int \
                    or extension["ordinal"] < 1 or extension["ordinal"] > len(catalog) \
                    or not isinstance(extension.get("additional_sources"), list):
                fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_ACTION_CATALOG_INVALID")
            action = catalog[extension["ordinal"] - 1]
            additions = extension["additional_sources"]
            if any(not _canonical_repo_path(path) for path in additions) \
                    or set(action["sources"]) & set(additions):
                fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_ACTION_CATALOG_INVALID")
            action["sources"].extend(additions)
    if sum(len(action["sources"]) for action in catalog) != BOUNDARY["action_source_reference_count"]:
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_ACTION_CATALOG_INVALID")
    return catalog


def _extract_import_specifiers(raw: bytes, path: str) -> list[str]:
    try:
        source = raw.decode("utf-8")
    except UnicodeDecodeError:
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_IMPORT_GRAPH_INVALID")
    gap = r"(?:\s|/\*[\s\S]*?\*/|//[^\n]*(?:\n|$))*"
    if re.search(rf"\b(?:import|require){gap}\(", source) \
            or re.search(r"\bcreateRequire\b", source) \
            or re.search(r";[ \t]*(?:/\*[\s\S]*?\*/[ \t]*)*import\b", source) \
            or re.search(rf"\b(?:eval|Function){gap}\(", source) \
            or re.search(rf"\bexport{gap}(?:\*|\{{)[\s\S]*?{gap}from\b", source):
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_DYNAMIC_IMPORT_FORBIDDEN")
    pattern = re.compile(
        r"^\s*import\s+(?:[^;]*?\s+from\s+)?[\"']([^\"']+)[\"']\s*;",
        re.MULTILINE | re.DOTALL,
    )
    matches = [match.group(1) for match in pattern.finditer(source)]
    if len(matches) != len(re.findall(r"(?m)^\s*import\b", source)):
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_IMPORT_GRAPH_INVALID")
    if re.search(r"(?m)^\s*export\s+[^;]*?\s+from\s+[\"']", source):
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_IMPORT_GRAPH_INVALID")
    return matches


def _resolve_local(source: str, specifier: str) -> str:
    target = posixpath.normpath(posixpath.join(posixpath.dirname(source), specifier))
    if not _canonical_repo_path(target):
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_IMPORT_GRAPH_INVALID")
    return target


def _validate_script_imports(sources: dict[str, bytes], model: dict[str, Any]) -> list[dict[str, str]]:
    ts_local: list[dict[str, str]] = []
    ts_external: list[dict[str, Any]] = []
    for path in TYPESCRIPT_MEMBERS:
        specifiers = _extract_import_specifiers(sources[path], path)
        local = sorted(_resolve_local(path, item) for item in specifiers if item.startswith("."))
        external = sorted(item for item in specifiers if not item.startswith("."))
        ts_local.extend({"source": path, "target": item} for item in local)
        ts_external.append({"source": path, "imports": external})
    if sorted(ts_local, key=lambda item: (item["source"], item["target"])) != TYPESCRIPT_LOCAL_IMPORTS \
            or ts_external != TYPESCRIPT_EXTERNAL_IMPORTS \
            or model["typescript_local_imports"] != TYPESCRIPT_LOCAL_IMPORTS \
            or model["typescript_external_imports"] != TYPESCRIPT_EXTERNAL_IMPORTS:
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_TYPESCRIPT_IMPORT_INVALID")

    esm_local: list[dict[str, str]] = []
    esm_external: list[dict[str, Any]] = []
    for path in ESM_MEMBERS:
        specifiers = _extract_import_specifiers(sources[path], path)
        local = sorted(_resolve_local(path, item) for item in specifiers if item.startswith("."))
        external = sorted(item for item in specifiers if not item.startswith("."))
        esm_local.extend({"source": path, "target": item} for item in local)
        esm_external.append({"source": path, "imports": external})
    esm_local.sort(key=lambda item: (item["source"], item["target"]))
    if esm_local != ESM_LOCAL_IMPORTS or esm_external != ESM_EXTERNAL_IMPORTS \
            or model["esm_local_imports"] != ESM_LOCAL_IMPORTS \
            or model["esm_external_imports"] != ESM_EXTERNAL_IMPORTS:
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_ESM_IMPORT_INVALID")
    return [*ts_local, *esm_local]


def _python_imports(raw: bytes, path: str) -> tuple[ast.Module, list[str]]:
    try:
        tree = ast.parse(raw.decode("utf-8"), filename=path)
    except (UnicodeDecodeError, SyntaxError):
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_PYTHON_IMPORT_INVALID")
    imports: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_PYTHON_IMPORT_INVALID")
            if node.module != "__future__":
                imports.add((node.module or "").split(".")[0])
        elif isinstance(node, ast.Call):
            call_name = node.func.id if isinstance(node.func, ast.Name) else None
            call_attribute = node.func.attr if isinstance(node.func, ast.Attribute) else None
            allowed_subscript_call = path == "scripts/isolated-uat-runtime-contracts.py" \
                and isinstance(node.func, ast.Subscript) \
                and isinstance(node.func.value, ast.Name) \
                and node.func.value.id == "INPUT_VALIDATORS" \
                and isinstance(node.func.slice, ast.Name) \
                and node.func.slice.id == "family"
            if call_name in {
                "__import__", "eval", "exec", "import_module", "find_spec",
                "getattr", "vars", "globals", "locals",
            } or call_attribute in {"__import__", "import_module", "find_spec"} \
                    or (not isinstance(node.func, (ast.Name, ast.Attribute))
                        and not allowed_subscript_call):
                fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_DYNAMIC_IMPORT_FORBIDDEN")
    return tree, sorted(imports)


def _site_root_literal_assignments(tree: ast.Module) -> dict[str, str]:
    result: dict[str, str] = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1 \
                or not isinstance(node.targets[0], ast.Name) \
                or not isinstance(node.value, ast.BinOp) \
                or not isinstance(node.value.op, ast.Div) \
                or not isinstance(node.value.left, ast.Name) or node.value.left.id != "SITE_ROOT" \
                or not isinstance(node.value.right, ast.Constant) \
                or not isinstance(node.value.right.value, str):
            continue
        result[node.targets[0].id] = node.value.right.value
    return result


def _validate_python_imports(sources: dict[str, bytes], model: dict[str, Any]) -> list[dict[str, str]]:
    observed_external: list[dict[str, Any]] = []
    trees: dict[str, ast.Module] = {}
    for path in PYTHON_MEMBERS:
        tree, imports = _python_imports(sources[path], path)
        trees[path] = tree
        observed_external.append({"source": path, "imports": imports})
    if observed_external != PYTHON_EXTERNAL_IMPORTS \
            or model["python_external_imports"] != PYTHON_EXTERNAL_IMPORTS:
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_PYTHON_IMPORT_INVALID")

    observed_loads: list[dict[str, str]] = []
    one_shot = "scripts/isolated-uat-one-shot.py"
    assignments = _site_root_literal_assignments(trees[one_shot])
    for node in ast.walk(trees[one_shot]):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute) \
                or node.func.attr != "spec_from_file_location":
            continue
        if len(node.args) < 2 or not isinstance(node.args[1], ast.Name) \
                or node.args[1].id not in assignments:
            fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_PYTHON_LOADER_INVALID")
        observed_loads.append({"source": one_shot, "target": assignments[node.args[1].id]})

    owner = "scripts/isolated-uat-owner-completion-contracts.py"
    owner_dynamic_loader_count = 0
    for node in ast.walk(trees[owner]):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \
                and node.func.attr == "spec_from_file_location":
            owner_dynamic_loader_count += 1
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name) \
                or node.func.id != "_load_fixed_module":
            continue
        if len(node.args) != 2 or not isinstance(node.args[1], ast.Constant) \
                or not isinstance(node.args[1].value, str):
            fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_PYTHON_LOADER_INVALID")
        observed_loads.append({"source": owner, "target": node.args[1].value})
    if owner_dynamic_loader_count != 1:
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_PYTHON_LOADER_INVALID")
    observed_loads.sort(key=lambda item: (item["source"], item["target"]))
    if observed_loads != PYTHON_FIXED_MODULE_LOADS \
            or model["python_fixed_module_loads"] != PYTHON_FIXED_MODULE_LOADS:
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_PYTHON_LOADER_INVALID")
    return observed_loads


def _validate_control_reads(sources: dict[str, bytes], model: dict[str, Any]) -> None:
    path = "scripts/isolated-uat-control-plane-policy.py"
    tree, _ = _python_imports(sources[path], path)
    observed: list[str] | None = None
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 \
                and isinstance(node.targets[0], ast.Name) \
                and node.targets[0].id == "SOURCE_PATHS":
            try:
                candidate = ast.literal_eval(node.value)
            except (ValueError, TypeError, SyntaxError, MemoryError, RecursionError):
                fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_CONTROL_READ_INVALID")
            if not isinstance(candidate, list) or any(not isinstance(item, str) for item in candidate):
                fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_CONTROL_READ_INVALID")
            observed = candidate
    try:
        control_text = sources[path].decode("utf-8")
    except UnicodeDecodeError:
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_CONTROL_READ_INVALID")
    if observed != CONTROL_SOURCE_BINDING_PATHS \
            or model["control_source_binding_paths"] != CONTROL_SOURCE_BINDING_PATHS \
            or model["control_source_state_paths"] != CONTROL_SOURCE_STATE_PATHS \
            or 'directory.glob("*.sql")' not in control_text \
            or 'SITE_ROOT / "package.json"' not in control_text \
            or 'directory / "meta/_journal.json"' not in control_text:
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_CONTROL_READ_INVALID")


def _validate_migration_dataset(sources: dict[str, bytes]) -> None:
    package = parse_json(sources["package.json"], "ISOLATED_UAT_ACTION_SOURCE_CLOSURE_PACKAGE_INVALID")
    if not isinstance(package.get("version"), str) or not package["version"]:
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_PACKAGE_INVALID")
    journal = parse_json(
        sources["drizzle-postgres/meta/_journal.json"],
        "ISOLATED_UAT_ACTION_SOURCE_CLOSURE_MIGRATION_JOURNAL_INVALID",
    )
    entries = journal.get("entries")
    if journal.get("version") != "7" or journal.get("dialect") != "postgresql" \
            or not isinstance(entries, list) or len(entries) != len(MIGRATION_FILENAMES):
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_MIGRATION_JOURNAL_INVALID")
    for index, (entry, filename) in enumerate(zip(entries, MIGRATION_FILENAMES), 1):
        if not isinstance(entry, dict) or type(entry.get("idx")) is not int \
                or entry.get("idx") != index \
                or entry.get("version") != "7" or entry.get("tag") != filename[:-4] \
                or entry.get("breakpoints") is not True:
            fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_MIGRATION_JOURNAL_INVALID")


def _validate_compose_bind(sources: dict[str, bytes], model: dict[str, Any]) -> None:
    expected = [{"source": "compose.yml", "target": "deploy/Caddyfile"}]
    try:
        text = sources["compose.yml"].decode("utf-8")
    except UnicodeDecodeError:
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_COMPOSE_RESOURCE_INVALID")
    if model["compose_bind_resources"] != expected \
            or text.count("source: ./deploy/Caddyfile") != 1 \
            or text.count("target: /etc/caddy/Caddyfile") != 1:
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_COMPOSE_RESOURCE_INVALID")


def _acyclic(edges: list[dict[str, str]]) -> bool:
    graph: dict[str, set[str]] = {}
    for edge in edges:
        graph.setdefault(edge["source"], set()).add(edge["target"])
        graph.setdefault(edge["target"], set())
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node: str) -> bool:
        if node in visiting:
            return False
        if node in visited:
            return True
        visiting.add(node)
        if any(not visit(target) for target in graph[node]):
            return False
        visiting.remove(node)
        visited.add(node)
        return True

    return all(visit(node) for node in graph)


def _validate_reachability(roots: list[str], import_edges: list[dict[str, str]]) -> None:
    graph: dict[str, set[str]] = {path: set() for path in MEMBER_PATHS}
    for path in CONTROL_SOURCE_BINDING_PATHS:
        if path != "scripts/isolated-uat-control-plane-policy.py":
            graph["scripts/isolated-uat-control-plane-policy.py"].add(path)
    graph["scripts/isolated-uat-control-plane-policy.py"].update(CONTROL_SOURCE_STATE_PATHS)
    graph["compose.yml"].add("deploy/Caddyfile")
    for edge in import_edges:
        graph[edge["source"]].add(edge["target"])
    reachable = set(roots)
    pending = list(roots)
    while pending:
        source = pending.pop()
        for target in graph[source]:
            if target not in reachable:
                reachable.add(target)
                pending.append(target)
    if reachable != set(MEMBER_PATHS) or not _acyclic(import_edges):
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_REACHABILITY_INVALID")


DEPENDENCY_MODEL = {
    "control_source_binding_paths": CONTROL_SOURCE_BINDING_PATHS,
    "control_source_state_paths": CONTROL_SOURCE_STATE_PATHS,
    "python_external_imports": PYTHON_EXTERNAL_IMPORTS,
    "python_fixed_module_loads": PYTHON_FIXED_MODULE_LOADS,
    "typescript_external_imports": TYPESCRIPT_EXTERNAL_IMPORTS,
    "typescript_local_imports": TYPESCRIPT_LOCAL_IMPORTS,
    "esm_external_imports": ESM_EXTERNAL_IMPORTS,
    "esm_local_imports": ESM_LOCAL_IMPORTS,
    "compose_bind_resources": [{"source": "compose.yml", "target": "deploy/Caddyfile"}],
    "non_traversal_provenance": {
        "source": "operations/postgresql-runtime-privilege-policy-v2.json",
        "classification": "REFERENCE_SEMANTICS_ONLY_NOT_EXECUTABLE",
        "rule": "JSON_SOURCE_BINDING_IS_PROVENANCE_NOT_A_DECLARED_RUNTIME_DEPENDENCY",
        "expansion_status": "DEFERRED_UNTIL_FIXED_ISOLATED_UAT_RUNTIME_ADAPTER_CALL_GRAPH",
    },
}


def validate_policy(value: Any, sources: dict[str, bytes]) -> dict[str, Any]:
    code = "ISOLATED_UAT_ACTION_SOURCE_CLOSURE_POLICY_INVALID"
    value = exact(value, {
        "schema_version", "contract", "policy_id", "execution_authorized",
        "capability_status", "validation_output", "boundary", "binding_anchors",
        "action_catalog", "source_closure", "policy_sha256",
    }, code)
    if type(value["schema_version"]) is not int or value["schema_version"] != 1 \
            or value["contract"] != POLICY_CONTRACT \
            or value["policy_id"] != POLICY_ID or value["execution_authorized"] is not False \
            or canonical_json(value["capability_status"]) != canonical_json(CAPABILITY_STATUS) \
            or canonical_json(value["validation_output"]) != canonical_json(VALIDATION_OUTPUT) \
            or canonical_json(value["boundary"]) != canonical_json(BOUNDARY) \
            or canonical_json(value["binding_anchors"]) != canonical_json(BINDING_ANCHORS):
        fail(code)
    if not isinstance(sources, dict) or set(sources) != set(MEMBER_PATHS):
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_SOURCE_MAP_INVALID")
    if any(not _canonical_repo_path(path) for path in sources) \
            or len({path.casefold() for path in sources}) != len(sources):
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_SOURCE_MAP_INVALID")
    total = 0
    for raw in sources.values():
        if not isinstance(raw, bytes) or not raw or len(raw) > MAX_SOURCE_BYTES:
            fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_SOURCE_BYTES_INVALID")
        total += len(raw)
    if total > MAX_TOTAL_SOURCE_BYTES:
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_SOURCE_BYTES_INVALID")

    catalog = reconstruct_action_catalog(sources)
    if canonical_json(value["action_catalog"]) != canonical_json(catalog):
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_ACTION_CATALOG_INVALID")
    roots = sorted({path for action in catalog for path in action["sources"]})
    if len(roots) != BOUNDARY["direct_source_count"]:
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_ACTION_CATALOG_INVALID")

    closure = exact(value["source_closure"], {
        "schema_version", "algorithm", "roots", "members", "dependency_model",
        "external_boundary", "validation_scope", "source_closure_sha256",
    }, "ISOLATED_UAT_ACTION_SOURCE_CLOSURE_INVALID")
    if type(closure["schema_version"]) is not int or closure["schema_version"] != 1 \
            or closure["algorithm"] != "FROZEN_V6_FIXED_IMPORT_AND_CONTROL_READ_CLOSURE_V1" \
            or closure["roots"] != roots \
            or canonical_json(closure["dependency_model"]) != canonical_json(DEPENDENCY_MODEL) \
            or canonical_json(closure["external_boundary"]) != canonical_json(EXTERNAL_BOUNDARY) \
            or closure["validation_scope"] != (
                "CALLER_INJECTED_RAW_BYTES_FIXED_GRAPH_NOT_FILESYSTEM_ATTESTATION_"
                "NOT_TRUSTED_PRE_IMPORT_ENFORCEMENT"
            ):
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_INVALID")
    members = closure["members"]
    if not isinstance(members, list) or len(members) != len(MEMBER_PATHS):
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_MEMBER_INVALID")
    observed_paths: list[str] = []
    roots_set = set(roots)
    for member in members:
        member = exact(member, {"path", "sha256", "usage"}, "ISOLATED_UAT_ACTION_SOURCE_CLOSURE_MEMBER_INVALID")
        path = member["path"]
        if not _canonical_repo_path(path) or path in observed_paths or not _is_sha(member["sha256"]) \
                or member["usage"] != _member_usage(path, roots_set):
            fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_MEMBER_INVALID")
        observed_paths.append(path)
    if observed_paths != MEMBER_PATHS:
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_MEMBER_INVALID")
    for member in members:
        if hashlib.sha256(sources[member["path"]]).hexdigest() != member["sha256"]:
            fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_MEMBER_HASH_INVALID")

    model = closure["dependency_model"]
    _validate_control_reads(sources, model)
    _validate_migration_dataset(sources)
    _validate_compose_bind(sources, model)
    python_edges = _validate_python_imports(sources, model)
    script_edges = _validate_script_imports(sources, model)
    _validate_reachability(roots, [*python_edges, *script_edges])

    closure_body = {key: item for key, item in closure.items() if key != "source_closure_sha256"}
    if not _is_sha(closure["source_closure_sha256"]) \
            or canonical_sha256(closure_body) != closure["source_closure_sha256"]:
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_SHA256_INVALID")
    body = {key: item for key, item in value.items() if key != "policy_sha256"}
    if not _is_sha(value["policy_sha256"]) \
            or value["policy_sha256"] != EXPECTED_POLICY_SHA256 \
            or canonical_sha256(body) != value["policy_sha256"]:
        fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_POLICY_SHA256_INVALID")
    return value


def require_trusted_pre_import_bootstrap() -> None:
    fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_TRUSTED_PRE_IMPORT_BOOTSTRAP_NOT_IMPLEMENTED")


def require_runtime_backend() -> None:
    fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_RUNTIME_BACKEND_NOT_IMPLEMENTED")


def require_publisher() -> None:
    fail("ISOLATED_UAT_ACTION_SOURCE_CLOSURE_PUBLISHER_NOT_IMPLEMENTED")
