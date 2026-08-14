import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "../scripts/backup-recovery-contract.mjs";
import { canonicalClusterJson } from "../scripts/postgresql-cluster-recovery-contract.mjs";
import {
  RUNTIME_PRIVILEGE_OPERATOR_STATE_ROOT_MARKER,
  RUNTIME_PRIVILEGE_OPERATOR_STATE_ROOT_MARKER_VALUE,
} from "../scripts/postgresql-runtime-privilege-journal.mjs";
import {
  RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_CONTRACT,
  createRuntimePrivilegeOperatorSystemAdapter,
  executePreparedRuntimePrivilegeOperation,
  executeRuntimePrivilegeOperationRecovery,
  prepareControlledRuntimePrivilegeOperation,
  prepareRuntimePrivilegeOperationRecovery,
} from "../scripts/postgresql-runtime-privilege-runner.mjs";

const SCRIPT = fileURLToPath(import.meta.url);
const TASK_ROOT = /^\/tmp\/cyd-runtime-privilege-catalog-runtime\.[A-Za-z0-9]+\/system-adapter$/;
const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SYSTEM_IDENTIFIER = /^[1-9][0-9]{9,29}$/;
const OID = /^[1-9][0-9]{0,9}$/;
const LOGIN_ROLES = Object.freeze([
  "chenyida_erp_admin",
  "chenyida_erp_backup",
  "chenyida_erp_owner",
  "chenyida_erp_web",
  "chenyida_erp_worker",
]);
const CREDENTIAL_MARKER = ".chenyida-erp-credential-root-v2";
const CREDENTIAL_MARKER_VALUE = "chenyida-erp-credential-root/v2\n";
const BACKUP_MARKER = ".chenyida-erp-backup-root-v2";
const BACKUP_MARKER_VALUE = "chenyida-erp-backup-root/v2\n";
const CONTROL_SHELL = "set -eu\n: \"${POSTGRES_USER:?}\" \"${POSTGRES_DB:?}\"\nexec psql --no-psqlrc --quiet --username=\"$POSTGRES_USER\" --dbname=\"$POSTGRES_DB\" \"$@\"\n";

function reject(code = "RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_E2E_INVALID") {
  throw new Error(code);
}

async function writePrivate(file, value, mode = 0o400) {
  await writeFile(file, value, { mode, flag: "wx" });
  await chmod(file, mode);
}

async function createJournalRoot(root) {
  const stateRoot = path.join(root, "operator-state");
  await mkdir(stateRoot, { mode: 0o700 });
  await writePrivate(path.join(stateRoot, RUNTIME_PRIVILEGE_OPERATOR_STATE_ROOT_MARKER), RUNTIME_PRIVILEGE_OPERATOR_STATE_ROOT_MARKER_VALUE);
  for (const directory of ["active", "completed", "preparing", "quarantine", "receipts"]) {
    await mkdir(path.join(stateRoot, directory), { mode: 0o700 });
  }
  return stateRoot;
}

