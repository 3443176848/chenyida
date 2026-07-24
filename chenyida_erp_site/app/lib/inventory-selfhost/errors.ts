export class InventoryError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}

export function mapInventoryError(error: unknown): InventoryError {
  if (error instanceof InventoryError) return error;
  const candidate = error as { code?: string; constraint?: string; status?: number; message?: string };
  if (candidate.status && candidate.status >= 400 && candidate.status < 500 && candidate.code && /^[A-Z][A-Z0-9_]+$/.test(candidate.code)) return new InventoryError(candidate.code, candidate.message || "请求被拒绝", candidate.status);
  if (candidate.code === "23505") return new InventoryError("INVENTORY_CONFLICT", "库存操作与已有记录冲突", 409);
  if (candidate.code === "23503") return new InventoryError("INVENTORY_REFERENCE_INVALID", "库存引用的业务对象不存在", 422);
  if (candidate.code === "23514") return new InventoryError("INVENTORY_CONSTRAINT_VIOLATION", "库存数量或状态不符合约束", 422);
  if (candidate.code === "40001" || candidate.code === "40P01") return new InventoryError("INVENTORY_CONCURRENCY_CONFLICT", "库存已被并发更新，请刷新后重试", 409);
  return new InventoryError("INTERNAL_ERROR", "服务器暂时无法处理库存请求", 500);
}
