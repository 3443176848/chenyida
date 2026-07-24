import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { MaterialImportMappingError } from "../app/lib/material-import-selfhost/errors.ts";
import { handleSelfhostMaterialImportMappingApi } from "../app/lib/material-import-selfhost/handler.ts";
import { publishInitialMapping } from "../app/lib/material-import-selfhost/service.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/(test|localhost|127\.0\.0\.1|erp-task02-test-pg)/i.test(databaseUrl)) throw new Error("isolated TEST_DATABASE_URL is required");
const pool = new Pool({ connectionString: databaseUrl, max: 12, application_name: "mapping-integration-test" });
const actor = { username: "mapper1", must_change_password: false, permissions: ["material.import.read", "material.import.map"] };
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
      audit_log,material_import_idempotency,material_import_events,material_import_mapping_items,
      material_import_mappings,material_import_header_suggestions,material_import_rows,
      material_import_parse_sheets,material_import_parse_runs,material_import_files,
      material_import_batches,material_category_attributes,material_attribute_definitions,
      material_categories,app_sessions,app_users
    restart identity cascade
  `);
  await pool.query(`
    insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version)
    values
      ('mapper1','映射员','purchase','test-only',true,false,1),
      ('reader1','只读员','purchase','test-only',true,false,1),
      ('other1','其他人','purchase','test-only',true,false,1)
  `);
  await pool.query(`
    insert into material_attribute_definitions(
      attribute_code,attribute_name_cn,data_type,decimal_scale,canonical_unit,allowed_values,
      normalization_rule,status,created_by,updated_by,request_id
    ) values('COLOR','颜色','TEXT',0,'','[]'::jsonb,'TRIM','ACTIVE','mapper1','mapper1',$1)
  `, [randomUUID()]);
}

async function createParsedBatch(owner = "mapper1") {
  const batch = await pool.query(`
    insert into material_import_batches(batch_no,source_kind,status,created_by,current_version)
    values($1,'CSV','AWAITING_MAPPING',$2,2) returning *
  `, [`IMP-TEST-${randomUUID().slice(0, 8)}`, owner]);
  const batchId = Number(batch.rows[0].id);
  await pool.query(`
    insert into material_import_files(batch_id,storage_name,relative_path,original_filename,mime_type,sha256,size_bytes)
    values($1,$2,$3,'mapping.csv','text/csv',$4,100)
  `, [batchId, randomUUID(), `${randomUUID()}.csv`, "a".repeat(64)]);
  const run = await pool.query(`
    insert into material_import_parse_runs(
      batch_id,parser_version,run_status,attempt_no,source_file_sha256,current_stage,rows_written,
      parsed_sheet_count,mapping_preparation_status,started_at,completed_at
    ) values($1,'material-import-parser-v1','SUCCEEDED',1,$2,'COMPLETE',2,1,'READY',now(),now())
    returning id
  `, [batchId, "a".repeat(64)]);
  const parseRunId = Number(run.rows[0].id);
  await pool.query(`
    insert into material_import_parse_sheets(
      parse_run_id,sheet_index,sheet_name,visibility,parse_status,row_count,source_column_max,warnings
    ) values($1,0,'__CSV__','VISIBLE','COMPLETED',2,3,'[]'::jsonb)
  `, [parseRunId]);
  const values = [
    raw(["standard_name", "unit", "COLOR"]),
    raw(["10 欧姆贴片电阻", "PCS", "黑色"]),
  ];
  for (let index = 0; index < values.length; index += 1) {
    await pool.query(`
      insert into material_import_rows(batch_id,parse_run_id,job_id,sheet_index,sheet_name,row_number,raw_values,raw_row_hash)
      values($1,$2,$3,0,'__CSV__',$4,$5,$6)
    `, [batchId, parseRunId, randomUUID(), index + 1, values[index], rowHash(values[index])]);
  }
  await pool.query("update material_import_batches set current_parse_run_id=$2 where id=$1", [batchId, parseRunId]);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const initial = await publishInitialMapping(client, {
      batchId,
      parseRunId,
      requestId: randomUUID(),
      actor: owner,
      rows: values.map((value, index) => ({ sheetIndex: 0, sheetName: "__CSV__", rowNumber: index + 1, raw: value })),
    });
    await client.query("update material_import_parse_runs set source_structure_digest=$2 where id=$1", [parseRunId, initial.sourceStructureDigest]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return { batchId, parseRunId };
}

async function api(currentActor, path, { method = "GET", body, key = randomUUID(), csrf = true } = {}) {
  const headers = new Headers();
  if (method !== "GET") {
    headers.set("Content-Type", "application/json");
    headers.set("Idempotency-Key", key);
  }
  const result = await handleSelfhostMaterialImportMappingApi(new Request(`http://local.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), {
    pool,
    actor: currentActor,
    requestId: randomUUID(),
    requireCsrf: () => {
      if (!csrf) throw new MaterialImportMappingError("CSRF_INVALID", "CSRF Token 无效", 403);
    },
  });
  assert.ok(result, `route not handled: ${path}`);
  return { response: result, payload: await result.json() };
}

