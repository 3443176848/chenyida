import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";

import {
  InMemoryMaterialImportTaskScheduler,
  MaterialImportOutboxDispatcher,
} from "../app/lib/material-import/task-scheduler.ts";
import {
  MaterialImportNormalizationTaskHandler,
  startMaterialImportNormalization,
} from "../app/lib/material-import/normalization-service.ts";
import { MaterialImportMappingMetadataSnapshotService } from "../app/lib/material-import/mapping-target-registry.ts";
import {
  approveMaterialImportNormalization,
  commitMaterialImportDraftGeneration,
  dryRunMaterialImportDraftGeneration,
  inspectMaterialImportDraftGeneration,
  reportMaterialImportDraftGeneration,
} from "../app/lib/material-import/draft-generation-service.ts";
import { handleMaterialImportApi } from "../app/lib/material-import/handler.ts";
import { splitD1MigrationStatements } from "../scripts/d1-migration-statements.mjs";

const siteRoot = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const fixedNow = new Date("2026-07-18T06:00:00.000Z");
let sequence = 0;

async function apply(DB, name) {
  const sql = await readFile(join(siteRoot, "drizzle", name), "utf8");
  await DB.batch(splitD1MigrationStatements(sql).map((statement) => DB.prepare(statement)));
}

function rawRow(name = "标准电阻", unit = "PCS") {
  return JSON.stringify({
    schema_version: 1,
    source_column_count: 2,
    cells: [
      { column_index: 0, type: "TEXT", raw_value: name },
      { column_index: 1, type: "TEXT", raw_value: unit },
    ],
  });
}

