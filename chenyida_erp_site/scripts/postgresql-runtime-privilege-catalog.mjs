import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "./backup-recovery-contract.mjs";
import { canonicalClusterJson, clusterSha256 } from "./postgresql-cluster-recovery-contract.mjs";
import {
  RUNTIME_PRIVILEGE_ACCESS_CONTRACT,
  RUNTIME_PRIVILEGE_ACCESS_PATH,
  createRuntimePrivilegeAccessDocument,
  validateRuntimePrivilegeAccessDocument,
} from "./postgresql-runtime-privilege-source.mjs";

export const RUNTIME_PRIVILEGE_CATALOG_REPORT_CONTRACT = "chenyida-erp-postgresql-runtime-privilege-catalog-report/v1";
export const RUNTIME_PRIVILEGE_COMPILED_CATALOG_CONTRACT = "chenyida-erp-postgresql-runtime-compiled-catalog/v1";
export const RUNTIME_PRIVILEGE_COMPILED_CATALOG_PATH = "operations/postgresql-runtime-privilege-compiled-catalog-v1.json";
export const RUNTIME_PRIVILEGE_CATALOG_SQL_PATH = "scripts/postgresql-runtime-privilege-catalog.sql";
export const RUNTIME_PRIVILEGE_CATALOG_COMPILER_PATH = "scripts/postgresql-runtime-privilege-catalog.mjs";
export const RUNTIME_PRIVILEGE_SYNTHETIC_DATABASE = "runtime_privilege_catalog_test";
export const RUNTIME_PRIVILEGE_COMPILER_PATHS = Object.freeze([
  RUNTIME_PRIVILEGE_CATALOG_COMPILER_PATH,
  RUNTIME_PRIVILEGE_CATALOG_SQL_PATH,
  "scripts/release-gate-lock.sh",
  "scripts/run-runtime-privilege-catalog-postgres-test.sh",
  "tests/selfhost-postgresql-runtime-privilege-catalog-postgres.sh",
  "tests/runtime-privilege-operator-postgres-fixture.mjs",
  "scripts/backup-recovery-contract.mjs",
  "scripts/postgresql-cluster-recovery-contract.mjs",
  "scripts/postgresql-runtime-privilege-source.mjs",
]);
export const RUNTIME_PRIVILEGE_POSTGRES_IMAGE = "postgres@sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394";

const SITE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const MAX_REPORT_BYTES = 64 * 1024 * 1024;
const MAX_CATALOG_BYTES = 512 * 1024;
const MAX_MIGRATION_BYTES = 8 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[a-z_][a-z0-9_$-]{0,62}$/;
const MIGRATION = /^\d{4}_[a-z0-9_]+\.sql$/;
const RECORD_TYPES = Object.freeze([
  "META", "MIGRATION", "TABLE", "SEQUENCE", "ROUTINE", "TYPE", "EXTENSION",
  "COLUMN", "CONSTRAINT", "INDEX", "TRIGGER", "UNSUPPORTED",
]);
const PHASE = new Map(RECORD_TYPES.map((type, index) => [type, index]));
const ARRAY_RECORDS = Object.freeze({
  MIGRATION: "migrations",
  TABLE: "tables",
  SEQUENCE: "sequences",
  ROUTINE: "routines",
  TYPE: "types",
  EXTENSION: "extensions",
  COLUMN: "columns",
  CONSTRAINT: "constraints",
  INDEX: "indexes",
  TRIGGER: "triggers",
});
const UNSUPPORTED_FIELDS = Object.freeze([
  "unexpected_schema_count", "unsupported_relation_count", "partition_count",
  "row_security_relation_count", "policy_count", "large_object_count", "publication_count",
  "subscription_count", "event_trigger_count", "foreign_data_wrapper_count", "foreign_server_count",
  "user_mapping_count", "application_collation_count", "application_conversion_count",
  "application_operator_count", "application_operator_class_count", "application_operator_family_count",
  "application_statistics_count", "column_acl_count", "default_privilege_count",
  "custom_tablespace_count", "parameter_acl_count", "user_rule_count", "access_method_count",
  "cast_count", "replication_origin_count", "security_label_count", "text_search_object_count",
  "transform_count", "unapproved_language_count", "unsupported_extension_member_class_count",
]);
const REQUIRED_EXTENSIONS = Object.freeze(["btree_gist", "pgcrypto"]);
const ALL_EXTENSIONS = Object.freeze(["btree_gist", "pgcrypto", "plpgsql"]);
const SAFE_ROUTINE_CONFIGURATIONS = Object.freeze([
  Object.freeze([]),
  Object.freeze(["search_path=pg_catalog, public, pg_temp"]),
]);
const EXPECTED_EXTENSION_BASELINES = Object.freeze({
  btree_gist: Object.freeze({ version: "1.7", schema: "public", owner: "PLATFORM_OWNER", member_count: 264, member_fingerprint: "4a26469a33ed80ccbde3fe6a4ff2ceda1378dc6334791652c6f7cb24206aadd3" }),
  pgcrypto: Object.freeze({ version: "1.3", schema: "public", owner: "PLATFORM_OWNER", member_count: 36, member_fingerprint: "d955c85a06a23f83029f5e33403a5635154f29e21ec05b203947200eb761a6fc" }),
  plpgsql: Object.freeze({ version: "1.0", schema: "pg_catalog", owner: "PLATFORM_OWNER", member_count: 4, member_fingerprint: "84a784513dcf2b75afdb490ff4ab424391db1a751cd85ff43ea4f28d1918bddf" }),
});
const EXPECTED_EXTENSION_ROUTINE_COUNTS = Object.freeze({ btree_gist: 188, pgcrypto: 36 });
const EXPECTED_EXTENSION_TYPES = Object.freeze([
  "public.gbtreekey16", "public.gbtreekey2", "public.gbtreekey32",
  "public.gbtreekey4", "public.gbtreekey8", "public.gbtreekey_var",
]);
const EXPECTED_STRUCTURAL_SURFACES = Object.freeze({
  columns: Object.freeze({ count: 3132, sha256: "47511ceeaaadba0d80b7c5c81d1e38b5f88d32c7d74d2e1996ecd2af45d802d1" }),
  constraints: Object.freeze({ count: 1709, sha256: "d6674bbe64ccf551d380e33a1ab6304e0535aa79455867ef8b5f1bf7292f2bb2" }),
  indexes: Object.freeze({ count: 957, sha256: "9ffe3343516771b31dd0585b80c470905402bdd0adcb176972a2d23da150bc2c" }),
  triggers: Object.freeze({ count: 285, sha256: "97730e77b065f75fb579d3d2b5e8a74382f5044a12f3d5e31f10184208aa606c" }),
});

export class RuntimePrivilegeCatalogError extends Error {
  constructor(code) {
    super(code);
    this.name = "RuntimePrivilegeCatalogError";
    this.code = code;
  }
}

function reject(code) {
  throw new RuntimePrivilegeCatalogError(code);
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
  return value;
}

function text(value, code, { nullable = false, pattern = null, empty = false } = {}) {
  if (nullable && value === null) return value;
  if (typeof value !== "string" || (!empty && value.length === 0) || value !== value.normalize("NFC") || (pattern && !pattern.test(value))) reject(code);
  return value;
}

function boolean(value, code) {
  if (typeof value !== "boolean") reject(code);
  return value;
}

