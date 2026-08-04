import type { PoolClient } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";

export type SupplierMappingMutationMeta = Readonly<{
  actor: IdentityActor;
  requestId: string;
  operationId: string;
  keyDigest: string;
  requestDigest: string;
  method: string;
  route: string;
  action: string;
}>;

export type SupplierMappingWorkResult = {
  status: number;
  body: Record<string, unknown>;
  mappingUid: string;
  mappingVersionId: number;
  oldVersion?: number;
  newVersion?: number;
  safeDetail?: Record<string, unknown>;
};

export type SupplierMappingMutationResult = SupplierMappingWorkResult & { replayed: boolean };
export type SupplierMappingWork = (client: PoolClient) => Promise<SupplierMappingWorkResult>;
export type SupplierMappingFaultInjector = (checkpoint: string) => void;

export type SupplierMappingDraftInput = Readonly<{
  supplierId: number;
  materialId: number;
  supplierItemCode: string;
  normalizedSupplierItemCode: string;
  supplierItemName: string;
  supplierSpecification: string;
  manufacturer: string;
  mpn: string;
  revision: string;
  purchaseUnitId: number;
  conversionNumerator: number;
  conversionDenominator: number;
  validFrom: string;
  validTo: string | null;
}>;
