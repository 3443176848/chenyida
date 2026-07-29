import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook


MODULE_PATH = Path(__file__).parents[1] / "tools" / "bom-v9-import" / "prepare.py"
SPEC = importlib.util.spec_from_file_location("bom_v9_prepare", MODULE_PATH)
prepare_module = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(prepare_module)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class BomV9PrepareTest(unittest.TestCase):
    def make_workbook(self, directory: Path, rows: list[list[object]], unit_header: str | None = None) -> Path:
        workbook = Workbook()
        worksheet = workbook.active
        worksheet.title = prepare_module.EXPECTED_SHEET
        headers = list(prepare_module.REQUIRED_HEADERS)
        if unit_header:
            headers.append(unit_header)
        worksheet.append(headers)
        for row in rows:
            worksheet.append(row)
        path = directory / "fixture.xlsx"
        workbook.save(path)
        workbook.close()
        return path

    def base_row(self, code: str = "ERP-MAT-00001") -> list[object]:
        return [
            code,
            "电阻",
            "贴片电阻",
            "0201_0R_±5%",
            "0201",
            "0R",
            "",
            "",
            "±5%",
            2,
            "fixture.xlsx",
            "synthetic source trace",
        ]

    def test_missing_unit_is_review_and_usage_is_not_bom_quantity(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workbook = self.make_workbook(root, [self.base_row()])
            output = root / "out"
            summary = prepare_module.prepare(workbook, sha256(workbook), output)
            self.assertEqual(summary["classification_counts"], {"NEEDS_REVIEW": 1})
            self.assertEqual(summary["missing_or_unsupported_unit_rows"], 1)
            self.assertEqual(summary["bom_lines"], 0)
            self.assertEqual(summary["usage_count_total_trace_only"], 2)
            payload = json.loads((output / "staging-payload.json").read_text())
            self.assertIn("EXPLICIT_UNIT_MISSING", payload["rows"][0]["reason_codes"])
            self.assertEqual(payload["rows"][0]["unit_code"], "")
            source_file = payload["manifest"]["source_file"]
            self.assertTrue(
                all(
                    isinstance(value, str)
                    for key, value in source_file.items()
                    if key not in {"filename", "sha256"}
                )
            )

    def test_explicit_unit_allows_material_but_does_not_create_bom(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workbook = self.make_workbook(root, [self.base_row() + ["件"]], "单位")
            output = root / "out"
            summary = prepare_module.prepare(workbook, sha256(workbook), output)
            self.assertEqual(summary["classification_counts"], {"ELIGIBLE": 1})
            self.assertEqual(summary["materials_ready"], 1)
            self.assertEqual(summary["products"], 0)
            self.assertEqual(summary["bom_lines"], 0)

    def test_exact_identity_duplicates_require_review_without_merging(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            rows = [self.base_row("ERP-MAT-00001") + ["PCS"], self.base_row("ERP-MAT-00002") + ["PCS"]]
            workbook = self.make_workbook(root, rows, "单位")
            output = root / "out"
            summary = prepare_module.prepare(workbook, sha256(workbook), output)
            self.assertEqual(summary["exact_identity_duplicate_groups"], 1)
            self.assertEqual(summary["classification_counts"], {"NEEDS_REVIEW": 2})
            payload = json.loads((output / "staging-payload.json").read_text())
            self.assertTrue(all("EXACT_IDENTITY_DUPLICATE_REVIEW_REQUIRED" in row["reason_codes"] for row in payload["rows"]))

    def test_bom_columns_fail_closed_without_a_separate_contract(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workbook = Workbook()
            worksheet = workbook.active
            worksheet.title = prepare_module.EXPECTED_SHEET
            worksheet.append(list(prepare_module.REQUIRED_HEADERS) + ["产品编码"])
            worksheet.append(self.base_row() + ["PRD-001"])
            path = root / "fixture.xlsx"
            workbook.save(path)
            workbook.close()
            with self.assertRaises(prepare_module.PreparationError):
                prepare_module.prepare(path, sha256(path), root / "out")



if __name__ == "__main__":
    unittest.main()
