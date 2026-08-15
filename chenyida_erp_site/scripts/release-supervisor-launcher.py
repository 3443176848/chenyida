#!/usr/bin/python3
"""Root-owned, content-addressed launcher for exact ERP release operations."""

from __future__ import annotations

import hashlib
import fcntl
import ipaddress
import json
import os
import re
import signal
import shutil
import shlex
import stat
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


SUPERVISOR_BASE = Path("/usr/local/libexec/chenyida-erp-release-supervisor")
BUNDLES_ROOT = SUPERVISOR_BASE / "bundles"
LAUNCHER_PATH = Path("/usr/local/sbin/chenyida-erp-release-supervisor-v1")
AUTHORIZATION_ROOT = Path("/var/lib/chenyida-erp/release-authorizations")
AUTHORIZATION_PENDING_ROOT = AUTHORIZATION_ROOT / "pending"
AUTHORIZATION_CONSUMED_ROOT = AUTHORIZATION_ROOT / "consumed"
RELEASE_ARTIFACT_ROOT_BASE = Path("/var/lib/chenyida-erp/release-artifacts")
POSTDEPLOY_ROOT_BASE = Path("/var/lib/chenyida-erp/postdeploy")
RELEASE_IDENTITY_ROOT = Path("/var/lib/chenyida-erp/release-identity")
RUNTIME_PROBE_ROOT = Path("/var/lib/chenyida-erp/runtime-probes")
BUNDLE_CONTRACT = "chenyida-erp-release-supervisor-bundle/v1"
AUTHORIZATION_CONTRACT = "chenyida-erp-release-supervisor-authorization/v2"
RUNTIME_PRIVILEGE_AUTHORIZATION_CONTRACT = "chenyida-erp-release-supervisor-authorization/v3"
CLUSTER_POLICY_AUTHORIZATION_CONTRACT = "chenyida-erp-release-supervisor-authorization/v4"
NOTIFIER_EGRESS_AUTHORIZATION_CONTRACT = "chenyida-erp-release-supervisor-authorization/v5"
UAT_PROMOTION_AUTHORIZATION_CONTRACT = "chenyida-erp-release-supervisor-authorization/v6"
RUNTIME_GUARD_CONTRACT = "chenyida-erp-release-runtime-guard/v1"
PRE_DEPLOY_RUNTIME_GUARD_MODE = "PRE_DEPLOY_EXISTING_RUNTIME_STABILITY"
POST_DEPLOY_RUNTIME_GUARD_MODE = "POST_DEPLOY_CURRENT_RUNTIME_STRICT"
PRE_DEPLOY_POSTGRESQL_BOOTSTRAP_GUARD_MODE = "PRE_DEPLOY_POSTGRESQL_BOOTSTRAP_BOUND"
RUNTIME_COMPOSE_PROJECT = "chenyida-erp"
RUNTIME_POLICY_SHA256 = "e4920820ed954c2689e3de53dea9b7f36945969c8287b06d87a3871e7d3ecf00"
RUNTIME_SECRET_POLICY_SHA256 = "8dd07c6acd6e857a0b29b14e2b6d5b60ad919cf54aac9b552ce11672eb45b7c5"
RUNTIME_PROBE_CONTRACT = "chenyida-erp-postdeploy-runtime-configuration-probe/v1"
RUNTIME_PRIVILEGE_STATE_ROOT = Path("/var/lib/chenyida-erp/postgresql-runtime-privilege-operator")
RUNTIME_SECRET_ROOT = Path("/etc/chenyida-erp/runtime-secrets")
RUNTIME_PRIVILEGE_BACKUP_ROOT = Path("/var/backups/chenyida-erp-v2")
RUNTIME_PRIVILEGE_NODE_IMAGE = "node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3"
MONITORING_HOST_CONFIG_INPUT_ROOT = AUTHORIZATION_PENDING_ROOT
MONITORING_HOST_RUNTIME_INPUT_ROOT = Path("/var/lib/chenyida-erp/monitoring-runtime-inputs")
MONITORING_PROJECTION_ROOT = Path("/var/lib/chenyida-erp/monitoring-v1/projections")
MONITORING_ACTIVE_FILE = Path("/var/lib/chenyida-erp/monitoring-v1/active.json")
MONITORING_PRIVATE_CONFIG = Path("/etc/chenyida-erp/monitoring-v1/private/host-config.json")
MONITORING_BACKUP_READINESS_FILE = Path("/var/lib/chenyida-erp/backup-status/recovery-readiness.json")
MONITORING_CLUSTER_POLICY_FILE = Path("/etc/chenyida-erp/recovery/postgresql-cluster-recovery-policy.json")
CLUSTER_POLICY_STATE_ROOT = Path("/var/lib/chenyida-erp/postgresql-cluster-recovery-policy-v2")
CLUSTER_POLICY_CURRENT_FILE = CLUSTER_POLICY_STATE_ROOT / "current.json"
CLUSTER_POLICY_STATE_MARKER = ".chenyida-erp-postgresql-cluster-recovery-policy-v2"
CLUSTER_POLICY_STATE_MARKER_VALUE = b"chenyida-erp-postgresql-cluster-recovery-policy-activation/v1\n"
CLUSTER_POLICY_TARGET_MARKER = ".chenyida-erp-postgresql-cluster-recovery-policy-v2"
CLUSTER_POLICY_TARGET_MARKER_VALUE = b"chenyida-erp-postgresql-cluster-recovery-policy-target/v1\n"
CLUSTER_POLICY_TEMPLATE_FILE_SHA256 = "1a092993b1dda00bd8a2aac0899cb4e1eee83e9b336022bdb72f3e4d23e317aa"
CLUSTER_POLICY_TEMPLATE_POLICY_SHA256 = "c30951ad74a827c06e8256cfc124f61bd5672bca9daa7abda21c0896523378b8"
NOTIFIER_EGRESS_STATE_ROOT = Path("/var/lib/chenyida-erp/monitoring-notifier-egress-v1")
NOTIFIER_EGRESS_CURRENT_FILE = NOTIFIER_EGRESS_STATE_ROOT / "current.json"
NOTIFIER_EGRESS_POLICY_FILE = Path("/etc/chenyida-erp/monitoring-v1/views/notifier-egress-policy.json")
NOTIFIER_EGRESS_ACTIVATION_VIEW = Path("/etc/chenyida-erp/monitoring-v1/views/notifier-egress-activation.json")
NOTIFIER_EGRESS_UNIT = "chenyida-erp-monitor-notifier.service"
NOTIFIER_EGRESS_BASE_UNIT = Path(f"/etc/systemd/system/{NOTIFIER_EGRESS_UNIT}")
NOTIFIER_EGRESS_DROPIN = Path(f"/etc/systemd/system/{NOTIFIER_EGRESS_UNIT}.d/50-chenyida-erp-notifier-egress.conf")
NOTIFIER_EGRESS_TEMPLATE_FILE_SHA256 = "ebb318471ef96a9d91e78c72d81802aa193480befe36017c43b74277eb0c4617"
NOTIFIER_EGRESS_TEMPLATE_POLICY_SHA256 = "abaf585ec2c5c735e18418265a688f01f2b4d1e0b26b2125432cde860f222b20"
NOTIFIER_EGRESS_BASE_UNIT_SHA256 = "22d8b4cfaf48821e5b2d2f28ad285cf549b207c30b13f9b4a50f202a031e3812"
UAT_PROMOTION_STATE_ROOT = Path("/var/lib/chenyida-erp/uat-promotion-transactions-v1")
UAT_PROMOTION_CURRENT_FILE = UAT_PROMOTION_STATE_ROOT / "current.json"
UAT_PROMOTION_ACTIVE_FENCES_ROOT = UAT_PROMOTION_STATE_ROOT / "active-fences"
UAT_PROMOTION_FENCE_TRANSFERS_ROOT = UAT_PROMOTION_STATE_ROOT / "fence-transfers"
UAT_PROMOTION_POLICY_FILE_SHA256 = "e25ffc7b9176b2cc94c0d0bb87ced077671a1cd5481ce7f2c9c8f44ad442b4d0"
UAT_PROMOTION_POLICY_SHA256 = "b82f0181a7d016560f580e769fc10e8e9c2acf3a3224c11f7336ddb99c564a44"
UAT_PROMOTION_RECOVERY_READINESS_FILE = Path("/var/lib/chenyida-erp/backup-status/recovery-readiness.json")
UAT_PROMOTION_CANDIDATE_RECEIPTS_ROOT = Path("/var/lib/chenyida-erp/release-candidate-snapshots/receipts")
UAT_PROMOTION_STATE_MARKER = ".chenyida-erp-uat-promotion-transactions-v1"
UAT_PROMOTION_STATE_MARKER_VALUE = b"chenyida-erp-uat-promotion-transactions/v1\n"
RELEASE_IDENTITY_FILE = RELEASE_IDENTITY_ROOT / "release-identity.json"
MONITORING_PROJECTION_CONTRACT = "chenyida-erp-monitoring-projection-publication/v1"
MONITORING_PROJECTION_MARKER = ".chenyida-erp-monitoring-projection-v1"
MONITORING_PROJECTION_MARKER_VALUE = b"chenyida-erp-monitoring-projection/v1\n"
RELEASE_IDENTITY_MARKER = ".chenyida-erp-release-identity-root-v1"
RELEASE_IDENTITY_MARKER_VALUE = b"chenyida-erp-release-identity-root/v1\n"
RELEASE_ARTIFACT_MARKER = ".chenyida-erp-release-artifact-root-v1"
RELEASE_ARTIFACT_MARKER_VALUE = b"chenyida-erp-release-artifact-root/v1\n"
BACKUP_STATUS_MARKER = ".chenyida-erp-receipt-root-v2"
BACKUP_STATUS_MARKER_VALUE = b"chenyida-erp-receipt-root/v2\n"
GLOBAL_RELEASE_LOCK = Path("/run/lock/chenyida-erp-release-gate-v1.lock")
SAFE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
MAX_JSON_BYTES = 1024 * 1024
MAX_BUNDLE_FILE_BYTES = 8 * 1024 * 1024
MAX_BUNDLE_BYTES = 32 * 1024 * 1024
MAX_MONITOR_RUNTIME_BYTES = 256 * 1024 * 1024
SHA256 = re.compile(r"^[0-9a-f]{64}$")
GIT_OBJECT = re.compile(r"^[0-9a-f]{40}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
IMAGE_REFERENCE = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[0-9a-f]{64}$")
ISO_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")

BUNDLE_FILES: dict[str, str] = {
    "chenyida_erp_site/deployment/systemd/chenyida-erp-monitor-collector.service": "0444",
    "chenyida_erp_site/deployment/systemd/chenyida-erp-monitor-collector.timer": "0444",
    "chenyida_erp_site/deployment/systemd/chenyida-erp-monitor-continuity.service": "0444",
    "chenyida_erp_site/deployment/systemd/chenyida-erp-monitor-continuity.timer": "0444",
    "chenyida_erp_site/deployment/systemd/chenyida-erp-monitor-evaluator.service": "0444",
    "chenyida_erp_site/deployment/systemd/chenyida-erp-monitor-notifier.service": "0444",
    "chenyida_erp_site/deployment/systemd/chenyida-erp-monitor-notifier.timer": "0444",
    "chenyida_erp_site/operations/container-runtime-policy-v1.json": "0444",
    "chenyida_erp_site/operations/monitoring-host-config-schema-v1.json": "0444",
    "chenyida_erp_site/operations/monitoring-host-delivery-policy-v1.json": "0444",
    "chenyida_erp_site/operations/monitoring-notifier-egress-policy-v1.json": "0444",
    "chenyida_erp_site/operations/monitoring-policy-v1.json": "0444",
    "chenyida_erp_site/operations/postgresql-cluster-recovery-policy-v1.json": "0444",
    "chenyida_erp_site/operations/postgresql-cluster-recovery-policy-v2.json": "0444",
    "chenyida_erp_site/operations/postgresql-runtime-privilege-access-v2.json": "0444",
    "chenyida_erp_site/operations/postgresql-runtime-privilege-compiled-catalog-v1.json": "0444",
    "chenyida_erp_site/operations/postgresql-runtime-privilege-operator-policy-v1.json": "0444",
    "chenyida_erp_site/operations/postgresql-runtime-privilege-policy-v2.json": "0444",
    "chenyida_erp_site/operations/runtime-secret-file-policy-v1.json": "0444",
    "chenyida_erp_site/operations/uat-promotion-transaction-policy-v1.json": "0444",
    "chenyida_erp_site/release/release-gate-plan-v2.json": "0444",
    "chenyida_erp_site/release/monitoring-host-delivery-bundle-v1.json": "0444",
    "chenyida_erp_site/release/release-test-inventory-v1.json": "0444",
    "chenyida_erp_site/release/test-runtime-policy-v1.json": "0444",
    "chenyida_erp_site/release/vulnerability-policy-v1.json": "0444",
    "chenyida_erp_site/scripts/backup-operations-policy.mjs": "0444",
    "chenyida_erp_site/scripts/backup-recovery-contract.mjs": "0444",
    "chenyida_erp_site/scripts/backup-recovery-readiness-v3.mjs": "0444",
    "chenyida_erp_site/scripts/backup-recovery-readiness-v4.mjs": "0444",
    "chenyida_erp_site/scripts/check-credentials.mjs": "0444",
    "chenyida_erp_site/scripts/container-runtime-policy-test.py": "0444",
    "chenyida_erp_site/scripts/container-runtime-policy.py": "0444",
    "chenyida_erp_site/scripts/create-monitoring-host-bundle-manifest.py": "0555",
    "chenyida_erp_site/scripts/create-release-image-evidence.sh": "0555",
    "chenyida_erp_site/scripts/create-release-manifest.sh": "0555",
    "chenyida_erp_site/scripts/create-release-supervisor-bundle-manifest.py": "0555",
    "chenyida_erp_site/scripts/install-release-supervisor.py": "0444",
    "chenyida_erp_site/scripts/install-monitoring-host-delivery.py": "0444",
    "chenyida_erp_site/scripts/monitoring-host-launcher.py": "0444",
    "chenyida_erp_site/scripts/monitoring-notifier-egress-publisher.mjs": "0444",
    "chenyida_erp_site/scripts/offhost-transfer-contract.mjs": "0444",
    "chenyida_erp_site/scripts/postdeploy-release-contract.mjs": "0444",
    "chenyida_erp_site/scripts/postdeploy-release-verifier.mjs": "0444",
    "chenyida_erp_site/scripts/postdeploy-runtime-configuration-probe.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-cluster-recovery-contract.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-cluster-recovery-policy-v2-contract.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-cluster-recovery-policy-v2-activation-contract.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-cluster-recovery-policy-v2-publisher.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-cluster-recovery-policy-v2.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-cluster-transfer-contract.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-runtime-privilege-catalog.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-runtime-privilege-catalog.sql": "0444",
    "chenyida_erp_site/scripts/postgresql-runtime-privilege-interlock.sh": "0444",
    "chenyida_erp_site/scripts/postgresql-runtime-privilege-journal.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-runtime-privilege-operator.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-runtime-privilege-policy.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-runtime-privilege-reconciler.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-runtime-privilege-runner.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-runtime-privilege-source.mjs": "0444",
    "chenyida_erp_site/scripts/postgresql-runtime-privilege-state.sql": "0444",
    "chenyida_erp_site/scripts/probe-postdeploy-runtime-configuration.sh": "0555",
    "chenyida_erp_site/scripts/publish-release-identity-from-manifest.mjs": "0444",
    "chenyida_erp_site/scripts/release-candidate-snapshot.py": "0555",
    "chenyida_erp_site/scripts/release-browser-e2e-runner.mjs": "0444",
    "chenyida_erp_site/scripts/release-gate-runner.mjs": "0444",
    "chenyida_erp_site/scripts/release-gate-lock.sh": "0444",
    "chenyida_erp_site/scripts/release-identity-contract.mjs": "0444",
    "chenyida_erp_site/scripts/release-image-evidence-contract.mjs": "0444",
    "chenyida_erp_site/scripts/release-image-evidence-producer.mjs": "0444",
    "chenyida_erp_site/scripts/release-lifecycle-contract.mjs": "0444",
    "chenyida_erp_site/scripts/release-manifest-contract.mjs": "0444",
    "chenyida_erp_site/scripts/release-migration-authorization.ts": "0444",
    "chenyida_erp_site/scripts/release-postgres-regression-runner.mjs": "0444",
    "chenyida_erp_site/scripts/release-supervisor-launcher.py": "0444",
    "chenyida_erp_site/scripts/release-test-inventory.mjs": "0444",
    "chenyida_erp_site/scripts/runtime-secret-file-policy.py": "0444",
    "chenyida_erp_site/scripts/run-backup-recovery-postgres-test.sh": "0555",
    "chenyida_erp_site/scripts/run-compose-config-test.sh": "0555",
    "chenyida_erp_site/scripts/run-container-runtime-policy-test.sh": "0555",
    "chenyida_erp_site/scripts/run-python-baseline-test.sh": "0555",
    "chenyida_erp_site/scripts/run-release-browser-tests.sh": "0555",
    "chenyida_erp_site/scripts/run-release-gate.sh": "0555",
    "chenyida_erp_site/scripts/run-release-migration-postgres-test.sh": "0555",
    "chenyida_erp_site/scripts/run-release-node-sandbox.sh": "0555",
    "chenyida_erp_site/scripts/run-release-postgres-regression-tests.sh": "0555",
    "chenyida_erp_site/scripts/run-source-diff-check.sh": "0555",
    "chenyida_erp_site/scripts/write-release-identity.sh": "0555",
    "chenyida_erp_site/scripts/uat-promotion-transaction-journal.mjs": "0444",
    "chenyida_erp_site/scripts/uat-promotion-migration-execution-contract.mjs": "0444",
    "chenyida_erp_site/scripts/uat-promotion-migration-control.py": "0555",
    "chenyida_erp_site/scripts/uat-promotion-compose-deployment-contract.mjs": "0444",
    "chenyida_erp_site/scripts/uat-promotion-compose-deployment-control.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/backup-projection.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/collector.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/components-projection.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/contract.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/delivery-contract.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/delivery-store.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/host-runner.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/host-store.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/notifier.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/notifier-egress-contract.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/projection-publisher.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/resource-policy.mjs": "0444",
    "chenyida_erp_site/tools/ops-monitoring/strict-json.mjs": "0444",
    "chenyida_erp_site/tests/release-gate-fixture.mjs": "0444",
    "chenyida_erp_site/tests/runtime-privilege-operator-postgres-fixture.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-release-gate-contract.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-release-identity-contract.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-release-image-evidence-producer.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-release-manifest-contract.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-release-migration-allowlist.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-postdeploy-runtime-configuration-probe.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-uat-promotion-transaction-journal.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-backup-recovery-postgres.sh": "0555",
    "chenyida_erp_site/tests/selfhost-postgresql-cluster-recovery-postgres.sh": "0555",
    "chenyida_erp_site/tests/selfhost-postgresql-cluster-recovery-policy-v2-activation.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-postgresql-runtime-privilege-catalog-postgres.sh": "0555",
    "chenyida_erp_site/tests/selfhost-postgresql-runtime-privilege-operator.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-postgresql-runtime-privilege-policy.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-ops-monitoring-host-delivery.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-ops-monitoring-notifier-egress.test.mjs": "0444",
    "chenyida_erp_site/tests/selfhost-ops-monitoring-projection-publisher.test.mjs": "0444",
    "chenyida_erp_site/tests/test_release_supervisor_browser.py": "0444",
    "chenyida_erp_site/tests/test_release_supervisor_candidate_snapshot.py": "0444",
    "chenyida_erp_site/tests/test_release_supervisor_container_runtime.py": "0444",
    "chenyida_erp_site/tests/test_release_supervisor_installer.py": "0444",
    "chenyida_erp_site/tests/test_release_supervisor_launcher.py": "0444",
    "chenyida_erp_site/tests/test_release_supervisor_monitoring_host_delivery.py": "0444",
    "chenyida_erp_site/tests/test_release_supervisor_monitoring_notifier_egress.py": "0444",
    "chenyida_erp_site/tests/test_release_supervisor_monitoring_projection.py": "0444",
    "chenyida_erp_site/tests/test_release_supervisor_cluster_policy_activation.py": "0444",
    "chenyida_erp_site/tests/test_release_supervisor_runtime_secret_file.py": "0444",
    "chenyida_erp_site/tests/test_release_supervisor_uat_promotion.py": "0444",
}

ENTRYPOINTS = {
    "CREATE_IMAGE_EVIDENCE": "chenyida_erp_site/scripts/create-release-image-evidence.sh",
    "RUN_RELEASE_GATE": "chenyida_erp_site/scripts/run-release-gate.sh",
    "CREATE_RELEASE_MANIFEST": "chenyida_erp_site/scripts/create-release-manifest.sh",
    "PROBE_POST_DEPLOY_RUNTIME_CONFIGURATION": "chenyida_erp_site/scripts/probe-postdeploy-runtime-configuration.sh",
    "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY": "chenyida_erp_site/scripts/write-release-identity.sh",
    "INSTALL_MONITORING_HOST_DELIVERY": "chenyida_erp_site/scripts/install-monitoring-host-delivery.py",
    "ROLLBACK_MONITORING_HOST_DELIVERY": "chenyida_erp_site/scripts/install-monitoring-host-delivery.py",
    "DISABLE_MONITORING_HOST_DELIVERY": "chenyida_erp_site/scripts/install-monitoring-host-delivery.py",
    "PUBLISH_MONITORING_COMPONENTS_PROJECTION": "chenyida_erp_site/tools/ops-monitoring/projection-publisher.mjs",
    "PUBLISH_MONITORING_BACKUP_PROJECTION": "chenyida_erp_site/tools/ops-monitoring/projection-publisher.mjs",
}

CONFIRMATIONS = {
    "CREATE_IMAGE_EVIDENCE": "AUTHORIZE_CREATE_TRIVY_IMAGE_EVIDENCE",
    "RUN_RELEASE_GATE": "AUTHORIZE_RUN_EXACT_RELEASE_GATE",
    "CREATE_RELEASE_MANIFEST": "AUTHORIZE_CREATE_IMMUTABLE_RELEASE_MANIFEST",
    "PROBE_POST_DEPLOY_RUNTIME_CONFIGURATION": "AUTHORIZE_PROBE_EXACT_POST_DEPLOY_RUNTIME_CONFIGURATION",
    "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY": "AUTHORIZE_VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY",
    "INSTALL_MONITORING_HOST_DELIVERY": "AUTHORIZE_INSTALL_EXACT_MONITORING_HOST_DELIVERY",
    "ROLLBACK_MONITORING_HOST_DELIVERY": "AUTHORIZE_ROLLBACK_EXACT_MONITORING_HOST_DELIVERY",
    "DISABLE_MONITORING_HOST_DELIVERY": "AUTHORIZE_DISABLE_EXACT_MONITORING_HOST_DELIVERY",
    "PUBLISH_MONITORING_COMPONENTS_PROJECTION": "AUTHORIZE_PUBLISH_EXACT_MONITORING_COMPONENTS_PROJECTION",
    "PUBLISH_MONITORING_BACKUP_PROJECTION": "AUTHORIZE_PUBLISH_EXACT_MONITORING_BACKUP_PROJECTION",
}

RUNTIME_PRIVILEGE_OPERATIONS = {
    "BOOTSTRAP_POSTGRESQL_RUNTIME_PRIVILEGES": "BOOTSTRAP",
    "RECONCILE_POSTGRESQL_RUNTIME_PRIVILEGES": "RECONCILE",
    "RECOVER_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT": "RECOVER",
}

RUNTIME_PRIVILEGE_CONFIRMATIONS = {
    "BOOTSTRAP_POSTGRESQL_RUNTIME_PRIVILEGES": "AUTHORIZE_BOOTSTRAP_EXACT_POSTGRESQL_RUNTIME_PRIVILEGES",
    "RECONCILE_POSTGRESQL_RUNTIME_PRIVILEGES": "AUTHORIZE_RECONCILE_EXACT_POSTGRESQL_RUNTIME_PRIVILEGES",
    "RECOVER_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT": "AUTHORIZE_RECOVER_EXACT_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT",
}

CLUSTER_POLICY_OPERATIONS = {
    "ACTIVATE_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2": "ACTIVATE",
    "ROLLBACK_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2": "ROLLBACK",
    "RECOVER_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2_ACTIVATION": "RECOVER",
}

CLUSTER_POLICY_CONFIRMATIONS = {
    "ACTIVATE_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2": "AUTHORIZE_ACTIVATE_EXACT_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2",
    "ROLLBACK_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2": "AUTHORIZE_ROLLBACK_EXACT_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2",
    "RECOVER_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2_ACTIVATION": "AUTHORIZE_RECOVER_EXACT_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2_ACTIVATION",
}

CLUSTER_POLICY_BASE_PARAMETER_FIELDS = {
    "policy_state_root", "policy_target", "activation_id", "environment", "policy_generation",
    "previous_policy_sha256", "previous_activation_receipt_sha256", "template_file_sha256", "template_policy_sha256",
    "approval_reference_sha256", "responsible_operator_identity_sha256", "approver_identity_sha256",
    "rpo_hours", "rto_minutes", "target_disposition", "activated_at", "policy_expires_at",
    "release_identity_source", "current_policy_source", "current_activation_source", "rollback_target_source",
}

CLUSTER_POLICY_RECOVERY_PARAMETER_FIELDS = {
    "expected_intent_sha256", "original_authorization_sha256", "original_operation", "original_operation_id",
}

NOTIFIER_EGRESS_OPERATIONS = {
    "ACTIVATE_MONITORING_NOTIFIER_EGRESS_V1": "ACTIVATE",
    "ROLLBACK_MONITORING_NOTIFIER_EGRESS_V1": "ROLLBACK",
    "RECOVER_MONITORING_NOTIFIER_EGRESS_V1_ACTIVATION": "RECOVER",
}

NOTIFIER_EGRESS_CONFIRMATIONS = {
    "ACTIVATE_MONITORING_NOTIFIER_EGRESS_V1": "AUTHORIZE_ACTIVATE_EXACT_MONITORING_NOTIFIER_EGRESS_V1",
    "ROLLBACK_MONITORING_NOTIFIER_EGRESS_V1": "AUTHORIZE_ROLLBACK_EXACT_MONITORING_NOTIFIER_EGRESS_V1",
    "RECOVER_MONITORING_NOTIFIER_EGRESS_V1_ACTIVATION": "AUTHORIZE_RECOVER_EXACT_MONITORING_NOTIFIER_EGRESS_V1_ACTIVATION",
}

NOTIFIER_EGRESS_BASE_PARAMETER_FIELDS = {
    "policy_state_root", "policy_target", "activation_view", "dropin_target", "activation_id", "environment",
    "egress_generation", "previous_policy_sha256", "previous_activation_receipt_sha256",
    "rollback_target_activation_receipt_sha256", "deployment_id", "target_id", "target_generation", "endpoint",
    "allowed_addresses", "monitoring_bundle_sha256", "adapter_id", "adapter_sha256", "credential_sha256",
    "credential_generation", "oncall_roster_generation", "escalation_table_sha256", "notifier_gid",
    "template_file_sha256", "template_policy_sha256", "approval_reference_sha256",
    "responsible_operator_identity_sha256", "approver_identity_sha256", "activated_at", "expires_at",
    "notifier_config_source", "base_unit_source", "current_policy_source", "current_activation_source",
    "rollback_policy_source", "rollback_activation_source",
}

NOTIFIER_EGRESS_RECOVERY_PARAMETER_FIELDS = {
    "expected_intent_sha256", "original_authorization_sha256", "original_operation", "original_operation_id",
}

UAT_PROMOTION_OPERATIONS = {
    "BEGIN_UAT_PROMOTION": "BEGIN",
    "CAPTURE_UAT_PROMOTION_SNAPSHOT": "CAPTURE_SNAPSHOT",
    "QUIESCE_UAT_WRITERS": "QUIESCE_WRITERS",
    "AUTHORIZE_UAT_PROMOTION_MIGRATION": "MIGRATION_AUTHORIZATION",
    "RUN_UAT_PROMOTION_MIGRATION": "MIGRATION_EXECUTION",
    "DEPLOY_UAT_RELEASE": "COMPOSE_DEPLOYMENT",
    "VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION": "POSTDEPLOY_RUNTIME_CONFIGURATION",
    "VERIFY_UAT_POSTDEPLOY_IDENTITY": "POSTDEPLOY_IDENTITY",
    "RECOVER_UAT_PROMOTION": "RECOVER",
}

UAT_PROMOTION_CONFIRMATIONS = {
    "BEGIN_UAT_PROMOTION": "AUTHORIZE_BEGIN_EXACT_UAT_PROMOTION",
    "CAPTURE_UAT_PROMOTION_SNAPSHOT": "AUTHORIZE_CAPTURE_EXACT_UAT_PROMOTION_SNAPSHOT",
    "QUIESCE_UAT_WRITERS": "AUTHORIZE_CONTINUED_QUIESCE_OF_EXACT_UAT_WRITERS",
    "AUTHORIZE_UAT_PROMOTION_MIGRATION": "AUTHORIZE_EXACT_UAT_PROMOTION_MIGRATION_APPROVAL_ONLY_NO_SQL",
    "RUN_UAT_PROMOTION_MIGRATION": "AUTHORIZE_RUN_EXACT_UAT_PROMOTION_MIGRATION",
    "DEPLOY_UAT_RELEASE": "AUTHORIZE_DEPLOY_EXACT_UAT_RELEASE_WEB_WORKER_ONLY",
    "VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION": "AUTHORIZE_VERIFY_EXACT_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION",
    "VERIFY_UAT_POSTDEPLOY_IDENTITY": "AUTHORIZE_VERIFY_EXACT_UAT_POSTDEPLOY_IDENTITY",
    "RECOVER_UAT_PROMOTION": "AUTHORIZE_RECOVER_EXACT_UAT_PROMOTION",
}

UAT_PROMOTION_POSTDEPLOY_FAILURE_CODES = {
    "POST_AUTHORIZATION_SOURCE_RECHECK": "UAT_PROMOTION_POSTDEPLOY_POST_AUTHORIZATION_SOURCE_RECHECK_FAILED",
    "EXTERNAL_CONTROL": "UAT_PROMOTION_POSTDEPLOY_EXTERNAL_CONTROL_FAILED",
    "JOURNAL_EXECUTION": "UAT_PROMOTION_POSTDEPLOY_JOURNAL_EXECUTION_FAILED",
    "RESULT_CROSSCHECK": "UAT_PROMOTION_POSTDEPLOY_RESULT_CROSSCHECK_FAILED",
}

UAT_PROMOTION_BASE_PARAMETER_FIELDS = {
    "promotion_state_root", "promotion_id", "promotion_generation", "previous_promotion_receipt_sha256",
    "repository_root", "git_commit", "git_tree", "candidate_snapshot_receipt", "candidate_snapshot_receipt_sha256",
    "candidate_snapshot_source", "test_runtime_root", "application_version", "release_manifest",
    "release_manifest_sha256", "release_manifest_source", "web_image", "worker_image", "migration_head",
    "migration_manifest_sha256", "current_runtime_identity_source", "recovery_readiness_source",
    "preupgrade_recovery_readiness_sha256", "preupgrade_recovery_snapshot_sha256", "database_name", "database_oid",
    "database_system_identifier", "database_marker", "promotion_created_at", "promotion_expires_at",
    "requester_identity_sha256", "approver_identity_sha256", "executor_identity_sha256", "policy_file_sha256",
    "policy_sha256", "current_promotion_source",
}

UAT_PROMOTION_RECOVERY_PARAMETER_FIELDS = {
    "expected_intent_sha256", "original_authorization_sha256", "original_operation", "original_operation_id",
}

UAT_PROMOTION_SNAPSHOT_PARAMETER_FIELDS = {
    "promotion_state_root", "promotion_id", "promotion_generation", "previous_checkpoint_receipt_sha256",
    "promotion_intent_sha256", "promotion_original_authorization_sha256", "candidate_binding_sha256",
    "database_binding_sha256", "runtime_binding_sha256", "preupgrade_recovery_binding_sha256",
    "current_checkpoint_source", "runtime_identity_source", "snapshot_readiness", "snapshot_readiness_file_sha256",
    "snapshot_readiness_sha256", "snapshot_readiness_source", "snapshot_policy", "snapshot_policy_file_sha256",
    "snapshot_policy_sha256", "snapshot_policy_source", "snapshot_policy_activation",
    "snapshot_policy_activation_file_sha256", "snapshot_policy_activation_receipt_sha256",
    "snapshot_policy_activation_source", "snapshot_backup_id", "snapshot_restore_run_id", "snapshot_objects",
    "snapshot_created_at", "snapshot_expires_at", "requester_identity_sha256", "approver_identity_sha256",
    "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
}

UAT_PROMOTION_QUIESCE_PARAMETER_FIELDS = {
    "promotion_state_root", "promotion_id", "promotion_generation", "previous_checkpoint_receipt_sha256",
    "promotion_intent_sha256", "promotion_original_authorization_sha256", "snapshot_operation_id",
    "snapshot_intent_sha256", "snapshot_intent_source", "candidate_binding_sha256", "database_binding_sha256",
    "runtime_binding_sha256", "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256",
    "current_checkpoint_source", "runtime_identity_source", "deployment_class", "deployment_id", "compose_project",
    "compose_project_root", "web_container", "web_container_id", "worker_container", "worker_container_id",
    "quiesce_created_at", "quiesce_expires_at", "requester_identity_sha256", "approver_identity_sha256",
    "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
}

UAT_PROMOTION_MIGRATION_AUTHORIZATION_PARAMETER_FIELDS = {
    "promotion_state_root", "promotion_id", "promotion_generation", "previous_checkpoint_receipt_sha256",
    "promotion_intent_sha256", "promotion_original_authorization_sha256", "quiesce_operation_id",
    "quiesce_intent_sha256", "quiesce_intent_source", "candidate_binding_sha256", "database_binding_sha256",
    "runtime_binding_sha256", "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256",
    "writer_quiesce_binding_sha256", "current_checkpoint_source", "runtime_identity_source", "release_manifest",
    "release_manifest_sha256", "release_manifest_source", "deployment_class", "deployment_id", "database_name",
    "database_oid", "database_system_identifier", "database_marker", "expected_current_migration_head",
    "target_migration_head", "migration_manifest_sha256", "migration_role", "authorization_created_at",
    "authorization_expires_at", "requester_identity_sha256", "approver_identity_sha256",
    "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
}

UAT_PROMOTION_MIGRATION_EXECUTION_PARAMETER_FIELDS = {
    "promotion_state_root", "promotion_id", "promotion_generation", "previous_checkpoint_receipt_sha256",
    "promotion_intent_sha256", "promotion_original_authorization_sha256",
    "migration_authorization_operation_id", "migration_authorization_intent_sha256",
    "migration_authorization_intent_source", "migration_approval_authorization_sha256",
    "candidate_binding_sha256", "database_binding_sha256", "runtime_binding_sha256",
    "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256",
    "writer_quiesce_binding_sha256", "migration_authorization_binding_sha256",
    "current_checkpoint_source", "runtime_identity_source", "release_manifest", "release_manifest_sha256",
    "release_manifest_source", "deployment_class", "deployment_id", "database_name", "database_oid",
    "database_system_identifier", "database_marker", "expected_current_migration_head", "target_migration_head",
    "migration_manifest_sha256", "migration_role", "control_role", "worker_image", "postgres_container",
    "postgres_container_id", "postgres_image_digest", "backend_network", "execution_created_at",
    "execution_expires_at", "requester_identity_sha256", "approver_identity_sha256",
    "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
}

UAT_PROMOTION_COMPOSE_DEPLOYMENT_PARAMETER_FIELDS = {
    "promotion_state_root", "promotion_id", "promotion_generation", "previous_checkpoint_receipt_sha256",
    "promotion_intent_sha256", "promotion_original_authorization_sha256", "migration_operation_id",
    "migration_execution_intent_sha256", "migration_execution_intent_source",
    "migration_execution_authorization_sha256", "migration_grant_sha256", "migration_result_sha256",
    "migration_result_source", "active_migration_fence_sha256", "active_migration_fence_source",
    "candidate_binding_sha256", "database_binding_sha256", "runtime_binding_sha256",
    "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256",
    "writer_quiesce_binding_sha256", "migration_authorization_binding_sha256",
    "migration_fence_binding_sha256", "migration_result_binding_sha256", "current_checkpoint_source",
    "runtime_identity_source", "release_manifest", "release_manifest_sha256", "release_manifest_source",
    "deployment_class", "deployment_id", "compose_project", "compose_project_root",
    "compose_file_source", "compose_release_file_source", "deployment_environment",
    "deployment_environment_sha256", "deployment_environment_source", "web_image", "worker_image",
    "web_container", "old_web_container_id", "old_web_image_digest", "worker_container",
    "old_worker_container_id", "old_worker_image_digest", "postgres_container", "postgres_container_id",
    "postgres_image_digest", "caddy_container", "caddy_container_id", "caddy_image_digest",
    "backend_network", "edge_network", "reader_gid", "database_name", "database_oid",
    "database_system_identifier", "database_marker", "control_role", "deployment_created_at",
    "deployment_expires_at", "requester_identity_sha256", "approver_identity_sha256",
    "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
}

UAT_PROMOTION_POSTDEPLOY_COMMON_PARAMETER_FIELDS = {
    "promotion_state_root", "promotion_id", "promotion_generation", "previous_checkpoint_receipt_sha256",
    "promotion_intent_sha256", "promotion_original_authorization_sha256", "candidate_binding_sha256",
    "database_binding_sha256", "runtime_binding_sha256", "preupgrade_recovery_binding_sha256",
    "promotion_snapshot_binding_sha256", "writer_quiesce_binding_sha256",
    "migration_authorization_binding_sha256", "migration_fence_binding_sha256",
    "migration_result_binding_sha256", "compose_deployment_binding_sha256", "current_checkpoint_source",
    "deployment_operation_id", "deployment_result_sha256", "deployment_result_source",
    "fence_transfer_sha256", "fence_transfer_source", "release_manifest", "release_manifest_sha256",
    "release_manifest_source", "deployment_class", "deployment_id", "compose_project",
    "compose_project_root", "runtime_guard_contract", "runtime_guard_mode", "runtime_policy_sha256",
    "reader_gid", "caddy_container", "postgres_container", "web_container", "worker_container",
    "verification_created_at", "verification_expires_at", "requester_identity_sha256",
    "approver_identity_sha256", "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
}

UAT_PROMOTION_POSTDEPLOY_RUNTIME_PARAMETER_FIELDS = UAT_PROMOTION_POSTDEPLOY_COMMON_PARAMETER_FIELDS | {
    "probe_root", "probe_id",
}

UAT_PROMOTION_POSTDEPLOY_IDENTITY_PARAMETER_FIELDS = UAT_PROMOTION_POSTDEPLOY_COMMON_PARAMETER_FIELDS | {
    "runtime_probe_operation_id", "runtime_probe_intent_sha256", "runtime_probe_intent_source",
    "runtime_probe_result_sha256", "runtime_probe_result_source", "runtime_probe_receipt",
    "runtime_probe_receipt_sha256", "runtime_probe_receipt_source", "runtime_configuration_sha256",
    "postdeploy_root", "identity_root", "run_id",
}

RUNTIME_PRIVILEGE_BASE_PARAMETER_FIELDS = {
    "backup_root", "backup_credential_root", "backup_capture_service_file", "backup_capture_service",
    "compose_project_root", "credential_generation_id", "deployment_class", "deployment_id",
    "expected_database", "expected_database_marker", "expected_database_oid", "expected_system_identifier",
    "postgres_container", "postgres_container_id", "release_manifest", "release_manifest_sha256", "runtime_configuration_sha256",
    "runtime_guard_mode", "runtime_policy_sha256",
}

RUNTIME_PRIVILEGE_POSTDEPLOY_PARAMETER_FIELDS = RUNTIME_PRIVILEGE_BASE_PARAMETER_FIELDS | {
    "runtime_probe_receipt", "runtime_probe_receipt_sha256",
}

RUNTIME_PRIVILEGE_RECOVERY_PARAMETER_FIELDS = {
    "expected_intent_sha256", "original_authorization_sha256", "original_operation", "original_operation_id",
}

SNAPSHOT_PARAMETER_FIELDS = {
    "candidate_snapshot_receipt", "candidate_snapshot_receipt_sha256", "test_runtime_root",
}

MONITORING_PROJECTION_COMMON_PARAMETER_FIELDS = {
    "projection_root", "projection_reader_gid", "projection_generation", "previous_projection_sha256",
    "projection_published_at", "expected_source_sha256", "expected_projection_sha256",
    "active_source", "host_config_source", "release_identity_source", "postdeploy_receipt_source",
}

MONITORING_PROJECTION_SOURCE_FIELDS = {
    "path", "sha256", "bytes", "device", "inode", "uid", "gid", "mode", "nlink",
}

PARAMETER_FIELDS = {
    "CREATE_IMAGE_EVIDENCE": {
        "repository_root", "git_commit", "git_tree", "artifact_root", "run_id",
        "web_image", "worker_image", "trivy_db_directory",
    } | SNAPSHOT_PARAMETER_FIELDS,
    "RUN_RELEASE_GATE": {
        "repository_root", "git_commit", "git_tree", "artifact_root", "run_id",
        "runtime_guard_contract", "runtime_guard_mode", "gate_plan_sha256",
        "web_image", "worker_image", "sbom_evidence", "security_evidence",
    } | SNAPSHOT_PARAMETER_FIELDS,
    "CREATE_RELEASE_MANIFEST": {
        "repository_root", "git_commit", "git_tree", "artifact_root", "release_id",
        "deployment_class", "web_image", "worker_image", "gate_plan", "gate_report",
        "sbom_evidence", "security_evidence", "expires_at", "runtime_guard_contract",
        "runtime_guard_mode", "gate_plan_sha256",
    } | SNAPSHOT_PARAMETER_FIELDS,
    "PROBE_POST_DEPLOY_RUNTIME_CONFIGURATION": {
        "release_manifest", "release_manifest_sha256", "probe_root", "probe_id", "reader_gid",
        "runtime_guard_contract", "runtime_guard_mode", "runtime_policy_sha256", "deployment_class", "deployment_id", "compose_project",
        "compose_project_root", "caddy_container", "postgres_container", "web_container", "worker_container",
    },
    "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY": {
        "release_manifest", "release_manifest_sha256", "postdeploy_root", "identity_root", "reader_gid", "run_id",
        "runtime_guard_contract", "runtime_guard_mode", "runtime_policy_sha256", "deployment_class", "deployment_id", "compose_project",
        "runtime_configuration_sha256", "runtime_probe_receipt", "runtime_probe_receipt_sha256", "compose_project_root",
        "caddy_container", "postgres_container", "web_container", "worker_container",
    },
    "INSTALL_MONITORING_HOST_DELIVERY": {
        "monitoring_bundle_sha256", "host_config", "host_config_sha256", "runtime_path", "runtime_sha256",
        "runtime_bytes", "runtime_dev", "runtime_ino", "evaluator_uid", "evaluator_gid", "notifier_uid", "notifier_gid",
        "activation_id", "installation_generation", "previous_activation_sha256", "supervisor_bundle_sha256",
    },
    "ROLLBACK_MONITORING_HOST_DELIVERY": {
        "monitoring_bundle_sha256", "host_config", "host_config_sha256", "runtime_path", "runtime_sha256",
        "runtime_bytes", "runtime_dev", "runtime_ino", "evaluator_uid", "evaluator_gid", "notifier_uid", "notifier_gid",
        "activation_id", "installation_generation", "previous_activation_sha256", "supervisor_bundle_sha256", "rollback_target_activation_sha256",
    },
    "DISABLE_MONITORING_HOST_DELIVERY": {
        "expected_active_sha256", "disable_id",
    },
    "PUBLISH_MONITORING_COMPONENTS_PROJECTION": MONITORING_PROJECTION_COMMON_PARAMETER_FIELDS,
    "PUBLISH_MONITORING_BACKUP_PROJECTION": MONITORING_PROJECTION_COMMON_PARAMETER_FIELDS | {
        "backup_readiness_source", "cluster_policy_source", "cluster_policy_activation_source",
        "cluster_policy_history_source", "cluster_policy_receipt_source",
    },
}


class SupervisorError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def reject(code: str) -> None:
    raise SupervisorError(code)


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def strict_json(raw: bytes, code: str) -> Any:
    if len(raw) < 2 or len(raw) > MAX_JSON_BYTES:
        reject(code)

    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        value: dict[str, Any] = {}
        for key, item in items:
            if key in value:
                reject(code)
            value[key] = item
        return value

    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_constant=lambda _: reject(code))
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError):
        reject(code)


def exact_fields(value: Any, expected: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        reject(code)
    return value


def trusted_regular_file(path: Path, mode: int, maximum: int = MAX_JSON_BYTES, code: str = "SUPERVISOR_FILE_INVALID") -> tuple[bytes, os.stat_result]:
    if not path.is_absolute() or path == Path("/"):
        reject(code)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError:
        reject(code)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_gid != 0 or before.st_nlink != 1 or stat.S_IMODE(before.st_mode) != mode or before.st_size < 1 or before.st_size > maximum:
            reject(code)
        chunks: list[bytes] = []
        remaining = before.st_size
        while remaining:
            chunk = os.read(descriptor, min(1024 * 1024, remaining))
            if not chunk:
                reject(code)
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
        after = os.fstat(descriptor)
        path_stat = os.lstat(path)
        identity_before = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
        identity_after = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
        if identity_before != identity_after or path_stat.st_dev != before.st_dev or path_stat.st_ino != before.st_ino or path_stat.st_nlink != 1 or stat.S_ISLNK(path_stat.st_mode):
            reject(code)
        return raw, before
    finally:
        os.close(descriptor)


def trusted_owned_directory(path: Path, uid: int, gid: int, modes: set[int], code: str) -> os.stat_result:
    try:
        metadata = os.lstat(path)
        resolved = Path(os.path.realpath(path))
    except OSError:
        reject(code)
    if not path.is_absolute() or path == Path("/") or resolved != path or not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) \
        or metadata.st_uid != uid or metadata.st_gid != gid or stat.S_IMODE(metadata.st_mode) not in modes:
        reject(code)
    return metadata


def trusted_owned_marker(path: Path, raw_expected: bytes, uid: int, gid: int, modes: set[int], code: str) -> None:
    descriptor: int | None = None
    try:
        before = os.lstat(path)
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or stat.S_ISLNK(before.st_mode) or before.st_nlink != 1 \
            or before.st_uid != uid or before.st_gid != gid or stat.S_IMODE(before.st_mode) not in modes \
            or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) \
            != (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns):
            reject(code)
        value = b""
        while len(value) < opened.st_size:
            chunk = os.read(descriptor, opened.st_size - len(value))
            if not chunk:
                reject(code)
            value += chunk
        after = os.fstat(descriptor)
        named = os.lstat(path)
        if value != raw_expected or (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) \
            != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) \
            or (named.st_dev, named.st_ino, named.st_size, named.st_mtime_ns, named.st_ctime_ns) \
            != (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) \
            or named.st_nlink != 1 or named.st_uid != uid or named.st_gid != gid or stat.S_IMODE(named.st_mode) not in modes:
            reject(code)
    except OSError:
        reject(code)
    finally:
        if descriptor is not None:
            os.close(descriptor)


def projection_source_metadata_matches(metadata: os.stat_result, spec: dict[str, Any]) -> bool:
    return stat.S_ISREG(metadata.st_mode) and not stat.S_ISLNK(metadata.st_mode) and metadata.st_nlink == spec["nlink"] \
        and str(metadata.st_dev) == spec["device"] and str(metadata.st_ino) == spec["inode"] and metadata.st_size == spec["bytes"] \
        and metadata.st_uid == spec["uid"] and metadata.st_gid == spec["gid"] and f"{stat.S_IMODE(metadata.st_mode):04o}" == spec["mode"]


def verify_authorized_projection_source(spec: dict[str, Any], code: str = "SUPERVISOR_MONITORING_PROJECTION_SOURCE_CHANGED") -> bytes:
    source = Path(spec["path"])
    descriptor: int | None = None
    try:
        before = os.lstat(source)
        if not projection_source_metadata_matches(before, spec):
            reject(code)
        descriptor = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        opened = os.fstat(descriptor)
        if not projection_source_metadata_matches(opened, spec) or (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns) \
            != (opened.st_dev, opened.st_ino, opened.st_mtime_ns, opened.st_ctime_ns):
            reject(code)
        chunks: list[bytes] = []
        remaining = opened.st_size
        while remaining:
            chunk = os.read(descriptor, min(1024 * 1024, remaining))
            if not chunk:
                reject(code)
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
        after = os.fstat(descriptor)
        named = os.lstat(source)
        identity = (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns)
        if sha256(raw) != spec["sha256"] or identity != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) \
            or identity != (named.st_dev, named.st_ino, named.st_size, named.st_mtime_ns, named.st_ctime_ns) \
            or not projection_source_metadata_matches(after, spec) or not projection_source_metadata_matches(named, spec):
            reject(code)
    except OSError:
        reject(code)
    finally:
        if descriptor is not None:
            os.close(descriptor)
    return raw


def verify_monitoring_projection_sources(parameters: dict[str, Any], operation: str) -> None:
    gid = parameters["projection_reader_gid"]
    trusted_owned_directory(MONITORING_PROJECTION_ROOT.parent, 0, 0, {0o755}, "SUPERVISOR_MONITORING_PROJECTION_ROOT_INVALID")
    trusted_owned_directory(MONITORING_PROJECTION_ROOT, 0, gid, {0o750}, "SUPERVISOR_MONITORING_PROJECTION_ROOT_INVALID")
    for kind in ("components", "backup"):
        trusted_owned_directory(MONITORING_PROJECTION_ROOT / kind, 0, gid, {0o750}, "SUPERVISOR_MONITORING_PROJECTION_ROOT_INVALID")
    trusted_owned_marker(
        MONITORING_PROJECTION_ROOT / MONITORING_PROJECTION_MARKER,
        MONITORING_PROJECTION_MARKER_VALUE, 0, gid, {0o400}, "SUPERVISOR_MONITORING_PROJECTION_ROOT_INVALID",
    )

    identity_gid = parameters["release_identity_source"]["gid"]
    trusted_owned_directory(RELEASE_IDENTITY_ROOT, 0, identity_gid, {0o750}, "SUPERVISOR_MONITORING_PROJECTION_IDENTITY_ROOT_INVALID")
    trusted_owned_marker(
        RELEASE_IDENTITY_ROOT / RELEASE_IDENTITY_MARKER, RELEASE_IDENTITY_MARKER_VALUE,
        0, identity_gid, {0o440}, "SUPERVISOR_MONITORING_PROJECTION_IDENTITY_ROOT_INVALID",
    )
    receipt_root = Path(parameters["postdeploy_receipt_source"]["path"]).parent
    trusted_owned_directory(receipt_root, 0, 0, {0o750}, "SUPERVISOR_MONITORING_PROJECTION_POSTDEPLOY_ROOT_INVALID")
    trusted_owned_marker(
        receipt_root / RELEASE_ARTIFACT_MARKER, RELEASE_ARTIFACT_MARKER_VALUE,
        0, 0, {0o440}, "SUPERVISOR_MONITORING_PROJECTION_POSTDEPLOY_ROOT_INVALID",
    )
    trusted_owned_directory(MONITORING_PRIVATE_CONFIG.parent, 0, 0, {0o700}, "SUPERVISOR_MONITORING_PROJECTION_CONFIG_ROOT_INVALID")

    sources = [
        parameters["active_source"], parameters["host_config_source"], parameters["release_identity_source"],
        parameters["postdeploy_receipt_source"],
    ]
    if operation == "PUBLISH_MONITORING_BACKUP_PROJECTION":
        readiness_gid = parameters["backup_readiness_source"]["gid"]
        trusted_owned_directory(MONITORING_BACKUP_READINESS_FILE.parent, 0, readiness_gid, {0o2750}, "SUPERVISOR_MONITORING_PROJECTION_BACKUP_ROOT_INVALID")
        trusted_owned_marker(
            MONITORING_BACKUP_READINESS_FILE.parent / BACKUP_STATUS_MARKER, BACKUP_STATUS_MARKER_VALUE,
            0, readiness_gid, {0o400, 0o440}, "SUPERVISOR_MONITORING_PROJECTION_BACKUP_ROOT_INVALID",
        )
        trusted_owned_directory(MONITORING_CLUSTER_POLICY_FILE.parent, 0, 0, {0o700, 0o750, 0o755}, "SUPERVISOR_MONITORING_PROJECTION_POLICY_ROOT_INVALID")
        trusted_owned_directory(CLUSTER_POLICY_STATE_ROOT, 0, 0, {0o700}, "SUPERVISOR_MONITORING_PROJECTION_POLICY_ACTIVATION_ROOT_INVALID")
        trusted_owned_directory(CLUSTER_POLICY_STATE_ROOT / "history", 0, 0, {0o700}, "SUPERVISOR_MONITORING_PROJECTION_POLICY_ACTIVATION_ROOT_INVALID")
        trusted_owned_directory(CLUSTER_POLICY_STATE_ROOT / "receipts", 0, 0, {0o700}, "SUPERVISOR_MONITORING_PROJECTION_POLICY_ACTIVATION_ROOT_INVALID")
        trusted_owned_marker(
            CLUSTER_POLICY_STATE_ROOT / CLUSTER_POLICY_STATE_MARKER, CLUSTER_POLICY_STATE_MARKER_VALUE,
            0, 0, {0o400}, "SUPERVISOR_MONITORING_PROJECTION_POLICY_ACTIVATION_ROOT_INVALID",
        )
        sources += [
            parameters["backup_readiness_source"], parameters["cluster_policy_source"], parameters["cluster_policy_activation_source"],
            parameters["cluster_policy_history_source"], parameters["cluster_policy_receipt_source"],
        ]
    for source in sources:
        verify_authorized_projection_source(source)


def verify_cluster_policy_sources(parameters: dict[str, Any], *, recovery: bool = False) -> None:
    identity_gid = parameters["release_identity_source"]["gid"]
    trusted_owned_directory(RELEASE_IDENTITY_ROOT, 0, identity_gid, {0o750}, "SUPERVISOR_CLUSTER_POLICY_RELEASE_IDENTITY_ROOT_INVALID")
    trusted_owned_marker(
        RELEASE_IDENTITY_ROOT / RELEASE_IDENTITY_MARKER, RELEASE_IDENTITY_MARKER_VALUE,
        0, identity_gid, {0o440}, "SUPERVISOR_CLUSTER_POLICY_RELEASE_IDENTITY_ROOT_INVALID",
    )
    sources = [parameters["release_identity_source"]]
    if not recovery:
        sources += [source for source in (
            parameters["current_policy_source"], parameters["current_activation_source"], parameters["rollback_target_source"],
        ) if source is not None]
    for source in sources:
        verify_authorized_projection_source(source, "SUPERVISOR_CLUSTER_POLICY_SOURCE_CHANGED")


def verify_notifier_egress_sources(parameters: dict[str, Any], *, recovery: bool = False) -> None:
    trusted_owned_directory(NOTIFIER_EGRESS_POLICY_FILE.parent, 0, 0, {0o755}, "SUPERVISOR_NOTIFIER_EGRESS_VIEW_ROOT_INVALID")
    trusted_owned_directory(NOTIFIER_EGRESS_BASE_UNIT.parent, 0, 0, {0o755}, "SUPERVISOR_NOTIFIER_EGRESS_SYSTEMD_ROOT_INVALID")
    sources = [parameters["notifier_config_source"], parameters["base_unit_source"]]
    if not recovery:
        sources += [source for source in (
            parameters["current_policy_source"], parameters["current_activation_source"],
            parameters["rollback_policy_source"], parameters["rollback_activation_source"],
        ) if source is not None]
    if parameters["rollback_policy_source"] is not None:
        trusted_owned_directory(NOTIFIER_EGRESS_STATE_ROOT, 0, 0, {0o700}, "SUPERVISOR_NOTIFIER_EGRESS_STATE_ROOT_INVALID")
        trusted_owned_directory(NOTIFIER_EGRESS_STATE_ROOT / "history", 0, 0, {0o700}, "SUPERVISOR_NOTIFIER_EGRESS_STATE_ROOT_INVALID")
        trusted_owned_directory(NOTIFIER_EGRESS_STATE_ROOT / "receipts", 0, 0, {0o700}, "SUPERVISOR_NOTIFIER_EGRESS_STATE_ROOT_INVALID")
    for source in sources:
        verify_authorized_projection_source(source, "SUPERVISOR_NOTIFIER_EGRESS_SOURCE_CHANGED")


def verify_uat_promotion_sources(parameters: dict[str, Any]) -> dict[str, bytes]:
    candidate_parent = Path(parameters["candidate_snapshot_source"]["path"]).parent
    trusted_owned_directory(candidate_parent, 0, 0, {0o700}, "SUPERVISOR_UAT_PROMOTION_CANDIDATE_ROOT_INVALID")
    manifest_parent = Path(parameters["release_manifest_source"]["path"]).parent
    trusted_owned_directory(manifest_parent, 0, 0, {0o750}, "SUPERVISOR_UAT_PROMOTION_MANIFEST_ROOT_INVALID")
    trusted_owned_marker(
        manifest_parent / RELEASE_ARTIFACT_MARKER, RELEASE_ARTIFACT_MARKER_VALUE,
        0, 0, {0o440}, "SUPERVISOR_UAT_PROMOTION_MANIFEST_ROOT_INVALID",
    )
    identity_gid = parameters["current_runtime_identity_source"]["gid"]
    trusted_owned_directory(RELEASE_IDENTITY_ROOT, 0, identity_gid, {0o750}, "SUPERVISOR_UAT_PROMOTION_RUNTIME_ROOT_INVALID")
    trusted_owned_marker(
        RELEASE_IDENTITY_ROOT / RELEASE_IDENTITY_MARKER, RELEASE_IDENTITY_MARKER_VALUE,
        0, identity_gid, {0o440}, "SUPERVISOR_UAT_PROMOTION_RUNTIME_ROOT_INVALID",
    )
    readiness_gid = parameters["recovery_readiness_source"]["gid"]
    trusted_owned_directory(UAT_PROMOTION_RECOVERY_READINESS_FILE.parent, 0, readiness_gid, {0o750, 0o2750}, "SUPERVISOR_UAT_PROMOTION_RECOVERY_ROOT_INVALID")
    trusted_owned_marker(
        UAT_PROMOTION_RECOVERY_READINESS_FILE.parent / BACKUP_STATUS_MARKER, BACKUP_STATUS_MARKER_VALUE,
        0, readiness_gid, {0o400, 0o440}, "SUPERVISOR_UAT_PROMOTION_RECOVERY_ROOT_INVALID",
    )
    if parameters["current_promotion_source"] is not None:
        trusted_owned_directory(UAT_PROMOTION_STATE_ROOT, 0, 0, {0o700}, "SUPERVISOR_UAT_PROMOTION_STATE_ROOT_INVALID")
        trusted_owned_marker(
            UAT_PROMOTION_STATE_ROOT / UAT_PROMOTION_STATE_MARKER, UAT_PROMOTION_STATE_MARKER_VALUE,
            0, 0, {0o400}, "SUPERVISOR_UAT_PROMOTION_STATE_ROOT_INVALID",
        )
    sources = {
        "candidate": parameters["candidate_snapshot_source"],
        "manifest": parameters["release_manifest_source"],
        "runtime": parameters["current_runtime_identity_source"],
        "recovery": parameters["recovery_readiness_source"],
    }
    if parameters["current_promotion_source"] is not None:
        sources["current"] = parameters["current_promotion_source"]
    return {
        name: verify_authorized_projection_source(source, "SUPERVISOR_UAT_PROMOTION_SOURCE_CHANGED")
        for name, source in sources.items()
    }


def verify_uat_promotion_snapshot_sources(parameters: dict[str, Any]) -> dict[str, bytes]:
    trusted_owned_directory(UAT_PROMOTION_STATE_ROOT, 0, 0, {0o700}, "SUPERVISOR_UAT_PROMOTION_STATE_ROOT_INVALID")
    trusted_owned_marker(
        UAT_PROMOTION_STATE_ROOT / UAT_PROMOTION_STATE_MARKER, UAT_PROMOTION_STATE_MARKER_VALUE,
        0, 0, {0o400}, "SUPERVISOR_UAT_PROMOTION_STATE_ROOT_INVALID",
    )
    identity_gid = parameters["runtime_identity_source"]["gid"]
    trusted_owned_directory(RELEASE_IDENTITY_ROOT, 0, identity_gid, {0o750}, "SUPERVISOR_UAT_PROMOTION_RUNTIME_ROOT_INVALID")
    trusted_owned_marker(
        RELEASE_IDENTITY_ROOT / RELEASE_IDENTITY_MARKER, RELEASE_IDENTITY_MARKER_VALUE,
        0, identity_gid, {0o440}, "SUPERVISOR_UAT_PROMOTION_RUNTIME_ROOT_INVALID",
    )
    readiness_gid = parameters["snapshot_readiness_source"]["gid"]
    trusted_owned_directory(UAT_PROMOTION_RECOVERY_READINESS_FILE.parent, 0, readiness_gid, {0o750, 0o2750}, "SUPERVISOR_UAT_PROMOTION_RECOVERY_ROOT_INVALID")
    trusted_owned_marker(
        UAT_PROMOTION_RECOVERY_READINESS_FILE.parent / BACKUP_STATUS_MARKER, BACKUP_STATUS_MARKER_VALUE,
        0, readiness_gid, {0o400, 0o440}, "SUPERVISOR_UAT_PROMOTION_RECOVERY_ROOT_INVALID",
    )
    trusted_owned_directory(MONITORING_CLUSTER_POLICY_FILE.parent, 0, 0, {0o755}, "SUPERVISOR_UAT_PROMOTION_POLICY_ROOT_INVALID")
    trusted_owned_marker(
        MONITORING_CLUSTER_POLICY_FILE.parent / CLUSTER_POLICY_TARGET_MARKER, CLUSTER_POLICY_TARGET_MARKER_VALUE,
        0, 0, {0o400}, "SUPERVISOR_UAT_PROMOTION_POLICY_ROOT_INVALID",
    )
    trusted_owned_directory(CLUSTER_POLICY_STATE_ROOT, 0, 0, {0o700}, "SUPERVISOR_UAT_PROMOTION_POLICY_ACTIVATION_ROOT_INVALID")
    trusted_owned_marker(
        CLUSTER_POLICY_STATE_ROOT / CLUSTER_POLICY_STATE_MARKER, CLUSTER_POLICY_STATE_MARKER_VALUE,
        0, 0, {0o400}, "SUPERVISOR_UAT_PROMOTION_POLICY_ACTIVATION_ROOT_INVALID",
    )
    sources = {
        "current": parameters["current_checkpoint_source"],
        "runtime": parameters["runtime_identity_source"],
        "readiness": parameters["snapshot_readiness_source"],
        "policy": parameters["snapshot_policy_source"],
        "activation": parameters["snapshot_policy_activation_source"],
    }
    return {
        name: verify_authorized_projection_source(source, "SUPERVISOR_UAT_PROMOTION_SNAPSHOT_SOURCE_CHANGED")
        for name, source in sources.items()
    }


def verify_uat_promotion_quiesce_sources(parameters: dict[str, Any]) -> dict[str, bytes]:
    trusted_owned_directory(UAT_PROMOTION_STATE_ROOT, 0, 0, {0o700}, "SUPERVISOR_UAT_PROMOTION_STATE_ROOT_INVALID")
    trusted_owned_marker(
        UAT_PROMOTION_STATE_ROOT / UAT_PROMOTION_STATE_MARKER, UAT_PROMOTION_STATE_MARKER_VALUE,
        0, 0, {0o400}, "SUPERVISOR_UAT_PROMOTION_STATE_ROOT_INVALID",
    )
    trusted_owned_directory(
        UAT_PROMOTION_STATE_ROOT / "intents", 0, 0, {0o700}, "SUPERVISOR_UAT_PROMOTION_STATE_ROOT_INVALID",
    )
    identity_gid = parameters["runtime_identity_source"]["gid"]
    trusted_owned_directory(RELEASE_IDENTITY_ROOT, 0, identity_gid, {0o750}, "SUPERVISOR_UAT_PROMOTION_RUNTIME_ROOT_INVALID")
    trusted_owned_marker(
        RELEASE_IDENTITY_ROOT / RELEASE_IDENTITY_MARKER, RELEASE_IDENTITY_MARKER_VALUE,
        0, identity_gid, {0o440}, "SUPERVISOR_UAT_PROMOTION_RUNTIME_ROOT_INVALID",
    )
    sources = {
        "current": parameters["current_checkpoint_source"],
        "snapshot_intent": parameters["snapshot_intent_source"],
        "runtime": parameters["runtime_identity_source"],
    }
    return {
        name: verify_authorized_projection_source(source, "SUPERVISOR_UAT_PROMOTION_QUIESCE_SOURCE_CHANGED")
        for name, source in sources.items()
    }


def verify_uat_promotion_migration_authorization_sources(parameters: dict[str, Any]) -> dict[str, bytes]:
    trusted_owned_directory(UAT_PROMOTION_STATE_ROOT, 0, 0, {0o700}, "SUPERVISOR_UAT_PROMOTION_STATE_ROOT_INVALID")
    trusted_owned_marker(
        UAT_PROMOTION_STATE_ROOT / UAT_PROMOTION_STATE_MARKER, UAT_PROMOTION_STATE_MARKER_VALUE,
        0, 0, {0o400}, "SUPERVISOR_UAT_PROMOTION_STATE_ROOT_INVALID",
    )
    trusted_owned_directory(
        UAT_PROMOTION_STATE_ROOT / "intents", 0, 0, {0o700}, "SUPERVISOR_UAT_PROMOTION_STATE_ROOT_INVALID",
    )
    identity_gid = parameters["runtime_identity_source"]["gid"]
    trusted_owned_directory(RELEASE_IDENTITY_ROOT, 0, identity_gid, {0o750}, "SUPERVISOR_UAT_PROMOTION_RUNTIME_ROOT_INVALID")
    trusted_owned_marker(
        RELEASE_IDENTITY_ROOT / RELEASE_IDENTITY_MARKER, RELEASE_IDENTITY_MARKER_VALUE,
        0, identity_gid, {0o440}, "SUPERVISOR_UAT_PROMOTION_RUNTIME_ROOT_INVALID",
    )
    manifest_parent = Path(parameters["release_manifest_source"]["path"]).parent
    trusted_owned_directory(manifest_parent, 0, 0, {0o750}, "SUPERVISOR_UAT_PROMOTION_MANIFEST_ROOT_INVALID")
    trusted_owned_marker(
        manifest_parent / RELEASE_ARTIFACT_MARKER, RELEASE_ARTIFACT_MARKER_VALUE,
        0, 0, {0o440}, "SUPERVISOR_UAT_PROMOTION_MANIFEST_ROOT_INVALID",
    )
    sources = {
        "current": parameters["current_checkpoint_source"],
        "quiesce_intent": parameters["quiesce_intent_source"],
        "runtime": parameters["runtime_identity_source"],
        "manifest": parameters["release_manifest_source"],
    }
    return {
        name: verify_authorized_projection_source(
            source, "SUPERVISOR_UAT_PROMOTION_MIGRATION_AUTHORIZATION_SOURCE_CHANGED",
        )
        for name, source in sources.items()
    }


def verify_uat_promotion_migration_execution_sources(parameters: dict[str, Any]) -> dict[str, bytes]:
    trusted_owned_directory(UAT_PROMOTION_STATE_ROOT, 0, 0, {0o700}, "SUPERVISOR_UAT_PROMOTION_STATE_ROOT_INVALID")
    trusted_owned_marker(
        UAT_PROMOTION_STATE_ROOT / UAT_PROMOTION_STATE_MARKER, UAT_PROMOTION_STATE_MARKER_VALUE,
        0, 0, {0o400}, "SUPERVISOR_UAT_PROMOTION_STATE_ROOT_INVALID",
    )
    trusted_owned_directory(
        UAT_PROMOTION_STATE_ROOT / "intents", 0, 0, {0o700}, "SUPERVISOR_UAT_PROMOTION_STATE_ROOT_INVALID",
    )
    identity_gid = parameters["runtime_identity_source"]["gid"]
    trusted_owned_directory(RELEASE_IDENTITY_ROOT, 0, identity_gid, {0o750}, "SUPERVISOR_UAT_PROMOTION_RUNTIME_ROOT_INVALID")
    trusted_owned_marker(
        RELEASE_IDENTITY_ROOT / RELEASE_IDENTITY_MARKER, RELEASE_IDENTITY_MARKER_VALUE,
        0, identity_gid, {0o440}, "SUPERVISOR_UAT_PROMOTION_RUNTIME_ROOT_INVALID",
    )
    manifest_parent = Path(parameters["release_manifest_source"]["path"]).parent
    trusted_owned_directory(manifest_parent, 0, 0, {0o750}, "SUPERVISOR_UAT_PROMOTION_MANIFEST_ROOT_INVALID")
    trusted_owned_marker(
        manifest_parent / RELEASE_ARTIFACT_MARKER, RELEASE_ARTIFACT_MARKER_VALUE,
        0, 0, {0o440}, "SUPERVISOR_UAT_PROMOTION_MANIFEST_ROOT_INVALID",
    )
    sources = {
        "current": parameters["current_checkpoint_source"],
        "migration_authorization_intent": parameters["migration_authorization_intent_source"],
        "runtime": parameters["runtime_identity_source"],
        "manifest": parameters["release_manifest_source"],
    }
    return {
        name: verify_authorized_projection_source(
            source, "SUPERVISOR_UAT_PROMOTION_MIGRATION_EXECUTION_SOURCE_CHANGED",
        )
        for name, source in sources.items()
    }


def verify_uat_promotion_compose_deployment_sources(parameters: dict[str, Any]) -> dict[str, bytes]:
    trusted_owned_directory(
        UAT_PROMOTION_STATE_ROOT, 0, 0, {0o700}, "SUPERVISOR_UAT_PROMOTION_STATE_ROOT_INVALID",
    )
    trusted_owned_marker(
        UAT_PROMOTION_STATE_ROOT / UAT_PROMOTION_STATE_MARKER, UAT_PROMOTION_STATE_MARKER_VALUE,
        0, 0, {0o400}, "SUPERVISOR_UAT_PROMOTION_STATE_ROOT_INVALID",
    )
    for name in ("intents", "results", "active-fences", "fence-transfers"):
        trusted_owned_directory(
            UAT_PROMOTION_STATE_ROOT / name, 0, 0, {0o700},
            "SUPERVISOR_UAT_PROMOTION_STATE_ROOT_INVALID",
        )
    identity_gid = parameters["runtime_identity_source"]["gid"]
    trusted_owned_directory(
        RELEASE_IDENTITY_ROOT, 0, identity_gid, {0o750},
        "SUPERVISOR_UAT_PROMOTION_RUNTIME_ROOT_INVALID",
    )
    trusted_owned_marker(
        RELEASE_IDENTITY_ROOT / RELEASE_IDENTITY_MARKER, RELEASE_IDENTITY_MARKER_VALUE,
        0, identity_gid, {0o440}, "SUPERVISOR_UAT_PROMOTION_RUNTIME_ROOT_INVALID",
    )
    manifest_parent = Path(parameters["release_manifest_source"]["path"]).parent
    trusted_owned_directory(
        manifest_parent, 0, 0, {0o750}, "SUPERVISOR_UAT_PROMOTION_MANIFEST_ROOT_INVALID",
    )
    trusted_owned_marker(
        manifest_parent / RELEASE_ARTIFACT_MARKER, RELEASE_ARTIFACT_MARKER_VALUE,
        0, 0, {0o440}, "SUPERVISOR_UAT_PROMOTION_MANIFEST_ROOT_INVALID",
    )
    sources = {
        "current": parameters["current_checkpoint_source"],
        "migration_intent": parameters["migration_execution_intent_source"],
        "migration_result": parameters["migration_result_source"],
        "active_fence": parameters["active_migration_fence_source"],
        "runtime": parameters["runtime_identity_source"],
        "manifest": parameters["release_manifest_source"],
        "compose": parameters["compose_file_source"],
        "release_compose": parameters["compose_release_file_source"],
        "environment": parameters["deployment_environment_source"],
    }
    return {
        name: verify_authorized_projection_source(
            source, "SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_SOURCE_CHANGED",
        )
        for name, source in sources.items()
    }


def verify_uat_promotion_postdeploy_sources(parameters: dict[str, Any], operation: str) -> dict[str, bytes]:
    trusted_owned_directory(
        UAT_PROMOTION_STATE_ROOT, 0, 0, {0o700}, "SUPERVISOR_UAT_PROMOTION_STATE_ROOT_INVALID",
    )
    trusted_owned_marker(
        UAT_PROMOTION_STATE_ROOT / UAT_PROMOTION_STATE_MARKER, UAT_PROMOTION_STATE_MARKER_VALUE,
        0, 0, {0o400}, "SUPERVISOR_UAT_PROMOTION_STATE_ROOT_INVALID",
    )
    for name in ("intents", "results", "fence-transfers"):
        trusted_owned_directory(
            UAT_PROMOTION_STATE_ROOT / name, 0, 0, {0o700},
            "SUPERVISOR_UAT_PROMOTION_STATE_ROOT_INVALID",
        )
    manifest_parent = Path(parameters["release_manifest_source"]["path"]).parent
    trusted_owned_directory(
        manifest_parent, 0, 0, {0o750}, "SUPERVISOR_UAT_PROMOTION_MANIFEST_ROOT_INVALID",
    )
    trusted_owned_marker(
        manifest_parent / RELEASE_ARTIFACT_MARKER, RELEASE_ARTIFACT_MARKER_VALUE,
        0, 0, {0o440}, "SUPERVISOR_UAT_PROMOTION_MANIFEST_ROOT_INVALID",
    )
    sources = {
        "current": parameters["current_checkpoint_source"],
        "deployment": parameters["deployment_result_source"],
        "transfer": parameters["fence_transfer_source"],
        "manifest": parameters["release_manifest_source"],
    }
    identity = operation == "VERIFY_UAT_POSTDEPLOY_IDENTITY" \
        or operation == "RECOVER_UAT_PROMOTION" \
        and parameters.get("original_operation") == "POSTDEPLOY_IDENTITY"
    if identity:
        trusted_owned_directory(
            RUNTIME_PROBE_ROOT, 0, 0, {0o700}, "SUPERVISOR_UAT_PROMOTION_RUNTIME_PROBE_ROOT_INVALID",
        )
        trusted_owned_marker(
            RUNTIME_PROBE_ROOT / ".chenyida-erp-runtime-probe-root-v1",
            b"chenyida-erp-runtime-probe-root/v1\n", 0, 0, {0o400},
            "SUPERVISOR_UAT_PROMOTION_RUNTIME_PROBE_ROOT_INVALID",
        )
        sources |= {
            "runtime_intent": parameters["runtime_probe_intent_source"],
            "runtime_result": parameters["runtime_probe_result_source"],
            "runtime_receipt": parameters["runtime_probe_receipt_source"],
        }
    return {
        name: verify_authorized_projection_source(
            source, "SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_SOURCE_CHANGED",
        )
        for name, source in sources.items()
    }


def trusted_directory(path: Path, allowed_modes: set[int], code: str) -> os.stat_result:
    try:
        value = os.lstat(path)
    except OSError:
        reject(code)
    if not path.is_absolute() or path == Path("/") or not stat.S_ISDIR(value.st_mode) or stat.S_ISLNK(value.st_mode) or value.st_uid != 0 or value.st_gid != 0 or stat.S_IMODE(value.st_mode) not in allowed_modes:
        reject(code)
    return value


def safe_relative(value: Any, code: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 240 or value.startswith("/") or "\\" in value or any(part in ("", ".", "..") for part in value.split("/")) or not re.fullmatch(r"[A-Za-z0-9._/-]+", value):
        reject(code)
    return value


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def validate_bundle_manifest(value: Any) -> dict[str, Any]:
    value = exact_fields(value, {"schema_version", "contract", "bundle_version", "source_commit", "source_tree", "launcher_sha256", "files"}, "SUPERVISOR_BUNDLE_FIELDS_INVALID")
    if value["schema_version"] != 1 or value["contract"] != BUNDLE_CONTRACT or value["bundle_version"] != 1:
        reject("SUPERVISOR_BUNDLE_VERSION_INVALID")
    if not isinstance(value["source_commit"], str) or not GIT_OBJECT.fullmatch(value["source_commit"]) or not isinstance(value["source_tree"], str) or not GIT_OBJECT.fullmatch(value["source_tree"]) or not isinstance(value["launcher_sha256"], str) or not SHA256.fullmatch(value["launcher_sha256"]):
        reject("SUPERVISOR_BUNDLE_SOURCE_INVALID")
    if not isinstance(value["files"], list) or len(value["files"]) != len(BUNDLE_FILES):
        reject("SUPERVISOR_BUNDLE_FILES_INVALID")
    previous = ""
    seen: set[str] = set()
    total_bytes = 0
    for entry in value["files"]:
        entry = exact_fields(entry, {"path", "sha256", "bytes", "mode"}, "SUPERVISOR_BUNDLE_FILE_FIELDS_INVALID")
        relative = safe_relative(entry["path"], "SUPERVISOR_BUNDLE_FILE_PATH_INVALID")
        if relative <= previous or relative in seen or relative not in BUNDLE_FILES or entry["mode"] != BUNDLE_FILES[relative]:
            reject("SUPERVISOR_BUNDLE_FILE_ORDER_INVALID")
        if not isinstance(entry["sha256"], str) or not SHA256.fullmatch(entry["sha256"]) or not isinstance(entry["bytes"], int) or isinstance(entry["bytes"], bool) or entry["bytes"] < 1 or entry["bytes"] > MAX_BUNDLE_FILE_BYTES:
            reject("SUPERVISOR_BUNDLE_FILE_IDENTITY_INVALID")
        total_bytes += entry["bytes"]
        if total_bytes > MAX_BUNDLE_BYTES:
            reject("SUPERVISOR_BUNDLE_TOTAL_BYTES_INVALID")
        previous = relative
        seen.add(relative)
    if seen != set(BUNDLE_FILES):
        reject("SUPERVISOR_BUNDLE_FILES_INVALID")
    return value


def _verify_bundle(bundle_root: Path, expected_digest: str, launcher_path: Path, staging: bool) -> dict[str, Any]:
    if not SHA256.fullmatch(expected_digest):
        reject("SUPERVISOR_BUNDLE_PATH_INVALID")
    if staging:
        if not re.fullmatch(rf"\.{expected_digest}\.staging-[a-z0-9_]{{8}}", bundle_root.name):
            reject("SUPERVISOR_BUNDLE_PATH_INVALID")
    elif bundle_root.name != expected_digest:
        reject("SUPERVISOR_BUNDLE_PATH_INVALID")
    trusted_directory(bundle_root, {0o555}, "SUPERVISOR_BUNDLE_ROOT_INVALID")
    manifest_path = bundle_root / "bundle-manifest.json"
    raw, _ = trusted_regular_file(manifest_path, 0o444, code="SUPERVISOR_BUNDLE_MANIFEST_INVALID")
    if sha256(raw) != expected_digest:
        reject("SUPERVISOR_BUNDLE_DIGEST_MISMATCH")
    manifest = validate_bundle_manifest(strict_json(raw, "SUPERVISOR_BUNDLE_MANIFEST_INVALID"))
    if raw != canonical_json(manifest):
        reject("SUPERVISOR_BUNDLE_MANIFEST_NOT_CANONICAL")
    launcher_raw, _ = trusted_regular_file(launcher_path, 0o555, maximum=4 * 1024 * 1024, code="SUPERVISOR_LAUNCHER_INVALID")
    if sha256(launcher_raw) != manifest["launcher_sha256"]:
        reject("SUPERVISOR_LAUNCHER_DIGEST_MISMATCH")

    actual_files: set[str] = set()
    for directory, names, files in os.walk(bundle_root, topdown=True, followlinks=False):
        directory_path = Path(directory)
        trusted_directory(directory_path, {0o555}, "SUPERVISOR_BUNDLE_DIRECTORY_INVALID")
        for name in names:
            trusted_directory(directory_path / name, {0o555}, "SUPERVISOR_BUNDLE_DIRECTORY_INVALID")
        for name in files:
            file = directory_path / name
            relative = file.relative_to(bundle_root).as_posix()
            if relative != "bundle-manifest.json":
                actual_files.add(relative)
    if actual_files != set(BUNDLE_FILES):
        reject("SUPERVISOR_BUNDLE_EXTRA_OR_MISSING_FILE")
    by_path = {entry["path"]: entry for entry in manifest["files"]}
    for relative, expected_mode in BUNDLE_FILES.items():
        entry = by_path[relative]
        raw_file, file_stat = trusted_regular_file(bundle_root / relative, int(expected_mode, 8), maximum=MAX_BUNDLE_FILE_BYTES, code="SUPERVISOR_BUNDLE_FILE_INVALID")
        if len(raw_file) != entry["bytes"] or sha256(raw_file) != entry["sha256"] or stat.S_IMODE(file_stat.st_mode) != int(entry["mode"], 8):
            reject("SUPERVISOR_BUNDLE_FILE_DIGEST_MISMATCH")
    return manifest


def verify_bundle(bundle_root: Path, expected_digest: str, launcher_path: Path = LAUNCHER_PATH) -> dict[str, Any]:
    return _verify_bundle(bundle_root, expected_digest, launcher_path, False)


def verify_staged_bundle(bundle_root: Path, expected_digest: str, launcher_path: Path = LAUNCHER_PATH) -> dict[str, Any]:
    return _verify_bundle(bundle_root, expected_digest, launcher_path, True)


def parse_time(value: Any, code: str) -> datetime:
    if not isinstance(value, str) or not ISO_UTC.fullmatch(value):
        reject(code)
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except ValueError:
        reject(code)


def absolute_path(value: Any, code: str) -> str:
    if not isinstance(value, str) or len(value) > 4096 or not value.startswith("/") or value == "/" or os.path.normpath(value) != value:
        reject(code)
    return value


def validate_monitoring_projection_source(value: Any, expected_path: Path, expected_modes: set[str], expected_gid: int | None = None) -> dict[str, Any]:
    value = exact_fields(value, MONITORING_PROJECTION_SOURCE_FIELDS, "SUPERVISOR_MONITORING_PROJECTION_SOURCE_INVALID")
    if absolute_path(value["path"], "SUPERVISOR_MONITORING_PROJECTION_SOURCE_INVALID") != str(expected_path):
        reject("SUPERVISOR_MONITORING_PROJECTION_SOURCE_PATH_INVALID")
    if not isinstance(value["sha256"], str) or not SHA256.fullmatch(value["sha256"]):
        reject("SUPERVISOR_MONITORING_PROJECTION_SOURCE_INVALID")
    if not isinstance(value["bytes"], int) or isinstance(value["bytes"], bool) or not 1 <= value["bytes"] <= MAX_JSON_BYTES:
        reject("SUPERVISOR_MONITORING_PROJECTION_SOURCE_INVALID")
    for field, allow_zero in (("device", True), ("inode", False)):
        if not isinstance(value[field], str) or not re.fullmatch(r"(?:0|[1-9][0-9]*)" if allow_zero else r"[1-9][0-9]*", value[field]):
            reject("SUPERVISOR_MONITORING_PROJECTION_SOURCE_INVALID")
    for field in ("uid", "gid"):
        if not isinstance(value[field], int) or isinstance(value[field], bool) or not 0 <= value[field] <= 2**31 - 1:
            reject("SUPERVISOR_MONITORING_PROJECTION_SOURCE_INVALID")
    if value["uid"] != 0 or expected_gid is not None and value["gid"] != expected_gid or value["mode"] not in expected_modes or value["nlink"] != 1:
        reject("SUPERVISOR_MONITORING_PROJECTION_SOURCE_INVALID")
    return value


def validate_cluster_policy_source(value: Any, expected_path: Path, expected_mode: str, expected_gid: int | None = 0) -> dict[str, Any]:
    value = exact_fields(value, MONITORING_PROJECTION_SOURCE_FIELDS, "SUPERVISOR_CLUSTER_POLICY_SOURCE_INVALID")
    if absolute_path(value["path"], "SUPERVISOR_CLUSTER_POLICY_SOURCE_INVALID") != str(expected_path):
        reject("SUPERVISOR_CLUSTER_POLICY_SOURCE_PATH_INVALID")
    if not isinstance(value["sha256"], str) or not SHA256.fullmatch(value["sha256"]):
        reject("SUPERVISOR_CLUSTER_POLICY_SOURCE_INVALID")
    if not isinstance(value["bytes"], int) or isinstance(value["bytes"], bool) or not 2 <= value["bytes"] <= MAX_JSON_BYTES:
        reject("SUPERVISOR_CLUSTER_POLICY_SOURCE_INVALID")
    for field, allow_zero in (("device", True), ("inode", False)):
        pattern = r"(?:0|[1-9][0-9]*)" if allow_zero else r"[1-9][0-9]*"
        if not isinstance(value[field], str) or not re.fullmatch(pattern, value[field]):
            reject("SUPERVISOR_CLUSTER_POLICY_SOURCE_INVALID")
    for field in ("uid", "gid"):
        if not isinstance(value[field], int) or isinstance(value[field], bool) or not 0 <= value[field] <= 2**31 - 1:
            reject("SUPERVISOR_CLUSTER_POLICY_SOURCE_INVALID")
    if value["uid"] != 0 or expected_gid is not None and value["gid"] != expected_gid \
        or value["mode"] != expected_mode or value["nlink"] != 1:
        reject("SUPERVISOR_CLUSTER_POLICY_SOURCE_INVALID")
    return value


def validate_cluster_policy_parameters(parameters: Any, operation: str | None = None) -> dict[str, Any]:
    recovery = operation == "RECOVER_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2_ACTIVATION"
    if recovery:
        if not isinstance(parameters, dict) or parameters.get("original_operation") not in ("ACTIVATE", "ROLLBACK"):
            reject("SUPERVISOR_CLUSTER_POLICY_OPERATION_INVALID")
        effective_operation = parameters["original_operation"]
    else:
        effective_operation = CLUSTER_POLICY_OPERATIONS.get(operation or "")
    if effective_operation not in ("ACTIVATE", "ROLLBACK"):
        reject("SUPERVISOR_CLUSTER_POLICY_OPERATION_INVALID")
    expected_fields = set(CLUSTER_POLICY_BASE_PARAMETER_FIELDS)
    if recovery:
        expected_fields |= CLUSTER_POLICY_RECOVERY_PARAMETER_FIELDS
    parameters = exact_fields(parameters, expected_fields, "SUPERVISOR_CLUSTER_POLICY_PARAMETERS_INVALID")
    if parameters["policy_state_root"] != str(CLUSTER_POLICY_STATE_ROOT) or parameters["policy_target"] != str(MONITORING_CLUSTER_POLICY_FILE):
        reject("SUPERVISOR_CLUSTER_POLICY_PATH_INVALID")
    if not isinstance(parameters["activation_id"], str) or not IDENTIFIER.fullmatch(parameters["activation_id"]):
        reject("SUPERVISOR_CLUSTER_POLICY_IDENTIFIER_INVALID")
    if parameters["environment"] not in ("UAT", "PRODUCTION"):
        reject("SUPERVISOR_CLUSTER_POLICY_ENVIRONMENT_INVALID")
    for field, minimum, maximum in (("policy_generation", 1, 1_000_000), ("rpo_hours", 1, 168), ("rto_minutes", 1, 10_080)):
        if not isinstance(parameters[field], int) or isinstance(parameters[field], bool) or not minimum <= parameters[field] <= maximum:
            reject("SUPERVISOR_CLUSTER_POLICY_INTEGER_INVALID")
    digest_fields = (
        "previous_policy_sha256", "previous_activation_receipt_sha256", "template_file_sha256", "template_policy_sha256",
        "approval_reference_sha256", "responsible_operator_identity_sha256", "approver_identity_sha256",
    )
    for field in digest_fields:
        if not isinstance(parameters[field], str) or not SHA256.fullmatch(parameters[field]):
            reject("SUPERVISOR_CLUSTER_POLICY_DIGEST_INVALID")
    if parameters["template_file_sha256"] != CLUSTER_POLICY_TEMPLATE_FILE_SHA256 \
        or parameters["template_policy_sha256"] != CLUSTER_POLICY_TEMPLATE_POLICY_SHA256:
        reject("SUPERVISOR_CLUSTER_POLICY_TEMPLATE_INVALID")
    actors = {
        parameters["approval_reference_sha256"], parameters["responsible_operator_identity_sha256"],
        parameters["approver_identity_sha256"],
    }
    if len(actors) != 3 or "0" * 64 in actors:
        reject("SUPERVISOR_CLUSTER_POLICY_ACTORS_INVALID")
    activated = parse_time(parameters["activated_at"], "SUPERVISOR_CLUSTER_POLICY_TIME_INVALID")
    policy_expires = parse_time(parameters["policy_expires_at"], "SUPERVISOR_CLUSTER_POLICY_TIME_INVALID")
    if policy_expires <= activated or policy_expires - activated > timedelta(hours=24):
        reject("SUPERVISOR_CLUSTER_POLICY_TIME_INVALID")
    if parameters["target_disposition"] not in ("DESTROY_AFTER_EVIDENCE", "RETAIN_QUARANTINED_FOR_APPROVED_INCIDENT"):
        reject("SUPERVISOR_CLUSTER_POLICY_DISPOSITION_INVALID")
    validate_cluster_policy_source(parameters["release_identity_source"], RELEASE_IDENTITY_FILE, "0440", None)
    if parameters["policy_generation"] == 1:
        if parameters["previous_policy_sha256"] != "0" * 64 or parameters["previous_activation_receipt_sha256"] != "0" * 64 \
            or parameters["current_policy_source"] is not None or parameters["current_activation_source"] is not None:
            reject("SUPERVISOR_CLUSTER_POLICY_GENERATION_INVALID")
    else:
        if parameters["previous_policy_sha256"] == "0" * 64 or parameters["previous_activation_receipt_sha256"] == "0" * 64 \
            or parameters["current_policy_source"] is None or parameters["current_activation_source"] is None:
            reject("SUPERVISOR_CLUSTER_POLICY_GENERATION_INVALID")
        current_policy = validate_cluster_policy_source(parameters["current_policy_source"], MONITORING_CLUSTER_POLICY_FILE, "0440", 0)
        validate_cluster_policy_source(parameters["current_activation_source"], CLUSTER_POLICY_CURRENT_FILE, "0400", 0)
        if current_policy["sha256"] != parameters["previous_policy_sha256"]:
            reject("SUPERVISOR_CLUSTER_POLICY_SOURCE_INVALID")
    if effective_operation == "ACTIVATE":
        if parameters["rollback_target_source"] is not None:
            reject("SUPERVISOR_CLUSTER_POLICY_ROLLBACK_INVALID")
    else:
        rollback = parameters["rollback_target_source"]
        if parameters["policy_generation"] < 3 or not isinstance(rollback, dict) or not isinstance(rollback.get("path"), str):
            reject("SUPERVISOR_CLUSTER_POLICY_ROLLBACK_INVALID")
        rollback_path = Path(rollback["path"])
        if rollback_path.parent != CLUSTER_POLICY_STATE_ROOT / "receipts" \
            or not re.fullmatch(r"[0-9]{16}\.[0-9a-f]{64}\.json", rollback_path.name):
            reject("SUPERVISOR_CLUSTER_POLICY_ROLLBACK_INVALID")
        validate_cluster_policy_source(rollback, rollback_path, "0400", 0)
    if recovery:
        if not isinstance(parameters["original_operation_id"], str) or not IDENTIFIER.fullmatch(parameters["original_operation_id"]) \
            or parameters["activation_id"] != parameters["original_operation_id"]:
            reject("SUPERVISOR_CLUSTER_POLICY_IDENTIFIER_INVALID")
        for field in ("expected_intent_sha256", "original_authorization_sha256"):
            if not isinstance(parameters[field], str) or not SHA256.fullmatch(parameters[field]) or parameters[field] == "0" * 64:
                reject("SUPERVISOR_CLUSTER_POLICY_DIGEST_INVALID")
    return parameters


def validate_notifier_egress_source(value: Any, expected_path: Path | None, expected_mode: str,
                                     expected_gid: int, code: str) -> dict[str, Any]:
    value = exact_fields(value, MONITORING_PROJECTION_SOURCE_FIELDS, code)
    if not isinstance(value["path"], str):
        reject(code)
    source_path = Path(value["path"])
    if not source_path.is_absolute() or source_path != Path(os.path.normpath(value["path"])) \
        or expected_path is not None and source_path != expected_path:
        reject(code)
    if not isinstance(value["sha256"], str) or not SHA256.fullmatch(value["sha256"]) or value["sha256"] == "0" * 64:
        reject(code)
    if not isinstance(value["bytes"], int) or isinstance(value["bytes"], bool) or not 2 <= value["bytes"] <= MAX_JSON_BYTES:
        reject(code)
    for field, pattern in (("device", r"(?:0|[1-9][0-9]*)"), ("inode", r"[1-9][0-9]*")):
        if not isinstance(value[field], str) or not re.fullmatch(pattern, value[field]):
            reject(code)
    for field in ("uid", "gid", "nlink"):
        if not isinstance(value[field], int) or isinstance(value[field], bool) or not 0 <= value[field] <= 2**31 - 1:
            reject(code)
    if not isinstance(value["mode"], str) or value["uid"] != 0 or value["gid"] != expected_gid \
        or value["mode"] != expected_mode or value["nlink"] != 1:
        reject(code)
    return value


def validate_notifier_egress_parameters(parameters: Any, operation: str | None = None) -> dict[str, Any]:
    recovery = operation == "RECOVER_MONITORING_NOTIFIER_EGRESS_V1_ACTIVATION"
    if recovery:
        if not isinstance(parameters, dict) or parameters.get("original_operation") not in ("ACTIVATE", "ROLLBACK"):
            reject("SUPERVISOR_NOTIFIER_EGRESS_OPERATION_INVALID")
        effective_operation = parameters["original_operation"]
    else:
        effective_operation = NOTIFIER_EGRESS_OPERATIONS.get(operation or "")
    if effective_operation not in ("ACTIVATE", "ROLLBACK"):
        reject("SUPERVISOR_NOTIFIER_EGRESS_OPERATION_INVALID")
    expected_fields = set(NOTIFIER_EGRESS_BASE_PARAMETER_FIELDS)
    if recovery:
        expected_fields |= NOTIFIER_EGRESS_RECOVERY_PARAMETER_FIELDS
    parameters = exact_fields(parameters, expected_fields, "SUPERVISOR_NOTIFIER_EGRESS_PARAMETERS_INVALID")
    if parameters["policy_state_root"] != str(NOTIFIER_EGRESS_STATE_ROOT) \
        or parameters["policy_target"] != str(NOTIFIER_EGRESS_POLICY_FILE) \
        or parameters["activation_view"] != str(NOTIFIER_EGRESS_ACTIVATION_VIEW) \
        or parameters["dropin_target"] != str(NOTIFIER_EGRESS_DROPIN):
        reject("SUPERVISOR_NOTIFIER_EGRESS_PATH_INVALID")
    for field in ("activation_id", "deployment_id", "target_id"):
        if not isinstance(parameters[field], str) or not IDENTIFIER.fullmatch(parameters[field]):
            reject("SUPERVISOR_NOTIFIER_EGRESS_IDENTIFIER_INVALID")
    if parameters["environment"] not in ("UAT", "PRODUCTION") or parameters["adapter_id"] != "HTTPS_JSON_ACK_V1":
        reject("SUPERVISOR_NOTIFIER_EGRESS_ENVIRONMENT_INVALID")
    for field in ("egress_generation", "target_generation", "credential_generation", "oncall_roster_generation", "notifier_gid"):
        if not isinstance(parameters[field], int) or isinstance(parameters[field], bool) or not 1 <= parameters[field] <= 2**31 - 1:
            reject("SUPERVISOR_NOTIFIER_EGRESS_INTEGER_INVALID")
    digest_fields = (
        "previous_policy_sha256", "previous_activation_receipt_sha256", "rollback_target_activation_receipt_sha256",
        "monitoring_bundle_sha256", "adapter_sha256", "credential_sha256", "escalation_table_sha256",
        "template_file_sha256", "template_policy_sha256", "approval_reference_sha256",
        "responsible_operator_identity_sha256", "approver_identity_sha256",
    )
    zero_allowed = {
        "previous_policy_sha256", "previous_activation_receipt_sha256", "rollback_target_activation_receipt_sha256",
        "template_file_sha256", "template_policy_sha256",
    }
    for field in digest_fields:
        if not isinstance(parameters[field], str) or not SHA256.fullmatch(parameters[field]) \
            or field not in zero_allowed and parameters[field] == "0" * 64:
            reject("SUPERVISOR_NOTIFIER_EGRESS_DIGEST_INVALID")
    if parameters["template_file_sha256"] != NOTIFIER_EGRESS_TEMPLATE_FILE_SHA256 \
        or parameters["template_policy_sha256"] != NOTIFIER_EGRESS_TEMPLATE_POLICY_SHA256:
        reject("SUPERVISOR_NOTIFIER_EGRESS_TEMPLATE_INVALID")
    actors = {parameters["approval_reference_sha256"], parameters["responsible_operator_identity_sha256"], parameters["approver_identity_sha256"]}
    if len(actors) != 3 or "0" * 64 in actors:
        reject("SUPERVISOR_NOTIFIER_EGRESS_ACTORS_INVALID")
    activated = parse_time(parameters["activated_at"], "SUPERVISOR_NOTIFIER_EGRESS_TIME_INVALID")
    expires = parse_time(parameters["expires_at"], "SUPERVISOR_NOTIFIER_EGRESS_TIME_INVALID")
    if expires <= activated or expires - activated > timedelta(hours=24):
        reject("SUPERVISOR_NOTIFIER_EGRESS_TIME_INVALID")
    endpoint = exact_fields(parameters["endpoint"], {"scheme", "host", "port", "path", "tls_server_name"}, "SUPERVISOR_NOTIFIER_EGRESS_ENDPOINT_INVALID")
    host = endpoint["host"]
    if endpoint["scheme"] != "https" or endpoint["port"] != 443 or not isinstance(host, str) \
        or host != host.lower() or "." not in host or host.endswith(".local") \
        or not re.fullmatch(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", host) \
        or endpoint["tls_server_name"] != host or not isinstance(endpoint["path"], str) \
        or not re.fullmatch(r"/[A-Za-z0-9._~!$&'()*+,;=:@%/\-]{0,1023}", endpoint["path"]):
        reject("SUPERVISOR_NOTIFIER_EGRESS_ENDPOINT_INVALID")
    addresses = parameters["allowed_addresses"]
    if not isinstance(addresses, list) or not 1 <= len(addresses) <= 8 or any(not isinstance(item, str) for item in addresses):
        reject("SUPERVISOR_NOTIFIER_EGRESS_ADDRESS_INVALID")
    normalized: list[tuple[str, str]] = []
    try:
        for item in addresses:
            address = ipaddress.ip_address(item)
            canonical = address.compressed.lower()
            if canonical != item or not address.is_global or getattr(address, "ipv4_mapped", None) is not None:
                reject("SUPERVISOR_NOTIFIER_EGRESS_ADDRESS_INVALID")
            normalized.append((f"{canonical}/{32 if address.version == 4 else 128}", canonical))
    except ValueError:
        reject("SUPERVISOR_NOTIFIER_EGRESS_ADDRESS_INVALID")
    if len(set(normalized)) != len(normalized) or [item[1] for item in sorted(normalized)] != addresses:
        reject("SUPERVISOR_NOTIFIER_EGRESS_ADDRESS_INVALID")
    notifier_gid = parameters["notifier_gid"]
    notifier_source = validate_notifier_egress_source(parameters["notifier_config_source"], None, "0440", notifier_gid, "SUPERVISOR_NOTIFIER_EGRESS_NOTIFIER_SOURCE_INVALID")
    notifier_path = Path(notifier_source["path"])
    if notifier_path.parent != NOTIFIER_EGRESS_POLICY_FILE.parent or not re.fullmatch(r"[0-9a-f]{64}\.notifier\.json", notifier_path.name):
        reject("SUPERVISOR_NOTIFIER_EGRESS_NOTIFIER_SOURCE_INVALID")
    base_source = validate_notifier_egress_source(parameters["base_unit_source"], NOTIFIER_EGRESS_BASE_UNIT, "0444", 0, "SUPERVISOR_NOTIFIER_EGRESS_BASE_UNIT_INVALID")
    if base_source["sha256"] != NOTIFIER_EGRESS_BASE_UNIT_SHA256:
        reject("SUPERVISOR_NOTIFIER_EGRESS_BASE_UNIT_INVALID")
    if parameters["egress_generation"] == 1:
        if parameters["previous_policy_sha256"] != "0" * 64 or parameters["previous_activation_receipt_sha256"] != "0" * 64 \
            or parameters["current_policy_source"] is not None or parameters["current_activation_source"] is not None:
            reject("SUPERVISOR_NOTIFIER_EGRESS_GENERATION_INVALID")
    else:
        if parameters["previous_policy_sha256"] == "0" * 64 or parameters["previous_activation_receipt_sha256"] == "0" * 64 \
            or parameters["current_policy_source"] is None or parameters["current_activation_source"] is None:
            reject("SUPERVISOR_NOTIFIER_EGRESS_GENERATION_INVALID")
        current_policy = validate_notifier_egress_source(parameters["current_policy_source"], NOTIFIER_EGRESS_POLICY_FILE, "0440", notifier_gid, "SUPERVISOR_NOTIFIER_EGRESS_CURRENT_SOURCE_INVALID")
        validate_notifier_egress_source(parameters["current_activation_source"], NOTIFIER_EGRESS_ACTIVATION_VIEW, "0440", notifier_gid, "SUPERVISOR_NOTIFIER_EGRESS_CURRENT_SOURCE_INVALID")
        if current_policy["sha256"] != parameters["previous_policy_sha256"]:
            reject("SUPERVISOR_NOTIFIER_EGRESS_CURRENT_SOURCE_INVALID")
    if effective_operation == "ACTIVATE":
        if parameters["rollback_target_activation_receipt_sha256"] != "0" * 64 \
            or parameters["rollback_policy_source"] is not None or parameters["rollback_activation_source"] is not None:
            reject("SUPERVISOR_NOTIFIER_EGRESS_ROLLBACK_INVALID")
    else:
        rollback_policy, rollback_activation = parameters["rollback_policy_source"], parameters["rollback_activation_source"]
        if parameters["egress_generation"] < 3 or parameters["rollback_target_activation_receipt_sha256"] == "0" * 64 \
            or not isinstance(rollback_policy, dict) or not isinstance(rollback_activation, dict):
            reject("SUPERVISOR_NOTIFIER_EGRESS_ROLLBACK_INVALID")
        for source, parent in ((rollback_policy, NOTIFIER_EGRESS_STATE_ROOT / "history"), (rollback_activation, NOTIFIER_EGRESS_STATE_ROOT / "receipts")):
            source_path = Path(source.get("path", ""))
            if source_path.parent != parent or not re.fullmatch(r"[0-9]{16}\.[0-9a-f]{64}\.json", source_path.name):
                reject("SUPERVISOR_NOTIFIER_EGRESS_ROLLBACK_INVALID")
            validate_notifier_egress_source(source, source_path, "0400", 0, "SUPERVISOR_NOTIFIER_EGRESS_ROLLBACK_INVALID")
    if recovery:
        if not isinstance(parameters["original_operation_id"], str) or not IDENTIFIER.fullmatch(parameters["original_operation_id"]) \
            or parameters["activation_id"] != parameters["original_operation_id"]:
            reject("SUPERVISOR_NOTIFIER_EGRESS_IDENTIFIER_INVALID")
        for field in ("expected_intent_sha256", "original_authorization_sha256"):
            if not isinstance(parameters[field], str) or not SHA256.fullmatch(parameters[field]) or parameters[field] == "0" * 64:
                reject("SUPERVISOR_NOTIFIER_EGRESS_DIGEST_INVALID")
    return parameters


def validate_uat_promotion_source(value: Any, expected_path: Path | None, allowed_modes: set[str],
                                  expected_gid: int | None, code: str) -> dict[str, Any]:
    value = exact_fields(value, MONITORING_PROJECTION_SOURCE_FIELDS, code)
    if not isinstance(value["path"], str):
        reject(code)
    source_path = Path(value["path"])
    if not source_path.is_absolute() or source_path != Path(os.path.normpath(value["path"])) \
        or expected_path is not None and source_path != expected_path:
        reject(code)
    if not isinstance(value["sha256"], str) or not SHA256.fullmatch(value["sha256"]) or value["sha256"] == "0" * 64 \
        or not isinstance(value["bytes"], int) or isinstance(value["bytes"], bool) or not 2 <= value["bytes"] <= 4 * MAX_JSON_BYTES:
        reject(code)
    for field, pattern in (("device", r"(?:0|[1-9][0-9]*)"), ("inode", r"[1-9][0-9]*")):
        if not isinstance(value[field], str) or not re.fullmatch(pattern, value[field]):
            reject(code)
    for field in ("uid", "gid", "nlink"):
        if not isinstance(value[field], int) or isinstance(value[field], bool) or not 0 <= value[field] <= 2**31 - 1:
            reject(code)
    if value["uid"] != 0 or expected_gid is not None and value["gid"] != expected_gid \
        or value["mode"] not in allowed_modes or value["nlink"] != 1:
        reject(code)
    return value


def validate_uat_promotion_begin_parameters(parameters: Any, operation: str | None = None) -> dict[str, Any]:
    recovery = operation == "RECOVER_UAT_PROMOTION"
    if recovery and (not isinstance(parameters, dict) or parameters.get("original_operation") != "BEGIN"):
        reject("SUPERVISOR_UAT_PROMOTION_OPERATION_INVALID")
    if not recovery and UAT_PROMOTION_OPERATIONS.get(operation or "") != "BEGIN":
        reject("SUPERVISOR_UAT_PROMOTION_OPERATION_INVALID")
    expected_fields = set(UAT_PROMOTION_BASE_PARAMETER_FIELDS)
    if recovery:
        expected_fields |= UAT_PROMOTION_RECOVERY_PARAMETER_FIELDS
    parameters = exact_fields(parameters, expected_fields, "SUPERVISOR_UAT_PROMOTION_PARAMETERS_INVALID")
    if parameters["promotion_state_root"] != str(UAT_PROMOTION_STATE_ROOT):
        reject("SUPERVISOR_UAT_PROMOTION_STATE_PATH_INVALID")
    if not isinstance(parameters["promotion_id"], str) or not IDENTIFIER.fullmatch(parameters["promotion_id"]):
        reject("SUPERVISOR_UAT_PROMOTION_IDENTIFIER_INVALID")
    if not isinstance(parameters["promotion_generation"], int) or isinstance(parameters["promotion_generation"], bool) \
        or not 1 <= parameters["promotion_generation"] <= 1_000_000:
        reject("SUPERVISOR_UAT_PROMOTION_GENERATION_INVALID")
    for field in ("repository_root", "candidate_snapshot_receipt", "test_runtime_root", "release_manifest"):
        absolute_path(parameters[field], "SUPERVISOR_UAT_PROMOTION_PATH_INVALID")
    if Path(parameters["candidate_snapshot_receipt"]).parent != UAT_PROMOTION_CANDIDATE_RECEIPTS_ROOT \
        or not Path(parameters["candidate_snapshot_receipt"]).name.endswith(".prepared.json"):
        reject("SUPERVISOR_UAT_PROMOTION_CANDIDATE_PATH_INVALID")
    manifest_path = Path(parameters["release_manifest"])
    if manifest_path.name != "release-manifest.json" or manifest_path.parent.parent != RELEASE_ARTIFACT_ROOT_BASE:
        reject("SUPERVISOR_UAT_PROMOTION_MANIFEST_PATH_INVALID")
    if not isinstance(parameters["git_commit"], str) or not GIT_OBJECT.fullmatch(parameters["git_commit"]) \
        or not isinstance(parameters["git_tree"], str) or not GIT_OBJECT.fullmatch(parameters["git_tree"]) \
        or not isinstance(parameters["application_version"], str) or not re.fullmatch(r"0\.1\.0-alpha\.[0-9]+", parameters["application_version"]) \
        or not isinstance(parameters["web_image"], str) or not IMAGE_REFERENCE.fullmatch(parameters["web_image"]) \
        or not isinstance(parameters["worker_image"], str) or not IMAGE_REFERENCE.fullmatch(parameters["worker_image"]) \
        or parameters["web_image"] == parameters["worker_image"] \
        or not isinstance(parameters["migration_head"], str) or not re.fullmatch(r"[0-9]{4}_[a-z0-9_]+\.sql", parameters["migration_head"]):
        reject("SUPERVISOR_UAT_PROMOTION_CANDIDATE_INVALID")
    digest_fields = (
        "previous_promotion_receipt_sha256", "candidate_snapshot_receipt_sha256", "release_manifest_sha256",
        "migration_manifest_sha256", "preupgrade_recovery_readiness_sha256", "preupgrade_recovery_snapshot_sha256",
        "requester_identity_sha256", "approver_identity_sha256", "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
    )
    for field in digest_fields:
        if not isinstance(parameters[field], str) or not SHA256.fullmatch(parameters[field]) \
            or field != "previous_promotion_receipt_sha256" and parameters[field] == "0" * 64:
            reject("SUPERVISOR_UAT_PROMOTION_DIGEST_INVALID")
    if parameters["policy_file_sha256"] != UAT_PROMOTION_POLICY_FILE_SHA256 \
        or parameters["policy_sha256"] != UAT_PROMOTION_POLICY_SHA256:
        reject("SUPERVISOR_UAT_PROMOTION_POLICY_INVALID")
    actors = {parameters["requester_identity_sha256"], parameters["approver_identity_sha256"], parameters["executor_identity_sha256"]}
    if len(actors) != 3 or "0" * 64 in actors:
        reject("SUPERVISOR_UAT_PROMOTION_ACTORS_INVALID")
    if parameters["database_name"] != "chenyida_erp" \
        or not isinstance(parameters["database_oid"], str) or not re.fullmatch(r"[1-9][0-9]{0,9}", parameters["database_oid"]) \
        or not isinstance(parameters["database_system_identifier"], str) or not re.fullmatch(r"[1-9][0-9]{9,29}", parameters["database_system_identifier"]) \
        or parameters["database_marker"] != "chenyida-erp-deployment/v2:UAT:chenyida-erp":
        reject("SUPERVISOR_UAT_PROMOTION_DATABASE_INVALID")
    created = parse_time(parameters["promotion_created_at"], "SUPERVISOR_UAT_PROMOTION_TIME_INVALID")
    expires = parse_time(parameters["promotion_expires_at"], "SUPERVISOR_UAT_PROMOTION_TIME_INVALID")
    if expires <= created or expires - created > timedelta(hours=1):
        reject("SUPERVISOR_UAT_PROMOTION_TIME_INVALID")
    candidate_source = validate_uat_promotion_source(
        parameters["candidate_snapshot_source"], Path(parameters["candidate_snapshot_receipt"]), {"0400"}, 0,
        "SUPERVISOR_UAT_PROMOTION_CANDIDATE_SOURCE_INVALID",
    )
    manifest_source = validate_uat_promotion_source(
        parameters["release_manifest_source"], manifest_path, {"0440"}, 0,
        "SUPERVISOR_UAT_PROMOTION_MANIFEST_SOURCE_INVALID",
    )
    validate_uat_promotion_source(
        parameters["current_runtime_identity_source"], RELEASE_IDENTITY_FILE, {"0440"}, None,
        "SUPERVISOR_UAT_PROMOTION_RUNTIME_SOURCE_INVALID",
    )
    validate_uat_promotion_source(
        parameters["recovery_readiness_source"], UAT_PROMOTION_RECOVERY_READINESS_FILE, {"0400", "0440"}, None,
        "SUPERVISOR_UAT_PROMOTION_RECOVERY_SOURCE_INVALID",
    )
    if candidate_source["sha256"] != parameters["candidate_snapshot_receipt_sha256"] \
        or manifest_source["sha256"] != parameters["release_manifest_sha256"]:
        reject("SUPERVISOR_UAT_PROMOTION_SOURCE_BINDING_INVALID")
    if parameters["promotion_generation"] == 1:
        if parameters["previous_promotion_receipt_sha256"] != "0" * 64 or parameters["current_promotion_source"] is not None:
            reject("SUPERVISOR_UAT_PROMOTION_GENERATION_INVALID")
    else:
        if parameters["previous_promotion_receipt_sha256"] == "0" * 64 or parameters["current_promotion_source"] is None:
            reject("SUPERVISOR_UAT_PROMOTION_GENERATION_INVALID")
        validate_uat_promotion_source(
            parameters["current_promotion_source"], UAT_PROMOTION_CURRENT_FILE, {"0400"}, 0,
            "SUPERVISOR_UAT_PROMOTION_CURRENT_SOURCE_INVALID",
        )
    if recovery:
        if parameters["original_operation_id"] != parameters["promotion_id"] \
            or not isinstance(parameters["original_operation_id"], str) or not IDENTIFIER.fullmatch(parameters["original_operation_id"]):
            reject("SUPERVISOR_UAT_PROMOTION_IDENTIFIER_INVALID")
        for field in ("expected_intent_sha256", "original_authorization_sha256"):
            if not isinstance(parameters[field], str) or not SHA256.fullmatch(parameters[field]) or parameters[field] == "0" * 64:
                reject("SUPERVISOR_UAT_PROMOTION_DIGEST_INVALID")
    return parameters


def validate_uat_promotion_snapshot_objects(value: Any) -> dict[str, Any]:
    value = exact_fields(value, {"postgresql", "uploads", "attachments", "backup_status"}, "SUPERVISOR_UAT_PROMOTION_SNAPSHOT_OBJECTS_INVALID")
    expected_files = {
        "postgresql": "postgresql.dump",
        "uploads": "uploads.tar.gz",
        "attachments": "attachments.tar.gz",
        "backup_status": "backup-status.tar.gz",
    }
    for domain, expected_file in expected_files.items():
        item = exact_fields(value[domain], {"file", "sha256", "bytes", "entries"}, "SUPERVISOR_UAT_PROMOTION_SNAPSHOT_OBJECTS_INVALID")
        if item["file"] != expected_file or not isinstance(item["sha256"], str) or not SHA256.fullmatch(item["sha256"]) \
                or item["sha256"] == "0" * 64 or not isinstance(item["bytes"], int) or isinstance(item["bytes"], bool) or item["bytes"] < 1:
            reject("SUPERVISOR_UAT_PROMOTION_SNAPSHOT_OBJECTS_INVALID")
        if domain == "postgresql":
            if item["entries"] is not None:
                reject("SUPERVISOR_UAT_PROMOTION_SNAPSHOT_OBJECTS_INVALID")
        elif not isinstance(item["entries"], int) or isinstance(item["entries"], bool) or item["entries"] < 0:
            reject("SUPERVISOR_UAT_PROMOTION_SNAPSHOT_OBJECTS_INVALID")
    return value


def validate_uat_promotion_snapshot_parameters(parameters: Any, operation: str | None = None) -> dict[str, Any]:
    recovery = operation == "RECOVER_UAT_PROMOTION"
    if recovery and (not isinstance(parameters, dict) or parameters.get("original_operation") != "CAPTURE_SNAPSHOT"):
        reject("SUPERVISOR_UAT_PROMOTION_OPERATION_INVALID")
    if not recovery and operation != "CAPTURE_UAT_PROMOTION_SNAPSHOT":
        reject("SUPERVISOR_UAT_PROMOTION_OPERATION_INVALID")
    expected_fields = set(UAT_PROMOTION_SNAPSHOT_PARAMETER_FIELDS)
    if recovery:
        expected_fields |= UAT_PROMOTION_RECOVERY_PARAMETER_FIELDS
    parameters = exact_fields(parameters, expected_fields, "SUPERVISOR_UAT_PROMOTION_SNAPSHOT_PARAMETERS_INVALID")
    if parameters["promotion_state_root"] != str(UAT_PROMOTION_STATE_ROOT):
        reject("SUPERVISOR_UAT_PROMOTION_STATE_PATH_INVALID")
    if not isinstance(parameters["promotion_id"], str) or not IDENTIFIER.fullmatch(parameters["promotion_id"]):
        reject("SUPERVISOR_UAT_PROMOTION_IDENTIFIER_INVALID")
    if not isinstance(parameters["promotion_generation"], int) or isinstance(parameters["promotion_generation"], bool) \
            or not 1 <= parameters["promotion_generation"] <= 1_000_000:
        reject("SUPERVISOR_UAT_PROMOTION_GENERATION_INVALID")
    digest_fields = {
        "previous_checkpoint_receipt_sha256", "promotion_intent_sha256", "promotion_original_authorization_sha256",
        "candidate_binding_sha256", "database_binding_sha256", "runtime_binding_sha256", "preupgrade_recovery_binding_sha256",
        "snapshot_readiness_file_sha256", "snapshot_readiness_sha256", "snapshot_policy_file_sha256",
        "snapshot_policy_sha256", "snapshot_policy_activation_file_sha256", "snapshot_policy_activation_receipt_sha256",
        "requester_identity_sha256", "approver_identity_sha256", "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
    }
    if recovery:
        digest_fields |= {"expected_intent_sha256", "original_authorization_sha256"}
    for field in digest_fields:
        if not isinstance(parameters[field], str) or not SHA256.fullmatch(parameters[field]) or parameters[field] == "0" * 64:
            reject("SUPERVISOR_UAT_PROMOTION_SNAPSHOT_DIGEST_INVALID")
    if parameters["policy_file_sha256"] != UAT_PROMOTION_POLICY_FILE_SHA256 \
            or parameters["policy_sha256"] != UAT_PROMOTION_POLICY_SHA256:
        reject("SUPERVISOR_UAT_PROMOTION_POLICY_INVALID")
    actors = {parameters["requester_identity_sha256"], parameters["approver_identity_sha256"], parameters["executor_identity_sha256"]}
    if len(actors) != 3 or "0" * 64 in actors:
        reject("SUPERVISOR_UAT_PROMOTION_ACTORS_INVALID")
    for field in ("snapshot_backup_id", "snapshot_restore_run_id"):
        if not isinstance(parameters[field], str) or not IDENTIFIER.fullmatch(parameters[field]):
            reject("SUPERVISOR_UAT_PROMOTION_SNAPSHOT_IDENTIFIER_INVALID")
    created = parse_time(parameters["snapshot_created_at"], "SUPERVISOR_UAT_PROMOTION_SNAPSHOT_TIME_INVALID")
    expires = parse_time(parameters["snapshot_expires_at"], "SUPERVISOR_UAT_PROMOTION_SNAPSHOT_TIME_INVALID")
    if expires <= created or expires - created > timedelta(hours=1):
        reject("SUPERVISOR_UAT_PROMOTION_SNAPSHOT_TIME_INVALID")
    readiness_path = Path(absolute_path(parameters["snapshot_readiness"], "SUPERVISOR_UAT_PROMOTION_SNAPSHOT_PATH_INVALID"))
    if readiness_path.parent != UAT_PROMOTION_RECOVERY_READINESS_FILE.parent \
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.recovery-readiness-v4\.json", readiness_path.name) \
            or parameters["snapshot_policy"] != str(MONITORING_CLUSTER_POLICY_FILE) \
            or parameters["snapshot_policy_activation"] != str(CLUSTER_POLICY_CURRENT_FILE):
        reject("SUPERVISOR_UAT_PROMOTION_SNAPSHOT_PATH_INVALID")
    current = validate_uat_promotion_source(parameters["current_checkpoint_source"], UAT_PROMOTION_CURRENT_FILE, {"0400"}, 0, "SUPERVISOR_UAT_PROMOTION_SNAPSHOT_CURRENT_SOURCE_INVALID")
    identity = validate_uat_promotion_source(parameters["runtime_identity_source"], RELEASE_IDENTITY_FILE, {"0440"}, None, "SUPERVISOR_UAT_PROMOTION_SNAPSHOT_RUNTIME_SOURCE_INVALID")
    readiness = validate_uat_promotion_source(parameters["snapshot_readiness_source"], readiness_path, {"0640"}, None, "SUPERVISOR_UAT_PROMOTION_SNAPSHOT_READINESS_SOURCE_INVALID")
    policy = validate_uat_promotion_source(parameters["snapshot_policy_source"], MONITORING_CLUSTER_POLICY_FILE, {"0440"}, 0, "SUPERVISOR_UAT_PROMOTION_SNAPSHOT_POLICY_SOURCE_INVALID")
    activation = validate_uat_promotion_source(parameters["snapshot_policy_activation_source"], CLUSTER_POLICY_CURRENT_FILE, {"0400"}, 0, "SUPERVISOR_UAT_PROMOTION_SNAPSHOT_POLICY_ACTIVATION_SOURCE_INVALID")
    if identity["sha256"] != parameters["runtime_binding_sha256"] \
            or readiness["sha256"] != parameters["snapshot_readiness_file_sha256"] \
            or policy["sha256"] != parameters["snapshot_policy_file_sha256"] \
            or activation["sha256"] != parameters["snapshot_policy_activation_file_sha256"]:
        reject("SUPERVISOR_UAT_PROMOTION_SNAPSHOT_SOURCE_BINDING_INVALID")
    validate_uat_promotion_snapshot_objects(parameters["snapshot_objects"])
    if recovery:
        if not isinstance(parameters["original_operation_id"], str) or not IDENTIFIER.fullmatch(parameters["original_operation_id"]) \
                or parameters["original_operation_id"] == parameters["promotion_id"]:
            reject("SUPERVISOR_UAT_PROMOTION_IDENTIFIER_INVALID")
    return parameters


def validate_uat_promotion_quiesce_parameters(parameters: Any, operation: str | None = None) -> dict[str, Any]:
    recovery = operation == "RECOVER_UAT_PROMOTION"
    if recovery and (not isinstance(parameters, dict) or parameters.get("original_operation") != "QUIESCE_WRITERS"):
        reject("SUPERVISOR_UAT_PROMOTION_OPERATION_INVALID")
    if not recovery and operation != "QUIESCE_UAT_WRITERS":
        reject("SUPERVISOR_UAT_PROMOTION_OPERATION_INVALID")
    expected_fields = set(UAT_PROMOTION_QUIESCE_PARAMETER_FIELDS)
    if recovery:
        expected_fields |= UAT_PROMOTION_RECOVERY_PARAMETER_FIELDS
    parameters = exact_fields(parameters, expected_fields, "SUPERVISOR_UAT_PROMOTION_QUIESCE_PARAMETERS_INVALID")
    if parameters["promotion_state_root"] != str(UAT_PROMOTION_STATE_ROOT):
        reject("SUPERVISOR_UAT_PROMOTION_STATE_PATH_INVALID")
    for field in ("promotion_id", "snapshot_operation_id"):
        if not isinstance(parameters[field], str) or not IDENTIFIER.fullmatch(parameters[field]):
            reject("SUPERVISOR_UAT_PROMOTION_QUIESCE_IDENTIFIER_INVALID")
    if parameters["promotion_id"] == parameters["snapshot_operation_id"]:
        reject("SUPERVISOR_UAT_PROMOTION_QUIESCE_IDENTIFIER_INVALID")
    if not isinstance(parameters["promotion_generation"], int) or isinstance(parameters["promotion_generation"], bool) \
            or not 1 <= parameters["promotion_generation"] <= 1_000_000:
        reject("SUPERVISOR_UAT_PROMOTION_GENERATION_INVALID")
    digest_fields = {
        "previous_checkpoint_receipt_sha256", "promotion_intent_sha256", "promotion_original_authorization_sha256",
        "snapshot_intent_sha256", "candidate_binding_sha256", "database_binding_sha256", "runtime_binding_sha256",
        "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256", "requester_identity_sha256",
        "approver_identity_sha256", "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
    }
    if recovery:
        digest_fields |= {"expected_intent_sha256", "original_authorization_sha256"}
    for field in digest_fields:
        if not isinstance(parameters[field], str) or not SHA256.fullmatch(parameters[field]) or parameters[field] == "0" * 64:
            reject("SUPERVISOR_UAT_PROMOTION_QUIESCE_DIGEST_INVALID")
    if parameters["policy_file_sha256"] != UAT_PROMOTION_POLICY_FILE_SHA256 \
            or parameters["policy_sha256"] != UAT_PROMOTION_POLICY_SHA256:
        reject("SUPERVISOR_UAT_PROMOTION_POLICY_INVALID")
    actors = {
        parameters["requester_identity_sha256"], parameters["approver_identity_sha256"],
        parameters["executor_identity_sha256"],
    }
    if len(actors) != 3 or "0" * 64 in actors:
        reject("SUPERVISOR_UAT_PROMOTION_ACTORS_INVALID")
    if parameters["deployment_class"] != "UAT" or parameters["deployment_id"] != "chenyida-erp" \
            or parameters["compose_project"] != RUNTIME_COMPOSE_PROJECT:
        reject("SUPERVISOR_UAT_PROMOTION_QUIESCE_DEPLOYMENT_INVALID")
    compose_root = Path(parameters["compose_project_root"]) if isinstance(parameters["compose_project_root"], str) else Path()
    if not compose_root.is_absolute() or compose_root == Path("/") \
            or compose_root != Path(os.path.normpath(parameters["compose_project_root"])):
        reject("SUPERVISOR_UAT_PROMOTION_QUIESCE_PROJECT_ROOT_INVALID")
    for field in ("web_container", "worker_container"):
        if not isinstance(parameters[field], str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", parameters[field]):
            reject("SUPERVISOR_UAT_PROMOTION_QUIESCE_CONTAINER_INVALID")
    for field in ("web_container_id", "worker_container_id"):
        if not isinstance(parameters[field], str) or not SHA256.fullmatch(parameters[field]):
            reject("SUPERVISOR_UAT_PROMOTION_QUIESCE_CONTAINER_INVALID")
    if parameters["web_container"] == parameters["worker_container"] \
            or parameters["web_container_id"] == parameters["worker_container_id"]:
        reject("SUPERVISOR_UAT_PROMOTION_QUIESCE_CONTAINER_INVALID")
    created = parse_time(parameters["quiesce_created_at"], "SUPERVISOR_UAT_PROMOTION_QUIESCE_TIME_INVALID")
    expires = parse_time(parameters["quiesce_expires_at"], "SUPERVISOR_UAT_PROMOTION_QUIESCE_TIME_INVALID")
    if expires <= created or expires - created > timedelta(hours=1):
        reject("SUPERVISOR_UAT_PROMOTION_QUIESCE_TIME_INVALID")
    snapshot_intent_path = UAT_PROMOTION_STATE_ROOT / "intents" \
        / f"{parameters['snapshot_operation_id']}.{parameters['snapshot_intent_sha256']}.json"
    current = validate_uat_promotion_source(
        parameters["current_checkpoint_source"], UAT_PROMOTION_CURRENT_FILE, {"0400"}, 0,
        "SUPERVISOR_UAT_PROMOTION_QUIESCE_CURRENT_SOURCE_INVALID",
    )
    snapshot_intent = validate_uat_promotion_source(
        parameters["snapshot_intent_source"], snapshot_intent_path, {"0400"}, 0,
        "SUPERVISOR_UAT_PROMOTION_QUIESCE_SNAPSHOT_INTENT_SOURCE_INVALID",
    )
    runtime = validate_uat_promotion_source(
        parameters["runtime_identity_source"], RELEASE_IDENTITY_FILE, {"0440"}, None,
        "SUPERVISOR_UAT_PROMOTION_QUIESCE_RUNTIME_SOURCE_INVALID",
    )
    if runtime["sha256"] != parameters["runtime_binding_sha256"]:
        reject("SUPERVISOR_UAT_PROMOTION_QUIESCE_SOURCE_BINDING_INVALID")
    if current["path"] == snapshot_intent["path"]:
        reject("SUPERVISOR_UAT_PROMOTION_QUIESCE_SOURCE_BINDING_INVALID")
    if recovery:
        original_id = parameters["original_operation_id"]
        if not isinstance(original_id, str) or not IDENTIFIER.fullmatch(original_id) \
                or original_id in (parameters["promotion_id"], parameters["snapshot_operation_id"]):
            reject("SUPERVISOR_UAT_PROMOTION_QUIESCE_IDENTIFIER_INVALID")
    return parameters


def validate_uat_promotion_migration_authorization_parameters(
        parameters: Any, operation: str | None = None) -> dict[str, Any]:
    recovery = operation == "RECOVER_UAT_PROMOTION"
    if recovery and (not isinstance(parameters, dict) or parameters.get("original_operation") != "MIGRATION_AUTHORIZATION"):
        reject("SUPERVISOR_UAT_PROMOTION_OPERATION_INVALID")
    if not recovery and operation != "AUTHORIZE_UAT_PROMOTION_MIGRATION":
        reject("SUPERVISOR_UAT_PROMOTION_OPERATION_INVALID")
    expected_fields = set(UAT_PROMOTION_MIGRATION_AUTHORIZATION_PARAMETER_FIELDS)
    if recovery:
        expected_fields |= UAT_PROMOTION_RECOVERY_PARAMETER_FIELDS
    parameters = exact_fields(
        parameters, expected_fields, "SUPERVISOR_UAT_PROMOTION_MIGRATION_AUTHORIZATION_PARAMETERS_INVALID",
    )
    if parameters["promotion_state_root"] != str(UAT_PROMOTION_STATE_ROOT):
        reject("SUPERVISOR_UAT_PROMOTION_STATE_PATH_INVALID")
    for field in ("promotion_id", "quiesce_operation_id"):
        if not isinstance(parameters[field], str) or not IDENTIFIER.fullmatch(parameters[field]):
            reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_AUTHORIZATION_IDENTIFIER_INVALID")
    if parameters["promotion_id"] == parameters["quiesce_operation_id"]:
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_AUTHORIZATION_IDENTIFIER_INVALID")
    if not isinstance(parameters["promotion_generation"], int) or isinstance(parameters["promotion_generation"], bool) \
            or not 1 <= parameters["promotion_generation"] <= 1_000_000:
        reject("SUPERVISOR_UAT_PROMOTION_GENERATION_INVALID")
    digest_fields = {
        "previous_checkpoint_receipt_sha256", "promotion_intent_sha256", "promotion_original_authorization_sha256",
        "quiesce_intent_sha256", "candidate_binding_sha256", "database_binding_sha256", "runtime_binding_sha256",
        "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256", "writer_quiesce_binding_sha256",
        "release_manifest_sha256", "migration_manifest_sha256", "requester_identity_sha256",
        "approver_identity_sha256", "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
    }
    if recovery:
        digest_fields |= {"expected_intent_sha256", "original_authorization_sha256"}
    for field in digest_fields:
        if not isinstance(parameters[field], str) or not SHA256.fullmatch(parameters[field]) \
                or parameters[field] == "0" * 64:
            reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_AUTHORIZATION_DIGEST_INVALID")
    if parameters["policy_file_sha256"] != UAT_PROMOTION_POLICY_FILE_SHA256 \
            or parameters["policy_sha256"] != UAT_PROMOTION_POLICY_SHA256:
        reject("SUPERVISOR_UAT_PROMOTION_POLICY_INVALID")
    actors = {
        parameters["requester_identity_sha256"], parameters["approver_identity_sha256"],
        parameters["executor_identity_sha256"],
    }
    if len(actors) != 3 or "0" * 64 in actors:
        reject("SUPERVISOR_UAT_PROMOTION_ACTORS_INVALID")
    if parameters["deployment_class"] != "UAT" or parameters["deployment_id"] != "chenyida-erp" \
            or parameters["database_name"] != "chenyida_erp" \
            or not isinstance(parameters["database_oid"], str) \
            or not re.fullmatch(r"[1-9][0-9]{0,9}", parameters["database_oid"]) \
            or not isinstance(parameters["database_system_identifier"], str) \
            or not re.fullmatch(r"[1-9][0-9]{9,29}", parameters["database_system_identifier"]) \
            or parameters["database_marker"] != "chenyida-erp-deployment/v2:UAT:chenyida-erp":
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_AUTHORIZATION_DATABASE_INVALID")
    migration_file = r"[0-9]{4}_[a-z0-9_]+\.sql"
    if not isinstance(parameters["expected_current_migration_head"], str) \
            or not re.fullmatch(migration_file, parameters["expected_current_migration_head"]) \
            or not isinstance(parameters["target_migration_head"], str) \
            or not re.fullmatch(migration_file, parameters["target_migration_head"]) \
            or not isinstance(parameters["migration_role"], str) \
            or not re.fullmatch(r"[a-z_][a-z0-9_$-]{0,62}", parameters["migration_role"]):
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_AUTHORIZATION_TARGET_INVALID")
    created = parse_time(
        parameters["authorization_created_at"], "SUPERVISOR_UAT_PROMOTION_MIGRATION_AUTHORIZATION_TIME_INVALID",
    )
    expires = parse_time(
        parameters["authorization_expires_at"], "SUPERVISOR_UAT_PROMOTION_MIGRATION_AUTHORIZATION_TIME_INVALID",
    )
    if expires <= created or expires - created > timedelta(hours=1):
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_AUTHORIZATION_TIME_INVALID")
    manifest = Path(absolute_path(
        parameters["release_manifest"], "SUPERVISOR_UAT_PROMOTION_MIGRATION_AUTHORIZATION_PATH_INVALID",
    ))
    if manifest.name != "release-manifest.json" or manifest.parent.parent != RELEASE_ARTIFACT_ROOT_BASE:
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_AUTHORIZATION_PATH_INVALID")
    quiesce_intent_path = UAT_PROMOTION_STATE_ROOT / "intents" \
        / f"{parameters['quiesce_operation_id']}.{parameters['quiesce_intent_sha256']}.json"
    current = validate_uat_promotion_source(
        parameters["current_checkpoint_source"], UAT_PROMOTION_CURRENT_FILE, {"0400"}, 0,
        "SUPERVISOR_UAT_PROMOTION_MIGRATION_AUTHORIZATION_CURRENT_SOURCE_INVALID",
    )
    quiesce = validate_uat_promotion_source(
        parameters["quiesce_intent_source"], quiesce_intent_path, {"0400"}, 0,
        "SUPERVISOR_UAT_PROMOTION_MIGRATION_AUTHORIZATION_QUIESCE_SOURCE_INVALID",
    )
    runtime = validate_uat_promotion_source(
        parameters["runtime_identity_source"], RELEASE_IDENTITY_FILE, {"0440"}, None,
        "SUPERVISOR_UAT_PROMOTION_MIGRATION_AUTHORIZATION_RUNTIME_SOURCE_INVALID",
    )
    release = validate_uat_promotion_source(
        parameters["release_manifest_source"], manifest, {"0440"}, 0,
        "SUPERVISOR_UAT_PROMOTION_MIGRATION_AUTHORIZATION_MANIFEST_SOURCE_INVALID",
    )
    if runtime["sha256"] != parameters["runtime_binding_sha256"] \
            or release["sha256"] != parameters["release_manifest_sha256"] \
            or current["path"] == quiesce["path"]:
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_AUTHORIZATION_SOURCE_BINDING_INVALID")
    if recovery:
        original_id = parameters["original_operation_id"]
        if not isinstance(original_id, str) or not IDENTIFIER.fullmatch(original_id) \
                or original_id in (parameters["promotion_id"], parameters["quiesce_operation_id"]):
            reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_AUTHORIZATION_IDENTIFIER_INVALID")
    return parameters


def validate_uat_promotion_migration_execution_parameters(
        parameters: Any, operation: str | None = None) -> dict[str, Any]:
    recovery = operation == "RECOVER_UAT_PROMOTION"
    if recovery and (not isinstance(parameters, dict) or parameters.get("original_operation") != "MIGRATION_EXECUTION"):
        reject("SUPERVISOR_UAT_PROMOTION_OPERATION_INVALID")
    if not recovery and operation != "RUN_UAT_PROMOTION_MIGRATION":
        reject("SUPERVISOR_UAT_PROMOTION_OPERATION_INVALID")
    expected_fields = set(UAT_PROMOTION_MIGRATION_EXECUTION_PARAMETER_FIELDS)
    if recovery:
        expected_fields |= UAT_PROMOTION_RECOVERY_PARAMETER_FIELDS
    parameters = exact_fields(
        parameters, expected_fields, "SUPERVISOR_UAT_PROMOTION_MIGRATION_EXECUTION_PARAMETERS_INVALID",
    )
    if parameters["promotion_state_root"] != str(UAT_PROMOTION_STATE_ROOT):
        reject("SUPERVISOR_UAT_PROMOTION_STATE_PATH_INVALID")
    for field in ("promotion_id", "migration_authorization_operation_id"):
        if not isinstance(parameters[field], str) or not IDENTIFIER.fullmatch(parameters[field]):
            reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_EXECUTION_IDENTIFIER_INVALID")
    if parameters["promotion_id"] == parameters["migration_authorization_operation_id"]:
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_EXECUTION_IDENTIFIER_INVALID")
    if not isinstance(parameters["promotion_generation"], int) or isinstance(parameters["promotion_generation"], bool) \
            or not 1 <= parameters["promotion_generation"] <= 1_000_000:
        reject("SUPERVISOR_UAT_PROMOTION_GENERATION_INVALID")
    digest_fields = {
        "previous_checkpoint_receipt_sha256", "promotion_intent_sha256",
        "promotion_original_authorization_sha256", "migration_authorization_intent_sha256",
        "migration_approval_authorization_sha256", "candidate_binding_sha256", "database_binding_sha256",
        "runtime_binding_sha256", "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256",
        "writer_quiesce_binding_sha256", "migration_authorization_binding_sha256", "release_manifest_sha256",
        "migration_manifest_sha256", "postgres_container_id", "requester_identity_sha256",
        "approver_identity_sha256", "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
    }
    if recovery:
        digest_fields |= {"expected_intent_sha256", "original_authorization_sha256"}
    for field in digest_fields:
        if not isinstance(parameters[field], str) or not SHA256.fullmatch(parameters[field]) \
                or parameters[field] == "0" * 64:
            reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_EXECUTION_DIGEST_INVALID")
    if parameters["policy_file_sha256"] != UAT_PROMOTION_POLICY_FILE_SHA256 \
            or parameters["policy_sha256"] != UAT_PROMOTION_POLICY_SHA256:
        reject("SUPERVISOR_UAT_PROMOTION_POLICY_INVALID")
    actors = {
        parameters["requester_identity_sha256"], parameters["approver_identity_sha256"],
        parameters["executor_identity_sha256"],
    }
    if len(actors) != 3 or "0" * 64 in actors:
        reject("SUPERVISOR_UAT_PROMOTION_ACTORS_INVALID")
    if parameters["deployment_class"] != "UAT" or parameters["deployment_id"] != "chenyida-erp" \
            or parameters["database_name"] != "chenyida_erp" \
            or not isinstance(parameters["database_oid"], str) \
            or not re.fullmatch(r"[1-9][0-9]{0,9}", parameters["database_oid"]) \
            or not isinstance(parameters["database_system_identifier"], str) \
            or not re.fullmatch(r"[1-9][0-9]{9,29}", parameters["database_system_identifier"]) \
            or parameters["database_marker"] != "chenyida-erp-deployment/v2:UAT:chenyida-erp" \
            or parameters["migration_role"] != "chenyida_erp_owner" or parameters["control_role"] != "postgres":
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_EXECUTION_DATABASE_INVALID")
    migration_file = r"[0-9]{4}_[a-z0-9_]+\.sql"
    if not isinstance(parameters["expected_current_migration_head"], str) \
            or not re.fullmatch(migration_file, parameters["expected_current_migration_head"]) \
            or not isinstance(parameters["target_migration_head"], str) \
            or not re.fullmatch(migration_file, parameters["target_migration_head"]) \
            or not isinstance(parameters["worker_image"], str) or not IMAGE_REFERENCE.fullmatch(parameters["worker_image"]) \
            or not isinstance(parameters["postgres_container"], str) \
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", parameters["postgres_container"]) \
            or not isinstance(parameters["postgres_image_digest"], str) \
            or not re.fullmatch(r"sha256:[0-9a-f]{64}", parameters["postgres_image_digest"]) \
            or parameters["backend_network"] != "chenyida-erp_backend":
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_EXECUTION_TARGET_INVALID")
    created = parse_time(
        parameters["execution_created_at"], "SUPERVISOR_UAT_PROMOTION_MIGRATION_EXECUTION_TIME_INVALID",
    )
    expires = parse_time(
        parameters["execution_expires_at"], "SUPERVISOR_UAT_PROMOTION_MIGRATION_EXECUTION_TIME_INVALID",
    )
    if expires <= created or expires - created > timedelta(minutes=15):
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_EXECUTION_TIME_INVALID")
    manifest = Path(absolute_path(
        parameters["release_manifest"], "SUPERVISOR_UAT_PROMOTION_MIGRATION_EXECUTION_PATH_INVALID",
    ))
    if manifest.name != "release-manifest.json" or manifest.parent.parent != RELEASE_ARTIFACT_ROOT_BASE:
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_EXECUTION_PATH_INVALID")
    approval_intent_path = UAT_PROMOTION_STATE_ROOT / "intents" \
        / f"{parameters['migration_authorization_operation_id']}.{parameters['migration_authorization_intent_sha256']}.json"
    current = validate_uat_promotion_source(
        parameters["current_checkpoint_source"], UAT_PROMOTION_CURRENT_FILE, {"0400"}, 0,
        "SUPERVISOR_UAT_PROMOTION_MIGRATION_EXECUTION_CURRENT_SOURCE_INVALID",
    )
    approval = validate_uat_promotion_source(
        parameters["migration_authorization_intent_source"], approval_intent_path, {"0400"}, 0,
        "SUPERVISOR_UAT_PROMOTION_MIGRATION_EXECUTION_APPROVAL_SOURCE_INVALID",
    )
    runtime = validate_uat_promotion_source(
        parameters["runtime_identity_source"], RELEASE_IDENTITY_FILE, {"0440"}, None,
        "SUPERVISOR_UAT_PROMOTION_MIGRATION_EXECUTION_RUNTIME_SOURCE_INVALID",
    )
    release = validate_uat_promotion_source(
        parameters["release_manifest_source"], manifest, {"0440"}, 0,
        "SUPERVISOR_UAT_PROMOTION_MIGRATION_EXECUTION_MANIFEST_SOURCE_INVALID",
    )
    if runtime["sha256"] != parameters["runtime_binding_sha256"] \
            or release["sha256"] != parameters["release_manifest_sha256"] \
            or len({current["path"], approval["path"], runtime["path"], release["path"]}) != 4:
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_EXECUTION_SOURCE_BINDING_INVALID")
    if recovery:
        original_id = parameters["original_operation_id"]
        if not isinstance(original_id, str) or not IDENTIFIER.fullmatch(original_id) \
                or original_id in (
                    parameters["promotion_id"], parameters["migration_authorization_operation_id"],
                ):
            reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_EXECUTION_IDENTIFIER_INVALID")
    return parameters


def validate_uat_promotion_compose_deployment_parameters(
        parameters: Any, operation: str | None = None) -> dict[str, Any]:
    recovery = operation == "RECOVER_UAT_PROMOTION"
    if recovery and (not isinstance(parameters, dict) or parameters.get("original_operation") != "COMPOSE_DEPLOYMENT"):
        reject("SUPERVISOR_UAT_PROMOTION_OPERATION_INVALID")
    if not recovery and operation != "DEPLOY_UAT_RELEASE":
        reject("SUPERVISOR_UAT_PROMOTION_OPERATION_INVALID")
    expected_fields = set(UAT_PROMOTION_COMPOSE_DEPLOYMENT_PARAMETER_FIELDS)
    if recovery:
        expected_fields |= UAT_PROMOTION_RECOVERY_PARAMETER_FIELDS
    parameters = exact_fields(
        parameters, expected_fields, "SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_PARAMETERS_INVALID",
    )
    if parameters["promotion_state_root"] != str(UAT_PROMOTION_STATE_ROOT):
        reject("SUPERVISOR_UAT_PROMOTION_STATE_PATH_INVALID")
    for field in ("promotion_id", "migration_operation_id"):
        if not isinstance(parameters[field], str) or not IDENTIFIER.fullmatch(parameters[field]):
            reject("SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_IDENTIFIER_INVALID")
    if not isinstance(parameters["promotion_generation"], int) or isinstance(parameters["promotion_generation"], bool) \
            or not 1 <= parameters["promotion_generation"] <= 1_000_000 \
            or not isinstance(parameters["reader_gid"], int) or isinstance(parameters["reader_gid"], bool) \
            or not 1 <= parameters["reader_gid"] <= 2**31 - 1:
        reject("SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_INTEGER_INVALID")
    digest_fields = {
        "previous_checkpoint_receipt_sha256", "promotion_intent_sha256",
        "promotion_original_authorization_sha256", "migration_execution_intent_sha256",
        "migration_execution_authorization_sha256", "migration_grant_sha256", "migration_result_sha256",
        "active_migration_fence_sha256", "candidate_binding_sha256", "database_binding_sha256",
        "runtime_binding_sha256", "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256",
        "writer_quiesce_binding_sha256", "migration_authorization_binding_sha256",
        "migration_fence_binding_sha256", "migration_result_binding_sha256", "release_manifest_sha256",
        "deployment_environment_sha256", "old_web_container_id", "old_worker_container_id",
        "postgres_container_id", "caddy_container_id", "requester_identity_sha256",
        "approver_identity_sha256", "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
    }
    if recovery:
        digest_fields |= {"expected_intent_sha256", "original_authorization_sha256"}
    for field in digest_fields:
        if not isinstance(parameters[field], str) or not SHA256.fullmatch(parameters[field]) \
                or parameters[field] == "0" * 64:
            reject("SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_DIGEST_INVALID")
    if parameters["policy_file_sha256"] != UAT_PROMOTION_POLICY_FILE_SHA256 \
            or parameters["policy_sha256"] != UAT_PROMOTION_POLICY_SHA256:
        reject("SUPERVISOR_UAT_PROMOTION_POLICY_INVALID")
    if len({parameters["requester_identity_sha256"], parameters["approver_identity_sha256"],
            parameters["executor_identity_sha256"]}) != 3:
        reject("SUPERVISOR_UAT_PROMOTION_ACTORS_INVALID")
    expected_containers = {
        "web_container": "chenyida-erp-web-1", "worker_container": "chenyida-erp-worker-1",
        "postgres_container": "chenyida-erp-postgres-1", "caddy_container": "chenyida-erp-caddy-1",
    }
    if parameters["deployment_class"] != "UAT" or parameters["deployment_id"] != "chenyida-erp" \
            or parameters["compose_project"] != "chenyida-erp" \
            or any(parameters[field] != value for field, value in expected_containers.items()) \
            or parameters["backend_network"] != "chenyida-erp_backend" \
            or parameters["edge_network"] != "chenyida-erp_edge" \
            or parameters["database_name"] != "chenyida_erp" \
            or not isinstance(parameters["database_oid"], str) \
            or not re.fullmatch(r"[1-9][0-9]{0,9}", parameters["database_oid"]) \
            or not isinstance(parameters["database_system_identifier"], str) \
            or not re.fullmatch(r"[1-9][0-9]{9,29}", parameters["database_system_identifier"]) \
            or parameters["database_marker"] != "chenyida-erp-deployment/v2:UAT:chenyida-erp" \
            or parameters["control_role"] != "postgres":
        reject("SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_TARGET_INVALID")
    for field in ("web_image", "worker_image"):
        if not isinstance(parameters[field], str) or not IMAGE_REFERENCE.fullmatch(parameters[field]):
            reject("SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_TARGET_INVALID")
    for field in ("old_web_image_digest", "old_worker_image_digest", "postgres_image_digest", "caddy_image_digest"):
        if not isinstance(parameters[field], str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", parameters[field]):
            reject("SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_TARGET_INVALID")
    created = parse_time(
        parameters["deployment_created_at"], "SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_TIME_INVALID",
    )
    expires = parse_time(
        parameters["deployment_expires_at"], "SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_TIME_INVALID",
    )
    if expires <= created or expires - created > timedelta(minutes=15):
        reject("SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_TIME_INVALID")
    compose_root = Path(absolute_path(
        parameters["compose_project_root"], "SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_PATH_INVALID",
    ))
    manifest = Path(absolute_path(
        parameters["release_manifest"], "SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_PATH_INVALID",
    ))
    environment = Path(absolute_path(
        parameters["deployment_environment"], "SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_PATH_INVALID",
    ))
    if manifest.name != "release-manifest.json" or manifest.parent.parent != RELEASE_ARTIFACT_ROOT_BASE:
        reject("SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_PATH_INVALID")
    migration_intent_path = UAT_PROMOTION_STATE_ROOT / "intents" \
        / f"{parameters['migration_operation_id']}.{parameters['migration_execution_intent_sha256']}.json"
    migration_result_path = UAT_PROMOTION_STATE_ROOT / "results" \
        / f"{parameters['migration_operation_id']}.{parameters['migration_result_sha256']}.json"
    active_fence_path = UAT_PROMOTION_ACTIVE_FENCES_ROOT \
        / f"{parameters['migration_operation_id']}.{parameters['active_migration_fence_sha256']}.json"
    sources = {
        "current": validate_uat_promotion_source(
            parameters["current_checkpoint_source"], UAT_PROMOTION_CURRENT_FILE, {"0400"}, 0,
            "SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_SOURCE_INVALID",
        ),
        "migration_intent": validate_uat_promotion_source(
            parameters["migration_execution_intent_source"], migration_intent_path, {"0400"}, 0,
            "SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_SOURCE_INVALID",
        ),
        "migration_result": validate_uat_promotion_source(
            parameters["migration_result_source"], migration_result_path, {"0400"}, 0,
            "SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_SOURCE_INVALID",
        ),
        "active_fence": validate_uat_promotion_source(
            parameters["active_migration_fence_source"], active_fence_path, {"0400"}, 0,
            "SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_SOURCE_INVALID",
        ),
        "runtime": validate_uat_promotion_source(
            parameters["runtime_identity_source"], RELEASE_IDENTITY_FILE, {"0440"}, None,
            "SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_SOURCE_INVALID",
        ),
        "manifest": validate_uat_promotion_source(
            parameters["release_manifest_source"], manifest, {"0440"}, 0,
            "SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_SOURCE_INVALID",
        ),
        "compose": validate_uat_promotion_source(
            parameters["compose_file_source"], compose_root / "compose.yml", {"0444"}, 0,
            "SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_SOURCE_INVALID",
        ),
        "release_compose": validate_uat_promotion_source(
            parameters["compose_release_file_source"], compose_root / "compose.release.yml", {"0444"}, 0,
            "SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_SOURCE_INVALID",
        ),
        "environment": validate_uat_promotion_source(
            parameters["deployment_environment_source"], environment, {"0400"}, 0,
            "SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_SOURCE_INVALID",
        ),
    }
    bindings = {
        "runtime": parameters["runtime_binding_sha256"],
        "manifest": parameters["release_manifest_sha256"],
        "environment": parameters["deployment_environment_sha256"],
    }
    if any(sources[name]["sha256"] != digest for name, digest in bindings.items()) \
            or len({source["path"] for source in sources.values()}) != len(sources):
        reject("SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_SOURCE_BINDING_INVALID")
    if recovery:
        original_id = parameters["original_operation_id"]
        if not isinstance(original_id, str) or not IDENTIFIER.fullmatch(original_id) \
                or original_id in (parameters["promotion_id"], parameters["migration_operation_id"]):
            reject("SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_IDENTIFIER_INVALID")
    return parameters


def validate_uat_promotion_postdeploy_parameters(
        parameters: Any, operation: str | None = None) -> dict[str, Any]:
    recovery = operation == "RECOVER_UAT_PROMOTION"
    original_operation = parameters.get("original_operation") if isinstance(parameters, dict) else None
    runtime = operation == "VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION" \
        or recovery and original_operation == "POSTDEPLOY_RUNTIME_CONFIGURATION"
    identity = operation == "VERIFY_UAT_POSTDEPLOY_IDENTITY" \
        or recovery and original_operation == "POSTDEPLOY_IDENTITY"
    if not runtime and not identity:
        reject("SUPERVISOR_UAT_PROMOTION_OPERATION_INVALID")
    expected_fields = set(
        UAT_PROMOTION_POSTDEPLOY_RUNTIME_PARAMETER_FIELDS if runtime
        else UAT_PROMOTION_POSTDEPLOY_IDENTITY_PARAMETER_FIELDS
    )
    if recovery:
        expected_fields |= UAT_PROMOTION_RECOVERY_PARAMETER_FIELDS
    parameters = exact_fields(
        parameters, expected_fields, "SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_PARAMETERS_INVALID",
    )
    if parameters["promotion_state_root"] != str(UAT_PROMOTION_STATE_ROOT):
        reject("SUPERVISOR_UAT_PROMOTION_STATE_PATH_INVALID")
    identifier_fields = ["promotion_id", "deployment_operation_id"]
    identifier_fields += ["probe_id"] if runtime else ["runtime_probe_operation_id", "run_id"]
    for field in identifier_fields:
        if not isinstance(parameters[field], str) or not IDENTIFIER.fullmatch(parameters[field]):
            reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_IDENTIFIER_INVALID")
    if not isinstance(parameters["promotion_generation"], int) \
            or isinstance(parameters["promotion_generation"], bool) \
            or not 1 <= parameters["promotion_generation"] <= 1_000_000 \
            or not isinstance(parameters["reader_gid"], int) or isinstance(parameters["reader_gid"], bool) \
            or not 1 <= parameters["reader_gid"] <= 2**31 - 1:
        reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_INTEGER_INVALID")
    digest_fields = {
        "previous_checkpoint_receipt_sha256", "promotion_intent_sha256",
        "promotion_original_authorization_sha256", "candidate_binding_sha256", "database_binding_sha256",
        "runtime_binding_sha256", "preupgrade_recovery_binding_sha256", "promotion_snapshot_binding_sha256",
        "writer_quiesce_binding_sha256", "migration_authorization_binding_sha256",
        "migration_fence_binding_sha256", "migration_result_binding_sha256",
        "compose_deployment_binding_sha256", "deployment_result_sha256", "fence_transfer_sha256",
        "release_manifest_sha256", "runtime_policy_sha256", "requester_identity_sha256",
        "approver_identity_sha256", "executor_identity_sha256", "policy_file_sha256", "policy_sha256",
    }
    if identity:
        digest_fields |= {
            "runtime_probe_intent_sha256", "runtime_probe_result_sha256",
            "runtime_probe_receipt_sha256", "runtime_configuration_sha256",
        }
    if recovery:
        digest_fields |= {"expected_intent_sha256", "original_authorization_sha256"}
    for field in digest_fields:
        if not isinstance(parameters[field], str) or not SHA256.fullmatch(parameters[field]) \
                or parameters[field] == "0" * 64:
            reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_DIGEST_INVALID")
    if parameters["policy_file_sha256"] != UAT_PROMOTION_POLICY_FILE_SHA256 \
            or parameters["policy_sha256"] != UAT_PROMOTION_POLICY_SHA256 \
            or parameters["runtime_guard_contract"] != RUNTIME_GUARD_CONTRACT \
            or parameters["runtime_guard_mode"] != POST_DEPLOY_RUNTIME_GUARD_MODE \
            or parameters["runtime_policy_sha256"] != RUNTIME_POLICY_SHA256:
        reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_POLICY_INVALID")
    if len({parameters["requester_identity_sha256"], parameters["approver_identity_sha256"],
            parameters["executor_identity_sha256"]}) != 3:
        reject("SUPERVISOR_UAT_PROMOTION_ACTORS_INVALID")
    expected_containers = {
        "caddy_container": "chenyida-erp-caddy-1", "postgres_container": "chenyida-erp-postgres-1",
        "web_container": "chenyida-erp-web-1", "worker_container": "chenyida-erp-worker-1",
    }
    if parameters["deployment_class"] != "UAT" or parameters["deployment_id"] != RUNTIME_COMPOSE_PROJECT \
            or parameters["compose_project"] != RUNTIME_COMPOSE_PROJECT \
            or any(parameters[field] != value for field, value in expected_containers.items()):
        reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_TARGET_INVALID")
    manifest = Path(absolute_path(
        parameters["release_manifest"], "SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_PATH_INVALID",
    ))
    absolute_path(parameters["compose_project_root"], "SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_PATH_INVALID")
    if manifest.name != "release-manifest.json" or manifest.parent.parent != RELEASE_ARTIFACT_ROOT_BASE:
        reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_PATH_INVALID")
    created = parse_time(parameters["verification_created_at"], "SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_TIME_INVALID")
    expires = parse_time(parameters["verification_expires_at"], "SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_TIME_INVALID")
    if expires <= created or expires - created > timedelta(minutes=15):
        reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_TIME_INVALID")
    deployment_result_path = UAT_PROMOTION_STATE_ROOT / "results" \
        / f"{parameters['deployment_operation_id']}.{parameters['deployment_result_sha256']}.json"
    transfer_path = UAT_PROMOTION_FENCE_TRANSFERS_ROOT \
        / f"{parameters['deployment_operation_id']}.{parameters['fence_transfer_sha256']}.json"
    sources = {
        "current": validate_uat_promotion_source(
            parameters["current_checkpoint_source"], UAT_PROMOTION_CURRENT_FILE, {"0400"}, 0,
            "SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_SOURCE_INVALID",
        ),
        "deployment": validate_uat_promotion_source(
            parameters["deployment_result_source"], deployment_result_path, {"0400"}, 0,
            "SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_SOURCE_INVALID",
        ),
        "transfer": validate_uat_promotion_source(
            parameters["fence_transfer_source"], transfer_path, {"0400"}, 0,
            "SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_SOURCE_INVALID",
        ),
        "manifest": validate_uat_promotion_source(
            parameters["release_manifest_source"], manifest, {"0440"}, 0,
            "SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_SOURCE_INVALID",
        ),
    }
    bindings = {"manifest": parameters["release_manifest_sha256"]}
    if any(sources[name]["sha256"] != expected for name, expected in bindings.items()):
        reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_SOURCE_BINDING_INVALID")
    if runtime:
        if len(parameters["probe_id"]) > 101 or Path(parameters["probe_root"]) != RUNTIME_PROBE_ROOT:
            reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_PATH_INVALID")
    else:
        runtime_intent_path = UAT_PROMOTION_STATE_ROOT / "intents" \
            / f"{parameters['runtime_probe_operation_id']}.{parameters['runtime_probe_intent_sha256']}.json"
        runtime_result_path = UAT_PROMOTION_STATE_ROOT / "results" \
            / f"{parameters['runtime_probe_operation_id']}.{parameters['runtime_probe_result_sha256']}.json"
        runtime_receipt_path = RUNTIME_PROBE_ROOT \
            / f"{parameters['runtime_probe_operation_id']}.runtime-configuration-probe.json"
        if parameters["runtime_probe_receipt"] != str(runtime_receipt_path) \
                or parameters["runtime_probe_receipt_sha256"] != parameters["runtime_probe_result_sha256"] \
                or parameters["postdeploy_root"] != str(POSTDEPLOY_ROOT_BASE / parameters["run_id"]) \
                or parameters["identity_root"] != str(RELEASE_IDENTITY_ROOT) or len(parameters["run_id"]) > 101:
            reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_PATH_INVALID")
        identity_sources = {
            "runtime_intent": validate_uat_promotion_source(
                parameters["runtime_probe_intent_source"], runtime_intent_path, {"0400"}, 0,
                "SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_SOURCE_INVALID",
            ),
            "runtime_result": validate_uat_promotion_source(
                parameters["runtime_probe_result_source"], runtime_result_path, {"0400"}, 0,
                "SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_SOURCE_INVALID",
            ),
            "runtime_receipt": validate_uat_promotion_source(
                parameters["runtime_probe_receipt_source"], runtime_receipt_path, {"0400"}, 0,
                "SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_SOURCE_INVALID",
            ),
        }
        if identity_sources["runtime_result"]["sha256"] != parameters["runtime_probe_result_sha256"] \
                or identity_sources["runtime_receipt"]["sha256"] != parameters["runtime_probe_receipt_sha256"]:
            reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_SOURCE_BINDING_INVALID")
    if recovery:
        original_id = parameters["original_operation_id"]
        if not isinstance(original_id, str) or not IDENTIFIER.fullmatch(original_id) \
                or original_id in (parameters["promotion_id"], parameters["deployment_operation_id"]):
            reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_IDENTIFIER_INVALID")
    return parameters


def validate_uat_promotion_parameters(parameters: Any, operation: str | None = None) -> dict[str, Any]:
    if operation in ("VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION", "VERIFY_UAT_POSTDEPLOY_IDENTITY") \
            or operation == "RECOVER_UAT_PROMOTION" and isinstance(parameters, dict) \
            and parameters.get("original_operation") in ("POSTDEPLOY_RUNTIME_CONFIGURATION", "POSTDEPLOY_IDENTITY"):
        return validate_uat_promotion_postdeploy_parameters(parameters, operation)
    if operation == "CAPTURE_UAT_PROMOTION_SNAPSHOT" \
            or operation == "RECOVER_UAT_PROMOTION" and isinstance(parameters, dict) and parameters.get("original_operation") == "CAPTURE_SNAPSHOT":
        return validate_uat_promotion_snapshot_parameters(parameters, operation)
    if operation == "QUIESCE_UAT_WRITERS" \
            or operation == "RECOVER_UAT_PROMOTION" and isinstance(parameters, dict) and parameters.get("original_operation") == "QUIESCE_WRITERS":
        return validate_uat_promotion_quiesce_parameters(parameters, operation)
    if operation == "AUTHORIZE_UAT_PROMOTION_MIGRATION" \
            or operation == "RECOVER_UAT_PROMOTION" and isinstance(parameters, dict) and parameters.get("original_operation") == "MIGRATION_AUTHORIZATION":
        return validate_uat_promotion_migration_authorization_parameters(parameters, operation)
    if operation == "RUN_UAT_PROMOTION_MIGRATION" \
            or operation == "RECOVER_UAT_PROMOTION" and isinstance(parameters, dict) and parameters.get("original_operation") == "MIGRATION_EXECUTION":
        return validate_uat_promotion_migration_execution_parameters(parameters, operation)
    if operation == "DEPLOY_UAT_RELEASE" \
            or operation == "RECOVER_UAT_PROMOTION" and isinstance(parameters, dict) and parameters.get("original_operation") == "COMPOSE_DEPLOYMENT":
        return validate_uat_promotion_compose_deployment_parameters(parameters, operation)
    return validate_uat_promotion_begin_parameters(parameters, operation)


def validate_monitoring_projection_parameters(operation: str, parameters: dict[str, Any]) -> None:
    if absolute_path(parameters["projection_root"], "SUPERVISOR_MONITORING_PROJECTION_PATH_INVALID") != str(MONITORING_PROJECTION_ROOT):
        reject("SUPERVISOR_MONITORING_PROJECTION_PATH_INVALID")
    for field in ("projection_reader_gid", "projection_generation"):
        if not isinstance(parameters[field], int) or isinstance(parameters[field], bool) or not 1 <= parameters[field] <= 2**31 - 1:
            reject("SUPERVISOR_MONITORING_PROJECTION_INTEGER_INVALID")
    for field in ("previous_projection_sha256", "expected_source_sha256", "expected_projection_sha256"):
        if not isinstance(parameters[field], str) or not SHA256.fullmatch(parameters[field]):
            reject("SUPERVISOR_MONITORING_PROJECTION_DIGEST_INVALID")
    if (parameters["projection_generation"] == 1) != (parameters["previous_projection_sha256"] == "0" * 64):
        reject("SUPERVISOR_MONITORING_PROJECTION_GENERATION_INVALID")
    parse_time(parameters["projection_published_at"], "SUPERVISOR_MONITORING_PROJECTION_TIME_INVALID")
    validate_monitoring_projection_source(parameters["active_source"], MONITORING_ACTIVE_FILE, {"0444"}, 0)
    validate_monitoring_projection_source(parameters["host_config_source"], MONITORING_PRIVATE_CONFIG, {"0400"}, 0)
    validate_monitoring_projection_source(parameters["release_identity_source"], RELEASE_IDENTITY_FILE, {"0440"})
    receipt_source = parameters["postdeploy_receipt_source"]
    if not isinstance(receipt_source, dict) or not isinstance(receipt_source.get("path"), str):
        reject("SUPERVISOR_MONITORING_PROJECTION_SOURCE_INVALID")
    receipt_path = Path(receipt_source["path"])
    if receipt_path.parent.parent != POSTDEPLOY_ROOT_BASE or not IDENTIFIER.fullmatch(receipt_path.parent.name) or receipt_path.name != f"{receipt_path.parent.name}.postdeploy-receipt.json":
        reject("SUPERVISOR_MONITORING_PROJECTION_SOURCE_PATH_INVALID")
    validate_monitoring_projection_source(receipt_source, receipt_path, {"0440"}, 0)
    if operation == "PUBLISH_MONITORING_BACKUP_PROJECTION":
        validate_monitoring_projection_source(parameters["backup_readiness_source"], MONITORING_BACKUP_READINESS_FILE, {"0640"})
        validate_monitoring_projection_source(parameters["cluster_policy_source"], MONITORING_CLUSTER_POLICY_FILE, {"0440"}, 0)
        validate_monitoring_projection_source(parameters["cluster_policy_activation_source"], CLUSTER_POLICY_CURRENT_FILE, {"0400"}, 0)
        for field, parent in (("cluster_policy_history_source", CLUSTER_POLICY_STATE_ROOT / "history"), ("cluster_policy_receipt_source", CLUSTER_POLICY_STATE_ROOT / "receipts")):
            source = parameters[field]
            if not isinstance(source, dict) or not isinstance(source.get("path"), str):
                reject("SUPERVISOR_MONITORING_PROJECTION_SOURCE_INVALID")
            source_path = Path(source["path"])
            if source_path.parent != parent or not re.fullmatch(r"[0-9]{16}\.[0-9a-f]{64}\.json", source_path.name):
                reject("SUPERVISOR_MONITORING_PROJECTION_SOURCE_PATH_INVALID")
            validate_monitoring_projection_source(source, source_path, {"0400"}, 0)


def validate_parameters(operation: str, parameters: Any) -> dict[str, Any]:
    parameters = exact_fields(parameters, PARAMETER_FIELDS[operation], "SUPERVISOR_AUTHORIZATION_PARAMETERS_INVALID")
    for key in ("artifact_root", "postdeploy_root", "identity_root", "release_manifest", "probe_root", "runtime_probe_receipt", "candidate_snapshot_receipt", "gate_plan", "gate_report", "sbom_evidence", "security_evidence", "trivy_db_directory", "repository_root", "test_runtime_root", "compose_project_root", "host_config", "runtime_path"):
        if key in parameters:
            absolute_path(parameters[key], "SUPERVISOR_AUTHORIZATION_PATH_INVALID")
    for key in ("run_id", "probe_id", "release_id", "deployment_id", "compose_project", "caddy_container", "postgres_container", "web_container", "worker_container", "activation_id", "disable_id"):
        if key in parameters and (not isinstance(parameters[key], str) or not IDENTIFIER.fullmatch(parameters[key])):
            reject("SUPERVISOR_AUTHORIZATION_IDENTIFIER_INVALID")
    for key in ("web_image", "worker_image"):
        if key in parameters and (not isinstance(parameters[key], str) or not IMAGE_REFERENCE.fullmatch(parameters[key])):
            reject("SUPERVISOR_AUTHORIZATION_IMAGE_INVALID")
    if "web_image" in parameters and parameters["web_image"] == parameters["worker_image"]:
        reject("SUPERVISOR_AUTHORIZATION_IMAGE_INVALID")
    for key in ("git_commit", "git_tree"):
        if key in parameters and (not isinstance(parameters[key], str) or not GIT_OBJECT.fullmatch(parameters[key])):
            reject("SUPERVISOR_AUTHORIZATION_GIT_INVALID")
    for key in ("release_manifest_sha256", "runtime_probe_receipt_sha256", "candidate_snapshot_receipt_sha256", "gate_plan_sha256", "runtime_policy_sha256", "runtime_configuration_sha256", "monitoring_bundle_sha256", "host_config_sha256", "runtime_sha256", "previous_activation_sha256", "supervisor_bundle_sha256", "rollback_target_activation_sha256", "expected_active_sha256"):
        if key in parameters and (not isinstance(parameters[key], str) or not SHA256.fullmatch(parameters[key])):
            reject("SUPERVISOR_AUTHORIZATION_DIGEST_INVALID")
    if "reader_gid" in parameters and (not isinstance(parameters["reader_gid"], int) or isinstance(parameters["reader_gid"], bool) or parameters["reader_gid"] < 1 or parameters["reader_gid"] > 2**31 - 1):
        reject("SUPERVISOR_AUTHORIZATION_GID_INVALID")
    for key in ("runtime_bytes", "runtime_dev", "runtime_ino", "evaluator_uid", "evaluator_gid", "notifier_uid", "notifier_gid", "installation_generation"):
        if key in parameters and (not isinstance(parameters[key], int) or isinstance(parameters[key], bool) or parameters[key] < 1 or parameters[key] > 2**63 - 1):
            reject("SUPERVISOR_AUTHORIZATION_INTEGER_INVALID")
    if "runtime_bytes" in parameters and parameters["runtime_bytes"] > MAX_MONITOR_RUNTIME_BYTES:
        reject("SUPERVISOR_MONITORING_RUNTIME_SIZE_INVALID")
    if operation in ("INSTALL_MONITORING_HOST_DELIVERY", "ROLLBACK_MONITORING_HOST_DELIVERY"):
        if parameters["evaluator_uid"] == parameters["notifier_uid"] or parameters["evaluator_gid"] == parameters["notifier_gid"] or parameters["supervisor_bundle_sha256"] == parameters["monitoring_bundle_sha256"]:
            reject("SUPERVISOR_MONITORING_IDENTITY_INVALID")
        config = Path(parameters["host_config"])
        runtime = Path(parameters["runtime_path"])
        if config.parent != MONITORING_HOST_CONFIG_INPUT_ROOT or not config.name.endswith(".monitoring-host-config.json") or runtime.parent != MONITORING_HOST_RUNTIME_INPUT_ROOT or runtime.name != f"node.{parameters['runtime_sha256']}":
            reject("SUPERVISOR_MONITORING_INPUT_PATH_INVALID")
        if operation == "ROLLBACK_MONITORING_HOST_DELIVERY" and parameters["rollback_target_activation_sha256"] in (parameters["previous_activation_sha256"], "0" * 64):
            reject("SUPERVISOR_MONITORING_ROLLBACK_INVALID")
    if "deployment_class" in parameters and parameters["deployment_class"] not in ("UAT", "PRODUCTION"):
        reject("SUPERVISOR_AUTHORIZATION_DEPLOYMENT_CLASS_INVALID")
    if "expires_at" in parameters:
        parse_time(parameters["expires_at"], "SUPERVISOR_AUTHORIZATION_RELEASE_EXPIRY_INVALID")
    if "runtime_guard_contract" in parameters and parameters["runtime_guard_contract"] != RUNTIME_GUARD_CONTRACT:
        reject("SUPERVISOR_AUTHORIZATION_RUNTIME_GUARD_INVALID")
    if operation in ("RUN_RELEASE_GATE", "CREATE_RELEASE_MANIFEST") and parameters.get("runtime_guard_mode") != PRE_DEPLOY_RUNTIME_GUARD_MODE:
        reject("SUPERVISOR_AUTHORIZATION_RUNTIME_GUARD_INVALID")
    if operation in ("PROBE_POST_DEPLOY_RUNTIME_CONFIGURATION", "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY"):
        identifier_field = "probe_id" if operation == "PROBE_POST_DEPLOY_RUNTIME_CONFIGURATION" else "run_id"
        if len(parameters[identifier_field]) > 101:
            reject("SUPERVISOR_AUTHORIZATION_IDENTIFIER_INVALID")
        if parameters.get("runtime_guard_mode") != POST_DEPLOY_RUNTIME_GUARD_MODE or parameters.get("runtime_policy_sha256") != RUNTIME_POLICY_SHA256:
            reject("SUPERVISOR_AUTHORIZATION_RUNTIME_GUARD_INVALID")
        if parameters["deployment_id"] != RUNTIME_COMPOSE_PROJECT or parameters["compose_project"] != RUNTIME_COMPOSE_PROJECT or len({parameters["caddy_container"], parameters["postgres_container"], parameters["web_container"], parameters["worker_container"]}) != 4:
            reject("SUPERVISOR_AUTHORIZATION_DEPLOYMENT_IDENTITY_INVALID")
        manifest = Path(parameters["release_manifest"])
        if manifest.parent.parent != RELEASE_ARTIFACT_ROOT_BASE:
            reject("SUPERVISOR_AUTHORIZATION_POSTDEPLOY_PATH_INVALID")
    if operation == "PROBE_POST_DEPLOY_RUNTIME_CONFIGURATION":
        if Path(parameters["probe_root"]) != RUNTIME_PROBE_ROOT:
            reject("SUPERVISOR_AUTHORIZATION_POSTDEPLOY_PATH_INVALID")
    if operation == "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY":
        postdeploy = Path(parameters["postdeploy_root"])
        probe_receipt = Path(parameters["runtime_probe_receipt"])
        if postdeploy.parent != POSTDEPLOY_ROOT_BASE or postdeploy.name != parameters["run_id"] or Path(parameters["identity_root"]) != RELEASE_IDENTITY_ROOT \
            or probe_receipt.parent != RUNTIME_PROBE_ROOT or not probe_receipt.name.endswith(".runtime-configuration-probe.json"):
            reject("SUPERVISOR_AUTHORIZATION_POSTDEPLOY_PATH_INVALID")
    if operation in ("PUBLISH_MONITORING_COMPONENTS_PROJECTION", "PUBLISH_MONITORING_BACKUP_PROJECTION"):
        validate_monitoring_projection_parameters(operation, parameters)
    return parameters


def validate_runtime_privilege_parameters(parameters: Any, operation: str | None = None) -> dict[str, Any]:
    recovery = operation == "RECOVER_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT"
    if recovery:
        if not isinstance(parameters, dict) or parameters.get("original_operation") not in ("BOOTSTRAP", "RECONCILE"):
            reject("SUPERVISOR_RUNTIME_PRIVILEGE_OPERATION_INVALID")
        effective_operation = parameters["original_operation"]
    else:
        effective_operation = RUNTIME_PRIVILEGE_OPERATIONS.get(operation or "")
    if effective_operation not in ("BOOTSTRAP", "RECONCILE"):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_OPERATION_INVALID")
    expected_fields = set(RUNTIME_PRIVILEGE_BASE_PARAMETER_FIELDS)
    if effective_operation == "RECONCILE":
        expected_fields |= RUNTIME_PRIVILEGE_POSTDEPLOY_PARAMETER_FIELDS - RUNTIME_PRIVILEGE_BASE_PARAMETER_FIELDS
    if recovery:
        expected_fields |= RUNTIME_PRIVILEGE_RECOVERY_PARAMETER_FIELDS
    parameters = exact_fields(parameters, expected_fields, "SUPERVISOR_RUNTIME_PRIVILEGE_PARAMETERS_INVALID")
    path_fields = ["backup_root", "backup_credential_root", "backup_capture_service_file", "compose_project_root", "release_manifest"]
    if effective_operation == "RECONCILE":
        path_fields.append("runtime_probe_receipt")
    for field in path_fields:
        absolute_path(parameters[field], "SUPERVISOR_RUNTIME_PRIVILEGE_PATH_INVALID")
    for field in ("backup_capture_service", "credential_generation_id", "deployment_id", "postgres_container"):
        if not isinstance(parameters[field], str) or not IDENTIFIER.fullmatch(parameters[field]):
            reject("SUPERVISOR_RUNTIME_PRIVILEGE_IDENTIFIER_INVALID")
    digest_fields = ["postgres_container_id", "release_manifest_sha256", "runtime_configuration_sha256", "runtime_policy_sha256"]
    if effective_operation == "RECONCILE":
        digest_fields.append("runtime_probe_receipt_sha256")
    for field in digest_fields:
        if not isinstance(parameters[field], str) or not SHA256.fullmatch(parameters[field]):
            reject("SUPERVISOR_RUNTIME_PRIVILEGE_DIGEST_INVALID")
    if parameters["deployment_class"] not in ("UAT", "PRODUCTION") or parameters["deployment_id"] != RUNTIME_COMPOSE_PROJECT:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_DEPLOYMENT_INVALID")
    if recovery:
        if not isinstance(parameters["original_operation_id"], str) or not IDENTIFIER.fullmatch(parameters["original_operation_id"]):
            reject("SUPERVISOR_RUNTIME_PRIVILEGE_IDENTIFIER_INVALID")
        for field in ("expected_intent_sha256", "original_authorization_sha256"):
            if not isinstance(parameters[field], str) or not SHA256.fullmatch(parameters[field]):
                reject("SUPERVISOR_RUNTIME_PRIVILEGE_DIGEST_INVALID")
    if parameters["runtime_policy_sha256"] != RUNTIME_POLICY_SHA256 or parameters["expected_database"] != "chenyida_erp":
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_TARGET_INVALID")
    expected_guard_mode = PRE_DEPLOY_POSTGRESQL_BOOTSTRAP_GUARD_MODE if effective_operation == "BOOTSTRAP" else POST_DEPLOY_RUNTIME_GUARD_MODE
    if parameters["runtime_guard_mode"] != expected_guard_mode:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RUNTIME_GUARD_INVALID")
    if Path(parameters["backup_root"]) != RUNTIME_PRIVILEGE_BACKUP_ROOT:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_BACKUP_ROOT_INVALID")
    backup_credential_root = Path(parameters["backup_credential_root"])
    backup_capture_file = Path(parameters["backup_capture_service_file"])
    if backup_capture_file.parent != backup_credential_root or backup_capture_file.name == ".chenyida-erp-credential-root-v2":
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_BACKUP_CREDENTIAL_INVALID")
    manifest = Path(parameters["release_manifest"])
    if manifest.name != "release-manifest.json" or manifest.parent.parent != RELEASE_ARTIFACT_ROOT_BASE:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RELEASE_MANIFEST_INVALID")
    if not isinstance(parameters["expected_database_oid"], str) or not re.fullmatch(r"[1-9][0-9]{0,9}", parameters["expected_database_oid"]):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_TARGET_INVALID")
    if not isinstance(parameters["expected_system_identifier"], str) or not re.fullmatch(r"[1-9][0-9]{9,29}", parameters["expected_system_identifier"]):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_TARGET_INVALID")
    expected_marker = f"chenyida-erp-deployment/v2:{parameters['deployment_class']}:{parameters['deployment_id']}"
    if parameters["expected_database_marker"] != expected_marker:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_TARGET_INVALID")
    if effective_operation == "RECONCILE":
        receipt = Path(parameters["runtime_probe_receipt"])
        if receipt.parent != RUNTIME_PROBE_ROOT or not receipt.name.endswith(".runtime-configuration-probe.json"):
            reject("SUPERVISOR_RUNTIME_PRIVILEGE_PATH_INVALID")
    return parameters


def validate_authorization(value: Any, expected_bundle_digest: str, now: datetime) -> dict[str, Any]:
    value = exact_fields(value, {"schema_version", "contract", "authorization_id", "created_at", "expires_at", "supervisor_bundle_sha256", "operation", "parameters", "nonce", "confirmation"}, "SUPERVISOR_AUTHORIZATION_FIELDS_INVALID")
    is_v2 = value["schema_version"] == 2 and value["contract"] == AUTHORIZATION_CONTRACT
    is_v3 = value["schema_version"] == 3 and value["contract"] == RUNTIME_PRIVILEGE_AUTHORIZATION_CONTRACT
    is_v4 = value["schema_version"] == 4 and value["contract"] == CLUSTER_POLICY_AUTHORIZATION_CONTRACT
    is_v5 = value["schema_version"] == 5 and value["contract"] == NOTIFIER_EGRESS_AUTHORIZATION_CONTRACT
    is_v6 = value["schema_version"] == 6 and value["contract"] == UAT_PROMOTION_AUTHORIZATION_CONTRACT
    if not is_v2 and not is_v3 and not is_v4 and not is_v5 and not is_v6:
        reject("SUPERVISOR_AUTHORIZATION_VERSION_INVALID")
    if not isinstance(value["authorization_id"], str) or not IDENTIFIER.fullmatch(value["authorization_id"]):
        reject("SUPERVISOR_AUTHORIZATION_ID_INVALID")
    if not isinstance(value["supervisor_bundle_sha256"], str) or value["supervisor_bundle_sha256"] != expected_bundle_digest:
        reject("SUPERVISOR_AUTHORIZATION_BUNDLE_MISMATCH")
    operation = value["operation"]
    if is_v2:
        if operation not in ENTRYPOINTS or value["confirmation"] != CONFIRMATIONS[operation]:
            reject("SUPERVISOR_AUTHORIZATION_OPERATION_INVALID")
    elif is_v3 and (operation not in RUNTIME_PRIVILEGE_OPERATIONS or value["confirmation"] != RUNTIME_PRIVILEGE_CONFIRMATIONS[operation]):
        reject("SUPERVISOR_AUTHORIZATION_OPERATION_INVALID")
    elif is_v4 and (operation not in CLUSTER_POLICY_OPERATIONS or value["confirmation"] != CLUSTER_POLICY_CONFIRMATIONS[operation]):
        reject("SUPERVISOR_AUTHORIZATION_OPERATION_INVALID")
    elif is_v5 and (operation not in NOTIFIER_EGRESS_OPERATIONS or value["confirmation"] != NOTIFIER_EGRESS_CONFIRMATIONS[operation]):
        reject("SUPERVISOR_AUTHORIZATION_OPERATION_INVALID")
    elif is_v6 and (operation not in UAT_PROMOTION_OPERATIONS or value["confirmation"] != UAT_PROMOTION_CONFIRMATIONS[operation]):
        reject("SUPERVISOR_AUTHORIZATION_OPERATION_INVALID")
    if not isinstance(value["nonce"], str) or not SHA256.fullmatch(value["nonce"]):
        reject("SUPERVISOR_AUTHORIZATION_NONCE_INVALID")
    created = parse_time(value["created_at"], "SUPERVISOR_AUTHORIZATION_TIME_INVALID")
    expires = parse_time(value["expires_at"], "SUPERVISOR_AUTHORIZATION_TIME_INVALID")
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    now = now.astimezone(timezone.utc)
    if created > now + timedelta(minutes=5) or now >= expires or expires <= created or expires - created > timedelta(hours=24) or now - created > timedelta(hours=24):
        reject("SUPERVISOR_AUTHORIZATION_TIME_INVALID")
    if is_v2:
        validate_parameters(operation, value["parameters"])
        if operation in ("PUBLISH_MONITORING_COMPONENTS_PROJECTION", "PUBLISH_MONITORING_BACKUP_PROJECTION"):
            published = parse_time(value["parameters"]["projection_published_at"], "SUPERVISOR_MONITORING_PROJECTION_TIME_INVALID")
            if published >= expires or published > now + timedelta(minutes=5):
                reject("SUPERVISOR_MONITORING_PROJECTION_TIME_INVALID")
    elif is_v3:
        validate_runtime_privilege_parameters(value["parameters"], operation)
        if operation == "RECOVER_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT" and value["authorization_id"] == value["parameters"]["original_operation_id"]:
            reject("SUPERVISOR_RUNTIME_PRIVILEGE_IDENTIFIER_INVALID")
    elif is_v4:
        parameters = validate_cluster_policy_parameters(value["parameters"], operation)
        recovery = operation == "RECOVER_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2_ACTIVATION"
        activated = parse_time(parameters["activated_at"], "SUPERVISOR_CLUSTER_POLICY_TIME_INVALID")
        policy_expires = parse_time(parameters["policy_expires_at"], "SUPERVISOR_CLUSTER_POLICY_TIME_INVALID")
        if recovery:
            if value["authorization_id"] in (parameters["activation_id"], parameters["original_operation_id"]) \
                or created < activated:
                reject("SUPERVISOR_CLUSTER_POLICY_TIME_INVALID")
        elif value["authorization_id"] != parameters["activation_id"] \
            or abs(activated - created) > timedelta(minutes=5) or activated > now + timedelta(minutes=5) \
            or policy_expires > expires:
            reject("SUPERVISOR_CLUSTER_POLICY_TIME_INVALID")
    elif is_v5:
        parameters = validate_notifier_egress_parameters(value["parameters"], operation)
        recovery = operation == "RECOVER_MONITORING_NOTIFIER_EGRESS_V1_ACTIVATION"
        activated = parse_time(parameters["activated_at"], "SUPERVISOR_NOTIFIER_EGRESS_TIME_INVALID")
        policy_expires = parse_time(parameters["expires_at"], "SUPERVISOR_NOTIFIER_EGRESS_TIME_INVALID")
        if recovery:
            if value["authorization_id"] in (parameters["activation_id"], parameters["original_operation_id"]) or created < activated:
                reject("SUPERVISOR_NOTIFIER_EGRESS_TIME_INVALID")
        elif value["authorization_id"] != parameters["activation_id"] \
            or abs(activated - created) > timedelta(minutes=5) or activated > now + timedelta(minutes=5) \
            or policy_expires > expires:
            reject("SUPERVISOR_NOTIFIER_EGRESS_TIME_INVALID")
    else:
        parameters = validate_uat_promotion_parameters(value["parameters"], operation)
        snapshot_operation = operation == "CAPTURE_UAT_PROMOTION_SNAPSHOT" \
            or operation == "RECOVER_UAT_PROMOTION" and parameters.get("original_operation") == "CAPTURE_SNAPSHOT"
        quiesce_operation = operation == "QUIESCE_UAT_WRITERS" \
            or operation == "RECOVER_UAT_PROMOTION" and parameters.get("original_operation") == "QUIESCE_WRITERS"
        migration_authorization_operation = operation == "AUTHORIZE_UAT_PROMOTION_MIGRATION" \
            or operation == "RECOVER_UAT_PROMOTION" and parameters.get("original_operation") == "MIGRATION_AUTHORIZATION"
        migration_execution_operation = operation == "RUN_UAT_PROMOTION_MIGRATION" \
            or operation == "RECOVER_UAT_PROMOTION" and parameters.get("original_operation") == "MIGRATION_EXECUTION"
        compose_deployment_operation = operation == "DEPLOY_UAT_RELEASE" \
            or operation == "RECOVER_UAT_PROMOTION" and parameters.get("original_operation") == "COMPOSE_DEPLOYMENT"
        postdeploy_runtime_operation = operation == "VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION" \
            or operation == "RECOVER_UAT_PROMOTION" \
            and parameters.get("original_operation") == "POSTDEPLOY_RUNTIME_CONFIGURATION"
        postdeploy_identity_operation = operation == "VERIFY_UAT_POSTDEPLOY_IDENTITY" \
            or operation == "RECOVER_UAT_PROMOTION" and parameters.get("original_operation") == "POSTDEPLOY_IDENTITY"
        window_created = parse_time(
            parameters["snapshot_created_at"] if snapshot_operation else parameters["quiesce_created_at"] if quiesce_operation
            else parameters["authorization_created_at"] if migration_authorization_operation
            else parameters["execution_created_at"] if migration_execution_operation
            else parameters["deployment_created_at"] if compose_deployment_operation
            else parameters["verification_created_at"] if postdeploy_runtime_operation or postdeploy_identity_operation
            else parameters["promotion_created_at"],
            "SUPERVISOR_UAT_PROMOTION_TIME_INVALID",
        )
        window_expires = parse_time(
            parameters["snapshot_expires_at"] if snapshot_operation else parameters["quiesce_expires_at"] if quiesce_operation
            else parameters["authorization_expires_at"] if migration_authorization_operation
            else parameters["execution_expires_at"] if migration_execution_operation
            else parameters["deployment_expires_at"] if compose_deployment_operation
            else parameters["verification_expires_at"] if postdeploy_runtime_operation or postdeploy_identity_operation
            else parameters["promotion_expires_at"],
            "SUPERVISOR_UAT_PROMOTION_TIME_INVALID",
        )
        if expires - created > timedelta(hours=1):
            reject("SUPERVISOR_UAT_PROMOTION_TIME_INVALID")
        if operation == "RECOVER_UAT_PROMOTION":
            if value["authorization_id"] in (parameters["promotion_id"], parameters["original_operation_id"]) \
                or created < window_created:
                reject("SUPERVISOR_UAT_PROMOTION_TIME_INVALID")
        elif operation == "BEGIN_UAT_PROMOTION" and (value["authorization_id"] != parameters["promotion_id"] \
            or abs(window_created - created) > timedelta(minutes=5) \
            or window_created > now + timedelta(minutes=5) or window_expires > expires):
            reject("SUPERVISOR_UAT_PROMOTION_TIME_INVALID")
        elif operation == "CAPTURE_UAT_PROMOTION_SNAPSHOT" and (value["authorization_id"] == parameters["promotion_id"] \
            or abs(window_created - created) > timedelta(minutes=5) \
            or window_created > now + timedelta(minutes=5) or window_expires > expires):
            reject("SUPERVISOR_UAT_PROMOTION_TIME_INVALID")
        elif operation == "QUIESCE_UAT_WRITERS" and (value["authorization_id"] in (
                parameters["promotion_id"], parameters["snapshot_operation_id"])
                or abs(window_created - created) > timedelta(minutes=5)
                or window_created > now + timedelta(minutes=5) or window_expires > expires):
            reject("SUPERVISOR_UAT_PROMOTION_TIME_INVALID")
        elif operation == "AUTHORIZE_UAT_PROMOTION_MIGRATION" and (value["authorization_id"] in (
                parameters["promotion_id"], parameters["quiesce_operation_id"])
                or abs(window_created - created) > timedelta(minutes=5)
                or window_created > now + timedelta(minutes=5) or window_expires > expires):
            reject("SUPERVISOR_UAT_PROMOTION_TIME_INVALID")
        elif operation == "RUN_UAT_PROMOTION_MIGRATION" and (value["authorization_id"] in (
                parameters["promotion_id"], parameters["migration_authorization_operation_id"])
                or sha256(canonical_json(value)) == parameters["migration_approval_authorization_sha256"]
                or abs(window_created - created) > timedelta(minutes=5)
                or window_created > now + timedelta(minutes=5) or window_expires > expires):
            reject("SUPERVISOR_UAT_PROMOTION_TIME_INVALID")
        elif operation == "DEPLOY_UAT_RELEASE" and (value["authorization_id"] in (
                parameters["promotion_id"], parameters["migration_operation_id"])
                or sha256(canonical_json(value)) == parameters["migration_execution_authorization_sha256"]
                or abs(window_created - created) > timedelta(minutes=5)
                or window_created > now + timedelta(minutes=5) or window_expires > expires):
            reject("SUPERVISOR_UAT_PROMOTION_TIME_INVALID")
        elif operation == "VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION" and (
                value["authorization_id"] != parameters["probe_id"]
                or value["authorization_id"] in (parameters["promotion_id"], parameters["deployment_operation_id"])
                or abs(window_created - created) > timedelta(minutes=5)
                or window_created > now + timedelta(minutes=5) or window_expires > expires):
            reject("SUPERVISOR_UAT_PROMOTION_TIME_INVALID")
        elif operation == "VERIFY_UAT_POSTDEPLOY_IDENTITY" and (
                value["authorization_id"] != parameters["run_id"]
                or value["authorization_id"] in (
                    parameters["promotion_id"], parameters["deployment_operation_id"],
                    parameters["runtime_probe_operation_id"],
                ) or abs(window_created - created) > timedelta(minutes=5)
                or window_created > now + timedelta(minutes=5) or window_expires > expires):
            reject("SUPERVISOR_UAT_PROMOTION_TIME_INVALID")
    return value


def load_authorization(path: Path, expected_bundle_digest: str, pending_root: Path = AUTHORIZATION_PENDING_ROOT, now: datetime | None = None) -> tuple[dict[str, Any], str, bytes]:
    if pending_root == AUTHORIZATION_PENDING_ROOT:
        trusted_directory(AUTHORIZATION_ROOT, {0o700}, "SUPERVISOR_AUTHORIZATION_ROOT_INVALID")
    trusted_directory(pending_root, {0o700}, "SUPERVISOR_AUTHORIZATION_ROOT_INVALID")
    if not path.is_absolute() or path.parent != pending_root or path.name != Path(path.name).name:
        reject("SUPERVISOR_AUTHORIZATION_PATH_INVALID")
    raw, _ = trusted_regular_file(path, 0o400, code="SUPERVISOR_AUTHORIZATION_FILE_INVALID")
    value = validate_authorization(strict_json(raw, "SUPERVISOR_AUTHORIZATION_JSON_INVALID"), expected_bundle_digest, now or datetime.now(timezone.utc))
    if raw != canonical_json(value) or path.name != f"{value['authorization_id']}.json":
        reject("SUPERVISOR_AUTHORIZATION_NOT_CANONICAL")
    return value, sha256(raw), raw


def verify_candidate_snapshot(parameters: dict[str, Any], bundle_root: Path, lock_descriptor: int) -> None:
    verifier = bundle_root / "chenyida_erp_site/scripts/release-candidate-snapshot.py"
    environment = {
        "PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent",
        "PYTHONDONTWRITEBYTECODE": "1", "PYTHONHASHSEED": "0",
        "ERP_RELEASE_SUPERVISOR_LAUNCHED": "YES", "ERP_RELEASE_GATE_LOCK_HELD": "YES",
        "ERP_RELEASE_GATE_LOCK_FD": str(lock_descriptor),
    }
    command = [
        "/usr/bin/python3", str(verifier), "verify",
        "--receipt", parameters["candidate_snapshot_receipt"],
        "--receipt-sha256", parameters["candidate_snapshot_receipt_sha256"],
        "--repository-root", parameters["repository_root"],
        "--git-commit", parameters["git_commit"], "--git-tree", parameters["git_tree"],
        "--test-runtime-root", parameters["test_runtime_root"], "--bundle-root", str(bundle_root),
        "--confirm", "VERIFY_EXACT_RELEASE_CANDIDATE_SNAPSHOT",
    ]
    try:
        result = subprocess.run(command, env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, timeout=900, pass_fds=(lock_descriptor,))
    except (OSError, subprocess.SubprocessError):
        reject("SUPERVISOR_CANDIDATE_SNAPSHOT_INVALID")
    if result.returncode != 0 or result.stderr != b"" or len(result.stdout) < 2 or len(result.stdout) > 4096:
        reject("SUPERVISOR_CANDIDATE_SNAPSHOT_INVALID")
    response = strict_json(result.stdout, "SUPERVISOR_CANDIDATE_SNAPSHOT_INVALID")
    if result.stdout != canonical_json(response) or set(response) != {"result", "snapshot_id", "receipt_sha256"} or response.get("result") != "VERIFIED" or response.get("receipt_sha256") != parameters["candidate_snapshot_receipt_sha256"] or not isinstance(response.get("snapshot_id"), str) or not IDENTIFIER.fullmatch(response["snapshot_id"]):
        reject("SUPERVISOR_CANDIDATE_SNAPSHOT_INVALID")


def verify_candidate(parameters: dict[str, Any], bundle_root: Path, lock_descriptor: int) -> None:
    if "repository_root" not in parameters:
        return
    repository = Path(parameters["repository_root"])
    if not repository.is_dir() or repository.resolve() != repository:
        reject("SUPERVISOR_CANDIDATE_ROOT_INVALID")
    for candidate in (repository, repository / ".git"):
        value = os.lstat(candidate)
        if stat.S_ISLNK(value.st_mode) or value.st_uid != 0 or value.st_gid != 0 or stat.S_IMODE(value.st_mode) & 0o022:
            reject("SUPERVISOR_CANDIDATE_OWNERSHIP_INVALID")
    environment = {"PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_NO_REPLACE_OBJECTS": "1", "GIT_OPTIONAL_LOCKS": "0"}
    git_prefix = ["/usr/bin/git", "-c", "core.useReplaceRefs=false", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", f"safe.directory={repository}", "-C", str(repository)]

    def git(*arguments: str) -> str:
        result = subprocess.run([*git_prefix, *arguments], env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False, text=True)
        if result.returncode != 0:
            reject("SUPERVISOR_CANDIDATE_GIT_INVALID")
        return result.stdout.strip()

    if git("rev-parse", "--show-toplevel") != str(repository) or git("rev-parse", "--verify", "HEAD^{commit}") != parameters["git_commit"] or git("rev-parse", "--verify", "HEAD^{tree}") != parameters["git_tree"]:
        reject("SUPERVISOR_CANDIDATE_GIT_MISMATCH")
    if subprocess.run([*git_prefix, "diff", "--quiet", "--no-ext-diff", "--no-textconv", "--"], env=environment, stdin=subprocess.DEVNULL, check=False).returncode != 0:
        reject("SUPERVISOR_CANDIDATE_DIRTY")
    if subprocess.run([*git_prefix, "diff", "--cached", "--quiet", "--no-ext-diff", "--no-textconv", "--"], env=environment, stdin=subprocess.DEVNULL, check=False).returncode != 0:
        reject("SUPERVISOR_CANDIDATE_DIRTY")
    if git("ls-files", "--others", "--exclude-standard", "--", "chenyida_erp_site"):
        reject("SUPERVISOR_CANDIDATE_DIRTY")
    verify_candidate_snapshot(parameters, bundle_root, lock_descriptor)


def command_for(bundle_root: Path, authorization: dict[str, Any]) -> list[str]:
    operation = authorization["operation"]
    parameters = authorization["parameters"]
    entrypoint = str(bundle_root / ENTRYPOINTS[operation])
    command = [entrypoint]
    if operation in ("INSTALL_MONITORING_HOST_DELIVERY", "ROLLBACK_MONITORING_HOST_DELIVERY"):
        command = ["/usr/bin/python3", entrypoint, "rollback" if operation == "ROLLBACK_MONITORING_HOST_DELIVERY" else "install"]
        for name in (
            "monitoring_bundle_sha256", "host_config", "host_config_sha256", "runtime_path", "runtime_sha256",
            "runtime_bytes", "runtime_dev", "runtime_ino", "evaluator_uid", "evaluator_gid", "notifier_uid",
            "notifier_gid", "activation_id", "installation_generation", "previous_activation_sha256",
            "supervisor_bundle_sha256",
        ):
            command += [f"--{name.replace('_', '-')}", str(parameters[name])]
        if operation == "ROLLBACK_MONITORING_HOST_DELIVERY":
            command += ["--rollback-target-activation-sha256", parameters["rollback_target_activation_sha256"]]
        command += [
            "--confirm",
            "ROLLBACK_EXACT_MONITORING_HOST_DELIVERY" if operation == "ROLLBACK_MONITORING_HOST_DELIVERY" else "INSTALL_EXACT_MONITORING_HOST_DELIVERY",
        ]
    elif operation == "DISABLE_MONITORING_HOST_DELIVERY":
        command = [
            "/usr/bin/python3", entrypoint, "disable",
            "--expected-active-sha256", parameters["expected_active_sha256"],
            "--disable-id", parameters["disable_id"],
            "--confirm", "DISABLE_EXACT_MONITORING_HOST_DELIVERY",
        ]
    elif operation == "CREATE_IMAGE_EVIDENCE":
        command += ["--repository-root", parameters["repository_root"], "--git-commit", parameters["git_commit"], "--git-tree", parameters["git_tree"], "--candidate-snapshot-receipt", parameters["candidate_snapshot_receipt"], "--candidate-snapshot-receipt-sha256", parameters["candidate_snapshot_receipt_sha256"], "--test-runtime-root", parameters["test_runtime_root"], "--artifact-root", parameters["artifact_root"], "--run-id", parameters["run_id"], "--web-image", parameters["web_image"], "--worker-image", parameters["worker_image"], "--trivy-db-directory", parameters["trivy_db_directory"], "--confirm", "CREATE_TRIVY_IMAGE_EVIDENCE"]
    elif operation == "RUN_RELEASE_GATE":
        command += ["--repository-root", parameters["repository_root"], "--git-commit", parameters["git_commit"], "--git-tree", parameters["git_tree"], "--candidate-snapshot-receipt", parameters["candidate_snapshot_receipt"], "--candidate-snapshot-receipt-sha256", parameters["candidate_snapshot_receipt_sha256"], "--test-runtime-root", parameters["test_runtime_root"], "--artifact-root", parameters["artifact_root"], "--run-id", parameters["run_id"], "--runtime-guard-contract", parameters["runtime_guard_contract"], "--runtime-guard-mode", parameters["runtime_guard_mode"], "--gate-plan-sha256", parameters["gate_plan_sha256"], "--web-image", parameters["web_image"], "--worker-image", parameters["worker_image"], "--sbom-evidence", parameters["sbom_evidence"], "--security-evidence", parameters["security_evidence"], "--confirm", "RUN_EXACT_RELEASE_GATE"]
    elif operation == "CREATE_RELEASE_MANIFEST":
        command += ["--repository-root", parameters["repository_root"], "--git-commit", parameters["git_commit"], "--git-tree", parameters["git_tree"], "--candidate-snapshot-receipt", parameters["candidate_snapshot_receipt"], "--candidate-snapshot-receipt-sha256", parameters["candidate_snapshot_receipt_sha256"], "--test-runtime-root", parameters["test_runtime_root"], "--artifact-root", parameters["artifact_root"], "--release-id", parameters["release_id"], "--deployment-class", parameters["deployment_class"], "--runtime-guard-contract", parameters["runtime_guard_contract"], "--runtime-guard-mode", parameters["runtime_guard_mode"], "--gate-plan-sha256", parameters["gate_plan_sha256"], "--web-image", parameters["web_image"], "--worker-image", parameters["worker_image"], "--gate-plan", parameters["gate_plan"], "--gate-report", parameters["gate_report"], "--sbom-evidence", parameters["sbom_evidence"], "--security-evidence", parameters["security_evidence"], "--expires-at", parameters["expires_at"], "--confirm", "CREATE_IMMUTABLE_RELEASE_MANIFEST"]
    elif operation == "PROBE_POST_DEPLOY_RUNTIME_CONFIGURATION":
        command += ["--release-manifest", parameters["release_manifest"], "--release-manifest-sha256", parameters["release_manifest_sha256"], "--probe-root", parameters["probe_root"], "--probe-id", parameters["probe_id"], "--reader-gid", str(parameters["reader_gid"]), "--runtime-guard-contract", parameters["runtime_guard_contract"], "--runtime-guard-mode", parameters["runtime_guard_mode"], "--runtime-policy-sha256", parameters["runtime_policy_sha256"], "--deployment-class", parameters["deployment_class"], "--deployment-id", parameters["deployment_id"], "--compose-project", parameters["compose_project"], "--compose-project-root", parameters["compose_project_root"], "--caddy-container", parameters["caddy_container"], "--postgres-container", parameters["postgres_container"], "--web-container", parameters["web_container"], "--worker-container", parameters["worker_container"], "--confirm", "PROBE_EXACT_POSTDEPLOY_RUNTIME_CONFIGURATION"]
    elif operation == "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY":
        command += ["--release-manifest", parameters["release_manifest"], "--release-manifest-sha256", parameters["release_manifest_sha256"], "--postdeploy-root", parameters["postdeploy_root"], "--identity-root", parameters["identity_root"], "--reader-gid", str(parameters["reader_gid"]), "--run-id", parameters["run_id"], "--runtime-guard-contract", parameters["runtime_guard_contract"], "--runtime-guard-mode", parameters["runtime_guard_mode"], "--runtime-policy-sha256", parameters["runtime_policy_sha256"], "--runtime-configuration-sha256", parameters["runtime_configuration_sha256"], "--deployment-class", parameters["deployment_class"], "--deployment-id", parameters["deployment_id"], "--compose-project", parameters["compose_project"], "--compose-project-root", parameters["compose_project_root"], "--caddy-container", parameters["caddy_container"], "--postgres-container", parameters["postgres_container"], "--web-container", parameters["web_container"], "--worker-container", parameters["worker_container"], "--confirm", "VERIFY_AND_PUBLISH_EXACT_POSTDEPLOY_IDENTITY"]
    else:
        reject("SUPERVISOR_COMMAND_OPERATION_INVALID")
    return command


def validate_runtime_secret_boundary(bundle_root: Path, operation: str) -> None:
    if operation not in (
        "PROBE_POST_DEPLOY_RUNTIME_CONFIGURATION", "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY",
        "VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION", "VERIFY_UAT_POSTDEPLOY_IDENTITY",
        "RUN_UAT_PROMOTION_MIGRATION", *RUNTIME_PRIVILEGE_OPERATIONS,
    ):
        return
    validator = bundle_root / "chenyida_erp_site/scripts/runtime-secret-file-policy.py"
    policy = bundle_root / "chenyida_erp_site/operations/runtime-secret-file-policy-v1.json"
    environment = {
        "PATH": SAFE_PATH,
        "LC_ALL": "C",
        "LANG": "C",
        "TZ": "UTC",
        "HOME": "/nonexistent",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONHASHSEED": "0",
    }
    try:
        result = subprocess.run(
            ["/usr/bin/python3", str(validator), "validate", "--policy", str(policy)],
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        reject("SUPERVISOR_RUNTIME_SECRET_FILES_INVALID")
    expected = f"RUNTIME_SECRET_FILES_VERIFIED entries=6 policy_sha256={RUNTIME_SECRET_POLICY_SHA256}\n"
    if result.returncode != 0 or result.stdout != expected or result.stderr != "":
        reject("SUPERVISOR_RUNTIME_SECRET_FILES_INVALID")


def validate_runtime_probe_receipt(parameters: dict[str, Any], expected_bundle_digest: str, now: datetime | None = None, probe_root: Path = RUNTIME_PROBE_ROOT) -> dict[str, Any]:
    if set(PARAMETER_FIELDS["VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY"]) != set(parameters):
        reject("SUPERVISOR_RUNTIME_PROBE_BINDING_INVALID")
    trusted_directory(probe_root, {0o700}, "SUPERVISOR_RUNTIME_PROBE_ROOT_INVALID")
    receipt_path = Path(parameters["runtime_probe_receipt"])
    if not receipt_path.is_absolute() or receipt_path.parent != probe_root:
        reject("SUPERVISOR_RUNTIME_PROBE_PATH_INVALID")
    raw, _ = trusted_regular_file(receipt_path, 0o400, maximum=64 * 1024, code="SUPERVISOR_RUNTIME_PROBE_FILE_INVALID")
    if sha256(raw) != parameters["runtime_probe_receipt_sha256"]:
        reject("SUPERVISOR_RUNTIME_PROBE_DIGEST_MISMATCH")
    value = strict_json(raw, "SUPERVISOR_RUNTIME_PROBE_JSON_INVALID")
    fields = {"schema_version", "contract", "probe_id", "probed_at", "expires_at", "control", "deployment", "release", "runtime_guard", "runtime_policy_sha256", "runtime_secret_policy_sha256", "runtime_configuration_sha256", "compose_project_root_sha256", "selectors", "services"}
    value = exact_fields(value, fields, "SUPERVISOR_RUNTIME_PROBE_FIELDS_INVALID")
    if raw != canonical_json(value) or value["schema_version"] != 1 or value["contract"] != RUNTIME_PROBE_CONTRACT:
        reject("SUPERVISOR_RUNTIME_PROBE_NOT_CANONICAL")
    probe_id = value["probe_id"]
    if not isinstance(probe_id, str) or not IDENTIFIER.fullmatch(probe_id) or len(probe_id) > 101 or receipt_path.name != f"{probe_id}.runtime-configuration-probe.json":
        reject("SUPERVISOR_RUNTIME_PROBE_ID_INVALID")
    probed = parse_time(value["probed_at"], "SUPERVISOR_RUNTIME_PROBE_TIME_INVALID")
    expires = parse_time(value["expires_at"], "SUPERVISOR_RUNTIME_PROBE_TIME_INVALID")
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if expires - probed != timedelta(hours=1) or probed > current + timedelta(minutes=5) or current >= expires:
        reject("SUPERVISOR_RUNTIME_PROBE_TIME_INVALID")
    control = exact_fields(value["control"], {"supervisor_bundle_sha256", "authorization_sha256"}, "SUPERVISOR_RUNTIME_PROBE_CONTROL_INVALID")
    if control["supervisor_bundle_sha256"] != expected_bundle_digest or not isinstance(control["authorization_sha256"], str) or not SHA256.fullmatch(control["authorization_sha256"]):
        reject("SUPERVISOR_RUNTIME_PROBE_CONTROL_INVALID")
    deployment = exact_fields(value["deployment"], {"class", "id", "compose_project"}, "SUPERVISOR_RUNTIME_PROBE_DEPLOYMENT_INVALID")
    if deployment != {"class": parameters["deployment_class"], "id": parameters["deployment_id"], "compose_project": parameters["compose_project"]}:
        reject("SUPERVISOR_RUNTIME_PROBE_DEPLOYMENT_INVALID")
    release = exact_fields(value["release"], {"manifest_sha256", "git_commit", "package_version"}, "SUPERVISOR_RUNTIME_PROBE_RELEASE_INVALID")
    if release["manifest_sha256"] != parameters["release_manifest_sha256"] or not isinstance(release["git_commit"], str) or not GIT_OBJECT.fullmatch(release["git_commit"]) or not isinstance(release["package_version"], str) or not 1 <= len(release["package_version"]) <= 120:
        reject("SUPERVISOR_RUNTIME_PROBE_RELEASE_INVALID")
    runtime_guard = exact_fields(value["runtime_guard"], {"contract", "mode"}, "SUPERVISOR_RUNTIME_PROBE_GUARD_INVALID")
    if runtime_guard != {"contract": parameters["runtime_guard_contract"], "mode": parameters["runtime_guard_mode"]} \
        or value["runtime_policy_sha256"] != parameters["runtime_policy_sha256"] or value["runtime_secret_policy_sha256"] != RUNTIME_SECRET_POLICY_SHA256 \
        or value["runtime_configuration_sha256"] != parameters["runtime_configuration_sha256"] \
        or value["compose_project_root_sha256"] != sha256(parameters["compose_project_root"].encode("utf-8")):
        reject("SUPERVISOR_RUNTIME_PROBE_BINDING_INVALID")
    selectors = exact_fields(value["selectors"], {"caddy", "postgres", "web", "worker"}, "SUPERVISOR_RUNTIME_PROBE_SELECTORS_INVALID")
    expected_selectors = {service: parameters[f"{service}_container"] for service in ("caddy", "postgres", "web", "worker")}
    if selectors != expected_selectors:
        reject("SUPERVISOR_RUNTIME_PROBE_SELECTORS_INVALID")
    services = value["services"]
    service_fields = {"service", "container_id", "image_id", "image_reference", "restart_count", "oom_killed", "running", "restarting", "paused", "dead", "status", "health", "healthcheck_present"}
    if not isinstance(services, list) or len(services) != 4:
        reject("SUPERVISOR_RUNTIME_PROBE_SERVICES_INVALID")
    container_ids: set[str] = set()
    image_ids: set[str] = set()
    for index, service in enumerate(("caddy", "postgres", "web", "worker")):
        state = exact_fields(services[index], service_fields, "SUPERVISOR_RUNTIME_PROBE_SERVICES_INVALID")
        if state["service"] != service or not isinstance(state["container_id"], str) or not re.fullmatch(r"[0-9a-f]{64}", state["container_id"]) \
            or not isinstance(state["image_id"], str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", state["image_id"]) \
            or not isinstance(state["image_reference"], str) or not IMAGE_REFERENCE.fullmatch(state["image_reference"]) \
            or state["restart_count"] != 0 or state["oom_killed"] is not False or state["running"] is not True or state["restarting"] is not False \
            or state["paused"] is not False or state["dead"] is not False or state["status"] != "running" or not isinstance(state["healthcheck_present"], bool):
            reject("SUPERVISOR_RUNTIME_PROBE_SERVICES_INVALID")
        if service == "caddy":
            if state["health"] != "none" or state["healthcheck_present"] is not False:
                reject("SUPERVISOR_RUNTIME_PROBE_SERVICES_INVALID")
        elif state["health"] != "healthy" or state["healthcheck_present"] is not True:
            reject("SUPERVISOR_RUNTIME_PROBE_SERVICES_INVALID")
        if state["container_id"] in container_ids or state["image_id"] in image_ids:
            reject("SUPERVISOR_RUNTIME_PROBE_SERVICES_INVALID")
        container_ids.add(state["container_id"])
        image_ids.add(state["image_id"])
    return value


def validate_runtime_privilege_release_manifest(parameters: dict[str, Any], expected_bundle_digest: str,
                                                *, require_fresh: bool, now: datetime | None = None) -> dict[str, Any]:
    manifest_path = Path(parameters["release_manifest"])
    raw, _ = trusted_regular_file(manifest_path, 0o440, maximum=MAX_JSON_BYTES, code="SUPERVISOR_RUNTIME_PRIVILEGE_RELEASE_MANIFEST_INVALID")
    if sha256(raw) != parameters["release_manifest_sha256"]:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RELEASE_MANIFEST_INVALID")
    value = strict_json(raw, "SUPERVISOR_RUNTIME_PRIVILEGE_RELEASE_MANIFEST_INVALID")
    if (
        raw != canonical_json(value)
        or not isinstance(value, dict)
        or value.get("schema_version") != 2
        or value.get("contract") != "chenyida-erp-release-manifest/v2"
        or value.get("promotion_status") != "ELIGIBLE"
        or value.get("allowed_deployment_classes") != [parameters["deployment_class"]]
    ):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RELEASE_MANIFEST_INVALID")
    control = exact_fields(value.get("control"), {
        "supervisor_bundle_sha256", "image_evidence_authorization_sha256",
        "release_gate_authorization_sha256", "manifest_authorization_sha256",
    }, "SUPERVISOR_RUNTIME_PRIVILEGE_RELEASE_MANIFEST_INVALID")
    if control["supervisor_bundle_sha256"] != expected_bundle_digest:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RELEASE_MANIFEST_INVALID")
    generated = parse_time(value.get("generated_at"), "SUPERVISOR_RUNTIME_PRIVILEGE_RELEASE_MANIFEST_INVALID")
    expires = parse_time(value.get("expires_at"), "SUPERVISOR_RUNTIME_PRIVILEGE_RELEASE_MANIFEST_INVALID")
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if (
        expires <= generated
        or expires - generated > timedelta(days=7)
        or generated > current + timedelta(minutes=5)
        or (require_fresh and current >= expires)
    ):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RELEASE_MANIFEST_INVALID")
    return value


def validate_uat_promotion_source_documents(parameters: dict[str, Any], expected_bundle_digest: str,
                                             now: datetime | None = None) -> dict[str, Any]:
    validate_uat_promotion_parameters(parameters, "BEGIN_UAT_PROMOTION")
    raws = verify_uat_promotion_sources(parameters)
    manifest = validate_runtime_privilege_release_manifest(
        {
            "release_manifest": parameters["release_manifest"],
            "release_manifest_sha256": parameters["release_manifest_sha256"],
            "deployment_class": "UAT",
        },
        expected_bundle_digest,
        require_fresh=True,
        now=now,
    )
    source = manifest.get("source")
    images = manifest.get("images")
    migrations = manifest.get("migrations")
    if not isinstance(source, dict) or not isinstance(images, dict) or not isinstance(migrations, dict) \
        or source.get("git_commit") != parameters["git_commit"] or source.get("git_tree") != parameters["git_tree"] \
        or source.get("package_version") != parameters["application_version"] \
        or images.get("web", {}).get("image_reference") != parameters["web_image"] \
        or images.get("worker", {}).get("image_reference") != parameters["worker_image"] \
        or migrations.get("head") != parameters["migration_head"] \
        or migrations.get("allowlist_sha256") != parameters["migration_manifest_sha256"]:
        reject("SUPERVISOR_UAT_PROMOTION_MANIFEST_BINDING_INVALID")

    identity = strict_json(raws["runtime"], "SUPERVISOR_UAT_PROMOTION_RUNTIME_SOURCE_INVALID")
    identity_fields = {
        "schema_version", "contract", "deployment_class", "deployment_id", "release_id", "release_manifest_sha256",
        "postdeploy_receipt_sha256", "supervisor_bundle_sha256", "authorization_sha256", "runtime_guard",
        "runtime_policy_sha256", "application_version", "git_commit", "git_tree", "migration_head",
        "migration_manifest_sha256", "caddy_container_id", "caddy_image_digest", "postgres_container_id",
        "postgres_image_digest", "web_container_id", "web_image_digest", "worker_container_id", "worker_image_digest",
        "generated_at",
    }
    identity = exact_fields(identity, identity_fields, "SUPERVISOR_UAT_PROMOTION_RUNTIME_SOURCE_INVALID")
    identity_generated = parse_time(identity["generated_at"], "SUPERVISOR_UAT_PROMOTION_RUNTIME_SOURCE_INVALID")
    promotion_created = parse_time(parameters["promotion_created_at"], "SUPERVISOR_UAT_PROMOTION_TIME_INVALID")
    if raws["runtime"] != canonical_json(identity) or identity["schema_version"] != 3 \
        or identity["contract"] != "chenyida-erp-runtime-release-identity/v3" \
        or identity["deployment_class"] != "UAT" or identity["deployment_id"] != "chenyida-erp" \
        or identity_generated > promotion_created + timedelta(minutes=5):
        reject("SUPERVISOR_UAT_PROMOTION_RUNTIME_SOURCE_INVALID")

    readiness = strict_json(raws["recovery"], "SUPERVISOR_UAT_PROMOTION_RECOVERY_SOURCE_INVALID")
    if not isinstance(readiness, dict) or readiness.get("schema_version") != 4 \
        or readiness.get("contract") != "chenyida-erp-backup-verification/v4" \
        or readiness.get("result") != "RECOVERY_READY" or readiness.get("evidence_scope") != "ACTUAL_OFFHOST" \
        or readiness.get("readiness_sha256") != parameters["preupgrade_recovery_readiness_sha256"]:
        reject("SUPERVISOR_UAT_PROMOTION_RECOVERY_SOURCE_INVALID")
    readiness_body = {key: value for key, value in readiness.items() if key != "readiness_sha256"}
    try:
        verified_at = parse_time(readiness["verified_at"], "SUPERVISOR_UAT_PROMOTION_RECOVERY_SOURCE_INVALID")
        readiness_expires = parse_time(readiness["expires_at"], "SUPERVISOR_UAT_PROMOTION_RECOVERY_SOURCE_INVALID")
        source_database = readiness["data_readiness"]["receipt"]["inner_restore"]["receipt"]["deployment"]
        snapshot_sha256 = readiness["cluster_security"]["snapshot_sha256"]
        final_phase = readiness["recovery_execution"]["states"][-1]["phase"]
    except (KeyError, IndexError, TypeError):
        reject("SUPERVISOR_UAT_PROMOTION_RECOVERY_SOURCE_INVALID")
    expected_database = {
        "class": "UAT", "id": "chenyida-erp", "database": parameters["database_name"],
        "database_oid": parameters["database_oid"], "database_system_identifier": parameters["database_system_identifier"],
        "database_marker": parameters["database_marker"],
    }
    if sha256(canonical_json(readiness_body)) != readiness["readiness_sha256"] \
        or verified_at > promotion_created + timedelta(minutes=5) \
        or readiness_expires < parse_time(parameters["promotion_expires_at"], "SUPERVISOR_UAT_PROMOTION_TIME_INVALID") \
        or snapshot_sha256 != parameters["preupgrade_recovery_snapshot_sha256"] or final_phase != "PUBLISHED" \
        or not isinstance(source_database, dict) or any(source_database.get(key) != value for key, value in expected_database.items()):
        reject("SUPERVISOR_UAT_PROMOTION_RECOVERY_SOURCE_INVALID")
    required_status = {
        "data_restore": "VERIFIED", "data_transfer": "VERIFIED", "cluster_transfer": "VERIFIED",
        "cluster_security": "VERIFIED", "credential_binding": "VERIFIED", "tablespace": "VERIFIED",
        "recovery_execution": "PUBLISHED", "schedule": "ON_TIME", "retention": "POLICY_VALID_DRY_RUN",
    }
    status = readiness.get("status")
    if not isinstance(status, dict) or any(status.get(key) != value for key, value in required_status.items()):
        reject("SUPERVISOR_UAT_PROMOTION_RECOVERY_SOURCE_INVALID")

    if "current" in raws:
        current = strict_json(raws["current"], "SUPERVISOR_UAT_PROMOTION_CURRENT_SOURCE_INVALID")
        if not isinstance(current, dict) or current.get("contract") != "chenyida-erp-uat-promotion-checkpoint-receipt/v1" \
            or current.get("promotion_generation") != parameters["promotion_generation"] - 1 \
            or current.get("receipt_sha256") != parameters["previous_promotion_receipt_sha256"] \
            or current.get("journal_status") not in ("COMMITTED", "ROLLED_BACK"):
            reject("SUPERVISOR_UAT_PROMOTION_CURRENT_SOURCE_INVALID")
        current_body = {key: value for key, value in current.items() if key != "receipt_sha256"}
        if raws["current"] != canonical_json(current) or sha256(canonical_json(current_body)) != current["receipt_sha256"]:
            reject("SUPERVISOR_UAT_PROMOTION_CURRENT_SOURCE_INVALID")
    return {"manifest": manifest, "identity": identity, "readiness": readiness}


def validate_runtime_privilege_probe_receipt(parameters: dict[str, Any], expected_bundle_digest: str, now: datetime | None = None,
                                             operation: str | None = None, probe_root: Path = RUNTIME_PROBE_ROOT) -> dict[str, Any]:
    validate_runtime_privilege_parameters(parameters, operation)
    recovery = operation == "RECOVER_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT"
    effective_operation = parameters["original_operation"] if recovery else RUNTIME_PRIVILEGE_OPERATIONS[operation]
    manifest = validate_runtime_privilege_release_manifest(
        parameters, expected_bundle_digest, require_fresh=not recovery, now=now,
    )
    if effective_operation == "BOOTSTRAP":
        return manifest
    receipt_path = Path(parameters["runtime_probe_receipt"])
    raw, _ = trusted_regular_file(receipt_path, 0o400, maximum=64 * 1024, code="SUPERVISOR_RUNTIME_PROBE_FILE_INVALID")
    if sha256(raw) != parameters["runtime_probe_receipt_sha256"]:
        reject("SUPERVISOR_RUNTIME_PROBE_DIGEST_MISMATCH")
    preview = strict_json(raw, "SUPERVISOR_RUNTIME_PROBE_JSON_INVALID")
    if not isinstance(preview, dict):
        reject("SUPERVISOR_RUNTIME_PROBE_JSON_INVALID")
    selectors = exact_fields(preview.get("selectors"), {"caddy", "postgres", "web", "worker"}, "SUPERVISOR_RUNTIME_PROBE_SELECTORS_INVALID")
    synthetic_parameters = {
        "release_manifest": "/unused/release-manifest.json",
        "release_manifest_sha256": parameters["release_manifest_sha256"],
        "postdeploy_root": "/unused/postdeploy",
        "identity_root": "/unused/identity",
        "reader_gid": 1,
        "run_id": "runtime-privilege-probe-validation",
        "runtime_guard_contract": RUNTIME_GUARD_CONTRACT,
        "runtime_guard_mode": POST_DEPLOY_RUNTIME_GUARD_MODE,
        "runtime_policy_sha256": parameters["runtime_policy_sha256"],
        "deployment_class": parameters["deployment_class"],
        "deployment_id": parameters["deployment_id"],
        "compose_project": RUNTIME_COMPOSE_PROJECT,
        "runtime_configuration_sha256": parameters["runtime_configuration_sha256"],
        "runtime_probe_receipt": parameters["runtime_probe_receipt"],
        "runtime_probe_receipt_sha256": parameters["runtime_probe_receipt_sha256"],
        "compose_project_root": parameters["compose_project_root"],
        "caddy_container": selectors["caddy"],
        "postgres_container": parameters["postgres_container"],
        "web_container": selectors["web"],
        "worker_container": selectors["worker"],
    }
    value = validate_runtime_probe_receipt(synthetic_parameters, expected_bundle_digest, now, probe_root)
    postgres = value["services"][1]
    if postgres["service"] != "postgres" or postgres["container_id"] != parameters["postgres_container_id"]:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_CONTAINER_MISMATCH")
    return value


def validate_original_runtime_privilege_authorization_consumed(parameters: dict[str, Any], expected_bundle_digest: str,
                                                                 consumed_root: Path = AUTHORIZATION_CONSUMED_ROOT) -> dict[str, Any]:
    validate_runtime_privilege_parameters(parameters, "RECOVER_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT")
    if consumed_root == AUTHORIZATION_CONSUMED_ROOT:
        trusted_directory(AUTHORIZATION_ROOT, {0o700}, "SUPERVISOR_AUTHORIZATION_ROOT_INVALID")
    trusted_directory(consumed_root, {0o700}, "SUPERVISOR_AUTHORIZATION_ROOT_INVALID")
    original_id = parameters["original_operation_id"]
    original_digest = parameters["original_authorization_sha256"]
    file = consumed_root / f"{original_id}.{original_digest}.json"
    raw, _ = trusted_regular_file(file, 0o400, code="SUPERVISOR_RUNTIME_PRIVILEGE_ORIGINAL_AUTHORIZATION_INVALID")
    if sha256(raw) != original_digest:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_ORIGINAL_AUTHORIZATION_INVALID")
    preview = strict_json(raw, "SUPERVISOR_RUNTIME_PRIVILEGE_ORIGINAL_AUTHORIZATION_INVALID")
    try:
        created = parse_time(preview["created_at"], "SUPERVISOR_RUNTIME_PRIVILEGE_ORIGINAL_AUTHORIZATION_INVALID")
        expires = parse_time(preview["expires_at"], "SUPERVISOR_RUNTIME_PRIVILEGE_ORIGINAL_AUTHORIZATION_INVALID")
    except (KeyError, TypeError):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_ORIGINAL_AUTHORIZATION_INVALID")
    validation_time = created + (expires - created) / 2
    try:
        value = validate_authorization(preview, expected_bundle_digest, validation_time)
    except SupervisorError:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_ORIGINAL_AUTHORIZATION_INVALID")
    if raw != canonical_json(value) or value["authorization_id"] != original_id \
        or value["operation"] == "RECOVER_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT" \
        or RUNTIME_PRIVILEGE_OPERATIONS.get(value["operation"]) != parameters["original_operation"]:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_ORIGINAL_AUTHORIZATION_INVALID")
    original_parameters = value["parameters"]
    stable_fields = RUNTIME_PRIVILEGE_BASE_PARAMETER_FIELDS
    if any(original_parameters[field] != parameters[field] for field in stable_fields):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_ORIGINAL_AUTHORIZATION_INVALID")
    return value


def validate_original_cluster_policy_authorization_consumed(parameters: dict[str, Any], expected_bundle_digest: str,
                                                             consumed_root: Path = AUTHORIZATION_CONSUMED_ROOT) -> dict[str, Any]:
    validate_cluster_policy_parameters(parameters, "RECOVER_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2_ACTIVATION")
    if consumed_root == AUTHORIZATION_CONSUMED_ROOT:
        trusted_directory(AUTHORIZATION_ROOT, {0o700}, "SUPERVISOR_AUTHORIZATION_ROOT_INVALID")
    trusted_directory(consumed_root, {0o700}, "SUPERVISOR_AUTHORIZATION_ROOT_INVALID")
    original_id = parameters["original_operation_id"]
    original_digest = parameters["original_authorization_sha256"]
    file = consumed_root / f"{original_id}.{original_digest}.json"
    raw, _ = trusted_regular_file(file, 0o400, code="SUPERVISOR_CLUSTER_POLICY_ORIGINAL_AUTHORIZATION_INVALID")
    if sha256(raw) != original_digest:
        reject("SUPERVISOR_CLUSTER_POLICY_ORIGINAL_AUTHORIZATION_INVALID")
    preview = strict_json(raw, "SUPERVISOR_CLUSTER_POLICY_ORIGINAL_AUTHORIZATION_INVALID")
    try:
        created = parse_time(preview["created_at"], "SUPERVISOR_CLUSTER_POLICY_ORIGINAL_AUTHORIZATION_INVALID")
        expires = parse_time(preview["expires_at"], "SUPERVISOR_CLUSTER_POLICY_ORIGINAL_AUTHORIZATION_INVALID")
    except (KeyError, TypeError):
        reject("SUPERVISOR_CLUSTER_POLICY_ORIGINAL_AUTHORIZATION_INVALID")
    try:
        value = validate_authorization(preview, expected_bundle_digest, created + (expires - created) / 2)
    except SupervisorError:
        reject("SUPERVISOR_CLUSTER_POLICY_ORIGINAL_AUTHORIZATION_INVALID")
    expected_operation = {
        "ACTIVATE": "ACTIVATE_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2",
        "ROLLBACK": "ROLLBACK_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2",
    }[parameters["original_operation"]]
    if raw != canonical_json(value) or value["contract"] != CLUSTER_POLICY_AUTHORIZATION_CONTRACT \
        or value["authorization_id"] != original_id or value["operation"] != expected_operation:
        reject("SUPERVISOR_CLUSTER_POLICY_ORIGINAL_AUTHORIZATION_INVALID")
    original_parameters = value["parameters"]
    if any(original_parameters[field] != parameters[field] for field in CLUSTER_POLICY_BASE_PARAMETER_FIELDS):
        reject("SUPERVISOR_CLUSTER_POLICY_ORIGINAL_AUTHORIZATION_INVALID")
    return value


def validate_original_notifier_egress_authorization_consumed(parameters: dict[str, Any], expected_bundle_digest: str,
                                                              consumed_root: Path = AUTHORIZATION_CONSUMED_ROOT) -> dict[str, Any]:
    validate_notifier_egress_parameters(parameters, "RECOVER_MONITORING_NOTIFIER_EGRESS_V1_ACTIVATION")
    if consumed_root == AUTHORIZATION_CONSUMED_ROOT:
        trusted_directory(AUTHORIZATION_ROOT, {0o700}, "SUPERVISOR_AUTHORIZATION_ROOT_INVALID")
    trusted_directory(consumed_root, {0o700}, "SUPERVISOR_AUTHORIZATION_ROOT_INVALID")
    original_id = parameters["original_operation_id"]
    original_digest = parameters["original_authorization_sha256"]
    file = consumed_root / f"{original_id}.{original_digest}.json"
    raw, _ = trusted_regular_file(file, 0o400, code="SUPERVISOR_NOTIFIER_EGRESS_ORIGINAL_AUTHORIZATION_INVALID")
    if sha256(raw) != original_digest:
        reject("SUPERVISOR_NOTIFIER_EGRESS_ORIGINAL_AUTHORIZATION_INVALID")
    preview = strict_json(raw, "SUPERVISOR_NOTIFIER_EGRESS_ORIGINAL_AUTHORIZATION_INVALID")
    try:
        created = parse_time(preview["created_at"], "SUPERVISOR_NOTIFIER_EGRESS_ORIGINAL_AUTHORIZATION_INVALID")
        expires = parse_time(preview["expires_at"], "SUPERVISOR_NOTIFIER_EGRESS_ORIGINAL_AUTHORIZATION_INVALID")
        value = validate_authorization(preview, expected_bundle_digest, created + (expires - created) / 2)
    except (KeyError, TypeError, SupervisorError):
        reject("SUPERVISOR_NOTIFIER_EGRESS_ORIGINAL_AUTHORIZATION_INVALID")
    expected_operation = {
        "ACTIVATE": "ACTIVATE_MONITORING_NOTIFIER_EGRESS_V1",
        "ROLLBACK": "ROLLBACK_MONITORING_NOTIFIER_EGRESS_V1",
    }[parameters["original_operation"]]
    if raw != canonical_json(value) or value["contract"] != NOTIFIER_EGRESS_AUTHORIZATION_CONTRACT \
        or value["authorization_id"] != original_id or value["operation"] != expected_operation:
        reject("SUPERVISOR_NOTIFIER_EGRESS_ORIGINAL_AUTHORIZATION_INVALID")
    original_parameters = value["parameters"]
    if any(original_parameters[field] != parameters[field] for field in NOTIFIER_EGRESS_BASE_PARAMETER_FIELDS):
        reject("SUPERVISOR_NOTIFIER_EGRESS_ORIGINAL_AUTHORIZATION_INVALID")
    return value


def validate_original_uat_promotion_authorization_consumed(parameters: dict[str, Any], expected_bundle_digest: str,
                                                            consumed_root: Path = AUTHORIZATION_CONSUMED_ROOT) -> dict[str, Any]:
    validate_uat_promotion_parameters(parameters, "RECOVER_UAT_PROMOTION")
    if consumed_root == AUTHORIZATION_CONSUMED_ROOT:
        trusted_directory(AUTHORIZATION_ROOT, {0o700}, "SUPERVISOR_AUTHORIZATION_ROOT_INVALID")
    trusted_directory(consumed_root, {0o700}, "SUPERVISOR_AUTHORIZATION_ROOT_INVALID")
    original_id = parameters["original_operation_id"]
    original_digest = parameters["original_authorization_sha256"]
    file = consumed_root / f"{original_id}.{original_digest}.json"
    raw, _ = trusted_regular_file(file, 0o400, code="SUPERVISOR_UAT_PROMOTION_ORIGINAL_AUTHORIZATION_INVALID")
    if sha256(raw) != original_digest:
        reject("SUPERVISOR_UAT_PROMOTION_ORIGINAL_AUTHORIZATION_INVALID")
    preview = strict_json(raw, "SUPERVISOR_UAT_PROMOTION_ORIGINAL_AUTHORIZATION_INVALID")
    try:
        created = parse_time(preview["created_at"], "SUPERVISOR_UAT_PROMOTION_ORIGINAL_AUTHORIZATION_INVALID")
        expires = parse_time(preview["expires_at"], "SUPERVISOR_UAT_PROMOTION_ORIGINAL_AUTHORIZATION_INVALID")
        value = validate_authorization(preview, expected_bundle_digest, created + (expires - created) / 2)
    except (KeyError, TypeError, SupervisorError):
        reject("SUPERVISOR_UAT_PROMOTION_ORIGINAL_AUTHORIZATION_INVALID")
    expected_operation = {
        "BEGIN": "BEGIN_UAT_PROMOTION",
        "CAPTURE_SNAPSHOT": "CAPTURE_UAT_PROMOTION_SNAPSHOT",
        "QUIESCE_WRITERS": "QUIESCE_UAT_WRITERS",
        "MIGRATION_AUTHORIZATION": "AUTHORIZE_UAT_PROMOTION_MIGRATION",
        "MIGRATION_EXECUTION": "RUN_UAT_PROMOTION_MIGRATION",
        "COMPOSE_DEPLOYMENT": "DEPLOY_UAT_RELEASE",
        "POSTDEPLOY_RUNTIME_CONFIGURATION": "VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION",
        "POSTDEPLOY_IDENTITY": "VERIFY_UAT_POSTDEPLOY_IDENTITY",
    }.get(parameters["original_operation"])
    if raw != canonical_json(value) or value["contract"] != UAT_PROMOTION_AUTHORIZATION_CONTRACT \
        or value["authorization_id"] != original_id or value["operation"] != expected_operation:
        reject("SUPERVISOR_UAT_PROMOTION_ORIGINAL_AUTHORIZATION_INVALID")
    original_parameters = value["parameters"]
    fields = UAT_PROMOTION_SNAPSHOT_PARAMETER_FIELDS if parameters["original_operation"] == "CAPTURE_SNAPSHOT" \
        else UAT_PROMOTION_QUIESCE_PARAMETER_FIELDS if parameters["original_operation"] == "QUIESCE_WRITERS" \
        else UAT_PROMOTION_MIGRATION_AUTHORIZATION_PARAMETER_FIELDS if parameters["original_operation"] == "MIGRATION_AUTHORIZATION" \
        else UAT_PROMOTION_MIGRATION_EXECUTION_PARAMETER_FIELDS if parameters["original_operation"] == "MIGRATION_EXECUTION" \
        else UAT_PROMOTION_COMPOSE_DEPLOYMENT_PARAMETER_FIELDS if parameters["original_operation"] == "COMPOSE_DEPLOYMENT" \
        else UAT_PROMOTION_POSTDEPLOY_RUNTIME_PARAMETER_FIELDS if parameters["original_operation"] == "POSTDEPLOY_RUNTIME_CONFIGURATION" \
        else UAT_PROMOTION_POSTDEPLOY_IDENTITY_PARAMETER_FIELDS if parameters["original_operation"] == "POSTDEPLOY_IDENTITY" \
        else UAT_PROMOTION_BASE_PARAMETER_FIELDS
    if any(original_parameters[field] != parameters[field] for field in fields):
        reject("SUPERVISOR_UAT_PROMOTION_ORIGINAL_AUTHORIZATION_INVALID")
    return value


def acquire_global_release_lock(path: Path = GLOBAL_RELEASE_LOCK) -> int:
    try:
        parent = os.lstat(path.parent)
    except OSError:
        reject("SUPERVISOR_GLOBAL_RELEASE_LOCK_INVALID")
    if not stat.S_ISDIR(parent.st_mode) or stat.S_ISLNK(parent.st_mode) or parent.st_uid != 0 or parent.st_gid != 0 or stat.S_IMODE(parent.st_mode) & 0o022:
        reject("SUPERVISOR_GLOBAL_RELEASE_LOCK_INVALID")
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    except OSError:
        reject("SUPERVISOR_GLOBAL_RELEASE_LOCK_INVALID")
    try:
        os.fchown(descriptor, 0, 0)
        os.fchmod(descriptor, 0o600)
        opened = os.fstat(descriptor)
        pointed = os.lstat(path)
        if not stat.S_ISREG(opened.st_mode) or opened.st_uid != 0 or opened.st_gid != 0 or opened.st_nlink != 1 or stat.S_IMODE(opened.st_mode) != 0o600 \
            or pointed.st_dev != opened.st_dev or pointed.st_ino != opened.st_ino or stat.S_ISLNK(pointed.st_mode):
            reject("SUPERVISOR_GLOBAL_RELEASE_LOCK_INVALID")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            reject("SUPERVISOR_GLOBAL_RELEASE_LOCK_BUSY")
        os.set_inheritable(descriptor, True)
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def assert_no_runtime_privilege_interlock(bundle_root: Path) -> None:
    helper = bundle_root / "chenyida_erp_site/scripts/postgresql-runtime-privilege-interlock.sh"
    environment = {"PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent"}
    try:
        result = subprocess.run(
            ["/bin/sh", "-c", '. "$1"; assert_no_chenyida_postgresql_runtime_privilege_interlock', "sh", str(helper)],
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_INTERLOCK_INVALID")
    if result.returncode != 0:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RECOVERY_REQUIRED")


def assert_no_uat_postdeploy_committed_anomaly() -> None:
    containment_root = UAT_PROMOTION_STATE_ROOT / "containments"
    try:
        metadata = os.lstat(containment_root)
    except FileNotFoundError:
        return
    except OSError:
        reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_ANOMALY_INTERLOCK_INVALID")
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) \
            or metadata.st_uid != 0 or metadata.st_gid != 0 or stat.S_IMODE(metadata.st_mode) != 0o700:
        reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_ANOMALY_INTERLOCK_INVALID")
    try:
        names = sorted(os.listdir(containment_root))
    except OSError:
        reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_ANOMALY_INTERLOCK_INVALID")
    if len(names) > 20_000 or any(
            not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json", name)
            for name in names):
        reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_ANOMALY_INTERLOCK_INVALID")
    fields = {
        "schema_version", "contract", "status", "contained_at", "operation", "operation_id",
        "promotion_id", "intent_sha256", "execution_authorization_sha256",
        "preserved_checkpoint_receipt_sha256", "deployment_result_sha256", "fence_transfer_sha256",
        "observed_checkpoint_id", "observed_checkpoint_ordinal", "external_artifact_state",
        "failure_stage", "failure_code", "preservation", "containment_sha256",
    }
    for name in names:
        raw, _ = trusted_regular_file(
            containment_root / name, 0o400,
            code="SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_ANOMALY_INTERLOCK_INVALID",
        )
        value = strict_json(raw, "SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_ANOMALY_INTERLOCK_INVALID")
        body = {key: item for key, item in value.items() if key != "containment_sha256"} \
            if isinstance(value, dict) else {}
        runtime = isinstance(value, dict) and value.get("operation") == "POSTDEPLOY_RUNTIME_CONFIGURATION"
        contained = isinstance(value, dict) \
            and value.get("status") == "POSTDEPLOY_FAILURE_CONTAINED_JOURNAL_UNCHANGED"
        committed_anomaly = isinstance(value, dict) \
            and value.get("status") == "POSTDEPLOY_COMMITTED_SUPERVISOR_ANOMALY"
        if not isinstance(value, dict) or set(value) != fields or raw != canonical_json(value) \
                or value.get("schema_version") != 1 \
                or value.get("contract") != "chenyida-erp-uat-promotion-postdeploy-containment/v1" \
                or value.get("status") not in {
                    "POSTDEPLOY_FAILURE_CONTAINED_JOURNAL_UNCHANGED",
                    "POSTDEPLOY_COMMITTED_SUPERVISOR_ANOMALY",
                } \
                or value.get("operation") not in {
                    "POSTDEPLOY_RUNTIME_CONFIGURATION", "POSTDEPLOY_IDENTITY",
                } \
                or any(not isinstance(value.get(field), str) or not IDENTIFIER.fullmatch(value[field])
                       for field in ("operation_id", "promotion_id", "observed_checkpoint_id")) \
                or any(not isinstance(value.get(field), str) or not SHA256.fullmatch(value[field])
                       for field in (
                           "intent_sha256", "execution_authorization_sha256",
                           "preserved_checkpoint_receipt_sha256", "deployment_result_sha256",
                           "fence_transfer_sha256", "containment_sha256",
                       )) \
                or not isinstance(value.get("observed_checkpoint_ordinal"), int) \
                or isinstance(value.get("observed_checkpoint_ordinal"), bool) \
                or not isinstance(value.get("contained_at"), str) or not ISO_UTC.fullmatch(value["contained_at"]) \
                or value.get("external_artifact_state") not in {
                    "ABSENT", "TRUSTED_FINAL_ARTIFACT_PRESENT", "UNTRUSTED_OR_PARTIAL",
                } \
                or contained and (
                    value.get("observed_checkpoint_id") != (
                        "COMPOSE_DEPLOYMENT_RECEIPT" if runtime else "POST_DEPLOY_RUNTIME_CONFIGURATION"
                    )
                    or value.get("observed_checkpoint_ordinal") != (9 if runtime else 10)
                    or value.get("preservation") != (
                        "PREDECESSOR_CHECKPOINT_RESULT_TRANSFER_FENCE_AND_DATABASE_HANDOFF_"
                        "LEFT_UNCHANGED_NO_ROLLBACK_NO_DELETE_NO_DATABASE_ACTION"
                    )
                ) \
                or committed_anomaly and (
                    value.get("observed_checkpoint_id") != (
                        "POST_DEPLOY_RUNTIME_CONFIGURATION" if runtime else "POST_DEPLOY_IDENTITY"
                    )
                    or value.get("observed_checkpoint_ordinal") != (10 if runtime else 11)
                    or value.get("preservation") != (
                        "COMMITTED_POSTDEPLOY_CHECKPOINT_LEFT_UNCHANGED_NO_ROLLBACK_NO_DELETE_NO_DATABASE_ACTION"
                    )
                    or value.get("failure_stage") not in {"JOURNAL_EXECUTION", "RESULT_CROSSCHECK"}
                ) \
                or value.get("failure_stage") == "RESULT_CROSSCHECK" and not committed_anomaly \
                or UAT_PROMOTION_POSTDEPLOY_FAILURE_CODES.get(value.get("failure_stage")) != value.get("failure_code") \
                or sha256(canonical_json(body)) != value["containment_sha256"] \
                or name != f"{value['operation_id']}.{value['containment_sha256']}.json":
            reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_ANOMALY_INTERLOCK_INVALID")
        if value["status"] == "POSTDEPLOY_COMMITTED_SUPERVISOR_ANOMALY":
            reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_ANOMALY_REQUIRES_REVIEW")


def assert_no_uat_migration_execution_interlock(
        authorization: dict[str, Any], authorization_digest: str | None = None) -> None:
    try:
        root_metadata = os.lstat(UAT_PROMOTION_STATE_ROOT)
    except FileNotFoundError:
        return
    except OSError:
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
    if not stat.S_ISDIR(root_metadata.st_mode) or stat.S_ISLNK(root_metadata.st_mode) \
            or root_metadata.st_uid != 0 or root_metadata.st_gid != 0 or stat.S_IMODE(root_metadata.st_mode) != 0o700:
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
    trusted_owned_marker(
        UAT_PROMOTION_STATE_ROOT / UAT_PROMOTION_STATE_MARKER, UAT_PROMOTION_STATE_MARKER_VALUE,
        0, 0, {0o400}, "SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID",
    )
    assert_no_uat_postdeploy_committed_anomaly()
    active_records: list[dict[str, Any]] = []
    try:
        active_metadata = os.lstat(UAT_PROMOTION_ACTIVE_FENCES_ROOT)
    except FileNotFoundError:
        active_metadata = None
    except OSError:
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
    if active_metadata is not None:
        trusted_owned_directory(
            UAT_PROMOTION_ACTIVE_FENCES_ROOT, 0, 0, {0o700},
            "SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID",
        )
        try:
            active_names = sorted(os.listdir(UAT_PROMOTION_ACTIVE_FENCES_ROOT))
        except OSError:
            reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
        if len(active_names) > 20_000 or any(
                not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json", name)
                for name in active_names):
            reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
        active_fields = {
            "schema_version", "contract", "status", "promotion_id", "migration_operation_id",
            "execution_authorization_sha256", "grant_sha256", "database_name",
            "database_system_identifier", "database_oid", "database_marker",
            "released_baseline_sha256", "fence_before_sha256", "activated_at", "active_fence_sha256",
        }
        for name in active_names:
            raw, _ = trusted_regular_file(
                UAT_PROMOTION_ACTIVE_FENCES_ROOT / name, 0o400,
                code="SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID",
            )
            value = strict_json(raw, "SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
            body = {key: item for key, item in value.items() if key != "active_fence_sha256"} \
                if isinstance(value, dict) else {}
            if not isinstance(value, dict) or set(value) != active_fields or raw != canonical_json(value) \
                    or value.get("schema_version") != 1 \
                    or value.get("contract") != "chenyida-erp-uat-promotion-active-migration-fence/v1" \
                    or value.get("status") \
                    != "ACTIVE_UNTIL_EXPLICIT_CHECKPOINT_9_TRANSFER_OR_QUARANTINE_RESOLUTION" \
                    or value.get("database_name") != "chenyida_erp" \
                    or value.get("database_marker") != "chenyida-erp-deployment/v2:UAT:chenyida-erp" \
                    or any(not isinstance(value.get(field), str) or not SHA256.fullmatch(value[field])
                           for field in ("execution_authorization_sha256", "grant_sha256",
                                         "released_baseline_sha256", "fence_before_sha256",
                                         "active_fence_sha256")) \
                    or any(not isinstance(value.get(field), str) or not IDENTIFIER.fullmatch(value[field])
                           for field in ("promotion_id", "migration_operation_id")) \
                    or not isinstance(value.get("database_system_identifier"), str) \
                    or not re.fullmatch(r"[1-9][0-9]{9,29}", value["database_system_identifier"]) \
                    or not isinstance(value.get("database_oid"), str) \
                    or not re.fullmatch(r"[1-9][0-9]{0,9}", value["database_oid"]) \
                    or not isinstance(value.get("activated_at"), str) \
                    or not ISO_UTC.fullmatch(value["activated_at"]) \
                    or sha256(canonical_json(body)) != value["active_fence_sha256"] \
                    or name != f"{value['migration_operation_id']}.{value['active_fence_sha256']}.json":
                reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
            active_records.append(value)
    if len(active_records) > 1:
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
    if active_records:
        active = active_records[0]
        active_parameters = authorization.get("parameters") if isinstance(authorization, dict) else None
        transferred = False
        try:
            transfer_metadata = os.lstat(UAT_PROMOTION_FENCE_TRANSFERS_ROOT)
        except FileNotFoundError:
            transfer_metadata = None
        except OSError:
            reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
        if transfer_metadata is not None:
            trusted_owned_directory(
                UAT_PROMOTION_FENCE_TRANSFERS_ROOT, 0, 0, {0o700},
                "SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID",
            )
            transfer_names = sorted(os.listdir(UAT_PROMOTION_FENCE_TRANSFERS_ROOT))
            if len(transfer_names) > 20_000 or any(
                    not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json", name)
                    for name in transfer_names):
                reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
            matching_transfers: list[dict[str, Any]] = []
            transfer_fields = {
                "schema_version", "contract", "status", "promotion_id", "migration_operation_id",
                "deployment_operation_id", "migration_execution_authorization_sha256",
                "deployment_authorization_sha256", "active_fence_sha256", "migration_result_sha256",
                "deployment_result_sha256", "database_handoff_sha256", "runtime_configuration_sha256",
                "transferred_at", "transfer_sha256",
            }
            for name in transfer_names:
                raw, _ = trusted_regular_file(
                    UAT_PROMOTION_FENCE_TRANSFERS_ROOT / name, 0o400,
                    code="SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID",
                )
                value = strict_json(raw, "SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
                body = {key: item for key, item in value.items() if key != "transfer_sha256"} \
                    if isinstance(value, dict) else {}
                if not isinstance(value, dict) or set(value) != transfer_fields or raw != canonical_json(value) \
                        or value.get("schema_version") != 1 \
                        or value.get("contract") != "chenyida-erp-uat-promotion-active-fence-transfer/v1" \
                        or value.get("status") != "TRANSFERRED_TO_CHECKPOINT_9_COMPOSE_DEPLOYMENT" \
                        or any(not isinstance(value.get(field), str) or not IDENTIFIER.fullmatch(value[field])
                               for field in ("promotion_id", "migration_operation_id", "deployment_operation_id")) \
                        or any(not isinstance(value.get(field), str) or not SHA256.fullmatch(value[field])
                               for field in transfer_fields - {
                                   "schema_version", "contract", "status", "promotion_id",
                                   "migration_operation_id", "deployment_operation_id", "transferred_at",
                               }) \
                        or not isinstance(value.get("transferred_at"), str) \
                        or not ISO_UTC.fullmatch(value["transferred_at"]) \
                        or sha256(canonical_json(body)) != value["transfer_sha256"] \
                        or name != f"{value['deployment_operation_id']}.{value['transfer_sha256']}.json":
                    reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
                if value["active_fence_sha256"] == active["active_fence_sha256"]:
                    matching_transfers.append(value)
            if len(matching_transfers) > 1:
                reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
            if len(matching_transfers) == 1:
                transfer = matching_transfers[0]
                current_raw, _ = trusted_regular_file(
                    UAT_PROMOTION_CURRENT_FILE, 0o400,
                    code="SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID",
                )
                current = strict_json(current_raw, "SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
                expected_binding = sha256(canonical_json({
                    "deployment_result_sha256": transfer["deployment_result_sha256"],
                    "fence_transfer_sha256": transfer["transfer_sha256"],
                }))
                if current_raw != canonical_json(current) or not isinstance(current, dict) \
                        or not isinstance(current.get("checkpoint_ordinal"), int) \
                        or not isinstance(current.get("authorization_sha256_chain"), list):
                    reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
                transferred = current.get("promotion_id") == active["promotion_id"] \
                    and current["checkpoint_ordinal"] >= 9 \
                    and current.get("compose_deployment_binding_sha256") == expected_binding \
                    and transfer["deployment_authorization_sha256"] in current["authorization_sha256_chain"] \
                    and transfer["migration_operation_id"] == active["migration_operation_id"] \
                    and transfer["migration_execution_authorization_sha256"] == active["execution_authorization_sha256"]
        active_recovery = authorization.get("contract") == UAT_PROMOTION_AUTHORIZATION_CONTRACT \
            and authorization.get("operation") == "RECOVER_UAT_PROMOTION" \
            and isinstance(active_parameters, dict) \
            and active_parameters.get("original_operation") == "MIGRATION_EXECUTION" \
            and active_parameters.get("original_operation_id") == active["migration_operation_id"] \
            and active_parameters.get("original_authorization_sha256") == active["execution_authorization_sha256"] \
            and active_parameters.get("promotion_id") == active["promotion_id"]
        active_deployment = authorization.get("contract") == UAT_PROMOTION_AUTHORIZATION_CONTRACT \
            and authorization.get("operation") == "DEPLOY_UAT_RELEASE" \
            and isinstance(active_parameters, dict) \
            and active_parameters.get("migration_operation_id") == active["migration_operation_id"] \
            and active_parameters.get("migration_execution_authorization_sha256") == active["execution_authorization_sha256"] \
            and active_parameters.get("active_migration_fence_sha256") == active["active_fence_sha256"] \
            and active_parameters.get("promotion_id") == active["promotion_id"]
        active_deployment_recovery = authorization.get("contract") == UAT_PROMOTION_AUTHORIZATION_CONTRACT \
            and authorization.get("operation") == "RECOVER_UAT_PROMOTION" \
            and isinstance(active_parameters, dict) \
            and active_parameters.get("original_operation") == "COMPOSE_DEPLOYMENT" \
            and active_parameters.get("migration_operation_id") == active["migration_operation_id"] \
            and active_parameters.get("migration_execution_authorization_sha256") == active["execution_authorization_sha256"] \
            and active_parameters.get("active_migration_fence_sha256") == active["active_fence_sha256"] \
            and active_parameters.get("promotion_id") == active["promotion_id"]
        if not transferred and not active_recovery and not active_deployment and not active_deployment_recovery:
            reject("SUPERVISOR_UAT_PROMOTION_ACTIVE_MIGRATION_FENCE_PRESENT")
    intents_root = UAT_PROMOTION_STATE_ROOT / "intents"
    trusted_owned_directory(intents_root, 0, 0, {0o700}, "SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
    try:
        names = sorted(os.listdir(intents_root))
    except OSError:
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
    if len(names) > 20_000 or any(not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.[0-9a-f]{64}\.json", name) for name in names):
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
    execution_intents: list[dict[str, Any]] = []
    postdeploy_intents: list[dict[str, Any]] = []
    for name in names:
        raw, _ = trusted_regular_file(
            intents_root / name, 0o400, code="SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID",
        )
        value = strict_json(raw, "SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
        if not isinstance(value, dict):
            continue
        if value.get("contract") == "chenyida-erp-uat-promotion-migration-execution-intent/v1":
            if raw != canonical_json(value) or value.get("schema_version") != 1 \
                or not isinstance(value.get("migration_operation_id"), str) \
                or not IDENTIFIER.fullmatch(value["migration_operation_id"]) \
                or not isinstance(value.get("execution_authorization_sha256"), str) \
                or not SHA256.fullmatch(value["execution_authorization_sha256"]) \
                or name != f"{value['migration_operation_id']}.{value.get('migration_execution_intent_sha256')}.json":
                reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
            execution_intents.append(value)
            continue
        postdeploy_contracts = {
            "chenyida-erp-uat-promotion-postdeploy-runtime-intent/v1": (
                "POSTDEPLOY_RUNTIME_CONFIGURATION", "postdeploy_runtime_intent_sha256",
            ),
            "chenyida-erp-uat-promotion-postdeploy-identity-intent/v1": (
                "POSTDEPLOY_IDENTITY", "postdeploy_identity_intent_sha256",
            ),
        }
        binding = postdeploy_contracts.get(value.get("contract"))
        if binding is None:
            continue
        original_operation, digest_field = binding
        if raw != canonical_json(value) or value.get("schema_version") != 1 \
                or not isinstance(value.get("verification_operation_id"), str) \
                or not IDENTIFIER.fullmatch(value["verification_operation_id"]) \
                or not isinstance(value.get("execution_authorization_sha256"), str) \
                or not SHA256.fullmatch(value["execution_authorization_sha256"]) \
                or not isinstance(value.get(digest_field), str) or not SHA256.fullmatch(value[digest_field]) \
                or name != f"{value['verification_operation_id']}.{value[digest_field]}.json":
            reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
        postdeploy_intents.append({
            "operation": original_operation,
            "operation_id": value["verification_operation_id"],
            "execution_authorization_sha256": value["execution_authorization_sha256"],
        })
    if not execution_intents and not postdeploy_intents:
        return
    try:
        current_raw, _ = trusted_regular_file(
            UAT_PROMOTION_CURRENT_FILE, 0o400, code="SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID",
        )
        current = strict_json(current_raw, "SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
    except SupervisorError:
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
    if current_raw != canonical_json(current) or not isinstance(current, dict) \
            or not isinstance(current.get("authorization_sha256_chain"), list) \
            or any(not isinstance(item, str) or not SHA256.fullmatch(item) for item in current["authorization_sha256_chain"]):
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_INTERLOCK_INVALID")
    pending = [
        intent for intent in execution_intents
        if intent["execution_authorization_sha256"] not in current["authorization_sha256_chain"]
    ]
    parameters = authorization.get("parameters") if isinstance(authorization, dict) else None
    if pending:
        same_pending_run = authorization.get("contract") == UAT_PROMOTION_AUTHORIZATION_CONTRACT \
            and authorization.get("operation") == "RUN_UAT_PROMOTION_MIGRATION" and len(pending) == 1 \
            and authorization.get("authorization_id") == pending[0]["migration_operation_id"] \
            and authorization_digest == pending[0]["execution_authorization_sha256"]
        recovery_allowed = authorization.get("contract") == UAT_PROMOTION_AUTHORIZATION_CONTRACT \
            and authorization.get("operation") == "RECOVER_UAT_PROMOTION" and isinstance(parameters, dict) \
            and parameters.get("original_operation") == "MIGRATION_EXECUTION" and len(pending) == 1 \
            and parameters.get("original_operation_id") == pending[0]["migration_operation_id"] \
            and parameters.get("original_authorization_sha256") == pending[0]["execution_authorization_sha256"]
        if not same_pending_run and not recovery_allowed:
            reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_RECOVERY_REQUIRED")
    pending_postdeploy = [
        intent for intent in postdeploy_intents
        if intent["execution_authorization_sha256"] not in current["authorization_sha256_chain"]
    ]
    if not pending_postdeploy:
        return
    operation_names = {
        "POSTDEPLOY_RUNTIME_CONFIGURATION": "VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION",
        "POSTDEPLOY_IDENTITY": "VERIFY_UAT_POSTDEPLOY_IDENTITY",
    }
    same_pending_postdeploy = authorization.get("contract") == UAT_PROMOTION_AUTHORIZATION_CONTRACT \
        and len(pending_postdeploy) == 1 \
        and authorization.get("operation") == operation_names[pending_postdeploy[0]["operation"]] \
        and authorization.get("authorization_id") == pending_postdeploy[0]["operation_id"] \
        and authorization_digest == pending_postdeploy[0]["execution_authorization_sha256"]
    postdeploy_recovery_allowed = authorization.get("contract") == UAT_PROMOTION_AUTHORIZATION_CONTRACT \
        and authorization.get("operation") == "RECOVER_UAT_PROMOTION" and isinstance(parameters, dict) \
        and len(pending_postdeploy) == 1 \
        and parameters.get("original_operation") == pending_postdeploy[0]["operation"] \
        and parameters.get("original_operation_id") == pending_postdeploy[0]["operation_id"] \
        and parameters.get("original_authorization_sha256") == pending_postdeploy[0]["execution_authorization_sha256"]
    if not same_pending_postdeploy and not postdeploy_recovery_allowed:
        reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_RECOVERY_REQUIRED")


def _docker(arguments: list[str], *, timeout: int, stdout: int = subprocess.PIPE) -> subprocess.CompletedProcess[bytes]:
    environment = {"PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent"}
    try:
        return subprocess.run(["/usr/bin/docker", *arguments], env=environment, stdin=subprocess.DEVNULL, stdout=stdout, stderr=subprocess.DEVNULL, check=False, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_NODE_RUNTIME_FAILED")


def prepare_runtime_privilege_node(authorization_digest: str) -> tuple[Path, Path]:
    if not SHA256.fullmatch(authorization_digest):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_NODE_RUNTIME_FAILED")
    inspected = _docker(["image", "inspect", RUNTIME_PRIVILEGE_NODE_IMAGE], timeout=15, stdout=subprocess.DEVNULL)
    if inspected.returncode != 0:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_NODE_IMAGE_UNAVAILABLE")
    runtime_root = Path(tempfile.mkdtemp(prefix="chenyida-erp-runtime-privilege-node.", dir="/tmp"))
    os.chown(runtime_root, 0, 0)
    os.chmod(runtime_root, 0o700)
    container_name = f"cyd-runtime-privilege-node-{authorization_digest}"
    container_id: str | None = None
    try:
        try:
            created = _docker([
                "create", "--pull=never", "--name", container_name,
                "--label", f"chenyida.erp.runtime-privilege-node={authorization_digest}",
                "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                "--memory", "64m", "--memory-swap", "64m", "--cpus", "0.25", "--pids-limit", "16",
                RUNTIME_PRIVILEGE_NODE_IMAGE, "true",
            ], timeout=30)
            candidate = created.stdout.decode("ascii", errors="strict").strip() if created.returncode == 0 else ""
            if not re.fullmatch(r"[0-9a-f]{64}", candidate):
                reject("SUPERVISOR_RUNTIME_PRIVILEGE_NODE_RUNTIME_FAILED")
            container_id = candidate
            copied = _docker(["cp", f"{container_id}:/usr/local/bin/node", str(runtime_root / "node")], timeout=30)
            if copied.returncode != 0:
                reject("SUPERVISOR_RUNTIME_PRIVILEGE_NODE_RUNTIME_FAILED")
            node_path = runtime_root / "node"
            node_metadata = os.lstat(node_path)
            if not stat.S_ISREG(node_metadata.st_mode) or stat.S_ISLNK(node_metadata.st_mode) or node_metadata.st_nlink != 1:
                reject("SUPERVISOR_RUNTIME_PRIVILEGE_NODE_RUNTIME_FAILED")
            os.chown(node_path, 0, 0)
            os.chmod(node_path, 0o555)
            node_metadata = os.lstat(node_path)
            if node_metadata.st_uid != 0 or node_metadata.st_gid != 0 or stat.S_IMODE(node_metadata.st_mode) != 0o555 or node_metadata.st_nlink != 1:
                reject("SUPERVISOR_RUNTIME_PRIVILEGE_NODE_RUNTIME_FAILED")
            with open(node_path, "rb") as handle:
                os.fsync(handle.fileno())
        finally:
            if container_id is not None:
                ownership = _docker(["inspect", "--format", '{{index .Config.Labels "chenyida.erp.runtime-privilege-node"}}|{{.Name}}', container_id], timeout=15)
                expected = f"{authorization_digest}|/{container_name}\n".encode("ascii")
                if ownership.returncode != 0 or ownership.stdout != expected:
                    reject("SUPERVISOR_RUNTIME_PRIVILEGE_NODE_OWNERSHIP_INVALID")
                removed = _docker(["rm", "-f", container_id], timeout=30, stdout=subprocess.DEVNULL)
                if removed.returncode != 0:
                    reject("SUPERVISOR_RUNTIME_PRIVILEGE_NODE_CLEANUP_FAILED")
    except Exception:
        cleanup_runtime_privilege_node(runtime_root)
        raise
    return runtime_root, node_path


def cleanup_runtime_privilege_node(runtime_root: Path | None) -> None:
    if runtime_root is None:
        return
    try:
        resolved = runtime_root.resolve(strict=True)
    except OSError:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_NODE_CLEANUP_FAILED")
    if resolved.parent != Path("/tmp") or not resolved.name.startswith("chenyida-erp-runtime-privilege-node.") or resolved == Path("/tmp"):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_NODE_CLEANUP_FAILED")
    shutil.rmtree(resolved)


def monitoring_projection_context(authorization: dict[str, Any], authorization_digest: str) -> dict[str, Any]:
    parameters = authorization["parameters"]
    backup = authorization["operation"] == "PUBLISH_MONITORING_BACKUP_PROJECTION"
    sources = {
        "active": parameters["active_source"],
        "host_config": parameters["host_config_source"],
        "release_identity": parameters["release_identity_source"],
        "postdeploy_receipt": parameters["postdeploy_receipt_source"],
    }
    if backup:
        sources.update({
            "backup_readiness": parameters["backup_readiness_source"],
            "cluster_policy": parameters["cluster_policy_source"],
            "cluster_policy_activation": parameters["cluster_policy_activation_source"],
            "cluster_policy_history": parameters["cluster_policy_history_source"],
            "cluster_policy_receipt": parameters["cluster_policy_receipt_source"],
        })
    return {
        "schema_version": 1,
        "contract": MONITORING_PROJECTION_CONTRACT,
        "operation": "BACKUP" if backup else "COMPONENTS",
        "authorization_sha256": authorization_digest,
        "supervisor_bundle_sha256": authorization["supervisor_bundle_sha256"],
        "projection_root": parameters["projection_root"],
        "projection": {
            "reader_gid": parameters["projection_reader_gid"],
            "generation": parameters["projection_generation"],
            "previous_projection_sha256": parameters["previous_projection_sha256"],
            "published_at": parameters["projection_published_at"],
            "expected_source_sha256": parameters["expected_source_sha256"],
            "expected_projection_sha256": parameters["expected_projection_sha256"],
        },
        "sources": sources,
    }


def run_monitoring_projection_authorization(bundle_root: Path, authorization_path: Path, authorization: dict[str, Any],
                                            authorization_digest: str, lock_descriptor: int) -> dict[str, Any]:
    runtime_root: Path | None = None
    operation = authorization["operation"]
    try:
        verify_monitoring_projection_sources(authorization["parameters"], operation)
        runtime_root, node_path = prepare_runtime_privilege_node(authorization_digest)
        verify_monitoring_projection_sources(authorization["parameters"], operation)
        context = monitoring_projection_context(authorization, authorization_digest)
        consume_authorization(authorization_path, authorization, authorization_digest)
        verify_monitoring_projection_sources(authorization["parameters"], operation)
        publisher = bundle_root / "chenyida_erp_site/tools/ops-monitoring/projection-publisher.mjs"
        environment = {
            "PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent",
            "ERP_RELEASE_SUPERVISOR_LAUNCHED": "YES", "ERP_RELEASE_GATE_LOCK_HELD": "YES",
            "ERP_RELEASE_GATE_LOCK_FD": str(lock_descriptor),
            "ERP_RELEASE_SUPERVISOR_SITE_ROOT": str(bundle_root / "chenyida_erp_site"),
            "ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256": authorization["supervisor_bundle_sha256"],
            "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256": authorization_digest,
            "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED": "YES",
        }
        try:
            result = subprocess.run(
                [str(node_path), "--max-old-space-size=64", "--disable-proto=throw", str(publisher)],
                env=environment, input=canonical_json(context), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                check=False, timeout=120, pass_fds=(lock_descriptor,),
            )
        except (OSError, subprocess.SubprocessError):
            reject("SUPERVISOR_MONITORING_PROJECTION_RUNNER_FAILED")
        if result.returncode != 0 or result.stderr != b"" or len(result.stdout) < 2 or len(result.stdout) > 64 * 1024:
            reject("SUPERVISOR_MONITORING_PROJECTION_RUNNER_FAILED")
        value = strict_json(result.stdout, "SUPERVISOR_MONITORING_PROJECTION_RESPONSE_INVALID")
        expected_kind = "backup" if operation == "PUBLISH_MONITORING_BACKUP_PROJECTION" else "components"
        expected = authorization["parameters"]
        if result.stdout != canonical_json(value) or not isinstance(value, dict) or set(value) != {"result", "kind", "generation", "projection_sha256", "source_sha256"} \
            or value.get("result") not in {"PUBLISHED", "ALREADY_PUBLISHED"} or value.get("kind") != expected_kind \
            or value.get("generation") != expected["projection_generation"] or value.get("projection_sha256") != expected["expected_projection_sha256"] \
            or value.get("source_sha256") != expected["expected_source_sha256"]:
            reject("SUPERVISOR_MONITORING_PROJECTION_RESPONSE_INVALID")
        return value
    finally:
        cleanup_runtime_privilege_node(runtime_root)


def cluster_policy_context(authorization: dict[str, Any], authorization_digest: str) -> dict[str, Any]:
    parameters = authorization["parameters"]
    recovery = authorization["operation"] == "RECOVER_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2_ACTIVATION"
    operation = parameters["original_operation"] if recovery else CLUSTER_POLICY_OPERATIONS[authorization["operation"]]
    policy_parameters = {field: parameters[field] for field in CLUSTER_POLICY_BASE_PARAMETER_FIELDS}
    return {
        "schema_version": 1,
        "contract": "chenyida-erp-postgresql-cluster-recovery-policy-activation-context/v1",
        "operation_id": parameters["original_operation_id"] if recovery else authorization["authorization_id"],
        "operation": operation,
        "execution_mode": "RECOVERY" if recovery else "ORIGINAL",
        "execution_authorization_id": authorization["authorization_id"],
        "execution_authorization_sha256": authorization_digest,
        "execution_created_at": authorization["created_at"],
        "original_authorization_sha256": parameters["original_authorization_sha256"] if recovery else authorization_digest,
        "supervisor_bundle_sha256": authorization["supervisor_bundle_sha256"],
        "expected_intent_sha256": parameters["expected_intent_sha256"] if recovery else None,
        "parameters": policy_parameters,
    }


def run_cluster_policy_runner(node_path: Path, bundle_root: Path, context: dict[str, Any], phase: str, lock_descriptor: int) -> dict[str, Any]:
    confirmations = {
        "prepare": "PREPARE_CLUSTER_POLICY_ACTIVATION_INTENT",
        "execute": "COMMIT_CLUSTER_POLICY_ACTIVATION_AFTER_AUTHORIZATION",
        "recover-prepare": "PREPARE_CLUSTER_POLICY_ACTIVATION_RECOVERY",
        "recover-execute": "EXECUTE_CLUSTER_POLICY_ACTIVATION_RECOVERY_AFTER_AUTHORIZATION",
    }
    if phase not in confirmations:
        reject("SUPERVISOR_CLUSTER_POLICY_RUNNER_PHASE_INVALID")
    publisher = bundle_root / "chenyida_erp_site/scripts/postgresql-cluster-recovery-policy-v2-publisher.mjs"
    consumed = phase in ("execute", "recover-execute")
    environment = {
        "PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent",
        "ERP_RELEASE_SUPERVISOR_LAUNCHED": "YES", "ERP_RELEASE_GATE_LOCK_HELD": "YES",
        "ERP_RELEASE_GATE_LOCK_FD": str(lock_descriptor),
        "ERP_RELEASE_SUPERVISOR_SITE_ROOT": str(bundle_root / "chenyida_erp_site"),
        "ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256": context["supervisor_bundle_sha256"],
        "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256": context["execution_authorization_sha256"],
        "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED": "YES" if consumed else "NO",
        "ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED": "YES" if context["execution_mode"] == "RECOVERY" else "NO",
    }
    try:
        result = subprocess.run(
            [str(node_path), "--max-old-space-size=64", "--disable-proto=throw", str(publisher), phase, confirmations[phase]],
            env=environment, input=canonical_json(context), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            check=False, timeout=120, pass_fds=(lock_descriptor,),
        )
    except (OSError, subprocess.SubprocessError):
        reject("SUPERVISOR_CLUSTER_POLICY_RUNNER_FAILED")
    if result.returncode != 0 or result.stderr != b"" or len(result.stdout) < 2 or len(result.stdout) > 64 * 1024:
        reject("SUPERVISOR_CLUSTER_POLICY_RUNNER_FAILED")
    value = strict_json(result.stdout, "SUPERVISOR_CLUSTER_POLICY_RUNNER_RESPONSE_INVALID")
    if result.stdout != canonical_json(value) or not isinstance(value, dict) or value.get("operation_id") != context["operation_id"]:
        reject("SUPERVISOR_CLUSTER_POLICY_RUNNER_RESPONSE_INVALID")
    if phase == "prepare":
        expected_results = {"PREPARED"}
        expected_fields = {"result", "operation_id", "intent_sha256", "policy_sha256", "receipt_sha256"}
        digest_fields = {"intent_sha256", "policy_sha256", "receipt_sha256"}
    elif phase == "execute":
        expected_results = {"COMMITTED", "ALREADY_COMMITTED"}
        expected_fields = {"result", "operation_id", "intent_sha256", "policy_sha256", "receipt_sha256"}
        digest_fields = {"intent_sha256", "policy_sha256", "receipt_sha256"}
    elif phase == "recover-prepare":
        expected_results = {"RECOVERY_PREPARED"}
        expected_fields = {"result", "operation_id", "intent_sha256", "recovery_sha256", "decision"}
        digest_fields = {"intent_sha256", "recovery_sha256"}
        if value.get("decision") not in {"RESUME_PUBLICATION", "ALREADY_COMMITTED", "QUARANTINE"}:
            reject("SUPERVISOR_CLUSTER_POLICY_RUNNER_RESPONSE_INVALID")
    elif value.get("result") in {"COMMITTED", "ALREADY_COMMITTED"}:
        expected_results = {"COMMITTED", "ALREADY_COMMITTED"}
        expected_fields = {"result", "operation_id", "intent_sha256", "policy_sha256", "receipt_sha256", "recovery_sha256"}
        digest_fields = {"intent_sha256", "policy_sha256", "receipt_sha256", "recovery_sha256"}
    else:
        expected_results = {"QUARANTINED"}
        expected_fields = {"result", "operation_id", "intent_sha256", "recovery_sha256", "quarantine_sha256"}
        digest_fields = {"intent_sha256", "recovery_sha256", "quarantine_sha256"}
    if set(value) != expected_fields or value.get("result") not in expected_results \
        or any(not isinstance(value.get(field), str) or not SHA256.fullmatch(value[field]) or value[field] == "0" * 64 for field in digest_fields):
        reject("SUPERVISOR_CLUSTER_POLICY_RUNNER_RESPONSE_INVALID")
    return value


def run_cluster_policy_authorization(bundle_root: Path, authorization_path: Path, authorization: dict[str, Any],
                                     authorization_digest: str, lock_descriptor: int | None = None) -> dict[str, Any]:
    owns_lock = lock_descriptor is None
    if lock_descriptor is None:
        lock_descriptor = acquire_global_release_lock()
    runtime_root: Path | None = None
    try:
        recovery = authorization["operation"] == "RECOVER_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2_ACTIVATION"
        if recovery:
            validate_original_cluster_policy_authorization_consumed(authorization["parameters"], authorization["supervisor_bundle_sha256"])
        else:
            verify_cluster_policy_sources(authorization["parameters"])
        runtime_root, node_path = prepare_runtime_privilege_node(authorization_digest)
        context = cluster_policy_context(authorization, authorization_digest)
        run_cluster_policy_runner(node_path, bundle_root, context, "recover-prepare" if recovery else "prepare", lock_descriptor)
        if not recovery:
            verify_cluster_policy_sources(authorization["parameters"])
        consume_authorization(authorization_path, authorization, authorization_digest)
        if not recovery:
            verify_cluster_policy_sources(authorization["parameters"])
        return run_cluster_policy_runner(node_path, bundle_root, context, "recover-execute" if recovery else "execute", lock_descriptor)
    finally:
        try:
            cleanup_runtime_privilege_node(runtime_root)
        finally:
            if owns_lock:
                os.close(lock_descriptor)


def uat_promotion_context(authorization: dict[str, Any], authorization_digest: str) -> dict[str, Any]:
    parameters = authorization["parameters"]
    recovery = authorization["operation"] == "RECOVER_UAT_PROMOTION"
    snapshot = authorization["operation"] == "CAPTURE_UAT_PROMOTION_SNAPSHOT" \
        or recovery and parameters.get("original_operation") == "CAPTURE_SNAPSHOT"
    quiesce = authorization["operation"] == "QUIESCE_UAT_WRITERS" \
        or recovery and parameters.get("original_operation") == "QUIESCE_WRITERS"
    migration_authorization = authorization["operation"] == "AUTHORIZE_UAT_PROMOTION_MIGRATION" \
        or recovery and parameters.get("original_operation") == "MIGRATION_AUTHORIZATION"
    migration_execution = authorization["operation"] == "RUN_UAT_PROMOTION_MIGRATION" \
        or recovery and parameters.get("original_operation") == "MIGRATION_EXECUTION"
    compose_deployment = authorization["operation"] == "DEPLOY_UAT_RELEASE" \
        or recovery and parameters.get("original_operation") == "COMPOSE_DEPLOYMENT"
    postdeploy_runtime = authorization["operation"] == "VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION" \
        or recovery and parameters.get("original_operation") == "POSTDEPLOY_RUNTIME_CONFIGURATION"
    postdeploy_identity = authorization["operation"] == "VERIFY_UAT_POSTDEPLOY_IDENTITY" \
        or recovery and parameters.get("original_operation") == "POSTDEPLOY_IDENTITY"
    parameter_fields = UAT_PROMOTION_SNAPSHOT_PARAMETER_FIELDS if snapshot \
        else UAT_PROMOTION_QUIESCE_PARAMETER_FIELDS if quiesce \
        else UAT_PROMOTION_MIGRATION_AUTHORIZATION_PARAMETER_FIELDS if migration_authorization \
        else UAT_PROMOTION_MIGRATION_EXECUTION_PARAMETER_FIELDS if migration_execution \
        else UAT_PROMOTION_COMPOSE_DEPLOYMENT_PARAMETER_FIELDS if compose_deployment \
        else UAT_PROMOTION_POSTDEPLOY_RUNTIME_PARAMETER_FIELDS if postdeploy_runtime \
        else UAT_PROMOTION_POSTDEPLOY_IDENTITY_PARAMETER_FIELDS if postdeploy_identity \
        else UAT_PROMOTION_BASE_PARAMETER_FIELDS
    promotion_parameters = {field: parameters[field] for field in parameter_fields}
    return {
        "schema_version": 1,
        "contract": "chenyida-erp-uat-promotion-transaction-context/v1",
        "operation_id": parameters["original_operation_id"] if recovery else authorization["authorization_id"],
        "operation": "CAPTURE_SNAPSHOT" if snapshot else "QUIESCE_WRITERS" if quiesce \
            else "MIGRATION_AUTHORIZATION" if migration_authorization \
            else "MIGRATION_EXECUTION" if migration_execution \
            else "COMPOSE_DEPLOYMENT" if compose_deployment \
            else "POSTDEPLOY_RUNTIME_CONFIGURATION" if postdeploy_runtime \
            else "POSTDEPLOY_IDENTITY" if postdeploy_identity else "BEGIN",
        "execution_mode": "RECOVERY" if recovery else "ORIGINAL",
        "execution_authorization_id": authorization["authorization_id"],
        "execution_authorization_sha256": authorization_digest,
        "execution_created_at": authorization["created_at"],
        "original_authorization_sha256": parameters["original_authorization_sha256"] if recovery else authorization_digest,
        "supervisor_bundle_sha256": authorization["supervisor_bundle_sha256"],
        "expected_intent_sha256": parameters["expected_intent_sha256"] if recovery else None,
        "parameters": promotion_parameters,
    }


def run_uat_promotion_runner(node_path: Path, bundle_root: Path, context: dict[str, Any], phase: str,
                             lock_descriptor: int, *, failure_stage: str | None = None,
                             failure_code: str | None = None,
                             expected_postdeploy_result_sha256: str | None = None) -> dict[str, Any]:
    confirmations = {
        "prepare": "PREPARE_UAT_PROMOTION_DURABLE_INTENT",
        "execute": "COMMIT_UAT_PROMOTION_JOURNAL_AFTER_AUTHORIZATION",
        "recover-prepare": "PREPARE_UAT_PROMOTION_RECOVERY",
        "recover-execute": "EXECUTE_UAT_PROMOTION_RECOVERY_AFTER_AUTHORIZATION",
        "contain": "CONTAIN_FAILED_UAT_PROMOTION_POSTDEPLOY_OPERATION",
    }
    if phase not in confirmations:
        reject("SUPERVISOR_UAT_PROMOTION_RUNNER_PHASE_INVALID")
    if phase == "contain":
        if UAT_PROMOTION_POSTDEPLOY_FAILURE_CODES.get(failure_stage) != failure_code:
            reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_FAILURE_CLASSIFICATION_INVALID")
    elif failure_stage is not None or failure_code is not None:
        reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_FAILURE_CLASSIFICATION_INVALID")
    postdeploy_execute = phase == "execute" and context.get("operation") in {
        "POSTDEPLOY_RUNTIME_CONFIGURATION", "POSTDEPLOY_IDENTITY",
    }
    if postdeploy_execute:
        if not isinstance(expected_postdeploy_result_sha256, str) \
                or not SHA256.fullmatch(expected_postdeploy_result_sha256):
            reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_EXPECTED_RESULT_INVALID")
    elif expected_postdeploy_result_sha256 is not None:
        reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_EXPECTED_RESULT_INVALID")
    publisher = bundle_root / "chenyida_erp_site/scripts/uat-promotion-transaction-journal.mjs"
    consumed = phase in ("execute", "recover-execute", "contain")
    environment = {
        "PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent",
        "ERP_RELEASE_SUPERVISOR_LAUNCHED": "YES", "ERP_RELEASE_GATE_LOCK_HELD": "YES",
        "ERP_RELEASE_GATE_LOCK_FD": str(lock_descriptor),
        "ERP_RELEASE_SUPERVISOR_SITE_ROOT": str(bundle_root / "chenyida_erp_site"),
        "ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256": context["supervisor_bundle_sha256"],
        "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256": context["execution_authorization_sha256"],
        "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED": "YES" if consumed else "NO",
        "ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED": "YES" if context["execution_mode"] == "RECOVERY" else "NO",
    }
    if phase == "contain":
        environment["ERP_UAT_PROMOTION_POSTDEPLOY_FAILURE_STAGE"] = failure_stage
        environment["ERP_UAT_PROMOTION_POSTDEPLOY_FAILURE_CODE"] = failure_code
    if postdeploy_execute:
        environment["ERP_UAT_PROMOTION_POSTDEPLOY_EXPECTED_RESULT_SHA256"] = \
            expected_postdeploy_result_sha256
    try:
        result = subprocess.run(
            [str(node_path), "--max-old-space-size=64", "--disable-proto=throw", str(publisher), phase, confirmations[phase]],
            env=environment, input=canonical_json(context), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            check=False, timeout=120, pass_fds=(lock_descriptor,),
        )
    except (OSError, subprocess.SubprocessError):
        reject("SUPERVISOR_UAT_PROMOTION_RUNNER_FAILED")
    if result.returncode != 0 or result.stderr != b"" or len(result.stdout) < 2 or len(result.stdout) > 64 * 1024:
        reject("SUPERVISOR_UAT_PROMOTION_RUNNER_FAILED")
    value = strict_json(result.stdout, "SUPERVISOR_UAT_PROMOTION_RUNNER_RESPONSE_INVALID")
    if result.stdout != canonical_json(value) or not isinstance(value, dict) or value.get("promotion_id") != context["parameters"]["promotion_id"]:
        reject("SUPERVISOR_UAT_PROMOTION_RUNNER_RESPONSE_INVALID")
    if phase == "prepare":
        expected_results = {"PREPARED", "ALREADY_PREPARED"}
        if context["operation"] == "MIGRATION_EXECUTION":
            expected_fields = {"result", "promotion_id", "intent_sha256", "grant_sha256"}
            digest_fields = {"intent_sha256", "grant_sha256"}
        elif context["operation"] == "COMPOSE_DEPLOYMENT":
            expected_fields = {"result", "promotion_id", "intent_sha256", "deployment_plan_sha256"}
            digest_fields = {"intent_sha256", "deployment_plan_sha256"}
        elif context["operation"] in ("POSTDEPLOY_RUNTIME_CONFIGURATION", "POSTDEPLOY_IDENTITY"):
            expected_fields = {"result", "promotion_id", "intent_sha256", "verification_plan_sha256"}
            digest_fields = {"intent_sha256", "verification_plan_sha256"}
        else:
            expected_fields = {"result", "promotion_id", "intent_sha256", "receipt_sha256"}
            digest_fields = {"intent_sha256", "receipt_sha256"}
    elif phase == "execute":
        expected_results = {"COMMITTED", "ALREADY_COMMITTED"}
        expected_fields = {"result", "promotion_id", "intent_sha256", "receipt_sha256"}
        digest_fields = {"intent_sha256", "receipt_sha256"}
        if context["operation"] == "MIGRATION_EXECUTION":
            expected_fields.add("migration_result_sha256")
            digest_fields.add("migration_result_sha256")
        elif context["operation"] == "COMPOSE_DEPLOYMENT":
            expected_fields |= {"deployment_result_sha256", "fence_transfer_sha256"}
            digest_fields |= {"deployment_result_sha256", "fence_transfer_sha256"}
        elif context["operation"] == "POSTDEPLOY_RUNTIME_CONFIGURATION":
            expected_fields.add("runtime_probe_result_sha256")
            digest_fields.add("runtime_probe_result_sha256")
        elif context["operation"] == "POSTDEPLOY_IDENTITY":
            expected_fields |= {
                "postdeploy_identity_evidence_sha256", "postdeploy_receipt_sha256", "release_identity_sha256",
            }
            digest_fields |= {
                "postdeploy_identity_evidence_sha256", "postdeploy_receipt_sha256", "release_identity_sha256",
            }
    elif phase == "recover-prepare":
        expected_results = {"RECOVERY_PREPARED"}
        expected_fields = {"result", "promotion_id", "intent_sha256", "recovery_sha256", "decision"}
        digest_fields = {"intent_sha256", "recovery_sha256"}
        if value.get("decision") not in {"RESUME_PUBLICATION", "ALREADY_COMMITTED", "QUARANTINE"}:
            reject("SUPERVISOR_UAT_PROMOTION_RUNNER_RESPONSE_INVALID")
    elif phase == "contain":
        expected_results = {"CONTAINED", "COMMITTED_ANOMALY_RECORDED"}
        expected_fields = {"result", "promotion_id", "intent_sha256", "containment_sha256"}
        digest_fields = {"intent_sha256", "containment_sha256"}
    elif value.get("result") in {"COMMITTED", "ALREADY_COMMITTED"}:
        expected_results = {"COMMITTED", "ALREADY_COMMITTED"}
        expected_fields = {"result", "promotion_id", "intent_sha256", "receipt_sha256", "recovery_sha256"}
        digest_fields = {"intent_sha256", "receipt_sha256", "recovery_sha256"}
        if context["operation"] == "MIGRATION_EXECUTION":
            expected_fields.add("migration_result_sha256")
            digest_fields.add("migration_result_sha256")
        elif context["operation"] == "COMPOSE_DEPLOYMENT":
            expected_fields |= {"deployment_result_sha256", "fence_transfer_sha256"}
            digest_fields |= {"deployment_result_sha256", "fence_transfer_sha256"}
        elif context["operation"] == "POSTDEPLOY_RUNTIME_CONFIGURATION":
            expected_fields.add("runtime_probe_result_sha256")
            digest_fields.add("runtime_probe_result_sha256")
        elif context["operation"] == "POSTDEPLOY_IDENTITY":
            expected_fields |= {
                "postdeploy_identity_evidence_sha256", "postdeploy_receipt_sha256", "release_identity_sha256",
            }
            digest_fields |= {
                "postdeploy_identity_evidence_sha256", "postdeploy_receipt_sha256", "release_identity_sha256",
            }
    else:
        expected_results = {"QUARANTINED"}
        expected_fields = {"result", "promotion_id", "intent_sha256", "recovery_sha256", "quarantine_sha256"}
        digest_fields = {"intent_sha256", "recovery_sha256", "quarantine_sha256"}
    if set(value) != expected_fields or value.get("result") not in expected_results \
        or any(not isinstance(value.get(field), str) or not SHA256.fullmatch(value[field]) or value[field] == "0" * 64 for field in digest_fields):
        reject("SUPERVISOR_UAT_PROMOTION_RUNNER_RESPONSE_INVALID")
    return value


def run_uat_promotion_migration_control(bundle_root: Path, context: dict[str, Any], grant_sha256: str,
                                        lock_descriptor: int) -> dict[str, Any]:
    if context["operation"] != "MIGRATION_EXECUTION" or context["execution_mode"] != "ORIGINAL" \
            or not isinstance(grant_sha256, str) or not SHA256.fullmatch(grant_sha256) \
            or grant_sha256 == "0" * 64:
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_CONTROL_INVALID")
    executor = bundle_root / "chenyida_erp_site/scripts/uat-promotion-migration-control.py"
    environment = {
        "PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent",
        "PYTHONDONTWRITEBYTECODE": "1", "PYTHONHASHSEED": "0",
        "ERP_RELEASE_SUPERVISOR_LAUNCHED": "YES", "ERP_RELEASE_GATE_LOCK_HELD": "YES",
        "ERP_RELEASE_GATE_LOCK_FD": str(lock_descriptor),
        "ERP_RELEASE_SUPERVISOR_SITE_ROOT": str(bundle_root / "chenyida_erp_site"),
        "ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256": context["supervisor_bundle_sha256"],
        "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256": context["execution_authorization_sha256"],
        "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED": "YES",
        "ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED": "NO",
        "ERP_UAT_PROMOTION_MIGRATION_GRANT_SHA256": grant_sha256,
    }
    try:
        result = subprocess.run(
            ["/usr/bin/python3", str(executor), "execute", "EXACT_UAT_PROMOTION_MIGRATION_AFTER_AUTHORIZATION"],
            env=environment, input=canonical_json(context), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            check=False, timeout=16 * 60, pass_fds=(lock_descriptor,),
        )
    except (OSError, subprocess.SubprocessError):
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_CONTROL_FAILED")
    if result.returncode != 0 or result.stderr != b"" or len(result.stdout) < 2 or len(result.stdout) > 64 * 1024:
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_CONTROL_FAILED")
    value = strict_json(result.stdout, "SUPERVISOR_UAT_PROMOTION_MIGRATION_CONTROL_RESPONSE_INVALID")
    fields = {
        "result", "promotion_id", "migration_operation_id", "grant_sha256", "migration_result_sha256",
        "container_id", "container_name", "execution_artifact_sha256",
    }
    value = exact_fields(value, fields, "SUPERVISOR_UAT_PROMOTION_MIGRATION_CONTROL_RESPONSE_INVALID")
    if result.stdout != canonical_json(value) or value["result"] != "MIGRATION_RESULT_PERSISTED" \
            or value["promotion_id"] != context["parameters"]["promotion_id"] \
            or value["migration_operation_id"] != context["operation_id"] \
            or value["grant_sha256"] != grant_sha256 \
            or any(not isinstance(value[field], str) or not SHA256.fullmatch(value[field]) for field in (
                "migration_result_sha256", "execution_artifact_sha256", "container_id",
            )) or not isinstance(value["container_name"], str) \
            or not re.fullmatch(r"cyd-uat-migration-[0-9a-f]{24}", value["container_name"]):
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_CONTROL_RESPONSE_INVALID")
    return value


def run_uat_promotion_migration_recovery_control(bundle_root: Path, context: dict[str, Any],
                                                 lock_descriptor: int) -> dict[str, Any]:
    if context["operation"] != "MIGRATION_EXECUTION" or context["execution_mode"] != "RECOVERY" \
            or not isinstance(context.get("expected_intent_sha256"), str) \
            or not SHA256.fullmatch(context["expected_intent_sha256"]):
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_RECOVERY_CONTROL_INVALID")
    executor = bundle_root / "chenyida_erp_site/scripts/uat-promotion-migration-control.py"
    environment = {
        "PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent",
        "PYTHONDONTWRITEBYTECODE": "1", "PYTHONHASHSEED": "0",
        "ERP_RELEASE_SUPERVISOR_LAUNCHED": "YES", "ERP_RELEASE_GATE_LOCK_HELD": "YES",
        "ERP_RELEASE_GATE_LOCK_FD": str(lock_descriptor),
        "ERP_RELEASE_SUPERVISOR_SITE_ROOT": str(bundle_root / "chenyida_erp_site"),
        "ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256": context["supervisor_bundle_sha256"],
        "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256": context["execution_authorization_sha256"],
        "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED": "YES",
        "ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED": "YES",
    }
    try:
        result = subprocess.run(
            ["/usr/bin/python3", str(executor), "recover",
             "CONTAIN_EXACT_UAT_PROMOTION_MIGRATION_BEFORE_RECOVERY"],
            env=environment, input=canonical_json(context), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            check=False, timeout=2 * 60, pass_fds=(lock_descriptor,),
        )
    except (OSError, subprocess.SubprocessError):
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_RECOVERY_CONTROL_FAILED")
    if result.returncode != 0 or result.stderr != b"" or len(result.stdout) < 2 or len(result.stdout) > 64 * 1024:
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_RECOVERY_CONTROL_FAILED")
    value = strict_json(result.stdout, "SUPERVISOR_UAT_PROMOTION_MIGRATION_RECOVERY_CONTROL_RESPONSE_INVALID")
    fields = {
        "result", "promotion_id", "migration_operation_id", "recovery_authorization_sha256",
        "active_fence_sha256", "database_fence_containment", "candidate_containment",
        "recovery_containment_sha256",
    }
    value = exact_fields(value, fields, "SUPERVISOR_UAT_PROMOTION_MIGRATION_RECOVERY_CONTROL_RESPONSE_INVALID")
    allowed_candidate_status = {
        "EXACT_CANDIDATE_STOPPED", "EXACT_CANDIDATE_ALREADY_ABSENT", "EXACT_CANDIDATE_NOT_CREATED",
    }
    if result.stdout != canonical_json(value) or value["result"] != "RECOVERY_CONTAINMENT_PERSISTED" \
            or value["promotion_id"] != context["parameters"]["promotion_id"] \
            or value["migration_operation_id"] != context["operation_id"] \
            or value["recovery_authorization_sha256"] != context["execution_authorization_sha256"] \
            or value["database_fence_containment"] != "SEALED_ZERO_CONNECTIONS" \
            or value["candidate_containment"] not in allowed_candidate_status \
            or any(not isinstance(value[field], str) or not SHA256.fullmatch(value[field]) for field in (
                "active_fence_sha256", "recovery_containment_sha256",
            )):
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_RECOVERY_CONTROL_RESPONSE_INVALID")
    return value


def run_uat_promotion_compose_deployment_control(
        node_path: Path, bundle_root: Path, context: dict[str, Any], phase: str,
        intent_sha256: str, lock_descriptor: int) -> dict[str, Any]:
    if context["operation"] != "COMPOSE_DEPLOYMENT" or phase not in ("execute", "recover") \
            or phase == "execute" and context["execution_mode"] != "ORIGINAL" \
            or phase == "recover" and context["execution_mode"] != "RECOVERY" \
            or not isinstance(intent_sha256, str) or not SHA256.fullmatch(intent_sha256):
        reject("SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_CONTROL_INVALID")
    executor = bundle_root / "chenyida_erp_site/scripts/uat-promotion-compose-deployment-control.mjs"
    environment = {
        "PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent",
        "ERP_RELEASE_SUPERVISOR_LAUNCHED": "YES", "ERP_RELEASE_GATE_LOCK_HELD": "YES",
        "ERP_RELEASE_GATE_LOCK_FD": str(lock_descriptor),
        "ERP_RELEASE_SUPERVISOR_SITE_ROOT": str(bundle_root / "chenyida_erp_site"),
        "ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256": context["supervisor_bundle_sha256"],
        "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256": context["execution_authorization_sha256"],
        "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED": "YES",
        "ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED":
            "YES" if context["execution_mode"] == "RECOVERY" else "NO",
    }
    try:
        result = subprocess.run(
            [str(node_path), "--max-old-space-size=96", "--disable-proto=throw", str(executor),
             phase, intent_sha256],
            env=environment, input=canonical_json(context), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            check=False, timeout=8 * 60, pass_fds=(lock_descriptor,),
        )
    except (OSError, subprocess.SubprocessError):
        reject("SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_CONTROL_FAILED")
    if result.returncode != 0 or result.stderr != b"" or len(result.stdout) < 2 or len(result.stdout) > 64 * 1024:
        reject("SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_CONTROL_FAILED")
    value = strict_json(result.stdout, "SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_CONTROL_RESPONSE_INVALID")
    if result.stdout != canonical_json(value) or value.get("promotion_id") != context["parameters"]["promotion_id"]:
        reject("SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_CONTROL_RESPONSE_INVALID")
    if phase == "execute" or value.get("result") == "COMPOSE_DEPLOYMENT_ALREADY_COMPLETED":
        expected = {"result", "promotion_id", "deployment_result_sha256", "fence_transfer_sha256"}
        allowed = {"COMPOSE_DEPLOYMENT_RESULT_PERSISTED"} if phase == "execute" \
            else {"COMPOSE_DEPLOYMENT_ALREADY_COMPLETED"}
        digests = ("deployment_result_sha256", "fence_transfer_sha256")
    else:
        expected = {"result", "promotion_id", "containment_sha256"}
        allowed = {"CONTAINED_FOR_JOURNAL_QUARANTINE"}
        digests = ("containment_sha256",)
    if set(value) != expected or value.get("result") not in allowed \
            or any(not isinstance(value.get(field), str) or not SHA256.fullmatch(value[field])
                   for field in digests):
        reject("SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_CONTROL_RESPONSE_INVALID")
    return value


def run_uat_promotion_postdeploy_control(
        node_path: Path, bundle_root: Path, context: dict[str, Any], lock_descriptor: int) -> dict[str, Any]:
    if context["execution_mode"] != "ORIGINAL" \
            or context["operation"] not in ("POSTDEPLOY_RUNTIME_CONFIGURATION", "POSTDEPLOY_IDENTITY"):
        reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_CONTROL_INVALID")
    parameters = context["parameters"]
    runtime = context["operation"] == "POSTDEPLOY_RUNTIME_CONFIGURATION"
    entrypoint = bundle_root / "chenyida_erp_site/scripts" / (
        "probe-postdeploy-runtime-configuration.sh" if runtime else "write-release-identity.sh"
    )
    command = [str(entrypoint)]
    command += [
        "--release-manifest", parameters["release_manifest"],
        "--release-manifest-sha256", parameters["release_manifest_sha256"],
    ]
    if runtime:
        command += [
            "--probe-root", parameters["probe_root"], "--probe-id", parameters["probe_id"],
        ]
    else:
        command += [
            "--postdeploy-root", parameters["postdeploy_root"],
            "--identity-root", parameters["identity_root"],
            "--run-id", parameters["run_id"],
        ]
    command += [
        "--reader-gid", str(parameters["reader_gid"]),
        "--runtime-guard-contract", parameters["runtime_guard_contract"],
        "--runtime-guard-mode", parameters["runtime_guard_mode"],
        "--runtime-policy-sha256", parameters["runtime_policy_sha256"],
    ]
    if not runtime:
        command += ["--runtime-configuration-sha256", parameters["runtime_configuration_sha256"]]
    command += [
        "--deployment-class", parameters["deployment_class"],
        "--deployment-id", parameters["deployment_id"],
        "--compose-project", parameters["compose_project"],
        "--compose-project-root", parameters["compose_project_root"],
        "--caddy-container", parameters["caddy_container"],
        "--postgres-container", parameters["postgres_container"],
        "--web-container", parameters["web_container"],
        "--worker-container", parameters["worker_container"],
        "--confirm", "PROBE_EXACT_POSTDEPLOY_RUNTIME_CONFIGURATION" if runtime
        else "VERIFY_AND_PUBLISH_EXACT_POSTDEPLOY_IDENTITY",
    ]
    environment = {
        "PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent",
        "ERP_RELEASE_SUPERVISOR_LAUNCHED": "YES", "ERP_RELEASE_GATE_LOCK_HELD": "YES",
        "ERP_RELEASE_GATE_LOCK_FD": str(lock_descriptor),
        "ERP_RELEASE_SUPERVISOR_SITE_ROOT": str(bundle_root / "chenyida_erp_site"),
        "ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256": context["supervisor_bundle_sha256"],
        "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256": context["execution_authorization_sha256"],
        "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED": "YES",
        "ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED": "NO",
        "ERP_RELEASE_SUPERVISOR_NODE_RUNTIME": str(node_path),
    }
    try:
        process = subprocess.Popen(
            command, env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, pass_fds=(lock_descriptor,), start_new_session=True,
        )
        try:
            stdout, stderr = process.communicate(timeout=8 * 60)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.communicate(timeout=30)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.communicate()
            reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_CONTROL_FAILED")
        result = subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
    except (OSError, subprocess.SubprocessError):
        reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_CONTROL_FAILED")
    if result.returncode != 0 or result.stderr != b"" or len(result.stdout) < 2 or len(result.stdout) > 64 * 1024:
        reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_CONTROL_FAILED")
    value = strict_json(result.stdout, "SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_CONTROL_RESPONSE_INVALID")
    if result.stdout != canonical_json(value) or not isinstance(value, dict):
        reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_CONTROL_RESPONSE_INVALID")
    if runtime:
        expected = {"result", "probe_file", "probe_sha256", "runtime_configuration_sha256"}
        if set(value) != expected or value.get("result") != "PROBED" \
                or value.get("probe_file") != str(RUNTIME_PROBE_ROOT / f"{parameters['probe_id']}.runtime-configuration-probe.json") \
                or any(not isinstance(value.get(field), str) or not SHA256.fullmatch(value[field])
                       for field in ("probe_sha256", "runtime_configuration_sha256")):
            reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_CONTROL_RESPONSE_INVALID")
    else:
        if value.get("result") == "COMMITTED":
            expected = {"result", "receipt_file", "receipt_sha256"}
            if set(value) != expected or value.get("receipt_file") != f"{parameters['run_id']}.postdeploy-receipt.json":
                reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_CONTROL_RESPONSE_INVALID")
        elif value.get("result") == "ALREADY_PUBLISHED":
            expected = {"result", "receipt_sha256"}
            if set(value) != expected:
                reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_CONTROL_RESPONSE_INVALID")
        else:
            reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_CONTROL_RESPONSE_INVALID")
        if not isinstance(value.get("receipt_sha256"), str) or not SHA256.fullmatch(value["receipt_sha256"]):
            reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_CONTROL_RESPONSE_INVALID")
    return value


def cleanup_uat_promotion_migration_container(control: dict[str, Any], context: dict[str, Any]) -> None:
    template = "|".join([
        "{{.Id}}", "{{.Name}}", '{{index .Config.Labels "chenyida.erp.uat-migration-operation"}}',
        '{{index .Config.Labels "chenyida.erp.uat-migration-grant"}}', "{{.State.Status}}",
        "{{.State.ExitCode}}", "{{.State.OOMKilled}}", "{{.RestartCount}}",
    ])
    inspected = _docker(["container", "inspect", "--format", template, control["container_id"]], timeout=20)
    expected = "|".join([
        control["container_id"], f"/{control['container_name']}", context["operation_id"],
        control["grant_sha256"], "exited", "0", "false", "0",
    ]) + "\n"
    if inspected.returncode != 0 or inspected.stdout.decode("utf-8", errors="strict") != expected:
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_CONTAINER_OWNERSHIP_INVALID")
    removed = _docker(["container", "rm", control["container_id"]], timeout=45, stdout=subprocess.DEVNULL)
    if removed.returncode != 0:
        reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_CONTAINER_CLEANUP_FAILED")


def record_uat_promotion_postdeploy_failure(
        node_path: Path, bundle_root: Path, context: dict[str, Any], lock_descriptor: int,
        failure_stage: str) -> dict[str, Any]:
    failure_code = UAT_PROMOTION_POSTDEPLOY_FAILURE_CODES.get(failure_stage)
    if failure_code is None:
        reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_FAILURE_CLASSIFICATION_INVALID")
    return run_uat_promotion_runner(
        node_path, bundle_root, context, "contain", lock_descriptor,
        failure_stage=failure_stage, failure_code=failure_code,
    )


def run_uat_promotion_authorization(bundle_root: Path, authorization_path: Path, authorization: dict[str, Any],
                                    authorization_digest: str, lock_descriptor: int | None = None) -> dict[str, Any]:
    owns_lock = lock_descriptor is None
    if lock_descriptor is None:
        lock_descriptor = acquire_global_release_lock()
    runtime_root: Path | None = None
    try:
        recovery = authorization["operation"] == "RECOVER_UAT_PROMOTION"
        snapshot = authorization["operation"] == "CAPTURE_UAT_PROMOTION_SNAPSHOT"
        quiesce = authorization["operation"] == "QUIESCE_UAT_WRITERS"
        migration_authorization = authorization["operation"] == "AUTHORIZE_UAT_PROMOTION_MIGRATION"
        migration_execution = authorization["operation"] == "RUN_UAT_PROMOTION_MIGRATION"
        compose_deployment = authorization["operation"] == "DEPLOY_UAT_RELEASE"
        postdeploy_runtime = authorization["operation"] == "VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION"
        postdeploy_identity = authorization["operation"] == "VERIFY_UAT_POSTDEPLOY_IDENTITY"
        if recovery:
            validate_original_uat_promotion_authorization_consumed(
                authorization["parameters"], authorization["supervisor_bundle_sha256"],
            )
        elif snapshot:
            verify_uat_promotion_snapshot_sources(authorization["parameters"])
        elif quiesce:
            verify_uat_promotion_quiesce_sources(authorization["parameters"])
        elif migration_authorization:
            verify_uat_promotion_migration_authorization_sources(authorization["parameters"])
        elif migration_execution:
            verify_uat_promotion_migration_execution_sources(authorization["parameters"])
        elif compose_deployment:
            verify_uat_promotion_compose_deployment_sources(authorization["parameters"])
        elif postdeploy_runtime or postdeploy_identity:
            verify_uat_promotion_postdeploy_sources(authorization["parameters"], authorization["operation"])
        else:
            validate_uat_promotion_source_documents(
                authorization["parameters"], authorization["supervisor_bundle_sha256"],
            )
        context = uat_promotion_context(authorization, authorization_digest)
        runtime_root, node_path = prepare_runtime_privilege_node(authorization_digest)
        prepared = run_uat_promotion_runner(
            node_path, bundle_root, context, "recover-prepare" if recovery else "prepare", lock_descriptor,
        )
        if snapshot:
            verify_uat_promotion_snapshot_sources(authorization["parameters"])
        elif quiesce:
            verify_uat_promotion_quiesce_sources(authorization["parameters"])
        elif migration_authorization:
            verify_uat_promotion_migration_authorization_sources(authorization["parameters"])
        elif migration_execution:
            verify_uat_promotion_migration_execution_sources(authorization["parameters"])
        elif compose_deployment:
            verify_uat_promotion_compose_deployment_sources(authorization["parameters"])
        elif postdeploy_runtime or postdeploy_identity:
            verify_uat_promotion_postdeploy_sources(authorization["parameters"], authorization["operation"])
        elif not recovery:
            validate_uat_promotion_source_documents(
                authorization["parameters"], authorization["supervisor_bundle_sha256"],
            )
        consume_authorization(authorization_path, authorization, authorization_digest)
        if snapshot:
            verify_uat_promotion_snapshot_sources(authorization["parameters"])
        elif quiesce:
            verify_uat_promotion_quiesce_sources(authorization["parameters"])
        elif migration_authorization:
            verify_uat_promotion_migration_authorization_sources(authorization["parameters"])
        elif migration_execution:
            verify_uat_promotion_migration_execution_sources(authorization["parameters"])
        elif compose_deployment:
            verify_uat_promotion_compose_deployment_sources(authorization["parameters"])
        elif postdeploy_runtime or postdeploy_identity:
            try:
                verify_uat_promotion_postdeploy_sources(authorization["parameters"], authorization["operation"])
            except SupervisorError as failure:
                record_uat_promotion_postdeploy_failure(
                    node_path, bundle_root, context, lock_descriptor,
                    "POST_AUTHORIZATION_SOURCE_RECHECK",
                )
                raise failure
        elif not recovery:
            validate_uat_promotion_source_documents(
                authorization["parameters"], authorization["supervisor_bundle_sha256"],
            )
        if recovery and context["operation"] == "MIGRATION_EXECUTION":
            run_uat_promotion_migration_recovery_control(bundle_root, context, lock_descriptor)
        if recovery and context["operation"] == "COMPOSE_DEPLOYMENT":
            run_uat_promotion_compose_deployment_control(
                node_path, bundle_root, context, "recover", context["expected_intent_sha256"], lock_descriptor,
            )
        if migration_execution:
            control = run_uat_promotion_migration_control(
                bundle_root, context, prepared["grant_sha256"], lock_descriptor,
            )
            committed = run_uat_promotion_runner(node_path, bundle_root, context, "execute", lock_descriptor)
            if committed.get("migration_result_sha256") != control["migration_result_sha256"]:
                reject("SUPERVISOR_UAT_PROMOTION_MIGRATION_RESULT_BINDING_INVALID")
            cleanup_uat_promotion_migration_container(control, context)
            return committed
        if compose_deployment:
            control = run_uat_promotion_compose_deployment_control(
                node_path, bundle_root, context, "execute", prepared["intent_sha256"], lock_descriptor,
            )
            committed = run_uat_promotion_runner(node_path, bundle_root, context, "execute", lock_descriptor)
            if committed.get("deployment_result_sha256") != control["deployment_result_sha256"] \
                    or committed.get("fence_transfer_sha256") != control["fence_transfer_sha256"]:
                reject("SUPERVISOR_UAT_PROMOTION_COMPOSE_DEPLOYMENT_RESULT_BINDING_INVALID")
            return committed
        if postdeploy_runtime or postdeploy_identity:
            failure_stage = "EXTERNAL_CONTROL"
            try:
                control = run_uat_promotion_postdeploy_control(node_path, bundle_root, context, lock_descriptor)
                failure_stage = "JOURNAL_EXECUTION"
                expected_result_sha256 = control["probe_sha256"] if postdeploy_runtime \
                    else control["receipt_sha256"]
                committed = run_uat_promotion_runner(
                    node_path, bundle_root, context, "execute", lock_descriptor,
                    expected_postdeploy_result_sha256=expected_result_sha256,
                )
                failure_stage = "RESULT_CROSSCHECK"
                if postdeploy_runtime and committed.get("runtime_probe_result_sha256") != control["probe_sha256"]:
                    reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_RESULT_BINDING_INVALID")
                if postdeploy_identity and committed.get("postdeploy_receipt_sha256") != control["receipt_sha256"]:
                    reject("SUPERVISOR_UAT_PROMOTION_POSTDEPLOY_RESULT_BINDING_INVALID")
                return committed
            except SupervisorError as failure:
                record_uat_promotion_postdeploy_failure(
                    node_path, bundle_root, context, lock_descriptor, failure_stage,
                )
                raise failure
        return run_uat_promotion_runner(
            node_path, bundle_root, context, "recover-execute" if recovery else "execute", lock_descriptor,
        )
    finally:
        try:
            cleanup_runtime_privilege_node(runtime_root)
        finally:
            if owns_lock:
                os.close(lock_descriptor)


def notifier_egress_context(authorization: dict[str, Any], authorization_digest: str) -> dict[str, Any]:
    parameters = authorization["parameters"]
    recovery = authorization["operation"] == "RECOVER_MONITORING_NOTIFIER_EGRESS_V1_ACTIVATION"
    operation = parameters["original_operation"] if recovery else NOTIFIER_EGRESS_OPERATIONS[authorization["operation"]]
    policy_parameters = {field: parameters[field] for field in NOTIFIER_EGRESS_BASE_PARAMETER_FIELDS}
    return {
        "schema_version": 1,
        "contract": "chenyida-erp-monitoring-notifier-egress-activation-context/v1",
        "operation_id": parameters["original_operation_id"] if recovery else authorization["authorization_id"],
        "operation": operation,
        "execution_mode": "RECOVERY" if recovery else "ORIGINAL",
        "execution_authorization_id": authorization["authorization_id"],
        "execution_authorization_sha256": authorization_digest,
        "execution_created_at": authorization["created_at"],
        "original_authorization_sha256": parameters["original_authorization_sha256"] if recovery else authorization_digest,
        "supervisor_bundle_sha256": authorization["supervisor_bundle_sha256"],
        "expected_intent_sha256": parameters["expected_intent_sha256"] if recovery else None,
        "parameters": policy_parameters,
    }


def run_notifier_egress_runner(node_path: Path, bundle_root: Path, context: dict[str, Any], phase: str,
                               lock_descriptor: int, effective_unit_sha256: str | None = None) -> dict[str, Any]:
    confirmations = {
        "prepare": "PREPARE_NOTIFIER_EGRESS_ACTIVATION_INTENT",
        "apply": "APPLY_NOTIFIER_EGRESS_AFTER_AUTHORIZATION",
        "finalize": "FINALIZE_NOTIFIER_EGRESS_AFTER_EFFECTIVE_VERIFICATION",
        "recover-prepare": "PREPARE_NOTIFIER_EGRESS_ACTIVATION_RECOVERY",
        "recover-apply": "APPLY_NOTIFIER_EGRESS_ACTIVATION_RECOVERY_AFTER_AUTHORIZATION",
        "recover-finalize": "FINALIZE_NOTIFIER_EGRESS_ACTIVATION_RECOVERY_AFTER_EFFECTIVE_VERIFICATION",
    }
    if phase not in confirmations or (phase in ("finalize", "recover-finalize")) != (effective_unit_sha256 is not None):
        reject("SUPERVISOR_NOTIFIER_EGRESS_RUNNER_PHASE_INVALID")
    publisher = bundle_root / "chenyida_erp_site/scripts/monitoring-notifier-egress-publisher.mjs"
    consumed = phase in ("apply", "finalize", "recover-apply", "recover-finalize")
    environment = {
        "PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent",
        "ERP_RELEASE_SUPERVISOR_LAUNCHED": "YES", "ERP_RELEASE_GATE_LOCK_HELD": "YES",
        "ERP_RELEASE_GATE_LOCK_FD": str(lock_descriptor),
        "ERP_RELEASE_SUPERVISOR_SITE_ROOT": str(bundle_root / "chenyida_erp_site"),
        "ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256": context["supervisor_bundle_sha256"],
        "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256": context["execution_authorization_sha256"],
        "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED": "YES" if consumed else "NO",
        "ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED": "YES" if context["execution_mode"] == "RECOVERY" else "NO",
    }
    if effective_unit_sha256 is not None:
        environment["ERP_MONITORING_NOTIFIER_EGRESS_EFFECTIVE_UNIT_SHA256"] = effective_unit_sha256
    try:
        result = subprocess.run(
            [str(node_path), "--max-old-space-size=64", "--disable-proto=throw", str(publisher), phase, confirmations[phase]],
            env=environment, input=canonical_json(context), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            check=False, timeout=120, pass_fds=(lock_descriptor,),
        )
    except (OSError, subprocess.SubprocessError):
        reject("SUPERVISOR_NOTIFIER_EGRESS_RUNNER_FAILED")
    if result.returncode != 0 or result.stderr != b"" or not 2 <= len(result.stdout) <= 64 * 1024:
        reject("SUPERVISOR_NOTIFIER_EGRESS_RUNNER_FAILED")
    value = strict_json(result.stdout, "SUPERVISOR_NOTIFIER_EGRESS_RESPONSE_INVALID")
    if result.stdout != canonical_json(value) or not isinstance(value, dict) or value.get("operation_id") != context["operation_id"]:
        reject("SUPERVISOR_NOTIFIER_EGRESS_RESPONSE_INVALID")
    standard_fields = {"result", "operation_id", "intent_sha256", "policy_sha256", "receipt_sha256", "dropin_sha256", "effective_unit_sha256"}
    if phase == "prepare":
        expected_fields, expected_results = standard_fields, {"PREPARED"}
    elif phase == "apply":
        expected_fields, expected_results = standard_fields, {"APPLIED", "ALREADY_COMMITTED"}
    elif phase == "finalize":
        expected_fields, expected_results = standard_fields, {"COMMITTED", "ALREADY_COMMITTED"}
    elif phase == "recover-prepare":
        expected_fields = {"result", "operation_id", "intent_sha256", "recovery_sha256", "decision"}
        expected_results = {"RECOVERY_PREPARED"}
        if value.get("decision") not in {"RESUME_PUBLICATION", "ALREADY_COMMITTED", "QUARANTINE"}:
            reject("SUPERVISOR_NOTIFIER_EGRESS_RESPONSE_INVALID")
    elif value.get("result") == "QUARANTINED":
        expected_fields = {"result", "operation_id", "intent_sha256", "recovery_sha256", "quarantine_sha256"}
        expected_results = {"QUARANTINED"}
    else:
        expected_fields = standard_fields | {"recovery_sha256"}
        expected_results = {"APPLIED", "COMMITTED", "ALREADY_COMMITTED"}
    digest_fields = {field for field in expected_fields if field.endswith("_sha256")}
    if set(value) != expected_fields or value.get("result") not in expected_results \
        or any(not isinstance(value.get(field), str) or not SHA256.fullmatch(value[field]) or value[field] == "0" * 64 for field in digest_fields):
        reject("SUPERVISOR_NOTIFIER_EGRESS_RESPONSE_INVALID")
    return value


def expected_notifier_egress_effective_unit(parameters: dict[str, Any]) -> dict[str, Any]:
    allowed = []
    for item in parameters["allowed_addresses"]:
        address = ipaddress.ip_address(item)
        allowed.append(f"{address.compressed.lower()}/{32 if address.version == 4 else 128}")
    return {
        "schema_version": 1,
        "contract": "chenyida-erp-monitoring-notifier-egress-effective-unit/v1",
        "unit": NOTIFIER_EGRESS_UNIT,
        "load_state": "loaded",
        "fragment_path": str(NOTIFIER_EGRESS_BASE_UNIT),
        "dropin_paths": [str(NOTIFIER_EGRESS_DROPIN)],
        "transient": "no",
        "user": "chenyida-monitor-notify",
        "group": "chenyida-monitor-notify",
        "private_network": "no",
        "no_new_privileges": "yes",
        "protect_system": "strict",
        "memory_deny_write_execute": "yes",
        "ip_address_deny": "any",
        "ip_address_allow": allowed,
        "proxy_environment": [],
    }


def notifier_egress_systemctl(arguments: list[str]) -> subprocess.CompletedProcess[bytes]:
    environment = {"PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent"}
    try:
        return subprocess.run(
            ["/usr/bin/systemctl", *arguments], env=environment, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        reject("SUPERVISOR_NOTIFIER_EGRESS_SYSTEMCTL_FAILED")


def activate_and_verify_notifier_egress_systemd(parameters: dict[str, Any], expected_sha256: str,
                                                 command: Any = notifier_egress_systemctl) -> str:
    expected = expected_notifier_egress_effective_unit(parameters)
    if sha256(canonical_json(expected)) != expected_sha256:
        reject("SUPERVISOR_NOTIFIER_EGRESS_EFFECTIVE_DIGEST_INVALID")
    reload_result = command(["daemon-reload"])
    if reload_result.returncode != 0 or reload_result.stdout not in (b"", None) or getattr(reload_result, "stderr", None) not in (b"", None):
        reject("SUPERVISOR_NOTIFIER_EGRESS_SYSTEMD_RELOAD_FAILED")
    properties = [
        "LoadState", "FragmentPath", "DropInPaths", "Transient", "User", "Group", "PrivateNetwork",
        "NoNewPrivileges", "ProtectSystem", "MemoryDenyWriteExecute", "IPAddressDeny", "IPAddressAllow", "Environment",
    ]
    show = command(["show", NOTIFIER_EGRESS_UNIT, "--no-pager", *[f"--property={name}" for name in properties]])
    if show.returncode != 0 or getattr(show, "stderr", None) not in (b"", None) or not isinstance(show.stdout, bytes) or len(show.stdout) > 64 * 1024:
        reject("SUPERVISOR_NOTIFIER_EGRESS_SYSTEMD_SHOW_FAILED")
    values: dict[str, str] = {}
    try:
        text = show.stdout.decode("utf-8")
        for line in text.splitlines():
            key, separator, value = line.partition("=")
            if separator != "=" or key not in properties or key in values:
                reject("SUPERVISOR_NOTIFIER_EGRESS_EFFECTIVE_UNIT_INVALID")
            values[key] = value
    except UnicodeDecodeError:
        reject("SUPERVISOR_NOTIFIER_EGRESS_EFFECTIVE_UNIT_INVALID")
    if set(values) != set(properties):
        reject("SUPERVISOR_NOTIFIER_EGRESS_EFFECTIVE_UNIT_INVALID")
    try:
        dropins = shlex.split(values["DropInPaths"], posix=True)
        address_allow = shlex.split(values["IPAddressAllow"], posix=True)
        environment = shlex.split(values["Environment"], posix=True)
    except ValueError:
        reject("SUPERVISOR_NOTIFIER_EGRESS_EFFECTIVE_UNIT_INVALID")
    proxy_names = {"http_proxy", "https_proxy", "all_proxy", "no_proxy"}
    if any(item.partition("=")[0].lower() in proxy_names for item in environment):
        reject("SUPERVISOR_NOTIFIER_EGRESS_PROXY_ENVIRONMENT_FORBIDDEN")
    if environment:
        reject("SUPERVISOR_NOTIFIER_EGRESS_ENVIRONMENT_FORBIDDEN")
    observed = {
        "schema_version": 1,
        "contract": "chenyida-erp-monitoring-notifier-egress-effective-unit/v1",
        "unit": NOTIFIER_EGRESS_UNIT,
        "load_state": values["LoadState"],
        "fragment_path": values["FragmentPath"],
        "dropin_paths": dropins,
        "transient": values["Transient"],
        "user": values["User"],
        "group": values["Group"],
        "private_network": values["PrivateNetwork"],
        "no_new_privileges": values["NoNewPrivileges"],
        "protect_system": values["ProtectSystem"],
        "memory_deny_write_execute": values["MemoryDenyWriteExecute"],
        "ip_address_deny": values["IPAddressDeny"],
        "ip_address_allow": address_allow,
        "proxy_environment": [],
    }
    if canonical_json(observed) != canonical_json(expected):
        reject("SUPERVISOR_NOTIFIER_EGRESS_EFFECTIVE_UNIT_INVALID")
    return expected_sha256


def run_notifier_egress_authorization(bundle_root: Path, authorization_path: Path, authorization: dict[str, Any],
                                       authorization_digest: str, lock_descriptor: int | None = None,
                                       systemctl_command: Any = notifier_egress_systemctl) -> dict[str, Any]:
    owns_lock = lock_descriptor is None
    if lock_descriptor is None:
        lock_descriptor = acquire_global_release_lock()
    runtime_root: Path | None = None
    try:
        recovery = authorization["operation"] == "RECOVER_MONITORING_NOTIFIER_EGRESS_V1_ACTIVATION"
        if recovery:
            validate_original_notifier_egress_authorization_consumed(authorization["parameters"], authorization["supervisor_bundle_sha256"])
        else:
            verify_notifier_egress_sources(authorization["parameters"])
        runtime_root, node_path = prepare_runtime_privilege_node(authorization_digest)
        context = notifier_egress_context(authorization, authorization_digest)
        prepared = run_notifier_egress_runner(node_path, bundle_root, context, "recover-prepare" if recovery else "prepare", lock_descriptor)
        if not recovery:
            verify_notifier_egress_sources(authorization["parameters"])
        consume_authorization(authorization_path, authorization, authorization_digest)
        if not recovery:
            verify_notifier_egress_sources(authorization["parameters"])
        applied = run_notifier_egress_runner(node_path, bundle_root, context, "recover-apply" if recovery else "apply", lock_descriptor)
        if applied["result"] == "QUARANTINED":
            return applied
        if prepared.get("decision") == "QUARANTINE":
            reject("SUPERVISOR_NOTIFIER_EGRESS_RECOVERY_DECISION_INVALID")
        effective = activate_and_verify_notifier_egress_systemd(
            authorization["parameters"], applied["effective_unit_sha256"], systemctl_command,
        )
        if applied["result"] == "ALREADY_COMMITTED":
            return applied
        return run_notifier_egress_runner(
            node_path, bundle_root, context, "recover-finalize" if recovery else "finalize", lock_descriptor, effective,
        )
    finally:
        try:
            cleanup_runtime_privilege_node(runtime_root)
        finally:
            if owns_lock:
                os.close(lock_descriptor)


def runtime_privilege_probe_binding(parameters: dict[str, Any], operation: str) -> str:
    if operation == "RECONCILE":
        return parameters["runtime_probe_receipt_sha256"]
    body = {
        "schema_version": 1,
        "contract": "chenyida-erp-postgresql-bootstrap-runtime-binding/v1",
        "runtime_guard_mode": parameters["runtime_guard_mode"],
        "release_manifest_sha256": parameters["release_manifest_sha256"],
        "runtime_configuration_sha256": parameters["runtime_configuration_sha256"],
        "deployment_class": parameters["deployment_class"],
        "deployment_id": parameters["deployment_id"],
        "postgres_container": parameters["postgres_container"],
        "postgres_container_id": parameters["postgres_container_id"],
        "expected_database": parameters["expected_database"],
        "expected_database_oid": parameters["expected_database_oid"],
        "expected_system_identifier": parameters["expected_system_identifier"],
        "expected_database_marker": parameters["expected_database_marker"],
    }
    return sha256(canonical_json(body))


def runtime_privilege_context(authorization: dict[str, Any], authorization_digest: str) -> dict[str, Any]:
    parameters = authorization["parameters"]
    recovery = authorization["operation"] == "RECOVER_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT"
    operation = parameters["original_operation"] if recovery else RUNTIME_PRIVILEGE_OPERATIONS[authorization["operation"]]
    return {
        "schema_version": 2,
        "contract": "chenyida-erp-postgresql-runtime-privilege-control-context/v2",
        "evidence_scope": "ACTUAL_CONTROLLED",
        "operation_id": parameters["original_operation_id"] if recovery else authorization["authorization_id"],
        "operation": operation,
        "execution_mode": "RECOVERY" if recovery else "ORIGINAL",
        "execution_authorization_id": authorization["authorization_id"],
        "execution_authorization_sha256": authorization_digest,
        "expected_intent_sha256": parameters["expected_intent_sha256"] if recovery else None,
        "deployment_class": parameters["deployment_class"],
        "deployment_id": parameters["deployment_id"],
        "state_root": str(RUNTIME_PRIVILEGE_STATE_ROOT),
        "runtime_secret_root": str(RUNTIME_SECRET_ROOT),
        "backup_credential_root": parameters["backup_credential_root"],
        "backup_capture_service_file": parameters["backup_capture_service_file"],
        "backup_capture_service": parameters["backup_capture_service"],
        "credential_generation_id": parameters["credential_generation_id"],
        "backup_root": parameters["backup_root"],
        "release_manifest": parameters["release_manifest"],
        "release_manifest_sha256": parameters["release_manifest_sha256"],
        "runtime_guard_mode": parameters["runtime_guard_mode"],
        "postgres_container_name": parameters["postgres_container"],
        "postgres_container_id": parameters["postgres_container_id"],
        "expected_database": parameters["expected_database"],
        "expected_database_oid": parameters["expected_database_oid"],
        "expected_system_identifier": parameters["expected_system_identifier"],
        "expected_database_marker": parameters["expected_database_marker"],
        "supervisor_bundle_sha256": authorization["supervisor_bundle_sha256"],
        "authorization_sha256": parameters["original_authorization_sha256"] if recovery else authorization_digest,
        "runtime_configuration_sha256": parameters["runtime_configuration_sha256"],
        "runtime_probe_binding_sha256": runtime_privilege_probe_binding(parameters, operation),
    }


def run_runtime_privilege_runner(node_path: Path, bundle_root: Path, context: dict[str, Any], phase: str, lock_descriptor: int) -> dict[str, Any]:
    confirmations = {
        "prepare": "PREPARE_DURABLE_INTENT_BEFORE_AUTHORIZATION",
        "execute": "EXECUTE_EXACT_PREPARED_RUNTIME_PRIVILEGE_INTENT",
        "recover-prepare": "PREPARE_DURABLE_RECOVERY_AUTHORIZATION",
        "recover-execute": "EXECUTE_EXACT_PREPARED_RUNTIME_PRIVILEGE_RECOVERY",
    }
    if phase not in confirmations:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RUNNER_PHASE_INVALID")
    confirmation = confirmations[phase]
    runner = bundle_root / "chenyida_erp_site/scripts/postgresql-runtime-privilege-runner.mjs"
    environment = {
        "PATH": SAFE_PATH, "LC_ALL": "C", "LANG": "C", "TZ": "UTC", "HOME": "/nonexistent",
        "ERP_RELEASE_SUPERVISOR_LAUNCHED": "YES", "ERP_RELEASE_GATE_LOCK_HELD": "YES",
        "ERP_RELEASE_GATE_LOCK_FD": str(lock_descriptor),
        "ERP_RELEASE_SUPERVISOR_SITE_ROOT": str(bundle_root / "chenyida_erp_site"),
        "ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256": context["supervisor_bundle_sha256"],
        "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256": context["execution_authorization_sha256"],
        "ERP_RELEASE_SUPERVISOR_ORIGINAL_AUTHORIZATION_CONSUMED": "YES" if context["execution_mode"] == "RECOVERY" else "NO",
    }
    try:
        result = subprocess.run(
            [str(node_path), str(runner), phase, confirmation],
            env=environment,
            input=canonical_json(context),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=900,
            pass_fds=(lock_descriptor,),
        )
    except (OSError, subprocess.SubprocessError):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RUNNER_FAILED")
    if result.returncode != 0 or result.stderr != b"" or len(result.stdout) < 2 or len(result.stdout) > 64 * 1024:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RUNNER_FAILED")
    value = strict_json(result.stdout, "SUPERVISOR_RUNTIME_PRIVILEGE_RUNNER_RESPONSE_INVALID")
    if result.stdout != canonical_json(value) or not isinstance(value, dict) or value.get("operation_id") != context["operation_id"]:
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RUNNER_RESPONSE_INVALID")
    if phase == "prepare":
        expected_result = {"PREPARED", "ALREADY_PREPARED"}
        expected_fields = {"result", "operation_id", "intent_sha256", "plan_sha256"}
        digest_fields = {"intent_sha256", "plan_sha256"}
    elif phase == "execute":
        expected_result = {"VERIFIED"}
        expected_fields = {"result", "operation_id", "intent_sha256", "receipt_sha256"}
        digest_fields = {"intent_sha256", "receipt_sha256"}
    elif phase == "recover-prepare":
        expected_result = {"RECOVERY_PREPARED"}
        expected_fields = {"result", "operation_id", "intent_sha256", "recovery_record_sha256", "decision"}
        digest_fields = {"intent_sha256", "recovery_record_sha256"}
        if value.get("decision") not in {"ARCHIVE_COMMITTED", "CAPTURE_AND_VERIFY", "DISPATCH_TRANSACTION", "FINISH_PUBLICATION", "QUARANTINE", "RESUME_AUTHORIZATION", "RETRY_TRANSACTION"}:
            reject("SUPERVISOR_RUNTIME_PRIVILEGE_RUNNER_RESPONSE_INVALID")
    elif value.get("result") == "VERIFIED":
        expected_result = {"VERIFIED"}
        expected_fields = {"result", "operation_id", "intent_sha256", "recovery_record_sha256", "receipt_sha256"}
        digest_fields = {"intent_sha256", "recovery_record_sha256", "receipt_sha256"}
    else:
        expected_result = {"QUARANTINED"}
        expected_fields = {"result", "operation_id", "intent_sha256", "recovery_record_sha256", "quarantine_state_sha256"}
        digest_fields = {"intent_sha256", "recovery_record_sha256", "quarantine_state_sha256"}
    if set(value) != expected_fields or value.get("result") not in expected_result or any(not isinstance(value.get(field), str) or not SHA256.fullmatch(value[field]) for field in digest_fields):
        reject("SUPERVISOR_RUNTIME_PRIVILEGE_RUNNER_RESPONSE_INVALID")
    return value


def run_runtime_privilege_authorization(bundle_root: Path, authorization_path: Path, authorization: dict[str, Any], authorization_digest: str, lock_descriptor: int | None = None) -> dict[str, Any]:
    owns_lock = lock_descriptor is None
    if lock_descriptor is None:
        lock_descriptor = acquire_global_release_lock()
    runtime_root: Path | None = None
    try:
        recovery = authorization["operation"] == "RECOVER_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT"
        if recovery:
            validate_original_runtime_privilege_authorization_consumed(authorization["parameters"], authorization["supervisor_bundle_sha256"])
        runtime_root, node_path = prepare_runtime_privilege_node(authorization_digest)
        context = runtime_privilege_context(authorization, authorization_digest)
        run_runtime_privilege_runner(node_path, bundle_root, context, "recover-prepare" if recovery else "prepare", lock_descriptor)
        consume_authorization(authorization_path, authorization, authorization_digest)
        return run_runtime_privilege_runner(node_path, bundle_root, context, "recover-execute" if recovery else "execute", lock_descriptor)
    finally:
        try:
            cleanup_runtime_privilege_node(runtime_root)
        finally:
            if owns_lock:
                os.close(lock_descriptor)


def consume_authorization(path: Path, authorization: dict[str, Any], digest: str, pending_root: Path = AUTHORIZATION_PENDING_ROOT, consumed_root: Path = AUTHORIZATION_CONSUMED_ROOT) -> Path:
    if pending_root == AUTHORIZATION_PENDING_ROOT and consumed_root == AUTHORIZATION_CONSUMED_ROOT:
        trusted_directory(AUTHORIZATION_ROOT, {0o700}, "SUPERVISOR_AUTHORIZATION_ROOT_INVALID")
    trusted_directory(pending_root, {0o700}, "SUPERVISOR_AUTHORIZATION_ROOT_INVALID")
    trusted_directory(consumed_root, {0o700}, "SUPERVISOR_AUTHORIZATION_ROOT_INVALID")
    destination = consumed_root / f"{authorization['authorization_id']}.{digest}.json"
    if destination.exists():
        reject("SUPERVISOR_AUTHORIZATION_ALREADY_CONSUMED")
    try:
        os.rename(path, destination)
        for directory in (pending_root, consumed_root):
            descriptor = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
    except OSError:
        reject("SUPERVISOR_AUTHORIZATION_CONSUME_FAILED")
    return destination


def parse_cli(arguments: list[str]) -> tuple[str, Path]:
    if len(arguments) != 4 or arguments[0] != "--bundle-sha256" or arguments[2] != "--authorization-file" or not SHA256.fullmatch(arguments[1]):
        reject("SUPERVISOR_CLI_ARGUMENT_INVALID")
    return arguments[1], Path(arguments[3])


def run_direct_postdeploy_authorization(
        bundle_root: Path, authorization_path: Path, authorization: dict[str, Any],
        authorization_digest: str, lock_descriptor: int) -> None:
    operation = authorization["operation"]
    if operation not in (
            "PROBE_POST_DEPLOY_RUNTIME_CONFIGURATION", "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY"):
        reject("SUPERVISOR_POSTDEPLOY_OPERATION_INVALID")
    runtime_root: Path | None = None
    try:
        runtime_root, node_path = prepare_runtime_privilege_node(authorization_digest)
        verify_candidate(authorization["parameters"], bundle_root, lock_descriptor)
        if operation == "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY":
            validate_runtime_probe_receipt(authorization["parameters"], authorization["supervisor_bundle_sha256"])
        command = command_for(bundle_root, authorization)
        consume_authorization(authorization_path, authorization, authorization_digest)
        environment = {
            "PATH": SAFE_PATH,
            "LC_ALL": "C",
            "LANG": "C",
            "TZ": "UTC",
            "HOME": "/nonexistent",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "ERP_RELEASE_SUPERVISOR_LAUNCHED": "YES",
            "ERP_RELEASE_GATE_LOCK_HELD": "YES",
            "ERP_RELEASE_GATE_LOCK_FD": str(lock_descriptor),
            "ERP_RELEASE_SUPERVISOR_SITE_ROOT": str(bundle_root / "chenyida_erp_site"),
            "ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256": authorization["supervisor_bundle_sha256"],
            "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256": authorization_digest,
            "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_CONSUMED": "YES",
            "ERP_RELEASE_SUPERVISOR_NODE_RUNTIME": str(node_path),
        }
        try:
            process = subprocess.Popen(
                command, env=environment, stdin=subprocess.DEVNULL,
                pass_fds=(lock_descriptor,), start_new_session=True,
            )
            try:
                returncode = process.wait(timeout=15 * 60)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    process.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait()
                reject("SUPERVISOR_POSTDEPLOY_ENTRYPOINT_TIMEOUT")
        except (OSError, subprocess.SubprocessError):
            reject("SUPERVISOR_POSTDEPLOY_ENTRYPOINT_FAILED")
        if returncode != 0:
            reject("SUPERVISOR_POSTDEPLOY_ENTRYPOINT_FAILED")
    finally:
        cleanup_runtime_privilege_node(runtime_root)


def main() -> None:
    if os.getuid() != 0 or Path(os.path.realpath(sys.argv[0])) != LAUNCHER_PATH:
        reject("SUPERVISOR_LAUNCHER_CONTEXT_INVALID")
    trusted_directory(SUPERVISOR_BASE, {0o555, 0o755}, "SUPERVISOR_INSTALL_ROOT_INVALID")
    trusted_directory(BUNDLES_ROOT, {0o555, 0o755}, "SUPERVISOR_INSTALL_ROOT_INVALID")
    bundle_digest, authorization_path = parse_cli(sys.argv[1:])
    bundle_root = BUNDLES_ROOT / bundle_digest
    verify_bundle(bundle_root, bundle_digest)
    authorization, authorization_digest, _ = load_authorization(authorization_path, bundle_digest)
    lock_descriptor = acquire_global_release_lock()
    try:
        assert_no_uat_migration_execution_interlock(authorization, authorization_digest)
        if not (authorization["contract"] == UAT_PROMOTION_AUTHORIZATION_CONTRACT
                and authorization["operation"] in (
                    "CAPTURE_UAT_PROMOTION_SNAPSHOT", "QUIESCE_UAT_WRITERS", "RECOVER_UAT_PROMOTION",
                    "AUTHORIZE_UAT_PROMOTION_MIGRATION", "RUN_UAT_PROMOTION_MIGRATION",
                )):
            verify_candidate(authorization["parameters"], bundle_root, lock_descriptor)
        validate_runtime_secret_boundary(bundle_root, authorization["operation"])
        if authorization["contract"] == RUNTIME_PRIVILEGE_AUTHORIZATION_CONTRACT:
            validate_runtime_privilege_probe_receipt(authorization["parameters"], bundle_digest, operation=authorization["operation"])
            result = run_runtime_privilege_authorization(
                bundle_root, authorization_path, authorization, authorization_digest, lock_descriptor,
            )
            sys.stdout.buffer.write(canonical_json(result))
            return
        if authorization["contract"] == CLUSTER_POLICY_AUTHORIZATION_CONTRACT:
            assert_no_runtime_privilege_interlock(bundle_root)
            result = run_cluster_policy_authorization(
                bundle_root, authorization_path, authorization, authorization_digest, lock_descriptor,
            )
            sys.stdout.buffer.write(canonical_json(result))
            return
        if authorization["contract"] == NOTIFIER_EGRESS_AUTHORIZATION_CONTRACT:
            assert_no_runtime_privilege_interlock(bundle_root)
            result = run_notifier_egress_authorization(
                bundle_root, authorization_path, authorization, authorization_digest, lock_descriptor,
            )
            sys.stdout.buffer.write(canonical_json(result))
            return
        if authorization["contract"] == UAT_PROMOTION_AUTHORIZATION_CONTRACT:
            assert_no_runtime_privilege_interlock(bundle_root)
            result = run_uat_promotion_authorization(
                bundle_root, authorization_path, authorization, authorization_digest, lock_descriptor,
            )
            sys.stdout.buffer.write(canonical_json(result))
            return
        if authorization["operation"] in ("PUBLISH_MONITORING_COMPONENTS_PROJECTION", "PUBLISH_MONITORING_BACKUP_PROJECTION"):
            assert_no_runtime_privilege_interlock(bundle_root)
            result = run_monitoring_projection_authorization(
                bundle_root, authorization_path, authorization, authorization_digest, lock_descriptor,
            )
            sys.stdout.buffer.write(canonical_json(result))
            return
        if authorization["operation"] == "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY":
            validate_runtime_probe_receipt(authorization["parameters"], bundle_digest)
        assert_no_runtime_privilege_interlock(bundle_root)
        if authorization["operation"] in (
                "PROBE_POST_DEPLOY_RUNTIME_CONFIGURATION", "VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY"):
            run_direct_postdeploy_authorization(
                bundle_root, authorization_path, authorization, authorization_digest, lock_descriptor,
            )
            return
        consume_authorization(authorization_path, authorization, authorization_digest)
        site_root = bundle_root / "chenyida_erp_site"
        command = command_for(bundle_root, authorization)
        environment = {
            "PATH": SAFE_PATH,
            "LC_ALL": "C",
            "LANG": "C",
            "TZ": "UTC",
            "HOME": "/nonexistent",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "ERP_RELEASE_SUPERVISOR_LAUNCHED": "YES",
            "ERP_RELEASE_GATE_LOCK_HELD": "YES",
            "ERP_RELEASE_GATE_LOCK_FD": str(lock_descriptor),
            "ERP_RELEASE_SUPERVISOR_SITE_ROOT": str(site_root),
            "ERP_RELEASE_SUPERVISOR_BUNDLE_SHA256": bundle_digest,
            "ERP_RELEASE_SUPERVISOR_AUTHORIZATION_SHA256": authorization_digest,
        }
        os.execve(command[0], command, environment)
    finally:
        os.close(lock_descriptor)


if __name__ == "__main__":
    try:
        main()
    except SupervisorError as error:
        print(error.code, file=sys.stderr)
        raise SystemExit(1) from None
    except Exception:
        print("SUPERVISOR_INTERNAL_ERROR", file=sys.stderr)
        raise SystemExit(1) from None
