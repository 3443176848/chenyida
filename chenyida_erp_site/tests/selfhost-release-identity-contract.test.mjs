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
import {
  assertPostDeployReadinessStable,
  loadPostDeployRuntimePolicy,
  normalizeCaddyfileDigestOutput,
  normalizePostDeployImageIdentity,
  normalizePostDeployVolumeIdentity,
  normalizePostDeployInspectRows,
  normalizeReadinessResponse,
  verifyPostDeployBindMountIdentity,
  verifyAuthorizedComposeProjectRoot,
} from "../scripts/postdeploy-release-verifier.mjs";
import {
  FIXTURE_VERSION,
  FIXTURE_WEB,
  FIXTURE_WORKER,
  FIXTURE_CONTROL,
  buildEligibleReleaseFixture,
} from "./release-gate-fixture.mjs";

const rootCapable=typeof process.getuid==="function"&&process.getuid()===0;
const readerGid=typeof process.getgid==="function"?process.getgid():0;
const composeProjectRoot=path.resolve(fileURLToPath(new URL("..",import.meta.url)));
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
  application_version:"0.1.0-alpha.47",
  git_commit:"b".repeat(40),
  git_tree:"c".repeat(40),
  migration_head:"0046_runtime_lock_privilege_boundary.sql",
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

function runtimeMounts() {
  return {
    caddy:[
      {type:"bind",source:"$PROJECT_ROOT/deploy/Caddyfile",target:"/etc/caddy/Caddyfile",read_only:true},
      {type:"volume",source:"caddy_data",target:"/data",read_only:false},
      {type:"volume",source:"caddy_config",target:"/config",read_only:false},
    ],
    postgres:[
      {type:"volume",source:"erp_postgres",target:"/var/lib/postgresql/data",read_only:false},
      {type:"volume",source:"erp_postgres_tablespaces",target:"/var/lib/postgresql/tablespaces",read_only:false},
      {type:"bind",source:"/etc/chenyida-erp/runtime-secrets/postgres-bootstrap-password",target:"/run/chenyida-erp-secrets/postgres-bootstrap-password",read_only:true},
    ],
    web:[
      {type:"volume",source:"erp_uploads",target:"/data/chenyida-erp/uploads",read_only:false},
      {type:"volume",source:"erp_attachments",target:"/data/chenyida-erp/attachments",read_only:false},
      {type:"volume",source:"erp_backup_status",target:"/data/chenyida-erp/backup-status",read_only:true},
      {type:"bind",source:"/var/lib/chenyida-erp/release-identity",target:"/run/chenyida-erp-release",read_only:true},
      {type:"bind",source:"/etc/chenyida-erp/runtime-secrets/web-database-password",target:"/run/chenyida-erp-secrets/web-database-password",read_only:true},
    ],
    worker:[
      {type:"volume",source:"erp_uploads",target:"/data/chenyida-erp/uploads",read_only:false},
      {type:"volume",source:"erp_attachments",target:"/data/chenyida-erp/attachments",read_only:false},
      {type:"bind",source:"/etc/chenyida-erp/runtime-secrets/worker-database-password",target:"/run/chenyida-erp-secrets/worker-database-password",read_only:true},
    ],
  };
}

function runtimeTmpfs() {
  return {
    caddy:[],
    postgres:[
      "/tmp:rw,nosuid,nodev,noexec,size=32m,mode=1777",
      "/run/chenyida-erp-secrets:rw,nosuid,nodev,noexec,size=1m,uid=0,gid=0,mode=0555",
      "/var/run/postgresql:rw,nosuid,nodev,noexec,size=16m,uid=999,gid=999,mode=3775",
    ],
    web:["/tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777"],
    worker:["/tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777"],
  };
}

function dockerTmpfs(service) {
  return Object.fromEntries(runtimeTmpfs()[service].map(definition=>{const separator=definition.indexOf(":");return [definition.slice(0,separator),definition.slice(separator+1)];}));
}

function dockerMounts(service,composeProject="chenyida-erp-uat") {
  return runtimeMounts()[service].map(mount=>mount.type==="volume"
    ? {Type:"volume",Name:`${composeProject}_${mount.source}`,Source:`/var/lib/docker/volumes/${composeProject}_${mount.source}/_data`,Destination:mount.target,Driver:"local",Mode:mount.read_only?"ro":"rw",RW:!mount.read_only,Propagation:""}
    : {Type:"bind",Source:mount.source==="$PROJECT_ROOT/deploy/Caddyfile"?path.join(composeProjectRoot,"deploy","Caddyfile"):mount.source,Destination:mount.target,Mode:mount.read_only?"ro":"rw",RW:!mount.read_only,Propagation:"rprivate"});
}

function healthcheckProjection(value) {
  if(value===null)return null;
  const units={s:1_000_000_000};
  const duration=item=>{const match=item.match(/^(\d+)(s)$/);return Number(match[1])*units[match[2]];};
  return {Test:value.test.map(item=>item.replaceAll("$${","${")),Interval:duration(value.interval),Timeout:duration(value.timeout),Retries:value.retries,...(value.start_period===null?{}:{StartPeriod:duration(value.start_period)})};
}

