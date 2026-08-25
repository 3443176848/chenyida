#!/usr/bin/python3
"""Pure tests for the isolated-UAT concrete system adapter."""

from __future__ import annotations

import base64
import hashlib
import importlib.util
import inspect
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


SITE_ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = SITE_ROOT / "scripts/isolated-uat-root-system-port.py"


def load_module():
    specification = importlib.util.spec_from_file_location("isolated_uat_root_system_port_test", MODULE_PATH)
    if specification is None or specification.loader is None:
        raise RuntimeError("system port unavailable")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


PORT = load_module()


def load_root_operations_module():
    source = SITE_ROOT / "scripts/isolated-uat-root-operations.py"
    specification = importlib.util.spec_from_file_location("isolated_uat_root_operations_package_test", source)
    if specification is None or specification.loader is None:
        raise RuntimeError("root operations unavailable")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


ROOT_OPS = load_root_operations_module()


class FixtureError(Exception):
    pass


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def request():
    project = "chenyida-erp-uat-port-test"
    return {
        "request_id": "task92-port-test",
        "project": project,
        "package_root": f"/var/lib/{project}/deployment-package",
        "compose_env_file": f"/var/lib/{project}/deployment-package/render.env",
        "source": {
            "package_version": "0.1.0-alpha.47",
            "git_commit": "a" * 40,
            "git_tree": "b" * 40,
            "root_operations_package_sha256": "b" * 64,
            "resolved_compose_sha256": "c" * 64,
            "release_manifest_file": f"/var/lib/{project}/release-candidate/release-manifest.json",
            "release_manifest_sha256": "d" * 64,
            "web_image": f"example.invalid/web/app@sha256:{'e' * 64}",
            "worker_image": f"example.invalid/worker/app@sha256:{'f' * 64}",
            "web_image_config_digest": f"sha256:{'1' * 64}",
            "worker_image_config_digest": f"sha256:{'2' * 64}",
        },
        "roots": {
            "runtime_secret_root": f"/etc/{project}/runtime-secrets",
            "backup_credential_root": f"/etc/{project}/operator-credentials",
            "release_candidate_root": f"/var/lib/{project}/release-candidate",
            "migration_grant_root": f"/var/lib/{project}/migration-grant",
            "state_root": f"/var/lib/{project}/root-operations-state",
        },
        "database": {
            "target_head": PORT.TARGET_HEAD,
            "migration_count": 46,
            "migration_allowlist_sha256": "4" * 64,
        },
    }


def adapter():
    api = SimpleNamespace(
        canonical_json=canonical,
        digest=lambda value: hashlib.sha256(canonical(value)).hexdigest(),
        parse_json=lambda raw, maximum=None: json.loads(raw),
        fail=lambda code: (_ for _ in ()).throw(FixtureError(code)),
    )
    return PORT.SystemOperationsPort(request(), api)


def postgres_compose(value):
    image = f"postgres@sha256:{'9' * 64}"
    network = f"{value.project}_backend"
    return {
        "services": {
            "postgres": {
                "image": image,
                "user": "999:999",
                "networks": {"backend": None},
                "tmpfs": [
                    "/tmp:rw,nosuid,nodev,noexec,size=32m,mode=1777",
                    "/run/chenyida-erp-secrets:rw,nosuid,nodev,noexec,size=1m,uid=0,gid=0,mode=0555",
                    "/var/run/postgresql:rw,nosuid,nodev,noexec,size=16m,uid=999,gid=999,mode=3775",
                ],
                "volumes": [
                    {"type": "volume", "source": "erp_postgres", "target": "/var/lib/postgresql/data"},
                    {"type": "volume", "source": "erp_postgres_tablespaces", "target": "/var/lib/postgresql/tablespaces"},
                    {
                        "type": "bind",
                        "source": f"{value.roots['runtime_secret_root']}/postgres-bootstrap-password",
                        "target": "/run/chenyida-erp-secrets/postgres-bootstrap-password",
                        "read_only": True,
                    },
                ],
            },
        },
        "volumes": {
            "erp_postgres": {"name": f"{value.project}_erp_postgres"},
            "erp_postgres_tablespaces": {"name": f"{value.project}_erp_postgres_tablespaces"},
        },
        "networks": {"backend": {"name": network}},
    }


