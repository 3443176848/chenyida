#!/usr/bin/env python3
"""Stateless validator for the synthetic R1.5 native-orchestration pilot.

The validator reads one explicitly supplied local JSON bundle, performs strict
structural and cross-message checks, writes no state, and emits one deterministic
JSON report. It has no network, database, subprocess, or Git capability.
"""

from __future__ import annotations

import argparse
import copy
from datetime import datetime
import fnmatch
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
from typing import Any, Iterable
import uuid

sys.dont_write_bytecode = True

try:
    from .readonly_controller import validate_task_packet
except ImportError:  # Direct script execution.
    from readonly_controller import validate_task_packet

VALIDATOR_VERSION = "0.4.0"
BUNDLE_SCHEMA = "chenyida-erp-native-pilot-bundle/v1"
REPORT_SCHEMA = "chenyida-erp-native-pilot-report/v1"
CONTEXT_SCHEMA = "erp-agent-context/v1"
MESSAGE_SCHEMA = "erp-agent-message/v1"
MAX_BUNDLE_BYTES = 2 * 1024 * 1024

TASK_ID_RE = re.compile(r"^[A-Z][A-Z0-9-]{0,63}$")
AGENT_ID_RE = re.compile(r"^[a-z][a-z0-9-]{2,63}$")
SHA1_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_REF_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
CANDIDATE_RE = re.compile(r"^(?:[0-9a-f]{40}|sha256:[0-9a-f]{64})$")
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
RFC3339_RE = re.compile(
    r"^(?!0000-)[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])"
    r"T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]"
    r"(?:\.[0-9]+)?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$"
)
IDENTIFIER_PATTERNS = {
    "assumption": re.compile(r"^A-[0-9]{3}$"),
    "evidence": re.compile(r"^E-[0-9]{3}$"),
    "test": re.compile(r"^T-[0-9]{3}$"),
    "risk": re.compile(r"^R-[0-9]{3}$"),
    "blocker": re.compile(r"^B-[0-9]{3}$"),
    "minority": re.compile(r"^MR-[0-9]{3}$"),
}

ROLES = frozenset(
    {
        "CHANGE_BUILDER",
        "ERP_CONTRACT_GUARDIAN",
        "ADVERSARIAL_EXAMINER",
        "SECURITY_BOUNDARY_EXAMINER",
        "INDEPENDENT_VERIFIER",
        "BLACK_BOX_VERIFIER",
    }
)
ROLE_GATES = {
    "CHANGE_BUILDER": frozenset({"IMPLEMENTATION", "RECOVERY", "CLOSURE"}),
    "ERP_CONTRACT_GUARDIAN": frozenset({"ERP_CONTRACT"}),
    "ADVERSARIAL_EXAMINER": frozenset({"ADVERSARIAL"}),
    "SECURITY_BOUNDARY_EXAMINER": frozenset({"SECURITY"}),
    "INDEPENDENT_VERIFIER": frozenset({"QA"}),
    "BLACK_BOX_VERIFIER": frozenset({"BLACK_BOX"}),
}
MESSAGE_TYPES = frozenset(
    {
        "PLAN",
        "HANDOFF",
        "FINDING",
        "VERIFICATION",
        "VETO",
        "MINORITY_REPORT",
        "CHECKPOINT",
        "RECOVERY",
        "CLOSURE",
    }
)
STATUSES = frozenset(
    {"IN_PROGRESS", "PASS", "FAIL", "VETOED", "BLOCKED", "COMPLETE", "RESULT_UNKNOWN"}
)
EVIDENCE_KINDS = frozenset(
    {
        "GIT_OBJECT",
        "FILE_SNAPSHOT",
        "COMMAND_RESULT",
        "TEST_REPORT",
        "DATABASE_ASSERTION",
        "HTTP_OBSERVATION",
        "HUMAN_AUTHORIZATION",
        "RESOURCE_SNAPSHOT",
        "BLACK_BOX_OBSERVATION",
    }
)
FORBIDDEN_CONTEXT = frozenset(
    {
        "OWNER_UNTRACKED_INPUT",
        "PRODUCT_SOURCE",
        "GIT_INTERNALS",
        "REAL_BUSINESS_DATA",
        "SECRETS",
        "UAT_OR_PRODUCTION",
    }
)
PUBLIC_CLASSIFICATIONS = frozenset(
    {"PUBLIC_INTERFACE", "PUBLIC_PERSONA", "PUBLIC_OBSERVATION"}
)
ALL_CLASSIFICATIONS = PUBLIC_CLASSIFICATIONS | frozenset(
    {"SYNTHETIC_CONTRACT", "SYNTHETIC_CANDIDATE", "SYNTHETIC_TEST_EVIDENCE"}
)
REQUIRED_FINAL_GATES = ("ERP_CONTRACT", "SECURITY", "QA", "BLACK_BOX")
REVIEW_GATES = frozenset({*REQUIRED_FINAL_GATES, "ADVERSARIAL"})
FORBIDDEN_LOCATOR_PREFIXES = (
    "http://",
    "https://",
    "mysql://",
    "postgres://",
    "postgresql://",
    "prod://",
    "production://",
    "secret://",
    "sqlite://",
    "uat://",
)
FORBIDDEN_LOCATOR_FRAGMENTS = (
    "chenyida_erp_app/",
    "chenyida_erp_site/",
    "erp_current_status_report",
    "product-source",
)


class ProtocolProblem(Exception):
    """A sanitized, deterministic validation failure."""

    def __init__(self, code: str, subject: str):
        super().__init__(code)
        self.code = code
        self.subject = subject


def _pairs_without_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ProtocolProblem("DUPLICATE_JSON_KEY", key)
        result[key] = value
    return result


def _reject_json_constant(value: str) -> None:
    raise ProtocolProblem("BUNDLE_JSON_INVALID", "bundle")


