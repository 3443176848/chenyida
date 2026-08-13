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

function reject(code: string): never {
  throw new MigrationGuardError(code);
}

async function migrationFiles(directory: string): Promise<string[]> {
  const allSql = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  if (allSql.length < 1 || allSql.some((name) => !MIGRATION_FILE.test(name))) reject("MIGRATION_DIRECTORY_CONTENT_INVALID");
  return allSql;
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
      await client.query("BEGIN");
      try {
        await client.query("select pg_catalog.set_config('search_path','public',true)");
        await client.query("create table if not exists public.schema_migrations (version text primary key, checksum text not null, applied_at timestamptz not null default pg_catalog.now())");
        const existing = await client.query<{ checksum: string }>("select checksum from only public.schema_migrations where version=$1", [file]);
        if (existing.rows[0]) {
          if (existing.rows[0].checksum !== checksum) reject("MIGRATION_APPLIED_CHECKSUM_MISMATCH");
          await client.query("COMMIT");
          continue;
        }
        await client.query(sql);
        await client.query("insert into public.schema_migrations (version,checksum) values ($1,$2)", [file, checksum]);
        const recorded = await client.query<{ checksum: string }>("select checksum from only public.schema_migrations where version=$1", [file]);
        if (recorded.rows.length !== 1 || recorded.rows[0].checksum !== checksum) reject("MIGRATION_HISTORY_WRITE_NOT_DURABLE");
        await client.query("COMMIT");
        console.info(`applied ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    if (authorization.kind === "RELEASE") {
      await assertTargetIdentity(client, authorization.value);
      const applied = await readAppliedMigrations(client);
      validateAppliedMigrationRows(applied, authorization.value.manifest.migrations.entries, authorization.value.manifest.migrations.head);
    } else await assertIsolatedTargetIdentity(client, authorization.value);
  } finally {
    if (locked && client) await client.query("select pg_catalog.pg_advisory_unlock(pg_catalog.hashtext('chenyida_erp_schema_migration')::bigint)").catch(() => undefined);
    client?.release();
    await closeDb();
  }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof MigrationGuardError || error instanceof ReleaseManifestError) return error.code;
  const candidate = error && typeof error === "object" && "code" in error ? String(error.code || "") : "";
  return /^[0-9A-Z_]{1,64}$/.test(candidate) ? `MIGRATION_DATABASE_${candidate}` : "MIGRATION_INTERNAL_ERROR";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runMigrations().catch((error) => {
    process.stderr.write(`${safeErrorCode(error)}\n`);
    process.exitCode = 1;
  });
}
