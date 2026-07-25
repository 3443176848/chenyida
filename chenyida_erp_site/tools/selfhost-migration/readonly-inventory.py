#!/usr/bin/env python3
"""Redacted aggregate inventory for an authorized TASK04 SQLite snapshot."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import importlib.util
import json
import os
import re
import secrets
import sqlite3
import stat
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import quote


MODE = "REAL_READONLY_INVENTORY"
CONFIRMATION = "REAL_LOCAL_SQLITE_READONLY_INVENTORY"
TOOL_VERSION = "0.1.0-alpha.15"
SNAPSHOT_NAME = "task04-source.snapshot.sqlite3"
REPORT_NAMES = (
    "source-schema-fingerprint.json",
    "source-target-aggregate-mapping.json",
    "real-readonly-data-quality.json",
    "migration-dry-run-aggregate.json",
    "manual-disposition-template.json",
)

ROLE_VALUES = ("admin", "manager", "purchase", "engineering", "production", "warehouse", "quality", "sales", "finance")
ENUMS = {
    ("items", "item_status"): ("启用", "停用"),
    ("supplier_mappings", "match_status"): ("已确认", "疑似匹配", "新物料", "待审核", "已拒绝"),
    ("cleaning_rows", "process_status"): ("待处理", "已确认", "已创建", "已忽略"),
    ("products", "lifecycle_status"): ("样品", "试产", "量产", "停产"),
    ("customers", "customer_status"): ("启用", "停用"),
    ("suppliers", "supplier_status"): ("启用", "停用"),
    ("quotations", "quote_status"): ("草稿", "已报价", "已转订单", "已失效", "已取消"),
    ("product_boms", "bom_status"): ("草稿", "已发布", "已停用"),
    ("purchase_orders", "po_status"): ("待收货", "部分收货", "已收货", "已取消"),
    ("purchase_order_lines", "line_status"): ("待收货", "部分收货", "已收货", "已取消"),
    ("work_orders", "work_status"): ("待领料", "生产中", "部分完工", "已完工", "已取消"),
    ("sales_orders", "sales_status"): ("待生产", "部分出货", "已出货", "已取消"),
    ("quality_inspections", "inspection_type"): ("IQC", "IPQC", "FQC"),
    ("quality_inspections", "inspection_status"): ("待判定", "异常待处理", "合格放行", "返工", "退货", "报废"),
    ("financial_documents", "doc_type"): ("应收", "应付"),
    ("financial_documents", "doc_status"): ("未结清", "部分结清", "已结清"),
    ("financial_payments", "payment_type"): ("收款", "付款"),
    ("material_import_batches", "source_type"): ("CSV", "XLSX", "XLS"),
    ("material_import_batches", "batch_status"): ("PARSING", "IMPORTED", "FAILED"),
}

TABLE_MAPPING = {
    "app_users": ("identity", "app_users", "READY_WITH_TRANSFORM", "normalized username", "roles/security review", "HIGH"),
    "app_sessions": ("identity", "none", "ARCHIVE_ONLY", "none", "app_users", "HIGH"),
    "items": ("material", "material_master", "READY_WITH_TRANSFORM", "internal item code", "units/categories", "HIGH"),
    "supplier_mappings": ("supplier_mapping", "supplier_mappings", "NEEDS_BUSINESS_REVIEW", "source row opaque key", "materials/suppliers/units", "HIGH"),
    "cleaning_rows": ("material", "material_import review archive", "ARCHIVE_ONLY", "source row opaque key", "import batches", "MEDIUM"),
    "material_import_batches": ("file", "material_import_batches", "READY_WITH_TRANSFORM", "batch code digest", "file metadata only", "HIGH"),
    "material_import_raw_rows": ("file", "material_import raw archive", "ARCHIVE_ONLY", "source row opaque key", "import batches", "HIGH"),
    "products": ("product", "products/product_versions", "READY_WITH_TRANSFORM", "product code", "customer/material", "HIGH"),
    "customers": ("party", "customers", "READY_WITH_TRANSFORM", "customer code", "manual privacy review", "HIGH"),
    "suppliers": ("party", "suppliers", "READY_WITH_TRANSFORM", "supplier code", "manual privacy review", "HIGH"),
    "quotations": ("sales", "sales_quotations archive", "ARCHIVE_ONLY", "source row opaque key", "customers/products", "HIGH"),
    "product_boms": ("bom", "bom_headers", "READY_WITH_TRANSFORM", "BOM code digest", "products", "HIGH"),
    "bom_lines": ("bom", "bom_lines", "READY_WITH_TRANSFORM", "BOM and line position", "BOM/material/unit", "HIGH"),
    "inventory_balances": ("inventory", "inventory_migration_openings", "READY_WITH_TRANSFORM", "material and fixed location", "materials/units", "CRITICAL"),
    "inventory_transactions": ("inventory", "inventory history archive", "ARCHIVE_ONLY", "source row opaque key", "materials/source facts", "CRITICAL"),
    "inventory_adjustments": ("inventory", "inventory history archive", "ARCHIVE_ONLY", "source row opaque key", "materials", "CRITICAL"),
    "purchase_orders": ("procurement", "purchase order snapshot/archive", "NEEDS_BUSINESS_REVIEW", "purchase order code digest", "suppliers", "HIGH"),
    "purchase_order_lines": ("procurement", "purchase order lines", "NEEDS_BUSINESS_REVIEW", "order and line position", "order/material/unit", "HIGH"),
    "work_orders": ("production", "work order snapshot/archive", "NEEDS_BUSINESS_REVIEW", "work order code digest", "BOM/product", "HIGH"),
    "work_order_materials": ("production", "work order material archive", "ARCHIVE_ONLY", "work order and line position", "work order/material/unit", "HIGH"),
    "production_reports": ("production", "production report archive", "ARCHIVE_ONLY", "source row opaque key", "work orders", "HIGH"),
    "sales_orders": ("sales", "sales order snapshot/archive", "NEEDS_BUSINESS_REVIEW", "sales order code digest", "customers/products", "HIGH"),
    "shipments": ("sales", "shipment archive", "ARCHIVE_ONLY", "source row opaque key", "sales orders/material", "CRITICAL"),
    "quality_inspections": ("quality", "quality inspections", "NEEDS_BUSINESS_REVIEW", "inspection code digest", "legacy source resolution", "HIGH"),
    "quality_defects": ("quality", "quality defect archive", "ARCHIVE_ONLY", "source row opaque key", "quality inspections", "HIGH"),
    "financial_documents": ("finance", "finance_opening_sources", "READY_WITH_TRANSFORM", "document code digest", "stable receipt/shipment source", "CRITICAL"),
    "financial_payments": ("finance", "settlement history archive", "ARCHIVE_ONLY", "source row opaque key", "finance documents", "CRITICAL"),
    "activity_log": ("audit", "legacy audit archive", "ARCHIVE_ONLY", "source row opaque key", "none", "HIGH"),
    "local_schema_migrations": ("reference", "none", "ARCHIVE_ONLY", "migration version", "none", "LOW"),
}


class InventoryError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def fail(code: str, message: str) -> None:
    raise InventoryError(code, message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_digest(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def schema_fingerprint(connection: sqlite3.Connection) -> str:
    rows = connection.execute(
        "SELECT type,name,tbl_name,coalesce(sql,'') FROM sqlite_master "
        "WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name,tbl_name"
    ).fetchall()
    return canonical_digest(rows)


def schema_inventory(connection: sqlite3.Connection) -> dict[str, dict[str, object]]:
    table_names = [row[0] for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()]
    result = {}
    for table in table_names:
        columns = [
            {"name": row[1], "type": row[2], "not_null": bool(row[3]), "primary_key_position": row[5]}
            for row in connection.execute(f'PRAGMA table_info("{table}")').fetchall()
        ]
        indexes = [
            {"name": row[1], "unique": bool(row[2]), "origin": row[3], "partial": bool(row[4])}
            for row in connection.execute(f'PRAGMA index_list("{table}")').fetchall()
        ]
        foreign_keys = [
            {"target_table": row[2], "from_column": row[3], "to_column": row[4], "on_update": row[5], "on_delete": row[6]}
            for row in connection.execute(f'PRAGMA foreign_key_list("{table}")').fetchall()
        ]
        result[table] = {"columns": columns, "indexes": sorted(indexes, key=lambda item: item["name"]), "foreign_keys": foreign_keys}
    return result


def expected_schema(legacy_app_dir: Path) -> dict[str, dict[str, object]]:
    server_path = legacy_app_dir / "server.py"
    if legacy_app_dir.resolve() != Path("/opt/erp/chenyida_erp_app") or not server_path.is_file():
        fail("READONLY_SCHEMA_SOURCE_INVALID", "Python Schema 来源路径无效")
    sys.path.insert(0, str(legacy_app_dir))
    try:
        spec = importlib.util.spec_from_file_location("task04_schema_reference", server_path)
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(module)
        connection = sqlite3.connect(":memory:")
        connection.row_factory = sqlite3.Row
        try:
            module.create_schema(connection)
            module.apply_migrations(connection)
            return schema_inventory(connection)
        finally:
            connection.close()
    finally:
        sys.path.pop(0)


class Inspector:
    def __init__(self, connection: sqlite3.Connection, tables: dict[str, dict[str, object]], key: bytes):
        self.connection = connection
        self.tables = tables
        self.key = key
        self.dispositions: list[dict[str, str]] = []

    def has(self, table: str, *columns: str) -> bool:
        names = {item["name"] for item in self.tables.get(table, {}).get("columns", [])}
        return table in self.tables and all(column in names for column in columns)

    def scalar(self, sql: str, parameters: tuple[object, ...] = ()) -> int | float:
        value = self.connection.execute(sql, parameters).fetchone()[0]
        return 0 if value is None else value

    def count(self, table: str, condition: str = "1=1", parameters: tuple[object, ...] = ()) -> int:
        if table not in self.tables:
            return 0
        return int(self.scalar(f'SELECT count(*) FROM "{table}" WHERE {condition}', parameters))

    def enum_counts(self, table: str, column: str, values: tuple[str, ...]) -> dict[str, object]:
        if not self.has(table, column):
            return {"known": {value: 0 for value in values}, "unknown": 0, "missing": 0}
        expressions = [f'SUM(CASE WHEN "{column}"=? THEN 1 ELSE 0 END)' for _ in values]
        placeholders = ",".join("?" for _ in values)
        sql = f'SELECT {",".join(expressions)}, SUM(CASE WHEN "{column}" IS NULL OR trim("{column}")="" THEN 1 ELSE 0 END), SUM(CASE WHEN "{column}" IS NOT NULL AND trim("{column}")<>"" AND "{column}" NOT IN ({placeholders}) THEN 1 ELSE 0 END) FROM "{table}"'
        row = self.connection.execute(sql, values + values).fetchone()
        return {"known": {value: int(row[index] or 0) for index, value in enumerate(values)}, "missing": int(row[len(values)] or 0), "unknown": int(row[len(values) + 1] or 0)}

    def issue_rows(self, *, table: str, key_column: str, domain: str, code: str, condition: str, parameters: tuple[object, ...] = (), severity: str = "BLOCKER", blocking: str = "BLOCKED", decision: str = "DATA_CORRECTION", dependency: str = "none", action: str = "EXCLUDE_WITH_APPROVAL") -> int:
        if not self.has(table, key_column):
            return 0
        rows = self.connection.execute(f'SELECT "{key_column}" FROM "{table}" WHERE {condition}', parameters).fetchall()
        for (source_id,) in rows:
            opaque = hmac.new(self.key, f"{table}\0{source_id}".encode("utf-8"), hashlib.sha256).hexdigest()[:32]
            self.dispositions.append({
                "opaque_reference": f"ref_{opaque}", "domain": domain, "issue_code": code,
                "severity": severity, "blocking_status": blocking, "required_decision_type": decision,
                "dependency": dependency, "recommended_action_category": action,
            })
        return len(rows)


def duplicate_groups(inspector: Inspector, table: str, expression: str) -> int:
    if table not in inspector.tables:
        return 0
    return int(inspector.scalar(f'SELECT count(*) FROM (SELECT {expression} AS normalized_value FROM "{table}" WHERE {expression}<>"" GROUP BY normalized_value HAVING count(*)>1)'))


def precision_count(inspector: Inspector, table: str, columns: tuple[str, ...]) -> int:
    available = [column for column in columns if inspector.has(table, column)]
    if not available:
        return 0
    condition = " OR ".join(f'(typeof("{column}") NOT IN (\'integer\',\'real\') OR abs("{column}"*1000000-round("{column}"*1000000))>0.000001)' for column in available)
    return inspector.count(table, condition)


def build_reports(connection: sqlite3.Connection, actual: dict[str, dict[str, object]], expected: dict[str, dict[str, object]], manifest: dict[str, object]) -> tuple[dict[str, object], ...]:
    inspector = Inspector(connection, actual, secrets.token_bytes(32))
    table_counts = {table: inspector.count(table) for table in actual}
    missing_tables = sorted(set(expected) - set(actual))
    extra_tables = sorted(set(actual) - set(expected))
    drift = []
    for table in sorted(set(actual) & set(expected)):
        actual_columns = {item["name"]: item["type"] for item in actual[table]["columns"]}
        expected_columns = {item["name"]: item["type"] for item in expected[table]["columns"]}
        missing_columns = sorted(set(expected_columns) - set(actual_columns))
        extra_columns = sorted(set(actual_columns) - set(expected_columns))
        type_mismatches = sorted(name for name in set(actual_columns) & set(expected_columns) if actual_columns[name].upper() != expected_columns[name].upper())
        if missing_columns or extra_columns or type_mismatches:
            drift.append({"table": table, "missing_columns": missing_columns, "extra_columns": extra_columns, "type_mismatch_columns": type_mismatches})

    schema_report = {
        "schema_version": 1, "mode": MODE, "source_path_digest": manifest["source_path_digest"],
        "source_snapshot_sha256": manifest["snapshot_sha256"], "source_schema_fingerprint": manifest["schema_fingerprint"],
        "integrity_check": manifest["integrity_check"], "sqlite_version": manifest["sqlite_version"],
        "snapshot_bytes": manifest["snapshot_bytes"], "page_count": manifest["page_count"], "page_size": manifest["page_size"],
        "actual_table_count": len(actual), "expected_table_count": len(expected), "missing_tables": missing_tables,
        "extra_tables": extra_tables, "column_drift": drift, "table_row_counts": table_counts,
        "tables": [{"source_table": table, **actual[table]} for table in sorted(actual)],
        "migration_records": {
            "count": table_counts.get("local_schema_migrations", 0),
            "expected_count": 4,
            "missing_or_extra_count": abs(table_counts.get("local_schema_migrations", 0) - 4),
        },
    }

    mapping_rows = []
    for table in sorted(actual):
        domain, target, status, strategy, dependency, risk = TABLE_MAPPING.get(table, ("unknown", "none", "MODEL_GAP", "none", "model review", "HIGH"))
        mapping_rows.append({
            "source_table": table, "target_domain": domain, "target_table": target,
            "migration_classification": "archive" if status == "ARCHIVE_ONLY" else "snapshot_or_opening",
            "stable_source_key_strategy": strategy, "dependency": dependency, "risk": risk,
            "data_quality_issue_count": 0, "mapping_status": status, "record_count": table_counts[table],
        })
    mapping_report = {
        "schema_version": 1, "mode": MODE, "mapping_registry_version": "selfhost-real-readonly-map-v1",
        "mapping_registry_digest": canonical_digest(mapping_rows), "source_tables": mapping_rows,
    }

    identity = {
        "users": table_counts.get("app_users", 0),
        "active": inspector.count("app_users", "is_active=1"), "disabled": inspector.count("app_users", "is_active=0"),
        "invalid_active_flag": inspector.count("app_users", "is_active NOT IN (0,1) OR is_active IS NULL"),
        "roles": inspector.enum_counts("app_users", "role", ROLE_VALUES),
        "duplicate_normalized_username_groups": duplicate_groups(inspector, "app_users", "lower(trim(username))"),
        "password_hash_format": {
            "pbkdf2_sha256": inspector.count("app_users", "password_hash GLOB 'pbkdf2_sha256$*$*' AND length(password_hash)>=90"),
            "unknown": inspector.count("app_users", "NOT (password_hash GLOB 'pbkdf2_sha256$*$*' AND length(password_hash)>=90)"),
        },
        "sessions": table_counts.get("app_sessions", 0),
        "session_created_min": connection.execute("SELECT min(created_at) FROM app_sessions").fetchone()[0] if "app_sessions" in actual else None,
        "session_created_max": connection.execute("SELECT max(created_at) FROM app_sessions").fetchone()[0] if "app_sessions" in actual else None,
        "session_expiry_min": connection.execute("SELECT min(expires_at) FROM app_sessions").fetchone()[0] if "app_sessions" in actual else None,
        "session_expiry_max": connection.execute("SELECT max(expires_at) FROM app_sessions").fetchone()[0] if "app_sessions" in actual else None,
    }
    inspector.issue_rows(table="app_users", key_column="username", domain="identity", code="UNKNOWN_ROLE", condition=f"role NOT IN ({','.join('?' for _ in ROLE_VALUES)})", parameters=ROLE_VALUES, action="DISABLE_ACCOUNT", decision="ROLE_MAPPING")
    inspector.issue_rows(table="app_users", key_column="username", domain="identity", code="PASSWORD_HASH_FORMAT", condition="NOT (password_hash GLOB 'pbkdf2_sha256$*$*' AND length(password_hash)>=90)", action="DISABLE_ACCOUNT", decision="ACCOUNT_SECURITY")

    material = {
        "materials": table_counts.get("items", 0), "missing_code": inspector.count("items", "internal_item_code IS NULL OR trim(internal_item_code)=''"),
        "duplicate_normalized_code_groups": duplicate_groups(inspector, "items", "upper(trim(internal_item_code))"),
        "missing_unit": inspector.count("items", "base_uom IS NULL OR trim(base_uom)=''"),
        "missing_category": inspector.count("items", "item_category IS NULL OR trim(item_category)=''"),
        "status": inspector.enum_counts("items", "item_status", ENUMS[("items", "item_status")]),
        "suspected_duplicate_name_groups": duplicate_groups(inspector, "items", "upper(replace(trim(standard_name),' ',''))"),
        "supplier_mappings": table_counts.get("supplier_mappings", 0),
        "supplier_mapping_orphan_material": inspector.count("supplier_mappings", "NOT EXISTS (SELECT 1 FROM items i WHERE i.internal_item_code=supplier_mappings.internal_item_code)"),
        "supplier_mapping_conflict_groups": int(inspector.scalar("SELECT count(*) FROM (SELECT upper(trim(supplier_name)) AS supplier_key,upper(trim(supplier_item_code)) AS part_key FROM supplier_mappings WHERE trim(supplier_item_code)<>'' GROUP BY supplier_key,part_key HAVING min(upper(trim(internal_item_code)))<>max(upper(trim(internal_item_code))))")) if "supplier_mappings" in actual else 0,
        "supplier_mapping_missing_unit": inspector.count("supplier_mappings", "purchase_uom IS NULL OR trim(purchase_uom)=''"),
    }
    inspector.issue_rows(table="items", key_column="internal_item_code", domain="material", code="MISSING_UNIT", condition="base_uom IS NULL OR trim(base_uom)=''", action="PROVIDE_UNIT", decision="UNIT_MAPPING")
    inspector.issue_rows(table="supplier_mappings", key_column="id", domain="supplier_mapping", code="ORPHAN_MATERIAL", condition="NOT EXISTS (SELECT 1 FROM items i WHERE i.internal_item_code=supplier_mappings.internal_item_code)", action="MAP_STABLE_ID", decision="MATERIAL_MAPPING", dependency="material")
    inspector.issue_rows(table="supplier_mappings", key_column="id", domain="supplier_mapping", code="SUPPLIER_MAPPING_CONFLICT", condition="trim(supplier_item_code)<>'' AND EXISTS (SELECT 1 FROM supplier_mappings other WHERE other.id<>supplier_mappings.id AND upper(trim(other.supplier_name))=upper(trim(supplier_mappings.supplier_name)) AND upper(trim(other.supplier_item_code))=upper(trim(supplier_mappings.supplier_item_code)) AND upper(trim(other.internal_item_code))<>upper(trim(supplier_mappings.internal_item_code)))", severity="MAJOR", blocking="REVIEW", action="SELECT_CANONICAL", decision="CANONICAL_MAPPING", dependency="material/supplier")

    master_bom = {
        "customers": table_counts.get("customers", 0), "suppliers": table_counts.get("suppliers", 0), "products": table_counts.get("products", 0),
        "boms": table_counts.get("product_boms", 0), "bom_lines": table_counts.get("bom_lines", 0),
        "customer_missing_or_duplicate_code": inspector.count("customers", "customer_code IS NULL OR trim(customer_code)=''") + duplicate_groups(inspector, "customers", "upper(trim(customer_code))"),
        "supplier_missing_or_duplicate_code": inspector.count("suppliers", "supplier_code IS NULL OR trim(supplier_code)=''") + duplicate_groups(inspector, "suppliers", "upper(trim(supplier_code))"),
        "product_missing_or_duplicate_code": inspector.count("products", "product_code IS NULL OR trim(product_code)=''") + duplicate_groups(inspector, "products", "upper(trim(product_code))"),
        "bom_missing_or_duplicate_code": inspector.count("product_boms", "bom_code IS NULL OR trim(bom_code)=''") + duplicate_groups(inspector, "product_boms", "upper(trim(bom_code))"),
        "bom_orphan_product": inspector.count("product_boms", "NOT EXISTS (SELECT 1 FROM products p WHERE p.product_code=product_boms.product_code)"),
        "bom_orphan_line": inspector.count("bom_lines", "NOT EXISTS (SELECT 1 FROM product_boms b WHERE b.id=bom_lines.bom_id)"),
        "bom_unknown_material": inspector.count("bom_lines", "NOT EXISTS (SELECT 1 FROM items i WHERE i.internal_item_code=bom_lines.internal_item_code)"),
        "bom_missing_unit": inspector.count("bom_lines", "uom IS NULL OR trim(uom)=''"),
        "bom_quantity_precision_errors": precision_count(inspector, "bom_lines", ("qty_per", "loss_rate")),
        "bom_status": inspector.enum_counts("product_boms", "bom_status", ENUMS[("product_boms", "bom_status")]),
    }
    inspector.issue_rows(table="bom_lines", key_column="id", domain="bom", code="BOM_ORPHAN_OR_UNKNOWN_MATERIAL", condition="NOT EXISTS (SELECT 1 FROM product_boms b WHERE b.id=bom_lines.bom_id) OR NOT EXISTS (SELECT 1 FROM items i WHERE i.internal_item_code=bom_lines.internal_item_code)", dependency="material/product", action="MAP_STABLE_ID", decision="REFERENCE_MAPPING")

    inventory = {
        "balance_records": table_counts.get("inventory_balances", 0),
        "missing_material": inspector.count("inventory_balances", "NOT EXISTS (SELECT 1 FROM items i WHERE i.internal_item_code=inventory_balances.internal_item_code)"),
        "missing_unit": inspector.count("inventory_balances", "NOT EXISTS (SELECT 1 FROM items i WHERE i.internal_item_code=inventory_balances.internal_item_code AND trim(i.base_uom)<>'')"),
        "negative_on_hand": inspector.count("inventory_balances", "on_hand_qty<0"),
        "frozen_exceeds_on_hand": inspector.count("inventory_balances", "reserved_qty>on_hand_qty"),
        "precision_errors": precision_count(inspector, "inventory_balances", ("on_hand_qty", "reserved_qty")),
        "on_hand_total": inspector.scalar("SELECT coalesce(sum(on_hand_qty),0) FROM inventory_balances") if "inventory_balances" in actual else 0,
        "frozen_total": inspector.scalar("SELECT coalesce(sum(reserved_qty),0) FROM inventory_balances") if "inventory_balances" in actual else 0,
    }
    inv_invalid = "on_hand_qty<=0 OR reserved_qty<0 OR reserved_qty>on_hand_qty OR NOT EXISTS (SELECT 1 FROM items i WHERE i.internal_item_code=inventory_balances.internal_item_code AND trim(i.base_uom)<>'')"
    inventory["opening_plannable"] = inspector.count("inventory_balances", f"NOT ({inv_invalid})")
    inventory["blocked"] = inspector.count("inventory_balances", inv_invalid)
    inspector.issue_rows(table="inventory_balances", key_column="internal_item_code", domain="inventory", code="INVENTORY_OPENING_BLOCKED", condition=inv_invalid, dependency="material/unit", action="OPENING_BALANCE", decision="OPENING_REVIEW")

    procurement = {
        "documents": table_counts.get("purchase_orders", 0), "lines": table_counts.get("purchase_order_lines", 0),
        "status": inspector.enum_counts("purchase_orders", "po_status", ENUMS[("purchase_orders", "po_status")]),
        "line_status": inspector.enum_counts("purchase_order_lines", "line_status", ENUMS[("purchase_order_lines", "line_status")]),
        "quantity_chain_errors": inspector.count("purchase_order_lines", "order_qty<0 OR received_qty<0 OR received_qty>order_qty"),
        "orphan_orders": inspector.count("purchase_order_lines", "NOT EXISTS (SELECT 1 FROM purchase_orders p WHERE p.id=purchase_order_lines.po_id)"),
        "orphan_materials": inspector.count("purchase_order_lines", "NOT EXISTS (SELECT 1 FROM items i WHERE i.internal_item_code=purchase_order_lines.internal_item_code)"),
    }
    production = {
        "documents": table_counts.get("work_orders", 0), "material_lines": table_counts.get("work_order_materials", 0), "reports": table_counts.get("production_reports", 0),
        "status": inspector.enum_counts("work_orders", "work_status", ENUMS[("work_orders", "work_status")]),
        "quantity_chain_errors": inspector.count("work_orders", "order_qty<0 OR completed_qty<0 OR completed_qty>order_qty") + inspector.count("work_order_materials", "required_qty<0 OR issued_qty<0 OR issued_qty>required_qty") + inspector.count("production_reports", "good_qty<0 OR scrap_qty<0"),
        "orphan_references": inspector.count("work_orders", "NOT EXISTS (SELECT 1 FROM product_boms b WHERE b.id=work_orders.bom_id) OR NOT EXISTS (SELECT 1 FROM products p WHERE p.product_code=work_orders.product_code)") + inspector.count("work_order_materials", "NOT EXISTS (SELECT 1 FROM work_orders w WHERE w.id=work_order_materials.work_order_id) OR NOT EXISTS (SELECT 1 FROM items i WHERE i.internal_item_code=work_order_materials.internal_item_code)") + inspector.count("production_reports", "NOT EXISTS (SELECT 1 FROM work_orders w WHERE w.id=production_reports.work_order_id)"),
    }
    sales = {
        "documents": table_counts.get("sales_orders", 0), "shipments": table_counts.get("shipments", 0),
        "status": inspector.enum_counts("sales_orders", "sales_status", ENUMS[("sales_orders", "sales_status")]),
        "quantity_chain_errors": inspector.count("sales_orders", "order_qty<0 OR shipped_qty<0 OR shipped_qty>order_qty") + inspector.count("shipments", "ship_qty<=0"),
        "orphan_references": inspector.count("sales_orders", "NOT EXISTS (SELECT 1 FROM products p WHERE p.product_code=sales_orders.product_code)") + inspector.count("shipments", "NOT EXISTS (SELECT 1 FROM sales_orders s WHERE s.id=shipments.sales_order_id) OR NOT EXISTS (SELECT 1 FROM items i WHERE i.internal_item_code=shipments.finished_item_code)"),
    }
    active_history = {
        "procurement": procurement["documents"] - procurement["status"]["known"].get("已收货", 0) - procurement["status"]["known"].get("已取消", 0),
        "production": production["documents"] - production["status"]["known"].get("已完工", 0) - production["status"]["known"].get("已取消", 0),
        "sales": sales["documents"] - sales["status"]["known"].get("已出货", 0) - sales["status"]["known"].get("已取消", 0),
    }

    quality = {
        "inspections": table_counts.get("quality_inspections", 0), "defects": table_counts.get("quality_defects", 0),
        "type": inspector.enum_counts("quality_inspections", "inspection_type", ENUMS[("quality_inspections", "inspection_type")]),
        "status": inspector.enum_counts("quality_inspections", "inspection_status", ENUMS[("quality_inspections", "inspection_status")]),
        "legacy_ref_type": inspector.enum_counts("quality_inspections", "ref_type", ("采购明细", "生产工单", "销售订单")),
        "unstable_source": inspector.count("quality_inspections", "ref_id<=0 OR ref_type NOT IN ('采购明细','生产工单','销售订单')"),
        "quantity_conservation_errors": inspector.count("quality_inspections", "inspected_qty<0 OR passed_qty<0 OR failed_qty<0 OR passed_qty+failed_qty>inspected_qty+0.000001") + inspector.count("quality_defects", "defect_qty<0"),
        "orphan_defects": inspector.count("quality_defects", "NOT EXISTS (SELECT 1 FROM quality_inspections q WHERE q.id=quality_defects.inspection_id)"),
    }
    quality["mappable"] = max(0, quality["inspections"] - quality["unstable_source"] - quality["quantity_conservation_errors"])
    quality["blocked"] = quality["inspections"] - quality["mappable"]
    inspector.issue_rows(table="quality_inspections", key_column="id", domain="quality", code="QUALITY_SOURCE_UNSTABLE", condition="ref_id<=0 OR ref_type NOT IN ('采购明细','生产工单','销售订单')", dependency="procurement/production/sales", action="MAP_STABLE_ID", decision="SOURCE_RESOLUTION")

    finance = {
        "documents": table_counts.get("financial_documents", 0), "payments": table_counts.get("financial_payments", 0),
        "type": inspector.enum_counts("financial_documents", "doc_type", ENUMS[("financial_documents", "doc_type")]),
        "status": inspector.enum_counts("financial_documents", "doc_status", ENUMS[("financial_documents", "doc_status")]),
        "payment_type": inspector.enum_counts("financial_payments", "payment_type", ENUMS[("financial_payments", "payment_type")]),
        "currency_cny": 0, "currency_non_cny": 0, "currency_not_recorded": table_counts.get("financial_documents", 0),
        "amount_precision_errors": precision_count(inspector, "financial_documents", ("total_amount", "paid_amount")) + precision_count(inspector, "financial_payments", ("amount",)),
        "negative_amounts": inspector.count("financial_documents", "total_amount<0 OR paid_amount<0") + inspector.count("financial_payments", "amount<0"),
        "amount_chain_errors": inspector.count("financial_documents", "paid_amount>total_amount"),
        "orphan_payments": inspector.count("financial_payments", "NOT EXISTS (SELECT 1 FROM financial_documents d WHERE d.id=financial_payments.doc_id)"),
        "source_total": inspector.scalar("SELECT coalesce(sum(total_amount),0) FROM financial_documents") if "financial_documents" in actual else 0,
        "paid_total": inspector.scalar("SELECT coalesce(sum(paid_amount),0) FROM financial_documents") if "financial_documents" in actual else 0,
        "balance_total": inspector.scalar("SELECT coalesce(sum(total_amount-paid_amount),0) FROM financial_documents") if "financial_documents" in actual else 0,
        "settled_total": inspector.scalar("SELECT coalesce(sum(total_amount),0) FROM financial_documents WHERE doc_status='已结清'") if "financial_documents" in actual else 0,
        "unsettled_total": inspector.scalar("SELECT coalesce(sum(total_amount-paid_amount),0) FROM financial_documents WHERE doc_status IN ('未结清','部分结清')") if "financial_documents" in actual else 0,
    }
    stable_source = "(source_type='销售订单' AND EXISTS (SELECT 1 FROM sales_orders s WHERE s.id=financial_documents.source_id)) OR (source_type='采购单' AND EXISTS (SELECT 1 FROM purchase_orders p WHERE p.id=financial_documents.source_id))"
    finance["without_stable_source"] = inspector.count("financial_documents", f"NOT ({stable_source})")
    finance["opening_plannable"] = inspector.count("financial_documents", f"total_amount-paid_amount>0 AND doc_type IN ('应收','应付') AND ({stable_source})")
    inspector.issue_rows(table="financial_documents", key_column="id", domain="finance", code="FINANCE_SOURCE_UNSTABLE", condition=f"NOT ({stable_source})", dependency="sales/procurement", action="MAP_STABLE_ID", decision="SOURCE_RESOLUTION")

    files = {
        "file_reference_records": table_counts.get("material_import_batches", 0),
        "path_present": inspector.count("material_import_batches", "archived_file_key IS NOT NULL AND trim(archived_file_key)<>''"),
        "path_missing": inspector.count("material_import_batches", "archived_file_key IS NULL OR trim(archived_file_key)=''"),
        "path_format_invalid": inspector.count("material_import_batches", "archived_file_key LIKE '/%' OR archived_file_key LIKE '%..%' OR archived_file_key LIKE '%\\%'"),
        "recorded_checksum_present": inspector.count("material_import_batches", "source_sha256 GLOB '[0-9A-Fa-f]*' AND length(source_sha256)=64"),
        "recorded_checksum_missing_or_invalid": inspector.count("material_import_batches", "source_sha256 IS NULL OR length(source_sha256)<>64 OR source_sha256 NOT GLOB '[0-9A-Fa-f]*'"),
        "actual_file_existence": "NOT_READ", "actual_checksum": "NOT_READ",
    }
    inspector.issue_rows(table="material_import_batches", key_column="id", domain="file", code="FILE_METADATA_REVIEW", condition="archived_file_key IS NULL OR trim(archived_file_key)='' OR archived_file_key LIKE '/%' OR archived_file_key LIKE '%..%' OR length(source_sha256)<>64", blocking="REVIEW", severity="MAJOR", action="MANUAL_FILE_REVIEW", decision="FILE_METADATA")

    json_fields = (("material_import_batches", "mapping_json"), ("material_import_batches", "parse_warnings_json"), ("material_import_raw_rows", "raw_values_json"), ("cleaning_rows", "mapped_values_json"), ("cleaning_rows", "source_spec_tokens_json"), ("cleaning_rows", "candidate_spec_tokens_json"), ("cleaning_rows", "specification_match_evidence_json"))
    json_quality = []
    for table, column in json_fields:
        if inspector.has(table, column):
            json_quality.append({"table": table, "column": column, "total": table_counts[table], "invalid": inspector.count(table, f"json_valid(\"{column}\")=0")})

    data_quality = {
        "schema_version": 1, "mode": MODE,
        "domains": {"identity": identity, "material": material, "master_bom": master_bom, "inventory": inventory, "procurement": procurement, "production": production, "sales": sales, "quality": quality, "finance": finance, "files": files},
        "active_history_requiring_review": active_history, "json_validity": json_quality,
        "source_schema_drift_count": len(missing_tables) + len(extra_tables) + len(drift),
    }

    issue_counts = Counter(item["issue_code"] for item in inspector.dispositions)
    blocked_refs = {item["opaque_reference"] for item in inspector.dispositions if item["blocking_status"] == "BLOCKED"}
    review_refs = {item["opaque_reference"] for item in inspector.dispositions if item["blocking_status"] == "REVIEW"}
    classification_counts = Counter()
    for row in mapping_rows:
        classification_counts[row["mapping_status"]] += row["record_count"]
    total_records = sum(table_counts.values())
    dry_run = {
        "schema_version": 1, "mode": MODE, "target_connection": "NONE", "materialization": "DISABLED", "file_body_read": "DISABLED",
        "source_schema_fingerprint": manifest["schema_fingerprint"], "mapping_registry_digest": mapping_report["mapping_registry_digest"],
        "total_records": total_records, "planned": classification_counts["READY"] + classification_counts["READY_WITH_TRANSFORM"],
        "archive_only": classification_counts["ARCHIVE_ONLY"], "needs_review": classification_counts["NEEDS_BUSINESS_REVIEW"],
        "blocked_unique_records": len(blocked_refs), "model_gap": classification_counts["MODEL_GAP"],
        "orphan": sum(value for key, value in issue_counts.items() if "ORPHAN" in key),
        "duplicate": material["duplicate_normalized_code_groups"] + material["suspected_duplicate_name_groups"] + material["supplier_mapping_conflict_groups"] + identity["duplicate_normalized_username_groups"],
        "invalid_status": sum(value["unknown"] for value in (identity["roles"], material["status"], master_bom["bom_status"], procurement["status"], production["status"], sales["status"], quality["status"], finance["status"])),
        "invalid_quantity": inventory["negative_on_hand"] + inventory["frozen_exceeds_on_hand"] + procurement["quantity_chain_errors"] + production["quantity_chain_errors"] + sales["quantity_chain_errors"] + quality["quantity_conservation_errors"],
        "invalid_amount": finance["negative_amounts"] + finance["amount_chain_errors"] + finance["amount_precision_errors"],
        "invalid_unit": material["missing_unit"] + material["supplier_mapping_missing_unit"] + master_bom["bom_missing_unit"] + inventory["missing_unit"],
        "identity_issues": identity["roles"]["unknown"] + identity["duplicate_normalized_username_groups"] + identity["password_hash_format"]["unknown"],
        "file_metadata_issues": files["path_missing"] + files["path_format_invalid"] + files["recorded_checksum_missing_or_invalid"],
        "inventory_opening_plan": {"records": inventory["opening_plannable"], "on_hand_total": inventory["on_hand_total"], "frozen_total": inventory["frozen_total"], "created": 0},
        "finance_opening_plan": {"records": finance["opening_plannable"], "source_total": finance["source_total"], "paid_total": finance["paid_total"], "balance_total": finance["balance_total"], "created": 0},
        "domain_dependency_blocking": {"inventory": inventory["blocked"], "quality": quality["blocked"], "finance": finance["without_stable_source"], **active_history},
        "disposition_counts": {"blocked": len(blocked_refs), "review": len(review_refs), "by_issue_code": dict(sorted(issue_counts.items()))},
        "result": "AGGREGATE_INVENTORY_COMPLETE_WITH_FINDINGS" if blocked_refs or review_refs or classification_counts["MODEL_GAP"] else "AGGREGATE_INVENTORY_COMPLETE",
    }
    disposition = {
        "schema_version": 1, "mode": MODE, "source_snapshot_sha256": manifest["snapshot_sha256"],
        "opaque_reference_scope": "TASK_LOCAL_NON_LINKABLE", "task_local_key_persisted": False,
        "items": sorted(inspector.dispositions, key=lambda item: (item["domain"], item["issue_code"], item["opaque_reference"])),
    }
    issue_by_table = Counter()
    for item in inspector.dispositions:
        issue_by_table[item["domain"]] += 1
    for row in mapping_rows:
        row["data_quality_issue_count"] = issue_by_table[row["target_domain"]]
    mapping_report["mapping_registry_digest"] = canonical_digest(mapping_rows)
    dry_run["mapping_registry_digest"] = mapping_report["mapping_registry_digest"]
    return schema_report, mapping_report, data_quality, dry_run, disposition


def safe_leaf_scan(value: object) -> None:
    allowed_absolute = set()
    strings: list[str] = []
    def walk(item: object) -> None:
        if isinstance(item, dict):
            for child in item.values(): walk(child)
        elif isinstance(item, list):
            for child in item: walk(child)
        elif isinstance(item, str): strings.append(item)
    walk(value)
    for text in strings:
        if text in allowed_absolute:
            continue
        if "/opt/erp/chenyida_erp_app/data" in text or re.search(r"postgres(?:ql)?://|https?://", text, re.I):
            fail("READONLY_REPORT_SENSITIVE", "报告包含绝对源路径或远程 URL")
        if re.search(r"(?:1[3-9]\d{9})|(?:\b\d{15,18}[0-9Xx]\b)", text):
            fail("READONLY_REPORT_PII", "报告包含疑似个人信息")


def write_json(directory: Path, name: str, value: object) -> None:
    safe_leaf_scan(value)
    target = directory / name
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(target)


def validate(args: argparse.Namespace) -> tuple[Path, Path, dict[str, object]]:
    if args.mode != MODE or args.confirm != CONFIRMATION or not args.no_materialize or not args.no_files:
        fail("READONLY_FLAGS_REQUIRED", "真实只读模式确认或禁写参数缺失")
    if args.tool_version != TOOL_VERSION or not re.fullmatch(r"[0-9a-f]{40}", args.git_commit):
        fail("READONLY_BINDING_INVALID", "工具版本或 Git commit 无效")
    source = Path(args.source)
    manifest_path = Path(args.snapshot_manifest)
    output = Path(args.output)
    for path in (source, manifest_path, output):
        if not path.is_absolute(): fail("READONLY_PATH_INVALID", "路径必须为绝对路径")
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode): fail("READONLY_SYMLINK_FORBIDDEN", "路径不得为符号链接")
    if source.name != SNAPSHOT_NAME or not source.is_file() or not manifest_path.is_file() or not output.is_dir() or any(output.iterdir()):
        fail("READONLY_PATH_INVALID", "快照、manifest 或空输出目录无效")
    if source.parent != manifest_path.parent or output.parent != source.parent or not source.parent.name.startswith("chenyida_task04_readonly_"):
        fail("READONLY_TASK_ROOT_INVALID", "输入输出不属于同一 TASK04 临时目录")
    if stat.S_IMODE(source.parent.stat().st_mode) != 0o700:
        fail("READONLY_TASK_ROOT_PERMISSION_INVALID", "TASK04 临时目录权限必须为 0700")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("mode") != MODE or manifest.get("tool_version") != TOOL_VERSION or manifest.get("git_commit") != args.git_commit:
        fail("READONLY_MANIFEST_BINDING_MISMATCH", "snapshot manifest 绑定不一致")
    actual_sha = sha256_file(source)
    if actual_sha != args.source_sha256 or actual_sha != manifest.get("snapshot_sha256") or manifest.get("integrity_check") != "ok":
        fail("READONLY_SOURCE_SHA_MISMATCH", "snapshot SHA 或完整性不一致")
    return source, output, manifest


def argument_parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser()
    result.add_argument("--mode", required=True)
    result.add_argument("--confirm", required=True)
    result.add_argument("--source", required=True)
    result.add_argument("--snapshot-manifest", required=True)
    result.add_argument("--source-sha256", required=True)
    result.add_argument("--git-commit", required=True)
    result.add_argument("--tool-version", required=True)
    result.add_argument("--output", required=True)
    result.add_argument("--legacy-app-dir", required=True)
    result.add_argument("--no-materialize", action="store_true")
    result.add_argument("--no-files", action="store_true")
    return result


def main() -> int:
    try:
        args = argument_parser().parse_args()
        source, output, manifest = validate(args)
        connection = sqlite3.connect(f"file:{quote(str(source))}?mode=ro", uri=True)
        try:
            connection.execute("PRAGMA query_only=ON")
            if connection.execute("PRAGMA query_only").fetchone()[0] != 1:
                fail("READONLY_QUERY_ONLY_FAILED", "快照连接未进入 query_only")
            integrity = connection.execute("PRAGMA integrity_check").fetchall()
            if integrity != [("ok",)]: fail("READONLY_INTEGRITY_FAILED", "快照 integrity_check 未通过")
            if schema_fingerprint(connection) != manifest["schema_fingerprint"]:
                fail("READONLY_SCHEMA_FINGERPRINT_MISMATCH", "Schema fingerprint 不匹配")
            actual = schema_inventory(connection)
            expected = expected_schema(Path(args.legacy_app_dir))
            reports = build_reports(connection, actual, expected, manifest)
        finally:
            connection.close()
        for name, report in zip(REPORT_NAMES, reports):
            write_json(output, name, report)
        summary = {
            "state": "REAL_READONLY_INVENTORY_COMPLETE", "source_schema_fingerprint": manifest["schema_fingerprint"],
            "source_snapshot_sha256": manifest["snapshot_sha256"], "table_count": reports[0]["actual_table_count"],
            "total_records": reports[3]["total_records"], "dry_run": reports[3],
            "domain_counts": reports[2]["domains"], "manual_disposition_count": len(reports[4]["items"]),
            "schema_summary": {"actual_table_count": reports[0]["actual_table_count"], "expected_table_count": reports[0]["expected_table_count"], "missing_tables": reports[0]["missing_tables"], "extra_tables": reports[0]["extra_tables"], "column_drift": reports[0]["column_drift"], "table_row_counts": reports[0]["table_row_counts"], "migration_records": reports[0]["migration_records"]},
            "mapping_summary": reports[1],
            "reports": list(REPORT_NAMES),
        }
        safe_leaf_scan(summary)
        print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
        return 0
    except InventoryError as error:
        print(json.dumps({"error": {"code": error.code, "message": str(error)}}, ensure_ascii=False), file=sys.stderr)
        return 1
    except Exception:
        print(json.dumps({"error": {"code": "READONLY_INTERNAL_ERROR", "message": "脱敏只读盘点失败"}}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
