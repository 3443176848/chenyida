import assert from "node:assert/strict";
import test from "node:test";

import { DashboardService } from "../app/lib/dashboard-selfhost/service.ts";
import { permissionsForRole } from "../app/lib/identity-selfhost/permissions.ts";

const actor = (role) => ({ username: `${role}01`, role, permissions: permissionsForRole(role) });
const snapshot = {
  pending_material_reviews: 4,
  open_quality_exceptions: 0,
  shortage_requirement_count: 0,
  failed_jobs: 0,
  open_purchase_orders: 0,
  finance_by_currency: [],
  inventory_quantities: [],
  migrations: [],
  recent_events: [],
  recent_audits: [],
  generated_at: "2026-07-30T00:00:00.000Z",
};

test("operations material review metric is permission-bound and suppresses the empty todo claim", async () => {
  const service = new DashboardService({ readSnapshot: async () => structuredClone(snapshot) }, "/missing");
  const operations = await service.management(actor("operations"));
  assert.deepEqual(operations.metrics.find((item) => item.code === "material-review-pending"), {
    code: "material-review-pending",
    label: "物料审核待办",
    value: 4,
    hint: "仅 PENDING_REVIEW；与原生审核队列同口径",
    tone: "warning",
    href: "/materials/review",
  });
  assert.ok(operations.risks.some((item) => item.code === "MATERIAL_REVIEW_PENDING" && item.text === "4 项物料待审核"));
  assert.ok(!operations.risks.some((item) => item.code === "NO_VISIBLE_RISK"));

  const withoutReviewQueue = await service.management({
    username: "restricted01", role: "operations", permissions: ["dashboard.read", "dashboard.management.read", "material.read"],
  });
  assert.ok(!withoutReviewQueue.metrics.some((item) => item.code === "material-review-pending"));
  assert.ok(!withoutReviewQueue.risks.some((item) => item.code === "MATERIAL_REVIEW_PENDING"));
});