function imageProjection(service,state,manifest) {
  const app=["web","worker"].includes(service);
  const defaults={
    caddy:{command:["caddy","run","--config","/etc/caddy/Caddyfile","--adapter","caddyfile"],entrypoint:null,working_directory:"/srv",stop_signal:""},
    postgres:{command:["postgres"],entrypoint:["docker-entrypoint.sh"],working_directory:"",stop_signal:"SIGINT"},
    web:{command:["node","server.js"],entrypoint:null,working_directory:"/app",stop_signal:""},
    worker:{command:["node","--experimental-strip-types","worker/selfhost.ts"],entrypoint:null,working_directory:"/app",stop_signal:""},
  }[service];
  const environmentKeys={
    caddy:["CADDY_VERSION","PATH","XDG_CONFIG_HOME","XDG_DATA_HOME"],
    postgres:["GOSU_VERSION","LANG","PATH","PGDATA","PG_MAJOR","PG_VERSION"],
    web:["ERP_RUNTIME_BUILD_VERSION","ERP_RUNTIME_GIT_COMMIT","HOSTNAME","NODE_ENV","PATH","PORT","SSL_CERT_FILE"],
    worker:["ERP_RUNTIME_BUILD_VERSION","ERP_RUNTIME_GIT_COMMIT","NODE_ENV","PATH","SSL_CERT_FILE"],
  }[service];
  return {image_id:state.image_id,image_config_digest:app?`sha256:${(service==="web"?"e":"f").repeat(64)}`:null,environment_keys:environmentKeys,safe_environment:app?{ERP_RUNTIME_BUILD_VERSION:manifest.source.package_version,ERP_RUNTIME_GIT_COMMIT:manifest.source.git_commit}:{},defaults};
}

