import importlib.util
import fcntl
import json
import os
import shutil
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SITE_ROOT = Path(__file__).resolve().parents[1]


def load_module(name, relative):
    specification = importlib.util.spec_from_file_location(name, SITE_ROOT / relative)
    module = importlib.util.module_from_spec(specification)
    assert specification.loader is not None
    sys.modules[name] = module
    specification.loader.exec_module(module)
    return module


installer = load_module("monitoring_host_delivery_installer", "scripts/install-monitoring-host-delivery.py")
generator = load_module("monitoring_host_bundle_generator", "scripts/create-monitoring-host-bundle-manifest.py")
supervisor = load_module("release_supervisor_monitoring_delivery", "scripts/release-supervisor-launcher.py")
monitor_launcher = load_module("monitoring_host_launcher", "scripts/monitoring-host-launcher.py")


class FakeSystemd:
    def __init__(self, layout, fail=None, property_overrides=None):
        self.calls = []
        self.layout = layout
        self.fail = fail
        self.property_overrides = property_overrides or {}
        self.enabled = set()
        self.active = set()

    def __call__(self, arguments):
        self.calls.append(tuple(arguments))
        failed = self.fail is not None and self.fail(tuple(arguments), len(self.calls))
        if failed:
            return SimpleNamespace(returncode=1, stdout=b"")
        if arguments[:2] == ["enable", "--now"]:
            self.enabled.add(arguments[2]); self.active.add(arguments[2])
        elif arguments[:2] == ["disable", "--now"]:
            self.enabled.discard(arguments[2]); self.active.discard(arguments[2])
        elif arguments[0] == "start":
            self.active.add(arguments[1])
        elif arguments[0] == "stop":
            self.active.discard(arguments[1])
        elif arguments[0] == "is-enabled":
            return SimpleNamespace(returncode=0 if arguments[-1] in self.enabled else 1, stdout=b"")
        elif arguments[0] == "is-active":
            return SimpleNamespace(returncode=0 if arguments[-1] in self.active else 1, stdout=b"")
        elif arguments[0] == "show":
            unit = arguments[-1]
            properties = [argument.removeprefix("--property=") for argument in arguments if argument.startswith("--property=")]
            phase = unit.removeprefix("chenyida-erp-monitor-").removesuffix(".service")
            users = {"collector": ("root", "root", "yes", ""), "evaluator": ("chenyida-monitor-eval", "chenyida-monitor-eval", "yes", "any"), "notifier": ("chenyida-monitor-notify", "chenyida-monitor-notify", "no", "any"), "continuity": ("chenyida-monitor-eval", "chenyida-monitor-eval", "yes", "any")}
            values = {"LoadState": "loaded", "FragmentPath": str(self.layout.systemd_root / unit), "DropInPaths": "", "Transient": "no"}
            if unit.endswith(".service"):
                user, group, private_network, deny = users[phase]
                launcher = str(installer.LAUNCHER_PATH)
                read_write = {"collector": "/var/lib/chenyida-erp/monitoring-v1/observations", "evaluator": "/var/lib/chenyida-erp/monitoring-v1/state /var/lib/chenyida-erp/monitoring-v1/outbox", "notifier": "/var/lib/chenyida-erp/monitoring-v1/delivery", "continuity": ""}[phase]
                inaccessible = {"collector": "/etc/chenyida-erp/monitoring-v1/private/notification.credential /var/lib/chenyida-erp/monitoring-v1/state /var/lib/chenyida-erp/monitoring-v1/outbox", "evaluator": "/var/run/docker.sock /etc/chenyida-erp/monitoring-v1/private", "notifier": "/var/run/docker.sock /var/lib/chenyida-erp/monitoring-v1/state /var/lib/chenyida-erp/monitoring-v1/observations /var/lib/chenyida-erp/monitoring-v1/projections /etc/chenyida-erp/monitoring-v1/private/host-config.json", "continuity": "/var/run/docker.sock /etc/chenyida-erp/monitoring-v1/private /var/lib/chenyida-erp/monitoring-v1/delivery"}[phase]
                values.update({"User": user, "Group": group, "ExecStart": f"{{ path={launcher} ; argv[]={launcher} {phase} ; }}", "NoNewPrivileges": "yes", "PrivateNetwork": private_network, "ProtectSystem": "strict", "MemoryDenyWriteExecute": "yes", "IPAddressDeny": deny, "ReadWritePaths": read_write, "InaccessiblePaths": inaccessible, "LoadCredential": "notification:/etc/chenyida-erp/monitoring-v1/private/notification.credential" if phase == "notifier" else ""})
            values.update(self.property_overrides.get(unit, {}))
            return SimpleNamespace(returncode=0, stdout="".join(f"{name}={values[name]}\n" for name in properties).encode("utf-8"))
        return SimpleNamespace(returncode=0, stdout=b"")


class MonitoringHostDeliveryTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="cyd-monitor-host-"))
        self.root.chmod(0o700)
        self.supervisor_lock_descriptor = None

    def tearDown(self):
        if self.supervisor_lock_descriptor is not None:
            os.close(self.supervisor_lock_descriptor)
        for directory, names, files in os.walk(self.root, topdown=False):
            for name in files:
                candidate = Path(directory) / name
                try:
                    candidate.chmod(0o600)
                    os.chown(candidate, 0, 0, follow_symlinks=False)
                except FileNotFoundError:
                    pass
            for name in names:
                candidate = Path(directory) / name
                try:
                    candidate.chmod(0o700)
                    os.chown(candidate, 0, 0, follow_symlinks=False)
                except FileNotFoundError:
                    pass
            Path(directory).chmod(0o700)
            os.chown(directory, 0, 0, follow_symlinks=False)
        shutil.rmtree(self.root)

    def layout(self):
        base = self.root / "host"
        install_root = base / "usr/local/libexec/chenyida-erp-monitoring-host-v1"
        config_root = base / "etc/chenyida-erp/monitoring-v1"
        data_root = base / "var/lib/chenyida-erp/monitoring-v1"
        values = installer.Layout(
            install_root=install_root,
            bundles_root=install_root / "bundles",
            runtimes_root=install_root / "runtimes",
            launcher_path=base / "usr/local/sbin/chenyida-erp-monitoring-host-v1",
            config_root=config_root,
            private_root=config_root / "private",
            private_config=config_root / "private/host-config.json",
            view_root=config_root / "views",
            data_root=data_root,
            active_file=data_root / "active.json",
            activation_root=data_root / "activations",
            observation_root=data_root / "observations",
            state_root=data_root / "state",
            outbox_root=data_root / "outbox",
            delivery_root=data_root / "delivery",
            projection_root=data_root / "projections",
            receipt_root=data_root / "install-receipts",
            journal_root=data_root / "install-journal",
            backup_root=data_root / "install-journal/backups",
            lock_root=data_root / "locks",
            install_lock=base / "run/lock/chenyida-erp/monitoring-host-install.lock",
            supervisor_lock=base / "run/lock/chenyida-erp-release-gate-v1.lock",
            systemd_root=base / "etc/systemd/system",
        )
        for parent in (values.install_root.parent, values.launcher_path.parent, values.config_root.parent, values.data_root.parent, values.install_lock.parent, values.systemd_root):
            parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        if self.supervisor_lock_descriptor is None:
            values.supervisor_lock.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            self.supervisor_lock_descriptor = os.open(values.supervisor_lock, os.O_CREAT | os.O_RDWR, 0o600)
            os.fchown(self.supervisor_lock_descriptor, 0, 0)
            os.fchmod(self.supervisor_lock_descriptor, 0o600)
            fcntl.flock(self.supervisor_lock_descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return values

    def source_bundle(self):
        source_root = self.root / "source"
        source_site = source_root / "chenyida_erp_site"
        launcher_raw = (SITE_ROOT / "scripts/monitoring-host-launcher.py").read_bytes()
        files = generator.parse_bundle_files(launcher_raw)
        blobs = {}
        for relative, mode in files.items():
            source = self.root.parent / "not-used"
            prefix = "chenyida_erp_site/"
            self.assertTrue(relative.startswith(prefix))
            raw = (SITE_ROOT / relative.removeprefix(prefix)).read_bytes()
            blobs[relative] = raw
            target = source_root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
            target.chmod(int(mode, 8))
        manifest = generator.build_manifest("a" * 40, "b" * 40, launcher_raw, blobs.__getitem__)
        manifest_raw = generator.canonical_json(manifest)
        manifest_path = source_site / installer.MONITOR_MANIFEST_RELATIVE
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_bytes(manifest_raw)
        manifest_path.chmod(0o444)
        return source_site, manifest, manifest_raw

    def host_config(self, expected, credential, *, generation=1, previous=None, target_id="primary-oncall", target_generation=1):
        value = {
            "schema_version": 1,
            "contract": installer.HOST_CONFIG_CONTRACT,
            "config_id": "monitoring-host-v1",
            "config_generation": generation,
            "previous_config_sha256": previous if previous is not None else "0" * 64,
            "deployment": {"class": "TEST", "id": "erp-host-test", "compose_project": "erp-host-test"},
            "installation": {
                "activation_id": expected["activation_id"],
                "installation_generation": expected["installation_generation"],
                "monitoring_bundle_sha256": expected["monitoring_bundle_sha256"],
                "supervisor_bundle_sha256": expected["supervisor_bundle_sha256"],
                "state_schema_min": 1,
                "state_schema_max": 1,
            },
            "identities": {
                "evaluator": {"user": "chenyida-monitor-eval", "uid": expected["evaluator_uid"], "gid": expected["evaluator_gid"]},
                "notifier": {"user": "chenyida-monitor-notify", "uid": expected["notifier_uid"], "gid": expected["notifier_gid"]},
            },
            "monitoring": {
                "schema_version": 1,
                "contract": "chenyida-erp-operations-monitoring-config/v1",
                "config_id": "monitoring-host-test-v1",
                "deployment_class": "TEST",
                "deployment_id": "erp-host-test",
                "compose_project": "erp-host-test",
                "service_expectations": [
                    {"service": "caddy", "container_name": "erp-host-test-caddy-1", "image_reference": f"registry.invalid/chenyida/caddy@sha256:{'1' * 64}"},
                    {"service": "postgres", "container_name": "erp-host-test-postgres-1", "image_reference": f"registry.invalid/chenyida/postgres@sha256:{'2' * 64}"},
                    {"service": "web", "container_name": "erp-host-test-web-1", "image_reference": f"registry.invalid/chenyida/web@sha256:{'a' * 64}"},
                    {"service": "worker", "container_name": "erp-host-test-worker-1", "image_reference": f"registry.invalid/chenyida/worker@sha256:{'b' * 64}"},
                ],
                "release_expectation": {
                    "application_version": "0.1.0-alpha.47",
                    "git_commit": "3" * 40,
                    "release_manifest_sha256": "4" * 64,
                    "supervisor_bundle_sha256": expected["supervisor_bundle_sha256"],
                    "migration_head": "0046_runtime_lock_privilege_boundary.sql",
                    "migration_manifest_sha256": "6" * 64,
                    "web_image_digest": f"sha256:{'a' * 64}",
                    "worker_image_digest": f"sha256:{'b' * 64}",
                },
                "backup_expectation": {"policy_id": "daily-rpo-v1", "rpo_hours": 24},
                "notification": {"required": True, "target_id": target_id},
            },
            "evidence": {
                "components_projection_path": "/var/lib/chenyida-erp/monitoring-v1/projections/components.json",
                "backup_projection_path": "/var/lib/chenyida-erp/monitoring-v1/projections/backup.json",
                "release_activation_id": expected["activation_id"],
                "release_activated_at": "2026-08-13T00:00:00.000Z",
                "postdeploy_receipt_sha256": "8" * 64,
                "components_producer_bundle_sha256": "7" * 64,
                "backup_producer_bundle_sha256": "9" * 64,
                "minimum_components_projection_generation": 1,
                "minimum_backup_projection_generation": 1,
            },
            "notification": {
                "required": True,
                "target_id": target_id,
                "target_generation": target_generation,
                "adapter": {"id": "SYNTHETIC_FAKE_ACK_V1", "version": 1, "source_sha256": "c" * 64},
                "endpoint": {"scheme": None, "host": None, "port": None, "path": None, "tls_server_name": None},
                "credential": {"source_file": "/etc/chenyida-erp/monitoring-v1/private/notification.credential", "sha256": installer.sha256(credential), "generation": 1},
                "ack": {"contract": "chenyida-erp-monitoring-remote-ack/v1", "timeout_milliseconds": 1000, "claim_ttl_seconds": 15, "retry_backoff_seconds": 15, "max_attempts": 3},
                "oncall_roster_generation": 1,
                "escalation_table_sha256": "d" * 64,
            },
        }
        raw = installer.canonical_json(value)
        path = self.root / f"config-{generation}-{target_id}.json"
        path.write_bytes(raw)
        path.chmod(0o400)
        return path, value, raw

    def write_current_state(self, layout, expected, activation, *, config_generation=1):
        value = {
            "schema_version": 1, "contract": "chenyida-erp-monitoring-host-state/v1", "wrapper_sequence": 1,
            "previous_wrapper_sha256": "0" * 64, "config_id": "monitoring-host-v1", "config_generation": config_generation,
            "host_config_sha256": expected["host_config_sha256"], "installation_generation": activation["installation_generation"],
            "monitoring_bundle_sha256": activation["monitoring_bundle_sha256"], "activation_id": activation["activation_id"],
            "monitoring_state": {}, "components_watermark": None, "backup_watermark": None,
            "delivery_ack_watermark": "0" * 64, "acknowledged_event_count": 0,
            "updated_at": "2026-08-13T00:00:00.000Z", "integrity_sha256": "",
        }
        body = dict(value)
        body.pop("integrity_sha256")
        value["integrity_sha256"] = installer.sha256(installer.canonical_json(body))
        installer.write_new_file(layout.state_root / "current.json", installer.canonical_json(value), 0o600, activation["evaluator_uid"], activation["evaluator_gid"], "INVALID")

    def fixture(self):
        layout = self.layout()
        source_site, manifest, manifest_raw = self.source_bundle()
        runtime = self.root / "node.runtime"
        shutil.copyfile("/bin/true", runtime)
        runtime.chmod(0o555)
        runtime_metadata = runtime.stat()
        credential = b"synthetic-monitoring-credential-0001\n"
        credential_path = self.root / "notification.credential"
        credential_path.write_bytes(credential)
        credential_path.chmod(0o400)
        expected = {
            "monitoring_bundle_sha256": installer.sha256(manifest_raw),
            "host_config": "",
            "host_config_sha256": "",
            "runtime_path": str(runtime),
            "runtime_sha256": installer.sha256(runtime.read_bytes()),
            "runtime_bytes": runtime_metadata.st_size,
            "runtime_dev": runtime_metadata.st_dev,
            "runtime_ino": runtime_metadata.st_ino,
            "evaluator_uid": 21001,
            "evaluator_gid": 21001,
            "notifier_uid": 21002,
            "notifier_gid": 21002,
            "activation_id": "monitoring-activation-v1",
            "installation_generation": 1,
            "previous_activation_sha256": "0" * 64,
            "supervisor_bundle_sha256": "e" * 64,
            "operation": "INSTALL",
        }
        config_path, config, config_raw = self.host_config(expected, credential)
        expected.update({"host_config": str(config_path), "host_config_sha256": installer.sha256(config_raw)})
        environment = {
            "ERP_RELEASE_SUPERVISOR_LAUNCHED": "YES",
            "ERP_RELEASE_SUPERVISOR_SITE_ROOT": str(source_site),
            "ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256": expected["supervisor_bundle_sha256"],
            "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256": "f" * 64,
            "ERP_RELEASE_GATE_LOCK_HELD": "YES",
            "ERP_RELEASE_GATE_LOCK_FD": str(self.supervisor_lock_descriptor),
        }
        return layout, expected, credential, credential_path, environment, manifest

    def test_manifest_generator_uses_literal_exact_allowlist(self):
        launcher = (SITE_ROOT / "scripts/monitoring-host-launcher.py").read_bytes()
        files = generator.parse_bundle_files(launcher)
        self.assertIn("chenyida_erp_site/tools/ops-monitoring/notifier.mjs", files)
        self.assertIn("chenyida_erp_site/deployment/systemd/chenyida-erp-monitor-notifier.service", files)
        self.assertEqual(files["chenyida_erp_site/scripts/create-monitoring-host-bundle-manifest.py"], "0555")
        self.assertLessEqual(len(files), 128)

    def test_runtime_limit_accepts_realistic_node_size_but_bundle_limit_remains_narrow(self):
        runtime = self.root / "node.large"
        runtime.write_bytes(b"n" * (installer.MAX_FILE_BYTES + 1))
        runtime.chmod(0o555)
        raw, _ = installer.trusted_file(runtime, {0o555}, 0, 0, "INVALID", installer.MAX_RUNTIME_BYTES)
        self.assertEqual(len(raw), installer.MAX_FILE_BYTES + 1)
        with self.assertRaisesRegex(installer.MonitoringInstallError, "INVALID"):
            installer.trusted_file(runtime, {0o555}, 0, 0, "INVALID", installer.MAX_FILE_BYTES)
        executable = self.root / "node.elf"
        shutil.copyfile("/bin/true", executable)
        executable.chmod(0o555)
        expected = {"runtime_bytes": executable.stat().st_size, "runtime_sha256": installer.sha256(executable.read_bytes()), "evaluator_uid": 21001, "evaluator_gid": 21001}
        with patch.object(installer.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=b"v22.13.0\n", stderr=b"")) as runner:
            self.assertEqual(installer.validate_runtime_version(executable, expected), "22.13.0")
            self.assertTrue(callable(runner.call_args.kwargs["preexec_fn"]))
        with patch.object(installer.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=b"v22.12.9\n", stderr=b"")):
            with self.assertRaisesRegex(installer.MonitoringInstallError, "MONITOR_INSTALL_RUNTIME_VERSION_INVALID"):
                installer.validate_runtime_version(executable, expected)

    def test_no_replace_writer_recovers_only_its_recognized_partial_temporary(self):
        directory = self.root / "atomic"
        directory.mkdir(mode=0o700)
        target = directory / "receipt.json"
        raw = b'{"ok":true}\n'
        interrupted = directory / f".receipt.json.prepared.{installer.sha256(raw)}.{'a' * 32}.tmp"
        interrupted.write_bytes(b"{")
        interrupted.chmod(0o400)
        installer.write_new_file(target, raw, 0o400, 0, 0, "ATOMIC_TEST")
        self.assertEqual(target.read_bytes(), raw)
        self.assertEqual([entry.name for entry in directory.iterdir()], ["receipt.json"])

    def test_installer_rejects_a_forged_supervisor_environment_without_the_inherited_lock(self):
        layout, expected, _, credential_path, environment, _ = self.fixture()
        forged = {**environment, "ERP_RELEASE_GATE_LOCK_FD": "999999"}
        with patch.dict(os.environ, forged, clear=False):
            with self.assertRaisesRegex(installer.MonitoringInstallError, "MONITOR_INSTALL_SUPERVISOR_LOCK_INVALID"):
                installer.install(expected, layout, FakeSystemd(layout), validate_accounts=False, credential_path_override=credential_path, runtime_validator=lambda _path, _expected: "22.23.2")

    def test_effective_systemd_drop_in_drift_prevents_commit(self):
        layout, expected, _, credential_path, environment, _ = self.fixture()
        systemd = FakeSystemd(layout, property_overrides={"chenyida-erp-monitor-notifier.service": {"DropInPaths": "/etc/systemd/system/chenyida-erp-monitor-notifier.service.d/override.conf"}})
        with patch.dict(os.environ, environment, clear=False):
            with self.assertRaisesRegex(installer.MonitoringInstallError, "MONITOR_INSTALL_SYSTEMD_EFFECTIVE_INVALID"):
                installer.install(expected, layout, systemd, validate_accounts=False, credential_path_override=credential_path, runtime_validator=lambda _path, _expected: "22.23.2")
        self.assertEqual(list(layout.journal_root.glob("*.committed.json")), [])
        self.assertEqual(list(layout.activation_root.glob("*.json")), [])

    def test_install_is_content_addressed_idempotent_and_disable_preserves_all_state(self):
        layout, expected, _, credential_path, environment, _ = self.fixture()
        systemd = FakeSystemd(layout)
        with patch.dict(os.environ, environment, clear=False):
            receipt = installer.install(expected, layout, systemd, validate_accounts=False, credential_path_override=credential_path, runtime_validator=lambda _path, _expected: "22.23.2")
            self.assertEqual(receipt["status"], "COMMITTED")
            active = installer.validate_activation(installer.strict_json(layout.active_file.read_bytes(), "INVALID"))
            self.assertEqual(active["monitoring_bundle_sha256"], expected["monitoring_bundle_sha256"])
            self.assertTrue((layout.bundles_root / expected["monitoring_bundle_sha256"] / "bundle-manifest.json").is_file())
            self.assertTrue((layout.runtimes_root / expected["runtime_sha256"] / "node").is_file())
            for root, expected_uid, expected_gid in ((layout.outbox_root, expected["evaluator_uid"], expected["notifier_gid"]), (layout.delivery_root, expected["notifier_uid"], expected["evaluator_gid"])):
                for directory in (root, *[candidate for candidate in root.iterdir() if candidate.is_dir()]):
                    metadata = directory.stat()
                    self.assertEqual((stat.S_IMODE(metadata.st_mode), metadata.st_uid, metadata.st_gid), (0o2750, expected_uid, expected_gid))
            launch_layout = monitor_launcher.Layout(
                install_root=layout.install_root,
                bundles_root=layout.bundles_root,
                runtimes_root=layout.runtimes_root,
                launcher_path=layout.launcher_path,
                config_root=layout.config_root,
                private_root=layout.private_root,
                private_config=layout.private_config,
                view_root=layout.view_root,
                data_root=layout.data_root,
                active_file=layout.active_file,
                activation_root=layout.activation_root,
                observation_root=layout.observation_root,
                state_root=layout.state_root,
                outbox_root=layout.outbox_root,
                delivery_root=layout.delivery_root,
                lock_root=layout.lock_root,
            )
            verified, bundle, runtime = monitor_launcher.verify_activation(launch_layout)
            self.assertEqual(verified["activation_sha256"], active["activation_sha256"])
            self.assertEqual(bundle, layout.bundles_root / expected["monitoring_bundle_sha256"])
            self.assertEqual(runtime, layout.runtimes_root / expected["runtime_sha256"] / "node")
            repeated = installer.install(expected, layout, systemd, validate_accounts=False, credential_path_override=credential_path, runtime_validator=lambda _path, _expected: "22.23.2")
            self.assertEqual(repeated["status"], "ALREADY_COMMITTED")
            before = {"state": layout.state_root.exists(), "outbox": layout.outbox_root.exists(), "delivery": layout.delivery_root.exists(), "bundle": layout.bundles_root.exists(), "runtime": layout.runtimes_root.exists()}
            disabled = installer.disable(active["activation_sha256"], "disable-fixture", layout, systemd)
            self.assertEqual(disabled["status"], "DISABLED_PRESERVED")
            self.assertEqual(before, {"state": layout.state_root.exists(), "outbox": layout.outbox_root.exists(), "delivery": layout.delivery_root.exists(), "bundle": layout.bundles_root.exists(), "runtime": layout.runtimes_root.exists()})
            self.assertEqual(installer.disable(active["activation_sha256"], "disable-fixture", layout, systemd), disabled)

    def test_idempotent_install_fails_closed_on_fixed_file_drift(self):
        layout, expected, _, credential_path, environment, _ = self.fixture()
        with patch.dict(os.environ, environment, clear=False):
            installer.install(expected, layout, FakeSystemd(layout), validate_accounts=False, credential_path_override=credential_path, runtime_validator=lambda _path, _expected: "22.23.2")
            layout.launcher_path.write_bytes(b"tampered launcher\n")
            with self.assertRaisesRegex(installer.MonitoringInstallError, "MONITOR_INSTALL_COMMITTED_LAUNCHER_INVALID"):
                installer.install(expected, layout, FakeSystemd(layout), validate_accounts=False, credential_path_override=credential_path, runtime_validator=lambda _path, _expected: "22.23.2")

    def test_crash_after_receipt_completes_the_exact_prepared_transaction(self):
        layout, expected, _, credential_path, environment, _ = self.fixture()
        systemd = FakeSystemd(layout)
        original_write = installer.write_new_file

        def interrupt_before_terminal_journal(path, *arguments, **keywords):
            if Path(path).name.endswith(".committed.json"):
                raise KeyboardInterrupt
            return original_write(path, *arguments, **keywords)

        with patch.dict(os.environ, environment, clear=False):
            with patch.object(installer, "write_new_file", side_effect=interrupt_before_terminal_journal):
                with self.assertRaises(KeyboardInterrupt):
                    installer.install(expected, layout, systemd, validate_accounts=False, credential_path_override=credential_path, runtime_validator=lambda _path, _expected: "22.23.2")
            prepared = list(layout.journal_root.glob("*.prepared.json"))
            receipts = list(layout.receipt_root.glob("*.json"))
            self.assertEqual(len(prepared), 1)
            self.assertEqual(len(receipts), 1)
            self.assertEqual(list(layout.journal_root.glob("*.committed.json")), [])
            recovered = installer.install(expected, layout, systemd, validate_accounts=False, credential_path_override=credential_path, runtime_validator=lambda _path, _expected: "22.23.2")
            self.assertEqual(recovered["status"], "ALREADY_COMMITTED")
            self.assertEqual(len(list(layout.journal_root.glob("*.committed.json"))), 1)
            self.assertEqual(list(layout.journal_root.glob("*.rolled-back.json")), [])

    def test_failed_upgrade_restores_prior_fixed_files_and_active_pointer(self):
        layout, expected, credential, credential_path, environment, _ = self.fixture()
        with patch.dict(os.environ, environment, clear=False):
            installer.install(expected, layout, FakeSystemd(layout), validate_accounts=False, credential_path_override=credential_path, runtime_validator=lambda _path, _expected: "22.23.2")
            prior_active_raw = layout.active_file.read_bytes()
            prior_private_raw = layout.private_config.read_bytes()
            prior = installer.validate_activation(installer.strict_json(prior_active_raw, "INVALID"))
            self.write_current_state(layout, expected, prior)
            next_expected = {**expected, "activation_id": "monitoring-activation-v2", "installation_generation": 2, "previous_activation_sha256": prior["activation_sha256"]}
            skipped_path, _, skipped_raw = self.host_config(next_expected, credential, generation=3, previous=expected["host_config_sha256"])
            skipped = {**next_expected, "host_config": str(skipped_path), "host_config_sha256": installer.sha256(skipped_raw)}
            with self.assertRaisesRegex(installer.MonitoringInstallError, "MONITOR_INSTALL_CONFIG_TRANSITION_INVALID"):
                installer.install(skipped, layout, FakeSystemd(layout), validate_accounts=False, credential_path_override=credential_path, runtime_validator=lambda _path, _expected: "22.23.2")
            next_path, _, next_raw = self.host_config(next_expected, credential, generation=2, previous=expected["host_config_sha256"])
            next_expected.update({"host_config": str(next_path), "host_config_sha256": installer.sha256(next_raw)})
            enable_calls = {"count": 0}
            def fail_second_enable(arguments, _count):
                if arguments[:2] != ("enable", "--now"):
                    return False
                enable_calls["count"] += 1
                return enable_calls["count"] == 2
            failing = FakeSystemd(layout, fail=fail_second_enable)
            with self.assertRaisesRegex(installer.MonitoringInstallError, "MONITOR_INSTALL_SYSTEMD_ENABLE_FAILED"):
                installer.install(next_expected, layout, failing, validate_accounts=False, credential_path_override=credential_path, runtime_validator=lambda _path, _expected: "22.23.2")
            self.assertEqual(layout.active_file.read_bytes(), prior_active_raw)
            self.assertEqual(layout.private_config.read_bytes(), prior_private_raw)
            self.assertTrue(any(path.name.endswith(".rolled-back.json") for path in layout.journal_root.iterdir()))

    def test_pending_target_rotation_is_blocked_before_activation_switch(self):
        layout, expected, credential, credential_path, environment, _ = self.fixture()
        with patch.dict(os.environ, environment, clear=False):
            installer.install(expected, layout, FakeSystemd(layout), validate_accounts=False, credential_path_override=credential_path, runtime_validator=lambda _path, _expected: "22.23.2")
            prior_raw = layout.active_file.read_bytes()
            prior = installer.validate_activation(installer.strict_json(prior_raw, "INVALID"))
            self.write_current_state(layout, expected, prior)
            event = {
                "schema_version": 1,
                "contract": "chenyida-erp-operations-alert-event/v1",
                "event_id": "",
                "sequence": 1,
                "event_type": "FIRING",
                "dedupe_key": "fixture.pending",
                "code": "HOST_MEMORY_AVAILABLE_LOW",
                "severity": "CRITICAL",
                "message_zh": "fixture",
                "runbook_ref": "docs/runbooks/fixture.md",
                "first_observed_at": "2026-08-13T00:00:00.000Z",
                "observed_at": "2026-08-13T00:00:00.000Z",
                "delivery": {"status": "PENDING", "target_id": "primary-oncall"},
            }
            event_body = dict(event)
            event_body.pop("event_id")
            event["event_id"] = installer.sha256(installer.canonical_json(event_body))
            envelope = {
                "schema_version": 1,
                "contract": "chenyida-erp-monitoring-delivery-envelope/v1",
                "envelope_id": "",
                "event_id": event["event_id"],
                "event_sha256": installer.sha256(installer.canonical_json(event)),
                "event": event,
                "deployment_id": "erp-host-test",
                "config_id": "monitoring-host-v1",
                "config_generation": 1,
                "host_config_sha256": expected["host_config_sha256"],
                "target_id": "primary-oncall",
                "target_generation": 1,
                "created_at": "2026-08-13T00:00:00.000Z",
            }
            envelope_body = dict(envelope)
            envelope_body.pop("envelope_id")
            envelope["envelope_id"] = installer.sha256(installer.canonical_json(envelope_body))
            installer.write_new_file(layout.outbox_root / "events" / f"{event['event_id']}.json", installer.canonical_json(envelope), 0o440, expected["evaluator_uid"], expected["notifier_gid"], "INVALID")
            next_expected = {**expected, "activation_id": "monitoring-activation-v2", "installation_generation": 2, "previous_activation_sha256": prior["activation_sha256"]}
            next_path, _, next_raw = self.host_config(next_expected, credential, generation=2, previous=expected["host_config_sha256"], target_id="secondary-oncall", target_generation=2)
            next_expected.update({"host_config": str(next_path), "host_config_sha256": installer.sha256(next_raw)})
            with self.assertRaisesRegex(installer.MonitoringInstallError, "MONITOR_INSTALL_PENDING_TARGET_ROTATION_BLOCKED"):
                installer.install(next_expected, layout, FakeSystemd(layout), validate_accounts=False, credential_path_override=credential_path, runtime_validator=lambda _path, _expected: "22.23.2")
            self.assertEqual(layout.active_file.read_bytes(), prior_raw)
            forged_ack = {
                "schema_version": 1,
                "contract": "chenyida-erp-monitoring-delivery-ack/v1",
                "ack_id": "",
                "event_id": event["event_id"],
                "envelope_id": envelope["envelope_id"],
                "attempt_id": "1" * 64,
                "result_id": "2" * 64,
                "target_id": "primary-oncall",
                "target_generation": 1,
                "notifier_config_sha256": "3" * 64,
                "credential_sha256": installer.sha256(credential),
                "credential_generation": 1,
                "remote_ack_id_sha256": "4" * 64,
                "acked_at": "2026-08-13T00:00:00.000Z",
                "verification": "EXACT_REMOTE_ACK_V1",
            }
            ack_body = dict(forged_ack)
            ack_body.pop("ack_id")
            forged_ack["ack_id"] = installer.sha256(installer.canonical_json(ack_body))
            installer.write_new_file(layout.delivery_root / "acks" / f"{event['event_id']}.json", installer.canonical_json(forged_ack), 0o440, expected["notifier_uid"], expected["evaluator_gid"], "INVALID")
            with self.assertRaisesRegex(installer.MonitoringInstallError, "MONITOR_INSTALL_DELIVERY_ACK_CHAIN_MISSING"):
                installer.install(next_expected, layout, FakeSystemd(layout), validate_accounts=False, credential_path_override=credential_path, runtime_validator=lambda _path, _expected: "22.23.2")
            self.assertEqual(layout.active_file.read_bytes(), prior_raw)

    def test_supervisor_maps_only_exact_monitoring_operations(self):
        runtime_sha = "1" * 64
        common = {
            "monitoring_bundle_sha256": "2" * 64,
            "host_config": str(supervisor.MONITORING_HOST_CONFIG_INPUT_ROOT / "fixture.monitoring-host-config.json"),
            "host_config_sha256": "3" * 64,
            "runtime_path": str(supervisor.MONITORING_HOST_RUNTIME_INPUT_ROOT / f"node.{runtime_sha}"),
            "runtime_sha256": runtime_sha,
            "runtime_bytes": 100_000_000,
            "runtime_dev": 10,
            "runtime_ino": 20,
            "evaluator_uid": 21001,
            "evaluator_gid": 21001,
            "notifier_uid": 21002,
            "notifier_gid": 21002,
            "activation_id": "monitoring-activation-v1",
            "installation_generation": 1,
            "previous_activation_sha256": "0" * 64,
            "supervisor_bundle_sha256": "4" * 64,
        }
        self.assertEqual(supervisor.validate_parameters("INSTALL_MONITORING_HOST_DELIVERY", common), common)
        command = supervisor.command_for(Path("/trusted/bundle"), {"operation": "INSTALL_MONITORING_HOST_DELIVERY", "parameters": common})
        self.assertEqual(command[:3], ["/usr/bin/python3", "/trusted/bundle/chenyida_erp_site/scripts/install-monitoring-host-delivery.py", "install"])
        self.assertEqual(command[-2:], ["--confirm", "INSTALL_EXACT_MONITORING_HOST_DELIVERY"])
        rollback = {**common, "rollback_target_activation_sha256": "5" * 64, "previous_activation_sha256": "6" * 64}
        self.assertEqual(supervisor.validate_parameters("ROLLBACK_MONITORING_HOST_DELIVERY", rollback), rollback)
        rollback_command = supervisor.command_for(Path("/trusted/bundle"), {"operation": "ROLLBACK_MONITORING_HOST_DELIVERY", "parameters": rollback})
        self.assertEqual(rollback_command[2], "rollback")
        disable = {"expected_active_sha256": "7" * 64, "disable_id": "disable-fixture"}
        self.assertEqual(supervisor.command_for(Path("/trusted/bundle"), {"operation": "DISABLE_MONITORING_HOST_DELIVERY", "parameters": supervisor.validate_parameters("DISABLE_MONITORING_HOST_DELIVERY", disable)})[-2:], ["--confirm", "DISABLE_EXACT_MONITORING_HOST_DELIVERY"])
        with self.assertRaisesRegex(supervisor.SupervisorError, "SUPERVISOR_MONITORING_INPUT_PATH_INVALID"):
            supervisor.validate_parameters("INSTALL_MONITORING_HOST_DELIVERY", {**common, "runtime_path": "/tmp/node"})

    def test_systemd_units_enforce_three_identities_single_flight_and_default_closed_egress(self):
        unit_root = SITE_ROOT / "deployment/systemd"
        collector = (unit_root / "chenyida-erp-monitor-collector.service").read_text(encoding="utf-8")
        evaluator = (unit_root / "chenyida-erp-monitor-evaluator.service").read_text(encoding="utf-8")
        notifier = (unit_root / "chenyida-erp-monitor-notifier.service").read_text(encoding="utf-8")
        continuity = (unit_root / "chenyida-erp-monitor-continuity.timer").read_text(encoding="utf-8")
        retry = (unit_root / "chenyida-erp-monitor-notifier.timer").read_text(encoding="utf-8")
        launcher = (SITE_ROOT / "scripts/monitoring-host-launcher.py").read_text(encoding="utf-8")
        self.assertIn("User=root", collector)
        self.assertIn("PrivateNetwork=true", collector)
        self.assertIn("User=chenyida-monitor-eval", evaluator)
        self.assertIn("IPAddressDeny=any", evaluator)
        self.assertIn("SuccessExitStatus=1 2", evaluator)
        self.assertIn("User=chenyida-monitor-notify", notifier)
        self.assertIn("LoadCredential=notification:", notifier)
        self.assertIn("IPAddressDeny=any", notifier)
        self.assertNotIn("SuccessExitStatus=2", notifier)
        self.assertNotIn("Environment=", notifier)
        self.assertIn("OnUnitActiveSec=60s", continuity)
        self.assertIn("OnUnitActiveSec=60s", retry)
        self.assertIn("fcntl.LOCK_EX | fcntl.LOCK_NB", launcher)
        self.assertIn("os.set_inheritable(descriptor, True)", launcher)
        self.assertIn("os.execve(command[0], command", launcher)
        self.assertIn('command = [str(runtime), "--jitless", str(runner), phase]', launcher)
        self.assertNotIn("useradd", launcher)
        for source in (collector, evaluator, notifier):
            self.assertIn("NoNewPrivileges=true", source)
            self.assertIn("MemoryMax=", source)
            self.assertIn("TasksMax=", source)


if __name__ == "__main__":
    unittest.main()
