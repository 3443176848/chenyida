import type { PoolClient } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";

export const INVENTORY_OPERATION_TYPES = ["RECEIPT", "IQC_RECEIPT", "ISSUE", "ADJUSTMENT", "FREEZE", "UNFREEZE"] as const;
export type InventoryOperationType = (typeof INVENTORY_OPERATION_TYPES)[number];

export type InventoryLineInput = Readonly<{
  materialId: number;
  unitId: number;
  inventoryLotId: number | null;
  lotCode: string;
  expectedBalanceVersion: number;
  quantityMicros: bigint | null;
  countedMicros: bigint | null;
}>;

export type InventoryMutationMeta = Readonly<{
  actor: IdentityActor;
  requestId: string;
  operationId: string;
  keyDigest: string;
  requestDigest: string;
  method: string;
  route: string;
  action: string;
}>;

export type InventoryMutationResult = {
  status: number;
  body: Record<string, unknown>;
  replayed?: boolean;
  adjustmentId?: number;
  materialIds?: number[];
  inventoryLotIds?: number[];
};

export type InventoryMutationWork = (client: PoolClient) => Promise<InventoryMutationResult>;
