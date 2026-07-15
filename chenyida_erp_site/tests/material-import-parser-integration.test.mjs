import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";

import { getMaterialImportMapping, previewMaterialImportMapping, replaceMaterialImportMapping, confirmMaterialImportMapping } from "../app/lib/material-import/mapping-service.ts";
import { handleMaterialImportApi } from "../app/lib/material-import/handler.ts";
import { MemoryMaterialImportObjectStore } from "../app/lib/material-import/object-store.ts";
import { MATERIAL_IMPORT_PARSER_VERSION } from "../app/lib/material-import/parser-model.ts";
import { MaterialImportParserTaskHandler, queueMaterialImportParse } from "../app/lib/material-import/parser-service.ts";
import { CloudflareQueueMaterialImportTaskScheduler, InMemoryMaterialImportTaskScheduler, MaterialImportOutboxDispatcher, consumeMaterialImportQueueMessage } from "../app/lib/material-import/task-scheduler.ts";

const siteRoot = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const fixedNow = new Date("2026-07-16T02:00:00.000Z");
let sequence = 0;

async function apply(DB, migration) {
  const sql = await readFile(join(siteRoot, "drizzle", migration), "utf8");
  await DB.batch(sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean).map((statement) => DB.prepare(statement)));
}

async function fixture() {
  sequence += 1;
  const mf = new Miniflare({ modules: true, script: "export default {}", compatibilityDate: "2026-05-22", d1Databases: { DB: `parser-integration-${sequence}` } });
  const { DB } = await mf.getBindings();
  for (const migration of ["0000_far_nightmare.sql", "0001_material_master_v2.sql", "0002_material_draft_review_api.sql", "0003_material_draft_lifecycle.sql", "0004_material_import_batch_foundation.sql", "0005_material_import_parser_mapping.sql"]) await apply(DB, migration);
  await DB.prepare("INSERT INTO app_users(username,display_name,role,password_hash,is_active,must_change_password,version,created_at,updated_at) VALUES('owner','Owner','purchase','test',1,0,1,?,?)").bind(fixedNow.toISOString(), fixedNow.toISOString()).run();
  const objectStore = new MemoryMaterialImportObjectStore();
  const bytes = new TextEncoder().encode("标准名称,单位,料号\n电阻,PCS,00123\n电容,PCS,00456\n");
  const stored = await objectStore.putIfAbsent({ key: "test/materials.csv", body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), contentType: "text/csv" });
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  await DB.prepare("INSERT INTO material_import_batches(id,batch_no,source_kind,status,created_by,current_version,file_count,total_rows,accepted_rows,rejected_rows,created_at,updated_at) VALUES(1,'MIB-1','CSV','FILE_READY','owner',1,1,0,0,0,?,?)").bind(fixedNow.toISOString(), fixedNow.toISOString()).run();
  await DB.prepare("INSERT INTO material_import_files(id,batch_id,object_key,original_filename,filename_extension,declared_mime_type,declared_sha256,declared_size_bytes,detected_file_type,actual_sha256,actual_size_bytes,object_etag,storage_status,security_check_status,uploaded_at,created_at,updated_at) VALUES(1,1,'test/materials.csv','materials.csv','.csv','text/csv',?,?, 'CSV',?,?,?,'STORED','BASIC_CHECK_PASSED',?,?,?)").bind(hash, bytes.length, hash, bytes.length, stored.metadata.etag, fixedNow.toISOString(), fixedNow.toISOString(), fixedNow.toISOString()).run();
  return { mf, DB, objectStore };
}

test("in-memory scheduler deduplicates at-least-once job delivery by job id", async () => {
  const scheduler = new InMemoryMaterialImportTaskScheduler();
  const task = { jobId: "job-1", batchId: 1, parseRunId: 2, jobType: "INSPECT_WORKBOOK", payloadVersion: 1 };
  await scheduler.enqueue(task); await scheduler.enqueue(task);
  assert.equal(scheduler.pending().length, 1);
});

test("in-memory scheduler exposes controlled retry semantics", async () => {
  const scheduler = new InMemoryMaterialImportTaskScheduler();
  await scheduler.enqueue({ jobId: "job-2", batchId: 1, parseRunId: 2, jobType: "INSPECT_WORKBOOK", payloadVersion: 1 });
  const result = await scheduler.drain({ async handle() { return "RETRY"; } });
  assert.deepEqual(result, { acknowledged: 0, retried: 1, dead: 0 });
  assert.equal(scheduler.pending().length, 1);
});

