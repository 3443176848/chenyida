import {
  createD1MaterialMasterRepository,
  createMaterialDraftService,
  MaterialMasterServiceError,
  type CreateMaterialDraftCommand,
  type MaterialDuplicateCandidateWrite,
  type MaterialMasterD1Database,
} from "../material-master/index.ts";
import {
  createD1MaterialValidationRepository,
  createMaterialValidationService,
  type MaterialAttributeInput,
  type ValidationIssue,
} from "../material-validation/index.ts";
import { canonicalJson } from "./mapping-target-registry.ts";
import { MaterialImportServiceError, type MaterialImportServiceResult } from "./service.ts";

const IDEMPOTENCY_LEASE_SECONDS = 120;
const IDEMPOTENCY_TTL_SECONDS = 86_400;
const IDEMPOTENCY_RECOVERY_SECONDS = 7 * 86_400;
const AUDIT_RETENTION_SECONDS = 1_095 * 86_400;
const MAX_PAGE_SIZE = 50;
const MAX_CANDIDATE_SCAN = 500;

type BatchContext = {
  batch_id: number;
  batch_no: string;
  batch_status: string;
  current_version: number;
  created_by: string;
  normalization_run_id: number;
  run_status: string;
  result_digest: string;
  error_rows: number;
  warning_rows: number;
  file_id: number;
  approval_id: number | null;
  approved_by: string | null;
  approved_at: string | null;
};

type NormalizedRow = {
  id: number;
  batch_id: number;
  normalization_run_id: number;
  parse_run_id: number;
  source_sheet_index: number;
  source_row_number: number;
  normalized_payload_json: string;
  normalized_payload_hash: string;
  row_status: "VALID" | "WARNING" | "ERROR";
  error_count: number;
  warning_count: number;
  source_row_id: number;
};

type ExistingCandidate = {
  id: number;
  internal_material_code: string | null;
  standard_name: string;
  category_id: number;
  brand: string;
  manufacturer: string;
  manufacturer_part_number: string;
  model_value: string;
  specification_value: string;
  legacy_code: string;
  supplier_item_code: string;
};

type PreparedDraft = {
  command: CreateMaterialDraftCommand | null;
  issues: readonly Readonly<{ code: string; field: string; message: string }>[];
  candidates: readonly MaterialDuplicateCandidateWrite[];
  preview: Readonly<Record<string, unknown>>;
};

type GovernanceMatch<T> = Readonly<{
  status: "EXACT" | "MATCHED" | "NEEDS_REVIEW" | "NOT_PROVIDED";
  reason: "CODE" | "NAME" | "ALIAS" | "UNMATCHED" | "CONFLICT" | "NOT_PROVIDED";
  value: T | null;
  candidates: readonly T[];
}>;

type IdempotencyReservation =
  | { kind: "replay"; result: MaterialImportServiceResult }
  | {
      kind: "reserved";
      id: number;
      operationId: string;
      keyDigest: string;
      requestDigest: string;
      leaseTokenDigest: string;
    };

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeInteger(value: unknown, field: string, minimum = 1, maximum = Number.MAX_SAFE_INTEGER): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new MaterialImportServiceError("IMPORT_DRAFT_REQUEST_INVALID", `${field} 无效`, 400);
  }
  return number;
}

function assertIdempotencyKey(value: string): void {
  if (value.length < 8 || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new MaterialImportServiceError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key 必须为 8 到 200 个安全字符", 400);
  }
}

function normalizedKey(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").trim().toUpperCase() : "";
}

function candidateValue(container: unknown, key?: string): unknown {
  if (!container || typeof container !== "object" || Array.isArray(container)) return undefined;
  const value = key === undefined ? container : (container as Record<string, unknown>)[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>).candidate;
}

function stringCandidate(container: unknown, key?: string): string {
  const value = candidateValue(container, key);
  return typeof value === "string" ? value.trim() : "";
}

function issue(code: string, field: string, message: string) {
  return { code, field, message } as const;
}

async function loadBatchContext(
  database: MaterialMasterD1Database,
  batchId: number,
  username: string,
  canReadAny: boolean,
): Promise<BatchContext> {
  const row = await database.prepare(`
    SELECT
      b.id batch_id,b.batch_no,b.status batch_status,b.current_version,b.created_by,
      r.id normalization_run_id,r.run_status,r.result_digest,r.error_rows,r.warning_rows,
      f.id file_id,a.id approval_id,a.approved_by,a.approved_at
    FROM material_import_batches b
    INNER JOIN material_import_normalization_runs r
      ON r.id=b.current_normalization_run_id AND r.batch_id=b.id
    INNER JOIN material_import_files f ON f.batch_id=b.id
    LEFT JOIN material_import_normalization_approvals a
      ON a.normalization_run_id=r.id AND a.batch_id=b.id AND a.result_digest=r.result_digest
    WHERE b.id=?
    LIMIT 1
  `).bind(batchId).first<BatchContext>();
  if (!row || (!canReadAny && row.created_by !== username)) {
    throw new MaterialImportServiceError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
  }
  if (row.batch_status !== "NORMALIZED" || row.run_status !== "SUCCEEDED" || !row.result_digest) {
    throw new MaterialImportServiceError("IMPORT_DRAFT_NOT_READY", "当前批次没有可用的已发布规范化结果", 409, row.current_version);
  }
  return row;
}

