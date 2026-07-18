import io
import unittest
from pathlib import Path

from openpyxl import Workbook
import xlwt

from spreadsheet_import import SpreadsheetImportError, parse_spreadsheet_import


ATTACHMENT_DIR = Path("/root/.codex/attachments/11acb435-f2b7-4453-9522-c553f1a97300")


class SpreadsheetImportTest(unittest.TestCase):
    def make_xlsx(self):
        workbook = Workbook()
        cover = workbook.active
        cover.title = "说明"
        cover["A1"] = "供应商物料导入说明"
        cover["A2"] = "本页不包含物料"
        sheet = workbook.create_sheet("物料BOM")
        sheet.merge_cells("A1:C1")
        sheet["A1"] = "物料信息"
        sheet.merge_cells("D1:F1")
        sheet["D1"] = "规格信息"
        headers = ["料号", "品名", "单位", "型号", "尺寸", "品牌"]
        for column, header in enumerate(headers, start=1):
            sheet.cell(2, column, header)
        sheet.append(["SUP-001", "贴片电阻", "PCS", "RC0603", "1.6x0.8mm", "YAGEO"])
        sheet.append(["SUP-002", "贴片电容", "PCS", "CC0402", "1.0x0.5mm", "TDK"])
        buffer = io.BytesIO()
        workbook.save(buffer)
        workbook.close()
        return buffer.getvalue()

    def make_xls(self):
        workbook = xlwt.Workbook()
        sheet = workbook.add_sheet("材料明细")
        headers = ["物料编码", "物料名称", "规格型号", "品牌", "单位"]
        for column, header in enumerate(headers):
            sheet.write(0, column, header)
        sheet.write(1, 0, "SUP-XLS-001")
        sheet.write(1, 1, "连接器")
        sheet.write(1, 2, "2.54mm 2P")
        sheet.write(1, 3, "TEST")
        sheet.write(1, 4, "PCS")
        buffer = io.BytesIO()
        workbook.save(buffer)
        return buffer.getvalue()

    def test_xlsx_selects_material_sheet_and_combines_multi_row_specification(self):
        result = parse_spreadsheet_import(self.make_xlsx(), "supplier.xlsx")
        self.assertEqual(result["source_type"], "XLSX")
        self.assertEqual(result["selected_sheet"], "物料BOM")
        self.assertEqual((result["header_start_row"], result["header_end_row"]), (1, 2))
        self.assertEqual(len(result["rows"]), 2)
        self.assertEqual(result["rows"][0]["raw_item_name"], "贴片电阻")
        self.assertEqual(result["rows"][0]["raw_spec"], "RC0603 1.6x0.8mm")
        self.assertEqual(result["rows"][0]["_review_status"], "NEEDS_REVIEW")
        self.assertEqual(len(result["raw_rows"]), 6)

    def test_legacy_xls_is_recognized_and_mapped(self):
        result = parse_spreadsheet_import(self.make_xls(), "supplier.xls")
        self.assertEqual(result["source_type"], "XLS")
        self.assertEqual(result["selected_sheet"], "材料明细")
        self.assertEqual(result["rows"][0]["raw_item_name"], "连接器")
        self.assertEqual(result["rows"][0]["raw_spec"], "2.54mm 2P")

    def test_csv_still_uses_same_adaptive_path(self):
        content = "标题,,,,\n物料名称,规格,品牌,单位,供应商料号\n电阻,10K 0603,YAGEO,PCS,R-1\n".encode()
        result = parse_spreadsheet_import(content, "supplier.csv")
        self.assertEqual(result["source_type"], "CSV")
        self.assertEqual(result["header_start_row"], 2)
        self.assertEqual(result["rows"][0]["raw_spec"], "10K 0603")

    def test_xlsx_content_with_csv_extension_is_detected_with_warning(self):
        result = parse_spreadsheet_import(self.make_xlsx(), "supplier.csv")
        self.assertEqual(result["source_type"], "XLSX")
        self.assertTrue(result["extension_warning"])

    def test_missing_material_name_fails_closed(self):
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "BOM"
        sheet.append(["物料规格描述", "物料型号", "数量"])
        sheet.append(["10K 0603", "RC0603", 1])
        buffer = io.BytesIO()
        workbook.save(buffer)
        workbook.close()
        with self.assertRaisesRegex(SpreadsheetImportError, "物料名称列") as caught:
            parse_spreadsheet_import(buffer.getvalue(), "missing-name.xlsx")
        self.assertEqual(caught.exception.code, "IMPORT_MAPPING_REVIEW_REQUIRED")

    def test_real_samples_keep_documented_safe_outcomes(self):
        if not ATTACHMENT_DIR.exists():
            self.skipTest("真实附件不在当前服务器")
        v700 = ATTACHMENT_DIR / "V700量产BOM.csv"
        a118 = ATTACHMENT_DIR / "A118量产BOM.csv"
        with self.assertRaises(SpreadsheetImportError) as v700_error:
            parse_spreadsheet_import(v700.read_bytes(), v700.name)
        self.assertEqual(v700_error.exception.code, "IMPORT_MAPPING_REVIEW_REQUIRED")
        with self.assertRaises(SpreadsheetImportError) as a118_error:
            parse_spreadsheet_import(a118.read_bytes(), a118.name)
        self.assertEqual(a118_error.exception.code, "IMPORT_PARSE_LIMIT_EXCEEDED")


if __name__ == "__main__":
    unittest.main()