async function fixture() {
  sequence += 1;
  const mf = new Miniflare({
    modules: true,
    script: "export default {}",
    compatibilityDate: "2026-05-22",
    d1Databases: { DB: `material-import-drafts-${sequence}` },
  });
  const { DB } = await mf.getBindings();
  for (const migration of [
    "0000_far_nightmare.sql", "0001_material_master_v2.sql", "0002_material_draft_review_api.sql",
    "0003_material_draft_lifecycle.sql", "0004_material_import_batch_foundation.sql",
    "0005_material_import_parser_mapping.sql", "0006_material_import_normalization.sql",
    "0007_material_library.sql",
  ]) await apply(DB, migration);
  const now = fixedNow.toISOString();
  await DB.batch([
    DB.prepare("INSERT INTO app_users(username,display_name,role,password_hash,is_active,must_change_password,version,created_at,updated_at) VALUES('owner','Owner','manager','test',1,0,1,?,?)").bind(now, now),
    DB.prepare("INSERT INTO app_users(username,display_name,role,password_hash,is_active,must_change_password,version,created_at,updated_at) VALUES('buyer','Buyer','purchase','test',1,0,1,?,?)").bind(now, now),
    DB.prepare("INSERT INTO material_categories(id,category_code,category_name_cn,parent_id,category_level,status,created_by,updated_by,request_id) VALUES(1,'ROOT','根',NULL,1,'ACTIVE','owner','owner','seed')"),
    DB.prepare("INSERT INTO material_categories(id,category_code,category_name_cn,parent_id,category_level,status,created_by,updated_by,request_id) VALUES(2,'ELEC','电子料',1,2,'ACTIVE','owner','owner','seed')"),
    DB.prepare("INSERT INTO material_categories(id,category_code,category_name_cn,parent_id,category_level,status,created_by,updated_by,request_id) VALUES(3,'RES','电阻',2,3,'ACTIVE','owner','owner','seed')"),
    DB.prepare("INSERT INTO material_categories(id,category_code,category_name_cn,parent_id,category_level,status,created_by,updated_by,request_id) VALUES(4,'RES_GENERAL','普通电阻',3,4,'ACTIVE','owner','owner','seed')"),
    DB.prepare("INSERT INTO material_attribute_definitions(id,attribute_code,attribute_name_cn,data_type,decimal_scale,canonical_unit,allowed_values_json,normalization_rule,status,version,created_by,updated_by,request_id) VALUES(1,'NOTE','备注','TEXT',0,'','[]','NONE','ACTIVE',1,'owner','owner','seed')"),
    DB.prepare("INSERT INTO material_category_attributes(category_id,attribute_definition_id,is_required,is_unique_key_component,is_searchable,sort_order,status,created_by,updated_by,request_id) VALUES(4,1,0,0,1,1,'ACTIVE','owner','owner','seed')"),
  ]);
  await DB.prepare(`
    INSERT INTO material_master(
      id,standard_name,category_id,brand,manufacturer,manufacturer_part_number,base_uom,
      material_status,procurement_type,inventory_type,lot_control_required,inspection_type,
      environmental_requirement,source_type,source_ref,version,last_modified_by,
      created_by,updated_by,request_id
    ) VALUES(10,'标准电阻',4,'','', '', 'PCS','DRAFT','PURCHASE','STOCKED',0,'NONE',
      'UNSPECIFIED','MANUAL','manual:10',1,'owner','owner','owner','existing')
  `).run();
  const snapshot = await new MaterialImportMappingMetadataSnapshotService(DB).current();
  await DB.prepare("INSERT INTO material_import_batches(id,batch_no,source_kind,status,created_by,current_version,file_count,total_rows,accepted_rows,rejected_rows,created_at,updated_at) VALUES(1,'MIB-DRAFT-1','CSV','CREATED','owner',1,1,1,0,0,?,?)").bind(now, now).run();
  await DB.prepare(`
    INSERT INTO material_import_files(
      id,batch_id,object_key,original_filename,filename_extension,declared_sha256,
      declared_size_bytes,detected_file_type,actual_sha256,actual_size_bytes,object_etag,
      storage_status,security_check_status,uploaded_at,created_at,updated_at
    ) VALUES(1,1,'test/material.csv','material.csv','.csv',?,10,'CSV',?,10,'etag',
      'STORED','BASIC_CHECK_PASSED',?,?,?)
  `).bind("a".repeat(64), "a".repeat(64), now, now, now).run();
  await DB.prepare("INSERT INTO material_import_parse_runs(id,batch_id,parser_version,run_status,attempt_no,current_stage,rows_written,mapping_preparation_status,completed_at,created_at,updated_at) VALUES(1,1,'parser-v1','SUCCEEDED',1,'COMPLETE',1,'READY',?,?,?)").bind(now, now, now).run();
  await DB.prepare("UPDATE material_import_batches SET status='MAPPING_CONFIRMED',current_parse_run_id=1,current_version=2 WHERE id=1").run();
  await DB.prepare("INSERT INTO material_import_mappings(id,batch_id,parse_run_id,selected_sheet_index,header_mode,mapping_status,mapping_version,metadata_digest,created_by,updated_by,confirmed_by,created_at,updated_at,confirmed_at) VALUES(1,1,1,0,'NO_HEADER','CONFIRMED',1,?,'owner','owner','owner',?,?,?)").bind(snapshot.metadataDigest, now, now, now).run();
  const defaults = [
    ["basic", "PURCHASE_TYPE", "PURCHASE"],
    ["basic", "INVENTORY_TYPE", "STOCKED"],
    ["basic", "INSPECTION_TYPE", "NONE"],
    ["basic", "ENVIRONMENTAL_REQUIREMENT", "UNSPECIFIED"],
    ["category_hint", "CATEGORY_HINT", "RES_GENERAL"],
  ];
  await DB.batch([
    DB.prepare("INSERT INTO material_import_mapping_items(mapping_id,source_column_index,source_header,target_namespace,target_code,mapping_mode,required,display_order) VALUES(1,0,'name','basic','STANDARD_NAME','SOURCE',1,0)"),
    DB.prepare("INSERT INTO material_import_mapping_items(mapping_id,source_column_index,source_header,target_namespace,target_code,mapping_mode,required,display_order) VALUES(1,1,'unit','basic','UNIT','SOURCE',1,1)"),
    ...defaults.map(([namespace, code, value], index) => DB.prepare("INSERT INTO material_import_mapping_items(mapping_id,source_column_index,source_header,target_namespace,target_code,mapping_mode,default_value_json,required,display_order) VALUES(1,NULL,'',?,?,'DEFAULT',?,0,?)").bind(namespace, code, JSON.stringify(value), index + 2)),
    DB.prepare("INSERT INTO material_import_rows(id,batch_id,parse_run_id,sheet_index,sheet_name,row_number,raw_values_json,raw_row_hash,created_at) VALUES(1,1,1,0,'Sheet1',1,?,?,?)").bind(rawRow(), "b".repeat(64), now),
  ]);
  await startMaterialImportNormalization(DB, {
    batchId: 1,
    username: "owner",
    canReadAny: false,
    canNormalize: true,
    expectedVersion: 2,
    processorVersion: "normalizer-v1",
    idempotencyKey: "draft-generation-normalization",
    requestId: "normalize",
  }, () => new Date(fixedNow));
  const scheduler = new InMemoryMaterialImportTaskScheduler();
  const dispatcher = new MaterialImportOutboxDispatcher(DB, scheduler, () => new Date(fixedNow));
  const handler = new MaterialImportNormalizationTaskHandler(DB, undefined, () => new Date(fixedNow));
  for (let round = 0; round < 8; round += 1) {
    await dispatcher.dispatch();
    await scheduler.drain(handler);
    if ((await DB.prepare("SELECT status FROM material_import_batches WHERE id=1").first()).status === "NORMALIZED") break;
  }
  assert.equal((await DB.prepare("SELECT status FROM material_import_batches WHERE id=1").first()).status, "NORMALIZED");
  return { mf, DB };
}

