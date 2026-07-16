import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { load as parseYaml } from "js-yaml";
import { Miniflare } from "miniflare";

import { MaterialImportMappingMetadataSnapshotService } from "../app/lib/material-import/mapping-target-registry.ts";
import { handleMaterialImportApi } from "../app/lib/material-import/handler.ts";
import { MATERIAL_IMPORT_NORMALIZATION_LIMITS, MaterialImportRowNormalizer } from "../app/lib/material-import/normalization-model.ts";
import { MATERIAL_ROLE_PERMISSIONS } from "../app/lib/material-api/security.ts";
import {
  getMaterialImportNormalization,
  getMaterialImportNormalizedRow,
  listMaterialImportNormalizationIssues,
  listMaterialImportNormalizedRows,
  MaterialImportNormalizationTaskHandler,
  startMaterialImportNormalization,
} from "../app/lib/material-import/normalization-service.ts";
import { InMemoryMaterialImportTaskScheduler, MaterialImportOutboxDispatcher } from "../app/lib/material-import/task-scheduler.ts";
import { cancelMaterialImportBatch } from "../app/lib/material-import/service.ts";
import { splitD1MigrationStatements } from "../scripts/d1-migration-statements.mjs";

const siteRoot = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const fixedNow = new Date("2026-07-17T04:00:00.000Z");
let sequence = 0;

async function apply(DB, migration) {
  const sql = await readFile(join(siteRoot, "drizzle", migration), "utf8");
  await DB.batch(splitD1MigrationStatements(sql).map((statement) => DB.prepare(statement)));
}

function cell(column, type, raw) {
  return { column_index: column, column_ref: `${String.fromCharCode(65 + column)}1`, type, source_type: type, raw_value: raw, display: raw, format_code: null };
}

function rawRow(...cells) {
  return JSON.stringify({ schema_version: 1, source_column_count: 2, cells });
}

function target(namespace, code, valueType, options = {}) {
  return {
    group_code: namespace === "attribute" ? "ATTRIBUTE" : namespace === "basic" ? "BASIC" : "SPECIAL",
    target_namespace: namespace,
    target_code: code,
    display_name: code,
    description: "",
    value_type: valueType,
    required_for_confirm: options.required ?? false,
    mapping_modes: ["SOURCE", "SOURCE_WITH_DEFAULT", "DEFAULT"],
    default_value_policy: { allowed: true, allowed_json_types: ["STRING", "SAFE_INTEGER", "BOOLEAN", "NULL"] },
    unit_policy: options.unitPolicy ?? { mode: "NOT_APPLICABLE", canonical_unit: null, allowed_units: [] },
    value_constraints: { decimal_scale: options.decimalScale ?? null, enum_values: options.enumValues ?? [], normalization_rule: "NONE" },
    enabled: options.enabled ?? true,
    selectable: options.selectable ?? true,
    constraints: [],
    display_order: options.order ?? 1,
  };
}

test("row normalizer independently applies strict scalar, default, formula, date, and attribute rules", async () => {
  const targets = [
    target("basic", "STANDARD_NAME", "TEXT", { required: true }),
    target("basic", "UNIT", "TEXT", { required: true }),
    target("basic", "LOT_CONTROL", "BOOLEAN"),
    target("basic", "SHELF_LIFE_DAYS", "INTEGER"),
    target("basic", "PURCHASE_TYPE", "ENUM", { enumValues: ["PURCHASE"] }),
    target("category_hint", "CATEGORY_HINT", "TEXT"),
    target("supplier_reference", "SUPPLIER_ITEM_CODE", "TEXT"),
    target("attribute", "DECIMAL_ATTR", "DECIMAL", { decimalScale: 2, unitPolicy: { mode: "CANONICAL", canonical_unit: "mm", allowed_units: ["mm"] } }),
    target("attribute", "DATE_ATTR", "DATE"),
    target("attribute", "DISABLED_ATTR", "TEXT", { enabled: false, selectable: false }),
  ];
  const snapshot = { algorithm: "material-import-mapping-metadata-v1", targets, metadataDigest: "a".repeat(64), searchProjectionDigest: "b".repeat(64), targetByKey: new Map(targets.map((item) => [`${item.target_namespace}\u0000${item.target_code}`, item])) };
  const mappingItems = [
    { source_column_index: 0, target_namespace: "basic", target_code: "STANDARD_NAME", mapping_mode: "SOURCE", default_value: null, required: true, display_order: 0 },
    { source_column_index: 1, target_namespace: "basic", target_code: "UNIT", mapping_mode: "SOURCE_WITH_DEFAULT", default_value: "PCS", required: true, display_order: 1 },
    { source_column_index: 2, target_namespace: "basic", target_code: "LOT_CONTROL", mapping_mode: "SOURCE", default_value: null, required: false, display_order: 2 },
    { source_column_index: 3, target_namespace: "basic", target_code: "SHELF_LIFE_DAYS", mapping_mode: "SOURCE", default_value: null, required: false, display_order: 3 },
    { source_column_index: 4, target_namespace: "basic", target_code: "PURCHASE_TYPE", mapping_mode: "SOURCE", default_value: null, required: false, display_order: 4 },
    { source_column_index: 5, target_namespace: "category_hint", target_code: "CATEGORY_HINT", mapping_mode: "SOURCE", default_value: null, required: false, display_order: 5 },
    { source_column_index: 6, target_namespace: "supplier_reference", target_code: "SUPPLIER_ITEM_CODE", mapping_mode: "SOURCE", default_value: null, required: false, display_order: 6 },
    { source_column_index: 7, target_namespace: "attribute", target_code: "DECIMAL_ATTR", mapping_mode: "SOURCE", default_value: null, required: false, display_order: 7 },
    { source_column_index: 8, target_namespace: "attribute", target_code: "DATE_ATTR", mapping_mode: "SOURCE", default_value: null, required: false, display_order: 8 },
    { source_column_index: 9, target_namespace: "attribute", target_code: "DISABLED_ATTR", mapping_mode: "SOURCE", default_value: null, required: false, display_order: 9 },
    { source_column_index: 10, target_namespace: "ignore", target_code: "IGNORE", mapping_mode: "IGNORE", default_value: null, required: false, display_order: 10 },
  ];
  const raw = { schema_version: 1, source_column_count: 11, cells: [
    cell(0, "TEXT", "00123"), cell(1, "EMPTY", null), cell(2, "TEXT", "yes"), cell(3, "TEXT", "12.5"), cell(4, "TEXT", "purch"),
    { ...cell(5, "FORMULA", "=A1"), formula: "A1", cached_value: "ignored" }, { ...cell(6, "ERROR", "#VALUE!") }, cell(7, "NUMBER", "1.234"),
    { ...cell(8, "DATE", "45292"), interpretation_status: "INTERPRETED", interpreted_iso_value: "2024-01-01" }, cell(9, "TEXT", "x"), cell(10, "TEXT", "ignored"),
  ] };
  const result = await new MaterialImportRowNormalizer().normalize({ lineage: { batch_id: 1, parse_run_id: 2, normalization_run_id: 3, mapping_id: 4, mapping_version: 5, mapping_digest: "c".repeat(64), metadata_digest: "a".repeat(64), processor_version: "v1", sheet_index: 0, row_number: 2, raw_row_hash: "d".repeat(64) }, rawRow: raw, mappingItems, metadataSnapshot: snapshot });
  assert.equal(result.normalized_payload.basic.standard_name.candidate, "00123");
  assert.equal(result.normalized_payload.basic.unit.candidate, "PCS");
  assert.equal(result.normalized_payload.basic.unit.source.kind, "DEFAULT_VALUE");
  assert.equal(result.normalized_payload.attributes.DATE_ATTR.candidate, "2024-01-01");
  assert.equal(result.normalized_payload.row_status, "ERROR");
  const codes = new Set(result.issues.map((item) => item.issue_code));
  for (const code of ["NORMALIZATION_BOOLEAN_INVALID", "NORMALIZATION_NUMBER_INVALID", "NORMALIZATION_ENUM_INVALID", "NORMALIZATION_FORMULA_NOT_EXECUTED", "NORMALIZATION_SOURCE_ERROR_CELL", "NORMALIZATION_ATTRIBUTE_DISABLED"]) assert.ok(codes.has(code), code);
  assert.equal("IGNORE" in result.normalized_payload, false);
  assert.equal(result.normalized_payload.lineage.normalization_run_id, 3);
});