function mappedItems(mapping) {
  return [
    ...mapping.items,
    {
      source_column_index: 2,
      source_column_indexes: [2],
      source_header: "COLOR",
      source_headers: ["COLOR"],
      target_namespace: "attribute",
      target_code: "COLOR",
      mapping_mode: "SOURCE",
      default_value_json: null,
      required: false,
      display_order: 2,
      combination_strategy: "FIRST_NON_EMPTY",
      combination_separator: " ",
      mapping_confidence: 1,
      adaptive_mapping_status: "CONFIRMED",
      mapping_evidence: ["USER_CONFIRMED"],
    },
  ];
}

test.beforeEach(reset);
test.after(async () => pool.end());

test("migration applies the mapping model and immutable guards", async () => {
  const versions = await pool.query("select version from schema_migrations order by version");
  assert.deepEqual(versions.rows.map((row) => row.version), [
    "0001_selfhost_baseline.sql",
    "0002_material_master_workflow.sql",
    "0003_material_import_mapping.sql",
    "0004_material_import_normalization.sql",
    "0005_material_import_review.sql",
  ]);
  const columns = await pool.query(`
    select column_name from information_schema.columns
    where table_name='material_import_mappings'
  `);
  assert.ok(columns.rows.some((row) => row.column_name === "mapping_snapshot"));
});

test("current UI contract can read, save, preview, confirm and replay atomically", async () => {
  const { batchId, parseRunId } = await createParsedBatch();
  const sheets = await api(actor, `/api/material-master/import-batches/${batchId}/sheets`);
  assert.equal(sheets.response.status, 200);
  assert.equal(sheets.payload.mapping_preparation_status, "READY");
  assert.equal(sheets.payload.sheets[0].source_column_max, 3);
  const rows = await api(actor, `/api/material-master/import-batches/${batchId}/rows?sheet_index=0&page=1&page_size=20`);
  assert.equal(rows.payload.rows[0].raw.source_column_count, 3);

  const initial = await api(actor, `/api/material-master/import-batches/${batchId}/mapping`);
  assert.equal(initial.payload.mapping.mapping_status, "DRAFT");
  const saveBody = {
    expected_version: 2,
    parse_run_id: parseRunId,
    expected_mapping_version: initial.payload.mapping.mapping_version,
    selected_sheet_index: 0,
    header_mode: "SINGLE_ROW",
    header_row_number: 1,
    items: mappedItems(initial.payload.mapping),
  };
  const saved = await api(actor, `/api/material-master/import-batches/${batchId}/mapping`, { method: "PUT", body: saveBody, key: "mapping-save-0001" });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.payload.mapping.mapping_version, 2);
  const replay = await api(actor, `/api/material-master/import-batches/${batchId}/mapping`, { method: "PUT", body: saveBody, key: "mapping-save-0001" });
  assert.equal(replay.response.headers.get("Idempotency-Replayed"), "true");
  assert.equal(replay.payload.mapping.mapping_digest, saved.payload.mapping.mapping_digest);
  const conflict = await api(actor, `/api/material-master/import-batches/${batchId}/mapping`, { method: "PUT", body: { ...saveBody, header_row_number: null }, key: "mapping-save-0001" });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.payload.code, "IDEMPOTENCY_CONFLICT");

  const previewBody = {
    expected_version: 2,
    parse_run_id: parseRunId,
    mapping: {
      selected_sheet_index: 0,
      header_mode: "SINGLE_ROW",
      header_row_number: 1,
      items: saved.payload.mapping.items,
    },
    start_row: 2,
    row_limit: 20,
  };
  const preview = await api(actor, `/api/material-master/import-batches/${batchId}/mapping/preview`, { method: "POST", body: previewBody, key: "mapping-preview-0001" });
  assert.equal(preview.payload.sampled_row_count, 1);
  assert.equal(preview.payload.rows[0].values.find((item) => item.target_code === "COLOR").candidate_value, "黑色");
  const confirmBody = {
    expected_version: 2,
    parse_run_id: parseRunId,
    mapping_id: saved.payload.mapping.id,
    expected_mapping_version: saved.payload.mapping.mapping_version,
    metadata_digest: saved.payload.mapping.metadata_digest,
  };
  const confirmed = await api(actor, `/api/material-master/import-batches/${batchId}/mapping/confirm`, { method: "POST", body: confirmBody, key: "mapping-confirm-0001" });
  assert.equal(confirmed.payload.batch_status, "MAPPING_CONFIRMED");
  assert.equal(confirmed.payload.mapping.mapping_status, "CONFIRMED");
  const confirmReplay = await api(actor, `/api/material-master/import-batches/${batchId}/mapping/confirm`, { method: "POST", body: confirmBody, key: "mapping-confirm-0001" });
  assert.equal(confirmReplay.response.headers.get("Idempotency-Replayed"), "true");

  await assert.rejects(
    pool.query("update material_import_mappings set mapping_digest=$2 where id=$1", [saved.payload.mapping.id, "f".repeat(64)]),
    /confirmed material import mapping is immutable/,
  );
  await assert.rejects(
    pool.query("delete from material_import_mapping_items where mapping_id=$1", [saved.payload.mapping.id]),
    /confirmed material import mapping items are immutable/,
  );
  const audits = await pool.query("select action from audit_log where username='mapper1' and result='success'");
  assert.deepEqual(new Set(audits.rows.map((row) => row.action)), new Set(["IMPORT_MAPPING_SAVED", "IMPORT_MAPPING_PREVIEWED", "IMPORT_MAPPING_CONFIRMED"]));
});

