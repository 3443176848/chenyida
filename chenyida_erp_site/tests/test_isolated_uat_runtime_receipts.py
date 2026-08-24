#!/usr/bin/python3
"""Pure tests for isolated-UAT receipt semantics and predecessor continuity."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import inspect
import json
import unittest
from pathlib import Path


SITE_ROOT = Path(__file__).resolve().parent.parent
INTENT_MODULE_PATH = SITE_ROOT / "scripts/isolated-uat-runtime-contracts.py"
RECEIPT_MODULE_PATH = SITE_ROOT / "scripts/isolated-uat-runtime-receipts.py"
INTENT_POLICY_PATH = SITE_ROOT / "operations/isolated-uat-runtime-contract-policy-v1.json"
RECEIPT_POLICY_PATH = SITE_ROOT / "operations/isolated-uat-runtime-receipt-policy-v1.json"
BINDING_PATH = SITE_ROOT / "operations/isolated-uat-one-shot-action-bindings-v3.json"
PRIVILEGE_POLICY_PATH = SITE_ROOT / "operations/postgresql-runtime-privilege-policy-v2.json"


def load_module(name: str, path: Path):
    specification = importlib.util.spec_from_file_location(name, path)
    if specification is None or specification.loader is None:
        raise RuntimeError(f"{name} cannot be loaded")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


INTENTS = load_module("isolated_uat_runtime_contracts_receipt_test", INTENT_MODULE_PATH)
RECEIPTS = load_module("isolated_uat_runtime_receipts_test", RECEIPT_MODULE_PATH)


def canonical_sha256(value: dict) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def hashed(body: dict, field: str) -> dict:
    return {**body, field: canonical_sha256(body)}


def producer(binding: dict, family: str) -> dict:
    fixed = {
        "DATABASE_BOOTSTRAP": (5, "ISOLATED_UAT_DATABASE_BOOTSTRAP_ADAPTER",
                               "initialize_database_identity_and_login_roles"),
        "MIGRATION": (6, "ISOLATED_UAT_MIGRATION_ADAPTER",
                      "migrate_empty_database_to_bound_head"),
        "RUNTIME_PRIVILEGE": (7, "POSTGRESQL_RUNTIME_PRIVILEGE_PRIMITIVES",
                              "reconcile_final_runtime_privileges"),
        "EVIDENCE": (9, "ISOLATED_UAT_POSTDEPLOY_EVIDENCE_ADAPTER",
                     "verify_and_publish_isolated_uat_evidence"),
    }
    ordinal, handler, method = fixed[family]
    return {
        "schema_version": 1,
        "contract": "chenyida-erp-isolated-uat-receipt-producer/v1",
        "binding_sha256": binding["binding_sha256"],
        "action_ordinal": ordinal,
        "handler_id": handler,
        "adapter_method": method,
        "source_binding_scope": "DIRECT_CONTRACT_REFERENCES_ONLY",
    }


def migration_allowlist() -> list[dict]:
    return [
        {
            "ordinal": ordinal,
            "filename": path.name,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
        for ordinal, path in enumerate(sorted((SITE_ROOT / "drizzle-postgres").glob("*.sql")), 1)
    ]


def common(intent_policy: dict, project: str) -> dict:
    return {
        "operation_id": "uat-runtime-receipt-fixture-001",
        "request_id": "uat-one-shot-request-001",
        "project": project,
        "plan_sha256": "a" * 64,
        "runtime_contract_policy_sha256": intent_policy["policy_sha256"],
        "source_closure_sha256": intent_policy["source_closure"]["source_closure_sha256"],
    }


def build_fixture(intent_policy: dict, receipt_policy: dict, binding: dict) -> dict:
    project = "chenyida-erp-uat-runtime-receipt-test"
    shared = common(intent_policy, project)
    roles = [
        {"role": role, "credential_file": intent_policy["invariants"]["role_credentials"][role]}
        for role in intent_policy["invariants"]["technical_login_roles"]
    ]
    images = {
        "web": {
            "image_reference": f"example.invalid/erp-web@sha256:{'4' * 64}",
            "config_digest": f"sha256:{'5' * 64}",
        },
        "worker": {
            "image_reference": f"example.invalid/erp-worker@sha256:{'6' * 64}",
            "config_digest": f"sha256:{'7' * 64}",
        },
    }
    database_intent = INTENTS.build_intent("DATABASE_BOOTSTRAP", {
        **shared,
        "database_cluster_identity": {
            "project": project,
            "postgres_container_identity_sha256": "1" * 64,
            "system_identifier": "7391051976607354401",
        },
        "credential_generation_receipt_sha256": "2" * 64,
        "database_target_expectation": {
            "deployment_class": "UAT",
            "deployment_id": project,
            "name": "chenyida_erp",
            "marker": f"chenyida-erp-deployment/v2:UAT:{project}",
            "owner": "chenyida_erp_owner",
            "current_head": "EMPTY",
        },
        "login_role_expectations": roles,
    }, intent_policy)
    database_producer = producer(binding, "DATABASE_BOOTSTRAP")
    database_target = hashed({
        "schema_version": 1,
        "contract": "chenyida-erp-isolated-uat-database-target-identity/v1",
        "bootstrap_intent_sha256": database_intent["intent_sha256"],
        "producer": database_producer,
        "database_name": "chenyida_erp",
        "system_identifier": "7391051976607354401",
        "database_oid": "16384",
        "marker": f"chenyida-erp-deployment/v2:UAT:{project}",
        "owner": "chenyida_erp_owner",
    }, "identity_sha256")
    observed_roles = receipt_policy["invariants"]["technical_login_role_attributes"]
    database_observation = hashed({
        "schema_version": 1,
        "contract": "chenyida-erp-isolated-uat-bootstrap-observation/v1",
        "bootstrap_intent_sha256": database_intent["intent_sha256"],
        "producer": database_producer,
        "project": project,
        "database_target_identity_sha256": database_target["identity_sha256"],
        "database_name": database_target["database_name"],
        "system_identifier": database_target["system_identifier"],
        "database_oid": database_target["database_oid"],
        "marker": database_target["marker"],
        "owner": database_target["owner"],
        "observed_login_roles": observed_roles,
        "observed_head": "EMPTY",
        "schema_acl_status": "DEFERRED_UNTIL_POST_MIGRATION",
        "observed_at": "2026-08-24T10:00:00.000Z",
    }, "evidence_sha256")
    roles_sha = canonical_sha256({
        "contract": "chenyida-erp-isolated-uat-login-role-observation/v1",
        "roles": observed_roles,
    })
    database_receipt = hashed({
        "schema_version": 1,
        "contract": "chenyida-erp-isolated-uat-database-bootstrap-receipt/v1",
        "bootstrap_intent_sha256": database_intent["intent_sha256"],
        "producer": database_producer,
        "database_target_identity_sha256": database_target["identity_sha256"],
        "observed_login_roles": observed_roles,
        "observed_login_roles_sha256": roles_sha,
        "observed_head": "EMPTY",
        "schema_acl_status": "DEFERRED_UNTIL_POST_MIGRATION",
        "observation_bundle_sha256": database_observation["evidence_sha256"],
        "observed_at": database_observation["observed_at"],
        "completed_at": "2026-08-24T10:01:00.000Z",
    }, "receipt_sha256")

    migration_intent = INTENTS.build_intent("MIGRATION", {
        **shared,
        "database_bootstrap_receipt_sha256": database_receipt["receipt_sha256"],
        "database_target_identity_sha256": database_target["identity_sha256"],
        "release_source": {
            "package_version": intent_policy["invariants"]["package_version"],
            "git_commit": "a" * 40,
            "git_tree": "b" * 40,
            "images": images,
            "resolved_compose_sha256": "c" * 64,
        },
        "migration": {
            "from_head": "EMPTY",
            "to_head": intent_policy["invariants"]["migration_target_head"],
            "count": intent_policy["invariants"]["migration_count"],
            "allowlist_sha256": intent_policy["invariants"]["migration_allowlist_sha256"],
        },
        "release_candidate_root_identity_sha256": "e" * 64,
    }, intent_policy)
    migration_producer = producer(binding, "MIGRATION")
    candidate = hashed({
        "schema_version": 1,
        "contract": "chenyida-erp-isolated-uat-release-candidate-receipt/v1",
        "migration_intent_sha256": migration_intent["intent_sha256"],
        "producer": migration_producer,
        **migration_intent["release_source"],
        "database_target_identity_sha256": database_target["identity_sha256"],
        "candidate_root_identity_sha256": migration_intent["release_candidate_root_identity_sha256"],
        "published_at": "2026-08-24T10:02:00.000Z",
    }, "receipt_sha256")
    allowlist = migration_allowlist()
    ledger = hashed({
        "schema_version": 1,
        "contract": "chenyida-erp-isolated-uat-migration-applied-ledger/v1",
        "migration_intent_sha256": migration_intent["intent_sha256"],
        "producer": migration_producer,
        "database_target_identity_sha256": database_target["identity_sha256"],
        "rows": [{"version": item["filename"], "checksum": item["sha256"]} for item in allowlist],
        "applied_ledger_sha256": receipt_policy["invariants"]["migration_applied_ledger_sha256"],
    }, "evidence_sha256")
    migration_observation = hashed({
        "schema_version": 1,
        "contract": "chenyida-erp-isolated-uat-migration-observation/v1",
        "migration_intent_sha256": migration_intent["intent_sha256"],
        "producer": migration_producer,
        "release_candidate_receipt_sha256": candidate["receipt_sha256"],
        "database_target_identity_sha256": database_target["identity_sha256"],
        "from_head": "EMPTY",
        "to_head": migration_intent["migration"]["to_head"],
        "applied_count": migration_intent["migration"]["count"],
        "applied_ledger_sha256": ledger["applied_ledger_sha256"],
        "applied_ledger_evidence_sha256": ledger["evidence_sha256"],
        "observed_head": migration_intent["migration"]["to_head"],
        "observed_at": "2026-08-24T10:03:00.000Z",
    }, "evidence_sha256")
    migration_receipt = hashed({
        "schema_version": 1,
        "contract": "chenyida-erp-isolated-uat-migration-execution-receipt/v1",
        "migration_intent_sha256": migration_intent["intent_sha256"],
        "producer": migration_producer,
        "release_candidate_receipt_sha256": candidate["receipt_sha256"],
        "database_target_identity_sha256": database_target["identity_sha256"],
        "from_head": "EMPTY",
        "to_head": migration_intent["migration"]["to_head"],
        "applied_count": migration_intent["migration"]["count"],
        "applied_ledger_sha256": ledger["applied_ledger_sha256"],
        "observed_head": migration_intent["migration"]["to_head"],
        "observation_bundle_sha256": migration_observation["evidence_sha256"],
        "observed_at": migration_observation["observed_at"],
        "completed_at": "2026-08-24T10:04:00.000Z",
    }, "receipt_sha256")

    privilege_intent = hashed({
        "schema_version": 1,
        "contract": RECEIPTS.RUNTIME_PRIVILEGE_INTENT_CONTRACT,
        "operation_id": shared["operation_id"],
        "request_id": shared["request_id"],
        "project": project,
        "plan_sha256": shared["plan_sha256"],
        "runtime_intent_policy_sha256": intent_policy["policy_sha256"],
        "runtime_receipt_policy_sha256": receipt_policy["policy_sha256"],
        "database_target_identity_sha256": database_target["identity_sha256"],
        "migration_execution_receipt_sha256": migration_receipt["receipt_sha256"],
        "target_head": migration_intent["migration"]["to_head"],
        "technical_login_roles": intent_policy["invariants"]["technical_login_roles"],
        "runtime_privilege_policy_sha256": receipt_policy["runtime_privilege_policy_binding"]["policy_sha256"],
        "contract_validation_status": "STRUCTURE_VALID",
        "execution_status": "NOT_EXECUTED",
        "publication_status": "NOT_PUBLISHED",
    }, "intent_sha256")
    privilege_producer = producer(binding, "RUNTIME_PRIVILEGE")
    privilege_observation = hashed({
        "schema_version": 1,
        "contract": "chenyida-erp-isolated-uat-runtime-privilege-observation/v1",
        "runtime_privilege_intent_sha256": privilege_intent["intent_sha256"],
        "producer": privilege_producer,
        "project": project,
        "database_target_identity_sha256": database_target["identity_sha256"],
        "migration_execution_receipt_sha256": migration_receipt["receipt_sha256"],
        "runtime_privilege_policy_sha256": privilege_intent["runtime_privilege_policy_sha256"],
        "observed_head": privilege_intent["target_head"],
        "observed_login_roles": observed_roles,
        "database_acl_status": "MATCHED_BOUND_POLICY",
        "schema_acl_status": "MATCHED_BOUND_POLICY",
        "default_acl_status": "MATCHED_BOUND_POLICY",
        "relation_acl_status": "MATCHED_BOUND_POLICY",
        "observed_at": "2026-08-24T10:05:00.000Z",
    }, "evidence_sha256")
    runtime_roles_sha = canonical_sha256({
        "contract": "chenyida-erp-isolated-uat-runtime-login-role-observation/v1",
        "roles": observed_roles,
    })
    privilege_receipt = hashed({
        "schema_version": 1,
        "contract": "chenyida-erp-isolated-uat-runtime-privilege-receipt/v1",
        "runtime_privilege_intent_sha256": privilege_intent["intent_sha256"],
        "producer": privilege_producer,
        "project": project,
        "database_target_identity_sha256": database_target["identity_sha256"],
        "migration_execution_receipt_sha256": migration_receipt["receipt_sha256"],
        "runtime_privilege_policy_sha256": privilege_intent["runtime_privilege_policy_sha256"],
        "observation_bundle_sha256": privilege_observation["evidence_sha256"],
        "observed_head": privilege_intent["target_head"],
        "observed_login_roles_sha256": runtime_roles_sha,
        "completed_at": "2026-08-24T10:06:00.000Z",
    }, "receipt_sha256")

    simple_containers = {
        "postgres": {
            "project": project, "container_id": "3" * 64,
            "image_reference": f"postgres@sha256:{'3' * 64}",
            "image_config_digest": f"sha256:{'3' * 64}",
        },
        "caddy": {
            "project": project, "container_id": "4" * 64,
            "image_reference": f"caddy@sha256:{'4' * 64}",
            "image_config_digest": f"sha256:{'4' * 64}",
        },
        "web": {
            "project": project, "container_id": "5" * 64,
            "image_reference": images["web"]["image_reference"],
            "image_config_digest": images["web"]["config_digest"],
        },
        "worker": {
            "project": project, "container_id": "6" * 64,
            "image_reference": images["worker"]["image_reference"],
            "image_config_digest": images["worker"]["config_digest"],
        },
    }
    loopback_ports = {"host": "127.0.0.1", "web": 33001, "caddy_http": 33080, "caddy_https": 33443}
    evidence_intent = INTENTS.build_intent("EVIDENCE", {
        **shared,
        "release_candidate_receipt_sha256": candidate["receipt_sha256"],
        "migration_execution_receipt_sha256": migration_receipt["receipt_sha256"],
        "runtime_privilege_receipt_sha256": privilege_receipt["receipt_sha256"],
        "runtime_source": {
            "package_version": intent_policy["invariants"]["package_version"],
            "git_commit": "a" * 40,
            "git_tree": "b" * 40,
            "migration_head": intent_policy["invariants"]["migration_target_head"],
            "migration_allowlist_sha256": intent_policy["invariants"]["migration_allowlist_sha256"],
            "resolved_compose_sha256": "c" * 64,
        },
        "containers": simple_containers,
        "loopback": loopback_ports,
        "release_identity_reader_gid": 65532,
        "one_shot_state_root_identity_sha256": "f" * 64,
    }, intent_policy)
    evidence_producer = producer(binding, "EVIDENCE")
    rich_containers = {}
    network_map = {
        "postgres": [f"{project}_backend"],
        "worker": [f"{project}_backend"],
        "web": [f"{project}_backend", f"{project}_edge"],
        "caddy": [f"{project}_edge"],
    }
    health_map = {"postgres": "HEALTHY", "web": "HEALTHY", "worker": "HEALTHY", "caddy": "NONE"}
    port_map = {
        "postgres": [], "worker": [],
        "web": [{"host_ip": "127.0.0.1", "host_port": 33001,
                 "container_port": 3000, "protocol": "tcp"}],
        "caddy": [
            {"host_ip": "127.0.0.1", "host_port": 33080,
             "container_port": 80, "protocol": "tcp"},
            {"host_ip": "127.0.0.1", "host_port": 33443,
             "container_port": 443, "protocol": "tcp"},
            {"host_ip": "127.0.0.1", "host_port": 33443,
             "container_port": 443, "protocol": "udp"},
        ],
    }
    for service, identity in simple_containers.items():
        rich_containers[service] = {
            **identity,
            "service": service,
            "state": "RUNNING",
            "health": health_map[service],
            "networks": network_map[service],
            "published_ports": port_map[service],
        }
    container_set = hashed({
        "schema_version": 1,
        "contract": "chenyida-erp-isolated-uat-container-identity-set/v1",
        "evidence_intent_sha256": evidence_intent["intent_sha256"],
        "producer": evidence_producer,
        "project": project,
        "containers": rich_containers,
    }, "evidence_sha256")
    health = {
        "deployment_class": "UAT",
        "deployment_id": project,
        "version": intent_policy["invariants"]["package_version"],
        "revision": "a" * 12,
        "migration_head": intent_policy["invariants"]["migration_target_head"],
        "migration_manifest_sha256": intent_policy["invariants"]["migration_allowlist_sha256"],
        "components": {
            "postgresql": "READY", "migration": "READY", "worker": "READY",
            "uploads": "READY", "attachments": "READY", "runtime": "READY",
        },
        "database_time": "2026-08-24T10:06:30.000Z",
    }
    health_sha = canonical_sha256({
        "contract": "chenyida-erp-isolated-uat-normalized-health/v1", "health": health,
    })
    readiness_loopback = {
        "host": "127.0.0.1",
        "ports": {"web": 33001, "caddy_http": 33080, "caddy_https": 33443},
        "probes": [
            {"id": "WEB_DIRECT", "scheme": "http", "port": 33001,
             "path": "/api/health", "status": 200,
             "normalized_health_sha256": health_sha},
            {"id": "CADDY_HTTP", "scheme": "http", "port": 33080,
             "path": "/api/health", "status": 308,
             "observed_location_sha256": "8" * 64,
             "route_binding_status": "NOT_VALIDATED_MISSING_BOUND_SERVER_NAME"},
            {"id": "CADDY_HTTPS", "scheme": "https", "port": 33443,
             "path": "/api/health", "status": 200,
             "tls_mode": "OBSERVED_LEAF_SHA256", "peer_certificate_sha256": "9" * 64,
             "normalized_health_sha256": health_sha,
             "server_name_binding_status": "NOT_VALIDATED_MISSING_BOUND_SERVER_NAME"},
        ],
        "health": health,
        "health_sha256": health_sha,
    }
    readiness = hashed({
        "schema_version": 1,
        "contract": "chenyida-erp-isolated-uat-readiness-receipt/v1",
        "evidence_intent_sha256": evidence_intent["intent_sha256"],
        "producer": evidence_producer,
        "loopback": readiness_loopback,
        "expected_package_version": intent_policy["invariants"]["package_version"],
        "expected_git_commit": "a" * 40,
        "observed_package_version": intent_policy["invariants"]["package_version"],
        "observed_git_commit": "a" * 40,
        "observed_at": "2026-08-24T10:07:00.000Z",
    }, "receipt_sha256")
    postdeploy = hashed({
        "schema_version": 1,
        "contract": "chenyida-erp-isolated-uat-postdeploy-receipt/v1",
        "evidence_intent_sha256": evidence_intent["intent_sha256"],
        "producer": evidence_producer,
        "readiness_receipt_sha256": readiness["receipt_sha256"],
        "release_candidate_receipt_sha256": candidate["receipt_sha256"],
        "migration_execution_receipt_sha256": migration_receipt["receipt_sha256"],
        "runtime_privilege_receipt_sha256": privilege_receipt["receipt_sha256"],
        "container_identity_set_sha256": container_set["evidence_sha256"],
        "observed_at": "2026-08-24T10:08:00.000Z",
    }, "receipt_sha256")
    runtime_identity = hashed({
        "schema_version": 1,
        "contract": "chenyida-erp-isolated-uat-runtime-identity-receipt/v1",
        "evidence_intent_sha256": evidence_intent["intent_sha256"],
        "producer": evidence_producer,
        "postdeploy_receipt_sha256": postdeploy["receipt_sha256"],
        "project": project,
        "runtime_source": evidence_intent["runtime_source"],
        "containers": rich_containers,
        "loopback": readiness_loopback,
        "release_identity_reader_gid": 65532,
        "identity_semantics": "ISOLATED_UAT_ONLY",
        "production_release_identity_compatible": False,
        "published_at": "2026-08-24T10:09:00.000Z",
    }, "receipt_sha256")

    return {
        "intents": {
            "DATABASE_BOOTSTRAP": database_intent,
            "MIGRATION": migration_intent,
            "RUNTIME_PRIVILEGE": privilege_intent,
            "EVIDENCE": evidence_intent,
        },
        "receipts": {
            "database_target_identity": database_target,
            "database_bootstrap_receipt": database_receipt,
            "release_candidate_receipt": candidate,
            "migration_execution_receipt": migration_receipt,
            "runtime_privilege_receipt": privilege_receipt,
            "readiness_receipt": readiness,
            "isolated_uat_postdeploy_receipt": postdeploy,
            "isolated_uat_runtime_identity_receipt": runtime_identity,
        },
        "evidence_payloads": {
            "database_bootstrap_observation": database_observation,
            "migration_applied_ledger": ledger,
            "migration_observation": migration_observation,
            "runtime_privilege_observation": privilege_observation,
            "container_identity_set": container_set,
        },
        "expected_migration_allowlist": allowlist,
    }


class IsolatedUatRuntimeReceiptTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.intent_policy = json.loads(INTENT_POLICY_PATH.read_text(encoding="utf-8"))
        cls.intent_policy_raw = INTENT_POLICY_PATH.read_bytes()
        cls.receipt_policy = json.loads(RECEIPT_POLICY_PATH.read_text(encoding="utf-8"))
        cls.receipt_policy_raw = RECEIPT_POLICY_PATH.read_bytes()
        cls.binding = json.loads(BINDING_PATH.read_text(encoding="utf-8"))
        cls.policy_sources = {
            "operations/isolated-uat-runtime-contract-policy-v1.json": INTENT_POLICY_PATH.read_bytes(),
            "operations/postgresql-runtime-privilege-policy-v2.json": PRIVILEGE_POLICY_PATH.read_bytes(),
            "operations/isolated-uat-one-shot-action-bindings-v3.json": BINDING_PATH.read_bytes(),
            "scripts/isolated-uat-runtime-receipts.py": RECEIPT_MODULE_PATH.read_bytes(),
        }
        cls.expected_policy_roots = {
            "intent_policy_sha256": cls.intent_policy["policy_sha256"],
            "intent_policy_file_sha256": hashlib.sha256(cls.intent_policy_raw).hexdigest(),
            "receipt_policy_sha256": cls.receipt_policy["policy_sha256"],
            "receipt_policy_file_sha256": hashlib.sha256(cls.receipt_policy_raw).hexdigest(),
        }
        cls.fixture = build_fixture(cls.intent_policy, cls.receipt_policy, cls.binding)

    def validate(self, fixture: dict | None = None, **overrides):
        value = fixture or self.fixture
        arguments = {
            **value,
            "binding": self.binding,
            "verification_time": "2026-08-24T10:10:00.000Z",
            "intent_policy": self.intent_policy,
            "receipt_policy": self.receipt_policy,
            "receipt_policy_raw": self.receipt_policy_raw,
            "expected_policy_roots": self.expected_policy_roots,
            "policy_sources": self.policy_sources,
            **overrides,
        }
        return RECEIPTS.validate_receipt_chain(**arguments)

    def test_valid_chain_is_deterministic_and_does_not_claim_runtime_truth(self) -> None:
        first = self.validate()
        second = self.validate(copy.deepcopy(self.fixture))
        self.assertEqual(first, second)
        self.assertEqual(first["chain_head_sha256"], self.fixture["receipts"]
                         ["isolated_uat_runtime_identity_receipt"]["receipt_sha256"])
        self.assertEqual(
            first["predecessor_chain_status"],
            "VALIDATED_PURE_INTERNAL_CONTRACT_CHAIN_FROM_UNVERIFIED_EXTERNAL_DIGEST_ANCHORS",
        )
        self.assertEqual(first["external_anchor_validation_status"], "NOT_EVALUATED")
        self.assertEqual(first["runtime_evidence_status"], "NOT_ESTABLISHED_BY_PURE_VALIDATION")
        self.assertEqual(
            first["receipt_policy_root_status"],
            "MATCHED_CALLER_SUPPLIED_EXPECTED_DIGESTS",
        )
        self.assertEqual(first["control_plan_anchor_status"], "NOT_EVALUATED")
        self.assertEqual(
            first["verification_time_source_status"],
            "CALLER_INJECTED_NOT_ATTESTED",
        )
        self.assertEqual(first["verified_at"], "2026-08-24T10:10:00.000Z")
        self.assertEqual(first["operation_id"], "uat-runtime-receipt-fixture-001")
        self.assertEqual(first["request_id"], "uat-one-shot-request-001")

    def test_policy_binding_allowlist_and_applied_ledger_are_exact(self) -> None:
        self.assertEqual(
            RECEIPTS.validate_policy(
                self.receipt_policy, self.policy_sources, self.intent_policy,
            ),
            self.receipt_policy,
        )
        allowlist = self.fixture["expected_migration_allowlist"]
        self.assertEqual(
            RECEIPTS.migration_allowlist_sha256(allowlist),
            "8bb2b2d662df03e397d49c4ed5d11f1af1a9406ecbaff37aee8fc0d2d7388eed",
        )
        self.assertEqual(
            RECEIPTS.migration_applied_ledger_sha256(allowlist),
            "e4a7bc4b3f11d58df3eb6603ef8f655654c0b5c5f838a86c329fee277bdc6a34",
        )

    def test_semantic_tamper_fails_even_after_self_digest_is_recomputed(self) -> None:
        altered = copy.deepcopy(self.fixture)
        target = altered["receipts"]["database_target_identity"]
        target["owner"] = "chenyida_erp_web"
        target["identity_sha256"] = canonical_sha256({
            key: value for key, value in target.items() if key != "identity_sha256"
        })
        with self.assertRaisesRegex(
            RECEIPTS.ContractError, "ISOLATED_UAT_DATABASE_RECEIPT_SEMANTICS_INVALID",
        ):
            self.validate(altered)

    def test_evidence_payload_tamper_fails_after_rehash(self) -> None:
        altered = copy.deepcopy(self.fixture)
        ledger = altered["evidence_payloads"]["migration_applied_ledger"]
        ledger["rows"][0]["checksum"] = "f" * 64
        ledger["evidence_sha256"] = canonical_sha256({
            key: value for key, value in ledger.items() if key != "evidence_sha256"
        })
        with self.assertRaisesRegex(
            RECEIPTS.ContractError, "ISOLATED_UAT_MIGRATION_RECEIPT_SEMANTICS_INVALID",
        ):
            self.validate(altered)

    def test_cross_project_intent_splice_is_rejected_before_receipts(self) -> None:
        altered = copy.deepcopy(self.fixture)
        evidence = altered["intents"]["EVIDENCE"]
        inputs = {key: copy.deepcopy(evidence[key]) for key in
                  self.intent_policy["families"]["EVIDENCE"]["input_fields"]}
        inputs["project"] = "chenyida-erp-uat-other-project"
        for container in inputs["containers"].values():
            container["project"] = inputs["project"]
        altered["intents"]["EVIDENCE"] = INTENTS.build_intent(
            "EVIDENCE", inputs, self.intent_policy,
        )
        with self.assertRaisesRegex(
            RECEIPTS.ContractError, "ISOLATED_UAT_RECEIPT_CHAIN_INTENT_CONTINUITY_INVALID",
        ):
            self.validate(altered)

    def test_binding_is_anchored_not_merely_self_hashed(self) -> None:
        altered = copy.deepcopy(self.binding)
        altered["actions"][0]["effect"] = "MUTATING"
        altered["binding_sha256"] = canonical_sha256({
            key: value for key, value in altered.items() if key != "binding_sha256"
        })
        with self.assertRaisesRegex(
            RECEIPTS.ContractError, "ISOLATED_UAT_RECEIPT_BINDING_INVALID",
        ):
            self.validate(binding=altered)

    def test_noncanonical_time_and_reordered_chain_fail_closed(self) -> None:
        altered = copy.deepcopy(self.fixture)
        candidate = altered["receipts"]["release_candidate_receipt"]
        candidate["published_at"] = "2026-08-24T09:59:00.000Z"
        candidate["receipt_sha256"] = canonical_sha256({
            key: value for key, value in candidate.items() if key != "receipt_sha256"
        })
        with self.assertRaisesRegex(
            RECEIPTS.ContractError, "ISOLATED_UAT_MIGRATION_RECEIPT_SEMANTICS_INVALID",
        ):
            self.validate(altered)
        with self.assertRaisesRegex(RECEIPTS.ContractError, "ISOLATED_UAT_RECEIPT_TIME_INVALID"):
            self.validate(verification_time="2026-08-24T10:10:00Z")
        with self.assertRaisesRegex(RECEIPTS.ContractError, "ISOLATED_UAT_RECEIPT_CHAIN_STALE"):
            self.validate(verification_time="2036-08-24T10:10:00.000Z")
        # Identity is only 52m old here, but the first bootstrap observation is
        # 61m old.  Freshness must cover the whole chain rather than its tail.
        with self.assertRaisesRegex(RECEIPTS.ContractError, "ISOLATED_UAT_RECEIPT_CHAIN_STALE"):
            self.validate(verification_time="2026-08-24T11:01:01.000Z")

    def test_synthetic_contract_and_arbitrary_validator_injection_are_forbidden(self) -> None:
        altered = copy.deepcopy(self.fixture)
        target = altered["receipts"]["database_target_identity"]
        target["contract"] = "chenyida-erp-isolated-uat-synthetic-target/v1"
        target["identity_sha256"] = canonical_sha256({
            key: value for key, value in target.items() if key != "identity_sha256"
        })
        with self.assertRaisesRegex(
            RECEIPTS.ContractError, "ISOLATED_UAT_SYNTHETIC_RECEIPT_FORBIDDEN",
        ):
            self.validate(altered)
        self.assertNotIn("intent_validator", inspect.signature(
            RECEIPTS.validate_receipt_chain,
        ).parameters)

    def test_invalid_unicode_is_rejected_as_a_stable_contract_error(self) -> None:
        altered = copy.deepcopy(self.fixture)
        altered["intents"]["EVIDENCE"]["operation_id"] = "uat-\ud800-invalid"
        with self.assertRaisesRegex(
            RECEIPTS.ContractError, "ISOLATED_UAT_RECEIPT_CHAIN_FIELDS_INVALID",
        ):
            self.validate(altered)

    def test_malformed_nested_values_return_a_stable_contract_error(self) -> None:
        altered = copy.deepcopy(self.fixture)
        altered["intents"]["DATABASE_BOOTSTRAP"]["database_cluster_identity"][
            "system_identifier"
        ] = {"malformed": True}
        database = altered["intents"]["DATABASE_BOOTSTRAP"]
        database["database_cluster_identity_sha256"] = canonical_sha256(
            database["database_cluster_identity"]
        )
        database["intent_sha256"] = canonical_sha256({
            key: value for key, value in database.items() if key != "intent_sha256"
        })
        with self.assertRaisesRegex(
            RECEIPTS.ContractError, "ISOLATED_UAT_RECEIPT_CHAIN_FIELDS_INVALID",
        ):
            self.validate(altered)

        deeply_nested = {}
        cursor = deeply_nested
        for _ in range(1500):
            cursor["nested"] = {}
            cursor = cursor["nested"]
        with self.assertRaisesRegex(
            RECEIPTS.ContractError, "ISOLATED_UAT_RECEIPT_CHAIN_FIELDS_INVALID",
        ):
            self.validate({**self.fixture, "intents": deeply_nested})

    def test_rehashed_caller_policy_forgery_cannot_shift_bound_semantics(self) -> None:
        intent_policy = copy.deepcopy(self.intent_policy)
        intent_policy["invariants"]["package_version"] = "0.1.0-alpha.forged-policy"
        intent_policy["policy_sha256"] = canonical_sha256({
            key: value for key, value in intent_policy.items() if key != "policy_sha256"
        })
        intent_raw = (json.dumps(intent_policy, ensure_ascii=False, indent=2) + "\n").encode()

        receipt_policy = copy.deepcopy(self.receipt_policy)
        receipt_policy["intent_policy_binding"]["policy_sha256"] = intent_policy[
            "policy_sha256"
        ]
        receipt_policy["invariants"]["package_version"] = "0.1.0-alpha.forged-policy"
        for member in receipt_policy["source_closure"]["members"]:
            if member["path"] == "operations/isolated-uat-runtime-contract-policy-v1.json":
                member["sha256"] = hashlib.sha256(intent_raw).hexdigest()
        receipt_policy["source_closure"]["source_closure_sha256"] = canonical_sha256({
            key: value for key, value in receipt_policy["source_closure"].items()
            if key != "source_closure_sha256"
        })
        receipt_policy["policy_sha256"] = canonical_sha256({
            key: value for key, value in receipt_policy.items() if key != "policy_sha256"
        })
        receipt_raw = (json.dumps(receipt_policy, ensure_ascii=False, indent=2) + "\n").encode()
        sources = {**self.policy_sources,
                   "operations/isolated-uat-runtime-contract-policy-v1.json": intent_raw}

        with self.assertRaisesRegex(
            RECEIPTS.ContractError, "ISOLATED_UAT_RECEIPT_POLICY_ROOT_INVALID",
        ):
            self.validate(
                intent_policy=intent_policy,
                receipt_policy=receipt_policy,
                receipt_policy_raw=receipt_raw,
                policy_sources=sources,
            )

        forged_roots = {
            "intent_policy_sha256": intent_policy["policy_sha256"],
            "intent_policy_file_sha256": hashlib.sha256(intent_raw).hexdigest(),
            "receipt_policy_sha256": receipt_policy["policy_sha256"],
            "receipt_policy_file_sha256": hashlib.sha256(receipt_raw).hexdigest(),
        }
        with self.assertRaisesRegex(
            RECEIPTS.ContractError, "ISOLATED_UAT_RUNTIME_RECEIPT_POLICY_INVALID",
        ):
            self.validate(
                intent_policy=intent_policy,
                receipt_policy=receipt_policy,
                receipt_policy_raw=receipt_raw,
                expected_policy_roots=forged_roots,
                policy_sources=sources,
            )

    def test_zero_git_image_and_container_identities_fail_closed(self) -> None:
        altered = copy.deepcopy(self.fixture)
        migration = altered["intents"]["MIGRATION"]
        inputs = {
            key: copy.deepcopy(migration[key])
            for key in self.intent_policy["families"]["MIGRATION"]["input_fields"]
        }
        inputs["release_source"]["git_commit"] = "0" * 40
        altered["intents"]["MIGRATION"] = INTENTS.build_intent(
            "MIGRATION", inputs, self.intent_policy,
        )
        with self.assertRaisesRegex(
            RECEIPTS.ContractError, "ISOLATED_UAT_MIGRATION_INTENT_INVALID",
        ):
            self.validate(altered)

        altered = copy.deepcopy(self.fixture)
        evidence = altered["intents"]["EVIDENCE"]
        inputs = {
            key: copy.deepcopy(evidence[key])
            for key in self.intent_policy["families"]["EVIDENCE"]["input_fields"]
        }
        inputs["containers"]["web"]["container_id"] = "0" * 64
        altered["intents"]["EVIDENCE"] = INTENTS.build_intent(
            "EVIDENCE", inputs, self.intent_policy,
        )
        with self.assertRaisesRegex(
            RECEIPTS.ContractError, "ISOLATED_UAT_EVIDENCE_INTENT_INVALID",
        ):
            self.validate(altered)

        altered = copy.deepcopy(self.fixture)
        evidence = altered["intents"]["EVIDENCE"]
        inputs = {
            key: copy.deepcopy(evidence[key])
            for key in self.intent_policy["families"]["EVIDENCE"]["input_fields"]
        }
        inputs["containers"]["worker"]["container_id"] = inputs["containers"]["web"][
            "container_id"
        ]
        altered["intents"]["EVIDENCE"] = INTENTS.build_intent(
            "EVIDENCE", inputs, self.intent_policy,
        )
        with self.assertRaisesRegex(
            RECEIPTS.ContractError, "ISOLATED_UAT_EVIDENCE_INTENT_INVALID",
        ):
            self.validate(altered)

    def test_postgresql_identity_numeric_bounds_fail_closed(self) -> None:
        altered = copy.deepcopy(self.fixture)
        target = altered["receipts"]["database_target_identity"]
        target["database_oid"] = "4294967296"
        target["identity_sha256"] = canonical_sha256({
            key: value for key, value in target.items() if key != "identity_sha256"
        })
        with self.assertRaisesRegex(
            RECEIPTS.ContractError, "ISOLATED_UAT_DATABASE_RECEIPT_SEMANTICS_INVALID",
        ):
            self.validate(altered)

        altered = copy.deepcopy(self.fixture)
        database = altered["intents"]["DATABASE_BOOTSTRAP"]
        inputs = {
            key: copy.deepcopy(database[key])
            for key in self.intent_policy["families"]["DATABASE_BOOTSTRAP"]["input_fields"]
        }
        inputs["database_cluster_identity"]["system_identifier"] = "18446744073709551616"
        altered["intents"]["DATABASE_BOOTSTRAP"] = INTENTS.build_intent(
            "DATABASE_BOOTSTRAP", inputs, self.intent_policy,
        )
        with self.assertRaisesRegex(
            RECEIPTS.ContractError, "ISOLATED_UAT_DATABASE_BOOTSTRAP_INTENT_INVALID",
        ):
            self.validate(altered)

    def test_bound_role_and_runtime_image_details_cannot_drift(self) -> None:
        altered = copy.deepcopy(self.fixture)
        observation = altered["evidence_payloads"]["runtime_privilege_observation"]
        observation["observed_login_roles"] = copy.deepcopy(
            observation["observed_login_roles"]
        )
        observation["observed_login_roles"][0]["connection_limit"] += 1
        observation["evidence_sha256"] = canonical_sha256({
            key: value for key, value in observation.items() if key != "evidence_sha256"
        })
        with self.assertRaisesRegex(
            RECEIPTS.ContractError, "ISOLATED_UAT_RUNTIME_PRIVILEGE_RECEIPT_SEMANTICS_INVALID",
        ):
            self.validate(altered)

        altered = copy.deepcopy(self.fixture)
        containers = altered["evidence_payloads"]["container_identity_set"]
        containers["containers"]["web"]["image_config_digest"] = f"sha256:{'a' * 64}"
        containers["evidence_sha256"] = canonical_sha256({
            key: value for key, value in containers.items() if key != "evidence_sha256"
        })
        with self.assertRaisesRegex(
            RECEIPTS.ContractError, "ISOLATED_UAT_CONTAINER_IDENTITY_SEMANTICS_INVALID",
        ):
            self.validate(altered)

    def test_readiness_database_time_cannot_predate_runtime_privilege_completion(self) -> None:
        altered = copy.deepcopy(self.fixture)
        readiness = altered["receipts"]["readiness_receipt"]
        loopback = readiness["loopback"]
        loopback["health"]["database_time"] = "2026-08-24T10:05:59.000Z"
        loopback["health_sha256"] = canonical_sha256({
            "contract": "chenyida-erp-isolated-uat-normalized-health/v1",
            "health": loopback["health"],
        })
        loopback["probes"][0]["normalized_health_sha256"] = loopback["health_sha256"]
        loopback["probes"][2]["normalized_health_sha256"] = loopback["health_sha256"]
        readiness["receipt_sha256"] = canonical_sha256({
            key: value for key, value in readiness.items() if key != "receipt_sha256"
        })
        with self.assertRaisesRegex(
            RECEIPTS.ContractError, "ISOLATED_UAT_EVIDENCE_RECEIPT_SEMANTICS_INVALID",
        ):
            self.validate(altered)

    def test_publishers_and_runtime_backends_remain_unimplemented(self) -> None:
        self.assertFalse(self.receipt_policy["execution_authorized"])
        self.assertEqual(
            self.receipt_policy["capability_status"]["receipt_publishers"],
            "NOT_IMPLEMENTED",
        )
        self.assertEqual(
            self.receipt_policy["capability_status"]["external_anchor_validators"],
            "NOT_IMPLEMENTED",
        )
        with self.assertRaisesRegex(
            RECEIPTS.ContractError, "ISOLATED_UAT_RUNTIME_RECEIPT_PUBLISHER_NOT_IMPLEMENTED",
        ):
            RECEIPTS.require_receipt_publisher()


if __name__ == "__main__":
    unittest.main(verbosity=2)
