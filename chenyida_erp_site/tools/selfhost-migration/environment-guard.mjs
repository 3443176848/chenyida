import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fail } from "./errors.mjs";

const DB_EXTENSIONS = /\.(?:sqlite|sqlite3|db)$/i;
const FORBIDDEN_SEGMENTS = /(^|[\\/])(?:backup|backups|uploads?|attachments?|archives?|归档|附件)([\\/]|$)/i;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function inside(parent, candidate, allowSame = false) {
  const rel = relative(resolve(parent), resolve(candidate));
  return (allowSame && rel === "") || (rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function assertMigrationTempPath(path, { directory = false, mustExist = true } = {}) {
  if (!path || !isAbsolute(path)) fail("MIGRATION_PATH_NOT_ABSOLUTE", "迁移路径必须为绝对路径");
  const resolved = resolve(path);
  if (!inside(tmpdir(), resolved)) fail("MIGRATION_REAL_PATH_FORBIDDEN", "迁移源和工作目录必须位于操作系统临时目录");
  const rootName = relative(resolve(tmpdir()), resolved).split(sep)[0];
  if (!rootName.includes("_migration_test")) fail("MIGRATION_TEST_MARKER_REQUIRED", "临时路径缺少 _migration_test 标识");
  if (FORBIDDEN_SEGMENTS.test(resolved)) fail("MIGRATION_SENSITIVE_DIRECTORY_FORBIDDEN", "禁止使用备份、上传、附件或归档目录");
  if (mustExist) {
    const stat = lstatSync(resolved);
    if (stat.isSymbolicLink()) fail("MIGRATION_SYMLINK_FORBIDDEN", "迁移路径不得为符号链接");
    if (directory !== stat.isDirectory()) fail("MIGRATION_PATH_TYPE_INVALID", directory ? "迁移路径必须为目录" : "迁移源必须为文件");
    const real = realpathSync(resolved);
    if (!inside(tmpdir(), real) || !relative(resolve(tmpdir()), real).split(sep)[0].includes("_migration_test")) {
      fail("MIGRATION_REAL_PATH_FORBIDDEN", "迁移路径解析后不在受控临时目录");
    }
  }
  return resolved;
}

export function assertMigrationEnvironment(source = process.env) {
  const environment = String(source.ERP_ENV || "").trim().toLowerCase();
  if (environment !== "test") fail("MIGRATION_ENVIRONMENT_FORBIDDEN", "迁移工具只允许 ERP_ENV=test");
  for (const key of Object.keys(source)) {
    if (/D1.*BINDING|CLOUDFLARE.*D1/i.test(key) && source[key]) {
      fail("MIGRATION_D1_BINDING_FORBIDDEN", "迁移工具禁止使用 D1 binding");
    }
  }
  return { environment };
}

export function assertSourcePath(path, kind) {
  const resolved = assertMigrationTempPath(path);
  if (kind === "sqlite" && !DB_EXTENSIONS.test(resolved)) fail("MIGRATION_SOURCE_TYPE_INVALID", "SQLite 源扩展名无效");
  if (kind === "d1-export" && !resolved.endsWith(".json")) fail("MIGRATION_SOURCE_TYPE_INVALID", "D1 export 必须为 JSON");
  const siteRoot = resolve(process.cwd());
  const legacyRoot = resolve(siteRoot, "../chenyida_erp_app");
  if (resolved === resolve(legacyRoot, "data/erp.sqlite3") || inside(siteRoot, resolved, true) || inside(legacyRoot, resolved, true)) {
    fail("MIGRATION_REAL_PATH_FORBIDDEN", "禁止读取仓库内现有数据库或业务文件");
  }
  return resolved;
}

export function assertWorkspace(path, { requireEmpty = false } = {}) {
  const resolved = assertMigrationTempPath(path, { directory: true });
  if (requireEmpty && readdirSync(resolved).length !== 0) fail("MIGRATION_WORKSPACE_NOT_EMPTY", "迁移工作目录必须为空");
  return resolved;
}

export function parseSafePostgresUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { fail("MIGRATION_DATABASE_URL_INVALID", "PostgreSQL URL 无效"); }
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) fail("MIGRATION_DATABASE_URL_INVALID", "目标必须为 PostgreSQL");
  if (!LOOPBACK.has(url.hostname)) fail("MIGRATION_REMOTE_DATABASE_FORBIDDEN", "迁移目标只允许回环 PostgreSQL");
  if (url.search) fail("MIGRATION_DATABASE_URL_OPTIONS_FORBIDDEN", "迁移目标 URL 不允许连接参数");
  const dbName = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-z0-9_]+$/i.test(dbName)) fail("MIGRATION_DATABASE_URL_INVALID", "目标数据库名格式无效");
  if (!dbName.includes("_migration_test")) fail("MIGRATION_DATABASE_MARKER_REQUIRED", "目标数据库名缺少 _migration_test 标识");
  if (/prod(?:uction)?/i.test(dbName) || /prod(?:uction)?/i.test(url.hostname)) fail("MIGRATION_PRODUCTION_DATABASE_FORBIDDEN", "生产数据库禁止迁移");
  return { url, databaseName: dbName };
}

export function assertEmptyFileTarget(path) {
  const resolved = assertMigrationTempPath(path, { directory: true });
  if (readdirSync(resolved).length) fail("MIGRATION_FILE_TARGET_NOT_EMPTY", "目标文件目录必须为空");
  return resolved;
}

export const MATERIALIZATION_TARGET_MARKER = ".cyd-synthetic-migration-run.json";

export function assertMaterializationFileTarget(path, runId) {
  const resolved = assertMigrationTempPath(path, { directory: true });
  const entries = readdirSync(resolved);
  if (!entries.length) return resolved;
  if (!runId || !entries.includes(MATERIALIZATION_TARGET_MARKER)) fail("MIGRATION_FILE_TARGET_NOT_EMPTY", "目标文件目录非空且不属于受控 migration run");
  let marker;
  try { marker = JSON.parse(readFileSync(resolve(resolved, MATERIALIZATION_TARGET_MARKER), "utf8")); } catch { fail("MIGRATION_FILE_TARGET_MARKER_INVALID", "目标文件目录的 run marker 无效"); }
  if (marker.schema_version !== 1 || marker.migration_run_id !== runId || marker.synthetic_marker !== "SYNTHETIC_MIGRATION_TEST_ONLY") fail("MIGRATION_FILE_TARGET_RUN_CONFLICT", "目标文件目录属于其他 migration run");
  return resolved;
}

export const guardInternals = { inside, assertMigrationTempPath };