test("normalization OpenAPI 3.1 exposes exactly the five approved operations", async () => {
  const document = parseYaml(await readFile(join(siteRoot, "..", "docs", "material-master", "material-import-normalization-v1.openapi.yaml"), "utf8"));
  assert.equal(document.openapi, "3.1.0");
  assert.equal(document.info.version, "1.0.0");
  const operations = Object.values(document.paths).flatMap((path) => Object.keys(path).filter((method) => ["get", "post", "put", "patch", "delete"].includes(method)));
  assert.equal(operations.length, 5);
  assert.ok(document.paths["/api/material-master/import-batches/{batchId}/normalize"].post);
  assert.ok(document.paths["/api/material-master/import-batches/{batchId}/normalization"].get);
  assert.ok(document.paths["/api/material-master/import-batches/{batchId}/normalized-rows/{rowId}"].get);
});

test("normalize capability is explicit and never implied by read_any", () => {
  for (const role of ["admin", "manager"]) assert.ok(MATERIAL_ROLE_PERMISSIONS[role].includes("material.import.normalize"));
  for (const role of ["purchase", "engineering", "production", "warehouse", "quality", "sales", "finance", "operations"]) assert.equal(MATERIAL_ROLE_PERMISSIONS[role].includes("material.import.normalize"), false, role);
  assert.ok(MATERIAL_ROLE_PERMISSIONS.admin.includes("material.import.read_any"));
});

test("row normalizer distinguishes missing, blank text, invalid defaults, and caps issues", async () => {
  const definition = target("basic", "STANDARD_NAME", "TEXT", { required: true });
  const snapshot = { algorithm: "material-import-mapping-metadata-v1", targets: [definition], metadataDigest: "a".repeat(64), searchProjectionDigest: "b".repeat(64), targetByKey: new Map([["basic\u0000STANDARD_NAME", definition]]) };
  const lineage = { batch_id: 1, parse_run_id: 2, normalization_run_id: 3, mapping_id: 4, mapping_version: 5, mapping_digest: "c".repeat(64), metadata_digest: "a".repeat(64), processor_version: "v1", sheet_index: 0, row_number: 2, raw_row_hash: "d".repeat(64) };
  const missingItems = Array.from({ length: 25 }, (_, index) => ({ source_column_index: index + 20, target_namespace: "basic", target_code: "STANDARD_NAME", mapping_mode: "SOURCE", default_value: null, required: true, display_order: index }));
  const capped = await new MaterialImportRowNormalizer().normalize({ lineage, rawRow: { schema_version: 1, source_column_count: 1, cells: [] }, mappingItems: missingItems, metadataSnapshot: snapshot });
  assert.equal(capped.issues.length, 20);
  assert.equal(capped.issues.at(-1).issue_code, "NORMALIZATION_ISSUE_LIMIT_EXCEEDED");
  const blank = await new MaterialImportRowNormalizer().normalize({ lineage, rawRow: { schema_version: 1, source_column_count: 1, cells: [cell(0, "TEXT", "   ")] }, mappingItems: [{ source_column_index: 0, target_namespace: "basic", target_code: "STANDARD_NAME", mapping_mode: "SOURCE_WITH_DEFAULT", default_value: "fallback", required: true, display_order: 0 }], metadataSnapshot: snapshot });
  assert.equal(blank.issues[0].issue_code, "NORMALIZATION_BLANK_VALUE");
  assert.equal(blank.normalized_payload.basic.standard_name.source.kind, "SOURCE_COLUMN");
  const badDefault = await new MaterialImportRowNormalizer().normalize({ lineage, rawRow: { schema_version: 1, source_column_count: 0, cells: [] }, mappingItems: [{ source_column_index: null, target_namespace: "basic", target_code: "STANDARD_NAME", mapping_mode: "DEFAULT", default_value: 123, required: true, display_order: 0 }], metadataSnapshot: snapshot });
  assert.equal(badDefault.issues[0].issue_code, "NORMALIZATION_DEFAULT_INVALID");
});

