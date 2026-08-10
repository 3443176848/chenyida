import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MATERIAL_GOVERNANCE_LIMITS } from "../../app/lib/material-governance-selfhost/config.ts";
import { GOVERNANCE_CATEGORIES } from "../../app/lib/material-governance-selfhost/types.ts";
import type { GovernanceSourceInput } from "../../app/lib/material-governance-selfhost/types.ts";
import { canonicalDigest, canonicalJson, sha256Hex, sortedUnique } from "./canonical.ts";
import {
  CAPABILITIES,
  CANDIDATE_STATUSES,
  DEIDENTIFICATION_POLICY_VERSION,
  FACT_STATUSES,
  FIELD_STATUSES,
  MANIFEST_SCHEMA,
  RISK_LEVELS,
  SAMPLE_SCHEMA_VERSION,
  SPLITS,
} from "./types.ts";
import type {
  AllowedAction,
  CandidateRecord,
  DatasetManifest,
  DatasetStatistics,
  EvaluationSample,
  EvaluationSplit,
  ExpectedField,
  LoadedDataset,
  ManifestSplit,
  SupplierFact,
} from "./types.ts";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const APPROVED_DATASET_ROOT = path.join(PROJECT_ROOT, "evals", "ai-governance");

const SAMPLE_KEYS = [
  "sample_id",
  "split",
  "capability",
  "scenario",
  "risk_level",
  "material_category",
  "synthetic",
  "deidentified",
  "deidentification_policy_version",
  "input",
  "expected",
  "allowed_action",
  "safety_gate_expectation",
  "evidence_expectation",
] as const;

const SOURCE_KEYS = [
  "sourceKey",
  "model",
  "manufacturerPartNumber",
  "supplierPartNumber",
  "originalPartNumber",
  "materialName",
  "specification",
  "description",
  "categoryHint",
  "brand",
  "manufacturer",
  "supplier",
  "quantity",
  "unit",
  "sourceBom",
] as const;

const SYNTHETIC_IDENTITY_PATTERN = /^(?:SYN|FIXTURE|EXAMPLE)/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,99}$/;

const PROHIBITED_DATA_PATTERNS: readonly Readonly<{ code: string; pattern: RegExp }>[] = Object.freeze([
  { code: "EMAIL", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { code: "URL", pattern: /\b(?:https?|ftp):\/\//i },
  { code: "IP_ADDRESS", pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/ },
  { code: "PHONE", pattern: /(?:\+?86[- ]?)?1[3-9]\d{9}/ },
  { code: "COMPANY_NAME", pattern: /有限公司|股份公司|集团公司/ },
  { code: "BUSINESS_DOCUMENT_ID", pattern: /\b(?:PO|RFQ|UAT)[-_]?\d{3,}\b/i },
  { code: "PRICE_OR_CURRENCY", pattern: /(?:价格|单价|含税|CNY|RMB|USD|EUR|￥|¥|\$)\s*\d/i },
  { code: "AUTHORIZATION", pattern: /\bBearer\s+[A-Za-z0-9._~-]+/i },
  { code: "SECRET_ASSIGNMENT", pattern: /\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{8,}/i },
]);

export class DatasetValidationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "DatasetValidationError";
    this.code = code;
  }
}

function fail(code: string): never {
  throw new DatasetValidationError(code);
}

function plainObject(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[], code: string): void {
  const actual = Object.keys(record).sort((left, right) => left.localeCompare(right, "en"));
  const wanted = [...expected].sort((left, right) => left.localeCompare(right, "en"));
  if (canonicalJson(actual) !== canonicalJson(wanted)) fail(code);
}

function stringValue(value: unknown, code: string, max = 200): string {
  if (typeof value !== "string" || !value || value.length > max || /[\u0000\u007f]/.test(value)) fail(code);
  return value;
}

function nullableString(value: unknown, code: string, max = 200): string | null {
  if (value === null) return null;
  return stringValue(value, code, max);
}

function booleanLiteral<T extends boolean>(value: unknown, expected: T, code: string): T {
  if (value !== expected) fail(code);
  return expected;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], code: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) fail(code);
  return value as T;
}

function positiveInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(code);
  return Number(value);
}

function stringArray(value: unknown, code: string, options: Readonly<{ pattern?: RegExp; allowEmpty?: boolean }> = {}): readonly string[] {
  if (!Array.isArray(value) || (!options.allowEmpty && value.length === 0) || value.length > 64) fail(code);
  const values = value.map((entry) => stringValue(entry, code));
  if (options.pattern && values.some((entry) => !options.pattern!.test(entry))) fail(code);
  if (canonicalJson(values) !== canonicalJson(sortedUnique(values))) fail(`${code}_ORDER_OR_DUPLICATE`);
  return Object.freeze(values);
}

function assertSyntheticIdentity(value: string | null | undefined, code: string): void {
  if (value && !SYNTHETIC_IDENTITY_PATTERN.test(value)) fail(code);
}

function sourceInput(value: unknown): GovernanceSourceInput {
  const record = plainObject(value, "SAMPLE_SOURCE_INVALID");
  const unknown = Object.keys(record).filter((key) => !(SOURCE_KEYS as readonly string[]).includes(key));
  if (unknown.length) fail("SAMPLE_SOURCE_UNKNOWN_FIELD");
  const sourceKey = stringValue(record.sourceKey, "SAMPLE_SOURCE_KEY_INVALID", MATERIAL_GOVERNANCE_LIMITS.maxSourceKeyLength);
  assertSyntheticIdentity(sourceKey, "SAMPLE_SOURCE_IDENTITY_NOT_SYNTHETIC");
  const output: { sourceKey: string } & Record<string, string | null> = { sourceKey };
  for (const key of SOURCE_KEYS) {
    if (key === "sourceKey" || !Object.hasOwn(record, key)) continue;
    const raw = record[key];
    if (raw !== null && typeof raw !== "string") fail("SAMPLE_SOURCE_FIELD_INVALID");
    if (typeof raw === "string" && (raw.length > MATERIAL_GOVERNANCE_LIMITS.maxSourceFieldLength || /[\u0000\u007f]/.test(raw))) {
      fail("SAMPLE_SOURCE_FIELD_INVALID");
    }
    output[key] = raw as string | null;
  }
  for (const key of ["model", "manufacturerPartNumber", "supplierPartNumber", "originalPartNumber", "materialName", "brand", "manufacturer", "supplier", "sourceBom"] as const) {
    assertSyntheticIdentity(output[key], "SAMPLE_SOURCE_IDENTITY_NOT_SYNTHETIC");
  }
  return Object.freeze(output) as GovernanceSourceInput;
}

function supplierFact(value: unknown): SupplierFact {
  const record = plainObject(value, "SAMPLE_SUPPLIER_FACT_INVALID");
  exactKeys(record, ["supplier_id", "supplier_part_number", "status"], "SAMPLE_SUPPLIER_FACT_UNKNOWN_FIELD");
  const supplierId = stringValue(record.supplier_id, "SAMPLE_SUPPLIER_ID_INVALID");
  const supplierPartNumber = stringValue(record.supplier_part_number, "SAMPLE_SUPPLIER_PART_INVALID");
  assertSyntheticIdentity(supplierId, "SAMPLE_SUPPLIER_IDENTITY_NOT_SYNTHETIC");
  assertSyntheticIdentity(supplierPartNumber, "SAMPLE_SUPPLIER_IDENTITY_NOT_SYNTHETIC");
  return Object.freeze({
    supplier_id: supplierId,
    supplier_part_number: supplierPartNumber,
    status: enumValue(record.status, FACT_STATUSES, "SAMPLE_SUPPLIER_FACT_STATUS_INVALID"),
  });
}

