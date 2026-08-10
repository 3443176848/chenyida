#!/usr/bin/env node
import { open, readFile, lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalPrettyJson, sha256Hex } from "./canonical.ts";
import { assertControlledPath } from "./schema.ts";
import {
  loadApprovedSuggestionLayerDataset,
  SUGGESTION_LAYER_DATASET_NAME,
} from "./suggestion-layer-dataset.ts";
import type { SuggestionDatasetSelection } from "./suggestion-layer-dataset.ts";
import {
  APPROVED_CANDIDATE_SOURCE_REVISION,
  evaluateSuggestionLayerDataset,
  FROZEN_ALPHA43_REPORT_SHA256,
  FROZEN_MIGRATION_0041_SHA256,
} from "./suggestion-layer-evaluator.ts";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FORMAL_REPORT_PATH = path.join(
  PROJECT_ROOT,
  "evals/ai-governance/material-v1/reports/deterministic-suggestion-layer-alpha44.json",
);
const ALPHA43_REPORT_PATH = path.join(
  PROJECT_ROOT,
  "evals/ai-governance/material-v1/reports/deterministic-baseline-alpha43.json",
);
const MIGRATION_0041_PATH = path.join(PROJECT_ROOT, "drizzle-postgres/0041_ai_governance_suggestion_evidence.sql");

type CliOptions = Readonly<{
  dataset: string;
  split: SuggestionDatasetSelection;
  candidateSourceRevision: string;
  harnessRevision: string;
  output: string;
}>;

function parseArguments(argv: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--") || values.has(flag)) {
      throw new Error("SUGGESTION_CLI_ARGUMENT_INVALID");
    }
    values.set(flag, value);
  }
  const expectedFlags = ["--candidate-source-revision", "--dataset", "--harness-revision", "--output", "--split"];
  const actualFlags = [...values.keys()].sort((left, right) => left.localeCompare(right, "en"));
  if (JSON.stringify(actualFlags) !== JSON.stringify(expectedFlags)) throw new Error("SUGGESTION_CLI_ARGUMENT_INVALID");
  const dataset = values.get("--dataset")!;
  const split = values.get("--split")!;
  const candidateSourceRevision = values.get("--candidate-source-revision")!;
  const harnessRevision = values.get("--harness-revision")!;
  const output = values.get("--output")!;
  if (dataset !== SUGGESTION_LAYER_DATASET_NAME) throw new Error("SUGGESTION_CLI_DATASET_INVALID");
  if (split !== "calibration" && split !== "all") throw new Error("SUGGESTION_CLI_SPLIT_INVALID");
  if (candidateSourceRevision !== APPROVED_CANDIDATE_SOURCE_REVISION) throw new Error("SUGGESTION_CLI_CANDIDATE_REVISION_INVALID");
  if (!/^[0-9a-f]{40}$/.test(harnessRevision)) throw new Error("SUGGESTION_CLI_HARNESS_REVISION_INVALID");
  if (!output) throw new Error("SUGGESTION_CLI_OUTPUT_INVALID");
  return Object.freeze({
    dataset,
    split,
    candidateSourceRevision,
    harnessRevision,
    output,
  });
}

