import type { PoolClient } from "pg";
import { compatibilityProfileFor, compatibilityReviewEvidence } from "../material-governance-selfhost/compatibility.ts";
import { MASTER_CATEGORY_GOVERNANCE_MAP } from "../material-governance-selfhost/config.ts";
import { governMaterialSource } from "../material-governance-selfhost/engine.ts";
import { FormalMaterialScanLimitError, scanFormalGovernanceMaterials } from "../material-governance-selfhost/formal-materials.ts";
import { validatedDraftSource } from "../material-governance-selfhost/source-adapter.ts";
import { MaterialWorkflowError, materialFailure } from "./errors.ts";
import { PostgresMaterialRepository } from "./repository.ts";
import { assertReviewSeparation, buildInternalMaterialCode, transitionMaterialState } from "./state-machine.ts";
import type { MaterialActor, MaterialRow, MutationResult, ValidatedDraft } from "./types.ts";
import { validateDraftPayload } from "./validation.ts";

type MutationContext = Readonly<{
  actor: MaterialActor;
  requestId: string;
  idempotencyKey: string;
  requestDigest: string;
  routeScope: string;
}>;

const numberValue = (value: unknown) => Number(value);
const hasPermission = (actor: MaterialActor, permission: string) => actor.permissions.includes("*") || actor.permissions.includes(permission);

function expectedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) materialFailure("REQUEST_VALIDATION_FAILED", "expected_version 必须是正安全整数", 400);
  return Number(value);
}

function comment(value: unknown, field: string, required = false): string {
  if (value === undefined || value === null) {
    if (required) materialFailure("REVIEW_REASON_REQUIRED", "驳回必须填写原因", 400);
    return "";
  }
  if (typeof value !== "string") materialFailure("REQUEST_VALIDATION_FAILED", `${field} 必须是字符串`, 400);
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > 1000 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    materialFailure(required ? "REVIEW_REASON_REQUIRED" : "REQUEST_VALIDATION_FAILED", required ? "驳回必须填写合法原因" : `${field} 长度或字符无效`, 400);
  }
  return normalized;
}

function mutablePayload(body: Record<string, unknown>) {
  const payload = { ...body };
  delete payload.expected_version;
  delete payload.submit_comment;
  delete payload.review_comment;
  delete payload.reason;
  return payload;
}

function snapshot(value: ValidatedDraft, row: MaterialRow, attributes = value.attributes): Record<string, unknown> {
  return {
    material_id: numberValue(row.id), internal_material_code: row.internal_material_code ?? null,
    standard_name: value.basic.standard_name, category_id: value.categoryId, category_code: value.categoryCode,
    brand: value.basic.brand, manufacturer: value.basic.manufacturer,
    manufacturer_part_number: value.basic.manufacturer_part_number, unit: value.basic.unit,
    procurement_type: value.basic.procurement_type, inventory_type: value.basic.inventory_type,
    lot_control_required: value.basic.lot_control_required, shelf_life_days: value.basic.shelf_life_days,
    inspection_type: value.basic.inspection_type, environmental_requirement: value.basic.environmental_requirement,
    source_type: value.basic.source_type, source_ref: value.basic.source_ref,
    material_status: row.material_status, version: Number(row.version), created_by: row.created_by,
    last_modified_by: row.last_modified_by, submitted_by: row.submitted_by ?? "",
    submitted_at: row.submitted_at ?? null, approved_by: row.approved_by ?? "", approved_at: row.approved_at ?? null,
    attributes: Object.fromEntries(attributes.map((item) => [item.attributeCode, { value: item.value, unit: item.unitCode, source: item.sourceType }])),
  };
}

export class MaterialWorkflowService {
  private readonly repository: PostgresMaterialRepository;

  constructor(repository: PostgresMaterialRepository) { this.repository = repository; }

  async createDraft(context: MutationContext, body: Record<string, unknown>) {
    return this.repository.runIdempotent({ actor: context.actor.username, method: "POST", routeScope: context.routeScope, key: context.idempotencyKey, requestDigest: context.requestDigest, requestId: context.requestId, statusCode: 201 }, async (client, operationId, keyDigest) => {
      return this.createDraftWithClient(client, context, body, operationId, keyDigest);
    });
  }