test("confirmed mapping is reusable only by explicit draft application and always requires confirmation", async () => {
  const first = await createParsedBatch();
  const current = await api(actor, `/api/material-master/import-batches/${first.batchId}/mapping`);
  const save = await api(actor, `/api/material-master/import-batches/${first.batchId}/mapping`, {
    method: "PUT",
    key: "reuse-source-save",
    body: {
      expected_version: 2,
      parse_run_id: first.parseRunId,
      expected_mapping_version: 1,
      selected_sheet_index: 0,
      header_mode: "SINGLE_ROW",
      header_row_number: 1,
      items: mappedItems(current.payload.mapping),
    },
  });
  await api(actor, `/api/material-master/import-batches/${first.batchId}/mapping/confirm`, {
    method: "POST",
    key: "reuse-source-confirm",
    body: {
      expected_version: 2,
      parse_run_id: first.parseRunId,
      mapping_id: save.payload.mapping.id,
      expected_mapping_version: save.payload.mapping.mapping_version,
      metadata_digest: save.payload.mapping.metadata_digest,
    },
  });
  const second = await createParsedBatch();
  const candidates = await api(actor, `/api/material-master/import-batches/${second.batchId}/mapping/reuse-candidates`);
  const source = candidates.payload.items.find((item) => item.batch_id === first.batchId);
  assert.equal(source.decision, "AUTO_RECOMMEND");
  const applied = await api(actor, `/api/material-master/import-batches/${second.batchId}/mapping/reuse`, {
    method: "POST",
    key: "mapping-reuse-0001",
    body: { expected_version: 2, expected_mapping_version: 1, source_mapping_id: source.mapping_id },
  });
  assert.equal(applied.payload.reuse_decision, "AUTO_RECOMMEND");
  assert.equal(applied.payload.confirmation_required, true);
  assert.equal(applied.payload.mapping.mapping_status, "DRAFT");
  assert.equal(applied.payload.mapping.reuse_source_mapping_id, source.mapping_id);
  const sourceAfter = await api(actor, `/api/material-master/import-batches/${first.batchId}/mapping`);
  assert.equal(sourceAfter.payload.mapping.mapping_status, "CONFIRMED");
});

