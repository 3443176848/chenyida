import { randomUUID } from "node:crypto";
import { link, lstat, open, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BROWSER_IMAGE = "sha256:146d046a8d79a1b3a87596c4457b0b1c47f811bf4fc2cc1b99e873ae7f1cbbbd";
const WEB_IMAGE = "sha256:6b94a9c73a182799ffad6df5f89ecb86e5407162f0f233e8741aea3fd9dc4e25";
const ACCOUNTS = [
  "admin",
  "uat_20260729_manager",
  "uat_20260729_sales",
  "uat_20260729_engineering",
  "uat_20260729_planning",
  "uat_20260729_purchase",
  "uat_20260729_warehouse",
  "uat_20260729_production",
  "uat_20260729_quality",
  "uat_20260729_finance",
  "uat_20260729_operations",
] as const;

class EvidenceFailure extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

function exactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function parseArguments(argv: string[]): { environment: "parallel-uat" | "parallel-uat-rehearsal"; runId: string } {
  let environment = "";
  let runId = "";
  let confirmed = false;
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (seen.has(flag)) throw new EvidenceFailure("RECOVERY_BROWSER_EVIDENCE_ARGUMENT_INVALID");
    seen.add(flag);
    if (flag === "--confirm-host-postcheck") {
      confirmed = true;
      continue;
    }
    const value = argv[index + 1] || "";
    index += 1;
    if (flag === "--environment") environment = value;
    else if (flag === "--expected-run-id") runId = value;
    else throw new EvidenceFailure("RECOVERY_BROWSER_EVIDENCE_ARGUMENT_INVALID");
  }
  if (!confirmed || !["parallel-uat", "parallel-uat-rehearsal"].includes(environment) || !UUID_V4.test(runId)) {
    throw new EvidenceFailure("RECOVERY_BROWSER_EVIDENCE_ARGUMENT_INVALID");
  }
  return { environment: environment as "parallel-uat" | "parallel-uat-rehearsal", runId };
}

async function fsyncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function exists(filePath: string): Promise<boolean> {
  try { await lstat(filePath); return true; } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function assertMetadata(filePath: string): Promise<void> {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0
    || (metadata.mode & 0o777) !== 0o600 || metadata.nlink !== 1
    || metadata.size < 2 || metadata.size > 8192) {
    throw new EvidenceFailure("RECOVERY_BROWSER_EVIDENCE_METADATA_INVALID");
  }
}

function assertCommon(value: Record<string, unknown>, environment: string, runId: string): void {
  const origin = environment === "parallel-uat"
    ? "https://43.135.148.43.nip.io:18888"
    : "http://127.0.0.1:3000";
  if (value.verifier_version !== "offline-identity-recovery-browser-v2"
    || value.recovery_run_id !== runId
    || value.environment !== environment
    || value.origin !== origin
    || value.browser_image_id !== BROWSER_IMAGE
    || value.web_image_id !== WEB_IMAGE
    || !Array.isArray(value.accounts)
    || value.accounts.length !== ACCOUNTS.length
    || value.accounts.some((account, index) => account !== ACCOUNTS[index])
    || value.admin_login_count !== 1
    || value.uat_login_count !== 10
    || value.uat_force_change_count !== 10
    || value.logout_count !== 11
    || value.history_reload_count !== 11
    || value.history_back_count !== 11
    || value.history_forward_count !== 11
    || value.blocked_request_count !== 0
    || !Number.isInteger(value.issued_at_epoch)) {
    throw new EvidenceFailure("RECOVERY_BROWSER_EVIDENCE_SCHEMA_INVALID");
  }
  const now = Math.floor(Date.now() / 1000);
  if (Number(value.issued_at_epoch) > now + 30 || now - Number(value.issued_at_epoch) > 300) {
    throw new EvidenceFailure("RECOVERY_BROWSER_EVIDENCE_STALE");
  }
}

function validateProvisional(value: unknown, environment: string, runId: string): asserts value is Record<string, unknown> {
  const keys = [
    "format_version", "verifier_version", "recovery_run_id", "environment", "origin",
    "browser_image_id", "web_image_id", "accounts", "admin_login_count", "uat_login_count",
    "uat_force_change_count", "logout_count", "history_reload_count", "history_back_count",
    "history_forward_count", "blocked_request_count", "issued_at_epoch",
  ];
  if (!exactKeys(value, keys) || value.format_version !== "chenyida-erp-browser-verification-provisional-v2") {
    throw new EvidenceFailure("RECOVERY_BROWSER_EVIDENCE_SCHEMA_INVALID");
  }
  assertCommon(value, environment, runId);
}

