import type { PoolClient } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";

export type RequirementMutationMeta = Readonly<{ actor: IdentityActor; requestId: string; operationId: string; keyDigest: string; requestDigest: string; method: string; route: string; action: string }>;
export type RequirementWorkResult = Readonly<{ status: number; body: Record<string, unknown>; objectId: number; oldVersion?: number; newVersion?: number }>;
export type RequirementMutationResult = RequirementWorkResult & Readonly<{ replayed: boolean }>;
export type RequirementWork = (client: PoolClient) => Promise<RequirementWorkResult>;

export type InboundAllocation = Readonly<{ purchaseOrderLineId: number; sourceVersion: number; sourceQuantity: string; quantity: string; sourceDigest: string }>;
export type RequirementCalculationLine = Readonly<{
  lineNo: number; materialId: number; unitId: number; materialSnapshot: Record<string, unknown>; materialDigest: string;
  grossRequirement: string; stockAvailable: string; eligibleInbound: string; stockAllocated: string; inboundAllocated: string; netPurchaseRequirement: string;
  sourceDigest: string; stockSource: null | Readonly<{ inventoryBalanceId: number; sourceVersion: number; sourceQuantity: string; sourceDigest: string }>; inboundSources: InboundAllocation[];
}>;
export type RequirementCalculation = Readonly<{ digest: string; lines: RequirementCalculationLine[] }>;
