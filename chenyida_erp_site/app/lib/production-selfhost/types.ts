import type { PoolClient } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";

export type ProductionMeta = Readonly<{ actor: IdentityActor; requestId: string; operationId: string; keyDigest: string; requestDigest: string; method: string; route: string; action: string }>;
export type ProductionResult = { status: number; body: Record<string, unknown>; objectId?: number; replayed?: boolean };
export type ProductionWork = (client: PoolClient) => Promise<ProductionResult>;
export type RequirementLineInput = Readonly<{ requirementId: number; quantity: string; expectedRequirementVersion: number; expectedBalanceVersion: number }>;
export type CompletionAllocationInput = Readonly<{ reportId: number; quantity: string; expectedReportVersion: number }>;
