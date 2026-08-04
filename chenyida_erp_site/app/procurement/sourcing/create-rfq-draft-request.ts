export type StableOptionId = string | number;

export type SelectablePurchaseRequest = Readonly<{
  id: StableOptionId;
  version: number;
}>;

export type SelectableSupplier = Readonly<{
  id: StableOptionId;
}>;

export type CreateRfqDraftRequest = Readonly<{
  purchase_request_id: number;
  supplier_ids: number[];
  response_deadline: string;
  expected_version: number;
}>;

export class RfqDraftRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RfqDraftRequestError";
  }
}

function positiveDecimalFormId(value: unknown, field: string) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new RfqDraftRequestError(`${field} 必须是正整数`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new RfqDraftRequestError(`${field} 必须是正整数`);
  return parsed;
}

function stableOptionValue(value: StableOptionId, field: string) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 1) throw new RfqDraftRequestError(`${field} 不是有效稳定 ID`);
    return String(value);
  }
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new RfqDraftRequestError(`${field} 不是有效稳定 ID`);
  }
  return value;
}

function responseDeadline(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RfqDraftRequestError("response_deadline 必须是有效日期");
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RfqDraftRequestError("response_deadline 必须是有效日期");
  }
  return value;
}

export function buildCreateRfqDraftRequest(
  requests: readonly SelectablePurchaseRequest[],
  suppliers: readonly SelectableSupplier[],
  form: Readonly<{
    purchaseRequestId: unknown;
    supplierIds: readonly unknown[];
    responseDeadline: unknown;
  }>,
): CreateRfqDraftRequest {
  if (typeof form.purchaseRequestId !== "string") {
    throw new RfqDraftRequestError("purchase_request_id 必须是正整数");
  }
  const selectedRequest = requests.find(
    (request) => stableOptionValue(request.id, "purchase_request_id") === form.purchaseRequestId,
  );
  if (!selectedRequest) throw new RfqDraftRequestError("所选采购申请已失效，请刷新后重试");

  const purchaseRequestId = positiveDecimalFormId(form.purchaseRequestId, "purchase_request_id");
  if (!Number.isSafeInteger(selectedRequest.version) || selectedRequest.version < 1) {
    throw new RfqDraftRequestError("expected_version 必须是正整数");
  }

  const availableSupplierIds = new Set(
    suppliers.map((supplier) => stableOptionValue(supplier.id, "supplier_ids")),
  );
  const selectedSupplierIds = form.supplierIds.map((value) => {
    if (typeof value !== "string" || !availableSupplierIds.has(value)) {
      throw new RfqDraftRequestError("所选供应商已失效，请刷新后重试");
    }
    return positiveDecimalFormId(value, "supplier_ids");
  });
  const supplierIds = [...new Set(selectedSupplierIds)].sort((left, right) => left - right);
  if (!supplierIds.length) throw new RfqDraftRequestError("请至少选择一个 ACTIVE 供应商");

  return {
    purchase_request_id: purchaseRequestId,
    supplier_ids: supplierIds,
    response_deadline: responseDeadline(form.responseDeadline),
    expected_version: selectedRequest.version,
  };
}
