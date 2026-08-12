import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const migrationDirectory = new URL("../drizzle-postgres/", import.meta.url);
const metadataDirectory = new URL("../drizzle-postgres/meta/", import.meta.url);
const schemaFile = new URL("../db/schema.ts", import.meta.url);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("0042 is the single append-only migration and preserves the 0041 checksum", async () => {
  const names = (await readdir(migrationDirectory))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  assert.equal(names.length, 42);
  assert.equal(names.at(-1), "0042_material_import_fallback_safety.sql");
  await assert.rejects(access(new URL("0043_material_import_fallback_safety.sql", migrationDirectory)));
  const previous = await readFile(new URL("0041_ai_governance_suggestion_evidence.sql", migrationDirectory));
  assert.equal(sha256(previous), "676626b9dcb78f31643612e5662cf5c36e06259c72ff922287bb913394071bf2");
});

test("0042 journal and snapshot form one consistent four-table expansion", async () => {
  const journal = JSON.parse(await readFile(new URL("_journal.json", metadataDirectory), "utf8"));
  assert.equal(journal.entries.length, 42);
  assert.deepEqual(journal.entries.at(-1), {
    idx: 42,
    version: "7",
    when: journal.entries.at(-1).when,
    tag: "0042_material_import_fallback_safety",
    breakpoints: true,
  });
  assert.ok(Number.isSafeInteger(journal.entries.at(-1).when));

  const previous = JSON.parse(await readFile(new URL("0041_snapshot.json", metadataDirectory), "utf8"));
  const current = JSON.parse(await readFile(new URL("0042_snapshot.json", metadataDirectory), "utf8"));
  assert.equal(current.prevId, previous.id);
  assert.equal(Object.keys(current.tables).length, 232);
  const changed = new Set();
  for (const name of new Set([...Object.keys(previous.tables), ...Object.keys(current.tables)])) {
    if (JSON.stringify(previous.tables[name]) !== JSON.stringify(current.tables[name])) changed.add(name);
  }
  assert.deepEqual(changed, new Set([
    "public.material_import_batches",
    "public.material_import_files",
    "public.material_import_idempotency",
    "public.material_import_upload_operations",
  ]));
});

test("0042 records recoverable upload intent and fails closed on dirty legacy facts", async () => {
  const sql = await readFile(new URL("0042_material_import_fallback_safety.sql", migrationDirectory), "utf8");
  const schema = await readFile(schemaFile, "utf8");
  for (const token of [
    'CREATE TABLE "material_import_upload_operations"',
    '"staging_relative_path"=\'material-import/.staging/\'||"material_import_upload_operations"."operation_id"::text||\'.ready\'',
    '"final_relative_path"=\'material-import/\'||"material_import_upload_operations"."batch_id"::text||\'/\'||"material_import_upload_operations"."operation_id"::text||"material_import_upload_operations"."filename_extension"',
    "MATERIAL_IMPORT_0042_RETRY_REFERENCE_INVALID",
    "MATERIAL_IMPORT_0042_BATCH_COUNTS_INVALID",
    "MATERIAL_IMPORT_0042_STORAGE_NAME_DUPLICATE",
    "MATERIAL_IMPORT_0042_IDEMPOTENCY_FILE_BATCH_INVALID",
    "MATERIAL_IMPORT_0042_IDEMPOTENCY_LIFECYCLE_INVALID",
    "material_import_idempotency_file_batch_fk",
    "material_import_files_passed_facts_ck",
  ]) assert.ok(sql.includes(token), `missing migration contract: ${token}`);
  assert.match(sql, /FROM "material_import_batches" AS b[\s\S]+b\."source_kind" IN \('CSV','XLSX'\)/);
  assert.ok(schema.includes('export const materialImportUploadOperations = pgTable("material_import_upload_operations"'));
  assert.ok(schema.includes("material_import_upload_operations_phase_facts_ck"));
  assert.ok(schema.includes("material_import_idempotency_file_batch_fk"));
});
