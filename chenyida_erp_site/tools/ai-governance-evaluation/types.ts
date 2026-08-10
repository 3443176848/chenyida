import type { GovernanceCategory, GovernanceSourceInput } from "../../app/lib/material-governance-selfhost/types.ts";

export const EVALUATOR_VERSION = "ai-governance-evaluator-v1";
export const REPORT_SCHEMA = "AI_GOVERNANCE_EVALUATION_REPORT_V1";
export const SAMPLE_SCHEMA_VERSION = "ai-governance-evaluation-sample-v1";
export const MANIFEST_SCHEMA = "AI_GOVERNANCE_DATASET_MANIFEST_V1";
export const DEIDENTIFICATION_POLICY_VERSION = "ai-governance-deidentification-v1";

export const CAPABILITIES = [
  "CLASSIFICATION",
  "ATTRIBUTE_EXTRACTION",
  "MATERIAL_MATCH",
  "SUPPLIER_MAPPING",
] as const;

export const SPLITS = ["calibration", "holdout"] as const;
export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const CANDIDATE_STATUSES = ["ACTIVE", "FROZEN", "INACTIVE"] as const;
export const FACT_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export const FIELD_STATUSES = ["VALUE", "ABSTAIN"] as const;

export type Capability = typeof CAPABILITIES[number];
export type EvaluationSplit = typeof SPLITS[number];
export type RiskLevel = typeof RISK_LEVELS[number];
export type AllowedAction = "SUGGEST" | "ABSTAIN";
export type MaterialCategory = GovernanceCategory | "UNKNOWN";

export type SupplierFact = Readonly<{
  supplier_id: string;
  supplier_part_number: string;
  status: typeof FACT_STATUSES[number];
}>;

export type CandidateRecord = Readonly<{
  candidate_id: string;
  status: typeof CANDIDATE_STATUSES[number];
  customer_scope: string;
  source: GovernanceSourceInput;
  supplier_facts: readonly SupplierFact[];
}>;

export type SupplierIdentity = Readonly<{
  supplier_id: string;
  supplier_part_number: string;
}>;

export type ClassificationInput = Readonly<{ source: GovernanceSourceInput }>;
export type AttributeInput = Readonly<{ source: GovernanceSourceInput; target_fields: readonly string[] }>;
export type MatchInput = Readonly<{
  source: GovernanceSourceInput;
  customer_scope: string;
  candidate_catalog: readonly CandidateRecord[];
}>;
export type SupplierMappingInput = MatchInput & Readonly<{ supplier_identity: SupplierIdentity }>;

export type ExpectedField = Readonly<{
  code: string;
  status: typeof FIELD_STATUSES[number];
  normalized_value: string | null;
  canonical_unit: string | null;
}>;

export type ClassificationExpected = Readonly<{ category: GovernanceCategory | null }>;
export type AttributeExpected = Readonly<{ fields: readonly ExpectedField[] }>;
export type CandidateExpected = Readonly<{ candidate_ids: readonly string[] }>;

export type SafetyGateExpectation = Readonly<{
  formal_write_allowed: false;
  human_review_required: true;
  must_abstain: boolean;
  external_transmission_allowed: false;
}>;

export type EvidenceExpectation = Readonly<{ minimum_codes: readonly string[] }>;

type SampleBase = Readonly<{
  sample_id: string;
  split: EvaluationSplit;
  capability: Capability;
  scenario: string;
  risk_level: RiskLevel;
  material_category: MaterialCategory;
  synthetic: true;
  deidentified: true;
  deidentification_policy_version: typeof DEIDENTIFICATION_POLICY_VERSION;
  allowed_action: AllowedAction;
  safety_gate_expectation: SafetyGateExpectation;
  evidence_expectation: EvidenceExpectation;
}>;

export type ClassificationSample = SampleBase & Readonly<{
  capability: "CLASSIFICATION";
  input: ClassificationInput;
  expected: ClassificationExpected;
}>;

export type AttributeSample = SampleBase & Readonly<{
  capability: "ATTRIBUTE_EXTRACTION";
  input: AttributeInput;
  expected: AttributeExpected;
}>;

export type MaterialMatchSample = SampleBase & Readonly<{
  capability: "MATERIAL_MATCH";
  input: MatchInput;
  expected: CandidateExpected;
}>;

export type SupplierMappingSample = SampleBase & Readonly<{
  capability: "SUPPLIER_MAPPING";
  input: SupplierMappingInput;
  expected: CandidateExpected;
}>;

export type EvaluationSample = ClassificationSample | AttributeSample | MaterialMatchSample | SupplierMappingSample;

export type ActualField = Readonly<{
  code: string;
  status: typeof FIELD_STATUSES[number];
  normalized_value: string | null;
  canonical_unit: string | null;
}>;

export type BaselineResult = Readonly<{
  sample_id: string;
  capability: Capability;
  action: AllowedAction;
  category: GovernanceCategory | null;
  fields: readonly ActualField[];
  candidate_ids: readonly string[];
  evidence: readonly string[];
  provider: "LOCAL_DETERMINISTIC";
  model_id: "NONE";
  prompt_version: "NONE";
  rule_version: string;
  evaluator_version: typeof EVALUATOR_VERSION;
  formal_actions: readonly string[];
  bypasses_human_review: false;
  external_transmission_intent: false;
  overrides_deterministic_gate: false;
}>;

export type CountMap = Readonly<Record<string, number>>;
export type DatasetStatistics = Readonly<{
  capability: CountMap;
  material_category: CountMap;
  scenario: CountMap;
  risk_level: CountMap;
}>;

export type ManifestSplit = Readonly<{
  file: string;
  sha256: string;
  sample_count: number;
  statistics: DatasetStatistics;
}>;

export type DatasetManifest = Readonly<{
  schema: typeof MANIFEST_SCHEMA;
  dataset_id: string;
  version: string;
  created_at: string;
  deidentification_policy_version: typeof DEIDENTIFICATION_POLICY_VERSION;
  sample_schema_version: typeof SAMPLE_SCHEMA_VERSION;
  canonical_json_version: "canonical-json-lexicographic-v1";
  dataset_digest_rule: "sha256(canonical-json(manifest-without-dataset_digest))";
  holdout_policy: "FROZEN_NOT_FOR_TUNING";
  splits: Readonly<Record<EvaluationSplit, ManifestSplit>>;
  dataset_digest: string;
}>;

export type LoadedDataset = Readonly<{
  directory: string;
  manifest: DatasetManifest;
  samples: Readonly<Record<EvaluationSplit, readonly EvaluationSample[]>>;
}>;

export type Ratio = Readonly<{
  numerator: string;
  denominator: string;
  value: string;
  defined: boolean;
}>;
