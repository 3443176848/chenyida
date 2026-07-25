import type { PoolClient } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";

export type FinanceMeta = Readonly<{ actor: IdentityActor; requestId: string; operationId: string; keyDigest: string; requestDigest: string; method: string; route: string; action: string }>;
export type FinanceResult = { status: number; body: Record<string, unknown>; objectId?: number; replayed?: boolean };
export type FinanceWork = (client: PoolClient) => Promise<FinanceResult>;
export type FinanceDocumentType = "AR" | "AP";
