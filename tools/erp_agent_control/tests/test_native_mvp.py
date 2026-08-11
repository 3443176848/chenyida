from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

from tools.erp_agent_control.native_mvp import load_bundle, validate_bundle
from tools.erp_agent_control.pilot_fixture import build_task_packet, build_valid_bundle, digest


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

    def test_unknown_field_fails_closed(self) -> None:
        self.bundle["messages"][0]["authority"] = "invented"

        self.assertEqual(error_code(self.bundle), "UNKNOWN_FIELD")

    def test_message_schema_max_length_is_enforced(self) -> None:
        self.bundle["messages"][0]["evidence"][0]["locator"] = "x" * 513

        self.assertEqual(error_code(self.bundle), "STRING_TOO_LONG")

    def test_invalid_rfc3339_timestamp_fails_closed(self) -> None:
        self.bundle["messages"][0]["created_at"] = "2026-08-11 06:00:00Z"

        self.assertEqual(error_code(self.bundle), "FORMAT_INVALID")

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

    def test_stale_task_revision_fails_closed(self) -> None:
        self.bundle["messages"][0]["input"]["task_packet_revision"] = 1

        self.assertEqual(error_code(self.bundle), "STALE_TASK_PACKET_REVISION")

    def test_duplicate_message_id_fails_closed(self) -> None:
        self.bundle["messages"][1]["message_id"] = self.bundle["messages"][0]["message_id"]

        self.assertEqual(error_code(self.bundle), "DUPLICATE_MESSAGE_ID")

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

    def test_uat_or_database_evidence_kind_is_forbidden_by_r1_5(self) -> None:
        message(self.bundle, 10)["evidence"][0]["kind"] = "DATABASE_ASSERTION"

        self.assertEqual(error_code(self.bundle), "FORBIDDEN_EVIDENCE_KIND")

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

    def test_old_candidate_pass_cannot_satisfy_final_gate(self) -> None:
        old_qa = message(self.bundle, 5)
        old_qa["status"] = "PASS"
        old_qa["tests"][0]["result"] = "PASS"
        old_qa["tests"][0]["exit_code"] = 0
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

    def test_unresolved_minority_report_fails_closed(self) -> None:
        message(self.bundle, 9)["resolves_claim_ids"] = []

        self.assertEqual(error_code(self.bundle), "MINORITY_REPORT_UNRESOLVED")

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

    def test_pilot_requires_result_unknown_recovery_exercise(self) -> None:
        self.bundle["messages"].remove(message(self.bundle, 11))
        self.bundle["messages"].remove(message(self.bundle, 12))
        self.bundle["expected"]["result_unknown_resolved"] = []

        self.assertEqual(error_code(self.bundle), "RESULT_UNKNOWN_EXERCISE_MISSING")

    def test_duplicate_json_key_is_rejected_before_protocol_validation(self) -> None:
        with tempfile.TemporaryDirectory(prefix="agent-r1-5-duplicate-key-") as temporary:
            bundle_path = Path(temporary) / "bundle.json"
            bundle_path.write_text('{"schema_version":"a","schema_version":"b"}', encoding="utf-8")

            with self.assertRaisesRegex(Exception, "DUPLICATE_JSON_KEY"):
                load_bundle(bundle_path)

    def test_checkpoint_cannot_claim_future_message(self) -> None:
        message(self.bundle, 6)["checkpoint"]["completed_message_ids"].append(
            "00000000-0000-4000-8000-000000000007"
        )

        self.assertEqual(error_code(self.bundle), "CHECKPOINT_BINDING_INVALID")

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
