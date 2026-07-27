import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FINISHED_GOODS_LOT_BOUNDARY } from "../app/lib/inventory-lot-selfhost/service.ts";
import { deliveryExecutionLines, expectedLotVersions } from "../app/lib/sales-selfhost/rules.ts";

test("BATCH delivery requires explicit lot and both CAS versions",()=>{
  const [line]=deliveryExecutionLines([{instruction_line_id:11,inventory_lot_id:22,quantity:"4",expected_line_version:1,expected_sales_order_line_version:2,expected_balance_version:3,expected_lot_version:4}]);
  assert.deepEqual(line,{instructionLineId:11,inventoryLotId:22,quantity:"4",expectedLineVersion:1,expectedSalesOrderLineVersion:2,expectedBalanceVersion:3,expectedLotVersion:4});
  assert.throws(()=>deliveryExecutionLines([{instruction_line_id:11,inventory_lot_id:22,quantity:"4",expected_line_version:1,expected_sales_order_line_version:2,expected_balance_version:3}]),/expected_lot_version/);
  assert.deepEqual(expectedLotVersions([{inventory_lot_id:22,expected_lot_version:5}]),[{inventoryLotId:22,expectedLotVersion:5}]);
});

test("TASK09 boundary and service contracts name exact lot consumption",async()=>{
  assert.equal(FINISHED_GOODS_LOT_BOUNDARY.shipment_lot_consumption,true);
  const sales=await readFile(new URL("../app/lib/sales-selfhost/service.ts",import.meta.url),"utf8");
  const quality=await readFile(new URL("../app/lib/quality-selfhost/service.ts",import.meta.url),"utf8");
  for(const token of ["issuePositionsInTransaction","FQC_LOT_MISMATCH","SHIPMENT_ISSUED","SHIPMENT_REVERSED","expectedLotVersions"])assert.match(sales,new RegExp(token));
  for(const token of ["inventory_lot_id","lot_code","batch_code"])assert.match(quality,new RegExp(token));
});
