import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { load as parseYaml } from "js-yaml";
import { Miniflare } from "miniflare";

import { assertSafeTestTarget } from "../scripts/environment.mjs";
import { handleMaterialImportApi } from "../app/lib/material-import/handler.ts";
import { getMaterialImportMapping, previewMaterialImportMapping, replaceMaterialImportMapping } from "../app/lib/material-import/mapping-service.ts";
import { MaterialImportMappingMetadataSnapshotService, MaterialImportMappingTargetRegistry, BASIC_TARGETS, SUPPLIER_TARGETS } from "../app/lib/material-import/mapping-target-registry.ts";
import { splitD1MigrationStatements } from "../scripts/d1-migration-statements.mjs";

const siteRoot = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const fixedNow = new Date("2026-07-16T08:00:00.000Z");

async function apply(DB, migration) {
  const sql = await readFile(join(siteRoot, "drizzle", migration), "utf8");
  await DB.batch(splitD1MigrationStatements(sql).map((statement) => DB.prepare(statement)));
}

async function fixture() {
  const mf = new Miniflare({ modules: true, script: "export default {}", compatibilityDate: "2026-05-22", d1Databases: { DB: "mapping-target-catalog-v1" } });
  const { DB } = await mf.getBindings();
  for (const migration of ["0000_far_nightmare.sql", "0001_material_master_v2.sql", "0002_material_draft_review_api.sql", "0003_material_draft_lifecycle.sql", "0004_material_import_batch_foundation.sql", "0005_material_import_parser_mapping.sql"]) await apply(DB, migration);
  for (const username of ["owner", "other", "reader", "any", "denied", "rate-user"]) await DB.prepare("INSERT INTO app_users(username,display_name,role,password_hash,is_active,must_change_password,version,created_at,updated_at) VALUES(?,?, 'custom','test',1,0,1,?,?)").bind(username, username, fixedNow.toISOString(), fixedNow.toISOString()).run();
  await DB.prepare("INSERT INTO material_import_batches(id,batch_no,source_kind,status,created_by,current_version,file_count,total_rows,accepted_rows,rejected_rows,created_at,updated_at) VALUES(1,'MIB-CATALOG-1','CSV','CREATED','owner',1,0,0,0,0,?,?)").bind(fixedNow.toISOString(), fixedNow.toISOString()).run();
  await DB.prepare("INSERT INTO material_import_batches(id,batch_no,source_kind,status,created_by,current_version,file_count,total_rows,accepted_rows,rejected_rows,created_at,updated_at) VALUES(2,'MIB-CATALOG-2','CSV','CREATED','other',1,0,0,0,0,?,?)").bind(fixedNow.toISOString(), fixedNow.toISOString()).run();
  for (const [id, batchId] of [[1, 1], [2, 2]]) await DB.prepare("INSERT INTO material_import_parse_runs(id,batch_id,parser_version,run_status,current_stage,completed_at,mapping_preparation_status,created_at,updated_at) VALUES(?,?,'parser-v1','SUCCEEDED','COMPLETE',?,'READY',?,?)").bind(id, batchId, fixedNow.toISOString(), fixedNow.toISOString(), fixedNow.toISOString()).run();
  await DB.prepare("UPDATE material_import_batches SET status='AWAITING_MAPPING',current_parse_run_id=id WHERE id IN (1,2)").run();
  for (const id of [1, 2]) await DB.prepare("INSERT INTO material_import_parse_sheets(parse_run_id,sheet_index,sheet_name,visibility,parse_status,row_count,source_column_max,merged_ranges_json,warning_count,safe_warnings_json,started_at,completed_at,created_at,updated_at) VALUES(?,0,'Sheet1','VISIBLE','COMPLETED',2,4,'[]',0,'[]',?,?,?,?)").bind(id, fixedNow.toISOString(), fixedNow.toISOString(), fixedNow.toISOString(), fixedNow.toISOString()).run();
  await DB.prepare("INSERT INTO material_import_rows(batch_id,parse_run_id,sheet_index,sheet_name,row_number,raw_values_json,raw_row_hash,created_at) VALUES(1,1,0,'Sheet1',1,?,printf('%064x',1),?)").bind(JSON.stringify({ cells: [{ column_index: 0, type: "TEXT", raw_value: "电阻" }, { column_index: 1, type: "TEXT", raw_value: "PCS" }] }), fixedNow.toISOString()).run();
  const definitions = [
    [101, "THICKNESS", "<b>板厚</b>", "DECIMAL", 3, "mm", "[]", "DECIMAL_SCALE", "ACTIVE"],
    [102, "COLOR", "颜色", "ENUM", 0, "", '["BLACK","WHITE"]', "ENUM_CODE", "ACTIVE"],
    [103, "OLD_CODE", "旧属性", "TEXT", 0, "", "[]", "NONE", "INACTIVE"],
  ];
  for (const row of definitions) await DB.prepare("INSERT INTO material_attribute_definitions(id,attribute_code,attribute_name_cn,attribute_name_en,data_type,decimal_scale,canonical_unit,allowed_values_json,normalization_rule,status,version,approved_by,approved_at,created_by,created_at,updated_by,updated_at,request_id) VALUES(?,?,?,'',?,?,?,?,?,?,1,'admin',?,'admin',?,'admin',?,'catalog-test')").bind(...row.slice(0, 10), fixedNow.toISOString(), fixedNow.toISOString(), fixedNow.toISOString()).run();
  const digest = (await new MaterialImportMappingMetadataSnapshotService(DB).current()).metadataDigest;
  await DB.prepare("INSERT INTO material_import_mappings(id,batch_id,parse_run_id,selected_sheet_index,header_mode,header_row_number,mapping_status,mapping_version,metadata_digest,created_by,updated_by,created_at,updated_at) VALUES(1,1,1,0,'NO_HEADER',NULL,'DRAFT',1,?,'owner','owner',?,?)").bind(digest, fixedNow.toISOString(), fixedNow.toISOString()).run();
  return { mf, DB, digest };
}

