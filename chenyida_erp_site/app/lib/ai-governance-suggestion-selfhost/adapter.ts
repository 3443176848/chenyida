import { canonicalDigest, normalizeIdentity, stableSort } from "./canonical.ts";
import { AI_SUGGESTION_LIMITS, AI_SUGGESTION_RULE_VERSION } from "./config.ts";
import type {
  AiGovernanceCapability,
  AiSuggestionCandidate,
  AiSuggestionEvidenceCandidate,
  AiSuggestionEvidenceKind,
  AiSuggestionItemCandidate,
  AiSuggestionSourceSnapshot,
} from "./types.ts";

type Row = Record<string, unknown>;

const number = (value: unknown): number => Number(value);
const text = (value: unknown): string => String(value ?? "").normalize("NFKC").trim();
const nullableText = (value: unknown): string | null => text(value) || null;

function stableTargetDigest(kind: string, row: Row): string {
  if (kind === "CATEGORY") return canonicalDigest({
    kind,
    code: text(row.category_code),
    status: text(row.status),
    version: number(row.version),
  });
  if (kind === "ATTRIBUTE_DEFINITION") return canonicalDigest({
    kind,
    code: text(row.attribute_code),
    data_type: text(row.data_type),
    canonical_unit: text(row.canonical_unit),
    allowed_values_digest: canonicalDigest(Array.isArray(row.allowed_values) ? row.allowed_values : []),
    status: text(row.status),
    version: number(row.version),
  });
  if (kind === "MATERIAL") return canonicalDigest({
    kind,
    internal_material_code: text(row.internal_material_code),
    status: text(row.material_status),
    version: number(row.version),
  });
  if (kind === "SUPPLIER") return canonicalDigest({
    kind,
    supplier_code: text(row.supplier_code),
    status: text(row.supplier_status ?? row.status),
    version: number(row.supplier_version ?? row.version),
  });
  return canonicalDigest({
    kind,
    mapping_uid: text(row.mapping_uid),
    mapping_version_no: number(row.mapping_version_no),
    row_version: number(row.mapping_row_version ?? row.version),
    content_digest: nullableText(row.content_digest),
    status: text(row.mapping_status ?? row.status),
  });
}

