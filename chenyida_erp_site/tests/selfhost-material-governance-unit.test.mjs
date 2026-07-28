import assert from "node:assert/strict";
import test from "node:test";

import {
  governMaterialBatch,
  governMaterialSource,
} from "../app/lib/material-governance-selfhost/engine.ts";
import { MATERIAL_GOVERNANCE_LIMITS } from "../app/lib/material-governance-selfhost/config.ts";
import { draftSource, materialSource } from "../app/lib/material-governance-selfhost/source-adapter.ts";

test("0201 vendor code and explicit 0R specification share one strict identity", () => {
  const result = governMaterialBatch([
    { sourceKey: "vendor", originalPartNumber: "0201WMJ0000TCE", supplier: "供应商甲", sourceBom: "A118_BOM" },
    { sourceKey: "explicit", specification: "0201,0R,±5%", supplier: "供应商乙", supplierPartNumber: "SUP-0201-0R", sourceBom: "A118_BOM" },
  ]);
  assert.equal(result.groups.length, 1);
  const group = result.groups[0];
  assert.equal(group.category, "RES");
  assert.equal(group.canonicalKey, "RES_0201_0R_5_1-20W");
  assert.equal(group.sources.length, 2);
  assert.match(group.identityDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(group.mergeEvidence.slice(0, 3), ["CATEGORY_EQUAL", "PACKAGE_EQUAL", "RESISTANCE_EQUAL"]);
  assert.equal(group.supplierCandidates.length, 2);
  assert.equal(group.supplierCandidates[1].candidateKind, "ALTERNATIVE_SOURCE");
  assert.ok(group.supplierCandidates.some((candidate) => candidate.supplierPartNumber === "SUP-0201-0R"));
});

test("brand-only same-spec sources remain visible as primary and alternative source candidates", () => {
  const result = governMaterialBatch([
    { sourceKey: "brand-a", categoryHint: "RES", specification: "0201 10K ±1% 1/20W", brand: "BRAND-A" },
    { sourceKey: "brand-b", categoryHint: "RES", specification: "0201 10K ±1% 1/20W", brand: "BRAND-B" },
  ]);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].supplierCandidates.length, 2);
  assert.deepEqual(new Set(result.groups[0].supplierCandidates.map((candidate) => candidate.brand)), new Set(["BRAND-A", "BRAND-B"]));
  assert.deepEqual(
    new Set(result.groups[0].supplierCandidates.map((candidate) => candidate.candidateKind)),
    new Set(["PRIMARY_SOURCE", "ALTERNATIVE_SOURCE"]),
  );
});

test("capacitance uses lossless pF identity and never merges 1uF with 100pF", () => {
  const result = governMaterialBatch([
    { sourceKey: "one-uf", categoryHint: "CAP", specification: "0201 1uF 6.3V X5R ±10%" },
    { sourceKey: "thousand-nf", categoryHint: "CAP", specification: "0201 1000nF 6.3V X5R ±10%" },
    { sourceKey: "hundred-pf", categoryHint: "CAP", specification: "0201 100pF 6.3V X5R ±10%" },
  ]);
  assert.equal(result.groups.length, 2);
  const oneMicrofarad = result.groups.find((group) => group.sources.length === 2);
  assert.ok(oneMicrofarad);
  assert.equal(oneMicrofarad.canonicalKey, "CAP_0201_1UF_6.3V_X5R_10");
  const hundredPicofarad = result.groups.find((group) => group.sources[0].source.sourceKey === "hundred-pf");
  assert.ok(hundredPicofarad);
  assert.notEqual(oneMicrofarad.identityDigest, hundredPicofarad.identityDigest);
  assert.equal(hundredPicofarad.components.find((item) => item.code === "CAPACITANCE").normalizedValue, "100000000");
});

test("every passive performance difference creates a separate group", () => {
  const base = { categoryHint: "RES", specification: "0201 10K ±1% 1/20W" };
  const result = governMaterialBatch([
    { ...base, sourceKey: "base" },
    { sourceKey: "package", categoryHint: "RES", specification: "0402 10K ±1% 1/20W" },
    { sourceKey: "value", categoryHint: "RES", specification: "0201 12K ±1% 1/20W" },
    { sourceKey: "tolerance", categoryHint: "RES", specification: "0201 10K ±5% 1/20W" },
    { sourceKey: "power", categoryHint: "RES", specification: "0201 10K ±1% 1/16W" },
  ]);
  assert.equal(result.groups.length, 5);
  assert.equal(new Set(result.groups.map((group) => group.identityDigest)).size, 5);
});