async function listRows(
  database: MaterialMasterD1Database,
  context: BatchContext,
  afterRowId: number,
  limit: number,
): Promise<NormalizedRow[]> {
  const adaptive = Boolean(await database.prepare(
    "SELECT 1 AS present FROM pragma_table_info('material_import_normalized_rows') WHERE name='review_status'",
  ).first<{ present: number }>());
  const result = await database.prepare(`
    SELECT
      n.id,n.batch_id,n.normalization_run_id,n.parse_run_id,n.source_sheet_index,
      n.source_row_number,n.normalized_payload_json,n.normalized_payload_hash,
      n.row_status,n.error_count,n.warning_count,raw.id source_row_id
    FROM material_import_normalized_rows n
    INNER JOIN material_import_rows raw
      ON raw.batch_id=n.batch_id AND raw.parse_run_id=n.parse_run_id
      AND raw.sheet_index=n.source_sheet_index AND raw.row_number=n.source_row_number
    WHERE n.normalization_run_id=? AND n.id>? ${adaptive ? "AND n.review_status<>'REJECTED'" : ""}
    ORDER BY n.id
    LIMIT ?
  `).bind(context.normalization_run_id, afterRowId, limit).all<NormalizedRow>();
  return result.results ?? [];
}

async function resolveCategory(
  database: MaterialMasterD1Database,
  hint: string,
): Promise<GovernanceMatch<{ id: number; code: string; name: string }>> {
  if (!hint) return { status: "NEEDS_REVIEW", reason: "UNMATCHED", value: null, candidates: [] };
  const result = await database.prepare(`
    SELECT id,category_code code,category_name_cn name,
      CASE
        WHEN upper(category_code)=upper(?) THEN 'CODE'
        WHEN category_name_cn=? OR lower(category_name_en)=lower(?) THEN 'NAME'
        ELSE 'UNMATCHED'
      END match_reason
    FROM material_categories
    WHERE status='ACTIVE' AND category_level=4
      AND (upper(category_code)=upper(?) OR category_name_cn=? OR category_name_en=?)
    ORDER BY CASE WHEN upper(category_code)=upper(?) THEN 0 ELSE 1 END,id
    LIMIT 5
  `).bind(hint, hint, hint, hint, hint, hint, hint).all<{
    id: number; code: string; name: string; match_reason: "CODE" | "NAME" | "UNMATCHED";
  }>();
  const rows = result.results ?? [];
  const exact = rows.filter((row) => row.match_reason === "CODE");
  if (exact.length === 1) {
    const value = { id: exact[0].id, code: exact[0].code, name: exact[0].name };
    return { status: "EXACT", reason: "CODE", value, candidates: [value] };
  }
  if (rows.length === 1) {
    const value = { id: rows[0].id, code: rows[0].code, name: rows[0].name };
    return { status: "MATCHED", reason: "NAME", value, candidates: [value] };
  }
  if (rows.length > 1) {
    return {
      status: "NEEDS_REVIEW",
      reason: "CONFLICT",
      value: null,
      candidates: rows.map((row) => ({ id: row.id, code: row.code, name: row.name })),
    };
  }
  const suspected = await database.prepare(`
    SELECT id,category_code code,category_name_cn name
    FROM material_categories
    WHERE status='ACTIVE' AND category_level=4
      AND (
        instr(category_name_cn,?)>0 OR instr(?,category_name_cn)>0
        OR instr(lower(category_name_en),lower(?))>0
        OR instr(lower(?),lower(category_name_en))>0
      )
    ORDER BY id
    LIMIT 5
  `).bind(hint, hint, hint, hint).all<{ id: number; code: string; name: string }>();
  return {
    status: "NEEDS_REVIEW",
    reason: "UNMATCHED",
    value: null,
    candidates: suspected.results ?? [],
  };
}

async function resolveUnit(
  database: MaterialMasterD1Database,
  value: string,
): Promise<GovernanceMatch<{ id: number; code: string }>> {
  if (!value) return { status: "NEEDS_REVIEW", reason: "UNMATCHED", value: null, candidates: [] };
  const rows = (await database.prepare(`
    SELECT DISTINCT u.id,u.code,
      CASE WHEN upper(u.code)=upper(?) THEN 'CODE' ELSE 'ALIAS' END match_reason
    FROM units u
    LEFT JOIN unit_aliases a ON a.unit_id=u.id
    WHERE u.enabled=1 AND (upper(u.code)=upper(?) OR a.normalized_alias=?)
    ORDER BY CASE WHEN upper(u.code)=upper(?) THEN 0 ELSE 1 END,u.id
    LIMIT 5
  `).bind(value, value, value.normalize("NFKC").trim().toLowerCase(), value).all<{
    id: number; code: string; match_reason: "CODE" | "ALIAS";
  }>()).results ?? [];
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
  if (unique.length === 1) {
    const reason = unique[0].match_reason;
    const matched = { id: unique[0].id, code: unique[0].code };
    return {
      status: reason === "CODE" ? "EXACT" : "MATCHED",
      reason,
      value: matched,
      candidates: [matched],
    };
  }
  return {
    status: "NEEDS_REVIEW",
    reason: unique.length ? "CONFLICT" : "UNMATCHED",
    value: null,
    candidates: unique.map((row) => ({ id: row.id, code: row.code })),
  };
}

