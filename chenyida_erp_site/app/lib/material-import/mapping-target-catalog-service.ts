import type { MaterialMasterD1Database } from "../material-master/index.ts";
import { MaterialImportParserServiceError, type MaterialImportParserServiceResult } from "./parser-service.ts";
import {
  canonicalJson,
  MaterialImportMappingMetadataSnapshotService,
  sha256Text,
  type MaterialImportMappingMetadataSnapshot,
  type MaterialImportMappingTarget,
  type MaterialImportMappingTargetGroup,
} from "./mapping-target-registry.ts";

type CatalogBatch = { id: number; status: string; created_by: string; current_parse_run_id: number | null };

export type MaterialImportMappingTargetCatalogQuery = Readonly<{
  namespace?: MaterialImportMappingTargetGroup;
  q?: string;
  limit: number;
  cursor?: string;
}>;

export interface MaterialImportReadRateLimiter {
  consume(input: Readonly<{ username: string; limit: number; now: Date; routeCode?: string }>): Promise<void>;
}

export class D1MaterialImportReadRateLimiter implements MaterialImportReadRateLimiter {
  readonly #database: MaterialMasterD1Database;
  constructor(database: MaterialMasterD1Database) { this.#database = database; }
  async consume(input: Readonly<{ username: string; limit: number; now: Date; routeCode?: string }>): Promise<void> {
    const bucket = new Date(input.now);
    bucket.setUTCSeconds(0, 0);
    let row: { count: number } | null;
    try {
      row = await this.#database.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE username=? AND route_code=? AND created_at>=?").bind(input.username, input.routeCode ?? "MATERIAL_IMPORT_MAPPING_TARGET_CATALOG", bucket.toISOString()).first<{ count: number }>();
    } catch {
      throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE", "读取限流暂不可用", 503);
    }
    if ((row?.count ?? 0) >= input.limit) throw new MaterialImportParserServiceError("RATE_LIMITED", "请求过于频繁，请稍后重试", 429);
  }
}

type CursorLast = Readonly<{ group: MaterialImportMappingTargetGroup; order: number; namespace: string; code: string }>;
type CursorPayload = Readonly<{ version: 1; metadata_digest: string; search_projection_digest: string; namespace: MaterialImportMappingTargetGroup | null; query_digest: string; limit: number; last: CursorLast }>;

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_QUERY_INVALID", "cursor 无效", 400);
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  try {
    const binary = atob(padded);
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  } catch {
    throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_QUERY_INVALID", "cursor 无效", 400);
  }
}

async function encodeCursor(payload: CursorPayload): Promise<string> {
  const canonicalPayload = canonicalJson(payload);
  return encodeBase64Url(canonicalJson({ payload, checksum: await sha256Text(canonicalPayload) }));
}

async function decodeCursor(value: string): Promise<CursorPayload> {
  if (value.length < 1 || value.length > 1024) throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_QUERY_INVALID", "cursor 无效", 400);
  let envelope: unknown;
  try { envelope = JSON.parse(decodeBase64Url(value)); } catch (error) {
    if (error instanceof MaterialImportParserServiceError) throw error;
    throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_QUERY_INVALID", "cursor 无效", 400);
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_QUERY_INVALID", "cursor 无效", 400);
  const record = envelope as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "checksum,payload" || typeof record.checksum !== "string" || !record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_QUERY_INVALID", "cursor 无效", 400);
  const payload = record.payload as Record<string, unknown>;
  if (await sha256Text(canonicalJson(payload)) !== record.checksum) throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_QUERY_INVALID", "cursor 无效", 400);
  const last = payload.last as Record<string, unknown> | undefined;
  if (Object.keys(payload).sort().join(",") !== "last,limit,metadata_digest,namespace,query_digest,search_projection_digest,version"
    || payload.version !== 1
    || typeof payload.metadata_digest !== "string"
    || typeof payload.search_projection_digest !== "string"
    || (payload.namespace !== null && !new Set(["BASIC", "ATTRIBUTE", "SPECIAL"]).has(String(payload.namespace)))
    || typeof payload.query_digest !== "string"
    || !Number.isInteger(payload.limit)
    || !last
    || Object.keys(last).sort().join(",") !== "code,group,namespace,order"
    || !new Set(["BASIC", "ATTRIBUTE", "SPECIAL"]).has(String(last.group))
    || !Number.isInteger(last.order)
    || typeof last.namespace !== "string"
    || typeof last.code !== "string") throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_QUERY_INVALID", "cursor 无效", 400);
  return payload as unknown as CursorPayload;
}

export function normalizeCatalogSearch(value: string | undefined): string {
  if (value === undefined) return "";
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) return "";
  if (normalized.length > 64 || /[\u0000-\u001f\u007f]/.test(normalized)) throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_QUERY_INVALID", "q 必须是 1 到 64 个安全纯文本字符", 400);
  return normalized.toLocaleLowerCase("en-US");
}

