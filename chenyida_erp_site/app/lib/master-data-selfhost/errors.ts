export class MasterDataError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.name = "MasterDataError"; this.code = code; this.status = status; }
}

export function mapMasterDataError(error: unknown): MasterDataError {
  if (error instanceof MasterDataError) return error;
  const value = error as { code?: string; constraint?: string; status?: number; message?: string };
  if (typeof value?.code === "string" && Number.isInteger(value.status) && Number(value.status) >= 400 && Number(value.status) <= 499) {
    return new MasterDataError(value.code, value.code === "CSRF_INVALID" ? "CSRF Token 无效" : "请求未通过安全校验", Number(value.status));
  }
  if (value?.code === "23505" || value?.code === "23P01") return new MasterDataError("MASTER_DATA_CONFLICT", "主数据编码、名称或有效期发生冲突", 409);
  if (["23503", "23514", "22P02", "22003"].includes(String(value?.code))) return new MasterDataError("MASTER_DATA_CONSTRAINT", "主数据不符合关系或数值约束", 422);
  return new MasterDataError("INTERNAL_ERROR", "服务器暂时无法处理请求", 500);
}
