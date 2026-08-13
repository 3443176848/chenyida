import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  RELEASE_IDENTITY_CONTRACT,
  RELEASE_IDENTITY_FILE,
  RELEASE_IDENTITY_PUBLISH_LOCK,
  RELEASE_IDENTITY_ROOT_MARKER,
  RELEASE_IDENTITY_ROOT_MARKER_VALUE,
  abortPreparedReleaseIdentity,
  commitPreparedReleaseIdentity,
  parseStrictJson,
  prepareReleaseIdentity,
  publishReleaseIdentity,
  readTrustedReleaseIdentity,
  validateReleaseIdentity,
} from "../scripts/release-identity-contract.mjs";
import {
  POST_DEPLOY_RUNTIME_GUARD_MODE,
  PRE_DEPLOY_RUNTIME_GUARD_MODE,
  RELEASE_RUNTIME_POLICY_SHA256,
  runtimeGuardBinding,
} from "../scripts/release-lifecycle-contract.mjs";
import { publishReleaseIdentityFromManifest } from "../scripts/publish-release-identity-from-manifest.mjs";
import { canonicalJson, sha256 } from "../scripts/release-manifest-contract.mjs";
import {
  buildPostDeployReceipt,
  buildReleaseIdentityFromPostDeployReceipt,
  validatePostDeployRuntimeServices,
} from "../scripts/postdeploy-release-contract.mjs";
import { assertPostDeployReadinessStable, normalizePostDeployInspectRows, normalizeReadinessResponse } from "../scripts/postdeploy-release-verifier.mjs";
import {
  FIXTURE_VERSION,
  FIXTURE_WEB,
  FIXTURE_WORKER,
  FIXTURE_CONTROL,
  buildEligibleReleaseFixture,
} from "./release-gate-fixture.mjs";

const rootCapable=typeof process.getuid==="function"&&process.getuid()===0;
const readerGid=typeof process.getgid==="function"?process.getgid():0;
const identity=(generated_at="2026-08-12T01:00:00.000Z")=>({
  schema_version:3,
  contract:RELEASE_IDENTITY_CONTRACT,
  deployment_class:"UAT",
  deployment_id:"chenyida-erp-uat",
  release_id:"fixture-alpha46",
  release_manifest_sha256:"1".repeat(64),
  postdeploy_receipt_sha256:"2".repeat(64),
  supervisor_bundle_sha256:FIXTURE_CONTROL.supervisor_bundle_sha256,
  authorization_sha256:"4".repeat(64),
  runtime_guard:runtimeGuardBinding(POST_DEPLOY_RUNTIME_GUARD_MODE),
  runtime_policy_sha256:RELEASE_RUNTIME_POLICY_SHA256,
  application_version:"0.1.0-alpha.46",
  git_commit:"b".repeat(40),
  git_tree:"c".repeat(40),
  migration_head:"0045_runtime_worker_readiness.sql",
  migration_manifest_sha256:"3".repeat(64),
  caddy_container_id:"1".repeat(64),
  caddy_image_digest:`sha256:${"a".repeat(64)}`,
  postgres_container_id:"2".repeat(64),
  postgres_image_digest:`sha256:${"b".repeat(64)}`,
  web_container_id:"3".repeat(64),
  web_image_digest:`sha256:${"c".repeat(64)}`,
  worker_container_id:"4".repeat(64),
  worker_image_digest:`sha256:${"d".repeat(64)}`,
  generated_at,
});

function runtimeServices(manifest) {
  const common={restart_count:0,oom_killed:false,running:true,restarting:false,paused:false,dead:false,status:"running"};
  return [
    {...common,service:"caddy",container_id:"1".repeat(64),image_id:`sha256:${"1".repeat(64)}`,image_reference:`caddy@sha256:${"1".repeat(64)}`,health:"none",healthcheck_present:false},
    {...common,service:"postgres",container_id:"2".repeat(64),image_id:`sha256:${"2".repeat(64)}`,image_reference:`postgres@sha256:${"2".repeat(64)}`,health:"healthy",healthcheck_present:true},
    {...common,service:"web",container_id:"3".repeat(64),image_id:manifest.images.web.image_digest,image_reference:manifest.images.web.image_reference,health:"healthy",healthcheck_present:true},
    {...common,service:"worker",container_id:"4".repeat(64),image_id:manifest.images.worker.image_digest,image_reference:manifest.images.worker.image_reference,health:"healthy",healthcheck_present:true},
  ];
}

