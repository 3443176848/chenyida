import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { PostgresMaterialGovernanceRepository } from "../app/lib/material-governance-selfhost/repository.ts";
import { MaterialGovernanceService } from "../app/lib/material-governance-selfhost/service.ts";
import { PostgresMaterialRepository } from "../app/lib/material-selfhost/repository.ts";
import { MaterialWorkflowService } from "../app/lib/material-selfhost/service.ts";

const databaseUrl = process.env.TEST_MATERIAL_GOVERNANCE_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("isolated TEST_MATERIAL_GOVERNANCE_DATABASE_URL or TEST_DATABASE_URL is required");
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
if (!/(?:^|[-_])(test|testing)(?:[-_]|$)|task\d+/i.test(databaseName)) {
  throw new Error("material governance integration tests require an explicitly isolated test database name");
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 4,
  application_name: "material-governance-integration-test",
});
const service = new MaterialGovernanceService(new PostgresMaterialGovernanceRepository(pool));
const workflow = new MaterialWorkflowService(new PostgresMaterialRepository(pool));
const actor = {
  username: "governor1",
  must_change_password: false,
  permissions: [
    "material.import.read_any",
    "material.import.governance.read",
    "material.import.governance.run",
    "material.import.governance.decide",
    "material.import.governance.bind",
    "material.import.governance.create_draft",
    "material.draft.create",
    "material.draft.edit_own",
    "material.draft.submit",
  ],
};
const reviewer = {
  username: "reviewer1",
  must_change_password: false,
  permissions: ["material.review.reject"],
};
const approver = {
  username: "approver1",
  must_change_password: false,
  permissions: ["material.review.approve"],
};
const page = { afterId: 0, limit: 50 };

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function context(routeScope, idempotencyKey, body, requestId = randomUUID()) {
  return {
    actor,
    requestId,
    idempotencyKey,
    requestDigest: sha256(JSON.stringify(body)),
    routeScope,
  };
}

function workflowContext(workflowActor, routeScope, idempotencyKey, body) {
  return {
    actor: workflowActor,
    requestId: randomUUID(),
    idempotencyKey,
    requestDigest: sha256(JSON.stringify(body)),
    routeScope,
  };
}

function rawRow(fields) {
  return {
    schema_version: 1,
    source_column_count: Object.keys(fields).length,
    fields,
  };
}

async function reset() {
  await pool.query(`
    truncate
      material_governance_events,material_governance_material_links,material_governance_decisions,
      material_governance_alternative_candidates,material_governance_material_candidates,
      material_governance_specs,material_governance_rows,material_governance_groups,material_governance_runs,
      material_api_idempotency,audit_log,
      material_import_normalized_field_candidates,material_import_normalized_attribute_candidates,
      material_import_normalization_lineage,material_import_normalization_issues,
      material_import_normalized_rows,material_import_normalization_runs,
      material_import_mapping_items,material_import_mappings,material_import_rows,
      material_import_parse_sheets,material_import_parse_runs,material_import_files,material_import_batches,
      material_attribute_values,material_master,material_category_attributes,
      material_attribute_definitions,material_categories,app_sessions,app_users
    restart identity cascade
  `);
}

async function seedActiveResistor(categoryId, definitions, values, internalMaterialCode, standardName, basic = {}) {
  const inserted = await pool.query(`
    insert into material_master(
      internal_material_code,standard_name,category_id,brand,manufacturer,manufacturer_part_number,
      base_uom,material_status,procurement_type,inventory_type,lot_control_required,shelf_life_days,
      inspection_type,environmental_requirement,source_type,source_ref,version,last_modified_by,
      approved_by,approved_at,created_by,updated_by,request_id
    ) values($1,$2,$3,$5,$6,$7,'PCS','ACTIVE','PURCHASE','STOCKED',false,null,
      'NORMAL','ROHS','MANUAL','governance-integration-fixture',1,'governor1',
      'governor1',now(),'governor1','governor1',$4)
    returning id
  `, [
    internalMaterialCode,
    standardName,
    categoryId,
    randomUUID(),
    basic.brand ?? "",
    basic.manufacturer ?? "",
    basic.manufacturerPartNumber ?? "",
  ]);
  const materialId = Number(inserted.rows[0].id);
  for (const [code, normalizedValue] of Object.entries(values)) {
    const definition = definitions.get(code);
    assert.ok(definition, `missing seeded definition ${code}`);
    const jsonValue = definition.dataType === "DECIMAL" ? JSON.stringify(Number(normalizedValue)) : JSON.stringify(normalizedValue);
    await pool.query(`
      insert into material_attribute_values(
        material_id,attribute_definition_id,value,normalized_value,unit_code,source_type,source_ref,
        created_by,updated_by,request_id
      ) values($1,$2,$3::jsonb,$4,$5,'MANUAL','governance-integration-fixture','governor1','governor1',$6)
    `, [materialId, definition.id, jsonValue, normalizedValue, definition.unit, randomUUID()]);
  }
  return materialId;
}

async function seedMasterData() {
  await pool.query(`
    insert into app_users(username,display_name,role,password_hash,is_active,must_change_password,version)
    values
      ('governor1','治理测试员','manager','test-only',true,false,1),
      ('reviewer1','治理复核员','manager','test-only',true,false,1),
      ('approver1','治理审批员','manager','test-only',true,false,1)
  `);
  const requestId = randomUUID();
  await pool.query(`
    insert into material_categories(
      id,category_code,category_name_cn,parent_id,category_level,status,sort_order,
      created_by,updated_by,request_id
    ) values
      (97001,'ELECTRONIC_GOV_TEST','电子元件',null,1,'ACTIVE',1,'governor1','governor1',$1),
      (97002,'PASSIVE_GOV_TEST','被动元件',97001,2,'ACTIVE',1,'governor1','governor1',$1),
      (97003,'RESISTOR_GOV_TEST','电阻',97002,3,'ACTIVE',1,'governor1','governor1',$1),
      (97004,'RES_CHIP','贴片电阻',97003,4,'ACTIVE',1,'governor1','governor1',$1),
      (97005,'SEMICONDUCTOR_GOV_TEST','半导体',97001,2,'ACTIVE',2,'governor1','governor1',$1),
      (97006,'IC_GOV_TEST','IC',97005,3,'ACTIVE',1,'governor1','governor1',$1),
      (97007,'IC_SOT','SOT/SC 封装 IC',97006,4,'ACTIVE',1,'governor1','governor1',$1),
      (97013,'IC_BGA','BGA 封装 IC',97006,4,'ACTIVE',2,'governor1','governor1',$1),
      (97014,'IC_QFN','QFN 封装 IC',97006,4,'ACTIVE',3,'governor1','governor1',$1),
      (97008,'CAPACITOR_GOV_TEST','电容',97002,3,'ACTIVE',2,'governor1','governor1',$1),
      (97009,'CAP_CHIP','贴片电容',97008,4,'ACTIVE',1,'governor1','governor1',$1),
      (97010,'CONNECTOR_GOV_TEST','连接器',97001,2,'ACTIVE',3,'governor1','governor1',$1),
      (97011,'CONNECTOR_BOARD_GOV_TEST','板端连接器',97010,3,'ACTIVE',1,'governor1','governor1',$1),
      (97012,'CONN_BOARD_STD','标准板端连接器',97011,4,'ACTIVE',1,'governor1','governor1',$1)
  `, [requestId]);
  const definitionInputs = [
    [97101, "PACKAGE", "封装", "TEXT", 0, ""],
    [97102, "RESISTANCE", "阻值", "DECIMAL", 6, "ohm"],
    [97103, "TOLERANCE", "精度", "DECIMAL", 2, "%"],
    [97104, "POWER", "功率", "DECIMAL", 6, "W"],
    [97105, "MPN", "制造商料号", "TEXT", 0, ""],
    [97106, "CAPACITANCE", "容值", "DECIMAL", 18, "F"],
    [97107, "RATED_VOLTAGE", "额定电压", "DECIMAL", 6, "V"],
    [97108, "DIELECTRIC", "介质", "TEXT", 0, ""],
    [97109, "BRAND", "品牌", "TEXT", 0, ""],
    [97110, "MODEL", "型号", "TEXT", 0, ""],
    [97111, "PIN_COUNT", "针数", "DECIMAL", 0, "pin"],
    [97112, "PITCH", "间距", "DECIMAL", 6, "mm"],
    [97113, "STRUCTURE", "结构", "TEXT", 0, ""],
  ];
  const definitions = new Map();
  for (const [id, code, name, dataType, decimalScale, unit] of definitionInputs) {
    await pool.query(`
      insert into material_attribute_definitions(
        id,attribute_code,attribute_name_cn,data_type,decimal_scale,canonical_unit,allowed_values,
        normalization_rule,status,version,approved_by,approved_at,created_by,updated_by,request_id
      ) values($1,$2,$3,$4,$5,$6,'[]'::jsonb,'GOVERNANCE_TEST_CANONICAL','ACTIVE',1,
        'governor1',now(),'governor1','governor1',$7)
    `, [id, code, name, dataType, decimalScale, unit, randomUUID()]);
    definitions.set(code, { id, unit, dataType });
  }
  const categoryBindings = new Map([
    [97004, ["PACKAGE", "RESISTANCE", "TOLERANCE", "POWER"]],
    [97007, ["MPN", "PACKAGE"]],
    [97013, ["MPN", "PACKAGE"]],
    [97014, ["MPN", "PACKAGE"]],
    [97009, ["PACKAGE", "CAPACITANCE", "RATED_VOLTAGE", "DIELECTRIC", "TOLERANCE"]],
    [97012, ["BRAND", "MODEL", "PIN_COUNT", "PITCH", "STRUCTURE"]],
  ]);
  for (const [categoryId, codes] of categoryBindings) {
    for (const [sortOrder, code] of codes.entries()) {
      const definition = definitions.get(code);
      assert.ok(definition, `missing definition for ${code}`);
    await pool.query(`
      insert into material_category_attributes(
        category_id,attribute_definition_id,is_required,is_unique_key_component,is_searchable,
        sort_order,status,created_by,updated_by,request_id
        ) values($1,$2,true,true,true,$3,'ACTIVE','governor1','governor1',$4)
      `, [categoryId, definition.id, sortOrder, randomUUID()]);
    }
  }
  const exactMaterialId = await seedActiveResistor(
    97004,
    definitions,
    { PACKAGE: "0201", RESISTANCE: "0", TOLERANCE: "5", POWER: "0.05" },
    "CYD-RES_CHIP-990001",
    "0201 0R ±5% 1/20W 贴片电阻",
  );
  const differentMaterialId = await seedActiveResistor(
    97004,
    definitions,
    { PACKAGE: "0201", RESISTANCE: "10000", TOLERANCE: "1", POWER: "0.05" },
    "CYD-RES_CHIP-990002",
    "0201 10K ±1% 1/20W 贴片电阻",
  );
  return { exactMaterialId, differentMaterialId, definitions };
}

