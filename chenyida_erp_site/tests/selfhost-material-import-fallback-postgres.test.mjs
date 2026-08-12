import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";

import { PostgresBackgroundJobQueue } from "../app/lib/infrastructure/background-jobs.ts";
import { systemClock, uuidGenerator } from "../app/lib/infrastructure/primitives.ts";
import { LocalMaterialImportFileStore } from "../app/lib/material-import-fallback/local-file-store.ts";
import { PostgresMaterialImportFallbackRepository } from "../app/lib/material-import-fallback/repository.ts";
import { MaterialImportFallbackService } from "../app/lib/material-import-fallback/service.ts";
import { MaterialImportFallbackError } from "../app/lib/material-import-fallback/types.ts";
import { SelfHostedWorker } from "../app/lib/selfhost-worker.ts";

const databaseUrl = process.env.TEST_MATERIAL_IMPORT_FALLBACK_DATABASE_URL ?? "";
let databaseName = "";
try { databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, "")); } catch { databaseName = ""; }
if (!/material_import_fallback_test/i.test(databaseName) || /(?:uat|prod|production|chenyida_erp)$/i.test(databaseName)) {
  throw new Error("an isolated material_import_fallback_test database URL is required");
}

const pool = new Pool({ connectionString: databaseUrl, max: 4, application_name: "material-import-fallback-migration-test" });
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

const actor = (username = "import_test_owner", permissions = ["material.import.read", "material.import.create", "material.import.parse", "material.import.cancel"]) => ({
  username,
  permissions,
  must_change_password: false,
});

function contentPart(filename, mime, content) {
  const value = Buffer.from(content);
  return {
    filename,
    declaredMimeType: mime,
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue(value);
        controller.close();
      },
    }),
    completion: Promise.resolve({
      actualSizeBytes: value.byteLength,
      actualSha256: sha256(value),
      prefix: Uint8Array.from(value.subarray(0, 8192)),
    }),
  };
}