function readiness(manifest) {
  return {deployment_class:"UAT",deployment_id:"chenyida-erp-uat",version:manifest.source.package_version,revision:manifest.source.git_commit.slice(0,12),migration_head:manifest.migrations.head,migration_manifest_sha256:manifest.migrations.allowlist_sha256,database_time:"2026-08-12T01:30:00.000Z",components:{postgresql:"READY",migration:"READY",worker:"READY",uploads:"READY",attachments:"READY",runtime:"READY"}};
}

async function trustedRoot(parent,name="release"){
  const root=path.join(parent,name);await mkdir(root,{mode:0o750});await chmod(root,0o750);const marker=path.join(root,RELEASE_IDENTITY_ROOT_MARKER);await writeFile(marker,RELEASE_IDENTITY_ROOT_MARKER_VALUE,{mode:0o440});await chmod(marker,0o440);return root;
}

test("release identity JSON is exact, strict, and rejects duplicate or forged fields",()=>{
  assert.deepEqual(validateReleaseIdentity(identity()),identity());
  assert.throws(()=>parseStrictJson('{"schema_version":1,"schema_version":1}'),error=>error.code==="JSON_DUPLICATE_KEY");
  assert.throws(()=>validateReleaseIdentity({...identity(),unexpected:true}),error=>error.code==="RELEASE_IDENTITY_FIELDS_INVALID");
  assert.throws(()=>validateReleaseIdentity({...identity(),schema_version:2}),error=>error.code==="RELEASE_IDENTITY_VERSION_INVALID");
  assert.throws(()=>validateReleaseIdentity({...identity(),runtime_guard:runtimeGuardBinding(PRE_DEPLOY_RUNTIME_GUARD_MODE)}),error=>error.code==="RELEASE_RUNTIME_GUARD_INVALID");
  assert.throws(()=>validateReleaseIdentity({...identity(),runtime_policy_sha256:"0".repeat(64)}),error=>error.code==="RELEASE_RUNTIME_POLICY_INVALID");
  assert.throws(()=>validateReleaseIdentity({...identity(),web_container_id:"short"}),error=>error.code==="RELEASE_CONTAINER_SET_INVALID");
  assert.throws(()=>validateReleaseIdentity({...identity(),web_container_id:identity().worker_container_id}),error=>error.code==="RELEASE_CONTAINER_SET_INVALID");
  assert.throws(()=>validateReleaseIdentity({...identity(),generated_at:"2026-08-12T01:00:00Z"}),error=>error.code==="RELEASE_GENERATED_AT_INVALID");
});

test("root publisher durably replaces only trusted identity files with monotonic and idempotent evidence",{skip:!rootCapable},async()=>{
  const parent=await mkdtemp(path.join(os.tmpdir(),"cyd-release-contract-"));try{const root=await trustedRoot(parent);const first=await publishReleaseIdentity({root,readerGid,identity:identity()});assert.equal(first.web_container_id,"3".repeat(64));const target=path.join(root,RELEASE_IDENTITY_FILE),metadata=await stat(target);assert.equal(metadata.uid,0);assert.equal(metadata.gid,readerGid);assert.equal(metadata.mode&0o7777,0o440);const idempotent=await publishReleaseIdentity({root,readerGid,identity:identity("2026-08-12T00:59:59.000Z")});assert.deepEqual(idempotent,first);assert.deepEqual(JSON.parse(await readFile(target,"utf8")),first);const second={...identity("2026-08-12T01:00:01.000Z"),web_container_id:"e".repeat(64)};await publishReleaseIdentity({root,readerGid,identity:second});assert.deepEqual(await readTrustedReleaseIdentity({root,readerGid}),second);await assert.rejects(publishReleaseIdentity({root,readerGid,identity:{...first,worker_image_digest:`sha256:${"e".repeat(64)}`}}),error=>error.code==="RELEASE_GENERATION_NOT_MONOTONIC");await chmod(root,0o755);await assert.rejects(readTrustedReleaseIdentity({root,readerGid}),error=>error.code==="RELEASE_ROOT_TRUST_INVALID");}finally{await rm(parent,{recursive:true,force:true});}
});