async function createCredentialSources(root) {
  const runtimeSecretRoot = path.join(root, "runtime-secrets");
  const backupCredentialRoot = path.join(root, "backup-credentials");
  await mkdir(runtimeSecretRoot, { mode: 0o700 });
  await mkdir(backupCredentialRoot, { mode: 0o700 });
  await writePrivate(path.join(backupCredentialRoot, CREDENTIAL_MARKER), CREDENTIAL_MARKER_VALUE);
  const names = [
    "admin-database-password",
    "backup-database-password",
    "migration-database-password",
    "web-database-password",
    "worker-database-password",
    "admin-password",
    "postgres-bootstrap-password",
  ];
  const values = new Map();
  try {
    for (const name of names) {
      let value;
      do {
        value?.fill(0);
        value = Buffer.from(randomBytes(32).toString("base64url"), "ascii");
      }
      while (value.length !== 43 || [...values.values()].some((other) => other.equals(value)));
      values.set(name, value);
    }
    const runtimeFiles = Object.freeze([
      ["admin-database-password", "admin-database-password"],
      ["migration-database-password", "migration-database-password"],
      ["web-database-password", "web-database-password"],
      ["worker-database-password", "worker-database-password"],
      ["admin-password", "admin-password"],
      ["postgres-bootstrap-password", "postgres-bootstrap-password"],
    ]);
    for (const [fileName, valueName] of runtimeFiles) {
      const source = Buffer.concat([values.get(valueName), Buffer.from("\n")]);
      try { await writePrivate(path.join(runtimeSecretRoot, fileName), source); }
      finally { source.fill(0); }
    }
    const serviceName = "backup_capture";
    const serviceFile = path.join(backupCredentialRoot, "pg_capture_service.conf");
    const serviceSource = Buffer.concat([
      Buffer.from(`[${serviceName}]\nhost=127.0.0.1\nport=5432\ndbname=chenyida_erp\nuser=chenyida_erp_backup\npassword=`, "ascii"),
      values.get("backup-database-password"),
      Buffer.from("\n"),
    ]);
    try { await writePrivate(serviceFile, serviceSource); }
    finally { serviceSource.fill(0); }
    return { runtimeSecretRoot, backupCredentialRoot, serviceFile, serviceName };
  } finally {
    for (const value of values.values()) value.fill(0);
    values.clear();
  }
}

async function createBackupRoot(root) {
  const backupRoot = path.join(root, "backup-root");
  await mkdir(backupRoot, { mode: 0o700 });
  await writePrivate(path.join(backupRoot, BACKUP_MARKER), BACKUP_MARKER_VALUE);
  return backupRoot;
}

function controlContext({ root, stateRoot, credential, backupRoot, containerName, containerId, deploymentId, systemIdentifier, databaseOid, marker }) {
  const operationId = "system-adapter-bootstrap-e2e";
  return {
    schema_version: 2,
    contract: RUNTIME_PRIVILEGE_OPERATOR_CONTROL_CONTEXT_CONTRACT,
    evidence_scope: "SYNTHETIC_TEST_ONLY",
    operation_id: operationId,
    operation: "BOOTSTRAP",
    deployment_class: "TEST",
    deployment_id: deploymentId,
    execution_mode: "ORIGINAL",
    execution_authorization_id: operationId,
    execution_authorization_sha256: "2".repeat(64),
    expected_intent_sha256: null,
    state_root: stateRoot,
    runtime_secret_root: credential.runtimeSecretRoot,
    backup_credential_root: credential.backupCredentialRoot,
    backup_capture_service_file: credential.serviceFile,
    backup_capture_service: credential.serviceName,
    credential_generation_id: "system-adapter-e2e-generation",
    backup_root: backupRoot,
    release_manifest: path.join(root, "synthetic-release-manifest.json"),
    release_manifest_sha256: "0".repeat(64),
    runtime_guard_mode: "PRE_DEPLOY_POSTGRESQL_BOOTSTRAP_BOUND",
    postgres_container_name: containerName,
    postgres_container_id: containerId,
    expected_database: "chenyida_erp",
    expected_database_oid: databaseOid,
    expected_system_identifier: systemIdentifier,
    expected_database_marker: marker,
    supervisor_bundle_sha256: "1".repeat(64),
    authorization_sha256: "2".repeat(64),
    runtime_configuration_sha256: "3".repeat(64),
    runtime_probe_binding_sha256: "4".repeat(64),
  };
}

async function readCanonical(file) {
  const bytes = await readFile(file);
  const value = parseStrictJson(bytes.toString("utf8"), 128 * 1024);
  if (!bytes.equals(Buffer.from(canonicalClusterJson(value), "utf8"))) reject();
  return value;
}