const permissions = {
  owner: new Set(["material.import.read", "material.import.map"]),
  other: new Set(["material.import.read", "material.import.map"]),
  reader: new Set(["material.import.read"]),
  any: new Set(["material.import.read", "material.import.map", "material.import.read_any"]),
  denied: new Set(),
  "rate-user": new Set(["material.import.read", "material.import.map", "material.import.read_any"]),
};

async function api(context, path, user, overrides = {}) {
  const headers = new Headers();
  if (user) headers.set("X-Test-User", user);
  const dependencies = {
    database: context.DB,
    currentUser: async (request) => {
      const username = request.headers.get("X-Test-User");
      return username ? { username, role: "custom", must_change_password: false } : null;
    },
    userCan: (account, permission) => permissions[account.username]?.has(permission) ?? false,
    clock: () => new Date(fixedNow),
    importReadRateLimit: 10_000,
    ...overrides,
  };
  const response = await handleMaterialImportApi(new Request(`http://local.test${path}`, { headers }), dependencies);
  const payload = JSON.parse(await response.text());
  return { response, payload };
}

const draft = {
  selected_sheet_index: 0,
  header_mode: "NO_HEADER",
  items: [
    { source_column_index: 0, target_namespace: "basic", target_code: "STANDARD_NAME", mapping_mode: "SOURCE", required: true, display_order: 0 },
    { source_column_index: 1, target_namespace: "basic", target_code: "UNIT", mapping_mode: "SOURCE", required: true, display_order: 1 },
  ],
};