  /**
   * Controlled application-service entry for callers that already own the PostgreSQL
   * transaction (for example the import-review finalizer). It deliberately preserves
   * every Material validation, version/change record and audit side effect.
   */
  async createDraftWithClient(
    client: PoolClient,
    context: MutationContext,
    body: Record<string, unknown>,
    operationId: string,
    idempotencyKeyDigest: string,
  ): Promise<MutationResult & Record<string, unknown>> {
    const categoryId = Number(body.category_id);
    if (!Number.isSafeInteger(categoryId) || categoryId < 1) materialFailure("REQUEST_VALIDATION_FAILED", "category_id 无效", 400);
    const metadata = await this.repository.categoryMetadata(client, categoryId);
    if (!metadata) materialFailure("MATERIAL_CATEGORY_NOT_FOUND", "物料分类不存在或未启用", 404);
    const value = validateDraftPayload(body, metadata);
    const row = await this.repository.insertDraft(client, value, context.actor.username, context.requestId);
    const result = this.repository.result(row);
    await this.repository.version(client, { materialId: result.material_id, version: 1, eventType: "CREATE", changedFields: ["CREATE_DRAFT"], snapshot: snapshot(value, row), actor: context.actor.username, requestId: context.requestId });
    await this.repository.changes(client, { materialId: result.material_id, changeType: "CREATE", fields: [{ name: "CREATE_DRAFT", oldValue: null, newValue: { material_status: "DRAFT", version: 1 } }], actor: context.actor.username, requestId: context.requestId });
    await this.repository.audit(client, { username: context.actor.username, action: "MATERIAL_DRAFT_CREATED", routeCode: context.routeScope, requestId: context.requestId, materialId: result.material_id, operationId, idempotencyKeyDigest, oldVersion: null, newVersion: 1 });
    return result as MutationResult & Record<string, unknown>;
  }

  async updateDraft(context: MutationContext, materialId: number, body: Record<string, unknown>) {
    return this.repository.runIdempotent({ actor: context.actor.username, method: "PATCH", routeScope: context.routeScope, key: context.idempotencyKey, requestDigest: context.requestDigest, requestId: context.requestId, statusCode: 200 }, async (client, operationId, keyDigest) => {
      const expected = expectedVersion(body.expected_version);
      const current = await this.requireLockedMaterial(client, materialId);
      this.assertDraftEditor(context.actor, current);
      if (current.material_status !== "DRAFT") materialFailure("MATERIAL_NOT_EDITABLE", "只有 DRAFT 物料可以编辑", 409);
      if (Number(current.version) !== expected) materialFailure("VERSION_CONFLICT", "物料版本已变化，请刷新后重试", 409);
      const payload = mutablePayload(body);
      const categoryId = Number(payload.category_id);
      const metadata = Number.isSafeInteger(categoryId) ? await this.repository.categoryMetadata(client, categoryId) : null;
      if (!metadata) materialFailure("MATERIAL_CATEGORY_NOT_FOUND", "物料分类不存在或未启用", 404);
      const value = validateDraftPayload(payload, metadata, { sourceType: String(current.source_type), sourceRef: String(current.source_ref ?? "") });
      await this.assertGovernanceDraftIdentity(client, materialId, value);
      const updated = await this.repository.updateDraft(client, materialId, expected, value, context.actor.username, context.requestId);
      if (!updated) materialFailure("VERSION_CONFLICT", "物料版本已变化，请刷新后重试", 409);
      const fields = ["standard_name", "category_id", "brand", "manufacturer", "manufacturer_part_number", "unit", "procurement_type", "inventory_type", "lot_control_required", "shelf_life_days", "inspection_type", "environmental_requirement", "attributes", "version"];
      await this.repository.version(client, { materialId, version: Number(updated.version), eventType: "UPDATE", changedFields: fields, snapshot: snapshot(value, updated), actor: context.actor.username, requestId: context.requestId });
      await this.repository.changes(client, { materialId, changeType: "UPDATE", fields: [{ name: "version", oldValue: expected, newValue: Number(updated.version) }, { name: "aggregate", oldValue: { version: expected }, newValue: snapshot(value, updated) }], actor: context.actor.username, requestId: context.requestId });
      await this.repository.audit(client, { username: context.actor.username, action: "MATERIAL_DRAFT_UPDATED", routeCode: context.routeScope, requestId: context.requestId, materialId, operationId, idempotencyKeyDigest: keyDigest, oldVersion: expected, newVersion: Number(updated.version) });
      return this.repository.result(updated) as MutationResult & Record<string, unknown>;
    });
  }

