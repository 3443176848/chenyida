import type { PoolClient } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";

export type MasterActor = IdentityActor;
export type MutationMeta = Readonly<{ actor: MasterActor; requestId: string; operationId: string; keyDigest: string; requestDigest: string; method: string; route: string; action: string }>;
export type MutationResult = Readonly<{ status: number; body: Record<string, unknown>; replayed: boolean }>;
export type MutationWork = (client: PoolClient) => Promise<Readonly<{ status: number; body: Record<string, unknown>; targetType: string; targetId: number; oldVersion?: number; newVersion?: number }>>;