test("only the explicitly approved 0201 profile supplies default resistor power", () => {
  const approved = governMaterialSource({ sourceKey: "0201-default", categoryHint: "RES", specification: "0201 10K ±1%" });
  assert.equal(approved.readiness, "READY");
  assert.equal(approved.canonicalKey, "RES_0201_10K_1_1-20W");

  const unapproved = governMaterialSource({ sourceKey: "0402-no-power", categoryHint: "RES", specification: "0402 10K ±1%" });
  assert.equal(unapproved.readiness, "REVIEW_REQUIRED");
  assert.equal(unapproved.identityDigest, null);
  assert.ok(unapproved.issues.some((issue) => issue.code === "GOVERNANCE_POWER_MISSING"));
});

test("IC identity keeps the complete model and package and never performs stem matching", () => {
  const full = governMaterialSource({ sourceKey: "full", categoryHint: "IC", manufacturerPartNumber: "TPS7A2033PDBVR" });
  const stem = governMaterialSource({ sourceKey: "stem", categoryHint: "IC", manufacturerPartNumber: "TPS7A2033" });
  assert.equal(full.readiness, "READY");
  assert.equal(full.components.find((item) => item.code === "MODEL").normalizedValue, "TPS7A2033PDBVR");
  assert.equal(full.components.find((item) => item.code === "PACKAGE").normalizedValue, "SOT-23-5");
  assert.equal(stem.readiness, "REVIEW_REQUIRED");
  assert.equal(stem.identityDigest, null);
});

test("controlled package lexical variants canonicalize to the same exact identity", () => {
  const decoded = governMaterialSource({ sourceKey: "package-decoder", categoryHint: "IC", manufacturerPartNumber: "TPS7A2033PDBVR" });
  const compact = governMaterialSource({
    sourceKey: "package-compact",
    categoryHint: "IC",
    manufacturerPartNumber: "TPS7A2033PDBVR",
    specification: "SOT23-5",
  });
  assert.equal(compact.readiness, "READY");
  assert.equal(compact.components.find((item) => item.code === "PACKAGE").normalizedValue, "SOT-23-5");
  assert.equal(compact.identityDigest, decoded.identityDigest);
  assert.equal(compact.issues.some((issue) => issue.code === "GOVERNANCE_PACKAGE_CONFLICT"), false);

  const dck = governMaterialSource({
    sourceKey: "package-sc-compact",
    categoryHint: "IC",
    manufacturerPartNumber: "TPS7A2033DCKR",
    specification: "SC70-5",
  });
  assert.equal(dck.readiness, "READY");
  assert.equal(dck.components.find((item) => item.code === "PACKAGE").normalizedValue, "SC-70-5");
  assert.equal(dck.issues.some((issue) => issue.code === "GOVERNANCE_PACKAGE_CONFLICT"), false);
});

test("model-sensitive categories never infer specifications from unknown model text", () => {
  const unknownPackage = governMaterialSource({
    sourceKey: "unknown-model-package",
    categoryHint: "IC",
    manufacturerPartNumber: "FOO-SOT-23-5",
  });
  assert.equal(unknownPackage.readiness, "REVIEW_REQUIRED");
  assert.ok(unknownPackage.issues.some((item) => item.code === "GOVERNANCE_PACKAGE_MISSING"));

  const namedProfile = governMaterialSource({
    sourceKey: "named-model-package-profile",
    categoryHint: "IC",
    manufacturerPartNumber: "TPS7A2033PDBVR",
  });
  assert.equal(namedProfile.readiness, "READY");
  assert.ok(namedProfile.components.find((item) => item.code === "PACKAGE").evidence.includes("MODEL_SUFFIX_PACKAGE_DECODER"));

  const connector = governMaterialSource({
    sourceKey: "unknown-connector-model",
    categoryHint: "CON",
    model: "ABC-5P-2.0MM-STRAIGHT",
    brand: "BRAND-A",
  });
  assert.equal(connector.readiness, "REVIEW_REQUIRED");
  assert.ok(connector.issues.some((item) => item.code === "GOVERNANCE_PIN_COUNT_MISSING"));
  assert.ok(connector.issues.some((item) => item.code === "GOVERNANCE_PITCH_MISSING"));
  assert.ok(connector.issues.some((item) => item.code === "GOVERNANCE_STRUCTURE_MISSING"));

  const oscillator = governMaterialSource({
    sourceKey: "unknown-oscillator-model",
    categoryHint: "OSC",
    model: "OSC-16MHZ-01",
    specification: "SOT-23-5",
  });
  assert.equal(oscillator.readiness, "REVIEW_REQUIRED");
  assert.ok(oscillator.issues.some((item) => item.code === "GOVERNANCE_FREQUENCY_MISSING"));
});

