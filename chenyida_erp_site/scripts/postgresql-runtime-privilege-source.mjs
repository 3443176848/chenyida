import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RUNTIME_PRIVILEGE_ACCESS_CONTRACT = "chenyida-erp-postgresql-runtime-privilege-access/v2";
export const RUNTIME_PRIVILEGE_ACCESS_PATH = "operations/postgresql-runtime-privilege-access-v2.json";

const SITE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const MIGRATION = /^\d{4}_[a-z0-9_]+\.sql$/;
const IDENTIFIER = /^[a-z_][a-z0-9_$-]{0,62}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const OPERATIONS = Object.freeze(["DELETE", "INSERT", "SELECT", "UPDATE"]);
const ENTRYPOINTS = Object.freeze({ WEB: "app/lib/selfhost-api.ts", WORKER: "worker/selfhost.ts" });
const BACKUP_EVIDENCE_FILES = Object.freeze([
  "scripts/backup-reconciliation.sql",
  "scripts/backup-recovery-contract.mjs",
  "scripts/backup-selfhost.sh",
]);
const ADMIN_OPERATIONS = Object.freeze({
  app_meta: ["INSERT", "UPDATE"],
  app_users: ["INSERT", "SELECT"],
  audit_log: ["INSERT"],
  material_attribute_definitions: ["INSERT"],
  material_categories: ["INSERT"],
  material_category_attributes: ["INSERT"],
});
const ADMIN_SEMANTIC_SELECT = Object.freeze(["app_meta", "material_attribute_definitions", "material_categories"]);
const CONTROLLED_WEB_OPERATION_EXCLUSIONS = Object.freeze({
  app_meta: Object.freeze(["DELETE", "INSERT", "SELECT", "UPDATE"]),
  material_attribute_definitions: Object.freeze(["INSERT", "UPDATE", "DELETE"]),
  material_categories: Object.freeze(["INSERT", "UPDATE", "DELETE"]),
  material_category_attributes: Object.freeze(["INSERT", "UPDATE", "DELETE"]),
});
const REVIEWED_WORKER_OPERATIONS = Object.freeze({
  SELECT: Object.freeze([
    "background_jobs", "material_attribute_definitions", "material_attribute_values", "material_categories",
    "material_category_attributes", "material_import_batches", "material_import_files", "material_import_header_suggestions",
    "material_import_idempotency", "material_import_job_outbox", "material_import_mappings", "material_import_normalization_issues",
    "material_import_normalization_lineage", "material_import_normalization_runs", "material_import_normalized_attribute_candidates",
    "material_import_normalized_field_candidates", "material_import_normalized_rows", "material_import_parse_runs",
    "material_import_parse_sheets", "material_import_review_attribute_overrides", "material_import_review_draft_links",
    "material_import_review_field_overrides", "material_import_review_finalization_rows", "material_import_review_finalizations",
    "material_import_review_material_bindings", "material_import_review_rows", "material_import_review_sessions",
    "material_import_review_validation_issues", "material_import_rows", "material_import_upload_operations", "material_master",
    "schema_migrations", "worker_runtime_leases",
  ]),
  INSERT: Object.freeze([
    "audit_log", "background_jobs", "material_attribute_values", "material_change_logs", "material_import_events",
    "material_import_files", "material_import_header_suggestions", "material_import_mapping_items", "material_import_mappings",
    "material_import_normalization_issues", "material_import_normalization_lineage", "material_import_normalized_attribute_candidates",
    "material_import_normalized_field_candidates", "material_import_normalized_rows", "material_import_parse_runs",
    "material_import_parse_sheets", "material_import_review_draft_links", "material_import_review_finalization_rows",
    "material_import_review_history", "material_import_review_material_bindings", "material_import_review_validation_issues",
    "material_import_rows", "material_master", "material_versions", "worker_runtime_leases",
  ]),
  UPDATE: Object.freeze([
    "background_jobs", "material_import_batches", "material_import_files", "material_import_idempotency",
    "material_import_job_outbox", "material_import_normalization_runs", "material_import_parse_runs",
    "material_import_review_finalization_rows", "material_import_review_finalizations", "material_import_review_material_bindings",
    "material_import_review_rows", "material_import_review_sessions", "material_import_review_validation_issues",
    "material_import_upload_operations", "material_master", "worker_runtime_leases",
  ]),
  DELETE: Object.freeze([
    "material_attribute_values", "material_import_mappings", "material_import_normalization_issues",
    "material_import_normalization_lineage", "material_import_normalized_attribute_candidates",
    "material_import_normalized_field_candidates", "material_import_normalized_rows",
  ]),
});
const WEB_ROUTINE_DEPENDENCIES = Object.freeze({
  SELECT: Object.freeze([
    "finance_opening_reversals", "finance_opening_sources", "inventory_migration_opening_reversals",
    "inventory_migration_openings", "production_operation_run_events",
  ]),
  LOCK_TARGETS_REQUIRING_UPDATE: Object.freeze([
    "finance_opening_sources", "finance_settlements", "inventory_ledger_entries", "production_bom_snapshots",
    "production_completion_batches", "production_completion_lines", "production_completions", "production_operation_run_reports",
    "production_reports", "production_scrap_dispositions", "production_work_order_routing_snapshot_operations",
    "production_work_order_routing_snapshots", "purchase_financial_source_entries", "purchase_receipt_delivery_allocations",
    "sales_delivery_execution_lines", "sales_financial_source_entries", "sales_shipment_line_fqc_allocations",
    "sales_shipment_lines", "sales_shipments",
  ]),
});
const WEB_APPLICATION_ROUTINE_EXECUTE = Object.freeze([
  "public.cyd_ai_governance_suggestion_assert_complete(bigint)",
  "public.cyd_ai_governance_suggestion_assert_event(bigint)",
  "public.cyd_ai_governance_suggestion_assert_run_complete(bigint)",
  "public.cyd_validate_completion_inventory_lot(bigint)",
  "public.cyd_validate_inventory_lot_balance(bigint)",
  "public.cyd_validate_production_batch_mode(bigint)",
  "public.cyd_validate_production_final_output_report(bigint)",
  "public.cyd_validate_production_operation_projection(bigint)",
  "public.cyd_validate_purchase_receipt_posting(bigint)",
  "public.cyd_validate_shipment_line_lot(bigint)",
  "public.cyd_validate_supplier_receipt_lot(bigint)",
]);
const WEB_EXTENSION_ROUTINE_EXECUTE = Object.freeze(["public.digest(bytea,text)"]);
const BLOCKING_REASONS = Object.freeze([
  Object.freeze({
    code: "BACKUP_LARGE_OBJECT_CAPTURE_BOUNDARY_UNRESOLVED",
    objects: Object.freeze(["pg_catalog.pg_largeobject"]),
  }),
  Object.freeze({
    code: "POSTGRESQL17_COMPILED_CATALOG_REQUIRED",
    objects: Object.freeze([]),
  }),
  Object.freeze({
    code: "WEB_LOCK_TARGET_PRIVILEGE_BOUNDARY_UNRESOLVED",
    objects: WEB_ROUTINE_DEPENDENCIES.LOCK_TARGETS_REQUIRING_UPDATE,
  }),
]);
const DYNAMIC_RELATION_OVERRIDES = Object.freeze({
  "app/lib/master-data-selfhost/service.ts": Object.freeze([
    Object.freeze({ token: "insert into ${table}", operation: "INSERT", tables: Object.freeze(["customers", "suppliers"]) }),
    Object.freeze({ token: "update ${table}", operation: "UPDATE", tables: Object.freeze(["customers", "suppliers"]) }),
  ]),
  "app/lib/material-selfhost/repository.ts": Object.freeze([
    Object.freeze({ token: "from ${table}", operation: "SELECT", tables: Object.freeze(["audit_log", "material_change_logs", "material_versions"]) }),
  ]),
});

