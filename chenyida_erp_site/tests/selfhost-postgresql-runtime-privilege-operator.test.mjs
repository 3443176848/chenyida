import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parseStrictJson } from "../scripts/backup-recovery-contract.mjs";
import { canonicalClusterJson, clusterSha256 } from "../scripts/postgresql-cluster-recovery-contract.mjs";
import { readFile } from "node:fs/promises";
import { validateRuntimePrivilegeCompiledCatalog } from "../scripts/postgresql-runtime-privilege-catalog.mjs";
import {
  RUNTIME_PRIVILEGE_OPERATOR_STATE_ROOT_MARKER,
  RUNTIME_PRIVILEGE_OPERATOR_STATE_ROOT_MARKER_VALUE,
  appendRuntimePrivilegeOperatorJournalState,
  appendRuntimePrivilegeOperatorRecoveryAuthorization,
  archiveCommittedRuntimePrivilegeOperatorJournal,
  assertNoRuntimePrivilegeOperatorInterlock,
  loadRuntimePrivilegeOperatorJournal,
  persistRuntimePrivilegeOperatorCredentialProof,
  persistRuntimePrivilegeOperatorPostcommitCapture,
  prepareRuntimePrivilegeOperatorJournal,
  runtimePrivilegeOperatorJournalEvidence,
  runtimePrivilegeOperatorJournalSnapshot,
} from "../scripts/postgresql-runtime-privilege-journal.mjs";
import {
  buildRuntimePrivilegeOperatorTransactionInput,
  assertRuntimePrivilegeOperatorCredentialsUnchanged,
  createInitialRuntimePrivilegeOperatorState,
  createRuntimePrivilegeOperatorIntent,
  createRuntimePrivilegeOperatorPolicy,
  createRuntimePrivilegeOperatorReceipt,
  decideRuntimePrivilegeOperatorRecovery,
  disposeRuntimePrivilegeOperatorCredentials,
  readRuntimePrivilegeOperatorCredentials,
  transitionRuntimePrivilegeOperatorState,
  validateRuntimePrivilegeOperatorPolicy,
  validateRuntimePrivilegeOperatorReceipt,
  verifyRuntimePrivilegeOperatorPolicySources,
} from "../scripts/postgresql-runtime-privilege-operator.mjs";
import {
  RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_CONTRACT,
  assertRuntimePrivilegeGlobalLockHeld,
  createRuntimePrivilegeOperatorCredentialProof,
  executeRuntimePrivilegeOperationRecovery,
  executePreparedRuntimePrivilegeOperation,
  prepareRuntimePrivilegeOperationRecovery,
  prepareControlledRuntimePrivilegeOperation,
} from "../scripts/postgresql-runtime-privilege-runner.mjs";
import { createRuntimePrivilegePolicy, validateRuntimePrivilegePolicy } from "../scripts/postgresql-runtime-privilege-policy.mjs";
import {
  createControlledRuntimePrivilegeBootstrapPlan,
  createRuntimePrivilegeReconciliationPlan,
  createRuntimePrivilegeDesiredState,
} from "../scripts/postgresql-runtime-privilege-reconciler.mjs";
import { validateRuntimePrivilegeAccessDocument } from "../scripts/postgresql-runtime-privilege-source.mjs";

const access = validateRuntimePrivilegeAccessDocument(parseStrictJson(await readFile(new URL("../operations/postgresql-runtime-privilege-access-v2.json", import.meta.url), "utf8")));
const catalog = validateRuntimePrivilegeCompiledCatalog(parseStrictJson(await readFile(new URL("../operations/postgresql-runtime-privilege-compiled-catalog-v1.json", import.meta.url), "utf8")), { access });
const runtimePolicy = validateRuntimePrivilegePolicy(await createRuntimePrivilegePolicy(), { access, catalog });
const sources = Object.freeze({ policy: runtimePolicy, access, catalog });
const target = Object.freeze({ database_oid: "16384", system_identifier_sha256: "a".repeat(64), marker_sha256: "b".repeat(64) });
const engine = Object.freeze({
  server_version_num: runtimePolicy.source_binding.engine_binding.server_version_num,
  encoding: runtimePolicy.database.encoding,
  locale_provider: runtimePolicy.database.locale_provider,
  collate: runtimePolicy.database.collate,
  ctype: runtimePolicy.database.ctype,
  collation_version: runtimePolicy.database.collation_version,
});
const roles = Object.freeze([
  "chenyida_erp_admin",
  "chenyida_erp_backup",
  "chenyida_erp_owner",
  "chenyida_erp_web",
  "chenyida_erp_worker",
]);

