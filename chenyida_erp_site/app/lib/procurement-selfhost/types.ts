import type { PoolClient } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
export type ProcurementMeta = { actor: IdentityActor; requestId: string; operationId: string; keyDigest: string; requestDigest: string; method: string; route: string; action: string };
export type ProcurementResult = { status: number; body: Record<string, unknown>; objectId?: number; replayed?: boolean };
export type ProcurementWork = (client: PoolClient) => Promise<ProcurementResult>;
export type PurchaseOrderLineInput = Readonly<{ materialId: number; unitId: number; supplierMappingId: number; orderQty: string; unitPrice: string; remark: string }>;
export type ReceiptLineInput = Readonly<{ purchaseOrderLineId: number; quantity: string; expectedLineVersion: number; expectedBalanceVersion: number }>;
