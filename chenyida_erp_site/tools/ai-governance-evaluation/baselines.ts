import { MATERIAL_GOVERNANCE_RULE_VERSION } from "../../app/lib/material-governance-selfhost/config.ts";
import { governMaterialSource } from "../../app/lib/material-governance-selfhost/engine.ts";
import type { GovernedSource, GovernanceIssue } from "../../app/lib/material-governance-selfhost/types.ts";
import { sortedUnique } from "./canonical.ts";
import { EVALUATOR_VERSION } from "./types.ts";
import type {
  ActualField,
  BaselineResult,
  CandidateRecord,
  EvaluationSample,
  MatchInput,
  SupplierMappingInput,
} from "./types.ts";

const COMPONENT_ISSUE_FIELDS: Readonly<Record<string, string>> = Object.freeze({
  PACKAGE: "package",
  RESISTANCE: "resistance",
  TOLERANCE: "tolerance",
  POWER: "power",
  CAPACITANCE: "capacitance",
  VOLTAGE: "voltage",
  DIELECTRIC: "dielectric",
  INDUCTANCE: "inductance",
  RATED_CURRENT: "rated_current",
  MODEL: "model",
  BRAND: "brand",
  PIN_COUNT: "pin_count",
  PITCH: "pitch",
  STRUCTURE: "structure",
  FREQUENCY: "frequency",
});

