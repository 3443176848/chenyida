import unittest

from specification_tokens import compare_tokens, extract_tokens, token_map


class SpecificationTokensTest(unittest.TestCase):
    def test_inductor_parameters_are_typed_individually(self):
        tokens = extract_tokens(
            "电感,2.2nH,±0.1nH,600mA,0201,TEST-INDUCTOR-001,测试品牌",
            model="TEST-INDUCTOR-001",
            brand="测试品牌",
        )
        values = token_map(tokens)

        self.assertEqual(values["CATEGORY"], {"IND"})
        self.assertEqual(values["INDUCTANCE"], {"0.0000000022 H"})
        self.assertEqual(values["INDUCTANCE_TOLERANCE"], {"0.0000000001 H"})
        self.assertEqual(values["CURRENT"], {"0.6 A"})
        self.assertEqual(values["PACKAGE"], {"0201"})
        self.assertEqual(values["MPN"], {"TEST-INDUCTOR-001"})

    def test_parameter_order_does_not_change_similarity(self):
        left = extract_tokens("电感,2.2nH,±0.1nH,600mA,0201")
        right = extract_tokens("0201,600mA,电感,±0.1nH,2.2nH")

        result = compare_tokens(left, right)

        self.assertEqual(result["score"], 1.0)
        self.assertTrue(result["full_signature"])
        self.assertEqual(result["conflicts"], [])

    def test_equivalent_capacitance_units_compare_equal(self):
        left = extract_tokens("电容 0.1uF 6.3V 10% 0201")
        right = extract_tokens("0201 CAP 100nF +10% 6.3V")

        result = compare_tokens(left, right)

        self.assertEqual(result["score"], 1.0)
        self.assertTrue(result["full_signature"])

    def test_conflicting_primary_value_rejects_candidate(self):
        left = extract_tokens("电感 2.2nH 600mA 0201")
        right = extract_tokens("电感 3.3nH 600mA 0201")

        result = compare_tokens(left, right)

        self.assertEqual(result["score"], 0)
        self.assertTrue(any(item["kind"] == "INDUCTANCE" for item in result["conflicts"]))

    def test_missing_parameter_is_visible_and_not_full(self):
        source = extract_tokens("电感 2.2nH 600mA 0201")
        target = extract_tokens("电感 2.2nH 0201")

        result = compare_tokens(source, target)

        self.assertLess(result["score"], 1)
        self.assertFalse(result["full_signature"])
        self.assertTrue(any(item["kind"] == "CURRENT" for item in result["missing_in_target"]))

    def test_mpn_and_brand_are_separate_from_generic_specification_score(self):
        source = extract_tokens(
            "电容 100nF 10% 6.3V 0201",
            model="SOURCE-PART-001",
            brand="来源品牌",
        )
        target = extract_tokens(
            "0201 6.3V 100nF 10% CAP",
            model="TARGET-PART-999",
            brand="候选品牌",
        )

        result = compare_tokens(source, target)

        self.assertEqual(result["score"], 1.0)
        self.assertTrue(result["full_signature"])
        self.assertEqual(
            {item["kind"] for item in result["identifier_evidence"] if not item["matched"]},
            {"MPN", "BRAND"},
        )

    def test_mpn_alone_cannot_masquerade_as_detailed_specification(self):
        source = extract_tokens("", model="SOURCE-PART-001")
        target = extract_tokens(
            "电容 100nF 10% 6.3V 0201",
            model="SOURCE-PART-001",
        )

        result = compare_tokens(source, target)

        self.assertEqual(result["score"], 0)
        self.assertFalse(result["full_signature"])

    def test_chinese_and_code_category_values_are_equivalent(self):
        source = extract_tokens("100nF 0201", category="电容")
        target = extract_tokens("0201 0.1uF", category="CAP")

        result = compare_tokens(source, target)

        self.assertEqual(result["raw_similarity"], 1.0)
        self.assertEqual(result["score"], 0.6667)
        self.assertFalse(result["full_signature"])
        self.assertTrue(result["evidence_sufficient"])

    def test_fractional_power_is_not_misread_as_denominator_watts(self):
        tokens = extract_tokens("RES,10K,±5%,1/20W,0201")
        values = token_map(tokens)

        self.assertEqual(values["POWER"], {"0.05 W"})
        self.assertNotIn("20 W", values["POWER"])

    def test_connector_pin_count_and_pitch_are_typed(self):
        tokens = extract_tokens("FPC连接器 24Pin 0.5Pitch")
        values = token_map(tokens)

        self.assertEqual(values["CATEGORY"], {"CON"})
        self.assertEqual(values["INTERFACE"], {"FPC"})
        self.assertEqual(values["PIN_COUNT"], {"24"})
        self.assertEqual(values["PITCH"], {"0.5 mm"})

    def test_connector_short_p_is_pin_count_not_capacitance(self):
        tokens = extract_tokens("TYPE-C CF 16P connector")
        values = token_map(tokens)

        self.assertEqual(values["CATEGORY"], {"CON"})
        self.assertEqual(values["PIN_COUNT"], {"16"})
        self.assertNotIn("CAPACITANCE", values)

    def test_capacitance_short_p_requires_capacitor_context(self):
        capacitor = token_map(extract_tokens("CAP 100P 50V 0201"))
        ambiguous = token_map(extract_tokens("100P"))

        self.assertEqual(capacitor["CAPACITANCE"], {"0.0000000001 F"})
        self.assertNotIn("CAPACITANCE", ambiguous)

    def test_voltage_range_is_one_compound_parameter(self):
        tokens = extract_tokens("VCC Operating Range: 2.7V to 5.0V")
        values = token_map(tokens)

        self.assertEqual(values["VOLTAGE_RANGE"], {"2.7..5 V"})
        self.assertNotIn("VOLTAGE", values)

    def test_impedance_at_frequency_preserves_parameter_relationship(self):
        tokens = extract_tokens("100MHz@90Ω common mode filter")
        values = token_map(tokens)

        self.assertEqual(
            values["IMPEDANCE_AT_FREQUENCY"],
            {"100000000 HZ @ 90 OHM"},
        )
        self.assertNotIn("FREQUENCY", values)
        self.assertNotIn("RESISTANCE", values)


if __name__ == "__main__":
    unittest.main()
