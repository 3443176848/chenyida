import { randomUUID } from "node:crypto";

import { runLocalDeterministicSuggestion } from "../../app/lib/ai-governance-suggestion-selfhost/adapter.ts";
import {
  AI_SUGGESTION_APPROVED_CONTRACT,
  AI_SUGGESTION_CONFIG_DIGEST,
  AI_SUGGESTION_CONTRACT_DIGEST,
  AI_SUGGESTION_PARAMETER_DIGEST,
  AI_SUGGESTION_RULE_VERSION,
  AI_SUGGESTION_SCHEMA_DIGEST,
  AI_SUGGESTION_SOURCE_REVISION,
  AI_SUGGESTION_THRESHOLD_PROFILE,
} from "../../app/lib/ai-governance-suggestion-selfhost/config.ts";
import type {
  AiSuggestionCandidate,
  AiSuggestionItemCandidate,
} from "../../app/lib/ai-governance-suggestion-selfhost/types.ts";
import { canonicalDigest, canonicalJson, sortedUnique } from "./canonical.ts";
import {
  FROZEN_CALIBRATION_FILE_SHA256,
  FROZEN_DATASET_DIGEST,
  FROZEN_DATASET_ID,
  FROZEN_DATASET_VERSION,
  FROZEN_HOLDOUT_FILE_SHA256,
  FROZEN_MANIFEST_FILE_SHA256,
} from "./suggestion-layer-dataset.ts";
import type { LoadedSuggestionLayerDataset } from "./suggestion-layer-dataset.ts";
import {
  projectSuggestionLayerInput,
  SUGGESTION_LAYER_PROJECTION_CONTRACT_DIGEST,
  SUGGESTION_LAYER_PROJECTION_VERSION,
  SYNTHETIC_REFERENCE_CATALOG_DIGEST,
  SYNTHETIC_REFERENCE_CATALOG_VERSION,
} from "./suggestion-layer-projection.ts";
import type { SuggestionProjectionContext } from "./suggestion-layer-projection.ts";
import { ratio, scoreEvaluation } from "./metrics.ts";
import { EVALUATOR_VERSION } from "./types.ts";
import type {
  ActualField,
  BaselineResult,
  Capability,
  EvaluationSample,
  EvaluationSplit,
  Ratio,
} from "./types.ts";

