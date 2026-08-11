#!/usr/bin/env python3
"""Read-only repository reconciler for the Chenyida ERP agent control plane R1.

The controller deliberately has no persistence layer and no repair action. It reads
the local Git repository and checked-in control documents, emits one JSON document
to stdout, and exits non-zero when reconciliation is required.
"""

from __future__ import annotations

import argparse
import copy
import fnmatch
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
from typing import Any, Iterable


sys.dont_write_bytecode = True

CONTROLLER_VERSION = "0.2.2"
REPORT_SCHEMA = "chenyida-erp-agent-readonly-report/v1"
PACKET_SCHEMA_V1 = "chenyida-erp-agent-task/v1"
PACKET_SCHEMA_V2 = "chenyida-erp-agent-task/v2"
PACKET_DIRECTORY = "docs/agent-control/task-packets"
PROJECT_PACKAGE_JSON = "chenyida_erp_site/package.json"
PROJECT_MIGRATION_DIRECTORY = "chenyida_erp_site/drizzle-postgres"
PROJECT_MIGRATION_JOURNAL = "chenyida_erp_site/drizzle-postgres/meta/_journal.json"
PROJECT_MIGRATION_SNAPSHOT_DIRECTORY = "chenyida_erp_site/drizzle-postgres/meta"
MAX_DOCUMENT_BYTES = 4 * 1024 * 1024
MAX_JSON_BYTES = 2 * 1024 * 1024
GIT_TIMEOUT_SECONDS = 10

LEDGER_STATES = frozenset({"TODO", "DOING", "DONE", "BLOCKED"})
CORE_DOCUMENTS = (
    "AGENTS.md",
    "docs/project/MASTER.md",
    "docs/project/TASKS.md",
    "docs/project/PROJECT_CONTEXT.md",
    "docs/project/DECISIONS.md",
    "docs/AI_AGENT_TEAM_DESIGN.md",
)
TASK_ID_RE = re.compile(r"^[A-Z][A-Z0-9-]{0,63}$")
TASK_DOCUMENT_RE = re.compile(r"^docs/tasks/[A-Za-z0-9._-]+\.md$")
SHA1_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
MIGRATION_RE = re.compile(r"^(?P<number>[0-9]{4})_(?P<name>[a-z0-9_]+)\.sql$")
TASK_ROW_RE = re.compile(
    r"^\|\s*(?P<task_id>[A-Z][A-Z0-9-]*)\s*\|[^|]*\|\s*"
    r"(?P<state>TODO|DOING|DONE|BLOCKED)\s*\|"
)

STATIC_MESSAGES = {
    "CORE_DOCUMENTS": "项目权威文档完整且不是符号链接",
    "DECISION_D113_ACCEPTED": "D-113已由项目负责人接受",
    "DECISION_D114_ACCEPTED": "D-114已由项目负责人接受",
    "GIT_BASELINE_ANCESTOR": "任务基线是当前HEAD的祖先",
    "GIT_BRANCH_MATCH": "当前分支与Task Packet一致",
    "GIT_COMMITTED_PATH_SCOPE": "基线后的已提交路径均在任务范围内",
    "GIT_REPOSITORY": "Git仓库根目录可只读核验",
    "GIT_SINGLE_WORKTREE": "当前只有一个Git worktree",
    "GIT_WORKTREE_PATH_SCOPE": "工作区变化均在任务范围内或为已知负责人输入",
    "MIGRATION_CHECKSUM_MATCH": "Migration head摘要与Task Packet一致",
    "MIGRATION_HEAD_MATCH": "Migration head编号和文件名一致",
    "MIGRATION_JOURNAL_MATCH": "Migration journal最后条目与head一致",
    "MIGRATION_SEQUENCE": "Migration编号连续且唯一",
    "MIGRATION_SNAPSHOT_MATCH": "Migration head存在对应非符号链接snapshot",
    "READ_ONLY_MODE": "控制器无持久化、修复、网络或数据库动作",
    "SOURCE_VERSION_MATCH": "源码package版本与Task Packet一致",
    "TASK_LEDGER_IDLE": "任务台账当前没有DOING任务",
    "TASK_LEDGER_DUPLICATE_ROWS": "历史台账存在状态一致的重复终态行",
    "TASK_LEDGER_UNIQUE": "任务台账只有一个DOING任务",
    "TASK_PACKET": "活动任务的机器可读Task Packet有效",
    "TASK_PACKET_LEDGER_MATCH": "活动任务与Task Packet状态一致",
    "UAT_DECLARATION_MATCH": "UAT版本边界只按权威文档声明核对",
}

V2_ROLE_NAMES = frozenset(
    {
        "CHANGE_BUILDER",
        "ERP_CONTRACT_GUARDIAN",
        "ADVERSARIAL_EXAMINER",
        "SECURITY_BOUNDARY_EXAMINER",
        "INDEPENDENT_VERIFIER",
        "BLACK_BOX_VERIFIER",
    }
)
V2_REQUIRED_GATES = frozenset({"ERP_CONTRACT", "SECURITY", "QA", "BLACK_BOX"})
V2_ALLOWED_CAPABILITIES = frozenset(
    {"READ_ONLY", "WORKTREE_WRITE", "TEST_EXECUTION", "GIT_COMMIT"}
)
V2_REQUIRED_FORBIDDEN_CAPABILITIES = frozenset(
    {
        "DATABASE_ACCESS",
        "DEPLOY",
        "GIT_PUSH",
        "MODEL_INVOCATION",
        "NETWORK_ACCESS",
        "PRODUCTION_ACCESS",
        "RUNTIME_DAEMON",
        "UAT_ACCESS",
    }
)


class InspectionProblem(Exception):
    """Expected, sanitized reconciliation failure."""

    def __init__(self, code: str, subject: str | None = None):
        super().__init__(code)
        self.code = code
        self.subject = subject


