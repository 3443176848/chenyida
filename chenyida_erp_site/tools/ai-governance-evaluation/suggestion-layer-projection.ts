import { governMaterialSource } from "../../app/lib/material-governance-selfhost/engine.ts";
import type { GovernedSource, GovernanceCategory } from "../../app/lib/material-governance-selfhost/types.ts";
import { normalizeIdentity } from "../../app/lib/ai-governance-suggestion-selfhost/canonical.ts";
import type {
  AiSuggestionSourceSnapshot,
} from "../../app/lib/ai-governance-suggestion-selfhost/types.ts";
import { canonicalDigest, canonicalJson, sortedUnique } from "./canonical.ts";
import type {
  Capability,
  EvaluationSample,
} from "./types.ts";

export const SYNTHETIC_REFERENCE_CATALOG_VERSION = "synthetic-ai-suggestion-reference-catalog-v1";
export const SUGGESTION_LAYER_PROJECTION_VERSION = "deterministic-suggestion-layer-projection-v1";

type AttributeCatalogEntry = Readonly<{
  id: number;
  code: string;
  data_type: "TEXT" | "INTEGER" | "DECIMAL";
  canonical_unit: string | null;
  decimal_scale: number;
}>;

const CATEGORY_CODES = Object.freeze([
  "RES", "CAP", "IND", "DIODE", "TRANS", "IC", "OSC", "CON", "MECH", "OTHER",
] as const);

const ATTRIBUTE_CATALOG: readonly AttributeCatalogEntry[] = Object.freeze([
  Object.freeze({ id: 2101, code: "BRAND", data_type: "TEXT", canonical_unit: null, decimal_scale: 0 }),
  Object.freeze({ id: 2102, code: "CAPACITANCE", data_type: "DECIMAL", canonical_unit: "aF", decimal_scale: 12 }),
  Object.freeze({ id: 2103, code: "DIELECTRIC", data_type: "TEXT", canonical_unit: null, decimal_scale: 0 }),
  Object.freeze({ id: 2104, code: "FREQUENCY", data_type: "DECIMAL", canonical_unit: "Hz", decimal_scale: 12 }),
  Object.freeze({ id: 2105, code: "INDUCTANCE", data_type: "DECIMAL", canonical_unit: "pH", decimal_scale: 12 }),
  Object.freeze({ id: 2106, code: "MODEL", data_type: "TEXT", canonical_unit: null, decimal_scale: 0 }),
  Object.freeze({ id: 2107, code: "PACKAGE", data_type: "TEXT", canonical_unit: null, decimal_scale: 0 }),
  Object.freeze({ id: 2108, code: "PIN_COUNT", data_type: "INTEGER", canonical_unit: "pin", decimal_scale: 0 }),
  Object.freeze({ id: 2109, code: "PITCH", data_type: "DECIMAL", canonical_unit: "nm", decimal_scale: 12 }),
  Object.freeze({ id: 2110, code: "POWER", data_type: "DECIMAL", canonical_unit: "uW", decimal_scale: 12 }),
  Object.freeze({ id: 2111, code: "RATED_CURRENT", data_type: "DECIMAL", canonical_unit: "uA", decimal_scale: 12 }),
  Object.freeze({ id: 2112, code: "RESISTANCE", data_type: "DECIMAL", canonical_unit: "uohm", decimal_scale: 12 }),
  Object.freeze({ id: 2113, code: "STRUCTURE", data_type: "TEXT", canonical_unit: null, decimal_scale: 0 }),
  Object.freeze({ id: 2114, code: "TOLERANCE", data_type: "DECIMAL", canonical_unit: "%", decimal_scale: 12 }),
  Object.freeze({ id: 2115, code: "VOLTAGE", data_type: "DECIMAL", canonical_unit: "uV", decimal_scale: 12 }),
]);

