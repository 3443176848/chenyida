import { ProcurementSourcingDetailWorkspace } from "../sourcing-workspace";
export default async function Page({params}:{params:Promise<{rfqId:string}>}){return <ProcurementSourcingDetailWorkspace rfqId={Number((await params).rfqId)}/>}