  async submitDraft(context: MutationContext, materialId: number, body: Record<string, unknown>) {
    return this.repository.runIdempotent({ actor: context.actor.username, method: "POST", routeScope: context.routeScope, key: context.idempotencyKey, requestDigest: context.requestDigest, requestId: context.requestId, statusCode: 200 }, async (client, operationId, keyDigest) => {
      const expected = expectedVersion(body.expected_version); const reason = comment(body.submit_comment, "submit_comment");
      const current = await this.requireLockedMaterial(client, materialId); this.assertDraftEditor(context.actor, current);
      transitionMaterialState(String(current.material_status), "SUBMIT");
      if (Number(current.version) !== expected) materialFailure("VERSION_CONFLICT", "物料版本已变化，请刷新后重试", 409);
      const value = await this.validateStored(client, current);
      await this.assertGovernanceDraftIdentity(client, materialId, value);
      const updated = await this.repository.transition(client, materialId, expected, "DRAFT", "PENDING_REVIEW", context.actor.username, context.requestId);
      if (!updated) materialFailure("VERSION_CONFLICT", "物料版本已变化，请刷新后重试", 409);
      await this.repository.version(client, { materialId, version: Number(updated.version), eventType: "SUBMIT", reason, changedFields: ["material_status", "submitted_by", "submitted_at", "version"], snapshot: snapshot(value, updated), actor: context.actor.username, requestId: context.requestId });
      await this.repository.changes(client, { materialId, changeType: "SUBMIT", reason, fields: [{ name: "material_status", oldValue: "DRAFT", newValue: "PENDING_REVIEW" }, { name: "version", oldValue: expected, newValue: Number(updated.version) }], actor: context.actor.username, requestId: context.requestId });
      await this.repository.audit(client, { username: context.actor.username, action: "MATERIAL_DRAFT_SUBMITTED", routeCode: context.routeScope, requestId: context.requestId, materialId, operationId, idempotencyKeyDigest: keyDigest, oldVersion: expected, newVersion: Number(updated.version) });
      return this.repository.result(updated) as MutationResult & Record<string, unknown>;
    });
  }

  async approveDraft(context: MutationContext, materialId: number, body: Record<string, unknown>) {
    return this.review(context, materialId, body, true);
  }

  async rejectDraft(context: MutationContext, materialId: number, body: Record<string, unknown>) {
    return this.review(context, materialId, body, false);
  }

  private async review(context: MutationContext, materialId: number, body: Record<string, unknown>, approve: boolean) {
    return this.repository.runIdempotent({ actor: context.actor.username, method: "POST", routeScope: context.routeScope, key: context.idempotencyKey, requestDigest: context.requestDigest, requestId: context.requestId, statusCode: 200 }, async (client, operationId, keyDigest) => {
      const expected = expectedVersion(body.expected_version);
      const reason = comment(approve ? body.review_comment : body.reason, approve ? "review_comment" : "reason", !approve);
      const current = await this.requireLockedMaterial(client, materialId);
      transitionMaterialState(String(current.material_status), approve ? "APPROVE" : "REJECT");
      if (Number(current.version) !== expected) materialFailure("VERSION_CONFLICT", "物料版本已变化，请刷新后重试", 409);
      assertReviewSeparation(context.actor.username, String(current.created_by), String(current.last_modified_by));
      const value = await this.validateStored(client, current);
      let code: string | undefined;
      if (approve) {
        await this.assertGovernedIdentityAvailableForApproval(client, materialId, value);
        code = buildInternalMaterialCode(value.categoryCode, await this.repository.allocateCategorySequence(client, value.categoryId, value.categoryCode));
      }
      const nextState = approve ? "ACTIVE" : "DRAFT";
      const updated = await this.repository.transition(client, materialId, expected, "PENDING_REVIEW", nextState, context.actor.username, context.requestId, { approvedCode: code, reason });
      if (!updated) materialFailure("VERSION_CONFLICT", "物料版本已变化，请刷新后重试", 409);
      const event = approve ? "APPROVE" : "REJECT";
      const changedFields = approve ? ["material_status", "internal_material_code", "approved_by", "approved_at", "version"] : ["material_status", "version"];
      await this.repository.version(client, { materialId, version: Number(updated.version), eventType: event, reason, changedFields, snapshot: snapshot(value, updated), actor: context.actor.username, reviewer: context.actor.username, requestId: context.requestId });
      await this.repository.changes(client, { materialId, changeType: event, reason, fields: [{ name: "material_status", oldValue: "PENDING_REVIEW", newValue: nextState }, ...(approve ? [{ name: "internal_material_code", oldValue: null, newValue: code }] : []), { name: "version", oldValue: expected, newValue: Number(updated.version) }], actor: context.actor.username, requestId: context.requestId });
      await this.repository.audit(client, { username: context.actor.username, action: approve ? "MATERIAL_DRAFT_APPROVED" : "MATERIAL_DRAFT_REJECTED", routeCode: context.routeScope, requestId: context.requestId, materialId, operationId, idempotencyKeyDigest: keyDigest, oldVersion: expected, newVersion: Number(updated.version), details: approve ? { internal_material_code: code } : { reason } });
      return this.repository.result(updated) as MutationResult & Record<string, unknown>;
    });
  }

