import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ISOLATED_UAT_DATABASE_OPERATION_CLI_MAX_INPUT_BYTES,
  IsolatedUatDatabaseOperationCliError,
  executeIsolatedUatDatabaseOperation,
  loadIsolatedUatDatabaseOperationSources,
  runIsolatedUatDatabaseOperationCli,
} from "../scripts/isolated-uat-database-operation-cli.mjs";
import {
  disposeIsolatedUatDatabaseTransaction,
  isolatedUatRuntimePrivilegeTarget,
} from "../scripts/isolated-uat-database-operator.mjs";
import {
  createIsolatedUatMigrationEngineResult,
  createIsolatedUatMigrationGrant,
  isolatedUatMigrationExecutionSha256,
} from "../scripts/isolated-uat-migration-execution-contract.mjs";
import { canonicalClusterJson } from "../scripts/postgresql-cluster-recovery-contract.mjs";
import { validateRuntimePrivilegeCompiledCatalog } from "../scripts/postgresql-runtime-privilege-catalog.mjs";
import { validateRuntimePrivilegePolicy } from "../scripts/postgresql-runtime-privilege-policy.mjs";
import { createRuntimePrivilegeDesiredState } from "../scripts/postgresql-runtime-privilege-reconciler.mjs";
import { validateRuntimePrivilegeAccessDocument } from "../scripts/postgresql-runtime-privilege-source.mjs";
import { buildMigrationAllowlist, migrationAllowlistDigest } from "../scripts/release-manifest-contract.mjs";

const rawSources = await loadIsolatedUatDatabaseOperationSources();
const access = validateRuntimePrivilegeAccessDocument(rawSources.access);
const catalog = validateRuntimePrivilegeCompiledCatalog(rawSources.catalog, { access });
const policy = validateRuntimePrivilegePolicy(rawSources.policy, { access, catalog });
const sources = Object.freeze({ policy, access, catalog });
const allowlist = await buildMigrationAllowlist(fileURLToPath(new URL("../drizzle-postgres", import.meta.url)));
const ledger = Object.freeze(allowlist.map((entry) => Object.freeze({
  version: entry.filename,
  checksum: entry.sha256,
})));
const project = "chenyida-erp-uat-cli_contract";
const marker = `chenyida-erp-deployment/v2:UAT:${project}`;
const systemIdentifier = "7234567890123456789";
const databaseOid = "16384";

function compareC(left, right) { return Buffer.compare(Buffer.from(left), Buffer.from(right)); }

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

const loginRoles = Object.freeze(normalizedRoles().filter((role) => role.can_login).map((role) => role.name));

function emptyObservation(change = {}) {
  return {
    schema_version: 1,
    contract: "chenyida-erp-isolated-uat-database-bootstrap-observation/v1",
    phase: "EMPTY_PRE_BOOTSTRAP",
    project,
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
    passworded_login_roles: [...loginRoles],
    ...change,
  };
}

function repeatedDigest(value) { return value.repeat(64).slice(0, 64); }

function migrationGrant(overrides = {}) {
  return createIsolatedUatMigrationGrant({
    promotion_id: "promotion-cli-contract",
    migration_operation_id: "migration-cli-contract",
    execution_authorization_sha256: repeatedDigest("1"),
    root_operations_package_sha256: repeatedDigest("2"),
    release_manifest_sha256: repeatedDigest("3"),
    worker_image: `registry.example.com/erp/worker@sha256:${repeatedDigest("4")}`,
    migration_manifest_sha256: migrationAllowlistDigest(allowlist),
    expected_current_head: "EMPTY",
    target_head: policy.source_binding.migrations.head,
    database: {
      deployment_class: "UAT",
      deployment_id: project,
      database_name: policy.database.name,
      database_system_identifier: systemIdentifier,
      database_oid: databaseOid,
      database_marker: marker,
      migration_role: policy.identities.migration_owner,
      control_role: "postgres",
    },
    created_at: "2026-08-25T01:00:00.000Z",
    expires_at: "2026-08-25T01:10:00.000Z",
    ...overrides,
  });
}

