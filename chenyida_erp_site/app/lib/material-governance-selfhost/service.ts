import { createHash } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { MaterialWorkflowService } from "../material-selfhost/service.ts";
import { PostgresMaterialRepository } from "../material-selfhost/repository.ts";
import {
  MATERIAL_GOVERNANCE_CONFIG_DIGEST,
  MATERIAL_GOVERNANCE_CONFIG_SNAPSHOT,
  MATERIAL_GOVERNANCE_LIMITS,
  MATERIAL_GOVERNANCE_RULE_VERSION,
  COMPATIBILITY_REVIEW_PROFILES,
  MASTER_CATEGORY_GOVERNANCE_MAP,
} from "./config.ts";
import {
  compatibilityAnchorKey,
  compatibilityProfileFor,
  compatibilityReviewEvidence,
} from "./compatibility.ts";
import type { CompatibilityTarget } from "./compatibility.ts";
import { governMaterialBatch, governMaterialSource } from "./engine.ts";
import { governanceFailure } from "./errors.ts";
import { FormalMaterialScanLimitError, scanFormalGovernanceMaterials } from "./formal-materials.ts";
import { PostgresMaterialGovernanceRepository } from "./repository.ts";
import { draftSource, materialSource, plainDecimal } from "./source-adapter.ts";
import type { GovernanceActor, GovernanceMutationContext, GovernancePage } from "./api-types.ts";
import type { GovernanceIssue, GovernanceSourceInput } from "./types.ts";

type NormalizedSourceRow = QueryResultRow & Readonly<{
  normalized_row_id: string | number;
  source_row_id: string | number;
  source_sheet_name: string;
  source_row_number: number;
  normalized_payload_hash: string;
  row_status: string;
  batch_no: string;
  original_filename: string | null;
  fields: Record<string, unknown>;
  attributes: Record<string, unknown>;
  normalization_issues: readonly Readonly<{
    id: string | number;
    issue_level: "ERROR" | "WARNING";
    issue_code: string;
    target_code: string;
    safe_message: string;
  }>[];
}>;

const numberValue = (value: unknown): number => Number(value);
const iso = (value: unknown): string | null => value ? new Date(String(value)).toISOString() : null;
const has = (actor: GovernanceActor, permission: string): boolean => actor.permissions.includes("*") || actor.permissions.includes(permission);

function requirePermission(actor: GovernanceActor, permission: string): void {
  if (!has(actor, permission)) governanceFailure("PERMISSION_DENIED", "没有权限执行此操作", 403);
  if (actor.must_change_password && permission !== "material.import.governance.read") {
    governanceFailure("PERMISSION_DENIED", "请先修改密码再执行写操作", 403);
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

const digest = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");

function chunks<T>(values: readonly T[], size = MATERIAL_GOVERNANCE_LIMITS.chunkRows): readonly T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) result.push(values.slice(offset, offset + size));
  return result;
}

type GovernanceMaterialCandidateKind = "EXACT_IDENTITY" | "COMPATIBILITY_REVIEW";
type GovernanceMaterialCandidate = Readonly<{
  material: QueryResultRow;
  kind: GovernanceMaterialCandidateKind;
  evidence: readonly string[];
  blockingIssueCodes: readonly string[];
}>;

async function scanActiveGovernanceMaterials(
  client: Pick<PoolClient, "query">,
  visit: Parameters<typeof scanFormalGovernanceMaterials>[2],
): Promise<void> {
  return scanGovernanceMaterials(client, ["ACTIVE"], visit);
}

async function scanGovernanceMaterials(
  client: Pick<PoolClient, "query">,
  statuses: readonly ("ACTIVE" | "FROZEN" | "INACTIVE")[],
  visit: Parameters<typeof scanFormalGovernanceMaterials>[2],
): Promise<void> {
  try {
    await scanFormalGovernanceMaterials(client, statuses, visit);
  } catch (error) {
    if (error instanceof FormalMaterialScanLimitError) {
      governanceFailure("GOVERNANCE_ACTIVE_MATERIAL_SCAN_LIMIT_EXCEEDED", "可比较的正式物料超过安全扫描上限", 413);
    }
    throw error;
  }
}

function governSources(sources: readonly GovernanceSourceInput[]) {
  try {
    return governMaterialBatch(sources);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "GOVERNANCE_SOURCE_LIMIT_EXCEEDED") governanceFailure(code, "治理来源行超过单次上限", 413);
    if (code === "GOVERNANCE_ALTERNATIVE_LIMIT_EXCEEDED") governanceFailure(code, "替代候选数量超过单次上限，请缩小批次", 413);
    if (code === "GOVERNANCE_SOURCE_KEY_DUPLICATE") governanceFailure(code, "治理来源键重复", 422);
    if (["GOVERNANCE_SOURCE_KEY_INVALID", "GOVERNANCE_SOURCE_FIELD_INVALID", "GOVERNANCE_SOURCE_ISSUE_LIMIT_EXCEEDED"].includes(code)) {
      governanceFailure(code, "治理来源字段不符合规则边界", 422);
    }
    governanceFailure("GOVERNANCE_RULE_EXECUTION_FAILED", "治理规则无法安全处理该批次", 422);
  }
}

function assertKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  const keys = new Set(allowed);
  const unknown = Object.keys(body).find((key) => !keys.has(key));
  if (unknown) governanceFailure("REQUEST_VALIDATION_FAILED", `请求正文包含未知字段：${unknown}`, 400);
}

function positive(value: unknown, field: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) governanceFailure("REQUEST_VALIDATION_FAILED", `${field} 必须是正安全整数`, 400);
  return result;
}

function optionalText(value: unknown, field: string, maximum = 1000, required = false): string {
  if (value == null) {
    if (required) governanceFailure("REQUEST_VALIDATION_FAILED", `${field} 必填`, 400);
    return "";
  }
  if (typeof value !== "string") governanceFailure("REQUEST_VALIDATION_FAILED", `${field} 必须是字符串`, 400);
  const result = value.trim();
  if ((required && !result) || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) {
    governanceFailure("REQUEST_VALIDATION_FAILED", `${field} 为空、过长或包含非法字符`, 400);
  }
  return result;
}

function reasonCode(value: unknown): string {
  const result = optionalText(value, "reason_code", 100, true).toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{2,99}$/.test(result)) governanceFailure("REQUEST_VALIDATION_FAILED", "reason_code 无效", 400);
  return result;
}

function field(row: NormalizedSourceRow, namespace: string, code: string): string {
  const value = row.fields?.[`${namespace}.${code}`];
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const validationStatus = String(record.validation_status ?? "VALID").toUpperCase();
    if (validationStatus === "ERROR" || validationStatus === "EMPTY") return "";
    const candidate = record.candidate ?? record.value ?? record.normalized_value;
    if (typeof candidate === "string" || typeof candidate === "number") return String(candidate).trim();
  }
  return "";
}

function attributeField(row: NormalizedSourceRow, code: string): Readonly<{ value: string; unit: string }> {
  const raw = row.attributes?.[code];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { value: "", unit: "" };
  const record = raw as Record<string, unknown>;
  const validationStatus = String(record.validation_status ?? "VALID").toUpperCase();
  if (validationStatus === "ERROR" || validationStatus === "EMPTY") return { value: "", unit: "" };
  let candidate = record.normalized_value;
  let unit = record.unit_code;
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    const normalized = candidate as Record<string, unknown>;
    candidate = normalized.value ?? normalized.normalized_value;
    unit = normalized.unit ?? normalized.unit_code ?? unit;
  }
  if (typeof candidate !== "string" && typeof candidate !== "number") return { value: "", unit: "" };
  return { value: plainDecimal(candidate), unit: String(unit ?? "").trim() };
}

function attributeSpecification(row: NormalizedSourceRow): string {
  const tokens: string[] = [];
  const add = (code: string, fallbackUnit = "", suffix = ""): void => {
    const item = attributeField(row, code);
    if (item.value) tokens.push(`${item.value}${item.unit || fallbackUnit}${suffix}`);
  };
  add("PACKAGE");
  add("RESISTANCE", "ohm");
  add("CAPACITANCE", "F");
  add("RATED_VOLTAGE", "V");
  add("DIELECTRIC");
  add("INDUCTANCE", "H");
  add("RATED_CURRENT", "A");
  add("POWER", "W");
  add("TOLERANCE", "%");
  add("PIN_COUNT", "", "PIN");
  add("PITCH", "mm");
  add("STRUCTURE");
  add("FREQUENCY", "Hz");
  return tokens.join(" ");
}