function cursorLast(target: MaterialImportMappingTarget): CursorLast {
  return { group: target.group_code, order: target.display_order, namespace: target.target_namespace, code: target.target_code };
}

function sameLast(target: MaterialImportMappingTarget, last: CursorLast): boolean {
  return target.group_code === last.group && target.display_order === last.order && target.target_namespace === last.namespace && target.target_code === last.code;
}

function projectTarget(target: MaterialImportMappingTarget): Record<string, unknown> {
  return {
    group_code: target.group_code,
    target_namespace: target.target_namespace,
    target_code: target.target_code,
    display_name: target.display_name,
    description: target.description,
    value_type: target.value_type,
    required_for_confirm: target.required_for_confirm,
    mapping_modes: target.mapping_modes,
    default_value_policy: target.default_value_policy,
    unit_policy: target.unit_policy,
    value_constraints: target.value_constraints,
    enabled: target.enabled,
    selectable: target.selectable,
    constraints: target.constraints,
  };
}

async function visibleBatch(database: MaterialMasterD1Database, batchId: number, username: string, canReadAny: boolean): Promise<CatalogBatch> {
  const batch = await database.prepare("SELECT id,status,created_by,current_parse_run_id FROM material_import_batches WHERE id=?").bind(batchId).first<CatalogBatch>();
  if (!batch || (!canReadAny && batch.created_by !== username)) throw new MaterialImportParserServiceError("IMPORT_BATCH_NOT_FOUND", "导入批次不存在", 404);
  return batch;
}

async function auditCatalogRead(database: MaterialMasterD1Database, input: Readonly<{ username: string; batchId: number; namespace?: MaterialImportMappingTargetGroup; q: string; limit: number; hasCursor: boolean; resultCount: number; requestId: string; now: Date }>): Promise<void> {
  const detail = canonicalJson({ batch_id: input.batchId, namespace: input.namespace ?? null, has_search: Boolean(input.q), search_length: input.q.length, limit: input.limit, has_cursor: input.hasCursor, result_count: input.resultCount, status_code: 200 });
  try {
    await database.prepare("INSERT INTO audit_log(username,action,detail,request_id,result,route_code,retention_until,created_at) VALUES(?,'MATERIAL_IMPORT_MAPPING_TARGET_CATALOG_READ',?,?,'success','MATERIAL_IMPORT_MAPPING_TARGET_CATALOG',?,?)").bind(input.username, detail, input.requestId, Math.floor(input.now.getTime() / 1000) + 1_095 * 86_400, input.now.toISOString()).run();
  } catch {
    throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE", "Catalog 审计暂不可用", 503);
  }
}

