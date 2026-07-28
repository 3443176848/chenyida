export class MaterialGovernanceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly currentVersion?: number;

  constructor(code: string, message: string, status = 400, currentVersion?: number) {
    super(message);
    this.name = "MaterialGovernanceError";
    this.code = code;
    this.status = status;
    this.currentVersion = currentVersion;
  }
}

export function governanceFailure(code: string, message: string, status = 400, currentVersion?: number): never {
  throw new MaterialGovernanceError(code, message, status, currentVersion);
}
