import argparse
import csv
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import sqlite3
import sys
import tempfile
import time
from contextlib import closing
from datetime import datetime
from difflib import SequenceMatcher
from http import HTTPStatus
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse


APP_DIR = Path(__file__).resolve().parent
WORKSPACE = APP_DIR.parent
STATIC_DIR = APP_DIR / "static"
DATA_DIR = APP_DIR / "data"
BACKUP_DIR = DATA_DIR / "backups"
TEMPLATE_DIR = WORKSPACE / "物料主数据治理落地包" / "templates"
DB_PATH = Path(os.environ.get("CYD_ERP_DB", DATA_DIR / "erp.sqlite3"))
SESSION_COOKIE = "CYD_ERP_SESSION"
SESSION_TTL_SECONDS = 12 * 60 * 60

DEFAULT_USERS = [
    {"username": "admin", "display_name": "系统管理员", "role": "admin", "password": "admin123"},
    {"username": "manager", "display_name": "经营负责人", "role": "manager", "password": "manager123"},
    {"username": "purchase", "display_name": "采购员", "role": "purchase", "password": "purchase123"},
    {"username": "engineering", "display_name": "工程员", "role": "engineering", "password": "engineering123"},
    {"username": "production", "display_name": "生产计划", "role": "production", "password": "production123"},
    {"username": "warehouse", "display_name": "仓库员", "role": "warehouse", "password": "warehouse123"},
    {"username": "quality", "display_name": "品质员", "role": "quality", "password": "quality123"},
    {"username": "sales", "display_name": "销售员", "role": "sales", "password": "sales123"},
    {"username": "finance", "display_name": "财务员", "role": "finance", "password": "finance123"},
]

ROLE_LABELS = {
    "admin": "系统管理员",
    "manager": "经营负责人",
    "purchase": "采购",
    "engineering": "工程",
    "production": "生产",
    "warehouse": "仓库",
    "quality": "品质",
    "sales": "销售",
    "finance": "财务",
}

ROLE_PERMISSIONS = {
    "admin": {"*"},
    "manager": {"read", "dashboard", "material", "engineering", "purchase", "production", "inventory", "sales", "quality", "finance"},
    "purchase": {"read", "dashboard", "material", "purchase", "inventory"},
    "engineering": {"read", "dashboard", "material", "engineering"},
    "production": {"read", "dashboard", "production"},
    "warehouse": {"read", "dashboard", "inventory"},
    "quality": {"read", "dashboard", "quality"},
    "sales": {"read", "dashboard", "sales"},
    "finance": {"read", "dashboard", "finance"},
}

PUBLIC_API_PATHS = {"/api/health", "/api/session", "/api/login", "/api/logout"}


ITEM_FIELDS = [
    "internal_item_code",
    "item_category",
    "standard_name",
    "item_status",
    "base_uom",
    "brand",
    "mpn",
    "package",
    "value_spec",
    "voltage",
    "tolerance",
    "material",
    "thickness",
    "copper_weight",
    "environmental_level",
    "is_customer_specific",
    "default_inspection_rule",
    "remark",
]

MAPPING_FIELDS = [
    "internal_item_code",
    "supplier_name",
    "supplier_item_name",
    "supplier_item_code",
    "supplier_brand",
    "supplier_mpn",
    "purchase_uom",
    "uom_conversion",
    "min_order_qty",
    "lead_time_days",
    "last_price",
    "match_status",
    "approved_by",
    "approved_date",
]

IMPORT_FIELDS = [
    "import_batch_no",
    "supplier_name",
    "raw_item_name",
    "raw_item_code",
    "raw_spec",
    "raw_brand",
    "raw_mpn",
    "purchase_uom",
    "min_order_qty",
    "lead_time_days",
    "last_price",
    "remark",
]

PRODUCT_FIELDS = [
    "product_code",
    "product_name",
    "customer_name",
    "product_type",
    "product_version",
    "lifecycle_status",
    "layer_count",
    "board_thickness",
    "min_line_width",
    "min_hole",
    "surface_finish",
    "smt_required",
    "engineering_owner",
    "remark",
]

BOM_FIELDS = [
    "bom_code",
    "product_code",
    "bom_version",
    "bom_status",
    "approved_by",
    "remark",
]

BOM_LINE_FIELDS = [
    "bom_id",
    "line_no",
    "internal_item_code",
    "qty_per",
    "uom",
    "process_stage",
    "loss_rate",
    "remark",
]

PURCHASE_ORDER_FIELDS = [
    "po_code",
    "supplier_name",
    "po_status",
    "source_type",
    "source_ref",
    "expected_date",
    "created_by",
    "remark",
]

PURCHASE_ORDER_LINE_FIELDS = [
    "po_id",
    "line_no",
    "internal_item_code",
    "order_qty",
    "uom",
    "unit_price",
    "received_qty",
    "line_status",
    "remark",
]

WORK_ORDER_FIELDS = [
    "work_order_code",
    "bom_id",
    "product_code",
    "order_qty",
    "completed_qty",
    "work_status",
    "planned_start",
    "planned_finish",
    "owner",
    "remark",
]

WORK_ORDER_MATERIAL_FIELDS = [
    "work_order_id",
    "line_no",
    "internal_item_code",
    "required_qty",
    "issued_qty",
    "uom",
    "process_stage",
    "remark",
]

PRODUCTION_REPORT_FIELDS = [
    "work_order_id",
    "report_date",
    "process_stage",
    "good_qty",
    "scrap_qty",
    "operator",
    "remark",
]

SALES_ORDER_FIELDS = [
    "sales_order_code",
    "customer_name",
    "product_code",
    "order_qty",
    "shipped_qty",
    "sales_status",
    "due_date",
    "linked_bom_id",
    "linked_work_order_id",
    "owner",
    "remark",
]

SHIPMENT_FIELDS = [
    "shipment_code",
    "sales_order_id",
    "product_code",
    "finished_item_code",
    "ship_qty",
    "ship_date",
    "receiver",
    "remark",
]

QUALITY_INSPECTION_FIELDS = [
    "inspection_code",
    "inspection_type",
    "ref_type",
    "ref_id",
    "item_code",
    "product_code",
    "inspected_qty",
    "passed_qty",
    "failed_qty",
    "inspection_status",
    "disposition",
    "inspector",
    "inspection_date",
    "responsible_stage",
    "remark",
]

QUALITY_DEFECT_FIELDS = [
    "inspection_id",
    "defect_type",
    "severity",
    "defect_qty",
    "corrective_action",
    "remark",
]


def now_text():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def normalize(value):
    return re.sub(r"\s+", "", (value or "").upper())


def spec_text(value):
    return (value or "").upper().replace("μ", "U")


def remove_package_tokens(value):
    text = spec_text(value)
    return re.sub(r"\b(0201|0402|0603|0805|1206|SOD[- ]?523|QFN|BGA)\b", " ", text)


def parse_category(text):
    value = normalize(text)
    if "UF" in value or "NF" in value or "PF" in value:
        return "CAP"
    if re.search(r"(^|[^A-Z])\d+(\.\d+)?K([^A-Z]|$)", value) or re.search(r"(^|[^A-Z])\d+R([^A-Z]|$)", value):
        return "RES"
    if "CONN" in value or "CONNECTOR" in value or "PITCH" in value:
        return "CON"
    if "PI" in value or "ED" in value or "RA" in value:
        return "PI"
    if "TVS" in value or "SOD" in value:
        return "DIO"
    return ""


def parse_package(text):
    value = normalize(text)
    for pkg in ["0201", "0402", "0603", "0805", "1206", "SOD-523", "SOD523", "QFN", "BGA"]:
        if pkg in value:
            return pkg.replace("SOD523", "SOD-523")
    return ""


def parse_voltage(text):
    value = remove_package_tokens(text)
    match = re.search(r"(?<![A-Z0-9.])(\d+(?:\.\d+)?)\s*V\b", value)
    return f"{match.group(1)}V" if match else ""


def parse_value(text):
    value = remove_package_tokens(text)
    match = re.search(r"(?<![A-Z0-9.])(\d+(?:\.\d+)?)\s*(UF|NF|PF)\b", value)
    if match:
        return f"{match.group(1)}{match.group(2)}"
    match = re.search(r"(?<![A-Z0-9.])(\d+(?:\.\d+)?)\s*(K|R|M)\b", value)
    if match:
        return f"{match.group(1)}{match.group(2)}"
    match = re.search(r"(?<![A-Z0-9.])(\d+(?:\.\d+)?)\s*(PITCH|P)\s*(\d+)\s*PIN\b", value)
    if match:
        return f"{match.group(1)}PITCH{match.group(3)}PIN"
    return ""


def parse_tolerance(text):
    match = re.search(r"(?<![A-Z0-9.])(\d+(?:\.\d+)?)\s*%", spec_text(text))
    return f"{match.group(1)}%" if match else ""


def similarity(left, right):
    return SequenceMatcher(None, normalize(left), normalize(right)).ratio()


def score_candidate(raw, master):
    score = 0.0
    raw_text = " ".join([
        raw.get("raw_item_name", ""),
        raw.get("raw_spec", ""),
        raw.get("raw_mpn", ""),
    ])
    master_text = " ".join([
        master.get("standard_name", ""),
        master.get("package", ""),
        master.get("value_spec", ""),
        master.get("voltage", ""),
        master.get("mpn", ""),
    ])
    if parse_category(raw_text) and parse_category(raw_text) == master.get("item_category", ""):
        score += 0.25
    if parse_package(raw_text) and parse_package(raw_text) == master.get("package", ""):
        score += 0.25
    if parse_value(raw_text) and normalize(parse_value(raw_text)) == normalize(master.get("value_spec", "")):
        score += 0.25
    if parse_voltage(raw_text) and normalize(parse_voltage(raw_text)) == normalize(master.get("voltage", "")):
        score += 0.15
    if parse_tolerance(raw_text) and normalize(parse_tolerance(raw_text)) == normalize(master.get("tolerance", "")):
        score += 0.10
    score += min(0.10, similarity(raw_text, master_text) * 0.10)
    return round(min(score, 1.0), 2)


def classify(score):
    if score >= 0.85:
        return "自动匹配"
    if score >= 0.55:
        return "疑似匹配"
    return "新物料"


def db_connect():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 180000).hex()
    return f"pbkdf2_sha256${salt}${digest}"


def verify_password(password, stored_hash):
    try:
        algorithm, salt, expected = stored_hash.split("$", 2)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    actual = hash_password(password, salt).split("$", 2)[2]
    return hmac.compare_digest(actual, expected)


def permission_for_request(method, path):
    if path in {"/api/backups", "/api/backups/create", "/api/backups/restore", "/api/users"}:
        return "system"
    if path == "/api/management-dashboard":
        return "dashboard"
    if path == "/api/me/password":
        return "read"
    if method == "GET":
        return "read"
    if path in {"/api/import", "/api/cleaning/confirm", "/api/cleaning/create-item"}:
        return "material"
    if path in {"/api/products", "/api/boms", "/api/bom-lines"}:
        return "engineering"
    if path in {"/api/purchase-orders", "/api/purchase-orders/from-shortage", "/api/purchase-receive"}:
        return "purchase"
    if path == "/api/inventory-adjustments":
        return "inventory"
    if path in {"/api/work-orders/from-bom", "/api/work-orders/issue-materials", "/api/work-orders/complete"}:
        return "production"
    if path in {"/api/sales-orders", "/api/shipments/from-order"}:
        return "sales"
    if path == "/api/quality-inspections":
        return "quality"
    if path in {"/api/financial-documents/from-sales-order", "/api/financial-documents/from-purchase-order", "/api/financial-payments"}:
        return "finance"
    return "read"


def user_can(user, permission):
    permissions = ROLE_PERMISSIONS.get(user.get("role", ""), set())
    return "*" in permissions or permission in permissions


def public_user(row):
    if not row:
        return None
    role = row["role"]
    permissions = ROLE_PERMISSIONS.get(role, set())
    return {
        "username": row["username"],
        "display_name": row["display_name"],
        "role": role,
        "role_label": ROLE_LABELS.get(role, role),
        "is_active": bool(row["is_active"]),
        "last_login_at": row["last_login_at"] or "",
        "permissions": sorted(permissions),
    }


def parse_cookie(header_value):
    cookies = {}
    for chunk in (header_value or "").split(";"):
        if "=" not in chunk:
            continue
        key, value = chunk.strip().split("=", 1)
        cookies[key] = value
    return cookies


def current_user_from_token(conn, token):
    if not token:
        return None
    conn.execute("DELETE FROM app_sessions WHERE expires_at <= ?", (int(time.time()),))
    conn.commit()
    row = conn.execute(
        """
        SELECT u.*
        FROM app_sessions s
        JOIN app_users u ON u.username = s.username
        WHERE s.session_token = ? AND s.expires_at > ? AND u.is_active = 1
        """,
        (token, int(time.time())),
    ).fetchone()
    return public_user(row)


def session_cookie(token, max_age=SESSION_TTL_SECONDS):
    return f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}"


def clear_session_cookie():
    return f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"


def login_user(conn, username, password):
    row = conn.execute("SELECT * FROM app_users WHERE username = ? AND is_active = 1", (username,)).fetchone()
    if not row or not verify_password(password, row["password_hash"]):
        return None
    token = secrets.token_urlsafe(32)
    timestamp = now_text()
    expires_at = int(time.time()) + SESSION_TTL_SECONDS
    conn.execute("DELETE FROM app_sessions WHERE username = ? OR expires_at <= ?", (username, int(time.time())))
    conn.execute(
        "INSERT INTO app_sessions (session_token, username, expires_at, created_at) VALUES (?, ?, ?, ?)",
        (token, username, expires_at, timestamp),
    )
    conn.execute("UPDATE app_users SET last_login_at = ?, updated_at = ? WHERE username = ?", (timestamp, timestamp, username))
    conn.execute("INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)", ("用户登录", username, timestamp))
    conn.commit()
    return {"token": token, "expires_at": expires_at, "user": public_user(row)}


def logout_user(conn, token):
    if token:
        conn.execute("DELETE FROM app_sessions WHERE session_token = ?", (token,))
        conn.commit()


def change_user_password(conn, username, old_password, new_password):
    if len(new_password or "") < 8:
        raise ValueError("新密码至少 8 位")
    row = conn.execute("SELECT * FROM app_users WHERE username = ? AND is_active = 1", (username,)).fetchone()
    if not row or not verify_password(old_password or "", row["password_hash"]):
        raise ValueError("原密码不正确")
    timestamp = now_text()
    conn.execute(
        "UPDATE app_users SET password_hash = ?, updated_at = ? WHERE username = ?",
        (hash_password(new_password), timestamp, username),
    )
    conn.execute("DELETE FROM app_sessions WHERE username = ? AND session_token NOT IN (SELECT session_token FROM app_sessions WHERE username = ? ORDER BY created_at DESC LIMIT 1)", (username, username))
    conn.execute("INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)", ("修改密码", username, timestamp))
    conn.commit()


