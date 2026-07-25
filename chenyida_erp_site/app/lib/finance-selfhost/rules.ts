import { FinanceError } from "./errors.ts";
import type { FinanceDocumentType } from "./types.ts";

const DECIMAL = /^(0|[1-9]\d{0,17})(?:\.(\d{1,6}))?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function id(value: unknown, field: string): number { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new FinanceError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`); return parsed; }
export function version(value: unknown): number { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new FinanceError("REQUEST_VALIDATION_FAILED", "expected_version 必须是正整数"); return parsed; }
export function amount(value: unknown): string { const result = String(value ?? "").trim(); if (!DECIMAL.test(result) || /^0(?:\.0{1,6})?$/.test(result)) throw new FinanceError("REQUEST_VALIDATION_FAILED", "amount 必须是正数且最多 6 位小数"); return result; }
export function text(value: unknown, field: string, maximum: number, required = false): string { const result = String(value ?? "").normalize("NFKC").trim(); if ((required && !result) || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) throw new FinanceError("REQUEST_VALIDATION_FAILED", `${field} 无效`); return result; }
export function date(value: unknown, field: string, required = true): string | null { if (value === null || value === undefined || value === "") { if (required) throw new FinanceError("REQUEST_VALIDATION_FAILED", `${field} 不能为空`); return null; } const result = String(value).trim(); const parsed = new Date(`${result}T00:00:00Z`); if (!DATE.test(result) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== result) throw new FinanceError("REQUEST_VALIDATION_FAILED", `${field} 无效`); return result; }
export function documentType(value: unknown): FinanceDocumentType { const result = String(value ?? "").trim().toUpperCase(); if (result !== "AR" && result !== "AP") throw new FinanceError("REQUEST_VALIDATION_FAILED", "doc_type 必须是 AR 或 AP"); return result; }
