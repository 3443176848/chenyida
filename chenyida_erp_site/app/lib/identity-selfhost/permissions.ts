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
const inventoryLotRead = ["inventory.lot.read"];
const inventoryManage = [...inventoryRead, ...inventoryLotRead, "inventory.adjust", "inventory.reverse", "inventory.lot.freeze"];
const procurementRead = ["procurement.read"];
const procurementManage = [...procurementRead, "procurement.plan", "procurement.order", "procurement.receive", "procurement.reverse", "procurement.finance_source.read"];
const procurementSourcingRead = ["procurement.rfq.read"];
const procurementSourcingManage = [...procurementSourcingRead, "procurement.rfq.manage", "procurement.quote.record", "procurement.quote.compare", "procurement.sourcing.award", "procurement.sourcing.reverse"];
const procurementFulfillmentRead = ["procurement.fulfillment.read"];
const procurementFulfillmentPurchase = [...procurementFulfillmentRead, "procurement.award.convert", "procurement.delivery_plan.manage"];
const procurementFulfillmentWarehouse = [...procurementFulfillmentRead, "procurement.receiving.receive", "procurement.receiving.reverse"];
const productionRead = ["production.read"];
const productionBatchRead = ["production.batch.read"];
const productionBatchManage = [...productionBatchRead, "production.batch.manage"];
const productionOperationManage = ["production.dispatch", "production.execute", "production.operation.reverse"];
const productionManage = [...productionRead, "production.plan", "production.issue", "production.report", "production.report.reverse", "production.complete", "production.complete.reverse", "production.close", ...productionOperationManage];
const productionHandoffRead = ["production.handoff.read"];
const productionHandoffPlanning = [...productionHandoffRead, "production.handoff.prepare", "production.handoff.submit"];
const productionHandoffProduction = [...productionHandoffRead, "production.handoff.decide", "production.handoff.work_order"];
const productionRoutingRead = ["production.routing.read"];
const productionRoutingEngineering = [...productionRoutingRead, "production.routing.manage"];
const productionRoutingReview = [...productionRoutingRead, "production.routing.review"];
const productionWorkCenterRead = ["production.work_center.read"];
const productionWorkCenterManage = [...productionWorkCenterRead, "production.work_center.manage"];
const productionRoutingSnapshotRead = ["production.routing.snapshot.read"];
const salesRead = ["sales.read"];
const salesDeliveryRead = ["sales.delivery.read"];
const salesDeliverySales = [...salesDeliveryRead, "sales.delivery.create", "sales.delivery.submit", "sales.delivery.cancel"];
const salesDeliveryWarehouse = [...salesDeliveryRead, "sales.delivery.accept", "sales.delivery.return", "sales.delivery.execute", "sales.delivery.reverse"];
const salesManage = [...salesRead, "sales.quote", "sales.order", "sales.ship", "sales.reverse", "sales.finance_source.read", ...salesDeliverySales, ...salesDeliveryWarehouse];
const qualityRead = ["quality.read"];
const qualityManage = [...qualityRead, "quality.inspect", "quality.defect", "quality.disposition", "quality.close", "quality.reopen"];
const finishedGoodsAllocationRead = ["quality.finished_goods_allocation.read"];
const finishedGoodsAllocationManage = [...finishedGoodsAllocationRead, "quality.finished_goods_allocation.create", "quality.finished_goods_allocation.cancel"];
const nonconformanceRead = ["quality.nonconformance.read", "quality.rework_request.read"];
const nonconformanceQuality = [...nonconformanceRead, "quality.nonconformance.create", "quality.rework_request.create", "quality.rework_request.submit"];
const nonconformanceProduction = ["quality.nonconformance.read", "production.rework_request.read", "production.rework_request.decide"];
const nonconformanceManage = [...nonconformanceQuality, ...nonconformanceProduction, "quality.nonconformance.scrap"];
const financeRead = ["finance.read"];
const financeManage = [...financeRead, "finance.post", "finance.pay", "finance.reverse"];
const financeProjectRead = ["finance.project.read"];
const projectRead = ["project.read"];
const projectAdmin = [...projectRead, "project.read_all"];
const projectMarket = [...projectRead, "project.market.create", "project.market.edit", "project.market.submit"];
const projectEngineering = [...projectRead, "project.engineering.read", "project.engineering.accept", "project.engineering.return"];
const planningRead = ["planning.read"];
const planningAll = [...planningRead, "planning.prepare", "planning.submit", "planning.accept"];
const materialRequirementRead = ["planning.requirement.read", "planning.purchase_request.read"];
const materialRequirementPlanning = [...materialRequirementRead, "planning.requirement.prepare", "planning.requirement.submit"];
const materialRequirementPurchase = [...materialRequirementRead, "planning.purchase_request.decide"];
const materialRequirementAll = [...materialRequirementPlanning, "planning.purchase_request.decide"];

