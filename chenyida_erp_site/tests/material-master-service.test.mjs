import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";

import {
  createD1MaterialMasterRepository,
  createMaterialCodeService,
  createMaterialDraftService,
  createMaterialReviewService,
} from "../app/lib/material-master/index.ts";
import {
  createD1MaterialValidationRepository,
  createMaterialValidationService,
} from "../app/lib/material-validation/index.ts";

const siteRoot = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const now = "2026-07-12T08:00:00.000Z";
let databaseSequence = 0;

async function applyMigration(DB, name) {
  const sql = await readFile(join(siteRoot, "drizzle", name), "utf8");
  const statements = sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => DB.prepare(statement));
  await DB.batch(statements);
}

async function seedFr4(DB) {
  await DB.batch([
    DB.prepare(`
      INSERT INTO material_categories(
        id, category_code, category_name_cn, category_level, status,
        created_by, created_at, updated_by, updated_at, request_id
      ) VALUES (9001, 'FR4_TEST', 'FR4覆铜板测试', 4, 'ACTIVE', 'test', ?, 'test', ?, 'seed-fr4')
    `).bind(now, now),
    DB.prepare(`
      INSERT INTO material_attribute_definitions(
        id, attribute_code, attribute_name_cn, data_type, decimal_scale,
        canonical_unit, allowed_values_json, normalization_rule, status,
        created_by, created_at, updated_by, updated_at, request_id
      ) VALUES (
        9101, 'THICKNESS', '厚度', 'DECIMAL', 3, 'mm', '[]',
        'DECIMAL_SCALE', 'ACTIVE', 'test', ?, 'test', ?, 'seed-fr4'
      )
    `).bind(now, now),
    DB.prepare(`
      INSERT INTO material_category_attributes(
        id, category_id, attribute_definition_id, is_required,
        is_unique_key_component, is_searchable, sort_order, status,
        created_by, created_at, updated_by, updated_at, request_id
      ) VALUES (
        9201, 9001, 9101, 1, 1, 1, 10, 'ACTIVE',
        'test', ?, 'test', ?, 'seed-fr4'
      )
    `).bind(now, now),
    DB.prepare(`
      INSERT INTO material_code_rules(
        id, rule_code, rule_name, category_id, prefix, major_segment,
        minor_segment, separator, sequence_width, next_sequence, status,
        effective_from, effective_to, version, approved_by, approved_at,
        created_by, created_at, updated_by, updated_at, request_id
      ) VALUES (
        9301, 'FR4-CODE-TEST', 'FR4测试编码', 9001, 'CYD', 'PCB',
        'FR4', '-', 6, 1, 'ACTIVE', '2026-01-01', NULL, 1,
        'approver', ?, 'test', ?, 'test', ?, 'seed-fr4'
      )
    `).bind(now, now, now),
  ]);
}

async function fixture() {
  databaseSequence += 1;
  const mf = new Miniflare({
    modules: true,
    script: "export default {}",
    compatibilityDate: "2026-05-22",
    d1Databases: { DB: `local-material-master-service-${databaseSequence}` },
  });
  let DB;
  try {
    ({ DB } = await mf.getBindings());
    await applyMigration(DB, "0000_far_nightmare.sql");
    await applyMigration(DB, "0001_material_master_v2.sql");
    await applyMigration(DB, "0002_material_draft_review_api.sql");
    await applyMigration(DB, "0003_material_draft_lifecycle.sql");
    await seedFr4(DB);
  } catch (error) {
    await mf.dispose();
    throw error;
  }

  const repository = createD1MaterialMasterRepository(DB);
  const validationService = createMaterialValidationService(
    createD1MaterialValidationRepository(DB),
  );
  const clock = () => new Date(now);
  const draftService = createMaterialDraftService({ repository, validationService, clock });
  const reviewService = createMaterialReviewService({ repository, validationService, clock });

  return {
    DB,
    mf,
    repository,
    validationService,
    clock,
    draftService,
    reviewService,
  };
}

let requestSequence = 0;