async function seedPublishedNormalization() {
  const batchNo = `IMP-GOV-${randomUUID().slice(0, 8)}`;
  const sourceFileDigest = sha256("governance-bom-file");
  const structureDigest = sha256("governance-bom-structure");
  const metadataDigest = sha256("governance-mapping-metadata");
  const mappingDigest = sha256("governance-mapping");
  const normalizationDigest = sha256("governance-normalization-result");
  const batch = await pool.query(`
    insert into material_import_batches(
      batch_no,source_kind,status,created_by,current_version,file_count,total_rows,accepted_rows
    ) values($1,'CSV','NORMALIZING','governor1',7,1,9,9) returning id
  `, [batchNo]);
  const batchId = Number(batch.rows[0].id);
  const file = await pool.query(`
    insert into material_import_files(
      batch_id,storage_name,relative_path,original_filename,mime_type,sha256,size_bytes
    ) values($1,$2,$3,'bom-governance.csv','text/csv',$4,1024) returning id
  `, [batchId, randomUUID(), `test/${randomUUID()}.csv`, sourceFileDigest]);
  const fileId = Number(file.rows[0].id);
  const parse = await pool.query(`
    insert into material_import_parse_runs(
      batch_id,parser_version,run_status,attempt_no,source_file_sha256,current_stage,rows_written,
      parsed_sheet_count,mapping_preparation_status,source_structure_digest,started_at,completed_at
    ) values($1,'governance-test-parser-v1','SUCCEEDED',1,$2,'COMPLETE',9,1,'READY',$3,now(),now())
    returning id
  `, [batchId, sourceFileDigest, structureDigest]);
  const parseRunId = Number(parse.rows[0].id);
  const sheet = await pool.query(`
    insert into material_import_parse_sheets(
      parse_run_id,sheet_index,sheet_name,visibility,parse_status,row_count,source_column_max,warnings
    ) values($1,0,'BOM','VISIBLE','COMPLETED',9,12,'[]'::jsonb) returning id
  `, [parseRunId]);
  const sheetId = Number(sheet.rows[0].id);
  const mapping = await pool.query(`
    insert into material_import_mappings(
      mapping_key,batch_id,parse_run_id,mapping_version,source_kind,selected_sheet_index,
      selected_sheet_name,header_mode,header_row_number,source_structure_digest,source_fields,
      metadata_digest,target_catalog_version,mapping_digest,mapping_snapshot,status,
      created_by,updated_by,confirmed_by,request_id,confirmed_at
    ) values($1,$2,$3,1,'CSV',0,'BOM','NO_HEADER',null,$4,'[]'::jsonb,$5,
      'governance-test-catalog-v1',$6,$7::jsonb,'CONFIRMED','governor1','governor1',
      'governor1',$8,now()) returning id
  `, [
    randomUUID(),
    batchId,
    parseRunId,
    structureDigest,
    metadataDigest,
    mappingDigest,
    JSON.stringify({ schema_version: 1, purpose: "material-governance-integration-test" }),
    randomUUID(),
  ]);
  const mappingId = Number(mapping.rows[0].id);
  const normalization = await pool.query(`
    insert into material_import_normalization_runs(
      batch_id,parse_run_id,mapping_id,source_file_id,source_sheet_id,mapping_version,mapping_digest,
      source_schema_digest,processor_version,normalizer_rule_version,metadata_digest,mapping_snapshot,
      run_version,run_status,expected_version,current_stage,total_rows,processed_rows,valid_rows,
      warning_rows,error_rows,skipped_rows,issue_count,warning_count,error_count,normalized_json_bytes,
      requested_by,started_at
    ) values($1,$2,$3,$4,$5,1,$6,$7,'governance-test-normalizer-v1','governance-test-rules-v1',
      $8,$9::jsonb,1,'PUBLISHING',1,'PUBLISH_RESULT',9,9,8,0,1,0,1,0,1,1024,'governor1',now())
    returning id
  `, [
    batchId,
    parseRunId,
    mappingId,
    fileId,
    sheetId,
    mappingDigest,
    structureDigest,
    metadataDigest,
    JSON.stringify({ schema_version: 1, mapping_id: mappingId }),
  ]);
  const normalizationRunId = Number(normalization.rows[0].id);
  const sources = [
    {
      raw: "0201WMJ0000TCE",
      fields: {
        "category_hint.CATEGORY_HINT": "RES",
        "basic.MANUFACTURER_PART_NUMBER": "0201WMJ0000TCE",
        "basic.STANDARD_NAME": "贴片电阻",
        "basic.DESCRIPTION": "0201 0R ±5% 1/20W 厂商编码",
        "supplier_reference.SUPPLIER_NAME": "供应商甲",
        "supplier_reference.SOURCE_QUANTITY": "10",
        "basic.UNIT": "PCS",
      },
    },
    {
      raw: "0201,0R,±5%",
      fields: {
        "category_hint.CATEGORY_HINT": "RES",
        "supplier_reference.SUPPLIER_ITEM_CODE": "SUP-0201-0R",
        "basic.STANDARD_NAME": "零欧电阻",
        "basic.DESCRIPTION": "0201 零欧 ±5%",
        "supplier_reference.SUPPLIER_NAME": "供应商乙",
        "supplier_reference.SOURCE_QUANTITY": "20",
        "supplier_reference.PURCHASE_UOM": "PCS",
      },
      attributes: {
        PACKAGE: { value: "0201", dataType: "TEXT", unit: "" },
        RESISTANCE: { value: 0, dataType: "DECIMAL", unit: "ohm" },
        TOLERANCE: { value: 5, dataType: "DECIMAL", unit: "%" },
        POWER: { value: 0.05, dataType: "DECIMAL", unit: "W" },
      },
    },
    {
      raw: "0201 0R ±5% 1/20W 品牌甲",
      fields: {
        "category_hint.CATEGORY_HINT": "RES",
        "basic.STANDARD_NAME": "零欧电阻",
        "basic.DESCRIPTION": "0201 0R ±5% 1/20W 品牌甲",
        "basic.BRAND": "BRAND-ONLY-A",
        "supplier_reference.SUPPLIER_SPECIFICATION": "0201 0R ±5% 1/20W",
        "supplier_reference.SOURCE_QUANTITY": "30",
        "basic.UNIT": "PCS",
      },
    },
    {
      raw: "0201 0R ±5% 1/20W 品牌乙",
      fields: {
        "category_hint.CATEGORY_HINT": "RES",
        "basic.STANDARD_NAME": "零欧电阻",
        "basic.DESCRIPTION": "0201 0R ±5% 1/20W 品牌乙",
        "basic.BRAND": "BRAND-ONLY-B",
        "supplier_reference.SUPPLIER_SPECIFICATION": "0201 0R ±5% 1/20W",
        "supplier_reference.SOURCE_QUANTITY": "40",
        "basic.UNIT": "PCS",
      },
    },
    {
      raw: "0201 1uF",
      upstreamError: true,
      fields: {
        "category_hint.CATEGORY_HINT": "CAP",
        "supplier_reference.SUPPLIER_ITEM_CODE": "CAP-0201-1UF",
        "supplier_reference.SUPPLIER_SPECIFICATION": "0201 1uF",
        "supplier_reference.SUPPLIER_NAME": "供应商丙",
        "supplier_reference.SOURCE_QUANTITY": "1",
        "basic.UNIT": "PCS",
      },
    },
    {
      raw: "0201 100pF 6.3V X5R ±10%",
      fields: {
        "category_hint.CATEGORY_HINT": "CAP",
        "supplier_reference.SUPPLIER_ITEM_CODE": "CAP-0201-100PF",
        "supplier_reference.SUPPLIER_SPECIFICATION": "0201 100pF 6.3V X5R ±10%",
        "supplier_reference.SUPPLIER_NAME": "供应商丁",
        "supplier_reference.SOURCE_QUANTITY": "2",
        "basic.UNIT": "PCS",
      },
    },
    {
      raw: "JST B5B-PH-K 5PIN 2.0mm 立式",
      fields: {
        "category_hint.CATEGORY_HINT": "CON",
        "basic.SPECIFICATION_MODEL": "B5B-PH-K",
        "supplier_reference.SUPPLIER_ITEM_CODE": "JST-SUP-5",
        "supplier_reference.SUPPLIER_SPECIFICATION": "5PIN 2.0mm 立式",
        "basic.BRAND": "JST",
        "supplier_reference.SUPPLIER_NAME": "供应商戊",
        "supplier_reference.SOURCE_QUANTITY": "5",
        "basic.UNIT": "PCS",
      },
    },
    {
      raw: "TPS7A2033PDBVR",
      fields: {
        "category_hint.CATEGORY_HINT": "IC",
        "basic.MANUFACTURER_PART_NUMBER": "TPS7A2033PDBVR",
        "basic.STANDARD_NAME": "低压差稳压芯片",
        "supplier_reference.SUPPLIER_NAME": "供应商庚",
        "supplier_reference.SOURCE_QUANTITY": "3",
        "basic.UNIT": "PCS",
      },
    },
    {
      raw: "MOLEX MOLEX-5P-20 5PIN 2.0mm 立式",
      fields: {
        "category_hint.CATEGORY_HINT": "CON",
        "basic.SPECIFICATION_MODEL": "MOLEX-5P-20",
        "supplier_reference.SUPPLIER_ITEM_CODE": "MOLEX-SUP-5",
        "supplier_reference.SUPPLIER_SPECIFICATION": "5PIN 2.0mm 立式",
        "basic.BRAND": "MOLEX",
        "supplier_reference.SUPPLIER_NAME": "供应商己",
        "supplier_reference.SOURCE_QUANTITY": "6",
        "basic.UNIT": "PCS",
      },
    },
  ];
  const sourceRows = [];
  const normalizedRows = [];
  for (const [index, source] of sources.entries()) {
    const rawValues = rawRow({ original_line: source.raw, ...source.fields });
    const rawHash = sha256(rawValues);
    const insertedSource = await pool.query(`
      insert into material_import_rows(
        batch_id,parse_run_id,job_id,sheet_index,sheet_name,row_number,raw_values,raw_row_hash
      ) values($1,$2,$3,0,'BOM',$4,$5::jsonb,$6) returning id
    `, [batchId, parseRunId, randomUUID(), index + 1, JSON.stringify(rawValues), rawHash]);
    const sourceRowId = Number(insertedSource.rows[0].id);
    const normalizedPayload = { schema_version: 1, fields: source.fields, attributes: source.attributes ?? {} };
    const normalizedHash = sha256(normalizedPayload);
    const insertedNormalized = await pool.query(`
      insert into material_import_normalized_rows(
        batch_id,normalization_run_id,source_row_id,source_sheet_id,source_sheet_index,
        source_sheet_name,source_row_number,source_raw_row_hash,normalized_payload,
        normalized_payload_hash,mapped_values,row_status,review_status,core_candidate_count,
        attribute_candidate_count,issue_count,error_count,warning_count,result_summary
      ) values($1,$2,$3,$4,0,'BOM',$5,$6,$7::jsonb,$8,$9::jsonb,$10,'NEEDS_REVIEW',
        $11,$12,$13,$13,0,'{}'::jsonb) returning id
    `, [
      batchId,
      normalizationRunId,
      sourceRowId,
      sheetId,
      index + 1,
      rawHash,
      JSON.stringify(normalizedPayload),
      normalizedHash,
      JSON.stringify(source.fields),
      source.upstreamError ? "ERROR" : "VALID",
      Object.keys(source.fields).length,
      Object.keys(source.attributes ?? {}).length,
      source.upstreamError ? 1 : 0,
    ]);
    const normalizedRowId = Number(insertedNormalized.rows[0].id);
    sourceRows.push(sourceRowId);
    normalizedRows.push(normalizedRowId);
    for (const [displayOrder, [qualifiedCode, value]] of Object.entries(source.fields).entries()) {
      const separator = qualifiedCode.indexOf(".");
      const namespace = qualifiedCode.slice(0, separator);
      const fieldCode = qualifiedCode.slice(separator + 1);
      await pool.query(`
        insert into material_import_normalized_field_candidates(
          normalization_run_id,normalized_row_id,target_namespace,target_field_code,raw_value,
          normalized_value,value_state,validation_status,transformation_rule_code,
          transformation_rule_version,display_order
        ) values($1,$2,$3,$4,to_jsonb($5::text),to_jsonb($5::text),'PRESENT',$6,
          'GOVERNANCE_TEST_COPY','1',$7)
      `, [
        normalizationRunId,
        normalizedRowId,
        namespace,
        fieldCode,
        value,
        source.upstreamError && qualifiedCode === "supplier_reference.SOURCE_QUANTITY" ? "ERROR" : "VALID",
        displayOrder,
      ]);
    }
    for (const [displayOrder, [attributeCode, attribute]] of Object.entries(source.attributes ?? {}).entries()) {
      await pool.query(`
        insert into material_import_normalized_attribute_candidates(
          normalization_run_id,normalized_row_id,attribute_code,attribute_name_snapshot,data_type,
          raw_value,normalized_value,unit_code,validation_status,transformation_rule_code,
          transformation_rule_version,display_order
        ) values($1,$2,$3,$3,$4,$5::jsonb,$5::jsonb,$6,'VALID','GOVERNANCE_TEST_COPY','1',$7)
      `, [
        normalizationRunId,
        normalizedRowId,
        attributeCode,
        attribute.dataType,
        JSON.stringify(attribute.value),
        attribute.unit,
        displayOrder,
      ]);
    }
    if (source.upstreamError) {
      await pool.query(`
        insert into material_import_normalization_issues(
          normalization_run_id,normalized_row_id,issue_level,issue_code,issue_key,target_code,
          source_sheet_index,source_row_number,source_column_index,safe_message,safe_details,
          source_value_summary,rule_code
        ) values($1,$2,'ERROR','NORMALIZATION_NUMBER_INVALID',$3,
          'supplier_reference.SOURCE_QUANTITY',0,$4,null,'数量字段无法安全归一',
          '{}'::jsonb,to_jsonb('1'::text),'NORMALIZATION_NUMBER_INVALID')
      `, [normalizationRunId, normalizedRowId, sha256(`normalization-issue-${normalizedRowId}`), index + 1]);
    }
  }
  await pool.query(`
    update material_import_normalization_runs
    set run_status='SUCCEEDED',current_stage='COMPLETE',result_digest=$2,published_at=now(),
        completed_at=now(),updated_at=now()
    where id=$1
  `, [normalizationRunId, normalizationDigest]);
  await pool.query(`
    update material_import_batches
    set status='NORMALIZED',current_parse_run_id=$2,current_normalization_run_id=$3,updated_at=now()
    where id=$1
  `, [batchId, parseRunId, normalizationRunId]);
  return {
    batchId,
    batchNo,
    normalizationRunId,
    sourceRows,
    normalizedRows,
    sourceBom: `${batchNo}/bom-governance.csv/BOM`,
  };
}

