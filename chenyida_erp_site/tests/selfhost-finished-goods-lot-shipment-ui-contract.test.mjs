import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read=path=>readFile(new URL(path,import.meta.url),"utf8");

test("native quality allocation and warehouse pages expose lot identity and capacity",async()=>{
  const [quality,allocation,shipping,lots]=await Promise.all([read("../app/quality/production/page.tsx"),read("../app/sales/finished-goods-allocation/page.tsx"),read("../app/warehouse/shipping/warehouse-shipping-workspace.tsx"),read("../app/warehouse/inventory-lots/page.tsx")]);
  for(const source of [quality,allocation,shipping])for(const token of ["lot_code","batch_code"])assert.match(source,new RegExp(token));
  for(const token of ["inventory_lot_id","expected_lot_version","fqc_available_qty","按所选 Lot 原子过账"])assert.match(shipping,new RegExp(token));
  assert.match(lots,/\/api\/inventory\/lots\/\$\{lot\.id\}/);
});

test("FQC browser does not accept a caller supplied final lot identity",async()=>{
  const quality=await read("../app/quality/production/page.tsx");
  assert.doesNotMatch(quality,/body\.inventory_lot_id\s*=/);
});