  private async requireLockedMaterial(client: PoolClient, materialId: number): Promise<MaterialRow> {
    const row = await this.repository.lockMaterial(client, materialId);
    if (!row) materialFailure("MATERIAL_NOT_FOUND", "物料不存在或无权查看", 404);
    return row;
  }

  private assertDraftEditor(actor: MaterialActor, material: MaterialRow): void {
    if (String(material.created_by) === actor.username) {
      if (!hasPermission(actor, "material.draft.edit_own") && !hasPermission(actor, "material.draft.edit_any")) materialFailure("FORBIDDEN", "当前账号没有草稿编辑权限", 403);
      return;
    }
    if (!hasPermission(actor, "material.draft.edit_any")) materialFailure("MATERIAL_NOT_FOUND", "物料不存在或无权查看", 404);
  }

  private async assertGovernanceDraftIdentity(client: PoolClient, materialId: number, value: ValidatedDraft): Promise<void> {
    const links = await this.repository.governanceDraftIdentityLinks(client, materialId);
    if (links.length === 0) return;
    if (links.length !== 1) {
      materialFailure("MATERIAL_GOVERNANCE_LINK_INTEGRITY_FAILED", "物料草稿存在冲突的治理来源，禁止继续处理", 409);
    }
    const link = links[0];
    const source = validatedDraftSource(value, materialId);
    let governed = null;
    try {
      governed = source ? governMaterialSource(source) : null;
    } catch {
      governed = null;
    }
    if (
      link.readiness !== "READY"
      || !link.identity_digest
      || governed?.readiness !== "READY"
      || governed.category !== link.category
      || governed.ruleVersion !== link.rule_version
      || governed.identityDigest !== link.identity_digest
    ) {
      materialFailure("MATERIAL_GOVERNANCE_IDENTITY_MISMATCH", "治理关联草稿的类别、关键规格或性能等级不得变更", 422);
    }
  }

