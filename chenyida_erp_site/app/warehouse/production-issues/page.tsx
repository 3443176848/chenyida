"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api, ErpApiError } from "../../../public/erp/api-client.js";
import "../../procurement/sourcing/sourcing.css";

type Session={authenticated:boolean;csrf_token?:string;user:{permissions:string[]}|null};
type Requirement={id:number;work_order_id:number;work_order_code:string;internal_material_code:string;required_qty:string;net_issued_qty:string;remaining_qty:string;uom:string;version:number;balance_version:number};
type Loaded={session:Session;rows:Requirement[]};
const can=(session:Session|null,permission:string)=>Boolean(session?.user&&(session.user.permissions.includes("*")||session.user.permissions.includes(permission)));

export default function ProductionIssuesPage(){
  const[session,setSession]=useState<Session|null>(null),[rows,setRows]=useState<Requirement[]>([]),[error,setError]=useState("");
  async function fetchData():Promise<Loaded>{const current=await api<Session>("/api/session");const requirements=current.authenticated&&can(current,"production.read")?(await api<{data:Requirement[]}>("/api/production/material-requirements?page_size=100")).data:[];return{session:current,rows:requirements};}
  function applyData(value:Loaded){setSession(value.session);setRows(value.rows);}
  async function reload(){applyData(await fetchData());}
  useEffect(()=>{let cancelled=false;void fetchData().then(value=>{if(!cancelled)applyData(value);}).catch(e=>{if(!cancelled)setError(e instanceof ErpApiError?e.message:"读取失败");});return()=>{cancelled=true;};},[]);
  async function issue(event:FormEvent<HTMLFormElement>,requirement:Requirement){event.preventDefault();if(!session)return;const form=new FormData(event.currentTarget);setError("");try{await api("/api/production/material-issues",{method:"POST",body:JSON.stringify({work_order_id:requirement.work_order_id,reason:"仓库按生产预留分批领料",lines:[{requirement_id:requirement.id,quantity:String(form.get("quantity")),expected_requirement_version:requirement.version,expected_balance_version:requirement.balance_version}]}),protectedWrite:{csrfToken:session.csrf_token!,idempotencyKey:crypto.randomUUID()}});await reload();}catch(cause){setError(cause instanceof ErpApiError?cause.message:"领料失败");}}
  return <main className="sourcing-shell"><header className="sourcing-header"><div><Link href="/">← 经营工作台</Link><h1>生产待领料与分批过账</h1><p>仓库只能消费已释放或进行中工单的有效预留，禁止超需求、超预留和超库存。</p></div></header><section className="sourcing-panel">{rows.map(requirement=><article className="sourcing-card" key={requirement.id}><b>{requirement.work_order_code} · {requirement.internal_material_code}</b><small>需求 {requirement.required_qty} · 净领 {requirement.net_issued_qty} · 剩余 {requirement.remaining_qty} {requirement.uom}</small>{can(session,"production.issue")&&Number(requirement.remaining_qty)>0?<form className="sourcing-form" onSubmit={event=>issue(event,requirement)}><label>本次领料<input name="quantity" required defaultValue={requirement.remaining_qty}/></label><button>确认分批领料</button></form>:null}</article>)}</section>{error?<div className="sourcing-state sourcing-error">{error}</div>:null}</main>;
}