const RULE_EVIDENCE = `RULE_VERSION_${MATERIAL_GOVERNANCE_RULE_VERSION.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;

function normalizeIdentity(value: string): string {
  return value.normalize("NFKC").trim().toUpperCase().replaceAll("μ", "U").replaceAll("µ", "U");
}

function commonEvidence(values: readonly string[]): readonly string[] {
  return sortedUnique(["LOCAL_DETERMINISTIC_RULE", RULE_EVIDENCE, ...values]);
}

function result(
  sample: EvaluationSample,
  values: Readonly<{
    action: "SUGGEST" | "ABSTAIN";
    category?: BaselineResult["category"];
    fields?: readonly ActualField[];
    candidateIds?: readonly string[];
    evidence?: readonly string[];
  }>,
): BaselineResult {
  return Object.freeze({
    sample_id: sample.sample_id,
    capability: sample.capability,
    action: values.action,
    category: values.category ?? null,
    fields: Object.freeze(values.fields ? [...values.fields] : []),
    candidate_ids: Object.freeze(values.candidateIds ? [...values.candidateIds] : []),
    evidence: commonEvidence(values.evidence ?? []),
    provider: "LOCAL_DETERMINISTIC",
    model_id: "NONE",
    prompt_version: "NONE",
    rule_version: MATERIAL_GOVERNANCE_RULE_VERSION,
    evaluator_version: EVALUATOR_VERSION,
    formal_actions: Object.freeze([]),
    bypasses_human_review: false,
    external_transmission_intent: false,
    overrides_deterministic_gate: false,
  });
}

function governance(input: EvaluationSample["input"]): GovernedSource {
  return governMaterialSource(input.source);
}

function issueEvidence(issues: readonly GovernanceIssue[]): readonly string[] {
  return issues.flatMap((item) => [item.code, ...item.evidence]);
}

function classificationBaseline(sample: EvaluationSample): BaselineResult {
  const governed = governance(sample.input);
  if (governed.category === "OTHER" || governed.category === "MECH") {
    return result(sample, {
      action: "ABSTAIN",
      evidence: ["CLASSIFICATION_ABSTAIN", `CATEGORY_${governed.category}`, ...issueEvidence(governed.issues)],
    });
  }
  return result(sample, {
    action: "SUGGEST",
    category: governed.category,
    evidence: [`CATEGORY_${governed.category}`, "CLASSIFICATION_UNIQUE_RULE_RESULT"],
  });
}

function blocksComponent(code: string, issues: readonly GovernanceIssue[]): boolean {
  const field = COMPONENT_ISSUE_FIELDS[code];
  if (!field) return true;
  return issues.some((item) => item.level === "ERROR" && (item.field === field || item.field === "category"));
}

function attributeBaseline(sample: EvaluationSample): BaselineResult {
  if (sample.capability !== "ATTRIBUTE_EXTRACTION") throw new Error("BASELINE_CAPABILITY_MISMATCH");
  const governed = governance(sample.input);
  const components = new Map(governed.components.map((component) => [component.code, component]));
  const fields: ActualField[] = [];
  const evidence: string[] = [];
  for (const code of sample.input.target_fields) {
    const component = components.get(code);
    const blocked = blocksComponent(code, governed.issues);
    if (!component || blocked) {
      fields.push(Object.freeze({ code, status: "ABSTAIN", normalized_value: null, canonical_unit: null }));
      evidence.push(`FIELD_${code}_ABSTAIN`);
      const issueField = COMPONENT_ISSUE_FIELDS[code];
      evidence.push(...issueEvidence(governed.issues.filter((item) => item.field === issueField || item.field === "category")));
      continue;
    }
    fields.push(Object.freeze({
      code,
      status: "VALUE",
      normalized_value: component.normalizedValue,
      canonical_unit: component.canonicalUnit,
    }));
    evidence.push(`FIELD_${code}_RULE_VALUE`, ...component.evidence);
  }
  return result(sample, {
    action: fields.some((field) => field.status === "VALUE") ? "SUGGEST" : "ABSTAIN",
    fields,
    evidence,
  });
}

function customerEligible(requestScope: string, candidateScope: string): boolean {
  return candidateScope === "GENERAL" || (requestScope !== "GENERAL" && candidateScope === requestScope);
}

type GovernedCandidate = Readonly<{ candidate: CandidateRecord; governed: GovernedSource }>;

function governCandidates(candidates: readonly CandidateRecord[]): readonly GovernedCandidate[] {
  return Object.freeze(candidates.map((candidate) => Object.freeze({
    candidate,
    governed: governMaterialSource(candidate.source),
  })));
}

function abstainForCandidateGate(
  sample: EvaluationSample,
  evidence: readonly string[],
): BaselineResult {
  return result(sample, { action: "ABSTAIN", evidence });
}

function materialMatchBaseline(sample: EvaluationSample): BaselineResult {
  if (sample.capability !== "MATERIAL_MATCH") throw new Error("BASELINE_CAPABILITY_MISMATCH");
  const input = sample.input as MatchInput;
  const query = governMaterialSource(input.source);
  if (query.readiness !== "READY" || !query.identityDigest) {
    return abstainForCandidateGate(sample, ["QUERY_IDENTITY_UNAVAILABLE", ...issueEvidence(query.issues)]);
  }
  const candidates = governCandidates(input.candidate_catalog);
  const identityMatches = candidates.filter((entry) => entry.governed.identityDigest === query.identityDigest);
  if (identityMatches.length === 0) return abstainForCandidateGate(sample, ["EXACT_IDENTITY_CANDIDATE_NOT_FOUND"]);
  if (identityMatches.length > 1) return abstainForCandidateGate(sample, ["EXACT_IDENTITY_CANDIDATE_AMBIGUOUS"]);
  const match = identityMatches[0];
  if (match.candidate.status !== "ACTIVE") return abstainForCandidateGate(sample, ["CANDIDATE_LIFECYCLE_BLOCKED"]);
  if (!customerEligible(input.customer_scope, match.candidate.customer_scope)) {
    return abstainForCandidateGate(sample, ["CUSTOMER_SCOPE_CONFLICT"]);
  }
  return result(sample, {
    action: "SUGGEST",
    candidateIds: [match.candidate.candidate_id],
    evidence: ["IDENTITY_DIGEST_EQUAL", "UNIQUE_EXACT_CANDIDATE", "CANDIDATE_LIFECYCLE_ACTIVE", "CUSTOMER_SCOPE_ALLOWED"],
  });
}

function supplierMappingBaseline(sample: EvaluationSample): BaselineResult {
  if (sample.capability !== "SUPPLIER_MAPPING") throw new Error("BASELINE_CAPABILITY_MISMATCH");
  const input = sample.input as SupplierMappingInput;
  const query = governMaterialSource(input.source);
  if (query.readiness !== "READY" || !query.identityDigest) {
    return abstainForCandidateGate(sample, ["QUERY_IDENTITY_UNAVAILABLE", ...issueEvidence(query.issues)]);
  }
  const supplierId = normalizeIdentity(input.supplier_identity.supplier_id);
  const supplierPart = normalizeIdentity(input.supplier_identity.supplier_part_number);
  const candidates = governCandidates(input.candidate_catalog);
  const factMatches = candidates.flatMap((entry) => entry.candidate.supplier_facts
    .filter((fact) => normalizeIdentity(fact.supplier_id) === supplierId && normalizeIdentity(fact.supplier_part_number) === supplierPart)
    .map((fact) => Object.freeze({ entry, fact })));
  if (factMatches.length === 0) return abstainForCandidateGate(sample, ["SUPPLIER_PART_FACT_NOT_FOUND"]);
  if (new Set(factMatches.map((match) => match.entry.candidate.candidate_id)).size !== 1 || factMatches.length !== 1) {
    return abstainForCandidateGate(sample, ["SUPPLIER_PART_FACT_AMBIGUOUS"]);
  }
  const { entry, fact } = factMatches[0];
  if (fact.status !== "ACTIVE") return abstainForCandidateGate(sample, ["SUPPLIER_PART_FACT_INACTIVE"]);
  if (entry.candidate.status !== "ACTIVE") return abstainForCandidateGate(sample, ["CANDIDATE_LIFECYCLE_BLOCKED"]);
  if (!customerEligible(input.customer_scope, entry.candidate.customer_scope)) {
    return abstainForCandidateGate(sample, ["CUSTOMER_SCOPE_CONFLICT"]);
  }
  if (entry.governed.identityDigest !== query.identityDigest) {
    return abstainForCandidateGate(sample, ["SUPPLIER_FACT_SPECIFICATION_CONFLICT"]);
  }
  return result(sample, {
    action: "SUGGEST",
    candidateIds: [entry.candidate.candidate_id],
    evidence: [
      "SUPPLIER_IDENTITY_EXACT",
      "SUPPLIER_PART_FACT_EXACT",
      "IDENTITY_DIGEST_EQUAL",
      "UNIQUE_EXACT_CANDIDATE",
      "CANDIDATE_LIFECYCLE_ACTIVE",
      "CUSTOMER_SCOPE_ALLOWED",
    ],
  });
}

export function runDeterministicBaseline(sample: EvaluationSample): BaselineResult {
  if (sample.capability === "CLASSIFICATION") return classificationBaseline(sample);
  if (sample.capability === "ATTRIBUTE_EXTRACTION") return attributeBaseline(sample);
  if (sample.capability === "MATERIAL_MATCH") return materialMatchBaseline(sample);
  return supplierMappingBaseline(sample);
}