async function fallbackFixture(run, Store = LocalMaterialImportFileStore) {
  const root = await mkdtemp(join(tmpdir(), "cyd-import-fallback-service-"));
  const queue = new PostgresBackgroundJobQueue(pool, systemClock, uuidGenerator, 60);
  const store = new Store(root);
  const service = new MaterialImportFallbackService(
    new PostgresMaterialImportFallbackRepository(pool),
    store,
    queue,
    { maximumBytes: 10 * 1024 * 1024, leaseSeconds: 60 },
  );
  try { await run({ root, store, service, queue }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

async function queueReadyCsv(service, label = "TERMINAL") {
  const created = await service.createBatch({
    actor: actor(), requestId: randomUUID(), idempotencyKey: `create-${label}-${randomUUID()}`,
    sourceKind: "CSV", retryOfBatchId: null,
  });
  const content = Buffer.from(`supplier_code,name\n${label}-1,Worker\n`);
  const headers = {
    expectedVersion: 1,
    declaredFilename: `${label.toLowerCase()}.csv`,
    filenameExtension: ".csv",
    declaredMimeType: "text/csv",
    declaredSha256: sha256(content),
    declaredSizeBytes: content.byteLength,
    duplicateAction: "REJECT",
  };
  const prepared = await service.prepareUpload({
    actor: actor(), requestId: randomUUID(), idempotencyKey: `upload-${label}-${randomUUID()}`,
    batchId: Number(created.data.id), headers,
  });
  assert.equal(prepared.kind, "PREPARED");
  await service.executeUpload({
    preparation: prepared, actor: actor(), requestId: randomUUID(),
    part: contentPart(headers.declaredFilename, headers.declaredMimeType, content),
  });
  const queued = await service.queueParse({
    actor: actor(), requestId: randomUUID(), idempotencyKey: `parse-${label}-${randomUUID()}`,
    batchId: Number(created.data.id), expectedVersion: 3, parserVersion: "material-import-parser-v1",
  });
  return {
    batchId: Number(created.data.id),
    jobId: String(queued.data.job_id),
    finalRelativePath: prepared.finalRelativePath,
  };
}

const unusedWorkerStorage = {
  async open() { return null; },
  async write() { throw new Error("UNUSED_STORAGE_WRITE"); },
  async delete() {},
};

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

test("0043 upgrades an empty database exactly once", async () => {
  await resetSchema();
  await migrateThrough(43);
  const history = await pool.query("select version from public.schema_migrations order by version");
  assert.equal(history.rowCount, 43);
  assert.equal(history.rows.at(-1).version, "0043_material_import_terminal_integrity.sql");
  assert.equal((await pool.query("select to_regclass('public.material_import_upload_operations')::text value")).rows[0].value, "material_import_upload_operations");
  assert.equal((await applyMigration("0043_material_import_terminal_integrity.sql")), "replayed");
  assert.equal((await pool.query("select count(*)::int count from public.schema_migrations")).rows[0].count, 43);
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
  await applyMigration("0043_material_import_terminal_integrity.sql");
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

test("0043 upgrades valid 0042 facts and enforces lifecycle, response and same-batch relations", async () => {
  await resetSchema();
  await migrateThrough(42);
  await seedUser();
  const batchId = await seedBatch("CSV", "MIG43-VALID");
  const operationId = randomUUID();
  await pool.query(`
    insert into material_import_idempotency(
      username,method,route_scope,key_digest,request_digest,operation_id,state,batch_id,response,status_code,
      expires_at,recovery_until
    ) values('import_test_owner','POST',$1,$2,$3,$4,'COMPLETED',$5,'{}'::jsonb,201,
      now()+interval '1 day',now()+interval '7 days')
  `, [`/api/material-master/import-batches/${batchId}/file`, digest("a"), digest("b"), operationId, batchId]);
  await pool.query(`
    insert into material_import_upload_operations(
      operation_id,batch_id,expected_batch_version,declared_filename,filename_extension,declared_mime_type,
      declared_sha256,declared_size_bytes,duplicate_action,staging_relative_path,final_relative_path,request_id
    ) values($1,$2,1,'valid.csv','.csv','text/csv',$3,7,'REJECT',$4,$5,$6)
  `, [operationId, batchId, digest("c"), `material-import/.staging/${operationId}.ready`,
    `material-import/${batchId}/${operationId}.csv`, randomUUID()]);
  const mediumResponse = { ok: true, data: { random: randomBytes(40 * 1024).toString("hex") } };
  await assert.rejects(
    pool.query("update material_import_idempotency set response=$2 where operation_id=$1", [operationId, mediumResponse]),
    /material_import_idempotency_response_ck/,
  );

  await applyMigration("0043_material_import_terminal_integrity.sql");
  await pool.query("update material_import_idempotency set response=$2 where operation_id=$1", [operationId, mediumResponse]);
  const otherBatch = await seedBatch("CSV", "MIG43-OTHER");
  await assert.rejects(
    pool.query(`
      update material_import_upload_operations set batch_id=$2,final_relative_path=$3
      where operation_id=$1
    `, [operationId, otherBatch, `material-import/${otherBatch}/${operationId}.csv`]),
    /material_import_upload_operations_operation_batch_fk/,
  );
  await assert.rejects(
    pool.query("update material_import_batches set status='BROKEN' where id=$1", [batchId]),
    /material_import_batches_status_ck/,
  );
  await assert.rejects(
    pool.query("update material_import_batches set status='FAILED' where id=$1", [batchId]),
    /material_import_batches_failure_ck/,
  );
  await assert.rejects(
    pool.query("update material_import_batches set source_kind='PDF' where id=$1", [batchId]),
    /material_import_batches_source_kind_ck/,
  );
  const oversizedResponse = { ok: true, data: { random: randomBytes(540 * 1024).toString("hex") } };
  await assert.rejects(
    pool.query("update material_import_idempotency set response=$2 where operation_id=$1", [operationId, oversizedResponse]),
    /material_import_idempotency_response_ck/,
  );
});

test("0043 operation-scope preflight is stable and rolls the whole correction back", async () => {
  await resetSchema();
  await migrateThrough(42);
  await seedUser();
  const idempotencyBatch = await seedBatch("CSV", "MIG43-IDEM");
  const operationBatch = await seedBatch("CSV", "MIG43-OP");
  const operationId = randomUUID();
  await pool.query(`
    insert into material_import_idempotency(
      username,method,route_scope,key_digest,request_digest,operation_id,state,batch_id,
      lease_token,lease_expires_at,recovery_until
    ) values('import_test_owner','POST',$1,$2,$3,$4,'PENDING',$5,$6,now()+interval '5 minutes',now()+interval '7 days')
  `, [`/api/material-master/import-batches/${operationBatch}/file`, digest("d"), digest("e"), operationId, idempotencyBatch, randomUUID()]);
  await pool.query(`
    insert into material_import_upload_operations(
      operation_id,batch_id,expected_batch_version,declared_filename,filename_extension,declared_mime_type,
      declared_sha256,declared_size_bytes,duplicate_action,staging_relative_path,final_relative_path,request_id
    ) values($1,$2,1,'mismatch.csv','.csv','text/csv',$3,7,'REJECT',$4,$5,$6)
  `, [operationId, operationBatch, digest("f"), `material-import/.staging/${operationId}.ready`,
    `material-import/${operationBatch}/${operationId}.csv`, randomUUID()]);

  await assert.rejects(
    applyMigration("0043_material_import_terminal_integrity.sql"),
    /MATERIAL_IMPORT_0043_OPERATION_SCOPE_INVALID/,
  );
  assert.equal((await pool.query("select to_regclass('public.material_import_idempotency_operation_batch_uq') value")).rows[0].value, null);
  const history = await pool.query("select version from public.schema_migrations order by version");
  assert.equal(history.rowCount, 42);
  assert.equal(history.rows.at(-1).version, "0042_material_import_fallback_safety.sql");
});

test("batch creation is durable, concurrent-idempotent and rolls invalid retries back", async () => {
  await resetSchema();
  await migrateThrough(43);
  await seedUser();
  await fallbackFixture(async ({ service }) => {
    const key = `batch-${randomUUID()}`;
    const input = {
      actor: actor(),
      idempotencyKey: key,
      sourceKind: "CSV",
      retryOfBatchId: null,
    };
    const [left, right] = await Promise.all([
      service.createBatch({ ...input, requestId: randomUUID() }),
      service.createBatch({ ...input, requestId: randomUUID() }),
    ]);
    assert.equal(left.data.id, right.data.id);
    assert.deepEqual(new Set([left.replayed, right.replayed]), new Set([false, true]));
    assert.equal((await pool.query("select count(*)::int count from material_import_batches")).rows[0].count, 1);
    assert.equal((await pool.query("select count(*)::int count from material_import_idempotency")).rows[0].count, 1);
    await assert.rejects(
      service.createBatch({ ...input, requestId: randomUUID(), sourceKind: "XLSX" }),
      (error) => error instanceof MaterialImportFallbackError && error.code === "IDEMPOTENCY_CONFLICT",
    );
    const failedKey = `failed-${randomUUID()}`;
    await assert.rejects(
      service.createBatch({ ...input, requestId: randomUUID(), idempotencyKey: failedKey, retryOfBatchId: 999_999 }),
      (error) => error instanceof MaterialImportFallbackError && error.code === "IMPORT_BATCH_NOT_FOUND",
    );
    assert.equal((await pool.query("select count(*)::int count from material_import_idempotency where key_digest=$1", [sha256(failedKey)])).rows[0].count, 0);

    await pool.query("delete from identity_write_rate_limit_buckets where username=$1", [actor().username]);
    const sharedKey = `shared-route-key-${randomUUID()}`;
    const routeBatch = await service.createBatch({
      actor: actor(), requestId: randomUUID(), idempotencyKey: sharedKey,
      sourceKind: "CSV", retryOfBatchId: null,
    });
    const routeContent = Buffer.from("supplier_code,name\nRATE-1,Scoped\n");
    const routeHeaders = {
      expectedVersion: 1, declaredFilename: "rate.csv", filenameExtension: ".csv", declaredMimeType: "text/csv",
      declaredSha256: sha256(routeContent), declaredSizeBytes: routeContent.byteLength, duplicateAction: "REJECT",
    };
    await service.prepareUpload({
      actor: actor(), requestId: randomUUID(), idempotencyKey: sharedKey,
      batchId: Number(routeBatch.data.id), headers: routeHeaders,
    });
    await assert.rejects(
      service.prepareUpload({
        actor: actor(), requestId: randomUUID(), idempotencyKey: sharedKey,
        batchId: Number(routeBatch.data.id), headers: routeHeaders,
      }),
      (error) => error instanceof MaterialImportFallbackError && error.code === "IDEMPOTENCY_IN_PROGRESS",
    );
    const rate = await pool.query(`
      select attempt_count,new_key_count,rejected_count from identity_write_rate_limit_buckets
      where username=$1 and bucket_start=date_trunc('minute',now())
    `, [actor().username]);
    assert.deepEqual([
      Number(rate.rows[0].attempt_count),
      Number(rate.rows[0].new_key_count),
      Number(rate.rows[0].rejected_count),
    ], [3, 2, 0]);
  });
});

test("upload validates owner and CAS before storage, publishes verified facts and isolates jobs", async () => {
  await resetSchema();
  await migrateThrough(43);
  await seedUser();
  await seedUser("import_test_other");
  await fallbackFixture(async ({ root, service, queue }) => {
    const created = await service.createBatch({
      actor: actor(), requestId: randomUUID(), idempotencyKey: `create-${randomUUID()}`,
      sourceKind: "CSV", retryOfBatchId: null,
    });
    const batchId = Number(created.data.id);
    const content = Buffer.from("supplier_code,name\nA-1,Resistor\n");
    const headers = {
      expectedVersion: 1,
      declaredFilename: "supplier.csv",
      filenameExtension: ".csv",
      declaredMimeType: "text/csv",
      declaredSha256: sha256(content),
      declaredSizeBytes: content.byteLength,
      duplicateAction: "REJECT",
    };
    await assert.rejects(
      service.prepareUpload({
        actor: actor("import_test_other"), requestId: randomUUID(), idempotencyKey: `other-${randomUUID()}`,
        batchId, headers,
      }),
      (error) => error instanceof MaterialImportFallbackError && error.code === "IMPORT_BATCH_NOT_FOUND",
    );
    await assert.rejects(
      service.prepareUpload({
        actor: actor(), requestId: randomUUID(), idempotencyKey: `stale-${randomUUID()}`,
        batchId, headers: { ...headers, expectedVersion: 99 },
      }),
      (error) => error instanceof MaterialImportFallbackError && error.code === "IMPORT_VERSION_CONFLICT",
    );
    assert.deepEqual(await readdir(root), []);

    const uploadKey = `upload-${randomUUID()}`;
    const prepared = await service.prepareUpload({
      actor: actor(), requestId: randomUUID(), idempotencyKey: uploadKey, batchId, headers,
    });
    assert.equal(prepared.kind, "PREPARED");
    const uploaded = await service.executeUpload({
      preparation: prepared, actor: actor(), requestId: randomUUID(),
      part: contentPart("supplier.csv", "text/csv", content),
    });
    assert.equal(uploaded.statusCode, 201);
    assert.equal(uploaded.data.batch.status, "FILE_READY");
    assert.equal(uploaded.data.batch.current_version, 3);
    assert.equal(uploaded.data.file.actual_sha256, headers.declaredSha256);
    assert.equal(uploaded.data.file.actual_size_bytes, content.byteLength);
    assert.equal(uploaded.data.file.detected_file_type, "CSV");
    assert.equal(uploaded.data.file.storage_status, "STORED");
    assert.equal(uploaded.data.file.security_check_status, "BASIC_CHECK_PASSED");
    const operation = await pool.query("select phase,staged_at,checked_at,promoted_at,completed_at from material_import_upload_operations where operation_id=$1", [prepared.operationId]);
    assert.deepEqual([
      operation.rows[0].phase,
      Boolean(operation.rows[0].staged_at),
      Boolean(operation.rows[0].checked_at),
      Boolean(operation.rows[0].promoted_at),
      Boolean(operation.rows[0].completed_at),
    ], ["PUBLISHED", true, true, true, true]);
    const replayed = await service.prepareUpload({
      actor: actor(), requestId: randomUUID(), idempotencyKey: uploadKey, batchId, headers,
    });
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.data.batch.status, "FILE_READY");

    const queued = await service.queueParse({
      actor: actor(), requestId: randomUUID(), idempotencyKey: `parse-${randomUUID()}`,
      batchId, expectedVersion: 3, parserVersion: "material-import-parser-v1",
    });
    assert.equal(queued.statusCode, 202);
    const jobId = String(queued.data.job_id);
    const ownerJob = await service.job(jobId, actor());
    assert.equal(ownerJob.status, "QUEUED");
    assert.equal("payload" in ownerJob, false);
    assert.equal("result" in ownerJob, false);
    await assert.rejects(
      service.job(jobId, actor("import_test_other")),
      (error) => error instanceof MaterialImportFallbackError && error.code === "JOB_NOT_FOUND" && error.status === 404,
    );
    assert.equal((await service.job(jobId, actor("import_test_other", ["material.import.read", "material.import.read_any"]))).id, jobId);
    await queue.dispatchOutbox();
    const cancelKey = `cancel-${randomUUID()}`;
    const cancelRequestId = randomUUID();
    const cancelled = await service.cancelBatch({
      actor: actor(), requestId: cancelRequestId, idempotencyKey: cancelKey,
      batchId, expectedVersion: Number(queued.data.current_version), reasonCode: "USER_CANCELLED",
    });
    assert.equal(cancelled.data.status, "CANCELLED");
    assert.equal(cancelled.data.current_version, Number(queued.data.current_version) + 1);
    const replayedCancel = await service.cancelBatch({
      actor: actor(), requestId: randomUUID(), idempotencyKey: cancelKey,
      batchId, expectedVersion: Number(queued.data.current_version), reasonCode: "USER_CANCELLED",
    });
    assert.equal(replayedCancel.replayed, true);
    assert.equal(replayedCancel.data.status, "CANCELLED");
    assert.equal((await service.job(jobId, actor())).status, "CANCELLED");
    const cancellationFacts = await pool.query(`
      select o.status outbox_status,j.status job_status,b.status batch_status,
        (select count(*)::int from material_import_events where batch_id=b.id and event_type='IMPORT_BATCH_CANCELLED') event_count,
        (select count(*)::int from audit_log where request_id=$2 and action='IMPORT_BATCH_CANCELLED') audit_count
      from material_import_job_outbox o left join background_jobs j on j.id=o.id
      join material_import_batches b on b.id=o.aggregate_id::bigint where o.id=$1
    `, [jobId, cancelRequestId]);
    assert.deepEqual([
      cancellationFacts.rows[0].outbox_status,
      cancellationFacts.rows[0].job_status,
      cancellationFacts.rows[0].batch_status,
      Number(cancellationFacts.rows[0].event_count),
      Number(cancellationFacts.rows[0].audit_count),
    ], ["CANCELLED", "CANCELLED", "CANCELLED", 1, 1]);
  });
});

test("expired pending upload cancellation records cleanup evidence and rejects an active lease", async () => {
  await resetSchema();
  await migrateThrough(43);
  await seedUser();
  await fallbackFixture(async ({ store, service }) => {
    const created = await service.createBatch({
      actor: actor(), requestId: randomUUID(), idempotencyKey: `create-${randomUUID()}`,
      sourceKind: "CSV", retryOfBatchId: null,
    });
    const content = Buffer.from("supplier_code,name\nCANCEL-1,Pending\n");
    const headers = {
      expectedVersion: 1,
      declaredFilename: "cancel.csv",
      filenameExtension: ".csv",
      declaredMimeType: "text/csv",
      declaredSha256: sha256(content),
      declaredSizeBytes: content.byteLength,
      duplicateAction: "REJECT",
    };
    const prepared = await service.prepareUpload({
      actor: actor(), requestId: randomUUID(), idempotencyKey: `upload-${randomUUID()}`,
      batchId: Number(created.data.id), headers,
    });
    assert.equal(prepared.kind, "PREPARED");
    await assert.rejects(
      service.cancelBatch({
        actor: actor(), requestId: randomUUID(), idempotencyKey: `cancel-active-${randomUUID()}`,
        batchId: Number(created.data.id), expectedVersion: 2, reasonCode: "USER_CANCELLED",
      }),
      (error) => error instanceof MaterialImportFallbackError && error.code === "IDEMPOTENCY_IN_PROGRESS",
    );
    await pool.query(`
      update material_import_idempotency
      set created_at=now()-interval '10 minutes',lease_expires_at=now()-interval '1 second'
      where operation_id=$1
    `, [prepared.operationId]);
    await store.stage({
      relativePath: prepared.stagingRelativePath,
      leaseToken: prepared.leaseToken,
      body: contentPart("cancel.csv", "text/csv", content).stream,
    });
    const cancelled = await service.cancelBatch({
      actor: actor(), requestId: randomUUID(), idempotencyKey: `cancel-expired-${randomUUID()}`,
      batchId: Number(created.data.id), expectedVersion: 2, reasonCode: "USER_CANCELLED",
    });
    assert.equal(cancelled.data.status, "CANCELLED");
    assert.equal(await store.inspectOptional(prepared.stagingRelativePath), null);
    assert.equal(await store.inspectOptional(prepared.finalRelativePath), null);
    const state = await pool.query(`
      select b.status,b.current_version,o.phase,o.failure_code,i.state,i.status_code,f.storage_status,f.security_check_status
      from material_import_batches b
      join material_import_upload_operations o on o.batch_id=b.id
      join material_import_idempotency i on i.operation_id=o.operation_id
      join material_import_files f on f.batch_id=b.id where b.id=$1
    `, [created.data.id]);
    assert.deepEqual([
      state.rows[0].status,
      Number(state.rows[0].current_version),
      state.rows[0].phase,
      state.rows[0].failure_code,
      state.rows[0].state,
      Number(state.rows[0].status_code),
      state.rows[0].storage_status,
      state.rows[0].security_check_status,
    ], ["CANCELLED", 3, "FAILED", "IMPORT_UPLOAD_CANCELLED", "COMPLETED", 409, "DELETED", "REJECTED"]);
  });
});

test("terminal parse failure atomically closes both the job and import batch with worker identity", async () => {
  await resetSchema();
  await migrateThrough(43);
  await seedUser();
  await fallbackFixture(async ({ store, service, queue }) => {
    const { batchId, jobId, finalRelativePath } = await queueReadyCsv(service, "MISSING");
    await queue.dispatchOutbox();
    await pool.query("update background_jobs set max_attempts=1 where id=$1", [jobId]);
    await store.delete(finalRelativePath);
    const worker = new SelfHostedWorker(
      queue, unusedWorkerStorage, "material-import-terminal-worker", 1,
      undefined, undefined, 20_000, () => undefined, store,
    );
    assert.equal(await worker.runOnce(), true);
    const state = await pool.query(`
      select j.status job_status,j.last_error_code,b.status batch_status,b.failure_code,
        e.actor_type,e.actor_identifier,e.request_id,
        a.username audit_username,a.detail->>'executor' audit_executor,a.request_id audit_request_id
      from background_jobs j
      join material_import_job_outbox o on o.id=j.id
      join material_import_batches b on b.id::text=o.aggregate_id
      join material_import_events e on e.batch_id=b.id and e.event_type='IMPORT_PARSE_FAILED'
      join audit_log a on a.request_id=j.id and a.action='IMPORT_PARSE_FAILED'
      where j.id=$1
    `, [jobId]);
    assert.deepEqual([
      state.rows[0].job_status,
      state.rows[0].last_error_code,
      state.rows[0].batch_status,
      state.rows[0].failure_code,
      state.rows[0].actor_type,
      state.rows[0].actor_identifier,
      state.rows[0].request_id,
      state.rows[0].audit_username,
      state.rows[0].audit_executor,
      state.rows[0].audit_request_id,
    ], [
      "DEAD", "IMPORT_FILE_STORAGE_MISSING", "FAILED", "IMPORT_FILE_STORAGE_MISSING",
      "WORKER", "material-import-terminal-worker", jobId,
      "system", "material-import-terminal-worker", jobId,
    ]);
    assert.equal(Number((await pool.query("select count(*)::int count from material_import_parse_runs where batch_id=$1", [batchId])).rows[0].count), 0);
  });
});

test("terminal publication failure rolls domain and queue changes back together", async () => {
  await resetSchema();
  await migrateThrough(43);
  await seedUser();
  await fallbackFixture(async ({ service, queue }) => {
    const { batchId, jobId } = await queueReadyCsv(service, "ROLLBACK");
    await queue.dispatchOutbox();
    await pool.query("update background_jobs set max_attempts=1 where id=$1", [jobId]);
    const job = await queue.claim("atomic-rollback-worker");
    assert.equal(job.id, jobId);
    await assert.rejects(
      queue.fail(job, "atomic-rollback-worker", "SYNTHETIC_TERMINAL", "synthetic", false, async (client) => {
        await client.query(`
          update material_import_batches set status='FAILED',failure_stage='PARSING',
            failure_code='SYNTHETIC_TERMINAL',failure_message='合成终态发布失败',
            current_version=current_version+1,updated_at=now() where id=$1
        `, [batchId]);
        throw new Error("SYNTHETIC_TERMINAL_PUBLICATION_FAILURE");
      }),
      /SYNTHETIC_TERMINAL_PUBLICATION_FAILURE/,
    );
    const state = await pool.query(`
      select j.status job_status,j.lease_owner,b.status batch_status,b.failure_code,b.current_version
      from background_jobs j join material_import_job_outbox o on o.id=j.id
      join material_import_batches b on b.id::text=o.aggregate_id where j.id=$1
    `, [jobId]);
    assert.deepEqual([
      state.rows[0].job_status,
      state.rows[0].lease_owner,
      state.rows[0].batch_status,
      state.rows[0].failure_code,
      Number(state.rows[0].current_version),
    ], ["RUNNING", "atomic-rollback-worker", "QUEUED_FOR_PARSING", null, 4]);
    await pool.query("update background_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [jobId]);
    let stalePublicationCalls = 0;
    assert.equal(await queue.fail(
      job,
      "atomic-rollback-worker",
      "SYNTHETIC_STALE_FAILURE",
      "synthetic",
      true,
      async () => { stalePublicationCalls += 1; },
    ), false);
    assert.equal(stalePublicationCalls, 0);
    const stale = await pool.query(`
      select j.status job_status,b.status batch_status,b.failure_code
      from background_jobs j join material_import_job_outbox o on o.id=j.id
      join material_import_batches b on b.id::text=o.aggregate_id where j.id=$1
    `, [jobId]);
    assert.deepEqual([
      stale.rows[0].job_status,
      stale.rows[0].batch_status,
      stale.rows[0].failure_code,
    ], ["RUNNING", "QUEUED_FOR_PARSING", null]);
  });
});

test("expired terminal lease atomically marks the parser job dead and the batch failed", async () => {
  await resetSchema();
  await migrateThrough(43);
  await seedUser();
  await fallbackFixture(async ({ store, service, queue }) => {
    const { batchId, jobId } = await queueReadyCsv(service, "EXPIRED");
    await queue.dispatchOutbox();
    await pool.query("update background_jobs set max_attempts=1 where id=$1", [jobId]);
    const claimed = await queue.claim("expired-lease-worker");
    assert.equal(claimed.id, jobId);
    await pool.query("update background_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [jobId]);
    const worker = new SelfHostedWorker(
      queue, unusedWorkerStorage, "material-import-recovery-worker", 1,
      undefined, undefined, 20_000, () => undefined, store,
    );
    assert.equal(await worker.runOnce(), false);
    const state = await pool.query(`
      select j.status job_status,j.last_error_code,b.status batch_status,b.failure_code,
        e.actor_identifier,e.request_id
      from background_jobs j join material_import_job_outbox o on o.id=j.id
      join material_import_batches b on b.id::text=o.aggregate_id
      join material_import_events e on e.batch_id=b.id and e.event_type='IMPORT_PARSE_FAILED'
      where j.id=$1
    `, [jobId]);
    assert.deepEqual([
      state.rows[0].job_status,
      state.rows[0].last_error_code,
      state.rows[0].batch_status,
      state.rows[0].failure_code,
      state.rows[0].actor_identifier,
      state.rows[0].request_id,
    ], ["DEAD", "LEASE_EXPIRED", "FAILED", "LEASE_EXPIRED", "material-import-recovery-worker", jobId]);
    assert.equal(Number((await pool.query("select current_version from material_import_batches where id=$1", [batchId])).rows[0].current_version), 5);
  });
});

test("concurrent identical uploads serialize the final duplicate decision and delete the rejected final object", async () => {
  await resetSchema();
  await migrateThrough(43);
  await seedUser();
  class PromotionBarrierStore extends LocalMaterialImportFileStore {
    promotionCount = 0;
    releaseBarrier;
    barrier = new Promise((resolve) => { this.releaseBarrier = resolve; });
    async promote(input) {
      const result = await super.promote(input);
      this.promotionCount += 1;
      if (this.promotionCount === 1) await this.barrier;
      else this.releaseBarrier();
      return result;
    }
  }
  await fallbackFixture(async ({ store, service }) => {
    const created = await Promise.all(["left", "right"].map((label) => service.createBatch({
      actor: actor(),
      requestId: randomUUID(),
      idempotencyKey: `duplicate-create-${label}-${randomUUID()}`,
      sourceKind: "CSV",
      retryOfBatchId: null,
    })));
    const content = Buffer.from("supplier_code,name\nDUP-1,Concurrent\n");
    const headers = {
      expectedVersion: 1,
      declaredFilename: "concurrent.csv",
      filenameExtension: ".csv",
      declaredMimeType: "text/csv",
      declaredSha256: sha256(content),
      declaredSizeBytes: content.byteLength,
      duplicateAction: "REJECT",
    };
    const preparations = await Promise.all(created.map((batch, index) => service.prepareUpload({
      actor: actor(),
      requestId: randomUUID(),
      idempotencyKey: `duplicate-upload-${index}-${randomUUID()}`,
      batchId: Number(batch.data.id),
      headers,
    })));
    const results = await Promise.allSettled(preparations.map((preparation) => service.executeUpload({
      preparation,
      actor: actor(),
      requestId: randomUUID(),
      part: contentPart("concurrent.csv", "text/csv", content),
    })));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected?.reason instanceof MaterialImportFallbackError);
    assert.equal(rejected.reason.code, "IMPORT_FILE_DUPLICATE");
    assert.equal(rejected.reason.status, 409);

    const batches = await pool.query("select status,failure_code from material_import_batches order by id");
    assert.deepEqual(batches.rows.map((row) => [row.status, row.failure_code]).sort(), [
      ["FAILED", "IMPORT_FILE_DUPLICATE"],
      ["FILE_READY", null],
    ]);
    const files = await pool.query("select storage_status,security_check_status from material_import_files order by id");
    assert.deepEqual(files.rows.map((row) => [row.storage_status, row.security_check_status]).sort(), [
      ["DELETED", "REJECTED"],
      ["STORED", "BASIC_CHECK_PASSED"],
    ]);
    const operations = await pool.query("select phase from material_import_upload_operations order by operation_id");
    assert.deepEqual(operations.rows.map((row) => row.phase).sort(), ["FAILED", "PUBLISHED"]);
    const idempotency = await pool.query("select state,status_code from material_import_idempotency where route_scope like '%/file' order by status_code");
    assert.deepEqual(idempotency.rows.map((row) => [row.state, Number(row.status_code)]), [["COMPLETED", 201], ["COMPLETED", 409]]);
    const finalFacts = await Promise.all(preparations.map((preparation) => store.inspectOptional(preparation.finalRelativePath)));
    assert.equal(finalFacts.filter(Boolean).length, 1);
  }, PromotionBarrierStore);
});

test("security rejection is terminal and removes only the rejected staging file", async () => {
  await resetSchema();
  await migrateThrough(43);
  await seedUser();
  await fallbackFixture(async ({ store, service }) => {
    const created = await service.createBatch({
      actor: actor(), requestId: randomUUID(), idempotencyKey: `create-${randomUUID()}`,
      sourceKind: "CSV", retryOfBatchId: null,
    });
    const content = Buffer.from("%PDF-1.7 synthetic");
    const headers = {
      expectedVersion: 1, declaredFilename: "unsafe.csv", filenameExtension: ".csv", declaredMimeType: "text/csv",
      declaredSha256: sha256(content), declaredSizeBytes: content.byteLength, duplicateAction: "REJECT",
    };
    const prepared = await service.prepareUpload({
      actor: actor(), requestId: randomUUID(), idempotencyKey: `upload-${randomUUID()}`,
      batchId: Number(created.data.id), headers,
    });
    await assert.rejects(
      service.executeUpload({
        preparation: prepared, actor: actor(), requestId: randomUUID(),
        part: contentPart("unsafe.csv", "text/csv", content),
      }),
      (error) => error instanceof MaterialImportFallbackError && error.code === "IMPORT_FILE_TYPE_UNSUPPORTED" && error.status === 422,
    );
    assert.equal(await store.inspectOptional(prepared.stagingRelativePath), null);
    assert.equal(await store.inspectOptional(prepared.finalRelativePath), null);
    const state = await pool.query(`
      select b.status,b.failure_code,f.storage_status,f.security_check_status,o.phase,i.state
      from material_import_batches b join material_import_files f on f.batch_id=b.id
      join material_import_upload_operations o on o.batch_id=b.id
      join material_import_idempotency i on i.operation_id=o.operation_id where b.id=$1
    `, [created.data.id]);
    assert.deepEqual([
      state.rows[0].status,
      state.rows[0].failure_code,
      state.rows[0].storage_status,
      state.rows[0].security_check_status,
      state.rows[0].phase,
      state.rows[0].state,
    ], ["FAILED", "IMPORT_FILE_TYPE_UNSUPPORTED", "DELETED", "REJECTED", "FAILED", "COMPLETED"]);
  });
});

test("post-promotion failure becomes reconciliation-required and the bounded reconciler completes it", async () => {
  await resetSchema();
  await migrateThrough(43);
  await seedUser();
  class FailOnceAfterPromotionStore extends LocalMaterialImportFileStore {
    failed = false;
    async promote(input) {
      const result = await super.promote(input);
      if (!this.failed) {
        this.failed = true;
        throw new Error("SYNTHETIC_AFTER_PROMOTE");
      }
      return result;
    }
  }
  await fallbackFixture(async ({ store, service }) => {
    const created = await service.createBatch({
      actor: actor(), requestId: randomUUID(), idempotencyKey: `create-${randomUUID()}`,
      sourceKind: "CSV", retryOfBatchId: null,
    });
    const content = Buffer.from("supplier_code,name\nREC-1,Recovered\n");
    const headers = {
      expectedVersion: 1, declaredFilename: "recover.csv", filenameExtension: ".csv", declaredMimeType: "text/csv",
      declaredSha256: sha256(content), declaredSizeBytes: content.byteLength, duplicateAction: "REJECT",
    };
    const prepared = await service.prepareUpload({
      actor: actor(), requestId: randomUUID(), idempotencyKey: `upload-${randomUUID()}`,
      batchId: Number(created.data.id), headers,
    });
    await assert.rejects(
      service.executeUpload({
        preparation: prepared, actor: actor(), requestId: randomUUID(),
        part: contentPart("recover.csv", "text/csv", content),
      }),
      (error) => error instanceof MaterialImportFallbackError && error.code === "RESULT_UNKNOWN" && error.status === 503,
    );
    assert.equal((await pool.query("select status from material_import_batches where id=$1", [created.data.id])).rows[0].status, "RECONCILIATION_REQUIRED");
    assert.equal((await pool.query("select phase from material_import_upload_operations where operation_id=$1", [prepared.operationId])).rows[0].phase, "RECONCILIATION_REQUIRED");
    assert.ok(await store.inspectOptional(prepared.finalRelativePath));
    assert.equal(await store.inspectOptional(prepared.stagingRelativePath), null);
    await pool.query("update material_import_idempotency set lease_expires_at=created_at+interval '1 millisecond' where operation_id=$1", [prepared.operationId]);
    await pool.query("update material_import_upload_operations set updated_at=now()-interval '10 minutes' where operation_id=$1", [prepared.operationId]);
    assert.equal(await service.reconcileOneUpload("synthetic-reconciler"), true);
    const recovered = await pool.query(`
      select b.status,b.file_count,f.storage_status,f.security_check_status,o.phase,i.state
      from material_import_batches b join material_import_files f on f.batch_id=b.id
      join material_import_upload_operations o on o.batch_id=b.id
      join material_import_idempotency i on i.operation_id=o.operation_id where b.id=$1
    `, [created.data.id]);
    assert.deepEqual([
      recovered.rows[0].status,
      Number(recovered.rows[0].file_count),
      recovered.rows[0].storage_status,
      recovered.rows[0].security_check_status,
      recovered.rows[0].phase,
      recovered.rows[0].state,
    ], ["FILE_READY", 1, "STORED", "BASIC_CHECK_PASSED", "PUBLISHED", "COMPLETED"]);
    assert.equal(await service.reconcileOneUpload("synthetic-reconciler"), false);
  }, FailOnceAfterPromotionStore);
});

test("resumed multipart failure records and deletes a previously staged exact object", async () => {
  await resetSchema();
  await migrateThrough(43);
  await seedUser();
  await fallbackFixture(async ({ store, service }) => {
    const created = await service.createBatch({
      actor: actor(), requestId: randomUUID(), idempotencyKey: `create-${randomUUID()}`,
      sourceKind: "CSV", retryOfBatchId: null,
    });
    const batchId = Number(created.data.id);
    const content = Buffer.from("supplier_code,name\nRESUME-1,Interrupted\n");
    const headers = {
      expectedVersion: 1, declaredFilename: "resumed.csv", filenameExtension: ".csv", declaredMimeType: "text/csv",
      declaredSha256: sha256(content), declaredSizeBytes: content.byteLength, duplicateAction: "REJECT",
    };
    const uploadKey = `upload-${randomUUID()}`;
    const prepared = await service.prepareUpload({
      actor: actor(), requestId: randomUUID(), idempotencyKey: uploadKey, batchId, headers,
    });
    assert.equal(prepared.kind, "PREPARED");
    await store.stage({
      relativePath: prepared.stagingRelativePath,
      leaseToken: prepared.leaseToken,
      body: contentPart("resumed.csv", "text/csv", content).stream,
    });
    await pool.query(
      "update material_import_idempotency set lease_expires_at=created_at+interval '1 millisecond' where operation_id=$1",
      [prepared.operationId],
    );
    const resumed = await service.prepareUpload({
      actor: actor(), requestId: randomUUID(), idempotencyKey: uploadKey, batchId, headers,
    });
    assert.equal(resumed.kind, "PREPARED");
    assert.equal(resumed.resumed, true);
    assert.notEqual(resumed.leaseToken, prepared.leaseToken);
    await assert.rejects(
      service.failPreparedUpload({
        preparation: resumed, actor: actor(), requestId: randomUUID(),
        code: "IMPORT_MULTIPART_METADATA_MISMATCH", message: "multipart 文件元数据与预检声明不一致", status: 400,
      }),
      (error) => error instanceof MaterialImportFallbackError
        && error.code === "IMPORT_MULTIPART_METADATA_MISMATCH" && error.status === 400,
    );
    assert.equal(await store.inspectOptional(resumed.stagingRelativePath), null);
    assert.equal(await store.inspectOptional(resumed.finalRelativePath), null);
    const state = await pool.query(`
      select b.status,b.failure_code,f.storage_status,f.security_check_status,o.phase,i.state,i.status_code
      from material_import_batches b join material_import_files f on f.batch_id=b.id
      join material_import_upload_operations o on o.batch_id=b.id
      join material_import_idempotency i on i.operation_id=o.operation_id where b.id=$1
    `, [batchId]);
    assert.deepEqual([
      state.rows[0].status,
      state.rows[0].failure_code,
      state.rows[0].storage_status,
      state.rows[0].security_check_status,
      state.rows[0].phase,
      state.rows[0].state,
      Number(state.rows[0].status_code),
    ], ["FAILED", "IMPORT_MULTIPART_METADATA_MISMATCH", "DELETED", "REJECTED", "FAILED", "COMPLETED", 400]);
  });
});

test("post-promotion version drift leaves durable reconciliation evidence", async () => {
  await resetSchema();
  await migrateThrough(43);
  await seedUser();
  class VersionDriftAfterPromotionStore extends LocalMaterialImportFileStore {
    async promote(input) {
      await super.promote(input);
      const match = /^material-import\/(\d+)\//.exec(input.finalRelativePath);
      assert.ok(match);
      await pool.query("update material_import_batches set current_version=current_version+1 where id=$1", [Number(match[1])]);
      throw new Error("SYNTHETIC_VERSION_DRIFT_AFTER_PROMOTE");
    }
  }
  await fallbackFixture(async ({ store, service }) => {
    const created = await service.createBatch({
      actor: actor(), requestId: randomUUID(), idempotencyKey: `create-${randomUUID()}`,
      sourceKind: "CSV", retryOfBatchId: null,
    });
    const batchId = Number(created.data.id);
    const content = Buffer.from("supplier_code,name\nDRIFT-1,Reconcile\n");
    const headers = {
      expectedVersion: 1, declaredFilename: "drift.csv", filenameExtension: ".csv", declaredMimeType: "text/csv",
      declaredSha256: sha256(content), declaredSizeBytes: content.byteLength, duplicateAction: "REJECT",
    };
    const prepared = await service.prepareUpload({
      actor: actor(), requestId: randomUUID(), idempotencyKey: `upload-${randomUUID()}`, batchId, headers,
    });
    await assert.rejects(
      service.executeUpload({
        preparation: prepared, actor: actor(), requestId: randomUUID(),
        part: contentPart("drift.csv", "text/csv", content),
      }),
      (error) => error instanceof MaterialImportFallbackError && error.code === "RESULT_UNKNOWN" && error.status === 503,
    );
    assert.ok(await store.inspectOptional(prepared.finalRelativePath));
    assert.equal(await store.inspectOptional(prepared.stagingRelativePath), null);
    const state = await pool.query(`
      select b.status,b.current_version,b.failure_code batch_failure_code,
        f.storage_status,f.security_check_status,o.phase,o.failure_code operation_failure_code,
        i.state,i.lease_expires_at is not null lease_retained,
        (select count(*)::int from material_import_events where batch_id=b.id and event_type='IMPORT_UPLOAD_RECONCILIATION_REQUIRED') event_count
      from material_import_batches b join material_import_files f on f.batch_id=b.id
      join material_import_upload_operations o on o.batch_id=b.id
      join material_import_idempotency i on i.operation_id=o.operation_id where b.id=$1
    `, [batchId]);
    assert.deepEqual([
      state.rows[0].status,
      Number(state.rows[0].current_version),
      state.rows[0].batch_failure_code,
      state.rows[0].storage_status,
      state.rows[0].security_check_status,
      state.rows[0].phase,
      state.rows[0].operation_failure_code,
      state.rows[0].state,
      state.rows[0].lease_retained,
      Number(state.rows[0].event_count),
    ], [
      "RECONCILIATION_REQUIRED", 4, "IMPORT_OPERATION_FAILED",
      "RECONCILIATION_REQUIRED", "PENDING", "RECONCILIATION_REQUIRED",
      "IMPORT_OPERATION_FAILED", "PENDING", true, 1,
    ]);
  }, VersionDriftAfterPromotionStore);
});

test("expired upload recovery is terminalized with worker-owned reconciliation evidence", async () => {
  await resetSchema();
  await migrateThrough(43);
  await seedUser();
  await fallbackFixture(async ({ store, service }) => {
    const created = await service.createBatch({
      actor: actor(), requestId: randomUUID(), idempotencyKey: `create-${randomUUID()}`,
      sourceKind: "CSV", retryOfBatchId: null,
    });
    const batchId = Number(created.data.id);
    const content = Buffer.from("supplier_code,name\nEXPIRE-1,Manual\n");
    const headers = {
      expectedVersion: 1, declaredFilename: "expired.csv", filenameExtension: ".csv", declaredMimeType: "text/csv",
      declaredSha256: sha256(content), declaredSizeBytes: content.byteLength, duplicateAction: "REJECT",
    };
    const uploadKey = `upload-${randomUUID()}`;
    const prepared = await service.prepareUpload({
      actor: actor(), requestId: randomUUID(), idempotencyKey: uploadKey, batchId, headers,
    });
    const staged = await store.stage({
      relativePath: prepared.stagingRelativePath,
      leaseToken: prepared.leaseToken,
      body: contentPart("expired.csv", "text/csv", content).stream,
    });
    await pool.query(`
      insert into material_import_files(
        batch_id,storage_name,relative_path,staging_relative_path,original_filename,filename_extension,
        mime_type,declared_mime_type,sha256,declared_sha256,size_bytes,declared_size_bytes,
        detected_file_type,actual_sha256,actual_size_bytes,storage_status,security_check_status,uploaded_at
      ) values($1,$2,$3,$4,$5,$6,$7,$7,$8,$8,$9,$9,'CSV',$8,$9,'STAGED','PENDING',now())
    `, [batchId, prepared.operationId, prepared.finalRelativePath, prepared.stagingRelativePath,
      headers.declaredFilename, headers.filenameExtension, headers.declaredMimeType,
      staged.facts.sha256, staged.facts.sizeBytes]);
    await pool.query(`
      update material_import_upload_operations set phase='STAGED',staged_at=now(),updated_at=now()
      where operation_id=$1
    `, [prepared.operationId]);
    await pool.query(`
      update material_import_idempotency set created_at=now()-interval '20 days',
        expires_at=now()-interval '10 days',recovery_until=now()-interval '1 second',
        lease_expires_at=now()-interval '2 seconds',updated_at=now()
      where operation_id=$1
    `, [prepared.operationId]);
    await assert.rejects(
      service.prepareUpload({
        actor: actor(), requestId: randomUUID(), idempotencyKey: uploadKey, batchId, headers,
      }),
      (error) => error instanceof MaterialImportFallbackError
        && error.code === "IMPORT_RECONCILIATION_REQUIRED" && error.status === 409,
    );
    assert.equal(await service.reconcileOneUpload("upload-expiry-worker"), true);
    const state = await pool.query(`
      select b.status,b.current_version,b.failure_code batch_failure_code,
        f.storage_status,f.security_check_status,o.phase,o.failure_code operation_failure_code,
        i.state,i.status_code,i.lease_token,
        e.actor_type,e.actor_identifier,e.request_id,
        a.username audit_username,a.detail->>'initiator' initiator,a.request_id audit_request_id
      from material_import_batches b join material_import_files f on f.batch_id=b.id
      join material_import_upload_operations o on o.batch_id=b.id
      join material_import_idempotency i on i.operation_id=o.operation_id
      join material_import_events e on e.batch_id=b.id and e.event_type='IMPORT_UPLOAD_RECOVERY_EXPIRED'
      join audit_log a on a.request_id=e.request_id and a.action='IMPORT_UPLOAD_RECOVERY_EXPIRED'
      where b.id=$1
    `, [batchId]);
    assert.deepEqual([
      state.rows[0].status,
      Number(state.rows[0].current_version),
      state.rows[0].batch_failure_code,
      state.rows[0].storage_status,
      state.rows[0].security_check_status,
      state.rows[0].phase,
      state.rows[0].operation_failure_code,
      state.rows[0].state,
      Number(state.rows[0].status_code),
      state.rows[0].lease_token,
      state.rows[0].actor_type,
      state.rows[0].actor_identifier,
      state.rows[0].request_id,
      state.rows[0].audit_username,
      state.rows[0].initiator,
      state.rows[0].audit_request_id,
    ], [
      "RECONCILIATION_REQUIRED", 3, "IMPORT_RECONCILIATION_REQUIRED",
      "RECONCILIATION_REQUIRED", "PENDING", "RECONCILIATION_REQUIRED",
      "IMPORT_RECONCILIATION_REQUIRED", "COMPLETED", 409, null,
      "WORKER", "upload-expiry-worker", state.rows[0].request_id,
      "upload-expiry-worker", "import_test_owner", state.rows[0].request_id,
    ]);
    assert.ok(await store.inspectOptional(prepared.stagingRelativePath));
    assert.equal(await service.reconcileOneUpload("upload-expiry-worker"), false);
  });
});

test.after(async () => { await pool.end(); });
