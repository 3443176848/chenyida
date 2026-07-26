import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { IdentityActor } from "../identity-selfhost/types.ts";
import { ProductionError, mapProductionError } from "../production-selfhost/errors.ts";
import { ProductionRepository } from "../production-selfhost/repository.ts";
import { ProductionHandoffService } from "./service.ts";

type Dependencies=Readonly<{pool:Pool;actor:IdentityActor;requestId:string;requireCsrf:()=>void}>;
const can=(actor:IdentityActor,permission:string)=>actor.permissions.includes("*")||actor.permissions.includes(permission);
const need=(actor:IdentityActor,permission:string)=>{if(!can(actor,permission))throw new ProductionError("PERMISSION_DENIED","没有权限执行此操作",403);};
const response=(body:unknown,status:number,requestId:string,replay=false)=>{const headers=new Headers({"Cache-Control":"no-store","X-Request-ID":requestId});if(replay)headers.set("Idempotency-Replayed","true");return Response.json(body,{status,headers});};
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
const forbid=(value:Record<string,unknown>,fields:string[])=>{for(const field of fields)if(Object.prototype.hasOwnProperty.call(value,field))throw new ProductionError("SERVER_MANAGED_FIELD_FORBIDDEN",`${field} 由服务端从计划交接来源确定`,422);};

async function parseBody(request:Request){const raw=await request.text();if(!raw||Buffer.byteLength(raw)>65536)throw new ProductionError("REQUEST_VALIDATION_FAILED","请求正文为空或过大");let value:unknown;try{value=JSON.parse(raw);}catch{throw new ProductionError("REQUEST_VALIDATION_FAILED","请求正文不是有效 JSON");}if(!value||typeof value!=="object"||Array.isArray(value))throw new ProductionError("REQUEST_VALIDATION_FAILED","请求正文必须是对象");return{value:value as Record<string,unknown>,digest:createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")};}
function meta(request:Request,dependencies:Dependencies,action:string,requestDigest:string){const key=request.headers.get("idempotency-key")||"";if(key.length<8||key.length>200)throw new ProductionError("IDEMPOTENCY_KEY_REQUIRED","写操作必须提供有效 Idempotency-Key");const route=new URL(request.url).pathname;return{actor:dependencies.actor,requestId:dependencies.requestId,operationId:randomUUID(),keyDigest:createHash("sha256").update(`${dependencies.actor.username}:${request.method}:${route}:${key}`).digest("hex"),requestDigest,method:request.method,route,action};}

export async function handleProductionHandoffApi(request:Request,dependencies:Dependencies):Promise<Response|null>{
  const url=new URL(request.url),path=url.pathname;
  const prepare=path.match(/^\/api\/planning-packages\/([1-9]\d*)\/production-handoffs$/);
  const detail=path.match(/^\/api\/production-handoffs\/([1-9]\d*)$/);
  const transition=path.match(/^\/api\/production-handoffs\/([1-9]\d*)\/(submit|accept|return)$/);
  const workOrder=path.match(/^\/api\/production-handoff-items\/([1-9]\d*)\/work-order$/);
  if(!prepare&&!detail&&!transition&&!workOrder&&path!=="/api/production-handoffs")return null;
  const repository=new ProductionRepository(dependencies.pool),service=new ProductionHandoffService(repository);let action="PRODUCTION_HANDOFF_REQUEST";
  try{
    if(request.method==="GET"){
      need(dependencies.actor,"production.handoff.read");
      if(detail)return response({data:await service.detail(Number(detail[1])),request_id:dependencies.requestId},200,dependencies.requestId);
      const rawPage=Number(url.searchParams.get("page")||1),rawSize=Number(url.searchParams.get("page_size")||20);
      const page=Number.isInteger(rawPage)&&rawPage>0?rawPage:1,size=Number.isInteger(rawSize)?Math.min(100,Math.max(1,rawSize)):20;
      const result=await service.queue(size,(page-1)*size,url.searchParams.get("status")||undefined);
      return response({data:result.rows,rows:result.rows,pagination:{page,page_size:size},request_id:dependencies.requestId},200,dependencies.requestId);
    }
    if(request.method!=="POST")throw new ProductionError("METHOD_NOT_ALLOWED","接口不支持该请求方法",405);
    dependencies.requireCsrf();const body=await parseBody(request);let result;
    if(prepare){action="PRODUCTION_HANDOFF_PREPARED";need(dependencies.actor,"production.handoff.prepare");forbid(body.value,["product_id","product_version_id","bom_version_id","planned_quantity","finished_unit_id","source_digest"]);result=await service.prepare(Number(prepare[1]),meta(request,dependencies,action,body.digest),body.value);}
    else if(transition){action=`PRODUCTION_HANDOFF_${transition[2].toUpperCase()}`;need(dependencies.actor,transition[2]==="submit"?"production.handoff.submit":"production.handoff.decide");result=await service.transition(Number(transition[1]),transition[2] as "submit"|"accept"|"return",meta(request,dependencies,action,body.digest),body.value);}
    else if(workOrder){action="PRODUCTION_HANDOFF_WORK_ORDER_CREATED";need(dependencies.actor,"production.handoff.work_order");forbid(body.value,["product_id","product_version_id","bom_version_id","finished_material_id","finished_unit_id","planned_qty"]);result=await service.createWorkOrder(Number(workOrder[1]),meta(request,dependencies,action,body.digest),body.value);}
    else throw new ProductionError("NOT_FOUND","接口不存在",404);
    return response(result.body,result.status,dependencies.requestId,result.replayed);
  }catch(error){const mapped=mapProductionError(error);await repository.failureAudit(dependencies.actor.username,dependencies.requestId,action,mapped.code);return response({error:{code:mapped.code,message:mapped.message,details:mapped.details,request_id:dependencies.requestId},code:mapped.code,message:mapped.message,details:mapped.details,request_id:dependencies.requestId},mapped.status,dependencies.requestId);}
}
