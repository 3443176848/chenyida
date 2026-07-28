import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const siteRoot = new URL("../", import.meta.url);
const migration = await readFile(new URL("drizzle-postgres/0035_bom_material_governance.sql", siteRoot), "utf8");
const schema = await readFile(new URL("db/schema.ts", siteRoot), "utf8");
const snapshot = JSON.parse(await readFile(new URL("drizzle-postgres/meta/0035_snapshot.json", siteRoot), "utf8"));
const previousSnapshot = JSON.parse(await readFile(new URL("drizzle-postgres/meta/0034_snapshot.json", siteRoot), "utf8"));
const journal = JSON.parse(await readFile(new URL("drizzle-postgres/meta/_journal.json", siteRoot), "utf8"));

const governanceTables = [
  "material_governance_runs",
  "material_governance_groups",
  "material_governance_rows",
  "material_governance_specs",
  "material_governance_material_candidates",
  "material_governance_alternative_candidates",
  "material_governance_decisions",
  "material_governance_material_links",
  "material_governance_events",
];

const immutableFactTables = governanceTables.filter((tableName) => tableName !== "material_governance_groups");

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right, "en"));
}

function migrationTableBlock(tableName) {
  const marker = `CREATE TABLE "${tableName}" (`;
  const start = migration.indexOf(marker);
  assert.notEqual(start, -1, `missing migration table ${tableName}`);
  const end = migration.indexOf("\n);", start);
  assert.notEqual(end, -1, `unterminated migration table ${tableName}`);
  return migration.slice(start, end + 3);
}

function schemaTableBlock(tableName) {
  const marker = `pgTable("${tableName}", {`;
  const start = schema.indexOf(marker);
  assert.notEqual(start, -1, `missing schema table ${tableName}`);
  const end = schema.indexOf("\nexport const ", start + marker.length);
  return schema.slice(start, end === -1 ? schema.length : end);
}

function migrationColumns(tableName) {
  return [...migrationTableBlock(tableName).matchAll(/^\s*"([a-z0-9_]+)"\s+/gm)].map((match) => match[1]);
}

