import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runDeterministicBaseline } from "../tools/ai-governance-evaluation/baselines.ts";
import { canonicalDigest, canonicalJson, sha256Hex } from "../tools/ai-governance-evaluation/canonical.ts";
import { evaluateDataset, resultDigestForReport } from "../tools/ai-governance-evaluation/evaluator.ts";
import { criticalSafetyViolations, ratio, scoreEvaluation } from "../tools/ai-governance-evaluation/metrics.ts";
import {
  DatasetValidationError,
  loadApprovedDataset,
  loadDatasetDirectory,
  manifestDatasetDigest,
  parseEvaluationSample,
  scanProhibitedData,
} from "../tools/ai-governance-evaluation/schema.ts";

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATASET_DIRECTORY = path.join(SITE_ROOT, "evals", "ai-governance", "material-v1");
const SOURCE_REVISION = "432551b1c8dbf9213954d57a77f0b022c843227e";

function mutableClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function errorCode(expected) {
  return (error) => error instanceof DatasetValidationError && error.code === expected;
}

async function temporaryDataset() {
  const root = await mkdtemp(path.join(tmpdir(), "phase4-task02-dataset-"));
  const directory = path.join(root, "material-v1");
  await cp(DATASET_DIRECTORY, directory, { recursive: true });
  return { root, directory };
}

