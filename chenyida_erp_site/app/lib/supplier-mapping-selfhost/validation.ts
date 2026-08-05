import { createHash } from "node:crypto";
import { SupplierMappingError } from "./errors.ts";
import type { SupplierMappingDraftInput } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function canonicalDigest(value: unknown): string {
  const normalize = (input: unknown): unknown => Array.isArray(input)
    ? input.map(normalize)
    : input && typeof input === "object"
      ? Object.fromEntries(Object.entries(input as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]))
      : input;
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}

export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const extra = Object.keys(value).find((key) => !keys.includes(key));
  if (extra) throw new SupplierMappingError("REQUEST_VALIDATION_FAILED", `请求正文包含不支持的字段：${extra}`);
}

export function positiveId(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^[1-9]\d*$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new SupplierMappingError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`);
  return parsed;
}

export function expectedVersion(value: unknown): number {
  return positiveId(value, "expected_version");
}

export function mappingUid(value: unknown): string {
  const parsed = String(value ?? "").toLowerCase();
  if (!UUID.test(parsed)) throw new SupplierMappingError("REQUEST_VALIDATION_FAILED", "mapping_id 必须是有效稳定 UUID");
  return parsed;
}

export function boundedText(value: unknown, field: string, maximum: number, required = false): string {
  const parsed = String(value ?? "").normalize("NFKC").trim();
  if ((required && !parsed) || parsed.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(parsed)) {
    throw new SupplierMappingError("REQUEST_VALIDATION_FAILED", `${field} 长度或字符无效`);
  }
  return parsed;
}

export function boundedExactText(value: unknown, field: string, maximum: number, required = false): string {
  const parsed = String(value ?? "").trim();
  if ((required && !parsed) || parsed.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(parsed)) {
    throw new SupplierMappingError("REQUEST_VALIDATION_FAILED", `${field} 长度或字符无效`);
  }
  return parsed;
}

function dateOnly(value: unknown, field: string, optional = false): string | null {
  if (optional && (value === null || value === undefined || value === "")) return null;
  const parsed = String(value ?? "").trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(parsed) ? new Date(`${parsed}T00:00:00Z`) : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== parsed) {
    throw new SupplierMappingError("REQUEST_VALIDATION_FAILED", `${field} 必须是有效的 YYYY-MM-DD 日期`);
  }
  return parsed;
}

function controlledInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000_000_000) {
    throw new SupplierMappingError("REQUEST_VALIDATION_FAILED", `${field} 必须是 1—1000000000 的整数`);
  }
  return parsed;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left; let b = right;
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

export const DRAFT_KEYS = [
  "supplier_id", "material_id", "supplier_item_code", "supplier_item_name", "supplier_specification",
  "manufacturer", "mpn", "revision", "purchase_unit_id", "conversion_numerator",
  "conversion_denominator", "valid_from", "valid_to",
] as const;

export function parseDraftInput(input: Record<string, unknown>): SupplierMappingDraftInput {
  exactKeys(input, DRAFT_KEYS);
  const numerator = controlledInteger(input.conversion_numerator ?? 1, "conversion_numerator");
  const denominator = controlledInteger(input.conversion_denominator ?? 1, "conversion_denominator");
  const divisor = greatestCommonDivisor(numerator, denominator);
  const validFrom = dateOnly(input.valid_from, "valid_from")!;
  const validTo = dateOnly(input.valid_to, "valid_to", true);
  if (validTo && validTo <= validFrom) {
    throw new SupplierMappingError("REQUEST_VALIDATION_FAILED", "valid_to 必须晚于 valid_from");
  }
  const supplierItemCode = boundedText(input.supplier_item_code, "supplier_part_number", 160, true);
  return {
    supplierId: positiveId(input.supplier_id, "supplier_id"),
    materialId: positiveId(input.material_id, "material_id"),
    supplierItemCode,
    normalizedSupplierItemCode: supplierItemCode.replace(/\s+/g, " ").toUpperCase(),
    supplierItemName: boundedText(input.supplier_item_name, "supplier_item_name", 200),
    supplierSpecification: boundedText(input.supplier_specification, "supplier_specification", 1000),
    manufacturer: boundedText(input.manufacturer, "manufacturer", 160),
    mpn: boundedText(input.mpn, "mpn", 160),
    revision: boundedText(input.revision, "revision", 80),
    purchaseUnitId: positiveId(input.purchase_unit_id, "purchase_unit_id"),
    conversionNumerator: numerator / divisor,
    conversionDenominator: denominator / divisor,
    validFrom,
    validTo,
  };
}

export function shanghaiBoundary(value: string): string {
  return `${value}T00:00:00+08:00`;
}
