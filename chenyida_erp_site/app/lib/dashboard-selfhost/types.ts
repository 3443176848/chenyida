import type { IdentityActor } from "../identity-selfhost/types.ts";

export type DashboardActor = Pick<IdentityActor,"username"|"role"|"permissions">;
export type DashboardDomain = "material"|"partners"|"engineering"|"inventory"|"procurement"|"production"|"sales"|"quality"|"finance"|"operations";
export type DecimalSummary = Readonly<{unit:string;on_hand:string;available:string;frozen:string}>;
export type SafeBusinessEvent = Readonly<{domain:string;action:string;object_code:string;actor:string;request_id:string;created_at:string}>;
export type SafeAuditEvent = Readonly<{action:string;result:string;username:string;route_code:string;request_id:string;created_at:string}>;
export type MigrationStatus = Readonly<{version:string;checksum:string;applied_at:string}>;
export type DashboardSnapshot = Readonly<{
  active_materials:number;total_mappings:number;pending_materials:number;auto_count:number;suspect_count:number;new_count:number;active_customers:number;active_suppliers:number;released_products:number;valid_boms:number;
  inventory_material_kinds:number;inventory_zero_available_kinds:number;inventory_quantities:DecimalSummary[];
  total_purchase_orders:number;open_purchase_orders:number;pending_receipt_qty:string;total_work_orders:number;active_work_orders:number;pending_issue_qty:string;pending_completion_qty:string;shortage_requirement_count:number;
  total_quotations:number;open_quotations:number;total_sales_orders:number;open_sales_orders:number;pending_shipment_qty:string;total_quality_inspections:number;pending_iqc:number;pending_ipqc:number;pending_fqc:number;open_quality_exceptions:number;
  ar_total:string;ar_settled:string;ar_balance:string;ap_total:string;ap_settled:string;ap_balance:string;net_receipts:string;net_payments:string;
  pending_planning_handoffs:number;pending_jobs:number;failed_jobs:number;migrations:MigrationStatus[];recent_events:SafeBusinessEvent[];recent_audits:SafeAuditEvent[];generated_at:string;
}>;
export type DashboardMetric = Readonly<{code:string;label:string;value:string|number;hint:string;tone:"neutral"|"info"|"warning"|"danger";href:string}>;
export type DashboardRisk = Readonly<{code:string;level:"low"|"medium"|"high";text:string;href:string}>;
export type DashboardModule = Readonly<{code:string;label:string;description:string;href:string;permission:string;native:boolean}>;
export type DashboardSummary = Readonly<{generated_at:string;authority:"Node/PostgreSQL";consistency:"REPEATABLE_READ_READ_ONLY";inventory_quantity_aggregated:false;groups:Partial<Record<DashboardDomain,unknown>>;modules:DashboardModule[];
  total_items?:number;total_mappings?:number;pending?:number;auto_count?:number;suspect_count?:number;new_count?:number;total_customers?:number;total_suppliers?:number;total_products?:number;total_boms?:number;pending_planning_handoffs?:number;total_pos?:number;open_pos?:number;total_work_orders?:number;active_work_orders?:number;total_quotations?:number;open_quotations?:number;total_sales_orders?:number;open_sales_orders?:number;total_quality_inspections?:number;open_quality_issues?:number;receivable_balance?:string;payable_balance?:string;pending_jobs?:number;failed_jobs?:number}>;
export type BackupArtifact = Readonly<{file:string;sha256:string;bytes:number;entries?:number}>;
export type BackupVerification = Readonly<{schema_version:1;result:"VERIFIED";backup_id:string;created_at:string;verified_at:string;application_version:string;git_commit:string;migration_head:string;artifacts:Readonly<{postgresql_dump:BackupArtifact;uploads:BackupArtifact;attachments:BackupArtifact}>}>;
