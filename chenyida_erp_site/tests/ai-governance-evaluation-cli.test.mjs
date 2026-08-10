import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(SITE_ROOT, "tools", "ai-governance-evaluation", "cli.ts");
const SOURCE_REVISION = "432551b1c8dbf9213954d57a77f0b022c843227e";
const SAFE_ENVIRONMENT = Object.freeze({ PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin" });

async function runCli(arguments_) {
  return execFileAsync(process.execPath, ["--experimental-strip-types", CLI, ...arguments_], {
    cwd: SITE_ROOT,
    env: SAFE_ENVIRONMENT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}

async function expectCliFailure(arguments_, expectedCode) {
  try {
    await runCli(arguments_);
    assert.fail(`CLI unexpectedly accepted ${expectedCode}`);
  } catch (error) {
    assert.equal(error.code, 2);
    const lines = error.stderr.trim().split("\n");
    assert.deepEqual(JSON.parse(lines.at(-1)), {
      schema: "AI_GOVERNANCE_EVALUATOR_ERROR_V1",
      code: expectedCode,
    });
  }
}

test("CLI evaluates calibration without network/database credentials and emits deidentified JSON", async () => {
  const { stdout } = await runCli([
    "--dataset", "material-v1",
    "--split", "calibration",
    "--source-revision", SOURCE_REVISION,
  ]);
  const report = JSON.parse(stdout);
  assert.equal(report.schema, "AI_GOVERNANCE_EVALUATION_REPORT_V1");
  assert.deepEqual(report.dataset.selected_splits, ["calibration"]);
  assert.equal(report.dataset.sample_count, 32);
  assert.equal(report.baseline.provider, "LOCAL_DETERMINISTIC");
  assert.equal(report.baseline.model_id, "NONE");
  assert.equal(report.baseline.package_version, "0.1.0-alpha.44");
  assert.equal(report.status.threshold_status, "UNAPPROVED");
  assert.equal(report.status.release_decision, "NOT_AUTHORIZED");
  assert.doesNotMatch(stdout, /DATABASE_URL|Bearer\s|api[_-]?key/i);
});

test("CLI writes once to an approved task temp directory and rejects overwrite", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "phase4-task02-cli-"));
  try {
    const output = path.join(directory, "calibration-report.json");
    const { stdout } = await runCli([
      "--dataset", "material-v1",
      "--split", "calibration",
      "--source-revision", SOURCE_REVISION,
      "--output", output,
    ]);
    assert.equal(stdout, "");
    const report = JSON.parse(await readFile(output, "utf8"));
    assert.equal(report.dataset.sample_count, 32);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    await expectCliFailure([
      "--dataset", "material-v1",
      "--split", "calibration",
      "--source-revision", SOURCE_REVISION,
      "--output", output,
    ], "OUTPUT_ALREADY_EXISTS");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI rejects dataset traversal, URLs, output escape, and output symlinks", async () => {
  await expectCliFailure([
    "--dataset", "../material-v1",
    "--split", "calibration",
    "--source-revision", SOURCE_REVISION,
  ], "DATASET_NAME_NOT_APPROVED");
  await expectCliFailure([
    "--dataset", "https://example.invalid/material-v1",
    "--split", "calibration",
    "--source-revision", SOURCE_REVISION,
  ], "DATASET_NAME_NOT_APPROVED");
  await expectCliFailure([
    "--dataset", "material-v1",
    "--split", "calibration",
    "--source-revision", SOURCE_REVISION,
    "--output", path.join(tmpdir(), "unapproved-evaluation.json"),
  ], "OUTPUT_PATH_NOT_APPROVED");

  const directory = await mkdtemp(path.join(tmpdir(), "phase4-task02-cli-symlink-"));
  try {
    const output = path.join(directory, "report.json");
    await symlink(path.join(directory, "target.json"), output);
    await expectCliFailure([
      "--dataset", "material-v1",
      "--split", "calibration",
      "--source-revision", SOURCE_REVISION,
      "--output", output,
    ], "OUTPUT_SYMLINK_NOT_ALLOWED");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