const CATEGORY_ROWS = Object.freeze(CATEGORY_CODES.map((categoryCode, index) => Object.freeze({
  id: 1101 + index,
  category_code: categoryCode,
  status: "ACTIVE",
  version: 1,
})));

export const SYNTHETIC_REFERENCE_CATALOG_DIGEST = canonicalDigest({
  version: SYNTHETIC_REFERENCE_CATALOG_VERSION,
  categories: CATEGORY_ROWS,
  attributes: ATTRIBUTE_CATALOG,
  material_reference_rule: "stable-id-from-input-candidate-id-and-strict-deterministic-identity",
  supplier_reference_rule: "stable-id-from-input-supplier-identity",
  mapping_reference_rule: "stable-id-from-input-supplier-fact-and-strict-deterministic-identity",
});

export const SUGGESTION_LAYER_PROJECTION_CONTRACT_DIGEST = canonicalDigest({
  version: SUGGESTION_LAYER_PROJECTION_VERSION,
  reference_catalog_version: SYNTHETIC_REFERENCE_CATALOG_VERSION,
  reference_catalog_digest: SYNTHETIC_REFERENCE_CATALOG_DIGEST,
  candidate_rule: "EXACT_IDENTITY_ONLY",
  lifecycle_rule: "PRESERVE_INPUT_STATUS",
  customer_scope_rule: "GENERAL_OR_EXACT_QUERY_SCOPE",
  attribute_missing_rule: "REQUESTED_FIELD_ABSTAIN",
  supplier_rule: "INPUT_SUPPLIER_IDENTITY_AND_CANDIDATE_SUPPLIER_FACTS_ONLY",
});

export type SuggestionProjectionInput = Readonly<{
  sample_id: string;
  capability: Capability;
  input: EvaluationSample["input"];
}>;

export type SuggestionProjectionContext = Readonly<{
  sample_id: string;
  capability: Capability;
  category_by_id: ReadonlyMap<number, GovernanceCategory>;
  attribute_by_id: ReadonlyMap<number, string>;
  material_candidate_by_id: ReadonlyMap<number, string>;
  spec_evidence_by_id: ReadonlyMap<number, readonly string[]>;
  requested_fields: readonly string[];
  query_identity_available: boolean;
  exact_candidate_ids: readonly string[];
  scope_allowed_exact_candidate_ids: readonly string[];
  active_scope_allowed_exact_candidate_ids: readonly string[];
  lifecycle_blocked_candidate_ids: readonly string[];
  scope_blocked_candidate_ids: readonly string[];
  supplier_matching_fact_candidate_ids: readonly string[];
  supplier_active_fact_candidate_ids: readonly string[];
  supplier_inactive_fact_candidate_ids: readonly string[];
  supplier_fact_lifecycle_blocked_candidate_ids: readonly string[];
  supplier_fact_scope_blocked_candidate_ids: readonly string[];
  supplier_spec_conflict_candidate_ids: readonly string[];
  governed_category: GovernanceCategory;
  governance_issue_evidence: readonly string[];
  issue_evidence_by_component: ReadonlyMap<string, readonly string[]>;
}>;

export type SuggestionProjection = Readonly<{
  snapshot: AiSuggestionSourceSnapshot;
  context: SuggestionProjectionContext;
}>;

function stableId(namespace: string, value: string): number {
  const digest = canonicalDigest({ namespace, value });
  return Number.parseInt(digest.slice(0, 12), 16) + 10_000;
}

