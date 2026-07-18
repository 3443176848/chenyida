import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";

import { confirmMaterialImportMapping, getMaterialImportMapping, previewMaterialImportMapping } from "../app/lib/material-import/mapping-service.ts";
import { dryRunMaterialImportDraftGeneration } from "../app/lib/material-import/draft-generation-service.ts";
import {
  MaterialImportNormalizationTaskHandler,
  startMaterialImportNormalization,
} from "../app/lib/material-import/normalization-service.ts";
import { MemoryMaterialImportObjectStore } from "../app/lib/material-import/object-store.ts";
import { MATERIAL_IMPORT_PARSER_VERSION } from "../app/lib/material-import/parser-model.ts";
import { MaterialImportParserTaskHandler, queueMaterialImportParse } from "../app/lib/material-import/parser-service.ts";
import {
  InMemoryMaterialImportTaskScheduler,
  MaterialImportOutboxDispatcher,
} from "../app/lib/material-import/task-scheduler.ts";
import { splitD1MigrationStatements } from "../scripts/d1-migration-statements.mjs";
import { adaptiveTemplateSignatureFromHeaderPaths } from "../app/lib/material-import/adaptive-import.ts";

const siteRoot = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const fixedNow = new Date("2026-07-18T09:00:00.000Z");
let sequence = 0;

async function apply(DB, name) {
  const sql = await readFile(join(siteRoot, "drizzle", name), "utf8");
  await DB.batch(splitD1MigrationStatements(sql).map((statement) => DB.prepare(statement)));
}

async function fixture(lines = [
  "供应商物料报价表,,,,",
  "物料信息,物料信息,规格信息,规格信息,采购信息",
  "料号,品名,型号,长度,单位",
  "A-001,连接器,MX-10,20mm,PCS",
  "A-002,电容,C0402,0.5mm,PCS",
  "料号,品名,型号,长度,单位",
  "小计,2,,,",
  "合计,2,,,",
  "审核：,,,,",
  "",
], profile = null) {
  sequence += 1;
  const mf = new Miniflare({
    modules: true,
    script: "export default {}",
    compatibilityDate: "2026-05-22",
    d1Databases: { DB: `adaptive-import-runtime-${sequence}` },
  });
  const { DB } = await mf.getBindings();
  for (const migration of [
    "0000_far_nightmare.sql",
    "0001_material_master_v2.sql",
    "0002_material_draft_review_api.sql",
    "0003_material_draft_lifecycle.sql",
    "0004_material_import_batch_foundation.sql",
    "0005_material_import_parser_mapping.sql",
    "0006_material_import_normalization.sql",
    "0007_material_library.sql",
    "0008_supplier_adaptive_import.sql",
  ]) await apply(DB, migration);
  const now = fixedNow.toISOString();
  await DB.prepare(
    "INSERT INTO app_users(username,display_name,role,password_hash,is_active,must_change_password,version,created_at,updated_at) VALUES('owner','Owner','manager','test',1,0,1,?,?)",
  ).bind(now, now).run();
  if (profile) {
    const signature = adaptiveTemplateSignatureFromHeaderPaths(profile.headerPaths, profile.headerSpan);
    const fingerprintBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signature));
    const fingerprint = [...new Uint8Array(fingerprintBytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    await DB.prepare(
      `INSERT INTO material_import_supplier_profiles(
        supplier_key,profile_name,template_fingerprint,field_aliases_json,mapping_rules_json,
        created_by,updated_by,created_at,updated_at
      ) VALUES('SUPPLIER-A','历史模板',?,'{}',?,'owner','owner',?,?)`,
    ).bind(fingerprint, JSON.stringify({ preferred_mappings: { material_name: ["物料信息/品名"] } }), now, now).run();
  }
  const objectStore = new MemoryMaterialImportObjectStore();
  const bytes = new TextEncoder().encode(lines.join("\n"));
  const stored = await objectStore.putIfAbsent({
    key: "test/adaptive-materials.csv",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    contentType: "text/csv",
  });
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  await DB.prepare(
    "INSERT INTO material_import_batches(id,batch_no,source_kind,status,created_by,current_version,file_count,total_rows,accepted_rows,rejected_rows,created_at,updated_at) VALUES(1,'MIB-ADAPTIVE-RUNTIME','CSV','FILE_READY','owner',1,1,0,0,0,?,?)",
  ).bind(now, now).run();
  await DB.prepare(
    `INSERT INTO material_import_files(
      id,batch_id,object_key,original_filename,filename_extension,declared_mime_type,
      declared_sha256,declared_size_bytes,detected_file_type,actual_sha256,actual_size_bytes,
      object_etag,storage_status,security_check_status,uploaded_at,created_at,updated_at
    ) VALUES(1,1,'test/adaptive-materials.csv','adaptive-materials.csv','.csv','text/csv',
      ?,?,'CSV',?,?,?,'STORED','BASIC_CHECK_PASSED',?,?,?)`,
  ).bind(hash, bytes.length, hash, bytes.length, stored.metadata.etag, now, now, now).run();
  return { mf, DB, objectStore };
}

