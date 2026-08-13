import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runLocalDeterministicSuggestion } from "../app/lib/ai-governance-suggestion-selfhost/adapter.ts";
import {
  loadApprovedSuggestionLayerDataset,
  loadSuggestionLayerDatasetDirectory,
} from "../tools/ai-governance-evaluation/suggestion-layer-dataset.ts";
import {
  APPROVED_CANDIDATE_SOURCE_REVISION,
  evaluateSuggestionLayerDataset,
  FROZEN_MIGRATION_0041_SHA256,
  verifySuggestionLayerReport,
} from "../tools/ai-governance-evaluation/suggestion-layer-evaluator.ts";
import {
  projectSuggestionLayerInput,
  SYNTHETIC_REFERENCE_CATALOG_DIGEST,
  SYNTHETIC_REFERENCE_CATALOG_VERSION,
} from "../tools/ai-governance-evaluation/suggestion-layer-projection.ts";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATASET_DIRECTORY = path.join(PROJECT_ROOT, "evals/ai-governance/material-v1");

async function calibrationDataset() {
  return loadApprovedSuggestionLayerDataset("material-v1", "calibration");
}

function byScenario(dataset, scenario) {
  const sample = dataset.samples.calibration.find((entry) => entry.scenario === scenario);
  assert.ok(sample, `missing calibration scenario ${scenario}`);
  return sample;
}

function projectionFor(sample) {
  return projectSuggestionLayerInput(Object.freeze({
    sample_id: sample.sample_id,
    capability: sample.capability,
    input: sample.input,
  }));
}