const ROLE_PERMISSIONS: Record<IdentityRole, string[]> = {
  admin: ["*", ...dashboardRead, "system.backup.read", "system.user.read", "system.user.create", "system.user.status", "system.user.reset", "system.audit.read", "material.read", "material.draft.create", "material.draft.edit_own", "material.draft.edit_any", "material.draft.submit", "material.review.queue", "material.review.approve", "material.review.reject", "material.audit.read", "material.import.create", "material.import.read", "material.import.read_any", "material.import.cancel", "material.import.parse", "material.import.map", "material.import.normalize", "material.import.commit", ...reviewManagerPermissions, ...masterManage, ...inventoryManage, ...procurementManage, ...productionManage, ...salesManage, ...qualityManage, ...financeManage, ...projectAdmin],
  manager: [...dashboardRead, "material.read", "material.draft.create", "material.draft.edit_own", "material.draft.edit_any", "material.draft.submit", "material.review.queue", "material.review.approve", "material.review.reject", "material.audit.read", "material.import.create", "material.import.read", "material.import.read_any", "material.import.cancel", "material.import.parse", "material.import.map", "material.import.normalize", "material.import.commit", ...reviewManagerPermissions, ...masterManage, ...inventoryManage, ...procurementManage, ...productionManage, ...salesManage, ...qualityManage, ...finishedGoodsAllocationManage, ...financeManage, ...financeProjectRead, ...projectAdmin],
  purchase: [...dashboardRead, "material.read", "material.draft.create", "material.draft.edit_own", "material.draft.submit", "material.import.create", "material.import.read", "material.import.cancel", "material.import.parse", "material.import.map", ...reviewEditorPermissions, ...masterRead, ...inventoryRead, ...procurementManage, ...procurementSourcingManage, ...procurementFulfillmentPurchase, ...productionRead, ...salesRead, ...qualityRead, ...financeRead, ...materialRequirementPurchase, "master.supplier.manage", "master.supplier_mapping.manage"],
  engineering: [...dashboardRead, "material.read", "material.draft.create", "material.draft.edit_own", "material.draft.submit", "material.import.create", "material.import.read", "material.import.cancel", "material.import.parse", "material.import.map", ...reviewEditorPermissions, ...masterRead, ...inventoryRead, ...procurementRead, ...productionRead, ...productionRoutingEngineering, ...productionWorkCenterRead, ...salesRead, ...qualityRead, ...financeRead, ...financeProjectRead, ...projectEngineering, "master.product.manage", "master.bom.manage"],
  planning: [...readOnly, ...masterRead, ...inventoryRead, ...procurementRead, ...procurementSourcingRead, ...productionRead, ...productionRoutingRead, ...productionHandoffPlanning, ...salesRead, ...qualityRead, ...financeRead, ...projectRead, ...planningRead, ...materialRequirementPlanning, "planning.accept"],
  production: [...readOnly, ...masterRead, ...inventoryRead, ...procurementRead, ...productionRead, ...productionRoutingRead, ...productionRoutingSnapshotRead, ...productionHandoffProduction, ...salesRead, ...qualityRead, ...finishedGoodsAllocationRead, ...financeRead, "production.plan", "production.report", "production.report.reverse", "production.dispatch", "production.execute", "production.operation.reverse"],
  warehouse: [...readOnly, ...masterRead, ...inventoryManage, ...procurementRead, ...procurementFulfillmentWarehouse, ...productionRead, ...productionHandoffRead, ...salesRead, ...salesDeliveryWarehouse, ...qualityRead, ...finishedGoodsAllocationRead, ...financeRead, "procurement.receive", "procurement.reverse", "production.issue", "production.complete", "production.complete.reverse", "sales.ship", "sales.reverse"],
  quality: [...readOnly, ...masterRead, ...inventoryRead, ...procurementRead, ...productionRead, ...salesRead, ...salesDeliveryRead, ...qualityManage.filter((permission) => permission !== "quality.reopen"), ...finishedGoodsAllocationRead, ...financeRead],
  sales: [...readOnly, ...masterRead, ...inventoryRead, ...procurementRead, ...productionRead, ...salesRead, ...salesDeliverySales, ...qualityRead, ...finishedGoodsAllocationManage, ...financeRead, ...projectMarket, "sales.quote", "sales.order", "master.customer.manage"],
  finance: [...readOnly, ...masterRead, ...inventoryRead, ...procurementRead, ...procurementFulfillmentRead, ...productionRead, ...salesRead, ...salesDeliveryRead, ...qualityRead, ...financeManage, ...financeProjectRead, "procurement.finance_source.read", "sales.finance_source.read"],
  operations: [...readOnly, ...masterRead, ...inventoryRead, ...procurementRead, ...productionRead, ...productionWorkCenterManage, ...salesRead, ...qualityRead, ...financeRead],
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
  const requirements = ["admin", "manager"].includes(role) ? materialRequirementAll : [];
  const sourcing = ["admin", "manager"].includes(role) ? procurementSourcingManage : [];
  const fulfillment = ["admin", "manager"].includes(role) ? [...procurementFulfillmentPurchase, ...procurementFulfillmentWarehouse] : [];
  const productionHandoff = ["admin", "manager"].includes(role) ? [...productionHandoffPlanning, ...productionHandoffProduction] : [];
  const productionRouting = ["admin", "manager"].includes(role) ? [...productionRoutingReview, ...productionWorkCenterManage, ...productionRoutingSnapshotRead] : [];
  const nonconformance = ["admin", "manager"].includes(role) ? nonconformanceManage : role === "quality" ? nonconformanceQuality : role === "production" ? nonconformanceProduction : role === "engineering" ? nonconformanceRead : [];
  const productionBatch = ["admin", "manager", "production"].includes(role) ? productionBatchManage : ["quality", "warehouse", "engineering"].includes(role) ? productionBatchRead : [];
  const inventoryLot = ["purchase","production","quality","warehouse","engineering"].includes(role) ? inventoryLotRead : [];
  return [...new Set([...ROLE_PERMISSIONS[role], ...operations, ...planning, ...requirements, ...sourcing, ...fulfillment, ...productionHandoff, ...productionRouting, ...nonconformance, ...productionBatch,...inventoryLot])].sort();
}

export function hasPermission(actor: Pick<IdentityActor, "permissions">, permission: string): boolean {
  return actor.permissions.includes("*") || actor.permissions.includes(permission);
}

export function requirePermission(actor: IdentityActor, permission: string): void {
  if (!hasPermission(actor, permission)) throw new IdentityError("PERMISSION_DENIED", "没有权限执行此操作", 403);
}
