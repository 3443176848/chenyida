import path from "node:path";
import { fstatSync } from "node:fs";
import { Pool } from "pg";
import {
  diagnoseUatCredentialFile,
  executeBrowserFailureSessionCleanup,
  executeRecovery,
  executeRetainedStagePromotion,
  executeStageFinalization,
  formatUatSchemaDiagnosis,
  RECOVERY_ACCOUNTS,
  RecoveryError,
} from "./core.ts";
import {
  executeTargetedRecovery,
  executeTargetedRetainedCandidatePromotion,
  executeTargetedVerificationSessionCleanup,
  TARGETED_ACCOUNT,
  type TargetedRecoveryOptions,
} from "./targeted.ts";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Arguments = {
  environment: "parallel-uat" | "parallel-uat-rehearsal" | "";
  expectedMigration: string;
  recoveryRunId: string;
  confirmation: boolean;
  finalizationConfirmation: boolean;
  promoteRetainedStageOnly: boolean;
  finalizeRecoveryStage: boolean;
  cleanupBrowserFailureSessions: boolean;
  diagnoseSchema: boolean;
  sessionCleanupConfirmation: boolean;
  sessionCleanupUsername?: string;
  targetedFinalizeAccount: boolean;
  promoteRetainedTargetedCandidateOnly: boolean;
  revokeTargetedVerificationSessions: boolean;
  targetedPasswordStdin: boolean;
  targetUsername?: string;
  expectedRole?: string;
  expectedActive?: string;
  expectedUserVersion?: string;
  targetedConfirmationPhrase?: string;
  verificationAttempt?: string;
  expectedDatabaseName?: string;
  stageDirectory?: string;
  offlineAttestationPath?: string;
  browserVerificationEvidencePath?: string;
};

function parseArguments(argv: string[]): Arguments {
  const parsed: Arguments = {
    environment: "",
    expectedMigration: "",
    recoveryRunId: "",
    confirmation: false,
    finalizationConfirmation: false,
    promoteRetainedStageOnly: false,
    finalizeRecoveryStage: false,
    cleanupBrowserFailureSessions: false,
    diagnoseSchema: false,
    sessionCleanupConfirmation: false,
    targetedFinalizeAccount: false,
    promoteRetainedTargetedCandidateOnly: false,
    revokeTargetedVerificationSessions: false,
    targetedPasswordStdin: false,
  };
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (seen.has(flag)) throw new RecoveryError("RECOVERY_ARGUMENT_DUPLICATE", "PRECHECK");
    seen.add(flag);
    if (flag === "--confirm-offline-recovery") {
      parsed.confirmation = true;
      continue;
    }
    if (flag === "--confirm-finalize-after-browser-verification") {
      parsed.finalizationConfirmation = true;
      continue;
    }
    if (flag === "--promote-retained-stage-only") {
      parsed.promoteRetainedStageOnly = true;
      continue;
    }
    if (flag === "--finalize-recovery-stage") {
      parsed.finalizeRecoveryStage = true;
      continue;
    }
    if (flag === "--revoke-target-sessions-after-browser-failure") {
      parsed.cleanupBrowserFailureSessions = true;
      continue;
    }
    if (flag === "--diagnose-schema") {
      parsed.diagnoseSchema = true;
      continue;
    }
    if (flag === "--confirm-browser-failure-session-cleanup") {
      parsed.sessionCleanupConfirmation = true;
      continue;
    }
    if (flag === "--targeted-finalize-account") {
      parsed.targetedFinalizeAccount = true;
      continue;
    }
    if (flag === "--promote-retained-targeted-candidate-only") {
      parsed.promoteRetainedTargetedCandidateOnly = true;
      continue;
    }
    if (flag === "--targeted-password-stdin") {
      parsed.targetedPasswordStdin = true;
      continue;
    }
    if (flag === "--revoke-targeted-verification-sessions") {
      parsed.revokeTargetedVerificationSessions = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new RecoveryError("RECOVERY_ARGUMENT_INVALID", "PRECHECK");
    index += 1;
    if (flag === "--environment") parsed.environment = value as Arguments["environment"];
    else if (flag === "--expected-migration") parsed.expectedMigration = value;
    else if (flag === "--expected-run-id") parsed.recoveryRunId = value;
    else if (flag === "--expected-database-name") parsed.expectedDatabaseName = value;
    else if (flag === "--stage-directory") parsed.stageDirectory = value;
    else if (flag === "--offline-attestation") parsed.offlineAttestationPath = value;
    else if (flag === "--browser-verification-evidence") parsed.browserVerificationEvidencePath = value;
    else if (flag === "--session-cleanup-username") parsed.sessionCleanupUsername = value;
    else if (flag === "--target-username") parsed.targetUsername = value;
    else if (flag === "--expected-role") parsed.expectedRole = value;
    else if (flag === "--expected-active") parsed.expectedActive = value;
    else if (flag === "--expected-user-version") parsed.expectedUserVersion = value;
    else if (flag === "--targeted-confirmation-phrase") parsed.targetedConfirmationPhrase = value;
    else if (flag === "--verification-attempt") parsed.verificationAttempt = value;
    else throw new RecoveryError("RECOVERY_ARGUMENT_INVALID", "PRECHECK");
  }
  return parsed;
}

