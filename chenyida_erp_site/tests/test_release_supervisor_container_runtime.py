import copy
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path


SITE_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = SITE_ROOT / "scripts" / "container-runtime-policy.py"
PROBE_MODULE_PATH = SITE_ROOT / "scripts" / "container-runtime-policy-test.py"
POLICY_PATH = SITE_ROOT / "operations" / "container-runtime-policy-v1.json"
SPEC = importlib.util.spec_from_file_location("container_runtime_policy", MODULE_PATH)
runtime_policy = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(runtime_policy)
PROBE_SPEC = importlib.util.spec_from_file_location("container_runtime_policy_test", PROBE_MODULE_PATH)
runtime_probe = importlib.util.module_from_spec(PROBE_SPEC)
assert PROBE_SPEC.loader is not None
PROBE_SPEC.loader.exec_module(runtime_probe)

WEB_IMAGE = f"registry.invalid/chenyida/web@sha256:{'a' * 64}"
WORKER_IMAGE = f"registry.invalid/chenyida/worker@sha256:{'b' * 64}"
WEB_CONFIG = f"sha256:{'c' * 64}"
WORKER_CONFIG = f"sha256:{'d' * 64}"
READER_GID = "1000"


def compose_mount(mount, project_root):
    source = mount["source"]
    if source == "$PROJECT_ROOT/deploy/Caddyfile":
        source = str(project_root / "deploy" / "Caddyfile")
    if mount["type"] == "bind":
        return {
            "type": "bind",
            "source": source,
            "target": mount["target"],
            "read_only": mount["read_only"],
            "bind": {"create_host_path": False},
        }
    value = {"type": "volume", "source": source, "target": mount["target"], "volume": {}}
    if mount["read_only"]:
        value["read_only"] = True
    return value