async function updateCurrentNormalizedPayload(DB, mutate) {
  const row = await DB.prepare(
    "SELECT id,normalized_payload_json FROM material_import_normalized_rows WHERE normalization_run_id=(SELECT current_normalization_run_id FROM material_import_batches WHERE id=1)",
  ).first();
  const payload = JSON.parse(row.normalized_payload_json);
  mutate(payload);
  await DB.prepare(
    "UPDATE material_import_normalized_rows SET normalized_payload_json=? WHERE id=?",
  ).bind(JSON.stringify(payload), row.id).run();
}

test("approved normalization creates a traceable DRAFT and persists duplicate candidates", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    const inspect = await inspectMaterialImportDraftGeneration(context.DB, { batchId: 1, username: "owner", canReadAny: false });
    assert.equal(inspect.payload.approval, null);
    const dryRun = await dryRunMaterialImportDraftGeneration(context.DB, { batchId: 1, username: "owner", canReadAny: false, requestId: "dry-run" });
    assert.equal(dryRun.payload.items[0].ready, true, JSON.stringify(dryRun.payload.items[0]));
    assert.equal(dryRun.payload.items[0].category.status, "EXACT");
    assert.equal(dryRun.payload.items[0].base_unit.status, "EXACT");
    assert.equal(dryRun.payload.items[0].brand.status, "NOT_PROVIDED");
    assert.equal(dryRun.payload.items[0].duplicate_candidates[0].matchLevel, "POSSIBLE");

    await assert.rejects(
      approveMaterialImportNormalization(context.DB, {
        batchId: 1, username: "buyer", canReadAny: true, canCommit: false,
        expectedVersion: inspect.payload.current_version, resultDigest: inspect.payload.result_digest,
        acceptWarnings: false, rawKey: "buyer-approval-denied", requestId: "denied",
      }),
      (error) => error.code === "FORBIDDEN",
    );
    const approval = await approveMaterialImportNormalization(context.DB, {
      batchId: 1, username: "owner", canReadAny: false, canCommit: true,
      expectedVersion: inspect.payload.current_version, resultDigest: inspect.payload.result_digest,
      acceptWarnings: false, rawKey: "owner-approval-approved", requestId: "approve",
      clock: () => new Date(fixedNow),
    });
    assert.ok(Number.isSafeInteger(approval.payload.approval_id));

    const committed = await commitMaterialImportDraftGeneration(context.DB, {
      batchId: 1, username: "owner", canReadAny: false, canCommit: true,
      expectedVersion: inspect.payload.current_version, rawKey: "owner-draft-commit-1",
      requestId: "commit", clock: () => new Date(fixedNow),
    });
    assert.equal(committed.payload.items[0].status, "CREATED", JSON.stringify(committed.payload.items[0]));
    const materialId = committed.payload.items[0].material_id;
    assert.deepEqual(
      await context.DB.prepare(`
        SELECT material_status,internal_material_code,source_type,source_import_batch_id,
          source_import_file_id,source_import_row_id,base_unit_id
        FROM material_master WHERE id=?
      `).bind(materialId).first(),
      {
        material_status: "DRAFT",
        internal_material_code: null,
        source_type: "MATERIAL_IMPORT",
        source_import_batch_id: 1,
        source_import_file_id: 1,
        source_import_row_id: 1,
        base_unit_id: 1,
      },
    );
    assert.equal((await context.DB.prepare("SELECT COUNT(*) count FROM material_import_draft_links WHERE material_id=?").bind(materialId).first()).count, 1);
    assert.equal((await context.DB.prepare("SELECT match_level FROM material_duplicate_candidates WHERE draft_material_id=?").bind(materialId).first()).match_level, "POSSIBLE");
    assert.deepEqual((await context.DB.prepare("PRAGMA foreign_key_check").all()).results, []);

    const report = await reportMaterialImportDraftGeneration(context.DB, { batchId: 1, username: "owner", canReadAny: false });
    assert.equal(report.payload.items[0].material_status, "DRAFT");
    assert.equal(report.payload.items[0].source_import_row_id, 1);
  } finally {
    await context.mf.dispose();
  }
});