export class RuntimePrivilegeSourceError extends Error {
  constructor(code) {
    super(code);
    this.name = "RuntimePrivilegeSourceError";
    this.code = code;
  }
}

function reject(code) {
  throw new RuntimePrivilegeSourceError(code);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function canonicalRuntimePrivilegeJson(value) {
  return JSON.stringify(canonical(value));
}

export function runtimePrivilegeSha256(value) {
  return sha256(canonicalRuntimePrivilegeJson(value));
}

function sortedUnique(values, code) {
  const result = [...new Set(values)].sort();
  if (result.some((value) => typeof value !== "string" || !value || value !== value.normalize("NFC"))) reject(code);
  return result;
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
}

function strictSortedUniqueStrings(values, code) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value || value !== value.normalize("NFC"))) reject(code);
  if (values.some((value, index) => index > 0 && values[index - 1] >= value)) reject(code);
  return values;
}

function exactJson(left, right) {
  return canonicalRuntimePrivilegeJson(left) === canonicalRuntimePrivilegeJson(right);
}

function validateObjectPrivilegeMap(value, allowedObjects, code) {
  exactKeys(value, OPERATIONS, code);
  const allowed = new Set(allowedObjects);
  for (const operation of OPERATIONS) {
    strictSortedUniqueStrings(value[operation], code);
    if (value[operation].some((item) => !allowed.has(item))) reject(code);
  }
}

function expectedAdminOperations() {
  const result = new Map(Object.entries(ADMIN_OPERATIONS).map(([table, operations]) => [table, new Set(operations)]));
  for (const table of ADMIN_SEMANTIC_SELECT) result.get(table)?.add("SELECT");
  return result;
}

