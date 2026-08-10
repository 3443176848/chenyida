import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const siteRoot = new URL("../", import.meta.url);
const migration = await readFile(new URL("drizzle-postgres/0041_ai_governance_suggestion_evidence.sql", siteRoot), "utf8");
const schema = await readFile(new URL("db/schema.ts", siteRoot), "utf8");
const snapshot = JSON.parse(await readFile(new URL("drizzle-postgres/meta/0041_snapshot.json", siteRoot), "utf8"));
const previousSnapshot = JSON.parse(await readFile(new URL("drizzle-postgres/meta/0040_snapshot.json", siteRoot), "utf8"));
const journal = JSON.parse(await readFile(new URL("drizzle-postgres/meta/_journal.json", siteRoot), "utf8"));

const tables = [
  "ai_governance_suggestion_runs",
  "ai_governance_suggestions",
  "ai_governance_suggestion_items",
  "ai_governance_suggestion_evidence",
  "ai_governance_suggestion_events",
];

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right, "en"));
}

function migrationTableBlock(tableName) {
  const start = migration.indexOf(`CREATE TABLE "${tableName}" (`);
  assert.notEqual(start, -1, `missing migration table ${tableName}`);
  const end = migration.indexOf("\n);", start);
  assert.notEqual(end, -1, `unterminated migration table ${tableName}`);
  return migration.slice(start, end + 3);
}

function schemaTableBlock(tableName) {
  const start = schema.indexOf(`pgTable("${tableName}", {`);
  assert.notEqual(start, -1, `missing schema table ${tableName}`);
  const end = schema.indexOf("\nexport const ", start + 1);
  return schema.slice(start, end === -1 ? schema.length : end);
}

function migrationColumns(tableName) {
  return [...migrationTableBlock(tableName).matchAll(/^\s*"([a-z0-9_]+)"\s+/gm)].map((match) => match[1]);
}

