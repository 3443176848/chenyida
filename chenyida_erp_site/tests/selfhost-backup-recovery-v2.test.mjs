import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BackupContractError,
  createManifest,
  createReconciliation,
  migrationManifest,
  parseStrictJson,
  prepareRestoreReceipt,
  publishPreparedRestoreReceipt,
  readDatabaseBytes,
  validateReceipt,
  verifyLocalBackup,
  verifyOffhostBackup,
  verifyOffhostChain,
  verifyRestoredFiles,
  verifySourceReconciliation,
} from "../scripts/backup-recovery-contract.mjs";

const siteRoot=path.resolve(new URL("..",import.meta.url).pathname),scripts=path.join(siteRoot,"scripts");
const gitCommit="b".repeat(40),webImageDigest=`sha256:${"c".repeat(64)}`,workerImageDigest=`sha256:${"e".repeat(64)}`,webContainerId="a".repeat(64),workerContainerId="d".repeat(64);
const databaseSystemIdentifier="7612345678901234567",databaseOid="16384",databaseMarker="UAT.erp-uat-source";
const databaseBytes=8192;
const databaseProfile={databaseServerMajor:"17",databaseEncoding:"UTF8",databaseCollate:"C",databaseCtype:"C",databaseLocaleProvider:"libc",databaseCollationVersion:"NONE"};
const createdAt="2026-08-12T01:00:00.000Z",now="2026-08-12T02:00:00.000Z",databaseReport=`LARGE_OBJECTS\t0\t0\t${"a".repeat(64)}\n`;

function run(binary,args,options={}){const result=spawnSync(binary,args,{encoding:"utf8",...options});if(result.status!==0)throw new Error(`${path.basename(binary)} failed: ${result.stderr}`);return result;}
async function executable(file,source){await writeFile(file,source,{mode:0o700});await chmod(file,0o700);}
async function dedicatedRoot(root,name,marker,value,mode=0o700){const result=path.join(root,name);await mkdir(result,{mode});await chmod(result,mode);await writeFile(path.join(result,marker),`${value}\n`,{mode:0o400});await chmod(path.join(result,marker),0o400);return result;}
async function machineIdentityFile(root,name,value){const file=path.join(root,name);await writeFile(file,`${value}\n`,{mode:0o400});await chmod(file,0o400);return file;}
async function withTemporaryRoot(callback){const root=await mkdtemp(path.join(os.tmpdir(),"cyd-backup-v2-"));try{await chmod(root,0o700);await callback(root);}finally{await rm(root,{recursive:true,force:true});}}
async function fakePgRestore(root){const bin=path.join(root,"fake-pg");await mkdir(bin);await executable(path.join(bin,"pg_restore"),'#!/bin/sh\ncase "$*" in *--list*) printf "synthetic dump list\\n" ;; *) exit 1 ;; esac\n');return `${bin}:${process.env.PATH}`;}
async function restoredFileRoot(built,restoreRoot,runId){const fileRoot=path.join(restoreRoot,`${runId}_restore_test`);await mkdir(fileRoot,{mode:0o700});for(const [directoryName,archive] of [["uploads","uploads.tar.gz"],["attachments","attachments.tar.gz"],["backup_status","backup-status.tar.gz"]]){const target=path.join(fileRoot,directoryName);await mkdir(target,{mode:0o700});run("tar",["-C",target,"-xzf",path.join(built.backup,archive)]);}await writeFile(path.join(fileRoot,".chenyida-erp-restored-target-v2"),`chenyida-erp-restored-target/v2:isolated-test:target-marker:${runId}\n`,{mode:0o400});await chmod(path.join(fileRoot,".chenyida-erp-restored-target-v2"),0o400);return fileRoot;}
async function fakeRestoreTools(root,reportFile,targetSystemIdentifier){
  const bin=path.join(root,"fake-restore-tools");await mkdir(bin);
  await executable(path.join(bin,"pg_restore"),'#!/bin/sh\ncase "$*" in *--list*) printf "synthetic dump list\\n" ;; *) exit 1 ;; esac\n');
  await executable(path.join(bin,"psql"),`#!/bin/sh
case "$*" in
 *"backend_type='client backend'"*) printf 'postgres\\t${targetSystemIdentifier}\\tchenyida-erp-restore-cluster/v2:TEST:isolated-test:target-cluster\\tt\\t0\\n' ;;
 *"cross join pg_database"*) printf 'cyd_restore_test\\t${targetSystemIdentifier}\\t32768\\tchenyida-erp-restore-target/v2:isolated-test:target-marker:run-1\\t0\\t17\\tUTF8\\tC\\tC\\tlibc\\tNONE\\n' ;;
 *backup-reconciliation.sql*) cat '${reportFile}' ;;
 *) exit 1 ;;
esac
`);
  return `${bin}:${process.env.PATH}`;
}

