import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "./backup-recovery-contract.mjs";
import {
  buildIsolatedUatDatabaseBootstrapTransaction,
  buildIsolatedUatDatabaseFinalReconciliationTransaction,
  buildIsolatedUatDatabaseUnfenceTransaction,
  createIsolatedUatDatabaseBootstrapPlan,
  createIsolatedUatDatabaseFinalReconciliation,
  createIsolatedUatDatabaseMigrationResult,
  createIsolatedUatDatabaseUnfencePlan,
  disposeIsolatedUatDatabaseTransaction,
  renderIsolatedUatDatabaseObservationSql,
  verifyIsolatedUatDatabaseBootstrapResult,
  verifyIsolatedUatDatabaseFinalState,
  verifyIsolatedUatDatabaseMigration,
  verifyIsolatedUatDatabaseUnfence,
} from "./isolated-uat-database-operator.mjs";
import { assertIsolatedUatMigrationEngineResultMatchesGrant } from "./isolated-uat-migration-execution-contract.mjs";
import { canonicalClusterJson } from "./postgresql-cluster-recovery-contract.mjs";
import {
  assertRuntimePrivilegeOperatorCredentialsUnchanged,
  disposeRuntimePrivilegeOperatorCredentials,
  readRuntimePrivilegeOperatorCredentials,
  withRuntimePrivilegeOperatorPassword,
} from "./postgresql-runtime-privilege-operator.mjs";
import {
  buildMigrationAllowlist,
  migrationAllowlistDigest,
  validateAppliedMigrationRows,
} from "./release-manifest-contract.mjs";

export const ISOLATED_UAT_DATABASE_OPERATION_CLI_COMMANDS = Object.freeze([
  "observation-sql",
  "bootstrap-plan",
  "bootstrap-transaction",
  "bootstrap-verify",
  "migration-verify",
  "unfence-plan",
  "unfence-transaction",
  "unfence-verify",
  "final-plan",
  "final-transaction",
  "final-verify",
]);
export const ISOLATED_UAT_DATABASE_OPERATION_CLI_MAX_INPUT_BYTES = 8 * 1024 * 1024;

const SITE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PROJECT = /^chenyida-erp-uat-[a-z0-9][a-z0-9_-]{0,42}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,127}$/u;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const SOURCE_PATHS = Object.freeze({
  access: "operations/postgresql-runtime-privilege-access-v2.json",
  catalog: "operations/postgresql-runtime-privilege-compiled-catalog-v1.json",
  policy: "operations/postgresql-runtime-privilege-policy-v2.json",
});
const MIGRATION_ROOT = path.resolve(SITE_ROOT, "drizzle-postgres");
const BACKUP_CAPTURE_SERVICE_FILE = "backup-capture-service.conf";
const BACKUP_CAPTURE_SERVICE = "backup_capture";
const DATABASE_NAME = "chenyida_erp";

export class IsolatedUatDatabaseOperationCliError extends Error {
  constructor(code) {
    super(code);
    this.name = "IsolatedUatDatabaseOperationCliError";
    this.code = code;
  }
}

function reject(code) { throw new IsolatedUatDatabaseOperationCliError(code); }

function exactKeys(value, expected, code = "ISOLATED_UAT_DATABASE_CLI_INPUT_FIELDS_INVALID") {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) reject(code);
  return value;
}

function string(value, pattern, code) {
  if (typeof value !== "string" || value !== value.normalize("NFC") || !pattern.test(value)) reject(code);
  return value;
}

function parseCanonicalInput(rawInput) {
  const raw = Buffer.isBuffer(rawInput) ? rawInput : Buffer.from(rawInput || "");
  if (raw.length < 3 || raw.length > ISOLATED_UAT_DATABASE_OPERATION_CLI_MAX_INPUT_BYTES) {
    reject("ISOLATED_UAT_DATABASE_CLI_INPUT_INVALID");
  }
  let text;
  let value;
  try {
    text = UTF8.decode(raw);
    value = parseStrictJson(text);
    if (canonicalClusterJson(value) !== text) reject("ISOLATED_UAT_DATABASE_CLI_INPUT_NOT_CANONICAL");
  } catch (error) {
    if (error instanceof IsolatedUatDatabaseOperationCliError) throw error;
    reject("ISOLATED_UAT_DATABASE_CLI_INPUT_INVALID");
  }
  return value;
}