class GitProblem(InspectionProblem):
    def __init__(self, operation: str, returncode: int | None = None):
        super().__init__("GIT_COMMAND_FAILED", operation)
        self.returncode = returncode


def _json_object_without_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _safe_display(value: str) -> str:
    return value.encode("utf-8", "backslashreplace").decode("utf-8")


def _validate_relative_path(value: Any, *, allow_glob: bool = False) -> str:
    if (
        not isinstance(value, str)
        or not value
        or len(value) > 512
        or "\x00" in value
        or "\\" in value
    ):
        raise ValueError("invalid repository-relative path")
    if value.startswith("/") or value.endswith("/"):
        raise ValueError("invalid repository-relative path")
    raw_parts = value.split("/")
    if any(part in {"", ".", ".."} for part in raw_parts):
        raise ValueError("invalid repository-relative path")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError("invalid repository-relative path")
    if not allow_glob and any(character in value for character in "*?["):
        raise ValueError("glob not allowed")
    if path.parts[0] == ".git":
        raise ValueError("Git internals are never a packet path")
    return value


def _checked_path(root: Path, relative_path: str, *, directory: bool = False) -> Path:
    relative_path = _validate_relative_path(relative_path)
    current = root
    for part in PurePosixPath(relative_path).parts:
        current = current / part
        try:
            metadata = current.lstat()
        except FileNotFoundError as exc:
            raise InspectionProblem("REQUIRED_PATH_MISSING", relative_path) from exc
        except OSError as exc:
            raise InspectionProblem("REQUIRED_PATH_UNREADABLE", relative_path) from exc
        if stat.S_ISLNK(metadata.st_mode):
            raise InspectionProblem("SYMLINK_PATH_REJECTED", relative_path)
    try:
        final_metadata = current.stat()
    except OSError as exc:
        raise InspectionProblem("REQUIRED_PATH_UNREADABLE", relative_path) from exc
    required_type = stat.S_ISDIR if directory else stat.S_ISREG
    if not required_type(final_metadata.st_mode):
        raise InspectionProblem(
            "REQUIRED_DIRECTORY_INVALID" if directory else "REQUIRED_FILE_INVALID",
            relative_path,
        )
    if not directory and final_metadata.st_nlink != 1:
        raise InspectionProblem("HARDLINK_PATH_REJECTED", relative_path)
    return current


def _read_bytes(root: Path, relative_path: str, *, maximum: int) -> bytes:
    path = _checked_path(root, relative_path)
    try:
        size = path.stat().st_size
        if size > maximum:
            raise InspectionProblem("READ_SIZE_LIMIT_EXCEEDED", relative_path)
        with path.open("rb") as handle:
            value = handle.read(maximum + 1)
    except InspectionProblem:
        raise
    except OSError as exc:
        raise InspectionProblem("REQUIRED_PATH_UNREADABLE", relative_path) from exc
    if len(value) > maximum:
        raise InspectionProblem("READ_SIZE_LIMIT_EXCEEDED", relative_path)
    return value


def _read_text(root: Path, relative_path: str) -> tuple[str, dict[str, Any]]:
    value = _read_bytes(root, relative_path, maximum=MAX_DOCUMENT_BYTES)
    try:
        text = value.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise InspectionProblem("DOCUMENT_NOT_UTF8", relative_path) from exc
    return text, {"sha256": _sha256_bytes(value), "size": len(value)}


def _load_json(root: Path, relative_path: str) -> tuple[Any, bytes]:
    value = _read_bytes(root, relative_path, maximum=MAX_JSON_BYTES)
    try:
        parsed = json.loads(value, object_pairs_hook=_json_object_without_duplicates)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise InspectionProblem("JSON_INVALID", relative_path) from exc
    return parsed, value


def _require_exact_keys(value: Any, expected: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError("JSON object keys do not match schema")
    return value


def _require_string(
    value: Any,
    *,
    choices: Iterable[str] | None = None,
    maximum: int | None = None,
) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError("string required")
    if maximum is not None and len(value) > maximum:
        raise ValueError("string too long")
    if choices is not None and value not in set(choices):
        raise ValueError("unexpected string value")
    return value


def _require_string_list(value: Any, *, maximum: int | None = None) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) or not item for item in value):
        raise ValueError("string list required")
    if len(value) != len(set(value)):
        raise ValueError("duplicate list item")
    if maximum is not None and any(len(item) > maximum for item in value):
        raise ValueError("list item too long")
    return list(value)