async function drainParser(DB, objectStore) {
  const scheduler = new InMemoryMaterialImportTaskScheduler();
  const dispatcher = new MaterialImportOutboxDispatcher(DB, scheduler, () => new Date(fixedNow));
  const handler = new MaterialImportParserTaskHandler({ database: DB, objectStore, clock: () => new Date(fixedNow) });
  await dispatcher.dispatch();
  await scheduler.drain(handler);
  await dispatcher.dispatch();
  await scheduler.drain(handler);
}

async function drainNormalization(DB) {
  const scheduler = new InMemoryMaterialImportTaskScheduler();
  const dispatcher = new MaterialImportOutboxDispatcher(DB, scheduler, () => new Date(fixedNow));
  const handler = new MaterialImportNormalizationTaskHandler(DB, undefined, () => new Date(fixedNow));
  for (let round = 0; round < 8; round += 1) {
    await dispatcher.dispatch();
    await scheduler.drain(handler);
    if ((await DB.prepare("SELECT status FROM material_import_batches WHERE id=1").first()).status === "NORMALIZED") return;
  }
  assert.fail("normalization did not publish");
}

test("adaptive runtime crosses parser, profile-assisted multi-row mapping, confirmation, and normalization", { timeout: 60_000 }, async () => {
  const context = await fixture(undefined, {
    headerSpan: 2,
    headerPaths: ["物料信息/料号", "物料信息/品名", "规格信息/型号", "规格信息/长度", "采购信息/单位"],
  });
  try {
    await queueMaterialImportParse(context.DB, {
      batchId: 1,
      username: "owner",
      canReadAny: false,
      expectedVersion: 1,
      parserVersion: MATERIAL_IMPORT_PARSER_VERSION,
      idempotencyKey: "adaptive-runtime-parse",
      requestId: "adaptive-parse",
    }, () => new Date(fixedNow));
    await drainParser(context.DB, context.objectStore);

    const preparation = await context.DB.prepare(
      "SELECT b.status batch_status,r.mapping_preparation_status,r.mapping_preparation_failure_code,r.mapping_preparation_safe_message FROM material_import_batches b JOIN material_import_parse_runs r ON r.id=b.current_parse_run_id WHERE b.id=1",
    ).first();
    assert.equal(preparation.mapping_preparation_status, "READY", JSON.stringify(preparation));
    const aggregate = await getMaterialImportMapping(context.DB, 1, { username: "owner", canReadAny: false });
    assert.equal(aggregate.payload.mapping.header_start_row_number, 2);
    assert.equal(aggregate.payload.mapping.header_row_number, 3);
    assert.equal(aggregate.payload.mapping.data_start_row_number, 4);
    assert.equal(aggregate.payload.mapping.suggestion_algorithm_version, "adaptive-supplier-v1");
    assert.equal(aggregate.payload.mapping.supplier_profile_id, 1);
    assert.ok(aggregate.payload.mapping.items.some((item) => item.mapping_evidence.includes("SUPPLIER_PROFILE_MATCH")));
    const specification = aggregate.payload.mapping.items.find((item) => item.target_code === "SUPPLIER_SPECIFICATION");
    assert.deepEqual(specification.source_column_indexes, [2, 3]);
    assert.equal(specification.combination_strategy, "JOIN_NON_EMPTY");

    const preview = await previewMaterialImportMapping(context.DB, 1, {
      username: "owner",
      canReadAny: false,
      expectedVersion: aggregate.payload.current_version,
      parseRunId: aggregate.payload.mapping.parse_run_id,
      draft: {
        selected_sheet_index: aggregate.payload.mapping.selected_sheet_index,
        header_mode: aggregate.payload.mapping.header_mode,
        header_row_number: aggregate.payload.mapping.header_row_number,
        items: aggregate.payload.mapping.items,
      },
      startRow: aggregate.payload.mapping.data_start_row_number,
      rowLimit: 1,
      idempotencyKey: "adaptive-runtime-preview",
      requestId: "adaptive-preview",
    }, () => new Date(fixedNow));
    const specificationPreview = preview.payload.rows[0].values.find((item) => item.target_code === "SUPPLIER_SPECIFICATION");
    assert.equal(specificationPreview.candidate_value, "MX-10 20mm");

    const confirmed = await confirmMaterialImportMapping(context.DB, 1, {
      username: "owner",
      canReadAny: false,
      expectedVersion: aggregate.payload.current_version,
      parseRunId: aggregate.payload.mapping.parse_run_id,
      mappingId: aggregate.payload.mapping.id,
      expectedMappingVersion: aggregate.payload.mapping.mapping_version,
      metadataDigest: aggregate.payload.mapping.metadata_digest,
      idempotencyKey: "adaptive-runtime-confirm",
      requestId: "adaptive-confirm",
    }, () => new Date(fixedNow));
    assert.equal(confirmed.payload.batch_status, "MAPPING_CONFIRMED");

    await startMaterialImportNormalization(context.DB, {
      batchId: 1,
      username: "owner",
      canReadAny: false,
      canNormalize: true,
      expectedVersion: confirmed.payload.current_version,
      processorVersion: "adaptive-normalizer-v1",
      idempotencyKey: "adaptive-runtime-normalize",
      requestId: "adaptive-normalize",
    }, () => new Date(fixedNow));
    await drainNormalization(context.DB);

    const allRows = (await context.DB.prepare(
      "SELECT source_row_number,normalized_payload_json,mapped_values_json,mapping_confidence,specification_confidence,adaptive_mapping_status,review_status FROM material_import_normalized_rows ORDER BY source_row_number",
    ).all()).results;
    const rows = allRows.filter((row) => row.review_status !== "REJECTED");
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.source_row_number), [4, 5]);
    assert.equal(JSON.parse(rows[0].normalized_payload_json).supplier_reference.SUPPLIER_SPECIFICATION.candidate, "MX-10 20mm");
    const canonical = JSON.parse(rows[0].normalized_payload_json).canonical_import;
    assert.equal(canonical.source_file_id, 1);
    assert.equal(canonical.source_sheet_name, "__CSV__");
    assert.equal(canonical.source_row_number, 4);
    assert.equal(canonical.supplier_id, "SUPPLIER-A");
    assert.equal(canonical.supplier_profile_id, 1);
    assert.equal(canonical.raw_material_name, "连接器");
    assert.equal(canonical.raw_model, "MX-10");
    assert.equal(canonical.raw_specification, "MX-10 20mm");
    assert.equal(canonical.raw_values_reference.raw_row_hash.length, 64);
    assert.equal("raw_values_json" in canonical, false);
    assert.ok(JSON.parse(rows[0].mapped_values_json).supplier_reference.SUPPLIER_SPECIFICATION);
    assert.ok(rows[0].mapping_confidence > 0);
    assert.ok(rows[0].specification_confidence > 0);
    assert.equal(rows[0].adaptive_mapping_status, "EXACT");
    assert.equal(rows[0].review_status, "AUTO_ACCEPTABLE");
    assert.equal(allRows.length, 6);
    assert.deepEqual(allRows.filter((row) => row.review_status === "REJECTED").map((row) => JSON.parse(row.normalized_payload_json).row_classification.kind), ["REPEATED_HEADER", "SUBTOTAL", "TOTAL", "FOOTER"]);
    assert.equal((await context.DB.prepare("SELECT COUNT(*) count FROM material_import_rows").first()).count, 9);
    assert.deepEqual((await context.DB.prepare("PRAGMA foreign_key_check").all()).results, []);
  } finally {
    await context.mf.dispose();
  }
});