function candidateRecord(value: unknown): CandidateRecord {
  const record = plainObject(value, "SAMPLE_CANDIDATE_INVALID");
  exactKeys(record, ["candidate_id", "status", "customer_scope", "source", "supplier_facts"], "SAMPLE_CANDIDATE_UNKNOWN_FIELD");
  const candidateId = stringValue(record.candidate_id, "SAMPLE_CANDIDATE_ID_INVALID");
  const customerScope = stringValue(record.customer_scope, "SAMPLE_CUSTOMER_SCOPE_INVALID");
  assertSyntheticIdentity(candidateId, "SAMPLE_CANDIDATE_IDENTITY_NOT_SYNTHETIC");
  if (customerScope !== "GENERAL") assertSyntheticIdentity(customerScope, "SAMPLE_CUSTOMER_IDENTITY_NOT_SYNTHETIC");
  if (!Array.isArray(record.supplier_facts) || record.supplier_facts.length > 20) fail("SAMPLE_SUPPLIER_FACTS_INVALID");
  const facts = record.supplier_facts.map(supplierFact);
  const factKeys = facts.map((fact) => `${fact.supplier_id}\u0000${fact.supplier_part_number}\u0000${fact.status}`);
  if (canonicalJson(factKeys) !== canonicalJson(sortedUnique(factKeys))) fail("SAMPLE_SUPPLIER_FACT_ORDER_OR_DUPLICATE");
  return Object.freeze({
    candidate_id: candidateId,
    status: enumValue(record.status, CANDIDATE_STATUSES, "SAMPLE_CANDIDATE_STATUS_INVALID"),
    customer_scope: customerScope,
    source: sourceInput(record.source),
    supplier_facts: Object.freeze(facts),
  });
}

function candidateCatalog(value: unknown): readonly CandidateRecord[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) fail("SAMPLE_CANDIDATE_CATALOG_INVALID");
  const candidates = value.map(candidateRecord);
  const ids = candidates.map((candidate) => candidate.candidate_id);
  if (canonicalJson(ids) !== canonicalJson(sortedUnique(ids))) fail("SAMPLE_CANDIDATE_ORDER_OR_DUPLICATE");
  return Object.freeze(candidates);
}

function expectedField(value: unknown): ExpectedField {
  const record = plainObject(value, "SAMPLE_EXPECTED_FIELD_INVALID");
  exactKeys(record, ["code", "status", "normalized_value", "canonical_unit"], "SAMPLE_EXPECTED_FIELD_UNKNOWN_FIELD");
  const code = stringValue(record.code, "SAMPLE_EXPECTED_FIELD_CODE_INVALID");
  if (!CODE_PATTERN.test(code)) fail("SAMPLE_EXPECTED_FIELD_CODE_INVALID");
  const status = enumValue(record.status, FIELD_STATUSES, "SAMPLE_EXPECTED_FIELD_STATUS_INVALID");
  const normalizedValue = nullableString(record.normalized_value, "SAMPLE_EXPECTED_FIELD_VALUE_INVALID");
  const canonicalUnit = nullableString(record.canonical_unit, "SAMPLE_EXPECTED_FIELD_UNIT_INVALID", 40);
  if ((status === "VALUE") !== (normalizedValue !== null)) fail("SAMPLE_EXPECTED_FIELD_STATE_INVALID");
  if (status === "ABSTAIN" && canonicalUnit !== null) fail("SAMPLE_EXPECTED_FIELD_STATE_INVALID");
  return Object.freeze({ code, status, normalized_value: normalizedValue, canonical_unit: canonicalUnit });
}

function validateProhibitedData(sample: Record<string, unknown>): void {
  const serialized = canonicalJson(sample);
  for (const prohibited of PROHIBITED_DATA_PATTERNS) {
    if (prohibited.pattern.test(serialized)) fail(`SAMPLE_PROHIBITED_DATA_${prohibited.code}`);
  }
}

