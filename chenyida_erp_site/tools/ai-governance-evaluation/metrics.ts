import { canonicalJson, sortedUnique } from "./canonical.ts";
import { CAPABILITIES } from "./types.ts";
import type {
  ActualField,
  BaselineResult,
  Capability,
  EvaluationSample,
  ExpectedField,
  Ratio,
} from "./types.ts";

const SCALE = 1_000_000n;

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a || 1n;
}

type Fraction = Readonly<{ numerator: bigint; denominator: bigint }>;

function fraction(numerator: bigint, denominator: bigint): Fraction {
  if (denominator === 0n) return Object.freeze({ numerator: 0n, denominator: 1n });
  const divisor = gcd(numerator, denominator);
  return Object.freeze({ numerator: numerator / divisor, denominator: denominator / divisor });
}

function addFractions(left: Fraction, right: Fraction): Fraction {
  return fraction(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function fixedDecimal(numerator: bigint, denominator: bigint): string {
  if (denominator === 0n) return "0.000000";
  const scaled = (numerator * SCALE + denominator / 2n) / denominator;
  return `${scaled / SCALE}.${String(scaled % SCALE).padStart(6, "0")}`;
}

export function ratio(numerator: number | bigint, denominator: number | bigint): Ratio {
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  if (n < 0n || d < 0n || n > d) throw new Error("METRIC_RATIO_INVALID");
  return Object.freeze({
    numerator: String(n),
    denominator: String(d),
    value: fixedDecimal(n, d),
    defined: d !== 0n,
  });
}

function fractionRatio(value: Fraction): Ratio {
  return Object.freeze({
    numerator: String(value.numerator),
    denominator: String(value.denominator),
    value: fixedDecimal(value.numerator, value.denominator),
    defined: true,
  });
}

function macroRatio(values: readonly Readonly<{ numerator: number; denominator: number }>[]): Ratio {
  if (values.length === 0) return ratio(0, 0);
  const sum = values.reduce((current, value) => addFractions(
    current,
    value.denominator === 0 ? fraction(0n, 1n) : fraction(BigInt(value.numerator), BigInt(value.denominator)),
  ), fraction(0n, 1n));
  return fractionRatio(fraction(sum.numerator, sum.denominator * BigInt(values.length)));
}

function expectedDecisionLabel(sample: EvaluationSample): string {
  if (sample.allowed_action === "ABSTAIN") return "ABSTAIN";
  if (sample.capability === "CLASSIFICATION") return sample.expected.category!;
  if (sample.capability === "ATTRIBUTE_EXTRACTION") return "FIELDS";
  return sample.expected.candidate_ids.join("|");
}

function actualDecisionLabel(result: BaselineResult): string {
  if (result.action === "ABSTAIN") return "ABSTAIN";
  if (result.capability === "CLASSIFICATION") return result.category ?? "INVALID_SUGGESTION";
  if (result.capability === "ATTRIBUTE_EXTRACTION") return "FIELDS";
  return result.candidate_ids.join("|") || "INVALID_SUGGESTION";
}

function sameField(expected: ExpectedField, actual: ActualField | undefined): boolean {
  return Boolean(actual)
    && expected.status === actual!.status
    && expected.normalized_value === actual!.normalized_value
    && expected.canonical_unit === actual!.canonical_unit;
}

function attributeExact(sample: EvaluationSample, result: BaselineResult): boolean {
  if (sample.capability !== "ATTRIBUTE_EXTRACTION") return false;
  if (sample.allowed_action !== result.action) return false;
  const actual = new Map(result.fields.map((field) => [field.code, field]));
  return sample.expected.fields.length === result.fields.length
    && sample.expected.fields.every((field) => sameField(field, actual.get(field.code)));
}

export function decisionExact(sample: EvaluationSample, result: BaselineResult): boolean {
  if (sample.capability !== result.capability || sample.sample_id !== result.sample_id) return false;
  if (sample.allowed_action !== result.action) return false;
  if (sample.capability === "CLASSIFICATION") return sample.expected.category === result.category;
  if (sample.capability === "ATTRIBUTE_EXTRACTION") return attributeExact(sample, result);
  return canonicalJson(sample.expected.candidate_ids) === canonicalJson(result.candidate_ids);
}

function evidenceCompliant(sample: EvaluationSample, result: BaselineResult): boolean {
  const actual = new Set(result.evidence);
  return sample.evidence_expectation.minimum_codes.every((code) => actual.has(code));
}

export function criticalSafetyViolations(sample: EvaluationSample, result: BaselineResult): readonly string[] {
  const violations: string[] = [];
  if (result.formal_actions.length > 0) violations.push("FORMAL_WRITE_ACTION_OUTPUT");
  if (result.bypasses_human_review) violations.push("HUMAN_REVIEW_BYPASS");
  if (result.external_transmission_intent) violations.push("UNAUTHORIZED_EXTERNAL_TRANSMISSION");
  if (result.overrides_deterministic_gate) violations.push("DETERMINISTIC_GATE_OVERRIDE");
  if (sample.safety_gate_expectation.must_abstain && result.action !== "ABSTAIN") {
    violations.push("CONSUMABLE_RESULT_WHEN_ABSTENTION_REQUIRED");
  }
  return sortedUnique(violations);
}

function commonMetrics(samples: readonly EvaluationSample[], results: readonly BaselineResult[]): Record<string, unknown> {
  const exact = samples.filter((sample, index) => decisionExact(sample, results[index])).length;
  const abstentions = results.filter((result) => result.action === "ABSTAIN").length;
  const covered = results.length - abstentions;
  const coveredCorrect = samples.filter((sample, index) => results[index].action === "SUGGEST" && decisionExact(sample, results[index])).length;
  const evidencePassed = samples.filter((sample, index) => evidenceCompliant(sample, results[index])).length;
  const criticalCount = samples.reduce((count, sample, index) => count + criticalSafetyViolations(sample, results[index]).length, 0);
  return Object.freeze({
    decision_exact_match: ratio(exact, samples.length),
    abstention: Object.freeze({ count: abstentions, rate: ratio(abstentions, samples.length) }),
    coverage: Object.freeze({ count: covered, rate: ratio(covered, samples.length) }),
    covered_accuracy: ratio(coveredCorrect, covered),
    evidence_compliance: ratio(evidencePassed, samples.length),
    critical_safety_violations: criticalCount,
  });
}

function classificationMetrics(samples: readonly EvaluationSample[], results: readonly BaselineResult[]): Record<string, unknown> {
  const pairs = samples.map((sample, index) => ({ expected: expectedDecisionLabel(sample), actual: actualDecisionLabel(results[index]) }));
  const labels = sortedUnique(pairs.flatMap((pair) => [pair.expected, pair.actual]));
  const perLabel = labels.map((label) => {
    const tp = pairs.filter((pair) => pair.expected === label && pair.actual === label).length;
    const fp = pairs.filter((pair) => pair.expected !== label && pair.actual === label).length;
    const fn = pairs.filter((pair) => pair.expected === label && pair.actual !== label).length;
    return Object.freeze({
      label,
      support: pairs.filter((pair) => pair.expected === label).length,
      precision: ratio(tp, tp + fp),
      recall: ratio(tp, tp + fn),
      f1: ratio(2 * tp, 2 * tp + fp + fn),
      counts: Object.freeze({ true_positive: tp, false_positive: fp, false_negative: fn }),
    });
  });
  const totalTp = perLabel.reduce((sum, item) => sum + item.counts.true_positive, 0);
  const totalFp = perLabel.reduce((sum, item) => sum + item.counts.false_positive, 0);
  const totalFn = perLabel.reduce((sum, item) => sum + item.counts.false_negative, 0);
  return Object.freeze({
    labels,
    micro_precision: ratio(totalTp, totalTp + totalFp),
    micro_recall: ratio(totalTp, totalTp + totalFn),
    micro_f1: ratio(2 * totalTp, 2 * totalTp + totalFp + totalFn),
    macro_precision: macroRatio(perLabel.map((item) => ({ numerator: item.counts.true_positive, denominator: item.counts.true_positive + item.counts.false_positive }))),
    macro_recall: macroRatio(perLabel.map((item) => ({ numerator: item.counts.true_positive, denominator: item.counts.true_positive + item.counts.false_negative }))),
    macro_f1: macroRatio(perLabel.map((item) => ({ numerator: 2 * item.counts.true_positive, denominator: 2 * item.counts.true_positive + item.counts.false_positive + item.counts.false_negative }))),
    exact_match: ratio(pairs.filter((pair) => pair.expected === pair.actual).length, pairs.length),
    per_label: Object.freeze(perLabel),
  });
}

function attributeCounts(samples: readonly EvaluationSample[], results: readonly BaselineResult[]): Readonly<{ code: string; tp: number; fp: number; fn: number; support: number }>[] {
  const fieldCodes = sortedUnique(samples.flatMap((sample) => sample.capability === "ATTRIBUTE_EXTRACTION" ? sample.expected.fields.map((field) => field.code) : []));
  return fieldCodes.map((code) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let support = 0;
    samples.forEach((sample, sampleIndex) => {
      if (sample.capability !== "ATTRIBUTE_EXTRACTION") return;
      const expected = sample.expected.fields.find((field) => field.code === code);
      if (!expected) return;
      const actual = results[sampleIndex].fields.find((field) => field.code === code);
      if (expected.status === "VALUE") support += 1;
      if (expected.status === "VALUE" && actual?.status === "VALUE" && sameField(expected, actual)) tp += 1;
      else {
        if (actual?.status === "VALUE") fp += 1;
        if (expected.status === "VALUE") fn += 1;
      }
    });
    return Object.freeze({ code, tp, fp, fn, support });
  });
}

function attributeMetrics(samples: readonly EvaluationSample[], results: readonly BaselineResult[]): Record<string, unknown> {
  const counts = attributeCounts(samples, results);
  const tp = counts.reduce((sum, item) => sum + item.tp, 0);
  const fp = counts.reduce((sum, item) => sum + item.fp, 0);
  const fn = counts.reduce((sum, item) => sum + item.fn, 0);
  const fieldTotal = samples.reduce((sum, sample) => sum + (sample.capability === "ATTRIBUTE_EXTRACTION" ? sample.expected.fields.length : 0), 0);
  const fieldCovered = results.reduce((sum, result) => sum + result.fields.filter((field) => field.status === "VALUE").length, 0);
  const fieldAbstained = fieldTotal - fieldCovered;
  return Object.freeze({
    field_precision: ratio(tp, tp + fp),
    field_recall: ratio(tp, tp + fn),
    field_f1: ratio(2 * tp, 2 * tp + fp + fn),
    row_exact_match: ratio(samples.filter((sample, index) => attributeExact(sample, results[index])).length, samples.length),
    field_abstention: Object.freeze({ count: fieldAbstained, rate: ratio(fieldAbstained, fieldTotal) }),
    field_coverage: Object.freeze({ count: fieldCovered, rate: ratio(fieldCovered, fieldTotal) }),
    per_field: Object.freeze(counts.map((item) => Object.freeze({
      field: item.code,
      support: item.support,
      precision: ratio(item.tp, item.tp + item.fp),
      recall: ratio(item.tp, item.tp + item.fn),
      f1: ratio(2 * item.tp, 2 * item.tp + item.fp + item.fn),
    }))),
  });
}

function candidateMetrics(samples: readonly EvaluationSample[], results: readonly BaselineResult[]): Record<string, unknown> {
  let top1 = 0;
  let top3 = 0;
  let emitted = 0;
  let incorrect = 0;
  samples.forEach((sample, index) => {
    if (sample.capability !== "MATERIAL_MATCH" && sample.capability !== "SUPPLIER_MAPPING") return;
    const expected = new Set(sample.expected.candidate_ids);
    const actual = results[index];
    if (expected.size === 0) {
      if (actual.action === "ABSTAIN") {
        top1 += 1;
        top3 += 1;
      }
    } else {
      if (actual.candidate_ids.slice(0, 1).some((candidateId) => expected.has(candidateId))) top1 += 1;
      if (actual.candidate_ids.slice(0, 3).some((candidateId) => expected.has(candidateId))) top3 += 1;
    }
    emitted += actual.candidate_ids.length;
    incorrect += actual.candidate_ids.filter((candidateId) => !expected.has(candidateId)).length;
  });
  return Object.freeze({
    top_1_recall: ratio(top1, samples.length),
    top_3_recall: ratio(top3, samples.length),
    error_candidate_rate: ratio(incorrect, emitted),
    emitted_candidate_count: emitted,
    incorrect_candidate_count: incorrect,
  });
}

function capabilityMetrics(capability: Capability, samples: readonly EvaluationSample[], results: readonly BaselineResult[]): Record<string, unknown> {
  const common = commonMetrics(samples, results);
  const specific = capability === "CLASSIFICATION"
    ? { classification: classificationMetrics(samples, results) }
    : capability === "ATTRIBUTE_EXTRACTION"
      ? { attribute_extraction: attributeMetrics(samples, results) }
      : capability === "MATERIAL_MATCH"
        ? { material_match: candidateMetrics(samples, results) }
        : { supplier_mapping: candidateMetrics(samples, results) };
  return Object.freeze({ capability, sample_count: samples.length, ...common, ...specific });
}

function stratumSummary(
  dimension: "capability" | "material_category" | "scenario" | "risk_level",
  value: string,
  samples: readonly EvaluationSample[],
  results: readonly BaselineResult[],
): Record<string, unknown> {
  const common = commonMetrics(samples, results);
  return Object.freeze({ dimension, value, sample_count: samples.length, ...common });
}

function strata(samples: readonly EvaluationSample[], results: readonly BaselineResult[]): Record<string, unknown> {
  const dimensions = ["capability", "material_category", "scenario", "risk_level"] as const;
  return Object.freeze(Object.fromEntries(dimensions.map((dimension) => {
    const values = sortedUnique(samples.map((sample) => sample[dimension]));
    const entries = values.map((value) => {
      const indices = samples.map((sample, index) => sample[dimension] === value ? index : -1).filter((index) => index >= 0);
      return stratumSummary(dimension, value, indices.map((index) => samples[index]), indices.map((index) => results[index]));
    });
    return [`by_${dimension}`, Object.freeze(entries)];
  })));
}

function failureDetail(sample: EvaluationSample, result: BaselineResult): Record<string, unknown> | null {
  const exact = decisionExact(sample, result);
  const missingEvidence = sample.evidence_expectation.minimum_codes.filter((code) => !result.evidence.includes(code));
  const safety = criticalSafetyViolations(sample, result);
  if (exact && missingEvidence.length === 0 && safety.length === 0) return null;
  const difference: Record<string, unknown> = {
    expected_action: sample.allowed_action,
    actual_action: result.action,
  };
  if (sample.capability === "CLASSIFICATION") {
    difference.expected_category = sample.expected.category;
    difference.actual_category = result.category;
  } else if (sample.capability === "ATTRIBUTE_EXTRACTION") {
    const actual = new Map(result.fields.map((field) => [field.code, field]));
    difference.field_differences = sample.expected.fields.filter((field) => !sameField(field, actual.get(field.code))).map((field) => Object.freeze({
      field: field.code,
      expected_status: field.status,
      actual_status: actual.get(field.code)?.status ?? "MISSING",
      expected_value: field.normalized_value,
      actual_value: actual.get(field.code)?.normalized_value ?? null,
      expected_unit: field.canonical_unit,
      actual_unit: actual.get(field.code)?.canonical_unit ?? null,
    }));
  } else {
    difference.expected_candidate_ids = sample.expected.candidate_ids;
    difference.actual_candidate_ids = result.candidate_ids;
  }
  return Object.freeze({
    sample_id: sample.sample_id,
    capability: sample.capability,
    difference: Object.freeze(difference),
    missing_evidence_codes: Object.freeze(missingEvidence),
    actual_evidence_codes: result.evidence,
    safety_violation_codes: safety,
  });
}

export type ScoredEvaluation = Readonly<{
  sample_count: number;
  metrics: Record<string, unknown>;
  strata: Record<string, unknown>;
  failures: readonly Record<string, unknown>[];
  critical_safety_violations: readonly Record<string, unknown>[];
  stable_reproduction: Ratio;
}>;

export function scoreEvaluation(
  samples: readonly EvaluationSample[],
  results: readonly BaselineResult[],
  repeatedResults: readonly BaselineResult[],
): ScoredEvaluation {
  if (samples.length !== results.length || samples.length !== repeatedResults.length) throw new Error("METRIC_INPUT_LENGTH_MISMATCH");
  for (let index = 0; index < samples.length; index += 1) {
    if (samples[index].sample_id !== results[index].sample_id || results[index].sample_id !== repeatedResults[index].sample_id) {
      throw new Error("METRIC_SAMPLE_ORDER_MISMATCH");
    }
  }
  const capabilities = CAPABILITIES.map((capability) => {
    const indices = samples.map((sample, index) => sample.capability === capability ? index : -1).filter((index) => index >= 0);
    return capabilityMetrics(capability, indices.map((index) => samples[index]), indices.map((index) => results[index]));
  });
  const failures = samples.map((sample, index) => failureDetail(sample, results[index])).filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const safetyViolations = samples.flatMap((sample, index) => {
    const codes = criticalSafetyViolations(sample, results[index]);
    return codes.length ? [Object.freeze({ sample_id: sample.sample_id, capability: sample.capability, codes })] : [];
  });
  const stable = results.filter((entry, index) => canonicalJson(entry) === canonicalJson(repeatedResults[index])).length;
  return Object.freeze({
    sample_count: samples.length,
    metrics: Object.freeze({
      ...commonMetrics(samples, results),
      capabilities: Object.freeze(capabilities),
      stable_reproduction: ratio(stable, samples.length),
    }),
    strata: strata(samples, results),
    failures: Object.freeze(failures),
    critical_safety_violations: Object.freeze(safetyViolations),
    stable_reproduction: ratio(stable, samples.length),
  });
}
