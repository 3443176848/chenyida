#!/usr/bin/python3
"""Tests for the frozen-v6 isolated-UAT declared source closure."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import unittest
from pathlib import Path


SITE_ROOT = Path(__file__).resolve().parent.parent


def load_module(name: str, path: Path):
    specification = importlib.util.spec_from_file_location(name, path)
    if specification is None or specification.loader is None:
        raise RuntimeError(f"{name} cannot be loaded")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


CONTRACT = load_module(
    "isolated_uat_action_source_closure_contracts",
    SITE_ROOT / "scripts/isolated-uat-action-source-closure-contracts.py",
)
POLICY_PATH = SITE_ROOT / "operations/isolated-uat-action-source-closure-policy-v1.json"


def resign(policy: dict) -> dict:
    closure = policy["source_closure"]
    closure_body = {
        key: item for key, item in closure.items()
        if key != "source_closure_sha256"
    }
    closure["source_closure_sha256"] = CONTRACT.canonical_sha256(closure_body)
    body = {key: item for key, item in policy.items() if key != "policy_sha256"}
    policy["policy_sha256"] = CONTRACT.canonical_sha256(body)
    return policy


def bind_source(policy: dict, sources: dict[str, bytes], path: str, raw: bytes):
    changed_policy = copy.deepcopy(policy)
    changed_sources = dict(sources)
    changed_sources[path] = raw
    member = next(
        item for item in changed_policy["source_closure"]["members"]
        if item["path"] == path
    )
    member["sha256"] = hashlib.sha256(raw).hexdigest()
    return resign(changed_policy), changed_sources


class IsolatedUatActionSourceClosureContractsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.policy_raw = POLICY_PATH.read_bytes()
        cls.policy = CONTRACT.parse_json(cls.policy_raw)
        cls.sources = {
            path: (SITE_ROOT / path).read_bytes()
            for path in CONTRACT.MEMBER_PATHS
        }

    def test_valid_closure_is_deterministic_bounded_and_honest(self) -> None:
        for relative in [
            "operations/isolated-uat-action-source-closure-policy-v1.json",
            "scripts/isolated-uat-action-source-closure-contracts.py",
            *CONTRACT.MEMBER_PATHS,
        ]:
            path = SITE_ROOT / relative
            self.assertTrue(path.is_file(), relative)
            while path != SITE_ROOT:
                self.assertFalse(path.is_symlink(), relative)
                path = path.parent
        first = CONTRACT.validate_policy(copy.deepcopy(self.policy), dict(self.sources))
        second = CONTRACT.validate_policy(copy.deepcopy(self.policy), dict(self.sources))
        self.assertEqual(first, second)
        self.assertEqual(first["boundary"]["member_count"], 83)
        self.assertEqual(len(first["source_closure"]["members"]), 83)
        self.assertEqual(
            first["validation_output"]["source_observation_status"],
            "SOURCE_BYTES_CALLER_INJECTED_HASH_MATCHED_NOT_ATTESTED",
        )
        for gate, code in (
            (CONTRACT.require_trusted_pre_import_bootstrap, "TRUSTED_PRE_IMPORT_BOOTSTRAP_NOT_IMPLEMENTED"),
            (CONTRACT.require_runtime_backend, "RUNTIME_BACKEND_NOT_IMPLEMENTED"),
            (CONTRACT.require_publisher, "PUBLISHER_NOT_IMPLEMENTED"),
        ):
            with self.assertRaisesRegex(CONTRACT.ContractError, code):
                gate()

    def test_frozen_v6_action_catalog_is_reconstructed_per_action(self) -> None:
        catalog = CONTRACT.reconstruct_action_catalog(self.sources)
        self.assertEqual(catalog, self.policy["action_catalog"])
        self.assertEqual([len(item["sources"]) for item in catalog], [5, 3, 4, 5, 5, 5, 10, 5, 12])
        self.assertEqual(sum(len(item["sources"]) for item in catalog), 54)
        self.assertEqual(len({path for item in catalog for path in item["sources"]}), 21)
        tampered = copy.deepcopy(self.policy)
        first = tampered["action_catalog"][0]["sources"]
        second = tampered["action_catalog"][1]["sources"]
        first[1], second[0] = second[0], first[1]
        resign(tampered)
        with self.assertRaisesRegex(CONTRACT.ContractError, "ACTION_CATALOG_INVALID"):
            CONTRACT.validate_policy(tampered, dict(self.sources))

    def test_member_set_and_dependency_model_are_exact_and_reachable(self) -> None:
        closure = self.policy["source_closure"]
        self.assertEqual([item["path"] for item in closure["members"]], CONTRACT.MEMBER_PATHS)
        self.assertEqual(len(closure["dependency_model"]["esm_local_imports"]), 23)
        self.assertIn("app/lib/infrastructure/runtime-secret.ts", CONTRACT.MEMBER_PATHS)
        self.assertEqual(len(CONTRACT.MIGRATION_PATHS), 46)
        tampered = copy.deepcopy(self.policy)
        tampered["source_closure"]["dependency_model"]["esm_local_imports"].pop()
        resign(tampered)
        with self.assertRaisesRegex(CONTRACT.ContractError, "ACTION_SOURCE_CLOSURE_INVALID"):
            CONTRACT.validate_policy(tampered, dict(self.sources))

    def test_source_map_and_member_hashes_fail_closed(self) -> None:
        for path in (
            "scripts/isolated-uat-one-shot.py",
            "app/lib/infrastructure/runtime-secret.ts",
            "scripts/postgresql-runtime-privilege-policy.mjs",
            "drizzle-postgres/0046_runtime_lock_privilege_boundary.sql",
            "package.json",
        ):
            changed = dict(self.sources)
            changed[path] += b"\n"
            with self.subTest(path=path), self.assertRaisesRegex(
                CONTRACT.ContractError, "MEMBER_HASH_INVALID",
            ):
                CONTRACT.validate_policy(copy.deepcopy(self.policy), changed)
        missing = dict(self.sources)
        missing.pop(CONTRACT.MEMBER_PATHS[0])
        extra = {**self.sources, "unexpected.txt": b"unexpected"}
        non_bytes = dict(self.sources)
        non_bytes[CONTRACT.MEMBER_PATHS[0]] = "not-bytes"
        for changed in (missing, extra, non_bytes):
            with self.assertRaisesRegex(CONTRACT.ContractError, "SOURCE_(MAP|BYTES)_INVALID"):
                CONTRACT.validate_policy(copy.deepcopy(self.policy), changed)

    def test_frozen_binding_chain_rejects_substitution_and_v1_through_v6_stay_unchanged(self) -> None:
        expected_raw = {
            1: "3244d550ae61bffa42fe1fa1c5c4c8bf0b610b60e1e96e8bac9a9c55ca177b3a",
            2: "9cc4e3c12793785186fcf74560919376cfa5cc82ef5f344b11fcb5b4501e5232",
            3: "da69ce3a276ef68f9f6cece12f281ea89584930d481afef19fcf930dae8de5c4",
            4: "4858b8c14846a69ed969f5476828631362830675399e788f705c35e1cfe34262",
            5: "95bbf9a263818886072a29f486a53acb752687dcd4d5cd086283336dcbb77363",
            6: "459bb65d42c71551797bf4cbf56a022700780caeb8a3d987b51bd96560d9f1f0",
        }
        for version, digest in expected_raw.items():
            path = SITE_ROOT / f"operations/isolated-uat-one-shot-action-bindings-v{version}.json"
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)
        path = CONTRACT.BINDING_ANCHORS[-1]["path"]
        changed_policy, changed_sources = bind_source(
            self.policy, self.sources, path, self.sources[path] + b"\n",
        )
        with self.assertRaisesRegex(CONTRACT.ContractError, "BINDING_ANCHOR_INVALID"):
            CONTRACT.validate_policy(changed_policy, changed_sources)

    def test_python_dynamic_module_loads_are_fixed_and_complete(self) -> None:
        path = "scripts/isolated-uat-one-shot.py"
        changed = self.sources[path].replace(
            b'"scripts/isolated-uat-runtime-contracts.py"',
            b'"scripts/isolated-uat-runtime-receipts.py"',
            1,
        )
        changed_policy, changed_sources = bind_source(self.policy, self.sources, path, changed)
        with self.assertRaisesRegex(CONTRACT.ContractError, "PYTHON_LOADER_INVALID"):
            CONTRACT.validate_policy(changed_policy, changed_sources)
        changed_policy, changed_sources = bind_source(
            self.policy, self.sources, path, self.sources[path] + b"\n__import__(\"os\")\n",
        )
        with self.assertRaisesRegex(CONTRACT.ContractError, "DYNAMIC_IMPORT_FORBIDDEN"):
            CONTRACT.validate_policy(changed_policy, changed_sources)
        changed_policy, changed_sources = bind_source(
            self.policy, self.sources, path,
            self.sources[path] + b'\ngetattr(__builtins__, "__import__")("os")\n',
        )
        with self.assertRaisesRegex(CONTRACT.ContractError, "DYNAMIC_IMPORT_FORBIDDEN"):
            CONTRACT.validate_policy(changed_policy, changed_sources)
        changed_policy, changed_sources = bind_source(
            self.policy, self.sources, path,
            self.sources[path] + b'\nimportlib.import_module("os")\n',
        )
        with self.assertRaisesRegex(CONTRACT.ContractError, "DYNAMIC_IMPORT_FORBIDDEN"):
            CONTRACT.validate_policy(changed_policy, changed_sources)

    def test_typescript_local_imports_include_runtime_secret_and_reject_dynamic_loading(self) -> None:
        path = "app/lib/infrastructure/config.ts"
        changed = self.sources[path].replace(b'"./runtime-secret.ts"', b'"./request-origin.ts"', 1)
        changed_policy, changed_sources = bind_source(self.policy, self.sources, path, changed)
        with self.assertRaisesRegex(CONTRACT.ContractError, "TYPESCRIPT_IMPORT_INVALID"):
            CONTRACT.validate_policy(changed_policy, changed_sources)
        changed_policy, changed_sources = bind_source(
            self.policy, self.sources, path,
            self.sources[path] + b'\nvoid import("./request-origin.ts");\n',
        )
        with self.assertRaisesRegex(CONTRACT.ContractError, "DYNAMIC_IMPORT_FORBIDDEN"):
            CONTRACT.validate_policy(changed_policy, changed_sources)

    def test_esm_graph_is_exact_and_production_runner_cannot_enter_it(self) -> None:
        path = "scripts/postgresql-runtime-privilege-operator.mjs"
        changed = self.sources[path].replace(
            b'"./postgresql-runtime-privilege-catalog.mjs"',
            b'"./postgresql-runtime-privilege-runner.mjs"',
            1,
        )
        changed_policy, changed_sources = bind_source(self.policy, self.sources, path, changed)
        with self.assertRaisesRegex(CONTRACT.ContractError, "ESM_IMPORT_INVALID"):
            CONTRACT.validate_policy(changed_policy, changed_sources)
        changed_policy, changed_sources = bind_source(
            self.policy, self.sources, path, self.sources[path] + b'\nrequire("node:fs");\n',
        )
        with self.assertRaisesRegex(CONTRACT.ContractError, "DYNAMIC_IMPORT_FORBIDDEN"):
            CONTRACT.validate_policy(changed_policy, changed_sources)
        changed_policy, changed_sources = bind_source(
            self.policy, self.sources, path,
            self.sources[path] + b'\n; import "./postgresql-runtime-privilege-runner.mjs";\n',
        )
        with self.assertRaisesRegex(CONTRACT.ContractError, "DYNAMIC_IMPORT_FORBIDDEN"):
            CONTRACT.validate_policy(changed_policy, changed_sources)
        for suffix in (
            b'\nvoid import /*closure-bypass*/ ("./postgresql-runtime-privilege-runner.mjs");\n',
            b'\nexport/*closure-bypass*/*from"./postgresql-runtime-privilege-runner.mjs";\n',
        ):
            changed_policy, changed_sources = bind_source(
                self.policy, self.sources, path, self.sources[path] + suffix,
            )
            with self.assertRaisesRegex(CONTRACT.ContractError, "DYNAMIC_IMPORT_FORBIDDEN"):
                CONTRACT.validate_policy(changed_policy, changed_sources)
        self.assertNotIn("scripts/postgresql-runtime-privilege-runner.mjs", CONTRACT.MEMBER_PATHS)

    def test_migration_journal_package_and_fixed_46_member_set_are_validated(self) -> None:
        journal_path = "drizzle-postgres/meta/_journal.json"
        changed = self.sources[journal_path].replace(b'"idx": 1', b'"idx": 2', 1)
        changed_policy, changed_sources = bind_source(self.policy, self.sources, journal_path, changed)
        with self.assertRaisesRegex(CONTRACT.ContractError, "MIGRATION_JOURNAL_INVALID"):
            CONTRACT.validate_policy(changed_policy, changed_sources)
        changed = self.sources[journal_path].replace(b'"idx": 1', b'"idx": true', 1)
        changed_policy, changed_sources = bind_source(self.policy, self.sources, journal_path, changed)
        with self.assertRaisesRegex(CONTRACT.ContractError, "MIGRATION_JOURNAL_INVALID"):
            CONTRACT.validate_policy(changed_policy, changed_sources)
        package_path = "package.json"
        changed = self.sources[package_path].replace(b'"version": "0.1.0-alpha.47"', b'"version": ""', 1)
        changed_policy, changed_sources = bind_source(self.policy, self.sources, package_path, changed)
        with self.assertRaisesRegex(CONTRACT.ContractError, "PACKAGE_INVALID"):
            CONTRACT.validate_policy(changed_policy, changed_sources)
        self.assertEqual(CONTRACT.MIGRATION_FILENAMES[-1], "0046_runtime_lock_privilege_boundary.sql")

    def test_policy_self_resign_cannot_escalate_authorization_publication_or_runtime(self) -> None:
        mutations = (
            lambda value: value.__setitem__("execution_authorized", True),
            lambda value: value["capability_status"].__setitem__("publisher", "IMPLEMENTED"),
            lambda value: value["validation_output"].__setitem__("runtime_evidence_status", "ESTABLISHED"),
        )
        for mutate in mutations:
            tampered = copy.deepcopy(self.policy)
            mutate(tampered)
            resign(tampered)
            with self.assertRaisesRegex(CONTRACT.ContractError, "POLICY_INVALID"):
                CONTRACT.validate_policy(tampered, dict(self.sources))
        changed_policy, changed_sources = bind_source(
            self.policy,
            self.sources,
            "compose.release.yml",
            self.sources["compose.release.yml"] + b"\n# re-signed drift\n",
        )
        with self.assertRaisesRegex(CONTRACT.ContractError, "POLICY_SHA256_INVALID"):
            CONTRACT.validate_policy(changed_policy, changed_sources)
        serialized = CONTRACT.canonical_json(self.policy)
        self.assertIn("NOT_ATTESTED", serialized)
        self.assertIn("NOT_IMPLEMENTED", serialized)

    def test_strict_json_paths_duplicates_and_source_types_are_rejected(self) -> None:
        with self.assertRaisesRegex(CONTRACT.ContractError, "JSON_DUPLICATE_KEY"):
            CONTRACT.parse_json(b'{"a":1,"a":2}')
        with self.assertRaisesRegex(CONTRACT.ContractError, "JSON_INVALID"):
            CONTRACT.parse_json(b'{"a":NaN}')
        with self.assertRaisesRegex(CONTRACT.ContractError, "JSON_INVALID"):
            CONTRACT.parse_json(b'{"a":1e999}')
        with self.assertRaisesRegex(CONTRACT.ContractError, "JSON_INVALID"):
            CONTRACT.parse_json(b'{"a":' + b"9" * 5000 + b"}")
        with self.assertRaisesRegex(CONTRACT.ContractError, "JSON_INVALID"):
            CONTRACT.parse_json(b'{"a":"\\ud800"}')
        with self.assertRaisesRegex(CONTRACT.ContractError, "JSON_INVALID"):
            CONTRACT.parse_json(b"{" + b" " * CONTRACT.MAX_JSON_BYTES + b"}")
        for invalid in (
            "../escape", "./escape", "/absolute", "double//slash",
            "windows\\path", "nul\x00path", "é/path", "a/" + "x" * 241,
        ):
            tampered = copy.deepcopy(self.policy)
            tampered["source_closure"]["members"][0]["path"] = invalid
            resign(tampered)
            with self.subTest(path=repr(invalid)), self.assertRaisesRegex(
                CONTRACT.ContractError, "MEMBER_INVALID",
            ):
                CONTRACT.validate_policy(tampered, dict(self.sources))
        tampered = copy.deepcopy(self.policy)
        tampered["source_closure"]["members"][1] = copy.deepcopy(
            tampered["source_closure"]["members"][0]
        )
        resign(tampered)
        with self.assertRaisesRegex(CONTRACT.ContractError, "MEMBER_INVALID"):
            CONTRACT.validate_policy(tampered, dict(self.sources))
        for target in ("policy", "closure"):
            tampered = copy.deepcopy(self.policy)
            if target == "policy":
                tampered["schema_version"] = True
            else:
                tampered["source_closure"]["schema_version"] = True
            resign(tampered)
            with self.subTest(target=target), self.assertRaises(CONTRACT.ContractError):
                CONTRACT.validate_policy(tampered, dict(self.sources))

    def test_scope_excludes_staffing_platform_image_and_runtime_claims(self) -> None:
        policy = self.policy
        self.assertEqual(
            policy["boundary"]["staffing"],
            "APPLICATION_CONFIGURATION_NOT_INFRASTRUCTURE_CARDINALITY",
        )
        self.assertEqual(
            policy["source_closure"]["external_boundary"]["oci_image_contents"],
            "EXCLUDED_SEPARATE_EXACT_IMAGE_BLOCKER",
        )
        self.assertFalse(policy["boundary"]["validator_is_member"])
        self.assertFalse(policy["boundary"]["closure_descriptor_is_member"])
        serialized = CONTRACT.canonical_json(policy).lower()
        for forbidden in ("two staff", "two users", "generic platform", "uat ready"):
            self.assertNotIn(forbidden, serialized)


if __name__ == "__main__":
    unittest.main(verbosity=2)
