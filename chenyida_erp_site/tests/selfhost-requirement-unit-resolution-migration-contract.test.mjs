import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const siteRoot = new URL("../", import.meta.url);
const migrationName = "0036_project_requirement_unit_resolution.sql";
const migration = await readFile(new URL(`drizzle-postgres/${migrationName}`, siteRoot), "utf8");
const schema = await readFile(new URL("db/schema.ts", siteRoot), "utf8");
const snapshot = JSON.parse(await readFile(new URL("drizzle-postgres/meta/0036_snapshot.json", siteRoot), "utf8"));
const previousSnapshot = JSON.parse(await readFile(new URL("drizzle-postgres/meta/0035_snapshot.json", siteRoot), "utf8"));
const journal = JSON.parse(await readFile(new URL("drizzle-postgres/meta/_journal.json", siteRoot), "utf8"));
const migrationNames = (await readdir(new URL("drizzle-postgres/", siteRoot)))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

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
  const factory = /\b(?:bigserial|bigint|boolean|date|integer|jsonb|numeric|text|timestamptz|timestamp|uuid)\("([a-z0-9_]+)"/g;
  return [...schemaTableBlock(tableName).matchAll(factory)].map((match) => match[1]);
}

test("0036 is the only new migration and preserves the immutable 0035 checksum", async () => {
  assert.equal(migrationNames.length, 36);
  assert.equal(migrationNames.at(-1), migrationName);
  const previous = await readFile(new URL("drizzle-postgres/0035_bom_material_governance.sql", siteRoot));
  assert.equal(
    createHash("sha256").update(previous).digest("hex"),
    "d64ec733bb937d8cde11d93d5370605fb7e754ffb0c93d2f9795c8d7b66c9714",
  );
});

test("0036 journal and snapshot form the next immutable migration link", () => {
  assert.equal(journal.entries.at(-1)?.idx, 36);
  assert.equal(journal.entries.at(-1)?.tag, "0036_project_requirement_unit_resolution");
  assert.equal(snapshot.prevId, previousSnapshot.id);
  assert.match(snapshot.id, /^[0-9a-f-]{36}$/);
});

