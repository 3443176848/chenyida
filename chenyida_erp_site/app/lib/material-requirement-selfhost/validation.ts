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

const invalidRequiredDate = () => new MaterialRequirementError("REQUIRED_DATE_INVALID", "需求日期必须是有效的 YYYY-MM-DD 日期", 422);

export function normalizeDateOnly(value: unknown) {
  let text: string;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw invalidRequiredDate();
    // node-postgres represents a PostgreSQL date as local midnight. Preserve those
    // calendar components: converting the value to UTC can move an eastern timezone
    // to the previous day even though the database date itself has no timezone.
    const year = value.getFullYear();
    if (year < 0 || year > 9999) throw invalidRequiredDate();
    text = `${String(year).padStart(4, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    throw invalidRequiredDate();
  }
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw invalidRequiredDate();
  return text;
}

export function requiredDate(value: unknown, fallback?: unknown) { return normalizeDateOnly(value ?? fallback); }