function validateServiceDocument(service, value, catalog) {
  exactKeys(value, [
    "derivation", "source_evidence_sha256", "source_files", "source_candidate_table_privileges",
    "reviewed_dependency_operations", "column_privileges", "table_privileges", "sequence_privileges",
    "routine_execute",
  ], "RUNTIME_PRIVILEGE_SERVICE_FIELDS_INVALID");
  if (typeof value.derivation !== "string" || !value.derivation || !SHA256.test(value.source_evidence_sha256)) {
    reject("RUNTIME_PRIVILEGE_SERVICE_EVIDENCE_INVALID");
  }
  strictSortedUniqueStrings(value.source_files, "RUNTIME_PRIVILEGE_SERVICE_EVIDENCE_INVALID");
  if (value.source_files.length < 1) reject("RUNTIME_PRIVILEGE_SERVICE_EVIDENCE_INVALID");
  validateObjectPrivilegeMap(value.source_candidate_table_privileges, catalog.tables, "RUNTIME_PRIVILEGE_TABLE_PRIVILEGES_INVALID");
  validateObjectPrivilegeMap(value.table_privileges, catalog.tables, "RUNTIME_PRIVILEGE_TABLE_PRIVILEGES_INVALID");
  exactKeys(value.reviewed_dependency_operations, ["LOCK_TARGETS_REQUIRING_UPDATE", "SELECT"], "RUNTIME_PRIVILEGE_DEPENDENCY_OPERATIONS_INVALID");
  for (const operation of ["LOCK_TARGETS_REQUIRING_UPDATE", "SELECT"]) {
    strictSortedUniqueStrings(value.reviewed_dependency_operations[operation], "RUNTIME_PRIVILEGE_DEPENDENCY_OPERATIONS_INVALID");
    if (value.reviewed_dependency_operations[operation].some((item) => !catalog.tables.includes(item))) {
      reject("RUNTIME_PRIVILEGE_DEPENDENCY_OPERATIONS_INVALID");
    }
  }
  exactKeys(value.column_privileges, [], "RUNTIME_PRIVILEGE_COLUMN_PRIVILEGES_UNRESOLVED");
  exactKeys(value.sequence_privileges, ["SELECT", "UPDATE", "USAGE"], "RUNTIME_PRIVILEGE_SEQUENCE_PRIVILEGES_INVALID");
  for (const operation of ["SELECT", "UPDATE", "USAGE"]) {
    strictSortedUniqueStrings(value.sequence_privileges[operation], "RUNTIME_PRIVILEGE_SEQUENCE_PRIVILEGES_INVALID");
    if (value.sequence_privileges[operation].some((item) => !catalog.sequences.includes(item))) {
      reject("RUNTIME_PRIVILEGE_SEQUENCE_PRIVILEGES_INVALID");
    }
  }
  exactKeys(value.routine_execute, ["APPLICATION", "EXTENSION"], "RUNTIME_PRIVILEGE_ROUTINE_EXECUTE_INVALID");
  strictSortedUniqueStrings(value.routine_execute.APPLICATION, "RUNTIME_PRIVILEGE_ROUTINE_EXECUTE_INVALID");
  strictSortedUniqueStrings(value.routine_execute.EXTENSION, "RUNTIME_PRIVILEGE_ROUTINE_EXECUTE_INVALID");
  if (value.routine_execute.APPLICATION.some((item) => !catalog.application_routines.includes(item))
    || value.routine_execute.EXTENSION.some((item) => !WEB_EXTENSION_ROUTINE_EXECUTE.includes(item))) {
    reject("RUNTIME_PRIVILEGE_ROUTINE_EXECUTE_INVALID");
  }

  const expectedRoutines = service === "WEB"
    ? { APPLICATION: WEB_APPLICATION_ROUTINE_EXECUTE, EXTENSION: WEB_EXTENSION_ROUTINE_EXECUTE }
    : service === "BACKUP"
      ? { APPLICATION: [], EXTENSION: WEB_EXTENSION_ROUTINE_EXECUTE }
      : { APPLICATION: [], EXTENSION: [] };
  if (!exactJson(value.routine_execute, expectedRoutines)) reject("RUNTIME_PRIVILEGE_ROUTINE_EXECUTE_INVALID");
  if (service === "WEB") {
    if (!exactJson(value.reviewed_dependency_operations, WEB_ROUTINE_DEPENDENCIES)) reject("RUNTIME_PRIVILEGE_DEPENDENCY_OPERATIONS_INVALID");
    for (const operation of ["DELETE", "INSERT", "UPDATE"]) {
      if (!exactJson(value.table_privileges[operation], value.source_candidate_table_privileges[operation])) {
        reject("RUNTIME_PRIVILEGE_WEB_LOCK_SCOPE_UNRESOLVED");
      }
    }
    const expectedSelect = sortedUnique([
      ...value.source_candidate_table_privileges.SELECT,
      ...WEB_ROUTINE_DEPENDENCIES.SELECT,
    ], "RUNTIME_PRIVILEGE_DEPENDENCY_OPERATIONS_INVALID");
    if (!exactJson(value.table_privileges.SELECT, expectedSelect)) reject("RUNTIME_PRIVILEGE_DEPENDENCY_OPERATIONS_INVALID");
  } else if (!exactJson(value.reviewed_dependency_operations, { LOCK_TARGETS_REQUIRING_UPDATE: [], SELECT: [] })) {
    reject("RUNTIME_PRIVILEGE_DEPENDENCY_OPERATIONS_INVALID");
  }
  if (service === "BACKUP" && !exactJson(value.source_files, BACKUP_EVIDENCE_FILES)) {
    reject("RUNTIME_PRIVILEGE_BACKUP_EVIDENCE_INVALID");
  }
  if (service === "ADMIN" && !exactJson(value.table_privileges, groupedOperations(expectedAdminOperations(), catalog.tables))) {
    reject("RUNTIME_PRIVILEGE_ADMIN_SCOPE_INVALID");
  }
  if (service === "BACKUP") {
    const expected = Object.freeze({ DELETE: [], INSERT: [], SELECT: [...catalog.tables], UPDATE: [] });
    if (!exactJson(value.table_privileges, expected)) reject("RUNTIME_PRIVILEGE_BACKUP_SCOPE_INVALID");
  }
  if (service === "WORKER"
    && !exactJson(value.table_privileges, groupedOperations(reviewedOperations(REVIEWED_WORKER_OPERATIONS, new Set(catalog.tables)), catalog.tables))) {
    reject("RUNTIME_PRIVILEGE_WORKER_SCOPE_INVALID");
  }
}

