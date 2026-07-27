export class QualityError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}

const constraints: Record<string, [string, string]> = {
  quality_inspections_operation_uq: ["QUALITY_OPERATION_CONFLICT", "检验操作已经存在"],
  quality_defects_operation_uq: ["QUALITY_OPERATION_CONFLICT", "缺陷操作已经存在"],
  quality_inspections_type_source_ck: ["QUALITY_SOURCE_INVALID", "检验类型与来源不匹配"],
  quality_inspections_quantity_ck: ["QUALITY_QUANTITY_INVALID", "检验数量不守恒"],
  quality_inspections_state_ck: ["QUALITY_STATE_CONFLICT", "检验状态不合法"],
  quality_inspections_source_match_ck: ["QUALITY_SOURCE_INVALID", "检验来源的物料或单位不一致"],
  quality_inspections_failed_evidence_ck: ["QUALITY_DEFECT_REQUIRED", "不良检验必须包含 FAIL 结果和有效缺陷"],
  quality_defects_total_ck: ["QUALITY_DEFECT_QUANTITY_EXCEEDED", "缺陷累计数量超过不良数量"],
  finished_goods_sales_allocations_pair_uq: ["FINISHED_GOODS_ALLOCATION_DUPLICATE", "同一完工明细与销售明细不能重复分配"],
  finished_goods_sales_allocations_operation_uq: ["FINISHED_GOODS_ALLOCATION_OPERATION_CONFLICT", "成品订单分配操作已经存在"],
  finished_goods_sales_allocations_source_match_ck: ["FINISHED_GOODS_ALLOCATION_SOURCE_MISMATCH", "完工与销售明细来源不一致"],
  finished_goods_sales_allocations_completion_capacity_ck: ["FINISHED_GOODS_ALLOCATION_EXCEEDED", "完工明细可分配数量不足"],
  finished_goods_sales_allocations_order_capacity_ck: ["FINISHED_GOODS_ALLOCATION_EXCEEDED", "销售明细可分配数量不足"],
  finished_goods_sales_allocations_fqc_gate_ck: ["FINISHED_GOODS_ALLOCATION_FQC_EXISTS", "分配已有 FQC，不能取消"],
  quality_inspections_fqc_allocation_ck: ["QUALITY_SOURCE_INVALID", "FQC 必须绑定有效稳定分配"],
  production_completion_reversal_allocation_gate_ck: ["PRODUCTION_COMPLETION_DOWNSTREAM_EXISTS", "完工已有有效销售分配，不能冲销"],
  production_nonconformances_inspection_uq: ["NONCONFORMANCE_ALREADY_EXISTS", "该检验已有稳定不合格记录"],
  production_nonconformances_operation_uq: ["NONCONFORMANCE_OPERATION_CONFLICT", "不合格建档操作已经存在"],
  production_nonconformances_source_ck: ["NONCONFORMANCE_SOURCE_INVALID", "只有包含 FAIL 结果和有效缺陷的已关闭工序 IPQC 可建档"],
  production_nonconformances_conservation_ck: ["NONCONFORMANCE_QUANTITY_CONFLICT", "不合格数量投影不守恒"],
  production_nonconformances_status_projection_ck: ["NONCONFORMANCE_STATE_CONFLICT", "不合格状态投影不一致"],
  production_rework_requests_operation_uq: ["REWORK_OPERATION_CONFLICT", "返工申请操作已经存在"],
  production_rework_requests_revision_uq: ["REWORK_REVISION_CONFLICT", "返工申请修订号冲突"],
  production_rework_requests_supersedes_uq: ["REWORK_REVISION_CONFLICT", "一个旧版本只能创建一个修订版本"],
  production_rework_requests_target_ck: ["REWORK_TARGET_INVALID", "返工目标必须是同一工单的原工序或更早工序"],
  production_rework_requests_revision_ck: ["REWORK_REVISION_INVALID", "返工申请修订链无效"],
  production_rework_requests_transition_ck: ["REWORK_STATE_CONFLICT", "返工申请状态转换无效"],
  production_nonconformance_allocations_source_match_ck: ["NONCONFORMANCE_ALLOCATION_INVALID", "不合格数量分配来源不一致"],
  production_nonconformance_allocations_release_state_ck: ["NONCONFORMANCE_ALLOCATION_INVALID", "只有退回或取消的返工申请可以释放数量"],
  production_nonconformance_allocations_capacity_ck: ["NONCONFORMANCE_QUANTITY_EXCEEDED", "返工与报废累计数量超过不合格数量"],
  quality_inspection_ncr_reopen_ck: ["NONCONFORMANCE_DOWNSTREAM_EXISTS", "检验已有不合格处置，不能重新打开"],
};

export function mapQualityError(error: unknown): QualityError {
  if (error instanceof QualityError) return error;
  const value = error as { code?: string; constraint?: string; status?: number; message?: string };
  if (value?.code && /^[A-Z][A-Z0-9_]+$/.test(value.code) && Number.isInteger(value.status) && value.status! >= 400 && value.status! <= 599) return new QualityError(value.code, value.message || "品质操作失败", value.status);
  if (value?.code === "23505" && value.constraint && constraints[value.constraint]) { const [code, message] = constraints[value.constraint]; return new QualityError(code, message, 409); }
  if (value?.code === "23503") return new QualityError("QUALITY_REFERENCE_INVALID", "品质记录引用的业务对象不存在", 422);
  if (value?.code === "23514" && value.constraint && constraints[value.constraint]) { const [code, message] = constraints[value.constraint]; return new QualityError(code, message, 422); }
  if (value?.code === "42501") return new QualityError("QUALITY_SERVICE_WRITE_REQUIRED", "品质记录只能通过受控服务写入", 403);
  if (value?.code === "55000") return new QualityError("QUALITY_IMMUTABLE", "品质事实记录不可修改或删除", 409);
  if (["40001", "40P01"].includes(value?.code || "")) return new QualityError("QUALITY_CONCURRENCY_CONFLICT", "品质数据已被并发更新，请刷新后重试", 409);
  return new QualityError("INTERNAL_ERROR", "服务器暂时无法处理品质请求", 500);
}