test("in-memory scheduler acknowledges terminal jobs", async () => {
  const scheduler = new InMemoryMaterialImportTaskScheduler();
  await scheduler.enqueue({ jobId: "job-3", batchId: 1, parseRunId: 2, jobType: "INSPECT_WORKBOOK", payloadVersion: 1 });
  assert.deepEqual(await scheduler.drain({ async handle() { return "ACK"; } }), { acknowledged: 1, retried: 0, dead: 0 });
  assert.equal(scheduler.pending().length, 0);
});

test("Cloudflare Queue adapter sends JSON without creating bindings", async () => {
  let sent;
  const scheduler = new CloudflareQueueMaterialImportTaskScheduler({ async send(message, options) { sent = { message, options }; } });
  const task = { jobId: "job-4", batchId: 1, parseRunId: 2, jobType: "PREPARE_MAPPING", payloadVersion: 1 };
  await scheduler.enqueue(task);
  assert.deepEqual(sent, { message: task, options: { contentType: "json" } });
});

test("Queue consumer acks persisted terminal outcomes", async () => {
  let acked = false;
  await consumeMaterialImportQueueMessage({ body: { jobId: "job-5", batchId: 1, parseRunId: 2, jobType: "INSPECT_WORKBOOK", payloadVersion: 1 }, ack() { acked = true; }, retry() { throw new Error("unexpected retry"); } }, { async handle() { return "ACK"; } });
  assert.equal(acked, true);
});

test("Queue consumer retries transient outcomes", async () => {
  let delay;
  await consumeMaterialImportQueueMessage({ body: { jobId: "job-6", batchId: 1, parseRunId: 2, jobType: "INSPECT_WORKBOOK", payloadVersion: 1 }, ack() { throw new Error("unexpected ack"); }, retry(options) { delay = options.delaySeconds; } }, { async handle() { return "RETRY"; } });
  assert.equal(delay, 30);
});

test("parse request, outbox dispatch, lease, CSV publish, and mapping preparation form one recoverable flow", { timeout: 60_000 }, async () => {
  const context = await fixture();
  try {
    const queued = await queueMaterialImportParse(context.DB, { batchId: 1, username: "owner", canReadAny: false, expectedVersion: 1, parserVersion: MATERIAL_IMPORT_PARSER_VERSION, idempotencyKey: "parse-flow-key-0001", requestId: "parse-request" }, () => new Date(fixedNow));
    assert.equal(queued.status, 202);
    assert.equal(queued.payload.batch_status, "QUEUED_FOR_PARSING");
    const replay = await queueMaterialImportParse(context.DB, { batchId: 1, username: "owner", canReadAny: false, expectedVersion: 1, parserVersion: MATERIAL_IMPORT_PARSER_VERSION, idempotencyKey: "parse-flow-key-0001", requestId: "parse-replay" }, () => new Date(fixedNow));
    assert.equal(replay.replayed, true);

    const scheduler = new InMemoryMaterialImportTaskScheduler();
    const dispatcher = new MaterialImportOutboxDispatcher(context.DB, scheduler, () => new Date(fixedNow));
    assert.equal((await dispatcher.dispatch()).dispatched, 1);
    const handler = new MaterialImportParserTaskHandler({ database: context.DB, objectStore: context.objectStore, clock: () => new Date(fixedNow) });
    assert.deepEqual(await scheduler.drain(handler), { acknowledged: 1, retried: 0, dead: 0 });
    const parsed = await context.DB.prepare("SELECT status,current_version,current_parse_run_id,total_rows FROM material_import_batches WHERE id=1").first();
    assert.equal(parsed.status, "PARSED");
    assert.equal(parsed.total_rows, 3);
    assert.ok(parsed.current_parse_run_id);
    assert.equal((await context.DB.prepare("SELECT count(*) count FROM material_import_rows WHERE parse_run_id=?").bind(parsed.current_parse_run_id).first()).count, 3);
    assert.equal((await context.DB.prepare("SELECT json_extract(raw_values_json,'$.cells[2].raw_value') code FROM material_import_rows WHERE parse_run_id=? AND row_number=2").bind(parsed.current_parse_run_id).first()).code, "00123");

    assert.equal((await dispatcher.dispatch()).dispatched, 1);
    assert.deepEqual(await scheduler.drain(handler), { acknowledged: 1, retried: 0, dead: 0 });
    const prepared = await context.DB.prepare("SELECT status,current_version FROM material_import_batches WHERE id=1").first();
    assert.equal(prepared.status, "AWAITING_MAPPING");
    const mapping = await getMaterialImportMapping(context.DB, 1, { username: "owner", canReadAny: false });
    assert.equal(mapping.payload.mapping.mapping_status, "DRAFT");
    assert.equal(mapping.payload.mapping.header_row_number, 1);
  } finally { await context.mf.dispose(); }
});

