type Access = "PROTECTED" | "SELF_SERVICE" | "PUBLIC" | "RETIRED" | "OFFLINE_FORBIDDEN";
type Operation = Readonly<{
  id: string;
  source: string;
  evidence: string;
  route_pattern: string;
  methods: string[];
  access: Access;
  permissions_all?: string[];
  permissions_any?: string[];
  data_domain: string;
  csrf: string;
  idempotency: string;
  audit: string;
  universal_role_access_reason?: string;
  note?: string;
}>;

const SOURCE = {
  dispatcher: "app/lib/selfhost-api.ts",
  aiGovernance: "app/lib/ai-governance-suggestion-selfhost/handler.ts",
  bom: "app/lib/bom-selfhost/handler.ts",
  dashboard: "app/lib/dashboard-selfhost/handler.ts",
  finance: "app/lib/finance-selfhost/handler.ts",
  identity: "app/lib/identity-selfhost/handler.ts",
  inventoryLot: "app/lib/inventory-lot-selfhost/handler.ts",
  inventory: "app/lib/inventory-selfhost/handler.ts",
  master: "app/lib/master-data-selfhost/handler.ts",
  governance: "app/lib/material-governance-selfhost/handler.ts",
  importFallback: "app/lib/material-import-fallback/handler.ts",
  normalization: "app/lib/material-import-normalization-selfhost/handler.ts",
  review: "app/lib/material-import-review-selfhost/handler.ts",
  importMapping: "app/lib/material-import-selfhost/handler.ts",
  requirement: "app/lib/material-requirement-selfhost/handler.ts",
  material: "app/lib/material-selfhost/handler.ts",
  standardization: "app/lib/material-standardization-selfhost/handler.ts",
  planning: "app/lib/planning-handoff-selfhost/handler.ts",
  fulfillment: "app/lib/procurement-fulfillment-selfhost/handler.ts",
  procurement: "app/lib/procurement-selfhost/handler.ts",
  sourcing: "app/lib/procurement-sourcing-selfhost/handler.ts",
  batch: "app/lib/production-batch-selfhost/handler.ts",
  productionHandoff: "app/lib/production-handoff-selfhost/handler.ts",
  nonconformance: "app/lib/production-nonconformance-selfhost/handler.ts",
  operation: "app/lib/production-operation-selfhost/handler.ts",
  routing: "app/lib/production-routing-selfhost/handler.ts",
  production: "app/lib/production-selfhost/handler.ts",
  project: "app/lib/project-selfhost/handler.ts",
  quality: "app/lib/quality-selfhost/handler.ts",
  sales: "app/lib/sales-selfhost/handler.ts",
  supplierMapping: "app/lib/supplier-mapping-selfhost/handler.ts",
} as const;

export const APPLICATION_AUTHORIZATION_ALL_EMPLOYEE_READ_PENDING = "CURRENT_ALL_EMPLOYEE_READ_SCOPE_REQUIRES_BUSINESS_APPROVAL";

function protectedRead(id: string, source: string, evidence: string, route: string, permission: string | string[], domain: string, note?: string): Operation {
  const permissions = Array.isArray(permission) ? permission : [permission];
  return { id, source, evidence, route_pattern: route, methods: ["GET"], access: "PROTECTED", permissions_all: permissions, data_domain: domain, csrf: "NOT_APPLICABLE", idempotency: "NOT_APPLICABLE", audit: "READ_ONLY", ...(note ? { note } : {}) };
}

function protectedReadAny(id: string, source: string, evidence: string, route: string, permissions: string[], domain: string, note?: string): Operation {
  return { id, source, evidence, route_pattern: route, methods: ["GET"], access: "PROTECTED", permissions_any: permissions, data_domain: domain, csrf: "NOT_APPLICABLE", idempotency: "NOT_APPLICABLE", audit: "READ_ONLY", ...(note ? { note } : {}) };
}

function protectedWrite(id: string, source: string, evidence: string, route: string, methods: string[], permission: string | string[], domain: string, note?: string): Operation {
  const permissions = Array.isArray(permission) ? permission : [permission];
  return { id, source, evidence, route_pattern: route, methods, access: "PROTECTED", permissions_all: permissions, data_domain: domain, csrf: "REQUIRED", idempotency: "REQUIRED", audit: "REQUIRED_TRANSACTIONAL", ...(note ? { note } : {}) };
}

function protectedWriteAny(id: string, source: string, evidence: string, route: string, methods: string[], permissions: string[], domain: string, note?: string): Operation {
  return { id, source, evidence, route_pattern: route, methods, access: "PROTECTED", permissions_any: permissions, data_domain: domain, csrf: "REQUIRED", idempotency: "REQUIRED", audit: "REQUIRED_TRANSACTIONAL", ...(note ? { note } : {}) };
}

function nonRole(id: string, source: string, evidence: string, route: string, methods: string[], access: Exclude<Access, "PROTECTED">, domain: string, csrf: string, idempotency: string, audit: string, note?: string): Operation {
  return { id, source, evidence, route_pattern: route, methods, access, data_domain: domain, csrf, idempotency, audit, ...(note ? { note } : {}) };
}

