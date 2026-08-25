import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parseStrictJson } from "../scripts/backup-recovery-contract.mjs";
import {
  ISOLATED_UAT_DATABASE_PROJECT,
  buildIsolatedUatDatabaseBootstrapTransaction,
  buildIsolatedUatDatabaseFinalReconciliationTransaction,
  buildIsolatedUatDatabaseUnfenceTransaction,
  createIsolatedUatDatabaseBootstrapPlan,
  createIsolatedUatDatabaseFinalReconciliation,
  createIsolatedUatDatabaseMigrationResult,
  createIsolatedUatDatabaseUnfencePlan,
  disposeIsolatedUatDatabaseTransaction,
  isolatedUatRuntimePrivilegeTarget,
  renderIsolatedUatDatabaseObservationSql,
  verifyIsolatedUatDatabaseBootstrapResult,
  verifyIsolatedUatDatabaseFinalState,
  verifyIsolatedUatDatabaseMigration,
  verifyIsolatedUatDatabaseUnfence,
} from "../scripts/isolated-uat-database-operator.mjs";
import { validateRuntimePrivilegeCompiledCatalog } from "../scripts/postgresql-runtime-privilege-catalog.mjs";
import { validateRuntimePrivilegePolicy } from "../scripts/postgresql-runtime-privilege-policy.mjs";
import { createRuntimePrivilegeDesiredState } from "../scripts/postgresql-runtime-privilege-reconciler.mjs";
import { validateRuntimePrivilegeAccessDocument } from "../scripts/postgresql-runtime-privilege-source.mjs";
import { buildMigrationAllowlist } from "../scripts/release-manifest-contract.mjs";

const access = validateRuntimePrivilegeAccessDocument(parseStrictJson(
  await readFile(new URL("../operations/postgresql-runtime-privilege-access-v2.json", import.meta.url), "utf8"),
));
const catalog = validateRuntimePrivilegeCompiledCatalog(parseStrictJson(
  await readFile(new URL("../operations/postgresql-runtime-privilege-compiled-catalog-v1.json", import.meta.url), "utf8"),
), { access });
const policy = validateRuntimePrivilegePolicy(parseStrictJson(
  await readFile(new URL("../operations/postgresql-runtime-privilege-policy-v2.json", import.meta.url), "utf8"),
), { access, catalog });
const sources = Object.freeze({ policy, access, catalog });
const allowlist = await buildMigrationAllowlist(fileURLToPath(new URL("../drizzle-postgres", import.meta.url)));
const ledger = Object.freeze(allowlist.map((entry) => Object.freeze({ version: entry.filename, checksum: entry.sha256 })));
const marker = `chenyida-erp-deployment/v2:UAT:${ISOLATED_UAT_DATABASE_PROJECT}`;
const systemIdentifier = "7234567890123456789";
const databaseOid = "16384";