def resolved_fixture(policy, project_root):
    app_environment = {key: "fixture" for key in policy["app_environment_keys"]}
    app_environment.update(runtime_policy.ENVIRONMENT_CONSTANTS)
    compose = {
        "name": "chenyida-erp",
        "networks": {
            "backend": {"name": "chenyida-erp_backend", "ipam": {}, "internal": True},
            "edge": {"name": "chenyida-erp_edge", "ipam": {}},
        },
        "services": {},
        "volumes": {
            name: {"name": f"chenyida-erp_{name}"} for name in policy["project"]["volumes"]
        },
        "x-app-environment": app_environment,
        "x-app-volumes": [
            {"type": "volume", "source": "erp_uploads", "target": "/data/chenyida-erp/uploads"},
            {
                "type": "volume",
                "source": "erp_attachments",
                "target": "/data/chenyida-erp/attachments",
            },
        ],
        "x-release-build-args": {
            "ERP_BUILD_REVISION": "0" * 40,
            "ERP_BUILD_VERSION": "0.0.0-fixture",
        },
    }
    for contract in policy["services"]:
        name = contract["service"]
        image = runtime_policy.expected_image(contract, WEB_IMAGE, WORKER_IMAGE)
        environment_keys = set(contract["environment_additions"])
        if contract["environment_profile"] == "app_release":
            environment_keys.update(policy["app_environment_keys"])
            environment_keys.update({"ERP_RUNTIME_IMAGE_REFERENCE", "ERP_RUNTIME_IMAGE_CONFIG_DIGEST"})
        environment = {key: "fixture" for key in environment_keys}
        environment.update({key: value for key, value in app_environment.items() if key in environment})
        environment.update(runtime_policy.SERVICE_ENVIRONMENT_CONSTANTS.get(name, {}))
        if contract["environment_profile"] == "app_release":
            environment["ERP_RUNTIME_IMAGE_REFERENCE"] = image
            environment["ERP_RUNTIME_IMAGE_CONFIG_DIGEST"] = WEB_CONFIG if name == "web" else WORKER_CONFIG

        actual = {
            "cap_drop": contract["cap_drop"],
            "command": contract["process"]["command"],
            "cpus": contract["resources"]["cpus"],
            "entrypoint": contract["process"]["entrypoint"],
            "environment": environment,
            "image": image,
            "logging": {
                "driver": contract["logging"]["driver"],
                "options": {
                    "max-file": contract["logging"]["max_file"],
                    "max-size": contract["logging"]["max_size"],
                },
            },
            "mem_limit": str(contract["resources"]["memory_bytes"]),
            "memswap_limit": str(contract["resources"]["memory_swap_bytes"]),
            "networks": {network: None for network in contract["networks"]},
            "pids_limit": contract["resources"]["pids"],
            "read_only": contract["read_only_rootfs"],
            "restart": contract["lifecycle"]["restart"],
            "security_opt": contract["security_options"],
            "user": contract["user"],
        }
        if "cap_add" in contract["allowed_compose_fields"]:
            actual["cap_add"] = contract["cap_add"]
        if "depends_on" in contract["allowed_compose_fields"]:
            actual["depends_on"] = {
                dependency: {"condition": condition, "required": True}
                for dependency, condition in contract["dependencies"].items()
            }
        if "group_add" in contract["allowed_compose_fields"]:
            actual["group_add"] = [READER_GID]
        if "healthcheck" in contract["allowed_compose_fields"]:
            actual["healthcheck"] = {
                key: value for key, value in contract["healthcheck"].items() if value is not None
            }
        if "init" in contract["allowed_compose_fields"]:
            actual["init"] = contract["lifecycle"]["init"]
        if "ports" in contract["allowed_compose_fields"]:
            actual["ports"] = [
                {
                    "mode": "ingress",
                    "host_ip": port["host_ip"],
                    "target": port["target"],
                    "published": port["published_default"],
                    "protocol": port["protocol"],
                }
                for port in contract["ports"]
            ]
        if "profiles" in contract["allowed_compose_fields"]:
            actual["profiles"] = contract["lifecycle"]["profiles"]
        if "shm_size" in contract["allowed_compose_fields"]:
            actual["shm_size"] = str(contract["resources"]["shared_memory_bytes"])
        if "stop_grace_period" in contract["allowed_compose_fields"]:
            actual["stop_grace_period"] = contract["lifecycle"]["stop_grace_period"]
        if "tmpfs" in contract["allowed_compose_fields"]:
            actual["tmpfs"] = contract["tmpfs"]
        if "volumes" in contract["allowed_compose_fields"]:
            actual["volumes"] = [compose_mount(mount, project_root) for mount in contract["mounts"]]
        assert sorted(actual) == contract["allowed_compose_fields"]
        compose["services"][name] = actual
    return compose


class ContainerRuntimePolicyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.policy, cls.policy_digest = runtime_policy.load_policy(POLICY_PATH, SITE_ROOT)

    def setUp(self):
        self.compose = resolved_fixture(self.policy, SITE_ROOT)

    def validate(self, value=None):
        runtime_policy.validate_compose(
            self.compose if value is None else value,
            self.policy,
            SITE_ROOT,
            WEB_IMAGE,
            WORKER_IMAGE,
            WEB_CONFIG,
            WORKER_CONFIG,
            READER_GID,
        )

    def rejects(self, code, mutation):
        value = copy.deepcopy(self.compose)
        mutation(value)
        with self.assertRaisesRegex(runtime_policy.PolicyError, f"^{code}$"):
            self.validate(value)

    def test_exact_six_service_contract_is_accepted(self):
        self.validate()
        self.assertEqual(self.policy_digest, runtime_policy.EXPECTED_POLICY_SHA256)

    def test_hidden_profile_and_forbidden_service_fields_fail_closed(self):
        self.rejects("SERVICE_SET_POLICY_MISMATCH", lambda value: value["services"].pop("admin"))
        self.rejects(
            "FORBIDDEN_SERVICE_FIELD",
            lambda value: value["services"]["worker"].__setitem__("privileged", True),
        )
        self.rejects("FORBIDDEN_TOP_LEVEL_FIELD", lambda value: value.__setitem__("secrets", {}))

    def test_identity_rootfs_capability_group_and_tmpfs_drift_fail(self):
        self.rejects("USER_POLICY_MISMATCH", lambda value: value["services"]["postgres"].__setitem__("user", "0:0"))
        self.rejects("ROOTFS_POLICY_MISMATCH", lambda value: value["services"]["web"].__setitem__("read_only", False))
        self.rejects(
            "CAPABILITIES_POLICY_MISMATCH",
            lambda value: value["services"]["caddy"].__setitem__("cap_add", ["NET_ADMIN"]),
        )
        self.rejects("GROUPS_POLICY_MISMATCH", lambda value: value["services"]["web"].__setitem__("group_add", ["0"]))
        self.rejects(
            "TMPFS_POLICY_MISMATCH",
            lambda value: value["services"]["postgres"]["tmpfs"].__setitem__(0, "/tmp:rw,size=32m"),
        )

    def test_bind_volume_port_network_resource_and_logging_drift_fail(self):
        self.rejects(
            "BIND_MOUNT_FORBIDDEN",
            lambda value: value["services"]["web"]["volumes"][3].__setitem__("source", "/var/run/docker.sock"),
        )
        self.rejects(
            "TOP_LEVEL_VOLUMES_POLICY_MISMATCH",
            lambda value: value["volumes"]["erp_postgres"].__setitem__("driver_opts", {"type": "none"}),
        )
        self.rejects(
            "PORTS_POLICY_MISMATCH",
            lambda value: value["services"]["web"]["ports"][0].__setitem__("host_ip", "0.0.0.0"),
        )
        self.rejects(
            "TOP_LEVEL_NETWORKS_POLICY_MISMATCH",
            lambda value: value["networks"]["backend"].__setitem__("internal", False),
        )
        self.rejects("RESOURCES_POLICY_MISMATCH", lambda value: value["services"]["worker"].__setitem__("mem_limit", "0"))
        self.rejects(
            "LOGGING_POLICY_MISMATCH",
            lambda value: value["services"]["caddy"]["logging"]["options"].__setitem__("max-file", "99"),
        )

    def test_environment_runtime_identity_and_dependency_drift_fail(self):
        self.rejects(
            "ENVIRONMENT_KEYS_POLICY_MISMATCH",
            lambda value: value["services"]["web"]["environment"].__setitem__("UNREVIEWED", "value"),
        )
        self.rejects(
            "RUNTIME_IDENTITY_POLICY_MISMATCH",
            lambda value: value["services"]["worker"]["environment"].__setitem__(
                "ERP_RUNTIME_IMAGE_CONFIG_DIGEST", WEB_CONFIG
            ),
        )
        self.rejects(
            "DEPENDENCIES_POLICY_MISMATCH",
            lambda value: value["services"]["web"]["depends_on"]["migrate"].__setitem__("required", False),
        )

    def test_duplicate_json_and_source_drift_are_rejected(self):
        with self.assertRaisesRegex(runtime_policy.PolicyError, "^JSON_DUPLICATE_KEY$"):
            runtime_policy.parse_json(b'{"services":{},"services":{}}', "COMPOSE_JSON_INVALID")
        with tempfile.TemporaryDirectory(prefix="cyd-runtime-policy-") as temporary:
            root = Path(temporary)
            for source in self.policy["sources"]:
                target = root / source["path"]
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(SITE_ROOT / source["path"], target)
            (root / "compose.yml").write_bytes((root / "compose.yml").read_bytes() + b"\n")
            with self.assertRaisesRegex(runtime_policy.PolicyError, "^POLICY_SOURCE_DIGEST_MISMATCH$"):
                runtime_policy.load_policy(POLICY_PATH, root)

    def test_invalid_compose_output_never_echoes_input(self):
        command = [
            sys.executable,
            str(MODULE_PATH),
            "validate",
            "--policy",
            str(POLICY_PATH),
            "--project-root",
            str(SITE_ROOT),
            "--compose-version",
            "5.1.4",
            "--engine-version",
            "29.5.2",
            "--web-image",
            WEB_IMAGE,
            "--worker-image",
            WORKER_IMAGE,
            "--web-config-digest",
            WEB_CONFIG,
            "--worker-config-digest",
            WORKER_CONFIG,
            "--reader-gid",
            READER_GID,
        ]
        result = subprocess.run(
            command,
            input=b'{"credential":"DO_NOT_ECHO_THIS_VALUE",',
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        combined = result.stdout + result.stderr
        self.assertNotIn(b"DO_NOT_ECHO_THIS_VALUE", combined)
        self.assertIn(b"CONTAINER_RUNTIME_POLICY_FAILED:COMPOSE_JSON_INVALID", combined)


class ContainerRuntimeProbeContractTest(unittest.TestCase):
    def test_image_identity_separates_manifest_and_config_digests(self):
        manifest = f"sha256:{'a' * 64}"
        config = f"sha256:{'b' * 64}"
        reference = f"registry.invalid/chenyida/web@{manifest}"
        image = {
            "Id": manifest,
            "Os": "linux",
            "Architecture": "amd64",
            "RepoDigests": [reference],
            "Descriptor": {"digest": manifest, "annotations": {"config.digest": config}},
            "Config": {"Volumes": {}},
        }
        with mock.patch.object(runtime_probe, "docker_json", return_value=[image]):
            runtime_probe.inspect_image(reference, config, [])

        wrong_config = copy.deepcopy(image)
        wrong_config["Descriptor"]["annotations"]["config.digest"] = f"sha256:{'c' * 64}"
        with mock.patch.object(runtime_probe, "docker_json", return_value=[wrong_config]):
            with self.assertRaisesRegex(runtime_probe.RuntimeTestError, "^IMAGE_CONFIG_DIGEST_MISMATCH$"):
                runtime_probe.inspect_image(reference, config, [])

        wrong_manifest = copy.deepcopy(image)
        wrong_manifest["Descriptor"]["digest"] = f"sha256:{'d' * 64}"
        with mock.patch.object(runtime_probe, "docker_json", return_value=[wrong_manifest]):
            with self.assertRaisesRegex(runtime_probe.RuntimeTestError, "^IMAGE_MANIFEST_DIGEST_MISMATCH$"):
                runtime_probe.inspect_image(reference, config, [])

    def test_proc_status_parser_requires_complete_numeric_security_state(self):
        value = runtime_probe.parse_status(
            "Uid:\t65532\t65532\t65532\t65532\n"
            "Gid:\t0\t0\t0\t0\n"
            "Groups:\t0 1000\n"
            "CapEff:\t0000000000000400\n"
            "NoNewPrivs:\t1\n"
        )
        self.assertEqual(value["Uid"], [65532] * 4)
        self.assertEqual(value["Gid"], [0] * 4)
        self.assertEqual(value["Groups"], [0, 1000])
        self.assertEqual(value["CapEff"], 1 << 10)
        self.assertEqual(value["NoNewPrivs"], 1)
        with self.assertRaisesRegex(runtime_probe.RuntimeTestError, "^PROCESS_STATUS_INVALID$"):
            runtime_probe.parse_status("Uid:\t65532\n")

    def test_tmpfs_contract_requires_write_and_all_security_flags(self):
        contract = {"tmpfs": ["/tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777"]}
        self.assertEqual(runtime_probe.required_tmpfs_targets(contract), {"/tmp"})
        contract["tmpfs"] = ["/tmp:rw,nosuid,nodev,size=64m"]
        with self.assertRaisesRegex(runtime_probe.RuntimeTestError, "^POLICY_TMPFS_INVALID$"):
            runtime_probe.required_tmpfs_targets(contract)

    def test_probe_names_protected_volumes_and_single_container_label_are_fixed(self):
        self.assertEqual(
            runtime_probe.PROTECTED_VOLUMES,
            {
                "chenyida-erp-parallel_erp_postgres",
                "chenyida-erp-parallel_erp_uploads",
                "chenyida-erp-parallel_erp_attachments",
                "chenyida-erp-parallel_erp_backup_status",
            },
        )
        self.assertEqual(runtime_probe.LABEL, "chenyida.erp.container-runtime-policy-test")
        source = PROBE_MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn("max_containers=1", source)
        self.assertIn("--pull", source)
        self.assertIn("never", source)
        self.assertNotIn('"--privileged"', source)
        self.assertNotIn("/var/run/docker.sock,target=", source)


if __name__ == "__main__":
    unittest.main()
