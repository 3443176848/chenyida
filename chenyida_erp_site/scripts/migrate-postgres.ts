import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";

import { getPool, closeDb } from "../db/index.ts";
import { runtimeConfig } from "../app/lib/infrastructure/config.ts";
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
  assertTargetIdentity,
  loadIsolatedAuthorization,
  loadReleaseAuthorization,
  readAppliedMigrations,
} from "./release-migration-authorization.ts";

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

type MigrationTransactionClient = Pick<PoolClient, "query">;
type MigrationLifecycleClient = Pick<PoolClient, "query" | "release">;

function reject(code: string): never {
  throw new MigrationGuardError(code);
}

async function migrationFiles(directory: string): Promise<string[]> {
  const allSql = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  if (allSql.length < 1 || allSql.some((name) => !MIGRATION_FILE.test(name))) reject("MIGRATION_DIRECTORY_CONTENT_INVALID");
  return allSql;
}

export async function runMigrationTransaction<T>(
  client: MigrationTransactionClient,
  work: (client: MigrationTransactionClient) => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    const result = await work(client);
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
): Promise<void> {
  if (locked && client) {
    await client.query("select pg_catalog.pg_advisory_unlock(pg_catalog.hashtext('chenyida_erp_schema_migration')::bigint)").catch(() => undefined);
  }
  try { client?.release(); } catch { /* Do not replace the migration result with cleanup detail. */ }
  await close().catch(() => undefined);
}

export async function runMigrations(): Promise<void> {
  const config = runtimeConfig();
  if (config.environment === "production" && process.env.ERP_ALLOW_PRODUCTION_MIGRATION !== "YES") reject("MIGRATION_EXPLICIT_PRODUCTION_PERMISSION_REQUIRED");
  const directory = resolve(process.cwd(), "drizzle-postgres");
  const files = await migrationFiles(directory);
  const releaseAuthorization = await loadReleaseAuthorization(config, directory);
  const authorization: { kind: "RELEASE"; value: ReleaseAuthorization } | { kind: "ISOLATED"; value: IsolatedAuthorization } = releaseAuthorization
    ? { kind: "RELEASE", value: releaseAuthorization }
    : { kind: "ISOLATED", value: loadIsolatedAuthorization(config, process.env.DATABASE_URL || "") };
  if (authorization.kind === "RELEASE" && (files.length !== authorization.value.manifest.migrations.entries.length || files.some((file, index) => file !== authorization.value.manifest.migrations.entries[index].filename))) reject("MIGRATION_DIRECTORY_NOT_EXACT_RELEASE_ALLOWLIST");
  const pool = getPool();
  let client: PoolClient | undefined;
  let locked = false;
  try {
    client = await pool.connect();
    await client.query("select pg_catalog.set_config('search_path','public',false)");
    if (authorization.kind === "RELEASE") await assertReleaseDatabasePreflight(client, authorization.value);
    else await assertIsolatedTargetIdentity(client, authorization.value);
    const lock = await client.query<{ acquired: boolean }>("select pg_catalog.pg_try_advisory_lock(pg_catalog.hashtext('chenyida_erp_schema_migration')::bigint) as acquired");
    if (lock.rows.length !== 1 || lock.rows[0].acquired !== true) reject("MIGRATION_ADVISORY_LOCK_UNAVAILABLE");
    locked = true;
    if (authorization.kind === "RELEASE") await assertReleaseDatabasePreflight(client, authorization.value);
    else await assertIsolatedTargetIdentity(client, authorization.value);
    for (const file of files) {
      const sql = await readFile(resolve(directory, file), "utf8"); const checksum = createHash("sha256").update(sql).digest("hex");
      if (authorization.kind === "RELEASE") {
        const approved = authorization.value.manifest.migrations.entries.find((entry: { filename: string; sha256: string }) => entry.filename === file);
        if (!approved || approved.sha256 !== checksum) reject("MIGRATION_FILE_NOT_APPROVED");
      }
      const applied = await runMigrationTransaction(client, async (transaction) => {
        await transaction.query("select pg_catalog.set_config('search_path','public',true)");
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
      });
      if (applied) console.info(`applied ${file}`);
    }
    if (authorization.kind === "RELEASE") {
      await assertTargetIdentity(client, authorization.value);
      const applied = await readAppliedMigrations(client);
      validateAppliedMigrationRows(applied, authorization.value.manifest.migrations.entries, authorization.value.manifest.migrations.head);
    } else await assertIsolatedTargetIdentity(client, authorization.value);
  } finally {
    await closeMigrationRuntime(client, locked);
  }
}

export function safeMigrationErrorCode(error: unknown): string {
  if (error instanceof MigrationGuardError || error instanceof ReleaseManifestError) return error.code;
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
  return known[candidate] || "MIGRATION_INTERNAL_ERROR";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runMigrations().catch((error) => {
    process.stderr.write(`${safeMigrationErrorCode(error)}\n`);
    process.exitCode = 1;
  });
}
