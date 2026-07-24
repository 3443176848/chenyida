import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { PostgresBackgroundJobQueue } from "../app/lib/infrastructure/background-jobs.ts";
import { handleSelfhostMaterialImportReviewApi } from "../app/lib/material-import-review-selfhost/handler.ts";
import { PostgresMaterialImportReviewWorker } from "../app/lib/material-import-review-selfhost/worker.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/(test|localhost|127\.0\.0\.1|task04)/i.test(databaseUrl)) throw new Error("isolated TEST_DATABASE_URL is required");
const pool = new Pool({ connectionString: databaseUrl, max: 12, application_name: "material-import-review-test" });
const clock = { now: () => new Date() };
const ids = { uuid: randomUUID };
const actor = {
  username: "reviewer1", must_change_password: false,
  permissions: [
    "material.import.read", "material.import.read_any", "material.import.review.create", "material.import.review.history",
    "material.import.review.edit", "material.import.review.decide", "material.import.review.issue",
    "material.import.review.search_material", "material.import.review.bind", "material.import.review.create_draft",
    "material.import.review.bulk", "material.import.review.finalize", "material.import.review.retry",
  ],
};
const reader = { username: "reader1", must_change_password: false, permissions: ["material.import.read"] };
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function reset() {
  await pool.query(`
    truncate
      material_import_review_history,material_import_review_draft_links,material_import_review_material_bindings,
      material_import_review_finalization_rows,material_import_review_finalizations,
      material_import_review_validation_issues,material_import_review_issue_resolutions,
      material_import_review_attribute_overrides,material_import_review_field_overrides,
      material_import_review_rows,material_import_review_sessions,
      material_import_normalization_lineage,material_import_normalized_attribute_candidates,
      material_import_normalized_field_candidates,material_import_normalization_issues,
      material_import_normalized_rows,material_import_normalization_runs,
      background_jobs,material_import_job_outbox,material_import_events,material_api_idempotency,
      material_import_mapping_items,material_import_mappings,material_import_rows,
      material_import_parse_sheets,material_import_parse_runs,material_import_files,material_import_batches,
      material_change_logs,material_versions,material_attribute_values,material_code_sequences,material_master,
      material_category_attributes,material_attribute_definitions,material_categories,audit_log,app_sessions,app_users
    restart identity cascade
  `);
  await pool.query(`
    insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version)
    values('reviewer1','复核员','manager','test-only',true,false,1),('reader1','只读员','purchase','test-only',true,false,1)
  `);
}

