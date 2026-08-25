#!/usr/bin/python3
"""Synthetic tests for the narrow isolated-UAT root operations orchestrator."""

from __future__ import annotations

import copy
import datetime as dt
import hashlib
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SITE_ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = SITE_ROOT / "scripts/isolated-uat-root-operations.py"


def load_module():
    specification = importlib.util.spec_from_file_location("isolated_uat_root_operations", MODULE_PATH)
    if specification is None or specification.loader is None:
        raise RuntimeError("isolated UAT root operations module cannot be loaded")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


OPS = load_module()
NOW = dt.datetime(2026, 8, 25, 6, 0, 0, tzinfo=dt.timezone.utc)


def request() -> dict:
    project = "chenyida-erp-uat-root-ops-test"
    base = f"/var/lib/{project}"
    return {
        "schema_version": 1,
        "contract": OPS.REQUEST_CONTRACT,
        "request_id": "task92-root-ops-001",
        "project": project,
        "package_root": f"{base}/deployment-package",
        "compose_env_file": f"{base}/deployment-package/render.env",
        "source": {
            "package_version": "0.1.0-alpha.47",
            "git_commit": "a" * 40,
            "git_tree": "b" * 40,
            "resolved_compose_sha256": "c" * 64,
            "root_operations_package_sha256": "d" * 64,
            "web_image": f"example.invalid/erp/web@sha256:{'e' * 64}",
            "web_image_config_digest": f"sha256:{'f' * 64}",
            "worker_image": f"example.invalid/erp/worker@sha256:{'1' * 64}",
            "worker_image_config_digest": f"sha256:{'2' * 64}",
            "release_manifest_file": f"{base}/release-candidate/release-manifest.json",
            "release_manifest_sha256": "3" * 64,
        },
        "roots": {
            "runtime_secret_root": f"/etc/{project}/runtime-secrets",
            "backup_credential_root": f"/etc/{project}/operator-credentials",
            "release_candidate_root": f"{base}/release-candidate",
            "migration_grant_root": f"{base}/migration-grant",
            "state_root": f"{base}/root-operations-state",
        },
        "database": {
            "name": "chenyida_erp",
            "current_head": "EMPTY",
            "target_head": OPS.TARGET_HEAD,
            "migration_count": 46,
            "migration_allowlist_sha256": "4" * 64,
            "marker": f"chenyida-erp-deployment/v2:UAT:{project}",
        },
    }


def authorization(bound_request: dict, *, created: dt.datetime = NOW, expires: dt.datetime | None = None) -> dict:
    expires = expires or created + dt.timedelta(minutes=20)
    body = {
        "schema_version": 1,
        "contract": OPS.AUTHORIZATION_CONTRACT,
        "authorization_id": "task92-root-ops-auth-001",
        "action": OPS.AUTHORIZED_ACTION,
        "request_sha256": OPS.digest(bound_request),
        "root_operations_package_sha256": bound_request["source"]["root_operations_package_sha256"],
        "created_at": created.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "expires_at": expires.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }
    return {**body, "authorization_sha256": OPS.digest(body)}


def identity(bound_request: dict) -> dict:
    return {
        "database_name": "chenyida_erp",
        "database_system_identifier": "1234567890123456789",
        "database_oid": "16384",
        "database_marker": bound_request["database"]["marker"],
        "migration_role": "chenyida_erp_owner",
    }