async function resolveBrand(
  database: MaterialMasterD1Database,
  value: string,
): Promise<GovernanceMatch<{ id: number; code: string; standard_name: string }>> {
  if (!value) return { status: "NOT_PROVIDED", reason: "NOT_PROVIDED", value: null, candidates: [] };
  const normalized = normalizedKey(value);
  const rows = (await database.prepare(`
    SELECT DISTINCT b.id,b.code,b.standard_name,
      CASE
        WHEN upper(b.code)=? THEN 'CODE'
        WHEN b.normalized_name=? THEN 'NAME'
        ELSE 'ALIAS'
      END match_reason
    FROM brands b
    LEFT JOIN brand_aliases a ON a.brand_id=b.id
    WHERE b.enabled=1
      AND (upper(b.code)=? OR b.normalized_name=? OR a.normalized_alias=?)
    ORDER BY CASE WHEN upper(b.code)=? THEN 0 WHEN b.normalized_name=? THEN 1 ELSE 2 END,b.id
    LIMIT 5
  `).bind(normalized, normalized, normalized, normalized, normalized, normalized, normalized).all<{
    id: number; code: string; standard_name: string; match_reason: "CODE" | "NAME" | "ALIAS";
  }>()).results ?? [];
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
  if (unique.length === 1) {
    const reason = unique[0].match_reason;
    const matched = {
      id: unique[0].id,
      code: unique[0].code,
      standard_name: unique[0].standard_name,
    };
    return {
      status: reason === "CODE" ? "EXACT" : "MATCHED",
      reason,
      value: matched,
      candidates: [matched],
    };
  }
  return {
    status: "NEEDS_REVIEW",
    reason: unique.length ? "CONFLICT" : "UNMATCHED",
    value: null,
    candidates: unique.map((row) => ({
      id: row.id,
      code: row.code,
      standard_name: row.standard_name,
    })),
  };
}

function attributeInput(payload: Record<string, unknown>): Record<string, MaterialAttributeInput> {
  const raw = payload.attributes;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).flatMap(([code, envelope]) => {
    const candidate = candidateValue(envelope);
    if (candidate === undefined || candidate === null) return [];
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const record = candidate as Record<string, unknown>;
      return [[code, { value: record.value, ...(typeof record.unit === "string" ? { unit: record.unit } : {}), source: "MATERIAL_IMPORT" }]];
    }
    return [[code, { value: candidate, source: "MATERIAL_IMPORT" }]];
  }));
}

function attributeComparable(payload: Record<string, unknown>, ...codes: string[]): string {
  const attributes = payload.attributes;
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return "";
  for (const code of codes) {
    const candidate = candidateValue(attributes, code);
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const value = (candidate as Record<string, unknown>).value;
      if (typeof value === "string" || typeof value === "number") return String(value);
    }
    if (typeof candidate === "string" || typeof candidate === "number") return String(candidate);
  }
  return "";
}

async function scanDuplicateCandidates(
  database: MaterialMasterD1Database,
  input: Readonly<{
    categoryId: number;
    name: string;
    brand: string;
    manufacturer: string;
    manufacturerPartNumber: string;
    model: string;
    specification: string;
    supplierPartNumber: string;
  }>,
): Promise<MaterialDuplicateCandidateWrite[]> {
  const result = await database.prepare(`
    SELECT
      m.id,m.internal_material_code,m.standard_name,m.category_id,m.brand,m.manufacturer,
      m.manufacturer_part_number,
      COALESCE((SELECT v.normalized_value FROM material_attribute_values v
        INNER JOIN material_attribute_definitions d ON d.id=v.attribute_definition_id
        WHERE v.material_id=m.id AND d.attribute_code='MODEL' LIMIT 1),'') model_value,
      COALESCE((SELECT v.normalized_value FROM material_attribute_values v
        INNER JOIN material_attribute_definitions d ON d.id=v.attribute_definition_id
        WHERE v.material_id=m.id AND d.attribute_code IN ('SPECIFICATION','SPEC') ORDER BY d.attribute_code LIMIT 1),'') specification_value,
      COALESCE((SELECT a.normalized_alias FROM material_aliases a
        WHERE a.material_id=m.id AND a.alias_type='LEGACY_CODE' AND a.status='ACTIVE' LIMIT 1),'') legacy_code,
      COALESCE((SELECT s.supplier_item_code FROM supplier_mappings s
        WHERE s.material_id=m.id AND s.status IN ('PENDING','ACTIVE') ORDER BY s.id DESC LIMIT 1),'') supplier_item_code
    FROM material_master m
    WHERE m.material_status IN ('DRAFT','PENDING_REVIEW','ACTIVE')
      AND (
        m.category_id=? OR upper(m.standard_name)=upper(?) OR
        (?<>'' AND upper(m.manufacturer_part_number)=upper(?)) OR
        (?<>'' AND EXISTS(SELECT 1 FROM supplier_mappings s WHERE s.material_id=m.id AND upper(s.supplier_item_code)=upper(?)))
      )
    ORDER BY CASE m.material_status WHEN 'ACTIVE' THEN 0 WHEN 'PENDING_REVIEW' THEN 1 ELSE 2 END,m.id
    LIMIT ?
  `).bind(
    input.categoryId,
    input.name,
    input.manufacturerPartNumber,
    input.manufacturerPartNumber,
    input.supplierPartNumber,
    input.supplierPartNumber,
    MAX_CANDIDATE_SCAN,
  ).all<ExistingCandidate>();

  const incoming = {
    name: normalizedKey(input.name),
    brand: normalizedKey(input.brand),
    manufacturer: normalizedKey(input.manufacturer),
    manufacturer_part_number: normalizedKey(input.manufacturerPartNumber),
    model: normalizedKey(input.model),
    specification: normalizedKey(input.specification),
    supplier_part_number: normalizedKey(input.supplierPartNumber),
  };
  const candidates: MaterialDuplicateCandidateWrite[] = [];
  for (const row of result.results ?? []) {
    const matched = new Set<string>();
    let score = row.category_id === input.categoryId ? 500 : 0;
    const candidate = {
      name: normalizedKey(row.standard_name),
      brand: normalizedKey(row.brand),
      manufacturer: normalizedKey(row.manufacturer),
      manufacturer_part_number: normalizedKey(row.manufacturer_part_number),
      model: normalizedKey(row.model_value),
      specification: normalizedKey(row.specification_value),
      supplier_part_number: normalizedKey(row.supplier_item_code),
      material_code: normalizedKey(row.internal_material_code),
      legacy_code: normalizedKey(row.legacy_code),
    };
    if (incoming.supplier_part_number && [candidate.supplier_part_number, candidate.material_code, candidate.legacy_code].includes(incoming.supplier_part_number)) {
      matched.add("supplier_part_no");
      score = 10_000;
    }
    if (incoming.manufacturer_part_number && incoming.manufacturer_part_number === candidate.manufacturer_part_number) {
      matched.add("manufacturer_part_no");
      score += 7_000;
      if (incoming.manufacturer && incoming.manufacturer === candidate.manufacturer) {
        matched.add("manufacturer");
        score += 2_000;
      }
    }
    if (incoming.name && incoming.name === candidate.name) {
      matched.add("name");
      score += 4_500;
    } else if (incoming.name && candidate.name && (incoming.name.includes(candidate.name) || candidate.name.includes(incoming.name))) {
      matched.add("name_partial");
      score += 2_500;
    }
    for (const [field, weight] of [["brand", 1_500], ["model", 1_500], ["specification", 1_500]] as const) {
      if (incoming[field] && incoming[field] === candidate[field]) {
        matched.add(field);
        score += weight;
      }
    }
    score = Math.min(10_000, score);
    const exact = matched.has("supplier_part_no")
      || (matched.has("manufacturer_part_no") && matched.has("manufacturer"))
      || (matched.has("name") && matched.has("brand") && (matched.has("model") || matched.has("specification")));
    const matchLevel = exact ? "EXACT" : score >= 7_000 ? "HIGH_CONFIDENCE" : score >= 3_500 ? "POSSIBLE" : null;
    if (matchLevel) candidates.push({
      candidateMaterialId: row.id,
      matchLevel,
      confidenceBasisPoints: score,
      matchedFields: [...matched].sort(),
    });
  }
  return candidates.sort((left, right) =>
    right.confidenceBasisPoints - left.confidenceBasisPoints
      || left.candidateMaterialId - right.candidateMaterialId,
  ).slice(0, 20);
}

