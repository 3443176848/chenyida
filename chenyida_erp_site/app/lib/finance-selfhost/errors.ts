export class FinanceError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}
const constraints: Record<string, [string, string]> = {
  finance_documents_code_uq: ["FINANCE_CODE_CONFLICT", "财务单据编号已经存在"],
  finance_documents_operation_uq: ["FINANCE_OPERATION_CONFLICT", "财务制单操作已经存在"],
  finance_documents_request_uq: ["FINANCE_OPERATION_CONFLICT", "财务制单请求已经存在"],
  finance_documents_sales_source_uq: ["FINANCE_SOURCE_ALREADY_POSTED", "该销售金额来源已经生成应收"],
  finance_documents_purchase_source_uq: ["FINANCE_SOURCE_ALREADY_POSTED", "该采购金额来源已经生成应付"],
  finance_settlements_code_uq: ["FINANCE_CODE_CONFLICT", "收付款流水号已经存在"],
  finance_settlements_operation_uq: ["FINANCE_OPERATION_CONFLICT", "收付款操作已经存在"],
  finance_settlements_reversal_uq: ["FINANCE_SETTLEMENT_ALREADY_REVERSED", "该收付款已经冲销"],
  finance_documents_source_ck: ["FINANCE_SOURCE_INVALID", "财务单据类型与稳定来源不匹配"],
  finance_documents_amount_ck: ["FINANCE_AMOUNT_INVALID", "财务单据金额投影不合法"],
  finance_documents_projection_ck: ["FINANCE_PROJECTION_INVALID", "财务单据余额或状态投影不一致"],
  finance_settlements_amount_ck: ["FINANCE_AMOUNT_INVALID", "收付款或冲销金额不合法"],
};

export function mapFinanceError(error: unknown): FinanceError {
  if (error instanceof FinanceError) return error;
  const value = error as { code?: string; constraint?: string; status?: number; message?: string };
  if (value?.code && /^[A-Z][A-Z0-9_]+$/.test(value.code) && Number.isInteger(value.status) && value.status! >= 400 && value.status! <= 599) return new FinanceError(value.code, value.message || "财务操作失败", value.status);
  if (value?.code === "23505" && value.constraint && constraints[value.constraint]) { const [code, message] = constraints[value.constraint]; return new FinanceError(code, message, 409); }
  if (value?.code === "23503") return new FinanceError("FINANCE_REFERENCE_INVALID", "财务记录引用的业务对象不存在", 422);
  if (value?.code === "23514" && value.constraint && constraints[value.constraint]) { const [code, message] = constraints[value.constraint]; return new FinanceError(code, message, 422); }
  if (["40001", "40P01"].includes(value?.code || "")) return new FinanceError("FINANCE_CONCURRENCY_CONFLICT", "财务数据已被并发更新，请刷新后重试", 409);
  if (/FinanceService|finance facts|finance documents/i.test(value?.message || "")) return new FinanceError("FINANCE_SERVICE_WRITE_REQUIRED", "财务记录只能通过受控服务写入", 403);
  if (/immutable/i.test(value?.message || "")) return new FinanceError("FINANCE_IMMUTABLE", "已过账财务事实不可修改或删除", 409);
  if (/source mismatch/i.test(value?.message || "")) return new FinanceError("FINANCE_SOURCE_INVALID", "财务稳定来源与单据不一致", 422);
  if (/settlement.*mismatch/i.test(value?.message || "")) return new FinanceError("FINANCE_SETTLEMENT_INVALID", "收付款类型或冲销关系不一致", 422);
  if (/posted finance document blocks source reversal/i.test(value?.message || "")) return new FinanceError("FINANCE_SOURCE_ALREADY_POSTED", "来源已形成财务单据，不能从上游直接冲销", 409);
  return new FinanceError("INTERNAL_ERROR", "服务器暂时无法处理财务请求", 500);
}