async function readBoundedFile(file, maximum, code) {
  let handle;
  try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { reject(code); }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
      || before.size < 2 || before.size > maximum) reject(code);
    const raw = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.mode !== after.mode
      || before.uid !== after.uid || before.gid !== after.gid || before.nlink !== after.nlink
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) reject(code);
    return raw;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function loadFixedJson(relative) {
  const file = path.resolve(SITE_ROOT, relative);
  if (!file.startsWith(`${SITE_ROOT}${path.sep}`)) reject("ISOLATED_UAT_DATABASE_CLI_SOURCE_INVALID");
  try { return parseStrictJson(UTF8.decode(await readBoundedFile(file, MAX_SOURCE_BYTES, "ISOLATED_UAT_DATABASE_CLI_SOURCE_INVALID"))); }
  catch (error) {
    if (error instanceof IsolatedUatDatabaseOperationCliError) throw error;
    reject("ISOLATED_UAT_DATABASE_CLI_SOURCE_INVALID");
  }
}

export async function loadIsolatedUatDatabaseOperationSources() {
  const [access, catalog, policy] = await Promise.all([
    loadFixedJson(SOURCE_PATHS.access),
    loadFixedJson(SOURCE_PATHS.catalog),
    loadFixedJson(SOURCE_PATHS.policy),
  ]);
  return Object.freeze({ policy, access, catalog });
}

function projectFrom(value) {
  return string(value?.project, PROJECT, "ISOLATED_UAT_DATABASE_CLI_PROJECT_INVALID");
}

function validateCredentialRequest(value, project, { allowSyntheticCredentialRoots = false } = {}) {
  string(value.credential_generation_id, IDENTIFIER, "ISOLATED_UAT_DATABASE_CLI_CREDENTIAL_GENERATION_INVALID");
  if (typeof value.runtime_secret_root !== "string" || typeof value.backup_credential_root !== "string") {
    reject("ISOLATED_UAT_DATABASE_CLI_CREDENTIAL_ROOT_INVALID");
  }
  const expectedRuntime = `/etc/${project}/runtime-secrets`;
  const expectedBackup = `/etc/${project}/operator-credentials`;
  if (!allowSyntheticCredentialRoots
    && (value.runtime_secret_root !== expectedRuntime || value.backup_credential_root !== expectedBackup)) {
    reject("ISOLATED_UAT_DATABASE_CLI_CREDENTIAL_ROOT_INVALID");
  }
  for (const root of [value.runtime_secret_root, value.backup_credential_root]) {
    if (root !== path.resolve(root) || root === path.parse(root).root) {
      reject("ISOLATED_UAT_DATABASE_CLI_CREDENTIAL_ROOT_INVALID");
    }
  }
  return Object.freeze({
    runtimeSecretRoot: value.runtime_secret_root,
    backupCredentialRoot: value.backup_credential_root,
    backupCaptureServiceFile: path.join(value.backup_credential_root, BACKUP_CAPTURE_SERVICE_FILE),
    backupCaptureService: BACKUP_CAPTURE_SERVICE,
    expectedDatabase: DATABASE_NAME,
    credentialGenerationId: value.credential_generation_id,
    evidenceScope: allowSyntheticCredentialRoots ? "SYNTHETIC_TEST_ONLY" : "ACTUAL_CONTROLLED",
  });
}

async function buildWithCredentials(value, project, builder, options) {
  const configuration = validateCredentialRequest(value, project, options);
  let binding;
  let transaction;
  const supplied = [];
  try {
    binding = await readRuntimePrivilegeOperatorCredentials(configuration);
    await assertRuntimePrivilegeOperatorCredentialsUnchanged(binding);
    const passwordProvider = async (role) => withRuntimePrivilegeOperatorPassword(binding, role, async (password) => {
      const copy = Buffer.from(password);
      supplied.push(copy);
      return copy;
    });
    transaction = await builder({ binding, passwordProvider });
    if (!Buffer.isBuffer(transaction) || transaction.length < 1 || transaction.length > MAX_OUTPUT_BYTES) {
      reject("ISOLATED_UAT_DATABASE_CLI_TRANSACTION_INVALID");
    }
    await assertRuntimePrivilegeOperatorCredentialsUnchanged(binding);
    return transaction;
  } catch (error) {
    if (transaction) disposeIsolatedUatDatabaseTransaction(transaction);
    throw error;
  } finally {
    for (const password of supplied) password.fill(0);
    if (binding) disposeRuntimePrivilegeOperatorCredentials(binding);
  }
}