test("EXACT duplicate candidates block dry-run and cannot create a DRAFT", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    await updateCurrentNormalizedPayload(context.DB, (payload) => {
      payload.basic.manufacturer = {
        target_code: "basic.MANUFACTURER",
        source: { kind: "DEFAULT_VALUE", value_state: "PRESENT", raw_value: "ACME" },
        candidate: "ACME",
        status: "VALID",
      };
      payload.basic.manufacturer_part_number = {
        target_code: "basic.MANUFACTURER_PART_NUMBER",
        source: { kind: "DEFAULT_VALUE", value_state: "PRESENT", raw_value: "MPN-1" },
        candidate: "MPN-1",
        status: "VALID",
      };
    });
    await context.DB.prepare(
      "UPDATE material_master SET manufacturer='ACME',manufacturer_part_number='MPN-1' WHERE id=10",
    ).run();

    const inspected = await inspectMaterialImportDraftGeneration(context.DB, {
      batchId: 1,
      username: "owner",
      canReadAny: false,
    });
    const dryRun = await dryRunMaterialImportDraftGeneration(context.DB, {
      batchId: 1,
      username: "owner",
      canReadAny: false,
      requestId: "dry-run-exact",
    });
    assert.equal(dryRun.payload.items[0].ready, false);
    assert.equal(dryRun.payload.items[0].duplicate_candidates[0].matchLevel, "EXACT");
    assert.equal(
      dryRun.payload.items[0].issues.some((issue) => issue.code === "IMPORT_DUPLICATE_EXACT_BLOCKED"),
      true,
    );

    await approveMaterialImportNormalization(context.DB, {
      batchId: 1,
      username: "owner",
      canReadAny: false,
      canCommit: true,
      expectedVersion: inspected.payload.current_version,
      resultDigest: inspected.payload.result_digest,
      acceptWarnings: false,
      rawKey: "owner-approval-exact-duplicate",
      requestId: "approve-exact",
      clock: () => new Date(fixedNow),
    });
    const committed = await commitMaterialImportDraftGeneration(context.DB, {
      batchId: 1,
      username: "owner",
      canReadAny: false,
      canCommit: true,
      expectedVersion: inspected.payload.current_version,
      rawKey: "owner-commit-exact-duplicate",
      requestId: "commit-exact",
      clock: () => new Date(fixedNow),
    });
    assert.equal(committed.payload.items[0].status, "BLOCKED");
    assert.equal(
      (await context.DB.prepare("SELECT COUNT(*) count FROM material_import_draft_links").first()).count,
      0,
    );
  } finally {
    await context.mf.dispose();
  }
});

