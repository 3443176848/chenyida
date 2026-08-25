import { createHash, randomBytes } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";

import { getPool, closeDb } from "../db/index.ts";
import { runtimeConfig, type RuntimeConfig } from "../app/lib/infrastructure/config.ts";
import {
  assertControlledRuntimeServiceKind,
  assertControlledSecretsAbsent,
} from "../app/lib/infrastructure/runtime-secret.ts";
import {
  ReleaseManifestError,
  validateAppliedMigrationRows,
} from "./release-manifest-contract.mjs";
import {
  MigrationGuardError,
  type IsolatedAuthorization,
  type ReleaseAuthorization,
  assertIsolatedTargetIdentity,
  assertReleaseDatabasePreflight,
  assertReleaseMigrationFence,
  assertTargetIdentity,
  loadIsolatedAuthorization,
  loadReleaseAuthorization,
  readAppliedMigrations,
} from "./release-migration-authorization.ts";
import { CONTROLLED_MIGRATION_SEARCH_PATH } from "./postgresql-session-profile.ts";
import {
  ISOLATED_UAT_MIGRATION_GRANT_CONTRACT,
  IsolatedUatMigrationExecutionError,
  createIsolatedUatMigrationEngineResult,
} from "./isolated-uat-migration-execution-contract.mjs";
import {
  canonicalMigrationExecutionJson,
  createUatPromotionMigrationEngineResult,
  migrationExecutionSha256,
  UatPromotionMigrationExecutionError,
} from "./uat-promotion-migration-execution-contract.mjs";

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;
const UTF8 = new TextDecoder("utf-8", { fatal: true });

type MigrationTransactionClient = Pick<PoolClient, "query">;
type MigrationLifecycleClient = Pick<PoolClient, "query" | "release">;
type MigrationPool = Readonly<{ connect(): Promise<PoolClient> }>;
type MigrationSourceFile = Readonly<{ filename: string; sha256: string; sql: string; bytes: number }>;
type ControlledReleaseAuthorization = ReleaseAuthorization & { grant: NonNullable<ReleaseAuthorization["grant"]> };
export type ControlledMigrationEngineResult = ReturnType<typeof createUatPromotionMigrationEngineResult>
  | ReturnType<typeof createIsolatedUatMigrationEngineResult>;

export type MigrationWorkflowInput = Readonly<{
  config: Pick<RuntimeConfig, "environment" | "deploymentClass">;
  poolFactory: () => MigrationPool;
  close: () => Promise<void>;
  isolatedDatabaseUrl: string;
}>;

function reject(code: string): never {
  throw new MigrationGuardError(code);
}

export function assertControlledMigrationExecutionAdapterReady(
  releaseAuthorization: ReleaseAuthorization | null,
): asserts releaseAuthorization is ControlledReleaseAuthorization | null {
  if (releaseAuthorization && !releaseAuthorization.grant) reject("MIGRATION_SUPERVISOR_EXECUTION_GRANT_REQUIRED");
}

function sameSourceIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.nlink === right.nlink
    && left.uid === right.uid && left.gid === right.gid && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

const MAX_MIGRATION_SOURCE_BUNDLE_BYTES = 32 * 1024 * 1024;
const MIGRATION_GRANT_COMMIT_MARGIN_MS = 10_000;