function stableUuid(namespace: string, value: string): string {
  const digest = canonicalDigest({ namespace, value });
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function governedDigestProjection(governed: GovernedSource): Record<string, unknown> {
  return {
    source_key: governed.source.sourceKey,
    category: governed.category,
    readiness: governed.readiness,
    identity_digest: governed.identityDigest,
    compatibility_digest: governed.compatibilityDigest,
    components: governed.components.map((component) => ({
      code: component.code,
      role: component.role,
      normalized_value: component.normalizedValue,
      canonical_unit: component.canonicalUnit,
      evidence: component.evidence,
    })),
    issues: governed.issues.map((issue) => ({ level: issue.level, code: issue.code, field: issue.field })),
    rule_version: governed.ruleVersion,
  };
}

function scopeAllowed(queryScope: string, candidateScope: string): boolean {
  return candidateScope === "GENERAL" || candidateScope === queryScope;
}

function assertProjectionInput(value: SuggestionProjectionInput): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SUGGESTION_PROJECTION_INPUT_INVALID");
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right, "en"));
  const required = ["capability", "input", "sample_id"];
  if (canonicalJson(actual) !== canonicalJson(required)) throw new Error("SUGGESTION_PROJECTION_INPUT_KEYS_INVALID");
}

function candidateCatalog(input: EvaluationSample["input"]) {
  return "candidate_catalog" in input ? input.candidate_catalog : Object.freeze([]);
}

function requestedFields(input: EvaluationSample["input"]): readonly string[] {
  return "target_fields" in input ? input.target_fields : Object.freeze([]);
}

