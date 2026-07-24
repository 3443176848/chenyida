export class IdentityError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfter: number | null;

  constructor(code: string, message: string, status = 400, retryAfter: number | null = null) {
    super(message);
    this.name = "IdentityError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function identityErrorBody(error: IdentityError, requestId: string): Record<string, unknown> {
  return {
    error: { code: error.code, message: error.message, request_id: requestId },
    code: error.code,
    message: error.message,
    request_id: requestId,
  };
}

export function internalIdentityError(): IdentityError {
  return new IdentityError("INTERNAL_ERROR", "服务器暂时无法处理请求", 500);
}

export function versionConflict(): never {
  throw new IdentityError("VERSION_CONFLICT", "用户版本已变化，请刷新后重试", 409);
}

export function permissionDenied(): never {
  throw new IdentityError("PERMISSION_DENIED", "没有权限执行此操作", 403);
}
