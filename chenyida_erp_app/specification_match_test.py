import sqlite3
import unittest

from server import best_match, extract_specification_components


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
                material TEXT DEFAULT '',
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
        self.conn.execute(
            """
            INSERT INTO items (
                internal_item_code, item_category, standard_name, package,
                value_spec, voltage, tolerance, material, mpn
            ) VALUES (
                '8', 'CAP', '内部介质待补', '0402',
                '47PF', '25V', '5%', '', 'EXACT-MPN'
            )
            """
        )
        self.conn.execute(
            """
            INSERT INTO items (
                internal_item_code, item_category, standard_name, value_spec
            ) VALUES (
                '10', 'CON', 'FPC连接器', 'FPC 0.5Pitch 24Pin'
            )
            """
        )
        self.conn.execute(
            """
            INSERT INTO items (
                internal_item_code, item_category, standard_name, package,
                value_spec, mpn
            ) VALUES (
                '9', 'IND', '贴片功率电感', '0201',
                '2.2nH ±0.1nH 600mA', 'TEST-INDUCTOR-001'
            )
            """
        )
        self.conn.execute(
            """
            INSERT INTO items (
                internal_item_code, item_category, standard_name, package,
                value_spec, voltage, tolerance, material, mpn
            ) VALUES (
                '7', 'CAP', '内部名称与供应商不同', '0201',
                '10PF', '50V', '5%', 'NP0', 'TEST-CAP-PART-001'
            )
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
        self.assertGreaterEqual(result["confidence"], 0.55)
        self.assertLess(result["confidence"], 1)

    def test_similar_name_cannot_override_conflicting_specification(self):
        result = self.match("任意名称 A", "10nF,10%,50V,0201")

        self.assertEqual(result["candidate_internal_code"], "4")
        self.assertEqual(result["match_level"], "自动匹配")

    def test_name_without_specification_does_not_receive_code(self):
        result = self.match("任意名称 A", "")

        self.assertEqual(result["candidate_internal_code"], "")
        self.assertEqual(result["match_level"], "规格不足")
        self.assertEqual(
            result["specification_match_evidence"]["reason"],
            "INSUFFICIENT_SPECIFICATION_EVIDENCE",
        )

    def test_full_specification_stored_in_value_spec_is_supported(self):
        result = self.match("不同的供应商名称", "22nF,+10%,25V,0402")

        self.assertEqual(result["candidate_internal_code"], "6")
        self.assertEqual(result["match_level"], "自动匹配")

    def test_1928_description_is_compared_as_individual_components(self):
        raw = {
            "supplier_name": "",
            "raw_item_code": "",
            "raw_item_name": "贴片电容",
            "raw_spec": "TEST-CAP-PART-001",
            "raw_model": "TEST-CAP-PART-001",
            "raw_mpn": "",
            "remark": "CAP 0201 ±5% NPO 50V 10PF TEST-CAP-PART-001 测试品牌",
        }

        components = extract_specification_components(raw)
        result = best_match(self.conn, raw)

        self.assertEqual(
            components,
            {
                "category": "CAP",
                "package": "0201",
                "value_spec": "10PF",
                "voltage": "50V",
                "tolerance": "5%",
                "material": "C0G/NP0",
                "mpn": "TEST-CAP-PART-001",
            },
        )
        self.assertEqual(result["candidate_internal_code"], "7")
        self.assertEqual(result["match_level"], "自动匹配")

    def test_one_conflicting_component_rejects_the_candidate(self):
        result = best_match(
            self.conn,
            {
                "supplier_name": "",
                "raw_item_code": "",
                "raw_item_name": "贴片电容",
                "raw_model": "TEST-CAP-PART-001",
                "remark": "CAP 0201 ±5% NPO 25V 10PF",
            },
        )

        self.assertNotEqual(result["candidate_internal_code"], "7")

    def test_capacitance_shorthand_is_not_dropped_before_matching(self):
        raw = {
            "supplier_name": "",
            "raw_item_code": "",
            "raw_item_name": "贴片电容",
            "raw_model": "TEST-CAP-PART-002",
            "remark": "CAP 0201 +/-5% COG 50V 100P，TEST-CAP-PART-002，测试品牌",
        }

        components = extract_specification_components(raw)
        result = best_match(self.conn, raw)

        self.assertEqual(components["value_spec"], "100PF")
        self.assertEqual(components["material"], "C0G/NP0")
        self.assertNotEqual(result["candidate_internal_code"], "5")

    def test_exact_mpn_stays_suspected_when_internal_material_is_missing(self):
        result = best_match(
            self.conn,
            {
                "supplier_name": "",
                "raw_item_code": "",
                "raw_item_name": "不同名称",
                "raw_model": "EXACT-MPN",
                "remark": "CAP 0402 5% C0G 25V 47PF",
            },
        )

        self.assertEqual(result["candidate_internal_code"], "8")
        self.assertEqual(result["match_level"], "疑似匹配")
        self.assertGreaterEqual(result["confidence"], 0.55)
        self.assertLess(result["confidence"], 1)

    def test_inductor_specification_matches_when_parameter_order_changes(self):
        result = best_match(
            self.conn,
            {
                "supplier_name": "",
                "raw_item_code": "",
                "raw_item_name": "供应商自定义名称",
                "raw_spec": "600mA,0201,2.2nH,±0.1nH,电感",
                "raw_model": "TEST-INDUCTOR-001",
            },
        )

        self.assertEqual(result["candidate_internal_code"], "9")
        self.assertEqual(result["match_level"], "自动匹配")
        self.assertEqual(result["confidence"], 1.0)
        self.assertTrue(result["specification_match_evidence"]["full_signature"])

    def test_category_only_does_not_produce_connector_candidate(self):
        result = self.match("连接器", "Connector")

        self.assertEqual(result["candidate_internal_code"], "")
        self.assertEqual(result["match_level"], "规格不足")
        self.assertEqual(result["confidence"], 0)

    def test_connector_pin_and_interface_conflicts_reject_candidate(self):
        result = self.match("60pin连接器", "60Pin MB-TO-SUB connector")

        self.assertEqual(result["candidate_internal_code"], "")
        self.assertEqual(result["match_level"], "新物料")

    def test_connector_parameters_match_independent_of_order(self):
        result = self.match("供应商名称", "24Pin Connector FPC 0.5Pitch")

        self.assertEqual(result["candidate_internal_code"], "10")
        self.assertEqual(result["match_level"], "自动匹配")
        self.assertEqual(result["confidence"], 1.0)


if __name__ == "__main__":
    unittest.main()
