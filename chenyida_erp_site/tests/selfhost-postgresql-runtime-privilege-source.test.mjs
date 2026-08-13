import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  RUNTIME_PRIVILEGE_ACCESS_CONTRACT,
  RUNTIME_PRIVILEGE_ACCESS_PATH,
  RuntimePrivilegeSourceError,
  createRuntimePrivilegeAccessDocument,
  runtimePrivilegeSha256,
  validateRuntimePrivilegeAccessDocument,
} from "../scripts/postgresql-runtime-privilege-source.mjs";

const siteRoot = path.resolve(import.meta.dirname, "..");
const expectedServiceCounts = Object.freeze({
  ADMIN: Object.freeze({ files: 2, table: [0, 6, 4, 1], sequence: [0, 4, 0], routine: [0, 0] }),
  BACKUP: Object.freeze({ files: 3, table: [0, 0, 234, 0], sequence: [211, 0, 0], routine: [0, 1] }),
  WEB: Object.freeze({ files: 173, table: [18, 201, 211, 82], sequence: [0, 182, 0], routine: [27, 1] }),
  WORKER: Object.freeze({ files: 54, table: [7, 25, 33, 16], sequence: [0, 23, 0], routine: [0, 0] }),
});

function counts(service) {
  return {
    files: service.source_files.length,
    table: ["DELETE", "INSERT", "SELECT", "UPDATE"].map((operation) => service.table_privileges[operation].length),
    sequence: ["SELECT", "USAGE", "UPDATE"].map((operation) => service.sequence_privileges[operation].length),
    routine: ["APPLICATION", "EXTENSION"].map((kind) => service.routine_execute[kind].length),
  };
}

function resign(value) {
  const { access_sha256: ignored, ...body } = value;
  void ignored;
  value.access_sha256 = runtimePrivilegeSha256(body);
  return value;
}

function privilegeError(code) {
  return (error) => error instanceof RuntimePrivilegeSourceError && error.code === code && error.message === code;
}

test("runtime privilege source intent is exact, stale-detecting and explicitly not authorizable", async () => {
  const document = await createRuntimePrivilegeAccessDocument({ siteRoot });
  assert.equal(validateRuntimePrivilegeAccessDocument(document), document);
  assert.equal(document.contract, RUNTIME_PRIVILEGE_ACCESS_CONTRACT);
  assert.equal(document.artifact_class, "SOURCE_ACCESS_INTENT");
  assert.equal(document.authorization_status, "BLOCKED");
  assert.deepEqual(document.blocking_reasons.map((item) => [item.code, item.objects.length]), [
    ["POSTGRESQL17_COMPILED_CATALOG_REQUIRED", 0],
  ]);
  assert.equal(document.source.migration_count, 46);
  assert.equal(document.source.migration_head, "0046_runtime_lock_privilege_boundary.sql");
  assert.deepEqual(
    [document.catalog.tables.length, document.catalog.sequences.length, document.catalog.application_routines.length],
    [234, 211, 170],
  );
  assert.deepEqual(document.catalog.required_extensions, ["btree_gist", "pgcrypto"]);
  assert.deepEqual(document.catalog.large_objects, []);
  for (const [service, expected] of Object.entries(expectedServiceCounts)) {
    assert.deepEqual(counts(document.services[service]), expected, service);
  }
  assert.deepEqual(document.services.BACKUP.source_files, [
    "scripts/backup-reconciliation.sql",
    "scripts/backup-recovery-contract.mjs",
    "scripts/backup-selfhost.sh",
  ]);
  assert.deepEqual(document.services.WEB.column_privileges, {});
  assert.deepEqual(
    document.services.WEB.table_privileges.UPDATE,
    document.services.WEB.source_candidate_table_privileges.UPDATE,
  );
  assert.deepEqual(document.services.WEB.reviewed_dependency_operations.LOCK_TARGETS_REQUIRING_UPDATE, []);
  assert.equal(document.services.WEB.routine_execute.APPLICATION.every((routine) => document.catalog.application_routines.includes(routine)), true);
  assert.deepEqual(document.services.WEB.routine_execute.EXTENSION, ["public.digest(bytea,text)"]);
  assert.deepEqual(document.services.BACKUP.routine_execute.EXTENSION, ["public.digest(bytea,text)"]);
  assert.equal(document.services.BACKUP.derivation, "REVIEWED_ZERO_LARGE_OBJECT_LOGICAL_CAPTURE_SOURCE_INTENT");

  const raw = await readFile(path.join(siteRoot, RUNTIME_PRIVILEGE_ACCESS_PATH), "utf8");
  assert.equal(raw, `${JSON.stringify(document, null, 2)}\n`);
  const { access_sha256: ignored, ...body } = document;
  void ignored;
  assert.equal(document.access_sha256, runtimePrivilegeSha256(body));
});