test("connector compatibility suggests but never applies a formal alternative", () => {
  const result = governMaterialBatch([
    { sourceKey: "jst", categoryHint: "CON", model: "B5B-PH-K", supplierPartNumber: "JST-SUP-5", brand: "JST", specification: "5PIN 2.0mm 立式" },
    { sourceKey: "molex", categoryHint: "CON", model: "MOLEX-5P-20", supplierPartNumber: "MOLEX-SUP-5", brand: "MOLEX", specification: "5PIN 2.0mm 立式" },
  ]);
  assert.equal(result.groups.length, 2);
  assert.equal(result.alternativeSuggestions.length, 1);
  assert.deepEqual(result.alternativeSuggestions[0].evidence, ["CATEGORY_EQUAL", "COMPATIBILITY_COMPONENTS_EQUAL", "IDENTITY_COMPONENTS_DIFFER"]);
});

test("oscillator package profiles produce ready identities and review-only alternatives", () => {
  const result = governMaterialBatch([
    { sourceKey: "osc-a", categoryHint: "OSC", model: "OSC-A-16M", specification: "SMD3225 16MHz" },
    { sourceKey: "osc-b", categoryHint: "OSC", model: "OSC-B-16M", specification: "3.2x2.5mm 16MHz" },
  ]);
  assert.equal(result.groups.length, 2);
  assert.ok(result.groups.every((group) => group.readiness === "READY"));
  assert.ok(result.groups.every((group) => group.components.some((component) => component.code === "PACKAGE" && component.normalizedValue === "SMD-3225")));
  assert.equal(result.alternativeSuggestions.length, 1);
  assert.deepEqual(result.alternativeSuggestions[0].evidence, [
    "CATEGORY_EQUAL",
    "COMPATIBILITY_COMPONENTS_EQUAL",
    "IDENTITY_COMPONENTS_DIFFER",
  ]);
});

test("connector placeholder brands never become identity components", () => {
  for (const brand of ["UNKNOWN", "UNSPECIFIED", "N/A", "NA", "未知"]) {
    const result = governMaterialSource({
      sourceKey: `placeholder-brand-${brand}`,
      categoryHint: "CON",
      model: "ABC123",
      brand,
      specification: "5PIN 2.0mm 立式",
      upstreamIssues: [{
        level: "WARNING",
        code: "NORMALIZATION_BRAND_UNKNOWN",
        field: "brand",
        message: "品牌为未知占位值",
        evidence: [],
      }],
    });
    assert.equal(result.readiness, "REVIEW_REQUIRED", brand);
    assert.equal(result.identityDigest, null, brand);
    assert.ok(result.issues.some((item) => item.code === "GOVERNANCE_BRAND_MISSING"), brand);
    assert.ok(result.issues.some((item) => item.code === "NORMALIZATION_BRAND_UNKNOWN" && item.level === "WARNING"), brand);
  }
});

test("incomplete specifications stay separate and enter the exception report", () => {
  const result = governMaterialBatch([
    { sourceKey: "cap-a", categoryHint: "CAP", specification: "0201 1uF" },
    { sourceKey: "cap-b", categoryHint: "CAP", specification: "0201 100pF" },
  ]);
  assert.equal(result.groups.length, 2);
  assert.equal(result.exceptions.length, 2);
  assert.ok(result.exceptions.every((row) => row.identityDigest === null));
  assert.ok(result.exceptions.every((row) => row.issues.some((item) => item.code === "GOVERNANCE_VOLTAGE_MISSING")));
});

test("unsupported tolerance tokens cannot be truncated into an allowed value", () => {
  const result = governMaterialSource({ sourceKey: "tol-15", categoryHint: "RES", specification: "0201 10K ±15% 1/20W" });
  assert.equal(result.readiness, "REVIEW_REQUIRED");
  assert.equal(result.identityDigest, null);
  assert.ok(result.issues.some((item) => item.code === "GOVERNANCE_TOLERANCE_MISSING"));
  assert.equal(result.components.some((item) => item.code === "TOLERANCE" && item.normalizedValue === "5"), false);
});