function compareC(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function normalizedRoles() {
  return policy.roles.map((role) => ({
    name: role.name,
    superuser: role.superuser,
    inherit: role.inherit,
    create_role: role.create_role,
    create_database: role.create_database,
    can_login: role.intended_login,
    replication: role.replication,
    connection_limit: role.connection_limit,
    valid_until: role.valid_until,
    bypass_rls: role.bypass_rls,
  })).sort((left, right) => compareC(left.name, right.name));
}

const passwordedLoginRoles = Object.freeze(normalizedRoles().filter((role) => role.can_login).map((role) => role.name));

function emptyObservation(change = {}) {
  return {
    schema_version: 1,
    contract: "chenyida-erp-isolated-uat-database-bootstrap-observation/v1",
    phase: "EMPTY_PRE_BOOTSTRAP",
    project: ISOLATED_UAT_DATABASE_PROJECT,
    deployment_class: "UAT",
    database_name: "chenyida_erp",
    system_identifier: systemIdentifier,
    database_oid: databaseOid,
    marker: null,
    database_owner: "postgres",
    database_connection_limit: -1,
    database_default_transaction_read_only: "off",
    database_setting_count: 0,
    public_schema_owner: "pg_database_owner",
    public_schema_public_privileges: ["USAGE"],
    connect_roles: ["PUBLIC"],
    roles: [],
    memberships: [],
    passworded_login_roles: [],
    user_object_count: 0,
    migration_history_present: false,
    other_backend_count: 0,
    prepared_transaction_count: 0,
    ...change,
  };
}

function bootstrapObservation(change = {}) {
  return {
    ...emptyObservation(),
    phase: "BOOTSTRAP_FENCED",
    marker,
    database_owner: policy.database.owner,
    database_connection_limit: 1,
    database_default_transaction_read_only: "on",
    database_setting_count: 1,
    public_schema_public_privileges: [],
    connect_roles: [policy.database.owner],
    roles: normalizedRoles(),
    memberships: structuredClone(policy.memberships),
    passworded_login_roles: [...passwordedLoginRoles],
    ...change,
  };
}

function passwordFor(role) {
  return createHash("sha256").update(`isolated-uat:${role}`, "utf8").digest().toString("base64url");
}

function migrationResult(bootstrapReceipt, change = {}) {
  return createIsolatedUatDatabaseMigrationResult({
    status: "MIGRATION_COMMITTED",
    project: ISOLATED_UAT_DATABASE_PROJECT,
    target: bootstrapReceipt.target,
    bootstrap_receipt_sha256: bootstrapReceipt.receipt_sha256,
    promotion_id: "promotion-operator-test",
    migration_operation_id: "migration-operator-test",
    execution_authorization_sha256: "1".repeat(64),
    grant_sha256: "2".repeat(64),
    engine_result_sha256: "3".repeat(64),
    migration_role: policy.identities.migration_owner,
    from_head: "EMPTY",
    to_head: policy.source_binding.migrations.head,
    applied_count: policy.source_binding.migrations.count,
    allowlist_sha256: policy.source_binding.migrations.allowlist_sha256,
    applied_ledger_sha256: policy.source_binding.migrations.applied_ledger_sha256,
    observed_head: policy.source_binding.migrations.head,
    database_default_transaction_read_only: "on",
    migration_transaction_read_only: "off",
    other_backend_count_before: 0,
    other_backend_count_after: 0,
    ...change,
  });
}

function unfenceObservation(change = {}) {
  return {
    schema_version: 1,
    contract: "chenyida-erp-isolated-uat-database-unfence-observation/v1",
    phase: "POST_MIGRATION_UNFENCED",
    project: ISOLATED_UAT_DATABASE_PROJECT,
    deployment_class: "UAT",
    database_name: policy.database.name,
    system_identifier: systemIdentifier,
    database_oid: databaseOid,
    marker,
    database_owner: policy.database.owner,
    database_connection_limit: 1,
    database_default_transaction_read_only: "off",
    observed_head: policy.source_binding.migrations.head,
    applied_count: policy.source_binding.migrations.count,
    applied_ledger_sha256: policy.source_binding.migrations.applied_ledger_sha256,
    other_backend_count: 0,
    prepared_transaction_count: 0,
    ...change,
  };
}

function fencedMigrationObservation(change = {}) {
  return unfenceObservation({
    phase: "POST_MIGRATION_FENCED",
    database_default_transaction_read_only: "on",
    ...change,
  });
}

function publicAcl(kind, identity, owner, privilegeType) {
  return { kind, identity, owner, grantor: owner, grantee: "PUBLIC", privilege_type: privilegeType, is_grantable: false };
}

function aclKey(record) {
  return `${record.kind}\u0001${record.identity}\u0001${record.grantee}\u0001${record.privilege_type}\u0001${record.grantor}`;
}

function postMigrationBaseline(target) {
  const engine = {
    server_version_num: policy.source_binding.engine_binding.server_version_num,
    encoding: policy.database.encoding,
    locale_provider: policy.database.locale_provider,
    collate: policy.database.collate,
    ctype: policy.database.ctype,
    collation_version: policy.database.collation_version,
  };
  const desired = createRuntimePrivilegeDesiredState({ target, engine }, sources);
  const publicRecords = [
    ...catalog.catalog.routines.map((item) => publicAcl(
      "ROUTINE",
      item.identity,
      item.owner === "MIGRATION_OWNER" ? policy.identities.migration_owner : item.owner,
      "EXECUTE",
    )),
    ...catalog.catalog.standalone_types.map((item) => publicAcl("TYPE", item.identity, item.owner, "USAGE")),
  ].sort((left, right) => compareC(aclKey(left), aclKey(right)));
  const explicit = new Set(publicRecords.map((record) => `${record.kind}\u0001${record.identity}`));
  return {
    ...desired,
    database: { ...desired.database, connection_limit: 1 },
    roles: normalizedRoles(),
    memberships: structuredClone(policy.memberships),
    object_acl: publicRecords,
    object_acl_storage: desired.object_acl_storage.map((record) => ({
      ...record,
      acl_state: explicit.has(`${record.kind}\u0001${record.identity}`) ? "EXPLICIT" : "NULL",
      acl_item_count: explicit.has(`${record.kind}\u0001${record.identity}`) ? 2 : 1,
    })),
    default_privilege_scopes: [],
    default_privileges: [],
    default_privilege_row_count: 0,
  };
}

function structuralValidator(report, options) {
  assert.equal(report.phase === "BASELINE" ? options.expectedDefaultPrivilegeCount : 2, options.expectedDefaultPrivilegeCount);
  return report;
}

function completedChain() {
  const bootstrapPlan = createIsolatedUatDatabaseBootstrapPlan(emptyObservation(), sources);
  const bootstrapReceipt = verifyIsolatedUatDatabaseBootstrapResult(bootstrapPlan, bootstrapObservation(), sources);
  const migrationReceipt = verifyIsolatedUatDatabaseMigration({
    bootstrapReceipt,
    migrationResult: migrationResult(bootstrapReceipt),
    allowlist,
    ledger,
    observation: fencedMigrationObservation(),
  }, sources);
  const unfencePlan = createIsolatedUatDatabaseUnfencePlan(migrationReceipt, sources);
  const unfenceReceipt = verifyIsolatedUatDatabaseUnfence(
    unfencePlan,
    migrationReceipt,
    unfenceObservation(),
    sources,
  );
  return { bootstrapPlan, bootstrapReceipt, migrationReceipt, unfencePlan, unfenceReceipt };
}

test("isolated database primitive has no production runner, supervisor, test-mode, environment, or CLI entrypoint", async () => {
  const source = await readFile(new URL("../scripts/isolated-uat-database-operator.mjs", import.meta.url), "utf8");
  assert.match(source, /buildRuntimePrivilegeOperatorTransactionInput/);
  assert.match(source, /createRuntimePrivilegeReconciliationPlan/);
  assert.match(source, /validateRuntimePrivilegeStructuralReport/);
  assert.doesNotMatch(source, /postgresql-runtime-privilege-runner/);
  assert.doesNotMatch(source, /release-supervisor|uat-promotion-migration-control|loadIsolatedAuthorization/);
  assert.doesNotMatch(source, /NODE_ENV|SYNTHETIC_TEST_ONLY|process\.env|process\.argv/);
});

test("observation SQL is one read-only snapshot and emits phase-specific bootstrap or unfence evidence", () => {
  const project = "chenyida-erp-uat-engineering_2";
  const empty = renderIsolatedUatDatabaseObservationSql({ phase: "EMPTY_PRE_BOOTSTRAP", project });
  const bootstrapFenced = renderIsolatedUatDatabaseObservationSql({ phase: "BOOTSTRAP_FENCED", project });
  const migrationFenced = renderIsolatedUatDatabaseObservationSql({ phase: "POST_MIGRATION_FENCED", project });
  const unfenced = renderIsolatedUatDatabaseObservationSql({ phase: "POST_MIGRATION_UNFENCED", project });
  for (const sql of [empty, bootstrapFenced, migrationFenced, unfenced]) {
    assert.match(sql, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/);
    assert.match(sql, /pg_catalog\.pg_control_system\(\)/);
    assert.match(sql, /shobj_description\(d\.oid,'pg_database'\) as marker/);
    assert.match(sql, /pg_catalog\.pg_stat_activity/);
    assert.match(sql, /pg_catalog\.pg_prepared_xacts/);
    assert.match(sql, new RegExp(`'project','${project}'`));
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO)\b/i);
  }
  for (const sql of [empty, bootstrapFenced]) {
    assert.match(sql, /chenyida-erp-isolated-uat-database-bootstrap-observation\/v1/);
    assert.doesNotMatch(sql, /from only public\.schema_migrations/);
  }
  for (const sql of [migrationFenced, unfenced]) {
    assert.match(sql, /chenyida-erp-isolated-uat-database-unfence-observation\/v1/);
    assert.match(sql, /from only public\.schema_migrations/);
    assert.match(sql, /public\.digest/);
    assert.match(sql, /'observed_head'/);
    assert.match(sql, /'applied_ledger_sha256'/);
    assert.match(sql, /order by l\.version collate "C"/);
  }
  assert.throws(
    () => renderIsolatedUatDatabaseObservationSql({ phase: "WRONG", project }),
    /ISOLATED_UAT_DATABASE_OBSERVATION_PHASE_INVALID/,
  );
  assert.throws(
    () => renderIsolatedUatDatabaseObservationSql({ phase: "EMPTY_PRE_BOOTSTRAP", project: "chenyida-erp" }),
    /ISOLATED_UAT_DATABASE_PROJECT_INVALID/,
  );
});

