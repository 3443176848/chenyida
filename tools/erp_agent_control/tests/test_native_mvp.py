from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import unittest

from tools.erp_agent_control.native_mvp import (
    MESSAGE_TYPE_BINDINGS,
    RFC3339_RE,
    load_bundle,
    validate_bundle,
)
from tools.erp_agent_control.pilot_fixture import (
    build_task_packet,
    build_valid_bundle,
    digest,
    message_evidence_payload,
)
from tools.erp_agent_control.readonly_controller import (
    TASK_DOCUMENT_RE,
    UAT_DECLARATION_DOCUMENTS,
    validate_task_packet,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
VALIDATOR_PATH = REPOSITORY_ROOT / "tools/erp_agent_control/native_mvp.py"
STATIC_BUNDLE_PATH = REPOSITORY_ROOT / "docs/agent-control/pilots/AGENT-R1-5/valid-bundle.json"
STATIC_PACKET_PATH = REPOSITORY_ROOT / "docs/agent-control/task-packets/AGENT-R1-5.json"
SCHEMA_DIRECTORY = REPOSITORY_ROOT / "docs/agent-control/schemas"
BLACKBOX_DIRECTORY = REPOSITORY_ROOT / "docs/agent-control/pilots/AGENT-R1-5/blackbox"


def error_code(bundle: dict) -> str | None:
    report = validate_bundle(bundle)
    return report["errors"][0]["code"] if report["errors"] else None


def message(bundle: dict, sequence: int) -> dict:
    identifier = f"00000000-0000-4000-8000-{sequence:012d}"
    return next(item for item in bundle["messages"] if item["message_id"] == identifier)


def context(bundle: dict, role: str, candidate_sha: str) -> dict:
    return next(
        item
        for item in bundle["contexts"]
        if item["role"] == role and item["candidate_sha"] == candidate_sha
    )


def rebind_message_evidence(
    bundle: dict,
    item: dict,
    *,
    locator: str | None = None,
) -> None:
    for index, evidence in enumerate(item["evidence"]):
        if locator is not None:
            evidence["locator"] = locator if index == 0 else f"{locator}-{index + 1}"
        payload = message_evidence_payload(item, evidence)
        evidence["digest"] = digest(payload)
        classification = (
            "PUBLIC_OBSERVATION"
            if item["role"] == "BLACK_BOX_VERIFIER"
            else "SYNTHETIC_TEST_EVIDENCE"
        )
        bundle["artifacts"][evidence["locator"]] = {
            "classification": classification,
            "payload": payload,
            "digest": evidence["digest"],
        }
    item["input"]["artifacts"] = [evidence["locator"] for evidence in item["evidence"]]


def filesystem_snapshot(root: Path) -> dict[str, tuple]:
    snapshot: dict[str, tuple] = {}
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        metadata = path.lstat()
        if stat.S_ISREG(metadata.st_mode):
            snapshot[relative] = (
                "file",
                metadata.st_mode,
                metadata.st_mtime_ns,
                hashlib.sha256(path.read_bytes()).hexdigest(),
            )
        elif stat.S_ISDIR(metadata.st_mode):
            snapshot[relative] = ("directory", metadata.st_mode, metadata.st_mtime_ns)
        elif stat.S_ISLNK(metadata.st_mode):
            snapshot[relative] = ("symlink", metadata.st_mode, os.readlink(path))
    return snapshot


class NativeMvpProtocolTest(unittest.TestCase):
    def setUp(self) -> None:
        self.bundle = build_valid_bundle()

    def test_valid_bundle_passes_with_latest_candidate_gates(self) -> None:
        report = validate_bundle(self.bundle)

        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["errors"], [])
        self.assertEqual(report["counts"], {"candidates": 2, "contexts": 11, "messages": 15})
        self.assertEqual(
            report["gates"],
            {"BLACK_BOX": "PASS", "ERP_CONTRACT": "PASS", "QA": "PASS", "SECURITY": "PASS"},
        )
        self.assertEqual(report["minority_claims_resolved"], ["MR-001"])

    def test_repeated_library_validation_is_byte_deterministic(self) -> None:
        first = json.dumps(validate_bundle(self.bundle), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        second = json.dumps(validate_bundle(self.bundle), ensure_ascii=False, sort_keys=True, separators=(",", ":"))

        self.assertEqual(first, second)

    def test_checked_in_packet_and_bundle_match_deterministic_builder(self) -> None:
        static_packet = json.loads(STATIC_PACKET_PATH.read_text(encoding="utf-8"))
        static_bundle = json.loads(STATIC_BUNDLE_PATH.read_text(encoding="utf-8"))

        self.assertEqual(static_packet, build_task_packet())
        self.assertEqual(static_bundle, self.bundle)

    def test_three_schemas_are_strict_draft_2020_objects(self) -> None:
        expected = {
            "task-packet-v2.schema.json",
            "message-v1.schema.json",
            "context-manifest-v1.schema.json",
        }
        observed = {path.name for path in SCHEMA_DIRECTORY.glob("*.schema.json")}

        self.assertEqual(observed, expected)
        for filename in sorted(expected):
            schema = json.loads((SCHEMA_DIRECTORY / filename).read_text(encoding="utf-8"))
            self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
            self.assertEqual(schema["type"], "object")
            self.assertIs(schema["additionalProperties"], False)
            self.assertGreater(len(schema["required"]), 0)

    def test_schema_and_manual_rfc3339_profiles_are_identical(self) -> None:
        schema = json.loads((SCHEMA_DIRECTORY / "message-v1.schema.json").read_text(encoding="utf-8"))

        self.assertEqual(schema["$defs"]["rfc3339"]["pattern"], RFC3339_RE.pattern)

    def test_schema_conditions_cover_every_manual_message_type(self) -> None:
        schema = json.loads((SCHEMA_DIRECTORY / "message-v1.schema.json").read_text(encoding="utf-8"))
        conditioned_types = {
            rule["if"]["properties"]["message_type"]["const"]
            for rule in schema["allOf"]
            if "message_type" in rule.get("if", {}).get("properties", {})
        }

        self.assertEqual(conditioned_types, set(MESSAGE_TYPE_BINDINGS))

    def test_schema_and_manual_task_document_patterns_are_identical(self) -> None:
        schema = json.loads((SCHEMA_DIRECTORY / "task-packet-v2.schema.json").read_text(encoding="utf-8"))

        self.assertEqual(schema["properties"]["task"]["properties"]["task_document"]["pattern"], TASK_DOCUMENT_RE.pattern)

    def test_message_change_path_uses_strict_repository_path_schema(self) -> None:
        schema = json.loads((SCHEMA_DIRECTORY / "message-v1.schema.json").read_text(encoding="utf-8"))

        self.assertEqual(
            schema["properties"]["changes"]["items"]["properties"]["path"],
            {"$ref": "#/$defs/repositoryPath"},
        )

    def test_schema_path_rules_reject_nested_git_and_unbounded_globs(self) -> None:
        task_schema = json.loads(
            (SCHEMA_DIRECTORY / "task-packet-v2.schema.json").read_text(encoding="utf-8")
        )
        message_schema = json.loads(
            (SCHEMA_DIRECTORY / "message-v1.schema.json").read_text(encoding="utf-8")
        )
        task_path_pattern = task_schema["$defs"]["repositoryPath"]["pattern"]
        message_path_pattern = message_schema["$defs"]["repositoryPath"]["pattern"]
        recursive_rule = task_schema["$defs"]["repositoryRecursivePathPattern"]
        recursive_pattern = recursive_rule["pattern"]

        def recursive_schema_accepts(value: str) -> bool:
            return (
                recursive_rule["minLength"] <= len(value) <= recursive_rule["maxLength"]
                and re.fullmatch(recursive_pattern, value) is not None
            )

        self.assertIsNone(re.fullmatch(task_path_pattern, "docs/.git/config"))
        self.assertIsNone(re.fullmatch(message_path_pattern, "docs/.git/config"))
        self.assertIsNone(re.fullmatch(recursive_pattern, "*/*"))
        self.assertIsNone(re.fullmatch(recursive_pattern, "*/**"))
        self.assertIsNotNone(re.fullmatch(recursive_pattern, "docs/agent-control/**"))
        self.assertTrue(recursive_schema_accepts("a" * 509 + "/**"))
        self.assertFalse(recursive_schema_accepts("a" * 510 + "/**"))
        self.assertEqual(
            task_schema["$defs"]["repositoryPathPattern"],
            {
                "oneOf": [
                    {"$ref": "#/$defs/repositoryPath"},
                    {"$ref": "#/$defs/repositoryRecursivePathPattern"},
                ]
            },
        )

    def test_schema_and_manual_uat_marker_allowlists_are_identical(self) -> None:
        schema = json.loads((SCHEMA_DIRECTORY / "task-packet-v2.schema.json").read_text(encoding="utf-8"))
        path_rule = schema["properties"]["inspection"]["properties"]["uat_document_markers"]["items"][
            "properties"
        ]["path"]

        self.assertEqual(set(path_rule["enum"]), set(UAT_DECLARATION_DOCUMENTS))

    def test_checked_in_blackbox_observation_matches_public_fixture(self) -> None:
        interface_contract = json.loads((BLACKBOX_DIRECTORY / "interface.json").read_text(encoding="utf-8"))
        personas = json.loads((BLACKBOX_DIRECTORY / "personas.json").read_text(encoding="utf-8"))
        report = json.loads((BLACKBOX_DIRECTORY / "observed-report.json").read_text(encoding="utf-8"))
        digest_input = copy.deepcopy(report)
        report_digest = digest_input.pop("report_digest")

        self.assertEqual(interface_contract["classification"], "PUBLIC_SYNTHETIC")
        self.assertEqual(report["interface_digest"], digest(interface_contract))
        self.assertEqual(report["persona_digest"], digest(personas))
        self.assertEqual(report["persona_count"], len(personas["personas"]))
        self.assertTrue(all(item["observed"] == item["expected"] for item in report["observations"]))
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report_digest, digest(digest_input))

    def test_missing_required_field_fails_closed(self) -> None:
        del self.bundle["messages"][0]["status"]

        self.assertEqual(error_code(self.bundle), "REQUIRED_FIELD_MISSING")

    def test_artifact_registry_bundle_requires_v2(self) -> None:
        self.bundle["schema_version"] = "chenyida-erp-native-pilot-bundle/v1"

        self.assertEqual(error_code(self.bundle), "BUNDLE_SCHEMA_UNSUPPORTED")

    def test_unknown_field_fails_closed(self) -> None:
        self.bundle["messages"][0]["authority"] = "invented"

        self.assertEqual(error_code(self.bundle), "UNKNOWN_FIELD")

    def test_message_schema_max_length_is_enforced(self) -> None:
        self.bundle["messages"][0]["evidence"][0]["locator"] = "x" * 513

        self.assertEqual(error_code(self.bundle), "STRING_TOO_LONG")

    def test_invalid_rfc3339_timestamp_fails_closed(self) -> None:
        self.bundle["messages"][0]["created_at"] = "2026-08-11 06:00:00Z"

        self.assertEqual(error_code(self.bundle), "FORMAT_INVALID")

    def test_rfc3339_fractional_seconds_are_not_limited_to_microseconds(self) -> None:
        self.bundle["messages"][0]["created_at"] = "2026-08-11T06:00:00.123456789Z"

        self.assertEqual(validate_bundle(self.bundle)["status"], "PASS")

    def test_exit_code_schema_bound_is_enforced(self) -> None:
        self.bundle["messages"][0]["evidence"][0]["exit_code"] = 256

        self.assertEqual(error_code(self.bundle), "INTEGER_INVALID")

    def test_context_schema_max_length_is_enforced_with_fresh_digest(self) -> None:
        manifest = self.bundle["contexts"][0]
        manifest["documents"][0]["locator"] = "x" * 513
        digest_input = copy.deepcopy(manifest)
        digest_input.pop("manifest_digest")
        manifest["manifest_digest"] = digest(digest_input)

        self.assertEqual(error_code(self.bundle), "STRING_TOO_LONG")

    def test_wrong_candidate_digest_fails_closed(self) -> None:
        self.bundle["candidates"][0]["candidate_sha"] = "sha256:" + "0" * 64

        self.assertEqual(error_code(self.bundle), "CANDIDATE_DIGEST_MISMATCH")

    def test_wrong_context_digest_fails_closed(self) -> None:
        self.bundle["contexts"][0]["manifest_digest"] = "sha256:" + "0" * 64

        self.assertEqual(error_code(self.bundle), "CONTEXT_DIGEST_MISMATCH")

    def test_context_integer_fields_reject_float_equivalents(self) -> None:
        manifest = self.bundle["contexts"][0]
        manifest["lease_generation"] = 1.0
        digest_input = copy.deepcopy(manifest)
        digest_input.pop("manifest_digest")
        manifest["manifest_digest"] = digest(digest_input)

        self.assertEqual(error_code(self.bundle), "INTEGER_INVALID")

    def test_stale_task_revision_fails_closed(self) -> None:
        self.bundle["messages"][0]["input"]["task_packet_revision"] = 1

        self.assertEqual(error_code(self.bundle), "STALE_TASK_PACKET_REVISION")

    def test_duplicate_message_id_fails_closed(self) -> None:
        self.bundle["messages"][1]["message_id"] = self.bundle["messages"][0]["message_id"]
        rebind_message_evidence(self.bundle, self.bundle["messages"][1])

        self.assertEqual(error_code(self.bundle), "DUPLICATE_MESSAGE_ID")

    def test_gate_attempt_regression_fails_closed(self) -> None:
        lower_attempt = message(self.bundle, 10)
        higher_attempt = copy.deepcopy(lower_attempt)
        higher_attempt["message_id"] = "10000000-0000-4000-8000-000000000010"
        higher_attempt["message_type"] = "VETO"
        higher_attempt["status"] = "VETOED"
        higher_attempt["input"]["attempt"] = 2
        rebind_message_evidence(
            self.bundle,
            higher_attempt,
            locator="bundle://evidence/mutation-gate-regression",
        )
        self.bundle["messages"].insert(self.bundle["messages"].index(lower_attempt), higher_attempt)

        self.assertEqual(error_code(self.bundle), "GATE_ATTEMPT_SEQUENCE_INVALID")

    def test_message_stream_cannot_regress_to_old_candidate(self) -> None:
        old_message = copy.deepcopy(message(self.bundle, 5))
        old_message["message_id"] = "10000000-0000-4000-8000-000000000012"
        old_message["input"]["attempt"] = 2
        rebind_message_evidence(
            self.bundle,
            old_message,
            locator="bundle://evidence/mutation-old-candidate",
        )
        self.bundle["messages"].insert(-1, old_message)

        self.assertEqual(error_code(self.bundle), "MESSAGE_CANDIDATE_SEQUENCE_INVALID")

    def test_veto_cannot_be_overwritten_on_same_candidate(self) -> None:
        veto = message(self.bundle, 10)
        later_pass = copy.deepcopy(veto)
        veto["message_type"] = "VETO"
        veto["status"] = "VETOED"
        later_pass["message_id"] = "10000000-0000-4000-8000-000000000011"
        later_pass["input"]["attempt"] = 2
        rebind_message_evidence(
            self.bundle,
            later_pass,
            locator="bundle://evidence/mutation-veto-overwrite",
        )
        self.bundle["messages"].insert(self.bundle["messages"].index(veto) + 1, later_pass)

        self.assertEqual(error_code(self.bundle), "VETO_REQUIRES_NEW_CANDIDATE")

    def test_review_pass_requires_verification_message(self) -> None:
        message(self.bundle, 10)["message_type"] = "PLAN"

        self.assertEqual(error_code(self.bundle), "MESSAGE_TYPE_BINDING_INVALID")

    def test_qa_pass_requires_successful_test_evidence(self) -> None:
        qa_pass = message(self.bundle, 13)
        qa_pass["tests"][0].update({"result": "NOT_RUN", "exit_code": None, "artifact": None})

        self.assertEqual(error_code(self.bundle), "TEST_EVIDENCE_BINDING_INVALID")

    def test_test_result_and_exit_code_must_be_consistent(self) -> None:
        message(self.bundle, 13)["tests"][0]["exit_code"] = 1

        self.assertEqual(error_code(self.bundle), "TEST_RESULT_INCONSISTENT")

    def test_test_exit_code_must_match_bound_evidence(self) -> None:
        qa_pass = message(self.bundle, 13)
        qa_pass["evidence"][0]["exit_code"] = 7
        rebind_message_evidence(self.bundle, qa_pass)

        self.assertEqual(error_code(self.bundle), "TEST_EVIDENCE_EXIT_CODE_MISMATCH")

    def test_test_artifact_must_be_test_evidence(self) -> None:
        qa_pass = message(self.bundle, 13)
        qa_pass["evidence"][0]["kind"] = "FILE_SNAPSHOT"
        rebind_message_evidence(self.bundle, qa_pass)

        self.assertEqual(error_code(self.bundle), "TEST_EVIDENCE_KIND_INVALID")

    def test_result_unknown_test_still_requires_bound_evidence(self) -> None:
        unknown = message(self.bundle, 11)
        unknown["tests"][0]["artifact"] = None

        self.assertEqual(error_code(self.bundle), "TEST_RESULT_INCONSISTENT")

    def test_one_evidence_record_cannot_back_multiple_test_claims(self) -> None:
        qa_pass = message(self.bundle, 13)
        duplicate = copy.deepcopy(qa_pass["tests"][0])
        duplicate["id"] = "T-002"
        qa_pass["tests"].append(duplicate)

        self.assertEqual(error_code(self.bundle), "TEST_EVIDENCE_REUSED")

    def test_message_input_artifacts_must_equal_evidence_locators(self) -> None:
        message(self.bundle, 13)["input"]["artifacts"] = [
            "bundle://evidence/forged-input-only"
        ]

        self.assertEqual(error_code(self.bundle), "MESSAGE_ARTIFACT_BINDING_INVALID")

    def test_evidence_digest_must_match_registered_artifact(self) -> None:
        message(self.bundle, 13)["evidence"][0]["digest"] = "sha256:" + "0" * 64

        self.assertEqual(error_code(self.bundle), "EVIDENCE_DIGEST_MISMATCH")

    def test_unreferenced_artifact_registry_entry_fails_closed(self) -> None:
        payload = {"artifact_type": "FORGED_EXTRA"}
        self.bundle["artifacts"]["bundle://forged/extra"] = {
            "classification": "SYNTHETIC_TEST_EVIDENCE",
            "payload": payload,
            "digest": digest(payload),
        }

        self.assertEqual(error_code(self.bundle), "ARTIFACT_SET_MISMATCH")

    def test_duplicate_semantic_test_id_fails_closed(self) -> None:
        qa_pass = message(self.bundle, 13)
        qa_pass["tests"].append(copy.deepcopy(qa_pass["tests"][0]))

        self.assertEqual(error_code(self.bundle), "DUPLICATE_TEST_ID")

    def test_role_or_capability_mismatch_fails_closed(self) -> None:
        message(self.bundle, 10)["agent"]["capability_profile"] = "ERP_READ_ONLY"

        self.assertEqual(error_code(self.bundle), "ROLE_OR_GATE_MISMATCH")

    def test_reviewer_write_attempt_fails_closed(self) -> None:
        message(self.bundle, 10)["changes"] = [
            {"path": "docs/synthetic/security.md", "action": "MODIFY", "purpose": "unauthorized fix"}
        ]

        self.assertEqual(error_code(self.bundle), "REVIEWER_WRITE_ATTEMPT")

    def test_builder_change_outside_packet_scope_fails_closed(self) -> None:
        message(self.bundle, 1)["changes"][0]["path"] = "chenyida_erp_site/app/forbidden.ts"

        self.assertEqual(error_code(self.bundle), "CHANGE_PATH_OUT_OF_SCOPE")

    def test_builder_change_path_traversal_fails_closed(self) -> None:
        message(self.bundle, 1)["changes"][0]["path"] = "docs/agent-control/../forbidden.md"

        self.assertEqual(error_code(self.bundle), "CHANGE_PATH_INVALID")

    def test_builder_change_nested_git_segment_fails_closed(self) -> None:
        message(self.bundle, 1)["changes"][0]["path"] = "docs/agent-control/.git/config"

        self.assertEqual(error_code(self.bundle), "CHANGE_PATH_INVALID")

    def test_task_packet_equivalent_universal_glob_fails_closed(self) -> None:
        self.bundle["task_packet"]["scope"]["allowed_changed_paths"] = ["*/*"]

        self.assertEqual(error_code(self.bundle), "TASK_PACKET_INVALID")

    def test_manual_task_packet_validator_matches_recursive_pattern_length_bound(self) -> None:
        packet = build_task_packet()
        accepted_pattern = "a" * 509 + "/**"
        packet["scope"]["allowed_changed_paths"] = [accepted_pattern]

        self.assertEqual(
            validate_task_packet(packet)["scope"]["allowed_changed_paths"],
            [accepted_pattern],
        )

        rejected_pattern = "a" * 510 + "/**"
        packet["scope"]["allowed_changed_paths"] = [rejected_pattern]
        with self.assertRaises(ValueError):
            validate_task_packet(packet)

    def test_uat_or_database_evidence_kind_is_forbidden_by_r1_5(self) -> None:
        message(self.bundle, 10)["evidence"][0]["kind"] = "DATABASE_ASSERTION"

        self.assertEqual(error_code(self.bundle), "FORBIDDEN_EVIDENCE_KIND")

    def test_product_source_locator_is_forbidden(self) -> None:
        message(self.bundle, 10)["evidence"][0]["locator"] = "workspace://chenyida_erp_site/app/private.ts"

        self.assertEqual(error_code(self.bundle), "FORBIDDEN_CONTEXT_LOCATOR")

    def test_non_synthetic_evidence_scheme_is_forbidden(self) -> None:
        message(self.bundle, 10)["evidence"][0]["locator"] = "workspace://docs/synthetic.md"

        self.assertEqual(error_code(self.bundle), "NON_SYNTHETIC_LOCATOR")

    def test_black_box_source_context_fails_closed_even_with_fresh_digest(self) -> None:
        final_sha = self.bundle["expected"]["final_candidate_sha"]
        manifest = context(self.bundle, "BLACK_BOX_VERIFIER", final_sha)
        old_digest = manifest["manifest_digest"]
        manifest["documents"][0] = {
            "locator": "bundle://synthetic-candidate/private-view",
            "digest": digest(b"private synthetic source"),
            "classification": "SYNTHETIC_CANDIDATE",
        }
        digest_input = copy.deepcopy(manifest)
        digest_input.pop("manifest_digest")
        manifest["manifest_digest"] = digest(digest_input)
        message(self.bundle, 14)["agent"]["context_manifest_digest"] = manifest["manifest_digest"]
        self.assertNotEqual(old_digest, manifest["manifest_digest"])

        self.assertEqual(error_code(self.bundle), "BLACK_BOX_SOURCE_CONTEXT")

    def test_forged_context_artifact_fails_even_with_recomputed_digests(self) -> None:
        final_sha = self.bundle["expected"]["final_candidate_sha"]
        manifest = context(self.bundle, "ERP_CONTRACT_GUARDIAN", final_sha)
        forged_locator = "bundle://forged/unlisted-context"
        forged_payload = {"artifact_type": "SYNTHETIC_CONTRACT", "forged": True}
        forged_digest = digest(forged_payload)
        self.bundle["artifacts"][forged_locator] = {
            "classification": "SYNTHETIC_CONTRACT",
            "payload": forged_payload,
            "digest": forged_digest,
        }
        manifest["documents"][0] = {
            "locator": forged_locator,
            "digest": forged_digest,
            "classification": "SYNTHETIC_CONTRACT",
        }
        digest_input = copy.deepcopy(manifest)
        digest_input.pop("manifest_digest")
        manifest["manifest_digest"] = digest(digest_input)
        message(self.bundle, 8)["agent"]["context_manifest_digest"] = manifest[
            "manifest_digest"
        ]

        self.assertEqual(error_code(self.bundle), "CONTEXT_ARTIFACT_BINDING_INVALID")

    def test_context_payload_is_bound_to_role_and_candidate(self) -> None:
        final_sha = self.bundle["expected"]["final_candidate_sha"]
        manifest = context(self.bundle, "ERP_CONTRACT_GUARDIAN", final_sha)
        document = manifest["documents"][2]
        artifact = self.bundle["artifacts"][document["locator"]]
        artifact["payload"] = {"artifact_type": "SYNTHETIC_CONTEXT_EVIDENCE", "forged": True}
        artifact["digest"] = digest(artifact["payload"])
        document["digest"] = artifact["digest"]
        digest_input = copy.deepcopy(manifest)
        digest_input.pop("manifest_digest")
        manifest["manifest_digest"] = digest(digest_input)
        message(self.bundle, 8)["agent"]["context_manifest_digest"] = manifest[
            "manifest_digest"
        ]

        self.assertEqual(error_code(self.bundle), "CONTEXT_ARTIFACT_BINDING_INVALID")

    def test_black_box_source_evidence_fails_closed(self) -> None:
        black_box = message(self.bundle, 14)
        black_box["input"]["artifacts"] = ["git://private-source"]

        self.assertEqual(error_code(self.bundle), "BLACK_BOX_SOURCE_CONTEXT")

    def test_old_candidate_pass_cannot_satisfy_final_gate(self) -> None:
        old_qa = message(self.bundle, 5)
        old_qa["status"] = "PASS"
        old_qa["tests"][0]["result"] = "PASS"
        old_qa["tests"][0]["exit_code"] = 0
        old_qa["evidence"][0]["exit_code"] = 0
        rebind_message_evidence(self.bundle, old_qa)
        self.bundle["messages"].remove(message(self.bundle, 13))

        self.assertEqual(error_code(self.bundle), "REJECTED_CANDIDATE_GATE_MISSING")

    def test_pilot_cannot_omit_rejected_candidate(self) -> None:
        self.bundle["candidates"] = [self.bundle["candidates"][1]]

        self.assertEqual(error_code(self.bundle), "PILOT_TWO_CANDIDATES_REQUIRED")

    def test_pilot_requires_adversarial_minority_exercise(self) -> None:
        self.bundle["messages"].remove(message(self.bundle, 3))
        message(self.bundle, 9)["resolves_claim_ids"] = []
        message(self.bundle, 6)["checkpoint"]["completed_message_ids"].remove(
            "00000000-0000-4000-8000-000000000003"
        )
        self.bundle["expected"]["minority_claims_resolved"] = []

        self.assertEqual(error_code(self.bundle), "MINORITY_REPORT_MISSING")

    def test_security_role_cannot_substitute_for_required_minority_report(self) -> None:
        minority = message(self.bundle, 3)
        security = message(self.bundle, 4)
        minority["agent"] = copy.deepcopy(security["agent"])
        minority["role"] = "SECURITY_BOUNDARY_EXAMINER"
        minority["gate"] = "SECURITY"
        rebind_message_evidence(self.bundle, minority)

        self.assertEqual(error_code(self.bundle), "MESSAGE_TYPE_BINDING_INVALID")

    def test_failing_finding_cannot_resolve_minority_claim(self) -> None:
        disposition = message(self.bundle, 9)
        disposition["message_type"] = "FINDING"
        disposition["status"] = "FAIL"

        self.assertEqual(error_code(self.bundle), "MINORITY_DISPOSITION_INVALID")

    def test_unresolved_minority_report_fails_closed(self) -> None:
        message(self.bundle, 9)["resolves_claim_ids"] = []

        self.assertEqual(error_code(self.bundle), "MINORITY_REPORT_UNRESOLVED")

    def test_minority_disposition_must_be_a_passing_verification(self) -> None:
        message(self.bundle, 9)["status"] = "FAIL"

        self.assertEqual(error_code(self.bundle), "MINORITY_DISPOSITION_INVALID")

    def test_stale_lease_generation_fails_closed(self) -> None:
        message(self.bundle, 10)["input"]["lease_generation"] = 2

        self.assertEqual(error_code(self.bundle), "STALE_LEASE_GENERATION")

    def test_result_unknown_cannot_be_replayed_before_reconciliation(self) -> None:
        self.bundle["messages"].remove(message(self.bundle, 12))

        self.assertEqual(error_code(self.bundle), "RESULT_UNKNOWN_REPLAY_FORBIDDEN")

    def test_result_unknown_must_be_resolved_even_without_replay(self) -> None:
        self.bundle["messages"].remove(message(self.bundle, 12))
        self.bundle["messages"].remove(message(self.bundle, 13))

        self.assertEqual(error_code(self.bundle), "RESULT_UNKNOWN_UNRESOLVED")

    def test_result_unknown_cannot_receive_duplicate_dispositions(self) -> None:
        duplicate_recovery = copy.deepcopy(message(self.bundle, 12))
        duplicate_recovery["message_id"] = "10000000-0000-4000-8000-000000000013"
        duplicate_recovery["input"]["attempt"] = 2
        rebind_message_evidence(
            self.bundle,
            duplicate_recovery,
            locator="bundle://evidence/mutation-duplicate-recovery",
        )
        self.bundle["messages"].insert(self.bundle["messages"].index(message(self.bundle, 13)), duplicate_recovery)

        self.assertEqual(error_code(self.bundle), "RESULT_UNKNOWN_ALREADY_RESOLVED")

    def test_pilot_requires_result_unknown_recovery_exercise(self) -> None:
        self.bundle["messages"].remove(message(self.bundle, 11))
        self.bundle["messages"].remove(message(self.bundle, 12))
        message(self.bundle, 13)["input"]["attempt"] = 1
        self.bundle["expected"]["result_unknown_resolved"] = []

        self.assertEqual(error_code(self.bundle), "RESULT_UNKNOWN_EXERCISE_MISSING")

    def test_duplicate_json_key_is_rejected_before_protocol_validation(self) -> None:
        with tempfile.TemporaryDirectory(prefix="agent-r1-5-duplicate-key-") as temporary:
            bundle_path = Path(temporary) / "bundle.json"
            bundle_path.write_text('{"schema_version":"a","schema_version":"b"}', encoding="utf-8")

            with self.assertRaisesRegex(Exception, "DUPLICATE_JSON_KEY"):
                load_bundle(bundle_path)

    def test_non_json_numeric_constant_is_rejected_before_validation(self) -> None:
        with tempfile.TemporaryDirectory(prefix="agent-r1-5-non-json-number-") as temporary:
            bundle_path = Path(temporary) / "bundle.json"
            bundle_path.write_text('{"schema_version":NaN}', encoding="utf-8")

            with self.assertRaisesRegex(Exception, "BUNDLE_JSON_INVALID"):
                load_bundle(bundle_path)

    def test_unpaired_unicode_surrogate_fails_without_exception_leak(self) -> None:
        message(self.bundle, 1)["recommendation"]["reason"] = "\ud800"

        report = validate_bundle(self.bundle)

        self.assertEqual(report["status"], "FAIL")
        self.assertEqual(report["errors"], [{"code": "BUNDLE_INVALID", "subject": "bundle"}])

    def test_checkpoint_cannot_claim_future_message(self) -> None:
        message(self.bundle, 6)["checkpoint"]["completed_message_ids"].append(
            "00000000-0000-4000-8000-000000000007"
        )

        self.assertEqual(error_code(self.bundle), "CHECKPOINT_BINDING_INVALID")

    def test_checkpoint_type_is_bound_to_implementation_gate(self) -> None:
        message(self.bundle, 6)["gate"] = "RECOVERY"

        self.assertEqual(error_code(self.bundle), "MESSAGE_TYPE_BINDING_INVALID")

    def test_recovery_type_is_bound_to_recovery_gate(self) -> None:
        message(self.bundle, 12)["gate"] = "IMPLEMENTATION"

        self.assertEqual(error_code(self.bundle), "MESSAGE_TYPE_BINDING_INVALID")

    def test_closure_type_is_bound_to_closure_gate_and_complete_status(self) -> None:
        closure = message(self.bundle, 15)
        closure["gate"] = "IMPLEMENTATION"
        closure["input"]["attempt"] = 2

        self.assertEqual(error_code(self.bundle), "MESSAGE_TYPE_BINDING_INVALID")

    def test_closure_must_be_the_final_message(self) -> None:
        closure = message(self.bundle, 15)
        self.bundle["messages"].remove(closure)
        self.bundle["messages"].insert(self.bundle["messages"].index(message(self.bundle, 14)), closure)

        self.assertEqual(error_code(self.bundle), "MESSAGE_AFTER_CLOSURE")

    def test_cli_is_json_only_deterministic_and_read_only(self) -> None:
        with tempfile.TemporaryDirectory(prefix="agent-r1-5-cli-") as temporary:
            root = Path(temporary)
            bundle_path = root / "bundle.json"
            bundle_path.write_text(json.dumps(self.bundle, ensure_ascii=False), encoding="utf-8")
            before = filesystem_snapshot(root)
            environment = os.environ.copy()
            environment["PYTHONDONTWRITEBYTECODE"] = "1"
            command = [sys.executable, "-B", str(VALIDATOR_PATH), "--bundle", str(bundle_path)]

            first = subprocess.run(
                command,
                cwd=root,
                env=environment,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                timeout=15,
            )
            second = subprocess.run(
                command,
                cwd=root,
                env=environment,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                timeout=15,
            )
            after = filesystem_snapshot(root)

        self.assertEqual(first.returncode, 0)
        self.assertEqual(first.stderr, b"")
        self.assertEqual(first.stdout, second.stdout)
        self.assertEqual(json.loads(first.stdout)["status"], "PASS")
        self.assertEqual(before, after)

    def test_explicit_bundle_symlink_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="agent-r1-5-link-") as temporary:
            root = Path(temporary)
            target = root / "target.json"
            target.write_text(json.dumps(self.bundle), encoding="utf-8")
            link = root / "bundle.json"
            link.symlink_to(target)

            with self.assertRaisesRegex(Exception, "BUNDLE_FILE_UNSAFE"):
                load_bundle(link)

    def test_explicit_bundle_hardlink_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="agent-r1-5-hardlink-") as temporary:
            root = Path(temporary)
            target = root / "target.json"
            target.write_text(json.dumps(self.bundle), encoding="utf-8")
            link = root / "bundle.json"
            os.link(target, link)

            with self.assertRaisesRegex(Exception, "BUNDLE_FILE_UNSAFE"):
                load_bundle(link)

    def test_bundle_below_symlinked_directory_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="agent-r1-5-parent-link-") as temporary:
            root = Path(temporary)
            target = root / "target"
            target.mkdir()
            (target / "bundle.json").write_text(json.dumps(self.bundle), encoding="utf-8")
            linked_directory = root / "linked"
            linked_directory.symlink_to(target, target_is_directory=True)

            with self.assertRaisesRegex(Exception, "BUNDLE_FILE_UNSAFE"):
                load_bundle(linked_directory / "bundle.json")


if __name__ == "__main__":
    unittest.main()
