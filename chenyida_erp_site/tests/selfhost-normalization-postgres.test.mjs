import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { PostgresBackgroundJobQueue } from "../app/lib/infrastructure/background-jobs.ts";
import { PostgresMappingCatalog, mappingTargetSemanticProjection } from "../app/lib/material-import-selfhost/catalog.ts";
import { handleSelfhostMaterialImportNormalizationApi } from "../app/lib/material-import-normalization-selfhost/handler.ts";
import { PostgresMaterialImportNormalizationWorker } from "../app/lib/material-import-normalization-selfhost/worker.ts";
import { MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION } from "../app/lib/material-import/normalization-model.ts";
import { mappingContentDigest, sourceStructureDigest } from "../app/lib/material-import-selfhost/rules.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/(test|localhost|127\.0\.0\.1|task03)/i.test(databaseUrl)) throw new Error("isolated TEST_DATABASE_URL is required");
const pool = new Pool({ connectionString: databaseUrl, max: 12, application_name: "normalization-integration-test" });
const actor = { username: "normalizer1", must_change_password: false, permissions: ["material.import.read", "material.import.read_any", "material.import.normalize", "material.import.cancel"] };
const reader = { username: "reader1", must_change_password: false, permissions: ["material.import.read"] };

function raw(values) {
  return {
    schema_version: 1,
    source_column_count: values.length,
    cells: values.map((value, index) => ({
      column_index: index,
      column_ref: String.fromCharCode(65 + index),
      type: "TEXT",
      source_type: "TEXT",
      raw_value: value,
      display: value,
      format_code: null,
    })),
  };
}

function rowHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function reset() {
  await pool.query(`
    truncate
      material_import_normalization_lineage,material_import_normalized_attribute_candidates,
      material_import_normalized_field_candidates,material_import_normalization_issues,
      material_import_normalized_rows,material_import_normalization_runs,
      background_jobs,material_import_job_outbox,material_import_idempotency,material_import_events,
      material_import_mapping_items,material_import_mappings,material_import_header_suggestions,
      material_import_rows,material_import_parse_sheets,material_import_parse_runs,material_import_files,
      material_import_batches,material_category_attributes,material_attribute_definitions,
      material_categories,audit_log,app_sessions,app_users
    restart identity cascade
  `);
  await pool.query(`
    insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version)
    values
      ('normalizer1','规范化员','manager','test-only',true,false,1),
      ('reader1','只读员','purchase','test-only',true,false,1),
      ('other1','其他人','purchase','test-only',true,false,1)
  `);
}

