import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

import { loadRuntimeMigrationManifest, verifyDatabaseMigrationManifest } from "../app/lib/runtime-readiness/migration.ts";
import { PostgresWorkerRuntimeLease, workerRuntimeIdentity } from "../app/lib/runtime-readiness/worker-lease.ts";

const databaseUrl = process.env.TEST_RUNTIME_READINESS_DATABASE_URL;
if (!databaseUrl || !/runtime_readiness_test/i.test(databaseUrl)) {
  throw new Error("isolated TEST_RUNTIME_READINESS_DATABASE_URL containing runtime_readiness_test is required");
}
const migrationDirectory = new URL("../drizzle-postgres/", import.meta.url);
const migrationNames = (await readdir(migrationDirectory)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
const pool = new Pool({ connectionString: databaseUrl, max: 8, application_name: "runtime-readiness-postgres-test" });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function resetSchema() {
  await pool.query("drop schema public cascade; create schema public");
  await pool.query("create table schema_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default now())");
}

async function applyMigration(name) {
  const source = await readFile(new URL(name, migrationDirectory), "utf8");
  const checksum = sha256(source);
  const existing = await pool.query("select checksum from schema_migrations where version=$1", [name]);
  if (existing.rows[0]) {
    assert.equal(existing.rows[0].checksum, checksum);
    return "replayed";
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(source);
    await client.query("insert into schema_migrations(version,checksum) values($1,$2)", [name, checksum]);
    await client.query("commit");
    return "applied";
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function migrateThrough(number) {
  for (const name of migrationNames.filter((candidate) => Number(candidate.slice(0, 4)) <= number)) await applyMigration(name);
}

test.after(async () => pool.end());

test("0045 upgrades empty and 0044 databases exactly once without changing existing data", async () => {
  await resetSchema();
  await migrateThrough(45);
  assert.deepEqual((await pool.query("select count(*)::int count,max(version) head from schema_migrations")).rows[0], {
    count: 45, head: "0045_runtime_worker_readiness.sql",
  });
  assert.equal((await applyMigration("0045_runtime_worker_readiness.sql")), "replayed");
  assert.equal((await pool.query("select count(*)::int count from schema_migrations")).rows[0].count, 45);

  await resetSchema();
  await migrateThrough(44);
  await pool.query("insert into app_meta(key,value) values('task45-sentinel','preserve')");
  await applyMigration("0045_runtime_worker_readiness.sql");
  assert.equal((await pool.query("select value from app_meta where key='task45-sentinel'")).rows[0].value, "preserve");
  assert.equal((await pool.query("select count(*)::int count from worker_runtime_leases")).rows[0].count, 0);
});

test("a late failure rolls back the 0045 table and migration ledger entry", async () => {
  await resetSchema();
  await migrateThrough(44);
  const source = await readFile(new URL("0045_runtime_worker_readiness.sql", migrationDirectory), "utf8");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(source);
    await assert.rejects(client.query("select * from task45_forced_failure"), /task45_forced_failure/);
    await client.query("rollback");
  } finally {
    client.release();
  }
  assert.deepEqual((await pool.query(`
    select to_regclass('public.worker_runtime_leases')::text relation,
      (select count(*)::int from schema_migrations) history
  `)).rows[0], { relation: null, history: 44 });
});

test("0045 constraints reject invalid singleton, identity and lifecycle facts", async () => {
  await resetSchema();
  await migrateThrough(45);
  const valid = [
    "background-jobs", randomUUID(), "test", "task45-test", "0.1.0-alpha.47", "a".repeat(40),
    "0045_runtime_worker_readiness.sql", "b".repeat(64),
  ];
  const statement = `
    insert into worker_runtime_leases(
      service_slot,instance_id,deployment_class,deployment_id,application_version,git_commit,
      migration_head,migration_manifest_sha256,started_at,heartbeat_at,lease_expires_at
    ) values($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '60 seconds')
  `;
  await assert.rejects(pool.query(statement, ["other", ...valid.slice(1)]), /worker_runtime_leases_slot_ck/);
  await assert.rejects(pool.query(statement, [...valid.slice(0, 5), "not-a-commit", ...valid.slice(6)]), /worker_runtime_leases_git_commit_ck/);
  await assert.rejects(pool.query(`
    insert into worker_runtime_leases(
      service_slot,instance_id,deployment_class,deployment_id,application_version,git_commit,
      migration_head,migration_manifest_sha256,started_at,heartbeat_at,lease_expires_at
    ) values($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '6 minutes')
  `, valid), /worker_runtime_leases_time_ck/);
  assert.equal((await pool.query("select count(*)::int count from worker_runtime_leases")).rows[0].count, 0);
});

test("Worker lease uses database time, rejects live peers, CAS-renews and permits expired or stopped takeover", async () => {
  await resetSchema();
  await migrateThrough(46);
  const migrations = await loadRuntimeMigrationManifest({ directory: new URL("../drizzle-postgres/", import.meta.url).pathname, requireImmutable: false });
  const identity = workerRuntimeIdentity({
    deploymentClass: "test", deploymentId: "task45-test", applicationVersion: "0.1.0-alpha.47", gitCommit: "a".repeat(40),
  }, migrations);
  const repository = new PostgresWorkerRuntimeLease(pool, 60);
  const firstId = randomUUID();
  const first = await repository.acquire(firstId, identity);
  assert.equal(first.generation, "1");
  await assert.rejects(repository.acquire(randomUUID(), identity), (error) => error.code === "RUNTIME_LEASE_ACTIVE");
  const renewed = await repository.renew(first, identity);
  assert.equal(renewed.version, first.version + 1);
  await assert.rejects(repository.renew(first, identity), (error) => error.code === "RUNTIME_LEASE_LOST");
  const exact = await repository.assertExactInstance(firstId, identity);
  assert.equal(exact.instanceId, firstId);
  assert.ok(exact.heartbeatAt.getTime() <= exact.databaseNow.getTime());
  assert.ok(exact.leaseExpiresAt.getTime() > exact.databaseNow.getTime());

  await pool.query(`
    update worker_runtime_leases set
      started_at=clock_timestamp()-interval '3 seconds',
      heartbeat_at=clock_timestamp()-interval '2 seconds',
      lease_expires_at=clock_timestamp()-interval '1 second'
    where service_slot='background-jobs'
  `);
  const secondId = randomUUID();
  const second = await repository.acquire(secondId, identity);
  assert.equal(second.generation, "2");
  await assert.rejects(repository.assertExactInstance(firstId, identity), (error) => error.code === "RUNTIME_WORKER_UNAVAILABLE");
  await assert.rejects(repository.assertExactInstance(secondId, { ...identity, gitCommit: "c".repeat(40) }), (error) => error.code === "RUNTIME_WORKER_UNAVAILABLE");
  await repository.stop(second);
  await repository.stop(second);
  assert.equal((await pool.query("select status from worker_runtime_leases")).rows[0].status, "STOPPED");
  const third = await repository.acquire(randomUUID(), identity);
  assert.equal(third.generation, "3");

  await pool.query(`
    update worker_runtime_leases set
      started_at=clock_timestamp()-interval '3 seconds',
      heartbeat_at=clock_timestamp()-interval '2 seconds',
      lease_expires_at=clock_timestamp()-interval '1 second'
  `);
  const contenders = await Promise.allSettled([
    repository.acquire(randomUUID(), identity), repository.acquire(randomUUID(), identity),
  ]);
  assert.equal(contenders.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(contenders.filter((item) => item.status === "rejected" && item.reason?.code === "RUNTIME_LEASE_ACTIVE").length, 1);
});

test("runtime manifest verification rejects a restored or drifted database ledger", async () => {
  await resetSchema();
  await migrateThrough(46);
  const migrations = await loadRuntimeMigrationManifest({ directory: new URL("../drizzle-postgres/", import.meta.url).pathname, requireImmutable: false });
  await verifyDatabaseMigrationManifest(pool, migrations);
  const original = (await pool.query("select checksum from schema_migrations where version='0044_identity_session_absolute_lifetime.sql'")).rows[0].checksum;
  try {
    await pool.query("update schema_migrations set checksum=$1 where version='0044_identity_session_absolute_lifetime.sql'", ["0".repeat(64)]);
    await assert.rejects(verifyDatabaseMigrationManifest(pool, migrations), (error) => error.code === "RUNTIME_MIGRATION_MISMATCH");
  } finally {
    await pool.query("update schema_migrations set checksum=$1 where version='0044_identity_session_absolute_lifetime.sql'", [original]);
  }
  await verifyDatabaseMigrationManifest(pool, migrations);
  await pool.query("insert into schema_migrations(version,checksum) values('9999_extra.sql',$1)", ["f".repeat(64)]);
  await assert.rejects(verifyDatabaseMigrationManifest(pool, migrations), (error) => error.code === "RUNTIME_MIGRATION_MISMATCH");
});