function strictRuntimeFixture(policy,manifest,services) {
  const composeProject="chenyida-erp-uat",manifestSha256=sha256(canonicalJson(manifest)),supervisorBundleSha256=manifest.control.supervisor_bundle_sha256;
  const reader="4242";
  const fixed={ERP_ENV:"production",ERP_UPLOAD_ROOT:"/data/chenyida-erp/uploads",ERP_ATTACHMENT_ROOT:"/data/chenyida-erp/attachments",ERP_BACKUP_STATUS_FILE:"/data/chenyida-erp/backup-status/recovery-readiness.json"};
  const serviceValues={caddy:{ERP_HTTPS_PORT:"443"},postgres:{POSTGRES_DB:"chenyida_erp",POSTGRES_PASSWORD_FILE:"/run/chenyida-erp-secrets/postgres-bootstrap-password",POSTGRES_USER:"postgres"},web:{ERP_PROCESS_NAME:"chenyida-erp-web",ERP_SERVICE_KIND:"WEB",NODE_OPTIONS:"--max-old-space-size=384",PORT:"3000"},worker:{ERP_PROCESS_NAME:"chenyida-erp-worker",ERP_SERVICE_KIND:"WORKER",ERP_WORKER_INSTANCE_FILE:"/tmp/chenyida-erp-worker-instance-id",NODE_OPTIONS:"--max-old-space-size=384"}};
  const networkIds={backend:"a".repeat(64),edge:"b".repeat(64)};
  const imageIdentities={};
  const rows=services.map((state,index)=>{
    const service=state.service,runtime=policy.runtime[service],image=imageProjection(service,state,manifest);imageIdentities[service]=image;
    const environmentKeys=new Set(image.environment_keys);
    for(const key of runtime.environment_additions)environmentKeys.add(key);
    if(runtime.environment_profile==="app_release"){for(const key of policy.app_environment_keys)environmentKeys.add(key);environmentKeys.add("ERP_RUNTIME_IMAGE_REFERENCE");environmentKeys.add("ERP_RUNTIME_IMAGE_CONFIG_DIGEST");}
    const values={...Object.fromEntries([...environmentKeys].map(key=>[key,`fixture-${key.toLowerCase()}`])),...fixed,...(serviceValues[service]||{}),ERP_DEPLOYMENT_CLASS:"uat",ERP_RELEASE_EXPECTED_DEPLOYMENT_ID:composeProject,ERP_RELEASE_EXPECTED_VERSION:manifest.source.package_version,ERP_RELEASE_EXPECTED_GIT_COMMIT:manifest.source.git_commit,ERP_RELEASE_EXPECTED_MANIFEST_SHA256:manifestSha256,ERP_RELEASE_EXPECTED_SUPERVISOR_BUNDLE_SHA256:supervisorBundleSha256,ERP_RUNTIME_BUILD_VERSION:manifest.source.package_version,ERP_RUNTIME_GIT_COMMIT:manifest.source.git_commit,ERP_RUNTIME_IMAGE_REFERENCE:state.image_reference,ERP_RUNTIME_IMAGE_CONFIG_DIGEST:image.image_config_digest};
    const safeEnvironment=Object.fromEntries([...environmentKeys].map(key=>[key,values[key]]));
    const portBindings=Object.fromEntries(runtime.ports.map(port=>[`${port.target}/${port.protocol}`,[{HostIp:port.host_ip,HostPort:port.published_default}]]));
    const containerName=`${composeProject}-${service}-1`;
    const networks=Object.fromEntries(runtime.networks.map((logical,networkIndex)=>{const octet=logical==="backend"?30:31,host=index+2;return [`${composeProject}_${logical}`,{Aliases:[containerName,service],DNSNames:[containerName,service,state.container_id.slice(0,12)],DriverOpts:null,EndpointID:((index+networkIndex+5).toString(16)).repeat(64),Gateway:`172.${octet}.0.1`,GlobalIPv6Address:"",GlobalIPv6PrefixLen:0,GwPriority:0,IPAMConfig:null,IPAddress:`172.${octet}.0.${host}`,IPPrefixLen:16,IPv6Gateway:"",Links:null,MacAddress:`02:42:ac:${octet.toString(16)}:00:${host.toString(16).padStart(2,"0")}`,NetworkID:networkIds[logical]}];}));
    return {
      Id:state.container_id,Name:`/${containerName}`,Image:state.image_id,Mounts:dockerMounts(service),RestartCount:state.restart_count,EnvironmentKeys:[...environmentKeys],SafeEnvironment:safeEnvironment,
      Config:{Image:state.image_reference,User:runtime.user,Labels:{"com.docker.compose.project":composeProject,"com.docker.compose.service":service,"com.docker.compose.project.working_dir":composeProjectRoot,"com.docker.compose.container-number":"1","com.docker.compose.oneoff":"False","com.docker.compose.version":"5.1.4","com.docker.compose.image":state.image_id,"com.docker.compose.config-hash":"9".repeat(64),...(["web","worker"].includes(service)?{"org.opencontainers.image.version":manifest.source.package_version,"org.opencontainers.image.revision":manifest.source.git_commit}:{})},Healthcheck:healthcheckProjection(runtime.healthcheck),StopTimeout:runtime.lifecycle.stop_grace_period===null?null:30,Cmd:runtime.process.command??image.defaults.command,Entrypoint:runtime.process.entrypoint??image.defaults.entrypoint,WorkingDir:image.defaults.working_directory,StopSignal:image.defaults.stop_signal,OpenStdin:false,StdinOnce:false,Tty:false},
      HostConfig:{Tmpfs:dockerTmpfs(service),GroupAdd:runtime.groups.length?[reader]:null,Privileged:false,ReadonlyRootfs:true,CapAdd:runtime.cap_add.length?runtime.cap_add:null,CapDrop:runtime.cap_drop,SecurityOpt:runtime.security_options,NanoCpus:runtime.resources.cpus*1_000_000_000,Memory:runtime.resources.memory_bytes,MemorySwap:runtime.resources.memory_swap_bytes,PidsLimit:runtime.resources.pids,ShmSize:runtime.resources.shared_memory_bytes??67_108_864,RestartPolicy:{MaximumRetryCount:0,Name:runtime.lifecycle.restart},Init:runtime.lifecycle.init?true:null,AutoRemove:false,LogConfig:{Config:{"max-file":runtime.logging.max_file,"max-size":runtime.logging.max_size},Type:runtime.logging.driver},PortBindings:Object.keys(portBindings).length?portBindings:null,NetworkMode:`${composeProject}_${runtime.networks[0]}`,CgroupParent:"",CgroupnsMode:"private",Dns:null,DnsOptions:null,DnsSearch:null,ExtraHosts:[],Devices:null,DeviceRequests:null,Runtime:"runc",IpcMode:"private",PidMode:"",UTSMode:"",UsernsMode:"",OomKillDisable:null,OomScoreAdj:0,PublishAllPorts:false,Sysctls:null,Ulimits:null,VolumesFrom:null,Links:null,Isolation:"",MemoryReservation:0,CpuShares:0,CpuPeriod:0,CpuQuota:0,CpusetCpus:"",CpusetMems:"",BlkioWeight:0,MaskedPaths:["/proc/acpi","/proc/asound","/proc/interrupts","/proc/kcore","/proc/keys","/proc/latency_stats","/proc/sched_debug","/proc/scsi","/proc/timer_list","/proc/timer_stats","/sys/devices/virtual/powercap","/sys/firmware"],ReadonlyPaths:["/proc/bus","/proc/fs","/proc/irq","/proc/sys","/proc/sysrq-trigger"]},
      NetworkSettings:{Ports:{...portBindings,...(service==="postgres"?{"5432/tcp":null}:{})},Networks:networks},
      State:{OOMKilled:state.oom_killed,Running:state.running,Restarting:state.restarting,Paused:state.paused,Dead:state.dead,Status:state.status,Pid:1000+index,...(state.health==="none"?{}:{Health:{Status:state.health}})},
    };
  });
  const networkRows=["backend","edge"].map(logical=>{
    const octet=logical==="backend"?30:31,members={};
    for(const row of rows){const endpoint=row.NetworkSettings.Networks[`${composeProject}_${logical}`];if(!endpoint)continue;members[row.Id]={EndpointID:endpoint.EndpointID,IPv4Address:`${endpoint.IPAddress}/${endpoint.IPPrefixLen}`,IPv6Address:"",MacAddress:endpoint.MacAddress,Name:row.Name.slice(1)};}
    return {Id:networkIds[logical],Name:`${composeProject}_${logical}`,Driver:"bridge",Scope:"local",Internal:logical==="backend",Attachable:false,Ingress:false,ConfigOnly:false,EnableIPv4:true,EnableIPv6:false,Options:{},Labels:{"com.docker.compose.network":logical,"com.docker.compose.project":composeProject,"com.docker.compose.version":"2.24.0"},Containers:members,IPAM:{Config:[{Gateway:`172.${octet}.0.1`,Subnet:`172.${octet}.0.0/16`}],Driver:"default",Options:null},LogicalName:logical};
  });
  return {rows,networkRows,imageIdentities,reader,manifestSha256,supervisorBundleSha256};
}

