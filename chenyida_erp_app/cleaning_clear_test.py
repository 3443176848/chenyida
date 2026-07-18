import sqlite3
import unittest

from server import clear_cleaning_rows, permission_for_request, user_can


class CleaningClearTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(
            """
            CREATE TABLE cleaning_rows (
                id INTEGER PRIMARY KEY,
                confidence REAL NOT NULL
            );
            CREATE TABLE activity_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action TEXT NOT NULL,
                detail TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            INSERT INTO cleaning_rows (id, confidence) VALUES (1, 0.25), (2, 1.0);
            """
        )

    def tearDown(self):
        self.conn.close()

    def test_clears_all_rows_and_records_actor_and_count(self):
        deleted_count = clear_cleaning_rows(self.conn, "admin")

        self.assertEqual(deleted_count, 2)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM cleaning_rows").fetchone()[0], 0)
        audit = self.conn.execute(
            "SELECT action, detail FROM activity_log ORDER BY id DESC LIMIT 1"
        ).fetchone()
        self.assertEqual(audit["action"], "清空清洗审核")
        self.assertEqual(audit["detail"], "2 行 / admin")

    def test_empty_clear_is_idempotent_and_audited(self):
        clear_cleaning_rows(self.conn, "admin")
        deleted_count = clear_cleaning_rows(self.conn, "admin")

        self.assertEqual(deleted_count, 0)
        audit = self.conn.execute(
            "SELECT detail FROM activity_log ORDER BY id DESC LIMIT 1"
        ).fetchone()
        self.assertEqual(audit["detail"], "0 行 / admin")

    def test_clear_endpoint_requires_system_permission(self):
        self.assertEqual(permission_for_request("POST", "/api/cleaning/clear"), "system")
        self.assertTrue(user_can({"role": "admin"}, "system"))
        self.assertFalse(user_can({"role": "engineering"}, "system"))
        self.assertFalse(user_can({"role": "purchase"}, "system"))


if __name__ == "__main__":
    unittest.main()