async function assertSystemAdapterTransport(context) {
  const sql = await readFile(new URL("../scripts/postgresql-runtime-privilege-state.sql", import.meta.url));
  let result;
  try {
    result = spawnSync("/usr/bin/docker", [
      "exec", "-i", "--", context.postgres_container_name, "/bin/sh", "-ceu", CONTROL_SHELL, "sh",
      "--no-align", "--tuples-only", "--field-separator=\t", "--set=ON_ERROR_STOP=1",
      `--set=expected_database=${context.expected_database}`,
      "--set=migration_owner=chenyida_erp_owner",
      `--set=expected_marker=${context.expected_database_marker}`,
      `--set=expected_system_identifier=${context.expected_system_identifier}`,
      "--set=controlled_runtime_mode=1",
    ], {
      env: { PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: "/nonexistent" },
      input: sql,
      encoding: null,
      timeout: 90_000,
      maxBuffer: 32 * 1024 * 1024,
    });
  } finally { sql.fill(0); }
  if (result.error || result.status !== 0 || result.signal !== null) reject("RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_TRANSPORT_PSQL_FAILED");
  const rendered = result.stdout.toString("utf8").trim();
  if (!rendered) reject("RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_TRANSPORT_JSON_EMPTY");
  if (!rendered.startsWith("{")) {
    if (/^(?:BEGIN|COMMIT|SET)\b/.test(rendered)) reject("RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_TRANSPORT_COMMAND_TAG_OUTPUT");
    if (/^RUNTIME_PRIVILEGE_[A-Z0-9_]+$/.test(rendered.split("\n", 1)[0])) reject("RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_TRANSPORT_CONTROL_REJECTED");
    reject("RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_TRANSPORT_JSON_PREFIX_INVALID");
  }
  try { JSON.parse(rendered); }
  catch { reject("RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_TRANSPORT_JSON_SYNTAX_INVALID"); }
  try { parseStrictJson(rendered, 32 * 1024 * 1024); }
  catch (error) {
    const suffix = typeof error?.code === "string" && /^JSON_[A-Z0-9_]+$/.test(error.code) ? error.code : "JSON_FAILED";
    reject(`RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_TRANSPORT_${suffix}`);
  }
}

async function crashAfterRealTransaction(root) {
  const context = await readCanonical(path.join(root, "context.json"));
  const systemAdapter = createRuntimePrivilegeOperatorSystemAdapter();
  const crashAdapter = Object.freeze({
    ...systemAdapter,
    applyTransaction: async (...argumentsList) => {
      await systemAdapter.applyTransaction(...argumentsList);
      process.kill(process.pid, "SIGKILL");
      await new Promise(() => {});
    },
  });
  await executePreparedRuntimePrivilegeOperation(context, crashAdapter);
  reject("RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_E2E_CRASH_NOT_OBSERVED");
}

