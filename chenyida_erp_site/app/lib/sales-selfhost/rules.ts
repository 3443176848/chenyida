import { SalesError } from "./errors.ts";
import type { DeliveryExecutionLineInput, DeliveryInstructionLineInput, SalesLineInput, ShipmentLineInput } from "./types.ts";

export const id = (value: unknown, field: string) => { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new SalesError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`); return result; };
export const version = (value: unknown, field = "expected_version") => { const result = Number(value); if (!Number.isSafeInteger(result) || result < 0) throw new SalesError("REQUEST_VALIDATION_FAILED", `${field} 必须是非负整数`); return result; };
export const text = (value: unknown, field: string, max: number, required = false) => { const result = String(value ?? "").normalize("NFKC").trim(); if ((required && !result) || result.length > max || /[\u0000-\u001f\u007f]/.test(result)) throw new SalesError("REQUEST_VALIDATION_FAILED", `${field} 无效`); return result; };
export const decimal = (value: unknown, field: string, positive = true) => { const raw = String(value ?? "").trim(); if (!/^(0|[1-9]\d{0,17})(\.\d{1,6})?$/.test(raw) || (positive && /^0(?:\.0{1,6})?$/.test(raw))) throw new SalesError("REQUEST_VALIDATION_FAILED", `${field} 必须是最多六位小数的${positive ? "正数" : "非负数"}`); return raw; };
export const currency = (value: unknown) => { const result = String(value ?? "CNY").trim().toUpperCase(); if (result !== "CNY") throw new SalesError("SALES_CURRENCY_NOT_SUPPORTED", "TASK07 仅支持 CNY，不能执行汇率换算", 422); return result; };
export function optionalDate(value: unknown, field: string): Date | null { if (value === null || value === undefined || value === "") return null; const result = new Date(String(value)); if (Number.isNaN(result.getTime())) throw new SalesError("REQUEST_VALIDATION_FAILED", `${field} 无效`); return result; }

export function salesLines(value: unknown): SalesLineInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new SalesError("REQUEST_VALIDATION_FAILED", "lines 必须包含 1 到 100 行");
  const materials = new Set<number>();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SalesError("REQUEST_VALIDATION_FAILED", `第 ${index + 1} 行无效`);
    const row = raw as Record<string, unknown>; const finishedMaterialId = id(row.finished_material_id, "finished_material_id");
    if (materials.has(finishedMaterialId)) throw new SalesError("REQUEST_VALIDATION_FAILED", "同一版本不能重复成品物料"); materials.add(finishedMaterialId);
    return { productId: id(row.product_id, "product_id"), productVersionId: id(row.product_version_id, "product_version_id"), finishedMaterialId, unitId: id(row.unit_id, "unit_id"), quantity: decimal(row.quantity ?? row.quote_qty ?? row.order_qty, "quantity"), unitPrice: decimal(row.unit_price, "unit_price"), remark: text(row.remark, "remark", 1000) };
  });
}

export function shipmentLines(value: unknown): ShipmentLineInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new SalesError("REQUEST_VALIDATION_FAILED", "lines 必须包含 1 到 100 行");
  const seen = new Set<number>();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SalesError("REQUEST_VALIDATION_FAILED", `第 ${index + 1} 行无效`);
    const row = raw as Record<string, unknown>; const salesOrderLineId = id(row.sales_order_line_id, "sales_order_line_id");
    if (seen.has(salesOrderLineId)) throw new SalesError("REQUEST_VALIDATION_FAILED", "同一出货单不能重复销售明细"); seen.add(salesOrderLineId);
    const inventoryLotId=row.inventory_lot_id === undefined || row.inventory_lot_id === null || row.inventory_lot_id === "" ? null : id(row.inventory_lot_id, "inventory_lot_id");
    return { salesOrderLineId, inventoryLotId, quantity: decimal(row.quantity ?? row.ship_qty, "quantity"), expectedLineVersion: version(row.expected_line_version, "expected_line_version"), expectedBalanceVersion: version(row.expected_balance_version, "expected_balance_version"), expectedLotVersion: inventoryLotId===null?null:version(row.expected_lot_version,"expected_lot_version") };
  }).sort((left, right) => left.salesOrderLineId - right.salesOrderLineId);
}

export function deliveryInstructionLines(value: unknown): DeliveryInstructionLineInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new SalesError("REQUEST_VALIDATION_FAILED", "lines 必须包含 1 到 100 行");
  const seen = new Set<number>();
  return value.map((raw, index) => { if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SalesError("REQUEST_VALIDATION_FAILED", `第 ${index + 1} 行无效`); const row = raw as Record<string, unknown>; const salesOrderLineId = id(row.sales_order_line_id, "sales_order_line_id"); if (seen.has(salesOrderLineId)) throw new SalesError("REQUEST_VALIDATION_FAILED", "同一发货指令不能重复销售明细"); seen.add(salesOrderLineId); return { salesOrderLineId, quantity: decimal(row.quantity, "quantity"), expectedLineVersion: version(row.expected_line_version, "expected_line_version") }; }).sort((a, b) => a.salesOrderLineId - b.salesOrderLineId);
}

export function deliveryExecutionLines(value: unknown): DeliveryExecutionLineInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new SalesError("REQUEST_VALIDATION_FAILED", "lines 必须包含 1 到 100 行");
  const seen = new Set<number>();
  return value.map((raw, index) => { if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SalesError("REQUEST_VALIDATION_FAILED", `第 ${index + 1} 行无效`); const row = raw as Record<string, unknown>; const instructionLineId = id(row.instruction_line_id, "instruction_line_id"); if (seen.has(instructionLineId)) throw new SalesError("REQUEST_VALIDATION_FAILED", "同一批次不能重复发货指令明细"); seen.add(instructionLineId); const inventoryLotId=row.inventory_lot_id === undefined || row.inventory_lot_id === null || row.inventory_lot_id === "" ? null : id(row.inventory_lot_id, "inventory_lot_id"); return { instructionLineId, inventoryLotId, quantity: decimal(row.quantity, "quantity"), expectedLineVersion: version(row.expected_line_version, "expected_line_version"), expectedSalesOrderLineVersion: version(row.expected_sales_order_line_version, "expected_sales_order_line_version"), expectedBalanceVersion: version(row.expected_balance_version, "expected_balance_version"), expectedLotVersion:inventoryLotId===null?null:version(row.expected_lot_version,"expected_lot_version") }; }).sort((a, b) => a.instructionLineId - b.instructionLineId);
}

export function expectedBalanceVersions(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new SalesError("REQUEST_VALIDATION_FAILED", "expected_balance_versions 必须包含 1 到 100 行");
  const seen = new Set<number>();
  return value.map((raw) => { if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SalesError("REQUEST_VALIDATION_FAILED", "expected_balance_versions 行无效"); const row = raw as Record<string, unknown>; const materialId = id(row.material_id, "material_id"); if (seen.has(materialId)) throw new SalesError("REQUEST_VALIDATION_FAILED", "expected_balance_versions 不能重复物料"); seen.add(materialId); return { materialId, expectedBalanceVersion: version(row.expected_balance_version, "expected_balance_version") }; }).sort((a, b) => a.materialId - b.materialId);
}

export function expectedLotVersions(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) throw new SalesError("REQUEST_VALIDATION_FAILED", "expected_lot_versions 必须是最多 100 行的数组");
  const seen = new Set<number>();
  return value.map((raw) => { if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SalesError("REQUEST_VALIDATION_FAILED", "expected_lot_versions 行无效"); const row = raw as Record<string, unknown>; const inventoryLotId = id(row.inventory_lot_id, "inventory_lot_id"); if (seen.has(inventoryLotId)) throw new SalesError("REQUEST_VALIDATION_FAILED", "expected_lot_versions 不能重复 Lot"); seen.add(inventoryLotId); return { inventoryLotId, expectedLotVersion: version(row.expected_lot_version, "expected_lot_version") }; }).sort((a, b) => a.inventoryLotId - b.inventoryLotId);
}