  private async assertGovernedIdentityAvailableForApproval(client: PoolClient, materialId: number, value: ValidatedDraft): Promise<void> {
    if (!Object.hasOwn(MASTER_CATEGORY_GOVERNANCE_MAP, value.categoryCode)) return;
    const source = validatedDraftSource(value, materialId);
    if (!source) {
      materialFailure("MATERIAL_GOVERNANCE_IDENTITY_INCOMPLETE", "物料分类与封装不符合该受治理类别的身份规则，禁止批准", 422);
    }
    let governed = null;
    try {
      governed = governMaterialSource(source);
    } catch {
      governed = null;
    }
    if (governed?.readiness !== "READY" || !governed.identityDigest) {
      materialFailure("MATERIAL_GOVERNANCE_IDENTITY_INCOMPLETE", "该受治理类别的关键规格或性能等级不完整，禁止批准", 422);
    }
    const identityDigest = governed.identityDigest;
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`material-governance-identity:${identityDigest}`]);
    const reservations = await this.repository.governanceIdentityDraftReservations(client, identityDigest);
    if (reservations.some((reservation) => Number(reservation.material_id) !== materialId)) {
      materialFailure(
        "MATERIAL_GOVERNANCE_IDENTITY_DRAFT_RESERVED",
        "该规格已由 BOM 治理流程建立草稿或进入待审，当前普通草稿禁止抢占正式编码",
        409,
      );
    }
    let exactStatus: string | null = null;
    let compatibilityConflict = false;
    let unresolvedFormalIdentityConflict = false;
    try {
      await scanFormalGovernanceMaterials(client, ["ACTIVE", "FROZEN", "INACTIVE"], (material, resolved) => {
        if (Number(material.id) === materialId) return;
        const formalCategory = resolved?.category
          ?? MASTER_CATEGORY_GOVERNANCE_MAP[String(material.category_code ?? "").trim().toUpperCase()];
        if (formalCategory !== governed.category) return;
        if (resolved?.readiness === "READY") {
          if (resolved.identityDigest !== identityDigest) return;
          exactStatus = String(material.material_status);
          return false;
        }
        if (resolved && compatibilityReviewEvidence(resolved, governed)) {
          compatibilityConflict = true;
          return;
        }
        if (!resolved || !compatibilityProfileFor(resolved)) unresolvedFormalIdentityConflict = true;
      });
    } catch (error) {
      if (error instanceof FormalMaterialScanLimitError) {
        materialFailure("MATERIAL_GOVERNANCE_SCAN_LIMIT_EXCEEDED", "可比较的正式物料超过安全扫描上限，禁止批准", 413);
      }
      throw error;
    }
    if (exactStatus === "ACTIVE") {
      materialFailure("MATERIAL_GOVERNANCE_DUPLICATE_ACTIVE", "该规格已有 ACTIVE 物料，禁止生成第二个正式编码", 409);
    }
    if (exactStatus) {
      materialFailure("MATERIAL_GOVERNANCE_EXISTING_IDENTITY_CONFLICT", "该规格已有冻结或停用物料，需先人工处置", 409);
    }
    if (compatibilityConflict) {
      materialFailure(
        "MATERIAL_GOVERNANCE_COMPATIBILITY_REVIEW_REQUIRED",
        "存在规格部分一致但身份元数据待处置的正式物料；当前版本不提供 ACTIVE 属性修订，禁止批准",
        409,
      );
    }
    if (unresolvedFormalIdentityConflict) {
      materialFailure(
        "MATERIAL_GOVERNANCE_UNRESOLVED_FORMAL_IDENTITY",
        "同类正式物料存在无法可靠重构的身份冲突；当前版本不提供 ACTIVE 属性修订，禁止批准",
        409,
      );
    }
  }

  private async validateStored(client: PoolClient, material: MaterialRow): Promise<ValidatedDraft> {
    const metadata = await this.repository.categoryMetadata(client, numberValue(material.category_id));
    if (!metadata) materialFailure("MATERIAL_VALIDATION_FAILED", "物料分类已停用或不存在", 422, [{ code: "MATERIAL_CATEGORY_NOT_FOUND", severity: "ERROR", field: "category_id", message: "分类已停用或不存在" }]);
    const attributes = await this.repository.materialAttributes(client, numberValue(material.id));
    const payload = {
      category_id: numberValue(material.category_id),
      basic_fields: {
        standard_name: material.standard_name, unit: material.base_uom, brand: material.brand,
        manufacturer: material.manufacturer, manufacturer_part_number: material.manufacturer_part_number,
        procurement_type: material.procurement_type, inventory_type: material.inventory_type,
        lot_control_required: material.lot_control_required, shelf_life_days: material.shelf_life_days,
        inspection_type: material.inspection_type, environmental_requirement: material.environmental_requirement,
        source_type: material.source_type, source_ref: material.source_ref,
      },
      attributes: Object.fromEntries(attributes.map((item) => [String(item.attribute_code), { value: item.value, unit: item.unit_code, source: item.source_type, confidence: 1 }])),
    };
    try { return validateDraftPayload(payload, metadata); }
    catch (error) {
      if (error instanceof MaterialWorkflowError && error.status === 400) throw new MaterialWorkflowError("MATERIAL_VALIDATION_FAILED", "物料当前数据不再符合元数据规则", 422, error.details);
      throw error;
    }
  }
}
