export class MaterialImportReviewError extends Error {
  readonly code: string;
  readonly status: number;
  readonly currentVersion?: number;
  readonly retryable: boolean;

  constructor(code: string, message: string, status = 400, options: Readonly<{ currentVersion?: number; retryable?: boolean }> = {}) {
    super(message);
    this.name = "MaterialImportReviewError";
    this.code = code;
    this.status = status;
    this.currentVersion = options.currentVersion;
    this.retryable = options.retryable ?? false;
  }
}

export function reviewFailure(
  code: string,
  message: string,
  status = 400,
  options: Readonly<{ currentVersion?: number; retryable?: boolean }> = {},
): never {
  throw new MaterialImportReviewError(code, message, status, options);
}
