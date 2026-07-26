import { ProductionError } from "./errors.ts";

const DECIMAL = /^(0|[1-9]\d{0,17})(?:\.(\d{1,6}))?$/;
export function id(value: unknown, field: string): number { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new ProductionError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`); return parsed; }
export function version(value: unknown, field = "expected_version"): number { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 0) throw new ProductionError("REQUEST_VALIDATION_FAILED", `${field} 必须是非负整数`); return parsed; }
export function quantity(value: unknown, field: string): string { const text = String(value ?? "").trim(); if (!DECIMAL.test(text) || /^0(?:\.0{1,6})?$/.test(text)) throw new ProductionError("REQUEST_VALIDATION_FAILED", `${field} 必须是正数且最多 6 位小数`); return text; }
export function nonNegativeQuantity(value: unknown, field: string): string { const text = String(value ?? "").trim(); if (!DECIMAL.test(text)) throw new ProductionError("REQUEST_VALIDATION_FAILED", `${field} 必须是非负数且最多 6 位小数`); return text; }
export function text(value: unknown, field: string, maximum: number, required = false): string { const result = String(value ?? "").trim(); if ((required && !result) || result.length > maximum) throw new ProductionError("REQUEST_VALIDATION_FAILED", `${field} ${required ? "不能为空且" : ""}不能超过 ${maximum} 个字符`); return result; }
export function optionalDate(value: unknown, field: string): Date | null { if (value === null || value === undefined || value === "") return null; const result = new Date(String(value)); if (Number.isNaN(result.getTime())) throw new ProductionError("REQUEST_VALIDATION_FAILED", `${field} 无效`); return result; }
export function requirementLines(value: unknown): Array<{ requirementId: number; quantity: string; expectedRequirementVersion: number; expectedBalanceVersion: number }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new ProductionError("REQUEST_VALIDATION_FAILED", "lines 必须包含 1 到 100 行");
  const seen = new Set<number>();
  return value.map((raw, index) => { if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ProductionError("REQUEST_VALIDATION_FAILED", `第 ${index + 1} 行无效`); const row = raw as Record<string, unknown>; const requirementId = id(row.requirement_id, "requirement_id"); if (seen.has(requirementId)) throw new ProductionError("REQUEST_VALIDATION_FAILED", "同一请求不能重复物料需求"); seen.add(requirementId); return { requirementId, quantity: quantity(row.quantity, "quantity"), expectedRequirementVersion: version(row.expected_requirement_version, "expected_requirement_version"), expectedBalanceVersion: version(row.expected_balance_version, "expected_balance_version") }; }).sort((a, b) => a.requirementId - b.requirementId);
}

export function completionAllocations(value: unknown): Array<{ reportId: number; quantity: string; expectedReportVersion: number }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new ProductionError("REQUEST_VALIDATION_FAILED", "allocations 必须包含 1 到 100 条报工来源");
  const seen = new Set<number>();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ProductionError("REQUEST_VALIDATION_FAILED", `第 ${index + 1} 条报工分配无效`);
    const row = raw as Record<string, unknown>; const reportId = id(row.report_id, "report_id");
    if (seen.has(reportId)) throw new ProductionError("REQUEST_VALIDATION_FAILED", "同一完工请求不能重复报工来源"); seen.add(reportId);
    return { reportId, quantity: quantity(row.quantity, "allocation.quantity"), expectedReportVersion: version(row.expected_report_version, "expected_report_version") };
  }).sort((a, b) => a.reportId - b.reportId);
}