test("an interrupted empty transaction is safely reconciled instead of becoming a permanent lock",{skip:!rootCapable},async()=>{
  const parent=await mkdtemp(path.join(os.tmpdir(),"cyd-release-lock-"));try{const root=await trustedRoot(parent);await publishReleaseIdentity({root,readerGid,identity:identity()});await mkdir(path.join(root,RELEASE_IDENTITY_PUBLISH_LOCK),{mode:0o700});const second={...identity("2026-08-12T01:00:01.000Z"),web_container_id:"e".repeat(64)};assert.deepEqual(await publishReleaseIdentity({root,readerGid,identity:second}),second);await assert.rejects(stat(path.join(root,RELEASE_IDENTITY_PUBLISH_LOCK)),error=>error.code==="ENOENT");}finally{await rm(parent,{recursive:true,force:true});}
});

test("transaction cleanup interruption after deleting its commit marker is recoverable",{skip:!rootCapable},async()=>{
  const parent=await mkdtemp(path.join(os.tmpdir(),"cyd-release-cleanup-"));try{const root=await trustedRoot(parent);await publishReleaseIdentity({root,readerGid,identity:identity()});const second={...identity("2026-08-12T01:00:01.000Z"),web_container_id:"e".repeat(64)};const transactionId="cleanup-interruption";await prepareReleaseIdentity({root,readerGid,identity:second,transactionId,authorizationSha256:second.authorization_sha256});await unlink(path.join(root,RELEASE_IDENTITY_PUBLISH_LOCK,"transaction.json"));const recovered=await prepareReleaseIdentity({root,readerGid,identity:second,transactionId,authorizationSha256:second.authorization_sha256});assert.equal(recovered.already_published,false);await abortPreparedReleaseIdentity({root,readerGid,transactionId,authorizationSha256:second.authorization_sha256});assert.deepEqual(await readTrustedReleaseIdentity({root,readerGid}),identity());}finally{await rm(parent,{recursive:true,force:true});}
});

test("two-phase publication keeps the old final identity until exact commit and abort is non-mutating",{skip:!rootCapable},async()=>{
  const parent=await mkdtemp(path.join(os.tmpdir(),"cyd-release-two-phase-"));try{const root=await trustedRoot(parent);const first=await publishReleaseIdentity({root,readerGid,identity:identity()});const target=path.join(root,RELEASE_IDENTITY_FILE),before=await readFile(target,"utf8");const second={...identity("2026-08-12T01:00:01.000Z"),web_container_id:"e".repeat(64)};const transactionId="identity-two-phase";const prepared=await prepareReleaseIdentity({root,readerGid,identity:second,transactionId,authorizationSha256:second.authorization_sha256});assert.equal(prepared.already_published,false);assert.equal(await readFile(target,"utf8"),before);await assert.rejects(abortPreparedReleaseIdentity({root,readerGid,transactionId,authorizationSha256:"9".repeat(64)}),error=>error.code==="RELEASE_TRANSACTION_CONTROL_MISMATCH");await abortPreparedReleaseIdentity({root,readerGid,transactionId,authorizationSha256:second.authorization_sha256});assert.deepEqual(await readTrustedReleaseIdentity({root,readerGid}),first);await prepareReleaseIdentity({root,readerGid,identity:second,transactionId,authorizationSha256:second.authorization_sha256});await assert.rejects(commitPreparedReleaseIdentity({root,readerGid,transactionId:"wrong-transaction",authorizationSha256:second.authorization_sha256}),error=>error.code==="RELEASE_TRANSACTION_CONTROL_MISMATCH");assert.equal(await readFile(target,"utf8"),before);assert.deepEqual(await commitPreparedReleaseIdentity({root,readerGid,transactionId,authorizationSha256:second.authorization_sha256}),second);assert.deepEqual(await readTrustedReleaseIdentity({root,readerGid}),second);}finally{await rm(parent,{recursive:true,force:true});}
});

