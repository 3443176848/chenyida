export class MaterialRequirementError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.name = "MaterialRequirementError"; this.code = code; this.status = status; }
}

export function mapMaterialRequirementError(error: unknown): MaterialRequirementError {
  if (error instanceof MaterialRequirementError) return error;
  const value = error as { code?: string; status?: number; message?: string };
  if (["CSRF_INVALID", "PASSWORD_CHANGE_REQUIRED"].includes(value.code || "") && Number.isSafeInteger(value.status)) return new MaterialRequirementError(value.code!, value.message || "请求安全校验失败", value.status);
  if (value.code === "23505") return new MaterialRequirementError("MATERIAL_REQUIREMENT_CONFLICT", "物料需求计划版本或采购申请发生冲突", 409);
  if (["23503", "23514", "22P02", "22003", "55000", "42501"].includes(value.code || "")) return new MaterialRequirementError("MATERIAL_REQUIREMENT_CONSTRAINT_VIOLATION", "物料需求计划不符合关系、数量或不可变约束", 422);
  if (["40001", "40P01", "55P03"].includes(value.code || "")) return new MaterialRequirementError("MATERIAL_REQUIREMENT_CONCURRENCY_CONFLICT", "物料需求来源正被并发更新，请重新生成后重试", 409);
  return new MaterialRequirementError("INTERNAL_ERROR", "服务器暂时无法处理物料需求计划", 500);
}