def _canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _sha256_ref(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def _object(value: Any, keys: set[str], subject: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ProtocolProblem("OBJECT_REQUIRED", subject)
    missing = sorted(keys - set(value))
    unknown = sorted(set(value) - keys)
    if missing:
        raise ProtocolProblem("REQUIRED_FIELD_MISSING", f"{subject}.{missing[0]}")
    if unknown:
        raise ProtocolProblem("UNKNOWN_FIELD", f"{subject}.{unknown[0]}")
    return value


def _string(
    value: Any,
    subject: str,
    *,
    choices: Iterable[str] | None = None,
    pattern: re.Pattern[str] | None = None,
    maximum: int | None = None,
) -> str:
    if not isinstance(value, str) or not value:
        raise ProtocolProblem("STRING_REQUIRED", subject)
    if choices is not None and value not in set(choices):
        raise ProtocolProblem("ENUM_INVALID", subject)
    if pattern is not None and pattern.fullmatch(value) is None:
        raise ProtocolProblem("FORMAT_INVALID", subject)
    if maximum is not None and len(value) > maximum:
        raise ProtocolProblem("STRING_TOO_LONG", subject)
    return value


def _integer(value: Any, subject: str, *, minimum: int = 0, maximum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ProtocolProblem("INTEGER_INVALID", subject)
    if maximum is not None and value > maximum:
        raise ProtocolProblem("INTEGER_INVALID", subject)
    return value


def _string_list(
    value: Any,
    subject: str,
    *,
    choices: Iterable[str] | None = None,
    pattern: re.Pattern[str] | None = None,
    maximum: int | None = None,
) -> list[str]:
    if not isinstance(value, list):
        raise ProtocolProblem("ARRAY_REQUIRED", subject)
    result: list[str] = []
    for index, item in enumerate(value):
        result.append(
            _string(
                item,
                f"{subject}[{index}]",
                choices=choices,
                pattern=pattern,
                maximum=maximum,
            )
        )
    if len(result) != len(set(result)):
        raise ProtocolProblem("DUPLICATE_ARRAY_ITEM", subject)
    return result


def _timestamp(value: Any, subject: str) -> str:
    timestamp = _string(value, subject, pattern=RFC3339_RE)
    try:
        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ProtocolProblem("TIMESTAMP_INVALID", subject) from exc
    if parsed.tzinfo is None:
        raise ProtocolProblem("TIMESTAMP_INVALID", subject)
    return timestamp


def _uuid(value: Any, subject: str) -> str:
    identifier = _string(value, subject, pattern=UUID_RE)
    try:
        if str(uuid.UUID(identifier)) != identifier:
            raise ValueError
    except ValueError as exc:
        raise ProtocolProblem("UUID_INVALID", subject) from exc
    return identifier


def _identifier(value: Any, subject: str, kind: str) -> str:
    return _string(value, subject, pattern=IDENTIFIER_PATTERNS[kind])


def _repository_path(value: Any, subject: str) -> str:
    path = _string(value, subject, maximum=512)
    if path.startswith("/") or path.endswith("/") or "\\" in path or "\x00" in path:
        raise ProtocolProblem("CHANGE_PATH_INVALID", subject)
    if any(part in {"", ".", ".."} for part in path.split("/")):
        raise ProtocolProblem("CHANGE_PATH_INVALID", subject)
    parsed = PurePosixPath(path)
    if any(part in {"", ".", ".."} for part in parsed.parts) or parsed.parts[0] == ".git":
        raise ProtocolProblem("CHANGE_PATH_INVALID", subject)
    if any(character in path for character in "*?["):
        raise ProtocolProblem("CHANGE_PATH_INVALID", subject)
    return path


def _validate_locator(value: Any, subject: str, *, black_box: bool = False) -> str:
    locator = _string(value, subject, maximum=512)
    lowered = locator.lower()
    if (
        any(lowered.startswith(prefix) for prefix in FORBIDDEN_LOCATOR_PREFIXES)
        or any(fragment in lowered for fragment in FORBIDDEN_LOCATOR_FRAGMENTS)
        or ".git/" in lowered
        or lowered.endswith("/.git")
    ):
        raise ProtocolProblem("FORBIDDEN_CONTEXT_LOCATOR", subject)
    if black_box and not locator.startswith("blackbox://"):
        raise ProtocolProblem("BLACK_BOX_SOURCE_CONTEXT", subject)
    return locator


def _validate_candidate(raw: Any, index: int, expected_parent: str) -> dict[str, Any]:
    subject = f"candidates[{index}]"
    candidate = _object(
        raw,
        {"revision", "parent_sha", "candidate_sha", "disposition", "content"},
        subject,
    )
    revision = _integer(candidate["revision"], f"{subject}.revision", minimum=1)
    if revision != index + 1:
        raise ProtocolProblem("CANDIDATE_REVISION_GAP", subject)
    parent_sha = _string(candidate["parent_sha"], f"{subject}.parent_sha", pattern=CANDIDATE_RE)
    if parent_sha != expected_parent:
        raise ProtocolProblem("CANDIDATE_PARENT_MISMATCH", subject)
    candidate_sha = _string(
        candidate["candidate_sha"], f"{subject}.candidate_sha", pattern=SHA256_REF_RE
    )
    disposition = _string(
        candidate["disposition"], f"{subject}.disposition", choices={"REJECTED", "FINAL"}
    )
    content = _object(
        candidate["content"],
        {
            "contract_version",
            "duplicate_request_behavior",
            "timeout_recovery_behavior",
            "data_classification",
        },
        f"{subject}.content",
    )
    _string(content["contract_version"], f"{subject}.content.contract_version", maximum=128)
    _string(
        content["duplicate_request_behavior"],
        f"{subject}.content.duplicate_request_behavior",
        choices={"DOUBLE_APPLY", "IDEMPOTENT_REPLAY"},
    )
    _string(
        content["timeout_recovery_behavior"],
        f"{subject}.content.timeout_recovery_behavior",
        choices={"BLIND_REPLAY", "RECONCILE_BEFORE_REPLAY"},
    )
    if content["data_classification"] != "SYNTHETIC_ONLY":
        raise ProtocolProblem("DATA_CLASSIFICATION_VIOLATION", f"{subject}.content")
    if candidate_sha != _sha256_ref(_canonical_json(content)):
        raise ProtocolProblem("CANDIDATE_DIGEST_MISMATCH", subject)
    return {
        "revision": revision,
        "parent_sha": parent_sha,
        "candidate_sha": candidate_sha,
        "disposition": disposition,
        "content": content,
    }


def _validate_context(
    raw: Any,
    index: int,
    packet: dict[str, Any],
    candidates: set[str],
    assignments: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    subject = f"contexts[{index}]"
    manifest = _object(
        raw,
        {
            "schema_version",
            "task_id",
            "task_packet_revision",
            "agent_id",
            "instance_id",
            "role",
            "capability_profile",
            "candidate_sha",
            "lease_generation",
            "visibility",
            "documents",
            "forbidden_context",
            "manifest_digest",
        },
        subject,
    )
    if manifest["schema_version"] != CONTEXT_SCHEMA:
        raise ProtocolProblem("CONTEXT_SCHEMA_UNSUPPORTED", subject)
    if manifest["task_id"] != packet["task"]["id"]:
        raise ProtocolProblem("CONTEXT_TASK_MISMATCH", subject)
    _integer(manifest["task_packet_revision"], f"{subject}.task_packet_revision", minimum=1)
    if manifest["task_packet_revision"] != packet["task"]["revision"]:
        raise ProtocolProblem("STALE_TASK_PACKET_REVISION", subject)
    agent_id = _string(manifest["agent_id"], f"{subject}.agent_id", pattern=AGENT_ID_RE)
    assignment = assignments.get(agent_id)
    if assignment is None:
        raise ProtocolProblem("AGENT_NOT_ASSIGNED", subject)
    instance_id = _string(manifest["instance_id"], f"{subject}.instance_id", pattern=AGENT_ID_RE)
    role = _string(manifest["role"], f"{subject}.role", choices=ROLES)
    profile = _string(manifest["capability_profile"], f"{subject}.capability_profile")
    visibility = _string(
        manifest["visibility"],
        f"{subject}.visibility",
        choices={"SYNTHETIC_PROTOCOL_ONLY", "BLACK_BOX_PUBLIC_ONLY"},
    )
    if (
        role != assignment["role"]
        or profile != assignment["capability_profile"]
        or visibility != assignment["context_visibility"]
    ):
        raise ProtocolProblem("CONTEXT_ROLE_MISMATCH", subject)
    candidate_sha = _string(
        manifest["candidate_sha"], f"{subject}.candidate_sha", pattern=CANDIDATE_RE
    )
    if candidate_sha not in candidates:
        raise ProtocolProblem("CONTEXT_CANDIDATE_UNKNOWN", subject)
    _integer(manifest["lease_generation"], f"{subject}.lease_generation", minimum=1)
    if manifest["lease_generation"] != packet["orchestration"]["active_lease_generation"]:
        raise ProtocolProblem("STALE_LEASE_GENERATION", subject)

    documents = manifest["documents"]
    if not isinstance(documents, list) or not documents:
        raise ProtocolProblem("CONTEXT_DOCUMENTS_REQUIRED", subject)
    document_locators: set[str] = set()
    for document_index, raw_document in enumerate(documents):
        document_subject = f"{subject}.documents[{document_index}]"
        document = _object(raw_document, {"locator", "digest", "classification"}, document_subject)
        locator = _validate_locator(document["locator"], f"{document_subject}.locator")
        if locator in document_locators:
            raise ProtocolProblem("DUPLICATE_CONTEXT_DOCUMENT", document_subject)
        document_locators.add(locator)
        _string(document["digest"], f"{document_subject}.digest", pattern=SHA256_REF_RE)
        classification = _string(
            document["classification"],
            f"{document_subject}.classification",
            choices=ALL_CLASSIFICATIONS,
        )
        if visibility == "BLACK_BOX_PUBLIC_ONLY" and (
            classification not in PUBLIC_CLASSIFICATIONS or not locator.startswith("blackbox://")
        ):
            raise ProtocolProblem("BLACK_BOX_SOURCE_CONTEXT", document_subject)
        if visibility == "SYNTHETIC_PROTOCOL_ONLY" and not locator.startswith("bundle://"):
            raise ProtocolProblem("NON_SYNTHETIC_LOCATOR", document_subject)

    forbidden_context = set(
        _string_list(
            manifest["forbidden_context"],
            f"{subject}.forbidden_context",
            choices=FORBIDDEN_CONTEXT,
        )
    )
    if forbidden_context != set(FORBIDDEN_CONTEXT):
        raise ProtocolProblem("FORBIDDEN_CONTEXT_INCOMPLETE", subject)
    digest = _string(manifest["manifest_digest"], f"{subject}.manifest_digest", pattern=SHA256_REF_RE)
    digest_input = copy.deepcopy(manifest)
    digest_input.pop("manifest_digest")
    if digest != _sha256_ref(_canonical_json(digest_input)):
        raise ProtocolProblem("CONTEXT_DIGEST_MISMATCH", subject)
    return {
        "agent_id": agent_id,
        "candidate_sha": candidate_sha,
        "digest": digest,
        "instance_id": instance_id,
        "manifest": manifest,
        "profile": profile,
        "role": role,
        "visibility": visibility,
    }


def _validate_evidence(raw: Any, subject: str) -> dict[str, Any]:
    evidence = _object(
        raw,
        {"id", "kind", "locator", "digest", "exit_code", "observed_at", "redaction"},
        subject,
    )
    _identifier(evidence["id"], f"{subject}.id", "evidence")
    _string(evidence["kind"], f"{subject}.kind", choices=EVIDENCE_KINDS)
    if evidence["kind"] in {"DATABASE_ASSERTION", "HTTP_OBSERVATION"}:
        raise ProtocolProblem("FORBIDDEN_EVIDENCE_KIND", subject)
    _validate_locator(evidence["locator"], f"{subject}.locator")
    _string(evidence["digest"], f"{subject}.digest", pattern=SHA256_REF_RE)
    if evidence["exit_code"] is not None:
        _integer(evidence["exit_code"], f"{subject}.exit_code", minimum=-255, maximum=255)
    _timestamp(evidence["observed_at"], f"{subject}.observed_at")
    _string(evidence["redaction"], f"{subject}.redaction", maximum=512)
    return evidence


def _validate_message_structure(raw: Any, index: int) -> dict[str, Any]:
    subject = f"messages[{index}]"
    message = _object(
        raw,
        {
            "schema_version",
            "message_id",
            "message_type",
            "created_at",
            "task_id",
            "agent",
            "role",
            "gate",
            "input",
            "assumptions",
            "evidence",
            "changes",
            "tests",
            "risks",
            "blockers",
            "recommendation",
            "status",
            "minority_report",
            "resolves_message_ids",
            "resolves_claim_ids",
            "checkpoint",
        },
        subject,
    )
    if message["schema_version"] != MESSAGE_SCHEMA:
        raise ProtocolProblem("MESSAGE_SCHEMA_UNSUPPORTED", subject)
    _uuid(message["message_id"], f"{subject}.message_id")
    _string(message["message_type"], f"{subject}.message_type", choices=MESSAGE_TYPES)
    _timestamp(message["created_at"], f"{subject}.created_at")
    _string(message["task_id"], f"{subject}.task_id", pattern=TASK_ID_RE)
    agent = _object(
        message["agent"],
        {"agent_id", "instance_id", "capability_profile", "context_manifest_digest"},
        f"{subject}.agent",
    )
    _string(agent["agent_id"], f"{subject}.agent.agent_id", pattern=AGENT_ID_RE)
    _string(agent["instance_id"], f"{subject}.agent.instance_id", pattern=AGENT_ID_RE)
    _string(agent["capability_profile"], f"{subject}.agent.capability_profile")
    _string(
        agent["context_manifest_digest"],
        f"{subject}.agent.context_manifest_digest",
        pattern=SHA256_REF_RE,
    )
    _string(message["role"], f"{subject}.role", choices=ROLES)
    _string(
        message["gate"],
        f"{subject}.gate",
        choices={gate for gates in ROLE_GATES.values() for gate in gates},
    )
    message_input = _object(
        message["input"],
        {"base_sha", "candidate_sha", "task_packet_revision", "lease_generation", "attempt", "artifacts"},
        f"{subject}.input",
    )
    _string(message_input["base_sha"], f"{subject}.input.base_sha", pattern=SHA1_RE)
    _string(message_input["candidate_sha"], f"{subject}.input.candidate_sha", pattern=CANDIDATE_RE)
    _integer(message_input["task_packet_revision"], f"{subject}.input.task_packet_revision", minimum=1)
    _integer(message_input["lease_generation"], f"{subject}.input.lease_generation", minimum=1)
    _integer(message_input["attempt"], f"{subject}.input.attempt", minimum=1)
    artifacts = _string_list(
        message_input["artifacts"], f"{subject}.input.artifacts", maximum=512
    )
    for artifact_index, artifact in enumerate(artifacts):
        _validate_locator(artifact, f"{subject}.input.artifacts[{artifact_index}]")

    if not isinstance(message["assumptions"], list):
        raise ProtocolProblem("ARRAY_REQUIRED", f"{subject}.assumptions")
    assumption_ids: set[str] = set()
    for assumption_index, raw_assumption in enumerate(message["assumptions"]):
        assumption_subject = f"{subject}.assumptions[{assumption_index}]"
        assumption = _object(raw_assumption, {"id", "statement", "status", "source"}, assumption_subject)
        assumption_id = _identifier(assumption["id"], f"{assumption_subject}.id", "assumption")
        if assumption_id in assumption_ids:
            raise ProtocolProblem("DUPLICATE_ASSUMPTION_ID", assumption_subject)
        assumption_ids.add(assumption_id)
        _string(assumption["statement"], f"{assumption_subject}.statement", maximum=1024)
        _string(assumption["status"], f"{assumption_subject}.status", choices={"VERIFIED", "PENDING"})
        if assumption["source"] is not None:
            _string(assumption["source"], f"{assumption_subject}.source", maximum=512)

    if not isinstance(message["evidence"], list):
        raise ProtocolProblem("ARRAY_REQUIRED", f"{subject}.evidence")
    evidence = [
        _validate_evidence(item, f"{subject}.evidence[{evidence_index}]")
        for evidence_index, item in enumerate(message["evidence"])
    ]
    evidence_ids = [item["id"] for item in evidence]
    if len(evidence_ids) != len(set(evidence_ids)):
        raise ProtocolProblem("DUPLICATE_EVIDENCE_ID", subject)

    if not isinstance(message["changes"], list):
        raise ProtocolProblem("ARRAY_REQUIRED", f"{subject}.changes")
    change_paths: set[str] = set()
    for change_index, raw_change in enumerate(message["changes"]):
        change_subject = f"{subject}.changes[{change_index}]"
        change = _object(raw_change, {"path", "action", "purpose"}, change_subject)
        change_path = _repository_path(change["path"], f"{change_subject}.path")
        if change_path in change_paths:
            raise ProtocolProblem("DUPLICATE_CHANGE_PATH", change_subject)
        change_paths.add(change_path)
        _string(change["action"], f"{change_subject}.action", choices={"ADD", "MODIFY", "DELETE"})
        _string(change["purpose"], f"{change_subject}.purpose", maximum=1024)

    if not isinstance(message["tests"], list):
        raise ProtocolProblem("ARRAY_REQUIRED", f"{subject}.tests")
    test_ids: set[str] = set()
    for test_index, raw_test in enumerate(message["tests"]):
        test_subject = f"{subject}.tests[{test_index}]"
        test = _object(
            raw_test,
            {"id", "command_id", "environment", "result", "exit_code", "artifact"},
            test_subject,
        )
        test_id = _identifier(test["id"], f"{test_subject}.id", "test")
        if test_id in test_ids:
            raise ProtocolProblem("DUPLICATE_TEST_ID", test_subject)
        test_ids.add(test_id)
        _string(test["command_id"], f"{test_subject}.command_id", maximum=128)
        _string(test["environment"], f"{test_subject}.environment", maximum=256)
        _string(test["result"], f"{test_subject}.result", choices={"PASS", "FAIL", "NOT_RUN", "RESULT_UNKNOWN"})
        if test["exit_code"] is not None:
            _integer(test["exit_code"], f"{test_subject}.exit_code", minimum=-255, maximum=255)
        if test["artifact"] is not None:
            artifact = _string(test["artifact"], f"{test_subject}.artifact", maximum=128)
            if artifact not in evidence_ids:
                raise ProtocolProblem("TEST_EVIDENCE_UNKNOWN", test_subject)
        if (
            (test["result"] == "PASS" and (test["exit_code"] != 0 or test["artifact"] is None))
            or (
                test["result"] == "FAIL"
                and (
                    test["exit_code"] is None
                    or test["exit_code"] == 0
                    or test["artifact"] is None
                )
            )
            or (
                test["result"] == "NOT_RUN"
                and (test["exit_code"] is not None or test["artifact"] is not None)
            )
            or (test["result"] == "RESULT_UNKNOWN" and test["exit_code"] is not None)
        ):
            raise ProtocolProblem("TEST_RESULT_INCONSISTENT", test_subject)

    if not isinstance(message["risks"], list):
        raise ProtocolProblem("ARRAY_REQUIRED", f"{subject}.risks")
    risk_ids: set[str] = set()
    for risk_index, raw_risk in enumerate(message["risks"]):
        risk_subject = f"{subject}.risks[{risk_index}]"
        risk = _object(
            raw_risk,
            {"id", "severity", "probability", "impact", "trigger", "mitigation", "residual_risk"},
            risk_subject,
        )
        risk_id = _identifier(risk["id"], f"{risk_subject}.id", "risk")
        if risk_id in risk_ids:
            raise ProtocolProblem("DUPLICATE_RISK_ID", risk_subject)
        risk_ids.add(risk_id)
        _string(risk["severity"], f"{risk_subject}.severity", choices={"LOW", "MEDIUM", "HIGH", "CRITICAL"})
        _string(risk["probability"], f"{risk_subject}.probability", choices={"LOW", "MEDIUM", "HIGH"})
        for key in ("impact", "trigger", "mitigation", "residual_risk"):
            _string(risk[key], f"{risk_subject}.{key}", maximum=1024)

    if not isinstance(message["blockers"], list):
        raise ProtocolProblem("ARRAY_REQUIRED", f"{subject}.blockers")
    blocker_ids: set[str] = set()
    for blocker_index, raw_blocker in enumerate(message["blockers"]):
        blocker_subject = f"{subject}.blockers[{blocker_index}]"
        blocker = _object(
            raw_blocker,
            {"id", "category", "attempted", "evidence_refs", "unblock_owner"},
            blocker_subject,
        )
        blocker_id = _identifier(blocker["id"], f"{blocker_subject}.id", "blocker")
        if blocker_id in blocker_ids:
            raise ProtocolProblem("DUPLICATE_BLOCKER_ID", blocker_subject)
        blocker_ids.add(blocker_id)
        _string(blocker["category"], f"{blocker_subject}.category", maximum=128)
        _string_list(blocker["attempted"], f"{blocker_subject}.attempted", maximum=512)
        references = _string_list(
            blocker["evidence_refs"], f"{blocker_subject}.evidence_refs", pattern=IDENTIFIER_PATTERNS["evidence"]
        )
        if any(reference not in evidence_ids for reference in references):
            raise ProtocolProblem("BLOCKER_EVIDENCE_UNKNOWN", blocker_subject)
        _string(blocker["unblock_owner"], f"{blocker_subject}.unblock_owner", maximum=128)

    recommendation = _object(
        message["recommendation"],
        {"decision", "reason", "next_action"},
        f"{subject}.recommendation",
    )
    _string(recommendation["decision"], f"{subject}.recommendation.decision", maximum=128)
    _string(recommendation["reason"], f"{subject}.recommendation.reason", maximum=1024)
    _string(recommendation["next_action"], f"{subject}.recommendation.next_action", maximum=256)
    _string(message["status"], f"{subject}.status", choices=STATUSES)
    _string_list(message["resolves_message_ids"], f"{subject}.resolves_message_ids", pattern=UUID_RE)
    _string_list(
        message["resolves_claim_ids"],
        f"{subject}.resolves_claim_ids",
        pattern=IDENTIFIER_PATTERNS["minority"],
    )

    minority = message["minority_report"]
    if minority is not None:
        minority = _object(
            minority,
            {"claim_id", "opposed_claim", "evidence_refs", "potential_harm", "falsification_test", "requested_disposition"},
            f"{subject}.minority_report",
        )
        _identifier(minority["claim_id"], f"{subject}.minority_report.claim_id", "minority")
        for key in ("opposed_claim", "potential_harm", "falsification_test"):
            _string(minority[key], f"{subject}.minority_report.{key}", maximum=1024)
        references = _string_list(
            minority["evidence_refs"],
            f"{subject}.minority_report.evidence_refs",
            pattern=IDENTIFIER_PATTERNS["evidence"],
        )
        if not references or any(reference not in evidence_ids for reference in references):
            raise ProtocolProblem("MINORITY_EVIDENCE_UNKNOWN", subject)
        _string(
            minority["requested_disposition"],
            f"{subject}.minority_report.requested_disposition",
            choices={"FIX_OR_ESCALATE", "TEST_OR_ESCALATE", "OWNER_DECISION"},
        )

    checkpoint = message["checkpoint"]
    if checkpoint is not None:
        checkpoint = _object(
            checkpoint,
            {"candidate_sha", "task_packet_revision", "lease_generation", "completed_message_ids"},
            f"{subject}.checkpoint",
        )
        _string(checkpoint["candidate_sha"], f"{subject}.checkpoint.candidate_sha", pattern=CANDIDATE_RE)
        _integer(checkpoint["task_packet_revision"], f"{subject}.checkpoint.task_packet_revision", minimum=1)
        _integer(checkpoint["lease_generation"], f"{subject}.checkpoint.lease_generation", minimum=1)
        _string_list(
            checkpoint["completed_message_ids"],
            f"{subject}.checkpoint.completed_message_ids",
            pattern=UUID_RE,
        )

    if message["gate"] in REVIEW_GATES:
        permitted_types = {
            "PASS": {"VERIFICATION"},
            "FAIL": {"FINDING", "VERIFICATION"},
            "VETOED": {"MINORITY_REPORT", "VETO"},
            "RESULT_UNKNOWN": {"VERIFICATION"},
        }
        allowed_types = permitted_types.get(message["status"])
        if allowed_types is not None and message["message_type"] not in allowed_types:
            raise ProtocolProblem("REVIEW_MESSAGE_TYPE_INVALID", subject)
    if message["role"] in {"INDEPENDENT_VERIFIER", "BLACK_BOX_VERIFIER"} and message["status"] == "PASS":
        if not message["tests"] or any(
            test["result"] != "PASS"
            or test["exit_code"] != 0
            or test["artifact"] is None
            for test in message["tests"]
        ):
            raise ProtocolProblem("GATE_TESTS_NOT_PASSED", subject)
    if message["role"] == "BLACK_BOX_VERIFIER":
        for artifact_index, artifact in enumerate(artifacts):
            _validate_locator(
                artifact,
                f"{subject}.input.artifacts[{artifact_index}]",
                black_box=True,
            )
        for evidence_index, item in enumerate(evidence):
            if item["kind"] != "BLACK_BOX_OBSERVATION":
                raise ProtocolProblem("BLACK_BOX_SOURCE_CONTEXT", subject)
            _validate_locator(
                item["locator"],
                f"{subject}.evidence[{evidence_index}].locator",
                black_box=True,
            )
    else:
        if any(not artifact.startswith("bundle://") for artifact in artifacts):
            raise ProtocolProblem("NON_SYNTHETIC_LOCATOR", subject)
        if any(not item["locator"].startswith("bundle://") for item in evidence):
            raise ProtocolProblem("NON_SYNTHETIC_LOCATOR", subject)
    return message


def _validate_bundle(bundle: Any) -> dict[str, Any]:
    bundle = _object(
        bundle,
        {"schema_version", "task_packet", "candidates", "contexts", "messages", "expected"},
        "bundle",
    )
    if bundle["schema_version"] != BUNDLE_SCHEMA:
        raise ProtocolProblem("BUNDLE_SCHEMA_UNSUPPORTED", "bundle.schema_version")
    try:
        packet = validate_task_packet(bundle["task_packet"])
    except (TypeError, ValueError) as exc:
        raise ProtocolProblem("TASK_PACKET_INVALID", "bundle.task_packet") from exc
    if packet["schema_version"] != "chenyida-erp-agent-task/v2":
        raise ProtocolProblem("TASK_PACKET_V2_REQUIRED", "bundle.task_packet")
    if packet["scope"]["data_classification"] != "SYNTHETIC_DOCS_TEST_ONLY":
        raise ProtocolProblem("DATA_CLASSIFICATION_VIOLATION", "bundle.task_packet.scope")

    raw_candidates = bundle["candidates"]
    if not isinstance(raw_candidates, list) or not raw_candidates:
        raise ProtocolProblem("CANDIDATES_REQUIRED", "bundle.candidates")
    maximum_candidates = packet["orchestration"]["retry_policy"]["max_candidate_revisions"]
    if len(raw_candidates) > maximum_candidates:
        raise ProtocolProblem("CANDIDATE_BUDGET_EXCEEDED", "bundle.candidates")
    if len(raw_candidates) != 2:
        raise ProtocolProblem("PILOT_TWO_CANDIDATES_REQUIRED", "bundle.candidates")
    candidates: list[dict[str, Any]] = []
    parent = packet["baseline"]["base_sha"]
    for index, raw_candidate in enumerate(raw_candidates):
        candidate = _validate_candidate(raw_candidate, index, parent)
        candidates.append(candidate)
        parent = candidate["candidate_sha"]
    candidate_shas = [candidate["candidate_sha"] for candidate in candidates]
    if len(candidate_shas) != len(set(candidate_shas)):
        raise ProtocolProblem("DUPLICATE_CANDIDATE", "bundle.candidates")
    if any(candidate["disposition"] != "REJECTED" for candidate in candidates[:-1]):
        raise ProtocolProblem("NONFINAL_CANDIDATE_NOT_REJECTED", "bundle.candidates")
    if candidates[-1]["disposition"] != "FINAL":
        raise ProtocolProblem("FINAL_CANDIDATE_MISSING", "bundle.candidates")
    rejected_content = candidates[0]["content"]
    if (
        rejected_content["duplicate_request_behavior"] != "DOUBLE_APPLY"
        or rejected_content["timeout_recovery_behavior"] != "BLIND_REPLAY"
    ):
        raise ProtocolProblem("REJECTED_CANDIDATE_SCENARIO_MISSING", candidates[0]["candidate_sha"])
    final_candidate = candidates[-1]
    final_content = final_candidate["content"]
    if (
        final_content["duplicate_request_behavior"] != "IDEMPOTENT_REPLAY"
        or final_content["timeout_recovery_behavior"] != "RECONCILE_BEFORE_REPLAY"
    ):
        raise ProtocolProblem("FINAL_CANDIDATE_UNSAFE", final_candidate["candidate_sha"])

    assignments = {
        role["agent_id"]: role for role in packet["orchestration"]["roles"]
    }
    raw_contexts = bundle["contexts"]
    if not isinstance(raw_contexts, list) or not raw_contexts:
        raise ProtocolProblem("CONTEXTS_REQUIRED", "bundle.contexts")
    contexts: dict[str, dict[str, Any]] = {}
    context_instances: set[str] = set()
    for index, raw_context in enumerate(raw_contexts):
        context = _validate_context(raw_context, index, packet, set(candidate_shas), assignments)
        if context["digest"] in contexts:
            raise ProtocolProblem("DUPLICATE_CONTEXT_DIGEST", f"contexts[{index}]")
        if context["instance_id"] in context_instances:
            raise ProtocolProblem("CONTEXT_INSTANCE_REUSED", f"contexts[{index}]")
        context_instances.add(context["instance_id"])
        contexts[context["digest"]] = context

    raw_messages = bundle["messages"]
    if not isinstance(raw_messages, list) or not raw_messages:
        raise ProtocolProblem("MESSAGES_REQUIRED", "bundle.messages")
    messages = [_validate_message_structure(item, index) for index, item in enumerate(raw_messages)]
    message_ids: set[str] = set()
    semantic_attempts: set[tuple[str, str, str, int]] = set()
    latest_attempts: dict[tuple[str, str, str], int] = {}
    passed_gate_attempts: set[tuple[str, str, str]] = set()
    vetoed_gate_attempts: set[tuple[str, str, str]] = set()
    prior_message_ids: set[str] = set()
    minority_claims: dict[str, str] = {}
    resolved_claims: set[str] = set()
    unknown_messages: dict[str, tuple[str, str, str, int]] = {}
    resolved_unknowns: dict[str, str] = {}
    gate_results: dict[tuple[str, str], tuple[str, str, int]] = {}
    checkpoint_count = 0
    closure_count = 0
    candidate_positions = {candidate_sha: index for index, candidate_sha in enumerate(candidate_shas)}
    latest_candidate_position = -1

    for index, message in enumerate(messages):
        subject = f"messages[{index}]"
        if closure_count:
            raise ProtocolProblem("MESSAGE_AFTER_CLOSURE", subject)
        message_id = message["message_id"]
        if message_id in message_ids:
            raise ProtocolProblem("DUPLICATE_MESSAGE_ID", message_id)
        message_ids.add(message_id)
        if message["task_id"] != packet["task"]["id"]:
            raise ProtocolProblem("MESSAGE_TASK_MISMATCH", subject)
        message_input = message["input"]
        if message_input["base_sha"] != packet["baseline"]["base_sha"]:
            raise ProtocolProblem("BASE_SHA_MISMATCH", subject)
        candidate_sha = message_input["candidate_sha"]
        if candidate_sha not in set(candidate_shas):
            raise ProtocolProblem("MESSAGE_CANDIDATE_UNKNOWN", subject)
        candidate_position = candidate_positions[candidate_sha]
        if (
            candidate_position < latest_candidate_position
            or candidate_position > latest_candidate_position + 1
        ):
            raise ProtocolProblem("MESSAGE_CANDIDATE_SEQUENCE_INVALID", subject)
        latest_candidate_position = candidate_position
        if message_input["task_packet_revision"] != packet["task"]["revision"]:
            raise ProtocolProblem("STALE_TASK_PACKET_REVISION", subject)
        if message_input["lease_generation"] != packet["orchestration"]["active_lease_generation"]:
            raise ProtocolProblem("STALE_LEASE_GENERATION", subject)

        agent = message["agent"]
        assignment = assignments.get(agent["agent_id"])
        if assignment is None:
            raise ProtocolProblem("AGENT_NOT_ASSIGNED", subject)
        if (
            message["role"] != assignment["role"]
            or agent["capability_profile"] != assignment["capability_profile"]
            or message["gate"] not in ROLE_GATES[message["role"]]
        ):
            raise ProtocolProblem("ROLE_OR_GATE_MISMATCH", subject)
        context = contexts.get(agent["context_manifest_digest"])
        if context is None:
            raise ProtocolProblem("CONTEXT_DIGEST_UNKNOWN", subject)
        if (
            context["agent_id"] != agent["agent_id"]
            or context["instance_id"] != agent["instance_id"]
            or context["candidate_sha"] != candidate_sha
            or context["role"] != message["role"]
            or context["profile"] != agent["capability_profile"]
        ):
            raise ProtocolProblem("MESSAGE_CONTEXT_MISMATCH", subject)
        if message["role"] != "CHANGE_BUILDER" and message["changes"]:
            raise ProtocolProblem("REVIEWER_WRITE_ATTEMPT", subject)
        if message["role"] == "CHANGE_BUILDER" and assignment["agent_id"] != packet["orchestration"]["product_writer_agent_id"]:
            raise ProtocolProblem("WRITER_IDENTITY_MISMATCH", subject)
        for change in message["changes"]:
            if not any(
                fnmatch.fnmatchcase(change["path"], pattern)
                for pattern in packet["scope"]["allowed_changed_paths"]
            ):
                raise ProtocolProblem("CHANGE_PATH_OUT_OF_SCOPE", subject)

        attempt_key = (
            agent["agent_id"],
            message["gate"],
            candidate_sha,
            message_input["attempt"],
        )
        if attempt_key in semantic_attempts:
            raise ProtocolProblem("DUPLICATE_GATE_ATTEMPT", subject)
        semantic_attempts.add(attempt_key)
        if message_input["attempt"] > packet["orchestration"]["retry_policy"]["max_attempts_per_gate"]:
            raise ProtocolProblem("GATE_ATTEMPT_BUDGET_EXCEEDED", subject)
        gate_key = attempt_key[:3]
        expected_attempt = latest_attempts.get(gate_key, 0) + 1
        if message_input["attempt"] != expected_attempt:
            raise ProtocolProblem("GATE_ATTEMPT_SEQUENCE_INVALID", subject)
        if gate_key in passed_gate_attempts:
            raise ProtocolProblem("GATE_ALREADY_PASSED", subject)
        if gate_key in vetoed_gate_attempts:
            raise ProtocolProblem("VETO_REQUIRES_NEW_CANDIDATE", subject)
        latest_attempts[gate_key] = message_input["attempt"]

        if message["status"] in {"PASS", "FAIL", "VETOED", "COMPLETE", "RESULT_UNKNOWN"} and not message["evidence"]:
            raise ProtocolProblem("EVIDENCE_REQUIRED", subject)
        if message["message_type"] == "VETO" and message["status"] != "VETOED":
            raise ProtocolProblem("VETO_STATUS_INVALID", subject)
        if message["message_type"] == "MINORITY_REPORT":
            if message["minority_report"] is None or message["status"] not in {"FAIL", "VETOED"}:
                raise ProtocolProblem("MINORITY_MESSAGE_INVALID", subject)
        elif message["minority_report"] is not None:
            raise ProtocolProblem("MINORITY_MESSAGE_INVALID", subject)
        if message["message_type"] == "CHECKPOINT":
            checkpoint_count += 1
            checkpoint = message["checkpoint"]
            if checkpoint is None:
                raise ProtocolProblem("CHECKPOINT_REQUIRED", subject)
            if (
                checkpoint["candidate_sha"] != candidate_sha
                or checkpoint["task_packet_revision"] != packet["task"]["revision"]
                or checkpoint["lease_generation"] != packet["orchestration"]["active_lease_generation"]
                or any(item not in prior_message_ids for item in checkpoint["completed_message_ids"])
            ):
                raise ProtocolProblem("CHECKPOINT_BINDING_INVALID", subject)
        elif message["checkpoint"] is not None:
            raise ProtocolProblem("CHECKPOINT_UNEXPECTED", subject)
        if message["message_type"] == "CLOSURE" and message["status"] != "COMPLETE":
            raise ProtocolProblem("CLOSURE_STATUS_INVALID", subject)
        if message["message_type"] == "CLOSURE":
            closure_count += 1
            if candidate_sha != final_candidate["candidate_sha"]:
                raise ProtocolProblem("CLOSURE_CANDIDATE_INVALID", subject)

        if message["gate"] in REVIEW_GATES and message["status"] == "PASS":
            passed_gate_attempts.add(gate_key)
        if message["gate"] in REVIEW_GATES and message["status"] == "VETOED":
            vetoed_gate_attempts.add(gate_key)

        for referenced_message in message["resolves_message_ids"]:
            if referenced_message not in unknown_messages:
                raise ProtocolProblem("UNKNOWN_RESULT_REFERENCE_INVALID", subject)
            if message["message_type"] != "RECOVERY" or message["gate"] != "RECOVERY":
                raise ProtocolProblem("UNKNOWN_RESULT_DISPOSITION_INVALID", subject)
            decision = message["recommendation"]["decision"]
            if decision not in {"MARK_NOT_APPLIED_SAFE_TO_RETRY", "MARK_APPLIED_NO_REPLAY"}:
                raise ProtocolProblem("UNKNOWN_RESULT_DISPOSITION_INVALID", subject)
            if referenced_message in resolved_unknowns:
                raise ProtocolProblem("RESULT_UNKNOWN_ALREADY_RESOLVED", subject)
            resolved_unknowns[referenced_message] = decision
        for claim_id in message["resolves_claim_ids"]:
            if claim_id not in minority_claims:
                raise ProtocolProblem("MINORITY_DISPOSITION_INVALID", subject)
            if (
                candidate_sha == minority_claims[claim_id]
                or not message["evidence"]
                or message["role"] != "ADVERSARIAL_EXAMINER"
                or message["gate"] != "ADVERSARIAL"
            ):
                raise ProtocolProblem("MINORITY_DISPOSITION_INVALID", subject)
            resolved_claims.add(claim_id)

        if message["status"] == "RESULT_UNKNOWN":
            unknown_messages[message_id] = attempt_key
        else:
            for unknown_id, unknown_key in unknown_messages.items():
                if unknown_key[:3] == attempt_key[:3] and attempt_key[3] > unknown_key[3]:
                    disposition = resolved_unknowns.get(unknown_id)
                    if disposition != "MARK_NOT_APPLIED_SAFE_TO_RETRY":
                        raise ProtocolProblem("RESULT_UNKNOWN_REPLAY_FORBIDDEN", subject)

        minority = message["minority_report"]
        if minority is not None:
            claim_id = minority["claim_id"]
            if claim_id in minority_claims:
                raise ProtocolProblem("DUPLICATE_MINORITY_CLAIM", subject)
            minority_claims[claim_id] = candidate_sha

        if message["gate"] in {*REQUIRED_FINAL_GATES, "ADVERSARIAL"} and message["status"] in {"PASS", "FAIL", "VETOED"}:
            gate_results[(candidate_sha, message["gate"])] = (
                message["status"],
                message_id,
                message_input["attempt"],
            )
        prior_message_ids.add(message_id)

    if checkpoint_count == 0:
        raise ProtocolProblem("CHECKPOINT_MISSING", "bundle.messages")
    if checkpoint_count > 1:
        raise ProtocolProblem("CHECKPOINT_COUNT_INVALID", "bundle.messages")
    if not minority_claims:
        raise ProtocolProblem("MINORITY_REPORT_MISSING", "bundle.messages")
    unresolved_claims = sorted(set(minority_claims) - resolved_claims)
    if unresolved_claims:
        raise ProtocolProblem("MINORITY_REPORT_UNRESOLVED", unresolved_claims[0])
    unresolved_unknowns = sorted(set(unknown_messages) - set(resolved_unknowns))
    if unresolved_unknowns:
        raise ProtocolProblem("RESULT_UNKNOWN_UNRESOLVED", unresolved_unknowns[0])
    if not unknown_messages:
        raise ProtocolProblem("RESULT_UNKNOWN_EXERCISE_MISSING", "bundle.messages")

    rejected_sha = candidates[0]["candidate_sha"]
    expected_rejections = {
        "ERP_CONTRACT": "FAIL",
        "ADVERSARIAL": "VETOED",
        "SECURITY": "VETOED",
        "QA": "FAIL",
    }
    for gate, expected_status in expected_rejections.items():
        result = gate_results.get((rejected_sha, gate))
        if result is None or result[0] != expected_status:
            raise ProtocolProblem("REJECTED_CANDIDATE_GATE_MISSING", gate)

    final_sha = final_candidate["candidate_sha"]
    final_gates: dict[str, str] = {}
    for gate in REQUIRED_FINAL_GATES:
        result = gate_results.get((final_sha, gate))
        if result is None or result[0] != "PASS":
            raise ProtocolProblem("FINAL_GATE_NOT_PASSED", gate)
        final_gates[gate] = result[0]
    adversarial_result = gate_results.get((final_sha, "ADVERSARIAL"))
    if adversarial_result is None or adversarial_result[0] != "PASS":
        raise ProtocolProblem("FINAL_ADVERSARIAL_NOT_PASSED", final_sha)
    if closure_count != 1:
        raise ProtocolProblem("CLOSURE_MISSING", final_sha)

    expected = _object(
        bundle["expected"],
        {"final_candidate_sha", "required_gate_status", "minority_claims_resolved", "result_unknown_resolved"},
        "bundle.expected",
    )
    if expected["final_candidate_sha"] != final_sha:
        raise ProtocolProblem("EXPECTED_FINAL_MISMATCH", "bundle.expected.final_candidate_sha")
    expected_gates = _object(
        expected["required_gate_status"], set(REQUIRED_FINAL_GATES), "bundle.expected.required_gate_status"
    )
    if expected_gates != final_gates:
        raise ProtocolProblem("EXPECTED_GATE_MISMATCH", "bundle.expected.required_gate_status")
    expected_claims = _string_list(
        expected["minority_claims_resolved"],
        "bundle.expected.minority_claims_resolved",
        pattern=IDENTIFIER_PATTERNS["minority"],
    )
    if expected_claims != sorted(resolved_claims):
        raise ProtocolProblem("EXPECTED_MINORITY_MISMATCH", "bundle.expected.minority_claims_resolved")
    expected_unknowns = _string_list(
        expected["result_unknown_resolved"],
        "bundle.expected.result_unknown_resolved",
        pattern=UUID_RE,
    )
    if expected_unknowns != sorted(resolved_unknowns):
        raise ProtocolProblem("EXPECTED_RECOVERY_MISMATCH", "bundle.expected.result_unknown_resolved")

    return {
        "candidate_count": len(candidates),
        "context_count": len(contexts),
        "final_candidate_sha": final_sha,
        "gates": dict(sorted(final_gates.items())),
        "message_count": len(messages),
        "minority_claims_resolved": sorted(resolved_claims),
        "result_unknown_resolved": sorted(resolved_unknowns),
        "task_id": packet["task"]["id"],
        "task_packet_revision": packet["task"]["revision"],
    }


def validate_bundle(bundle: Any) -> dict[str, Any]:
    """Validate an already parsed synthetic bundle and return a stable report."""

    try:
        bundle_digest = _sha256_ref(_canonical_json(bundle))
    except (TypeError, ValueError, UnicodeError, RecursionError):
        bundle_digest = None
    report: dict[str, Any] = {
        "schema_version": REPORT_SCHEMA,
        "validator_version": VALIDATOR_VERSION,
        "status": "FAIL",
        "bundle_digest": bundle_digest,
        "task_id": None,
        "task_packet_revision": None,
        "final_candidate_sha": None,
        "counts": {"candidates": 0, "contexts": 0, "messages": 0},
        "gates": {},
        "minority_claims_resolved": [],
        "result_unknown_resolved": [],
        "errors": [],
    }
    try:
        if bundle_digest is None:
            raise ProtocolProblem("BUNDLE_INVALID", "bundle")
        result = _validate_bundle(copy.deepcopy(bundle))
    except ProtocolProblem as problem:
        report["errors"] = [{"code": problem.code, "subject": problem.subject}]
    except (TypeError, ValueError, UnicodeError, RecursionError):
        report["errors"] = [{"code": "BUNDLE_INVALID", "subject": "bundle"}]
    else:
        report.update(
            {
                "status": "PASS",
                "task_id": result["task_id"],
                "task_packet_revision": result["task_packet_revision"],
                "final_candidate_sha": result["final_candidate_sha"],
                "counts": {
                    "candidates": result["candidate_count"],
                    "contexts": result["context_count"],
                    "messages": result["message_count"],
                },
                "gates": result["gates"],
                "minority_claims_resolved": result["minority_claims_resolved"],
                "result_unknown_resolved": result["result_unknown_resolved"],
            }
        )
    digest_input = copy.deepcopy(report)
    report["report_digest"] = _sha256_ref(_canonical_json(digest_input))
    return report


def load_bundle(path: str | Path) -> Any:
    """Read one explicit regular JSON file with duplicate-key and size checks."""

    bundle_path = Path(path).absolute()
    if bundle_path == Path(bundle_path.anchor):
        raise ProtocolProblem("BUNDLE_FILE_UNSAFE", "bundle")
    try:
        current = Path(bundle_path.anchor)
        for part in bundle_path.parts[1:]:
            current = current / part
            metadata = current.lstat()
            if stat.S_ISLNK(metadata.st_mode):
                raise ProtocolProblem("BUNDLE_FILE_UNSAFE", "bundle")
    except OSError as exc:
        raise ProtocolProblem("BUNDLE_FILE_UNREADABLE", "bundle") from exc
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise ProtocolProblem("BUNDLE_FILE_UNSAFE", "bundle")
    if metadata.st_size > MAX_BUNDLE_BYTES:
        raise ProtocolProblem("BUNDLE_FILE_TOO_LARGE", "bundle")
    descriptor: int | None = None
    try:
        flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(bundle_path, flags)
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_nlink != 1
            or (opened.st_dev, opened.st_ino) != (metadata.st_dev, metadata.st_ino)
            or opened.st_size != metadata.st_size
            or opened.st_mtime_ns != metadata.st_mtime_ns
            or opened.st_ctime_ns != metadata.st_ctime_ns
        ):
            raise ProtocolProblem("BUNDLE_FILE_UNSAFE", "bundle")
        chunks: list[bytes] = []
        observed_size = 0
        while observed_size <= MAX_BUNDLE_BYTES:
            chunk = os.read(descriptor, min(65536, MAX_BUNDLE_BYTES + 1 - observed_size))
            if not chunk:
                break
            chunks.append(chunk)
            observed_size += len(chunk)
        if observed_size > MAX_BUNDLE_BYTES:
            raise ProtocolProblem("BUNDLE_FILE_TOO_LARGE", "bundle")
        after_read = os.fstat(descriptor)
        if (
            after_read.st_size != opened.st_size
            or after_read.st_mtime_ns != opened.st_mtime_ns
            or after_read.st_ctime_ns != opened.st_ctime_ns
            or after_read.st_nlink != 1
        ):
            raise ProtocolProblem("BUNDLE_FILE_UNSAFE", "bundle")
        payload = b"".join(chunks)
        return json.loads(
            payload,
            object_pairs_hook=_pairs_without_duplicates,
            parse_constant=_reject_json_constant,
        )
    except ProtocolProblem:
        raise
    except OSError as exc:
        raise ProtocolProblem("BUNDLE_FILE_UNREADABLE", "bundle") from exc
    except (UnicodeError, ValueError, json.JSONDecodeError, RecursionError) as exc:
        raise ProtocolProblem("BUNDLE_JSON_INVALID", "bundle") from exc
    finally:
        if descriptor is not None:
            os.close(descriptor)


def _argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate one local synthetic native-orchestration bundle without side effects",
    )
    parser.add_argument("--bundle", required=True, help="explicit local synthetic JSON bundle")
    parser.add_argument("--pretty", action="store_true", help="indent deterministic JSON output")
    return parser


def main(argv: list[str] | None = None) -> int:
    arguments = _argument_parser().parse_args(argv)
    try:
        bundle = load_bundle(arguments.bundle)
        report = validate_bundle(bundle)
    except ProtocolProblem as problem:
        report = {
            "schema_version": REPORT_SCHEMA,
            "validator_version": VALIDATOR_VERSION,
            "status": "FAIL",
            "bundle_digest": None,
            "task_id": None,
            "task_packet_revision": None,
            "final_candidate_sha": None,
            "counts": {"candidates": 0, "contexts": 0, "messages": 0},
            "gates": {},
            "minority_claims_resolved": [],
            "result_unknown_resolved": [],
            "errors": [{"code": problem.code, "subject": problem.subject}],
        }
        digest_input = copy.deepcopy(report)
        report["report_digest"] = _sha256_ref(_canonical_json(digest_input))
    output = json.dumps(
        report,
        ensure_ascii=False,
        sort_keys=True,
        indent=2 if arguments.pretty else None,
        separators=None if arguments.pretty else (",", ":"),
    )
    sys.stdout.write(output + "\n")
    return 0 if report["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
