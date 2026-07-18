import sqlite3
import unittest

from server import cleaning_rows


class CleaningConfidenceSortTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute(
            """
            CREATE TABLE cleaning_rows (
                id INTEGER PRIMARY KEY,
                confidence REAL NOT NULL
            )
            """
        )
        self.conn.executemany(
            "INSERT INTO cleaning_rows (id, confidence) VALUES (?, ?)",
            [(1, 0.25), (2, 1.0), (3, 0.6), (4, 0.6)],
        )

    def tearDown(self):
        self.conn.close()

    def test_sorts_confidence_descending_with_stable_id_tiebreaker(self):
        rows = cleaning_rows(self.conn, confidence_sort="desc")
        self.assertEqual([row["id"] for row in rows], [2, 4, 3, 1])

    def test_sorts_confidence_ascending_with_stable_id_tiebreaker(self):
        rows = cleaning_rows(self.conn, confidence_sort="asc")
        self.assertEqual([row["id"] for row in rows], [1, 4, 3, 2])

    def test_defaults_to_newest_for_unknown_sort_value(self):
        rows = cleaning_rows(self.conn, confidence_sort="unexpected")
        self.assertEqual([row["id"] for row in rows], [4, 3, 2, 1])

    def test_applies_limit_after_global_sort(self):
        rows = cleaning_rows(self.conn, limit=2, confidence_sort="desc")
        self.assertEqual([row["id"] for row in rows], [2, 4])


if __name__ == "__main__":
    unittest.main()
