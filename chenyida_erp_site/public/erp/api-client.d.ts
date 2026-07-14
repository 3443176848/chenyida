export class ErpApiError extends Error {
  status: number;
  code: string;
  requestId: string;
  details: unknown[];
}
export function api<T = unknown>(path: string, options?: RequestInit): Promise<T>;
export function safeMaterialReturnTo(value: unknown, fallback?: string): string;
