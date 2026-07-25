import { sha256 } from "./digest.mjs";

export const DOMAIN_ORDER = [
  "identity", "reference", "material", "party", "product", "supplier_mapping", "bom",
  "inventory", "procurement", "production", "sales", "quality", "finance", "file", "audit",
];

export const FIXED_ROLES = new Set(["admin", "manager", "purchase", "engineering", "production", "warehouse", "quality", "sales", "finance", "operations"]);

export const TARGET_TABLES = Object.freeze({
  identity: "app_users", unit: "units", category: "material_categories", material: "material_master",
  customer: "customers", supplier: "suppliers", product: "products", product_version: "product_versions",
  supplier_mapping: "supplier_mappings", bom: "bom_headers", bom_line: "bom_lines",
  inventory_balance: "inventory_migration_openings", purchase_order: "purchase_orders", purchase_receipt: "purchase_receipts",
  work_order: "production_work_orders", production_report: "production_reports", production_completion: "production_completions",
  sales_order: "sales_orders", shipment: "sales_shipments", quality_inspection: "quality_inspections",
  finance_document: "finance_documents", finance_opening: "finance_opening_sources", file: "FILE_REFERENCE_PLAN", audit: "audit_log",
});

export const MAPPING_REGISTRY = Object.freeze({
  version: "selfhost-source-map-v2",
  normalization_version: "selfhost-normalization-v1",
  domain_order: DOMAIN_ORDER,
  target_tables: TARGET_TABLES,
  numeric_scale: 6,
  currency_allowlist: ["CNY"],
  role_allowlist: [...FIXED_ROLES].sort(),
  inventory: { location_code: "MAIN", lot_code: "", balance_only: "TYPED_OPENING_COMMAND" },
  finance: { stable_sources: ["purchase_receipt", "shipment", "finance_opening"], opening_types: ["OPENING_AR", "OPENING_AP"] },
});

export function registryDigest(registry = MAPPING_REGISTRY) {
  return sha256(registry);
}