export function validateRuntimePrivilegeAccessDocument(value) {
  exactKeys(value, [
    "schema_version", "contract", "artifact_class", "authorization_status", "blocking_reasons",
    "source", "catalog", "services", "access_sha256",
  ], "RUNTIME_PRIVILEGE_ACCESS_FIELDS_INVALID");
  if (value.schema_version !== 2
    || value.contract !== RUNTIME_PRIVILEGE_ACCESS_CONTRACT
    || value.artifact_class !== "SOURCE_ACCESS_INTENT"
    || value.authorization_status !== "BLOCKED") {
    reject("RUNTIME_PRIVILEGE_ACCESS_IDENTITY_INVALID");
  }
  if (!Array.isArray(value.blocking_reasons) || !exactJson(value.blocking_reasons, BLOCKING_REASONS)) {
    reject("RUNTIME_PRIVILEGE_BLOCKING_REASONS_INVALID");
  }
  exactKeys(value.source, ["migration_head", "migration_set_sha256", "migration_count", "drizzle_snapshot"], "RUNTIME_PRIVILEGE_SOURCE_BINDING_INVALID");
  exactKeys(value.source.drizzle_snapshot, ["path", "sha256"], "RUNTIME_PRIVILEGE_SOURCE_BINDING_INVALID");
  if (value.source.migration_count !== 45 || value.source.migration_head !== "0045_runtime_worker_readiness.sql"
    || !SHA256.test(value.source.migration_set_sha256)
    || value.source.drizzle_snapshot.path !== "drizzle-postgres/meta/0045_snapshot.json"
    || !SHA256.test(value.source.drizzle_snapshot.sha256)) {
    reject("RUNTIME_PRIVILEGE_SOURCE_BINDING_INVALID");
  }
  exactKeys(value.catalog, [
    "schema", "tables", "sequences", "sequence_owners", "application_routines", "application_types",
    "views", "materialized_views", "large_objects", "required_extensions",
  ], "RUNTIME_PRIVILEGE_CATALOG_FIELDS_INVALID");
  if (value.catalog.schema !== "public") reject("RUNTIME_PRIVILEGE_CATALOG_INVALID");
  for (const [field, expectedCount] of [["tables", 234], ["sequences", 211], ["application_routines", 154]]) {
    strictSortedUniqueStrings(value.catalog[field], "RUNTIME_PRIVILEGE_CATALOG_INVALID");
    if (value.catalog[field].length !== expectedCount) reject("RUNTIME_PRIVILEGE_CATALOG_INVALID");
  }
  for (const field of ["application_types", "views", "materialized_views", "large_objects"]) {
    if (!Array.isArray(value.catalog[field]) || value.catalog[field].length !== 0) reject("RUNTIME_PRIVILEGE_CATALOG_INVALID");
  }
  if (!exactJson(value.catalog.required_extensions, ["btree_gist", "pgcrypto"])) reject("RUNTIME_PRIVILEGE_CATALOG_INVALID");
  if (!Array.isArray(value.catalog.sequence_owners) || value.catalog.sequence_owners.length !== 211) reject("RUNTIME_PRIVILEGE_SEQUENCE_OWNER_INVALID");
  for (const [index, item] of value.catalog.sequence_owners.entries()) {
    exactKeys(item, ["sequence", "table", "column"], "RUNTIME_PRIVILEGE_SEQUENCE_OWNER_INVALID");
    if (item.sequence !== value.catalog.sequences[index]
      || !value.catalog.tables.includes(item.table)
      || typeof item.column !== "string" || !IDENTIFIER.test(item.column)) {
      reject("RUNTIME_PRIVILEGE_SEQUENCE_OWNER_INVALID");
    }
  }
  exactKeys(value.services, ["ADMIN", "BACKUP", "WEB", "WORKER"], "RUNTIME_PRIVILEGE_SERVICES_INVALID");
  for (const service of ["ADMIN", "BACKUP", "WEB", "WORKER"]) validateServiceDocument(service, value.services[service], value.catalog);
  if (!SHA256.test(value.access_sha256)) reject("RUNTIME_PRIVILEGE_ACCESS_SHA256_INVALID");
  const { access_sha256: ignored, ...body } = value;
  void ignored;
  if (runtimePrivilegeSha256(body) !== value.access_sha256) reject("RUNTIME_PRIVILEGE_ACCESS_SHA256_INVALID");
  return value;
}