function migrationEngineResult(grant, overrides = {}) {
  const files = allowlist.map((entry) => ({
    filename: entry.filename,
    sha256: entry.sha256,
    outcome: "APPLIED",
  }));
  return createIsolatedUatMigrationEngineResult({
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
    started_at: "2026-08-25T01:02:00.000Z",
    completed_at: "2026-08-25T01:03:00.000Z",
    files,
    final_migration_rows_sha256: isolatedUatMigrationExecutionSha256(ledger),
    final_migration_rows_count: files.length,
    other_backend_count_before: 0,
    other_backend_count_after: 0,
    database_default_transaction_read_only: "on",
    migration_transaction_read_only: "off",
    ...overrides,
  });
}

function unfenceObservation(change = {}) {
  return {
    schema_version: 1,
    contract: "chenyida-erp-isolated-uat-database-unfence-observation/v1",
    phase: "POST_MIGRATION_UNFENCED",
    project,
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

function passwordFor(name) {
  return createHash("sha256").update(`isolated-cli:${name}`, "utf8").digest().toString("base64url");
}

async function credentialFixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "cyd-isolated-database-cli."));
  const runtimeRoot = path.join(parent, "runtime-secrets");
  const backupRoot = path.join(parent, "operator-credentials");
  await mkdir(runtimeRoot, { mode: 0o700 });
  await mkdir(backupRoot, { mode: 0o700 });
  await chmod(runtimeRoot, 0o700);
  await chmod(backupRoot, 0o700);
  const markerFile = path.join(backupRoot, ".chenyida-erp-credential-root-v2");
  await writeFile(markerFile, "chenyida-erp-credential-root/v2\n", { mode: 0o400 });
  await chmod(markerFile, 0o400);
  const values = Object.fromEntries([
    ...loginRoles.map((role) => [role, passwordFor(role)]),
    ["admin_application", passwordFor("admin_application")],
    ["postgres_bootstrap", passwordFor("postgres_bootstrap")],
  ]);
  const runtimeFiles = {
    "admin-database-password": values.chenyida_erp_admin,
    "admin-password": values.admin_application,
    "migration-database-password": values.chenyida_erp_owner,
    "postgres-bootstrap-password": values.postgres_bootstrap,
    "web-database-password": values.chenyida_erp_web,
    "worker-database-password": values.chenyida_erp_worker,
  };
  for (const [name, value] of Object.entries(runtimeFiles)) {
    const file = path.join(runtimeRoot, name);
    await writeFile(file, `${value}\n`, { mode: 0o400 });
    await chmod(file, 0o400);
  }
  const serviceFile = path.join(backupRoot, "backup-capture-service.conf");
  await writeFile(serviceFile, [
    "[backup_capture]",
    "host=127.0.0.1",
    "port=5432",
    "dbname=chenyida_erp",
    "user=chenyida_erp_backup",
    `password=${values.chenyida_erp_backup}`,
    "",
  ].join("\n"), { mode: 0o400 });
  await chmod(serviceFile, 0o400);
  return { parent, runtimeRoot, backupRoot, values, runtimeFiles, serviceFile };
}

class BufferSink extends Writable {
  constructor() { super(); this.chunks = []; }
  _write(chunk, _encoding, callback) { this.chunks.push(Buffer.from(chunk)); callback(); }
  bytes() { return Buffer.concat(this.chunks); }
}

function canonicalInput(value) { return Buffer.from(canonicalClusterJson(value), "utf8"); }

async function runCli(command, input, options = {}) {
  const stdout = new BufferSink();
  await runIsolatedUatDatabaseOperationCli({
    argumentsList: [command],
    stdin: Readable.from([canonicalInput(input)]),
    stdout,
    options,
  });
  return stdout.bytes();
}

