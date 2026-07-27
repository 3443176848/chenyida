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
  production_operation_runs_operation_uq: ["OPERATION_RUN_OPERATION_CONFLICT", "工序派工操作已经提交"],
  production_operation_run_reversals_run_uq: ["OPERATION_RUN_ALREADY_REVERSED", "工序批次已经冲销"],
  production_operation_run_input_allocations_source_uq: ["OPERATION_UPSTREAM_ALLOCATION_CONFLICT", "前序良品分配发生冲突"],
  production_report_operation_allocations_source_uq: ["FINAL_OUTPUT_ALLOCATION_CONFLICT", "同一报工不能重复消费末工序来源"],
  production_report_operation_allocations_quantity_gate_ck: ["FINAL_OUTPUT_SOURCE_EXHAUSTED", "末工序 Run Report 良品已被消费或本次报工超量"],
  production_report_operation_allocations_lineage_ck: ["FINAL_OUTPUT_SOURCE_INVALID", "末工序来源与结构化报工不一致"],
  production_final_output_report_reconciliation_ck: ["FINAL_OUTPUT_RECONCILIATION_FAILED", "结构化报工与末工序来源分配无法核对"],
  production_operation_projection_reconciliation_ck: ["FINAL_OUTPUT_PROJECTION_CONFLICT", "末工序可报工投影无法核对"],
  production_report_operation_allocations_immutable_ck: ["FINAL_OUTPUT_ALLOCATION_IMMUTABLE", "末工序产出分配不可修改或删除"],
  production_batch_sets_work_order_uq: ["PRODUCTION_BATCH_SET_EXISTS", "该工单已经存在生产批次集合"],
  production_batches_code_uq: ["PRODUCTION_BATCH_CODE_CONFLICT", "生产批次编码冲突，请重试"],
  production_batch_sets_release_reconciliation_ck: ["PRODUCTION_BATCH_TOTAL_MISMATCH", "生产批次数量合计、工单或快照不满足发布条件"],
  production_operation_runs_batch_capacity_ck: ["PRODUCTION_BATCH_CAPACITY_EXCEEDED", "首工序累计投入超过生产批次计划数量"],
  production_operation_run_input_allocations_batch_ck: ["PRODUCTION_BATCH_CROSS_ALLOCATION", "禁止跨生产批次分配工序投入"],
  production_report_batches_lineage_ck: ["PRODUCTION_REPORT_BATCH_MIXED", "Production Report 只能消费同一生产批次"],
  production_completion_batches_lineage_ck: ["PRODUCTION_COMPLETION_BATCH_MIXED", "Completion 只能消费同一生产批次"],
  production_batch_mode_reconciliation_ck: ["PRODUCTION_BATCH_RECONCILIATION_FAILED", "生产批次事实与工单全过程谱系无法核对"],
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
