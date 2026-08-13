import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseStrictJson } from "../scripts/backup-recovery-contract.mjs";
import { clusterSha256 } from "../scripts/postgresql-cluster-recovery-contract.mjs";
import {
  RUNTIME_PRIVILEGE_CATALOG_REPORT_CONTRACT,
  RUNTIME_PRIVILEGE_COMPILED_CATALOG_CONTRACT,
  RUNTIME_PRIVILEGE_COMPILER_PATHS,
  RUNTIME_PRIVILEGE_POSTGRES_IMAGE,
  parseRuntimePrivilegeCatalogReport,
  validateRuntimePrivilegeCompiledCatalog,
  verifyRuntimePrivilegeCompiledCatalogSources,
} from "../scripts/postgresql-runtime-privilege-catalog.mjs";
import { validateRuntimePrivilegeAccessDocument } from "../scripts/postgresql-runtime-privilege-source.mjs";

const access = validateRuntimePrivilegeAccessDocument(parseStrictJson(await readFile(new URL("../operations/postgresql-runtime-privilege-access-v2.json", import.meta.url), "utf8")));
const hash = "a".repeat(64);
const compiler = RUNTIME_PRIVILEGE_COMPILER_PATHS.map((path, index) => ({ path, sha256: (index + 1).toString(16).repeat(64) }));
const table = (name) => ({
  name, kind: "TABLE", owner: "MIGRATION_OWNER", persistence: "PERMANENT", row_security: false,
  force_row_security: false, replica_identity: "DEFAULT", access_method: "heap", tablespace: null,
  is_partition: false, partition_parent: null, relation_options: [], toast_options: [],
});
const sequence = (name, owner) => ({
  name, owner: "MIGRATION_OWNER", data_type: "bigint", start_value: "1", minimum_value: "1",
  maximum_value: "9223372036854775807", increment_by: "1", cache_size: "1", cycle: false,
  persistence: "PERMANENT", tablespace: null, owned_table: owner.table, owned_column: owner.column,
});
const routine = (identity) => {
  const name = identity.slice("public.".length, identity.indexOf("("));
  return {
    identity, name, kind: "FUNCTION", owner: "MIGRATION_OWNER", language: "plpgsql", result: "trigger",
    security_definer: false, leakproof: false, volatility: "VOLATILE", parallel: "UNSAFE", strict: false,
    returns_set: false, configuration: [], extension: null, definition_sha256: hash,
  };
};
const extensionRoutine = (identity, extension) => {
  const name = identity.slice("public.".length, identity.indexOf("("));
  return {
    identity, name, kind: "FUNCTION", owner: "PLATFORM_OWNER", language: "c", result: "bytea",
    security_definer: false, leakproof: false, volatility: "IMMUTABLE", parallel: "SAFE", strict: true,
    returns_set: false, configuration: [], extension, definition_sha256: hash,
  };
};
const extensionRoutines = [
  ...Array.from({ length: 188 }, (_, index) => extensionRoutine(`public.btree_gist_fixture_${String(index).padStart(3, "0")}()`, "btree_gist")),
  ...Array.from({ length: 36 }, (_, index) => extensionRoutine(`public.pgcrypto_fixture_${String(index).padStart(3, "0")}()`, "pgcrypto")),
];
const extensions = [
  { name: "btree_gist", version: "1.7", schema: "public", owner: "MIGRATION_OWNER", member_count: 264, member_fingerprint: "4a26469a33ed80ccbde3fe6a4ff2ceda1378dc6334791652c6f7cb24206aadd3" },
  { name: "pgcrypto", version: "1.3", schema: "public", owner: "MIGRATION_OWNER", member_count: 36, member_fingerprint: "d955c85a06a23f83029f5e33403a5635154f29e21ec05b203947200eb761a6fc" },
  { name: "plpgsql", version: "1.0", schema: "pg_catalog", owner: "PLATFORM_OWNER", member_count: 4, member_fingerprint: "84a784513dcf2b75afdb490ff4ab424391db1a751cd85ff43ea4f28d1918bddf" },
];
const unsupported = Object.fromEntries([
  "unexpected_schema_count", "unsupported_relation_count", "partition_count", "row_security_relation_count",
  "policy_count", "large_object_count", "publication_count", "subscription_count", "event_trigger_count",
  "foreign_data_wrapper_count", "foreign_server_count", "user_mapping_count", "application_collation_count",
  "application_conversion_count", "application_operator_count", "application_operator_class_count",
  "application_operator_family_count", "application_statistics_count", "column_acl_count",
  "default_privilege_count", "custom_tablespace_count", "parameter_acl_count",
  "user_rule_count", "access_method_count", "cast_count", "replication_origin_count",
  "security_label_count", "text_search_object_count", "transform_count", "unapproved_language_count",
  "unsupported_extension_member_class_count",
].map((field) => [field, 0]));