function line(...parts: Array<string | number>): void {
  process.stdout.write(`${parts.join(" ")}\n`);
}

async function readTargetedPasswordFromPipe(): Promise<string> {
  let metadata;
  try {
    metadata = fstatSync(0);
  } catch {
    throw new RecoveryError("TARGETED_PASSWORD_PIPE_REQUIRED", "PRECHECK");
  }
  if (process.stdin.isTTY === true || metadata.isFile() || metadata.isDirectory()) {
    throw new RecoveryError("TARGETED_PASSWORD_PIPE_REQUIRED", "PRECHECK");
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const raw of process.stdin) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    length += chunk.length;
    if (length > 130) {
      chunks.forEach((value) => value.fill(0));
      chunk.fill(0);
      throw new RecoveryError("TARGETED_PASSWORD_PIPE_INVALID", "PRECHECK");
    }
    chunks.push(chunk);
  }
  const payload = Buffer.concat(chunks);
  chunks.forEach((value) => value.fill(0));
  try {
    if (payload.length < 2 || payload.at(-1) !== 0x0a || payload.subarray(0, -1).includes(0x0a)
      || payload.subarray(0, -1).includes(0x0d) || payload.includes(0x00)) {
      throw new RecoveryError("TARGETED_PASSWORD_PIPE_INVALID", "PRECHECK");
    }
    return payload.subarray(0, -1).toString("utf8");
  } finally {
    payload.fill(0);
  }
}

