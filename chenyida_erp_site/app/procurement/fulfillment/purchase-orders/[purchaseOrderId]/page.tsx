import { PurchaseOrderHistoryWorkspace } from "../../purchase-order-history-workspace";

export default async function Page({ params }: { params: Promise<{ purchaseOrderId: string }> }) {
  return <PurchaseOrderHistoryWorkspace purchaseOrderId={Number((await params).purchaseOrderId)}/>;
}
