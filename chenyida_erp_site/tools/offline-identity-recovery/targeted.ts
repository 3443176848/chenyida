import { createHash, randomUUID } from "node:crypto";
import { constants as fileConstants } from "node:fs";
import {
  chmod,
  chown,
  link,
  lstat,
  open,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { hashPassword, validatePassword, verifyPassword } from "../../app/lib/identity-selfhost/password.ts";
import { PostgresIdentityRepository } from "../../app/lib/identity-selfhost/repository.ts";
import {
  businessFingerprint,
  diagnoseUatCredentialValue,
  EXPECTED_MIGRATIONS,
  RECOVERY_ACCOUNTS,
  RECOVERY_ACTION,
  RECOVERY_ACTOR,
  RECOVERY_REASON,
  RECOVERY_REASON_CODE,
  RECOVERY_SESSION_CLEANUP_ACTION,
  RecoveryError,
  UAT_CREDENTIAL_SCHEMA_VERSION,
  UAT_CREDENTIAL_VALIDATOR_VERSION,
  UAT_CREDENTIAL_WRITER_VERSION,
} from "./core.ts";

export const TARGETED_ACCOUNT = {
  username: "uat_20260729_operations",
  role: "operations",
  active: true,
  mustChangePasswordBefore: true,
  mustChangePasswordAfter: false,
} as const;

export const TARGETED_FORMAL_WEB_IMAGE = "sha256:c1576bd22a209fb6f524e304bcf12cc38af4d67a35c76f37fa8dc1311c2922c8";
export const TARGETED_FORMAL_WORKER_IMAGE = "sha256:32d1ae335610c097d9fa38dd411acabc525c0fe17cfcb863271e32317afe96aa";
export const TARGETED_EXPECTED_MIGRATION = "0038";
export const TARGETED_RECOVERY_MODE = "TARGETED_ACCOUNT_FINALIZATION";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORMAL_DATABASE = "chenyida_erp";
const FORMAL_DATABASE_USER = "chenyida_erp";
const FORMAL_DIRECTORY = "/etc/chenyida-erp";
const FORMAL_CANONICAL = path.join(FORMAL_DIRECTORY, "uat-role-accounts.txt");
const FORMAL_ATTESTATION_DIRECTORY = "/run/chenyida-erp";
const REHEARSAL_STAGE_ROOT = "/run/chenyida-erp/targeted-identity-recovery-tests";
const REHEARSAL_DATABASE = /^cyd_toir_(?:test|restore)_[0-9a-f]{12}$/;
const TARGETED_EXPECTED_MIGRATIONS = [
  ...EXPECTED_MIGRATIONS,
  ["0037_project_planning_revision_response_lineage.sql", "139f2623a184ae3d6927c95b56569cc438deffc2a0b46c325c9f04d59471d99f"],
  ["0038_supplier_mapping_governance.sql", "2da259364151af098641795da55604dc3012b6adf92aec67038c0554e0592941"],
] as const;
const TARGETED_EXPECTED_HEAD = TARGETED_EXPECTED_MIGRATIONS.at(-1)![0];

type TargetedEnvironment = "parallel-uat" | "parallel-uat-rehearsal";

type CredentialAccount = {
  username: string;
  role: string;
  password: string;
  must_change_password: boolean;
};

type UatCredentialDocument = {
  format_version: string;
  generated_at: string;
  accounts: CredentialAccount[];
  recovery_run_id: string;
};

export type TargetedPaths = {
  directory: string;
  canonical: string;
  candidate: string;
};

export type TargetedUserState = {
  username: string;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
  version: number;
};

export type TargetedRecoveryHooks = {
  beforeCandidateWrite?: () => void | Promise<void>;
  afterCandidateWrite?: () => void | Promise<void>;
  afterTargetUpdate?: () => void | Promise<void>;
  beforeCommit?: () => void | Promise<void>;
  afterCommitAcknowledged?: () => void | Promise<void>;
  beforePromotion?: () => void | Promise<void>;
};

export type TargetedRecoveryOptions = {
  pool: Pool;
  environment: TargetedEnvironment;
  deploymentClass: string;
  expectedMigration: string;
  recoveryRunId: string;
  targetUsername: string;
  expectedRole: string;
  expectedActive: boolean;
  expectedUserVersion: number;
  confirmationPhrase: string;
  effectiveUid: number;
  databaseUrl: string;
  password?: string;
  expectedDatabaseName?: string;
  stageDirectory?: string;
  offlineAttestationPath?: string;
  promote: boolean;
  hooks?: TargetedRecoveryHooks;
};

export type TargetedRecoveryResult = {
  status: "canonical_active" | "partial";
  partialPhase?: "TRANSACTION_OUTCOME" | "BUSINESS_PROTECTION" | "PROMOTION";
  code?: string;
  recoveryRunId: string;
  accountCount: 1;
  canonicalAccountCount: 10;
  canonicalErrorCount: 0;
  canonicalDiffCount: 2;
  sessionRevokedCount: number;
  auditCount: 1;
  otherControlledAccountCount: number;
  otherAccountCount: number;
  otherAccountsUnchanged: boolean;
  otherSessionsUnchanged: boolean;
  businessFingerprintBefore: string;
  businessFingerprintAfter: string;
  targetBefore: TargetedUserState;
  targetAfter: TargetedUserState;
  paths: TargetedPaths;
};

export type TargetedSessionCleanupResult = {
  accountCount: 1;
  sessionRevokedCount: number;
  auditCount: 1;
  remainingSessionCount: 0;
  verificationAttempt: 1 | 2;
};

type CandidateEvidence = {
  paths: TargetedPaths;
  canonicalBeforeDigest: string;
  candidateDigest: string;
  canonicalRunId: string;
  targetIndex: number;
};

type IdentitySnapshot = {
  controlledOtherCount: number;
  allOtherCount: number;
  controlledOtherNonSecretDigest: string;
  controlledOtherSecretDigest: string;
  allOtherNonSecretDigest: string;
  allOtherSecretDigest: string;
  otherSessionsDigest: string;
};

type TransactionEvidence = {
  targetBefore: TargetedUserState;
  targetAfter: TargetedUserState;
  sessionRevokedCount: number;
  identityBefore: IdentitySnapshot;
  identityAfter: IdentitySnapshot;
};

type CommitEvidence = {
  sessionRevokedCount: number;
  businessFingerprintBefore: string;
  canonicalBeforeDigest: string;
  candidateDigest: string;
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function nodeErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return false;
    throw error;
  }
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (nodeErrorCode(error) !== "ENOENT") throw error;
  }
}

async function fsyncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function assertGuardedDirectory(directory: string): Promise<void> {
  try {
    const metadata = await lstat(directory);
    if (!metadata.isDirectory()
      || metadata.isSymbolicLink()
      || metadata.uid !== 0
      || metadata.gid !== 0
      || (metadata.mode & 0o022) !== 0
      || await realpath(directory) !== directory) {
      throw new RecoveryError("TARGETED_DIRECTORY_METADATA_INVALID", "FILE");
    }
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError("TARGETED_DIRECTORY_METADATA_INVALID", "FILE");
  }
}