async function seed() {
  await reset();
  const materials = await seedMasterData();
  const normalization = await seedPublishedNormalization();
  return { ...materials, ...normalization };
}

function expectGovernanceError(code, status) {
  return (error) => {
    assert.equal(error?.name, "MaterialGovernanceError");
    assert.equal(error?.code, code);
    assert.equal(error?.status, status);
    return true;
  };
}

function expectMaterialError(code, status) {
  return (error) => {
    assert.equal(error?.name, "MaterialWorkflowError");
    assert.equal(error?.code, code);
    assert.equal(error?.status, status);
    return true;
  };
}

function expectDatabaseError(code) {
  return (error) => {
    assert.equal(error?.code, code);
    return true;
  };
}

function makeCapDraftDecisionBody(comment = "100pF 完整规格创建受控草稿") {
  return {
    expected_version: 1,
    decision_type: "CREATE_DRAFT",
    reason_code: "NEW_SPEC_CONFIRMED",
    comment,
    draft: {
      category_id: 97009,
      basic_fields: {
        standard_name: "0201 100pF 6.3V X5R ±10% 贴片电容",
        unit: "PCS",
        brand: "",
        manufacturer: "",
        manufacturer_part_number: "",
        procurement_type: "PURCHASE",
        inventory_type: "STOCKED",
        lot_control_required: false,
        shelf_life_days: null,
        inspection_type: "NORMAL",
        environmental_requirement: "ROHS",
      },
      attributes: {
        PACKAGE: { value: "0201", unit: "", source: "MANUAL", confidence: 1 },
        CAPACITANCE: { value: "0.0000000001", unit: "F", source: "MANUAL", confidence: 1 },
        RATED_VOLTAGE: { value: 6.3, unit: "V", source: "MANUAL", confidence: 1 },
        DIELECTRIC: { value: "X5R", unit: "", source: "MANUAL", confidence: 1 },
        TOLERANCE: { value: 10, unit: "%", source: "MANUAL", confidence: 1 },
      },
    },
  };
}

function makeResistorDraftDecisionBody(comment = "零欧完整规格创建受控草稿") {
  return {
    expected_version: 1,
    decision_type: "CREATE_DRAFT",
    reason_code: "NEW_SPEC_CONFIRMED",
    comment,
    draft: {
      category_id: 97004,
      basic_fields: {
        standard_name: "0201 0R ±5% 1/20W 贴片电阻",
        unit: "PCS",
        brand: "",
        manufacturer: "",
        manufacturer_part_number: "",
        procurement_type: "PURCHASE",
        inventory_type: "STOCKED",
        lot_control_required: false,
        shelf_life_days: null,
        inspection_type: "NORMAL",
        environmental_requirement: "ROHS",
      },
      attributes: {
        PACKAGE: { value: "0201", unit: "", source: "MANUAL", confidence: 1 },
        RESISTANCE: { value: 0, unit: "ohm", source: "MANUAL", confidence: 1 },
        TOLERANCE: { value: 5, unit: "%", source: "MANUAL", confidence: 1 },
        POWER: { value: 0.05, unit: "W", source: "MANUAL", confidence: 1 },
      },
    },
  };
}

function makeConnectorDraftDecisionBody(comment = "连接器完整规格创建受控草稿") {
  return {
    expected_version: 1,
    decision_type: "CREATE_DRAFT",
    reason_code: "NEW_SPEC_CONFIRMED",
    comment,
    draft: {
      category_id: 97012,
      basic_fields: {
        standard_name: "JST B5B-PH-K 5PIN 2.0mm 立式连接器",
        unit: "PCS",
        brand: "JST",
        manufacturer: "",
        manufacturer_part_number: "",
        procurement_type: "PURCHASE",
        inventory_type: "STOCKED",
        lot_control_required: false,
        shelf_life_days: null,
        inspection_type: "NORMAL",
        environmental_requirement: "ROHS",
      },
      attributes: {
        BRAND: { value: "JST", unit: "", source: "MANUAL", confidence: 1 },
        MODEL: { value: "B5B-PH-K", unit: "", source: "MANUAL", confidence: 1 },
        PIN_COUNT: { value: 5, unit: "pin", source: "MANUAL", confidence: 1 },
        PITCH: { value: 2, unit: "mm", source: "MANUAL", confidence: 1 },
        STRUCTURE: { value: "VERTICAL", unit: "", source: "MANUAL", confidence: 1 },
      },
    },
  };
}

function makeIcDraftDecisionBody(comment = "完整 MPN 与 SOT 封装创建受控草稿") {
  return {
    expected_version: 1,
    decision_type: "CREATE_DRAFT",
    reason_code: "NEW_SPEC_CONFIRMED",
    comment,
    draft: {
      category_id: 97007,
      basic_fields: {
        standard_name: "TPS7A2033PDBVR 低压差稳压芯片",
        unit: "PCS",
        brand: "TI",
        manufacturer: "Texas Instruments",
        manufacturer_part_number: "TPS7A2033PDBVR",
        procurement_type: "PURCHASE",
        inventory_type: "STOCKED",
        lot_control_required: false,
        shelf_life_days: null,
        inspection_type: "NORMAL",
        environmental_requirement: "ROHS",
      },
      attributes: {
        MPN: { value: "TPS7A2033PDBVR", unit: "", source: "MANUAL", confidence: 1 },
        PACKAGE: { value: "SOT-23-5", unit: "", source: "MANUAL", confidence: 1 },
      },
    },
  };
}

async function createGovernanceRunAndReadyCap(fixture, key) {
  const body = { normalization_run_id: fixture.normalizationRunId, expected_version: 7 };
  const route = `/api/material-master/import-batches/${fixture.batchId}/governance/runs`;
  const created = await service.createRun(fixture.batchId, context(route, key, body), body);
  const groups = await service.groups(fixture.batchId, created.data.governance_run_id, actor, page, {});
  const capacitor = groups.items.find((group) => group.category === "CAP" && group.readiness === "READY");
  assert.ok(capacitor);
  return { runId: created.data.governance_run_id, route, capacitor };
}

test.after(async () => pool.end());