function draftCommand(attributes = { THICKNESS: { value: 1.6, unit: "mm" } }) {
  requestSequence += 1;
  return {
    basic_fields: {
      category_id: 9001,
      standard_name: "普通 FR4 覆铜板",
      unit: "PCS",
      brand: "KINGBOARD",
      manufacturer: "KINGBOARD",
      manufacturer_part_number: "KB-6160",
      procurement_type: "PURCHASE",
      inventory_type: "STOCKED",
      lot_control_required: true,
      shelf_life_days: 365,
      inspection_type: "NORMAL",
      environmental_requirement: "ROHS",
      source_ref: `request:MMR-${String(requestSequence).padStart(6, "0")}`,
    },
    attributes,
    source_type: "MANUAL",
    context: {
      actor: "creator",
      request_id: `create-${requestSequence}`,
    },
  };
}

function reviewCommand(materialId, version, suffix, reason = "审核确认") {
  return {
    material_id: materialId,
    expected_version: version,
    reason,
    context: {
      actor: `reviewer-${suffix}`,
      request_id: `review-${suffix}`,
    },
  };
}

async function submitForReview(context, draft, suffix = "submit") {
  return (await context.draftService.submitDraft({
    material_id: draft.id,
    expected_version: draft.version,
    submit_comment: "提交审核",
    context: { actor: "creator", request_id: `submit-${suffix}` },
  })).material;
}

async function counts(DB) {
  return DB.prepare(`
    SELECT
      (SELECT count(*) FROM material_master) AS materials,
      (SELECT count(*) FROM material_attribute_values) AS attributes,
      (SELECT count(*) FROM material_versions) AS versions,
      (SELECT count(*) FROM material_change_logs) AS logs
  `).first();
}

function errorCode(code, validationCode) {
  return (error) => {
    assert.equal(error?.code, code);
    if (validationCode) {
      assert.ok(error.validation?.errors.some((issue) => issue.code === validationCode));
    }
    return true;
  };
}

function barrierCodeService(realCodeService, expectedArrivals = 2) {
  let arrivals = 0;
  let release;
  const gate = new Promise((resolveGate) => {
    release = resolveGate;
  });
  const timeout = setTimeout(() => release(), 2_000);
  return {
    async activateDraft(...args) {
      arrivals += 1;
      if (arrivals === expectedArrivals) {
        clearTimeout(timeout);
        release();
      }
      await gate;
      return realCodeService.activateDraft(...args);
    },
  };
}

function codeRuleBarrierRepository(repository) {
  let initialReads = 0;
  let conflictCount = 0;
  let release;
  const gate = new Promise((resolveGate) => {
    release = resolveGate;
  });

  return {
    repository: {
      async getApplicableCodeRules(...args) {
        const rules = await repository.getApplicableCodeRules(...args);
        if (initialReads < 2) {
          initialReads += 1;
          if (initialReads === 2) release();
          await gate;
        }
        return rules;
      },
      materialCodeExists: (...args) => repository.materialCodeExists(...args),
      advanceOccupiedCodeSequence: (...args) => repository.advanceOccupiedCodeSequence(...args),
      async approveDraftWithCode(...args) {
        try {
          return await repository.approveDraftWithCode(...args);
        } catch (error) {
          if (error?.kind === "CODE_DUPLICATE" || error?.kind === "CODE_SEQUENCE_CONFLICT") {
            conflictCount += 1;
          }
          throw error;
        }
      },
    },
    get conflictCount() {
      return conflictCount;
    },
  };
}

async function insertActiveMaterial(DB, code) {
  await DB.prepare(`
    INSERT INTO material_master(
      id, internal_material_code, standard_name, category_id, base_uom,
      material_status, procurement_type, inventory_type, inspection_type,
      environmental_requirement, source_type, source_ref, version, last_modified_by,
      approved_by, approved_at, created_by, created_at, updated_by,
      updated_at, request_id
    ) VALUES (
      8000, ?, '既有正式物料', 9001, 'PCS',
      'ACTIVE', 'PURCHASE', 'STOCKED', 'NORMAL', 'ROHS', 'MANUAL',
      'request:existing', 1, 'creator', 'approver', ?, 'creator', ?, 'creator', ?, 'existing'
    )
  `).bind(code, now, now, now).run();
}

