import sqlite3
import tempfile
import unittest
from pathlib import Path

import server


class MaterialImportMigrationTest(unittest.TestCase):
    def connect(self):
        connection = sqlite3.connect(":memory:")
        connection.row_factory = sqlite3.Row
        return connection

    def test_empty_database_upgrade_and_duplicate_execution(self):
        connection = self.connect()
        try:
            server.create_schema(connection)
            server.apply_migrations(connection)
            server.apply_migrations(connection)
            versions = connection.execute("SELECT version FROM local_schema_migrations").fetchall()
            self.assertEqual(
                [row["version"] for row in versions],
                [
                    "0001_material_import_source_lineage",
                    "0002_material_import_file_archive",
                    "0003_cleaning_structured_specification",
                    "0004_cleaning_general_spec_tokens",
                ],
            )
            columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(cleaning_rows)").fetchall()
            }
            self.assertIn("source_batch_id", columns)
            self.assertIn("specification_confidence", columns)
            self.assertIn("raw_model", columns)
            self.assertIn("raw_category", columns)
            self.assertIn("parsed_tolerance", columns)
            self.assertIn("parsed_material", columns)
            self.assertIn("specification_source", columns)
            self.assertIn("source_spec_tokens_json", columns)
            self.assertIn("candidate_spec_tokens_json", columns)
            self.assertIn("specification_match_evidence_json", columns)
            batch_columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(material_import_batches)").fetchall()
            }
            self.assertIn("archived_file_key", batch_columns)
            self.assertIn("parse_warnings_json", batch_columns)
        finally:
            connection.close()

    def test_existing_cleaning_data_survives_upgrade_and_constraints_apply(self):
        connection = self.connect()
        try:
            server.create_schema(connection)
            connection.execute(
                """
                INSERT INTO cleaning_rows (
                    import_batch_no, supplier_name, raw_item_name, match_level,
                    owner_role, created_at, updated_at
                ) VALUES ('OLD-1', '', '既有物料', '新物料', '工程', '2026-07-18', '2026-07-18')
                """
            )
            connection.commit()
            server.apply_migrations(connection)
            row = connection.execute(
                "SELECT raw_item_name, source_batch_id FROM cleaning_rows WHERE import_batch_no = 'OLD-1'"
            ).fetchone()
            self.assertEqual(row["raw_item_name"], "既有物料")
            self.assertIsNone(row["source_batch_id"])
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute(
                    """
                    INSERT INTO material_import_batches (
                        batch_no, original_filename, source_sha256, source_type,
                        selected_sheet_name, header_start_row, header_end_row,
                        data_start_row, structure_confidence, mapping_json,
                        batch_status, created_by, created_at, updated_at
                    ) VALUES ('BAD', 'bad.bin', 'x', 'BIN', 'S', 1, 1, 2, 1, '{}',
                              'IMPORTED', 'test', '2026-07-18', '2026-07-18')
                    """
                )
        finally:
            connection.close()

    def test_failed_migration_rolls_back(self):
        connection = self.connect()
        original_dir = server.MIGRATIONS_DIR
        try:
            server.create_schema(connection)
            with tempfile.TemporaryDirectory(prefix="erp-bad-migration-") as temp_dir:
                migration_dir = Path(temp_dir)
                (migration_dir / "9999_bad.sql").write_text(
                    "CREATE TABLE should_rollback (id INTEGER); INVALID SQL;",
                    encoding="utf-8",
                )
                server.MIGRATIONS_DIR = migration_dir
                with self.assertRaises(sqlite3.DatabaseError):
                    server.apply_migrations(connection)
                table = connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='should_rollback'"
                ).fetchone()
                self.assertIsNone(table)
        finally:
            server.MIGRATIONS_DIR = original_dir
            connection.close()


if __name__ == "__main__":
    unittest.main()