function fixture() {
  const catalog = {
    schema: "public",
    schema_owner: "pg_database_owner",
    tables: access.catalog.tables.map(table),
    sequences: access.catalog.sequences.map((name, index) => sequence(name, access.catalog.sequence_owners[index])),
    routines: [...access.catalog.application_routines.map(routine), ...extensionRoutines].sort((left, right) => Buffer.compare(Buffer.from(left.identity), Buffer.from(right.identity))),
    standalone_types: [
      ...["gbtreekey16", "gbtreekey2", "gbtreekey32", "gbtreekey4", "gbtreekey8", "gbtreekey_var"].map((name) => ({ identity: `public.${name}`, name, kind: "BASE", owner: "PLATFORM_OWNER", extension: "btree_gist", category: "U", preferred: false, collatable: false, passed_by_value: false, alignment: "i", storage: "x" })),
    ],
    extensions,
    structural_surfaces: {
      columns: { count: 3132, sha256: "47511ceeaaadba0d80b7c5c81d1e38b5f88d32c7d74d2e1996ecd2af45d802d1" },
      constraints: { count: 1709, sha256: "d6674bbe64ccf551d380e33a1ab6304e0535aa79455867ef8b5f1bf7292f2bb2" },
      indexes: { count: 957, sha256: "9ffe3343516771b31dd0585b80c470905402bdd0adcb176972a2d23da150bc2c" },
      triggers: { count: 285, sha256: "97730e77b065f75fb579d3d2b5e8a74382f5044a12f3d5e31f10184208aa606c" },
    },
    unsupported,
  };
  const body = {
    schema_version: 1,
    contract: RUNTIME_PRIVILEGE_COMPILED_CATALOG_CONTRACT,
    artifact_class: "POSTGRESQL17_COMPILED_CATALOG",
    evidence_scope: "SYNTHETIC_ISOLATED_ONLY",
    resolves: ["POSTGRESQL17_COMPILED_CATALOG_REQUIRED"],
    source_binding: {
      migrations: { count: 46, head: access.source.migration_head, source_set_sha256: access.source.migration_set_sha256, allowlist_sha256: hash, applied_ledger_sha256: hash },
      drizzle_snapshot: access.source.drizzle_snapshot,
      drizzle_journal: { path: "drizzle-postgres/meta/_journal.json", count: 46, head: access.source.migration_head, sha256: hash },
      access_intent: { path: "operations/postgresql-runtime-privilege-access-v2.json", contract: access.contract, access_sha256: access.access_sha256, file_sha256: hash },
      compiler,
    },
    engine_binding: { image_reference: RUNTIME_PRIVILEGE_POSTGRES_IMAGE, server_major: "17", server_version_num: "170010", encoding: "UTF8", locale_provider: "libc", collate: "C", ctype: "C", collation_version: null },
    catalog,
    catalog_sha256: clusterSha256(catalog),
  };
  return { ...body, artifact_sha256: clusterSha256(body) };
}

function resign(value) {
  value.catalog_sha256 = clusterSha256(value.catalog);
  const { artifact_sha256: ignored, ...body } = value;
  void ignored;
  value.artifact_sha256 = clusterSha256(body);
  return value;
}

test("compiled catalog contract fixes PG17, source intent, complete object sets and structural surfaces", () => {
  const value = fixture();
  assert.equal(validateRuntimePrivilegeCompiledCatalog(value, { access }), value);
  assert.equal(value.catalog.tables.length, 234);
  assert.equal(value.catalog.sequences.length, 211);
  assert.equal(value.catalog.routines.filter((item) => item.extension === null).length, 170);
});

test("repository compiled catalog is current, source-bound and below the fixed size ceiling", async () => {
  const raw = await readFile(new URL("../operations/postgresql-runtime-privilege-compiled-catalog-v1.json", import.meta.url));
  assert.ok(raw.byteLength < 512 * 1024);
  const value = parseStrictJson(raw.toString("utf8"));
  const runtimePolicy = parseStrictJson(await readFile(new URL("../release/test-runtime-policy-v1.json", import.meta.url), "utf8"));
  assert.equal(createHash("sha256").update(raw).digest("hex"), runtimePolicy.postgres_runtime_catalog.file_sha256);
  assert.equal(value.artifact_sha256, runtimePolicy.postgres_runtime_catalog.artifact_sha256);
  assert.equal(value.engine_binding.image_reference, runtimePolicy.postgres_runtime_catalog.image_reference);
  await verifyRuntimePrivilegeCompiledCatalogSources(value);
  assert.deepEqual({
    tables: value.catalog.tables.length,
    sequences: value.catalog.sequences.length,
    routines: value.catalog.routines.length,
    types: value.catalog.standalone_types.length,
    extensions: value.catalog.extensions.length,
    columns: value.catalog.structural_surfaces.columns.count,
    constraints: value.catalog.structural_surfaces.constraints.count,
    indexes: value.catalog.structural_surfaces.indexes.count,
    triggers: value.catalog.structural_surfaces.triggers.count,
  }, { tables: 234, sequences: 211, routines: 394, types: 6, extensions: 3, columns: 3132, constraints: 1709, indexes: 957, triggers: 285 });
});

