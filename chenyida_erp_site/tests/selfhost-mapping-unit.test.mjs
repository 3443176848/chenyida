import assert from "node:assert/strict";
import test from "node:test";

import {
  columnReference,
  decideReuse,
  mappingContentDigest,
  normalizeSourceHeader,
  sourceStructureDigest,
} from "../app/lib/material-import-selfhost/rules.ts";

test("source headers and structure digests are stable and order-sensitive", () => {
  assert.equal(normalizeSourceHeader("  Ｕｎｉｔ \t code  ", 0), "Unit code");
  assert.equal(normalizeSourceHeader("", 26), "COLUMN_AA");
  assert.equal(columnReference(255), "IV");
  const base = {
    sourceKind: "CSV",
    sheetName: "__CSV__",
    sheetIndex: 0,
    headerMode: "SINGLE_ROW",
    headerRowNumber: 1,
    fields: [
      { column_index: 0, column_ref: "A", source_header: "standard_name", normalized_header: "standard_name" },
      { column_index: 1, column_ref: "B", source_header: "unit", normalized_header: "unit" },
    ],
  };
  assert.equal(sourceStructureDigest(base), sourceStructureDigest({ ...base }));
  assert.notEqual(sourceStructureDigest(base), sourceStructureDigest({ ...base, fields: [...base.fields].reverse() }));
});

test("mapping content digest is canonical and changes with material semantics", () => {
  const items = [
    { source_column_index: 0, target_namespace: "basic", target_code: "STANDARD_NAME", mapping_mode: "SOURCE", required: true, display_order: 0 },
    { source_column_index: 1, target_namespace: "basic", target_code: "UNIT", mapping_mode: "SOURCE", required: true, display_order: 1 },
  ];
  const input = {
    selectedSheetIndex: 0,
    headerMode: "SINGLE_ROW",
    headerRowNumber: 1,
    sourceStructureDigest: "a".repeat(64),
    metadataDigest: "b".repeat(64),
    items,
  };
  assert.equal(mappingContentDigest(input), mappingContentDigest({ ...input, items: [...items].reverse() }));
  assert.notEqual(mappingContentDigest(input), mappingContentDigest({ ...input, metadataDigest: "c".repeat(64) }));
});

test("reuse decisions separate exact reuse, reconfirmation and invalidation", () => {
  const exact = decideReuse({ candidateStatus: "CONFIRMED", sourceKindMatches: true, structureDigestMatches: true, metadataDigestMatches: true, targetsCompatible: true });
  assert.equal(exact.decision, "AUTO_RECOMMEND");
  const metadata = decideReuse({ candidateStatus: "CONFIRMED", sourceKindMatches: true, structureDigestMatches: true, metadataDigestMatches: false, targetsCompatible: true });
  assert.equal(metadata.decision, "RECONFIRM_REQUIRED");
  const target = decideReuse({ candidateStatus: "CONFIRMED", sourceKindMatches: true, structureDigestMatches: true, metadataDigestMatches: false, targetsCompatible: false });
  assert.equal(target.decision, "STALE");
  const structure = decideReuse({ candidateStatus: "CONFIRMED", sourceKindMatches: true, structureDigestMatches: false, metadataDigestMatches: true, targetsCompatible: true });
  assert.equal(structure.decision, "INCOMPATIBLE");
});