export const SUGGESTION_REVALIDATION_REPORT_SCHEMA = "AI_GOVERNANCE_SUGGESTION_REVALIDATION_REPORT_V1";
export const SUGGESTION_LAYER_EVALUATOR_VERSION = "deterministic-suggestion-layer-evaluator-v1";
export const APPROVED_CANDIDATE_SOURCE_REVISION = "218ef1b483cbd915c6e83013d7193e37c53a0eb1";
export const UNDERLYING_EVALUATOR_SOURCE_REVISION = "d69f6dff795377109244e788c2ffee73ef6194ec";
export const FROZEN_ALPHA43_REPORT_SHA256 = "e2ed87e629633d09ae5de079e105d82e74a393a8c13ab8817fdf04a93d0b8a5e";
export const FROZEN_MIGRATION_0041_SHA256 = "676626b9dcb78f31643612e5662cf5c36e06259c72ff922287bb913394071bf2";
const RULE_EVIDENCE = `RULE_VERSION_${AI_SUGGESTION_RULE_VERSION.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;

type Observation = Readonly<{
  sample: EvaluationSample;
  firstCandidate: AiSuggestionCandidate;
  repeatedCandidate: AiSuggestionCandidate;
  firstResult: BaselineResult;
  repeatedResult: BaselineResult;
  integrity: SampleIntegrity;
}>;

type SampleIntegrity = Readonly<{
  item_without_evidence_count: number;
  suggestion_without_evidence_count: number;
  capability_item_mismatch_count: number;
  abstain_with_item_count: number;
  suggest_without_item_count: number;
  non_null_confidence_count: number;
  formal_action_count: number;
  bypass_human_review_count: number;
  external_transmission_intent_count: number;
  deterministic_gate_override_count: number;
  unmapped_reference_count: number;
  raw_reproduction_match: boolean;
}>;

export type SuggestionLayerEvaluationMetadata = Readonly<{
  candidate_source_revision: string;
  harness_revision: string;
  package_version: string;
  migration_0041_sha256: string;
  source_artifacts: Readonly<Record<string, string>>;
  alpha43_report?: Record<string, unknown>;
  alpha43_report_sha256?: string;
  evaluation_run_id?: string;
  generated_at?: string;
}>;

type ThresholdCriterion = Readonly<{
  code: string;
  actual: string | number;
  required: string;
  pass: boolean;
}>;

export type ThresholdAssessment = Readonly<{
  profile: typeof AI_SUGGESTION_THRESHOLD_PROFILE;
  criteria: readonly ThresholdCriterion[];
  pass: boolean;
  result: "D-111_PASS" | "D-111_FAIL";
}>;

function actualFieldValue(item: AiSuggestionItemCandidate): string | null {
  if (item.valueText !== undefined) return item.valueText;
  if (item.valueInteger !== undefined) return String(item.valueInteger);
  if (item.valueDecimal !== undefined) return item.valueDecimal;
  if (item.valueBoolean !== undefined) return item.valueBoolean ? "true" : "false";
  if (item.valueDate !== undefined) return item.valueDate;
  return null;
}

function evidenceCodes(
  capability: Capability,
  candidate: AiSuggestionCandidate,
  context: SuggestionProjectionContext,
): readonly string[] {
  const codes = new Set<string>(["LOCAL_DETERMINISTIC_RULE", RULE_EVIDENCE]);
  if (candidate.abstainReasonCode) codes.add(candidate.abstainReasonCode);
  for (const item of candidate.items) {
    for (const entry of item.evidence) {
      if (entry.ruleTraceCode) codes.add(entry.ruleTraceCode);
      if (entry.governanceSpecId !== undefined) {
        for (const code of context.spec_evidence_by_id.get(entry.governanceSpecId) ?? []) codes.add(code);
      }
    }
  }

  if (capability === "CLASSIFICATION") {
    const categoryItem = candidate.items.find((item) => item.itemKind === "CLASSIFICATION");
    const category = categoryItem?.categoryId === undefined ? undefined : context.category_by_id.get(categoryItem.categoryId);
    if (candidate.disposition === "SUGGEST" && category) {
      codes.add(`CATEGORY_${category}`);
      codes.add("CLASSIFICATION_UNIQUE_RULE_RESULT");
    }
    if (candidate.disposition === "ABSTAIN") {
      codes.add("CLASSIFICATION_ABSTAIN");
      codes.add(`CATEGORY_${context.governed_category}`);
      context.governance_issue_evidence.forEach((code) => codes.add(code));
    }
  } else if (capability === "ATTRIBUTE_EXTRACTION") {
    const emitted = new Set(candidate.items.flatMap((item) => {
      if (item.itemKind !== "ATTRIBUTE_EXTRACTION" || item.attributeDefinitionId === undefined) return [];
      const code = context.attribute_by_id.get(item.attributeDefinitionId);
      return code ? [code] : [];
    }));
    for (const code of context.requested_fields) {
      if (emitted.has(code)) {
        codes.add(`FIELD_${code}_RULE_VALUE`);
      } else {
        codes.add(`FIELD_${code}_ABSTAIN`);
        for (const issueCode of context.issue_evidence_by_component.get(code) ?? []) codes.add(issueCode);
        for (const issueCode of context.issue_evidence_by_component.get("CATEGORY") ?? []) codes.add(issueCode);
      }
    }
  } else if (capability === "MATERIAL_MATCH") {
    if (candidate.disposition === "SUGGEST") {
      codes.add("IDENTITY_DIGEST_EQUAL");
      codes.add("UNIQUE_EXACT_CANDIDATE");
      codes.add("CANDIDATE_LIFECYCLE_ACTIVE");
      codes.add("CUSTOMER_SCOPE_ALLOWED");
    } else if (!context.query_identity_available) {
      codes.add("QUERY_IDENTITY_UNAVAILABLE");
      context.governance_issue_evidence.forEach((code) => codes.add(code));
    } else {
      if (context.exact_candidate_ids.length > 1) {
        codes.add("EXACT_IDENTITY_CANDIDATE_AMBIGUOUS");
      } else if (context.lifecycle_blocked_candidate_ids.length > 0 && context.active_scope_allowed_exact_candidate_ids.length === 0) {
        codes.add("CANDIDATE_LIFECYCLE_BLOCKED");
      } else if (context.scope_blocked_candidate_ids.length > 0 && context.scope_allowed_exact_candidate_ids.length === 0) {
        codes.add("CUSTOMER_SCOPE_CONFLICT");
      }
      if (context.exact_candidate_ids.length === 0) codes.add("EXACT_IDENTITY_CANDIDATE_NOT_FOUND");
    }
  } else {
    if (candidate.disposition === "SUGGEST") {
      codes.add("SUPPLIER_IDENTITY_EXACT");
      codes.add("SUPPLIER_PART_FACT_EXACT");
      codes.add("IDENTITY_DIGEST_EQUAL");
      codes.add("UNIQUE_EXACT_CANDIDATE");
      codes.add("CANDIDATE_LIFECYCLE_ACTIVE");
      codes.add("CUSTOMER_SCOPE_ALLOWED");
    } else if (!context.query_identity_available) {
      codes.add("QUERY_IDENTITY_UNAVAILABLE");
      context.governance_issue_evidence.forEach((code) => codes.add(code));
    } else {
      if (context.supplier_matching_fact_candidate_ids.length === 0) {
        codes.add("SUPPLIER_PART_FACT_NOT_FOUND");
      } else if (context.supplier_matching_fact_candidate_ids.length > 1) {
        codes.add("SUPPLIER_PART_FACT_AMBIGUOUS");
      } else if (context.supplier_inactive_fact_candidate_ids.length > 0
        && context.supplier_active_fact_candidate_ids.length === 0) {
        codes.add("SUPPLIER_PART_FACT_INACTIVE");
      } else if (context.supplier_fact_lifecycle_blocked_candidate_ids.length > 0) {
        codes.add("CANDIDATE_LIFECYCLE_BLOCKED");
      } else if (context.supplier_fact_scope_blocked_candidate_ids.length > 0) {
        codes.add("CUSTOMER_SCOPE_CONFLICT");
      } else if (context.supplier_spec_conflict_candidate_ids.length > 0) {
        codes.add("SUPPLIER_FACT_SPECIFICATION_CONFLICT");
      }
    }
  }
  return sortedUnique([...codes]);
}

function toMetricResult(
  sample: EvaluationSample,
  candidate: AiSuggestionCandidate,
  context: SuggestionProjectionContext,
): BaselineResult {
  const categoryItem = candidate.items.find((item) => item.itemKind === "CLASSIFICATION");
  const category = categoryItem?.categoryId === undefined
    ? null
    : context.category_by_id.get(categoryItem.categoryId) ?? null;
  const attributeItems = new Map(candidate.items.flatMap((item) => {
    if (item.itemKind !== "ATTRIBUTE_EXTRACTION" || item.attributeDefinitionId === undefined) return [];
    const code = context.attribute_by_id.get(item.attributeDefinitionId);
    return code ? [[code, item] as const] : [];
  }));
  const fields: ActualField[] = sample.capability === "ATTRIBUTE_EXTRACTION"
    ? sample.input.target_fields.map((code): ActualField => {
      const item = attributeItems.get(code);
      const value = item ? actualFieldValue(item) : null;
      return value === null
        ? Object.freeze({ code, status: "ABSTAIN", normalized_value: null, canonical_unit: null })
        : Object.freeze({ code, status: "VALUE", normalized_value: value, canonical_unit: item!.valueUnitCode ?? null });
    })
    : [];
  const candidateIds = candidate.items
    .filter((item) => item.itemKind === "MATERIAL_MATCH" || item.itemKind === "SUPPLIER_MAPPING")
    .sort((left, right) => left.candidateRank - right.candidateRank)
    .flatMap((item) => item.materialId === undefined ? [] : [context.material_candidate_by_id.get(item.materialId)])
    .filter((candidateId): candidateId is string => Boolean(candidateId));
  return Object.freeze({
    sample_id: sample.sample_id,
    capability: sample.capability,
    action: candidate.disposition,
    category,
    fields: Object.freeze(fields),
    candidate_ids: Object.freeze(candidateIds),
    evidence: evidenceCodes(sample.capability, candidate, context),
    provider: "LOCAL_DETERMINISTIC",
    model_id: "NONE",
    prompt_version: "NONE",
    rule_version: AI_SUGGESTION_RULE_VERSION,
    evaluator_version: EVALUATOR_VERSION,
    formal_actions: Object.freeze([]),
    bypasses_human_review: false,
    external_transmission_intent: false,
    overrides_deterministic_gate: false,
  });
}

function countNamedNonNull(value: unknown, pattern: RegExp): number {
  if (Array.isArray(value)) return value.reduce((sum, entry) => sum + countNamedNonNull(entry, pattern), 0);
  if (!value || typeof value !== "object") return 0;
  return Object.entries(value as Record<string, unknown>).reduce((sum, [key, entry]) =>
    sum + (pattern.test(key) && entry !== null && entry !== undefined ? 1 : 0) + countNamedNonNull(entry, pattern), 0);
}

function sampleIntegrity(
  capability: Capability,
  first: AiSuggestionCandidate,
  repeated: AiSuggestionCandidate,
  context: SuggestionProjectionContext,
): SampleIntegrity {
  const wrongKind = first.items.filter((item) => item.itemKind !== capability).length;
  const unmapped = first.items.filter((item) => {
    if (item.itemKind === "CLASSIFICATION") return item.categoryId === undefined || !context.category_by_id.has(item.categoryId);
    if (item.itemKind === "ATTRIBUTE_EXTRACTION") return item.attributeDefinitionId === undefined || !context.attribute_by_id.has(item.attributeDefinitionId);
    return item.materialId === undefined || !context.material_candidate_by_id.has(item.materialId);
  }).length;
  return Object.freeze({
    item_without_evidence_count: first.items.filter((item) => item.evidence.length === 0).length,
    suggestion_without_evidence_count: first.disposition === "SUGGEST" && first.items.every((item) => item.evidence.length === 0) ? 1 : 0,
    capability_item_mismatch_count: wrongKind,
    abstain_with_item_count: first.disposition === "ABSTAIN" && first.items.length > 0 ? 1 : 0,
    suggest_without_item_count: first.disposition === "SUGGEST" && first.items.length === 0 ? 1 : 0,
    non_null_confidence_count: countNamedNonNull(first, /(?:confidence|score)/i),
    formal_action_count: countNamedNonNull(first, /formal(?:_|)action/i),
    bypass_human_review_count: countNamedNonNull(first, /bypass(?:es|_)?human(?:_|)review/i),
    external_transmission_intent_count: countNamedNonNull(first, /external(?:_|)transmission/i),
    deterministic_gate_override_count: countNamedNonNull(first, /override(?:s|_)?deterministic(?:_|)gate/i),
    unmapped_reference_count: unmapped,
    raw_reproduction_match: canonicalJson(first) === canonicalJson(repeated),
  });
}

function executeSamples(samples: readonly EvaluationSample[]): readonly Observation[] {
  return Object.freeze(samples.map((sample): Observation => {
    const projection = projectSuggestionLayerInput(Object.freeze({
      sample_id: sample.sample_id,
      capability: sample.capability,
      input: sample.input,
    }));
    const firstCandidate = runLocalDeterministicSuggestion(projection.snapshot, sample.capability);
    const repeatedCandidate = runLocalDeterministicSuggestion(projection.snapshot, sample.capability);
    return Object.freeze({
      sample,
      firstCandidate,
      repeatedCandidate,
      firstResult: toMetricResult(sample, firstCandidate, projection.context),
      repeatedResult: toMetricResult(sample, repeatedCandidate, projection.context),
      integrity: sampleIntegrity(sample.capability, firstCandidate, repeatedCandidate, projection.context),
    });
  }));
}

function sumIntegrity(observations: readonly Observation[]): Record<string, unknown> {
  const numericKeys: readonly Exclude<keyof SampleIntegrity, "raw_reproduction_match">[] = Object.freeze([
    "item_without_evidence_count",
    "suggestion_without_evidence_count",
    "capability_item_mismatch_count",
    "abstain_with_item_count",
    "suggest_without_item_count",
    "non_null_confidence_count",
    "formal_action_count",
    "bypass_human_review_count",
    "external_transmission_intent_count",
    "deterministic_gate_override_count",
    "unmapped_reference_count",
  ]);
  const entries = numericKeys.map((key) => [key, observations.reduce((sum, observation) => sum + observation.integrity[key], 0)]);
  const rawMatches = observations.filter((observation) => observation.integrity.raw_reproduction_match).length;
  return Object.freeze({
    ...Object.fromEntries(entries),
    raw_candidate_reproduction: ratio(rawMatches, observations.length),
    raw_reproduction_failure_sample_ids: Object.freeze(observations
      .filter((observation) => !observation.integrity.raw_reproduction_match)
      .map((observation) => observation.sample.sample_id)),
    first_pass_digest: canonicalDigest(observations.map((observation) => ({
      sample_id: observation.sample.sample_id,
      candidate: observation.firstCandidate,
    }))),
    repeated_pass_digest: canonicalDigest(observations.map((observation) => ({
      sample_id: observation.sample.sample_id,
      candidate: observation.repeatedCandidate,
    }))),
  });
}

function scoreObservations(observations: readonly Observation[]): Record<string, unknown> {
  const scored = scoreEvaluation(
    observations.map((observation) => observation.sample),
    observations.map((observation) => observation.firstResult),
    observations.map((observation) => observation.repeatedResult),
  );
  return Object.freeze({
    sample_count: scored.sample_count,
    metrics: scored.metrics,
    strata: scored.strata,
    failure_count: scored.failures.length,
    failure_sample_ids: Object.freeze(scored.failures.map((failure) => String(failure.sample_id))),
    critical_safety_violations: scored.critical_safety_violations,
    stable_reproduction: scored.stable_reproduction,
    adapter_integrity: sumIntegrity(observations),
  });
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function ratioRecord(value: unknown, code: string): Ratio {
  const candidate = record(value, code);
  if (typeof candidate.value !== "string" || typeof candidate.defined !== "boolean"
    || typeof candidate.numerator !== "string" || typeof candidate.denominator !== "string") throw new Error(code);
  return candidate as Ratio;
}

function numeric(recordValue: Record<string, unknown>, key: string): number {
  const value = recordValue[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error("THRESHOLD_METRIC_INVALID");
  return value;
}

function capabilityReport(metrics: Record<string, unknown>, capability: Capability): Record<string, unknown> {
  if (!Array.isArray(metrics.capabilities)) throw new Error("THRESHOLD_CAPABILITIES_INVALID");
  const found = metrics.capabilities.find((entry) => record(entry, "THRESHOLD_CAPABILITY_INVALID").capability === capability);
  if (!found) throw new Error("THRESHOLD_CAPABILITY_MISSING");
  return record(found, "THRESHOLD_CAPABILITY_INVALID");
}

function thresholdCriteria(overall: Record<string, unknown>, prohibitedDataHitCount: number): readonly ThresholdCriterion[] {
  const criteria: ThresholdCriterion[] = [];
  const add = (code: string, actual: string | number, required: string, pass: boolean) => {
    criteria.push(Object.freeze({ code, actual, required, pass }));
  };
  const metrics = record(overall.metrics, "THRESHOLD_OVERALL_METRICS_INVALID");
  const integrity = record(overall.adapter_integrity, "THRESHOLD_INTEGRITY_INVALID");
  const exactOne = (code: string, value: unknown) => {
    const metric = ratioRecord(value, code);
    add(code, metric.value, "1.000000", metric.defined && metric.value === "1.000000");
  };
  const atLeast = (code: string, value: unknown, minimum: string) => {
    const metric = ratioRecord(value, code);
    add(code, metric.value, `>=${minimum}`, metric.defined && metric.value >= minimum);
  };
  const zero = (code: string, value: number) => add(code, value, "0", value === 0);
  const zeroRatioWhenDefined = (code: string, value: unknown) => {
    const metric = ratioRecord(value, code);
    add(code, metric.defined ? metric.value : "undefined", "0.000000 when defined", !metric.defined || metric.value === "0.000000");
  };
  const oneWhenDefined = (code: string, value: unknown) => {
    const metric = ratioRecord(value, code);
    add(code, metric.defined ? metric.value : "undefined", "1.000000 when defined", !metric.defined || metric.value === "1.000000");
  };

  zero("dataset.prohibited_data_hits", prohibitedDataHitCount);
  exactOne("overall.decision_exact_match", metrics.decision_exact_match);
  exactOne("overall.evidence_compliance", metrics.evidence_compliance);
  exactOne("overall.stable_reproduction", metrics.stable_reproduction);
  exactOne("overall.covered_accuracy", metrics.covered_accuracy);
  atLeast("overall.coverage", record(metrics.coverage, "THRESHOLD_COVERAGE_INVALID").rate, "0.500000");
  zero("overall.critical_safety_violations", numeric(metrics, "critical_safety_violations"));
  for (const key of [
    "item_without_evidence_count",
    "suggestion_without_evidence_count",
    "capability_item_mismatch_count",
    "abstain_with_item_count",
    "suggest_without_item_count",
    "non_null_confidence_count",
    "formal_action_count",
    "bypass_human_review_count",
    "external_transmission_intent_count",
    "deterministic_gate_override_count",
    "unmapped_reference_count",
  ]) zero(`integrity.${key}`, numeric(integrity, key));
  exactOne("integrity.raw_candidate_reproduction", integrity.raw_candidate_reproduction);

  const classification = capabilityReport(metrics, "CLASSIFICATION");
  atLeast("classification.coverage", record(classification.coverage, "THRESHOLD_CLASSIFICATION_COVERAGE_INVALID").rate, "0.750000");
  exactOne("classification.decision_exact_match", classification.decision_exact_match);
  exactOne("classification.covered_accuracy", classification.covered_accuracy);
  exactOne("classification.evidence_compliance", classification.evidence_compliance);
  const classificationSpecific = record(classification.classification, "THRESHOLD_CLASSIFICATION_METRICS_INVALID");
  for (const key of ["micro_precision", "micro_recall", "micro_f1", "macro_precision", "macro_recall", "macro_f1", "exact_match"]) {
    oneWhenDefined(`classification.${key}`, classificationSpecific[key]);
  }
  if (!Array.isArray(classificationSpecific.per_label)) throw new Error("THRESHOLD_CLASSIFICATION_LABELS_INVALID");
  for (const entry of classificationSpecific.per_label) {
    const label = record(entry, "THRESHOLD_CLASSIFICATION_LABEL_INVALID");
    for (const key of ["precision", "recall", "f1"]) oneWhenDefined(`classification.label.${String(label.label)}.${key}`, label[key]);
  }

  const attribute = capabilityReport(metrics, "ATTRIBUTE_EXTRACTION");
  atLeast("attribute.record_coverage", record(attribute.coverage, "THRESHOLD_ATTRIBUTE_COVERAGE_INVALID").rate, "0.750000");
  exactOne("attribute.decision_exact_match", attribute.decision_exact_match);
  exactOne("attribute.covered_accuracy", attribute.covered_accuracy);
  exactOne("attribute.evidence_compliance", attribute.evidence_compliance);
  const attributeSpecific = record(attribute.attribute_extraction, "THRESHOLD_ATTRIBUTE_METRICS_INVALID");
  atLeast("attribute.field_coverage", record(attributeSpecific.field_coverage, "THRESHOLD_ATTRIBUTE_FIELD_COVERAGE_INVALID").rate, "0.750000");
  for (const key of ["field_precision", "field_recall", "field_f1", "row_exact_match"]) {
    oneWhenDefined(`attribute.${key}`, attributeSpecific[key]);
  }
  if (!Array.isArray(attributeSpecific.per_field)) throw new Error("THRESHOLD_ATTRIBUTE_FIELDS_INVALID");
  for (const entry of attributeSpecific.per_field) {
    const field = record(entry, "THRESHOLD_ATTRIBUTE_FIELD_INVALID");
    for (const key of ["precision", "recall", "f1"]) oneWhenDefined(`attribute.field.${String(field.field)}.${key}`, field[key]);
  }

  for (const [capability, minimum, metricKey] of [
    ["MATERIAL_MATCH", "0.250000", "material_match"],
    ["SUPPLIER_MAPPING", "0.250000", "supplier_mapping"],
  ] as const) {
    const candidate = capabilityReport(metrics, capability);
    const prefix = capability === "MATERIAL_MATCH" ? "material_match" : "supplier_mapping";
    atLeast(`${prefix}.coverage`, record(candidate.coverage, "THRESHOLD_CANDIDATE_COVERAGE_INVALID").rate, minimum);
    exactOne(`${prefix}.decision_exact_match`, candidate.decision_exact_match);
    exactOne(`${prefix}.covered_accuracy`, candidate.covered_accuracy);
    exactOne(`${prefix}.evidence_compliance`, candidate.evidence_compliance);
    const specific = record(candidate[metricKey], "THRESHOLD_CANDIDATE_METRICS_INVALID");
    oneWhenDefined(`${prefix}.top_1_recall`, specific.top_1_recall);
    oneWhenDefined(`${prefix}.top_3_recall`, specific.top_3_recall);
    zeroRatioWhenDefined(`${prefix}.error_candidate_rate`, specific.error_candidate_rate);
    zero(`${prefix}.incorrect_candidate_count`, numeric(specific, "incorrect_candidate_count"));
  }

  const strata = record(overall.strata, "THRESHOLD_STRATA_INVALID");
  for (const dimension of ["by_capability", "by_material_category", "by_scenario", "by_risk_level"]) {
    const entries = strata[dimension];
    if (!Array.isArray(entries)) throw new Error("THRESHOLD_STRATUM_INVALID");
    for (const entry of entries) {
      const stratum = record(entry, "THRESHOLD_STRATUM_INVALID");
      const prefix = `stratum.${String(stratum.dimension)}.${String(stratum.value)}`;
      exactOne(`${prefix}.decision_exact_match`, stratum.decision_exact_match);
      exactOne(`${prefix}.evidence_compliance`, stratum.evidence_compliance);
      zero(`${prefix}.critical_safety_violations`, numeric(stratum, "critical_safety_violations"));
    }
  }
  return Object.freeze(criteria);
}

export function assessD111Thresholds(overall: Record<string, unknown>, prohibitedDataHitCount: number): ThresholdAssessment {
  const criteria = thresholdCriteria(overall, prohibitedDataHitCount);
  const pass = criteria.every((criterion) => criterion.pass);
  return Object.freeze({
    profile: AI_SUGGESTION_THRESHOLD_PROFILE,
    criteria,
    pass,
    result: pass ? "D-111_PASS" : "D-111_FAIL",
  });
}

function pathValue(root: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const key of path) current = record(current, "COMPARISON_REPORT_INVALID")[key];
  return current;
}

function decimalDelta(previous: string, current: string): string {
  const toScaled = (value: string) => {
    if (!/^\d+\.\d{6}$/.test(value)) throw new Error("COMPARISON_METRIC_INVALID");
    return BigInt(value.replace(".", ""));
  };
  const delta = toScaled(current) - toScaled(previous);
  const absolute = delta < 0n ? -delta : delta;
  return `${delta < 0n ? "-" : "+"}${absolute / 1_000_000n}.${String(absolute % 1_000_000n).padStart(6, "0")}`;
}

function comparisonToAlpha43(
  report: Record<string, unknown>,
  alpha43: Record<string, unknown>,
  alpha43Sha256: string,
): Record<string, unknown> {
  const comparisons: Array<Readonly<{ metric: string; alpha43: string; alpha45: string; delta: string }>> = [];
  const addRatioComparison = (code: string, previousValue: unknown, currentValue: unknown) => {
    if (typeof previousValue !== "string" || typeof currentValue !== "string") throw new Error("COMPARISON_METRIC_INVALID");
    comparisons.push(Object.freeze({
      metric: code,
      alpha43: previousValue,
      alpha45: currentValue,
      delta: decimalDelta(previousValue, currentValue),
    }));
  };
  for (const scope of ["overall", "splits.calibration", "splits.holdout"]) {
    const prefix = scope.split(".");
    for (const [code, tail] of [
      ["decision_exact_match", ["metrics", "decision_exact_match", "value"]],
      ["evidence_compliance", ["metrics", "evidence_compliance", "value"]],
      ["coverage", ["metrics", "coverage", "rate", "value"]],
      ["covered_accuracy", ["metrics", "covered_accuracy", "value"]],
      ["stable_reproduction", ["metrics", "stable_reproduction", "value"]],
    ] as const) addRatioComparison(`${scope}.${code}`, pathValue(alpha43, [...prefix, ...tail]), pathValue(report, [...prefix, ...tail]));

    const previousMetrics = record(pathValue(alpha43, [...prefix, "metrics"]), "COMPARISON_METRICS_INVALID");
    const currentMetrics = record(pathValue(report, [...prefix, "metrics"]), "COMPARISON_METRICS_INVALID");
    for (const capability of ["CLASSIFICATION", "ATTRIBUTE_EXTRACTION", "MATERIAL_MATCH", "SUPPLIER_MAPPING"] as const) {
      const previousCapability = capabilityReport(previousMetrics, capability);
      const currentCapability = capabilityReport(currentMetrics, capability);
      for (const [code, tail] of [
        ["decision_exact_match", ["decision_exact_match", "value"]],
        ["evidence_compliance", ["evidence_compliance", "value"]],
        ["coverage", ["coverage", "rate", "value"]],
        ["covered_accuracy", ["covered_accuracy", "value"]],
      ] as const) {
        addRatioComparison(
          `${scope}.${capability}.${code}`,
          pathValue(previousCapability, tail),
          pathValue(currentCapability, tail),
        );
      }
    }
    const previousAttribute = record(capabilityReport(previousMetrics, "ATTRIBUTE_EXTRACTION").attribute_extraction, "COMPARISON_ATTRIBUTE_INVALID");
    const currentAttribute = record(capabilityReport(currentMetrics, "ATTRIBUTE_EXTRACTION").attribute_extraction, "COMPARISON_ATTRIBUTE_INVALID");
    addRatioComparison(
      `${scope}.ATTRIBUTE_EXTRACTION.field_coverage`,
      pathValue(previousAttribute, ["field_coverage", "rate", "value"]),
      pathValue(currentAttribute, ["field_coverage", "rate", "value"]),
    );
  }
  return Object.freeze({
    report_schema: alpha43.schema,
    report_sha256: alpha43Sha256,
    result_digest: alpha43.result_digest,
    source_revision: record(alpha43.baseline, "COMPARISON_BASELINE_INVALID").source_revision,
    metric_deltas: Object.freeze(comparisons),
  });
}

function stableProjection(report: Record<string, unknown>): Record<string, unknown> {
  const stable = { ...report };
  delete stable.evaluation_run_id;
  delete stable.generated_at;
  delete stable.result_digest;
  return stable;
}

export function resultDigestForSuggestionLayerReport(report: Record<string, unknown>): string {
  return canonicalDigest(stableProjection(report));
}

function assertMetadata(metadata: SuggestionLayerEvaluationMetadata, selection: "calibration" | "all"): void {
  if (metadata.candidate_source_revision !== APPROVED_CANDIDATE_SOURCE_REVISION) throw new Error("CANDIDATE_SOURCE_REVISION_INVALID");
  if (!/^[0-9a-f]{40}$/.test(metadata.harness_revision)) throw new Error("HARNESS_REVISION_INVALID");
  if (metadata.package_version !== "0.1.0-alpha.45") throw new Error("PACKAGE_VERSION_INVALID");
  if (metadata.migration_0041_sha256 !== FROZEN_MIGRATION_0041_SHA256) throw new Error("MIGRATION_0041_IDENTITY_INVALID");
  if (AI_SUGGESTION_SOURCE_REVISION !== UNDERLYING_EVALUATOR_SOURCE_REVISION) throw new Error("UNDERLYING_EVALUATOR_IDENTITY_INVALID");
  if (selection === "all" && (!metadata.alpha43_report || metadata.alpha43_report_sha256 !== FROZEN_ALPHA43_REPORT_SHA256)) {
    throw new Error("ALPHA43_COMPARISON_IDENTITY_INVALID");
  }
}

export async function evaluateSuggestionLayerDataset(
  dataset: LoadedSuggestionLayerDataset,
  metadata: SuggestionLayerEvaluationMetadata,
): Promise<Record<string, unknown>> {
  assertMetadata(metadata, dataset.selection);
  if (dataset.manifest_file_sha256 !== FROZEN_MANIFEST_FILE_SHA256
    || dataset.manifest.dataset_id !== FROZEN_DATASET_ID
    || dataset.manifest.version !== FROZEN_DATASET_VERSION
    || dataset.manifest.dataset_digest !== FROZEN_DATASET_DIGEST
    || dataset.manifest.splits.calibration.sha256 !== FROZEN_CALIBRATION_FILE_SHA256
    || dataset.manifest.splits.holdout.sha256 !== FROZEN_HOLDOUT_FILE_SHA256) {
    throw new Error("EVALUATION_DATASET_IDENTITY_INVALID");
  }
  const selectedSplits: readonly EvaluationSplit[] = dataset.selection === "all"
    ? Object.freeze(["calibration", "holdout"])
    : Object.freeze(["calibration"]);
  const samples = selectedSplits.flatMap((split) => dataset.samples[split] ?? []);
  const observations = executeSamples(samples);
  const splitReports = Object.fromEntries(selectedSplits.map((split) => [
    split,
    scoreObservations(observations.filter((observation) => observation.sample.split === split)),
  ]));
  const overall = scoreObservations(observations);
  const assessment = assessD111Thresholds(overall, dataset.prohibited_data_hits.length);
  const report: Record<string, unknown> = {
    schema: SUGGESTION_REVALIDATION_REPORT_SCHEMA,
    evaluation_run_id: metadata.evaluation_run_id ?? randomUUID(),
    generated_at: metadata.generated_at ?? new Date().toISOString(),
    evaluation_mode: dataset.selection === "all" ? "FORMAL_ALL_SPLITS_ONCE" : "CALIBRATION_PREFLIGHT_ONLY",
    identity: Object.freeze({
      candidate_source_revision: metadata.candidate_source_revision,
      harness_revision: metadata.harness_revision,
      underlying_evaluator_source_revision: UNDERLYING_EVALUATOR_SOURCE_REVISION,
      evaluator_version: EVALUATOR_VERSION,
      suggestion_layer_evaluator_version: SUGGESTION_LAYER_EVALUATOR_VERSION,
      package_version: metadata.package_version,
      migration_0041_sha256: metadata.migration_0041_sha256,
      schema_digest: AI_SUGGESTION_SCHEMA_DIGEST,
      config_digest: AI_SUGGESTION_CONFIG_DIGEST,
      contract_digest: AI_SUGGESTION_CONTRACT_DIGEST,
      parameter_digest: AI_SUGGESTION_PARAMETER_DIGEST,
      projection_version: SUGGESTION_LAYER_PROJECTION_VERSION,
      projection_contract_digest: SUGGESTION_LAYER_PROJECTION_CONTRACT_DIGEST,
      reference_catalog_version: SYNTHETIC_REFERENCE_CATALOG_VERSION,
      reference_catalog_digest: SYNTHETIC_REFERENCE_CATALOG_DIGEST,
      source_artifacts: metadata.source_artifacts,
    }),
    candidate_contract: Object.freeze({
      ...AI_SUGGESTION_APPROVED_CONTRACT,
      execution_mode: "LOCAL_DETERMINISTIC",
      provider_id: "LOCAL_DETERMINISTIC",
      model_id: "NONE",
      model_version: "NONE",
      prompt_version: "NONE",
      prompt_digest: null,
      confidence: null,
      confidence_semantics_version: null,
      threshold_profile: AI_SUGGESTION_THRESHOLD_PROFILE,
      formal_action_allowed: false,
      human_review_required: true,
      external_transmission_allowed: false,
    }),
    dataset: Object.freeze({
      dataset_id: dataset.manifest.dataset_id,
      version: dataset.manifest.version,
      dataset_digest: dataset.manifest.dataset_digest,
      manifest_file_sha256: dataset.manifest_file_sha256,
      calibration_file_sha256: dataset.manifest.splits.calibration.sha256,
      holdout_file_sha256: dataset.manifest.splits.holdout.sha256,
      sample_schema_version: dataset.manifest.sample_schema_version,
      deidentification_policy_version: dataset.manifest.deidentification_policy_version,
      holdout_policy: dataset.manifest.holdout_policy,
      selected_splits: selectedSplits,
      opened_files: dataset.opened_files,
      sample_count: samples.length,
      prohibited_data_hit_count: dataset.prohibited_data_hits.length,
      prohibited_data_hit_sample_ids: Object.freeze(dataset.prohibited_data_hits.map((entry) => entry.split(":", 1)[0])),
    }),
    execution_environment: Object.freeze({
      runtime: "node",
      node_version: process.version,
      platform: process.platform,
      architecture: process.arch,
      network_required: false,
      database_required: false,
      credentials_required: false,
      external_model_called: false,
      production_data_read: false,
    }),
    splits: Object.freeze(splitReports),
    overall,
    threshold_assessment: assessment,
    comparison_to_alpha43: dataset.selection === "all"
      ? comparisonToAlpha43({ splits: splitReports, overall }, metadata.alpha43_report!, metadata.alpha43_report_sha256!)
      : null,
    status: Object.freeze({
      dataset_integrity: dataset.prohibited_data_hits.length === 0 ? "PASS" : "FAIL",
      threshold_status: assessment.result,
      task_status: dataset.selection === "all" && assessment.pass
        ? "DETERMINISTIC_HOLDOUT_REVALIDATED"
        : dataset.selection === "all" ? "HOLDOUT_REVALIDATION_FAILED" : "CALIBRATION_ONLY",
      release_decision: "NOT_AUTHORIZED",
    }),
  };
  report.result_digest = resultDigestForSuggestionLayerReport(report);
  return Object.freeze(report);
}

export function verifySuggestionLayerReport(reportValue: unknown): Readonly<{
  valid: boolean;
  result_digest_valid: boolean;
  threshold_assessment_valid: boolean;
  release_not_authorized: boolean;
  recomputed_threshold_assessment: ThresholdAssessment;
}> {
  const report = record(reportValue, "REPORT_INVALID");
  if (report.schema !== SUGGESTION_REVALIDATION_REPORT_SCHEMA) throw new Error("REPORT_SCHEMA_INVALID");
  const dataset = record(report.dataset, "REPORT_DATASET_INVALID");
  const overall = record(report.overall, "REPORT_OVERALL_INVALID");
  const recomputed = assessD111Thresholds(overall, numeric(dataset, "prohibited_data_hit_count"));
  const resultDigestValid = typeof report.result_digest === "string"
    && report.result_digest === resultDigestForSuggestionLayerReport(report);
  const thresholdAssessmentValid = canonicalJson(report.threshold_assessment) === canonicalJson(recomputed);
  const releaseNotAuthorized = record(report.status, "REPORT_STATUS_INVALID").release_decision === "NOT_AUTHORIZED";
  return Object.freeze({
    valid: resultDigestValid && thresholdAssessmentValid && releaseNotAuthorized,
    result_digest_valid: resultDigestValid,
    threshold_assessment_valid: thresholdAssessmentValid,
    release_not_authorized: releaseNotAuthorized,
    recomputed_threshold_assessment: recomputed,
  });
}
