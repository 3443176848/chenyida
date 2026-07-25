export class ProcurementSourcingError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.name = "ProcurementSourcingError"; this.code = code; this.status = status; }
}

export function mapProcurementSourcingError(error: unknown): ProcurementSourcingError {
  if (error instanceof ProcurementSourcingError) return error;
  const value = error as { code?: string; status?: number; message?: string };
  if (["CSRF_INVALID", "PASSWORD_CHANGE_REQUIRED"].includes(value.code || "") && Number.isSafeInteger(value.status)) return new ProcurementSourcingError(value.code!, value.message || "请求安全校验失败", value.status);
  if (value.code === "23505") return new ProcurementSourcingError("SOURCING_CONFLICT", "询价、报价、比较或定标已由另一请求处理", 409);
  if (["40001", "40P01", "55P03"].includes(value.code || "")) return new ProcurementSourcingError("SOURCING_CONCURRENCY_CONFLICT", "采购询比价状态正被并发更新，请刷新后重试", 409);
  if (["23503", "23514", "22P02", "22003", "55000", "42501"].includes(value.code || "")) return new ProcurementSourcingError("SOURCING_CONSTRAINT_VIOLATION", "询价、报价或定标不符合关系、数量或不可变约束", 422);
  return new ProcurementSourcingError("INTERNAL_ERROR", "服务器暂时无法处理采购询比价", 500);
}