function schemaColumns(tableName) {
  const factories = /\b(?:bigserial|bigint|boolean|date|integer|numeric|text|timestamptz|timestamp|uuid)\("([a-z0-9_]+)"/g;
  return [...schemaTableBlock(tableName).matchAll(factories)].map((match) => match[1]);
}

test("0041 is the current immutable journal and snapshot head", () => {
  const entry = journal.entries.at(-1);
  assert.equal(entry?.idx, 41);
  assert.equal(entry?.tag, "0041_ai_governance_suggestion_evidence");
  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.match(snapshot.id, /^[0-9a-f-]{36}$/);
});

test("0041 migration, schema and snapshot expose exactly the five candidate tables", () => {
  const migrationTables = [...migration.matchAll(/CREATE TABLE "(ai_governance_[a-z_]+)"/g)].map((match) => match[1]);
  const schemaTables = [...schema.matchAll(/pgTable\("(ai_governance_[a-z_]+)"/g)].map((match) => match[1]);
  const snapshotTables = Object.keys(snapshot.tables)
    .filter((name) => name.startsWith("public.ai_governance_"))
    .map((name) => name.slice("public.".length));
  assert.deepEqual(sorted(migrationTables), sorted(tables));
  assert.deepEqual(sorted(schemaTables), sorted(tables));
  assert.deepEqual(sorted(snapshotTables), sorted(tables));
  for (const tableName of tables) {
    const columns = Object.keys(snapshot.tables[`public.${tableName}`].columns);
    assert.deepEqual(sorted(migrationColumns(tableName)), sorted(columns), `${tableName} migration columns`);
    assert.deepEqual(sorted(schemaColumns(tableName)), sorted(columns), `${tableName} schema columns`);
  }
});

test("0041 declares typed targets, real references and no polymorphic escape hatch", () => {
  for (const token of [
    "ai_governance_suggestion_runs_group_run_fk",
    "ai_governance_suggestions_run_subject_fk",
    "ai_governance_suggestion_runs_business_uq",
    "ai_governance_suggestion_items_category_uq",
    "ai_governance_suggestion_items_attribute_uq",
    "ai_governance_suggestion_items_material_uq",
    "ai_governance_suggestion_items_supplier_uq",
    "ai_governance_suggestion_evidence_kind_ck",
    "ai_governance_suggestion_items_kind_ck",
    "ai_governance_suggestion_events_terminal_uq",
    "ai_governance_suggestion_runs_ttl_ck",
  ]) assert.match(migration, new RegExp(token), token);
  for (const tableName of tables) {
    const block = migrationTableBlock(tableName);
    assert.doesNotMatch(block, /"(?:target|source)_type"|"(?:target|source)_id"/);
  }
  for (const target of [
    "material_governance_runs",
    "material_governance_groups",
    "material_governance_rows",
    "material_governance_specs",
    "material_governance_material_candidates",
    "material_governance_alternative_candidates",
    "material_import_normalization_lineage",
    "material_categories",
    "material_attribute_definitions",
    "material_master",
    "suppliers",
    "supplier_mappings",
    "units",
    "app_users",
  ]) assert.match(migration, new RegExp(`REFERENCES "public"\\."${target}"`), target);
  assert.doesNotMatch(migration, /ALTER TABLE "(?:material_|supplier_|bom_|inventory_|production_|purchase_|quality_|finance_)[^"]+" ADD CONSTRAINT [^\n]+REFERENCES "public"\."ai_governance_/);
});

test("0041 service gate, immutability and deferred completeness are explicit", () => {
  assert.match(migration, /current_setting\('cyd\.ai_governance_suggestion_service_write', true\) IS DISTINCT FROM 'allowed'/);
  assert.match(migration, /TG_OP IN \('UPDATE', 'DELETE'\)/);
  for (const tableName of tables) {
    assert.match(migration, new RegExp(`CREATE TRIGGER ${tableName}_guard\\s+BEFORE INSERT OR UPDATE OR DELETE ON ${tableName}`));
    assert.match(migration, new RegExp(`ALTER TABLE ${tableName} ENABLE ALWAYS TRIGGER ${tableName}_guard`));
  }
  for (const token of [
    "ai_governance_suggestion_runs_complete_ck",
    "ai_governance_suggestions_created_event_ck",
    "ai_governance_suggestions_item_cardinality_ck",
    "ai_governance_suggestion_items_evidence_cardinality_ck",
    "ai_governance_suggestion_evidence_subject_lineage_ck",
    "ai_governance_suggestions_version_chain_ck",
    "ai_governance_suggestion_events_superseded_chain_ck",
    "DEFERRABLE INITIALLY DEFERRED",
  ]) assert.match(migration, new RegExp(token), token);
  assert.match(migration, /event_type='SUPERSEDED'/);
  assert.match(migration, /event_type='CREATED'/);
  assert.match(migration, /IF NEW\.event_type='CREATED' THEN\s+PERFORM cyd_ai_governance_suggestion_assert_complete\(NEW\.suggestion_id\)/);
  assert.match(migration, /event_type" in \('INVALIDATED','DISCARDED','SUPERSEDED'\)/);
});

test("0041 fixes generated parent-key order and keeps current local-only contract", () => {
  const parent = migration.indexOf('CREATE UNIQUE INDEX "ai_governance_suggestion_runs_id_subject_uq"');
  const child = migration.indexOf('ADD CONSTRAINT "ai_governance_suggestions_run_subject_fk"');
  assert.ok(parent >= 0 && parent < child);
  assert.match(migration, /'LOCAL_DETERMINISTIC'/);
  assert.match(migration, /"model_id"='NONE'/);
  assert.match(migration, /"prompt_version"='NONE'/);
  assert.match(migration, /"confidence_semantics_version" is null/);
  assert.match(migration, /"expires_at">"ai_governance_suggestion_runs"\."created_at"/);
});
