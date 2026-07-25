import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fail } from "./errors.mjs";
import { TOOL_VERSION } from "./manifest.mjs";

export const REAL_READONLY_MODE = "REAL_READONLY_INVENTORY";
export const REAL_READONLY_CONFIRMATION = "REAL_LOCAL_SQLITE_READONLY_INVENTORY";
export const READONLY_ROOT_MARKER = "chenyida_task04_readonly_";

function inside(parent, candidate, allowSame = false) {
  const rel = relative(resolve(parent), resolve(candidate));
  return (allowSame && rel === "") || (rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function taskRoot(path) {
  if (!path || !isAbsolute(path)) fail("READONLY_PATH_NOT_ABSOLUTE", "真实只读路径必须为绝对路径");
  const resolved = resolve(path);
  if (!inside(tmpdir(), resolved)) fail("READONLY_PATH_FORBIDDEN", "真实只读路径必须位于系统临时目录");
  const first = relative(resolve(tmpdir()), resolved).split(sep)[0];
  if (!first.startsWith(READONLY_ROOT_MARKER)) fail("READONLY_TASK_MARKER_REQUIRED", "真实只读路径缺少 TASK04 标识");
  return resolve(tmpdir(), first);
}

function assertRegular(path, expectedRoot) {
  const resolved = resolve(path);
  if (!inside(expectedRoot, resolved)) fail("READONLY_PATH_FORBIDDEN", "真实只读文件必须位于同一任务临时目录");
  const info = lstatSync(resolved);
  if (info.isSymbolicLink()) fail("READONLY_SYMLINK_FORBIDDEN", "真实只读输入不得为符号链接");
  if (!info.isFile()) fail("READONLY_PATH_TYPE_INVALID", "真实只读输入必须为普通文件");
  if (!inside(expectedRoot, realpathSync(resolved))) fail("READONLY_REALPATH_FORBIDDEN", "真实只读输入解析后越界");
  return resolved;
}

export function assertRealReadonlyEnvironment(environment = process.env) {
  if (String(environment.ERP_ENV || "").trim().toLowerCase() !== "readonly-inventory") {
    fail("READONLY_ENVIRONMENT_FORBIDDEN", "真实只读盘点只允许 ERP_ENV=readonly-inventory");
  }
  for (const [key, value] of Object.entries(environment)) {
    if (!value) continue;
    if (/D1.*BINDING|CLOUDFLARE.*D1/i.test(key)) fail("READONLY_D1_BINDING_FORBIDDEN", "真实只读盘点禁止 D1 binding");
    if (/^(?:DATABASE_URL|POSTGRES_URL|PGHOST|PGHOSTADDR|PGPORT|PGUSER|PGPASSWORD|PGPASSFILE|PGSERVICE|PGSERVICEFILE|PGDATABASE)$/i.test(key)) fail("READONLY_TARGET_ENV_FORBIDDEN", "真实只读盘点禁止 PostgreSQL 目标环境变量");
  }
  return { environment: "readonly-inventory" };
}

export function assertRealReadonlyArguments(args, { environment = process.env, currentGitCommit } = {}) {
  assertRealReadonlyEnvironment(environment);
  if (args.mode !== REAL_READONLY_MODE) fail("READONLY_MODE_REQUIRED", `需要 --mode ${REAL_READONLY_MODE}`);
  if (args.confirm !== REAL_READONLY_CONFIRMATION) fail("READONLY_CONFIRMATION_REQUIRED", `需要 --confirm ${REAL_READONLY_CONFIRMATION}`);
  if (args["source-kind"] !== "sqlite-snapshot") fail("READONLY_SOURCE_KIND_INVALID", "真实只读盘点只接受 sqlite-snapshot");
  if (args["no-materialize"] !== "true") fail("READONLY_NO_MATERIALIZE_REQUIRED", "需要 --no-materialize true");
  if (args["no-files"] !== "true") fail("READONLY_NO_FILES_REQUIRED", "需要 --no-files true");
  if (args["tool-version"] !== TOOL_VERSION) fail("READONLY_TOOL_VERSION_MISMATCH", "tool version 不匹配");
  if (!/^[0-9a-f]{40}$/.test(args["git-commit"] || "") || args["git-commit"] !== currentGitCommit) fail("READONLY_GIT_COMMIT_MISMATCH", "Git commit 不匹配");
  if (!/^[0-9a-f]{64}$/.test(args["source-sha256"] || "")) fail("READONLY_SOURCE_SHA_INVALID", "source SHA-256 无效");
  for (const key of Object.keys(args)) {
    if (/(?:database|postgres|target-url|target-dsn)/i.test(key)) fail("READONLY_TARGET_FORBIDDEN", "真实只读盘点不接受目标数据库参数");
  }

  const sourceRoot = taskRoot(args.source);
  const manifestRoot = taskRoot(args["snapshot-manifest"]);
  const outputRoot = taskRoot(args.workspace);
  if (sourceRoot !== manifestRoot || sourceRoot !== outputRoot) fail("READONLY_TASK_ROOT_MISMATCH", "快照、manifest 和输出必须位于同一任务目录");
  const rootInfo = lstatSync(sourceRoot);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory() || (rootInfo.mode & 0o077) !== 0) fail("READONLY_TASK_ROOT_PERMISSION_INVALID", "任务目录必须为非符号链接的 0700 目录");
  const source = assertRegular(args.source, sourceRoot);
  const manifestPath = assertRegular(args["snapshot-manifest"], sourceRoot);
  if (source.split(sep).at(-1) !== "task04-source.snapshot.sqlite3") fail("READONLY_SNAPSHOT_NAME_INVALID", "快照文件名无效");
  const workspace = resolve(args.workspace);
  if (!inside(sourceRoot, workspace)) fail("READONLY_WORKSPACE_FORBIDDEN", "输出目录必须位于任务目录");
  const workspaceInfo = lstatSync(workspace);
  if (workspaceInfo.isSymbolicLink() || !workspaceInfo.isDirectory() || readdirSync(workspace).length !== 0) fail("READONLY_WORKSPACE_INVALID", "输出目录必须为空且不是符号链接");

  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch { fail("READONLY_MANIFEST_INVALID", "snapshot manifest 无效"); }
  const required = ["schema_version", "mode", "source_path_digest", "snapshot_name", "snapshot_sha256", "snapshot_bytes", "page_count", "page_size", "sqlite_version", "created_at", "integrity_check", "schema_fingerprint", "tool_version", "git_commit", "service_pid"];
  for (const key of required) if (manifest[key] === undefined) fail("READONLY_MANIFEST_INVALID", `snapshot manifest 缺少 ${key}`);
  if (manifest.schema_version !== 1 || manifest.mode !== REAL_READONLY_MODE || manifest.snapshot_name !== "task04-source.snapshot.sqlite3") fail("READONLY_MANIFEST_INVALID", "snapshot manifest 模式无效");
  if (manifest.tool_version !== TOOL_VERSION || manifest.git_commit !== currentGitCommit) fail("READONLY_MANIFEST_BINDING_MISMATCH", "snapshot manifest 未绑定当前工具或 commit");
  if (manifest.integrity_check !== "ok" || !/^[0-9a-f]{64}$/.test(manifest.source_path_digest) || !/^[0-9a-f]{64}$/.test(manifest.schema_fingerprint)) fail("READONLY_MANIFEST_INVALID", "snapshot manifest 完整性字段无效");
  const actualSha = sha256File(source);
  if (actualSha !== args["source-sha256"] || actualSha !== manifest.snapshot_sha256 || statSync(source).size !== manifest.snapshot_bytes) fail("READONLY_SOURCE_SHA_MISMATCH", "快照 SHA-256 或大小不匹配");
  const serialized = JSON.stringify(manifest);
  if (serialized.includes("/opt/erp/chenyida_erp_app/data") || /(?:postgres(?:ql)?:\/\/|password|session|token|authorization|cookie)/i.test(serialized)) fail("READONLY_MANIFEST_SENSITIVE", "snapshot manifest 含禁止路径或敏感字段");
  return { source, manifestPath, workspace, manifest, taskRoot: sourceRoot };
}

export const readonlyGuardInternals = { inside, taskRoot, sha256File };
