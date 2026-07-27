import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read=path=>readFile(new URL(path,import.meta.url),"utf8");

test("quality NCR page exposes inherited facts, conservation and stable target operations",async()=>{const source=await read("../app/quality/nonconformances/page.tsx");for(const token of ["ncr_code","work_order_code","run_report_code","work_center_code","inspected_qty","passed_qty","failed_qty","active_rework_qty","final_scrap_qty","unresolved_qty","target_snapshot_operation_id","Snapshot Operation","不可逆 SCRAP"])assert.match(source,new RegExp(token));const mutations=source.slice(source.indexOf("async function draft"),source.indexOf("if(forbidden)"));for(const forged of ["material_id:","work_order_id:","failed_qty:","unresolved_qty:"])assert.doesNotMatch(mutations,new RegExp(forged));});

test("quality request page shows CAS, immutable digest and revision state",async()=>{const source=await read("../app/quality/rework-requests/page.tsx");for(const token of ["expected_version","canonical_digest","DRAFT","SUBMITTED","RETURNED","CAS","digest","target_snapshot_operation_id"])assert.match(source,new RegExp(token));});

test("production page only accepts or returns and explicitly defers execution",async()=>{const source=await read("../app/production/rework-requests/page.tsx");for(const token of ["production.rework_request.decide","accept","return","ACCEPTED","不创建返工 Run","派工","WIP","领料","库存事实"])assert.match(source,new RegExp(token));assert.doesNotMatch(source,/\/operation-execution\/dispatch|\/operation-runs\/.+\/start|\/operation-runs\/.+\/reports/);});

test("dashboard labels all five read-only NCR handoff indicators",async()=>{const[source,repository]=await Promise.all([read("../app/lib/dashboard-selfhost/service.ts"),read("../app/lib/dashboard-selfhost/repository.ts")]);for(const token of ["待处置 NCR","未分配不合格数量","待生产接收返工申请","已接收待执行返工数量","工序不合格报废事实","不是仓库库存报废"])assert.match(source,new RegExp(token));for(const token of ["pending_nonconformance_count","unresolved_nonconformance_qty","pending_rework_accept_count","accepted_rework_waiting_execution_qty","final_operation_scrap_qty","REPEATABLE READ READ ONLY"])assert.match(repository,new RegExp(token));});