test("empty bootstrap derives exactly nine roles, four memberships, five stdin passwords, and no migrated objects", async () => {
  const plan = createIsolatedUatDatabaseBootstrapPlan(emptyObservation(), sources);
  assert.equal(plan.role_statements.length, 9);
  assert.equal(plan.membership_statements.length, 4);
  assert.deepEqual(plan.password_roles, passwordedLoginRoles);
  assert.equal(plan.target.marker, marker);
  assert.equal(plan.role_statements.every((statement) => statement.startsWith("CREATE ROLE ")), true);
  const planText = JSON.stringify(plan);
  for (const role of passwordedLoginRoles) assert.doesNotMatch(planText, new RegExp(passwordFor(role)));
  assert.doesNotMatch(planText, /0046_|schema_migrations|CREATE TABLE|ALTER TABLE|ALL TABLES|ALL SEQUENCES/);
  assert.ok(plan.database_statements.includes('ALTER DATABASE "chenyida_erp" CONNECTION LIMIT 1'));
  assert.ok(plan.database_statements.includes('ALTER DATABASE "chenyida_erp" SET default_transaction_read_only = \'on\''));
  assert.ok(plan.database_statements.includes('GRANT CONNECT ON DATABASE "chenyida_erp" TO "chenyida_erp_owner"'));
  assert.ok(plan.schema_statements.includes('REVOKE ALL PRIVILEGES ON SCHEMA "public" FROM PUBLIC, "chenyida_erp_admin", "chenyida_erp_admin_priv", "chenyida_erp_backup", "chenyida_erp_backup_priv", "chenyida_erp_owner", "chenyida_erp_web", "chenyida_erp_web_priv", "chenyida_erp_worker", "chenyida_erp_worker_priv"'));

  const provided = [];
  const transaction = await buildIsolatedUatDatabaseBootstrapTransaction(plan, sources, {
    passwordProvider: async (role) => {
      provided.push(role);
      return Buffer.from(passwordFor(role), "ascii");
    },
  });
  const sql = transaction.toString("utf8");
  assert.deepEqual(provided, passwordedLoginRoles);
  assert.equal((sql.match(/\\password /g) || []).length, 5);
  assert.match(sql, /SET LOCAL log_statement='none'/);
  assert.match(sql, /SET default_transaction_read_only=off;[\s\S]*transaction_read_only[\s\S]*pg_is_in_recovery[\s\S]*BEGIN TRANSACTION READ WRITE;[\s\S]*CREATE ROLE[\s\S]*\\password[\s\S]*GRANT "chenyida_erp_admin_priv"[\s\S]*default_transaction_read_only[\s\S]*COMMIT;/);
  assert.match(sql, /ISOLATED_UAT_DATABASE_WRITE_SESSION_REQUIRED/);
  assert.doesNotMatch(sql, /0046_|schema_migrations|CREATE TABLE|ALTER TABLE/);
  assert.equal(disposeIsolatedUatDatabaseTransaction(transaction), true);
  assert.equal(transaction.every((byte) => byte === 0), true);
});

