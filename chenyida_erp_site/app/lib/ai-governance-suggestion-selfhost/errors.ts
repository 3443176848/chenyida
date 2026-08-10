export class AiGovernanceSuggestionError extends Error {
  readonly code: string;
  readonly status: number;
  readonly currentVersion?: number;

  constructor(code: string, message: string, status = 400, currentVersion?: number) {
    super(message);
    this.name = "AiGovernanceSuggestionError";
    this.code = code;
    this.status = status;
    this.currentVersion = currentVersion;
  }
}

export function aiSuggestionFailure(code: string, message: string, status = 400, currentVersion?: number): never {
  throw new AiGovernanceSuggestionError(code, message, status, currentVersion);
}