async function prepareDraft(
  database: MaterialMasterD1Database,
  context: BatchContext,
  row: NormalizedRow,
  actor: string,
  requestId: string,
): Promise<PreparedDraft> {
  const issues: { code: string; field: string; message: string }[] = [];
  if (row.row_status === "ERROR" || row.error_count > 0) {
    issues.push(issue("IMPORT_NORMALIZATION_ROW_INVALID", "row_status", "规范化行仍有错误，不能创建草稿"));
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(row.normalized_payload_json) as Record<string, unknown>;
  } catch {
    return { command: null, issues: [issue("IMPORT_NORMALIZED_PAYLOAD_INVALID", "normalized_payload", "规范化结果无法安全读取")], candidates: [], preview: {} };
  }
  const basic = payload.basic;
  const standardName = stringCandidate(basic, "standard_name");
  const rawUnit = stringCandidate(basic, "unit");
  const rawBrand = stringCandidate(basic, "brand");
  const categoryHint = stringCandidate(payload.category_hint);
  const categoryMatch = await resolveCategory(database, categoryHint);
  const unit = await resolveUnit(database, rawUnit);
  const brand = await resolveBrand(database, rawBrand);
  const categoryId = categoryMatch.value?.id ?? null;
  if (!standardName) issues.push(issue("MATERIAL_STANDARD_NAME_REQUIRED", "basic.STANDARD_NAME", "标准名称不能为空"));
  if (!categoryId) issues.push(issue("IMPORT_CATEGORY_LEAF_REQUIRED", "category_hint.CATEGORY_HINT", "分类提示必须唯一命中启用的四级分类"));
  if (!unit.value) issues.push(issue("IMPORT_UNIT_NOT_STANDARDIZED", "basic.UNIT", "基础单位必须命中启用的标准单位或别名"));
  if (rawBrand && !brand.value) issues.push(issue("IMPORT_BRAND_NOT_STANDARDIZED", "basic.BRAND", "非空品牌必须命中启用的品牌或别名"));

  const requiredEnums = [
    ["purchase_type", "PURCHASE_TYPE"],
    ["inventory_type", "INVENTORY_TYPE"],
    ["inspection_type", "INSPECTION_TYPE"],
    ["environmental_requirement", "ENVIRONMENTAL_REQUIREMENT"],
  ] as const;
  for (const [key, code] of requiredEnums) {
    if (!stringCandidate(basic, key)) issues.push(issue("IMPORT_DRAFT_FIELD_REQUIRED", `basic.${code}`, `${code} 是创建草稿的必填字段`));
  }
  const attributes = attributeInput(payload);
  if (categoryId) {
    const validation = await createMaterialValidationService(
      createD1MaterialValidationRepository(database),
    ).validateForCreate({
      category_id: categoryId,
      basic_fields: { standard_name: standardName, unit: unit.value?.code ?? rawUnit, source_type: "MATERIAL_IMPORT" },
      attributes,
    });
    issues.push(...validation.errors.map((item: ValidationIssue) => issue(item.code, item.field, item.message)));
  }
  const supplierReference = payload.supplier_reference;
  const manufacturer = stringCandidate(basic, "manufacturer");
  const manufacturerPartNumber = stringCandidate(basic, "manufacturer_part_number");
  const specification = stringCandidate(supplierReference, "SUPPLIER_SPECIFICATION")
    || attributeComparable(payload, "SPECIFICATION", "SPEC");
  const model = attributeComparable(payload, "MODEL");
  const supplierPartNumber = stringCandidate(supplierReference, "SUPPLIER_ITEM_CODE");
  const candidates = categoryId ? await scanDuplicateCandidates(database, {
    categoryId,
    name: standardName,
    brand: brand.value?.standard_name ?? rawBrand,
    manufacturer,
    manufacturerPartNumber,
    model,
    specification,
    supplierPartNumber,
  }) : [];
  const blockingDuplicate = candidates.find((candidate) =>
    candidate.matchLevel === "EXACT" || candidate.matchLevel === "HIGH_CONFIDENCE",
  );
  if (blockingDuplicate) {
    issues.push(issue(
      blockingDuplicate.matchLevel === "EXACT"
        ? "IMPORT_DUPLICATE_EXACT_BLOCKED"
        : "IMPORT_DUPLICATE_CONFIRMATION_REQUIRED",
      "duplicate_candidates",
      blockingDuplicate.matchLevel === "EXACT"
        ? "发现完全重复候选，禁止创建草稿"
        : "发现高置信重复候选，必须先完成人工确认",
    ));
  }
  const preview = {
    normalized_row_id: row.id,
    source_sheet_index: row.source_sheet_index,
    source_row_number: row.source_row_number,
    source_row_status: row.row_status,
    category: categoryMatch,
    category_id: categoryId,
    standard_name: standardName,
    base_unit: unit,
    brand,
    duplicate_candidates: candidates,
  };
  if (issues.length || !categoryId || !unit.value) return { command: null, issues, candidates, preview };
  const sourceRef = `material-import:${context.batch_id}:${context.file_id}:${row.source_sheet_index}:${row.source_row_number}:normalization:${context.normalization_run_id}`;
  return {
    command: {
      basic_fields: {
        category_id: categoryId,
        standard_name: standardName,
        unit: unit.value.code,
        brand: brand.value?.standard_name ?? "",
        manufacturer,
        manufacturer_part_number: manufacturerPartNumber,
        procurement_type: stringCandidate(basic, "purchase_type"),
        inventory_type: stringCandidate(basic, "inventory_type"),
        lot_control_required: candidateValue(basic, "lot_control") ?? false,
        shelf_life_days: candidateValue(basic, "shelf_life_days") ?? null,
        inspection_type: stringCandidate(basic, "inspection_type"),
        environmental_requirement: stringCandidate(basic, "environmental_requirement"),
        source_ref: sourceRef,
      },
      attributes,
      source_type: "MATERIAL_IMPORT",
      context: {
        actor,
        request_id: requestId,
        import_trace: {
          batchId: context.batch_id,
          fileId: context.file_id,
          sourceRowId: row.source_row_id,
          normalizedRowId: row.id,
          normalizationApprovalId: context.approval_id!,
          baseUnitId: unit.value.id,
          brandId: brand.value?.id ?? null,
          duplicateCandidates: candidates,
        },
      },
    },
    issues,
    candidates,
    preview,
  };
}

