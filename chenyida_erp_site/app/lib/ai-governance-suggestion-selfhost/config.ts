import { canonicalDigest } from "./canonical.ts";

export const AI_SUGGESTION_SCHEMA_VERSION = "ai-governance-suggestion-schema-v1";
export const AI_SUGGESTION_EVALUATOR_VERSION = "ai-governance-evaluator-v1";
export const AI_SUGGESTION_RULE_VERSION = "bom-material-governance-v1";
export const AI_SUGGESTION_CONFIG_VERSION = "deterministic-ai-suggestion-v1";
export const AI_SUGGESTION_THRESHOLD_PROFILE = "deterministic-ai-governance-thresholds-v1";
export const AI_SUGGESTION_DATASET = "synthetic-material-governance-v1@1.0.0";
export const AI_SUGGESTION_SOURCE_REVISION = "d69f6dff795377109244e788c2ffee73ef6194ec";
export const AI_SUGGESTION_INPUT_VERSION = "material-governance-input-v1";

export const AI_SUGGESTION_LIMITS = Object.freeze({
  ttlDays: 7,
  maximumRows: 500,
  maximumSpecs: 500,
  maximumLineage: 1000,
  maximumMaterialCandidates: 50,
  maximumItems: 64,
  maximumPageSize: 100,
});

export const AI_SUGGESTION_SCHEMA_DIGEST = canonicalDigest({
  schema_version: AI_SUGGESTION_SCHEMA_VERSION,
  tables: [
    "ai_governance_suggestion_runs",
    "ai_governance_suggestions",
    "ai_governance_suggestion_items",
    "ai_governance_suggestion_evidence",
    "ai_governance_suggestion_events",
  ],
  item_kinds: ["ATTRIBUTE_EXTRACTION", "CLASSIFICATION", "MATERIAL_MATCH", "SUPPLIER_MAPPING"],
  dispositions: ["ABSTAIN", "SUGGEST"],
});

export const AI_SUGGESTION_CONFIG_DIGEST = canonicalDigest({
  config_version: AI_SUGGESTION_CONFIG_VERSION,
  limits: AI_SUGGESTION_LIMITS,
  deterministic_only: true,
  fuzzy_matching: false,
  human_review_required: true,
  formal_write_allowed: false,
});

export const AI_SUGGESTION_PARAMETER_DIGEST = canonicalDigest({
  threshold_profile: AI_SUGGESTION_THRESHOLD_PROFILE,
  dataset: AI_SUGGESTION_DATASET,
  source_revision: AI_SUGGESTION_SOURCE_REVISION,
  confidence_semantics: null,
  candidate_score: null,
});

export const AI_SUGGESTION_APPROVED_CONTRACT = Object.freeze({
  execution_mode: "LOCAL_DETERMINISTIC",
  schema_version: AI_SUGGESTION_SCHEMA_VERSION,
  schema_digest: AI_SUGGESTION_SCHEMA_DIGEST,
  evaluator_version: AI_SUGGESTION_EVALUATOR_VERSION,
  rule_version: AI_SUGGESTION_RULE_VERSION,
  config_version: AI_SUGGESTION_CONFIG_VERSION,
  config_digest: AI_SUGGESTION_CONFIG_DIGEST,
  provider_id: "LOCAL_DETERMINISTIC",
  model_id: "NONE",
  model_version: "NONE",
  prompt_version: "NONE",
  prompt_digest: null,
  parameter_digest: AI_SUGGESTION_PARAMETER_DIGEST,
  confidence_semantics_version: null,
  input_version: AI_SUGGESTION_INPUT_VERSION,
  threshold_profile: AI_SUGGESTION_THRESHOLD_PROFILE,
  dataset: AI_SUGGESTION_DATASET,
  source_revision: AI_SUGGESTION_SOURCE_REVISION,
});

export const AI_SUGGESTION_CONTRACT_DIGEST = canonicalDigest(AI_SUGGESTION_APPROVED_CONTRACT);