test("row normalizer covers warning, unit metadata, text safety, and payload bounds", async () => {
  const lineage = { batch_id: 1, parse_run_id: 2, normalization_run_id: 3, mapping_id: 4, mapping_version: 5, mapping_digest: "c".repeat(64), metadata_digest: "a".repeat(64), processor_version: "v1", sheet_index: 0, row_number: 2, source_row_number: 2, raw_row_hash: "d".repeat(64) };
  const normalize = async (definitions, mappingItems, cells) => {
    const snapshot = { algorithm: "material-import-mapping-metadata-v1", targets: definitions, metadataDigest: "a".repeat(64), searchProjectionDigest: "b".repeat(64), targetByKey: new Map(definitions.map((item) => [`${item.target_namespace}\u0000${item.target_code}`, item])) };
    return new MaterialImportRowNormalizer().normalize({ lineage, rawRow: { schema_version: 1, source_column_count: cells.length, cells }, mappingItems, metadataSnapshot: snapshot });
  };
  const source = (namespace, code, column = 0) => ({ source_column_index: column, target_namespace: namespace, target_code: code, mapping_mode: "SOURCE", default_value: null, required: false, display_order: column });

  const valid = await normalize([target("basic", "STANDARD_NAME", "TEXT")], [source("basic", "STANDARD_NAME")], [cell(0, "TEXT", "Resistor")]);
  assert.equal(valid.row_status, "VALID");
  const boolean = await normalize([target("basic", "LOT_CONTROL", "BOOLEAN")], [source("basic", "LOT_CONTROL")], [cell(0, "BOOLEAN", true)]);
  assert.equal(boolean.normalized_payload.basic.lot_control.candidate, true);
  const special = await normalize(
    [target("category_hint", "CATEGORY_HINT", "TEXT"), target("supplier_reference", "SUPPLIER_ITEM_CODE", "TEXT")],
    [source("category_hint", "CATEGORY_HINT", 0), source("supplier_reference", "SUPPLIER_ITEM_CODE", 1)],
    [cell(0, "TEXT", "Resistor"), cell(1, "TEXT", "SUP-001")],
  );
  assert.equal(special.normalized_payload.category_hint.candidate, "Resistor");
  assert.equal(special.normalized_payload.supplier_reference.SUPPLIER_ITEM_CODE.candidate, "SUP-001");
  const warning = await normalize([target("basic", "BRAND", "TEXT")], [source("basic", "BRAND")], [cell(0, "TEXT", "UNKNOWN")]);
  assert.equal(warning.row_status, "WARNING");
  assert.equal(warning.issues[0].issue_code, "NORMALIZATION_BRAND_UNKNOWN");
  const empty = await normalize([target("basic", "BRAND", "TEXT")], [source("basic", "BRAND")], [cell(0, "EMPTY", null)]);
  assert.equal(empty.normalized_payload.basic.brand.source.value_state, "EMPTY");

  const missingUnit = target("attribute", "MISSING_UNIT", "DECIMAL", { unitPolicy: { mode: "CANONICAL", canonical_unit: null, allowed_units: [] } });
  const invalidUnit = target("attribute", "INVALID_UNIT", "DECIMAL", { unitPolicy: { mode: "CANONICAL", canonical_unit: "mm", allowed_units: ["cm"] } });
  const units = await normalize([missingUnit, invalidUnit], [source("attribute", "MISSING_UNIT", 0), source("attribute", "INVALID_UNIT", 1)], [cell(0, "NUMBER", "1"), cell(1, "NUMBER", "2")]);
  assert.deepEqual(new Set(units.issues.map((item) => item.issue_code)), new Set(["NORMALIZATION_ATTRIBUTE_UNIT_REQUIRED", "NORMALIZATION_ATTRIBUTE_UNIT_INVALID"]));

  const malicious = `<script>${"x".repeat(2_100)}</script>`;
  const longText = await normalize([target("supplier_reference", "SUPPLIER_SPECIFICATION", "TEXT")], [source("supplier_reference", "SUPPLIER_SPECIFICATION")], [cell(0, "TEXT", malicious)]);
  assert.equal(longText.issues[0].issue_code, "NORMALIZATION_TEXT_TOO_LONG");
  assert.equal(JSON.stringify(longText.issues).includes("<script>"), false);

  const count = 140;
  const definitions = Array.from({ length: count }, (_, index) => target("attribute", `LARGE_${index}`, "TEXT"));
  const items = definitions.map((definition, index) => source("attribute", definition.target_code, index));
  const cells = definitions.map((_, index) => cell(index, "TEXT", "x".repeat(2_048)));
  const oversized = await normalize(definitions, items, cells);
  assert.equal(oversized.issues[0].issue_code, "NORMALIZATION_ROW_TOO_LARGE");
  assert.ok(oversized.normalized_payload_bytes <= MATERIAL_IMPORT_NORMALIZATION_LIMITS.maxRowPayloadBytes);
});

