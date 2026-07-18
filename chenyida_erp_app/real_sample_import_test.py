import hashlib
import json
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

import server


ATTACHMENT_DIR = Path("/root/.codex/attachments/11acb435-f2b7-4453-9522-c553f1a97300")
SPEC_ATTACHMENT_DIR = Path("/root/.codex/attachments/06a0e45b-d5f3-4bef-aa0c-2dc9521194f1")


class RealSampleImportTest(unittest.TestCase):
    def test_a118_and_v700_are_archived_and_staged_for_review(self):
        if not ATTACHMENT_DIR.exists():
            self.skipTest("真实附件不在当前服务器")
        original_data_dir = server.DATA_DIR
        original_import_dir = server.IMPORT_FILE_DIR
        original_db_path = server.DB_PATH
        try:
            with tempfile.TemporaryDirectory(prefix="erp-real-import-") as temp_dir:
                data_dir = Path(temp_dir)
                server.DATA_DIR = data_dir
                server.IMPORT_FILE_DIR = data_dir / "import_files"
                server.DB_PATH = data_dir / "real-sample.sqlite3"
                with closing(server.db_connect()) as connection:
                    server.create_schema(connection)
                    server.apply_migrations(connection)
                    results = {}
                    for name, batch_no in (
                        ("A118量产BOM.csv", "TEST-A118"),
                        ("V700量产BOM.csv", "TEST-V700"),
                    ):
                        path = ATTACHMENT_DIR / name
                        results[batch_no] = server.import_supplier_file(
                            connection,
                            path.read_bytes(),
                            path.name,
                            batch_no,
                            "real-sample-test",
                        )
                    self.assertEqual(results["TEST-A118"]["count"], 305)
                    self.assertEqual(results["TEST-V700"]["count"], 222)
                    self.assertEqual(
                        connection.execute("SELECT COUNT(*) FROM material_import_batches").fetchone()[0],
                        2,
                    )
                    self.assertEqual(
                        connection.execute("SELECT COUNT(*) FROM material_import_raw_rows").fetchone()[0],
                        766,
                    )
                    self.assertEqual(
                        connection.execute("SELECT COUNT(*) FROM cleaning_rows").fetchone()[0],
                        527,
                    )
                    self.assertEqual(connection.execute("SELECT COUNT(*) FROM items").fetchone()[0], 0)
                    batches = connection.execute(
                        """
                        SELECT batch_no, source_sha256, archived_file_key, file_size_bytes,
                               parse_warnings_json
                        FROM material_import_batches
                        ORDER BY batch_no
                        """
                    ).fetchall()
                    for batch in batches:
                        archive = data_dir / batch["archived_file_key"]
                        self.assertTrue(archive.is_file())
                        self.assertEqual(archive.stat().st_size, batch["file_size_bytes"])
                        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), batch["source_sha256"])
                        self.assertTrue(json.loads(batch["parse_warnings_json"]))
                    self.assertEqual(
                        connection.execute(
                            "SELECT COUNT(*) FROM cleaning_rows WHERE review_status = 'NEEDS_REVIEW'"
                        ).fetchone()[0],
                        527,
                    )
                    self.assertGreater(
                        connection.execute(
                            "SELECT COUNT(*) FROM cleaning_rows WHERE raw_spec = ''"
                        ).fetchone()[0],
                        0,
                    )
        finally:
            server.DATA_DIR = original_data_dir
            server.IMPORT_FILE_DIR = original_import_dir
            server.DB_PATH = original_db_path

    def test_three_new_supplier_files_stage_available_specifications(self):
        if not SPEC_ATTACHMENT_DIR.exists():
            self.skipTest("规格真实附件不在当前服务器")
        original_data_dir = server.DATA_DIR
        original_import_dir = server.IMPORT_FILE_DIR
        original_db_path = server.DB_PATH
        try:
            with tempfile.TemporaryDirectory(prefix="erp-spec-import-") as temp_dir:
                data_dir = Path(temp_dir)
                server.DATA_DIR = data_dir
                server.IMPORT_FILE_DIR = data_dir / "import_files"
                server.DB_PATH = data_dir / "spec-samples.sqlite3"
                with closing(server.db_connect()) as connection:
                    server.create_schema(connection)
                    server.apply_migrations(connection)
                    expected_counts = {
                        "1928C量产BOM.xlsx": 25,
                        "G20-G15G项目量产BOM.xlsx": 74,
                        "J587_SUBA2_V01-20260703.xlsx": 122,
                    }
                    for index, (name, expected_count) in enumerate(expected_counts.items(), start=1):
                        path = SPEC_ATTACHMENT_DIR / name
                        result = server.import_supplier_file(
                            connection,
                            path.read_bytes(),
                            path.name,
                            f"TEST-SPEC-{index}",
                            "real-sample-test",
                        )
                        self.assertEqual(result["count"], expected_count)
                    self.assertEqual(
                        connection.execute("SELECT COUNT(*) FROM material_import_batches").fetchone()[0],
                        3,
                    )
                    self.assertEqual(
                        connection.execute("SELECT COUNT(*) FROM material_import_raw_rows").fetchone()[0],
                        316,
                    )
                    self.assertEqual(
                        connection.execute("SELECT COUNT(*) FROM cleaning_rows").fetchone()[0],
                        221,
                    )
                    self.assertEqual(
                        connection.execute("SELECT COUNT(*) FROM cleaning_rows WHERE raw_spec != ''").fetchone()[0],
                        216,
                    )
                    self.assertEqual(
                        connection.execute(
                            "SELECT COUNT(*) FROM cleaning_rows WHERE review_status = 'NEEDS_REVIEW'"
                        ).fetchone()[0],
                        221,
                    )
                    capacitor = connection.execute(
                        """
                        SELECT raw_model, raw_brand, parsed_category, parsed_package,
                               parsed_value, parsed_voltage, parsed_tolerance, parsed_material
                        FROM cleaning_rows
                        WHERE import_batch_no = 'TEST-SPEC-1' AND source_row_number = 9
                        """
                    ).fetchone()
                    self.assertTrue(capacitor["raw_model"])
                    self.assertTrue(capacitor["raw_brand"])
                    for field in (
                        "parsed_category",
                        "parsed_package",
                        "parsed_value",
                        "parsed_voltage",
                        "parsed_tolerance",
                        "parsed_material",
                    ):
                        self.assertTrue(capacitor[field], field)
                    self.assertEqual(connection.execute("SELECT COUNT(*) FROM items").fetchone()[0], 0)
        finally:
            server.DATA_DIR = original_data_dir
            server.IMPORT_FILE_DIR = original_import_dir
            server.DB_PATH = original_db_path


if __name__ == "__main__":
    unittest.main()