test("creates a valid FR4 draft without a formal code", { timeout: 15_000 }, async () => {
    const context = await fixture();
    try {
      const result = await context.draftService.createDraft(draftCommand());
      assert.equal(result.validation.valid, true);
      assert.equal(result.material.materialStatus, "DRAFT");
      assert.equal(result.material.internalMaterialCode, null);
      assert.equal(result.material.version, 1);
      assert.equal(result.material.attributes[0].attributeCode, "THICKNESS");
      assert.equal(result.material.attributes[0].value, 1.6);

      const attribute = await context.DB.prepare(`
        SELECT value_decimal_scaled, normalized_value, unit_code, source_type,
               source_ref, created_by, created_at
        FROM material_attribute_values
        WHERE material_id = ?
      `).bind(result.material.id).first();
      assert.deepEqual(attribute, {
        value_decimal_scaled: 1600,
        normalized_value: "1.600",
        unit_code: "mm",
        source_type: "MANUAL",
        source_ref: result.material.fields.sourceRef,
        created_by: "creator",
        created_at: now,
      });

      const actions = await context.DB.prepare(`
        SELECT change_type, field_name
        FROM material_change_logs
        WHERE material_id = ?
        ORDER BY id
      `).bind(result.material.id).all();
      assert.deepEqual(actions.results, [{ change_type: "CREATE", field_name: "CREATE_DRAFT" }]);
    } finally {
      await context.mf.dispose();
    }
  });

test("does not create a draft when FR4 thickness is missing", { timeout: 15_000 }, async () => {
    const context = await fixture();
    try {
      const before = await counts(context.DB);
      await assert.rejects(
        () => context.draftService.createDraft(draftCommand({})),
        errorCode("MATERIAL_CREATE_VALIDATION_FAILED", "MATERIAL_ATTRIBUTE_REQUIRED"),
      );
      assert.deepEqual(await counts(context.DB), before);
    } finally {
      await context.mf.dispose();
    }
  });

test("revalidates create input against the storage metadata snapshot", { timeout: 15_000 }, async () => {
    const context = await fixture();
    try {
      let changed = false;
      const racingValidation = {
        async validateForCreate(input) {
          const result = await context.validationService.validateForCreate(input);
          if (!changed) {
            changed = true;
            await context.DB.prepare(`
              UPDATE material_attribute_definitions
              SET canonical_unit = 'kg'
              WHERE id = 9101
            `).run();
          }
          return result;
        },
        validateForReview: (input) => context.validationService.validateForReview(input),
      };
      const racingDraft = createMaterialDraftService({
        repository: context.repository,
        validationService: racingValidation,
        clock: context.clock,
      });

      await assert.rejects(
        () => racingDraft.createDraft(draftCommand()),
        errorCode(
          "MATERIAL_CREATE_VALIDATION_FAILED",
          "MATERIAL_ATTRIBUTE_UNIT_INCOMPATIBLE",
        ),
      );
      assert.deepEqual(await counts(context.DB), {
        materials: 0,
        attributes: 0,
        versions: 0,
        logs: 0,
      });
    } finally {
      await context.mf.dispose();
    }
  });

test("rolls back draft creation when metadata changes after create validation", { timeout: 15_000 }, async () => {
    const context = await fixture();
    try {
      let changed = false;
      const racingRepository = {
        getAttributeStorageDefinitions: (categoryId) =>
          context.repository.getAttributeStorageDefinitions(categoryId),
        async createDraft(input) {
          if (!changed) {
            changed = true;
            await context.DB.prepare(`
              UPDATE material_categories
              SET status = 'INACTIVE'
              WHERE id = ?
            `).bind(input.fields.categoryId).run();
          }
          return context.repository.createDraft(input);
        },
      };
      const racingDraft = createMaterialDraftService({
        repository: racingRepository,
        validationService: context.validationService,
        clock: context.clock,
      });

      await assert.rejects(
        () => racingDraft.createDraft(draftCommand()),
        errorCode("MATERIAL_WRITE_FAILED"),
      );
      assert.deepEqual(await counts(context.DB), {
        materials: 0,
        attributes: 0,
        versions: 0,
        logs: 0,
      });
    } finally {
      await context.mf.dispose();
    }
  });