async function createMappedBatch() {
  const batch = await pool.query(`
    insert into material_import_batches(batch_no,source_kind,status,created_by,current_version)
    values($1,'CSV','MAPPING_CONFIRMED','normalizer1',5) returning *
  `, [`IMP-NORM-${randomUUID().slice(0, 8)}`]);
  const batchId = Number(batch.rows[0].id);
  const file = await pool.query(`
    insert into material_import_files(batch_id,storage_name,relative_path,original_filename,mime_type,sha256,size_bytes)
    values($1,$2,$3,'normalization.csv','text/csv',$4,200) returning id
  `, [batchId, randomUUID(), `${randomUUID()}.csv`, "a".repeat(64)]);
  const parse = await pool.query(`
    insert into material_import_parse_runs(
      batch_id,parser_version,run_status,attempt_no,source_file_sha256,current_stage,rows_written,
      parsed_sheet_count,mapping_preparation_status,started_at,completed_at
    ) values($1,'material-import-parser-v1','SUCCEEDED',1,$2,'COMPLETE',5,1,'READY',now(),now()) returning id
  `, [batchId, "a".repeat(64)]);
  const parseRunId = Number(parse.rows[0].id);
  const sheet = await pool.query(`
    insert into material_import_parse_sheets(
      parse_run_id,sheet_index,sheet_name,visibility,parse_status,row_count,source_column_max,warnings
    ) values($1,0,'物料','VISIBLE','COMPLETED',5,4,'[]'::jsonb) returning id
  `, [parseRunId]);
  const values = [
    raw(["名称", "单位", "品牌", "额定电压"]),
    raw(["精密电阻", "PCS", "TDK", "12.50"]),
    raw(["贴片电容", "PCS", "UNKNOWN", "3.30"]),
    raw(["   ", "PCS", "Murata", "5.00"]),
    raw(["测试器件", "PCS", "TDK", "not-a-number"]),
  ];
  for (let index = 0; index < values.length; index += 1) {
    await pool.query(`
      insert into material_import_rows(batch_id,parse_run_id,job_id,sheet_index,sheet_name,row_number,raw_values,raw_row_hash)
      values($1,$2,$3,0,'物料',$4,$5,$6)
    `, [batchId, parseRunId, randomUUID(), index + 1, values[index], rowHash(values[index])]);
  }
  const fields = [
    { column_index: 0, column_ref: "A", source_header: "名称", normalized_header: "名称" },
    { column_index: 1, column_ref: "B", source_header: "单位", normalized_header: "单位" },
    { column_index: 2, column_ref: "C", source_header: "品牌", normalized_header: "品牌" },
    { column_index: 3, column_ref: "D", source_header: "额定电压", normalized_header: "额定电压" },
  ];
  const structureDigest = sourceStructureDigest({ sourceKind: "CSV", sheetName: "物料", sheetIndex: 0, headerMode: "SINGLE_ROW", headerRowNumber: 1, fields });
  await pool.query("update material_import_parse_runs set source_structure_digest=$2 where id=$1", [parseRunId, structureDigest]);
  await pool.query(`
    insert into material_attribute_definitions(
      attribute_code,attribute_name_cn,data_type,decimal_scale,canonical_unit,allowed_values,
      normalization_rule,status,version,created_by,updated_by,request_id
    ) values('RATED_VOLTAGE','额定电压','DECIMAL',2,'V','[]'::jsonb,'DECIMAL_CANONICAL','ACTIVE',1,'normalizer1','normalizer1',$1)
  `, [randomUUID()]);
  const catalog = await new PostgresMappingCatalog(pool).snapshot();
  const items = [
    { source_column_index: 0, source_column_indexes: [0], source_header: "名称", source_headers: ["名称"], target_namespace: "basic", target_code: "STANDARD_NAME", mapping_mode: "SOURCE", default_value_json: null, required: true, display_order: 0, combination_strategy: "FIRST_NON_EMPTY", combination_separator: " ", mapping_confidence: 1, adaptive_mapping_status: "CONFIRMED", mapping_evidence: [] },
    { source_column_index: 1, source_column_indexes: [1], source_header: "单位", source_headers: ["单位"], target_namespace: "basic", target_code: "UNIT", mapping_mode: "SOURCE", default_value_json: null, required: true, display_order: 1, combination_strategy: "FIRST_NON_EMPTY", combination_separator: " ", mapping_confidence: 1, adaptive_mapping_status: "CONFIRMED", mapping_evidence: [] },
    { source_column_index: 2, source_column_indexes: [2], source_header: "品牌", source_headers: ["品牌"], target_namespace: "basic", target_code: "BRAND", mapping_mode: "SOURCE", default_value_json: null, required: false, display_order: 2, combination_strategy: "FIRST_NON_EMPTY", combination_separator: " ", mapping_confidence: 1, adaptive_mapping_status: "CONFIRMED", mapping_evidence: [] },
    { source_column_index: 3, source_column_indexes: [3], source_header: "额定电压", source_headers: ["额定电压"], target_namespace: "attribute", target_code: "RATED_VOLTAGE", mapping_mode: "SOURCE", default_value_json: null, required: false, display_order: 3, combination_strategy: "FIRST_NON_EMPTY", combination_separator: " ", mapping_confidence: 1, adaptive_mapping_status: "CONFIRMED", mapping_evidence: [] },
  ];
  const mappingDigest = mappingContentDigest({ selectedSheetIndex: 0, headerMode: "SINGLE_ROW", headerRowNumber: 1, sourceStructureDigest: structureDigest, metadataDigest: catalog.metadataDigest, items });
  const mapping = await pool.query(`
    insert into material_import_mappings(
      mapping_key,batch_id,parse_run_id,mapping_version,source_kind,selected_sheet_index,selected_sheet_name,
      header_mode,header_row_number,source_structure_digest,source_fields,metadata_digest,target_catalog_version,
      mapping_digest,status,created_by,updated_by,request_id
    ) values($1,$2,$3,1,'CSV',0,'物料','SINGLE_ROW',1,$4,$5,$6,'material-import-mapping-metadata-v1',$7,'DRAFT','normalizer1','normalizer1',$8)
    returning id
  `, [randomUUID(), batchId, parseRunId, structureDigest, JSON.stringify(fields), catalog.metadataDigest, mappingDigest, randomUUID()]);
  const mappingId = Number(mapping.rows[0].id);
  for (const item of items) {
    await pool.query(`
      insert into material_import_mapping_items(
        mapping_id,source_column_index,source_column_indexes,source_header,source_headers,target_namespace,
        target_code,mapping_mode,default_value,required,combination_strategy,combination_separator,
        mapping_confidence,adaptive_mapping_status,mapping_evidence,display_order
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    `, [
      mappingId,
      item.source_column_index,
      JSON.stringify(item.source_column_indexes),
      item.source_header,
      JSON.stringify(item.source_headers),
      item.target_namespace,
      item.target_code,
      item.mapping_mode,
      item.default_value_json,
      item.required,
      item.combination_strategy,
      item.combination_separator,
      item.mapping_confidence,
      item.adaptive_mapping_status,
      JSON.stringify(item.mapping_evidence),
      item.display_order,
    ]);
  }
  const usedTargets = items.map((item) => catalog.targetByKey.get(`${item.target_namespace}\u0000${item.target_code}`));
  const snapshot = { schema_version: 1, mapping_id: mappingId, mapping_version: 1, source_structure_digest: structureDigest, metadata_digest: catalog.metadataDigest, source_fields: fields, items, targets: usedTargets.map(mappingTargetSemanticProjection) };
  await pool.query(`
    update material_import_mappings set status='CONFIRMED',mapping_snapshot=$2,confirmed_by='normalizer1',confirmed_at=now(),updated_at=now()
    where id=$1
  `, [mappingId, snapshot]);
  await pool.query("update material_import_batches set current_parse_run_id=$2 where id=$1", [batchId, parseRunId]);
  return { batchId, parseRunId, fileId: Number(file.rows[0].id), sheetId: Number(sheet.rows[0].id), mappingId };
}