test("bootstrap fails closed on unknown roles, non-empty objects, wrong marker, and non-isolated project", () => {
  const unknownRole = normalizedRoles()[0];
  assert.throws(
    () => createIsolatedUatDatabaseBootstrapPlan(emptyObservation({ roles: [unknownRole] }), sources),
    /ISOLATED_UAT_DATABASE_EMPTY_BOOTSTRAP_OBSERVATION_INVALID/,
  );
  assert.throws(
    () => createIsolatedUatDatabaseBootstrapPlan(emptyObservation({ user_object_count: 1 }), sources),
    /ISOLATED_UAT_DATABASE_EMPTY_TARGET_REQUIRED/,
  );
  assert.throws(
    () => createIsolatedUatDatabaseBootstrapPlan(emptyObservation({ marker: "chenyida-erp-deployment\/v2:UAT:wrong" }), sources),
    /ISOLATED_UAT_DATABASE_EMPTY_BOOTSTRAP_OBSERVATION_INVALID/,
  );
  assert.throws(
    () => createIsolatedUatDatabaseBootstrapPlan(emptyObservation({ project: "chenyida-erp" }), sources),
    /ISOLATED_UAT_DATABASE_EMPTY_BOOTSTRAP_OBSERVATION_INVALID/,
  );
});

