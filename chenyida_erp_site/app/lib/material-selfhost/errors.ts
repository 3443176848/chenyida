export type MaterialIssue = Readonly<{
  code: string;
  severity: "ERROR" | "WARNING";
  field: string;
  message: string;
  attribute_code?: string;
}>;

export class MaterialWorkflowError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: readonly MaterialIssue[];

  constructor(code: string, message: string, status = 400, details: readonly MaterialIssue[] = []) {
    super(message);
    this.name = "MaterialWorkflowError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function materialFailure(code: string, message: string, status = 400, details: readonly MaterialIssue[] = []): never {
  throw new MaterialWorkflowError(code, message, status, details);
}

export function mapMaterialDatabaseError(error: unknown): MaterialWorkflowError {
  const value = error as { code?: string; constraint?: string };
  if (value?.code === "23505") {
    if (value.constraint === "material_master_internal_code_uq") {
      return new MaterialWorkflowError("MATERIAL_CODE_CONFLICT", "正式物料编码发生并发冲突，请重试", 409);
    }
    return new MaterialWorkflowError("MATERIAL_UNIQUE_CONFLICT", "物料数据发生唯一性冲突", 409);
  }
  if (value?.code === "23503" || value?.code === "23514" || value?.code === "22P02") {
    return new MaterialWorkflowError("MATERIAL_DATA_CONSTRAINT", "物料数据不符合数据库约束", 422);
  }
  return new MaterialWorkflowError("INTERNAL_ERROR", "服务器暂时无法处理请求", 500);
}
