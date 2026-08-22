import fcntl
import copy
import hashlib
import importlib.util
import io
import json
import os
import subprocess
import tarfile
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch


SITE_ROOT = Path(__file__).resolve().parents[1]
EXECUTOR_SOURCE = SITE_ROOT / "scripts/uat-promotion-rollback-fixed-executor.py"


def load_executor():
    spec = importlib.util.spec_from_file_location("uat_rollback_fixed_executor", EXECUTOR_SOURCE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


EXECUTOR = load_executor()
TEST_ACTION_DEADLINE = "2099-01-01T00:00:00.000Z"
METADATA_LABELS = (
    "RUNTIME_CONFIGURATION", "STRICT_RELEASE_IDENTITY", "PROTECTED_RESOURCES",
)


def digest(value):
    if isinstance(value, str):
        value = value.encode()
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def preactivation_proof(base, binding_sha256, **overrides):
    identity = {
        "name": base["databases"]["active_name"],
        "system_identifier": base["postgres"]["system_identifier"],
        "oid": "16385", "marker": base["databases"]["candidate_marker"],
    }
    body = {
        "schema_version": 1,
        "contract": EXECUTOR.PREACTIVATION_CONTENT_PROOF_CONTRACT,
        "binding_sha256": binding_sha256,
        "runtime_plan_sha256": base["runtime_plan_sha256"],
        "source_reconciliation_sha256": base["snapshot"]["source_reconciliation_sha256"],
        "source_database_report_sha256":
            base["snapshot"]["target_database_report_sha256"],
        "live_database_report_sha256": base["snapshot"]["target_database_report_sha256"],
        "migration_head": base["snapshot"]["migration_head"],
        "migration_ledger_file_sha256":
            base["snapshot"]["migration_ledger_file_sha256"],
        "migration_allowlist_sha256":
            base["snapshot"]["migration_allowlist_sha256"],
        "migration_ledger_sha256": digest("preactivation-migration-ledger"),
        "live_security_state_sha256": digest("preactivation-security-state"),
        "active_allowed_session_role_set_sha256": digest("preactivation-role-set"),
        "active_session_client_policy_sha256": digest("preactivation-client-policy"),
        "active_session_observation_sha256": digest("preactivation-session-observation"),
        "active_writer_session_count": 0,
        "active_database_identity_sha256": EXECUTOR.digest_value(identity),
        "restored_database_oid": "16385",
        "restored_database_marker": base["databases"]["candidate_marker"],
        "system_identifier": base["postgres"]["system_identifier"],
        "active_allow_connections": True, "active_connection_limit": 64,
        "active_default_transaction_read_only": False, "active_prepared_xacts": 0,
        "candidate_database_quarantine_name": base["databases"]["quarantine_name"],
        "candidate_database_quarantine_oid": base["databases"]["candidate_oid"],
        "candidate_database_quarantine_marker": base["databases"]["quarantine_marker"],
        "candidate_database_quarantine_allow_connections": False,
        "candidate_database_quarantine_connection_limit": 0,
        "candidate_database_quarantine_sessions": 0,
        "candidate_database_quarantine_prepared_xacts": 0,
        "before_observation_sha256": digest("preactivation-before"),
        "after_observation_sha256": digest("preactivation-after"),
    }
    body.update(overrides)
    return {**body, "proof_sha256": EXECUTOR.digest_value(body)}


def boundary_request(*, action="PREFLIGHT", operation="ROLLBACK_EXECUTION",
                     execution_mode="ORIGINAL", label=None):
    payload = {
        "context": {"fixture": "request-boundary"},
        "transaction_intent": {"fixture": "transaction"},
        "execution_package": {"fixture": "package"},
    }
    body = {
        "schema_version": 1,
        "contract": EXECUTOR.REQUEST_CONTRACT,
        "action": action,
        "operation": operation,
        "operation_id": "rollback-request-boundary-001",
        "execution_mode": execution_mode,
        "label": label,
        "execution_package_sha256": digest("request-boundary-package"),
        "source_set_sha256": digest("request-boundary-sources"),
        "transaction_intent_sha256": digest("request-boundary-transaction"),
        "record_intent_sha256": EXECUTOR.ZERO_SHA256
            if action in {"PREFLIGHT", "RECHECK"} else digest("request-boundary-record"),
        "runtime_plan_sha256": digest("request-boundary-plan"),
        "previous_result_sha256": EXECUTOR.ZERO_SHA256,
        "context_sha256": EXECUTOR.digest_value(payload["context"]),
        "source_roles": EXECUTOR.derive_runtime_source_roles(action, operation, label),
        "payload_sha256": EXECUTOR.digest_value(payload),
        "payload": payload,
        "requested_at": "2026-08-16T02:00:00.000Z",
        "execution_deadline": "2026-08-16T03:00:00.000Z",
        "authorization_expires_at": "2026-08-16T02:30:00.000Z",
        "action_deadline": "2026-08-16T02:02:00.000Z",
    }
    body["request_sha256"] = EXECUTOR.digest_value(body)
    return body


class FixedRequestBoundaryTest(unittest.TestCase):
    def test_exact_source_roles_are_required(self):
        request = boundary_request()
        self.assertEqual(EXECUTOR.validate_request(request), request)
        request["source_roles"] = request["source_roles"][:-1]
        request["request_sha256"] = EXECUTOR.digest_value(
            EXECUTOR.without(request, "request_sha256"),
        )
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_SOURCE_ROLES_INVALID",
        ):
            EXECUTOR.validate_request(request)

    def test_postgresql_content_has_a_bound_twenty_minute_total_probe_budget(self):
        request = boundary_request(
            action="PROBE", operation="ROLLBACK_POSTVERIFY", label="POSTGRESQL_CONTENT",
        )
        request["action_deadline"] = "2026-08-16T02:20:00.000Z"
        request["request_sha256"] = EXECUTOR.digest_value(
            EXECUTOR.without(request, "request_sha256"),
        )
        self.assertEqual(EXECUTOR.validate_request(request), request)
        request["label"] = "HEALTH"
        request["source_roles"] = EXECUTOR.derive_runtime_source_roles(
            "PROBE", "ROLLBACK_POSTVERIFY", "HEALTH",
        )
        request["request_sha256"] = EXECUTOR.digest_value(
            EXECUTOR.without(request, "request_sha256"),
        )
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError, "ROLLBACK_FIXED_EXECUTOR_DISPATCH_INVALID",
        ):
            EXECUTOR.validate_request(request)


class FixedRequestAndCatalogParityTest(unittest.TestCase):
    @staticmethod
    def _javascript_roles(path, label):
        text = path.read_text(encoding="utf-8")
        matches = EXECUTOR.re.finditer(
            rf"{label}:\s*(?:Object\.freeze\()?\[(.*?)\]\)?\s*,",
            text, EXECUTOR.re.DOTALL,
        )
        for matched in matches:
            roles = EXECUTOR.re.findall(r'"([a-z0-9_]+)"', matched.group(1))
            if roles:
                return roles
        raise AssertionError(f"missing {label} in {path}")

    @staticmethod
    def _python_roles(path, label):
        text = path.read_text(encoding="utf-8")
        matched = EXECUTOR.re.search(
            rf'"{label}":\s*\((.*?)\),\n', text, EXECUTOR.re.DOTALL,
        )
        if matched is None:
            raise AssertionError(f"missing {label} in {path}")
        return EXECUTOR.re.findall(r'"([a-z0-9_]+)"', matched.group(1))

    def test_source_role_catalogs_are_cross_language_exact(self):
        scripts = SITE_ROOT / "scripts"
        for label, expected in (
                ("WEB_WORKER_PREDECESSOR_ACTIVATION",
                 list(EXECUTOR.STAGE_SOURCE_ROLES["WEB_WORKER_PREDECESSOR_ACTIVATION"])),
                ("HEALTH", list(EXECUTOR.CHECK_SOURCE_ROLES["HEALTH"])),
        ):
            with self.subTest(label=label, surface="fixed-contract"):
                self.assertEqual(self._javascript_roles(
                    scripts / "uat-promotion-rollback-fixed-executor-contract.mjs", label,
                ), expected)
            with self.subTest(label=label, surface="runtime-contract"):
                self.assertEqual(self._javascript_roles(
                    scripts / "uat-promotion-rollback-runtime-contract.mjs", label,
                ), expected)
            with self.subTest(label=label, surface="runtime-adapter"):
                self.assertEqual(self._python_roles(
                    scripts / "uat-promotion-rollback-runtime-adapter.py", label,
                ), expected)

    def test_writer_session_policy_matches_runtime_connection_contract(self):
        source = (SITE_ROOT / "db/runtime-connection.ts").read_text(encoding="utf-8")
        for service, expected in EXECUTOR.RUNTIME_WRITER_SESSION_CLIENTS.items():
            matched = EXECUTOR.re.search(
                rf'{service}: Object\.freeze\(\{{(.*?)\}}\)', source, EXECUTOR.re.DOTALL,
            )
            self.assertIsNotNone(matched, service)
            block = matched.group(1)
            self.assertIn(f'role: "{expected["role"]}"', block)
            self.assertIn(f'applicationName: "{expected["application_name"]}"', block)
            self.assertIn(f'poolMaximum: {expected["pool_maximum"]}', block)

    def test_embedded_catalog_digest_matches_exact_catalog_projection(self):
        missing = {
            "WRITER_CONTAINMENT": "UAT_ROLLBACK_WRITER_AND_DATABASE_FENCE_HANDLER_MISSING",
            "POSTGRESQL_RESTORE": "UAT_POSTGRESQL_STAGING_RESTORE_ATOMIC_SWITCH_HANDLER_MISSING",
            "UPLOADS_RESTORE": "UAT_UPLOADS_NAMED_VOLUME_RESTORE_HANDLER_MISSING",
            "ATTACHMENTS_RESTORE": "UAT_ATTACHMENTS_NAMED_VOLUME_RESTORE_HANDLER_MISSING",
            "BACKUP_STATUS_RESTORE": "UAT_BACKUP_STATUS_NAMED_VOLUME_RESTORE_HANDLER_MISSING",
            "WEB_WORKER_PREDECESSOR_ACTIVATION":
                "UAT_PREDECESSOR_WEB_WORKER_ACTIVATION_HANDLER_MISSING",
            "POSTGRESQL_CONTENT": "UAT_POSTGRESQL_CONTENT_PROBE_HANDLER_MISSING",
            "UPLOADS_CONTENT": "UAT_UPLOADS_CONTENT_PROBE_HANDLER_MISSING",
            "ATTACHMENTS_CONTENT": "UAT_ATTACHMENTS_CONTENT_PROBE_HANDLER_MISSING",
            "BACKUP_STATUS_CONTENT": "UAT_BACKUP_STATUS_CONTENT_PROBE_HANDLER_MISSING",
            "MIGRATION_HEAD": "UAT_MIGRATION_HEAD_READONLY_PROBE_HANDLER_MISSING",
            "CADDY_IDENTITY": "UAT_CADDY_IDENTITY_READONLY_PROBE_HANDLER_MISSING",
            "POSTGRES_IDENTITY": "UAT_POSTGRES_IDENTITY_READONLY_PROBE_HANDLER_MISSING",
            "WEB_IDENTITY": "UAT_WEB_IDENTITY_READONLY_PROBE_HANDLER_MISSING",
            "WORKER_IDENTITY": "UAT_WORKER_IDENTITY_READONLY_PROBE_HANDLER_MISSING",
            "STRICT_RELEASE_IDENTITY":
                "UAT_STRICT_RELEASE_IDENTITY_READONLY_PROBE_HANDLER_MISSING",
            "HEALTH": "UAT_HEALTH_READONLY_PROBE_HANDLER_MISSING",
        }
        handlers = []
        for kind, labels, roles in (
                ("STAGE", EXECUTOR.STAGES, EXECUTOR.STAGE_SOURCE_ROLES),
                ("CHECK", EXECUTOR.CHECKS, EXECUTOR.CHECK_SOURCE_ROLES),
        ):
            for label in labels:
                tool = "EXECUTOR_INTERNAL" if label in EXECUTOR.INTERNAL_HANDLERS \
                    else "COMPOSE_PLUGIN_FD" \
                    if label == "WEB_WORKER_PREDECESSOR_ACTIVATION" else "DOCKER_FD"
                argv = ["EXECUTOR_INTERNAL", label] if tool == "EXECUTOR_INTERNAL" \
                    else [
                        "/proc/self/fd/{compose_plugin_fd}" if tool == "COMPOSE_PLUGIN_FD"
                        else "/proc/self/fd/{docker_fd}", "FIXED_HANDLER", label,
                    ]
                unavailable = missing.get(label)
                handlers.append({
                    "label": label, "kind": kind,
                    "handler_id": f"chenyida-erp.rollback.{label.lower().replace('_', '-')}.v1",
                    "actions": ["PREPARE", "EXECUTE", "PROBE"]
                        if kind == "STAGE" else ["PREPARE", "PROBE"],
                    "tool": tool, "argv_template": argv, "cwd": "/",
                    "environment": "EMPTY_FIXED_LOCALE_UTC",
                    "required_source_roles": [*roles[label], "runtime_adapter_activation"],
                    "input_contract": EXECUTOR.REQUEST_CONTRACT,
                    "output_contract":
                        "chenyida-erp-uat-promotion-rollback-stage-evidence/v1"
                        if kind == "STAGE"
                        else "chenyida-erp-uat-promotion-rollback-check-evidence/v1",
                    "timeout_seconds": 1800 if kind == "STAGE" \
                        else EXECUTOR.POSTGRES_CONTENT_PROBE_TIMEOUT_SECONDS \
                        if label == "POSTGRESQL_CONTENT" else 300,
                    "privilege": "ROOT_UNDER_RELEASE_SUPERVISOR_GLOBAL_LOCK",
                    "state_contract": EXECUTOR.HANDLER_STATE_CONTRACT,
                    "state_root": EXECUTOR.HANDLER_STATE_ROOT,
                    "durability": "IMMUTABLE_EVENT_ATOMIC_RENAME_FSYNC_DIRECTORY",
                    "containment_scope": "OPERATION_ENUMERATES_ALL_HANDLER_EVENTS",
                    "idempotency_key_fields": [
                        "operation_id", "execution_mode", "action", "label",
                        "record_intent_sha256", "runtime_plan_sha256",
                        "previous_result_sha256",
                    ],
                    "unknown_policy": "PROBE_THEN_CONTAIN_NEVER_BLINDLY_REEXECUTE",
                    "production_status": "AVAILABLE_READONLY_OR_METADATA_ONLY"
                        if unavailable is None else "UNAVAILABLE",
                    "unavailable_code": unavailable,
                })
        body = {
            "schema_version": 1,
            "contract": "chenyida-erp-uat-promotion-rollback-fixed-executor-catalog/v1",
            "execution_class": "UAT_FIXED_CLOSED_SET_FAIL_CLOSED",
            "executor_contract": "chenyida-erp-uat-promotion-rollback-fixed-executor/v1",
            "stages": list(EXECUTOR.STAGES), "checks": list(EXECUTOR.CHECKS),
            "handlers": handlers,
            "forbidden_tools": [
                "chenyida_erp_site/scripts/restore-selfhost.sh",
                "chenyida_erp_site/scripts/uat-promotion-compose-deployment-control.mjs",
            ],
            "capability_status": "BLOCKED_MISSING_UAT_CAPABLE_HANDLERS",
            "unavailable_capabilities": sorted(missing),
        }
        self.assertEqual(EXECUTOR.digest_value(body), EXECUTOR.CATALOG_SHA256)

    def test_recovery_cannot_select_a_label_or_execute(self):
        request = boundary_request(
            action="EXECUTE", execution_mode="RECOVERY", label="POSTGRESQL_RESTORE",
        )
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_DISPATCH_INVALID",
        ):
            EXECUTOR.validate_request(request)

    def test_non_observation_actions_require_a_nonzero_record_intent(self):
        request = boundary_request(action="PROBE", label="POSTGRESQL_RESTORE")
        request["record_intent_sha256"] = EXECUTOR.ZERO_SHA256
        request["request_sha256"] = EXECUTOR.digest_value(
            EXECUTOR.without(request, "request_sha256"),
        )
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_DISPATCH_INVALID",
        ):
            EXECUTOR.validate_request(request)

    def test_action_deadline_clips_fixed_tool_timeout_and_reserves_response_time(self):
        wall_now = EXECUTOR.datetime.strptime(
            "2026-08-16T02:00:00.000Z", "%Y-%m-%dT%H:%M:%S.%fZ",
        ).replace(tzinfo=EXECUTOR.timezone.utc).timestamp()
        monotonic_now = [100.0]
        budget = EXECUTOR.ActionDeadlineBudget(
            "2026-08-16T02:00:10.000Z",
            wall_clock=lambda: wall_now,
            monotonic_clock=lambda: monotonic_now[0],
        )
        self.assertEqual(budget.clip(60), 9.0)
        monotonic_now[0] = 109.0
        with self.assertRaises(EXECUTOR.HandlerOutcomeUnknown) as caught:
            budget.clip(60)
        self.assertEqual(caught.exception.reason_code, "ACTION_DEADLINE_EXHAUSTED")
        self.assertEqual(caught.exception.phase, "BEFORE_SIDE_EFFECT")
        self.assertFalse(caught.exception.side_effects_started)


class HandlerJournalTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="uat-rollback-handler-state-", dir="/tmp")
        self.root = Path(self.temporary.name)
        parent = self.root / EXECUTOR.HANDLER_STATE_ROOT.lstrip("/")
        parent.parent.mkdir(parents=True, mode=0o700)
        os.chmod(parent.parent, 0o700)
        self.request = {
            "operation": "ROLLBACK_EXECUTION",
            "operation_id": "rollback-handler-journal-001",
            "execution_mode": "ORIGINAL",
            "action": "PREPARE",
            "label": "POSTGRESQL_RESTORE",
            "request_sha256": digest("prepare-request"),
            "runtime_plan_sha256": digest("runtime-plan"),
            "execution_package_sha256": digest("execution-package"),
            "source_set_sha256": digest("source-set"),
            "transaction_intent_sha256": digest("transaction-intent"),
            "context_sha256": digest("context"),
            "record_intent_sha256": digest("record-intent"),
            "previous_result_sha256": EXECUTOR.ZERO_SHA256,
        }
        self.activation_receipt = digest("activation-receipt")
        self.journal = EXECUTOR.HandlerJournal(
            self.request["operation"], self.request["operation_id"], self.request["label"],
            str(self.root),
        )

    def tearDown(self):
        self.temporary.cleanup()

    def test_action_and_execution_mode_have_distinct_idempotency_keys(self):
        prepared = EXECUTOR.idempotency_key(self.request)
        executed = EXECUTOR.idempotency_key({**self.request, "action": "EXECUTE"})
        probed = EXECUTOR.idempotency_key({**self.request, "action": "PROBE"})
        recovered = EXECUTOR.idempotency_key({
            **self.request, "action": "PROBE", "execution_mode": "RECOVERY",
        })
        self.assertEqual(len({prepared, executed, probed, recovered}), 4)

    def test_journal_is_append_only_fsynced_and_exactly_replayable(self):
        payload = {"record_intent": {"stage": "POSTGRESQL_RESTORE"}}
        first = self.journal.append(
            self.request, self.activation_receipt, "PREPARED", payload,
            "2026-08-16T01:00:00.000Z",
        )
        replay = self.journal.append(
            self.request, self.activation_receipt, "PREPARED", payload,
            "2026-08-16T01:00:01.000Z",
        )
        self.assertEqual(replay, first)
        execute_request = {**self.request, "action": "EXECUTE", "request_sha256": digest("execute-request")}
        second = self.journal.append(
            execute_request, self.activation_receipt, "EXECUTION_STARTED", None,
            "2026-08-16T01:00:02.000Z",
        )
        self.assertEqual(second["sequence"], 2)
        events = self.journal.load()
        self.assertEqual([event["event"] for event in events], ["PREPARED", "EXECUTION_STARTED"])
        files = sorted(self.journal.events_root.iterdir())
        self.assertEqual([file.stat().st_mode & 0o777 for file in files], [0o400, 0o400])
        self.assertEqual(files[0].read_bytes(), canonical(first))

    def test_valid_pending_event_is_recovered_without_a_second_append(self):
        first = self.journal.append(
            self.request, self.activation_receipt, "PREPARED", {"fixture": "intent"},
            "2026-08-16T01:00:00.000Z",
        )
        final = next(self.journal.events_root.iterdir())
        pending = self.journal.pending_root / f"{final.name}.pending"
        os.rename(final, pending)
        events = self.journal.load()
        self.assertEqual(events, [first])
        self.assertFalse(pending.exists())
        self.assertEqual(len(list(self.journal.events_root.iterdir())), 1)

    def test_metadata_or_payload_drift_fails_closed(self):
        self.journal.append(
            self.request, self.activation_receipt, "PREPARED", {"fixture": "intent"},
            "2026-08-16T01:00:00.000Z",
        )
        event_file = next(self.journal.events_root.iterdir())
        os.chmod(event_file, 0o600)
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError, "ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_INVALID",
        ):
            self.journal.load()

    def test_preactivation_proof_is_durable_after_unseal_and_before_writer_start(self):
        request = {
            **self.request, "action": "EXECUTE",
            "label": "WEB_WORKER_PREDECESSOR_ACTIVATION",
            "request_sha256": digest("activation-execute-request"),
        }
        journal = EXECUTOR.HandlerJournal(
            request["operation"], request["operation_id"], request["label"],
            str(self.root),
        )
        effects = EXECUTOR.DurableSideEffectRecorder(
            journal, request, self.activation_receipt,
            clock=lambda: "2026-08-16T01:00:00.000Z",
        )
        intent = EXECUTOR.create_side_effect_intent(
            request, "DATABASE_UNSEAL", digest("unseal-target"), digest("unseal-argv"),
            "2026-08-16T01:00:00.000Z",
        )
        effects.begin("DATABASE_UNSEAL", intent)
        receipt = EXECUTOR.create_side_effect_receipt(
            intent, digest("sealed-database"), digest("released-database"),
            "2026-08-16T01:00:00.000Z",
        )
        effects.complete("DATABASE_UNSEAL", receipt)
        proof = copy.deepcopy(
            valid_handler_evidence("WEB_WORKER_PREDECESSOR_ACTIVATION")
            ["preactivation_content_proof"],
        )
        proof["binding_sha256"] = receipt["receipt_sha256"]
        proof["proof_sha256"] = EXECUTOR.digest_value(
            EXECUTOR.without(proof, "proof_sha256"),
        )
        self.assertEqual(
            effects.record_read_only_proof(EXECUTOR.PREACTIVATION_CONTENT_PROOF_NAME, proof),
            proof,
        )
        recovered = EXECUTOR.DurableSideEffectRecorder(
            journal, request, self.activation_receipt,
            clock=lambda: "2026-08-16T01:00:01.000Z",
        )
        self.assertEqual(
            recovered.read_only_proof(EXECUTOR.PREACTIVATION_CONTENT_PROOF_NAME), proof,
        )
        self.assertEqual(
            [event["event"] for event in journal.load()],
            ["SIDE_EFFECT_STARTED", "SIDE_EFFECT_RECORDED", "READ_ONLY_PROOF_RECORDED"],
        )

    def test_database_switch_recovery_attempt_is_reserved_once_before_replay(self):
        execute_request = {
            **self.request, "action": "EXECUTE",
            "request_sha256": digest("postgres-execute-request"),
        }
        effects = EXECUTOR.DurableSideEffectRecorder(
            self.journal, execute_request, self.activation_receipt,
            clock=lambda: "2026-08-16T01:00:00.000Z",
        )
        for name in (
                "STAGING_DATABASE_CREATE", "LOGICAL_DUMP_RESTORE",
                "PRIVILEGE_RECONCILE"):
            intent = EXECUTOR.create_side_effect_intent(
                execute_request, name, digest(f"target:{name}"), digest(f"argv:{name}"),
                "2026-08-16T01:00:00.000Z",
            )
            effects.begin(name, intent)
            effects.complete(name, EXECUTOR.create_side_effect_receipt(
                intent, digest(f"before:{name}"), digest(f"after:{name}"),
                "2026-08-16T01:00:00.000Z",
            ))
        opcode = {
            "opcode": "PG_RB_GUARDED_SWITCH_V3",
            "opcode_spec_sha256": digest("guarded-opcode-spec"),
            "sql_sha256": digest("guarded-sql"),
            "argv_template_sha256": digest("guarded-runner-argv"),
            "bindings": {
                "guarded_state_sha256": digest("guarded-state"),
                "before_observation_sha256": digest("opcode-old-observation"),
                "staging_content_proof_sha256": digest("staging-proof"),
                "staging_oid": "16385",
                "expected_switched_identity_sha256": digest("switched-identity"),
            },
        }
        switch_argv = EXECUTOR.postgres_guarded_switch_intent_argv(opcode)
        switch_intent = EXECUTOR.create_side_effect_intent(
            execute_request, "DATABASE_SWITCH", digest("guarded-target"),
            EXECUTOR.digest_value(switch_argv), "2026-08-16T01:00:00.000Z",
        )
        effects.begin("DATABASE_SWITCH", switch_intent)
        probe_request = {
            **execute_request, "action": "PROBE",
            "request_sha256": digest("postgres-probe-request"),
        }
        def crash_after_reservation(point, _request):
            if point == "AFTER_SIDE_EFFECT_RECOVERY_STARTED_DATABASE_SWITCH":
                raise RuntimeError("simulated-crash-after-recovery-reservation")

        crashing_probe_effects = EXECUTOR.DurableSideEffectRecorder(
            self.journal, probe_request, self.activation_receipt,
            clock=lambda: "2026-08-16T01:00:01.000Z",
            fault=crash_after_reservation,
        )
        with self.assertRaisesRegex(
            RuntimeError, "simulated-crash-after-recovery-reservation",
        ):
            crashing_probe_effects.begin_recovery(
                "DATABASE_SWITCH", opcode=opcode,
                before_observation_sha256=digest("old-observation-first"),
                candidate_oid="16384",
            )
        reopened_journal = EXECUTOR.HandlerJournal(
            probe_request["operation"], probe_request["operation_id"],
            probe_request["label"], str(self.root),
        )
        probe_effects = EXECUTOR.DurableSideEffectRecorder(
            reopened_journal, probe_request, self.activation_receipt,
            clock=lambda: "2026-08-16T01:00:02.000Z",
        )
        self.assertFalse(probe_effects.begin_recovery(
            "DATABASE_SWITCH", opcode=opcode,
            before_observation_sha256=digest("old-observation-second"),
            candidate_oid="16384",
        ))
        recovery_events = [
            event for event in self.journal.load()
            if event["event"] == "SIDE_EFFECT_RECOVERY_STARTED"
        ]
        self.assertEqual(len(recovery_events), 1)
        self.assertEqual(
            recovery_events[0]["payload"]["recovery_kind"],
            "EXACT_OLD_GUARDED_DATABASE_SWITCH_REPLAY",
        )

    def test_postgres_terminal_evidence_is_bound_to_durable_switch_intent_and_receipt(self):
        request = {
            **self.request, "action": "EXECUTE",
            "request_sha256": digest("postgres-terminal-binding-request"),
        }
        effects = EXECUTOR.DurableSideEffectRecorder(
            self.journal, request, self.activation_receipt,
            clock=lambda: "2026-08-16T01:00:00.000Z",
        )
        for name in (
                "STAGING_DATABASE_CREATE", "LOGICAL_DUMP_RESTORE",
                "PRIVILEGE_RECONCILE"):
            intent = EXECUTOR.create_side_effect_intent(
                request, name, digest(f"target:{name}"), digest(f"argv:{name}"),
                "2026-08-16T01:00:00.000Z",
            )
            effects.begin(name, intent)
            effects.complete(name, EXECUTOR.create_side_effect_receipt(
                intent, EXECUTOR.ZERO_SHA256, digest(f"after:{name}"),
                "2026-08-16T01:00:00.000Z",
            ))
        evidence = copy.deepcopy(valid_handler_evidence("POSTGRESQL_RESTORE"))
        target = {
            "staging_oid": evidence["restored_database_oid"],
            "candidate_oid": evidence["snapshot_database_oid"],
            "staging_content_proof_sha256":
                evidence["pre_switch_content_proof_sha256"],
            "guarded_opcode_spec_sha256":
                evidence["guarded_switch_opcode_spec_sha256"],
            "guarded_sql_sha256": evidence["guarded_switch_sql_sha256"],
            "guarded_state_sha256": evidence["guarded_switch_state_sha256"],
            "expected_switched_identity_sha256":
                evidence["guarded_switch_expected_identity_sha256"],
        }
        argv = {
            "opcode": "PG_RB_GUARDED_SWITCH_V3",
            "opcode_spec_sha256": evidence["guarded_switch_opcode_spec_sha256"],
            "sql_sha256": evidence["guarded_switch_sql_sha256"],
            "runner_argv_template_sha256":
                evidence["guarded_switch_runner_argv_template_sha256"],
        }
        switch_intent = EXECUTOR.create_side_effect_intent(
            request, "DATABASE_SWITCH", EXECUTOR.digest_value(target),
            EXECUTOR.digest_value(argv), "2026-08-16T01:00:00.000Z",
        )
        effects.begin("DATABASE_SWITCH", switch_intent)
        switch_receipt = EXECUTOR.create_side_effect_receipt(
            switch_intent, evidence["pre_switch_content_proof_sha256"],
            evidence["switch_effect_identity_sha256"],
            "2026-08-16T01:00:00.000Z",
        )
        effects.complete("DATABASE_SWITCH", switch_receipt)
        evidence["switch_receipt"] = switch_receipt
        evidence["switch_receipt_sha256"] = switch_receipt["receipt_sha256"]
        effects.validate_terminal_evidence(evidence)

        forged = copy.deepcopy(evidence)
        forged["guarded_switch_opcode_spec_sha256"] = digest("forged-opcode")
        forged["guarded_switch_sql_sha256"] = digest("forged-sql")
        forged["guarded_switch_runner_argv_template_sha256"] = digest("forged-runner")
        forged_receipt = forged["switch_receipt"]
        forged_receipt["argv_template_sha256"] = EXECUTOR.digest_value({
            "opcode": "PG_RB_GUARDED_SWITCH_V3",
            "opcode_spec_sha256": forged["guarded_switch_opcode_spec_sha256"],
            "sql_sha256": forged["guarded_switch_sql_sha256"],
            "runner_argv_template_sha256":
                forged["guarded_switch_runner_argv_template_sha256"],
        })
        forged_receipt["receipt_sha256"] = EXECUTOR.digest_value(
            EXECUTOR.without(forged_receipt, "receipt_sha256"),
        )
        forged["switch_receipt_sha256"] = forged_receipt["receipt_sha256"]
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_POSTGRES_TERMINAL_BINDING_INVALID",
        ):
            effects.validate_terminal_evidence(forged)


def engine_request(operation, label, action, operation_id, *, execution_mode="ORIGINAL"):
    labels = EXECUTOR.STAGES if operation == "ROLLBACK_EXECUTION" else EXECUTOR.CHECKS
    kind = "stage" if operation == "ROLLBACK_EXECUTION" else "check"
    digest_field = f"{kind}_intent_sha256"
    intent_body = {
        "schema_version": 2,
        "contract": f"chenyida-erp-uat-promotion-rollback-{kind}-intent/v2",
        "status": "PREPARED",
        "promotion_id": "promotion-handler-matrix-001",
        "promotion_generation": 1,
        "operation_id": operation_id,
        "execution_authorization_sha256": digest(f"authorization:{operation_id}"),
        "rollback_plan_sha256": digest("rollback-plan"),
        "execution_package_sha256": digest("execution-package"),
        "runtime_plan_sha256": digest("runtime-plan"),
        "ordinal": labels.index(label) + 1,
        kind: label,
        "previous_result_sha256": EXECUTOR.ZERO_SHA256,
        "input_sha256": digest(f"input:{operation_id}:{label}"),
        "prepared_at": "2026-08-16T02:00:00.000Z",
    }
    intent = {**intent_body, digest_field: EXECUTOR.digest_value(intent_body)}
    return {
        "operation": operation,
        "operation_id": operation_id,
        "execution_mode": execution_mode,
        "action": action,
        "label": label,
        "request_sha256": digest(f"request:{operation_id}:{execution_mode}:{action}"),
        "runtime_plan_sha256": intent["runtime_plan_sha256"],
        "execution_package_sha256": intent["execution_package_sha256"],
        "source_set_sha256": digest("source-set"),
        "transaction_intent_sha256": digest(f"transaction:{operation_id}"),
        "context_sha256": digest(f"context:{operation_id}"),
        "record_intent_sha256": intent[digest_field],
        "previous_result_sha256": intent["previous_result_sha256"],
        "requested_at": "2026-08-16T02:00:00.000Z",
        "payload": {"record_intent": intent},
    }


def engine_manifest():
    return {
        "activation": {"receipt_sha256": digest("activation-receipt")},
        "manifest_sha256": digest("descriptor-manifest"),
    }


def docker_runner_plan(*, compose_plugin_sha256=None, source_bindings=None):
    services = {}
    for index, service in enumerate(("caddy", "postgres", "web", "worker"), start=1):
        services[service] = {
            "container_id": str(index) * 64,
            "image_reference": f"registry.example.invalid/chenyida/{service}@sha256:{str(index) * 64}",
        }
    volumes = {
        domain: {"name": f"chenyida-erp_erp_{domain}"}
        for domain in ("uploads", "attachments", "backup_status")
    }
    targets = {
        "database": {
            "active": "chenyida_erp", "staging": "chenyida_erp_rb_deadbeefdeadbeef",
            "candidate_quarantine": "chenyida_erp_candidate_deadbeefdeadbeef",
        },
        "volumes": {
            domain: {
                "target": f"chenyida-erp_erp_{domain}_rb_deadbeefdeadbeef",
                "utility_container": f"chenyida-erp-rollback-{domain.replace('_', '-')}-deadbeefdeadbeef",
            }
            for domain in ("uploads", "attachments", "backup_status")
        },
    }
    return {
        "rollback_operation_id": "rollback-runner-deadbeef",
        "runtime_plan_sha256": digest("runner-runtime-plan"),
        "deployment": {
            "compose_project": "chenyida-erp",
            "compose_project_root": "/opt/erp/chenyida_erp_site",
        },
        "candidate": {"services": services, "volumes": volumes},
        "predecessor": {
            "runtime_configuration_sha256": digest("predecessor-runtime-configuration"),
            "web_image": f"registry.example.invalid/chenyida/web-old@sha256:{'a' * 64}",
            "web_image_config_digest": f"sha256:{'c' * 64}",
            "worker_image": f"registry.example.invalid/chenyida/worker-old@sha256:{'b' * 64}",
            "worker_image_config_digest": f"sha256:{'d' * 64}",
        },
        "toolchain": {
            "compose_plugin": {
                "path": EXECUTOR.COMPOSE_PLUGIN_FILE,
                "sha256": compose_plugin_sha256 or digest("compose-plugin"),
                "uid": 0, "gid": 0, "mode": "0755",
            },
        },
        "helpers": {
            "volume_restore": {
                "image_reference":
                    f"registry.example.invalid/chenyida/volume-helper@sha256:{'e' * 64}",
                "image_config_digest": f"sha256:{'f' * 64}",
                "application_version": "0.1.0-alpha.47",
                "git_commit": "1" * 40,
                "git_tree": "2" * 40,
                "image_role": "volume-restore-helper",
                "platform": "linux/amd64",
                "protocol": "chenyida-erp-volume-helper/v1",
                "contract_sha256":
                    "143071fae30de9f0f4c04dff1df17d5d42fd8bfaa967ca0e70836d5ffd1ffb8d",
                "evidence_run_id": "helper-evidence-fixture",
                "backup_status_reader_gid": 1000,
                "build_provenance_sha256": digest("helper-build-provenance"),
                "sbom_evidence_sha256": digest("helper-sbom-evidence"),
                "security_evidence_sha256": digest("helper-security-evidence"),
                "supervisor_bundle_sha256": digest("helper-supervisor-bundle"),
            },
        },
        "source_bindings": source_bindings or {
            "deployment_environment_sha256": digest("deployment-environment"),
            "compose_file_sha256": digest("compose-file"),
            "compose_release_file_sha256": digest("compose-release-file"),
        },
        "targets": targets,
    }


def valid_handler_evidence(label):
    value_hash = lambda field: digest(f"evidence:{label}:{field}")
    image = lambda service: f"registry.example.invalid/chenyida/{service}@sha256:{value_hash(service)}"
    service = lambda name, image_field: {
        "container_id": value_hash(f"container:{name}"), image_field:
            f"sha256:{value_hash(f'image:{name}')}" if image_field == "image_digest" else image(name),
        "running": True, "healthy": True, "restart_count": 0, "oom_killed": False,
    }
    app_service = lambda name: {
        **service(name, "image_reference"),
        "image_config_digest": f"sha256:{value_hash(f'image-config:{name}')}",
    }
    if label == "PRECONDITION_RECHECK":
        return {field: value_hash(field) for field in (
            "execution_package_sha256", "source_set_sha256", "checkpoint_receipt_sha256",
            "snapshot_intent_sha256", "finalization_intent_sha256", "runtime_plan_sha256",
            "runtime_activation_sha256",
        )}
    if label == "WRITER_CONTAINMENT":
        return {
            "database_fence_sha256": value_hash("fence"),
            "candidate_service_set_sha256": value_hash("services"),
            "web_container_id": value_hash("web"), "worker_container_id": value_hash("worker"),
            "database_oid": "16384", "system_identifier": "7612345678901234567",
            "stopped": True, "sealed": True, "runtime_plan_sha256": value_hash("plan"),
        }
    if label == "POSTGRESQL_RESTORE":
        empty_projection = EXECUTOR.postgres_empty_restore_projection()
        restore_database = {
            "name": "chenyida_erp_rb_deadbeefdeadbeef",
            "oid": "16385",
            "marker":
                "chenyida-erp-uat-rollback/v1:rollback-runner-deadbeef:RESTORED_STAGING",
            "owner": "postgres", "allow_connections": True,
            "connection_limit": 0, "default_transaction_read_only": True,
            "sessions": 0, "prepared_xacts": 0,
        }
        restore_profile = {
            "encoding": "UTF8", "locale_provider": "libc", "collate": "C",
            "ctype": "C", "collation_version": None,
            "default_tablespace": "pg_default",
        }
        restore_body = {
            "schema_version": 1,
            "contract": EXECUTOR.POSTGRES_RESTORE_PRECONDITION_CONTRACT,
            "base_spec_sha256": value_hash("base-spec"),
            "opcode_spec_sha256": value_hash("restore-precondition-opcode-spec"),
            "binding_sha256": value_hash("capacity-receipt"),
            "create_receipt_sha256": value_hash("capacity-receipt"),
            "dump_inventory_sha256": value_hash("dump-inventory"),
            "system_identifier": "7612345678901234567",
            "server_version_num": "170010",
            "database": restore_database,
            "database_identity_sha256": EXECUTOR.digest_value({
                "system_identifier": "7612345678901234567", **restore_database,
            }),
            "profile": restore_profile,
            "profile_sha256": EXECUTOR.digest_value(restore_profile),
            "empty_projection": empty_projection,
            "empty_projection_sha256": EXECUTOR.digest_value(empty_projection),
            "raw_observation_sha256": value_hash("restore-precondition-observation"),
        }
        restore_proof = {
            **restore_body,
            "restore_precondition_sha256": EXECUTOR.digest_value(restore_body),
        }
        staging_body = {
            "schema_version": 1,
            "contract": EXECUTOR.STAGING_CONTENT_PROOF_CONTRACT,
            "binding_sha256": value_hash("privilege-reconcile-receipt"),
            "base_spec_sha256": value_hash("base-spec"),
            "runtime_plan_sha256": value_hash("plan"),
            "source_reconciliation_sha256": value_hash("reconciliation"),
            "source_database_report_sha256": value_hash("content"),
            "live_database_report_sha256": value_hash("content"),
            "migration_head": "0046_runtime_lock_privilege_boundary.sql",
            "migration_ledger_file_sha256": value_hash("migration-ledger-file"),
            "migration_allowlist_sha256": value_hash("migration-manifest"),
            "migration_ledger_sha256": value_hash("migration-ledger"),
            "live_security_state_sha256": value_hash("staging-security"),
            "staging_allowed_session_role_set_sha256": value_hash("staging-roles"),
            "staging_session_client_policy_sha256": value_hash("staging-clients"),
            "staging_session_observation_sha256": value_hash("staging-sessions"),
            "staging_writer_session_count": 0,
            "staging_database_identity_sha256": EXECUTOR.digest_value({
                "name": "chenyida_erp_rb_deadbeefdeadbeef",
                "system_identifier": "7612345678901234567",
                "oid": "16385",
                "marker":
                    "chenyida-erp-uat-rollback/v1:rollback-runner-deadbeef:RESTORED_STAGING",
            }),
            "staging_database_name": "chenyida_erp_rb_deadbeefdeadbeef",
            "staging_database_oid": "16385",
            "staging_database_marker":
                "chenyida-erp-uat-rollback/v1:rollback-runner-deadbeef:RESTORED_STAGING",
            "system_identifier": "7612345678901234567",
            "staging_allow_connections": True, "staging_connection_limit": 0,
            "staging_default_transaction_read_only": True,
            "staging_prepared_xacts": 0,
            "candidate_database_name": "chenyida_erp",
            "candidate_database_oid": "16384",
            "candidate_database_marker": "chenyida-erp-deployment/v2:UAT:chenyida-erp",
            "candidate_database_allow_connections": False,
            "candidate_database_connection_limit": 0,
            "candidate_database_sessions": 0, "candidate_database_prepared_xacts": 0,
            "before_observation_sha256": value_hash("staging-before"),
            "after_observation_sha256": value_hash("staging-after"),
        }
        staging_proof = {
            **staging_body, "proof_sha256": EXECUTOR.digest_value(staging_body),
        }
        guarded_opcode_spec_sha256 = value_hash("guarded-opcode-spec")
        guarded_sql_sha256 = value_hash("guarded-sql")
        guarded_runner_argv_sha256 = value_hash("guarded-runner-argv")
        guarded_state_sha256 = EXECUTOR.digest_value({
            "source_reconciliation_sha256":
                staging_proof["source_reconciliation_sha256"],
            "expected_content_report_sha256":
                staging_proof["source_database_report_sha256"],
            "migration_ledger_file_sha256":
                staging_proof["migration_ledger_file_sha256"],
            "migration_allowlist_sha256":
                staging_proof["migration_allowlist_sha256"],
            "expected_security_state_sha256":
                staging_proof["live_security_state_sha256"],
            "staging_content_proof_sha256": staging_proof["proof_sha256"],
            "staging_oid": staging_proof["staging_database_oid"],
        })
        guarded_expected_identity_sha256 = EXECUTOR.digest_value({
            "active_name": "chenyida_erp", "active_oid": "16385",
            "quarantine_name": "chenyida_erp_candidate_deadbeefdeadbeef",
            "quarantine_oid": "16384", "state": "NEW_SEALED",
        })
        switch_receipt_body = {
            "schema_version": 2,
            "contract": EXECUTOR.SIDE_EFFECT_RECEIPT_CONTRACT,
            "status": "COMMITTED",
            "operation_id": "rollback-runner-deadbeef",
            "label": "POSTGRESQL_RESTORE",
            "side_effect_name": "DATABASE_SWITCH",
            "intent_sha256": value_hash("switch-intent"),
            "before_identity_sha256": staging_proof["proof_sha256"],
            "after_identity_sha256": value_hash("switch-effect"),
            "argv_template_sha256": EXECUTOR.digest_value({
                "opcode": "PG_RB_GUARDED_SWITCH_V3",
                "opcode_spec_sha256": guarded_opcode_spec_sha256,
                "sql_sha256": guarded_sql_sha256,
                "runner_argv_template_sha256": guarded_runner_argv_sha256,
            }),
            "recovery_observation_sha256": EXECUTOR.ZERO_SHA256,
            "daemon_state": "COMPLETED_NO_UNTRACKED_PROCESS",
            "completed_at": "2026-08-16T02:00:00.000Z",
        }
        switch_receipt = {
            **switch_receipt_body,
            "receipt_sha256": EXECUTOR.digest_value(switch_receipt_body),
        }
        return {
            "strategy": "RESTORE_TO_STAGING_DATABASE_ATOMIC_RENAME_RETAIN_CANDIDATE_QUARANTINED",
            "source_artifact_sha256": value_hash("artifact"), "source_artifact_bytes": 1024,
            "source_reconciliation_sha256": value_hash("reconciliation"),
            "target_content_sha256": value_hash("content"), "snapshot_database_oid": "16384",
            "restored_database_oid": "16385", "restored_database_name": "chenyida_erp",
            "system_identifier": "7612345678901234567",
            "migration_head": "0046_runtime_lock_privilege_boundary.sql",
            "restored_database_marker": "chenyida-erp-deployment/v2:UAT:chenyida-erp",
            "staging_database_name": "chenyida_erp_rb_deadbeefdeadbeef",
            "candidate_database_quarantine_name": "chenyida_erp_candidate_deadbeefdeadbeef",
            "candidate_database_quarantine_oid": "16384",
            "runtime_plan_sha256": value_hash("plan"),
            "manifest_sha256": value_hash("manifest"),
            "migration_ledger_file_sha256": value_hash("migration-ledger-file"),
            "migration_manifest_sha256": value_hash("migration-manifest"),
            "writer_containment_stage_result_sha256": value_hash("writer-containment"),
            "postgres_container_id": value_hash("postgres-container"),
            "postgres_image_config_digest": f"sha256:{value_hash('postgres-image-config')}",
            "database_profile_sha256": restore_proof["profile_sha256"],
            "postgres_base_spec_sha256": value_hash("base-spec"),
            "staging_create_receipt_sha256": value_hash("capacity-receipt"),
            "restore_receipt_sha256": value_hash("restore-receipt"),
            "privilege_reconcile_receipt_sha256":
                value_hash("privilege-reconcile-receipt"),
            "restore_precondition_opcode_spec_sha256":
                restore_proof["opcode_spec_sha256"],
            "restore_precondition_sha256":
                restore_proof["restore_precondition_sha256"],
            "dump_inventory_sha256": restore_proof["dump_inventory_sha256"],
            "empty_projection_sha256": restore_proof["empty_projection_sha256"],
            "restore_precondition": restore_proof,
            "pre_switch_content_proof_sha256": staging_proof["proof_sha256"],
            "pre_switch_content_proof": staging_proof,
            "runtime_privilege_access_sha256": value_hash("runtime-privilege-access"),
            "runtime_privilege_catalog_sha256": value_hash("runtime-privilege-catalog"),
            "runtime_privilege_catalog_artifact_sha256": value_hash("runtime-privilege-artifact"),
            "runtime_privilege_policy_sha256": value_hash("runtime-privilege-policy"),
            "runtime_privilege_operator_policy_sha256": value_hash("runtime-operator-policy"),
            "uat_reconciliation_authority_sha256": value_hash("reconciliation-authority"),
            "uat_reconciliation_activation_sha256": value_hash("reconciliation-activation"),
            "sealed_security_projection_sha256": value_hash("sealed-security-projection"),
            "staging_database_marker":
                "chenyida-erp-uat-rollback/v1:rollback-runner-deadbeef:RESTORED_STAGING",
            "candidate_database_quarantine_marker":
                "chenyida-erp-uat-rollback/v1:rollback-runner-deadbeef:CANDIDATE_QUARANTINE",
            "guarded_switch_opcode_spec_sha256": guarded_opcode_spec_sha256,
            "guarded_switch_sql_sha256": guarded_sql_sha256,
            "guarded_switch_runner_argv_template_sha256":
                guarded_runner_argv_sha256,
            "guarded_switch_state_sha256": guarded_state_sha256,
            "guarded_switch_expected_identity_sha256":
                guarded_expected_identity_sha256,
            "switch_receipt_sha256": switch_receipt["receipt_sha256"],
            "switch_effect_identity_sha256":
                switch_receipt["after_identity_sha256"],
            "switch_receipt": switch_receipt,
            "restored_database_allow_connections_at_commit": False,
            "restored_database_connection_limit_at_commit": 0,
            "restored_database_sessions_at_commit": 0,
            "restored_database_prepared_xacts_at_commit": 0,
            "candidate_database_quarantine_allow_connections_at_commit": False,
            "candidate_database_quarantine_connection_limit_at_commit": 0,
            "candidate_database_quarantine_sessions_at_commit": 0,
            "candidate_database_quarantine_prepared_xacts_at_commit": 0,
        }
    if label in {"UPLOADS_RESTORE", "ATTACHMENTS_RESTORE", "BACKUP_STATUS_RESTORE"}:
        domain = {
            "UPLOADS_RESTORE": "uploads", "ATTACHMENTS_RESTORE": "attachments",
            "BACKUP_STATUS_RESTORE": "backup_status",
        }[label]
        result = {
            "strategy": "RESTORE_TO_NEW_NAMED_VOLUMES_RECREATE_WRITERS_RETAIN_CANDIDATE_VOLUMES",
            "source_artifact_sha256": value_hash("artifact"), "source_artifact_bytes": 1024,
            "source_entries": 2, "source_reconciliation_sha256": value_hash("reconciliation"),
            "target_content_sha256": value_hash("content"),
            "target_volume": f"chenyida-erp_erp_{domain}_rb_deadbeefdeadbeef",
            "target_volume_identity_sha256": value_hash("target-volume"),
            "retained_candidate_volume": f"chenyida-erp_erp_{domain}",
            "retained_candidate_volume_identity_sha256": value_hash("candidate-volume"),
            "runtime_plan_sha256": value_hash("plan"),
            "domain": domain, "manifest_sha256": value_hash("manifest"),
            "expected_tree_sha256": value_hash("content"),
            "target_volume_marker_sha256": value_hash("target-volume-marker"),
            "target_root_identity_sha256": value_hash("target-root-identity"),
            "metadata_policy_sha256": value_hash("metadata-policy"),
            "metadata_state_sha256": value_hash("metadata-state"),
            "capacity_receipt_sha256": value_hash("capacity-receipt"),
            "volume_restore_receipt_sha256": value_hash("volume-restore-receipt"),
            "helper_image_reference":
                f"registry.example.invalid/chenyida/volume-helper@sha256:{value_hash('helper-image')}",
            "helper_image_config_digest": f"sha256:{value_hash('helper-image-config')}",
            "archive_inventory_sha256": value_hash("archive-inventory"),
        }
        if label == "BACKUP_STATUS_RESTORE":
            result.update({
                "backup_status_disposition": EXECUTOR.BACKUP_STATUS_DISPOSITION,
                "current_backup_readiness": False, "post_rollback_backup_required": True,
            })
        return result
    if label == "RUNTIME_CONFIGURATION_RESTORE":
        return {field: value_hash(field) for field in (
            "compose_file_sha256", "compose_release_file_sha256",
            "deployment_environment_sha256", "runtime_policy_sha256",
            "predecessor_runtime_configuration_sha256", "rollback_runtime_projection_sha256",
            "compose_rollback_overlay_sha256", "rollback_runtime_configuration_sha256",
            "runtime_plan_sha256",
        )}
    if label == "WEB_WORKER_PREDECESSOR_ACTIVATION":
        proof = {
            "schema_version": 1,
            "contract": EXECUTOR.PREACTIVATION_CONTENT_PROOF_CONTRACT,
            "binding_sha256": value_hash("database-unseal-receipt"),
            "runtime_plan_sha256": value_hash("plan"),
            "source_reconciliation_sha256": value_hash("source-reconciliation"),
            "source_database_report_sha256": value_hash("database-report"),
            "live_database_report_sha256": value_hash("database-report"),
            "migration_head": "0046_runtime_lock_privilege_boundary.sql",
            "migration_ledger_file_sha256": value_hash("migration-ledger-file"),
            "migration_allowlist_sha256": value_hash("migration-manifest"),
            "migration_ledger_sha256": value_hash("migration-ledger"),
            "live_security_state_sha256": value_hash("live-security-state"),
            "active_allowed_session_role_set_sha256": value_hash("allowed-role-set"),
            "active_session_client_policy_sha256": value_hash("client-policy"),
            "active_session_observation_sha256": value_hash("session-observation"),
            "active_writer_session_count": 0,
            "active_database_identity_sha256": value_hash("database-identity"),
            "restored_database_oid": "16385",
            "restored_database_marker": "chenyida-erp-deployment/v2:UAT:chenyida-erp",
            "system_identifier": "7612345678901234567",
            "active_allow_connections": True, "active_connection_limit": 64,
            "active_default_transaction_read_only": False, "active_prepared_xacts": 0,
            "candidate_database_quarantine_name":
                "chenyida_erp_candidate_deadbeefdeadbeef",
            "candidate_database_quarantine_oid": "16384",
            "candidate_database_quarantine_marker":
                "chenyida-erp-uat-rollback/v1:fixture:CANDIDATE_QUARANTINE",
            "candidate_database_quarantine_allow_connections": False,
            "candidate_database_quarantine_connection_limit": 0,
            "candidate_database_quarantine_sessions": 0,
            "candidate_database_quarantine_prepared_xacts": 0,
            "before_observation_sha256": value_hash("before-observation"),
            "after_observation_sha256": value_hash("after-observation"),
        }
        proof["proof_sha256"] = EXECUTOR.digest_value(proof)
        return {
            "strategy": "RECREATE_WEB_WORKER_FROM_PREDECESSOR_PINNED_DIGESTS",
            "web": app_service("web"),
            "worker": app_service("worker"),
            "caddy": service("caddy", "image_digest"),
            "postgres": service("postgres", "image_digest"),
            "rollback_postdeploy_receipt_sha256": value_hash("receipt"),
            "rollback_postdeploy_receipt_json": '{"schema_version":1}\n',
            "release_identity_sha256": value_hash("identity"),
            "release_identity_json": '{"schema_version":1}\n',
            "predecessor_runtime_configuration_sha256": value_hash("predecessor-config"),
            "rollback_runtime_configuration_sha256": value_hash("rollback-config"),
            "rollback_runtime_projection_sha256": value_hash("projection"),
            "compose_rollback_overlay_sha256": value_hash("overlay"),
            "protected_resources_sha256": value_hash("protected"),
            "runtime_plan_sha256": value_hash("plan"),
            "uat_reconciliation_authority_sha256": value_hash("reconciliation-authority"),
            "uat_reconciliation_activation_sha256": value_hash("reconciliation-activation"),
            "sealed_security_projection_sha256": value_hash("sealed-security-projection"),
            "database_unseal_receipt_sha256": value_hash("database-unseal-receipt"),
            "compose_invocation_receipt_sha256": value_hash("compose-invocation-receipt"),
            "active_database_allow_connections": True,
            "active_database_connection_limit": 64,
            "candidate_database_quarantine_allow_connections": False,
            "candidate_database_quarantine_connection_limit": 0,
            "preactivation_content_proof": proof,
        }
    if label == "PROTECTED_RESOURCE_RECHECK":
        protected = value_hash("protected")
        return {"before_sha256": protected, "after_sha256": protected,
                "runtime_plan_sha256": value_hash("plan"),
                "observation_sha256": value_hash("observation")}
    if label in {"POSTGRESQL_CONTENT", "UPLOADS_CONTENT", "ATTACHMENTS_CONTENT", "BACKUP_STATUS_CONTENT"}:
        result = {
            "source_artifact_sha256": value_hash("artifact"), "source_artifact_bytes": 1024,
            "source_reconciliation_sha256": value_hash("reconciliation"),
            "target_content_sha256": value_hash("content"),
            "target_identity_sha256": value_hash("target"),
            "stage_result_sha256": value_hash("stage"),
            "entries": None if label == "POSTGRESQL_CONTENT" else 2,
        }
        if label == "POSTGRESQL_CONTENT":
            result.update({
                "candidate_database_quarantine_name": "chenyida_erp_candidate_deadbeefdeadbeef",
                "candidate_database_quarantine_oid": "16384",
                "candidate_database_quarantine_present": True,
                "runtime_plan_sha256": value_hash("plan"),
                "restored_database_oid": "16385",
                "restored_database_marker": "chenyida-erp-deployment/v2:UAT:chenyida-erp",
                "system_identifier": "7612345678901234567",
                "migration_head": "0046_runtime_lock_privilege_boundary.sql",
                "migration_ledger_file_sha256": value_hash("migration-ledger-file"),
                "migration_manifest_sha256": value_hash("migration-manifest"),
                "restore_receipt_sha256": value_hash("restore-receipt"),
                "runtime_privilege_access_sha256": value_hash("runtime-privilege-access"),
                "runtime_privilege_catalog_sha256": value_hash("runtime-privilege-catalog"),
                "runtime_privilege_catalog_artifact_sha256": value_hash("runtime-privilege-artifact"),
                "runtime_privilege_policy_sha256": value_hash("runtime-privilege-policy"),
                "runtime_privilege_operator_policy_sha256": value_hash("runtime-operator-policy"),
                "uat_reconciliation_authority_sha256": value_hash("reconciliation-authority"),
                "uat_reconciliation_activation_sha256": value_hash("reconciliation-activation"),
                "sealed_security_projection_sha256": value_hash("sealed-security-projection"),
                "live_security_state_sha256": value_hash("live-security-state"),
                "active_allow_connections": True, "active_connection_limit": 64,
                "active_default_transaction_read_only": False,
                "active_allowed_session_role_set_sha256": value_hash("allowed-session-role-set"),
                "active_session_observation_sha256": value_hash("active-session-observation"),
                "active_session_client_policy_sha256": value_hash("session-client-policy"),
                "active_writer_session_count": 0, "active_unexpected_session_count": 0,
                "active_prepared_xacts": 0,
                "candidate_database_quarantine_marker":
                    "chenyida-erp-uat-rollback/v1:rollback-runner-deadbeef:CANDIDATE_QUARANTINE",
                "candidate_database_quarantine_allow_connections": False,
                "candidate_database_quarantine_connection_limit": 0,
                "candidate_database_quarantine_sessions": 0,
                "candidate_database_quarantine_prepared_xacts": 0,
            })
        else:
            domain = {
                "UPLOADS_CONTENT": "uploads", "ATTACHMENTS_CONTENT": "attachments",
                "BACKUP_STATUS_CONTENT": "backup_status",
            }[label]
            result.update({
                "candidate_volume_name": f"chenyida-erp_{label.lower()}",
                "candidate_volume_identity_sha256": value_hash("candidate"),
                "candidate_volume_present": True,
                "domain": domain, "runtime_plan_sha256": value_hash("plan"),
                "target_volume": f"chenyida-erp_erp_{domain}_rb_deadbeefdeadbeef",
                "target_volume_marker_sha256": value_hash("target-volume-marker"),
                "expected_tree_sha256": value_hash("content"),
                "target_root_identity_sha256": value_hash("target-root-identity"),
                "metadata_policy_sha256": value_hash("metadata-policy"),
                "metadata_state_sha256": value_hash("metadata-state"),
                "volume_restore_receipt_sha256": value_hash("volume-restore-receipt"),
                "helper_image_config_digest": f"sha256:{value_hash('helper-image-config')}",
            })
        if label == "BACKUP_STATUS_CONTENT":
            result.update({
                "backup_status_disposition": EXECUTOR.BACKUP_STATUS_DISPOSITION,
                "current_backup_readiness": False, "post_rollback_backup_required": True,
            })
        return result
    if label == "MIGRATION_HEAD":
        return {
            "migration_head": "0046_runtime_lock_privilege_boundary.sql",
            "migration_ledger_file_sha256": value_hash("ledger-file"),
            "migration_manifest_sha256": value_hash("manifest"),
            "database_identity_sha256": value_hash("database"),
            "postgresql_stage_result_sha256": value_hash("stage"),
        }
    if label in {"CADDY_IDENTITY", "POSTGRES_IDENTITY"}:
        return service(label.lower(), "image_digest")
    if label in {"WEB_IDENTITY", "WORKER_IDENTITY"}:
        name = label.split("_")[0].lower()
        return {
            **app_service(name),
            "application_version": "0.1.0-alpha.47", "git_commit": "a" * 40,
        }
    if label == "RUNTIME_CONFIGURATION":
        return {field: value_hash(field) for field in (
            "predecessor_runtime_configuration_sha256", "rollback_runtime_configuration_sha256",
            "rollback_runtime_projection_sha256", "compose_rollback_overlay_sha256",
            "deployment_environment_sha256", "activation_stage_result_sha256",
            "runtime_plan_sha256",
        )}
    if label == "STRICT_RELEASE_IDENTITY":
        return {field: value_hash(field) for field in (
            "release_identity_sha256", "release_manifest_sha256",
            "rollback_postdeploy_receipt_sha256", "activation_stage_result_sha256",
            "predecessor_runtime_configuration_sha256", "rollback_runtime_configuration_sha256",
        )}
    if label == "HEALTH":
        services = {
            "caddy": service("caddy", "image_digest"),
            "postgres": service("postgres", "image_digest"),
            "web": app_service("web"),
            "worker": app_service("worker"),
        }
        readiness = {
            "deployment_class": "UAT", "deployment_id": "chenyida-erp",
            "version": "0.1.0-alpha.47", "revision": "a" * 12,
            "migration_head": "0046_runtime_lock_privilege_boundary.sql",
            "migration_manifest_sha256": value_hash("health-migration-manifest"),
            "database_time": "2026-08-16T02:00:00.000Z",
            "components": {
                "postgresql": "READY", "migration": "READY", "worker": "READY",
                "uploads": "READY", "attachments": "READY", "runtime": "READY",
            },
        }
        result = {
            "status": "HEALTHY", "checked_at": "2026-08-16T02:00:00.000Z",
            "readiness_sha256": EXECUTOR.digest_value(readiness), "readiness": readiness,
            "services": services, "service_set_sha256": EXECUTOR.digest_value(services),
            "release_identity_sha256": value_hash("identity"),
            "runtime_configuration_sha256": value_hash("config"),
            "backup_status_disposition": EXECUTOR.BACKUP_STATUS_DISPOSITION,
            "current_backup_readiness": False, "post_rollback_backup_required": True,
        }
        result["health_sha256"] = EXECUTOR.digest_value(result)
        return result
    if label == "PROTECTED_RESOURCES":
        protected = value_hash("protected")
        return {
            "before_sha256": protected, "after_sha256": protected,
            "protected_recheck_stage_result_sha256": value_hash("stage"),
            "runtime_plan_sha256": value_hash("plan"),
        }
    raise AssertionError(label)


def bind_postgres_stage_proofs(evidence, base):
    """Rebind the synthetic stage fixture after its outer source facts change."""
    restore = evidence["restore_precondition"]
    restore_database = {
        "name": base["databases"]["staging_name"],
        "oid": evidence["restored_database_oid"],
        "marker": base["databases"]["staging_marker"],
        "owner": base["postgres"]["control_database_role"],
        "allow_connections": True,
        "connection_limit": 0,
        "default_transaction_read_only": True,
        "sessions": 0,
        "prepared_xacts": 0,
    }
    profile = EXECUTOR.without(base["profile"], "profile_sha256")
    precondition_opcode = EXECUTOR.derive_pg_opcode_spec(
        base, "PG_RB_OBSERVE_STAGING_RESTORE_PRECONDITION_V1", {
            "create_receipt_sha256": evidence["staging_create_receipt_sha256"],
            "staging_oid": evidence["restored_database_oid"],
            "dump_inventory_sha256": evidence["dump_inventory_sha256"],
            "expected_empty_projection_sha256":
                EXECUTOR.digest_value(EXECUTOR.postgres_empty_restore_projection()),
        },
    )
    restore.update({
        "base_spec_sha256": base["base_spec_sha256"],
        "opcode_spec_sha256": precondition_opcode["opcode_spec_sha256"],
        "binding_sha256": evidence["staging_create_receipt_sha256"],
        "create_receipt_sha256": evidence["staging_create_receipt_sha256"],
        "system_identifier": base["postgres"]["system_identifier"],
        "server_version_num": base["postgres"]["server_version_num"],
        "database": restore_database,
        "database_identity_sha256": EXECUTOR.digest_value({
            "system_identifier": base["postgres"]["system_identifier"],
            **restore_database,
        }),
        "profile": profile,
        "profile_sha256": EXECUTOR.digest_value(profile),
    })
    restore["restore_precondition_sha256"] = EXECUTOR.digest_value(
        EXECUTOR.without(restore, "restore_precondition_sha256"),
    )
    evidence.update({
        "postgres_base_spec_sha256": base["base_spec_sha256"],
        "database_profile_sha256": restore["profile_sha256"],
        "restore_precondition_opcode_spec_sha256": restore["opcode_spec_sha256"],
        "restore_precondition_sha256": restore["restore_precondition_sha256"],
        "dump_inventory_sha256": restore["dump_inventory_sha256"],
        "empty_projection_sha256": restore["empty_projection_sha256"],
    })
    staging = evidence["pre_switch_content_proof"]
    identity = {
        "name": base["databases"]["staging_name"],
        "system_identifier": base["postgres"]["system_identifier"],
        "oid": evidence["restored_database_oid"],
        "marker": base["databases"]["staging_marker"],
    }
    staging.update({
        "binding_sha256": evidence["privilege_reconcile_receipt_sha256"],
        "base_spec_sha256": base["base_spec_sha256"],
        "runtime_plan_sha256": base["runtime_plan_sha256"],
        "source_reconciliation_sha256":
            base["snapshot"]["source_reconciliation_sha256"],
        "source_database_report_sha256":
            base["snapshot"]["target_database_report_sha256"],
        "live_database_report_sha256":
            base["snapshot"]["target_database_report_sha256"],
        "migration_head": base["snapshot"]["migration_head"],
        "migration_ledger_file_sha256":
            base["snapshot"]["migration_ledger_file_sha256"],
        "migration_allowlist_sha256":
            base["snapshot"]["migration_allowlist_sha256"],
        "staging_database_identity_sha256": EXECUTOR.digest_value(identity),
        "staging_database_name": base["databases"]["staging_name"],
        "staging_database_oid": evidence["restored_database_oid"],
        "staging_database_marker": base["databases"]["staging_marker"],
        "system_identifier": base["postgres"]["system_identifier"],
        "candidate_database_name": base["databases"]["active_name"],
        "candidate_database_oid": base["databases"]["candidate_oid"],
        "candidate_database_marker": base["databases"]["candidate_marker"],
    })
    staging["proof_sha256"] = EXECUTOR.digest_value(
        EXECUTOR.without(staging, "proof_sha256"),
    )
    evidence["pre_switch_content_proof_sha256"] = staging["proof_sha256"]
    evidence["guarded_switch_state_sha256"] = EXECUTOR.digest_value({
        "source_reconciliation_sha256": staging["source_reconciliation_sha256"],
        "expected_content_report_sha256":
            staging["source_database_report_sha256"],
        "migration_ledger_file_sha256": staging["migration_ledger_file_sha256"],
        "migration_allowlist_sha256": staging["migration_allowlist_sha256"],
        "expected_security_state_sha256": staging["live_security_state_sha256"],
        "staging_content_proof_sha256": staging["proof_sha256"],
        "staging_oid": staging["staging_database_oid"],
    })
    evidence["guarded_switch_expected_identity_sha256"] = EXECUTOR.digest_value({
        "active_name": base["databases"]["active_name"],
        "active_oid": evidence["restored_database_oid"],
        "quarantine_name": base["databases"]["quarantine_name"],
        "quarantine_oid": base["databases"]["candidate_oid"],
        "state": "NEW_SEALED",
    })
    switch_receipt = evidence["switch_receipt"]
    switch_receipt.update({
        "operation_id": base["rollback_operation_id"],
        "before_identity_sha256": staging["proof_sha256"],
        "argv_template_sha256": EXECUTOR.digest_value({
            "opcode": "PG_RB_GUARDED_SWITCH_V3",
            "opcode_spec_sha256":
                evidence["guarded_switch_opcode_spec_sha256"],
            "sql_sha256": evidence["guarded_switch_sql_sha256"],
            "runner_argv_template_sha256":
                evidence["guarded_switch_runner_argv_template_sha256"],
        }),
    })
    switch_receipt["receipt_sha256"] = EXECUTOR.digest_value(
        EXECUTOR.without(switch_receipt, "receipt_sha256"),
    )
    evidence["switch_receipt_sha256"] = switch_receipt["receipt_sha256"]
    evidence["switch_effect_identity_sha256"] = (
        switch_receipt["after_identity_sha256"]
    )
    return evidence


class HandlerEvidenceBoundaryTest(unittest.TestCase):
    def test_all_twenty_two_exact_evidence_shapes_are_accepted(self):
        for operation, labels in (
            ("ROLLBACK_EXECUTION", EXECUTOR.STAGES),
            ("ROLLBACK_POSTVERIFY", EXECUTOR.CHECKS),
        ):
            for label in labels:
                with self.subTest(label=label):
                    evidence = valid_handler_evidence(label)
                    self.assertEqual(
                        EXECUTOR.validate_handler_evidence(operation, label, evidence), evidence,
                    )

    def test_every_shape_rejects_missing_and_additional_fields(self):
        for operation, labels in (
            ("ROLLBACK_EXECUTION", EXECUTOR.STAGES),
            ("ROLLBACK_POSTVERIFY", EXECUTOR.CHECKS),
        ):
            for label in labels:
                evidence = valid_handler_evidence(label)
                missing = dict(evidence)
                missing.pop(next(iter(missing)))
                extra = {**evidence, "unexpected": True}
                for mutated in (missing, extra):
                    with self.subTest(label=label, fields=sorted(mutated)):
                        with self.assertRaisesRegex(
                            EXECUTOR.FixedExecutorError,
                            "ROLLBACK_FIXED_EXECUTOR_HANDLER_EVIDENCE_INVALID",
                        ):
                            EXECUTOR.validate_handler_evidence(operation, label, mutated)

    def test_postgres_staging_identity_and_guarded_bindings_reject_rehashed_forgery(self):
        evidence = valid_handler_evidence("POSTGRESQL_RESTORE")
        proof = evidence["pre_switch_content_proof"]
        proof["staging_database_identity_sha256"] = digest("forged-staging-identity")
        proof["proof_sha256"] = EXECUTOR.digest_value(
            EXECUTOR.without(proof, "proof_sha256"),
        )
        evidence["pre_switch_content_proof_sha256"] = proof["proof_sha256"]
        evidence["guarded_switch_state_sha256"] = EXECUTOR.digest_value({
            "source_reconciliation_sha256": proof["source_reconciliation_sha256"],
            "expected_content_report_sha256": proof["source_database_report_sha256"],
            "migration_ledger_file_sha256": proof["migration_ledger_file_sha256"],
            "migration_allowlist_sha256": proof["migration_allowlist_sha256"],
            "expected_security_state_sha256": proof["live_security_state_sha256"],
            "staging_content_proof_sha256": proof["proof_sha256"],
            "staging_oid": proof["staging_database_oid"],
        })
        receipt = evidence["switch_receipt"]
        receipt["before_identity_sha256"] = proof["proof_sha256"]
        receipt["receipt_sha256"] = EXECUTOR.digest_value(
            EXECUTOR.without(receipt, "receipt_sha256"),
        )
        evidence["switch_receipt_sha256"] = receipt["receipt_sha256"]
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_HANDLER_EVIDENCE_INVALID",
        ):
            EXECUTOR.validate_handler_evidence(
                "ROLLBACK_EXECUTION", "POSTGRESQL_RESTORE", evidence,
            )

        for field in (
                "guarded_switch_state_sha256",
                "guarded_switch_expected_identity_sha256"):
            forged = valid_handler_evidence("POSTGRESQL_RESTORE")
            forged[field] = digest(f"forged:{field}")
            with self.subTest(field=field), self.assertRaisesRegex(
                EXECUTOR.FixedExecutorError,
                "ROLLBACK_FIXED_EXECUTOR_HANDLER_EVIDENCE_INVALID",
            ):
                EXECUTOR.validate_handler_evidence(
                    "ROLLBACK_EXECUTION", "POSTGRESQL_RESTORE", forged,
                )

    def test_postgres_staging_proof_rejects_boolean_integer_substitution(self):
        fields = (
            "schema_version", "staging_writer_session_count",
            "staging_connection_limit", "staging_prepared_xacts",
            "candidate_database_connection_limit", "candidate_database_sessions",
            "candidate_database_prepared_xacts",
        )
        for field in fields:
            proof = copy.deepcopy(
                valid_handler_evidence("POSTGRESQL_RESTORE")
                ["pre_switch_content_proof"],
            )
            proof[field] = True if field == "schema_version" else False
            proof["proof_sha256"] = EXECUTOR.digest_value(
                EXECUTOR.without(proof, "proof_sha256"),
            )
            with self.subTest(field=field), self.assertRaisesRegex(
                EXECUTOR.FixedExecutorError,
                "ROLLBACK_FIXED_EXECUTOR_STAGING_CONTENT_PROOF_INVALID",
            ):
                EXECUTOR.validate_staging_content_proof(proof)

    def test_postgres_restore_precondition_rejects_boolean_integer_substitution(self):
        cases = [
            ("schema_version", None),
            *[("database", field) for field in (
                "connection_limit", "sessions", "prepared_xacts",
            )],
            *[("empty_projection", field) for field in (
                "user_schema_count", "relation_count", "sequence_count",
                "routine_count", "standalone_type_count",
                "unexpected_extension_count", "large_object_count",
            )],
            ("empty_projection", "schema_migrations_present"),
        ]
        for parent, field in cases:
            proof = copy.deepcopy(
                valid_handler_evidence("POSTGRESQL_RESTORE")["restore_precondition"],
            )
            if parent == "schema_version":
                proof["schema_version"] = True
            elif parent == "database":
                proof["database"][field] = False
                proof["database_identity_sha256"] = EXECUTOR.digest_value({
                    "system_identifier": proof["system_identifier"],
                    **proof["database"],
                })
            else:
                proof["empty_projection"][field] = (
                    0 if field == "schema_migrations_present" else False
                )
                proof["empty_projection_sha256"] = EXECUTOR.digest_value(
                    proof["empty_projection"],
                )
            proof["restore_precondition_sha256"] = EXECUTOR.digest_value(
                EXECUTOR.without(proof, "restore_precondition_sha256"),
            )
            with self.subTest(parent=parent, field=field), self.assertRaisesRegex(
                EXECUTOR.FixedExecutorError,
                "ROLLBACK_FIXED_EXECUTOR_POSTGRES_RESTORE_PRECONDITION_INVALID",
            ):
                EXECUTOR.validate_pg_restore_precondition_envelope(proof)

    def test_postgres_final_evidence_rejects_boolean_commit_counters(self):
        fields = (
            "restored_database_connection_limit_at_commit",
            "restored_database_sessions_at_commit",
            "restored_database_prepared_xacts_at_commit",
            "candidate_database_quarantine_connection_limit_at_commit",
            "candidate_database_quarantine_sessions_at_commit",
            "candidate_database_quarantine_prepared_xacts_at_commit",
        )
        for field in fields:
            evidence = valid_handler_evidence("POSTGRESQL_RESTORE")
            evidence[field] = False
            with self.subTest(field=field), self.assertRaisesRegex(
                EXECUTOR.FixedExecutorError,
                "ROLLBACK_FIXED_EXECUTOR_HANDLER_EVIDENCE_INVALID",
            ):
                EXECUTOR.validate_handler_evidence(
                    "ROLLBACK_EXECUTION", "POSTGRESQL_RESTORE", evidence,
                )


class SafeArchiveInventoryTest(unittest.TestCase):
    @staticmethod
    def archive_bytes(members):
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w:gz", format=tarfile.PAX_FORMAT) as archive:
            for member, raw in members:
                archive.addfile(member, io.BytesIO(raw) if raw is not None else None)
        return output.getvalue()

    def inspect(self, raw, entries, **limits):
        with tempfile.TemporaryDirectory(prefix="uat-rollback-archive-", dir="/tmp") as root:
            target = Path(root) / "snapshot.tar.gz"
            target.write_bytes(raw)
            target.chmod(0o400)
            descriptor = os.open(target, os.O_RDONLY)
            try:
                return EXECUTOR.inspect_safe_tar_gzip(
                    descriptor, hashlib.sha256(raw).hexdigest(), len(raw), entries,
                    **limits,
                )
            finally:
                os.close(descriptor)

    def test_regular_files_and_directories_produce_a_stable_metadata_inventory(self):
        directory = tarfile.TarInfo("uploads")
        directory.type = tarfile.DIRTYPE
        directory.mode = 0o750
        directory.uid = 1000
        directory.gid = 1000
        directory.mtime = 1_700_000_000
        file = tarfile.TarInfo("uploads/document.txt")
        file.size = len(b"bound-content")
        file.mode = 0o640
        file.uid = 1000
        file.gid = 1000
        file.mtime = 1_700_000_001
        raw = self.archive_bytes([(directory, None), (file, b"bound-content")])
        first = self.inspect(raw, 1)
        second = self.inspect(raw, 1)
        self.assertEqual(first, second)
        self.assertEqual(first["status"], "SAFE_REGULAR_FILES_AND_DIRECTORIES_ONLY")
        self.assertEqual(first["entries"], 1)
        self.assertEqual(first["directories"], 1)
        self.assertEqual(first["uncompressed_bytes"], len(b"bound-content"))
        node_json_stringify_vector = (
            '[{"path_hex":"75706c6f6164732f646f63756d656e742e747874",'
            '"bytes":13,"sha256":"0759a88fc7e50aad8b1725056b3646bc'
            'dfe8b86bd97bd4aaf34785d97a679f99"}]'
        ).encode()
        self.assertEqual(
            first["file_tree_sha256"],
            hashlib.sha256(node_json_stringify_vector).hexdigest(),
        )
        self.assertNotEqual(first["inventory_sha256"], EXECUTOR.ZERO_SHA256)
        reconciled = self.inspect(
            raw, 1, metadata_policy=EXECUTOR.volume_metadata_policy("uploads", 1000),
        )
        metadata_vector = (
            '[{"path_hex":"2e","type":"DIRECTORY","uid":65532,"gid":65532,'
            '"mode":"0750","bytes":0},'
            '{"path_hex":"75706c6f616473","type":"DIRECTORY","uid":65532,'
            '"gid":65532,"mode":"0750","bytes":0},'
            '{"path_hex":"75706c6f6164732f646f63756d656e742e747874","type":"FILE",'
            '"uid":65532,"gid":65532,"mode":"0640","bytes":13}]'
        ).encode()
        self.assertEqual(
            reconciled["expected_metadata_state_sha256"],
            hashlib.sha256(metadata_vector).hexdigest(),
        )

    def test_backup_status_metadata_projection_requires_the_exact_receipt_root_marker(self):
        root = tarfile.TarInfo("./")
        root.type = tarfile.DIRTYPE
        root.mode = 0o2750
        root.uid = 0
        root.gid = 1000
        root.mtime = 1_700_000_000
        marker = tarfile.TarInfo("./.chenyida-erp-receipt-root-v2")
        marker.size = len(b"chenyida-erp-receipt-root/v2\n")
        marker.mode = 0o400
        marker.uid = 0
        marker.gid = 1000
        marker.mtime = 1_700_000_001
        policy = EXECUTOR.volume_metadata_policy("backup_status", 1000)
        raw = self.archive_bytes([
            (root, None), (marker, b"chenyida-erp-receipt-root/v2\n"),
        ])
        observed = self.inspect(raw, 1, metadata_policy=policy)
        self.assertNotEqual(observed["expected_metadata_state_sha256"], EXECUTOR.ZERO_SHA256)
        missing = tarfile.TarInfo("./history.json")
        missing.size = 2
        missing.mode = 0o640
        missing.uid = 0
        missing.gid = 1000
        missing.mtime = 1_700_000_002
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_ARCHIVE_METADATA_INVALID",
        ):
            self.inspect(self.archive_bytes([(root, None), (missing, b"{}")]), 1,
                         metadata_policy=policy)

    def test_gnu_root_empty_volume_and_setgid_directories_match_backup_manifest_counts(self):
        root = tarfile.TarInfo("./")
        root.type = tarfile.DIRTYPE
        root.mode = 0o2750
        root.uid = 1000
        root.gid = 1000
        root.mtime = 1_700_000_000
        status = tarfile.TarInfo("./history")
        status.type = tarfile.DIRTYPE
        status.mode = 0o2750
        status.uid = 1000
        status.gid = 1000
        status.mtime = 1_700_000_001
        raw = self.archive_bytes([(root, None), (status, None)])
        observed = self.inspect(raw, 0)
        self.assertEqual(observed["entries"], 0)
        self.assertEqual(observed["directories"], 2)
        self.assertEqual(observed["uncompressed_bytes"], 0)

        file = tarfile.TarInfo("./only.txt")
        file.size = 1
        file.mode = 0o640
        file.uid = 1000
        file.gid = 1000
        file.mtime = 1_700_000_002
        raw_at_limit = self.archive_bytes([(root, None), (file, b"x")])
        self.assertEqual(
            self.inspect(raw_at_limit, 1, maximum_files=1, maximum_members=2)["entries"],
            1,
        )

    def test_actual_gnu_tar_dot_archive_matches_backup_script_entry_semantics(self):
        with tempfile.TemporaryDirectory(prefix="uat-rollback-gnu-tar-", dir="/tmp") as root:
            volume = Path(root) / "backup_status"
            history = volume / "history"
            history.mkdir(parents=True)
            volume.chmod(0o2750)
            history.chmod(0o2750)
            marker = history / "recovery-readiness.json"
            marker.write_text("{}\n", encoding="utf-8")
            marker.chmod(0o640)
            archive = Path(root) / "backup-status.tar.gz"
            subprocess.run(
                ["/usr/bin/tar", "--create", "--gzip", "--file", archive,
                 "--directory", volume, "."],
                check=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            archive.chmod(0o400)
            descriptor = os.open(archive, os.O_RDONLY)
            try:
                observed = EXECUTOR.inspect_safe_tar_gzip(
                    descriptor, hashlib.sha256(archive.read_bytes()).hexdigest(),
                    archive.stat().st_size, 1,
                )
            finally:
                os.close(descriptor)
            self.assertEqual(observed["entries"], 1)
            self.assertEqual(observed["directories"], 2)

    def test_traversal_links_duplicates_and_entry_count_drift_fail_closed(self):
        cases = []
        traversal = tarfile.TarInfo("../escape")
        traversal.size = 1
        cases.append(("traversal", self.archive_bytes([(traversal, b"x")]), 1))
        link = tarfile.TarInfo("uploads/link")
        link.type = tarfile.SYMTYPE
        link.linkname = "/etc/passwd"
        cases.append(("symlink", self.archive_bytes([(link, None)]), 1))
        duplicate_one = tarfile.TarInfo("uploads/same")
        duplicate_one.size = 1
        duplicate_two = tarfile.TarInfo("./uploads/same")
        duplicate_two.size = 1
        cases.append((
            "duplicate",
            self.archive_bytes([(duplicate_one, b"a"), (duplicate_two, b"b")]), 2,
        ))
        normal = tarfile.TarInfo("uploads/only")
        normal.size = 1
        cases.append(("entry-count", self.archive_bytes([(normal, b"x")]), 2))
        repeated_dot = tarfile.TarInfo("././uploads/only")
        repeated_dot.size = 1
        cases.append(("repeated-dot", self.archive_bytes([(repeated_dot, b"x")]), 1))
        repeated_slash = tarfile.TarInfo("uploads//child")
        repeated_slash.size = 1
        cases.append(("repeated-slash", self.archive_bytes([(repeated_slash, b"x")]), 1))
        child_first = tarfile.TarInfo("uploads/child")
        child_first.size = 1
        parent_file = tarfile.TarInfo("uploads")
        parent_file.size = 1
        cases.append((
            "late-file-parent",
            self.archive_bytes([(child_first, b"x"), (parent_file, b"y")]), 2,
        ))
        for name, raw, entries in cases:
            with self.subTest(name=name), self.assertRaisesRegex(
                EXECUTOR.FixedExecutorError, "ROLLBACK_FIXED_EXECUTOR_ARCHIVE_INVALID",
            ):
                self.inspect(raw, entries)

    def test_control_characters_in_member_paths_fail_closed(self):
        for character in ("\n", "\r", "\t", "\x01", "\x1f", "\x7f"):
            member = tarfile.TarInfo(f"uploads/unsafe{character}name")
            member.size = 1
            with self.subTest(codepoint=ord(character)), self.assertRaisesRegex(
                EXECUTOR.FixedExecutorError, "ROLLBACK_FIXED_EXECUTOR_ARCHIVE_INVALID",
            ):
                self.inspect(self.archive_bytes([(member, b"x")]), 1)


class VolumeRestoreHelperContractTest(unittest.TestCase):
    def test_semantic_contract_and_static_shell_boundary_are_fixed(self):
        contract_path = SITE_ROOT / "operations/volume-restore-helper-contract-v1.json"
        helper_path = SITE_ROOT / "scripts/volume-restore-helper.sh"
        contract = json.loads(contract_path.read_text(encoding="utf-8"))
        expected_digest = contract.pop("contract_sha256")
        self.assertEqual(EXECUTOR.digest_value(contract), expected_digest)
        self.assertEqual(helper_path.stat().st_mode & 0o777, 0o755)
        helper = helper_path.read_text(encoding="utf-8")
        subprocess.run(
            ["/bin/sh", "-n", helper_path], check=True,
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        self.assertEqual(
            helper.count("-printf '%P\\0' | sort -z | while IFS= read -r -d '' relative"),
            2,
        )
        self.assertNotIn("-printf '%P\\n'", helper)
        for forbidden in ("eval", "sh -c", "bash -c", "docker.sock"):
            self.assertNotIn(forbidden, helper)

    def test_probe_output_requires_a_valid_metadata_policy_receipt(self):
        raw = (
            "metadata_policy_status=VALID\n"
            "entries=2\n"
            "uncompressed_bytes=13\n"
            f"file_tree_sha256={digest('probe-tree')}\n"
            f"metadata_state_sha256={digest('probe-metadata')}\n"
        ).encode()
        observed = EXECUTOR.parse_volume_helper_probe(raw)
        self.assertEqual(observed["metadata_policy_status"], "VALID")
        self.assertEqual(observed["entries"], 2)
        self.assertNotEqual(observed["volume_probe_sha256"], EXECUTOR.ZERO_SHA256)
        for mutated in (
            raw.replace(b"VALID", b"UNKNOWN"),
            raw.replace(b"entries=2", b"entries=250001"),
            raw.replace(digest("probe-tree").encode(), b"0" * 64),
            raw + b"unexpected=value\n",
            raw.rstrip(b"\n"),
        ):
            with self.subTest(mutated=mutated[:40]), self.assertRaisesRegex(
                EXECUTOR.FixedExecutorError,
                "ROLLBACK_FIXED_EXECUTOR_VOLUME_PROBE_INVALID",
            ):
                EXECUTOR.parse_volume_helper_probe(mutated)


class CapacityBudgetTest(unittest.TestCase):
    def test_gnu_df_output_and_cumulative_same_filesystem_budget_are_closed(self):
        parsed = EXECUTOR.parse_gnu_df_capacity(
            b"Filesystem       Avail     Inodes      IFree\n"
            b"/dev/mapper/data 21474836480 1000000 900000\n",
        )
        self.assertEqual(parsed["filesystem"], "/dev/mapper/data")
        observations = {
            domain: dict(parsed)
            for domain in ("uploads", "attachments", "backup_status")
        }
        requirements = {
            "uploads": {"required_bytes": 2 * 1024**3, "required_inodes": 1_000},
            "attachments": {"required_bytes": 3 * 1024**3, "required_inodes": 2_000},
            "backup_status": {"required_bytes": 1024**3, "required_inodes": 3_000},
        }
        receipt = EXECUTOR.validate_volume_capacity_budget(observations, requirements)
        self.assertEqual(receipt["status"], "SUFFICIENT_WITH_FIXED_RESERVE")
        self.assertNotEqual(receipt["capacity_budget_sha256"], EXECUTOR.ZERO_SHA256)
        insufficient = {domain: dict(value) for domain, value in requirements.items()}
        insufficient["backup_status"]["required_bytes"] = 6 * 1024**3
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_VOLUME_CAPACITY_INSUFFICIENT",
        ):
            EXECUTOR.validate_volume_capacity_budget(observations, insufficient)

    def test_capacity_output_rejects_malformed_or_inode_inconsistent_values(self):
        for raw in (
            b"Filesystem Avail Inodes IFree\n/dev/data 1 10 11\n",
            b"Filesystem Avail Inodes\n/dev/data 1 10\n",
            b"Filesystem Avail Inodes IFree\n/dev/data -1 10 1\n",
        ):
            with self.subTest(raw=raw), self.assertRaisesRegex(
                EXECUTOR.FixedExecutorError,
                "ROLLBACK_FIXED_EXECUTOR_CAPACITY_OUTPUT_INVALID",
            ):
                EXECUTOR.parse_gnu_df_capacity(raw)


class VolumeRestoreSpecTest(unittest.TestCase):
    @staticmethod
    def inputs(domain="uploads"):
        files = {
            "uploads": "uploads.tar.gz",
            "attachments": "attachments.tar.gz",
            "backup_status": "backup-status.tar.gz",
        }
        role = f"snapshot_{domain}"
        artifact_sha256 = digest(f"volume-artifact:{domain}")
        manifest_sha256 = digest("volume-snapshot-manifest")
        reconciliation_sha256 = digest("volume-snapshot-reconciliation")
        plan = docker_runner_plan()
        for item_domain, volume in plan["candidate"]["volumes"].items():
            volume.update({
                "domain": item_domain,
                "identity_sha256": digest(f"volume-candidate-identity:{item_domain}"),
            })
        plan["source_bindings"].update({
            "snapshot_manifest_sha256": manifest_sha256,
            "snapshot_reconciliation_sha256": reconciliation_sha256,
        })
        package = {
            "snapshot_objects": {
                domain: {
                    "file": files[domain], "sha256": artifact_sha256,
                    "bytes": 4096, "entries": 2,
                },
            },
            "content_reconciliation": {
                "source_reconciliation_sha256": reconciliation_sha256,
                "files": {
                    domain: {"tree_sha256": digest(f"volume-tree:{domain}"), "entries": 2},
                },
            },
            "sources": {
                role: {"sha256": artifact_sha256, "bytes": 4096},
                "snapshot_manifest": {"sha256": manifest_sha256},
                "snapshot_reconciliation": {"sha256": reconciliation_sha256},
            },
        }

        class Inputs:
            pass

        inputs = Inputs()
        inputs.package = package
        inputs.plan = plan
        return inputs

    def test_each_domain_derives_an_exact_content_and_identity_bound_spec(self):
        for domain in ("uploads", "attachments", "backup_status"):
            with self.subTest(domain=domain):
                inputs = self.inputs(domain)
                spec = EXECUTOR.derive_volume_restore_spec(inputs, domain)
                self.assertEqual(spec["domain"], domain)
                self.assertEqual(
                    spec["candidate_volume_identity_sha256"],
                    inputs.plan["candidate"]["volumes"][domain]["identity_sha256"],
                )
                self.assertEqual(
                    spec["source_reconciliation_sha256"],
                    inputs.plan["source_bindings"]["snapshot_reconciliation_sha256"],
                )
                self.assertNotEqual(spec["restore_spec_sha256"], EXECUTOR.ZERO_SHA256)

    def test_reconciliation_manifest_and_target_drift_fail_closed(self):
        mutations = []
        inputs = self.inputs()
        inputs.package["content_reconciliation"]["files"]["uploads"]["entries"] = 3
        mutations.append(inputs)
        inputs = self.inputs()
        inputs.plan["source_bindings"]["snapshot_manifest_sha256"] = digest("substituted")
        mutations.append(inputs)
        inputs = self.inputs()
        inputs.plan["targets"]["volumes"]["uploads"]["target"] = \
            inputs.plan["candidate"]["volumes"]["uploads"]["name"]
        mutations.append(inputs)
        for mutated in mutations:
            with self.subTest(mutated=mutated), self.assertRaisesRegex(
                EXECUTOR.FixedExecutorError,
                "ROLLBACK_FIXED_EXECUTOR_VOLUME_RESTORE_SPEC_INVALID",
            ):
                EXECUTOR.derive_volume_restore_spec(mutated, "uploads")

    def test_volume_inspection_has_an_exact_semantic_identity(self):
        labels = {
            "chenyida.erp.uat-rollback-operation": "rollback-runner-deadbeef",
            "chenyida.erp.uat-rollback-domain": "uploads",
        }
        value = {
            "CreatedAt": "2026-08-16T02:03:04.123456789Z",
            "Driver": "local", "Labels": labels,
            "Mountpoint": "/var/lib/docker/volumes/rollback-uploads/_data",
            "Name": "rollback-uploads", "Options": None, "Scope": "local",
        }
        observed = EXECUTOR.parse_volume_inspection(
            canonical(value), "rollback-uploads", expected_labels=labels,
        )
        self.assertEqual(observed["labels"], labels)
        self.assertNotEqual(observed["identity_sha256"], EXECUTOR.ZERO_SHA256)
        mutations = [
            {**value, "CreatedAt": "----------"},
            {**value, "Mountpoint": "/var/lib/docker/../escape"},
            {**value, "Unexpected": True},
            {**value, "Labels": {**labels, "substituted": "true"}},
            {**value, "Options": {"device": "/srv/substituted"}},
        ]
        for mutated in mutations:
            with self.subTest(fields=sorted(mutated)), self.assertRaisesRegex(
                EXECUTOR.FixedExecutorError,
                "ROLLBACK_FIXED_EXECUTOR_VOLUME_INSPECTION_INVALID",
            ):
                EXECUTOR.parse_volume_inspection(
                    canonical(mutated), "rollback-uploads", expected_labels=labels,
                )


class VolumeCapabilityRuntimeTest(unittest.TestCase):
    @staticmethod
    def spec():
        spec = {
            "schema_version": 1,
            "contract": "chenyida-erp-uat-promotion-rollback-volume-restore-spec/v1",
            "domain": "uploads", "source_role": "snapshot_uploads",
            "source_artifact_sha256": digest("runtime-volume-artifact"),
            "source_artifact_bytes": 4096, "source_entries": 2,
            "source_reconciliation_sha256": digest("runtime-volume-reconciliation"),
            "expected_tree_sha256": digest("runtime-volume-tree"),
            "manifest_sha256": digest("runtime-volume-manifest"),
            "candidate_volume": "chenyida-erp_erp_uploads",
            "candidate_volume_identity_sha256": digest("runtime-candidate-volume"),
            "target_volume": "chenyida-erp_erp_uploads_rb_deadbeefdeadbeef",
            "utility_container": "chenyida-erp-rollback-uploads-deadbeefdeadbeef",
            "metadata_policy_sha256":
                EXECUTOR.volume_metadata_policy("uploads", 1000)["metadata_policy_sha256"],
            "backup_status_reader_gid": 1000,
            "runtime_plan_sha256": digest("runtime-volume-plan"),
            "helper_image_reference":
                f"registry.example.invalid/chenyida/volume-helper@sha256:{digest('runtime-helper')}",
            "helper_image_config_digest": f"sha256:{digest('runtime-helper-config')}",
            "restore_spec_sha256": digest("runtime-volume-spec"),
        }
        return spec

    @staticmethod
    def inventory(spec):
        return {
            "status": "SAFE_REGULAR_FILES_AND_DIRECTORIES_ONLY",
            "entries": spec["source_entries"], "directories": 1,
            "uncompressed_bytes": 13,
            "file_tree_sha256": spec["expected_tree_sha256"],
            "records_sha256": digest("runtime-volume-records"),
            "expected_metadata_state_sha256": digest("runtime-metadata-state"),
            "inventory_sha256": digest("runtime-volume-inventory"),
        }

    class Inputs:
        def __init__(self, spec, label):
            self.request = {
                "operation_id": "rollback-runtime-volume-001", "label": label,
                "runtime_plan_sha256": spec["runtime_plan_sha256"],
                "source_set_sha256": digest("runtime-volume-source-set"),
            }
            self.rollback_result = None

        @staticmethod
        def fd(role):
            if role != "snapshot_uploads":
                raise AssertionError(role)
            return 99

    class Effects:
        def __init__(self):
            self.started = []
            self.completed = []
            self.receipts = {}
            self.intents = {}
            self.proofs = {}
            self.recovery_attempts = {}

        def begin(self, name, intent):
            self.started.append(name)
            self.intents[name] = intent
            return intent

        def complete(self, name, receipt):
            self.completed.append(name)
            self.receipts[name] = receipt
            return receipt

        def receipt(self, name):
            return self.receipts.get(name)

        def started_intent(self, name):
            return self.intents.get(name)

        def begin_recovery(
                self, name, *, opcode, before_observation_sha256, candidate_oid,
        ):
            if name in self.recovery_attempts:
                return False
            self.recovery_attempts[name] = {
                "opcode": opcode,
                "before_observation_sha256": before_observation_sha256,
                "candidate_oid": candidate_oid,
            }
            return True

        def record_read_only_proof(self, name, proof):
            self.proofs[name] = proof
            return proof

        def read_only_proof(self, name):
            return self.proofs.get(name)

    class Driver:
        def __init__(self, spec, inventory):
            self.spec = spec
            self.inventory = inventory
            self.calls = []
            self.probe_tree_sha256 = spec["expected_tree_sha256"]
            self.target_identity = digest("runtime-target-volume")
            self.target_marker = digest("runtime-target-marker")
            self.metadata_state = digest("runtime-metadata-state")

        def preflight(self, _spec, *, target_present):
            self.calls.append(("preflight", target_present))
            return {
                "helper_image_admission_sha256": digest("runtime-helper-admission"),
                "candidate_volume_identity_sha256":
                    self.spec["candidate_volume_identity_sha256"],
                "target_present": target_present,
            }

        def capacity(self, _spec):
            self.calls.append("capacity")
            return {
                "container_id": digest("capacity-helper"),
                "observation": {
                    "filesystem": "/dev/mapper/data", "available_bytes": 20 * 1024**3,
                    "total_inodes": 1_000_000, "available_inodes": 900_000,
                },
                "exited_identity_sha256": digest("capacity-exited"),
                "removed_identity_sha256": digest("capacity-removed"),
            }

        def create_target(self, _spec):
            self.calls.append("create_target")
            return {
                "target_volume_identity_sha256": self.target_identity,
                "target_volume_marker_sha256": self.target_marker,
                "target_labels_sha256": digest("runtime-target-labels"),
            }

        def restore(self, _spec, archive_fd):
            self.calls.append(("restore", archive_fd))
            return {"restore_sha256": digest("runtime-restore")}

        def reconcile(self, _spec):
            self.calls.append("reconcile")
            return {"reconciliation_sha256": digest("runtime-metadata-reconcile")}

        def probe(self, _spec):
            self.calls.append("probe")
            return {
                "metadata_policy_status": "VALID", "entries": self.spec["source_entries"],
                "uncompressed_bytes": self.inventory["uncompressed_bytes"],
                "file_tree_sha256": self.probe_tree_sha256,
                "metadata_state_sha256": self.metadata_state,
                "volume_probe_sha256": digest("runtime-volume-probe"),
                "container_id": digest("runtime-probe-helper"),
                "exited_identity_sha256": digest("runtime-probe-exited"),
            }

        def remove_utility(self, _spec):
            self.calls.append("remove")
            return digest("runtime-probe-removed")

        def observe_target(self, _spec, expected_identity_sha256):
            self.calls.append(("observe_target", expected_identity_sha256))
            if expected_identity_sha256 != self.target_identity:
                raise AssertionError(expected_identity_sha256)
            return {
                "target_volume_identity_sha256": self.target_identity,
                "target_volume_marker_sha256": self.target_marker,
            }

    def test_restore_and_postverify_have_exact_durable_effect_order(self):
        spec = self.spec()
        inventory = self.inventory(spec)
        driver = self.Driver(spec, inventory)
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            volume_driver=driver, clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        execution_inputs = self.Inputs(spec, "UPLOADS_RESTORE")
        execution_effects = self.Effects()
        with patch.object(EXECUTOR, "derive_volume_restore_spec", return_value=spec), \
                patch.object(EXECUTOR, "inspect_safe_tar_gzip", return_value=inventory):
            stage_evidence = runtime._execute_volume(
                "UPLOADS_RESTORE", execution_inputs, execution_effects,
            )
        self.assertEqual(
            execution_effects.started,
            ["TARGET_VOLUME_CREATE", "ARCHIVE_RESTORE", "METADATA_RECONCILE", "UTILITY_REMOVE"],
        )
        self.assertEqual(execution_effects.completed, execution_effects.started)
        self.assertEqual(driver.calls, [
            ("preflight", False), "capacity", "create_target", ("restore", 99),
            "reconcile", "probe", "remove",
        ])
        with patch.object(EXECUTOR, "derive_volume_restore_spec", return_value=spec), \
                patch.object(EXECUTOR, "inspect_safe_tar_gzip", return_value=inventory):
            recovered = runtime.probe(
                "UPLOADS_RESTORE", execution_inputs, [{"event": "EXECUTION_STARTED"}],
                execution_effects,
            )["evidence"]
        self.assertEqual(recovered, stage_evidence)
        self.assertEqual(driver.calls[-2:], [
            ("preflight", True), ("observe_target", driver.target_identity),
        ])

        postverify_inputs = self.Inputs(spec, "UPLOADS_CONTENT")
        postverify_inputs.rollback_result = {
            "stages": [
                {"stage_result_sha256": digest(f"unused-stage:{index}")}
                for index in range(9)
            ],
        }
        postverify_inputs.rollback_result["stages"][3] = {
            "stage_result_sha256": digest("runtime-uploads-stage"),
            "evidence": stage_evidence,
        }
        postverify_effects = self.Effects()
        with patch.object(EXECUTOR, "derive_volume_restore_spec", return_value=spec), \
                patch.object(EXECUTOR, "inspect_safe_tar_gzip", return_value=inventory):
            check_evidence = runtime._probe_volume_content(
                "UPLOADS_CONTENT", postverify_inputs, postverify_effects,
            )
        self.assertEqual(
            postverify_effects.started, ["PROBE_UTILITY_CREATE", "PROBE_UTILITY_REMOVE"],
        )
        self.assertEqual(postverify_effects.completed, postverify_effects.started)
        self.assertEqual(check_evidence["target_content_sha256"], spec["expected_tree_sha256"])
        self.assertEqual(driver.calls[-4:], [
            ("preflight", True), ("observe_target", driver.target_identity), "probe", "remove",
        ])
        with patch.object(EXECUTOR, "derive_volume_restore_spec", return_value=spec), \
                patch.object(EXECUTOR, "inspect_safe_tar_gzip", return_value=inventory):
            recovered_check = runtime.probe(
                "UPLOADS_CONTENT", postverify_inputs,
                [{"event": "SIDE_EFFECT_RECORDED"}], postverify_effects,
            )["evidence"]
        self.assertEqual(recovered_check, check_evidence)
        self.assertEqual(driver.calls[-2:], [
            ("preflight", True), ("observe_target", driver.target_identity),
        ])

    def test_content_mismatch_is_rejected_only_after_probe_helper_cleanup(self):
        spec = self.spec()
        inventory = self.inventory(spec)
        driver = self.Driver(spec, inventory)
        driver.probe_tree_sha256 = digest("substituted-volume-tree")
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            volume_driver=driver, clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        effects = self.Effects()
        with patch.object(EXECUTOR, "derive_volume_restore_spec", return_value=spec), \
                patch.object(EXECUTOR, "inspect_safe_tar_gzip", return_value=inventory), \
                self.assertRaises(EXECUTOR.HandlerOutcomeUnknown) as caught:
            runtime._execute_volume("UPLOADS_RESTORE", self.Inputs(spec, "UPLOADS_RESTORE"), effects)
        self.assertEqual(caught.exception.reason_code, "TARGET_IDENTITY_DRIFT")
        self.assertEqual(caught.exception.phase, "AFTER_SIDE_EFFECT")
        self.assertTrue(caught.exception.side_effects_started)
        self.assertEqual(driver.calls[-1], "remove")
        self.assertEqual(effects.started[-1], "UTILITY_REMOVE")
        self.assertEqual(effects.completed, effects.started[:-1])

    def test_execution_probe_never_commits_from_a_receipt_prefix(self):
        spec = self.spec()
        inventory = self.inventory(spec)
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            volume_driver=self.Driver(spec, inventory),
            clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        effects = self.Effects()
        effects.receipts["TARGET_VOLUME_CREATE"] = {"fixture": "recorded-prefix"}
        with self.assertRaises(EXECUTOR.HandlerOutcomeUnknown) as caught:
            runtime.probe(
                "UPLOADS_RESTORE", self.Inputs(spec, "UPLOADS_RESTORE"),
                [{"event": "SIDE_EFFECT_RECORDED"}], effects,
            )
        self.assertEqual(caught.exception.reason_code, "PROBE_INCONCLUSIVE")
        self.assertEqual(caught.exception.uncertain_action, "EXECUTE")


class InternalCapabilityRuntimeTest(unittest.TestCase):
    @staticmethod
    def inputs():
        plan = docker_runner_plan()
        privilege_source_sha256 = {
            role: digest(f"internal-source:{role}")
            for role in (
                "snapshot_runtime_privilege_access",
                "snapshot_runtime_privilege_compiled_catalog",
                "snapshot_runtime_privilege_policy",
                "snapshot_runtime_privilege_operator_policy",
            )
        }
        plan["source_bindings"].update({
            "runtime_privilege_access_sha256":
                privilege_source_sha256["snapshot_runtime_privilege_access"],
            "runtime_privilege_compiled_catalog_sha256":
                privilege_source_sha256["snapshot_runtime_privilege_compiled_catalog"],
            "runtime_privilege_policy_sha256":
                privilege_source_sha256["snapshot_runtime_privilege_policy"],
            "runtime_privilege_operator_policy_sha256":
                privilege_source_sha256["snapshot_runtime_privilege_operator_policy"],
        })
        access_body = {
            "schema_version": 2,
            "contract": "chenyida-erp-postgresql-runtime-privilege-access/v2",
            "authorization_status": "BLOCKED",
        }
        access = {
            **access_body, "access_sha256": EXECUTOR.digest_compact_value(access_body),
        }
        catalog_body = {
            "schema_version": 1,
            "contract": "chenyida-erp-postgresql-runtime-compiled-catalog/v1",
            "evidence_scope": "SYNTHETIC_ISOLATED_ONLY",
            "source_binding": {"access_intent": {
                "access_sha256": access["access_sha256"],
                "file_sha256":
                    privilege_source_sha256["snapshot_runtime_privilege_access"],
            }},
            "catalog": {},
            "catalog_sha256": EXECUTOR.digest_value({}),
        }
        catalog = {
            **catalog_body, "artifact_sha256": EXECUTOR.digest_value(catalog_body),
        }
        policy_body = {
            "schema_version": 2,
            "contract": "chenyida-erp-postgresql-runtime-privilege-policy/v2",
            "evidence_scope": "SYNTHETIC_ISOLATED_ONLY",
            "authorization_status": "ISOLATED_RECONCILIATION_ONLY",
            "deployment_authorized": False,
            "source_binding": {
                "access_intent": {
                    "access_sha256": access["access_sha256"],
                    "file_sha256":
                        privilege_source_sha256["snapshot_runtime_privilege_access"],
                },
                "compiled_catalog": {
                    "catalog_sha256": catalog["catalog_sha256"],
                    "artifact_sha256": catalog["artifact_sha256"],
                    "file_sha256": privilege_source_sha256[
                        "snapshot_runtime_privilege_compiled_catalog"
                    ],
                },
            },
        }
        policy = {**policy_body, "policy_sha256": EXECUTOR.digest_value(policy_body)}
        operator_body = {
            "schema_version": 1,
            "contract": "chenyida-erp-postgresql-runtime-privilege-operator-policy/v1",
            "evidence_scope": "CONTROLLED_RUNTIME_ONLY",
            "deployment_authorized": False,
            "runtime_privilege_policy_sha256": policy["policy_sha256"],
        }
        operator = {
            **operator_body, "policy_sha256": EXECUTOR.digest_value(operator_body),
        }
        privilege_documents = {
            "snapshot_runtime_privilege_access": access,
            "snapshot_runtime_privilege_compiled_catalog": catalog,
            "snapshot_runtime_privilege_policy": policy,
            "snapshot_runtime_privilege_operator_policy": operator,
        }
        package = {
            "package_sha256": digest("internal-package"),
            "source_set_sha256": digest("internal-source-set"),
            "runtime_plan_sha256": plan["runtime_plan_sha256"],
            "protected_resources_sha256": digest("internal-protected-resources"),
            "sources": {
                role: {"sha256": digest(f"internal-source:{role}")}
                for role in (
                    "runtime_adapter_activation", "compose_file", "compose_release_file",
                    "deployment_environment", "runtime_policy",
                )
            } | {
                role: {"sha256": sha256}
                for role, sha256 in privilege_source_sha256.items()
            },
            "predecessor": {
                "release_manifest_sha256": digest("internal-predecessor-manifest"),
                "runtime_configuration_sha256":
                    plan["predecessor"]["runtime_configuration_sha256"],
                "web_image": plan["predecessor"]["web_image"],
                "web_image_config_digest":
                    plan["predecessor"]["web_image_config_digest"],
                "worker_image": plan["predecessor"]["worker_image"],
                "worker_image_config_digest":
                    plan["predecessor"]["worker_image_config_digest"],
            },
        }
        rollback = {
            "predecessor_runtime_configuration_sha256":
                package["predecessor"]["runtime_configuration_sha256"],
            "rollback_runtime_configuration_sha256": digest("internal-rollback-config"),
            "rollback_runtime_projection_sha256": digest("internal-rollback-projection"),
            "compose_rollback_overlay_sha256": digest("internal-rollback-overlay"),
            "stages": [
                {"stage_result_sha256": digest(f"internal-stage:{index}")}
                for index in range(9)
            ],
        }

        class Inputs:
            context = {
                "supervisor_bundle_sha256": digest("internal-supervisor-bundle"),
                "original_authorization_sha256": digest("internal-original-authorization"),
            }
            transaction_intent = {"parameters": {
                "previous_checkpoint_receipt_sha256": digest("internal-checkpoint"),
                "snapshot_intent_sha256": digest("internal-snapshot-intent"),
                "finalization_intent_sha256": digest("internal-finalization-intent"),
            }}

            def __init__(self):
                self.package = package
                self.rollback_result = rollback

            @staticmethod
            def json(role):
                return privilege_documents[role]

            @property
            def plan(self):
                return plan

        return Inputs()

    def test_repository_derived_stages_and_incomplete_metadata_checks_fail_closed(self):
        runtime = EXECUTOR.UatRollbackCapabilityRuntime()
        inputs = self.inputs()
        for label in ("PRECONDITION_RECHECK", "RUNTIME_CONFIGURATION_RESTORE"):
            with self.subTest(label=label):
                runtime.prepare(label, inputs, [])
                outcome = runtime.probe(label, inputs, [], None)
                self.assertEqual(
                    EXECUTOR.validate_handler_evidence(
                        "ROLLBACK_EXECUTION", label, outcome["evidence"],
                    ),
                    outcome["evidence"],
                )
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_UAT_CAPABILITY_UNAVAILABLE",
        ):
            runtime.prepare("PROTECTED_RESOURCE_RECHECK", inputs, [])
        for label in METADATA_LABELS:
            with self.subTest(label=label), self.assertRaisesRegex(
                EXECUTOR.FixedExecutorError,
                "ROLLBACK_FIXED_EXECUTOR_CAPABILITY_INPUT_INVALID",
            ):
                runtime.prepare(label, inputs, [])

    def test_external_capability_and_incomplete_internal_input_fail_before_effects(self):
        runtime = EXECUTOR.UatRollbackCapabilityRuntime()
        inputs = self.inputs()
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError, "ROLLBACK_FIXED_EXECUTOR_UAT_CAPABILITY_UNAVAILABLE",
        ):
            runtime.prepare("POSTGRESQL_RESTORE", inputs, [])
        del inputs.transaction_intent["parameters"]["snapshot_intent_sha256"]
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError, "ROLLBACK_FIXED_EXECUTOR_CAPABILITY_INPUT_INVALID",
        ):
            runtime.prepare("PRECONDITION_RECHECK", inputs, [])

    def test_checked_in_privilege_documents_close_the_reconciliation_boundary(self):
        paths = {
            "snapshot_runtime_privilege_access":
                SITE_ROOT / "operations/postgresql-runtime-privilege-access-v2.json",
            "snapshot_runtime_privilege_compiled_catalog":
                SITE_ROOT / "operations/postgresql-runtime-privilege-compiled-catalog-v1.json",
            "snapshot_runtime_privilege_policy":
                SITE_ROOT / "operations/postgresql-runtime-privilege-policy-v2.json",
            "snapshot_runtime_privilege_operator_policy":
                SITE_ROOT / "operations/postgresql-runtime-privilege-operator-policy-v1.json",
        }
        documents = {
            role: json.loads(path.read_text(encoding="utf-8"))
            for role, path in paths.items()
        }
        source_hashes = {
            role: hashlib.sha256(path.read_bytes()).hexdigest()
            for role, path in paths.items()
        }
        role_bindings = {
            "snapshot_runtime_privilege_access": "runtime_privilege_access_sha256",
            "snapshot_runtime_privilege_compiled_catalog":
                "runtime_privilege_compiled_catalog_sha256",
            "snapshot_runtime_privilege_policy": "runtime_privilege_policy_sha256",
            "snapshot_runtime_privilege_operator_policy":
                "runtime_privilege_operator_policy_sha256",
        }
        plan = docker_runner_plan()
        plan["source_bindings"].update({
            binding: source_hashes[role] for role, binding in role_bindings.items()
        })

        class Inputs:
            package = {"sources": {
                role: {"sha256": sha256} for role, sha256 in source_hashes.items()
            }}

            @staticmethod
            def json(role):
                return documents[role]

            @property
            def plan(self):
                return plan

        observed = EXECUTOR.validate_reconciliation_policy_boundary(Inputs())
        self.assertEqual(observed["access_sha256"], documents[
            "snapshot_runtime_privilege_access"
        ]["access_sha256"])
        self.assertEqual(observed["operator_policy_sha256"], documents[
            "snapshot_runtime_privilege_operator_policy"
        ]["policy_sha256"])

    def test_rehashed_deployment_authorization_flags_are_still_rejected(self):
        inputs = self.inputs()
        policy = inputs.json("snapshot_runtime_privilege_policy")
        policy["deployment_authorized"] = True
        policy["policy_sha256"] = EXECUTOR.digest_value(
            EXECUTOR.without(policy, "policy_sha256"),
        )
        operator = inputs.json("snapshot_runtime_privilege_operator_policy")
        operator["runtime_privilege_policy_sha256"] = policy["policy_sha256"]
        operator["policy_sha256"] = EXECUTOR.digest_value(
            EXECUTOR.without(operator, "policy_sha256"),
        )
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_RECONCILIATION_POLICY_INVALID",
        ):
            EXECUTOR.validate_reconciliation_policy_boundary(inputs)


class WriterContainmentSpecTest(unittest.TestCase):
    @staticmethod
    def inputs():
        plan = docker_runner_plan()
        plan.update({
            "promotion_id": "promotion-handler-matrix-001", "promotion_generation": 1,
        })
        database = {
            "name": "chenyida_erp", "system_identifier": "7612345678901234567",
            "oid": "16384", "marker": "chenyida-erp-deployment/v2:UAT:chenyida-erp",
        }
        plan["deployment"].update({"class": "UAT", "id": "chenyida-erp", "database": database})
        for name in ("caddy", "postgres", "web", "worker"):
            planned = plan["candidate"]["services"][name]
            planned.update({
                "service": name,
                "image_digest": f"sha256:{digest(f'writer-image-config:{name}')}",
            })
        protected = digest("writer-protected-resources")
        handoff_body = {
            "schema_version": 1,
            "contract": "chenyida-erp-uat-promotion-database-runtime-handoff/v1",
            "status": "RUNTIME_BASELINE_RESTORED_UNDER_DEPLOYMENT_CONTROL",
            "promotion_id": "promotion-handler-matrix-001",
            "deployment_operation_id": "candidate-deployment-001",
            "database_name": database["name"],
            "database_system_identifier": database["system_identifier"],
            "database_oid": database["oid"], "database_marker": database["marker"],
            "active_fence_sha256": digest("writer-active-fence"),
            "released_baseline_sha256": digest("writer-released-baseline"),
            "sealed_probe_sha256": digest("writer-sealed-probe"),
            "runtime_probe_sha256": digest("writer-runtime-probe"),
            "database_allow_connections": True, "database_connection_limit": 64,
            "default_transaction_read_only": "RESET",
            "connect_roles": [
                "chenyida_erp_admin", "chenyida_erp_backup", "chenyida_erp_owner",
                "chenyida_erp_web", "chenyida_erp_worker",
            ],
            "unknown_connect_login_count": 0, "prepared_transaction_count": 0,
            "handed_off_at": "2026-08-16T01:59:00.000Z",
        }
        handoff = {**handoff_body, "handoff_sha256": EXECUTOR.digest_value(handoff_body)}

        def service(name, *, unchanged):
            planned = plan["candidate"]["services"][name]
            body = {
                "service": name, "container_id": planned["container_id"],
                "container_name": f"chenyida-erp-{name}-1",
                "image_id": planned["image_digest"],
                "image_reference": planned["image_reference"],
                "compose_config_sha256": digest(f"writer-compose:{name}"),
                "running": True, "health": "none" if name == "caddy" else "healthy",
                "restart_count": 0, "oom_killed": False,
            }
            if unchanged:
                body.update({
                    "pre_identity_sha256": digest(f"writer-identity:{name}"),
                    "post_identity_sha256": digest(f"writer-identity:{name}"),
                })
            return body

        deployment_body = {
            "schema_version": 1,
            "contract": "chenyida-erp-uat-promotion-compose-deployment-result/v1",
            "status": "COMPOSE_DEPLOYMENT_COMMITTED",
            "promotion_id": "promotion-handler-matrix-001",
            "deployment_operation_id": "candidate-deployment-001",
            "execution_authorization_sha256": digest("writer-deploy-authorization"),
            "supervisor_bundle_sha256": digest("writer-supervisor"),
            "release_manifest_sha256": digest("writer-release-manifest"),
            "migration_operation_id": "candidate-migration-001",
            "migration_execution_authorization_sha256": digest("writer-migration-auth"),
            "migration_grant_sha256": digest("writer-migration-grant"),
            "migration_result_sha256": digest("writer-migration-result"),
            "active_fence_sha256": handoff["active_fence_sha256"],
            "migration_fence_binding_sha256": digest("writer-migration-fence-binding"),
            "migration_result_binding_sha256": digest("writer-migration-result-binding"),
            "deployment_plan_sha256": digest("writer-deployment-plan"),
            "compose_project": "chenyida-erp",
            "compose_project_root": "/opt/erp/chenyida_erp_site",
            "old_runtime_sha256": digest("writer-old-runtime"),
            "created_runtime_sha256": digest("writer-created-runtime"),
            "committed_runtime_sha256": digest("writer-committed-runtime"),
            "protected_resources_before_sha256": protected,
            "protected_resources_after_sha256": protected,
            "runtime_configuration_sha256": digest("writer-runtime-configuration"),
            "readiness_sha256": digest("writer-readiness"), "database_handoff": handoff,
            "services": [service("web", unchanged=False), service("worker", unchanged=False)],
            "unchanged_services": [
                service("caddy", unchanged=True), service("postgres", unchanged=True),
            ],
            "started_at": "2026-08-16T01:50:00.000Z",
            "completed_at": "2026-08-16T01:59:30.000Z",
        }
        deployment = {
            **deployment_body, "result_sha256": EXECUTOR.digest_value(deployment_body),
        }
        identity = {
            "schema_version": 3, "contract": "chenyida-erp-runtime-release-identity/v3",
            "deployment_class": "UAT", "deployment_id": "chenyida-erp",
            "release_id": "candidate-release-001",
            "release_manifest_sha256": deployment["release_manifest_sha256"],
            "postdeploy_receipt_sha256": digest("writer-postdeploy-receipt"),
            "supervisor_bundle_sha256": digest("writer-supervisor"),
            "authorization_sha256": digest("writer-identity-authorization"),
            "runtime_guard": {}, "runtime_policy_sha256": digest("writer-runtime-policy"),
            "application_version": "0.1.0-alpha.47", "git_commit": "a" * 40,
            "git_tree": "b" * 40, "migration_head": "0046_runtime_lock_privilege_boundary.sql",
            "migration_manifest_sha256": digest("writer-migration-manifest"),
            "generated_at": "2026-08-16T01:59:45.000Z",
        }
        for name in ("caddy", "postgres", "web", "worker"):
            identity[f"{name}_container_id"] = plan["candidate"]["services"][name]["container_id"]
            identity[f"{name}_image_digest"] = plan["candidate"]["services"][name]["image_digest"]
        package = {
            "promotion_id": "promotion-handler-matrix-001", "source_set_sha256": digest("writer-source-set"),
            "protected_resources_sha256": protected, "database": database,
            "sources": {
                "candidate_deployment_result": {"sha256": EXECUTOR.digest_value(deployment)},
                "candidate_postdeploy_identity": {"sha256": EXECUTOR.digest_value(identity)},
            },
        }

        class Inputs:
            def __init__(self):
                self.package = package
                self._plan = plan
                self._documents = {
                    "candidate_deployment_result": deployment,
                    "candidate_postdeploy_identity": identity,
                }
                self.request = {
                    "operation_id": plan["rollback_operation_id"],
                    "label": "WRITER_CONTAINMENT",
                    "runtime_plan_sha256": plan["runtime_plan_sha256"],
                    "source_set_sha256": package["source_set_sha256"],
                }

            def json(self, role):
                return self._documents[role]

            @property
            def plan(self):
                return self._plan

        return Inputs()

    def test_candidate_documents_derive_an_exact_writer_spec(self):
        spec = EXECUTOR.derive_writer_containment_spec(self.inputs())
        self.assertEqual(EXECUTOR.validate_writer_containment_spec(spec), spec)
        self.assertEqual(spec["database"]["oid"], "16384")
        self.assertEqual(set(spec["services"]), {"web", "worker"})
        self.assertNotEqual(spec["spec_sha256"], EXECUTOR.ZERO_SHA256)

    def test_rehashed_candidate_identity_drift_is_rejected(self):
        inputs = self.inputs()
        deployment = inputs.json("candidate_deployment_result")
        deployment["services"][0]["container_id"] = "f" * 64
        deployment["result_sha256"] = EXECUTOR.digest_value(
            EXECUTOR.without(deployment, "result_sha256"),
        )
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError, "ROLLBACK_FIXED_EXECUTOR_WRITER_SPEC_INVALID",
        ):
            EXECUTOR.derive_writer_containment_spec(inputs)

    def test_fixed_seal_opcode_binds_identity_and_has_no_caller_sql(self):
        spec = EXECUTOR.derive_writer_containment_spec(self.inputs())
        bindings = {
            "before_observation_sha256": digest("writer-before-observation"),
            "expected_fence_sha256": digest("writer-expected-fence"),
        }
        opcode = EXECUTOR.derive_writer_opcode_spec(
            spec, "PG_RB_SEAL_ACTIVE_V1", bindings,
        )
        self.assertEqual(EXECUTOR.validate_writer_opcode_spec(opcode, spec=spec), opcode)
        sql = EXECUTOR.render_writer_sql(spec, opcode["opcode"], bindings).decode()
        self.assertTrue(sql.startswith("BEGIN;\n"))
        self.assertIn("ALLOW_CONNECTIONS false", sql)
        self.assertIn("CONNECTION LIMIT 0", sql)
        self.assertIn("pg_terminate_backend", sql)
        self.assertIn(spec["excluded_databases"][0], sql)
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError, "ROLLBACK_FIXED_EXECUTOR_WRITER_OPCODE_INVALID",
        ):
            EXECUTOR.derive_writer_opcode_spec(
                spec, "PG_RB_SEAL_ACTIVE_V1", {**bindings, "sql": "SELECT 1"},
            )


class ClosedWriterContainmentDriverTest(unittest.TestCase):
    class Runner:
        def __init__(self, spec):
            self.spec = spec
            self.database_state = "INITIAL"
            self.service_state = "running"
            self.calls = []

        def database_output(self):
            sealed = self.database_state == "SEALED"
            return (json.dumps({
                "system_identifier": self.spec["database"]["system_identifier"],
                "database": {
                    "name": self.spec["database"]["name"],
                    "oid": self.spec["database"]["oid"],
                    "marker": self.spec["database"]["marker"],
                    "allow_connections": not sealed,
                    "connection_limit": 0 if sealed else 64,
                    "default_transaction_read_only": sealed,
                    "sessions": 0 if sealed else 2, "prepared_xacts": 0,
                },
                "excluded_database_count": 0,
            }, separators=(",", ":")) + "\n").encode()

        def writer_sql_opcode(self, _spec, opcode):
            self.calls.append(opcode["opcode"])
            if opcode["opcode"] == "PG_RB_SEAL_ACTIVE_V1":
                self.database_state = "SEALED"
                return b""
            return self.database_output()

        def inspect_containers(self, ids):
            self.calls.append(("inspect", self.service_state))
            by_id = {
                item["container_id"]: (name, item)
                for name, item in self.spec["services"].items()
            }
            lines = []
            for container_id in ids:
                name, item = by_id[container_id]
                lines.append(json.dumps([
                    container_id, f"/chenyida-erp-{name}-1", item["image_digest"],
                    item["image_reference"], {
                        "com.docker.compose.project": "chenyida-erp",
                        "com.docker.compose.service": name,
                    }, self.service_state, {"Status": "healthy"}, 0, False,
                    [], {"chenyida-erp_backend": {}}, "1000:1000", True,
                    ["ALL"], None, ["no-new-privileges:true"], "chenyida-erp_backend",
                ], separators=(",", ":")))
            return ("\n".join(lines) + "\n").encode()

        def stop_writers(self, ids):
            self.calls.append(("stop", tuple(ids)))
            self.service_state = "exited"
            return ("\n".join(ids) + "\n").encode()

    def test_driver_fences_database_before_stopping_exact_writers(self):
        spec = EXECUTOR.derive_writer_containment_spec(WriterContainmentSpecTest.inputs())
        runner = self.Runner(spec)
        driver = EXECUTOR.ClosedWriterContainmentDriver(
            runner, clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        before = driver.preflight(spec)
        fenced = driver.seal_database(spec, before["database"])
        stopped = driver.stop_candidate_writers(spec, before["services"])
        self.assertEqual(fenced["observation"]["state"], "SEALED")
        self.assertEqual(stopped["observation"]["status"], "exited")
        seal_index = runner.calls.index("PG_RB_SEAL_ACTIVE_V1")
        stop_index = next(index for index, item in enumerate(runner.calls)
                          if isinstance(item, tuple) and item[0] == "stop")
        self.assertLess(seal_index, stop_index)

    def test_container_image_drift_fails_before_stop(self):
        spec = EXECUTOR.derive_writer_containment_spec(WriterContainmentSpecTest.inputs())
        runner = self.Runner(spec)
        original = runner.inspect_containers

        def drift(ids):
            return original(ids).replace(spec["services"]["web"]["image_digest"].encode(), b"sha256:" + b"f" * 64)

        runner.inspect_containers = drift
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_WRITER_CONTAINER_OBSERVATION_INVALID",
        ):
            EXECUTOR.ClosedWriterContainmentDriver(runner).preflight(spec)


class WriterContainmentRuntimeTest(unittest.TestCase):
    def test_runtime_orders_two_effects_and_recovers_complete_receipts(self):
        inputs = WriterContainmentSpecTest.inputs()
        spec = EXECUTOR.derive_writer_containment_spec(inputs)
        driver = EXECUTOR.ClosedWriterContainmentDriver(
            ClosedWriterContainmentDriverTest.Runner(spec),
            clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            writer_driver=driver, clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        effects = VolumeCapabilityRuntimeTest.Effects()
        evidence = runtime._execute_writer(inputs, effects)
        self.assertEqual(effects.started, ["DATABASE_FENCE", "WRITER_STOP"])
        self.assertEqual(effects.completed, effects.started)
        self.assertTrue(evidence["sealed"] and evidence["stopped"])
        self.assertEqual(runtime._recover_writer(inputs, effects), evidence)

    def test_runtime_rejects_a_receipt_prefix(self):
        inputs = WriterContainmentSpecTest.inputs()
        spec = EXECUTOR.derive_writer_containment_spec(inputs)
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            writer_driver=EXECUTOR.ClosedWriterContainmentDriver(
                ClosedWriterContainmentDriverTest.Runner(spec),
            ),
        )
        effects = VolumeCapabilityRuntimeTest.Effects()
        effects.receipts["DATABASE_FENCE"] = {"fixture": "prefix"}
        with self.assertRaises(EXECUTOR.HandlerOutcomeUnknown) as caught:
            runtime._recover_writer(inputs, effects)
        self.assertEqual(caught.exception.reason_code, "PROBE_INCONCLUSIVE")


class PostgresRollbackBaseSpecTest(unittest.TestCase):
    @staticmethod
    def inputs():
        document_paths = {
            "snapshot_runtime_privilege_access":
                SITE_ROOT / "operations/postgresql-runtime-privilege-access-v2.json",
            "snapshot_runtime_privilege_compiled_catalog":
                SITE_ROOT / "operations/postgresql-runtime-privilege-compiled-catalog-v1.json",
            "snapshot_runtime_privilege_policy":
                SITE_ROOT / "operations/postgresql-runtime-privilege-policy-v2.json",
            "snapshot_runtime_privilege_operator_policy":
                SITE_ROOT / "operations/postgresql-runtime-privilege-operator-policy-v1.json",
        }
        documents = {
            role: json.loads(path.read_text(encoding="utf-8"))
            for role, path in document_paths.items()
        }
        source_hashes = {
            role: hashlib.sha256(path.read_bytes()).hexdigest()
            for role, path in document_paths.items()
        }
        operation_id = "rollback-runner-deadbeef"
        database = {
            "name": "chenyida_erp", "system_identifier": "7612345678901234567",
            "oid": "16384", "marker": "chenyida-erp-deployment/v2:UAT:chenyida-erp",
        }
        snapshot_manifest = {
            "schema_version": 2, "contract": "chenyida-erp-backup/v2",
            "status": "COMPLETE", "backup_id": "backup-deadbeef",
            "created_at": "2026-08-16T01:00:00.000Z",
            "deployment": {
                "class": "UAT", "id": "chenyida-erp", "database": database["name"],
                "database_system_identifier": database["system_identifier"],
                "database_oid": database["oid"], "database_marker": database["marker"],
                "database_bytes": 16 * 1024 * 1024, "database_server_major": "17",
                "database_encoding": "UTF8", "database_collate": "C",
                "database_ctype": "C", "database_locale_provider": "libc",
                "database_collation_version": "NONE",
            },
            "application": {
                "version": "0.1.0-alpha.47", "git_commit": "a" * 40,
                "web_image_digest": f"sha256:{digest('snapshot-web-image')}",
                "worker_image_digest": f"sha256:{digest('snapshot-worker-image')}",
            },
            "migration": {
                "head": "0046_runtime_lock_privilege_boundary.sql",
                "manifest_file": "migrations.txt",
                "manifest_sha256": digest("snapshot-migration-manifest"),
            },
            "policy": {}, "consistency": {},
            "reconciliation": {
                "contract": "chenyida-erp-backup-reconciliation/v1",
                "file": "reconciliation.json", "sha256": digest("snapshot-reconciliation"),
            },
            "artifacts": {
                "postgresql_dump": {
                    "file": "postgresql.dump", "sha256": digest("snapshot-dump"),
                    "bytes": 4096,
                },
                "uploads": {}, "attachments": {}, "backup_status": {},
            },
        }
        migration_raw = "".join(
            f"{digest(f'migration-{index:04d}')}  "
            f"{index:04d}_{'runtime_lock_privilege_boundary' if index == 46 else 'fixture'}.sql\n"
            for index in range(1, 47)
        ).encode()
        migration_ledger_file_sha256 = hashlib.sha256(migration_raw).hexdigest()
        migration_records = [
            {"checksum": line.split("  ", 1)[0], "version": line.split("  ", 1)[1]}
            for line in migration_raw.decode().splitlines()
        ]
        migration_manifest_sha256 = EXECUTOR.migration_allowlist_digest(
            migration_records,
        )
        report_raw = (
            "RELATION\t7075626c69632e6170705f7573657273\t0\t"
            f"{digest('empty-app-users')}\n"
            "LARGE_OBJECTS\t0\t0\t"
            f"{digest('0:0:0:0:0:0')}\n"
        ).encode()
        reconciliation_document = {
            "schema_version": 1,
            "contract": "chenyida-erp-backup-reconciliation/v1",
            "database": {
                "format": "PSQL_UNALIGNED_CANONICAL_V1",
                "report_sha256": hashlib.sha256(report_raw).hexdigest(),
                "report": report_raw.decode(),
            },
            "files": {"uploads": {}, "attachments": {}, "backup_status": {}},
        }
        reconciliation_sha256 = EXECUTOR.digest_value(reconciliation_document)
        predecessor_release_manifest_sha256 = digest("postgres-predecessor-release-manifest")
        predecessor_release_manifest = {
            "release_id": "predecessor-release-fixture",
            "source": {
                "package_version": "0.1.0-alpha.47",
                "git_commit": "a" * 40,
                "git_tree": "b" * 40,
            },
            "migrations": {
                "head": "0046_runtime_lock_privilege_boundary.sql",
                "allowlist_sha256": migration_manifest_sha256,
            },
        }
        snapshot_manifest["migration"]["manifest_sha256"] = \
            migration_ledger_file_sha256
        snapshot_manifest["reconciliation"]["sha256"] = reconciliation_sha256
        snapshot_manifest_sha256 = EXECUTOR.digest_value(snapshot_manifest)
        runtime_plan_sha256 = digest("postgres-base-runtime-plan")
        package = {
            "promotion_id": "promotion-handler-matrix-001", "promotion_generation": 1,
            "rollback_operation_id": operation_id, "runtime_plan_sha256": runtime_plan_sha256,
            "source_set_sha256": digest("postgres-base-source-set"),
            "package_sha256": digest("postgres-base-package"), "database": database,
            "snapshot_objects": {"postgresql": {
                "file": "postgresql.dump", "sha256": digest("snapshot-dump"),
                "bytes": 4096, "entries": None,
            }},
            "predecessor": {
                "application_version": "0.1.0-alpha.47", "git_commit": "a" * 40,
                "migration_head": "0046_runtime_lock_privilege_boundary.sql",
                "migration_manifest_sha256": migration_manifest_sha256,
                "release_manifest_sha256": predecessor_release_manifest_sha256,
            },
            "content_reconciliation": {
                "source_reconciliation_sha256": reconciliation_sha256,
                "database": {"report_sha256": hashlib.sha256(report_raw).hexdigest()},
            },
            "sources": {
                **{role: {"sha256": sha256} for role, sha256 in source_hashes.items()},
                "snapshot_manifest": {"sha256": snapshot_manifest_sha256},
                "snapshot_postgresql": {"sha256": digest("snapshot-dump"), "bytes": 4096},
                "snapshot_migrations": {
                    "sha256": migration_ledger_file_sha256,
                    "bytes": len(migration_raw),
                },
                "snapshot_reconciliation": {
                    "sha256": reconciliation_sha256,
                    "bytes": len(EXECUTOR.canonical(reconciliation_document)),
                },
                "snapshot_policy_activation": {
                    "sha256": digest("snapshot-policy-activation"),
                },
                "predecessor_release_manifest": {
                    "sha256": predecessor_release_manifest_sha256,
                },
            },
        }
        plan = docker_runner_plan()
        engine_image = documents[
            "snapshot_runtime_privilege_compiled_catalog"
        ]["engine_binding"]["image_reference"]
        plan.update({
            "promotion_id": package["promotion_id"], "promotion_generation": 1,
            "rollback_operation_id": operation_id, "runtime_plan_sha256": runtime_plan_sha256,
        })
        plan["deployment"].update({"class": "UAT", "id": "chenyida-erp", "database": database})
        plan["candidate"]["services"]["postgres"].update({
            "image_reference":
                f"registry.example.invalid/library/postgres@{engine_image.rsplit('@', 1)[-1]}",
            "image_digest": f"sha256:{digest('postgres-config')}",
        })
        scope = {
            "active_database": plan["targets"]["database"]["active"],
            "staging_database": plan["targets"]["database"]["staging"],
            "candidate_quarantine_database":
                plan["targets"]["database"]["candidate_quarantine"],
            "database_local_only": True, "allow_staging_database_create": True,
            "allow_staging_logical_restore": True,
            "allow_staging_privilege_reconcile": True, "allow_atomic_database_switch": True,
            "allow_active_database_unseal": True, "allow_role_create": False,
            "allow_role_alter": False, "allow_membership_change": False,
            "allow_password_change": False, "allow_tablespace_acl_change": False,
        }
        authority_body = {
            "schema_version": 1,
            "contract": "chenyida-erp-uat-promotion-rollback-reconciliation-authority/v1",
            "authority_id": "authority-deadbeef", "status": "AUTHORIZED",
            "environment": "UAT", "promotion_id": package["promotion_id"],
            "promotion_generation": 1, "rollback_operation_id": operation_id,
            "deployment_id": "chenyida-erp",
            "approval_reference_sha256": digest("authority-approval"),
            "requester_identity_sha256": digest("authority-requester"),
            "approver_identity_sha256": digest("authority-approver"),
            "approved_at": "2026-08-16T01:00:00.000Z",
            "expires_at": "2026-08-16T03:00:00.000Z", "one_time": True,
            "mutation_scope": scope,
        }
        plan["reconciliation_authority"] = {
            **authority_body, "authority_sha256": EXECUTOR.digest_value(authority_body),
        }
        plan["source_bindings"].update({
            "snapshot_manifest_sha256": snapshot_manifest_sha256,
            "snapshot_reconciliation_sha256": reconciliation_sha256,
            "runtime_privilege_access_sha256":
                source_hashes["snapshot_runtime_privilege_access"],
            "runtime_privilege_compiled_catalog_sha256":
                source_hashes["snapshot_runtime_privilege_compiled_catalog"],
            "runtime_privilege_policy_sha256":
                source_hashes["snapshot_runtime_privilege_policy"],
            "runtime_privilege_operator_policy_sha256":
                source_hashes["snapshot_runtime_privilege_operator_policy"],
        })

        class Inputs:
            def __init__(self):
                self.package = package
                self._plan = plan
                self._documents = {
                    **documents, "snapshot_manifest": snapshot_manifest,
                    "snapshot_reconciliation": reconciliation_document,
                    "predecessor_release_manifest": predecessor_release_manifest,
                }
                self._raw = {"snapshot_migrations": migration_raw}

            def json(self, role):
                return self._documents[role]

            def raw(self, role, maximum=EXECUTOR.MAX_JSON_BYTES):
                value = self._raw[role]
                if len(value) > maximum:
                    raise EXECUTOR.FixedExecutorError(
                        "ROLLBACK_FIXED_EXECUTOR_SOURCE_FD_INVALID",
                    )
                return value

            def fd(self, role, maximum_bytes=64 * 1024 * 1024 * 1024):
                expected_bytes = {
                    "snapshot_postgresql": 4096,
                    "snapshot_reconciliation":
                        len(EXECUTOR.canonical(reconciliation_document)),
                }.get(role)
                if expected_bytes is None or maximum_bytes < expected_bytes:
                    raise EXECUTOR.FixedExecutorError(
                        "ROLLBACK_FIXED_EXECUTOR_SOURCE_FD_INVALID",
                    )
                return 99

            @property
            def plan(self):
                return self._plan

        return Inputs()

    def test_six_bound_sources_derive_a_hashed_exact_base_spec(self):
        spec = EXECUTOR.derive_pg_rollback_base_spec(self.inputs())
        self.assertEqual(EXECUTOR.validate_pg_rollback_base_spec(spec), spec)
        self.assertEqual(spec["snapshot"]["database_bytes"], 16 * 1024 * 1024)
        self.assertIsNone(spec["profile"]["collation_version"])
        self.assertEqual(spec["databases"]["candidate_oid"], "16384")
        self.assertEqual(spec["runtime_limits"]["execute_seconds"], 1800)
        self.assertNotEqual(
            spec["snapshot"]["migration_ledger_file_sha256"],
            spec["snapshot"]["migration_allowlist_sha256"],
        )
        self.assertNotEqual(spec["base_spec_sha256"], EXECUTOR.ZERO_SHA256)

    def test_source_drift_and_mutated_or_extra_spec_fail_closed(self):
        inputs = self.inputs()
        inputs.package["sources"]["snapshot_postgresql"]["sha256"] = digest("drift")
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_POSTGRES_BASE_SPEC_INVALID",
        ):
            EXECUTOR.derive_pg_rollback_base_spec(inputs)

        spec = EXECUTOR.derive_pg_rollback_base_spec(self.inputs())
        mutated = copy.deepcopy(spec)
        mutated["snapshot"]["database_bytes"] += 1
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_POSTGRES_BASE_SPEC_INVALID",
        ):
            EXECUTOR.validate_pg_rollback_base_spec(mutated)
        extra = {**spec, "sql": "SELECT 1"}
        extra["base_spec_sha256"] = EXECUTOR.digest_value(
            EXECUTOR.without(extra, "base_spec_sha256"),
        )
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_POSTGRES_BASE_SPEC_INVALID",
        ):
            EXECUTOR.validate_pg_rollback_base_spec(extra)

    def test_closed_sql_opcodes_bind_fixed_database_timeout_and_atomic_switch(self):
        base = EXECUTOR.derive_pg_rollback_base_spec(self.inputs())
        bindings = {
            "PG_RB_CREATE_STAGING_V1": {
                "capacity_receipt_sha256": digest("pg-capacity"),
                "before_observation_sha256": digest("pg-create-before"),
                "expected_staging_identity_sha256": digest("pg-staging-identity"),
            },
            "PG_RB_OBSERVE_STATE_V1": {
                "journal_state_sha256": digest("pg-journal"),
                "observation_scope_sha256": digest("pg-observation-scope"),
            },
            "PG_RB_OBSERVE_STAGING_RESTORE_PRECONDITION_V1": {
                "create_receipt_sha256": digest("pg-create-receipt"),
                "staging_oid": "16385",
                "dump_inventory_sha256": digest("pg-dump-inventory"),
                "expected_empty_projection_sha256":
                    EXECUTOR.digest_value(EXECUTOR.postgres_empty_restore_projection()),
            },
            "PG_RB_ATOMIC_SWITCH_V1": {
                "privilege_receipt_sha256": digest("pg-privilege-receipt"),
                "staging_oid": "16385",
                "before_observation_sha256": digest("pg-switch-before"),
                "staging_content_proof_sha256": digest("pg-staging-proof"),
                "expected_switched_identity_sha256": digest("pg-switched-identity"),
            },
            "PG_RB_UNSEAL_ACTIVE_V1": {
                "switch_receipt_sha256": digest("pg-switch-receipt"),
                "active_oid": "16385",
                "activation_prerequisites_sha256": digest("pg-activation-prerequisites"),
                "sealed_security_projection_sha256": digest("pg-sealed-security"),
                "before_observation_sha256": digest("pg-unseal-before"),
                "expected_released_identity_sha256": digest("pg-released-identity"),
            },
        }
        specs = {
            opcode: EXECUTOR.derive_pg_opcode_spec(base, opcode, binding)
            for opcode, binding in bindings.items()
        }
        for opcode, spec in specs.items():
            with self.subTest(opcode=opcode):
                self.assertEqual(
                    EXECUTOR.validate_pg_opcode_spec(spec, base=base), spec,
                )
                self.assertEqual(
                    spec["database"],
                    base["databases"]["staging_name"]
                    if opcode == "PG_RB_OBSERVE_STAGING_RESTORE_PRECONDITION_V1"
                    else "postgres",
                )
                self.assertEqual(spec["timeout_seconds"], 300)
                self.assertEqual(
                    spec["effectful"], opcode not in EXECUTOR.POSTGRES_READ_ONLY_SQL_OPCODES,
                )
        create_sql = EXECUTOR.render_pg_sql(
            base, "PG_RB_CREATE_STAGING_V1", bindings["PG_RB_CREATE_STAGING_V1"],
        ).decode()
        self.assertIn("SET default_transaction_read_only TO 'on'", create_sql)
        switch_sql = EXECUTOR.render_pg_sql(
            base, "PG_RB_ATOMIC_SWITCH_V1", bindings["PG_RB_ATOMIC_SWITCH_V1"],
        ).decode()
        self.assertTrue(switch_sql.startswith("BEGIN;\n"))
        self.assertTrue(switch_sql.endswith("COMMIT;\n"))
        self.assertEqual(switch_sql.count(" RENAME TO "), 2)
        self.assertIn('ALTER DATABASE "chenyida_erp" RENAME TO', switch_sql)
        self.assertIn(
            'ALTER DATABASE "chenyida_erp_rb_deadbeefdeadbeef" RENAME TO "chenyida_erp";',
            switch_sql,
        )
        unseal_sql = EXECUTOR.render_pg_sql(
            base, "PG_RB_UNSEAL_ACTIVE_V1", bindings["PG_RB_UNSEAL_ACTIVE_V1"],
        ).decode()
        self.assertIn("ALLOW_CONNECTIONS true", unseal_sql)
        self.assertIn("CONNECTION LIMIT 64", unseal_sql)
        self.assertIn("RESET default_transaction_read_only", unseal_sql)
        self.assertNotIn("GRANT ", unseal_sql)
        self.assertNotIn("REVOKE ", unseal_sql)

    def test_opcode_rejects_caller_sql_argv_timeout_and_zero_bindings(self):
        base = EXECUTOR.derive_pg_rollback_base_spec(self.inputs())
        valid = {
            "journal_state_sha256": digest("pg-journal"),
            "observation_scope_sha256": digest("pg-observation-scope"),
        }
        for mutation in (
            {**valid, "sql": "SELECT 1"},
            {**valid, "argv": ["psql"]},
            {**valid, "timeout_seconds": 1},
            {**valid, "journal_state_sha256": EXECUTOR.ZERO_SHA256},
        ):
            with self.subTest(fields=sorted(mutation)), self.assertRaisesRegex(
                EXECUTOR.FixedExecutorError,
                "ROLLBACK_FIXED_EXECUTOR_POSTGRES_OPCODE_SPEC_INVALID",
            ):
                EXECUTOR.derive_pg_opcode_spec(
                    base, "PG_RB_OBSERVE_STATE_V1", mutation,
                )

    def test_guarded_switch_v3_reproves_then_atomically_fences_and_renames(self):
        inputs = self.inputs()
        base = EXECUTOR.derive_pg_rollback_base_spec(inputs)
        material = EXECUTOR._postgres_guarded_switch_material(
            base, inputs, restored_oid="16385",
        )
        source_bindings = {
            "source_reconciliation_sha256":
                base["snapshot"]["source_reconciliation_sha256"],
            "expected_content_report_sha256": material["report"]["sha256"],
            "migration_ledger_file_sha256":
                material["migration"]["ledger_file_sha256"],
            "migration_allowlist_sha256":
                material["migration"]["allowlist_sha256"],
            "expected_security_state_sha256": material["security_state_sha256"],
        }
        bindings = {
            "privilege_receipt_sha256": digest("guard-v3-privilege"),
            "staging_oid": "16385",
            "before_observation_sha256": digest("guard-v3-before"),
            "staging_content_proof_sha256": digest("guard-v3-proof"),
            "expected_switched_identity_sha256": EXECUTOR.digest_value({
                "active_name": base["databases"]["active_name"],
                "active_oid": "16385",
                "quarantine_name": base["databases"]["quarantine_name"],
                "quarantine_oid": base["databases"]["candidate_oid"],
                "state": "NEW_SEALED",
            }),
            **source_bindings,
            "guarded_state_sha256": EXECUTOR.digest_value({
                **source_bindings,
                "staging_content_proof_sha256": digest("guard-v3-proof"),
                "staging_oid": "16385",
            }),
        }
        spec = EXECUTOR.derive_pg_guarded_switch_opcode_spec(base, inputs, bindings)
        self.assertEqual(spec["opcode"], "PG_RB_GUARDED_SWITCH_V3")
        self.assertEqual(
            spec["contract"],
            "chenyida-erp-uat-rollback-postgresql-guarded-switch-opcode-spec/v2",
        )
        sql = EXECUTOR.render_pg_guarded_switch_sql(base, inputs, bindings).decode()
        self.assertNotIn("pg_catalog.digest", sql)
        self.assertIn("pg_catalog.sha256", sql)
        self.assertNotIn("pg_catalog.coalesce(", sql)
        self.assertIn("0:0:0:0:0:0", sql)
        reset = sql.index("SET default_transaction_read_only=off;")
        security = sql.index("\\set ON_ERROR_STOP on")
        switch_connection = sql.index("\\connect postgres")
        management_begin = sql.index("BEGIN;", switch_connection)
        management_lock_timeout = sql.index(
            "SET LOCAL lock_timeout='5s';", management_begin,
        )
        management_statement_timeout = sql.index(
            "SET LOCAL statement_timeout='60s';", management_begin,
        )
        management_idle_timeout = sql.index(
            "SET LOCAL idle_in_transaction_session_timeout='15s';", management_begin,
        )
        management_lock = sql.index("pg_advisory_xact_lock", management_begin)
        fence = sql.index("ALLOW_CONNECTIONS false")
        first_rename = sql.index('ALTER DATABASE "chenyida_erp" RENAME TO')
        second_rename = sql.index(
            'ALTER DATABASE "chenyida_erp_rb_deadbeefdeadbeef" RENAME TO "chenyida_erp";',
        )
        self.assertLess(reset, security)
        self.assertLess(security, switch_connection)
        self.assertLess(management_begin, management_lock_timeout)
        self.assertLess(management_lock_timeout, management_statement_timeout)
        self.assertLess(management_statement_timeout, management_idle_timeout)
        self.assertLess(management_idle_timeout, management_lock)
        self.assertLess(switch_connection, fence)
        self.assertLess(fence, first_rename)
        self.assertLess(first_rename, second_rename)
        self.assertNotIn("ALLOW_CONNECTIONS false", sql[:switch_connection])
        self.assertNotIn("SWITCH_READY", sql)
        self.assertEqual(sql.count("ALLOW_CONNECTIONS false"), 1)
        self.assertTrue(sql.endswith("COMMIT;\nSELECT true;\n"))
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_POSTGRES_GUARDED_SWITCH_INVALID",
        ):
            EXECUTOR.derive_pg_guarded_switch_opcode_spec(
                base, inputs, {
                    **bindings,
                    "expected_switched_identity_sha256": digest("guard-v3-after-drift"),
                },
            )

    def test_live_state_parser_classifies_old_new_and_partial_layouts(self):
        base = EXECUTOR.derive_pg_rollback_base_spec(self.inputs())
        names = base["databases"]

        def row(name, oid, marker, allow, limit, readonly, sessions=0):
            return {
                "name": name, "oid": oid, "marker": marker,
                "allow_connections": allow, "connection_limit": limit,
                "default_transaction_read_only": readonly,
                "sessions": sessions, "prepared_xacts": 0,
            }

        def observe(rows):
            raw = EXECUTOR.canonical({
                "system_identifier": base["postgres"]["system_identifier"],
                "server_version_num": base["postgres"]["server_version_num"],
                "databases": rows,
            })
            return EXECUTOR.parse_pg_state_observation(
                raw, base=base, observed_at="2026-08-16T02:00:00.000Z",
            )

        old = observe([
            row(names["active_name"], names["candidate_oid"], names["candidate_marker"],
                False, 0, True),
            row(names["staging_name"], "16385", names["staging_marker"], True, 0, True),
        ])
        self.assertEqual(
            EXECUTOR.classify_pg_rollback_layout(
                old, base=base, restored_oid="16385",
            )["layout"],
            "OLD",
        )
        old_later = EXECUTOR.parse_pg_state_observation(
            EXECUTOR.canonical({
                "system_identifier": base["postgres"]["system_identifier"],
                "server_version_num": base["postgres"]["server_version_num"],
                "databases": old["databases"],
            }),
            base=base, observed_at="2026-08-16T02:00:05.000Z",
        )
        old_classification = EXECUTOR.classify_pg_rollback_layout(
            old, base=base, restored_oid="16385",
        )
        old_later_classification = EXECUTOR.classify_pg_rollback_layout(
            old_later, base=base, restored_oid="16385",
        )
        self.assertNotEqual(
            old_classification["classification_sha256"],
            old_later_classification["classification_sha256"],
        )
        self.assertEqual(
            old_classification["state_projection_sha256"],
            old_later_classification["state_projection_sha256"],
        )
        sealed = observe([
            row(names["active_name"], "16385", names["candidate_marker"], False, 0, True),
            row(names["quarantine_name"], names["candidate_oid"],
                names["quarantine_marker"], False, 0, True),
        ])
        sealed_classification = EXECUTOR.classify_pg_rollback_layout(
            sealed, base=base, restored_oid="16385",
        )
        self.assertEqual(sealed_classification["layout"], "NEW_SEALED")
        self.assertTrue(sealed_classification["safe_to_recover_switch_receipt"])
        released = observe([
            row(names["active_name"], "16385", names["candidate_marker"],
                True, 64, False, sessions=2),
            row(names["quarantine_name"], names["candidate_oid"],
                names["quarantine_marker"], False, 0, True),
        ])
        released_classification = EXECUTOR.classify_pg_rollback_layout(
            released, base=base, restored_oid="16385",
        )
        self.assertEqual(released_classification["layout"], "NEW_RELEASED")
        self.assertTrue(released_classification["safe_to_recover_unseal_receipt"])
        partial = observe([
            row(names["quarantine_name"], names["candidate_oid"],
                names["quarantine_marker"], False, 0, True),
        ])
        self.assertEqual(
            EXECUTOR.classify_pg_rollback_layout(
                partial, base=base, restored_oid="16385",
            )["layout"],
            "INVALID",
        )

    def test_dump_list_and_restore_specs_bind_the_exact_fd_identity_and_argv(self):
        base = EXECUTOR.derive_pg_rollback_base_spec(self.inputs())
        listed = EXECUTOR.derive_pg_dump_opcode_spec(base, "PG_RB_LIST_DUMP_V1", {
            "dump_sha256": base["snapshot"]["dump_sha256"],
            "dump_bytes": base["snapshot"]["dump_bytes"],
        })
        self.assertEqual(listed["database"], None)
        self.assertEqual(listed["phase"], "list")
        self.assertFalse(listed["effectful"])
        restored = EXECUTOR.derive_pg_dump_opcode_spec(base, "PG_RB_RESTORE_DUMP_V1", {
            "create_receipt_sha256": digest("pg-create-receipt"),
            "staging_oid": "16385",
            "before_content_observation_sha256": digest("pg-before-content"),
            "dump_inventory_sha256": digest("pg-dump-inventory"),
            "restore_precondition_opcode_spec_sha256": digest("pg-precondition-opcode"),
            "restore_precondition_sha256": digest("pg-precondition"),
            "empty_projection_sha256":
                EXECUTOR.digest_value(EXECUTOR.postgres_empty_restore_projection()),
            "dump_sha256": base["snapshot"]["dump_sha256"],
            "dump_bytes": base["snapshot"]["dump_bytes"],
            "expected_content_sha256": digest("pg-expected-content"),
        })
        self.assertEqual(restored["database"], base["databases"]["staging_name"])
        self.assertEqual(restored["timeout_seconds"], 1800)
        self.assertTrue(restored["effectful"])
        self.assertNotEqual(listed["argv_template_sha256"], restored["argv_template_sha256"])
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_POSTGRES_DUMP_OPCODE_SPEC_INVALID",
        ):
            EXECUTOR.derive_pg_dump_opcode_spec(base, "PG_RB_LIST_DUMP_V1", {
                "dump_sha256": digest("substituted-dump"),
                "dump_bytes": base["snapshot"]["dump_bytes"],
            })

    def test_staging_reconciliation_compiles_database_local_acl_without_role_mutation(self):
        inputs = self.inputs()
        base = EXECUTOR.derive_pg_rollback_base_spec(inputs)
        bindings = {
            "restore_receipt_sha256": digest("pg-restore-receipt"),
            "staging_oid": "16385",
            "baseline_security_sha256": digest("pg-baseline-security"),
            "authority_activation_sha256": digest("pg-authority-activation"),
            "desired_sealed_security_sha256": EXECUTOR.digest_value(base["security"]),
        }
        raw = EXECUTOR.render_pg_reconciliation_sql(base, inputs, bindings)
        text = raw.decode()
        self.assertTrue(text.startswith("BEGIN;\n"))
        self.assertTrue(text.endswith("COMMIT;\n"))
        self.assertIn(
            'ALTER DATABASE "chenyida_erp_rb_deadbeefdeadbeef" OWNER TO "chenyida_erp_owner";',
            text,
        )
        self.assertIn('ALTER TABLE "public"."app_users" OWNER TO "chenyida_erp_owner";', text)
        self.assertIn("GRANT SELECT ON TABLE", text)
        self.assertEqual(text.count("GRANT ALL PRIVILEGES"), 404)
        self.assertEqual(text.count("GRANT ALL PRIVILEGES ON ROUTINE"), 394)
        self.assertEqual(text.count("GRANT ALL PRIVILEGES ON TYPE"), 6)
        self.assertIn(
            'GRANT ALL PRIVILEGES ON DATABASE '
            '"chenyida_erp_rb_deadbeefdeadbeef" TO "chenyida_erp_owner";',
            text,
        )
        self.assertIn(
            'GRANT ALL PRIVILEGES ON SCHEMA "public" TO "pg_database_owner";',
            text,
        )
        self.assertIn(
            'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA "public" '
            'TO "chenyida_erp_owner";',
            text,
        )
        self.assertIn(
            'GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "public" '
            'TO "chenyida_erp_owner";',
            text,
        )
        self.assertIn(
            'GRANT ALL PRIVILEGES ON ROUTINE '
            'public."cyd_ai_governance_suggestion_assert_complete"(bigint) '
            'TO "chenyida_erp_owner";',
            text,
        )
        self.assertIn(
            'GRANT ALL PRIVILEGES ON ROUTINE public."armor"(bytea) '
            'TO CURRENT_USER;',
            text,
        )
        self.assertIn(
            'GRANT ALL PRIVILEGES ON TYPE "public"."gbtreekey16" '
            'TO CURRENT_USER;',
            text,
        )
        revoke_database = text.index(
            'REVOKE ALL PRIVILEGES ON DATABASE '
            '"chenyida_erp_rb_deadbeefdeadbeef"',
        )
        owner_database = text.index(
            'GRANT ALL PRIVILEGES ON DATABASE '
            '"chenyida_erp_rb_deadbeefdeadbeef"',
        )
        service_database = text.index(
            'GRANT CONNECT ON DATABASE "chenyida_erp_rb_deadbeefdeadbeef"',
        )
        self.assertLess(revoke_database, owner_database)
        self.assertLess(owner_database, service_database)
        self.assertEqual(text.count("ALTER DEFAULT PRIVILEGES"), 2)
        self.assertIn("SET default_transaction_read_only TO 'on'", text)
        for forbidden in (
            "CREATE ROLE", "ALTER ROLE", "DROP ROLE", "PASSWORD", "VALID UNTIL",
            "ALTER TABLESPACE", "CREATE TABLESPACE", "DROP TABLESPACE",
            "GRANT ALL PRIVILEGES ON TABLESPACE",
            "REVOKE ALL PRIVILEGES ON TABLESPACE",
        ):
            self.assertNotIn(forbidden, text.upper())
        spec = EXECUTOR.derive_pg_reconcile_opcode_spec(base, inputs, bindings)
        self.assertEqual(
            EXECUTOR.validate_pg_reconcile_opcode_spec(spec, base=base, inputs=inputs),
            spec,
        )
        self.assertEqual(hashlib.sha256(raw).hexdigest(), spec["sql_sha256"])
        mutated = {**bindings, "sql": "ALTER ROLE postgres SUPERUSER"}
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_POSTGRES_RECONCILIATION_INVALID",
        ):
            EXECUTOR.render_pg_reconciliation_sql(base, inputs, mutated)


class PostgresCapabilityParserTest(unittest.TestCase):
    def test_capacity_dump_inventory_and_mutation_ack_are_closed(self):
        capacity = EXECUTOR.parse_postgres_capacity(
            b"   Avail\n21474836480\n", 4 * 1024**3,
        )
        self.assertEqual(capacity["status"], "SUFFICIENT_WITH_FIXED_RESERVE")
        self.assertNotEqual(capacity["capacity_sha256"], EXECUTOR.ZERO_SHA256)
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_POSTGRES_CAPACITY_INVALID",
        ):
            EXECUTOR.parse_postgres_capacity(b"Avail\n10737418240\n", 1024)

        dump_list = (
            ";\n; Archive created at 2026-08-16 02:00:00 UTC\n"
            "1; 0 0 SCHEMA - public chenyida_erp_owner\n"
            "2; 1259 16384 TABLE public app_users chenyida_erp_owner\n"
            "3; 0 16384 TABLE DATA public app_users chenyida_erp_owner\n"
        ).encode()
        inventory = EXECUTOR.parse_pg_dump_inventory(
            dump_list, dump_sha256=digest("pg-dump-fixture"),
        )
        self.assertEqual(inventory["entry_count"], 3)
        for forbidden in (
            b"1; 0 0 DATABASE - chenyida_erp postgres\n",
            b"1; 0 0 TABLESPACE - attacker postgres\n",
            b"1; 0 0 LARGE OBJECT - 42 postgres\n",
        ):
            with self.subTest(forbidden=forbidden), self.assertRaisesRegex(
                EXECUTOR.FixedExecutorError,
                "ROLLBACK_FIXED_EXECUTOR_POSTGRES_DUMP_INVENTORY_INVALID",
            ):
                EXECUTOR.parse_pg_dump_inventory(
                    forbidden, dump_sha256=digest("pg-dump-fixture"),
                )
        ack = EXECUTOR.parse_pg_mutation_ack(b"\nt\n", "PG_RB_CREATE_STAGING_V1")
        self.assertNotEqual(ack["ack_sha256"], EXECUTOR.ZERO_SHA256)
        for ambiguous in (b"\n", b"t\nt\n", b" \t\r\n"):
            with self.subTest(ambiguous=ambiguous), self.assertRaisesRegex(
                EXECUTOR.FixedExecutorError,
                "ROLLBACK_FIXED_EXECUTOR_POSTGRES_MUTATION_ACK_INVALID",
            ):
                EXECUTOR.parse_pg_mutation_ack(
                    ambiguous, "PG_RB_GUARDED_SWITCH_V3",
                )
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_POSTGRES_MUTATION_ACK_INVALID",
        ):
            EXECUTOR.parse_pg_mutation_ack(
                b"caller-controlled output", "PG_RB_ATOMIC_SWITCH_V1",
            )

    def test_pre_restore_layout_requires_one_exact_sealed_candidate(self):
        base = EXECUTOR.derive_pg_rollback_base_spec(PostgresRollbackBaseSpecTest.inputs())
        names = base["databases"]
        raw = EXECUTOR.canonical({
            "system_identifier": base["postgres"]["system_identifier"],
            "server_version_num": base["postgres"]["server_version_num"],
            "databases": [{
                "name": names["active_name"], "oid": names["candidate_oid"],
                "marker": names["candidate_marker"], "allow_connections": False,
                "connection_limit": 0, "default_transaction_read_only": True,
                "sessions": 0, "prepared_xacts": 0,
            }],
        })
        observed = EXECUTOR.parse_pg_state_observation(
            raw, base=base, observed_at="2026-08-16T02:00:00.000Z",
        )
        self.assertEqual(
            EXECUTOR.validate_pg_pre_restore_layout(observed, base=base),
            observed["observation_sha256"],
        )
        drift = copy.deepcopy(observed)
        drift["databases"][0]["allow_connections"] = True
        drift["observation_sha256"] = EXECUTOR.digest_value(
            EXECUTOR.without(drift, "observation_sha256"),
        )
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_POSTGRES_OBSERVATION_INVALID",
        ):
            EXECUTOR.validate_pg_pre_restore_layout(drift, base=base)


class PostgresPostverifyParserTest(unittest.TestCase):
    def test_embedded_postverify_sql_is_the_exact_reviewed_repository_source(self):
        content = (SITE_ROOT / "scripts/backup-reconciliation.sql").read_bytes()
        security = (
            SITE_ROOT / "scripts/postgresql-runtime-privilege-state.sql"
        ).read_bytes()
        self.assertEqual(
            EXECUTOR.embedded_postgres_sql(
                EXECUTOR.POSTGRES_CONTENT_SQL_ZLIB_BASE64,
                EXECUTOR.POSTGRES_CONTENT_SQL_SHA256,
            ),
            content,
        )
        self.assertEqual(
            EXECUTOR.embedded_postgres_sql(
                EXECUTOR.POSTGRES_SECURITY_SQL_ZLIB_BASE64,
                EXECUTOR.POSTGRES_SECURITY_SQL_SHA256,
            ),
            security,
        )
        self.assertIn(
            b"BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;", content,
        )
        self.assertIn(b"SET LOCAL statement_timeout = '240s';", content)
        self.assertIn(b"SET LOCAL idle_in_transaction_session_timeout = '15s';", content)
        self.assertTrue(content.rstrip().endswith(b"COMMIT;"))

    def test_database_report_requires_closed_rows_unique_identity_and_large_objects(self):
        report = PostgresRollbackBaseSpecTest.inputs().json(
            "snapshot_reconciliation",
        )["database"]["report"].encode()
        evidence = EXECUTOR.validate_database_reconciliation_report(report)
        self.assertEqual(evidence["sha256"], hashlib.sha256(report).hexdigest())
        self.assertEqual(evidence["rows"], 2)
        relation = report.splitlines()[0]
        for invalid in (
            relation + b"\n",
            relation + b"\n" + relation + b"\n" + report.splitlines()[1] + b"\n",
            report.replace(b"RELATION", b"PLAINTEXT", 1),
        ):
            with self.subTest(invalid=invalid[:20]), self.assertRaises(
                EXECUTOR.FixedExecutorError,
            ):
                EXECUTOR.validate_database_reconciliation_report(invalid)

    def test_session_observation_binds_application_names_and_pool_maxima(self):
        clients = {
            value["role"]: {
                "application_name": value["application_name"],
                "pool_maximum": value["pool_maximum"],
            }
            for value in EXECUTOR.RUNTIME_WRITER_SESSION_CLIENTS.values()
        }
        clients = dict(sorted(clients.items()))
        sessions = [
            {
                "role": role, "application_name": policy["application_name"],
                "state": "idle", "count": policy["pool_maximum"],
            }
            for role, policy in clients.items()
        ]
        raw = (json.dumps({
            "database": "chenyida_erp", "sessions": sessions, "total": 14,
        }) + "\n").encode()
        evidence = EXECUTOR.parse_postgres_session_observation(
            raw, database="chenyida_erp", allowed_clients=clients,
        )
        self.assertEqual(evidence["total"], 14)
        self.assertEqual(evidence["client_policy_sha256"], EXECUTOR.digest_value(clients))
        for field, value in (("application_name", "unexpected"), ("count", 11)):
            invalid = json.loads(raw)
            invalid["sessions"][0][field] = value
            invalid["total"] = sum(item["count"] for item in invalid["sessions"])
            with self.subTest(field=field), self.assertRaisesRegex(
                EXECUTOR.FixedExecutorError,
                "ROLLBACK_FIXED_EXECUTOR_POSTGRES_SESSION_OBSERVATION_INVALID",
            ):
                EXECUTOR.parse_postgres_session_observation(
                    canonical(invalid), database="chenyida_erp", allowed_clients=clients,
                )

    def test_complete_repository_migration_ledger_is_exact_ordered_and_content_bound(self):
        migrations = sorted((SITE_ROOT / "drizzle-postgres").glob("[0-9][0-9][0-9][0-9]_*.sql"))
        raw = "".join(
            f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n"
            for path in migrations
        ).encode()
        records = [
            {"checksum": line.split("  ", 1)[0], "version": line.split("  ", 1)[1]}
            for line in raw.decode().splitlines()
        ]
        allowlist_sha256 = EXECUTOR.migration_allowlist_digest(records)
        evidence = EXECUTOR.validate_migration_ledger(
            raw, expected_ledger_file_sha256=hashlib.sha256(raw).hexdigest(),
            expected_allowlist_sha256=allowlist_sha256,
            expected_head=migrations[-1].name,
        )
        self.assertEqual(evidence["count"], 46)
        self.assertEqual(evidence["head"], "0046_runtime_lock_privilege_boundary.sql")
        reversed_raw = b"\n".join(reversed(raw.splitlines())) + b"\n"
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_MIGRATION_LEDGER_INVALID",
        ):
            EXECUTOR.validate_migration_ledger(
                reversed_raw,
                expected_ledger_file_sha256=hashlib.sha256(reversed_raw).hexdigest(),
                expected_allowlist_sha256=allowlist_sha256,
                expected_head=migrations[0].name,
            )
        gap_raw = b"\n".join(
            line for line in raw.splitlines() if b"  0045_" not in line
        ) + b"\n"
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_MIGRATION_LEDGER_INVALID",
        ):
            EXECUTOR.validate_migration_ledger(
                gap_raw,
                expected_ledger_file_sha256=hashlib.sha256(gap_raw).hexdigest(),
                expected_allowlist_sha256=allowlist_sha256,
                expected_head=migrations[-1].name,
            )

    def test_live_privilege_state_must_equal_the_policy_derived_final_state(self):
        inputs = PostgresRollbackBaseSpecTest.inputs()
        base = EXECUTOR.derive_pg_rollback_base_spec(inputs)
        state = EXECUTOR.derive_expected_runtime_privilege_state(
            inputs, base, {"database_oid": "16385"},
        )
        storage = {
            (item["kind"], item["identity"]): item
            for item in state["object_acl_storage"]
        }
        self.assertEqual(storage[("DATABASE", "chenyida_erp")], {
            "kind": "DATABASE", "identity": "chenyida_erp",
            "owner": "chenyida_erp_owner", "acl_state": "EXPLICIT",
            "acl_item_count": 5,
            "owner_privileges": [
                {"privilege_type": "CONNECT", "is_grantable": False},
                {"privilege_type": "CREATE", "is_grantable": False},
                {"privilege_type": "TEMPORARY", "is_grantable": False},
            ],
        })
        self.assertEqual(storage[("ROUTINE", "public.armor(bytea)")], {
            "kind": "ROUTINE", "identity": "public.armor(bytea)",
            "owner": "PLATFORM_OWNER", "acl_state": "EXPLICIT",
            "acl_item_count": 1,
            "owner_privileges": [
                {"privilege_type": "EXECUTE", "is_grantable": False},
            ],
        })
        self.assertEqual(storage[("TYPE", "public.gbtreekey16")], {
            "kind": "TYPE", "identity": "public.gbtreekey16",
            "owner": "PLATFORM_OWNER", "acl_state": "EXPLICIT",
            "acl_item_count": 1,
            "owner_privileges": [
                {"privilege_type": "USAGE", "is_grantable": False},
            ],
        })
        self.assertEqual(storage[("TABLESPACE", "pg_default")], {
            "kind": "TABLESPACE", "identity": "pg_default",
            "owner": "PLATFORM_OWNER", "acl_state": "EXPLICIT",
            "acl_item_count": 1,
            "owner_privileges": [
                {"privilege_type": "CREATE", "is_grantable": False},
            ],
        })
        raw = (json.dumps(state, ensure_ascii=False, separators=(", ", ": ")) + "\n").encode()
        parsed = EXECUTOR.parse_runtime_privilege_state(
            raw, inputs=inputs, base=base, restored_oid="16385",
        )
        self.assertEqual(parsed["state"], state)
        drift = copy.deepcopy(state)
        drift["database"]["connection_limit"] = 63
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_POSTGRES_SECURITY_STATE_INVALID",
        ):
            EXECUTOR.parse_runtime_privilege_state(
                (json.dumps(drift) + "\n").encode(),
                inputs=inputs, base=base, restored_oid="16385",
            )


class ClosedPostgresCapabilityDriverTest(unittest.TestCase):
    class Runner:
        def __init__(self, base):
            self.base = base
            self.calls = []
            names = base["databases"]

            def row(name, oid, marker, allow, limit, readonly):
                return {
                    "name": name, "oid": oid, "marker": marker,
                    "allow_connections": allow, "connection_limit": limit,
                    "default_transaction_read_only": readonly,
                    "sessions": 0, "prepared_xacts": 0,
                }

            self.observations = [
                [row(names["active_name"], names["candidate_oid"],
                     names["candidate_marker"], False, 0, True)],
                [
                    row(names["active_name"], names["candidate_oid"],
                        names["candidate_marker"], False, 0, True),
                    row(names["staging_name"], "16385", names["staging_marker"],
                        True, 0, True),
                ],
                [
                    row(names["active_name"], names["candidate_oid"],
                        names["candidate_marker"], False, 0, True),
                    row(names["staging_name"], "16385", names["staging_marker"],
                        True, 0, True),
                ],
                [
                    row(names["active_name"], "16385", names["candidate_marker"],
                        False, 0, True),
                    row(names["quarantine_name"], names["candidate_oid"],
                        names["quarantine_marker"], False, 0, True),
                ],
                [
                    row(names["active_name"], "16385", names["candidate_marker"],
                        True, 64, False),
                    row(names["quarantine_name"], names["candidate_oid"],
                        names["quarantine_marker"], False, 0, True),
                ],
            ]

        def postgres_dump_opcode(self, _base, opcode, dump_fd):
            self.calls.append((opcode["opcode"], dump_fd))
            if opcode["opcode"] == "PG_RB_LIST_DUMP_V1":
                return (
                    ";\n1; 0 0 SCHEMA - public chenyida_erp_owner\n"
                    "2; 1259 16384 TABLE public app_users chenyida_erp_owner\n"
                ).encode()
            return b""

        def postgres_sql_opcode(self, _base, opcode):
            self.calls.append(opcode["opcode"])
            if opcode["opcode"] == "PG_RB_OBSERVE_STATE_V1":
                databases = self.observations.pop(0)
                return (json.dumps({
                    "system_identifier": self.base["postgres"]["system_identifier"],
                    "server_version_num": self.base["postgres"]["server_version_num"],
                    "databases": databases,
                }, separators=(", ", ": ")) + "\n").encode()
            if opcode["opcode"] == "PG_RB_OBSERVE_STAGING_RESTORE_PRECONDITION_V1":
                return (json.dumps({
                    "system_identifier": self.base["postgres"]["system_identifier"],
                    "server_version_num": self.base["postgres"]["server_version_num"],
                    "database": {
                        "name": self.base["databases"]["staging_name"],
                        "oid": "16385", "marker": self.base["databases"]["staging_marker"],
                        "owner": "postgres", "allow_connections": True,
                        "connection_limit": 0, "default_transaction_read_only": True,
                        "sessions": 0, "prepared_xacts": 0,
                    },
                    "profile": {
                        "encoding": self.base["profile"]["encoding"],
                        "locale_provider": self.base["profile"]["locale_provider"],
                        "collate": self.base["profile"]["collate"],
                        "ctype": self.base["profile"]["ctype"],
                        "collation_version": self.base["profile"]["collation_version"],
                        "tablespace": self.base["profile"]["default_tablespace"],
                    },
                    "projection": EXECUTOR.postgres_empty_restore_projection(),
                }) + "\n").encode()
            return b"\nt\n"

        def postgres_capacity(self):
            self.calls.append("POSTGRES_CAPACITY")
            return b"Avail\n32212254720\n"

        def postgres_reconcile_opcode(self, _base, _inputs, opcode):
            self.calls.append(opcode["opcode"])
            return b"\n"

        def postgres_guarded_switch_opcode(self, _base, _inputs, opcode):
            self.calls.append(opcode["opcode"])
            return b"\nt\n"

    def test_full_staging_restore_driver_reaches_only_new_sealed_layout(self):
        inputs = PostgresRollbackBaseSpecTest.inputs()
        base = EXECUTOR.derive_pg_rollback_base_spec(inputs)
        runner = self.Runner(base)
        driver = EXECUTOR.ClosedPostgresCapabilityDriver(
            runner, clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        preflight = driver.preflight(base, 99)
        created = driver.create_staging(base, preflight["observation"])
        self.assertEqual(created["classification"]["layout"], "OLD")
        precondition = driver.restore_precondition(
            base, create_receipt_sha256=digest("pg-create-receipt"),
            restored_oid=created["restored_oid"],
            dump_inventory_sha256=preflight["dump_inventory"]["inventory_sha256"],
        )["proof"]
        restored = driver.restore_dump(
            base, 99, create_receipt_sha256=digest("pg-create-receipt"),
            restored_oid=created["restored_oid"],
            before_content_observation_sha256=created["observation"]["observation_sha256"],
            dump_inventory_sha256=preflight["dump_inventory"]["inventory_sha256"],
            restore_precondition=precondition,
        )
        self.assertEqual(restored["restored_oid"], "16385")
        reconciled = driver.reconcile(
            base, inputs, restore_receipt_sha256=digest("pg-restore-receipt"),
            restored_oid=created["restored_oid"],
        )
        switched = driver.switch(
            base, inputs,
            privilege_receipt_sha256=digest("pg-privilege-receipt"),
            staging_content_proof_sha256=digest("pg-staging-content-proof"),
            restored_oid=created["restored_oid"],
            before_observation=reconciled["observation"],
        )
        self.assertEqual(switched["classification"]["layout"], "NEW_SEALED")
        released = driver.unseal(
            base, switch_receipt_sha256=digest("pg-switch-receipt"),
            activation_prerequisites_sha256=digest("pg-activation-prerequisites"),
            sealed_security_projection_sha256=digest("pg-sealed-security"),
            restored_oid=created["restored_oid"],
            before_observation=switched["observation"],
        )
        self.assertEqual(released["classification"]["layout"], "NEW_RELEASED")
        self.assertFalse(runner.observations)
        self.assertIn("POSTGRES_CAPACITY", runner.calls)
        self.assertEqual(
            [item for item in runner.calls if item == "PG_RB_GUARDED_SWITCH_V3"],
            ["PG_RB_GUARDED_SWITCH_V3"],
        )

    def test_driver_rejects_a_post_switch_partial_layout(self):
        inputs = PostgresRollbackBaseSpecTest.inputs()
        base = EXECUTOR.derive_pg_rollback_base_spec(inputs)
        runner = self.Runner(base)
        runner.observations[-2] = runner.observations[-2][1:]
        driver = EXECUTOR.ClosedPostgresCapabilityDriver(
            runner, clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        preflight = driver.preflight(base, 99)
        created = driver.create_staging(base, preflight["observation"])
        precondition = driver.restore_precondition(
            base, create_receipt_sha256=digest("pg-create-receipt"),
            restored_oid=created["restored_oid"],
            dump_inventory_sha256=preflight["dump_inventory"]["inventory_sha256"],
        )["proof"]
        driver.restore_dump(
            base, 99, create_receipt_sha256=digest("pg-create-receipt"),
            restored_oid=created["restored_oid"],
            before_content_observation_sha256=created["observation"]["observation_sha256"],
            dump_inventory_sha256=preflight["dump_inventory"]["inventory_sha256"],
            restore_precondition=precondition,
        )
        reconciled = driver.reconcile(
            base, inputs, restore_receipt_sha256=digest("pg-restore-receipt"),
            restored_oid=created["restored_oid"],
        )
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_POSTGRES_SWITCH_RESULT_INVALID",
        ):
            driver.switch(
                base, inputs,
                privilege_receipt_sha256=digest("pg-privilege-receipt"),
                staging_content_proof_sha256=digest("pg-staging-content-proof"),
                restored_oid=created["restored_oid"],
                before_observation=reconciled["observation"],
            )


class PostgresCapabilityRuntimeTest(unittest.TestCase):
    class Driver:
        def __init__(self, base):
            self.base = base
            self.calls = []
            self.restored_oid = "16385"
            self.initial = self.observation("INITIAL")
            self.old = self.observation("OLD")
            self.sealed = self.observation("NEW_SEALED")

        def observation(self, layout):
            names = self.base["databases"]

            def row(name, oid, marker, allow, limit, readonly):
                return {
                    "name": name, "oid": oid, "marker": marker,
                    "allow_connections": allow, "connection_limit": limit,
                    "default_transaction_read_only": readonly,
                    "sessions": 0, "prepared_xacts": 0,
                }

            if layout == "INITIAL":
                rows = [row(
                    names["active_name"], names["candidate_oid"], names["candidate_marker"],
                    False, 0, True,
                )]
            elif layout == "OLD":
                rows = [
                    row(names["active_name"], names["candidate_oid"],
                        names["candidate_marker"], False, 0, True),
                    row(names["staging_name"], self.restored_oid, names["staging_marker"],
                        True, 0, True),
                ]
            else:
                rows = [
                    row(names["active_name"], self.restored_oid,
                        names["candidate_marker"], False, 0, True),
                    row(names["quarantine_name"], names["candidate_oid"],
                        names["quarantine_marker"], False, 0, True),
                ]
            return EXECUTOR.parse_pg_state_observation(
                (json.dumps({
                    "system_identifier": self.base["postgres"]["system_identifier"],
                    "server_version_num": self.base["postgres"]["server_version_num"],
                    "databases": rows,
                }) + "\n").encode(),
                base=self.base, observed_at="2026-08-16T02:00:00.000Z",
            )

        def preflight(self, _base, dump_fd):
            self.calls.append(("preflight", dump_fd))
            return {
                "dump_inventory": {"inventory_sha256": digest("pg-runtime-inventory")},
                "observation": self.initial,
                "preflight_sha256": digest("pg-runtime-preflight"),
            }

        def create_staging(self, _base, before):
            self.calls.append(("create", before["observation_sha256"]))
            return {
                "restored_oid": self.restored_oid, "observation": self.old,
                "classification": EXECUTOR.classify_pg_rollback_layout(
                    self.old, base=self.base, restored_oid=self.restored_oid,
                ),
            }

        def restore_dump(self, _base, dump_fd, **bindings):
            self.calls.append(("restore", dump_fd, bindings["restored_oid"]))
            return {"restored_oid": self.restored_oid, "ack": {"fixture": "restore"}}

        def restore_precondition(self, base, **bindings):
            self.calls.append(("restore-precondition", bindings["restored_oid"]))
            opcode = EXECUTOR.derive_pg_opcode_spec(
                base, "PG_RB_OBSERVE_STAGING_RESTORE_PRECONDITION_V1", {
                    "create_receipt_sha256": bindings["create_receipt_sha256"],
                    "staging_oid": bindings["restored_oid"],
                    "dump_inventory_sha256": bindings["dump_inventory_sha256"],
                    "expected_empty_projection_sha256":
                        EXECUTOR.digest_value(EXECUTOR.postgres_empty_restore_projection()),
                },
            )
            raw = canonical({
                "system_identifier": base["postgres"]["system_identifier"],
                "server_version_num": base["postgres"]["server_version_num"],
                "database": {
                    "name": base["databases"]["staging_name"],
                    "oid": bindings["restored_oid"],
                    "marker": base["databases"]["staging_marker"],
                    "owner": "postgres", "allow_connections": True,
                    "connection_limit": 0, "default_transaction_read_only": True,
                    "sessions": 0, "prepared_xacts": 0,
                },
                "profile": {
                    "encoding": base["profile"]["encoding"],
                    "locale_provider": base["profile"]["locale_provider"],
                    "collate": base["profile"]["collate"],
                    "ctype": base["profile"]["ctype"],
                    "collation_version": base["profile"]["collation_version"],
                    "tablespace": base["profile"]["default_tablespace"],
                },
                "projection": EXECUTOR.postgres_empty_restore_projection(),
            })
            return {
                "opcode": opcode,
                "proof": EXECUTOR.parse_pg_restore_precondition(
                    raw, base=base, opcode_spec=opcode,
                ),
            }

        def reconcile(self, _base, _inputs, **bindings):
            self.calls.append(("reconcile", bindings["restored_oid"]))
            return {"restored_oid": self.restored_oid, "observation": self.old}

        def prove_staging_content(self, _inputs, base, **bindings):
            self.calls.append(("prove-staging", bindings["restored_oid"]))
            migration = EXECUTOR.validate_migration_ledger(
                _inputs.raw("snapshot_migrations"),
                expected_ledger_file_sha256=
                    base["snapshot"]["migration_ledger_file_sha256"],
                expected_allowlist_sha256=
                    base["snapshot"]["migration_allowlist_sha256"],
                expected_head=base["snapshot"]["migration_head"],
            )
            target = next(
                item for item in self.old["databases"]
                if item["name"] == base["databases"]["staging_name"]
            )
            candidate = next(
                item for item in self.old["databases"]
                if item["name"] == base["databases"]["active_name"]
            )
            identity = {
                "name": target["name"],
                "system_identifier": base["postgres"]["system_identifier"],
                "oid": target["oid"], "marker": target["marker"],
            }
            guarded_material = EXECUTOR._postgres_guarded_switch_material(
                base, _inputs, restored_oid=bindings["restored_oid"],
            )
            return {
                "source_report": {
                    "source_sha256": base["snapshot"]["source_reconciliation_sha256"],
                    "report_sha256": base["snapshot"]["target_database_report_sha256"],
                },
                "live_report": {"sha256": base["snapshot"]["target_database_report_sha256"]},
                "migration": migration,
                "security": {
                    "state_sha256": guarded_material["security_state_sha256"],
                },
                "sessions": {
                    "total": 0, "allowed_role_set_sha256": digest("runtime-empty-roles"),
                    "client_policy_sha256": digest("runtime-empty-clients"),
                    "observation_sha256": digest("runtime-empty-sessions"),
                },
                "identity": {**identity, "identity_sha256": EXECUTOR.digest_value(identity)},
                "before": self.old, "after": self.old,
                "target": target, "candidate": candidate,
            }

        def guarded_switch_opcode(self, base, inputs, **bindings):
            return EXECUTOR.ClosedPostgresCapabilityDriver.guarded_switch_opcode(
                self, base, inputs, **bindings,
            )

        def execute_guarded_switch(self, _base, _inputs, *, opcode, restored_oid):
            self.calls.append(("switch", restored_oid))
            return {
                "opcode": opcode,
                "restored_oid": self.restored_oid, "observation": self.sealed,
                "classification": EXECUTOR.classify_pg_rollback_layout(
                    self.sealed, base=self.base, restored_oid=self.restored_oid,
                ),
            }

        def dump_inventory(self, _base, dump_fd):
            self.calls.append(("inventory", dump_fd))
            return {"inventory_sha256": digest("pg-runtime-inventory")}

        def observe(self, _base, purpose, _binding):
            self.calls.append(("observe", purpose))
            return self.sealed

    class RollbackBeforeCommitDriver(Driver):
        def __init__(self, base):
            super().__init__(base)
            self.fail_once = True
            self.current = self.old

        def execute_guarded_switch(self, _base, _inputs, *, opcode, restored_oid):
            self.calls.append(("switch", restored_oid))
            if self.fail_once:
                self.fail_once = False
                EXECUTOR.reject("ROLLBACK_FIXED_EXECUTOR_POSTGRES_SWITCH_RESULT_INVALID")
            self.current = self.sealed
            return {
                "opcode": opcode, "restored_oid": restored_oid,
                "observation": self.current,
                "classification": EXECUTOR.classify_pg_rollback_layout(
                    self.current, base=self.base, restored_oid=restored_oid,
                ),
            }

        def observe(self, _base, purpose, _binding):
            self.calls.append(("observe", purpose))
            return self.current

    @staticmethod
    def inputs():
        inputs = PostgresRollbackBaseSpecTest.inputs()
        base = EXECUTOR.derive_pg_rollback_base_spec(inputs)
        writer = valid_handler_evidence("WRITER_CONTAINMENT")
        writer.update({
            "database_oid": base["databases"]["candidate_oid"],
            "system_identifier": base["postgres"]["system_identifier"],
            "runtime_plan_sha256": base["runtime_plan_sha256"],
        })
        inputs.rollback_result = {
            "stages": [
                {"stage_result_sha256": digest(f"pg-runtime-unused-stage:{index}")}
                for index in range(9)
            ],
        }
        inputs.rollback_result["stages"][1] = {
            "stage_result_sha256": digest("pg-runtime-writer-stage"),
            "evidence": writer,
        }
        inputs.request = {
            "operation_id": base["rollback_operation_id"], "label": "POSTGRESQL_RESTORE",
            "runtime_plan_sha256": base["runtime_plan_sha256"],
            "source_set_sha256": base["source_set_sha256"],
        }
        inputs.fd = lambda role: 99 if role == "snapshot_postgresql" else None
        return inputs, base

    def test_runtime_orders_four_effects_and_recovers_from_complete_receipts(self):
        inputs, base = self.inputs()
        driver = self.Driver(base)
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            postgres_driver=driver, clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        effects = VolumeCapabilityRuntimeTest.Effects()
        evidence = runtime._execute_postgres(inputs, effects)
        self.assertEqual(effects.started, [
            "STAGING_DATABASE_CREATE", "LOGICAL_DUMP_RESTORE",
            "PRIVILEGE_RECONCILE", "DATABASE_SWITCH",
        ])
        self.assertEqual(effects.completed, effects.started)
        self.assertEqual(evidence["restored_database_oid"], driver.restored_oid)
        recovered = runtime._recover_postgres_execution(inputs, effects)
        self.assertEqual(recovered, evidence)
        self.assertEqual(driver.calls[-2:], [("inventory", 99), ("observe", "recover-switch")])

    def test_runtime_probe_rejects_a_receipt_prefix(self):
        inputs, base = self.inputs()
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            postgres_driver=self.Driver(base),
            clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        effects = VolumeCapabilityRuntimeTest.Effects()
        effects.receipts["STAGING_DATABASE_CREATE"] = {"fixture": "prefix"}
        with self.assertRaises(EXECUTOR.HandlerOutcomeUnknown) as caught:
            runtime._recover_postgres_execution(inputs, effects)
        self.assertEqual(caught.exception.reason_code, "PROBE_INCONCLUSIVE")

    def test_switch_commit_before_receipt_is_recovered_without_sql_replay(self):
        inputs, base = self.inputs()
        driver = self.Driver(base)
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            postgres_driver=driver, clock=lambda: "2026-08-16T02:00:00.000Z",
        )

        class DropSwitchReceipt(VolumeCapabilityRuntimeTest.Effects):
            def __init__(self):
                super().__init__()
                self.drop_once = True

            def complete(self, name, receipt):
                if name == "DATABASE_SWITCH" and self.drop_once:
                    self.drop_once = False
                    raise RuntimeError("simulated-crash-before-switch-receipt")
                return super().complete(name, receipt)

        effects = DropSwitchReceipt()
        with self.assertRaises(EXECUTOR.HandlerOutcomeUnknown):
            runtime._execute_postgres(inputs, effects)
        self.assertEqual(driver.calls.count(("switch", driver.restored_oid)), 1)
        recovered = runtime._recover_postgres_execution(inputs, effects)
        self.assertEqual(recovered["restored_database_oid"], driver.restored_oid)
        self.assertEqual(effects.receipts["DATABASE_SWITCH"]["status"], "RECOVERED_COMMITTED")
        self.assertNotEqual(
            effects.receipts["DATABASE_SWITCH"]["recovery_observation_sha256"],
            EXECUTOR.ZERO_SHA256,
        )
        self.assertEqual(driver.calls.count(("switch", driver.restored_oid)), 1)

    def test_exact_old_precommit_rollback_gets_one_durable_guarded_recovery_attempt(self):
        inputs, base = self.inputs()
        driver = self.RollbackBeforeCommitDriver(base)
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            postgres_driver=driver, clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        effects = VolumeCapabilityRuntimeTest.Effects()
        with self.assertRaises(EXECUTOR.HandlerOutcomeUnknown):
            runtime._execute_postgres(inputs, effects)
        self.assertEqual(driver.current, driver.old)
        self.assertIsNone(effects.receipt("DATABASE_SWITCH"))
        recovered = runtime._recover_postgres_execution(inputs, effects)
        self.assertEqual(recovered["restored_database_oid"], driver.restored_oid)
        self.assertEqual(effects.receipts["DATABASE_SWITCH"]["status"], "RECOVERED_COMMITTED")
        self.assertEqual(driver.calls.count(("switch", driver.restored_oid)), 2)
        self.assertEqual(set(effects.recovery_attempts), {"DATABASE_SWITCH"})

    def test_exact_old_with_prior_recovery_reservation_never_replays_again(self):
        inputs, base = self.inputs()
        driver = self.RollbackBeforeCommitDriver(base)
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            postgres_driver=driver, clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        effects = VolumeCapabilityRuntimeTest.Effects()
        with self.assertRaises(EXECUTOR.HandlerOutcomeUnknown):
            runtime._execute_postgres(inputs, effects)
        effects.recovery_attempts["DATABASE_SWITCH"] = {"fixture": "already-reserved"}
        with self.assertRaises(EXECUTOR.HandlerOutcomeUnknown) as caught:
            runtime._recover_postgres_execution(inputs, effects)
        self.assertEqual(caught.exception.reason_code, "SIDE_EFFECT_OUTCOME_UNKNOWN")
        self.assertEqual(driver.calls.count(("switch", driver.restored_oid)), 1)

    def test_exact_old_marker_drift_fails_closed_without_recovery_replay(self):
        inputs, base = self.inputs()
        driver = self.RollbackBeforeCommitDriver(base)
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            postgres_driver=driver, clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        effects = VolumeCapabilityRuntimeTest.Effects()
        with self.assertRaises(EXECUTOR.HandlerOutcomeUnknown):
            runtime._execute_postgres(inputs, effects)
        drifted = copy.deepcopy(driver.old)
        next(
            row for row in drifted["databases"]
            if row["name"] == base["databases"]["staging_name"]
        )["marker"] = "chenyida-erp-uat-rollback/v1:rollback-runner-deadbeef:DRIFT"
        drifted["observation_sha256"] = EXECUTOR.digest_value(
            EXECUTOR.without(drifted, "observation_sha256"),
        )
        driver.current = drifted
        with self.assertRaises(EXECUTOR.HandlerOutcomeUnknown) as caught:
            runtime._recover_postgres_execution(inputs, effects)
        self.assertEqual(caught.exception.reason_code, "TARGET_IDENTITY_DRIFT")
        self.assertEqual(driver.calls.count(("switch", driver.restored_oid)), 1)

    def test_switch_recovery_binds_current_oid_to_durable_restore_intents(self):
        inputs, base = self.inputs()
        driver = self.Driver(base)
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            postgres_driver=driver, clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        effects = VolumeCapabilityRuntimeTest.Effects()
        runtime._execute_postgres(inputs, effects)
        driver.restored_oid = "16386"
        driver.sealed = driver.observation("NEW_SEALED")
        with self.assertRaises(EXECUTOR.HandlerOutcomeUnknown) as caught:
            runtime._recover_postgres_execution(inputs, effects)
        self.assertEqual(caught.exception.reason_code, "TARGET_IDENTITY_DRIFT")


class PostgresPostverifyRuntimeTest(unittest.TestCase):
    class Runner:
        def __init__(self, inputs, base, failure=None):
            self.inputs = inputs
            self.base = base
            self.failure = failure
            self.calls = []

        def _state(self):
            names = self.base["databases"]
            return (json.dumps({
                "system_identifier": self.base["postgres"]["system_identifier"],
                "server_version_num": self.base["postgres"]["server_version_num"],
                "databases": [{
                    "name": names["active_name"], "oid": "16385",
                    "marker": names["candidate_marker"], "allow_connections": True,
                    "connection_limit": 64, "default_transaction_read_only": False,
                    "sessions": 0, "prepared_xacts": 0,
                }, {
                    "name": names["quarantine_name"], "oid": names["candidate_oid"],
                    "marker": names["quarantine_marker"], "allow_connections": False,
                    "connection_limit": 0, "default_transaction_read_only": True,
                    "sessions": 0, "prepared_xacts": 0,
                }],
            }) + "\n").encode()

        def postgres_sql_opcode(self, _base, opcode):
            self.calls.append(opcode["opcode"])
            return self._state()

        def postgres_postverify_content(self, _base):
            self.calls.append("content")
            raw = self.inputs.json("snapshot_reconciliation")["database"]["report"].encode()
            return raw.replace(b"\t0\t", b"\t1\t", 1) \
                if self.failure == "content" else raw

        def postgres_postverify_migrations(self, _database):
            self.calls.append("migrations")
            return self.inputs.raw("snapshot_migrations")

        def postgres_postverify_security(self, _base, _inputs):
            self.calls.append("security")
            state = EXECUTOR.derive_expected_runtime_privilege_state(
                self.inputs, self.base, {"database_oid": "16385"},
            )
            if self.failure == "security":
                state["database"]["connection_limit"] = 63
            return (json.dumps(state, separators=(", ", ": ")) + "\n").encode()

        def postgres_postverify_sessions(self, database):
            self.calls.append("sessions")
            if self.failure == "sessions":
                sessions = [{
                    "role": "chenyida_erp_intruder", "application_name": "intruder",
                    "state": "idle", "count": 1,
                }]
            elif self.failure == "allowed_sessions":
                sessions = [{
                    "role": "chenyida_erp_web", "application_name": "chenyida-erp-web",
                    "state": "idle", "count": 3,
                }]
            else:
                sessions = []
            return (json.dumps({
                "database": database, "sessions": sessions,
                "total": sum(item["count"] for item in sessions),
            }) + "\n").encode()

        def postgres_postverify_identity(self, database):
            self.calls.append("identity")
            value = {
                "name": database,
                "system_identifier": self.base["postgres"]["system_identifier"],
                "oid": "16386" if self.failure == "identity" else "16385",
                "marker": self.base["databases"]["candidate_marker"],
                "allow_connections": True, "connection_limit": 64,
                "default_transaction_read_only": False, "prepared_xacts": 0,
            }
            return (json.dumps(value) + "\n").encode()

    @staticmethod
    def inputs():
        inputs = PostgresRollbackBaseSpecTest.inputs()
        base = EXECUTOR.derive_pg_rollback_base_spec(inputs)
        security = base["security"]
        stage = valid_handler_evidence("POSTGRESQL_RESTORE")
        stage.update({
            "source_artifact_sha256": base["snapshot"]["dump_sha256"],
            "source_artifact_bytes": base["snapshot"]["dump_bytes"],
            "source_reconciliation_sha256":
                base["snapshot"]["source_reconciliation_sha256"],
            "target_content_sha256": base["snapshot"]["target_database_report_sha256"],
            "snapshot_database_oid": base["databases"]["candidate_oid"],
            "restored_database_oid": "16385",
            "restored_database_name": base["databases"]["active_name"],
            "system_identifier": base["postgres"]["system_identifier"],
            "migration_head": base["snapshot"]["migration_head"],
            "restored_database_marker": base["databases"]["candidate_marker"],
            "staging_database_name": base["databases"]["staging_name"],
            "candidate_database_quarantine_name": base["databases"]["quarantine_name"],
            "candidate_database_quarantine_oid": base["databases"]["candidate_oid"],
            "runtime_plan_sha256": base["runtime_plan_sha256"],
            "manifest_sha256": base["snapshot"]["snapshot_manifest_sha256"],
            "migration_ledger_file_sha256":
                base["snapshot"]["migration_ledger_file_sha256"],
            "migration_manifest_sha256":
                base["snapshot"]["migration_allowlist_sha256"],
            "postgres_container_id": base["postgres"]["container_id"],
            "postgres_image_config_digest": base["postgres"]["image_digest"],
            "database_profile_sha256": base["profile"]["profile_sha256"],
            "runtime_privilege_access_sha256": security["access_sha256"],
            "runtime_privilege_catalog_sha256": security["catalog_sha256"],
            "runtime_privilege_catalog_artifact_sha256":
                security["catalog_artifact_sha256"],
            "runtime_privilege_policy_sha256": security["policy_sha256"],
            "runtime_privilege_operator_policy_sha256":
                security["operator_policy_sha256"],
            "uat_reconciliation_authority_sha256": base["authority"]["authority_sha256"],
            "uat_reconciliation_activation_sha256":
                inputs.package["sources"]["snapshot_policy_activation"]["sha256"],
            "sealed_security_projection_sha256": EXECUTOR.digest_value(security),
            "staging_database_marker": base["databases"]["staging_marker"],
            "candidate_database_quarantine_marker": base["databases"]["quarantine_marker"],
        })
        bind_postgres_stage_proofs(stage, base)
        activation = valid_handler_evidence("WEB_WORKER_PREDECESSOR_ACTIVATION")
        activation.update({
            "runtime_plan_sha256": base["runtime_plan_sha256"],
            "uat_reconciliation_authority_sha256": base["authority"]["authority_sha256"],
            "uat_reconciliation_activation_sha256":
                inputs.package["sources"]["snapshot_policy_activation"]["sha256"],
            "sealed_security_projection_sha256": EXECUTOR.digest_value(security),
        })
        activation["preactivation_content_proof"] = preactivation_proof(
            base, activation["database_unseal_receipt_sha256"],
        )
        stages = [
            {"stage_result_sha256": digest(f"postgres-postverify-stage:{index}")}
            for index in range(9)
        ]
        stages[2]["evidence"] = stage
        stages[7]["evidence"] = activation
        inputs.rollback_result = {"stages": stages}
        return inputs, base

    def runtime(self, failure=None):
        inputs, base = self.inputs()
        runner = self.Runner(inputs, base, failure=failure)
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            postgres_driver=EXECUTOR.ClosedPostgresCapabilityDriver(
                runner, clock=lambda: "2026-08-16T02:00:00.000Z",
            ),
        )
        return inputs, base, runner, runtime

    def test_content_postverify_independently_reads_every_live_database_surface(self):
        inputs, base, runner, runtime = self.runtime()
        runtime.prepare("POSTGRESQL_CONTENT", inputs, [])
        result = runtime.probe(
            "POSTGRESQL_CONTENT", inputs, [], VolumeCapabilityRuntimeTest.Effects(),
        )
        evidence = result["evidence"]
        self.assertEqual(
            evidence["target_content_sha256"],
            base["snapshot"]["target_database_report_sha256"],
        )
        self.assertEqual(evidence["active_writer_session_count"], 0)
        self.assertEqual(evidence["active_unexpected_session_count"], 0)
        self.assertEqual(runner.calls, [
            "PG_RB_OBSERVE_STATE_V1", "content", "migrations", "security", "sessions",
            "identity", "PG_RB_OBSERVE_STATE_V1",
        ])

    def test_content_postverify_accepts_only_policy_bounded_live_writer_sessions(self):
        inputs, _base, _runner, runtime = self.runtime("allowed_sessions")
        evidence = runtime.probe(
            "POSTGRESQL_CONTENT", inputs, [], VolumeCapabilityRuntimeTest.Effects(),
        )["evidence"]
        self.assertEqual(evidence["active_writer_session_count"], 3)
        self.assertEqual(evidence["active_unexpected_session_count"], 0)

    def test_each_postactivation_dynamic_surface_fails_closed_on_drift(self):
        expected_codes = {
            "content": "ROLLBACK_FIXED_EXECUTOR_POSTGRES_CONTENT_DRIFT",
            "security": "ROLLBACK_FIXED_EXECUTOR_POSTGRES_SECURITY_STATE_INVALID",
            "sessions": "ROLLBACK_FIXED_EXECUTOR_POSTGRES_SESSION_OBSERVATION_INVALID",
            "identity": "ROLLBACK_FIXED_EXECUTOR_POSTGRES_IDENTITY_DRIFT",
        }
        for failure, code in expected_codes.items():
            with self.subTest(failure=failure):
                inputs, _base, _runner, runtime = self.runtime(failure)
                with self.assertRaisesRegex(EXECUTOR.FixedExecutorError, code):
                    runtime.probe(
                        "POSTGRESQL_CONTENT", inputs, [],
                        VolumeCapabilityRuntimeTest.Effects(),
                    )

    def test_zero_writer_dynamic_proof_is_built_before_activation(self):
        inputs, base, runner, _runtime = self.runtime()
        driver = EXECUTOR.ClosedPostgresCapabilityDriver(
            runner, clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        binding = digest("preactivation-binding")
        observed = driver.postverify_content(
            inputs, base, restored_oid="16385", binding_sha256=binding,
            require_zero_writer_sessions=True,
        )
        proof = EXECUTOR.build_preactivation_content_proof(observed, base, binding)
        self.assertEqual(proof["active_writer_session_count"], 0)
        self.assertEqual(
            proof["live_database_report_sha256"],
            base["snapshot"]["target_database_report_sha256"],
        )
        self.assertEqual(
            {"content", "migrations", "security", "sessions", "identity"}
                - set(runner.calls),
            set(),
        )

    def test_each_preactivation_dynamic_surface_fails_closed_on_drift(self):
        expected_codes = {
            "content": "ROLLBACK_FIXED_EXECUTOR_POSTGRES_CONTENT_DRIFT",
            "security": "ROLLBACK_FIXED_EXECUTOR_POSTGRES_SECURITY_STATE_INVALID",
            "sessions": "ROLLBACK_FIXED_EXECUTOR_POSTGRES_SESSION_OBSERVATION_INVALID",
            "identity": "ROLLBACK_FIXED_EXECUTOR_POSTGRES_IDENTITY_DRIFT",
        }
        for failure, code in expected_codes.items():
            with self.subTest(failure=failure):
                inputs, base, runner, _runtime = self.runtime(failure)
                driver = EXECUTOR.ClosedPostgresCapabilityDriver(
                    runner, clock=lambda: "2026-08-16T02:00:00.000Z",
                )
                with self.assertRaisesRegex(EXECUTOR.FixedExecutorError, code):
                    driver.postverify_content(
                        inputs, base, restored_oid="16385",
                        binding_sha256=digest("preactivation-binding"),
                        require_zero_writer_sessions=True,
                    )

    def test_migration_head_reads_the_live_full_ledger_and_database_identity(self):
        inputs, base, runner, runtime = self.runtime()
        evidence = runtime.probe(
            "MIGRATION_HEAD", inputs, [], VolumeCapabilityRuntimeTest.Effects(),
        )["evidence"]
        self.assertEqual(evidence["migration_head"], base["snapshot"]["migration_head"])
        self.assertEqual(
            evidence["migration_manifest_sha256"],
            base["snapshot"]["migration_allowlist_sha256"],
        )
        self.assertEqual(
            evidence["migration_ledger_file_sha256"],
            base["snapshot"]["migration_ledger_file_sha256"],
        )
        self.assertEqual(runner.calls, ["migrations", "identity"])


class ActivationCapabilityRuntimeTest(unittest.TestCase):
    class ReleaseDriver:
        def __init__(self):
            self.documents = None

        def preflight(self, _inputs):
            return {
                "reader_gid": 1000,
                "current_identity_sha256": digest("activation-current-identity"),
                "current_release_id": "candidate-release-001",
            }

        def publish(self, _inputs, documents):
            if self.documents is not None and self.documents != documents:
                raise EXECUTOR.FixedExecutorError(
                    "ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_BINDING_INVALID",
                )
            self.documents = copy.deepcopy(documents)
            return copy.deepcopy(self.documents)

        def read_published(self, _inputs, *, expected=None, allow_transaction=False):
            del allow_transaction
            if self.documents is None or expected is not None and expected != self.documents:
                raise EXECUTOR.FixedExecutorError(
                    "ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_BINDING_INVALID",
                )
            return copy.deepcopy(self.documents)

        def recover_published(self, inputs):
            return self.read_published(inputs)

    @staticmethod
    def inputs():
        inputs = PostgresRollbackBaseSpecTest.inputs()
        plan = inputs.plan
        package = inputs.package
        for index, name in enumerate(("caddy", "postgres", "web", "worker"), start=5):
            plan["candidate"]["services"][name].setdefault(
                "image_digest", f"sha256:{digest(f'activation-candidate-config:{index}')}",
            )
        for domain in ("uploads", "attachments", "backup_status"):
            plan["candidate"]["volumes"][domain].update({
                "domain": domain,
                "identity_sha256": digest(f"activation-candidate-volume:{domain}"),
            })
        plan["targets"]["rollback_postdeploy_run_id"] = "rollback-deadbeefdeadbeef"
        predecessor_manifest_sha256 = digest("activation-predecessor-manifest")
        package["protected_resources_sha256"] = digest("activation-protected-resources")
        package["predecessor"].update({
            "git_tree": "b" * 40,
            "release_manifest_sha256": predecessor_manifest_sha256,
            "web_image": plan["predecessor"]["web_image"],
            "web_image_config_digest": plan["predecessor"]["web_image_config_digest"],
            "worker_image": plan["predecessor"]["worker_image"],
            "worker_image_config_digest": plan["predecessor"]["worker_image_config_digest"],
            "runtime_configuration_sha256":
                plan["predecessor"]["runtime_configuration_sha256"],
        })
        source_hashes = {
            "compose_file": digest("activation-compose"),
            "compose_release_file": digest("activation-compose-release"),
            "deployment_environment": digest("activation-environment"),
            "runtime_policy": digest("activation-runtime-policy-source"),
            "predecessor_postdeploy_receipt": digest("activation-predecessor-receipt-source"),
            "predecessor_release_manifest": predecessor_manifest_sha256,
        }
        package["sources"].update({
            role: {"sha256": sha256} for role, sha256 in source_hashes.items()
        })
        plan["source_bindings"].update({
            "compose_file_sha256": source_hashes["compose_file"],
            "compose_release_file_sha256": source_hashes["compose_release_file"],
            "deployment_environment_sha256": source_hashes["deployment_environment"],
        })

        def source_service(name):
            planned = plan["candidate"]["services"].get(name)
            if name in {"web", "worker"}:
                reference = plan["predecessor"][f"{name}_image"]
                image_id = "sha256:" + reference.rsplit("@sha256:", 1)[-1]
                container_id = digest(f"activation-predecessor-source-container:{name}")
            else:
                reference = planned["image_reference"]
                image_id = planned["image_digest"]
                container_id = planned["container_id"]
            return {
                "service": name, "container_id": container_id, "image_id": image_id,
                "image_reference": reference, "restart_count": 0, "oom_killed": False,
                "running": True, "restarting": False, "paused": False, "dead": False,
                "status": "running", "health": "none" if name == "caddy" else "healthy",
                "healthcheck_present": name != "caddy",
            }

        predecessor_receipt = {
            "schema_version": 1, "contract": "chenyida-erp-postdeploy-verification/v1",
            "run_id": "predecessor-run-001", "generated_at": "2026-08-16T01:00:00.000Z",
            "result": "PASS", "runtime_guard": dict(EXECUTOR.POST_DEPLOY_RUNTIME_GUARD),
            "control": {
                "supervisor_bundle_sha256": digest("activation-old-supervisor"),
                "authorization_sha256": digest("activation-old-authorization"),
            },
            "deployment": {"class": "UAT", "id": "chenyida-erp", "compose_project": "chenyida-erp"},
            "release": {
                "release_id": "predecessor-release-001",
                "manifest_sha256": predecessor_manifest_sha256,
                "gate_plan_sha256": digest("activation-gate-plan"),
                "gate_report_sha256": digest("activation-gate-report"),
            },
            "source": {
                "application_version": package["predecessor"]["application_version"],
                "git_commit": package["predecessor"]["git_commit"],
                "git_tree": package["predecessor"]["git_tree"],
            },
            "migrations": {
                "head": package["predecessor"]["migration_head"],
                "manifest_sha256": package["predecessor"]["migration_manifest_sha256"],
            },
            "runtime_policy_sha256": EXECUTOR.RELEASE_RUNTIME_POLICY_SHA256,
            "runtime_configuration_sha256":
                package["predecessor"]["runtime_configuration_sha256"],
            "services": [source_service(name) for name in ("caddy", "postgres", "web", "worker")],
            "readiness": {
                "deployment_class": "UAT", "deployment_id": "chenyida-erp",
                "version": package["predecessor"]["application_version"],
                "revision": package["predecessor"]["git_commit"][:12],
                "migration_head": package["predecessor"]["migration_head"],
                "migration_manifest_sha256": package["predecessor"]["migration_manifest_sha256"],
                "database_time": "2026-08-16T01:00:00.000Z",
                "components": {
                    "postgresql": "READY", "migration": "READY", "worker": "READY",
                    "uploads": "READY", "attachments": "READY", "runtime": "READY",
                },
            },
        }
        predecessor_manifest = {
            "release_id": predecessor_receipt["release"]["release_id"],
            "source": {
                "package_version": package["predecessor"]["application_version"],
                "git_commit": package["predecessor"]["git_commit"],
                "git_tree": package["predecessor"]["git_tree"],
            },
            "migrations": {
                "head": package["predecessor"]["migration_head"],
                "allowlist_sha256": package["predecessor"]["migration_manifest_sha256"],
            },
        }
        inputs._documents.update({
            "predecessor_postdeploy_receipt": predecessor_receipt,
            "predecessor_release_manifest": predecessor_manifest,
        })
        inputs.context = {
            "supervisor_bundle_sha256": digest("activation-supervisor"),
            "original_authorization_sha256": digest("activation-original-authorization"),
        }
        inputs.request = {
            "operation_id": plan["rollback_operation_id"],
            "label": "WEB_WORKER_PREDECESSOR_ACTIVATION",
            "runtime_plan_sha256": plan["runtime_plan_sha256"],
            "source_set_sha256": package["source_set_sha256"],
            "payload": {"record_intent": {
                "execution_authorization_sha256": digest("activation-authorization"),
                "prepared_at": "2026-08-16T02:00:00.000Z",
            }},
        }
        inputs.fd = lambda role, maximum_bytes=None: 99 if role in {
            "deployment_environment", "compose_file", "compose_release_file",
        } else None
        base = EXECUTOR.derive_pg_rollback_base_spec(inputs)
        pg = valid_handler_evidence("POSTGRESQL_RESTORE")
        security = base["security"]
        pg.update({
            "source_artifact_sha256": base["snapshot"]["dump_sha256"],
            "source_artifact_bytes": base["snapshot"]["dump_bytes"],
            "source_reconciliation_sha256": base["snapshot"]["source_reconciliation_sha256"],
            "target_content_sha256": base["snapshot"]["target_database_report_sha256"],
            "snapshot_database_oid": base["databases"]["candidate_oid"],
            "restored_database_oid": "16385", "restored_database_name": base["databases"]["active_name"],
            "system_identifier": base["postgres"]["system_identifier"],
            "migration_head": base["snapshot"]["migration_head"],
            "restored_database_marker": base["databases"]["candidate_marker"],
            "staging_database_name": base["databases"]["staging_name"],
            "candidate_database_quarantine_name": base["databases"]["quarantine_name"],
            "candidate_database_quarantine_oid": base["databases"]["candidate_oid"],
            "runtime_plan_sha256": base["runtime_plan_sha256"],
            "manifest_sha256": base["snapshot"]["snapshot_manifest_sha256"],
            "migration_ledger_file_sha256":
                base["snapshot"]["migration_ledger_file_sha256"],
            "migration_manifest_sha256":
                base["snapshot"]["migration_allowlist_sha256"],
            "postgres_container_id": base["postgres"]["container_id"],
            "postgres_image_config_digest": base["postgres"]["image_digest"],
            "database_profile_sha256": base["profile"]["profile_sha256"],
            "runtime_privilege_access_sha256": security["access_sha256"],
            "runtime_privilege_catalog_sha256": security["catalog_sha256"],
            "runtime_privilege_catalog_artifact_sha256": security["catalog_artifact_sha256"],
            "runtime_privilege_policy_sha256": security["policy_sha256"],
            "runtime_privilege_operator_policy_sha256": security["operator_policy_sha256"],
            "uat_reconciliation_authority_sha256": base["authority"]["authority_sha256"],
            "uat_reconciliation_activation_sha256":
                package["sources"]["snapshot_policy_activation"]["sha256"],
            "sealed_security_projection_sha256": EXECUTOR.digest_value(security),
            "staging_database_marker": base["databases"]["staging_marker"],
            "candidate_database_quarantine_marker": base["databases"]["quarantine_marker"],
        })
        bind_postgres_stage_proofs(pg, base)
        stages = [
            {
                "stage_result_sha256": digest(f"activation-stage:{index}"),
                "started_at": "2026-08-16T02:00:00.000Z",
                "completed_at": "2026-08-16T02:00:00.000Z",
            }
            for index in range(9)
        ]
        stages[2]["evidence"] = pg
        for index, (domain, label) in enumerate((
                ("uploads", "UPLOADS_RESTORE"),
                ("attachments", "ATTACHMENTS_RESTORE"),
                ("backup_status", "BACKUP_STATUS_RESTORE"),
        ), start=3):
            evidence = valid_handler_evidence(label)
            evidence.update({
                "target_volume": plan["targets"]["volumes"][domain]["target"],
                "retained_candidate_volume": plan["candidate"]["volumes"][domain]["name"],
                "retained_candidate_volume_identity_sha256":
                    plan["candidate"]["volumes"][domain]["identity_sha256"],
                "runtime_plan_sha256": plan["runtime_plan_sha256"], "domain": domain,
            })
            stages[index]["evidence"] = evidence
        configuration = EXECUTOR.derive_rollback_runtime_configuration(inputs)
        stages[6]["evidence"] = {
            "compose_file_sha256": package["sources"]["compose_file"]["sha256"],
            "compose_release_file_sha256": package["sources"]["compose_release_file"]["sha256"],
            "deployment_environment_sha256": package["sources"]["deployment_environment"]["sha256"],
            "runtime_policy_sha256": package["sources"]["runtime_policy"]["sha256"],
            "predecessor_runtime_configuration_sha256":
                package["predecessor"]["runtime_configuration_sha256"],
            "rollback_runtime_projection_sha256":
                configuration["rollback_runtime_projection_sha256"],
            "compose_rollback_overlay_sha256": configuration["compose_rollback_overlay_sha256"],
            "rollback_runtime_configuration_sha256":
                configuration["rollback_runtime_configuration_sha256"],
            "runtime_plan_sha256": plan["runtime_plan_sha256"],
        }
        inputs.rollback_result = {"stages": stages}
        inputs._release_driver = ActivationCapabilityRuntimeTest.ReleaseDriver()
        return inputs, base

    @staticmethod
    def readiness(inputs, database_time="2026-08-16T02:00:00.000Z"):
        predecessor = inputs.package["predecessor"]
        return {
            "deployment_class": "UAT", "deployment_id": "chenyida-erp",
            "version": predecessor["application_version"],
            "revision": predecessor["git_commit"][:12],
            "migration_head": predecessor["migration_head"],
            "migration_manifest_sha256": predecessor["migration_manifest_sha256"],
            "database_time": database_time,
            "components": {
                "postgresql": "READY", "migration": "READY", "worker": "READY",
                "uploads": "READY", "attachments": "READY", "runtime": "READY",
            },
        }

    @staticmethod
    def service_observation(inputs):
        plan = inputs.plan
        services = []
        for name in ("caddy", "postgres", "web", "worker"):
            if name in {"web", "worker"}:
                container_id = digest(f"activation-new-container:{name}")
                reference = plan["predecessor"][f"{name}_image"]
                config = plan["predecessor"][f"{name}_image_config_digest"]
            else:
                container_id = plan["candidate"]["services"][name]["container_id"]
                reference = plan["candidate"]["services"][name]["image_reference"]
                config = plan["candidate"]["services"][name]["image_digest"]
            services.append({
                "service": name, "container_id": container_id, "image_reference": reference,
                "image_config_digest": config, "running": True, "healthy": True,
                "health": "none" if name == "caddy" else "healthy",
                "healthcheck_present": name != "caddy", "restart_count": 0,
                "oom_killed": False, "configuration_sha256": digest(f"activation-config:{name}"),
            })
        body = {
            "schema_version": 1,
            "contract": "chenyida-erp-uat-rollback-activation-service-observation/v1",
            "runtime_plan_sha256": plan["runtime_plan_sha256"], "services": services,
        }
        return {**body, "service_set_sha256": EXECUTOR.digest_value(body)}

    class Driver:
        def __init__(self, inputs, base):
            self.inputs = inputs
            self.base = base
            self.services = ActivationCapabilityRuntimeTest.service_observation(inputs)
            self.readiness = ActivationCapabilityRuntimeTest.readiness(inputs)
            self.sealed = self.observation(False)
            self.released = self.observation(True)
            self.calls = []

        def observation(self, released):
            names = self.base["databases"]
            rows = [
                {
                    "name": names["active_name"], "oid": "16385",
                    "marker": names["candidate_marker"],
                    "allow_connections": released, "connection_limit": 64 if released else 0,
                    "default_transaction_read_only": not released,
                    "sessions": 0, "prepared_xacts": 0,
                },
                {
                    "name": names["quarantine_name"], "oid": names["candidate_oid"],
                    "marker": names["quarantine_marker"], "allow_connections": False,
                    "connection_limit": 0, "default_transaction_read_only": True,
                    "sessions": 0, "prepared_xacts": 0,
                },
            ]
            return EXECUTOR.parse_pg_state_observation(
                (json.dumps({
                    "system_identifier": self.base["postgres"]["system_identifier"],
                    "server_version_num": self.base["postgres"]["server_version_num"],
                    "databases": rows,
                }) + "\n").encode(), base=self.base,
                observed_at="2026-08-16T02:00:00.000Z",
            )

        def preflight(self, _inputs, _base, **_bindings):
            self.calls.append("preflight")
            return {
                "images": {
                    "web": {"image_observation_sha256": digest("activation-web-image")},
                    "worker": {"image_observation_sha256": digest("activation-worker-image")},
                },
                "database": self.sealed,
                "classification": EXECUTOR.classify_pg_rollback_layout(
                    self.sealed, base=self.base, restored_oid="16385",
                ),
                "preflight_sha256": digest("activation-preflight"),
            }

        def unseal(self, _base, _stage, **_bindings):
            self.calls.append("unseal")
            return {
                "observation": self.released,
                "classification": EXECUTOR.classify_pg_rollback_layout(
                    self.released, base=self.base, restored_oid="16385",
                ),
            }

        def probe_database(self, _base, **_bindings):
            self.calls.append("probe_database")
            return {
                "observation": self.released,
                "classification": EXECUTOR.classify_pg_rollback_layout(
                    self.released, base=self.base, restored_oid="16385",
                ),
            }

        def prove_content(self, _inputs, base, *, restored_oid, binding_sha256):
            self.calls.append("prove_content")
            identity = {
                "name": base["databases"]["active_name"],
                "system_identifier": base["postgres"]["system_identifier"],
                "oid": restored_oid, "marker": base["databases"]["candidate_marker"],
            }
            body = {
                "schema_version": 1,
                "contract": EXECUTOR.PREACTIVATION_CONTENT_PROOF_CONTRACT,
                "binding_sha256": binding_sha256,
                "runtime_plan_sha256": base["runtime_plan_sha256"],
                "source_reconciliation_sha256":
                    base["snapshot"]["source_reconciliation_sha256"],
                "source_database_report_sha256":
                    base["snapshot"]["target_database_report_sha256"],
                "live_database_report_sha256":
                    base["snapshot"]["target_database_report_sha256"],
                "migration_head": base["snapshot"]["migration_head"],
                "migration_ledger_file_sha256":
                    base["snapshot"]["migration_ledger_file_sha256"],
                "migration_allowlist_sha256":
                    base["snapshot"]["migration_allowlist_sha256"],
                "migration_ledger_sha256": digest("activation-migration-ledger"),
                "live_security_state_sha256": digest("activation-security-state"),
                "active_allowed_session_role_set_sha256": digest("activation-role-set"),
                "active_session_client_policy_sha256": digest("activation-client-policy"),
                "active_session_observation_sha256": digest("activation-sessions"),
                "active_writer_session_count": 0,
                "active_database_identity_sha256": EXECUTOR.digest_value(identity),
                "restored_database_oid": restored_oid,
                "restored_database_marker": base["databases"]["candidate_marker"],
                "system_identifier": base["postgres"]["system_identifier"],
                "active_allow_connections": True, "active_connection_limit": 64,
                "active_default_transaction_read_only": False,
                "active_prepared_xacts": 0,
                "candidate_database_quarantine_name":
                    base["databases"]["quarantine_name"],
                "candidate_database_quarantine_oid": base["databases"]["candidate_oid"],
                "candidate_database_quarantine_marker":
                    base["databases"]["quarantine_marker"],
                "candidate_database_quarantine_allow_connections": False,
                "candidate_database_quarantine_connection_limit": 0,
                "candidate_database_quarantine_sessions": 0,
                "candidate_database_quarantine_prepared_xacts": 0,
                "before_observation_sha256": self.released["observation_sha256"],
                "after_observation_sha256": self.released["observation_sha256"],
            }
            return {**body, "proof_sha256": EXECUTOR.digest_value(body)}

        def activate(self, _inputs):
            self.calls.append("activate")
            return {"compose_receipt": {"receipt_sha256": digest("activation-compose-receipt")},
                    "services": self.services, "readiness": self.readiness}

        def probe(self, _inputs, _base, **_bindings):
            self.calls.append("probe")
            return {"database": self.released, "services": self.services,
                    "readiness": self.readiness,
                    "classification": EXECUTOR.classify_pg_rollback_layout(
                        self.released, base=self.base, restored_oid="16385",
                    )}

    def test_three_effects_generate_replayable_release_evidence(self):
        inputs, base = self.inputs()
        driver = self.Driver(inputs, base)
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            activation_driver=driver, release_driver=inputs._release_driver,
            clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        effects = VolumeCapabilityRuntimeTest.Effects()
        evidence = runtime._execute_activation(inputs, effects)
        self.assertEqual(effects.started, [
            "DATABASE_UNSEAL", "WEB_WORKER_ACTIVATE", "RELEASE_EVIDENCE_PUBLISH",
        ])
        self.assertEqual(effects.completed, effects.started)
        self.assertEqual(driver.calls, ["preflight", "unseal", "prove_content", "activate"])
        self.assertEqual(
            EXECUTOR.validate_postdeploy_receipt_document(json.loads(
                evidence["rollback_postdeploy_receipt_json"],
            ))["run_id"],
            inputs.plan["targets"]["rollback_postdeploy_run_id"],
        )
        self.assertEqual(runtime._recover_activation(inputs, effects), evidence)
        self.assertEqual(driver.calls[-1], "probe")

    def test_receipt_prefix_is_typed_unknown(self):
        inputs, base = self.inputs()
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            activation_driver=self.Driver(inputs, base),
            release_driver=inputs._release_driver,
        )
        effects = VolumeCapabilityRuntimeTest.Effects()
        effects.receipts["DATABASE_UNSEAL"] = {"fixture": "prefix"}
        with self.assertRaises(EXECUTOR.HandlerOutcomeUnknown) as caught:
            runtime._recover_activation(inputs, effects)
        self.assertEqual(caught.exception.reason_code, "PROBE_INCONCLUSIVE")

    def test_unseal_commit_before_receipt_is_durably_recovered_without_activation(self):
        inputs, base = self.inputs()
        driver = self.Driver(inputs, base)
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            activation_driver=driver, release_driver=inputs._release_driver,
            clock=lambda: "2026-08-16T02:00:00.000Z",
        )

        class DropUnsealReceipt(VolumeCapabilityRuntimeTest.Effects):
            def __init__(self):
                super().__init__()
                self.drop_once = True

            def complete(self, name, receipt):
                if name == "DATABASE_UNSEAL" and self.drop_once:
                    self.drop_once = False
                    raise RuntimeError("simulated-crash-before-unseal-receipt")
                return super().complete(name, receipt)

        effects = DropUnsealReceipt()
        with self.assertRaises(EXECUTOR.HandlerOutcomeUnknown):
            runtime._execute_activation(inputs, effects)
        with self.assertRaises(EXECUTOR.HandlerOutcomeUnknown) as caught:
            runtime._recover_activation(inputs, effects)
        self.assertEqual(caught.exception.reason_code, "PROBE_INCONCLUSIVE")
        self.assertEqual(effects.receipts["DATABASE_UNSEAL"]["status"], "RECOVERED_COMMITTED")
        self.assertIn(EXECUTOR.PREACTIVATION_CONTENT_PROOF_NAME, effects.proofs)
        self.assertEqual(driver.calls.count("unseal"), 1)
        self.assertNotIn("activate", driver.calls)


class RollbackReleasePublisherFakeRootTest(unittest.TestCase):
    READER_GID = 1000

    @classmethod
    def fixture(cls, root, *, fault=None, current_generated_at=None):
        root = Path(root)
        os.chmod(root, 0o700)
        state_parent = root / "var/lib/chenyida-erp"
        state_parent.mkdir(parents=True)
        postdeploy = state_parent / "postdeploy"
        postdeploy.mkdir()
        os.chown(postdeploy, 0, 0)
        os.chmod(postdeploy, 0o750)
        identity_root = state_parent / "release-identity"
        identity_root.mkdir()
        os.chown(identity_root, 0, cls.READER_GID)
        os.chmod(identity_root, 0o750)
        marker = identity_root / EXECUTOR.RELEASE_IDENTITY_MARKER
        marker.write_bytes(EXECUTOR.RELEASE_IDENTITY_MARKER_VALUE)
        os.chown(marker, 0, cls.READER_GID)
        os.chmod(marker, 0o440)

        inputs, _base = ActivationCapabilityRuntimeTest.inputs()
        inputs.raw = lambda role, maximum=None: (
            f"ERP_RELEASE_IDENTITY_READER_GID={cls.READER_GID}\n".encode()
            if role == "deployment_environment" else b""
        )
        configuration = EXECUTOR.derive_rollback_runtime_configuration(inputs)
        documents = EXECUTOR.build_rollback_release_documents(
            inputs, ActivationCapabilityRuntimeTest.service_observation(inputs),
            runtime_configuration_sha256=
                configuration["rollback_runtime_configuration_sha256"],
            generated_at="2026-08-16T02:00:00.000Z",
            readiness=ActivationCapabilityRuntimeTest.readiness(inputs),
        )
        current = copy.deepcopy(documents["identity"])
        current.update({
            "release_id": "candidate-release-001",
            "postdeploy_receipt_sha256": digest("publisher-current-receipt"),
            "authorization_sha256": digest("publisher-current-authorization"),
            "generated_at": current_generated_at or "2026-08-16T01:00:00.000Z",
        })
        EXECUTOR.validate_release_identity_document(current)
        current_file = identity_root / "release-identity.json"
        current_file.write_bytes(canonical(current))
        os.chown(current_file, 0, cls.READER_GID)
        os.chmod(current_file, 0o440)
        publisher = EXECUTOR.ClosedRollbackReleasePublisher(
            filesystem_root=str(root), fault=fault,
        )
        return publisher, inputs, documents, postdeploy, identity_root

    def test_exact_receipt_and_identity_are_atomically_published_and_read_back(self):
        with tempfile.TemporaryDirectory(dir="/tmp") as temporary:
            publisher, inputs, documents, postdeploy, identity_root = self.fixture(
                temporary,
            )
            before = publisher.preflight(inputs)
            self.assertEqual(before["current_release_id"], "candidate-release-001")
            self.assertNotEqual(before["current_identity_sha256"], documents["identity_sha256"])
            self.assertEqual(publisher.publish(inputs, documents), documents)
            self.assertEqual(publisher.read_published(inputs, expected=documents), documents)
            run_id = inputs.plan["targets"]["rollback_postdeploy_run_id"]
            run_root = postdeploy / run_id
            receipt = run_root / f"{run_id}.postdeploy-receipt.json"
            identity = identity_root / "release-identity.json"
            self.assertEqual(receipt.read_bytes(), documents["receipt_json"].encode())
            self.assertEqual(identity.read_bytes(), documents["identity_json"].encode())
            self.assertEqual(receipt.stat().st_mode & 0o777, 0o440)
            self.assertEqual(identity.stat().st_mode & 0o777, 0o440)
            self.assertEqual(receipt.stat().st_uid, 0)
            self.assertEqual(receipt.stat().st_gid, 0)
            self.assertEqual(identity.stat().st_uid, 0)
            self.assertEqual(identity.stat().st_gid, self.READER_GID)
            self.assertFalse(
                (identity_root / EXECUTOR.RELEASE_IDENTITY_TRANSACTION_DIRECTORY).exists(),
            )

    def test_every_publication_crash_point_converges_from_durable_state(self):
        points = (
            "AFTER_ROLLBACK_RECEIPT_PREPARED",
            "AFTER_RELEASE_IDENTITY_TRANSACTION_PREPARED",
            "AFTER_ROLLBACK_RECEIPT_PUBLISHED",
            "AFTER_ROLLBACK_IDENTITY_REPLACED",
            "AFTER_ROLLBACK_PUBLICATION_COMMITTED",
        )
        for point in points:
            with self.subTest(point=point), tempfile.TemporaryDirectory(
                    dir="/tmp",
            ) as temporary:
                def crash(actual):
                    if actual == point:
                        raise RuntimeError(point)

                publisher, inputs, documents, _postdeploy, identity_root = self.fixture(
                    temporary, fault=crash,
                )
                with self.assertRaisesRegex(RuntimeError, point):
                    publisher.publish(inputs, documents)
                recovery = EXECUTOR.ClosedRollbackReleasePublisher(
                    filesystem_root=temporary,
                )
                if point != "AFTER_ROLLBACK_PUBLICATION_COMMITTED":
                    with self.assertRaisesRegex(
                        EXECUTOR.FixedExecutorError,
                        "ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_PARTIAL",
                    ):
                        recovery.read_published(inputs)
                self.assertEqual(recovery.recover_published(inputs), documents)
                self.assertEqual(recovery.read_published(inputs), documents)
                self.assertFalse(
                    (identity_root / EXECUTOR.RELEASE_IDENTITY_TRANSACTION_DIRECTORY).exists(),
                )

    def test_marker_mode_symlink_and_foreign_run_content_fail_closed(self):
        def wrong_mode(_inputs, _documents, _postdeploy, identity_root):
            os.chmod(identity_root / EXECUTOR.RELEASE_IDENTITY_MARKER, 0o640)

        def marker_symlink(_inputs, _documents, _postdeploy, identity_root):
            marker = identity_root / EXECUTOR.RELEASE_IDENTITY_MARKER
            marker.unlink()
            marker.symlink_to("release-identity.json")

        def foreign_run(inputs, _documents, postdeploy, _identity_root):
            run_root = postdeploy / inputs.plan["targets"]["rollback_postdeploy_run_id"]
            run_root.mkdir(mode=0o750)
            os.chown(run_root, 0, 0)
            os.chmod(run_root, 0o750)
            marker = run_root / EXECUTOR.RELEASE_ARTIFACT_MARKER
            marker.write_bytes(EXECUTOR.RELEASE_ARTIFACT_MARKER_VALUE)
            os.chown(marker, 0, 0)
            os.chmod(marker, 0o440)
            (run_root / "foreign.json").write_text("{}\n", encoding="utf-8")

        for name, mutate, code in (
                ("wrong-mode", wrong_mode, "RELEASE_PUBLICATION_ROOT_INVALID"),
                ("marker-symlink", marker_symlink, "RELEASE_PUBLICATION_ROOT_INVALID"),
                ("foreign-run", foreign_run, "RELEASE_PUBLICATION_TARGET_CONFLICT"),
        ):
            with self.subTest(name=name), tempfile.TemporaryDirectory(
                    dir="/tmp",
            ) as temporary:
                publisher, inputs, documents, postdeploy, identity_root = self.fixture(
                    temporary,
                )
                mutate(inputs, documents, postdeploy, identity_root)
                with self.assertRaisesRegex(EXECUTOR.FixedExecutorError, code):
                    publisher.preflight(inputs)

    def test_non_monotonic_identity_generation_is_rejected(self):
        with tempfile.TemporaryDirectory(dir="/tmp") as temporary:
            publisher, inputs, documents, _postdeploy, _identity_root = self.fixture(
                temporary, current_generated_at="2026-08-16T02:00:00.000Z",
            )
            with self.assertRaisesRegex(
                EXECUTOR.FixedExecutorError,
                "ROLLBACK_FIXED_EXECUTOR_RELEASE_PUBLICATION_GENERATION_INVALID",
            ):
                publisher.publish(inputs, documents)


class ActivationObservationParserTest(unittest.TestCase):
    def test_local_image_and_four_service_projection_are_exact(self):
        inputs, _base = ActivationCapabilityRuntimeTest.inputs()
        plan = inputs.plan
        reference = plan["predecessor"]["web_image"]
        config = plan["predecessor"]["web_image_config_digest"]
        image = [
            config, "linux", "amd64", [reference],
            {"digest": "sha256:" + reference.rsplit("@sha256:", 1)[-1]},
            ["node"], None, "/app", "SIGTERM",
        ]
        observed_image = EXECUTOR.parse_predecessor_image_observation(
            json.dumps(image).encode(), image_reference=reference,
            image_config_digest=config,
        )
        self.assertEqual(observed_image["image_config_digest"], config)

        identifiers = sorted([
            plan["candidate"]["services"]["caddy"]["container_id"],
            plan["candidate"]["services"]["postgres"]["container_id"],
            digest("activation-new-container:web"),
            digest("activation-new-container:worker"),
        ])
        lines = []
        for name in ("caddy", "postgres", "web", "worker"):
            if name in {"web", "worker"}:
                container_id = digest(f"activation-new-container:{name}")
                image_reference = plan["predecessor"][f"{name}_image"]
                image_id = plan["predecessor"][f"{name}_image_config_digest"]
            else:
                container_id = plan["candidate"]["services"][name]["container_id"]
                image_reference = plan["candidate"]["services"][name]["image_reference"]
                image_id = plan["candidate"]["services"][name]["image_digest"]
            networks = {
                "caddy": {"chenyida-erp_edge": {}},
                "postgres": {"chenyida-erp_backend": {}},
                "web": {"chenyida-erp_backend": {}, "chenyida-erp_edge": {}},
                "worker": {"chenyida-erp_backend": {}},
            }[name]
            mounts = []
            if name in {"web", "worker"}:
                for domain, destination in (
                        ("uploads", "/data/chenyida-erp/uploads"),
                        ("attachments", "/data/chenyida-erp/attachments"),
                ):
                    mounts.append({
                        "Type": "volume", "Name": plan["targets"]["volumes"][domain]["target"],
                        "Destination": destination, "RW": True,
                    })
            if name == "web":
                mounts.append({
                    "Type": "volume",
                    "Name": plan["targets"]["volumes"]["backup_status"]["target"],
                    "Destination": "/data/chenyida-erp/backup-status", "RW": False,
                })
            labels = {
                "com.docker.compose.project": "chenyida-erp",
                "com.docker.compose.service": name,
            }
            if name in {"web", "worker"}:
                labels.update({
                    "chenyida.erp.uat-rollback-operation": plan["rollback_operation_id"],
                    "chenyida.erp.uat-rollback-runtime-plan": plan["runtime_plan_sha256"],
                })
            lines.append(json.dumps([
                container_id, f"/chenyida-erp-{name}-1", image_id, image_reference,
                labels, "running", None if name == "caddy" else {"Status": "healthy"},
                0, False, mounts, networks, "0:0" if name == "caddy" else "65532:65532",
                True, ["ALL"], ["NET_BIND_SERVICE"] if name == "caddy" else None,
                ["no-new-privileges:true"], next(iter(networks)),
            ], separators=(",", ":")))
        raw = ("\n".join(lines) + "\n").encode()
        observed = EXECUTOR.parse_activation_service_observation(
            raw, plan=plan, discovered_ids=identifiers,
        )
        self.assertEqual([item["service"] for item in observed["services"]], [
            "caddy", "postgres", "web", "worker",
        ])
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_ACTIVATION_SERVICE_INVALID",
        ):
            EXECUTOR.parse_activation_service_observation(
                raw.replace(
                    plan["targets"]["volumes"]["uploads"]["target"].encode(),
                    plan["candidate"]["volumes"]["uploads"]["name"].encode(),
                ),
                plan=plan, discovered_ids=identifiers,
            )


class RuntimeOperationDriverTest(unittest.TestCase):
    class Runner:
        def __init__(self, plan):
            self.plan = plan
            self.sealed = False
            self.running = {"web": True, "worker": True}
            self.calls = []
            self.volume_documents = {}
            for index, domain in enumerate(("uploads", "attachments", "backup_status"), 1):
                name = plan["candidate"]["volumes"][domain]["name"]
                document = {
                    "CreatedAt": f"2026-08-16T02:03:0{index}.123456789Z",
                    "Driver": "local", "Labels": None,
                    "Mountpoint": f"/var/lib/docker/volumes/{name}/_data",
                    "Name": name, "Options": None, "Scope": "local",
                }
                self.volume_documents[name] = document
                plan["candidate"]["volumes"][domain]["identity_sha256"] = \
                    EXECUTOR.parse_volume_inspection(canonical(document), name)["identity_sha256"]

        def discover_project_containers(self):
            identifiers = sorted(
                item["container_id"] for item in self.plan["candidate"]["services"].values()
            )
            return ("\n".join(identifiers) + "\n").encode()

        def register_discovered_containers(self, _identifiers):
            return None

        def inspect_containers(self, identifiers):
            self.calls.append("OBSERVE_CONTAINERS")
            by_id = {
                item["container_id"]: (service, item)
                for service, item in self.plan["candidate"]["services"].items()
            }
            lines = []
            for identifier in identifiers:
                service, item = by_id[identifier]
                running = self.running.get(service, True)
                status = "running" if running else "exited"
                health = None if service == "caddy" or not running else {"Status": "healthy"}
                networks = {
                    "caddy": {"chenyida-erp_edge": {}},
                    "postgres": {"chenyida-erp_backend": {}},
                    "web": {"chenyida-erp_backend": {}, "chenyida-erp_edge": {}},
                    "worker": {"chenyida-erp_backend": {}},
                }[service]
                mounts = []
                if service in {"web", "worker"}:
                    for domain, destination in (
                            ("uploads", "/data/chenyida-erp/uploads"),
                            ("attachments", "/data/chenyida-erp/attachments"),
                    ):
                        mounts.append({
                            "Type": "volume",
                            "Name": self.plan["candidate"]["volumes"][domain]["name"],
                            "Destination": destination, "RW": True,
                        })
                if service == "web":
                    mounts.append({
                        "Type": "volume",
                        "Name": self.plan["candidate"]["volumes"]["backup_status"]["name"],
                        "Destination": "/data/chenyida-erp/backup-status", "RW": False,
                    })
                lines.append(json.dumps([
                    identifier, f"/chenyida-erp-{service}-1", item["image_digest"],
                    item["image_reference"], {
                        "com.docker.compose.project": "chenyida-erp",
                        "com.docker.compose.service": service,
                    }, status, health, 0, False, mounts, networks, "65532:65532",
                    True, ["ALL"], None, ["no-new-privileges:true"],
                    next(iter(networks)),
                ], separators=(",", ":")))
            return ("\n".join(lines) + "\n").encode()

        def admit_runtime_writers(self, _identifiers):
            return None

        def postgres_runtime_observation(self):
            database = self.plan["deployment"]["database"]
            return canonical({
                "system_identifier": database["system_identifier"],
                "databases": [{
                    "name": database["name"], "oid": database["oid"],
                    "marker": database["marker"],
                    "allow_connections": not self.sealed,
                    "connection_limit": 0 if self.sealed else 64,
                    "default_transaction_read_only": self.sealed,
                    "writer_sessions": 0, "prepared_xacts": 0,
                }],
            })

        def discover_volume(self, name):
            return f"{name}\n".encode() if name in self.volume_documents else b""

        @staticmethod
        def parse_volume_discovery(output, expected_name):
            return output == f"{expected_name}\n".encode()

        def inspect_volumes(self, names):
            return canonical(self.volume_documents[names[0]])

        def discover_volume_utility(self, _domain):
            return b""

        def postgres_runtime_seal(self, _database):
            self.calls.append("DATABASE_FENCE")
            self.sealed = True
            return b"COMMIT\n"

        def stop_writers(self, identifiers):
            self.calls.append("WRITER_STOP")
            by_id = {
                item["container_id"]: service
                for service, item in self.plan["candidate"]["services"].items()
            }
            for identifier in identifiers:
                self.running[by_id[identifier]] = False
            return ("\n".join(identifiers) + "\n").encode()

    class Inputs:
        def __init__(self, plan, request, manifest):
            self._plan = plan
            self.request = request
            self.manifest = manifest
            self.package = {
                "sources": {"runtime_adapter_activation": {
                    "sha256": digest("runtime-operation-activation-source"),
                }},
            }

        @property
        def plan(self):
            return self._plan

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(
            prefix="uat-rollback-runtime-operation-", dir="/tmp",
        )
        self.root = Path(self.temporary.name)
        state_parent = self.root / Path(EXECUTOR.HANDLER_STATE_ROOT).parent.relative_to("/")
        state_parent.mkdir(parents=True, mode=0o700)
        os.chmod(state_parent, 0o700)
        fixture_inputs, _base = ActivationCapabilityRuntimeTest.inputs()
        self.plan = copy.deepcopy(fixture_inputs.plan)
        self.plan["candidate"]["protected_resources_sha256"] = \
            fixture_inputs.package["protected_resources_sha256"]
        for service, identity in self.plan["candidate"]["services"].items():
            identity["service"] = service
        self.runner = self.Runner(self.plan)
        self.driver = EXECUTOR.ClosedRuntimeOperationDriver(
            self.runner, clock=lambda: "2026-08-16T02:00:01.000Z",
        )
        self.manifest = {
            "activation": {"receipt_sha256": digest("runtime-operation-activation")},
            "executor": {"sha256": digest("runtime-operation-executor")},
        }

    def tearDown(self):
        self.temporary.cleanup()

    def request(self, action, record_sha256=EXECUTOR.ZERO_SHA256, payload=None):
        return {
            "operation": "ROLLBACK_EXECUTION",
            "operation_id": self.plan["rollback_operation_id"],
            "execution_mode": "RECOVERY" if action != "PREFLIGHT" else "ORIGINAL",
            "action": action, "label": None,
            "request_sha256": digest(f"runtime-operation:{action}:{record_sha256}"),
            "runtime_plan_sha256": self.plan["runtime_plan_sha256"],
            "execution_package_sha256": digest("runtime-operation-package"),
            "source_set_sha256": digest("runtime-operation-sources"),
            "transaction_intent_sha256": digest("runtime-operation-transaction"),
            "context_sha256": digest("runtime-operation-context"),
            "record_intent_sha256": record_sha256,
            "previous_result_sha256": EXECUTOR.ZERO_SHA256,
            "payload": {} if payload is None else payload,
        }

    def containment_intent(self, before):
        body = {
            "schema_version": 1,
            "contract": "chenyida-erp-uat-promotion-rollback-containment-intent/v1",
            "status": "PREPARED", "operation": "ROLLBACK_EXECUTION",
            "operation_id": self.plan["rollback_operation_id"],
            "promotion_id": self.plan["promotion_id"],
            "intent_sha256": digest("runtime-operation-transaction-intent"),
            "execution_package_sha256": digest("runtime-operation-package"),
            "failure_code": "ROLLBACK_CONTROL_RUNTIME_PARTIAL_OR_UNKNOWN",
            "ledger_state": "EMPTY", "last_committed_ordinal": 0,
            "last_committed_label": None,
            "last_committed_record_sha256": EXECUTOR.ZERO_SHA256,
            "containment_attempt": 1,
            "previous_containment_intent_sha256": None,
            "previous_containment_attempt_receipt_sha256": None,
            "runtime_target_state": "PARTIAL_OR_UNKNOWN_REQUIRES_CONTAINMENT",
            "runtime_observation_sha256": before["observation_sha256"],
            "expected_writer_inventory_sha256":
                EXECUTOR.digest_value(before["writer_inventory"]),
            "expected_writer_set_sha256":
                before["writer_inventory"]["writer_set_sha256"],
            "expected_active_generation": before["active_generation"],
            "expected_database_oid": before["database"]["oid"],
            "expected_web_container_id": before["services"]["web"]["container_id"],
            "expected_worker_container_id": before["services"]["worker"]["container_id"],
            "prepared_at": "2026-08-16T02:00:00.000Z",
        }
        return {**body, "containment_intent_sha256": EXECUTOR.digest_value(body)}

    def test_gate_observes_exact_original_and_containment_is_durable_and_replayable(self):
        preflight_request = self.request("PREFLIGHT")
        preflight = self.driver.gate(self.Inputs(
            self.plan, preflight_request, self.manifest,
        ))
        self.assertEqual(preflight["status"], "SAFE_TO_EXECUTE")
        before = preflight["output"]["observed"]
        intent = self.containment_intent(before)
        contain_request = self.request(
            "CONTAIN", intent["containment_intent_sha256"], {
                "record_intent": intent, "containment_intent": intent,
            },
        )
        inputs = self.Inputs(self.plan, contain_request, self.manifest)
        contained = self.driver.contain(inputs, str(self.root))
        self.assertEqual(contained["status"], "CONTAINED")
        self.assertTrue(contained["output"]["observed"]["database"]["sealed"])
        self.assertEqual(
            contained["output"]["observed"]["writer_inventory"]["active_writer_count"], 0,
        )
        self.assertLess(
            self.runner.calls.index("DATABASE_FENCE"), self.runner.calls.index("WRITER_STOP"),
        )
        mutation_calls = [
            item for item in self.runner.calls if item in {"DATABASE_FENCE", "WRITER_STOP"}
        ]
        replay = self.driver.contain(inputs, str(self.root))
        self.assertEqual(replay, contained)
        self.assertEqual([
            item for item in self.runner.calls if item in {"DATABASE_FENCE", "WRITER_STOP"}
        ], mutation_calls)
        probe_request = {**contain_request, "action": "PROBE"}
        probe_inputs = self.Inputs(self.plan, probe_request, self.manifest)
        self.assertEqual(
            self.driver.probe(probe_inputs, str(self.root))["status"], "CONTAINED",
        )
        journal = self.driver._journal(inputs, str(self.root))
        self.assertEqual([event["event"] for event in journal.load()], [
            "CONTAINMENT_STARTED", "SIDE_EFFECT_STARTED", "SIDE_EFFECT_RECORDED",
            "SIDE_EFFECT_STARTED", "SIDE_EFFECT_RECORDED", "CONTAINED",
        ])


class ProtectedResourceRuntimeTest(unittest.TestCase):
    class Driver:
        def __init__(self, protected, runtime_plan):
            self.protected = protected
            self.runtime_plan = runtime_plan
            self.calls = []

        def observe(self, _inputs, volume_evidence):
            self.calls.append(sorted(volume_evidence))
            body = {
                "schema_version": 1,
                "contract": "chenyida-erp-uat-rollback-protected-resource-observation/v1",
                "runtime_plan_sha256": self.runtime_plan,
                "protected_resources_sha256": self.protected,
                "service_set_sha256": digest("protected-service-set"),
                "volumes": {
                    domain: {"fixture_sha256": digest(f"protected-volume:{domain}")}
                    for domain in sorted(volume_evidence)
                },
            }
            return {**body, "observation_sha256": EXECUTOR.digest_value(body)}

    def inputs(self):
        inputs, base = ActivationCapabilityRuntimeTest.inputs()
        protected = inputs.package["protected_resources_sha256"]
        inputs.plan["candidate"]["protected_resources_sha256"] = protected
        activation_driver = ActivationCapabilityRuntimeTest.Driver(inputs, base)
        activation = EXECUTOR.UatRollbackCapabilityRuntime(
            activation_driver=activation_driver,
            release_driver=inputs._release_driver,
            clock=lambda: "2026-08-16T02:00:00.000Z",
        )._execute_activation(inputs, VolumeCapabilityRuntimeTest.Effects())
        inputs.rollback_result["stages"][7]["evidence"] = activation
        candidate_services = {
            name: {
                "container_id": inputs.plan["candidate"]["services"][name]["container_id"],
                "image_id": inputs.plan["candidate"]["services"][name]["image_digest"],
            }
            for name in ("caddy", "postgres")
        }
        deployment = {"protected_resources_after_sha256": protected}
        return inputs, deployment, candidate_services

    def test_read_only_observation_is_bound_into_stage_evidence(self):
        inputs, deployment, services = self.inputs()
        driver = self.Driver(
            inputs.package["protected_resources_sha256"],
            inputs.plan["runtime_plan_sha256"],
        )
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(protected_driver=driver)
        with patch.object(
            EXECUTOR, "_writer_candidate_documents",
            return_value=(deployment, {}, services),
        ):
            evidence = runtime._protected_resource_evidence(inputs)
        self.assertEqual(evidence["before_sha256"], evidence["after_sha256"])
        self.assertNotEqual(evidence["observation_sha256"], EXECUTOR.ZERO_SHA256)
        self.assertEqual(driver.calls, [["attachments", "backup_status", "uploads"]])

    def test_observed_protected_hash_drift_is_rejected(self):
        inputs, deployment, services = self.inputs()
        driver = self.Driver(digest("substituted-protected"), inputs.plan["runtime_plan_sha256"])
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(protected_driver=driver)
        with patch.object(
            EXECUTOR, "_writer_candidate_documents",
            return_value=(deployment, {}, services),
        ), self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_PROTECTED_RESOURCE_INVALID",
        ):
            runtime._protected_resource_evidence(inputs)


class ServiceIdentityRuntimeTest(unittest.TestCase):
    class Driver:
        def __init__(self, observation):
            self.observation = observation
            self.calls = 0

        def observe(self, _inputs):
            self.calls += 1
            return self.observation

    @staticmethod
    def inputs():
        inputs, base = ActivationCapabilityRuntimeTest.inputs()
        activation_driver = ActivationCapabilityRuntimeTest.Driver(inputs, base)
        activation = EXECUTOR.UatRollbackCapabilityRuntime(
            activation_driver=activation_driver,
            release_driver=inputs._release_driver,
            clock=lambda: "2026-08-16T02:00:00.000Z",
        )._execute_activation(inputs, VolumeCapabilityRuntimeTest.Effects())
        inputs.rollback_result["stages"][7]["evidence"] = activation
        inputs._documents["candidate_deployment_result"] = {"fixture": "fd-bound"}
        return inputs, activation_driver.services

    def test_four_current_service_identities_match_activation(self):
        inputs, observation = self.inputs()
        driver = self.Driver(observation)
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(service_driver=driver)
        results = {
            label: runtime._service_identity_evidence(label, inputs)
            for label in (
                "CADDY_IDENTITY", "POSTGRES_IDENTITY", "WEB_IDENTITY", "WORKER_IDENTITY",
            )
        }
        self.assertEqual(driver.calls, 4)
        self.assertEqual(
            results["WEB_IDENTITY"]["image_reference"],
            inputs.plan["predecessor"]["web_image"],
        )
        self.assertEqual(
            results["POSTGRES_IDENTITY"]["container_id"],
            inputs.plan["candidate"]["services"]["postgres"]["container_id"],
        )

    def test_current_container_substitution_is_rejected(self):
        inputs, observation = self.inputs()
        drifted = copy.deepcopy(observation)
        next(item for item in drifted["services"] if item["service"] == "web")[
            "container_id"
        ] = digest("substituted-current-web")
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            service_driver=self.Driver(drifted),
        )
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_SERVICE_IDENTITY_DRIFT",
        ):
            runtime._service_identity_evidence("WEB_IDENTITY", inputs)


class MetadataPostverifyRuntimeTest(unittest.TestCase):
    @staticmethod
    def inputs():
        inputs, base = ActivationCapabilityRuntimeTest.inputs()
        activation_driver = ActivationCapabilityRuntimeTest.Driver(inputs, base)
        activation = EXECUTOR.UatRollbackCapabilityRuntime(
            activation_driver=activation_driver,
            release_driver=inputs._release_driver,
            clock=lambda: "2026-08-16T02:00:00.000Z",
        )._execute_activation(inputs, VolumeCapabilityRuntimeTest.Effects())
        rollback = inputs.rollback_result
        rollback["stages"][7]["evidence"] = activation
        configuration = EXECUTOR.derive_rollback_runtime_configuration(inputs)
        rollback.update({
            "predecessor_runtime_configuration_sha256":
                inputs.package["predecessor"]["runtime_configuration_sha256"],
            "rollback_runtime_configuration_sha256":
                configuration["rollback_runtime_configuration_sha256"],
            "rollback_runtime_projection_sha256":
                configuration["rollback_runtime_projection_sha256"],
            "compose_rollback_overlay_sha256":
                configuration["compose_rollback_overlay_sha256"],
        })
        protected = inputs.package["protected_resources_sha256"]
        rollback["stages"][8]["evidence"] = EXECUTOR.validate_handler_evidence(
            "ROLLBACK_EXECUTION", "PROTECTED_RESOURCE_RECHECK", {
                "before_sha256": protected, "after_sha256": protected,
                "runtime_plan_sha256": inputs.package["runtime_plan_sha256"],
                "observation_sha256": digest("metadata-protected-observation"),
            },
        )
        return inputs

    def test_three_metadata_checks_prepare_and_probe_from_bound_stage_evidence(self):
        inputs = self.inputs()
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            release_driver=inputs._release_driver,
        )
        outcomes = {}
        for label in METADATA_LABELS:
            with self.subTest(label=label):
                runtime.prepare(label, inputs, [])
                evidence = runtime.probe(
                    label, inputs, [], VolumeCapabilityRuntimeTest.Effects(),
                )["evidence"]
                outcomes[label] = evidence
                self.assertEqual(
                    EXECUTOR.validate_handler_evidence(
                        "ROLLBACK_POSTVERIFY", label, evidence,
                    ),
                    evidence,
                )
        self.assertEqual(
            outcomes["RUNTIME_CONFIGURATION"][
                "rollback_runtime_configuration_sha256"
            ],
            inputs.rollback_result["rollback_runtime_configuration_sha256"],
        )
        self.assertEqual(
            outcomes["STRICT_RELEASE_IDENTITY"]["release_identity_sha256"],
            inputs.rollback_result["stages"][7]["evidence"][
                "release_identity_sha256"
            ],
        )
        self.assertEqual(
            outcomes["PROTECTED_RESOURCES"]["before_sha256"],
            inputs.package["protected_resources_sha256"],
        )

    def test_runtime_configuration_stage_projection_drift_is_rejected(self):
        inputs = self.inputs()
        inputs.rollback_result["stages"][6]["evidence"][
            "rollback_runtime_projection_sha256"
        ] = digest("substituted-runtime-projection")
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_RUNTIME_CONFIGURATION_DRIFT",
        ):
            EXECUTOR.UatRollbackCapabilityRuntime().prepare(
                "RUNTIME_CONFIGURATION", inputs, [],
            )

    def test_self_consistent_release_identity_substitution_is_rejected(self):
        inputs = self.inputs()
        activation = inputs.rollback_result["stages"][7]["evidence"]
        identity = json.loads(activation["release_identity_json"])
        identity["authorization_sha256"] = digest("substituted-release-authorization")
        identity_json = EXECUTOR.canonical(identity).decode("utf-8")
        activation["release_identity_json"] = identity_json
        activation["release_identity_sha256"] = hashlib.sha256(
            identity_json.encode("utf-8"),
        ).hexdigest()
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_RELEASE_IDENTITY_DRIFT",
        ):
            EXECUTOR.UatRollbackCapabilityRuntime(
                release_driver=inputs._release_driver,
            ).probe(
                "STRICT_RELEASE_IDENTITY", inputs, [],
                VolumeCapabilityRuntimeTest.Effects(),
            )

    def test_predecessor_manifest_source_substitution_is_rejected(self):
        inputs = self.inputs()
        inputs._documents["predecessor_release_manifest"]["source"][
            "package_version"
        ] = "0.1.0-alpha.48"
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_RELEASE_IDENTITY_DRIFT",
        ):
            EXECUTOR.UatRollbackCapabilityRuntime(
                release_driver=inputs._release_driver,
            ).prepare(
                "STRICT_RELEASE_IDENTITY", inputs, [],
            )

    def test_protected_stage_runtime_plan_substitution_is_rejected(self):
        inputs = self.inputs()
        inputs.rollback_result["stages"][8]["evidence"][
            "runtime_plan_sha256"
        ] = digest("substituted-protected-runtime-plan")
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_PROTECTED_RESOURCE_INVALID",
        ):
            EXECUTOR.UatRollbackCapabilityRuntime().probe(
                "PROTECTED_RESOURCES", inputs, [],
                VolumeCapabilityRuntimeTest.Effects(),
            )


class HealthPostverifyRuntimeTest(unittest.TestCase):
    class Driver:
        def __init__(self, services, readiness, mounted_release_identity):
            self.services = services
            self.readiness = readiness
            self.mounted_release_identity = mounted_release_identity
            self.calls = 0

        def observe(self, _inputs):
            self.calls += 1
            return {
                "services": copy.deepcopy(self.services),
                "readiness": copy.deepcopy(self.readiness),
                "mounted_release_identity": self.mounted_release_identity,
            }

    @staticmethod
    def inputs():
        inputs = MetadataPostverifyRuntimeTest.inputs()
        inputs._documents["candidate_deployment_result"] = {"fixture": "fd-bound"}
        activation = inputs.rollback_result["stages"][7]["evidence"]
        return inputs, HealthPostverifyRuntimeTest.Driver(
            ActivationCapabilityRuntimeTest.service_observation(inputs),
            ActivationCapabilityRuntimeTest.readiness(inputs),
            activation["release_identity_json"].encode("utf-8"),
        )

    def test_health_uses_response_completion_time_and_three_independent_readbacks(self):
        inputs, driver = self.inputs()
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            health_driver=driver, release_driver=inputs._release_driver,
            clock=lambda: "2026-08-16T02:00:01.000Z",
        )
        runtime.prepare("HEALTH", inputs, [])
        evidence = runtime.probe(
            "HEALTH", inputs, [], VolumeCapabilityRuntimeTest.Effects(),
        )["evidence"]
        self.assertEqual(driver.calls, 2)
        self.assertEqual(evidence["checked_at"], "2026-08-16T02:00:01.000Z")
        self.assertEqual(
            evidence["readiness"]["database_time"],
            "2026-08-16T02:00:00.000Z",
        )
        self.assertNotEqual(evidence["checked_at"], evidence["readiness"]["database_time"])
        self.assertEqual(
            evidence["release_identity_sha256"],
            inputs.rollback_result["stages"][7]["evidence"]["release_identity_sha256"],
        )
        self.assertEqual(
            EXECUTOR.validate_handler_evidence(
                "ROLLBACK_POSTVERIFY", "HEALTH", evidence,
            ),
            evidence,
        )

    def test_stale_database_time_is_rejected(self):
        inputs, driver = self.inputs()
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            health_driver=driver, release_driver=inputs._release_driver,
            clock=lambda: "2026-08-16T02:00:06.000Z",
        )
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_HEALTH_FRESHNESS_INVALID",
        ):
            runtime.probe("HEALTH", inputs, [], VolumeCapabilityRuntimeTest.Effects())

    def test_self_consistent_mounted_identity_substitution_is_rejected(self):
        inputs, driver = self.inputs()
        identity = json.loads(driver.mounted_release_identity)
        identity["authorization_sha256"] = digest("mounted-identity-substitution")
        driver.mounted_release_identity = canonical(identity)
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            health_driver=driver, release_driver=inputs._release_driver,
            clock=lambda: "2026-08-16T02:00:01.000Z",
        )
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_HEALTH_RELEASE_IDENTITY_DRIFT",
        ):
            runtime.probe("HEALTH", inputs, [], VolumeCapabilityRuntimeTest.Effects())

    def test_current_service_substitution_is_rejected(self):
        inputs, driver = self.inputs()
        next(
            item for item in driver.services["services"] if item["service"] == "worker"
        )["container_id"] = digest("health-substituted-worker")
        runtime = EXECUTOR.UatRollbackCapabilityRuntime(
            health_driver=driver, release_driver=inputs._release_driver,
            clock=lambda: "2026-08-16T02:00:01.000Z",
        )
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_SERVICE_IDENTITY_DRIFT",
        ):
            runtime.probe("HEALTH", inputs, [], VolumeCapabilityRuntimeTest.Effects())

    def test_only_the_complete_current_health_shape_is_accepted(self):
        inputs, _driver = self.inputs()
        readiness = ActivationCapabilityRuntimeTest.readiness(inputs)
        response = {
            "ok": True, "status": "READY", "database": "postgresql",
            "storage": "local", "worker": "postgresql-jobs",
            "deployment_class": readiness["deployment_class"],
            "deployment_id": readiness["deployment_id"],
            "version": readiness["version"], "revision": readiness["revision"],
            "migration_head": readiness["migration_head"],
            "migration_manifest_sha256": readiness["migration_manifest_sha256"],
            "components": readiness["components"], "time": readiness["database_time"],
        }
        self.assertEqual(
            EXECUTOR.parse_health_readiness_response(canonical(response)), readiness,
        )
        del response["migration_manifest_sha256"]
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError,
            "ROLLBACK_FIXED_EXECUTOR_HEALTH_RESPONSE_INVALID",
        ):
            EXECUTOR.parse_health_readiness_response(canonical(response))


class ClosedDockerRunnerTest(unittest.TestCase):
    def test_execution_observer_is_opt_in_and_default_path_does_not_hash_stdin(self):
        descriptor = os.open("/usr/bin/echo", os.O_RDONLY)
        try:
            runner = EXECUTOR.ClosedDockerRunner(
                descriptor, docker_runner_plan(), action_deadline=TEST_ACTION_DEADLINE,
            )
            stdin_fd = runner._sealed_input(b"SELECT true;\n", "observer-off", 1024)
            try:
                with patch.object(
                        EXECUTOR, "sha256_fd",
                        side_effect=AssertionError("default path hashed stdin"),
                ):
                    self.assertEqual(
                        runner._call(
                            ["version"], stdin_fd=stdin_fd,
                            effectful=True, observe_execution=True,
                        ),
                        b"version\n",
                    )
            finally:
                os.close(stdin_fd)

            events = []
            observed = EXECUTOR.ClosedDockerRunner(
                descriptor, docker_runner_plan(), action_deadline=TEST_ACTION_DEADLINE,
                execution_observer=lambda value: events.append(value),
            )
            output = observed.postgres_psql("CONTROL_DATABASE_IDENTITY")
            self.assertIn(b"PGAPPNAME=cyd_rb_deadbeefdeadbeef_controlidentity", output)
            self.assertEqual(events, [])
        finally:
            os.close(descriptor)

    def test_execution_observer_records_completed_results_and_preserves_unknown(self):
        with tempfile.TemporaryDirectory(prefix="uat-rollback-observer-", dir="/tmp") as root:
            executable = Path(root) / "docker-observer.py"
            executable.write_text(
                "#!/usr/bin/python3\n"
                "import sys, time\n"
                "raw = sys.stdin.buffer.read()\n"
                "mode = sys.argv[1]\n"
                "if mode == 'success': sys.stdout.buffer.write(b't\\n')\n"
                "elif mode == 'fatal':\n"
                " sys.stderr.write('psql: fatal\\n'); sys.exit(2)\n"
                "elif mode == 'marker':\n"
                " sys.stdout.write('guarded switch runtime privilege mismatch\\n'); sys.exit(3)\n",
                encoding="utf-8",
            )
            executable.chmod(0o555)
            descriptor = os.open(executable, os.O_RDONLY)
            try:
                events = []
                runner = EXECUTOR.ClosedDockerRunner(
                    descriptor, docker_runner_plan(), action_deadline=TEST_ACTION_DEADLINE,
                    execution_observer=lambda value: events.append(value),
                )
                for mode, return_code in (("success", 0), ("fatal", 2), ("marker", 3)):
                    stdin_fd = runner._sealed_input(
                        b"SELECT true;\n", f"observer-{mode}", 1024,
                    )
                    try:
                        if return_code == 0:
                            self.assertEqual(runner._call(
                                [mode], stdin_fd=stdin_fd, effectful=True,
                                observe_execution=True,
                            ), b"t\n")
                        else:
                            with self.assertRaises(EXECUTOR.HandlerOutcomeUnknown) as raised:
                                runner._call(
                                    [mode], stdin_fd=stdin_fd, effectful=True,
                                    observe_execution=True,
                                )
                            self.assertEqual(
                                raised.exception.reason_code,
                                "SIDE_EFFECT_OUTCOME_UNKNOWN",
                            )
                    finally:
                        os.close(stdin_fd)
                    self.assertEqual(events[-1]["return_code"], return_code)
                    self.assertEqual(events[-1]["stdin_bytes"], len(b"SELECT true;\n"))
                    self.assertEqual(
                        events[-1]["stdin_sha256"], digest(b"SELECT true;\n"),
                    )
                    self.assertEqual(
                        events[-1]["daemon_state"],
                        "COMPLETED_NO_UNTRACKED_PROCESS",
                    )
                self.assertEqual(len(events), 3)

                rejecting = EXECUTOR.ClosedDockerRunner(
                    descriptor, docker_runner_plan(), action_deadline=TEST_ACTION_DEADLINE,
                    execution_observer=lambda _value: (_ for _ in ()).throw(
                        RuntimeError("observer failed"),
                    ),
                )
                stdin_fd = rejecting._sealed_input(
                    b"SELECT true;\n", "observer-reject", 1024,
                )
                try:
                    with self.assertRaises(EXECUTOR.HandlerOutcomeUnknown) as raised:
                        rejecting._call(
                            ["success"], stdin_fd=stdin_fd, effectful=True,
                            observe_execution=True,
                        )
                    self.assertEqual(
                        raised.exception.reason_code, "SIDE_EFFECT_OUTCOME_UNKNOWN",
                    )
                    self.assertTrue(raised.exception.side_effects_started)
                finally:
                    os.close(stdin_fd)
            finally:
                os.close(descriptor)

    def test_execution_observer_does_not_record_incomplete_tool_outcomes(self):
        with tempfile.TemporaryDirectory(prefix="uat-rollback-observer-incomplete-", dir="/tmp") as root:
            executable = Path(root) / "docker-incomplete.py"
            executable.write_text(
                "#!/usr/bin/python3\n"
                "import sys, time\n"
                "if sys.argv[1] == 'timeout': time.sleep(2)\n"
                "else: sys.stdout.write('x' * 4096)\n",
                encoding="utf-8",
            )
            executable.chmod(0o555)
            descriptor = os.open(executable, os.O_RDONLY)
            try:
                events = []
                runner = EXECUTOR.ClosedDockerRunner(
                    descriptor, docker_runner_plan(), action_deadline=TEST_ACTION_DEADLINE,
                    execution_observer=lambda value: events.append(value),
                )
                with self.assertRaises(EXECUTOR.HandlerOutcomeUnknown) as timeout:
                    runner._call(
                        ["timeout"], timeout_seconds=0.1, effectful=True,
                        observe_execution=True,
                    )
                self.assertEqual(timeout.exception.reason_code, "TOOL_TIMEOUT")
                with self.assertRaises(EXECUTOR.HandlerOutcomeUnknown) as output:
                    runner._call(
                        ["output"], maximum_output=32, effectful=True,
                        observe_execution=True,
                    )
                self.assertEqual(output.exception.reason_code, "TOOL_OUTPUT_LIMIT")
                self.assertEqual(events, [])
            finally:
                os.close(descriptor)

    def test_verified_descriptor_is_invoked_without_shell_or_path_lookup(self):
        descriptor = os.open("/usr/bin/echo", os.O_RDONLY)
        try:
            plan = docker_runner_plan()
            runner = EXECUTOR.ClosedDockerRunner(
                descriptor, plan, action_deadline=TEST_ACTION_DEADLINE,
            )
            container_id = plan["candidate"]["services"]["web"]["container_id"]
            output = runner.inspect_containers([container_id])
            self.assertEqual(
                output,
                (
                    "inspect --type container --format "
                    f"{EXECUTOR.ClosedDockerRunner.CONTAINER_INSPECT_FORMAT} -- {container_id}\n"
                ).encode(),
            )
        finally:
            os.close(descriptor)

    def test_health_reads_only_the_admitted_web_container_with_fixed_node_sources(self):
        descriptor = os.open("/usr/bin/echo", os.O_RDONLY)
        try:
            runner = EXECUTOR.ClosedDockerRunner(
                descriptor, docker_runner_plan(), action_deadline=TEST_ACTION_DEADLINE,
            )
            web_id = digest("health-admitted-web")
            runner.pending_container_ids.add(web_id)
            runner.admit_predecessor_writers([web_id])
            self.assertEqual(
                runner.inspect_web_readiness(web_id),
                (
                    f"exec -- {web_id} /usr/local/bin/node -e "
                    f"{EXECUTOR.ClosedDockerRunner.READINESS_NODE_SOURCE}\n"
                ).encode(),
            )
            self.assertEqual(
                runner.read_mounted_release_identity(web_id),
                (
                    f"exec -- {web_id} /usr/local/bin/node -e "
                    f"{EXECUTOR.ClosedDockerRunner.RELEASE_IDENTITY_NODE_SOURCE}\n"
                ).encode(),
            )
            with self.assertRaisesRegex(
                EXECUTOR.FixedExecutorError,
                "ROLLBACK_FIXED_EXECUTOR_HEALTH_CONTAINER_INVALID",
            ):
                runner.inspect_web_readiness(digest("health-unadmitted-web"))
        finally:
            os.close(descriptor)

    def test_free_argv_unknown_targets_and_protected_stop_are_rejected(self):
        descriptor = os.open("/usr/bin/echo", os.O_RDONLY)
        try:
            plan = docker_runner_plan()
            runner = EXECUTOR.ClosedDockerRunner(
                descriptor, plan, action_deadline=TEST_ACTION_DEADLINE,
            )
            self.assertFalse(hasattr(runner, "run"))
            with self.assertRaisesRegex(
                EXECUTOR.FixedExecutorError, "ROLLBACK_FIXED_EXECUTOR_DOCKER_ARGV_INVALID",
            ):
                runner._run_generated(["system", "prune"])
            with self.assertRaisesRegex(
                EXECUTOR.FixedExecutorError, "ROLLBACK_FIXED_EXECUTOR_CONTAINER_TARGET_INVALID",
            ):
                runner.inspect_containers(["f" * 64])
            caddy = plan["candidate"]["services"]["caddy"]["container_id"]
            with self.assertRaisesRegex(
                EXECUTOR.FixedExecutorError, "ROLLBACK_FIXED_EXECUTOR_WRITER_TARGET_INVALID",
            ):
                runner.stop_writers([caddy])
        finally:
            os.close(descriptor)

    def test_output_limit_terminates_the_tool_and_returns_typed_unknown(self):
        with tempfile.TemporaryDirectory(prefix="uat-rollback-runner-output-", dir="/tmp") as root:
            executable = Path(root) / "unbounded-output.py"
            executable.write_text(
                "#!/usr/bin/python3\nimport sys\nsys.stdout.write('x' * (2 * 1024 * 1024))\n",
                encoding="utf-8",
            )
            executable.chmod(0o555)
            descriptor = os.open(executable, os.O_RDONLY)
            try:
                plan = docker_runner_plan()
                runner = EXECUTOR.ClosedDockerRunner(
                    descriptor, plan, action_deadline=TEST_ACTION_DEADLINE,
                )
                container_id = plan["candidate"]["services"]["web"]["container_id"]
                with self.assertRaises(EXECUTOR.HandlerOutcomeUnknown) as raised:
                    runner.inspect_containers([container_id])
                self.assertEqual(raised.exception.reason_code, "TOOL_OUTPUT_LIMIT")
                self.assertFalse(raised.exception.side_effects_started)
            finally:
                os.close(descriptor)

    def test_successful_cli_exit_with_detached_process_group_member_is_unknown(self):
        with tempfile.TemporaryDirectory(prefix="uat-rollback-runner-daemon-", dir="/tmp") as root:
            executable = Path(root) / "daemon.py"
            group_marker = Path(root) / "group-id"
            executable.write_text(
                "#!/usr/bin/python3\n"
                "import os, signal, time\n"
                "if os.fork() == 0:\n"
                "    signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
                f"    open({str(group_marker)!r}, 'w').write(str(os.getpgrp()))\n"
                "    os.close(0); os.close(1); os.close(2)\n"
                "    time.sleep(10)\n"
                "    os._exit(0)\n"
                "os._exit(0)\n",
                encoding="utf-8",
            )
            executable.chmod(0o555)
            descriptor = os.open(executable, os.O_RDONLY)
            try:
                plan = docker_runner_plan()
                runner = EXECUTOR.ClosedDockerRunner(
                    descriptor, plan, action_deadline=TEST_ACTION_DEADLINE,
                )
                with self.assertRaises(EXECUTOR.HandlerOutcomeUnknown) as raised:
                    runner.inspect_containers([
                        plan["candidate"]["services"]["web"]["container_id"],
                    ])
                self.assertEqual(raised.exception.reason_code, "TOOL_DAEMON_LEFT_RUNNING")
                self.assertFalse(raised.exception.side_effects_started)
                group_id = int(group_marker.read_text(encoding="utf-8"))
                deadline = time.monotonic() + 1
                while runner._group_exists(group_id) and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertFalse(runner._group_exists(group_id))
            finally:
                os.close(descriptor)

    def test_postgresql_opcodes_use_sealed_sql_and_rewind_bound_custom_dump(self):
        with tempfile.TemporaryDirectory(prefix="uat-rollback-postgres-runner-", dir="/tmp") as root:
            executable = Path(root) / "docker-probe.py"
            executable.write_text(
                "#!/usr/bin/python3\n"
                "import fcntl, json, os, sys\n"
                "raw = sys.stdin.buffer.read()\n"
                "try:\n"
                "    seals = fcntl.fcntl(0, fcntl.F_GET_SEALS) if raw else 0\n"
                "except OSError:\n"
                "    seals = -1\n"
                "payload = {'argv': sys.argv[1:], 'stdin': raw.decode('latin1'), "
                "'seals': seals, "
                "'environment': dict(os.environ)}\n"
                "sys.stdout.write(json.dumps(payload, sort_keys=True))\n",
                encoding="utf-8",
            )
            executable.chmod(0o555)
            descriptor = os.open(executable, os.O_RDONLY)
            dump = Path(root) / "snapshot.dump"
            dump.write_bytes(b"PGDMP-bound-custom-dump")
            dump.chmod(0o400)
            dump_fd = os.open(dump, os.O_RDONLY)
            try:
                runner = EXECUTOR.ClosedDockerRunner(
                    descriptor, docker_runner_plan(),
                    action_deadline=TEST_ACTION_DEADLINE,
                )
                sql = b"SELECT current_database(), current_setting('server_version_num');\n"
                observed = json.loads(runner.postgres_psql("CONTROL_DATABASE_IDENTITY"))
                self.assertEqual(observed["stdin"].encode("latin1"), sql)
                expected_seals = (
                    fcntl.F_SEAL_SEAL | fcntl.F_SEAL_SHRINK
                    | fcntl.F_SEAL_GROW | fcntl.F_SEAL_WRITE
                )
                self.assertEqual(observed["seals"], expected_seals)
                self.assertIn("--no-password", observed["argv"])
                self.assertEqual(observed["environment"]["LC_ALL"], "C")
                self.assertEqual(observed["environment"]["LANG"], "C")
                with self.assertRaisesRegex(
                    EXECUTOR.FixedExecutorError,
                    "ROLLBACK_FIXED_EXECUTOR_POSTGRES_OPCODE_INVALID",
                ):
                    runner.postgres_psql("ARBITRARY_CALLER_SQL")

                pg_inputs = PostgresRollbackBaseSpecTest.inputs()
                pg_base = EXECUTOR.derive_pg_rollback_base_spec(pg_inputs)
                pg_bindings = {
                    "journal_state_sha256": digest("runner-pg-journal"),
                    "observation_scope_sha256": digest("runner-pg-observation"),
                }
                pg_spec = EXECUTOR.derive_pg_opcode_spec(
                    pg_base, "PG_RB_OBSERVE_STATE_V1", pg_bindings,
                )
                bound_runner = EXECUTOR.ClosedDockerRunner(
                    descriptor, pg_inputs.plan, action_deadline=TEST_ACTION_DEADLINE,
                )
                live_observation = json.loads(
                    bound_runner.postgres_sql_opcode(pg_base, pg_spec),
                )
                self.assertEqual(
                    hashlib.sha256(live_observation["stdin"].encode("latin1")).hexdigest(),
                    pg_spec["sql_sha256"],
                )
                self.assertIn("PGAPPNAME=cyd_rb_deadbeefdeadbeef_observe",
                              live_observation["argv"])
                self.assertIn("--dbname=postgres", live_observation["argv"])
                self.assertEqual(live_observation["seals"], expected_seals)

                os.lseek(dump_fd, 7, os.SEEK_SET)
                dump_sha256 = hashlib.sha256(dump.read_bytes()).hexdigest()
                listed = json.loads(runner.postgres_restore_list(
                    dump_fd, dump_sha256, dump.stat().st_size,
                ))
                self.assertEqual(listed["stdin"].encode("latin1"), dump.read_bytes())
                self.assertIn("--format=custom", listed["argv"])
                self.assertIn("--no-password", listed["argv"])
                self.assertIn("LC_ALL=C", listed["argv"])
                self.assertIn("LANG=C", listed["argv"])

                os.lseek(dump_fd, 11, os.SEEK_SET)
                restored = json.loads(runner.postgres_restore_staging(
                    dump_fd, dump_sha256, dump.stat().st_size,
                ))
                self.assertEqual(restored["stdin"].encode("latin1"), dump.read_bytes())
                self.assertIn("--format=custom", restored["argv"])
                self.assertIn("--single-transaction", restored["argv"])
                self.assertIn("--no-password", restored["argv"])
                self.assertIn("--no-tablespaces", restored["argv"])
                with self.assertRaisesRegex(
                    EXECUTOR.FixedExecutorError,
                    "ROLLBACK_FIXED_EXECUTOR_POSTGRES_DUMP_INVALID",
                ):
                    runner.postgres_restore_list(
                        dump_fd, digest("substituted-dump"), dump.stat().st_size,
                    )

                capacity = json.loads(runner.postgres_capacity())
                self.assertIn("--output=avail", capacity["argv"])
                self.assertIn("/var/lib/postgresql/data", capacity["argv"])
            finally:
                os.close(dump_fd)
                os.close(descriptor)

    def test_postverify_postgres_opcodes_pin_sql_variables_database_and_output_limits(self):
        descriptor = os.open("/usr/bin/echo", os.O_RDONLY)
        try:
            inputs = PostgresRollbackBaseSpecTest.inputs()
            base = EXECUTOR.derive_pg_rollback_base_spec(inputs)
            runner = EXECUTOR.ClosedDockerRunner(
                descriptor, inputs.plan, action_deadline=TEST_ACTION_DEADLINE,
            )
            captures = []

            def capture(arguments, *, stdin_fd=None, **options):
                os.lseek(stdin_fd, 0, os.SEEK_SET)
                raw = os.read(stdin_fd, 1024 * 1024)
                captures.append((arguments, raw, options))
                return b"fixture\n"

            with patch.object(runner, "_call", side_effect=capture):
                runner.postgres_postverify_content(base)
                runner.postgres_postverify_security(base, inputs)
                runner.postgres_postverify_migrations(base["databases"]["active_name"])
                runner.postgres_postverify_sessions(base["databases"]["active_name"])
                runner.postgres_postverify_identity(base["databases"]["active_name"])
            self.assertEqual(len(captures), 5)
            self.assertEqual(
                captures[0][1],
                (SITE_ROOT / "scripts/backup-reconciliation.sql").read_bytes(),
            )
            self.assertEqual(
                captures[0][2]["maximum_output"],
                EXECUTOR.POSTGRES_CONTENT_REPORT_MAX_BYTES,
            )
            self.assertEqual(
                captures[1][1],
                (SITE_ROOT / "scripts/postgresql-runtime-privilege-state.sql").read_bytes(),
            )
            security_argv = captures[1][0]
            expected_variables = {
                "--set=controlled_runtime_mode=1",
                f"--set=expected_database={base['databases']['active_name']}",
                f"--set=expected_marker={base['databases']['candidate_marker']}",
                "--set=expected_system_identifier="
                    f"{base['postgres']['system_identifier']}",
                f"--set=migration_owner={base['security']['database_owner']}",
            }
            self.assertTrue(expected_variables.issubset(set(security_argv)))
            for arguments, raw, options in captures:
                self.assertIn(f"--dbname={base['databases']['active_name']}", arguments)
                self.assertIn("--no-password", arguments)
                self.assertIn("--set=ON_ERROR_STOP=on", arguments)
                self.assertTrue(raw.endswith(b"\n"))
                self.assertFalse(options["effectful"])
        finally:
            os.close(descriptor)

    def test_volume_helper_opcodes_are_pinned_isolated_and_rewind_the_archive(self):
        with tempfile.TemporaryDirectory(prefix="uat-rollback-volume-runner-", dir="/tmp") as root:
            executable = Path(root) / "docker-probe.py"
            executable.write_text("#!/usr/bin/python3\nraise SystemExit(1)\n", encoding="utf-8")
            executable.chmod(0o555)
            descriptor = os.open(executable, os.O_RDONLY)
            archive = Path(root) / "uploads.tar.gz"
            archive.write_bytes(b"bound-archive-bytes")
            archive.chmod(0o400)
            archive_fd = os.open(archive, os.O_RDONLY)
            try:
                plan = docker_runner_plan()
                runner = EXECUTOR.ClosedDockerRunner(
                    descriptor, plan, action_deadline=TEST_ACTION_DEADLINE,
                )
                helper_plan = plan["helpers"]["volume_restore"]
                helper = helper_plan["image_reference"]
                target = plan["targets"]["volumes"]["uploads"]["target"]
                candidate = plan["candidate"]["volumes"]["uploads"]["name"]
                utility = plan["targets"]["volumes"]["uploads"]["utility_container"]
                image_labels = {
                    "org.opencontainers.image.version": helper_plan["application_version"],
                    "org.opencontainers.image.revision": helper_plan["git_commit"],
                    "io.chenyida.erp.git-tree": helper_plan["git_tree"],
                    "io.chenyida.erp.image-role": "volume-restore-helper",
                    "io.chenyida.erp.volume-helper.protocol":
                        "chenyida-erp-volume-helper/v1",
                    "io.chenyida.erp.volume-helper.toolchain-contract-sha256":
                        helper_plan["contract_sha256"],
                }
                image_observation = [
                    helper_plan["image_config_digest"], "linux", "amd64", [helper],
                    image_labels, "0:0", [EXECUTOR.VOLUME_HELPER_ENTRYPOINT],
                    ["unsupported"], "/", "layers", [f"sha256:{digest('helper-layer')}"],
                ]
                with patch.object(
                    runner, "_call", return_value=json.dumps(image_observation).encode(),
                ) as image_call:
                    observed = runner.inspect_volume_helper_image()
                self.assertIn(EXECUTOR.ClosedDockerRunner.VOLUME_HELPER_IMAGE_INSPECT_FORMAT,
                              image_call.call_args.args[0])
                self.assertNotEqual(
                    runner.admit_volume_helper_image(observed), EXECUTOR.ZERO_SHA256,
                )

                def utility_observation(domain, identifier, status):
                    spec = runner.pending_utility_specs.get(domain) \
                        or runner.admitted_utility_specs[domain]
                    volume_utility = plan["targets"]["volumes"][domain]["utility_container"]
                    labels = {
                        **image_labels,
                        "chenyida.erp.uat-rollback-domain": domain,
                        "chenyida.erp.uat-rollback-helper-config":
                            helper_plan["image_config_digest"],
                        "chenyida.erp.uat-rollback-helper-opcode": spec["opcode"],
                        "chenyida.erp.uat-rollback-operation": plan["rollback_operation_id"],
                        "chenyida.erp.uat-rollback-runtime-plan": plan["runtime_plan_sha256"],
                        "chenyida.erp.uat-rollback-volume-generation":
                            spec["volume_generation"],
                        "chenyida.erp.uat-rollback-volume-name": spec["volume_name"],
                    }
                    mount = {
                        "Type": "volume", "Name": spec["volume_name"],
                        "Destination": "/target", "RW": not spec["read_only"],
                        "Driver": "local", "Mode": "", "Propagation": "",
                    }
                    caps = [f"CAP_{item}" for item in spec["cap_add"]] or None
                    return [
                        identifier, f"/{volume_utility}", helper_plan["image_config_digest"],
                        helper, labels, status, 0, None, 0, False, [mount], "0:0",
                        [EXECUTOR.VOLUME_HELPER_ENTRYPOINT],
                        [spec["opcode"], *spec["arguments"]], "/",
                        spec["stdin_required"], True, ["ALL"], caps,
                        ["no-new-privileges"], "none", 64, 268435456, 268435456,
                        1_000_000_000, {"Name": "no", "MaximumRetryCount": 0},
                        False, False, [],
                    ]

                capacity_id = digest("capacity-volume-utility")
                with patch.object(
                    runner, "_call", return_value=f"{capacity_id}\n".encode(),
                ) as create_call:
                    self.assertEqual(
                        runner.create_volume_utility("uploads", "capacity"), capacity_id,
                    )
                create_argv = create_call.call_args.args[0]
                self.assertEqual(create_argv[0], "create")
                self.assertNotIn("run", create_argv)
                self.assertNotIn("--rm", create_argv)
                self.assertNotIn("--entrypoint", create_argv)
                self.assertIn("--pull", create_argv)
                self.assertIn("never", create_argv)
                self.assertIn("--network", create_argv)
                self.assertIn("none", create_argv)
                self.assertIn("--cap-drop", create_argv)
                self.assertIn("ALL", create_argv)
                self.assertIn("no-new-privileges=true", create_argv)
                self.assertIn(
                    f"type=volume,src={candidate},dst=/target,volume-nocopy,readonly",
                    create_argv,
                )
                self.assertNotIn("--interactive", create_argv)
                self.assertEqual(create_argv[-2:], [helper, "capacity"])
                with patch.object(
                    runner, "_call",
                    return_value=json.dumps(
                        utility_observation("uploads", capacity_id, "created"),
                    ).encode(),
                ) as inspect_call:
                    capacity_inspection = runner.inspect_volume_utility("uploads")
                self.assertIn(
                    EXECUTOR.ClosedDockerRunner.VOLUME_UTILITY_INSPECT_FORMAT,
                    inspect_call.call_args.args[0],
                )
                self.assertNotEqual(
                    runner.admit_volume_utility("uploads", capacity_inspection),
                    EXECUTOR.ZERO_SHA256,
                )
                with patch.object(
                    runner, "_call",
                    return_value=(b"Filesystem Avail Inodes IFree\n/dev/data 1 2 1\n"),
                ) as start_call:
                    runner.volume_capacity("uploads")
                self.assertEqual(
                    start_call.call_args.args[0], ["start", "--attach", "--", capacity_id],
                )
                self.assertNotEqual(
                    runner.verify_volume_utility_exited(
                        "uploads", json.dumps(
                            utility_observation("uploads", capacity_id, "exited"),
                        ).encode(),
                    ),
                    EXECUTOR.ZERO_SHA256,
                )
                with patch.object(runner, "_call", return_value=f"{capacity_id}\n".encode()):
                    runner.remove_volume_utility("uploads")
                runner.verify_volume_utility_removed("uploads", b"")

                os.lseek(archive_fd, 5, os.SEEK_SET)
                restore_id = digest("restore-volume-utility")
                with patch.object(
                    runner, "_call", return_value=f"{restore_id}\n".encode(),
                ) as restore_create:
                    runner.create_volume_utility("uploads", "restore")
                restore_create_argv = restore_create.call_args.args[0]
                self.assertIn("--interactive", restore_create_argv)
                self.assertIn(
                    f"type=volume,src={target},dst=/target,volume-nocopy",
                    restore_create_argv,
                )
                self.assertNotIn("readonly", restore_create_argv)
                self.assertEqual(restore_create_argv[-2:], [helper, "restore"])
                runner.admit_volume_utility(
                    "uploads", json.dumps(
                        utility_observation("uploads", restore_id, "created"),
                    ).encode(),
                )
                with self.assertRaisesRegex(
                    EXECUTOR.FixedExecutorError,
                    "ROLLBACK_FIXED_EXECUTOR_DOCKER_STDIN_INVALID",
                ):
                    runner.restore_volume_archive("uploads", archive_fd, digest("wrong-archive"))
                os.lseek(archive_fd, 7, os.SEEK_SET)
                with patch.object(runner, "_call", return_value=b"") as restore_start:
                    runner.restore_volume_archive(
                        "uploads", archive_fd, hashlib.sha256(archive.read_bytes()).hexdigest(),
                    )
                self.assertEqual(
                    restore_start.call_args.args[0],
                    ["start", "--attach", "--interactive", "--", restore_id],
                )
                self.assertEqual(restore_start.call_args.kwargs["stdin_fd"], archive_fd)
                runner.verify_volume_utility_exited(
                    "uploads", json.dumps(
                        utility_observation("uploads", restore_id, "exited"),
                    ).encode(),
                )
                with patch.object(runner, "_call", return_value=f"{restore_id}\n".encode()):
                    runner.remove_volume_utility("uploads")
                runner.verify_volume_utility_removed("uploads", b"")

                backup_id = digest("backup-status-reconcile-utility")
                with patch.object(runner, "_call", return_value=f"{backup_id}\n".encode()) as call:
                    runner.create_volume_utility(
                        "backup_status", "reconcile-backup-status", ["1234"],
                    )
                self.assertEqual(call.call_args.args[0].count("--cap-add"), 2)
                self.assertIn("CHOWN", call.call_args.args[0])
                self.assertIn("FOWNER", call.call_args.args[0])
                runner.admit_volume_utility(
                    "backup_status", json.dumps(
                        utility_observation("backup_status", backup_id, "created"),
                    ).encode(),
                )
                with patch.object(runner, "_call", return_value=b""):
                    runner.reconcile_volume_metadata("backup_status", 1234)
                runner.verify_volume_utility_exited(
                    "backup_status", json.dumps(
                        utility_observation("backup_status", backup_id, "exited"),
                    ).encode(),
                )
                with patch.object(runner, "_call", return_value=f"{backup_id}\n".encode()):
                    runner.remove_volume_utility("backup_status")
                runner.verify_volume_utility_removed("backup_status", b"")

                recovery_id = digest("recovered-probe-utility")
                runner.expect_volume_utility("attachments", "probe", ["attachments"])
                runner.register_volume_utility_discovery(
                    "attachments", f"{recovery_id}\n".encode(),
                )
                foreign = utility_observation("attachments", recovery_id, "created")
                foreign[0] = digest("foreign-container")
                with self.assertRaisesRegex(
                    EXECUTOR.FixedExecutorError,
                    "ROLLBACK_FIXED_EXECUTOR_VOLUME_UTILITY_IDENTITY_INVALID",
                ):
                    runner.admit_volume_utility(
                        "attachments", json.dumps(foreign).encode(),
                    )
            finally:
                os.close(archive_fd)
                os.close(descriptor)

    def test_volume_helper_image_admission_rejects_forged_source_labels(self):
        with tempfile.TemporaryDirectory(prefix="uat-rollback-helper-image-", dir="/tmp") as root:
            executable = Path(root) / "docker"
            executable.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
            executable.chmod(0o555)
            descriptor = os.open(executable, os.O_RDONLY)
            try:
                plan = docker_runner_plan()
                runner = EXECUTOR.ClosedDockerRunner(
                    descriptor, plan, action_deadline=TEST_ACTION_DEADLINE,
                )
                helper = plan["helpers"]["volume_restore"]
                labels = {
                    "org.opencontainers.image.version": helper["application_version"],
                    "org.opencontainers.image.revision": "f" * 40,
                    "io.chenyida.erp.git-tree": helper["git_tree"],
                    "io.chenyida.erp.image-role": helper["image_role"],
                    "io.chenyida.erp.volume-helper.protocol": helper["protocol"],
                    "io.chenyida.erp.volume-helper.toolchain-contract-sha256":
                        helper["contract_sha256"],
                }
                forged = [
                    helper["image_config_digest"], "linux", "amd64",
                    [helper["image_reference"]], labels, "0:0",
                    [EXECUTOR.VOLUME_HELPER_ENTRYPOINT], ["unsupported"], "/", "layers",
                    [f"sha256:{digest('layer')}"]
                ]
                with self.assertRaisesRegex(
                    EXECUTOR.FixedExecutorError,
                    "ROLLBACK_FIXED_EXECUTOR_VOLUME_HELPER_IMAGE_INVALID",
                ):
                    runner.admit_volume_helper_image(json.dumps(forged).encode())
                with self.assertRaisesRegex(
                    EXECUTOR.FixedExecutorError,
                    "ROLLBACK_FIXED_EXECUTOR_VOLUME_HELPER_IMAGE_NOT_ADMITTED",
                ):
                    runner.create_volume_utility("uploads", "capacity")
            finally:
                os.close(descriptor)


class ClosedComposeRunnerTest(unittest.TestCase):
    def source_fd(self, root, name, raw):
        target = Path(root) / name
        target.write_bytes(raw)
        target.chmod(0o400)
        return os.open(target, os.O_RDONLY), hashlib.sha256(raw).hexdigest()

    def plugin(self, root, body):
        target = Path(root) / "docker-compose"
        target.write_text(body, encoding="utf-8")
        target.chmod(0o755)
        return target, os.open(target, os.O_RDONLY), digest(target.read_bytes())

    def test_direct_plugin_fd_uses_fixed_environment_sealed_overlay_and_allows_stderr(self):
        with tempfile.TemporaryDirectory(prefix="uat-rollback-compose-runner-", dir="/tmp") as root:
            record = Path(root) / "record.json"
            script = f'''#!/usr/bin/python3
import json, os, sys
paths = []
for index, value in enumerate(sys.argv):
    if value in {{"--env-file", "-f"}}:
        paths.append(sys.argv[index + 1])
payload = {{
    "argv": sys.argv,
    "environment": dict(os.environ),
    "files": [open(path, encoding="utf-8").read() for path in paths],
}}
with open({str(record)!r}, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, sort_keys=True)
sys.stdout.write("compose-success")
sys.stderr.write("normal-progress-on-stderr")
'''
            _plugin, plugin_fd, plugin_sha = self.plugin(root, script)
            opened = [plugin_fd]
            try:
                environment_fd, environment_sha = self.source_fd(
                    root, "deployment.env", b"ERP_WEB_IMAGE=candidate\nERP_WORKER_IMAGE=candidate\n",
                )
                compose_fd, compose_sha = self.source_fd(
                    root, "compose.yml", b"services:\n  web: {{}}\n  worker: {{}}\n",
                )
                release_fd, release_sha = self.source_fd(
                    root, "compose.release.yml", b"services:\n  web: {{}}\n  worker: {{}}\n",
                )
                opened.extend([environment_fd, compose_fd, release_fd])
                plan = docker_runner_plan(
                    compose_plugin_sha256=plugin_sha,
                    source_bindings={
                        "deployment_environment_sha256": environment_sha,
                        "compose_file_sha256": compose_sha,
                        "compose_release_file_sha256": release_sha,
                    },
                )
                runner = EXECUTOR.ClosedComposeRunner(
                    plugin_fd, plan, action_deadline=TEST_ACTION_DEADLINE,
                )
                poison = {
                    "DOCKER_CONTEXT": "attacker",
                    "DOCKER_CONFIG": "/tmp/attacker",
                    "DOCKER_CLI_PLUGIN_ORIGINAL_CLI_COMMAND": "/tmp/docker",
                    "DOCKER_CLI_PLUGIN_USE_DIAL_STDIO": "1",
                    "COMPOSE_FILE": "/tmp/attacker.yml",
                    "COMPOSE_PROFILES": "attacker",
                }
                with patch.dict(os.environ, poison, clear=False):
                    receipt = runner.activate_predecessor_writers(
                        environment_fd, compose_fd, release_fd,
                    )
                observed = json.loads(record.read_text(encoding="utf-8"))
                self.assertEqual(receipt["status"], "COMMITTED")
                self.assertGreater(receipt["stderr_bytes"], 0)
                self.assertTrue(observed["argv"][0].startswith("/proc/self/fd/"))
                self.assertNotIn("compose", observed["argv"][1:])
                self.assertIn("--force-recreate", observed["argv"])
                self.assertEqual(observed["environment"], EXECUTOR.ClosedComposeRunner.FIXED_ENVIRONMENT)
                self.assertTrue(all(key not in observed["environment"] for key in poison))
                overlay = observed["files"][-1]
                self.assertIn(plan["predecessor"]["web_image"], overlay)
                self.assertIn(plan["predecessor"]["web_image_config_digest"], overlay)
                self.assertIn(plan["predecessor"]["worker_image"], overlay)
                self.assertIn(plan["predecessor"]["worker_image_config_digest"], overlay)
            finally:
                for descriptor in reversed(opened):
                    os.close(descriptor)

    def test_control_environment_key_is_rejected_before_plugin_execution(self):
        with tempfile.TemporaryDirectory(prefix="uat-rollback-compose-env-", dir="/tmp") as root:
            marker = Path(root) / "executed"
            _plugin, plugin_fd, plugin_sha = self.plugin(
                root, f"#!/bin/sh\ntouch {marker}\n",
            )
            opened = [plugin_fd]
            try:
                environment_fd, environment_sha = self.source_fd(
                    root, "deployment.env", b"COMPOSE_FILE=/tmp/attacker.yml\n",
                )
                compose_fd, compose_sha = self.source_fd(root, "compose.yml", b"services: {{}}\n")
                release_fd, release_sha = self.source_fd(
                    root, "compose.release.yml", b"services: {{}}\n",
                )
                opened.extend([environment_fd, compose_fd, release_fd])
                plan = docker_runner_plan(
                    compose_plugin_sha256=plugin_sha,
                    source_bindings={
                        "deployment_environment_sha256": environment_sha,
                        "compose_file_sha256": compose_sha,
                        "compose_release_file_sha256": release_sha,
                    },
                )
                runner = EXECUTOR.ClosedComposeRunner(
                    plugin_fd, plan, action_deadline=TEST_ACTION_DEADLINE,
                )
                with self.assertRaisesRegex(
                    EXECUTOR.FixedExecutorError,
                    "ROLLBACK_FIXED_EXECUTOR_COMPOSE_ENVIRONMENT_INVALID",
                ):
                    runner.activate_predecessor_writers(environment_fd, compose_fd, release_fd)
                self.assertFalse(marker.exists())
            finally:
                for descriptor in reversed(opened):
                    os.close(descriptor)

    def test_timeout_and_nonzero_exit_are_typed_unknown_after_side_effect_dispatch(self):
        for name, body, expected in (
            ("timeout", "import time; time.sleep(2)", "TOOL_TIMEOUT"),
            ("nonzero", "raise SystemExit(7)", "SIDE_EFFECT_OUTCOME_UNKNOWN"),
        ):
            with self.subTest(name=name), tempfile.TemporaryDirectory(
                prefix=f"uat-rollback-compose-{name}-", dir="/tmp",
            ) as root:
                script = f"#!/usr/bin/python3\n{body}\n"
                _plugin, plugin_fd, plugin_sha = self.plugin(root, script)
                opened = [plugin_fd]
                try:
                    environment_fd, environment_sha = self.source_fd(
                        root, "deployment.env", b"ERP_DEPLOYMENT_CLASS=uat\n",
                    )
                    compose_fd, compose_sha = self.source_fd(root, "compose.yml", b"services: {{}}\n")
                    release_fd, release_sha = self.source_fd(
                        root, "compose.release.yml", b"services: {{}}\n",
                    )
                    opened.extend([environment_fd, compose_fd, release_fd])
                    plan = docker_runner_plan(
                        compose_plugin_sha256=plugin_sha,
                        source_bindings={
                            "deployment_environment_sha256": environment_sha,
                            "compose_file_sha256": compose_sha,
                            "compose_release_file_sha256": release_sha,
                        },
                    )
                    runner = EXECUTOR.ClosedComposeRunner(
                        plugin_fd, plan, action_deadline=TEST_ACTION_DEADLINE,
                    )
                    with self.assertRaises(EXECUTOR.HandlerOutcomeUnknown) as raised:
                        runner.activate_predecessor_writers(
                            environment_fd, compose_fd, release_fd,
                            timeout_seconds=0.1 if name == "timeout" else 2,
                        )
                    self.assertEqual(raised.exception.reason_code, expected)
                    self.assertTrue(raised.exception.side_effects_started)
                finally:
                    for descriptor in reversed(opened):
                        os.close(descriptor)


class FixedHandlerEngineTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="uat-rollback-handler-engine-", dir="/tmp")
        self.root = Path(self.temporary.name)
        parent = self.root / EXECUTOR.HANDLER_STATE_ROOT.lstrip("/")
        parent.parent.mkdir(parents=True, mode=0o700)
        os.chmod(parent.parent, 0o700)
        self.backend = EXECUTOR.FakeCapabilityBackend(valid_handler_evidence)
        self.engine = EXECUTOR.FixedHandlerEngine(
            self.backend, filesystem_root=str(self.root),
            clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        self.manifest = engine_manifest()

    def tearDown(self):
        self.temporary.cleanup()

    def test_all_nine_stage_handlers_prepare_execute_and_replay(self):
        for index, label in enumerate(EXECUTOR.STAGES, start=1):
            with self.subTest(label=label):
                operation_id = f"rollback-stage-matrix-{index:02d}"
                prepared = self.engine.dispatch(
                    engine_request("ROLLBACK_EXECUTION", label, "PREPARE", operation_id),
                    self.manifest,
                )
                committed = self.engine.dispatch(
                    engine_request("ROLLBACK_EXECUTION", label, "EXECUTE", operation_id),
                    self.manifest,
                )
                replay = self.engine.dispatch(
                    engine_request("ROLLBACK_EXECUTION", label, "EXECUTE", operation_id),
                    self.manifest,
                )
                probed = self.engine.dispatch(
                    engine_request("ROLLBACK_EXECUTION", label, "PROBE", operation_id),
                    self.manifest,
                )
                self.assertEqual(prepared["status"], "PREPARED")
                self.assertEqual(committed["status"], "COMMITTED")
                self.assertEqual(replay["status"], "ALREADY_COMMITTED")
                self.assertEqual(probed["status"], "COMMITTED")
                self.assertEqual(committed["output"], replay["output"])
                self.assertEqual(committed["output"], probed["output"])
        self.assertEqual(sum(action == "EXECUTE" for action, _label in self.backend.calls), 9)

    def test_all_thirteen_check_handlers_prepare_and_probe(self):
        for index, label in enumerate(EXECUTOR.CHECKS, start=1):
            with self.subTest(label=label):
                operation_id = f"rollback-check-matrix-{index:02d}"
                prepared = self.engine.dispatch(
                    engine_request("ROLLBACK_POSTVERIFY", label, "PREPARE", operation_id),
                    self.manifest,
                )
                verified = self.engine.dispatch(
                    engine_request("ROLLBACK_POSTVERIFY", label, "PROBE", operation_id),
                    self.manifest,
                )
                replay = self.engine.dispatch(
                    engine_request("ROLLBACK_POSTVERIFY", label, "PROBE", operation_id),
                    self.manifest,
                )
                self.assertEqual(prepared["status"], "PREPARED")
                self.assertEqual(verified["status"], "VERIFIED")
                self.assertEqual(replay["status"], "VERIFIED")
                self.assertEqual(verified["output"], replay["output"])
        self.assertEqual(sum(action == "PROBE" for action, _label in self.backend.calls), 13)

    def test_metadata_checks_use_internal_opcodes_not_docker_placeholders(self):
        for label in METADATA_LABELS:
            with self.subTest(label=label):
                request = engine_request(
                    "ROLLBACK_POSTVERIFY", label, "PROBE",
                    f"rollback-{label.lower().replace('_', '-')}-internal-opcode",
                )
                self.assertEqual(
                    EXECUTOR.expected_argv_template(request),
                    ["EXECUTOR_INTERNAL", label],
                )

    def test_crash_after_all_durable_side_effect_receipts_is_resolved_after_process_restart(self):
        operation_id = "rollback-handler-crash-after-side-effect"
        label = "POSTGRESQL_RESTORE"
        prepare = engine_request("ROLLBACK_EXECUTION", label, "PREPARE", operation_id)
        execute = engine_request("ROLLBACK_EXECUTION", label, "EXECUTE", operation_id)
        self.engine.dispatch(prepare, self.manifest)

        def crash(point, _request):
            if point == "AFTER_SIDE_EFFECT_4":
                raise RuntimeError("simulated-crash-after-side-effect-receipt")

        crashing = EXECUTOR.FixedHandlerEngine(
            self.backend, filesystem_root=str(self.root),
            clock=lambda: "2026-08-16T02:00:00.000Z", fault=crash,
        )
        with self.assertRaisesRegex(RuntimeError, "simulated-crash"):
            crashing.dispatch(execute, self.manifest)
        recovered_backend = EXECUTOR.FakeCapabilityBackend(valid_handler_evidence)
        recovered_engine = EXECUTOR.FixedHandlerEngine(
            recovered_backend, filesystem_root=str(self.root),
            clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        recovered = recovered_engine.dispatch(
            engine_request("ROLLBACK_EXECUTION", label, "PROBE", operation_id),
            self.manifest,
        )
        self.assertEqual(recovered["status"], "COMMITTED")
        self.assertEqual(sum(action == "EXECUTE" for action, _label in self.backend.calls), 1)
        self.assertEqual(recovered_backend.calls, [("PROBE", label)])

    def test_probe_never_commits_from_only_a_durable_side_effect_prefix(self):
        operation_id = "rollback-handler-incomplete-side-effect-prefix"
        label = "POSTGRESQL_RESTORE"
        self.engine.dispatch(
            engine_request("ROLLBACK_EXECUTION", label, "PREPARE", operation_id), self.manifest,
        )

        def crash(point, _request):
            if point == "AFTER_SIDE_EFFECT_1":
                raise RuntimeError("simulated-crash-after-side-effect-prefix")

        crashing = EXECUTOR.FixedHandlerEngine(
            self.backend, filesystem_root=str(self.root),
            clock=lambda: "2026-08-16T02:00:00.000Z", fault=crash,
        )
        with self.assertRaisesRegex(RuntimeError, "simulated-crash"):
            crashing.dispatch(
                engine_request("ROLLBACK_EXECUTION", label, "EXECUTE", operation_id),
                self.manifest,
            )
        recovered_backend = EXECUTOR.FakeCapabilityBackend(valid_handler_evidence)
        recovered_engine = EXECUTOR.FixedHandlerEngine(
            recovered_backend, filesystem_root=str(self.root),
            clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        response = recovered_engine.dispatch(
            engine_request("ROLLBACK_EXECUTION", label, "PROBE", operation_id), self.manifest,
        )
        self.assertEqual(response["status"], "PARTIAL_OR_UNKNOWN")
        self.assertEqual(response["output"]["unknown"]["reason_code"], "PROBE_INCONCLUSIVE")
        journal = EXECUTOR.HandlerJournal(
            "ROLLBACK_EXECUTION", operation_id, label, str(self.root),
        )
        events = journal.load()
        self.assertEqual(
            [item["side_effect_name"] for item in events
             if item["event"] == "SIDE_EFFECT_RECORDED"],
            [EXECUTOR.SIDE_EFFECTS_BY_LABEL[label][0]],
        )
        self.assertFalse(any(item["event"] == "RESULT_COMMITTED" for item in events))

    def test_probe_can_close_a_physically_committed_final_effect_with_recovery_evidence(self):
        operation_id = "rollback-handler-recovered-final-effect-receipt"
        label = "POSTGRESQL_RESTORE"
        shared = {}

        class CrashAfterPhysicalEffect(EXECUTOR.FakeCapabilityBackend):
            def execute(self, request, _manifest, _events, effects):
                self.calls.append(("EXECUTE", request["label"]))
                shared["after_identity"] = EXECUTOR.digest_value({
                    "backend": "RECOVERY_TEST", "label": request["label"],
                    "state": "COMMITTED",
                })
                for index, side_effect_name in enumerate(
                    EXECUTOR.SIDE_EFFECTS_BY_LABEL[request["label"]], start=1,
                ):
                    intent = EXECUTOR.create_side_effect_intent(
                        request, side_effect_name, EXECUTOR.digest_value({
                            "backend": "RECOVERY_TEST", "side_effect": side_effect_name,
                        }), EXECUTOR.digest_value({
                            "argv": "RECOVERY_TEST", "side_effect": side_effect_name,
                        }), request["requested_at"],
                    )
                    effects.begin(side_effect_name, intent)
                    if index == len(EXECUTOR.SIDE_EFFECTS_BY_LABEL[request["label"]]):
                        shared["intent"] = intent
                        shared["observation"] = EXECUTOR.digest_value({
                            "physically_committed": side_effect_name,
                            "after_identity_sha256": shared["after_identity"],
                        })
                        raise RuntimeError("simulated-crash-before-final-receipt")
                    effects.complete(
                        side_effect_name,
                        EXECUTOR.create_side_effect_receipt(
                            intent, EXECUTOR.ZERO_SHA256, shared["after_identity"],
                            request["requested_at"],
                        ),
                    )
                raise AssertionError("unreachable")

        class RecoveryProbe(EXECUTOR.FakeCapabilityBackend):
            def probe(self, request, _manifest, events, effects):
                self.calls.append(("PROBE", request["label"]))
                started = [
                    item for item in events
                    if item["event"] == "SIDE_EFFECT_STARTED"
                    and item["side_effect_name"] == shared["intent"]["side_effect_name"]
                ]
                self.assert_single_started(started)
                effects.complete(
                    shared["intent"]["side_effect_name"],
                    EXECUTOR.create_recovered_side_effect_receipt(
                        shared["intent"], EXECUTOR.ZERO_SHA256,
                        shared["after_identity"], shared["observation"],
                        request["requested_at"],
                    ),
                )
                return {"record": self._record(request, effects.assert_closed())}

            @staticmethod
            def assert_single_started(started):
                if len(started) != 1:
                    raise AssertionError(f"expected one started effect, got {len(started)}")

        self.engine.dispatch(
            engine_request("ROLLBACK_EXECUTION", label, "PREPARE", operation_id), self.manifest,
        )
        crashing = EXECUTOR.FixedHandlerEngine(
            CrashAfterPhysicalEffect(valid_handler_evidence), filesystem_root=str(self.root),
            clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        with self.assertRaisesRegex(RuntimeError, "simulated-crash-before-final-receipt"):
            crashing.dispatch(
                engine_request("ROLLBACK_EXECUTION", label, "EXECUTE", operation_id),
                self.manifest,
            )
        recovered = EXECUTOR.FixedHandlerEngine(
            RecoveryProbe(valid_handler_evidence), filesystem_root=str(self.root),
            clock=lambda: "2026-08-16T02:00:00.000Z",
        ).dispatch(
            engine_request("ROLLBACK_EXECUTION", label, "PROBE", operation_id), self.manifest,
        )
        self.assertEqual(recovered["status"], "COMMITTED")
        events = EXECUTOR.HandlerJournal(
            "ROLLBACK_EXECUTION", operation_id, label, str(self.root),
        ).load()
        receipts = [item["payload"] for item in events if item["event"] == "SIDE_EFFECT_RECORDED"]
        self.assertEqual(len(receipts), 4)
        self.assertEqual(receipts[-1]["status"], "RECOVERED_COMMITTED")
        self.assertEqual(receipts[-1]["recovery_observation_sha256"], shared["observation"])

    def test_crash_before_backend_call_returns_stable_typed_unknown(self):
        operation_id = "rollback-handler-crash-before-side-effect"
        label = "UPLOADS_RESTORE"
        self.engine.dispatch(
            engine_request("ROLLBACK_EXECUTION", label, "PREPARE", operation_id), self.manifest,
        )

        def crash(point, _request):
            if point == "AFTER_EXECUTION_STARTED":
                raise RuntimeError("simulated-crash-before-backend")

        crashing = EXECUTOR.FixedHandlerEngine(
            self.backend, filesystem_root=str(self.root),
            clock=lambda: "2026-08-16T02:00:00.000Z", fault=crash,
        )
        with self.assertRaisesRegex(RuntimeError, "simulated-crash"):
            crashing.dispatch(
                engine_request("ROLLBACK_EXECUTION", label, "EXECUTE", operation_id),
                self.manifest,
            )
        recovered_backend = EXECUTOR.FakeCapabilityBackend(valid_handler_evidence)
        recovered_engine = EXECUTOR.FixedHandlerEngine(
            recovered_backend, filesystem_root=str(self.root),
            clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        probe = engine_request("ROLLBACK_EXECUTION", label, "PROBE", operation_id)
        first = recovered_engine.dispatch(probe, self.manifest)
        second = recovered_engine.dispatch(probe, self.manifest)
        self.assertEqual(first, second)
        self.assertEqual(first["status"], "PARTIAL_OR_UNKNOWN")
        self.assertEqual(first["output"]["unknown"]["reason_code"], "PROBE_INCONCLUSIVE")
        self.assertTrue(first["output"]["unknown"]["side_effects_started"])
        self.assertTrue(first["output"]["unknown"]["containment_required"])

    def test_source_or_activation_drift_cannot_append_to_existing_chain(self):
        operation_id = "rollback-handler-binding-drift"
        label = "ATTACHMENTS_RESTORE"
        self.engine.dispatch(
            engine_request("ROLLBACK_EXECUTION", label, "PREPARE", operation_id), self.manifest,
        )
        drift = engine_request("ROLLBACK_EXECUTION", label, "EXECUTE", operation_id)
        drift["source_set_sha256"] = digest("substituted-source-set")
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError, "ROLLBACK_FIXED_EXECUTOR_HANDLER_BINDING_DRIFT",
        ):
            self.engine.dispatch(drift, self.manifest)
        substituted_manifest = {
            **self.manifest,
            "activation": {"receipt_sha256": digest("substituted-activation")},
        }
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError, "ROLLBACK_FIXED_EXECUTOR_HANDLER_BINDING_DRIFT",
        ):
            self.engine.dispatch(
                engine_request("ROLLBACK_EXECUTION", label, "EXECUTE", operation_id),
                substituted_manifest,
            )

    def test_forged_backend_result_is_rejected_before_durable_commit(self):
        class ForgedBackend(EXECUTOR.FakeCapabilityBackend):
            def probe(self, request, manifest, events, effects):
                outcome = super().probe(request, manifest, events, effects)
                outcome["record"]["evidence"] = {"forged": True}
                result_field = "stage_result_sha256" \
                    if request["operation"] == "ROLLBACK_EXECUTION" \
                    else "check_result_sha256"
                outcome["record"][result_field] = EXECUTOR.digest_value(
                    EXECUTOR.without(outcome["record"], result_field),
                )
                return outcome

        operation_id = "rollback-handler-result-substitution"
        label = "HEALTH"
        backend = ForgedBackend(valid_handler_evidence)
        engine = EXECUTOR.FixedHandlerEngine(
            backend, filesystem_root=str(self.root),
            clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        engine.dispatch(
            engine_request("ROLLBACK_POSTVERIFY", label, "PREPARE", operation_id), self.manifest,
        )
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError, "ROLLBACK_FIXED_EXECUTOR_HANDLER_EVIDENCE_INVALID",
        ):
            engine.dispatch(
                engine_request("ROLLBACK_POSTVERIFY", label, "PROBE", operation_id),
                self.manifest,
            )

    def test_terminal_result_must_bind_exact_ordered_side_effect_receipts(self):
        class ForgedAggregateBackend(EXECUTOR.FakeCapabilityBackend):
            def execute(self, request, manifest, events, effects):
                outcome = super().execute(request, manifest, events, effects)
                outcome["record"]["side_effect_receipts_sha256"] = digest(
                    "substituted-side-effect-receipts",
                )
                outcome["record"]["stage_result_sha256"] = EXECUTOR.digest_value(
                    EXECUTOR.without(outcome["record"], "stage_result_sha256"),
                )
                return outcome

        operation_id = "rollback-handler-receipt-aggregate-substitution"
        label = "UPLOADS_RESTORE"
        engine = EXECUTOR.FixedHandlerEngine(
            ForgedAggregateBackend(valid_handler_evidence), filesystem_root=str(self.root),
            clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        engine.dispatch(
            engine_request("ROLLBACK_EXECUTION", label, "PREPARE", operation_id), self.manifest,
        )
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError, "ROLLBACK_FIXED_EXECUTOR_HANDLER_RESULT_INVALID",
        ):
            engine.dispatch(
                engine_request("ROLLBACK_EXECUTION", label, "EXECUTE", operation_id),
                self.manifest,
            )

    def test_restart_replay_rejects_a_rehashed_terminal_record_with_receipt_drift(self):
        operation_id = "rollback-handler-terminal-record-drift"
        label = "UPLOADS_RESTORE"
        self.engine.dispatch(
            engine_request("ROLLBACK_EXECUTION", label, "PREPARE", operation_id), self.manifest,
        )
        execute = engine_request("ROLLBACK_EXECUTION", label, "EXECUTE", operation_id)
        self.assertEqual(self.engine.dispatch(execute, self.manifest)["status"], "COMMITTED")

        journal = EXECUTOR.HandlerJournal(
            "ROLLBACK_EXECUTION", operation_id, label, str(self.root),
        )
        terminal_path = sorted(journal.events_root.iterdir())[-1]
        event = EXECUTOR.strict_json(
            terminal_path.read_bytes(), "ROLLBACK_FIXED_EXECUTOR_HANDLER_EVENT_INVALID",
        )
        self.assertEqual(event["event"], "RESULT_COMMITTED")
        record = event["payload"]["record"]
        record["side_effect_receipts_sha256"] = digest("rehashed-terminal-receipt-drift")
        record["stage_result_sha256"] = EXECUTOR.digest_value(
            EXECUTOR.without(record, "stage_result_sha256"),
        )
        event["payload_sha256"] = EXECUTOR.digest_value(event["payload"])
        event["event_sha256"] = EXECUTOR.digest_value(
            EXECUTOR.without(event, "event_sha256"),
        )
        replacement = terminal_path.with_name(
            f"{event['sequence']:06d}.{event['event_sha256']}.json",
        )
        terminal_path.unlink()
        replacement.write_bytes(EXECUTOR.canonical(event))
        replacement.chmod(0o400)

        restarted = EXECUTOR.FixedHandlerEngine(
            EXECUTOR.FakeCapabilityBackend(valid_handler_evidence),
            filesystem_root=str(self.root),
            clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        with self.assertRaisesRegex(
            EXECUTOR.FixedExecutorError, "ROLLBACK_FIXED_EXECUTOR_HANDLER_RESULT_INVALID",
        ):
            restarted.dispatch(execute, self.manifest)

    def test_started_journal_event_forces_unknown_side_effects_started_true(self):
        class StartedThenUnknownBackend(EXECUTOR.FakeCapabilityBackend):
            def execute(self, request, _manifest, _events, effects):
                name = EXECUTOR.SIDE_EFFECTS_BY_LABEL[request["label"]][0]
                effects.begin(name, EXECUTOR.create_side_effect_intent(
                    request, name, digest("started-target"), digest("started-argv"),
                    request["requested_at"],
                ))
                raise EXECUTOR.HandlerOutcomeUnknown(
                    "SIDE_EFFECT_OUTCOME_UNKNOWN", "AFTER_SIDE_EFFECT",
                    side_effects_started=False, uncertain_action="EXECUTE",
                )

        operation_id = "rollback-handler-started-event-unknown"
        label = "WRITER_CONTAINMENT"
        engine = EXECUTOR.FixedHandlerEngine(
            StartedThenUnknownBackend(valid_handler_evidence), filesystem_root=str(self.root),
            clock=lambda: "2026-08-16T02:00:00.000Z",
        )
        engine.dispatch(
            engine_request("ROLLBACK_EXECUTION", label, "PREPARE", operation_id), self.manifest,
        )
        response = engine.dispatch(
            engine_request("ROLLBACK_EXECUTION", label, "EXECUTE", operation_id), self.manifest,
        )
        self.assertEqual(response["status"], "PARTIAL_OR_UNKNOWN")
        self.assertTrue(response["output"]["unknown"]["side_effects_started"])

    def test_operation_containment_is_explicit_backend_action(self):
        request = engine_request(
            "ROLLBACK_EXECUTION", "WRITER_CONTAINMENT", "PREPARE",
            "rollback-operation-containment",
        )
        request.update({"action": "CONTAIN", "label": None, "request_sha256": digest("contain")})
        self.backend.operation_outcomes["CONTAIN"] = {
            "status": "CONTAINED", "output": {"containment": {}, "observed": {}},
        }
        response = self.engine.dispatch(request, self.manifest)
        self.assertEqual(response["status"], "CONTAINED")
        self.assertEqual(self.backend.calls[-1], ("CONTAIN", None))


if __name__ == "__main__":
    unittest.main()