class FakePort:
    def __init__(self, bound_request: dict, fail_at: str | None = None):
        self.request = bound_request
        self.fail_at = fail_at
        self.events: list[str] = []
        self.identities = [identity(bound_request), identity(bound_request)]
        self.containment_count = 0

    def event(self, name: str):
        self.events.append(name)
        if name == self.fail_at:
            raise OPS.ContractError(f"FIXTURE_{name.upper()}_FAILED")

    def validate_preflight(self, request_value):
        self.event("preflight")
        return {"status": "ELIGIBLE_INPUTS_VERIFIED"}

    def start_postgres_only(self, request_value):
        self.event("start_postgres")

    def validate_release_manifest(self, request_value):
        self.event("validate_manifest")

    def observe_empty_database(self, request_value):
        self.event("observe_empty")
        return {"status": "EMPTY_POSTGRES_TARGET_VERIFIED"}

    def bootstrap_database(self, request_value, observation):
        self.event("bootstrap")
        return {"status": "BOOTSTRAP_VERIFIED", "receipt_sha256": "5" * 64}

    def observe_bootstrapped_database(self, request_value):
        self.event("observe_identity")
        return self.identities.pop(0)

    def stage_migration_grant(self, request_value, grant):
        self.event("stage_grant")

    def run_migration(self, request_value, identity_value, grant):
        self.event("migration")
        return {"status": "MIGRATION_COMMITTED", "grant_sha256": grant["grant_sha256"]}

    def verify_migration(self, request_value, identity_value, bootstrap, grant, result):
        self.event("verify_migration")
        return {"status": "MIGRATION_COMMITTED_EXACT_LEDGER_VERIFIED"}

    def unfence_database(self, request_value, migration):
        self.event("unfence")
        return {"status": "UNFENCE_VERIFIED", "receipt_sha256": "6" * 64}

    def reconcile_final_privileges(self, request_value, migration, unfence):
        self.event("reconcile")
        return {
            "status": "FINAL_RECONCILIATION_APPLIED_PENDING_VERIFICATION",
            "reconciliation_sha256": "7" * 64,
        }

    def verify_final_database(self, request_value, identity_value, migration, unfence, reconciliation):
        self.event("verify_final")
        return {"status": "FINAL_RUNTIME_PRIVILEGES_VERIFIED"}

    def contain_failure(self, request_value):
        self.containment_count += 1
        return {"status": "QUARANTINED_RUNTIME_STOPPED"}