export function parseEvaluationSample(value: unknown): EvaluationSample {
  const record = plainObject(value, "SAMPLE_INVALID");
  exactKeys(record, SAMPLE_KEYS, "SAMPLE_UNKNOWN_FIELD");
  const split = enumValue(record.split, SPLITS, "SAMPLE_SPLIT_INVALID");
  const prefix = split === "calibration" ? "SYN-CAL-" : "SYN-HOLD-";
  const sampleId = stringValue(record.sample_id, "SAMPLE_ID_INVALID");
  if (!new RegExp(`^${prefix}\\d{3}$`).test(sampleId)) fail("SAMPLE_ID_INVALID");
  const capability = enumValue(record.capability, CAPABILITIES, "SAMPLE_CAPABILITY_INVALID");
  const scenario = stringValue(record.scenario, "SAMPLE_SCENARIO_INVALID", 100);
  if (!/^[a-z][a-z0-9_]{2,99}$/.test(scenario)) fail("SAMPLE_SCENARIO_INVALID");
  const riskLevel = enumValue(record.risk_level, RISK_LEVELS, "SAMPLE_RISK_INVALID");
  const materialCategory = enumValue(record.material_category, [...GOVERNANCE_CATEGORIES, "UNKNOWN"] as const, "SAMPLE_CATEGORY_INVALID");
  booleanLiteral(record.synthetic, true, "SAMPLE_SYNTHETIC_REQUIRED");
  booleanLiteral(record.deidentified, true, "SAMPLE_DEIDENTIFIED_REQUIRED");
  if (record.deidentification_policy_version !== DEIDENTIFICATION_POLICY_VERSION) fail("SAMPLE_DEIDENTIFICATION_POLICY_INVALID");
  const allowedAction = enumValue(record.allowed_action, ["SUGGEST", "ABSTAIN"] as const, "SAMPLE_ALLOWED_ACTION_INVALID") as AllowedAction;

  const safety = plainObject(record.safety_gate_expectation, "SAMPLE_SAFETY_EXPECTATION_INVALID");
  exactKeys(safety, ["formal_write_allowed", "human_review_required", "must_abstain", "external_transmission_allowed"], "SAMPLE_SAFETY_EXPECTATION_UNKNOWN_FIELD");
  booleanLiteral(safety.formal_write_allowed, false, "SAMPLE_FORMAL_WRITE_MUST_BE_FALSE");
  booleanLiteral(safety.human_review_required, true, "SAMPLE_HUMAN_REVIEW_REQUIRED");
  booleanLiteral(safety.external_transmission_allowed, false, "SAMPLE_EXTERNAL_TRANSMISSION_MUST_BE_FALSE");
  if (typeof safety.must_abstain !== "boolean" || safety.must_abstain !== (allowedAction === "ABSTAIN")) fail("SAMPLE_MUST_ABSTAIN_MISMATCH");

  const evidence = plainObject(record.evidence_expectation, "SAMPLE_EVIDENCE_EXPECTATION_INVALID");
  exactKeys(evidence, ["minimum_codes"], "SAMPLE_EVIDENCE_EXPECTATION_UNKNOWN_FIELD");
  const minimumCodes = stringArray(evidence.minimum_codes, "SAMPLE_EVIDENCE_CODE_INVALID", { pattern: CODE_PATTERN, allowEmpty: false });

  const input = plainObject(record.input, "SAMPLE_INPUT_INVALID");
  const expected = plainObject(record.expected, "SAMPLE_EXPECTED_INVALID");
  let parsedInput: Record<string, unknown>;
  let parsedExpected: Record<string, unknown>;

  if (capability === "CLASSIFICATION") {
    exactKeys(input, ["source"], "SAMPLE_INPUT_UNKNOWN_FIELD");
    exactKeys(expected, ["category"], "SAMPLE_EXPECTED_UNKNOWN_FIELD");
    const category = expected.category === null ? null : enumValue(expected.category, GOVERNANCE_CATEGORIES, "SAMPLE_EXPECTED_CATEGORY_INVALID");
    if ((category !== null) !== (allowedAction === "SUGGEST")) fail("SAMPLE_EXPECTED_ACTION_MISMATCH");
    if (category !== null && category !== materialCategory) fail("SAMPLE_EXPECTED_CATEGORY_MISMATCH");
    parsedInput = { source: sourceInput(input.source) };
    parsedExpected = { category };
  } else if (capability === "ATTRIBUTE_EXTRACTION") {
    exactKeys(input, ["source", "target_fields"], "SAMPLE_INPUT_UNKNOWN_FIELD");
    exactKeys(expected, ["fields"], "SAMPLE_EXPECTED_UNKNOWN_FIELD");
    const targetFields = stringArray(input.target_fields, "SAMPLE_TARGET_FIELD_INVALID", { pattern: CODE_PATTERN });
    if (!Array.isArray(expected.fields) || expected.fields.length !== targetFields.length) fail("SAMPLE_EXPECTED_FIELDS_INVALID");
    const fields = expected.fields.map(expectedField);
    if (canonicalJson(fields.map((field) => field.code)) !== canonicalJson(targetFields)) fail("SAMPLE_EXPECTED_FIELD_REFERENCE_INVALID");
    const expectedAction = fields.some((field) => field.status === "VALUE") ? "SUGGEST" : "ABSTAIN";
    if (allowedAction !== expectedAction) fail("SAMPLE_EXPECTED_ACTION_MISMATCH");
    parsedInput = { source: sourceInput(input.source), target_fields: targetFields };
    parsedExpected = { fields: Object.freeze(fields) };
  } else {
    const inputKeys = capability === "SUPPLIER_MAPPING"
      ? ["source", "customer_scope", "candidate_catalog", "supplier_identity"]
      : ["source", "customer_scope", "candidate_catalog"];
    exactKeys(input, inputKeys, "SAMPLE_INPUT_UNKNOWN_FIELD");
    exactKeys(expected, ["candidate_ids"], "SAMPLE_EXPECTED_UNKNOWN_FIELD");
    const customerScope = stringValue(input.customer_scope, "SAMPLE_CUSTOMER_SCOPE_INVALID");
    if (customerScope !== "GENERAL") assertSyntheticIdentity(customerScope, "SAMPLE_CUSTOMER_IDENTITY_NOT_SYNTHETIC");
    const catalog = candidateCatalog(input.candidate_catalog);
    const candidateIds = stringArray(expected.candidate_ids, "SAMPLE_EXPECTED_CANDIDATE_INVALID", { allowEmpty: true });
    const catalogIds = new Set(catalog.map((candidate) => candidate.candidate_id));
    if (candidateIds.some((candidateId) => !catalogIds.has(candidateId))) fail("SAMPLE_EXPECTED_CANDIDATE_REFERENCE_BROKEN");
    if ((candidateIds.length > 0) !== (allowedAction === "SUGGEST")) fail("SAMPLE_EXPECTED_ACTION_MISMATCH");
    parsedInput = { source: sourceInput(input.source), customer_scope: customerScope, candidate_catalog: catalog };
    if (capability === "SUPPLIER_MAPPING") {
      const supplier = plainObject(input.supplier_identity, "SAMPLE_SUPPLIER_IDENTITY_INVALID");
      exactKeys(supplier, ["supplier_id", "supplier_part_number"], "SAMPLE_SUPPLIER_IDENTITY_UNKNOWN_FIELD");
      const supplierId = stringValue(supplier.supplier_id, "SAMPLE_SUPPLIER_ID_INVALID");
      const supplierPartNumber = stringValue(supplier.supplier_part_number, "SAMPLE_SUPPLIER_PART_INVALID");
      assertSyntheticIdentity(supplierId, "SAMPLE_SUPPLIER_IDENTITY_NOT_SYNTHETIC");
      assertSyntheticIdentity(supplierPartNumber, "SAMPLE_SUPPLIER_IDENTITY_NOT_SYNTHETIC");
      parsedInput.supplier_identity = Object.freeze({ supplier_id: supplierId, supplier_part_number: supplierPartNumber });
    }
    parsedExpected = { candidate_ids: candidateIds };
  }

  const parsed = Object.freeze({
    sample_id: sampleId,
    split,
    capability,
    scenario,
    risk_level: riskLevel,
    material_category: materialCategory,
    synthetic: true,
    deidentified: true,
    deidentification_policy_version: DEIDENTIFICATION_POLICY_VERSION,
    input: Object.freeze(parsedInput),
    expected: Object.freeze(parsedExpected),
    allowed_action: allowedAction,
    safety_gate_expectation: Object.freeze({
      formal_write_allowed: false,
      human_review_required: true,
      must_abstain: safety.must_abstain as boolean,
      external_transmission_allowed: false,
    }),
    evidence_expectation: Object.freeze({ minimum_codes: minimumCodes }),
  });
  validateProhibitedData(parsed);
  return parsed as EvaluationSample;
}

