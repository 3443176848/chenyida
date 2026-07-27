import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read=path=>readFile(new URL(path,import.meta.url),"utf8");

test("routing editor exposes only the controlled DRAFT quality gate field",async()=>{
  const source=await read("../app/engineering/routings/page.tsx");
  assert.match(source,/quality_gate_mode/);assert.match(source,/IPQC（受控放行）/);assert.match(source,/detail\.header\.status !== "DRAFT"/);assert.match(source,/production\.routing\.manage/);
  assert.doesNotMatch(source,/production_operation_run_report_id/);
});

test("production pages expose the immutable snapshot gate and WIP quality projection",async()=>{
  for(const path of ["../app/production/dispatch/page.tsx","../app/production/operations/page.tsx","../app/production/wip/page.tsx"]){const source=await read(path);for(const token of ["quality_gate_mode","quality_required_qty","quality_inspected_qty","quality_released_qty","quality_hold_qty"])assert.match(source,new RegExp(token),path);assert.match(source,/Snapshot Operation/);assert.match(source,/Work Center/);}
  const dispatch=await read("../app/production/dispatch/page.tsx");assert.match(dispatch,/Quality Hold 尚未形成可消费放行额度/);
});

test("quality page explicitly creates IPQC from a stable operation Run Report",async()=>{
  const source=await read("../app/quality/production/page.tsx"),handler=await read("../app/lib/quality-selfhost/handler.ts");
  for(const token of ["operation_run_report_id","OPERATION_RUN_REPORT","LEGACY_PRODUCTION_REPORT","稳定来源","显式创建"])assert.match(source,new RegExp(token));
  const create=source.slice(source.indexOf("async function inspect"),source.indexOf("async function mutate"));
  for(const forged of ["material_id","unit_id","work_center_id","snapshot_operation_id","source_qty"])assert.doesNotMatch(create,new RegExp(`${forged}=`));
  assert.match(handler,/Idempotency-Key/);assert.match(handler,/requireCsrf/);assert.match(handler,/256 \* 1024/);
});

test("dashboard metrics are read-only and role-trimmed",async()=>{
  const service=await read("../app/lib/dashboard-selfhost/service.ts"),repository=await read("../app/lib/dashboard-selfhost/repository.ts");
  for(const token of ["待 IPQC 来源","IPQC 检验中","工序 Quality Hold","已放行待下工序","已放行待最终报工"])assert.match(service,new RegExp(token));
  assert.match(service,/hasPermission\(actor,"production\.read"\)\|\|hasPermission\(actor,"quality\.read"\)/);
  assert.match(repository,/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.doesNotMatch(service,/createInspection|quality\.inspect/);
});