test("calibration loader does not require or open the unavailable second split", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "suggestion-layer-dataset-"));
  const fixtureDirectory = path.join(temporaryRoot, "material-v1");
  await mkdir(fixtureDirectory);
  try {
    await Promise.all(["manifest.json", "calibration.jsonl"].map(async (file) => {
      await writeFile(path.join(fixtureDirectory, file), await readFile(path.join(DATASET_DIRECTORY, file)));
    }));
    const dataset = await loadSuggestionLayerDatasetDirectory(fixtureDirectory, temporaryRoot, "calibration");
    assert.equal(dataset.samples.calibration.length, 32);
    assert.deepEqual(dataset.opened_files.map((entry) => entry.file), ["manifest.json", "calibration.jsonl"]);
    assert.equal(Object.hasOwn(dataset.samples, "holdout"), false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("projection input rejects any label or expectation surface", async () => {
  const dataset = await calibrationDataset();
  const sample = byScenario(dataset, "positive_explicit_hint");
  let expectationRead = false;
  const value = {
    sample_id: sample.sample_id,
    capability: sample.capability,
    input: sample.input,
  };
  Object.defineProperty(value, "expected", {
    enumerable: true,
    get() {
      expectationRead = true;
      throw new Error("EXPECTATION_READ");
    },
  });
  assert.throws(() => projectSuggestionLayerInput(value), /SUGGESTION_PROJECTION_INPUT_KEYS_INVALID/);
  assert.equal(expectationRead, false);
});

test("harness source has no old baseline, expected access, or frozen sample-id branch", async () => {
  const files = [
    "suggestion-layer-dataset.ts",
    "suggestion-layer-projection.ts",
    "suggestion-layer-evaluator.ts",
    "suggestion-layer-cli.ts",
  ];
  const source = (await Promise.all(files.map((file) => readFile(
    path.join(PROJECT_ROOT, "tools/ai-governance-evaluation", file),
    "utf8",
  )))).join("\n");
  assert.doesNotMatch(source, /runDeterministicBaseline/);
  assert.doesNotMatch(source, /\.expected\b/);
  assert.doesNotMatch(source, /SYN-(?:CAL|HOLD)-\d{3}/);
  assert.match(SYNTHETIC_REFERENCE_CATALOG_VERSION, /^synthetic-ai-suggestion-reference-catalog-v1$/);
  assert.match(SYNTHETIC_REFERENCE_CATALOG_DIGEST, /^[0-9a-f]{64}$/);
});

test("real adapter receives stable category and strict identity projections", async () => {
  const dataset = await calibrationDataset();
  const classification = projectionFor(byScenario(dataset, "positive_explicit_hint"));
  const firstCategory = runLocalDeterministicSuggestion(classification.snapshot, "CLASSIFICATION");
  const secondCategory = runLocalDeterministicSuggestion(classification.snapshot, "CLASSIFICATION");
  assert.equal(firstCategory.disposition, "SUGGEST");
  assert.deepEqual(firstCategory, secondCategory);

  const exact = projectionFor(byScenario(dataset, "unique_exact_identity_match"));
  const exactResult = runLocalDeterministicSuggestion(exact.snapshot, "MATERIAL_MATCH");
  assert.equal(exactResult.disposition, "SUGGEST");
  assert.equal(exactResult.items.length, 1);
  assert.equal(
    exact.context.material_candidate_by_id.get(exactResult.items[0].materialId),
    byScenario(dataset, "unique_exact_identity_match").input.candidate_catalog[0].candidate_id,
  );

  const blocked = projectionFor(byScenario(dataset, "customer_specific_conflict_abstain"));
  assert.equal(runLocalDeterministicSuggestion(blocked.snapshot, "MATERIAL_MATCH").disposition, "ABSTAIN");
  assert.equal(blocked.context.scope_blocked_candidate_ids.length, 1);
});

test("requested attribute absent from adapter output remains field-level abstention evidence", async () => {
  const dataset = await calibrationDataset();
  const projection = projectionFor(byScenario(dataset, "missing_dielectric_field_abstention"));
  const candidate = runLocalDeterministicSuggestion(projection.snapshot, "ATTRIBUTE_EXTRACTION");
  assert.equal(candidate.disposition, "SUGGEST");
  const emitted = candidate.items.map((item) => projection.context.attribute_by_id.get(item.attributeDefinitionId));
  assert.equal(emitted.includes("DIELECTRIC"), false);
  assert.equal(projection.context.requested_fields.includes("DIELECTRIC"), true);
});

test("supplier projection preserves inactive fact and lifecycle abstention boundaries", async () => {
  const dataset = await calibrationDataset();
  const inactiveFact = projectionFor(byScenario(dataset, "inactive_supplier_fact_abstain"));
  assert.equal(runLocalDeterministicSuggestion(inactiveFact.snapshot, "SUPPLIER_MAPPING").disposition, "ABSTAIN");
  assert.equal(inactiveFact.context.supplier_inactive_fact_candidate_ids.length, 1);

  const frozen = projectionFor(byScenario(dataset, "frozen_mapping_candidate_abstain"));
  assert.equal(runLocalDeterministicSuggestion(frozen.snapshot, "SUPPLIER_MAPPING").disposition, "ABSTAIN");
  assert.equal(frozen.context.lifecycle_blocked_candidate_ids.length, 1);
});

test("calibration-only alpha.46 candidate passes frozen D-111 verifier without sample bodies", async () => {
  const dataset = await calibrationDataset();
  const report = await evaluateSuggestionLayerDataset(dataset, {
    candidate_source_revision: APPROVED_CANDIDATE_SOURCE_REVISION,
    harness_revision: "a".repeat(40),
    package_version: "0.1.0-alpha.47",
    migration_0041_sha256: FROZEN_MIGRATION_0041_SHA256,
    source_artifacts: Object.freeze({ fixture: "b".repeat(64) }),
    evaluation_run_id: "00000000-0000-4000-a000-000000000001",
    generated_at: "2000-01-01T00:00:00.000Z",
  });
  assert.equal(report.threshold_assessment.result, "D-111_PASS");
  assert.equal(report.overall.failure_count, 0);
  assert.equal(report.dataset.sample_count, 32);
  assert.equal(report.dataset.opened_files.some((entry) => entry.file === "holdout.jsonl"), false);
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /"(?:input|expected)"\s*:/);
  const verification = verifySuggestionLayerReport(report);
  assert.equal(verification.valid, true);
  assert.equal(verification.recomputed_threshold_assessment.result, "D-111_PASS");
});