async function fixture(root,{linkedArchive=false,specialArchive=false,created=createdAt,backupId="backup-test"}={}){
  const migrations=path.join(root,"migrations"),backup=path.join(root,"backup"),report=path.join(root,"database-report.txt");await mkdir(migrations);await mkdir(backup);await writeFile(path.join(migrations,"0001_test.sql"),"select 1;\n");await writeFile(report,databaseReport);
  const migration=await migrationManifest(migrations);await writeFile(path.join(backup,"migrations.txt"),migration.text);await writeFile(path.join(backup,"postgresql.dump"),"synthetic-postgresql-dump");
  const sources={};for(const [key,archive] of [["uploads","uploads.tar.gz"],["attachments","attachments.tar.gz"],["backup_status","backup-status.tar.gz"]]){const source=path.join(root,`${key}-source`);sources[key]=source;await mkdir(source);await writeFile(path.join(source,`${key}.txt`),key);if(key==="backup_status"){await writeFile(path.join(source,".chenyida-erp-receipt-root-v2"),"chenyida-erp-receipt-root/v2\n",{mode:0o400});await chmod(path.join(source,".chenyida-erp-receipt-root-v2"),0o400);}if(linkedArchive&&key==="uploads")await symlink(`${key}.txt`,path.join(source,"linked-file"));if(specialArchive&&key==="uploads")run("mkfifo",[path.join(source,"named-pipe")]);run("tar",["-C",source,"-czf",path.join(backup,archive),"."]);}
  if(linkedArchive)await rm(path.join(sources.uploads,"linked-file"));if(specialArchive)await rm(path.join(sources.uploads,"named-pipe"));
  await createReconciliation({backupDirectory:backup,databaseReportFile:report,uploadsDirectory:sources.uploads,attachmentsDirectory:sources.attachments,backupStatusDirectory:sources.backup_status});
  const createdTime=Date.parse(created);await createManifest({backupDirectory:backup,migrationsDirectory:migrations,backupId,createdAt:created,deploymentClass:"UAT",deploymentId:"erp-uat-source",databaseName:"source_test",databaseSystemIdentifier,databaseOid,databaseMarker,databaseBytes,...databaseProfile,applicationVersion:"0.1.0-alpha.45",gitCommit,webImageDigest,workerImageDigest,policyId:"daily-rpo-v1",rpoHours:24,webContainer:"web-test",webContainerId,workerContainer:"worker-test",workerContainerId,recoveryPointAt:new Date(createdTime-120_000).toISOString(),consistencyVerifiedAfter:new Date(createdTime-60_000).toISOString(),entries:{uploads:1,attachments:1,backup_status:2}});
  const sourceMachineIdentityFile=await machineIdentityFile(root,"source-machine-id","1".repeat(32));
  return{root,backup,migrations,migration,sources,report,backupId,sourceMachineIdentityFile};
}
function verificationOptions(built,extra={}){return{backupDirectory:built.backup,migrationsDirectory:built.migrations,sourceRoot:built.root,machineIdentityFile:built.sourceMachineIdentityFile,locationId:"source-host",now,expectedDeploymentClass:"UAT",expectedDeploymentId:"erp-uat-source",expectedDatabaseName:"source_test",expectedDatabaseSystemIdentifier:databaseSystemIdentifier,expectedDatabaseOid:databaseOid,expectedDatabaseMarker:databaseMarker,expectedDatabaseBytes:databaseBytes,expectedDatabaseServerMajor:databaseProfile.databaseServerMajor,expectedDatabaseEncoding:databaseProfile.databaseEncoding,expectedDatabaseCollate:databaseProfile.databaseCollate,expectedDatabaseCtype:databaseProfile.databaseCtype,expectedDatabaseLocaleProvider:databaseProfile.databaseLocaleProvider,expectedDatabaseCollationVersion:databaseProfile.databaseCollationVersion,expectedApplicationVersion:"0.1.0-alpha.45",expectedGitCommit:gitCommit,expectedWebImageDigest:webImageDigest,expectedWorkerImageDigest:workerImageDigest,expectedMigrationHead:"0001_test.sql",expectedPolicyId:"daily-rpo-v1",expectedRpoHours:24,...extra};}

process.env.NODE_ENV="test";