function compareC(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function aclKey(record) {
  return `${record.kind}\u0001${record.identity}\u0001${record.grantee}\u0001${record.privilege_type}\u0001${record.grantor}`;
}

function publicAcl(kind, identity, owner, privilegeType) {
  return { kind, identity, owner, grantor: owner, grantee: "PUBLIC", privilege_type: privilegeType, is_grantable: false };
}

function controlledBaseline(targetValue = target) {
  const seed = { target: targetValue, engine };
  const final = createRuntimePrivilegeDesiredState(seed, sources);
  const platform = runtimePolicy.identities.platform_owner;
  const objectAcl = [
    publicAcl("DATABASE", runtimePolicy.database.name, platform, "CONNECT"),
    publicAcl("DATABASE", runtimePolicy.database.name, platform, "TEMPORARY"),
    publicAcl("SCHEMA", runtimePolicy.schema.name, runtimePolicy.schema.owner, "USAGE"),
    ...catalog.catalog.routines.map((item) => publicAcl("ROUTINE", item.identity, item.owner === "MIGRATION_OWNER" ? platform : item.owner, "EXECUTE")),
    ...catalog.catalog.standalone_types.map((item) => publicAcl("TYPE", item.identity, item.owner, "USAGE")),
  ].sort((left, right) => compareC(aclKey(left), aclKey(right)));
  const publicObjects = new Set(objectAcl.map((record) => `${record.kind}\u0001${record.identity}`));
  return {
    ...final,
    database: { ...final.database, owner: platform, connection_limit: -1 },
    roles: [],
    memberships: [],
    object_acl: objectAcl,
    object_acl_storage: final.object_acl_storage.map((record) => ({
      ...record,
      owner: record.owner === runtimePolicy.identities.migration_owner ? platform : record.owner,
      acl_state: publicObjects.has(`${record.kind}\u0001${record.identity}`) ? "EXPLICIT" : "NULL",
      acl_item_count: publicObjects.has(`${record.kind}\u0001${record.identity}`) ? 2 : 1,
    })),
    default_privilege_scopes: [],
    default_privileges: [],
    default_privilege_row_count: 0,
  };
}

function runnerContext(fixture, credential, operationId) {
  const deploymentId = "test-deployment";
  const marker = `chenyida-erp-deployment/v2:TEST:${deploymentId}`;
  const systemIdentifier = "1234567890123456789";
  return {
    schema_version: 2,
    contract: RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_CONTRACT,
    evidence_scope: "SYNTHETIC_TEST_ONLY",
    operation_id: operationId,
    operation: "BOOTSTRAP",
    execution_mode: "ORIGINAL",
    execution_authorization_id: operationId,
    execution_authorization_sha256: "2".repeat(64),
    expected_intent_sha256: null,
    deployment_class: "TEST",
    deployment_id: deploymentId,
    state_root: fixture.root,
    runtime_secret_root: credential.runtimeRoot,
    backup_credential_root: credential.backupRoot,
    backup_capture_service_file: credential.serviceFile,
    backup_capture_service: credential.serviceName,
    credential_generation_id: "test-generation-one",
    backup_root: path.join(fixture.parent, "backup"),
    release_manifest: path.join(fixture.parent, "release-manifest.json"),
    release_manifest_sha256: "0".repeat(64),
    runtime_guard_mode: "PRE_DEPLOY_POSTGRESQL_BOOTSTRAP_BOUND",
    postgres_container_name: "postgres-runner-test",
    postgres_container_id: "6".repeat(64),
    expected_database: runtimePolicy.database.name,
    expected_database_oid: "16384",
    expected_system_identifier: systemIdentifier,
    expected_database_marker: marker,
    supervisor_bundle_sha256: "1".repeat(64),
    authorization_sha256: "2".repeat(64),
    runtime_configuration_sha256: "3".repeat(64),
    runtime_probe_binding_sha256: "4".repeat(64),
  };
}

function targetForContext(context) {
  return {
    database_oid: context.expected_database_oid,
    system_identifier_sha256: createHash("sha256").update(context.expected_system_identifier).digest("hex"),
    marker_sha256: createHash("sha256").update(context.expected_database_marker).digest("hex"),
  };
}

function passwordFor(role, salt = "one") {
  return createHash("sha256").update(`${salt}:${role}`, "utf8").digest().toString("base64url");
}

async function credentialFixture({ salt = "one", mutate = null } = {}) {
  const parent = await mkdtemp(path.join(os.tmpdir(), "cyd-runtime-privilege-credentials."));
  const runtimeRoot = path.join(parent, "runtime-secrets");
  const backupRoot = path.join(parent, "backup-credentials");
  await mkdir(runtimeRoot, { mode: 0o700 });
  await mkdir(backupRoot, { mode: 0o700 });
  const marker = path.join(backupRoot, ".chenyida-erp-credential-root-v2");
  await writeFile(marker, "chenyida-erp-credential-root/v2\n", { mode: 0o400 });
  const values = Object.fromEntries([
    ...roles.map((role) => [role, passwordFor(role, salt)]),
    ["admin_application", passwordFor("admin_application", salt)],
    ["postgres_bootstrap", passwordFor("postgres_bootstrap", salt)],
  ]);
  mutate?.(values);
  const runtimeFiles = {
    "admin-database-password": values.chenyida_erp_admin,
    "admin-password": values.admin_application,
    "migration-database-password": values.chenyida_erp_owner,
    "postgres-bootstrap-password": values.postgres_bootstrap,
    "web-database-password": values.chenyida_erp_web,
    "worker-database-password": values.chenyida_erp_worker,
  };
  for (const [name, value] of Object.entries(runtimeFiles)) await writeFile(path.join(runtimeRoot, name), `${value}\n`, { mode: 0o400 });
  const serviceName = "backup_capture";
  const serviceFile = path.join(backupRoot, "pg_capture_service.conf");
  const serviceSource = `[${serviceName}]\nhost=127.0.0.1\nport=5432\ndbname=chenyida_erp\nuser=chenyida_erp_backup\npassword=${values.chenyida_erp_backup}\n`;
  await writeFile(serviceFile, serviceSource, { mode: 0o400 });
  await chmod(marker, 0o400);
  await chmod(serviceFile, 0o400);
  return { parent, runtimeRoot, backupRoot, serviceFile, serviceName, values, runtimeFiles, serviceSource };
}

function readCredentialFixture(fixture, generation = "test-generation-one") {
  return readRuntimePrivilegeOperatorCredentials({
    runtimeSecretRoot: fixture.runtimeRoot,
    backupCredentialRoot: fixture.backupRoot,
    backupCaptureServiceFile: fixture.serviceFile,
    backupCaptureService: fixture.serviceName,
    expectedDatabase: runtimePolicy.database.name,
    credentialGenerationId: generation,
    evidenceScope: "SYNTHETIC_TEST_ONLY",
  });
}

async function journalFixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "cyd-runtime-privilege-journal."));
  const root = path.join(parent, "postgresql-runtime-privilege-operator");
  await mkdir(root, { mode: 0o700 });
  await writeFile(path.join(root, RUNTIME_PRIVILEGE_OPERATOR_STATE_ROOT_MARKER), RUNTIME_PRIVILEGE_OPERATOR_STATE_ROOT_MARKER_VALUE, { mode: 0o400 });
  for (const directory of ["active", "completed", "preparing", "quarantine", "receipts"]) await mkdir(path.join(root, directory), { mode: 0o700 });
  return { parent, root };
}

function journalPreparedInputs(operationId, createdAt = "2026-08-13T01:30:00.000Z", targetValue = target) {
  const baseline = controlledBaseline(targetValue);
  const plan = createControlledRuntimePrivilegeBootstrapPlan(baseline, sources);
  const structure = Buffer.from(`synthetic ${operationId} baseline structure\n`, "utf8");
  const intent = createRuntimePrivilegeOperatorIntent({
    operation_id: operationId,
    operation: "BOOTSTRAP",
    created_at: createdAt,
    supervisor_bundle_sha256: "1".repeat(64), authorization_sha256: "2".repeat(64),
    release_manifest_sha256: "0".repeat(64), runtime_configuration_sha256: "3".repeat(64),
    runtime_guard_mode: "PRE_DEPLOY_POSTGRESQL_BOOTSTRAP_BOUND", runtime_probe_binding_sha256: "4".repeat(64),
    operator_policy_sha256: "5".repeat(64), runtime_privilege_policy_sha256: runtimePolicy.policy_sha256,
    target: targetValue, postgres_container_id: "6".repeat(64), postgres_container_name: "postgres-journal-test",
    backup_root_identity_sha256: "7".repeat(64), baseline_state_sha256: plan.baseline_state_sha256,
    baseline_structure_sha256: createHash("sha256").update(structure).digest("hex"),
    desired_state_sha256: plan.desired_state_sha256, plan_sha256: plan.plan_sha256,
    credential_generation_id: "test-generation-journal", credential_role_set_sha256: "9".repeat(64),
    credential_source_identity_sha256: "e".repeat(64),
  });
  const initialState = createInitialRuntimePrivilegeOperatorState(intent, "2026-08-13T01:30:00.001Z");
  return { baseline, plan, structure, intent, initialState };
}