async function refreshManifestSplit(directory, split) {
  const manifestPath = path.join(directory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const splitContent = await readFile(path.join(directory, `${split}.jsonl`));
  manifest.splits[split].sha256 = sha256Hex(splitContent);
  manifest.dataset_digest = manifestDatasetDigest(manifest);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function walkFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

test("material-v1 manifest, digests, global IDs, split sizes, and strata are valid", async () => {
  const dataset = await loadApprovedDataset("material-v1");
  assert.equal(dataset.manifest.schema, "AI_GOVERNANCE_DATASET_MANIFEST_V1");
  assert.equal(dataset.manifest.dataset_id, "synthetic-material-governance-v1");
  assert.equal(dataset.manifest.version, "1.0.0");
  assert.equal(dataset.manifest.dataset_digest, "4bde669dd59a3cbb239fcd4f9b62f7e8eccfd2b6921d45cb0545503ba4a34adb");
  assert.equal(manifestDatasetDigest(dataset.manifest), dataset.manifest.dataset_digest);
  assert.equal(dataset.manifest.splits.calibration.sha256, "d251271991566a877ee721392e39c9e0c8be1afcede47fa868aeb0376133ed95");
  assert.equal(dataset.manifest.splits.holdout.sha256, "73e3d84337609d87e0b554fefb531c25c1f39a5ad74998500b7ee21bf633bde3");

  const all = [...dataset.samples.calibration, ...dataset.samples.holdout];
  assert.equal(dataset.samples.calibration.length, 32);
  assert.equal(dataset.samples.holdout.length, 32);
  assert.equal(new Set(all.map((sample) => sample.sample_id)).size, 64);
  for (const split of ["calibration", "holdout"]) {
    for (const capability of ["CLASSIFICATION", "ATTRIBUTE_EXTRACTION", "MATERIAL_MATCH", "SUPPLIER_MAPPING"]) {
      assert.equal(dataset.samples[split].filter((sample) => sample.capability === capability).length, 8);
    }
  }
  assert.deepEqual(
    new Set(all.map((sample) => sample.material_category)),
    new Set(["RES", "CAP", "IND", "IC", "CON", "OSC", "MECH", "OTHER", "UNKNOWN"]),
  );
  const coverageText = canonicalJson(all);
  for (const required of [
    "near_value",
    "conflict",
    "multiple",
    "missing",
    "equivalent_unit",
    "incompatible_unit",
    "duplicate",
    "frozen",
    "inactive",
    "customer_specific",
    "illegal_negative",
    "unknown_schema",
    "abnormal_length",
    "prompt_injection",
    "abstention",
  ]) assert.match(coverageText, new RegExp(required, "i"));
});

test("dataset is synthetic/deidentified and contains no prohibited identity or secret patterns", async () => {
  const dataset = await loadApprovedDataset("material-v1");
  const all = [...dataset.samples.calibration, ...dataset.samples.holdout];
  assert.ok(all.every((sample) => sample.synthetic && sample.deidentified));
  assert.deepEqual(all.flatMap((sample) => scanProhibitedData(sample)), []);

  const raw = `${await readFile(path.join(DATASET_DIRECTORY, "calibration.jsonl"), "utf8")}${await readFile(path.join(DATASET_DIRECTORY, "holdout.jsonl"), "utf8")}`;
  for (const pattern of [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b(?:https?|ftp):\/\//i,
    /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
    /(?:\+?86[- ]?)?1[3-9]\d{9}/,
    /有限公司|股份公司|集团公司/,
    /\b(?:PO|RFQ|UAT)[-_]?\d{3,}\b/i,
    /\bBearer\s+[A-Za-z0-9._~-]+/i,
  ]) assert.doesNotMatch(raw, pattern);
});

test("runtime schema rejects unknown fields, broken references, and non-synthetic identities", async () => {
  const dataset = await loadApprovedDataset("material-v1");
  const classification = mutableClone(dataset.samples.calibration.find((sample) => sample.capability === "CLASSIFICATION"));
  classification.unknown_field = true;
  assert.throws(() => parseEvaluationSample(classification), errorCode("SAMPLE_UNKNOWN_FIELD"));

  const match = mutableClone(dataset.samples.calibration.find((sample) => sample.capability === "MATERIAL_MATCH"));
  match.expected.candidate_ids = ["SYN_CANDIDATE_DOES_NOT_EXIST"];
  match.allowed_action = "SUGGEST";
  match.safety_gate_expectation.must_abstain = false;
  assert.throws(() => parseEvaluationSample(match), errorCode("SAMPLE_EXPECTED_CANDIDATE_REFERENCE_BROKEN"));

  const identity = mutableClone(dataset.samples.calibration[0]);
  identity.input.source.sourceKey = "REAL_SOURCE_001";
  assert.throws(() => parseEvaluationSample(identity), errorCode("SAMPLE_SOURCE_IDENTITY_NOT_SYNTHETIC"));
});

test("tamper, manifest mismatch, reorder, duplicate ID, traversal, and symlink fail closed", async (t) => {
  await t.test("split content tamper without manifest update", async () => {
    const fixture = await temporaryDataset();
    try {
      const file = path.join(fixture.directory, "calibration.jsonl");
      const raw = await readFile(file, "utf8");
      await writeFile(file, raw.replace("SYN_CAL_CLASS_001", "SYN_CAL_CLASS_X01"), "utf8");
      await assert.rejects(loadDatasetDirectory(fixture.directory, fixture.root), errorCode("DATASET_SPLIT_DIGEST_MISMATCH"));
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test("manifest projection tamper", async () => {
    const fixture = await temporaryDataset();
    try {
      const file = path.join(fixture.directory, "manifest.json");
      const manifest = JSON.parse(await readFile(file, "utf8"));
      manifest.version = "1.0.1";
      await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await assert.rejects(loadDatasetDirectory(fixture.directory, fixture.root), errorCode("MANIFEST_DATASET_DIGEST_MISMATCH"));
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test("reordered frozen samples with refreshed digests", async () => {
    const fixture = await temporaryDataset();
    try {
      const file = path.join(fixture.directory, "calibration.jsonl");
      const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
      [lines[0], lines[1]] = [lines[1], lines[0]];
      await writeFile(file, `${lines.join("\n")}\n`, "utf8");
      await refreshManifestSplit(fixture.directory, "calibration");
      await assert.rejects(loadDatasetDirectory(fixture.directory, fixture.root), errorCode("DATASET_SAMPLE_ORDER_OR_DUPLICATE"));
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test("duplicate sample ID with refreshed digests", async () => {
    const fixture = await temporaryDataset();
    try {
      const file = path.join(fixture.directory, "calibration.jsonl");
      const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
      const first = JSON.parse(lines[0]);
      const second = JSON.parse(lines[1]);
      second.sample_id = first.sample_id;
      lines[1] = JSON.stringify(second);
      await writeFile(file, `${lines.join("\n")}\n`, "utf8");
      await refreshManifestSplit(fixture.directory, "calibration");
      await assert.rejects(loadDatasetDirectory(fixture.directory, fixture.root), errorCode("DATASET_SAMPLE_ORDER_OR_DUPLICATE"));
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  await assert.rejects(loadApprovedDataset("../material-v1"), errorCode("DATASET_NAME_NOT_APPROVED"));
  await assert.rejects(loadApprovedDataset("https://example.invalid/material-v1"), errorCode("DATASET_NAME_NOT_APPROVED"));

  await t.test("dataset directory symlink", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "phase4-task02-symlink-"));
    try {
      const link = path.join(root, "material-v1");
      await symlink(DATASET_DIRECTORY, link, "dir");
      await assert.rejects(loadDatasetDirectory(link, root), errorCode("SYMLINK_NOT_ALLOWED"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("all four deterministic calibration baselines emit governed metadata and score contracts", async () => {
  const dataset = await loadApprovedDataset("material-v1");
  const samples = dataset.samples.calibration;
  const results = samples.map(runDeterministicBaseline);
  const repeated = samples.map(runDeterministicBaseline);
  assert.ok(results.every((result) => result.provider === "LOCAL_DETERMINISTIC"));
  assert.ok(results.every((result) => result.model_id === "NONE" && result.prompt_version === "NONE"));
  assert.ok(results.every((result) => result.rule_version === "bom-material-governance-v1"));
  assert.ok(results.every((result) => result.evaluator_version === "ai-governance-evaluator-v1"));
  assert.ok(results.every((result) => result.formal_actions.length === 0 && !result.bypasses_human_review));

  const scored = scoreEvaluation(samples, results, repeated);
  assert.equal(scored.sample_count, 32);
  assert.equal(scored.stable_reproduction.value, "1.000000");
  const capabilities = scored.metrics.capabilities;
  assert.equal(capabilities.length, 4);
  for (const capability of capabilities) {
    assert.equal(capability.sample_count, 8);
    assert.equal(capability.decision_exact_match.denominator, "8");
  }
  assert.ok(capabilities.find((entry) => entry.capability === "CLASSIFICATION").classification);
  assert.ok(capabilities.find((entry) => entry.capability === "ATTRIBUTE_EXTRACTION").attribute_extraction);
  assert.ok(capabilities.find((entry) => entry.capability === "MATERIAL_MATCH").material_match);
  assert.ok(capabilities.find((entry) => entry.capability === "SUPPLIER_MAPPING").supplier_mapping);
});

test("abstention, zero denominator, top-k recall, and error candidate rate remain explicit", async () => {
  const dataset = await loadApprovedDataset("material-v1");
  const abstainSample = dataset.samples.calibration.find((sample) => sample.capability === "CLASSIFICATION" && sample.allowed_action === "ABSTAIN");
  const abstainResult = runDeterministicBaseline(abstainSample);
  const abstainScore = scoreEvaluation([abstainSample], [abstainResult], [abstainResult]);
  assert.deepEqual(abstainScore.metrics.abstention.rate, ratio(1, 1));
  assert.deepEqual(abstainScore.metrics.coverage.rate, ratio(0, 1));
  assert.deepEqual(abstainScore.metrics.covered_accuracy, ratio(0, 0));
  assert.equal(abstainScore.metrics.covered_accuracy.defined, false);
  assert.equal(abstainScore.metrics.covered_accuracy.value, "0.000000");

  const sample = dataset.samples.calibration.find((entry) => entry.capability === "MATERIAL_MATCH" && entry.expected.candidate_ids.length === 1);
  const baseline = runDeterministicBaseline(sample);
  const expected = sample.expected.candidate_ids[0];
  const wrong = sample.input.candidate_catalog.find((candidate) => candidate.candidate_id !== expected).candidate_id;
  const ranked = Object.freeze({ ...baseline, action: "SUGGEST", candidate_ids: Object.freeze([wrong, expected]) });
  const rankedScore = scoreEvaluation([sample], [ranked], [ranked]);
  const metrics = rankedScore.metrics.capabilities.find((entry) => entry.capability === "MATERIAL_MATCH").material_match;
  assert.deepEqual(metrics.top_1_recall, ratio(0, 1));
  assert.deepEqual(metrics.top_3_recall, ratio(1, 1));
  assert.deepEqual(metrics.error_candidate_rate, ratio(1, 2));
  assert.equal(metrics.emitted_candidate_count, 2);
  assert.equal(metrics.incorrect_candidate_count, 1);
});

test("critical safety violations are counted and force unsafe output into failures", async () => {
  const dataset = await loadApprovedDataset("material-v1");
  const sample = dataset.samples.calibration.find((entry) => entry.allowed_action === "ABSTAIN");
  const safe = runDeterministicBaseline(sample);
  const unsafe = Object.freeze({
    ...safe,
    action: "SUGGEST",
    category: "RES",
    formal_actions: Object.freeze(["CREATE_FORMAL_MAPPING"]),
    bypasses_human_review: true,
    external_transmission_intent: true,
    overrides_deterministic_gate: true,
  });
  assert.deepEqual(criticalSafetyViolations(sample, unsafe), [
    "CONSUMABLE_RESULT_WHEN_ABSTENTION_REQUIRED",
    "DETERMINISTIC_GATE_OVERRIDE",
    "FORMAL_WRITE_ACTION_OUTPUT",
    "HUMAN_REVIEW_BYPASS",
    "UNAUTHORIZED_EXTERNAL_TRANSMISSION",
  ]);
  const scored = scoreEvaluation([sample], [unsafe], [unsafe]);
  assert.equal(scored.metrics.critical_safety_violations, 5);
  assert.equal(scored.critical_safety_violations.length, 1);
  assert.equal(scored.failures.length, 1);
});

test("canonical JSON and calibration report result digests are stable across run IDs and time", async () => {
  assert.equal(canonicalJson({ z: 1, a: { d: 2, b: 3 } }), '{"a":{"b":3,"d":2},"z":1}');
  assert.equal(canonicalDigest({ b: 2, a: 1 }), canonicalDigest({ a: 1, b: 2 }));
  const dataset = await loadApprovedDataset("material-v1");
  const first = await evaluateDataset(dataset, {
    source_revision: SOURCE_REVISION,
    selection: "calibration",
    evaluation_run_id: "SYN-EVAL-RUN-ONE",
    generated_at: "2026-08-10T11:00:00.000Z",
  });
  const second = await evaluateDataset(dataset, {
    source_revision: SOURCE_REVISION,
    selection: "calibration",
    evaluation_run_id: "SYN-EVAL-RUN-TWO",
    generated_at: "2026-08-10T12:00:00.000Z",
  });
  assert.notEqual(first.evaluation_run_id, second.evaluation_run_id);
  assert.equal(first.result_digest, second.result_digest);
  assert.equal(resultDigestForReport(first), first.result_digest);
  assert.equal(first.schema, "AI_GOVERNANCE_EVALUATION_REPORT_V1");
  assert.deepEqual(first.status, {
    dataset_integrity: "PASS",
    critical_safety_gate: "PASS",
    accuracy_measurement: "MEASURED",
    threshold_status: "UNAPPROVED",
    release_decision: "NOT_AUTHORIZED",
  });
  assert.deepEqual(Object.keys(first.splits), ["calibration"]);
});

test("runtime app does not import evaluator/data and evaluator does not read credentials", async () => {
  const appFiles = (await walkFiles(path.join(SITE_ROOT, "app"))).filter((file) => /\.(?:ts|tsx|js|mjs)$/.test(file));
  for (const file of appFiles) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /tools\/ai-governance-evaluation|evals\/ai-governance/, file);
  }
  const evaluatorFiles = await walkFiles(path.join(SITE_ROOT, "tools", "ai-governance-evaluation"));
  for (const file of evaluatorFiles) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /DATABASE_URL|process\.env|fetch\s*\(|https?:\/\//, file);
  }
});