function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) reject(code);
  return value;
}

function nullableText(value, code) {
  return text(value, code, { nullable: true });
}

function byteCompare(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function orderedUnique(records, key, code) {
  if (!Array.isArray(records)) reject(code);
  let previous = null;
  for (const record of records) {
    const identity = key(record);
    text(identity, code);
    if (previous !== null && byteCompare(previous, identity) >= 0) reject(code);
    previous = identity;
  }
  return records;
}

function exactStringArray(value, expected, code) {
  if (!Array.isArray(value) || value.length !== expected.length || value.some((item, index) => item !== expected[index])) reject(code);
  return value;
}

function orderedStringArray(value, code) {
  if (!Array.isArray(value)) reject(code);
  let previous = null;
  for (const item of value) {
    text(item, code);
    if (previous !== null && byteCompare(previous, item) >= 0) reject(code);
    previous = item;
  }
  return value;
}

function walkCanonicalSafety(value, code) {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value !== value.normalize("NFC") || value.includes("\u0000")) reject(code);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) reject(code);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkCanonicalSafety(item, code);
    return;
  }
  if (!value || typeof value !== "object") reject(code);
  for (const [key, item] of Object.entries(value)) {
    text(key, code);
    walkCanonicalSafety(item, code);
  }
}

function parseRecordLine(line) {
  const separator = line.indexOf("\t");
  if (separator <= 0 || line.indexOf("\t", separator + 1) !== -1) reject("RUNTIME_PRIVILEGE_CATALOG_REPORT_LINE_INVALID");
  const type = line.slice(0, separator);
  if (!PHASE.has(type)) reject("RUNTIME_PRIVILEGE_CATALOG_REPORT_TYPE_INVALID");
  let payload;
  try {
    payload = parseStrictJson(line.slice(separator + 1));
  } catch (error) {
    if (error?.code === "JSON_DUPLICATE_KEY") reject("RUNTIME_PRIVILEGE_CATALOG_REPORT_DUPLICATE_KEY");
    reject("RUNTIME_PRIVILEGE_CATALOG_REPORT_JSON_INVALID");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) reject("RUNTIME_PRIVILEGE_CATALOG_REPORT_PAYLOAD_INVALID");
  walkCanonicalSafety(payload, "RUNTIME_PRIVILEGE_CATALOG_REPORT_VALUE_INVALID");
  return { type, payload };
}

function validateMeta(value) {
  exactKeys(value, [
    "contract", "database", "schema", "server_major", "server_version_num", "encoding",
    "locale_provider", "collate", "ctype", "collation_version", "database_owner", "schema_owner",
  ], "RUNTIME_PRIVILEGE_CATALOG_META_FIELDS_INVALID");
  if (value.contract !== RUNTIME_PRIVILEGE_CATALOG_REPORT_CONTRACT || value.schema !== "public"
    || value.server_major !== "17" || value.server_version_num !== "170010"
    || value.encoding !== "UTF8" || value.locale_provider !== "libc" || value.collate !== "C" || value.ctype !== "C"
    || value.collation_version !== null || !["MIGRATION_OWNER", "PLATFORM_OWNER"].includes(value.database_owner)
    || value.schema_owner !== "pg_database_owner") {
    reject("RUNTIME_PRIVILEGE_CATALOG_META_INVALID");
  }
  text(value.database, "RUNTIME_PRIVILEGE_CATALOG_META_INVALID", { pattern: IDENTIFIER });
  return value;
}

function validateMigration(value) {
  exactKeys(value, ["version", "checksum"], "RUNTIME_PRIVILEGE_CATALOG_MIGRATION_FIELDS_INVALID");
  text(value.version, "RUNTIME_PRIVILEGE_CATALOG_MIGRATION_INVALID", { pattern: MIGRATION });
  text(value.checksum, "RUNTIME_PRIVILEGE_CATALOG_MIGRATION_INVALID", { pattern: SHA256 });
  return value;
}

function validateTable(value) {
  exactKeys(value, [
    "name", "kind", "owner", "persistence", "row_security", "force_row_security", "replica_identity",
    "access_method", "tablespace", "is_partition", "partition_parent", "relation_options", "toast_options",
  ], "RUNTIME_PRIVILEGE_CATALOG_TABLE_FIELDS_INVALID");
  text(value.name, "RUNTIME_PRIVILEGE_CATALOG_TABLE_INVALID", { pattern: IDENTIFIER });
  for (const field of ["kind", "owner", "persistence", "replica_identity"]) text(value[field], "RUNTIME_PRIVILEGE_CATALOG_TABLE_INVALID");
  nullableText(value.access_method, "RUNTIME_PRIVILEGE_CATALOG_TABLE_INVALID");
  nullableText(value.tablespace, "RUNTIME_PRIVILEGE_CATALOG_TABLE_INVALID");
  nullableText(value.partition_parent, "RUNTIME_PRIVILEGE_CATALOG_TABLE_INVALID");
  boolean(value.row_security, "RUNTIME_PRIVILEGE_CATALOG_TABLE_INVALID");
  boolean(value.force_row_security, "RUNTIME_PRIVILEGE_CATALOG_TABLE_INVALID");
  boolean(value.is_partition, "RUNTIME_PRIVILEGE_CATALOG_TABLE_INVALID");
  orderedStringArray(value.relation_options, "RUNTIME_PRIVILEGE_CATALOG_TABLE_INVALID");
  orderedStringArray(value.toast_options, "RUNTIME_PRIVILEGE_CATALOG_TABLE_INVALID");
  return value;
}

function validateSequence(value) {
  exactKeys(value, [
    "name", "owner", "data_type", "start_value", "minimum_value", "maximum_value", "increment_by",
    "cache_size", "cycle", "persistence", "tablespace", "owned_table", "owned_column",
  ], "RUNTIME_PRIVILEGE_CATALOG_SEQUENCE_FIELDS_INVALID");
  text(value.name, "RUNTIME_PRIVILEGE_CATALOG_SEQUENCE_INVALID", { pattern: IDENTIFIER });
  for (const field of ["owned_table", "owned_column"]) {
    if (value[field] !== null) text(value[field], "RUNTIME_PRIVILEGE_CATALOG_SEQUENCE_INVALID", { pattern: IDENTIFIER });
  }
  for (const field of ["owner", "data_type", "start_value", "minimum_value", "maximum_value", "increment_by", "cache_size", "persistence"]) text(value[field], "RUNTIME_PRIVILEGE_CATALOG_SEQUENCE_INVALID");
  nullableText(value.tablespace, "RUNTIME_PRIVILEGE_CATALOG_SEQUENCE_INVALID");
  boolean(value.cycle, "RUNTIME_PRIVILEGE_CATALOG_SEQUENCE_INVALID");
  return value;
}

