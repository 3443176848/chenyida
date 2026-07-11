import tempfile
import unittest
from pathlib import Path

from environment_guard import current_environment, prepare_test_environment


class EnvironmentGuardTest(unittest.TestCase):
    def test_production_is_rejected_before_test_database_creation(self):
        with tempfile.TemporaryDirectory(prefix="chenyida-erp-test-") as temp_dir:
            source = {"ERP_ENV": "production"}
            with self.assertRaisesRegex(RuntimeError, "拒绝执行测试"):
                prepare_test_environment(temp_dir, source=source)
            self.assertEqual(list(Path(temp_dir).iterdir()), [])

    def test_development_is_rejected_when_explicitly_selected(self):
        with tempfile.TemporaryDirectory(prefix="chenyida-erp-test-") as temp_dir:
            with self.assertRaisesRegex(RuntimeError, "必须显式使用 test"):
                prepare_test_environment(temp_dir, source={"ERP_ENV": "development"})

    def test_marked_system_temp_directory_is_accepted(self):
        with tempfile.TemporaryDirectory(prefix="chenyida-erp-test-") as temp_dir:
            source = {"ERP_ENV": "test"}
            prepare_test_environment(temp_dir, "guard.sqlite3", source)
            self.assertEqual(source["ERP_ENV"], "test")
            self.assertEqual(Path(source["CYD_ERP_DB"]), Path(temp_dir) / "guard.sqlite3")

    def test_unknown_environment_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "ERP_ENV 必须是"):
            current_environment({"ERP_ENV": "staging"})


if __name__ == "__main__":
    unittest.main()