test("new same-batch versions preserve the prior snapshot and reject meaningless duplicates", async () => {
  const batch = await createParsedBatch();
  const current = await api(actor, `/api/material-master/import-batches/${batch.batchId}/mapping`);
  const saved = await api(actor, `/api/material-master/import-batches/${batch.batchId}/mapping`, {
    method: "PUT",
    key: "version-source-save",
    body: {
      expected_version: 2,
      parse_run_id: batch.parseRunId,
      expected_mapping_version: 1,
      selected_sheet_index: 0,
      header_mode: "SINGLE_ROW",
      header_row_number: 1,
      items: mappedItems(current.payload.mapping),
    },
  });
  const confirmed = await api(actor, `/api/material-master/import-batches/${batch.batchId}/mapping/confirm`, {
    method: "POST",
    key: "version-source-confirm",
    body: {
      expected_version: 2,
      parse_run_id: batch.parseRunId,
      mapping_id: saved.payload.mapping.id,
      expected_mapping_version: saved.payload.mapping.mapping_version,
      metadata_digest: saved.payload.mapping.metadata_digest,
    },
  });
  const draft = await api(actor, `/api/material-master/import-batches/${batch.batchId}/mapping/versions`, {
    method: "POST",
    key: "version-new-draft",
    body: { expected_version: confirmed.payload.current_version },
  });
  assert.equal(draft.payload.mapping.mapping_status, "DRAFT");
  const duplicate = await api(actor, `/api/material-master/import-batches/${batch.batchId}/mapping/confirm`, {
    method: "POST",
    key: "version-duplicate-confirm",
    body: {
      expected_version: draft.payload.current_version,
      parse_run_id: batch.parseRunId,
      mapping_id: draft.payload.mapping.id,
      expected_mapping_version: draft.payload.mapping.mapping_version,
      metadata_digest: draft.payload.mapping.metadata_digest,
    },
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.payload.code, "IMPORT_MAPPING_DUPLICATE_VERSION");

  const changedItems = [...draft.payload.mapping.items, {
    source_column_index: null,
    source_column_indexes: [],
    source_header: null,
    source_headers: [],
    target_namespace: "basic",
    target_code: "DESCRIPTION",
    mapping_mode: "DEFAULT",
    default_value_json: "第二个确认版本",
    required: false,
    display_order: 3,
    combination_strategy: "FIRST_NON_EMPTY",
    combination_separator: " ",
    mapping_confidence: 1,
    adaptive_mapping_status: "CONFIRMED",
    mapping_evidence: ["VERSION_CHANGE"],
  }];
  const changed = await api(actor, `/api/material-master/import-batches/${batch.batchId}/mapping`, {
    method: "PUT",
    key: "version-changed-save",
    body: {
      expected_version: draft.payload.current_version,
      parse_run_id: batch.parseRunId,
      expected_mapping_version: draft.payload.mapping.mapping_version,
      selected_sheet_index: 0,
      header_mode: "SINGLE_ROW",
      header_row_number: 1,
      items: changedItems,
    },
  });
  await api(actor, `/api/material-master/import-batches/${batch.batchId}/mapping/confirm`, {
    method: "POST",
    key: "version-changed-confirm",
    body: {
      expected_version: draft.payload.current_version,
      parse_run_id: batch.parseRunId,
      mapping_id: changed.payload.mapping.id,
      expected_mapping_version: changed.payload.mapping.mapping_version,
      metadata_digest: changed.payload.mapping.metadata_digest,
    },
  });
  const versions = await api(actor, `/api/material-master/import-batches/${batch.batchId}/mapping/versions`);
  assert.equal(versions.payload.items[0].mapping_status, "CONFIRMED");
  assert.equal(versions.payload.items[1].mapping_status, "SUPERSEDED");
  assert.equal(versions.payload.items[1].superseded_by_mapping_id, versions.payload.items[0].id);
});

test("target type drift makes a confirmed version stale for reuse and invalid by compatibility", async () => {
  const first = await createParsedBatch();
  const current = await api(actor, `/api/material-master/import-batches/${first.batchId}/mapping`);
  const save = await api(actor, `/api/material-master/import-batches/${first.batchId}/mapping`, {
    method: "PUT",
    key: "stale-source-save",
    body: {
      expected_version: 2,
      parse_run_id: first.parseRunId,
      expected_mapping_version: 1,
      selected_sheet_index: 0,
      header_mode: "SINGLE_ROW",
      header_row_number: 1,
      items: mappedItems(current.payload.mapping),
    },
  });
  await api(actor, `/api/material-master/import-batches/${first.batchId}/mapping/confirm`, {
    method: "POST",
    key: "stale-source-confirm",
    body: {
      expected_version: 2,
      parse_run_id: first.parseRunId,
      mapping_id: save.payload.mapping.id,
      expected_mapping_version: save.payload.mapping.mapping_version,
      metadata_digest: save.payload.mapping.metadata_digest,
    },
  });
  await pool.query("update material_attribute_definitions set data_type='INTEGER',normalization_rule='INTEGER' where attribute_code='COLOR'");
  const validity = await api(actor, `/api/material-master/import-batches/${first.batchId}/mapping/validity`);
  assert.equal(validity.payload.valid, false);
  assert.equal(validity.payload.reason_code, "TARGET_CATALOG_INCOMPATIBLE");
  const second = await createParsedBatch();
  const candidates = await api(actor, `/api/material-master/import-batches/${second.batchId}/mapping/reuse-candidates`);
  assert.equal(candidates.payload.items.find((item) => item.batch_id === first.batchId).decision, "STALE");
  const denied = await api(actor, `/api/material-master/import-batches/${second.batchId}/mapping/reuse`, {
    method: "POST",
    key: "stale-reuse-denied",
    body: { expected_version: 2, expected_mapping_version: 1, source_mapping_id: save.payload.mapping.id },
  });
  assert.equal(denied.response.status, 409);
  assert.equal(denied.payload.code, "IMPORT_MAPPING_REUSE_INCOMPATIBLE");
});

test("authorization, CSRF, optimistic concurrency and rollback are enforced", async () => {
  const batch = await createParsedBatch();
  const hidden = await api(reader, `/api/material-master/import-batches/${batch.batchId}/mapping`);
  assert.equal(hidden.response.status, 404);
  const csrf = await api(actor, `/api/material-master/import-batches/${batch.batchId}/mapping`, {
    method: "PUT",
    csrf: false,
    key: "csrf-mapping-save",
    body: {},
  });
  assert.equal(csrf.response.status, 403);
  const current = await api(actor, `/api/material-master/import-batches/${batch.batchId}/mapping`);
  const body = {
    expected_version: 2,
    parse_run_id: batch.parseRunId,
    expected_mapping_version: 1,
    selected_sheet_index: 0,
    header_mode: "SINGLE_ROW",
    header_row_number: 1,
    items: mappedItems(current.payload.mapping),
  };
  const [left, right] = await Promise.all([
    api(actor, `/api/material-master/import-batches/${batch.batchId}/mapping`, { method: "PUT", body, key: "concurrent-map-left" }),
    api(actor, `/api/material-master/import-batches/${batch.batchId}/mapping`, { method: "PUT", body, key: "concurrent-map-right" }),
  ]);
  assert.deepEqual([left.response.status, right.response.status].sort(), [200, 409]);

  const rollbackBatch = await createParsedBatch();
  const rollbackCurrent = await api(actor, `/api/material-master/import-batches/${rollbackBatch.batchId}/mapping`);
  await pool.query(`create or replace function fail_mapping_audit_for_test() returns trigger language plpgsql as $$ begin raise exception 'test mapping audit failure'; end $$`);
  await pool.query(`create trigger fail_mapping_audit_for_test before insert on audit_log for each row execute function fail_mapping_audit_for_test()`);
  const failed = await api(actor, `/api/material-master/import-batches/${rollbackBatch.batchId}/mapping`, {
    method: "PUT",
    key: "rollback-mapping-save",
    body: {
      expected_version: 2,
      parse_run_id: rollbackBatch.parseRunId,
      expected_mapping_version: 1,
      selected_sheet_index: 0,
      header_mode: "SINGLE_ROW",
      header_row_number: 1,
      items: mappedItems(rollbackCurrent.payload.mapping),
    },
  });
  assert.equal(failed.response.status, 500);
  await pool.query("drop trigger fail_mapping_audit_for_test on audit_log");
  await pool.query("drop function fail_mapping_audit_for_test()");
  const after = await api(actor, `/api/material-master/import-batches/${rollbackBatch.batchId}/mapping`);
  assert.equal(after.payload.mapping.mapping_version, 1);
  const idem = await pool.query("select count(*)::int count from material_import_idempotency where route_scope=$1", [`IMPORT_MAPPING_CURRENT:${rollbackBatch.batchId}`]);
  assert.equal(idem.rows[0].count, 0);
});