test("category aliases are delimiter-aware and ambiguous evidence fails closed", () => {
  assert.equal(governMaterialSource({ sourceKey: "mechanical", categoryHint: "MECHANICAL", specification: "外壳" }).category, "MECH");
  assert.equal(governMaterialSource({ sourceKey: "transformer", categoryHint: "TRANSFORMER", specification: "custom part" }).category, "OTHER");
  const ambiguous = governMaterialSource({ sourceKey: "ambiguous", specification: "TPS7A2033PDBVR 100MHz" });
  assert.equal(ambiguous.category, "OTHER");
  assert.equal(ambiguous.readiness, "UNSUPPORTED");
  const explicit = governMaterialSource({ sourceKey: "explicit-ic", categoryHint: "IC", manufacturerPartNumber: "TPS7A2033PDBVR", specification: "100MHz" });
  assert.equal(explicit.category, "IC");
});

test("formal material adapters accept only versioned category allowlist entries", () => {
  assert.equal(materialSource({
    id: 1,
    category_code: "IC_FUTURE_UNMAPPED",
    standard_name: "未来 IC",
    manufacturer_part_number: "ABC123",
    attributes: [{ code: "PACKAGE", value: "QFN-8", unit: "" }],
  }), null);
  assert.equal(draftSource({
    category_id: 1,
    basic_fields: { standard_name: "未来电容" },
    attributes: { PACKAGE: { value: "0201" }, CAPACITANCE: { value: "0.000001", unit: "F" } },
  }, "CAP_FUTURE_UNMAPPED"), null);
  assert.ok(materialSource({
    id: 2,
    category_code: "IC_QFN",
    standard_name: "受控 IC",
    manufacturer_part_number: "ABC123",
    attributes: [{ code: "PACKAGE", value: "QFN-8", unit: "" }],
  }));
});

test("vendor-code conflicts are blocking and never silently prefer either source", () => {
  const result = governMaterialSource({
    sourceKey: "conflict",
    categoryHint: "RES",
    originalPartNumber: "0201WMJ0000TCE",
    specification: "0402 10K ±1% 1/16W",
  });
  assert.equal(result.readiness, "REVIEW_REQUIRED");
  assert.equal(result.identityDigest, null);
  assert.deepEqual(
    result.issues.filter((item) => item.code.endsWith("_CONFLICT")).map((item) => item.code).sort(),
    ["GOVERNANCE_PACKAGE_CONFLICT", "GOVERNANCE_POWER_CONFLICT", "GOVERNANCE_RESISTANCE_CONFLICT", "GOVERNANCE_TOLERANCE_CONFLICT"],
  );
});

test("multiple explicit passive values fail closed for every identity and performance field", () => {
  const resistor = governMaterialSource({
    sourceKey: "res-multiple-values",
    categoryHint: "RES",
    specification: "0201 0402 10K 12K ±1% ±5% 1/20W 1/16W",
  });
  assert.equal(resistor.readiness, "REVIEW_REQUIRED");
  assert.equal(resistor.identityDigest, null);
  assert.deepEqual(
    resistor.issues.filter((item) => item.code.endsWith("_CONFLICT")).map((item) => item.code).sort(),
    [
      "GOVERNANCE_PACKAGE_CONFLICT",
      "GOVERNANCE_POWER_CONFLICT",
      "GOVERNANCE_RESISTANCE_CONFLICT",
      "GOVERNANCE_TOLERANCE_CONFLICT",
    ],
  );

  const capacitor = governMaterialSource({
    sourceKey: "cap-multiple-values",
    categoryHint: "CAP",
    specification: "0201 1uF 100pF 6.3V 10V X5R X7R ±10% ±5%",
  });
  assert.equal(capacitor.readiness, "REVIEW_REQUIRED");
  assert.equal(capacitor.identityDigest, null);
  assert.deepEqual(
    capacitor.issues.filter((item) => item.code.endsWith("_CONFLICT")).map((item) => item.code).sort(),
    [
      "GOVERNANCE_CAPACITANCE_CONFLICT",
      "GOVERNANCE_DIELECTRIC_CONFLICT",
      "GOVERNANCE_TOLERANCE_CONFLICT",
      "GOVERNANCE_VOLTAGE_CONFLICT",
    ],
  );

  const inductor = governMaterialSource({
    sourceKey: "ind-multiple-values",
    categoryHint: "IND",
    specification: "0201 10uH 22uH 1A 2A ±10% ±20%",
  });
  assert.equal(inductor.readiness, "REVIEW_REQUIRED");
  assert.equal(inductor.identityDigest, null);
  assert.deepEqual(
    inductor.issues.filter((item) => item.code.endsWith("_CONFLICT")).map((item) => item.code).sort(),
    [
      "GOVERNANCE_INDUCTANCE_CONFLICT",
      "GOVERNANCE_RATED_CURRENT_CONFLICT",
      "GOVERNANCE_TOLERANCE_CONFLICT",
    ],
  );
});