function validateRoutine(value) {
  exactKeys(value, [
    "identity", "name", "kind", "owner", "language", "result", "security_definer", "leakproof",
    "volatility", "parallel", "strict", "returns_set", "configuration", "extension", "definition_sha256",
  ], "RUNTIME_PRIVILEGE_CATALOG_ROUTINE_FIELDS_INVALID");
  text(value.identity, "RUNTIME_PRIVILEGE_CATALOG_ROUTINE_INVALID");
  text(value.name, "RUNTIME_PRIVILEGE_CATALOG_ROUTINE_INVALID", { pattern: IDENTIFIER });
  for (const field of ["kind", "owner", "language", "result", "volatility", "parallel"]) text(value[field], "RUNTIME_PRIVILEGE_CATALOG_ROUTINE_INVALID");
  for (const field of ["security_definer", "leakproof", "strict", "returns_set"]) boolean(value[field], "RUNTIME_PRIVILEGE_CATALOG_ROUTINE_INVALID");
  if (!Array.isArray(value.configuration)) reject("RUNTIME_PRIVILEGE_CATALOG_ROUTINE_INVALID");
  for (const setting of value.configuration) text(setting, "RUNTIME_PRIVILEGE_CATALOG_ROUTINE_INVALID");
  if (!SAFE_ROUTINE_CONFIGURATIONS.some((configuration) => canonicalClusterJson(configuration) === canonicalClusterJson(value.configuration))) {
    reject("RUNTIME_PRIVILEGE_CATALOG_ROUTINE_CONFIGURATION_UNSUPPORTED");
  }
  nullableText(value.extension, "RUNTIME_PRIVILEGE_CATALOG_ROUTINE_INVALID");
  text(value.definition_sha256, "RUNTIME_PRIVILEGE_CATALOG_ROUTINE_INVALID", { pattern: SHA256 });
  return value;
}

function validateType(value) {
  exactKeys(value, [
    "identity", "name", "kind", "owner", "extension", "category", "preferred", "collatable",
    "passed_by_value", "alignment", "storage",
  ], "RUNTIME_PRIVILEGE_CATALOG_TYPE_FIELDS_INVALID");
  text(value.identity, "RUNTIME_PRIVILEGE_CATALOG_TYPE_INVALID");
  text(value.name, "RUNTIME_PRIVILEGE_CATALOG_TYPE_INVALID", { pattern: IDENTIFIER });
  for (const field of ["kind", "owner", "category", "alignment", "storage"]) text(value[field], "RUNTIME_PRIVILEGE_CATALOG_TYPE_INVALID");
  nullableText(value.extension, "RUNTIME_PRIVILEGE_CATALOG_TYPE_INVALID");
  for (const field of ["preferred", "collatable", "passed_by_value"]) boolean(value[field], "RUNTIME_PRIVILEGE_CATALOG_TYPE_INVALID");
  return value;
}

function validateExtension(value) {
  exactKeys(value, ["name", "version", "schema", "owner", "member_count", "member_fingerprint"], "RUNTIME_PRIVILEGE_CATALOG_EXTENSION_FIELDS_INVALID");
  for (const field of ["name", "version", "schema", "owner"]) text(value[field], "RUNTIME_PRIVILEGE_CATALOG_EXTENSION_INVALID");
  integer(value.member_count, 1, 1_000_000, "RUNTIME_PRIVILEGE_CATALOG_EXTENSION_INVALID");
  text(value.member_fingerprint, "RUNTIME_PRIVILEGE_CATALOG_EXTENSION_INVALID", { pattern: SHA256 });
  return value;
}

function validateColumn(value) {
  exactKeys(value, [
    "table", "ordinal", "name", "data_type", "not_null", "identity", "generated", "collation",
    "storage", "compression", "statistics_target", "default_expression",
  ], "RUNTIME_PRIVILEGE_CATALOG_COLUMN_FIELDS_INVALID");
  text(value.table, "RUNTIME_PRIVILEGE_CATALOG_COLUMN_TABLE_INVALID", { pattern: IDENTIFIER });
  text(value.name, "RUNTIME_PRIVILEGE_CATALOG_COLUMN_NAME_INVALID", { pattern: IDENTIFIER });
  text(value.data_type, "RUNTIME_PRIVILEGE_CATALOG_COLUMN_TYPE_INVALID");
  integer(value.ordinal, 1, 32767, "RUNTIME_PRIVILEGE_CATALOG_COLUMN_ORDINAL_INVALID");
  if (value.statistics_target !== null) integer(value.statistics_target, -32768, 32767, "RUNTIME_PRIVILEGE_CATALOG_COLUMN_STATISTICS_INVALID");
  boolean(value.not_null, "RUNTIME_PRIVILEGE_CATALOG_COLUMN_NULLABILITY_INVALID");
  for (const field of ["identity", "generated", "collation", "compression", "default_expression"]) nullableText(value[field], `RUNTIME_PRIVILEGE_CATALOG_COLUMN_${field.toUpperCase()}_INVALID`);
  text(value.storage, "RUNTIME_PRIVILEGE_CATALOG_COLUMN_STORAGE_INVALID");
  return value;
}

function validateConstraint(value) {
  exactKeys(value, [
    "table", "name", "kind", "deferrable", "initially_deferred", "validated", "no_inherit",
    "parent_constraint", "definition",
  ], "RUNTIME_PRIVILEGE_CATALOG_CONSTRAINT_FIELDS_INVALID");
  text(value.table, "RUNTIME_PRIVILEGE_CATALOG_CONSTRAINT_INVALID", { pattern: IDENTIFIER });
  text(value.name, "RUNTIME_PRIVILEGE_CATALOG_CONSTRAINT_INVALID");
  text(value.kind, "RUNTIME_PRIVILEGE_CATALOG_CONSTRAINT_INVALID");
  nullableText(value.parent_constraint, "RUNTIME_PRIVILEGE_CATALOG_CONSTRAINT_INVALID");
  text(value.definition, "RUNTIME_PRIVILEGE_CATALOG_CONSTRAINT_INVALID");
  for (const field of ["deferrable", "initially_deferred", "validated", "no_inherit"]) boolean(value[field], "RUNTIME_PRIVILEGE_CATALOG_CONSTRAINT_INVALID");
  return value;
}

function validateIndex(value) {
  exactKeys(value, [
    "table", "name", "owner", "access_method", "unique", "primary", "valid", "ready", "live",
    "replica_identity", "clustered", "immediate", "exclusion", "tablespace", "definition",
  ], "RUNTIME_PRIVILEGE_CATALOG_INDEX_FIELDS_INVALID");
  text(value.table, "RUNTIME_PRIVILEGE_CATALOG_INDEX_INVALID", { pattern: IDENTIFIER });
  text(value.name, "RUNTIME_PRIVILEGE_CATALOG_INDEX_INVALID");
  for (const field of ["owner", "access_method", "definition"]) text(value[field], "RUNTIME_PRIVILEGE_CATALOG_INDEX_INVALID");
  nullableText(value.tablespace, "RUNTIME_PRIVILEGE_CATALOG_INDEX_INVALID");
  for (const field of ["unique", "primary", "valid", "ready", "live", "replica_identity", "clustered", "immediate", "exclusion"]) boolean(value[field], "RUNTIME_PRIVILEGE_CATALOG_INDEX_INVALID");
  return value;
}

function validateTrigger(value) {
  exactKeys(value, [
    "table", "name", "enabled", "deferrable", "initially_deferred", "function_identity", "definition",
  ], "RUNTIME_PRIVILEGE_CATALOG_TRIGGER_FIELDS_INVALID");
  text(value.table, "RUNTIME_PRIVILEGE_CATALOG_TRIGGER_INVALID", { pattern: IDENTIFIER });
  for (const field of ["name", "enabled", "function_identity", "definition"]) text(value[field], "RUNTIME_PRIVILEGE_CATALOG_TRIGGER_INVALID");
  boolean(value.deferrable, "RUNTIME_PRIVILEGE_CATALOG_TRIGGER_INVALID");
  boolean(value.initially_deferred, "RUNTIME_PRIVILEGE_CATALOG_TRIGGER_INVALID");
  return value;
}

