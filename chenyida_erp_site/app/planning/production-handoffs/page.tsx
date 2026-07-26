"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api, ErpApiError } from "../../../public/erp/api-client.js";
import "../../procurement/sourcing/sourcing.css";

type Session = { authenticated: boolean; csrf_token?: string; user: { permissions: string[] } | null };
type Handoff = { id:number; handoff_code:string; handoff_version_no:number; project_code:string; project_name:string; status:string; version:number; item_count:number; work_order_count:number };
type Loaded = { session: Session; rows: Handoff[] };
const can = (session: Session | null, permission: string) => Boolean(session?.user && (session.user.permissions.includes("*") || session.user.permissions.includes(permission)));

export default function ProductionHandoffsPage() {
  const [session,setSession]=useState<Session|null>(null);
  const [rows,setRows]=useState<Handoff[]>([]);
  const [error,setError]=useState("");
  async function fetchData():Promise<Loaded>{const current=await api<Session>("/api/session");const handoffs=current.authenticated&&can(current,"production.handoff.read")?(await api<{data:Handoff[]}>("/api/production-handoffs?page_size=100")).data:[];return{session:current,rows:handoffs};}
  function applyData(value:Loaded){setSession(value.session);setRows(value.rows);}
  async function reload(){applyData(await fetchData());}
  useEffect(()=>{let cancelled=false;void fetchData().then(value=>{if(!cancelled)applyData(value);}).catch(e=>{if(!cancelled)setError(e instanceof ErpApiError?e.message:"读取失败");});return()=>{cancelled=true;};},[]);
  async function post(path:string,body:Record<string,unknown>){if(!session)return;setError("");try{await api(path,{method:"POST",body:JSON.stringify(body),protectedWrite:{csrfToken:session.csrf_token!,idempotencyKey:crypto.randomUUID()}});await reload();}catch(e){setError(e instanceof ErpApiError?e.message:"操作失败");}}
  async function prepare(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);await post(`/api/planning-packages/${Number(data.get("package_id"))}/production-handoffs`,{items:[{package_item_id:Number(data.get("package_item_id")),finished_material_id:Number(data.get("finished_material_id"))}]});}
  return <main className="sourcing-shell">
    <header className="sourcing-header"><div><Link href="/">← 经营工作台</Link><h1>计划到生产交接</h1><p>只消费当前 ACCEPTED Planning Package，固化产品、BOM、数量、单位与成品物料。</p></div></header>
    {can(session,"production.handoff.prepare")?<form className="sourcing-form" onSubmit={prepare}><label>Planning Package ID<input name="package_id" required/></label><label>Package Item ID<input name="package_item_id" required/></label><label>成品 Material ID<input name="finished_material_id" required/></label><button>准备生产交接</button></form>:null}
    <section className="sourcing-panel"><h2>交接版本</h2>{rows.map(row=><article className="sourcing-card" key={row.id}><b>{row.handoff_code} · v{row.handoff_version_no}</b><p>{row.project_code} · {row.project_name}</p><small>{row.status} · 行 {row.item_count} · 工单 {row.work_order_count}</small>{row.status==="DRAFT"&&can(session,"production.handoff.submit")?<button onClick={()=>post(`/api/production-handoffs/${row.id}/submit`,{expected_version:row.version})}>提交生产</button>:null}{row.status==="RETURNED"?<p>该版本已冻结，请按退回意见准备下一版本。</p>:null}</article>)}</section>
    {error?<div className="sourcing-state sourcing-error">{error}</div>:null}
  </main>;
}
