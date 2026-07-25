#!/usr/bin/env python3
"""Create the fully synthetic TASK04 SQLite fixture used by tests only."""

from __future__ import annotations

import importlib.util
import sqlite3
import sys
from pathlib import Path


def load_server(app_dir: Path):
    sys.path.insert(0, str(app_dir))
    spec = importlib.util.spec_from_file_location("task04_fixture_server", app_dir / "server.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def main() -> int:
    target = Path(sys.argv[1])
    app_dir = Path(sys.argv[2])
    server = load_server(app_dir)
    connection = sqlite3.connect(target)
    connection.row_factory = sqlite3.Row
    server.create_schema(connection)
    server.apply_migrations(connection)
    now = "2030-01-02 03:04:05"
    connection.executemany(
        "INSERT INTO items (internal_item_code,item_category,standard_name,item_status,base_uom,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
        [
            ("SYN-MAT-001", "SYN", "SENSITIVE_MATERIAL_ALPHA", "启用", "PCS", now, now),
            (" syn-mat-001 ", "SYN", "SENSITIVE_MATERIAL_ALPHA", "启用", "PCS", now, now),
            ("SYN-MAT-002", "", "SENSITIVE_MATERIAL_BETA", "启用", "", now, now),
            ("SYN-MAT-003", "SYN", "SENSITIVE_MATERIAL_GAMMA", "UNEXPECTED", "PCS", now, now),
        ],
    )
    connection.executemany(
        "INSERT INTO app_users (username,display_name,role,password_hash,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
        [
            ("synthetic_user", "SENSITIVE_PERSON_ALPHA", "admin", "pbkdf2_sha256$" + "a" * 32 + "$" + "b" * 64, 1, now, now),
            (" SYNTHETIC_USER ", "SENSITIVE_PERSON_BETA", "unknown-role", "unsafe-hash", 1, now, now),
        ],
    )
    connection.execute("INSERT INTO app_sessions (session_token,username,expires_at,created_at) VALUES (?,?,?,?)", ("SENSITIVE_SESSION_TOKEN", "synthetic_user", 1999999999, now))
    connection.execute("INSERT INTO suppliers (supplier_code,supplier_name,supplier_status,created_at,updated_at) VALUES (?,?,?,?,?)", ("SYN-SUP-001", "SENSITIVE_SUPPLIER", "启用", now, now))
    connection.execute("INSERT INTO customers (customer_code,customer_name,customer_status,phone,address,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", ("SYN-CUS-001", "SENSITIVE_CUSTOMER", "启用", "13800000000", "SENSITIVE_ADDRESS", now, now))
    connection.execute("INSERT INTO products (product_code,product_name,customer_name,created_at,updated_at) VALUES (?,?,?,?,?)", ("SYN-PROD-001", "SENSITIVE_PRODUCT", "SENSITIVE_CUSTOMER", now, now))
    connection.execute("INSERT INTO supplier_mappings (internal_item_code,supplier_name,supplier_item_name,supplier_item_code,purchase_uom,match_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)", ("MISSING-MATERIAL", "SENSITIVE_SUPPLIER", "SENSITIVE_SUPPLIER_ITEM", "SYN-SUP-PART-001", "", "已确认", now, now))
    connection.execute("INSERT INTO product_boms (bom_code,product_code,bom_version,bom_status,created_at,updated_at) VALUES (?,?,?,?,?,?)", ("SYN-BOM-001", "SYN-PROD-001", "A0", "草稿", now, now))
    bom_id = connection.execute("SELECT id FROM product_boms").fetchone()[0]
    connection.execute("INSERT INTO bom_lines (bom_id,line_no,internal_item_code,qty_per,uom,loss_rate,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)", (bom_id, 1, "MISSING-MATERIAL", 1.1234567, "", 0, now, now))
    connection.executemany(
        "INSERT INTO inventory_balances (internal_item_code,on_hand_qty,reserved_qty,updated_at) VALUES (?,?,?,?)",
        [("SYN-MAT-001", 12.123456, 2, now), ("SYN-MAT-002", -1, 0, now), ("SYN-MAT-003", 1, 2, now)],
    )
    connection.execute("INSERT INTO purchase_orders (po_code,supplier_name,po_status,created_at,updated_at) VALUES (?,?,?,?,?)", ("SYN-PO-001", "SENSITIVE_SUPPLIER", "待收货", now, now))
    po_id = connection.execute("SELECT id FROM purchase_orders").fetchone()[0]
    connection.execute("INSERT INTO purchase_order_lines (po_id,line_no,internal_item_code,order_qty,uom,unit_price,received_qty,line_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", (po_id, 1, "SYN-MAT-001", 5, "PCS", 3.5, 7, "待收货", now, now))
    connection.execute("INSERT INTO sales_orders (sales_order_code,customer_name,product_code,order_qty,shipped_qty,sales_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)", ("SYN-SO-001", "SENSITIVE_CUSTOMER", "SYN-PROD-001", 10, 2, "部分出货", now, now))
    sales_id = connection.execute("SELECT id FROM sales_orders").fetchone()[0]
    connection.execute("INSERT INTO financial_documents (doc_code,doc_type,counterparty,source_type,source_id,source_code,total_amount,paid_amount,doc_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", ("SYN-AR-001", "应收", "SENSITIVE_CUSTOMER", "销售订单", sales_id, "SYN-SO-001", 100.1234567, 20, "部分结清", now, now))
    connection.execute("INSERT INTO financial_documents (doc_code,doc_type,counterparty,source_type,source_id,source_code,total_amount,paid_amount,doc_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", ("SYN-AP-001", "应付", "SENSITIVE_SUPPLIER", "未知来源", 999, "SYN-UNKNOWN", 50, 0, "未结清", now, now))
    connection.execute("INSERT INTO quality_inspections (inspection_code,inspection_type,ref_type,ref_id,item_code,inspected_qty,passed_qty,failed_qty,inspection_status,inspection_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", ("SYN-IQC-001", "IQC", "未知来源", 0, "SYN-MAT-001", 10, 9, 2, "异常待处理", "2030-01-02", now, now))
    connection.execute("INSERT INTO material_import_batches (batch_no,original_filename,source_sha256,source_type,selected_sheet_name,header_start_row,header_end_row,data_start_row,structure_confidence,mapping_json,total_source_rows,data_row_count,imported_row_count,batch_status,created_by,created_at,updated_at,archived_file_key,file_size_bytes,parse_warnings_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ("SYN-BATCH-001", "SENSITIVE_FILENAME.xlsx", "bad", "XLSX", "SENSITIVE_SHEET", 1, 1, 2, 1, "{}", 1, 1, 1, "IMPORTED", "synthetic_user", now, now, "/absolute/SENSITIVE_FILE", 123, "[]"))
    connection.commit()
    connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