class IsolatedUatRootOperationsTest(unittest.TestCase):
    def state(self, root: Path) -> OPS.DurableState:
        root.mkdir(mode=0o700)
        os.chmod(root, 0o700)
        return OPS.DurableState(root, enforce_root=False)

    def test_read_only_plan_is_exact_deterministic_and_has_no_staff_cardinality(self) -> None:
        value = request()
        first = OPS.build_plan(value)
        second = OPS.build_plan(copy.deepcopy(value))
        self.assertEqual(first, second)
        self.assertEqual(first["mode"], "READ_ONLY_PLAN")
        self.assertFalse(first["execution_authorized"])
        self.assertEqual(first["phases"], list(OPS.PHASES))
        self.assertEqual(first["terminal_status"], "DATABASE_READY_RUNTIME_SERVICES_NOT_STARTED")
        self.assertEqual(tuple(first["protected_volumes"]), OPS.PROTECTED_VOLUMES)
        self.assertNotIn("staff", OPS.canonical_json(first).decode().lower())
        self.assertNotIn("employee_count", OPS.canonical_json(first).decode().lower())

    def test_happy_path_is_ordered_and_consumes_authorization_before_ports(self) -> None:
        value = request()
        port = FakePort(value)
        with tempfile.TemporaryDirectory(dir=SITE_ROOT) as temporary:
            root = Path(temporary) / "state"
            result = OPS.execute_database_preparation(
                value, authorization(value), port, self.state(root), clock=lambda: NOW,
            )
            self.assertEqual(result["status"], "DATABASE_READY_RUNTIME_SERVICES_NOT_STARTED")
            self.assertEqual(port.events, [
                "preflight", "validate_manifest", "start_postgres", "observe_empty", "bootstrap",
                "observe_identity", "observe_identity", "stage_grant", "migration", "verify_migration",
                "unfence", "reconcile", "verify_final",
            ])
            self.assertEqual([item.name for item in root.iterdir()], [
                "execution-intent.json",
                "execution-authorization-consumed.json",
                "database-bootstrap-verified.json",
                "migration-grant-prepared.json",
                "migration-grant-consumed.json",
                "database-migration-verified.json",
                "database-unfence-verified.json",
                "database-final-reconciliation-applied.json",
                "database-final-privileges-verified.json",
                "database-preparation-result.json",
            ])
            consumed = json.loads((root / "migration-grant-consumed.json").read_text())
            self.assertEqual(consumed["state"], "CONSUMED_BEFORE_MIGRATION_DISPATCH")

    def test_each_failure_stops_all_later_ports_and_quarantines(self) -> None:
        value = request()
        sequence = [
            "preflight", "validate_manifest", "start_postgres", "observe_empty", "bootstrap", "observe_identity",
            "stage_grant", "migration", "verify_migration", "unfence", "reconcile", "verify_final",
        ]
        for failing in sequence:
            with self.subTest(failing=failing), tempfile.TemporaryDirectory(dir=SITE_ROOT) as temporary:
                root = Path(temporary) / "state"
                port = FakePort(value, fail_at=failing)
                with self.assertRaisesRegex(OPS.ContractError, f"FIXTURE_{failing.upper()}_FAILED"):
                    OPS.execute_database_preparation(
                        value, authorization(value), port, self.state(root), clock=lambda: NOW,
                    )
                self.assertEqual(port.events[-1], failing)
                if failing == "preflight":
                    self.assertEqual(list(root.iterdir()), [])
                    self.assertEqual(port.containment_count, 0)
                else:
                    self.assertTrue((root / "quarantined.json").is_file())
                    self.assertEqual(port.containment_count, 1)

    def test_dynamic_identity_is_reread_and_drift_stops_before_grant_or_migration(self) -> None:
        value = request()
        port = FakePort(value)
        changed = identity(value)
        changed["database_oid"] = "16385"
        port.identities[1] = changed
        with tempfile.TemporaryDirectory(dir=SITE_ROOT) as temporary:
            root = Path(temporary) / "state"
            with self.assertRaisesRegex(OPS.ContractError, "DATABASE_IDENTITY_CHANGED"):
                OPS.execute_database_preparation(
                    value, authorization(value), port, self.state(root), clock=lambda: NOW,
                )
            self.assertNotIn("migration", port.events)
            self.assertFalse((root / "migration-grant-consumed.json").exists())

    def test_grant_is_short_lived_minimal_and_bound_to_isolated_identity(self) -> None:
        value = request()
        auth = authorization(value)
        grant = OPS.build_migration_grant(value, auth, identity(value), NOW)
        self.assertEqual(grant["contract"], OPS.GRANT_CONTRACT)
        self.assertEqual(grant["execution_scope"], "DEDICATED_ISOLATED_UAT_MIGRATION")
        self.assertEqual(grant["database"]["deployment_id"], value["project"])
        self.assertEqual(grant["database"]["database_marker"], value["database"]["marker"])
        self.assertEqual(grant["expected_current_head"], "EMPTY")
        self.assertEqual(grant["target_head"], OPS.TARGET_HEAD)
        self.assertEqual(
            dt.datetime.fromisoformat(grant["expires_at"].replace("Z", "+00:00"))
            - dt.datetime.fromisoformat(grant["created_at"].replace("Z", "+00:00")),
            dt.timedelta(minutes=10),
        )
        self.assertNotIn("supervisor_bundle_sha256", grant)
        self.assertNotIn("staff", OPS.canonical_json(grant).decode().lower())

        short_auth = authorization(value, expires=NOW + dt.timedelta(minutes=3))
        capped = OPS.build_migration_grant(value, short_auth, identity(value), NOW)
        self.assertEqual(capped["expires_at"], short_auth["expires_at"])
        too_short = authorization(value, expires=NOW + dt.timedelta(minutes=1))
        with self.assertRaisesRegex(OPS.ContractError, "AUTHORIZATION_EXPIRES_TOO_SOON"):
            OPS.build_migration_grant(value, too_short, identity(value), NOW)

    def test_authorization_expiry_request_package_and_digest_are_fail_closed(self) -> None:
        value = request()
        cases = []
        expired = authorization(value, created=NOW - dt.timedelta(minutes=21), expires=NOW - dt.timedelta(minutes=1))
        cases.append((expired, "AUTHORIZATION_EXPIRED"))
        wrong_request = authorization(value)
        wrong_request["request_sha256"] = "f" * 64
        cases.append((wrong_request, "AUTHORIZATION_REQUEST_MISMATCH"))
        wrong_package = authorization(value)
        wrong_package["root_operations_package_sha256"] = "e" * 64
        cases.append((wrong_package, "AUTHORIZATION_PACKAGE_MISMATCH"))
        wrong_digest = authorization(value)
        wrong_digest["authorization_sha256"] = "e" * 64
        cases.append((wrong_digest, "AUTHORIZATION_SHA256_INVALID"))
        for candidate, code in cases:
            with self.subTest(code=code), self.assertRaisesRegex(OPS.ContractError, code):
                OPS.validate_authorization(candidate, value, NOW)

    def test_consumed_or_ambiguous_state_is_never_replayed(self) -> None:
        value = request()
        with tempfile.TemporaryDirectory(dir=SITE_ROOT) as temporary:
            root = Path(temporary) / "state"
            state = self.state(root)
            state.validate_empty()
            state.append("execution-intent.json", {"state": "PREPARED"})
            port = FakePort(value)
            with self.assertRaisesRegex(OPS.ContractError, "RECOVERY_REQUIRED"):
                OPS.execute_database_preparation(value, authorization(value), port, state, clock=lambda: NOW)
            self.assertEqual(port.events, [])

    def test_state_root_inode_replacement_is_rejected_before_next_append(self) -> None:
        with tempfile.TemporaryDirectory(dir=SITE_ROOT) as temporary:
            root = Path(temporary) / "state"
            state = self.state(root)
            state.validate_empty()
            original = Path(temporary) / "original-state"
            root.rename(original)
            root.mkdir(mode=0o700)
            os.chmod(root, 0o700)
            with self.assertRaisesRegex(OPS.ContractError, "STATE_ROOT_CHANGED"):
                state.append("execution-intent.json", {"state": "PREPARED"})

    def test_execution_rejects_a_nearly_expired_authorization_before_preflight(self) -> None:
        value = request()
        port = FakePort(value)
        with tempfile.TemporaryDirectory(dir=SITE_ROOT) as temporary:
            root = Path(temporary) / "state"
            with self.assertRaisesRegex(OPS.ContractError, "AUTHORIZATION_EXPIRES_TOO_SOON"):
                OPS.execute_database_preparation(
                    value,
                    authorization(value, expires=NOW + dt.timedelta(minutes=10)),
                    port,
                    self.state(root),
                    clock=lambda: NOW,
                )
            self.assertEqual(port.events, [])
            self.assertEqual(list(root.iterdir()), [])

    def test_preflight_time_is_rechecked_before_intent_or_first_runtime_action(self) -> None:
        value = request()
        port = FakePort(value)
        moments = iter([NOW, NOW + dt.timedelta(minutes=6)])
        with tempfile.TemporaryDirectory(dir=SITE_ROOT) as temporary:
            root = Path(temporary) / "state"
            with self.assertRaisesRegex(OPS.ContractError, "AUTHORIZATION_EXPIRES_TOO_SOON"):
                OPS.execute_database_preparation(
                    value,
                    authorization(value, expires=NOW + dt.timedelta(minutes=20)),
                    port,
                    self.state(root),
                    clock=lambda: next(moments),
                )
            self.assertEqual(port.events, ["preflight"])
            self.assertEqual(port.containment_count, 0)
            self.assertEqual(list(root.iterdir()), [])

    def test_authorization_and_package_mismatch_block_system_port_code_loading(self) -> None:
        value = request()
        invalid_authorization = authorization(value)
        invalid_authorization["request_sha256"] = "f" * 64
        with mock.patch.object(OPS, "verify_root_operations_package") as verify_package, mock.patch.object(
            OPS, "load_system_port",
        ) as load_port, self.assertRaisesRegex(OPS.ContractError, "AUTHORIZATION_REQUEST_MISMATCH"):
            OPS.prepare_execution(value, invalid_authorization, NOW)
        verify_package.assert_not_called()
        load_port.assert_not_called()

        with mock.patch.object(
            OPS,
            "verify_root_operations_package",
            side_effect=OPS.ContractError("ISOLATED_UAT_ROOT_OPERATIONS_PACKAGE_SHA256_MISMATCH"),
        ) as verify_package, mock.patch.object(OPS, "load_system_port") as load_port, self.assertRaisesRegex(
            OPS.ContractError, "PACKAGE_SHA256_MISMATCH",
        ):
            OPS.prepare_execution(value, authorization(value), NOW)
        verify_package.assert_called_once_with(value)
        load_port.assert_not_called()

    def test_root_package_is_hashed_once_without_capturing_executable_bytes(self) -> None:
        value = request()
        with tempfile.TemporaryDirectory(dir=SITE_ROOT) as temporary:
            package_root = Path(temporary) / "deployment-package"
            package_root.mkdir(mode=0o700)
            os.chmod(package_root, 0o700)
            members = []
            for relative in OPS.ROOT_OPERATIONS_PACKAGE_MEMBERS:
                member = package_root / relative
                member.parent.mkdir(parents=True, exist_ok=True)
                raw = (relative + "\n").encode()
                member.write_bytes(raw)
                os.chmod(member, 0o400)
                members.append({
                    "path": relative,
                    "bytes": len(raw),
                    "sha256": hashlib.sha256(raw).hexdigest(),
                })
            value["package_root"] = str(package_root)
            value["compose_env_file"] = str(package_root / "render.env")
            value["source"]["root_operations_package_sha256"] = OPS.digest({
                "schema_version": 1,
                "members": members,
            })
            running_file = package_root / "scripts/isolated-uat-root-operations.py"
            with mock.patch.object(OPS, "validate_request", return_value=value), mock.patch.object(
                OPS,
                "__file__",
                str(running_file),
            ):
                self.assertIsNone(OPS.verify_root_operations_package(value))
                os.chmod(temporary, 0o770)
                with self.assertRaisesRegex(OPS.ContractError, "PACKAGE_ANCESTOR_INVALID"):
                    OPS.verify_root_operations_package(value)
                os.chmod(temporary, 0o700)
                member = package_root / "render.env"
                os.chmod(member, 0o620)
                with self.assertRaisesRegex(OPS.ContractError, "PACKAGE_MEMBER_INVALID"):
                    OPS.verify_root_operations_package(value)
                os.chmod(member, 0o400)
                hardlink = package_root / "render.env.hardlink"
                os.link(member, hardlink)
                with self.assertRaisesRegex(OPS.ContractError, "PACKAGE_MEMBER_INVALID"):
                    OPS.verify_root_operations_package(value)
                hardlink.unlink()
                original = package_root / "render.env.original"
                member.rename(original)
                member.symlink_to(original)
                with self.assertRaisesRegex(OPS.ContractError, "PACKAGE_MEMBER_INVALID"):
                    OPS.verify_root_operations_package(value)
                member.unlink()
                original.rename(member)
                member.write_text("changed\n")
                os.chmod(member, 0o400)
                with self.assertRaisesRegex(OPS.ContractError, "PACKAGE_SHA256_MISMATCH"):
                    OPS.verify_root_operations_package(value)

    def test_fixed_system_port_loader_does_not_leave_bytecode_in_package(self) -> None:
        value = request()
        with tempfile.TemporaryDirectory(dir=SITE_ROOT) as temporary:
            package_root = Path(temporary) / "deployment-package"
            source = package_root / "scripts/isolated-uat-root-system-port.py"
            source.parent.mkdir(parents=True)
            source.write_text(
                "def create_system_port(request, api):\n"
                "    return {'request_id': request['request_id']}\n",
                encoding="utf-8",
            )
            value["package_root"] = str(package_root)
            loaded = OPS.load_system_port(value)
            self.assertEqual(loaded, {"request_id": value["request_id"]})
            self.assertFalse((source.parent / "__pycache__").exists())

    def test_production_roots_staffing_and_non_isolated_marker_are_rejected(self) -> None:
        mutations = [
            lambda value: value["roots"].__setitem__("runtime_secret_root", "/etc/chenyida-erp/runtime-secrets"),
            lambda value: value.__setitem__("staff_count", 2),
            lambda value: value["database"].__setitem__("marker", "chenyida-erp-deployment/v2:UAT:chenyida-erp"),
            lambda value: value["source"].__setitem__("worker_image", "worker:latest"),
            lambda value: value.__setitem__("package_root", f"/var/lib/{value['project']}/other"),
            lambda value: value["roots"].__setitem__("state_root", f"/var/lib/{value['project']}/other-state"),
            lambda value: value["source"].__setitem__("git_commit", "0" * 40),
            lambda value: value["source"].__setitem__("release_manifest_sha256", "0" * 64),
        ]
        for mutate in mutations:
            value = request()
            mutate(value)
            with self.assertRaises(OPS.ContractError):
                OPS.validate_request(value)

    def test_test_synthetic_and_production_runner_environment_is_rejected(self) -> None:
        cases = [
            {"NODE_ENV": "test"},
            {"ERP_ALLOW_ISOLATED_MIGRATION": "YES"},
            {"ERP_RELEASE_TEST_MODE": "YES"},
            {"ERP_RELEASE_SUPERVISOR_LAUNCHED": "YES"},
        ]
        for environment in cases:
            with self.subTest(environment=environment), mock.patch.dict(os.environ, environment, clear=True), self.assertRaisesRegex(
                OPS.ContractError, "FORBIDDEN_EXECUTION_MODE",
            ):
                OPS.assert_execution_environment()

    def test_source_does_not_import_production_runner_or_offer_runtime_start(self) -> None:
        source = MODULE_PATH.read_text()
        self.assertIn("runpy.run_path", source)
        self.assertNotIn("verified_package", source)
        self.assertNotIn("source_text =", source)
        self.assertNotIn("exec(compiled", source)
        self.assertNotIn("postgresql-runtime-privilege-runner.mjs", source)
        self.assertNotIn("uat-promotion-migration-control.py", source)
        self.assertNotIn("release-supervisor-launcher.py", source)
        self.assertNotIn("def start_web", source)
        self.assertNotIn("def start_worker", source)
        self.assertNotIn("def start_caddy", source)

    def test_worker_image_copies_only_the_three_runtime_policy_inputs(self) -> None:
        dockerfile = (SITE_ROOT / "Dockerfile").read_text(encoding="utf-8")
        self.assertNotIn("COPY --chown=root:root operations ./operations", dockerfile)
        self.assertNotIn("COPY operations ./operations", dockerfile)
        for relative in (
            "operations/postgresql-runtime-privilege-access-v2.json",
            "operations/postgresql-runtime-privilege-compiled-catalog-v1.json",
            "operations/postgresql-runtime-privilege-policy-v2.json",
        ):
            with self.subTest(relative=relative):
                self.assertTrue((SITE_ROOT / relative).is_file())
                self.assertIn(relative, dockerfile)


if __name__ == "__main__":
    unittest.main()
