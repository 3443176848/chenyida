export const SNAPSHOT_STAGE_ORDER = Object.freeze([
  "identity", "references", "material", "master_data", "product", "bom_mapping",
  "inventory_opening", "finance_opening", "files", "reconciliation", "finalization",
]);

export const SNAPSHOT_KINDS = new Set([
  "identity", "unit", "category", "material", "customer", "supplier", "product",
  "product_version", "supplier_mapping", "bom", "bom_line", "inventory_balance",
  "finance_opening", "file", "audit",
]);

export const ARCHIVE_ONLY_KINDS = new Set([
  "purchase_order", "purchase_receipt", "work_order", "production_report",
  "production_completion", "sales_order", "shipment", "quality_inspection", "finance_document",
]);

export const PUBLIC_TARGET_TABLES = new Set([
  "app_users", "units", "material_categories", "material_master", "customers", "suppliers",
  "products", "product_versions", "supplier_mappings", "bom_headers", "bom_lines",
  "inventory_migration_openings", "finance_opening_sources", "synthetic_files", "audit_log",
]);