test("Material Import Mapping Target Catalog V1 approved contract", { timeout: 120_000 }, async (t) => {
  const context = await fixture();
  try {
    await t.test("01 unauthenticated read is rejected", async () => { const result = await api(context, "/api/material-master/import-batches/1/mapping-targets"); assert.equal(result.response.status, 401); assert.equal(result.payload.error.code, "AUTH_REQUIRED"); });
    await t.test("02 missing read capability is forbidden", async () => { const result = await api(context, "/api/material-master/import-batches/1/mapping-targets", "denied"); assert.equal(result.response.status, 403); assert.equal(result.payload.error.code, "FORBIDDEN"); });
    await t.test("03 read without map is forbidden after visibility", async () => { const result = await api(context, "/api/material-master/import-batches/1/mapping-targets", "owner", { userCan: (_account, permission) => permission === "material.import.read" }); assert.equal(result.response.status, 403); assert.equal(result.payload.error.code, "FORBIDDEN"); });
    await t.test("04 hidden batch is a safe 404", async () => { const result = await api(context, "/api/material-master/import-batches/2/mapping-targets", "owner"); assert.equal(result.response.status, 404); assert.equal(result.payload.error.code, "IMPORT_BATCH_NOT_FOUND"); });
    await t.test("05 owner can read its batch", async () => { const result = await api(context, "/api/material-master/import-batches/1/mapping-targets", "owner"); assert.equal(result.response.status, 200); assert.equal(result.payload.batch_id, 1); assert.equal(result.payload.parse_run_id, 1); });
    await t.test("06 read_any can read another visible domain batch", async () => { const result = await api(context, "/api/material-master/import-batches/2/mapping-targets", "any"); assert.equal(result.response.status, 200); assert.equal(result.payload.batch_id, 2); });
    await t.test("07 BASIC contains the 11 approved targets", async () => { const result = await api(context, "/api/material-master/import-batches/1/mapping-targets?namespace=BASIC&limit=100", "owner"); assert.equal(result.payload.items.length, 11); });
    await t.test("08 SPECIAL contains category, suppliers, and ignore", async () => { const result = await api(context, "/api/material-master/import-batches/1/mapping-targets?namespace=SPECIAL&limit=100", "owner"); assert.equal(result.payload.items.length, 7); assert.ok(result.payload.items.some((item) => item.target_code === "IGNORE")); });
    await t.test("09 ACTIVE D1 attributes are selectable", async () => { const result = await api(context, "/api/material-master/import-batches/1/mapping-targets?namespace=ATTRIBUTE&limit=100", "owner"); assert.deepEqual(result.payload.items.map((item) => item.target_code), ["COLOR", "THICKNESS"]); });
    await t.test("10 inactive attributes are not selectable", async () => { const result = await api(context, "/api/material-master/import-batches/1/mapping-targets?namespace=ATTRIBUTE&limit=100", "owner"); assert.ok(!result.payload.items.some((item) => item.target_code === "OLD_CODE")); });
    await t.test("11 DTO never returns attribute_id", async () => { const result = await api(context, "/api/material-master/import-batches/1/mapping-targets?limit=100", "owner"); assert.ok(!JSON.stringify(result.payload).includes("attribute_id")); });
    await t.test("12 DTO never returns database internals", async () => { const result = await api(context, "/api/material-master/import-batches/1/mapping-targets?limit=100", "owner"); assert.doesNotMatch(JSON.stringify(result.payload), /table_name|column_name|sql_type|repository/i); });
    await t.test("13 target codes match the Mapping allowlist", async () => { assert.deepEqual(BASIC_TARGETS, ["STANDARD_NAME", "UNIT", "BRAND", "MANUFACTURER", "MANUFACTURER_PART_NUMBER", "PURCHASE_TYPE", "INVENTORY_TYPE", "LOT_CONTROL", "SHELF_LIFE_DAYS", "INSPECTION_TYPE", "ENVIRONMENTAL_REQUIREMENT"]); assert.equal(SUPPLIER_TARGETS.length, 5); });
    await t.test("14 STANDARD_NAME is required for confirm", async () => { const result = await api(context, "/api/material-master/import-batches/1/mapping-targets?q=STANDARD_NAME", "owner"); assert.equal(result.payload.items[0].required_for_confirm, true); });
    await t.test("15 UNIT is required for confirm", async () => { const result = await api(context, "/api/material-master/import-batches/1/mapping-targets?q=UNIT", "owner"); assert.equal(result.payload.items.find((item) => item.target_code === "UNIT").required_for_confirm, true); });
    await t.test("16 ignore is repeatable by Mapping semantics", async () => { const result = await api(context, "/api/material-master/import-batches/1/mapping-targets?q=IGNORE", "owner"); assert.deepEqual(result.payload.items[0].mapping_modes, ["IGNORE"]); assert.equal(result.payload.items[0].default_value_policy.allowed, false); });
    await t.test("17 value types come from registry and D1", async () => { const result = await api(context, "/api/material-master/import-batches/1/mapping-targets?q=THICKNESS", "owner"); assert.equal(result.payload.items[0].value_type, "DECIMAL"); });
    await t.test("18 default value policy is shared", async () => { const result = await api(context, "/api/material-master/import-batches/1/mapping-targets?q=THICKNESS", "owner"); assert.deepEqual(result.payload.items[0].default_value_policy.allowed_json_types, ["STRING", "SAFE_INTEGER", "BOOLEAN", "NULL"]); });
    await t.test("19 unit policy is authoritative", async () => { const result = await api(context, "/api/material-master/import-batches/1/mapping-targets?q=THICKNESS", "owner"); assert.deepEqual(result.payload.items[0].unit_policy, { mode: "CANONICAL", canonical_unit: "mm", allowed_units: ["mm"] }); });
    await t.test("20 namespace filtering is server side", async () => { const result = await api(context, "/api/material-master/import-batches/1/mapping-targets?namespace=ATTRIBUTE", "owner"); assert.ok(result.payload.items.every((item) => item.group_code === "ATTRIBUTE")); });
    await t.test("21 q searches code and safe display text", async () => { const result = await api(context, "/api/material-master/import-batches/1/mapping-targets?q=%E6%9D%BF%E5%8E%9A", "owner"); assert.deepEqual(result.payload.items.map((item) => item.target_code), ["THICKNESS"]); });
    await t.test("22 q length controls and unknown parameters are rejected", async () => { const long = await api(context, `/api/material-master/import-batches/1/mapping-targets?q=${"x".repeat(65)}`, "owner"); assert.equal(long.payload.error.code, "IMPORT_MAPPING_TARGET_QUERY_INVALID"); const control = await api(context, "/api/material-master/import-batches/1/mapping-targets?q=%00", "owner"); assert.equal(control.response.status, 400); const unknown = await api(context, "/api/material-master/import-batches/1/mapping-targets?expression=1", "owner"); assert.equal(unknown.payload.error.code, "IMPORT_MAPPING_TARGET_QUERY_INVALID"); });
    let firstCursor;
    await t.test("23 cursor advances without duplicates", async () => { const first = await api(context, "/api/material-master/import-batches/1/mapping-targets?limit=3", "owner"); firstCursor = first.payload.next_cursor; const second = await api(context, `/api/material-master/import-batches/1/mapping-targets?limit=3&cursor=${firstCursor}`, "owner"); assert.equal(new Set([...first.payload.items, ...second.payload.items].map((item) => `${item.target_namespace}.${item.target_code}`)).size, 6); });
    await t.test("24 cursor is bounded and contains no database identifiers", async () => { assert.equal(typeof firstCursor, "string"); assert.ok(firstCursor.length < 1024); assert.doesNotMatch(firstCursor, /attribute_id|offset|database/i); });
    await t.test("25 cursor is bound to namespace q and limit", async () => { const result = await api(context, `/api/material-master/import-batches/1/mapping-targets?limit=4&cursor=${firstCursor}`, "owner"); assert.equal(result.response.status, 400); assert.equal(result.payload.error.code, "IMPORT_MAPPING_TARGET_QUERY_INVALID"); });
    await t.test("26 metadata changes invalidate old cursor", async () => { await context.DB.prepare("UPDATE material_attribute_definitions SET canonical_unit='um' WHERE attribute_code='THICKNESS'").run(); const result = await api(context, `/api/material-master/import-batches/1/mapping-targets?limit=3&cursor=${firstCursor}`, "owner"); assert.equal(result.response.status, 409); assert.equal(result.payload.error.code, "IMPORT_MAPPING_TARGET_CATALOG_CHANGED"); assert.equal(result.payload.error.details[0].restart_from_first_page, true); await context.DB.prepare("UPDATE material_attribute_definitions SET canonical_unit='mm' WHERE attribute_code='THICKNESS'").run(); });
    await t.test("27 equivalent insertion orders produce the same digest", async () => { const service = new MaterialImportMappingMetadataSnapshotService(context.DB); const one = await service.current(); const registry = new MaterialImportMappingTargetRegistry(); const rows = [{ attribute_code: "Z", attribute_name_cn: "Z", data_type: "TEXT", decimal_scale: 0, canonical_unit: "", allowed_values_json: "[]", normalization_rule: "NONE", status: "ACTIVE", version: 1 }, { attribute_code: "A", attribute_name_cn: "A", data_type: "TEXT", decimal_scale: 0, canonical_unit: "", allowed_values_json: "[]", normalization_rule: "NONE", status: "ACTIVE", version: 1 }]; assert.deepEqual(registry.buildTargets(rows).map((item) => item.target_code), registry.buildTargets([...rows].reverse()).map((item) => item.target_code)); assert.match(one.metadataDigest, /^[a-f0-9]{64}$/); });
    await t.test("28 business semantics change the Mapping digest", async () => { const before = await new MaterialImportMappingMetadataSnapshotService(context.DB).current(); await context.DB.prepare("UPDATE material_attribute_definitions SET decimal_scale=2 WHERE attribute_code='THICKNESS'").run(); const after = await new MaterialImportMappingMetadataSnapshotService(context.DB).current(); assert.notEqual(after.metadataDigest, before.metadataDigest); await context.DB.prepare("UPDATE material_attribute_definitions SET decimal_scale=3 WHERE attribute_code='THICKNESS'").run(); });
    await t.test("29 display-only changes do not change Mapping digest", async () => { const before = await new MaterialImportMappingMetadataSnapshotService(context.DB).current(); await context.DB.prepare("UPDATE material_attribute_definitions SET attribute_name_cn='板厚展示' WHERE attribute_code='THICKNESS'").run(); const after = await new MaterialImportMappingMetadataSnapshotService(context.DB).current(); assert.equal(after.metadataDigest, before.metadataDigest); assert.notEqual(after.searchProjectionDigest, before.searchProjectionDigest); await context.DB.prepare("UPDATE material_attribute_definitions SET attribute_name_cn='<b>板厚</b>' WHERE attribute_code='THICKNESS'").run(); });
    await t.test("30 Mapping save persists the shared Snapshot digest", async () => { const mapping = await getMaterialImportMapping(context.DB, 1, { username: "owner", canReadAny: false }); const saved = await replaceMaterialImportMapping(context.DB, 1, { username: "owner", canReadAny: false, idempotencyKey: "catalog-save-0001", requestId: "catalog-save", expectedVersion: 1, parseRunId: 1, expectedMappingVersion: mapping.payload.mapping.mapping_version, draft }, () => new Date(fixedNow)); const snapshot = await new MaterialImportMappingMetadataSnapshotService(context.DB).current(); assert.equal(saved.payload.mapping.metadata_digest, snapshot.metadataDigest); });
    await t.test("31 preview validates against the shared Snapshot", async () => { await context.DB.prepare("UPDATE material_attribute_definitions SET status='INACTIVE' WHERE attribute_code='THICKNESS'").run(); const withAttribute = { ...draft, items: [...draft.items, { source_column_index: 2, target_namespace: "attribute", target_code: "THICKNESS", mapping_mode: "SOURCE", required: false, display_order: 2 }] }; await assert.rejects(previewMaterialImportMapping(context.DB, 1, { username: "owner", canReadAny: false, idempotencyKey: "catalog-preview-01", requestId: "preview", expectedVersion: 1, parseRunId: 1, draft: withAttribute, startRow: 1, rowLimit: 1 }, () => new Date(fixedNow)), (error) => error.code === "IMPORT_MAPPING_TARGET_INVALID"); await context.DB.prepare("UPDATE material_attribute_definitions SET status='ACTIVE' WHERE attribute_code='THICKNESS'").run(); });
    await t.test("32 confirm-required targets come from the same Registry", async () => { const snapshot = await new MaterialImportMappingMetadataSnapshotService(context.DB).current(); assert.deepEqual(snapshot.targets.filter((item) => item.required_for_confirm).map((item) => item.target_code), ["STANDARD_NAME", "UNIT"]); });
    await t.test("33 historical invalid targets remain in GET mapping", async () => { await context.DB.prepare("INSERT INTO material_import_mapping_items(mapping_id,source_column_index,target_namespace,target_code,mapping_mode,required,display_order) VALUES(1,2,'attribute','OLD_CODE','SOURCE',0,2)").run(); const mapping = await getMaterialImportMapping(context.DB, 1, { username: "owner", canReadAny: false }); assert.ok(mapping.payload.mapping.items.some((item) => item.target_code === "OLD_CODE")); const catalog = await api(context, "/api/material-master/import-batches/1/mapping-targets?namespace=ATTRIBUTE", "owner"); assert.ok(!catalog.payload.items.some((item) => item.target_code === "OLD_CODE")); });
    await t.test("34 default limit is bounded and oversized limit is rejected", async () => { const normal = await api(context, "/api/material-master/import-batches/1/mapping-targets", "owner"); assert.ok(normal.payload.items.length <= 50); const invalid = await api(context, "/api/material-master/import-batches/1/mapping-targets?limit=101", "owner"); assert.equal(invalid.response.status, 400); });
    await t.test("35 rate limit returns Retry-After", async () => { const overrides = { importReadRateLimit: 1 }; const first = await api(context, "/api/material-master/import-batches/1/mapping-targets", "rate-user", overrides); assert.equal(first.response.status, 200); const second = await api(context, "/api/material-master/import-batches/1/mapping-targets", "rate-user", overrides); assert.equal(second.response.status, 429); assert.equal(second.response.headers.get("retry-after"), "60"); });
    await t.test("36 unexpected failures return safe 500", async () => { const failing = { prepare() { throw new Error("SELECT secret FROM internal_table token=abc"); } }; const result = await api({ DB: failing }, "/api/material-master/import-batches/1/mapping-targets", "owner"); assert.equal(result.response.status, 500); assert.doesNotMatch(JSON.stringify(result.payload), /SELECT|secret|token|internal_table/); });
    await t.test("37 request ids are consistent", async () => { const result = await api(context, "/api/material-master/import-batches/1/mapping-targets?limit=0", "owner"); assert.equal(result.payload.request_id, result.payload.error.request_id); assert.equal(result.payload.request_id, result.response.headers.get("x-request-id")); });
    await t.test("38 metadata display is inert plain text", async () => { const result = await api(context, "/api/material-master/import-batches/1/mapping-targets?q=THICKNESS", "owner"); assert.equal(result.payload.items[0].display_name, "<b>板厚</b>"); assert.equal(result.response.headers.get("content-type"), "application/json; charset=utf-8"); });
    await t.test("39 runtime Registry does not read seed or fixtures", async () => { const source = await readFile(join(siteRoot, "app", "lib", "material-import", "mapping-target-registry.ts"), "utf8"); assert.doesNotMatch(source, /seed-material|tests\/fixtures|material-categories\.v1/i); });
    await t.test("40 API audit omits q and raw cursor", async () => { const marker = "sensitive-search-term"; await api(context, `/api/material-master/import-batches/1/mapping-targets?q=${marker}`, "owner"); const row = await context.DB.prepare("SELECT detail FROM audit_log WHERE route_code='MATERIAL_IMPORT_MAPPING_TARGET_CATALOG' ORDER BY id DESC LIMIT 1").first(); assert.doesNotMatch(row.detail, new RegExp(marker)); assert.doesNotMatch(row.detail, /cursor.*[A-Za-z0-9_-]{20}/); });
    await t.test("41 OpenAPI 3.1 parses and exposes the route", async () => { const document = parseYaml(await readFile(join(siteRoot, "..", "docs", "material-master", "material-import-mapping-target-catalog-v1.openapi.yaml"), "utf8")); assert.equal(document.openapi, "3.1.0"); assert.ok(document.paths["/api/material-master/import-batches/{batchId}/mapping-targets"].get); });
    await t.test("42 the contract runs against one-time Miniflare D1", async () => { const row = await context.DB.prepare("SELECT COUNT(*) count FROM material_import_batches").first(); assert.equal(row.count, 2); });
    await t.test("43 production URL and non-test environment remain rejected", () => { assert.throws(() => assertSafeTestTarget({ ERP_ENV: "production", ERP_API_URL: "https://chenyida-erp-online.sjin74376.chatgpt.site/api", ERP_SITE_URL: "https://chenyida-erp-online.sjin74376.chatgpt.site", ERP_D1_PERSIST_PATH: "C:/production" })); });
    await t.test("44 Catalog and save expose exactly the same selectable target set", async () => { const catalog = await api(context, "/api/material-master/import-batches/1/mapping-targets?limit=100", "owner"); const snapshot = await new MaterialImportMappingMetadataSnapshotService(context.DB).current(); assert.deepEqual(catalog.payload.items.map((item) => `${item.target_namespace}.${item.target_code}`), snapshot.targets.map((item) => `${item.target_namespace}.${item.target_code}`)); });
    await t.test("45 Catalog and confirm use the same digest", async () => { const catalog = await api(context, "/api/material-master/import-batches/1/mapping-targets", "owner"); const mapping = await getMaterialImportMapping(context.DB, 1, { username: "owner", canReadAny: false }); assert.equal(mapping.payload.mapping.metadata_digest, catalog.payload.metadata_digest); });
    await t.test("46 pure display changes invalidate search cursor only", async () => { const first = await api(context, "/api/material-master/import-batches/1/mapping-targets?limit=2", "owner"); await context.DB.prepare("UPDATE material_attribute_definitions SET attribute_name_cn='展示变化' WHERE attribute_code='COLOR'").run(); const stale = await api(context, `/api/material-master/import-batches/1/mapping-targets?limit=2&cursor=${first.payload.next_cursor}`, "owner"); assert.equal(stale.payload.error.code, "IMPORT_MAPPING_TARGET_CATALOG_CHANGED"); await context.DB.prepare("UPDATE material_attribute_definitions SET attribute_name_cn='颜色' WHERE attribute_code='COLOR'").run(); });
    await t.test("47 empty filtered Catalog succeeds", async () => { await context.DB.prepare("UPDATE material_attribute_definitions SET status='INACTIVE' WHERE status='ACTIVE'").run(); const result = await api(context, "/api/material-master/import-batches/1/mapping-targets?namespace=ATTRIBUTE", "owner"); assert.equal(result.response.status, 200); assert.deepEqual(result.payload.items, []); assert.equal(result.payload.next_cursor, null); await context.DB.prepare("UPDATE material_attribute_definitions SET status='ACTIVE' WHERE attribute_code IN ('THICKNESS','COLOR')").run(); });
    await t.test("48 Metadata Repository failure is fail-closed", async () => { const database = { prepare() { return { all() { throw new Error("repository failure"); } }; } }; await assert.rejects(new MaterialImportMappingMetadataSnapshotService(database).current(), (error) => error.code === "IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE" && error.status === 503); });
    await t.test("49 forbidden response never contains Catalog content", async () => { const result = await api(context, "/api/material-master/import-batches/1/mapping-targets", "owner", { userCan: (_account, permission) => permission === "material.import.read" }); assert.equal(result.response.status, 403); assert.doesNotMatch(JSON.stringify(result.payload), /metadata_digest|STANDARD_NAME|THICKNESS|items/); });
    await t.test("50 cursor text is never written to audit detail", async () => { const first = await api(context, "/api/material-master/import-batches/1/mapping-targets?limit=2", "owner"); await api(context, `/api/material-master/import-batches/1/mapping-targets?limit=2&cursor=${first.payload.next_cursor}`, "owner"); const row = await context.DB.prepare("SELECT detail FROM audit_log WHERE route_code='MATERIAL_IMPORT_MAPPING_TARGET_CATALOG' ORDER BY id DESC LIMIT 1").first(); assert.ok(!row.detail.includes(first.payload.next_cursor)); });
  } finally {
    await context.mf.dispose();
  }
});