async function fixture() {
  sequence += 1;
  const mf = new Miniflare({ modules: true, script: "export default {}", compatibilityDate: "2026-05-22", d1Databases: { DB: `normalization-${sequence}` } });
  const { DB } = await mf.getBindings();
  for (const migration of ["0000_far_nightmare.sql", "0001_material_master_v2.sql", "0002_material_draft_review_api.sql", "0003_material_draft_lifecycle.sql", "0004_material_import_batch_foundation.sql", "0005_material_import_parser_mapping.sql", "0006_material_import_normalization.sql"]) await apply(DB, migration);
  const now = fixedNow.toISOString();
  await DB.prepare("INSERT INTO app_users(username,display_name,role,password_hash,is_active,must_change_password,version,created_at,updated_at) VALUES('owner','Owner','manager','test',1,0,1,?,?)").bind(now, now).run();
  const snapshot = await new MaterialImportMappingMetadataSnapshotService(DB).current();
  await DB.prepare("INSERT INTO material_import_batches(id,batch_no,source_kind,status,created_by,current_version,file_count,total_rows,accepted_rows,rejected_rows,created_at,updated_at) VALUES(1,'MIB-NORMALIZE-1','CSV','CREATED','owner',1,0,3,0,0,?,?)").bind(now, now).run();
  await DB.prepare("INSERT INTO material_import_parse_runs(id,batch_id,parser_version,run_status,attempt_no,current_stage,rows_written,mapping_preparation_status,completed_at,created_at,updated_at) VALUES(1,1,'parser-v1','SUCCEEDED',1,'COMPLETE',3,'READY',?,?,?)").bind(now, now, now).run();
  await DB.prepare("UPDATE material_import_batches SET status='MAPPING_CONFIRMED',current_parse_run_id=1,current_version=2 WHERE id=1").run();
  await DB.prepare("INSERT INTO material_import_mappings(id,batch_id,parse_run_id,selected_sheet_index,header_mode,header_row_number,mapping_status,mapping_version,metadata_digest,created_by,updated_by,confirmed_by,created_at,updated_at,confirmed_at) VALUES(1,1,1,0,'SINGLE_ROW',1,'CONFIRMED',1,?,'owner','owner','owner',?,?,?)").bind(snapshot.metadataDigest, now, now, now).run();
  await DB.batch([
    DB.prepare("INSERT INTO material_import_mapping_items(mapping_id,source_column_index,source_header,target_namespace,target_code,mapping_mode,required,display_order) VALUES(1,0,'name','basic','STANDARD_NAME','SOURCE',1,0)"),
    DB.prepare("INSERT INTO material_import_mapping_items(mapping_id,source_column_index,source_header,target_namespace,target_code,mapping_mode,required,display_order) VALUES(1,1,'unit','basic','UNIT','SOURCE_WITH_DEFAULT',1,1)"),
    DB.prepare("INSERT INTO material_import_rows(batch_id,parse_run_id,sheet_index,sheet_name,row_number,raw_values_json,raw_row_hash,created_at) VALUES(1,1,0,'Sheet1',1,?,? ,?)").bind(rawRow(cell(0, "TEXT", "name"), cell(1, "TEXT", "unit")), "1".repeat(64), now),
    DB.prepare("INSERT INTO material_import_rows(batch_id,parse_run_id,sheet_index,sheet_name,row_number,raw_values_json,raw_row_hash,created_at) VALUES(1,1,0,'Sheet1',2,?,? ,?)").bind(rawRow(cell(0, "TEXT", "  Resistor  "), cell(1, "TEXT", "PCS")), "2".repeat(64), now),
    DB.prepare("INSERT INTO material_import_rows(batch_id,parse_run_id,sheet_index,sheet_name,row_number,raw_values_json,raw_row_hash,created_at) VALUES(1,1,0,'Sheet1',3,?,? ,?)").bind(rawRow(cell(0, "TEXT", "   "), cell(1, "EMPTY", null)), "3".repeat(64), now),
  ]);
  return { mf, DB };
}

async function drainNormalization(DB) {
  const scheduler = new InMemoryMaterialImportTaskScheduler();
  const dispatcher = new MaterialImportOutboxDispatcher(DB, scheduler, () => new Date(fixedNow));
  const handler = new MaterialImportNormalizationTaskHandler(DB, undefined, () => new Date(fixedNow));
  for (let round = 0; round < 8; round += 1) {
    await dispatcher.dispatch();
    await scheduler.drain(handler);
    const batch = await DB.prepare("SELECT status FROM material_import_batches WHERE id=1").first();
    if (batch.status === "NORMALIZED") return;
  }
  assert.fail("normalization did not reach NORMALIZED");
}

