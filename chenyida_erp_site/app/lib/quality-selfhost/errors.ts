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
