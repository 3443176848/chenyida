"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ErpApiError } from "../../../public/erp/api-client.js";
import { statusLabel } from "../../../public/erp/status-localization.js";
import "../../procurement/sourcing/sourcing.css";

type Session={authenticated:boolean;csrf_token?:string;user:{permissions:string[]}|null};
type Handoff={id:number;handoff_code:string;status:string;version:number;item_count:number};
type Item={id:number;product_name:string;planned_quantity:string;work_order_id?:number};
type Order={id:number;work_order_code:string;product_name:string;status:string;version:number;planned_qty:string;issued_supported_qty:string;reported_qty:string;good_qty:string;scrap_qty:string;completed_qty:string;waiting_receipt_qty:string};
type Loaded={session:Session;handoffs:Handoff[];items:Record<number,Item[]>;orders:Order[]};
const can=(session:Session|null,permission:string)=>Boolean(session?.user&&(session.user.permissions.includes("*")||session.user.permissions.includes(permission)));

export default function WorkOrdersPage(){
  const[session,setSession]=useState<Session|null>(null),[handoffs,setHandoffs]=useState<Handoff[]>([]),[items,setItems]=useState<Record<number,Item[]>>({}),[orders,setOrders]=useState<Order[]>([]),[error,setError]=useState("");
  async function fetchData():Promise<Loaded>{const current=await api<Session>("/api/session");if(!current.authenticated)return{session:current,handoffs:[],items:{},orders:[]};const queue=can(current,"production.handoff.read")?(await api<{data:Handoff[]}>("/api/production-handoffs?page_size=100")).data:[];const accepted=queue.filter(h=>h.status==="ACCEPTED");const detail=await Promise.all(accepted.map(async h=>[h.id,(await api<{data:{items:Item[]}}>(`/api/production-handoffs/${h.id}`)).data.items] as const));const workOrders=can(current,"production.read")?(await api<{data:Order[]}>("/api/work-orders?page_size=100")).data:[];return{session:current,handoffs:queue,items:Object.fromEntries(detail),orders:workOrders};}
  function applyData(value:Loaded){setSession(value.session);setHandoffs(value.handoffs);setItems(value.items);setOrders(value.orders);}
  async function reload(){applyData(await fetchData());}
  useEffect(()=>{let cancelled=false;void fetchData().then(value=>{if(!cancelled)applyData(value);}).catch(e=>{if(!cancelled)setError(e instanceof ErpApiError?e.message:"读取失败");});return()=>{cancelled=true;};},[]);
  async function post(path:string,body:Record<string,unknown>){if(!session)return;setError("");try{await api(path,{method:"POST",body:JSON.stringify(body),protectedWrite:{csrfToken:session.csrf_token!,idempotencyKey:crypto.randomUUID()}});await reload();}catch(e){setError(e instanceof ErpApiError?e.message:"操作失败");}}
  return <main className="sourcing-shell"><header className="sourcing-header"><div><Link href="/">← 经营工作台</Link><h1>生产工单与齐套释放</h1><p>生产接收交接后创建唯一草稿工单；显式释放时复制 BOM、生成需求并原子预留库存。</p><nav><Link href="/production/reporting">生产报工</Link> · <Link href="/warehouse/production-completions">完工入库</Link></nav></div></header>
    <section className="sourcing-panel"><h2>生产交接</h2>{handoffs.map(h=><article className="sourcing-card" key={h.id}><b>{h.handoff_code}</b><small>{statusLabel(h.status)} · {h.item_count} 行</small>{h.status==="SUBMITTED"&&can(session,"production.handoff.decide")?<div><button onClick={()=>post(`/api/production-handoffs/${h.id}/accept`,{expected_version:h.version})}>接收</button><button onClick={()=>post(`/api/production-handoffs/${h.id}/return`,{expected_version:h.version,reason:"生产资料需修订"})}>退回</button></div>:null}{h.status==="ACCEPTED"&&can(session,"production.handoff.work_order")?items[h.id]?.filter(i=>!i.work_order_id).map(item=><button key={item.id} onClick={()=>post(`/api/production-handoff-items/${item.id}/work-order`,{})}>创建 {item.product_name} 工单（{item.planned_quantity}）</button>):null}</article>)}</section>
    <section className="sourcing-panel"><h2>工单</h2>{orders.map(order=><article className="sourcing-card" key={order.id}><b>{order.work_order_code} · {order.product_name}</b><small>{statusLabel(order.status)} · 计划 {order.planned_qty} · 已领料支持 {order.issued_supported_qty} · 已报工 {order.reported_qty} · 良品 {order.good_qty} · 报废 {order.scrap_qty} · 已完成 {order.completed_qty} · 待入库 {order.waiting_receipt_qty}</small>{order.status==="DRAFT"&&can(session,"production.plan")?<button onClick={()=>post(`/api/work-orders/${order.id}/release`,{expected_version:order.version})}>齐套校验并释放</button>:null}</article>)}</section>
    {error?<div className="sourcing-state sourcing-error">{error}</div>:null}</main>;
}
