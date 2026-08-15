import assert from "node:assert/strict";
import test from "node:test";

import {
  UatPromotionMigrationExecutionError,
  assertUatPromotionMigrationEngineResultMatchesAllowlist,
  assertUatPromotionMigrationEngineResultMatchesGrant,
  assertUatPromotionMigrationResultMatchesGrant,
  canonicalMigrationExecutionJson,
  createUatPromotionMigrationEngineResult,
  createUatPromotionMigrationFence,
  createUatPromotionMigrationGrant,
  createUatPromotionMigrationResult,
  migrationExecutionSha256,
  validateUatPromotionMigrationFence,
  validateUatPromotionMigrationGrant,
  validateUatPromotionMigrationResult,
} from "../scripts/uat-promotion-migration-execution-contract.mjs";

const digest = (value) => value.repeat(64).slice(0, 64);

function fixtureGrant() {
  return createUatPromotionMigrationGrant({
    execution_scope: "SUPERVISOR_CONTROLLED_UAT_MIGRATION",
    promotion_id: "promotion-74",
    migration_operation_id: "migration-run-74",
    execution_authorization_sha256: digest("1"),
    migration_approval_authorization_sha256: digest("2"),
    migration_approval_receipt_sha256: digest("3"),
    migration_authorization_binding_sha256: digest("4"),
    promotion_intent_sha256: digest("5"),
    candidate_binding_sha256: digest("6"),
    database_binding_sha256: digest("7"),
    runtime_binding_sha256: digest("8"),
    recovery_binding_sha256: digest("9"),
    promotion_snapshot_binding_sha256: digest("a"),
    writer_quiesce_binding_sha256: digest("b"),
    supervisor_bundle_sha256: digest("c"),
    release_manifest_sha256: digest("d"),
    worker_image: `registry.example.com/erp/worker@sha256:${digest("e")}`,
    migration_manifest_sha256: digest("f"),
    expected_current_head: "0040_runtime.sql",
    target_head: "0042_material.sql",
    database: {
      deployment_class: "UAT",
      deployment_id: "chenyida-erp",
      database_name: "chenyida_erp",
      database_system_identifier: "1234567890123456789",
      database_oid: "16384",
      database_marker: "chenyida-erp-deployment/v2:UAT:chenyida-erp",
      migration_role: "chenyida_erp_owner",
      control_role: "postgres",
    },
    created_at: "2026-08-15T01:00:00.000Z",
    expires_at: "2026-08-15T01:15:00.000Z",
  });
}