export class MaterialImportMappingTargetCatalogService {
  readonly #database: MaterialMasterD1Database;
  readonly #snapshots: MaterialImportMappingMetadataSnapshotService;
  readonly #rateLimiter: MaterialImportReadRateLimiter;
  readonly #readLimit: number;
  readonly #clock: () => Date;
  constructor(database: MaterialMasterD1Database, options: Readonly<{ snapshotService?: MaterialImportMappingMetadataSnapshotService; rateLimiter?: MaterialImportReadRateLimiter; readLimit?: number; clock?: () => Date }> = {}) {
    this.#database = database;
    this.#snapshots = options.snapshotService ?? new MaterialImportMappingMetadataSnapshotService(database);
    this.#rateLimiter = options.rateLimiter ?? new D1MaterialImportReadRateLimiter(database);
    this.#readLimit = options.readLimit ?? 120;
    this.#clock = options.clock ?? (() => new Date());
  }

  async list(batchId: number, context: Readonly<{ username: string; canReadAny: boolean; canMap: boolean; requestId: string; query: MaterialImportMappingTargetCatalogQuery }>): Promise<MaterialImportParserServiceResult> {
    const batch = await visibleBatch(this.#database, batchId, context.username, context.canReadAny);
    if (!context.canMap) throw new MaterialImportParserServiceError("FORBIDDEN", "当前账号没有 Mapping 权限", 403);
    if (!batch.current_parse_run_id || !["PARSED", "AWAITING_MAPPING", "MAPPING_CONFIRMED"].includes(batch.status)) throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_CATALOG_NOT_AVAILABLE", "当前批次状态没有可用 Catalog", 409);
    if (!Number.isInteger(context.query.limit) || context.query.limit < 1 || context.query.limit > 100) throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_QUERY_INVALID", "limit 必须在 1 到 100 之间", 400);
    const q = normalizeCatalogSearch(context.query.q);
    const now = this.#clock();
    await this.#rateLimiter.consume({ username: context.username, limit: this.#readLimit, now });
    const snapshot = await this.#snapshots.current();
    const queryDigest = await sha256Text(q);
    let start = 0;
    const filtered = snapshot.targets.filter((target) => {
      if (context.query.namespace && target.group_code !== context.query.namespace) return false;
      if (!q) return true;
      return [target.target_code, target.display_name, target.description].some((value) => value.normalize("NFKC").toLocaleLowerCase("en-US").includes(q));
    });
    if (context.query.cursor) {
      const cursor = await decodeCursor(context.query.cursor);
      if (cursor.metadata_digest !== snapshot.metadataDigest || cursor.search_projection_digest !== snapshot.searchProjectionDigest) throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_CATALOG_CHANGED", "Catalog 已变化，请从第一页重新读取", 409);
      if (cursor.namespace !== (context.query.namespace ?? null) || cursor.query_digest !== queryDigest || cursor.limit !== context.query.limit) throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_QUERY_INVALID", "cursor 与查询条件不匹配", 400);
      const index = filtered.findIndex((target) => sameLast(target, cursor.last));
      if (index < 0) throw new MaterialImportParserServiceError("IMPORT_MAPPING_TARGET_QUERY_INVALID", "cursor 无效", 400);
      start = index + 1;
    }
    const page = filtered.slice(start, start + context.query.limit);
    const last = page.at(-1);
    const nextCursor = last && start + page.length < filtered.length ? await encodeCursor({ version: 1, metadata_digest: snapshot.metadataDigest, search_projection_digest: snapshot.searchProjectionDigest, namespace: context.query.namespace ?? null, query_digest: queryDigest, limit: context.query.limit, last: cursorLast(last) }) : null;
    await auditCatalogRead(this.#database, { username: context.username, batchId, namespace: context.query.namespace, q, limit: context.query.limit, hasCursor: Boolean(context.query.cursor), resultCount: page.length, requestId: context.requestId, now });
    return { status: 200, payload: { batch_id: batch.id, parse_run_id: batch.current_parse_run_id, metadata_digest: snapshot.metadataDigest, items: page.map(projectTarget), next_cursor: nextCursor } };
  }
}

export async function mappingMetadataSnapshot(database: MaterialMasterD1Database): Promise<MaterialImportMappingMetadataSnapshot> {
  return new MaterialImportMappingMetadataSnapshotService(database).current();
}