function jsonResult(value) { return Object.freeze({ kind: "JSON", value }); }
function sqlResult(value) { return Object.freeze({ kind: "SQL", value }); }

function appliedLedgerSha256(rows) {
  const digest = createHash("sha256");
  for (const row of rows) digest.update(canonicalClusterJson(row), "utf8");
  return digest.digest("hex");
}

function migrationResultFromEvidence({ bootstrapReceipt, grant, engineResult, ledger, allowlist, observation }) {
  const verifiedEngine = assertIsolatedUatMigrationEngineResultMatchesGrant(engineResult, grant);
  let observedHead;
  try { observedHead = validateAppliedMigrationRows(ledger, allowlist, verifiedEngine.target_head); }
  catch { reject("ISOLATED_UAT_DATABASE_CLI_MIGRATION_LEDGER_INVALID"); }
  const engineLedger = verifiedEngine.files.map((entry) => ({
    version: entry.filename,
    checksum: entry.sha256,
  }));
  const allowlistSha256 = migrationAllowlistDigest(allowlist);
  const ledgerSha256 = appliedLedgerSha256(ledger);
  const database = grant.database;
  const liveTarget = {
    project: observation?.project,
    deployment_class: observation?.deployment_class,
    database_name: observation?.database_name,
    system_identifier: observation?.system_identifier,
    database_oid: observation?.database_oid,
    marker: observation?.marker,
  };
  const grantedTarget = {
    project: database.deployment_id,
    deployment_class: database.deployment_class,
    database_name: database.database_name,
    system_identifier: database.database_system_identifier,
    database_oid: database.database_oid,
    marker: database.database_marker,
  };
  if (grant.migration_manifest_sha256 !== allowlistSha256
    || verifiedEngine.final_migration_rows_count !== ledger.length
    || canonicalClusterJson(engineLedger) !== canonicalClusterJson(ledger)
    || canonicalClusterJson(liveTarget) !== canonicalClusterJson(grantedTarget)
    || observation?.phase !== "POST_MIGRATION_FENCED"
    || observation?.database_default_transaction_read_only !== "on"
    || observation?.observed_head !== observedHead
    || observation?.observed_head !== verifiedEngine.target_head
    || observation?.applied_count !== ledger.length
    || observation?.applied_ledger_sha256 !== ledgerSha256
    || observation?.other_backend_count !== 0
    || observation?.prepared_transaction_count !== 0) {
    reject("ISOLATED_UAT_DATABASE_CLI_MIGRATION_EVIDENCE_BINDING_INVALID");
  }
  return createIsolatedUatDatabaseMigrationResult({
    status: verifiedEngine.status,
    project: liveTarget.project,
    target: liveTarget,
    bootstrap_receipt_sha256: bootstrapReceipt?.receipt_sha256,
    promotion_id: verifiedEngine.promotion_id,
    migration_operation_id: verifiedEngine.migration_operation_id,
    execution_authorization_sha256: verifiedEngine.execution_authorization_sha256,
    grant_sha256: verifiedEngine.grant_sha256,
    engine_result_sha256: verifiedEngine.engine_result_sha256,
    migration_role: verifiedEngine.migration_role,
    from_head: verifiedEngine.current_head_before,
    to_head: verifiedEngine.target_head,
    applied_count: observation.applied_count,
    allowlist_sha256: allowlistSha256,
    applied_ledger_sha256: observation.applied_ledger_sha256,
    observed_head: observation.observed_head,
    database_default_transaction_read_only: observation.database_default_transaction_read_only,
    migration_transaction_read_only: verifiedEngine.migration_transaction_read_only,
    other_backend_count_before: verifiedEngine.other_backend_count_before,
    other_backend_count_after: verifiedEngine.other_backend_count_after,
  });
}

