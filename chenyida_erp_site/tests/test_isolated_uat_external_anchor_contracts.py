#!/usr/bin/python3
"""Pure tests for isolated-UAT external anchor contracts."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import unittest
from pathlib import Path, PurePosixPath


SITE_ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = SITE_ROOT / "scripts/isolated-uat-external-anchor-contracts.py"
POLICY_PATH = SITE_ROOT / "operations/isolated-uat-external-anchor-policy-v1.json"


def load_module():
    specification = importlib.util.spec_from_file_location(
        "isolated_uat_external_anchor_contracts", MODULE_PATH,
    )
    if specification is None or specification.loader is None:
        raise RuntimeError("external anchor contracts cannot be loaded")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


MODULE = load_module()


def digest(value: dict, field: str) -> dict:
    value[field] = MODULE.canonical_sha256({key: item for key, item in value.items() if key != field})
    return value


def policy_and_sources() -> tuple[dict, dict[str, bytes]]:
    policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    sources = {
        item["path"]: (SITE_ROOT / item["path"]).read_bytes()
        for item in policy["source_closure"]["members"]
    }
    return policy, sources


def build_plan(policy: dict) -> dict:
    project = "chenyida-erp-uat-external-test"
    migration_entries = [
        {
            "ordinal": ordinal,
            "filename": path.name,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
        for ordinal, path in enumerate(sorted((SITE_ROOT / "drizzle-postgres").glob("*.sql")), 1)
    ]
    plan = {
        "schema_version": 4,
        "contract": MODULE.PLAN_CONTRACT,
        "entrypoint_id": MODULE.PLAN_ENTRYPOINT,
        "mode": "READ_ONLY_PLAN",
        "execution_authorized": False,
        "action_binding_id": MODULE.ACTION_BINDING_ID,
        "action_binding_sha256": MODULE.ACTION_BINDING_SHA256,
        "action_binding_status": MODULE.ACTION_BINDING_STATUS,
        "runtime_contract_policy_sha256": MODULE.RUNTIME_CONTRACT_POLICY_SHA256,
        "runtime_contract_source_closure_sha256": MODULE.RUNTIME_CONTRACT_SOURCE_CLOSURE_SHA256,
        "runtime_contract_capability_status": copy.deepcopy(MODULE.RUNTIME_CONTRACT_CAPABILITY_STATUS),
        "runtime_receipt_policy_sha256": MODULE.RUNTIME_RECEIPT_POLICY_SHA256,
        "runtime_receipt_source_closure_sha256": MODULE.RUNTIME_RECEIPT_SOURCE_CLOSURE_SHA256,
        "runtime_receipt_capability_status": copy.deepcopy(MODULE.RUNTIME_RECEIPT_CAPABILITY_STATUS),
        "runtime_receipt_validation_status": "NOT_RUN_NO_RECEIPTS",
        "runtime_receipt_success_output_contract": copy.deepcopy(MODULE.RUNTIME_RECEIPT_SUCCESS_OUTPUT_CONTRACT),
        "external_anchor_policy_sha256": policy["policy_sha256"],
        "external_anchor_source_closure_sha256": policy["source_closure"]["source_closure_sha256"],
        "external_anchor_capability_status": policy["capability_status"],
        "external_anchor_validation_status": "NOT_RUN_NO_EXTERNAL_EVIDENCE",
        "external_anchor_success_output_contract": policy["validation_output"],
        "receipt_chain_binding": copy.deepcopy(MODULE.RECEIPT_CHAIN_BINDING),
        "request_id": "uat-external-anchor-request-001",
        "policy_sha256": "f" * 64,
        "project": project,
        "roots": {
            key: value.format(project=project) for key, value in MODULE.ROOT_TEMPLATES.items()
        },
        "source": {
            "package_version": "0.1.0-alpha.47",
            "git_commit": "1" * 40,
            "git_tree": "2" * 40,
            "migration_current_head": "EMPTY",
            "migration_target_head": "0046_runtime_lock_privilege_boundary.sql",
            "migration_allowlist_sha256": MODULE.MIGRATION_ALLOWLIST_SHA256,
            "resolved_compose_sha256": "4" * 64,
        },
        "images": {
            "web": {
                "image_reference": f"example.invalid/web@sha256:{'5' * 64}",
                "config_digest": f"sha256:{'6' * 64}",
            },
            "worker": {
                "image_reference": f"example.invalid/worker@sha256:{'7' * 64}",
                "config_digest": f"sha256:{'8' * 64}",
            },
        },
        "ports": {"host_ip": "127.0.0.1", "web": 33001, "caddy_http": 33080, "caddy_https": 33443},
        "database": {
            "name": "chenyida_erp",
            "current_head": "EMPTY",
            "target_head": "0046_runtime_lock_privilege_boundary.sql",
            "technical_login_roles": [
                "chenyida_erp_admin", "chenyida_erp_backup", "chenyida_erp_owner",
                "chenyida_erp_web", "chenyida_erp_worker",
            ],
        },
        "migration_allowlist_entries": migration_entries,
        "actions": [
            {
                "ordinal": item[0], "action": item[1], "mutates_runtime": item[2],
                "handler_id": item[3], "adapter_method": item[4],
            }
            for item in MODULE.PLAN_ACTIONS
        ],
        "failure_boundary": {
            "cleanup_scope": "EXACT_PROJECT_NAMESPACE_ONLY",
            "recovery": "DISPOSABLE_SYNTHETIC_RECREATE_FROM_EMPTY",
            "quarantine_before_cleanup": True,
        },
        "forbidden_production_entrypoints": [
            "scripts/postgresql-runtime-privilege-runner.mjs",
            "scripts/release-supervisor-launcher.py",
        ],
    }
    digest(plan, "plan_sha256")
    return plan


def identity(index: int, profile: tuple[int, int, str]) -> dict:
    value = {
        "device": 100,
        "inode": 1000 + index,
        "uid": profile[0],
        "gid": profile[1],
        "mode": profile[2],
        "nlink": 2,
        "mount_id": 200,
        "mount_point": "/",
        "mount_root": "/",
        "mount_source": "/dev/vda1",
        "object_type": "DIRECTORY",
        "symlink": False,
    }
    return digest(value, "identity_sha256")


def fixture() -> dict:
    policy, sources = policy_and_sources()
    MODULE.validate_policy(policy, sources)
    plan = build_plan(policy)
    roots = []
    ancestor_identities = {}
    next_ancestor_identity = 100
    for index, (name, template) in enumerate(MODULE.ROOT_TEMPLATES.items(), 1):
        path = PurePosixPath(template.format(project=plan["project"]))
        ancestor_chain = []
        for ancestor_path in reversed(path.parents):
            key = str(ancestor_path)
            if key not in ancestor_identities:
                ancestor_identities[key] = identity(next_ancestor_identity, (0, 0, "0755"))
                next_ancestor_identity += 1
            ancestor_chain.append({
                "path": key,
                "identity": copy.deepcopy(ancestor_identities[key]),
            })
        roots.append({
            "name": name,
            "path": str(path),
            "ancestor_chain": ancestor_chain,
            "parent_identity_sha256": ancestor_chain[-1]["identity"]["identity_sha256"],
            "identity": identity(index, MODULE.ROOT_PROFILES[name]),
        })
    namespace = {
        "schema_version": 1,
        "contract": "chenyida-erp-isolated-uat-namespace-root-receipt/v1",
        "producer": {"ordinal": 2, "handler_id": "ISOLATED_UAT_HOST_ROOT_ADAPTER", "adapter_method": "prepare_private_namespace_roots"},
        "request_id": plan["request_id"],
        "project": plan["project"],
        "plan_sha256": plan["plan_sha256"],
        "roots": roots,
        "release_candidate_root_identity_sha256": roots[2]["identity"]["identity_sha256"],
        "one_shot_state_root_identity_sha256": roots[5]["identity"]["identity_sha256"],
        "observed_at": "2026-08-24T13:00:00.000Z",
    }
    digest(namespace, "receipt_sha256")
    root_ids = {item["name"]: item["identity"]["identity_sha256"] for item in roots}
    entries = []
    for index, item in enumerate(MODULE.CREDENTIALS, 1):
        identifier, consumer, root_name, filename, uid, gid, mode, kind = item
        entry = {
            "credential_id": identifier,
            "consumer": consumer,
            "kind": kind,
            "root": root_name,
            "filename": filename,
            "path": f"{plan['roots'][root_name]}/{filename}",
            "root_identity_sha256": root_ids[root_name],
            "device": 100,
            "inode": 5000 + index,
            "uid": uid,
            "gid": gid,
            "mode": mode,
            "nlink": 1,
            "mount_id": 200,
            "mount_point": "/",
            "mount_root": "/",
            "mount_source": "/dev/vda1",
            "size": 128 if kind == "BACKUP_SERVICE_FILE" else 43,
            "object_type": "REGULAR_FILE",
            "symlink": False,
        }
        digest(entry, "source_identity_sha256")
        entries.append(entry)
    credentials = {
        "schema_version": 1,
        "contract": "chenyida-erp-isolated-uat-credential-generation-receipt/v1",
        "producer": {"ordinal": 3, "handler_id": "ISOLATED_UAT_CREDENTIAL_ADAPTER", "adapter_method": "provision_distinct_credential_files"},
        "request_id": plan["request_id"],
        "project": plan["project"],
        "plan_sha256": plan["plan_sha256"],
        "namespace_root_receipt_sha256": namespace["receipt_sha256"],
        "generation_id": "uat-credential-generation-001",
        "password_format": "32_BYTE_CSPRNG_CANONICAL_BASE64URL",
        "entries": entries,
        "all_values_distinct": True,
        "value_observation_status": "PRODUCER_ASSERTED_NOT_REVALIDATED_WITHOUT_SECRET_EXPOSURE",
        "secret_material_in_receipt": False,
        "observed_at": "2026-08-24T13:00:01.000Z",
    }
    digest(credentials, "receipt_sha256")
    container = {
        "schema_version": 1,
        "contract": "chenyida-erp-isolated-uat-postgres-container-identity/v1",
        "producer": {"ordinal": 4, "handler_id": "ISOLATED_UAT_COMPOSE_ADAPTER", "adapter_method": "start_postgres_only"},
        "request_id": plan["request_id"],
        "project": plan["project"],
        "plan_sha256": plan["plan_sha256"],
        "credential_generation_receipt_sha256": credentials["receipt_sha256"],
        "resolved_compose_sha256": plan["source"]["resolved_compose_sha256"],
        "service": "postgres",
        "compose_project": plan["project"],
        "container_id": "9" * 64,
        "image_reference": policy["invariants"]["postgres_image_reference"],
        "image_config_digest": policy["invariants"]["postgres_image_config_digest"],
        "network_observation_status": "COMPLETE_DOCKER_INSPECT_NETWORKS_AND_PORT_BINDINGS",
        "network_mode": f"{plan['project']}_backend",
        "networks": [
            {"name": f"{plan['project']}_backend", "internal": True, "network_id": "b" * 64},
        ],
        "published_ports": [],
        "mount_observation_status": "COMPLETE_DOCKER_INSPECT_MOUNTS_AND_HOSTCONFIG_TMPFS",
        "mounts": [
            {
                "type": "VOLUME",
                "source": f"{plan['project']}_erp_postgres",
                "target": "/var/lib/postgresql/data",
                "read_only": False,
                "driver": "local",
                "source_identity_sha256": "c" * 64,
            },
            {
                "type": "VOLUME",
                "source": f"{plan['project']}_erp_postgres_tablespaces",
                "target": "/var/lib/postgresql/tablespaces",
                "read_only": False,
                "driver": "local",
                "source_identity_sha256": "d" * 64,
            },
            {
                "type": "BIND",
                "source": next(
                    item["path"] for item in entries
                    if item["credential_id"] == "POSTGRES_BOOTSTRAP_PASSWORD"
                ),
                "target": "/run/chenyida-erp-secrets/postgres-bootstrap-password",
                "read_only": True,
                "driver": None,
                "source_identity_sha256": next(
                    item["source_identity_sha256"] for item in entries
                    if item["credential_id"] == "POSTGRES_BOOTSTRAP_PASSWORD"
                ),
            },
        ],
        "tmpfs_mounts": [
            {"target": "/tmp", "options": "rw,nosuid,nodev,noexec,size=32m,mode=1777"},
            {
                "target": "/run/chenyida-erp-secrets",
                "options": "rw,nosuid,nodev,noexec,size=1m,uid=0,gid=0,mode=0555",
            },
            {
                "target": "/var/run/postgresql",
                "options": "rw,nosuid,nodev,noexec,size=16m,uid=999,gid=999,mode=3775",
            },
        ],
        "runtime_secret_root_identity_sha256": root_ids["runtime_secret_root"],
        "running": True,
        "health": "healthy",
        "observed_at": "2026-08-24T13:00:02.000Z",
    }
    digest(container, "identity_sha256")
    projection = {
        "project": plan["project"],
        "postgres_container_identity_sha256": container["identity_sha256"],
        "system_identifier": "7429384756102938475",
    }
    cluster = {
        "schema_version": 1,
        "contract": "chenyida-erp-isolated-uat-database-cluster-identity/v1",
        "producer": {"ordinal": 4, "handler_id": "ISOLATED_UAT_COMPOSE_ADAPTER", "adapter_method": "start_postgres_only"},
        "request_id": plan["request_id"],
        "project": plan["project"],
        "plan_sha256": plan["plan_sha256"],
        "credential_generation_receipt_sha256": credentials["receipt_sha256"],
        "postgres_container_identity_sha256": container["identity_sha256"],
        "database_name": "chenyida_erp",
        "system_identifier": projection["system_identifier"],
        "identity": projection,
        "identity_sha256": MODULE.canonical_sha256(projection),
        "observed_at": "2026-08-24T13:00:03.000Z",
    }
    digest(cluster, "receipt_sha256")
    return {
        "control_plan": plan,
        "namespace_root_receipt": namespace,
        "credential_generation_receipt": credentials,
        "postgres_container_identity": container,
        "database_cluster_identity": cluster,
        "policy": policy,
    }


class IsolatedUatExternalAnchorContractsTest(unittest.TestCase):
    def validate(self, value: dict | None = None) -> dict:
        return MODULE.validate_external_anchor_contracts(**(value or fixture()))

    def test_valid_contracts_are_deterministic_and_honest(self) -> None:
        value = fixture()
        first = self.validate(value)
        second = self.validate(copy.deepcopy(value))
        self.assertEqual(first, second)
        self.assertEqual(first["external_anchor_contract_status"], "PURE_EXTERNAL_ANCHOR_CONTRACTS_VALID")
        self.assertEqual(first["source_observation_status"], "SOURCE_CALLER_INJECTED_NOT_ATTESTED")
        self.assertEqual(first["runtime_evidence_status"], "NOT_ESTABLISHED_BY_PURE_VALIDATION")
        self.assertEqual(first["external_digest_anchors"]["credential_generation_receipt_sha256"], value["credential_generation_receipt"]["receipt_sha256"])
        self.assertEqual(first["external_digest_anchors"]["database_cluster_identity_sha256"], value["database_cluster_identity"]["identity_sha256"])

    def test_bound_policy_sources_and_fixed_plan_roots_fail_closed(self) -> None:
        policy, sources = policy_and_sources()
        tampered = copy.deepcopy(policy)
        tampered["upstream_bindings"][0]["sha256"] = "a" * 64
        digest(tampered, "policy_sha256")
        with self.assertRaisesRegex(MODULE.ContractError, "ISOLATED_UAT_EXTERNAL_POLICY_INVALID"):
            MODULE.validate_policy(tampered, sources)

        value = fixture()
        value["control_plan"]["action_binding_sha256"] = "b" * 64
        digest(value["control_plan"], "plan_sha256")
        with self.assertRaisesRegex(MODULE.ContractError, "ISOLATED_UAT_EXTERNAL_CONTROL_PLAN_INVALID"):
            self.validate(value)

        value = fixture()
        value["policy"]["invariants"]["postgres_image_reference"] = f"example.invalid/postgres@sha256:{'e' * 64}"
        digest(value["policy"], "policy_sha256")
        value["control_plan"]["external_anchor_policy_sha256"] = value["policy"]["policy_sha256"]
        digest(value["control_plan"], "plan_sha256")
        with self.assertRaisesRegex(MODULE.ContractError, "ISOLATED_UAT_EXTERNAL_POLICY_INVALID"):
            self.validate(value)

    def test_policy_source_bytes_are_explicitly_caller_injected_not_attested(self) -> None:
        policy, sources = policy_and_sources()
        caller_module = b"caller-injected-module-source\n"
        module_path = "scripts/isolated-uat-external-anchor-contracts.py"
        for member in policy["source_closure"]["members"]:
            if member["path"] == module_path:
                member["sha256"] = hashlib.sha256(caller_module).hexdigest()
        policy["source_closure"]["source_closure_sha256"] = MODULE.canonical_sha256({
            key: item
            for key, item in policy["source_closure"].items()
            if key != "source_closure_sha256"
        })
        digest(policy, "policy_sha256")
        sources[module_path] = caller_module
        accepted = MODULE.validate_policy(policy, sources)
        self.assertEqual(
            accepted["validation_output"]["source_observation_status"],
            "SOURCE_CALLER_INJECTED_NOT_ATTESTED",
        )

    def test_runtime_capabilities_success_and_receipt_chain_are_not_caller_redefinable(self) -> None:
        cases = (
            (
                "receipt_publisher",
                lambda plan: plan["runtime_receipt_capability_status"].update(
                    receipt_publishers="IMPLEMENTED",
                ),
            ),
            (
                "runtime_evidence",
                lambda plan: plan["runtime_receipt_success_output_contract"].update(
                    runtime_evidence_status="ESTABLISHED",
                ),
            ),
            (
                "receipt_chain",
                lambda plan: plan["receipt_chain_binding"].update(
                    internal_contract="caller-v99",
                ),
            ),
        )
        for name, mutate in cases:
            plan = build_plan(policy_and_sources()[0])
            mutate(plan)
            digest(plan, "plan_sha256")
            with self.subTest(name=name), self.assertRaisesRegex(
                MODULE.ContractError,
                "ISOLATED_UAT_EXTERNAL_CONTROL_PLAN_INVALID",
            ):
                MODULE.validate_control_plan(plan)

    def test_policy_sources_type_fails_with_stable_contract_code(self) -> None:
        policy, _ = policy_and_sources()
        for sources in (None, [], "caller-source"):
            with self.subTest(sources=type(sources).__name__), self.assertRaisesRegex(
                MODULE.ContractError,
                "ISOLATED_UAT_EXTERNAL_POLICY_INVALID",
            ):
                MODULE.validate_policy(policy, sources)

    def test_namespace_root_metadata_and_isolation_fail_closed(self) -> None:
        for name, mutate in (
            ("symlink", lambda value: value["namespace_root_receipt"]["roots"][0]["identity"].update(symlink=True)),
            ("mode", lambda value: value["namespace_root_receipt"]["roots"][2]["identity"].update(mode="0777")),
            ("identity_reuse", lambda value: value["namespace_root_receipt"]["roots"][1]["identity"].update({
                key: value["namespace_root_receipt"]["roots"][0]["identity"][key]
                for key in ("device", "inode")
            })),
        ):
            value = fixture()
            mutate(value)
            root = value["namespace_root_receipt"]["roots"][0 if name == "symlink" else 2 if name == "mode" else 1]
            digest(root["identity"], "identity_sha256")
            digest(value["namespace_root_receipt"], "receipt_sha256")
            with self.subTest(name=name), self.assertRaisesRegex(MODULE.ContractError, "ISOLATED_UAT_EXTERNAL_NAMESPACE_ROOT_RECEIPT_INVALID"):
                self.validate(value)

    def test_namespace_ancestor_chain_is_complete_and_symlink_free(self) -> None:
        for name, field, replacement in (
            ("symlink", "symlink", True),
            ("object_type", "object_type", "SYMLINK"),
        ):
            value = fixture()
            for root in value["namespace_root_receipt"]["roots"]:
                ancestor = root["ancestor_chain"][0]
                ancestor["identity"][field] = replacement
                digest(ancestor["identity"], "identity_sha256")
            digest(value["namespace_root_receipt"], "receipt_sha256")
            with self.subTest(name=name), self.assertRaisesRegex(
                MODULE.ContractError,
                "ISOLATED_UAT_EXTERNAL_NAMESPACE_ROOT_RECEIPT_INVALID",
            ):
                self.validate(value)

        for name, field, replacement in (
            ("world_writable", "mode", "0777"),
            ("non_root_owner", "uid", 1000),
        ):
            value = fixture()
            project_etc = f"/etc/{value['control_plan']['project']}"
            matched = 0
            for root in value["namespace_root_receipt"]["roots"]:
                for ancestor in root["ancestor_chain"]:
                    if ancestor["path"] == project_etc:
                        ancestor["identity"][field] = replacement
                        digest(ancestor["identity"], "identity_sha256")
                        matched += 1
            self.assertEqual(matched, 2)
            digest(value["namespace_root_receipt"], "receipt_sha256")
            with self.subTest(name=name), self.assertRaisesRegex(
                MODULE.ContractError,
                "ISOLATED_UAT_EXTERNAL_NAMESPACE_ROOT_RECEIPT_INVALID",
            ):
                self.validate(value)

        value = fixture()
        value["namespace_root_receipt"]["roots"][0]["ancestor_chain"].pop(1)
        digest(value["namespace_root_receipt"], "receipt_sha256")
        with self.assertRaisesRegex(MODULE.ContractError, "ISOLATED_UAT_EXTERNAL_NAMESPACE_ROOT_RECEIPT_INVALID"):
            self.validate(value)

        for name, field, replacement in (
            ("protected_mount_root", "mount_root", "/var/lib/chenyida-erp"),
            ("protected_mount_source", "mount_source", "/var/lib/chenyida-erp"),
            ("double_slash_mount_root", "mount_root", "//var/lib/chenyida-erp"),
            ("double_slash_mount_source", "mount_source", "//var/lib/chenyida-erp"),
            (
                "parent_reference_mount_root",
                "mount_root",
                "/var/lib/placeholder/../chenyida-erp",
            ),
            (
                "parent_reference_mount_source",
                "mount_source",
                "/var/lib/placeholder/../chenyida-erp",
            ),
        ):
            value = fixture()
            root = value["namespace_root_receipt"]["roots"][0]
            root["identity"][field] = replacement
            digest(root["identity"], "identity_sha256")
            digest(value["namespace_root_receipt"], "receipt_sha256")
            with self.subTest(name=name), self.assertRaisesRegex(
                MODULE.ContractError,
                "ISOLATED_UAT_EXTERNAL_NAMESPACE_ROOT_RECEIPT_INVALID",
            ):
                self.validate(value)

        value = fixture()
        value["namespace_root_receipt"]["roots"][0]["parent_identity_sha256"] = "e" * 64
        digest(value["namespace_root_receipt"], "receipt_sha256")
        with self.assertRaisesRegex(MODULE.ContractError, "ISOLATED_UAT_EXTERNAL_NAMESPACE_ROOT_RECEIPT_INVALID"):
            self.validate(value)

        value = fixture()
        source = value["namespace_root_receipt"]["roots"][0]
        alias = value["namespace_root_receipt"]["roots"][1]
        alias["identity"].update({
            "device": source["identity"]["device"],
            "inode": source["identity"]["inode"],
            "mount_id": 201,
            "mount_point": alias["path"],
            "mount_root": source["path"],
        })
        digest(alias["identity"], "identity_sha256")
        digest(value["namespace_root_receipt"], "receipt_sha256")
        with self.assertRaisesRegex(
            MODULE.ContractError,
            "ISOLATED_UAT_EXTERNAL_NAMESPACE_ROOT_RECEIPT_INVALID",
        ):
            self.validate(value)

    def test_credentials_reject_secret_fields_mapping_drift_and_file_reuse(self) -> None:
        cases = []
        secret = fixture()
        secret["credential_generation_receipt"]["entries"][0]["secret_value"] = "forbidden"
        cases.append(("secret", secret))
        mapping = fixture()
        mapping["credential_generation_receipt"]["entries"][0]["consumer"] = "chenyida_erp_worker"
        digest(mapping["credential_generation_receipt"]["entries"][0], "source_identity_sha256")
        digest(mapping["credential_generation_receipt"], "receipt_sha256")
        cases.append(("mapping", mapping))
        reused = fixture()
        for field in ("device", "inode"):
            reused["credential_generation_receipt"]["entries"][1][field] = reused["credential_generation_receipt"]["entries"][0][field]
        digest(reused["credential_generation_receipt"]["entries"][1], "source_identity_sha256")
        digest(reused["credential_generation_receipt"], "receipt_sha256")
        cases.append(("reuse", reused))
        object_type = fixture()
        object_type["credential_generation_receipt"]["entries"][0]["object_type"] = "FIFO"
        digest(object_type["credential_generation_receipt"]["entries"][0], "source_identity_sha256")
        digest(object_type["credential_generation_receipt"], "receipt_sha256")
        cases.append(("object_type", object_type))
        protected_mount = fixture()
        protected_mount["credential_generation_receipt"]["entries"][0]["mount_root"] = "/etc/chenyida-erp"
        digest(protected_mount["credential_generation_receipt"]["entries"][0], "source_identity_sha256")
        digest(protected_mount["credential_generation_receipt"], "receipt_sha256")
        cases.append(("protected_mount", protected_mount))
        namespace_alias = fixture()
        namespace_identity = namespace_alias["namespace_root_receipt"]["roots"][0]["identity"]
        namespace_alias["credential_generation_receipt"]["entries"][0].update({
            "device": namespace_identity["device"],
            "inode": namespace_identity["inode"],
        })
        digest(
            namespace_alias["credential_generation_receipt"]["entries"][0],
            "source_identity_sha256",
        )
        digest(namespace_alias["credential_generation_receipt"], "receipt_sha256")
        cases.append(("namespace_alias", namespace_alias))
        for name, value in cases:
            with self.subTest(name=name), self.assertRaisesRegex(MODULE.ContractError, "ISOLATED_UAT_EXTERNAL_CREDENTIAL_RECEIPT_INVALID"):
                self.validate(value)

    def test_cross_plan_and_predecessor_splicing_fail_closed(self) -> None:
        value = fixture()
        value["credential_generation_receipt"]["plan_sha256"] = "c" * 64
        digest(value["credential_generation_receipt"], "receipt_sha256")
        with self.assertRaisesRegex(MODULE.ContractError, "ISOLATED_UAT_EXTERNAL_CREDENTIAL_RECEIPT_INVALID"):
            self.validate(value)

        value = fixture()
        value["postgres_container_identity"]["credential_generation_receipt_sha256"] = "d" * 64
        digest(value["postgres_container_identity"], "identity_sha256")
        with self.assertRaisesRegex(MODULE.ContractError, "ISOLATED_UAT_EXTERNAL_POSTGRES_CONTAINER_IDENTITY_INVALID"):
            self.validate(value)

    def test_container_identity_is_bound_to_compose_image_network_and_mounts(self) -> None:
        for name, field, replacement in (
            ("container", "container_id", "0" * 64),
            ("compose", "resolved_compose_sha256", "e" * 64),
            ("image", "image_reference", f"example.invalid/postgres@sha256:{'f' * 64}"),
            ("image_config", "image_config_digest", f"sha256:{'e' * 64}"),
        ):
            value = fixture()
            value["postgres_container_identity"][field] = replacement
            digest(value["postgres_container_identity"], "identity_sha256")
            with self.subTest(name=name), self.assertRaisesRegex(MODULE.ContractError, "ISOLATED_UAT_EXTERNAL_POSTGRES_CONTAINER_IDENTITY_INVALID"):
                self.validate(value)

        value = fixture()
        value["postgres_container_identity"]["mounts"][0]["source"] = "chenyida-erp-parallel_erp_postgres"
        digest(value["postgres_container_identity"], "identity_sha256")
        with self.assertRaisesRegex(MODULE.ContractError, "ISOLATED_UAT_EXTERNAL_POSTGRES_CONTAINER_IDENTITY_INVALID"):
            self.validate(value)

        for name, mutate in (
            (
                "extra_network",
                lambda container: container["networks"].append({
                    "name": f"{container['project']}_edge",
                    "internal": False,
                    "network_id": "e" * 64,
                }),
            ),
            (
                "published_port",
                lambda container: container["published_ports"].append({
                    "host_ip": "127.0.0.1",
                    "host_port": 55432,
                    "container_port": 5432,
                    "protocol": "tcp",
                }),
            ),
            ("host_network", lambda container: container.update(network_mode="host")),
        ):
            value = fixture()
            mutate(value["postgres_container_identity"])
            digest(value["postgres_container_identity"], "identity_sha256")
            with self.subTest(name=name), self.assertRaisesRegex(
                MODULE.ContractError,
                "ISOLATED_UAT_EXTERNAL_POSTGRES_CONTAINER_IDENTITY_INVALID",
            ):
                self.validate(value)

        for name, mutate in (
            (
                "extra_bind",
                lambda container: container["mounts"].append({
                    "type": "BIND",
                    "source": "/var/run/docker.sock",
                    "target": "/var/run/docker.sock",
                    "read_only": False,
                    "driver": None,
                    "source_identity_sha256": "e" * 64,
                }),
            ),
            (
                "secret_source",
                lambda container: container["mounts"][2].update(
                    source="/etc/chenyida-erp/runtime-secrets/postgres-bootstrap-password",
                ),
            ),
            (
                "secret_target",
                lambda container: container["mounts"][2].update(
                    target="/run/secrets/postgres-bootstrap-password",
                ),
            ),
            (
                "secret_writable",
                lambda container: container["mounts"][2].update(read_only=False),
            ),
            (
                "tmpfs_drift",
                lambda container: container["tmpfs_mounts"][1].update(
                    options="rw,size=1m,mode=0777",
                ),
            ),
        ):
            value = fixture()
            mutate(value["postgres_container_identity"])
            digest(value["postgres_container_identity"], "identity_sha256")
            with self.subTest(name=name), self.assertRaisesRegex(
                MODULE.ContractError,
                "ISOLATED_UAT_EXTERNAL_POSTGRES_CONTAINER_IDENTITY_INVALID",
            ):
                self.validate(value)

    def test_cluster_identity_projection_and_system_identifier_fail_closed(self) -> None:
        for name, system_identifier in (
            ("zero", "0000000000"),
            ("overflow", "18446744073709551616"),
        ):
            value = fixture()
            value["database_cluster_identity"]["system_identifier"] = system_identifier
            value["database_cluster_identity"]["identity"]["system_identifier"] = system_identifier
            value["database_cluster_identity"]["identity_sha256"] = MODULE.canonical_sha256(value["database_cluster_identity"]["identity"])
            digest(value["database_cluster_identity"], "receipt_sha256")
            with self.subTest(name=name), self.assertRaisesRegex(MODULE.ContractError, "ISOLATED_UAT_EXTERNAL_DATABASE_CLUSTER_IDENTITY_INVALID"):
                self.validate(value)

    def test_observation_times_are_canonical_and_monotonic(self) -> None:
        value = fixture()
        value["database_cluster_identity"]["observed_at"] = "2026-08-24T12:59:59.000Z"
        digest(value["database_cluster_identity"], "receipt_sha256")
        with self.assertRaisesRegex(MODULE.ContractError, "ISOLATED_UAT_EXTERNAL_TIME_INVALID"):
            self.validate(value)

        value = fixture()
        value["namespace_root_receipt"]["observed_at"] = "2026-08-24T13:00:00Z"
        digest(value["namespace_root_receipt"], "receipt_sha256")
        with self.assertRaisesRegex(MODULE.ContractError, "ISOLATED_UAT_EXTERNAL_NAMESPACE_ROOT_RECEIPT_INVALID"):
            self.validate(value)

    def test_publisher_is_explicitly_unimplemented(self) -> None:
        with self.assertRaisesRegex(MODULE.ContractError, "ISOLATED_UAT_EXTERNAL_ANCHOR_PUBLISHER_NOT_IMPLEMENTED"):
            MODULE.require_external_anchor_publisher()


if __name__ == "__main__":
    unittest.main(verbosity=2)