test("published normalization governs strict identities, traceability, alternatives, exact binding and guarded facts", async () => {
  const fixture = await seed();
  const runBody = { normalization_run_id: fixture.normalizationRunId, expected_version: 7 };
  const runRoute = `/api/material-master/import-batches/${fixture.batchId}/governance/runs`;
  const runContext = context(runRoute, "governance-run-create-0001", runBody);
  const created = await service.createRun(fixture.batchId, runContext, runBody);
  assert.equal(created.statusCode, 201);
  assert.equal(created.replayed, false);
  assert.equal(created.data.source_count, 9);
  assert.equal(created.data.group_count, 6);
  assert.equal(created.data.ready_group_count, 5);
  assert.equal(created.data.exception_row_count, 1);
  assert.equal(created.data.alternative_candidate_count, 4);
  assert.match(created.data.result_digest, /^[0-9a-f]{64}$/);
  const governanceRunId = created.data.governance_run_id;

  const replay = await service.createRun(fixture.batchId, runContext, runBody);
  assert.equal(replay.replayed, true);
  assert.equal(replay.operationId, created.operationId);
  assert.equal(replay.data.governance_run_id, governanceRunId);
  const changedRunBody = { ...runBody, expected_version: 8 };
  await assert.rejects(
    service.createRun(
      fixture.batchId,
      context(runRoute, runContext.idempotencyKey, changedRunBody),
      changedRunBody,
    ),
    expectGovernanceError("IDEMPOTENCY_CONFLICT", 409),
  );
  await pool.query("update material_import_normalization_runs set run_status='SUPERSEDED' where id=$1", [fixture.normalizationRunId]);
  await assert.rejects(
    service.createRun(
      fixture.batchId,
      context(runRoute, "governance-run-superseded-0001", runBody),
      runBody,
    ),
    expectGovernanceError("GOVERNANCE_NORMALIZATION_NOT_PUBLISHED", 422),
  );
  await pool.query("update material_import_normalization_runs set run_status='SUCCEEDED' where id=$1", [fixture.normalizationRunId]);

  const groupList = await service.groups(fixture.batchId, governanceRunId, actor, page, {});
  assert.equal(groupList.items.length, 6);
  const resistor = groupList.items.find((group) => group.category === "RES");
  assert.ok(resistor);
  assert.equal(resistor.readiness, "READY");
  assert.equal(resistor.governance_key, "RES_0201_0R_5_1-20W");
  assert.equal(resistor.source_count, 4);
  const capacitors = groupList.items.filter((group) => group.category === "CAP");
  assert.equal(capacitors.length, 2);
  assert.equal(capacitors.filter((group) => group.readiness === "READY").length, 1);
  assert.equal(capacitors.filter((group) => group.readiness === "REVIEW_REQUIRED").length, 1);
  assert.equal(new Set(capacitors.map((group) => group.group_id)).size, 2);
  const connectors = groupList.items.filter((group) => group.category === "CON");
  assert.equal(connectors.length, 2);
  assert.ok(connectors.every((group) => group.readiness === "READY"));

  const resistorDetail = await service.group(fixture.batchId, governanceRunId, resistor.group_id, actor);
  assert.deepEqual(
    new Set(resistorDetail.data.sources.map((source) => source.original_part_number).filter(Boolean)),
    new Set(["0201WMJ0000TCE", "SUP-0201-0R"]),
  );
  assert.deepEqual(
    new Set(resistorDetail.data.sources.map((source) => source.manufacturer_part_number).filter(Boolean)),
    new Set(["0201WMJ0000TCE"]),
  );
  assert.deepEqual(
    new Set(resistorDetail.data.sources.map((source) => source.supplier_part_number).filter(Boolean)),
    new Set(["SUP-0201-0R"]),
  );
  assert.equal(resistorDetail.data.supplier_candidates.length, 4);
  assert.deepEqual(
    new Set(resistorDetail.data.supplier_candidates.map((candidate) => candidate.brand).filter(Boolean)),
    new Set(["BRAND-ONLY-A", "BRAND-ONLY-B"]),
  );
  assert.deepEqual(
    new Set(resistorDetail.data.supplier_candidates.map((candidate) => candidate.candidate_kind)),
    new Set(["PRIMARY_SOURCE", "ALTERNATIVE_SOURCE"]),
  );
  assert.ok(resistorDetail.data.sources.every((source) => source.source_bom === fixture.sourceBom));
  assert.deepEqual(
    new Set(resistorDetail.data.sources.map((source) => Number(source.source_row_id))),
    new Set(fixture.sourceRows.slice(0, 4)),
  );
  assert.deepEqual(
    new Set(resistorDetail.data.sources.map((source) => Number(source.normalized_row_id))),
    new Set(fixture.normalizedRows.slice(0, 4)),
  );
  assert.deepEqual(
    new Set(resistorDetail.data.specifications.map((specification) => specification.component_code)),
    new Set(["PACKAGE", "RESISTANCE", "TOLERANCE", "POWER"]),
  );
  assert.equal(resistorDetail.data.material_candidates.length, 1);
  assert.equal(Number(resistorDetail.data.material_candidates[0].material_id), fixture.exactMaterialId);
  assert.equal(resistorDetail.data.material_candidates[0].candidate_kind, "EXACT_IDENTITY");
  assert.equal(resistorDetail.data.material_candidates[0].material_status_snapshot, "ACTIVE");
  assert.equal(
    resistorDetail.data.material_candidates.some((candidate) => Number(candidate.material_id) === fixture.differentMaterialId),
    false,
  );

  const capacitorDetails = await Promise.all(
    capacitors.map((group) => service.group(fixture.batchId, governanceRunId, group.group_id, actor)),
  );
  const capacitanceValues = capacitorDetails.map((detail) =>
    detail.data.specifications.find((specification) => specification.component_code === "CAPACITANCE")?.normalized_value,
  );
  assert.equal(capacitanceValues.every(Boolean), true);
  assert.notEqual(capacitanceValues[0], capacitanceValues[1]);

  const duplicates = await service.report(fixture.batchId, governanceRunId, actor, "duplicates", page);
  assert.equal(duplicates.items.length, 4);
  assert.deepEqual(
    new Set(duplicates.items.map((item) => item.original_part_number).filter(Boolean)),
    new Set(["0201WMJ0000TCE", "SUP-0201-0R"]),
  );
  assert.deepEqual(
    new Set(duplicates.items.map((item) => item.original_description)),
    new Set(["0201 0R ±5% 1/20W 厂商编码", "0201 零欧 ±5%", "0201 0R ±5% 1/20W 品牌甲", "0201 0R ±5% 1/20W 品牌乙"]),
  );
  assert.ok(duplicates.items.every((item) => item.source_count === 4));
  assert.ok(duplicates.items.every((item) => item.merge_evidence.includes("CATEGORY_EQUAL")));
  const exceptions = await service.report(fixture.batchId, governanceRunId, actor, "exceptions", page);
  assert.equal(exceptions.items.length, 1);
  assert.deepEqual(
    new Set(exceptions.items.map((item) => item.original_specification)),
    new Set(["0201 1uF"]),
  );
  assert.ok(exceptions.items.every((item) => item.readiness === "REVIEW_REQUIRED"));
  assert.ok(exceptions.items.every((item) => item.issues.some((issue) => issue.code === "GOVERNANCE_VOLTAGE_MISSING")));
  const upstreamException = exceptions.items[0];
  assert.ok(upstreamException.issues.some((issue) => issue.code === "NORMALIZATION_NUMBER_INVALID"));
  assert.equal(upstreamException.error_count > 0, true);
  const alternatives = await service.report(fixture.batchId, governanceRunId, actor, "alternatives", page);
  assert.equal(alternatives.items.length, 5);
  const connectorAlternative = alternatives.items.find((candidate) => candidate.candidate_scope === "COMPATIBILITY_GROUP");
  assert.ok(connectorAlternative);
  assert.equal(connectorAlternative.category, "CON");
  assert.equal(connectorAlternative.status, "PENDING_REVIEW");
  assert.deepEqual(connectorAlternative.evidence, [
    "CATEGORY_EQUAL",
    "COMPATIBILITY_COMPONENTS_EQUAL",
    "IDENTITY_COMPONENTS_DIFFER",
  ]);
  const supplierSources = alternatives.items.filter((candidate) => candidate.candidate_scope === "SAME_IDENTITY_SOURCE");
  assert.equal(supplierSources.length, 4);
  assert.deepEqual(
    new Set(supplierSources.map((candidate) => candidate.original_brand).filter(Boolean)),
    new Set(["BRAND-ONLY-A", "BRAND-ONLY-B"]),
  );
  assert.deepEqual(
    new Set(supplierSources.map((candidate) => candidate.candidate_kind)),
    new Set(["PRIMARY_SOURCE", "ALTERNATIVE_SOURCE"]),
  );
  assert.ok(supplierSources.every((candidate) => Number(candidate.main_group_id) === resistor.group_id));

  const staleDecisionBody = {
    expected_version: 1,
    decision_type: "EXCLUDE",
    reason_code: "SOURCE_SUPERSEDED",
    comment: "旧治理运行不得继续决策",
  };
  await pool.query("update material_import_batches set current_normalization_run_id=null where id=$1", [fixture.batchId]);
  await assert.rejects(
    service.decide(
      fixture.batchId,
      governanceRunId,
      resistor.group_id,
      context(`${runRoute}/${governanceRunId}/groups/${resistor.group_id}/decision`, "governance-stale-run-0001", staleDecisionBody),
      staleDecisionBody,
    ),
    expectGovernanceError("GOVERNANCE_RUN_STALE", 409),
  );
  await pool.query("update material_import_batches set current_normalization_run_id=$2 where id=$1", [fixture.batchId, fixture.normalizationRunId]);

  const readyCapacitor = capacitors.find((group) => group.readiness === "READY");
  assert.ok(readyCapacitor);
  const capDraftBody = {
    expected_version: 1,
    decision_type: "CREATE_DRAFT",
    reason_code: "NEW_SPEC_CONFIRMED",
    comment: "100pF 完整规格创建受控草稿",
    draft: {
      category_id: 97009,
      basic_fields: {
        standard_name: "0201 100pF 6.3V X5R ±10% 贴片电容",
        unit: "PCS",
        brand: "",
        manufacturer: "",
        manufacturer_part_number: "",
        procurement_type: "PURCHASE",
        inventory_type: "STOCKED",
        lot_control_required: false,
        shelf_life_days: null,
        inspection_type: "NORMAL",
        environmental_requirement: "ROHS",
      },
      attributes: {
        PACKAGE: { value: "0201", unit: "", source: "MANUAL", confidence: 1 },
        CAPACITANCE: { value: "0.0000000001", unit: "F", source: "MANUAL", confidence: 1 },
        RATED_VOLTAGE: { value: 6.3, unit: "V", source: "MANUAL", confidence: 1 },
        DIELECTRIC: { value: "X5R", unit: "", source: "MANUAL", confidence: 1 },
        TOLERANCE: { value: 10, unit: "%", source: "MANUAL", confidence: 1 },
      },
    },
  };
  const capCreated = await service.decide(
    fixture.batchId,
    governanceRunId,
    readyCapacitor.group_id,
    context(`${runRoute}/${governanceRunId}/groups/${readyCapacitor.group_id}/decision`, "governance-cap-draft-0001", capDraftBody),
    capDraftBody,
  );
  assert.equal(capCreated.data.decision_status, "DRAFT_CREATED");
  const capMaterial = await pool.query("select material_status,internal_material_code from material_master where id=$1", [capCreated.data.material_id]);
  assert.deepEqual(capMaterial.rows[0], { material_status: "DRAFT", internal_material_code: null });
  const capMaterialId = Number(capCreated.data.material_id);
  const capNonIdentityDraft = structuredClone(capDraftBody.draft);
  capNonIdentityDraft.basic_fields.standard_name = "0402 1uF 16V X7R ±20% 名称只作展示";
  capNonIdentityDraft.basic_fields.inspection_type = "TIGHTENED";
  const capNonIdentityBody = { ...capNonIdentityDraft, expected_version: 1 };
  const capUpdateRoute = `/api/material-master/drafts/${capMaterialId}`;
  const capNonIdentityUpdated = await workflow.updateDraft(
    workflowContext(actor, capUpdateRoute, "governance-cap-nonidentity-update-0001", capNonIdentityBody),
    capMaterialId,
    capNonIdentityBody,
  );
  assert.equal(capNonIdentityUpdated.data.version, 2);
  const capChangedIdentityBody = structuredClone(capNonIdentityBody);
  capChangedIdentityBody.expected_version = 2;
  capChangedIdentityBody.attributes.CAPACITANCE.value = "0.0000000002";
  await assert.rejects(
    workflow.updateDraft(
      workflowContext(actor, capUpdateRoute, "governance-cap-identity-update-0001", capChangedIdentityBody),
      capMaterialId,
      capChangedIdentityBody,
    ),
    expectMaterialError("MATERIAL_GOVERNANCE_IDENTITY_MISMATCH", 422),
  );
  const capAfterBlockedUpdate = await pool.query(`
    select material.version,attribute.normalized_value,
           (select count(*)::integer from material_api_idempotency where key_digest=$2) blocked_idempotency_count
    from material_master material
    join material_attribute_values attribute on attribute.material_id=material.id
    join material_attribute_definitions definition on definition.id=attribute.attribute_definition_id
    where material.id=$1 and definition.attribute_code='CAPACITANCE'
  `, [capMaterialId, sha256("governance-cap-identity-update-0001")]);
  assert.deepEqual(capAfterBlockedUpdate.rows[0], {
    version: 2,
    normalized_value: "0.000000000100000000",
    blocked_idempotency_count: 0,
  });

  const ic = groupList.items.find((group) => group.category === "IC");
  assert.ok(ic);
  assert.equal(ic.governance_key, "IC_TPS7A2033PDBVR_SOT-23-5");
  const icDraftBody = makeIcDraftDecisionBody();
  const icCreated = await service.decide(
    fixture.batchId,
    governanceRunId,
    ic.group_id,
    context(`${runRoute}/${governanceRunId}/groups/${ic.group_id}/decision`, "governance-ic-draft-0001", icDraftBody),
    icDraftBody,
  );
  assert.equal(icCreated.data.decision_status, "DRAFT_CREATED");

  const icMaterialId = Number(icCreated.data.material_id);
  const icChangedMpnBody = structuredClone(icDraftBody.draft);
  icChangedMpnBody.basic_fields.manufacturer_part_number = "TPS7A2033PDBVRX";
  icChangedMpnBody.attributes.MPN.value = "TPS7A2033PDBVRX";
  icChangedMpnBody.expected_version = 1;
  const icUpdateRoute = `/api/material-master/drafts/${icMaterialId}`;
  await assert.rejects(
    workflow.updateDraft(
      workflowContext(actor, icUpdateRoute, "governance-ic-mpn-update-0001", icChangedMpnBody),
      icMaterialId,
      icChangedMpnBody,
    ),
    expectMaterialError("MATERIAL_GOVERNANCE_IDENTITY_MISMATCH", 422),
  );

  const capChangedCategoryBody = { ...structuredClone(icDraftBody.draft), expected_version: 2 };
  await assert.rejects(
    workflow.updateDraft(
      workflowContext(actor, capUpdateRoute, "governance-cap-category-update-0001", capChangedCategoryBody),
      capMaterialId,
      capChangedCategoryBody,
    ),
    expectMaterialError("MATERIAL_GOVERNANCE_IDENTITY_MISMATCH", 422),
  );

  const driftedCapacitance = "0.000000000200000000";
  await pool.query(`
    update material_attribute_values attribute
    set value=to_jsonb($2::text),normalized_value=$2
    from material_attribute_definitions definition
    where attribute.attribute_definition_id=definition.id and attribute.material_id=$1
      and definition.attribute_code='CAPACITANCE'
  `, [capMaterialId, driftedCapacitance]);
  const capSubmitRoute = `/api/material-master/drafts/${capMaterialId}/submit`;
  const capSubmitBody = { expected_version: 2, submit_comment: "治理身份复核后提交" };
  await assert.rejects(
    workflow.submitDraft(
      workflowContext(actor, capSubmitRoute, "governance-cap-drifted-submit-0001", capSubmitBody),
      capMaterialId,
      capSubmitBody,
    ),
    expectMaterialError("MATERIAL_GOVERNANCE_IDENTITY_MISMATCH", 422),
  );
  const capAfterBlockedSubmit = await pool.query("select material_status,version from material_master where id=$1", [capMaterialId]);
  assert.deepEqual(capAfterBlockedSubmit.rows[0], { material_status: "DRAFT", version: 2 });
  const exactCapacitance = "0.000000000100000000";
  await pool.query(`
    update material_attribute_values attribute
    set value=to_jsonb($2::text),normalized_value=$2
    from material_attribute_definitions definition
    where attribute.attribute_definition_id=definition.id and attribute.material_id=$1
      and definition.attribute_code='CAPACITANCE'
  `, [capMaterialId, exactCapacitance]);
  const capSubmitted = await workflow.submitDraft(
    workflowContext(actor, capSubmitRoute, "governance-cap-exact-submit-0001", capSubmitBody),
    capMaterialId,
    capSubmitBody,
  );
  assert.deepEqual(
    { status: capSubmitted.data.material_status, version: capSubmitted.data.version },
    { status: "PENDING_REVIEW", version: 3 },
  );
  const capRejectBody = { expected_version: 3, reason: "补充供应商规格证明" };
  const capRejected = await workflow.rejectDraft(
    workflowContext(reviewer, `/api/material-master/drafts/${capMaterialId}/reject`, "governance-cap-reject-0001", capRejectBody),
    capMaterialId,
    capRejectBody,
  );
  assert.deepEqual(
    { status: capRejected.data.material_status, version: capRejected.data.version },
    { status: "DRAFT", version: 4 },
  );
  const capChangedAfterRejectBody = structuredClone(capChangedIdentityBody);
  capChangedAfterRejectBody.expected_version = 4;
  await assert.rejects(
    workflow.updateDraft(
      workflowContext(actor, capUpdateRoute, "governance-cap-after-reject-identity-update-0001", capChangedAfterRejectBody),
      capMaterialId,
      capChangedAfterRejectBody,
    ),
    expectMaterialError("MATERIAL_GOVERNANCE_IDENTITY_MISMATCH", 422),
  );
  const capNonIdentityAfterRejectBody = structuredClone(capNonIdentityDraft);
  capNonIdentityAfterRejectBody.basic_fields.environmental_requirement = "ROHS_REACH";
  capNonIdentityAfterRejectBody.expected_version = 4;
  const capNonIdentityAfterReject = await workflow.updateDraft(
    workflowContext(actor, capUpdateRoute, "governance-cap-after-reject-nonidentity-update-0001", capNonIdentityAfterRejectBody),
    capMaterialId,
    capNonIdentityAfterRejectBody,
  );
  assert.equal(capNonIdentityAfterReject.data.version, 5);

  const decisionRoute = `${runRoute}/${governanceRunId}/groups/${resistor.group_id}/decision`;
  const mismatchedDraftBody = {
    expected_version: 1,
    decision_type: "CREATE_DRAFT",
    reason_code: "NEW_SPEC_CONFIRMED",
    comment: "不同规格草稿不得挂接到零欧组",
    draft: {
      category_id: 97004,
      basic_fields: {
        standard_name: "0201 10K ±1% 1/20W 贴片电阻",
        unit: "PCS",
        brand: "",
        manufacturer: "",
        manufacturer_part_number: "",
        procurement_type: "PURCHASE",
        inventory_type: "STOCKED",
        lot_control_required: false,
        shelf_life_days: null,
        inspection_type: "NORMAL",
        environmental_requirement: "ROHS",
      },
      attributes: {
        PACKAGE: { value: "0201", unit: "", source: "MANUAL", confidence: 1 },
        RESISTANCE: { value: 10000, unit: "ohm", source: "MANUAL", confidence: 1 },
        TOLERANCE: { value: 1, unit: "%", source: "MANUAL", confidence: 1 },
        POWER: { value: 0.05, unit: "W", source: "MANUAL", confidence: 1 },
      },
    },
  };
  await assert.rejects(
    service.decide(
      fixture.batchId,
      governanceRunId,
      resistor.group_id,
      context(decisionRoute, "governance-draft-mismatch-0001", mismatchedDraftBody),
      mismatchedDraftBody,
    ),
    expectGovernanceError("GOVERNANCE_DRAFT_IDENTITY_MISMATCH", 422),
  );
  const duplicateActiveDraftBody = structuredClone(mismatchedDraftBody);
  duplicateActiveDraftBody.comment = "精确 ACTIVE 已存在时不得绕过绑定重复建稿";
  duplicateActiveDraftBody.draft.basic_fields.standard_name = "名称不参与零欧电阻身份";
  duplicateActiveDraftBody.draft.attributes.RESISTANCE.value = 0;
  duplicateActiveDraftBody.draft.attributes.TOLERANCE.value = 5;
  duplicateActiveDraftBody.draft.attributes.POWER.value = 0.05;
  await assert.rejects(
    service.decide(
      fixture.batchId,
      governanceRunId,
      resistor.group_id,
      context(decisionRoute, "governance-create-duplicate-active-0001", duplicateActiveDraftBody),
      duplicateActiveDraftBody,
    ),
    expectGovernanceError("GOVERNANCE_ACTIVE_MATERIAL_BIND_REQUIRED", 409),
  );
  const nonCandidateBody = {
    expected_version: 1,
    decision_type: "BIND_EXISTING",
    reason_code: "EXACT_SPEC_CONFIRMED",
    comment: "不同规格物料不得绑定",
    material_id: fixture.differentMaterialId,
  };
  await assert.rejects(
    service.decide(
      fixture.batchId,
      governanceRunId,
      resistor.group_id,
      context(decisionRoute, "governance-bind-noncandidate-0001", nonCandidateBody),
      nonCandidateBody,
    ),
    expectGovernanceError("GOVERNANCE_EXACT_MATERIAL_CANDIDATE_REQUIRED", 422),
  );
  await pool.query("update material_master set version=version+1 where id=$1", [fixture.exactMaterialId]);
  await pool.query(`
    update material_attribute_values value
    set normalized_value='1'
    from material_attribute_definitions definition
    where value.attribute_definition_id=definition.id and value.material_id=$1
      and definition.attribute_code='RESISTANCE'
  `, [fixture.exactMaterialId]);
  const changedIdentityBody = { ...nonCandidateBody, material_id: fixture.exactMaterialId, comment: "候选规格变化时必须重新治理" };
  await assert.rejects(
    service.decide(
      fixture.batchId,
      governanceRunId,
      resistor.group_id,
      context(decisionRoute, "governance-bind-identity-changed-0001", changedIdentityBody),
      changedIdentityBody,
    ),
    expectGovernanceError("GOVERNANCE_MATERIAL_IDENTITY_CHANGED", 409),
  );
  await pool.query(`
    update material_attribute_values value
    set normalized_value='0'
    from material_attribute_definitions definition
    where value.attribute_definition_id=definition.id and value.material_id=$1
      and definition.attribute_code='RESISTANCE'
  `, [fixture.exactMaterialId]);
  await pool.query("update material_master set material_status='FROZEN' where id=$1", [fixture.exactMaterialId]);
  const inactiveBody = { ...nonCandidateBody, material_id: fixture.exactMaterialId, comment: "候选已冻结时不得绑定" };
  await assert.rejects(
    service.decide(
      fixture.batchId,
      governanceRunId,
      resistor.group_id,
      context(decisionRoute, "governance-bind-frozen-0001", inactiveBody),
      inactiveBody,
    ),
    expectGovernanceError("GOVERNANCE_ACTIVE_MATERIAL_REQUIRED", 409),
  );
  await pool.query("update material_master set material_status='ACTIVE' where id=$1", [fixture.exactMaterialId]);

  const bindBody = {
    expected_version: 1,
    decision_type: "BIND_EXISTING",
    reason_code: "EXACT_SPEC_CONFIRMED",
    comment: "候选版本变化后实时规格身份仍与 ACTIVE 主数据完全一致",
    material_id: fixture.exactMaterialId,
  };
  const bindContext = context(decisionRoute, "governance-bind-exact-0001", bindBody);
  const bound = await service.decide(
    fixture.batchId,
    governanceRunId,
    resistor.group_id,
    bindContext,
    bindBody,
  );
  assert.equal(bound.replayed, false);
  assert.equal(bound.data.decision_status, "BOUND_ACTIVE");
  assert.equal(bound.data.version, 2);
  assert.equal(bound.data.material_id, fixture.exactMaterialId);
  const boundReplay = await service.decide(
    fixture.batchId,
    governanceRunId,
    resistor.group_id,
    bindContext,
    bindBody,
  );
  assert.equal(boundReplay.replayed, true);
  assert.equal(boundReplay.operationId, bound.operationId);
  const staleContext = context(decisionRoute, "governance-bind-stale-0001", bindBody);
  await assert.rejects(
    service.decide(fixture.batchId, governanceRunId, resistor.group_id, staleContext, bindBody),
    (error) => {
      assert.equal(error?.code, "GOVERNANCE_VERSION_CONFLICT");
      assert.equal(error?.status, 409);
      assert.equal(error?.currentVersion, 2);
      return true;
    },
  );

  const boundDetail = await service.group(fixture.batchId, governanceRunId, resistor.group_id, actor);
  assert.equal(boundDetail.data.decision_status, "BOUND_ACTIVE");
  assert.equal(boundDetail.data.version, 2);
  assert.equal(boundDetail.data.material_id, fixture.exactMaterialId);
  assert.equal(boundDetail.data.erp_material_code, "CYD-RES_CHIP-990001");
  assert.equal(boundDetail.data.decision.decision_type, "BIND_EXISTING");
  assert.equal(boundDetail.data.decision.decision_payload.candidate_source, "LIVE_REVALIDATED");
  assert.equal(boundDetail.data.decision.decision_payload.candidate_snapshot_version, 1);
  assert.equal(boundDetail.data.decision.decision_payload.bound_material_version, 2);
  assert.equal(boundDetail.data.material_link.link_type, "BOUND_ACTIVE");
  const bomMapping = await service.report(fixture.batchId, governanceRunId, actor, "bom-mapping", page);
  assert.equal(bomMapping.items.length, 9);
  const traced = bomMapping.items.filter((item) => Number(item.material_id) === fixture.exactMaterialId);
  assert.equal(traced.length, 4);
  assert.ok(traced.every((item) => item.project === fixture.sourceBom));
  assert.ok(traced.every((item) => item.erp_material_code === "CYD-RES_CHIP-990001"));
  assert.deepEqual(
    new Set(traced.map((item) => item.original_part_number).filter(Boolean)),
    new Set(["0201WMJ0000TCE", "SUP-0201-0R"]),
  );
  const rawTrace = await pool.query(`
    select id,raw_values->'fields'->>'original_line' original_line
    from material_import_rows where id=any($1::bigint[]) order by id
  `, [fixture.sourceRows.slice(0, 2)]);
  assert.deepEqual(
    rawTrace.rows.map((row) => row.original_line),
    ["0201WMJ0000TCE", "0201,0R,±5%"],
  );

  const governanceRowId = Number(boundDetail.data.sources[0].id);
  const governanceSpecId = Number(boundDetail.data.specifications[0].id);
  await assert.rejects(
    pool.query(`
      insert into material_governance_specs(
        governance_row_id,component_code,component_role,normalized_value,display_value,evidence
      ) values($1,'DIRECT_WRITE','DESCRIPTIVE','x','x','[]'::jsonb)
    `, [governanceRowId]),
    expectDatabaseError("42501"),
  );
  await assert.rejects(
    pool.query("update material_governance_specs set display_value='tampered' where id=$1", [governanceSpecId]),
    expectDatabaseError("55000"),
  );
  await assert.rejects(
    pool.query("delete from material_governance_runs where id=$1", [governanceRunId]),
    expectDatabaseError("55000"),
  );
  const persisted = await pool.query(`
    select
      (select count(*)::integer from material_governance_runs) run_count,
      (select count(*)::integer from material_governance_decisions) decision_count,
      (select count(*)::integer from material_governance_events) event_count,
      (select count(*)::integer from material_governance_material_links) link_count
  `);
  assert.deepEqual(persisted.rows[0], { run_count: 1, decision_count: 3, event_count: 3, link_count: 3 });
});

