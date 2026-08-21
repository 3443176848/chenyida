import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock


SITE_ROOT = Path(__file__).resolve().parents[1]
RUNNER_SOURCE = SITE_ROOT / "scripts/uat-promotion-dynamic-pg-switch.py"
FIXTURE_SOURCE = SITE_ROOT / "tests/test_uat_promotion_rollback_fixed_executor.py"
POLICY_SOURCE = SITE_ROOT / "operations/uat-promotion-dynamic-validation-policy-v2.json"


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


RUNNER = load("task70_dynamic_pg_switch_under_test", RUNNER_SOURCE)
FIXTURE = load("task70_dynamic_pg_switch_fixture", FIXTURE_SOURCE)
POLICY = json.loads(POLICY_SOURCE.read_text(encoding="utf-8"))
IMAGE_ID = "sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394"
IMAGE_REFERENCE = f"docker.io/library/postgres@{IMAGE_ID}"


def derived():
    identity = {
        "system_identifier": "1234567890123456789",
        "server_version_num": "170010",
        "listen_addresses": "*",
        "encoding": "UTF8",
        "collate": "C",
        "ctype": "C",
        "locale_provider": "libc",
        "collation_version": None,
        "active_oid": "17000",
        "staging_oid": "17001",
    }
    inputs = RUNNER.materialize_fixture_inputs(
        FIXTURE, identity=identity, container_id="a" * 64,
        image_reference=IMAGE_REFERENCE, image_id=IMAGE_ID,
        git_commit="b" * 40, application_version="0.1.0-alpha.47",
    )
    base = FIXTURE.EXECUTOR.derive_pg_rollback_base_spec(inputs)
    bindings = {
        "privilege_receipt_sha256": RUNNER.executor_digest({
            "task_id": "SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70",
            "case_id": "DV70-PG-SWITCH-01",
            "scope": "SYNTHETIC_PRIVILEGE_RECEIPT_PLACEHOLDER",
        }),
        "staging_oid": identity["staging_oid"],
        "before_observation_sha256": "2" * 64,
        "expected_switched_identity_sha256": RUNNER.executor_digest({
            "active_name": base["databases"]["active_name"],
            "active_oid": identity["staging_oid"],
            "quarantine_name": base["databases"]["quarantine_name"],
            "quarantine_oid": base["databases"]["candidate_oid"],
            "state": "NEW_SEALED",
        }),
    }
    spec = FIXTURE.EXECUTOR.derive_pg_opcode_spec(
        base, "PG_RB_ATOMIC_SWITCH_V1", bindings,
    )
    sql = FIXTURE.EXECUTOR.render_pg_sql(base, spec["opcode"], spec["bindings"])
    return identity, base, spec, sql