test("revalidates persisted attributes before approval", { timeout: 15_000 }, async () => {
    const context = await fixture();
    try {
      const created = (await context.draftService.createDraft(draftCommand())).material;
      const draft = await submitForReview(context, created, "revalidate");
      await context.DB.prepare(`
        UPDATE material_attribute_definitions
        SET canonical_unit = 'kg'
        WHERE id = 9101
      `).run();

      await assert.rejects(
        () => context.reviewService.approveDraft(reviewCommand(draft.id, 2, "revalidate")),
        errorCode(
          "MATERIAL_REVIEW_VALIDATION_FAILED",
          "MATERIAL_ATTRIBUTE_UNIT_INCOMPATIBLE",
        ),
      );
      const stored = await context.repository.getMaterialForReview(draft.id);
      assert.equal(stored.materialStatus, "PENDING_REVIEW");
      assert.equal(stored.version, 2);
      const rule = await context.DB.prepare(
        "SELECT next_sequence FROM material_code_rules WHERE id = 9301",
      ).first();
      assert.equal(rule.next_sequence, 1);
    } finally {
      await context.mf.dispose();
    }
  });

test("blocks metadata changes that race after review validation", { timeout: 15_000 }, async () => {
    const context = await fixture();
    try {
      const created = (await context.draftService.createDraft(draftCommand())).material;
      const draft = await submitForReview(context, created, "metadata-race");
      const racingValidation = {
        validateForCreate: (input) => context.validationService.validateForCreate(input),
        async validateForReview(input) {
          const result = await context.validationService.validateForReview(input);
          assert.equal(result.valid, true);
          await context.DB.prepare(`
            UPDATE material_attribute_definitions
            SET canonical_unit = 'kg'
            WHERE id = 9101
          `).run();
          return result;
        },
      };
      const racingReview = createMaterialReviewService({
        repository: context.repository,
        validationService: racingValidation,
        clock: context.clock,
      });

      await assert.rejects(
        () => racingReview.approveDraft(reviewCommand(draft.id, 2, "metadata-race")),
        errorCode("MATERIAL_VERSION_CONFLICT"),
      );
      const stored = await context.repository.getMaterialForReview(draft.id);
      assert.equal(stored.materialStatus, "PENDING_REVIEW");
      assert.equal(stored.version, 2);
      const rule = await context.DB.prepare(
        "SELECT next_sequence, version FROM material_code_rules WHERE id = 9301",
      ).first();
      assert.deepEqual(rule, { next_sequence: 1, version: 1 });
    } finally {
      await context.mf.dispose();
    }
  });

test("approves a draft and atomically generates the formal code", { timeout: 15_000 }, async () => {
    const context = await fixture();
    try {
      const created = (await context.draftService.createDraft(draftCommand())).material;
      const draft = await submitForReview(context, created, "approve");
      const approved = await context.reviewService.approveDraft(
        reviewCommand(draft.id, draft.version, "approve"),
      );
      assert.equal(approved.material.materialStatus, "ACTIVE");
      assert.equal(approved.material.internalMaterialCode, "CYD-PCB-FR4-000001");
      assert.equal(approved.material.version, 3);
      assert.equal(approved.material.approvedBy, "reviewer-approve");

      const rule = await context.DB.prepare(
        "SELECT next_sequence, version FROM material_code_rules WHERE id = 9301",
      ).first();
      assert.deepEqual(rule, { next_sequence: 2, version: 2 });

      const versions = await context.DB.prepare(`
        SELECT event_type, version_no FROM material_versions
        WHERE material_id = ? ORDER BY version_no
      `).bind(draft.id).all();
      assert.deepEqual(versions.results, [
        { event_type: "CREATE", version_no: 1 },
        { event_type: "SUBMIT", version_no: 2 },
        { event_type: "APPROVE", version_no: 3 },
      ]);

      const actions = await context.DB.prepare(`
        SELECT change_type, field_name FROM material_change_logs
        WHERE material_id = ? ORDER BY id
      `).bind(draft.id).all();
      assert.deepEqual(actions.results, [
        { change_type: "CREATE", field_name: "CREATE_DRAFT" },
        { change_type: "STATUS_CHANGE", field_name: "material_status" },
        { change_type: "APPROVAL", field_name: "APPROVE" },
        { change_type: "CODE_ASSIGNMENT", field_name: "CODE_GENERATE" },
      ]);
    } finally {
      await context.mf.dispose();
    }
  });