function upstreamIssues(row: NormalizedSourceRow): readonly GovernanceIssue[] {
  const items = Array.isArray(row.normalization_issues) ? row.normalization_issues : [];
  const mapped = items.map((entry): GovernanceIssue => ({
    level: entry.issue_level === "ERROR" ? "ERROR" : "WARNING",
    code: String(entry.issue_code),
    field: String(entry.target_code),
    message: String(entry.safe_message).slice(0, 500),
    evidence: [`NORMALIZATION_ISSUE_${numberValue(entry.id)}`],
  }));
  if (row.row_status === "ERROR" && !mapped.some((entry) => entry.level === "ERROR")) {
    return [...mapped, {
      level: "ERROR",
      code: "GOVERNANCE_UPSTREAM_NORMALIZATION_ERROR",
      field: "normalization",
      message: "上游规范化行包含错误，禁止生成可归并身份",
      evidence: [`NORMALIZED_ROW_${numberValue(row.normalized_row_id)}`],
    }];
  }
  return mapped;
}

function quantity(raw: string): Readonly<{ value: string | null; issue: GovernanceIssue | null }> {
  if (!raw) {
    return {
      value: null,
      issue: { level: "WARNING", code: "GOVERNANCE_SOURCE_QUANTITY_MISSING", field: "quantity", message: "BOM 来源数量缺失", evidence: [] },
    };
  }
  if (!/^\d{1,18}(?:\.\d{1,6})?$/.test(raw) || !/[1-9]/.test(raw)) {
    return {
      value: null,
      issue: { level: "WARNING", code: "GOVERNANCE_SOURCE_QUANTITY_INVALID", field: "quantity", message: "BOM 来源数量不是正数或精度超过 6 位", evidence: [raw.slice(0, 100)] },
    };
  }
  return { value: raw, issue: null };
}

export function governanceSourceFromNormalizedRow(row: NormalizedSourceRow): GovernanceSourceInput {
  const basicManufacturerPartNumber = field(row, "basic", "MANUFACTURER_PART_NUMBER");
  const attributeManufacturerPartNumber = attributeField(row, "MPN").value;
  const basicBrand = field(row, "basic", "BRAND");
  const attributeBrand = attributeField(row, "BRAND").value;
  const identityConflicts: GovernanceIssue[] = [];
  const comparable = (value: string): string => value.normalize("NFKC").trim().toUpperCase().replaceAll("μ", "U").replaceAll("µ", "U");
  if (basicManufacturerPartNumber && attributeManufacturerPartNumber && comparable(basicManufacturerPartNumber) !== comparable(attributeManufacturerPartNumber)) {
    identityConflicts.push({
      level: "ERROR",
      code: "GOVERNANCE_NORMALIZED_MPN_CONFLICT",
      field: "manufacturer_part_number",
      message: "规范化后的基础制造商料号与结构化 MPN 不一致",
      evidence: ["BASIC_AND_ATTRIBUTE_VALUES_DIFFER"],
    });
  }
  if (basicBrand && attributeBrand && comparable(basicBrand) !== comparable(attributeBrand)) {
    identityConflicts.push({
      level: "ERROR",
      code: "GOVERNANCE_NORMALIZED_BRAND_CONFLICT",
      field: "brand",
      message: "规范化后的基础品牌与结构化 BRAND 不一致",
      evidence: ["BASIC_AND_ATTRIBUTE_VALUES_DIFFER"],
    });
  }
  const manufacturerPartNumber = basicManufacturerPartNumber || attributeManufacturerPartNumber;
  const supplierPartNumber = field(row, "supplier_reference", "SUPPLIER_ITEM_CODE");
  const model = field(row, "basic", "SPECIFICATION_MODEL");
  const supplierSpecification = field(row, "supplier_reference", "SUPPLIER_SPECIFICATION");
  return {
    sourceKey: `NR-${numberValue(row.normalized_row_id)}`,
    originalPartNumber: manufacturerPartNumber || supplierPartNumber || model || null,
    manufacturerPartNumber: manufacturerPartNumber || null,
    supplierPartNumber: supplierPartNumber || null,
    model: model || null,
    materialName: field(row, "basic", "STANDARD_NAME") || field(row, "supplier_reference", "SUPPLIER_ITEM_NAME") || null,
    specification: [supplierSpecification, attributeSpecification(row)].filter(Boolean).join(" ") || model || null,
    description: field(row, "basic", "DESCRIPTION") || field(row, "supplier_reference", "SUPPLIER_ITEM_NAME") || null,
    categoryHint: field(row, "category_hint", "CATEGORY_HINT") || null,
    brand: basicBrand || attributeBrand || null,
    manufacturer: field(row, "basic", "MANUFACTURER") || null,
    supplier: field(row, "supplier_reference", "SUPPLIER_NAME") || null,
    quantity: field(row, "supplier_reference", "SOURCE_QUANTITY") || null,
    unit: field(row, "basic", "UNIT") || field(row, "supplier_reference", "PURCHASE_UOM") || null,
    sourceBom: [row.batch_no, row.original_filename, row.source_sheet_name].filter(Boolean).join("/").slice(0, 500),
    upstreamIssues: [...upstreamIssues(row), ...identityConflicts],
  };
}

function runDto(row: QueryResultRow): Record<string, unknown> {
  return {
    governance_run_id: numberValue(row.id),
    import_batch_id: numberValue(row.batch_id),
    normalization_run_id: numberValue(row.normalization_run_id),
    normalization_result_digest: row.normalization_result_digest,
    rule_version: row.rule_version,
    config_digest: row.config_digest,
    result_digest: row.result_digest,
    source_count: Number(row.source_count),
    group_count: Number(row.group_count),
    ready_group_count: Number(row.ready_group_count),
    exception_row_count: Number(row.exception_row_count),
    alternative_candidate_count: Number(row.alternative_candidate_count),
    requested_by: row.requested_by,
    created_at: iso(row.created_at),
    completed_at: iso(row.completed_at),
  };
}

function groupDto(row: QueryResultRow): Record<string, unknown> {
  return {
    group_id: numberValue(row.id),
    governance_run_id: numberValue(row.governance_run_id),
    governance_key: row.canonical_key,
    category: row.category,
    readiness: row.readiness,
    specification: row.canonical_specification,
    material_name: row.standard_name,
    source_count: Number(row.source_count),
    merge_evidence: row.merge_evidence,
    decision_status: row.decision_status,
    version: Number(row.version),
    material_id: row.material_id == null ? null : numberValue(row.material_id),
    erp_material_code: row.internal_material_code ?? null,
    material_status: row.material_status ?? null,
    updated_at: iso(row.updated_at),
  };
}

function supplierCandidateDtos(rows: readonly QueryResultRow[]): readonly Record<string, unknown>[] {
  const candidates = new Map<string, QueryResultRow>();
  for (const row of rows) {
    const values = {
      supplier: String(row.original_supplier ?? "").trim() || null,
      manufacturer: String(row.original_manufacturer ?? "").trim() || null,
      brand: String(row.original_brand ?? "").trim() || null,
      original_part_number: String(row.original_part_number ?? "").trim() || null,
      manufacturer_part_number: String(row.manufacturer_part_number ?? "").trim() || null,
      supplier_part_number: String(row.supplier_part_number ?? "").trim() || null,
    };
    if (!Object.values(values).some(Boolean)) continue;
    const key = canonicalJson(values);
    if (!candidates.has(key)) candidates.set(key, row);
  }
  return [...candidates.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([, row], index) => ({
      governance_row_id: numberValue(row.id),
      source_key: row.source_key,
      supplier: String(row.original_supplier ?? "").trim() || null,
      manufacturer: String(row.original_manufacturer ?? "").trim() || null,
      brand: String(row.original_brand ?? "").trim() || null,
      original_part_number: String(row.original_part_number ?? "").trim() || null,
      manufacturer_part_number: String(row.manufacturer_part_number ?? "").trim() || null,
      supplier_part_number: String(row.supplier_part_number ?? "").trim() || null,
      priority: index + 1,
      candidate_kind: index === 0 ? "PRIMARY_SOURCE" : "ALTERNATIVE_SOURCE",
    }));
}

export class MaterialGovernanceService {
  readonly repository: PostgresMaterialGovernanceRepository;

  constructor(repository: PostgresMaterialGovernanceRepository) {
    this.repository = repository;
  }