test("compiled catalog rejects unknown fields, source drift, object drift, unsupported surfaces and stale hashes", () => {
  const mutations = [
    (value) => { value.extra = true; },
    (value) => { value.source_binding.migrations.head = "0045_runtime_worker_readiness.sql"; },
    (value) => { value.catalog.tables.pop(); },
    (value) => { value.catalog.tables.reverse(); },
    (value) => { value.catalog.routines.find((item) => item.extension === null).owner = "other"; },
    (value) => { value.catalog.unsupported.large_object_count = 1; },
    (value) => { value.catalog.unsupported.unsupported_extension_member_class_count = 1; },
    (value) => { value.engine_binding.image_reference = "postgres:17"; },
    (value) => { value.catalog.structural_surfaces.triggers.count = 0; },
    (value) => { value.catalog.structural_surfaces.triggers.sha256 = "b".repeat(64); },
    (value) => { value.catalog.extensions[1].version = "1.4"; },
    (value) => { value.catalog.extensions[1].member_fingerprint = "b".repeat(64); },
    (value) => { value.catalog.extensions[1].member_count += 1; },
    (value) => { value.catalog.tables[0].relation_options = ["autovacuum_enabled=false"]; },
    (value) => { value.catalog.tables[0].toast_options = ["autovacuum_enabled=false"]; },
    (value) => { value.catalog.routines[0].configuration = ["secret.custom_guc=value"]; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(fixture());
    mutate(value);
    resign(value);
    assert.throws(() => validateRuntimePrivilegeCompiledCatalog(value, { access }), /RUNTIME_PRIVILEGE_/);
  }
  const stale = fixture();
  stale.artifact_sha256 = "c".repeat(64);
  assert.throws(() => validateRuntimePrivilegeCompiledCatalog(stale, { access }), /RUNTIME_PRIVILEGE_COMPILED_SHA256_INVALID/);
});

test("report parser is strict about ordering, duplicate JSON keys, canonical values and required singleton records", () => {
  const meta = JSON.stringify({
    contract: RUNTIME_PRIVILEGE_CATALOG_REPORT_CONTRACT, database: "catalog_test", schema: "public",
    server_major: "17", server_version_num: "170010", encoding: "UTF8", locale_provider: "libc",
    collate: "C", ctype: "C", collation_version: null, database_owner: "MIGRATION_OWNER", schema_owner: "pg_database_owner",
  });
  assert.throws(() => parseRuntimePrivilegeCatalogReport(`META\t${meta}\nUNSUPPORTED\t${JSON.stringify(unsupported)}\nMIGRATION\t${JSON.stringify({ version: access.source.migration_head, checksum: hash })}\n`), /RUNTIME_PRIVILEGE_CATALOG_REPORT_ORDER_INVALID/);
  assert.throws(() => parseRuntimePrivilegeCatalogReport(`META\t${meta.slice(0, -1)},\"schema\":\"public\"}\nUNSUPPORTED\t${JSON.stringify(unsupported)}\n`), /RUNTIME_PRIVILEGE_CATALOG_REPORT_DUPLICATE_KEY/);
  assert.throws(() => parseRuntimePrivilegeCatalogReport(`META\t${meta}\r\nUNSUPPORTED\t${JSON.stringify(unsupported)}\r\n`), /RUNTIME_PRIVILEGE_CATALOG_REPORT_INVALID/);
  assert.throws(() => parseRuntimePrivilegeCatalogReport(`META\t${meta}\n`), /RUNTIME_PRIVILEGE_CATALOG_REPORT_INVALID|RUNTIME_PRIVILEGE_CATALOG_REPORT_REQUIRED_RECORD_MISSING/);
});

test("catalog SQL is read-only and never inspects password or large-object contents", async () => {
  const sql = await readFile(new URL("../scripts/postgresql-runtime-privilege-catalog.sql", import.meta.url), "utf8");
  assert.match(sql, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY/);
  assert.match(sql, /SET default_transaction_read_only = on/);
  for (const catalog of ["pg_attribute", "pg_constraint", "pg_index", "pg_trigger", "pg_sequence", "pg_proc", "pg_type", "pg_extension", "pg_largeobject_metadata"]) assert.match(sql, new RegExp(catalog));
  for (const catalog of ["pg_rewrite", "pg_am", "pg_cast", "pg_replication_origin", "pg_seclabel", "pg_shseclabel", "pg_ts_config", "pg_transform", "pg_language"]) assert.match(sql, new RegExp(catalog));
  assert.match(sql, /expected_marker/);
  assert.match(sql, /expected_system_identifier/);
  assert.doesNotMatch(sql, /\bpg_authid\b|\bpg_shadow\b|\brolpassword\b|\bpg_largeobject\b(?!_metadata)/i);
  const executable = sql.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");
  assert.doesNotMatch(executable, /\b(?:UPDATE|DELETE|ALTER|DROP|GRANT|REVOKE)\b/i);
  assert.equal((executable.match(/\bINSERT\s+INTO\b/gi) || []).length, 1);
  assert.match(executable, /INSERT INTO cyd_extension_members/);
});