test("legacy incomplete ACTIVE metadata is surfaced as compatibility review and blocks draft creation", async () => {
  const fixture = await seed();
  const legacyMaterialId = await seedActiveResistor(
    97009,
    fixture.definitions,
    { PACKAGE: "0201", CAPACITANCE: "0.0000000001", RATED_VOLTAGE: "6.3", TOLERANCE: "10" },
    "CYD-CAP_CHIP-990003",
    "0201 100pF 6.3V X5R ±10% 名称不得补齐缺失介质",
  );
  const current = await createGovernanceRunAndReadyCap(fixture, "governance-compatibility-run-0001");
  const detail = await service.group(fixture.batchId, current.runId, current.capacitor.group_id, actor);
  const candidate = detail.data.material_candidates.find((item) => Number(item.material_id) === legacyMaterialId);
  assert.ok(candidate);
  assert.equal(candidate.candidate_kind, "COMPATIBILITY_REVIEW");
  assert.deepEqual(candidate.candidate_snapshot.blocking_issue_codes, ["GOVERNANCE_DIELECTRIC_MISSING"]);
  assert.ok(candidate.evidence.includes("PARTIAL_SPECIFICATIONS_EQUAL"));

  const body = makeCapDraftDecisionBody("旧 ACTIVE 元数据不完整时不得新建重复规格草稿");
  await assert.rejects(
    service.decide(
      fixture.batchId,
      current.runId,
      current.capacitor.group_id,
      context(`${current.route}/${current.runId}/groups/${current.capacitor.group_id}/decision`, "governance-compatibility-block-0001", body),
      body,
    ),
    expectGovernanceError("GOVERNANCE_COMPATIBILITY_REVIEW_REQUIRED", 409),
  );
});

