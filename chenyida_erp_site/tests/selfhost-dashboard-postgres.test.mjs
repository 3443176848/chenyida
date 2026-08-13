import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Pool } from "pg";

import { PostgresDashboardRepository } from "../app/lib/dashboard-selfhost/repository.ts";
import { DashboardService } from "../app/lib/dashboard-selfhost/service.ts";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";

const databaseUrl = process.env.TEST_DASHBOARD_DATABASE_URL;
if (!databaseUrl || !/dashboard_test/i.test(databaseUrl)) throw new Error("isolated TEST_DASHBOARD_DATABASE_URL containing dashboard_test is required");
process.env.ERP_RELEASE_EXPECTED_DEPLOYMENT_ID ||= "dashboard-test";
process.env.ERP_RELEASE_EXPECTED_VERSION ||= "0.1.0-alpha.47";
process.env.ERP_RELEASE_EXPECTED_GIT_COMMIT ||= "b".repeat(40);
process.env.ERP_RELEASE_EXPECTED_MANIFEST_SHA256 ||= "d".repeat(64);
process.env.ERP_RELEASE_EXPECTED_SUPERVISOR_BUNDLE_SHA256 ||= "e".repeat(64);
process.env.ERP_RELEASE_IDENTITY_MAX_AGE_SECONDS ||= "3600";
process.env.ERP_BACKUP_OPERATIONS_POLICY_ID ||= "offhost-test-v1";
process.env.ERP_BACKUP_OPERATIONS_POLICY_SHA256 ||= "7".repeat(64);
process.env.ERP_BACKUP_OPERATIONS_POLICY_SCOPE ||= "TEST";
const pool = new Pool({ connectionString: databaseUrl, max: 2, application_name: "dashboard-integration-test" });
const runtimeMigrations = (await pool.query("select version,checksum from schema_migrations order by version")).rows;
const runtimeMigrationHead = runtimeMigrations.at(-1)?.version;
if (typeof runtimeMigrationHead !== "string") throw new Error("dashboard integration requires an applied migration head");
const runtimeMigrationManifestSha = createHash("sha256").update(`${runtimeMigrations.map((item) => `${item.checksum}  ${item.version}`).join("\n")}\n`).digest("hex");
const actor = (role) => ({ username: `${role}01`, role, permissions: permissionsForRole(role) });
const directory = await mkdtemp(path.join(os.tmpdir(), "cyd-dashboard-pg-"));
await chmod(directory, 0o2750);
await writeFile(path.join(directory, ".chenyida-erp-receipt-root-v2"), "chenyida-erp-receipt-root/v2\n", { mode: 0o400 });
await chmod(path.join(directory, ".chenyida-erp-receipt-root-v2"), 0o400);
const statusFile = path.join(directory, "recovery-readiness.json");
const releaseRoot = path.join(directory, "release");
const releaseFile = path.join(releaseRoot, "release-identity.json");
const runtimeHostname = os.hostname();
if (!/^[0-9a-f]{12,64}$/.test(runtimeHostname) || typeof process.getuid !== "function" || process.getuid() !== 0) throw new Error("dashboard release identity integration requires a root Docker test container with a container-ID hostname");
await mkdir(releaseRoot, { mode: 0o750 });
await chmod(releaseRoot, 0o750);
await writeFile(path.join(releaseRoot, ".chenyida-erp-release-identity-root-v1"), "chenyida-erp-release-identity-root/v1\n", { mode: 0o440 });
await chmod(path.join(releaseRoot, ".chenyida-erp-release-identity-root-v1"), 0o440);
await writeFile(releaseFile, JSON.stringify({ schema_version: 3, contract: "chenyida-erp-runtime-release-identity/v3", deployment_class: "TEST", deployment_id: "dashboard-test", release_id: "dashboard-release", release_manifest_sha256: process.env.ERP_RELEASE_EXPECTED_MANIFEST_SHA256, postdeploy_receipt_sha256: "9".repeat(64), supervisor_bundle_sha256: process.env.ERP_RELEASE_EXPECTED_SUPERVISOR_BUNDLE_SHA256, authorization_sha256: "f".repeat(64), runtime_guard: { contract: "chenyida-erp-release-runtime-guard/v1", mode: "POST_DEPLOY_CURRENT_RUNTIME_STRICT" }, runtime_policy_sha256: "163ccf002f083d8818b90f67e3fe8a584bf25beee4a05d1448121eb5c530c77e", application_version: "0.1.0-alpha.47", git_commit: "b".repeat(40), git_tree: "c".repeat(40), migration_head: runtimeMigrationHead, migration_manifest_sha256: runtimeMigrationManifestSha, caddy_container_id: "1".repeat(64), caddy_image_digest: `sha256:${"1".repeat(64)}`, postgres_container_id: "2".repeat(64), postgres_image_digest: `sha256:${"2".repeat(64)}`, web_container_id: runtimeHostname.padEnd(64, "a"), web_image_digest: `sha256:${"b".repeat(64)}`, worker_container_id: "c".repeat(64), worker_image_digest: `sha256:${"c".repeat(64)}`, generated_at: new Date().toISOString() }), { mode: 0o440 });
await chmod(releaseFile, 0o440);
const service = new DashboardService(new PostgresDashboardRepository(pool), statusFile, releaseFile);
const canonicalValue = (value) => {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(",")}}`;
};
const canonicalSha = (value) => createHash("sha256").update(`${canonicalValue(value)}\n`).digest("hex");

test.beforeEach(async () => {
  await pool.query("truncate material_master,material_categories,background_jobs restart identity cascade");
});

test.after(async () => {
  await pool.end();
  await rm(directory, { recursive: true, force: true });
});

test("read-only repeatable-read snapshot aggregates exact material-review work", async () => {
  const empty = await service.summary(actor("operations"));
  assert.equal(empty.authority, "Node/PostgreSQL");
  assert.equal(empty.consistency, "REPEATABLE_READ_READ_ONLY");
  assert.equal(empty.inventory_quantity_aggregated, false);
  assert.equal(empty.groups.material.active_materials, 0);
  assert.equal(empty.groups.finance.ar_balance, "0");

  const category = await pool.query(
    "insert into material_categories(category_code,category_name_cn,category_level,created_by,updated_by,request_id) values('DASH','看板测试',1,'test','test',$1) returning id",
    [randomUUID()],
  );
  const categoryId = category.rows[0].id;
  await pool.query(`
    insert into material_master(
      internal_material_code,standard_name,category_id,base_uom,material_status,procurement_type,inventory_type,
      inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id
    ) values('DASH-001','看板正式物料',$1,'PCS','ACTIVE','PURCHASED','STOCK','NONE','ROHS','MANUAL','test','test','test',$2)
  `, [categoryId, randomUUID()]);
  await pool.query(`
    insert into material_master(
      standard_name,category_id,base_uom,material_status,procurement_type,inventory_type,
      inspection_type,environmental_requirement,source_type,last_modified_by,created_by,updated_by,request_id
    )
    select 'DASH-PENDING-'||value,$1,'PCS','PENDING_REVIEW','PURCHASED','STOCK','NONE','ROHS','MANUAL','test','test','test',$2
    from generate_series(1,4) value
  `, [categoryId, randomUUID()]);
  await pool.query("insert into background_jobs(id,type,idempotency_key,payload,status) values($1,'test.dashboard','dashboard-test','{}','FAILED')", [randomUUID()]);

  const result = await service.management(actor("operations"));
  assert.equal(result.summary.groups.material.active_materials, 1);
  assert.equal(result.summary.total_items, 1);
  assert.equal(result.summary.groups.operations.failed_jobs, 1);
  assert.ok(result.risks.some((item) => item.code === "BACKGROUND_JOB_FAILED"));
  assert.deepEqual(result.metrics.find((item) => item.code === "material-review-pending"), {
    code: "material-review-pending", label: "物料审核待办", value: 4,
    hint: "仅 PENDING_REVIEW；与原生审核队列同口径", tone: "warning", href: "/materials/review",
  });
  assert.ok(result.risks.some((item) => item.code === "MATERIAL_REVIEW_PENDING"));
  assert.ok(!result.risks.some((item) => item.code === "NO_VISIBLE_RISK"));
  assert.equal(result.summary.groups.operations.migrations[0].version, runtimeMigrationHead);
  assert.equal(result.recent_activity.length, 0);
});

test("trusted verification file is independent from PostgreSQL business facts", async () => {
  for (const role of ["manager", "operations"]) await assert.rejects(service.backup(actor(role)), (error) => error.code === "PERMISSION_DENIED");
  const hash = "b".repeat(64);
  const receiverHash = "d".repeat(64);
  const databaseIdentity = (await pool.query("select current_database() name,system_identifier::text,d.oid::text oid,coalesce(shobj_description(d.oid,'pg_database'),'') marker,((current_setting('server_version_num')::integer/10000)::text) server_major,pg_encoding_to_char(d.encoding) encoding,d.datcollate collate,d.datctype ctype,case d.datlocprovider when 'c' then 'libc' when 'i' then 'icu' when 'b' then 'builtin' else 'unknown' end locale_provider,coalesce(d.datcollversion,'NONE') collation_version from pg_control_system() cross join pg_database d where d.datname=current_database()")).rows[0];
  const restoreReconciliation = { contract: "chenyida-erp-restore-reconciliation/v1", source_sha256: hash, target_database_report_sha256: "e".repeat(64), target_file_trees_sha256: "f".repeat(64), result: "MATCHED" };
  const createdAt = new Date(Date.now() - 60_000).toISOString();
  const verifiedAt = new Date().toISOString();
  const restoreReceipt = {
    schema_version: 2,
    contract: "chenyida-erp-backup-verification/v2",
    result: "RESTORE_VERIFIED",
    backup_id: "dashboard-test",
    created_at: createdAt,
    verified_at: verifiedAt,
    expires_at: new Date(Date.parse(createdAt) - 120_000 + 24 * 60 * 60 * 1000).toISOString(),
    location_id: "dashboard-restore-location",
    deployment: { class: "TEST", id: "dashboard-test", database: databaseIdentity.name, database_system_identifier: databaseIdentity.system_identifier, database_oid: databaseIdentity.oid, database_marker: "TEST.dashboard-test", database_bytes: 16777216, database_server_major: databaseIdentity.server_major, database_encoding: databaseIdentity.encoding, database_collate: databaseIdentity.collate, database_ctype: databaseIdentity.ctype, database_locale_provider: databaseIdentity.locale_provider, database_collation_version: databaseIdentity.collation_version },
    application: { version: "0.1.0-alpha.47", git_commit: "b".repeat(40), web_image_digest: `sha256:${hash}`, worker_image_digest: `sha256:${"c".repeat(64)}` },
    migration: { head: runtimeMigrationHead, manifest_file: "migrations.txt", manifest_sha256: runtimeMigrationManifestSha },
    policy: { id: "daily-rpo-v1", rpo_hours: 24 },
    consistency: { method: "QUIESCED_APPLICATION_AND_SNAPSHOT_WITH_CONTENT_RECONCILIATION", database_snapshot: "PG_DUMP_CONSISTENT_SNAPSHOT", database_guard: "DEFAULT_TRANSACTION_READ_ONLY_DEFENSE_IN_DEPTH", writer_boundary: "EXACT_COMPOSE_WEB_WORKER_STOPPED", content_reconciliation: "BEFORE_AFTER_FULL_RELATION_CONTENT_DIGESTS", dump_scope: "COMPLETE_APPLICATION_DATABASE_LOGICAL_DUMP_NO_OWNER_OR_ACL", web_container: "web-test", web_container_id: hash, worker_container: "worker-test", worker_container_id: "c".repeat(64), recovery_point_at: new Date(Date.parse(createdAt) - 120_000).toISOString(), verified_after: new Date(Date.parse(createdAt) - 60_000).toISOString() },
    reconciliation: { contract: "chenyida-erp-backup-reconciliation/v1", file: "reconciliation.json", sha256: hash },
    manifest_sha256: hash,
    artifacts: {
      postgresql_dump: { file: "postgresql.dump", sha256: hash, bytes: 10 },
      uploads: { file: "uploads.tar.gz", sha256: hash, bytes: 10, entries: 0 },
      attachments: { file: "attachments.tar.gz", sha256: hash, bytes: 10, entries: 0 },
      backup_status: { file: "backup-status.tar.gz", sha256: hash, bytes: 10, entries: 0 },
    },
    evidence: { kind: "ISOLATED_RESTORE_VERIFICATION", source_location_id: "dashboard-source", offhost_location_id: "dashboard-offhost", offhost_receiver_identity_sha256: receiverHash, offhost_receipt_sha256: hash, restore_run_id: "dashboard-restore", restored_at: verifiedAt, target: { deployment_class: "TEST", deployment_id: "dashboard-restore-target", database_name: "dashboard_restore_test", database_system_identifier: process.env.ERP_BACKUP_EXPECTED_RESTORE_TARGET_SYSTEM_IDENTIFIER, database_oid: "99999", marker_id: "dashboard-target", cluster_marker_id: process.env.ERP_BACKUP_EXPECTED_RESTORE_TARGET_CLUSTER_MARKER_ID, database_server_major: databaseIdentity.server_major, database_encoding: databaseIdentity.encoding, database_collate: databaseIdentity.collate, database_ctype: databaseIdentity.ctype, database_locale_provider: databaseIdentity.locale_provider, database_collation_version: databaseIdentity.collation_version, file_root_name: "dashboard_restore_test" }, reconciliation: restoreReconciliation, reconciliation_sha256: createHash("sha256").update(JSON.stringify(restoreReconciliation)).digest("hex"), attestation: "TRUSTED_EXECUTION_UID_AND_DISTINCT_CLUSTER_ACTIVE_INSPECTION" },
  };
  await writeFile(statusFile, JSON.stringify(restoreReceipt), { mode: 0o640 });
  await chmod(statusFile, 0o640);
  const legacy = await service.backup(actor("admin"));
  assert.equal(legacy.verification_status, "LEGACY_V2_INNER_ONLY");
  assert.equal(legacy.recovery_ready, false);
  const readinessBody = {
    schema_version: 3, contract: "chenyida-erp-backup-verification/v3", result: "SYNTHETIC_ISOLATED_VERIFIED", evidence_scope: "SYNTHETIC_ISOLATED",
    backup_id: restoreReceipt.backup_id, created_at: restoreReceipt.created_at, verified_at: verifiedAt, expires_at: restoreReceipt.expires_at,
    inner_restore: { receipt_file_sha256: "8".repeat(64), receipt_canonical_sha256: canonicalSha(restoreReceipt), receipt: restoreReceipt },
    transfer: { transfer_id: "dashboard-transfer", envelope_sha256: "1".repeat(64), receiver_receipt_sha256: "2".repeat(64), acceptance_sha256: "3".repeat(64), offhost_receipt_sha256: hash, payload_algorithm: "AES-256-GCM", key_agreement: "X25519", key_derivation: "HKDF-SHA256", signature_algorithm: "Ed25519", source_location_id: "dashboard-source", source_machine_identity_sha256: "4".repeat(64), receiver_location_id: "dashboard-offhost", receiver_machine_identity_sha256: "5".repeat(64), receiver_identity_sha256: receiverHash, source_signing_key_fingerprint: "6".repeat(64), receiver_encryption_key_fingerprint: "8".repeat(64), receiver_receipt_key_fingerprint: "9".repeat(64) },
    operations: { policy_id: process.env.ERP_BACKUP_OPERATIONS_POLICY_ID, policy_sha256: process.env.ERP_BACKUP_OPERATIONS_POLICY_SHA256, policy_scope: "TEST", schedule_observation_sha256: "1".repeat(64), schedule_status: "ON_TIME", rpo_status: "WITHIN_RPO", scheduler_installation_status: "REPOSITORY_EVALUATOR_ONLY", retention_plan_sha256: "2".repeat(64), retention_status: "POLICY_VALID_DRY_RUN", retention_execution: "DRY_RUN_DELETION_FORBIDDEN" },
    attestation: "ROOT_PUBLISHED_INNER_V2_RESTORE_SIGNED_ENCRYPTED_OFFHOST_AND_OPERATIONS_POLICY_VERIFIED",
  };
  await writeFile(statusFile, JSON.stringify({ ...readinessBody, readiness_sha256: canonicalSha(readinessBody) }));
  const result = await service.backup(actor("admin"));
  assert.equal(result.verification_status, "LEGACY_V3_NO_CLUSTER_SECURITY");
  assert.equal(result.evidence_scope, "LEGACY_V3_NO_CLUSTER_SECURITY");
  assert.equal(result.cluster_security_status, "UNVERIFIED");
  assert.equal(result.identity_status, "UNCONFIGURED");
  assert.equal(result.policy_status, "UNCONFIGURED");
  assert.equal(result.assurance_status, "UNCONFIGURED");
  assert.equal(result.recovery_ready, false);
  assert.equal(result.current_migration.version, runtimeMigrationHead);
});