async function chain() {
  const bootstrapPlan = (await executeIsolatedUatDatabaseOperation(
    "bootstrap-plan", { observation: emptyObservation() },
  )).value;
  const bootstrapReceipt = (await executeIsolatedUatDatabaseOperation(
    "bootstrap-verify", { plan: bootstrapPlan, observation: bootstrapObservation() },
  )).value;
  const grant = migrationGrant();
  const engineResult = migrationEngineResult(grant);
  const migrationReceipt = (await executeIsolatedUatDatabaseOperation("migration-verify", {
    bootstrap_receipt: bootstrapReceipt,
    grant,
    engine_result: engineResult,
    observation: fencedMigrationObservation(),
    ledger,
  })).value;
  const unfencePlan = (await executeIsolatedUatDatabaseOperation(
    "unfence-plan", { migration_receipt: migrationReceipt },
  )).value;
  const unfenceReceipt = (await executeIsolatedUatDatabaseOperation("unfence-verify", {
    plan: unfencePlan,
    migration_receipt: migrationReceipt,
    observation: unfenceObservation(),
  })).value;
  return {
    bootstrapPlan, bootstrapReceipt, grant, engineResult, migrationReceipt, unfencePlan, unfenceReceipt,
  };
}

test("no command rejects before stdin or fixed sources are read", async () => {
  let stdinRead = false;
  const stdin = {
    async *[Symbol.asyncIterator]() { stdinRead = true; throw new Error("must not read stdin"); },
  };
  let sourceRead = false;
  await assert.rejects(
    runIsolatedUatDatabaseOperationCli({
      argumentsList: [],
      stdin,
      stdout: new BufferSink(),
      options: { loadSources: async () => { sourceRead = true; throw new Error("must not read sources"); } },
    }),
    (error) => error instanceof IsolatedUatDatabaseOperationCliError
      && error.code === "ISOLATED_UAT_DATABASE_CLI_COMMAND_REQUIRED",
  );
  assert.equal(stdinRead, false);
  assert.equal(sourceRead, false);
});

test("observation-sql emits raw read-only SQL for all four phases and rejects invalid selectors", async () => {
  const options = {
    loadSources: async () => { throw new Error("observation SQL must not read fixed policy sources"); },
  };
  for (const phase of [
    "EMPTY_PRE_BOOTSTRAP", "BOOTSTRAP_FENCED", "POST_MIGRATION_FENCED", "POST_MIGRATION_UNFENCED",
  ]) {
    const rendered = await executeIsolatedUatDatabaseOperation("observation-sql", { phase, project }, options);
    assert.equal(rendered.kind, "SQL");
    assert.equal(Buffer.isBuffer(rendered.value), true);
    disposeIsolatedUatDatabaseTransaction(rendered.value);
    const raw = await runCli("observation-sql", { phase, project }, options);
    const sql = raw.toString("utf8");
    assert.match(sql, /^\\set ON_ERROR_STOP on\n/u);
    assert.match(sql, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/u);
    assert.match(sql, new RegExp(`'${phase}'`, "u"));
    assert.match(sql, /COMMIT;\n$/u);
    assert.doesNotMatch(sql, /READ WRITE/u);
  }
  for (const input of [
    { phase: "WRONG", project },
    { phase: "EMPTY_PRE_BOOTSTRAP", project: "chenyida-erp" },
  ]) {
    await assert.rejects(
      executeIsolatedUatDatabaseOperation("observation-sql", input, options),
      (error) => error.code === "ISOLATED_UAT_DATABASE_OBSERVATION_PHASE_INVALID"
        || error.code === "ISOLATED_UAT_DATABASE_PROJECT_INVALID",
    );
  }
});