async function assertTargetAbsent(target: string): Promise<void> {
  try {
    await lstat(target);
    throw new Error("SUGGESTION_CLI_OUTPUT_EXISTS");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function resolveOutput(options: CliOptions): Promise<string> {
  const target = path.resolve(options.output);
  if (options.split === "all") {
    if (target !== FORMAL_REPORT_PATH) throw new Error("SUGGESTION_CLI_FORMAL_OUTPUT_INVALID");
    await assertControlledPath(PROJECT_ROOT, path.dirname(target), true);
  } else {
    const temporaryRoot = path.resolve(os.tmpdir());
    await assertControlledPath(temporaryRoot, path.dirname(target), true);
  }
  await assertTargetAbsent(target);
  return target;
}

async function jsonFile(file: string, errorCode: string): Promise<Readonly<{ value: Record<string, unknown>; sha256: string }>> {
  const content = await readFile(file);
  let value: unknown;
  try {
    value = JSON.parse(content.toString("utf8"));
  } catch {
    throw new Error(errorCode);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorCode);
  return Object.freeze({ value: value as Record<string, unknown>, sha256: sha256Hex(content) });
}

async function packageVersion(): Promise<string> {
  const metadata = await jsonFile(path.join(PROJECT_ROOT, "package.json"), "PACKAGE_METADATA_INVALID");
  const version = metadata.value.version;
  if (version !== "0.1.0-alpha.44") throw new Error("PACKAGE_VERSION_INVALID");
  return version;
}

async function fileSha(relative: string): Promise<string> {
  const file = path.join(PROJECT_ROOT, relative);
  await assertControlledPath(PROJECT_ROOT, file, true);
  return sha256Hex(await readFile(file));
}

async function sourceArtifacts(): Promise<Readonly<Record<string, string>>> {
  const entries = await Promise.all([
    "app/lib/ai-governance-suggestion-selfhost/adapter.ts",
    "app/lib/ai-governance-suggestion-selfhost/config.ts",
    "app/lib/ai-governance-suggestion-selfhost/types.ts",
    "app/lib/material-governance-selfhost/engine.ts",
    "app/lib/material-governance-selfhost/config.ts",
    "app/lib/material-governance-selfhost/types.ts",
  ].map(async (relative) => [relative, await fileSha(relative)] as const));
  return Object.freeze(Object.fromEntries(entries));
}

function assertReportSafe(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (/"(?:input|expected)"\s*:/.test(serialized)) throw new Error("SUGGESTION_REPORT_FORBIDDEN_SAMPLE_BODY");
  const prohibited = [
    /\bBearer\s+[A-Za-z0-9._~-]+/i,
    /\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{8,}/i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /(?:\+?86[- ]?)?1[3-9]\d{9}/,
  ];
  if (prohibited.some((pattern) => pattern.test(serialized))) throw new Error("SUGGESTION_REPORT_SENSITIVE_CONTENT");
}

async function writeExclusiveReport(target: string, report: Record<string, unknown>): Promise<void> {
  const content = canonicalPrettyJson(report);
  const handle = await open(target, "wx", 0o600);
  try {
    await handle.chmod(0o600);
    await handle.writeFile(content, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function runSuggestionLayerCli(argv: readonly string[]): Promise<Readonly<{
  output: string;
  result_digest: string;
  threshold_status: string;
}>> {
  const options = parseArguments(argv);
  const output = await resolveOutput(options);
  const migrationSha256 = await fileSha("drizzle-postgres/0041_ai_governance_suggestion_evidence.sql");
  if (migrationSha256 !== FROZEN_MIGRATION_0041_SHA256) throw new Error("MIGRATION_0041_IDENTITY_INVALID");
  const dataset = await loadApprovedSuggestionLayerDataset(options.dataset, options.split);
  let alpha43: Readonly<{ value: Record<string, unknown>; sha256: string }> | undefined;
  if (options.split === "all") {
    alpha43 = await jsonFile(ALPHA43_REPORT_PATH, "ALPHA43_REPORT_INVALID");
    if (alpha43.sha256 !== FROZEN_ALPHA43_REPORT_SHA256) throw new Error("ALPHA43_REPORT_IDENTITY_INVALID");
  }
  const report = await evaluateSuggestionLayerDataset(dataset, {
    candidate_source_revision: options.candidateSourceRevision,
    harness_revision: options.harnessRevision,
    package_version: await packageVersion(),
    migration_0041_sha256: migrationSha256,
    source_artifacts: await sourceArtifacts(),
    ...(alpha43 ? { alpha43_report: alpha43.value, alpha43_report_sha256: alpha43.sha256 } : {}),
  });
  assertReportSafe(report);
  await writeExclusiveReport(output, report);
  const status = report.status as Record<string, unknown>;
  return Object.freeze({
    output,
    result_digest: String(report.result_digest),
    threshold_status: String(status.threshold_status),
  });
}

async function main(): Promise<void> {
  try {
    const result = await runSuggestionLayerCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify({
      output: result.output,
      result_digest: result.result_digest,
      threshold_status: result.threshold_status,
    })}\n`);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SUGGESTION_CLI_FAILED";
    process.stderr.write(`${JSON.stringify({ error: code })}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();

export const SUGGESTION_LAYER_FORMAL_REPORT_PATH = FORMAL_REPORT_PATH;
export const SUGGESTION_LAYER_MIGRATION_0041_PATH = MIGRATION_0041_PATH;