test("mapping replace, bounded preview, and confirm are versioned and never create Material Drafts", { timeout: 60_000 }, async () => {
  const context = await fixture();
  try {
    await queueMaterialImportParse(context.DB, { batchId: 1, username: "owner", canReadAny: false, expectedVersion: 1, parserVersion: MATERIAL_IMPORT_PARSER_VERSION, idempotencyKey: "mapping-flow-parse", requestId: "parse" }, () => new Date(fixedNow));
    const scheduler = new InMemoryMaterialImportTaskScheduler(); const dispatcher = new MaterialImportOutboxDispatcher(context.DB, scheduler, () => new Date(fixedNow)); const handler = new MaterialImportParserTaskHandler({ database: context.DB, objectStore: context.objectStore, clock: () => new Date(fixedNow) });
    await dispatcher.dispatch(); await scheduler.drain(handler); await dispatcher.dispatch(); await scheduler.drain(handler);
    const batch = await context.DB.prepare("SELECT current_version,current_parse_run_id FROM material_import_batches WHERE id=1").first();
    const aggregate = await getMaterialImportMapping(context.DB, 1, { username: "owner", canReadAny: false });
    const draft = { selected_sheet_index: 0, header_mode: "SINGLE_ROW", header_row_number: 1, items: [
      { source_column_index: 0, source_header: "标准名称", target_namespace: "basic", target_code: "STANDARD_NAME", mapping_mode: "SOURCE", required: true, display_order: 0 },
      { source_column_index: 1, source_header: "单位", target_namespace: "basic", target_code: "UNIT", mapping_mode: "SOURCE", required: true, display_order: 1 },
      { source_column_index: 2, source_header: "料号", target_namespace: "supplier_reference", target_code: "SUPPLIER_ITEM_CODE", mapping_mode: "SOURCE", required: false, display_order: 2 },
    ] };
    const saved = await replaceMaterialImportMapping(context.DB, 1, { username: "owner", canReadAny: false, idempotencyKey: "mapping-save-0001", requestId: "save", expectedVersion: batch.current_version, parseRunId: batch.current_parse_run_id, expectedMappingVersion: aggregate.payload.mapping.mapping_version, draft }, () => new Date(fixedNow));
    assert.equal(saved.payload.mapping.mapping_version, 2);
    const savedReplay = await replaceMaterialImportMapping(context.DB, 1, { username: "owner", canReadAny: false, idempotencyKey: "mapping-save-0001", requestId: "save-retry", expectedVersion: batch.current_version, parseRunId: batch.current_parse_run_id, expectedMappingVersion: aggregate.payload.mapping.mapping_version, draft }, () => new Date(fixedNow));
    assert.equal(savedReplay.replayed, true);
    assert.deepEqual(savedReplay.payload, saved.payload);
    const preview = await previewMaterialImportMapping(context.DB, 1, { username: "owner", canReadAny: false, idempotencyKey: "mapping-preview-1", requestId: "preview", expectedVersion: batch.current_version, parseRunId: batch.current_parse_run_id, draft, startRow: 2, rowLimit: 1 }, () => new Date(fixedNow));
    assert.equal(preview.payload.sampled_row_count, 1);
    assert.equal(preview.payload.rows[0].values[2].candidate_value, "00123");
    const confirmed = await confirmMaterialImportMapping(context.DB, 1, { username: "owner", canReadAny: false, idempotencyKey: "mapping-confirm-1", requestId: "confirm", expectedVersion: batch.current_version, parseRunId: batch.current_parse_run_id, mappingId: saved.payload.mapping.id, expectedMappingVersion: 2, metadataDigest: saved.payload.mapping.metadata_digest }, () => new Date(fixedNow));
    assert.equal(confirmed.payload.batch_status, "MAPPING_CONFIRMED");
    const confirmedReplay = await confirmMaterialImportMapping(context.DB, 1, { username: "owner", canReadAny: false, idempotencyKey: "mapping-confirm-1", requestId: "confirm-retry", expectedVersion: batch.current_version, parseRunId: batch.current_parse_run_id, mappingId: saved.payload.mapping.id, expectedMappingVersion: 2, metadataDigest: saved.payload.mapping.metadata_digest }, () => new Date(fixedNow));
    assert.equal(confirmedReplay.replayed, true);
    assert.deepEqual(confirmedReplay.payload, confirmed.payload);
    assert.equal((await context.DB.prepare("SELECT count(*) count FROM material_master").first()).count, 0);
  } finally { await context.mf.dispose(); }
});

test("mapping duplicate targets fail closed", async () => {
  const context = await fixture();
  try {
    await assert.rejects(replaceMaterialImportMapping(context.DB, 1, { username: "owner", canReadAny: false, idempotencyKey: "duplicate-target", requestId: "dup", expectedVersion: 1, parseRunId: 99, expectedMappingVersion: 1, draft: { selected_sheet_index: 0, header_mode: "NO_HEADER", items: [] } }), (error) => error.code === "IMPORT_MAPPING_VERSION_CONFLICT");
  } finally { await context.mf.dispose(); }
});