async function readRootOnlyRegularFile(filePath: string): Promise<Buffer> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(filePath, fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile()
      || metadata.uid !== 0
      || metadata.gid !== 0
      || (metadata.mode & 0o777) !== 0o600
      || metadata.nlink !== 1
      || metadata.size < 2
      || metadata.size > 65536) {
      throw new RecoveryError("TARGETED_FILE_METADATA_INVALID", "FILE");
    }
    return await handle.readFile();
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError("TARGETED_FILE_METADATA_INVALID", "FILE");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function writeExclusiveRootJson(filePath: string, value: unknown): Promise<void> {
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.write-${process.pid}`);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let linked = false;
  try {
    if (await exists(filePath)) throw new RecoveryError("TARGETED_CANDIDATE_EXISTS", "CANDIDATE");
    await safeUnlink(temporary);
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.chmod(0o600);
    await handle.chown(0, 0);
    await handle.sync();
    await handle.close();
    handle = null;
    await link(temporary, filePath);
    linked = true;
    await safeUnlink(temporary);
    await fsyncDirectory(path.dirname(filePath));
    await readRootOnlyRegularFile(filePath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await safeUnlink(temporary).catch(() => undefined);
    if (linked) await safeUnlink(filePath).catch(() => undefined);
    await fsyncDirectory(path.dirname(filePath)).catch(() => undefined);
    if (error instanceof RecoveryError) throw error;
    const wrapped = new RecoveryError("TARGETED_CANDIDATE_WRITE_FAILED", "CANDIDATE");
    (wrapped as Error & { cause?: unknown }).cause = error;
    throw wrapped;
  }
}

function assertUatCanonical(value: unknown): asserts value is UatCredentialDocument {
  if (!isPlainObject(value) || typeof value.recovery_run_id !== "string" || !UUID_V4.test(value.recovery_run_id)) {
    throw new RecoveryError("TARGETED_CANONICAL_SCHEMA_INVALID", "CANONICAL_SCHEMA");
  }
  const diagnosis = diagnoseUatCredentialValue(value, value.recovery_run_id);
  if (!diagnosis.valid
    || diagnosis.schemaVersion !== UAT_CREDENTIAL_SCHEMA_VERSION
    || diagnosis.validatorVersion !== UAT_CREDENTIAL_VALIDATOR_VERSION
    || diagnosis.writerVersion !== UAT_CREDENTIAL_WRITER_VERSION
    || diagnosis.accountCount !== 10
    || diagnosis.errorCount !== 0) {
    throw new RecoveryError("TARGETED_CANONICAL_SCHEMA_INVALID", "CANONICAL_SCHEMA");
  }
}

function semanticDiff(left: unknown, right: unknown, pointer = ""): string[] {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return [pointer || "/"];
    return left.flatMap((value, index) => semanticDiff(value, right[index], `${pointer}/${index}`));
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) return [pointer || "/"];
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    return keys.flatMap((key) => semanticDiff(left[key], right[key], `${pointer}/${key}`));
  }
  return Object.is(left, right) ? [] : [pointer || "/"];
}

export function targetedConfirmationPhrase(input: {
  recoveryRunId: string;
  expectedUserVersion: number;
}): string {
  return `RECOVER EXACTLY ${TARGETED_ACCOUNT.username} AS ${TARGETED_ACCOUNT.role} ACTIVE true AT VERSION ${input.expectedUserVersion} WITH RUN ${input.recoveryRunId}`;
}

export function assertTargetedStaticGuards(input: {
  environment: string;
  deploymentClass: string;
  expectedMigration: string;
  recoveryRunId: string;
  targetUsername: string;
  expectedRole: string;
  expectedActive: boolean;
  expectedUserVersion: number;
  confirmationPhrase: string;
  effectiveUid: number;
}): asserts input is typeof input & { environment: TargetedEnvironment; effectiveUid: 0 } {
  if (!['parallel-uat', 'parallel-uat-rehearsal'].includes(input.environment)) {
    throw new RecoveryError("TARGETED_ENVIRONMENT_INVALID", "PRECHECK");
  }
  if (input.deploymentClass === "production") throw new RecoveryError("TARGETED_PRODUCTION_FORBIDDEN", "PRECHECK");
  if (input.environment === "parallel-uat" && input.deploymentClass !== "uat") {
    throw new RecoveryError("TARGETED_DEPLOYMENT_CLASS_INVALID", "PRECHECK");
  }
  if (input.environment === "parallel-uat-rehearsal" && input.deploymentClass !== "test") {
    throw new RecoveryError("TARGETED_DEPLOYMENT_CLASS_INVALID", "PRECHECK");
  }
  if (input.effectiveUid !== 0) throw new RecoveryError("TARGETED_ROOT_REQUIRED", "PRECHECK");
  if (input.expectedMigration !== TARGETED_EXPECTED_MIGRATION) {
    throw new RecoveryError("TARGETED_EXPECTED_MIGRATION_INVALID", "PRECHECK");
  }
  if (!UUID_V4.test(input.recoveryRunId)) throw new RecoveryError("TARGETED_RUN_ID_INVALID", "PRECHECK");
  if (input.targetUsername !== TARGETED_ACCOUNT.username
    || /[*?,\[\]{}]/.test(input.targetUsername)
    || input.targetUsername.includes(",")
    || /\s/.test(input.targetUsername)) {
    throw new RecoveryError("TARGETED_SINGLE_ACCOUNT_REQUIRED", "PRECHECK");
  }
  if (input.expectedRole !== TARGETED_ACCOUNT.role) throw new RecoveryError("TARGETED_ROLE_INVALID", "PRECHECK");
  if (input.expectedActive !== true) throw new RecoveryError("TARGETED_ACTIVE_STATE_INVALID", "PRECHECK");
  if (!Number.isSafeInteger(input.expectedUserVersion) || input.expectedUserVersion < 1) {
    throw new RecoveryError("TARGETED_VERSION_INVALID", "PRECHECK");
  }
  if (input.confirmationPhrase !== targetedConfirmationPhrase(input)) {
    throw new RecoveryError("TARGETED_CONFIRMATION_REQUIRED", "PRECHECK");
  }
}

export function assertTargetedOfflineState(
  webState: string,
  workerState: string,
  writerConnections: number,
  otherConnections: number,
): void {
  if (webState !== "exited" || workerState !== "exited"
    || writerConnections !== 0 || otherConnections !== 0) {
    throw new RecoveryError("TARGETED_WRITERS_STILL_ACTIVE", "OFFLINE");
  }
}

export function resolveTargetedPaths(options: Pick<TargetedRecoveryOptions, "environment" | "recoveryRunId" | "stageDirectory">): TargetedPaths {
  if (options.environment === "parallel-uat") {
    if (options.stageDirectory && options.stageDirectory !== FORMAL_DIRECTORY) {
      throw new RecoveryError("TARGETED_STAGE_DIRECTORY_INVALID", "PRECHECK");
    }
    return {
      directory: FORMAL_DIRECTORY,
      canonical: FORMAL_CANONICAL,
      candidate: path.join(FORMAL_DIRECTORY, `.uat-role-accounts.txt.targeted-${options.recoveryRunId}.candidate`),
    };
  }
  const expected = path.join(REHEARSAL_STAGE_ROOT, options.recoveryRunId);
  if (options.stageDirectory !== expected) throw new RecoveryError("TARGETED_STAGE_DIRECTORY_INVALID", "PRECHECK");
  return {
    directory: expected,
    canonical: path.join(expected, "uat-role-accounts.txt"),
    candidate: path.join(expected, `.uat-role-accounts.txt.targeted-${options.recoveryRunId}.candidate`),
  };
}

function parseDatabaseUrl(databaseUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new RecoveryError("TARGETED_DATABASE_URL_REJECTED", "PRECHECK");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "postgres"
    || !["", "5432"].includes(parsed.port)
    || !parsed.username
    || !parsed.password
    || parsed.search
    || parsed.hash) {
    throw new RecoveryError("TARGETED_DATABASE_URL_REJECTED", "PRECHECK");
  }
  return parsed;
}

async function assertOfflineAttestation(filePath: string | undefined, recoveryRunId: string): Promise<void> {
  const expectedPath = path.join(FORMAL_ATTESTATION_DIRECTORY, `targeted-offline-identity-recovery-${recoveryRunId}.json`);
  if (filePath !== expectedPath) throw new RecoveryError("TARGETED_OFFLINE_ATTESTATION_REQUIRED", "OFFLINE");
  try {
    const value = JSON.parse((await readRootOnlyRegularFile(expectedPath)).toString("utf8"));
    const expectedKeys = [
      "format_version", "recovery_run_id", "issued_at_epoch",
      "web_name", "web_state", "web_container_id", "web_image_id", "web_project", "web_service",
      "worker_name", "worker_state", "worker_container_id", "worker_image_id", "worker_project", "worker_service",
    ].sort();
    if (!isPlainObject(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)
      || value.format_version !== "chenyida-erp-targeted-offline-attestation-v1"
      || value.recovery_run_id !== recoveryRunId
      || value.web_name !== "chenyida-erp-parallel-web-1"
      || value.worker_name !== "chenyida-erp-parallel-worker-1"
      || value.web_project !== "chenyida-erp-parallel"
      || value.worker_project !== "chenyida-erp-parallel"
      || value.web_service !== "web"
      || value.worker_service !== "worker"
      || value.web_image_id !== TARGETED_FORMAL_WEB_IMAGE
      || value.worker_image_id !== TARGETED_FORMAL_WORKER_IMAGE
      || !/^[0-9a-f]{64}$/.test(String(value.web_container_id))
      || !/^[0-9a-f]{64}$/.test(String(value.worker_container_id))
      || !Number.isInteger(value.issued_at_epoch)
      || Math.abs(Math.floor(Date.now() / 1000) - Number(value.issued_at_epoch)) > 120) {
      throw new RecoveryError("TARGETED_OFFLINE_ATTESTATION_INVALID", "OFFLINE");
    }
    assertTargetedOfflineState(String(value.web_state), String(value.worker_state), 0, 0);
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError("TARGETED_OFFLINE_ATTESTATION_INVALID", "OFFLINE");
  }
}

type ObservedDatabaseState = {
  current_database: string;
  current_user: string;
  read_only: string;
  migration_count: number;
  migration_head: string;
  writer_connections: number;
  other_connections: number;
};

export function assertTargetedObservedDatabaseState(
  row: Omit<ObservedDatabaseState, "writer_connections" | "other_connections">,
  expectedDatabase: string,
  expectedReadOnly = "off",
): void {
  if (row.current_database !== expectedDatabase
    || row.current_user !== FORMAL_DATABASE_USER
    || row.read_only !== expectedReadOnly) {
    throw new RecoveryError("TARGETED_DATABASE_IDENTITY_REJECTED", "DATABASE");
  }
  if (Number(row.migration_count) !== 38 || row.migration_head !== TARGETED_EXPECTED_HEAD) {
    throw new RecoveryError("TARGETED_MIGRATION_MISMATCH", "DATABASE");
  }
}

async function observedDatabaseState(client: Pool | PoolClient): Promise<ObservedDatabaseState> {
  const result = await client.query<ObservedDatabaseState>(`
    select current_database(),current_user,current_setting('transaction_read_only') read_only,
      (select count(*)::int from schema_migrations) migration_count,
      (select version from schema_migrations order by version desc limit 1) migration_head,
      (select count(*)::int from pg_stat_activity
        where datname=current_database() and pid<>pg_backend_pid()
          and application_name in ('chenyida-erp-web','chenyida-erp-worker')) writer_connections,
      (select count(*)::int from pg_stat_activity
        where datname=current_database() and pid<>pg_backend_pid()
          and backend_type='client backend') other_connections
  `);
  const row = result.rows[0];
  if (!row) throw new RecoveryError("TARGETED_DATABASE_IDENTITY_REJECTED", "DATABASE");
  return row;
}

async function assertExpectedMigrations(client: Pool | PoolClient): Promise<void> {
  const result = await client.query<{ version: string; checksum: string }>(
    "select version,checksum from schema_migrations order by version",
  );
  if (result.rowCount !== TARGETED_EXPECTED_MIGRATIONS.length
    || result.rows.some((migration, index) => migration.version !== TARGETED_EXPECTED_MIGRATIONS[index][0]
      || migration.checksum !== TARGETED_EXPECTED_MIGRATIONS[index][1])) {
    throw new RecoveryError("TARGETED_MIGRATION_MISMATCH", "DATABASE");
  }
}

async function assertObservedPreflight(
  client: Pool | PoolClient,
  expectedDatabase: string,
  expectedReadOnly = "off",
): Promise<void> {
  const row = await observedDatabaseState(client);
  assertTargetedObservedDatabaseState(row, expectedDatabase, expectedReadOnly);
  await assertExpectedMigrations(client);
  assertTargetedOfflineState("exited", "exited", Number(row.writer_connections), Number(row.other_connections));
}

async function assertDatabasePreflight(options: TargetedRecoveryOptions, parsedUrl: URL): Promise<string> {
  const expectedDatabase = options.environment === "parallel-uat"
    ? FORMAL_DATABASE
    : String(options.expectedDatabaseName || "");
  const urlDatabase = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
  const urlUser = decodeURIComponent(parsedUrl.username);
  if (options.environment === "parallel-uat") {
    if (expectedDatabase !== FORMAL_DATABASE || urlDatabase !== FORMAL_DATABASE || urlUser !== FORMAL_DATABASE_USER) {
      throw new RecoveryError("TARGETED_DATABASE_IDENTITY_REJECTED", "DATABASE");
    }
    await assertOfflineAttestation(options.offlineAttestationPath, options.recoveryRunId);
  } else if (!REHEARSAL_DATABASE.test(expectedDatabase)
    || urlDatabase !== expectedDatabase
    || urlUser !== FORMAL_DATABASE_USER) {
    throw new RecoveryError("TARGETED_DATABASE_IDENTITY_REJECTED", "DATABASE");
  }
  const client = await options.pool.connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    await assertObservedPreflight(client, expectedDatabase, "on");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError("TARGETED_DATABASE_PREFLIGHT_FAILED", "DATABASE");
  } finally {
    client.release();
  }
  return expectedDatabase;
}

function targetedMarkerDigest(runId: string): string {
  return sha256(`${RECOVERY_ACTION}\n${runId}`);
}

function targetedRequestDigest(options: TargetedRecoveryOptions): string {
  return sha256(JSON.stringify({
    mode: TARGETED_RECOVERY_MODE,
    environment: options.environment,
    expected_migration: options.expectedMigration,
    username: options.targetUsername,
    role: options.expectedRole,
    active: options.expectedActive,
    expected_version: options.expectedUserVersion,
    must_change_password: false,
  }));
}

async function assertRunIdUnused(pool: Pool, runId: string): Promise<void> {
  const result = await pool.query<{ marker_count: number; audit_count: number }>(`
    select
      (select count(*)::int from idempotency_keys where key_digest=$1) marker_count,
      (select count(*)::int from audit_log where operation_id=$2::uuid) audit_count
  `, [targetedMarkerDigest(runId), runId]);
  if (Number(result.rows[0]?.marker_count) !== 0 || Number(result.rows[0]?.audit_count) !== 0) {
    throw new RecoveryError("TARGETED_RUN_REPLAYED", "PRECHECK");
  }
}

export async function prepareTargetedCanonicalCandidate(
  options: TargetedRecoveryOptions,
  password: string,
): Promise<CandidateEvidence> {
  const paths = resolveTargetedPaths(options);
  await assertGuardedDirectory(paths.directory);
  await options.hooks?.beforeCandidateWrite?.();
  validatePassword(password, TARGETED_ACCOUNT.username);
  let created = false;
  try {
    const canonicalPayload = await readRootOnlyRegularFile(paths.canonical);
    let canonical: unknown;
    try {
      canonical = JSON.parse(canonicalPayload.toString("utf8"));
    } catch {
      throw new RecoveryError("TARGETED_CANONICAL_SCHEMA_INVALID", "CANONICAL_SCHEMA");
    }
    assertUatCanonical(canonical);
    const targetIndexes = canonical.accounts
      .map((account, index) => account.username === TARGETED_ACCOUNT.username ? index : -1)
      .filter((index) => index >= 0);
    if (targetIndexes.length !== 1) throw new RecoveryError("TARGETED_CANONICAL_ACCOUNT_MISMATCH", "CANONICAL_SCHEMA");
    const targetIndex = targetIndexes[0];
    const target = canonical.accounts[targetIndex];
    if (target.role !== TARGETED_ACCOUNT.role || target.must_change_password !== true) {
      throw new RecoveryError("TARGETED_CANONICAL_ACCOUNT_MISMATCH", "CANONICAL_SCHEMA");
    }
    if (canonical.accounts.some((account) => account.password === password)) {
      throw new RecoveryError("TARGETED_PASSWORD_NOT_NEW", "CANDIDATE");
    }
    const candidate = structuredClone(canonical);
    candidate.accounts[targetIndex].password = password;
    candidate.accounts[targetIndex].must_change_password = false;
    const allowedDiffs = new Set([
      `/accounts/${targetIndex}/password`,
      `/accounts/${targetIndex}/must_change_password`,
    ]);
    const diffs = semanticDiff(canonical, candidate);
    if (diffs.length !== 2 || diffs.some((diff) => !allowedDiffs.has(diff))) {
      throw new RecoveryError("TARGETED_CANONICAL_DIFF_INVALID", "CANDIDATE");
    }
    assertUatCanonical(candidate);
    await writeExclusiveRootJson(paths.candidate, candidate);
    created = true;
    const persistedPayload = await readRootOnlyRegularFile(paths.candidate);
    const persisted = JSON.parse(persistedPayload.toString("utf8"));
    assertUatCanonical(persisted);
    const persistedDiffs = semanticDiff(canonical, persisted);
    if (persistedDiffs.length !== 2 || persistedDiffs.some((diff) => !allowedDiffs.has(diff))) {
      throw new RecoveryError("TARGETED_CANONICAL_DIFF_INVALID", "CANDIDATE");
    }
    await options.hooks?.afterCandidateWrite?.();
    return {
      paths,
      canonicalBeforeDigest: sha256(canonicalPayload),
      candidateDigest: sha256(persistedPayload),
      canonicalRunId: canonical.recovery_run_id,
      targetIndex,
    };
  } catch (error) {
    if (created) await safeUnlink(paths.candidate).catch(() => undefined);
    await fsyncDirectory(paths.directory).catch(() => undefined);
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError("TARGETED_CANDIDATE_PREPARATION_FAILED", "CANDIDATE");
  }
}

async function readTargetedCandidate(evidence: CandidateEvidence): Promise<{ document: UatCredentialDocument; password: string }> {
  const payload = await readRootOnlyRegularFile(evidence.paths.candidate);
  if (sha256(payload) !== evidence.candidateDigest) throw new RecoveryError("TARGETED_CANDIDATE_CHANGED", "CANDIDATE");
  const document = JSON.parse(payload.toString("utf8"));
  assertUatCanonical(document);
  const account = document.accounts[evidence.targetIndex];
  if (!account
    || account.username !== TARGETED_ACCOUNT.username
    || account.role !== TARGETED_ACCOUNT.role
    || account.must_change_password !== false) {
    throw new RecoveryError("TARGETED_CANDIDATE_ACCOUNT_MISMATCH", "CANDIDATE");
  }
  validatePassword(account.password, account.username);
  return { document, password: account.password };
}

function userState(row: TargetedUserState): TargetedUserState {
  return {
    username: row.username,
    role: row.role,
    is_active: Boolean(row.is_active),
    must_change_password: Boolean(row.must_change_password),
    version: Number(row.version),
  };
}

async function identitySnapshot(client: PoolClient): Promise<IdentitySnapshot> {
  const controlledOthers = new Set<string>(RECOVERY_ACCOUNTS
    .filter((account) => account.username !== TARGETED_ACCOUNT.username)
    .map((account) => account.username));
  const nonSecret = await client.query(`
    select username,display_name,role,is_active,must_change_password,version,
      created_at::text,updated_at::text,last_login_at::text
    from app_users where username<>$1 order by username
  `, [TARGETED_ACCOUNT.username]);
  const secret = await client.query(`
    select username,password_hash from app_users where username<>$1 order by username
  `, [TARGETED_ACCOUNT.username]);
  const controlledNonSecret = nonSecret.rows.filter((row) => controlledOthers.has(String(row.username)));
  const controlledSecret = secret.rows.filter((row) => controlledOthers.has(String(row.username)));
  const sessions = await client.query(`
    select to_jsonb(s)::text payload from app_sessions s
    where username<>$1 order by username,token_hash
  `, [TARGETED_ACCOUNT.username]);
  if (controlledNonSecret.length !== 10 || controlledSecret.length !== 10) {
    throw new RecoveryError("TARGETED_CONTROLLED_ACCOUNT_COUNT_MISMATCH", "TRANSACTION");
  }
  return {
    controlledOtherCount: controlledNonSecret.length,
    allOtherCount: nonSecret.rowCount || 0,
    controlledOtherNonSecretDigest: sha256(JSON.stringify(controlledNonSecret)),
    controlledOtherSecretDigest: sha256(JSON.stringify(controlledSecret)),
    allOtherNonSecretDigest: sha256(JSON.stringify(nonSecret.rows)),
    allOtherSecretDigest: sha256(JSON.stringify(secret.rows)),
    otherSessionsDigest: sha256(JSON.stringify(sessions.rows)),
  };
}

function identitySnapshotsMatch(before: IdentitySnapshot, after: IdentitySnapshot): boolean {
  return before.controlledOtherCount === after.controlledOtherCount
    && before.allOtherCount === after.allOtherCount
    && before.controlledOtherNonSecretDigest === after.controlledOtherNonSecretDigest
    && before.controlledOtherSecretDigest === after.controlledOtherSecretDigest
    && before.allOtherNonSecretDigest === after.allOtherNonSecretDigest
    && before.allOtherSecretDigest === after.allOtherSecretDigest;
}

async function performTargetedTransaction(
  options: TargetedRecoveryOptions,
  expectedDatabase: string,
  candidate: CandidateEvidence,
  password: string,
  businessFingerprintBefore: string,
): Promise<TransactionEvidence> {
  const client = await options.pool.connect();
  let commitAttempted = false;
  let commitAcknowledged = false;
  try {
    await client.query("begin isolation level serializable");
    const recoveryLock = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_xact_lock(hashtextextended($1,0)) locked",
      [`${RECOVERY_ACTION}:GLOBAL`],
    );
    const migrationLock = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_xact_lock(hashtext('chenyida_erp_schema_migration')) locked",
    );
    if (recoveryLock.rows[0]?.locked !== true || migrationLock.rows[0]?.locked !== true) {
      throw new RecoveryError("TARGETED_CONCURRENT_OPERATION", "TRANSACTION");
    }
    if (options.environment === "parallel-uat") {
      await assertOfflineAttestation(options.offlineAttestationPath, options.recoveryRunId);
    }
    await assertObservedPreflight(client, expectedDatabase);
    const lockedUsers = await client.query("select username from app_users order by username for update");
    if ((lockedUsers.rowCount || 0) < RECOVERY_ACCOUNTS.length) {
      throw new RecoveryError("TARGETED_ACCOUNT_COUNT_MISMATCH", "TRANSACTION");
    }
    const controlled = await client.query<TargetedUserState>(`
      select username,role,is_active,must_change_password,version
      from app_users where username=any($1::text[]) order by username
    `, [RECOVERY_ACCOUNTS.map((account) => account.username)]);
    if (controlled.rowCount !== RECOVERY_ACCOUNTS.length) {
      throw new RecoveryError("TARGETED_CONTROLLED_ACCOUNT_COUNT_MISMATCH", "TRANSACTION");
    }
    for (const expected of RECOVERY_ACCOUNTS) {
      const actual = controlled.rows.find((row) => row.username === expected.username);
      if (!actual || actual.role !== expected.role || actual.is_active !== true) {
        throw new RecoveryError("TARGETED_ACCOUNT_INVARIANT_MISMATCH", "TRANSACTION");
      }
    }
    const targetRaw = controlled.rows.find((row) => row.username === TARGETED_ACCOUNT.username);
    if (!targetRaw) throw new RecoveryError("TARGETED_ACCOUNT_COUNT_MISMATCH", "TRANSACTION");
    const targetBefore = userState(targetRaw);
    if (targetBefore.role !== options.expectedRole
      || targetBefore.is_active !== options.expectedActive
      || targetBefore.must_change_password !== true
      || targetBefore.version !== options.expectedUserVersion) {
      throw new RecoveryError("TARGETED_ACCOUNT_INVARIANT_MISMATCH", "TRANSACTION");
    }
    const identityBefore = await identitySnapshot(client);
    const markerDigest = targetedMarkerDigest(options.recoveryRunId);
    const marker = await client.query(`
      insert into idempotency_keys(
        key_digest,username,method,path,request_digest,status_code,response,expires_at,created_at
      ) values($1,$2,'OFFLINE',$3,$4,200,$5,'infinity',transaction_timestamp())
      on conflict(key_digest) do nothing returning key_digest
    `, [
      markerDigest,
      RECOVERY_ACTOR,
      `identity-recovery-targeted:${options.environment}:${TARGETED_ACCOUNT.username}`,
      targetedRequestDigest(options),
      {
        status: "COMMITTED",
        mode: TARGETED_RECOVERY_MODE,
        recovery_run_id: options.recoveryRunId,
        environment: options.environment,
        username: TARGETED_ACCOUNT.username,
        expected_version: options.expectedUserVersion,
        account_count: 1,
        business_fingerprint_before: businessFingerprintBefore,
        canonical_before_digest: candidate.canonicalBeforeDigest,
        candidate_digest: candidate.candidateDigest,
      },
    ]);
    if (marker.rowCount !== 1) throw new RecoveryError("TARGETED_RUN_REPLAYED", "TRANSACTION");

    validatePassword(password, TARGETED_ACCOUNT.username);
    const newHash = await hashPassword(password);
    const updated = await client.query<TargetedUserState & { password_hash: string }>(`
      update app_users set password_hash=$2,must_change_password=false,
        version=version+1,updated_at=transaction_timestamp()
      where username=$1 and role=$3 and is_active=$4 and must_change_password=true and version=$5
      returning username,role,is_active,must_change_password,version,password_hash
    `, [
      TARGETED_ACCOUNT.username,
      newHash,
      options.expectedRole,
      options.expectedActive,
      options.expectedUserVersion,
    ]);
    const changed = updated.rows[0];
    if (updated.rowCount !== 1 || !changed) throw new RecoveryError("TARGETED_USER_UPDATE_FAILED", "TRANSACTION");
    const targetAfter = userState(changed);
    if (targetAfter.username !== TARGETED_ACCOUNT.username
      || targetAfter.role !== options.expectedRole
      || targetAfter.is_active !== true
      || targetAfter.must_change_password !== false
      || targetAfter.version !== options.expectedUserVersion + 1
      || !await verifyPassword(password, changed.password_hash)) {
      throw new RecoveryError("TARGETED_USER_UPDATE_FAILED", "TRANSACTION");
    }
    const repository = new PostgresIdentityRepository(options.pool);
    const sessionRevokedCount = await repository.revokeUserSessions(client, TARGETED_ACCOUNT.username, "PASSWORD_RESET");
    await repository.recordAudit(client, {
      actor: RECOVERY_ACTOR,
      action: RECOVERY_ACTION,
      targetUsername: TARGETED_ACCOUNT.username,
      result: "success",
      requestId: options.recoveryRunId,
      operationId: options.recoveryRunId,
      idempotencyKeyDigest: markerDigest,
      oldVersion: targetBefore.version,
      newVersion: targetAfter.version,
      safeDetails: {
        actor_type: "SYSTEM_RECOVERY_CLI",
        execution_mode: "OFFLINE_TARGETED_FINALIZATION",
        environment: options.environment,
        recovery_run_id: options.recoveryRunId,
        recovery_mode: TARGETED_RECOVERY_MODE,
        reason_code: RECOVERY_REASON_CODE,
        reason: RECOVERY_REASON,
        validator_version: UAT_CREDENTIAL_VALIDATOR_VERSION,
        writer_version: UAT_CREDENTIAL_WRITER_VERSION,
        session_revoked_count: sessionRevokedCount,
      },
    });
    await options.hooks?.afterTargetUpdate?.();

    const remaining = await client.query<{ count: number }>(`
      select count(*)::int count from app_sessions
      where username=$1 and revoked_at is null
    `, [TARGETED_ACCOUNT.username]);
    const audit = await client.query<{ count: number }>(`
      select count(*)::int count from audit_log
      where action=$1 and operation_id=$2::uuid and request_id=$2::uuid
        and target_username=$3 and result='success'
    `, [RECOVERY_ACTION, options.recoveryRunId, TARGETED_ACCOUNT.username]);
    if (Number(remaining.rows[0]?.count) !== 0 || Number(audit.rows[0]?.count) !== 1) {
      throw new RecoveryError("TARGETED_TRANSACTION_EVIDENCE_MISMATCH", "TRANSACTION");
    }
    const identityAfter = await identitySnapshot(client);
    if (!identitySnapshotsMatch(identityBefore, identityAfter)
      || identityBefore.otherSessionsDigest !== identityAfter.otherSessionsDigest) {
      throw new RecoveryError("TARGETED_NON_TARGET_CHANGED", "TRANSACTION");
    }
    if (options.environment === "parallel-uat") {
      await assertOfflineAttestation(options.offlineAttestationPath, options.recoveryRunId);
    }
    await assertObservedPreflight(client, expectedDatabase);
    await options.hooks?.beforeCommit?.();
    commitAttempted = true;
    await client.query("commit");
    commitAcknowledged = true;
    await options.hooks?.afterCommitAcknowledged?.();
    return {
      targetBefore,
      targetAfter,
      sessionRevokedCount,
      identityBefore,
      identityAfter,
    };
  } catch (error) {
    if (!commitAcknowledged) await client.query("rollback").catch(() => undefined);
    if (commitAttempted) throw new RecoveryError("TARGETED_COMMIT_OUTCOME_UNKNOWN", "TRANSACTION");
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError("TARGETED_TRANSACTION_FAILED", "TRANSACTION");
  } finally {
    client.release(commitAttempted && !commitAcknowledged);
  }
}

async function verifyCommitOutcome(
  options: TargetedRecoveryOptions,
  candidatePassword?: string,
  requireNoActiveSessions = true,
): Promise<{ state: "committed"; evidence: CommitEvidence; target: TargetedUserState } | { state: "not_committed" } | { state: "unknown" }> {
  try {
    const result = await options.pool.query<{
      marker_count: number;
      operation_audit_count: number;
      audit_count: number;
      session_revoked_count: number;
      active_session_count: number;
      target_count: number;
      username: string | null;
      role: string | null;
      is_active: boolean | null;
      must_change_password: boolean | null;
      version: number | null;
      password_hash: string | null;
      business_fingerprint_before: string | null;
      canonical_before_digest: string | null;
      candidate_digest: string | null;
    }>(`
      select
        (select count(*)::int from idempotency_keys
          where key_digest=$1 and username=$2 and method='OFFLINE'
            and path=$3 and request_digest=$4 and status_code=200
            and response->>'status'='COMMITTED'
            and response->>'mode'=$5
            and response->>'recovery_run_id'=$6::text
            and response->>'environment'=$7
            and response->>'username'=$8
            and (response->>'expected_version')::int=$9
            and (response->>'account_count')::int=1
            and expires_at='infinity') marker_count,
        (select count(*)::int from audit_log where operation_id=$6::uuid) operation_audit_count,
        (select count(*)::int from audit_log
          where username=$2 and action=$10 and operation_id=$6::uuid and request_id=$6::uuid
            and target_username=$8 and result='success' and route_code='IDENTITY'
            and idempotency_key_digest=$1 and old_version=$9 and new_version=$9+1
            and error_code is null
            and detail->>'recovery_run_id'=$6::text
            and detail->>'recovery_mode'=$5
            and detail->>'execution_mode'='OFFLINE_TARGETED_FINALIZATION') audit_count,
        (select coalesce(sum((detail->>'session_revoked_count')::int),0)::int from audit_log
          where action=$10 and operation_id=$6::uuid and target_username=$8 and result='success') session_revoked_count,
        (select count(*)::int from app_sessions where username=$8 and revoked_at is null) active_session_count,
        (select count(*)::int from app_users where username=$8) target_count,
        (select username from app_users where username=$8) username,
        (select role from app_users where username=$8) role,
        (select is_active from app_users where username=$8) is_active,
        (select must_change_password from app_users where username=$8) must_change_password,
        (select version from app_users where username=$8) version,
        (select password_hash from app_users where username=$8) password_hash,
        (select response->>'business_fingerprint_before' from idempotency_keys where key_digest=$1) business_fingerprint_before,
        (select response->>'canonical_before_digest' from idempotency_keys where key_digest=$1) canonical_before_digest,
        (select response->>'candidate_digest' from idempotency_keys where key_digest=$1) candidate_digest
    `, [
      targetedMarkerDigest(options.recoveryRunId),
      RECOVERY_ACTOR,
      `identity-recovery-targeted:${options.environment}:${TARGETED_ACCOUNT.username}`,
      targetedRequestDigest(options),
      TARGETED_RECOVERY_MODE,
      options.recoveryRunId,
      options.environment,
      TARGETED_ACCOUNT.username,
      options.expectedUserVersion,
      RECOVERY_ACTION,
    ]);
    const row = result.rows[0];
    if (!row) return { state: "unknown" };
    if (Number(row.marker_count) === 0 && Number(row.operation_audit_count) === 0) return { state: "not_committed" };
    const target = userState({
      username: String(row.username || ""),
      role: String(row.role || ""),
      is_active: Boolean(row.is_active),
      must_change_password: Boolean(row.must_change_password),
      version: Number(row.version),
    });
    if (Number(row.marker_count) !== 1
      || Number(row.operation_audit_count) !== 1
      || Number(row.audit_count) !== 1
      || requireNoActiveSessions && Number(row.active_session_count) !== 0
      || Number(row.target_count) !== 1
      || target.username !== TARGETED_ACCOUNT.username
      || target.role !== TARGETED_ACCOUNT.role
      || target.is_active !== true
      || target.must_change_password !== false
      || target.version !== options.expectedUserVersion + 1
      || !/^[0-9a-f]{64}$/.test(String(row.business_fingerprint_before || ""))
      || !/^[0-9a-f]{64}$/.test(String(row.canonical_before_digest || ""))
      || !/^[0-9a-f]{64}$/.test(String(row.candidate_digest || ""))) {
      return { state: "unknown" };
    }
    if (candidatePassword) {
      if (!row.password_hash || !await verifyPassword(candidatePassword, row.password_hash)) return { state: "unknown" };
    }
    return {
      state: "committed",
      target,
      evidence: {
        sessionRevokedCount: Number(row.session_revoked_count),
        businessFingerprintBefore: String(row.business_fingerprint_before),
        canonicalBeforeDigest: String(row.canonical_before_digest),
        candidateDigest: String(row.candidate_digest),
      },
    };
  } catch {
    return { state: "unknown" };
  }
}

async function assertCandidateMatchesDatabase(
  options: TargetedRecoveryOptions,
  candidate: CandidateEvidence,
): Promise<void> {
  const { password } = await readTargetedCandidate(candidate);
  const outcome = await verifyCommitOutcome(options, password);
  if (outcome.state !== "committed"
    || outcome.evidence.canonicalBeforeDigest !== candidate.canonicalBeforeDigest
    || outcome.evidence.candidateDigest !== candidate.candidateDigest) {
    throw new RecoveryError("TARGETED_CANDIDATE_DATABASE_MISMATCH", "VERIFICATION");
  }
}

async function installTargetedCandidate(
  options: TargetedRecoveryOptions,
  candidate: CandidateEvidence,
): Promise<void> {
  await assertGuardedDirectory(candidate.paths.directory);
  const candidatePayload = await readRootOnlyRegularFile(candidate.paths.candidate);
  if (sha256(candidatePayload) !== candidate.candidateDigest) {
    throw new RecoveryError("TARGETED_CANDIDATE_CHANGED", "PROMOTION");
  }
  const canonicalPayload = await readRootOnlyRegularFile(candidate.paths.canonical);
  if (sha256(canonicalPayload) === candidate.candidateDigest) {
    await safeUnlink(candidate.paths.candidate);
    await fsyncDirectory(candidate.paths.directory);
    return;
  }
  if (sha256(canonicalPayload) !== candidate.canonicalBeforeDigest) {
    throw new RecoveryError("TARGETED_CANONICAL_CHANGED", "PROMOTION");
  }
  await options.hooks?.beforePromotion?.();
  const temporary = path.join(candidate.paths.directory, `.${path.basename(candidate.paths.canonical)}.install-${process.pid}`);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    await safeUnlink(temporary);
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(candidatePayload);
    await handle.chmod(0o600);
    await handle.chown(0, 0);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, candidate.paths.canonical);
    await chmod(candidate.paths.canonical, 0o600);
    await chown(candidate.paths.canonical, 0, 0);
    const installed = await open(candidate.paths.canonical, fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW);
    try {
      await installed.sync();
    } finally {
      await installed.close();
    }
    await fsyncDirectory(candidate.paths.directory);
    const verified = await readRootOnlyRegularFile(candidate.paths.canonical);
    if (!verified.equals(candidatePayload)) throw new RecoveryError("TARGETED_PROMOTION_VERIFY_FAILED", "PROMOTION");
    await safeUnlink(candidate.paths.candidate);
    await fsyncDirectory(candidate.paths.directory);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await safeUnlink(temporary).catch(() => undefined);
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError("TARGETED_CANONICAL_PROMOTION_FAILED", "PROMOTION");
  }
}

export async function validateTargetedCanonical(paths: TargetedPaths): Promise<void> {
  const payload = await readRootOnlyRegularFile(paths.canonical);
  const document = JSON.parse(payload.toString("utf8"));
  assertUatCanonical(document);
  const targets = document.accounts.filter((account) => account.username === TARGETED_ACCOUNT.username);
  if (targets.length !== 1 || targets[0].role !== TARGETED_ACCOUNT.role || targets[0].must_change_password !== false) {
    throw new RecoveryError("TARGETED_CANONICAL_ACCOUNT_MISMATCH", "CANONICAL_SCHEMA");
  }
  if (await exists(paths.candidate)) throw new RecoveryError("TARGETED_CANDIDATE_NOT_REMOVED", "PROMOTION");
}

function resultFrom(
  options: TargetedRecoveryOptions,
  candidate: CandidateEvidence,
  transaction: TransactionEvidence,
  before: string,
  after: string,
  status: TargetedRecoveryResult["status"],
  partial?: Pick<TargetedRecoveryResult, "partialPhase" | "code">,
): TargetedRecoveryResult {
  return {
    status,
    ...partial,
    recoveryRunId: options.recoveryRunId,
    accountCount: 1,
    canonicalAccountCount: 10,
    canonicalErrorCount: 0,
    canonicalDiffCount: 2,
    sessionRevokedCount: transaction.sessionRevokedCount,
    auditCount: 1,
    otherControlledAccountCount: transaction.identityBefore.controlledOtherCount,
    otherAccountCount: transaction.identityBefore.allOtherCount,
    otherAccountsUnchanged: identitySnapshotsMatch(transaction.identityBefore, transaction.identityAfter),
    otherSessionsUnchanged: transaction.identityBefore.otherSessionsDigest === transaction.identityAfter.otherSessionsDigest,
    businessFingerprintBefore: before,
    businessFingerprintAfter: after,
    targetBefore: transaction.targetBefore,
    targetAfter: transaction.targetAfter,
    paths: candidate.paths,
  };
}

export async function executeTargetedRecovery(options: TargetedRecoveryOptions): Promise<TargetedRecoveryResult> {
  assertTargetedStaticGuards(options);
  if (typeof options.password !== "string") throw new RecoveryError("TARGETED_PASSWORD_PIPE_REQUIRED", "PRECHECK");
  validatePassword(options.password, TARGETED_ACCOUNT.username);
  const parsedUrl = parseDatabaseUrl(options.databaseUrl);
  const expectedDatabase = await assertDatabasePreflight(options, parsedUrl);
  await assertRunIdUnused(options.pool, options.recoveryRunId);
  const candidate = await prepareTargetedCanonicalCandidate(options, options.password);
  let transaction: TransactionEvidence | null = null;
  let businessBefore = "";
  try {
    businessBefore = (await businessFingerprint(options.pool)).fingerprint;
    const candidateDocument = await readTargetedCandidate(candidate);
    try {
      transaction = await performTargetedTransaction(
        options,
        expectedDatabase,
        candidate,
        candidateDocument.password,
        businessBefore,
      );
    } catch (error) {
      if (!(error instanceof RecoveryError) || error.code !== "TARGETED_COMMIT_OUTCOME_UNKNOWN") throw error;
      const outcome = await verifyCommitOutcome(options, candidateDocument.password);
      if (outcome.state === "not_committed") throw new RecoveryError("TARGETED_TRANSACTION_FAILED", "TRANSACTION");
      if (outcome.state === "unknown") {
        return {
          status: "partial",
          partialPhase: "TRANSACTION_OUTCOME",
          code: "TARGETED_COMMIT_OUTCOME_UNKNOWN",
          recoveryRunId: options.recoveryRunId,
          accountCount: 1,
          canonicalAccountCount: 10,
          canonicalErrorCount: 0,
          canonicalDiffCount: 2,
          sessionRevokedCount: 0,
          auditCount: 1,
          otherControlledAccountCount: 10,
          otherAccountCount: 0,
          otherAccountsUnchanged: false,
          otherSessionsUnchanged: false,
          businessFingerprintBefore: businessBefore,
          businessFingerprintAfter: "",
          targetBefore: {
            username: TARGETED_ACCOUNT.username,
            role: TARGETED_ACCOUNT.role,
            is_active: true,
            must_change_password: true,
            version: options.expectedUserVersion,
          },
          targetAfter: {
            username: TARGETED_ACCOUNT.username,
            role: TARGETED_ACCOUNT.role,
            is_active: true,
            must_change_password: false,
            version: options.expectedUserVersion + 1,
          },
          paths: candidate.paths,
        };
      }
      const businessAfter = (await businessFingerprint(options.pool)).fingerprint;
      return {
        status: "partial",
        partialPhase: "TRANSACTION_OUTCOME",
        code: "TARGETED_COMMIT_ACKNOWLEDGEMENT_LOST",
        recoveryRunId: options.recoveryRunId,
        accountCount: 1,
        canonicalAccountCount: 10,
        canonicalErrorCount: 0,
        canonicalDiffCount: 2,
        sessionRevokedCount: outcome.evidence.sessionRevokedCount,
        auditCount: 1,
        otherControlledAccountCount: 10,
        otherAccountCount: 0,
        otherAccountsUnchanged: false,
        otherSessionsUnchanged: false,
        businessFingerprintBefore: businessBefore,
        businessFingerprintAfter: businessAfter,
        targetBefore: {
          username: TARGETED_ACCOUNT.username,
          role: TARGETED_ACCOUNT.role,
          is_active: true,
          must_change_password: true,
          version: options.expectedUserVersion,
        },
        targetAfter: outcome.target,
        paths: candidate.paths,
      };
    }
    const committed = await verifyCommitOutcome(options, candidateDocument.password);
    if (committed.state !== "committed") throw new RecoveryError("TARGETED_COMMIT_EVIDENCE_INCOMPLETE", "VERIFICATION");
    await assertCandidateMatchesDatabase(options, candidate);
    const businessAfter = (await businessFingerprint(options.pool)).fingerprint;
    if (businessBefore !== businessAfter) {
      return resultFrom(options, candidate, transaction, businessBefore, businessAfter, "partial", {
        partialPhase: "BUSINESS_PROTECTION",
        code: "TARGETED_BUSINESS_FINGERPRINT_CHANGED",
      });
    }
    if (options.promote) {
      try {
        if (options.environment === "parallel-uat") {
          await assertOfflineAttestation(options.offlineAttestationPath, options.recoveryRunId);
        }
        await assertDatabasePreflight(options, parsedUrl);
        await installTargetedCandidate(options, candidate);
        await validateTargetedCanonical(candidate.paths);
      } catch (error) {
        return resultFrom(options, candidate, transaction, businessBefore, businessAfter, "partial", {
          partialPhase: "PROMOTION",
          code: error instanceof RecoveryError ? error.code : "TARGETED_CANONICAL_PROMOTION_FAILED",
        });
      }
    }
    return resultFrom(options, candidate, transaction, businessBefore, businessAfter, "canonical_active");
  } catch (error) {
    if (!transaction) {
      const outcome = await verifyCommitOutcome(options).catch(() => ({ state: "unknown" as const }));
      if (outcome.state === "not_committed") {
        await safeUnlink(candidate.paths.candidate).catch(() => undefined);
        await fsyncDirectory(candidate.paths.directory).catch(() => undefined);
      }
    }
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError("TARGETED_RECOVERY_FAILED", "INTERNAL");
  }
}

export async function executeTargetedRetainedCandidatePromotion(
  options: TargetedRecoveryOptions,
): Promise<TargetedRecoveryResult> {
  assertTargetedStaticGuards(options);
  if (options.password !== undefined) throw new RecoveryError("TARGETED_PASSWORD_NOT_ALLOWED", "PRECHECK");
  const parsedUrl = parseDatabaseUrl(options.databaseUrl);
  await assertDatabasePreflight(options, parsedUrl);
  const paths = resolveTargetedPaths(options);
  await assertGuardedDirectory(paths.directory);
  const canonicalPayload = await readRootOnlyRegularFile(paths.canonical);
  const candidatePayload = await readRootOnlyRegularFile(paths.candidate);
  const candidateDocument = JSON.parse(candidatePayload.toString("utf8"));
  assertUatCanonical(candidateDocument);
  const targetIndex = candidateDocument.accounts.findIndex((account) => account.username === TARGETED_ACCOUNT.username);
  if (targetIndex < 0 || candidateDocument.accounts[targetIndex].must_change_password !== false) {
    throw new RecoveryError("TARGETED_CANDIDATE_ACCOUNT_MISMATCH", "CANDIDATE");
  }
  const outcome = await verifyCommitOutcome(options, candidateDocument.accounts[targetIndex].password);
  if (outcome.state !== "committed") throw new RecoveryError("TARGETED_COMMITTED_EVIDENCE_REQUIRED", "VERIFICATION");
  const candidate: CandidateEvidence = {
    paths,
    canonicalBeforeDigest: outcome.evidence.canonicalBeforeDigest,
    candidateDigest: outcome.evidence.candidateDigest,
    canonicalRunId: candidateDocument.recovery_run_id,
    targetIndex,
  };
  if (sha256(candidatePayload) !== candidate.candidateDigest
    || ![candidate.canonicalBeforeDigest, candidate.candidateDigest].includes(sha256(canonicalPayload))) {
    throw new RecoveryError("TARGETED_CANDIDATE_DATABASE_MISMATCH", "VERIFICATION");
  }
  const businessAfter = (await businessFingerprint(options.pool)).fingerprint;
  if (businessAfter !== outcome.evidence.businessFingerprintBefore) {
    throw new RecoveryError("TARGETED_BUSINESS_FINGERPRINT_CHANGED", "BUSINESS_PROTECTION");
  }
  await assertCandidateMatchesDatabase(options, candidate);
  await installTargetedCandidate(options, candidate);
  await validateTargetedCanonical(paths);
  const targetBefore: TargetedUserState = {
    username: TARGETED_ACCOUNT.username,
    role: TARGETED_ACCOUNT.role,
    is_active: true,
    must_change_password: true,
    version: options.expectedUserVersion,
  };
  const identity: IdentitySnapshot = {
    controlledOtherCount: 10,
    allOtherCount: 0,
    controlledOtherNonSecretDigest: "",
    controlledOtherSecretDigest: "",
    allOtherNonSecretDigest: "",
    allOtherSecretDigest: "",
    otherSessionsDigest: "",
  };
  return resultFrom(options, candidate, {
    targetBefore,
    targetAfter: outcome.target,
    sessionRevokedCount: outcome.evidence.sessionRevokedCount,
    identityBefore: identity,
    identityAfter: identity,
  }, outcome.evidence.businessFingerprintBefore, businessAfter, "canonical_active");
}

function cleanupMarkerDigest(runId: string, attempt: 1 | 2): string {
  return sha256(`${RECOVERY_SESSION_CLEANUP_ACTION}\n${runId}\n${TARGETED_ACCOUNT.username}\n${attempt}`);
}

async function targetedCleanupOutcome(
  options: TargetedRecoveryOptions,
  attempt: 1 | 2,
  client: Pool | PoolClient = options.pool,
): Promise<{ state: "committed"; sessionRevokedCount: number } | { state: "not_committed" } | { state: "unknown" }> {
  try {
    const markerDigest = cleanupMarkerDigest(options.recoveryRunId, attempt);
    const result = await client.query<{
      marker_count: number;
      audit_count: number;
      session_revoked_count: number;
      remaining_session_count: number;
    }>(`
      with marker as (
        select response->>'operation_id' operation_id
        from idempotency_keys
        where key_digest=$1 and username=$2 and method='OFFLINE'
          and path=$3 and request_digest=$4 and status_code=200
          and response->>'status'='COMMITTED'
          and response->>'recovery_run_id'=$5::text
          and response->>'environment'=$6
          and response->>'username'=$7
          and (response->>'verification_attempt')::int=$8
          and expires_at='infinity'
      )
      select
        (select count(*)::int from marker) marker_count,
        (select count(*)::int from audit_log a join marker m on a.operation_id=m.operation_id::uuid
          where a.username=$2 and a.action=$9 and a.result='success'
            and a.request_id=$5::uuid and a.route_code='IDENTITY'
            and a.idempotency_key_digest=$1 and a.target_username=$7
            and a.old_version is null and a.new_version is null and a.error_code is null
            and a.detail->>'execution_mode'='OFFLINE_TARGETED_BROWSER_CLEANUP'
            and a.detail->>'recovery_run_id'=$5::text
            and (a.detail->>'verification_attempt')::int=$8) audit_count,
        (select coalesce(sum((a.detail->>'session_revoked_count')::int),0)::int
          from audit_log a join marker m on a.operation_id=m.operation_id::uuid
          where a.action=$9 and a.target_username=$7 and a.result='success') session_revoked_count,
        (select count(*)::int from app_sessions where username=$7 and revoked_at is null) remaining_session_count
    `, [
      markerDigest,
      RECOVERY_ACTOR,
      `identity-recovery-targeted-browser-cleanup:${options.environment}:${TARGETED_ACCOUNT.username}:${attempt}`,
      sha256(JSON.stringify({
        recovery_run_id: options.recoveryRunId,
        username: TARGETED_ACCOUNT.username,
        verification_attempt: attempt,
      })),
      options.recoveryRunId,
      options.environment,
      TARGETED_ACCOUNT.username,
      attempt,
      RECOVERY_SESSION_CLEANUP_ACTION,
    ]);
    const row = result.rows[0];
    if (!row) return { state: "unknown" };
    if (Number(row.marker_count) === 0 && Number(row.audit_count) === 0) return { state: "not_committed" };
    if (Number(row.marker_count) === 1
      && Number(row.audit_count) === 1
      && Number(row.remaining_session_count) === 0) {
      return { state: "committed", sessionRevokedCount: Number(row.session_revoked_count) };
    }
    return { state: "unknown" };
  } catch {
    return { state: "unknown" };
  }
}

export async function executeTargetedVerificationSessionCleanup(
  options: TargetedRecoveryOptions,
  verificationAttempt: number,
): Promise<TargetedSessionCleanupResult> {
  assertTargetedStaticGuards(options);
  if (options.password !== undefined) throw new RecoveryError("TARGETED_PASSWORD_NOT_ALLOWED", "PRECHECK");
  if (verificationAttempt !== 1 && verificationAttempt !== 2) {
    throw new RecoveryError("TARGETED_VERIFICATION_ATTEMPT_INVALID", "PRECHECK");
  }
  const attempt = verificationAttempt as 1 | 2;
  const parsedUrl = parseDatabaseUrl(options.databaseUrl);
  const expectedDatabase = await assertDatabasePreflight(options, parsedUrl);
  const paths = resolveTargetedPaths(options);
  const canonical = JSON.parse((await readRootOnlyRegularFile(paths.canonical)).toString("utf8"));
  assertUatCanonical(canonical);
  const target = canonical.accounts.filter((account) => account.username === TARGETED_ACCOUNT.username);
  if (target.length !== 1 || target[0].role !== TARGETED_ACCOUNT.role || target[0].must_change_password !== false) {
    throw new RecoveryError("TARGETED_CANONICAL_ACCOUNT_MISMATCH", "CANONICAL_SCHEMA");
  }
  const recovery = await verifyCommitOutcome(options, target[0].password, false);
  if (recovery.state !== "committed") {
    throw new RecoveryError("TARGETED_COMMITTED_EVIDENCE_REQUIRED", "VERIFICATION");
  }
  const prior = await targetedCleanupOutcome(options, attempt);
  if (prior.state === "committed") {
    return {
      accountCount: 1,
      sessionRevokedCount: prior.sessionRevokedCount,
      auditCount: 1,
      remainingSessionCount: 0,
      verificationAttempt: attempt,
    };
  }
  if (prior.state === "unknown") {
    throw new RecoveryError("TARGETED_SESSION_CLEANUP_OUTCOME_UNKNOWN", "SESSION_CLEANUP");
  }
  const client = await options.pool.connect();
  const operationId = randomUUID();
  const markerDigest = cleanupMarkerDigest(options.recoveryRunId, attempt);
  let commitAttempted = false;
  let commitAcknowledged = false;
  try {
    await client.query("begin isolation level serializable");
    const recoveryLock = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_xact_lock(hashtextextended($1,0)) locked",
      [`${RECOVERY_ACTION}:GLOBAL`],
    );
    const migrationLock = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_xact_lock(hashtext('chenyida_erp_schema_migration')) locked",
    );
    if (recoveryLock.rows[0]?.locked !== true || migrationLock.rows[0]?.locked !== true) {
      throw new RecoveryError("TARGETED_CONCURRENT_OPERATION", "SESSION_CLEANUP");
    }
    if (options.environment === "parallel-uat") {
      await assertOfflineAttestation(options.offlineAttestationPath, options.recoveryRunId);
    }
    await assertObservedPreflight(client, expectedDatabase);
    const locked = await client.query<TargetedUserState>(`
      select username,role,is_active,must_change_password,version
      from app_users where username=$1 for update
    `, [TARGETED_ACCOUNT.username]);
    const actual = locked.rows[0];
    if (locked.rowCount !== 1 || !actual
      || actual.role !== TARGETED_ACCOUNT.role || actual.is_active !== true
      || actual.must_change_password !== false || Number(actual.version) !== options.expectedUserVersion + 1) {
      throw new RecoveryError("TARGETED_ACCOUNT_INVARIANT_MISMATCH", "SESSION_CLEANUP");
    }
    const marker = await client.query(`
      insert into idempotency_keys(
        key_digest,username,method,path,request_digest,status_code,response,expires_at,created_at
      ) values($1,$2,'OFFLINE',$3,$4,200,$5,'infinity',transaction_timestamp())
      on conflict(key_digest) do nothing returning key_digest
    `, [
      markerDigest,
      RECOVERY_ACTOR,
      `identity-recovery-targeted-browser-cleanup:${options.environment}:${TARGETED_ACCOUNT.username}:${attempt}`,
      sha256(JSON.stringify({
        recovery_run_id: options.recoveryRunId,
        username: TARGETED_ACCOUNT.username,
        verification_attempt: attempt,
      })),
      {
        status: "COMMITTED",
        recovery_run_id: options.recoveryRunId,
        environment: options.environment,
        username: TARGETED_ACCOUNT.username,
        verification_attempt: attempt,
        operation_id: operationId,
      },
    ]);
    if (marker.rowCount !== 1) throw new RecoveryError("TARGETED_SESSION_CLEANUP_REPLAYED", "SESSION_CLEANUP");
    const repository = new PostgresIdentityRepository(options.pool);
    const sessionRevokedCount = await repository.revokeUserSessions(client, TARGETED_ACCOUNT.username, "LOGOUT");
    await repository.recordAudit(client, {
      actor: RECOVERY_ACTOR,
      action: RECOVERY_SESSION_CLEANUP_ACTION,
      targetUsername: TARGETED_ACCOUNT.username,
      result: "success",
      requestId: options.recoveryRunId,
      operationId,
      idempotencyKeyDigest: markerDigest,
      safeDetails: {
        actor_type: "SYSTEM_RECOVERY_CLI",
        execution_mode: "OFFLINE_TARGETED_BROWSER_CLEANUP",
        environment: options.environment,
        recovery_run_id: options.recoveryRunId,
        verification_attempt: attempt,
        reason_code: "BROWSER_SESSION_CLEANUP_UNCERTAIN",
        session_revoked_count: sessionRevokedCount,
      },
    });
    const remaining = await client.query<{ count: number }>(`
      select count(*)::int count from app_sessions where username=$1 and revoked_at is null
    `, [TARGETED_ACCOUNT.username]);
    if (Number(remaining.rows[0]?.count) !== 0) {
      throw new RecoveryError("TARGETED_SESSION_CLEANUP_INCOMPLETE", "SESSION_CLEANUP");
    }
    await assertObservedPreflight(client, expectedDatabase);
    commitAttempted = true;
    await client.query("commit");
    commitAcknowledged = true;
    return {
      accountCount: 1,
      sessionRevokedCount,
      auditCount: 1,
      remainingSessionCount: 0,
      verificationAttempt: attempt,
    };
  } catch (error) {
    if (!commitAcknowledged) await client.query("rollback").catch(() => undefined);
    if (commitAttempted) {
      const outcome = await targetedCleanupOutcome(options, attempt);
      if (outcome.state === "committed") {
        return {
          accountCount: 1,
          sessionRevokedCount: outcome.sessionRevokedCount,
          auditCount: 1,
          remainingSessionCount: 0,
          verificationAttempt: attempt,
        };
      }
      throw new RecoveryError("TARGETED_SESSION_CLEANUP_OUTCOME_UNKNOWN", "SESSION_CLEANUP");
    }
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError("TARGETED_SESSION_CLEANUP_FAILED", "SESSION_CLEANUP");
  } finally {
    client.release(commitAttempted && !commitAcknowledged);
  }
}
