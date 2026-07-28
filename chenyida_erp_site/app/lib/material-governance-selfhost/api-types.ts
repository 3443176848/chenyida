import type { MaterialActor } from "../material-selfhost/types.ts";

export type GovernanceActor = MaterialActor;

export type GovernanceMutationContext = Readonly<{
  actor: GovernanceActor;
  requestId: string;
  idempotencyKey: string;
  requestDigest: string;
  routeScope: string;
}>;

export type GovernancePage = Readonly<{
  afterId: number;
  limit: number;
}>;