test("normalization stages every data row and atomically publishes one stable pointer", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    const started = await startMaterialImportNormalization(context.DB, { batchId: 1, username: "owner", canReadAny: false, canNormalize: true, expectedVersion: 2, processorVersion: "normalizer-v1", idempotencyKey: "normalization-flow-key-0001", requestId: "normalize-start" }, () => new Date(fixedNow));
    assert.equal(started.status, 202);
    const replay = await startMaterialImportNormalization(context.DB, { batchId: 1, username: "owner", canReadAny: false, canNormalize: true, expectedVersion: 2, processorVersion: "normalizer-v1", idempotencyKey: "normalization-flow-key-0001", requestId: "normalize-replay" }, () => new Date(fixedNow));
    assert.equal(replay.replayed, true);

    await drainNormalization(context.DB);
    const status = await getMaterialImportNormalization(context.DB, 1, { username: "owner", canReadAny: false });
    assert.equal(status.payload.batch_status, "NORMALIZED");
    assert.equal(status.payload.current_run.run_status, "SUCCEEDED");
    assert.equal(status.payload.current_run.processed_rows, 2);
    assert.equal(status.payload.current_run.valid_rows, 1);
    assert.equal(status.payload.current_run.error_rows, 1);

    const rows = await listMaterialImportNormalizedRows(context.DB, 1, { username: "owner", canReadAny: false, limit: 1 });
    assert.equal(rows.payload.items.length, 1);
    assert.ok(rows.payload.next_cursor);
    const next = await listMaterialImportNormalizedRows(context.DB, 1, { username: "owner", canReadAny: false, limit: 1, cursor: rows.payload.next_cursor });
    assert.equal(next.payload.items.length, 1);
    const detail = await getMaterialImportNormalizedRow(context.DB, 1, rows.payload.items[0].id, { username: "owner", canReadAny: false });
    assert.equal(detail.payload.normalized_payload.lineage.normalization_run_id, started.payload.normalization_run_id);
    assert.equal(detail.payload.normalized_payload.basic.standard_name.candidate, "Resistor");
    assert.deepEqual(detail.payload.normalized_payload.deferred_validation, ["CATEGORY_ASSIGNMENT_REQUIRED", "CATEGORY_BOUND_ATTRIBUTE_VALIDATION_REQUIRED", "MATERIAL_VALIDATION_NOT_RUN"]);

    const issues = await listMaterialImportNormalizationIssues(context.DB, 1, { username: "owner", canReadAny: false, issueLevel: "ERROR", limit: 20 });
    assert.ok(issues.payload.items.some((item) => item.issue_code === "NORMALIZATION_BLANK_VALUE"));
    assert.equal((await context.DB.prepare("SELECT COUNT(*) count FROM material_master").first()).count, 0);
    assert.deepEqual((await context.DB.prepare("PRAGMA foreign_key_check").all()).results, []);
  } finally { await context.mf.dispose(); }
});

test("normalization preserves the prior pointer until a different-version rerun publishes", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    await startMaterialImportNormalization(context.DB, { batchId: 1, username: "owner", canReadAny: false, canNormalize: true, expectedVersion: 2, processorVersion: "normalizer-v1", idempotencyKey: "normalization-first-key", requestId: "first" }, () => new Date(fixedNow));
    await drainNormalization(context.DB);
    const first = await context.DB.prepare("SELECT current_version,current_normalization_run_id FROM material_import_batches WHERE id=1").first();
    const rerun = await startMaterialImportNormalization(context.DB, { batchId: 1, username: "owner", canReadAny: false, canNormalize: true, expectedVersion: first.current_version, processorVersion: "normalizer-v2", rerunReason: "processor upgrade", idempotencyKey: "normalization-rerun-key", requestId: "rerun" }, () => new Date(fixedNow));
    const queued = await context.DB.prepare("SELECT status,current_normalization_run_id FROM material_import_batches WHERE id=1").first();
    assert.equal(queued.status, "QUEUED_FOR_NORMALIZATION");
    assert.equal(queued.current_normalization_run_id, first.current_normalization_run_id);
    await drainNormalization(context.DB);
    const published = await context.DB.prepare("SELECT status,current_normalization_run_id FROM material_import_batches WHERE id=1").first();
    assert.equal(published.current_normalization_run_id, rerun.payload.normalization_run_id);
    assert.equal((await context.DB.prepare("SELECT run_status FROM material_import_normalization_runs WHERE id=?").bind(first.current_normalization_run_id).first()).run_status, "SUPERSEDED");
  } finally { await context.mf.dispose(); }
});

test("cancelling a first normalization revokes the lease and removes unpublished staging", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    await startMaterialImportNormalization(context.DB, { batchId: 1, username: "owner", canReadAny: false, canNormalize: true, expectedVersion: 2, processorVersion: "normalizer-v1", idempotencyKey: "normalization-cancel-start", requestId: "start" }, () => new Date(fixedNow));
    const scheduler = new InMemoryMaterialImportTaskScheduler();
    const dispatcher = new MaterialImportOutboxDispatcher(context.DB, scheduler, () => new Date(fixedNow));
    const handler = new MaterialImportNormalizationTaskHandler(context.DB, undefined, () => new Date(fixedNow));
    await dispatcher.dispatch(); await scheduler.drain(handler);
    await dispatcher.dispatch(); await scheduler.drain(handler);
    assert.ok((await context.DB.prepare("SELECT COUNT(*) count FROM material_import_normalized_rows").first()).count > 0);
    const batch = await context.DB.prepare("SELECT current_version FROM material_import_batches WHERE id=1").first();
    await cancelMaterialImportBatch({ database: context.DB, objectStore: { async putIfAbsent() { throw new Error("unused"); }, async head() { return null; }, async open() { return null; }, async delete() {} }, clock: () => new Date(fixedNow) }, { batchId: 1, user: { username: "owner", role: "manager", must_change_password: false }, canReadAny: false, rawKey: "normalization-cancel-key", requestId: "cancel", expectedVersion: batch.current_version, reasonCode: "USER_CANCELLED" });
    assert.deepEqual(await context.DB.prepare("SELECT status,current_normalization_run_id FROM material_import_batches WHERE id=1").first(), { status: "CANCELLED", current_normalization_run_id: null });
    assert.equal((await context.DB.prepare("SELECT run_status FROM material_import_normalization_runs").first()).run_status, "CANCELLED");
    assert.equal((await context.DB.prepare("SELECT COUNT(*) count FROM material_import_normalized_rows").first()).count, 0);
    assert.equal((await context.DB.prepare("SELECT COUNT(*) count FROM material_import_normalization_issues").first()).count, 0);
  } finally { await context.mf.dispose(); }
});