def _require_integer(value: Any, *, minimum: int = 0, maximum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError("integer out of range")
    if maximum is not None and value > maximum:
        raise ValueError("integer out of range")
    return value


def _validate_task(packet: dict[str, Any], *, version: int) -> None:
    expected_keys = {
        "id",
        "revision",
        "ledger_state",
        "delivery_stage",
        "qualifiers",
        "task_document",
    }
    if version == 2:
        expected_keys |= {"objective", "non_goals"}
    task = _require_exact_keys(packet["task"], expected_keys)
    task_id = _require_string(task["id"])
    if not TASK_ID_RE.fullmatch(task_id):
        raise ValueError("invalid task id")
    _require_integer(task["revision"], minimum=1)
    _require_string(task["ledger_state"], choices=LEDGER_STATES)
    _require_string(task["delivery_stage"], maximum=128)
    _require_string_list(task["qualifiers"], maximum=128)
    task_document = _validate_relative_path(task["task_document"])
    if TASK_DOCUMENT_RE.fullmatch(task_document) is None:
        raise ValueError("task document must be a Markdown file in docs/tasks")
    if version == 2:
        _require_string(task["objective"], maximum=1024)
        non_goals = _require_string_list(task["non_goals"], maximum=512)
        if not non_goals:
            raise ValueError("bounded non-goals required")


def _validate_baseline(packet: dict[str, Any]) -> None:
    baseline = _require_exact_keys(
        packet["baseline"],
        {"base_sha", "expected_branch", "source_version", "source_migration", "uat"},
    )
    if not SHA1_RE.fullmatch(_require_string(baseline["base_sha"])):
        raise ValueError("invalid base SHA")
    _require_string(baseline["expected_branch"], maximum=128)
    _require_string(baseline["source_version"], maximum=128)
    source_migration = _require_exact_keys(
        baseline["source_migration"],
        {"first_number", "head_number", "head_filename", "head_sha256"},
    )
    for key in ("first_number", "head_number"):
        _require_integer(source_migration[key])
    if source_migration["head_number"] < source_migration["first_number"]:
        raise ValueError("invalid migration range")
    if not MIGRATION_RE.fullmatch(_require_string(source_migration["head_filename"])):
        raise ValueError("invalid migration filename")
    if not SHA256_RE.fullmatch(_require_string(source_migration["head_sha256"])):
        raise ValueError("invalid migration digest")
    uat = _require_exact_keys(baseline["uat"], {"version", "migration_head", "verification_scope"})
    _require_string(uat["version"], maximum=128)
    _require_string(uat["migration_head"], maximum=32)
    if uat["verification_scope"] != "DOCUMENT_DECLARATION_ONLY_NO_CONNECTION":
        raise ValueError("R1 cannot claim live UAT verification")


def _validate_scope(packet: dict[str, Any], *, version: int) -> None:
    expected_keys = {
        "allowed_changed_paths",
        "known_untracked_paths",
        "required_documents",
        "require_single_worktree",
    }
    if version == 2:
        expected_keys.add("data_classification")
    scope = _require_exact_keys(packet["scope"], expected_keys)
    allowed_paths = _require_string_list(scope["allowed_changed_paths"])
    if not allowed_paths:
        raise ValueError("at least one allowed path is required")
    for pattern in allowed_paths:
        _validate_relative_path(pattern, allow_glob=True)
        if pattern in {"*", "**", "**/*"}:
            raise ValueError("unbounded path pattern")
    known_untracked_paths = _require_string_list(scope["known_untracked_paths"])
    for relative_path in known_untracked_paths:
        _validate_relative_path(relative_path)
    required_documents = _require_string_list(scope["required_documents"])
    for relative_path in required_documents:
        _validate_relative_path(relative_path)
        if relative_path != "AGENTS.md" and not (
            relative_path.startswith("docs/") and relative_path.endswith(".md")
        ):
            raise ValueError("required documents are limited to project Markdown")
        if relative_path == "docs/ERP_CURRENT_STATUS_REPORT.md":
            raise ValueError("owner input cannot be read by R1")
    if packet["task"]["task_document"] not in required_documents:
        raise ValueError("task document must be required")
    if not isinstance(scope["require_single_worktree"], bool):
        raise ValueError("boolean required")
    if version == 2 and scope["data_classification"] != "SYNTHETIC_DOCS_TEST_ONLY":
        raise ValueError("R1.5 permits synthetic docs/test data only")


def _validate_inspection(packet: dict[str, Any], *, version: int) -> None:
    decision_key = "required_decision" if version == 1 else "required_decisions"
    inspection = _require_exact_keys(
        packet["inspection"],
        {
            "package_json",
            "migration_directory",
            "migration_journal",
            "migration_snapshot_directory",
            decision_key,
            "uat_document_markers",
        },
    )
    fixed_inspection_paths = {
        "package_json": PROJECT_PACKAGE_JSON,
        "migration_directory": PROJECT_MIGRATION_DIRECTORY,
        "migration_journal": PROJECT_MIGRATION_JOURNAL,
        "migration_snapshot_directory": PROJECT_MIGRATION_SNAPSHOT_DIRECTORY,
    }
    for key, expected_path in fixed_inspection_paths.items():
        _validate_relative_path(inspection[key])
        if inspection[key] != expected_path:
            raise ValueError("R1 inspection path cannot be redirected")
    if version == 1 and inspection[decision_key] != "D-113":
        raise ValueError("R1 requires D-113")
    if version == 2 and set(_require_string_list(inspection[decision_key])) != {"D-113", "D-114"}:
        raise ValueError("R1.5 requires accepted D-113 and D-114")
    markers = inspection["uat_document_markers"]
    if not isinstance(markers, list) or not markers:
        raise ValueError("UAT document markers required")
    for marker in markers:
        marker = _require_exact_keys(marker, {"path", "contains"})
        _validate_relative_path(marker["path"])
        contains = _require_string_list(marker["contains"], maximum=128)
        if not contains:
            raise ValueError("invalid UAT marker")


def _validate_v2_orchestration(packet: dict[str, Any]) -> None:
    orchestration = _require_exact_keys(
        packet["orchestration"],
        {
            "product_writer_agent_id",
            "active_lease_generation",
            "roles",
            "required_gates",
            "allowed_capabilities",
            "forbidden_capabilities",
            "retry_policy",
        },
    )
    product_writer = _require_string(orchestration["product_writer_agent_id"])
    if not re.fullmatch(r"^[a-z][a-z0-9-]{2,63}$", product_writer):
        raise ValueError("invalid product writer id")
    _require_integer(orchestration["active_lease_generation"], minimum=1)

    roles = orchestration["roles"]
    if not isinstance(roles, list) or len(roles) != len(V2_ROLE_NAMES):
        raise ValueError("R1.5 requires six separated roles")
    expected_profiles = {
        "CHANGE_BUILDER": "SYNTHETIC_BUILDER",
        "ERP_CONTRACT_GUARDIAN": "ERP_READ_ONLY",
        "ADVERSARIAL_EXAMINER": "ADVERSARIAL_READ_ONLY",
        "SECURITY_BOUNDARY_EXAMINER": "SECURITY_READ_ONLY",
        "INDEPENDENT_VERIFIER": "QA_TEST_READ_ONLY",
        "BLACK_BOX_VERIFIER": "BLACK_BOX_PUBLIC_ONLY",
    }
    agent_ids: set[str] = set()
    role_names: set[str] = set()
    writers: list[str] = []
    for raw_role in roles:
        role = _require_exact_keys(
            raw_role,
            {"agent_id", "role", "capability_profile", "context_visibility", "can_write"},
        )
        agent_id = _require_string(role["agent_id"])
        if not re.fullmatch(r"^[a-z][a-z0-9-]{2,63}$", agent_id) or agent_id in agent_ids:
            raise ValueError("invalid or duplicate agent id")
        agent_ids.add(agent_id)
        role_name = _require_string(role["role"], choices=V2_ROLE_NAMES)
        if role_name in role_names:
            raise ValueError("role identity cannot be reused")
        role_names.add(role_name)
        if role["capability_profile"] != expected_profiles[role_name]:
            raise ValueError("role capability profile mismatch")
        expected_visibility = (
            "BLACK_BOX_PUBLIC_ONLY" if role_name == "BLACK_BOX_VERIFIER" else "SYNTHETIC_PROTOCOL_ONLY"
        )
        if role["context_visibility"] != expected_visibility:
            raise ValueError("role context boundary mismatch")
        if not isinstance(role["can_write"], bool):
            raise ValueError("role write flag must be boolean")
        if role["can_write"]:
            writers.append(agent_id)
            if role_name != "CHANGE_BUILDER":
                raise ValueError("review roles cannot write")
    if role_names != set(V2_ROLE_NAMES) or writers != [product_writer]:
        raise ValueError("exactly one declared product writer is required")

    required_gates = set(_require_string_list(orchestration["required_gates"]))
    if required_gates != set(V2_REQUIRED_GATES):
        raise ValueError("required independent gates are incomplete")
    allowed = set(_require_string_list(orchestration["allowed_capabilities"]))
    forbidden = set(_require_string_list(orchestration["forbidden_capabilities"]))
    if allowed != set(V2_ALLOWED_CAPABILITIES):
        raise ValueError("R1.5 capability ceiling changed")
    if forbidden != set(V2_REQUIRED_FORBIDDEN_CAPABILITIES) or allowed & forbidden:
        raise ValueError("R1.5 forbidden capabilities changed")

    retry_policy = _require_exact_keys(
        orchestration["retry_policy"],
        {"max_candidate_revisions", "max_attempts_per_gate", "result_unknown_action"},
    )
    _require_integer(retry_policy["max_candidate_revisions"], minimum=2, maximum=3)
    _require_integer(retry_policy["max_attempts_per_gate"], minimum=1, maximum=3)
    if retry_policy["result_unknown_action"] != "RECONCILE_BEFORE_REPLAY":
        raise ValueError("RESULT_UNKNOWN must be reconciled before replay")

    resources = _require_exact_keys(
        packet["resources"],
        {
            "max_concurrent_light_agents",
            "max_product_writers",
            "max_heavy_actions",
            "max_temporary_containers",
            "max_temporary_databases",
            "network_allowed",
            "database_allowed",
            "uat_allowed",
            "production_allowed",
            "deploy_allowed",
        },
    )
    _require_integer(resources["max_concurrent_light_agents"], minimum=1, maximum=2)
    if (
        _require_integer(resources["max_product_writers"]) != 1
        or _require_integer(resources["max_heavy_actions"]) != 1
    ):
        raise ValueError("single writer and single heavy action are mandatory")
    _require_integer(resources["max_temporary_containers"], maximum=1)
    if _require_integer(resources["max_temporary_databases"]) != 0:
        raise ValueError("R1.5 cannot create a database")
    for key in (
        "network_allowed",
        "database_allowed",
        "uat_allowed",
        "production_allowed",
        "deploy_allowed",
    ):
        if resources[key] is not False:
            raise ValueError("R1.5 external/runtime capability must remain disabled")


def _validate_packet(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("packet object required")
    schema_version = value.get("schema_version")
    if schema_version == PACKET_SCHEMA_V1:
        packet = _require_exact_keys(
            value,
            {"schema_version", "task", "baseline", "scope", "inspection"},
        )
        version = 1
    elif schema_version == PACKET_SCHEMA_V2:
        packet = _require_exact_keys(
            value,
            {
                "schema_version",
                "task",
                "baseline",
                "scope",
                "inspection",
                "orchestration",
                "resources",
            },
        )
        version = 2
    else:
        raise ValueError("unsupported packet schema")

    _validate_task(packet, version=version)
    _validate_baseline(packet)
    _validate_scope(packet, version=version)
    _validate_inspection(packet, version=version)
    if version == 2:
        _validate_v2_orchestration(packet)
    return packet


def validate_task_packet(value: Any) -> dict[str, Any]:
    """Validate a v1/v2 packet without reading or mutating repository state."""

    return _validate_packet(copy.deepcopy(value))


def _git_environment() -> dict[str, str]:
    return {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": "C",
        "LC_ALL": "C",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_OPTIONAL_LOCKS": "0",
        "GIT_TERMINAL_PROMPT": "0",
    }


def _git(
    root: Path,
    arguments: list[str],
    *,
    operation: str,
    accepted_returncodes: frozenset[int] = frozenset({0}),
) -> subprocess.CompletedProcess[bytes]:
    executable = shutil.which("git", path=_git_environment()["PATH"])
    if executable is None:
        raise GitProblem(operation)
    command = [
        executable,
        "--no-optional-locks",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "gc.auto=0",
        *arguments,
    ]
    try:
        result = subprocess.run(
            command,
            cwd=root,
            env=_git_environment(),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=GIT_TIMEOUT_SECONDS,
            check=False,
            close_fds=True,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise GitProblem(operation) from exc
    if result.returncode not in accepted_returncodes:
        raise GitProblem(operation, result.returncode)
    return result


def _decode_git_line(value: bytes, operation: str) -> str:
    try:
        return value.decode("utf-8").strip()
    except UnicodeDecodeError as exc:
        raise GitProblem(operation) from exc


def _git_name_list(value: bytes, operation: str) -> list[str]:
    names: list[str] = []
    for raw_name in value.split(b"\x00"):
        if not raw_name:
            continue
        try:
            name = raw_name.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise GitProblem(operation) from exc
        try:
            names.append(_validate_relative_path(name))
        except ValueError as exc:
            raise InspectionProblem("GIT_PATH_INVALID", _safe_display(name)) from exc
    return sorted(set(names))


def _git_status_entries(value: bytes) -> list[dict[str, str]]:
    raw_entries = value.split(b"\x00")
    if raw_entries and raw_entries[-1] == b"":
        raw_entries.pop()
    entries: list[dict[str, str]] = []
    index = 0
    while index < len(raw_entries):
        raw_entry = raw_entries[index]
        if len(raw_entry) < 4 or raw_entry[2:3] != b" ":
            raise InspectionProblem("GIT_STATUS_INVALID")
        try:
            status_code = raw_entry[:2].decode("ascii")
            path = raw_entry[3:].decode("utf-8")
        except UnicodeDecodeError as exc:
            raise InspectionProblem("GIT_STATUS_INVALID") from exc
        try:
            path = _validate_relative_path(path)
        except ValueError as exc:
            raise InspectionProblem("GIT_PATH_INVALID", _safe_display(path)) from exc
        entry = {"path": path, "status": status_code}
        if "R" in status_code or "C" in status_code:
            index += 1
            if index >= len(raw_entries):
                raise InspectionProblem("GIT_STATUS_INVALID")
            try:
                original_path = raw_entries[index].decode("utf-8")
                original_path = _validate_relative_path(original_path)
            except (UnicodeDecodeError, ValueError) as exc:
                raise InspectionProblem("GIT_STATUS_INVALID") from exc
            entry["original_path"] = original_path
        entries.append(entry)
        index += 1
    return sorted(entries, key=lambda item: (item["path"], item["status"], item.get("original_path", "")))


def _parse_task_rows(tasks_markdown: str) -> tuple[dict[str, str], list[str]]:
    rows: dict[str, str] = {}
    duplicate_terminal_rows: list[str] = []
    for line in tasks_markdown.splitlines():
        match = TASK_ROW_RE.match(line)
        if match is None:
            continue
        task_id = match.group("task_id")
        state = match.group("state")
        if task_id in rows:
            if rows[task_id] != state or state in {"TODO", "DOING", "BLOCKED"}:
                raise InspectionProblem("TASK_LEDGER_DUPLICATE_ID", task_id)
            duplicate_terminal_rows.append(task_id)
            continue
        rows[task_id] = state
    if not rows:
        raise InspectionProblem("TASK_LEDGER_UNREADABLE")
    return rows, sorted(set(duplicate_terminal_rows))


def _decision_is_accepted(decisions_markdown: str, decision_id: str) -> bool:
    if not re.fullmatch(r"D-[0-9]{3}", decision_id):
        return False
    section_match = re.search(
        rf"^## {re.escape(decision_id)}\b(?P<section>.*?)(?=^## \S|\Z)",
        decisions_markdown,
        flags=re.MULTILINE | re.DOTALL,
    )
    if section_match is None:
        return False
    return bool(
        re.search(
            r"^- 状态：`ACCEPTED(?:\s*/[^`]*)?`\s*$",
            section_match.group("section"),
            flags=re.MULTILINE,
        )
    )


def _path_allowed(path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatchcase(path, pattern) for pattern in patterns)


def _finding(
    code: str,
    result: str,
    *,
    subject: str | None = None,
    expected: Any | None = None,
    actual: Any | None = None,
) -> dict[str, Any]:
    finding: dict[str, Any] = {
        "code": code,
        "message": STATIC_MESSAGES.get(code, "只读对账发现需要处理的状态"),
        "result": result,
    }
    if subject is not None:
        finding["subject"] = _safe_display(subject)
    if expected is not None:
        finding["expected"] = expected
    if actual is not None:
        finding["actual"] = actual
    return finding


def _failure_from_problem(problem: InspectionProblem) -> dict[str, Any]:
    finding = _finding(problem.code, "FAIL", subject=problem.subject)
    if isinstance(problem, GitProblem) and problem.returncode is not None:
        finding["returncode"] = problem.returncode
    return finding


def _inspect_git_repository(root: Path) -> dict[str, Any]:
    top_level = _decode_git_line(
        _git(root, ["rev-parse", "--show-toplevel"], operation="rev-parse-root").stdout,
        "rev-parse-root",
    )
    try:
        reported_root = Path(top_level).resolve(strict=True)
    except OSError as exc:
        raise GitProblem("resolve-root") from exc
    if reported_root != root:
        raise InspectionProblem("GIT_ROOT_MISMATCH", _safe_display(top_level))
    head = _decode_git_line(
        _git(root, ["rev-parse", "--verify", "HEAD"], operation="rev-parse-head").stdout,
        "rev-parse-head",
    )
    if not SHA1_RE.fullmatch(head):
        raise GitProblem("rev-parse-head")
    branch = _decode_git_line(
        _git(
            root,
            ["symbolic-ref", "--quiet", "--short", "HEAD"],
            operation="symbolic-ref-head",
        ).stdout,
        "symbolic-ref-head",
    )
    status = _git_status_entries(
        _git(
            root,
            ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
            operation="status",
        ).stdout
    )
    worktree_output = _decode_git_line(
        _git(root, ["worktree", "list", "--porcelain"], operation="worktree-list").stdout,
        "worktree-list",
    )
    worktrees = [
        line.removeprefix("worktree ")
        for line in worktree_output.splitlines()
        if line.startswith("worktree ")
    ]
    return {
        "branch": branch,
        "head": head,
        "root": root.as_posix(),
        "status_entries": status,
        "worktree_count": len(worktrees),
        "worktrees": sorted(_safe_display(item) for item in worktrees),
    }


def _inspect_migrations(
    root: Path,
    packet: dict[str, Any],
    findings: list[dict[str, Any]],
) -> dict[str, Any]:
    inspection = packet["inspection"]
    expected = packet["baseline"]["source_migration"]
    migration_dir = _checked_path(root, inspection["migration_directory"], directory=True)
    migrations: list[tuple[int, str]] = []
    seen_numbers: set[int] = set()
    try:
        directory_entries = sorted(os.scandir(migration_dir), key=lambda item: item.name)
    except OSError as exc:
        raise InspectionProblem("REQUIRED_PATH_UNREADABLE", inspection["migration_directory"]) from exc
    for entry in directory_entries:
        match = MIGRATION_RE.fullmatch(entry.name)
        if match is None:
            continue
        if entry.is_symlink() or not entry.is_file(follow_symlinks=False):
            findings.append(_finding("MIGRATION_FILE_INVALID", "FAIL", subject=entry.name))
            continue
        number = int(match.group("number"))
        if number in seen_numbers:
            findings.append(_finding("MIGRATION_NUMBER_DUPLICATE", "FAIL", actual=number))
        seen_numbers.add(number)
        migrations.append((number, entry.name))

    actual_numbers = sorted(number for number, _ in migrations)
    expected_numbers = list(range(expected["first_number"], expected["head_number"] + 1))
    findings.append(
        _finding(
            "MIGRATION_SEQUENCE",
            "PASS" if actual_numbers == expected_numbers and len(actual_numbers) == len(seen_numbers) else "FAIL",
            expected=expected_numbers,
            actual=actual_numbers,
        )
    )
    actual_head = migrations[-1] if migrations else (None, None)
    expected_head = (expected["head_number"], expected["head_filename"])
    findings.append(
        _finding(
            "MIGRATION_HEAD_MATCH",
            "PASS" if actual_head == expected_head else "FAIL",
            expected={"filename": expected_head[1], "number": expected_head[0]},
            actual={"filename": actual_head[1], "number": actual_head[0]},
        )
    )

    head_relative_path = f"{inspection['migration_directory']}/{expected['head_filename']}"
    head_bytes = _read_bytes(root, head_relative_path, maximum=MAX_DOCUMENT_BYTES)
    actual_digest = _sha256_bytes(head_bytes)
    findings.append(
        _finding(
            "MIGRATION_CHECKSUM_MATCH",
            "PASS" if actual_digest == expected["head_sha256"] else "FAIL",
            expected=expected["head_sha256"],
            actual=actual_digest,
        )
    )

    snapshot_relative_path = (
        f"{inspection['migration_snapshot_directory']}/{expected['head_number']:04d}_snapshot.json"
    )
    snapshot_bytes = _read_bytes(root, snapshot_relative_path, maximum=MAX_DOCUMENT_BYTES)
    findings.append(_finding("MIGRATION_SNAPSHOT_MATCH", "PASS", subject=snapshot_relative_path))

    journal, journal_bytes = _load_json(root, inspection["migration_journal"])
    journal_valid = False
    if isinstance(journal, dict) and isinstance(journal.get("entries"), list) and journal["entries"]:
        last_entry = journal["entries"][-1]
        expected_tag = expected["head_filename"].removesuffix(".sql")
        journal_valid = (
            isinstance(last_entry, dict)
            and last_entry.get("idx") == expected["head_number"]
            and last_entry.get("tag") == expected_tag
        )
    findings.append(
        _finding(
            "MIGRATION_JOURNAL_MATCH",
            "PASS" if journal_valid else "FAIL",
            expected={
                "idx": expected["head_number"],
                "tag": expected["head_filename"].removesuffix(".sql"),
            },
        )
    )
    return {
        "count": len(migrations),
        "head_filename": actual_head[1],
        "head_number": actual_head[0],
        "head_sha256": actual_digest,
        "journal_sha256": _sha256_bytes(journal_bytes),
        "snapshot_path": snapshot_relative_path,
        "snapshot_sha256": _sha256_bytes(snapshot_bytes),
    }


def inspect_repository(repository: str | os.PathLike[str]) -> dict[str, Any]:
    findings: list[dict[str, Any]] = []
    documents: dict[str, dict[str, Any]] = {}
    report: dict[str, Any] = {
        "controller_version": CONTROLLER_VERSION,
        "documents": documents,
        "findings": findings,
        "git": None,
        "migration": None,
        "schema_version": REPORT_SCHEMA,
        "source": None,
        "task": {"active_task_id": None, "doing_task_ids": [], "packet_revision": None},
        "uat": None,
    }

    try:
        root = Path(repository).resolve(strict=True)
        if not root.is_dir():
            raise InspectionProblem("REPOSITORY_ROOT_INVALID", _safe_display(str(repository)))
    except (OSError, InspectionProblem) as exc:
        problem = exc if isinstance(exc, InspectionProblem) else InspectionProblem("REPOSITORY_ROOT_INVALID")
        findings.append(_failure_from_problem(problem))
        return _finalize_report(report)

    try:
        report["git"] = _inspect_git_repository(root)
        findings.append(_finding("GIT_REPOSITORY", "PASS", subject=root.as_posix()))
    except InspectionProblem as problem:
        findings.append(_failure_from_problem(problem))

    document_text: dict[str, str] = {}
    core_documents_ok = True
    for relative_path in CORE_DOCUMENTS:
        try:
            text, metadata = _read_text(root, relative_path)
            document_text[relative_path] = text
            documents[relative_path] = metadata
        except InspectionProblem as problem:
            core_documents_ok = False
            findings.append(_failure_from_problem(problem))
    findings.append(_finding("CORE_DOCUMENTS", "PASS" if core_documents_ok else "FAIL"))

    tasks_text = document_text.get("docs/project/TASKS.md")
    if tasks_text is None:
        return _finalize_report(report)
    try:
        task_rows, duplicate_terminal_rows = _parse_task_rows(tasks_text)
    except InspectionProblem as problem:
        findings.append(_failure_from_problem(problem))
        return _finalize_report(report)
    decisions_text = document_text.get("docs/project/DECISIONS.md", "")
    findings.append(
        _finding(
            "DECISION_D113_ACCEPTED",
            "PASS" if _decision_is_accepted(decisions_text, "D-113") else "FAIL",
        )
    )
    doing_task_ids = sorted(task_id for task_id, state in task_rows.items() if state == "DOING")
    if duplicate_terminal_rows:
        findings.append(
            _finding(
                "TASK_LEDGER_DUPLICATE_ROWS",
                "WARN",
                actual=duplicate_terminal_rows,
            )
        )
    report["task"]["doing_task_ids"] = doing_task_ids
    if not doing_task_ids:
        findings.append(_finding("TASK_LEDGER_IDLE", "PASS"))
        findings.append(_finding("READ_ONLY_MODE", "PASS"))
        return _finalize_report(report, idle=True)
    if len(doing_task_ids) != 1:
        findings.append(
            _finding("MULTIPLE_DOING_TASKS", "FAIL", expected=1, actual=len(doing_task_ids))
        )
        findings.append(_finding("READ_ONLY_MODE", "PASS"))
        return _finalize_report(report)

    active_task_id = doing_task_ids[0]
    report["task"]["active_task_id"] = active_task_id
    findings.append(_finding("TASK_LEDGER_UNIQUE", "PASS", actual=active_task_id))
    packet_relative_path = f"{PACKET_DIRECTORY}/{active_task_id}.json"
    try:
        raw_packet, packet_bytes = _load_json(root, packet_relative_path)
        packet = _validate_packet(raw_packet)
    except InspectionProblem as problem:
        code = "TASK_PACKET_MISSING" if problem.code == "REQUIRED_PATH_MISSING" else "TASK_PACKET_INVALID"
        findings.append(_finding(code, "FAIL", subject=packet_relative_path))
        findings.append(_finding("READ_ONLY_MODE", "PASS"))
        return _finalize_report(report)
    except ValueError:
        findings.append(_finding("TASK_PACKET_INVALID", "FAIL", subject=packet_relative_path))
        findings.append(_finding("READ_ONLY_MODE", "PASS"))
        return _finalize_report(report)
    documents[packet_relative_path] = {
        "sha256": _sha256_bytes(packet_bytes),
        "size": len(packet_bytes),
    }
    report["task"]["packet_revision"] = packet["task"]["revision"]
    findings.append(_finding("TASK_PACKET", "PASS", subject=packet_relative_path))
    if packet["schema_version"] == PACKET_SCHEMA_V2:
        findings.append(
            _finding(
                "DECISION_D114_ACCEPTED",
                "PASS" if _decision_is_accepted(decisions_text, "D-114") else "FAIL",
            )
        )

    packet_matches = (
        packet["task"]["id"] == active_task_id
        and packet["task"]["ledger_state"] == task_rows[active_task_id]
        and packet["task"]["ledger_state"] == "DOING"
    )
    findings.append(
        _finding(
            "TASK_PACKET_LEDGER_MATCH",
            "PASS" if packet_matches else "FAIL",
            expected={"id": active_task_id, "ledger_state": "DOING"},
            actual={
                "id": packet["task"]["id"],
                "ledger_state": packet["task"]["ledger_state"],
            },
        )
    )

    required_documents_ok = True
    required_documents = sorted(set(CORE_DOCUMENTS) | set(packet["scope"]["required_documents"]))
    for relative_path in required_documents:
        if relative_path in document_text:
            continue
        try:
            text, metadata = _read_text(root, relative_path)
            document_text[relative_path] = text
            documents[relative_path] = metadata
        except InspectionProblem as problem:
            required_documents_ok = False
            findings.append(_failure_from_problem(problem))
    if not required_documents_ok:
        findings.append(_finding("REQUIRED_DOCUMENTS", "FAIL"))

    git_info = report["git"]
    if isinstance(git_info, dict):
        expected_branch = packet["baseline"]["expected_branch"]
        findings.append(
            _finding(
                "GIT_BRANCH_MATCH",
                "PASS" if git_info["branch"] == expected_branch else "FAIL",
                expected=expected_branch,
                actual=git_info["branch"],
            )
        )
        if packet["scope"]["require_single_worktree"]:
            findings.append(
                _finding(
                    "GIT_SINGLE_WORKTREE",
                    "PASS" if git_info["worktree_count"] == 1 else "FAIL",
                    expected=1,
                    actual=git_info["worktree_count"],
                )
            )
        base_sha = packet["baseline"]["base_sha"]
        try:
            ancestor_result = _git(
                root,
                ["merge-base", "--is-ancestor", base_sha, git_info["head"]],
                operation="merge-base-ancestor",
                accepted_returncodes=frozenset({0, 1}),
            )
            base_is_ancestor = ancestor_result.returncode == 0
            findings.append(
                _finding(
                    "GIT_BASELINE_ANCESTOR",
                    "PASS" if base_is_ancestor else "FAIL",
                    expected=True,
                    actual=base_is_ancestor,
                )
            )
            committed_paths: list[str] = []
            if base_is_ancestor:
                committed_paths = _git_name_list(
                    _git(
                        root,
                        [
                            "diff",
                            "--name-only",
                            "-z",
                            "--diff-filter=ACDMRTUXB",
                            f"{base_sha}..{git_info['head']}",
                            "--",
                        ],
                        operation="diff-base-head",
                    ).stdout,
                    "diff-base-head",
                )
            git_info["base_sha"] = base_sha
            git_info["committed_changed_paths"] = committed_paths
            unauthorized_committed = sorted(
                path
                for path in committed_paths
                if not _path_allowed(path, packet["scope"]["allowed_changed_paths"])
            )
            findings.append(
                _finding(
                    "GIT_COMMITTED_PATH_SCOPE",
                    "PASS" if not unauthorized_committed else "FAIL",
                    actual=unauthorized_committed,
                )
            )
        except InspectionProblem as problem:
            findings.append(_failure_from_problem(problem))

        allowed_worktree: list[str] = []
        known_untracked: list[str] = []
        unauthorized_worktree: list[str] = []
        known_untracked_paths = set(packet["scope"]["known_untracked_paths"])
        for entry in git_info["status_entries"]:
            paths = [entry["path"]]
            if "original_path" in entry:
                paths.append(entry["original_path"])
            for path in paths:
                if path in known_untracked_paths and entry["status"] == "??":
                    known_untracked.append(path)
                elif _path_allowed(path, packet["scope"]["allowed_changed_paths"]):
                    allowed_worktree.append(path)
                else:
                    unauthorized_worktree.append(path)
        git_info["allowed_worktree_paths"] = sorted(set(allowed_worktree))
        git_info["known_untracked_paths"] = sorted(set(known_untracked))
        git_info["unauthorized_worktree_paths"] = sorted(set(unauthorized_worktree))
        findings.append(
            _finding(
                "GIT_WORKTREE_PATH_SCOPE",
                "PASS" if not unauthorized_worktree else "FAIL",
                actual=sorted(set(unauthorized_worktree)),
            )
        )

    try:
        package, package_bytes = _load_json(root, packet["inspection"]["package_json"])
        if not isinstance(package, dict) or not isinstance(package.get("version"), str):
            raise InspectionProblem("PACKAGE_JSON_INVALID", packet["inspection"]["package_json"])
        source_version = package["version"]
        expected_source_version = packet["baseline"]["source_version"]
        report["source"] = {
            "package_path": packet["inspection"]["package_json"],
            "package_sha256": _sha256_bytes(package_bytes),
            "version": source_version,
        }
        findings.append(
            _finding(
                "SOURCE_VERSION_MATCH",
                "PASS" if source_version == expected_source_version else "FAIL",
                expected=expected_source_version,
                actual=source_version,
            )
        )
        report["migration"] = _inspect_migrations(root, packet, findings)
    except InspectionProblem as problem:
        findings.append(_failure_from_problem(problem))

    uat_markers_ok = True
    for marker in packet["inspection"]["uat_document_markers"]:
        marker_text = document_text.get(marker["path"])
        if marker_text is None:
            try:
                marker_text, metadata = _read_text(root, marker["path"])
                document_text[marker["path"]] = marker_text
                documents[marker["path"]] = metadata
            except InspectionProblem as problem:
                uat_markers_ok = False
                findings.append(_failure_from_problem(problem))
                continue
        if any(expected_text not in marker_text for expected_text in marker["contains"]):
            uat_markers_ok = False
    report["uat"] = {
        "migration_head": packet["baseline"]["uat"]["migration_head"],
        "verification_scope": packet["baseline"]["uat"]["verification_scope"],
        "version": packet["baseline"]["uat"]["version"],
    }
    findings.append(_finding("UAT_DECLARATION_MATCH", "PASS" if uat_markers_ok else "FAIL"))
    findings.append(_finding("READ_ONLY_MODE", "PASS"))
    return _finalize_report(report)


def _finalize_report(report: dict[str, Any], *, idle: bool = False) -> dict[str, Any]:
    report["documents"] = dict(sorted(report["documents"].items()))
    report["findings"] = sorted(
        report["findings"],
        key=lambda item: (item["code"], item["result"], item.get("subject", "")),
    )
    failed_codes = sorted(
        {finding["code"] for finding in report["findings"] if finding["result"] == "FAIL"}
    )
    warning_codes = sorted(
        {finding["code"] for finding in report["findings"] if finding["result"] == "WARN"}
    )
    if failed_codes:
        status = "STATE_RECONCILIATION_REQUIRED"
        exit_code = 2
    elif idle:
        status = "IDLE"
        exit_code = 0
    else:
        status = "READY"
        exit_code = 0
    report["errors"] = failed_codes
    report["exit_code"] = exit_code
    report["status"] = status
    report["warnings"] = warning_codes
    digest_input = copy.deepcopy(report)
    report["report_digest"] = _sha256_bytes(_canonical_json(digest_input))
    return report


def _argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="只读核对晨亿达ERP研发任务、Git、版本和Migration文件",
    )
    parser.add_argument(
        "--repo",
        default=".",
        help="本地Git仓库路径；控制器不会写入该路径",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="缩进JSON输出；唯一输出仍为stdout",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    arguments = _argument_parser().parse_args(argv)
    try:
        report = inspect_repository(arguments.repo)
    except Exception:
        report = _finalize_report(
            {
                "controller_version": CONTROLLER_VERSION,
                "documents": {},
                "findings": [_finding("CONTROLLER_INTERNAL_ERROR", "FAIL")],
                "git": None,
                "migration": None,
                "schema_version": REPORT_SCHEMA,
                "source": None,
                "task": {"active_task_id": None, "doing_task_ids": [], "packet_revision": None},
                "uat": None,
            }
        )
        report["exit_code"] = 70
        digest_input = copy.deepcopy(report)
        digest_input.pop("report_digest", None)
        report["report_digest"] = _sha256_bytes(_canonical_json(digest_input))
    json.dump(
        report,
        sys.stdout,
        ensure_ascii=False,
        sort_keys=True,
        indent=2 if arguments.pretty else None,
        separators=None if arguments.pretty else (",", ":"),
    )
    sys.stdout.write("\n")
    return int(report["exit_code"])


if __name__ == "__main__":
    raise SystemExit(main())
