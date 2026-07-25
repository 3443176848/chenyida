export class ProcurementError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}
export function mapProcurementError(error: unknown): ProcurementError {
  if (error instanceof ProcurementError) return error;
  const value = error as { code?: string; message?: string; status?: number };
  if (value.code?.startsWith("INVENTORY_") && Number.isSafeInteger(value.status)) return new ProcurementError(value.code, value.message || "库存联动失败", value.status);
  if (["CSRF_INVALID", "PASSWORD_CHANGE_REQUIRED"].includes(value.code || "") && Number.isSafeInteger(value.status)) return new ProcurementError(value.code!, value.message || "请求安全校验失败", value.status);
  if (value.code === "23505") return new ProcurementError("PROCUREMENT_CONFLICT", "采购记录与现有数据冲突", 409);
  if (value.code === "23503") return new ProcurementError("PROCUREMENT_REFERENCE_INVALID", "采购引用的业务对象不存在", 422);
  if (value.code === "23514") return new ProcurementError("PROCUREMENT_CONSTRAINT_VIOLATION", "采购数量、金额或状态不符合约束", 422);
  if (["40001", "40P01"].includes(value.code || "")) return new ProcurementError("PROCUREMENT_CONCURRENCY_CONFLICT", "采购数据已被并发更新，请刷新后重试", 409);
  return new ProcurementError("INTERNAL_ERROR", "服务器暂时无法处理采购请求", 500);
}
