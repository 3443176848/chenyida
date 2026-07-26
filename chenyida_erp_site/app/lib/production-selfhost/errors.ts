export class ProductionError extends Error {
  readonly code: string; readonly status: number; readonly details?: unknown;
  constructor(code: string, message: string, status = 400, details?: unknown) { super(message); this.code = code; this.status = status; this.details = details; }
}

const constraintCodes: Record<string, [string, string]> = {
  production_work_orders_code_uq: ["WORK_ORDER_CODE_CONFLICT", "工单编码冲突，请重试"],
  production_bom_snapshots_wo_uq: ["WORK_ORDER_ALREADY_RELEASED", "工单已经释放"],
  production_material_requirements_quantity_ck: ["PRODUCTION_QUANTITY_CONFLICT", "生产物料数量违反约束"],
  production_report_reversals_report_uq: ["PRODUCTION_REPORT_ALREADY_REVERSED", "生产报工已经冲销"],
  production_completion_reversals_completion_uq: ["PRODUCTION_COMPLETION_ALREADY_REVERSED", "生产完工已经冲销"],
  production_completion_report_allocations_source_uq: ["PRODUCTION_REPORT_ALLOCATION_CONFLICT", "报工来源已被本次完工分配"],
  production_completion_reversal_allocation_gate_ck: ["PRODUCTION_COMPLETION_DOWNSTREAM_EXISTS", "完工已有有效销售订单分配，不能冲销"],
  production_work_centers_code_uq: ["WORK_CENTER_CODE_CONFLICT", "工作中心编码已存在"],
  production_routing_headers_product_uq: ["PRODUCT_ROUTING_EXISTS", "该产品已经存在工艺路线"],
  production_routing_operations_sequence_uq: ["ROUTING_SEQUENCE_CONFLICT", "工序顺序不能重复"],
  production_routing_operations_code_uq: ["ROUTING_OPERATION_CODE_CONFLICT", "同一路线版本的工序编码不能重复"],
  production_routing_versions_current_product_uq: ["ROUTING_RELEASE_CONFLICT", "该产品版本已有当前发布路线"],
  production_work_order_routing_snapshots_wo_uq: ["WORK_ORDER_ROUTING_ALREADY_SNAPSHOTTED", "工单已经存在工艺快照"],
};

export function mapProductionError(error: unknown): ProductionError {
  if (error instanceof ProductionError) return error;
  const value = error as { code?: string; constraint?: string; status?: number; message?: string };
  if (value?.code && /^[A-Z][A-Z0-9_]+$/.test(value.code) && Number.isInteger(value.status) && value.status! >= 400 && value.status! <= 599) return new ProductionError(value.code, value.message || "生产关联操作失败", value.status);
  if (value?.code === "23505" && value.constraint && constraintCodes[value.constraint]) { const [code, message] = constraintCodes[value.constraint]; return new ProductionError(code, message, 409); }
  if (value?.code === "23514" && value.constraint && constraintCodes[value.constraint]) { const [code, message] = constraintCodes[value.constraint]; return new ProductionError(code, message, 409); }
  if (value?.code === "23503" || value?.code === "23514") return new ProductionError("PRODUCTION_REFERENCE_OR_CONSTRAINT_CONFLICT", "生产记录引用或数量约束已变化，请刷新后重试", 409);
  return new ProductionError("INTERNAL_ERROR", "服务器暂时无法处理生产请求", 500);
}
