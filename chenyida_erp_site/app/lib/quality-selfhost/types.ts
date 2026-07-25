import type { PoolClient } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";

export type QualityMeta = Readonly<{ actor: IdentityActor; requestId: string; operationId: string; keyDigest: string; requestDigest: string; method: string; route: string; action: string }>;
export type QualityResult = { status: number; body: Record<string, unknown>; objectId?: number; replayed?: boolean };
export type QualityWork = (client: PoolClient) => Promise<QualityResult>;
export type ResultLineInput = Readonly<{ characteristic: string; result: "PASS" | "FAIL"; measuredValue: string; specification: string; remark: string }>;
export type DefectInput = Readonly<{ resultLineNo: number | null; defectType: string; severity: "MINOR" | "MAJOR" | "CRITICAL"; quantity: string; description: string }>;
