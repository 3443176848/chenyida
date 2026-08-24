#!/usr/bin/python3
"""Pure tests for the isolated-UAT Caddy Host/SNI intent contracts."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import unittest
from pathlib import Path


SITE_ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = SITE_ROOT / "scripts/isolated-uat-caddy-host-sni-contracts.py"
POLICY_PATH = SITE_ROOT / "operations/isolated-uat-caddy-host-sni-policy-v1.json"
BASE_MODULE_PATH = SITE_ROOT / "scripts/isolated-uat-runtime-contracts.py"
BASE_POLICY_PATH = SITE_ROOT / "operations/isolated-uat-runtime-contract-policy-v1.json"


def load_module(name: str, path: Path):
    specification = importlib.util.spec_from_file_location(name, path)
    if specification is None or specification.loader is None:
        raise RuntimeError(f"{name} cannot be loaded")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


CONTRACTS = load_module("isolated_uat_caddy_host_sni_contracts_test", MODULE_PATH)
BASE_CONTRACTS = load_module("isolated_uat_runtime_contracts_caddy_test", BASE_MODULE_PATH)


def rehash(value: dict, field: str) -> dict:
    value[field] = CONTRACTS.canonical_sha256({
        key: item for key, item in value.items() if key != field
    })
    return value


def policy_and_sources() -> tuple[dict, dict[str, bytes]]:
    policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    sources = {
        member["path"]: (SITE_ROOT / member["path"]).read_bytes()
        for member in policy["source_closure"]["members"]
    }
    return policy, sources


def expectation_inputs() -> dict:
    return {
        "request_id": "uat-caddy-host-sni-request-001",
        "project": "chenyida-erp-uat-caddy-contract-test",
        "resolved_compose_sha256": "c" * 64,
        "runtime_contract_policy_sha256": CONTRACTS.UPSTREAM_BINDINGS[0][
            "policy_sha256"
        ],
        "runtime_receipt_policy_sha256": CONTRACTS.UPSTREAM_BINDINGS[1][
            "policy_sha256"
        ],
        "ports": {
            "host_ip": "127.0.0.1",
            "web": 33001,
            "caddy_http": 33080,
            "caddy_https": 33443,
        },
    }


def plan_chain(expectation: dict, policy: dict) -> dict[str, dict]:
    external_body = {
        field: f"opaque-{field}"
        for field in CONTRACTS.BASE_PLAN_FIELDS - {"plan_sha256"}
    }
    external_body.update(CONTRACTS.EXTERNAL_PLAN_IDENTITY)
    external_body.update({
        "mode": "READ_ONLY_PLAN",
        "execution_authorized": False,
        "runtime_contract_policy_sha256": expectation[
            "runtime_contract_policy_sha256"
        ],
        "runtime_receipt_policy_sha256": expectation[
            "runtime_receipt_policy_sha256"
        ],
        "request_id": expectation["request_id"],
        "project": expectation["project"],
        "ports": copy.deepcopy(expectation["ports"]),
        "source": {
            "package_version": "0.1.0-alpha.47",
            "git_commit": "1" * 40,
            "git_tree": "2" * 40,
            "migration_current_head": "EMPTY",
            "migration_target_head": "0046_runtime_lock_privilege_boundary.sql",
            "migration_allowlist_sha256": (
                "8bb2b2d662df03e397d49c4ed5d11f1af1a9406ecbaff37aee8fc0d2d7388eed"
            ),
            "resolved_compose_sha256": expectation["resolved_compose_sha256"],
        },
        "images": {
            "web": {
                "image_reference": f"example.invalid/erp-web@sha256:{'4' * 64}",
                "config_digest": f"sha256:{'5' * 64}",
            },
            "worker": {
                "image_reference": f"example.invalid/erp-worker@sha256:{'6' * 64}",
                "config_digest": f"sha256:{'7' * 64}",
            },
        },
        "actions": copy.deepcopy(CONTRACTS.PLAN_ACTIONS),
        "forbidden_production_entrypoints": [
            "scripts/postgresql-runtime-privilege-runner.mjs",
            "scripts/release-supervisor-launcher.py",
        ],
    })
    external = {
        **external_body,
        "plan_sha256": CONTRACTS.canonical_sha256(external_body),
    }

    owner_body = copy.deepcopy(external_body)
    owner_body.update(CONTRACTS.OWNER_PLAN_IDENTITY)
    owner_body.update({
        "owner_completion_policy_sha256": "4" * 64,
        "owner_completion_source_closure_sha256": "5" * 64,
        "owner_completion_capability_status": {"execution_authorized": False},
        "owner_completion_validation_status": "NOT_RUN_NO_OWNER_COMPLETION_LOG",
        "owner_completion_success_output_contract": {"runtime_evidence_status": "NOT_ESTABLISHED"},
        "owner_completion_binding": {"contract": "owner-completion-v1"},
        "external_anchor_base_plan_sha256": external["plan_sha256"],
    })
    owner = {
        **owner_body,
        "plan_sha256": CONTRACTS.canonical_sha256(owner_body),
    }

    active_body = copy.deepcopy(owner_body)
    active_body.update(CONTRACTS.ACTIVE_PLAN_IDENTITY)
    active_body["action_binding_sha256"] = "6" * 64
    active_body.update({
        "host_sni_policy_sha256": policy["policy_sha256"],
        "host_sni_source_closure_sha256": policy["source_closure"][
            "source_closure_sha256"
        ],
        "host_sni_capability_status": copy.deepcopy(policy["capability_status"]),
        "host_sni_expectation_validation_status": "STRUCTURE_VALID",
        "host_sni_evidence_intent_v2_validation_status": (
            "NOT_RUN_NO_BASE_EVIDENCE_INTENT"
        ),
        "host_sni_success_output_contract": copy.deepcopy(policy["validation_output"]),
        "caddy_host_sni_binding": {
            "policy_contract": CONTRACTS.POLICY_CONTRACT,
            "expectation_contract": CONTRACTS.EXPECTATION_CONTRACT,
            "evidence_intent_v2_contract": CONTRACTS.EVIDENCE_INTENT_CONTRACT,
            "expectation_action_ordinal": 8,
            "evidence_action_ordinal": 9,
            "legacy_receipt_chain_status": "NOT_VALIDATED_MISSING_BOUND_SERVER_NAME",
            "runtime_fact_status": "NOT_ESTABLISHED_BY_PURE_VALIDATION",
        },
        "caddy_host_sni_expectation": copy.deepcopy(expectation),
        "owner_completion_base_plan_sha256": owner["plan_sha256"],
    })
    active = {
        **active_body,
        "plan_sha256": CONTRACTS.canonical_sha256(active_body),
    }
    return {
        "active_control_plan": active,
        "owner_completion_base_plan": owner,
        "external_anchor_base_plan": external,
    }


def base_evidence_intent(
    expectation: dict,
    external_anchor_base_plan_sha256: str,
) -> dict:
    policy = json.loads(BASE_POLICY_PATH.read_text(encoding="utf-8"))
    project = expectation["project"]
    images = {
        "web": {
            "image_reference": f"example.invalid/erp-web@sha256:{'4' * 64}",
            "image_config_digest": f"sha256:{'5' * 64}",
        },
        "worker": {
            "image_reference": f"example.invalid/erp-worker@sha256:{'6' * 64}",
            "image_config_digest": f"sha256:{'7' * 64}",
        },
    }
    containers = {
        "postgres": {
            "project": project,
            "container_id": "postgres-container-001",
            "image_reference": f"postgres@sha256:{'3' * 64}",
            "image_config_digest": f"sha256:{'3' * 64}",
        },
        "caddy": {
            "project": project,
            "container_id": "caddy-container-001",
            "image_reference": f"caddy@sha256:{'8' * 64}",
            "image_config_digest": f"sha256:{'8' * 64}",
        },
        "web": {
            "project": project,
            "container_id": "web-container-001",
            **images["web"],
        },
        "worker": {
            "project": project,
            "container_id": "worker-container-001",
            **images["worker"],
        },
    }
    value = BASE_CONTRACTS.build_intent("EVIDENCE", {
        "operation_id": "uat-caddy-host-sni-operation-001",
        "request_id": expectation["request_id"],
        "project": project,
        "plan_sha256": external_anchor_base_plan_sha256,
        "runtime_contract_policy_sha256": policy["policy_sha256"],
        "source_closure_sha256": policy["source_closure"][
            "source_closure_sha256"
        ],
        "release_candidate_receipt_sha256": "9" * 64,
        "migration_execution_receipt_sha256": "a" * 64,
        "runtime_privilege_receipt_sha256": "b" * 64,
        "runtime_source": {
            "package_version": "0.1.0-alpha.47",
            "git_commit": "1" * 40,
            "git_tree": "2" * 40,
            "migration_head": "0046_runtime_lock_privilege_boundary.sql",
            "migration_allowlist_sha256": (
                "8bb2b2d662df03e397d49c4ed5d11f1af1a9406ecbaff37aee8fc0d2d7388eed"
            ),
            "resolved_compose_sha256": expectation["resolved_compose_sha256"],
        },
        "containers": containers,
        "loopback": {
            "host": expectation["ports"]["host_ip"],
            "web": expectation["ports"]["web"],
            "caddy_http": expectation["ports"]["caddy_http"],
            "caddy_https": expectation["ports"]["caddy_https"],
        },
        "release_identity_reader_gid": 65532,
        "one_shot_state_root_identity_sha256": "d" * 64,
    }, policy)
    return BASE_CONTRACTS.validate_intent("EVIDENCE", value, policy)


def fixture() -> dict:
    policy, sources = policy_and_sources()
    CONTRACTS.validate_policy(policy, sources)
    expectation = CONTRACTS.build_expectation(expectation_inputs(), policy, sources)
    plans = plan_chain(expectation, policy)
    plans = {
        **plans,
        "active_control_plan_sha256": plans["active_control_plan"]["plan_sha256"],
        "owner_completion_base_plan_sha256": plans[
            "owner_completion_base_plan"
        ]["plan_sha256"],
        "external_anchor_base_plan_sha256": plans[
            "external_anchor_base_plan"
        ]["plan_sha256"],
    }
    evidence = CONTRACTS.build_evidence_intent_v2({
        **plans,
        "host_sni_expectation": expectation,
        "base_evidence_intent": base_evidence_intent(
            expectation,
            plans["external_anchor_base_plan_sha256"],
        ),
    }, policy, sources)
    return {
        "policy": policy,
        "sources": sources,
        "expectation": expectation,
        "evidence_intent_v2": evidence,
        **plans,
    }


class IsolatedUatCaddyHostSniContractsTest(unittest.TestCase):
    def test_policy_and_source_closure_are_current_and_honest(self) -> None:
        policy, sources = policy_and_sources()
        first = CONTRACTS.validate_policy(policy, sources)
        second = CONTRACTS.validate_policy(copy.deepcopy(policy), dict(sources))
        self.assertEqual(first, second)
        self.assertFalse(first["execution_authorized"])
        self.assertFalse(first["capability_status"]["execution_authorized"])
        self.assertEqual(first["capability_status"]["publisher"], "NOT_IMPLEMENTED")
        self.assertEqual(
            first["validation_output"]["runtime_evidence_status"],
            "NOT_ESTABLISHED_BY_PURE_VALIDATION",
        )
        self.assertEqual(
            set(sources),
            set(CONTRACTS.SOURCE_USAGE),
        )
        self.assertIn("deploy/Caddyfile", sources)
        for binding in CONTRACTS.UPSTREAM_BINDINGS:
            self.assertEqual(
                hashlib.sha256(sources[binding["path"]]).hexdigest(),
                binding["raw_sha256"],
            )

        altered_sources = dict(sources)
        altered_sources["deploy/Caddyfile"] += b"\n"
        with self.assertRaisesRegex(
            CONTRACTS.ContractError,
            "ISOLATED_UAT_CADDY_HOST_SNI_SOURCE_CLOSURE_INVALID",
        ):
            CONTRACTS.validate_policy(policy, altered_sources)

    def test_policy_semantics_and_source_usage_cannot_be_resigned(self) -> None:
        policy, sources = policy_and_sources()
        altered = copy.deepcopy(policy)
        altered["capability_status"]["publisher"] = "IMPLEMENTED"
        rehash(altered, "policy_sha256")
        with self.assertRaisesRegex(
            CONTRACTS.ContractError,
            "ISOLATED_UAT_CADDY_HOST_SNI_POLICY_INVALID",
        ):
            CONTRACTS.validate_policy(altered, sources)

        altered = copy.deepcopy(policy)
        altered_sources = dict(sources)
        upstream_path = CONTRACTS.UPSTREAM_BINDINGS[0]["path"]
        altered_sources[upstream_path] += b"\n"
        member = next(
            item for item in altered["source_closure"]["members"]
            if item["path"] == upstream_path
        )
        member["sha256"] = hashlib.sha256(altered_sources[upstream_path]).hexdigest()
        rehash(altered["source_closure"], "source_closure_sha256")
        rehash(altered, "policy_sha256")
        with self.assertRaisesRegex(
            CONTRACTS.ContractError,
            "ISOLATED_UAT_CADDY_HOST_SNI_POLICY_INVALID",
        ):
            CONTRACTS.validate_policy(altered, altered_sources)

        fake = {
            "policy_sha256": "a" * 64,
            "source_closure": {"source_closure_sha256": "b" * 64},
        }
        with self.assertRaisesRegex(
            CONTRACTS.ContractError,
            "ISOLATED_UAT_CADDY_HOST_SNI_POLICY_INVALID",
        ):
            CONTRACTS.build_expectation(expectation_inputs(), fake, sources)

        altered = copy.deepcopy(policy)
        member = next(
            item for item in altered["source_closure"]["members"]
            if item["path"] == "deploy/Caddyfile"
        )
        member["usage"] = "RUNTIME_TLS_OBSERVER"
        rehash(altered["source_closure"], "source_closure_sha256")
        rehash(altered, "policy_sha256")
        with self.assertRaisesRegex(
            CONTRACTS.ContractError,
            "ISOLATED_UAT_CADDY_HOST_SNI_SOURCE_CLOSURE_INVALID",
        ):
            CONTRACTS.validate_policy(altered, sources)

        altered = copy.deepcopy(policy)
        altered["upstream_bindings"][0]["raw_sha256"] = "a" * 64
        rehash(altered, "policy_sha256")
        with self.assertRaisesRegex(
            CONTRACTS.ContractError,
            "ISOLATED_UAT_CADDY_HOST_SNI_POLICY_INVALID",
        ):
            CONTRACTS.validate_policy(altered, sources)

    def test_expectation_is_deterministic_and_binds_localhost_sni_origin(self) -> None:
        policy, sources = policy_and_sources()
        first = CONTRACTS.build_expectation(expectation_inputs(), policy, sources)
        second = CONTRACTS.build_expectation(
            copy.deepcopy(expectation_inputs()), policy, sources,
        )
        self.assertEqual(first, second)
        self.assertEqual(CONTRACTS.validate_expectation(first, policy, sources), first)
        self.assertEqual(first["caddy_configuration"], {
            "ERP_DOMAIN": "localhost",
            "ERP_HTTPS_PORT": "443",
            "ERP_PUBLIC_ORIGIN": "https://localhost:33443",
            "ERP_UAT_ALLOW_LOOPBACK_ORIGIN": "true",
            "materialization_status": (
                "STATIC_CONFIG_CONTRACT_BOUND_RUNTIME_NOT_OBSERVED"
            ),
        })
        self.assertEqual(first["endpoint_binding"], {
            "connect_host": "127.0.0.1",
            "server_name": "localhost",
            "tls_server_name": "localhost",
            "http_authority": "localhost:33080",
            "https_authority": "localhost:33443",
            "public_origin": "https://localhost:33443",
            "web_direct_port_role": (
                "LOOPBACK_OPERATIONS_PROBE_NOT_PUBLIC_ORIGIN"
            ),
        })
        self.assertEqual(first["probe_intent"][0]["host_header"], "localhost:33080")
        self.assertEqual(
            first["probe_intent"][0]["desired_location"],
            "https://localhost:33443/api/health",
        )
        self.assertEqual(first["probe_intent"][1]["host_header"], "localhost:33443")
        self.assertEqual(first["probe_intent"][1]["tls_server_name"], "localhost")
        self.assertFalse(first["probe_intent"][1]["insecure_skip_verify"])
        self.assertFalse(first["probe_intent"][1]["leaf_digest_only_sufficient"])
        self.assertEqual(first["runtime_evidence_status"], "NOT_ESTABLISHED_BY_PURE_VALIDATION")

    def test_expectation_input_boundaries_fail_closed(self) -> None:
        policy, sources = policy_and_sources()
        cases: list[tuple[str, object]] = []

        def add(name: str, mutate) -> None:
            value = expectation_inputs()
            mutate(value)
            cases.append((name, value))

        add("wrong host", lambda value: value["ports"].update(host_ip="localhost"))
        add("duplicate port", lambda value: value["ports"].update(caddy_http=33001))
        add("production web port", lambda value: value["ports"].update(web=3000))
        add("privileged port", lambda value: value["ports"].update(caddy_https=443))
        add("boolean port", lambda value: value["ports"].update(caddy_https=True))
        add("zero compose", lambda value: value.update(resolved_compose_sha256="0" * 64))
        add("wrong intent root", lambda value: value.update(runtime_contract_policy_sha256="a" * 64))
        add("wrong receipt root", lambda value: value.update(runtime_receipt_policy_sha256="b" * 64))
        add("production project", lambda value: value.update(project="chenyida-erp"))
        add("extra field", lambda value: value.update(staff_count=2))

        for name, value in cases:
            with self.subTest(name=name), self.assertRaisesRegex(
                CONTRACTS.ContractError,
                "ISOLATED_UAT_CADDY_HOST_SNI_EXPECTATION_INVALID",
            ):
                CONTRACTS.build_expectation(value, policy, sources)

    def test_expectation_tampering_is_rejected_even_after_self_rehash(self) -> None:
        policy, sources = policy_and_sources()
        original = CONTRACTS.build_expectation(expectation_inputs(), policy, sources)
        mutators = (
            lambda value: value["caddy_configuration"].update(ERP_DOMAIN="erp.invalid"),
            lambda value: value["caddy_configuration"].update(
                ERP_PUBLIC_ORIGIN="http://127.0.0.1:33001",
            ),
            lambda value: value["endpoint_binding"].update(tls_server_name="127.0.0.1"),
            lambda value: value["endpoint_binding"].update(https_authority="localhost:443"),
            lambda value: value["probe_intent"][0].update(host_header="erp.invalid:33080"),
            lambda value: value["probe_intent"][0].update(
                desired_location="https://erp.invalid/api/health",
            ),
            lambda value: value["probe_intent"][1].update(insecure_skip_verify=True),
            lambda value: value["probe_intent"][1].update(
                leaf_digest_only_sufficient=True,
            ),
            lambda value: value.update(runtime_evidence_status="ESTABLISHED"),
        )
        for mutator in mutators:
            altered = copy.deepcopy(original)
            mutator(altered)
            rehash(altered, "expectation_sha256")
            with self.assertRaisesRegex(
                CONTRACTS.ContractError,
                "ISOLATED_UAT_CADDY_HOST_SNI_EXPECTATION_INVALID",
            ):
                CONTRACTS.validate_expectation(altered, policy, sources)

    def test_base_evidence_v1_is_fully_revalidated_before_v2(self) -> None:
        value = fixture()
        policy = value["policy"]
        sources = value["sources"]
        evidence = value["evidence_intent_v2"]
        self.assertEqual(
            CONTRACTS.validate_evidence_intent_v2(evidence, policy, sources), evidence,
        )
        base = evidence["base_evidence_intent"]
        self.assertEqual(
            BASE_CONTRACTS.validate_intent(
                "EVIDENCE",
                base,
                json.loads(BASE_POLICY_PATH.read_text(encoding="utf-8")),
            ),
            base,
        )

        mutators = (
            lambda item: item.update(plan_sha256="2" * 64),
            lambda item: item.update(project="chenyida-erp-uat-other"),
            lambda item: item["loopback"].update(host="127.0.0.2"),
            lambda item: item["loopback"].update(caddy_https=33444),
            lambda item: item["runtime_source"].update(git_commit="0" * 40),
            lambda item: item["runtime_source"].update(resolved_compose_sha256="2" * 64),
            lambda item: item["containers"]["caddy"].update(project="chenyida-erp-uat-other"),
            lambda item: item["containers"]["web"].update(image_reference="example.invalid/web:latest"),
            lambda item: item["containers"]["worker"].update(
                image_config_digest=f"sha256:{'0' * 64}",
            ),
            lambda item: item.update(release_identity_reader_gid=1000),
            lambda item: item.update(execution_status="EXECUTED"),
        )
        for mutator in mutators:
            altered_base = copy.deepcopy(base)
            mutator(altered_base)
            rehash(altered_base, "intent_sha256")
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
                "host_sni_expectation": value["expectation"],
                "base_evidence_intent": altered_base,
            }
            with self.assertRaisesRegex(
                CONTRACTS.ContractError,
                "ISOLATED_UAT_CADDY_HOST_SNI_BASE_EVIDENCE_INTENT_INVALID",
            ):
                CONTRACTS.build_evidence_intent_v2(inputs, policy, sources)

    def test_evidence_v2_preserves_three_distinct_plan_digest_layers(self) -> None:
        value = fixture()
        evidence = value["evidence_intent_v2"]
        plans = [
            evidence["active_control_plan_sha256"],
            evidence["owner_completion_base_plan_sha256"],
            evidence["external_anchor_base_plan_sha256"],
        ]
        self.assertEqual(len(set(plans)), 3)
        self.assertEqual(
            evidence["base_evidence_intent"]["plan_sha256"],
            evidence["external_anchor_base_plan_sha256"],
        )
        self.assertEqual(
            evidence["plan_chain_validation_status"],
            "ROLE_IDENTITY_AND_DIGEST_PROJECTION_VALID_"
            "FULL_ACTIVE_PLAN_SEMANTICS_NOT_REVALIDATED",
        )

        expectation = value["expectation"]
        base = evidence["base_evidence_intent"]
        collapsed = {
            "active_control_plan_sha256": "e" * 64,
            "owner_completion_base_plan_sha256": "e" * 64,
            "external_anchor_base_plan_sha256": "e" * 64,
            "active_control_plan": value["active_control_plan"],
            "owner_completion_base_plan": value["owner_completion_base_plan"],
            "external_anchor_base_plan": value["external_anchor_base_plan"],
            "host_sni_expectation": expectation,
            "base_evidence_intent": base,
        }
        with self.assertRaisesRegex(
            CONTRACTS.ContractError,
            "ISOLATED_UAT_CADDY_HOST_SNI_EVIDENCE_INTENT_INVALID",
        ):
            CONTRACTS.build_evidence_intent_v2(
                collapsed, value["policy"], value["sources"],
            )

        swapped = {
            "active_control_plan_sha256": value["active_control_plan_sha256"],
            "owner_completion_base_plan_sha256": value[
                "external_anchor_base_plan_sha256"
            ],
            "external_anchor_base_plan_sha256": value[
                "owner_completion_base_plan_sha256"
            ],
            "active_control_plan": value["active_control_plan"],
            "owner_completion_base_plan": value["owner_completion_base_plan"],
            "external_anchor_base_plan": value["external_anchor_base_plan"],
            "host_sni_expectation": expectation,
            "base_evidence_intent": base,
        }
        with self.assertRaisesRegex(
            CONTRACTS.ContractError,
            "ISOLATED_UAT_CADDY_HOST_SNI_PLAN_CHAIN_INVALID",
        ):
            CONTRACTS.build_evidence_intent_v2(
                swapped, value["policy"], value["sources"],
            )

        for left, right in (
            ("active_control_plan", "owner_completion_base_plan"),
            ("active_control_plan", "external_anchor_base_plan"),
        ):
            altered = copy.deepcopy(evidence)
            altered[left], altered[right] = altered[right], altered[left]
            left_sha = f"{left}_sha256"
            right_sha = f"{right}_sha256"
            altered[left_sha], altered[right_sha] = altered[right_sha], altered[left_sha]
            rehash(altered, "intent_sha256")
            with self.subTest(left=left, right=right), self.assertRaisesRegex(
                CONTRACTS.ContractError,
                "ISOLATED_UAT_CADDY_HOST_SNI_PLAN_CHAIN_INVALID",
            ):
                CONTRACTS.validate_evidence_intent_v2(
                    altered, value["policy"], value["sources"],
                )

        altered = copy.deepcopy(evidence)
        altered["active_control_plan_sha256"], altered[
            "owner_completion_base_plan_sha256"
        ] = (
            altered["owner_completion_base_plan_sha256"],
            altered["active_control_plan_sha256"],
        )
        rehash(altered, "intent_sha256")
        with self.assertRaisesRegex(
            CONTRACTS.ContractError,
            "ISOLATED_UAT_CADDY_HOST_SNI_PLAN_CHAIN_INVALID",
        ):
            CONTRACTS.validate_evidence_intent_v2(
                altered, value["policy"], value["sources"],
            )

        resigned = {
            name: copy.deepcopy(value[name])
            for name in (
                "active_control_plan", "owner_completion_base_plan",
                "external_anchor_base_plan",
            )
        }
        changed_reference = f"example.invalid/other-web@sha256:{'9' * 64}"
        for plan in resigned.values():
            plan["images"]["web"]["image_reference"] = changed_reference
        rehash(resigned["external_anchor_base_plan"], "plan_sha256")
        resigned["owner_completion_base_plan"]["external_anchor_base_plan_sha256"] = (
            resigned["external_anchor_base_plan"]["plan_sha256"]
        )
        rehash(resigned["owner_completion_base_plan"], "plan_sha256")
        resigned["active_control_plan"]["external_anchor_base_plan_sha256"] = (
            resigned["external_anchor_base_plan"]["plan_sha256"]
        )
        resigned["active_control_plan"]["owner_completion_base_plan_sha256"] = (
            resigned["owner_completion_base_plan"]["plan_sha256"]
        )
        rehash(resigned["active_control_plan"], "plan_sha256")
        unchanged_base = copy.deepcopy(evidence["base_evidence_intent"])
        unchanged_base["plan_sha256"] = resigned["external_anchor_base_plan"][
            "plan_sha256"
        ]
        rehash(unchanged_base, "intent_sha256")
        resigned_inputs = {
            **resigned,
            "active_control_plan_sha256": resigned["active_control_plan"][
                "plan_sha256"
            ],
            "owner_completion_base_plan_sha256": resigned[
                "owner_completion_base_plan"
            ]["plan_sha256"],
            "external_anchor_base_plan_sha256": resigned[
                "external_anchor_base_plan"
            ]["plan_sha256"],
            "host_sni_expectation": value["expectation"],
            "base_evidence_intent": unchanged_base,
        }
        with self.assertRaisesRegex(
            CONTRACTS.ContractError,
            "ISOLATED_UAT_CADDY_HOST_SNI_PLAN_CHAIN_INVALID",
        ):
            CONTRACTS.build_evidence_intent_v2(
                resigned_inputs, value["policy"], value["sources"],
            )

    def test_evidence_v2_nested_and_top_level_self_resigning_is_rejected(self) -> None:
        value = fixture()
        policy = value["policy"]
        sources = value["sources"]
        original = value["evidence_intent_v2"]

        altered = copy.deepcopy(original)
        altered["host_sni_expectation"]["endpoint_binding"][
            "tls_server_name"
        ] = "erp.invalid"
        rehash(altered["host_sni_expectation"], "expectation_sha256")
        altered["host_sni_expectation_sha256"] = altered[
            "host_sni_expectation"
        ]["expectation_sha256"]
        rehash(altered, "intent_sha256")
        with self.assertRaisesRegex(
            CONTRACTS.ContractError,
            "ISOLATED_UAT_CADDY_HOST_SNI_EXPECTATION_INVALID",
        ):
            CONTRACTS.validate_evidence_intent_v2(altered, policy, sources)

        altered = copy.deepcopy(original)
        altered["base_evidence_intent"]["runtime_source"]["git_tree"] = "0" * 40
        rehash(altered["base_evidence_intent"], "intent_sha256")
        altered["base_evidence_intent_sha256"] = altered[
            "base_evidence_intent"
        ]["intent_sha256"]
        rehash(altered, "intent_sha256")
        with self.assertRaisesRegex(
            CONTRACTS.ContractError,
            "ISOLATED_UAT_CADDY_HOST_SNI_BASE_EVIDENCE_INTENT_INVALID",
        ):
            CONTRACTS.validate_evidence_intent_v2(altered, policy, sources)

        altered = copy.deepcopy(original)
        altered["certificate_hostname_validation_status"] = "MATCHED"
        rehash(altered, "intent_sha256")
        with self.assertRaisesRegex(
            CONTRACTS.ContractError,
            "ISOLATED_UAT_CADDY_HOST_SNI_EVIDENCE_INTENT_INVALID",
        ):
            CONTRACTS.validate_evidence_intent_v2(altered, policy, sources)

    def test_malformed_fields_and_non_finite_values_fail_stably(self) -> None:
        value = fixture()
        policy = value["policy"]
        sources = value["sources"]

        altered = copy.deepcopy(value["expectation"])
        altered["endpoint_binding"]["extra"] = "forbidden"
        with self.assertRaisesRegex(
            CONTRACTS.ContractError,
            "ISOLATED_UAT_CADDY_HOST_SNI_EXPECTATION_INVALID",
        ):
            CONTRACTS.validate_expectation(altered, policy, sources)

        altered = copy.deepcopy(value["evidence_intent_v2"])
        altered["unexpected"] = True
        with self.assertRaisesRegex(
            CONTRACTS.ContractError,
            "ISOLATED_UAT_CADDY_HOST_SNI_EVIDENCE_INTENT_INVALID",
        ):
            CONTRACTS.validate_evidence_intent_v2(altered, policy, sources)

        with self.assertRaisesRegex(
            CONTRACTS.ContractError,
            "ISOLATED_UAT_CADDY_HOST_SNI_JSON_INVALID",
        ):
            CONTRACTS.canonical_json({"non_finite": float("nan")})

        with self.assertRaisesRegex(
            CONTRACTS.ContractError,
            "ISOLATED_UAT_CADDY_HOST_SNI_JSON_INVALID",
        ):
            CONTRACTS.canonical_sha256({"invalid_unicode": "\ud800"})

        with self.assertRaisesRegex(
            CONTRACTS.ContractError,
            "ISOLATED_UAT_CADDY_HOST_SNI_SOURCE_CLOSURE_INVALID",
        ):
            CONTRACTS.validate_policy(policy, None)

        with self.assertRaisesRegex(
            CONTRACTS.ContractError,
            "ISOLATED_UAT_CADDY_HOST_SNI_POLICY_INVALID",
        ):
            CONTRACTS.build_expectation(expectation_inputs(), None, sources)

    def test_runtime_gates_remain_fail_closed(self) -> None:
        gates = (
            (
                CONTRACTS.require_runtime_observer,
                "ISOLATED_UAT_CADDY_HOST_SNI_RUNTIME_OBSERVER_NOT_IMPLEMENTED",
            ),
            (
                CONTRACTS.require_publisher,
                "ISOLATED_UAT_CADDY_HOST_SNI_PUBLISHER_NOT_IMPLEMENTED",
            ),
            (
                CONTRACTS.require_runtime_backend,
                "ISOLATED_UAT_CADDY_HOST_SNI_RUNTIME_BACKEND_NOT_IMPLEMENTED",
            ),
        )
        for gate, code in gates:
            with self.subTest(code=code), self.assertRaisesRegex(
                CONTRACTS.ContractError,
                code,
            ):
                gate()

    def test_staffing_and_runtime_claim_fields_are_absent(self) -> None:
        value = fixture()

        def keys(item: object) -> set[str]:
            if isinstance(item, dict):
                return set(item) | set().union(*(keys(child) for child in item.values()))
            if isinstance(item, list):
                return set().union(*(keys(child) for child in item))
            return set()

        observed = keys(value)
        for forbidden in (
            "staff_count", "seat_count", "user_count", "headcount",
            "runtime_observation", "published_receipt", "certificate_chain",
        ):
            self.assertNotIn(forbidden, observed)


if __name__ == "__main__":
    unittest.main()
