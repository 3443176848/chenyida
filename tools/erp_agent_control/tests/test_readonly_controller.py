from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest


CONTROLLER_PATH = Path(__file__).resolve().parents[1] / "readonly_controller.py"
SPEC = importlib.util.spec_from_file_location("erp_agent_readonly_controller", CONTROLLER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("controller module could not be loaded")
CONTROLLER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTROLLER)


class RepositoryFixture:
    def __init__(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory(prefix="agent-r1-test-")
        self.root = Path(self.temporary_directory.name)
        self._write_baseline()
        self._git("init", "-b", "main")
        self._git("config", "user.name", "AGENT-R1 Test")
        self._git("config", "user.email", "agent-r1-test@example.invalid")
        self._git("add", ".")
        self._git("commit", "-m", "test: create fixture baseline")
        self.base_sha = self._git("rev-parse", "HEAD").stdout.strip()
        self._write_active_state()
        self._git("add", ".")
        self._git("commit", "-m", "docs: start fixture task")
        self.write("docs/ERP_CURRENT_STATUS_REPORT.md", "owner input stays untracked\n")

    def close(self) -> None:
        self.temporary_directory.cleanup()

    def _git(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *arguments],
            cwd=self.root,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True,
            timeout=10,
        )

    def write(self, relative_path: str, value: str) -> None:
        path = self.root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding="utf-8")

    def read(self, relative_path: str) -> str:
        return (self.root / relative_path).read_text(encoding="utf-8")

    def load_packet(self) -> dict:
        return json.loads(self.read("docs/agent-control/task-packets/AGENT-R1.json"))

    def write_packet(self, packet: dict) -> None:
        self.write(
            "docs/agent-control/task-packets/AGENT-R1.json",
            json.dumps(packet, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        )

    def _write_baseline(self) -> None:
        self.write("AGENTS.md", "# Test AGENTS\n")
        self.write(
            "docs/project/MASTER.md",
            "# MASTER\nsource 0.1.0-alpha.44; UAT 0.1.0-alpha.42 / 0040\n",
        )
        self.write(
            "docs/project/TASKS.md",
            "# TASKS\n\n| 任务编号 | 任务名称 | 状态 | 负责人 |\n"
            "| --- | --- | --- | --- |\n"
            "| PM-001 | Design | DONE | Test |\n"
            "| PHASE4-TASK03 | AI layer | BLOCKED | Test |\n",
        )
        self.write(
            "docs/project/PROJECT_CONTEXT.md",
            "# CONTEXT\nsource 0.1.0-alpha.44; UAT 0.1.0-alpha.42 / 0040\n",
        )
        self.write(
            "docs/project/DECISIONS.md",
            "# DECISIONS\n\n## D-113 Test decision\n\n"
            "- 状态：`PROPOSED / DESIGN BASELINE`\n",
        )
        self.write("docs/project/CHANGELOG.md", "# CHANGELOG\n")
        self.write("docs/project/STATUS.md", "# STATUS\n")
        self.write("docs/AI_AGENT_TEAM_DESIGN.md", "# DESIGN\n")
        self.write("chenyida_erp_site/package.json", '{"version":"0.1.0-alpha.44"}\n')
        migration = b"SELECT 1;\n"
        migration_path = self.root / "chenyida_erp_site/drizzle-postgres/0001_test.sql"
        migration_path.parent.mkdir(parents=True, exist_ok=True)
        migration_path.write_bytes(migration)
        self.write("chenyida_erp_site/drizzle-postgres/meta/0001_snapshot.json", "{}\n")
        self.write(
            "chenyida_erp_site/drizzle-postgres/meta/_journal.json",
            '{"entries":[{"idx":1,"tag":"0001_test"}]}\n',
        )

    def _write_active_state(self) -> None:
        self.write(
            "docs/project/TASKS.md",
            "# TASKS\n\n| 任务编号 | 任务名称 | 状态 | 负责人 |\n"
            "| --- | --- | --- | --- |\n"
            "| AGENT-R1 | Read-only controller | DOING | Test |\n"
            "| PM-001 | Design | DONE | Test |\n"
            "| PHASE4-TASK03 | AI layer | BLOCKED | Test |\n",
        )
        self.write(
            "docs/project/DECISIONS.md",
            "# DECISIONS\n\n## D-113 Test decision\n\n"
            "- 状态：`ACCEPTED / R1 AUTHORIZED / ENFORCEMENT NOT IMPLEMENTED`\n",
        )
        self.write("docs/tasks/AGENT-R1.md", "# AGENT-R1\n")
        migration_digest = hashlib.sha256(b"SELECT 1;\n").hexdigest()
        packet = {
            "schema_version": "chenyida-erp-agent-task/v1",
            "task": {
                "id": "AGENT-R1",
                "revision": 1,
                "ledger_state": "DOING",
                "delivery_stage": "IMPLEMENTING",
                "qualifiers": ["READ_ONLY_CONTROLLER"],
                "task_document": "docs/tasks/AGENT-R1.md",
            },
            "baseline": {
                "base_sha": self.base_sha,
                "expected_branch": "main",
                "source_version": "0.1.0-alpha.44",
                "source_migration": {
                    "first_number": 1,
                    "head_number": 1,
                    "head_filename": "0001_test.sql",
                    "head_sha256": migration_digest,
                },
                "uat": {
                    "version": "0.1.0-alpha.42",
                    "migration_head": "0040",
                    "verification_scope": "DOCUMENT_DECLARATION_ONLY_NO_CONNECTION",
                },
            },
            "scope": {
                "allowed_changed_paths": [
                    "docs/agent-control/**",
                    "docs/project/DECISIONS.md",
                    "docs/project/TASKS.md",
                    "docs/tasks/AGENT-R1.md",
                ],
                "known_untracked_paths": ["docs/ERP_CURRENT_STATUS_REPORT.md"],
                "required_documents": [
                    "AGENTS.md",
                    "docs/AI_AGENT_TEAM_DESIGN.md",
                    "docs/project/CHANGELOG.md",
                    "docs/project/DECISIONS.md",
                    "docs/project/MASTER.md",
                    "docs/project/PROJECT_CONTEXT.md",
                    "docs/project/STATUS.md",
                    "docs/project/TASKS.md",
                    "docs/tasks/AGENT-R1.md",
                ],
                "require_single_worktree": True,
            },
            "inspection": {
                "package_json": "chenyida_erp_site/package.json",
                "migration_directory": "chenyida_erp_site/drizzle-postgres",
                "migration_journal": "chenyida_erp_site/drizzle-postgres/meta/_journal.json",
                "migration_snapshot_directory": "chenyida_erp_site/drizzle-postgres/meta",
                "required_decision": "D-113",
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
        }
        self.write_packet(packet)


def finding_codes(report: dict, result: str = "FAIL") -> set[str]:
    return {
        finding["code"]
        for finding in report["findings"]
        if finding["result"] == result
    }


def filesystem_snapshot(root: Path) -> dict[str, tuple]:
    snapshot: dict[str, tuple] = {}
    for path in sorted(root.rglob("*")):
        relative_path = path.relative_to(root).as_posix()
        metadata = path.lstat()
        if stat.S_ISLNK(metadata.st_mode):
            snapshot[relative_path] = (
                "symlink",
                metadata.st_mode,
                metadata.st_mtime_ns,
                os.readlink(path),
            )
        elif stat.S_ISREG(metadata.st_mode):
            snapshot[relative_path] = (
                "file",
                metadata.st_mode,
                metadata.st_mtime_ns,
                hashlib.sha256(path.read_bytes()).hexdigest(),
            )
        elif stat.S_ISDIR(metadata.st_mode):
            snapshot[relative_path] = ("directory", metadata.st_mode, metadata.st_mtime_ns)
    return snapshot


class ReadonlyControllerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = RepositoryFixture()

    def tearDown(self) -> None:
        self.fixture.close()

    def inspect(self) -> dict:
        return CONTROLLER.inspect_repository(self.fixture.root)

    def test_ready_report_for_valid_repository(self) -> None:
        report = self.inspect()

        self.assertEqual(report["status"], "READY")
        self.assertEqual(report["exit_code"], 0)
        self.assertEqual(report["task"]["active_task_id"], "AGENT-R1")
        self.assertEqual(report["source"]["version"], "0.1.0-alpha.44")
        self.assertEqual(report["migration"]["head_number"], 1)
        self.assertEqual(
            report["uat"]["verification_scope"],
            "DOCUMENT_DECLARATION_ONLY_NO_CONNECTION",
        )
        self.assertEqual(finding_codes(report), set())

    def test_idle_is_success_without_auto_start(self) -> None:
        tasks = self.fixture.read("docs/project/TASKS.md").replace(
            "| AGENT-R1 | Read-only controller | DOING | Test |\n",
            "| AGENT-R1 | Read-only controller | DONE | Test |\n",
        )
        self.fixture.write("docs/project/TASKS.md", tasks)

        report = self.inspect()

        self.assertEqual(report["status"], "IDLE")
        self.assertEqual(report["exit_code"], 0)
        self.assertIsNone(report["task"]["active_task_id"])

    def test_multiple_doing_tasks_fail_closed(self) -> None:
        tasks = self.fixture.read("docs/project/TASKS.md")
        tasks += "| AGENT-R2 | Runtime | DOING | Test |\n"
        self.fixture.write("docs/project/TASKS.md", tasks)

        report = self.inspect()

        self.assertEqual(report["status"], "STATE_RECONCILIATION_REQUIRED")
        self.assertIn("MULTIPLE_DOING_TASKS", finding_codes(report))

    def test_missing_core_document_fails_closed(self) -> None:
        (self.fixture.root / "AGENTS.md").unlink()

        report = self.inspect()

        self.assertIn("REQUIRED_PATH_MISSING", finding_codes(report))
        self.assertIn("CORE_DOCUMENTS", finding_codes(report))

    def test_unaccepted_d113_fails_closed(self) -> None:
        decisions = self.fixture.read("docs/project/DECISIONS.md").replace(
            "ACCEPTED / R1 AUTHORIZED / ENFORCEMENT NOT IMPLEMENTED",
            "PROPOSED / DESIGN BASELINE",
        )
        self.fixture.write("docs/project/DECISIONS.md", decisions)

        report = self.inspect()

        self.assertIn("DECISION_D113_ACCEPTED", finding_codes(report))

    def test_unauthorized_worktree_path_fails_closed(self) -> None:
        self.fixture.write("chenyida_erp_site/app/forbidden.ts", "export {};\n")

        report = self.inspect()

        self.assertIn("GIT_WORKTREE_PATH_SCOPE", finding_codes(report))
        self.assertEqual(
            report["git"]["unauthorized_worktree_paths"],
            ["chenyida_erp_site/app/forbidden.ts"],
        )

    def test_unauthorized_committed_path_fails_closed(self) -> None:
        self.fixture.write("chenyida_erp_site/app/forbidden.ts", "export {};\n")
        self.fixture._git("add", "chenyida_erp_site/app/forbidden.ts")
        self.fixture._git("commit", "-m", "test: inject unauthorized path")

        report = self.inspect()

        self.assertIn("GIT_COMMITTED_PATH_SCOPE", finding_codes(report))

    def test_branch_drift_fails_closed(self) -> None:
        self.fixture._git("branch", "-m", "unexpected")

        report = self.inspect()

        self.assertIn("GIT_BRANCH_MATCH", finding_codes(report))

    def test_non_ancestor_baseline_fails_closed(self) -> None:
        empty_tree = self.fixture._git("mktree").stdout.strip()
        unrelated_commit = self.fixture._git(
            "commit-tree",
            empty_tree,
            "-m",
            "unrelated fixture commit",
        ).stdout.strip()
        packet = self.fixture.load_packet()
        packet["baseline"]["base_sha"] = unrelated_commit
        self.fixture.write_packet(packet)

        report = self.inspect()

        self.assertIn("GIT_BASELINE_ANCESTOR", finding_codes(report))

    def test_source_version_drift_fails_closed(self) -> None:
        self.fixture.write("chenyida_erp_site/package.json", '{"version":"9.9.9"}\n')

        report = self.inspect()

        self.assertIn("SOURCE_VERSION_MATCH", finding_codes(report))

    def test_migration_checksum_drift_fails_closed(self) -> None:
        self.fixture.write("chenyida_erp_site/drizzle-postgres/0001_test.sql", "SELECT 2;\n")

        report = self.inspect()

        self.assertIn("MIGRATION_CHECKSUM_MATCH", finding_codes(report))

    def test_migration_sequence_gap_fails_closed(self) -> None:
        original = self.fixture.root / "chenyida_erp_site/drizzle-postgres/0001_test.sql"
        original.rename(original.with_name("0002_test.sql"))

        report = self.inspect()

        self.assertIn("MIGRATION_SEQUENCE", finding_codes(report))
        self.assertIn("MIGRATION_HEAD_MATCH", finding_codes(report))

    def test_migration_journal_drift_fails_closed(self) -> None:
        self.fixture.write(
            "chenyida_erp_site/drizzle-postgres/meta/_journal.json",
            '{"entries":[{"idx":1,"tag":"0001_other"}]}\n',
        )

        report = self.inspect()

        self.assertIn("MIGRATION_JOURNAL_MATCH", finding_codes(report))

    def test_snapshot_symlink_is_rejected(self) -> None:
        snapshot = self.fixture.root / "chenyida_erp_site/drizzle-postgres/meta/0001_snapshot.json"
        snapshot.unlink()
        snapshot.symlink_to(self.fixture.root / "docs/project/MASTER.md")

        report = self.inspect()

        self.assertIn("SYMLINK_PATH_REJECTED", finding_codes(report))

    def test_required_document_symlink_is_rejected(self) -> None:
        task_document = self.fixture.root / "docs/tasks/AGENT-R1.md"
        task_document.unlink()
        task_document.symlink_to(self.fixture.root / "docs/AI_AGENT_TEAM_DESIGN.md")

        report = self.inspect()

        self.assertIn("SYMLINK_PATH_REJECTED", finding_codes(report))

    def test_required_document_hardlink_is_rejected(self) -> None:
        task_document = self.fixture.root / "docs/tasks/AGENT-R1.md"
        task_document.unlink()
        os.link(
            self.fixture.root / "docs/AI_AGENT_TEAM_DESIGN.md",
            task_document,
        )

        report = self.inspect()

        self.assertIn("HARDLINK_PATH_REJECTED", finding_codes(report))

    def test_corrupt_packet_recovers_without_persistent_state(self) -> None:
        packet_path = self.fixture.root / "docs/agent-control/task-packets/AGENT-R1.json"
        original_packet = packet_path.read_bytes()
        packet_path.write_bytes(b'{"schema_version":')
        failed_report = self.inspect()
        packet_path.write_bytes(original_packet)
        recovered_report = self.inspect()

        self.assertIn("TASK_PACKET_INVALID", finding_codes(failed_report))
        self.assertEqual(recovered_report["status"], "READY")

    def test_packet_path_traversal_is_rejected(self) -> None:
        packet = self.fixture.load_packet()
        packet["scope"]["required_documents"].append("../outside")
        self.fixture.write_packet(packet)

        report = self.inspect()

        self.assertIn("TASK_PACKET_INVALID", finding_codes(report))

    def test_packet_cannot_omit_current_task_document(self) -> None:
        packet = self.fixture.load_packet()
        packet["scope"]["required_documents"].remove("docs/tasks/AGENT-R1.md")
        self.fixture.write_packet(packet)

        report = self.inspect()

        self.assertIn("TASK_PACKET_INVALID", finding_codes(report))

    def test_packet_cannot_redirect_inspection_to_owner_input(self) -> None:
        packet = self.fixture.load_packet()
        packet["inspection"]["package_json"] = "docs/ERP_CURRENT_STATUS_REPORT.md"
        self.fixture.write_packet(packet)

        report = self.inspect()

        self.assertIn("TASK_PACKET_INVALID", finding_codes(report))

    def test_uat_document_marker_drift_fails_without_connection(self) -> None:
        self.fixture.write("docs/project/MASTER.md", "# MASTER\nUAT declaration removed\n")

        report = self.inspect()

        self.assertIn("UAT_DECLARATION_MATCH", finding_codes(report))

    def test_git_failure_is_sanitized_and_fails_closed(self) -> None:
        git_directory = self.fixture.root / ".git"
        disabled_directory = self.fixture.root / ".git-disabled"
        git_directory.rename(disabled_directory)
        try:
            report = self.inspect()
        finally:
            disabled_directory.rename(git_directory)

        self.assertIn("GIT_COMMAND_FAILED", finding_codes(report))
        serialized = json.dumps(report, ensure_ascii=False)
        self.assertNotIn("stderr", serialized.lower())

    def test_repeat_inspection_is_deterministic_and_read_only(self) -> None:
        before = filesystem_snapshot(self.fixture.root)

        first_report = self.inspect()
        second_report = self.inspect()

        after = filesystem_snapshot(self.fixture.root)
        self.assertEqual(first_report, second_report)
        self.assertEqual(first_report["report_digest"], second_report["report_digest"])
        self.assertEqual(before, after)

    def test_cli_emits_json_only_and_does_not_mutate_repository(self) -> None:
        before = filesystem_snapshot(self.fixture.root)
        environment = os.environ.copy()
        environment["PYTHONDONTWRITEBYTECODE"] = "1"

        result = subprocess.run(
            [sys.executable, "-B", str(CONTROLLER_PATH), "--repo", str(self.fixture.root)],
            cwd=self.fixture.root,
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
            timeout=15,
        )

        after = filesystem_snapshot(self.fixture.root)
        report = json.loads(result.stdout)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, "")
        self.assertEqual(report["status"], "READY")
        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()
