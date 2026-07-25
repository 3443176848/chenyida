import type { PoolClient } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";

export type PlanningMutationMeta = Readonly<{ actor: IdentityActor; requestId: string; operationId: string; keyDigest: string; requestDigest: string; method: string; route: string; action: string }>;
export type PlanningMutationWorkResult = Readonly<{ status: number; body: Record<string, unknown>; objectId: number; oldVersion?: number; newVersion?: number }>;
export type PlanningMutationResult = PlanningMutationWorkResult & Readonly<{ replayed: boolean }>;
export type PlanningMutationWork = (client: PoolClient) => Promise<PlanningMutationWorkResult>;
export type ResolutionInput = Readonly<{ requirementItemId: number; productId: number; productVersionId: number; bomHeaderId: number; bomVersionId: number }>;
