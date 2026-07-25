export class MigrationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "MigrationError";
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details) {
  throw new MigrationError(code, message, details);
}

export function safeError(error) {
  if (error instanceof MigrationError) return { code: error.code, message: error.message };
  return { code: "MIGRATION_INTERNAL_ERROR", message: "迁移工具发生内部错误" };
}