test("repeated equivalent explicit values normalize to one value without a false conflict", () => {
  const result = governMaterialSource({
    sourceKey: "cap-equivalent-values",
    categoryHint: "CAP",
    specification: "0201 1uF 1000nF 6.3V 6300mV X5R X5R ±10% 10.0%",
  });
  assert.equal(result.readiness, "READY");
  assert.equal(result.canonicalKey, "CAP_0201_1UF_6.3V_X5R_10");
  assert.equal(result.issues.some((item) => item.code.endsWith("_CONFLICT")), false);
});

test("zero is allowed only for resistance and blocks every positive-only specification", () => {
  const zeroResistance = governMaterialSource({
    sourceKey: "zero-resistance",
    categoryHint: "RES",
    specification: "0201 0R ±5% 1/20W",
  });
  assert.equal(zeroResistance.readiness, "READY");

  const cases = [
    {
      sourceKey: "zero-power",
      categoryHint: "RES",
      specification: "0201 10K ±1% 0W",
      codes: ["GOVERNANCE_POWER_CONFLICT"],
    },
    {
      sourceKey: "zero-capacitance-voltage",
      categoryHint: "CAP",
      specification: "0201 0pF 0V X5R ±10%",
      codes: ["GOVERNANCE_CAPACITANCE_CONFLICT", "GOVERNANCE_VOLTAGE_CONFLICT"],
    },
    {
      sourceKey: "zero-inductance-current",
      categoryHint: "IND",
      specification: "0201 0H 0A ±10%",
      codes: ["GOVERNANCE_INDUCTANCE_CONFLICT", "GOVERNANCE_RATED_CURRENT_CONFLICT"],
    },
    {
      sourceKey: "zero-connector",
      categoryHint: "CON",
      model: "CON-EXACT-01",
      brand: "BRAND-A",
      specification: "0PIN 0mm 立式",
      codes: ["GOVERNANCE_PIN_COUNT_CONFLICT", "GOVERNANCE_PITCH_CONFLICT"],
    },
    {
      sourceKey: "zero-frequency",
      categoryHint: "OSC",
      model: "OSC-EXACT-01",
      specification: "SMD3225 0Hz",
      codes: ["GOVERNANCE_FREQUENCY_CONFLICT"],
    },
  ];
  for (const input of cases) {
    const { codes, ...source } = input;
    const result = governMaterialSource(source);
    assert.equal(result.readiness, "REVIEW_REQUIRED", source.sourceKey);
    for (const code of codes) assert.ok(result.issues.some((item) => item.code === code), `${source.sourceKey}:${code}`);
  }
});

