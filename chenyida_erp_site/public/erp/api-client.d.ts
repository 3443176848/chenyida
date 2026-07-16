export class ErpApiError extends Error {
  status: number;
  code: string;
  requestId: string;
  details: unknown[];
  retryAfter: string;
  httpStatus: number;
  resultUnknown: boolean;
}
export type ProtectedWriteContext = { idempotencyKey: string; csrfToken: string };
export type ErpApiOptions = RequestInit & { protectedWrite?: ProtectedWriteContext };
export function api<T = unknown>(path: string, options?: ErpApiOptions): Promise<T>;
export type MaterialMultipartProgress = { loaded: number; total: number; lengthComputable: boolean };
export type MaterialMultipartOptions = {
  file: File;
  filename?: string;
  protectedWrite: ProtectedWriteContext;
  headers?: Record<string, string | number>;
  signal?: AbortSignal;
  onProgress?: (progress: MaterialMultipartProgress) => void;
};
export function materialMultipart<T = unknown>(path: string, options: MaterialMultipartOptions): Promise<T>;
export function safeMaterialReturnTo(value: unknown, fallback?: string): string;