function schemaColumns(tableName) {
  const columnFactory = /\b(?:bigserial|bigint|boolean|date|integer|jsonb|numeric|text|timestamptz|timestamp|uuid)\("([a-z0-9_]+)"/g;
  return [...schemaTableBlock(tableName).matchAll(columnFactory)].map((match) => match[1]);
}

test("0035 journal and snapshot form the next immutable migration link", () => {
  assert.equal(journal.entries.at(-1)?.idx, 35);
  assert.equal(journal.entries.at(-1)?.tag, "0035_bom_material_governance");
  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.match(snapshot.id, /^[0-9a-f-]{36}$/);
});

test("0035 migration, schema and snapshot expose the same governance tables and columns", () => {
  const migrationTables = [...migration.matchAll(/CREATE TABLE "(material_governance_[a-z_]+)"/g)].map((match) => match[1]);
  const schemaTables = [...schema.matchAll(/pgTable\("(material_governance_[a-z_]+)"/g)].map((match) => match[1]);
  const snapshotTables = Object.keys(snapshot.tables)
    .filter((key) => key.startsWith("public.material_governance_"))
    .map((key) => key.slice("public.".length));

  assert.deepEqual(sorted(migrationTables), sorted(governanceTables));
  assert.deepEqual(sorted(schemaTables), sorted(governanceTables));
  assert.deepEqual(sorted(snapshotTables), sorted(governanceTables));

  for (const tableName of governanceTables) {
    const snapshotColumns = Object.keys(snapshot.tables[`public.${tableName}`].columns);
    assert.deepEqual(sorted(migrationColumns(tableName)), sorted(snapshotColumns), `${tableName} migration columns`);
    assert.deepEqual(sorted(schemaColumns(tableName)), sorted(snapshotColumns), `${tableName} schema columns`);
  }
});

test("0035 keeps adaptive mapping additions aligned across migration, schema and snapshot", () => {
  const adaptiveColumns = [
    "header_start_row_number",
    "header_end_row_number",
    "data_start_row_number",
    "structure_confidence",
    "structure_status",
    "adaptive_algorithm_version",
  ];
  const mappingSchema = schemaTableBlock("material_import_mappings");
  const mappingSnapshot = snapshot.tables["public.material_import_mappings"];

  for (const columnName of adaptiveColumns) {
    assert.match(migration, new RegExp(`ALTER TABLE "material_import_mappings" ADD COLUMN "${columnName}"`));
    assert.ok(mappingSchema.includes(`("${columnName}"`), `schema material_import_mappings.${columnName}`);
    assert.ok(mappingSnapshot.columns[columnName], `snapshot material_import_mappings.${columnName}`);
  }
  assert.match(migration, /material_import_mappings_adaptive_structure_ck/);
  assert.ok(mappingSnapshot.checkConstraints.material_import_mappings_adaptive_structure_ck);
});

test("0035 declares relational identity, traceability and decision constraints", () => {
  for (const token of [
    "material_governance_runs_source_rule_uq",
    "material_governance_groups_run_identity_uq",
    "material_governance_groups_identity_idx",
    "material_governance_rows_group_run_fk",
    "material_governance_rows_run_normalized_uq",
    "material_governance_specs_row_code_uq",
    "material_governance_material_candidates_group_material_uq",
    "material_governance_alternatives_main_run_fk",
    "material_governance_alternatives_alt_run_fk",
    "material_governance_decisions_group_uq",
    "material_governance_material_links_decision_group_fk",
    "material_governance_material_links_created_draft_material_uq",
    "material_governance_events_decision_group_fk",
    "material_governance_groups_identity_ck",
    "material_governance_groups_values_ck",
  ]) assert.match(migration, new RegExp(token), token);

  assert.ok(snapshot.tables["public.material_governance_material_links"].indexes.material_governance_material_links_created_draft_material_uq);

  assert.match(migration, /REFERENCES "public"\."material_import_normalized_rows"\("id"\) ON DELETE restrict/);
  assert.match(migration, /REFERENCES "public"\."material_import_rows"\("id"\) ON DELETE restrict/);
  assert.match(migration, /REFERENCES "public"\."material_master"\("id"\) ON DELETE restrict/);
  assert.match(migration, /'RES','CAP','IND','DIODE','TRANS','IC','OSC','CON','MECH','OTHER'/);
  assert.match(migration, /'BIND_EXISTING','CREATE_DRAFT','EXCLUDE'/);
  assert.match(migration, /'BOUND_ACTIVE','DRAFT_CREATED','EXCLUDED'/);

  const groupParentIndex = migration.indexOf('CREATE UNIQUE INDEX "material_governance_groups_id_run_uq"');
  const groupCompositeForeignKey = migration.indexOf('ADD CONSTRAINT "material_governance_alternatives_main_run_fk"');
  const decisionParentIndex = migration.indexOf('CREATE UNIQUE INDEX "material_governance_decisions_id_group_uq"');
  const decisionCompositeForeignKey = migration.indexOf('ADD CONSTRAINT "material_governance_events_decision_group_fk"');
  assert.ok(groupParentIndex >= 0 && groupParentIndex < groupCompositeForeignKey, "group composite parent key must precede foreign keys");
  assert.ok(decisionParentIndex >= 0 && decisionParentIndex < decisionCompositeForeignKey, "decision composite parent key must precede foreign keys");
});

test("0035 permits only service inserts and one service-managed terminal group decision", () => {
  const factFunctionStart = migration.indexOf("CREATE FUNCTION cyd_material_governance_fact_guard");
  const groupFunctionStart = migration.indexOf("CREATE FUNCTION cyd_material_governance_group_guard");
  assert.ok(factFunctionStart >= 0);
  assert.ok(groupFunctionStart > factFunctionStart);
  const factFunction = migration.slice(factFunctionStart, groupFunctionStart);
  const groupFunction = migration.slice(groupFunctionStart, migration.indexOf("CREATE TRIGGER material_governance_runs_guard"));

  assert.ok(factFunction.indexOf("TG_OP IN ('UPDATE', 'DELETE')") < factFunction.indexOf("current_setting('cyd.material_governance_service_write', true)"));
  assert.match(factFunction, /material governance facts are immutable/);
  assert.match(factFunction, /ERRCODE = '55000'/);
  assert.match(factFunction, /ERRCODE = '42501'/);

  assert.match(groupFunction, /TG_OP = 'DELETE'/);
  assert.match(groupFunction, /current_setting\('cyd\.material_governance_service_write', true\) IS DISTINCT FROM 'allowed'/);
  assert.match(groupFunction, /NEW\.decision_status <> 'PENDING' OR NEW\.version <> 1/);
  assert.match(groupFunction, /OLD\.decision_status <> 'PENDING'/);
  assert.match(groupFunction, /NEW\.decision_status NOT IN \('BOUND_ACTIVE', 'DRAFT_CREATED', 'EXCLUDED'\)/);
  assert.match(groupFunction, /NEW\.version <> 2/);
  assert.match(groupFunction, /NEW\.merge_evidence/);
  assert.match(groupFunction, /OLD\.merge_evidence/);

  for (const tableName of immutableFactTables) {
    const triggerName = `${tableName}_guard`;
    const expected = new RegExp(
      `CREATE TRIGGER ${triggerName}\\s+BEFORE INSERT OR UPDATE OR DELETE ON ${tableName}\\s+FOR EACH ROW EXECUTE FUNCTION cyd_material_governance_fact_guard\\(\\);`,
    );
    assert.match(migration, expected, triggerName);
  }
  assert.match(
    migration,
    /CREATE TRIGGER material_governance_groups_guard\s+BEFORE INSERT OR UPDATE OR DELETE ON material_governance_groups\s+FOR EACH ROW EXECUTE FUNCTION cyd_material_governance_group_guard\(\);/,
  );
});