export function deriveAiSuggestionInputDigests(
  source: AiSuggestionSourceSnapshot,
  capability: AiGovernanceCapability,
): Readonly<{ groupInputDigest: string; inputDigest: string }> {
  const rows = stableSort(source.rows, (row) => [text(row.source_key), text(row.source_snapshot_digest)]).map((row) => ({
    source_key: text(row.source_key),
    source_snapshot_digest: text(row.source_snapshot_digest),
    normalized_row_version: number(row.normalized_row_version ?? 1),
  }));
  const specs = stableSort(source.specs, (row) => [text(row.source_key), text(row.component_code)]).map((row) => ({
    source_key: text(row.source_key),
    source_snapshot_digest: text(row.source_snapshot_digest),
    component_code: text(row.component_code),
    component_role: text(row.component_role),
    value_digest: canonicalDigest({
      normalized_value: text(row.normalized_value),
      canonical_unit: nullableText(row.canonical_unit),
    }),
  }));
  const normalizationLineage = stableSort(source.normalizationLineage, (row) => [
    text(row.source_key),
    text(row.target_namespace),
    text(row.target_field_code),
    text(row.target_attribute_code),
    number(row.lineage_ordinal),
  ]).map((row) => ({
    source_key: text(row.source_key),
    target_namespace: text(row.target_namespace),
    target_field_code: text(row.target_field_code),
    target_attribute_code: nullableText(row.target_attribute_code),
    source_row_number: number(row.source_row_number),
    source_column_index: row.source_column_index == null ? null : number(row.source_column_index),
    mapping_digest: text(row.mapping_digest),
    transformation_rule_code: text(row.transformation_rule_code),
    transformation_rule_version: text(row.transformation_rule_version),
    lineage_ordinal: number(row.lineage_ordinal),
  }));
  const materialCandidates = stableSort(source.materialCandidates, (row) => [text(row.candidate_kind), number(row.candidate_rank), text(row.candidate_digest)]).map((row) => ({
    candidate_kind: text(row.candidate_kind),
    candidate_rank: number(row.candidate_rank),
    candidate_digest: text(row.candidate_digest),
    material_target_digest: stableTargetDigest("MATERIAL", row),
  }));
  const groupInput = {
    governance_run_result_digest: text(source.governanceRun.result_digest),
    normalization_result_digest: text(source.governanceRun.normalization_result_digest),
    group_key: text(source.group.group_key),
    group_version: number(source.group.version),
    category: text(source.group.category),
    readiness: text(source.group.readiness),
    identity_digest: nullableText(source.group.identity_digest),
    rows,
    specs,
    normalization_lineage: normalizationLineage,
    material_candidates: materialCandidates,
  };
  const groupInputDigest = canonicalDigest(groupInput);
  const targets = capability === "CLASSIFICATION"
    ? stableSort(source.categories, (row) => text(row.category_code)).map((row) => stableTargetDigest("CATEGORY", row))
    : capability === "ATTRIBUTE_EXTRACTION"
      ? stableSort(source.attributeDefinitions, (row) => text(row.attribute_code)).map((row) => stableTargetDigest("ATTRIBUTE_DEFINITION", row))
      : capability === "MATERIAL_MATCH"
        ? materialCandidates.map((row) => row.material_target_digest)
        : stableSort(source.supplierMappings, (row) => [text(row.mapping_uid), number(row.mapping_version_no)]).map((row) => ({
          supplier_part_key_digest: canonicalDigest(normalizeIdentity(row.supplier_item_code)),
          supplier_digest: stableTargetDigest("SUPPLIER", row),
          material_digest: stableTargetDigest("MATERIAL", row),
          mapping_digest: stableTargetDigest("SUPPLIER_MAPPING", row),
        }));
  return Object.freeze({
    groupInputDigest,
    inputDigest: canonicalDigest({ capability, group_input_digest: groupInputDigest, targets }),
  });
}

function evidence(
  evidenceKind: AiSuggestionEvidenceKind,
  safeFieldPath: string,
  sourceDigest: string,
  locator: Record<string, unknown>,
  references: Omit<AiSuggestionEvidenceCandidate, "evidenceKind" | "safeFieldPath" | "sourceDigest" | "locatorDigest" | "evidenceDigest"> = {},
): AiSuggestionEvidenceCandidate {
  const locatorDigest = canonicalDigest(locator);
  const evidenceDigest = canonicalDigest({
    evidence_kind: evidenceKind,
    safe_field_path: safeFieldPath,
    source_digest: sourceDigest,
    locator_digest: locatorDigest,
    observed_version_no: references.observedVersionNo ?? null,
    rule_trace_code: references.ruleTraceCode ?? null,
    rule_trace_version: references.ruleTraceVersion ?? null,
  });
  return Object.freeze({ evidenceKind, safeFieldPath, sourceDigest, locatorDigest, evidenceDigest, ...references });
}

function ruleEvidence(path: string, code: string): AiSuggestionEvidenceCandidate {
  const sourceDigest = canonicalDigest({ rule_version: AI_SUGGESTION_RULE_VERSION, rule_trace_code: code });
  return evidence("RULE_TRACE", path, sourceDigest, { rule_trace_code: code, rule_version: AI_SUGGESTION_RULE_VERSION }, {
    ruleTraceCode: code,
    ruleTraceVersion: AI_SUGGESTION_RULE_VERSION,
  });
}

function rowEvidence(row: Row, path: string): AiSuggestionEvidenceCandidate {
  return evidence("GOVERNANCE_ROW", path, text(row.source_snapshot_digest), {
    source_key: text(row.source_key),
    safe_field_path: path,
  }, { governanceRowId: number(row.id) });
}

function specEvidence(spec: Row): AiSuggestionEvidenceCandidate {
  const sourceDigest = canonicalDigest({
    source_snapshot_digest: text(spec.source_snapshot_digest),
    component_code: text(spec.component_code),
    normalized_value: text(spec.normalized_value),
    canonical_unit: nullableText(spec.canonical_unit),
  });
  return evidence("GOVERNANCE_SPEC", `spec.${text(spec.component_code)}`, sourceDigest, {
    source_key: text(spec.source_key),
    component_code: text(spec.component_code),
  }, { governanceSpecId: number(spec.id) });
}