function shellInterlock(root) {
  const helper = fileURLToPath(new URL("../scripts/postgresql-runtime-privilege-interlock.sh", import.meta.url));
  return spawnSync("/bin/sh", ["-c", '. "$1"; assert_no_chenyida_postgresql_runtime_privilege_interlock', "sh", helper], {
    env: { PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", LC_ALL: "C", NODE_ENV: "test", ERP_RUNTIME_PRIVILEGE_OPERATOR_STATE_ROOT: root },
    encoding: "utf8",
  });
}

test("operator policy is exact, controlled-only and source-fresh", async () => {
  const expected = await createRuntimePrivilegeOperatorPolicy();
  const artifact = parseStrictJson(await readFile(new URL("../operations/postgresql-runtime-privilege-operator-policy-v1.json", import.meta.url), "utf8"));
  assert.deepEqual(validateRuntimePrivilegeOperatorPolicy(artifact, { runtimePolicy, access, catalog }), expected);
  assert.deepEqual(await verifyRuntimePrivilegeOperatorPolicySources(artifact), expected);
  assert.equal(expected.deployment_authorized, false);
  assert.equal(expected.authorization.intent_before_authorization_consumption, true);
  assert.deepEqual(expected.credentials.login_roles, roles);
  assert.equal(expected.credentials.transport, "ONE_PSQL_STDIN_BUFFER_ONE_TRANSACTION");
  assert.equal(expected.credentials.source, "EXACT_RUNTIME_SECRET_FILES_AND_BACKUP_CAPTURE_LIBPQ_SERVICE");
  assert.equal(expected.credentials.source_identity_binding, "PATH_AND_STABLE_METADATA_WITHOUT_SECRET_DIGEST");
  assert.equal(expected.interlocks.active_intent_blocks_release_and_backup, true);
  assert.equal(expected.interlocks.backup_root_fixed, true);
  assert.equal(expected.roots.backup_root, "/var/backups/chenyida-erp-v2");
  assert.equal(expected.execution.password_verification_transport, "EXACT_CONTAINER_TCP_LOOPBACK_PSQL_FORCED_STDIN_PROMPT");
  assert.equal(expected.execution.global_lock_verification, "INHERITED_FD_IDENTITY_AND_INDEPENDENT_CONTENDER_BUSY");
});

test("global lock proof rejects an unlocked file and accepts an independent busy contender", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "cyd-runtime-privilege-global-lock."));
  const lock = path.join(fixture, "release.lock");
  let holder;
  try {
    await writeFile(lock, "", { mode: 0o600 });
    await chmod(lock, 0o600);
    await assert.rejects(assertRuntimePrivilegeGlobalLockHeld(lock), /RUNTIME_PRIVILEGE_OPERATOR_GLOBAL_LOCK_NOT_HELD/);
    holder = spawn("/usr/bin/flock", ["--exclusive", lock, "/bin/sh", "-ceu", "printf 'READY\\n'; IFS= read -r release", "sh"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    await new Promise((resolve, rejectPromise) => {
      const timer = setTimeout(() => rejectPromise(new Error("lock holder readiness timeout")), 5_000);
      holder.once("error", rejectPromise);
      holder.stdout.once("data", (chunk) => {
        clearTimeout(timer);
        if (chunk.toString("utf8") !== "READY\n") rejectPromise(new Error("lock holder readiness mismatch"));
        else resolve();
      });
    });
    assert.equal(await assertRuntimePrivilegeGlobalLockHeld(lock), true);
  } finally {
    if (holder) {
      holder.stdin.end("release\n");
      await new Promise((resolve) => holder.once("close", resolve));
    }
    await rm(fixture, { recursive: true, force: true });
  }
});

