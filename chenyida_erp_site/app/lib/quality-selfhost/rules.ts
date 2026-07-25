import { QualityError } from "./errors.ts";
import type { DefectInput, ResultLineInput } from "./types.ts";

const DECIMAL = /^(0|[1-9]\d{0,17})(?:\.(\d{1,6}))?$/;
export function id(value: unknown, field: string): number { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new QualityError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`); return parsed; }
export function version(value: unknown): number { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new QualityError("REQUEST_VALIDATION_FAILED", "expected_version 必须是正整数"); return parsed; }
export function quantity(value: unknown, field: string, positive = true): string { const result = String(value ?? "").trim(); if (!DECIMAL.test(result) || (positive && /^0(?:\.0{1,6})?$/.test(result))) throw new QualityError("REQUEST_VALIDATION_FAILED", `${field} 必须是${positive ? "正" : "非负"}数且最多 6 位小数`); return result; }
export function zeroQuantity(value: string): boolean { return /^0(?:\.0{1,6})?$/.test(value); }
export function text(value: unknown, field: string, maximum: number, required = false): string { const result = String(value ?? "").trim(); if ((required && !result) || result.length > maximum) throw new QualityError("REQUEST_VALIDATION_FAILED", `${field}${required ? "不能为空且" : ""}不能超过 ${maximum} 个字符`); return result; }
export function optionalDate(value: unknown): Date | null { if (value === null || value === undefined || value === "") return null; const result = new Date(String(value)); if (Number.isNaN(result.getTime())) throw new QualityError("REQUEST_VALIDATION_FAILED", "inspection_date 无效"); return result; }
export function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): T { const result = String(value ?? "").trim().toUpperCase() as T; if (!allowed.includes(result)) throw new QualityError("REQUEST_VALIDATION_FAILED", `${field} 无效`); return result; }
export function resultLines(value: unknown): ResultLineInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new QualityError("REQUEST_VALIDATION_FAILED", "results 必须包含 1 到 100 行");
  return value.map((raw, index) => { if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new QualityError("REQUEST_VALIDATION_FAILED", `第 ${index + 1} 个检验结果无效`); const row = raw as Record<string, unknown>; return { characteristic: text(row.characteristic, "characteristic", 200, true), result: enumValue(row.result, "result", ["PASS", "FAIL"] as const), measuredValue: text(row.measured_value, "measured_value", 500), specification: text(row.specification, "specification", 500), remark: text(row.remark, "remark", 1000) }; });
}
export function defects(value: unknown, legacy: Record<string, unknown>): DefectInput[] {
  const source = Array.isArray(value) ? value : legacy.defect_type ? [{ defect_type: legacy.defect_type, severity: legacy.severity ?? "MAJOR", quantity: legacy.defect_qty ?? legacy.failed_qty, description: legacy.corrective_action ?? legacy.remark }] : [];
  if (source.length > 100) throw new QualityError("REQUEST_VALIDATION_FAILED", "defects 不能超过 100 行");
  return source.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new QualityError("REQUEST_VALIDATION_FAILED", `第 ${index + 1} 个缺陷无效`);
    const row = raw as Record<string, unknown>; const lineNo = row.result_line_no === null || row.result_line_no === undefined || row.result_line_no === "" ? null : id(row.result_line_no, "result_line_no");
    return { resultLineNo: lineNo, defectType: text(row.defect_type, "defect_type", 200, true), severity: enumValue(row.severity ?? "MAJOR", "severity", ["MINOR", "MAJOR", "CRITICAL"] as const), quantity: quantity(row.quantity ?? row.defect_qty, "defect quantity"), description: text(row.description ?? row.corrective_action, "description", 2000) };
  });
}