export async function executeIsolatedUatDatabaseOperation(command, input, options = {}) {
  if (!ISOLATED_UAT_DATABASE_OPERATION_CLI_COMMANDS.includes(command)) {
    reject("ISOLATED_UAT_DATABASE_CLI_COMMAND_INVALID");
  }
  if (command === "observation-sql") {
    exactKeys(input, ["phase", "project"]);
    const transaction = Buffer.from(renderIsolatedUatDatabaseObservationSql(input), "utf8");
    if (transaction.length < 1 || transaction.length > MAX_OUTPUT_BYTES) {
      reject("ISOLATED_UAT_DATABASE_CLI_TRANSACTION_INVALID");
    }
    return sqlResult(transaction);
  }
  const sources = await (options.loadSources || loadIsolatedUatDatabaseOperationSources)();
  switch (command) {
    case "bootstrap-plan": {
      exactKeys(input, ["observation"]);
      return jsonResult(createIsolatedUatDatabaseBootstrapPlan(input.observation, sources));
    }
    case "bootstrap-transaction": {
      exactKeys(input, [
        "plan", "runtime_secret_root", "backup_credential_root", "credential_generation_id",
      ]);
      const project = projectFrom(input.plan);
      return sqlResult(await buildWithCredentials(input, project, ({ passwordProvider }) => (
        buildIsolatedUatDatabaseBootstrapTransaction(input.plan, sources, { passwordProvider })
      ), options));
    }
    case "bootstrap-verify": {
      exactKeys(input, ["plan", "observation"]);
      return jsonResult(verifyIsolatedUatDatabaseBootstrapResult(input.plan, input.observation, sources));
    }
    case "migration-verify": {
      exactKeys(input, ["bootstrap_receipt", "grant", "engine_result", "observation", "ledger"]);
      const allowlist = await (options.loadAllowlist || (() => buildMigrationAllowlist(MIGRATION_ROOT)))();
      const migrationResult = migrationResultFromEvidence({
        bootstrapReceipt: input.bootstrap_receipt,
        grant: input.grant,
        engineResult: input.engine_result,
        observation: input.observation,
        ledger: input.ledger,
        allowlist,
      });
      return jsonResult(verifyIsolatedUatDatabaseMigration({
        bootstrapReceipt: input.bootstrap_receipt,
        migrationResult,
        allowlist,
        ledger: input.ledger,
        observation: input.observation,
      }, sources));
    }
    case "unfence-plan": {
      exactKeys(input, ["migration_receipt"]);
      return jsonResult(createIsolatedUatDatabaseUnfencePlan(input.migration_receipt, sources));
    }
    case "unfence-transaction": {
      exactKeys(input, ["plan", "migration_receipt"]);
      const transaction = buildIsolatedUatDatabaseUnfenceTransaction(input.plan, input.migration_receipt, sources);
      if (!Buffer.isBuffer(transaction) || transaction.length < 1 || transaction.length > MAX_OUTPUT_BYTES) {
        reject("ISOLATED_UAT_DATABASE_CLI_TRANSACTION_INVALID");
      }
      return sqlResult(transaction);
    }
    case "unfence-verify": {
      exactKeys(input, ["plan", "migration_receipt", "observation"]);
      return jsonResult(verifyIsolatedUatDatabaseUnfence(
        input.plan, input.migration_receipt, input.observation, sources,
      ));
    }
    case "final-plan": {
      exactKeys(input, ["unfence_receipt", "baseline_state", "structural_report"]);
      return jsonResult(createIsolatedUatDatabaseFinalReconciliation({
        unfenceReceipt: input.unfence_receipt,
        baselineState: input.baseline_state,
        structuralReport: input.structural_report,
      }, sources, { structuralValidator: options.structuralValidator }));
    }
    case "final-transaction": {
      exactKeys(input, [
        "reconciliation", "unfence_receipt", "baseline_state", "structural_report",
        "runtime_secret_root", "backup_credential_root", "credential_generation_id",
      ]);
      const project = projectFrom(input.reconciliation);
      const finalInput = {
        unfenceReceipt: input.unfence_receipt,
        baselineState: input.baseline_state,
        structuralReport: input.structural_report,
      };
      return sqlResult(await buildWithCredentials(input, project, ({ binding, passwordProvider }) => (
        buildIsolatedUatDatabaseFinalReconciliationTransaction(
          input.reconciliation,
          finalInput,
          sources,
          {
            credentialBinding: binding,
            passwordProvider,
            structuralValidator: options.structuralValidator,
          },
        )
      ), options));
    }
    case "final-verify": {
      exactKeys(input, [
        "reconciliation", "unfence_receipt", "baseline_state", "baseline_structural_report",
        "final_state", "final_structural_report",
      ]);
      return jsonResult(verifyIsolatedUatDatabaseFinalState({
        reconciliation: input.reconciliation,
        unfenceReceipt: input.unfence_receipt,
        baselineState: input.baseline_state,
        baselineStructuralReport: input.baseline_structural_report,
        finalState: input.final_state,
        finalStructuralReport: input.final_structural_report,
      }, sources, { structuralValidator: options.structuralValidator }));
    }
    default:
      reject("ISOLATED_UAT_DATABASE_CLI_COMMAND_INVALID");
  }
}