test("runtime identity v3 is derived only from an independent strict post-deploy receipt",async()=>{
  const fixture=await buildEligibleReleaseFixture({entries:[{ordinal:1,filename:"0001_fixture.sql",sha256:"1".repeat(64)}]});
  const manifest=structuredClone(fixture.manifest);
  manifest.images.web.image_reference=`registry.example.com/chenyida-erp/web@${FIXTURE_WEB}`;
  manifest.images.worker.image_reference=`registry.example.com/chenyida-erp/worker@${FIXTURE_WORKER}`;
  const manifestSha256=sha256(canonicalJson(manifest));
  const services=runtimeServices(manifest);
  const receipt=buildPostDeployReceipt({
    runId:"postdeploy-fixture",
    generatedAt:"2026-08-12T01:30:00.000Z",
    deploymentClass:"UAT",
    deploymentId:"chenyida-erp-uat",
    composeProject:"chenyida-erp-uat",
    manifest,
    manifestSha256,
    supervisorBundleSha256:manifest.control.supervisor_bundle_sha256,
    authorizationSha256:"4".repeat(64),
    runtimePolicySha256:RELEASE_RUNTIME_POLICY_SHA256,
    services,
    readiness:readiness(manifest),
  });
  const receiptSha256=sha256(canonicalJson(receipt));
  const derived=buildReleaseIdentityFromPostDeployReceipt({receipt,receiptSha256});
  assert.equal(derived.schema_version,3);
  assert.equal(derived.postdeploy_receipt_sha256,receiptSha256);
  assert.equal(derived.runtime_guard.mode,POST_DEPLOY_RUNTIME_GUARD_MODE);
  assert.equal(derived.application_version,FIXTURE_VERSION);
  assert.equal(derived.git_tree,manifest.source.git_tree);
  assert.equal(derived.migration_manifest_sha256,manifest.migrations.allowlist_sha256);
  assert.equal(derived.web_image_digest,FIXTURE_WEB);
  assert.equal(derived.worker_image_digest,FIXTURE_WORKER);
  assert.throws(()=>buildReleaseIdentityFromPostDeployReceipt({receipt,receiptSha256:"0".repeat(64)}),error=>error.code==="POSTDEPLOY_RECEIPT_SHA256_MISMATCH");

  await assert.rejects(publishReleaseIdentityFromManifest({}),error=>error.code==="RUNTIME_IDENTITY_POSTDEPLOY_RECEIPT_REQUIRED");
  assert.throws(()=>buildPostDeployReceipt({runId:"local-only",generatedAt:"2026-08-12T01:30:00.000Z",deploymentClass:"UAT",deploymentId:"chenyida-erp-uat",composeProject:"chenyida-erp-uat",manifest:fixture.manifest,manifestSha256:sha256(canonicalJson(fixture.manifest)),supervisorBundleSha256:fixture.manifest.control.supervisor_bundle_sha256,authorizationSha256:"4".repeat(64),runtimePolicySha256:RELEASE_RUNTIME_POLICY_SHA256,services:runtimeServices(fixture.manifest),readiness:readiness(fixture.manifest)}),error=>error.code==="POSTDEPLOY_LOCAL_ONLY_IMAGE_FORBIDDEN");
});