function validateUnsupported(value) {
  exactKeys(value, UNSUPPORTED_FIELDS, "RUNTIME_PRIVILEGE_CATALOG_UNSUPPORTED_FIELDS_INVALID");
  for (const field of UNSUPPORTED_FIELDS) integer(value[field], 0, 1_000_000, "RUNTIME_PRIVILEGE_CATALOG_UNSUPPORTED_INVALID");
  return value;
}

const RECORD_VALIDATORS = Object.freeze({
  MIGRATION: validateMigration,
  TABLE: validateTable,
  SEQUENCE: validateSequence,
  ROUTINE: validateRoutine,
  TYPE: validateType,
  EXTENSION: validateExtension,
  COLUMN: validateColumn,
  CONSTRAINT: validateConstraint,
  INDEX: validateIndex,
  TRIGGER: validateTrigger,
});

const RECORD_IDENTITIES = Object.freeze({
  migrations: (value) => value.version,
  tables: (value) => value.name,
  sequences: (value) => value.name,
  routines: (value) => value.identity,
  types: (value) => value.identity,
  extensions: (value) => value.name,
  columns: (value) => `${value.table}\u0000${String(value.ordinal).padStart(5, "0")}\u0000${value.name}`,
  constraints: (value) => `${value.table}\u0000${value.name}`,
  indexes: (value) => `${value.table}\u0000${value.name}`,
  triggers: (value) => `${value.table}\u0000${value.name}`,
});

export function parseRuntimePrivilegeCatalogReport(source) {
  if (typeof source !== "string" || source.length === 0 || Buffer.byteLength(source, "utf8") > MAX_REPORT_BYTES
    || source.includes("\u0000") || source.includes("\r") || !source.endsWith("\n")) reject("RUNTIME_PRIVILEGE_CATALOG_REPORT_INVALID");
  const lines = source.slice(0, -1).split("\n");
  if (lines.length < 2 || lines.some((line) => line.length === 0)) reject("RUNTIME_PRIVILEGE_CATALOG_REPORT_INVALID");
  const report = {
    meta: null,
    migrations: [], tables: [], sequences: [], routines: [], types: [], extensions: [],
    columns: [], constraints: [], indexes: [], triggers: [],
    unsupported: null,
  };
  let lastPhase = -1;
  for (const line of lines) {
    const { type, payload } = parseRecordLine(line);
    const currentPhase = PHASE.get(type);
    if (currentPhase < lastPhase) reject("RUNTIME_PRIVILEGE_CATALOG_REPORT_ORDER_INVALID");
    lastPhase = currentPhase;
    if (type === "META") {
      if (report.meta !== null) reject("RUNTIME_PRIVILEGE_CATALOG_REPORT_META_DUPLICATE");
      report.meta = validateMeta(payload);
    } else if (type === "UNSUPPORTED") {
      if (report.unsupported !== null) reject("RUNTIME_PRIVILEGE_CATALOG_REPORT_UNSUPPORTED_DUPLICATE");
      report.unsupported = validateUnsupported(payload);
    } else {
      report[ARRAY_RECORDS[type]].push(RECORD_VALIDATORS[type](payload));
    }
  }
  if (report.meta === null || report.unsupported === null) reject("RUNTIME_PRIVILEGE_CATALOG_REPORT_REQUIRED_RECORD_MISSING");
  for (const [field, identity] of Object.entries(RECORD_IDENTITIES)) orderedUnique(report[field], identity, "RUNTIME_PRIVILEGE_CATALOG_REPORT_ORDER_INVALID");
  return report;
}

function surface(records) {
  return Object.freeze({
    count: records.length,
    sha256: clusterSha256(records.map((record) => canonicalClusterJson(record)).join("")),
  });
}

function validateSurface(value, code) {
  exactKeys(value, ["count", "sha256"], code);
  integer(value.count, 1, 1_000_000, code);
  text(value.sha256, code, { pattern: SHA256 });
  return value;
}