  async createRun(batchId: number, context: GovernanceMutationContext, body: Record<string, unknown>) {
    requirePermission(context.actor, "material.import.governance.run");
    assertKeys(body, ["normalization_run_id", "expected_version", "rule_version"]);
    const normalizationRunId = positive(body.normalization_run_id, "normalization_run_id");
    const expectedVersion = positive(body.expected_version, "expected_version");
    const requestedRule = optionalText(body.rule_version, "rule_version", 100) || MATERIAL_GOVERNANCE_RULE_VERSION;
    if (requestedRule !== MATERIAL_GOVERNANCE_RULE_VERSION) governanceFailure("GOVERNANCE_RULE_VERSION_UNSUPPORTED", "请求的治理规则版本不可用", 422);
    return this.repository.runIdempotent(context, 201, async (client, operationId, keyDigest) => {
      await client.query("select set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true)", [
        String(MATERIAL_GOVERNANCE_LIMITS.statementTimeoutMs),
        String(MATERIAL_GOVERNANCE_LIMITS.lockTimeoutMs),
      ]);
      const batch = await this.repository.visibleBatch(client, batchId, context.actor, true);
      if (Number(batch.current_version) !== expectedVersion) {
        governanceFailure("IMPORT_VERSION_CONFLICT", "导入批次版本已变化，请刷新后重试", 409, Number(batch.current_version));
      }
      if (numberValue(batch.current_normalization_run_id) !== normalizationRunId) {
        governanceFailure("GOVERNANCE_NORMALIZATION_STALE", "只能治理批次当前发布的 Normalization 运行", 409);
      }
      const normalization = await client.query(`
        select * from material_import_normalization_runs
        where id=$1 and batch_id=$2 and run_status='SUCCEEDED'
          and published_at is not null and result_digest is not null
        for share
      `, [normalizationRunId, batchId]);
      if (!normalization.rows[0]) governanceFailure("GOVERNANCE_NORMALIZATION_NOT_PUBLISHED", "只有完整发布的 Normalization 运行可以治理", 422);
      const existing = await client.query(`
        select * from material_governance_runs
        where normalization_run_id=$1 and rule_version=$2 and config_digest=$3
      `, [normalizationRunId, MATERIAL_GOVERNANCE_RULE_VERSION, MATERIAL_GOVERNANCE_CONFIG_DIGEST]);
      if (existing.rows[0]) return { ...runDto(existing.rows[0]), reused: true };
      const count = await client.query(`
        select count(*)::integer row_count
        from material_import_normalized_rows
        where normalization_run_id=$1 and row_status<>'SKIPPED'
      `, [normalizationRunId]);
      const sourceCount = Number(count.rows[0].row_count);
      if (sourceCount < 1) governanceFailure("GOVERNANCE_SOURCE_EMPTY", "Normalization 没有可治理的物料行", 422);
      if (sourceCount > MATERIAL_GOVERNANCE_LIMITS.maxSourceRows) governanceFailure("GOVERNANCE_SOURCE_LIMIT_EXCEEDED", "治理来源行超过单次上限", 413);
      const rowsResult = await client.query<NormalizedSourceRow>(`
        select
          nr.id normalized_row_id,nr.source_row_id,nr.source_sheet_name,nr.source_row_number,
          nr.normalized_payload_hash,nr.row_status,b.batch_no,f.original_filename,
          coalesce(field_values.fields,'{}'::jsonb) fields,
          coalesce(attribute_values.attributes,'{}'::jsonb) attributes,
          coalesce(issue_values.normalization_issues,'[]'::jsonb) normalization_issues
        from material_import_normalized_rows nr
        join material_import_batches b on b.id=nr.batch_id
        join material_import_normalization_runs normalization on normalization.id=nr.normalization_run_id
        left join material_import_files f on f.id=normalization.source_file_id
        left join lateral (
          select jsonb_object_agg(
            fc.target_namespace||'.'||fc.target_field_code,
            jsonb_build_object('normalized_value',fc.normalized_value,'validation_status',fc.validation_status)
            order by fc.id
          ) fields
          from material_import_normalized_field_candidates fc
          where fc.normalized_row_id=nr.id
        ) field_values on true
        left join lateral (
          select jsonb_object_agg(
            attribute_candidate.attribute_code,
            jsonb_build_object(
              'normalized_value',attribute_candidate.normalized_value,
              'unit_code',attribute_candidate.unit_code,
              'validation_status',attribute_candidate.validation_status
            ) order by attribute_candidate.id
          ) attributes
          from material_import_normalized_attribute_candidates attribute_candidate
          where attribute_candidate.normalized_row_id=nr.id
        ) attribute_values on true
        left join lateral (
          select jsonb_agg(jsonb_build_object(
            'id',normalization_issue.id,
            'issue_level',normalization_issue.issue_level,
            'issue_code',normalization_issue.issue_code,
            'target_code',normalization_issue.target_code,
            'safe_message',normalization_issue.safe_message
          ) order by normalization_issue.id) normalization_issues
          from material_import_normalization_issues normalization_issue
          where normalization_issue.normalized_row_id=nr.id
        ) issue_values on true
        where nr.normalization_run_id=$1 and nr.row_status<>'SKIPPED'
        order by nr.id
      `, [normalizationRunId]);
      const sources = rowsResult.rows.map(governanceSourceFromNormalizedRow);
      const governed = governSources(sources);
      const supplierAlternativeCount = governed.groups.reduce(
        (total, group) => total + Math.max(0, group.supplierCandidates.length - 1),
        0,
      );
      const sourceByKey = new Map(rowsResult.rows.map((row) => [`NR-${numberValue(row.normalized_row_id)}`, row]));
      const resultDigest = digest({
        rule_version: governed.ruleVersion,
        config_digest: MATERIAL_GOVERNANCE_CONFIG_DIGEST,
        normalization_result_digest: normalization.rows[0].result_digest,
        groups: governed.groups.map((group) => ({
          key: group.groupKey,
          identity: group.identityDigest,
          compatibility: group.compatibilityDigest,
          sources: group.sources.map((source) => ({ key: source.source.sourceKey, components: source.components, issues: source.issues })),
        })),
        alternatives: governed.alternativeSuggestions,
      });
      const exceptionRows = governed.groups.flatMap((group) => group.sources).filter((source) => {
        const parsedQuantity = quantity(String(source.source.quantity ?? ""));
        return source.readiness !== "READY" || source.issues.length > 0 || parsedQuantity.issue !== null;
      }).length;
      const insertedRun = await client.query(`
        insert into material_governance_runs(
          batch_id,normalization_run_id,normalization_result_digest,rule_version,config_digest,rule_snapshot,
          result_digest,source_count,group_count,ready_group_count,exception_row_count,
          alternative_candidate_count,operation_id,requested_by,request_id
        ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *
      `, [
        batchId,
        normalizationRunId,
        normalization.rows[0].result_digest,
        MATERIAL_GOVERNANCE_RULE_VERSION,
        MATERIAL_GOVERNANCE_CONFIG_DIGEST,
        MATERIAL_GOVERNANCE_CONFIG_SNAPSHOT,
        resultDigest,
        sources.length,
        governed.groups.length,
        governed.groups.filter((group) => group.readiness === "READY").length,
        exceptionRows,
        governed.alternativeSuggestions.length + supplierAlternativeCount,
        operationId,
        context.actor.username,
        context.requestId,
      ]);
      const run = insertedRun.rows[0];
      const groupIds = new Map<string, number>();
      const groupPayload = governed.groups.map((group) => ({
        group_key: group.groupKey,
        category: group.category,
        readiness: group.readiness,
        canonical_key: group.canonicalKey,
        canonical_specification: group.canonicalSpecification,
        standard_name: group.standardName,
        identity_digest: group.identityDigest,
        compatibility_digest: group.compatibilityDigest,
        source_count: group.sources.length,
        merge_evidence: group.mergeEvidence,
      }));
      for (const batch of chunks(groupPayload)) {
        const insertedGroups = await client.query<{ id: string; group_key: string }>(`
          insert into material_governance_groups(
            governance_run_id,group_key,category,readiness,canonical_key,canonical_specification,
            standard_name,identity_digest,compatibility_digest,source_count,merge_evidence,created_by,updated_by
          )
          select $1::bigint,item.group_key,item.category,item.readiness,item.canonical_key,
                 item.canonical_specification,item.standard_name,item.identity_digest,
                 item.compatibility_digest,item.source_count,item.merge_evidence,$3::text,$3::text
          from jsonb_to_recordset($2::jsonb) as item(
            group_key text,category text,readiness text,canonical_key text,
            canonical_specification text,standard_name text,identity_digest text,
            compatibility_digest text,source_count integer,merge_evidence jsonb
          )
          returning id,group_key
        `, [run.id, JSON.stringify(batch), context.actor.username]);
        for (const row of insertedGroups.rows) groupIds.set(row.group_key, numberValue(row.id));
      }
      if (groupIds.size !== governed.groups.length) governanceFailure("GOVERNANCE_GROUP_INTEGRITY_FAILED", "治理候选组写入不完整", 500);

      const rowPayload: Record<string, unknown>[] = [];
      const specsBySource = new Map<string, typeof governed.groups[number]["sources"][number]["components"]>();
      for (const group of governed.groups) {
        const groupId = groupIds.get(group.groupKey);
        if (!groupId) governanceFailure("GOVERNANCE_GROUP_INTEGRITY_FAILED", "治理候选组关联失败", 500);
        for (const source of group.sources) {
          const databaseRow = sourceByKey.get(source.source.sourceKey);
          if (!databaseRow) governanceFailure("GOVERNANCE_SOURCE_INTEGRITY_FAILED", "治理来源行关联失败", 500);
          const parsedQuantity = quantity(String(source.source.quantity ?? ""));
          const issues = parsedQuantity.issue ? [...source.issues, parsedQuantity.issue] : [...source.issues];
          const evidence = [...new Set([
            ...source.components.flatMap((item) => item.evidence),
            ...issues.flatMap((item) => item.evidence),
          ])];
          rowPayload.push({
            group_id: groupId,
            normalized_row_id: numberValue(databaseRow.normalized_row_id),
            source_row_id: numberValue(databaseRow.source_row_id),
            source_key: source.source.sourceKey,
            original_part_number: source.source.originalPartNumber || null,
            manufacturer_part_number: source.source.manufacturerPartNumber || null,
            supplier_part_number: source.source.supplierPartNumber || null,
            source_model: source.source.model || null,
            original_material_name: source.source.materialName || null,
            original_specification: source.source.specification || null,
            original_description: source.source.description || null,
            original_brand: source.source.brand || null,
            original_manufacturer: source.source.manufacturer || null,
            original_supplier: source.source.supplier || null,
            source_quantity_raw: source.source.quantity || null,
            source_quantity: parsedQuantity.value,
            source_unit: source.source.unit || null,
            source_bom: source.source.sourceBom || null,
            source_snapshot_digest: digest({
              normalized_payload_hash: databaseRow.normalized_payload_hash,
              source_row_id: databaseRow.source_row_id,
              source: source.source,
            }),
            parse_evidence: evidence,
            issues,
            issue_count: issues.length,
            error_count: issues.filter((item) => item.level === "ERROR").length,
            warning_count: issues.filter((item) => item.level === "WARNING").length,
          });
          specsBySource.set(source.source.sourceKey, source.components);
        }
      }
      const governanceRowIds = new Map<string, number>();
      for (const batch of chunks(rowPayload)) {
        const insertedRows = await client.query<{ id: string; source_key: string }>(`
          insert into material_governance_rows(
            governance_run_id,group_id,normalized_row_id,source_row_id,source_key,
            original_part_number,manufacturer_part_number,supplier_part_number,source_model,
            original_material_name,original_specification,original_description,original_brand,
            original_manufacturer,original_supplier,source_quantity_raw,source_quantity,source_unit,
            source_bom,source_snapshot_digest,parse_evidence,issues,issue_count,error_count,warning_count
          )
          select $1::bigint,item.group_id,item.normalized_row_id,item.source_row_id,item.source_key,
                 item.original_part_number,item.manufacturer_part_number,item.supplier_part_number,
                 item.source_model,item.original_material_name,item.original_specification,
                 item.original_description,item.original_brand,item.original_manufacturer,
                 item.original_supplier,item.source_quantity_raw,item.source_quantity,item.source_unit,
                 item.source_bom,item.source_snapshot_digest,item.parse_evidence,item.issues,
                 item.issue_count,item.error_count,item.warning_count
          from jsonb_to_recordset($2::jsonb) as item(
            group_id bigint,normalized_row_id bigint,source_row_id bigint,source_key text,
            original_part_number text,manufacturer_part_number text,supplier_part_number text,
            source_model text,original_material_name text,original_specification text,
            original_description text,original_brand text,original_manufacturer text,
            original_supplier text,source_quantity_raw text,source_quantity numeric(24,6),
            source_unit text,source_bom text,source_snapshot_digest text,parse_evidence jsonb,
            issues jsonb,issue_count integer,error_count integer,warning_count integer
          )
          returning id,source_key
        `, [run.id, JSON.stringify(batch)]);
        for (const row of insertedRows.rows) governanceRowIds.set(row.source_key, numberValue(row.id));
      }
      if (governanceRowIds.size !== sources.length) governanceFailure("GOVERNANCE_SOURCE_INTEGRITY_FAILED", "治理来源行写入不完整", 500);
      const specPayload = [...specsBySource.entries()].flatMap(([sourceKey, specs]) => {
        const governanceRowId = governanceRowIds.get(sourceKey);
        if (!governanceRowId) governanceFailure("GOVERNANCE_SOURCE_INTEGRITY_FAILED", "治理规格来源关联失败", 500);
        return specs.map((spec) => ({
          governance_row_id: governanceRowId,
          component_code: spec.code,
          component_role: spec.role,
          normalized_value: spec.normalizedValue,
          display_value: spec.displayValue,
          canonical_unit: spec.canonicalUnit,
          evidence: spec.evidence,
        }));
      });
      for (const batch of chunks(specPayload)) {
        await client.query(`
          insert into material_governance_specs(
            governance_row_id,component_code,component_role,normalized_value,display_value,canonical_unit,evidence
          )
          select item.governance_row_id,item.component_code,item.component_role,item.normalized_value,
                 item.display_value,item.canonical_unit,item.evidence
          from jsonb_to_recordset($1::jsonb) as item(
            governance_row_id bigint,component_code text,component_role text,normalized_value text,
            display_value text,canonical_unit text,evidence jsonb
          )
        `, [JSON.stringify(batch)]);
      }
      const currentGroupByIdentity = new Map(governed.groups
        .filter((group) => Boolean(group.identityDigest))
        .map((group) => [group.identityDigest!, { group, groupId: groupIds.get(group.groupKey)! }]));
      const currentGroups = [...currentGroupByIdentity.values()];
      const compatibilityGroupsByAnchor = new Map<string, typeof currentGroups>();
      for (const current of currentGroups) {
        for (const profile of COMPATIBILITY_REVIEW_PROFILES.filter((candidate) => candidate.category === current.group.category)) {
          const anchorKey = compatibilityAnchorKey(current.group, profile);
          if (!anchorKey) continue;
          const matches = compatibilityGroupsByAnchor.get(anchorKey) ?? [];
          matches.push(current);
          compatibilityGroupsByAnchor.set(anchorKey, matches);
        }
      }
      const candidatesByGroup = new Map<number, Map<number, GovernanceMaterialCandidate>>();
      const addCandidate = (
        groupId: number,
        material: QueryResultRow,
        kind: GovernanceMaterialCandidateKind,
        evidence: readonly string[],
        blockingIssueCodes: readonly string[] = [],
      ): void => {
        const materialId = numberValue(material.id);
        const candidates = candidatesByGroup.get(groupId) ?? new Map<number, GovernanceMaterialCandidate>();
        const existing = candidates.get(materialId);
        const selectedKind = existing?.kind === "EXACT_IDENTITY" || kind === "EXACT_IDENTITY"
          ? "EXACT_IDENTITY"
          : "COMPATIBILITY_REVIEW";
        candidates.set(materialId, {
          material,
          kind: selectedKind,
          evidence: [...new Set([...(existing?.evidence ?? []), ...evidence])],
          blockingIssueCodes: selectedKind === "EXACT_IDENTITY"
            ? []
            : [...new Set([...(existing?.blockingIssueCodes ?? []), ...blockingIssueCodes])].sort(),
        });
        if (candidates.size > MATERIAL_GOVERNANCE_LIMITS.maxExactCandidatesPerGroup) {
          const worst = [...candidates.values()].sort((left, right) => {
            const kindOrder = Number(left.kind === "COMPATIBILITY_REVIEW") - Number(right.kind === "COMPATIBILITY_REVIEW");
            return kindOrder || numberValue(left.material.id) - numberValue(right.material.id);
          }).at(-1);
          if (worst) candidates.delete(numberValue(worst.material.id));
        }
        candidatesByGroup.set(groupId, candidates);
      };
      await scanActiveGovernanceMaterials(client, (material, resolved) => {
        if (!resolved) return;
        if (resolved.readiness === "READY" && resolved.identityDigest) {
          const current = currentGroupByIdentity.get(resolved.identityDigest);
          if (!current) return;
          addCandidate(current.groupId, material, "EXACT_IDENTITY", [
            "CATEGORY_AND_GOVERNANCE_IDENTITY_EQUAL",
            "ACTIVE_ATTRIBUTES_RECONSTRUCTED",
            `RULE_VERSION_${MATERIAL_GOVERNANCE_RULE_VERSION}`,
          ]);
          return;
        }
        const profile = compatibilityProfileFor(resolved);
        const anchorKey = profile ? compatibilityAnchorKey(resolved, profile) : null;
        if (!anchorKey) return;
        for (const current of compatibilityGroupsByAnchor.get(anchorKey) ?? []) {
          if ((candidatesByGroup.get(current.groupId)?.size ?? 0) >= MATERIAL_GOVERNANCE_LIMITS.maxExactCandidatesPerGroup) continue;
          const evidence = compatibilityReviewEvidence(resolved, current.group);
          if (!evidence) continue;
          addCandidate(
            current.groupId,
            material,
            "COMPATIBILITY_REVIEW",
            evidence,
            resolved.issues.filter((issue) => issue.level === "ERROR").map((issue) => issue.code),
          );
        }
      });
      const candidatePayload: Record<string, unknown>[] = [];
      const currentGroupById = new Map(governed.groups.map((group) => [groupIds.get(group.groupKey)!, group]));
      for (const [groupId, candidates] of [...candidatesByGroup.entries()].sort(([left], [right]) => left - right)) {
        const current = currentGroupById.get(groupId);
        if (!current) governanceFailure("GOVERNANCE_GROUP_INTEGRITY_FAILED", "治理物料候选关联失败", 500);
        const ranked = [...candidates.values()].sort((left, right) => {
          const kindOrder = Number(left.kind === "COMPATIBILITY_REVIEW") - Number(right.kind === "COMPATIBILITY_REVIEW");
          return kindOrder || numberValue(left.material.id) - numberValue(right.material.id);
        });
        for (const [index, candidate] of ranked.entries()) {
          const snapshot = {
            material_id: numberValue(candidate.material.id),
            internal_material_code: candidate.material.internal_material_code,
            standard_name: candidate.material.standard_name,
            category_code: candidate.material.category_code,
            material_status: candidate.material.material_status,
            version: Number(candidate.material.version),
            blocking_issue_codes: candidate.blockingIssueCodes,
          };
          candidatePayload.push({
            group_id: groupId,
            material_id: snapshot.material_id,
            candidate_kind: candidate.kind,
            candidate_rank: index + 1,
            material_version_snapshot: snapshot.version,
            material_status_snapshot: "ACTIVE",
            candidate_snapshot: snapshot,
            evidence: candidate.evidence,
            candidate_digest: digest({ group_key: current.groupKey, material: snapshot, candidate_kind: candidate.kind }),
          });
        }
      }
      for (const batch of chunks(candidatePayload)) {
        await client.query(`
          insert into material_governance_material_candidates(
            group_id,material_id,candidate_kind,candidate_rank,material_version_snapshot,
            material_status_snapshot,candidate_snapshot,evidence,candidate_digest
          )
          select item.group_id,item.material_id,item.candidate_kind,item.candidate_rank,
                 item.material_version_snapshot,item.material_status_snapshot,item.candidate_snapshot,
                 item.evidence,item.candidate_digest
          from jsonb_to_recordset($1::jsonb) as item(
            group_id bigint,material_id bigint,candidate_kind text,candidate_rank integer,
            material_version_snapshot integer,material_status_snapshot text,candidate_snapshot jsonb,
            evidence jsonb,candidate_digest text
          )
        `, [JSON.stringify(batch)]);
      }
      const alternativePayload = governed.alternativeSuggestions.map((candidate) => {
        const leftId = groupIds.get(candidate.mainGroupKey);
        const rightId = groupIds.get(candidate.alternativeGroupKey);
        if (!leftId || !rightId) governanceFailure("GOVERNANCE_ALTERNATIVE_INTEGRITY_FAILED", "替代候选关联失败", 500);
        const [mainGroupId, alternativeGroupId] = leftId < rightId ? [leftId, rightId] : [rightId, leftId];
        const candidateDigest = digest({
          run_id: numberValue(run.id),
          main_group_id: mainGroupId,
          alternative_group_id: alternativeGroupId,
          compatibility_digest: candidate.compatibilityDigest,
          rule_version: MATERIAL_GOVERNANCE_RULE_VERSION,
        });
        return {
          governance_run_id: numberValue(run.id),
          main_group_id: mainGroupId,
          alternative_group_id: alternativeGroupId,
          compatibility_digest: candidate.compatibilityDigest,
          evidence: candidate.evidence,
          candidate_digest: candidateDigest,
        };
      });
      for (const batch of chunks(alternativePayload)) {
        await client.query(`
          insert into material_governance_alternative_candidates(
            governance_run_id,main_group_id,alternative_group_id,compatibility_digest,evidence,candidate_digest
          )
          select item.governance_run_id,item.main_group_id,item.alternative_group_id,
                 item.compatibility_digest,item.evidence,item.candidate_digest
          from jsonb_to_recordset($1::jsonb) as item(
            governance_run_id bigint,main_group_id bigint,alternative_group_id bigint,
            compatibility_digest text,evidence jsonb,candidate_digest text
          )
        `, [JSON.stringify(batch)]);
      }
      await this.repository.audit(client, {
        actor: context.actor.username,
        action: "MATERIAL_GOVERNANCE_RUN_CREATED",
        requestId: context.requestId,
        routeCode: context.routeScope,
        operationId,
        keyDigest,
        details: { batch_id: batchId, normalization_run_id: normalizationRunId, governance_run_id: numberValue(run.id), result_digest: resultDigest },
      });
      return runDto(run);
    });
  }

