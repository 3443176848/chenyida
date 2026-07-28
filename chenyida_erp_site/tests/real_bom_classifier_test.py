import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "tools" / "real-bom-import" / "classify.py"
SPEC = importlib.util.spec_from_file_location("real_bom_classifier", MODULE_PATH)
classifier = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(classifier)


class RealBomClassifierTest(unittest.TestCase):
    def test_explicit_reference_quantity_is_conservative(self):
        self.assertEqual(classifier.explicit_reference_quantity("R1,R2 R3"), "3")
        self.assertIsNone(classifier.explicit_reference_quantity("R1-R3"))
        self.assertIsNone(classifier.explicit_reference_quantity("R1,R1"))

    def test_reference_designator_can_classify_countable_component(self):
        self.assertEqual(classifier.category({"reference": "C1,C2"}), ("RB_CAP", "电容"))
        self.assertIsNone(classifier.category({"reference": "R1,C1"}))

    def test_non_countable_missing_unit_is_not_inferred_as_pieces(self):
        self.assertIsNone(classifier.category({"material_name": "胶带"}))

    def test_identity_requires_stable_evidence(self):
        self.assertEqual(classifier.identity({"internal_code": "SRC-001"}, "RB_IC"), ("SOURCE_CODE", "SRC-001"))
        self.assertIsNone(classifier.identity({"material_name": "连接器"}, "RB_CONN"))


if __name__ == "__main__":
    unittest.main()