async function api(currentActor, path, { method = "GET", body, key = randomUUID(), csrf = true } = {}) {
  const headers = new Headers();
  if (method !== "GET") {
    headers.set("Content-Type", "application/json");
    headers.set("Idempotency-Key", key);
  }
  const request = new Request(`http://erp.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return handleSelfhostMaterialImportNormalizationApi(request, {
    pool,
    actor: currentActor,
    requestId: randomUUID(),
    requireCsrf: () => {
      if (!csrf) throw Object.assign(new Error("CSRF Token 无效"), { code: "CSRF_INVALID", status: 403 });
    },
  });
}

async function processPendingRun() {
  const queue = new PostgresBackgroundJobQueue(pool, { now: () => new Date() }, { uuid: randomUUID }, 60);
  await queue.dispatchOutbox();
  const job = await queue.claim("normalization-test-worker");
  assert.ok(job);
  const processor = new PostgresMaterialImportNormalizationWorker(pool);
  const publication = await processor.prepare(job);
  return { queue, job, publication };
}

test.beforeEach(reset);
test.after(async () => pool.end());

test("PostgreSQL API and worker publish complete candidates, lineage, issues, history, retry and cancellation", async () => {
  const { batchId, mappingId } = await createMappedBatch();
  const denied = await api(reader, `/api/material-master/import-batches/${batchId}/normalize`, { method: "POST", body: { expected_version: 5, processor_version: MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION } });
  assert.equal(denied.status, 403);
  const csrf = await api(actor, `/api/material-master/import-batches/${batchId}/normalize`, { method: "POST", csrf: false, body: { expected_version: 5, processor_version: MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION } });
  assert.equal(csrf.status, 403);

  const key = randomUUID();
  const body = { expected_version: 5, processor_version: MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION, mapping_version_id: mappingId };
  const created = await api(actor, `/api/material-master/import-batches/${batchId}/normalize`, { method: "POST", key, body });
  assert.equal(created.status, 202);
  const createdPayload = await created.json();
  const runId = createdPayload.normalization_run_id;
  assert.equal(createdPayload.run_version, 1);
  const replay = await api(actor, `/api/material-master/import-batches/${batchId}/normalize`, { method: "POST", key, body });
  assert.equal(replay.status, 202);
  assert.equal(replay.headers.get("Idempotency-Replayed"), "true");
  const conflict = await api(actor, `/api/material-master/import-batches/${batchId}/normalize`, { method: "POST", key, body: { ...body, rerun_reason: "different" } });
  assert.equal(conflict.status, 409);

  const first = await processPendingRun();
  assert.equal(first.publication.result.status, "SUCCEEDED");
  const hidden = await api(actor, `/api/material-master/import-batches/${batchId}/normalized-rows?run_id=${runId}&limit=50`);
  assert.equal(hidden.status, 404);
  assert.equal(await first.queue.complete(first.job, "normalization-test-worker", first.publication.result, first.publication.publish), true);

  const summaryResponse = await api(actor, `/api/material-master/import-batches/${batchId}/normalization`);
  assert.equal(summaryResponse.status, 200);
  const summary = await summaryResponse.json();
  assert.equal(summary.current_run.id, runId);
  assert.equal(summary.current_run.total_rows, 4);
  assert.equal(summary.current_run.valid_rows, 1);
  assert.equal(summary.current_run.warning_rows, 1);
  assert.equal(summary.current_run.error_rows, 2);
  assert.equal(summary.current_run.issue_count, 3);
  assert.match(summary.current_run.result_digest, /^[a-f0-9]{64}$/);

  const rowsResponse = await api(actor, `/api/material-master/import-batches/${batchId}/normalized-rows?run_id=${runId}&limit=50`);
  const rows = await rowsResponse.json();
  assert.equal(rows.items.length, 4);
  assert.deepEqual(rows.items.map((row) => row.row_status).sort(), ["ERROR", "ERROR", "VALID", "WARNING"]);
  const warningRows = await (await api(actor, `/api/material-master/import-batches/${batchId}/normalized-rows?run_id=${runId}&issue_level=WARNING&limit=50`)).json();
  assert.equal(warningRows.items.length, 1);
  const issuesResponse = await api(actor, `/api/material-master/import-batches/${batchId}/normalization-issues?run_id=${runId}&limit=50`);
  const issues = await issuesResponse.json();
  assert.equal(issues.items.length, 3);
  assert.ok(issues.items.some((issue) => issue.issue_code === "NORMALIZATION_BRAND_UNKNOWN"));
  assert.ok(issues.items.some((issue) => issue.issue_code === "NORMALIZATION_BLANK_VALUE"));
  assert.ok(issues.items.some((issue) => issue.issue_code === "NORMALIZATION_NUMBER_INVALID"));

  const detail = await (await api(actor, `/api/material-master/import-batches/${batchId}/normalized-rows/${rows.items[0].id}?run_id=${runId}`)).json();
  assert.equal(detail.raw_row.schema_version, 1);
  assert.ok(detail.field_candidates.length >= 3);
  assert.equal(detail.attribute_candidates.length, 1);
  assert.ok(detail.lineage.length >= detail.field_candidates.length);
  assert.equal(await pool.query("select count(*)::integer count from material_import_normalized_attribute_candidates where normalization_run_id=$1", [runId]).then((result) => result.rows[0].count), 4);
  assert.equal(await pool.query("select count(*)::integer count from material_master").then((result) => result.rows[0].count), 0);

  const rerunSummaryVersion = summary.current_version;
  const rerun = await api(actor, `/api/material-master/import-batches/${batchId}/normalize`, {
    method: "POST",
    body: { expected_version: rerunSummaryVersion, processor_version: MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION, mapping_version_id: mappingId, rerun_reason: "验证历史运行保留" },
  });
  assert.equal(rerun.status, 202);
  const rerunPayload = await rerun.json();
  assert.equal(rerunPayload.run_version, 2);
  const second = await processPendingRun();
  assert.equal(await second.queue.complete(second.job, "normalization-test-worker", second.publication.result, second.publication.publish), true);
  const history = await (await api(actor, `/api/material-master/import-batches/${batchId}/normalization/runs?limit=20`)).json();
  assert.equal(history.items.length, 2);
  assert.equal(history.items[0].run_status, "SUCCEEDED");
  assert.equal(history.items[1].run_status, "SUPERSEDED");
  const oldRows = await api(actor, `/api/material-master/import-batches/${batchId}/normalized-rows?run_id=${runId}&limit=50`);
  assert.equal(oldRows.status, 200);

  const latestSummary = await (await api(actor, `/api/material-master/import-batches/${batchId}/normalization`)).json();
  const third = await api(actor, `/api/material-master/import-batches/${batchId}/normalize`, {
    method: "POST",
    body: { expected_version: latestSummary.current_version, processor_version: MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION, mapping_version_id: mappingId, rerun_reason: "验证取消" },
  });
  const thirdPayload = await third.json();
  await pool.query(`
    update material_import_job_outbox set status='CANCELLED' where id=(select worker_job_id from material_import_normalization_runs where id=$1)
  `, [thirdPayload.normalization_run_id]);
  await pool.query(`
    update material_import_normalization_runs set
      run_status='FAILED',current_stage='COMPLETE',completed_at=now(),failure_code='TEST_TRANSIENT',
      safe_failure_message='测试失败',expected_version=expected_version+1
    where id=$1
  `, [thirdPayload.normalization_run_id]);
  await pool.query("update material_import_batches set status='NORMALIZED' where id=$1", [batchId]);
  const failedRun = await pool.query("select expected_version from material_import_normalization_runs where id=$1", [thirdPayload.normalization_run_id]);
  const retry = await api(actor, `/api/material-master/import-batches/${batchId}/normalization/runs/${thirdPayload.normalization_run_id}/retry`, { method: "POST", body: { expected_version: Number(failedRun.rows[0].expected_version) } });
  assert.equal(retry.status, 202);
  const retryPayload = await retry.json();
  assert.equal(retryPayload.normalization_run_id, thirdPayload.normalization_run_id);
  assert.equal(retryPayload.run_status, "QUEUED");
  const cancel = await api(actor, `/api/material-master/import-batches/${batchId}/normalization/runs/${thirdPayload.normalization_run_id}/cancel`, { method: "POST", body: { expected_version: retryPayload.expected_version } });
  assert.equal(cancel.status, 202);
  assert.equal((await cancel.json()).run_status, "CANCELLED");
  const final = await (await api(actor, `/api/material-master/import-batches/${batchId}/normalization`)).json();
  assert.equal(final.current_run.id, rerunPayload.normalization_run_id);
});

test("database constraints and immutable publication reject inconsistent or duplicate result writes", async () => {
  const { batchId, mappingId } = await createMappedBatch();
  const created = await api(actor, `/api/material-master/import-batches/${batchId}/normalize`, { method: "POST", body: { expected_version: 5, processor_version: MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION, mapping_version_id: mappingId } });
  const runId = (await created.json()).normalization_run_id;
  const work = await processPendingRun();
  const concurrent = await Promise.allSettled([
    work.queue.complete(work.job, "normalization-test-worker", work.publication.result, work.publication.publish),
    work.queue.complete(work.job, "normalization-test-worker", work.publication.result, work.publication.publish),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled" && result.value === true).length, 1);
  assert.equal(await pool.query("select count(*)::integer count from material_import_normalized_rows where normalization_run_id=$1", [runId]).then((result) => result.rows[0].count), 4);
  await assert.rejects(
    pool.query("update material_import_normalized_rows set row_status='ERROR' where normalization_run_id=$1", [runId]),
    /published normalization result is immutable/,
  );
  await assert.rejects(
    pool.query("insert into material_import_normalization_runs(batch_id,parse_run_id,mapping_id,source_file_id,source_sheet_id,mapping_version,mapping_digest,source_schema_digest,processor_version,normalizer_rule_version,metadata_digest,mapping_snapshot,run_version,run_status,expected_version,current_stage,total_rows,requested_by,published_at,result_digest,completed_at) select batch_id,parse_run_id,mapping_id,source_file_id,source_sheet_id,mapping_version,mapping_digest,source_schema_digest,processor_version,normalizer_rule_version,metadata_digest,mapping_snapshot,run_version,'SUCCEEDED',1,'COMPLETE',0,requested_by,now(),repeat('a',64),now() from material_import_normalization_runs where id=$1", [runId]),
    /material_import_normalization_runs_batch_version_uq/,
  );
});

test("draft, stale, changed-source and unbounded queries are rejected with safe API errors", async () => {
  const { batchId, mappingId, parseRunId } = await createMappedBatch();
  const requestBody = { expected_version: 5, processor_version: MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION, mapping_version_id: mappingId };
  await pool.query("update material_import_mappings set status='DRAFT' where id=$1", [mappingId]);
  const draft = await api(actor, `/api/material-master/import-batches/${batchId}/normalize`, { method: "POST", body: requestBody });
  assert.equal(draft.status, 422);
  assert.equal((await draft.json()).code, "IMPORT_NORMALIZATION_MAPPING_REQUIRED");
  await pool.query("update material_import_mappings set status='CONFIRMED' where id=$1", [mappingId]);
  await pool.query("update material_import_parse_runs set source_structure_digest=$2 where id=$1", [parseRunId, "9".repeat(64)]);
  const changed = await api(actor, `/api/material-master/import-batches/${batchId}/normalize`, { method: "POST", body: requestBody });
  assert.equal(changed.status, 422);
  assert.equal((await changed.json()).code, "IMPORT_NORMALIZATION_SOURCE_SCHEMA_MISMATCH");
  const oversized = await api(actor, `/api/material-master/import-batches/${batchId}/normalized-rows?limit=101`);
  assert.equal(oversized.status, 400);
  const invalidFilter = await api(actor, `/api/material-master/import-batches/${batchId}/normalization-issues?issue_level=INFO`);
  assert.equal(invalidFilter.status, 400);
  const audits = await pool.query("select count(*)::integer count from audit_log where result='failed' and route_code like 'IMPORT_NORMALIZATION_%'");
  assert.ok(audits.rows[0].count >= 4);
});

test("publication rollback, lost lease and cancellation checkpoints never expose staged rows", async () => {
  const { batchId, mappingId } = await createMappedBatch();
  const create = await api(actor, `/api/material-master/import-batches/${batchId}/normalize`, {
    method: "POST",
    body: { expected_version: 5, processor_version: MATERIAL_IMPORT_NORMALIZATION_PROCESSOR_VERSION, mapping_version_id: mappingId },
  });
  const runId = (await create.json()).normalization_run_id;
  const work = await processPendingRun();
  await assert.rejects(
    work.queue.complete(work.job, "normalization-test-worker", work.publication.result, async (client) => {
      await work.publication.publish(client);
      throw new Error("TEST_PUBLICATION_ROLLBACK");
    }),
    /TEST_PUBLICATION_ROLLBACK/,
  );
  assert.equal(await pool.query("select run_status from material_import_normalization_runs where id=$1", [runId]).then((result) => result.rows[0].run_status), "PUBLISHING");
  assert.equal((await api(actor, `/api/material-master/import-batches/${batchId}/normalized-rows?run_id=${runId}`)).status, 404);
  await pool.query("update background_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [work.job.id]);
  await assert.rejects(
    work.queue.complete(work.job, "normalization-test-worker", work.publication.result, work.publication.publish),
    /后台任务租约已失效/,
  );
  assert.equal(await pool.query("select current_normalization_run_id from material_import_batches where id=$1", [batchId]).then((result) => result.rows[0].current_normalization_run_id), null);
  await pool.query("update background_jobs set lease_expires_at=now()+interval '1 minute' where id=$1", [work.job.id]);
  const selected = await pool.query("select expected_version from material_import_normalization_runs where id=$1", [runId]);
  const cancel = await api(actor, `/api/material-master/import-batches/${batchId}/normalization/runs/${runId}/cancel`, {
    method: "POST",
    body: { expected_version: Number(selected.rows[0].expected_version) },
  });
  assert.equal((await cancel.json()).run_status, "CANCEL_REQUESTED");
  assert.equal(await work.queue.complete(work.job, "normalization-test-worker", work.publication.result, work.publication.publish), true);
  assert.equal(await pool.query("select run_status from material_import_normalization_runs where id=$1", [runId]).then((result) => result.rows[0].run_status), "CANCELLED");
  assert.equal((await api(actor, `/api/material-master/import-batches/${batchId}/normalized-rows?run_id=${runId}`)).status, 404);
  assert.equal(await pool.query("select current_normalization_run_id from material_import_batches where id=$1", [batchId]).then((result) => result.rows[0].current_normalization_run_id), null);
});
