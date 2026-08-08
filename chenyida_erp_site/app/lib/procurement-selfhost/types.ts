import type { PoolClient } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
export type ProcurementMeta = { actor: IdentityActor; requestId: string; operationId: string; keyDigest: string; requestDigest: string; method: string; route: string; action: string };
export type ProcurementResult = { status: number; body: Record<string, unknown>; objectId?: number; replayed?: boolean };
export type ProcurementWork = (client: PoolClient) => Promise<ProcurementResult>;
export type DatabaseId = string | number;
export type PurchaseOrderLineInput = Readonly<{ materialId: DatabaseId; unitId: DatabaseId; supplierMappingId: DatabaseId; orderQty: string; unitPrice: string; remark: string }>;
export type ReceiptLineInput = Readonly<{ purchaseOrderLineId: number; quantity: string; expectedLineVersion: number; expectedBalanceVersion: number; supplierLotCode: string | null }>;