def create_schema(conn):
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS items (
            internal_item_code TEXT PRIMARY KEY,
            item_category TEXT NOT NULL,
            standard_name TEXT NOT NULL,
            item_status TEXT NOT NULL DEFAULT '启用',
            base_uom TEXT NOT NULL DEFAULT 'PCS',
            brand TEXT DEFAULT '',
            mpn TEXT DEFAULT '',
            package TEXT DEFAULT '',
            value_spec TEXT DEFAULT '',
            voltage TEXT DEFAULT '',
            tolerance TEXT DEFAULT '',
            material TEXT DEFAULT '',
            thickness TEXT DEFAULT '',
            copper_weight TEXT DEFAULT '',
            environmental_level TEXT DEFAULT '',
            is_customer_specific TEXT DEFAULT 'N',
            default_inspection_rule TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS supplier_mappings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            internal_item_code TEXT NOT NULL,
            supplier_name TEXT NOT NULL,
            supplier_item_name TEXT NOT NULL,
            supplier_item_code TEXT DEFAULT '',
            supplier_brand TEXT DEFAULT '',
            supplier_mpn TEXT DEFAULT '',
            purchase_uom TEXT DEFAULT 'PCS',
            uom_conversion TEXT DEFAULT '1',
            min_order_qty TEXT DEFAULT '',
            lead_time_days TEXT DEFAULT '',
            last_price TEXT DEFAULT '',
            match_status TEXT NOT NULL DEFAULT '已确认',
            approved_by TEXT DEFAULT '',
            approved_date TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(supplier_name, supplier_item_code, internal_item_code)
        );

        CREATE TABLE IF NOT EXISTS cleaning_rows (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            import_batch_no TEXT NOT NULL,
            supplier_name TEXT NOT NULL,
            raw_item_name TEXT NOT NULL,
            raw_item_code TEXT DEFAULT '',
            raw_spec TEXT DEFAULT '',
            raw_brand TEXT DEFAULT '',
            raw_mpn TEXT DEFAULT '',
            purchase_uom TEXT DEFAULT 'PCS',
            min_order_qty TEXT DEFAULT '',
            lead_time_days TEXT DEFAULT '',
            last_price TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            parsed_category TEXT DEFAULT '',
            parsed_package TEXT DEFAULT '',
            parsed_value TEXT DEFAULT '',
            parsed_voltage TEXT DEFAULT '',
            candidate_internal_code TEXT DEFAULT '',
            candidate_standard_name TEXT DEFAULT '',
            match_level TEXT NOT NULL,
            confidence REAL DEFAULT 0,
            owner_role TEXT NOT NULL,
            process_status TEXT NOT NULL DEFAULT '待处理',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            detail TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_users (
            username TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            role TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_login_at TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS app_sessions (
            session_token TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS products (
            product_code TEXT PRIMARY KEY,
            product_name TEXT NOT NULL,
            customer_name TEXT DEFAULT '',
            product_type TEXT NOT NULL DEFAULT 'FPC',
            product_version TEXT NOT NULL DEFAULT 'A0',
            lifecycle_status TEXT NOT NULL DEFAULT '样品',
            layer_count TEXT DEFAULT '',
            board_thickness TEXT DEFAULT '',
            min_line_width TEXT DEFAULT '',
            min_hole TEXT DEFAULT '',
            surface_finish TEXT DEFAULT '',
            smt_required TEXT DEFAULT 'N',
            engineering_owner TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS product_boms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bom_code TEXT NOT NULL UNIQUE,
            product_code TEXT NOT NULL,
            bom_version TEXT NOT NULL DEFAULT 'A0',
            bom_status TEXT NOT NULL DEFAULT '草稿',
            approved_by TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS bom_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bom_id INTEGER NOT NULL,
            line_no INTEGER NOT NULL,
            internal_item_code TEXT NOT NULL,
            qty_per REAL NOT NULL DEFAULT 1,
            uom TEXT NOT NULL DEFAULT 'PCS',
            process_stage TEXT DEFAULT '',
            loss_rate REAL NOT NULL DEFAULT 0,
            remark TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(bom_id, line_no)
        );

        CREATE TABLE IF NOT EXISTS inventory_balances (
            internal_item_code TEXT PRIMARY KEY,
            on_hand_qty REAL NOT NULL DEFAULT 0,
            reserved_qty REAL NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS purchase_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            po_code TEXT NOT NULL UNIQUE,
            supplier_name TEXT NOT NULL,
            po_status TEXT NOT NULL DEFAULT '待收货',
            source_type TEXT DEFAULT '',
            source_ref TEXT DEFAULT '',
            expected_date TEXT DEFAULT '',
            created_by TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS purchase_order_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            po_id INTEGER NOT NULL,
            line_no INTEGER NOT NULL,
            internal_item_code TEXT NOT NULL,
            order_qty REAL NOT NULL DEFAULT 0,
            uom TEXT NOT NULL DEFAULT 'PCS',
            unit_price REAL NOT NULL DEFAULT 0,
            received_qty REAL NOT NULL DEFAULT 0,
            line_status TEXT NOT NULL DEFAULT '待收货',
            remark TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(po_id, line_no)
        );

        CREATE TABLE IF NOT EXISTS inventory_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            internal_item_code TEXT NOT NULL,
            txn_type TEXT NOT NULL,
            qty REAL NOT NULL,
            ref_type TEXT DEFAULT '',
            ref_no TEXT DEFAULT '',
            before_qty REAL NOT NULL DEFAULT 0,
            after_qty REAL NOT NULL DEFAULT 0,
            remark TEXT DEFAULT '',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS inventory_adjustments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            adjustment_code TEXT NOT NULL UNIQUE,
            internal_item_code TEXT NOT NULL,
            counted_qty REAL NOT NULL DEFAULT 0,
            before_qty REAL NOT NULL DEFAULT 0,
            delta_qty REAL NOT NULL DEFAULT 0,
            after_qty REAL NOT NULL DEFAULT 0,
            reason TEXT DEFAULT '',
            adjusted_by TEXT DEFAULT '',
            adjusted_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS work_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            work_order_code TEXT NOT NULL UNIQUE,
            bom_id INTEGER NOT NULL,
            product_code TEXT NOT NULL,
            order_qty REAL NOT NULL DEFAULT 0,
            completed_qty REAL NOT NULL DEFAULT 0,
            work_status TEXT NOT NULL DEFAULT '待领料',
            planned_start TEXT DEFAULT '',
            planned_finish TEXT DEFAULT '',
            owner TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS work_order_materials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            work_order_id INTEGER NOT NULL,
            line_no INTEGER NOT NULL,
            internal_item_code TEXT NOT NULL,
            required_qty REAL NOT NULL DEFAULT 0,
            issued_qty REAL NOT NULL DEFAULT 0,
            uom TEXT NOT NULL DEFAULT 'PCS',
            process_stage TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(work_order_id, line_no)
        );

        CREATE TABLE IF NOT EXISTS production_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            work_order_id INTEGER NOT NULL,
            report_date TEXT NOT NULL,
            process_stage TEXT DEFAULT '',
            good_qty REAL NOT NULL DEFAULT 0,
            scrap_qty REAL NOT NULL DEFAULT 0,
            operator TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sales_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sales_order_code TEXT NOT NULL UNIQUE,
            customer_name TEXT NOT NULL,
            product_code TEXT NOT NULL,
            order_qty REAL NOT NULL DEFAULT 0,
            shipped_qty REAL NOT NULL DEFAULT 0,
            sales_status TEXT NOT NULL DEFAULT '待生产',
            due_date TEXT DEFAULT '',
            linked_bom_id INTEGER DEFAULT 0,
            linked_work_order_id INTEGER DEFAULT 0,
            owner TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS shipments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shipment_code TEXT NOT NULL UNIQUE,
            sales_order_id INTEGER NOT NULL,
            product_code TEXT NOT NULL,
            finished_item_code TEXT NOT NULL,
            ship_qty REAL NOT NULL DEFAULT 0,
            ship_date TEXT NOT NULL,
            receiver TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS quality_inspections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inspection_code TEXT NOT NULL UNIQUE,
            inspection_type TEXT NOT NULL,
            ref_type TEXT DEFAULT '',
            ref_id INTEGER DEFAULT 0,
            item_code TEXT DEFAULT '',
            product_code TEXT DEFAULT '',
            inspected_qty REAL NOT NULL DEFAULT 0,
            passed_qty REAL NOT NULL DEFAULT 0,
            failed_qty REAL NOT NULL DEFAULT 0,
            inspection_status TEXT NOT NULL DEFAULT '待判定',
            disposition TEXT DEFAULT '',
            inspector TEXT DEFAULT '',
            inspection_date TEXT NOT NULL,
            responsible_stage TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS quality_defects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inspection_id INTEGER NOT NULL,
            defect_type TEXT NOT NULL,
            severity TEXT DEFAULT '',
            defect_qty REAL NOT NULL DEFAULT 0,
            corrective_action TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS financial_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_code TEXT NOT NULL UNIQUE,
            doc_type TEXT NOT NULL,
            counterparty TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_id INTEGER NOT NULL,
            source_code TEXT NOT NULL,
            total_amount REAL NOT NULL DEFAULT 0,
            paid_amount REAL NOT NULL DEFAULT 0,
            doc_status TEXT NOT NULL DEFAULT '未结清',
            due_date TEXT DEFAULT '',
            created_by TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(doc_type, source_type, source_id)
        );

        CREATE TABLE IF NOT EXISTS financial_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            payment_code TEXT NOT NULL UNIQUE,
            payment_type TEXT NOT NULL,
            doc_id INTEGER NOT NULL,
            amount REAL NOT NULL DEFAULT 0,
            payment_date TEXT NOT NULL,
            account_name TEXT DEFAULT '',
            handled_by TEXT DEFAULT '',
            remark TEXT DEFAULT '',
            created_at TEXT NOT NULL
        );
        """
    )
    conn.commit()


def read_csv_file(path):
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        return [dict(row) for row in csv.DictReader(file)]


def insert_item(conn, row):
    data = {field: row.get(field, "") for field in ITEM_FIELDS}
    data["item_status"] = data["item_status"] or "启用"
    data["base_uom"] = data["base_uom"] or "PCS"
    timestamp = now_text()
    conn.execute(
        f"""
        INSERT OR IGNORE INTO items ({",".join(ITEM_FIELDS)}, created_at, updated_at)
        VALUES ({",".join(["?"] * len(ITEM_FIELDS))}, ?, ?)
        """,
        [data[field] for field in ITEM_FIELDS] + [timestamp, timestamp],
    )


def insert_mapping(conn, row):
    data = {field: row.get(field, "") for field in MAPPING_FIELDS}
    data["purchase_uom"] = data["purchase_uom"] or "PCS"
    data["match_status"] = data["match_status"] or "已确认"
    data["approved_date"] = data["approved_date"] or datetime.now().strftime("%Y-%m-%d")
    timestamp = now_text()
    conn.execute(
        f"""
        INSERT OR IGNORE INTO supplier_mappings ({",".join(MAPPING_FIELDS)}, created_at, updated_at)
        VALUES ({",".join(["?"] * len(MAPPING_FIELDS))}, ?, ?)
        """,
        [data[field] for field in MAPPING_FIELDS] + [timestamp, timestamp],
    )


def insert_product(conn, row):
    data = {field: row.get(field, "") for field in PRODUCT_FIELDS}
    data["product_type"] = data["product_type"] or "FPC"
    data["product_version"] = data["product_version"] or "A0"
    data["lifecycle_status"] = data["lifecycle_status"] or "样品"
    data["smt_required"] = data["smt_required"] or "N"
    timestamp = now_text()
    conn.execute(
        f"""
        INSERT OR IGNORE INTO products ({",".join(PRODUCT_FIELDS)}, created_at, updated_at)
        VALUES ({",".join(["?"] * len(PRODUCT_FIELDS))}, ?, ?)
        """,
        [data[field] for field in PRODUCT_FIELDS] + [timestamp, timestamp],
    )


def insert_bom(conn, row):
    data = {field: row.get(field, "") for field in BOM_FIELDS}
    data["bom_version"] = data["bom_version"] or "A0"
    data["bom_status"] = data["bom_status"] or "草稿"
    timestamp = now_text()
    cursor = conn.execute(
        f"""
        INSERT OR IGNORE INTO product_boms ({",".join(BOM_FIELDS)}, created_at, updated_at)
        VALUES ({",".join(["?"] * len(BOM_FIELDS))}, ?, ?)
        """,
        [data[field] for field in BOM_FIELDS] + [timestamp, timestamp],
    )
    if cursor.lastrowid:
        return cursor.lastrowid
    existing = conn.execute("SELECT id FROM product_boms WHERE bom_code = ?", (data["bom_code"],)).fetchone()
    return existing["id"] if existing else None


def insert_bom_line(conn, row):
    data = {field: row.get(field, "") for field in BOM_LINE_FIELDS}
    data["line_no"] = int(data["line_no"] or 1)
    data["qty_per"] = float(data["qty_per"] or 1)
    data["loss_rate"] = float(data["loss_rate"] or 0)
    data["uom"] = data["uom"] or "PCS"
    timestamp = now_text()
    conn.execute(
        f"""
        INSERT OR REPLACE INTO bom_lines ({",".join(BOM_LINE_FIELDS)}, created_at, updated_at)
        VALUES ({",".join(["?"] * len(BOM_LINE_FIELDS))}, ?, ?)
        """,
        [data[field] for field in BOM_LINE_FIELDS] + [timestamp, timestamp],
    )


def insert_purchase_order(conn, row):
    data = {field: row.get(field, "") for field in PURCHASE_ORDER_FIELDS}
    data["po_status"] = data["po_status"] or "待收货"
    timestamp = now_text()
    cursor = conn.execute(
        f"""
        INSERT INTO purchase_orders ({",".join(PURCHASE_ORDER_FIELDS)}, created_at, updated_at)
        VALUES ({",".join(["?"] * len(PURCHASE_ORDER_FIELDS))}, ?, ?)
        """,
        [data[field] for field in PURCHASE_ORDER_FIELDS] + [timestamp, timestamp],
    )
    return cursor.lastrowid


def insert_purchase_order_line(conn, row):
    data = {field: row.get(field, "") for field in PURCHASE_ORDER_LINE_FIELDS}
    data["line_no"] = int(data["line_no"] or 1)
    data["order_qty"] = float(data["order_qty"] or 0)
    data["unit_price"] = float(data["unit_price"] or 0)
    data["received_qty"] = float(data["received_qty"] or 0)
    data["uom"] = data["uom"] or "PCS"
    data["line_status"] = data["line_status"] or "待收货"
    timestamp = now_text()
    cursor = conn.execute(
        f"""
        INSERT OR REPLACE INTO purchase_order_lines ({",".join(PURCHASE_ORDER_LINE_FIELDS)}, created_at, updated_at)
        VALUES ({",".join(["?"] * len(PURCHASE_ORDER_LINE_FIELDS))}, ?, ?)
        """,
        [data[field] for field in PURCHASE_ORDER_LINE_FIELDS] + [timestamp, timestamp],
    )
    return cursor.lastrowid


def insert_work_order(conn, row):
    data = {field: row.get(field, "") for field in WORK_ORDER_FIELDS}
    data["bom_id"] = int(data["bom_id"] or 0)
    data["order_qty"] = float(data["order_qty"] or 0)
    data["completed_qty"] = float(data["completed_qty"] or 0)
    data["work_status"] = data["work_status"] or "待领料"
    timestamp = now_text()
    cursor = conn.execute(
        f"""
        INSERT INTO work_orders ({",".join(WORK_ORDER_FIELDS)}, created_at, updated_at)
        VALUES ({",".join(["?"] * len(WORK_ORDER_FIELDS))}, ?, ?)
        """,
        [data[field] for field in WORK_ORDER_FIELDS] + [timestamp, timestamp],
    )
    return cursor.lastrowid


def insert_work_order_material(conn, row):
    data = {field: row.get(field, "") for field in WORK_ORDER_MATERIAL_FIELDS}
    data["line_no"] = int(data["line_no"] or 1)
    data["required_qty"] = float(data["required_qty"] or 0)
    data["issued_qty"] = float(data["issued_qty"] or 0)
    data["uom"] = data["uom"] or "PCS"
    timestamp = now_text()
    cursor = conn.execute(
        f"""
        INSERT OR REPLACE INTO work_order_materials ({",".join(WORK_ORDER_MATERIAL_FIELDS)}, created_at, updated_at)
        VALUES ({",".join(["?"] * len(WORK_ORDER_MATERIAL_FIELDS))}, ?, ?)
        """,
        [data[field] for field in WORK_ORDER_MATERIAL_FIELDS] + [timestamp, timestamp],
    )
    return cursor.lastrowid


def insert_sales_order(conn, row):
    data = {field: row.get(field, "") for field in SALES_ORDER_FIELDS}
    data["order_qty"] = float(data["order_qty"] or 0)
    data["shipped_qty"] = float(data["shipped_qty"] or 0)
    data["linked_bom_id"] = int(data["linked_bom_id"] or 0)
    data["linked_work_order_id"] = int(data["linked_work_order_id"] or 0)
    data["sales_status"] = data["sales_status"] or "待生产"
    timestamp = now_text()
    cursor = conn.execute(
        f"""
        INSERT INTO sales_orders ({",".join(SALES_ORDER_FIELDS)}, created_at, updated_at)
        VALUES ({",".join(["?"] * len(SALES_ORDER_FIELDS))}, ?, ?)
        """,
        [data[field] for field in SALES_ORDER_FIELDS] + [timestamp, timestamp],
    )
    return cursor.lastrowid


def insert_quality_inspection(conn, row):
    data = {field: row.get(field, "") for field in QUALITY_INSPECTION_FIELDS}
    data["ref_id"] = int(data["ref_id"] or 0)
    data["inspected_qty"] = float(data["inspected_qty"] or 0)
    data["passed_qty"] = float(data["passed_qty"] or 0)
    data["failed_qty"] = float(data["failed_qty"] or 0)
    data["inspection_date"] = data["inspection_date"] or datetime.now().strftime("%Y-%m-%d")
    data["inspection_status"] = data["inspection_status"] or "待判定"
    timestamp = now_text()
    cursor = conn.execute(
        f"""
        INSERT INTO quality_inspections ({",".join(QUALITY_INSPECTION_FIELDS)}, created_at, updated_at)
        VALUES ({",".join(["?"] * len(QUALITY_INSPECTION_FIELDS))}, ?, ?)
        """,
        [data[field] for field in QUALITY_INSPECTION_FIELDS] + [timestamp, timestamp],
    )
    return cursor.lastrowid


def insert_quality_defect(conn, row):
    data = {field: row.get(field, "") for field in QUALITY_DEFECT_FIELDS}
    data["inspection_id"] = int(data["inspection_id"] or 0)
    data["defect_qty"] = float(data["defect_qty"] or 0)
    timestamp = now_text()
    cursor = conn.execute(
        f"""
        INSERT INTO quality_defects ({",".join(QUALITY_DEFECT_FIELDS)}, created_at)
        VALUES ({",".join(["?"] * len(QUALITY_DEFECT_FIELDS))}, ?)
        """,
        [data[field] for field in QUALITY_DEFECT_FIELDS] + [timestamp],
    )
    return cursor.lastrowid


def seed_from_templates(conn):
    item_count = conn.execute("SELECT COUNT(*) FROM items").fetchone()[0]
    if item_count == 0:
        for row in read_csv_file(TEMPLATE_DIR / "内部标准物料库.csv"):
            insert_item(conn, row)
    mapping_count = conn.execute("SELECT COUNT(*) FROM supplier_mappings").fetchone()[0]
    if mapping_count == 0:
        for row in read_csv_file(TEMPLATE_DIR / "供应商物料映射表.csv"):
            insert_mapping(conn, row)
    product_count = conn.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    if product_count == 0:
        insert_product(conn, {
            "product_code": "CYD-FPC-DEMO-001",
            "product_name": "侧键 FPCA 示例",
            "customer_name": "样品客户",
            "product_type": "FPC+SMT",
            "product_version": "A0",
            "lifecycle_status": "样品",
            "layer_count": "2",
            "board_thickness": "0.13mm",
            "min_line_width": "0.10mm",
            "min_hole": "0.15mm",
            "surface_finish": "化学镍金",
            "smt_required": "Y",
            "engineering_owner": "工程部",
            "remark": "系统示例，可作为首个真实产品录入参考",
        })
    bom_count = conn.execute("SELECT COUNT(*) FROM product_boms").fetchone()[0]
    if bom_count == 0:
        bom_id = insert_bom(conn, {
            "bom_code": "BOM-CYD-FPC-DEMO-001-A0",
            "product_code": "CYD-FPC-DEMO-001",
            "bom_version": "A0",
            "bom_status": "草稿",
            "approved_by": "",
            "remark": "系统示例 BOM",
        })
        if bom_id:
            insert_bom_line(conn, {
                "bom_id": bom_id,
                "line_no": 10,
                "internal_item_code": "CYD-CAP-000001",
                "qty_per": 2,
                "uom": "PCS",
                "process_stage": "SMT",
                "loss_rate": 0.03,
                "remark": "贴片电容",
            })
            insert_bom_line(conn, {
                "bom_id": bom_id,
                "line_no": 20,
                "internal_item_code": "CYD-RES-000001",
                "qty_per": 1,
                "uom": "PCS",
                "process_stage": "SMT",
                "loss_rate": 0.02,
                "remark": "贴片电阻",
            })
            insert_bom_line(conn, {
                "bom_id": bom_id,
                "line_no": 30,
                "internal_item_code": "CYD-PI-000001",
                "qty_per": 0.02,
                "uom": "M2",
                "process_stage": "FPC",
                "loss_rate": 0.08,
                "remark": "FPC 基材",
            })
    inventory_count = conn.execute("SELECT COUNT(*) FROM inventory_balances").fetchone()[0]
    if inventory_count == 0:
        timestamp = now_text()
        for code, qty in [
            ("CYD-CAP-000001", 10000),
            ("CYD-RES-000001", 8000),
            ("CYD-PI-000001", 10),
            ("CYD-CON-000001", 2000),
        ]:
            conn.execute(
                "INSERT OR IGNORE INTO inventory_balances (internal_item_code, on_hand_qty, reserved_qty, updated_at) VALUES (?, ?, 0, ?)",
                (code, qty, timestamp),
            )
    conn.commit()


def seed_default_users(conn):
    timestamp = now_text()
    for user in DEFAULT_USERS:
        exists = conn.execute("SELECT username FROM app_users WHERE username = ?", (user["username"],)).fetchone()
        if exists:
            continue
        conn.execute(
            """
            INSERT INTO app_users (username, display_name, role, password_hash, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
            """,
            (
                user["username"],
                user["display_name"],
                user["role"],
                hash_password(user["password"]),
                timestamp,
                timestamp,
            ),
        )
    conn.commit()


def init_db():
    with closing(db_connect()) as conn:
        create_schema(conn)
        seed_from_templates(conn)
        seed_default_users(conn)


def fetch_items(conn):
    rows = conn.execute("SELECT * FROM items ORDER BY internal_item_code").fetchall()
    return [dict(row) for row in rows]


def fetch_mappings(conn):
    rows = conn.execute("SELECT * FROM supplier_mappings ORDER BY supplier_name, supplier_item_code, id").fetchall()
    return [dict(row) for row in rows]


def fetch_products(conn):
    rows = conn.execute("SELECT * FROM products ORDER BY updated_at DESC, product_code").fetchall()
    return [dict(row) for row in rows]


def fetch_boms(conn):
    rows = conn.execute(
        """
        SELECT b.*, p.product_name, p.customer_name, p.product_type
        FROM product_boms b
        LEFT JOIN products p ON p.product_code = b.product_code
        ORDER BY b.updated_at DESC, b.id DESC
        """
    ).fetchall()
    return [dict(row) for row in rows]


def fetch_bom_lines(conn, bom_id):
    rows = conn.execute(
        """
        SELECT l.*, i.standard_name, i.item_category, COALESCE(inv.on_hand_qty, 0) AS on_hand_qty, COALESCE(inv.reserved_qty, 0) AS reserved_qty
        FROM bom_lines l
        LEFT JOIN items i ON i.internal_item_code = l.internal_item_code
        LEFT JOIN inventory_balances inv ON inv.internal_item_code = l.internal_item_code
        WHERE l.bom_id = ?
        ORDER BY l.line_no
        """,
        (bom_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def bom_readiness(conn, bom_id, order_qty):
    lines = fetch_bom_lines(conn, bom_id)
    result = []
    all_ready = True
    for line in lines:
        qty_per = float(line.get("qty_per") or 0)
        loss_rate = float(line.get("loss_rate") or 0)
        required_qty = round(qty_per * float(order_qty) * (1 + loss_rate), 6)
        available_qty = float(line.get("on_hand_qty") or 0) - float(line.get("reserved_qty") or 0)
        shortage_qty = round(max(0, required_qty - available_qty), 6)
        status = "齐套" if shortage_qty <= 0 else "缺料"
        if shortage_qty > 0:
            all_ready = False
        result.append({
            **line,
            "required_qty": required_qty,
            "available_qty": available_qty,
            "shortage_qty": shortage_qty,
            "readiness_status": status,
        })
    return {"all_ready": all_ready, "order_qty": order_qty, "rows": result}


def preferred_supplier(conn, internal_item_code):
    row = conn.execute(
        """
        SELECT supplier_name, last_price, lead_time_days, purchase_uom
        FROM supplier_mappings
        WHERE internal_item_code = ? AND match_status = '已确认'
        ORDER BY
            CASE WHEN last_price = '' THEN 1 ELSE 0 END,
            CAST(NULLIF(last_price, '') AS REAL),
            id
        LIMIT 1
        """,
        (internal_item_code,),
    ).fetchone()
    if not row:
        return {
            "supplier_name": "未指定供应商",
            "last_price": "",
            "lead_time_days": "",
            "purchase_uom": "",
        }
    return dict(row)


def purchase_suggestions(conn, bom_id, order_qty):
    readiness = bom_readiness(conn, bom_id, order_qty)
    suggestions = []
    for row in readiness["rows"]:
        if float(row.get("shortage_qty") or 0) <= 0:
            continue
        supplier = preferred_supplier(conn, row["internal_item_code"])
        suggestions.append({
            "internal_item_code": row["internal_item_code"],
            "standard_name": row["standard_name"],
            "item_category": row["item_category"],
            "shortage_qty": row["shortage_qty"],
            "uom": supplier.get("purchase_uom") or row["uom"],
            "supplier_name": supplier["supplier_name"],
            "last_price": supplier.get("last_price", ""),
            "lead_time_days": supplier.get("lead_time_days", ""),
            "process_stage": row.get("process_stage", ""),
        })
    return {
        "bom_id": bom_id,
        "order_qty": order_qty,
        "suggestions": suggestions,
    }


def generate_po_code(conn):
    prefix = f"PO-{datetime.now().strftime('%Y%m%d')}"
    count = conn.execute("SELECT COUNT(*) FROM purchase_orders WHERE po_code LIKE ?", (f"{prefix}%",)).fetchone()[0]
    return f"{prefix}-{count + 1:03d}"


def create_purchase_orders_from_shortage(conn, bom_id, order_qty, created_by="系统用户"):
    suggestion_result = purchase_suggestions(conn, bom_id, order_qty)
    grouped = {}
    for suggestion in suggestion_result["suggestions"]:
        grouped.setdefault(suggestion["supplier_name"], []).append(suggestion)

    created = []
    for supplier_name, rows in grouped.items():
        po_code = generate_po_code(conn)
        po_id = insert_purchase_order(conn, {
            "po_code": po_code,
            "supplier_name": supplier_name,
            "po_status": "待收货",
            "source_type": "BOM缺料",
            "source_ref": f"bom_id={bom_id};order_qty={order_qty}",
            "created_by": created_by,
            "remark": "由齐套缺料自动生成",
        })
        for index, row in enumerate(rows, start=1):
            insert_purchase_order_line(conn, {
                "po_id": po_id,
                "line_no": index * 10,
                "internal_item_code": row["internal_item_code"],
                "order_qty": row["shortage_qty"],
                "uom": row["uom"],
                "unit_price": row.get("last_price") or 0,
                "received_qty": 0,
                "line_status": "待收货",
                "remark": row.get("standard_name", ""),
            })
        created.append({"po_id": po_id, "po_code": po_code, "supplier_name": supplier_name, "line_count": len(rows)})
    conn.execute("INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)", ("生成缺料采购单", json.dumps(created, ensure_ascii=False), now_text()))
    conn.commit()
    return {"created": created, "suggestions": suggestion_result["suggestions"]}


def fetch_inventory(conn):
    rows = conn.execute(
        """
        SELECT i.internal_item_code, i.standard_name, i.item_category, i.base_uom,
               COALESCE(inv.on_hand_qty, 0) AS on_hand_qty,
               COALESCE(inv.reserved_qty, 0) AS reserved_qty,
               COALESCE(inv.on_hand_qty, 0) - COALESCE(inv.reserved_qty, 0) AS available_qty,
               COALESCE(inv.updated_at, '') AS updated_at
        FROM items i
        LEFT JOIN inventory_balances inv ON inv.internal_item_code = i.internal_item_code
        ORDER BY i.internal_item_code
        """
    ).fetchall()
    return [dict(row) for row in rows]


def generate_inventory_adjustment_code(conn):
    prefix = f"IA-{datetime.now().strftime('%Y%m%d')}"
    count = conn.execute("SELECT COUNT(*) FROM inventory_adjustments WHERE adjustment_code LIKE ?", (f"{prefix}%",)).fetchone()[0]
    return f"{prefix}-{count + 1:03d}"


def fetch_inventory_adjustments(conn, limit=200):
    rows = conn.execute(
        """
        SELECT ia.*, i.standard_name, i.base_uom, i.item_category
        FROM inventory_adjustments ia
        LEFT JOIN items i ON i.internal_item_code = ia.internal_item_code
        ORDER BY ia.created_at DESC, ia.id DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [dict(row) for row in rows]


def create_inventory_adjustment(conn, row):
    item_code = row.get("internal_item_code", "")
    if not item_code:
        raise ValueError("请选择物料")
    item = conn.execute("SELECT internal_item_code FROM items WHERE internal_item_code = ?", (item_code,)).fetchone()
    if not item:
        raise ValueError("内部物料不存在")
    counted_qty = float(row.get("counted_qty") or 0)
    if counted_qty < 0:
        raise ValueError("实盘数量不能小于 0")
    balance = conn.execute("SELECT * FROM inventory_balances WHERE internal_item_code = ?", (item_code,)).fetchone()
    before_qty = float(balance["on_hand_qty"]) if balance else 0.0
    delta_qty = round(counted_qty - before_qty, 6)
    adjustment_code = row.get("adjustment_code") or generate_inventory_adjustment_code(conn)
    reason = row.get("reason", "")
    adjusted_by = row.get("adjusted_by", "")
    timestamp = now_text()
    stock_result = change_inventory(conn, item_code, delta_qty, "库存盘点", "盘点单", adjustment_code, reason)
    conn.execute(
        """
        INSERT INTO inventory_adjustments (
            adjustment_code, internal_item_code, counted_qty, before_qty, delta_qty,
            after_qty, reason, adjusted_by, adjusted_at, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            adjustment_code,
            item_code,
            counted_qty,
            before_qty,
            delta_qty,
            stock_result["after_qty"],
            reason,
            adjusted_by,
            timestamp,
            timestamp,
        ),
    )
    conn.execute("INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)", ("库存盘点", f"{adjustment_code};{item_code};差异={delta_qty}", timestamp))
    conn.commit()
    return {"ok": True, "adjustment_code": adjustment_code, "delta_qty": delta_qty, **stock_result}


def fetch_purchase_orders(conn):
    rows = conn.execute(
        """
        SELECT po.*,
               COUNT(pol.id) AS line_count,
               COALESCE(SUM(pol.order_qty), 0) AS total_order_qty,
               COALESCE(SUM(pol.received_qty), 0) AS total_received_qty
        FROM purchase_orders po
        LEFT JOIN purchase_order_lines pol ON pol.po_id = po.id
        GROUP BY po.id
        ORDER BY po.created_at DESC, po.id DESC
        """
    ).fetchall()
    return [dict(row) for row in rows]


def fetch_purchase_order_lines(conn, po_id=None):
    where_sql = ""
    params = ()
    if po_id:
        where_sql = "WHERE pol.po_id = ?"
        params = (po_id,)
    rows = conn.execute(
        f"""
        SELECT pol.*, po.po_code, po.supplier_name, po.po_status, i.standard_name, i.item_category
        FROM purchase_order_lines pol
        LEFT JOIN purchase_orders po ON po.id = pol.po_id
        LEFT JOIN items i ON i.internal_item_code = pol.internal_item_code
        {where_sql}
        ORDER BY po.created_at DESC, po.id DESC, pol.line_no
        """,
        params,
    ).fetchall()
    return [dict(row) for row in rows]


def receive_purchase_line(conn, line_id, receive_qty):
    line = conn.execute("SELECT * FROM purchase_order_lines WHERE id = ?", (line_id,)).fetchone()
    if not line:
        raise ValueError("采购明细不存在")
    receive_qty = float(receive_qty or 0)
    if receive_qty <= 0:
        raise ValueError("收货数量必须大于 0")
    remaining_qty = float(line["order_qty"]) - float(line["received_qty"])
    if receive_qty > remaining_qty + 1e-9:
        raise ValueError("收货数量不能超过未收数量")

    item_code = line["internal_item_code"]
    balance = conn.execute("SELECT * FROM inventory_balances WHERE internal_item_code = ?", (item_code,)).fetchone()
    before_qty = float(balance["on_hand_qty"]) if balance else 0.0
    after_qty = before_qty + receive_qty
    timestamp = now_text()
    if balance:
        conn.execute(
            "UPDATE inventory_balances SET on_hand_qty = ?, updated_at = ? WHERE internal_item_code = ?",
            (after_qty, timestamp, item_code),
        )
    else:
        conn.execute(
            "INSERT INTO inventory_balances (internal_item_code, on_hand_qty, reserved_qty, updated_at) VALUES (?, ?, 0, ?)",
            (item_code, after_qty, timestamp),
        )

    new_received = float(line["received_qty"]) + receive_qty
    line_status = "已收货" if new_received >= float(line["order_qty"]) - 1e-9 else "部分收货"
    conn.execute(
        "UPDATE purchase_order_lines SET received_qty = ?, line_status = ?, updated_at = ? WHERE id = ?",
        (new_received, line_status, timestamp, line_id),
    )
    po_id = line["po_id"]
    pending_count = conn.execute(
        "SELECT COUNT(*) FROM purchase_order_lines WHERE po_id = ? AND line_status != '已收货'",
        (po_id,),
    ).fetchone()[0]
    po_status = "已收货" if pending_count == 0 else "部分收货"
    conn.execute("UPDATE purchase_orders SET po_status = ?, updated_at = ? WHERE id = ?", (po_status, timestamp, po_id))
    conn.execute(
        """
        INSERT INTO inventory_transactions (internal_item_code, txn_type, qty, ref_type, ref_no, before_qty, after_qty, remark, created_at)
        VALUES (?, '采购入库', ?, '采购单', ?, ?, ?, ?, ?)
        """,
        (item_code, receive_qty, str(po_id), before_qty, after_qty, f"采购明细 {line_id}", timestamp),
    )
    conn.execute("INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)", ("采购收货", f"line_id={line_id};qty={receive_qty}", timestamp))
    conn.commit()
    return {"ok": True, "before_qty": before_qty, "after_qty": after_qty, "line_status": line_status, "po_status": po_status}


def finished_item_code(product_code):
    return f"FG-{product_code}"


def ensure_finished_goods_item(conn, product_code):
    code = finished_item_code(product_code)
    existing = conn.execute("SELECT internal_item_code FROM items WHERE internal_item_code = ?", (code,)).fetchone()
    if existing:
        return code
    product = conn.execute("SELECT * FROM products WHERE product_code = ?", (product_code,)).fetchone()
    insert_item(conn, {
        "internal_item_code": code,
        "item_category": "FG",
        "standard_name": product["product_name"] if product else product_code,
        "item_status": "启用",
        "base_uom": "PCS",
        "remark": "生产完工自动建立的成品物料",
    })
    return code


def change_inventory(conn, internal_item_code, qty_delta, txn_type, ref_type, ref_no, remark=""):
    qty_delta = float(qty_delta or 0)
    balance = conn.execute("SELECT * FROM inventory_balances WHERE internal_item_code = ?", (internal_item_code,)).fetchone()
    before_qty = float(balance["on_hand_qty"]) if balance else 0.0
    after_qty = round(before_qty + qty_delta, 6)
    if after_qty < -1e-9:
        raise ValueError(f"{internal_item_code} 库存不足")
    timestamp = now_text()
    if balance:
        conn.execute(
            "UPDATE inventory_balances SET on_hand_qty = ?, updated_at = ? WHERE internal_item_code = ?",
            (after_qty, timestamp, internal_item_code),
        )
    else:
        conn.execute(
            "INSERT INTO inventory_balances (internal_item_code, on_hand_qty, reserved_qty, updated_at) VALUES (?, ?, 0, ?)",
            (internal_item_code, after_qty, timestamp),
        )
    conn.execute(
        """
        INSERT INTO inventory_transactions (internal_item_code, txn_type, qty, ref_type, ref_no, before_qty, after_qty, remark, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (internal_item_code, txn_type, qty_delta, ref_type, ref_no, before_qty, after_qty, remark, timestamp),
    )
    return {"before_qty": before_qty, "after_qty": after_qty}


def generate_work_order_code(conn):
    prefix = f"WO-{datetime.now().strftime('%Y%m%d')}"
    count = conn.execute("SELECT COUNT(*) FROM work_orders WHERE work_order_code LIKE ?", (f"{prefix}%",)).fetchone()[0]
    return f"{prefix}-{count + 1:03d}"


def create_work_order_from_bom(conn, bom_id, order_qty, owner="计划员", planned_start="", planned_finish=""):
    bom = conn.execute("SELECT * FROM product_boms WHERE id = ?", (bom_id,)).fetchone()
    if not bom:
        raise ValueError("BOM 不存在")
    order_qty = float(order_qty or 0)
    if order_qty <= 0:
        raise ValueError("工单数量必须大于 0")
    bom_lines = fetch_bom_lines(conn, bom_id)
    if not bom_lines:
        raise ValueError("BOM 没有明细，不能生成工单")
    ensure_finished_goods_item(conn, bom["product_code"])
    work_order_code = generate_work_order_code(conn)
    work_order_id = insert_work_order(conn, {
        "work_order_code": work_order_code,
        "bom_id": bom_id,
        "product_code": bom["product_code"],
        "order_qty": order_qty,
        "completed_qty": 0,
        "work_status": "待领料",
        "planned_start": planned_start,
        "planned_finish": planned_finish,
        "owner": owner,
        "remark": "由 BOM 生成生产工单",
    })
    for line in bom_lines:
        qty_per = float(line.get("qty_per") or 0)
        loss_rate = float(line.get("loss_rate") or 0)
        required_qty = round(qty_per * order_qty * (1 + loss_rate), 6)
        insert_work_order_material(conn, {
            "work_order_id": work_order_id,
            "line_no": line["line_no"],
            "internal_item_code": line["internal_item_code"],
            "required_qty": required_qty,
            "issued_qty": 0,
            "uom": line["uom"],
            "process_stage": line.get("process_stage", ""),
            "remark": line.get("standard_name", ""),
        })
    conn.execute("INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)", ("生成生产工单", work_order_code, now_text()))
    conn.commit()
    return {"ok": True, "work_order_id": work_order_id, "work_order_code": work_order_code}


def fetch_work_orders(conn):
    rows = conn.execute(
        """
        SELECT wo.*, b.bom_code, p.product_name, p.customer_name,
               'FG-' || wo.product_code AS finished_item_code,
               COUNT(wom.id) AS material_line_count,
               COALESCE(SUM(wom.required_qty), 0) AS total_required_qty,
               COALESCE(SUM(wom.issued_qty), 0) AS total_issued_qty
        FROM work_orders wo
        LEFT JOIN product_boms b ON b.id = wo.bom_id
        LEFT JOIN products p ON p.product_code = wo.product_code
        LEFT JOIN work_order_materials wom ON wom.work_order_id = wo.id
        GROUP BY wo.id
        ORDER BY wo.created_at DESC, wo.id DESC
        """
    ).fetchall()
    return [dict(row) for row in rows]


def fetch_work_order_materials(conn, work_order_id=None):
    where_sql = ""
    params = ()
    if work_order_id:
        where_sql = "WHERE wom.work_order_id = ?"
        params = (work_order_id,)
    rows = conn.execute(
        f"""
        SELECT wom.*, wo.work_order_code, i.standard_name, i.item_category,
               COALESCE(inv.on_hand_qty, 0) AS on_hand_qty,
               COALESCE(inv.reserved_qty, 0) AS reserved_qty,
               COALESCE(inv.on_hand_qty, 0) - COALESCE(inv.reserved_qty, 0) AS available_qty
        FROM work_order_materials wom
        LEFT JOIN work_orders wo ON wo.id = wom.work_order_id
        LEFT JOIN items i ON i.internal_item_code = wom.internal_item_code
        LEFT JOIN inventory_balances inv ON inv.internal_item_code = wom.internal_item_code
        {where_sql}
        ORDER BY wo.created_at DESC, wo.id DESC, wom.line_no
        """,
        params,
    ).fetchall()
    return [dict(row) for row in rows]


def fetch_production_reports(conn, work_order_id=None):
    where_sql = ""
    params = ()
    if work_order_id:
        where_sql = "WHERE pr.work_order_id = ?"
        params = (work_order_id,)
    rows = conn.execute(
        f"""
        SELECT pr.*, wo.work_order_code, wo.product_code
        FROM production_reports pr
        LEFT JOIN work_orders wo ON wo.id = pr.work_order_id
        {where_sql}
        ORDER BY pr.created_at DESC, pr.id DESC
        """,
        params,
    ).fetchall()
    return [dict(row) for row in rows]


def issue_work_order_materials(conn, work_order_id):
    work_order = conn.execute("SELECT * FROM work_orders WHERE id = ?", (work_order_id,)).fetchone()
    if not work_order:
        raise ValueError("生产工单不存在")
    materials = fetch_work_order_materials(conn, work_order_id)
    if not materials:
        raise ValueError("工单没有用料明细")
    shortages = []
    for material in materials:
        remaining_qty = round(float(material["required_qty"]) - float(material["issued_qty"]), 6)
        if remaining_qty <= 0:
            continue
        if float(material["available_qty"] or 0) + 1e-9 < remaining_qty:
            shortages.append(f"{material['internal_item_code']} 缺 {round(remaining_qty - float(material['available_qty'] or 0), 6)}")
    if shortages:
        raise ValueError("存在缺料：" + "；".join(shortages))

    timestamp = now_text()
    issued = []
    for material in materials:
        remaining_qty = round(float(material["required_qty"]) - float(material["issued_qty"]), 6)
        if remaining_qty <= 0:
            continue
        change_inventory(conn, material["internal_item_code"], -remaining_qty, "生产领料", "生产工单", work_order["work_order_code"], material.get("standard_name", ""))
        conn.execute(
            "UPDATE work_order_materials SET issued_qty = required_qty, updated_at = ? WHERE id = ?",
            (timestamp, material["id"]),
        )
        issued.append({"internal_item_code": material["internal_item_code"], "issued_qty": remaining_qty})
    status = "部分完工" if float(work_order["completed_qty"] or 0) > 0 else "生产中"
    conn.execute("UPDATE work_orders SET work_status = ?, updated_at = ? WHERE id = ?", (status, timestamp, work_order_id))
    conn.execute("INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)", ("生产领料", json.dumps(issued, ensure_ascii=False), timestamp))
    conn.commit()
    return {"ok": True, "issued": issued, "work_status": status}


def complete_work_order(conn, work_order_id, good_qty, scrap_qty=0, operator="", process_stage="完工入库"):
    work_order = conn.execute("SELECT * FROM work_orders WHERE id = ?", (work_order_id,)).fetchone()
    if not work_order:
        raise ValueError("生产工单不存在")
    good_qty = float(good_qty or 0)
    scrap_qty = float(scrap_qty or 0)
    if good_qty <= 0:
        raise ValueError("完工数量必须大于 0")
    if scrap_qty < 0:
        raise ValueError("报废数量不能小于 0")
    remaining_qty = float(work_order["order_qty"]) - float(work_order["completed_qty"])
    if good_qty > remaining_qty + 1e-9:
        raise ValueError("完工数量不能超过工单未完工数量")
    materials = fetch_work_order_materials(conn, work_order_id)
    if any(float(row["issued_qty"]) + 1e-9 < float(row["required_qty"]) for row in materials):
        raise ValueError("请先完成工单领料")

    finished_code = ensure_finished_goods_item(conn, work_order["product_code"])
    stock_result = change_inventory(conn, finished_code, good_qty, "完工入库", "生产工单", work_order["work_order_code"], process_stage)
    timestamp = now_text()
    new_completed = round(float(work_order["completed_qty"]) + good_qty, 6)
    status = "已完工" if new_completed >= float(work_order["order_qty"]) - 1e-9 else "部分完工"
    conn.execute(
        f"""
        INSERT INTO production_reports ({",".join(PRODUCTION_REPORT_FIELDS)}, created_at)
        VALUES ({",".join(["?"] * len(PRODUCTION_REPORT_FIELDS))}, ?)
        """,
        [work_order_id, datetime.now().strftime("%Y-%m-%d"), process_stage, good_qty, scrap_qty, operator, ""] + [timestamp],
    )
    conn.execute(
        "UPDATE work_orders SET completed_qty = ?, work_status = ?, updated_at = ? WHERE id = ?",
        (new_completed, status, timestamp, work_order_id),
    )
    conn.execute("INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)", ("生产完工入库", f"{work_order['work_order_code']};good={good_qty};scrap={scrap_qty}", timestamp))
    conn.commit()
    return {"ok": True, "finished_item_code": finished_code, "completed_qty": new_completed, "work_status": status, **stock_result}


def generate_sales_order_code(conn):
    prefix = f"SO-{datetime.now().strftime('%Y%m%d')}"
    count = conn.execute("SELECT COUNT(*) FROM sales_orders WHERE sales_order_code LIKE ?", (f"{prefix}%",)).fetchone()[0]
    return f"{prefix}-{count + 1:03d}"


def generate_shipment_code(conn):
    prefix = f"DN-{datetime.now().strftime('%Y%m%d')}"
    count = conn.execute("SELECT COUNT(*) FROM shipments WHERE shipment_code LIKE ?", (f"{prefix}%",)).fetchone()[0]
    return f"{prefix}-{count + 1:03d}"


def fetch_sales_orders(conn):
    rows = conn.execute(
        """
        SELECT so.*, p.product_name, p.product_type,
               b.bom_code,
               wo.work_order_code,
               'FG-' || so.product_code AS finished_item_code,
               COALESCE(inv.on_hand_qty, 0) AS finished_on_hand_qty,
               COALESCE(inv.on_hand_qty, 0) - COALESCE(inv.reserved_qty, 0) AS finished_available_qty
        FROM sales_orders so
        LEFT JOIN products p ON p.product_code = so.product_code
        LEFT JOIN product_boms b ON b.id = so.linked_bom_id
        LEFT JOIN work_orders wo ON wo.id = so.linked_work_order_id
        LEFT JOIN inventory_balances inv ON inv.internal_item_code = 'FG-' || so.product_code
        ORDER BY so.created_at DESC, so.id DESC
        """
    ).fetchall()
    return [dict(row) for row in rows]


def fetch_shipments(conn, sales_order_id=None):
    where_sql = ""
    params = ()
    if sales_order_id:
        where_sql = "WHERE sh.sales_order_id = ?"
        params = (sales_order_id,)
    rows = conn.execute(
        f"""
        SELECT sh.*, so.sales_order_code, so.customer_name, p.product_name
        FROM shipments sh
        LEFT JOIN sales_orders so ON so.id = sh.sales_order_id
        LEFT JOIN products p ON p.product_code = sh.product_code
        {where_sql}
        ORDER BY sh.created_at DESC, sh.id DESC
        """,
        params,
    ).fetchall()
    return [dict(row) for row in rows]


def create_sales_order(conn, row):
    product_code = row.get("product_code", "")
    if not product_code:
        raise ValueError("产品不能为空")
    product = conn.execute("SELECT product_code FROM products WHERE product_code = ?", (product_code,)).fetchone()
    if not product:
        raise ValueError("产品不存在，请先建立产品工程卡")
    customer_name = row.get("customer_name", "")
    if not customer_name:
        raise ValueError("客户不能为空")
    order_qty = float(row.get("order_qty") or 0)
    if order_qty <= 0:
        raise ValueError("订单数量必须大于 0")
    linked_bom_id = int(row.get("linked_bom_id") or 0)
    linked_work_order_id = int(row.get("linked_work_order_id") or 0)
    if linked_bom_id:
        bom = conn.execute("SELECT id FROM product_boms WHERE id = ? AND product_code = ?", (linked_bom_id, product_code)).fetchone()
        if not bom:
            raise ValueError("选择的 BOM 不属于该产品")
    if linked_work_order_id:
        work_order = conn.execute("SELECT id FROM work_orders WHERE id = ? AND product_code = ?", (linked_work_order_id, product_code)).fetchone()
        if not work_order:
            raise ValueError("选择的生产工单不属于该产品")
    sales_order_code = row.get("sales_order_code") or generate_sales_order_code(conn)
    sales_order_id = insert_sales_order(conn, {
        "sales_order_code": sales_order_code,
        "customer_name": customer_name,
        "product_code": product_code,
        "order_qty": order_qty,
        "shipped_qty": 0,
        "sales_status": row.get("sales_status") or "待生产",
        "due_date": row.get("due_date", ""),
        "linked_bom_id": linked_bom_id,
        "linked_work_order_id": linked_work_order_id,
        "owner": row.get("owner", ""),
        "remark": row.get("remark", ""),
    })
    conn.execute("INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)", ("创建销售订单", sales_order_code, now_text()))
    conn.commit()
    return {"ok": True, "sales_order_id": sales_order_id, "sales_order_code": sales_order_code}


def ship_sales_order(conn, sales_order_id, ship_qty, receiver="", ship_date=""):
    order = conn.execute("SELECT * FROM sales_orders WHERE id = ?", (sales_order_id,)).fetchone()
    if not order:
        raise ValueError("销售订单不存在")
    ship_qty = float(ship_qty or 0)
    if ship_qty <= 0:
        raise ValueError("出货数量必须大于 0")
    remaining_qty = float(order["order_qty"]) - float(order["shipped_qty"])
    if ship_qty > remaining_qty + 1e-9:
        raise ValueError("出货数量不能超过未出货数量")
    finished_code = ensure_finished_goods_item(conn, order["product_code"])
    stock_result = change_inventory(conn, finished_code, -ship_qty, "销售出货", "销售订单", order["sales_order_code"], receiver)
    shipment_code = generate_shipment_code(conn)
    timestamp = now_text()
    ship_date = ship_date or datetime.now().strftime("%Y-%m-%d")
    conn.execute(
        f"""
        INSERT INTO shipments ({",".join(SHIPMENT_FIELDS)}, created_at)
        VALUES ({",".join(["?"] * len(SHIPMENT_FIELDS))}, ?)
        """,
        [shipment_code, sales_order_id, order["product_code"], finished_code, ship_qty, ship_date, receiver, ""] + [timestamp],
    )
    new_shipped = round(float(order["shipped_qty"]) + ship_qty, 6)
    status = "已出货" if new_shipped >= float(order["order_qty"]) - 1e-9 else "部分出货"
    conn.execute(
        "UPDATE sales_orders SET shipped_qty = ?, sales_status = ?, updated_at = ? WHERE id = ?",
        (new_shipped, status, timestamp, sales_order_id),
    )
    conn.execute("INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)", ("销售出货", f"{order['sales_order_code']};qty={ship_qty}", timestamp))
    conn.commit()
    return {"ok": True, "shipment_code": shipment_code, "finished_item_code": finished_code, "shipped_qty": new_shipped, "sales_status": status, **stock_result}


def generate_quality_code(conn, inspection_type):
    safe_type = (inspection_type or "QC").upper()
    prefix = f"{safe_type}-{datetime.now().strftime('%Y%m%d')}"
    count = conn.execute("SELECT COUNT(*) FROM quality_inspections WHERE inspection_code LIKE ?", (f"{prefix}%",)).fetchone()[0]
    return f"{prefix}-{count + 1:03d}"


def fetch_quality_inspections(conn):
    rows = conn.execute(
        """
        SELECT qi.*,
               i.standard_name AS item_name,
               p.product_name
        FROM quality_inspections qi
        LEFT JOIN items i ON i.internal_item_code = qi.item_code
        LEFT JOIN products p ON p.product_code = qi.product_code
        ORDER BY qi.created_at DESC, qi.id DESC
        """
    ).fetchall()
    return [dict(row) for row in rows]


def fetch_quality_defects(conn, inspection_id=None):
    where_sql = ""
    params = ()
    if inspection_id:
        where_sql = "WHERE qd.inspection_id = ?"
        params = (inspection_id,)
    rows = conn.execute(
        f"""
        SELECT qd.*, qi.inspection_code, qi.inspection_type, qi.ref_type, qi.responsible_stage
        FROM quality_defects qd
        LEFT JOIN quality_inspections qi ON qi.id = qd.inspection_id
        {where_sql}
        ORDER BY qd.created_at DESC, qd.id DESC
        """,
        params,
    ).fetchall()
    return [dict(row) for row in rows]


def create_quality_inspection(conn, row):
    inspection_type = (row.get("inspection_type") or "").upper()
    if inspection_type not in {"IQC", "IPQC", "FQC"}:
        raise ValueError("检验类型必须是 IQC、IPQC 或 FQC")
    inspected_qty = float(row.get("inspected_qty") or 0)
    passed_qty = float(row.get("passed_qty") or 0)
    failed_qty = row.get("failed_qty")
    failed_qty = float(failed_qty) if failed_qty not in (None, "") else round(max(0, inspected_qty - passed_qty), 6)
    if inspected_qty <= 0:
        raise ValueError("检验数量必须大于 0")
    if passed_qty < 0 or failed_qty < 0:
        raise ValueError("合格数量和不良数量不能小于 0")
    if passed_qty + failed_qty > inspected_qty + 1e-9:
        raise ValueError("合格数量与不良数量不能超过检验数量")

    ref_type = row.get("ref_type", "")
    ref_id = int(row.get("ref_id") or 0)
    item_code = row.get("item_code", "")
    product_code = row.get("product_code", "")
    if ref_type == "采购明细" and ref_id:
        source = conn.execute("SELECT * FROM purchase_order_lines WHERE id = ?", (ref_id,)).fetchone()
        if not source:
            raise ValueError("采购明细不存在")
        item_code = item_code or source["internal_item_code"]
    elif ref_type == "生产工单" and ref_id:
        source = conn.execute("SELECT * FROM work_orders WHERE id = ?", (ref_id,)).fetchone()
        if not source:
            raise ValueError("生产工单不存在")
        product_code = product_code or source["product_code"]
    elif ref_type == "销售订单" and ref_id:
        source = conn.execute("SELECT * FROM sales_orders WHERE id = ?", (ref_id,)).fetchone()
        if not source:
            raise ValueError("销售订单不存在")
        product_code = product_code or source["product_code"]

    disposition = row.get("disposition", "")
    inspection_status = "合格放行" if failed_qty <= 0 else (disposition or "异常待处理")
    inspection_code = row.get("inspection_code") or generate_quality_code(conn, inspection_type)
    inspection_id = insert_quality_inspection(conn, {
        "inspection_code": inspection_code,
        "inspection_type": inspection_type,
        "ref_type": ref_type,
        "ref_id": ref_id,
        "item_code": item_code,
        "product_code": product_code,
        "inspected_qty": inspected_qty,
        "passed_qty": passed_qty,
        "failed_qty": failed_qty,
        "inspection_status": inspection_status,
        "disposition": disposition,
        "inspector": row.get("inspector", ""),
        "inspection_date": row.get("inspection_date", ""),
        "responsible_stage": row.get("responsible_stage", ""),
        "remark": row.get("remark", ""),
    })
    defect_type = row.get("defect_type", "")
    defect_qty = float(row.get("defect_qty") or failed_qty or 0)
    if failed_qty > 0 and defect_type:
        insert_quality_defect(conn, {
            "inspection_id": inspection_id,
            "defect_type": defect_type,
            "severity": row.get("severity", "一般"),
            "defect_qty": defect_qty,
            "corrective_action": row.get("corrective_action", ""),
            "remark": row.get("defect_remark", ""),
        })
    conn.execute("INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)", ("品质检验", inspection_code, now_text()))
    conn.commit()
    return {"ok": True, "inspection_id": inspection_id, "inspection_code": inspection_code, "inspection_status": inspection_status}


def best_match(conn, raw):
    supplier_name = raw.get("supplier_name", "")
    raw_item_code = raw.get("raw_item_code", "")
    if raw_item_code:
        exact = conn.execute(
            """
            SELECT m.*, i.standard_name
            FROM supplier_mappings m
            LEFT JOIN items i ON i.internal_item_code = m.internal_item_code
            WHERE UPPER(REPLACE(m.supplier_name, ' ', '')) = ?
              AND UPPER(REPLACE(m.supplier_item_code, ' ', '')) = ?
            ORDER BY m.id DESC
            LIMIT 1
            """,
            (normalize(supplier_name), normalize(raw_item_code)),
        ).fetchone()
        if exact:
            return {
                "candidate_internal_code": exact["internal_item_code"],
                "candidate_standard_name": exact["standard_name"] or "",
                "match_level": "自动匹配",
                "confidence": 1.0,
                "owner_role": "采购",
            }

    items = fetch_items(conn)
    if not items:
        return {
            "candidate_internal_code": "",
            "candidate_standard_name": "",
            "match_level": "新物料",
            "confidence": 0,
            "owner_role": "工程",
        }
    ranked = sorted(((score_candidate(raw, item), item) for item in items), key=lambda pair: pair[0], reverse=True)
    score, item = ranked[0]
    level = classify(score)
    return {
        "candidate_internal_code": item["internal_item_code"] if level != "新物料" else "",
        "candidate_standard_name": item["standard_name"] if level != "新物料" else "",
        "match_level": level,
        "confidence": score,
        "owner_role": "采购" if level == "自动匹配" else "工程",
    }


def normalize_import_row(row, batch_no):
    data = {field: row.get(field, "") for field in IMPORT_FIELDS}
    data["import_batch_no"] = data["import_batch_no"] or batch_no
    data["purchase_uom"] = data["purchase_uom"] or "PCS"
    return data


def import_supplier_rows(conn, rows, batch_no=None):
    if not batch_no:
        batch_no = f"IMP-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    imported = []
    timestamp = now_text()
    for row in rows:
        raw = normalize_import_row(row, batch_no)
        raw_text = " ".join([raw.get("raw_item_name", ""), raw.get("raw_spec", "")])
        parsed = {
            "parsed_category": parse_category(raw_text),
            "parsed_package": parse_package(raw_text),
            "parsed_value": parse_value(raw_text),
            "parsed_voltage": parse_voltage(raw_text),
        }
        match = best_match(conn, raw)
        payload = {
            **raw,
            **parsed,
            **match,
            "process_status": "待处理",
        }
        conn.execute(
            """
            INSERT INTO cleaning_rows (
                import_batch_no, supplier_name, raw_item_name, raw_item_code, raw_spec,
                raw_brand, raw_mpn, purchase_uom, min_order_qty, lead_time_days, last_price, remark,
                parsed_category, parsed_package, parsed_value, parsed_voltage,
                candidate_internal_code, candidate_standard_name, match_level, confidence,
                owner_role, process_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                payload.get("import_batch_no", ""),
                payload.get("supplier_name", ""),
                payload.get("raw_item_name", ""),
                payload.get("raw_item_code", ""),
                payload.get("raw_spec", ""),
                payload.get("raw_brand", ""),
                payload.get("raw_mpn", ""),
                payload.get("purchase_uom", ""),
                payload.get("min_order_qty", ""),
                payload.get("lead_time_days", ""),
                payload.get("last_price", ""),
                payload.get("remark", ""),
                payload.get("parsed_category", ""),
                payload.get("parsed_package", ""),
                payload.get("parsed_value", ""),
                payload.get("parsed_voltage", ""),
                payload.get("candidate_internal_code", ""),
                payload.get("candidate_standard_name", ""),
                payload.get("match_level", ""),
                payload.get("confidence", 0),
                payload.get("owner_role", ""),
                payload.get("process_status", "待处理"),
                timestamp,
                timestamp,
            ],
        )
        imported.append(payload)
    conn.execute("INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)", ("导入供应商物料", f"{batch_no}: {len(imported)} 行", timestamp))
    conn.commit()
    return {"batch_no": batch_no, "count": len(imported), "rows": imported}


def generate_item_code(conn, category):
    category = (category or "OTH").upper()
    existing = conn.execute(
        "SELECT internal_item_code FROM items WHERE internal_item_code LIKE ? ORDER BY internal_item_code DESC LIMIT 1",
        (f"CYD-{category}-%",),
    ).fetchone()
    next_number = 1
    if existing:
        match = re.search(r"-(\d+)$", existing["internal_item_code"])
        if match:
            next_number = int(match.group(1)) + 1
    return f"CYD-{category}-{next_number:06d}"


def cleaning_rows(conn, limit=500):
    rows = conn.execute("SELECT * FROM cleaning_rows ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(row) for row in rows]


def parse_csv_text(text):
    with io.StringIO(text) as buffer:
        reader = csv.DictReader(buffer)
        return [dict(row) for row in reader]


def rows_to_csv(rows, fields):
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return buffer.getvalue()


def generate_financial_doc_code(conn, doc_type):
    prefix = "AR" if doc_type == "应收" else "AP"
    day = datetime.now().strftime("%Y%m%d")
    code_prefix = f"{prefix}-{day}"
    count = conn.execute("SELECT COUNT(*) FROM financial_documents WHERE doc_code LIKE ?", (f"{code_prefix}%",)).fetchone()[0]
    return f"{code_prefix}-{count + 1:03d}"


def generate_payment_code(conn, payment_type):
    prefix = "RCV" if payment_type == "收款" else "PAY"
    day = datetime.now().strftime("%Y%m%d")
    code_prefix = f"{prefix}-{day}"
    count = conn.execute("SELECT COUNT(*) FROM financial_payments WHERE payment_code LIKE ?", (f"{code_prefix}%",)).fetchone()[0]
    return f"{code_prefix}-{count + 1:03d}"


def financial_doc_status(total_amount, paid_amount):
    total_amount = float(total_amount or 0)
    paid_amount = float(paid_amount or 0)
    if paid_amount <= 0:
        return "未结清"
    if paid_amount >= total_amount - 1e-9:
        return "已结清"
    return "部分结清"


def fetch_financial_documents(conn, doc_type=None):
    where_sql = ""
    params = ()
    if doc_type:
        where_sql = "WHERE doc_type = ?"
        params = (doc_type,)
    rows = conn.execute(
        f"""
        SELECT *,
               ROUND(total_amount - paid_amount, 2) AS balance_amount
        FROM financial_documents
        {where_sql}
        ORDER BY created_at DESC, id DESC
        """,
        params,
    ).fetchall()
    return [dict(row) for row in rows]


def fetch_financial_payments(conn, doc_id=None):
    where_sql = ""
    params = ()
    if doc_id:
        where_sql = "WHERE fp.doc_id = ?"
        params = (doc_id,)
    rows = conn.execute(
        f"""
        SELECT fp.*, fd.doc_code, fd.doc_type, fd.counterparty, fd.source_code
        FROM financial_payments fp
        LEFT JOIN financial_documents fd ON fd.id = fp.doc_id
        {where_sql}
        ORDER BY fp.created_at DESC, fp.id DESC
        """,
        params,
    ).fetchall()
    return [dict(row) for row in rows]


def create_financial_document(conn, payload):
    doc_type = payload.get("doc_type", "")
    if doc_type not in {"应收", "应付"}:
        raise ValueError("财务单据类型必须是应收或应付")
    total_amount = float(payload.get("total_amount") or 0)
    if total_amount <= 0:
        raise ValueError("金额必须大于 0")
    source_type = payload.get("source_type", "")
    source_id = int(payload.get("source_id") or 0)
    if not source_type or not source_id:
        raise ValueError("缺少来源单据")
    timestamp = now_text()
    doc_code = payload.get("doc_code") or generate_financial_doc_code(conn, doc_type)
    cursor = conn.execute(
        """
        INSERT INTO financial_documents (
            doc_code, doc_type, counterparty, source_type, source_id, source_code,
            total_amount, paid_amount, doc_status, due_date, created_by, remark, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, '未结清', ?, ?, ?, ?, ?)
        """,
        (
            doc_code,
            doc_type,
            payload.get("counterparty", ""),
            source_type,
            source_id,
            payload.get("source_code", ""),
            total_amount,
            payload.get("due_date", ""),
            payload.get("created_by", ""),
            payload.get("remark", ""),
            timestamp,
            timestamp,
        ),
    )
    conn.execute("INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)", ("创建财务单据", doc_code, timestamp))
    conn.commit()
    return {"ok": True, "doc_id": cursor.lastrowid, "doc_code": doc_code}


def purchase_order_amount(conn, po_id):
    amount = conn.execute(
        "SELECT COALESCE(SUM(order_qty * unit_price), 0) FROM purchase_order_lines WHERE po_id = ?",
        (po_id,),
    ).fetchone()[0]
    return float(amount or 0)


def create_receivable_from_sales_order(conn, row):
    sales_order_id = int(row.get("sales_order_id") or 0)
    order = conn.execute("SELECT * FROM sales_orders WHERE id = ?", (sales_order_id,)).fetchone()
    if not order:
        raise ValueError("销售订单不存在")
    return create_financial_document(conn, {
        "doc_type": "应收",
        "counterparty": order["customer_name"],
        "source_type": "销售订单",
        "source_id": sales_order_id,
        "source_code": order["sales_order_code"],
        "total_amount": row.get("total_amount"),
        "due_date": row.get("due_date") or order["due_date"],
        "created_by": row.get("created_by", ""),
        "remark": row.get("remark", ""),
    })


def create_payable_from_purchase_order(conn, row):
    po_id = int(row.get("po_id") or 0)
    po = conn.execute("SELECT * FROM purchase_orders WHERE id = ?", (po_id,)).fetchone()
    if not po:
        raise ValueError("采购单不存在")
    amount = row.get("total_amount")
    if amount in (None, ""):
        amount = purchase_order_amount(conn, po_id)
    return create_financial_document(conn, {
        "doc_type": "应付",
        "counterparty": po["supplier_name"],
        "source_type": "采购单",
        "source_id": po_id,
        "source_code": po["po_code"],
        "total_amount": amount,
        "due_date": row.get("due_date") or po["expected_date"],
        "created_by": row.get("created_by", ""),
        "remark": row.get("remark", ""),
    })


def create_financial_payment(conn, row):
    doc_id = int(row.get("doc_id") or 0)
    doc = conn.execute("SELECT * FROM financial_documents WHERE id = ?", (doc_id,)).fetchone()
    if not doc:
        raise ValueError("财务单据不存在")
    payment_type = row.get("payment_type") or ("收款" if doc["doc_type"] == "应收" else "付款")
    expected_type = "收款" if doc["doc_type"] == "应收" else "付款"
    if payment_type != expected_type:
        raise ValueError(f"{doc['doc_type']}单只能登记{expected_type}")
    amount = float(row.get("amount") or 0)
    if amount <= 0:
        raise ValueError("收付款金额必须大于 0")
    balance = float(doc["total_amount"]) - float(doc["paid_amount"])
    if amount > balance + 1e-9:
        raise ValueError("收付款金额不能超过未结余额")
    timestamp = now_text()
    payment_code = row.get("payment_code") or generate_payment_code(conn, payment_type)
    payment_date = row.get("payment_date") or datetime.now().strftime("%Y-%m-%d")
    conn.execute(
        """
        INSERT INTO financial_payments (payment_code, payment_type, doc_id, amount, payment_date, account_name, handled_by, remark, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payment_code,
            payment_type,
            doc_id,
            amount,
            payment_date,
            row.get("account_name", ""),
            row.get("handled_by", ""),
            row.get("remark", ""),
            timestamp,
        ),
    )
    new_paid = round(float(doc["paid_amount"]) + amount, 2)
    status = financial_doc_status(doc["total_amount"], new_paid)
    conn.execute(
        "UPDATE financial_documents SET paid_amount = ?, doc_status = ?, updated_at = ? WHERE id = ?",
        (new_paid, status, timestamp, doc_id),
    )
    conn.execute("INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)", (payment_type, f"{payment_code};{doc['doc_code']};{amount}", timestamp))
    conn.commit()
    return {"ok": True, "payment_code": payment_code, "paid_amount": new_paid, "doc_status": status, "balance_amount": round(float(doc["total_amount"]) - new_paid, 2)}


def api_finance_summary(conn):
    row = conn.execute(
        """
        SELECT
            COALESCE(SUM(CASE WHEN doc_type = '应收' THEN total_amount ELSE 0 END), 0) AS receivable_total,
            COALESCE(SUM(CASE WHEN doc_type = '应收' THEN paid_amount ELSE 0 END), 0) AS receivable_paid,
            COALESCE(SUM(CASE WHEN doc_type = '应付' THEN total_amount ELSE 0 END), 0) AS payable_total,
            COALESCE(SUM(CASE WHEN doc_type = '应付' THEN paid_amount ELSE 0 END), 0) AS payable_paid
        FROM financial_documents
        """
    ).fetchone()
    receivable_balance = float(row["receivable_total"]) - float(row["receivable_paid"])
    payable_balance = float(row["payable_total"]) - float(row["payable_paid"])
    recent = conn.execute(
        """
        SELECT fp.*, fd.doc_code, fd.counterparty
        FROM financial_payments fp
        LEFT JOIN financial_documents fd ON fd.id = fp.doc_id
        ORDER BY fp.created_at DESC, fp.id DESC
        LIMIT 8
        """
    ).fetchall()
    return {
        "receivable_total": round(float(row["receivable_total"]), 2),
        "receivable_paid": round(float(row["receivable_paid"]), 2),
        "receivable_balance": round(receivable_balance, 2),
        "payable_total": round(float(row["payable_total"]), 2),
        "payable_paid": round(float(row["payable_paid"]), 2),
        "payable_balance": round(payable_balance, 2),
        "cash_net": round(float(row["receivable_paid"]) - float(row["payable_paid"]), 2),
        "recent_payments": [dict(item) for item in recent],
    }


def fetch_users(conn):
    rows = conn.execute(
        """
        SELECT username, display_name, role, is_active, created_at, updated_at, last_login_at
        FROM app_users
        ORDER BY role, username
        """
    ).fetchall()
    return [
        {
            **dict(row),
            "role_label": ROLE_LABELS.get(row["role"], row["role"]),
            "is_active": bool(row["is_active"]),
        }
        for row in rows
    ]


def backup_entry(path):
    stat = path.stat()
    return {
        "name": path.name,
        "size": stat.st_size,
        "created_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
    }


def list_backups():
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backups = [backup_entry(path) for path in BACKUP_DIR.glob("erp-backup-*.sqlite3") if path.is_file()]
    return sorted(backups, key=lambda row: row["created_at"], reverse=True)


def create_database_backup(conn, created_by):
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    target = BACKUP_DIR / f"erp-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}.sqlite3"
    with sqlite3.connect(target) as backup_conn:
        conn.backup(backup_conn)
    conn.execute("INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)", ("创建备份", f"{target.name} / {created_by}", now_text()))
    conn.commit()
    return backup_entry(target)


def resolve_backup_path(name):
    if not re.fullmatch(r"erp-backup-\d{8}-\d{6}\.sqlite3", name or ""):
        raise ValueError("备份文件名不合法")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    path = (BACKUP_DIR / name).resolve()
    if not str(path).startswith(str(BACKUP_DIR.resolve())) or not path.exists():
        raise ValueError("备份文件不存在")
    return path


def restore_database_backup(name):
    source = resolve_backup_path(name)
    with sqlite3.connect(source) as source_conn:
        with sqlite3.connect(DB_PATH) as target_conn:
            source_conn.backup(target_conn)
    return backup_entry(source)


def api_management_dashboard(conn):
    summary = api_summary(conn)
    total_po_amount = conn.execute(
        "SELECT COALESCE(SUM(order_qty * unit_price), 0) FROM purchase_order_lines"
    ).fetchone()[0]
    inventory_qty = conn.execute("SELECT COALESCE(SUM(on_hand_qty), 0) FROM inventory_balances").fetchone()[0]
    inspected_qty, passed_qty, failed_qty = conn.execute(
        """
        SELECT COALESCE(SUM(inspected_qty), 0), COALESCE(SUM(passed_qty), 0), COALESCE(SUM(failed_qty), 0)
        FROM quality_inspections
        """
    ).fetchone()
    pass_rate = round((passed_qty / inspected_qty) * 100, 2) if inspected_qty else 100
    completed_qty = conn.execute("SELECT COALESCE(SUM(completed_qty), 0) FROM work_orders").fetchone()[0]
    shipped_qty = conn.execute("SELECT COALESCE(SUM(ship_qty), 0) FROM shipments").fetchone()[0]
    metrics = [
        {"label": "未完成采购单", "value": summary["open_pos"], "hint": "需要采购继续跟进的订单"},
        {"label": "生产中工单", "value": summary["active_work_orders"], "hint": "尚未完工入库的生产任务"},
        {"label": "待交付订单", "value": summary["open_sales_orders"], "hint": "尚未完全出货的销售订单"},
        {"label": "品质异常", "value": summary["open_quality_issues"], "hint": "有不良且未放行的检验记录"},
        {"label": "库存总量", "value": round(inventory_qty, 2), "hint": "所有物料当前在库数量合计"},
        {"label": "采购金额", "value": round(total_po_amount, 2), "hint": "采购明细金额合计"},
        {"label": "质量合格率", "value": f"{pass_rate}%", "hint": f"已检 {round(inspected_qty, 2)}，不良 {round(failed_qty, 2)}"},
        {"label": "累计完工", "value": round(completed_qty, 2), "hint": "生产报工良品入库数量"},
        {"label": "累计出货", "value": round(shipped_qty, 2), "hint": "销售交付已出货数量"},
        {"label": "应收余额", "value": summary["receivable_balance"], "hint": "客户尚未回款金额"},
        {"label": "应付余额", "value": summary["payable_balance"], "hint": "供应商尚未付款金额"},
    ]
    risks = []
    if summary["pending"]:
        risks.append({"level": "warning", "text": f"{summary['pending']} 条供应商物料待清洗审核"})
    if summary["open_pos"]:
        risks.append({"level": "info", "text": f"{summary['open_pos']} 张采购单未完成收货"})
    if summary["active_work_orders"]:
        risks.append({"level": "info", "text": f"{summary['active_work_orders']} 张生产工单未完工"})
    if summary["open_quality_issues"]:
        risks.append({"level": "danger", "text": f"{summary['open_quality_issues']} 条品质异常需要处置"})
    if summary["receivable_balance"] > 0:
        risks.append({"level": "warning", "text": f"还有 {summary['receivable_balance']} 元应收未回款"})
    if summary["payable_balance"] > 0:
        risks.append({"level": "info", "text": f"还有 {summary['payable_balance']} 元应付未付款"})
    if not risks:
        risks.append({"level": "ok", "text": "当前没有突出的待办风险"})
    activity = conn.execute(
        "SELECT action, detail, created_at FROM activity_log ORDER BY id DESC LIMIT 12"
    ).fetchall()
    return {
        "metrics": metrics,
        "risks": risks,
        "recent_activity": [dict(row) for row in activity],
        "summary": summary,
    }


def api_summary(conn):
    total_items = conn.execute("SELECT COUNT(*) FROM items").fetchone()[0]
    total_mappings = conn.execute("SELECT COUNT(*) FROM supplier_mappings").fetchone()[0]
    pending = conn.execute("SELECT COUNT(*) FROM cleaning_rows WHERE process_status = '待处理'").fetchone()[0]
    auto_count = conn.execute("SELECT COUNT(*) FROM cleaning_rows WHERE match_level = '自动匹配'").fetchone()[0]
    suspect_count = conn.execute("SELECT COUNT(*) FROM cleaning_rows WHERE match_level = '疑似匹配'").fetchone()[0]
    new_count = conn.execute("SELECT COUNT(*) FROM cleaning_rows WHERE match_level = '新物料'").fetchone()[0]
    total_products = conn.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    total_boms = conn.execute("SELECT COUNT(*) FROM product_boms").fetchone()[0]
    total_pos = conn.execute("SELECT COUNT(*) FROM purchase_orders").fetchone()[0]
    open_pos = conn.execute("SELECT COUNT(*) FROM purchase_orders WHERE po_status != '已收货'").fetchone()[0]
    total_work_orders = conn.execute("SELECT COUNT(*) FROM work_orders").fetchone()[0]
    active_work_orders = conn.execute("SELECT COUNT(*) FROM work_orders WHERE work_status != '已完工'").fetchone()[0]
    total_sales_orders = conn.execute("SELECT COUNT(*) FROM sales_orders").fetchone()[0]
    open_sales_orders = conn.execute("SELECT COUNT(*) FROM sales_orders WHERE sales_status != '已出货'").fetchone()[0]
    total_quality_inspections = conn.execute("SELECT COUNT(*) FROM quality_inspections").fetchone()[0]
    open_quality_issues = conn.execute("SELECT COUNT(*) FROM quality_inspections WHERE failed_qty > 0 AND inspection_status != '合格放行'").fetchone()[0]
    receivable_balance = conn.execute("SELECT COALESCE(SUM(total_amount - paid_amount), 0) FROM financial_documents WHERE doc_type = '应收'").fetchone()[0]
    payable_balance = conn.execute("SELECT COALESCE(SUM(total_amount - paid_amount), 0) FROM financial_documents WHERE doc_type = '应付'").fetchone()[0]
    return {
        "total_items": total_items,
        "total_mappings": total_mappings,
        "total_products": total_products,
        "total_boms": total_boms,
        "total_pos": total_pos,
        "open_pos": open_pos,
        "total_work_orders": total_work_orders,
        "active_work_orders": active_work_orders,
        "total_sales_orders": total_sales_orders,
        "open_sales_orders": open_sales_orders,
        "total_quality_inspections": total_quality_inspections,
        "open_quality_issues": open_quality_issues,
        "receivable_balance": round(float(receivable_balance or 0), 2),
        "payable_balance": round(float(payable_balance or 0), 2),
        "pending": pending,
        "auto_count": auto_count,
        "suspect_count": suspect_count,
        "new_count": new_count,
    }


class AppHandler(BaseHTTPRequestHandler):
    server_version = "ChenYidaERP/0.1"

    def log_message(self, fmt, *args):
        sys.stdout.write("[%s] %s\n" % (now_text(), fmt % args))

    def send_bytes(self, content, content_type, status=HTTPStatus.OK, extra_headers=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(content)

    def send_json(self, payload, status=HTTPStatus.OK, extra_headers=None):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_bytes(data, "application/json; charset=utf-8", status, extra_headers)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        data = self.rfile.read(length).decode("utf-8") if length else "{}"
        return json.loads(data or "{}")

    def session_token(self):
        return parse_cookie(self.headers.get("Cookie", "")).get(SESSION_COOKIE, "")

    def current_user(self, conn):
        return current_user_from_token(conn, self.session_token())

    def authorize(self, conn, path, method):
        if not path.startswith("/api/") or path in PUBLIC_API_PATHS:
            self.user = None
            return True
        user = self.current_user(conn)
        if not user:
            self.send_json({"error": "请先登录", "code": "UNAUTHENTICATED"}, HTTPStatus.UNAUTHORIZED)
            return False
        permission = permission_for_request(method, path)
        if not user_can(user, permission):
            self.send_json({"error": "当前账号没有此操作权限", "code": "FORBIDDEN"}, HTTPStatus.FORBIDDEN)
            return False
        self.user = user
        return True

    def serve_static(self, path):
        if path == "/":
            target = STATIC_DIR / "index.html"
        else:
            requested = unquote(path.lstrip("/"))
            target = (STATIC_DIR / requested).resolve()
            if not str(target).startswith(str(STATIC_DIR.resolve())):
                self.send_error(HTTPStatus.FORBIDDEN)
                return
        if not target.exists() or target.is_dir():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
        }
        self.send_bytes(target.read_bytes(), content_types.get(target.suffix, "application/octet-stream"))

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            init_db()
            with closing(db_connect()) as conn:
                if path == "/api/health":
                    self.send_json({"ok": True, "time": now_text()})
                elif path == "/api/session":
                    user = self.current_user(conn)
                    self.send_json({"authenticated": bool(user), "user": user})
                elif not self.authorize(conn, path, "GET"):
                    return
                elif path == "/api/summary":
                    self.send_json(api_summary(conn))
                elif path == "/api/management-dashboard":
                    self.send_json(api_management_dashboard(conn))
                elif path == "/api/users":
                    self.send_json({"rows": fetch_users(conn)})
                elif path == "/api/backups":
                    self.send_json({"rows": list_backups()})
                elif path == "/api/items":
                    self.send_json({"rows": fetch_items(conn)})
                elif path == "/api/mappings":
                    self.send_json({"rows": fetch_mappings(conn)})
                elif path == "/api/cleaning":
                    self.send_json({"rows": cleaning_rows(conn)})
                elif path == "/api/products":
                    self.send_json({"rows": fetch_products(conn)})
                elif path == "/api/boms":
                    self.send_json({"rows": fetch_boms(conn)})
                elif path == "/api/bom-lines":
                    query = parse_qs(parsed.query)
                    bom_id = int(query.get("bom_id", ["0"])[0] or 0)
                    self.send_json({"rows": fetch_bom_lines(conn, bom_id)})
                elif path == "/api/bom-readiness":
                    query = parse_qs(parsed.query)
                    bom_id = int(query.get("bom_id", ["0"])[0] or 0)
                    order_qty = float(query.get("order_qty", ["1"])[0] or 1)
                    self.send_json(bom_readiness(conn, bom_id, order_qty))
                elif path == "/api/purchase-suggestions":
                    query = parse_qs(parsed.query)
                    bom_id = int(query.get("bom_id", ["0"])[0] or 0)
                    order_qty = float(query.get("order_qty", ["1"])[0] or 1)
                    self.send_json(purchase_suggestions(conn, bom_id, order_qty))
                elif path == "/api/purchase-orders":
                    self.send_json({"rows": fetch_purchase_orders(conn)})
                elif path == "/api/purchase-order-lines":
                    query = parse_qs(parsed.query)
                    po_id_text = query.get("po_id", [""])[0]
                    po_id = int(po_id_text) if po_id_text else None
                    self.send_json({"rows": fetch_purchase_order_lines(conn, po_id)})
                elif path == "/api/inventory":
                    self.send_json({"rows": fetch_inventory(conn)})
                elif path == "/api/inventory-adjustments":
                    self.send_json({"rows": fetch_inventory_adjustments(conn)})
                elif path == "/api/work-orders":
                    self.send_json({"rows": fetch_work_orders(conn)})
                elif path == "/api/work-order-materials":
                    query = parse_qs(parsed.query)
                    work_order_id_text = query.get("work_order_id", [""])[0]
                    work_order_id = int(work_order_id_text) if work_order_id_text else None
                    self.send_json({"rows": fetch_work_order_materials(conn, work_order_id)})
                elif path == "/api/production-reports":
                    query = parse_qs(parsed.query)
                    work_order_id_text = query.get("work_order_id", [""])[0]
                    work_order_id = int(work_order_id_text) if work_order_id_text else None
                    self.send_json({"rows": fetch_production_reports(conn, work_order_id)})
                elif path == "/api/sales-orders":
                    self.send_json({"rows": fetch_sales_orders(conn)})
                elif path == "/api/shipments":
                    query = parse_qs(parsed.query)
                    sales_order_id_text = query.get("sales_order_id", [""])[0]
                    sales_order_id = int(sales_order_id_text) if sales_order_id_text else None
                    self.send_json({"rows": fetch_shipments(conn, sales_order_id)})
                elif path == "/api/quality-inspections":
                    self.send_json({"rows": fetch_quality_inspections(conn)})
                elif path == "/api/quality-defects":
                    query = parse_qs(parsed.query)
                    inspection_id_text = query.get("inspection_id", [""])[0]
                    inspection_id = int(inspection_id_text) if inspection_id_text else None
                    self.send_json({"rows": fetch_quality_defects(conn, inspection_id)})
                elif path == "/api/finance-summary":
                    self.send_json(api_finance_summary(conn))
                elif path == "/api/financial-documents":
                    query = parse_qs(parsed.query)
                    doc_type = query.get("doc_type", [""])[0] or None
                    self.send_json({"rows": fetch_financial_documents(conn, doc_type)})
                elif path == "/api/financial-payments":
                    query = parse_qs(parsed.query)
                    doc_id_text = query.get("doc_id", [""])[0]
                    doc_id = int(doc_id_text) if doc_id_text else None
                    self.send_json({"rows": fetch_financial_payments(conn, doc_id)})
                elif path == "/api/sample-import":
                    rows = read_csv_file(TEMPLATE_DIR / "供应商原始物料导入模板.csv")
                    self.send_json({"rows": rows, "csv": rows_to_csv(rows, IMPORT_FIELDS)})
                elif path == "/api/export/items.csv":
                    csv_text = rows_to_csv(fetch_items(conn), ITEM_FIELDS)
                    self.send_bytes(csv_text.encode("utf-8-sig"), "text/csv; charset=utf-8", extra_headers={"Content-Disposition": "attachment; filename*=UTF-8''items.csv"})
                elif path == "/api/export/cleaning.csv":
                    fields = [key for key in dict(conn.execute("SELECT * FROM cleaning_rows LIMIT 1").fetchone() or {}).keys()]
                    if not fields:
                        fields = ["id", *IMPORT_FIELDS, "match_level", "confidence", "process_status"]
                    csv_text = rows_to_csv(cleaning_rows(conn, limit=10000), fields)
                    filename = quote("cleaning_rows.csv")
                    self.send_bytes(csv_text.encode("utf-8-sig"), "text/csv; charset=utf-8", extra_headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"})
                else:
                    self.serve_static(path)
        except Exception as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            init_db()
            body = self.read_json()
            with closing(db_connect()) as conn:
                if path == "/api/login":
                    result = login_user(conn, body.get("username", "").strip(), body.get("password", ""))
                    if not result:
                        self.send_json({"error": "账号或密码不正确"}, HTTPStatus.UNAUTHORIZED)
                        return
                    self.send_json(
                        {"ok": True, "user": result["user"], "expires_at": result["expires_at"]},
                        extra_headers={"Set-Cookie": session_cookie(result["token"])},
                    )
                elif path == "/api/logout":
                    logout_user(conn, self.session_token())
                    self.send_json({"ok": True}, extra_headers={"Set-Cookie": clear_session_cookie()})
                elif not self.authorize(conn, path, "POST"):
                    return
                elif path == "/api/me/password":
                    change_user_password(conn, self.user["username"], body.get("old_password", ""), body.get("new_password", ""))
                    self.send_json({"ok": True})
                elif path == "/api/backups/create":
                    backup = create_database_backup(conn, self.user["username"])
                    self.send_json({"ok": True, "backup": backup, "rows": list_backups()})
                elif path == "/api/backups/restore":
                    backup_name = body.get("name", "")
                    conn.close()
                    backup = restore_database_backup(backup_name)
                    with closing(db_connect()) as restored_conn:
                        restored_conn.execute(
                            "INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)",
                            ("恢复备份", f"{backup_name} / {self.user['username']}", now_text()),
                        )
                        restored_conn.commit()
                    self.send_json({"ok": True, "backup": backup})
                elif path == "/api/import":
                    rows = body.get("rows")
                    if rows is None:
                        rows = parse_csv_text(body.get("csvText", ""))
                    result = import_supplier_rows(conn, rows, body.get("batchNo"))
                    self.send_json(result)
                elif path == "/api/cleaning/confirm":
                    row_id = int(body.get("id"))
                    row = conn.execute("SELECT * FROM cleaning_rows WHERE id = ?", (row_id,)).fetchone()
                    if not row:
                        self.send_json({"error": "清洗记录不存在"}, HTTPStatus.NOT_FOUND)
                        return
                    if not row["candidate_internal_code"]:
                        self.send_json({"error": "没有候选内部物料，不能直接确认"}, HTTPStatus.BAD_REQUEST)
                        return
                    insert_mapping(conn, {
                        "internal_item_code": row["candidate_internal_code"],
                        "supplier_name": row["supplier_name"],
                        "supplier_item_name": row["raw_item_name"],
                        "supplier_item_code": row["raw_item_code"],
                        "supplier_brand": row["raw_brand"],
                        "supplier_mpn": row["raw_mpn"],
                        "purchase_uom": row["purchase_uom"],
                        "min_order_qty": row["min_order_qty"],
                        "lead_time_days": row["lead_time_days"],
                        "last_price": row["last_price"],
                        "match_status": "已确认",
                        "approved_by": body.get("approvedBy", "系统用户"),
                        "approved_date": datetime.now().strftime("%Y-%m-%d"),
                    })
                    conn.execute("UPDATE cleaning_rows SET process_status = '已确认', updated_at = ? WHERE id = ?", (now_text(), row_id))
                    conn.execute("INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)", ("确认供应商映射", str(row_id), now_text()))
                    conn.commit()
                    self.send_json({"ok": True})
                elif path == "/api/cleaning/create-item":
                    row_id = int(body.get("id"))
                    row = conn.execute("SELECT * FROM cleaning_rows WHERE id = ?", (row_id,)).fetchone()
                    if not row:
                        self.send_json({"error": "清洗记录不存在"}, HTTPStatus.NOT_FOUND)
                        return
                    category = body.get("item_category") or row["parsed_category"] or "OTH"
                    code = generate_item_code(conn, category)
                    standard_name = body.get("standard_name") or row["raw_item_name"]
                    insert_item(conn, {
                        "internal_item_code": code,
                        "item_category": category,
                        "standard_name": standard_name,
                        "item_status": "启用",
                        "base_uom": row["purchase_uom"] or "PCS",
                        "brand": row["raw_brand"],
                        "mpn": row["raw_mpn"],
                        "package": row["parsed_package"],
                        "value_spec": row["parsed_value"],
                        "voltage": row["parsed_voltage"],
                        "environmental_level": body.get("environmental_level", "待确认"),
                        "is_customer_specific": body.get("is_customer_specific", "N"),
                        "default_inspection_rule": body.get("default_inspection_rule", "需品质确认"),
                        "remark": row["remark"],
                    })
                    insert_mapping(conn, {
                        "internal_item_code": code,
                        "supplier_name": row["supplier_name"],
                        "supplier_item_name": row["raw_item_name"],
                        "supplier_item_code": row["raw_item_code"],
                        "supplier_brand": row["raw_brand"],
                        "supplier_mpn": row["raw_mpn"],
                        "purchase_uom": row["purchase_uom"],
                        "min_order_qty": row["min_order_qty"],
                        "lead_time_days": row["lead_time_days"],
                        "last_price": row["last_price"],
                        "match_status": "已确认",
                        "approved_by": body.get("approvedBy", "系统用户"),
                        "approved_date": datetime.now().strftime("%Y-%m-%d"),
                    })
                    conn.execute(
                        """
                        UPDATE cleaning_rows
                        SET candidate_internal_code = ?, candidate_standard_name = ?, process_status = '已建档', updated_at = ?
                        WHERE id = ?
                        """,
                        (code, standard_name, now_text(), row_id),
                    )
                    conn.execute("INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)", ("新建物料", code, now_text()))
                    conn.commit()
                    self.send_json({"ok": True, "internal_item_code": code})
                elif path == "/api/products":
                    payload = {field: body.get(field, "") for field in PRODUCT_FIELDS}
                    if not payload.get("product_code"):
                        self.send_json({"error": "产品编码不能为空"}, HTTPStatus.BAD_REQUEST)
                        return
                    if not payload.get("product_name"):
                        self.send_json({"error": "产品名称不能为空"}, HTTPStatus.BAD_REQUEST)
                        return
                    insert_product(conn, payload)
                    conn.execute("INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)", ("创建产品工程卡", payload["product_code"], now_text()))
                    conn.commit()
                    self.send_json({"ok": True})
                elif path == "/api/boms":
                    payload = {field: body.get(field, "") for field in BOM_FIELDS}
                    if not payload.get("bom_code"):
                        self.send_json({"error": "BOM 编码不能为空"}, HTTPStatus.BAD_REQUEST)
                        return
                    if not payload.get("product_code"):
                        self.send_json({"error": "产品编码不能为空"}, HTTPStatus.BAD_REQUEST)
                        return
                    bom_id = insert_bom(conn, payload)
                    conn.execute("INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)", ("创建 BOM", payload["bom_code"], now_text()))
                    conn.commit()
                    self.send_json({"ok": True, "bom_id": bom_id})
                elif path == "/api/bom-lines":
                    payload = {field: body.get(field, "") for field in BOM_LINE_FIELDS}
                    if not payload.get("bom_id"):
                        self.send_json({"error": "缺少 BOM ID"}, HTTPStatus.BAD_REQUEST)
                        return
                    if not payload.get("internal_item_code"):
                        self.send_json({"error": "内部物料编码不能为空"}, HTTPStatus.BAD_REQUEST)
                        return
                    item = conn.execute("SELECT internal_item_code FROM items WHERE internal_item_code = ?", (payload["internal_item_code"],)).fetchone()
                    if not item:
                        self.send_json({"error": "内部物料不存在，请先建物料"}, HTTPStatus.BAD_REQUEST)
                        return
                    insert_bom_line(conn, payload)
                    conn.execute("INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)", ("新增 BOM 明细", payload["internal_item_code"], now_text()))
                    conn.commit()
                    self.send_json({"ok": True})
                elif path == "/api/purchase-orders/from-shortage":
                    bom_id = int(body.get("bom_id") or 0)
                    order_qty = float(body.get("order_qty") or 0)
                    if not bom_id:
                        self.send_json({"error": "缺少 BOM ID"}, HTTPStatus.BAD_REQUEST)
                        return
                    if order_qty <= 0:
                        self.send_json({"error": "订单数量必须大于 0"}, HTTPStatus.BAD_REQUEST)
                        return
                    result = create_purchase_orders_from_shortage(conn, bom_id, order_qty, body.get("createdBy", "系统用户"))
                    self.send_json(result)
                elif path == "/api/purchase-orders":
                    payload = {field: body.get(field, "") for field in PURCHASE_ORDER_FIELDS}
                    payload["po_code"] = payload.get("po_code") or generate_po_code(conn)
                    payload["po_status"] = payload.get("po_status") or "待收货"
                    if not payload.get("supplier_name"):
                        self.send_json({"error": "供应商不能为空"}, HTTPStatus.BAD_REQUEST)
                        return
                    po_id = insert_purchase_order(conn, payload)
                    for index, line in enumerate(body.get("lines", []), start=1):
                        item_code = line.get("internal_item_code", "")
                        if not item_code:
                            continue
                        item = conn.execute("SELECT internal_item_code FROM items WHERE internal_item_code = ?", (item_code,)).fetchone()
                        if not item:
                            self.send_json({"error": f"内部物料不存在：{item_code}"}, HTTPStatus.BAD_REQUEST)
                            return
                        insert_purchase_order_line(conn, {
                            "po_id": po_id,
                            "line_no": line.get("line_no") or index * 10,
                            "internal_item_code": item_code,
                            "order_qty": line.get("order_qty") or 0,
                            "uom": line.get("uom") or "PCS",
                            "unit_price": line.get("unit_price") or 0,
                            "received_qty": line.get("received_qty") or 0,
                            "line_status": line.get("line_status") or "待收货",
                            "remark": line.get("remark", ""),
                        })
                    conn.execute("INSERT INTO activity_log (action, detail, created_at) VALUES (?, ?, ?)", ("创建采购单", payload["po_code"], now_text()))
                    conn.commit()
                    self.send_json({"ok": True, "po_id": po_id, "po_code": payload["po_code"]})
                elif path == "/api/purchase-receive":
                    line_id = int(body.get("line_id") or 0)
                    receive_qty = float(body.get("receive_qty") or 0)
                    if not line_id:
                        self.send_json({"error": "缺少采购明细 ID"}, HTTPStatus.BAD_REQUEST)
                        return
                    result = receive_purchase_line(conn, line_id, receive_qty)
                    self.send_json(result)
                elif path == "/api/inventory-adjustments":
                    result = create_inventory_adjustment(conn, body)
                    self.send_json(result)
                elif path == "/api/work-orders/from-bom":
                    bom_id = int(body.get("bom_id") or 0)
                    order_qty = float(body.get("order_qty") or 0)
                    if not bom_id:
                        self.send_json({"error": "缺少 BOM ID"}, HTTPStatus.BAD_REQUEST)
                        return
                    result = create_work_order_from_bom(
                        conn,
                        bom_id,
                        order_qty,
                        body.get("owner", "计划员"),
                        body.get("planned_start", ""),
                        body.get("planned_finish", ""),
                    )
                    self.send_json(result)
                elif path == "/api/work-orders/issue-materials":
                    work_order_id = int(body.get("work_order_id") or 0)
                    if not work_order_id:
                        self.send_json({"error": "缺少生产工单 ID"}, HTTPStatus.BAD_REQUEST)
                        return
                    result = issue_work_order_materials(conn, work_order_id)
                    self.send_json(result)
                elif path == "/api/work-orders/complete":
                    work_order_id = int(body.get("work_order_id") or 0)
                    if not work_order_id:
                        self.send_json({"error": "缺少生产工单 ID"}, HTTPStatus.BAD_REQUEST)
                        return
                    result = complete_work_order(
                        conn,
                        work_order_id,
                        body.get("good_qty", 0),
                        body.get("scrap_qty", 0),
                        body.get("operator", ""),
                        body.get("process_stage", "完工入库"),
                    )
                    self.send_json(result)
                elif path == "/api/sales-orders":
                    result = create_sales_order(conn, body)
                    self.send_json(result)
                elif path == "/api/shipments/from-order":
                    sales_order_id = int(body.get("sales_order_id") or 0)
                    if not sales_order_id:
                        self.send_json({"error": "缺少销售订单 ID"}, HTTPStatus.BAD_REQUEST)
                        return
                    result = ship_sales_order(
                        conn,
                        sales_order_id,
                        body.get("ship_qty", 0),
                        body.get("receiver", ""),
                        body.get("ship_date", ""),
                    )
                    self.send_json(result)
                elif path == "/api/quality-inspections":
                    result = create_quality_inspection(conn, body)
                    self.send_json(result)
                elif path == "/api/financial-documents/from-sales-order":
                    result = create_receivable_from_sales_order(conn, body)
                    self.send_json(result)
                elif path == "/api/financial-documents/from-purchase-order":
                    result = create_payable_from_purchase_order(conn, body)
                    self.send_json(result)
                elif path == "/api/financial-payments":
                    result = create_financial_payment(conn, body)
                    self.send_json(result)
                else:
                    self.send_json({"error": "接口不存在"}, HTTPStatus.NOT_FOUND)
        except Exception as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)


def run_server(host, port):
    init_db()
    httpd = ThreadingHTTPServer((host, port), AppHandler)
    print(f"晨亿达 ERP 本地应用已启动: http://{host}:{port}")
    sys.stdout.flush()
    httpd.serve_forever()


def self_test():
    with tempfile.TemporaryDirectory() as temp_dir:
        os.environ["CYD_ERP_DB"] = str(Path(temp_dir) / "test.sqlite3")
        global DB_PATH
        DB_PATH = Path(os.environ["CYD_ERP_DB"])
        init_db()
        with closing(db_connect()) as conn:
            sample_rows = read_csv_file(TEMPLATE_DIR / "供应商原始物料导入模板.csv")
            result = import_supplier_rows(conn, sample_rows, "IMP-SELFTEST")
            summary = api_summary(conn)
            assert summary["total_items"] >= 4, summary
            assert result["count"] == 4, result
            assert summary["auto_count"] >= 2, summary
            assert summary["new_count"] >= 1, summary
        print("SELF_TEST_OK")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--init-db", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--log-file", default="")
    args = parser.parse_args()

    if args.log_file:
        log_path = Path(args.log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_file = log_path.open("a", encoding="utf-8", buffering=1)
        sys.stdout = log_file
        sys.stderr = log_file

    if args.self_test:
        self_test()
        return
    if args.init_db:
        init_db()
        print(f"数据库已初始化: {DB_PATH}")
        return
    run_server(args.host, args.port)


if __name__ == "__main__":
    main()
