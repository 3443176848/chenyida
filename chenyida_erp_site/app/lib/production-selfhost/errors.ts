export class ProductionError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}

const constraintCodes: Record<string, [string, string]> = {
  production_work_orders_code_uq: ["WORK_ORDER_CODE_CONFLICT", "工单编码冲突，请重试"],
  production_bom_snapshots_wo_uq: ["WORK_ORDER_ALREADY_RELEASED", "工单已经释放"],
  production_material_requirements_quantity_ck: ["PRODUCTION_QUANTITY_CONFLICT", "生产物料数量违反约束"],
};

export function mapProductionError(error: unknown): ProductionError {
  if (error instanceof ProductionError) return error;
  const value = error as { code?: string; constraint?: string; status?: number; message?: string };
  if (value?.code && /^[A-Z][A-Z0-9_]+$/.test(value.code) && Number.isInteger(value.status) && value.status! >= 400 && value.status! <= 599) return new ProductionError(value.code, value.message || "生产关联操作失败", value.status);
  if (value?.code === "23505" && value.constraint && constraintCodes[value.constraint]) { const [code, message] = constraintCodes[value.constraint]; return new ProductionError(code, message, 409); }
  if (value?.code === "23503" || value?.code === "23514") return new ProductionError("PRODUCTION_REFERENCE_OR_CONSTRAINT_CONFLICT", "生产记录引用或数量约束已变化，请刷新后重试", 409);
  return new ProductionError("INTERNAL_ERROR", "服务器暂时无法处理生产请求", 500);
}
