import type { MaterialMasterD1Database } from "../material-master/index.ts";
import { MaterialApiFailure } from "./security.ts";

export type MaterialAuditExportQuery = Readonly<{
  role: string;
  afterId?: number;
  pageSize?: number;
  retentionDueBefore?: number;
}>;

export async function exportMaterialApiAudit(
  database: MaterialMasterD1Database,
  query: MaterialAuditExportQuery,
): Promise<Readonly<{ items: readonly Record<string, unknown>[]; next_after_id: number | null }>> {
  if (query.role !== "admin" && query.role !== "manager") {
    throw new MaterialApiFailure("FORBIDDEN", "当前账号没有 API 审计查看权限", 403);
  }
  const afterId = query.afterId ?? 0;
  const pageSize = query.pageSize ?? 500;
  if (!Number.isSafeInteger(afterId) || afterId < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new MaterialApiFailure("REQUEST_VALIDATION_FAILED", "审计导出分页参数无效", 400);
  }
  const result = query.retentionDueBefore === undefined
    ? await database.prepare(`
        SELECT id, username, action, request_id, result, route_code, material_id,
               operation_id, idempotency_key_digest, old_version, new_version,
               error_code, retention_until, created_at
        FROM audit_log
        WHERE route_code LIKE 'MATERIAL_%' AND id > ?
        ORDER BY id LIMIT ?
      `).bind(afterId, pageSize).all<Record<string, unknown>>()
    : await database.prepare(`
        SELECT id, username, action, request_id, result, route_code, material_id,
               operation_id, idempotency_key_digest, old_version, new_version,
               error_code, retention_until, created_at
        FROM audit_log
        WHERE route_code LIKE 'MATERIAL_%' AND id > ? AND retention_until <= ?
        ORDER BY id LIMIT ?
      `).bind(afterId, query.retentionDueBefore, pageSize).all<Record<string, unknown>>();
  const items = result.results ?? [];
  const last = items.at(-1)?.id;
  return { items, next_after_id: typeof last === "number" && items.length === pageSize ? last : null };
}