async function main(): Promise<number> {
  process.umask(0o077);
  Error.stackTraceLimit = 0;
  let pool: Pool | null = null;
  try {
    const args = parseArguments(process.argv.slice(2));
    const selectedModes = Number(args.promoteRetainedStageOnly)
      + Number(args.finalizeRecoveryStage)
      + Number(args.cleanupBrowserFailureSessions)
      + Number(args.diagnoseSchema)
      + Number(args.targetedFinalizeAccount)
      + Number(args.promoteRetainedTargetedCandidateOnly)
      + Number(args.revokeTargetedVerificationSessions);
    if (selectedModes > 1
      || args.finalizationConfirmation && !args.finalizeRecoveryStage
      || args.browserVerificationEvidencePath && !args.finalizeRecoveryStage
      || args.sessionCleanupConfirmation && !args.cleanupBrowserFailureSessions
      || args.sessionCleanupUsername && !args.cleanupBrowserFailureSessions
      || args.cleanupBrowserFailureSessions && !args.sessionCleanupUsername) {
      throw new RecoveryError("RECOVERY_ARGUMENT_INVALID", "PRECHECK");
    }
    const targetedMode = args.targetedFinalizeAccount
      || args.promoteRetainedTargetedCandidateOnly
      || args.revokeTargetedVerificationSessions;
    const targetedFieldsPresent = args.targetedPasswordStdin
      || args.targetUsername !== undefined
      || args.expectedRole !== undefined
      || args.expectedActive !== undefined
      || args.expectedUserVersion !== undefined
      || args.targetedConfirmationPhrase !== undefined
      || args.verificationAttempt !== undefined;
    if (targetedMode) {
      if (args.confirmation
        || args.finalizationConfirmation
        || args.sessionCleanupConfirmation
        || args.sessionCleanupUsername
        || args.browserVerificationEvidencePath
        || args.finalizeRecoveryStage
        || args.promoteRetainedStageOnly
        || args.cleanupBrowserFailureSessions
        || args.diagnoseSchema
        || !args.targetUsername
        || !args.expectedRole
        || !args.expectedActive
        || !args.expectedUserVersion
        || !args.targetedConfirmationPhrase
        || args.revokeTargetedVerificationSessions !== (args.verificationAttempt !== undefined)
        || args.targetedFinalizeAccount !== args.targetedPasswordStdin) {
        throw new RecoveryError("RECOVERY_ARGUMENT_INVALID", "PRECHECK");
      }
    } else if (targetedFieldsPresent) {
      throw new RecoveryError("RECOVERY_ARGUMENT_INVALID", "PRECHECK");
    }
    if (args.diagnoseSchema) {
      const expectedClass = args.environment === "parallel-uat" ? "uat" : "test";
      if (!UUID_V4.test(args.recoveryRunId)
        || !["parallel-uat", "parallel-uat-rehearsal"].includes(args.environment)
        || (process.geteuid?.() ?? -1) !== 0
        || process.env.ERP_DEPLOYMENT_CLASS !== expectedClass
        || args.expectedMigration
        || args.confirmation
        || args.finalizationConfirmation
        || args.offlineAttestationPath
        || args.browserVerificationEvidencePath
        || args.expectedDatabaseName
        || (args.environment === "parallel-uat" && args.stageDirectory)
        || (args.environment === "parallel-uat-rehearsal"
          && args.stageDirectory !== `/run/chenyida-erp/identity-recovery-tests/${args.recoveryRunId}`)) {
        throw new RecoveryError("RECOVERY_ARGUMENT_INVALID", "PRECHECK");
      }
      const credentialPath = args.environment === "parallel-uat"
        ? "/etc/chenyida-erp/uat-role-accounts.txt"
        : path.join(args.stageDirectory!, "uat-role-accounts.txt");
      const diagnosis = await diagnoseUatCredentialFile(credentialPath, args.recoveryRunId);
      for (const outputLine of formatUatSchemaDiagnosis(diagnosis)) line(outputLine);
      return diagnosis.valid ? 0 : 2;
    }
    const databaseUrl = process.env.DATABASE_URL || "";
    pool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      application_name: "chenyida-erp-offline-recovery",
    });
    pool.on("error", fatal);
    if (targetedMode) {
      const expectedUserVersion = Number(args.expectedUserVersion);
      const verificationAttempt = Number(args.verificationAttempt);
      if (!Number.isSafeInteger(expectedUserVersion)
        || !["true", "false"].includes(args.expectedActive || "")
        || args.revokeTargetedVerificationSessions && ![1, 2].includes(verificationAttempt)) {
        throw new RecoveryError("RECOVERY_ARGUMENT_INVALID", "PRECHECK");
      }
      let password: string | undefined;
      try {
        if (args.targetedFinalizeAccount) password = await readTargetedPasswordFromPipe();
        const targetedOptions: TargetedRecoveryOptions = {
          pool,
          environment: args.environment as "parallel-uat" | "parallel-uat-rehearsal",
          deploymentClass: process.env.ERP_DEPLOYMENT_CLASS || "",
          expectedMigration: args.expectedMigration,
          recoveryRunId: args.recoveryRunId,
          targetUsername: args.targetUsername!,
          expectedRole: args.expectedRole!,
          expectedActive: args.expectedActive === "true",
          expectedUserVersion,
          confirmationPhrase: args.targetedConfirmationPhrase!,
          effectiveUid: process.geteuid?.() ?? -1,
          databaseUrl,
          password,
          expectedDatabaseName: args.expectedDatabaseName,
          stageDirectory: args.stageDirectory,
          offlineAttestationPath: args.offlineAttestationPath,
          promote: true,
        };
        if (args.revokeTargetedVerificationSessions) {
          const cleanup = await executeTargetedVerificationSessionCleanup(targetedOptions, verificationAttempt);
          line("STAGE", "PRECHECK", "PASS");
          line("STAGE", "SESSION_CLEANUP", "PASS");
          line("ACCOUNT", TARGETED_ACCOUNT.username, "PASS");
          line("COUNT", "ACCOUNTS", cleanup.accountCount);
          line("COUNT", "SESSIONS_REVOKED", cleanup.sessionRevokedCount);
          line("COUNT", "AUDIT", cleanup.auditCount);
          line("COUNT", "REMAINING_SESSIONS", cleanup.remainingSessionCount);
          line("FINAL", "TARGETED_SESSION_CLEANUP_COMPLETED");
          return 0;
        }
        const result = args.promoteRetainedTargetedCandidateOnly
          ? await executeTargetedRetainedCandidatePromotion(targetedOptions)
          : await executeTargetedRecovery(targetedOptions);
        line("STAGE", "PRECHECK", "PASS");
        line("STAGE", "CANONICAL_CANDIDATE", "PASS");
        line("SCHEMA_VERSION", "chenyida-erp-uat-credentials-v2");
        line("VALIDATOR_VERSION", "offline-identity-recovery-uat-validator-v2.1");
        line("WRITER_VERSION", "offline-identity-recovery-credential-writer-v2");
        line("COUNT", "CANONICAL_ACCOUNTS", result.canonicalAccountCount);
        line("COUNT", "CANONICAL_ERRORS", result.canonicalErrorCount);
        line("COUNT", "CANONICAL_DIFFS", result.canonicalDiffCount);
        if (result.status === "partial") {
          if (result.partialPhase !== "TRANSACTION_OUTCOME") line("STAGE", "DATABASE_TRANSACTION", "PASS");
          line("STAGE", result.partialPhase || "INTERNAL", "FAIL", result.code || "TARGETED_RECOVERY_PARTIAL");
          line("FINAL", "PARTIAL");
          return 3;
        }
        line("STAGE", "DATABASE_TRANSACTION", "PASS");
        line("ACCOUNT", TARGETED_ACCOUNT.username, "PASS");
        line("COUNT", "ACCOUNTS", result.accountCount);
        line("COUNT", "SESSIONS_REVOKED", result.sessionRevokedCount);
        line("COUNT", "AUDIT", result.auditCount);
        line("COUNT", "OTHER_CONTROLLED_ACCOUNTS", result.otherControlledAccountCount);
        line("STAGE", "OTHER_ACCOUNTS", result.otherAccountsUnchanged ? "PASS" : "FAIL");
        line("STAGE", "OTHER_SESSIONS", result.otherSessionsUnchanged ? "PASS" : "FAIL");
        line("STAGE", "BUSINESS_PROTECTION", result.businessFingerprintBefore === result.businessFingerprintAfter ? "PASS" : "FAIL");
        line("STAGE", "PROMOTION", "PASS");
        line("FINAL", "TARGETED_CANONICAL_ACTIVE");
        return 0;
      } finally {
        password = undefined;
      }
    }
    const recoveryOptions = {
      pool,
      environment: args.environment as "parallel-uat" | "parallel-uat-rehearsal",
      deploymentClass: process.env.ERP_DEPLOYMENT_CLASS || "",
      expectedMigration: args.expectedMigration,
      recoveryRunId: args.recoveryRunId,
      confirmation: args.confirmation,
      finalizationConfirmation: args.finalizationConfirmation,
      sessionCleanupConfirmation: args.sessionCleanupConfirmation,
      sessionCleanupUsername: args.sessionCleanupUsername,
      effectiveUid: process.geteuid?.() ?? -1,
      databaseUrl,
      expectedDatabaseName: args.expectedDatabaseName,
      stageDirectory: args.stageDirectory,
      offlineAttestationPath: args.offlineAttestationPath,
      browserVerificationEvidencePath: args.browserVerificationEvidencePath,
      promote: true,
    };
    if (args.cleanupBrowserFailureSessions) {
      const cleanup = await executeBrowserFailureSessionCleanup(recoveryOptions);
      line("STAGE", "PRECHECK", "PASS");
      line("STAGE", "SESSION_CLEANUP", "PASS");
      line("ACCOUNT", args.sessionCleanupUsername || "", "PASS");
      line("COUNT", "ACCOUNTS", cleanup.accountCount);
      line("COUNT", "SESSIONS_REVOKED", cleanup.sessionRevokedCount);
      line("COUNT", "AUDIT", cleanup.auditCount);
      line("FINAL", "SESSION_CLEANUP_COMPLETED");
      return 0;
    }
    const result = args.finalizeRecoveryStage
      ? await executeStageFinalization(recoveryOptions)
      : args.promoteRetainedStageOnly
        ? await executeRetainedStagePromotion(recoveryOptions)
        : await executeRecovery(recoveryOptions);
    line("STAGE", "PRECHECK", "PASS");
    if (result.status === "partial") {
      if (result.partialPhase === "TRANSACTION_OUTCOME") {
        line("STAGE", "TRANSACTION_OUTCOME", "FAIL", result.promotionCode || "RECOVERY_COMMIT_OUTCOME_UNKNOWN");
      } else {
        line("STAGE", "DATABASE_TRANSACTION", "PASS");
        for (const account of RECOVERY_ACCOUNTS) line("ACCOUNT", account.username, "PASS");
        line("COUNT", "ACCOUNTS", result.accountCount);
        line("COUNT", "SESSIONS_REVOKED", result.sessionRevokedCount);
        line("COUNT", "AUDIT", result.auditCount);
        const stage = result.partialPhase === "FINALIZATION" ? "FINALIZE" : "PROMOTION";
        const code = result.partialPhase === "FINALIZATION" ? "RECOVERY_STAGE_FINALIZE_FAILED" : "RECOVERY_CANONICAL_PROMOTION_FAILED";
        line("STAGE", stage, "FAIL", result.promotionCode || code);
      }
      line("FINAL", "PARTIAL");
      return 3;
    }
    if (args.finalizeRecoveryStage) {
      line("STAGE", "FINALIZE", "PASS");
      line("FINAL", "COMPLETED");
      return 0;
    }
    line("STAGE", "DATABASE_TRANSACTION", "PASS");
    for (const account of RECOVERY_ACCOUNTS) line("ACCOUNT", account.username, "PASS");
    line("COUNT", "ACCOUNTS", result.accountCount);
    line("COUNT", "SESSIONS_REVOKED", result.sessionRevokedCount);
    line("COUNT", "AUDIT", result.auditCount);
    line("STAGE", "CANONICAL_SCHEMA", "PASS");
    line("STAGE", "PROMOTION", "PASS");
    line("FINAL", "CANONICAL_ACTIVE_STAGE_RETAINED");
    return 0;
  } catch (error) {
    const known = error instanceof RecoveryError ? error : new RecoveryError("RECOVERY_INTERNAL_ERROR", "INTERNAL");
    line("STAGE", known.phase, "FAIL", known.code);
    line("FINAL", "BLOCKED");
    return 2;
  } finally {
    await pool?.end().catch(() => undefined);
  }
}

function fatal(): never {
  process.stderr.write("STAGE INTERNAL FAIL RECOVERY_UNHANDLED_ERROR\n");
  process.exit(2);
}

process.once("uncaughtException", fatal);
process.once("unhandledRejection", fatal);
process.exitCode = await main();