test("adaptive normalization blocks a draft when no specification evidence exists", { timeout: 60_000 }, async () => {
  const context = await fixture([
    "供应商物料清单,,",
    "料号,品名,单位",
    "A-100,普通物料,PCS",
    "",
  ]);
  try {
    await queueMaterialImportParse(context.DB, {
      batchId: 1,
      username: "owner",
      canReadAny: false,
      expectedVersion: 1,
      parserVersion: MATERIAL_IMPORT_PARSER_VERSION,
      idempotencyKey: "adaptive-missing-spec-parse",
      requestId: "missing-spec-parse",
    }, () => new Date(fixedNow));
    await drainParser(context.DB, context.objectStore);
    const aggregate = await getMaterialImportMapping(context.DB, 1, { username: "owner", canReadAny: false });
    assert.equal(aggregate.payload.mapping.items.some((item) => item.target_code === "SUPPLIER_SPECIFICATION"), false);
    const confirmed = await confirmMaterialImportMapping(context.DB, 1, {
      username: "owner",
      canReadAny: false,
      expectedVersion: aggregate.payload.current_version,
      parseRunId: aggregate.payload.mapping.parse_run_id,
      mappingId: aggregate.payload.mapping.id,
      expectedMappingVersion: aggregate.payload.mapping.mapping_version,
      metadataDigest: aggregate.payload.mapping.metadata_digest,
      idempotencyKey: "adaptive-missing-spec-confirm",
      requestId: "missing-spec-confirm",
    }, () => new Date(fixedNow));
    await startMaterialImportNormalization(context.DB, {
      batchId: 1,
      username: "owner",
      canReadAny: false,
      canNormalize: true,
      expectedVersion: confirmed.payload.current_version,
      processorVersion: "adaptive-normalizer-v1",
      idempotencyKey: "adaptive-missing-spec-normalize",
      requestId: "missing-spec-normalize",
    }, () => new Date(fixedNow));
    await drainNormalization(context.DB);
    assert.deepEqual(
      await context.DB.prepare("SELECT row_status,error_count,review_status,specification_confidence FROM material_import_normalized_rows").first(),
      { row_status: "ERROR", error_count: 1, review_status: "NEEDS_REVIEW", specification_confidence: 0 },
    );
    assert.ok(await context.DB.prepare(
      "SELECT id FROM material_import_normalization_issues WHERE issue_code='NORMALIZATION_SPECIFICATION_REVIEW_REQUIRED'",
    ).first());
    const dryRun = await dryRunMaterialImportDraftGeneration(context.DB, {
      batchId: 1,
      username: "owner",
      canReadAny: false,
      requestId: "missing-spec-dry-run",
    });
    assert.equal(dryRun.payload.items[0].ready, false);
    assert.ok(dryRun.payload.items[0].issues.some((item) => item.code === "IMPORT_NORMALIZATION_ROW_INVALID"));
    assert.equal((await context.DB.prepare("SELECT COUNT(*) count FROM material_master").first()).count, 0);
  } finally {
    await context.mf.dispose();
  }
});
