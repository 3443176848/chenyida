export class ProjectError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.name = "ProjectError"; this.code = code; this.status = status; }
}

export function mapProjectError(error: unknown): ProjectError {
  if (error instanceof ProjectError) return error;
  const value = error as { code?: string; status?: number; message?: string };
  if (["CSRF_INVALID", "PASSWORD_CHANGE_REQUIRED"].includes(value.code || "") && Number.isSafeInteger(value.status)) return new ProjectError(value.code!, value.message || "请求安全校验失败", value.status);
  if (value.code === "23505") return new ProjectError("PROJECT_CONFLICT", "项目编号、需求版本或文件引用发生冲突", 409);
  if (["23503", "23514", "22P02", "22003"].includes(value.code || "")) return new ProjectError("PROJECT_CONSTRAINT_VIOLATION", "项目数据不符合关系或数值约束", 422);
  if (["40001", "40P01"].includes(value.code || "")) return new ProjectError("PROJECT_CONCURRENCY_CONFLICT", "项目已被并发更新，请刷新后重试", 409);
  return new ProjectError("INTERNAL_ERROR", "服务器暂时无法处理项目请求", 500);
}