async function reserveIdempotency(
  database: MaterialMasterD1Database,
  input: Readonly<{
    username: string;
    batchId: number;
    routeScope: string;
    rawKey: string;
    payload: Record<string, unknown>;
    now: Date;
  }>,
): Promise<IdempotencyReservation> {
  assertIdempotencyKey(input.rawKey);
  const keyDigest = await sha256(input.rawKey);
  const requestDigest = await sha256(canonicalJson({ method: "POST", path: input.routeScope, ...input.payload }));
  const existing = await database.prepare(`
    SELECT id,request_digest,operation_id,state,lease_token_digest,lease_expires_at,status_code,response_json
    FROM material_import_idempotency
    WHERE username=? AND method='POST' AND route_scope=? AND key_digest=?
  `).bind(input.username, input.routeScope, keyDigest).first<{
    id: number; request_digest: string; operation_id: string; state: string;
    lease_token_digest: string; lease_expires_at: number | null;
    status_code: number | null; response_json: string | null;
  }>();
  if (existing) {
    if (existing.request_digest !== requestDigest) {
      throw new MaterialImportServiceError("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key 已用于不同请求", 409);
    }
    if (existing.state === "COMPLETED" && existing.status_code && existing.response_json) {
      return { kind: "replay", result: { status: existing.status_code, payload: JSON.parse(existing.response_json), replayed: true } };
    }
    if ((existing.lease_expires_at ?? 0) > seconds(input.now)) {
      throw new MaterialImportServiceError("IDEMPOTENCY_REQUEST_IN_PROGRESS", "相同操作正在处理", 409);
    }
    const leaseTokenDigest = await sha256(`${existing.operation_id}:${crypto.randomUUID()}:lease`);
    const updated = await database.prepare(`
      UPDATE material_import_idempotency
      SET lease_token_digest=?,lease_expires_at=?,updated_at=?
      WHERE id=? AND state='PENDING' AND lease_expires_at<=?
    `).bind(leaseTokenDigest, seconds(input.now) + IDEMPOTENCY_LEASE_SECONDS, input.now.toISOString(), existing.id, seconds(input.now)).run();
    if ((updated.meta?.changes ?? 0) !== 1) throw new MaterialImportServiceError("IDEMPOTENCY_REQUEST_IN_PROGRESS", "相同操作正在处理", 409);
    return { kind: "reserved", id: existing.id, operationId: existing.operation_id, keyDigest, requestDigest, leaseTokenDigest };
  }
  const operationId = crypto.randomUUID();
  const leaseTokenDigest = await sha256(`${operationId}:${crypto.randomUUID()}:lease`);
  await database.prepare(`
    INSERT INTO material_import_idempotency(
      username,method,route_scope,key_digest,request_digest,operation_id,state,batch_id,
      lease_token_digest,lease_expires_at,created_at,updated_at,recovery_until
    ) VALUES(?,'POST',?,?,?,?,'PENDING',?,?,?,?,?,?)
  `).bind(
    input.username,
    input.routeScope,
    keyDigest,
    requestDigest,
    operationId,
    input.batchId,
    leaseTokenDigest,
    seconds(input.now) + IDEMPOTENCY_LEASE_SECONDS,
    input.now.toISOString(),
    input.now.toISOString(),
    seconds(input.now) + IDEMPOTENCY_RECOVERY_SECONDS,
  ).run();
  const created = await database.prepare(`
    SELECT id FROM material_import_idempotency
    WHERE username=? AND method='POST' AND route_scope=? AND key_digest=? AND operation_id=?
  `).bind(input.username, input.routeScope, keyDigest, operationId).first<{ id: number }>();
  if (!created) throw new MaterialImportServiceError("IDEMPOTENCY_REQUEST_IN_PROGRESS", "相同操作正在处理", 409);
  return { kind: "reserved", id: created.id, operationId, keyDigest, requestDigest, leaseTokenDigest };
}