def postgres_container(value, *, health="healthy"):
    compose = postgres_compose(value)
    service = compose["services"]["postgres"]
    network = compose["networks"]["backend"]["name"]
    manifest_digest = service["image"].rsplit("@", 1)[1]
    return {
        "Id": value.postgres_container_id,
        "Image": manifest_digest,
        "RestartCount": 0,
        "State": {
            "Running": True,
            "Paused": False,
            "Restarting": False,
            "OOMKilled": False,
            "Dead": False,
            "Health": {"Status": health},
        },
        "Config": {
            "Image": service["image"],
            "User": "999:999",
            "Labels": {
                "com.docker.compose.project": value.project,
                "com.docker.compose.service": "postgres",
            },
        },
        "HostConfig": {
            "NetworkMode": network,
            "PortBindings": {},
            "PublishAllPorts": False,
            "ReadonlyRootfs": True,
            "Privileged": False,
            "Tmpfs": {
                item.split(":", 1)[0]: item.split(":", 1)[1]
                for item in service["tmpfs"]
            },
        },
        "NetworkSettings": {
            "Ports": {"5432/tcp": None},
            "Networks": {network: {}},
        },
        "Mounts": [
            {
                "Type": "volume",
                "Name": compose["volumes"]["erp_postgres"]["name"],
                "Destination": "/var/lib/postgresql/data",
                "RW": True,
            },
            {
                "Type": "volume",
                "Name": compose["volumes"]["erp_postgres_tablespaces"]["name"],
                "Destination": "/var/lib/postgresql/tablespaces",
                "RW": True,
            },
            {
                "Type": "bind",
                "Source": f"{value.roots['runtime_secret_root']}/postgres-bootstrap-password",
                "Destination": "/run/chenyida-erp-secrets/postgres-bootstrap-password",
                "RW": False,
            },
        ],
    }