function fixtureFence(grant, phase, observedAt) {
  return createUatPromotionMigrationFence({
    phase,
    promotion_id: grant.promotion_id,
    migration_operation_id: grant.migration_operation_id,
    execution_authorization_sha256: grant.execution_authorization_sha256,
    database_name: grant.database.database_name,
    database_system_identifier: grant.database.database_system_identifier,
    database_oid: grant.database.database_oid,
    database_marker: grant.database.database_marker,
    control_role: grant.database.control_role,
    control_superuser: true,
    database_allow_connections: phase === "BEFORE",
    default_transaction_read_only: "on",
    database_setting_count: 1,
    database_connection_limit: phase === "BEFORE" ? 1 : 0,
    other_backend_count: 0,
    managed_roles: [
      "chenyida_erp_admin", "chenyida_erp_admin_priv", "chenyida_erp_backup", "chenyida_erp_backup_priv",
      "chenyida_erp_owner", "chenyida_erp_web", "chenyida_erp_web_priv", "chenyida_erp_worker",
      "chenyida_erp_worker_priv",
    ],
    login_roles: [
      "chenyida_erp_admin", "chenyida_erp_backup", "chenyida_erp_owner", "chenyida_erp_web", "chenyida_erp_worker",
    ],
    connect_roles: ["chenyida_erp_owner"],
    platform_superuser_roles: ["postgres"],
    public_connect: false,
    public_temporary: false,
    unknown_connect_acl_count: 0,
    unknown_connect_login_count: 0,
    prepared_transaction_count: 0,
    role_records: [
      { role: "chenyida_erp_admin", login: true, inherit: true, connection_limit: 1, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
      { role: "chenyida_erp_admin_priv", login: false, inherit: true, connection_limit: -1, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
      { role: "chenyida_erp_backup", login: true, inherit: true, connection_limit: 2, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
      { role: "chenyida_erp_backup_priv", login: false, inherit: true, connection_limit: -1, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
      { role: "chenyida_erp_owner", login: true, inherit: false, connection_limit: 1, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
      { role: "chenyida_erp_web", login: true, inherit: true, connection_limit: 12, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
      { role: "chenyida_erp_web_priv", login: false, inherit: true, connection_limit: -1, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
      { role: "chenyida_erp_worker", login: true, inherit: true, connection_limit: 6, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
      { role: "chenyida_erp_worker_priv", login: false, inherit: true, connection_limit: -1, superuser: false, create_role: false, create_database: false, replication: false, bypass_rls: false, valid_until_absent: true, settings_absent: true },
    ],
    memberships: [
      { role: "chenyida_erp_admin_priv", member: "chenyida_erp_admin", grantor: "postgres", admin_option: false, inherit_option: true, set_option: false },
      { role: "chenyida_erp_backup_priv", member: "chenyida_erp_backup", grantor: "postgres", admin_option: false, inherit_option: true, set_option: false },
      { role: "chenyida_erp_web_priv", member: "chenyida_erp_web", grantor: "postgres", admin_option: false, inherit_option: true, set_option: false },
      { role: "chenyida_erp_worker_priv", member: "chenyida_erp_worker", grantor: "postgres", admin_option: false, inherit_option: true, set_option: false },
    ],
    non_owner_database_acl: [],
    database_owner_privileges: ["CONNECT", "CREATE", "TEMPORARY"],
    observed_at: observedAt,
  });
}

function fixtureEngine(grant) {
  const rows = [
    { version: "0040_runtime.sql", checksum: digest("a") },
    { version: "0041_supplier.sql", checksum: digest("b") },
    { version: "0042_material.sql", checksum: digest("c") },
  ];
  return createUatPromotionMigrationEngineResult({
    promotion_id: grant.promotion_id,
    migration_operation_id: grant.migration_operation_id,
    execution_authorization_sha256: grant.execution_authorization_sha256,
    grant_sha256: grant.grant_sha256,
    database_name: grant.database.database_name,
    database_system_identifier: grant.database.database_system_identifier,
    database_oid: grant.database.database_oid,
    database_marker: grant.database.database_marker,
    migration_role: grant.database.migration_role,
    application_name: "chenyida-erp-migration",
    current_head_before: grant.expected_current_head,
    target_head: grant.target_head,
    started_at: "2026-08-15T01:02:00.000Z",
    completed_at: "2026-08-15T01:03:00.000Z",
    files: [
      { filename: "0040_runtime.sql", sha256: digest("a"), outcome: "ALREADY_APPLIED" },
      { filename: "0041_supplier.sql", sha256: digest("b"), outcome: "APPLIED" },
      { filename: "0042_material.sql", sha256: digest("c"), outcome: "APPLIED" },
    ],
    final_migration_rows_sha256: migrationExecutionSha256(rows),
    final_migration_rows_count: 3,
    other_backend_count_before: 0,
    other_backend_count_after: 0,
    database_default_transaction_read_only: "on",
    migration_transaction_read_only: "off",
  });
}

function fixtureResult() {
  const grant = fixtureGrant();
  const engine = fixtureEngine(grant);
  const before = fixtureFence(grant, "BEFORE", "2026-08-15T01:01:00.000Z");
  const after = fixtureFence(grant, "AFTER", "2026-08-15T01:04:00.000Z");
  const result = createUatPromotionMigrationResult({
    promotion_id: grant.promotion_id,
    migration_operation_id: grant.migration_operation_id,
    execution_authorization_sha256: grant.execution_authorization_sha256,
    grant_sha256: grant.grant_sha256,
    migration_approval_receipt_sha256: grant.migration_approval_receipt_sha256,
    migration_authorization_binding_sha256: grant.migration_authorization_binding_sha256,
    fence_before: before,
    engine_result: engine,
    fence_after: after,
    committed_at: "2026-08-15T01:05:00.000Z",
  });
  return { grant, engine, before, after, result };
}

function expectCode(code, action) {
  assert.throws(action, (error) => error instanceof UatPromotionMigrationExecutionError && error.code === code);
}

test("migration grant requires a distinct checkpoint-8 authorization and content binding", () => {
  const grant = fixtureGrant();
  assert.equal(validateUatPromotionMigrationGrant(grant), grant);
  assert.equal(canonicalMigrationExecutionJson(grant).endsWith("\n"), true);
  expectCode("UAT_PROMOTION_MIGRATION_GRANT_INVALID", () => validateUatPromotionMigrationGrant({
    ...grant,
    execution_authorization_sha256: grant.migration_approval_authorization_sha256,
  }));
  expectCode("UAT_PROMOTION_MIGRATION_GRANT_INVALID", () => validateUatPromotionMigrationGrant({
    ...grant,
    target_head: "0043_unapproved.sql",
  }));
});

test("migration engine result binds the exact grant and complete ordered migration rows", () => {
  const grant = fixtureGrant();
  const engine = fixtureEngine(grant);
  const entries = engine.files.map((file, index) => ({
    ordinal: index + 1, filename: file.filename, sha256: file.sha256,
  }));
  assert.equal(assertUatPromotionMigrationEngineResultMatchesGrant(engine, grant), engine);
  assert.equal(assertUatPromotionMigrationEngineResultMatchesAllowlist(engine, entries), engine);
  expectCode("UAT_PROMOTION_MIGRATION_ENGINE_RESULT_ALLOWLIST_INVALID", () => {
    assertUatPromotionMigrationEngineResultMatchesAllowlist(engine, entries.map((entry, index) => (
      index === 1 ? { ...entry, sha256: digest("0") } : entry
    )));
  });
  expectCode("UAT_PROMOTION_MIGRATION_ENGINE_RESULT_BINDING_INVALID", () => {
    const otherGrant = createUatPromotionMigrationGrant({
      ...Object.fromEntries(Object.entries(grant).filter(([key]) => key !== "grant_sha256")),
      execution_authorization_sha256: digest("0"),
    });
    assertUatPromotionMigrationEngineResultMatchesGrant(engine, otherGrant);
  });
  const wrongOutcome = createUatPromotionMigrationEngineResult({
    ...Object.fromEntries(Object.entries(engine).filter(([key]) => !new Set(["schema_version", "contract", "status", "engine_result_sha256"]).has(key))),
    files: engine.files.map((entry, index) => index === 1 ? { ...entry, outcome: "ALREADY_APPLIED" } : entry),
  });
  expectCode("UAT_PROMOTION_MIGRATION_ENGINE_RESULT_BINDING_INVALID", () => {
    assertUatPromotionMigrationEngineResultMatchesGrant(wrongOutcome, grant);
  });
  expectCode("UAT_PROMOTION_MIGRATION_ENGINE_RESULT_INVALID", () => createUatPromotionMigrationEngineResult({
    ...Object.fromEntries(Object.entries(engine).filter(([key]) => !new Set(["schema_version", "contract", "status", "engine_result_sha256"]).has(key))),
    other_backend_count_after: 1,
  }));
});

test("an EMPTY approved head requires every allowlisted file to be newly applied", () => {
  const base = fixtureGrant();
  const grant = createUatPromotionMigrationGrant({
    ...Object.fromEntries(Object.entries(base).filter(([key]) => !new Set([
      "schema_version", "contract", "grant_sha256",
    ]).has(key))),
    expected_current_head: "EMPTY",
  });
  const baseEngine = fixtureEngine(grant);
  const engine = createUatPromotionMigrationEngineResult({
    ...Object.fromEntries(Object.entries(baseEngine).filter(([key]) => !new Set([
      "schema_version", "contract", "status", "engine_result_sha256",
    ]).has(key))),
    current_head_before: "EMPTY",
    files: baseEngine.files.map((entry) => ({ ...entry, outcome: "APPLIED" })),
  });
  assert.equal(assertUatPromotionMigrationEngineResultMatchesGrant(engine, grant), engine);
});

test("database fence rejects extra clients, unknown CONNECT access, and mutable read-only state", () => {
  const { grant, before } = fixtureResult();
  assert.equal(validateUatPromotionMigrationFence(before), before);
  for (const change of [
    { other_backend_count: 1 },
    { connect_roles: ["chenyida_erp_owner", "chenyida_erp_web"] },
    { unknown_connect_login_count: 1 },
    { default_transaction_read_only: "off" },
  ]) {
    expectCode("UAT_PROMOTION_MIGRATION_FENCE_INVALID", () => validateUatPromotionMigrationFence({ ...before, ...change }));
  }
  assert.equal(before.promotion_id, grant.promotion_id);
});

test("final result binds before/after fence, engine result, approval receipt, and execution grant", () => {
  const { grant, result } = fixtureResult();
  assert.equal(validateUatPromotionMigrationResult(result), result);
  assert.equal(assertUatPromotionMigrationResultMatchesGrant(result, grant), result);
  expectCode("UAT_PROMOTION_MIGRATION_RESULT_INVALID", () => validateUatPromotionMigrationResult({
    ...result,
    database_fence_binding_sha256: digest("0"),
  }));
  const mismatched = createUatPromotionMigrationResult({
    promotion_id: result.promotion_id,
    migration_operation_id: result.migration_operation_id,
    execution_authorization_sha256: result.execution_authorization_sha256,
    grant_sha256: result.grant_sha256,
    migration_approval_receipt_sha256: digest("0"),
    migration_authorization_binding_sha256: result.migration_authorization_binding_sha256,
    fence_before: result.fence_before,
    engine_result: result.engine_result,
    fence_after: result.fence_after,
    committed_at: result.committed_at,
  });
  expectCode("UAT_PROMOTION_MIGRATION_RESULT_BINDING_INVALID", () => {
    assertUatPromotionMigrationResultMatchesGrant(mismatched, grant);
  });
});
