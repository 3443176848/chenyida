import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const rel = (kind, key, name = kind) => ({ kind, key, name });
const record = (domain, kind, stable_key, data, relations = []) => ({ domain, kind, stable_key, data, relations });

export function validSyntheticRecords() {
  return [
    record("identity", "identity", "synthetic_admin", { username: "synthetic_admin", role: "admin", status: "DISABLED", must_change_password: true }),
    record("reference", "unit", "PCS", { code: "PCS", status: "ACTIVE" }),
    record("reference", "category", "SYN-CAT-L4", { code: "SYN-CAT-L4", level: 4, status: "ACTIVE" }),
    record("material", "material", "SYN-MAT-001", { code: "SYN-MAT-001", name: "Synthetic Component Alpha", status: "ACTIVE" }, [rel("unit", "PCS"), rel("category", "SYN-CAT-L4")]),
    record("material", "material", "SYN-FG-001", { code: "SYN-FG-001", name: "Synthetic Finished Assembly", status: "ACTIVE" }, [rel("unit", "PCS"), rel("category", "SYN-CAT-L4")]),
    record("party", "customer", "SYN-CUS-001", { code: "SYN-CUS-001", name: "Synthetic Customer Alpha", status: "ACTIVE" }),
    record("party", "supplier", "SYN-SUP-001", { code: "SYN-SUP-001", name: "Synthetic Supplier Alpha", status: "ACTIVE" }),
    record("product", "product", "SYN-PROD-001", { code: "SYN-PROD-001", name: "Synthetic Product Alpha", status: "ACTIVE", customer_specific: true }, [rel("customer", "SYN-CUS-001")]),
    record("product", "product_version", "SYN-PROD-001/V1", { version: 1, status: "RELEASED" }, [rel("product", "SYN-PROD-001"), rel("material", "SYN-FG-001", "finished_material")]),
    record("supplier_mapping", "supplier_mapping", "SYN-SUP-001/PART-A", { supplier_part_code: "PART-A", status: "ACTIVE", conversion: "1.000000" }, [rel("supplier", "SYN-SUP-001"), rel("material", "SYN-MAT-001"), rel("unit", "PCS")]),
    record("bom", "bom", "SYN-BOM-001/V1", { code: "SYN-BOM-001", version: 1, status: "RELEASED" }, [rel("product_version", "SYN-PROD-001/V1")]),
    record("bom", "bom_line", "SYN-BOM-001/V1/L1", { line_no: 1, quantity: "2.000000", loss_rate: "0.010000" }, [rel("bom", "SYN-BOM-001/V1"), rel("material", "SYN-MAT-001"), rel("unit", "PCS")]),
    record("inventory", "inventory_balance", "SYN-MAT-001/MAIN", { on_hand_qty: "100.000000", frozen_qty: "4.000000", history_reliability: "BALANCE_ONLY" }, [rel("material", "SYN-MAT-001"), rel("unit", "PCS")]),
    record("inventory", "inventory_balance", "SYN-FG-001/MAIN", { on_hand_qty: "12.000000", frozen_qty: "0.000000", history_reliability: "VERIFIABLE" }, [rel("material", "SYN-FG-001"), rel("unit", "PCS")]),
    record("procurement", "purchase_order", "SYN-PO-001", { status: "PARTIALLY_RECEIVED", currency_code: "CNY", order_qty: "20.000000", received_qty: "8.000000", unit_price: "1.250000" }, [rel("supplier", "SYN-SUP-001"), rel("material", "SYN-MAT-001"), rel("supplier_mapping", "SYN-SUP-001/PART-A")]),
    record("procurement", "purchase_receipt", "SYN-REC-001", { status: "POSTED", quantity: "8.000000", amount: "10.000000" }, [rel("purchase_order", "SYN-PO-001"), rel("material", "SYN-MAT-001"), rel("unit", "PCS")]),
    record("production", "work_order", "SYN-WO-001", { status: "IN_PROGRESS", planned_qty: "10.000000", issued_qty: "12.000000", completed_qty: "4.000000" }, [rel("bom", "SYN-BOM-001/V1"), rel("product", "SYN-PROD-001")]),
    record("production", "production_report", "SYN-WO-001/R1", { status: "POSTED", reported_qty: "4.000000", good_qty: "4.000000" }, [rel("work_order", "SYN-WO-001")]),
    record("production", "production_completion", "SYN-WO-001/C1", { status: "POSTED", quantity: "4.000000" }, [rel("work_order", "SYN-WO-001"), rel("material", "SYN-FG-001"), rel("unit", "PCS")]),
    record("sales", "sales_order", "SYN-SO-001", { status: "PARTIALLY_SHIPPED", currency_code: "CNY", order_qty: "10.000000", shipped_qty: "3.000000", amount: "30.000000" }, [rel("customer", "SYN-CUS-001"), rel("product", "SYN-PROD-001"), rel("material", "SYN-FG-001")]),
    record("sales", "shipment", "SYN-SHIP-001", { status: "POSTED", quantity: "3.000000", amount: "9.000000" }, [rel("sales_order", "SYN-SO-001"), rel("material", "SYN-FG-001"), rel("unit", "PCS")]),
    record("quality", "quality_inspection", "SYN-IQC-001", { inspection_type: "IQC", status: "CLOSED", result: "PASS", quantity: "8.000000" }, [rel("purchase_receipt", "SYN-REC-001")]),
    record("quality", "quality_inspection", "SYN-IPQC-001", { inspection_type: "IPQC", status: "CLOSED", result: "PASS", quantity: "4.000000" }, [rel("production_report", "SYN-WO-001/R1")]),
    record("quality", "quality_inspection", "SYN-FQC-001", { inspection_type: "FQC", status: "CLOSED", result: "PASS", quantity: "3.000000" }, [rel("production_completion", "SYN-WO-001/C1"), rel("sales_order", "SYN-SO-001")]),
    record("finance", "finance_document", "SYN-AP-001", { document_type: "AP", status: "PARTIALLY_SETTLED", currency_code: "CNY", amount: "10.000000", settled_amount: "4.000000" }, [rel("purchase_receipt", "SYN-REC-001"), rel("supplier", "SYN-SUP-001")]),
    record("finance", "finance_document", "SYN-AR-001", { document_type: "AR", status: "PARTIALLY_SETTLED", currency_code: "CNY", amount: "9.000000", settled_amount: "3.000000" }, [rel("shipment", "SYN-SHIP-001"), rel("customer", "SYN-CUS-001")]),
    record("finance", "finance_opening", "SYN-OPENING-AR-001", { document_type: "AR", currency_code: "CNY", amount: "6.500000", accounting_date: "2026-01-01" }, [rel("customer", "SYN-CUS-001")]),
    record("finance", "finance_opening", "SYN-OPENING-AP-001", { document_type: "AP", currency_code: "CNY", amount: "7.250000", accounting_date: "2026-01-01" }, [rel("supplier", "SYN-SUP-001")]),
    record("file", "file", "synthetic-upload.bin", { bytes: 17, checksum_status: "MATCHED", sha256: "19ae05a8872e4000652f2efe7e9123cfc5e64aa2d69f9afb5511f80e21d66346", mime_type: "application/octet-stream", content_marker: "SYNTHETIC_FILE_V1" }),
    record("audit", "audit", "SYN-AUDIT-001", { action: "SYNTHETIC_IMPORT", result: "SUCCESS" }, [rel("identity", "synthetic_admin")]),
  ];
}

