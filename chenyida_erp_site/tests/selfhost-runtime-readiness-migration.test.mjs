import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import { migrationAllowlistSha256 } from "../app/lib/runtime-readiness/migration.ts";

const migrationDirectory = new URL("../drizzle-postgres/", import.meta.url);
const metadataDirectory = new URL("../drizzle-postgres/meta/", import.meta.url);
const schemaFile = new URL("../db/schema.ts", import.meta.url);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("0045 remains immutable after append-only 0046 and freezes 0001 through 0044", async () => {
  const names = (await readdir(migrationDirectory)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  assert.equal(names.length, 46);
  assert.equal(names.at(-1), "0046_runtime_lock_privilege_boundary.sql");
  const prefix = await Promise.all(names.slice(0, 44).map(async (filename, index) => ({
    ordinal: index + 1,
    filename,
    sha256: sha256(await readFile(new URL(filename, migrationDirectory))),
  })));
  assert.equal(migrationAllowlistSha256(prefix), "16d9b3169e58dc010b6061d3f1299b9f1a3582ae2430cf119d931204efdd34d8");
  assert.equal(sha256(await readFile(new URL("0045_runtime_worker_readiness.sql", migrationDirectory))), "cc4685a08d97d49717e3c65c069131be17e9fc1cddd52b429ef64202c40180fc");
});

test("0045 journal and snapshot add only the Worker runtime lease table", async () => {
  const journal = JSON.parse(await readFile(new URL("_journal.json", metadataDirectory), "utf8"));
  assert.equal(journal.entries.length, 46);
  const entry = journal.entries.find((item) => item.idx === 45);
  assert.deepEqual(entry, {
    idx: 45,
    version: "7",
    when: entry.when,
    tag: "0045_runtime_worker_readiness",
    breakpoints: true,
  });
  assert.ok(Number.isSafeInteger(entry.when));

  const previous = JSON.parse(await readFile(new URL("0044_snapshot.json", metadataDirectory), "utf8"));
  const current = JSON.parse(await readFile(new URL("0045_snapshot.json", metadataDirectory), "utf8"));
  assert.equal(current.prevId, previous.id);
  assert.equal(Object.keys(current.tables).length, 233);
  const changed = new Set();
  for (const name of new Set([...Object.keys(previous.tables), ...Object.keys(current.tables)])) {
    if (JSON.stringify(previous.tables[name]) !== JSON.stringify(current.tables[name])) changed.add(name);
  }
  assert.deepEqual(changed, new Set(["public.worker_runtime_leases"]));
});

test("0045 and schema bind the singleton lease identity, CAS and database-time lifecycle", async () => {
  const migration = await readFile(new URL("0045_runtime_worker_readiness.sql", migrationDirectory), "utf8");
  const schema = await readFile(schemaFile, "utf8");
  for (const token of [
    '"service_slot" text PRIMARY KEY NOT NULL',
    '"instance_id" uuid NOT NULL',
    '"generation" bigint DEFAULT 1 NOT NULL',
    '"version" integer DEFAULT 1 NOT NULL',
    "worker_runtime_leases_slot_ck",
    "worker_runtime_leases_generation_version_ck",
    "worker_runtime_leases_status_ck",
    "worker_runtime_leases_migration_identity_ck",
    "worker_runtime_leases_time_ck",
    "interval '5 minutes'",
  ]) assert.ok(migration.includes(token), `missing 0045 contract: ${token}`);
  assert.doesNotMatch(migration, /\b(?:insert|update|delete)\b/i, "0045 must not backfill or mutate business data");
  for (const token of [
    'export const workerRuntimeLeases = pgTable("worker_runtime_leases"',
    "worker_runtime_leases_slot_ck",
    "worker_runtime_leases_generation_version_ck",
    "worker_runtime_leases_time_ck",
  ]) assert.ok(schema.includes(token), `missing schema contract: ${token}`);
});