class IsolatedUatRootSystemPortTest(unittest.TestCase):
    def test_image_inspection_separates_docker29_manifest_and_config_identities(self):
        value = adapter()
        reference = value.source["worker_image"]
        manifest_digest = reference.rsplit("@", 1)[1]
        config_digest = value.source["worker_image_config_digest"]
        inspected = {
            "Id": manifest_digest,
            "Descriptor": {
                "digest": manifest_digest,
                "annotations": {"config.digest": config_digest},
            },
            "RepoDigests": [reference],
            "Os": "linux",
            "Architecture": "amd64",
            "Config": {
                "Labels": {
                    "org.opencontainers.image.version": value.source["package_version"],
                    "org.opencontainers.image.revision": value.source["git_commit"],
                },
            },
        }
        value._docker_json = mock.Mock(return_value=[inspected])

        value._inspect_image(reference, config_digest)

        value._docker_json.assert_called_once_with(
            [PORT.DOCKER, "image", "inspect", reference],
            "ISOLATED_UAT_IMAGE_INVALID",
        )
        for field, replacement in (
            (("Id",), config_digest),
            (("Descriptor", "digest"), f"sha256:{'0' * 64}"),
            (("Descriptor", "annotations", "config.digest"), manifest_digest),
            (("Os",), "windows"),
            (("Architecture",), "arm64"),
            (("RepoDigests",), []),
            (("Config", "Labels", "org.opencontainers.image.version"), "0.1.0-alpha.46"),
            (("Config", "Labels", "org.opencontainers.image.revision"), "b" * 40),
        ):
            candidate = json.loads(json.dumps(inspected))
            target = candidate
            for part in field[:-1]:
                target = target[part]
            target[field[-1]] = replacement
            value._docker_json = mock.Mock(return_value=[candidate])
            with self.subTest(field=".".join(field)), self.assertRaisesRegex(
                FixtureError, "ISOLATED_UAT_IMAGE_INVALID",
            ):
                value._inspect_image(reference, config_digest)

    def test_postgres_runtime_identity_is_exact_and_only_health_starting_is_retryable(self):
        value = adapter()
        value.postgres_container_id = "a" * 64
        value.three_layer_config = postgres_compose(value)
        healthy = postgres_container(value)
        value._docker_json = mock.Mock(return_value=[healthy])
        self.assertTrue(value._verify_postgres())

        starting = json.loads(json.dumps(healthy))
        starting["State"]["Health"]["Status"] = "starting"
        value._docker_json = mock.Mock(return_value=[starting])
        self.assertFalse(value._verify_postgres(allow_starting=True))
        with self.assertRaisesRegex(FixtureError, "POSTGRES_CONTAINER_INVALID"):
            value._verify_postgres()

        mutations = [
            lambda item: item.__setitem__("Image", f"sha256:{'8' * 64}"),
            lambda item: item["Config"].__setitem__("Image", "postgres:latest"),
            lambda item: item["Config"].__setitem__("User", "0:0"),
            lambda item: item["HostConfig"].__setitem__("PortBindings", {"5432/tcp": [{"HostPort": "5432"}]}),
            lambda item: item["NetworkSettings"]["Networks"].__setitem__("bridge", {}),
            lambda item: item["Mounts"][0].__setitem__("Name", PORT.PROTECTED_VOLUMES[0]),
            lambda item: item["HostConfig"]["Tmpfs"].pop("/tmp"),
        ]
        for index, mutate in enumerate(mutations):
            candidate = json.loads(json.dumps(healthy))
            mutate(candidate)
            value._docker_json = mock.Mock(return_value=[candidate])
            with self.subTest(index=index), self.assertRaisesRegex(
                FixtureError, "POSTGRES_CONTAINER_INVALID",
            ):
                value._verify_postgres(allow_starting=True)

    def test_start_postgres_does_not_retry_identity_failures_and_rechecks_secrets_around_up(self):
        value = adapter()
        value._assert_roots_unchanged = mock.Mock()
        value._resource_gate = mock.Mock()
        value._compose_prefix = mock.Mock(return_value=([PORT.DOCKER, "compose"], {"SAFE": "1"}))
        value._run = mock.Mock(return_value=b"")
        value._assert_runtime_secrets_unchanged = mock.Mock()
        value._find_postgres = mock.Mock(return_value="a" * 64)
        value._verify_postgres = mock.Mock(side_effect=FixtureError("ISOLATED_UAT_POSTGRES_CONTAINER_INVALID"))
        with self.assertRaisesRegex(FixtureError, "POSTGRES_CONTAINER_INVALID"):
            value.start_postgres_only(value.request)
        self.assertEqual(value._assert_runtime_secrets_unchanged.call_count, 2)
        value._verify_postgres.assert_called_once_with(allow_starting=True)

    def test_postgres_identity_queries_use_full_ids(self):
        value = adapter()
        container_id = "a" * 64
        calls = []

        def run(argv, **kwargs):
            calls.append(argv)
            return (container_id + "\n").encode()

        value._run = run
        self.assertEqual(value._find_postgres(), container_id)
        value.postgres_container_id = container_id
        value._assert_only_postgres()
        self.assertEqual(len(calls), 2)
        self.assertTrue(all("--no-trunc" in command for command in calls))

    def test_dynamic_compose_inputs_bind_only_isolated_grant(self):
        value = adapter()
        value.migration_grant = {
            "grant_sha256": "3" * 64,
            "execution_authorization_sha256": "4" * 64,
            "database": {
                "database_system_identifier": "1234567890123456789",
                "database_oid": "16384",
            },
        }
        environment = value._dynamic_environment()
        self.assertEqual(environment["ERP_UAT_COMPOSE_PROJECT"], value.project)
        self.assertEqual(environment["ERP_UAT_PROMOTION_MIGRATION_GRANT_SHA256"], "3" * 64)
        self.assertEqual(environment["ERP_ISOLATED_UAT_ROOT_OPERATIONS_PACKAGE_SHA256"], "b" * 64)
        self.assertNotIn("ERP_RELEASE_EXPECTED_SUPERVISOR_BUNDLE_SHA256", environment)
        self.assertFalse(any("staff" in key.lower() for key in environment))

    def test_helper_credentials_are_paths_not_secret_values(self):
        value = adapter()
        command = value._helper_base("bootstrap-transaction", credentials=True)
        rendered = "\n".join(command)
        self.assertEqual(command.count("--log-driver"), 1)
        self.assertEqual(command[command.index("--log-driver") + 1], "none")
        self.assertIn(value.roots["runtime_secret_root"], rendered)
        self.assertIn(value.roots["backup_credential_root"], rendered)
        self.assertIn("readonly", rendered)
        self.assertNotIn("password=", rendered.lower())
        for protected in PORT.PROTECTED_VOLUMES:
            self.assertNotIn(protected, rendered)

    def test_release_candidate_root_is_traversable_by_migration_group_but_not_writable(self):
        value = adapter()
        with tempfile.TemporaryDirectory(dir=SITE_ROOT) as temporary:
            candidate = Path(temporary) / "candidate"
            candidate.mkdir(mode=0o750)
            os.chmod(candidate, 0o750)
            value._validate_root_directory(str(candidate), mode=0o750)
            for rejected in (0o700, 0o770):
                os.chmod(candidate, rejected)
                with self.subTest(mode=oct(rejected)), self.assertRaises(FixtureError):
                    value._validate_root_directory(str(candidate), mode=0o750)

    def test_mutable_root_rejects_writable_ancestor_and_detects_inode_replacement(self):
        value = adapter()
        with tempfile.TemporaryDirectory(dir=SITE_ROOT) as temporary:
            parent = Path(temporary) / "mutable-parent"
            parent.mkdir(mode=0o700)
            target = parent / "runtime-secrets"
            target.mkdir(mode=0o700)
            os.chmod(parent, 0o770)
            with self.assertRaisesRegex(FixtureError, "ROOT_ANCESTOR_INVALID"):
                value._validate_root_directory(str(target))
            os.chmod(parent, 0o700)
            first = value._validate_root_directory(str(target))
            original = parent / "original-secrets"
            target.rename(original)
            target.mkdir(mode=0o700)
            os.chmod(target, 0o700)
            self.assertNotEqual(first, value._validate_root_directory(str(target)))

    def test_runtime_secrets_are_policy_exact_distinct_and_stable_without_receipting_values(self):
        value = adapter()
        value.package_root = SITE_ROOT
        with tempfile.TemporaryDirectory(dir=SITE_ROOT) as temporary:
            root = Path(temporary) / "runtime-secrets"
            root.mkdir(mode=0o700)
            os.chmod(root, 0o700)
            encoded_values = []
            for index, (_identifier, binding) in enumerate(sorted(PORT.EXPECTED_SECRET_BINDINGS.items())):
                name = binding[2]
                encoded = base64.urlsafe_b64encode(hashlib.sha256(f"secret-{index}".encode()).digest()).rstrip(b"=")
                self.assertEqual(len(encoded), 43)
                secret = root / name
                secret.write_bytes(encoded + (b"\n" if index % 2 else b""))
                os.chown(secret, 0, binding[4])
                os.chmod(secret, 0o440)
                encoded_values.append(encoded)
            value.roots["runtime_secret_root"] = str(root)
            value.root_identities["runtime_secret_root"] = value._validate_root_directory(str(root))
            with mock.patch.dict(os.environ, {}, clear=True):
                snapshot = value._capture_runtime_secrets()
                self.assertEqual(set(snapshot), {binding[2] for binding in PORT.EXPECTED_SECRET_BINDINGS.values()})
                self.assertTrue(all(secret.decode() not in repr(snapshot) for secret in encoded_values))
                value.runtime_secret_snapshot = snapshot
                value._assert_runtime_secrets_unchanged()

                changed = root / PORT.EXPECTED_SECRET_BINDINGS["ADMIN_DATABASE_PASSWORD"][2]
                changed.write_bytes(base64.urlsafe_b64encode(hashlib.sha256(b"replacement").digest()).rstrip(b"="))
                os.chown(changed, 0, PORT.EXPECTED_SECRET_BINDINGS["ADMIN_DATABASE_PASSWORD"][4])
                os.chmod(changed, 0o440)
                with self.assertRaisesRegex(FixtureError, "RUNTIME_SECRET_FILE_CHANGED"):
                    value._assert_runtime_secrets_unchanged()

    def test_runtime_secret_duplicate_value_and_metadata_drift_are_rejected(self):
        value = adapter()
        value.package_root = SITE_ROOT
        with tempfile.TemporaryDirectory(dir=SITE_ROOT) as temporary:
            root = Path(temporary) / "runtime-secrets"
            root.mkdir(mode=0o700)
            os.chmod(root, 0o700)
            paths = []
            for index, (_identifier, binding) in enumerate(sorted(PORT.EXPECTED_SECRET_BINDINGS.items())):
                encoded = base64.urlsafe_b64encode(hashlib.sha256(f"distinct-{index}".encode()).digest()).rstrip(b"=")
                path = root / binding[2]
                path.write_bytes(encoded)
                os.chown(path, 0, binding[4])
                os.chmod(path, 0o440)
                paths.append(path)
            value.roots["runtime_secret_root"] = str(root)
            value.root_identities["runtime_secret_root"] = value._validate_root_directory(str(root))
            with mock.patch.dict(os.environ, {}, clear=True):
                paths[1].write_bytes(paths[0].read_bytes())
                os.chown(paths[1], 0, sorted(PORT.EXPECTED_SECRET_BINDINGS.items())[1][1][4])
                os.chmod(paths[1], 0o440)
                with self.assertRaisesRegex(FixtureError, "RUNTIME_SECRET_VALUE_REUSED"):
                    value._capture_runtime_secrets()
                paths[1].write_bytes(base64.urlsafe_b64encode(hashlib.sha256(b"restored-distinct").digest()).rstrip(b"="))
                os.chown(paths[1], 0, sorted(PORT.EXPECTED_SECRET_BINDINGS.items())[1][1][4])
                os.chmod(paths[1], 0o400)
                with self.assertRaisesRegex(FixtureError, "RUNTIME_SECRET_FILE_INVALID"):
                    value._capture_runtime_secrets()

    def test_empty_failure_containment_is_explicit_and_checks_protected_volumes(self):
        value = adapter()
        value._container_ids = mock.Mock(return_value=[])
        value._assert_protected_volumes_unchanged = mock.Mock()
        with mock.patch.object(PORT.time, "sleep"):
            result = value.contain_failure(value.request)
        self.assertEqual(result, {
            "status": "QUARANTINED_RUNTIME_STOPPED",
            "postgres_containers_stopped": 0,
            "transient_containers_removed": 0,
        })
        value._assert_protected_volumes_unchanged.assert_called_once_with()

    def test_containment_stops_postgres_before_a_listed_helper_disappears(self):
        value = adapter()
        postgres_id = "a" * 64
        helper_id = "b" * 64
        value.postgres_container_id = postgres_id
        value.three_layer_config = postgres_compose(value)
        events = []
        helper_inventory = 0

        def container_ids(*filters, running_only=False):
            nonlocal helper_inventory
            if any(item == "label=com.docker.compose.service=postgres" for item in filters):
                return [postgres_id]
            if any(item == f"id={helper_id}" for item in filters):
                return []
            if any("isolated-uat-root-helper" in item for item in filters):
                helper_inventory += 1
                return [helper_id] if helper_inventory == 1 else []
            if any(item == f"label=com.docker.compose.project={value.project}" for item in filters):
                return [postgres_id]
            return []

        postgres_inspections = 0

        def inspect_owned(container_id, *, helper):
            nonlocal postgres_inspections
            if container_id == helper_id:
                events.append("helper-inspect-gone")
                raise FixtureError("ISOLATED_UAT_CONTAINMENT_OWNERSHIP_INVALID")
            postgres_inspections += 1
            events.append(f"postgres-inspect-{postgres_inspections}")
            return {
                "State": {
                    "Running": postgres_inspections == 1,
                    "Restarting": False,
                    "OOMKilled": False,
                },
            }

        def run(argv, **kwargs):
            if argv[1] == "stop":
                events.append("postgres-stop")
            return b""

        value._container_ids = container_ids
        value._inspect_owned_container = inspect_owned
        value._run = run
        value._assert_protected_volumes_unchanged = mock.Mock()
        with mock.patch.object(PORT.time, "sleep"):
            result = value.contain_failure(value.request)
        self.assertEqual(result["status"], "QUARANTINED_RUNTIME_STOPPED")
        self.assertLess(events.index("postgres-stop"), events.index("helper-inspect-gone"))
        self.assertEqual(postgres_inspections, 4)

    def test_protected_runtime_snapshot_is_exact_and_rejects_restart_drift(self):
        value = adapter()
        container_ids = [character * 64 for character in "abcd"]
        records = []
        for container_id, service in zip(container_ids, PORT.PROTECTED_SERVICES, strict=True):
            health = {"Status": "healthy"} if service in {"postgres", "web"} else None
            state = {
                "Running": True,
                "Restarting": False,
                "OOMKilled": False,
                "StartedAt": "2026-08-25T00:00:00Z",
            }
            if health is not None:
                state["Health"] = health
            records.append({
                "Id": container_id,
                "Name": f"/{PORT.PROTECTED_PROJECT}-{service}-1",
                "Image": f"sha256:{'e' * 64}",
                "RestartCount": 0,
                "State": state,
                "Config": {
                    "Image": f"example.invalid/{service}@sha256:{'f' * 64}",
                    "Labels": {
                        "com.docker.compose.project": PORT.PROTECTED_PROJECT,
                        "com.docker.compose.service": service,
                    },
                },
                "Mounts": [],
                "NetworkSettings": {
                    "Networks": {
                        f"{PORT.PROTECTED_PROJECT}_backend": {"NetworkID": "1" * 64},
                    },
                },
            })
        value._run = mock.Mock(return_value=("\n".join(container_ids) + "\n").encode())
        value._docker_json = mock.Mock(return_value=records)
        snapshot = value._snapshot_protected_runtime()
        self.assertEqual(len(json.loads(snapshot)), 4)
        drifted = json.loads(json.dumps(records))
        drifted[0]["RestartCount"] = 1
        value._docker_json = mock.Mock(return_value=drifted)
        with self.assertRaisesRegex(FixtureError, "PROTECTED_RUNTIME_INVALID"):
            value._snapshot_protected_runtime()

    def test_release_manifest_binding_includes_commit_tree_images_and_migration_set(self):
        value = adapter()
        manifest = {
            "source": {
                "git_commit": value.source["git_commit"],
                "git_tree": value.source["git_tree"],
                "package_version": value.source["package_version"],
            },
            "images": {
                "web": {"image_reference": value.source["web_image"]},
                "worker": {"image_reference": value.source["worker_image"]},
            },
            "migrations": {
                "head": value.request["database"]["target_head"],
                "allowlist_sha256": value.request["database"]["migration_allowlist_sha256"],
                "entries": [{} for _ in range(value.request["database"]["migration_count"])],
            },
        }
        value._validate_manifest_binding(canonical(manifest))
        mutations = [
            lambda item: item["source"].__setitem__("git_tree", "c" * 40),
            lambda item: item["images"]["worker"].__setitem__("image_reference", value.source["web_image"]),
            lambda item: item["migrations"]["entries"].pop(),
        ]
        for index, mutate in enumerate(mutations):
            candidate = json.loads(json.dumps(manifest))
            mutate(candidate)
            with self.subTest(index=index), self.assertRaisesRegex(
                FixtureError, "RELEASE_MANIFEST_BINDING_INVALID",
            ):
                value._validate_manifest_binding(canonical(candidate))

    def test_unlabelled_resolved_resource_name_collision_is_rejected(self):
        compose = {
            "services": {"postgres": {}},
            "volumes": {"postgres": {"name": f"{request()['project']}_erp_postgres"}},
            "networks": {"backend": {"name": f"{request()['project']}_backend"}},
        }
        for collision_kind in ("volume", "network"):
            value = adapter()

            def run(argv, **kwargs):
                if argv[1:4] == [collision_kind, "ls", "-q"]:
                    section = "volumes" if collision_kind == "volume" else "networks"
                    return (next(iter(compose[section].values()))["name"] + "\n").encode()
                return b""

            value._run = run
            with self.subTest(kind=collision_kind), self.assertRaisesRegex(
                FixtureError, "ISOLATED_UAT_PROJECT_COLLISION",
            ):
                value._assert_resolved_resource_names_absent(compose)

    def test_unlabelled_compose_or_helper_container_name_collision_is_rejected(self):
        compose = {
            "services": {"postgres": {}},
            "volumes": {"postgres": {"name": f"{request()['project']}_erp_postgres"}},
            "networks": {"backend": {"name": f"{request()['project']}_backend"}},
        }
        for container_name in (
            f"{request()['project']}-postgres-1",
            f"cyd-{request()['project']}-manifest-verify",
        ):
            value = adapter()

            def run(argv, **kwargs):
                if argv[1:3] == ["ps", "-a"]:
                    return (container_name + "\n").encode()
                return b""

            value._run = run
            with self.subTest(name=container_name), self.assertRaisesRegex(
                FixtureError, "ISOLATED_UAT_PROJECT_COLLISION",
            ):
                value._assert_resolved_resource_names_absent(compose)

    def test_run_migration_uses_exact_four_layer_one_shot_compose_argv(self):
        value = adapter()
        grant = {
            "grant_sha256": "3" * 64,
            "execution_authorization_sha256": "4" * 64,
            "database": {
                "database_system_identifier": "1234567890123456789",
                "database_oid": "16384",
            },
        }
        identity = {"database_system_identifier": "1234567890123456789"}
        value.migration_grant = grant
        value._assert_roots_unchanged = mock.Mock()
        value._resource_gate = mock.Mock()
        value._render_compose = mock.Mock(return_value={"services": {"migrate": {}}})
        value._validate_four_layer_policy = mock.Mock()
        value._run = mock.Mock(return_value=canonical({"status": "MIGRATION_COMMITTED"}))
        value._verify_postgres = mock.Mock()
        value._assert_only_postgres = mock.Mock()
        value._assert_protected_volumes_unchanged = mock.Mock()
        result = value.run_migration(value.request, identity, grant)
        self.assertEqual(result["status"], "MIGRATION_COMMITTED")
        expected_prefix = [
            PORT.DOCKER, "compose",
            "--env-file", str(value.compose_env_file),
            "--project-name", value.project,
            "--project-directory", str(value.package_root),
        ]
        for filename in PORT.COMPOSE_FILES:
            expected_prefix.extend(["-f", str(value.package_root / filename)])
        expected = [
            *expected_prefix,
            "--profile", "uat-migration", "run",
            "--name", f"cyd-{value.project}-migrate",
            "--rm", "--no-deps", "--pull", "never", "migrate",
        ]
        self.assertEqual(value._run.call_args.args[0], expected)
        self.assertEqual(value._run.call_args.kwargs["timeout"], 900)

    def test_migration_verification_passes_complete_authorization_chain_and_maps_status(self):
        value = adapter()
        bootstrap = {"status": "BOOTSTRAP_VERIFIED", "receipt_sha256": "5" * 64}
        grant = {"grant_sha256": "6" * 64}
        engine = {"engine_result_sha256": "7" * 64}
        ledger = [{"version": "0001_fixture.sql", "checksum": "8" * 64}]
        value.bootstrap_receipt = bootstrap
        value.migration_grant = grant
        value.engine_result = engine
        value.operations_compose_sha256 = "9" * 64
        value._observation = mock.Mock(return_value={"observation": {}, "ledger": ledger})
        receipt = {"status": "MIGRATION_VERIFIED", "receipt_sha256": "a" * 64}
        value._helper_json = mock.Mock(return_value=receipt)
        result = value.verify_migration(value.request, {}, bootstrap, grant, engine)
        self.assertEqual(result["status"], "MIGRATION_COMMITTED_EXACT_LEDGER_VERIFIED")
        self.assertEqual(result["receipt"], receipt)
        self.assertEqual(result["resolved_operations_compose_sha256"], "9" * 64)
        value._observation.assert_called_once_with("POST_MIGRATION_FENCED")
        value._helper_json.assert_called_once_with("migration-verify", {
            "bootstrap_receipt": bootstrap,
            "grant": grant,
            "engine_result": engine,
            "observation": {},
            "ledger": ledger,
        })

    def test_protocol_receipts_are_explicit_and_transaction_pipe_has_no_shell_or_disk_sql(self):
        source = MODULE_PATH.read_text(encoding="utf-8")
        root_source = (SITE_ROOT / "scripts/isolated-uat-root-operations.py").read_text(encoding="utf-8")
        signature = inspect.signature(PORT.SystemOperationsPort.verify_final_database)
        self.assertEqual(list(signature.parameters), [
            "self", "request", "identity", "migration", "unfence", "reconciliation",
        ])
        self.assertIn("stdin=producer.stdout", source)
        self.assertIn("stdout=subprocess.DEVNULL", source)
        self.assertNotIn("shell=True", source)
        self.assertNotIn("SYSTEM_PORT_NOT_INSTALLED", root_source)
        self.assertNotIn("postgresql-runtime-privilege-runner.mjs", source)

    def test_system_port_does_not_repeat_root_package_identity_or_full_digest(self):
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertNotIn("def _package_digest", source)
        self.assertNotIn("package_members", source)
        self.assertNotIn("running_root = Path(__file__)", source)

    def test_package_closure_contains_every_new_authority_boundary(self):
        expected = {
            "compose.uat-operations.yml",
            "scripts/isolated-uat-root-operations.py",
            "scripts/isolated-uat-root-system-port.py",
            "scripts/isolated-uat-database-operation-cli.mjs",
            "scripts/isolated-uat-database-operator.mjs",
            "scripts/isolated-uat-migration-execution-contract.mjs",
            "scripts/release-migration-authorization.ts",
            "scripts/migrate-postgres.ts",
        }
        self.assertTrue(expected.issubset(set(ROOT_OPS.ROOT_OPERATIONS_PACKAGE_MEMBERS)))


if __name__ == "__main__":
    unittest.main()
