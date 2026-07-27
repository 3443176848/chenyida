import { ProcurementError } from "./errors.ts";
export const id = (value: unknown, field: string) => { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new ProcurementError("REQUEST_VALIDATION_FAILED", `${field} 必须是正整数`); return result; };
export const version = (value: unknown, field = "expected_version") => { const result = Number(value); if (!Number.isSafeInteger(result) || result < 0) throw new ProcurementError("REQUEST_VALIDATION_FAILED", `${field} 必须是非负整数`); return result; };
export const text = (value: unknown, field: string, max: number, required = false) => { const result = String(value ?? "").normalize("NFKC").trim(); if ((required && !result) || result.length > max || /[\u0000-\u001f\u007f]/.test(result)) throw new ProcurementError("REQUEST_VALIDATION_FAILED", `${field} 无效`); return result; };
export const supplierLotCode = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  const result = String(value).normalize("NFKC").trim().toUpperCase();
  if (!result) throw new ProcurementError("SUPPLIER_LOT_CODE_REQUIRED", "IQC 管理物料收货必须填写供应商 Lot", 400);
  if (result.length > 64) throw new ProcurementError("SUPPLIER_LOT_CODE_TOO_LONG", "供应商 Lot 不能超过 64 个字符", 400);
  if (!/^[A-Z0-9][A-Z0-9._/-]*$/.test(result)) throw new ProcurementError("SUPPLIER_LOT_CODE_INVALID", "供应商 Lot 只能包含大写字母、数字、点、下划线、斜杠或连字符", 400);
  return result;
};
export const quantity = (value: unknown, field: string, positive = true) => { const raw = String(value ?? "").trim(); if (!/^(0|[1-9]\d{0,17})(\.\d{1,6})?$/.test(raw) || (positive && /^0(?:\.0{1,6})?$/.test(raw))) throw new ProcurementError("REQUEST_VALIDATION_FAILED", `${field} 必须是最多六位小数的${positive ? "正数" : "非负数"}`); return raw; };
export const currency = (value: unknown) => { const result = String(value ?? "").trim().toUpperCase(); if (!/^[A-Z]{3}$/.test(result)) throw new ProcurementError("REQUEST_VALIDATION_FAILED", "currency_code 必须是三位大写代码"); return result; };
export function lines(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new ProcurementError("REQUEST_VALIDATION_FAILED", "lines 必须包含 1 到 100 行");
  const materials = new Set<number>();
  return value.map((raw, index) => { if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ProcurementError("REQUEST_VALIDATION_FAILED", `第 ${index + 1} 行无效`); const row = raw as Record<string, unknown>; const materialId = id(row.material_id, "material_id"); if (materials.has(materialId)) throw new ProcurementError("REQUEST_VALIDATION_FAILED", "同一采购单不能重复物料"); materials.add(materialId); return { materialId, unitId: id(row.unit_id, "unit_id"), supplierMappingId: id(row.supplier_mapping_id, "supplier_mapping_id"), orderQty: quantity(row.order_qty, "order_qty"), unitPrice: quantity(row.unit_price, "unit_price"), remark: text(row.remark, "remark", 1000) }; });
}

export function receiptLines(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new ProcurementError("REQUEST_VALIDATION_FAILED", "lines 必须包含 1 到 100 行");
  const seen = new Set<number>();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ProcurementError("REQUEST_VALIDATION_FAILED", `第 ${index + 1} 行无效`);
    const row = raw as Record<string, unknown>; const purchaseOrderLineId = id(row.purchase_order_line_id ?? row.line_id, "purchase_order_line_id");
    if (seen.has(purchaseOrderLineId)) throw new ProcurementError("REQUEST_VALIDATION_FAILED", "同一收货单不能重复采购明细"); seen.add(purchaseOrderLineId);
    return { purchaseOrderLineId, quantity: quantity(row.quantity ?? row.receive_qty, "quantity"), expectedLineVersion: version(row.expected_line_version, "expected_line_version"), expectedBalanceVersion: version(row.expected_balance_version, "expected_balance_version"), supplierLotCode: supplierLotCode(row.supplier_lot_code) };
  }).sort((left, right) => left.purchaseOrderLineId - right.purchaseOrderLineId);
}

export function expectedBalanceVersions(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new ProcurementError("REQUEST_VALIDATION_FAILED", "expected_balance_versions 必须包含 1 到 100 行");
  const seen = new Set<number>();
  return value.map((raw) => { if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ProcurementError("REQUEST_VALIDATION_FAILED", "expected_balance_versions 行无效"); const row = raw as Record<string, unknown>; const materialId = id(row.material_id, "material_id"); if (seen.has(materialId)) throw new ProcurementError("REQUEST_VALIDATION_FAILED", "expected_balance_versions 不能重复物料"); seen.add(materialId); return { materialId, expectedBalanceVersion: version(row.expected_balance_version, "expected_balance_version") }; }).sort((left, right) => left.materialId - right.materialId);
}

export function optionalDate(value: unknown, field: string): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const result = new Date(String(value)); if (Number.isNaN(result.getTime())) throw new ProcurementError("REQUEST_VALIDATION_FAILED", `${field} 无效`); return result;
}
