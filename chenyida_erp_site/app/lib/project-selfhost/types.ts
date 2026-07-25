import type { PoolClient } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";

export type ProjectStatus = "DRAFT" | "SUBMITTED" | "RETURNED" | "ACCEPTED";
export type ProjectMutationMeta = Readonly<{ actor: IdentityActor; requestId: string; operationId: string; keyDigest: string; requestDigest: string; method: string; route: string; action: string }>;
export type ProjectMutationResult = Readonly<{ status: number; body: Record<string, unknown>; objectId: number; oldVersion?: number; newVersion?: number; replayed?: boolean }>;
export type ProjectMutationWork = (client: PoolClient) => Promise<ProjectMutationResult>;
export type RequirementItemInput = Readonly<{ lineNo: number; provisionalName: string; quantity: string; unitId: number | null; unitPending: boolean; specificationRequirement: string }>;
export type RequirementInput = Readonly<{ projectName: string; projectGoal: string; targetDeliveryDate: string | null; customerRequirementSummary: string; quantityRequirement: string | null; quantityUnit: string; deliveryRequirement: string; commercialTerms: string; technicalRequirements: string; items: RequirementItemInput[]; contentDigest: string }>;
