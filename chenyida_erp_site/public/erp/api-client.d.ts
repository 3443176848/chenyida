export class ErpApiError extends Error {
  status: number;
  code: string;
  requestId: string;
  details: unknown[];
  retryAfter: string;
}
export type ProtectedWriteContext = { idempotencyKey: string; csrfToken: string };
export type ErpApiOptions = RequestInit & { protectedWrite?: ProtectedWriteContext };
export function api<T = unknown>(path: string, options?: ErpApiOptions): Promise<T>;
export function safeMaterialReturnTo(value: unknown, fallback?: string): string;