test("non-identity brand drift and canonical package variants cannot hide exact ACTIVE materials", async () => {
  const fixture = await seed();
  const activeCapId = await seedActiveResistor(
    97009,
    fixture.definitions,
    {
      PACKAGE: "0201",
      CAPACITANCE: "0.0000000001",
      RATED_VOLTAGE: "6.3",
      DIELECTRIC: "X5R",
      TOLERANCE: "10",
      BRAND: "JST",
    },
    "CYD-CAP_CHIP-990004",
    "名称不作为容量证据",
    { brand: "MOLEX" },
  );
  const activeIcId = await seedActiveResistor(
    97007,
    fixture.definitions,
    { MPN: "TPS7A2033PDBVR", PACKAGE: "SOT23-5" },
    "CYD-IC_SOT-990005",
    "名称不作为 IC 身份证据",
    { manufacturerPartNumber: "TPS7A2033PDBVR" },
  );
  const body = { normalization_run_id: fixture.normalizationRunId, expected_version: 7 };
  const route = `/api/material-master/import-batches/${fixture.batchId}/governance/runs`;
  const run = await service.createRun(fixture.batchId, context(route, "governance-formal-variant-run-0001", body), body);
  const groups = await service.groups(fixture.batchId, run.data.governance_run_id, actor, page, {});
  const cap = groups.items.find((group) => group.category === "CAP" && group.readiness === "READY");
  const ic = groups.items.find((group) => group.category === "IC");
  assert.ok(cap);
  assert.ok(ic);
  const [capDetail, icDetail] = await Promise.all([
    service.group(fixture.batchId, run.data.governance_run_id, cap.group_id, actor),
    service.group(fixture.batchId, run.data.governance_run_id, ic.group_id, actor),
  ]);
  assert.ok(capDetail.data.material_candidates.some((candidate) => Number(candidate.material_id) === activeCapId && candidate.candidate_kind === "EXACT_IDENTITY"));
  assert.ok(icDetail.data.material_candidates.some((candidate) => Number(candidate.material_id) === activeIcId && candidate.candidate_kind === "EXACT_IDENTITY"));
  const duplicate = makeCapDraftDecisionBody("非身份品牌漂移不得让 ACTIVE 隐身");
  await assert.rejects(
    service.decide(
      fixture.batchId,
      run.data.governance_run_id,
      cap.group_id,
      context(`${route}/${run.data.governance_run_id}/groups/${cap.group_id}/decision`, "governance-formal-variant-block-0001", duplicate),
      duplicate,
    ),
    expectGovernanceError("GOVERNANCE_ACTIVE_MATERIAL_BIND_REQUIRED", 409),
  );
});

test("historical connector brand conflicts become blocking compatibility candidates", async () => {
  const fixture = await seed();
  const activeConnectorId = await seedActiveResistor(
    97012,
    fixture.definitions,
    { BRAND: "MOLEX", MODEL: "B5B-PH-K", PIN_COUNT: "5", PITCH: "2", STRUCTURE: "VERTICAL" },
    "CYD-CONN_BOARD_STD-990006",
    "历史品牌双字段冲突连接器",
    { brand: "JST" },
  );
  const body = { normalization_run_id: fixture.normalizationRunId, expected_version: 7 };
  const route = `/api/material-master/import-batches/${fixture.batchId}/governance/runs`;
  const run = await service.createRun(fixture.batchId, context(route, "governance-connector-legacy-conflict-run-0001", body), body);
  const groups = await service.groups(fixture.batchId, run.data.governance_run_id, actor, page, {});
  const connector = groups.items.find((group) => group.category === "CON" && group.governance_key.includes("B5B-PH-K"));
  assert.ok(connector);
  const detail = await service.group(fixture.batchId, run.data.governance_run_id, connector.group_id, actor);
  assert.ok(detail.data.material_candidates.some((candidate) => Number(candidate.material_id) === activeConnectorId && candidate.candidate_kind === "COMPATIBILITY_REVIEW"));
  const duplicate = makeConnectorDraftDecisionBody("历史品牌冲突需先处置");
  await assert.rejects(
    service.decide(
      fixture.batchId,
      run.data.governance_run_id,
      connector.group_id,
      context(`${route}/${run.data.governance_run_id}/groups/${connector.group_id}/decision`, "governance-connector-legacy-conflict-block-0001", duplicate),
      duplicate,
    ),
    expectGovernanceError("GOVERNANCE_COMPATIBILITY_REVIEW_REQUIRED", 409),
  );
});

