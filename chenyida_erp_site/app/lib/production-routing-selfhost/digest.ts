import { createHash } from "node:crypto";

export type RoutingDigestOperation = Readonly<{ sequence_no: number; operation_code: string; operation_name: string; work_center_id: number; work_center_code: string; work_center_name: string; setup_minutes: string; run_minutes_per_unit: string; description: string; quality_gate_mode: "NONE" | "IPQC" }>;

export function routingDigest(input: Readonly<{ routing_code: string; product_id: number; product_version_id: number; version_no: number; version_code: string; operations: RoutingDigestOperation[] }>): string {
  const canonical = ["production-routing-v2", input.routing_code, input.product_id, input.product_version_id, input.version_no, input.version_code, input.operations.map((row) => [row.sequence_no, row.operation_code, row.operation_name, row.work_center_id, row.work_center_code, row.work_center_name, row.setup_minutes, row.run_minutes_per_unit, row.description, row.quality_gate_mode])];
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function legacyRoutingDigest(input: Readonly<{ routing_code: string; product_id: number; product_version_id: number; version_no: number; version_code: string; operations: RoutingDigestOperation[] }>): string {
  const canonical = ["production-routing-v1", input.routing_code, input.product_id, input.product_version_id, input.version_no, input.version_code, input.operations.map((row) => [row.sequence_no, row.operation_code, row.operation_name, row.work_center_id, row.work_center_code, row.work_center_name, row.setup_minutes, row.run_minutes_per_unit, row.description])];
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