test("the seven approved HTTP operations enforce CSRF, versions, bounds, and stable responses", { timeout: 60_000 }, async () => {
  const context = await fixture();
  const csrf = "parser-api-csrf";
  const dependencies = { database: context.DB, objectStore: context.objectStore, currentUser: async () => ({ username: "owner", role: "purchase", must_change_password: false }), userCan: (_user, permission) => ["material.import.read", "material.import.parse", "material.import.map"].includes(permission), clock: () => new Date(fixedNow) };
  const call = async (path, { method = "GET", body, key } = {}) => {
    const headers = new Headers({ Origin: "http://local.test", Cookie: `CYD_ERP_CSRF=${csrf}`, "X-CSRF-Token": csrf });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (key) headers.set("Idempotency-Key", key);
    const response = await handleMaterialImportApi(new Request(`http://local.test${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), dependencies);
    return { response, payload: JSON.parse(await response.text()) };
  };
  try {
    const parse = await call("/api/material-master/import-batches/1/parse", { method: "POST", key: "api-parse-key-01", body: { expected_version: 1, parser_version: MATERIAL_IMPORT_PARSER_VERSION } });
    assert.equal(parse.response.status, 202, JSON.stringify(parse.payload));
    const scheduler = new InMemoryMaterialImportTaskScheduler(); const dispatcher = new MaterialImportOutboxDispatcher(context.DB, scheduler, () => new Date(fixedNow)); const handler = new MaterialImportParserTaskHandler({ database: context.DB, objectStore: context.objectStore, clock: () => new Date(fixedNow) });
    await dispatcher.dispatch(); await scheduler.drain(handler); await dispatcher.dispatch(); await scheduler.drain(handler);
    const sheets = await call("/api/material-master/import-batches/1/sheets");
    assert.equal(sheets.response.status, 200);
    const rows = await call("/api/material-master/import-batches/1/rows?sheet_index=0&page=1&page_size=2");
    assert.equal(rows.payload.rows.length, 2);
    const mapping = await call("/api/material-master/import-batches/1/mapping");
    const draft = { selected_sheet_index: 0, header_mode: "SINGLE_ROW", header_row_number: 1, items: [
      { source_column_index: 0, source_header: "标准名称", target_namespace: "basic", target_code: "STANDARD_NAME", mapping_mode: "SOURCE", required: true, display_order: 0 },
      { source_column_index: 1, source_header: "单位", target_namespace: "basic", target_code: "UNIT", mapping_mode: "SOURCE", required: true, display_order: 1 },
      { source_column_index: 2, source_header: "料号", target_namespace: "supplier_reference", target_code: "SUPPLIER_ITEM_CODE", mapping_mode: "SOURCE", required: false, display_order: 2 },
    ] };
    const saved = await call("/api/material-master/import-batches/1/mapping", { method: "PUT", key: "api-mapping-save", body: { expected_version: mapping.payload.current_version, parse_run_id: mapping.payload.mapping.parse_run_id, expected_mapping_version: mapping.payload.mapping.mapping_version, ...draft } });
    assert.equal(saved.payload.mapping.mapping_version, 2);
    const preview = await call("/api/material-master/import-batches/1/mapping/preview", { method: "POST", key: "api-preview-key", body: { expected_version: mapping.payload.current_version, parse_run_id: mapping.payload.mapping.parse_run_id, mapping: draft, start_row: 2, row_limit: 1 } });
    assert.equal(preview.payload.sampled_row_count, 1);
    const confirm = await call("/api/material-master/import-batches/1/mapping/confirm", { method: "POST", key: "api-confirm-key", body: { expected_version: mapping.payload.current_version, parse_run_id: mapping.payload.mapping.parse_run_id, mapping_id: saved.payload.mapping.id, expected_mapping_version: 2, metadata_digest: saved.payload.mapping.metadata_digest } });
    assert.equal(confirm.payload.batch_status, "MAPPING_CONFIRMED");
  } finally { await context.mf.dispose(); }
});

test("read_any capability alone does not grant parse or mapping authority", async () => {
  const context = await fixture();
  try {
    const response = await handleMaterialImportApi(new Request("http://local.test/api/material-master/import-batches/1/parse", { method: "POST" }), { database: context.DB, objectStore: context.objectStore, currentUser: async () => ({ username: "reader", role: "custom", must_change_password: false }), userCan: (_user, permission) => permission === "material.import.read_any" });
    assert.equal(response.status, 403);
  } finally { await context.mf.dispose(); }
});