async function trustedRoot(parent,name="release"){
  const root=path.join(parent,name);await mkdir(root,{mode:0o750});await chmod(root,0o750);const marker=path.join(root,RELEASE_IDENTITY_ROOT_MARKER);await writeFile(marker,RELEASE_IDENTITY_ROOT_MARKER_VALUE,{mode:0o440});await chmod(marker,0o440);return root;
}

test("post-deploy loader accepts the exact six-service policy and binds the authorized Caddy source",async()=>{
  const policy=await loadPostDeployRuntimePolicy(path.join(composeProjectRoot,"operations","container-runtime-policy-v1.json"));
  assert.deepEqual(Object.keys(policy.mounts).sort(),["caddy","postgres","web","worker"]);
  assert.deepEqual(Object.keys(policy.tmpfs).sort(),["caddy","postgres","web","worker"]);
  assert.equal(verifyAuthorizedComposeProjectRoot({composeProjectRoot,caddyfileSha256:policy.caddyfile_sha256}),path.join(composeProjectRoot,"deploy","Caddyfile"));
  assert.throws(()=>verifyAuthorizedComposeProjectRoot({composeProjectRoot,caddyfileSha256:"0".repeat(64)}),error=>error.code==="POSTDEPLOY_CADDYFILE_INVALID");
});

test("persistent volume provenance remains valid across Compose upgrades but rejects identity drift",()=>{
  const composeProject="chenyida-erp-uat",name=`${composeProject}_erp_uploads`,source=`/var/lib/docker/volumes/${name}/_data`;
  const volume={CreatedAt:"2025-01-02T03:04:05Z",Driver:"local",Labels:{"com.docker.compose.project":composeProject,"com.docker.compose.version":"2.24.0","com.docker.compose.volume":"erp_uploads"},Mountpoint:source,Name:name,Options:null,Scope:"local"};
  assert.deepEqual(normalizePostDeployVolumeIdentity({volume,name,source,composeProject}),{name,logical_name:"erp_uploads",created_at:volume.CreatedAt,mountpoint:source,created_with_compose_version:"2.24.0",configuration_sha256:null});
  assert.equal(normalizePostDeployVolumeIdentity({volume:{...volume,Labels:{"com.docker.compose.config-hash":"7".repeat(64),...volume.Labels}},name,source,composeProject}).configuration_sha256,"7".repeat(64));
  assert.throws(()=>normalizePostDeployVolumeIdentity({volume:{...volume,Labels:{"com.docker.compose.config-hash":"short",...volume.Labels}},name,source,composeProject}),error=>error.code==="POSTDEPLOY_VOLUME_IDENTITY_INVALID");
  assert.throws(()=>normalizePostDeployVolumeIdentity({volume:{...volume,Labels:{...volume.Labels,unexpected:"value"}},name,source,composeProject}),error=>error.code==="POSTDEPLOY_VOLUME_IDENTITY_INVALID");
  assert.throws(()=>normalizePostDeployVolumeIdentity({volume:{...volume,Driver:"nfs"},name,source,composeProject}),error=>error.code==="POSTDEPLOY_VOLUME_IDENTITY_INVALID");
  assert.throws(()=>normalizePostDeployVolumeIdentity({volume:{...volume,Labels:{...volume.Labels,"com.docker.compose.project":"other"}},name,source,composeProject}),error=>error.code==="POSTDEPLOY_VOLUME_IDENTITY_INVALID");
  assert.throws(()=>normalizePostDeployVolumeIdentity({volume:{...volume,Labels:{...volume.Labels,"com.docker.compose.version":"current"}},name,source,composeProject}),error=>error.code==="POSTDEPLOY_VOLUME_IDENTITY_INVALID");
});

test("bind mount identity is tied to the exact host inode visible through the container root projection",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"cyd-bind-identity-"));
  try{
    const source=path.join(root,"source"),other=path.join(root,"other");
    await writeFile(source,"fixture",{mode:0o400});await writeFile(other,"fixture",{mode:0o400});
    const identity=verifyPostDeployBindMountIdentity({pid:process.pid,source,target:source});
    assert.equal(identity.source,source);assert.match(identity.device,/^\d+$/);assert.match(identity.inode,/^[1-9]\d*$/);
    assert.throws(()=>verifyPostDeployBindMountIdentity({pid:process.pid,source,target:other}),error=>error.code==="POSTDEPLOY_BIND_MOUNT_IDENTITY_INVALID");
  }finally{await rm(root,{recursive:true,force:true});}
});

