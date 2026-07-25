import { createHash } from "node:crypto";
import { ProcurementSourcingError } from "./errors.ts";

export function canonicalDigest(value: unknown) {
  const normalize = (input: unknown): unknown => Array.isArray(input) ? input.map(normalize) : input && typeof input === "object" ? Object.fromEntries(Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)])) : input;
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}
export function positiveId(value: unknown, field: string) { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1) throw new ProcurementSourcingError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`); return parsed; }
export function expectedVersion(value: unknown, field = "expected_version") { return positiveId(value, field); }
export function boundedText(value: unknown, field: string, maximum: number, required = false) { const text = String(value ?? "").trim(); if ((required && !text) || text.length > maximum) throw new ProcurementSourcingError("REQUEST_VALIDATION_FAILED", `${field}长度必须在 ${required ? `1—${maximum}` : `0—${maximum}`} 字符之间`); return text; }
export function dateOnly(value: unknown, field: string) { const text = String(value ?? "").trim(); const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : null; if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw new ProcurementSourcingError("REQUEST_VALIDATION_FAILED", `${field}必须是有效的 YYYY-MM-DD 日期`); return text; }
export function booleanValue(value: unknown, field: string) { if (typeof value !== "boolean") throw new ProcurementSourcingError("REQUEST_VALIDATION_FAILED", `${field}必须为布尔值`); return value; }
export function decimal(value: unknown, field: string) { const text = String(value ?? "").trim(); if (!/^(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/.test(text) || /^0(?:\.0+)?$/.test(text)) throw new ProcurementSourcingError("REQUEST_VALIDATION_FAILED", `${field}必须是最多 6 位小数的正数`); return text; }
export function nonNegativeInteger(value: unknown, field: string) { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 36500) throw new ProcurementSourcingError("REQUEST_VALIDATION_FAILED", `${field}必须是 0—36500 的整数`); return parsed; }
export function uniqueIds(value: unknown, field: string, maximum = 50) { if (!Array.isArray(value) || !value.length || value.length > maximum) throw new ProcurementSourcingError("REQUEST_VALIDATION_FAILED", `${field}必须包含 1—${maximum} 个 ID`); const ids = value.map((item) => positiveId(item, field)); if (new Set(ids).size !== ids.length) throw new ProcurementSourcingError("REQUEST_VALIDATION_FAILED", `${field}不能重复`); return ids; }
export function exactKeys(value: Record<string, unknown>, keys: string[]) { const extra = Object.keys(value).find((key) => !keys.includes(key)); if (extra) throw new ProcurementSourcingError("REQUEST_VALIDATION_FAILED", `请求正文包含不支持的字段：${extra}`); }
