import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read=path=>readFile(new URL(path,import.meta.url),"utf8");

test("production pages distinguish NORMAL, REWORK and net output",async()=>{const pages=await Promise.all(["rework-requests","dispatch","operations","wip"].map(name=>read(`../app/production/${name}/page.tsx`)));for(const token of ["NORMAL","REWORK","原不合格","待复检","已放行","不增加工单净产量","不得与原不合格数量重复计算"])assert.ok(pages.some(source=>source.includes(token)),token);const form=pages[0].slice(pages[0].indexOf("async function dispatch"),pages[0].indexOf("return <main"));for(const forged of ["work_order_id:","target_snapshot_operation_id:","nonconformance_id:","source_operation_run_report_id:"])assert.doesNotMatch(form,new RegExp(forged));});

test("quality pages show explicit reinspection lineage and no recursive automation",async()=>{const[quality,ncr]=await Promise.all([read("../app/quality/production/page.tsx"),read("../app/quality/nonconformances/page.tsx")]);for(const token of ["正常生产 / 返工","NCR #","返工申请 #","显式创建 IPQC","statusPairLabel"])assert.ok(quality.includes(token)||ncr.includes(token),token);assert.match(ncr,/不自动递归返工/);});

test("dashboard exposes five permission-trimmed read-only rework indicators",async()=>{const source=await read("../app/lib/dashboard-selfhost/service.ts");for(const token of ["accepted-rework-waiting-dispatch","rework-in-progress","rework-pending-reinspection","rework-reinspection-failed","rework-completed","production.rework_request.read"])assert.match(source,new RegExp(token));assert.doesNotMatch(source,/dispatchRework|quality_inspections\([^)]*insert/i);});