export function fixtureRecords(kind = "valid") {
  const valid = validSyntheticRecords();
  if (["valid", "resume", "repeat"].includes(kind)) return valid;
  if (kind === "reviewable") return [...valid, record("material", "material", "SYN-MAT-002", { code: "SYN-MAT-002", name: "Synthetic Component Alpha", status: "ACTIVE", review_reason: "SAME_NAME_DIFFERENT_CODE" }, [rel("unit", "PCS"), rel("category", "SYN-CAT-L4")])];
  if (kind === "blocked") return [
    ...valid,
    record("identity", "identity", "synthetic_unknown", { username: "synthetic_unknown", role: "unknown_role", status: "DISABLED" }),
    record("material", "material", "SYN-MAT-001", { code: "SYN-MAT-001", name: "Synthetic Duplicate", status: "ACTIVE" }, [rel("unit", "PCS")]),
    record("bom", "bom_line", "SYN-BOM-ORPHAN/L1", { line_no: 1, quantity: "1.000000" }, [rel("bom", "SYN-BOM-MISSING"), rel("material", "SYN-MAT-001")]),
    record("inventory", "inventory_balance", "SYN-MAT-NEG/MAIN", { on_hand_qty: "-1.000000", frozen_qty: "0.000000" }, [rel("material", "SYN-MAT-001"), rel("unit", "PCS")]),
    record("material", "material", "SYN-MAT-NOUNIT", { code: "SYN-MAT-NOUNIT", name: "Synthetic Missing Unit", status: "ACTIVE" }, [rel("category", "SYN-CAT-L4")]),
    record("procurement", "purchase_order", "SYN-PO-BAD", { status: "UNKNOWN", currency_code: "USD", order_qty: "1.0000001", received_qty: "0" }, [rel("supplier", "SYN-SUP-001")]),
    record("sales", "sales_order", "SYN-SO-BAD", { status: "PARTIALLY_SHIPPED", currency_code: "CNY", order_qty: "1.000000", shipped_qty: "2.000000", amount: "1.000000" }, [rel("customer", "SYN-CUS-001"), rel("product", "SYN-PROD-001")]),
    record("finance", "finance_document", "SYN-AR-BAD", { document_type: "AR", status: "OPEN", currency_code: "CNY", amount: "-1.000000", settled_amount: "0.000000" }, [rel("shipment", "SYN-SHIP-001"), rel("customer", "SYN-CUS-001")]),
    record("finance", "finance_opening", "SYN-AR-OPENING-BAD", { document_type: "AR", amount: "2.000000", currency_code: "USD" }, [rel("customer", "SYN-CUS-001"), rel("supplier", "SYN-SUP-001")]),
    record("inventory", "inventory_balance", "SYN-MAT-FROZEN/MAIN", { on_hand_qty: "1.000000", frozen_qty: "2.000000" }, [rel("material", "SYN-MAT-001"), rel("unit", "PCS")]),
    record("file", "file", "synthetic-missing.bin", { bytes: 0, checksum_status: "MISSING" }),
    record("file", "file", "synthetic-bad-sha.bin", { bytes: 5, checksum_status: "MISMATCH" }),
    record("audit", "unknown_event", "SYN-UNKNOWN-001", { status: "ACTIVE" }),
  ];
  throw new Error(`unknown synthetic fixture kind: ${kind}`);
}

export async function writeSyntheticD1Export(directory, kind = "valid") {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, `${kind}-d1-export.json`);
  const value = { schema_version: 1, synthetic_marker: "SYNTHETIC_MIGRATION_TEST_ONLY", fixture_kind: kind, schema: { tables: ["erp_records", "migration_export_records"] }, records: fixtureRecords(kind) };
  await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  return path;
}

export async function writeSyntheticSqlite(directory, kind = "valid") {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, `${kind}.sqlite3`);
  const db = new DatabaseSync(path);
  try {
    db.exec("create table migration_metadata(schema_version integer not null,fixture_kind text not null,synthetic_marker text not null); create table migration_records(sequence_no integer primary key,domain text not null,kind text not null,stable_key text not null,payload_json text not null,relations_json text not null)");
    db.prepare("insert into migration_metadata values(1,?,?)").run(kind, "SYNTHETIC_MIGRATION_TEST_ONLY");
    const insert = db.prepare("insert into migration_records values(?,?,?,?,?,?)");
    fixtureRecords(kind).forEach((item, index) => insert.run(index + 1, item.domain, item.kind, item.stable_key, JSON.stringify(item.data), JSON.stringify(item.relations)));
  } finally { db.close(); }
  return path;
}
