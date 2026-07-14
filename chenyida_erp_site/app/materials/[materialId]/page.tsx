import { MaterialDetailWorkspace } from "../_components/material-detail-workspace";

export default async function MaterialDetailPage({ params }: { params: Promise<{ materialId: string }> }) {
  const { materialId } = await params;
  return <MaterialDetailWorkspace materialId={Number(materialId)} view="detail" />;
}