test("stdin must be bounded canonical JSON and command inputs use exact keys", async () => {
  for (const raw of [
    Buffer.from('{"observation": {}}\n'),
    Buffer.from('{"observation":{},"observation":{}}\n'),
    Buffer.alloc(ISOLATED_UAT_DATABASE_OPERATION_CLI_MAX_INPUT_BYTES + 1, 0x20),
  ]) {
    await assert.rejects(
      runIsolatedUatDatabaseOperationCli({
        argumentsList: ["bootstrap-plan"],
        stdin: Readable.from([raw]),
        stdout: new BufferSink(),
        options: { loadSources: async () => { throw new Error("input rejection must precede source reads"); } },
      }),
      (error) => error.code === "ISOLATED_UAT_DATABASE_CLI_INPUT_NOT_CANONICAL"
        || error.code === "ISOLATED_UAT_DATABASE_CLI_INPUT_INVALID",
    );
  }
  await assert.rejects(
    executeIsolatedUatDatabaseOperation("bootstrap-plan", { observation: emptyObservation(), extra: true }),
    (error) => error.code === "ISOLATED_UAT_DATABASE_CLI_INPUT_FIELDS_INVALID",
  );
});

test("plan and verify commands emit only canonical JSON across the complete database chain", async () => {
  const planRaw = await runCli("bootstrap-plan", { observation: emptyObservation() });
  assert.equal(planRaw.toString("utf8"), canonicalClusterJson(JSON.parse(planRaw)));
  const completed = await chain();
  assert.equal(completed.bootstrapReceipt.status, "BOOTSTRAP_VERIFIED");
  assert.equal(completed.migrationReceipt.status, "MIGRATION_VERIFIED");
  assert.equal(completed.unfenceReceipt.status, "UNFENCE_VERIFIED");
  assert.equal(completed.migrationReceipt.promotion_id, completed.grant.promotion_id);
  assert.equal(completed.migrationReceipt.grant_sha256, completed.grant.grant_sha256);
  assert.equal(completed.migrationReceipt.engine_result_sha256, completed.engineResult.engine_result_sha256);

  const unfenceTransaction = await executeIsolatedUatDatabaseOperation("unfence-transaction", {
    plan: completed.unfencePlan,
    migration_receipt: completed.migrationReceipt,
  });
  assert.equal(unfenceTransaction.kind, "SQL");
  assert.match(unfenceTransaction.value.toString("utf8"), /RESET default_transaction_read_only/);
  assert.doesNotMatch(unfenceTransaction.value.toString("utf8"), /^\{/u);
  disposeIsolatedUatDatabaseTransaction(unfenceTransaction.value);
});

test("migration verification rejects caller-authored results and tampered grant, auth, engine, or live ledger", async () => {
  const completed = await chain();
  const options = {
    loadSources: async () => rawSources,
    loadAllowlist: async () => allowlist,
  };
  await assert.rejects(
    executeIsolatedUatDatabaseOperation("migration-verify", {
      bootstrap_receipt: completed.bootstrapReceipt,
      migration_result: {},
      observation: fencedMigrationObservation(),
      ledger,
    }, options),
    (error) => error.code === "ISOLATED_UAT_DATABASE_CLI_INPUT_FIELDS_INVALID",
  );

  const changedGrant = migrationGrant({ migration_manifest_sha256: repeatedDigest("f") });
  const changedAuthorizationEngine = migrationEngineResult(completed.grant, {
    execution_authorization_sha256: repeatedDigest("a"),
  });
  const changedEngineFiles = completed.engineResult.files.map((entry, index) => (
    index === 0 ? { ...entry, sha256: repeatedDigest("c") } : entry
  ));
  const changedLedgerEngine = migrationEngineResult(completed.grant, {
    files: changedEngineFiles,
    final_migration_rows_sha256: isolatedUatMigrationExecutionSha256(
      changedEngineFiles.map((entry) => ({ version: entry.filename, checksum: entry.sha256 })),
    ),
  });
  const changedLedger = ledger.map((row, index) => (
    index === 0 ? { ...row, checksum: repeatedDigest("b") } : row
  ));
  const cases = [
    {
      name: "grant digest",
      input: { grant: { ...completed.grant, grant_sha256: repeatedDigest("0") }, engine_result: completed.engineResult, ledger },
      code: "ISOLATED_UAT_MIGRATION_GRANT_INVALID",
    },
    {
      name: "grant migration authorization",
      input: { grant: changedGrant, engine_result: migrationEngineResult(changedGrant), ledger },
      code: "ISOLATED_UAT_DATABASE_CLI_MIGRATION_EVIDENCE_BINDING_INVALID",
    },
    {
      name: "execution authorization",
      input: { grant: completed.grant, engine_result: changedAuthorizationEngine, ledger },
      code: "ISOLATED_UAT_MIGRATION_ENGINE_RESULT_BINDING_INVALID",
    },
    {
      name: "engine digest",
      input: {
        grant: completed.grant,
        engine_result: { ...completed.engineResult, engine_result_sha256: repeatedDigest("0") },
        ledger,
      },
      code: "ISOLATED_UAT_MIGRATION_ENGINE_RESULT_INVALID",
    },
    {
      name: "engine ledger evidence",
      input: { grant: completed.grant, engine_result: changedLedgerEngine, ledger },
      code: "ISOLATED_UAT_DATABASE_CLI_MIGRATION_EVIDENCE_BINDING_INVALID",
    },
    {
      name: "live ledger checksum",
      input: { grant: completed.grant, engine_result: completed.engineResult, ledger: changedLedger },
      code: "ISOLATED_UAT_DATABASE_CLI_MIGRATION_LEDGER_INVALID",
    },
    {
      name: "live target identity",
      input: {
        grant: completed.grant,
        engine_result: completed.engineResult,
        observation: fencedMigrationObservation({ database_oid: "16385" }),
        ledger,
      },
      code: "ISOLATED_UAT_DATABASE_CLI_MIGRATION_EVIDENCE_BINDING_INVALID",
    },
    {
      name: "live fence",
      input: {
        grant: completed.grant,
        engine_result: completed.engineResult,
        observation: unfenceObservation(),
        ledger,
      },
      code: "ISOLATED_UAT_DATABASE_CLI_MIGRATION_EVIDENCE_BINDING_INVALID",
    },
  ];
  for (const item of cases) {
    await assert.rejects(
      executeIsolatedUatDatabaseOperation("migration-verify", {
        bootstrap_receipt: completed.bootstrapReceipt,
        observation: fencedMigrationObservation(),
        ...item.input,
      }, options),
      (error) => error.code === item.code,
      item.name,
    );
  }

  const alternateGrant = migrationGrant({
    promotion_id: "promotion-cli-contract-other",
    migration_operation_id: "migration-cli-contract-other",
    execution_authorization_sha256: repeatedDigest("d"),
  });
  const alternateReceipt = (await executeIsolatedUatDatabaseOperation("migration-verify", {
    bootstrap_receipt: completed.bootstrapReceipt,
    grant: alternateGrant,
    engine_result: migrationEngineResult(alternateGrant),
    observation: fencedMigrationObservation(),
    ledger,
  }, options)).value;
  assert.notEqual(alternateReceipt.migration_result_sha256, completed.migrationReceipt.migration_result_sha256);
  assert.notEqual(alternateReceipt.receipt_sha256, completed.migrationReceipt.receipt_sha256);
  assert.equal(alternateReceipt.execution_authorization_sha256, alternateGrant.execution_authorization_sha256);
});

test("bootstrap and final transactions read the fixed credential mapping and write only SQL bytes", async () => {
  const credentials = await credentialFixture();
  try {
    const completed = await chain();
    const transactionOptions = { allowSyntheticCredentialRoots: true, structuralValidator };
    const credentialFields = {
      runtime_secret_root: credentials.runtimeRoot,
      backup_credential_root: credentials.backupRoot,
      credential_generation_id: "isolated-cli-generation-one",
    };
    const bootstrapSql = await runCli("bootstrap-transaction", {
      plan: completed.bootstrapPlan,
      ...credentialFields,
    }, transactionOptions);
    assert.match(bootstrapSql.toString("utf8"), /^\\set ON_ERROR_STOP on\n/u);
    assert.doesNotMatch(bootstrapSql.toString("utf8"), /^\{/u);
    for (const role of loginRoles) {
      assert.equal(bootstrapSql.toString("utf8").split(credentials.values[role]).length - 1, 2);
    }

    const target = isolatedUatRuntimePrivilegeTarget(completed.unfenceReceipt.target);
    const baselineState = postMigrationBaseline(target);
    const structuralReport = { phase: "BASELINE" };
    const reconciliation = (await executeIsolatedUatDatabaseOperation("final-plan", {
      unfence_receipt: completed.unfenceReceipt,
      baseline_state: baselineState,
      structural_report: structuralReport,
    }, { structuralValidator })).value;
    const finalSql = await runCli("final-transaction", {
      reconciliation,
      unfence_receipt: completed.unfenceReceipt,
      baseline_state: baselineState,
      structural_report: structuralReport,
      ...credentialFields,
    }, transactionOptions);
    assert.match(finalSql.toString("utf8"), /^\\set ON_ERROR_STOP on\n/u);
    assert.match(finalSql.toString("utf8"), /GRANT SELECT/u);
    for (const role of loginRoles) {
      assert.equal(finalSql.toString("utf8").split(credentials.values[role]).length - 1, 2);
    }

    const finalState = structuredClone(reconciliation.runtime_privilege_plan.desired);
    const finalReceipt = (await executeIsolatedUatDatabaseOperation("final-verify", {
      reconciliation,
      unfence_receipt: completed.unfenceReceipt,
      baseline_state: baselineState,
      baseline_structural_report: structuralReport,
      final_state: finalState,
      final_structural_report: { phase: "FINAL" },
    }, { structuralValidator })).value;
    assert.equal(finalReceipt.status, "FINAL_DATABASE_PRIVILEGES_VERIFIED");
  } finally {
    await rm(credentials.parent, { recursive: true, force: true });
  }
});

test("credential hardlinks and unsafe modes fail closed without returning SQL", async () => {
  const completed = await chain();
  const inputFor = (credentials) => ({
    plan: completed.bootstrapPlan,
    runtime_secret_root: credentials.runtimeRoot,
    backup_credential_root: credentials.backupRoot,
    credential_generation_id: "isolated-cli-generation-unsafe",
  });
  const hardlinked = await credentialFixture();
  try {
    await link(
      path.join(hardlinked.runtimeRoot, "admin-database-password"),
      path.join(hardlinked.runtimeRoot, "admin-database-password.extra"),
    );
    await assert.rejects(
      executeIsolatedUatDatabaseOperation(
        "bootstrap-transaction", inputFor(hardlinked), { allowSyntheticCredentialRoots: true },
      ),
      /RUNTIME_PRIVILEGE_OPERATOR_RUNTIME_SECRET_FILE_UNSAFE/u,
    );
  } finally { await rm(hardlinked.parent, { recursive: true, force: true }); }

  const writable = await credentialFixture();
  try {
    await chmod(writable.serviceFile, 0o644);
    await assert.rejects(
      executeIsolatedUatDatabaseOperation(
        "bootstrap-transaction", inputFor(writable), { allowSyntheticCredentialRoots: true },
      ),
      /RUNTIME_PRIVILEGE_OPERATOR_BACKUP_SERVICE_UNSAFE/u,
    );
  } finally { await rm(writable.parent, { recursive: true, force: true }); }
});

test("facade source has fixed inputs and never formats an exception or secret to stderr", async () => {
  const source = await readFile(new URL("../scripts/isolated-uat-database-operation-cli.mjs", import.meta.url), "utf8");
  for (const fixed of [
    "operations/postgresql-runtime-privilege-access-v2.json",
    "operations/postgresql-runtime-privilege-compiled-catalog-v1.json",
    "operations/postgresql-runtime-privilege-policy-v2.json",
    "backup-capture-service.conf",
    "backup_capture",
  ]) assert.match(source, new RegExp(fixed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, /process\.stderr\.write\(`\$\{isolatedUatDatabaseOperationCliErrorCode\(error\)\}\\n`\)/u);
  assert.doesNotMatch(
    source,
    /console\.|error\.message|String\(error\)\s*\}|process\.env|node:child_process|\bspawn(?:Sync)?\s*\(|\bexec(?:File|Sync)?\s*\(|\btee\b/u,
  );
});