async function seed(totalRows = 3) {
  const requestId = randomUUID();
  await pool.query(`
    insert into material_categories(id,category_code,category_name_cn,parent_id,category_level,status,sort_order,created_by,updated_by,request_id)
    values
      (9101,'ROOT_T4','根',null,1,'ACTIVE',1,'reviewer1','reviewer1',$1),
      (9102,'MID2_T4','二级',9101,2,'ACTIVE',1,'reviewer1','reviewer1',$1),
      (9103,'MID3_T4','三级',9102,3,'ACTIVE',1,'reviewer1','reviewer1',$1),
      (9104,'RES_T4','贴片电阻',9103,4,'ACTIVE',1,'reviewer1','reviewer1',$1)
  `, [requestId]);
  await pool.query(`
    insert into material_attribute_definitions(
      id,attribute_code,attribute_name_cn,data_type,decimal_scale,canonical_unit,allowed_values,
      normalization_rule,status,created_by,updated_by,request_id
    ) values
      (9110,'RESISTANCE_T4','阻值','DECIMAL',3,'ohm','[]'::jsonb,'DECIMAL_SCALE','ACTIVE','reviewer1','reviewer1',$1),
      (9111,'GRADE_T4','等级','TEXT',0,'','[]'::jsonb,'TRIM_UPPER','ACTIVE','reviewer1','reviewer1',$1)
  `, [requestId]);
  await pool.query(`
    insert into material_category_attributes(
      id,category_id,attribute_definition_id,is_required,is_unique_key_component,is_searchable,sort_order,status,
      created_by,updated_by,request_id
    ) values
      (9120,9104,9110,true,true,true,1,'ACTIVE','reviewer1','reviewer1',$1),
      (9121,9104,9111,false,false,true,2,'ACTIVE','reviewer1','reviewer1',$1)
  `, [requestId]);
  const active = await pool.query(`
    insert into material_master(
      internal_material_code,standard_name,category_id,brand,manufacturer,manufacturer_part_number,base_uom,
      material_status,procurement_type,inventory_type,lot_control_required,shelf_life_days,inspection_type,
      environmental_requirement,source_type,source_ref,version,last_modified_by,created_by,updated_by,request_id,
      approved_by,approved_at
    ) values('CYD-RES_T4-000001','已有电阻',9104,'TDK','TDK','OLD-10R','PCS','ACTIVE','PURCHASE','STOCKED',
      false,null,'NORMAL','ROHS','MANUAL','seed',1,'reviewer1','reviewer1','reviewer1',$1,'reviewer1',now())
    returning id,version,standard_name
  `, [requestId]);

  const batch = await pool.query(`
    insert into material_import_batches(batch_no,source_kind,status,created_by,current_version,total_rows,accepted_rows)
    values($1,'CSV','NORMALIZED','reviewer1',8,$2,$2) returning id
  `, [`IMP-REVIEW-${randomUUID().slice(0, 8)}`, totalRows]);
  const batchId = Number(batch.rows[0].id);
  const file = await pool.query(`
    insert into material_import_files(batch_id,storage_name,relative_path,original_filename,mime_type,sha256,size_bytes)
    values($1,$2,$3,'review.csv','text/csv',$4,120) returning id
  `, [batchId, randomUUID(), `${randomUUID()}.csv`, "a".repeat(64)]);
  const parse = await pool.query(`
    insert into material_import_parse_runs(
      batch_id,parser_version,run_status,attempt_no,source_file_sha256,current_stage,rows_written,
      parsed_sheet_count,mapping_preparation_status,source_structure_digest,started_at,completed_at
    ) values($1,'parser-v1','SUCCEEDED',1,$2,'COMPLETE',$3,1,'READY',$4,now(),now()) returning id
  `, [batchId, "a".repeat(64), totalRows, "b".repeat(64)]);
  const parseRunId = Number(parse.rows[0].id);
  const sheet = await pool.query(`
    insert into material_import_parse_sheets(parse_run_id,sheet_index,sheet_name,visibility,parse_status,row_count,source_column_max,warnings)
    values($1,0,'物料','VISIBLE','COMPLETED',$2,3,'[]'::jsonb) returning id
  `, [parseRunId, totalRows]);
  const rawRows = [];
  for (let index = 1; index <= totalRows; index += 1) {
    const raw = { schema_version: 1, source_column_count: 3, cells: [{ column_index: 0, raw_value: `物料${index}` }] };
    const inserted = await pool.query(`
      insert into material_import_rows(batch_id,parse_run_id,job_id,sheet_index,sheet_name,row_number,raw_values,raw_row_hash)
      values($1,$2,$3,0,'物料',$4,$5,$6) returning id
    `, [batchId, parseRunId, randomUUID(), index, raw, digest(raw)]);
    rawRows.push({ id: Number(inserted.rows[0].id), raw });
  }
  const mapping = await pool.query(`
    insert into material_import_mappings(
      mapping_key,batch_id,parse_run_id,mapping_version,source_kind,selected_sheet_index,selected_sheet_name,
      header_mode,header_row_number,source_structure_digest,source_fields,metadata_digest,target_catalog_version,
      mapping_digest,mapping_snapshot,status,created_by,updated_by,confirmed_by,confirmed_at,request_id
    ) values($1,$2,$3,1,'CSV',0,'物料','NO_HEADER',null,$4,'[]'::jsonb,$5,'review-test',$6,$7,
      'CONFIRMED','reviewer1','reviewer1','reviewer1',now(),$8) returning id
  `, [randomUUID(), batchId, parseRunId, "b".repeat(64), "c".repeat(64), "d".repeat(64), { schema_version: 1, items: [], targets: [] }, randomUUID()]);
  const mappingId = Number(mapping.rows[0].id);
  const run = await pool.query(`
    insert into material_import_normalization_runs(
      batch_id,parse_run_id,mapping_id,source_file_id,source_sheet_id,mapping_version,mapping_digest,
      source_schema_digest,processor_version,normalizer_rule_version,metadata_digest,mapping_snapshot,
      run_version,run_status,current_stage,total_rows,processed_rows,valid_rows,warning_rows,error_rows,
      skipped_rows,issue_count,warning_count,error_count,normalized_json_bytes,result_digest,requested_by,
      started_at,completed_at
    ) values($1,$2,$3,$4,$5,1,$6,$7,'normalizer-v1','rule-v1',$8,$9,1,'PUBLISHING','PUBLISH_RESULT',
      $10,$10,$11,1,1,0,2,1,1,$12,$13,'reviewer1',now(),now()) returning id
  `, [
    batchId,
    parseRunId,
    mappingId,
    file.rows[0].id,
    sheet.rows[0].id,
    "d".repeat(64),
    "b".repeat(64),
    "c".repeat(64),
    { schema_version: 1, items: [], targets: [] },
    totalRows,
    totalRows - 2,
    totalRows * 100,
    "e".repeat(64),
  ]);
  const runId = Number(run.rows[0].id);
  const normalized = [];
  for (let index = 0; index < totalRows; index += 1) {
    const status = index === 0 ? "WARNING" : index === 2 ? "ERROR" : "VALID";
    const errors = index === 2 ? 1 : 0;
    const warnings = index === 0 ? 1 : 0;
    const payload = { schema_version: 1, row: index + 1 };
    const inserted = await pool.query(`
      insert into material_import_normalized_rows(
        batch_id,normalization_run_id,source_row_id,source_sheet_id,source_sheet_index,source_sheet_name,
        source_row_number,source_raw_row_hash,normalized_payload,normalized_payload_hash,mapped_values,row_status,
        core_candidate_count,attribute_candidate_count,issue_count,error_count,warning_count,result_summary
      ) values($1,$2,$3,$4,0,'物料',$5,$6,$7,$8,'{}'::jsonb,$9,$10,$11,$12,$13,$14,'{}'::jsonb) returning id
    `, [
      batchId,
      runId,
      rawRows[index].id,
      sheet.rows[0].id,
      index + 1,
      digest(rawRows[index].raw),
      payload,
      digest(payload),
      status,
      index < 3 ? 2 : 0,
      index < 3 ? 2 : 0,
      errors + warnings,
      errors,
      warnings,
    ]);
    const normalizedRowId = Number(inserted.rows[0].id);
    normalized.push(normalizedRowId);
    if (index >= 3) continue;
    for (const [order, code, value] of [[0, "STANDARD_NAME", index === 1 ? "新建电阻" : `已有候选${index + 1}`], [1, "UNIT", "PCS"]]) {
      await pool.query(`
        insert into material_import_normalized_field_candidates(
          normalization_run_id,normalized_row_id,target_namespace,target_field_code,raw_value,normalized_value,
          value_state,validation_status,transformation_rule_code,transformation_rule_version,display_order
        ) values($1,$2,'basic',$3,$4,$4,'VALUE','VALID','TRIM','v1',$5)
      `, [runId, normalizedRowId, code, JSON.stringify(value), order]);
    }
    await pool.query(`
      insert into material_import_normalized_attribute_candidates(
        normalization_run_id,normalized_row_id,attribute_code,attribute_name_snapshot,data_type,raw_value,
        normalized_value,unit_code,validation_status,transformation_rule_code,transformation_rule_version,display_order
      ) values($1,$2,'RESISTANCE_T4','阻值','DECIMAL','10.000'::jsonb,$3,'ohm','VALID','DECIMAL','v1',2)
    `, [runId, normalizedRowId, { value: "10.000", unit: "ohm" }]);
    await pool.query(`
      insert into material_import_normalized_attribute_candidates(
        normalization_run_id,normalized_row_id,attribute_code,attribute_name_snapshot,data_type,raw_value,
        normalized_value,unit_code,validation_status,transformation_rule_code,transformation_rule_version,display_order
      ) values($1,$2,'GRADE_T4','等级','TEXT',$3::jsonb,$4::jsonb,null,'VALID','TRIM_UPPER','v1',3)
    `, [runId, normalizedRowId, JSON.stringify("standard"), JSON.stringify("STANDARD")]);
  }
  const warning = await pool.query(`
    insert into material_import_normalization_issues(
      normalization_run_id,normalized_row_id,issue_level,issue_code,issue_key,target_code,source_sheet_index,
      source_row_number,safe_message,safe_details,rule_code
    ) values($1,$2,'WARNING','NORMALIZATION_BRAND_UNKNOWN',$3,'basic.BRAND',0,1,'品牌需人工确认','{}','NORMALIZATION_BRAND_UNKNOWN') returning id
  `, [runId, normalized[0], "1".repeat(64)]);
  const error = await pool.query(`
    insert into material_import_normalization_issues(
      normalization_run_id,normalized_row_id,issue_level,issue_code,issue_key,target_code,source_sheet_index,
      source_row_number,safe_message,safe_details,rule_code
    ) values($1,$2,'ERROR','NORMALIZATION_REQUIRED_VALUE_MISSING',$3,'basic.STANDARD_NAME',0,3,'必填值缺失','{}','NORMALIZATION_REQUIRED_VALUE_MISSING') returning id
  `, [runId, normalized[2], "2".repeat(64)]);
  await pool.query("update material_import_normalization_runs set run_status='SUCCEEDED',current_stage='COMPLETE',published_at=now() where id=$1", [runId]);
  await pool.query("update material_import_batches set current_parse_run_id=$2,current_normalization_run_id=$3 where id=$1", [batchId, parseRunId, runId]);
  return { batchId, runId, normalized, activeMaterialId: Number(active.rows[0].id), warningIssueId: Number(warning.rows[0].id), errorIssueId: Number(error.rows[0].id), rawRows };
}