test("strict post-deploy contract rejects weak Worker health, missing healthcheck, migration drift and inventory drift",async()=>{
  const fixture=await buildEligibleReleaseFixture({entries:[{ordinal:1,filename:"0001_fixture.sql",sha256:"1".repeat(64)}]});
  const manifest=structuredClone(fixture.manifest);
  manifest.images.web.image_reference=`registry.example.com/chenyida-erp/web@${FIXTURE_WEB}`;
  manifest.images.worker.image_reference=`registry.example.com/chenyida-erp/worker@${FIXTURE_WORKER}`;
  const services=runtimeServices(manifest);
  for(const invalid of [
    services.slice(0,3),
    services.map(entry=>entry.service==="worker"?{...entry,health:"none",healthcheck_present:false}:entry),
    services.map(entry=>entry.service==="worker"?{...entry,health:"unhealthy"}:entry),
    services.map(entry=>entry.service==="web"?{...entry,healthcheck_present:false}:entry),
    services.map(entry=>entry.service==="postgres"?{...entry,restart_count:1}:entry),
    services.map(entry=>entry.service==="caddy"?{...entry,oom_killed:true}:entry),
  ]) assert.throws(()=>validatePostDeployRuntimeServices(invalid));

  assert.throws(()=>buildPostDeployReceipt({runId:"migration-drift",generatedAt:"2026-08-12T01:30:00.000Z",deploymentClass:"UAT",deploymentId:"chenyida-erp-uat",composeProject:"chenyida-erp-uat",manifest,manifestSha256:sha256(canonicalJson(manifest)),supervisorBundleSha256:manifest.control.supervisor_bundle_sha256,authorizationSha256:"4".repeat(64),runtimePolicySha256:RELEASE_RUNTIME_POLICY_SHA256,services,readiness:{...readiness(manifest),migration_manifest_sha256:"0".repeat(64)}}),error=>error.code==="POSTDEPLOY_READINESS_IDENTITY_MISMATCH");
  assert.throws(()=>buildPostDeployReceipt({runId:"deployment-drift",generatedAt:"2026-08-12T01:30:00.000Z",deploymentClass:"UAT",deploymentId:"chenyida-erp-uat",composeProject:"chenyida-erp-uat",manifest,manifestSha256:sha256(canonicalJson(manifest)),supervisorBundleSha256:manifest.control.supervisor_bundle_sha256,authorizationSha256:"4".repeat(64),runtimePolicySha256:RELEASE_RUNTIME_POLICY_SHA256,services,readiness:{...readiness(manifest),deployment_class:"PRODUCTION"}}),error=>error.code==="POSTDEPLOY_READINESS_IDENTITY_MISMATCH");
  assert.throws(()=>buildPostDeployReceipt({runId:"manifest-digest-drift",generatedAt:"2026-08-12T01:30:00.000Z",deploymentClass:"UAT",deploymentId:"chenyida-erp-uat",composeProject:"chenyida-erp-uat",manifest,manifestSha256:"0".repeat(64),supervisorBundleSha256:manifest.control.supervisor_bundle_sha256,authorizationSha256:"4".repeat(64),runtimePolicySha256:RELEASE_RUNTIME_POLICY_SHA256,services,readiness:readiness(manifest)}),error=>error.code==="POSTDEPLOY_MANIFEST_SHA256_MISMATCH");
  assert.throws(()=>buildPostDeployReceipt({runId:"clock-skew",generatedAt:"2026-08-12T01:30:00.000Z",deploymentClass:"UAT",deploymentId:"chenyida-erp-uat",composeProject:"chenyida-erp-uat",manifest,manifestSha256:sha256(canonicalJson(manifest)),supervisorBundleSha256:manifest.control.supervisor_bundle_sha256,authorizationSha256:"4".repeat(64),runtimePolicySha256:RELEASE_RUNTIME_POLICY_SHA256,services,readiness:{...readiness(manifest),database_time:"2026-08-12T01:36:00.001Z"}}),error=>error.code==="POSTDEPLOY_CLOCK_SKEW_INVALID");

  const rows=services.map(state=>({
    Id:state.container_id,
    Name:`/${state.service}-container`,
    Image:state.image_id,
    RestartCount:state.restart_count,
    Config:{Image:state.image_reference,Labels:{"com.docker.compose.project":"chenyida-erp-uat","com.docker.compose.service":state.service,...(["web","worker"].includes(state.service)?{"org.opencontainers.image.version":manifest.source.package_version,"org.opencontainers.image.revision":manifest.source.git_commit}:{})},Healthcheck:state.healthcheck_present?{Test:["CMD","true"]}:null},
    State:{OOMKilled:state.oom_killed,Running:state.running,Restarting:state.restarting,Paused:state.paused,Dead:state.dead,Status:state.status,...(state.health==="none"?{}:{Health:{Status:state.health}})},
  }));
  const selectors=Object.fromEntries(services.map(state=>[state.service,`${state.service}-container`]));
  const expectedReferences=Object.fromEntries(services.map(state=>[state.service,state.image_reference]));
  const normalized=normalizePostDeployInspectRows({rows,inventoryIds:services.map(state=>state.container_id),composeProject:"chenyida-erp-uat",selectors,expectedReferences,expectedVersion:manifest.source.package_version,expectedRevision:manifest.source.git_commit,imageIdentity:(...args)=>args[1].Image});
  assert.deepEqual(normalized,services);
  assert.throws(()=>normalizePostDeployInspectRows({rows,inventoryIds:services.slice(1).map(state=>state.container_id),composeProject:"chenyida-erp-uat",selectors,expectedReferences,expectedVersion:manifest.source.package_version,expectedRevision:manifest.source.git_commit,imageIdentity:(...args)=>args[1].Image}),error=>error.code==="POSTDEPLOY_SERVICE_SET_INVALID");
  assert.deepEqual(normalizeReadinessResponse({ok:true,status:"READY",database:"postgresql",storage:"local",worker:"postgresql-jobs",deployment_class:"UAT",deployment_id:"chenyida-erp-uat",version:manifest.source.package_version,revision:manifest.source.git_commit.slice(0,12),migration_head:manifest.migrations.head,migration_manifest_sha256:manifest.migrations.allowlist_sha256,components:readiness(manifest).components,time:"2026-08-12T01:30:00.000Z"}),readiness(manifest));
  const later={...readiness(manifest),database_time:"2026-08-12T01:30:01.000Z"};
  assert.deepEqual(assertPostDeployReadinessStable(readiness(manifest),later),later);
  assert.throws(()=>assertPostDeployReadinessStable(readiness(manifest),{...later,database_time:"2026-08-12T01:29:59.999Z"}),error=>error.code==="POSTDEPLOY_READINESS_DRIFT");
  assert.throws(()=>assertPostDeployReadinessStable(readiness(manifest),{...later,deployment_id:"other-deployment"}),error=>error.code==="POSTDEPLOY_READINESS_DRIFT");
});