test("strict JSON, migration names, and reconciliation fail closed",async()=>withTemporaryRoot(async(root)=>{
  assert.deepEqual(parseStrictJson('{"a":1,"b":[true,null]}'),{a:1,b:[true,null]});for(const source of ['{"a":1,"a":2}','{"a":1} trailing'])assert.throws(()=>parseStrictJson(source),BackupContractError);
  const migrations=path.join(root,"migrations");await mkdir(migrations);await writeFile(path.join(migrations,"0001_ok.sql"),"select 1;\n");await writeFile(path.join(migrations,"42-extra.sql"),"select 2;\n");await assert.rejects(migrationManifest(migrations),(error)=>error.code==="MIGRATION_FILENAME_UNSUPPORTED");
  const nested=path.join(root,"fixture");await mkdir(nested);const built=await fixture(nested);await verifySourceReconciliation({backupDirectory:built.backup,databaseReportFile:built.report,uploadsDirectory:built.sources.uploads,attachmentsDirectory:built.sources.attachments,backupStatusDirectory:built.sources.backup_status});await writeFile(path.join(built.sources.uploads,"uploads.txt"),"changed");await assert.rejects(verifySourceReconciliation({backupDirectory:built.backup,databaseReportFile:built.report,uploadsDirectory:built.sources.uploads,attachmentsDirectory:built.sources.attachments,backupStatusDirectory:built.sources.backup_status}),(error)=>error.code==="SOURCE_CHANGED_DURING_CAPTURE");
}));