test("HIGH_CONFIDENCE duplicate candidates require review and block DRAFT creation", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    await updateCurrentNormalizedPayload(context.DB, (payload) => {
      payload.basic.manufacturer = {
        target_code: "basic.MANUFACTURER",
        source: { kind: "DEFAULT_VALUE", value_state: "PRESENT", raw_value: "OTHER" },
        candidate: "OTHER",
        status: "VALID",
      };
      payload.basic.manufacturer_part_number = {
        target_code: "basic.MANUFACTURER_PART_NUMBER",
        source: { kind: "DEFAULT_VALUE", value_state: "PRESENT", raw_value: "MPN-2" },
        candidate: "MPN-2",
        status: "VALID",
      };
    });
    await context.DB.prepare(
      "UPDATE material_master SET manufacturer='ACME',manufacturer_part_number='MPN-2' WHERE id=10",
    ).run();
    const dryRun = await dryRunMaterialImportDraftGeneration(context.DB, {
      batchId: 1,
      username: "owner",
      canReadAny: false,
      requestId: "dry-run-high",
    });
    assert.equal(dryRun.payload.items[0].ready, false);
    assert.equal(dryRun.payload.items[0].duplicate_candidates[0].matchLevel, "HIGH_CONFIDENCE");
    assert.equal(
      dryRun.payload.items[0].issues.some((issue) => issue.code === "IMPORT_DUPLICATE_CONFIRMATION_REQUIRED"),
      true,
    );
  } finally {
    await context.mf.dispose();
  }
});

test("category names, unit aliases and brand aliases are governed without creating metadata", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    await context.DB.batch([
      context.DB.prepare("INSERT INTO brands(id,code,standard_name,normalized_name,enabled) VALUES(1,'SCHNEIDER','施耐德','施耐德',1)"),
      context.DB.prepare("INSERT INTO brand_aliases(brand_id,alias,normalized_alias) VALUES(1,'Schneider Electric','SCHNEIDER ELECTRIC')"),
    ]);
    await updateCurrentNormalizedPayload(context.DB, (payload) => {
      payload.category_hint.candidate = "普通电阻";
      payload.basic.unit.candidate = "个";
      payload.basic.brand = {
        target_code: "basic.BRAND",
        source: { kind: "DEFAULT_VALUE", value_state: "PRESENT", raw_value: "Schneider Electric" },
        candidate: "Schneider Electric",
        status: "VALID",
      };
    });
    const dryRun = await dryRunMaterialImportDraftGeneration(context.DB, {
      batchId: 1,
      username: "owner",
      canReadAny: false,
      requestId: "dry-run-governance",
    });
    assert.equal(dryRun.payload.items[0].category.status, "MATCHED");
    assert.equal(dryRun.payload.items[0].base_unit.status, "MATCHED");
    assert.equal(dryRun.payload.items[0].brand.status, "MATCHED");
    assert.equal(dryRun.payload.items[0].brand.reason, "ALIAS");
    assert.equal(dryRun.payload.items[0].ready, true, JSON.stringify(dryRun.payload.items[0]));
    assert.equal((await context.DB.prepare("SELECT COUNT(*) count FROM brands").first()).count, 1);
    assert.equal((await context.DB.prepare("SELECT COUNT(*) count FROM units").first()).count, 5);
  } finally {
    await context.mf.dispose();
  }
});