export function assertMigrationSqlTransactionBoundary(sql: string): void {
  const statements: string[] = [];
  let current = "";
  let index = 0;
  let blockDepth = 0;
  let dollarTag: string | null = null;
  let state: "NORMAL" | "SINGLE" | "DOUBLE" | "LINE" | "BLOCK" | "DOLLAR" = "NORMAL";
  while (index < sql.length) {
    const character = sql[index];
    const next = sql[index + 1] || "";
    if (state === "NORMAL") {
      if (character === "-" && next === "-") { state = "LINE"; current += "  "; index += 2; continue; }
      if (character === "/" && next === "*") { state = "BLOCK"; blockDepth = 1; current += "  "; index += 2; continue; }
      if (character === "'") { state = "SINGLE"; current += " "; index += 1; continue; }
      if (character === "\"") { state = "DOUBLE"; current += " "; index += 1; continue; }
      if (character === "$") {
        const match = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
        if (match) { dollarTag = match[0]; state = "DOLLAR"; current += " ".repeat(dollarTag.length); index += dollarTag.length; continue; }
      }
      if (character === ";") { statements.push(current); current = ""; index += 1; continue; }
      current += character; index += 1; continue;
    }
    if (state === "SINGLE") {
      if (character === "'" && next === "'") { current += "  "; index += 2; continue; }
      if (character === "'") state = "NORMAL";
      current += " "; index += 1; continue;
    }
    if (state === "DOUBLE") {
      if (character === "\"" && next === "\"") { current += "  "; index += 2; continue; }
      if (character === "\"") state = "NORMAL";
      current += " "; index += 1; continue;
    }
    if (state === "LINE") {
      if (character === "\n" || character === "\r") { state = "NORMAL"; current += character; }
      else current += " ";
      index += 1; continue;
    }
    if (state === "BLOCK") {
      if (character === "/" && next === "*") { blockDepth += 1; current += "  "; index += 2; continue; }
      if (character === "*" && next === "/") {
        blockDepth -= 1; current += "  "; index += 2;
        if (blockDepth === 0) state = "NORMAL";
        continue;
      }
      current += " "; index += 1; continue;
    }
    if (dollarTag && sql.startsWith(dollarTag, index)) {
      current += " ".repeat(dollarTag.length); index += dollarTag.length; dollarTag = null; state = "NORMAL"; continue;
    }
    current += " "; index += 1;
  }
  if (state !== "NORMAL" && state !== "LINE") reject("MIGRATION_SOURCE_SQL_LEXICAL_INVALID");
  statements.push(current);
  for (const statement of statements) {
    const words = statement.match(/[A-Za-z_]+/g)?.map((word) => word.toUpperCase()) || [];
    if (words.length === 0) continue;
    const forbidden = new Set(["BEGIN", "COMMIT", "END", "ROLLBACK", "ABORT", "SAVEPOINT", "RELEASE"]);
    if (forbidden.has(words[0])
      || words[0] === "START" && words[1] === "TRANSACTION"
      || words[0] === "PREPARE" && words[1] === "TRANSACTION"
      || words[0] === "SET" && (words[1] === "TRANSACTION"
        || words.slice(1, 5).join(" ") === "SESSION CHARACTERISTICS AS TRANSACTION")) {
      reject("MIGRATION_SOURCE_TRANSACTION_CONTROL_FORBIDDEN");
    }
  }
}

export function assertMigrationGrantDeadline(
  grant: Readonly<{ expires_at: string }>,
  nowMs = Date.now(),
  marginMs = MIGRATION_GRANT_COMMIT_MARGIN_MS,
): number {
  const remaining = Date.parse(grant.expires_at) - nowMs - marginMs;
  if (!Number.isSafeInteger(remaining) || remaining <= 0) reject("MIGRATION_EXECUTION_GRANT_EXPIRED");
  return remaining;
}

const migrationGrantBudget = assertMigrationGrantDeadline;

export function createControlledMigrationEngineResult(
  grant: ControlledReleaseAuthorization["grant"],
  input: Parameters<typeof createUatPromotionMigrationEngineResult>[0],
): ControlledMigrationEngineResult {
  return grant.contract === ISOLATED_UAT_MIGRATION_GRANT_CONTRACT
    ? createIsolatedUatMigrationEngineResult(input)
    : createUatPromotionMigrationEngineResult(input);
}

async function configureMigrationDeadline(client: MigrationTransactionClient,
                                          grant: ControlledReleaseAuthorization["grant"], local: boolean): Promise<void> {
  const budget = migrationGrantBudget(grant);
  const lockBudget = Math.min(5_000, budget);
  const idleBudget = Math.min(30_000, budget);
  const result = await client.query<{ statement_timeout: string; lock_timeout: string; transaction_timeout: string; idle_timeout: string }>(
    `select pg_catalog.set_config('statement_timeout',$1,$5)::text as statement_timeout,
            pg_catalog.set_config('lock_timeout',$2,$5)::text as lock_timeout,
            pg_catalog.set_config('transaction_timeout',$3,$5)::text as transaction_timeout,
            pg_catalog.set_config('idle_in_transaction_session_timeout',$4,$5)::text as idle_timeout`,
    [`${budget}ms`, `${lockBudget}ms`, `${budget}ms`, `${idleBudget}ms`, local],
  );
  if (result.rows.length !== 1) reject("MIGRATION_DEADLINE_CONFIGURATION_FAILED");
}

