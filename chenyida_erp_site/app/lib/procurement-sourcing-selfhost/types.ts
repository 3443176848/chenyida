import type { PoolClient } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";

export type SourcingMutationMeta = Readonly<{ actor: IdentityActor; requestId: string; operationId: string; keyDigest: string; requestDigest: string; method: string; route: string; action: string }>;
export type SourcingWorkResult = { status: number; body: Record<string, unknown>; objectId: number; oldVersion?: number; newVersion?: number };
export type SourcingMutationResult = SourcingWorkResult & { replayed: boolean };
export type SourcingWork = (client: PoolClient) => Promise<SourcingWorkResult>;
export type FaultInjector = (checkpoint: string) => void;
