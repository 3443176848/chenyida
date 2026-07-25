import { sha256, stableUuid } from "./digest.mjs";
import { DOMAIN_ORDER, FIXED_ROLES, TARGET_TABLES } from "./mapping-registry.mjs";

const STATUS_ALLOWLIST = Object.freeze({
  material: new Set(["ACTIVE", "STOCKED"]), customer: new Set(["ACTIVE"]), supplier: new Set(["ACTIVE"]),
  product: new Set(["ACTIVE"]), product_version: new Set(["RELEASED"]), bom: new Set(["RELEASED"]),
  purchase_order: new Set(["OPEN", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"]),
  purchase_receipt: new Set(["POSTED"]), work_order: new Set(["RELEASED", "IN_PROGRESS", "COMPLETED", "CLOSED"]),
  sales_order: new Set(["OPEN", "PARTIALLY_SHIPPED", "SHIPPED", "CLOSED"]), shipment: new Set(["POSTED"]),
  quality_inspection: new Set(["OPEN", "DISPOSITIONED", "CLOSED"]), finance_document: new Set(["OPEN", "PARTIALLY_SETTLED", "SETTLED"]),
});

function decimalScale(value) {
  const text = String(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return Number.POSITIVE_INFINITY;
  return text.includes(".") ? text.length - text.indexOf(".") - 1 : 0;
}

function numericEntries(value, prefix = "") {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (/(?:qty|quantity|amount|price|rate|balance)$/i.test(key)) return [[path, item]];
    return item && typeof item === "object" ? numericEntries(item, path) : [];
  });
}

function issue(code, record, severity = "BLOCKER") {
  return { code, severity, source_ref: `${record.kind}:${sha256(record.stable_key).slice(0, 16)}`, domain: record.domain };
}

export function validateAndPlan(source, mappingDigest) {
  const issues = [];
  const identities = new Map();
  for (const record of source.records) {
    if (!DOMAIN_ORDER.includes(record.domain) || !record.kind || !record.stable_key || !record.data || !Array.isArray(record.relations)) {
      issues.push(issue("SOURCE_RECORD_INVALID", record));
      continue;
    }
    if (!TARGET_TABLES[record.kind]) issues.push(issue("UNMAPPED_KIND", record));
    const identity = `${record.kind}\0${record.stable_key}`;
    if (identities.has(identity)) issues.push(issue("DUPLICATE_STABLE_KEY", record));
    else identities.set(identity, record);
  }

  for (const record of source.records) {
    if (record.kind === "identity" && (!FIXED_ROLES.has(record.data.role) || record.data.username !== record.stable_key)) issues.push(issue(record.data.role && !FIXED_ROLES.has(record.data.role) ? "UNKNOWN_ROLE" : "IDENTITY_KEY_INVALID", record));
    if (record.kind === "material" && !record.relations.some((relation) => relation.kind === "unit")) issues.push(issue("MISSING_UNIT", record));
    if (record.kind === "inventory_balance" && Number(record.data.on_hand_qty) < 0) issues.push(issue("NEGATIVE_INVENTORY", record));
    if (record.kind === "inventory_balance" && Number(record.data.frozen_qty || 0) > Number(record.data.on_hand_qty)) issues.push(issue("FROZEN_EXCEEDS_ON_HAND", record));
    if (record.kind === "finance_opening") {
      const direction = String(record.data.document_type || record.data.direction || "").toUpperCase();
      const hasCustomer = record.relations.some((relation) => relation.kind === "customer"); const hasSupplier = record.relations.some((relation) => relation.kind === "supplier");
      if (!new Set(["AR", "AP"]).has(direction) || (direction === "AR" && (!hasCustomer || hasSupplier)) || (direction === "AP" && (!hasSupplier || hasCustomer))) issues.push(issue("FINANCE_OPENING_COUNTERPARTY_INVALID", record));
    }
    if (record.data.currency_code && record.data.currency_code !== "CNY") issues.push(issue("CURRENCY_MISMATCH", record));
    if (record.kind === "file" && record.data.checksum_status !== "MATCHED") issues.push(issue(record.data.checksum_status === "MISSING" ? "FILE_MISSING" : "FILE_CHECKSUM_MISMATCH", record));
    const allowed = STATUS_ALLOWLIST[record.kind];
    if (record.data.status && allowed && !allowed.has(record.data.status)) issues.push(issue("INVALID_STATUS", record));
    for (const [path, value] of numericEntries(record.data)) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || (numeric < 0 && record.kind !== "inventory_balance")) {
        issues.push(issue(/amount|price/i.test(path) ? "INVALID_AMOUNT" : "INVALID_QUANTITY", record));
        break;
      }
      if (decimalScale(value) > 6) { issues.push(issue("PRECISION_EXCEEDED", record)); break; }
    }
    const chains = [["received_qty", "order_qty"], ["completed_qty", "planned_qty"], ["shipped_qty", "order_qty"], ["settled_amount", "amount"], ["good_qty", "reported_qty"]];
    if (chains.some(([actual, maximum]) => record.data[actual] !== undefined && record.data[maximum] !== undefined && Number(record.data[actual]) > Number(record.data[maximum]))) issues.push(issue("INVALID_QUANTITY", record));
    if (record.data.customer_specific && !record.relations.some((relation) => relation.kind === "customer") && record.kind === "product") issues.push(issue("MISSING_CUSTOMER_RESTRICTION", record));
    for (const relation of record.relations) {
      if (!identities.has(`${relation.kind}\0${relation.key}`)) issues.push(issue("ORPHAN_REFERENCE", record));
    }
  }

  const ordered = [...source.records].sort((left, right) => DOMAIN_ORDER.indexOf(left.domain) - DOMAIN_ORDER.indexOf(right.domain) || left.kind.localeCompare(right.kind) || left.stable_key.localeCompare(right.stable_key));
  const issueRefs = new Set(issues.filter((item) => item.severity === "BLOCKER").map((item) => item.source_ref));
  const rows = ordered.map((record) => {
    const sourceRef = `${record.kind}:${sha256(record.stable_key).slice(0, 16)}`;
    return {
      domain: record.domain, kind: record.kind, stable_key: record.stable_key,
      source_ref: sourceRef, source_digest: sha256(record), target_table: TARGET_TABLES[record.kind] || `UNMAPPED:${record.kind}`,
      target_id: stableUuid("chenyida-selfhost-migration", `${source.kind}\0${record.kind}\0${record.stable_key}`),
      status: issueRefs.has(sourceRef) ? "BLOCKED" : "PLANNED", data: record.data, relations: record.relations,
    };
  });
  const counts = Object.fromEntries(DOMAIN_ORDER.map((domain) => [domain, rows.filter((row) => row.domain === domain).length]).filter(([, count]) => count));
  const digestRows = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "data")));
  return { schema_version: 1, mapping_digest: mappingDigest, source_snapshot_sha256: source.snapshotSha256, rows, issues, counts, runnable: issues.every((item) => item.severity !== "BLOCKER"), digest: sha256({ mappingDigest, snapshot: source.snapshotSha256, rows: digestRows, issues }) };
}

export function issueSummary(issues) {
  return issues.reduce((result, item) => ({ ...result, [item.code]: (result[item.code] || 0) + 1 }), {});
}
