import { IdentityError } from "./errors.ts";
import { IDENTITY_ROLES, type IdentityActor, type IdentityRole } from "./types.ts";

const reviewEditorPermissions = [
  "material.import.review.create", "material.import.review.history", "material.import.review.edit",
  "material.import.review.decide", "material.import.review.issue", "material.import.review.search_material",
  "material.import.review.bind", "material.import.review.create_draft",
];
const reviewManagerPermissions = [...reviewEditorPermissions, "material.import.review.bulk", "material.import.review.finalize", "material.import.review.retry"];
const dashboardRead = ["dashboard.read"];
const managementDashboard = ["dashboard.management.read", "operations.audit_status.read"];
const readOnly = ["material.read", ...dashboardRead];
const masterRead = ["master.customer.read", "master.supplier.read", "master.product.read", "master.bom.read", "master.supplier_mapping.read"];
const masterManage = [...masterRead, "master.customer.manage", "master.supplier.manage", "master.product.manage", "master.bom.manage", "master.supplier_mapping.manage"];
const inventoryRead = ["inventory.read"];
const inventoryManage = [...inventoryRead, "inventory.adjust", "inventory.reverse"];
const procurementRead = ["procurement.read"];
const procurementManage = [...procurementRead, "procurement.plan", "procurement.order", "procurement.receive", "procurement.reverse", "procurement.finance_source.read"];
const productionRead = ["production.read"];
const productionManage = [...productionRead, "production.plan", "production.issue", "production.report", "production.complete", "production.close"];
const salesRead = ["sales.read"];
const salesManage = [...salesRead, "sales.quote", "sales.order", "sales.ship", "sales.reverse", "sales.finance_source.read"];
const qualityRead = ["quality.read"];
const qualityManage = [...qualityRead, "quality.inspect", "quality.defect", "quality.disposition", "quality.close", "quality.reopen"];
const financeRead = ["finance.read"];
const financeManage = [...financeRead, "finance.post", "finance.pay", "finance.reverse"];
const projectRead = ["project.read"];
const projectAdmin = [...projectRead, "project.read_all"];
const projectMarket = [...projectRead, "project.market.create", "project.market.edit", "project.market.submit"];
const projectEngineering = [...projectRead, "project.engineering.read", "project.engineering.accept", "project.engineering.return"];
const planningRead = ["planning.read"];
const planningAll = [...planningRead, "planning.prepare", "planning.submit", "planning.accept"];

const ROLE_PERMISSIONS: Record<IdentityRole, string[]> = {
  admin: ["*", ...dashboardRead, "system.backup.read", "system.user.read", "system.user.create", "system.user.status", "system.user.reset", "system.audit.read", "material.read", "material.draft.create", "material.draft.edit_own", "material.draft.edit_any", "material.draft.submit", "material.review.queue", "material.review.approve", "material.review.reject", "material.audit.read", "material.import.create", "material.import.read", "material.import.read_any", "material.import.cancel", "material.import.parse", "material.import.map", "material.import.normalize", "material.import.commit", ...reviewManagerPermissions, ...masterManage, ...inventoryManage, ...procurementManage, ...productionManage, ...salesManage, ...qualityManage, ...financeManage, ...projectAdmin],
  manager: [...dashboardRead, "material.read", "material.draft.create", "material.draft.edit_own", "material.draft.edit_any", "material.draft.submit", "material.review.queue", "material.review.approve", "material.review.reject", "material.audit.read", "material.import.create", "material.import.read", "material.import.read_any", "material.import.cancel", "material.import.parse", "material.import.map", "material.import.normalize", "material.import.commit", ...reviewManagerPermissions, ...masterManage, ...inventoryManage, ...procurementManage, ...productionManage, ...salesManage, ...qualityManage, ...financeManage, ...projectAdmin],
  purchase: [...dashboardRead, "material.read", "material.draft.create", "material.draft.edit_own", "material.draft.submit", "material.import.create", "material.import.read", "material.import.cancel", "material.import.parse", "material.import.map", ...reviewEditorPermissions, ...masterRead, ...inventoryRead, ...procurementManage, ...productionRead, ...salesRead, ...qualityRead, ...financeRead, "master.supplier.manage", "master.supplier_mapping.manage"],
  engineering: [...dashboardRead, "material.read", "material.draft.create", "material.draft.edit_own", "material.draft.submit", "material.import.create", "material.import.read", "material.import.cancel", "material.import.parse", "material.import.map", ...reviewEditorPermissions, ...masterRead, ...inventoryRead, ...procurementRead, ...productionRead, ...salesRead, ...qualityRead, ...financeRead, ...projectEngineering, "master.product.manage", "master.bom.manage"],
  planning: [...readOnly, ...masterRead, ...inventoryRead, ...procurementRead, ...productionRead, ...salesRead, ...qualityRead, ...financeRead, ...projectRead, ...planningRead, "planning.accept"],
  production: [...readOnly, ...masterRead, ...inventoryRead, ...procurementRead, ...productionRead, ...salesRead, ...qualityRead, ...financeRead, "production.plan", "production.report"],
  warehouse: [...readOnly, ...masterRead, ...inventoryManage, ...procurementRead, ...productionRead, ...salesRead, ...qualityRead, ...financeRead, "procurement.receive", "procurement.reverse", "production.issue", "production.complete", "sales.ship", "sales.reverse"],
  quality: [...readOnly, ...masterRead, ...inventoryRead, ...procurementRead, ...productionRead, ...salesRead, ...qualityManage.filter((permission) => permission !== "quality.reopen"), ...financeRead],
  sales: [...readOnly, ...masterRead, ...inventoryRead, ...procurementRead, ...productionRead, ...salesRead, ...qualityRead, ...financeRead, ...projectMarket, "sales.quote", "sales.order", "master.customer.manage"],
  finance: [...readOnly, ...masterRead, ...inventoryRead, ...procurementRead, ...productionRead, ...salesRead, ...qualityRead, ...financeManage, "procurement.finance_source.read", "sales.finance_source.read"],
  operations: [...readOnly, ...masterRead, ...inventoryRead, ...procurementRead, ...productionRead, ...salesRead, ...qualityRead, ...financeRead],
};

export function validateRole(value: unknown): IdentityRole {
  const role = String(value ?? "") as IdentityRole;
  if (!IDENTITY_ROLES.includes(role)) throw new IdentityError("ROLE_INVALID", "角色代码无效");
  return role;
}

export function permissionsForRole(role: IdentityRole): string[] {
  const operations = ["admin", "manager", "operations"].includes(role) ? managementDashboard : [];
  const planning = ["admin", "manager"].includes(role) ? planningAll
    : role === "engineering" ? [...planningRead, "planning.prepare", "planning.submit"]
      : planningRead;
  return [...new Set([...ROLE_PERMISSIONS[role], ...operations, ...planning])].sort();
}

export function hasPermission(actor: Pick<IdentityActor, "permissions">, permission: string): boolean {
  return actor.permissions.includes("*") || actor.permissions.includes(permission);
}

export function requirePermission(actor: IdentityActor, permission: string): void {
  if (!hasPermission(actor, permission)) throw new IdentityError("PERMISSION_DENIED", "没有权限执行此操作", 403);
}
