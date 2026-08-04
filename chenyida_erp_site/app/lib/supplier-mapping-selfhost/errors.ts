export class SupplierMappingError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "SupplierMappingError";
    this.code = code;
    this.status = status;
  }
}

export function mapSupplierMappingError(error: unknown): SupplierMappingError {
  if (error instanceof SupplierMappingError) return error;
  const value = error as { code?: string; constraint?: string; message?: string; status?: number };
  if (["CSRF_INVALID", "PASSWORD_CHANGE_REQUIRED"].includes(value.code || "") && Number.isSafeInteger(value.status)) {
    return new SupplierMappingError(value.code!, value.message || "请求安全校验失败", value.status);
  }
  if (value.code === "23505") {
    if (["supplier_mapping_supplier_part_keys_identity_uq", "supplier_mappings_active_supplier_part_uq"].includes(value.constraint || "")) {
      return new SupplierMappingError("SUPPLIER_PART_NUMBER_CONFLICT", "该供应商料号已由另一条 Supplier Mapping 占用", 409);
    }
    return new SupplierMappingError("SUPPLIER_MAPPING_CONFLICT", "Supplier Mapping 已由另一请求建立或推进", 409);
  }
  if (value.code === "23P01") {
    return new SupplierMappingError("SUPPLIER_MAPPING_ACTIVE_CONFLICT", "该 Supplier/Material 有效期内已存在当前 ACTIVE 1:1 Mapping", 409);
  }
  if (["40001", "40P01", "55P03"].includes(value.code || "")) {
    return new SupplierMappingError("SUPPLIER_MAPPING_CONCURRENCY_CONFLICT", "Supplier Mapping 正被并发处理，请刷新后重试", 409);
  }
  if (["23503", "23514", "22P02", "22003", "55000", "42501"].includes(value.code || "")) {
    return new SupplierMappingError("SUPPLIER_MAPPING_CONSTRAINT_VIOLATION", "Supplier Mapping 不符合关系、状态、版本或不可变约束", 422);
  }
  return new SupplierMappingError("INTERNAL_ERROR", "服务器暂时无法处理 Supplier Mapping", 500);
}