test("draft generation is request-idempotent and row-idempotent", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    const inspect = await inspectMaterialImportDraftGeneration(context.DB, { batchId: 1, username: "owner", canReadAny: false });
    const approvalInput = {
      batchId: 1, username: "owner", canReadAny: false, canCommit: true,
      expectedVersion: inspect.payload.current_version, resultDigest: inspect.payload.result_digest,
      acceptWarnings: false, rawKey: "approval-idempotency-key", requestId: "approve",
      clock: () => new Date(fixedNow),
    };
    const firstApproval = await approveMaterialImportNormalization(context.DB, approvalInput);
    const replayApproval = await approveMaterialImportNormalization(context.DB, approvalInput);
    assert.equal(replayApproval.replayed, true);
    assert.equal(replayApproval.payload.approval_id, firstApproval.payload.approval_id);

    const commitInput = {
      batchId: 1, username: "owner", canReadAny: false, canCommit: true,
      expectedVersion: inspect.payload.current_version, rawKey: "draft-idempotency-key",
      requestId: "commit", clock: () => new Date(fixedNow),
    };
    const first = await commitMaterialImportDraftGeneration(context.DB, commitInput);
    const replay = await commitMaterialImportDraftGeneration(context.DB, commitInput);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.payload.items, first.payload.items);
    const resumed = await commitMaterialImportDraftGeneration(context.DB, { ...commitInput, rawKey: "draft-idempotency-key-2" });
    assert.equal(resumed.payload.items[0].status, "ALREADY_CREATED");
    assert.equal((await context.DB.prepare("SELECT COUNT(*) count FROM material_import_draft_links").first()).count, 1);
    assert.equal((await context.DB.prepare("SELECT COUNT(*) count FROM material_master WHERE source_type='MATERIAL_IMPORT'").first()).count, 1);
  } finally {
    await context.mf.dispose();
  }
});

test("draft generation HTTP routes enforce capability and CSRF before creating DRAFT", { timeout: 30_000 }, async () => {
  const context = await fixture();
  let canCommit = false;
  const dependencies = {
    database: context.DB,
    currentUser: async () => ({ username: "owner", role: "manager", must_change_password: false }),
    userCan: (_user, permission) => permission === "material.import.read"
      || (permission === "material.import.commit" && canCommit),
    clock: () => new Date(fixedNow),
  };
  const call = async (path, { method = "GET", body, key, csrf = true } = {}) => {
    const headers = new Headers();
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (key) headers.set("Idempotency-Key", key);
    if (csrf) {
      headers.set("Origin", "http://local.test");
      headers.set("Cookie", "CYD_ERP_CSRF=material-library-csrf");
      headers.set("X-CSRF-Token", "material-library-csrf");
    }
    const response = await handleMaterialImportApi(new Request(`http://local.test${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), dependencies);
    return { response, payload: JSON.parse(await response.text()) };
  };
  try {
    const inspected = await call("/api/material-master/import-batches/1/draft-generation?mode=inspect");
    assert.equal(inspected.response.status, 200);
    const body = {
      expected_version: inspected.payload.current_version,
      result_digest: inspected.payload.result_digest,
      accept_warnings: false,
    };
    const forbidden = await call("/api/material-master/import-batches/1/normalization/approve", {
      method: "POST", body, key: "http-approval-forbidden",
    });
    assert.equal(forbidden.response.status, 403);
    canCommit = true;
    const csrfFailure = await call("/api/material-master/import-batches/1/normalization/approve", {
      method: "POST", body, key: "http-approval-csrf-failure", csrf: false,
    });
    assert.equal(csrfFailure.response.status, 403);
    const approved = await call("/api/material-master/import-batches/1/normalization/approve", {
      method: "POST", body, key: "http-approval-success",
    });
    assert.equal(approved.response.status, 200, JSON.stringify(approved.payload));
    const committed = await call("/api/material-master/import-batches/1/drafts", {
      method: "POST",
      key: "http-draft-success",
      body: { expected_version: inspected.payload.current_version, after_row_id: 0, limit: 20 },
    });
    assert.equal(committed.response.status, 200, JSON.stringify(committed.payload));
    assert.equal(committed.payload.items[0].material_status, "DRAFT");
  } finally {
    await context.mf.dispose();
  }
});