function idempotencyCompletionStatement(
  database: MaterialMasterD1Database,
  reservation: Extract<IdempotencyReservation, { kind: "reserved" }>,
  status: number,
  payload: Record<string, unknown>,
  now: Date,
) {
  return database.prepare(`
    UPDATE material_import_idempotency
    SET state='COMPLETED',lease_expires_at=NULL,status_code=?,response_json=?,
      updated_at=?,expires_at=?
    WHERE id=? AND state='PENDING' AND operation_id=? AND request_digest=?
      AND lease_token_digest=?
  `).bind(
    status,
    JSON.stringify(payload),
    now.toISOString(),
    seconds(now) + IDEMPOTENCY_TTL_SECONDS,
    reservation.id,
    reservation.operationId,
    reservation.requestDigest,
    reservation.leaseTokenDigest,
  );
}

export async function inspectMaterialImportDraftGeneration(
  database: MaterialMasterD1Database,
  input: Readonly<{ batchId: number; username: string; canReadAny: boolean }>,
): Promise<MaterialImportServiceResult> {
  const context = await loadBatchContext(database, input.batchId, input.username, input.canReadAny);
  const counts = await database.prepare(`
    SELECT
      COUNT(*) total_rows,
      COALESCE(SUM(CASE WHEN row_status='ERROR' THEN 1 ELSE 0 END),0) error_rows,
      COALESCE(SUM(CASE WHEN row_status='WARNING' THEN 1 ELSE 0 END),0) warning_rows,
      COALESCE(SUM(CASE WHEN EXISTS(
        SELECT 1 FROM material_import_draft_links l WHERE l.normalized_row_id=n.id
      ) THEN 1 ELSE 0 END),0) linked_rows
    FROM material_import_normalized_rows n
    WHERE normalization_run_id=?
  `).bind(context.normalization_run_id).first<Record<string, number>>();
  return {
    status: 200,
    payload: {
      batch_id: context.batch_id,
      batch_no: context.batch_no,
      current_version: context.current_version,
      normalization_run_id: context.normalization_run_id,
      result_digest: context.result_digest,
      approval: context.approval_id ? {
        id: context.approval_id,
        approved_by: context.approved_by,
        approved_at: context.approved_at,
      } : null,
      counts: counts ?? { total_rows: 0, error_rows: 0, warning_rows: 0, linked_rows: 0 },
    },
  };
}

export async function dryRunMaterialImportDraftGeneration(
  database: MaterialMasterD1Database,
  input: Readonly<{
    batchId: number; username: string; canReadAny: boolean;
    afterRowId?: number; limit?: number; requestId: string;
  }>,
): Promise<MaterialImportServiceResult> {
  const context = await loadBatchContext(database, input.batchId, input.username, input.canReadAny);
  const afterRowId = input.afterRowId ?? 0;
  const limit = input.limit ?? 20;
  safeInteger(afterRowId, "after_row_id", 0);
  safeInteger(limit, "limit", 1, MAX_PAGE_SIZE);
  const rows = await listRows(database, context, afterRowId, limit + 1);
  const items = [];
  for (const row of rows.slice(0, limit)) {
    const prepared = await prepareDraft(database, context, row, input.username, input.requestId);
    items.push({ ...prepared.preview, ready: prepared.issues.length === 0, issues: prepared.issues });
  }
  return {
    status: 200,
    payload: {
      batch_id: context.batch_id,
      normalization_run_id: context.normalization_run_id,
      mode: "DRY_RUN",
      items,
      next_after_row_id: rows.length > limit ? rows[limit - 1].id : null,
    },
  };
}

