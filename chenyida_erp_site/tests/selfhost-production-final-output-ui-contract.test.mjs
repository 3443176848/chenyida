import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read=path=>readFile(new URL(path,import.meta.url),"utf8");

test("reporting page binds structured writes to stable final Run Report sources",async()=>{
  const source=await read("../app/production/reporting/page.tsx");
  assert.match(source,/\/api\/production\/final-output-sources/);
  assert.match(source,/operation_run_report_id/);
  assert.match(source,/expected_work_order_version/);
  assert.match(source,/expected_final_output_version/);
  assert.match(source,/final_output_allocations/);
  assert.match(source,/末工序稳定来源/);
  assert.match(source,/历史兼容模式/);
  const structured=source.slice(source.indexOf("async function submitStructured"),source.indexOf("async function submitLegacy"));
  for(const forged of ["reported_qty","good_qty","scrap_qty","process_stage","operator:"])assert.doesNotMatch(structured,new RegExp(forged));
});

test("WIP and warehouse pages preserve the authority boundary",async()=>{
  const wip=await read("../app/production/wip/page.tsx"),warehouse=await read("../app/warehouse/production-completions/page.tsx");
  assert.match(wip,/WIP 不是 MAIN 库存 Ledger/);
  assert.match(wip,/末工序待最终报工/);
  assert.match(warehouse,/Report→Completion Allocation/);
  assert.match(warehouse,/\/api\/production\/completions/);
  assert.doesNotMatch(warehouse,/final_output_allocations/);
});

test("server exposes a permission-protected source query and retains request protections",async()=>{
  const handler=await read("../app/lib/production-selfhost/handler.ts"),service=await read("../app/lib/production-selfhost/service.ts");
  assert.match(handler,/\/api\/production\/final-output-sources/);
  assert.match(handler,/requirePermission\(dependencies\.actor, "production\.read"\)/);
  assert.match(handler,/Idempotency-Key/);
  assert.match(handler,/requireCsrf/);
  for(const code of ["STRUCTURED_REPORT_SOURCE_REQUIRED","STRUCTURED_COMPLETION_SOURCE_REQUIRED","FINAL_OUTPUT_VERSION_CONFLICT","FINAL_OUTPUT_SOURCE_EXHAUSTED"])assert.match(service,new RegExp(code));
});