test("the five normalization APIs enforce capability, CSRF, bounded reads, and rate limits", { timeout: 30_000 }, async () => {
  const context = await fixture();
  const csrf = "normalization-csrf";
  let canNormalize = false;
  const dependencies = {
    database: context.DB,
    currentUser: async () => ({ username: "owner", role: "manager", must_change_password: false }),
    userCan: (_user, permission) => permission === "material.import.read" || (permission === "material.import.normalize" && canNormalize),
    clock: () => new Date(fixedNow),
  };
  const call = async (path, { method = "GET", body, key, csrfEnabled = true } = {}) => {
    const headers = new Headers();
    if (csrfEnabled) { headers.set("Origin", "http://local.test"); headers.set("Cookie", `CYD_ERP_CSRF=${csrf}`); headers.set("X-CSRF-Token", csrf); }
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (key) headers.set("Idempotency-Key", key);
    const response = await handleMaterialImportApi(new Request(`http://local.test${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), dependencies);
    return { response, payload: JSON.parse(await response.text()) };
  };
  try {
    const forbidden = await call("/api/material-master/import-batches/1/normalize", { method: "POST", key: "api-normalize-forbidden", body: { expected_version: 2, processor_version: "normalizer-v1" } });
    assert.equal(forbidden.response.status, 403);
    const hidden = await call("/api/material-master/import-batches/999/normalize", { method: "POST", key: "api-normalize-hidden", body: { expected_version: 2, processor_version: "normalizer-v1" } });
    assert.equal(hidden.response.status, 404);
    canNormalize = true;
    const csrfFailure = await call("/api/material-master/import-batches/1/normalize", { method: "POST", key: "api-normalize-csrf", csrfEnabled: false, body: { expected_version: 2, processor_version: "normalizer-v1" } });
    assert.equal(csrfFailure.response.status, 403);
    const start = await call("/api/material-master/import-batches/1/normalize", { method: "POST", key: "api-normalize-start", body: { expected_version: 2, processor_version: "normalizer-v1" } });
    assert.equal(start.response.status, 202, JSON.stringify(start.payload));
    await drainNormalization(context.DB);
    assert.equal((await call("/api/material-master/import-batches/1/normalization")).response.status, 200);
    const rows = await call("/api/material-master/import-batches/1/normalized-rows?limit=1");
    assert.equal(rows.response.status, 200);
    assert.equal(rows.payload.items.length, 1);
    assert.equal((await call(`/api/material-master/import-batches/1/normalized-rows/${rows.payload.items[0].id}`)).response.status, 200);
    assert.equal((await call("/api/material-master/import-batches/1/normalization-issues?issue_level=ERROR&limit=20")).response.status, 200);
    assert.equal((await call("/api/material-master/import-batches/1/normalized-rows?limit=101")).response.status, 400);

    const limitedDependencies = { ...dependencies, importReadRateLimit: 1 };
    const limitedCall = async () => handleMaterialImportApi(new Request("http://local.test/api/material-master/import-batches/1/normalization"), limitedDependencies);
    await context.DB.prepare("DELETE FROM audit_log WHERE route_code='MATERIAL_IMPORT_NORMALIZATION_READ'").run();
    assert.equal((await limitedCall()).status, 200);
    const limited = await limitedCall();
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("Retry-After"), "60");
  } finally { await context.mf.dispose(); }
});

test("normalization rejects invalid state and the 50,000-row resource boundary", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    const input = { batchId: 1, username: "owner", canReadAny: false, canNormalize: true, expectedVersion: 2, processorVersion: "normalizer-v1", idempotencyKey: "normalization-state-limit", requestId: "state-limit" };
    await context.DB.prepare("UPDATE material_import_batches SET status='PARSED' WHERE id=1").run();
    await assert.rejects(startMaterialImportNormalization(context.DB, input, () => new Date(fixedNow)), (error) => error.code === "IMPORT_NORMALIZATION_NOT_ALLOWED");
    await context.DB.prepare("UPDATE material_import_batches SET status='MAPPING_CONFIRMED' WHERE id=1").run();
    const rowJson = rawRow(cell(0, "TEXT", "bulk"), cell(1, "TEXT", "PCS"));
    await context.DB.prepare(`WITH RECURSIVE seq(row_number) AS (
      VALUES(4) UNION ALL SELECT row_number + 1 FROM seq WHERE row_number < 50002
    ) INSERT INTO material_import_rows(batch_id,parse_run_id,sheet_index,sheet_name,row_number,raw_values_json,raw_row_hash,created_at)
      SELECT 1,1,0,'Sheet1',row_number,?,printf('%064x',row_number),? FROM seq`).bind(rowJson, fixedNow.toISOString()).run();
    await assert.rejects(startMaterialImportNormalization(context.DB, { ...input, idempotencyKey: "normalization-row-limit" }, () => new Date(fixedNow)), (error) => error.code === "IMPORT_NORMALIZATION_LIMIT_EXCEEDED");
  } finally { await context.mf.dispose(); }
});

test("normalization freezes metadata and parse lineage before worker execution", { timeout: 30_000 }, async () => {
  const metadataContext = await fixture();
  try {
    const started = await startMaterialImportNormalization(metadataContext.DB, { batchId: 1, username: "owner", canReadAny: false, canNormalize: true, expectedVersion: 2, processorVersion: "normalizer-v1", idempotencyKey: "normalization-metadata-freeze", requestId: "metadata" }, () => new Date(fixedNow));
    await metadataContext.DB.prepare(`INSERT INTO material_attribute_definitions(attribute_code,attribute_name_cn,data_type,decimal_scale,canonical_unit,allowed_values_json,normalization_rule,status,version,created_by,updated_by,request_id)
      VALUES('NEW_AFTER_QUEUE','排队后新增','TEXT',0,'','[]','NONE','ACTIVE',1,'owner','owner','metadata-change')`).run();
    const handler = new MaterialImportNormalizationTaskHandler(metadataContext.DB, undefined, () => new Date(fixedNow));
    assert.equal(await handler.handle({ jobId: "metadata", batchId: 1, normalizationRunId: started.payload.normalization_run_id, jobType: "START_NORMALIZATION", payloadVersion: 1 }), "ACK");
    assert.deepEqual(await metadataContext.DB.prepare("SELECT run_status,failure_code FROM material_import_normalization_runs WHERE id=?").bind(started.payload.normalization_run_id).first(), { run_status: "FAILED", failure_code: "IMPORT_NORMALIZATION_METADATA_CHANGED" });
  } finally { await metadataContext.mf.dispose(); }

  const parseContext = await fixture();
  try {
    const started = await startMaterialImportNormalization(parseContext.DB, { batchId: 1, username: "owner", canReadAny: false, canNormalize: true, expectedVersion: 2, processorVersion: "normalizer-v1", idempotencyKey: "normalization-parse-freeze", requestId: "parse" }, () => new Date(fixedNow));
    const now = fixedNow.toISOString();
    await parseContext.DB.prepare("INSERT INTO material_import_parse_runs(id,batch_id,parser_version,run_status,attempt_no,current_stage,rows_written,mapping_preparation_status,completed_at,created_at,updated_at) VALUES(2,1,'parser-v2','SUCCEEDED',1,'COMPLETE',0,'READY',?,?,?)").bind(now, now, now).run();
    await parseContext.DB.prepare("UPDATE material_import_batches SET current_parse_run_id=2 WHERE id=1").run();
    const handler = new MaterialImportNormalizationTaskHandler(parseContext.DB, undefined, () => new Date(fixedNow));
    assert.equal(await handler.handle({ jobId: "parse", batchId: 1, normalizationRunId: started.payload.normalization_run_id, jobType: "START_NORMALIZATION", payloadVersion: 1 }), "ACK");
    assert.deepEqual(await parseContext.DB.prepare("SELECT run_status,failure_code FROM material_import_normalization_runs WHERE id=?").bind(started.payload.normalization_run_id).first(), { run_status: "FAILED", failure_code: "IMPORT_NORMALIZATION_MAPPING_STALE" });
  } finally { await parseContext.mf.dispose(); }
});

test("chunk replay is idempotent and a publish CAS race cannot switch the pointer", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    const started = await startMaterialImportNormalization(context.DB, { batchId: 1, username: "owner", canReadAny: false, canNormalize: true, expectedVersion: 2, processorVersion: "normalizer-v1", idempotencyKey: "normalization-chunk-publish-race", requestId: "race" }, () => new Date(fixedNow));
    const runId = started.payload.normalization_run_id;
    const handler = new MaterialImportNormalizationTaskHandler(context.DB, undefined, () => new Date(fixedNow));
    assert.equal(await handler.handle({ jobId: "start", batchId: 1, normalizationRunId: runId, jobType: "START_NORMALIZATION", payloadVersion: 1 }), "ACK");
    const chunk = { jobId: "chunk", batchId: 1, normalizationRunId: runId, jobType: "NORMALIZE_ROW_CHUNK", payloadVersion: 1, afterRowNumber: 0 };
    assert.equal(await handler.handle(chunk), "ACK");
    const firstCounts = {
      rows: (await context.DB.prepare("SELECT COUNT(*) count FROM material_import_normalized_rows WHERE normalization_run_id=?").bind(runId).first()).count,
      issues: (await context.DB.prepare("SELECT COUNT(*) count FROM material_import_normalization_issues WHERE normalization_run_id=?").bind(runId).first()).count,
    };
    assert.equal(await handler.handle(chunk), "ACK");
    assert.deepEqual(firstCounts, { rows: 2, issues: 2 });
    assert.equal((await context.DB.prepare("SELECT COUNT(*) count FROM material_import_normalized_rows WHERE normalization_run_id=?").bind(runId).first()).count, firstCounts.rows);
    assert.equal((await context.DB.prepare("SELECT COUNT(*) count FROM material_import_normalization_issues WHERE normalization_run_id=?").bind(runId).first()).count, firstCounts.issues);
    assert.equal(await handler.handle({ jobId: "verify", batchId: 1, normalizationRunId: runId, jobType: "VERIFY_NORMALIZATION", payloadVersion: 1 }), "ACK");
    await context.DB.prepare("UPDATE material_import_batches SET current_version=current_version+1 WHERE id=1").run();
    assert.equal(await handler.handle({ jobId: "publish", batchId: 1, normalizationRunId: runId, jobType: "PUBLISH_NORMALIZATION", payloadVersion: 1 }), "ACK");
    assert.deepEqual(await context.DB.prepare("SELECT current_normalization_run_id FROM material_import_batches WHERE id=1").first(), { current_normalization_run_id: null });
    assert.deepEqual(await context.DB.prepare("SELECT run_status,failure_code FROM material_import_normalization_runs WHERE id=?").bind(runId).first(), { run_status: "FAILED", failure_code: "IMPORT_NORMALIZATION_VERSION_CONFLICT" });
  } finally { await context.mf.dispose(); }
});

test("normalization API converts unexpected failures to a safe 500 envelope", async () => {
  const database = { prepare() { throw new Error("SQL secret stack should not escape"); } };
  const response = await handleMaterialImportApi(new Request("http://local.test/api/material-master/import-batches/1/normalization"), {
    database,
    currentUser: async () => ({ username: "owner", role: "manager", must_change_password: false }),
    userCan: () => true,
    clock: () => new Date(fixedNow),
  });
  const body = await response.text();
  assert.equal(response.status, 500);
  assert.equal(body.includes("SQL secret stack"), false);
  assert.equal(JSON.parse(body).error.code, "INTERNAL_ERROR");
});

test("duplicate delivery is absorbed and a changed frozen Mapping cannot publish", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    const started = await startMaterialImportNormalization(context.DB, { batchId: 1, username: "owner", canReadAny: false, canNormalize: true, expectedVersion: 2, processorVersion: "normalizer-v1", idempotencyKey: "normalization-frozen-mapping", requestId: "start" }, () => new Date(fixedNow));
    await assert.rejects(startMaterialImportNormalization(context.DB, { batchId: 1, username: "owner", canReadAny: false, canNormalize: true, expectedVersion: 2, processorVersion: "normalizer-v2", idempotencyKey: "normalization-frozen-mapping", requestId: "conflict" }, () => new Date(fixedNow)), (error) => error.code === "IDEMPOTENCY_CONFLICT");
    const outbox = await context.DB.prepare("SELECT id FROM material_import_job_outbox WHERE normalization_run_id=? AND job_type='START_NORMALIZATION'").bind(started.payload.normalization_run_id).first();
    const task = { jobId: outbox.id, batchId: 1, normalizationRunId: started.payload.normalization_run_id, jobType: "START_NORMALIZATION", payloadVersion: 1 };
    const handler = new MaterialImportNormalizationTaskHandler(context.DB, undefined, () => new Date(fixedNow));
    assert.equal(await handler.handle(task), "ACK");
    assert.equal(await handler.handle(task), "ACK");
    assert.equal((await context.DB.prepare("SELECT lease_token_digest FROM material_import_normalization_runs WHERE id=?").bind(started.payload.normalization_run_id).first()).lease_token_digest, null);
    await context.DB.prepare("UPDATE material_import_mapping_items SET required=0 WHERE mapping_id=1 AND target_code='STANDARD_NAME'").run();
    const chunkOutbox = await context.DB.prepare("SELECT id,json_extract(payload_json,'$.after_row_number') after_row_number FROM material_import_job_outbox WHERE normalization_run_id=? AND job_type='NORMALIZE_ROW_CHUNK'").bind(started.payload.normalization_run_id).first();
    const outcome = await handler.handle({ jobId: chunkOutbox.id, batchId: 1, normalizationRunId: started.payload.normalization_run_id, jobType: "NORMALIZE_ROW_CHUNK", payloadVersion: 1, afterRowNumber: Number(chunkOutbox.after_row_number) });
    assert.equal(outcome, "ACK");
    assert.deepEqual(await context.DB.prepare("SELECT status,current_normalization_run_id FROM material_import_batches WHERE id=1").first(), { status: "MAPPING_CONFIRMED", current_normalization_run_id: null });
    const failed = await context.DB.prepare("SELECT run_status,failure_code FROM material_import_normalization_runs WHERE id=?").bind(started.payload.normalization_run_id).first();
    assert.deepEqual(failed, { run_status: "FAILED", failure_code: "IMPORT_NORMALIZATION_MAPPING_STALE" });
    assert.equal((await context.DB.prepare("SELECT COUNT(*) count FROM material_import_normalized_rows").first()).count, 0);
  } finally { await context.mf.dispose(); }
});

test("an expired worker lease cannot fail or roll back a run after controlled takeover", { timeout: 30_000 }, async () => {
  const context = await fixture();
  try {
    const started = await startMaterialImportNormalization(context.DB, { batchId: 1, username: "owner", canReadAny: false, canNormalize: true, expectedVersion: 2, processorVersion: "normalizer-v1", idempotencyKey: "normalization-lease-takeover", requestId: "start" }, () => new Date(fixedNow));
    const startHandler = new MaterialImportNormalizationTaskHandler(context.DB, undefined, () => new Date(fixedNow));
    assert.equal(await startHandler.handle({ jobId: "start", batchId: 1, normalizationRunId: started.payload.normalization_run_id, jobType: "START_NORMALIZATION", payloadVersion: 1 }), "ACK");
    const takeoverDigest = "e".repeat(64);
    const staleWorker = new MaterialImportNormalizationTaskHandler(context.DB, { async normalize(input) {
      await context.DB.prepare("UPDATE material_import_normalization_runs SET lease_token_digest=?,lease_expires_at=? WHERE id=?").bind(takeoverDigest, Math.floor(fixedNow.getTime() / 1000) + 120, input.lineage.normalization_run_id).run();
      throw new Error("stale worker stopped");
    } }, () => new Date(fixedNow));
    assert.equal(await staleWorker.handle({ jobId: "chunk", batchId: 1, normalizationRunId: started.payload.normalization_run_id, jobType: "NORMALIZE_ROW_CHUNK", payloadVersion: 1, afterRowNumber: 0 }), "DEAD");
    assert.deepEqual(await context.DB.prepare("SELECT status,current_normalization_run_id FROM material_import_batches WHERE id=1").first(), { status: "NORMALIZING", current_normalization_run_id: null });
    const run = await context.DB.prepare("SELECT run_status,lease_token_digest,failure_code FROM material_import_normalization_runs WHERE id=?").bind(started.payload.normalization_run_id).first();
    assert.deepEqual(run, { run_status: "RUNNING", lease_token_digest: takeoverDigest, failure_code: null });
  } finally { await context.mf.dispose(); }
});