function fileSha256(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

async function stableBytes(file, maximumBytes, code) {
  return readStrictFile(file, maximumBytes, code);
}

function migrationAllowlistDigest(entries) {
  return fileSha256(Buffer.from(`${JSON.stringify(entries)}\n`, "utf8"));
}

async function buildMigrationAllowlist(directory) {
  const absolute = path.resolve(directory);
  const resolved = await realpath(absolute).catch(() => null);
  const directoryStat = await lstat(absolute).catch(() => null);
  if (resolved !== absolute || !directoryStat?.isDirectory() || directoryStat.isSymbolicLink() || (directoryStat.mode & 0o022) !== 0) {
    reject("RUNTIME_PRIVILEGE_CATALOG_MIGRATION_SOURCE_INVALID");
  }
  const names = (await readdir(absolute)).filter((name) => name.endsWith(".sql")).sort();
  const entries = [];
  for (let index = 0; index < names.length; index += 1) {
    const filename = names[index];
    if (!MIGRATION.test(filename) || Number(filename.slice(0, 4)) !== index + 1) reject("RUNTIME_PRIVILEGE_CATALOG_MIGRATION_SOURCE_INVALID");
    const raw = await stableBytes(path.join(absolute, filename), MAX_MIGRATION_BYTES, "RUNTIME_PRIVILEGE_CATALOG_MIGRATION_SOURCE_INVALID");
    entries.push({ ordinal: index + 1, filename, sha256: fileSha256(raw) });
  }
  if (entries.length < 1) reject("RUNTIME_PRIVILEGE_CATALOG_MIGRATION_SOURCE_INVALID");
  return entries;
}

async function sourceBinding(access, report, siteRoot) {
  const migrations = await buildMigrationAllowlist(path.join(siteRoot, "drizzle-postgres")).catch(() => reject("RUNTIME_PRIVILEGE_CATALOG_MIGRATION_SOURCE_INVALID"));
  if (migrations.length !== access.source.migration_count
    || migrations.at(-1)?.filename !== access.source.migration_head
    || report.migrations.length !== migrations.length
    || report.migrations.some((entry, index) => entry.version !== migrations[index].filename || entry.checksum !== migrations[index].sha256)) {
    reject("RUNTIME_PRIVILEGE_CATALOG_MIGRATION_LEDGER_MISMATCH");
  }
  const accessFile = path.join(siteRoot, RUNTIME_PRIVILEGE_ACCESS_PATH);
  const accessRaw = await stableBytes(accessFile, MAX_CATALOG_BYTES, "RUNTIME_PRIVILEGE_CATALOG_ACCESS_FILE_INVALID");
  let onDiskAccess;
  try { onDiskAccess = validateRuntimePrivilegeAccessDocument(parseStrictJson(accessRaw.toString("utf8"))); }
  catch { reject("RUNTIME_PRIVILEGE_CATALOG_ACCESS_FILE_INVALID"); }
  if (canonicalClusterJson(onDiskAccess) !== canonicalClusterJson(access)) reject("RUNTIME_PRIVILEGE_CATALOG_ACCESS_FILE_MISMATCH");

  const journalPath = path.join(siteRoot, "drizzle-postgres/meta/_journal.json");
  const journalRaw = await stableBytes(journalPath, MAX_CATALOG_BYTES, "RUNTIME_PRIVILEGE_CATALOG_JOURNAL_INVALID");
  let journal;
  try { journal = parseStrictJson(journalRaw.toString("utf8")); } catch { reject("RUNTIME_PRIVILEGE_CATALOG_JOURNAL_INVALID"); }
  if (!journal || journal.version !== "7" || journal.dialect !== "postgresql" || !Array.isArray(journal.entries)
    || journal.entries.length !== migrations.length || journal.entries.some((entry, index) => entry?.idx !== index + 1 || `${entry?.tag}.sql` !== migrations[index].filename)) {
    reject("RUNTIME_PRIVILEGE_CATALOG_JOURNAL_INVALID");
  }

  const compiler = [];
  for (const relativePath of RUNTIME_PRIVILEGE_COMPILER_PATHS) {
    const raw = await stableBytes(path.join(siteRoot, relativePath), MAX_CATALOG_BYTES, "RUNTIME_PRIVILEGE_CATALOG_COMPILER_FILE_INVALID");
    compiler.push({ path: relativePath, sha256: fileSha256(raw) });
  }
  return Object.freeze({
    migrations: {
      count: migrations.length,
      head: migrations.at(-1).filename,
      source_set_sha256: access.source.migration_set_sha256,
      allowlist_sha256: migrationAllowlistDigest(migrations),
      applied_ledger_sha256: surface(report.migrations).sha256,
    },
    drizzle_snapshot: { ...access.source.drizzle_snapshot },
    drizzle_journal: {
      path: "drizzle-postgres/meta/_journal.json",
      count: journal.entries.length,
      head: `${journal.entries.at(-1).tag}.sql`,
      sha256: fileSha256(journalRaw),
    },
    access_intent: {
      path: RUNTIME_PRIVILEGE_ACCESS_PATH,
      contract: access.contract,
      access_sha256: access.access_sha256,
      file_sha256: fileSha256(accessRaw),
    },
    compiler,
  });
}

function compareExact(left, right, code) {
  if (canonicalClusterJson(left) !== canonicalClusterJson(right)) reject(code);
}

function validateExtensionBaselines(extensions, routines, types, code) {
  exactStringArray(extensions.map((item) => item.name), ALL_EXTENSIONS, code);
  for (const extension of extensions) {
    const expected = EXPECTED_EXTENSION_BASELINES[extension.name];
    if (!expected || extension.version !== expected.version || extension.schema !== expected.schema
      || extension.owner !== expected.owner || extension.member_count !== expected.member_count
      || extension.member_fingerprint !== expected.member_fingerprint) reject(code);
  }
  for (const extension of REQUIRED_EXTENSIONS) {
    if (routines.filter((item) => item.extension === extension).length !== EXPECTED_EXTENSION_ROUTINE_COUNTS[extension]) reject(code);
  }
  compareExact(types.map((item) => item.identity), EXPECTED_EXTENSION_TYPES, code);
}

function validateStructuralSurfaces(report, code) {
  for (const [field, expected] of Object.entries(EXPECTED_STRUCTURAL_SURFACES)) {
    compareExact(surface(report[field]), expected, code);
  }
}

function validateReportAgainstAccess(report, access, expectedDatabase) {
  if (report.meta.database !== expectedDatabase || report.meta.database_owner !== "MIGRATION_OWNER") reject("RUNTIME_PRIVILEGE_CATALOG_DATABASE_IDENTITY_MISMATCH");
  if (Object.values(report.unsupported).some((count) => count !== 0)) reject("RUNTIME_PRIVILEGE_CATALOG_UNSUPPORTED_PRESENT");
  if (report.tables.some((item) => item.kind !== "TABLE" || item.owner !== "MIGRATION_OWNER" || item.persistence !== "PERMANENT"
    || item.row_security || item.force_row_security || item.replica_identity !== "DEFAULT" || item.access_method !== "heap"
    || item.tablespace !== null || item.is_partition || item.partition_parent !== null
    || item.relation_options.length !== 0 || item.toast_options.length !== 0)) reject("RUNTIME_PRIVILEGE_CATALOG_TABLE_STRUCTURE_INVALID");
  compareExact(report.tables.map((item) => item.name), access.catalog.tables, "RUNTIME_PRIVILEGE_CATALOG_TABLE_SET_MISMATCH");

  if (report.sequences.some((item) => item.owner !== "MIGRATION_OWNER" || item.persistence !== "PERMANENT"
    || item.tablespace !== null || item.cycle || item.cache_size !== "1")) reject("RUNTIME_PRIVILEGE_CATALOG_SEQUENCE_STRUCTURE_INVALID");
  compareExact(report.sequences.map((item) => item.name), access.catalog.sequences, "RUNTIME_PRIVILEGE_CATALOG_SEQUENCE_SET_MISMATCH");
  compareExact(report.sequences.map((item) => ({ sequence: item.name, table: item.owned_table, column: item.owned_column })),
    access.catalog.sequence_owners, "RUNTIME_PRIVILEGE_CATALOG_SEQUENCE_OWNER_MISMATCH");

  const applicationRoutines = report.routines.filter((item) => item.extension === null);
  if (report.routines.some((item) => ![null, ...REQUIRED_EXTENSIONS].includes(item.extension)
    || (item.extension === null ? item.owner !== "MIGRATION_OWNER" : item.owner !== "PLATFORM_OWNER"))) {
    reject("RUNTIME_PRIVILEGE_CATALOG_ROUTINE_OWNER_INVALID");
  }
  compareExact(applicationRoutines.map((item) => item.identity), access.catalog.application_routines, "RUNTIME_PRIVILEGE_CATALOG_ROUTINE_SET_MISMATCH");
  if (report.types.some((item) => item.extension === null || !REQUIRED_EXTENSIONS.includes(item.extension) || item.owner !== "PLATFORM_OWNER")) {
    reject("RUNTIME_PRIVILEGE_CATALOG_TYPE_SET_MISMATCH");
  }
  compareExact(access.catalog.application_types, [], "RUNTIME_PRIVILEGE_CATALOG_TYPE_SET_MISMATCH");

  validateExtensionBaselines(report.extensions, report.routines, report.types, "RUNTIME_PRIVILEGE_CATALOG_EXTENSION_STRUCTURE_INVALID");
  compareExact(access.catalog.required_extensions, REQUIRED_EXTENSIONS, "RUNTIME_PRIVILEGE_CATALOG_EXTENSION_SET_MISMATCH");
  if (report.columns.length === 0 || report.constraints.length === 0 || report.indexes.length === 0 || report.triggers.length === 0) {
    reject("RUNTIME_PRIVILEGE_CATALOG_STRUCTURAL_SURFACE_EMPTY");
  }
  validateStructuralSurfaces(report, "RUNTIME_PRIVILEGE_CATALOG_STRUCTURAL_SURFACE_MISMATCH");
}

function catalogBody(report) {
  return Object.freeze({
    schema: "public",
    schema_owner: report.meta.schema_owner,
    tables: report.tables,
    sequences: report.sequences,
    routines: report.routines,
    standalone_types: report.types,
    extensions: report.extensions,
    structural_surfaces: {
      columns: surface(report.columns),
      constraints: surface(report.constraints),
      indexes: surface(report.indexes),
      triggers: surface(report.triggers),
    },
    unsupported: report.unsupported,
  });
}

export async function createRuntimePrivilegeCompiledCatalog({ reportSource, access, expectedDatabase, siteRoot = SITE_ROOT }) {
  let validatedAccess;
  try { validatedAccess = validateRuntimePrivilegeAccessDocument(access); }
  catch { reject("RUNTIME_PRIVILEGE_CATALOG_ACCESS_INVALID"); }
  text(expectedDatabase, "RUNTIME_PRIVILEGE_CATALOG_DATABASE_IDENTITY_INVALID", { pattern: IDENTIFIER });
  if (expectedDatabase !== RUNTIME_PRIVILEGE_SYNTHETIC_DATABASE) reject("RUNTIME_PRIVILEGE_CATALOG_DATABASE_IDENTITY_INVALID");
  const report = parseRuntimePrivilegeCatalogReport(reportSource);
  validateReportAgainstAccess(report, validatedAccess, expectedDatabase);
  const source = await sourceBinding(validatedAccess, report, path.resolve(siteRoot));
  const catalog = catalogBody(report);
  const body = {
    schema_version: 1,
    contract: RUNTIME_PRIVILEGE_COMPILED_CATALOG_CONTRACT,
    artifact_class: "POSTGRESQL17_COMPILED_CATALOG",
    evidence_scope: "SYNTHETIC_ISOLATED_ONLY",
    resolves: ["POSTGRESQL17_COMPILED_CATALOG_REQUIRED"],
    source_binding: source,
    engine_binding: {
      image_reference: RUNTIME_PRIVILEGE_POSTGRES_IMAGE,
      server_major: report.meta.server_major,
      server_version_num: report.meta.server_version_num,
      encoding: report.meta.encoding,
      locale_provider: report.meta.locale_provider,
      collate: report.meta.collate,
      ctype: report.meta.ctype,
      collation_version: report.meta.collation_version,
    },
    catalog,
    catalog_sha256: clusterSha256(catalog),
  };
  return validateRuntimePrivilegeCompiledCatalog({ ...body, artifact_sha256: clusterSha256(body) }, { access: validatedAccess });
}

function validateSourceBinding(value, access) {
  exactKeys(value, ["migrations", "drizzle_snapshot", "drizzle_journal", "access_intent", "compiler"], "RUNTIME_PRIVILEGE_COMPILED_SOURCE_FIELDS_INVALID");
  exactKeys(value.migrations, ["count", "head", "source_set_sha256", "allowlist_sha256", "applied_ledger_sha256"], "RUNTIME_PRIVILEGE_COMPILED_SOURCE_INVALID");
  if (value.migrations.count !== access.source.migration_count || value.migrations.head !== access.source.migration_head
    || value.migrations.source_set_sha256 !== access.source.migration_set_sha256) reject("RUNTIME_PRIVILEGE_COMPILED_SOURCE_MISMATCH");
  for (const field of ["allowlist_sha256", "applied_ledger_sha256"]) text(value.migrations[field], "RUNTIME_PRIVILEGE_COMPILED_SOURCE_INVALID", { pattern: SHA256 });
  compareExact(value.drizzle_snapshot, access.source.drizzle_snapshot, "RUNTIME_PRIVILEGE_COMPILED_SOURCE_MISMATCH");
  exactKeys(value.drizzle_journal, ["path", "count", "head", "sha256"], "RUNTIME_PRIVILEGE_COMPILED_SOURCE_INVALID");
  if (value.drizzle_journal.path !== "drizzle-postgres/meta/_journal.json" || value.drizzle_journal.count !== access.source.migration_count || value.drizzle_journal.head !== access.source.migration_head) reject("RUNTIME_PRIVILEGE_COMPILED_SOURCE_MISMATCH");
  text(value.drizzle_journal.sha256, "RUNTIME_PRIVILEGE_COMPILED_SOURCE_INVALID", { pattern: SHA256 });
  exactKeys(value.access_intent, ["path", "contract", "access_sha256", "file_sha256"], "RUNTIME_PRIVILEGE_COMPILED_SOURCE_INVALID");
  if (value.access_intent.path !== RUNTIME_PRIVILEGE_ACCESS_PATH || value.access_intent.contract !== RUNTIME_PRIVILEGE_ACCESS_CONTRACT || value.access_intent.access_sha256 !== access.access_sha256) reject("RUNTIME_PRIVILEGE_COMPILED_SOURCE_MISMATCH");
  text(value.access_intent.file_sha256, "RUNTIME_PRIVILEGE_COMPILED_SOURCE_INVALID", { pattern: SHA256 });
  if (!Array.isArray(value.compiler) || value.compiler.length !== RUNTIME_PRIVILEGE_COMPILER_PATHS.length) reject("RUNTIME_PRIVILEGE_COMPILED_SOURCE_INVALID");
  compareExact(value.compiler.map((item) => item.path), RUNTIME_PRIVILEGE_COMPILER_PATHS, "RUNTIME_PRIVILEGE_COMPILED_SOURCE_MISMATCH");
  for (const item of value.compiler) {
    exactKeys(item, ["path", "sha256"], "RUNTIME_PRIVILEGE_COMPILED_SOURCE_INVALID");
    text(item.sha256, "RUNTIME_PRIVILEGE_COMPILED_SOURCE_INVALID", { pattern: SHA256 });
  }
}

function validateCompiledCatalog(value, access) {
  exactKeys(value, ["schema", "schema_owner", "tables", "sequences", "routines", "standalone_types", "extensions", "structural_surfaces", "unsupported"], "RUNTIME_PRIVILEGE_COMPILED_CATALOG_FIELDS_INVALID");
  if (value.schema !== "public" || value.schema_owner !== "pg_database_owner") reject("RUNTIME_PRIVILEGE_COMPILED_CATALOG_IDENTITY_INVALID");
  orderedUnique(value.tables, (item) => validateTable(item).name, "RUNTIME_PRIVILEGE_COMPILED_TABLES_INVALID");
  orderedUnique(value.sequences, (item) => validateSequence(item).name, "RUNTIME_PRIVILEGE_COMPILED_SEQUENCES_INVALID");
  orderedUnique(value.routines, (item) => validateRoutine(item).identity, "RUNTIME_PRIVILEGE_COMPILED_ROUTINES_INVALID");
  orderedUnique(value.standalone_types, (item) => validateType(item).identity, "RUNTIME_PRIVILEGE_COMPILED_TYPES_INVALID");
  orderedUnique(value.extensions, (item) => validateExtension(item).name, "RUNTIME_PRIVILEGE_COMPILED_EXTENSIONS_INVALID");
  if (value.tables.some((item) => item.kind !== "TABLE" || item.owner !== "MIGRATION_OWNER" || item.persistence !== "PERMANENT"
    || item.row_security || item.force_row_security || item.replica_identity !== "DEFAULT" || item.access_method !== "heap"
    || item.tablespace !== null || item.is_partition || item.partition_parent !== null
    || item.relation_options.length !== 0 || item.toast_options.length !== 0)) reject("RUNTIME_PRIVILEGE_COMPILED_TABLE_STRUCTURE_INVALID");
  if (value.sequences.some((item) => item.owner !== "MIGRATION_OWNER" || item.persistence !== "PERMANENT"
    || item.tablespace !== null || item.cycle || item.cache_size !== "1")) reject("RUNTIME_PRIVILEGE_COMPILED_SEQUENCE_STRUCTURE_INVALID");
  if (value.routines.some((item) => ![null, ...REQUIRED_EXTENSIONS].includes(item.extension)
    || (item.extension === null ? item.owner !== "MIGRATION_OWNER" : item.owner !== "PLATFORM_OWNER"))) reject("RUNTIME_PRIVILEGE_COMPILED_ROUTINE_STRUCTURE_INVALID");
  if (value.standalone_types.some((item) => item.owner !== "PLATFORM_OWNER" || !REQUIRED_EXTENSIONS.includes(item.extension))) reject("RUNTIME_PRIVILEGE_COMPILED_TYPE_STRUCTURE_INVALID");
  validateExtensionBaselines(value.extensions, value.routines, value.standalone_types, "RUNTIME_PRIVILEGE_COMPILED_EXTENSION_STRUCTURE_INVALID");
  compareExact(value.tables.map((item) => item.name), access.catalog.tables, "RUNTIME_PRIVILEGE_COMPILED_TABLE_SET_MISMATCH");
  compareExact(value.sequences.map((item) => item.name), access.catalog.sequences, "RUNTIME_PRIVILEGE_COMPILED_SEQUENCE_SET_MISMATCH");
  compareExact(value.routines.filter((item) => item.extension === null).map((item) => item.identity), access.catalog.application_routines, "RUNTIME_PRIVILEGE_COMPILED_ROUTINE_SET_MISMATCH");
  exactKeys(value.structural_surfaces, ["columns", "constraints", "indexes", "triggers"], "RUNTIME_PRIVILEGE_COMPILED_SURFACE_FIELDS_INVALID");
  for (const field of ["columns", "constraints", "indexes", "triggers"]) {
    validateSurface(value.structural_surfaces[field], "RUNTIME_PRIVILEGE_COMPILED_SURFACE_INVALID");
    compareExact(value.structural_surfaces[field], EXPECTED_STRUCTURAL_SURFACES[field], "RUNTIME_PRIVILEGE_COMPILED_SURFACE_MISMATCH");
  }
  validateUnsupported(value.unsupported);
  if (Object.values(value.unsupported).some((count) => count !== 0)) reject("RUNTIME_PRIVILEGE_COMPILED_UNSUPPORTED_PRESENT");
}

export function validateRuntimePrivilegeCompiledCatalog(value, { access } = {}) {
  let validatedAccess;
  try { validatedAccess = validateRuntimePrivilegeAccessDocument(access); }
  catch { reject("RUNTIME_PRIVILEGE_CATALOG_ACCESS_INVALID"); }
  exactKeys(value, [
    "schema_version", "contract", "artifact_class", "evidence_scope", "resolves", "source_binding",
    "engine_binding", "catalog", "catalog_sha256", "artifact_sha256",
  ], "RUNTIME_PRIVILEGE_COMPILED_FIELDS_INVALID");
  walkCanonicalSafety(value, "RUNTIME_PRIVILEGE_COMPILED_VALUE_INVALID");
  if (value.schema_version !== 1 || value.contract !== RUNTIME_PRIVILEGE_COMPILED_CATALOG_CONTRACT
    || value.artifact_class !== "POSTGRESQL17_COMPILED_CATALOG" || value.evidence_scope !== "SYNTHETIC_ISOLATED_ONLY") reject("RUNTIME_PRIVILEGE_COMPILED_IDENTITY_INVALID");
  exactStringArray(value.resolves, ["POSTGRESQL17_COMPILED_CATALOG_REQUIRED"], "RUNTIME_PRIVILEGE_COMPILED_RESOLUTION_INVALID");
  validateSourceBinding(value.source_binding, validatedAccess);
  exactKeys(value.engine_binding, ["image_reference", "server_major", "server_version_num", "encoding", "locale_provider", "collate", "ctype", "collation_version"], "RUNTIME_PRIVILEGE_COMPILED_ENGINE_FIELDS_INVALID");
  if (value.engine_binding.image_reference !== RUNTIME_PRIVILEGE_POSTGRES_IMAGE || value.engine_binding.server_major !== "17"
    || value.engine_binding.server_version_num !== "170010" || value.engine_binding.encoding !== "UTF8"
    || value.engine_binding.locale_provider !== "libc" || value.engine_binding.collate !== "C" || value.engine_binding.ctype !== "C"
    || value.engine_binding.collation_version !== null) reject("RUNTIME_PRIVILEGE_COMPILED_ENGINE_INVALID");
  validateCompiledCatalog(value.catalog, validatedAccess);
  text(value.catalog_sha256, "RUNTIME_PRIVILEGE_COMPILED_SHA256_INVALID", { pattern: SHA256 });
  if (clusterSha256(value.catalog) !== value.catalog_sha256) reject("RUNTIME_PRIVILEGE_COMPILED_SHA256_INVALID");
  text(value.artifact_sha256, "RUNTIME_PRIVILEGE_COMPILED_SHA256_INVALID", { pattern: SHA256 });
  const { artifact_sha256: ignored, ...body } = value;
  void ignored;
  if (clusterSha256(body) !== value.artifact_sha256) reject("RUNTIME_PRIVILEGE_COMPILED_SHA256_INVALID");
  return value;
}

export function validateRuntimePrivilegeCompiledCatalogIdentity(value) {
  exactKeys(value, [
    "schema_version", "contract", "artifact_class", "evidence_scope", "resolves", "source_binding",
    "engine_binding", "catalog", "catalog_sha256", "artifact_sha256",
  ], "RUNTIME_PRIVILEGE_COMPILED_FIELDS_INVALID");
  walkCanonicalSafety(value, "RUNTIME_PRIVILEGE_COMPILED_VALUE_INVALID");
  if (value.schema_version !== 1 || value.contract !== RUNTIME_PRIVILEGE_COMPILED_CATALOG_CONTRACT
    || value.artifact_class !== "POSTGRESQL17_COMPILED_CATALOG" || value.evidence_scope !== "SYNTHETIC_ISOLATED_ONLY"
    || value.engine_binding?.image_reference !== RUNTIME_PRIVILEGE_POSTGRES_IMAGE) reject("RUNTIME_PRIVILEGE_COMPILED_IDENTITY_INVALID");
  exactStringArray(value.resolves, ["POSTGRESQL17_COMPILED_CATALOG_REQUIRED"], "RUNTIME_PRIVILEGE_COMPILED_RESOLUTION_INVALID");
  text(value.catalog_sha256, "RUNTIME_PRIVILEGE_COMPILED_SHA256_INVALID", { pattern: SHA256 });
  if (clusterSha256(value.catalog) !== value.catalog_sha256) reject("RUNTIME_PRIVILEGE_COMPILED_SHA256_INVALID");
  text(value.artifact_sha256, "RUNTIME_PRIVILEGE_COMPILED_SHA256_INVALID", { pattern: SHA256 });
  const { artifact_sha256: ignored, ...body } = value;
  void ignored;
  if (clusterSha256(body) !== value.artifact_sha256) reject("RUNTIME_PRIVILEGE_COMPILED_SHA256_INVALID");
  return value;
}

export async function verifyRuntimePrivilegeCompiledCatalogSources(value, { siteRoot = SITE_ROOT } = {}) {
  const root = path.resolve(siteRoot);
  const accessFile = path.join(root, RUNTIME_PRIVILEGE_ACCESS_PATH);
  const accessRaw = await stableBytes(accessFile, MAX_CATALOG_BYTES, "RUNTIME_PRIVILEGE_CATALOG_ACCESS_FILE_INVALID");
  let access;
  try { access = validateRuntimePrivilegeAccessDocument(parseStrictJson(accessRaw.toString("utf8"))); }
  catch { reject("RUNTIME_PRIVILEGE_CATALOG_ACCESS_FILE_INVALID"); }
  const generatedAccess = await createRuntimePrivilegeAccessDocument({ siteRoot: root }).catch(() => reject("RUNTIME_PRIVILEGE_CATALOG_ACCESS_SOURCE_INVALID"));
  compareExact(access, generatedAccess, "RUNTIME_PRIVILEGE_CATALOG_ACCESS_SOURCE_MISMATCH");
  const document = validateRuntimePrivilegeCompiledCatalog(value, { access });
  const migrations = await buildMigrationAllowlist(path.join(root, "drizzle-postgres")).catch(() => reject("RUNTIME_PRIVILEGE_CATALOG_MIGRATION_SOURCE_INVALID"));
  const reportBinding = { migrations: migrations.map((entry) => ({ version: entry.filename, checksum: entry.sha256 })) };
  const expected = await sourceBinding(access, reportBinding, root);
  compareExact(document.source_binding, expected, "RUNTIME_PRIVILEGE_COMPILED_SOURCE_STALE");
  const snapshotRaw = await stableBytes(path.join(root, access.source.drizzle_snapshot.path), MAX_REPORT_BYTES, "RUNTIME_PRIVILEGE_CATALOG_SNAPSHOT_FILE_INVALID");
  if (fileSha256(snapshotRaw) !== access.source.drizzle_snapshot.sha256) reject("RUNTIME_PRIVILEGE_CATALOG_SNAPSHOT_FILE_MISMATCH");
  return document;
}

async function readStrictFile(file, maximumBytes, code) {
  const absolute = path.resolve(file);
  let handle;
  try { handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { reject(code); }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > maximumBytes || (before.mode & 0o022) !== 0) reject(code);
    const raw = await handle.readFile();
    const after = await handle.stat();
    const pointed = await lstat(absolute).catch(() => null);
    if (!pointed || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || pointed.dev !== before.dev
      || pointed.ino !== before.ino || pointed.size !== before.size || pointed.nlink !== 1) reject(code);
    return raw;
  } finally {
    await handle.close();
  }
}