export async function approveMaterialImportNormalization(
  database: MaterialMasterD1Database,
  input: Readonly<{
    batchId: number; username: string; canReadAny: boolean; canCommit: boolean;
    expectedVersion: number; resultDigest: string; acceptWarnings: boolean;
    rawKey: string; requestId: string; clock?: () => Date;
  }>,
): Promise<MaterialImportServiceResult> {
  if (!input.canCommit) throw new MaterialImportServiceError("FORBIDDEN", "没有批准规范化结果的权限", 403);
  const context = await loadBatchContext(database, input.batchId, input.username, input.canReadAny);
  if (context.current_version !== input.expectedVersion) throw new MaterialImportServiceError("VERSION_CONFLICT", "导入批次版本已变化", 409, context.current_version);
  if (context.result_digest !== input.resultDigest) throw new MaterialImportServiceError("IMPORT_NORMALIZATION_VERSION_CONFLICT", "规范化结果摘要已变化", 409, context.current_version);
  if (context.error_rows > 0) throw new MaterialImportServiceError("IMPORT_NORMALIZATION_HAS_ERRORS", "规范化结果仍有错误行，不能批准", 422);
  if (context.warning_rows > 0 && !input.acceptWarnings) throw new MaterialImportServiceError("IMPORT_NORMALIZATION_WARNING_CONFIRMATION_REQUIRED", "存在警告行，必须明确确认", 422);
  if (context.approval_id) {
    return { status: 200, payload: { batch_id: context.batch_id, normalization_run_id: context.normalization_run_id, approval_id: context.approval_id, replayed: true }, replayed: true };
  }
  const now = (input.clock ?? (() => new Date()))();
  const routeScope = `/api/material-master/import-batches/${context.batch_id}/normalization/approve`;
  const reservation = await reserveIdempotency(database, {
    username: input.username,
    batchId: context.batch_id,
    routeScope,
    rawKey: input.rawKey,
    payload: { expected_version: input.expectedVersion, result_digest: input.resultDigest, accept_warnings: input.acceptWarnings },
    now,
  });
  if (reservation.kind === "replay") return reservation.result;
  // A normalization run can be approved only once, so its globally unique id is
  // also a deterministic approval id and avoids a racy MAX(id) allocation.
  const approvalId = context.normalization_run_id;
  if (!Number.isSafeInteger(approvalId) || approvalId <= 0) {
    throw new MaterialImportServiceError("INTERNAL_ERROR", "规范化批准编号不可用", 500);
  }
  const payload = {
    batch_id: context.batch_id,
    normalization_run_id: context.normalization_run_id,
    approval_id: approvalId,
    result_digest: context.result_digest,
    approved_by: input.username,
    approved_at: now.toISOString(),
    operation_id: reservation.operationId,
  };
  await database.batch([
    database.prepare(`
      INSERT INTO material_import_normalization_approvals(
        id,batch_id,normalization_run_id,result_digest,approved_by,approved_at,request_id
      )
      SELECT ?,?,?,?,?,?,?
      WHERE EXISTS(
        SELECT 1 FROM material_import_batches b
        INNER JOIN material_import_normalization_runs r ON r.id=b.current_normalization_run_id
        WHERE b.id=? AND b.status='NORMALIZED' AND b.current_version=?
          AND r.id=? AND r.run_status='SUCCEEDED' AND r.result_digest=? AND r.error_rows=0
      )
    `).bind(approvalId, context.batch_id, context.normalization_run_id, context.result_digest, input.username, now.toISOString(), input.requestId, context.batch_id, context.current_version, context.normalization_run_id, context.result_digest),
    database.prepare(`
      INSERT INTO audit_log(
        username,action,detail,request_id,result,route_code,operation_id,
        idempotency_key_digest,error_code,retention_until,created_at
      ) VALUES(?,'MATERIAL_IMPORT_NORMALIZATION_APPROVED',? ,?,'success',
        'MATERIAL_IMPORT_DRAFT_GENERATION',?,?,'',?,?)
    `).bind(input.username, String(context.batch_id), input.requestId, reservation.operationId, reservation.keyDigest, seconds(now) + AUDIT_RETENTION_SECONDS, now.toISOString()),
    idempotencyCompletionStatement(database, reservation, 200, payload, now),
  ]);
  const approval = await database.prepare(`
    SELECT id FROM material_import_normalization_approvals
    WHERE batch_id=? AND normalization_run_id=? AND result_digest=?
  `).bind(context.batch_id, context.normalization_run_id, context.result_digest).first<{ id: number }>();
  if (!approval) throw new MaterialImportServiceError("IMPORT_NORMALIZATION_VERSION_CONFLICT", "规范化批准竞争失败", 409, context.current_version);
  return { status: 200, payload: { ...payload, approval_id: approval.id } };
}

