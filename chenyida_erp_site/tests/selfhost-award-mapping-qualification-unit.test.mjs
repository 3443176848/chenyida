import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildAwardMappingQualification } from "../app/lib/procurement-fulfillment-selfhost/award-mapping-qualification.ts";

const OBSERVED_AT = "2026-08-08T02:00:00.000000Z";

function completeRawRow(ordinal = 1, overrides = {}) {
  const awardLineId = String(ordinal);
  const rfqLineId = String(ordinal);
  const quoteLineId = String(ordinal);
  const candidateId = String(ordinal * 2);
  const materialId = String(532 + ordinal);
  const mappingFactId = String(ordinal);
  const mappingUuid = `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
  const contentDigest = String(ordinal).repeat(64);
  return {
    award_line_id: awardLineId,
    rfq_id: "1",
    rfq_line_id: rfqLineId,
    quote_line_id: quoteLineId,
    candidate_id: candidateId,
    candidate_count: 1,
    quote_line_scope_matches: true,
    supplier_id: "1",
    supplier_code: "SUP-000001",
    supplier_status: "ACTIVE",
    material_id: materialId,
    material_status: "ACTIVE",
    material_inventory_type: "STOCKED",
    rfq_unit_id: "1",
    rfq_unit_code: "PCS",
    rfq_unit_enabled: true,
    binding_count: 1,
    rfq_binding_id: String(100 + ordinal),
    binding_rfq_id: "1",
    binding_rfq_line_id: rfqLineId,
    binding_supplier_id: "1",
    binding_material_id: materialId,
    binding_mapping_fact_id: mappingFactId,
    binding_mapping_uuid: mappingUuid,
    binding_mapping_version_no: 1,
    binding_mapping_row_cas: 3,
    binding_content_digest: contentDigest,
    binding_supplier_part_number: `UAT-A-${materialId}`,
    binding_supplier_unit_id: "1",
    binding_conversion_numerator: "1",
    binding_conversion_denominator: "1",
    binding_valid_from_matches: true,
    binding_valid_to_matches: true,
    binding_status: "ACTIVE",
    mapping_fact_id: mappingFactId,
    mapping_uuid: mappingUuid,
    mapping_version_no: 1,
    mapping_row_cas: 3,
    mapping_status: "ACTIVE",
    mapping_content_digest: contentDigest,
    mapping_supplier_id: "1",
    mapping_material_id: materialId,
    supplier_part_number: `UAT-A-${materialId}`,
    mapping_supplier_unit_id: "1",
    supplier_unit_code: "PCS",
    supplier_unit_enabled: true,
    conversion_numerator: "1",
    conversion_denominator: "1",
    valid_from: "2026-08-05",
    valid_to: null,
    mapping_effective_now: true,
    mapping_expired_now: false,
    internal_unit_match_count: 1,
    internal_unit_id: "1",
    internal_unit_code: "PCS",
    material_base_uom_matches: true,
    latest_mapping_fact_id: mappingFactId,
    latest_mapping_version_no: 1,
    supplier_material_conflict_count: 0,
    supplier_part_number_conflict_count: 0,
    ...overrides,
  };
}

function completeBigIntRow(awardLineId, ordinal) {
  const base = 9007199254741000n + BigInt(ordinal) * 100n;
  const id = (offset) => String(base + BigInt(offset));
  return completeRawRow(ordinal, {
    award_line_id: awardLineId,
    rfq_id: id(1),
    rfq_line_id: id(2),
    quote_line_id: id(3),
    candidate_id: id(4),
    supplier_id: id(5),
    material_id: id(6),
    rfq_unit_id: id(7),
    rfq_binding_id: id(8),
    binding_rfq_id: id(1),
    binding_rfq_line_id: id(2),
    binding_supplier_id: id(5),
    binding_material_id: id(6),
    binding_mapping_fact_id: id(9),
    binding_supplier_unit_id: id(7),
    mapping_fact_id: id(9),
    mapping_supplier_id: id(5),
    mapping_material_id: id(6),
    mapping_supplier_unit_id: id(7),
    internal_unit_id: id(7),
    latest_mapping_fact_id: id(9),
  });
}

function assertFailure(name, overrides, expectedCode, expectedMessage) {
  const raw = completeRawRow(1, overrides);
  const qualification = buildAwardMappingQualification([raw], OBSERVED_AT);
  assert.equal(qualification.all_qualified, false, name);
  assert.equal(qualification.qualified_line_count, 0, name);
  assert.equal(qualification.line_count, 1, name);
  const line = qualification.lines[0];
  assert.equal(line.qualified, false, name);
  assert.equal(line.error_code, expectedCode, name);
  assert.ok(
    line.reason.startsWith(`Award Line ${raw.award_line_id} / Supplier ${raw.supplier_id} / Material ${raw.material_id}：`),
    `${name}: ${line.reason}`,
  );
  assert.match(line.reason, /[\u3400-\u9fff]/u, name);
  assert.match(line.reason, expectedMessage, name);
}

test("four fixed Award lines are fully qualified with complete stable credentials", () => {
  const qualification = buildAwardMappingQualification(
    [4, 2, 1, 3].map((ordinal) => completeRawRow(ordinal)),
    OBSERVED_AT,
  );
  assert.equal(qualification.contract_version, "AWARD_PO_MAPPING_QUALIFICATION_V1");
  assert.equal(qualification.observed_at, OBSERVED_AT);
  assert.equal(qualification.data_timezone, "Asia/Shanghai");
  assert.equal(qualification.all_qualified, true);
  assert.equal(qualification.qualified_line_count, 4);
  assert.equal(qualification.line_count, 4);
  assert.match(qualification.qualification_digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(qualification.lines.map((line) => line.award_line_id), ["1", "2", "3", "4"]);
  assert.deepEqual(
    qualification.lines.map((line) => [line.candidate_id, line.quote_line_id, line.rfq_binding_id, line.mapping_fact_id]),
    [["2", "1", "101", "1"], ["4", "2", "102", "2"], ["6", "3", "103", "3"], ["8", "4", "104", "4"]],
  );
  for (const line of qualification.lines) {
    assert.equal(line.qualified, true);
    assert.equal(line.error_code, null);
    assert.equal(line.reason, "Supplier Mapping资格通过");
    assert.equal(line.binding_status, "ACTIVE");
    assert.equal(line.mapping_status, "ACTIVE");
    assert.equal(line.conversion_numerator, "1");
    assert.equal(line.conversion_denominator, "1");
    assert.equal(line.supplier_material_conflict_count, 0);
    assert.equal(line.supplier_part_number_conflict_count, 0);
  }
});

test("bigint IDs remain decimal strings, sort exactly, and digest excludes observed_at", () => {
  const awardLineIds = [
    "90071992547409930",
    "9007199254740993",
    "90071992547409920",
    "9007199254740994",
  ];
  const rows = awardLineIds.map((awardLineId, index) => completeBigIntRow(awardLineId, index + 1));
  const first = buildAwardMappingQualification(rows, "2026-08-08T02:00:00.000000Z");
  const second = buildAwardMappingQualification([...rows].reverse(), "2026-08-09T03:04:05.000000Z");
  assert.equal(first.all_qualified, true);
  assert.equal(second.all_qualified, true);
  assert.deepEqual(first.lines.map((line) => line.award_line_id), [
    "9007199254740993",
    "9007199254740994",
    "90071992547409920",
    "90071992547409930",
  ]);
  assert.deepEqual(second.lines, first.lines);
  assert.equal(second.qualification_digest, first.qualification_digest);
  assert.notEqual(second.observed_at, first.observed_at);
  for (const line of first.lines) {
    for (const field of ["award_line_id", "candidate_id", "quote_line_id", "rfq_binding_id", "supplier_id", "material_id", "mapping_fact_id", "supplier_unit_id", "internal_unit_id"]) {
      assert.equal(typeof line[field], "string", `${field} must remain a string`);
      assert.ok(BigInt(line[field]) > BigInt(Number.MAX_SAFE_INTEGER), `${field}:${line[field]}`);
    }
  }
});

test("qualification SQL follows the fixed Binding fact and never joins Mapping Event history", async () => {
  const source = await readFile(new URL("../app/lib/procurement-fulfillment-selfhost/award-mapping-qualification.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bsupplier_mapping_events\b/i);
  assert.match(source, /left join supplier_mappings mapping on mapping\.id=binding\.supplier_mapping_version_id/i);
  assert.match(source, /candidate\.comparison_id=line\.comparison_id[\s\S]*candidate\.quote_line_id=line\.selected_quote_line_id[\s\S]*candidate\.supplier_id=line\.supplier_id/i);
  assert.match(source, /candidate_binding\.rfq_id=award\.rfq_id[\s\S]*candidate_binding\.rfq_line_id=line\.rfq_line_id[\s\S]*candidate_binding\.supplier_id=line\.supplier_id/i);
});

test("Candidate, Quote and fixed RFQ Binding lineage failures have stable scoped errors", () => {
  const cases = [
    ["Candidate missing", { candidate_id: null, candidate_count: 0 }, "AWARD_MAPPING_LINEAGE_INVALID", /Candidate或Quote Line固定谱系/],
    ["Candidate duplicate", { candidate_count: 2 }, "AWARD_MAPPING_LINEAGE_INVALID", /缺失、重复或跨越RFQ Line/],
    ["Quote Line missing", { quote_line_id: null }, "AWARD_MAPPING_LINEAGE_INVALID", /Candidate或Quote Line固定谱系/],
    ["Quote Line crosses RFQ scope", { quote_line_scope_matches: false }, "AWARD_MAPPING_LINEAGE_INVALID", /跨越RFQ Line/],
    ["Binding missing", { binding_count: 0, rfq_binding_id: null }, "AWARD_MAPPING_BINDING_MISSING", /缺少固定RFQ Binding/],
    ["Binding duplicate", { binding_count: 2 }, "AWARD_MAPPING_BINDING_CONFLICT", /数量为2，要求恰好1条/],
    ["Binding RFQ scope mismatch", { binding_rfq_id: "2" }, "AWARD_MAPPING_BINDING_SCOPE_MISMATCH", /与Award Supplier、RFQ Line或Material不一致/],
    ["Binding RFQ Line scope mismatch", { binding_rfq_line_id: "2" }, "AWARD_MAPPING_BINDING_SCOPE_MISMATCH", /与Award Supplier、RFQ Line或Material不一致/],
    ["Binding Supplier scope mismatch", { binding_supplier_id: "2" }, "AWARD_MAPPING_BINDING_SCOPE_MISMATCH", /与Award Supplier、RFQ Line或Material不一致/],
    ["Binding Material scope mismatch", { binding_material_id: "999" }, "AWARD_MAPPING_BINDING_SCOPE_MISMATCH", /与Award Supplier、RFQ Line或Material不一致/],
  ];
  for (const [name, overrides, code, message] of cases) assertFailure(name, overrides, code, message);
});

test("Mapping Fact identity, UUID, version, Row CAS and digest snapshots fail closed on drift", () => {
  const cases = [
    ["Mapping Fact missing", { mapping_fact_id: null }, "AWARD_MAPPING_FACT_MISSING", /引用的Mapping Fact不存在/],
    ["Mapping UUID missing", { mapping_uuid: null, binding_mapping_uuid: null }, "AWARD_MAPPING_FACT_CREDENTIAL_INVALID", /UUID、Version、Row CAS、Supplier Part或有效期凭证不完整/],
    ["Mapping Version missing", { mapping_version_no: null, binding_mapping_version_no: null }, "AWARD_MAPPING_FACT_CREDENTIAL_INVALID", /凭证不完整/],
    ["Mapping Row CAS missing", { mapping_row_cas: null, binding_mapping_row_cas: null }, "AWARD_MAPPING_FACT_CREDENTIAL_INVALID", /凭证不完整/],
    ["Supplier Part missing", { supplier_part_number: null, binding_supplier_part_number: null }, "AWARD_MAPPING_FACT_CREDENTIAL_INVALID", /凭证不完整/],
    ["valid_from missing", { valid_from: null }, "AWARD_MAPPING_FACT_CREDENTIAL_INVALID", /凭证不完整/],
    ["Mapping Fact ID snapshot drift", { binding_mapping_fact_id: "2" }, "AWARD_MAPPING_BINDING_FACT_DRIFT", /快照与精确Mapping Fact 1不一致/],
    ["Mapping UUID snapshot drift", { binding_mapping_uuid: "10000000-0000-4000-8000-000000000001" }, "AWARD_MAPPING_BINDING_FACT_DRIFT", /快照与精确Mapping Fact 1不一致/],
    ["Mapping business version snapshot drift", { binding_mapping_version_no: 2 }, "AWARD_MAPPING_BINDING_FACT_DRIFT", /快照与精确Mapping Fact 1不一致/],
    ["Mapping Row CAS snapshot drift", { binding_mapping_row_cas: 4 }, "AWARD_MAPPING_BINDING_FACT_DRIFT", /快照与精确Mapping Fact 1不一致/],
    ["Mapping validity snapshot drift", { binding_valid_from_matches: false }, "AWARD_MAPPING_BINDING_FACT_DRIFT", /快照与精确Mapping Fact 1不一致/],
    ["Mapping digest snapshot drift", { binding_content_digest: "b".repeat(64) }, "AWARD_MAPPING_DIGEST_DRIFT", /content digest缺失或不一致/],
    ["Mapping digest missing", { binding_content_digest: null, mapping_content_digest: null }, "AWARD_MAPPING_DIGEST_DRIFT", /content digest缺失或不一致/],
    ["Mapping Fact Supplier scope drift", { mapping_supplier_id: "2" }, "AWARD_MAPPING_FACT_SCOPE_MISMATCH", /Supplier或Material与Award不一致/],
    ["Mapping Fact Material scope drift", { mapping_material_id: "999" }, "AWARD_MAPPING_FACT_SCOPE_MISMATCH", /Supplier或Material与Award不一致/],
  ];
  for (const [name, overrides, code, message] of cases) assertFailure(name, overrides, code, message);
});

test("Binding, Mapping, Supplier, Material, inventory type and effective period status fail closed", () => {
  const cases = [
    ["Binding inactive", { binding_status: "INACTIVE" }, "AWARD_MAPPING_BINDING_NOT_ACTIVE", /状态不是ACTIVE/],
    ["Mapping inactive", { mapping_status: "INACTIVE" }, "AWARD_MAPPING_NOT_ACTIVE", /状态为INACTIVE/],
    ["Supplier inactive", { supplier_status: "INACTIVE" }, "AWARD_MAPPING_SUPPLIER_NOT_ACTIVE", /Supplier状态为INACTIVE/],
    ["Material inactive", { material_status: "INACTIVE" }, "AWARD_MAPPING_MATERIAL_NOT_ACTIVE", /Material状态为INACTIVE/],
    ["Material non-stocked", { material_inventory_type: "NON_STOCKED" }, "AWARD_MAPPING_MATERIAL_NOT_STOCKED", /Material库存类型为NON_STOCKED/],
    ["Mapping not yet effective", { mapping_effective_now: false }, "AWARD_MAPPING_NOT_YET_EFFECTIVE", /尚未生效/],
    ["Mapping expired", { mapping_expired_now: true }, "AWARD_MAPPING_EXPIRED", /已失效/],
  ];
  for (const [name, overrides, code, message] of cases) assertFailure(name, overrides, code, message);
});

test("legacy base_uom resolves one enabled Unit while missing, duplicate and mismatched Units fail closed", async () => {
  const source = await readFile(new URL("../app/lib/procurement-fulfillment-selfhost/award-mapping-qualification.ts", import.meta.url), "utf8");
  assert.match(source, /material\.base_unit_id is null[\s\S]*upper\(candidate_unit\.code\)=upper\(btrim\(material\.base_uom\)\)/i);

  const uniqueLegacyUnit = buildAwardMappingQualification([completeRawRow()], OBSERVED_AT);
  assert.equal(uniqueLegacyUnit.all_qualified, true);
  assert.deepEqual(
    [uniqueLegacyUnit.lines[0].supplier_unit_id, uniqueLegacyUnit.lines[0].supplier_unit_code, uniqueLegacyUnit.lines[0].internal_unit_id, uniqueLegacyUnit.lines[0].internal_unit_code],
    ["1", "PCS", "1", "PCS"],
  );

  const cases = [
    ["Internal Unit missing", { internal_unit_match_count: 0, internal_unit_id: null, internal_unit_code: null }, "AWARD_MAPPING_INTERNAL_UNIT_UNRESOLVED", /未唯一解析为启用Unit/],
    ["Internal Unit duplicate", { internal_unit_match_count: 2 }, "AWARD_MAPPING_INTERNAL_UNIT_UNRESOLVED", /未唯一解析为启用Unit/],
    ["Supplier Unit disabled", { supplier_unit_enabled: false }, "AWARD_MAPPING_INTERNAL_UNIT_UNRESOLVED", /未唯一解析为启用Unit/],
    ["Material base_uom text mismatch", { material_base_uom_matches: false }, "AWARD_MAPPING_INTERNAL_UNIT_UNRESOLVED", /未唯一解析为启用Unit/],
    ["Internal Unit mismatch", { internal_unit_id: "2", internal_unit_code: "BOX" }, "AWARD_MAPPING_UNIT_MISMATCH", /Supplier Unit、Internal Unit与RFQ Unit不一致/],
    ["Supplier Unit mismatch", { mapping_supplier_unit_id: "2", binding_supplier_unit_id: "2", supplier_unit_code: "BOX" }, "AWARD_MAPPING_UNIT_MISMATCH", /Supplier Unit、Internal Unit与RFQ Unit不一致/],
  ];
  for (const [name, overrides, code, message] of cases) assertFailure(name, overrides, code, message);
});

test("any positive equal ratio is 1:1 while unequal ratios fail with a stable error", () => {
  const twoToTwo = completeRawRow(1, {
    binding_conversion_numerator: "2",
    binding_conversion_denominator: "2",
    conversion_numerator: "2",
    conversion_denominator: "2",
  });
  const qualification = buildAwardMappingQualification([twoToTwo], OBSERVED_AT);
  assert.equal(qualification.all_qualified, true);
  assert.equal(qualification.lines[0].qualified, true);
  assert.deepEqual([qualification.lines[0].conversion_numerator, qualification.lines[0].conversion_denominator], ["2", "2"]);

  assertFailure("2:3 conversion", {
    binding_conversion_numerator: "2",
    binding_conversion_denominator: "3",
    conversion_numerator: "2",
    conversion_denominator: "3",
  }, "AWARD_MAPPING_CONVERSION_NOT_ONE_TO_ONE", /换算率不是正数1:1/);
});

test("Supplier/Material, Supplier Part and latest Mapping version conflicts fail closed", () => {
  const cases = [
    ["Supplier Material active conflict", { supplier_material_conflict_count: 1 }, "AWARD_MAPPING_SUPPLIER_MATERIAL_CONFLICT", /另有1条当前ACTIVE 1:1 Mapping/],
    ["Supplier Part active conflict", { supplier_part_number_conflict_count: 1 }, "AWARD_MAPPING_SUPPLIER_PART_CONFLICT", /supplier_part_number另有1条当前ACTIVE Mapping/],
    ["Latest Mapping Fact drift", { latest_mapping_fact_id: "2" }, "AWARD_MAPPING_VERSION_DRIFT", /已不是该Mapping UUID的最新版本/],
    ["Latest Mapping business version drift", { latest_mapping_version_no: 2 }, "AWARD_MAPPING_VERSION_DRIFT", /已不是该Mapping UUID的最新版本/],
  ];
  for (const [name, overrides, code, message] of cases) assertFailure(name, overrides, code, message);
});
