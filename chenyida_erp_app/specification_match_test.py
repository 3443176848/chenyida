import sqlite3
import unittest

from server import best_match


class SpecificationMatchTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(
            """
            CREATE TABLE items (
                internal_item_code TEXT PRIMARY KEY,
                item_category TEXT NOT NULL,
                standard_name TEXT NOT NULL,
                package TEXT DEFAULT '',
                value_spec TEXT DEFAULT '',
                voltage TEXT DEFAULT '',
                tolerance TEXT DEFAULT '',
                mpn TEXT DEFAULT ''
            );
            CREATE TABLE supplier_mappings (
                id INTEGER PRIMARY KEY,
                supplier_name TEXT,
                supplier_item_code TEXT,
                internal_item_code TEXT
            );
            """
        )
        self.conn.executemany(
            """
            INSERT INTO items (
                internal_item_code, item_category, standard_name,
                package, value_spec, voltage, tolerance
            ) VALUES (?, 'CAP', ?, '0201', ?, ?, ?)
            """,
            [
                ("1", "任意名称 A", "100nF", "6.3V", "5%"),
                ("2", "任意名称 B", "100nF", "6.3V", "10%"),
                ("3", "任意名称 C", "100nF", "6.3V", "20%"),
                ("4", "任意名称 D", "10nF", "50V", "10%"),
                ("5", "任意名称 E", "10nF", "50V", "5%"),
            ],
        )
        self.conn.execute(
            """
            INSERT INTO items (
                internal_item_code, item_category, standard_name, value_spec
            ) VALUES ('6', 'CAP', '历史名称', '22nF,10%,25V,0402')
            """
        )

    def tearDown(self):
        self.conn.close()

    def match(self, name, specification):
        return best_match(
            self.conn,
            {
                "supplier_name": "",
                "raw_item_code": "",
                "raw_item_name": name,
                "raw_spec": specification,
                "raw_mpn": "",
            },
        )

    def test_exact_specification_ignores_different_material_name(self):
        result = self.match("供应商完全不同的名称", "100nF,+5%,6.3V,0201")

        self.assertEqual(result["candidate_internal_code"], "1")
        self.assertEqual(result["match_level"], "自动匹配")
        self.assertEqual(result["confidence"], 1.0)

    def test_tolerance_selects_the_correct_internal_code(self):
        expected = {
            "100nF,+10%,6.3V,0201": "2",
            "100nF,+20%,6.3V,0201": "3",
            "10nF,10%,50V,0201": "4",
            "10nF,5%,50V,0201": "5",
        }
        for specification, code in expected.items():
            with self.subTest(specification=specification):
                self.assertEqual(self.match("名称不参与匹配", specification)["candidate_internal_code"], code)

    def test_equivalent_capacitance_units_match_the_same_code(self):
        result = self.match("任意名称", "0.1uF,+5%,6.3V,0201")

        self.assertEqual(result["candidate_internal_code"], "1")
        self.assertEqual(result["match_level"], "自动匹配")

    def test_missing_tolerance_does_not_choose_between_ambiguous_codes(self):
        result = self.match("任意名称", "100nF,6.3V,0201")

        self.assertEqual(result["candidate_internal_code"], "")
        self.assertEqual(result["match_level"], "疑似匹配")
        self.assertEqual(result["confidence"], 0.85)

    def test_similar_name_cannot_override_conflicting_specification(self):
        result = self.match("任意名称 A", "10nF,10%,50V,0201")

        self.assertEqual(result["candidate_internal_code"], "4")
        self.assertEqual(result["match_level"], "自动匹配")

    def test_name_without_specification_does_not_receive_code(self):
        result = self.match("任意名称 A", "")

        self.assertEqual(result["candidate_internal_code"], "")
        self.assertEqual(result["match_level"], "新物料")

    def test_full_specification_stored_in_value_spec_is_supported(self):
        result = self.match("不同的供应商名称", "22nF,+10%,25V,0402")

        self.assertEqual(result["candidate_internal_code"], "6")
        self.assertEqual(result["match_level"], "自动匹配")


if __name__ == "__main__":
    unittest.main()