test("manifest binds database bytes, honest dump scope, UTC dates, and canonical database rendering",async()=>withTemporaryRoot(async(root)=>{
  const built=await fixture(root),manifestFile=path.join(built.backup,"manifest.json"),original=await readFile(manifestFile,"utf8"),manifest=JSON.parse(original);
  assert.equal(await readDatabaseBytes(built.backup),databaseBytes);
  assert.equal(manifest.consistency.dump_scope,"COMPLETE_APPLICATION_DATABASE_LOGICAL_DUMP_NO_OWNER_OR_ACL");
  const cli=spawnSync(process.execPath,[path.join(scripts,"backup-recovery-contract.mjs"),"read-database-bytes","--backup",built.backup],{encoding:"utf8"});assert.equal(cli.status,0,cli.stderr);assert.equal(cli.stdout,`${databaseBytes}\n`);
  manifest.deployment.database_bytes=0;await writeFile(manifestFile,`${JSON.stringify(manifest)}\n`,{mode:0o600});await assert.rejects(readDatabaseBytes(built.backup),(error)=>error.code==="DATABASE_BYTES_INVALID");manifest.deployment.database_bytes=databaseBytes;
  manifest.created_at="2026-08-12T09:00:00+08:00";await writeFile(manifestFile,`${JSON.stringify(manifest)}\n`,{mode:0o600});await assert.rejects(readDatabaseBytes(built.backup),(error)=>error.code==="CREATED_AT_INVALID");await writeFile(manifestFile,original,{mode:0o600});
  const reconciliationSql=await readFile(path.join(scripts,"backup-reconciliation.sql"),"utf8");
  for(const setting of ["SET TimeZone = 'UTC'","SET DateStyle = 'ISO, YMD'","SET IntervalStyle = 'iso_8601'","SET extra_float_digits = 3","SET bytea_output = 'hex'"])assert.match(reconciliationSql,new RegExp(setting.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  assert.ok(reconciliationSql.indexOf("SET TimeZone")<reconciliationSql.indexOf("SELECT format("));
}));

test("local and offhost receipts bind policy, stable database, and receiver identity",async()=>withTemporaryRoot(async(root)=>{
  const built=await fixture(root),receiverMachineIdentityFile=await machineIdentityFile(root,"receiver-machine-id","2".repeat(32)),previous=process.env.PATH;process.env.PATH=await fakePgRestore(root);try{const local=await verifyLocalBackup(verificationOptions(built));assert.equal(local.result,"LOCAL_VERIFIED");assert.equal(local.deployment.database_system_identifier,databaseSystemIdentifier);assert.equal(local.deployment.database_bytes,databaseBytes);assert.match(local.evidence.source_root_identity_sha256,/^[0-9a-f]{64}$/);const localFile=path.join(root,"local.json");await writeFile(localFile,`${JSON.stringify(local)}\n`,{mode:0o600});const offhost=await verifyOffhostBackup(verificationOptions(built,{machineIdentityFile:receiverMachineIdentityFile,localReceiptFile:localFile,locationId:"offhost-a",transferId:"transfer-1",receiverRoot:root}));assert.equal(offhost.result,"OFFHOST_VERIFIED");assert.notEqual(offhost.evidence.receiver_machine_identity_sha256,local.evidence.source_machine_identity_sha256);assert.match(offhost.evidence.receiver_identity_sha256,/^[0-9a-f]{64}$/);assert.throws(()=>validateReceipt({...offhost,location_id:"source-host"}),BackupContractError);process.env.NODE_ENV="production";await assert.rejects(verifyLocalBackup(verificationOptions(built)),(error)=>error.code==="MACHINE_IDENTITY_OVERRIDE_FORBIDDEN");process.env.NODE_ENV="test";}finally{process.env.NODE_ENV="test";process.env.PATH=previous;}
}));

test("receipt history preserves two backup generations, rejects same-machine offhost, and never regresses aliases",async()=>withTemporaryRoot(async(root)=>{
  const receiptRoot=await dedicatedRoot(root,"receipts",".chenyida-erp-receipt-root-v2","chenyida-erp-receipt-root/v2",0o2750);
  const receiverRoot=path.join(root,"receiver");await mkdir(receiverRoot,{mode:0o700});
  const receiverMachineIdentityFile=await machineIdentityFile(root,"receiver-machine-id","2".repeat(32));
  const sourceOne=path.join(root,"source-one"),sourceTwo=path.join(root,"source-two");await mkdir(sourceOne);await mkdir(sourceTwo);
  const first=await fixture(sourceOne,{backupId:"backup-one",created:"2026-08-12T01:00:00.000Z"});
  const second=await fixture(sourceTwo,{backupId:"backup-two",created:"2026-08-12T01:10:00.000Z"});
  const previous=process.env.PATH;process.env.PATH=await fakePgRestore(root);
  try{
    await verifyLocalBackup(verificationOptions(first,{now:"2026-08-12T02:00:00.000Z",receiptRoot}));
    const firstReceiverBackup=path.join(receiverRoot,"backup-one");await cp(first.backup,firstReceiverBackup,{recursive:true,preserveTimestamps:true});
    const firstReceiver={...first,backup:firstReceiverBackup};
    await assert.rejects(verifyOffhostBackup(verificationOptions(firstReceiver,{now:"2026-08-12T02:01:00.000Z",machineIdentityFile:first.sourceMachineIdentityFile,localReceiptFile:path.join(receiptRoot,"backup-one.local.json"),locationId:"offhost-a",transferId:"transfer-one",receiverRoot})),(error)=>error.code==="OFFHOST_MACHINE_NOT_DISTINCT");
    await verifyOffhostBackup(verificationOptions(firstReceiver,{now:"2026-08-12T02:01:00.000Z",machineIdentityFile:receiverMachineIdentityFile,localReceiptFile:path.join(receiptRoot,"backup-one.local.json"),locationId:"offhost-a",transferId:"transfer-one",receiverRoot,receiptRoot}));

    await verifyLocalBackup(verificationOptions(second,{now:"2026-08-12T02:10:00.000Z",receiptRoot}));
    const secondReceiverBackup=path.join(receiverRoot,"backup-two");await cp(second.backup,secondReceiverBackup,{recursive:true,preserveTimestamps:true});
    const secondReceiver={...second,backup:secondReceiverBackup};
    const secondOffhostOptions=verificationOptions(secondReceiver,{now:"2026-08-12T02:11:00.000Z",machineIdentityFile:receiverMachineIdentityFile,localReceiptFile:path.join(receiptRoot,"backup-two.local.json"),locationId:"offhost-a",transferId:"transfer-two",receiverRoot,receiptRoot});
    await verifyOffhostBackup(secondOffhostOptions);
    const retried=await verifyOffhostBackup({...secondOffhostOptions,now:"2026-08-12T02:12:00.000Z"});
    assert.equal(retried.verified_at,"2026-08-12T02:11:00.000Z");
    await assert.rejects(verifyOffhostBackup({...secondOffhostOptions,transferId:"conflicting-transfer"}),(error)=>error.code==="RECEIPT_HISTORY_CONFLICT");

    for(const name of ["backup-one.local.json","backup-one.offhost.json","backup-two.local.json","backup-two.offhost.json","local.json","offhost.json","latest.json"])assert.equal((await stat(path.join(receiptRoot,name))).mode&0o777,0o640);
    const oldChain=await verifyOffhostChain({...verificationOptions(firstReceiver,{now:"2026-08-12T02:12:00.000Z"}),offhostReceiptFile:path.join(receiptRoot,"backup-one.offhost.json")});
    assert.equal(oldChain.manifest.backup_id,"backup-one");
    assert.equal(JSON.parse(await readFile(path.join(receiptRoot,"latest.json"),"utf8")).backup_id,"backup-two");
    await assert.rejects(verifyLocalBackup(verificationOptions(first,{now:"2026-08-12T02:00:00.000Z",receiptRoot})),(error)=>error.code==="RECEIPT_ALIAS_REGRESSION");
    assert.equal(JSON.parse(await readFile(path.join(receiptRoot,"latest.json"),"utf8")).backup_id,"backup-two");
  }finally{process.env.PATH=previous;}
}));

test("no caller-declared level or reconciliation can mint RESTORE_VERIFIED",async()=>withTemporaryRoot(async(root)=>{
  await assert.rejects(publishPreparedRestoreReceipt({preparedReceiptFile:path.join(root,"missing-prepared.json"),receiptRoot:path.join(root,"missing-receipts")}),BackupContractError);
  const generic=spawnSync(process.execPath,[path.join(scripts,"backup-recovery-contract.mjs"),"verify","--level","RESTORE_VERIFIED"],{encoding:"utf8"});assert.notEqual(generic.status,0);
  const removed=spawnSync(process.execPath,[path.join(scripts,"backup-recovery-contract.mjs"),"finalize-restore","--prepared-receipt",path.join(root,"missing.json"),"--receipt-root",root],{encoding:"utf8"});assert.notEqual(removed.status,0);
  const declared=spawnSync(process.execPath,[path.join(scripts,"backup-recovery-contract.mjs"),"publish-prepared-restore","--prepared-receipt",path.join(root,"missing.json"),"--receipt-root",root,"--reconciliation-sha256","a".repeat(64)],{encoding:"utf8"});assert.notEqual(declared.status,0);
}));

test("prepare writes one durable private receipt and publish uses only that prepared evidence",async()=>withTemporaryRoot(async(root)=>{
  const sourceRoot=path.join(root,"source");await mkdir(sourceRoot);
  const built=await fixture(sourceRoot);
  const receiverRoot=path.join(root,"receiver");await mkdir(receiverRoot,{mode:0o700});
  const receiverBackup=path.join(receiverRoot,built.backupId);await cp(built.backup,receiverBackup,{recursive:true,preserveTimestamps:true});
  const receiverBuilt={...built,backup:receiverBackup};
  const receiptRoot=await dedicatedRoot(root,"receipts",".chenyida-erp-receipt-root-v2","chenyida-erp-receipt-root/v2",0o2750);
  const receiverMachineIdentityFile=await machineIdentityFile(root,"receiver-machine-id","2".repeat(32));
  const previous=process.env.PATH;process.env.PATH=await fakePgRestore(root);
  try{
    await verifyLocalBackup(verificationOptions(built,{receiptRoot}));
    await verifyOffhostBackup(verificationOptions(receiverBuilt,{now:"2026-08-12T02:01:00.000Z",machineIdentityFile:receiverMachineIdentityFile,localReceiptFile:path.join(receiptRoot,"backup-test.local.json"),locationId:"offhost-a",transferId:"transfer-one",receiverRoot,receiptRoot}));
    const credentialRoot=await dedicatedRoot(root,"credentials",".chenyida-erp-credential-root-v2","chenyida-erp-credential-root/v2");
    const serviceFile=path.join(credentialRoot,"pg_service.conf");await writeFile(serviceFile,"[restore]\nhost=fixture\nuser=fixture\n",{mode:0o600});await chmod(serviceFile,0o600);
    const restoreRoot=path.join(root,"restore-root");await mkdir(restoreRoot,{mode:0o700});
    const fileRoot=await restoredFileRoot(receiverBuilt,restoreRoot,"run-1");
    const preparedReceiptFile=path.join(restoreRoot,".prepared-backup-test-run-1.json");
    const targetSystemIdentifier="7712345678901234567";
    process.env.PATH=await fakeRestoreTools(root,built.report,targetSystemIdentifier);
    const restoreOptions={...verificationOptions(receiverBuilt,{now:"2026-08-12T02:02:00.000Z"}),offhostReceiptFile:path.join(receiptRoot,"backup-test.offhost.json"),locationId:"restore-host",restoreRunId:"run-1",targetDeploymentId:"isolated-test",targetDatabaseName:"cyd_restore_test",targetMarkerId:"target-marker",targetAdminDatabase:"postgres",targetClusterMarkerId:"target-cluster",expectedTargetSystemIdentifier:targetSystemIdentifier,fileRoot,credentialRoot,serviceFile,databaseService:"restore",preparedReceiptFile};
    const prepared=await prepareRestoreReceipt(restoreOptions);
    await prepareRestoreReceipt(restoreOptions);
    assert.equal(prepared.result,"RESTORE_VERIFIED");assert.equal((await stat(preparedReceiptFile)).mode&0o777,0o400);
    await rm(fileRoot,{recursive:true});await rm(credentialRoot,{recursive:true});await rm(path.join(root,"fake-restore-tools","psql"));
    const published=await publishPreparedRestoreReceipt({preparedReceiptFile,receiptRoot});
    await publishPreparedRestoreReceipt({preparedReceiptFile,receiptRoot});
    assert.equal(published.result,"RESTORE_VERIFIED");
    for(const name of ["backup-test.run-1.restore.json","restore.json","latest.json"])assert.equal((await stat(path.join(receiptRoot,name))).mode&0o777,0o640);
    assert.equal(JSON.parse(await readFile(path.join(receiptRoot,"latest.json"),"utf8")).evidence.restore_run_id,"run-1");
    await chmod(preparedReceiptFile,0o600);await assert.rejects(publishPreparedRestoreReceipt({preparedReceiptFile,receiptRoot}),(error)=>error.code==="PREPARED_RECEIPT_UNSAFE");
  }finally{process.env.PATH=previous;}
}));

test("verifier rejects stale, identity mismatch, extra files, tamper, and archive drift",async()=>withTemporaryRoot(async(root)=>{
  const built=await fixture(root),previous=process.env.PATH;process.env.PATH=await fakePgRestore(root);try{await assert.rejects(verifyLocalBackup(verificationOptions(built,{now:"2026-08-14T02:00:00.000Z"})),(error)=>error.code==="BACKUP_STALE");await assert.rejects(verifyLocalBackup(verificationOptions(built,{expectedDatabaseSystemIdentifier:"9999999999"})),(error)=>error.code==="EXPECTED_DATABASE_SYSTEM_IDENTIFIER_MISMATCH");await assert.rejects(verifyLocalBackup(verificationOptions(built,{expectedDatabaseBytes:databaseBytes+1})),(error)=>error.code==="EXPECTED_DATABASE_BYTES_MISMATCH");await writeFile(path.join(built.backup,"extra"),"extra");await assert.rejects(verifyLocalBackup(verificationOptions(built)),(error)=>error.code==="BACKUP_FILE_SET_INVALID");await rm(path.join(built.backup,"extra"));const manifestFile=path.join(built.backup,"manifest.json"),manifest=JSON.parse(await readFile(manifestFile,"utf8"));manifest.artifacts.uploads.entries=99;await writeFile(manifestFile,`${JSON.stringify(manifest)}\n`,{mode:0o600});await assert.rejects(verifyLocalBackup(verificationOptions(built)),(error)=>["ARTIFACT_ENTRIES_MISMATCH","RECEIPT_MANIFEST_PROJECTION_MISMATCH"].includes(error.code));}finally{process.env.PATH=previous;}
}));

test("archive verifier rejects links and special files",async()=>withTemporaryRoot(async(root)=>{const previous=process.env.PATH;for(const [name,settings,code] of [["linked",{linkedArchive:true},"ARCHIVE_LINK_FORBIDDEN"],["special",{specialArchive:true},"ARCHIVE_SPECIAL_FILE_FORBIDDEN"]]){const nested=path.join(root,name);await mkdir(nested);const built=await fixture(nested,settings);process.env.PATH=await fakePgRestore(nested);await assert.rejects(verifyLocalBackup(verificationOptions(built)),(error)=>error.code===code);}process.env.PATH=previous;}));

test("restored files require exact path, bytes, digest, and safe modes",async()=>withTemporaryRoot(async(root)=>{
  const built=await fixture(root),fileRoot=path.join(root,"files_restore_test"),markerOptions={targetDeploymentId:"isolated-test",targetMarkerId:"marker",restoreRunId:"run-1"};await mkdir(fileRoot,{mode:0o700});for(const [directoryName,archive] of [["uploads","uploads.tar.gz"],["attachments","attachments.tar.gz"],["backup_status","backup-status.tar.gz"]]){const target=path.join(fileRoot,directoryName);await mkdir(target,{mode:0o700});run("tar",["-C",target,"-xzf",path.join(built.backup,archive)]);}await writeFile(path.join(fileRoot,".chenyida-erp-restored-target-v2"),"chenyida-erp-restored-target/v2:isolated-test:marker:run-1\n",{mode:0o400});await chmod(path.join(fileRoot,".chenyida-erp-restored-target-v2"),0o400);await verifyRestoredFiles({backupDirectory:built.backup,fileRoot,...markerOptions});await writeFile(path.join(fileRoot,"uploads","uploads.txt"),"same-count-different-content");await assert.rejects(verifyRestoredFiles({backupDirectory:built.backup,fileRoot,...markerOptions}),(error)=>error.code==="RESTORED_FILE_RECONCILIATION_MISMATCH");await writeFile(path.join(fileRoot,"uploads","uploads.txt"),"uploads");await chmod(path.join(fileRoot,"uploads","uploads.txt"),0o4755);await assert.rejects(verifyRestoredFiles({backupDirectory:built.backup,fileRoot,...markerOptions}),(error)=>error.code==="FILE_UNSAFE");
}));

async function fakeBackupTools(root,migrationText){
  const bin=path.join(root,"fake-bin"),argvLog=path.join(root,"argv.log"),migrationFile=path.join(root,"migration-output.txt");await mkdir(bin);await writeFile(migrationFile,migrationText);
  await executable(path.join(bin,"df"),'#!/bin/sh\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted on\\nfixture 33554432 1024 33553408 1%% /fixture\\n"\n');
  await executable(path.join(bin,"docker"),`#!/bin/sh\nprintf '%s\\n' "$*" >> '${argvLog}'\nlast=""; for last do :; done\ncase "$1" in\n ps) case "$*" in *com.docker.compose.service=web*) printf '%s\\n' '${webContainerId}' ;; *com.docker.compose.service=worker*) printf '%s\\n' '${workerContainerId}' ;; *) exit 0 ;; esac ;;\n inspect) case "$*" in *'range .Config.Env'*) printf 'ERP_DEPLOYMENT_CLASS=uat\\n' ;; *) if [ "$last" = web-test ]; then printf '%s\\n' '${webContainerId}|false|false|0|2026-08-12T00:00:00Z|2026-08-12T00:01:00Z|${webImageDigest}|erp-uat-source|web|0.1.0-alpha.45|${gitCommit}'; else printf '%s\\n' '${workerContainerId}|false|false|0|2026-08-12T00:00:00Z|2026-08-12T00:01:00Z|${workerImageDigest}|erp-uat-source|worker|0.1.0-alpha.45|${gitCommit}'; fi ;; esac ;; *) exit 1 ;; esac\n`);
  await executable(path.join(bin,"pg_dump"),`#!/bin/sh\nprintf '%s\\n' "$*" >> '${argvLog}'\nfor value in "$@"; do case "$value" in --file=*) target=\${value#--file=} ;; esac; done\nprintf synthetic-postgresql-dump > "$target"\n`);
  await executable(path.join(bin,"pg_restore"),'#!/bin/sh\ncase "$*" in *--list*) printf "synthetic dump list\\n" ;; *) exit 1 ;; esac\n');
  await executable(path.join(bin,"psql"),`#!/bin/sh\nprintf '%s\\n' "$*" >> '${argvLog}'\ncase "$*" in\n *backup-reconciliation.sql*) printf 'LARGE_OBJECTS\\t0\\t0\\taaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n' ;;\n *pg_database_size*) printf 'source_test|${databaseSystemIdentifier}|${databaseOid}|chenyida-erp-deployment/v2:UAT:erp-uat-source|t|off|0|0|17|UTF8|C|C|libc|NONE|-1|${databaseBytes}|0\\n' ;;\n *"max(split_part"*) printf 'source_test|${databaseSystemIdentifier}|${databaseOid}|chenyida-erp-deployment/v2:UAT:erp-uat-source|1|on|0|0\\n' ;;\n *"current_setting('default_transaction_read_only')"*) printf 'source_test|${databaseSystemIdentifier}|${databaseOid}|chenyida-erp-deployment/v2:UAT:erp-uat-source|0|-1|0|off\\n' ;;\n *"checksum||'  '||version"*) cat '${migrationFile}' ;;\n *) exit 0 ;; esac\n`);
  return{argvLog,env:{...process.env,PATH:`${bin}:${process.env.PATH}`}};
}

test("backup wrapper uses a quiesced snapshot guard, runtime identity, and secret-free argv",async()=>withTemporaryRoot(async(root)=>{
  const migrations=path.join(root,"migrations");await mkdir(migrations);await writeFile(path.join(migrations,"0001_test.sql"),"select 1;\n");const migration=await migrationManifest(migrations),fake=await fakeBackupTools(root,migration.text);
  const credentialRoot=await dedicatedRoot(root,"credentials",".chenyida-erp-credential-root-v2","chenyida-erp-credential-root/v2"),serviceFile=path.join(credentialRoot,"pg_service.conf"),secret="fixture-only-secret-value",sourceMachineIdentityFile=await machineIdentityFile(root,"source-machine-id","1".repeat(32));await writeFile(serviceFile,`[backup]\nhost=127.0.0.1\ndbname=source_test\nuser=test\npassword=${secret}\n`,{mode:0o600});await chmod(serviceFile,0o600);
  const sources={};for(const name of ["uploads","attachments"]){sources[name]=path.join(root,name);await mkdir(sources[name]);await writeFile(path.join(sources[name],`${name}.txt`),name);}const backupRoot=await dedicatedRoot(root,"backup-root",".chenyida-erp-backup-root-v2","chenyida-erp-backup-root/v2"),receiptRoot=await dedicatedRoot(root,"backup-status",".chenyida-erp-receipt-root-v2","chenyida-erp-receipt-root/v2",0o2750);
  run(path.join(scripts,"backup-selfhost.sh"),["--credential-root",credentialRoot,"--db-service-file",serviceFile,"--db-service","backup","--deployment-class","UAT","--deployment-id","erp-uat-source","--expected-database","source_test","--uploads",sources.uploads,"--attachments",sources.attachments,"--backup-status",receiptRoot,"--migrations",migrations,"--backup-root",backupRoot,"--receipt-root",receiptRoot,"--receipt-reader-gid",String(process.getgid()),"--web-container","web-test","--worker-container","worker-test","--location-id","source-host","--policy-id","daily-rpo-v1","--rpo-hours","24","--machine-identity-file",sourceMachineIdentityFile,"--confirm","UAT_BACKUP_V2_AUTHORIZED"],{env:{...fake.env,NODE_ENV:"test"}});
  const argv=await readFile(fake.argvLog,"utf8");assert.equal(argv.includes(secret),false);assert.doesNotMatch(argv,/--schema=public/);assert.match(argv,/default_transaction_read_only/);assert.match(argv,/service=backup/);const receipt=JSON.parse(await readFile(path.join(receiptRoot,"latest.json"),"utf8"));assert.equal(receipt.result,"LOCAL_VERIFIED");assert.equal((await stat(path.join(receiptRoot,"latest.json"))).mode&0o777,0o640);assert.equal((await stat(path.join(receiptRoot,"latest.json"))).gid,process.getgid());const backups=(await readdir(backupRoot)).filter((name)=>name.startsWith("backup-"));assert.equal(backups.length,1);assert.equal((await stat(path.join(receiptRoot,`${backups[0]}.local.json`))).mode&0o777,0o640);const manifest=JSON.parse(await readFile(path.join(backupRoot,backups[0],"manifest.json"),"utf8"));assert.equal(manifest.consistency.database_guard,"DEFAULT_TRANSACTION_READ_ONLY_DEFENSE_IN_DEPTH");assert.equal(manifest.consistency.content_reconciliation,"BEFORE_AFTER_FULL_RELATION_CONTENT_DIGESTS");assert.equal(manifest.consistency.dump_scope,"COMPLETE_APPLICATION_DATABASE_LOGICAL_DUMP_NO_OWNER_OR_ACL");assert.equal(manifest.deployment.database_system_identifier,databaseSystemIdentifier);assert.equal(manifest.deployment.database_bytes,databaseBytes);assert.equal(manifest.application.web_image_digest,webImageDigest);assert.equal(manifest.application.worker_image_digest,workerImageDigest);assert.equal(manifest.reconciliation.contract,"chenyida-erp-backup-reconciliation/v1");
}));

test("shell contracts pin source, require a distinct marked cluster, reconcile ambiguous creation, and publish only prepared evidence",async()=>{for(const name of ["backup-selfhost.sh","restore-selfhost.sh","verify-backup-selfhost.sh","publish-restore-receipt-selfhost.sh"]){const source=await readFile(path.join(scripts,name),"utf8");assert.doesNotMatch(source,/--database-url|DATABASE_URL|--status-output|--receipt-output|--verification-level/);}const restore=await readFile(path.join(scripts,"restore-selfhost.sh"),"utf8"),publisher=await readFile(path.join(scripts,"publish-restore-receipt-selfhost.sh"),"utf8");assert.match(restore,/CREATE DATABASE %I WITH TEMPLATE template0/);assert.match(restore,/reconcile_create_result/);assert.match(restore,/DURING_DATABASE_CREATE_RESPONSE/);assert.match(restore,/expected-target-system-identifier/);assert.match(restore,/chenyida-erp-restore-cluster\/v2:TEST/);assert.match(restore,/--reflink=never/);assert.match(restore,/read-database-bytes/);assert.match(restore,/prepare-restore/);assert.match(restore,/publish-prepared-restore/);assert.doesNotMatch(restore,/finalize-restore|--reconciliation-sha256/);assert.match(publisher,/\.prepared-\$BACKUP_ID-\$RESTORE_RUN_ID\.json/);assert.match(publisher,/publish-prepared-restore/);assert.doesNotMatch(publisher,/psql|pg_restore|verify-restored-files/);});