async function migrationSource(siteRoot) {
  const root = path.join(siteRoot, "drizzle-postgres");
  const files = (await readdir(root)).filter((name) => name.endsWith(".sql")).sort();
  if (files.length !== 45 || files.some((name) => !MIGRATION.test(name))) reject("RUNTIME_PRIVILEGE_MIGRATION_SET_INVALID");
  const entries = [];
  let combined = "";
  for (const filename of files) {
    const raw = await readFile(path.join(root, filename), "utf8");
    entries.push({ filename, sha256: sha256(raw) });
    combined += `${filename}\0${sha256(raw)}\n`;
  }
  return Object.freeze({
    entries,
    head: files.at(-1),
    set_sha256: sha256(combined),
  });
}

function resolveImportCandidates(sourceFile, specifier, siteRoot) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(sourceFile), specifier);
  const candidates = [base, `${base}.ts`, `${base}.mjs`, `${base}.json`, path.join(base, "index.ts"), path.join(base, "index.mjs")];
  return candidates.filter((candidate) => {
    const relative = path.relative(siteRoot, candidate);
    return relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
  });
}

function importedSpecifiers(source) {
  const results = [];
  const staticImport = /(?:^|\n)\s*(?:import\s+(?!type\b)(?:[^;"']*?\sfrom\s+)?|export\s+(?!type\b)(?:[^;"']*?\sfrom\s+))["']([^"']+)["']/g;
  const dynamicImport = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const expression of [staticImport, dynamicImport]) {
    for (const match of source.matchAll(expression)) results.push(match[1]);
  }
  return sortedUnique(results, "RUNTIME_PRIVILEGE_IMPORT_INVALID");
}

async function reachableSourceFiles(siteRoot, entrypoint) {
  const first = path.join(siteRoot, entrypoint);
  const pending = [first];
  const seen = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    let source;
    try { source = await readFile(file, "utf8"); }
    catch { reject("RUNTIME_PRIVILEGE_SOURCE_GRAPH_INVALID"); }
    seen.add(file);
    for (const specifier of importedSpecifiers(source)) {
      const candidates = resolveImportCandidates(file, specifier, siteRoot);
      if (candidates === null) continue;
      let found = null;
      for (const candidate of candidates) {
        try { await readFile(candidate); found = candidate; break; }
        catch { /* Continue through the controlled extension candidates. */ }
      }
      if (!found) reject("RUNTIME_PRIVILEGE_SOURCE_GRAPH_INVALID");
      pending.push(found);
    }
  }
  return [...seen].sort();
}

function tableOperations(source, tableSet, relativePath) {
  const result = new Map();
  const dynamicRelations = [...source.matchAll(/\b(?:from|join|insert\s+into|update|delete\s+from)\s+\$\{/giu)];
  const overrides = DYNAMIC_RELATION_OVERRIDES[relativePath] || [];
  let overriddenCount = 0;
  for (const override of overrides) {
    const count = source.split(override.token).length - 1;
    if (count !== 1 || !OPERATIONS.includes(override.operation)) reject("RUNTIME_PRIVILEGE_DYNAMIC_RELATION_OVERRIDE_INVALID");
    overriddenCount += count;
    for (const table of override.tables) {
      if (!tableSet.has(table)) reject("RUNTIME_PRIVILEGE_DYNAMIC_RELATION_OVERRIDE_INVALID");
      if (!result.has(table)) result.set(table, new Set());
      result.get(table).add(override.operation);
    }
  }
  if (dynamicRelations.length !== overriddenCount) reject("RUNTIME_PRIVILEGE_DYNAMIC_RELATION_FORBIDDEN");
  const relation = /\b(insert\s+into|delete\s+from|update(?:\s+only)?|from|join)\s+(?:only\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/giu;
  for (const match of source.matchAll(relation)) {
    const table = match[2].toLowerCase();
    if (!tableSet.has(table)) continue;
    const verb = match[1].toLowerCase();
    const operation = verb.startsWith("insert") ? "INSERT" : verb.startsWith("delete") ? "DELETE" : verb.startsWith("update") ? "UPDATE" : "SELECT";
    if (!result.has(table)) result.set(table, new Set());
    result.get(table).add(operation);
  }
  const returning = /\b(?:insert\s+into|update)\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?[\s\S]{0,6000}?\breturning\b/giu;
  for (const match of source.matchAll(returning)) {
    const table = match[1].toLowerCase();
    if (!tableSet.has(table)) continue;
    if (!result.has(table)) result.set(table, new Set());
    result.get(table).add("SELECT");
  }
  const upsert = /\binsert\s+into\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?[\s\S]{0,2000}?\bon\s+conflict\b[\s\S]{0,1000}?\bdo\s+update\b/giu;
  for (const match of source.matchAll(upsert)) {
    const table = match[1].toLowerCase();
    if (tableSet.has(table)) {
      result.get(table)?.add("SELECT");
      result.get(table)?.add("UPDATE");
    }
  }
  return result;
}

function mergeOperations(target, source) {
  for (const [table, operations] of source.entries()) {
    if (!target.has(table)) target.set(table, new Set());
    for (const operation of operations) target.get(table).add(operation);
  }
}

function copyOperations(source) {
  return new Map([...source.entries()].map(([table, operations]) => [table, new Set(operations)]));
}

function reviewedOperations(value, tableSet) {
  const result = new Map();
  for (const operation of OPERATIONS) {
    const tables = value[operation];
    strictSortedUniqueStrings(tables, "RUNTIME_PRIVILEGE_REVIEWED_OPERATION_INVALID");
    if (tables.some((table) => !tableSet.has(table))) reject("RUNTIME_PRIVILEGE_REVIEWED_OPERATION_INVALID");
    for (const table of tables) {
      if (!result.has(table)) result.set(table, new Set());
      result.get(table).add(operation);
    }
  }
  return result;
}

function excludeOperations(target, exclusions) {
  for (const [table, operations] of Object.entries(exclusions)) {
    const existing = target.get(table);
    if (!existing) continue;
    for (const operation of operations) existing.delete(operation);
    if (existing.size === 0) target.delete(table);
  }
}

function groupedOperations(operationMap, tables) {
  const result = Object.fromEntries(OPERATIONS.map((operation) => [operation, []]));
  for (const table of tables) {
    for (const operation of operationMap.get(table) || []) result[operation].push(table);
  }
  return result;
}

function insertSequences(tableOperationsValue, sequenceOwners) {
  const insertTables = new Set(tableOperationsValue.INSERT);
  return sequenceOwners.filter((item) => insertTables.has(item.table)).map((item) => item.sequence).sort();
}

function normalizeRoutineArguments(value) {
  const raw = value.trim();
  if (!raw) return "";
  return raw.split(",").map((argument) => {
    const withoutDefault = argument.replace(/\s+default\s+[\s\S]*$/iu, "").trim();
    const tokens = withoutDefault.split(/\s+/u).filter(Boolean);
    const modeOffset = ["in", "out", "inout", "variadic"].includes(tokens[0]?.toLowerCase()) ? 1 : 0;
    if (tokens.length - modeOffset < 1) reject("RUNTIME_PRIVILEGE_ROUTINE_ARGUMENT_INVALID");
    const typeTokens = tokens.length - modeOffset === 1 ? tokens.slice(modeOffset) : tokens.slice(modeOffset + 1);
    const type = typeTokens.join(" ").toLowerCase();
    if (!/^[a-z_][a-z0-9_ ]*(?:\[\])?$/u.test(type)) reject("RUNTIME_PRIVILEGE_ROUTINE_ARGUMENT_INVALID");
    return type;
  }).join(",");
}

async function sourceCatalog(siteRoot, migration) {
  const snapshotPath = path.join(siteRoot, "drizzle-postgres", "meta", "0045_snapshot.json");
  const snapshotRaw = await readFile(snapshotPath, "utf8");
  const snapshot = JSON.parse(snapshotRaw);
  if (!snapshot || snapshot.dialect !== "postgresql" || typeof snapshot.tables !== "object" || Array.isArray(snapshot.tables)) reject("RUNTIME_PRIVILEGE_SNAPSHOT_INVALID");
  const tableNames = Object.values(snapshot.tables).map((table) => table?.name);
  if (tableNames.length !== 233 || tableNames.some((name) => typeof name !== "string" || !IDENTIFIER.test(name))) reject("RUNTIME_PRIVILEGE_TABLE_SET_INVALID");
  const tables = sortedUnique(["schema_migrations", ...tableNames], "RUNTIME_PRIVILEGE_TABLE_SET_INVALID");
  const sequenceOwners = [];
  for (const table of Object.values(snapshot.tables)) {
    for (const column of Object.values(table.columns || {})) {
      if (!["serial", "bigserial", "smallserial"].includes(column?.type)) continue;
      const sequence = `${table.name}_${column.name}_seq`;
      if (!IDENTIFIER.test(sequence)) reject("RUNTIME_PRIVILEGE_SEQUENCE_SET_INVALID");
      sequenceOwners.push({ sequence, table: table.name, column: column.name });
    }
  }
  sequenceOwners.sort((left, right) => left.sequence.localeCompare(right.sequence));
  if (sequenceOwners.length !== 211 || new Set(sequenceOwners.map((item) => item.sequence)).size !== sequenceOwners.length) reject("RUNTIME_PRIVILEGE_SEQUENCE_SET_INVALID");

  const routines = new Set();
  const extensions = new Set();
  for (const entry of migration.entries) {
    const source = await readFile(path.join(siteRoot, "drizzle-postgres", entry.filename), "utf8");
    for (const match of source.matchAll(/\bcreate\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(([^)]*)\)/giu)) {
      routines.add(`public.${match[1].toLowerCase()}(${normalizeRoutineArguments(match[2])})`);
    }
    for (const match of source.matchAll(/\bcreate\s+extension\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/giu)) extensions.add(match[1].toLowerCase());
  }
  const applicationRoutines = [...routines].sort();
  if (applicationRoutines.length !== 154) reject("RUNTIME_PRIVILEGE_ROUTINE_SET_INVALID");
  const requiredExtensions = [...extensions].sort();
  if (JSON.stringify(requiredExtensions) !== JSON.stringify(["btree_gist", "pgcrypto"])) reject("RUNTIME_PRIVILEGE_EXTENSION_SET_INVALID");
  return Object.freeze({
    application_routines: applicationRoutines,
    application_types: [],
    large_objects: [],
    materialized_views: [],
    required_extensions: requiredExtensions,
    sequence_owners: sequenceOwners,
    sequences: sequenceOwners.map((item) => item.sequence),
    tables,
    views: [],
    drizzle_snapshot: { path: "drizzle-postgres/meta/0045_snapshot.json", sha256: sha256(snapshotRaw) },
  });
}

async function serviceSource(siteRoot, service, tableSet) {
  const files = await reachableSourceFiles(siteRoot, ENTRYPOINTS[service]);
  const operations = new Map();
  const evidence = [];
  for (const file of files) {
    const raw = await readFile(file, "utf8");
    const relativePath = path.relative(siteRoot, file).split(path.sep).join("/");
    const detected = tableOperations(raw, tableSet, relativePath);
    evidence.push({ path: relativePath, sha256: sha256(raw) });
    mergeOperations(operations, detected);
  }
  operations.set("schema_migrations", new Set(["SELECT"]));
  if (service === "WEB") excludeOperations(operations, CONTROLLED_WEB_OPERATION_EXCLUSIONS);
  evidence.sort((left, right) => left.path.localeCompare(right.path));
  return { evidence, operations };
}

async function hashedEvidence(siteRoot, files) {
  strictSortedUniqueStrings(files, "RUNTIME_PRIVILEGE_SERVICE_EVIDENCE_INVALID");
  const result = [];
  for (const file of files) result.push({ path: file, sha256: sha256(await readFile(path.join(siteRoot, file))) });
  return result;
}

function serviceDocument(operations, catalog, evidence, sequencePrivilege, options = {}) {
  const tablePrivileges = groupedOperations(operations, catalog.tables);
  const applicationRoutineExecute = options.applicationRoutineExecute || [];
  const extensionRoutineExecute = options.extensionRoutineExecute || [];
  strictSortedUniqueStrings(applicationRoutineExecute, "RUNTIME_PRIVILEGE_ROUTINE_EXECUTE_INVALID");
  strictSortedUniqueStrings(extensionRoutineExecute, "RUNTIME_PRIVILEGE_ROUTINE_EXECUTE_INVALID");
  if (applicationRoutineExecute.some((item) => !catalog.application_routines.includes(item))
    || extensionRoutineExecute.some((item) => !WEB_EXTENSION_ROUTINE_EXECUTE.includes(item))) {
    reject("RUNTIME_PRIVILEGE_ROUTINE_EXECUTE_INVALID");
  }
  return Object.freeze({
    derivation: options.derivation || "SOURCE_GRAPH_CANDIDATE_REVIEWED",
    source_evidence_sha256: sha256(evidence.map((item) => `${item.path}\0${item.sha256}\n`).join("")),
    source_files: evidence.map((item) => item.path),
    source_candidate_table_privileges: options.sourceCandidate ? groupedOperations(options.sourceCandidate, catalog.tables) : tablePrivileges,
    reviewed_dependency_operations: options.reviewedDependencies || Object.freeze({ LOCK_TARGETS_REQUIRING_UPDATE: [], SELECT: [] }),
    column_privileges: {},
    table_privileges: tablePrivileges,
    sequence_privileges: {
      SELECT: sequencePrivilege === "SELECT" ? [...catalog.sequences] : [],
      USAGE: sequencePrivilege === "USAGE" ? insertSequences(tablePrivileges, catalog.sequence_owners) : [],
      UPDATE: [],
    },
    routine_execute: Object.freeze({
      APPLICATION: applicationRoutineExecute,
      EXTENSION: extensionRoutineExecute,
    }),
  });
}

export async function createRuntimePrivilegeAccessDocument({ siteRoot = SITE_ROOT } = {}) {
  const root = path.resolve(siteRoot);
  const migration = await migrationSource(root);
  const catalog = await sourceCatalog(root, migration);
  const tableSet = new Set(catalog.tables);
  const web = await serviceSource(root, "WEB", tableSet);
  const webSourceCandidate = copyOperations(web.operations);
  const worker = await serviceSource(root, "WORKER", tableSet);
  for (const table of WEB_ROUTINE_DEPENDENCIES.SELECT) {
    if (!tableSet.has(table)) reject("RUNTIME_PRIVILEGE_ROUTINE_DEPENDENCY_INVALID");
    if (!web.operations.has(table)) web.operations.set(table, new Set());
    web.operations.get(table).add("SELECT");
  }
  for (const table of WEB_ROUTINE_DEPENDENCIES.LOCK_TARGETS_REQUIRING_UPDATE) {
    if (!tableSet.has(table)) reject("RUNTIME_PRIVILEGE_ROUTINE_DEPENDENCY_INVALID");
  }
  const adminMap = new Map(Object.entries(ADMIN_OPERATIONS).map(([table, operations]) => [table, new Set(operations)]));
  for (const table of ADMIN_SEMANTIC_SELECT) adminMap.get(table)?.add("SELECT");
  const backupMap = new Map(catalog.tables.map((table) => [table, new Set(["SELECT"])]));
  const adminEvidence = await hashedEvidence(root, ["app/lib/identity-selfhost/service.ts", "scripts/init-admin.ts"]);
  const backupEvidence = await hashedEvidence(root, BACKUP_EVIDENCE_FILES);
  const body = {
    schema_version: 2,
    contract: RUNTIME_PRIVILEGE_ACCESS_CONTRACT,
    artifact_class: "SOURCE_ACCESS_INTENT",
    authorization_status: "BLOCKED",
    blocking_reasons: BLOCKING_REASONS,
    source: {
      migration_head: migration.head,
      migration_set_sha256: migration.set_sha256,
      migration_count: migration.entries.length,
      drizzle_snapshot: catalog.drizzle_snapshot,
    },
    catalog: {
      schema: "public",
      tables: catalog.tables,
      sequences: catalog.sequences,
      sequence_owners: catalog.sequence_owners,
      application_routines: catalog.application_routines,
      application_types: catalog.application_types,
      views: catalog.views,
      materialized_views: catalog.materialized_views,
      large_objects: catalog.large_objects,
      required_extensions: catalog.required_extensions,
    },
    services: {
      ADMIN: serviceDocument(adminMap, catalog, adminEvidence, "USAGE", { derivation: "REVIEWED_ONE_SHOT_ADMIN_PATH" }),
      BACKUP: serviceDocument(backupMap, catalog, backupEvidence, "SELECT", {
        derivation: "REVIEWED_LOGICAL_CAPTURE_SOURCE_INTENT",
        extensionRoutineExecute: WEB_EXTENSION_ROUTINE_EXECUTE,
      }),
      WEB: serviceDocument(web.operations, catalog, web.evidence, "USAGE", {
        reviewedDependencies: WEB_ROUTINE_DEPENDENCIES,
        sourceCandidate: webSourceCandidate,
        applicationRoutineExecute: WEB_APPLICATION_ROUTINE_EXECUTE,
        extensionRoutineExecute: WEB_EXTENSION_ROUTINE_EXECUTE,
      }),
      WORKER: serviceDocument(reviewedOperations(REVIEWED_WORKER_OPERATIONS, tableSet), catalog, worker.evidence, "USAGE", {
        derivation: "REVIEWED_WORKER_CALL_GRAPH",
        sourceCandidate: worker.operations,
      }),
    },
  };
  return Object.freeze(validateRuntimePrivilegeAccessDocument({ ...body, access_sha256: runtimePrivilegeSha256(body) }));
}

async function main(args) {
  if (args.length !== 1 || !["generate", "verify"].includes(args[0])) {
    process.stderr.write("usage: postgresql-runtime-privilege-source.mjs generate|verify\n");
    process.exitCode = 2;
    return;
  }
  const document = await createRuntimePrivilegeAccessDocument();
  const target = path.join(SITE_ROOT, RUNTIME_PRIVILEGE_ACCESS_PATH);
  const rendered = `${JSON.stringify(document, null, 2)}\n`;
  if (args[0] === "generate") {
    await writeFile(target, rendered, { encoding: "utf8", mode: 0o644 });
    process.stdout.write(`RUNTIME_PRIVILEGE_ACCESS_GENERATED sha256=${document.access_sha256}\n`);
    return;
  }
  const existing = await readFile(target, "utf8");
  if (existing !== rendered) reject("RUNTIME_PRIVILEGE_ACCESS_STALE");
  process.stdout.write(`RUNTIME_PRIVILEGE_ACCESS_VERIFIED sha256=${document.access_sha256}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error?.code || "RUNTIME_PRIVILEGE_ACCESS_FAILED"}\n`);
    process.exitCode = 1;
  });
}