function validateFinal(value: unknown, environment: string, runId: string): asserts value is Record<string, unknown> {
  const keys = [
    "format_version", "verifier_version", "recovery_run_id", "environment", "origin",
    "browser_image_id", "web_image_id", "accounts", "admin_login_count", "uat_login_count",
    "uat_force_change_count", "logout_count", "history_reload_count", "history_back_count",
    "history_forward_count", "blocked_request_count", "issued_at_epoch", "host_postcheck",
    "promoted_at_epoch",
  ];
  if (!exactKeys(value, keys) || value.format_version !== "chenyida-erp-browser-verification-v2"
    || value.host_postcheck !== true || !Number.isInteger(value.promoted_at_epoch)
    || Number(value.promoted_at_epoch) < Number(value.issued_at_epoch)
    || Number(value.promoted_at_epoch) > Math.floor(Date.now() / 1000) + 30) {
    throw new EvidenceFailure("RECOVERY_BROWSER_EVIDENCE_SCHEMA_INVALID");
  }
  assertCommon(value, environment, runId);
}

async function readJson(filePath: string): Promise<unknown> {
  await assertMetadata(filePath);
  try { return JSON.parse(await readFile(filePath, "utf8")); } catch {
    throw new EvidenceFailure("RECOVERY_BROWSER_EVIDENCE_SCHEMA_INVALID");
  }
}

async function promote(environment: string, runId: string): Promise<void> {
  const directory = "/evidence";
  const directoryMetadata = await lstat(directory);
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()
    || directoryMetadata.uid !== 0 || directoryMetadata.gid !== 0
    || (directoryMetadata.mode & 0o022) !== 0 || await realpath(directory) !== directory) {
    throw new EvidenceFailure("RECOVERY_BROWSER_EVIDENCE_DIRECTORY_INVALID");
  }
  const provisional = environment === "parallel-uat"
    ? path.join(directory, `.identity-recovery-browser-${runId}.provisional.json`)
    : path.join(directory, ".browser-verification.provisional.json");
  const finalPath = environment === "parallel-uat"
    ? path.join(directory, `identity-recovery-browser-${runId}.json`)
    : path.join(directory, "browser-verification.json");

  if (await exists(finalPath)) {
    const finalValue = await readJson(finalPath);
    validateFinal(finalValue, environment, runId);
    if (await exists(provisional)) {
      const provisionalValue = await readJson(provisional);
      validateProvisional(provisionalValue, environment, runId);
      for (const [key, value] of Object.entries(provisionalValue)) {
        if (key === "format_version") continue;
        if (JSON.stringify(finalValue[key]) !== JSON.stringify(value)) {
          throw new EvidenceFailure("RECOVERY_BROWSER_EVIDENCE_MISMATCH");
        }
      }
      await unlink(provisional);
      await fsyncDirectory(directory);
    }
    return;
  }

  const provisionalValue = await readJson(provisional);
  validateProvisional(provisionalValue, environment, runId);
  const finalValue = {
    ...provisionalValue,
    format_version: "chenyida-erp-browser-verification-v2",
    host_postcheck: true,
    promoted_at_epoch: Math.floor(Date.now() / 1000),
  };
  const temporary = path.join(directory, `.browser-evidence-promote-${randomUUID()}`);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let temporaryCreated = false;
  try {
    handle = await open(temporary, "wx", 0o600);
    temporaryCreated = true;
    await handle.writeFile(`${JSON.stringify(finalValue)}\n`, "utf8");
    await handle.chmod(0o600);
    await handle.chown(0, 0);
    await handle.sync();
    await handle.close();
    handle = null;
    await link(temporary, finalPath);
    await unlink(temporary);
    temporaryCreated = false;
    await fsyncDirectory(directory);
    const installed = await readJson(finalPath);
    validateFinal(installed, environment, runId);
    await unlink(provisional);
    await fsyncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (temporaryCreated) await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function main(): Promise<number> {
  process.umask(0o077);
  Error.stackTraceLimit = 0;
  try {
    if ((process.geteuid?.() ?? -1) !== 0) throw new EvidenceFailure("RECOVERY_ROOT_REQUIRED");
    const args = parseArguments(process.argv.slice(2));
    const expectedClass = args.environment === "parallel-uat" ? "uat" : "test";
    if (process.env.ERP_DEPLOYMENT_CLASS !== expectedClass || process.env.ERP_DEPLOYMENT_CLASS === "production") {
      throw new EvidenceFailure("RECOVERY_DEPLOYMENT_CLASS_INVALID");
    }
    await promote(args.environment, args.runId);
    process.stdout.write("STAGE BROWSER_EVIDENCE PASS\n");
    return 0;
  } catch (error) {
    const code = error instanceof EvidenceFailure ? error.code : "RECOVERY_BROWSER_EVIDENCE_PROMOTION_FAILED";
    process.stderr.write(`STAGE BROWSER_EVIDENCE FAIL ${code}\n`);
    return 2;
  }
}

function fatal(): never {
  process.stderr.write("STAGE BROWSER_EVIDENCE FAIL RECOVERY_UNHANDLED_ERROR\n");
  process.exit(2);
}

process.once("uncaughtException", fatal);
process.once("unhandledRejection", fatal);
process.exitCode = await main();
