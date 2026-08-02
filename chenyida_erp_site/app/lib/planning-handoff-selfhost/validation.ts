import { createHash } from "node:crypto";
import { PlanningHandoffError } from "./errors.ts";
import type { ResolutionInput, RevisionResponseInput, SuccessorPackageInput, UnitResolutionInput } from "./types.ts";

export const stableValue = (value: unknown): unknown => Array.isArray(value) ? value.map(stableValue) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stableValue(child)])) : value;
export const canonicalDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
export function positiveId(value: unknown, field: string): number { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new PlanningHandoffError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`); return result; }
export function expectedVersion(value: unknown): number { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new PlanningHandoffError("EXPECTED_VERSION_REQUIRED", "expected_version 必须是正整数"); return result; }
export function boundedText(value: unknown, field: string, maximum: number, required = false): string { const result = String(value ?? "").normalize("NFKC").trim(); if ((required && !result) || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) throw new PlanningHandoffError("REQUEST_VALIDATION_FAILED", `${field} 无效`); return result; }
export function optionalDate(value: unknown): string | null { if (value === undefined || value === null || value === "") return null; const text = String(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) throw new PlanningHandoffError("REQUEST_VALIDATION_FAILED", "target_delivery_date 无效"); return text; }
export function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) { const set = new Set(allowed); const unknown = Object.keys(value).find((key) => !set.has(key)); if (unknown) throw new PlanningHandoffError("REQUEST_VALIDATION_FAILED", `请求正文包含未知字段：${unknown}`); }
export function resolutionInput(value: Record<string, unknown>): { expected: number; rows: ResolutionInput[] } {
  assertOnlyKeys(value, ["expected_version", "resolutions"]); const expected = expectedVersion(value.expected_version);
  if (!Array.isArray(value.resolutions) || value.resolutions.length < 1 || value.resolutions.length > 200) throw new PlanningHandoffError("REQUEST_VALIDATION_FAILED", "resolutions 必须包含 1 至 200 条解析");
  const seen = new Set<number>(); const rows = value.resolutions.map((raw, index) => { if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PlanningHandoffError("REQUEST_VALIDATION_FAILED", `resolutions[${index}] 无效`); const row = raw as Record<string, unknown>; assertOnlyKeys(row, ["requirement_item_id", "product_id", "product_version_id", "bom_header_id", "bom_version_id"]); const result = { requirementItemId: positiveId(row.requirement_item_id, "requirement_item_id"), productId: positiveId(row.product_id, "product_id"), productVersionId: positiveId(row.product_version_id, "product_version_id"), bomHeaderId: positiveId(row.bom_header_id, "bom_header_id"), bomVersionId: positiveId(row.bom_version_id, "bom_version_id") }; if (seen.has(result.requirementItemId)) throw new PlanningHandoffError("REQUEST_VALIDATION_FAILED", "同一需求明细不能重复解析"); seen.add(result.requirementItemId); return result; });
  return { expected, rows };
}

export function unitResolutionInput(value: Record<string, unknown>): UnitResolutionInput {
  assertOnlyKeys(value, ["requirement_item_id", "unit_id", "expected_head_version"]);
  const requirementItemId = positiveId(value.requirement_item_id, "requirement_item_id");
  if (value.unit_id === null || value.unit_id === undefined || value.unit_id === "") {
    throw new PlanningHandoffError("REQUIREMENT_UNIT_UNRESOLVED", "请明确选择该需求明细的有效单位后重试", 422);
  }
  const unitId = Number(value.unit_id);
  if (!Number.isSafeInteger(unitId) || unitId < 1) {
    throw new PlanningHandoffError("REQUIREMENT_UNIT_INVALID", "所选单位标识无效，请刷新单位列表后重试", 422);
  }
  const expectedHeadVersion = Number(value.expected_head_version);
  if (!Number.isSafeInteger(expectedHeadVersion) || expectedHeadVersion < 0) {
    throw new PlanningHandoffError("REQUEST_VALIDATION_FAILED", "expected_head_version 必须是大于等于 0 的整数");
  }
  return { requirementItemId, unitId, expectedHeadVersion };
}

export function normalizeRevisionResponseText(value: unknown): string {
  if (typeof value !== "string") throw new PlanningHandoffError("REVISION_RESPONSE_REQUIRED", "请填写工程修订回复后再保存", 422);
  const responseText = value.replace(/\r\n?/g, "\n").normalize("NFC").trim();
  if (!responseText) throw new PlanningHandoffError("REVISION_RESPONSE_REQUIRED", "请填写工程修订回复后再保存", 422);
  const length = [...responseText].length;
  if (length < 10 || length > 2000 || /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/.test(responseText)) {
    throw new PlanningHandoffError("REVISION_RESPONSE_INVALID", "工程修订回复须为 10 至 2000 个字符，可使用规范换行但不能包含控制字符", 422);
  }
  return responseText;
}

export function revisionResponseInput(value: Record<string, unknown>): RevisionResponseInput {
  assertOnlyKeys(value, ["expected_head_version", "response_text"]);
  const expectedHeadVersion = Number(value.expected_head_version);
  if (!Number.isSafeInteger(expectedHeadVersion) || expectedHeadVersion < 0) {
    throw new PlanningHandoffError("REVISION_VERSION_CONFLICT", "工程修订回复版本无效，请刷新后重试", 409);
  }
  const responseText = normalizeRevisionResponseText(value.response_text);
  return { expectedHeadVersion, responseText, responseTextDigest: createHash("sha256").update(responseText, "utf8").digest("hex") };
}

export function successorPackageInput(value: Record<string, unknown>): SuccessorPackageInput {
  assertOnlyKeys(value, ["expected_package_version", "expected_response_head_version", "revision_response_version_id"]);
  return {
    expectedPackageVersion: expectedVersion(value.expected_package_version),
    expectedResponseHeadVersion: expectedVersion(value.expected_response_head_version),
    revisionResponseVersionId: positiveId(value.revision_response_version_id, "revision_response_version_id"),
  };
}
