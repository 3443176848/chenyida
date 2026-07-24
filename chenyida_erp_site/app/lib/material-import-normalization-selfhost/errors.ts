export class MaterialImportNormalizationError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly currentVersion?: number;

  constructor(
    code: string,
    message: string,
    status = 400,
    options?: Readonly<{ retryable?: boolean; currentVersion?: number }>,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = options?.retryable ?? false;
    this.currentVersion = options?.currentVersion;
  }
}

export function normalizationFailure(
  code: string,
  message: string,
  status = 400,
  options?: Readonly<{ retryable?: boolean; currentVersion?: number }>,
): never {
  throw new MaterialImportNormalizationError(code, message, status, options);
}
