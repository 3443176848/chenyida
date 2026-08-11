import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  RELEASE_IDENTITY_CONTRACT,
  RELEASE_IDENTITY_FILE,
  RELEASE_IDENTITY_ROOT_MARKER,
  RELEASE_IDENTITY_ROOT_MARKER_VALUE,
  parseStrictJson,
  publishReleaseIdentity,
  readTrustedReleaseIdentity,
  validateReleaseIdentity,
} from "../scripts/release-identity-contract.mjs";

const rootCapable=typeof process.getuid==="function"&&process.getuid()===0;
const readerGid=typeof process.getgid==="function"?process.getgid():0;
const identity=(generated_at="2026-08-12T01:00:00.000Z")=>({schema_version:1,contract:RELEASE_IDENTITY_CONTRACT,deployment_class:"UAT",deployment_id:"erp-uat",application_version:"0.1.0-alpha.44",git_commit:"b".repeat(40),web_container_id:"a".repeat(64),web_image_digest:`sha256:${"b".repeat(64)}`,worker_container_id:"c".repeat(64),worker_image_digest:`sha256:${"d".repeat(64)}`,generated_at});

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

test("root publisher durably replaces only trusted identity files with monotonic evidence",{skip:!rootCapable},async()=>{
  const parent=await mkdtemp(path.join(os.tmpdir(),"cyd-release-contract-"));try{const root=await trustedRoot(parent);const first=await publishReleaseIdentity({root,readerGid,identity:identity()});assert.equal(first.web_container_id,"a".repeat(64));const target=path.join(root,RELEASE_IDENTITY_FILE),metadata=await stat(target);assert.equal(metadata.uid,0);assert.equal(metadata.gid,readerGid);assert.equal(metadata.mode&0o7777,0o440);const second=identity("2026-08-12T01:00:01.000Z");await publishReleaseIdentity({root,readerGid,identity:second});assert.deepEqual(await readTrustedReleaseIdentity({root,readerGid}),second);await assert.rejects(publishReleaseIdentity({root,readerGid,identity:first}),error=>error.code==="RELEASE_GENERATION_NOT_MONOTONIC");await chmod(root,0o755);await assert.rejects(readTrustedReleaseIdentity({root,readerGid}),error=>error.code==="RELEASE_ROOT_TRUST_INVALID");}finally{await rm(parent,{recursive:true,force:true});}
});

test("writer records actual running Compose identities and never controls containers",{skip:!rootCapable},async()=>{
  const parent=await mkdtemp(path.join(os.tmpdir(),"cyd-release-writer-"));try{
    const root=await trustedRoot(parent),bin=path.join(parent,"bin"),log=path.join(parent,"docker.log");await mkdir(bin);await symlink(process.execPath,path.join(bin,"node"));
    const fakeDocker=path.join(bin,"docker"),webId="a".repeat(64),workerId="c".repeat(64),git="b".repeat(40);
    await writeFile(fakeDocker,`#!${process.execPath}\nconst fs=require("node:fs");const args=process.argv.slice(2);fs.appendFileSync(process.env.FAKE_DOCKER_LOG,JSON.stringify(args)+"\\n");const web="${webId}",worker="${workerId}",git="${git}";if(args[0]==="inspect"){const name=args.at(-1),service=name==="erp-web-1"?"web":name==="erp-worker-1"?"worker":"";if(!service)process.exit(2);if(args[2].includes("range .Config.Env")){process.stdout.write("ERP_DEPLOYMENT_CLASS=UAT\\nERP_RUNTIME_BUILD_VERSION=0.1.0-alpha.44\\nERP_RUNTIME_GIT_COMMIT="+git+"\\n");}else{const id=service==="web"?web:worker,digest=service==="web"?"sha256:${"b".repeat(64)}":"sha256:${"d".repeat(64)}",project=process.env.FAKE_BAD_PROJECT?"wrong":"erp-uat";process.stdout.write([id,"true","false","false","false","false",digest,project,service,"0.1.0-alpha.44",git].join("|"));}}else if(args[0]==="ps"){const service=args.some(value=>value.includes("service=web"))?"web":"worker";process.stdout.write(service==="web"?web:worker);}else process.exit(3);\n`,{mode:0o755});await chmod(fakeDocker,0o755);
    const writer=fileURLToPath(new URL("../scripts/write-release-identity.sh",import.meta.url));const args=["--identity-root",root,"--reader-gid",String(readerGid),"--deployment-class","UAT","--deployment-id","erp-uat","--application-version","0.1.0-alpha.44","--git-commit",git,"--web-container","erp-web-1","--worker-container","erp-worker-1","--confirm","PUBLISH_RUNTIME_RELEASE_IDENTITY"];
    const environment={...process.env,PATH:`${bin}:${process.env.PATH}`,FAKE_DOCKER_LOG:log};const result=spawnSync(writer,args,{encoding:"utf8",env:environment});assert.equal(result.status,0,result.stderr);const published=await readTrustedReleaseIdentity({root,readerGid});assert.equal(published.web_container_id,webId);assert.equal(published.web_image_digest,`sha256:${"b".repeat(64)}`);const commands=(await readFile(log,"utf8")).trim().split("\n").map(JSON.parse);assert.ok(commands.length>=6);assert.ok(commands.every(args=>["inspect","ps"].includes(args[0])));assert.ok(commands.every(args=>!["start","restart","stop","rm","run","up"].includes(args[0])));
    const before=await readFile(path.join(root,RELEASE_IDENTITY_FILE),"utf8");const rejected=spawnSync(writer,args,{encoding:"utf8",env:{...environment,FAKE_BAD_PROJECT:"1"}});assert.notEqual(rejected.status,0);assert.equal(await readFile(path.join(root,RELEASE_IDENTITY_FILE),"utf8"),before);
  }finally{await rm(parent,{recursive:true,force:true});}
});