function abstain(reason: string): AiSuggestionCandidate {
  return Object.freeze({
    disposition: "ABSTAIN",
    abstainReasonCode: reason,
    items: Object.freeze([]),
    payloadDigest: canonicalDigest({ disposition: "ABSTAIN", abstain_reason_code: reason, items: [] }),
  });
}

function suggest(items: readonly AiSuggestionItemCandidate[]): AiSuggestionCandidate {
  const payload = items.map((item) => ({
    item_digest: item.itemDigest,
    evidence_digests: item.evidence.map((entry) => entry.evidenceDigest),
  }));
  return Object.freeze({
    disposition: "SUGGEST",
    abstainReasonCode: null,
    items: Object.freeze([...items]),
    payloadDigest: canonicalDigest({ disposition: "SUGGEST", abstain_reason_code: null, items: payload }),
  });
}

function classification(source: AiSuggestionSourceSnapshot): AiSuggestionCandidate {
  const categoryCode = text(source.group.category);
  if (categoryCode === "OTHER" || categoryCode === "MECH") return abstain("CLASSIFICATION_UNSUPPORTED_CATEGORY");
  const targets = source.categories.filter((row) => text(row.status) === "ACTIVE" && text(row.category_code) === categoryCode);
  if (targets.length !== 1 || source.rows.length === 0) return abstain(targets.length > 1 ? "CLASSIFICATION_TARGET_AMBIGUOUS" : "CLASSIFICATION_TARGET_NOT_FOUND");
  const target = targets[0];
  const categoryDigest = stableTargetDigest("CATEGORY", target);
  const itemFact = {
    item_kind: "CLASSIFICATION",
    candidate_rank: 1,
    category_code: categoryCode,
    category_version_snapshot: number(target.version),
    category_status_snapshot: "ACTIVE",
    category_digest: categoryDigest,
    score: null,
  };
  const item: AiSuggestionItemCandidate = Object.freeze({
    itemKind: "CLASSIFICATION",
    candidateRank: 1,
    itemDigest: canonicalDigest(itemFact),
    categoryId: number(target.id),
    categoryVersionSnapshot: number(target.version),
    categoryStatusSnapshot: "ACTIVE",
    categoryDigest,
    evidence: Object.freeze([
      rowEvidence(source.rows[0], "group.category"),
      ruleEvidence("rule.classification", "CLASSIFICATION_UNIQUE_ACTIVE_CATEGORY"),
    ]),
  });
  return suggest([item]);
}

type TypedAttributeValue = Readonly<{
  valueText?: string;
  valueInteger?: number;
  valueDecimal?: string;
  valueBoolean?: boolean;
  valueDate?: string;
}>;

