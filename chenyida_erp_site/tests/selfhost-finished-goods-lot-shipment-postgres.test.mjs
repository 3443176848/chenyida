import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";

const url=process.env.TEST_FINISHED_GOODS_LOT_SHIPMENT_DATABASE_URL;
if(!url||!/finished_goods_lot_shipment_test/i.test(url))throw new Error("isolated TEST_FINISHED_GOODS_LOT_SHIPMENT_DATABASE_URL containing finished_goods_lot_shipment_test is required");
const pool=new Pool({connectionString:url,max:2,application_name:"task09-lot-shipment-postgres-test"});
test.after(()=>pool.end());

test("0033 installs four stable nullable lot relationships and reconciliation guards",async()=>{
  const columns=(await pool.query("select table_name,is_nullable from information_schema.columns where column_name='inventory_lot_id' and table_name=any($1::text[]) order by table_name",[["finished_goods_sales_allocations","quality_inspections","sales_shipment_lines","sales_shipment_line_fqc_allocations"]])).rows;
  assert.deepEqual(columns.map(row=>[row.table_name,row.is_nullable]),[["finished_goods_sales_allocations","YES"],["quality_inspections","YES"],["sales_shipment_line_fqc_allocations","YES"],["sales_shipment_lines","YES"]]);
  const triggers=(await pool.query("select tgname from pg_trigger where not tgisinternal and tgname=any($1::text[]) order by tgname",[["finished_goods_sales_allocations_lot_guard","quality_inspections_fqc_lot_guard","sales_shipment_lines_lot_guard","sales_shipment_line_fqc_allocations_lot_guard","sales_shipment_lines_lot_reconcile","sales_shipment_fqc_lot_reconcile"]])).rows.map(row=>row.tgname);
  assert.equal(triggers.length,6);
  assert.doesNotReject(()=>pool.query("select cyd_validate_shipment_line_lot(9223372036854775807)"));
});

test("lot event constraint names shipment and reversal facts",async()=>{
  const definition=(await pool.query("select pg_get_constraintdef(oid) definition from pg_constraint where conname='inventory_lot_events_type_ck'")).rows[0]?.definition||"";
  assert.match(definition,/SHIPMENT_ISSUED/);assert.match(definition,/SHIPMENT_REVERSED/);
});