function countBy(samples: readonly EvaluationSample[], key: "capability" | "material_category" | "scenario" | "risk_level"): Readonly<Record<string, number>> {
  const counts = new Map<string, number>();
  for (const sample of samples) counts.set(sample[key], (counts.get(sample[key]) ?? 0) + 1);
  return Object.freeze(Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right, "en"))));
}

export function datasetStatistics(samples: readonly EvaluationSample[]): DatasetStatistics {
  return Object.freeze({
    capability: countBy(samples, "capability"),
    material_category: countBy(samples, "material_category"),
    scenario: countBy(samples, "scenario"),
    risk_level: countBy(samples, "risk_level"),
  });
}

function countMap(value: unknown, code: string): Readonly<Record<string, number>> {
  const record = plainObject(value, code);
  const entries = Object.entries(record);
  if (!entries.length) fail(code);
  const sorted = [...entries].sort(([left], [right]) => left.localeCompare(right, "en"));
  if (canonicalJson(entries.map(([key]) => key)) !== canonicalJson(sorted.map(([key]) => key))) fail(`${code}_ORDER_INVALID`);
  return Object.freeze(Object.fromEntries(entries.map(([key, count]) => [stringValue(key, code), positiveInteger(count, code)])));
}

function statistics(value: unknown): DatasetStatistics {
  const record = plainObject(value, "MANIFEST_STATISTICS_INVALID");
  exactKeys(record, ["capability", "material_category", "scenario", "risk_level"], "MANIFEST_STATISTICS_UNKNOWN_FIELD");
  return Object.freeze({
    capability: countMap(record.capability, "MANIFEST_CAPABILITY_STATISTICS_INVALID"),
    material_category: countMap(record.material_category, "MANIFEST_CATEGORY_STATISTICS_INVALID"),
    scenario: countMap(record.scenario, "MANIFEST_SCENARIO_STATISTICS_INVALID"),
    risk_level: countMap(record.risk_level, "MANIFEST_RISK_STATISTICS_INVALID"),
  });
}