async function readCanonicalStdin(stream = process.stdin) {
  const chunks = [];
  let total = 0;
  for await (const chunkInput of stream) {
    const chunk = Buffer.isBuffer(chunkInput) ? chunkInput : Buffer.from(chunkInput);
    total += chunk.length;
    if (total > ISOLATED_UAT_DATABASE_OPERATION_CLI_MAX_INPUT_BYTES) {
      reject("ISOLATED_UAT_DATABASE_CLI_INPUT_INVALID");
    }
    chunks.push(chunk);
  }
  return parseCanonicalInput(Buffer.concat(chunks, total));
}

function selectCommand(argumentsList) {
  if (!Array.isArray(argumentsList) || argumentsList.length !== 1) {
    reject(argumentsList?.length === 0
      ? "ISOLATED_UAT_DATABASE_CLI_COMMAND_REQUIRED"
      : "ISOLATED_UAT_DATABASE_CLI_COMMAND_INVALID");
  }
  const command = argumentsList[0];
  if (!ISOLATED_UAT_DATABASE_OPERATION_CLI_COMMANDS.includes(command)) {
    reject("ISOLATED_UAT_DATABASE_CLI_COMMAND_INVALID");
  }
  return command;
}

async function writeOutput(result, stream = process.stdout) {
  const output = result.kind === "JSON"
    ? Buffer.from(canonicalClusterJson(result.value), "utf8")
    : result.value;
  if (!Buffer.isBuffer(output) || output.length < 1 || output.length > MAX_OUTPUT_BYTES) {
    reject("ISOLATED_UAT_DATABASE_CLI_OUTPUT_INVALID");
  }
  await new Promise((resolveWrite, rejectWrite) => {
    stream.write(output, (error) => error ? rejectWrite(error) : resolveWrite());
  }).catch(() => reject("ISOLATED_UAT_DATABASE_CLI_OUTPUT_FAILED"));
}

export async function runIsolatedUatDatabaseOperationCli({
  argumentsList,
  stdin = process.stdin,
  stdout = process.stdout,
  options = {},
}) {
  const command = selectCommand(argumentsList);
  const input = await readCanonicalStdin(stdin);
  const result = await executeIsolatedUatDatabaseOperation(command, input, options);
  try { await writeOutput(result, stdout); }
  finally {
    if (result.kind === "SQL") disposeIsolatedUatDatabaseTransaction(result.value);
  }
}

export function isolatedUatDatabaseOperationCliErrorCode(error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code || "") : "";
  return ERROR_CODE.test(code) ? code : "ISOLATED_UAT_DATABASE_CLI_INTERNAL_ERROR";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runIsolatedUatDatabaseOperationCli({ argumentsList: process.argv.slice(2) }).catch((error) => {
    process.stderr.write(`${isolatedUatDatabaseOperationCliErrorCode(error)}\n`);
    process.exitCode = 1;
  });
}
