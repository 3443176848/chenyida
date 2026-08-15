import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "uat-promotion-migration-control.py"
SPEC = importlib.util.spec_from_file_location("uat_promotion_migration_control", MODULE_PATH)
control = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(control)


def iso(value):
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class UatPromotionMigrationControlTest(unittest.TestCase):
    def fixture(self):
        now = datetime.now(timezone.utc)
        created = now - timedelta(minutes=1)
        expires = now + timedelta(minutes=5)
        entries = [
            {"ordinal": 1, "filename": "0040_runtime_contract.sql", "sha256": "1" * 64},
            {"ordinal": 2, "filename": "0046_runtime_lock_privilege_boundary.sql", "sha256": "2" * 64},
        ]
        worker_image = f"registry.example.invalid/chenyida/worker@sha256:{'4' * 64}"
        manifest = {
            "schema_version": 2,
            "contract": "chenyida-erp-release-manifest/v2",
            "promotion_status": "ELIGIBLE",
            "allowed_deployment_classes": ["UAT"],
            "source": {"package_version": "0.1.0-alpha.47", "git_commit": "5" * 40},
            "images": {"worker": {"image_reference": worker_image, "image_digest": f"sha256:{'6' * 64}"}},
            "migrations": {
                "head": entries[-1]["filename"], "allowlist_sha256": "7" * 64, "entries": entries,
            },
        }
        manifest_raw = control.canonical_json(manifest)
        parameters = {
            "promotion_state_root": str(control.STATE_ROOT),
            "promotion_id": "promotion-control-fixture",
            "promotion_generation": 1,
            "previous_checkpoint_receipt_sha256": "8" * 64,
            "promotion_intent_sha256": "9" * 64,
            "promotion_original_authorization_sha256": "a" * 64,
            "migration_authorization_operation_id": "promotion-control-approval",
            "migration_authorization_intent_sha256": "b" * 64,
            "migration_authorization_intent_source": {},
            "migration_approval_authorization_sha256": "c" * 64,
            "candidate_binding_sha256": "d" * 64,
            "database_binding_sha256": "e" * 64,
            "runtime_binding_sha256": "f" * 64,
            "preupgrade_recovery_binding_sha256": "1" * 64,
            "promotion_snapshot_binding_sha256": "2" * 64,
            "writer_quiesce_binding_sha256": "3" * 64,
            "migration_authorization_binding_sha256": "4" * 64,
            "current_checkpoint_source": {},
            "runtime_identity_source": {},
            "release_manifest": "/var/lib/chenyida-erp/release-artifacts/control/release-manifest.json",
            "release_manifest_sha256": control.sha256(manifest_raw),
            "release_manifest_source": {},
            "deployment_class": "UAT",
            "deployment_id": "chenyida-erp",
            "database_name": "chenyida_erp",
            "database_oid": "16384",
            "database_system_identifier": "7612345678901234567",
            "database_marker": "chenyida-erp-deployment/v2:UAT:chenyida-erp",
            "expected_current_migration_head": entries[0]["filename"],
            "target_migration_head": entries[-1]["filename"],
            "migration_manifest_sha256": manifest["migrations"]["allowlist_sha256"],
            "migration_role": "chenyida_erp_owner",
            "control_role": "postgres",
            "worker_image": worker_image,
            "postgres_container": "chenyida-erp-postgres-1",
            "postgres_container_id": "5" * 64,
            "postgres_image_digest": f"sha256:{'6' * 64}",
            "backend_network": "chenyida-erp_backend",
            "execution_created_at": iso(created),
            "execution_expires_at": iso(expires),
            "requester_identity_sha256": "7" * 64,
            "approver_identity_sha256": "8" * 64,
            "executor_identity_sha256": "9" * 64,
            "policy_file_sha256": "a" * 64,
            "policy_sha256": "b" * 64,
        }
        context = {
            "schema_version": 1,
            "contract": "chenyida-erp-uat-promotion-transaction-context/v1",
            "operation_id": "promotion-control-execution",
            "operation": "MIGRATION_EXECUTION",
            "execution_mode": "ORIGINAL",
            "execution_authorization_id": "promotion-control-execution",
            "execution_authorization_sha256": "d" * 64,
            "execution_created_at": parameters["execution_created_at"],
            "original_authorization_sha256": "d" * 64,
            "supervisor_bundle_sha256": "e" * 64,
            "expected_intent_sha256": None,
            "parameters": parameters,
        }
        grant_body = {
            "schema_version": 1,
            "contract": "chenyida-erp-uat-promotion-migration-execution-grant/v1",
            "execution_scope": "SUPERVISOR_CONTROLLED_UAT_MIGRATION",
            "promotion_id": parameters["promotion_id"],
            "migration_operation_id": context["operation_id"],
            "execution_authorization_sha256": context["execution_authorization_sha256"],
            "migration_approval_authorization_sha256": parameters["migration_approval_authorization_sha256"],
            "migration_approval_receipt_sha256": parameters["previous_checkpoint_receipt_sha256"],
            "migration_authorization_binding_sha256": parameters["migration_authorization_binding_sha256"],
            "promotion_intent_sha256": parameters["promotion_intent_sha256"],
            "candidate_binding_sha256": parameters["candidate_binding_sha256"],
            "database_binding_sha256": parameters["database_binding_sha256"],
            "runtime_binding_sha256": parameters["runtime_binding_sha256"],
            "recovery_binding_sha256": parameters["preupgrade_recovery_binding_sha256"],
            "promotion_snapshot_binding_sha256": parameters["promotion_snapshot_binding_sha256"],
            "writer_quiesce_binding_sha256": parameters["writer_quiesce_binding_sha256"],
            "supervisor_bundle_sha256": context["supervisor_bundle_sha256"],
            "release_manifest_sha256": parameters["release_manifest_sha256"],
            "worker_image": parameters["worker_image"],
            "migration_manifest_sha256": parameters["migration_manifest_sha256"],
            "expected_current_head": parameters["expected_current_migration_head"],
            "target_head": parameters["target_migration_head"],
            "database": {
                "deployment_class": "UAT", "deployment_id": "chenyida-erp",
                "database_name": "chenyida_erp", "database_system_identifier": parameters["database_system_identifier"],
                "database_oid": parameters["database_oid"], "database_marker": parameters["database_marker"],
                "migration_role": "chenyida_erp_owner", "control_role": "postgres",
            },
            "created_at": parameters["execution_created_at"], "expires_at": parameters["execution_expires_at"],
        }
        grant = {**grant_body, "grant_sha256": control.object_sha256(grant_body)}
        rows = [{"version": entry["filename"], "checksum": entry["sha256"]} for entry in entries]
        engine_body = {
            "schema_version": 1,
            "contract": "chenyida-erp-uat-promotion-migration-engine-result/v1",
            "status": "MIGRATION_COMMITTED",
            "promotion_id": parameters["promotion_id"],
            "migration_operation_id": context["operation_id"],
            "execution_authorization_sha256": context["execution_authorization_sha256"],
            "grant_sha256": grant["grant_sha256"],
            "database_name": parameters["database_name"],
            "database_system_identifier": parameters["database_system_identifier"],
            "database_oid": parameters["database_oid"],
            "database_marker": parameters["database_marker"],
            "migration_role": "chenyida_erp_owner",
            "application_name": "chenyida-erp-migration",
            "current_head_before": entries[0]["filename"],
            "target_head": entries[-1]["filename"],
            "started_at": iso(now - timedelta(seconds=20)),
            "completed_at": iso(now - timedelta(seconds=10)),
            "files": [
                {"filename": entries[0]["filename"], "sha256": entries[0]["sha256"], "outcome": "ALREADY_APPLIED"},
                {"filename": entries[1]["filename"], "sha256": entries[1]["sha256"], "outcome": "APPLIED"},
            ],
            "final_migration_rows_sha256": control.object_sha256(rows),
            "final_migration_rows_count": len(rows),
            "other_backend_count_before": 0,
            "other_backend_count_after": 0,
            "database_default_transaction_read_only": "on",
            "migration_transaction_read_only": "off",
        }
        engine = {**engine_body, "engine_result_sha256": control.object_sha256(engine_body)}
        return context, parameters, manifest, manifest_raw, grant, engine

    def environment(self, context):
        return {
            "ERP_RELEASE_SUPERVISOR_LAUNCHED": "YES",
            "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED": "YES",
            "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256": context["execution_authorization_sha256"],
            "ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256": context["supervisor_bundle_sha256"],
        }

    def recovery_environment(self, context):
        return {
            **self.environment(context),
            "ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED": "YES",
        }

    def fence(self, context, parameters, phase, observed_at):
        body = {
            "schema_version": 1,
            "contract": "chenyida-erp-uat-promotion-migration-database-fence/v1",
            "phase": phase,
            "promotion_id": parameters["promotion_id"],
            "migration_operation_id": context["operation_id"],
            "execution_authorization_sha256": context["execution_authorization_sha256"],
            "database_name": parameters["database_name"],
            "database_system_identifier": parameters["database_system_identifier"],
            "database_oid": parameters["database_oid"],
            "database_marker": parameters["database_marker"],
            "control_role": "postgres",
            "control_superuser": True,
            "database_allow_connections": phase == "BEFORE",
            "default_transaction_read_only": "on",
            "database_setting_count": 1,
            "database_connection_limit": 1 if phase == "BEFORE" else 0,
            "other_backend_count": 0,
            "managed_roles": control.MANAGED_ROLES,
            "login_roles": control.LOGIN_ROLES,
            "connect_roles": ["chenyida_erp_owner"],
            "platform_superuser_roles": ["postgres"],
            "public_connect": False,
            "public_temporary": False,
            "unknown_connect_acl_count": 0,
            "unknown_connect_login_count": 0,
            "prepared_transaction_count": 0,
            "role_records": control.EXPECTED_ROLE_RECORDS,
            "memberships": control.EXPECTED_MEMBERSHIPS,
            "non_owner_database_acl": [],
            "database_owner_privileges": ["CONNECT", "CREATE", "TEMPORARY"],
            "observed_at": observed_at,
        }
        return {**body, "fence_sha256": control.object_sha256(body)}

    def test_grant_manifest_and_engine_bind_exactly(self):
        context, parameters, manifest, manifest_raw, grant, engine = self.fixture()
        with patch.dict(os.environ, self.environment(context), clear=False):
            validated_context, validated_parameters = control.validate_context(context, grant["grant_sha256"])
        self.assertEqual(validated_context, context)
        self.assertEqual(validated_parameters, parameters)
        self.assertEqual(control.validate_manifest(manifest_raw, parameters), manifest)
        self.assertEqual(
            control.validate_grant(control.canonical_json(grant), context, parameters, grant["grant_sha256"]),
            grant,
        )
        self.assertEqual(
            control.validate_engine(control.canonical_json(engine), context, parameters, manifest, grant), engine,
        )
        changed = json.loads(control.canonical_json(engine))
        changed["files"][1]["outcome"] = "ALREADY_APPLIED"
        engine_body = {key: value for key, value in changed.items() if key != "engine_result_sha256"}
        changed["engine_result_sha256"] = control.object_sha256(engine_body)
        with self.assertRaisesRegex(control.MigrationControlError, "MIGRATION_CONTROL_ENGINE_RESULT_INVALID"):
            control.validate_engine(control.canonical_json(changed), context, parameters, manifest, grant)

    def test_fence_sql_validates_exact_baseline_before_mutation_and_has_a_final_seal(self):
        install = control.FENCE_INSTALL_SQL
        self.assertLess(
            install.index("raise exception 'migration fence precondition invalid'"),
            install.index("alter database chenyida_erp allow_connections false"),
        )
        self.assertIn("is distinct from (select marker from pg_temp.chenyida_erp_migration_expected)", install)
        self.assertIn("a.grantor,a.grantee,a.privilege_type,a.is_grantable", control.FENCE_PROBE_SQL)
        self.assertIn("alter database chenyida_erp allow_connections false", control.FENCE_SEAL_SQL)
        self.assertIn("alter database chenyida_erp connection limit 0", control.FENCE_SEAL_SQL)
        self.assertIn("where datname='chenyida_erp'", control.EMERGENCY_SEAL_SQL)
        self.assertNotIn("down.sql", install.lower())

    def test_candidate_containment_escalates_from_stop_to_kill_and_proves_exit(self):
        context, parameters, manifest, _manifest_raw, grant, _engine = self.fixture()
        container_id = "8" * 64
        name = f"cyd-uat-migration-{context['execution_authorization_sha256'][:24]}"

        def inspection(running, status):
            return {
                "Id": container_id,
                "Name": f"/{name}",
                "Image": manifest["images"]["worker"]["image_digest"],
                "Config": {"Labels": {
                    "chenyida.erp.uat-migration-operation": context["operation_id"],
                    "chenyida.erp.uat-migration-grant": grant["grant_sha256"],
                }},
                "State": {"Running": running, "Restarting": False, "Status": status},
            }

        commands = []
        with patch.object(
                control, "docker_inspect",
                side_effect=[inspection(True, "running"), inspection(True, "running"), inspection(False, "exited")],
        ), patch.object(
                control, "docker",
                side_effect=lambda arguments, **_kwargs: commands.append(arguments),
        ):
            control.contain_candidate(container_id, name, context, parameters, manifest, grant)
        self.assertEqual(commands[0][:4], ["container", "stop", "--time", "10"])
        self.assertEqual(commands[1][:4], ["container", "kill", "--signal", "KILL"])

    def test_release_bundle_staging_rejects_hardlinks_symlinks_and_source_replacement(self):
        _context, _parameters, _manifest, manifest_raw, _grant, _engine = self.fixture()

        def roots(base):
            source = base / "source"
            target = base / "target"
            source.mkdir(mode=0o750)
            target.mkdir(mode=0o750)
            source.chmod(0o750)
            target.chmod(0o750)
            manifest_file = source / "release-manifest.json"
            marker_file = source / ".chenyida-erp-release-artifact-root-v1"
            manifest_file.write_bytes(manifest_raw)
            marker_file.write_bytes(b"chenyida-erp-release-artifact-root/v1\n")
            manifest_file.chmod(0o440)
            marker_file.chmod(0o440)
            return source, target, manifest_file, marker_file

        with tempfile.TemporaryDirectory(prefix="cyd-migration-stage-ok-") as temporary:
            source, target, _manifest_file, _marker_file = roots(Path(temporary))
            control.stage_release_bundle(source, target, manifest_raw)
            self.assertEqual(
                {path.name for path in target.iterdir()},
                {"release-manifest.json", ".chenyida-erp-release-artifact-root-v1"},
            )

        with tempfile.TemporaryDirectory(prefix="cyd-migration-stage-hardlink-") as temporary:
            base = Path(temporary)
            source, target, _manifest_file, marker_file = roots(base)
            os.link(marker_file, base / "marker-hardlink")
            with self.assertRaisesRegex(control.MigrationControlError, "MIGRATION_CONTROL_MANIFEST_BUNDLE_INVALID"):
                control.stage_release_bundle(source, target, manifest_raw)

        with tempfile.TemporaryDirectory(prefix="cyd-migration-stage-symlink-") as temporary:
            base = Path(temporary)
            source, target, manifest_file, _marker_file = roots(base)
            real_manifest = base / "real-manifest.json"
            real_manifest.write_bytes(manifest_raw)
            real_manifest.chmod(0o440)
            manifest_file.unlink()
            manifest_file.symlink_to(real_manifest)
            with self.assertRaisesRegex(control.MigrationControlError, "MIGRATION_CONTROL_MANIFEST_BUNDLE_INVALID"):
                control.stage_release_bundle(source, target, manifest_raw)

        with tempfile.TemporaryDirectory(prefix="cyd-migration-stage-replaced-") as temporary:
            source, target, _manifest_file, _marker_file = roots(Path(temporary))
            with patch.object(control, "directory_identity", side_effect=[(1,), (2,)]):
                with self.assertRaisesRegex(control.MigrationControlError, "MIGRATION_CONTROL_MANIFEST_ROOT_CHANGED"):
                    control.stage_release_bundle(source, target, manifest_raw)

    def test_execute_persists_forensic_artifacts_and_result_without_removing_container(self):
        context, parameters, manifest, manifest_raw, grant, engine = self.fixture()
        now = datetime.now(timezone.utc)
        before = self.fence(context, parameters, "BEFORE", iso(now - timedelta(seconds=8)))
        after = self.fence(context, parameters, "AFTER", iso(now - timedelta(seconds=5)))
        baseline_body = {
            "schema_version": 1,
            "contract": "chenyida-erp-uat-promotion-migration-released-baseline/v1",
            "status": "EXACT_RELEASED_BASELINE",
            "observed_at": iso(now - timedelta(seconds=9)),
            "database_name": parameters["database_name"],
        }
        baseline = {**baseline_body, "baseline_sha256": control.object_sha256(baseline_body)}
        with tempfile.TemporaryDirectory(prefix="cyd-migration-control-") as temporary:
            base = Path(temporary)
            state = base / "state"
            grants = state / "grants"
            results = state / "results"
            executions = state / "executions"
            active_fences = state / "active-fences"
            for directory in (state, grants, results, executions, active_fences):
                directory.mkdir(mode=0o700)
                directory.chmod(0o700)
            release = base / "release"
            release.mkdir(mode=0o750)
            release.chmod(0o750)
            manifest_file = release / "release-manifest.json"
            manifest_file.write_bytes(manifest_raw)
            manifest_file.chmod(0o440)
            marker = release / ".chenyida-erp-release-artifact-root-v1"
            marker.write_bytes(b"chenyida-erp-release-artifact-root/v1\n")
            marker.chmod(0o440)
            parameters["promotion_state_root"] = str(state)
            parameters["release_manifest"] = str(manifest_file)
            context["parameters"] = parameters
            grant_body = {key: value for key, value in grant.items() if key != "grant_sha256"}
            grant_body["release_manifest_sha256"] = control.sha256(manifest_raw)
            grant = {**grant_body, "grant_sha256": control.object_sha256(grant_body)}
            engine_body = {key: value for key, value in engine.items() if key != "engine_result_sha256"}
            engine_body["grant_sha256"] = grant["grant_sha256"]
            engine = {**engine_body, "engine_result_sha256": control.object_sha256(engine_body)}
            grant_file = grants / f"{context['operation_id']}.{grant['grant_sha256']}.json"
            grant_file.write_bytes(control.canonical_json(grant))
            grant_file.chmod(0o440)
            stopped = {"State": {"Status": "exited", "ExitCode": 0, "OOMKilled": False}, "RestartCount": 0}
            start_result = subprocess.CompletedProcess([], 0, control.canonical_json(engine), b"")
            patches = [
                patch.object(control, "STATE_ROOT", state),
                patch.object(control, "GRANTS_ROOT", grants),
                patch.object(control, "RESULTS_ROOT", results),
                patch.object(control, "EXECUTIONS_ROOT", executions),
                patch.object(control, "ACTIVE_FENCES_ROOT", active_fences),
                patch.object(control, "validate_lock", return_value=51),
                patch.object(control, "load_quiesce_evidence", return_value={}),
                patch.object(control, "verify_live_writer_quiesce"),
                patch.object(control, "validate_secret_metadata"),
                patch.object(control, "validate_postgres_container"),
                patch.object(control, "validate_candidate_image", return_value={}),
                patch.object(control, "baseline_evidence", return_value=baseline),
                patch.object(control, "install_fence"),
                patch.object(control, "seal_fence"),
                patch.object(control, "fence_evidence", side_effect=[before, before, after]),
                patch.object(control, "create_candidate", return_value=("8" * 64, "cyd-uat-migration-" + "9" * 24)),
                patch.object(control, "run_candidate", return_value=start_result.stdout),
                patch.object(control, "ledger_rows"),
            ]
            with patch.dict(os.environ, self.environment(context), clear=False), \
                    patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], \
                    patches[7], patches[8], patches[9], patches[10], patches[11], patches[12], patches[13], \
                    patches[14], patches[15], patches[16], patches[17]:
                response = control.execute(context, grant["grant_sha256"])
            self.assertEqual(response["result"], "MIGRATION_RESULT_PERSISTED")
            self.assertEqual(response["container_id"], "8" * 64)
            result_files = list(results.iterdir())
            self.assertEqual(len(result_files), 1)
            result = json.loads(result_files[0].read_text(encoding="utf-8"))
            self.assertEqual(result["engine_result"]["engine_result_sha256"], engine["engine_result_sha256"])
            execution_root = executions / f"{context['operation_id']}.{grant['grant_sha256']}"
            self.assertEqual(
                {path.name for path in execution_root.iterdir()},
                {"mounts", "released-baseline.json", "fence-before.json", "candidate.json", "engine-result.json", "fence-after.json"},
            )
            self.assertEqual(len(list(active_fences.iterdir())), 1)

    def test_recovery_seals_database_and_contains_only_the_bound_candidate(self):
        original, parameters, _manifest, manifest_raw, grant, _engine = self.fixture()
        now = datetime.now(timezone.utc)
        with tempfile.TemporaryDirectory(prefix="cyd-migration-recovery-") as temporary:
            base = Path(temporary)
            state = base / "state"
            intents = state / "intents"
            grants = state / "grants"
            results = state / "results"
            executions = state / "executions"
            active_fences = state / "active-fences"
            for directory in (state, intents, grants, results, executions, active_fences):
                directory.mkdir(mode=0o700)
                directory.chmod(0o700)
            release = base / "release"
            release.mkdir(mode=0o750)
            release.chmod(0o750)
            manifest_file = release / "release-manifest.json"
            manifest_file.write_bytes(manifest_raw)
            manifest_file.chmod(0o440)
            marker = release / ".chenyida-erp-release-artifact-root-v1"
            marker.write_bytes(b"chenyida-erp-release-artifact-root/v1\n")
            marker.chmod(0o440)
            parameters["promotion_state_root"] = str(state)
            parameters["release_manifest"] = str(manifest_file)
            original["parameters"] = parameters

            grant_body = {key: value for key, value in grant.items() if key != "grant_sha256"}
            grant = {**grant_body, "grant_sha256": control.object_sha256(grant_body)}
            grant_file = grants / f"{original['operation_id']}.{grant['grant_sha256']}.json"
            grant_file.write_bytes(control.canonical_json(grant))
            grant_file.chmod(0o440)
            intent_body = {
                "schema_version": 1,
                "contract": "chenyida-erp-uat-promotion-migration-execution-intent/v1",
                "execution_scope": "DATABASE_FENCE_AND_EXACT_ALLOWLIST_MIGRATION",
                "migration_operation_id": original["operation_id"],
                "migration_authorization_operation_id": parameters["migration_authorization_operation_id"],
                "promotion_id": parameters["promotion_id"],
                "promotion_generation": parameters["promotion_generation"],
                "created_at": parameters["execution_created_at"],
                "expires_at": parameters["execution_expires_at"],
                "execution_authorization_sha256": original["execution_authorization_sha256"],
                "migration_approval_authorization_sha256": parameters["migration_approval_authorization_sha256"],
                "supervisor_bundle_sha256": original["supervisor_bundle_sha256"],
                "parameters": parameters,
                "promotion_intent_sha256": parameters["promotion_intent_sha256"],
                "previous_checkpoint_receipt_sha256": parameters["previous_checkpoint_receipt_sha256"],
                "migration_authorization_intent_sha256": parameters["migration_authorization_intent_sha256"],
                "candidate_binding_sha256": parameters["candidate_binding_sha256"],
                "database_binding_sha256": parameters["database_binding_sha256"],
                "runtime_binding_sha256": parameters["runtime_binding_sha256"],
                "preupgrade_recovery_binding_sha256": parameters["preupgrade_recovery_binding_sha256"],
                "promotion_snapshot_binding_sha256": parameters["promotion_snapshot_binding_sha256"],
                "writer_quiesce_binding_sha256": parameters["writer_quiesce_binding_sha256"],
                "migration_authorization_binding_sha256": parameters["migration_authorization_binding_sha256"],
                "grant_sha256": grant["grant_sha256"],
            }
            intent = {
                **intent_body,
                "migration_execution_intent_sha256": control.object_sha256(intent_body),
            }
            intent_file = intents / (
                f"{original['operation_id']}.{intent['migration_execution_intent_sha256']}.json"
            )
            intent_file.write_bytes(control.canonical_json(intent))
            intent_file.chmod(0o400)

            recovery = {
                **original,
                "execution_mode": "RECOVERY",
                "execution_authorization_id": "promotion-control-recovery",
                "execution_authorization_sha256": "0" * 63 + "1",
                "execution_created_at": iso(now),
                "original_authorization_sha256": original["execution_authorization_sha256"],
                "expected_intent_sha256": intent["migration_execution_intent_sha256"],
            }
            execution_root = executions / f"{original['operation_id']}.{grant['grant_sha256']}"
            candidate_mount = execution_root / "mounts" / "candidate"
            promotion_mount = execution_root / "mounts" / "promotion"
            candidate_mount.mkdir(parents=True, mode=0o750)
            promotion_mount.mkdir(mode=0o750)
            execution_root.chmod(0o700)
            (execution_root / "mounts").chmod(0o750)
            candidate_mount.chmod(0o750)
            promotion_mount.chmod(0o750)
            for source in release.iterdir():
                target = candidate_mount / source.name
                target.write_bytes(source.read_bytes())
                target.chmod(0o440)
            staged_grant = promotion_mount / "migration-execution-grant.json"
            staged_grant.write_bytes(control.canonical_json(grant))
            staged_grant.chmod(0o440)
            container_id = "8" * 64
            container_name = f"cyd-uat-migration-{original['execution_authorization_sha256'][:24]}"
            candidate_body = {
                "schema_version": 1,
                "contract": "chenyida-erp-uat-promotion-migration-candidate/v1",
                "status": "CREATED",
                "promotion_id": parameters["promotion_id"],
                "migration_operation_id": original["operation_id"],
                "grant_sha256": grant["grant_sha256"],
                "container_id": container_id,
                "container_name": container_name,
                "worker_image": parameters["worker_image"],
                "created_at": iso(now - timedelta(seconds=10)),
            }
            candidate = {**candidate_body, "candidate_sha256": control.object_sha256(candidate_body)}
            candidate_file = execution_root / "candidate.json"
            candidate_file.write_bytes(control.canonical_json(candidate))
            candidate_file.chmod(0o400)
            active_body = {
                "schema_version": 1,
                "contract": "chenyida-erp-uat-promotion-active-migration-fence/v1",
                "status": "ACTIVE_UNTIL_EXPLICIT_CHECKPOINT_9_TRANSFER_OR_QUARANTINE_RESOLUTION",
                "promotion_id": parameters["promotion_id"],
                "migration_operation_id": original["operation_id"],
                "execution_authorization_sha256": original["execution_authorization_sha256"],
                "grant_sha256": grant["grant_sha256"],
                "database_name": parameters["database_name"],
                "database_system_identifier": parameters["database_system_identifier"],
                "database_oid": parameters["database_oid"],
                "database_marker": parameters["database_marker"],
                "released_baseline_sha256": "2" * 64,
                "fence_before_sha256": "3" * 64,
                "activated_at": iso(now - timedelta(seconds=20)),
            }
            active = {**active_body, "active_fence_sha256": control.object_sha256(active_body)}
            active_file = active_fences / f"{original['operation_id']}.{active['active_fence_sha256']}.json"
            active_file.write_bytes(control.canonical_json(active))
            active_file.chmod(0o400)
            events = []
            patches = [
                patch.object(control, "STATE_ROOT", state),
                patch.object(control, "GRANTS_ROOT", grants),
                patch.object(control, "RESULTS_ROOT", results),
                patch.object(control, "EXECUTIONS_ROOT", executions),
                patch.object(control, "ACTIVE_FENCES_ROOT", active_fences),
                patch.object(control, "validate_lock", return_value=51),
                patch.object(control, "validate_secret_metadata"),
                patch.object(control, "validate_postgres_container"),
                patch.object(control, "emergency_seal_fence", side_effect=lambda *_: events.append("seal")),
                patch.object(control, "recovery_candidate_ids", return_value=[container_id]),
                patch.object(control, "contain_candidate", side_effect=lambda *_: events.append("contain")),
            ]
            with patch.dict(os.environ, self.recovery_environment(recovery), clear=False), \
                    patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], \
                    patches[6], patches[7], patches[8], patches[9], patches[10]:
                response = control.recover(recovery)
            self.assertEqual(events, ["seal", "contain"])
            self.assertEqual(response["result"], "RECOVERY_CONTAINMENT_PERSISTED")
            self.assertEqual(response["active_fence_sha256"], active["active_fence_sha256"])
            self.assertEqual(response["candidate_containment"], "EXACT_CANDIDATE_STOPPED")
            recovery_roots = [path for path in executions.iterdir() if ".recovery." in path.name]
            self.assertEqual(len(recovery_roots), 1)
            self.assertTrue((recovery_roots[0] / "recovery-containment.json").is_file())


if __name__ == "__main__":
    unittest.main()
