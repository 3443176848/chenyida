import path from "node:path";
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
    else throw new RecoveryError("RECOVERY_ARGUMENT_INVALID", "PRECHECK");
  }
  return parsed;
}

function line(...parts: Array<string | number>): void {
  process.stdout.write(`${parts.join(" ")}\n`);
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
      + Number(args.diagnoseSchema);
    if (selectedModes > 1
      || args.finalizationConfirmation && !args.finalizeRecoveryStage
      || args.browserVerificationEvidencePath && !args.finalizeRecoveryStage
      || args.sessionCleanupConfirmation && !args.cleanupBrowserFailureSessions
      || args.sessionCleanupUsername && !args.cleanupBrowserFailureSessions
      || args.cleanupBrowserFailureSessions && !args.sessionCleanupUsername) {
      throw new RecoveryError("RECOVERY_ARGUMENT_INVALID", "PRECHECK");
    }
    if (args.diagnoseSchema) {
      const expectedClass = args.environment === "parallel-uat" ? "uat" : "test";
      if (!UUID_V4.test(args.recoveryRunId)
        || !["parallel-uat", "parallel-uat-rehearsal"].includes(args.environment)
        || (process.geteuid?.() ?? -1) !== 0
        || process.env.ERP_DEPLOYMENT_CLASS !== expectedClass
        || process.env.ERP_DEPLOYMENT_CLASS === "production"
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