async function stableMigrationSource(file: string, filename: string): Promise<MigrationSourceFile> {
  let handle;
  try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { reject("MIGRATION_SOURCE_FILE_UNSAFE"); }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.isSymbolicLink() || before.uid !== 0 || before.gid !== 0 || before.nlink !== 1
      || (before.mode & 0o022) !== 0 || before.size < 1 || before.size > 4 * 1024 * 1024) reject("MIGRATION_SOURCE_FILE_UNSAFE");
    const raw = await handle.readFile();
    const after = await handle.stat();
    if (!sameSourceIdentity(before, after)) reject("MIGRATION_SOURCE_FILE_CHANGED");
    let sql;
    try { sql = UTF8.decode(raw); }
    catch { reject("MIGRATION_SOURCE_FILE_ENCODING_INVALID"); }
    assertMigrationSqlTransactionBoundary(sql);
    return Object.freeze({ filename, sha256: createHash("sha256").update(raw).digest("hex"), sql, bytes: raw.length });
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export async function loadStableMigrationSourceBundle(directory: string): Promise<ReadonlyArray<MigrationSourceFile>> {
  const resolved = resolve(directory);
  const before = await lstat(resolved).catch(() => reject("MIGRATION_DIRECTORY_CONTENT_INVALID"));
  if (!before.isDirectory() || before.isSymbolicLink() || before.uid !== 0 || before.gid !== 0 || (before.mode & 0o022) !== 0
    || await realpath(resolved).catch(() => "") !== resolved) reject("MIGRATION_DIRECTORY_CONTENT_INVALID");
  const names = await readdir(resolved);
  if (names.some((name) => name !== "meta" && !MIGRATION_FILE.test(name))) reject("MIGRATION_DIRECTORY_CONTENT_INVALID");
  if (names.includes("meta")) {
    const metadata = await lstat(resolve(resolved, "meta")).catch(() => reject("MIGRATION_DIRECTORY_CONTENT_INVALID"));
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0
      || (metadata.mode & 0o022) !== 0) reject("MIGRATION_DIRECTORY_CONTENT_INVALID");
  }
  const migrationNames = names.filter((name) => MIGRATION_FILE.test(name)).sort();
  if (migrationNames.length < 1 || migrationNames.length > 10_000) reject("MIGRATION_DIRECTORY_CONTENT_INVALID");
  const files = [];
  let totalBytes = 0;
  for (const filename of migrationNames) {
    const file = await stableMigrationSource(resolve(resolved, filename), filename);
    totalBytes += file.bytes;
    if (totalBytes > MAX_MIGRATION_SOURCE_BUNDLE_BYTES) reject("MIGRATION_SOURCE_BUNDLE_TOO_LARGE");
    files.push(file);
  }
  const after = await lstat(resolved).catch(() => reject("MIGRATION_DIRECTORY_CONTENT_INVALID"));
  if (!sameSourceIdentity(before, after)) reject("MIGRATION_SOURCE_DIRECTORY_CHANGED");
  return Object.freeze(files);
}