test("five distinct canonical passwords are rendered once into one transaction buffer and can be zeroed", async () => {
  const fixture = await credentialFixture();
  let binding;
  let input;
  try {
    binding = await readCredentialFixture(fixture);
    assert.equal(await assertRuntimePrivilegeOperatorCredentialsUnchanged(binding), true);
    assert.equal(binding.roleCount, 5);
    assert.match(binding.sourceIdentitySha256, /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(binding).includes(Object.values(fixture.values)[0]), false);
    const baseline = controlledBaseline();
    const plan = createControlledRuntimePrivilegeBootstrapPlan(baseline, sources);
    input = buildRuntimePrivilegeOperatorTransactionInput(plan, binding, { baseline, sources, operation: "BOOTSTRAP" });
    const rendered = input.toString("utf8");
    assert.equal((rendered.match(/^BEGIN;$/gmu) || []).length, 1);
    assert.equal((rendered.match(/^COMMIT;$/gmu) || []).length, 1);
    assert.ok(rendered.indexOf("SET LOCAL log_statement='none';") < rendered.indexOf('\\password "chenyida_erp_admin"'));
    assert.ok(rendered.indexOf("SET LOCAL log_min_error_statement='panic';") < rendered.indexOf('\\password "chenyida_erp_admin"'));
    assert.equal((rendered.match(/^\\password "/gmu) || []).length, 5);
    for (const role of roles) {
      assert.equal((rendered.match(new RegExp(`^\\\\password "${role}"$`, "gmu")) || []).length, 1);
      assert.equal(rendered.split(fixture.values[role]).length - 1, 2);
    }
    assert.equal(rendered.includes("REASSIGN OWNED"), false);
    input.fill(0);
    assert.equal(input.every((byte) => byte === 0), true);
    assert.equal(disposeRuntimePrivilegeOperatorCredentials(binding), true);
    assert.equal(disposeRuntimePrivilegeOperatorCredentials(binding), false);
  } finally {
    input?.fill(0);
    if (binding) disposeRuntimePrivilegeOperatorCredentials(binding);
    await rm(fixture.parent, { recursive: true, force: true });
  }
});

test("credential reuse, noncanonical values and replacement fail closed", async () => {
  const duplicate = await credentialFixture({ mutate: (values) => { values.chenyida_erp_backup = values.chenyida_erp_admin; } });
  try {
    await assert.rejects(
      readCredentialFixture(duplicate),
      /RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_PASSWORD_REUSE_FORBIDDEN/,
    );
  } finally { await rm(duplicate.parent, { recursive: true, force: true }); }

  const malformed = await credentialFixture({ mutate: (values) => { values.chenyida_erp_worker = "A".repeat(43); } });
  try {
    await assert.rejects(
      readCredentialFixture(malformed),
      /RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_PASSWORD_INVALID/,
    );
  } finally { await rm(malformed.parent, { recursive: true, force: true }); }

  const changed = await credentialFixture();
  let binding;
  try {
    binding = await readCredentialFixture(changed);
    const changedFile = path.join(changed.runtimeRoot, "web-database-password");
    await chmod(changedFile, 0o600);
    await writeFile(changedFile, `${changed.runtimeFiles["web-database-password"]}\n`, { mode: 0o600 });
    await assert.rejects(assertRuntimePrivilegeOperatorCredentialsUnchanged(binding), /RUNTIME_PRIVILEGE_OPERATOR_CREDENTIAL_FILE_CHANGED/);
  } finally {
    if (binding) disposeRuntimePrivilegeOperatorCredentials(binding);
    await rm(changed.parent, { recursive: true, force: true });
  }

  const wrongBackupConsumer = await credentialFixture();
  try {
    await chmod(wrongBackupConsumer.serviceFile, 0o600);
    await writeFile(
      wrongBackupConsumer.serviceFile,
      wrongBackupConsumer.serviceSource.replace(
        "user=chenyida_erp_backup\n",
        "user=postgres\npassfile=/tmp/forbidden\n",
      ),
      { mode: 0o600 },
    );
    await chmod(wrongBackupConsumer.serviceFile, 0o400);
    await assert.rejects(
      readCredentialFixture(wrongBackupConsumer),
      /RUNTIME_PRIVILEGE_OPERATOR_BACKUP_SERVICE_INVALID/,
    );
  } finally { await rm(wrongBackupConsumer.parent, { recursive: true, force: true }); }

  const trailingInvalidBackupField = await credentialFixture();
  try {
    await chmod(trailingInvalidBackupField.serviceFile, 0o600);
    await writeFile(
      trailingInvalidBackupField.serviceFile,
      `${trailingInvalidBackupField.serviceSource}password=duplicate-must-fail-after-buffer-allocation\n`,
      { mode: 0o600 },
    );
    await chmod(trailingInvalidBackupField.serviceFile, 0o400);
    await assert.rejects(
      readCredentialFixture(trailingInvalidBackupField),
      /RUNTIME_PRIVILEGE_OPERATOR_BACKUP_SERVICE_INVALID/,
    );
  } finally { await rm(trailingInvalidBackupField.parent, { recursive: true, force: true }); }
});

test("append-only operator state distinguishes pre-dispatch, ambiguous commit and publication recovery", () => {
  const baseline = controlledBaseline();
  const plan = createControlledRuntimePrivilegeBootstrapPlan(baseline, sources);
  const intent = createRuntimePrivilegeOperatorIntent({
    operation_id: "runtime-privilege-test-001",
    operation: "BOOTSTRAP",
    created_at: "2026-08-13T00:00:00.000Z",
    supervisor_bundle_sha256: "1".repeat(64),
    authorization_sha256: "2".repeat(64),
    release_manifest_sha256: "0".repeat(64),
    runtime_configuration_sha256: "3".repeat(64),
    runtime_guard_mode: "PRE_DEPLOY_POSTGRESQL_BOOTSTRAP_BOUND",
    runtime_probe_binding_sha256: "4".repeat(64),
    operator_policy_sha256: "5".repeat(64),
    runtime_privilege_policy_sha256: runtimePolicy.policy_sha256,
    target,
    postgres_container_id: "6".repeat(64),
    postgres_container_name: "postgres-runtime-test",
    backup_root_identity_sha256: "7".repeat(64),
    baseline_state_sha256: plan.baseline_state_sha256,
    baseline_structure_sha256: "8".repeat(64),
    desired_state_sha256: plan.desired_state_sha256,
    plan_sha256: plan.plan_sha256,
    credential_generation_id: "test-generation-one",
    credential_role_set_sha256: "9".repeat(64),
    credential_source_identity_sha256: "e".repeat(64),
  });
  const prepared = createInitialRuntimePrivilegeOperatorState(intent, "2026-08-13T00:00:00.001Z");
  assert.equal(decideRuntimePrivilegeOperatorRecovery(intent, prepared, baseline), "RESUME_AUTHORIZATION");
  assert.equal(decideRuntimePrivilegeOperatorRecovery(intent, prepared, plan.desired), "QUARANTINE");
  const consumed = transitionRuntimePrivilegeOperatorState(prepared, intent, "AUTHORIZATION_CONSUMED", "2026-08-13T00:00:00.002Z");
  assert.equal(decideRuntimePrivilegeOperatorRecovery(intent, consumed, baseline), "DISPATCH_TRANSACTION");
  const dispatched = transitionRuntimePrivilegeOperatorState(consumed, intent, "TRANSACTION_DISPATCHED", "2026-08-13T00:00:00.003Z");
  assert.equal(decideRuntimePrivilegeOperatorRecovery(intent, dispatched, baseline), "RETRY_TRANSACTION");
  assert.equal(decideRuntimePrivilegeOperatorRecovery(intent, dispatched, plan.desired), "CAPTURE_AND_VERIFY");
  const third = structuredClone(baseline);
  third.database.connection_limit = 1;
  assert.equal(decideRuntimePrivilegeOperatorRecovery(intent, dispatched, third), "QUARANTINE");
  const captured = transitionRuntimePrivilegeOperatorState(dispatched, intent, "POSTCOMMIT_CAPTURED", "2026-08-13T00:00:00.004Z", plan.desired_state_sha256);
  assert.equal(decideRuntimePrivilegeOperatorRecovery(intent, captured, baseline), "QUARANTINE");
  assert.equal(decideRuntimePrivilegeOperatorRecovery(intent, captured, plan.desired), "FINISH_PUBLICATION");
  const verified = transitionRuntimePrivilegeOperatorState(captured, intent, "VERIFIED", "2026-08-13T00:00:00.005Z", plan.desired_state_sha256);
  const committed = transitionRuntimePrivilegeOperatorState(verified, intent, "COMMITTED", "2026-08-13T00:00:00.006Z", plan.desired_state_sha256);
  const receipt = createRuntimePrivilegeOperatorReceipt({
    intent, state: committed, completedAt: "2026-08-13T00:00:00.007Z",
    finalStructureSha256: "c".repeat(64), credentialVerificationSha256: "d".repeat(64),
  });
  assert.equal(validateRuntimePrivilegeOperatorReceipt(receipt, intent, committed), receipt);
  assert.equal(JSON.stringify(receipt).includes("password"), false);
  assert.equal(transitionRuntimePrivilegeOperatorState(committed, intent, "QUARANTINED", "2026-08-13T00:00:00.008Z").phase, "QUARANTINED");
});

test("durable journal publishes PREPARED before authorization, appends exact states and archives without deleting evidence", async () => {
  const fixture = await journalFixture();
  try {
    await assertNoRuntimePrivilegeOperatorInterlock({ stateRoot: fixture.root, evidenceScope: "SYNTHETIC_TEST_ONLY" });
    assert.equal(shellInterlock(fixture.root).status, 0);
    const baseline = controlledBaseline();
    const plan = createControlledRuntimePrivilegeBootstrapPlan(baseline, sources);
    const structure = Buffer.from("synthetic controlled structure evidence\n", "utf8");
    const intent = createRuntimePrivilegeOperatorIntent({
      operation_id: "runtime-privilege-journal-001",
      operation: "BOOTSTRAP",
      created_at: "2026-08-13T01:00:00.000Z",
      supervisor_bundle_sha256: "1".repeat(64), authorization_sha256: "2".repeat(64),
      release_manifest_sha256: "0".repeat(64), runtime_configuration_sha256: "3".repeat(64),
      runtime_guard_mode: "PRE_DEPLOY_POSTGRESQL_BOOTSTRAP_BOUND", runtime_probe_binding_sha256: "4".repeat(64),
      operator_policy_sha256: "5".repeat(64), runtime_privilege_policy_sha256: runtimePolicy.policy_sha256,
      target, postgres_container_id: "6".repeat(64), postgres_container_name: "postgres-journal-test", backup_root_identity_sha256: "7".repeat(64),
      baseline_state_sha256: plan.baseline_state_sha256,
      baseline_structure_sha256: createHash("sha256").update(structure).digest("hex"),
      desired_state_sha256: plan.desired_state_sha256, plan_sha256: plan.plan_sha256,
      credential_generation_id: "test-generation-journal", credential_role_set_sha256: "9".repeat(64),
      credential_source_identity_sha256: "e".repeat(64),
    });
    const prepared = createInitialRuntimePrivilegeOperatorState(intent, "2026-08-13T01:00:00.001Z");
    const journal = await prepareRuntimePrivilegeOperatorJournal({
      stateRoot: fixture.root, evidenceScope: "SYNTHETIC_TEST_ONLY", intent, initialState: prepared,
      baseline, baselineStructure: structure, plan, sources, operation: "BOOTSTRAP",
    });
    await assert.rejects(
      assertNoRuntimePrivilegeOperatorInterlock({ stateRoot: fixture.root, evidenceScope: "SYNTHETIC_TEST_ONLY" }),
      /RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_REQUIRED/,
    );
    assert.equal(runtimePrivilegeOperatorJournalSnapshot(journal).state.phase, "PREPARED");
    await appendRuntimePrivilegeOperatorRecoveryAuthorization(journal, {
      authorization_id: "recovery-auth-001", authorization_sha256: "a".repeat(64),
      runtime_probe_binding_sha256: "4".repeat(64), observed_state_sha256: plan.baseline_state_sha256,
      decision: "RESUME_AUTHORIZATION", recorded_at: "2026-08-13T01:00:00.002Z",
    });
    await appendRuntimePrivilegeOperatorJournalState(journal, "AUTHORIZATION_CONSUMED", "2026-08-13T01:00:00.003Z");
    await appendRuntimePrivilegeOperatorJournalState(journal, "TRANSACTION_DISPATCHED", "2026-08-13T01:00:00.004Z");
    const finalStructure = Buffer.from("synthetic final structure evidence\n", "utf8");
    await persistRuntimePrivilegeOperatorPostcommitCapture(journal, plan.desired, finalStructure);
    await appendRuntimePrivilegeOperatorJournalState(journal, "POSTCOMMIT_CAPTURED", "2026-08-13T01:00:00.005Z", plan.desired_state_sha256);
    const proofBody = { contract: "synthetic-proof/v1", operation_id: intent.operation_id };
    const proof = { ...proofBody, proof_sha256: clusterSha256(proofBody) };
    await persistRuntimePrivilegeOperatorCredentialProof(journal, proof);
    await appendRuntimePrivilegeOperatorJournalState(journal, "VERIFIED", "2026-08-13T01:00:00.006Z", plan.desired_state_sha256);
    const committed = await appendRuntimePrivilegeOperatorJournalState(journal, "COMMITTED", "2026-08-13T01:00:00.007Z", plan.desired_state_sha256);
    const receipt = createRuntimePrivilegeOperatorReceipt({
      intent, state: committed, completedAt: "2026-08-13T01:00:00.008Z",
      finalStructureSha256: createHash("sha256").update(finalStructure).digest("hex"), credentialVerificationSha256: proof.proof_sha256,
    });
    await archiveCommittedRuntimePrivilegeOperatorJournal(journal, receipt);
    await assertNoRuntimePrivilegeOperatorInterlock({ stateRoot: fixture.root, evidenceScope: "SYNTHETIC_TEST_ONLY" });
    assert.equal(shellInterlock(fixture.root).status, 0);
    const completed = await loadRuntimePrivilegeOperatorJournal({
      stateRoot: fixture.root, evidenceScope: "SYNTHETIC_TEST_ONLY", operationId: intent.operation_id, sources, location: "completed",
    });
    assert.equal(runtimePrivilegeOperatorJournalSnapshot(completed).state.phase, "COMMITTED");
    assert.equal((await readdir(path.join(fixture.root, "completed"))).length, 1);
    assert.equal((await readdir(path.join(fixture.root, "receipts"))).length, 1);
    const completedDirectory = path.join(fixture.root, "completed", (await readdir(path.join(fixture.root, "completed")))[0]);
    assert.equal((await stat(path.join(completedDirectory, "intent.json"))).mode & 0o777, 0o400);
    assert.equal((await readdir(path.join(completedDirectory, "states"))).length, 6);
  } finally {
    await rm(fixture.parent, { recursive: true, force: true });
  }
});

test("partial preparation and quarantined evidence block release and backup interlocks", async () => {
  const fixture = await journalFixture();
  try {
    await mkdir(path.join(fixture.root, "preparing", `interrupted.${"b".repeat(64)}`), { mode: 0o700 });
    await assert.rejects(
      assertNoRuntimePrivilegeOperatorInterlock({ stateRoot: fixture.root, evidenceScope: "SYNTHETIC_TEST_ONLY" }),
      /RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_REQUIRED/,
    );
    const shell = shellInterlock(fixture.root);
    assert.equal(shell.status, 1);
    assert.match(shell.stderr, /requires controlled recovery/);
  } finally {
    await rm(fixture.parent, { recursive: true, force: true });
  }
});

test("an interrupted preparation for the same stable operation is rebuilt while foreign preparation remains blocking", async () => {
  const fixture = await journalFixture();
  try {
    const prepared = journalPreparedInputs("runtime-privilege-stable-prepare-001");
    const foreign = path.join(fixture.root, "preparing", `foreign-operation.${"a".repeat(64)}`);
    await mkdir(foreign, { mode: 0o700 });
    await assert.rejects(
      prepareRuntimePrivilegeOperatorJournal({
        stateRoot: fixture.root, evidenceScope: "SYNTHETIC_TEST_ONLY", intent: prepared.intent,
        initialState: prepared.initialState, baseline: prepared.baseline, baselineStructure: prepared.structure,
        plan: prepared.plan, sources, operation: "BOOTSTRAP",
      }),
      /RUNTIME_PRIVILEGE_OPERATOR_RECOVERY_REQUIRED/,
    );
    assert.deepEqual(await readdir(path.join(fixture.root, "preparing")), [path.basename(foreign)]);
    await rm(foreign, { recursive: true, force: false });

    const interruptedName = `${prepared.intent.operation_id}.${"f".repeat(64)}`;
    const interrupted = path.join(fixture.root, "preparing", interruptedName);
    await mkdir(interrupted, { mode: 0o700 });
    await writeFile(path.join(interrupted, RUNTIME_PRIVILEGE_OPERATOR_STATE_ROOT_MARKER), "partial\n", { mode: 0o400 });
    const journal = await prepareRuntimePrivilegeOperatorJournal({
      stateRoot: fixture.root, evidenceScope: "SYNTHETIC_TEST_ONLY", intent: prepared.intent,
      initialState: prepared.initialState, baseline: prepared.baseline, baselineStructure: prepared.structure,
      plan: prepared.plan, sources, operation: "BOOTSTRAP",
    });
    assert.equal(runtimePrivilegeOperatorJournalSnapshot(journal).state.phase, "PREPARED");
    assert.deepEqual(await readdir(path.join(fixture.root, "preparing")), []);
    assert.equal((await readdir(path.join(fixture.root, "active"))).length, 1);
  } finally {
    await rm(fixture.parent, { recursive: true, force: true });
  }
});

test("trusted interrupted writes in active evidence and global receipts are removed before journal validation", async () => {
  const fixture = await journalFixture();
  try {
    const prepared = journalPreparedInputs("runtime-privilege-pending-write-001");
    await prepareRuntimePrivilegeOperatorJournal({
      stateRoot: fixture.root, evidenceScope: "SYNTHETIC_TEST_ONLY", intent: prepared.intent,
      initialState: prepared.initialState, baseline: prepared.baseline, baselineStructure: prepared.structure,
      plan: prepared.plan, sources, operation: "BOOTSTRAP",
    });
    const activeName = (await readdir(path.join(fixture.root, "active")))[0];
    const pendingBytes = Buffer.from("interrupted durable write\n", "utf8");
    const pendingName = `.cyd-write-${createHash("sha256").update(pendingBytes).digest("hex")}.pending`;
    await writeFile(path.join(fixture.root, "active", activeName, pendingName), pendingBytes, { mode: 0o400 });
    await writeFile(path.join(fixture.root, "receipts", pendingName), pendingBytes, { mode: 0o400 });
    await loadRuntimePrivilegeOperatorJournal({
      stateRoot: fixture.root, evidenceScope: "SYNTHETIC_TEST_ONLY", operationId: prepared.intent.operation_id,
      sources, location: "active",
    });
    assert.equal((await readdir(path.join(fixture.root, "active", activeName))).includes(pendingName), false);
    assert.equal((await readdir(path.join(fixture.root, "receipts"))).includes(pendingName), false);
  } finally {
    await rm(fixture.parent, { recursive: true, force: true });
  }
});

test("runner prepares before authorization, dispatches one secret transaction, verifies and archives", async () => {
  const journalFixtureValue = await journalFixture();
  const credential = await credentialFixture();
  try {
    const context = runnerContext(journalFixtureValue, credential, "runtime-privilege-runner-001");
    const baseline = controlledBaseline(targetForContext(context));
    const desired = createControlledRuntimePrivilegeBootstrapPlan(baseline, sources).desired;
    let applied = false;
    let verified = false;
    let transactionReference;
    let clockTick = 0;
    const adapter = {
      clock: () => new Date(Date.UTC(2026, 7, 13, 2, 0, 0, clockTick++)),
      assertControl: async () => {},
      inspectBackupRoot: async () => ({ identity_sha256: "7".repeat(64), fence_absent: true }),
      inspectContainer: async (_context, policy) => ({
        container_id: context.postgres_container_id,
        container_name: context.postgres_container_name,
        image_id: `sha256:${"8".repeat(64)}`,
        image_reference: policy.execution.postgres_image,
      }),
      captureState: async () => structuredClone(applied ? desired : baseline),
      captureStructure: async () => Buffer.from(applied ? "synthetic runner final structure\n" : "synthetic runner baseline structure\n"),
      applyTransaction: async (_context, _policy, transaction) => {
        transactionReference = transaction;
        assert.equal(Buffer.isBuffer(transaction), true);
        assert.equal((transaction.toString("utf8").match(/^\\password /gmu) || []).length, 5);
        for (const role of roles) assert.equal(transaction.toString("utf8").includes(credential.values[role]), true);
        assert.equal(transaction.toString("utf8").includes(credential.values.admin_application), false);
        assert.equal(transaction.toString("utf8").includes(credential.values.postgres_bootstrap), false);
        applied = true;
      },
      verifyCredentials: async () => { verified = true; },
    };
    const structureCalls = [];
    const structureValidator = (report, options) => {
      structureCalls.push({ report, allowPlatformOwnership: options.allowPlatformOwnership });
      assert.match(report, /^synthetic runner (?:baseline|final) structure\n$/);
      return {};
    };
    const prepared = await prepareControlledRuntimePrivilegeOperation(context, adapter, { structureValidator });
    assert.equal(prepared.result, "PREPARED");
    assert.equal(applied, false);
    const resumed = await prepareControlledRuntimePrivilegeOperation(context, adapter, { structureValidator });
    assert.equal(resumed.result, "ALREADY_PREPARED");
    assert.equal(resumed.intent_sha256, prepared.intent_sha256);
    const active = await loadRuntimePrivilegeOperatorJournal({
      stateRoot: context.state_root, evidenceScope: context.evidence_scope, operationId: context.operation_id, sources, location: "active",
    });
    assert.equal(runtimePrivilegeOperatorJournalSnapshot(active).state.phase, "PREPARED");
    const result = await executePreparedRuntimePrivilegeOperation(context, adapter, { structureValidator });
    assert.equal(result.result, "VERIFIED");
    assert.equal(applied, true);
    assert.equal(verified, true);
    assert.equal(transactionReference.every((byte) => byte === 0), true);
    assert.deepEqual(structureCalls.map((call) => call.allowPlatformOwnership), [true, false]);
    assert.equal((await readdir(path.join(context.state_root, "active"))).length, 0);
    assert.equal((await readdir(path.join(context.state_root, "completed"))).length, 1);
  } finally {
    await rm(credential.parent, { recursive: true, force: true });
    await rm(journalFixtureValue.parent, { recursive: true, force: true });
  }
});

test("a structurally desired reconciliation still resets and verifies all five login passwords", async () => {
  const journalFixtureValue = await journalFixture();
  const credential = await credentialFixture();
  try {
    const context = {
      ...runnerContext(journalFixtureValue, credential, "runtime-privilege-password-reconcile-001"),
      operation: "RECONCILE",
      runtime_guard_mode: "POST_DEPLOY_CURRENT_RUNTIME_STRICT",
    };
    const controlled = controlledBaseline(targetForContext(context));
    const baseline = createControlledRuntimePrivilegeBootstrapPlan(controlled, sources).desired;
    const noOpPlan = createRuntimePrivilegeReconciliationPlan(baseline, sources);
    assert.equal(noOpPlan.no_op, true);
    assert.deepEqual(noOpPlan.statements, []);
    let passwordMatches = false;
    let verified = false;
    let transactionReference;
    let clockTick = 0;
    const adapter = {
      clock: () => new Date(Date.UTC(2026, 7, 13, 2, 30, 0, clockTick++)),
      assertControl: async () => {},
      inspectBackupRoot: async () => ({ identity_sha256: "7".repeat(64), fence_absent: true }),
      inspectContainer: async (_context, policy) => ({
        container_id: context.postgres_container_id,
        container_name: context.postgres_container_name,
        image_id: `sha256:${"8".repeat(64)}`,
        image_reference: policy.execution.postgres_image,
      }),
      captureState: async () => structuredClone(baseline),
      captureStructure: async () => Buffer.from("synthetic desired reconciliation structure\n"),
      applyTransaction: async (_context, _policy, transaction) => {
        transactionReference = transaction;
        const rendered = transaction.toString("utf8");
        assert.equal((rendered.match(/^\\password /gmu) || []).length, 5);
        assert.equal(rendered.includes("REVOKE "), false);
        assert.equal(rendered.includes("GRANT "), false);
        assert.equal(rendered.includes("ALTER DATABASE"), false);
        passwordMatches = true;
      },
      verifyCredentials: async () => {
        assert.equal(passwordMatches, true);
        verified = true;
      },
    };
    const structureValidator = () => ({});
    const prepared = await prepareControlledRuntimePrivilegeOperation(context, adapter, { structureValidator });
    assert.equal(prepared.result, "PREPARED");
    const result = await executePreparedRuntimePrivilegeOperation(context, adapter, { structureValidator });
    assert.equal(result.result, "VERIFIED");
    assert.equal(verified, true);
    assert.equal(transactionReference.every((byte) => byte === 0), true);
    assert.equal((await readdir(path.join(context.state_root, "completed"))).length, 1);
  } finally {
    await rm(credential.parent, { recursive: true, force: true });
    await rm(journalFixtureValue.parent, { recursive: true, force: true });
  }
});

test("runner records ambiguous dispatch, then an exact recovery authorization retries and archives", async () => {
  const journalFixtureValue = await journalFixture();
  const credential = await credentialFixture();
  try {
    const context = runnerContext(journalFixtureValue, credential, "runtime-privilege-runner-failure-001");
    const baseline = controlledBaseline(targetForContext(context));
    const desired = createControlledRuntimePrivilegeBootstrapPlan(baseline, sources).desired;
    let transactionReference;
    let applied = false;
    let failTransaction = true;
    let clockTick = 0;
    const adapter = {
      clock: () => new Date(Date.UTC(2026, 7, 13, 3, 0, 0, clockTick++)),
      assertControl: async () => {},
      inspectBackupRoot: async () => ({ identity_sha256: "7".repeat(64), fence_absent: true }),
      inspectContainer: async (_context, policy) => ({ container_id: context.postgres_container_id, container_name: context.postgres_container_name, image_id: `sha256:${"8".repeat(64)}`, image_reference: policy.execution.postgres_image }),
      captureState: async () => structuredClone(applied ? desired : baseline),
      captureStructure: async () => Buffer.from(applied ? "synthetic runner recovered structure\n" : "synthetic runner baseline structure\n"),
      applyTransaction: async (_context, _policy, transaction) => {
        transactionReference = transaction;
        if (failTransaction) throw new Error("injected psql failure");
        applied = true;
      },
      verifyCredentials: async () => {},
    };
    const structureValidator = () => ({});
    const prepared = await prepareControlledRuntimePrivilegeOperation(context, adapter, { structureValidator });
    await assert.rejects(executePreparedRuntimePrivilegeOperation(context, adapter, { structureValidator }), /injected psql failure/);
    assert.equal(transactionReference.every((byte) => byte === 0), true);
    const active = await loadRuntimePrivilegeOperatorJournal({
      stateRoot: context.state_root, evidenceScope: context.evidence_scope, operationId: context.operation_id, sources, location: "active",
    });
    assert.equal(runtimePrivilegeOperatorJournalSnapshot(active).state.phase, "TRANSACTION_DISPATCHED");
    failTransaction = false;
    const recoveryContext = {
      ...context,
      execution_mode: "RECOVERY",
      execution_authorization_id: "runtime-privilege-recovery-001",
      execution_authorization_sha256: "5".repeat(64),
      expected_intent_sha256: prepared.intent_sha256,
      runtime_probe_binding_sha256: "6".repeat(64),
    };
    const recoveryPrepared = await prepareRuntimePrivilegeOperationRecovery(recoveryContext, adapter);
    assert.equal(recoveryPrepared.result, "RECOVERY_PREPARED");
    assert.equal(recoveryPrepared.decision, "RETRY_TRANSACTION");
    const recoveryPreparedAgain = await prepareRuntimePrivilegeOperationRecovery(recoveryContext, adapter);
    assert.equal(recoveryPreparedAgain.recovery_record_sha256, recoveryPrepared.recovery_record_sha256);
    const recovered = await executeRuntimePrivilegeOperationRecovery(recoveryContext, adapter, { structureValidator });
    assert.equal(recovered.result, "VERIFIED");
    assert.equal(applied, true);
    assert.equal(transactionReference.every((byte) => byte === 0), true);
    assert.equal((await readdir(path.join(context.state_root, "active"))).length, 0);
    assert.equal((await readdir(path.join(context.state_root, "completed"))).length, 1);
  } finally {
    await rm(credential.parent, { recursive: true, force: true });
    await rm(journalFixtureValue.parent, { recursive: true, force: true });
  }
});

test("recovery reuses a durable credential proof after a crash before the VERIFIED state", async () => {
  const journalFixtureValue = await journalFixture();
  const credential = await credentialFixture();
  try {
    const context = runnerContext(journalFixtureValue, credential, "runtime-privilege-runner-proof-crash-001");
    const baseline = controlledBaseline(targetForContext(context));
    const desired = createControlledRuntimePrivilegeBootstrapPlan(baseline, sources).desired;
    const finalStructure = Buffer.from("synthetic runner proof crash final structure\n");
    let applied = false;
    let verified = 0;
    let clockTick = 0;
    const adapter = {
      clock: () => new Date(Date.UTC(2026, 7, 13, 3, 30, 0, clockTick++)),
      assertControl: async () => {},
      inspectBackupRoot: async () => ({ identity_sha256: "7".repeat(64), fence_absent: true }),
      inspectContainer: async (_context, policy) => ({ container_id: context.postgres_container_id, container_name: context.postgres_container_name, image_id: `sha256:${"8".repeat(64)}`, image_reference: policy.execution.postgres_image }),
      captureState: async () => structuredClone(applied ? desired : baseline),
      captureStructure: async () => Buffer.from(applied ? finalStructure : "synthetic runner proof crash baseline structure\n"),
      applyTransaction: async () => assert.fail("publication recovery must not dispatch SQL"),
      verifyCredentials: async () => { verified += 1; },
    };
    const structureValidator = () => ({});
    const prepared = await prepareControlledRuntimePrivilegeOperation(context, adapter, { structureValidator });
    const active = await loadRuntimePrivilegeOperatorJournal({
      stateRoot: context.state_root, evidenceScope: context.evidence_scope, operationId: context.operation_id, sources, location: "active",
    });
    await appendRuntimePrivilegeOperatorJournalState(active, "AUTHORIZATION_CONSUMED", "2026-08-13T03:30:00.010Z");
    await appendRuntimePrivilegeOperatorJournalState(active, "TRANSACTION_DISPATCHED", "2026-08-13T03:30:00.011Z");
    applied = true;
    await persistRuntimePrivilegeOperatorPostcommitCapture(active, desired, finalStructure);
    await appendRuntimePrivilegeOperatorJournalState(active, "POSTCOMMIT_CAPTURED", "2026-08-13T03:30:00.012Z", clusterSha256(desired));
    const snapshot = runtimePrivilegeOperatorJournalSnapshot(active);
    const proof = createRuntimePrivilegeOperatorCredentialProof({ intent: snapshot.intent, verifiedAt: "2026-08-13T03:30:00.013Z" });
    await persistRuntimePrivilegeOperatorCredentialProof(active, proof);
    clockTick = 20;
    const recoveryContext = {
      ...context,
      execution_mode: "RECOVERY",
      execution_authorization_id: "runtime-privilege-recovery-proof-crash-001",
      execution_authorization_sha256: "d".repeat(64),
      expected_intent_sha256: prepared.intent_sha256,
      runtime_probe_binding_sha256: "e".repeat(64),
    };
    const recoveryPrepared = await prepareRuntimePrivilegeOperationRecovery(recoveryContext, adapter);
    assert.equal(recoveryPrepared.decision, "FINISH_PUBLICATION");
    const result = await executeRuntimePrivilegeOperationRecovery(recoveryContext, adapter, { structureValidator });
    assert.equal(result.result, "VERIFIED");
    assert.equal(verified, 1);
    assert.equal((await readdir(path.join(context.state_root, "active"))).length, 0);
    assert.equal((await readdir(path.join(context.state_root, "completed"))).length, 1);
  } finally {
    await rm(credential.parent, { recursive: true, force: true });
    await rm(journalFixtureValue.parent, { recursive: true, force: true });
  }
});

test("recovery completes an exact postcommit evidence pair after a crash between its two durable writes", async () => {
  const journalFixtureValue = await journalFixture();
  const credential = await credentialFixture();
  try {
    const context = runnerContext(journalFixtureValue, credential, "runtime-privilege-runner-postcommit-crash-001");
    const baseline = controlledBaseline(targetForContext(context));
    const desired = createControlledRuntimePrivilegeBootstrapPlan(baseline, sources).desired;
    const finalStructure = Buffer.from("synthetic runner postcommit crash final structure\n");
    let applied = false;
    let verified = 0;
    let clockTick = 0;
    const adapter = {
      clock: () => new Date(Date.UTC(2026, 7, 13, 3, 45, 0, clockTick++)),
      assertControl: async () => {},
      inspectBackupRoot: async () => ({ identity_sha256: "7".repeat(64), fence_absent: true }),
      inspectContainer: async (_context, policy) => ({ container_id: context.postgres_container_id, container_name: context.postgres_container_name, image_id: `sha256:${"8".repeat(64)}`, image_reference: policy.execution.postgres_image }),
      captureState: async () => structuredClone(applied ? desired : baseline),
      captureStructure: async () => Buffer.from(applied ? finalStructure : "synthetic runner postcommit crash baseline structure\n"),
      applyTransaction: async () => assert.fail("postcommit recovery must not dispatch SQL"),
      verifyCredentials: async () => { verified += 1; },
    };
    const structureValidator = () => ({});
    const prepared = await prepareControlledRuntimePrivilegeOperation(context, adapter, { structureValidator });
    const active = await loadRuntimePrivilegeOperatorJournal({
      stateRoot: context.state_root, evidenceScope: context.evidence_scope, operationId: context.operation_id, sources, location: "active",
    });
    await appendRuntimePrivilegeOperatorJournalState(active, "AUTHORIZATION_CONSUMED", "2026-08-13T03:45:00.010Z");
    await appendRuntimePrivilegeOperatorJournalState(active, "TRANSACTION_DISPATCHED", "2026-08-13T03:45:00.011Z");
    applied = true;
    const activeName = (await readdir(path.join(context.state_root, "active")))[0];
    const partialFile = path.join(context.state_root, "active", activeName, "final-state.json");
    await writeFile(partialFile, canonicalClusterJson(desired), { mode: 0o400 });
    await chmod(partialFile, 0o400);
    const partiallyLoaded = await loadRuntimePrivilegeOperatorJournal({
      stateRoot: context.state_root, evidenceScope: context.evidence_scope, operationId: context.operation_id, sources, location: "active",
    });
    const partialEvidence = runtimePrivilegeOperatorJournalEvidence(partiallyLoaded);
    assert.notEqual(partialEvidence.finalState, null);
    assert.equal(partialEvidence.finalStructure, null);
    const recoveryContext = {
      ...context,
      execution_mode: "RECOVERY",
      execution_authorization_id: "runtime-privilege-recovery-postcommit-crash-001",
      execution_authorization_sha256: "f".repeat(64),
      expected_intent_sha256: prepared.intent_sha256,
      runtime_probe_binding_sha256: "e".repeat(64),
    };
    const recoveryPrepared = await prepareRuntimePrivilegeOperationRecovery(recoveryContext, adapter);
    assert.equal(recoveryPrepared.decision, "CAPTURE_AND_VERIFY");
    const result = await executeRuntimePrivilegeOperationRecovery(recoveryContext, adapter, { structureValidator });
    assert.equal(result.result, "VERIFIED");
    assert.equal(verified, 1);
    assert.equal((await readdir(path.join(context.state_root, "active"))).length, 0);
    assert.equal((await readdir(path.join(context.state_root, "completed"))).length, 1);
  } finally {
    await rm(credential.parent, { recursive: true, force: true });
    await rm(journalFixtureValue.parent, { recursive: true, force: true });
  }
});

test("recovery authorization quarantines an active intent when a backup fence is present", async () => {
  const journalFixtureValue = await journalFixture();
  const credential = await credentialFixture();
  try {
    const context = runnerContext(journalFixtureValue, credential, "runtime-privilege-runner-quarantine-001");
    const baseline = controlledBaseline(targetForContext(context));
    let fenced = false;
    let clockTick = 0;
    const adapter = {
      clock: () => new Date(Date.UTC(2026, 7, 13, 4, 0, 0, clockTick++)),
      assertControl: async () => {},
      inspectBackupRoot: async () => ({ identity_sha256: "7".repeat(64), fence_absent: !fenced }),
      inspectContainer: async (_context, policy) => ({
        container_id: context.postgres_container_id,
        container_name: context.postgres_container_name,
        image_id: `sha256:${"8".repeat(64)}`,
        image_reference: policy.execution.postgres_image,
      }),
      captureState: async () => structuredClone(baseline),
      captureStructure: async () => Buffer.from("synthetic runner baseline structure\n"),
      applyTransaction: async () => assert.fail("quarantined recovery must not dispatch SQL"),
      verifyCredentials: async () => assert.fail("quarantined recovery must not probe credentials"),
    };
    const prepared = await prepareControlledRuntimePrivilegeOperation(context, adapter, { structureValidator: () => ({}) });
    fenced = true;
    const recoveryContext = {
      ...context,
      execution_mode: "RECOVERY",
      execution_authorization_id: "runtime-privilege-recovery-quarantine-001",
      execution_authorization_sha256: "9".repeat(64),
      expected_intent_sha256: prepared.intent_sha256,
      runtime_probe_binding_sha256: "a".repeat(64),
    };
    const recoveryPrepared = await prepareRuntimePrivilegeOperationRecovery(recoveryContext, adapter);
    assert.equal(recoveryPrepared.decision, "QUARANTINE");
    const result = await executeRuntimePrivilegeOperationRecovery(recoveryContext, adapter, { structureValidator: () => ({}) });
    assert.equal(result.result, "QUARANTINED");
    assert.equal((await readdir(path.join(context.state_root, "active"))).length, 0);
    assert.equal((await readdir(path.join(context.state_root, "quarantine"))).length, 1);
    assert.equal(shellInterlock(context.state_root).status, 1);
  } finally {
    await rm(credential.parent, { recursive: true, force: true });
    await rm(journalFixtureValue.parent, { recursive: true, force: true });
  }
});

test("real PG17 system-adapter harness preserves container identity, crash recovery and secret-log assertions", async () => {
  const wrapper = await readFile(new URL("../scripts/run-runtime-privilege-catalog-postgres-test.sh", import.meta.url), "utf8");
  const container = await readFile(new URL("./selfhost-postgresql-runtime-privilege-catalog-postgres.sh", import.meta.url), "utf8");
  const harness = await readFile(new URL("./runtime-privilege-system-adapter-postgres-e2e.mjs", import.meta.url), "utf8");
  assert.match(wrapper, /\[ "\$MODE" = system-adapter \]/);
  assert.match(wrapper, /--user 999:999/);
  assert.match(wrapper, /com\.docker\.compose\.service=postgres/);
  assert.match(wrapper, /system-adapter-secret-patterns/);
  assert.match(wrapper, /RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_LOG_HASH_EXPOSED/);
  assert.match(container, /controlled_runtime_mode=1/);
  assert.match(container, /listen_addresses='\*'/);
  assert.match(harness, /createRuntimePrivilegeOperatorSystemAdapter/);
  assert.match(harness, /process\.kill\(process\.pid, "SIGKILL"\)/);
  assert.match(harness, /"CAPTURE_AND_VERIFY"/);
  assert.match(harness, /operation: "RECONCILE"/);
  assert.match(harness, /backup-credentials[\s\S]+pg_capture_service\.conf/);
});