class DynamicPgSwitchPureContractTest(unittest.TestCase):
    def test_production_entrypoint_requires_isolated_python(self):
        source = RUNNER_SOURCE.read_text(encoding="utf-8")
        package = json.loads((SITE_ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertTrue(source.startswith("#!/usr/bin/python3 -I\n"))
        self.assertIn("sys.flags.isolated != 1", source)
        self.assertEqual(
            package["scripts"]["uat:promotion-dynamic-evidence:run-pg-switch"],
            "/usr/bin/python3 -I scripts/uat-promotion-dynamic-pg-switch.py --execute",
        )
        self.assertEqual(RUNNER.SAFE_ENV["GIT_NO_REPLACE_OBJECTS"], "1")
        self.assertEqual(RUNNER.SAFE_ENV["GIT_OPTIONAL_LOCKS"], "0")

    def test_canonical_json_normalizes_integral_floats_for_cross_runtime_digest(self):
        value = [2.0, -0.0, 0.0, 2.4, 6.705056040609911]
        expected = b'[2,0,0,2.4,6.705056040609911]'
        expected_sha256 = "bea9d5d76ee15662830f364a68a8babc57ced8cc7edbb79a207bab5053a75207"
        self.assertEqual(RUNNER.canonical(value), expected)
        self.assertEqual(
            RUNNER.digest_value(value),
            expected_sha256,
        )
        with self.assertRaisesRegex(
            RUNNER.DynamicPgSwitchError, "TASK70_DYNAMIC_JSON_INVALID",
        ):
            RUNNER.canonical({"unsafe": float("inf")})
        with self.assertRaisesRegex(
            RUNNER.DynamicPgSwitchError, "TASK70_DYNAMIC_JSON_INVALID",
        ):
            RUNNER.canonical({"unsafe": RUNNER.JSON_SAFE_INTEGER + 1})

    def test_repository_source_excludes_only_the_user_protected_report(self):
        status_arguments = None

        def git_output(arguments, _code):
            nonlocal status_arguments
            if arguments[0] == "status":
                status_arguments = arguments
                return ""
            if arguments == ["branch", "--show-current"]:
                return "main"
            if arguments == ["rev-parse", "HEAD"]:
                return "b" * 40
            if arguments == ["rev-parse", "HEAD^{tree}"]:
                return "c" * 40
            if len(arguments) == 2 and arguments[0] == "rev-parse" \
                    and arguments[1].startswith("HEAD:"):
                return "d" * 40
            self.fail(f"unexpected git arguments: {arguments!r}")

        with mock.patch.object(RUNNER, "git_output", side_effect=git_output), \
                mock.patch.object(
                    RUNNER, "secure_text",
                    return_value='{"version":"0.1.0-alpha.47"}',
                ), mock.patch.object(
                    RUNNER, "secure_file_sha256", return_value="e" * 64,
                ):
            source, bindings = RUNNER.repository_source(POLICY)

        self.assertEqual(status_arguments, [
            "status", "--porcelain=v1", "--untracked-files=all", "--", ".",
            ":(exclude)docs/ERP_CURRENT_STATUS_REPORT.md",
        ])
        self.assertEqual(source["git_commit"], "b" * 40)
        self.assertEqual(len(bindings), len(POLICY["source_paths"]))

    def test_repository_status_detects_untracked_import_shadowing_but_excludes_report(self):
        environment = {
            "PATH": "/usr/bin:/bin", "LC_ALL": "C", "LANG": "C", "TZ": "UTC",
            "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_AUTHOR_NAME": "Task70 Test", "GIT_AUTHOR_EMAIL": "task70@example.invalid",
            "GIT_COMMITTER_NAME": "Task70 Test",
            "GIT_COMMITTER_EMAIL": "task70@example.invalid",
        }
        with tempfile.TemporaryDirectory(prefix="cyd-task70-git-status.") as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "scripts").mkdir()
            report = root / "docs/ERP_CURRENT_STATUS_REPORT.md"
            report.write_text("protected baseline\n", encoding="utf-8")
            (root / "tracked.txt").write_text("tracked\n", encoding="utf-8")

            def git(*arguments):
                return subprocess.run(
                    [RUNNER.GIT, *arguments], cwd=root, env=environment,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
                ).stdout.decode("utf-8", "strict").strip()

            git("init", "--quiet")
            git("add", "docs/ERP_CURRENT_STATUS_REPORT.md", "tracked.txt")
            git("commit", "--quiet", "-m", "baseline")
            report.write_text("protected user change\n", encoding="utf-8")
            shadow = root / "scripts/json.py"
            shadow.write_text("raise RuntimeError('shadowed')\n", encoding="utf-8")
            status = git(
                "status", "--porcelain=v1", "--untracked-files=all", "--", ".",
                ":(exclude)docs/ERP_CURRENT_STATUS_REPORT.md",
            )
            self.assertEqual(status, "?? scripts/json.py")
            shadow.unlink()
            self.assertEqual(git(
                "status", "--porcelain=v1", "--untracked-files=all", "--", ".",
                ":(exclude)docs/ERP_CURRENT_STATUS_REPORT.md",
            ), "")

    def test_materialized_fixture_uses_runtime_identity_and_canonical_image(self):
        identity, base, spec, sql = derived()
        self.assertEqual(base["postgres"]["system_identifier"], identity["system_identifier"])
        self.assertEqual(base["databases"]["candidate_oid"], identity["active_oid"])
        self.assertEqual(base["postgres"]["container_id"], "a" * 64)
        self.assertEqual(base["postgres"]["image_reference"], IMAGE_REFERENCE)
        self.assertEqual(base["postgres"]["image_digest"], IMAGE_ID)
        self.assertEqual(spec["sql_sha256"], RUNNER.digest_bytes(sql))
        self.assertEqual(spec["opcode"], "PG_RB_ATOMIC_SWITCH_V1")

    def test_derived_opcode_bindings_match_closed_production_driver_formulas(self):
        identity, _, _, _ = derived()
        before_observation_sha256 = "7" * 64
        base, observe_spec, switch_spec, _, _ = RUNNER.derive_specs(
            FIXTURE.EXECUTOR, FIXTURE,
            identity=identity, container_id="a" * 64,
            image_reference=IMAGE_REFERENCE, image_id=IMAGE_ID,
            git_commit="b" * 40, application_version="0.1.0-alpha.47",
            before_observation_sha256=before_observation_sha256,
        )
        observation_binding_sha256 = RUNNER.executor_digest({
            "task_id": "SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70",
            "case_id": "DV70-PG-SWITCH-01",
            "base_spec_sha256": base["base_spec_sha256"],
            "restored_oid": identity["staging_oid"],
        })
        self.assertEqual(observe_spec["bindings"], {
            "journal_state_sha256": RUNNER.executor_digest({
                "base_spec_sha256": base["base_spec_sha256"],
                "purpose": "task70-dynamic-case",
                "binding_sha256": observation_binding_sha256,
            }),
            "observation_scope_sha256": RUNNER.executor_digest({
                "system_identifier": base["postgres"]["system_identifier"],
                "databases": sorted((
                    base["databases"]["active_name"],
                    base["databases"]["staging_name"],
                    base["databases"]["quarantine_name"],
                )),
            }),
        })
        self.assertEqual(switch_spec["bindings"]["staging_oid"], identity["staging_oid"])
        self.assertEqual(
            switch_spec["bindings"]["before_observation_sha256"],
            before_observation_sha256,
        )
        self.assertEqual(
            switch_spec["bindings"]["expected_switched_identity_sha256"],
            RUNNER.executor_digest({
                "active_name": base["databases"]["active_name"],
                "active_oid": identity["staging_oid"],
                "quarantine_name": base["databases"]["quarantine_name"],
                "quarantine_oid": base["databases"]["candidate_oid"],
                "state": "NEW_SEALED",
            }),
        )

    def test_fault_stream_is_the_unique_production_prefix_plus_fixed_barrier(self):
        _, base, _, sql = derived()
        fault, boundary = RUNNER.derive_fault_stream(sql, base)
        first_rename = (
            'ALTER DATABASE "chenyida_erp" RENAME TO '
            '"chenyida_erp_candidate_deadbeefdeadbeef";\n'
        ).encode()
        second_rename = (
            'ALTER DATABASE "chenyida_erp_rb_deadbeefdeadbeef" '
            'RENAME TO "chenyida_erp";\n'
        ).encode()
        self.assertEqual(boundary, sql.index(first_rename) + len(first_rename))
        self.assertEqual(fault[:boundary], sql[:boundary])
        self.assertIn(RUNNER.FAULT_BARRIER.encode(), fault[boundary:])
        self.assertNotIn(second_rename, fault)
        self.assertNotEqual(RUNNER.digest_bytes(fault), RUNNER.digest_bytes(sql))

    def test_fault_stream_rejects_missing_or_ambiguous_rename_anchor(self):
        _, base, _, sql = derived()
        with self.assertRaisesRegex(RUNNER.DynamicPgSwitchError,
                                    "TASK70_DYNAMIC_FAULT_ANCHOR_INVALID"):
            RUNNER.derive_fault_stream(sql.replace(b" RENAME TO ", b" RENAME xTO ", 1), base)
        first = (
            'ALTER DATABASE "chenyida_erp" RENAME TO '
            '"chenyida_erp_candidate_deadbeefdeadbeef";\n'
        ).encode()
        with self.assertRaisesRegex(RUNNER.DynamicPgSwitchError,
                                    "TASK70_DYNAMIC_FAULT_ANCHOR_INVALID"):
            RUNNER.derive_fault_stream(sql.replace(first, first + first), base)

    def test_precondition_failure_requires_exact_psql_advisory_lock_newline(self):
        sql = b"SELECT 1;\n"
        accepted = subprocess.CompletedProcess(
            [], 3, b"\n", b"ERROR:  rollback switch precondition mismatch\n",
        )
        with mock.patch.object(RUNNER, "execute_psql", return_value=accepted):
            receipt, acknowledgement = RUNNER.execute_production_switch(
                object(), container_id="a" * 64, sql=sql, expected="precondition",
            )
        self.assertIsNone(acknowledgement)
        self.assertEqual(receipt["stdout_base64"], "Cg==")
        self.assertEqual(receipt["failure_code"], "ROLLBACK_SWITCH_PRECONDITION_MISMATCH")

        rejected = subprocess.CompletedProcess(
            [], 3, b"", b"ERROR:  rollback switch precondition mismatch\n",
        )
        with mock.patch.object(RUNNER, "execute_psql", return_value=rejected):
            with self.assertRaisesRegex(
                RUNNER.DynamicPgSwitchError,
                "TASK70_DYNAMIC_PRODUCTION_SWITCH_DID_NOT_FAIL_CLOSED",
            ):
                RUNNER.execute_production_switch(
                    object(), container_id="a" * 64, sql=sql, expected="precondition",
                )

    def test_create_arguments_are_pull_free_mount_free_and_resource_bounded(self):
        arguments = RUNNER.expected_create_arguments(POLICY, "dv70-A1b2C3d4",
                                                      "cyd-dv70-pg-switch-dv70-A1b2C3d4")
        self.assertIn("--pull=never", arguments)
        self.assertIn("--network", arguments)
        self.assertIn("none", arguments)
        self.assertNotIn("--mount", arguments)
        self.assertNotIn("--volume", arguments)
        self.assertNotIn("--publish", arguments)
        self.assertNotIn("--privileged", arguments)
        self.assertEqual(arguments[-11:], [
            "postgres", "-c", "listen_addresses=*", "-c",
            "unix_socket_directories=/var/run/postgresql", "-c", "max_connections=20",
            "-c", "shared_buffers=64MB", "-c", "log_statement=none",
        ])

    def test_task_container_projection_recomputes_exact_security_limits(self):
        limits = POLICY["case_catalog"][0]["container_limits"]
        run_id = "dv70-A1b2C3d4"
        name = f"cyd-dv70-pg-switch-{run_id}"
        item = {
            "Id": "a" * 64,
            "Name": f"/{name}",
            "Created": "2026-08-21T12:00:00.000000000Z",
            "Image": IMAGE_ID,
            "Config": {
                "Image": IMAGE_REFERENCE,
                "User": "999:999",
                "Labels": {
                    "chenyida.erp.task70-run-id": run_id,
                    "chenyida.erp.execution-scope": "isolated-synthetic-test",
                },
                "Env": [
                    "POSTGRES_HOST_AUTH_METHOD=trust",
                    "POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=C",
                    "PGDATA=/var/lib/postgresql/data/pgdata",
                ],
                "StopTimeout": 5,
                "Cmd": [
                    "postgres", "-c", "listen_addresses=*", "-c",
                    "unix_socket_directories=/var/run/postgresql", "-c",
                    "max_connections=20", "-c", "shared_buffers=64MB", "-c",
                    "log_statement=none",
                ],
            },
            "HostConfig": {
                "NetworkMode": "none", "ReadonlyRootfs": True,
                "CapDrop": ["ALL"], "CapAdd": None,
                "SecurityOpt": ["no-new-privileges"],
                "RestartPolicy": {"Name": "no"}, "Privileged": False,
                "Memory": 805306368, "MemorySwap": 805306368,
                "NanoCpus": 1000000000, "PidsLimit": 192,
                "ShmSize": 67108864, "LogConfig": {"Type": "none"},
                "Devices": None, "Binds": None, "PortBindings": None,
                "PublishAllPorts": False,
                "Tmpfs": {
                    target: f"{spec['options']},size={spec['size_bytes']}"
                    for target, spec in limits["tmpfs"].items()
                },
            },
            "Mounts": [],
        }
        image = {
            "id": IMAGE_ID, "descriptor_digest": IMAGE_ID,
            "repo_digest_suffixes": [IMAGE_ID], "architecture": "amd64",
            "os": "linux", "size_bytes": 1,
        }
        projection = RUNNER.task_container_projection(
            item, policy=POLICY, run_id=run_id, container_name=name, image=image,
        )
        self.assertEqual(projection["tmpfs"], limits["tmpfs"])
        weakened = copy.deepcopy(item)
        weakened["HostConfig"]["NetworkMode"] = "bridge"
        with self.assertRaisesRegex(RUNNER.DynamicPgSwitchError,
                                    "TASK70_DYNAMIC_TASK_CONTAINER_INSPECT_INVALID"):
            RUNNER.task_container_projection(
                weakened, policy=POLICY, run_id=run_id, container_name=name, image=image,
            )

    def test_create_projection_failure_cleans_exact_created_container(self):
        identifier = "a" * 64
        run_id = "dv70-A1b2C3d4"
        name = f"cyd-dv70-pg-switch-{run_id}"
        image = {"id": IMAGE_ID}
        created = subprocess.CompletedProcess([], 0, f"{identifier}\n".encode(), b"")
        with mock.patch.object(
            RUNNER, "task_label_container_ids", side_effect=[[], [identifier]],
        ), mock.patch.object(
            RUNNER, "task_name_container_ids", return_value=[],
        ), mock.patch.object(
            RUNNER, "docker_command", return_value=created,
        ), mock.patch.object(
            RUNNER, "inspect_cleanup_identity", return_value={"container_id": identifier},
        ), mock.patch.object(
            RUNNER, "inspect_task_container",
            side_effect=RUNNER.DynamicPgSwitchError(
                "TASK70_DYNAMIC_TASK_CONTAINER_INSPECT_INVALID",
            ),
        ), mock.patch.object(
            RUNNER, "cleanup_task_container", return_value=[identifier],
        ) as cleanup:
            with self.assertRaisesRegex(
                RUNNER.DynamicPgSwitchError,
                "TASK70_DYNAMIC_TASK_CONTAINER_INSPECT_INVALID",
            ):
                RUNNER.create_task_container(POLICY, run_id, name, image)
        cleanup.assert_called_once_with(
            identifier, policy=POLICY, run_id=run_id,
            container_name=name, image=image, allow_absent=True,
        )

    def test_create_response_loss_cleans_discovered_exact_container(self):
        identifier = "a" * 64
        run_id = "dv70-A1b2C3d4"
        name = f"cyd-dv70-pg-switch-{run_id}"
        image = {"id": IMAGE_ID}
        failed = subprocess.CompletedProcess([], 1, b"", b"daemon response lost\n")
        with mock.patch.object(
            RUNNER, "task_label_container_ids", side_effect=[[], [identifier]],
        ), mock.patch.object(
            RUNNER, "task_name_container_ids", return_value=[],
        ), mock.patch.object(
            RUNNER, "docker_command", return_value=failed,
        ), mock.patch.object(
            RUNNER, "inspect_cleanup_identity", return_value={"container_id": identifier},
        ), mock.patch.object(
            RUNNER, "cleanup_task_container", return_value=[identifier],
        ) as cleanup:
            with self.assertRaisesRegex(
                RUNNER.DynamicPgSwitchError,
                "TASK70_DYNAMIC_TASK_CONTAINER_CREATE_RESPONSE_LOST",
            ):
                RUNNER.create_task_container(POLICY, run_id, name, image)
        cleanup.assert_called_once()

    def test_create_call_exception_reconciles_and_cleans_exact_owned_container(self):
        identifier = "a" * 64
        run_id = "dv70-A1b2C3d4"
        name = f"cyd-dv70-pg-switch-{run_id}"
        image = {"id": IMAGE_ID}
        create_error = RUNNER.DynamicPgSwitchError("TASK70_DYNAMIC_COMMAND_FAILED")
        with mock.patch.object(
            RUNNER, "task_label_container_ids", return_value=[],
        ), mock.patch.object(
            RUNNER, "task_name_container_ids", return_value=[],
        ), mock.patch.object(
            RUNNER, "docker_command", side_effect=create_error,
        ), mock.patch.object(
            RUNNER, "task_owned_container_ids", return_value=[identifier],
        ), mock.patch.object(
            RUNNER, "inspect_cleanup_identity", return_value={"container_id": identifier},
        ), mock.patch.object(
            RUNNER, "cleanup_task_container", return_value=[identifier],
        ) as cleanup:
            with self.assertRaisesRegex(
                RUNNER.DynamicPgSwitchError, "TASK70_DYNAMIC_COMMAND_FAILED",
            ):
                RUNNER.create_task_container(POLICY, run_id, name, image)
        cleanup.assert_called_once_with(
            identifier, policy=POLICY, run_id=run_id,
            container_name=name, image=image, allow_absent=True,
        )

    def test_unknown_create_retries_discovery_then_cleans_exact_owned_container(self):
        identifier = "a" * 64
        run_id = "dv70-A1b2C3d4"
        name = f"cyd-dv70-pg-switch-{run_id}"
        image = {"id": IMAGE_ID}
        create_error = RUNNER.DynamicPgSwitchError("TASK70_DYNAMIC_COMMAND_FAILED")
        discovery_error = RUNNER.DynamicPgSwitchError(
            "TASK70_DYNAMIC_TASK_CONTAINER_RECONCILE_FAILED",
        )
        with mock.patch.object(
            RUNNER, "task_owned_container_ids",
            side_effect=[discovery_error, [identifier]],
        ), mock.patch.object(
            RUNNER.time, "sleep",
        ), mock.patch.object(
            RUNNER, "cleanup_task_container", return_value=[identifier],
        ) as cleanup:
            with self.assertRaisesRegex(
                RUNNER.DynamicPgSwitchError, "TASK70_DYNAMIC_COMMAND_FAILED",
            ):
                RUNNER.reconcile_unknown_create(
                    create_error, policy=POLICY, run_id=run_id,
                    container_name=name, image=image,
                )
        cleanup.assert_called_once()

    def test_unknown_create_fails_as_cleanup_unverified_when_discovery_never_recovers(self):
        run_id = "dv70-A1b2C3d4"
        name = f"cyd-dv70-pg-switch-{run_id}"
        create_error = RUNNER.DynamicPgSwitchError("TASK70_DYNAMIC_COMMAND_FAILED")
        discovery_error = RUNNER.DynamicPgSwitchError(
            "TASK70_DYNAMIC_TASK_CONTAINER_RECONCILE_FAILED",
        )
        with mock.patch.object(
            RUNNER, "task_owned_container_ids", side_effect=discovery_error,
        ), mock.patch.object(
            RUNNER, "task_label_container_ids", side_effect=discovery_error,
        ), mock.patch.object(
            RUNNER.time, "sleep",
        ):
            with self.assertRaisesRegex(
                RUNNER.DynamicPgSwitchError,
                "TASK70_DYNAMIC_TASK_CONTAINER_CREATE_CLEANUP_UNVERIFIED",
            ):
                RUNNER.reconcile_unknown_create(
                    create_error, policy=POLICY, run_id=run_id,
                    container_name=name, image={"id": IMAGE_ID},
                )

    def test_cleanup_uses_minimal_immutable_identity_after_projection_drift(self):
        identifier = "a" * 64
        run_id = "dv70-A1b2C3d4"
        name = f"cyd-dv70-pg-switch-{run_id}"
        image = {"id": IMAGE_ID}
        running = {"container_id": identifier, "running": True}
        stopped = {"container_id": identifier, "running": False}
        results = [
            subprocess.CompletedProcess([], 0, f"{identifier}\n".encode(), b""),
            subprocess.CompletedProcess([], 0, f"{identifier}\n".encode(), b""),
        ]
        with mock.patch.object(
            RUNNER, "docker_command", side_effect=results,
        ), mock.patch.object(
            RUNNER, "reconcile_cleanup_identity",
            side_effect=[running, stopped, None],
        ), mock.patch.object(
            RUNNER, "inspect_task_container",
            side_effect=AssertionError("full projection must not gate cleanup"),
        ):
            removed = RUNNER.cleanup_task_container(
                identifier, policy=POLICY, run_id=run_id,
                container_name=name, image=image,
            )
        self.assertEqual(removed, [identifier])

    def test_cleanup_reconciles_stop_and_remove_response_loss(self):
        identifier = "a" * 64
        run_id = "dv70-A1b2C3d4"
        name = f"cyd-dv70-pg-switch-{run_id}"
        command_error = RUNNER.DynamicPgSwitchError("TASK70_DYNAMIC_COMMAND_FAILED")
        with mock.patch.object(
            RUNNER, "reconcile_cleanup_identity", side_effect=[
                {"container_id": identifier, "running": True},
                {"container_id": identifier, "running": False},
                None,
            ],
        ), mock.patch.object(
            RUNNER, "docker_command", side_effect=[command_error, command_error],
        ):
            removed = RUNNER.cleanup_task_container(
                identifier, policy=POLICY, run_id=run_id,
                container_name=name, image={"id": IMAGE_ID},
            )
        self.assertEqual(removed, [identifier])

    def test_cleanup_identity_retries_transient_inspect_failure(self):
        identifier = "a" * 64
        run_id = "dv70-A1b2C3d4"
        name = f"cyd-dv70-pg-switch-{run_id}"
        command_error = RUNNER.DynamicPgSwitchError("TASK70_DYNAMIC_COMMAND_FAILED")
        raw = [{
            "Id": identifier, "Name": f"/{name}", "Image": IMAGE_ID,
            "Config": {
                "Image": IMAGE_REFERENCE,
                "Labels": {
                    "chenyida.erp.task70-run-id": run_id,
                    "chenyida.erp.execution-scope": "isolated-synthetic-test",
                },
            },
            "State": {"Running": False},
        }]
        inspected = subprocess.CompletedProcess(
            [], 0, json.dumps(raw).encode("utf-8"), b"",
        )
        with mock.patch.object(
            RUNNER, "docker_command", side_effect=[command_error, inspected],
        ), mock.patch.object(
            RUNNER, "task_label_container_ids", return_value=[identifier],
        ), mock.patch.object(
            RUNNER, "task_name_container_ids", return_value=[identifier],
        ), mock.patch.object(RUNNER.time, "sleep") as sleep:
            identity = RUNNER.reconcile_cleanup_identity(
                identifier, policy=POLICY, run_id=run_id,
                container_name=name, image={"id": IMAGE_ID},
            )
        self.assertEqual(identity["container_id"], identifier)
        self.assertFalse(identity["running"])
        sleep.assert_called_once_with(1)

    def test_process_group_termination_signals_group_even_after_leader_exit(self):
        process = mock.Mock()
        process.pid = 12345
        process.poll.return_value = 0
        with mock.patch.object(RUNNER.os, "killpg") as killpg:
            RUNNER.terminate_process_group(process)
        self.assertEqual(killpg.call_args_list, [
            mock.call(12345, RUNNER.signal.SIGTERM),
            mock.call(12345, RUNNER.signal.SIGKILL),
        ])

    def test_resource_sample_fails_closed_on_memory_or_service_drift(self):
        baseline = [{
            "service": name, "container_id": str(index) * 64,
            "restart_count": 0, "oom_killed": False, "running": True,
            "health": "HEALTHY" if name in {"postgres", "web"} else "NONE",
        } for index, name in enumerate(("caddy", "postgres", "web", "worker"), 1)]
        sample = {
            "available_memory_bytes": 2 * 1024**3,
            "swap_used_bytes": 32 * 1024**2,
            "swap_total_bytes": 1024**3,
            "root_available_bytes": 12 * 1024**3,
            "load1": 0.5,
            "oom_kill_count": 0,
            "services": copy.deepcopy(baseline),
        }
        RUNNER.validate_resource_sample(sample, POLICY, baseline)
        low_memory = copy.deepcopy(sample)
        low_memory["available_memory_bytes"] = 1
        with self.assertRaisesRegex(RUNNER.DynamicPgSwitchError,
                                    "TASK70_DYNAMIC_RESOURCE_THRESHOLD_BREACH"):
            RUNNER.validate_resource_sample(low_memory, POLICY, baseline)
        restarted = copy.deepcopy(sample)
        restarted["services"][0]["restart_count"] = 1
        with self.assertRaisesRegex(RUNNER.DynamicPgSwitchError,
                                    "TASK70_DYNAMIC_SERVICE_STATE_CHANGED"):
            RUNNER.validate_resource_sample(restarted, POLICY, baseline)

    def test_assertions_are_structured_and_content_addressed(self):
        _, base, spec, _ = derived()
        old = {"layout": "OLD", "topology": "OLD_TOPOLOGY",
               "state_projection_sha256": "1" * 64}
        new = {"layout": "NEW_SEALED", "topology": "NEW_TOPOLOGY",
               "state_projection_sha256": "2" * 64}
        scenarios = [
            {"scenario_id": "EXACT_SUCCESS", "scenario_sha256": "a" * 64,
             "before_classification": old, "after_classification": new,
             "mutation_ack": {"ack_sha256": "3" * 64}},
            {"scenario_id": "REPEAT_FAIL_CLOSED", "scenario_sha256": "b" * 64,
             "before_classification": new, "after_classification": new,
             "command": {"failure_code": "ROLLBACK_SWITCH_PRECONDITION_MISMATCH"}},
            {"scenario_id": "PRECONDITION_DRIFT_REJECTED", "scenario_sha256": "c" * 64,
             "drifted_before_classification": old, "drifted_after_classification": old,
             "restored_classification": old,
             "command": {"failure_code": "ROLLBACK_SWITCH_PRECONDITION_MISMATCH"}},
            {"scenario_id": "FIRST_RENAME_FAULT_ROLLBACK", "scenario_sha256": "d" * 64,
             "fault_derivation": POLICY["case_catalog"][0]["fault_derivation"],
             "barrier_observed": True, "before_classification": old,
             "witness_classification": old, "after_classification": old},
            {"scenario_id": RUNNER.CALLER_RESULT_DISCARD_SCENARIO,
             "scenario_sha256": "e" * 64,
             "simulation_class": "CALLER_RESULT_DISCARDED_AFTER_EXACT_COMMAND_COMPLETION",
             "caller_result_discarded": True, "mutation_ack_parsed": False,
             "after_classification": new},
        ]
        assertions = RUNNER.build_assertions(
            scenarios, production_spec=spec, base=base, restored_oid="17001",
            before_fingerprint_sha256="4" * 64,
            after_fingerprint_sha256="4" * 64,
            cleanup_receipt_sha256="5" * 64,
        )
        self.assertEqual([item["id"] for item in assertions],
                         POLICY["case_catalog"][0]["required_assertions"])
        for item in assertions:
            self.assertEqual(item["evidence_sha256"], RUNNER.digest_value(item["evidence"]))

    def test_python_runner_policy_gate_is_fully_closed_before_docker(self):
        self.assertEqual(RUNNER.validate_policy(copy.deepcopy(POLICY)), POLICY)
        mutations = []
        weakened_image = copy.deepcopy(POLICY)
        weakened_image["case_catalog"][0]["postgres_image_reference"] = "postgres:17"
        mutations.append(weakened_image)
        weakened_network = copy.deepcopy(POLICY)
        weakened_network["case_catalog"][0]["container_limits"]["network_mode"] = "bridge"
        mutations.append(weakened_network)
        weakened_memory = copy.deepcopy(POLICY)
        weakened_memory["case_catalog"][0]["container_limits"]["memory_bytes"] = 0
        mutations.append(weakened_memory)
        weakened_tmpfs = copy.deepcopy(POLICY)
        weakened_tmpfs["case_catalog"][0]["container_limits"]["tmpfs"][
            "/var/lib/postgresql/data"
        ]["options"] = "rw,uid=999,gid=999,mode=0700"
        mutations.append(weakened_tmpfs)
        weakened_guard = copy.deepcopy(POLICY)
        weakened_guard["required_target_guard"]["deployment_class"] = "UAT"
        mutations.append(weakened_guard)
        weakened_resource = copy.deepcopy(POLICY)
        weakened_resource["resource_policy"]["minimum_root_available_bytes"] = 1
        mutations.append(weakened_resource)
        weakened_volume = copy.deepcopy(POLICY)
        weakened_volume["cleanup_policy"]["protected_volume_names"].pop()
        mutations.append(weakened_volume)
        for candidate in mutations:
            with self.assertRaisesRegex(
                RUNNER.DynamicPgSwitchError, "TASK70_DYNAMIC_POLICY_INVALID",
            ):
                RUNNER.validate_policy(candidate)

    def test_execution_is_explicit_opt_in(self):
        self.assertEqual(RUNNER.main([]), 2)


if __name__ == "__main__":
    unittest.main()