test("negative physical quantities never lose their sign and become positive identity evidence", () => {
  const cases = [
    { sourceKey: "negative-resistance", categoryHint: "RES", specification: "0201 -1ohm ±5% 1/20W", code: "GOVERNANCE_RESISTANCE_CONFLICT" },
    { sourceKey: "negative-power", categoryHint: "RES", specification: "0201 1K ±5% -1/20W", code: "GOVERNANCE_POWER_CONFLICT" },
    { sourceKey: "negative-capacitance", categoryHint: "CAP", specification: "0201 -1uF 6.3V X5R ±10%", code: "GOVERNANCE_CAPACITANCE_CONFLICT" },
    { sourceKey: "negative-voltage", categoryHint: "CAP", specification: "0201 1uF -6.3V X5R ±10%", code: "GOVERNANCE_VOLTAGE_CONFLICT" },
    { sourceKey: "negative-tolerance", categoryHint: "CAP", specification: "0201 1uF 6.3V X5R -10%", code: "GOVERNANCE_TOLERANCE_CONFLICT" },
    { sourceKey: "negative-inductance", categoryHint: "IND", specification: "0201 -10uH 1A ±10%", code: "GOVERNANCE_INDUCTANCE_CONFLICT" },
    { sourceKey: "negative-current", categoryHint: "IND", specification: "0201 10uH -1A ±10%", code: "GOVERNANCE_RATED_CURRENT_CONFLICT" },
    { sourceKey: "negative-pin", categoryHint: "CON", model: "CON-NEG-01", brand: "JST", specification: "-4PIN 2.0mm 立式", code: "GOVERNANCE_PIN_COUNT_CONFLICT" },
    { sourceKey: "negative-pitch", categoryHint: "CON", model: "CON-NEG-02", brand: "JST", specification: "4PIN -2.0mm 立式", code: "GOVERNANCE_PITCH_CONFLICT" },
  ];
  for (const input of cases) {
    const { code, ...source } = input;
    const result = governMaterialSource(source);
    assert.equal(result.readiness, "REVIEW_REQUIRED", source.sourceKey);
    assert.equal(result.identityDigest, null, source.sourceKey);
    assert.ok(result.issues.some((issue) => issue.code === code), `${source.sourceKey}:${code}`);
  }
});

test("IC explicit packages conflict with each other and with a model suffix decoder", () => {
  const decoded = governMaterialSource({
    sourceKey: "ic-decoder-package-conflict",
    categoryHint: "IC",
    manufacturerPartNumber: "TPS7A2033PDBVR",
    specification: "QFN-8",
  });
  assert.equal(decoded.readiness, "REVIEW_REQUIRED");
  assert.equal(decoded.identityDigest, null);
  assert.equal(decoded.issues.filter((item) => item.code === "GOVERNANCE_PACKAGE_CONFLICT").length, 1);
  assert.ok(decoded.issues.find((item) => item.code === "GOVERNANCE_PACKAGE_CONFLICT").evidence.includes("MODEL_SUFFIX_PACKAGE_DECODER"));

  const explicit = governMaterialSource({
    sourceKey: "ic-explicit-package-conflict",
    categoryHint: "IC",
    model: "ABC123",
    specification: "QFN-8 TSSOP-8",
  });
  assert.equal(explicit.readiness, "REVIEW_REQUIRED");
  assert.equal(explicit.identityDigest, null);
  assert.equal(explicit.issues.filter((item) => item.code === "GOVERNANCE_PACKAGE_CONFLICT").length, 1);
});

test("IC readiness is limited to packages covered by a formal metadata leaf", () => {
  const covered = governMaterialSource({
    sourceKey: "ic-covered-package",
    categoryHint: "IC",
    model: "ABC123",
    specification: "TSSOP-8",
  });
  assert.equal(covered.readiness, "READY");
  const unsupported = governMaterialSource({
    sourceKey: "ic-unsupported-package",
    categoryHint: "IC",
    model: "ABC123",
    specification: "0201",
  });
  assert.equal(unsupported.readiness, "REVIEW_REQUIRED");
  assert.ok(unsupported.issues.some((item) => item.code === "GOVERNANCE_IC_PACKAGE_UNSUPPORTED"));
});

test("connector and oscillator multi-field conflicts are stable fail-closed exceptions", () => {
  const connector = governMaterialSource({
    sourceKey: "connector-conflicts",
    categoryHint: "CON",
    model: "B5B-PH-K",
    brand: "JST",
    manufacturer: "MOLEX",
    specification: "5PIN 6PIN 2.0mm 2.54mm 立式 卧式",
  });
  assert.equal(connector.readiness, "REVIEW_REQUIRED");
  assert.equal(connector.identityDigest, null);
  assert.deepEqual(
    connector.issues.filter((item) => item.code.endsWith("_CONFLICT")).map((item) => item.code).sort(),
    [
      "GOVERNANCE_BRAND_CONFLICT",
      "GOVERNANCE_PIN_COUNT_CONFLICT",
      "GOVERNANCE_PITCH_CONFLICT",
      "GOVERNANCE_STRUCTURE_CONFLICT",
    ],
  );

  const oscillator = governMaterialSource({
    sourceKey: "oscillator-frequency-conflict",
    categoryHint: "OSC",
    model: "OSC123",
    specification: "QFN-8 16MHz 20MHz",
  });
  assert.equal(oscillator.readiness, "REVIEW_REQUIRED");
  assert.equal(oscillator.identityDigest, null);
  assert.equal(oscillator.issues.filter((item) => item.code === "GOVERNANCE_FREQUENCY_CONFLICT").length, 1);
});

