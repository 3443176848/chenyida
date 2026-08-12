import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_MATERIAL_IMPORT_FALLBACK_DATABASE_URL ?? "";
let databaseName = "";
try { databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, "")); } catch { databaseName = ""; }
if (!/material_import_fallback_test/i.test(databaseName) || /(?:uat|prod|production|chenyida_erp)$/i.test(databaseName)) {
  throw new Error("an isolated material_import_fallback_test database URL is required");
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "material-import-fallback-migration-test" });
const migrationDirectory = new URL("../drizzle-postgres/", import.meta.url);
const migrationNames = (await readdir(migrationDirectory))
  .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
  .sort();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const digest = (character) => character.repeat(64);

async function resetSchema() {
  await pool.query("drop schema public cascade; create schema public; create table public.schema_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default now())");
}

async function applyMigration(name) {
  const source = await readFile(new URL(name, migrationDirectory), "utf8");
  const checksum = sha256(source);
  const existing = await pool.query("select checksum from public.schema_migrations where version=$1", [name]);
  if (existing.rows[0]) {
    assert.equal(existing.rows[0].checksum, checksum);
    return "replayed";
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(source);
    await client.query("insert into public.schema_migrations(version,checksum) values($1,$2)", [name, checksum]);
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

async function seedUser(username = "import_test_owner") {
  await pool.query(`
    insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version)
    values($1,'物料导入测试','manager','synthetic-test-only',true,false,1)
  `, [username]);
}

async function seedBatch(sourceKind, label, retryOfBatchId = null) {
  const result = await pool.query(`
    insert into material_import_batches(batch_no,source_kind,status,retry_of_batch_id,created_by,current_version,file_count,total_rows,accepted_rows,rejected_rows)
    values($1,$2,'CREATED',$3,'import_test_owner',1,0,0,0,0) returning id
  `, [`MIG42-${label}-${randomUUID().slice(0, 8)}`, sourceKind, retryOfBatchId]);
  return Number(result.rows[0].id);
}

async function seedLegacyFile(batchId, filename, storageName, hash = digest("a")) {
  const result = await pool.query(`
    insert into material_import_files(batch_id,storage_name,relative_path,original_filename,mime_type,sha256,size_bytes,storage_status)
    values($1,$2,$3,$4,'application/octet-stream',$5,7,'STORED') returning id
  `, [batchId, storageName, `legacy/${batchId}/${randomUUID()}`, filename, hash]);
  return Number(result.rows[0].id);
}

test("0042 upgrades an empty database exactly once", async () => {
  await resetSchema();
  await migrateThrough(42);
  const history = await pool.query("select version from public.schema_migrations order by version");
  assert.equal(history.rowCount, 42);
  assert.equal(history.rows.at(-1).version, "0042_material_import_fallback_safety.sql");
  assert.equal((await pool.query("select to_regclass('public.material_import_upload_operations')::text value")).rows[0].value, "material_import_upload_operations");
  assert.equal((await applyMigration("0042_material_import_fallback_safety.sql")), "replayed");
  assert.equal((await pool.query("select count(*)::int count from public.schema_migrations")).rows[0].count, 42);
});

test("0041 data upgrades honestly without relabelling project documents as checked imports", async () => {
  await resetSchema();
  await migrateThrough(41);
  await seedUser();
  const csvBatch = await seedBatch("CSV", "CSV");
  const xlsxBatch = await seedBatch("XLSX", "XLSX");
  const projectBatch = await seedBatch("PROJECT_REFERENCE", "PROJECT");
  const csvFile = await seedLegacyFile(csvBatch, "legacy.CSV", randomUUID(), digest("a"));
  const xlsxFile = await seedLegacyFile(xlsxBatch, "legacy.xlsx", randomUUID(), digest("b"));
  const projectFile = await seedLegacyFile(projectBatch, "drawing.pdf", randomUUID(), digest("c"));
  const createdAt = "2026-08-01T00:00:00.000Z";
  await pool.query(`
    insert into material_import_idempotency(
      username,method,route_scope,key_digest,request_digest,operation_id,state,batch_id,
      lease_token,lease_expires_at,expires_at,recovery_until,created_at,updated_at
    ) values
      ('import_test_owner','POST','/pending',$1,$2,$3,'PENDING',$4,$5,$6,null,$7,$8,$8),
      ('import_test_owner','POST','/completed',$9,$10,$11,'COMPLETED',$4,null,null,$12,$7,$8,$8)
  `, [digest("1"), digest("2"), randomUUID(), csvBatch, randomUUID(), "2026-08-01T00:05:00.000Z", "2026-08-08T00:00:00.000Z", createdAt, digest("3"), digest("4"), randomUUID(), "2026-08-02T00:00:00.000Z"]);
  await pool.query("update material_import_idempotency set response='{}'::jsonb,status_code=201 where route_scope='/completed'");

  await applyMigration("0042_material_import_fallback_safety.sql");
  const files = await pool.query(`
    select id,filename_extension,actual_sha256,actual_size_bytes,security_check_status,uploaded_at
    from material_import_files order by id
  `);
  const byId = new Map(files.rows.map((row) => [Number(row.id), row]));
  assert.deepEqual(
    [byId.get(csvFile).filename_extension, byId.get(csvFile).actual_sha256, Number(byId.get(csvFile).actual_size_bytes), byId.get(csvFile).security_check_status, Boolean(byId.get(csvFile).uploaded_at)],
    [".csv", digest("a"), 7, "LEGACY_UNVERIFIED", true],
  );
  assert.deepEqual(
    [byId.get(xlsxFile).filename_extension, byId.get(xlsxFile).actual_sha256, byId.get(xlsxFile).security_check_status],
    [".xlsx", digest("b"), "LEGACY_UNVERIFIED"],
  );
  assert.deepEqual(
    [byId.get(projectFile).filename_extension, byId.get(projectFile).actual_sha256, byId.get(projectFile).security_check_status, byId.get(projectFile).uploaded_at],
    [null, null, "NOT_APPLICABLE", null],
  );

  await assert.rejects(
    pool.query("update material_import_files set security_check_status='BASIC_CHECK_PASSED' where id=$1", [csvFile]),
    /material_import_files_passed_facts_ck/,
  );
  const secondBatch = await seedBatch("CSV", "SECOND");
  await assert.rejects(pool.query(`
    insert into material_import_idempotency(
      username,method,route_scope,key_digest,request_digest,operation_id,state,batch_id,file_id,
      lease_token,lease_expires_at,recovery_until
    ) values('import_test_owner','POST','/wrong-file-batch',$1,$2,$3,'PENDING',$4,$5,$6,now()+interval '5 minutes',now()+interval '7 days')
  `, [digest("5"), digest("6"), randomUUID(), secondBatch, csvFile, randomUUID()]), /material_import_idempotency_file_batch_fk/);

  const operationId = randomUUID();
  await pool.query(`
    insert into material_import_idempotency(
      username,method,route_scope,key_digest,request_digest,operation_id,state,batch_id,
      lease_token,lease_expires_at,recovery_until
    ) values('import_test_owner','POST',$1,$2,$3,$4,'PENDING',$5,$6,now()+interval '5 minutes',now()+interval '7 days')
  `, [`/api/material-master/import-batches/${secondBatch}/file`, digest("7"), digest("8"), operationId, secondBatch, randomUUID()]);
  await assert.rejects(pool.query(`
    insert into material_import_upload_operations(
      operation_id,batch_id,expected_batch_version,declared_filename,filename_extension,declared_mime_type,
      declared_sha256,declared_size_bytes,duplicate_action,staging_relative_path,final_relative_path,request_id
    ) values($1,$2,1,'safe.csv','.csv','text/csv',$3,7,'REJECT','attacker/path',$4,$5)
  `, [operationId, secondBatch, digest("d"), `material-import/${secondBatch}/${operationId}.csv`, randomUUID()]), /material_import_upload_operations_staging_path_ck/);
  await pool.query(`
    insert into material_import_upload_operations(
      operation_id,batch_id,expected_batch_version,declared_filename,filename_extension,declared_mime_type,
      declared_sha256,declared_size_bytes,duplicate_action,staging_relative_path,final_relative_path,request_id
    ) values($1,$2,1,'safe.csv','.csv','text/csv',$3,7,'REJECT',$4,$5,$6)
  `, [operationId, secondBatch, digest("d"), `material-import/.staging/${operationId}.ready`, `material-import/${secondBatch}/${operationId}.csv`, randomUUID()]);
});

test("0042 dirty-data preflight rolls the entire migration back", async () => {
  await resetSchema();
  await migrateThrough(41);
  await seedUser();
  const first = await seedBatch("CSV", "DUP-A");
  const second = await seedBatch("CSV", "DUP-B");
  const duplicateStorageName = randomUUID();
  await seedLegacyFile(first, "one.csv", duplicateStorageName, digest("e"));
  await seedLegacyFile(second, "two.csv", duplicateStorageName, digest("f"));

  await assert.rejects(applyMigration("0042_material_import_fallback_safety.sql"), /MATERIAL_IMPORT_0042_STORAGE_NAME_DUPLICATE/);
  assert.equal((await pool.query("select to_regclass('public.material_import_upload_operations') value")).rows[0].value, null);
  assert.equal((await pool.query("select count(*)::int count from information_schema.columns where table_schema='public' and table_name='material_import_files' and column_name='staging_relative_path'")).rows[0].count, 0);
  const history = await pool.query("select version from public.schema_migrations order by version");
  assert.equal(history.rowCount, 41);
  assert.equal(history.rows.at(-1).version, "0041_ai_governance_suggestion_evidence.sql");
});

test.after(async () => { await pool.end(); });