test("rolls back the whole approval batch when a later audit write fails", { timeout: 15_000 }, async () => {
    const context = await fixture();
    try {
      const created = (await context.draftService.createDraft(draftCommand())).material;
      const draft = await submitForReview(context, created, "rollback");
      await context.DB.prepare(`
        CREATE TRIGGER fail_code_generate_audit
        BEFORE INSERT ON material_change_logs
        WHEN NEW.field_name = 'CODE_GENERATE'
        BEGIN
          SELECT RAISE(ABORT, 'injected audit failure');
        END
      `).run();

      await assert.rejects(
        () => context.reviewService.approveDraft(reviewCommand(draft.id, 2, "rollback")),
        errorCode("MATERIAL_WRITE_FAILED"),
      );
      const stored = await context.repository.getMaterialForReview(draft.id);
      assert.equal(stored.materialStatus, "PENDING_REVIEW");
      assert.equal(stored.internalMaterialCode, null);
      assert.equal(stored.version, 2);
      const rule = await context.DB.prepare(
        "SELECT next_sequence, version FROM material_code_rules WHERE id = 9301",
      ).first();
      assert.deepEqual(rule, { next_sequence: 1, version: 1 });
      const versions = await context.DB.prepare(`
        SELECT event_type, version_no FROM material_versions
        WHERE material_id = ? ORDER BY version_no
      `).bind(draft.id).all();
      assert.deepEqual(versions.results, [
        { event_type: "CREATE", version_no: 1 },
        { event_type: "SUBMIT", version_no: 2 },
      ]);
      const logs = await context.DB.prepare(`
        SELECT change_type, field_name FROM material_change_logs
        WHERE material_id = ? ORDER BY id
      `).bind(draft.id).all();
      assert.deepEqual(logs.results, [
        { change_type: "CREATE", field_name: "CREATE_DRAFT" },
        { change_type: "STATUS_CHANGE", field_name: "material_status" },
      ]);
    } finally {
      await context.mf.dispose();
    }
  });

test("rejects a draft without consuming a code", { timeout: 15_000 }, async () => {
    const context = await fixture();
    try {
      const created = (await context.draftService.createDraft(draftCommand())).material;
      const draft = await submitForReview(context, created, "reject");
      const rejected = await context.reviewService.rejectDraft(
        reviewCommand(draft.id, draft.version, "reject", "厚度证明不足"),
      );
      assert.equal(rejected.materialStatus, "DRAFT");
      assert.equal(rejected.internalMaterialCode, null);
      assert.equal(rejected.version, 3);

      const rule = await context.DB.prepare(
        "SELECT next_sequence FROM material_code_rules WHERE id = 9301",
      ).first();
      assert.equal(rule.next_sequence, 1);
      const versions = await context.DB.prepare(`
        SELECT event_type, version_no FROM material_versions
        WHERE material_id = ? ORDER BY version_no
      `).bind(draft.id).all();
      assert.deepEqual(versions.results, [
        { event_type: "CREATE", version_no: 1 },
        { event_type: "SUBMIT", version_no: 2 },
        { event_type: "REJECT", version_no: 3 },
      ]);
      const logs = await context.DB.prepare(`
        SELECT change_type, field_name, change_reason FROM material_change_logs
        WHERE material_id = ? ORDER BY id
      `).bind(draft.id).all();
      assert.deepEqual(logs.results, [
        { change_type: "CREATE", field_name: "CREATE_DRAFT", change_reason: "" },
        { change_type: "STATUS_CHANGE", field_name: "material_status", change_reason: "提交审核" },
        { change_type: "REJECTION", field_name: "REJECT", change_reason: "厚度证明不足" },
      ]);
    } finally {
      await context.mf.dispose();
    }
  });

