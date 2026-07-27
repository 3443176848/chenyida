import { InventoryError } from "./errors.ts";
import { INVENTORY_OPERATION_TYPES, type InventoryLineInput, type InventoryOperationType } from "./types.ts";

const MAX_MICROS = 999_999_999_999_999_999_999_999n;
const OPERATION_SET = new Set<string>(INVENTORY_OPERATION_TYPES);

export function parseInventoryText(value: unknown, field: string, maximum: number, required = false): string {
  const result = String(value ?? "").normalize("NFKC").trim();
  if ((required && !result) || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) throw new InventoryError("REQUEST_VALIDATION_FAILED", `${field} 无效`);
  return result;
}

export function parseInventoryId(value: unknown, field: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new InventoryError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`);
  return result;
}

export function parseExpectedVersion(value: unknown): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new InventoryError("REQUEST_VALIDATION_FAILED", "expected_balance_version 必须是非负整数");
  return result;
}

export function parseQuantityMicros(value: unknown, field: string, allowZero: boolean): bigint {
  const raw = String(value ?? "").trim();
  if (!/^(0|[1-9]\d{0,17})(\.\d{1,6})?$/.test(raw)) throw new InventoryError("REQUEST_VALIDATION_FAILED", `${field} 必须是最多 6 位小数的非负数`);
  const [whole, fraction = ""] = raw.split(".");
  const result = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if ((!allowZero && result === 0n) || result > MAX_MICROS) throw new InventoryError("REQUEST_VALIDATION_FAILED", `${field} 超出允许范围`);
  return result;
}

export function formatQuantity(micros: bigint): string {
  const negative = micros < 0n;
  const absolute = negative ? -micros : micros;
  return `${negative ? "-" : ""}${absolute / 1_000_000n}.${String(absolute % 1_000_000n).padStart(6, "0")}`;
}

export function parseDatabaseQuantity(value: unknown): bigint {
  const raw = String(value ?? "0");
  const negative = raw.startsWith("-");
  const result = parseQuantityMicros(negative ? raw.slice(1) : raw, "数据库数量", true);
  return negative ? -result : result;
}

export function parseOperationInput(input: Record<string, unknown>): { operationType: InventoryOperationType; reason: string; lines: InventoryLineInput[] } {
  const operationType = String(input.operation_type ?? "ADJUSTMENT").toUpperCase();
  if (!OPERATION_SET.has(operationType)) throw new InventoryError("REQUEST_VALIDATION_FAILED", "operation_type 无效");
  const reason = parseInventoryText(input.reason, "原因", 1000, true);
  const rawLines = Array.isArray(input.lines) ? input.lines : [input];
  if (rawLines.length < 1 || rawLines.length > 100) throw new InventoryError("REQUEST_VALIDATION_FAILED", "库存操作必须包含 1 到 100 行");
  const seen = new Set<number>();
  const lines = rawLines.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new InventoryError("REQUEST_VALIDATION_FAILED", `第 ${index + 1} 行无效`);
    const row = raw as Record<string, unknown>;
    if (row.location_code !== undefined && row.location_code !== "MAIN") throw new InventoryError("INVENTORY_LOCATION_NOT_SUPPORTED", "当前版本只支持 MAIN 库位", 422);
    if (row.lot_code !== undefined && row.lot_code !== "") throw new InventoryError("INVENTORY_LOT_NOT_SUPPORTED", "当前版本不支持批次库存", 422);
    const materialId = parseInventoryId(row.material_id, "material_id");
    if (seen.has(materialId)) throw new InventoryError("REQUEST_VALIDATION_FAILED", "同一库存操作不能重复物料");
    seen.add(materialId);
    const isAdjustment = operationType === "ADJUSTMENT";
    const quantity = isAdjustment ? null : parseQuantityMicros(row.quantity, "quantity", false);
    const counted = isAdjustment ? parseQuantityMicros(row.counted_qty, "counted_qty", true) : null;
    return { materialId, unitId: parseInventoryId(row.unit_id, "unit_id"), inventoryLotId: null, lotCode: "", expectedBalanceVersion: parseExpectedVersion(row.expected_balance_version), quantityMicros: quantity, countedMicros: counted };
  });
  return { operationType: operationType as InventoryOperationType, reason, lines: lines.sort((left, right) => left.materialId - right.materialId) };
}

export function parseReversalVersions(input: Record<string, unknown>): { reason: string; versions: Map<number, number> } {
  const reason = parseInventoryText(input.reason, "冲销原因", 1000, true);
  if (!Array.isArray(input.expected_balance_versions) || input.expected_balance_versions.length < 1 || input.expected_balance_versions.length > 100) throw new InventoryError("REQUEST_VALIDATION_FAILED", "冲销必须提供 expected_balance_versions");
  const versions = new Map<number, number>();
  for (const raw of input.expected_balance_versions) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new InventoryError("REQUEST_VALIDATION_FAILED", "expected_balance_versions 行无效");
    const row = raw as Record<string, unknown>; const materialId = parseInventoryId(row.material_id, "material_id");
    if (versions.has(materialId)) throw new InventoryError("REQUEST_VALIDATION_FAILED", "expected_balance_versions 不能重复物料");
    versions.set(materialId, parseExpectedVersion(row.expected_balance_version));
  }
  return { reason, versions };
}
