import { MaterialDraftPage } from "../../_components/material-draft-page";

export default async function EditMaterialDraftPage({ params }: { params: Promise<{ materialId: string }> }) {
  const { materialId } = await params;
  return <MaterialDraftPage mode="edit" materialId={Number(materialId)} />;
}
