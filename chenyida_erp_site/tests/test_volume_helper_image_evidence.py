from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import stat
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest import mock


SITE_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = SITE_ROOT / "scripts/volume-helper-image-evidence.py"
SPEC = importlib.util.spec_from_file_location("volume_helper_image_evidence", MODULE_PATH)
assert SPEC and SPEC.loader
evidence = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(evidence)


def token(label: str) -> str:
    return hashlib.sha256(label.encode("utf-8")).hexdigest()


def canonical(value: object) -> bytes:
    return evidence.canonical_json(value)


class VolumeHelperImageEvidenceTest(unittest.TestCase):
    generated_at = "2026-08-16T01:00:00.000Z"
    git_commit = "a" * 40
    git_tree = "b" * 40
    version = "0.1.0-alpha.47"
    image_manifest = f"sha256:{token('helper-manifest')}"
    image_config = f"sha256:{token('helper-config')}"
    image_reference = (
        f"127.0.0.1:5000/chenyida-erp/volume-restore-helper@{image_manifest}"
    )
    scanner_config = f"sha256:{token('scanner-config')}"

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.artifacts = self.root / "helper-fixture"
        self.inputs = self.root / "inputs"
        self.artifacts.mkdir(mode=0o750)
        self.artifacts.chmod(0o750)
        self.inputs.mkdir(mode=0o700)
        self.write(
            self.artifacts / evidence.ARTIFACT_MARKER,
            evidence.ARTIFACT_MARKER_VALUE,
            0o440,
        )
        self.helper_contract = self.inputs / "helper-contract.json"
        self.policy = self.inputs / "policy.json"
        self.write(
            self.helper_contract,
            (SITE_ROOT / "operations/volume-restore-helper-contract-v1.json").read_bytes(),
        )
        self.write(
            self.policy,
            (SITE_ROOT / "operations/volume-helper-vulnerability-policy-v1.json").read_bytes(),
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    @staticmethod
    def write(path: Path, raw: bytes, mode: int = 0o400) -> Path:
        path.write_bytes(raw)
        path.chmod(mode)
        return path

    def write_json(self, name: str, value: object, *, raw: bytes | None = None) -> Path:
        return self.write(self.inputs / name, raw if raw is not None else canonical(value))

    def image_inspect(self) -> dict[str, object]:
        return {
            "image_reference": self.image_reference,
            "registry_manifest_digest": self.image_manifest,
            "image_config_digest": self.image_config,
            "os": "linux",
            "architecture": "amd64",
            "repo_digests": [self.image_reference],
            "labels": {
                "org.opencontainers.image.version": self.version,
                "org.opencontainers.image.revision": self.git_commit,
                "io.chenyida.erp.git-tree": self.git_tree,
                "io.chenyida.erp.image-role": evidence.HELPER_ROLE,
                "io.chenyida.erp.volume-helper.protocol": evidence.HELPER_PROTOCOL,
                "io.chenyida.erp.volume-helper.toolchain-contract-sha256":
                    evidence.HELPER_CONTRACT_SHA256,
            },
            "user": "0:0",
            "entrypoint": ["/usr/local/bin/chenyida-erp-volume-helper"],
            "cmd": ["unsupported"],
            "working_directory": "/",
            "rootfs_layers": [
                f"sha256:{token('helper-layer-1')}", f"sha256:{token('helper-layer-2')}",
            ],
        }

    def scanner_inspect(self) -> dict[str, object]:
        return {
            "image_reference": evidence.TRIVY_IMAGE,
            "registry_manifest_digest": evidence.TRIVY_IMAGE.rsplit("@", 1)[1],
            "image_config_digest": self.scanner_config,
            "os": "linux",
            "architecture": "amd64",
            "repo_digests": [evidence.TRIVY_IMAGE],
        }

    def vulnerability(self) -> dict[str, object]:
        return {
            "SchemaVersion": 2,
            "ArtifactName": "volume-helper.tar",
            "ArtifactType": "container_image",
            "Metadata": {
                "ImageID": self.image_config,
                "RepoDigests": [self.image_reference],
                "OS": {"Family": "wolfi", "Name": "20230201"},
            },
            "Results": [{
                "Target": "volume-helper.tar (wolfi 20230201)",
                "Class": "os-pkgs",
                "Type": "wolfi",
                "Packages": [{"ID": f"fixture-{index}@1.0.0"} for index in range(5)],
                "Vulnerabilities": [],
            }],
        }

    def cyclonedx(self) -> dict[str, object]:
        root_ref = f"urn:uuid:{uuid.uuid4()}"
        os_ref = f"urn:uuid:{uuid.uuid4()}"
        packages = [
            {
                "type": "library",
                "bom-ref": f"pkg:apk/wolfi/{name}@{version}",
                "name": name,
                "version": version,
                "purl": f"pkg:apk/wolfi/{name}@{version}",
            }
            for name, version in evidence.TOOLCHAIN.items()
        ]
        return {
            "$schema": "http://cyclonedx.org/schema/bom-1.6.schema.json",
            "bomFormat": "CycloneDX",
            "specVersion": "1.6",
            "serialNumber": f"urn:uuid:{uuid.uuid4()}",
            "version": 1,
            "metadata": {
                "timestamp": self.generated_at,
                "tools": {"components": [{
                    "type": "application",
                    "manufacturer": {"name": "Aqua Security Software Ltd."},
                    "group": "aquasecurity",
                    "name": "trivy",
                    "version": evidence.TRIVY_VERSION,
                }]},
                "component": {
                    "type": "container",
                    "bom-ref": root_ref,
                    "name": "volume-helper.tar",
                    "properties": [
                        {"name": "aquasecurity:trivy:ImageID", "value": self.image_config},
                        {"name": "aquasecurity:trivy:RepoDigest",
                         "value": self.image_reference},
                    ],
                },
            },
            "components": [{
                "type": "operating-system",
                "bom-ref": os_ref,
                "name": "wolfi",
                "version": "20230201",
                "properties": [
                    {"name": "aquasecurity:trivy:Class", "value": "os-pkgs"},
                    {"name": "aquasecurity:trivy:Type", "value": "wolfi"},
                ],
            }, *packages],
            "dependencies": [
                {"ref": root_ref, "dependsOn": [item["bom-ref"] for item in packages]},
                {"ref": os_ref, "dependsOn": []},
                *[{"ref": item["bom-ref"], "dependsOn": []} for item in packages],
            ],
            "vulnerabilities": [],
        }

    def options(self, *, run_id: str = "helper-fixture", mutate=None,
                database_updated_at: str = "2026-08-16T00:00:00.000Z") -> dict[str, object]:
        values = {
            "image_inspect": self.image_inspect(),
            "scanner_inspect": self.scanner_inspect(),
            "scanner_version": {"Version": evidence.TRIVY_VERSION},
            "database_metadata": {
                "Version": 2,
                "UpdatedAt": database_updated_at,
                "DownloadedAt": database_updated_at,
                "NextUpdate": "2026-08-17T00:00:00.000Z",
            },
            "vulnerability": self.vulnerability(),
            "cyclonedx": self.cyclonedx(),
        }
        if mutate is not None:
            mutate(values)
        paths = {
            name: self.write_json(f"{run_id}-{name}.json", value)
            for name, value in values.items()
        }
        return {
            "artifact_root": str(self.artifacts),
            "run_id": run_id,
            "generated_at": self.generated_at,
            "git_commit": self.git_commit,
            "git_tree": self.git_tree,
            "application_version": self.version,
            "source_archive_sha256": token(f"{run_id}-source-archive"),
            "source_archive_bytes": 8192,
            "dockerfile_sha256": token("dockerfile"),
            "dockerignore_sha256": token("dockerignore"),
            "helper_script_sha256": token("helper-script"),
            "helper_contract": str(self.helper_contract),
            "policy": str(self.policy),
            "orchestrator_sha256": token("orchestrator"),
            "supervisor_bundle_sha256": token("supervisor-bundle"),
            "authorization_sha256": token("authorization"),
            "docker_server_version": "29.5.2",
            "buildx_version": "v0.34.1",
            "buildkit_version": "v0.30.0",
            "base_image_config_digest": f"sha256:{token('base-config')}",
            "registry_image_config_digest": f"sha256:{token('registry-config')}",
            "image_reference": self.image_reference,
            "image_config_digest": self.image_config,
            "image_inspect": str(paths["image_inspect"]),
            "archive_sha256": token(f"{run_id}-image-archive"),
            "archive_bytes": 4096,
            "archive_config_digest": self.image_config,
            "scanner_image_config_digest": self.scanner_config,
            "scanner_binary_sha256": token("scanner-binary"),
            "scanner_inspect": str(paths["scanner_inspect"]),
            "scanner_version": str(paths["scanner_version"]),
            "database_metadata": str(paths["database_metadata"]),
            "database_payload_tree_sha256": token("database-tree"),
            "vulnerability": str(paths["vulnerability"]),
            "cyclonedx": str(paths["cyclonedx"]),
        }

    def verification_options(self, output: dict[str, str]) -> dict[str, str]:
        build_path = self.artifacts / output["build_provenance_file"]
        build = json.loads(build_path.read_text(encoding="utf-8"))
        return {
            "artifact_root": str(self.artifacts),
            "run_id": "helper-fixture",
            "image_reference": output["image_reference"],
            "image_config_digest": output["image_config_digest"],
            "application_version": build["source"]["application_version"],
            "git_commit": build["source"]["git_commit"],
            "git_tree": build["source"]["git_tree"],
            "build_provenance_sha256": output["build_provenance_sha256"],
            "sbom_evidence_sha256": output["sbom_evidence_sha256"],
            "security_evidence_sha256": output["security_evidence_sha256"],
            "supervisor_bundle_sha256": build["producer"]["supervisor_bundle_sha256"],
        }

    def assert_code(self, expected: str, callback) -> None:
        with self.assertRaises(evidence.VolumeHelperEvidenceError) as caught:
            callback()
        self.assertEqual(caught.exception.code, expected)

    def test_creates_closed_immutable_evidence_chain(self) -> None:
        options = self.options()
        site_root = Path(evidence.__file__).resolve().parents[1]
        options.update({
            "dockerfile_sha256": hashlib.sha256((site_root / "Dockerfile").read_bytes()).hexdigest(),
            "dockerignore_sha256": hashlib.sha256((site_root / ".dockerignore").read_bytes()).hexdigest(),
            "helper_script_sha256": hashlib.sha256(
                (site_root / "scripts/volume-restore-helper.sh").read_bytes(),
            ).hexdigest(),
            "orchestrator_sha256": hashlib.sha256(
                (site_root / "scripts/build-volume-restore-helper-image.sh").read_bytes(),
            ).hexdigest(),
        })
        output = evidence.create_evidence(options)
        self.assertEqual(output["result"], "PASS")
        self.assertEqual(output["image_reference"], self.image_reference)
        self.assertEqual(output["image_config_digest"], self.image_config)
        files = sorted(path for path in self.artifacts.iterdir()
                       if path.name != evidence.ARTIFACT_MARKER)
        self.assertEqual(len(files), 9)
        for path in files:
            metadata = path.stat()
            self.assertEqual(stat.S_IMODE(metadata.st_mode), 0o440)
            self.assertEqual((metadata.st_uid, metadata.st_gid, metadata.st_nlink), (0, 0, 1))
            value = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(path.read_bytes(), canonical(value))
        build_path = self.artifacts / output["build_provenance_file"]
        sbom_path = self.artifacts / output["sbom_evidence_file"]
        security_path = self.artifacts / output["security_evidence_file"]
        build = evidence.validate_build_provenance(json.loads(build_path.read_text()))
        sbom = evidence.validate_sbom_evidence(
            json.loads(sbom_path.read_text()),
            {"build_provenance_sha256": output["build_provenance_sha256"]},
        )
        evidence.validate_security_evidence(
            json.loads(security_path.read_text()),
            {"build_provenance_sha256": output["build_provenance_sha256"],
             "sbom_evidence_sha256": output["sbom_evidence_sha256"]},
        )
        self.assertEqual(build["producer"]["supervisor_bundle_sha256"],
                         token("supervisor-bundle"))
        self.assertEqual(sbom["image"]["contract_sha256"], evidence.HELPER_CONTRACT_SHA256)
        self.assertEqual(hashlib.sha256(build_path.read_bytes()).hexdigest(),
                         output["build_provenance_sha256"])
        self.assertEqual(hashlib.sha256(sbom_path.read_bytes()).hexdigest(),
                         output["sbom_evidence_sha256"])
        self.assertEqual(hashlib.sha256(security_path.read_bytes()).hexdigest(),
                         output["security_evidence_sha256"])
        verified = evidence.verify_evidence(
            self.verification_options(output),
            now=evidence.instant("2026-08-16T02:00:00.000Z", "TIME"),
        )
        self.assertEqual(verified["result"], "VERIFIED")
        self.assertEqual(verified["run_id"], "helper-fixture")

    def test_verifier_rejects_digest_substitution_and_expired_evidence(self) -> None:
        options = self.options()
        site_root = Path(evidence.__file__).resolve().parents[1]
        options.update({
            "dockerfile_sha256": hashlib.sha256((site_root / "Dockerfile").read_bytes()).hexdigest(),
            "dockerignore_sha256": hashlib.sha256((site_root / ".dockerignore").read_bytes()).hexdigest(),
            "helper_script_sha256": hashlib.sha256(
                (site_root / "scripts/volume-restore-helper.sh").read_bytes(),
            ).hexdigest(),
            "orchestrator_sha256": hashlib.sha256(
                (site_root / "scripts/build-volume-restore-helper-image.sh").read_bytes(),
            ).hexdigest(),
        })
        output = evidence.create_evidence(options)
        verification = self.verification_options(output)
        self.assert_code(
            "VOLUME_HELPER_EVIDENCE_DIGEST_MISMATCH",
            lambda: evidence.verify_evidence(
                {**verification, "build_provenance_sha256": token("substitution")},
                now=evidence.instant("2026-08-16T02:00:00.000Z", "TIME"),
            ),
        )
        self.assert_code(
            "VOLUME_HELPER_EVIDENCE_EXPIRED",
            lambda: evidence.verify_evidence(
                verification,
                now=evidence.instant("2026-08-20T02:00:00.000Z", "TIME"),
            ),
        )

    def test_image_label_drift_fails_before_artifacts(self) -> None:
        def mutate(values):
            values["image_inspect"]["labels"]["io.chenyida.erp.image-role"] = "web"

        options = self.options(run_id="label-drift", mutate=mutate)
        self.assert_code(
            "VOLUME_HELPER_EVIDENCE_IMAGE_INSPECT_INVALID",
            lambda: evidence.create_evidence(options),
        )
        self.assertEqual(list(self.artifacts.iterdir()),
                         [self.artifacts / evidence.ARTIFACT_MARKER])

    def test_any_vulnerability_fails_closed(self) -> None:
        def mutate(values):
            values["vulnerability"]["Results"][0]["Vulnerabilities"] = [{
                "VulnerabilityID": "CVE-fixture", "Severity": "LOW",
            }]

        self.assert_code(
            "VOLUME_HELPER_EVIDENCE_VULNERABILITIES_FOUND",
            lambda: evidence.create_evidence(
                self.options(run_id="vulnerable", mutate=mutate),
            ),
        )

    def test_stale_vulnerability_database_fails_closed(self) -> None:
        self.assert_code(
            "VOLUME_HELPER_EVIDENCE_DATABASE_METADATA_INVALID",
            lambda: evidence.create_evidence(self.options(
                run_id="stale-db", database_updated_at="2026-08-10T00:00:00.000Z",
            )),
        )

    def test_non_wolfi_sbom_component_fails_closed(self) -> None:
        def mutate(values):
            values["cyclonedx"]["components"][1]["purl"] = "pkg:npm/foreign@1.0.0"

        self.assert_code(
            "VOLUME_HELPER_EVIDENCE_CYCLONEDX_INVALID",
            lambda: evidence.create_evidence(
                self.options(run_id="foreign-component", mutate=mutate),
            ),
        )

    def test_archive_config_must_match_image_config(self) -> None:
        options = self.options(run_id="archive-drift")
        options["archive_config_digest"] = f"sha256:{token('foreign-config')}"
        self.assert_code(
            "VOLUME_HELPER_EVIDENCE_IMAGE_ARCHIVE_INVALID",
            lambda: evidence.create_evidence(options),
        )

    def test_input_symlink_is_rejected(self) -> None:
        options = self.options(run_id="symlink")
        original = Path(options["image_inspect"])
        link = self.inputs / "inspect-link.json"
        link.symlink_to(original)
        options["image_inspect"] = str(link)
        self.assert_code(
            "VOLUME_HELPER_EVIDENCE_IMAGE_INSPECT_INVALID",
            lambda: evidence.create_evidence(options),
        )

    def test_existing_run_artifact_is_not_overwritten(self) -> None:
        options = self.options(run_id="immutable-run")
        first = evidence.create_evidence(options)
        build = self.artifacts / first["build_provenance_file"]
        before = build.read_bytes()
        self.assert_code(
            "VOLUME_HELPER_EVIDENCE_ARTIFACT_EXISTS",
            lambda: evidence.create_evidence(options),
        )
        self.assertEqual(build.read_bytes(), before)

    def test_policy_and_helper_semantic_hashes_are_self_consistent(self) -> None:
        helper = json.loads(self.helper_contract.read_text())
        policy = json.loads(self.policy.read_text())
        self.assertEqual(evidence.validate_helper_contract(helper), helper)
        self.assertEqual(evidence.validate_policy(policy), policy)

    def test_policy_mutation_is_rejected_even_with_original_self_hash(self) -> None:
        policy = json.loads(self.policy.read_text())
        policy["maximum_database_age_hours"] = 73
        self.write(self.policy, canonical(policy))
        self.assert_code(
            "VOLUME_HELPER_EVIDENCE_POLICY_INVALID",
            lambda: evidence.create_evidence(self.options(run_id="policy-drift")),
        )

    def test_security_binding_substitution_is_rejected(self) -> None:
        output = evidence.create_evidence(self.options(run_id="binding"))
        security_path = self.artifacts / output["security_evidence_file"]
        security = json.loads(security_path.read_text())
        security["sbom_evidence_sha256"] = token("foreign-sbom")
        self.assert_code(
            "VOLUME_HELPER_SECURITY_EVIDENCE_MISMATCH",
            lambda: evidence.validate_security_evidence(
                security, {"sbom_evidence_sha256": output["sbom_evidence_sha256"]},
            ),
        )

    def test_duplicate_json_keys_are_rejected(self) -> None:
        self.assert_code(
            "DUPLICATE",
            lambda: evidence.strict_json(b'{"a":1,"a":2}\n', "DUPLICATE"),
        )

    def test_artifact_root_marker_is_required(self) -> None:
        (self.artifacts / evidence.ARTIFACT_MARKER).unlink()
        self.assert_code(
            "VOLUME_HELPER_EVIDENCE_ARTIFACT_MARKER_INVALID",
            lambda: evidence.create_evidence(self.options(run_id="missing-marker")),
        )

    def test_trivy_database_tree_is_root_owned_bounded_streamed_and_stable(self) -> None:
        with tempfile.TemporaryDirectory(dir="/root") as trusted_parent:
            database = Path(trusted_parent) / "trivy-db"
            database.mkdir(mode=0o700)
            metadata = b'{"Version":2}\n'
            payload = b"trusted database payload"
            self.write(database / "metadata.json", metadata)
            self.write(database / "trivy.db", payload)
            identity = evidence.trusted_trivy_database_tree(database, maximum_bytes=1024)
            self.assertEqual(identity["entry_count"], 3)
            self.assertEqual(identity["payload_bytes"], len(metadata) + len(payload))
            self.assertEqual(identity["trust_scope"],
                             "ROOT_OWNED_STABLE_FD_TREE_NO_UPDATE_RECEIPT")

            (database / "trivy.db").chmod(0o422)
            self.assert_code(
                "VOLUME_HELPER_TRIVY_DATABASE_INVALID",
                lambda: evidence.trusted_trivy_database_tree(database, maximum_bytes=1024),
            )
            (database / "trivy.db").chmod(0o400)
            os.chown(database / "trivy.db", 1, 0)
            self.assert_code(
                "VOLUME_HELPER_TRIVY_DATABASE_INVALID",
                lambda: evidence.trusted_trivy_database_tree(database, maximum_bytes=1024),
            )
            os.chown(database / "trivy.db", 0, 0)

    def test_trivy_database_tree_rejects_links_replacement_and_oversize_before_scan(self) -> None:
        with tempfile.TemporaryDirectory(dir="/root") as trusted_parent:
            for case in ("symlink", "hardlink", "replacement", "oversize"):
                with self.subTest(case=case):
                    database = Path(trusted_parent) / f"trivy-{case}"
                    database.mkdir(mode=0o700)
                    self.write(database / "metadata.json", b'{"Version":2}\n')
                    payload = self.write(database / "trivy.db", b"payload")
                    hook = None
                    maximum = 1024
                    if case == "symlink":
                        payload.unlink()
                        payload.symlink_to(database / "metadata.json")
                    elif case == "hardlink":
                        os.link(payload, database / "duplicate.db")
                    elif case == "replacement":
                        def replace(relative: str, *, target=payload, root=database) -> None:
                            if relative == "trivy.db" and not (root / "old.db").exists():
                                target.rename(root / "old.db")
                                self.write(target, b"changed")
                        hook = replace
                    else:
                        with payload.open("r+b") as stream:
                            stream.truncate(2048)
                        maximum = 1024
                    with self.assertRaises(evidence.VolumeHelperEvidenceError):
                        evidence.trusted_trivy_database_tree(
                            database, maximum_bytes=maximum, _before_file_read=hook,
                        )

    @staticmethod
    def resource_snapshot(*, captured: float, swap_used: int = 100, oom: int = 2,
                          restart: int = 0, health: str = "healthy") -> dict[str, object]:
        containers = [{
            "id": token(f"container-{service}"), "name": f"erp-{service}-1",
            "project": "chenyida-erp", "service": service, "state": "running",
            "health": health if service in {"web", "postgres"} else "none",
            "oom_killed": False, "restart_count": restart,
        } for service in sorted(evidence.ERP_COMPOSE_SERVICES)]
        return {
            "captured_monotonic": captured, "mem_available_kib": 900_000,
            "swap_total_kib": 1_000_000, "swap_used_kib": swap_used,
            "root_free_bytes": 11 * 1024 * 1024 * 1024, "load_one": 1.5,
            "oom_kill": oom, "containers": containers,
            "free_sha256": token("free"), "df_sha256": token("df"),
            "uptime_sha256": token("uptime"),
            "docker_stats_sha256": token("docker-stats"),
            "compose_project": "chenyida-erp",
            "compose_ps_sha256": token("compose-ps"),
        }

    def test_resource_gate_enforces_fractional_swap_growth_oom_restart_and_health(self) -> None:
        before = self.resource_snapshot(captured=1000.0, swap_used=799_999)
        after = self.resource_snapshot(captured=1060.0, swap_used=800_000)
        self.assertEqual(
            evidence.validate_volume_helper_resource_window(before, after)["result"],
            "PASS",
        )
        failures = [
            {**after, "swap_used_kib": 800_001},
            self.resource_snapshot(captured=1060.0, swap_used=before["swap_used_kib"] + 262_145),
            self.resource_snapshot(captured=1060.0, swap_used=800_000, oom=3),
            self.resource_snapshot(captured=1060.0, swap_used=800_000, restart=1),
            self.resource_snapshot(captured=1060.0, swap_used=800_000, health="unhealthy"),
        ]
        missing_postgres_health = self.resource_snapshot(
            captured=1060.0, swap_used=800_000,
        )
        missing_postgres_health["containers"] = [
            {**item, "health": "none"} if item["service"] == "postgres" else item
            for item in missing_postgres_health["containers"]
        ]
        failures.append(missing_postgres_health)
        for candidate in failures:
            with self.subTest(candidate=candidate.get("swap_used_kib")):
                self.assert_code(
                    "VOLUME_HELPER_RESOURCE_GATE_FAILED",
                    lambda value=candidate: evidence.validate_volume_helper_resource_window(
                        before, value,
                    ),
                )

    def test_resource_gate_persists_and_compares_the_cross_stage_baseline(self) -> None:
        snapshots = [
            self.resource_snapshot(captured=1000.0, swap_used=100),
            self.resource_snapshot(captured=1060.0, swap_used=110),
            self.resource_snapshot(captured=1070.0, swap_used=120),
            self.resource_snapshot(captured=1130.0, swap_used=125),
        ]
        with tempfile.TemporaryDirectory(dir="/root") as temporary:
            parent = Path(temporary)
            parent.chmod(0o700)
            state_file = parent / "resource-gate-state.json"
            with mock.patch.object(
                evidence, "capture_volume_helper_resource_snapshot",
                side_effect=snapshots,
            ), mock.patch.object(evidence.time, "sleep", return_value=None):
                before = evidence.run_volume_helper_resource_gate(
                    SITE_ROOT.parent, "BUILD_BEFORE", "chenyida-erp", state_file,
                    token("bundle"), token("authorization"),
                )
                self.assertTrue(state_file.is_file())
                after = evidence.run_volume_helper_resource_gate(
                    SITE_ROOT.parent, "BUILD_AFTER", "chenyida-erp", state_file,
                    token("bundle"), token("authorization"),
                )
            self.assertEqual(before["result"], "PASS")
            self.assertEqual(after["result"], "PASS")
            self.assertEqual(after["stage_swap_growth_kib"], 10)
            self.assertFalse(state_file.exists())

    def test_cross_stage_resource_drift_cannot_hide_in_a_stable_after_window(self) -> None:
        baseline = self.resource_snapshot(captured=1060.0, swap_used=100)
        drifted = self.resource_snapshot(captured=1070.0, swap_used=110, oom=3)
        stable_after = self.resource_snapshot(captured=1130.0, swap_used=110, oom=3)
        self.assertEqual(
            evidence.validate_volume_helper_resource_window(drifted, stable_after)["result"],
            "PASS",
        )
        self.assert_code(
            "VOLUME_HELPER_RESOURCE_GATE_FAILED",
            lambda: evidence.validate_volume_helper_resource_window(
                baseline, drifted, minimum_elapsed_seconds=0,
                maximum_elapsed_seconds=evidence.RESOURCE_STAGE_MAX_SECONDS,
            ),
        )

    def test_resource_gate_rejects_a_different_compose_project(self) -> None:
        before = self.resource_snapshot(captured=1000.0)
        after = self.resource_snapshot(captured=1060.0)
        after["containers"][0] = {
            **after["containers"][0], "project": "chenyida-erp-shadow",
        }
        self.assert_code(
            "VOLUME_HELPER_RESOURCE_GATE_FAILED",
            lambda: evidence.validate_volume_helper_resource_window(before, after),
        )

    def test_build_and_each_scan_are_surrounded_by_sixty_second_resource_gates(self) -> None:
        script = (
            SITE_ROOT / "scripts/build-volume-restore-helper-image.sh"
        ).read_text(encoding="utf-8")
        self.assertLess(script.index("host_resource_gate BUILD_BEFORE"),
                        script.index("/usr/bin/docker buildx build"))
        self.assertLess(script.index("/usr/bin/docker buildx build"),
                        script.index("build_status=$?"))
        self.assertLess(script.index("build_status=$?"),
                        script.index("complete_pending_resource_gate || after_status=$?"))
        self.assertIn('host_resource_gate "${resource_phase}_BEFORE"', script)
        self.assertIn('PENDING_AFTER_PHASE="${resource_phase}_AFTER"', script)
        self.assertIn('PENDING_AFTER_PHASE=BUILD_AFTER', script)
        self.assertIn('complete_pending_resource_gate || after_status=$?', script)
        self.assertIn('build_status=$?', script)
        self.assertIn('scan_status=$?', script)
        self.assertIn('--compose-project "$PROTECTED_COMPOSE_PROJECT"', script)
        self.assertIn('"ps", "--all", "--filter"',
                      (SITE_ROOT / "scripts/volume-helper-image-evidence.py").read_text())
        self.assertIn("time.sleep(RESOURCE_SAMPLE_SECONDS)",
                      (SITE_ROOT / "scripts/volume-helper-image-evidence.py").read_text())
        self.assertIn('LOCAL_TAG="cyd-volume-restore-helper:$GIT_COMMIT-$RUN_ID"', script)

    def test_shell_accepts_the_canonical_resource_gate_key_order(self) -> None:
        canonical_gate = canonical({"phase": "BUILD_BEFORE", "result": "PASS"}).decode()
        self.assertLess(canonical_gate.index('"phase":"BUILD_BEFORE"'),
                        canonical_gate.index('"result":"PASS"'))
        script = (
            SITE_ROOT / "scripts/build-volume-restore-helper-image.sh"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "*'\"phase\":\"'\"$phase\"'\"'*'\"result\":\"PASS\"'*", script,
        )

    def test_pending_after_gate_survives_a_signal_during_its_first_attempt(self) -> None:
        script = (
            SITE_ROOT / "scripts/build-volume-restore-helper-image.sh"
        ).read_text(encoding="utf-8")
        start = script.index("complete_pending_resource_gate() {")
        end = script.index("\n}\n", start) + 3
        function_source = script[start:end]
        harness = f'''set -u
attempts=0
PENDING_AFTER_PHASE=BUILD_AFTER
host_resource_gate() {{
  attempts=$((attempts + 1))
  if [ "$attempts" -eq 1 ]; then
    kill -TERM $$
    return 1
  fi
  return 0
}}
{function_source}
trap 'complete_pending_resource_gate || true' TERM
complete_pending_resource_gate || true
printf '%s|%s\n' "$attempts" "$PENDING_AFTER_PHASE"
'''
        result = subprocess.run(
            ["/bin/sh"], input=harness, text=True, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, check=False, timeout=5,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "2|\n")


if __name__ == "__main__":
    unittest.main()
