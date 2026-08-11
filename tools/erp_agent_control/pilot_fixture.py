"""Deterministic synthetic fixtures for the AGENT-R1-5 protocol pilot.

This module constructs JSON-compatible values in memory. It performs no file,
network, database, Git, or subprocess I/O.
"""

from __future__ import annotations

import copy
import hashlib
import json
from typing import Any


BASE_SHA = "1f55696b124c899d49f4505c9ad0cd238d910b24"
TASK_ID = "AGENT-R1-5"
PACKET_REVISION = 2
LEASE_GENERATION = 1
FIXED_TIME_PREFIX = "2026-08-11T04"
FORBIDDEN_CONTEXT = [
    "OWNER_UNTRACKED_INPUT",
    "PRODUCT_SOURCE",
    "GIT_INTERNALS",
    "REAL_BUSINESS_DATA",
    "SECRETS",
    "UAT_OR_PRODUCTION",
]


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def digest(value: Any) -> str:
    payload = value if isinstance(value, bytes) else canonical_json(value)
    return "sha256:" + hashlib.sha256(payload).hexdigest()


def build_task_packet() -> dict[str, Any]:
    return {
        "schema_version": "chenyida-erp-agent-task/v2",
        "task": {
            "id": TASK_ID,
            "revision": PACKET_REVISION,
            "ledger_state": "DOING",
            "delivery_stage": "IMPLEMENTING",
            "qualifiers": [
                "NATIVE_PROTOCOL_MVP",
                "SYNTHETIC_DOCS_TEST_ONLY",
                "NO_RUNTIME_AUTHORITY",
                "NO_UAT_OR_PRODUCTION_CONNECTION",
            ],
            "task_document": "docs/tasks/AGENT-R1-5.md",
            "objective": "Validate native role orchestration with strict, stateless, synthetic protocols.",
            "non_goals": [
                "ERP business or product-test changes",
                "Schema, Migration, database, UAT, production, deployment, or network access",
                "Persistent control store, daemon, capability broker, or R2 runtime enforcement",
            ],
        },
        "baseline": {
            "base_sha": BASE_SHA,
            "expected_branch": "main",
            "source_version": "0.1.0-alpha.44",
            "source_migration": {
                "first_number": 1,
                "head_number": 41,
                "head_filename": "0041_ai_governance_suggestion_evidence.sql",
                "head_sha256": "676626b9dcb78f31643612e5662cf5c36e06259c72ff922287bb913394071bf2",
            },
            "uat": {
                "version": "0.1.0-alpha.42",
                "migration_head": "0040",
                "verification_scope": "DOCUMENT_DECLARATION_ONLY_NO_CONNECTION",
            },
        },
        "scope": {
            "allowed_changed_paths": [
                "docs/AI_AGENT_TEAM_DESIGN.md",
                "docs/agent-control/**",
                "docs/ai-engineering/**",
                "docs/project/CHANGELOG.md",
                "docs/project/DECISIONS.md",
                "docs/project/MASTER.md",
                "docs/project/PROJECT_CONTEXT.md",
                "docs/project/ROADMAP.md",
                "docs/project/STATUS.md",
                "docs/project/TASKS.md",
                "docs/tasks/AGENT-R1-5.md",
                "tools/erp_agent_control/**",
            ],
            "known_untracked_paths": ["docs/ERP_CURRENT_STATUS_REPORT.md"],
            "required_documents": [
                "AGENTS.md",
                "docs/AI_AGENT_TEAM_DESIGN.md",
                "docs/agent-control/README.md",
                "docs/ai-engineering/AGENTS.md",
                "docs/ai-engineering/IMPLEMENTATION_PLAN.md",
                "docs/ai-engineering/MESSAGE_PROTOCOL.md",
                "docs/ai-engineering/PERMISSIONS.md",
                "docs/project/CHANGELOG.md",
                "docs/project/DECISIONS.md",
                "docs/project/MASTER.md",
                "docs/project/PROJECT_CONTEXT.md",
                "docs/project/ROADMAP.md",
                "docs/project/STATUS.md",
                "docs/project/TASKS.md",
                "docs/tasks/AGENT-R1-5.md",
            ],
            "require_single_worktree": True,
            "data_classification": "SYNTHETIC_DOCS_TEST_ONLY",
        },
        "inspection": {
            "package_json": "chenyida_erp_site/package.json",
            "migration_directory": "chenyida_erp_site/drizzle-postgres",
            "migration_journal": "chenyida_erp_site/drizzle-postgres/meta/_journal.json",
            "migration_snapshot_directory": "chenyida_erp_site/drizzle-postgres/meta",
            "required_decisions": ["D-113", "D-114"],
            "uat_document_markers": [
                {
                    "path": "docs/project/MASTER.md",
                    "contains": ["0.1.0-alpha.42", "0040"],
                },
                {
                    "path": "docs/project/PROJECT_CONTEXT.md",
                    "contains": ["0.1.0-alpha.42", "0040"],
                },
            ],
        },
        "orchestration": {
            "product_writer_agent_id": "builder-r1-5",
            "active_lease_generation": LEASE_GENERATION,
            "roles": [
                {
                    "agent_id": "builder-r1-5",
                    "role": "CHANGE_BUILDER",
                    "capability_profile": "SYNTHETIC_BUILDER",
                    "context_visibility": "SYNTHETIC_PROTOCOL_ONLY",
                    "can_write": True,
                },
                {
                    "agent_id": "erp-guardian-r1-5",
                    "role": "ERP_CONTRACT_GUARDIAN",
                    "capability_profile": "ERP_READ_ONLY",
                    "context_visibility": "SYNTHETIC_PROTOCOL_ONLY",
                    "can_write": False,
                },
                {
                    "agent_id": "adversarial-r1-5",
                    "role": "ADVERSARIAL_EXAMINER",
                    "capability_profile": "ADVERSARIAL_READ_ONLY",
                    "context_visibility": "SYNTHETIC_PROTOCOL_ONLY",
                    "can_write": False,
                },
                {
                    "agent_id": "security-r1-5",
                    "role": "SECURITY_BOUNDARY_EXAMINER",
                    "capability_profile": "SECURITY_READ_ONLY",
                    "context_visibility": "SYNTHETIC_PROTOCOL_ONLY",
                    "can_write": False,
                },
                {
                    "agent_id": "qa-r1-5",
                    "role": "INDEPENDENT_VERIFIER",
                    "capability_profile": "QA_TEST_READ_ONLY",
                    "context_visibility": "SYNTHETIC_PROTOCOL_ONLY",
                    "can_write": False,
                },
                {
                    "agent_id": "blackbox-r1-5",
                    "role": "BLACK_BOX_VERIFIER",
                    "capability_profile": "BLACK_BOX_PUBLIC_ONLY",
                    "context_visibility": "BLACK_BOX_PUBLIC_ONLY",
                    "can_write": False,
                },
            ],
            "required_gates": ["ERP_CONTRACT", "SECURITY", "QA", "BLACK_BOX"],
            "allowed_capabilities": ["READ_ONLY", "WORKTREE_WRITE", "TEST_EXECUTION", "GIT_COMMIT"],
            "forbidden_capabilities": [
                "DATABASE_ACCESS",
                "DEPLOY",
                "GIT_PUSH",
                "MODEL_INVOCATION",
                "NETWORK_ACCESS",
                "PRODUCTION_ACCESS",
                "RUNTIME_DAEMON",
                "UAT_ACCESS",
            ],
            "retry_policy": {
                "max_candidate_revisions": 2,
                "max_attempts_per_gate": 2,
                "result_unknown_action": "RECONCILE_BEFORE_REPLAY",
            },
        },
        "resources": {
            "max_concurrent_light_agents": 2,
            "max_product_writers": 1,
            "max_heavy_actions": 1,
            "max_temporary_containers": 1,
            "max_temporary_databases": 0,
            "network_allowed": False,
            "database_allowed": False,
            "uat_allowed": False,
            "production_allowed": False,
            "deploy_allowed": False,
        },
    }


