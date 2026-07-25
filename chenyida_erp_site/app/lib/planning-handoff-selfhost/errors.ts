export class PlanningHandoffError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.name = "PlanningHandoffError"; this.code = code; this.status = status; }
}

export function mapPlanningHandoffError(error: unknown): PlanningHandoffError {
  if (error instanceof PlanningHandoffError) return error;
  const value = error as { code?: string; status?: number; message?: string; constraint?: string };
  if (["CSRF_INVALID", "PASSWORD_CHANGE_REQUIRED"].includes(value.code || "") && Number.isSafeInteger(value.status)) return new PlanningHandoffError(value.code!, value.message || "请求安全校验失败", value.status);
  if (value.code === "23505") return new PlanningHandoffError("PLANNING_HANDOFF_CONFLICT", "解析或计划交接包版本发生冲突", 409);
  if (["23503", "23514", "22P02", "22003", "55000"].includes(value.code || "")) return new PlanningHandoffError("PLANNING_HANDOFF_CONSTRAINT_VIOLATION", "计划交接数据不符合关系或不可变约束", 422);
  if (["40001", "40P01"].includes(value.code || "")) return new PlanningHandoffError("PLANNING_HANDOFF_CONCURRENCY_CONFLICT", "计划交接已被并发更新，请刷新后重试", 409);
  return new PlanningHandoffError("INTERNAL_ERROR", "服务器暂时无法处理计划交接请求", 500);
}
