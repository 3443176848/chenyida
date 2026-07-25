import { EngineeringPlanningWorkspace } from "../../../../planning/planning-workspace";

export default async function EngineeringProjectPlanningPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const parsed = Number(projectId);
  return <EngineeringPlanningWorkspace projectId={Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0} />;
}