async function readJson(file, maximumBytes, code) {
  const raw = await readStrictFile(file, maximumBytes, code);
  try { return { raw, value: parseStrictJson(raw.toString("utf8")) }; }
  catch { reject(code); }
}

async function writeExclusive(file, value) {
  const absolute = path.resolve(file);
  const parent = path.dirname(absolute);
  const parentStat = await lstat(parent).catch(() => null);
  if (!parentStat?.isDirectory() || parentStat.isSymbolicLink() || (parentStat.mode & 0o022) !== 0) reject("RUNTIME_PRIVILEGE_CATALOG_OUTPUT_ROOT_UNSAFE");
  let handle;
  try { handle = await open(absolute, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
  catch { reject("RUNTIME_PRIVILEGE_CATALOG_OUTPUT_CONFLICT"); }
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.chmod(0o600);
    await handle.sync();
  } finally {
    await handle.close();
  }
  let directoryHandle;
  try {
    directoryHandle = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    await directoryHandle.sync();
  } catch {
    reject("RUNTIME_PRIVILEGE_CATALOG_OUTPUT_SYNC_FAILED");
  } finally {
    await directoryHandle?.close();
  }
}

function parseOptions(argumentsList) {
  if (argumentsList.length % 2 !== 0) reject("RUNTIME_PRIVILEGE_CATALOG_CLI_ARGUMENT_INVALID");
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index], value = argumentsList[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || options[key] !== undefined) reject("RUNTIME_PRIVILEGE_CATALOG_CLI_ARGUMENT_INVALID");
    options[key] = value;
  }
  return options;
}

