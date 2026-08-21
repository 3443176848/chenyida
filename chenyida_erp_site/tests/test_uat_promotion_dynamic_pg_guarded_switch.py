import base64
import copy
import datetime as dt
import hashlib
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock


SITE_ROOT = Path(__file__).resolve().parents[1]
PRODUCER_PATH = SITE_ROOT / "scripts/uat-promotion-dynamic-pg-guarded-switch.py"


def load_producer():
    spec = importlib.util.spec_from_file_location(
        "uat_promotion_dynamic_pg_guarded_switch", PRODUCER_PATH,
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PRODUCER = load_producer()


class DynamicPostgresGuardedSwitchV3Test(unittest.TestCase):
    @staticmethod
    def resource_evidence(policy, *, disk_delta=32 * 1024 * 1024, oom_delta=0):
        gib = 1024 * 1024 * 1024
        start_root = 12 * gib
        services = [{
            "service": name,
            "container_id": character * 64,
            "restart_count": 0,
            "oom_killed": False,
            "running": True,
            "health": "HEALTHY",
        } for name, character in zip(
            policy["cleanup_policy"]["protected_service_names"], "abcd", strict=True,
        )]
        started = dt.datetime(2026, 8, 21, tzinfo=dt.timezone.utc)
        samples = []
        for index in range(37):
            samples.append({
                "captured_at": (started + dt.timedelta(seconds=index * 5)).isoformat(
                    timespec="milliseconds",
                ).replace("+00:00", "Z"),
                "elapsed_milliseconds": index * 5000,
                "available_memory_bytes": 2 * gib,
                "swap_used_bytes": 128 * 1024 * 1024,
                "swap_total_bytes": gib,
                "root_available_bytes": start_root if index < 36
                else start_root - disk_delta,
                "load1": 0.25,
                "oom_kill_count": oom_delta if index == 36 else 0,
                "services": services,
            })
        body = {
            "boot_id_sha256": "e" * 64,
            "sample_interval_seconds": 5,
            "sample_count": len(samples),
            "sample_window_seconds": 180,
            "preflight_sample_window_seconds": 60,
            "samples": samples,
            "minimum_available_memory_bytes": 2 * gib,
            "maximum_swap_percent_observed": 12.5,
            "maximum_rolling_swap_growth_bytes": 0,
            "minimum_root_available_bytes": start_root - disk_delta,
            "maximum_load1_observed": 0.25,
            "oom_kill_delta": oom_delta,
            "service_restart_delta": 0,
            "declared_maximum_disk_delta_bytes":
                policy["case_catalog"][0]["maximum_disk_delta_bytes"],
            "observed_peak_disk_delta_bytes": disk_delta,
            "result": "PASS",
        }
        return {
            **body,
            "resource_evidence_sha256": PRODUCER.LEGACY.digest_value(body),
        }

    @staticmethod
    def report_raw():
        return (
            "RELATION\t7075626c69632e6170705f7573657273\t0\t"
            f"{hashlib.sha256(b'synthetic-empty-app-users').hexdigest()}\n"
            "LARGE_OBJECTS\t0\t0\t"
            f"{hashlib.sha256(b'0:0:0:0:0:0').hexdigest()}\n"
        ).encode()

    @classmethod
    def inputs(cls):
        policy = PRODUCER.load_policy()
        records, ledger = PRODUCER.migration_sources(policy)
        inputs = PRODUCER.materialize_inputs(
            identity={
                "system_identifier": "7612345678901234567",
                "server_version_num": "170010",
                "active_oid": "16384", "staging_oid": "16385",
            },
            container_id="a" * 64,
            image_reference=policy["case_catalog"][0]["postgres_image_reference"],
            image_id=f"sha256:{'b' * 64}", git_commit="c" * 40,
            application_version="0.1.0-alpha.47",
            migration_ledger=ledger, report_raw=cls.report_raw(),
            database_bytes=16 * 1024 * 1024,
        )
        return policy, records, ledger, inputs

    @staticmethod
    def container_inspect(policy, run_id, container_name, image, *, scope="v3"):
        limits = policy["case_catalog"][0]["container_limits"]
        labels = PRODUCER.v3_expected_labels(policy, run_id)
        if scope == "v2":
            labels["chenyida.erp.execution-scope"] = "isolated-synthetic-test"
        return {
            "Id": "a" * 64,
            "Name": f"/{container_name}",
            "Created": "2026-08-21T00:00:00.000000000Z",
            "Image": image["id"],
            "Mounts": [],
            "Config": {
                "Labels": labels,
                "Image": policy["case_catalog"][0]["postgres_image_reference"],
                "User": limits["user"],
                "Env": [
                    "POSTGRES_HOST_AUTH_METHOD=trust",
                    "POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=C",
                    "PGDATA=/var/lib/postgresql/data/pgdata",
                ],
                "StopTimeout": limits["stop_timeout_seconds"],
                "Cmd": [
                    "postgres", "-c", "listen_addresses=*", "-c",
                    "unix_socket_directories=/var/run/postgresql", "-c",
                    "max_connections=20", "-c", "shared_buffers=64MB", "-c",
                    "log_statement=none",
                ],
            },
            "HostConfig": {
                "Tmpfs": {
                    target: f"{spec['options']},size={spec['size_bytes']}"
                    for target, spec in limits["tmpfs"].items()
                },
                "RestartPolicy": {"Name": "no"},
                "LogConfig": {"Type": "none"},
                "NetworkMode": limits["network_mode"],
                "ReadonlyRootfs": True,
                "CapDrop": ["ALL"],
                "CapAdd": [],
                "SecurityOpt": ["no-new-privileges"],
                "Privileged": False,
                "Memory": limits["memory_bytes"],
                "MemorySwap": limits["memory_swap_bytes"],
                "NanoCpus": 1_000_000_000,
                "PidsLimit": limits["pids"],
                "ShmSize": limits["shared_memory_bytes"],
                "Devices": [],
                "Binds": [],
                "PortBindings": {},
                "PublishAllPorts": False,
            },
            "State": {"Running": False},
        }

    def test_v3_policy_is_closed_partial_and_keeps_v2_frozen(self):
        policy = PRODUCER.load_policy()
        self.assertEqual(policy["schema_version"], 3)
        self.assertEqual(policy["audit_clearance"], "PARTIAL_ONLY")
        self.assertEqual(policy["production_opcode"], "PG_RB_GUARDED_SWITCH_V3")
        self.assertEqual(policy["source_paths"], sorted(policy["source_paths"]))
        self.assertEqual(
            policy["case_catalog"][0]["required_scenarios"],
            [
                "EXACT_V3_SUCCESS", "REPEAT_FAIL_CLOSED",
                "CONTENT_DRIFT_REJECTED", "MIGRATION_LEDGER_DRIFT_REJECTED",
                "SECURITY_DRIFT_REJECTED", "ORDINARY_ROLE_CONNECTION_REJECTED",
                "FIRST_RENAME_FAULT_ROLLBACK",
                "PRECOMMIT_OLD_SINGLE_RECOVERY_REPLAY",
                "RECOVERY_ATTEMPT_UNKNOWN_NO_SECOND_REPLAY",
                "COMMIT_RESPONSE_LOSS_NO_REPLAY",
            ],
        )
        self.assertEqual(policy["historical_v2_status"], "FROZEN_UNCHANGED")
        self.assertIn(
            "DOES_NOT_PROVE_CONCURRENT_NONCOOPERATING_ROOT_OR_POSTGRESQL_SUPERUSER_EXCLUSION",
            policy["required_non_claims"],
        )
        self.assertIn(
            "DOES_NOT_PROVE_REAL_DATA_VOLUME_FINISHES_WITHIN_240_SECOND_CONTENT_TIMEOUT",
            policy["required_non_claims"],
        )
        self.assertIn(
            "DOES_NOT_PROVE_PROCESS_TERMINATION_OR_FRESH_PROCESS_RESTART_RECOVERY",
            policy["required_non_claims"],
        )
        self.assertIn(
            "DOES_NOT_PROVE_TRANSPORT_LEVEL_POSTGRESQL_COMMIT_RESPONSE_LOSS",
            policy["required_non_claims"],
        )
        self.assertEqual(
            policy["sql_evidence"]["reconciliation_normalized_sha256"],
            "067255c7e6b319dbea1660bebca1b3259bb6e61363f5818ec88f226fc99ce339",
        )
        self.assertEqual(
            policy["sql_evidence"]["production_normalized_sha256"],
            "b4e0c24f4e7852980fd090c073912957782571723ef502e8c21763c67f96a140",
        )

    def test_sql_normalization_distinguishes_bound_content_hex_from_unknown_digest(self):
        bound = hashlib.sha256(b"task70-bound-content").hexdigest()
        large_objects = hashlib.sha256(b"0:0:0:0:0:0").hexdigest()
        long_identity = "61" * 20 + "016384" + "61" * 17
        exact_sha_length_identity = "62" * 32
        long_extension = "65" * 40
        roots = {
            "base": {
                "postgres": {"system_identifier": "7612345678901234567"},
                "databases": {
                    "active_name": "chenyida_erp",
                    "staging_name": "chenyida_erp_rb_deadbeefdeadbeef",
                    "candidate_oid": "16384",
                },
                "bound_sha256": bound,
            },
            "fixture": {
                "restored_oid": "16385",
                "content_report_rows": [
                    ["RELATION", long_identity, "16384", bound],
                    ["SEQUENCE", exact_sha_length_identity, "16385", "false"],
                    ["EXTENSION", long_extension, "31", "7075626c6963"],
                    ["LARGE_OBJECTS", "0", "0", large_objects],
                ],
            },
        }
        raw = (
            "SELECT (SELECT system_identifier::text FROM "
            "pg_catalog.pg_control_system()) <> '7612345678901234567';\n"
            "SELECT d.datname='chenyida_erp_rb_deadbeefdeadbeef' "
            "AND d.oid::text='16385';\n"
            "SELECT d.datname='chenyida_erp' AND d.oid::text='16384';\n"
            "SELECT $json${\"target\":{\"database_oid\":\"16385\","
            f"\"marker_sha256\":\"{bound}\"}}}}$json$;\n"
            f"SELECT '{long_identity}','{exact_sha_length_identity}';\n"
            f"SELECT '[[\"{long_extension}\",\"31\",\"7075626c6963\"]]'::jsonb;\n"
            "SELECT '16384','16385';\n"
        ).encode()
        normalized = PRODUCER.normalize_sql(
            raw, roots, sql_kind="PRODUCTION",
        )
        text = normalized.decode()
        self.assertIn(f"'{long_identity}'", text)
        self.assertIn(f"'{exact_sha_length_identity}'", text)
        self.assertIn(f'\"{long_extension}\"', text)
        self.assertNotIn(bound, text)
        self.assertIn("{{DV70:PATH_SET_2_SHA256_", text)
        self.assertIn("{{DV70:SYSTEM_IDENTIFIER}}", text)
        self.assertIn("{{DV70:CANDIDATE_OID}}", text)
        self.assertIn("{{DV70:RESTORED_OID}}", text)
        self.assertIn("SELECT '16384','16385';", text)
        self.assertEqual(
            hashlib.sha256(normalized).hexdigest(),
            "9d3eea6bfc39a1d4ec16849bb2ae3f68c9585ddcf4681bca95ae905175c8713b",
        )
        for invalid in (
                f"SELECT '{'63' * 32}';\n".encode(),
                f"SELECT '{'64' * 40}';\n".encode(),
                f"-- {exact_sha_length_identity}\nSELECT true;\n".encode(),
        ):
            with self.subTest(invalid=invalid[:24]), self.assertRaisesRegex(
                    PRODUCER.DynamicGuardedSwitchError,
                    "TASK70_V3_SQL_NORMALIZATION_INVALID",
            ):
                PRODUCER.normalize_sql(invalid, roots)
        expanded = ((bound + "\n") * 14_000).encode()
        self.assertLess(len(expanded), PRODUCER.SQL_EVIDENCE_MAX_BYTES)
        with self.assertRaisesRegex(
                PRODUCER.DynamicGuardedSwitchError,
                "TASK70_V3_SQL_NORMALIZATION_INVALID",
        ):
            PRODUCER.compressed_sql_evidence(expanded, roots)

    def test_primary_sql_normalization_reports_the_exact_failing_phase(self):
        policy = PRODUCER.load_policy()
        reconciliation = {
            "normalized_sha256":
                policy["sql_evidence"]["reconciliation_normalized_sha256"],
        }
        production = {
            "normalized_sha256":
                policy["sql_evidence"]["production_normalized_sha256"],
        }
        PRODUCER.validate_primary_sql_normalization(
            policy, reconciliation, production,
        )
        with self.assertRaisesRegex(
                PRODUCER.DynamicGuardedSwitchError,
                "TASK70_V3_RECONCILIATION_SQL_NORMALIZATION_INVALID",
        ):
            PRODUCER.validate_primary_sql_normalization(
                policy, {"normalized_sha256": "0" * 64}, production,
            )
        with self.assertRaisesRegex(
                PRODUCER.DynamicGuardedSwitchError,
                "TASK70_V3_PRODUCTION_SQL_NORMALIZATION_INVALID",
        ):
            PRODUCER.validate_primary_sql_normalization(
                policy, reconciliation, {"normalized_sha256": "0" * 64},
            )

    def test_fixed_executor_receipts_bind_exact_outputs_order_and_failure_reason(self):
        _policy, _records, _ledger, inputs = self.inputs()
        base = PRODUCER.EXECUTOR.derive_pg_rollback_base_spec(inputs)
        sql = b"SELECT true;\n"
        opcode = {
            "phase": "guardedswitch",
            "database": base["databases"]["staging_name"],
            "opcode": "PG_RB_GUARDED_SWITCH_V3",
            "sql_sha256": hashlib.sha256(sql).hexdigest(),
        }

        def receipt(sequence, return_code, stdout, stderr):
            arguments = PRODUCER.fixed_executor_psql_arguments(base, opcode)
            body = {
                "schema_version": 1,
                "contract": PRODUCER.FIXED_EXECUTION_RECEIPT_CONTRACT,
                "sequence": sequence, "phase": "guardedswitch",
                "arguments": arguments,
                "arguments_sha256": PRODUCER.digest_value(arguments),
                "environment": PRODUCER.FIXED_EXECUTION_ENVIRONMENT,
                "environment_sha256": PRODUCER.digest_value(
                    PRODUCER.FIXED_EXECUTION_ENVIRONMENT,
                ),
                "stdin_present": True, "stdin_bytes": len(sql),
                "stdin_sha256": hashlib.sha256(sql).hexdigest(),
                "timeout_milliseconds": 300_000,
                "maximum_output_bytes": 4 * 1024 * 1024,
                "side_effects_started": True, "return_code": return_code,
                "stdout_base64": base64.b64encode(stdout).decode("ascii"),
                "stdout_bytes": len(stdout),
                "stdout_sha256": hashlib.sha256(stdout).hexdigest(),
                "stderr_base64": base64.b64encode(stderr).decode("ascii"),
                "stderr_bytes": len(stderr),
                "stderr_sha256": hashlib.sha256(stderr).hexdigest(),
                "daemon_state": "COMPLETED_NO_UNTRACKED_PROCESS",
            }
            return PRODUCER.with_digest(body, "execution_receipt_sha256")

        success = receipt(2, 0, b"t\n", b"")
        ack = PRODUCER.EXECUTOR.parse_pg_mutation_ack(
            b"t\n", "PG_RB_GUARDED_SWITCH_V3",
        )
        PRODUCER.validate_mutation_ack_execution_binding(
            ack, success, base=base, opcode=opcode, sql=sql, sequence=2,
        )

        missing_database = receipt(3, 2, b"", (
            "psql: error: connection to server on socket "
            '"/var/run/postgresql/.s.PGSQL.5432" failed: FATAL:  database '
            f'"{base["databases"]["staging_name"]}" does not exist\n'
        ).encode())
        PRODUCER.validate_guarded_failure_execution(
            missing_database, base=base, opcode=opcode, sql=sql, sequence=3,
            reason="TARGET_DATABASE_MISSING",
        )
        content = receipt(
            4, 3, b"\n", b"ERROR:  guarded switch relation content mismatch\n",
        )
        PRODUCER.validate_guarded_failure_execution(
            content, base=base, opcode=opcode, sql=sql, sequence=4,
            reason="CONTENT_GUARD_RELATION_MISMATCH",
        )
        security = receipt(
            6, 3, b"\nguarded switch runtime privilege mismatch\n", b"",
        )
        PRODUCER.validate_guarded_failure_execution(
            security, base=base, opcode=opcode, sql=sql, sequence=6,
            reason="RUNTIME_PRIVILEGE_MISMATCH",
        )

        for changed in (
                {**copy.deepcopy(success), "sequence": 3},
                {**copy.deepcopy(success), "stdout_base64": "dAr="},
        ):
            body = {key: value for key, value in changed.items()
                    if key != "execution_receipt_sha256"}
            changed["execution_receipt_sha256"] = PRODUCER.digest_value(body)
            with self.assertRaisesRegex(
                PRODUCER.DynamicGuardedSwitchError,
                "TASK70_V3_FIXED_EXECUTION_RECEIPT_INVALID",
            ):
                PRODUCER.validate_fixed_execution_receipt(
                    changed, base=base, opcode=opcode, sql=sql, sequence=2,
                )

        forged_content = copy.deepcopy(content)
        raw = bytearray(base64.b64decode(forged_content["stderr_base64"]))
        raw[0] ^= 0x80
        forged = bytes(raw)
        forged_content.update({
            "stderr_base64": base64.b64encode(forged).decode("ascii"),
            "stderr_bytes": len(forged),
            "stderr_sha256": hashlib.sha256(forged).hexdigest(),
        })
        body = {key: value for key, value in forged_content.items()
                if key != "execution_receipt_sha256"}
        forged_content["execution_receipt_sha256"] = PRODUCER.digest_value(body)
        with self.assertRaisesRegex(
            PRODUCER.DynamicGuardedSwitchError,
            "TASK70_V3_GUARDED_FAILURE_EXECUTION_INVALID",
        ):
            PRODUCER.validate_guarded_failure_execution(
                forged_content, base=base, opcode=opcode, sql=sql, sequence=4,
                reason="CONTENT_GUARD_RELATION_MISMATCH",
            )

    def test_fixture_binds_all_real_migrations_and_current_policy_sources(self):
        policy, records, ledger, inputs = self.inputs()
        base = PRODUCER.EXECUTOR.derive_pg_rollback_base_spec(inputs)
        migration = PRODUCER.EXECUTOR.validate_migration_ledger(
            ledger,
            expected_ledger_file_sha256=base["snapshot"]["migration_ledger_file_sha256"],
            expected_allowlist_sha256=base["snapshot"]["migration_allowlist_sha256"],
            expected_head=base["snapshot"]["migration_head"],
        )
        self.assertEqual(len(records), 46)
        self.assertEqual(migration["count"], 46)
        self.assertEqual(migration["head"], "0046_runtime_lock_privilege_boundary.sql")
        self.assertEqual(records[0]["version"], "0001_selfhost_baseline.sql")
        self.assertEqual(
            records[-1]["version"], policy["migration_fixture"]["expected_head"],
        )
        self.assertEqual(base["security"]["database_owner"], "chenyida_erp_owner")

    def test_production_v3_sql_reproves_content_security_and_migration_before_rename(self):
        _policy, _records, _ledger, inputs = self.inputs()
        executor = PRODUCER.EXECUTOR
        base = executor.derive_pg_rollback_base_spec(inputs)
        material = executor._postgres_guarded_switch_material(
            base, inputs, restored_oid="16385",
        )
        source = {
            "source_reconciliation_sha256":
                base["snapshot"]["source_reconciliation_sha256"],
            "expected_content_report_sha256": material["report"]["sha256"],
            "migration_ledger_file_sha256":
                material["migration"]["ledger_file_sha256"],
            "migration_allowlist_sha256": material["migration"]["allowlist_sha256"],
            "expected_security_state_sha256": material["security_state_sha256"],
        }
        bindings = {
            "privilege_receipt_sha256": "1" * 64,
            "staging_oid": "16385", "before_observation_sha256": "2" * 64,
            "staging_content_proof_sha256": "3" * 64,
            "expected_switched_identity_sha256": executor.digest_value({
                "active_name": base["databases"]["active_name"],
                "active_oid": "16385",
                "quarantine_name": base["databases"]["quarantine_name"],
                "quarantine_oid": base["databases"]["candidate_oid"],
                "state": "NEW_SEALED",
            }),
            **source,
            "guarded_state_sha256": executor.digest_value({
                **source, "staging_content_proof_sha256": "3" * 64,
                "staging_oid": "16385",
            }),
        }
        opcode = executor.derive_pg_guarded_switch_opcode_spec(base, inputs, bindings)
        sql = executor.render_pg_guarded_switch_sql(base, inputs, bindings)
        text = sql.decode()
        self.assertEqual(opcode["opcode"], "PG_RB_GUARDED_SWITCH_V3")
        self.assertEqual(hashlib.sha256(sql).hexdigest(), opcode["sql_sha256"])
        content = text.index("guarded switch relation inventory mismatch")
        security = text.index("cyd_guard_security_equal")
        migration = text.index("guarded switch migration ledger mismatch")
        connect = text.index("\\connect postgres")
        first_rename = text.index(
            'ALTER DATABASE "chenyida_erp" RENAME TO '
            '"chenyida_erp_candidate_deadbeefdeadbeef";',
        )
        self.assertLess(content, security)
        self.assertLess(security, migration)
        self.assertLess(migration, connect)
        self.assertLess(connect, first_rename)
        self.assertEqual(text.count(" RENAME TO "), 2)
        self.assertIn("0046_runtime_lock_privilege_boundary.sql", text)
        fault, boundary = PRODUCER.derive_fault_stream(sql, base)
        self.assertLess(boundary, fault.index(PRODUCER.FAULT_BARRIER.encode()))
        self.assertIn(
            b'ALTER DATABASE "chenyida_erp" RENAME TO '
            b'"chenyida_erp_candidate_deadbeefdeadbeef";', fault,
        )
        self.assertNotIn(
            b'ALTER DATABASE "chenyida_erp_rb_deadbeefdeadbeef" '
            b'RENAME TO "chenyida_erp";', fault,
        )

    def test_setup_declares_exact_roles_memberships_and_no_external_target(self):
        policy = PRODUCER.load_policy()
        privilege = PRODUCER.secure_json(
            SITE_ROOT / "operations/postgresql-runtime-privilege-policy-v2.json",
            "TEST_POLICY_INVALID",
        )
        sql = PRODUCER.setup_cluster_sql(policy, privilege).decode()
        self.assertEqual(sql.count("CREATE ROLE "), 9)
        self.assertEqual(sql.count("WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;"), 4)
        self.assertEqual(sql.count("CREATE DATABASE "), 2)
        self.assertEqual(sql.count("GRANT ALL PRIVILEGES ON TABLESPACE "), 2)
        self.assertIn(
            "GRANT ALL PRIVILEGES ON TABLESPACE pg_default TO CURRENT_USER;", sql,
        )
        self.assertIn(
            "GRANT ALL PRIVILEGES ON TABLESPACE pg_global TO CURRENT_USER;", sql,
        )
        self.assertLess(sql.index("GRANT ALL PRIVILEGES ON TABLESPACE"),
                        sql.index("CREATE DATABASE "))
        self.assertIn("CONNECTION LIMIT 64", sql)
        self.assertIn("ALLOW_CONNECTIONS false", sql)
        self.assertNotIn("chenyida-erp-parallel", sql)
        self.assertNotIn("DROP DATABASE", sql)
        self.assertNotIn("DROP ROLE", sql)
        invalid = copy.deepcopy(privilege)
        invalid["tablespaces"]["built_in"] = ["pg_default"]
        with self.assertRaisesRegex(
            PRODUCER.DynamicGuardedSwitchError,
            "TASK70_V3_TABLESPACE_FIXTURE_INVALID",
        ):
            PRODUCER.setup_cluster_sql(policy, invalid)

    def test_v3_container_identity_is_distinct_and_cleanup_projection_is_exact(self):
        policy = PRODUCER.load_policy()
        run_id = "dv70-ABCDEFGH"
        name = f"cyd-dv70-pg-v3-{run_id}"
        image = {"id": f"sha256:{'b' * 64}"}
        item = self.container_inspect(policy, run_id, name, image)
        projection = PRODUCER.v3_task_container_projection(
            item, policy=policy, run_id=run_id,
            container_name=name, image=image,
        )
        self.assertEqual(
            projection["labels"]["chenyida.erp.execution-scope"],
            "isolated-synthetic-v3-test",
        )
        cleanup = PRODUCER.v3_cleanup_identity_projection(
            item, policy=policy, run_id=run_id,
            container_name=name, image=image,
        )
        self.assertFalse(cleanup["running"])
        with self.assertRaises(PRODUCER.DynamicGuardedSwitchError):
            PRODUCER.v3_task_container_projection(
                self.container_inspect(policy, run_id, name, image, scope="v2"),
                policy=policy, run_id=run_id,
                container_name=name, image=image,
            )

    def test_projection_failure_still_invokes_exact_v3_cleanup(self):
        policy = PRODUCER.load_policy()
        run_id = "dv70-ABCDEFGH"
        name = f"cyd-dv70-pg-v3-{run_id}"
        identifier = "a" * 64
        image = {"id": f"sha256:{'b' * 64}"}
        created = subprocess.CompletedProcess(
            args=["docker", "create"], returncode=0,
            stdout=f"{identifier}\n".encode(), stderr=b"",
        )
        with mock.patch.object(
                PRODUCER, "v3_task_label_container_ids",
                side_effect=[[], [identifier]],
        ), mock.patch.object(
                PRODUCER, "v3_task_name_container_ids", return_value=[],
        ), mock.patch.object(
                PRODUCER.LEGACY, "expected_create_arguments", return_value=["create"],
        ), mock.patch.object(
                PRODUCER.LEGACY, "docker_command", return_value=created,
        ), mock.patch.object(
                PRODUCER, "v3_inspect_cleanup_identity", return_value={"running": False},
        ), mock.patch.object(
                PRODUCER, "v3_inspect_task_container",
                side_effect=PRODUCER.DynamicGuardedSwitchError(
                    "TASK70_V3_TASK_CONTAINER_INSPECT_INVALID",
                ),
        ), mock.patch.object(
                PRODUCER, "v3_cleanup_task_container", return_value=[identifier],
        ) as cleanup:
            with self.assertRaisesRegex(
                    PRODUCER.DynamicGuardedSwitchError,
                    "TASK70_V3_TASK_CONTAINER_INSPECT_INVALID",
            ):
                PRODUCER.v3_create_task_container(policy, run_id, name, image)
        cleanup.assert_called_once_with(
            identifier, policy=policy, run_id=run_id,
            container_name=name, image=image, allow_absent=True,
        )

    def test_temp_residue_discovery_is_no_follow_and_includes_every_prefixed_type(self):
        prefix = "cyd-dv70-pg-switch."
        with tempfile.TemporaryDirectory(
                prefix="task70-v3-enumeration.", dir="/tmp",
        ) as raw_parent:
            parent = Path(raw_parent)
            directory = parent / f"{prefix}directory"
            regular = parent / f"{prefix}regular"
            symlink = parent / f"{prefix}symlink"
            ignored = parent / "not-task70"
            directory.mkdir()
            regular.write_text("owned test residue\n", encoding="utf-8")
            symlink.symlink_to("/dev/null")
            ignored.mkdir()
            self.assertEqual(
                PRODUCER.enumerate_prefixed_entries(parent, prefix),
                sorted([str(directory), str(regular), str(symlink)]),
            )
            parent_alias = parent / "parent-alias"
            parent_alias.symlink_to(directory, target_is_directory=True)
            with self.assertRaisesRegex(
                    PRODUCER.DynamicGuardedSwitchError,
                    "TASK70_V3_TEMP_ROOT_DISCOVERY_INVALID",
            ):
                PRODUCER.enumerate_prefixed_entries(parent_alias, prefix)

    def test_preflight_and_cleanup_fail_closed_on_any_task_residue(self):
        policy = PRODUCER.load_policy()
        empty = {"containers": [], "networks": [], "volumes": []}
        with mock.patch.object(
                PRODUCER, "v3_all_task_docker_residue", return_value=empty,
        ), mock.patch.object(
                PRODUCER, "v3_task_temp_roots", return_value=[
                    "/tmp/cyd-dv70-pg-switch.unexpected",
                ],
        ), self.assertRaisesRegex(
                PRODUCER.DynamicGuardedSwitchError,
                "TASK70_V3_PRIOR_TASK_RESIDUE_PRESENT",
        ):
            PRODUCER.v3_preflight_task_residue(policy)

        projection = {
            "container_id": "a" * 64,
            "name": "cyd-dv70-pg-v3-dv70-ABCDEFGH",
            "labels": PRODUCER.v3_expected_labels(policy, "dv70-ABCDEFGH"),
            "created_at": "2026-08-21T00:00:00.000Z",
        }
        with mock.patch.object(
                PRODUCER, "v3_all_task_docker_residue", return_value={
                    "containers": ["b" * 64], "networks": [], "volumes": [],
                },
        ), mock.patch.object(
                PRODUCER, "v3_task_temp_roots", return_value=[],
        ), self.assertRaisesRegex(
                PRODUCER.DynamicGuardedSwitchError,
                "TASK70_V3_CLEANUP_FAILED",
        ):
            PRODUCER.v3_cleanup_receipt(
                policy=policy, run_id="dv70-ABCDEFGH",
                temp_root=Path("/tmp/cyd-dv70-pg-switch.owned"),
                container_projection=projection, removed_ids=["a" * 64],
                preexisting_residue={**empty, "temp_roots": []},
            )

    def test_ordinary_role_rejection_accepts_only_database_limit_sqlstate(self):
        database = "chenyida_erp_rb_deadbeefdeadbeef"
        role = "chenyida_erp_web"
        stdin = b"SELECT true;\n"
        argv = PRODUCER.psql_arguments(
            "a" * 64, "ordinary_role_probe", database=database,
            username=role, verbosity="verbose",
        )
        valid = subprocess.CompletedProcess(
            args=argv, returncode=2, stdout=b"",
            stderr=(
                "psql: error: connection to server on socket "
                '"/var/run/postgresql/.s.PGSQL.5432" failed: '
                f'FATAL:  53300: too many connections for database "{database}"\n'
                "LOCATION:  InitPostgres, postinit.c:1234\n"
            ).encode(),
        )
        evidence = PRODUCER.ordinary_role_connection_rejection_evidence(
            valid, argv=argv, database=database, role=role, stdin=stdin,
        )
        self.assertEqual(evidence["sqlstate"], "53300")
        self.assertEqual(
            evidence["error_code"],
            "POSTGRESQL_DATABASE_CONNECTION_LIMIT_EXHAUSTED",
        )
        self.assertEqual(evidence["exit_code"], 2)
        self.assertEqual(
            PRODUCER.base64.b64decode(evidence["stderr_base64"], validate=True),
            valid.stderr,
        )
        for stderr in (
            b"Cannot connect to the Docker daemon\n",
            b'psql: error: FATAL:  28000: role does not exist\n',
            b'psql: error: FATAL:  28P01: authentication failed\n',
            b'psql: error: FATAL:  57P03: database is not accepting commands\n',
        ):
            with self.assertRaisesRegex(
                    PRODUCER.DynamicGuardedSwitchError,
                    "TASK70_V3_ORDINARY_ROLE_CONNECTION_NOT_REJECTED",
            ):
                PRODUCER.ordinary_role_connection_rejection_evidence(
                    subprocess.CompletedProcess(
                        args=argv, returncode=2, stdout=b"", stderr=stderr,
                    ),
                    argv=argv, database=database, role=role, stdin=stdin,
                )

    def test_psql_receipt_binds_the_exact_executed_target_role_argv_and_stdin(self):
        container_id = "a" * 64
        sql = b"SELECT :'expected_database'::text;\n"
        variables = {
            "expected_database": "chenyida_erp_rb_deadbeefdeadbeef",
            "sealed_staging_mode": "1",
        }
        expected_argv = PRODUCER.psql_arguments(
            container_id, "migration_0001",
            database="chenyida_erp_rb_deadbeefdeadbeef",
            username="chenyida_erp_owner", variables=variables,
            write_override=True, verbosity="verbose",
        )
        completed = subprocess.CompletedProcess(
            args=expected_argv, returncode=0, stdout=b"", stderr=b"",
        )
        with mock.patch.object(
                PRODUCER.LEGACY, "docker_command", return_value=completed,
        ) as command:
            receipt = PRODUCER.execute_psql_success(
                container_id, "migration_0001", sql,
                database="chenyida_erp_rb_deadbeefdeadbeef",
                username="chenyida_erp_owner", variables=variables,
                write_override=True, timeout=17, maximum_output=4096,
                verbosity="verbose",
            )
        command.assert_called_once_with(
            expected_argv, input_bytes=sql, timeout=17, maximum_output=4096,
        )
        execution = receipt["execution"]
        self.assertEqual(execution["container_id"], container_id)
        self.assertEqual(execution["database"], "chenyida_erp_rb_deadbeefdeadbeef")
        self.assertEqual(execution["username"], "chenyida_erp_owner")
        self.assertTrue(execution["write_override"])
        self.assertEqual(execution["variables"], variables)
        self.assertEqual(execution["verbosity"], "verbose")
        self.assertEqual(execution["timeout_seconds"], 17)
        self.assertEqual(execution["maximum_output_bytes"], 4096)
        self.assertEqual(execution["argv_sha256"], PRODUCER.digest_value(expected_argv))
        self.assertEqual(execution["stdin_sha256"], hashlib.sha256(sql).hexdigest())
        execution_body = copy.deepcopy(execution)
        execution_sha256 = execution_body.pop("execution_sha256")
        self.assertEqual(execution_sha256, PRODUCER.digest_value(execution_body))
        receipt_body = copy.deepcopy(receipt)
        receipt_sha256 = receipt_body.pop("receipt_sha256")
        self.assertEqual(receipt_sha256, PRODUCER.digest_value(receipt_body))

        content_limit = PRODUCER.EXECUTOR.POSTGRES_CONTENT_REPORT_MAX_BYTES
        with mock.patch.object(
                PRODUCER.LEGACY, "docker_command", return_value=completed,
        ) as command:
            _result, _arguments, content_execution = PRODUCER.execute_psql_bound(
                container_id, "content_report", sql,
                database="chenyida_erp_rb_deadbeefdeadbeef",
                maximum_output=content_limit,
            )
        command.assert_called_once_with(
            PRODUCER.psql_arguments(
                container_id, "content_report",
                database="chenyida_erp_rb_deadbeefdeadbeef",
            ),
            input_bytes=sql, timeout=300, maximum_output=content_limit,
        )
        self.assertEqual(
            content_execution["maximum_output_bytes"], content_limit,
        )
        with self.assertRaisesRegex(
                PRODUCER.DynamicGuardedSwitchError,
                "TASK70_V3_PSQL_INPUT_INVALID",
        ):
            PRODUCER.execute_psql_bound(
                container_id, "content_report", sql,
                maximum_output=content_limit + 1,
            )

    def test_v3_journal_projection_keeps_full_recorder_events_and_payload_identity(self):
        _policy, _records, _ledger, inputs = self.inputs()
        base = PRODUCER.EXECUTOR.derive_pg_rollback_base_spec(inputs)
        request = PRODUCER.journal_request(inputs, base, "EXECUTE")
        with tempfile.TemporaryDirectory(
                prefix="task70-v3-journal-projection.", dir="/tmp",
        ) as raw_root:
            root = Path(raw_root)
            handler_parent = (
                root / PRODUCER.EXECUTOR.HANDLER_STATE_ROOT.lstrip("/")
            ).parent
            handler_parent.mkdir(parents=True, mode=0o700)
            handler_parent.chmod(0o700)
            journal = PRODUCER.EXECUTOR.HandlerJournal(
                request["operation"], request["operation_id"], request["label"],
                str(root),
            )
            recorder = PRODUCER.EXECUTOR.DurableSideEffectRecorder(
                journal, request, "f" * 64,
                clock=lambda: "2026-08-21T00:00:00.000Z",
            )
            intent = PRODUCER.EXECUTOR.create_side_effect_intent(
                request, "STAGING_DATABASE_CREATE", "1" * 64, "2" * 64,
                "2026-08-21T00:00:00.000Z",
            )
            recorder.begin("STAGING_DATABASE_CREATE", intent)
            receipt = PRODUCER.EXECUTOR.create_side_effect_receipt(
                intent, PRODUCER.EXECUTOR.ZERO_SHA256, "3" * 64,
                "2026-08-21T00:00:00.000Z",
            )
            recorder.complete("STAGING_DATABASE_CREATE", receipt)
            actual_events = journal.load()
            projection = PRODUCER.journal_projection(journal)
            self.assertEqual(projection["events"], actual_events)
            self.assertEqual(projection["event_count"], 2)
            for event in projection["events"]:
                self.assertEqual(
                    event["side_effect_identity_sha256"],
                    PRODUCER.digest_value(event["payload"]),
                )

            mutated_events = copy.deepcopy(actual_events)
            mutated_events[0]["payload"]["target_sha256"] = "4" * 64

            class MutatedJournal:
                @staticmethod
                def load():
                    return mutated_events

            with self.assertRaisesRegex(
                    PRODUCER.DynamicGuardedSwitchError,
                    "TASK70_V3_JOURNAL_PROJECTION_INVALID",
            ):
                PRODUCER.journal_projection(MutatedJournal())

    def test_resource_evidence_normalizes_floats_and_rejects_disk_or_oom_drift(self):
        policy = PRODUCER.load_policy()
        timing = {
            "run_started_at": "2026-08-21T00:00:00.000Z",
            "container_created_at": "2026-08-21T00:01:01.000000000Z",
        }
        normalized = PRODUCER.normalize_resource_evidence(
            self.resource_evidence(policy), policy, **timing,
        )
        self.assertEqual(normalized["maximum_load1_milli_observed"], 250)
        self.assertEqual(normalized["maximum_swap_basis_points_observed"], 1250)

        def assert_no_float(value):
            if isinstance(value, dict):
                for child in value.values():
                    assert_no_float(child)
            elif isinstance(value, list):
                for child in value:
                    assert_no_float(child)
            else:
                self.assertNotIsInstance(value, float)

        assert_no_float(normalized)
        for raw in (
            self.resource_evidence(
                policy,
                disk_delta=policy["case_catalog"][0]["maximum_disk_delta_bytes"] + 1,
            ),
            self.resource_evidence(policy, oom_delta=1),
        ):
            with self.assertRaisesRegex(
                    PRODUCER.DynamicGuardedSwitchError,
                    "TASK70_V3_RESOURCE_EVIDENCE_INVALID",
            ):
                PRODUCER.normalize_resource_evidence(raw, policy, **timing)

        collapsed_clock = self.resource_evidence(policy)
        for sample in collapsed_clock["samples"]:
            sample["captured_at"] = "2026-08-21T00:00:00.000Z"
        collapsed_body = copy.deepcopy(collapsed_clock)
        collapsed_body.pop("resource_evidence_sha256")
        collapsed_clock["resource_evidence_sha256"] = PRODUCER.LEGACY.digest_value(
            collapsed_body,
        )
        for raw, invalid_timing in (
            (collapsed_clock, timing),
            (self.resource_evidence(policy), {
                **timing,
                "container_created_at": "2026-08-21T00:00:30.000000000Z",
            }),
        ):
            with self.assertRaisesRegex(
                    PRODUCER.DynamicGuardedSwitchError,
                    "TASK70_V3_RESOURCE_EVIDENCE_INVALID",
            ):
                PRODUCER.normalize_resource_evidence(raw, policy, **invalid_timing)

    def test_source_preflight_binds_current_bytes_to_selected_commit_blob(self):
        raw = b'{"version":"0.1.0-alpha.47"}\n'
        sha256 = hashlib.sha256(raw).hexdigest()
        source = {"git_commit": "a" * 40, "git_tree": "b" * 40}
        binding = [{
            "path": "chenyida_erp_site/package.json",
            "sha256": sha256, "git_blob": "c" * 40,
        }]
        policy = {"source_paths": ["chenyida_erp_site/package.json"]}
        completed = subprocess.CompletedProcess(
            args=["git", "cat-file"], returncode=0, stdout=raw, stderr=b"",
        )
        with mock.patch.object(
                PRODUCER.LEGACY, "git_output", side_effect=["b" * 40, "c" * 40],
        ), mock.patch.object(
                PRODUCER.LEGACY, "secure_file_sha256", return_value=sha256,
        ), mock.patch.object(
                PRODUCER.LEGACY, "run_command", return_value=completed,
        ):
            PRODUCER.verify_source_commit_bindings(source, binding, policy)
        mismatched = subprocess.CompletedProcess(
            args=["git", "cat-file"], returncode=0, stdout=b"drift", stderr=b"",
        )
        with mock.patch.object(
                PRODUCER.LEGACY, "git_output", side_effect=["b" * 40, "c" * 40],
        ), mock.patch.object(
                PRODUCER.LEGACY, "secure_file_sha256", return_value=sha256,
        ), mock.patch.object(
                PRODUCER.LEGACY, "run_command", return_value=mismatched,
        ), self.assertRaisesRegex(
                PRODUCER.DynamicGuardedSwitchError,
                "TASK70_V3_SOURCE_COMMIT_BINDING_INVALID",
        ):
            PRODUCER.verify_source_commit_bindings(source, binding, policy)

    def test_artifact_publish_cleans_owned_paths_after_post_link_failure(self):
        artifact = {"schema_version": 3, "result": "PASS_PARTIAL"}
        policy = {"artifact_max_bytes": 4096}

        with tempfile.TemporaryDirectory(
                prefix="task70-v3-artifact-publish.", dir="/tmp",
        ) as raw_root:
            artifact_path = Path(raw_root) / "evidence.json"
            real_unlink = PRODUCER.os.unlink
            unlink_calls = 0

            def fail_first_unlink(path):
                nonlocal unlink_calls
                unlink_calls += 1
                if unlink_calls == 1:
                    raise OSError("synthetic post-link unlink failure")
                return real_unlink(path)

            with mock.patch.object(PRODUCER, "ARTIFACT_PATH", artifact_path), \
                    mock.patch.object(
                        PRODUCER.os, "unlink", side_effect=fail_first_unlink,
                    ), self.assertRaisesRegex(
                        PRODUCER.DynamicGuardedSwitchError,
                        "TASK70_V3_ARTIFACT_PUBLISH_FAILED",
                    ):
                PRODUCER.publish_artifact(artifact, policy, "dv70-ABCDEFGH")
            self.assertFalse(artifact_path.exists())
            self.assertEqual(list(artifact_path.parent.iterdir()), [])

        with tempfile.TemporaryDirectory(
                prefix="task70-v3-artifact-publish.", dir="/tmp",
        ) as raw_root:
            artifact_path = Path(raw_root) / "evidence.json"
            real_fsync = PRODUCER.os.fsync
            fsync_calls = 0

            def fail_directory_fsync(descriptor):
                nonlocal fsync_calls
                fsync_calls += 1
                if fsync_calls == 2:
                    raise OSError("synthetic directory fsync failure")
                return real_fsync(descriptor)

            with mock.patch.object(PRODUCER, "ARTIFACT_PATH", artifact_path), \
                    mock.patch.object(
                        PRODUCER.os, "fsync", side_effect=fail_directory_fsync,
                    ), self.assertRaisesRegex(
                        PRODUCER.DynamicGuardedSwitchError,
                        "TASK70_V3_ARTIFACT_PUBLISH_FAILED",
                    ):
                PRODUCER.publish_artifact(artifact, policy, "dv70-ABCDEFGH")
            self.assertFalse(artifact_path.exists())
            self.assertEqual(list(artifact_path.parent.iterdir()), [])

    def test_recovery_scenarios_use_public_runtime_probe_and_terminal_closure(self):
        source = PRODUCER_PATH.read_text(encoding="utf-8")
        self.assertIn("run_production_recovery_probe", source)
        self.assertIn("runtime.probe(", source)
        self.assertIn("effects.validate_terminal_evidence(evidence)", source)
        self.assertIn("effects.assert_closed()", source)
        self.assertNotIn("runtime._recover_postgres_execution", source)


if __name__ == "__main__":
    unittest.main()
