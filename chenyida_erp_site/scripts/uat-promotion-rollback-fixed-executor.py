#!/usr/bin/python3
"""Closed-set UAT rollback executor protocol boundary.

The executable intentionally remains fail-closed while the reviewed UAT database,
named-volume, and predecessor runtime materializers are unavailable.  It validates
the gateway request and the read-only trusted-FD manifest before reporting the
stable capability blocker.  No TEST restore tool is promoted through this path.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


REQUEST_CONTRACT = "chenyida-erp-uat-promotion-rollback-runtime-request/v1"
FD_MANIFEST_CONTRACT = "chenyida-erp-uat-promotion-rollback-trusted-fd-manifest/v2"
EXECUTOR_CONTRACT = "chenyida-erp-uat-promotion-rollback-fixed-executor/v1"
ACTIVATION_CONTRACT = "chenyida-erp-uat-promotion-rollback-runtime-activation/v2"
ACTIVATION_FILE = \
    "/var/lib/chenyida-erp-release-supervisor/uat-rollback-runtime-adapter/activation-v2.json"
CURRENT_FILE = \
    "/var/lib/chenyida-erp-release-supervisor/uat-rollback-runtime-adapter/current-v2.json"
EXECUTOR_FILE = "/usr/local/libexec/chenyida-erp-uat-rollback-executor-v1"
DOCKER_FILE = "/usr/bin/docker"
CATALOG_SHA256 = "1089c159743a1480c28af322c83b295ead42c8555f6320911f1102115b494b04"
CAPABILITY_STATUS = "BLOCKED_MISSING_UAT_CAPABLE_HANDLERS"
MAX_JSON_BYTES = 4 * 1024 * 1024
ZERO_SHA256 = "0" * 64
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}\Z")
LABEL = re.compile(r"[A-Z][A-Z0-9_]{1,79}\Z")
ISO_UTC = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\Z")
FD_PATH = re.compile(r"/proc/self/fd/([3-9]|[1-9][0-9]{1,5})\Z")

STAGES = (
    "PRECONDITION_RECHECK", "WRITER_CONTAINMENT", "POSTGRESQL_RESTORE",
    "UPLOADS_RESTORE", "ATTACHMENTS_RESTORE", "BACKUP_STATUS_RESTORE",
    "RUNTIME_CONFIGURATION_RESTORE", "WEB_WORKER_PREDECESSOR_ACTIVATION",
    "PROTECTED_RESOURCE_RECHECK",
)
CHECKS = (
    "POSTGRESQL_CONTENT", "UPLOADS_CONTENT", "ATTACHMENTS_CONTENT",
    "BACKUP_STATUS_CONTENT", "MIGRATION_HEAD", "CADDY_IDENTITY",
    "POSTGRES_IDENTITY", "WEB_IDENTITY", "WORKER_IDENTITY",
    "RUNTIME_CONFIGURATION", "STRICT_RELEASE_IDENTITY", "HEALTH",
    "PROTECTED_RESOURCES",
)
SOURCE_ROLES = {
    "snapshot_readiness", "snapshot_manifest", "snapshot_migrations",
    "snapshot_reconciliation", "snapshot_postgresql", "snapshot_uploads",
    "snapshot_attachments", "snapshot_backup_status", "snapshot_policy",
    "snapshot_policy_activation", "predecessor_postdeploy_receipt",
    "predecessor_release_manifest", "candidate_deployment_result",
    "candidate_postdeploy_identity", "compose_file", "compose_release_file",
    "deployment_environment", "runtime_policy", "runtime_adapter_activation",
}
INTERNAL_HANDLERS = {
    "PRECONDITION_RECHECK", "RUNTIME_CONFIGURATION_RESTORE",
    "PROTECTED_RESOURCE_RECHECK", "PROTECTED_RESOURCES",
}
HANDLERS = {
    label: f"chenyida-erp.rollback.{label.lower().replace('_', '-')}.v1"
    for label in (*STAGES, *CHECKS)
}
UNAVAILABLE = {
    "WRITER_CONTAINMENT", "POSTGRESQL_RESTORE", "UPLOADS_RESTORE",
    "ATTACHMENTS_RESTORE", "BACKUP_STATUS_RESTORE",
    "WEB_WORKER_PREDECESSOR_ACTIVATION", "POSTGRESQL_CONTENT",
    "UPLOADS_CONTENT", "ATTACHMENTS_CONTENT", "BACKUP_STATUS_CONTENT",
    "MIGRATION_HEAD", "CADDY_IDENTITY", "POSTGRES_IDENTITY", "WEB_IDENTITY",
    "WORKER_IDENTITY", "RUNTIME_CONFIGURATION", "STRICT_RELEASE_IDENTITY", "HEALTH",
}
REQUEST_FIELDS = {
    "schema_version", "contract", "action", "operation", "operation_id", "execution_mode",
    "label", "execution_package_sha256", "source_set_sha256", "transaction_intent_sha256",
    "record_intent_sha256", "runtime_plan_sha256", "previous_result_sha256", "context_sha256",
    "source_roles", "payload_sha256", "payload", "requested_at", "execution_deadline",
    "authorization_expires_at", "action_deadline", "request_sha256",
}
MANIFEST_FIELDS = {
    "schema_version", "contract", "request_sha256", "action", "operation", "operation_id",
    "execution_mode", "label", "runtime_plan_sha256", "execution_package_sha256",
    "transaction_intent_sha256", "record_intent_sha256", "source_set_sha256",
    "previous_result_sha256", "action_deadline", "handler_id", "argv_template_sha256",
    "idempotency_key", "activation", "executor", "docker", "activation_chain", "sources",
    "inherited_fds", "manifest_sha256",
}
DESCRIPTOR_FIELDS = {
    "fd", "path", "logical_path", "sha256", "uid", "gid", "mode", "device", "inode", "nlink",
}


class FixedExecutorError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def reject(code: str) -> None:
    raise FixedExecutorError(code)


def canonical(value: Any) -> bytes:
    try:
        return (json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
        ) + "\n").encode("utf-8", "strict")
    except (TypeError, ValueError, UnicodeError):
        reject("ROLLBACK_FIXED_EXECUTOR_JSON_INVALID")


def digest_value(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def without(value: dict[str, Any], field: str) -> dict[str, Any]:
    return {key: item for key, item in value.items() if key != field}


def exact(value: Any, fields: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != fields:
        reject(code)
    return value


def strict_json(raw: bytes, code: str) -> dict[str, Any]:
    if len(raw) < 2 or len(raw) > MAX_JSON_BYTES or not raw.endswith(b"\n"):
        reject(code)
    try:
        text = raw.decode("utf-8")
        seen: list[str] = []

        def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
            value: dict[str, Any] = {}
            for key, item in items:
                if key in value:
                    reject(code)
                value[key] = item
                seen.append(key)
            return value

        def parse_integer(token: str) -> int:
            if token == "-0":
                reject(code)
            parsed = int(token, 10)
            if not -(2**53 - 1) <= parsed <= 2**53 - 1:
                reject(code)
            return parsed

        value = json.loads(
            text, object_pairs_hook=pairs, parse_int=parse_integer,
            parse_float=lambda _value: reject(code), parse_constant=lambda _value: reject(code),
        )
    except (UnicodeDecodeError, json.JSONDecodeError, FixedExecutorError):
        reject(code)
    if not isinstance(value, dict) or canonical(value) != raw:
        reject(code)
    return value


def sha256_fd(descriptor: int) -> str:
    result = hashlib.sha256()
    offset = 0
    while True:
        chunk = os.pread(descriptor, 1024 * 1024, offset)
        if not chunk:
            break
        result.update(chunk)
        offset += len(chunk)
    return result.hexdigest()


def mode_text(metadata: os.stat_result) -> str:
    return f"{stat.S_IMODE(metadata.st_mode):04o}"


def validate_descriptor(value: Any, code: str) -> int:
    item = exact(value, DESCRIPTOR_FIELDS, code)
    descriptor = item.get("fd")
    path_match = FD_PATH.fullmatch(item.get("path") or "")
    if not isinstance(descriptor, int) or descriptor < 3 or path_match is None \
            or int(path_match.group(1)) != descriptor \
            or not isinstance(item.get("logical_path"), str) \
            or not item["logical_path"].startswith("/") \
            or not SHA256.fullmatch(item.get("sha256") or "") \
            or item.get("uid") != 0 or item.get("gid") != 0 \
            or item.get("mode") not in {"0400", "0440", "0444", "0555"} \
            or not isinstance(item.get("device"), str) or not item["device"].isdigit() \
            or not isinstance(item.get("inode"), str) or not item["inode"].isdigit() \
            or item.get("nlink") != 1:
        reject(code)
    try:
        metadata = os.fstat(descriptor)
    except OSError:
        reject(code)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != item["uid"] \
            or metadata.st_gid != item["gid"] or mode_text(metadata) != item["mode"] \
            or str(metadata.st_dev) != item["device"] or str(metadata.st_ino) != item["inode"] \
            or metadata.st_nlink != item["nlink"] or sha256_fd(descriptor) != item["sha256"]:
        reject(code)
    return descriptor


def validate_request(value: Any) -> dict[str, Any]:
    request = exact(value, REQUEST_FIELDS, "ROLLBACK_FIXED_EXECUTOR_REQUEST_INVALID")
    if request.get("schema_version") != 1 or request.get("contract") != REQUEST_CONTRACT \
            or request.get("operation") not in {"ROLLBACK_EXECUTION", "ROLLBACK_POSTVERIFY"} \
            or request.get("execution_mode") not in {"ORIGINAL", "RECOVERY"} \
            or not IDENTIFIER.fullmatch(request.get("operation_id") or "") \
            or not SHA256.fullmatch(request.get("request_sha256") or "") \
            or digest_value(without(request, "request_sha256")) != request["request_sha256"]:
        reject("ROLLBACK_FIXED_EXECUTOR_REQUEST_INVALID")
    for field in (
        "execution_package_sha256", "source_set_sha256", "transaction_intent_sha256",
        "runtime_plan_sha256", "context_sha256", "payload_sha256",
    ):
        if not SHA256.fullmatch(request.get(field) or "") or request[field] == ZERO_SHA256:
            reject("ROLLBACK_FIXED_EXECUTOR_REQUEST_INVALID")
    for field in ("record_intent_sha256", "previous_result_sha256"):
        if not SHA256.fullmatch(request.get(field) or ""):
            reject("ROLLBACK_FIXED_EXECUTOR_REQUEST_INVALID")
    payload = request.get("payload")
    if not isinstance(payload, dict) or not isinstance(payload.get("context"), dict) \
            or digest_value(payload) != request["payload_sha256"] \
            or digest_value(payload["context"]) != request["context_sha256"]:
        reject("ROLLBACK_FIXED_EXECUTOR_REQUEST_INVALID")
    source_roles = request.get("source_roles")
    if not isinstance(source_roles, list) or len(source_roles) != len(set(source_roles)) \
            or not source_roles or "runtime_adapter_activation" not in source_roles \
            or any(role not in SOURCE_ROLES for role in source_roles):
        reject("ROLLBACK_FIXED_EXECUTOR_REQUEST_INVALID")
    try:
        instants = {
            field: datetime.strptime(request[field], "%Y-%m-%dT%H:%M:%S.%fZ").replace(
                tzinfo=timezone.utc,
            )
            for field in (
                "requested_at", "execution_deadline", "authorization_expires_at", "action_deadline",
            )
            if isinstance(request.get(field), str) and ISO_UTC.fullmatch(request[field])
        }
    except ValueError:
        reject("ROLLBACK_FIXED_EXECUTOR_REQUEST_INVALID")
    if len(instants) != 4 or instants["action_deadline"] <= instants["requested_at"] \
            or instants["action_deadline"] > instants["authorization_expires_at"] \
            or request["execution_mode"] == "ORIGINAL" \
                and instants["action_deadline"] > instants["execution_deadline"] \
            or instants["action_deadline"] - instants["requested_at"] > timedelta(minutes=30):
        reject("ROLLBACK_FIXED_EXECUTOR_REQUEST_INVALID")
    expected_labels = STAGES if request["operation"] == "ROLLBACK_EXECUTION" else CHECKS
    action = request.get("action")
    label = request.get("label")
    if action in {"PREFLIGHT", "RECHECK", "CONTAIN"} or action == "PROBE" and label is None:
        if label is not None:
            reject("ROLLBACK_FIXED_EXECUTOR_DISPATCH_INVALID")
    elif not isinstance(label, str) or not LABEL.fullmatch(label) or label not in expected_labels:
        reject("ROLLBACK_FIXED_EXECUTOR_DISPATCH_INVALID")
    elif request["operation"] == "ROLLBACK_EXECUTION" and action not in {"PREPARE", "EXECUTE", "PROBE"} \
            or request["operation"] == "ROLLBACK_POSTVERIFY" and action not in {"PREPARE", "PROBE"}:
        reject("ROLLBACK_FIXED_EXECUTOR_DISPATCH_INVALID")
    return request


def idempotency_key(request: dict[str, Any]) -> str:
    return digest_value({
        "contract": "chenyida-erp-uat-promotion-rollback-idempotency-key/v1",
        "operation_id": request["operation_id"],
        "label": request["label"],
        "record_intent_sha256": request["record_intent_sha256"],
        "runtime_plan_sha256": request["runtime_plan_sha256"],
        "previous_result_sha256": request["previous_result_sha256"],
    })


def expected_handler(request: dict[str, Any]) -> str:
    if request["label"] is None:
        return "chenyida-erp.rollback.runtime-observation.v1"
    return HANDLERS[request["label"]]


def expected_argv_template(request: dict[str, Any]) -> list[str]:
    if request["label"] is None:
        return ["EXECUTOR_INTERNAL", "RUNTIME_OBSERVATION"]
    if request["label"] in INTERNAL_HANDLERS:
        return ["EXECUTOR_INTERNAL", request["label"]]
    return ["/proc/self/fd/{docker_fd}", "FIXED_HANDLER", request["label"]]


def validate_manifest(value: Any, request: dict[str, Any]) -> dict[str, Any]:
    manifest = exact(value, MANIFEST_FIELDS, "ROLLBACK_FIXED_EXECUTOR_FD_MANIFEST_INVALID")
    if manifest.get("schema_version") != 2 or manifest.get("contract") != FD_MANIFEST_CONTRACT \
            or digest_value(without(manifest, "manifest_sha256")) != manifest.get("manifest_sha256"):
        reject("ROLLBACK_FIXED_EXECUTOR_FD_MANIFEST_INVALID")
    for field in (
        "request_sha256", "action", "operation", "operation_id", "execution_mode", "label",
        "runtime_plan_sha256", "execution_package_sha256", "transaction_intent_sha256",
        "record_intent_sha256", "source_set_sha256", "previous_result_sha256", "action_deadline",
    ):
        if manifest.get(field) != request.get(field):
            reject("ROLLBACK_FIXED_EXECUTOR_FD_MANIFEST_BINDING_INVALID")
    handler_id = expected_handler(request)
    if manifest.get("handler_id") != handler_id \
            or manifest.get("idempotency_key") != idempotency_key(request) \
            or manifest.get("argv_template_sha256") != digest_value(expected_argv_template(request)):
        reject("ROLLBACK_FIXED_EXECUTOR_DISPATCH_INVALID")
    activation = exact(manifest.get("activation"), {
        "contract", "activation_id", "generation", "activation_sha256", "history_sha256",
        "receipt_sha256",
        "current_sha256", "executor_catalog_sha256", "capability_status",
        "supervisor_bundle_sha256", "installed_executor_sha256", "runtime_plan_sha256",
        "docker_sha256",
    }, "ROLLBACK_FIXED_EXECUTOR_ACTIVATION_INVALID")
    if activation.get("contract") != ACTIVATION_CONTRACT \
            or not IDENTIFIER.fullmatch(activation.get("activation_id") or "") \
            or not isinstance(activation.get("generation"), int) or activation["generation"] < 1 \
            or any(not SHA256.fullmatch(activation.get(field) or "") for field in (
                "activation_sha256", "history_sha256", "receipt_sha256", "current_sha256",
                "executor_catalog_sha256",
                "supervisor_bundle_sha256", "installed_executor_sha256", "runtime_plan_sha256",
                "docker_sha256",
            )) \
            or activation.get("executor_catalog_sha256") != CATALOG_SHA256 \
            or activation.get("capability_status") != CAPABILITY_STATUS \
            or activation.get("runtime_plan_sha256") != request["runtime_plan_sha256"] \
            or activation.get("supervisor_bundle_sha256") \
                != request["payload"]["context"].get("supervisor_bundle_sha256"):
        reject("ROLLBACK_FIXED_EXECUTOR_ACTIVATION_INVALID")
    executor_item = manifest.get("executor")
    docker_item = manifest.get("docker")
    descriptors = [
        validate_descriptor(executor_item, "ROLLBACK_FIXED_EXECUTOR_EXECUTOR_FD_INVALID"),
        validate_descriptor(docker_item, "ROLLBACK_FIXED_EXECUTOR_DOCKER_FD_INVALID"),
    ]
    if executor_item["logical_path"] != EXECUTOR_FILE or executor_item["mode"] != "0555" \
            or executor_item["sha256"] != activation["installed_executor_sha256"]:
        reject("ROLLBACK_FIXED_EXECUTOR_EXECUTOR_FD_INVALID")
    if docker_item["logical_path"] != DOCKER_FILE or docker_item["mode"] != "0555" \
            or docker_item["sha256"] != activation["docker_sha256"]:
        reject("ROLLBACK_FIXED_EXECUTOR_DOCKER_FD_INVALID")
    chain = exact(manifest.get("activation_chain"), {"alias", "history", "receipt", "current"},
                  "ROLLBACK_FIXED_EXECUTOR_ACTIVATION_INVALID")
    descriptors.extend(validate_descriptor(chain[name], "ROLLBACK_FIXED_EXECUTOR_ACTIVATION_INVALID")
                       for name in ("alias", "history", "receipt", "current"))
    ordinal = str(activation["generation"]).zfill(16)
    expected_chain_paths = {
        "alias": ACTIVATION_FILE,
        "current": CURRENT_FILE,
        "history": "/var/lib/chenyida-erp-release-supervisor/uat-rollback-runtime-adapter/history/"
            f"{ordinal}.{activation['history_sha256']}.json",
        "receipt": "/var/lib/chenyida-erp-release-supervisor/uat-rollback-runtime-adapter/receipts/"
            f"{ordinal}.{activation['receipt_sha256']}.json",
    }
    if chain["alias"]["logical_path"] != expected_chain_paths["alias"] \
            or chain["current"]["logical_path"] != expected_chain_paths["current"] \
            or chain["receipt"]["logical_path"] != expected_chain_paths["receipt"] \
            or chain["history"]["logical_path"] != expected_chain_paths["history"]:
        reject("ROLLBACK_FIXED_EXECUTOR_ACTIVATION_INVALID")
    sources = manifest.get("sources")
    if not isinstance(sources, dict) or set(sources) != set(request.get("source_roles") or []):
        reject("ROLLBACK_FIXED_EXECUTOR_SOURCE_FD_INVALID")
    package_sources = request["payload"].get("execution_package", {}).get("sources")
    if not isinstance(package_sources, dict):
        reject("ROLLBACK_FIXED_EXECUTOR_SOURCE_FD_INVALID")
    for role in request["source_roles"]:
        descriptors.append(validate_descriptor(
            sources[role], "ROLLBACK_FIXED_EXECUTOR_SOURCE_FD_INVALID",
        ))
        spec = package_sources.get(role)
        if not isinstance(spec, dict) or any(
            sources[role].get(descriptor_field) != spec.get(source_field)
            for descriptor_field, source_field in (
                ("logical_path", "path"), ("sha256", "sha256"), ("uid", "uid"),
                ("gid", "gid"), ("mode", "mode"), ("device", "device"),
                ("inode", "inode"), ("nlink", "nlink"),
            )
        ):
            reject("ROLLBACK_FIXED_EXECUTOR_SOURCE_FD_INVALID")
    if chain["alias"] != sources.get("runtime_adapter_activation"):
        reject("ROLLBACK_FIXED_EXECUTOR_ACTIVATION_INVALID")
    inherited = manifest.get("inherited_fds")
    if not isinstance(inherited, list) or inherited != sorted(set(inherited)) \
            or any(not isinstance(item, int) or item < 3 for item in inherited):
        reject("ROLLBACK_FIXED_EXECUTOR_INHERITED_FDS_INVALID")
    manifest_fd = int(os.environ.get("CHENYIDA_ERP_ROLLBACK_TRUSTED_FD_MANIFEST_FD", "-1"))
    lock_fd = int(os.environ.get("ERP_RELEASE_GATE_LOCK_FD", "-1"))
    expected_fds = sorted(set([*descriptors, manifest_fd, lock_fd]))
    if inherited != expected_fds:
        reject("ROLLBACK_FIXED_EXECUTOR_INHERITED_FDS_INVALID")
    opened: list[int] = []
    for name in os.listdir("/proc/self/fd"):
        if not name.isdigit() or int(name) < 3:
            continue
        try:
            os.fstat(int(name))
            opened.append(int(name))
        except OSError:
            pass
    if sorted(set(opened)) != inherited:
        reject("ROLLBACK_FIXED_EXECUTOR_INHERITED_FDS_INVALID")
    return manifest


def validate_and_select(request: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any]:
    """Pure validated dispatch result used by the fake-root table tests."""
    request = validate_request(request)
    manifest = validate_manifest(manifest, request)
    label = request["label"]
    return {
        "schema_version": 1,
        "contract": EXECUTOR_CONTRACT,
        "handler_id": expected_handler(request),
        "idempotency_key": idempotency_key(request),
        "capability_status": CAPABILITY_STATUS,
        "label_status": "UNAVAILABLE" if label in UNAVAILABLE else "AVAILABLE_READONLY_OR_METADATA_ONLY",
        "manifest_sha256": manifest["manifest_sha256"],
    }


def read_manifest() -> dict[str, Any]:
    descriptor_text = os.environ.get("CHENYIDA_ERP_ROLLBACK_TRUSTED_FD_MANIFEST_FD", "")
    if not re.fullmatch(r"(?:[3-9]|[1-9][0-9]{1,5})", descriptor_text):
        reject("ROLLBACK_FIXED_EXECUTOR_FD_MANIFEST_INVALID")
    descriptor = int(descriptor_text)
    raw = bytearray()
    while len(raw) <= MAX_JSON_BYTES:
        chunk = os.read(descriptor, min(64 * 1024, MAX_JSON_BYTES + 1 - len(raw)))
        if not chunk:
            break
        raw.extend(chunk)
    return strict_json(bytes(raw), "ROLLBACK_FIXED_EXECUTOR_FD_MANIFEST_INVALID")


def validate_argv(request: dict[str, Any]) -> None:
    expected = [request["action"].lower(), request["operation_id"]]
    if request["label"] is not None:
        expected.append(request["label"])
    if sys.argv[1:] != expected:
        reject("ROLLBACK_FIXED_EXECUTOR_ARGV_INVALID")


def main() -> None:
    try:
        request = validate_request(strict_json(sys.stdin.buffer.read(MAX_JSON_BYTES + 1),
                                               "ROLLBACK_FIXED_EXECUTOR_REQUEST_INVALID"))
        validate_argv(request)
        manifest = read_manifest()
        validate_and_select(request, manifest)
        reject("ROLLBACK_FIXED_EXECUTOR_UAT_CAPABILITY_UNAVAILABLE")
    except FixedExecutorError as error:
        sys.stderr.write(f"{error.code}\n")
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
