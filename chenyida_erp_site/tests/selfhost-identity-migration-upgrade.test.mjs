import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_IDENTITY_UPGRADE_DATABASE_URL;
if (!databaseUrl || !/identity_upgrade_test/i.test(databaseUrl)) throw new Error("isolated TEST_IDENTITY_UPGRADE_DATABASE_URL containing identity_upgrade_test is required");
const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "identity-migration-upgrade-test" });
const names = [
  "0001_selfhost_baseline.sql",
  "0002_material_master_workflow.sql",
  "0003_material_import_mapping.sql",
  "0004_material_import_normalization.sql",
  "0005_material_import_review.sql",
  "0006_identity_security.sql",
];
const expectedOldChecksums = [
  "c1cd71803b0f504594a41234a82eb13ce8e6713f5d346f3e49247b4921ff1702",
  "2d8d4facf54c950fa19d1346705aa0f549669544da1a87c2fc584c1fe8b7eb80",
  "8ce859551198a8a5a334665f68eee503590fa5472f3a6396f44670d2110dddbf",
  "1bb0eb9b7b3ddbe6c6058a75a04a4bbc69a088e201856f258a4c75728f64aa39",
  "e4f2dc62afb8908c7d5a1a0202639809c9dd3f3be3fc09f0ad469224e46ecdcc",
];
const sources = new Map();
for (const name of names) sources.set(name, await readFile(new URL(`../drizzle-postgres/${name}`, import.meta.url), "utf8"));

function checksum(name) { return createHash("sha256").update(sources.get(name)).digest("hex"); }

async function reset() {
  await pool.query("drop schema public cascade; create schema public");
  await pool.query("create table schema_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default now())");
}

async function migrate(namesToApply) {
  for (const name of namesToApply) {
    const existing = await pool.query("select checksum from schema_migrations where version=$1", [name]);
    if (existing.rows[0]) {
      assert.equal(existing.rows[0].checksum, checksum(name));
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sources.get(name));
      await client.query("insert into schema_migrations(version,checksum) values($1,$2)", [name, checksum(name)]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

test.after(async () => pool.end());

test("0001-0005 checksums remain immutable and 0006 has a stable checksum", () => {
  assert.deepEqual(names.slice(0, 5).map(checksum), expectedOldChecksums);
  assert.match(checksum(names[5]), /^[0-9a-f]{64}$/);
});

test("empty database upgrades 0001 through 0006 and repeated runner is a no-op", async () => {
  await reset();
  await migrate(names);
  await migrate(names);
  const versions = await pool.query("select version,checksum from schema_migrations order by version");
  assert.deepEqual(versions.rows.map((row) => row.version), names);
  assert.equal(versions.rows[5].checksum, checksum(names[5]));
  const tables = await pool.query("select to_regclass('identity_login_failures') login,to_regclass('identity_write_rate_limit_buckets') write");
  assert.equal(tables.rows[0].login, "identity_login_failures"); assert.equal(tables.rows[0].write, "identity_write_rate_limit_buckets");
});

test("recorded 0005 upgrade preserves legacy users and sessions and creates constraints and indexes", async () => {
  await reset();
  await migrate(names.slice(0, 5));
  await pool.query(`insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version) values('legacy_user','旧用户','purchase','test-only',true,false,3)`);
  await pool.query(`insert into app_sessions(token_hash,username,expires_at) values($1,'legacy_user',now()+interval '1 hour')`, ["a".repeat(64)]);
  await pool.query(`insert into audit_log(username,action,request_id,result) values('legacy_user','LEGACY_TEST','11111111-1111-4111-8111-111111111111','success')`);
  await migrate(names.slice(5));
  const preserved = await pool.query("select u.version,s.token_hash,s.revoked_at,s.revoked_reason from app_users u join app_sessions s on s.username=u.username where u.username='legacy_user'");
  assert.equal(preserved.rowCount, 1); assert.equal(preserved.rows[0].version, 3); assert.equal(preserved.rows[0].token_hash, "a".repeat(64)); assert.equal(preserved.rows[0].revoked_at, null);
  const constraints = await pool.query("select conname from pg_constraint where conname in ('app_users_username_format_ck','app_users_display_name_ck','app_users_role_ck','app_sessions_revocation_ck','identity_login_failures_count_ck','identity_write_rate_limit_counts_ck') order by conname");
  assert.equal(constraints.rowCount, 6);
  const indexes = await pool.query("select indexname from pg_indexes where indexname like 'audit_log_identity_%' or indexname in ('app_sessions_active_user_idx','identity_login_failures_pk','identity_write_rate_limit_buckets_pk','idempotency_keys_identity_scope_idx')");
  assert.ok(indexes.rowCount >= 8);
  await assert.rejects(pool.query(`insert into app_users(username,display_name,role,password_hash) values('Bad User','坏用户','purchase','test-only')`), /app_users_username_format_ck/);
  await assert.rejects(pool.query(`insert into identity_login_failures(username_digest,window_start,failure_count) values($1,now(),-1)`, ["b".repeat(64)]), /identity_login_failures_count_ck/);
  await assert.rejects(pool.query(`update app_sessions set revoked_at=now(),revoked_reason='UNSAFE_REASON' where token_hash=$1`, ["a".repeat(64)]), /app_sessions_revocation_ck/);
});

test("0006 failure rolls back every DDL statement and succeeds after invalid legacy data is corrected", async () => {
  await reset();
  await migrate(names.slice(0, 5));
  await pool.query(`insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version) values('legacy_bad','旧用户','legacy_role','test-only',true,false,1)`);
  await pool.query(`insert into app_sessions(token_hash,username,expires_at) values($1,'legacy_bad',now()+interval '1 hour')`, ["c".repeat(64)]);
  await assert.rejects(migrate(names.slice(5)), /app_users_role_ck/);
  const rolledBack = await pool.query("select to_regclass('identity_login_failures') table_name,(select count(*) from information_schema.columns where table_name='app_sessions' and column_name='revoked_at') column_count");
  assert.equal(rolledBack.rows[0].table_name, null); assert.equal(Number(rolledBack.rows[0].column_count), 0);
  assert.equal(Number((await pool.query("select count(*) count from app_sessions where token_hash=$1", ["c".repeat(64)])).rows[0].count), 1);
  assert.equal(Number((await pool.query("select count(*) count from schema_migrations where version=$1", [names[5]])).rows[0].count), 0);
  await pool.query("update app_users set role='purchase' where username='legacy_bad'");
  await migrate(names.slice(5));
  assert.equal(Number((await pool.query("select count(*) count from app_sessions where token_hash=$1", ["c".repeat(64)])).rows[0].count), 1);
});