function normalizedDecimal(value: string): string | null {
  if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) return null;
  const [integerPart, fraction = ""] = value.split(".");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${integerPart}.${normalizedFraction}` : integerPart;
}

function typedAttributeValue(definition: Row, rawValue: string): TypedAttributeValue | null {
  const dataType = text(definition.data_type);
  if (!rawValue || rawValue.length > 500) return null;
  if (dataType === "TEXT") return Object.freeze({ valueText: rawValue });
  if (dataType === "ENUM") {
    const allowed = Array.isArray(definition.allowed_values) ? definition.allowed_values.map((value) => normalizeIdentity(value)) : [];
    return allowed.includes(normalizeIdentity(rawValue)) ? Object.freeze({ valueText: rawValue }) : null;
  }
  if (dataType === "INTEGER") {
    if (!/^-?(?:0|[1-9][0-9]*)$/.test(rawValue)) return null;
    const value = Number(rawValue);
    return Number.isSafeInteger(value) ? Object.freeze({ valueInteger: value }) : null;
  }
  if (dataType === "DECIMAL") {
    const value = normalizedDecimal(rawValue);
    if (value === null || value.replace(/[-.]/g, "").length > 38) return null;
    const scale = Number(definition.decimal_scale ?? 0);
    if ((value.split(".")[1]?.length ?? 0) > scale) return null;
    return Object.freeze({ valueDecimal: value });
  }
  if (dataType === "BOOLEAN") {
    const value = normalizeIdentity(rawValue);
    return value === "TRUE" || value === "1" ? Object.freeze({ valueBoolean: true })
      : value === "FALSE" || value === "0" ? Object.freeze({ valueBoolean: false }) : null;
  }
  if (dataType === "DATE") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) return null;
    const date = new Date(`${rawValue}T00:00:00.000Z`);
    return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== rawValue ? null : Object.freeze({ valueDate: rawValue });
  }
  return null;
}

function attributeExtraction(source: AiSuggestionSourceSnapshot): AiSuggestionCandidate {
  const definitions = new Map<string, Row[]>();
  for (const row of source.attributeDefinitions) {
    const code = text(row.attribute_code);
    definitions.set(code, [...(definitions.get(code) ?? []), row]);
  }
  const candidates: Array<{ spec: Row; definition: Row; value: TypedAttributeValue; valueUnitCode?: string }> = [];
  for (const spec of stableSort(source.specs, (row) => [text(row.component_code), text(row.source_key)])) {
    const matches = (definitions.get(text(spec.component_code)) ?? []).filter((row) => text(row.status) === "ACTIVE");
    if (matches.length !== 1) continue;
    const definition = matches[0];
    const definitionUnit = text(definition.canonical_unit);
    const specUnit = text(spec.canonical_unit);
    if ((definitionUnit && normalizeIdentity(definitionUnit) !== normalizeIdentity(specUnit)) || (!definitionUnit && specUnit)) continue;
    const value = typedAttributeValue(definition, text(spec.normalized_value));
    if (!value) continue;
    candidates.push({ spec, definition, value, ...(definitionUnit ? { valueUnitCode: definitionUnit } : {}) });
  }
  if (candidates.length === 0) return abstain("ATTRIBUTE_EVIDENCE_INSUFFICIENT");
  if (candidates.length > AI_SUGGESTION_LIMITS.maximumItems) return abstain("ATTRIBUTE_ITEM_LIMIT_EXCEEDED");
  const items = candidates.map(({ spec, definition, value, valueUnitCode }): AiSuggestionItemCandidate => {
    const attributeValueType = text(definition.data_type) as AiSuggestionItemCandidate["attributeValueType"];
    const attributeDefinitionDigest = stableTargetDigest("ATTRIBUTE_DEFINITION", definition);
    const attributeValueDigest = canonicalDigest({
      attribute_code: text(definition.attribute_code),
      attribute_value_type: attributeValueType,
      value,
      value_unit_code: valueUnitCode ?? null,
    });
    const itemFact = {
      item_kind: "ATTRIBUTE_EXTRACTION",
      candidate_rank: 1,
      attribute_code: text(definition.attribute_code),
      attribute_definition_version_snapshot: number(definition.version),
      attribute_definition_digest: attributeDefinitionDigest,
      attribute_value_type: attributeValueType,
      attribute_value_digest: attributeValueDigest,
      value,
      value_unit_code: valueUnitCode ?? null,
      score: null,
    };
    return Object.freeze({
      itemKind: "ATTRIBUTE_EXTRACTION",
      candidateRank: 1,
      itemDigest: canonicalDigest(itemFact),
      attributeDefinitionId: number(definition.id),
      attributeDefinitionVersionSnapshot: number(definition.version),
      attributeStatusSnapshot: "ACTIVE",
      attributeValueType,
      ...value,
      ...(valueUnitCode ? { valueUnitCode } : {}),
      attributeValueDigest,
      evidence: Object.freeze([
        specEvidence(spec),
        ruleEvidence(`rule.attribute.${text(definition.attribute_code)}`, "ATTRIBUTE_STRICT_TYPED_VALUE"),
      ]),
    });
  });
  return suggest(items);
}

function materialMatch(source: AiSuggestionSourceSnapshot): AiSuggestionCandidate {
  if (text(source.group.readiness) !== "READY" || !text(source.group.identity_digest)) return abstain("MATERIAL_QUERY_IDENTITY_UNAVAILABLE");
  const matches = source.materialCandidates.filter((row) =>
    text(row.candidate_kind) === "EXACT_IDENTITY"
    && text(row.material_status_snapshot) === "ACTIVE"
    && text(row.material_status) === "ACTIVE"
    && number(row.material_version_snapshot) === number(row.version));
  if (matches.length !== 1) return abstain(matches.length ? "MATERIAL_EXACT_MATCH_AMBIGUOUS" : "MATERIAL_EXACT_MATCH_NOT_FOUND");
  const target = matches[0];
  const materialDigest = stableTargetDigest("MATERIAL", target);
  const itemFact = {
    item_kind: "MATERIAL_MATCH",
    candidate_rank: 1,
    internal_material_code: text(target.internal_material_code),
    material_version_snapshot: number(target.version),
    material_status_snapshot: "ACTIVE",
    material_digest: materialDigest,
    candidate_digest: text(target.candidate_digest),
    score: null,
  };
  const candidateEvidence = evidence("DETERMINISTIC_MATERIAL_CANDIDATE", "candidate.exact_identity", text(target.candidate_digest), {
    candidate_digest: text(target.candidate_digest),
    group_key: text(source.group.group_key),
  }, { governanceMaterialCandidateId: number(target.id) });
  const materialEvidence = evidence("MATERIAL_VERSION", "material.version", materialDigest, {
    internal_material_code: text(target.internal_material_code),
    material_version: number(target.version),
  }, { materialId: number(target.material_id), observedVersionNo: number(target.version) });
  return suggest([Object.freeze({
    itemKind: "MATERIAL_MATCH",
    candidateRank: 1,
    itemDigest: canonicalDigest(itemFact),
    materialId: number(target.material_id),
    materialVersionSnapshot: number(target.version),
    materialStatusSnapshot: "ACTIVE",
    materialDigest,
    evidence: Object.freeze([candidateEvidence, materialEvidence]),
  })]);
}

function supplierMapping(source: AiSuggestionSourceSnapshot): AiSuggestionCandidate {
  if (text(source.group.readiness) !== "READY" || !text(source.group.identity_digest)) return abstain("SUPPLIER_QUERY_IDENTITY_UNAVAILABLE");
  const facts = new Map<string, { supplier: string; part: string; row: Row }>();
  for (const row of source.rows) {
    const supplier = normalizeIdentity(row.original_supplier);
    const part = normalizeIdentity(row.supplier_part_number);
    if (!supplier || !part) continue;
    facts.set(`${supplier}\u0000${part}`, { supplier, part, row });
  }
  if (facts.size !== 1) return abstain(facts.size ? "SUPPLIER_PART_FACT_AMBIGUOUS" : "SUPPLIER_PART_FACT_NOT_FOUND");
  const fact = [...facts.values()][0];
  const suppliers = source.suppliers.filter((row) => text(row.status) === "ACTIVE" && normalizeIdentity(row.normalized_name) === fact.supplier);
  if (suppliers.length !== 1) return abstain(suppliers.length ? "SUPPLIER_ACTIVE_TARGET_AMBIGUOUS" : "SUPPLIER_ACTIVE_TARGET_NOT_FOUND");
  const supplier = suppliers[0];
  const mappings = source.supplierMappings.filter((row) =>
    number(row.supplier_id) === number(supplier.id)
    && normalizeIdentity(row.supplier_item_code) === fact.part
    && text(row.mapping_status) === "ACTIVE"
    && text(row.material_status) === "ACTIVE"
    && text(row.candidate_kind) === "EXACT_IDENTITY"
    && number(row.material_version_snapshot) === number(row.version)
    && (row.purchase_unit_id == null || Boolean(text(row.purchase_unit_code)))
    && number(row.conversion_numerator) > 0
    && number(row.conversion_denominator) > 0);
  if (mappings.length !== 1) return abstain(mappings.length ? "SUPPLIER_MAPPING_AMBIGUOUS" : "SUPPLIER_MAPPING_NOT_FOUND");
  const mapping = mappings[0];
  const materialDigest = stableTargetDigest("MATERIAL", mapping);
  const supplierDigest = stableTargetDigest("SUPPLIER", { ...supplier, supplier_status: supplier.status, supplier_version: supplier.version });
  const supplierPartKeyDigest = canonicalDigest(fact.part);
  const mappingDigest = stableTargetDigest("SUPPLIER_MAPPING", mapping);
  const itemFact = {
    item_kind: "SUPPLIER_MAPPING",
    candidate_rank: 1,
    supplier_code: text(supplier.supplier_code),
    supplier_version_snapshot: number(supplier.version),
    supplier_digest: supplierDigest,
    supplier_part_key_digest: supplierPartKeyDigest,
    internal_material_code: text(mapping.internal_material_code),
    material_version_snapshot: number(mapping.version),
    material_digest: materialDigest,
    mapping_digest: mappingDigest,
    purchase_unit_code: nullableText(mapping.purchase_unit_code),
    conversion_numerator: text(mapping.conversion_numerator),
    conversion_denominator: text(mapping.conversion_denominator),
    score: null,
  };
  const sourceEvidence = rowEvidence(fact.row, "supplier.part_identity");
  const supplierEvidence = evidence("SUPPLIER_VERSION", "supplier.version", supplierDigest, {
    supplier_code: text(supplier.supplier_code),
    supplier_version: number(supplier.version),
  }, { supplierId: number(supplier.id), observedVersionNo: number(supplier.version) });
  const materialEvidence = evidence("MATERIAL_VERSION", "material.version", materialDigest, {
    internal_material_code: text(mapping.internal_material_code),
    material_version: number(mapping.version),
  }, { materialId: number(mapping.material_id), observedVersionNo: number(mapping.version) });
  const mappingEvidence = evidence("SUPPLIER_MAPPING_VERSION", "supplier_mapping.version", mappingDigest, {
    mapping_uid: text(mapping.mapping_uid),
    mapping_version_no: number(mapping.mapping_version_no),
  }, { supplierMappingVersionId: number(mapping.mapping_id), observedVersionNo: number(mapping.mapping_version_no) });
  return suggest([Object.freeze({
    itemKind: "SUPPLIER_MAPPING",
    candidateRank: 1,
    itemDigest: canonicalDigest(itemFact),
    materialId: number(mapping.material_id),
    materialVersionSnapshot: number(mapping.version),
    materialStatusSnapshot: "ACTIVE",
    materialDigest,
    supplierId: number(supplier.id),
    supplierVersionSnapshot: number(supplier.version),
    supplierStatusSnapshot: "ACTIVE",
    supplierDigest,
    supplierPartKeyDigest,
    ...(mapping.purchase_unit_id == null ? {} : {
      purchaseUnitId: number(mapping.purchase_unit_id),
      conversionNumerator: text(mapping.conversion_numerator),
      conversionDenominator: text(mapping.conversion_denominator),
    }),
    evidence: Object.freeze([sourceEvidence, supplierEvidence, materialEvidence, mappingEvidence]),
  })]);
}

export function runLocalDeterministicSuggestion(
  source: AiSuggestionSourceSnapshot,
  capability: AiGovernanceCapability,
): AiSuggestionCandidate {
  if (source.rows.length === 0) return abstain("GOVERNANCE_SOURCE_MISSING");
  if (source.rows.length > AI_SUGGESTION_LIMITS.maximumRows || source.specs.length > AI_SUGGESTION_LIMITS.maximumSpecs || source.normalizationLineage.length > AI_SUGGESTION_LIMITS.maximumLineage || source.materialCandidates.length > AI_SUGGESTION_LIMITS.maximumMaterialCandidates) {
    return abstain("DETERMINISTIC_INPUT_LIMIT_EXCEEDED");
  }
  if (capability === "CLASSIFICATION") return classification(source);
  if (capability === "ATTRIBUTE_EXTRACTION") return attributeExtraction(source);
  if (capability === "MATERIAL_MATCH") return materialMatch(source);
  return supplierMapping(source);
}