test("0036 migration schema and snapshot expose matching version and head tables", () => {
  for (const tableName of [
    "project_requirement_unit_resolution_versions",
    "project_requirement_unit_resolution_heads",
  ]) {
    const snapshotTable = snapshot.tables[`public.${tableName}`];
    assert.ok(snapshotTable, tableName);
    assert.deepEqual(sorted(migrationColumns(tableName)), sorted(Object.keys(snapshotTable.columns)), `${tableName} migration columns`);
    assert.deepEqual(sorted(schemaColumns(tableName)), sorted(Object.keys(snapshotTable.columns)), `${tableName} schema columns`);
  }

  const packageSnapshot = snapshot.tables["public.project_planning_package_items"];
  assert.equal(packageSnapshot.columns.unit_resolution_id.notNull, false);
  assert.ok(packageSnapshot.foreignKeys.project_planning_package_items_unit_resolution_provenance_fk);
  assert.ok(packageSnapshot.indexes.project_planning_package_items_unit_resolution_idx);
  assert.match(schemaTableBlock("project_planning_package_items"), /unitResolutionId: bigint\("unit_resolution_id"/);
});

test("0036 declares composite ownership provenance CAS and append-only constraints", () => {
  for (const token of [
    "project_requirement_versions_id_project_uq",
    "project_requirement_items_id_version_uq",
    "project_requirement_unit_resolution_versions_item_no_uq",
    "project_requirement_unit_resolution_versions_chain_no_uq",
    "project_requirement_unit_resolution_versions_id_chain_uq",
    "project_requirement_unit_resolution_versions_id_item_unit_uq",
    "project_requirement_unit_resolution_versions_project_version_fk",
    "project_requirement_unit_resolution_versions_item_version_fk",
    "project_requirement_unit_resolution_versions_supersedes_chain_fk",
    "project_requirement_unit_resolution_heads_current_chain_fk",
    "project_planning_package_items_unit_resolution_provenance_fk",
  ]) assert.match(migration, new RegExp(token), token);

  const versionSnapshot = snapshot.tables["public.project_requirement_unit_resolution_versions"];
  const headSnapshot = snapshot.tables["public.project_requirement_unit_resolution_heads"];
  assert.ok(versionSnapshot.foreignKeys.project_requirement_unit_resolution_versions_project_version_fk);
  assert.ok(versionSnapshot.foreignKeys.project_requirement_unit_resolution_versions_item_version_fk);
  assert.ok(versionSnapshot.foreignKeys.project_requirement_unit_resolution_versions_supersedes_chain_fk);
  assert.ok(headSnapshot.foreignKeys.project_requirement_unit_resolution_heads_current_chain_fk);
  assert.ok(headSnapshot.indexes.project_requirement_unit_resolution_heads_current_uq);
  assert.ok(snapshot.tables["public.project_requirement_versions"].indexes.project_requirement_versions_id_project_uq);
  assert.ok(snapshot.tables["public.project_requirement_items"].indexes.project_requirement_items_id_version_uq);

  assert.match(migration, /'ENGINEERING_CONFIRMED','REQUIREMENT_DECLARED'/);
  assert.match(migration, /requirement unit resolution versions are immutable/);
  assert.match(migration, /NEW\.version<>OLD\.version\+1/);
  assert.match(migration, /current_resolution_version IS DISTINCT FROM NEW\.version/);
});

test("0036 uses expand backfill constrain order and never guesses a pending unit", () => {
  const expand = migration.indexOf('CREATE TABLE "project_requirement_unit_resolution_versions"');
  const backfill = migration.indexOf('INSERT INTO "project_requirement_unit_resolution_versions"');
  const constraints = migration.indexOf('ADD CONSTRAINT "project_requirement_unit_resolution_versions_project_id_business_projects_id_fk"');
  const guards = migration.indexOf("CREATE OR REPLACE FUNCTION cyd_requirement_unit_resolution_version_guard");
  assert.ok(expand >= 0 && expand < backfill && backfill < constraints && constraints < guards);

  const backfillBlock = migration.slice(backfill, constraints);
  assert.match(backfillBlock, /ri\."unit_pending"=false AND ri\."unit_id" is not null/);
  assert.match(backfillBlock, /'REQUIREMENT_DECLARED'/);
  assert.match(backfillBlock, /digest\(.+?'sha256'\)/s);
  assert.match(backfillBlock, /unresolved_pending_count/);
  assert.doesNotMatch(backfillBlock, /JOIN\s+"?bom_lines|JOIN\s+"?units|base_unit_id/i);
  assert.doesNotMatch(migration, /UPDATE\s+"?project_requirement_items"?/i);
});

test("0036 guards require controlled writes and exact current enabled package provenance", () => {
  const versionGuard = migration.slice(
    migration.indexOf("CREATE OR REPLACE FUNCTION cyd_requirement_unit_resolution_version_guard"),
    migration.indexOf("CREATE OR REPLACE FUNCTION cyd_requirement_unit_resolution_head_guard"),
  );
  const headGuard = migration.slice(
    migration.indexOf("CREATE OR REPLACE FUNCTION cyd_requirement_unit_resolution_head_guard"),
    migration.indexOf("CREATE OR REPLACE FUNCTION cyd_planning_item_guard"),
  );
  const packageGuard = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION cyd_planning_item_guard"));

  assert.match(versionGuard, /NEW\.source_type='ENGINEERING_CONFIRMED'[\s\S]+current_setting\('cyd\.planning_service_write', true\) IS DISTINCT FROM 'allowed'/);
  assert.match(versionGuard, /NEW\.source_type='REQUIREMENT_DECLARED'[\s\S]+current_setting\('cyd\.project_service_write', true\) IS DISTINCT FROM 'allowed'/);
  assert.match(versionGuard, /TG_OP<>'INSERT'/);
  assert.match(versionGuard, /u\.enabled=true/);
  assert.match(versionGuard, /ri\.unit_pending=false AND ri\.unit_id=NEW\.unit_id/);
  assert.match(versionGuard, /declared requirement unit provenance can only create the initial version/);
  assert.match(versionGuard, /pp\.status<>'RETURNED'/);
  assert.match(headGuard, /requirement unit resolution heads cannot be deleted/);
  assert.match(headGuard, /stable requirement unit resolution head fields are immutable/);
  assert.match(headGuard, /current_setting\('cyd\.planning_service_write', true\) IS DISTINCT FROM 'allowed'/);
  assert.match(headGuard, /current_setting\('cyd\.project_service_write', true\) IS NOT DISTINCT FROM 'allowed'/);
  assert.match(headGuard, /current_source_type='REQUIREMENT_DECLARED'/);
  assert.match(packageGuard, /NEW\.unit_resolution_id IS NULL/);
  assert.match(packageGuard, /uh\.current_resolution_id=ur\.id/);
  assert.match(packageGuard, /ur\.requirement_item_id=NEW\.requirement_item_id/);
  assert.match(packageGuard, /ur\.unit_id=NEW\.unit_id/);
  assert.match(packageGuard, /u\.enabled=true/);
});
