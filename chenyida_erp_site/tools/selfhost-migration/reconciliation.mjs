function decimal(value) { return Number.parseFloat(String(value || "0")); }

export function aggregateSource(records) {
  const domainCounts = {};
  let inventoryQty = 0;
  let financeAmount = 0;
  let fileCount = 0;
  let fileBytes = 0;
  for (const record of records) {
    domainCounts[record.domain] = (domainCounts[record.domain] || 0) + 1;
    if (record.kind === "inventory_balance") inventoryQty += decimal(record.data.on_hand_qty);
    if (record.kind === "finance_document") financeAmount += decimal(record.data.amount);
    if (record.kind === "file") { fileCount += 1; fileBytes += Number(record.data.bytes || 0); }
  }
  return { domain_counts: domainCounts, inventory_qty: inventoryQty.toFixed(6), finance_amount: financeAmount.toFixed(6), file_count: fileCount, file_bytes: fileBytes };
}

export function reconcile(sourceAggregate, targetAggregate, issueCount = 0) {
  const mismatches = [];
  for (const [domain, count] of Object.entries(sourceAggregate.domain_counts)) if (targetAggregate.domain_counts[domain] !== count) mismatches.push("DOMAIN_COUNT_MISMATCH");
  if (decimal(sourceAggregate.inventory_qty) !== decimal(targetAggregate.inventory_qty)) mismatches.push("INVENTORY_TOTAL_MISMATCH");
  if (decimal(sourceAggregate.finance_amount) !== decimal(targetAggregate.finance_amount)) mismatches.push("FINANCE_TOTAL_MISMATCH");
  if (targetAggregate.orphan_count !== 0) mismatches.push("TARGET_ORPHAN_FOUND");
  return { grade: mismatches.length ? "FAILED" : issueCount ? "PASS_WITH_REVIEW" : "PASS", mismatches, source: sourceAggregate, target: targetAggregate };
}
