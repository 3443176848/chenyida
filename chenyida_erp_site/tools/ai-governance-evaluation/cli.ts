#!/usr/bin/env node
import { lstat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { canonicalPrettyJson } from "./canonical.ts";
import { evaluateDataset } from "./evaluator.ts";
import type { EvaluationSelection } from "./evaluator.ts";
import { assertControlledPath, DatasetValidationError, loadApprovedDataset } from "./schema.ts";

class CliError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "CliError";
    this.code = code;
  }
}

type CliOptions = Readonly<{
  dataset: string;
  split: EvaluationSelection;
  sourceRevision: string;
  output: string | null;
}>;

function parseArguments(argv: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  const allowed = new Set(["--dataset", "--split", "--source-revision", "--output"]);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || value === undefined || value.startsWith("--") || values.has(flag)) throw new CliError("CLI_ARGUMENT_INVALID");
    values.set(flag, value);
  }
  const dataset = values.get("--dataset") ?? "material-v1";
  const split = values.get("--split") ?? "all";
  const sourceRevision = values.get("--source-revision");
  if (!["calibration", "holdout", "all"].includes(split)) throw new CliError("CLI_SPLIT_INVALID");
  if (!sourceRevision || !/^[0-9a-f]{40}$/.test(sourceRevision)) throw new CliError("CLI_SOURCE_REVISION_REQUIRED");
  return Object.freeze({
    dataset,
    split: split as EvaluationSelection,
    sourceRevision,
    output: values.get("--output") ?? null,
  });
}

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function validateOutputPath(rawPath: string, datasetDirectory: string): Promise<string> {
  if (!rawPath || rawPath.includes("\u0000") || /^[a-z][a-z0-9+.-]*:/i.test(rawPath)) throw new CliError("OUTPUT_PATH_INVALID");
  const output = path.resolve(rawPath);
  if (path.extname(output) !== ".json") throw new CliError("OUTPUT_PATH_INVALID");
  const reportRoot = path.join(datasetDirectory, "reports");
  const temporaryRoot = path.resolve(tmpdir());
  let approvedRoot: string;
  if (within(reportRoot, output)) {
    approvedRoot = reportRoot;
    await assertControlledPath(datasetDirectory, reportRoot, true);
  } else if (within(temporaryRoot, output)) {
    const relative = path.relative(temporaryRoot, output);
    if (!relative.split(path.sep)[0]?.startsWith("phase4-task02-")) throw new CliError("OUTPUT_PATH_NOT_APPROVED");
    approvedRoot = temporaryRoot;
  } else {
    throw new CliError("OUTPUT_PATH_NOT_APPROVED");
  }
  const parent = path.dirname(output);
  await assertControlledPath(approvedRoot, parent, true);
  try {
    const stat = await lstat(output);
    if (stat.isSymbolicLink()) throw new CliError("OUTPUT_SYMLINK_NOT_ALLOWED");
    throw new CliError("OUTPUT_ALREADY_EXISTS");
  } catch (error) {
    const systemError = error as NodeJS.ErrnoException;
    if (systemError.code !== "ENOENT") throw error;
  }
  return output;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const dataset = await loadApprovedDataset(options.dataset);
  const report = await evaluateDataset(dataset, {
    source_revision: options.sourceRevision,
    selection: options.split,
  });
  const output = canonicalPrettyJson(report);
  if (options.output) {
    const target = await validateOutputPath(options.output, dataset.directory);
    await writeFile(target, output, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } else {
    process.stdout.write(output);
  }
  const status = report.status as Record<string, unknown>;
  if (status.critical_safety_gate !== "PASS") process.exitCode = 3;
}

main().catch((error: unknown) => {
  const code = error instanceof DatasetValidationError || error instanceof CliError
    ? error.code
    : error instanceof Error && /^[A-Z][A-Z0-9_]{2,99}$/.test(error.message)
      ? error.message
      : "EVALUATION_INTERNAL_ERROR";
  process.stderr.write(`${JSON.stringify({ schema: "AI_GOVERNANCE_EVALUATOR_ERROR_V1", code })}\n`);
  process.exitCode = 2;
});