  async decide(batchId: number, runId: number, groupId: number, context: GovernanceMutationContext, body: Record<string, unknown>) {
    requirePermission(context.actor, "material.import.governance.decide");
    assertKeys(body, ["expected_version", "decision_type", "reason_code", "comment", "material_id", "draft"]);
    const expectedVersion = positive(body.expected_version, "expected_version");
    const decisionType = optionalText(body.decision_type, "decision_type", 32, true).toUpperCase();
    if (!["BIND_EXISTING", "CREATE_DRAFT", "EXCLUDE"].includes(decisionType)) governanceFailure("REQUEST_VALIDATION_FAILED", "decision_type 无效", 400);
    const reason = reasonCode(body.reason_code);
    const comment = optionalText(body.comment, "comment", 2000, decisionType === "EXCLUDE");
    if (decisionType === "BIND_EXISTING") requirePermission(context.actor, "material.import.governance.bind");
    if (decisionType === "CREATE_DRAFT") {
      requirePermission(context.actor, "material.import.governance.create_draft");
      requirePermission(context.actor, "material.draft.create");
    }
    return this.repository.runIdempotent(context, 200, async (client, operationId, keyDigest) => {
      const batch = await this.repository.visibleBatch(client, batchId, context.actor, true);
      const run = await this.repository.visibleRun(client, batchId, runId, context.actor);
      if (numberValue(batch.current_normalization_run_id) !== numberValue(run.normalization_run_id)) {
        governanceFailure("GOVERNANCE_RUN_STALE", "批次已发布新的 Normalization，旧治理运行只能只读", 409);
      }
      const groupResult = await client.query(`
        select * from material_governance_groups
        where id=$1 and governance_run_id=$2 for update
      `, [groupId, runId]);
      const group = groupResult.rows[0];
      if (!group) governanceFailure("GOVERNANCE_GROUP_NOT_FOUND", "治理候选组不存在", 404);
      if (Number(group.version) !== expectedVersion || group.decision_status !== "PENDING") {
        governanceFailure("GOVERNANCE_VERSION_CONFLICT", "治理候选组已被处理，请刷新后重试", 409, Number(group.version));
      }
      let material: QueryResultRow | null = null;
      let materialId: number | null = null;
      let linkType: "BOUND_ACTIVE" | "CREATED_DRAFT" | null = null;
      let bindCandidateSource: "RUN_SNAPSHOT" | "LIVE_REVALIDATED" | null = null;
      let bindCandidateSnapshotVersion: number | null = null;
      if (decisionType === "BIND_EXISTING") {
        if (group.readiness !== "READY" || !group.identity_digest) {
          governanceFailure("GOVERNANCE_GROUP_NOT_READY", "只有规格身份完整的候选组可以绑定正式物料", 422);
        }
        materialId = positive(body.material_id, "material_id");
        const exactCandidate = await client.query(`
          select material_version_snapshot from material_governance_material_candidates
          where group_id=$1 and material_id=$2 and candidate_kind='EXACT_IDENTITY'
        `, [groupId, materialId]);
        bindCandidateSnapshotVersion = exactCandidate.rows[0]
          ? Number(exactCandidate.rows[0].material_version_snapshot)
          : null;
        const locked = await client.query(`
          select material.*,category.category_code,
                 coalesce((
                   select jsonb_agg(jsonb_build_object(
                     'code',definition.attribute_code,
                     'value',value.normalized_value,
                     'unit',definition.canonical_unit
                   ) order by definition.attribute_code)
                   from material_attribute_values value
                   join material_attribute_definitions definition on definition.id=value.attribute_definition_id
                   where value.material_id=material.id
                 ),'[]'::jsonb) attributes
          from material_master material
          join material_categories category on category.id=material.category_id
          where material.id=$1
          for update of material
        `, [materialId]);
        material = locked.rows[0] ?? null;
        if (!material || material.material_status !== "ACTIVE") governanceFailure("GOVERNANCE_ACTIVE_MATERIAL_REQUIRED", "只能绑定当前 ACTIVE 物料", 409);
        const currentMaterialSource = materialSource(material);
        let governedMaterial = null;
        try {
          governedMaterial = currentMaterialSource ? governMaterialSource(currentMaterialSource) : null;
        } catch {
          governedMaterial = null;
        }
        if (governedMaterial?.readiness !== "READY" || governedMaterial.identityDigest !== group.identity_digest) {
          governanceFailure(
            exactCandidate.rows[0] ? "GOVERNANCE_MATERIAL_IDENTITY_CHANGED" : "GOVERNANCE_EXACT_MATERIAL_CANDIDATE_REQUIRED",
            exactCandidate.rows[0] ? "候选物料当前类别或规格身份已变化，禁止绑定" : "所选 ACTIVE 物料与该规格组的实时身份不一致",
            exactCandidate.rows[0] ? 409 : 422,
          );
        }
        bindCandidateSource = bindCandidateSnapshotVersion === Number(material.version)
          ? "RUN_SNAPSHOT"
          : "LIVE_REVALIDATED";
        linkType = "BOUND_ACTIVE";
      } else if (decisionType === "CREATE_DRAFT") {
        if (group.readiness !== "READY" || !group.identity_digest) {
          governanceFailure("GOVERNANCE_GROUP_NOT_READY", "只有规格身份完整的候选组可以创建物料草稿", 422);
        }
        if (!body.draft || typeof body.draft !== "object" || Array.isArray(body.draft)) governanceFailure("REQUEST_VALIDATION_FAILED", "draft 必须是完整物料草稿对象", 400);
        const draft = structuredClone(body.draft) as Record<string, unknown>;
        const basic = draft.basic_fields;
        if (!basic || typeof basic !== "object" || Array.isArray(basic)) governanceFailure("REQUEST_VALIDATION_FAILED", "draft.basic_fields 必填", 400);
        const categoryId = positive(draft.category_id, "draft.category_id");
        const category = await client.query("select category_code from material_categories where id=$1 and status='ACTIVE'", [categoryId]);
        const comparable = category.rows[0] ? draftSource(draft, String(category.rows[0].category_code)) : null;
        let governedDraft = null;
        try {
          governedDraft = comparable ? governMaterialSource(comparable) : null;
        } catch {
          governedDraft = null;
        }
        if (governedDraft?.readiness !== "READY" || governedDraft.identityDigest !== group.identity_digest) {
          governanceFailure("GOVERNANCE_DRAFT_IDENTITY_MISMATCH", "物料草稿的类别、关键规格或性能等级与治理候选组不一致", 422);
        }
        const identityDigest = String(group.identity_digest);
        await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`material-governance-identity:${identityDigest}`]);
        const linkedIdentity = await client.query(`
          select material.id,material.material_status
          from material_governance_material_links link
          join material_governance_groups linked_group on linked_group.id=link.group_id
          join material_master material on material.id=link.material_id
          where linked_group.identity_digest=$1
            and material.material_status in ('DRAFT','PENDING_REVIEW','ACTIVE','FROZEN','INACTIVE')
          order by material.id
          limit 1
        `, [identityDigest]);
        const linked = linkedIdentity.rows[0];
        if (linked) {
          if (linked.material_status === "ACTIVE") {
            governanceFailure("GOVERNANCE_ACTIVE_MATERIAL_BIND_REQUIRED", "该规格已有 ACTIVE 物料，请重新运行治理并绑定现有物料", 409);
          }
          if (["DRAFT", "PENDING_REVIEW"].includes(String(linked.material_status))) {
            governanceFailure("GOVERNANCE_IDENTITY_DRAFT_EXISTS", "该规格已有治理草稿或待审物料，禁止重复创建", 409);
          }
          governanceFailure("GOVERNANCE_IDENTITY_MATERIAL_CONFLICT", "该规格已有冻结或停用物料，需先人工处置主数据状态", 409);
        }
        let exactFormalMaterialStatus: string | null = null;
        let compatibilityReviewMaterial = false;
        let unresolvedFormalIdentityConflict = false;
        const compatibilityTarget: CompatibilityTarget = {
          category: governedDraft.category,
          components: governedDraft.components,
        };
        await scanGovernanceMaterials(client, ["ACTIVE", "FROZEN", "INACTIVE"], (formalMaterial, resolved) => {
          const formalCategory = resolved?.category
            ?? MASTER_CATEGORY_GOVERNANCE_MAP[String(formalMaterial.category_code ?? "").trim().toUpperCase()];
          if (formalCategory !== governedDraft.category) return;
          if (resolved?.readiness === "READY") {
            if (resolved.identityDigest !== identityDigest) return;
            exactFormalMaterialStatus = String(formalMaterial.material_status);
            return false;
          }
          if (resolved && compatibilityReviewEvidence(resolved, compatibilityTarget)) {
            compatibilityReviewMaterial = true;
            return;
          }
          if (!resolved || !compatibilityProfileFor(resolved)) unresolvedFormalIdentityConflict = true;
        });
        if (exactFormalMaterialStatus === "ACTIVE") {
          governanceFailure("GOVERNANCE_ACTIVE_MATERIAL_BIND_REQUIRED", "该规格已有精确匹配的 ACTIVE 物料，请绑定现有物料", 409);
        }
        if (exactFormalMaterialStatus) {
          governanceFailure("GOVERNANCE_IDENTITY_MATERIAL_CONFLICT", "该规格已有冻结或停用物料，需先人工处置主数据状态", 409);
        }
        if (compatibilityReviewMaterial) {
          governanceFailure(
            "GOVERNANCE_COMPATIBILITY_REVIEW_REQUIRED",
            "存在规格部分一致但身份元数据待处置的 ACTIVE 物料；当前版本不提供 ACTIVE 属性修订，需经后续受控处置后重新治理",
            409,
          );
        }
        if (unresolvedFormalIdentityConflict) {
          governanceFailure(
            "GOVERNANCE_UNRESOLVED_FORMAL_IDENTITY_CONFLICT",
            "同类正式物料存在无法可靠重构的身份冲突；当前版本不提供 ACTIVE 属性修订，禁止创建草稿",
            409,
          );
        }
        (basic as Record<string, unknown>).source_type = "MANUAL";
        (basic as Record<string, unknown>).source_ref = `material-governance:${runId}:${groupId}`;
        const workflow = new MaterialWorkflowService(new PostgresMaterialRepository(this.repository.pool));
        const created = await workflow.createDraftWithClient(client, {
          actor: context.actor,
          requestId: context.requestId,
          idempotencyKey: context.idempotencyKey,
          requestDigest: context.requestDigest,
          routeScope: context.routeScope,
        }, draft, operationId, keyDigest);
        materialId = Number(created.material_id);
        const locked = await client.query("select * from material_master where id=$1 for update", [materialId]);
        material = locked.rows[0] ?? null;
        if (!material || material.material_status !== "DRAFT") governanceFailure("GOVERNANCE_DRAFT_CREATION_FAILED", "物料草稿创建失败", 500);
        linkType = "CREATED_DRAFT";
      }
      const nextStatus = decisionType === "BIND_EXISTING" ? "BOUND_ACTIVE" : decisionType === "CREATE_DRAFT" ? "DRAFT_CREATED" : "EXCLUDED";
      const decisionPayload = materialId == null
        ? { excluded: true }
        : {
            material_id: materialId,
            link_type: linkType,
            ...(decisionType === "BIND_EXISTING" ? {
              candidate_source: bindCandidateSource,
              candidate_snapshot_version: bindCandidateSnapshotVersion,
              bound_material_version: Number(material?.version),
            } : {}),
          };
      const insertedDecision = await client.query(`
        insert into material_governance_decisions(
          group_id,decision_type,expected_version,resulting_version,reason_code,comment,decision_payload,
          request_digest,idempotency_key_digest,operation_id,decided_by,request_id
        ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id
      `, [groupId, decisionType, expectedVersion, expectedVersion + 1, reason, comment, decisionPayload, context.requestDigest, keyDigest, operationId, context.actor.username, context.requestId]);
      const decisionId = numberValue(insertedDecision.rows[0].id);
      if (material && materialId && linkType) {
        const snapshot = {
          material_id: materialId,
          internal_material_code: material.internal_material_code ?? null,
          standard_name: material.standard_name,
          category_id: numberValue(material.category_id),
          material_status: material.material_status,
          version: Number(material.version),
        };
        await client.query(`
          insert into material_governance_material_links(
            group_id,decision_id,material_id,link_type,material_version_snapshot,material_status_snapshot,
            material_display_snapshot,linked_by,request_id
          ) values($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `, [groupId, decisionId, materialId, linkType, material.version, material.material_status, snapshot, context.actor.username, context.requestId]);
      }
      const updated = await client.query(`
        update material_governance_groups
        set decision_status=$3,version=version+1,updated_by=$4,updated_at=now()
        where id=$1 and governance_run_id=$2 and decision_status='PENDING' and version=$5
      `, [groupId, runId, nextStatus, context.actor.username, expectedVersion]);
      if (updated.rowCount !== 1) governanceFailure("GOVERNANCE_VERSION_CONFLICT", "治理候选组已被处理，请刷新后重试", 409);
      const eventType = decisionType === "BIND_EXISTING" ? "GROUP_BOUND_ACTIVE" : decisionType === "CREATE_DRAFT" ? "GROUP_DRAFT_CREATED" : "GROUP_EXCLUDED";
      await client.query(`
        insert into material_governance_events(
          group_id,decision_id,event_type,old_status,new_status,old_version,new_version,reason_code,safe_details,actor,request_id
        ) values($1,$2,$3,'PENDING',$4,$5,$6,$7,$8,$9,$10)
      `, [groupId, decisionId, eventType, nextStatus, expectedVersion, expectedVersion + 1, reason, decisionPayload, context.actor.username, context.requestId]);
      await this.repository.audit(client, {
        actor: context.actor.username,
        action: `MATERIAL_GOVERNANCE_${decisionType}`,
        requestId: context.requestId,
        routeCode: context.routeScope,
        operationId,
        keyDigest,
        materialId,
        oldVersion: expectedVersion,
        newVersion: expectedVersion + 1,
        details: { batch_id: batchId, governance_run_id: runId, group_id: groupId, decision_type: decisionType },
      });
      return { governance_run_id: runId, group_id: groupId, decision_status: nextStatus, version: expectedVersion + 1, material_id: materialId };
    });
  }

  async latest(batchId: number, actor: GovernanceActor) {
    requirePermission(actor, "material.import.governance.read");
    await this.repository.visibleBatch(this.repository.pool, batchId, actor);
    const result = await this.repository.pool.query("select * from material_governance_runs where batch_id=$1 order by completed_at desc,id desc limit 1", [batchId]);
    return { data: result.rows[0] ? runDto(result.rows[0]) : null };
  }

  async runs(batchId: number, actor: GovernanceActor, page: GovernancePage) {
    requirePermission(actor, "material.import.governance.read");
    await this.repository.visibleBatch(this.repository.pool, batchId, actor);
    const result = await this.repository.pool.query(`
      select * from material_governance_runs
      where batch_id=$1 and ($2=0 or id<$2)
      order by id desc limit $3
    `, [batchId, page.afterId, page.limit + 1]);
    const visible = result.rows.slice(0, page.limit);
    return { items: visible.map(runDto), next_after_id: result.rows.length > page.limit ? numberValue(visible.at(-1)?.id) : null };
  }

  async run(batchId: number, runId: number, actor: GovernanceActor) {
    requirePermission(actor, "material.import.governance.read");
    return { data: runDto(await this.repository.visibleRun(this.repository.pool, batchId, runId, actor)) };
  }

  async groups(batchId: number, runId: number, actor: GovernanceActor, page: GovernancePage, filters: Readonly<{ readiness?: string; category?: string; decisionStatus?: string }>) {
    requirePermission(actor, "material.import.governance.read");
    await this.repository.visibleRun(this.repository.pool, batchId, runId, actor);
    const values: unknown[] = [runId, page.afterId];
    const conditions = ["g.governance_run_id=$1", "g.id>$2"];
    for (const [column, value] of [["readiness", filters.readiness], ["category", filters.category], ["decision_status", filters.decisionStatus]] as const) {
      if (value) { values.push(value); conditions.push(`g.${column}=$${values.length}`); }
    }
    values.push(page.limit + 1);
    const result = await this.repository.pool.query(`
      select g.*,l.material_id,m.internal_material_code,m.material_status
      from material_governance_groups g
      left join material_governance_material_links l on l.group_id=g.id
      left join material_master m on m.id=l.material_id
      where ${conditions.join(" and ")} order by g.id limit $${values.length}
    `, values);
    const visible = result.rows.slice(0, page.limit);
    return { items: visible.map(groupDto), next_after_id: result.rows.length > page.limit ? numberValue(visible.at(-1)?.id) : null };
  }

  async group(batchId: number, runId: number, groupId: number, actor: GovernanceActor, page: GovernancePage = { afterId: 0, limit: 50 }) {
    requirePermission(actor, "material.import.governance.read");
    await this.repository.visibleRun(this.repository.pool, batchId, runId, actor);
    const [group, rows, candidates, alternatives, decision, link, supplierRows] = await Promise.all([
      this.repository.pool.query(`select g.*,l.material_id,m.internal_material_code,m.material_status from material_governance_groups g left join material_governance_material_links l on l.group_id=g.id left join material_master m on m.id=l.material_id where g.id=$1 and g.governance_run_id=$2`, [groupId, runId]),
      this.repository.pool.query("select * from material_governance_rows where group_id=$1 and id>$2 order by id limit $3", [groupId, page.afterId, page.limit + 1]),
      this.repository.pool.query("select * from material_governance_material_candidates where group_id=$1 order by candidate_rank", [groupId]),
      this.repository.pool.query("select * from material_governance_alternative_candidates where main_group_id=$1 or alternative_group_id=$1 order by id limit 101", [groupId]),
      this.repository.pool.query("select * from material_governance_decisions where group_id=$1", [groupId]),
      this.repository.pool.query("select * from material_governance_material_links where group_id=$1", [groupId]),
      this.repository.pool.query(`
        select distinct on (
          coalesce(original_supplier,''),coalesce(original_manufacturer,''),
          coalesce(original_brand,''),
          coalesce(original_part_number,''),coalesce(manufacturer_part_number,''),
          coalesce(supplier_part_number,'')
        ) *
        from material_governance_rows
        where group_id=$1 and coalesce(
          nullif(btrim(original_supplier),''),nullif(btrim(original_manufacturer),''),
          nullif(btrim(original_brand),''),
          nullif(btrim(original_part_number),''),nullif(btrim(manufacturer_part_number),''),
          nullif(btrim(supplier_part_number),'')
        ) is not null
        order by coalesce(original_supplier,''),coalesce(original_manufacturer,''),
                 coalesce(original_brand,''),
                 coalesce(original_part_number,''),coalesce(manufacturer_part_number,''),
                 coalesce(supplier_part_number,''),id
        limit 101
      `, [groupId]),
    ]);
    if (!group.rows[0]) governanceFailure("GOVERNANCE_GROUP_NOT_FOUND", "治理候选组不存在", 404);
    const visibleSources = rows.rows.slice(0, page.limit);
    const sourceIds = visibleSources.map((row) => numberValue(row.id));
    const specs = sourceIds.length
      ? await this.repository.pool.query("select * from material_governance_specs where governance_row_id=any($1::bigint[]) order by governance_row_id,component_code", [sourceIds])
      : { rows: [] };
    return { data: {
      ...groupDto(group.rows[0]),
      sources: visibleSources,
      sources_next_after_id: rows.rows.length > page.limit ? numberValue(visibleSources.at(-1)?.id) : null,
      supplier_candidates: supplierCandidateDtos(supplierRows.rows.slice(0, 100)),
      supplier_candidates_truncated: supplierRows.rows.length > 100,
      specifications: specs.rows,
      material_candidates: candidates.rows,
      alternative_candidates: alternatives.rows.slice(0, 100),
      alternative_candidates_truncated: alternatives.rows.length > 100,
      decision: decision.rows[0] ?? null,
      material_link: link.rows[0] ?? null,
    } };
  }

  async rows(batchId: number, runId: number, actor: GovernanceActor, page: GovernancePage, exceptionsOnly = false) {
    requirePermission(actor, "material.import.governance.read");
    await this.repository.visibleRun(this.repository.pool, batchId, runId, actor);
    const result = await this.repository.pool.query(`
      select r.*,g.category,g.readiness,g.canonical_key,g.canonical_specification,g.decision_status,
             l.material_id,m.internal_material_code
      from material_governance_rows r
      join material_governance_groups g on g.id=r.group_id
      left join material_governance_material_links l on l.group_id=g.id
      left join material_master m on m.id=l.material_id
      where r.governance_run_id=$1 and r.id>$2 ${exceptionsOnly ? "and (r.issue_count>0 or g.readiness<>'READY')" : ""}
      order by r.id limit $3
    `, [runId, page.afterId, page.limit + 1]);
    const visible = result.rows.slice(0, page.limit);
    return { items: visible, next_after_id: result.rows.length > page.limit ? numberValue(visible.at(-1)?.id) : null };
  }

  async report(batchId: number, runId: number, actor: GovernanceActor, kind: string, page: GovernancePage) {
    requirePermission(actor, "material.import.governance.read");
    await this.repository.visibleRun(this.repository.pool, batchId, runId, actor);
    const reports: Record<string, string> = {
      materials: `
        select g.id,g.canonical_key governance_key,g.standard_name material_name,g.canonical_specification specification,
               g.category,g.readiness,g.source_count,g.decision_status,l.material_id,m.internal_material_code erp_material_code,m.material_status
        from material_governance_groups g
        left join material_governance_material_links l on l.group_id=g.id
        left join material_master m on m.id=l.material_id
        where g.governance_run_id=$1 and g.id>$2 order by g.id limit $3`,
      "bom-mapping": `
        select r.id,r.source_bom project,r.original_part_number,r.manufacturer_part_number,
               r.supplier_part_number,r.source_model,r.original_material_name,r.original_specification,
               r.source_quantity quantity,r.source_quantity_raw quantity_raw,r.source_unit unit,g.canonical_key governance_key,
               l.material_id,m.internal_material_code erp_material_code,g.decision_status
        from material_governance_rows r join material_governance_groups g on g.id=r.group_id
        left join material_governance_material_links l on l.group_id=g.id left join material_master m on m.id=l.material_id
        where r.governance_run_id=$1 and r.id>$2 order by r.id limit $3`,
      duplicates: `
        select r.id,r.group_id,g.canonical_key governance_key,g.category,g.merge_evidence,g.source_count,
               r.original_part_number,r.manufacturer_part_number,r.supplier_part_number,r.source_model,
               r.original_description,r.original_specification,r.original_manufacturer,r.original_supplier
        from material_governance_rows r join material_governance_groups g on g.id=r.group_id
        where r.governance_run_id=$1 and r.id>$2 and g.source_count>1 order by r.id limit $3`,
      exceptions: `
        select r.id,r.group_id,g.category,g.readiness,r.original_part_number,r.manufacturer_part_number,
               r.supplier_part_number,r.source_model,r.original_material_name,r.original_specification,
               r.source_bom,r.issues,r.error_count,r.warning_count
        from material_governance_rows r join material_governance_groups g on g.id=r.group_id
        where r.governance_run_id=$1 and r.id>$2 and (r.issue_count>0 or g.readiness<>'READY') order by r.id limit $3`,
      alternatives: `
        with supplier_source_base as (
          select distinct on (
                   r.group_id,coalesce(r.original_supplier,''),coalesce(r.original_manufacturer,''),
                   coalesce(r.original_brand,''),
                   coalesce(r.original_part_number,''),coalesce(r.manufacturer_part_number,''),
                   coalesce(r.supplier_part_number,'')
                 )
                 r.id source_row_id,r.group_id,g.canonical_key governance_key,g.category,
                 r.original_supplier,r.original_manufacturer,r.original_brand,r.original_part_number,
                 r.manufacturer_part_number,r.supplier_part_number
          from material_governance_rows r
          join material_governance_groups g on g.id=r.group_id
          where r.governance_run_id=$1 and g.readiness='READY'
            and coalesce(
              nullif(btrim(r.original_supplier),''),nullif(btrim(r.original_manufacturer),''),
              nullif(btrim(r.original_brand),''),nullif(btrim(r.original_part_number),''),
              nullif(btrim(r.manufacturer_part_number),''),nullif(btrim(r.supplier_part_number),'')
            ) is not null
          order by r.group_id,coalesce(r.original_supplier,''),coalesce(r.original_manufacturer,''),
                   coalesce(r.original_brand,''),
                   coalesce(r.original_part_number,''),coalesce(r.manufacturer_part_number,''),
                   coalesce(r.supplier_part_number,''),r.id
        ), supplier_source_ranked as (
          select supplier_source_base.*,
                 row_number() over (
                   partition by group_id
                   order by coalesce(original_supplier,''),coalesce(original_manufacturer,''),
                            coalesce(original_brand,''),
                            coalesce(original_part_number,''),coalesce(manufacturer_part_number,''),
                            coalesce(supplier_part_number,''),source_row_id
                 ) priority,
                 count(*) over (partition by group_id) candidate_count
          from supplier_source_base
        ), report_rows as (
          select a.id*2 report_id,'COMPATIBILITY_GROUP'::text candidate_scope,
                 a.main_group_id,a.alternative_group_id,a.compatibility_digest,a.status,a.evidence,
                 mg.canonical_key main_governance_key,ag.canonical_key alternative_governance_key,
                 mg.category,null::bigint source_row_id,null::text original_supplier,
                 null::text original_manufacturer,null::text original_brand,null::text original_part_number,
                 null::text manufacturer_part_number,null::text supplier_part_number,
                 null::bigint priority,null::text candidate_kind
          from material_governance_alternative_candidates a
          join material_governance_groups mg on mg.id=a.main_group_id
          join material_governance_groups ag on ag.id=a.alternative_group_id
          where a.governance_run_id=$1
          union all
          select source_row_id*2+1,'SAME_IDENTITY_SOURCE',group_id,group_id,null::text,
                 'SOURCE_MAPPING_CANDIDATE',
                 '["CATEGORY_AND_IDENTITY_EQUAL","DIFFERENT_SOURCE_REFERENCE"]'::jsonb,
                 governance_key,governance_key,category,source_row_id,original_supplier,
                 original_manufacturer,original_brand,original_part_number,manufacturer_part_number,
                 supplier_part_number,priority,
                 case when priority=1 then 'PRIMARY_SOURCE' else 'ALTERNATIVE_SOURCE' end
          from supplier_source_ranked where candidate_count>1
        )
        select report_id id,candidate_scope,main_group_id,alternative_group_id,
               compatibility_digest,status,evidence,main_governance_key,alternative_governance_key,
               category,source_row_id,original_supplier,original_manufacturer,original_part_number,
               original_brand,manufacturer_part_number,supplier_part_number,priority,candidate_kind
        from report_rows where report_id>$2 order by report_id limit $3`,
    };
    const sql = reports[kind];
    if (!sql) governanceFailure("GOVERNANCE_REPORT_NOT_FOUND", "治理报告类型不存在", 404);
    const result = await this.repository.pool.query(sql, [runId, page.afterId, page.limit + 1]);
    const visible = result.rows.slice(0, page.limit);
    return { report: kind, items: visible, next_after_id: result.rows.length > page.limit ? numberValue(visible.at(-1)?.id) : null };
  }
}
