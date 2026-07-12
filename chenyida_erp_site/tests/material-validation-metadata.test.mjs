import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";

import {
  createD1MaterialValidationRepository,
  createMaterialValidationService,
} from "../app/lib/material-validation/index.ts";

const siteRoot = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));

async function applyMigration(DB, name) {
  const sql = await readFile(join(siteRoot, "drizzle", name), "utf8");
  const statements = sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => DB.prepare(statement));
  await DB.batch(statements);
}

function request(attributes = {}) {
  return {
    category_id: 9001,
    basic_fields: {
      standard_name: "隔离 metadata 测试物料",
      unit: "KG",
      source_type: "MANUAL",
    },
    attributes,
  };
}

const codes = (result) => result.errors.map((entry) => entry.code);

test("D1 repository reflects active status, required and enum metadata changes without seed or cache", { timeout: 120_000 }, async () => {
  const mf = new Miniflare({
    modules: true,
    script: "export default {}",
    compatibilityDate: "2026-05-22",
    d1Databases: { DB: "local-material-validation-metadata" },
  });

  try {
    const { DB } = await mf.getBindings();
    await applyMigration(DB, "0000_far_nightmare.sql");
    await applyMigration(DB, "0001_material_master_v2.sql");

    const now = "2026-07-12T00:00:00.000Z";
    await DB.batch([
      DB.prepare(`
        INSERT INTO material_categories(
          id, category_code, category_name_cn, category_level, status,
          created_by, created_at, updated_by, updated_at, request_id
        ) VALUES (?, ?, ?, 4, 'ACTIVE', ?, ?, ?, ?, ?)
      `).bind(9001, "TEST_PASTE", "测试锡膏", "test", now, "test", now, "test-metadata"),
      DB.prepare(`
        INSERT INTO material_attribute_definitions(
          id, attribute_code, attribute_name_cn, data_type, canonical_unit,
          allowed_values_json, normalization_rule, status,
          created_by, created_at, updated_by, updated_at, request_id
        ) VALUES (?, ?, ?, 'ENUM', '', ?, 'ENUM_CODE', 'ACTIVE', ?, ?, ?, ?, ?)
      `).bind(9101, "ALLOY", "合金", JSON.stringify(["SAC305"]), "test", now, "test", now, "test-metadata"),
      DB.prepare(`
        INSERT INTO material_attribute_definitions(
          id, attribute_code, attribute_name_cn, data_type, decimal_scale, canonical_unit,
          allowed_values_json, normalization_rule, status,
          created_by, created_at, updated_by, updated_at, request_id
        ) VALUES (?, ?, ?, 'DECIMAL', 3, 'kg', '[]', 'DECIMAL_SCALE', 'ACTIVE', ?, ?, ?, ?, ?)
      `).bind(9102, "WEIGHT", "重量", "test", now, "test", now, "test-metadata"),
      DB.prepare(`
        INSERT INTO material_category_attributes(
          id, category_id, attribute_definition_id, is_required, sort_order, status,
          created_by, created_at, updated_by, updated_at, request_id
        ) VALUES (?, ?, ?, 0, 10, 'ACTIVE', ?, ?, ?, ?, ?)
      `).bind(9201, 9001, 9101, "test", now, "test", now, "test-metadata"),
      DB.prepare(`
        INSERT INTO material_category_attributes(
          id, category_id, attribute_definition_id, is_required, sort_order, status,
          created_by, created_at, updated_by, updated_at, request_id
        ) VALUES (?, ?, ?, 0, 20, 'ACTIVE', ?, ?, ?, ?, ?)
      `).bind(9202, 9001, 9102, "test", now, "test", now, "test-metadata"),
    ]);

    const service = createMaterialValidationService(createD1MaterialValidationRepository(DB));

    const validAttributes = {
      ALLOY: { value: "SAC305" },
      WEIGHT: { value: 0.5, unit: "kg" },
    };
    const initial = await service.validateForCreate(request(validAttributes));
    assert.equal(initial.valid, true);
    assert.deepEqual(initial.errors, []);
    assert.deepEqual(initial.warnings, []);

    await DB.prepare("UPDATE material_attribute_definitions SET canonical_unit = 'g' WHERE id = ?")
      .bind(9102)
      .run();
    const changedUnit = await service.validateForCreate(request(validAttributes));
    assert.deepEqual(codes(changedUnit), ["MATERIAL_ATTRIBUTE_UNIT_INCOMPATIBLE"]);

    await DB.prepare("UPDATE material_attribute_definitions SET canonical_unit = 'kg' WHERE id = ?")
      .bind(9102)
      .run();

    await DB.prepare("UPDATE material_attribute_definitions SET allowed_values_json = ? WHERE id = ?")
      .bind(JSON.stringify(["SAC0307"]), 9101)
      .run();
    const changedEnum = await service.validateForCreate(request(validAttributes));
    assert.deepEqual(codes(changedEnum), ["MATERIAL_ATTRIBUTE_ENUM_INVALID"]);

    await DB.prepare("UPDATE material_category_attributes SET is_required = 1 WHERE id = ?")
      .bind(9201)
      .run();
    const changedRequired = await service.validateForCreate(request({ WEIGHT: { value: 0.5, unit: "kg" } }));
    assert.deepEqual(codes(changedRequired), ["MATERIAL_ATTRIBUTE_REQUIRED"]);

    await DB.prepare("UPDATE material_attribute_definitions SET status = 'INACTIVE' WHERE id = ?")
      .bind(9101)
      .run();
    const inactiveDefinition = await service.validateForCreate(request(validAttributes));
    assert.deepEqual(codes(inactiveDefinition), ["MATERIAL_ATTRIBUTE_NOT_BOUND"]);

    await DB.prepare("UPDATE material_category_attributes SET status = 'INACTIVE' WHERE id = ?")
      .bind(9201)
      .run();
    await DB.prepare("UPDATE material_category_attributes SET status = 'INACTIVE' WHERE id = ?")
      .bind(9202)
      .run();
    const inactiveBinding = await service.validateForCreate(request());
    assert.deepEqual(codes(inactiveBinding), ["MATERIAL_CATEGORY_RULES_MISSING"]);

    await DB.prepare("UPDATE material_categories SET status = 'INACTIVE' WHERE id = ?")
      .bind(9001)
      .run();
    const inactiveCategory = await service.validateForReview(request());
    assert.deepEqual(codes(inactiveCategory), ["MATERIAL_CATEGORY_INACTIVE"]);
  } finally {
    await mf.dispose();
  }
});