test("identity advisory lock permits only one draft across concurrent and sequential batches", async () => {
  await reset();
  await seedMasterData();
  const firstFixture = await seedPublishedNormalization();
  const secondFixture = await seedPublishedNormalization();
  const first = await createGovernanceRunAndReadyCap(firstFixture, "governance-concurrent-run-a-0001");
  const second = await createGovernanceRunAndReadyCap(secondFixture, "governance-concurrent-run-b-0001");
  const firstBody = makeCapDraftDecisionBody("并发批次 A 建稿");
  const secondBody = makeCapDraftDecisionBody("并发批次 B 建稿");
  const outcomes = await Promise.allSettled([
    service.decide(
      firstFixture.batchId,
      first.runId,
      first.capacitor.group_id,
      context(`${first.route}/${first.runId}/groups/${first.capacitor.group_id}/decision`, "governance-concurrent-draft-a-0001", firstBody),
      firstBody,
    ),
    service.decide(
      secondFixture.batchId,
      second.runId,
      second.capacitor.group_id,
      context(`${second.route}/${second.runId}/groups/${second.capacitor.group_id}/decision`, "governance-concurrent-draft-b-0001", secondBody),
      secondBody,
    ),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  assert.ok(rejected);
  assert.equal(rejected.reason.code, "GOVERNANCE_IDENTITY_DRAFT_EXISTS");
  assert.equal(rejected.reason.status, 409);
  assert.equal(await pool.query("select count(*)::integer count from material_master where category_id=97009 and material_status='DRAFT'").then((value) => value.rows[0].count), 1);

  const thirdFixture = await seedPublishedNormalization();
  const third = await createGovernanceRunAndReadyCap(thirdFixture, "governance-sequential-run-c-0001");
  const thirdBody = makeCapDraftDecisionBody("顺序批次 C 不得重复建稿");
  await assert.rejects(
    service.decide(
      thirdFixture.batchId,
      third.runId,
      third.capacitor.group_id,
      context(`${third.route}/${third.runId}/groups/${third.capacitor.group_id}/decision`, "governance-sequential-draft-c-0001", thirdBody),
      thirdBody,
    ),
    expectGovernanceError("GOVERNANCE_IDENTITY_DRAFT_EXISTS", 409),
  );
});

test("connector draft and ongoing guard reject conflicting basic and structured brands", async () => {
  const fixture = await seed();
  const body = { normalization_run_id: fixture.normalizationRunId, expected_version: 7 };
  const route = `/api/material-master/import-batches/${fixture.batchId}/governance/runs`;
  const created = await service.createRun(fixture.batchId, context(route, "governance-connector-run-0001", body), body);
  const groups = await service.groups(fixture.batchId, created.data.governance_run_id, actor, page, {});
  const connector = groups.items.find((group) => group.category === "CON" && group.governance_key.includes("B5B-PH-K"));
  assert.ok(connector);
  const decisionRoute = `${route}/${created.data.governance_run_id}/groups/${connector.group_id}/decision`;

  const conflict = makeConnectorDraftDecisionBody("品牌双字段冲突不得建稿");
  conflict.draft.basic_fields.brand = "MOLEX";
  await assert.rejects(
    service.decide(
      fixture.batchId,
      created.data.governance_run_id,
      connector.group_id,
      context(decisionRoute, "governance-connector-brand-conflict-0001", conflict),
      conflict,
    ),
    expectGovernanceError("GOVERNANCE_DRAFT_IDENTITY_MISMATCH", 422),
  );

  const valid = makeConnectorDraftDecisionBody();
  const draft = await service.decide(
    fixture.batchId,
    created.data.governance_run_id,
    connector.group_id,
    context(decisionRoute, "governance-connector-draft-0001", valid),
    valid,
  );
  const update = structuredClone(valid.draft);
  update.expected_version = 1;
  update.basic_fields.brand = "MOLEX";
  await assert.rejects(
    workflow.updateDraft(
      workflowContext(actor, `/api/material-master/drafts/${draft.data.material_id}`, "governance-connector-brand-update-0001", update),
      Number(draft.data.material_id),
      update,
    ),
    expectMaterialError("MATERIAL_GOVERNANCE_IDENTITY_MISMATCH", 422),
  );
});

test("a previously bound identity remains reserved after the material is inactive", async () => {
  const fixture = await seed();
  const firstBody = { normalization_run_id: fixture.normalizationRunId, expected_version: 7 };
  const firstRoute = `/api/material-master/import-batches/${fixture.batchId}/governance/runs`;
  const firstRun = await service.createRun(fixture.batchId, context(firstRoute, "governance-bound-inactive-run-a-0001", firstBody), firstBody);
  const firstGroups = await service.groups(fixture.batchId, firstRun.data.governance_run_id, actor, page, {});
  const firstResistor = firstGroups.items.find((group) => group.category === "RES");
  assert.ok(firstResistor);
  const bindBody = {
    expected_version: 1,
    decision_type: "BIND_EXISTING",
    reason_code: "EXACT_SPEC_CONFIRMED",
    comment: "先绑定既有 ACTIVE",
    material_id: fixture.exactMaterialId,
  };
  await service.decide(
    fixture.batchId,
    firstRun.data.governance_run_id,
    firstResistor.group_id,
    context(`${firstRoute}/${firstRun.data.governance_run_id}/groups/${firstResistor.group_id}/decision`, "governance-bound-inactive-bind-0001", bindBody),
    bindBody,
  );
  await pool.query("update material_master set material_status='INACTIVE' where id=$1", [fixture.exactMaterialId]);

  const secondFixture = await seedPublishedNormalization();
  const secondBody = { normalization_run_id: secondFixture.normalizationRunId, expected_version: 7 };
  const secondRoute = `/api/material-master/import-batches/${secondFixture.batchId}/governance/runs`;
  const secondRun = await service.createRun(secondFixture.batchId, context(secondRoute, "governance-bound-inactive-run-b-0001", secondBody), secondBody);
  const secondGroups = await service.groups(secondFixture.batchId, secondRun.data.governance_run_id, actor, page, {});
  const secondResistor = secondGroups.items.find((group) => group.category === "RES");
  assert.ok(secondResistor);
  const duplicate = makeResistorDraftDecisionBody("停用物料身份仍需人工处置");
  await assert.rejects(
    service.decide(
      secondFixture.batchId,
      secondRun.data.governance_run_id,
      secondResistor.group_id,
      context(`${secondRoute}/${secondRun.data.governance_run_id}/groups/${secondResistor.group_id}/decision`, "governance-bound-inactive-create-0001", duplicate),
      duplicate,
    ),
    expectGovernanceError("GOVERNANCE_IDENTITY_MATERIAL_CONFLICT", 409),
  );
});

test("approval identity lock permits only one ACTIVE code for concurrent ordinary drafts", async () => {
  await reset();
  await seedMasterData();
  const payload = makeCapDraftDecisionBody().draft;
  const firstCreate = await workflow.createDraft(
    workflowContext(actor, "/api/material-master/drafts", "ordinary-cap-create-a-0001", payload),
    payload,
  );
  const secondCreate = await workflow.createDraft(
    workflowContext(actor, "/api/material-master/drafts", "ordinary-cap-create-b-0001", payload),
    payload,
  );
  const firstId = Number(firstCreate.data.material_id);
  const secondId = Number(secondCreate.data.material_id);
  const submit = async (materialId, key) => workflow.submitDraft(
    workflowContext(actor, `/api/material-master/drafts/${materialId}/submit`, key, { expected_version: 1 }),
    materialId,
    { expected_version: 1 },
  );
  await submit(firstId, "ordinary-cap-submit-a-0001");
  await submit(secondId, "ordinary-cap-submit-b-0001");
  const approvals = await Promise.allSettled([
    workflow.approveDraft(
      workflowContext(approver, `/api/material-master/drafts/${firstId}/approve`, "ordinary-cap-approve-a-0001", { expected_version: 2 }),
      firstId,
      { expected_version: 2 },
    ),
    workflow.approveDraft(
      workflowContext(approver, `/api/material-master/drafts/${secondId}/approve`, "ordinary-cap-approve-b-0001", { expected_version: 2 }),
      secondId,
      { expected_version: 2 },
    ),
  ]);
  assert.equal(approvals.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const rejected = approvals.find((outcome) => outcome.status === "rejected");
  assert.ok(rejected);
  assert.equal(rejected.reason.code, "MATERIAL_GOVERNANCE_DUPLICATE_ACTIVE");
  assert.equal(rejected.reason.status, 409);
  const statuses = await pool.query(`
    select material_status,count(*)::integer count
    from material_master where category_id=97009
    group by material_status order by material_status
  `);
  assert.deepEqual(statuses.rows, [
    { material_status: "ACTIVE", count: 1 },
    { material_status: "PENDING_REVIEW", count: 1 },
  ]);
});

test("a committed governance draft reserves its identity against a later ordinary approval", async () => {
  await reset();
  await seedMasterData();
  const fixture = await seedPublishedNormalization();
  const payload = makeCapDraftDecisionBody().draft;
  const ordinary = await workflow.createDraft(
    workflowContext(actor, "/api/material-master/drafts", "ordinary-reserved-create-0001", payload),
    payload,
  );
  const ordinaryId = Number(ordinary.data.material_id);
  await workflow.submitDraft(
    workflowContext(actor, `/api/material-master/drafts/${ordinaryId}/submit`, "ordinary-reserved-submit-0001", { expected_version: 1 }),
    ordinaryId,
    { expected_version: 1 },
  );

  const governance = await createGovernanceRunAndReadyCap(fixture, "governance-reserved-run-0001");
  const draftBody = makeCapDraftDecisionBody("治理草稿先于普通稿审批提交");
  const reserved = await service.decide(
    fixture.batchId,
    governance.runId,
    governance.capacitor.group_id,
    context(`${governance.route}/${governance.runId}/groups/${governance.capacitor.group_id}/decision`, "governance-reserved-create-0001", draftBody),
    draftBody,
  );

  await assert.rejects(
    workflow.approveDraft(
      workflowContext(approver, `/api/material-master/drafts/${ordinaryId}/approve`, "ordinary-reserved-approve-0001", { expected_version: 2 }),
      ordinaryId,
      { expected_version: 2 },
    ),
    expectMaterialError("MATERIAL_GOVERNANCE_IDENTITY_DRAFT_RESERVED", 409),
  );
  assert.deepEqual(
    await pool.query("select id,material_status,internal_material_code from material_master where id=any($1::bigint[]) order by id", [[ordinaryId, Number(reserved.data.material_id)]]).then((value) => value.rows),
    [
      { id: String(ordinaryId), material_status: "PENDING_REVIEW", internal_material_code: null },
      { id: String(reserved.data.material_id), material_status: "DRAFT", internal_material_code: null },
    ],
  );
});

test("governance creation and an ordinary approval cannot both claim the same identity", async () => {
  await reset();
  await seedMasterData();
  const fixture = await seedPublishedNormalization();
  const payload = makeCapDraftDecisionBody().draft;
  const ordinary = await workflow.createDraft(
    workflowContext(actor, "/api/material-master/drafts", "ordinary-race-create-0001", payload),
    payload,
  );
  const ordinaryId = Number(ordinary.data.material_id);
  await workflow.submitDraft(
    workflowContext(actor, `/api/material-master/drafts/${ordinaryId}/submit`, "ordinary-race-submit-0001", { expected_version: 1 }),
    ordinaryId,
    { expected_version: 1 },
  );
  const governance = await createGovernanceRunAndReadyCap(fixture, "governance-ordinary-race-run-0001");
  const draftBody = makeCapDraftDecisionBody("治理建稿与普通稿审批竞争");
  const outcomes = await Promise.allSettled([
    service.decide(
      fixture.batchId,
      governance.runId,
      governance.capacitor.group_id,
      context(`${governance.route}/${governance.runId}/groups/${governance.capacitor.group_id}/decision`, "governance-ordinary-race-create-0001", draftBody),
      draftBody,
    ),
    workflow.approveDraft(
      workflowContext(approver, `/api/material-master/drafts/${ordinaryId}/approve`, "governance-ordinary-race-approve-0001", { expected_version: 2 }),
      ordinaryId,
      { expected_version: 2 },
    ),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  assert.ok(rejected);
  assert.ok([
    "GOVERNANCE_ACTIVE_MATERIAL_BIND_REQUIRED",
    "MATERIAL_GOVERNANCE_IDENTITY_DRAFT_RESERVED",
  ].includes(rejected.reason.code));
  assert.notEqual(rejected.reason.code, "40P01");
  assert.equal(await pool.query("select count(*)::integer count from material_master where category_id=97009 and material_status='ACTIVE'").then((value) => value.rows[0].count), outcomes[1].status === "fulfilled" ? 1 : 0);
});

test("a run can live-revalidate and bind an exact ACTIVE material created after its immutable snapshot", async () => {
  const fixture = await seed();
  const governance = await createGovernanceRunAndReadyCap(fixture, "governance-late-active-run-0001");
  const initial = await service.group(fixture.batchId, governance.runId, governance.capacitor.group_id, actor);
  assert.equal(initial.data.material_candidates.length, 0);

  const payload = makeCapDraftDecisionBody().draft;
  const ordinary = await workflow.createDraft(
    workflowContext(actor, "/api/material-master/drafts", "late-active-create-0001", payload),
    payload,
  );
  const materialId = Number(ordinary.data.material_id);
  await workflow.submitDraft(
    workflowContext(actor, `/api/material-master/drafts/${materialId}/submit`, "late-active-submit-0001", { expected_version: 1 }),
    materialId,
    { expected_version: 1 },
  );
  await workflow.approveDraft(
    workflowContext(approver, `/api/material-master/drafts/${materialId}/approve`, "late-active-approve-0001", { expected_version: 2 }),
    materialId,
    { expected_version: 2 },
  );

  const createBody = makeCapDraftDecisionBody("快照后已有 ACTIVE 时不得重复建稿");
  const decisionRoute = `${governance.route}/${governance.runId}/groups/${governance.capacitor.group_id}/decision`;
  await assert.rejects(
    service.decide(
      fixture.batchId,
      governance.runId,
      governance.capacitor.group_id,
      context(decisionRoute, "late-active-duplicate-create-0001", createBody),
      createBody,
    ),
    expectGovernanceError("GOVERNANCE_ACTIVE_MATERIAL_BIND_REQUIRED", 409),
  );

  const bindBody = {
    expected_version: 1,
    decision_type: "BIND_EXISTING",
    reason_code: "EXACT_SPEC_CONFIRMED",
    comment: "实时重验快照后新增的精确 ACTIVE",
    material_id: materialId,
  };
  const bound = await service.decide(
    fixture.batchId,
    governance.runId,
    governance.capacitor.group_id,
    context(decisionRoute, "late-active-live-bind-0001", bindBody),
    bindBody,
  );
  assert.equal(bound.data.decision_status, "BOUND_ACTIVE");
  assert.equal(bound.data.material_id, materialId);
  const detail = await service.group(fixture.batchId, governance.runId, governance.capacitor.group_id, actor);
  assert.equal(detail.data.decision.decision_payload.candidate_source, "LIVE_REVALIDATED");
  assert.equal(detail.data.decision.decision_payload.candidate_snapshot_version, null);
  assert.equal(detail.data.decision.decision_payload.bound_material_version, 3);
  assert.equal(Number(detail.data.material_link.material_id), materialId);
});

test("approval rejects governed IC category and package mismatches instead of making an invisible ACTIVE", async () => {
  await reset();
  await seedMasterData();
  const payload = {
    category_id: 97013,
    basic_fields: {
      standard_name: "错误分类的 QFN IC",
      unit: "PCS",
      brand: "",
      manufacturer: "",
      manufacturer_part_number: "ABC123",
      procurement_type: "PURCHASE",
      inventory_type: "STOCKED",
      lot_control_required: false,
      shelf_life_days: null,
      inspection_type: "NORMAL",
      environmental_requirement: "ROHS",
    },
    attributes: {
      MPN: { value: "ABC123", unit: "", source: "MANUAL", confidence: 1 },
      PACKAGE: { value: "QFN-8", unit: "", source: "MANUAL", confidence: 1 },
    },
  };
  const created = await workflow.createDraft(
    workflowContext(actor, "/api/material-master/drafts", "ordinary-ic-mismatch-create-0001", payload),
    payload,
  );
  const materialId = Number(created.data.material_id);
  await workflow.submitDraft(
    workflowContext(actor, `/api/material-master/drafts/${materialId}/submit`, "ordinary-ic-mismatch-submit-0001", { expected_version: 1 }),
    materialId,
    { expected_version: 1 },
  );
  await assert.rejects(
    workflow.approveDraft(
      workflowContext(approver, `/api/material-master/drafts/${materialId}/approve`, "ordinary-ic-mismatch-approve-0001", { expected_version: 2 }),
      materialId,
      { expected_version: 2 },
    ),
    expectMaterialError("MATERIAL_GOVERNANCE_IDENTITY_INCOMPLETE", 422),
  );
  assert.deepEqual(
    await pool.query("select material_status,internal_material_code from material_master where id=$1", [materialId]).then((value) => value.rows[0]),
    { material_status: "PENDING_REVIEW", internal_material_code: null },
  );
});

test("approval detects a historical ACTIVE IC by actual model and package despite its legacy category mismatch", async () => {
  await reset();
  const { definitions } = await seedMasterData();
  const historicalId = await seedActiveResistor(
    97013,
    definitions,
    { MPN: "LEGACY-QFN-8", PACKAGE: "QFN-8" },
    "CYD-IC_BGA-990007",
    "历史错分类但实际为 QFN 的 IC",
    { manufacturerPartNumber: "LEGACY-QFN-8" },
  );
  const payload = {
    category_id: 97014,
    basic_fields: {
      standard_name: "LEGACY-QFN-8 QFN-8 IC",
      unit: "PCS",
      brand: "",
      manufacturer: "",
      manufacturer_part_number: "LEGACY-QFN-8",
      procurement_type: "PURCHASE",
      inventory_type: "STOCKED",
      lot_control_required: false,
      shelf_life_days: null,
      inspection_type: "NORMAL",
      environmental_requirement: "ROHS",
    },
    attributes: {
      MPN: { value: "LEGACY-QFN-8", unit: "", source: "MANUAL", confidence: 1 },
      PACKAGE: { value: "QFN-8", unit: "", source: "MANUAL", confidence: 1 },
    },
  };
  const created = await workflow.createDraft(
    workflowContext(actor, "/api/material-master/drafts", "legacy-ic-visible-create-0001", payload),
    payload,
  );
  const materialId = Number(created.data.material_id);
  await workflow.submitDraft(
    workflowContext(actor, `/api/material-master/drafts/${materialId}/submit`, "legacy-ic-visible-submit-0001", { expected_version: 1 }),
    materialId,
    { expected_version: 1 },
  );
  await assert.rejects(
    workflow.approveDraft(
      workflowContext(approver, `/api/material-master/drafts/${materialId}/approve`, "legacy-ic-visible-approve-0001", { expected_version: 2 }),
      materialId,
      { expected_version: 2 },
    ),
    expectMaterialError("MATERIAL_GOVERNANCE_DUPLICATE_ACTIVE", 409),
  );
  assert.deepEqual(
    await pool.query("select id,material_status,internal_material_code from material_master where id=any($1::bigint[]) order by id", [[historicalId, materialId]]).then((value) => value.rows),
    [
      { id: String(historicalId), material_status: "ACTIVE", internal_material_code: "CYD-IC_BGA-990007" },
      { id: String(materialId), material_status: "PENDING_REVIEW", internal_material_code: null },
    ],
  );
});

test("approval fails closed on an unprofiled historical formal identity conflict", async () => {
  await reset();
  const { definitions } = await seedMasterData();
  const historicalId = await seedActiveResistor(
    97014,
    definitions,
    { MPN: "CONFLICT-QFN-8", PACKAGE: "QFN-8" },
    "CYD-IC_QFN-990008",
    "历史 MPN 双字段冲突 IC",
    { manufacturerPartNumber: "OTHER-MPN-9" },
  );
  const payload = {
    category_id: 97014,
    basic_fields: {
      standard_name: "CONFLICT-QFN-8 QFN-8 IC",
      unit: "PCS",
      brand: "",
      manufacturer: "",
      manufacturer_part_number: "CONFLICT-QFN-8",
      procurement_type: "PURCHASE",
      inventory_type: "STOCKED",
      lot_control_required: false,
      shelf_life_days: null,
      inspection_type: "NORMAL",
      environmental_requirement: "ROHS",
    },
    attributes: {
      MPN: { value: "CONFLICT-QFN-8", unit: "", source: "MANUAL", confidence: 1 },
      PACKAGE: { value: "QFN-8", unit: "", source: "MANUAL", confidence: 1 },
    },
  };
  const created = await workflow.createDraft(
    workflowContext(actor, "/api/material-master/drafts", "unresolved-ic-create-0001", payload),
    payload,
  );
  const materialId = Number(created.data.material_id);
  await workflow.submitDraft(
    workflowContext(actor, `/api/material-master/drafts/${materialId}/submit`, "unresolved-ic-submit-0001", { expected_version: 1 }),
    materialId,
    { expected_version: 1 },
  );
  await assert.rejects(
    workflow.approveDraft(
      workflowContext(approver, `/api/material-master/drafts/${materialId}/approve`, "unresolved-ic-approve-0001", { expected_version: 2 }),
      materialId,
      { expected_version: 2 },
    ),
    expectMaterialError("MATERIAL_GOVERNANCE_UNRESOLVED_FORMAL_IDENTITY", 409),
  );
  assert.deepEqual(
    await pool.query("select id,material_status,internal_material_code from material_master where id=any($1::bigint[]) order by id", [[historicalId, materialId]]).then((value) => value.rows),
    [
      { id: String(historicalId), material_status: "ACTIVE", internal_material_code: "CYD-IC_QFN-990008" },
      { id: String(materialId), material_status: "PENDING_REVIEW", internal_material_code: null },
    ],
  );
});

test("governance draft creation fails closed on an unprofiled ACTIVE identity conflict", async () => {
  const fixture = await seed();
  await seedActiveResistor(
    97007,
    fixture.definitions,
    { MPN: "TPS7A2033PDBVR", PACKAGE: "SOT-23-5" },
    "CYD-IC_SOT-990009",
    "历史 MPN 双字段冲突 SOT IC",
    { manufacturerPartNumber: "OTHER-MPN-9" },
  );
  const runBody = { normalization_run_id: fixture.normalizationRunId, expected_version: 7 };
  const route = `/api/material-master/import-batches/${fixture.batchId}/governance/runs`;
  const run = await service.createRun(fixture.batchId, context(route, "unresolved-governance-run-0001", runBody), runBody);
  const groups = await service.groups(fixture.batchId, run.data.governance_run_id, actor, page, {});
  const ic = groups.items.find((group) => group.category === "IC");
  assert.ok(ic);
  const detail = await service.group(fixture.batchId, run.data.governance_run_id, ic.group_id, actor);
  assert.equal(detail.data.material_candidates.length, 0);
  const draftBody = makeIcDraftDecisionBody("历史 ACTIVE 身份无法重构时不得建稿");
  await assert.rejects(
    service.decide(
      fixture.batchId,
      run.data.governance_run_id,
      ic.group_id,
      context(`${route}/${run.data.governance_run_id}/groups/${ic.group_id}/decision`, "unresolved-governance-create-0001", draftBody),
      draftBody,
    ),
    expectGovernanceError("GOVERNANCE_UNRESOLVED_FORMAL_IDENTITY_CONFLICT", 409),
  );
  assert.deepEqual(
    await pool.query("select decision_status,version from material_governance_groups where id=$1", [ic.group_id]).then((value) => value.rows[0]),
    { decision_status: "PENDING", version: 1 },
  );
});

test("governance draft approval and same-identity creation share one lock order without deadlock", async () => {
  const fixture = await seed();
  const first = await createGovernanceRunAndReadyCap(fixture, "governance-lock-order-run-a-0001");
  const firstDraftBody = makeCapDraftDecisionBody("建立待审批治理草稿");
  const created = await service.decide(
    fixture.batchId,
    first.runId,
    first.capacitor.group_id,
    context(`${first.route}/${first.runId}/groups/${first.capacitor.group_id}/decision`, "governance-lock-order-create-a-0001", firstDraftBody),
    firstDraftBody,
  );
  const materialId = Number(created.data.material_id);
  await workflow.submitDraft(
    workflowContext(actor, `/api/material-master/drafts/${materialId}/submit`, "governance-lock-order-submit-a-0001", { expected_version: 1 }),
    materialId,
    { expected_version: 1 },
  );

  const secondFixture = await seedPublishedNormalization();
  const second = await createGovernanceRunAndReadyCap(secondFixture, "governance-lock-order-run-b-0001");
  const secondDraftBody = makeCapDraftDecisionBody("同身份并发建稿必须被阻断");
  const outcomes = await Promise.allSettled([
    workflow.approveDraft(
      workflowContext(approver, `/api/material-master/drafts/${materialId}/approve`, "governance-lock-order-approve-a-0001", { expected_version: 2 }),
      materialId,
      { expected_version: 2 },
    ),
    service.decide(
      secondFixture.batchId,
      second.runId,
      second.capacitor.group_id,
      context(`${second.route}/${second.runId}/groups/${second.capacitor.group_id}/decision`, "governance-lock-order-create-b-0001", secondDraftBody),
      secondDraftBody,
    ),
  ]);
  assert.equal(outcomes[0].status, "fulfilled");
  assert.equal(outcomes[1].status, "rejected");
  assert.ok(["GOVERNANCE_IDENTITY_DRAFT_EXISTS", "GOVERNANCE_ACTIVE_MATERIAL_BIND_REQUIRED"].includes(outcomes[1].reason.code));
  assert.notEqual(outcomes[1].reason.code, "40P01");
  assert.equal(await pool.query("select count(*)::integer count from material_master where category_id=97009 and material_status='ACTIVE'").then((value) => value.rows[0].count), 1);
});
