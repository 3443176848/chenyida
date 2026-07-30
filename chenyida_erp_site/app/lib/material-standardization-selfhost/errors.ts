export class MaterialStandardizationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function standardizationFailure(code: string, message: string, status = 400): never {
  throw new MaterialStandardizationError(code, message, status);
}