function manifestSplit(value: unknown, split: EvaluationSplit): ManifestSplit {
  const record = plainObject(value, "MANIFEST_SPLIT_INVALID");
  exactKeys(record, ["file", "sha256", "sample_count", "statistics"], "MANIFEST_SPLIT_UNKNOWN_FIELD");
  const expectedFile = `${split}.jsonl`;
  if (record.file !== expectedFile) fail("MANIFEST_SPLIT_FILE_INVALID");
  const digest = stringValue(record.sha256, "MANIFEST_SPLIT_DIGEST_INVALID");
  if (!SHA256_PATTERN.test(digest)) fail("MANIFEST_SPLIT_DIGEST_INVALID");
  return Object.freeze({
    file: expectedFile,
    sha256: digest,
    sample_count: positiveInteger(record.sample_count, "MANIFEST_SAMPLE_COUNT_INVALID"),
    statistics: statistics(record.statistics),
  });
}

export function parseDatasetManifest(value: unknown): DatasetManifest {
  const record = plainObject(value, "MANIFEST_INVALID");
  exactKeys(record, [
    "schema",
    "dataset_id",
    "version",
    "created_at",
    "deidentification_policy_version",
    "sample_schema_version",
    "canonical_json_version",
    "dataset_digest_rule",
    "holdout_policy",
    "splits",
    "dataset_digest",
  ], "MANIFEST_UNKNOWN_FIELD");
  if (record.schema !== MANIFEST_SCHEMA) fail("MANIFEST_SCHEMA_INVALID");
  const datasetId = stringValue(record.dataset_id, "MANIFEST_DATASET_ID_INVALID");
  if (!/^synthetic-[a-z0-9-]{3,80}$/.test(datasetId)) fail("MANIFEST_DATASET_ID_INVALID");
  const version = stringValue(record.version, "MANIFEST_VERSION_INVALID");
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail("MANIFEST_VERSION_INVALID");
  const createdAt = stringValue(record.created_at, "MANIFEST_CREATED_AT_INVALID");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(createdAt)) fail("MANIFEST_CREATED_AT_INVALID");
  if (record.deidentification_policy_version !== DEIDENTIFICATION_POLICY_VERSION) fail("MANIFEST_DEIDENTIFICATION_POLICY_INVALID");
  if (record.sample_schema_version !== SAMPLE_SCHEMA_VERSION) fail("MANIFEST_SAMPLE_SCHEMA_INVALID");
  if (record.canonical_json_version !== "canonical-json-lexicographic-v1") fail("MANIFEST_CANONICAL_VERSION_INVALID");
  if (record.dataset_digest_rule !== "sha256(canonical-json(manifest-without-dataset_digest))") fail("MANIFEST_DIGEST_RULE_INVALID");
  if (record.holdout_policy !== "FROZEN_NOT_FOR_TUNING") fail("MANIFEST_HOLDOUT_POLICY_INVALID");
  const splits = plainObject(record.splits, "MANIFEST_SPLITS_INVALID");
  exactKeys(splits, SPLITS, "MANIFEST_SPLITS_UNKNOWN_FIELD");
  const datasetDigest = stringValue(record.dataset_digest, "MANIFEST_DATASET_DIGEST_INVALID");
  if (!SHA256_PATTERN.test(datasetDigest)) fail("MANIFEST_DATASET_DIGEST_INVALID");
  const manifest = Object.freeze({
    schema: MANIFEST_SCHEMA,
    dataset_id: datasetId,
    version,
    created_at: createdAt,
    deidentification_policy_version: DEIDENTIFICATION_POLICY_VERSION,
    sample_schema_version: SAMPLE_SCHEMA_VERSION,
    canonical_json_version: "canonical-json-lexicographic-v1" as const,
    dataset_digest_rule: "sha256(canonical-json(manifest-without-dataset_digest))" as const,
    holdout_policy: "FROZEN_NOT_FOR_TUNING" as const,
    splits: Object.freeze({
      calibration: manifestSplit(splits.calibration, "calibration"),
      holdout: manifestSplit(splits.holdout, "holdout"),
    }),
    dataset_digest: datasetDigest,
  });
  if (manifestDatasetDigest(manifest) !== manifest.dataset_digest) fail("MANIFEST_DATASET_DIGEST_MISMATCH");
  return manifest;
}