def _candidate(revision: int, parent_sha: str, content: dict[str, str], disposition: str) -> dict[str, Any]:
    return {
        "revision": revision,
        "parent_sha": parent_sha,
        "candidate_sha": digest(content),
        "disposition": disposition,
        "content": content,
    }


def _artifact_record(classification: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "classification": classification,
        "payload": payload,
        "digest": digest(payload),
    }


def _build_context_artifacts(
    packet: dict[str, Any], candidates: list[dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    artifacts: dict[str, dict[str, Any]] = {
        "bundle://synthetic-contract-v1": _artifact_record(
            "SYNTHETIC_CONTRACT",
            {
                "artifact_type": "SYNTHETIC_CONTRACT",
                "schema_version": "synthetic-contract/v1",
                "task_id": packet["task"]["id"],
                "task_packet_revision": packet["task"]["revision"],
                "data_classification": packet["scope"]["data_classification"],
            },
        )
    }
    for candidate_number, candidate in enumerate(candidates, start=1):
        suffix = f"c{candidate_number}"
        artifacts[f"bundle://candidate/{suffix}"] = _artifact_record(
            "SYNTHETIC_CANDIDATE",
            {
                "artifact_type": "SYNTHETIC_CANDIDATE",
                "candidate_sha": candidate["candidate_sha"],
                "content": candidate["content"],
            },
        )
        for assignment in packet["orchestration"]["roles"]:
            if assignment["context_visibility"] == "BLACK_BOX_PUBLIC_ONLY":
                continue
            agent_id = assignment["agent_id"]
            artifacts[f"bundle://evidence/{agent_id}/{suffix}"] = _artifact_record(
                "SYNTHETIC_TEST_EVIDENCE",
                {
                    "artifact_type": "SYNTHETIC_CONTEXT_EVIDENCE",
                    "task_id": packet["task"]["id"],
                    "agent_id": agent_id,
                    "role": assignment["role"],
                    "candidate_sha": candidate["candidate_sha"],
                    "visibility": assignment["context_visibility"],
                },
            )
    final_sha = candidates[-1]["candidate_sha"]
    for locator, classification, artifact_type, version in (
        ("blackbox://interface-v2", "PUBLIC_INTERFACE", "PUBLIC_INTERFACE", "v2"),
        ("blackbox://personas-v1", "PUBLIC_PERSONA", "PUBLIC_PERSONA", "v1"),
        ("blackbox://observation-v2", "PUBLIC_OBSERVATION", "PUBLIC_OBSERVATION", "v2"),
    ):
        artifacts[locator] = _artifact_record(
            classification,
            {
                "artifact_type": artifact_type,
                "task_id": packet["task"]["id"],
                "candidate_sha": final_sha,
                "version": version,
                "source_visibility": "BLACK_BOX_PUBLIC_ONLY",
            },
        )
    return artifacts


def _document(locator: str, artifacts: dict[str, dict[str, Any]]) -> dict[str, str]:
    artifact = artifacts[locator]
    return {
        "locator": locator,
        "digest": artifact["digest"],
        "classification": artifact["classification"],
    }


def _context(
    agent_id: str,
    role: str,
    profile: str,
    visibility: str,
    candidate_sha: str,
    suffix: str,
    artifacts: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    if visibility == "BLACK_BOX_PUBLIC_ONLY":
        documents = [
            _document("blackbox://interface-v2", artifacts),
            _document("blackbox://personas-v1", artifacts),
            _document("blackbox://observation-v2", artifacts),
        ]
    else:
        documents = [
            _document("bundle://synthetic-contract-v1", artifacts),
            _document(f"bundle://candidate/{suffix}", artifacts),
            _document(f"bundle://evidence/{agent_id}/{suffix}", artifacts),
        ]
    manifest: dict[str, Any] = {
        "schema_version": "erp-agent-context/v1",
        "task_id": TASK_ID,
        "task_packet_revision": PACKET_REVISION,
        "agent_id": agent_id,
        "instance_id": f"{agent_id}-{suffix}",
        "role": role,
        "capability_profile": profile,
        "candidate_sha": candidate_sha,
        "lease_generation": LEASE_GENERATION,
        "visibility": visibility,
        "documents": documents,
        "forbidden_context": list(FORBIDDEN_CONTEXT),
    }
    manifest["manifest_digest"] = digest(manifest)
    return manifest


def message_evidence_payload(message: dict[str, Any], evidence: dict[str, Any]) -> dict[str, Any]:
    return {
        "artifact_type": "MESSAGE_EVIDENCE",
        "message_id": message["message_id"],
        "task_id": message["task_id"],
        "candidate_sha": message["input"]["candidate_sha"],
        "agent_id": message["agent"]["agent_id"],
        "kind": evidence["kind"],
        "exit_code": evidence["exit_code"],
        "observed_at": evidence["observed_at"],
    }


def _evidence(sequence: int, kind: str, locator: str, exit_code: int | None = 0) -> dict[str, Any]:
    return {
        "id": "E-001",
        "kind": kind,
        "locator": locator,
        "digest": "sha256:" + "0" * 64,
        "exit_code": exit_code,
        "observed_at": f"{FIXED_TIME_PREFIX}:{sequence:02d}:00Z",
        "redaction": "synthetic only; no secrets, owner input, business data, UAT, or production",
    }


def _message(
    sequence: int,
    context: dict[str, Any],
    candidate_sha: str,
    message_type: str,
    gate: str,
    status: str,
    decision: str,
    *,
    attempt: int = 1,
    evidence_kind: str = "FILE_SNAPSHOT",
    evidence_locator: str | None = None,
    evidence_exit_code: int | None = 0,
    changes: list[dict[str, str]] | None = None,
    tests: list[dict[str, Any]] | None = None,
    minority_report: dict[str, Any] | None = None,
    resolves_message_ids: list[str] | None = None,
    resolves_claim_ids: list[str] | None = None,
    checkpoint: dict[str, Any] | None = None,
) -> dict[str, Any]:
    locator = evidence_locator or f"bundle://evidence/message-{sequence:02d}"
    message = {
        "schema_version": "erp-agent-message/v1",
        "message_id": f"00000000-0000-4000-8000-{sequence:012d}",
        "message_type": message_type,
        "created_at": f"{FIXED_TIME_PREFIX}:{sequence:02d}:00Z",
        "task_id": TASK_ID,
        "agent": {
            "agent_id": context["agent_id"],
            "instance_id": context["instance_id"],
            "capability_profile": context["capability_profile"],
            "context_manifest_digest": context["manifest_digest"],
        },
        "role": context["role"],
        "gate": gate,
        "input": {
            "base_sha": BASE_SHA,
            "candidate_sha": candidate_sha,
            "task_packet_revision": PACKET_REVISION,
            "lease_generation": LEASE_GENERATION,
            "attempt": attempt,
            "artifacts": [locator],
        },
        "assumptions": [],
        "evidence": [_evidence(sequence, evidence_kind, locator, evidence_exit_code)],
        "changes": changes or [],
        "tests": tests or [],
        "risks": [],
        "blockers": [],
        "recommendation": {
            "decision": decision,
            "reason": f"Synthetic protocol observation {sequence:02d} is bound to the declared candidate.",
            "next_action": "CONTINUE_ONLY_WITHIN_ACTIVE_TASK_PACKET",
        },
        "status": status,
        "minority_report": minority_report,
        "resolves_message_ids": resolves_message_ids or [],
        "resolves_claim_ids": resolves_claim_ids or [],
        "checkpoint": checkpoint,
    }
    for item in message["evidence"]:
        item["digest"] = digest(message_evidence_payload(message, item))
    return message


def build_valid_bundle() -> dict[str, Any]:
    packet = build_task_packet()
    unsafe_content = {
        "contract_version": "synthetic-v1",
        "duplicate_request_behavior": "DOUBLE_APPLY",
        "timeout_recovery_behavior": "BLIND_REPLAY",
        "data_classification": "SYNTHETIC_ONLY",
    }
    first = _candidate(1, BASE_SHA, unsafe_content, "REJECTED")
    safe_content = {
        "contract_version": "synthetic-v2",
        "duplicate_request_behavior": "IDEMPOTENT_REPLAY",
        "timeout_recovery_behavior": "RECONCILE_BEFORE_REPLAY",
        "data_classification": "SYNTHETIC_ONLY",
    }
    second = _candidate(2, first["candidate_sha"], safe_content, "FINAL")
    candidates = [first, second]
    artifacts = _build_context_artifacts(packet, candidates)

    role_assignments = {item["role"]: item for item in packet["orchestration"]["roles"]}
    contexts: dict[tuple[str, int], dict[str, Any]] = {}
    for candidate_number, candidate in enumerate(candidates, start=1):
        for role in (
            "CHANGE_BUILDER",
            "ERP_CONTRACT_GUARDIAN",
            "ADVERSARIAL_EXAMINER",
            "SECURITY_BOUNDARY_EXAMINER",
            "INDEPENDENT_VERIFIER",
        ):
            assignment = role_assignments[role]
            contexts[(role, candidate_number)] = _context(
                assignment["agent_id"],
                role,
                assignment["capability_profile"],
                assignment["context_visibility"],
                candidate["candidate_sha"],
                f"c{candidate_number}",
                artifacts,
            )
    blackbox_assignment = role_assignments["BLACK_BOX_VERIFIER"]
    contexts[("BLACK_BOX_VERIFIER", 2)] = _context(
        blackbox_assignment["agent_id"],
        "BLACK_BOX_VERIFIER",
        blackbox_assignment["capability_profile"],
        blackbox_assignment["context_visibility"],
        second["candidate_sha"],
        "c2",
        artifacts,
    )

    c1 = first["candidate_sha"]
    c2 = second["candidate_sha"]
    first_message_ids = [f"00000000-0000-4000-8000-{sequence:012d}" for sequence in range(1, 6)]
    unknown_message_id = "00000000-0000-4000-8000-000000000011"
    messages = [
        _message(
            1,
            contexts[("CHANGE_BUILDER", 1)],
            c1,
            "HANDOFF",
            "IMPLEMENTATION",
            "PASS",
            "REQUEST_INDEPENDENT_GATES",
            changes=[
                {
                    "path": "docs/agent-control/pilots/AGENT-R1-5/synthetic-contract.md",
                    "action": "MODIFY",
                    "purpose": "Expose the intentionally unsafe first synthetic candidate.",
                }
            ],
        ),
        _message(2, contexts[("ERP_CONTRACT_GUARDIAN", 1)], c1, "FINDING", "ERP_CONTRACT", "FAIL", "REJECT_DOUBLE_APPLY"),
        _message(
            3,
            contexts[("ADVERSARIAL_EXAMINER", 1)],
            c1,
            "MINORITY_REPORT",
            "ADVERSARIAL",
            "VETOED",
            "FIX_OR_ESCALATE",
            minority_report={
                "claim_id": "MR-001",
                "opposed_claim": "The first candidate is safe to retry after an ambiguous timeout.",
                "evidence_refs": ["E-001"],
                "potential_harm": "A synthetic request can be applied twice.",
                "falsification_test": "Inject an ambiguous timeout and retry the same synthetic request identifier.",
                "requested_disposition": "FIX_OR_ESCALATE",
            },
        ),
        _message(4, contexts[("SECURITY_BOUNDARY_EXAMINER", 1)], c1, "VETO", "SECURITY", "VETOED", "REJECT_BLIND_REPLAY"),
        _message(
            5,
            contexts[("INDEPENDENT_VERIFIER", 1)],
            c1,
            "VERIFICATION",
            "QA",
            "FAIL",
            "REJECT_FAILED_RETRY_TEST",
            evidence_kind="TEST_REPORT",
            evidence_exit_code=1,
            tests=[
                {
                    "id": "T-001",
                    "command_id": "synthetic-retry-test-v1",
                    "environment": "in-memory synthetic fixture",
                    "result": "FAIL",
                    "exit_code": 1,
                    "artifact": "E-001",
                }
            ],
        ),
        _message(
            6,
            contexts[("CHANGE_BUILDER", 1)],
            c1,
            "CHECKPOINT",
            "IMPLEMENTATION",
            "IN_PROGRESS",
            "CHECKPOINT_REJECTED_CANDIDATE",
            attempt=2,
            checkpoint={
                "candidate_sha": c1,
                "task_packet_revision": PACKET_REVISION,
                "lease_generation": LEASE_GENERATION,
                "completed_message_ids": first_message_ids,
            },
        ),
        _message(
            7,
            contexts[("CHANGE_BUILDER", 2)],
            c2,
            "HANDOFF",
            "IMPLEMENTATION",
            "PASS",
            "REQUEST_FRESH_GATES",
            changes=[
                {
                    "path": "docs/agent-control/pilots/AGENT-R1-5/synthetic-contract.md",
                    "action": "MODIFY",
                    "purpose": "Replace blind replay with reconcile-before-replay and idempotency.",
                }
            ],
        ),
        _message(8, contexts[("ERP_CONTRACT_GUARDIAN", 2)], c2, "VERIFICATION", "ERP_CONTRACT", "PASS", "PASS_CURRENT_GATE"),
        _message(
            9,
            contexts[("ADVERSARIAL_EXAMINER", 2)],
            c2,
            "VERIFICATION",
            "ADVERSARIAL",
            "PASS",
            "FIX_ACCEPTED",
            resolves_claim_ids=["MR-001"],
        ),
        _message(10, contexts[("SECURITY_BOUNDARY_EXAMINER", 2)], c2, "VERIFICATION", "SECURITY", "PASS", "PASS_CURRENT_GATE"),
        _message(
            11,
            contexts[("INDEPENDENT_VERIFIER", 2)],
            c2,
            "VERIFICATION",
            "QA",
            "RESULT_UNKNOWN",
            "RECONCILE_BEFORE_REPLAY",
            evidence_kind="TEST_REPORT",
            evidence_exit_code=None,
            tests=[
                {
                    "id": "T-001",
                    "command_id": "synthetic-retry-test-v2",
                    "environment": "in-memory synthetic fixture with injected timeout",
                    "result": "RESULT_UNKNOWN",
                    "exit_code": None,
                    "artifact": "E-001",
                }
            ],
        ),
        _message(
            12,
            contexts[("CHANGE_BUILDER", 2)],
            c2,
            "RECOVERY",
            "RECOVERY",
            "PASS",
            "MARK_NOT_APPLIED_SAFE_TO_RETRY",
            resolves_message_ids=[unknown_message_id],
        ),
        _message(
            13,
            contexts[("INDEPENDENT_VERIFIER", 2)],
            c2,
            "VERIFICATION",
            "QA",
            "PASS",
            "PASS_CURRENT_GATE",
            attempt=2,
            evidence_kind="TEST_REPORT",
            tests=[
                {
                    "id": "T-001",
                    "command_id": "synthetic-retry-test-v2",
                    "environment": "in-memory synthetic fixture after not-applied reconciliation",
                    "result": "PASS",
                    "exit_code": 0,
                    "artifact": "E-001",
                }
            ],
        ),
        _message(
            14,
            contexts[("BLACK_BOX_VERIFIER", 2)],
            c2,
            "VERIFICATION",
            "BLACK_BOX",
            "PASS",
            "PASS_CURRENT_GATE",
            evidence_kind="BLACK_BOX_OBSERVATION",
            evidence_locator="blackbox://evidence/message-14",
            tests=[
                {
                    "id": "T-001",
                    "command_id": "source-blind-persona-runner",
                    "environment": "network-none; public fixture mount only",
                    "result": "PASS",
                    "exit_code": 0,
                    "artifact": "E-001",
                }
            ],
        ),
        _message(15, contexts[("CHANGE_BUILDER", 2)], c2, "CLOSURE", "CLOSURE", "COMPLETE", "CLOSE_SYNTHETIC_PILOT_ONLY"),
    ]
    for item in messages:
        for evidence in item["evidence"]:
            classification = (
                "PUBLIC_OBSERVATION"
                if item["role"] == "BLACK_BOX_VERIFIER"
                else "SYNTHETIC_TEST_EVIDENCE"
            )
            locator = evidence["locator"]
            if locator in artifacts:
                raise ValueError(f"duplicate artifact locator: {locator}")
            artifacts[locator] = _artifact_record(
                classification,
                message_evidence_payload(item, evidence),
            )
    return {
        "schema_version": "chenyida-erp-native-pilot-bundle/v2",
        "task_packet": packet,
        "candidates": candidates,
        "artifacts": artifacts,
        "contexts": list(contexts.values()),
        "messages": messages,
        "expected": {
            "final_candidate_sha": c2,
            "required_gate_status": {
                "ERP_CONTRACT": "PASS",
                "SECURITY": "PASS",
                "QA": "PASS",
                "BLACK_BOX": "PASS",
            },
            "minority_claims_resolved": ["MR-001"],
            "result_unknown_resolved": [unknown_message_id],
        },
    }


def clone_valid_bundle() -> dict[str, Any]:
    return copy.deepcopy(build_valid_bundle())
