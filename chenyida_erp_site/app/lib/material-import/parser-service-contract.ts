export type MaterialImportParserServiceResult = Readonly<{
  status: number;
  payload: Record<string, unknown>;
  replayed?: boolean;
}>;

export class MaterialImportParserServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly expectedVersion?: number;

  constructor(code: string, message: string, status: number, expectedVersion?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.expectedVersion = expectedVersion;
  }
}