test("writer pins trusted tools and publishes only after strict four-service reinspection",async()=>{
  const writer=await readFile(new URL("../scripts/write-release-identity.sh",import.meta.url),"utf8");
  const verifier=await readFile(new URL("../scripts/postdeploy-release-verifier.mjs",import.meta.url),"utf8");
  assert.match(writer,/PATH=\/usr\/local\/sbin:/);
  assert.match(writer,/\/usr\/bin\/docker inspect/);
  assert.match(writer,/NODE_IMAGE='node@sha256:[0-9a-f]{64}'/);
  assert.match(writer,/--network none --read-only --cap-drop ALL --security-opt no-new-privileges/);
  assert.match(writer,/--memory 64m --memory-swap 64m --cpus 0\.25 --pids-limit 16/);
  assert.match(writer,/chenyida\.erp\.postdeploy-verifier/);
  assert.match(writer,/flock -n 9/);
  assert.match(writer,/--pull=never/);
  assert.match(writer,/refusing to remove an unowned postdeploy bootstrap container/);
  assert.match(writer,/POST_DEPLOY_CURRENT_RUNTIME_STRICT/);
  assert.match(writer,/VERIFY_AND_PUBLISH_EXACT_POSTDEPLOY_IDENTITY/);
  assert.match(writer,/\/var\/lib\/chenyida-erp\/postdeploy\/\$RUN_ID/);
  assert.match(writer,/\/var\/lib\/chenyida-erp\/release-identity/);
  assert.match(writer,/\/var\/lib\/chenyida-erp\/release-artifacts/);
  assert.doesNotMatch(writer,/publish-release-identity-from-manifest/);
  assert.doesNotMatch(writer,/\/usr\/bin\/docker (?:restart|stop|compose up)/);
  assert.match(verifier,/\["caddy", "postgres", "web", "worker"\]/);
  assert.match(verifier,/inspectPostDeployRuntime/);
  assert.match(verifier,/inspectPostDeployReadiness/);
  assert.match(verifier,/docker\(\["inspect", "--format", CONTAINER_INSPECT_FORMAT/);
  assert.match(verifier,/docker\(\["image", "inspect", "--format", IMAGE_INSPECT_FORMAT/);
  assert.match(verifier,/POSTDEPLOY_RUNTIME_DRIFT/);
  assert.match(verifier,/publishPreparedJsonArtifact/);
  assert.match(verifier,/readRecoverableJsonPublication/);
  assert.match(verifier,/commitPreparedReleaseIdentity/);
  assert.match(verifier,/POSTDEPLOY_RECOVERED_RECEIPT_MISMATCH/);
  assert.doesNotMatch(writer,/postdeploy receipt already exists/);
  assert.doesNotMatch(verifier,/\.Config\.Env|Config\.Env/);
  const prepare=writer.indexOf('postdeploy-release-verifier.mjs" prepare'),commit=writer.indexOf('postdeploy-release-verifier.mjs" commit',prepare);
  assert.ok(prepare>=0&&commit>prepare,"identity must stage, re-inspect in the verifier, then commit");
});

test("legacy direct identity publisher CLI is disabled",()=>{
  const script=fileURLToPath(new URL("../scripts/release-identity-contract.mjs",import.meta.url));
  const result=spawnSync(process.execPath,[script,"publish"],{encoding:"utf8"});
  assert.equal(result.status,1);
  assert.equal(result.stdout,"");
  assert.equal(result.stderr,"RELEASE_IDENTITY_DIRECT_CLI_DISABLED\n");
});

test("legacy manifest-to-identity publisher fails closed before reading deployment evidence",()=>{
  const script=fileURLToPath(new URL("../scripts/publish-release-identity-from-manifest.mjs",import.meta.url));
  const result=spawnSync(process.execPath,[script,"prepare"],{encoding:"utf8"});
  assert.equal(result.status,1);
  assert.equal(result.stdout,"");
  assert.equal(result.stderr,"RUNTIME_IDENTITY_POSTDEPLOY_RECEIPT_REQUIRED\n");
});
