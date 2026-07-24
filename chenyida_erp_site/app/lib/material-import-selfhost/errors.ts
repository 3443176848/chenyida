export class MaterialImportMappingError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: readonly Record<string, unknown>[];
  readonly currentVersion?: number;

  constructor(code: string, message: string, status = 400, options?: Readonly<{ details?: readonly Record<string, unknown>[]; currentVersion?: number }>) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = options?.details ?? [];
    this.currentVersion = options?.currentVersion;
  }
}

export function mappingFailure(
  code: string,
  message: string,
  status = 400,
  options?: Readonly<{ details?: readonly Record<string, unknown>[]; currentVersion?: number }>,
): never {
  throw new MaterialImportMappingError(code, message, status, options);
}