test("runtime privilege source intent rejects authorization, provenance, routine and unresolved lock pseudo-passes", async () => {
  const baseline = await createRuntimePrivilegeAccessDocument({ siteRoot });
  const cases = [
    {
      code: "RUNTIME_PRIVILEGE_ACCESS_IDENTITY_INVALID",
      mutate(value) { value.authorization_status = "AUTHORIZABLE"; },
    },
    {
      code: "RUNTIME_PRIVILEGE_BLOCKING_REASONS_INVALID",
      mutate(value) { value.blocking_reasons.pop(); },
    },
    {
      code: "RUNTIME_PRIVILEGE_SERVICE_EVIDENCE_INVALID",
      mutate(value) { value.services.BACKUP.source_files = []; },
    },
    {
      code: "RUNTIME_PRIVILEGE_ROUTINE_EXECUTE_INVALID",
      mutate(value) { value.services.WEB.routine_execute.APPLICATION.push(value.services.WEB.routine_execute.APPLICATION.at(-1)); },
    },
    {
      code: "RUNTIME_PRIVILEGE_COLUMN_PRIVILEGES_UNRESOLVED",
      mutate(value) { value.services.WEB.column_privileges.finance_opening_sources = { UPDATE: ["id"] }; },
    },
    {
      code: "RUNTIME_PRIVILEGE_WEB_LOCK_SCOPE_UNRESOLVED",
      mutate(value) {
        const unauthorized = "finance_opening_sources";
        assert.ok(!value.services.WEB.source_candidate_table_privileges.UPDATE.includes(unauthorized));
        value.services.WEB.table_privileges.UPDATE.push(unauthorized);
        value.services.WEB.table_privileges.UPDATE.sort();
      },
    },
    {
      code: "RUNTIME_PRIVILEGE_ADMIN_SCOPE_INVALID",
      mutate(value) {
        value.services.ADMIN.table_privileges.SELECT.push("schema_migrations");
        value.services.ADMIN.table_privileges.SELECT.sort();
      },
    },
    {
      code: "RUNTIME_PRIVILEGE_BACKUP_SCOPE_INVALID",
      mutate(value) { value.services.BACKUP.table_privileges.SELECT.pop(); },
    },
    {
      code: "RUNTIME_PRIVILEGE_WORKER_SCOPE_INVALID",
      mutate(value) {
        value.services.WORKER.table_privileges.SELECT.push("app_users");
        value.services.WORKER.table_privileges.SELECT.sort();
      },
    },
  ];
  for (const entry of cases) {
    const candidate = structuredClone(baseline);
    entry.mutate(candidate);
    resign(candidate);
    assert.throws(() => validateRuntimePrivilegeAccessDocument(candidate), privilegeError(entry.code), entry.code);
  }
  assert.throws(
    () => validateRuntimePrivilegeAccessDocument({ ...structuredClone(baseline), access_sha256: "0".repeat(64) }),
    privilegeError("RUNTIME_PRIVILEGE_ACCESS_SHA256_INVALID"),
  );
});
