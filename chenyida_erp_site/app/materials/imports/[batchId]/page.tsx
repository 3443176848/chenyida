import { MaterialImportWorkspace } from "../../_components/material-import-workspace";

export default async function MaterialImportWorkspaceRoute({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params; const parsed = Number(batchId);
  return <MaterialImportWorkspace batchId={Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0} />;
}
