import hashlib
import json
import subprocess
import unittest
from pathlib import Path


SITE_ROOT = Path(__file__).resolve().parents[1]
EXPECTED_POLICY_SHA256 = "84d14eed19d12df6a0d0e0dfa03c3b6096e2643cbc86371db782fa705a6901c9"
EXPECTED_BROWSER_IMAGE = "mcr.microsoft.com/playwright@sha256:daa1690ea366d2d6b52ea085a59a221a6e954cd9d9c13c89bd7eccb0673e8961"
EXPECTED_EXECUTABLE_SHA256 = "efb2bece6f2f5bc00dc270162d2241c86d509ca4f4297b1eb0f5cd8894d050be"


class ReleaseSupervisorBrowserTest(unittest.TestCase):
    def test_browser_runtime_policy_is_exact_and_content_addressed(self):
        raw = (SITE_ROOT / "release" / "test-runtime-policy-v1.json").read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), EXPECTED_POLICY_SHA256)
        policy = json.loads(raw)
        self.assertEqual(policy["browser_image"], {
            "reference": EXPECTED_BROWSER_IMAGE,
            "repo_digest": EXPECTED_BROWSER_IMAGE.rsplit("@", 1)[1],
            "config_digest": EXPECTED_BROWSER_IMAGE.rsplit("@", 1)[1],
        })
        self.assertEqual(policy["browser_runtime"], {
            "package_name": "playwright-core",
            "package_version": "1.51.1",
            "browser_name": "chromium",
            "browser_revision": "1161",
            "browser_version": "134.0.6998.35",
            "executable_path": "/ms-playwright/chromium-1161/chrome-linux/chrome",
            "executable_sha256": EXPECTED_EXECUTABLE_SHA256,
        })
        self.assertEqual(policy["node_dependencies"]["package_lock_sha256"], "3c0522f9ea75cc6c0bfa4c3c92e232f47ce326e73054e070a03bea8320a91815")
        self.assertEqual(policy["node_dependencies"]["tree_sha256"], "3d727122206562df4ebfe24139bfd7b2ae16a299ef2e62b6d55b19e61c2db819")

    def test_browser_shell_is_offline_serial_bounded_and_owned(self):
        shell = SITE_ROOT / "scripts" / "run-release-browser-tests.sh"
        subprocess.run(["/bin/sh", "-n", shell], check=True)
        source = shell.read_text(encoding="utf-8")
        self.assertIn(f"BROWSER_IMAGE='{EXPECTED_BROWSER_IMAGE}'", source)
        self.assertIn(f"BROWSER_EXECUTABLE_SHA256='{EXPECTED_EXECUTABLE_SHA256}'", source)
        self.assertIn("sed 's/[[:space:]]*$//'", source)
        self.assertEqual(source.count("/usr/bin/docker create"), 3)
        self.assertNotIn("/usr/bin/docker run", source)
        self.assertNotIn("docker pull", source)
        self.assertIn("--pull=never", source)
        self.assertIn("--network none", source)
        self.assertIn("--read-only --cap-drop ALL --cap-add SYS_CHROOT --cap-add SETUID --cap-add SETGID", source)
        self.assertIn("--memory 1536m --memory-swap 1792m --cpus 1 --pids-limit 384", source)
        self.assertIn("--tmpfs /workspace/node_modules/.vite-temp:rw,exec,nosuid,nodev,size=32m,mode=1777", source)
        self.assertIn("--tmpfs /test-tmp:rw,exec,nosuid,nodev,size=512m,mode=1777", source)
        self.assertNotIn("--cap-add CHOWN", source)
        self.assertNotIn('chown -R 999:999 "/postgres-rootfs$PGDATA"', source)
        self.assertIn('chenyida.erp.release-browser-test=$RUN_ID', source)
        self.assertIn("setpriv --reuid=1000 --regid=1000 --clear-groups env -i", source)
        self.assertIn("git_candidate archive --format=tar", source)
        self.assertIn('if [ "$SUPERVISOR_SITE_ROOT" = "$SITE_ROOT" ]', source)
        self.assertIn('-v "$BROWSER_SUPERVISOR_ROOT:/supervisor:ro"', source)
        self.assertIn("remove_task_container", source)
        self.assertIn("trap cleanup EXIT", source)

    def test_runner_pins_all_six_required_browser_database_contracts(self):
        source = (SITE_ROOT / "scripts" / "release-browser-e2e-runner.mjs").read_text(encoding="utf-8")
        expected = {
            "tests/selfhost-planning-revision-response-browser.test.mjs": ("cyd_planning_revision_browser_test_0037", "0037_project_planning_revision_response_lineage.sql", "ERP_PLANNING_REVISION_BROWSER_CONFIRM", "ISOLATED_0037_SYNTHETIC_ONLY"),
            "tests/selfhost-purchase-traceability-browser.test.mjs": ("erp_fix18_material_requirement_test", "0037_project_planning_revision_response_lineage.sql", "ERP_PURCHASE_SUPPLY_BROWSER_CONFIRM", "ISOLATED_FIX18_SYNTHETIC_ONLY"),
            "tests/selfhost-requirement-unit-resolution-browser.test.mjs": ("cyd_unit_resolution_browser_test_0036", "0036_project_requirement_unit_resolution.sql", "ERP_REQUIREMENT_UNIT_BROWSER_CONFIRM", "ISOLATED_0036_SYNTHETIC_ONLY"),
            "tests/selfhost-rfq-binding-fix19-browser.test.mjs": ("procurement_sourcing_test_fix19_20260804", "0037_project_planning_revision_response_lineage.sql", "ERP_RFQ_BINDING_FIX19_BROWSER_CONFIRM", "ISOLATED_FIX19_SYNTHETIC_ONLY"),
            "tests/selfhost-rfq-traceability-fix22-browser.test.mjs": ("procurement_sourcing_test_fix22_browser_20260805", "0039_rfq_traceability.sql", "ERP_RFQ_TRACEABILITY_FIX22_BROWSER_CONFIRM", "ISOLATED_FIX22_SYNTHETIC_ONLY"),
            "tests/selfhost-supplier-mapping-browser.test.mjs": ("supplier_mapping_test_fix21_20260805", "0038_supplier_mapping_governance.sql", "ERP_SUPPLIER_MAPPING_FIX21_BROWSER_CONFIRM", "ISOLATED_FIX21_SYNTHETIC_ONLY"),
        }
        for path, values in expected.items():
            self.assertEqual(source.count(path), 1)
            for value in values:
                self.assertIn(value, source)
        self.assertIn("const EXPECTED_BROWSER_FILES = 6", source)
        self.assertIn("const EXPECTED_BROWSER_TESTS = 11", source)
        self.assertIn('entry.harness === "BROWSER_E2E"', source)
        self.assertIn("summary.skipped !== 0 || summary.todo !== 0", source)
        self.assertIn("await verifyReleaseTestInventory", source)
        self.assertNotIn("...process.env", source)

    def test_node_gate_dispatches_browser_action_without_unavailable_marker(self):
        source = (SITE_ROOT / "scripts" / "run-release-node-sandbox.sh").read_text(encoding="utf-8")
        self.assertIn('exec "$SCRIPT_DIR/run-release-browser-tests.sh"', source)
        self.assertNotIn("RELEASE_TEST_REQUIRED_HARNESS_NOT_AVAILABLE", source)


if __name__ == "__main__":
    unittest.main()