test("allows only one of two concurrent approvals for the same draft", { timeout: 15_000 }, async () => {
    const context = await fixture();
    try {
      const created = (await context.draftService.createDraft(draftCommand())).material;
      const draft = await submitForReview(context, created, "concurrent");
      const codeService = barrierCodeService(createMaterialCodeService(context.repository));
      const reviewA = createMaterialReviewService({
        repository: context.repository,
        validationService: context.validationService,
        codeService,
        clock: context.clock,
      });
      const reviewB = createMaterialReviewService({
        repository: context.repository,
        validationService: context.validationService,
        codeService,
        clock: context.clock,
      });

      const outcomes = await Promise.allSettled([
        reviewA.approveDraft(reviewCommand(draft.id, 2, "concurrent-a")),
        reviewB.approveDraft(reviewCommand(draft.id, 2, "concurrent-b")),
      ]);
      assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
      const rejected = outcomes.find((outcome) => outcome.status === "rejected");
      assert.equal(rejected.reason.code, "MATERIAL_VERSION_CONFLICT");

      const stored = await context.repository.getMaterialForReview(draft.id);
      assert.equal(stored.materialStatus, "ACTIVE");
      assert.equal(stored.internalMaterialCode, "CYD-PCB-FR4-000001");
      const codeLogs = await context.DB.prepare(`
        SELECT count(*) AS count FROM material_change_logs
        WHERE material_id = ? AND field_name = 'CODE_GENERATE'
      `).bind(draft.id).first();
      assert.equal(codeLogs.count, 1);
    } finally {
      await context.mf.dispose();
    }
  });

test("allocates different codes to concurrent drafts using one rule", { timeout: 15_000 }, async () => {
    const context = await fixture();
    try {
      const firstCreated = (await context.draftService.createDraft(draftCommand())).material;
      const secondCreated = (await context.draftService.createDraft(draftCommand())).material;
      const first = await submitForReview(context, firstCreated, "rule-a");
      const second = await submitForReview(context, secondCreated, "rule-b");
      const barrierRepository = codeRuleBarrierRepository(context.repository);
      const codeService = createMaterialCodeService(barrierRepository.repository);
      const reviewA = createMaterialReviewService({
        repository: context.repository,
        validationService: context.validationService,
        codeService,
        clock: context.clock,
      });
      const reviewB = createMaterialReviewService({
        repository: context.repository,
        validationService: context.validationService,
        codeService,
        clock: context.clock,
      });
      const results = await Promise.all([
        reviewA.approveDraft(reviewCommand(first.id, 2, "rule-a")),
        reviewB.approveDraft(reviewCommand(second.id, 2, "rule-b")),
      ]);
      const codes = results.map((result) => result.material.internalMaterialCode).sort();
      assert.deepEqual(codes, ["CYD-PCB-FR4-000001", "CYD-PCB-FR4-000002"]);
      assert.equal(new Set(codes).size, 2);
      const rule = await context.DB.prepare(
        "SELECT next_sequence FROM material_code_rules WHERE id = 9301",
      ).first();
      assert.equal(rule.next_sequence, 3);
      assert.ok(barrierRepository.conflictCount >= 1);
    } finally {
      await context.mf.dispose();
    }
  });

test("skips an already occupied code instead of generating a duplicate", { timeout: 15_000 }, async () => {
    const context = await fixture();
    try {
      const created = (await context.draftService.createDraft(draftCommand())).material;
      const draft = await submitForReview(context, created, "occupied");
      let injected = false;
      const racingRepository = {
        getApplicableCodeRules: (...args) => context.repository.getApplicableCodeRules(...args),
        materialCodeExists: (...args) => context.repository.materialCodeExists(...args),
        advanceOccupiedCodeSequence: (...args) =>
          context.repository.advanceOccupiedCodeSequence(...args),
        async approveDraftWithCode(input) {
          if (!injected) {
            injected = true;
            await insertActiveMaterial(context.DB, input.code);
          }
          return context.repository.approveDraftWithCode(input);
        },
      };
      const racingReview = createMaterialReviewService({
        repository: context.repository,
        validationService: context.validationService,
        codeService: createMaterialCodeService(racingRepository),
        clock: context.clock,
      });

      const approved = await racingReview.approveDraft(
        reviewCommand(draft.id, 2, "occupied"),
      );
      assert.equal(injected, true);
      assert.equal(approved.material.internalMaterialCode, "CYD-PCB-FR4-000002");
      const codes = await context.DB.prepare(`
        SELECT internal_material_code FROM material_master
        WHERE internal_material_code IS NOT NULL
        ORDER BY internal_material_code
      `).all();
      assert.deepEqual(codes.results, [
        { internal_material_code: "CYD-PCB-FR4-000001" },
        { internal_material_code: "CYD-PCB-FR4-000002" },
      ]);
      const rule = await context.DB.prepare(
        "SELECT next_sequence FROM material_code_rules WHERE id = 9301",
      ).first();
      assert.equal(rule.next_sequence, 3);
    } finally {
      await context.mf.dispose();
    }
  });
