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
import { publishReleaseIdentityFromManifest } from "../scripts/publish-release-identity-from-manifest.mjs";
import { canonicalJson, sha256 } from "../scripts/release-manifest-contract.mjs";
import {
  FIXTURE_VERSION,
  FIXTURE_WEB,
  FIXTURE_WORKER,
  FIXTURE_CONTROL,
  buildEligibleReleaseFixture,
  initializeReleaseArtifactRoot,
} from "./release-gate-fixture.mjs";

const rootCapable=typeof process.getuid==="function"&&process.getuid()===0;
const readerGid=typeof process.getgid==="function"?process.getgid():0;
const identity=(generated_at="2026-08-12T01:00:00.000Z")=>({schema_version:2,contract:RELEASE_IDENTITY_CONTRACT,deployment_class:"UAT",deployment_id:"erp-uat",release_id:"fixture-alpha46",release_manifest_sha256:"1".repeat(64),supervisor_bundle_sha256:FIXTURE_CONTROL.supervisor_bundle_sha256,authorization_sha256:"4".repeat(64),application_version:"0.1.0-alpha.46",git_commit:"b".repeat(40),web_container_id:"a".repeat(64),web_image_digest:`sha256:${"b".repeat(64)}`,worker_container_id:"c".repeat(64),worker_image_digest:`sha256:${"d".repeat(64)}`,generated_at});

async function trustedRoot(parent,name="release"){
  const root=path.join(parent,name);await mkdir(root,{mode:0o750});await chmod(root,0o750);const marker=path.join(root,RELEASE_IDENTITY_ROOT_MARKER);await writeFile(marker,RELEASE_IDENTITY_ROOT_MARKER_VALUE,{mode:0o440});await chmod(marker,0o440);return root;
}

test("release identity JSON is exact, strict, and rejects duplicate or forged fields",()=>{
  assert.deepEqual(validateReleaseIdentity(identity()),identity());
  assert.throws(()=>parseStrictJson('{"schema_version":1,"schema_version":1}'),error=>error.code==="JSON_DUPLICATE_KEY");
  assert.throws(()=>validateReleaseIdentity({...identity(),unexpected:true}),error=>error.code==="RELEASE_IDENTITY_FIELDS_INVALID");
  assert.throws(()=>validateReleaseIdentity({...identity(),web_container_id:"short"}),error=>error.code==="RELEASE_WEB_CONTAINER_INVALID");
  assert.throws(()=>validateReleaseIdentity({...identity(),generated_at:"2026-08-12T01:00:00Z"}),error=>error.code==="RELEASE_GENERATED_AT_INVALID");
});

