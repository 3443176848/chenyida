#!/usr/bin/python3
"""Render the canonical release-supervisor bundle manifest from one Git commit."""

from __future__ import annotations

import ast
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable


BUNDLE_CONTRACT = "chenyida-erp-release-supervisor-bundle/v1"
LAUNCHER_REPOSITORY_PATH = "chenyida_erp_site/scripts/release-supervisor-launcher.py"
SAFE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
GIT_OBJECT = re.compile(r"^[0-9a-f]{40}$")
SAFE_RELATIVE = re.compile(r"^[A-Za-z0-9._/-]{1,240}$")
MAX_BUNDLE_FILE_BYTES = 8 * 1024 * 1024
MAX_BUNDLE_BYTES = 32 * 1024 * 1024
MAX_BUNDLE_FILES = 145


class BundleManifestError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def reject(code: str) -> None:
    raise BundleManifestError(code)


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def parse_bundle_files(launcher_raw: bytes) -> dict[str, str]:
    try:
        tree = ast.parse(launcher_raw.decode("utf-8"), filename=LAUNCHER_REPOSITORY_PATH)
    except (UnicodeDecodeError, SyntaxError):
        reject("SUPERVISOR_BUNDLE_LAUNCHER_INVALID")
    matches: list[ast.AST] = []
    for node in tree.body:
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == "BUNDLE_FILES":
            matches.append(node.value)
        elif isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "BUNDLE_FILES" for target in node.targets):
            matches.append(node.value)
    if len(matches) != 1:
        reject("SUPERVISOR_BUNDLE_FILE_MAP_INVALID")
    try:
        value = ast.literal_eval(matches[0])
    except (ValueError, TypeError, SyntaxError, MemoryError, RecursionError):
        reject("SUPERVISOR_BUNDLE_FILE_MAP_INVALID")
    if not isinstance(value, dict) or not 1 <= len(value) <= MAX_BUNDLE_FILES:
        reject("SUPERVISOR_BUNDLE_FILE_MAP_INVALID")
    result: dict[str, str] = {}
    for relative, mode in value.items():
        if not isinstance(relative, str) or not SAFE_RELATIVE.fullmatch(relative) or relative.startswith("/") or any(part in ("", ".", "..") for part in relative.split("/")) or mode not in ("0444", "0555") or relative in result:
            reject("SUPERVISOR_BUNDLE_FILE_MAP_INVALID")
        result[relative] = mode
    if LAUNCHER_REPOSITORY_PATH not in result:
        reject("SUPERVISOR_BUNDLE_FILE_MAP_INVALID")
    return result


def build_manifest(source_commit: str, source_tree: str, launcher_raw: bytes, blob: Callable[[str], bytes]) -> dict[str, Any]:
    if not GIT_OBJECT.fullmatch(source_commit) or not GIT_OBJECT.fullmatch(source_tree):
        reject("SUPERVISOR_BUNDLE_SOURCE_INVALID")
    files = []
    total_bytes = 0
    for relative, mode in sorted(parse_bundle_files(launcher_raw).items()):
        raw = blob(relative)
        if not isinstance(raw, bytes) or len(raw) < 1 or len(raw) > MAX_BUNDLE_FILE_BYTES:
            reject("SUPERVISOR_BUNDLE_SOURCE_FILE_INVALID")
        total_bytes += len(raw)
        if total_bytes > MAX_BUNDLE_BYTES:
            reject("SUPERVISOR_BUNDLE_TOTAL_BYTES_INVALID")
        files.append({"path": relative, "sha256": sha256(raw), "bytes": len(raw), "mode": mode})
    return {
        "schema_version": 1,
        "contract": BUNDLE_CONTRACT,
        "bundle_version": 1,
        "source_commit": source_commit,
        "source_tree": source_tree,
        "launcher_sha256": sha256(launcher_raw),
        "files": files,
    }


def git(repository: Path, *arguments: str, binary: bool = False) -> bytes | str:
    environment = {"PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_NO_REPLACE_OBJECTS": "1"}
    command = ["/usr/bin/git", "-c", "core.useReplaceRefs=false", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", f"safe.directory={repository}", "-C", str(repository), *arguments]
    result = subprocess.run(command, env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False)
    if result.returncode != 0:
        reject("SUPERVISOR_BUNDLE_GIT_READ_FAILED")
    return result.stdout if binary else result.stdout.decode("utf-8").strip()


def render(repository: Path, source_commit: str) -> bytes:
    if not repository.is_absolute() or repository == Path("/") or repository.resolve() != repository or git(repository, "rev-parse", "--show-toplevel") != str(repository):
        reject("SUPERVISOR_BUNDLE_REPOSITORY_INVALID")
    if not GIT_OBJECT.fullmatch(source_commit) or git(repository, "rev-parse", "--verify", f"{source_commit}^{{commit}}") != source_commit:
        reject("SUPERVISOR_BUNDLE_SOURCE_INVALID")
    source_tree = git(repository, "rev-parse", "--verify", f"{source_commit}^{{tree}}")
    if not isinstance(source_tree, str) or not GIT_OBJECT.fullmatch(source_tree):
        reject("SUPERVISOR_BUNDLE_SOURCE_INVALID")
    launcher_raw = git(repository, "show", f"{source_commit}:{LAUNCHER_REPOSITORY_PATH}", binary=True)

    def blob(relative: str) -> bytes:
        size_raw = git(repository, "cat-file", "-s", f"{source_commit}:{relative}")
        try:
            size = int(str(size_raw))
        except ValueError:
            reject("SUPERVISOR_BUNDLE_SOURCE_FILE_INVALID")
        if size < 1 or size > MAX_BUNDLE_FILE_BYTES:
            reject("SUPERVISOR_BUNDLE_SOURCE_FILE_INVALID")
        value = git(repository, "show", f"{source_commit}:{relative}", binary=True)
        if not isinstance(value, bytes) or len(value) != size:
            reject("SUPERVISOR_BUNDLE_SOURCE_FILE_INVALID")
        return value

    return canonical_json(build_manifest(source_commit, source_tree, launcher_raw, blob))


def parse_cli(arguments: list[str]) -> tuple[Path, str]:
    if len(arguments) != 6 or arguments[0] != "--repository-root" or arguments[2] != "--source-commit" or arguments[4] != "--confirm" or arguments[5] != "CREATE_CANONICAL_SUPERVISOR_BUNDLE_MANIFEST":
        reject("SUPERVISOR_BUNDLE_CLI_ARGUMENT_INVALID")
    return Path(arguments[1]), arguments[3]


def main() -> None:
    repository, source_commit = parse_cli(sys.argv[1:])
    os.write(sys.stdout.fileno(), render(repository, source_commit))


if __name__ == "__main__":
    try:
        main()
    except BundleManifestError as error:
        print(error.code, file=sys.stderr)
        raise SystemExit(1) from None
    except Exception:
        print("SUPERVISOR_BUNDLE_INTERNAL_ERROR", file=sys.stderr)
        raise SystemExit(1) from None