export function projectSuggestionLayerInput(projectionInput: SuggestionProjectionInput): SuggestionProjection {
  assertProjectionInput(projectionInput);
  const { sample_id: sampleId, capability, input } = projectionInput;
  const governed = governMaterialSource(input.source);
  const rowId = stableId("governance-row", sampleId);
  const groupId = stableId("governance-group", sampleId);
  const runId = stableId("governance-run", sampleId);
  const batchId = stableId("import-batch", sampleId);
  const sourceSnapshotDigest = canonicalDigest({
    source: input.source,
    supplier_identity: "supplier_identity" in input ? input.supplier_identity : null,
  });
  const supplierIdentity = "supplier_identity" in input ? input.supplier_identity : null;
  const queryScope = "customer_scope" in input ? input.customer_scope : "GENERAL";
  const requested = requestedFields(input);

  const ambiguousComponentCodes = new Set(governed.issues
    .filter((issue) => issue.level === "ERROR")
    .map((issue) => issue.field.normalize("NFKC").trim().toUpperCase()));
  const projectedComponents = governed.components.filter((component) =>
    !ambiguousComponentCodes.has("CATEGORY") && !ambiguousComponentCodes.has(component.code));
  const issueEvidenceByComponent = new Map<string, readonly string[]>();
  for (const issue of governed.issues) {
    const code = issue.field.normalize("NFKC").trim().toUpperCase();
    issueEvidenceByComponent.set(code, sortedUnique([
      ...(issueEvidenceByComponent.get(code) ?? []),
      issue.code,
      ...issue.evidence,
    ]));
  }
  const governanceIssueEvidence = sortedUnique(governed.issues.flatMap((issue) => [issue.code, ...issue.evidence]));
  const specs = projectedComponents.map((component, index) => Object.freeze({
    id: stableId("governance-spec", `${sampleId}:${component.code}:${index}`),
    governance_row_id: rowId,
    source_key: governed.source.sourceKey,
    source_snapshot_digest: sourceSnapshotDigest,
    component_code: component.code,
    component_role: component.role,
    normalized_value: component.normalizedValue,
    canonical_unit: component.canonicalUnit,
  }));
  const specEvidenceById = new Map<number, readonly string[]>();
  specs.forEach((spec, index) => specEvidenceById.set(spec.id, projectedComponents[index].evidence));

  const definitions = ATTRIBUTE_CATALOG
    .filter((entry) => requested.includes(entry.code))
    .map((entry) => Object.freeze({
      id: entry.id,
      attribute_code: entry.code,
      data_type: entry.data_type,
      decimal_scale: entry.decimal_scale,
      canonical_unit: entry.canonical_unit,
      allowed_values: Object.freeze([]),
      status: "ACTIVE",
      version: 1,
    }));

  const governedCandidates = candidateCatalog(input).map((candidate) => Object.freeze({
    candidate,
    governed: governMaterialSource(candidate.source),
  }));
  const exactCandidates = governed.identityDigest === null ? [] : governedCandidates.filter((entry) =>
    entry.governed.identityDigest !== null && entry.governed.identityDigest === governed.identityDigest);
  const scopeAllowedExact = exactCandidates.filter((entry) => scopeAllowed(queryScope, entry.candidate.customer_scope));
  const activeScopeAllowedExact = scopeAllowedExact.filter((entry) => entry.candidate.status === "ACTIVE");
  const projectedEntries = capability === "MATERIAL_MATCH"
    && exactCandidates.length > 1
    && activeScopeAllowedExact.length <= 1
    ? []
    : scopeAllowedExact;
  const projectedCandidates = projectedEntries.map((entry, index) => {
    const materialId = stableId("material", entry.candidate.candidate_id);
    return Object.freeze({
      id: stableId("governance-material-candidate", `${sampleId}:${entry.candidate.candidate_id}`),
      group_id: groupId,
      material_id: materialId,
      candidate_kind: "EXACT_IDENTITY",
      candidate_rank: index + 1,
      candidate_digest: canonicalDigest({
        candidate_id: entry.candidate.candidate_id,
        identity_digest: entry.governed.identityDigest,
        status: entry.candidate.status,
        customer_scope: entry.candidate.customer_scope,
      }),
      material_version_snapshot: 1,
      material_status_snapshot: entry.candidate.status,
      internal_material_code: `SYN-MATERIAL-${canonicalDigest(entry.candidate.candidate_id).slice(0, 16).toUpperCase()}`,
      material_status: entry.candidate.status,
      version: 1,
    });
  });
  const projectedByCandidateId = new Map(projectedEntries.map((entry, index) => [entry.candidate.candidate_id, projectedCandidates[index]]));

  const supplierId = supplierIdentity ? stableId("supplier", supplierIdentity.supplier_id) : null;
  const suppliers = supplierIdentity ? [Object.freeze({
    id: supplierId!,
    supplier_code: `SYN-SUPPLIER-${canonicalDigest(supplierIdentity.supplier_id).slice(0, 12).toUpperCase()}`,
    normalized_name: supplierIdentity.supplier_id,
    status: "ACTIVE",
    version: 1,
  })] : [];

  const matchingFacts = supplierIdentity ? governedCandidates.flatMap((entry) => entry.candidate.supplier_facts
    .filter((fact) => normalizeIdentity(fact.supplier_id) === normalizeIdentity(supplierIdentity.supplier_id)
      && normalizeIdentity(fact.supplier_part_number) === normalizeIdentity(supplierIdentity.supplier_part_number))
    .map((fact) => Object.freeze({ entry, fact }))) : [];
  const matchingFactCandidateIds = sortedUnique(matchingFacts.map(({ entry }) => entry.candidate.candidate_id));
  const activeFactCandidateIds = sortedUnique(matchingFacts.filter(({ fact }) => fact.status === "ACTIVE")
    .map(({ entry }) => entry.candidate.candidate_id));
  const inactiveFactCandidateIds = sortedUnique(matchingFacts.filter(({ fact }) => fact.status === "INACTIVE")
    .map(({ entry }) => entry.candidate.candidate_id));
  const supplierFactLifecycleBlockedCandidateIds = sortedUnique(matchingFacts
    .filter(({ entry, fact }) => fact.status === "ACTIVE" && entry.candidate.status !== "ACTIVE")
    .map(({ entry }) => entry.candidate.candidate_id));
  const supplierFactScopeBlockedCandidateIds = sortedUnique(matchingFacts
    .filter(({ entry, fact }) => fact.status === "ACTIVE"
      && entry.candidate.status === "ACTIVE"
      && !scopeAllowed(queryScope, entry.candidate.customer_scope))
    .map(({ entry }) => entry.candidate.candidate_id));
  const exactCandidateIdSet = new Set(exactCandidates.map((entry) => entry.candidate.candidate_id));
  const supplierSpecConflictCandidateIds = sortedUnique(matchingFacts
    .filter(({ entry, fact }) => fact.status === "ACTIVE"
      && entry.candidate.status === "ACTIVE"
      && scopeAllowed(queryScope, entry.candidate.customer_scope)
      && !exactCandidateIdSet.has(entry.candidate.candidate_id))
    .map(({ entry }) => entry.candidate.candidate_id));

  const supplierFactUnambiguous = matchingFacts.length === 1 && matchingFactCandidateIds.length === 1;
  const supplierMappings = supplierIdentity && supplierFactUnambiguous ? projectedEntries.flatMap((entry) => {
    const projected = projectedByCandidateId.get(entry.candidate.candidate_id)!;
    return entry.candidate.supplier_facts
      .filter((fact) => normalizeIdentity(fact.supplier_id) === normalizeIdentity(supplierIdentity.supplier_id)
        && normalizeIdentity(fact.supplier_part_number) === normalizeIdentity(supplierIdentity.supplier_part_number))
      .map((fact, index) => {
        const key = `${sampleId}:${entry.candidate.candidate_id}:${fact.supplier_id}:${fact.supplier_part_number}:${index}`;
        return Object.freeze({
          mapping_id: stableId("supplier-mapping-version", key),
          mapping_uid: stableUuid("supplier-mapping", key),
          mapping_version_no: 1,
          mapping_row_version: 1,
          content_digest: canonicalDigest({
            supplier_id: fact.supplier_id,
            supplier_part_number: fact.supplier_part_number,
            candidate_id: entry.candidate.candidate_id,
            status: fact.status,
          }),
          mapping_status: fact.status,
          supplier_id: supplierId!,
          supplier_item_code: supplierIdentity.supplier_part_number,
          material_id: projected.material_id,
          purchase_unit_id: null,
          purchase_unit_code: null,
          conversion_numerator: "1",
          conversion_denominator: "1",
          supplier_code: suppliers[0].supplier_code,
          supplier_status: "ACTIVE",
          supplier_version: 1,
          internal_material_code: projected.internal_material_code,
          material_status: projected.material_status,
          version: 1,
          governance_material_candidate_id: projected.id,
          candidate_kind: "EXACT_IDENTITY",
          candidate_digest: projected.candidate_digest,
          material_version_snapshot: 1,
        });
      });
  }) : [];

  const groupKey = governed.identityDigest ?? canonicalDigest({
    unresolved_source: governed.source.sourceKey,
    rule_version: governed.ruleVersion,
  });
  const normalizationResultDigest = canonicalDigest({
    projection_version: SUGGESTION_LAYER_PROJECTION_VERSION,
    source_snapshot_digest: sourceSnapshotDigest,
    specs: specs.map((spec) => ({
      component_code: spec.component_code,
      normalized_value: spec.normalized_value,
      canonical_unit: spec.canonical_unit,
    })),
  });
  const governanceResultDigest = canonicalDigest(governedDigestProjection(governed));
  const normalizationLineage = specs.map((spec, index) => Object.freeze({
    id: stableId("normalization-lineage", `${sampleId}:${spec.component_code}:${index}`),
    normalized_row_id: stableId("normalized-row", sampleId),
    target_namespace: "ATTRIBUTE",
    target_field_code: spec.component_code,
    target_attribute_code: spec.component_code,
    source_row_number: 1,
    source_column_index: null,
    mapping_digest: canonicalDigest({ component_code: spec.component_code, source_snapshot_digest: sourceSnapshotDigest }),
    transformation_rule_code: "SYNTHETIC_DETERMINISTIC_COMPONENT",
    transformation_rule_version: governed.ruleVersion,
    lineage_ordinal: index + 1,
    source_key: governed.source.sourceKey,
    source_snapshot_digest: sourceSnapshotDigest,
  }));

  const categoryById = new Map<number, GovernanceCategory>(CATEGORY_ROWS.map((row) => [row.id, row.category_code]));
  const attributeById = new Map<number, string>(ATTRIBUTE_CATALOG.map((entry) => [entry.id, entry.code]));
  const materialCandidateById = new Map<number, string>(projectedEntries.map((entry, index) => [
    projectedCandidates[index].material_id,
    entry.candidate.candidate_id,
  ]));

  const snapshot: AiSuggestionSourceSnapshot = Object.freeze({
    batch: Object.freeze({ id: batchId, status: "PARSED" }),
    governanceRun: Object.freeze({
      id: runId,
      batch_id: batchId,
      result_digest: governanceResultDigest,
      normalization_result_digest: normalizationResultDigest,
    }),
    group: Object.freeze({
      id: groupId,
      governance_run_id: runId,
      group_key: groupKey,
      version: 1,
      decision_status: "PENDING",
      category: governed.category,
      readiness: governed.readiness,
      identity_digest: governed.identityDigest,
      source_count: 1,
    }),
    rows: Object.freeze([Object.freeze({
      id: rowId,
      normalized_row_id: stableId("normalized-row", sampleId),
      normalized_row_version: 1,
      source_key: governed.source.sourceKey,
      source_snapshot_digest: sourceSnapshotDigest,
      original_supplier: supplierIdentity?.supplier_id ?? governed.source.supplier ?? null,
      supplier_part_number: supplierIdentity?.supplier_part_number ?? governed.source.supplierPartNumber ?? null,
    })]),
    specs: Object.freeze(specs),
    normalizationLineage: Object.freeze(normalizationLineage),
    materialCandidates: Object.freeze(projectedCandidates),
    categories: CATEGORY_ROWS,
    attributeDefinitions: Object.freeze(definitions),
    suppliers: Object.freeze(suppliers),
    supplierMappings: Object.freeze(supplierMappings),
    serverNow: new Date("2000-01-01T00:00:00.000Z"),
  });

  return Object.freeze({
    snapshot,
    context: Object.freeze({
      sample_id: sampleId,
      capability,
      category_by_id: categoryById,
      attribute_by_id: attributeById,
      material_candidate_by_id: materialCandidateById,
      spec_evidence_by_id: specEvidenceById,
      requested_fields: requested,
      query_identity_available: governed.identityDigest !== null && governed.readiness === "READY",
      exact_candidate_ids: sortedUnique(exactCandidates.map((entry) => entry.candidate.candidate_id)),
      scope_allowed_exact_candidate_ids: sortedUnique(scopeAllowedExact.map((entry) => entry.candidate.candidate_id)),
      active_scope_allowed_exact_candidate_ids: sortedUnique(activeScopeAllowedExact
        .map((entry) => entry.candidate.candidate_id)),
      lifecycle_blocked_candidate_ids: sortedUnique(scopeAllowedExact
        .filter((entry) => entry.candidate.status !== "ACTIVE")
        .map((entry) => entry.candidate.candidate_id)),
      scope_blocked_candidate_ids: sortedUnique(exactCandidates
        .filter((entry) => !scopeAllowed(queryScope, entry.candidate.customer_scope))
        .map((entry) => entry.candidate.candidate_id)),
      supplier_matching_fact_candidate_ids: matchingFactCandidateIds,
      supplier_active_fact_candidate_ids: activeFactCandidateIds,
      supplier_inactive_fact_candidate_ids: inactiveFactCandidateIds,
      supplier_fact_lifecycle_blocked_candidate_ids: supplierFactLifecycleBlockedCandidateIds,
      supplier_fact_scope_blocked_candidate_ids: supplierFactScopeBlockedCandidateIds,
      supplier_spec_conflict_candidate_ids: supplierSpecConflictCandidateIds,
      governed_category: governed.category,
      governance_issue_evidence: governanceIssueEvidence,
      issue_evidence_by_component: issueEvidenceByComponent,
    }),
  });
}