test("bootstrap result binds the isolated marker and dynamic system identifier/OID observation", () => {
  const plan = createIsolatedUatDatabaseBootstrapPlan(emptyObservation(), sources);
  const receipt = verifyIsolatedUatDatabaseBootstrapResult(plan, bootstrapObservation(), sources);
  const target = isolatedUatRuntimePrivilegeTarget(receipt.target);
  assert.equal(target.database_oid, databaseOid);
  assert.equal(target.system_identifier_sha256, createHash("sha256").update(systemIdentifier).digest("hex"));
  assert.equal(target.marker_sha256, createHash("sha256").update(marker).digest("hex"));
  for (const change of [
    { marker: "chenyida-erp-deployment/v2:UAT:wrong" },
    { system_identifier: "8234567890123456789" },
    { database_oid: "16385" },
  ]) {
    assert.throws(
      () => verifyIsolatedUatDatabaseBootstrapResult(plan, bootstrapObservation(change), sources),
      /ISOLATED_UAT_DATABASE_(BOOTSTRAP_RESULT_INVALID|BOOTSTRAP_TARGET_MISMATCH)/,
    );
  }
});

test("project namespace is dynamic only inside the strict isolated UAT pattern", () => {
  const project = "chenyida-erp-uat-engineering_2";
  const plan = createIsolatedUatDatabaseBootstrapPlan(emptyObservation({ project }), sources);
  assert.equal(plan.project, project);
  assert.equal(plan.target.marker, `chenyida-erp-deployment/v2:UAT:${project}`);
  const post = bootstrapObservation({
    project,
    marker: `chenyida-erp-deployment/v2:UAT:${project}`,
  });
  assert.equal(verifyIsolatedUatDatabaseBootstrapResult(plan, post, sources).project, project);
  for (const rejected of ["chenyida-erp", "chenyida-erp-uat-Upper", "chenyida-erp-uat-", "chenyida-erp-uat-a/other"]) {
    assert.throws(
      () => createIsolatedUatDatabaseBootstrapPlan(emptyObservation({ project: rejected }), sources),
      /ISOLATED_UAT_DATABASE_EMPTY_BOOTSTRAP_OBSERVATION_INVALID/,
    );
  }
  assert.doesNotThrow(
    () => createIsolatedUatDatabaseBootstrapPlan(emptyObservation({ system_identifier: "1".repeat(24) }), sources),
  );
  assert.throws(
    () => createIsolatedUatDatabaseBootstrapPlan(emptyObservation({ system_identifier: "1".repeat(25) }), sources),
    /ISOLATED_UAT_DATABASE_EMPTY_BOOTSTRAP_OBSERVATION_INVALID/,
  );
});

