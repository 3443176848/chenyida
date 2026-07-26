import type { PoolClient } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";

export type SalesMeta = Readonly<{ actor: IdentityActor; requestId: string; operationId: string; keyDigest: string; requestDigest: string; method: string; route: string; action: string }>;
export type SalesResult = { status: number; body: Record<string, unknown>; objectId?: number; replayed?: boolean };
export type SalesWork = (client: PoolClient) => Promise<SalesResult>;
export type SalesLineInput = Readonly<{ productId: number; productVersionId: number; finishedMaterialId: number; unitId: number; quantity: string; unitPrice: string; remark: string }>;
export type ShipmentLineInput = Readonly<{ salesOrderLineId: number; quantity: string; expectedLineVersion: number; expectedBalanceVersion: number }>;
export type DeliveryInstructionLineInput = Readonly<{ salesOrderLineId: number; quantity: string; expectedLineVersion: number }>;
export type DeliveryExecutionLineInput = Readonly<{ instructionLineId: number; quantity: string; expectedLineVersion: number; expectedSalesOrderLineVersion: number; expectedBalanceVersion: number }>;
