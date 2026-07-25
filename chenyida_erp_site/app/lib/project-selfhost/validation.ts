import { createHash } from "node:crypto";
import { ProjectError } from "./errors.ts";
import type { RequirementInput, RequirementItemInput } from "./types.ts";

export const positiveId = (value: unknown, field: string) => { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new ProjectError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`); return result; };
export const expectedVersion = (value: unknown) => { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new ProjectError("REQUEST_VALIDATION_FAILED", "expected_version 必须是正整数"); return result; };
export const boundedText = (value: unknown, field: string, maximum: number, required = false) => { const result = String(value ?? "").normalize("NFKC").trim(); if ((required && !result) || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) throw new ProjectError("REQUEST_VALIDATION_FAILED", `${field} 无效`); return result; };
export const decimal = (value: unknown, field: string, optional = false): string | null => { if (optional && (value === null || value === undefined || value === "")) return null; const result = String(value ?? "").trim(); if (!/^(0|[1-9]\d{0,17})(\.\d{1,6})?$/.test(result) || /^0(?:\.0{1,6})?$/.test(result)) throw new ProjectError("REQUEST_VALIDATION_FAILED", `${field} 必须是最多六位小数的正数`); return result; };
export const optionalDate = (value: unknown): string | null => { if (value === null || value === undefined || value === "") return null; const result = String(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(new Date(`${result}T00:00:00Z`).getTime())) throw new ProjectError("REQUEST_VALIDATION_FAILED", "target_delivery_date 必须是有效日期"); return result; };
export const assertOnlyKeys = (input: Record<string, unknown>, allowed: readonly string[]) => { const unexpected = Object.keys(input).find((key) => !allowed.includes(key)); if (unexpected) throw new ProjectError("REQUEST_VALIDATION_FAILED", `请求正文包含未知字段：${unexpected}`); };

const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value;
export const canonicalDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

export function requirementInput(input: Record<string, unknown>): RequirementInput {
  assertOnlyKeys(input, ["customer_id", "expected_version", "project_name", "project_goal", "target_delivery_date", "customer_requirement_summary", "quantity_requirement", "quantity_unit", "delivery_requirement", "commercial_terms", "technical_requirements", "items"]);
  const rawItems = input.items;
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 100) throw new ProjectError("REQUEST_VALIDATION_FAILED", "items 必须包含 1 到 100 行");
  const items: RequirementItemInput[] = rawItems.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ProjectError("REQUEST_VALIDATION_FAILED", `第 ${index + 1} 行无效`);
    const row = raw as Record<string, unknown>; assertOnlyKeys(row, ["provisional_name", "quantity", "unit_id", "unit_pending", "specification_requirement"]); const unitPending = row.unit_pending === true;
    return { lineNo: index + 1, provisionalName: boundedText(row.provisional_name, `第 ${index + 1} 行暂定名称`, 200, true), quantity: decimal(row.quantity, `第 ${index + 1} 行数量`)! as string, unitId: unitPending ? null : positiveId(row.unit_id, `第 ${index + 1} 行 unit_id`), unitPending, specificationRequirement: boundedText(row.specification_requirement, `第 ${index + 1} 行规格要求`, 2000) };
  });
  const normalized = {
    projectName: boundedText(input.project_name, "项目名称", 200, true), projectGoal: boundedText(input.project_goal, "项目目标", 2000, true), targetDeliveryDate: optionalDate(input.target_delivery_date),
    customerRequirementSummary: boundedText(input.customer_requirement_summary, "客户需求摘要", 4000, true), quantityRequirement: decimal(input.quantity_requirement, "数量需求", true), quantityUnit: boundedText(input.quantity_unit, "数量单位", 40),
    deliveryRequirement: boundedText(input.delivery_requirement, "交付要求", 2000), commercialTerms: boundedText(input.commercial_terms, "商务条件", 2000), technicalRequirements: boundedText(input.technical_requirements, "技术要求", 4000), items,
  };
  return { ...normalized, contentDigest: canonicalDigest(normalized) };
}

export function safeDocumentInput(input: Record<string, unknown>) {
  assertOnlyKeys(input, ["file_id", "document_type", "display_name", "expected_version"]);
  const documentType = String(input.document_type || "").toUpperCase(); if (!new Set(["CUSTOMER_REQUIREMENT", "DRAWING", "SPECIFICATION", "REFERENCE"]).has(documentType)) throw new ProjectError("REQUEST_VALIDATION_FAILED", "document_type 无效");
  return { fileId: positiveId(input.file_id, "file_id"), documentType, displayName: boundedText(input.display_name, "display_name", 255, true), expectedVersion: expectedVersion(input.expected_version) };
}