async function run(argumentsList) {
  if (argumentsList.length !== 7) reject();
  const [rootInput, containerName, containerId, deploymentId, systemIdentifier, databaseOid, marker] = argumentsList;
  const root = path.resolve(rootInput);
  if (!TASK_ROOT.test(root) || !IDENTIFIER.test(containerName) || !SHA256.test(containerId) || !IDENTIFIER.test(deploymentId)
    || !SYSTEM_IDENTIFIER.test(systemIdentifier) || !OID.test(databaseOid)
    || marker !== `chenyida-erp-deployment/v2:TEST:${deploymentId}`) reject();
  await mkdir(root, { mode: 0o700 });
  if (await realpath(root) !== root) reject();
  const stateRoot = await createJournalRoot(root);
  const credential = await createCredentialSources(root);
  const backupRoot = await createBackupRoot(root);
  const context = controlContext({ root, stateRoot, credential, backupRoot, containerName, containerId, deploymentId, systemIdentifier, databaseOid, marker });
  const contextFile = path.join(root, "context.json");
  await writePrivate(contextFile, canonicalClusterJson(context), 0o600);
  const systemAdapter = createRuntimePrivilegeOperatorSystemAdapter();
  await assertSystemAdapterTransport(context);
  const prepared = await prepareControlledRuntimePrivilegeOperation(context, systemAdapter);
  assert.equal(prepared.result, "PREPARED");
  await writePrivate(path.join(root, "prepared.json"), canonicalClusterJson(prepared), 0o600);
  const crash = spawnSync(process.execPath, [SCRIPT, "crash-after-transaction", root], {
    env: { PATH: process.env.PATH || "/usr/bin:/bin", LC_ALL: "C", NODE_ENV: "test", ERP_RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_E2E: "YES" },
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 1024 * 1024,
  });
  assert.equal(crash.status, null);
  assert.equal(crash.signal, "SIGKILL");
  assert.equal(crash.stdout, "");
  assert.equal(crash.stderr, "");
  const recoveryContext = {
    ...context,
    execution_mode: "RECOVERY",
    execution_authorization_id: "system-adapter-recovery-e2e",
    execution_authorization_sha256: "5".repeat(64),
    expected_intent_sha256: prepared.intent_sha256,
    runtime_probe_binding_sha256: "6".repeat(64),
  };
  const recoveryPrepared = await prepareRuntimePrivilegeOperationRecovery(recoveryContext, systemAdapter);
  assert.equal(recoveryPrepared.result, "RECOVERY_PREPARED");
  assert.equal(recoveryPrepared.decision, "CAPTURE_AND_VERIFY");
  const recovered = await executeRuntimePrivilegeOperationRecovery(recoveryContext, systemAdapter);
  assert.equal(recovered.result, "VERIFIED");
  const reconcileContext = {
    ...context,
    operation_id: "system-adapter-reconcile-e2e",
    operation: "RECONCILE",
    execution_authorization_id: "system-adapter-reconcile-e2e",
    execution_authorization_sha256: "8".repeat(64),
    authorization_sha256: "8".repeat(64),
    runtime_guard_mode: "POST_DEPLOY_CURRENT_RUNTIME_STRICT",
    runtime_probe_binding_sha256: "9".repeat(64),
  };
  const reconcilePrepared = await prepareControlledRuntimePrivilegeOperation(reconcileContext, systemAdapter);
  assert.equal(reconcilePrepared.result, "PREPARED");
  const reconciled = await executePreparedRuntimePrivilegeOperation(reconcileContext, systemAdapter);
  assert.equal(reconciled.result, "VERIFIED");
  assert.deepEqual(await readdir(path.join(stateRoot, "active")), []);
  assert.equal((await readdir(path.join(stateRoot, "completed"))).length, 2);
  assert.equal((await readdir(path.join(stateRoot, "receipts"))).length, 2);
  const evidence = {
    result: "VERIFIED",
    crash_signal: "SIGKILL",
    recovery_decision: recoveryPrepared.decision,
    bootstrap_receipt_sha256: recovered.receipt_sha256,
    reconcile_receipt_sha256: reconciled.receipt_sha256,
  };
  await writePrivate(path.join(root, "e2e-result.json"), canonicalClusterJson(evidence), 0o600);
  process.stdout.write("runtime privilege real system adapter PG17 crash recovery passed\n");
}

async function main() {
  if (process.env.NODE_ENV !== "test" || process.env.ERP_RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_E2E !== "YES") reject();
  const [command, ...argumentsList] = process.argv.slice(2);
  if (command === "run") await run(argumentsList);
  else if (command === "crash-after-transaction" && argumentsList.length === 1) await crashAfterRealTransaction(path.resolve(argumentsList[0]));
  else reject();
}

main().catch((error) => {
  const code = typeof error?.code === "string" && /^RUNTIME_PRIVILEGE_[A-Z0-9_]+$/.test(error.code)
    ? error.code
    : /^RUNTIME_PRIVILEGE_[A-Z0-9_]+$/.test(error?.message || "")
      ? error.message
      : "RUNTIME_PRIVILEGE_SYSTEM_ADAPTER_E2E_INVALID";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