export const APPLICATION_AUTHORIZATION_OPERATIONS_V1: readonly Operation[] = [
  nonRole("runtime.live", SOURCE.dispatcher, "/api/live", "^/api/live$", ["GET"], "PUBLIC", "OPERATIONS", "NOT_APPLICABLE", "NOT_APPLICABLE", "READ_ONLY", "不连接数据库的进程存活探针"),
  nonRole("runtime.health", SOURCE.dispatcher, "/api/health", "^/api/health$", ["GET"], "PUBLIC", "OPERATIONS", "NOT_APPLICABLE", "NOT_APPLICABLE", "READ_ONLY", "仅返回安全化运行就绪状态"),

  protectedRead("ai-governance.read", SOURCE.aiGovernance, "AI_GOVERNANCE_SUGGESTIONS", "^/api/material-master/import-batches/[1-9][0-9]*/governance-runs/[1-9][0-9]*/groups/[1-9][0-9]*/ai-suggestions(?:/[0-9a-f-]+)?$", "material.import.governance.read", "MATERIAL_MASTER"),
  protectedWrite("ai-governance.create", SOURCE.aiGovernance, "request.method === \"POST\"", "^/api/material-master/import-batches/[1-9][0-9]*/governance-runs/[1-9][0-9]*/groups/[1-9][0-9]*/ai-suggestions$", ["POST"], "material.import.governance.run", "MATERIAL_MASTER"),

  protectedRead("bom.read", SOURCE.bom, "master.bom.read", "^/api/(?:boms(?:/[1-9][0-9]*/versions(?:/[1-9][0-9]*/release)?)?|bom-lines(?:/[1-9][0-9]*)?|bom-readiness|bom-material-candidates)$", "master.bom.read", "ENGINEERING_MASTER"),
  protectedWrite("bom.manage", SOURCE.bom, "master.bom.manage", "^/api/(?:boms|bom-lines|bom-lines/[1-9][0-9]*|boms/[1-9][0-9]*/versions|boms/[1-9][0-9]*/versions/[1-9][0-9]*/release)$", ["POST", "PATCH", "DELETE"], "master.bom.manage", "ENGINEERING_MASTER"),

  protectedRead("dashboard.summary", SOURCE.dashboard, "/api/summary", "^/api/summary$", "dashboard.read", "MANAGEMENT_DASHBOARD"),
  protectedRead("dashboard.management", SOURCE.dashboard, "/api/management-dashboard", "^/api/management-dashboard$", ["dashboard.read", "dashboard.management.read"], "MANAGEMENT_DASHBOARD"),
  protectedRead("dashboard.operations", SOURCE.dashboard, "/api/operations/status", "^/api/operations/status$", "operations.audit_status.read", "OPERATIONS"),
  protectedRead("dashboard.backup", SOURCE.dashboard, "/api/backups", "^/api/(?:backups|backup-governance)$", "system.backup.read", "IDENTITY_AND_SYSTEM"),
  nonRole("dashboard.cleaning-compat", SOURCE.dashboard, "/api/cleaning", "^/api/cleaning$", ["GET"], "SELF_SERVICE", "MATERIAL_MASTER", "NOT_APPLICABLE", "NOT_APPLICABLE", "READ_ONLY", "认证后只返回空的退役兼容结果"),
  nonRole("dashboard.offline-backup", SOURCE.dashboard, "/api/backups/create", "^/api/backups/(?:create|restore)$", ["POST"], "OFFLINE_FORBIDDEN", "IDENTITY_AND_SYSTEM", "FORBIDDEN", "FORBIDDEN", "FORBIDDEN_OPERATION"),
  nonRole("dashboard.retired-legacy", SOURCE.dashboard, "/api/sample-import", "^/api/(?:sample-import|export/items\\.csv|export/cleaning\\.csv|import|import-file|cleaning/(?:clear|confirm|create-item))$", ["GET", "POST", "PUT", "PATCH", "DELETE"], "RETIRED", "CROSS_DOMAIN", "FORBIDDEN", "FORBIDDEN", "FORBIDDEN_OPERATION"),

  protectedRead("finance.read", SOURCE.finance, "finance.read", "^/api/(?!finance/source-options$)(?:finance-summary|finance/(?:documents|settlements|projects)|financial-documents(?:/[1-9][0-9]*)?|financial-payments|financial-documents/[1-9][0-9]*/settlements|(?:financial-payments|finance-settlements)/[1-9][0-9]*/reversal|financial-documents/from-(?:source|sales-order|purchase-order))$", "finance.read", "FINANCE"),
  protectedRead("finance.source-options", SOURCE.finance, "/api/finance/source-options", "^/api/finance/source-options$", ["finance.read", "finance.post"], "FINANCE"),
  protectedWrite("finance.post-document", SOURCE.finance, "FINANCE_DOCUMENT_POSTED", "^/api/(?:finance/documents|financial-documents/from-(?:source|sales-order|purchase-order))$", ["POST"], "finance.post", "FINANCE"),
  protectedWrite("finance.settle", SOURCE.finance, "FINANCE_SETTLEMENT_POSTED", "^/api/(?:financial-payments|finance/settlements|financial-documents/[1-9][0-9]*/settlements)$", ["POST"], "finance.pay", "FINANCE"),
  protectedWrite("finance.reverse", SOURCE.finance, "FINANCE_SETTLEMENT_REVERSED", "^/api/(?:financial-payments|finance-settlements)/[1-9][0-9]*/reversal$", ["POST"], "finance.reverse", "FINANCE"),

  nonRole("identity.setup", SOURCE.identity, "/api/setup", "^/api/setup$", ["POST"], "PUBLIC", "IDENTITY_AND_SYSTEM", "SETUP_TOKEN", "SINGLE_INITIALIZATION", "REQUIRED", "运行配置另行禁止受控环境浏览器初始化"),
  nonRole("identity.login", SOURCE.identity, "/api/login", "^/api/login$", ["POST"], "PUBLIC", "IDENTITY_AND_SYSTEM", "LOGIN_CREDENTIAL_BOUND", "RATE_LIMITED", "REQUIRED"),
  nonRole("identity.session", SOURCE.identity, "/api/session", "^/api/session$", ["GET"], "PUBLIC", "IDENTITY_AND_SYSTEM", "NOT_APPLICABLE", "NOT_APPLICABLE", "READ_ONLY"),
  nonRole("identity.logout", SOURCE.identity, "/api/logout", "^/api/logout$", ["POST"], "SELF_SERVICE", "IDENTITY_AND_SYSTEM", "REQUIRED_IF_AUTHENTICATED", "SESSION_REVOCATION", "REQUIRED"),
  nonRole("identity.change-own-password", SOURCE.identity, "/api/me/password", "^/api/me/password$", ["POST"], "SELF_SERVICE", "IDENTITY_AND_SYSTEM", "REQUIRED", "REQUIRED", "REQUIRED_TRANSACTIONAL"),
  protectedRead("identity.users.read", SOURCE.identity, "/api/users", "^/api/users$", "system.user.read", "IDENTITY_AND_SYSTEM"),
  protectedRead("identity.audit.read", SOURCE.identity, "/api/system/audit-logs", "^/api/system/audit-logs$", "system.audit.read", "IDENTITY_AND_SYSTEM"),
  protectedWrite("identity.users.create", SOURCE.identity, "createUser", "^/api/users$", ["POST"], "system.user.create", "IDENTITY_AND_SYSTEM"),
  protectedWrite("identity.users.status", SOURCE.identity, "/api/users/status", "^/api/users/status$", ["POST"], "system.user.status", "IDENTITY_AND_SYSTEM"),
  protectedWrite("identity.users.reset", SOURCE.identity, "/api/users/reset-password", "^/api/users/reset-password$", ["POST"], "system.user.reset", "IDENTITY_AND_SYSTEM"),

  protectedRead("inventory-lot.read", SOURCE.inventoryLot, "inventory.lot.read", "^/api/inventory/lots(?:/[1-9][0-9]*(?:/ledger)?)?$", "inventory.lot.read", "INVENTORY"),
  protectedWrite("inventory-lot.freeze", SOURCE.inventoryLot, "inventory.lot.freeze", "^/api/inventory/lots/[1-9][0-9]*/(?:freeze|unfreeze)$", ["POST"], "inventory.lot.freeze", "INVENTORY"),
  protectedRead("inventory.read", SOURCE.inventory, "inventory.read", "^/api/(?:inventory|inventory-transactions|inventory/ledger|inventory/reconciliation|inventory-adjustments(?:/[1-9][0-9]*)?)$", "inventory.read", "INVENTORY"),
  protectedWrite("inventory.adjust", SOURCE.inventory, "inventory.adjust", "^/api/inventory-adjustments$", ["POST"], "inventory.adjust", "INVENTORY"),
  protectedWrite("inventory.reverse", SOURCE.inventory, "inventory.reverse", "^/api/inventory-adjustments/[1-9][0-9]*/reversal$", ["POST"], "inventory.reverse", "INVENTORY"),

  protectedRead("master.items", SOURCE.master, "/api/items", "^/api/items$", "material.read", "MATERIAL_MASTER"),
  protectedRead("master.customers", SOURCE.master, "master.customer.read", "^/api/customers$", "master.customer.read", "PARTNER_MASTER"),
  protectedRead("master.suppliers", SOURCE.master, "master.supplier.read", "^/api/suppliers$", "master.supplier.read", "PARTNER_MASTER"),
  protectedRead("master.products", SOURCE.master, "master.product.read", "^/api/products(?:/[1-9][0-9]*/versions)?$", "master.product.read", "ENGINEERING_MASTER"),
  protectedRead("master.mappings", SOURCE.master, "master.supplier_mapping.read", "^/api/mappings$", "master.supplier_mapping.read", "SUPPLIER_MAPPING"),
  protectedWrite("master.customer.manage", SOURCE.master, "master.customer.manage", "^/api/customers(?:/[1-9][0-9]*/status)?$", ["POST", "PATCH"], "master.customer.manage", "PARTNER_MASTER"),
  protectedWrite("master.supplier.manage", SOURCE.master, "master.supplier.manage", "^/api/suppliers(?:/[1-9][0-9]*/status)?$", ["POST", "PATCH"], "master.supplier.manage", "PARTNER_MASTER"),
  protectedWrite("master.product.manage", SOURCE.master, "master.product.manage", "^/api/products(?:/[1-9][0-9]*/(?:status|versions(?:/[1-9][0-9]*/release)?))?$", ["POST", "PATCH"], "master.product.manage", "ENGINEERING_MASTER"),
  protectedWrite("master.mapping.price", SOURCE.master, "master.supplier_mapping.manage", "^/api/mappings/[1-9][0-9]*/prices$", ["POST"], "master.supplier_mapping.manage", "SUPPLIER_MAPPING"),
  nonRole("master.mapping.legacy-write", SOURCE.master, "SUPPLIER_MAPPING_LEGACY_WRITE_BLOCKED", "^/api/mappings(?:/[1-9][0-9]*/status)?$", ["POST", "PATCH"], "RETIRED", "SUPPLIER_MAPPING", "FORBIDDEN", "FORBIDDEN", "FORBIDDEN_OPERATION"),

  protectedRead("governance.read", SOURCE.governance, "MATERIAL_GOVERNANCE_LATEST", "^/api/material-master/import-batches/[1-9][0-9]*/(?:governance|governance-runs(?:/[1-9][0-9]*(?:/(?:groups(?:/[1-9][0-9]*)?|rows|reports/(?:materials|bom-mapping|duplicates|exceptions|alternatives)))?)?)$", "material.import.governance.read", "MATERIAL_MASTER"),
  protectedWrite("governance.run", SOURCE.governance, "MATERIAL_GOVERNANCE_RUNS", "^/api/material-master/import-batches/[1-9][0-9]*/governance-runs$", ["POST"], "material.import.governance.run", "MATERIAL_MASTER"),
  protectedWrite("governance.decide.exclude", SOURCE.governance, "MATERIAL_GOVERNANCE_GROUP_DECISION", "^/api/material-master/import-batches/[1-9][0-9]*/governance-runs/[1-9][0-9]*/groups/[1-9][0-9]*/decision$", ["POST"], "material.import.governance.decide", "MATERIAL_MASTER", "EXCLUDE 决策"),
  protectedWrite("governance.decide.bind", SOURCE.governance, "MATERIAL_GOVERNANCE_GROUP_DECISION", "^/api/material-master/import-batches/[1-9][0-9]*/governance-runs/[1-9][0-9]*/groups/[1-9][0-9]*/decision$", ["POST"], ["material.import.governance.decide", "material.import.governance.bind"], "MATERIAL_MASTER", "BIND_EXISTING 决策"),
  protectedWrite("governance.decide.create-draft", SOURCE.governance, "MATERIAL_GOVERNANCE_GROUP_DECISION", "^/api/material-master/import-batches/[1-9][0-9]*/governance-runs/[1-9][0-9]*/groups/[1-9][0-9]*/decision$", ["POST"], ["material.import.governance.decide", "material.import.governance.create_draft", "material.draft.create"], "MATERIAL_MASTER", "CREATE_DRAFT 决策"),

  protectedRead("import-fallback.list", SOURCE.importFallback, "IMPORT_BATCH_COLLECTION", "^/api/material-master/import-batches$", "material.import.read", "MATERIAL_MASTER", "created_by_me/owner scope 另由服务端约束"),
  protectedWrite("import-fallback.create", SOURCE.importFallback, "material.import.create", "^/api/material-master/import-batches$", ["POST"], "material.import.create", "MATERIAL_MASTER"),
  protectedRead("import-fallback.detail", SOURCE.importFallback, "IMPORT_BATCH_DETAIL", "^/api/material-master/import-batches/[1-9][0-9]{0,14}$", "material.import.read", "MATERIAL_MASTER", "owner/read_any 约束"),
  protectedWrite("import-fallback.upload", SOURCE.importFallback, "IMPORT_FILE_UPLOAD", "^/api/material-master/import-batches/[1-9][0-9]{0,14}/file$", ["POST"], "material.import.create", "MATERIAL_MASTER"),
  protectedWrite("import-fallback.parse", SOURCE.importFallback, "IMPORT_PARSE_CREATE", "^/api/material-master/import-batches/[1-9][0-9]{0,14}/parse$", ["POST"], "material.import.parse", "MATERIAL_MASTER"),
  protectedWrite("import-fallback.cancel", SOURCE.importFallback, "IMPORT_BATCH_CANCEL", "^/api/material-master/import-batches/[1-9][0-9]{0,14}/cancel$", ["POST"], "material.import.cancel", "MATERIAL_MASTER"),
  protectedRead("import-fallback.job", SOURCE.importFallback, "IMPORT_JOB_DETAIL", "^/api/jobs/[0-9a-f-]+$", "material.import.read", "MATERIAL_MASTER", "owner/read_any 约束"),

  protectedWrite("normalization.create", SOURCE.normalization, "IMPORT_NORMALIZATION_CREATE", "^/api/material-master/import-batches/[1-9][0-9]*/normalize$", ["POST"], "material.import.normalize", "MATERIAL_MASTER"),
  protectedRead("normalization.read", SOURCE.normalization, "IMPORT_NORMALIZATION_SUMMARY", "^/api/material-master/import-batches/[1-9][0-9]*/(?:normalization(?:/runs(?:/[1-9][0-9]*)?)?|normalized-rows(?:/[1-9][0-9]*)?|normalization-issues)$", "material.import.read", "MATERIAL_MASTER"),
  protectedWrite("normalization.retry", SOURCE.normalization, "IMPORT_NORMALIZATION_RETRY", "^/api/material-master/import-batches/[1-9][0-9]*/normalization/runs/[1-9][0-9]*/retry$", ["POST"], "material.import.normalize", "MATERIAL_MASTER"),
  protectedWrite("normalization.cancel", SOURCE.normalization, "IMPORT_NORMALIZATION_CANCEL", "^/api/material-master/import-batches/[1-9][0-9]*/normalization/runs/[1-9][0-9]*/cancel$", ["POST"], "material.import.cancel", "MATERIAL_MASTER"),

  protectedWrite("review.create", SOURCE.review, "IMPORT_REVIEW_CREATE", "^/api/material-master/import-batches/[1-9][0-9]*/reviews$", ["POST"], "material.import.review.create", "MATERIAL_MASTER"),
  protectedRead("review.owner-read", SOURCE.review, "IMPORT_REVIEW_CURRENT", "^/api/material-master/import-batches/[1-9][0-9]*/reviews/(?:current|[1-9][0-9]*/(?:statistics|rows(?:/[1-9][0-9]*)?|validate|finalization))$", "material.read", "MATERIAL_MASTER", "服务端以批次 owner/read_any 再裁剪"),
  protectedRead("review.history", SOURCE.review, "IMPORT_REVIEW_HISTORY", "^/api/material-master/import-batches/[1-9][0-9]*/reviews/history$", "material.import.review.history", "MATERIAL_MASTER"),
  protectedRead("review.search-material", SOURCE.review, "IMPORT_REVIEW_ACTIVE_MATERIALS", "^/api/material-master/import-batches/[1-9][0-9]*/reviews/active-materials$", "material.import.review.search_material", "MATERIAL_MASTER"),
  protectedWrite("review.edit-field", SOURCE.review, "IMPORT_REVIEW_FIELD_OVERRIDE", "^/api/material-master/import-batches/[1-9][0-9]*/reviews/[1-9][0-9]*/rows/[1-9][0-9]*/(?:field-overrides|attribute-overrides)$", ["POST"], "material.import.review.edit", "MATERIAL_MASTER"),
  protectedWrite("review.decide", SOURCE.review, "IMPORT_REVIEW_ROW_DECISION", "^/api/material-master/import-batches/[1-9][0-9]*/reviews/[1-9][0-9]*/rows/[1-9][0-9]*/decision$", ["POST"], "material.import.review.decide", "MATERIAL_MASTER", "KEEP/EXCLUDE 基础决策"),
  protectedWrite("review.decide-bind", SOURCE.review, "IMPORT_REVIEW_ROW_DECISION", "^/api/material-master/import-batches/[1-9][0-9]*/reviews/[1-9][0-9]*/rows/[1-9][0-9]*/decision$", ["POST"], ["material.import.review.decide", "material.import.review.bind"], "MATERIAL_MASTER", "BIND_EXISTING 决策"),
  protectedWrite("review.decide-draft", SOURCE.review, "IMPORT_REVIEW_ROW_DECISION", "^/api/material-master/import-batches/[1-9][0-9]*/reviews/[1-9][0-9]*/rows/[1-9][0-9]*/decision$", ["POST"], ["material.import.review.decide", "material.import.review.create_draft"], "MATERIAL_MASTER", "CREATE_DRAFT 决策"),
  protectedWrite("review.resolve-issue", SOURCE.review, "IMPORT_REVIEW_ISSUE_RESOLUTION", "^/api/material-master/import-batches/[1-9][0-9]*/reviews/[1-9][0-9]*/rows/[1-9][0-9]*/issues/[1-9][0-9]*/resolution$", ["POST"], "material.import.review.issue", "MATERIAL_MASTER"),
  protectedWrite("review.bulk", SOURCE.review, "IMPORT_REVIEW_BULK_DECISION", "^/api/material-master/import-batches/[1-9][0-9]*/reviews/[1-9][0-9]*/bulk-decision$", ["POST"], "material.import.review.bulk", "MATERIAL_MASTER"),
  protectedWrite("review.finalize", SOURCE.review, "IMPORT_REVIEW_FINALIZE", "^/api/material-master/import-batches/[1-9][0-9]*/reviews/[1-9][0-9]*/finalize$", ["POST"], "material.import.review.finalize", "MATERIAL_MASTER"),
  protectedWrite("review.retry", SOURCE.review, "IMPORT_REVIEW_RETRY", "^/api/material-master/import-batches/[1-9][0-9]*/reviews/[1-9][0-9]*/finalization/retry$", ["POST"], "material.import.review.retry", "MATERIAL_MASTER"),

  protectedRead("import-mapping.read", SOURCE.importMapping, "IMPORT_MAPPING_SHEETS", "^/api/material-master/import-batches/[1-9][0-9]*/(?:sheets|rows|mapping|mapping-targets|mapping/versions(?:/[1-9][0-9]*)?|mapping/validity|mapping/reuse-candidates)$", "material.import.read", "MATERIAL_MASTER"),
  protectedWrite("import-mapping.write", SOURCE.importMapping, "material.import.map", "^/api/material-master/import-batches/[1-9][0-9]*/(?:mapping|mapping/(?:preview|confirm|versions|reuse))$", ["POST", "PUT"], "material.import.map", "MATERIAL_MASTER"),

  protectedRead("material.categories", SOURCE.material, "MATERIAL_CATEGORY_LIST", "^/api/material-master/categories(?:/[1-9][0-9]*/schema)?$", "material.read", "MATERIAL_MASTER"),
  protectedRead("material.records", SOURCE.material, "MATERIAL_LIST", "^/api/material-master/materials(?:/[1-9][0-9]*(?:/(?:versions|change-logs))?)?$", "material.read", "MATERIAL_MASTER"),
  protectedRead("material.audit", SOURCE.material, "material.audit.read", "^/api/material-master/materials/[1-9][0-9]*/audit-logs$", "material.audit.read", "MATERIAL_MASTER"),
  protectedRead("material.drafts", SOURCE.material, "MATERIAL_DRAFT_COLLECTION", "^/api/material-master/drafts(?:/[1-9][0-9]*)?$", "material.read", "MATERIAL_MASTER"),
  protectedWrite("material.draft.create", SOURCE.material, "material.draft.create", "^/api/material-master/drafts$", ["POST"], "material.draft.create", "MATERIAL_MASTER"),
  protectedWriteAny("material.draft.edit", SOURCE.material, "material.draft.edit_own", "^/api/material-master/drafts/[1-9][0-9]*$", ["PATCH"], ["material.draft.edit_own", "material.draft.edit_any"], "MATERIAL_MASTER"),
  protectedWrite("material.draft.submit", SOURCE.material, "material.draft.submit", "^/api/material-master/drafts/[1-9][0-9]*/submit$", ["POST"], "material.draft.submit", "MATERIAL_MASTER"),
  protectedWrite("material.review.approve", SOURCE.material, "MATERIAL_DRAFT_${mutation", "^/api/material-master/drafts/[1-9][0-9]*/approve$", ["POST"], "material.review.approve", "MATERIAL_MASTER"),
  protectedWrite("material.review.reject", SOURCE.material, "MATERIAL_DRAFT_${mutation", "^/api/material-master/drafts/[1-9][0-9]*/reject$", ["POST"], "material.review.reject", "MATERIAL_MASTER"),
  protectedRead("material.review.queue", SOURCE.material, "MATERIAL_REVIEW_QUEUE", "^/api/material-master/review-queue$", "material.review.queue", "MATERIAL_MASTER"),
  protectedReadAny("material.standardization", SOURCE.standardization, "standardization-preview", "^/api/material-master/import-batches/[1-9][0-9]*/(?:standardization-preview|standardization-export\\.csv)$", ["material.import.read", "material.import.read_any"], "MATERIAL_MASTER"),

  protectedRead("planning.read", SOURCE.planning, "planning.read", "^/api/(?:planning-handoffs|projects/[1-9][0-9]*/(?:requirement-resolutions|planning-packages)|planning-packages/[1-9][0-9]*)$", "planning.read", "PLANNING"),
  protectedWrite("planning.prepare", SOURCE.planning, "planning.prepare", "^/api/(?:projects/[1-9][0-9]*/(?:requirement-resolutions|requirement-unit-resolutions|planning-packages)|planning-packages/[1-9][0-9]*/(?:revision-responses|successor))$", ["POST"], "planning.prepare", "PLANNING"),
  protectedWrite("planning.submit", SOURCE.planning, "planning.submit", "^/api/planning-packages/[1-9][0-9]*/submit$", ["POST"], "planning.submit", "PLANNING"),
  protectedWrite("planning.accept", SOURCE.planning, "planning.accept", "^/api/planning-packages/[1-9][0-9]*/(?:accept|return)$", ["POST"], "planning.accept", "PLANNING"),

  protectedRead("requirement.plan.read", SOURCE.requirement, "planning.requirement.read", "^/api/(?:planning-packages/[1-9][0-9]*/material-requirement-plans|material-requirement-plans/[1-9][0-9]*)$", "planning.requirement.read", "PLANNING"),
  protectedRead("requirement.purchase.read", SOURCE.requirement, "planning.purchase_request.read", "^/api/purchase-requests(?:/[1-9][0-9]*)?$", "planning.purchase_request.read", "PLANNING"),
  protectedWrite("requirement.prepare", SOURCE.requirement, "planning.requirement.prepare", "^/api/planning-packages/[1-9][0-9]*/material-requirement-plans$", ["POST"], "planning.requirement.prepare", "PLANNING"),
  protectedWrite("requirement.submit", SOURCE.requirement, "planning.requirement.submit", "^/api/material-requirement-plans/[1-9][0-9]*/submit$", ["POST"], "planning.requirement.submit", "PLANNING"),
  protectedWrite("requirement.decide", SOURCE.requirement, "planning.purchase_request.decide", "^/api/purchase-requests/[1-9][0-9]*/(?:accept|return)$", ["POST"], "planning.purchase_request.decide", "PLANNING"),

  protectedRead("fulfillment.read", SOURCE.fulfillment, "procurement.fulfillment.read", "^/api/(?:procurement/fulfillment/(?:pending-awards|orders|receiving-queue|payable-handoff)|procurement/purchase-orders/[1-9][0-9]*/history)$", "procurement.fulfillment.read", "PROCUREMENT"),
  protectedRead("fulfillment.convert-preview", SOURCE.fulfillment, "purchase-order-conversion-preview", "^/api/procurement/awards/[1-9][0-9]*/purchase-order-conversion-preview$", "procurement.award.convert", "PROCUREMENT"),
  protectedRead("fulfillment.receipt-preview", SOURCE.fulfillment, "receipt-preview", "^/api/procurement/delivery-plans/[1-9][0-9]*/receipt-preview$", "procurement.receiving.receive", "PROCUREMENT"),
  protectedWrite("fulfillment.convert", SOURCE.fulfillment, "procurement.award.convert", "^/api/procurement/awards/[1-9][0-9]*/purchase-orders$", ["POST"], "procurement.award.convert", "PROCUREMENT"),
  protectedWrite("fulfillment.plan", SOURCE.fulfillment, "procurement.delivery_plan.manage", "^/api/procurement/(?:purchase-orders/[1-9][0-9]*/delivery-plans|delivery-plans/[1-9][0-9]*/(?:cancel|close))$", ["POST"], "procurement.delivery_plan.manage", "PROCUREMENT"),
  protectedWrite("fulfillment.receive", SOURCE.fulfillment, "procurement.receiving.receive", "^/api/procurement/delivery-plans/[1-9][0-9]*/receipts$", ["POST"], "procurement.receiving.receive", "PROCUREMENT"),
  protectedWrite("fulfillment.reverse", SOURCE.fulfillment, "procurement.receiving.reverse", "^/api/procurement/fulfillment/receipts/[1-9][0-9]*/reversal$", ["POST"], "procurement.receiving.reverse", "PROCUREMENT"),

  protectedRead("procurement.read", SOURCE.procurement, "procurement.read", "^/api/(?!purchase-suggestions$|procurement/financial-sources$)(?:purchase-orders(?:/[1-9][0-9]*)?|purchase-order-lines|purchase-order-receivable-lines|purchase-receipts(?:/[1-9][0-9]*)?|purchase-receive)$", "procurement.read", "PROCUREMENT"),
  protectedRead("procurement.suggestions", SOURCE.procurement, "/api/purchase-suggestions", "^/api/purchase-suggestions$", "procurement.plan", "PROCUREMENT"),
  protectedRead("procurement.financial-sources", SOURCE.procurement, "/api/procurement/financial-sources", "^/api/procurement/financial-sources$", "procurement.finance_source.read", "PROCUREMENT"),
  protectedWrite("procurement.order", SOURCE.procurement, "procurement.order", "^/api/purchase-orders(?:/from-shortage|/[1-9][0-9]*(?:/close)?)?$", ["POST", "PATCH"], "procurement.order", "PROCUREMENT"),
  protectedWrite("procurement.receive", SOURCE.procurement, "procurement.receive", "^/api/(?:purchase-receipts|purchase-receive)$", ["POST"], "procurement.receive", "PROCUREMENT"),
  protectedWrite("procurement.reverse", SOURCE.procurement, "procurement.reverse", "^/api/purchase-receipts/[1-9][0-9]*/reversal$", ["POST"], "procurement.reverse", "PROCUREMENT"),

  protectedRead("sourcing.read", SOURCE.sourcing, "procurement.rfq.read", "^/api/procurement/(?:rfqs(?:/coverage|/[1-9][0-9]*)?|comparisons/[1-9][0-9]*)$", "procurement.rfq.read", "PROCUREMENT"),
  protectedRead("sourcing.mapping-preview", SOURCE.sourcing, "mappingPreview", "^/api/procurement/rfqs/[1-9][0-9]*/mapping-bindings/preview$", "procurement.rfq.manage", "PROCUREMENT"),
  protectedWrite("sourcing.rfq", SOURCE.sourcing, "procurement.rfq.manage", "^/api/procurement/(?:rfqs|rfqs/[1-9][0-9]*/(?:mapping-bindings|issue))$", ["POST"], "procurement.rfq.manage", "PROCUREMENT"),
  protectedWrite("sourcing.quote", SOURCE.sourcing, "procurement.quote.record", "^/api/procurement/(?:rfqs/[1-9][0-9]*/quotes|quotes/[1-9][0-9]*/revise)$", ["POST"], "procurement.quote.record", "PROCUREMENT"),
  protectedWrite("sourcing.compare", SOURCE.sourcing, "procurement.quote.compare", "^/api/procurement/rfqs/[1-9][0-9]*/comparisons$", ["POST"], "procurement.quote.compare", "PROCUREMENT"),
  protectedWrite("sourcing.award", SOURCE.sourcing, "procurement.sourcing.award", "^/api/procurement/rfqs/[1-9][0-9]*/award$", ["POST"], "procurement.sourcing.award", "PROCUREMENT"),
  protectedWrite("sourcing.reverse", SOURCE.sourcing, "procurement.sourcing.reverse", "^/api/procurement/awards/[1-9][0-9]*/reversal$", ["POST"], "procurement.sourcing.reverse", "PROCUREMENT"),

  protectedRead("batch.read", SOURCE.batch, "production.batch.read", "^/api/(?:production/batch-sets(?:/[1-9][0-9]*/batches)?|production/batches(?:/[1-9][0-9]*(?:/(?:wip|genealogy))?)?|work-orders/[1-9][0-9]*/batch-summary)$", "production.batch.read", "PRODUCTION"),
  protectedWrite("batch.manage", SOURCE.batch, "production.batch.manage", "^/api/(?:production/batch-sets(?:/[1-9][0-9]*/(?:batches|release|cancel))?|production/batches/[1-9][0-9]*(?:/delete)?)$", ["POST", "PATCH"], "production.batch.manage", "PRODUCTION"),
  protectedRead("production-handoff.read", SOURCE.productionHandoff, "production.handoff.read", "^/api/production-handoffs(?:/[1-9][0-9]*)?$", "production.handoff.read", "PRODUCTION"),
  protectedWrite("production-handoff.prepare", SOURCE.productionHandoff, "production.handoff.prepare", "^/api/planning-packages/[1-9][0-9]*/production-handoffs$", ["POST"], "production.handoff.prepare", "PRODUCTION"),
  protectedWrite("production-handoff.submit", SOURCE.productionHandoff, "production.handoff.submit", "^/api/production-handoffs/[1-9][0-9]*/submit$", ["POST"], "production.handoff.submit", "PRODUCTION"),
  protectedWrite("production-handoff.decide", SOURCE.productionHandoff, "production.handoff.decide", "^/api/production-handoffs/[1-9][0-9]*/(?:accept|return)$", ["POST"], "production.handoff.decide", "PRODUCTION"),
  protectedWrite("production-handoff.work-order", SOURCE.productionHandoff, "production.handoff.work_order", "^/api/production-handoff-items/[1-9][0-9]*/work-order$", ["POST"], "production.handoff.work_order", "PRODUCTION"),

  protectedRead("nonconformance.read", SOURCE.nonconformance, "quality.nonconformance.read", "^/api/quality/nonconformances(?:/[1-9][0-9]*(?:/target-operations)?)?$", "quality.nonconformance.read", "QUALITY"),
  protectedRead("rework-quality.read", SOURCE.nonconformance, "quality.rework_request.read", "^/api/quality/rework-requests(?:/[1-9][0-9]*)?$", "quality.rework_request.read", "QUALITY"),
  protectedRead("rework-production.read", SOURCE.nonconformance, "production.rework_request.read", "^/api/production/rework-requests$", "production.rework_request.read", "PRODUCTION"),
  protectedWrite("nonconformance.create", SOURCE.nonconformance, "quality.nonconformance.create", "^/api/quality/inspections/[1-9][0-9]*/nonconformance$", ["POST"], "quality.nonconformance.create", "QUALITY"),
  protectedWrite("rework-quality.create", SOURCE.nonconformance, "quality.rework_request.create", "^/api/quality/(?:nonconformances/[1-9][0-9]*/rework-requests|rework-requests/[1-9][0-9]*(?:/cancel)?)$", ["POST", "PATCH"], "quality.rework_request.create", "QUALITY"),
  protectedWrite("rework-quality.submit", SOURCE.nonconformance, "quality.rework_request.submit", "^/api/quality/rework-requests/[1-9][0-9]*/submit$", ["POST"], "quality.rework_request.submit", "QUALITY"),
  protectedWrite("rework-production.decide", SOURCE.nonconformance, "production.rework_request.decide", "^/api/production/rework-requests/[1-9][0-9]*/(?:accept|return)$", ["POST"], "production.rework_request.decide", "PRODUCTION"),
  protectedWrite("nonconformance.scrap", SOURCE.nonconformance, "quality.nonconformance.scrap", "^/api/quality/nonconformances/[1-9][0-9]*/scrap-dispositions$", ["POST"], "quality.nonconformance.scrap", "QUALITY"),

  protectedRead("operation.read", SOURCE.operation, "production.read", "^/api/production/(?:operation-execution/(?:operators|operations|runs|wip)|rework-executions)$", "production.read", "PRODUCTION"),
  protectedRead("operation.reinspection", SOURCE.operation, "quality.read", "^/api/quality/rework-reinspection-sources$", "quality.read", "QUALITY"),
  protectedWrite("operation.dispatch", SOURCE.operation, "production.dispatch", "^/api/production/(?:operation-execution/dispatch|operation-runs/[1-9][0-9]*/cancel|rework-requests/[1-9][0-9]*/dispatch)$", ["POST"], "production.dispatch", "PRODUCTION"),
  protectedWrite("operation.execute", SOURCE.operation, "production.execute", "^/api/production/operation-runs/[1-9][0-9]*/(?:start|reports)$", ["POST"], "production.execute", "PRODUCTION"),
  protectedWrite("operation.reverse", SOURCE.operation, "production.operation.reverse", "^/api/production/operation-runs/[1-9][0-9]*/reverse$", ["POST"], "production.operation.reverse", "PRODUCTION"),

  protectedRead("routing.work-centers", SOURCE.routing, "production.work_center.read", "^/api/production/work-centers$", "production.work_center.read", "PRODUCTION"),
  protectedRead("routing.read", SOURCE.routing, "production.routing.read", "^/api/production/(?:routings|routing-versions/[1-9][0-9]*)$", "production.routing.read", "PRODUCTION"),
  protectedRead("routing.snapshot", SOURCE.routing, "production.routing.snapshot.read", "^/api/(?:work-orders/[1-9][0-9]*/routing-snapshot|production/dispatch)$", "production.routing.snapshot.read", "PRODUCTION"),
  protectedWrite("routing.work-center-manage", SOURCE.routing, "production.work_center.manage", "^/api/production/work-centers(?:/[1-9][0-9]*/status)?$", ["POST", "PATCH"], "production.work_center.manage", "PRODUCTION"),
  protectedWrite("routing.manage", SOURCE.routing, "production.routing.manage", "^/api/production/(?:routings(?:/[1-9][0-9]*/versions)?|routing-versions/[1-9][0-9]*/(?:operations|submit))$", ["POST", "PATCH"], "production.routing.manage", "PRODUCTION"),
  protectedWrite("routing.review", SOURCE.routing, "production.routing.review", "^/api/production/routing-versions/[1-9][0-9]*/(?:release|return)$", ["POST"], "production.routing.review", "PRODUCTION"),

  protectedRead("production.read", SOURCE.production, "production.read", "^/api/(?:work-orders(?:/[1-9][0-9]*(?:/(?:bom-snapshot|progress))?)?|work-order-materials|production-reports|production/(?:material-requirements|material-issues(?:/[1-9][0-9]*)?|material-returns(?:/[1-9][0-9]*)?|reports(?:/[1-9][0-9]*)?|final-output-sources|completions(?:/[1-9][0-9]*)?))$", "production.read", "PRODUCTION"),
  protectedWrite("production.plan", SOURCE.production, "production.plan", "^/api/work-orders(?:/from-bom|/[1-9][0-9]*(?:/(?:release|cancel))?)?$", ["POST", "PATCH"], "production.plan", "PRODUCTION"),
  protectedWrite("production.close", SOURCE.production, "production.close", "^/api/work-orders/[1-9][0-9]*/close$", ["POST"], "production.close", "PRODUCTION"),
  protectedWrite("production.issue", SOURCE.production, "production.issue", "^/api/(?:production/material-(?:issues|returns)|work-orders/issue-materials)$", ["POST"], "production.issue", "PRODUCTION"),
  protectedWrite("production.report", SOURCE.production, "production.report", "^/api/production/reports$", ["POST"], "production.report", "PRODUCTION"),
  protectedWrite("production.complete", SOURCE.production, "production.complete", "^/api/production/completions$", ["POST"], "production.complete", "PRODUCTION"),
  protectedWrite("production.report-reverse", SOURCE.production, "production.report.reverse", "^/api/production/reports/[1-9][0-9]*/reverse$", ["POST"], "production.report.reverse", "PRODUCTION"),
  protectedWrite("production.complete-reverse", SOURCE.production, "production.complete.reverse", "^/api/production/completions/[1-9][0-9]*/reverse$", ["POST"], "production.complete.reverse", "PRODUCTION"),
  protectedWrite("production.legacy-complete", SOURCE.production, "/api/work-orders/complete", "^/api/work-orders/complete$", ["POST"], ["production.report", "production.complete"], "PRODUCTION"),

  protectedRead("project.read", SOURCE.project, "project.read", "^/api/projects(?:/[1-9][0-9]*)?$", "project.read", "PROJECT"),
  protectedRead("project.handoff-read", SOURCE.project, "project.engineering.read", "^/api/project-handoffs$", "project.engineering.read", "PROJECT"),
  protectedWrite("project.create", SOURCE.project, "project.market.create", "^/api/projects$", ["POST"], "project.market.create", "PROJECT"),
  protectedWrite("project.edit", SOURCE.project, "project.market.edit", "^/api/projects/[1-9][0-9]*(?:/documents(?:/[1-9][0-9]*)?)?$", ["PATCH", "POST", "DELETE"], "project.market.edit", "PROJECT"),
  protectedWrite("project.submit", SOURCE.project, "project.market.submit", "^/api/projects/[1-9][0-9]*/submit$", ["POST"], "project.market.submit", "PROJECT"),
  protectedWrite("project.accept", SOURCE.project, "project.engineering.accept", "^/api/projects/[1-9][0-9]*/accept$", ["POST"], "project.engineering.accept", "PROJECT"),
  protectedWrite("project.return", SOURCE.project, "project.engineering.return", "^/api/projects/[1-9][0-9]*/return$", ["POST"], "project.engineering.return", "PROJECT"),

  protectedRead("quality.read", SOURCE.quality, "quality.read", "^/api/(?:quality-inspections(?:/[1-9][0-9]*(?:/(?:results|defects))?)?|quality-defects|quality/(?:source-options|eligibility))$", "quality.read", "QUALITY"),
  protectedRead("quality.allocation-read", SOURCE.quality, "quality.finished_goods_allocation.read", "^/api/quality/finished-goods-allocations$", "quality.finished_goods_allocation.read", "QUALITY"),
  protectedRead("quality.allocation-options", SOURCE.quality, "quality.finished_goods_allocation.create", "^/api/quality/finished-goods-allocation-options$", ["quality.finished_goods_allocation.read", "quality.finished_goods_allocation.create"], "QUALITY"),
  protectedWrite("quality.allocation-create", SOURCE.quality, "quality.finished_goods_allocation.create", "^/api/quality/finished-goods-allocations$", ["POST"], "quality.finished_goods_allocation.create", "QUALITY"),
  protectedWrite("quality.allocation-cancel", SOURCE.quality, "quality.finished_goods_allocation.cancel", "^/api/quality/finished-goods-allocations/[1-9][0-9]*/cancel$", ["POST"], "quality.finished_goods_allocation.cancel", "QUALITY"),
  protectedWrite("quality.inspect", SOURCE.quality, "quality.inspect", "^/api/quality-inspections$", ["POST"], "quality.inspect", "QUALITY"),
  protectedWrite("quality.defect", SOURCE.quality, "quality.defect", "^/api/quality-inspections/[1-9][0-9]*/defects$", ["POST"], "quality.defect", "QUALITY"),
  protectedWrite("quality.disposition", SOURCE.quality, "quality.disposition", "^/api/quality-inspections/[1-9][0-9]*/dispositions$", ["POST"], "quality.disposition", "QUALITY"),
  protectedWrite("quality.close", SOURCE.quality, "quality.close", "^/api/quality-inspections/[1-9][0-9]*/close$", ["POST"], "quality.close", "QUALITY"),
  protectedWrite("quality.reopen", SOURCE.quality, "quality.reopen", "^/api/quality-inspections/[1-9][0-9]*/reopen$", ["POST"], "quality.reopen", "QUALITY"),

  protectedRead("sales.read", SOURCE.sales, "sales.read", "^/api/(?!sales/financial-sources$|delivery-instructions|sales/shipment-lot-options)(?:quotations(?:/[1-9][0-9]*(?:/versions(?:/[1-9][0-9]*)?)?)?|sales-orders(?:/[1-9][0-9]*(?:/(?:available-to-ship|progress))?)?|shipments(?:/[1-9][0-9]*)?)$", "sales.read", "SALES"),
  protectedRead("sales.financial-sources", SOURCE.sales, "sales.finance_source.read", "^/api/sales/financial-sources$", "sales.finance_source.read", "SALES"),
  protectedRead("sales.delivery-read", SOURCE.sales, "sales.delivery.read", "^/api/(?:delivery-instructions(?:/[1-9][0-9]*)?|sales/shipment-lot-options)$", "sales.delivery.read", "SALES"),
  protectedWrite("sales.quote", SOURCE.sales, "sales.quote", "^/api/quotations(?:/[1-9][0-9]*(?:/(?:versions|publish|accept|reject|expire|cancel))?)?$", ["POST", "PATCH"], "sales.quote", "SALES"),
  protectedWrite("sales.order", SOURCE.sales, "sales.order", "^/api/(?:quotations(?:/to-sales-order|/[1-9][0-9]*/convert)|sales-orders(?:/[1-9][0-9]*/(?:close|cancel))?)$", ["POST"], "sales.order", "SALES"),
  protectedWrite("sales.delivery-create", SOURCE.sales, "sales.delivery.create", "^/api/delivery-instructions$", ["POST"], "sales.delivery.create", "SALES"),
  protectedWrite("sales.delivery-submit", SOURCE.sales, "sales.delivery.submit", "^/api/delivery-instructions/[1-9][0-9]*/submit$", ["POST"], "sales.delivery.submit", "SALES"),
  protectedWrite("sales.delivery-accept", SOURCE.sales, "sales.delivery.accept", "^/api/delivery-instructions/[1-9][0-9]*/accept$", ["POST"], "sales.delivery.accept", "SALES"),
  protectedWrite("sales.delivery-return", SOURCE.sales, "sales.delivery.return", "^/api/delivery-instructions/[1-9][0-9]*/return$", ["POST"], "sales.delivery.return", "SALES"),
  protectedWrite("sales.delivery-cancel", SOURCE.sales, "sales.delivery.cancel", "^/api/delivery-instructions/[1-9][0-9]*/cancel$", ["POST"], "sales.delivery.cancel", "SALES"),
  protectedWrite("sales.delivery-execute", SOURCE.sales, "sales.delivery.execute", "^/api/(?:delivery-instructions/[1-9][0-9]*/execute|shipments)$", ["POST"], "sales.delivery.execute", "SALES"),
  protectedWrite("sales.legacy-ship", SOURCE.sales, "sales.ship", "^/api/shipments/from-order$", ["POST"], "sales.ship", "SALES"),
  protectedWrite("sales.delivery-reverse", SOURCE.sales, "sales.delivery.reverse", "^/api/shipments/[1-9][0-9]*/reversal$", ["POST"], "sales.delivery.reverse", "SALES"),

  protectedRead("supplier-mapping.read", SOURCE.supplierMapping, "supplier_mapping.read", "^/api/supplier-mappings(?:/[0-9a-f-]+/(?:versions))?$", "supplier_mapping.read", "SUPPLIER_MAPPING"),
  protectedRead("supplier-mapping.options", SOURCE.supplierMapping, "/api/supplier-mappings/options", "^/api/supplier-mappings/options$", "supplier_mapping.create", "SUPPLIER_MAPPING"),
  protectedRead("supplier-mapping.queue", SOURCE.supplierMapping, "supplier_mapping.review_queue", "^/api/supplier-mappings/(?:review-queue|[0-9a-f-]+/review-preview)$", "supplier_mapping.review_queue", "SUPPLIER_MAPPING"),
  protectedWrite("supplier-mapping.create", SOURCE.supplierMapping, "supplier_mapping.create", "^/api/supplier-mappings$", ["POST"], "supplier_mapping.create", "SUPPLIER_MAPPING"),
  protectedWrite("supplier-mapping.edit", SOURCE.supplierMapping, "supplier_mapping.edit_draft", "^/api/supplier-mappings/[0-9a-f-]+/draft$", ["POST"], "supplier_mapping.edit_draft", "SUPPLIER_MAPPING"),
  protectedWrite("supplier-mapping.submit", SOURCE.supplierMapping, "supplier_mapping.submit", "^/api/supplier-mappings/[0-9a-f-]+/submit$", ["POST"], "supplier_mapping.submit", "SUPPLIER_MAPPING"),
  protectedWrite("supplier-mapping.approve", SOURCE.supplierMapping, "supplier_mapping.approve", "^/api/supplier-mappings/[0-9a-f-]+/approve$", ["POST"], "supplier_mapping.approve", "SUPPLIER_MAPPING"),
  protectedWrite("supplier-mapping.reject", SOURCE.supplierMapping, "supplier_mapping.reject", "^/api/supplier-mappings/[0-9a-f-]+/reject$", ["POST"], "supplier_mapping.reject", "SUPPLIER_MAPPING"),
];
