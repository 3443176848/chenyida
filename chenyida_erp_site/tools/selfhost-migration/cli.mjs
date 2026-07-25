#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { assertMigrationEnvironment, assertWorkspace, assertEmptyFileTarget, parseSafePostgresUrl } from "./environment-guard.mjs";
import { inspectSqliteSource } from "./source-sqlite.mjs";
import { inspectD1ExportSource } from "./source-d1-export.mjs";
import { migrationChecksums, createManifest } from "./manifest.mjs";
import { registryDigest } from "./mapping-registry.mjs";
import { validateAndPlan, issueSummary } from "./validator.mjs";
import { executionInputDigest, executeDryRun, executeSyntheticCommit } from "./executor.mjs";
import { PostgresTargetAdapter } from "./target-postgres.mjs";
import { buildSafeReport, writeSafeJson } from "./report.mjs";
import { newRunId } from "./digest.mjs";
import { safeError, fail } from "./errors.mjs";

function argumentsMap(values) {
  const output = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]; const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) fail("MIGRATION_ARGUMENT_INVALID", "CLI 参数必须使用 --key value");
    output[key.slice(2)] = value;
  }
  return output;
}

async function main() {
  const args = argumentsMap(process.argv.slice(2));
  assertMigrationEnvironment(process.env);
  if (args.confirm !== "SYNTHETIC_MIGRATION_ONLY") fail("MIGRATION_CONFIRMATION_REQUIRED", "需要 --confirm SYNTHETIC_MIGRATION_ONLY");
  if (!new Set(["sqlite", "d1-export"]).has(args["source-kind"])) fail("MIGRATION_ARGUMENT_INVALID", "source-kind 必须为 sqlite 或 d1-export");
  if (!new Set(["dry-run", "synthetic-commit"]).has(args.mode)) fail("MIGRATION_ARGUMENT_INVALID", "mode 必须为 dry-run 或 synthetic-commit");
  const workspace = assertWorkspace(args.workspace);
  assertEmptyFileTarget(args["file-target"]);
  parseSafePostgresUrl(args["database-url"]);
  const source = args["source-kind"] === "sqlite" ? await inspectSqliteSource(args.source) : await inspectD1ExportSource(args.source);
  const migrationsDirectory = resolve(process.cwd(), "drizzle-postgres");
  const targetMigrations = await migrationChecksums(migrationsDirectory);
  const mappingDigest = registryDigest();
  const plan = validateAndPlan(source, mappingDigest);
  const inputDigest = executionInputDigest({ source, mappingDigest, targetMigrations, plan });
  const runId = args["run-id"] || newRunId();
  const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: resolve(process.cwd(), ".."), encoding: "utf8" }).trim();
  const manifest = await createManifest({ runId, source, targetGitCommit: gitCommit, targetMigrations, executionMode: args.mode === "dry-run" ? "DRY_RUN" : "SYNTHETIC_COMMIT", counts: plan.counts, issues: issueSummary(plan.issues) });
  const target = new PostgresTargetAdapter(args["database-url"]);
  try {
    const targetInfo = await target.inspect(targetMigrations, { requireEmpty: true });
    let result;
    if (args.mode === "dry-run") result = await executeDryRun({ workspace, inputDigest, plan });
    else result = await executeSyntheticCommit({ workspace, inputDigest, runId, source, plan, target, manifest, interruptAfterDomain: args["interrupt-after-domain"] || "" });
    manifest.checkpoint_digest = result.checkpoint?.digest || "";
    manifest.reconciliation_summary = result.reconciliation || {};
    await writeSafeJson(workspace, "manifest.json", manifest);
    const report = buildSafeReport({ runId, state: result.state, manifest, plan, checkpoint: result.checkpoint, reconciliation: result.reconciliation });
    await writeSafeJson(workspace, "report.json", report);
    console.log(JSON.stringify({ run_id: runId, state: result.state, grade: report.result_grade, source_records: plan.rows.length, issues: plan.issues.length, target_schema_foreign_key_constraints: targetInfo.businessForeignKeyCount }));
    if (result.state === "BLOCKED") process.exitCode = 3;
  } finally { await target.close(); }
}

main().catch((error) => {
  console.error(JSON.stringify(safeError(error)));
  process.exitCode = 1;
});
