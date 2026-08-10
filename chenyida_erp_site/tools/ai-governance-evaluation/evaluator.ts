import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MATERIAL_GOVERNANCE_RULE_VERSION } from "../../app/lib/material-governance-selfhost/config.ts";
import { runDeterministicBaseline } from "./baselines.ts";
import { canonicalDigest } from "./canonical.ts";
import { scoreEvaluation } from "./metrics.ts";
import { EVALUATOR_VERSION, REPORT_SCHEMA, SPLITS } from "./types.ts";
import type { EvaluationSample, EvaluationSplit, LoadedDataset } from "./types.ts";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export type EvaluationSelection = EvaluationSplit | "all";

export type EvaluationMetadata = Readonly<{
  source_revision: string;
  selection: EvaluationSelection;
  evaluation_run_id?: string;
  generated_at?: string;
}>;

function selectedSplits(selection: EvaluationSelection): readonly EvaluationSplit[] {
  return selection === "all" ? SPLITS : Object.freeze([selection]);
}

async function packageVersion(): Promise<string> {
  const raw = await readFile(path.join(PROJECT_ROOT, "package.json"), "utf8");
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PACKAGE_METADATA_INVALID");
  const version = (value as Record<string, unknown>).version;
  if (typeof version !== "string" || !/^0\.1\.0-alpha\.\d+$/.test(version)) throw new Error("PACKAGE_VERSION_INVALID");
  return version;
}

function scoreSamples(samples: readonly EvaluationSample[]) {
  const first = samples.map(runDeterministicBaseline);
  const repeated = samples.map(runDeterministicBaseline);
  return scoreEvaluation(samples, first, repeated);
}

function stableProjection(report: Record<string, unknown>): Record<string, unknown> {
  const stable = { ...report };
  delete stable.evaluation_run_id;
  delete stable.generated_at;
  delete stable.result_digest;
  return stable;
}

export async function evaluateDataset(dataset: LoadedDataset, metadata: EvaluationMetadata): Promise<Record<string, unknown>> {
  if (!/^[0-9a-f]{40}$/.test(metadata.source_revision)) throw new Error("SOURCE_REVISION_INVALID");
  if (![...SPLITS, "all"].includes(metadata.selection)) throw new Error("EVALUATION_SELECTION_INVALID");
  const splits = selectedSplits(metadata.selection);
  const splitReports = Object.fromEntries(splits.map((split) => [split, scoreSamples(dataset.samples[split])]));
  const combinedSamples = splits.flatMap((split) => dataset.samples[split]);
  const overall = scoreSamples(combinedSamples);
  const safetyViolationCount = overall.critical_safety_violations.reduce((sum, entry) => {
    const codes = entry.codes;
    return sum + (Array.isArray(codes) ? codes.length : 0);
  }, 0);
  const report: Record<string, unknown> = {
    schema: REPORT_SCHEMA,
    evaluation_run_id: metadata.evaluation_run_id ?? randomUUID(),
    generated_at: metadata.generated_at ?? new Date().toISOString(),
    dataset: Object.freeze({
      dataset_id: dataset.manifest.dataset_id,
      version: dataset.manifest.version,
      dataset_digest: dataset.manifest.dataset_digest,
      sample_schema_version: dataset.manifest.sample_schema_version,
      deidentification_policy_version: dataset.manifest.deidentification_policy_version,
      holdout_policy: dataset.manifest.holdout_policy,
      selected_splits: splits,
      sample_count: combinedSamples.length,
    }),
    baseline: Object.freeze({
      provider: "LOCAL_DETERMINISTIC",
      model_id: "NONE",
      prompt_version: "NONE",
      rule_version: MATERIAL_GOVERNANCE_RULE_VERSION,
      evaluator_version: EVALUATOR_VERSION,
      package_version: await packageVersion(),
      source_revision: metadata.source_revision,
    }),
    execution_environment: Object.freeze({
      runtime: "node",
      node_version: process.version,
      platform: process.platform,
      architecture: process.arch,
      network_required: false,
      database_required: false,
    }),
    status: Object.freeze({
      dataset_integrity: "PASS",
      critical_safety_gate: safetyViolationCount === 0 ? "PASS" : "FAIL",
      accuracy_measurement: "MEASURED",
      threshold_status: "UNAPPROVED",
      release_decision: "NOT_AUTHORIZED",
    }),
    splits: Object.freeze(splitReports),
    overall,
  };
  report.result_digest = canonicalDigest(stableProjection(report));
  return Object.freeze(report);
}

export function resultDigestForReport(report: Record<string, unknown>): string {
  return canonicalDigest(stableProjection(report));
}