export function manifestDatasetDigest(manifest: Omit<DatasetManifest, "dataset_digest"> | DatasetManifest): string {
  const projection: Record<string, unknown> = { ...manifest };
  delete projection.dataset_digest;
  return canonicalDigest(projection);
}

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function assertControlledPath(root: string, target: string, requireTarget = true): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (!within(resolvedRoot, resolvedTarget)) fail("PATH_OUTSIDE_APPROVED_ROOT");
  const relative = path.relative(resolvedRoot, resolvedTarget);
  let current = resolvedRoot;
  const segments = relative ? relative.split(path.sep) : [];
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) fail("SYMLINK_NOT_ALLOWED");
    } catch (error) {
      const systemError = error as NodeJS.ErrnoException;
      if (systemError.code === "ENOENT" && (!requireTarget || index < segments.length - 1)) continue;
      if (systemError.code === "ENOENT" && !requireTarget) continue;
      throw error;
    }
  }
  if (requireTarget) {
    const realRoot = await realpath(resolvedRoot);
    const realTarget = await realpath(resolvedTarget);
    if (!within(realRoot, realTarget)) fail("PATH_OUTSIDE_APPROVED_ROOT");
  }
}

async function readRegularFile(root: string, file: string, maxBytes: number): Promise<Buffer> {
  await assertControlledPath(root, file, true);
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) fail("DATASET_FILE_INVALID");
  return readFile(file);
}