test("migration verification requires exact 0001-0046 allowlist and exact gap-free ordered checksum ledger", () => {
  const plan = createIsolatedUatDatabaseBootstrapPlan(emptyObservation(), sources);
  const bootstrapReceipt = verifyIsolatedUatDatabaseBootstrapResult(plan, bootstrapObservation(), sources);
  const result = migrationResult(bootstrapReceipt);
  const receipt = verifyIsolatedUatDatabaseMigration({
    bootstrapReceipt, migrationResult: result, allowlist, ledger, observation: fencedMigrationObservation(),
  }, sources);
  assert.equal(receipt.status, "MIGRATION_VERIFIED");
  assert.equal(receipt.applied_count, 46);
  assert.equal(receipt.to_head, "0046_runtime_lock_privilege_boundary.sql");
  assert.equal(receipt.promotion_id, result.promotion_id);
  assert.equal(receipt.grant_sha256, result.grant_sha256);
  assert.match(receipt.fenced_observation_sha256, /^[0-9a-f]{64}$/);

  for (const change of [
    { phase: "POST_MIGRATION_UNFENCED", database_default_transaction_read_only: "off" },
    { system_identifier: "8234567890123456789" },
    { applied_ledger_sha256: "f".repeat(64) },
    { other_backend_count: 1 },
    { prepared_transaction_count: 1 },
  ]) {
    assert.throws(
      () => verifyIsolatedUatDatabaseMigration({
        bootstrapReceipt,
        migrationResult: result,
        allowlist,
        ledger,
        observation: fencedMigrationObservation(change),
      }, sources),
      /ISOLATED_UAT_DATABASE_(FENCED_MIGRATION|UNFENCE)_/,
    );
  }

  const variants = [
    ledger.slice(0, -1),
    [...ledger, { version: "0047_unapproved.sql", checksum: "a".repeat(64) }],
    [ledger[1], ledger[0], ...ledger.slice(2)],
  ];
  for (const rows of variants) {
    assert.throws(
      () => verifyIsolatedUatDatabaseMigration({
        bootstrapReceipt, migrationResult: result, allowlist, ledger: rows, observation: fencedMigrationObservation(),
      }, sources),
      /ISOLATED_UAT_DATABASE_MIGRATION_LEDGER_INVALID/,
    );
  }
  const wrongChecksum = ledger.map((row, index) => index === 17 ? { ...row, checksum: "f".repeat(64) } : row);
  assert.throws(
    () => verifyIsolatedUatDatabaseMigration({
      bootstrapReceipt, migrationResult: result, allowlist, ledger: wrongChecksum,
      observation: fencedMigrationObservation(),
    }, sources),
    /ISOLATED_UAT_DATABASE_MIGRATION_LEDGER_CHECKSUM_MISMATCH/,
  );
  const reorderedAllowlist = [allowlist[1], allowlist[0], ...allowlist.slice(2)];
  assert.throws(
    () => verifyIsolatedUatDatabaseMigration({
      bootstrapReceipt, migrationResult: result, allowlist: reorderedAllowlist, ledger,
      observation: fencedMigrationObservation(),
    }, sources),
    /ISOLATED_UAT_DATABASE_MIGRATION_ALLOWLIST_INVALID/,
  );
});

