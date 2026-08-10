import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(PROJECT_ROOT, "tools/ai-governance-evaluation/suggestion-layer-cli.ts");
const CANDIDATE_REVISION = "218ef1b483cbd915c6e83013d7193e37c53a0eb1";
const HARNESS_REVISION = "a".repeat(40);

function invoke(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", CLI, ...args], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=384" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function calibrationArgs(output) {
  return [
    "--dataset", "material-v1",
    "--split", "calibration",
    "--candidate-source-revision", CANDIDATE_REVISION,
    "--harness-revision", HARNESS_REVISION,
    "--output", output,
  ];
}

test("calibration CLI writes a mode-0600 report and refuses overwrite", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "suggestion-layer-cli-"));
  const output = path.join(temporary, "calibration-report.json");
  try {
    const first = await invoke(calibrationArgs(output));
    assert.equal(first.code, 0, first.stderr);
    const summary = JSON.parse(first.stdout);
    assert.equal(summary.threshold_status, "D-111_PASS");
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    const report = JSON.parse(await readFile(output, "utf8"));
    assert.equal(report.evaluation_mode, "CALIBRATION_PREFLIGHT_ONLY");
    assert.deepEqual(report.dataset.opened_files.map((entry) => entry.file), ["manifest.json", "calibration.jsonl"]);
    assert.equal(report.status.release_decision, "NOT_AUTHORIZED");

    const replay = await invoke(calibrationArgs(output));
    assert.equal(replay.code, 1);
    assert.match(replay.stderr, /SUGGESTION_CLI_OUTPUT_EXISTS/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("CLI rejects a direct second-split selection before dataset loading", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "suggestion-layer-cli-invalid-"));
  try {
    const result = await invoke([
      "--dataset", "material-v1",
      "--split", "holdout",
      "--candidate-source-revision", CANDIDATE_REVISION,
      "--harness-revision", HARNESS_REVISION,
      "--output", path.join(temporary, "invalid.json"),
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /SUGGESTION_CLI_SPLIT_INVALID/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("formal all-splits mode accepts only the frozen report target", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "suggestion-layer-cli-formal-policy-"));
  try {
    const result = await invoke([
      "--dataset", "material-v1",
      "--split", "all",
      "--candidate-source-revision", CANDIDATE_REVISION,
      "--harness-revision", HARNESS_REVISION,
      "--output", path.join(temporary, "not-formal.json"),
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /SUGGESTION_CLI_FORMAL_OUTPUT_INVALID/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