async function reviewApi(currentActor, queue, path, { method = "GET", body, key = randomUUID(), csrf = true } = {}) {
  const headers = new Headers();
  if (method !== "GET") { headers.set("Content-Type", "application/json"); headers.set("Idempotency-Key", key); }
  const response = await handleSelfhostMaterialImportReviewApi(new Request(`http://task04.test${path}`, { method, headers, body: body == null ? undefined : JSON.stringify(body) }), {
    pool, queue, actor: currentActor, requestId: randomUUID(),
    requireCsrf: () => { if (!csrf) throw Object.assign(new Error("CSRF Token 无效"), { code: "CSRF_INVALID", status: 403 }); },
  });
  assert.ok(response, `route not handled: ${path}`);
  return { response, payload: await response.json() };
}

test.beforeEach(reset);
test.after(async () => pool.end());

test("PostgreSQL review API and worker preserve immutable layers and finalize bind/exclude/DRAFT idempotently", async () => {
  const seeded = await seed();
  const queue = new PostgresBackgroundJobQueue(pool, clock, ids, 60);
  const denied = await reviewApi(reader, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews`, { method: "POST", body: { normalization_run_id: seeded.runId } });
  assert.equal(denied.response.status, 403);
  const csrf = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews`, { method: "POST", csrf: false, body: { normalization_run_id: seeded.runId } });
  assert.equal(csrf.response.status, 403);

  const createKey = "review-create-task04";
  const created = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews`, { method: "POST", key: createKey, body: { normalization_run_id: seeded.runId } });
  assert.equal(created.response.status, 201);
  const session = created.payload.data;
  assert.equal(session.review_version, 1);
  assert.equal(session.total_rows, 3);
  const replay = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews`, { method: "POST", key: createKey, body: { normalization_run_id: seeded.runId } });
  assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
  const idemConflict = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews`, { method: "POST", key: createKey, body: { normalization_run_id: seeded.runId, supersedes_review_session_id: 99 } });
  assert.equal(idemConflict.response.status, 409);

  const listed = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews/${session.review_session_id}/rows?limit=50`);
  const [bindRow, draftRow, excludedRow] = listed.payload.items;
  assert.deepEqual(listed.payload.items.map((row) => row.normalized_row_id), seeded.normalized);
  let sessionVersion = session.expected_version;

  const bind = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews/${session.review_session_id}/rows/${bindRow.review_row_id}/decision`, {
    method: "POST", body: { expected_session_version: sessionVersion, expected_row_version: 1, disposition: "BIND_EXISTING", existing_material_id: seeded.activeMaterialId, decision_comment: "精确选择" },
  });
  assert.equal(bind.response.status, 200); sessionVersion += 1;
  const stale = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews/${session.review_session_id}/rows/${bindRow.review_row_id}/decision`, {
    method: "POST", body: { expected_session_version: 1, expected_row_version: 1, disposition: "KEEP" },
  });
  assert.equal(stale.response.status, 409);
  const warning = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews/${session.review_session_id}/rows/${bindRow.review_row_id}/issues/${seeded.warningIssueId}/resolution`, {
    method: "POST", body: { expected_session_version: sessionVersion, expected_row_version: 2, resolution_status: "WARNING_ACKNOWLEDGED", resolution_code: "WARNING_REVIEWED", comment: "人工确认" },
  });
  assert.equal(warning.response.status, 200); sessionVersion += 1;

  const category = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews/${session.review_session_id}/rows/${draftRow.review_row_id}/field-overrides`, {
    method: "POST", body: { expected_session_version: sessionVersion, expected_row_version: 1, target_field_code: "CATEGORY_ID", value_semantics: "SET", override_value: 9104, reason_code: "CATEGORY_SELECTED", comment: "人工选择分类" },
  });
  assert.equal(category.response.status, 200); sessionVersion += 1;
  const textAttribute = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews/${session.review_session_id}/rows/${draftRow.review_row_id}/attribute-overrides`, {
    method: "POST", body: { expected_session_version: sessionVersion, expected_row_version: 2, attribute_code: "GRADE_T4", value_semantics: "SET", override_value: "PRECISION", reason_code: "ATTRIBUTE_CONFIRMED", comment: "人工确认文本属性" },
  });
  assert.equal(textAttribute.response.status, 200); sessionVersion += 1;
  const draft = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews/${session.review_session_id}/rows/${draftRow.review_row_id}/decision`, {
    method: "POST", body: { expected_session_version: sessionVersion, expected_row_version: 3, disposition: "CREATE_DRAFT", decision_comment: "人工明确建稿" },
  });
  assert.equal(draft.response.status, 200); sessionVersion += 1;
  const blockedFinalize = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews/${session.review_session_id}/finalize`, {
    method: "POST", body: { expected_version: sessionVersion },
  });
  assert.equal(blockedFinalize.response.status, 422);
  assert.equal(blockedFinalize.payload.code, "IMPORT_REVIEW_NOT_READY");
  const exclude = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews/${session.review_session_id}/rows/${excludedRow.review_row_id}/decision`, {
    method: "POST", body: { expected_session_version: sessionVersion, expected_row_version: 1, disposition: "EXCLUDE", decision_reason_code: "SOURCE_INVALID", decision_comment: "必填字段缺失，人工排除" },
  });
  assert.equal(exclude.response.status, 200); sessionVersion += 1;

  const detail = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews/${session.review_session_id}/rows/${draftRow.review_row_id}`);
  assert.equal(detail.payload.data.effective_values.fields.CATEGORY_ID, 9104);
  assert.equal(detail.payload.data.effective_values.attributes.GRADE_T4.value, "PRECISION");
  assert.equal(detail.payload.data.field_candidates.some((item) => item.target_field_code === "CATEGORY_ID"), false);
  assert.equal(detail.payload.data.raw.raw_values.cells[0].raw_value, "物料2");

  const final = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews/${session.review_session_id}/finalize`, {
    method: "POST", key: "review-finalize-task04", body: { expected_version: sessionVersion },
  });
  assert.equal(final.response.status, 202);
  await queue.dispatchOutbox();
  const staleJob = await queue.claim("review-worker-stale");
  assert.ok(staleJob);
  await pool.query("update background_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [staleJob.id]);
  assert.equal(await queue.recoverExpired(), 1);
  const job = await queue.claim("review-worker-test");
  assert.ok(job);
  assert.equal(job.id, staleJob.id);
  assert.notEqual(job.leaseToken, staleJob.leaseToken);
  await assert.rejects(
    () => new PostgresMaterialImportReviewWorker(pool).prepare(staleJob),
    (error) => error?.code === "IMPORT_REVIEW_LEASE_LOST",
  );
  const publication = await new PostgresMaterialImportReviewWorker(pool).prepare(job);
  assert.equal(publication.result.status, "FINALIZED");
  assert.equal(await queue.complete(job, "review-worker-test", publication.result, publication.publish), true);

  const progress = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews/${session.review_session_id}/finalization`);
  assert.equal(progress.payload.data.review_session.status, "FINALIZED");
  assert.equal(progress.payload.data.review_session.completed_rows, 3);
  const material = await pool.query("select id,material_status,internal_material_code,source_ref from material_master order by id");
  assert.equal(material.rows.length, 2);
  assert.equal(material.rows[0].material_status, "ACTIVE");
  assert.equal(material.rows[0].internal_material_code, "CYD-RES_T4-000001");
  assert.equal(material.rows[1].material_status, "DRAFT");
  assert.equal(material.rows[1].internal_material_code, null);
  assert.match(material.rows[1].source_ref, /^material-import-review:/);
  assert.equal(await pool.query("select count(*)::integer count from material_import_review_material_bindings").then((value) => value.rows[0].count), 1);
  assert.equal(await pool.query("select count(*)::integer count from material_import_review_draft_links").then((value) => value.rows[0].count), 1);

  const activeAfter = await pool.query("select standard_name,version from material_master where id=$1", [seeded.activeMaterialId]);
  assert.equal(activeAfter.rows[0].standard_name, "已有电阻");
  assert.equal(activeAfter.rows[0].version, 1);
  assert.deepEqual((await pool.query("select raw_values from material_import_rows order by id")).rows.map((row) => row.raw_values), seeded.rawRows.map((row) => row.raw));
  assert.equal(await pool.query("select count(*)::integer count from material_import_normalized_field_candidates where normalization_run_id=$1", [seeded.runId]).then((value) => value.rows[0].count), 6);

  const duplicateWorker = await new PostgresMaterialImportReviewWorker(pool).prepare({ ...job, leaseToken: randomUUID() });
  assert.equal(duplicateWorker.result.status, "FINALIZED");
  assert.equal(await pool.query("select count(*)::integer count from material_master").then((value) => value.rows[0].count), 2);

  const secondVersion = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews`, {
    method: "POST", body: { normalization_run_id: seeded.runId, supersedes_review_session_id: session.review_session_id },
  });
  assert.equal(secondVersion.response.status, 201);
  assert.equal(secondVersion.payload.data.review_version, 2);
  const history = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews/history?limit=50`);
  assert.deepEqual(history.payload.items.map((item) => item.review_version), [2, 1]);
  assert.equal(history.payload.items[1].status, "FINALIZED");
});

test("finalization prepares and processes a review across multiple bounded worker chunks", async () => {
  const seeded = await seed(101);
  const queue = new PostgresBackgroundJobQueue(pool, clock, ids, 60);
  const created = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews`, {
    method: "POST",
    body: { normalization_run_id: seeded.runId },
  });
  assert.equal(created.response.status, 201);
  const session = created.payload.data;
  const firstPage = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews/${session.review_session_id}/rows?limit=100`);
  assert.equal(firstPage.payload.items.length, 100);
  assert.ok(firstPage.payload.next_after_id);
  const secondPage = await reviewApi(
    actor,
    queue,
    `/api/material-master/import-batches/${seeded.batchId}/reviews/${session.review_session_id}/rows?limit=100&after_id=${firstPage.payload.next_after_id}`,
  );
  assert.equal(secondPage.payload.items.length, 1);
  const rowIds = [...firstPage.payload.items, ...secondPage.payload.items].map((row) => row.review_row_id);
  const bulk = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews/${session.review_session_id}/bulk-decision`, {
    method: "POST",
    body: {
      expected_session_version: session.expected_version,
      review_row_ids: rowIds,
      disposition: "EXCLUDE",
      decision_reason_code: "CHUNK_TEST_EXCLUDE",
      decision_comment: "多分块最终处理测试",
    },
  });
  assert.equal(bulk.response.status, 200);
  assert.equal(bulk.payload.changed_rows, 101);
  const final = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews/${session.review_session_id}/finalize`, {
    method: "POST",
    body: { expected_version: bulk.payload.session_version },
  });
  assert.equal(final.response.status, 202);
  await queue.dispatchOutbox();
  const job = await queue.claim("review-worker-chunk-test");
  assert.ok(job);
  const publication = await new PostgresMaterialImportReviewWorker(pool).prepare(job);
  assert.equal(publication.result.status, "FINALIZED");
  assert.equal(await queue.complete(job, "review-worker-chunk-test", publication.result, publication.publish), true);
  const finalizationRows = await pool.query(`
    select count(*)::integer count
    from material_import_review_finalization_rows fr
    join material_import_review_finalizations f on f.id=fr.finalization_id
    where f.review_session_id=$1 and fr.operation_status='SUCCEEDED'
  `, [session.review_session_id]);
  assert.equal(finalizationRows.rows[0].count, 101);
  assert.equal(await pool.query("select count(*)::integer count from material_master").then((value) => value.rows[0].count), 1);
});

test("finalization stores a deduplicated review validation issue when an ACTIVE binding becomes stale", async () => {
  const seeded = await seed();
  const queue = new PostgresBackgroundJobQueue(pool, clock, ids, 60);
  const created = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews`, {
    method: "POST",
    body: { normalization_run_id: seeded.runId },
  });
  const session = created.payload.data;
  const listed = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews/${session.review_session_id}/rows?limit=50`);
  const [warningRow, bindRow, errorRow] = listed.payload.items;
  let sessionVersion = session.expected_version;
  for (const row of [warningRow, errorRow]) {
    const excluded = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews/${session.review_session_id}/rows/${row.review_row_id}/decision`, {
      method: "POST",
      body: {
        expected_session_version: sessionVersion,
        expected_row_version: 1,
        disposition: "EXCLUDE",
        decision_reason_code: "STALE_BIND_TEST",
        decision_comment: "最终处理失效绑定测试排除行",
      },
    });
    assert.equal(excluded.response.status, 200);
    sessionVersion += 1;
  }
  const bound = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews/${session.review_session_id}/rows/${bindRow.review_row_id}/decision`, {
    method: "POST",
    body: {
      expected_session_version: sessionVersion,
      expected_row_version: 1,
      disposition: "BIND_EXISTING",
      existing_material_id: seeded.activeMaterialId,
      decision_comment: "人工精确选择",
    },
  });
  assert.equal(bound.response.status, 200);
  sessionVersion += 1;
  const final = await reviewApi(actor, queue, `/api/material-master/import-batches/${seeded.batchId}/reviews/${session.review_session_id}/finalize`, {
    method: "POST",
    body: { expected_version: sessionVersion },
  });
  assert.equal(final.response.status, 202);
  await pool.query(`
    update material_master set
      material_status='DRAFT',internal_material_code=null,updated_at=now()
    where id=$1
  `, [seeded.activeMaterialId]);
  await queue.dispatchOutbox();
  const job = await queue.claim("review-worker-stale-binding");
  assert.ok(job);
  const publication = await new PostgresMaterialImportReviewWorker(pool).prepare(job);
  assert.equal(publication.result.status, "FINALIZE_FAILED");
  assert.equal(await queue.complete(job, "review-worker-stale-binding", publication.result, publication.publish), true);
  const issues = await pool.query(`
    select issue_code,target_code,is_active,count(*) over() total
    from material_import_review_validation_issues
    where review_row_id=$1
  `, [bindRow.review_row_id]);
  assert.equal(issues.rows.length, 1);
  assert.equal(issues.rows[0].issue_code, "IMPORT_REVIEW_MATERIAL_NOT_ACTIVE");
  assert.equal(issues.rows[0].target_code, "FINALIZATION.BIND_EXISTING");
  assert.equal(issues.rows[0].is_active, true);
  assert.equal(await pool.query("select count(*)::integer count from material_import_review_material_bindings").then((value) => value.rows[0].count), 0);
});