test("root publisher durably replaces only trusted identity files with monotonic and idempotent evidence",{skip:!rootCapable},async()=>{
  const parent=await mkdtemp(path.join(os.tmpdir(),"cyd-release-contract-"));try{const root=await trustedRoot(parent);const first=await publishReleaseIdentity({root,readerGid,identity:identity()});assert.equal(first.web_container_id,"a".repeat(64));const target=path.join(root,RELEASE_IDENTITY_FILE),metadata=await stat(target);assert.equal(metadata.uid,0);assert.equal(metadata.gid,readerGid);assert.equal(metadata.mode&0o7777,0o440);const idempotent=await publishReleaseIdentity({root,readerGid,identity:identity("2026-08-12T00:59:59.000Z")});assert.deepEqual(idempotent,first);assert.deepEqual(JSON.parse(await readFile(target,"utf8")),first);const second={...identity("2026-08-12T01:00:01.000Z"),web_container_id:"e".repeat(64)};await publishReleaseIdentity({root,readerGid,identity:second});assert.deepEqual(await readTrustedReleaseIdentity({root,readerGid}),second);await assert.rejects(publishReleaseIdentity({root,readerGid,identity:{...first,worker_image_digest:`sha256:${"e".repeat(64)}`}}),error=>error.code==="RELEASE_GENERATION_NOT_MONOTONIC");await chmod(root,0o755);await assert.rejects(readTrustedReleaseIdentity({root,readerGid}),error=>error.code==="RELEASE_ROOT_TRUST_INVALID");}finally{await rm(parent,{recursive:true,force:true});}
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

test("runtime identity is derived from one trusted eligible manifest and exact running image facts",{skip:!rootCapable},async()=>{
  const parent=await mkdtemp(path.join(os.tmpdir(),"cyd-release-manifest-identity-"));try{
    const artifactRoot=path.join(parent,"artifacts"),identityRoot=await trustedRoot(parent,"identity");await initializeReleaseArtifactRoot(artifactRoot);
    const generatedAt=new Date().toISOString(),now=new Date(Date.now()+60_000);const fixture=await buildEligibleReleaseFixture({entries:[{ordinal:1,filename:"0001_fixture.sql",sha256:"1".repeat(64)}],root:artifactRoot,generatedAt,expiresAt:new Date(Date.now()+59*60_000).toISOString()});
    const manifestFile=path.join(artifactRoot,"release-manifest.json"),manifestSha256=sha256(canonicalJson(fixture.manifest));
    const runtime=(containerId,imageDigest,service=imageDigest===FIXTURE_WEB?"web":"worker")=>({containerId,imageReference:fixture.manifest.images[service].image_reference,imageDigest,ociVersion:FIXTURE_VERSION,ociRevision:fixture.manifest.source.git_commit,bakedVersion:FIXTURE_VERSION,bakedRevision:fixture.manifest.source.git_commit,deploymentClass:"UAT"});
    const control={supervisorBundleSha256:fixture.manifest.control.supervisor_bundle_sha256,authorizationSha256:"4".repeat(64)};
    const published=await publishReleaseIdentityFromManifest({manifestFile,manifestSha256,identityRoot,readerGid,deploymentClass:"UAT",deploymentId:"erp-uat",...control,web:runtime("5".repeat(64),FIXTURE_WEB),worker:runtime("6".repeat(64),FIXTURE_WORKER),now});
    assert.equal(published.application_version,FIXTURE_VERSION);assert.equal(published.git_commit,fixture.manifest.source.git_commit);assert.equal(published.web_image_digest,FIXTURE_WEB);assert.equal(published.release_manifest_sha256,manifestSha256);assert.equal(published.authorization_sha256,control.authorizationSha256);
    await assert.rejects(publishReleaseIdentityFromManifest({manifestFile,manifestSha256,identityRoot,readerGid,deploymentClass:"UAT",deploymentId:"erp-uat",...control,supervisorBundleSha256:"0".repeat(64),web:runtime("7".repeat(64),FIXTURE_WEB),worker:runtime("8".repeat(64),FIXTURE_WORKER),now:new Date(now.getTime()+1)}),error=>error.code==="RUNTIME_IDENTITY_SUPERVISOR_MISMATCH");
    await assert.rejects(publishReleaseIdentityFromManifest({manifestFile,manifestSha256,identityRoot,readerGid,deploymentClass:"UAT",deploymentId:"erp-uat",...control,web:runtime("7".repeat(64),`sha256:${"7".repeat(64)}`),worker:runtime("8".repeat(64),FIXTURE_WORKER),now:new Date(now.getTime()+1)}),error=>error.code==="RUNTIME_IDENTITY_MANIFEST_MISMATCH");
    assert.deepEqual(await readTrustedReleaseIdentity({root:identityRoot,readerGid}),published);
  }finally{await rm(parent,{recursive:true,force:true});}
});

test("writer pins trusted tools, only observes application containers, and isolates the publisher",async()=>{
  const writer=await readFile(new URL("../scripts/write-release-identity.sh",import.meta.url),"utf8");
  assert.match(writer,/PATH=\/usr\/local\/sbin:/);
  assert.match(writer,/\/usr\/bin\/docker inspect/);
  assert.match(writer,/\/usr\/bin\/docker ps -a/);
  assert.match(writer,/NODE_IMAGE='node@sha256:[0-9a-f]{64}'/);
  assert.match(writer,/--network none --read-only --cap-drop ALL --cap-add CHOWN --security-opt no-new-privileges/);
  assert.match(writer,/\.RestartCount/);
  assert.match(writer,/expected_health=healthy/);
  assert.doesNotMatch(writer,/expected_health=none/);
  assert.match(writer,/\.RepoDigests/);
  assert.match(writer,/flock -n 9/);
  assert.match(writer,/--pull=never/);
  assert.match(writer,/--mount "type=bind,src=\$IDENTITY_ROOT,dst=\/release-identity"/);
  assert.doesNotMatch(writer,/-v "\$IDENTITY_ROOT:/);
  assert.match(writer,/refusing to remove an unowned identity publisher container/);
  assert.doesNotMatch(writer,/\/usr\/bin\/docker (?:restart|stop|compose up)/);
  const prepare=writer.indexOf("run_publisher prepare"),postInspect=writer.indexOf('inspect_runtime_container "$WEB_CONTAINER" web',prepare),commit=writer.indexOf("run_publisher commit",postInspect);
  assert.ok(prepare>=0&&postInspect>prepare&&commit>postInspect,"identity must stage, re-inspect, then commit");
});

test("legacy direct identity publisher CLI is disabled",()=>{
  const script=fileURLToPath(new URL("../scripts/release-identity-contract.mjs",import.meta.url));
  const result=spawnSync(process.execPath,[script,"publish"],{encoding:"utf8"});
  assert.equal(result.status,1);
  assert.equal(result.stdout,"");
  assert.equal(result.stderr,"RELEASE_IDENTITY_DIRECT_CLI_DISABLED\n");
});