test("unfence cannot be produced for an unsuccessful migration and contains only the post-ledger RESET", () => {
  const plan = createIsolatedUatDatabaseBootstrapPlan(emptyObservation(), sources);
  const bootstrapReceipt = verifyIsolatedUatDatabaseBootstrapResult(plan, bootstrapObservation(), sources);
  const successfulResult = migrationResult(bootstrapReceipt);
  assert.throws(
    () => verifyIsolatedUatDatabaseMigration({
      bootstrapReceipt,
      migrationResult: { ...successfulResult, status: "MIGRATION_FAILED" },
      allowlist,
      ledger,
      observation: fencedMigrationObservation(),
    }, sources),
    /ISOLATED_UAT_DATABASE_MIGRATION_RESULT_INVALID/,
  );
  const migrationReceipt = verifyIsolatedUatDatabaseMigration({
    bootstrapReceipt,
    migrationResult: successfulResult,
    allowlist,
    ledger,
    observation: fencedMigrationObservation(),
  }, sources);
  assert.throws(
    () => createIsolatedUatDatabaseUnfencePlan({ ...migrationReceipt, status: "MIGRATION_FAILED" }, sources),
    /ISOLATED_UAT_DATABASE_MIGRATION_RECEIPT_INVALID/,
  );
  const unfencePlan = createIsolatedUatDatabaseUnfencePlan(migrationReceipt, sources);
  assert.equal(unfencePlan.statement, 'ALTER DATABASE "chenyida_erp" RESET default_transaction_read_only');
  const transaction = buildIsolatedUatDatabaseUnfenceTransaction(unfencePlan, migrationReceipt, sources);
  const sql = transaction.toString("utf8");
  assert.match(sql, /MIGRATION_LOCK|pg_try_advisory_xact_lock/);
  assert.match(sql, /SET default_transaction_read_only=off;[\s\S]*BEGIN TRANSACTION READ WRITE;/);
  assert.match(sql, /ISOLATED_UAT_DATABASE_WRITE_SESSION_REQUIRED/);
  assert.match(sql, /pg_catalog\.pg_control_system\(\)/);
  assert.match(sql, new RegExp(systemIdentifier));
  assert.match(sql, new RegExp(databaseOid));
  assert.match(sql, new RegExp(policy.source_binding.migrations.applied_ledger_sha256));
  assert.match(sql, /default_transaction_read_only=%'[\s\S]*='on'/);
  assert.match(sql, /pg_catalog\.pg_stat_activity/);
  assert.match(sql, /pg_catalog\.pg_prepared_xacts/);
  assert.match(sql, /unfence_precondition_valid[\s\S]*\\if :unfence_precondition_valid[\s\S]*RESET default_transaction_read_only/);
  assert.match(sql, /ISOLATED_UAT_DATABASE_UNFENCE_PRECONDITION_CHANGED/);
  assert.doesNotMatch(sql, /CREATE ROLE|GRANT CONNECT|ALL TABLES/);
  disposeIsolatedUatDatabaseTransaction(transaction);
});

test("order is bootstrap receipt, verified migration, verified unfence, then complete final ACL planning", () => {
  const chain = completedChain();
  const target = isolatedUatRuntimePrivilegeTarget(chain.unfenceReceipt.target);
  const baselineState = postMigrationBaseline(target);
  const input = {
    unfenceReceipt: chain.unfenceReceipt,
    baselineState,
    structuralReport: { phase: "BASELINE" },
  };
  assert.throws(
    () => createIsolatedUatDatabaseFinalReconciliation({ ...input, unfenceReceipt: chain.migrationReceipt }, sources, { structuralValidator }),
    /ISOLATED_UAT_DATABASE_UNFENCE_RECEIPT_INVALID/,
  );
  const reconciliation = createIsolatedUatDatabaseFinalReconciliation(input, sources, { structuralValidator });
  assert.equal(reconciliation.runtime_privilege_plan.role_bootstrap, false);
  assert.equal(reconciliation.runtime_privilege_plan.desired.object_acl.length, 1261);
  assert.ok(reconciliation.runtime_privilege_plan.statements.some((statement) => statement.includes("ALL TABLES IN SCHEMA")));
  assert.ok(reconciliation.runtime_privilege_plan.statements.some((statement) => statement.startsWith("GRANT SELECT")));

  const events = [];
  const transaction = buildIsolatedUatDatabaseFinalReconciliationTransaction(
    reconciliation,
    input,
    sources,
    {
      structuralValidator,
      passwordProvider: (role) => Buffer.from(passwordFor(role), "ascii"),
      transactionBuilder: (runtimePlan, binding, options) => {
        events.push("OPERATOR_TRANSACTION_BUILDER");
        assert.equal(binding, undefined);
        assert.equal(options.operation, "RECONCILE");
        assert.equal(typeof options.passwordProvider, "function");
        assert.equal(runtimePlan.plan_sha256, reconciliation.runtime_privilege_plan.plan_sha256);
        return Buffer.from(runtimePlan.statements.join(";\n"), "utf8");
      },
    },
  );
  assert.deepEqual(events, ["OPERATOR_TRANSACTION_BUILDER"]);
  assert.match(transaction.toString("utf8"), /SET default_transaction_read_only=off;[\s\S]*transaction_read_only[\s\S]*pg_is_in_recovery/);
  assert.match(transaction.toString("utf8"), /ISOLATED_UAT_DATABASE_WRITE_SESSION_REQUIRED/);
  assert.match(transaction.toString("utf8"), /REVOKE ALL PRIVILEGES ON ALL TABLES/);
  assert.match(transaction.toString("utf8"), /GRANT SELECT/);
  disposeIsolatedUatDatabaseTransaction(transaction);
});

test("post-migration baseline rejects unknown roles before the final transaction builder is called", () => {
  const chain = completedChain();
  const baselineState = postMigrationBaseline(isolatedUatRuntimePrivilegeTarget(chain.unfenceReceipt.target));
  baselineState.roles = [...baselineState.roles, { ...baselineState.roles.at(-1), name: "chenyida_erp_unknown" }];
  let calls = 0;
  assert.throws(
    () => createIsolatedUatDatabaseFinalReconciliation({
      unfenceReceipt: chain.unfenceReceipt,
      baselineState,
      structuralReport: { phase: "BASELINE" },
    }, sources, { structuralValidator: (...args) => { calls += 1; return structuralValidator(...args); } }),
    /RUNTIME_PRIVILEGE_STATE_(ROLE_ORDER_INVALID|UNKNOWN_MANAGED_ROLE)/,
  );
  assert.equal(calls, 0);
});

test("final verifier reuses exact state validation and rejects final ACL drift", () => {
  const chain = completedChain();
  const target = isolatedUatRuntimePrivilegeTarget(chain.unfenceReceipt.target);
  const baselineState = postMigrationBaseline(target);
  const baselineStructuralReport = { phase: "BASELINE" };
  const reconciliation = createIsolatedUatDatabaseFinalReconciliation({
    unfenceReceipt: chain.unfenceReceipt,
    baselineState,
    structuralReport: baselineStructuralReport,
  }, sources, { structuralValidator });
  const finalState = structuredClone(reconciliation.runtime_privilege_plan.desired);
  const receipt = verifyIsolatedUatDatabaseFinalState({
    reconciliation,
    unfenceReceipt: chain.unfenceReceipt,
    baselineState,
    baselineStructuralReport,
    finalState,
    finalStructuralReport: { phase: "FINAL" },
  }, sources, { structuralValidator });
  assert.equal(receipt.status, "FINAL_DATABASE_PRIVILEGES_VERIFIED");

  const drifted = structuredClone(finalState);
  drifted.object_acl.pop();
  assert.throws(
    () => verifyIsolatedUatDatabaseFinalState({
      reconciliation,
      unfenceReceipt: chain.unfenceReceipt,
      baselineState,
      baselineStructuralReport,
      finalState: drifted,
      finalStructuralReport: { phase: "FINAL" },
    }, sources, { structuralValidator }),
    /RUNTIME_PRIVILEGE_STATE_ACL_SET_MISMATCH/,
  );
});
