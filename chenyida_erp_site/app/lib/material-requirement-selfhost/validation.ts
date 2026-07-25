import { createHash } from "node:crypto";
import { MaterialRequirementError } from "./errors.ts";

export function canonicalDigest(value: unknown) {
  const normalize = (input: unknown): unknown => Array.isArray(input) ? input.map(normalize) : input && typeof input === "object" ? Object.fromEntries(Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)])) : input;
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}
export function positiveId(value: unknown, field: string) { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1) throw new MaterialRequirementError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`); return parsed; }
export function expectedVersion(value: unknown) { return positiveId(value, "expected_version"); }
export function assertOnlyKeys(value: Record<string, unknown>, keys: string[]) { const extra = Object.keys(value).find((key) => !keys.includes(key)); if (extra) throw new MaterialRequirementError("REQUEST_VALIDATION_FAILED", `请求正文包含不支持的字段：${extra}`); }
export function boundedText(value: unknown, field: string, maximum: number, required = false) { const text = String(value ?? "").trim(); if ((required && !text) || text.length > maximum) throw new MaterialRequirementError("REQUEST_VALIDATION_FAILED", `${field}长度必须在 ${required ? `1—${maximum}` : `0—${maximum}`} 字符之间`); return text; }
export function requiredDate(value: unknown, fallback?: unknown) { const text = String(value ?? fallback ?? "").trim(); const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : null; if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw new MaterialRequirementError("REQUIRED_DATE_INVALID", "需求日期必须是有效的 YYYY-MM-DD 日期", 422); return text; }
