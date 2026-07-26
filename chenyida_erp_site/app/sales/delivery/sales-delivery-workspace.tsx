"use client";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, ErpApiError } from "../../../public/erp/api-client.js";
import "../../procurement/sourcing/sourcing.css";

type User={username:string;display_name:string;role:string;permissions:string[]};
type Session={authenticated:boolean;user:User|null;csrf_token?:string};
type Order={id:number;sales_order_code:string;sales_status:string;version:number;sales_order_line_id:number;customer_name:string};
type Delivery={id:number;delivery_code:string;sales_order_code:string;customer_name:string;status:string;version:number;total_qty:string;executed_qty:string;remaining_qty:string};
const can=(user:User|null|undefined,permission:string)=>Boolean(user&&(user.permissions.includes("*")||user.permissions.includes(permission)));
const message=(error:unknown)=>error instanceof ErpApiError?`${error.message}${error.requestId?`（请求 ${error.requestId}）`:""}`:"系统暂时无法完成请求";

export function SalesDeliveryWorkspace(){
 const[session,setSession]=useState<Session|null>(null),[orders,setOrders]=useState<Order[]>([]),[rows,setRows]=useState<Delivery[]>([]),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{try{const current=await api<Session>("/api/session");setSession(current);if(current.authenticated&&can(current.user,"sales.delivery.read")){const[list,orderList]=await Promise.all([api<{data:Delivery[]}>("/api/delivery-instructions?page_size=100"),api<{data:Order[]}>("/api/sales-orders?page_size=100")]);setRows(list.data);setOrders(orderList.data.filter(row=>["OPEN","PARTIALLY_SHIPPED"].includes(row.sales_status)))}}catch(cause){setError(message(cause))}},[]);
 useEffect(()=>{const timer=setTimeout(()=>void load(),0);return()=>clearTimeout(timer)},[load]);
 async function create(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!session)return;const form=new FormData(event.currentTarget),order=orders.find(row=>row.id===Number(form.get("sales_order_id")));if(!order)return;setBusy(true);setError("");try{const availability=await api<{data:Array<{id:number;version:number}>}>(`/api/sales-orders/${order.id}/available-to-ship`),line=availability.data.find(item=>item.id===order.sales_order_line_id);if(!line)throw new Error("sales order line missing");await api("/api/delivery-instructions",{method:"POST",body:JSON.stringify({sales_order_id:order.id,expected_order_version:order.version,receiver:String(form.get("receiver")),shipping_address:String(form.get("shipping_address")),contact_info:String(form.get("contact_info")||""),lines:[{sales_order_line_id:line.id,quantity:String(form.get("quantity")),expected_line_version:line.version}]}),protectedWrite:{csrfToken:session.csrf_token!,idempotencyKey:crypto.randomUUID()}});setNotice("发货指令已创建；库存、FQC、Shipment、金额来源和 AR 均未变化");await load()}catch(cause){setError(message(cause))}finally{setBusy(false)}}
 async function transition(row:Delivery,verb:"submit"|"cancel"){if(!session)return;setBusy(true);setError("");try{await api(`/api/delivery-instructions/${row.id}/${verb}`,{method:"POST",body:JSON.stringify({expected_version:row.version,reason:verb==="cancel"?"销售受控取消未执行指令":""}),protectedWrite:{csrfToken:session.csrf_token!,idempotencyKey:crypto.randomUUID()}});await load()}catch(cause){setError(message(cause))}finally{setBusy(false)}}
 if(!session)return <main className="sourcing-shell">正在读取会话…</main>;
 if(!session.authenticated)return <main className="sourcing-shell">请先登录。</main>;
 if(!can(session.user,"sales.delivery.read"))return <main className="sourcing-shell"><div className="sourcing-state sourcing-error">没有发货指令读取权限。</div></main>;
 return <main className="sourcing-shell">
  <div className="sourcing-banner">指令只占用可发额度 · 不扣库存、不消费 FQC、不创建 Shipment 或应收</div>
  <header className="sourcing-header"><div><Link href="/" className="sourcing-back">← 经营工作台</Link><p className="sourcing-kicker">SALES DELIVERY INSTRUCTION</p><h1>销售发货指令</h1><p>来源仅限开放销售订单；服务端校验订单余量与未占用 FQC 额度。</p></div></header>
  {can(session.user,"sales.delivery.create")&&<section className="sourcing-panel"><h2>创建发货指令</h2><form className="sourcing-form" onSubmit={create}><label>销售订单<select name="sales_order_id" required>{orders.map(row=><option key={row.id} value={row.id}>{row.sales_order_code} · {row.customer_name}</option>)}</select></label><label>指令数量<input name="quantity" required defaultValue="10"/></label><label>收货人<input name="receiver" required maxLength={1000}/></label><label>收货地址<input name="shipping_address" required maxLength={2000}/></label><label>联系方式<input name="contact_info" maxLength={1000}/></label><button disabled={busy||!orders.length}>创建</button></form></section>}
  <section className="sourcing-panel"><h2>发货指令</h2>{rows.map(row=><article className="sourcing-card" key={row.id}><div><b>{row.delivery_code} · {row.sales_order_code}</b><span className="sourcing-status status-pending">{row.status}</span></div><p>{row.customer_name} · 指令 {row.total_qty} · 已执行 {row.executed_qty} · 待执行 {row.remaining_qty}</p>{row.status==="DRAFT"&&can(session.user,"sales.delivery.submit")&&<button disabled={busy} onClick={()=>void transition(row,"submit")}>提交仓库</button>}{["DRAFT","RETURNED","SUBMITTED"].includes(row.status)&&can(session.user,"sales.delivery.cancel")&&<button disabled={busy} onClick={()=>void transition(row,"cancel")}>受控取消</button>}</article>)}{!rows.length&&<div className="sourcing-state">尚无发货指令。</div>}</section>
  {notice&&<div className="sourcing-state">{notice}</div>}{error&&<div className="sourcing-state sourcing-error">{error}</div>}
 </main>;
}