export async function runMigrationTransaction<T>(
  client: MigrationTransactionClient,
  work: (client: MigrationTransactionClient) => Promise<T>,
  beforeCommit?: (client: MigrationTransactionClient) => Promise<void>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    const savepoint = `cyd_migration_boundary_${randomBytes(16).toString("hex")}`;
    await client.query(`SAVEPOINT "${savepoint}"`);
    const result = await work(client);
    await client.query(`RELEASE SAVEPOINT "${savepoint}"`);
    await beforeCommit?.(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export async function closeMigrationRuntime(
  client: MigrationLifecycleClient | undefined,
  locked: boolean,
  close: () => Promise<void> = closeDb,
  strict = false,
): Promise<void> {
  let cleanupFailed = false;
  if (locked && client) {
    const unlocked = await client.query<{ unlocked: boolean }>(
      "select pg_catalog.pg_advisory_unlock(pg_catalog.hashtext('chenyida_erp_schema_migration')::bigint) as unlocked",
    ).catch(() => null);
    if (!unlocked || unlocked.rows.length !== 1 || unlocked.rows[0].unlocked !== true) cleanupFailed = true;
  }
  try { client?.release(); } catch { cleanupFailed = true; }
  await close().catch(() => { cleanupFailed = true; });
  if (strict && cleanupFailed) reject("MIGRATION_RUNTIME_CLOSE_FAILED");
}

export async function runMigrationWorkflow(input: MigrationWorkflowInput): Promise<ControlledMigrationEngineResult | null> {
  const { config } = input;
  assertControlledSecretsAbsent(config.deploymentClass);
  assertControlledRuntimeServiceKind(config.deploymentClass, "MIGRATION");
  const directory = resolve(process.cwd(), "drizzle-postgres");
  const sourceBundle = await loadStableMigrationSourceBundle(directory);
  const files = sourceBundle.map((entry) => entry.filename);
  const releaseAuthorization = await loadReleaseAuthorization(config, directory, {
    migrationEntries: sourceBundle.map(({ filename, sha256 }) => ({ filename, sha256 })),
  });
  assertControlledMigrationExecutionAdapterReady(releaseAuthorization);
  if (releaseAuthorization) migrationGrantBudget(releaseAuthorization.grant);
  const authorization: { kind: "RELEASE"; value: ControlledReleaseAuthorization } | { kind: "ISOLATED"; value: IsolatedAuthorization } = releaseAuthorization
    ? { kind: "RELEASE", value: releaseAuthorization }
    : { kind: "ISOLATED", value: loadIsolatedAuthorization(config, input.isolatedDatabaseUrl) };
  if (authorization.kind === "RELEASE" && (files.length !== authorization.value.manifest.migrations.entries.length || files.some((file, index) => file !== authorization.value.manifest.migrations.entries[index].filename))) reject("MIGRATION_DIRECTORY_NOT_EXACT_RELEASE_ALLOWLIST");
  const pool = input.poolFactory();
  let client: PoolClient | undefined;
  let locked = false;
  let primaryFailure: unknown;
  let result: ControlledMigrationEngineResult | null = null;
  try {
    client = await pool.connect();
    if (authorization.kind === "RELEASE") {
      migrationGrantBudget(authorization.value.grant);
      await configureMigrationDeadline(client, authorization.value.grant, false);
    }
    const configured = await client.query<{ search_path: string }>(
      "select pg_catalog.set_config('search_path',$1,false)::text as search_path",
      [CONTROLLED_MIGRATION_SEARCH_PATH],
    );
    if (configured.rows.length !== 1 || configured.rows[0].search_path !== CONTROLLED_MIGRATION_SEARCH_PATH) reject("MIGRATION_SEARCH_PATH_INVALID");
    if (authorization.kind === "RELEASE") {
      await assertReleaseDatabasePreflight(client, authorization.value, "MIGRATION_FENCED");
      await assertReleaseMigrationFence(client, authorization.value);
    }
    else await assertIsolatedTargetIdentity(client, authorization.value);
    const lock = await client.query<{ acquired: boolean }>("select pg_catalog.pg_try_advisory_lock(pg_catalog.hashtext('chenyida_erp_schema_migration')::bigint) as acquired");
    if (lock.rows.length !== 1 || lock.rows[0].acquired !== true) reject("MIGRATION_ADVISORY_LOCK_UNAVAILABLE");
    locked = true;
    if (authorization.kind === "RELEASE") {
      await assertReleaseDatabasePreflight(client, authorization.value, "MIGRATION_FENCED");
      await assertReleaseMigrationFence(client, authorization.value);
      const configured = await client.query<{ default_transaction_read_only: string }>(
        "select pg_catalog.set_config('default_transaction_read_only','off',false)::text as default_transaction_read_only",
      );
      const writable = await client.query<{ transaction_read_only: string }>(
        "select pg_catalog.current_setting('transaction_read_only')::text as transaction_read_only",
      );
      if (configured.rows.length !== 1 || configured.rows[0].default_transaction_read_only !== "off"
        || writable.rows.length !== 1 || writable.rows[0].transaction_read_only !== "off") {
        reject("MIGRATION_SESSION_READ_ONLY_OVERRIDE_FAILED");
      }
      await assertReleaseMigrationFence(client, authorization.value);
    }
    else await assertIsolatedTargetIdentity(client, authorization.value);
    const startedAt = new Date().toISOString();
    const fileResults: Array<{ filename: string; sha256: string; outcome: "ALREADY_APPLIED" | "APPLIED" }> = [];
    const currentIndex = authorization.kind === "RELEASE"
      ? authorization.value.expectedCurrentHead === "EMPTY" ? -1
        : authorization.value.manifest.migrations.entries.findIndex(
          (entry: { filename: string }) => entry.filename === authorization.value.expectedCurrentHead,
        )
      : -1;
    if (authorization.kind === "RELEASE" && authorization.value.expectedCurrentHead !== "EMPTY" && currentIndex < 0) {
      reject("MIGRATION_EXPECTED_CURRENT_HEAD_NOT_APPROVED");
    }
    for (const [sourceIndex, source] of sourceBundle.entries()) {
      const file = source.filename; const sql = source.sql; const checksum = source.sha256;
      if (authorization.kind === "RELEASE") {
        migrationGrantBudget(authorization.value.grant);
        const approved = authorization.value.manifest.migrations.entries.find((entry: { filename: string; sha256: string }) => entry.filename === file);
        if (!approved || approved.sha256 !== checksum) reject("MIGRATION_FILE_NOT_APPROVED");
        await assertReleaseMigrationFence(client, authorization.value);
      }
      const applied = await runMigrationTransaction(client, async (transaction) => {
        if (authorization.kind === "RELEASE") {
          migrationGrantBudget(authorization.value.grant);
          await configureMigrationDeadline(transaction, authorization.value.grant, true);
        }
        const localPath = await transaction.query<{ search_path: string }>(
          "select pg_catalog.set_config('search_path',$1,true)::text as search_path",
          [CONTROLLED_MIGRATION_SEARCH_PATH],
        );
        if (localPath.rows.length !== 1 || localPath.rows[0].search_path !== CONTROLLED_MIGRATION_SEARCH_PATH) reject("MIGRATION_SEARCH_PATH_INVALID");
        await transaction.query("create table if not exists public.schema_migrations (version text primary key, checksum text not null, applied_at timestamptz not null default pg_catalog.now())");
        const existing = await transaction.query<{ checksum: string }>("select checksum from only public.schema_migrations where version=$1", [file]);
        if (existing.rows[0]) {
          if (existing.rows[0].checksum !== checksum) reject("MIGRATION_APPLIED_CHECKSUM_MISMATCH");
          return false;
        }
        await transaction.query(sql);
        await transaction.query("insert into public.schema_migrations (version,checksum) values ($1,$2)", [file, checksum]);
        const recorded = await transaction.query<{ checksum: string }>("select checksum from only public.schema_migrations where version=$1", [file]);
        if (recorded.rows.length !== 1 || recorded.rows[0].checksum !== checksum) reject("MIGRATION_HISTORY_WRITE_NOT_DURABLE");
        return true;
      }, authorization.kind === "RELEASE" ? async (transaction) => {
        migrationGrantBudget(authorization.value.grant);
        await assertReleaseMigrationFence(transaction, authorization.value);
        migrationGrantBudget(authorization.value.grant);
      } : undefined);
      if (authorization.kind === "RELEASE") {
        migrationGrantBudget(authorization.value.grant);
        const expectedApplied = sourceIndex > currentIndex;
        if (applied !== expectedApplied) reject("MIGRATION_FILE_OUTCOME_MISMATCH");
        await assertReleaseMigrationFence(client, authorization.value);
        const committedRows = await readAppliedMigrations(client);
        const expectedLedgerHead = expectedApplied ? file : authorization.value.expectedCurrentHead;
        validateAppliedMigrationRows(committedRows, authorization.value.manifest.migrations.entries, expectedLedgerHead);
        fileResults.push({ filename: file, sha256: checksum, outcome: applied ? "APPLIED" : "ALREADY_APPLIED" });
      } else if (applied) console.info(`applied ${file}`);
    }
    if (authorization.kind === "RELEASE") {
      migrationGrantBudget(authorization.value.grant);
      await assertTargetIdentity(client, authorization.value, "MIGRATION_FENCED");
      const fenceAfter = await assertReleaseMigrationFence(client, authorization.value);
      const applied = await readAppliedMigrations(client);
      validateAppliedMigrationRows(applied, authorization.value.manifest.migrations.entries, authorization.value.manifest.migrations.head);
      migrationGrantBudget(authorization.value.grant);
      const completedAt = new Date().toISOString();
      result = createControlledMigrationEngineResult(authorization.value.grant, {
        promotion_id: authorization.value.grant.promotion_id,
        migration_operation_id: authorization.value.grant.migration_operation_id,
        execution_authorization_sha256: authorization.value.grant.execution_authorization_sha256,
        grant_sha256: authorization.value.grant.grant_sha256,
        database_name: authorization.value.target.databaseName,
        database_system_identifier: authorization.value.target.systemIdentifier,
        database_oid: authorization.value.target.databaseOid,
        database_marker: authorization.value.target.marker,
        migration_role: authorization.value.target.migrationRole,
        application_name: "chenyida-erp-migration",
        current_head_before: authorization.value.expectedCurrentHead,
        target_head: authorization.value.manifest.migrations.head,
        started_at: startedAt,
        completed_at: completedAt,
        files: fileResults,
        final_migration_rows_sha256: migrationExecutionSha256(applied),
        final_migration_rows_count: applied.length,
        other_backend_count_before: 0,
        other_backend_count_after: fenceAfter.other_backend_count,
        database_default_transaction_read_only: fenceAfter.database_default_transaction_read_only,
        migration_transaction_read_only: "off",
      });
    } else await assertIsolatedTargetIdentity(client, authorization.value);
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    await closeMigrationRuntime(client, locked, input.close, authorization.kind === "RELEASE" && primaryFailure === undefined);
  }
  return result;
}

export async function runMigrations(): Promise<ControlledMigrationEngineResult | null> {
  const config = runtimeConfig();
  return runMigrationWorkflow({
    config,
    poolFactory: getPool,
    close: closeDb,
    isolatedDatabaseUrl: process.env.DATABASE_URL || "",
  });
}

export function safeMigrationErrorCode(error: unknown): string {
  if (error instanceof MigrationGuardError || error instanceof ReleaseManifestError
    || error instanceof UatPromotionMigrationExecutionError
    || error instanceof IsolatedUatMigrationExecutionError) return error.code;
  const candidate = error && typeof error === "object" && "code" in error ? String(error.code || "") : "";
  const known: Readonly<Record<string, string>> = Object.freeze({
    "08000": "MIGRATION_DATABASE_CONNECTION_ERROR",
    "08001": "MIGRATION_DATABASE_CONNECTION_ERROR",
    "08003": "MIGRATION_DATABASE_CONNECTION_ERROR",
    "08004": "MIGRATION_DATABASE_CONNECTION_REJECTED",
    "08006": "MIGRATION_DATABASE_CONNECTION_ERROR",
    "08007": "MIGRATION_DATABASE_CONNECTION_ERROR",
    "08P01": "MIGRATION_DATABASE_PROTOCOL_ERROR",
    "53300": "MIGRATION_DATABASE_CONNECTION_LIMIT_REACHED",
    "57P01": "MIGRATION_DATABASE_SERVER_SHUTDOWN",
    "57P02": "MIGRATION_DATABASE_SERVER_SHUTDOWN",
    "57P03": "MIGRATION_DATABASE_SERVER_UNAVAILABLE",
    "57P04": "MIGRATION_DATABASE_SERVER_UNAVAILABLE",
  });
  if (known[candidate]) return known[candidate];
  return /^[0-9A-Z]{5}$/.test(candidate) ? `MIGRATION_DATABASE_${candidate}` : "MIGRATION_INTERNAL_ERROR";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runMigrations()
    .then((result) => { if (result) process.stdout.write(canonicalMigrationExecutionJson(result)); })
    .catch((error) => {
      process.stderr.write(`${safeMigrationErrorCode(error)}\n`);
      process.exitCode = 1;
    });
}