export async function commitMaterialImportDraftGeneration(
  database: MaterialMasterD1Database,
  input: Readonly<{
    batchId: number; username: string; canReadAny: boolean; canCommit: boolean;
    expectedVersion: number; afterRowId?: number; limit?: number;
    rawKey: string; requestId: string; clock?: () => Date;
  }>,
): Promise<MaterialImportServiceResult> {
  if (!input.canCommit) throw new MaterialImportServiceError("FORBIDDEN", "没有生成物料草稿的权限", 403);
  const context = await loadBatchContext(database, input.batchId, input.username, input.canReadAny);
  if (!context.approval_id) throw new MaterialImportServiceError("IMPORT_NORMALIZATION_NOT_APPROVED", "规范化结果尚未批准", 409, context.current_version);
  if (context.current_version !== input.expectedVersion) throw new MaterialImportServiceError("VERSION_CONFLICT", "导入批次版本已变化", 409, context.current_version);
  const afterRowId = input.afterRowId ?? 0;
  const limit = input.limit ?? 20;
  safeInteger(afterRowId, "after_row_id", 0);
  safeInteger(limit, "limit", 1, MAX_PAGE_SIZE);
  const now = (input.clock ?? (() => new Date()))();
  const routeScope = `/api/material-master/import-batches/${context.batch_id}/drafts`;
  const reservation = await reserveIdempotency(database, {
    username: input.username,
    batchId: context.batch_id,
    routeScope,
    rawKey: input.rawKey,
    payload: { expected_version: input.expectedVersion, after_row_id: afterRowId, limit },
    now,
  });
  if (reservation.kind === "replay") return reservation.result;
  const rows = await listRows(database, context, afterRowId, limit + 1);
  const service = createMaterialDraftService({
    repository: createD1MaterialMasterRepository(database),
    validationService: createMaterialValidationService(createD1MaterialValidationRepository(database)),
    clock: () => now,
  });
  const items: Record<string, unknown>[] = [];
  for (const row of rows.slice(0, limit)) {
    const linked = await database.prepare(`
      SELECT material_id FROM material_import_draft_links WHERE normalized_row_id=?
    `).bind(row.id).first<{ material_id: number }>();
    if (linked) {
      items.push({ normalized_row_id: row.id, status: "ALREADY_CREATED", material_id: linked.material_id });
      continue;
    }
    const prepared = await prepareDraft(database, context, row, input.username, `${input.requestId}:${row.id}`);
    if (!prepared.command) {
      items.push({ normalized_row_id: row.id, status: "BLOCKED", issues: prepared.issues, duplicate_candidates: prepared.candidates });
      continue;
    }
    try {
      const created = await service.createDraft(prepared.command);
      items.push({
        normalized_row_id: row.id,
        status: "CREATED",
        material_id: created.material.id,
        material_status: created.material.materialStatus,
        duplicate_candidates: prepared.candidates,
      });
    } catch (error) {
      const code = error instanceof MaterialMasterServiceError ? error.code : "MATERIAL_WRITE_FAILED";
      items.push({ normalized_row_id: row.id, status: "BLOCKED", issues: [issue(code, "row", "物料草稿创建失败，请检查当前主数据规则")] });
    }
  }
  const payload = {
    batch_id: context.batch_id,
    normalization_run_id: context.normalization_run_id,
    operation_id: reservation.operationId,
    items,
    next_after_row_id: rows.length > limit ? rows[limit - 1].id : null,
  };
  await database.batch([
    database.prepare(`
      INSERT INTO audit_log(
        username,action,detail,request_id,result,route_code,operation_id,
        idempotency_key_digest,error_code,retention_until,created_at
      ) VALUES(?,'MATERIAL_IMPORT_DRAFTS_GENERATED',?,?, 'success',
        'MATERIAL_IMPORT_DRAFT_GENERATION',?,?,'',?,?)
    `).bind(input.username, JSON.stringify({ batch_id: context.batch_id, item_count: items.length }).slice(0, 500), input.requestId, reservation.operationId, reservation.keyDigest, seconds(now) + AUDIT_RETENTION_SECONDS, now.toISOString()),
    idempotencyCompletionStatement(database, reservation, 200, payload, now),
  ]);
  return { status: 200, payload };
}

export async function reportMaterialImportDraftGeneration(
  database: MaterialMasterD1Database,
  input: Readonly<{
    batchId: number; username: string; canReadAny: boolean;
    afterLinkId?: number; limit?: number;
  }>,
): Promise<MaterialImportServiceResult> {
  const context = await loadBatchContext(database, input.batchId, input.username, input.canReadAny);
  const afterLinkId = input.afterLinkId ?? 0;
  const limit = input.limit ?? 20;
  safeInteger(afterLinkId, "after_link_id", 0);
  safeInteger(limit, "limit", 1, MAX_PAGE_SIZE);
  const result = await database.prepare(`
    SELECT
      l.id link_id,l.normalized_row_id,l.source_row_id,l.material_id,l.created_by,l.created_at,
      m.material_status,m.internal_material_code,m.standard_name,m.source_import_batch_id,
      m.source_import_file_id,m.source_import_row_id,
      (SELECT COUNT(*) FROM material_duplicate_candidates d WHERE d.draft_material_id=m.id) duplicate_candidate_count,
      (SELECT MAX(d.match_level) FROM material_duplicate_candidates d WHERE d.draft_material_id=m.id) highest_match_level
    FROM material_import_draft_links l
    INNER JOIN material_master m ON m.id=l.material_id
    WHERE l.batch_id=? AND l.id>?
    ORDER BY l.id
    LIMIT ?
  `).bind(context.batch_id, afterLinkId, limit + 1).all<Record<string, unknown>>();
  const rows = result.results ?? [];
  return {
    status: 200,
    payload: {
      batch_id: context.batch_id,
      normalization_run_id: context.normalization_run_id,
      items: rows.slice(0, limit),
      next_after_link_id: rows.length > limit ? rows[limit - 1].link_id : null,
    },
  };
}