test("image inspection is JSON-structured and does not treat path delimiters as fields",()=>{
  const digest=`sha256:${"6".repeat(64)}`,reference=`registry.example.com/erp/web@${digest}`;
  const configDigest=`sha256:${"7".repeat(64)}`,fields=[digest,"linux","amd64",[reference],{digest,annotations:{"config.digest":configDigest}},["node","server.js"],null,"/srv|release",null];
  const normalized=normalizePostDeployImageIdentity({fields,reference,rowImage:digest,environmentKeys:["ERP_RUNTIME_BUILD_VERSION","PATH"],expectedEnvironmentKeys:["ERP_RUNTIME_BUILD_VERSION","PATH"],safeEnvironment:{ERP_RUNTIME_BUILD_VERSION:"1.2.3"}});
  assert.equal(normalized.defaults.working_directory,"/srv|release");
  assert.equal(normalized.image_config_digest,configDigest);
  assert.throws(()=>normalizePostDeployImageIdentity({fields,reference,rowImage:digest,environmentKeys:["PATH","PATH"],expectedEnvironmentKeys:["PATH"],safeEnvironment:{}}),error=>error.code==="POSTDEPLOY_IMAGE_MISMATCH");
  assert.throws(()=>normalizePostDeployImageIdentity({fields:[...fields.slice(0,4),{digest:`sha256:${"7".repeat(64)}`},...fields.slice(5)],reference,rowImage:digest,environmentKeys:["PATH"],expectedEnvironmentKeys:["PATH"],safeEnvironment:{}}),error=>error.code==="POSTDEPLOY_IMAGE_MISMATCH");
});

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
    runtimeConfigurationSha256:"3".repeat(64),
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
  assert.throws(()=>buildPostDeployReceipt({runId:"local-only",generatedAt:"2026-08-12T01:30:00.000Z",deploymentClass:"UAT",deploymentId:"chenyida-erp-uat",composeProject:"chenyida-erp-uat",manifest:fixture.manifest,manifestSha256:sha256(canonicalJson(fixture.manifest)),supervisorBundleSha256:fixture.manifest.control.supervisor_bundle_sha256,authorizationSha256:"4".repeat(64),runtimePolicySha256:RELEASE_RUNTIME_POLICY_SHA256,runtimeConfigurationSha256:"3".repeat(64),services:runtimeServices(fixture.manifest),readiness:readiness(fixture.manifest)}),error=>error.code==="POSTDEPLOY_LOCAL_ONLY_IMAGE_FORBIDDEN");
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

  assert.throws(()=>buildPostDeployReceipt({runId:"migration-drift",generatedAt:"2026-08-12T01:30:00.000Z",deploymentClass:"UAT",deploymentId:"chenyida-erp-uat",composeProject:"chenyida-erp-uat",manifest,manifestSha256:sha256(canonicalJson(manifest)),supervisorBundleSha256:manifest.control.supervisor_bundle_sha256,authorizationSha256:"4".repeat(64),runtimePolicySha256:RELEASE_RUNTIME_POLICY_SHA256,runtimeConfigurationSha256:"3".repeat(64),services,readiness:{...readiness(manifest),migration_manifest_sha256:"0".repeat(64)}}),error=>error.code==="POSTDEPLOY_READINESS_IDENTITY_MISMATCH");
  assert.throws(()=>buildPostDeployReceipt({runId:"deployment-drift",generatedAt:"2026-08-12T01:30:00.000Z",deploymentClass:"UAT",deploymentId:"chenyida-erp-uat",composeProject:"chenyida-erp-uat",manifest,manifestSha256:sha256(canonicalJson(manifest)),supervisorBundleSha256:manifest.control.supervisor_bundle_sha256,authorizationSha256:"4".repeat(64),runtimePolicySha256:RELEASE_RUNTIME_POLICY_SHA256,runtimeConfigurationSha256:"3".repeat(64),services,readiness:{...readiness(manifest),deployment_class:"PRODUCTION"}}),error=>error.code==="POSTDEPLOY_READINESS_IDENTITY_MISMATCH");
  assert.throws(()=>buildPostDeployReceipt({runId:"manifest-digest-drift",generatedAt:"2026-08-12T01:30:00.000Z",deploymentClass:"UAT",deploymentId:"chenyida-erp-uat",composeProject:"chenyida-erp-uat",manifest,manifestSha256:"0".repeat(64),supervisorBundleSha256:manifest.control.supervisor_bundle_sha256,authorizationSha256:"4".repeat(64),runtimePolicySha256:RELEASE_RUNTIME_POLICY_SHA256,runtimeConfigurationSha256:"3".repeat(64),services,readiness:readiness(manifest)}),error=>error.code==="POSTDEPLOY_MANIFEST_SHA256_MISMATCH");
  assert.throws(()=>buildPostDeployReceipt({runId:"clock-skew",generatedAt:"2026-08-12T01:30:00.000Z",deploymentClass:"UAT",deploymentId:"chenyida-erp-uat",composeProject:"chenyida-erp-uat",manifest,manifestSha256:sha256(canonicalJson(manifest)),supervisorBundleSha256:manifest.control.supervisor_bundle_sha256,authorizationSha256:"4".repeat(64),runtimePolicySha256:RELEASE_RUNTIME_POLICY_SHA256,runtimeConfigurationSha256:"3".repeat(64),services,readiness:{...readiness(manifest),database_time:"2026-08-12T01:36:00.001Z"}}),error=>error.code==="POSTDEPLOY_CLOCK_SKEW_INVALID");

  const policy=await loadPostDeployRuntimePolicy(path.join(composeProjectRoot,"operations","container-runtime-policy-v1.json"));
  const strict=strictRuntimeFixture(policy,manifest,services),rows=strict.rows;
  const selectors=Object.fromEntries(services.map(state=>[state.service,`chenyida-erp-uat-${state.service}-1`]));
  const expectedReferences=Object.fromEntries(services.map(state=>[state.service,state.image_reference]));
  const expectedMounts=runtimeMounts();
  const expectedTmpfs=runtimeTmpfs();
  const inspectOptions={networkRows:strict.networkRows,inventoryIds:services.map(state=>state.container_id),networkInventoryNames:["chenyida-erp-uat_backend","chenyida-erp-uat_edge"],volumeInventoryNames:policy.volume_names.map(name=>`chenyida-erp-uat_${name}`),composeProject:"chenyida-erp-uat",composeProjectRoot,composeVersion:"5.1.4",selectors,expectedReferences,expectedMounts,expectedTmpfs,expectedRuntime:policy.runtime,expectedVolumeNames:policy.volume_names,appEnvironmentKeys:policy.app_environment_keys,expectedVersion:manifest.source.package_version,expectedRevision:manifest.source.git_commit,expectedManifestSha256:strict.manifestSha256,expectedSupervisorBundleSha256:strict.supervisorBundleSha256,expectedDeploymentClass:"UAT",expectedDeploymentId:"chenyida-erp-uat",readerGid:strict.reader,imageIdentity:(...args)=>strict.imageIdentities[args[1].Config.Labels["com.docker.compose.service"]],volumeIdentity:({name,source})=>({name,logical_name:name.slice("chenyida-erp-uat_".length),created_at:"2025-01-02T03:04:05.000Z",mountpoint:source,created_with_compose_version:"2.24.0",configuration_sha256:null}),bindIdentity:({source,target})=>({source,target,device:"1",inode:BigInt(`0x${sha256(`${source}:${target}`).slice(0,15)}`).toString()})};
  const normalized=normalizePostDeployInspectRows({rows,...inspectOptions});
  assert.deepEqual(normalized.services,services);
  assert.match(normalized.runtime_configuration_sha256,/^[0-9a-f]{64}$/);
  const synchronizedImageEnvironmentDrift=structuredClone(rows);const synchronizedWeb=synchronizedImageEnvironmentDrift.find(row=>row.Config.Labels["com.docker.compose.service"]==="web");synchronizedWeb.EnvironmentKeys.push("DATABASE_URL");synchronizedWeb.SafeEnvironment.DATABASE_URL="redacted-fixture";
  assert.throws(()=>normalizePostDeployInspectRows({rows:synchronizedImageEnvironmentDrift,...inspectOptions,imageIdentity:(...args)=>{const service=args[1].Config.Labels["com.docker.compose.service"],identity=strict.imageIdentities[service];return service==="web"?{...identity,environment_keys:[...identity.environment_keys,"DATABASE_URL"]}:identity;}}),error=>error.code==="POSTDEPLOY_IMAGE_MISMATCH");
  const wrongPublicOrigin=structuredClone(rows);wrongPublicOrigin.find(row=>row.Config.Labels["com.docker.compose.service"]==="web").SafeEnvironment.ERP_PUBLIC_ORIGIN="https://wrong.example.invalid";
  assert.notEqual(normalizePostDeployInspectRows({rows:wrongPublicOrigin,...inspectOptions}).runtime_configuration_sha256,normalized.runtime_configuration_sha256);
  const changedComposeConfiguration=structuredClone(rows);changedComposeConfiguration.find(row=>row.Config.Labels["com.docker.compose.service"]==="worker").Config.Labels["com.docker.compose.config-hash"]="8".repeat(64);
  assert.notEqual(normalizePostDeployInspectRows({rows:changedComposeConfiguration,...inspectOptions}).runtime_configuration_sha256,normalized.runtime_configuration_sha256);
  const modernNetworks=structuredClone(strict.networkRows);for(const network of modernNetworks)network.Labels["com.docker.compose.config-hash"]="7".repeat(64);
  assert.notEqual(normalizePostDeployInspectRows({rows,...inspectOptions,networkRows:modernNetworks}).runtime_configuration_sha256,normalized.runtime_configuration_sha256);
  const invalidModernNetworks=structuredClone(modernNetworks);invalidModernNetworks[0].Labels["com.docker.compose.config-hash"]="short";
  assert.throws(()=>normalizePostDeployInspectRows({rows,...inspectOptions,networkRows:invalidModernNetworks}),error=>error.code==="POSTDEPLOY_RUNTIME_NETWORK_INVALID");
  const retainedOneShot={...rows.at(-1),Id:"5".repeat(64)};
  for(const service of ["migrate","admin"]){
    const extra=structuredClone(retainedOneShot);extra.Config.Labels["com.docker.compose.service"]=service;
    assert.throws(()=>normalizePostDeployInspectRows({rows:[...rows,extra],...inspectOptions,inventoryIds:[...inspectOptions.inventoryIds,extra.Id]}),error=>error.code==="POSTDEPLOY_SERVICE_SET_INVALID");
  }
  assert.throws(()=>normalizePostDeployInspectRows({rows,...inspectOptions,inventoryIds:services.slice(1).map(state=>state.container_id)}),error=>error.code==="POSTDEPLOY_SERVICE_SET_INVALID");
  assert.throws(()=>normalizePostDeployInspectRows({rows,...inspectOptions,networkInventoryNames:[...inspectOptions.networkInventoryNames,"chenyida-erp-uat_rogue"]}),error=>error.code==="POSTDEPLOY_RUNTIME_NETWORK_INVALID");
  assert.throws(()=>normalizePostDeployInspectRows({rows,...inspectOptions,volumeInventoryNames:[...inspectOptions.volumeInventoryNames,"chenyida-erp-uat_rogue"]}),error=>error.code==="POSTDEPLOY_VOLUME_IDENTITY_INVALID");
  const missingSecret=structuredClone(rows);missingSecret.find(row=>row.Config.Labels["com.docker.compose.service"]==="web").Mounts.pop();
  assert.throws(()=>normalizePostDeployInspectRows({rows:missingSecret,...inspectOptions}),error=>error.code==="POSTDEPLOY_RUNTIME_MOUNTS_INVALID");
  const wrongTablespace=structuredClone(rows);wrongTablespace.find(row=>row.Config.Labels["com.docker.compose.service"]==="postgres").Mounts[1].Name="chenyida-erp-uat_erp_postgres";
  assert.throws(()=>normalizePostDeployInspectRows({rows:wrongTablespace,...inspectOptions}),error=>error.code==="POSTDEPLOY_VOLUME_IDENTITY_INVALID");
  const wrongVolumeDriver=structuredClone(rows);wrongVolumeDriver.find(row=>row.Config.Labels["com.docker.compose.service"]==="web").Mounts[0].Driver="nfs";
  assert.throws(()=>normalizePostDeployInspectRows({rows:wrongVolumeDriver,...inspectOptions}),error=>error.code==="POSTDEPLOY_RUNTIME_MOUNTS_INVALID");
  const wrongVolumeMode=structuredClone(rows);wrongVolumeMode.find(row=>row.Config.Labels["com.docker.compose.service"]==="web").Mounts[0].Mode="ro";
  assert.throws(()=>normalizePostDeployInspectRows({rows:wrongVolumeMode,...inspectOptions}),error=>error.code==="POSTDEPLOY_RUNTIME_MOUNTS_INVALID");
  const wrongBindPropagation=structuredClone(rows);wrongBindPropagation.find(row=>row.Config.Labels["com.docker.compose.service"]==="postgres").Mounts.find(mount=>mount.Type==="bind").Propagation="rshared";
  assert.throws(()=>normalizePostDeployInspectRows({rows:wrongBindPropagation,...inspectOptions}),error=>error.code==="POSTDEPLOY_RUNTIME_MOUNTS_INVALID");
  const wrongWorkingDirectory=structuredClone(rows);wrongWorkingDirectory.find(row=>row.Config.Labels["com.docker.compose.service"]==="caddy").Config.Labels["com.docker.compose.project.working_dir"]="/opt/other";
  assert.throws(()=>normalizePostDeployInspectRows({rows:wrongWorkingDirectory,...inspectOptions}),error=>error.code==="POSTDEPLOY_COMPOSE_IDENTITY_INVALID");
  const wrongCaddySource=structuredClone(rows);wrongCaddySource.find(row=>row.Config.Labels["com.docker.compose.service"]==="caddy").Mounts.find(mount=>mount.Type==="bind").Source="/opt/other/deploy/Caddyfile";
  assert.throws(()=>normalizePostDeployInspectRows({rows:wrongCaddySource,...inspectOptions}),error=>error.code==="POSTDEPLOY_RUNTIME_MOUNTS_INVALID");
  const wrongTmpfs=structuredClone(rows);wrongTmpfs.find(row=>row.Config.Labels["com.docker.compose.service"]==="worker").HostConfig.Tmpfs["/tmp"]="rw,nosuid,nodev,size=64m,mode=1777";
  assert.throws(()=>normalizePostDeployInspectRows({rows:wrongTmpfs,...inspectOptions}),error=>error.code==="POSTDEPLOY_RUNTIME_TMPFS_INVALID");
  const caddyWithoutTmpfs=structuredClone(rows);delete caddyWithoutTmpfs.find(row=>row.Config.Labels["com.docker.compose.service"]==="caddy").HostConfig.Tmpfs;
  assert.deepEqual(normalizePostDeployInspectRows({rows:caddyWithoutTmpfs,...inspectOptions}).services,services);
  const projectionMutations=[
    ["user",(items)=>{items[2].Config.User="0:0";},"POSTDEPLOY_RUNTIME_SECURITY_INVALID"],
    ["privileged",(items)=>{items[0].HostConfig.Privileged=true;},"POSTDEPLOY_RUNTIME_SECURITY_INVALID"],
    ["rootfs",(items)=>{items[1].HostConfig.ReadonlyRootfs=false;},"POSTDEPLOY_RUNTIME_SECURITY_INVALID"],
    ["capabilities",(items)=>{items[3].HostConfig.CapDrop=null;},"POSTDEPLOY_RUNTIME_SECURITY_INVALID"],
    ["device request",(items)=>{items[2].HostConfig.DeviceRequests=[{Driver:"nvidia"}];},"POSTDEPLOY_RUNTIME_ISOLATION_INVALID"],
    ["reader group",(items)=>{items[2].HostConfig.GroupAdd=null;},"POSTDEPLOY_RUNTIME_SECURITY_INVALID"],
    ["memory",(items)=>{items[2].HostConfig.Memory+=1;},"POSTDEPLOY_RUNTIME_RESOURCES_INVALID"],
    ["restart",(items)=>{items[1].HostConfig.RestartPolicy.Name="always";},"POSTDEPLOY_RUNTIME_LIFECYCLE_INVALID"],
    ["init",(items)=>{items[2].HostConfig.Init=null;},"POSTDEPLOY_RUNTIME_LIFECYCLE_INVALID"],
    ["auto remove",(items)=>{items[3].HostConfig.AutoRemove=true;},"POSTDEPLOY_RUNTIME_SECURITY_INVALID"],
    ["stop timeout",(items)=>{items[3].Config.StopTimeout=null;},"POSTDEPLOY_RUNTIME_LIFECYCLE_INVALID"],
    ["logging",(items)=>{items[0].HostConfig.LogConfig.Type="json-file";},"POSTDEPLOY_RUNTIME_LOGGING_INVALID"],
    ["command",(items)=>{items[3].Config.Cmd=["node","other.js"];},"POSTDEPLOY_RUNTIME_PROCESS_INVALID"],
    ["health",(items)=>{items[2].Config.Healthcheck.Retries+=1;},"POSTDEPLOY_RUNTIME_HEALTHCHECK_INVALID"],
    ["port",(items)=>{items[0].HostConfig.PortBindings["80/tcp"][0].HostIp="127.0.0.1";},"POSTDEPLOY_RUNTIME_PORTS_INVALID"],
    ["environment key",(items)=>{items[2].EnvironmentKeys.push("DATABASE_URL");},"POSTDEPLOY_RUNTIME_ENVIRONMENT_INVALID"],
    ["release binding",(items)=>{items[2].SafeEnvironment.ERP_RELEASE_EXPECTED_VERSION="0.0.0";},"POSTDEPLOY_RUNTIME_CONTROL_BINDING_INVALID"],
    ["compose image label",(items)=>{items[2].Config.Labels["com.docker.compose.image"]="sha256:"+"0".repeat(64);},"POSTDEPLOY_COMPOSE_IDENTITY_INVALID"],
    ["container network",(items)=>{delete items[2].NetworkSettings.Networks["chenyida-erp-uat_edge"];},"POSTDEPLOY_RUNTIME_NETWORK_INVALID"],
    ["network policy",(_items,networks)=>{networks[0].Internal=false;},"POSTDEPLOY_RUNTIME_NETWORK_INVALID"],
    ["network membership",(_items,networks)=>{delete networks[1].Containers[services[0].container_id];},"POSTDEPLOY_RUNTIME_NETWORK_INVALID"],
  ];
  for(const [name,mutate,code] of projectionMutations){
    const mutatedRows=structuredClone(rows),mutatedNetworks=structuredClone(strict.networkRows);mutate(mutatedRows,mutatedNetworks);
    assert.throws(()=>normalizePostDeployInspectRows({rows:mutatedRows,...inspectOptions,networkRows:mutatedNetworks}),error=>error.code===code,name);
  }
  const caddyHash="9".repeat(64);assert.equal(normalizeCaddyfileDigestOutput(`${caddyHash}  /etc/caddy/Caddyfile\n`,caddyHash),caddyHash);
  assert.throws(()=>normalizeCaddyfileDigestOutput(`${"8".repeat(64)}  /etc/caddy/Caddyfile\n`,caddyHash),error=>error.code==="POSTDEPLOY_CADDYFILE_CONTAINER_INVALID");
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
  assert.match(writer,/LOCK_HELPER="\$SCRIPT_DIR\/release-gate-lock\.sh"/);
  assert.match(writer,/\. "\$LOCK_HELPER"/);
  assert.match(writer,/acquire_chenyida_release_gate_lock/);
  assert.doesNotMatch(writer,/flock -n 9/);
  assert.ok(writer.indexOf("acquire_chenyida_release_gate_lock") < writer.indexOf("NODE_IMAGE='node@sha256:"));
  assert.match(writer,/--pull=never/);
  assert.match(writer,/refusing to remove an unowned postdeploy bootstrap container/);
  assert.match(writer,/POST_DEPLOY_CURRENT_RUNTIME_STRICT/);
  assert.match(writer,/VERIFY_AND_PUBLISH_EXACT_POSTDEPLOY_IDENTITY/);
  assert.match(writer,/--runtime-configuration-sha256/);
  assert.equal((writer.match(/verify_runtime_secret_boundary \|\|/g)||[]).length,2);
  assert.match(writer,/runtime-secret-file-policy\.py/);
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