test("SI prefix case is preserved for milli-ohm versus megaohm", () => {
  const milli = governMaterialSource({ sourceKey: "milli", categoryHint: "RES", specification: "0201 10mΩ ±5% 1/20W" });
  const mega = governMaterialSource({ sourceKey: "mega", categoryHint: "RES", specification: "0201 10MΩ ±5% 1/20W" });
  assert.equal(milli.canonicalKey, "RES_0201_10MR_5_1-20W");
  assert.equal(mega.canonicalKey, "RES_0201_10M_5_1-20W");
  assert.notEqual(milli.identityDigest, mega.identityDigest);
});

test("non-zero vendor decoding and canonical rendering are order independent", () => {
  const left = { sourceKey: "vendor-1k", originalPartNumber: "0201WMJ1001TCE" };
  const right = { sourceKey: "explicit-1k", specification: "0201 1K ±5%" };
  const forward = governMaterialBatch([left, right]);
  const reverse = governMaterialBatch([right, left]);
  assert.equal(forward.groups.length, 1);
  assert.equal(reverse.groups.length, 1);
  assert.equal(forward.groups[0].canonicalKey, "RES_0201_1K_5_1-20W");
  assert.equal(forward.groups[0].canonicalKey, reverse.groups[0].canonicalKey);
  assert.equal(forward.groups[0].identityDigest, reverse.groups[0].identityDigest);
});

test("duplicate source keys are rejected before traceability can become ambiguous", () => {
  assert.throws(() => governMaterialBatch([
    { sourceKey: "same", categoryHint: "CAP", specification: "0201 1uF 6.3V X5R ±10%" },
    { sourceKey: "same", categoryHint: "CAP", specification: "0201 100pF 6.3V X5R ±10%" },
  ]), /GOVERNANCE_SOURCE_KEY_DUPLICATE/);
});

test("model identity accepts only explicit model provenance and never supplier part numbers", () => {
  const supplierOnly = governMaterialSource({
    sourceKey: "supplier-only",
    categoryHint: "IC",
    originalPartNumber: "TPS7A2033PDBVR",
    supplierPartNumber: "SUP-TPS7A2033PDBVR",
    specification: "SOT-23-5",
  });
  assert.equal(supplierOnly.readiness, "REVIEW_REQUIRED");
  assert.ok(supplierOnly.issues.some((item) => item.code === "GOVERNANCE_MODEL_MISSING"));

  const conflicting = governMaterialSource({
    sourceKey: "model-conflict",
    categoryHint: "IC",
    model: "TPS7A2033PDBVR",
    manufacturerPartNumber: "TPS7A2030PDBVR",
  });
  assert.equal(conflicting.readiness, "REVIEW_REQUIRED");
  assert.ok(conflicting.issues.some((item) => item.code === "GOVERNANCE_MODEL_CONFLICT"));
});

test("unknown delimited manufacturer codes cannot masquerade as passive specifications", () => {
  const result = governMaterialSource({
    sourceKey: "unknown-delimited-profile",
    categoryHint: "RES",
    manufacturerPartNumber: "FOO-0201-10K-J-50mW",
  });
  assert.equal(result.readiness, "REVIEW_REQUIRED");
  assert.equal(result.identityDigest, null);
  assert.ok(result.issues.some((item) => item.code === "GOVERNANCE_PACKAGE_MISSING"));
  assert.ok(result.issues.some((item) => item.code === "GOVERNANCE_RESISTANCE_MISSING"));
});

test("multiple models inside one explicit field fail closed", () => {
  const result = governMaterialSource({
    sourceKey: "multiple-models-one-field",
    categoryHint: "IC",
    model: "ABC123 DEF456",
    specification: "QFN-8",
  });
  assert.equal(result.readiness, "REVIEW_REQUIRED");
  assert.equal(result.identityDigest, null);
  assert.ok(result.issues.some((item) => item.code === "GOVERNANCE_MODEL_CONFLICT"));
});