async function cli() {
  const [command, ...argumentsList] = process.argv.slice(2);
  if (!["compile", "verify", "verify-sources", "verify-identity"].includes(command)) reject("RUNTIME_PRIVILEGE_CATALOG_CLI_COMMAND_INVALID");
  const options = parseOptions(argumentsList);
  const required = command === "compile"
    ? ["--access", "--expected-database", "--output", "--report"]
    : command === "verify"
      ? ["--access", "--catalog", "--expected-database", "--report"]
      : ["--catalog"];
  if (Object.keys(options).sort().join("|") !== required.sort().join("|")) reject("RUNTIME_PRIVILEGE_CATALOG_CLI_ARGUMENT_INVALID");
  if (command === "verify-identity") {
    const existing = await readJson(options["--catalog"], MAX_CATALOG_BYTES, "RUNTIME_PRIVILEGE_COMPILED_FILE_INVALID");
    const document = validateRuntimePrivilegeCompiledCatalogIdentity(existing.value);
    process.stdout.write(`RUNTIME_PRIVILEGE_CATALOG_IDENTITY_VERIFIED sha256=${document.artifact_sha256}\n`);
    return;
  }
  if (command === "verify-sources") {
    const existing = await readJson(options["--catalog"], MAX_CATALOG_BYTES, "RUNTIME_PRIVILEGE_COMPILED_FILE_INVALID");
    const document = await verifyRuntimePrivilegeCompiledCatalogSources(existing.value);
    process.stdout.write(`RUNTIME_PRIVILEGE_CATALOG_SOURCES_VERIFIED sha256=${document.artifact_sha256}\n`);
    return;
  }
  const access = (await readJson(options["--access"], MAX_CATALOG_BYTES, "RUNTIME_PRIVILEGE_CATALOG_ACCESS_FILE_INVALID")).value;
  const report = await readStrictFile(options["--report"], MAX_REPORT_BYTES, "RUNTIME_PRIVILEGE_CATALOG_REPORT_FILE_INVALID");
  const document = await createRuntimePrivilegeCompiledCatalog({ reportSource: report.toString("utf8"), access, expectedDatabase: options["--expected-database"] });
  await verifyRuntimePrivilegeCompiledCatalogSources(document);
  if (command === "compile") {
    await writeExclusive(options["--output"], document);
    process.stdout.write(`RUNTIME_PRIVILEGE_CATALOG_COMPILED sha256=${document.artifact_sha256}\n`);
    return;
  }
  const existing = await readJson(options["--catalog"], MAX_CATALOG_BYTES, "RUNTIME_PRIVILEGE_COMPILED_FILE_INVALID");
  validateRuntimePrivilegeCompiledCatalog(existing.value, { access });
  if (`${JSON.stringify(document, null, 2)}\n` !== existing.raw.toString("utf8")) reject("RUNTIME_PRIVILEGE_COMPILED_CATALOG_STALE");
  process.stdout.write(`RUNTIME_PRIVILEGE_CATALOG_VERIFIED sha256=${document.artifact_sha256}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((error) => {
    process.stderr.write(`${error instanceof RuntimePrivilegeCatalogError ? error.code : "RUNTIME_PRIVILEGE_CATALOG_INTERNAL_ERROR"}\n`);
    process.exitCode = 1;
  });
}