function parseJsonLine(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    fail("DATASET_JSON_INVALID");
  }
}

function parseJsonDocument(content: Buffer): unknown {
  try {
    return JSON.parse(content.toString("utf8")) as unknown;
  } catch {
    fail("MANIFEST_JSON_INVALID");
  }
}

async function loadSplit(directory: string, split: EvaluationSplit, manifest: ManifestSplit): Promise<readonly EvaluationSample[]> {
  const file = path.join(directory, manifest.file);
  const content = await readRegularFile(directory, file, 16 * 1024 * 1024);
  if (sha256Hex(content) !== manifest.sha256) fail("DATASET_SPLIT_DIGEST_MISMATCH");
  const raw = content.toString("utf8");
  if (!raw.endsWith("\n") || raw.includes("\r") || raw.split("\n").slice(0, -1).some((line) => line.length === 0)) fail("DATASET_JSONL_FORMAT_INVALID");
  const samples = raw.split("\n").slice(0, -1).map((line) => parseEvaluationSample(parseJsonLine(line)));
  if (samples.some((sample) => sample.split !== split)) fail("DATASET_SPLIT_LABEL_MISMATCH");
  const ids = samples.map((sample) => sample.sample_id);
  if (canonicalJson(ids) !== canonicalJson(sortedUnique(ids))) fail("DATASET_SAMPLE_ORDER_OR_DUPLICATE");
  if (samples.length !== manifest.sample_count) fail("DATASET_SAMPLE_COUNT_MISMATCH");
  if (canonicalJson(datasetStatistics(samples)) !== canonicalJson(manifest.statistics)) fail("DATASET_STATISTICS_MISMATCH");
  if (samples.length < 32) fail("DATASET_SPLIT_TOO_SMALL");
  for (const capability of CAPABILITIES) {
    if (samples.filter((sample) => sample.capability === capability).length < 8) fail("DATASET_CAPABILITY_STRATUM_TOO_SMALL");
  }
  return Object.freeze(samples);
}

export async function loadDatasetDirectory(directory: string, approvedRoot: string): Promise<LoadedDataset> {
  const resolvedRoot = path.resolve(approvedRoot);
  const resolvedDirectory = path.resolve(directory);
  await assertControlledPath(resolvedRoot, resolvedDirectory, true);
  const directoryStat = await lstat(resolvedDirectory);
  if (!directoryStat.isDirectory()) fail("DATASET_DIRECTORY_INVALID");
  const manifestContent = await readRegularFile(resolvedDirectory, path.join(resolvedDirectory, "manifest.json"), 1024 * 1024);
  const manifest = parseDatasetManifest(parseJsonDocument(manifestContent));
  const calibration = await loadSplit(resolvedDirectory, "calibration", manifest.splits.calibration);
  const holdout = await loadSplit(resolvedDirectory, "holdout", manifest.splits.holdout);
  const allIds = [...calibration, ...holdout].map((sample) => sample.sample_id);
  if (new Set(allIds).size !== allIds.length) fail("DATASET_SAMPLE_ID_DUPLICATE");
  return Object.freeze({
    directory: resolvedDirectory,
    manifest,
    samples: Object.freeze({ calibration, holdout }),
  });
}

export async function loadApprovedDataset(datasetName: string): Promise<LoadedDataset> {
  if (
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(datasetName)
    || datasetName.includes("..")
    || /^[a-z][a-z0-9+.-]*:/i.test(datasetName)
    || datasetName.includes("/")
    || datasetName.includes("\\")
  ) fail("DATASET_NAME_NOT_APPROVED");
  return loadDatasetDirectory(path.join(APPROVED_DATASET_ROOT, datasetName), APPROVED_DATASET_ROOT);
}

export function scanProhibitedData(sample: EvaluationSample): readonly string[] {
  const serialized = canonicalJson(sample);
  return Object.freeze(PROHIBITED_DATA_PATTERNS.filter((entry) => entry.pattern.test(serialized)).map((entry) => entry.code));
}