test("resistance SI prefixes never become implicit tolerance codes", () => {
  for (const specification of ["0201 10 KΩ 1/20W", "0201 10 MΩ 1/20W"]) {
    const result = governMaterialSource({ sourceKey: `no-tolerance-${specification}`, categoryHint: "RES", specification });
    assert.equal(result.readiness, "REVIEW_REQUIRED");
    assert.equal(result.identityDigest, null);
    assert.ok(result.issues.some((item) => item.code === "GOVERNANCE_TOLERANCE_MISSING"));
    assert.equal(result.components.some((item) => item.code === "TOLERANCE"), false);
  }
});

test("sub-picofarad values remain exact and equivalent unit forms share identity", () => {
  const result = governMaterialBatch([
    { sourceKey: "half-pf", categoryHint: "CAP", specification: "0201 0.5pF 6.3V X5R ±10%" },
    { sourceKey: "five-hundred-ff", categoryHint: "CAP", specification: "0201 500fF 6.3V X5R ±10%" },
    { sourceKey: "one-pf", categoryHint: "CAP", specification: "0201 1pF 6.3V X5R ±10%" },
  ]);
  assert.equal(result.groups.length, 2);
  const half = result.groups.find((group) => group.sources.length === 2);
  assert.ok(half);
  assert.equal(half.canonicalKey, "CAP_0201_0.5PF_6.3V_X5R_10");
  assert.equal(half.components.find((item) => item.code === "CAPACITANCE").normalizedValue, "500000");
  assert.equal(half.components.find((item) => item.code === "CAPACITANCE").canonicalUnit, "aF");
});

test("vendor decoding is restricted to a named exact profile", () => {
  const valid = governMaterialSource({ sourceKey: "profile", originalPartNumber: "0201WMJ0000TCE" });
  assert.equal(valid.readiness, "READY");
  assert.ok(valid.components.find((item) => item.code === "RESISTANCE").evidence.includes("VENDOR_DECODER_PROFILE_RES_WM_4DIGIT_TCE_V1"));

  const unknown = governMaterialSource({ sourceKey: "unknown-profile", originalPartNumber: "0201WMJ0000UNKNOWN" });
  assert.equal(unknown.category, "OTHER");
  assert.equal(unknown.identityDigest, null);
});

test("batch source and generated alternative limits fail closed", () => {
  assert.throws(
    () => governMaterialBatch(new Array(MATERIAL_GOVERNANCE_LIMITS.maxSourceRows + 1).fill({ sourceKey: "unused" })),
    /GOVERNANCE_SOURCE_LIMIT_EXCEEDED/,
  );

  const connectorSources = Array.from({ length: 142 }, (_, index) => ({
    sourceKey: `connector-${index}`,
    categoryHint: "CON",
    model: `MODEL-${index}`,
    brand: `BRAND-${index}`,
    specification: "5PIN 2.0mm 立式",
  }));
  assert.throws(() => governMaterialBatch(connectorSources), /GOVERNANCE_ALTERNATIVE_LIMIT_EXCEEDED/);
});

test("upstream normalization errors block identity while warnings remain traceable", () => {
  const complete = {
    sourceKey: "upstream-error",
    categoryHint: "RES",
    specification: "0201 10K ±1% 1/20W",
  };
  const blocked = governMaterialSource({
    ...complete,
    upstreamIssues: [{
      level: "ERROR",
      code: "NORMALIZATION_NUMBER_INVALID",
      field: "supplier_reference.SOURCE_QUANTITY",
      message: "数量格式无效",
      evidence: ["NORMALIZATION_ISSUE_1"],
    }],
  });
  assert.equal(blocked.readiness, "REVIEW_REQUIRED");
  assert.equal(blocked.identityDigest, null);
  assert.ok(blocked.issues.some((item) => item.code === "NORMALIZATION_NUMBER_INVALID"));

  const warning = governMaterialSource({
    ...complete,
    sourceKey: "upstream-warning",
    upstreamIssues: [{
      level: "WARNING",
      code: "NORMALIZATION_BRAND_UNKNOWN",
      field: "basic.BRAND",
      message: "品牌需要人工确认",
      evidence: ["NORMALIZATION_ISSUE_2"],
    }],
  });
  assert.equal(warning.readiness, "READY");
  assert.match(warning.identityDigest, /^[0-9a-f]{64}$/);
  assert.ok(warning.issues.some((item) => item.level === "WARNING"));
});
