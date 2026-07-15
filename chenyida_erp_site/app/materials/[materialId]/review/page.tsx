import { MaterialReviewWorkspace } from "../../_components/material-review-workspace";

export default async function MaterialReviewWorkspacePage({ params }: { params: Promise<{ materialId: string }> }) {
  const { materialId } = await params;
  return <MaterialReviewWorkspace materialId={Number(materialId)} />;
}
