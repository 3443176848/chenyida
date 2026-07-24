import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getPool, closeDb } from "../db/index.ts";
import { runtimeConfig } from "../app/lib/infrastructure/config.ts";

const config = runtimeConfig();
if (config.environment === "production" && process.env.ERP_ALLOW_PRODUCTION_MIGRATION !== "YES") {
  throw new Error("Production migration requires ERP_ALLOW_PRODUCTION_MIGRATION=YES");
}
const directory = resolve(process.cwd(), "drizzle-postgres"); const files = (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
const pool = getPool(); const client = await pool.connect();
try {
  await client.query("select pg_advisory_lock(hashtext('chenyida_erp_schema_migration'))");
  await client.query(`create table if not exists schema_migrations (version text primary key, checksum text not null, applied_at timestamptz not null default now())`);
  for (const file of files) {
    const sql = await readFile(resolve(directory, file), "utf8"); const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await client.query<{ checksum: string }>("select checksum from schema_migrations where version=$1", [file]);
    if (existing.rows[0]) { if (existing.rows[0].checksum !== checksum) throw new Error(`Applied migration checksum mismatch: ${file}`); continue; }
    await client.query("BEGIN"); try { await client.query(sql); await client.query("insert into schema_migrations (version,checksum) values ($1,$2)", [file, checksum]); await client.query("COMMIT"); console.info(`applied ${file}`); } catch (error) { await client.query("ROLLBACK"); throw error; }
  }
} finally { await client.query("select pg_advisory_unlock(hashtext('chenyida_erp_schema_migration'))").catch(() => undefined); client.release(); await closeDb(); }
