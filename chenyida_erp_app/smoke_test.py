import json
import io
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from environment_guard import prepare_test_environment
from openpyxl import Workbook


APP_DIR = Path(__file__).resolve().parent
PORT = 8766
BASE_URL = f"http://127.0.0.1:{PORT}"
SESSION_COOKIE = ""


def request(path, method="GET", payload=None, expected_status=200):
    global SESSION_COOKIE
    data = None
    headers = {}
    if SESSION_COOKIE:
        headers["Cookie"] = SESSION_COOKIE
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(BASE_URL + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            body = response.read()
            status = response.status
            content_type = response.headers.get("Content-Type", "")
            set_cookie = response.headers.get("Set-Cookie")
            if set_cookie:
                SESSION_COOKIE = set_cookie.split(";", 1)[0]
    except urllib.error.HTTPError as exc:
        body = exc.read()
        status = exc.code
        content_type = exc.headers.get("Content-Type", "")
    if status != expected_status:
        raise AssertionError(f"{path} returned {status}, expected {expected_status}: {body!r}")
    if "application/json" in content_type:
        data = json.loads(body.decode("utf-8"))
    else:
        data = body.decode("utf-8")
    if isinstance(data, dict):
        data["_status"] = status
    return data


def request_binary(path, content, expected_status=200):
    global SESSION_COOKIE
    headers = {"Content-Type": "application/octet-stream"}
    if SESSION_COOKIE:
        headers["Cookie"] = SESSION_COOKIE
    req = urllib.request.Request(BASE_URL + path, data=content, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            body = response.read()
            status = response.status
    except urllib.error.HTTPError as exc:
        body = exc.read()
        status = exc.code
    if status != expected_status:
        raise AssertionError(f"{path} returned {status}, expected {expected_status}: {body!r}")
    return json.loads(body.decode("utf-8"))


def sample_xlsx_bytes():
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "物料明细"
    sheet.append(["供应商料号", "物料名称", "规格型号", "品牌", "单位"])
    sheet.append(["SMOKE-XLSX-001", "Smoke Excel 电阻", "10K 0603", "TEST", "PCS"])
    buffer = io.BytesIO()
    workbook.save(buffer)
    workbook.close()
    return buffer.getvalue()


def wait_ready(proc):
    last_error = None
    for _ in range(30):
        if proc.poll() is not None:
            raise RuntimeError(f"server exited early: {proc.returncode}")
        try:
            return request("/api/health")
        except Exception as exc:
            last_error = exc
            time.sleep(0.5)
    raise RuntimeError(f"server not ready: {last_error}")


def main():
    with tempfile.TemporaryDirectory(prefix="chenyida-erp-test-") as temp_dir:
        env = os.environ.copy()
        prepare_test_environment(temp_dir, "smoke.sqlite3", env)
        proc = subprocess.Popen(
            [
                sys.executable,
                str(APP_DIR / "server.py"),
                "--host",
                "127.0.0.1",
                "--port",
                str(PORT),
            ],
            cwd=str(APP_DIR.parent),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
        )
        try:
            wait_ready(proc)
            unauthenticated = request("/api/summary", expected_status=401)
            assert unauthenticated["code"] == "UNAUTHENTICATED", unauthenticated
            session = request("/api/session")
            assert session["authenticated"] is False, session
            login = request("/api/login", method="POST", payload={"username": "admin", "password": "admin123"})
            assert login["user"]["role"] == "admin", login
            session = request("/api/session")
            assert session["authenticated"] is True, session

            summary = request("/api/summary")
            assert summary["total_items"] == 4, summary
            assert summary["total_mappings"] == 2, summary
            assert summary["total_customers"] >= 1, summary
            assert summary["total_suppliers"] >= 1, summary
            assert summary["total_products"] == 1, summary
            assert summary["total_boms"] == 1, summary
            assert summary["total_quotations"] == 0, summary
            assert summary["open_quotations"] == 0, summary
            dashboard = request("/api/management-dashboard")
            assert dashboard["metrics"], dashboard
            backup_result = request("/api/backups/create", method="POST", payload={})
            assert backup_result["backup"]["name"].startswith("erp-backup-"), backup_result
            restored = request("/api/backups/restore", method="POST", payload={"name": backup_result["backup"]["name"]})
            assert restored["backup"]["name"] == backup_result["backup"]["name"], restored
            backups = request("/api/backups")["rows"]
            assert backups, backups
            users = request("/api/users")["rows"]
            assert any(user["username"] == "admin" for user in users), users

            customer = request(
                "/api/customers",
                method="POST",
                payload={
                    "customer_name": "Smoke新增客户",
                    "contact_name": "Smoke联系人",
                    "phone": "13800000000",
                    "payment_terms": "月结45天",
                    "owner": "SmokeTest",
                },
            )
            assert customer["customer_code"].startswith("CUS-"), customer
            supplier = request(
                "/api/suppliers",
                method="POST",
                payload={
                    "supplier_name": "Smoke新增供应商",
                    "supplier_level": "合格供应商",
                    "contact_name": "Smoke供应商联系人",
                    "payment_terms": "月结30天",
                    "owner": "SmokeTest",
                },
            )
            assert supplier["supplier_code"].startswith("SUP-"), supplier
            customers = request("/api/customers")["rows"]
            suppliers = request("/api/suppliers")["rows"]
            assert any(row["customer_name"] == "Smoke新增客户" for row in customers), customers
            assert any(row["supplier_name"] == "Smoke新增供应商" for row in suppliers), suppliers

            html = request("/")
            assert "物料主数据治理工作台" in html
            assert "产品工程" in html
            assert "BOM 管理" in html
            assert "采购与库存" in html
            assert "生产协同" in html
            assert "询价报价" in html
            assert "销售交付" in html
            assert "general-spec-v2" in html
            app_js = request("/app.js")
            styles = request("/styles.css")
            assert "来源详细规格" in app_js
            assert "候选内部规格" in app_js
            assert "原始详细规格" in app_js
            assert "source_spec_tokens_json" in app_js
            assert "candidate_spec_tokens_json" in app_js
            assert ".spec-parts" in styles

            products = request("/api/products")["rows"]
            assert products and products[0]["product_code"] == "CYD-FPC-DEMO-001", products

            boms = request("/api/boms")["rows"]
            assert boms, boms
            bom_id = boms[0]["id"]
            bom_lines = request(f"/api/bom-lines?bom_id={bom_id}")["rows"]
            assert len(bom_lines) >= 3, bom_lines

            readiness = request(f"/api/bom-readiness?bom_id={bom_id}&order_qty=100")
            assert readiness["all_ready"] is True, readiness
            assert len(readiness["rows"]) >= 3, readiness

            shortage = request(f"/api/bom-readiness?bom_id={bom_id}&order_qty=100000")
            assert shortage["all_ready"] is False, shortage
            suggestions = request(f"/api/purchase-suggestions?bom_id={bom_id}&order_qty=100000")
            assert suggestions["suggestions"], suggestions
            created_pos = request(
                "/api/purchase-orders/from-shortage",
                method="POST",
                payload={"bom_id": bom_id, "order_qty": 100000, "createdBy": "SmokeTest"},
            )
            assert created_pos["created"], created_pos
            purchase_orders = request("/api/purchase-orders")["rows"]
            assert purchase_orders, purchase_orders
            purchase_lines = request("/api/purchase-order-lines")["rows"]
            assert purchase_lines, purchase_lines
            first_line = purchase_lines[0]
            inventory_before = request("/api/inventory")["rows"]
            before_item = next(row for row in inventory_before if row["internal_item_code"] == first_line["internal_item_code"])
            received = request(
                "/api/purchase-receive",
                method="POST",
                payload={"line_id": first_line["id"], "receive_qty": 1},
            )
            assert received["after_qty"] == received["before_qty"] + 1, received
            inventory_after = request("/api/inventory")["rows"]
            after_item = next(row for row in inventory_after if row["internal_item_code"] == first_line["internal_item_code"])
            assert float(after_item["on_hand_qty"]) == float(before_item["on_hand_qty"]) + 1, (before_item, after_item)
            adjusted = request(
                "/api/inventory-adjustments",
                method="POST",
                payload={
                    "internal_item_code": first_line["internal_item_code"],
                    "counted_qty": float(after_item["on_hand_qty"]) + 2,
                    "reason": "Smoke盘点",
                    "adjusted_by": "SmokeTest",
                },
            )
            assert adjusted["adjustment_code"].startswith("IA-"), adjusted
            inventory_adjusted = request("/api/inventory")["rows"]
            adjusted_item = next(row for row in inventory_adjusted if row["internal_item_code"] == first_line["internal_item_code"])
            assert float(adjusted_item["on_hand_qty"]) == float(after_item["on_hand_qty"]) + 2, adjusted_item
            adjustments = request("/api/inventory-adjustments")["rows"]
            assert adjustments and adjustments[0]["adjustment_code"] == adjusted["adjustment_code"], adjustments

            work_order = request(
                "/api/work-orders/from-bom",
                method="POST",
                payload={"bom_id": bom_id, "order_qty": 100, "owner": "SmokeTest"},
            )
            assert work_order["work_order_code"].startswith("WO-"), work_order
            work_orders = request("/api/work-orders")["rows"]
            assert work_orders and work_orders[0]["work_order_code"] == work_order["work_order_code"], work_orders
            work_materials = request(f"/api/work-order-materials?work_order_id={work_order['work_order_id']}")["rows"]
            assert len(work_materials) >= 3, work_materials
            first_material = work_materials[0]
            material_inventory_before = request("/api/inventory")["rows"]
            material_before = next(row for row in material_inventory_before if row["internal_item_code"] == first_material["internal_item_code"])
            issued = request(
                "/api/work-orders/issue-materials",
                method="POST",
                payload={"work_order_id": work_order["work_order_id"]},
            )
            assert issued["issued"], issued
            material_inventory_after = request("/api/inventory")["rows"]
            material_after = next(row for row in material_inventory_after if row["internal_item_code"] == first_material["internal_item_code"])
            assert float(material_after["on_hand_qty"]) < float(material_before["on_hand_qty"]), (material_before, material_after)
            completed = request(
                "/api/work-orders/complete",
                method="POST",
                payload={"work_order_id": work_order["work_order_id"], "good_qty": 12, "scrap_qty": 1, "operator": "SmokeTest"},
            )
            assert completed["finished_item_code"] == "FG-CYD-FPC-DEMO-001", completed
            finished_inventory = request("/api/inventory")["rows"]
            finished_item = next(row for row in finished_inventory if row["internal_item_code"] == completed["finished_item_code"])
            assert float(finished_item["on_hand_qty"]) == 12, finished_item
            reports = request(f"/api/production-reports?work_order_id={work_order['work_order_id']}")["rows"]
            assert reports and float(reports[0]["good_qty"]) == 12, reports

            quotation = request(
                "/api/quotations",
                method="POST",
                payload={
                    "customer_name": "Smoke客户",
                    "product_code": "CYD-FPC-DEMO-001",
                    "quote_qty": 2,
                    "unit_price": 88,
                    "valid_until": "2026-12-31",
                    "owner": "SmokeTest",
                },
            )
            assert quotation["quote_code"].startswith("QT-"), quotation
            quotations = request("/api/quotations")["rows"]
            assert quotations and quotations[0]["quote_code"] == quotation["quote_code"], quotations
            assert float(quotations[0]["total_amount"]) == 176, quotations
            converted_order = request(
                "/api/quotations/to-sales-order",
                method="POST",
                payload={"quote_id": quotation["quote_id"], "owner": "SmokeTest"},
            )
            assert converted_order["sales_order_code"].startswith("SO-"), converted_order
            quotations_after = request("/api/quotations")["rows"]
            converted_quote = next(row for row in quotations_after if row["id"] == quotation["quote_id"])
            assert converted_quote["quote_status"] == "已转订单", converted_quote
            assert int(converted_quote["sales_order_id"]) == converted_order["sales_order_id"], converted_quote

            sales_order = request(
                "/api/sales-orders",
                method="POST",
                payload={
                    "customer_name": "Smoke客户",
                    "product_code": "CYD-FPC-DEMO-001",
                    "order_qty": 10,
                    "linked_work_order_id": work_order["work_order_id"],
                    "owner": "SmokeTest",
                },
            )
            assert sales_order["sales_order_code"].startswith("SO-"), sales_order
            sales_orders = request("/api/sales-orders")["rows"]
            assert sales_orders and sales_orders[0]["sales_order_code"] == sales_order["sales_order_code"], sales_orders
            shipped_first = request(
                "/api/shipments/from-order",
                method="POST",
                payload={"sales_order_id": sales_order["sales_order_id"], "ship_qty": 4, "receiver": "Smoke收货人"},
            )
            assert shipped_first["sales_status"] == "部分出货", shipped_first
            inventory_mid = request("/api/inventory")["rows"]
            finished_mid = next(row for row in inventory_mid if row["internal_item_code"] == "FG-CYD-FPC-DEMO-001")
            assert float(finished_mid["on_hand_qty"]) == 8, finished_mid
            shipped_second = request(
                "/api/shipments/from-order",
                method="POST",
                payload={"sales_order_id": sales_order["sales_order_id"], "ship_qty": 6, "receiver": "Smoke收货人"},
            )
            assert shipped_second["sales_status"] == "已出货", shipped_second
            inventory_done = request("/api/inventory")["rows"]
            finished_done = next(row for row in inventory_done if row["internal_item_code"] == "FG-CYD-FPC-DEMO-001")
            assert float(finished_done["on_hand_qty"]) == 2, finished_done
            shipments = request(f"/api/shipments?sales_order_id={sales_order['sales_order_id']}")["rows"]
            assert len(shipments) == 2, shipments
            shipped_quote = request(
                "/api/shipments/from-order",
                method="POST",
                payload={"sales_order_id": converted_order["sales_order_id"], "ship_qty": 2, "receiver": "Smoke报价收货人"},
            )
            assert shipped_quote["sales_status"] == "已出货", shipped_quote
            inventory_quote_done = request("/api/inventory")["rows"]
            finished_quote_done = next(row for row in inventory_quote_done if row["internal_item_code"] == "FG-CYD-FPC-DEMO-001")
            assert float(finished_quote_done["on_hand_qty"]) == 0, finished_quote_done

            receivable = request(
                "/api/financial-documents/from-sales-order",
                method="POST",
                payload={"sales_order_id": sales_order["sales_order_id"], "total_amount": 1200, "created_by": "SmokeTest"},
            )
            assert receivable["doc_code"].startswith("AR-"), receivable
            payable = request(
                "/api/financial-documents/from-purchase-order",
                method="POST",
                payload={"po_id": purchase_orders[0]["id"], "total_amount": 300, "created_by": "SmokeTest"},
            )
            assert payable["doc_code"].startswith("AP-"), payable
            payment_in = request(
                "/api/financial-payments",
                method="POST",
                payload={"doc_id": receivable["doc_id"], "amount": 500, "handled_by": "SmokeTest"},
            )
            assert payment_in["doc_status"] == "部分结清", payment_in
            payment_out = request(
                "/api/financial-payments",
                method="POST",
                payload={"doc_id": payable["doc_id"], "amount": 100, "handled_by": "SmokeTest"},
            )
            assert payment_out["doc_status"] == "部分结清", payment_out
            finance_summary = request("/api/finance-summary")
            assert finance_summary["receivable_balance"] == 700, finance_summary
            assert finance_summary["payable_balance"] == 200, finance_summary
            financial_docs = request("/api/financial-documents")["rows"]
            assert len(financial_docs) == 2, financial_docs
            financial_payments = request("/api/financial-payments")["rows"]
            assert len(financial_payments) == 2, financial_payments

            iqc = request(
                "/api/quality-inspections",
                method="POST",
                payload={
                    "inspection_type": "IQC",
                    "ref_type": "采购明细",
                    "ref_id": first_line["id"],
                    "inspected_qty": 1,
                    "passed_qty": 1,
                    "inspector": "SmokeIQC",
                },
            )
            assert iqc["inspection_status"] == "合格放行", iqc
            ipqc = request(
                "/api/quality-inspections",
                method="POST",
                payload={
                    "inspection_type": "IPQC",
                    "ref_type": "生产工单",
                    "ref_id": work_order["work_order_id"],
                    "inspected_qty": 10,
                    "passed_qty": 9,
                    "defect_type": "外观不良",
                    "disposition": "返工",
                    "responsible_stage": "SMT",
                    "inspector": "SmokeIPQC",
                },
            )
            assert ipqc["inspection_status"] == "返工", ipqc
            fqc = request(
                "/api/quality-inspections",
                method="POST",
                payload={
                    "inspection_type": "FQC",
                    "ref_type": "销售订单",
                    "ref_id": sales_order["sales_order_id"],
                    "inspected_qty": 10,
                    "passed_qty": 10,
                    "inspector": "SmokeFQC",
                },
            )
            assert fqc["inspection_status"] == "合格放行", fqc
            quality_rows = request("/api/quality-inspections")["rows"]
            assert len(quality_rows) == 3, quality_rows
            defects = request("/api/quality-defects")["rows"]
            assert defects and defects[0]["defect_type"] == "外观不良", defects

            request(
                "/api/products",
                method="POST",
                payload={
                    "product_code": "TEST-PRODUCT-001",
                    "product_name": "烟测产品",
                    "customer_name": "烟测客户",
                    "product_type": "FPC+SMT",
                    "product_version": "A0",
                    "lifecycle_status": "样品",
                    "smt_required": "Y",
                },
            )
            created_bom = request(
                "/api/boms",
                method="POST",
                payload={
                    "bom_code": "TEST-BOM-PRODUCT-001-A0",
                    "product_code": "TEST-PRODUCT-001",
                    "bom_version": "A0",
                    "bom_status": "草稿",
                },
            )
            request(
                "/api/bom-lines",
                method="POST",
                payload={
                    "bom_id": created_bom["bom_id"],
                    "line_no": 10,
                    "internal_item_code": "CYD-CAP-000001",
                    "qty_per": 2,
                    "uom": "PCS",
                    "process_stage": "SMT",
                    "loss_rate": 0.03,
                },
            )

            sample = request("/api/sample-import")
            result = request("/api/import", method="POST", payload={"csvText": sample["csv"], "batchNo": "TEST-IMPORT-SMOKE"})
            assert result["count"] == 4, result

            xlsx_result = request_binary(
                "/api/import-file?filename=smoke.xlsx&batch_no=TEST-XLSX-SMOKE",
                sample_xlsx_bytes(),
            )
            assert xlsx_result["source_type"] == "XLSX", xlsx_result
            assert xlsx_result["selected_sheet"] == "物料明细", xlsx_result
            assert xlsx_result["count"] == 1, xlsx_result

            summary = request("/api/summary")
            assert summary["pending"] == 5, summary
            assert summary["auto_count"] >= 2, summary
            assert summary["suspect_count"] >= 1, summary
            assert summary["new_count"] >= 1, summary

            cleaning = request("/api/cleaning")["rows"]
            confidence_desc = request("/api/cleaning?confidence_sort=desc")
            confidence_asc = request("/api/cleaning?confidence_sort=asc")
            confidence_fallback = request("/api/cleaning?confidence_sort=not-valid")
            assert confidence_desc["confidence_sort"] == "desc", confidence_desc
            assert confidence_asc["confidence_sort"] == "asc", confidence_asc
            assert confidence_fallback["confidence_sort"] == "newest", confidence_fallback
            assert [row["confidence"] for row in confidence_desc["rows"]] == sorted(
                [row["confidence"] for row in confidence_desc["rows"]],
                reverse=True,
            ), confidence_desc
            assert [row["confidence"] for row in confidence_asc["rows"]] == sorted(
                [row["confidence"] for row in confidence_asc["rows"]],
            ), confidence_asc
            auto_row = next(row for row in cleaning if row["match_level"] == "自动匹配")
            request("/api/cleaning/confirm", method="POST", payload={"id": auto_row["id"], "approvedBy": "SmokeTest"})

            new_row = next(row for row in cleaning if row["match_level"] == "新物料")
            created = request(
                "/api/cleaning/create-item",
                method="POST",
                payload={
                    "id": new_row["id"],
                    "item_category": new_row["parsed_category"] or "OTH",
                    "standard_name": new_row["raw_item_name"],
                    "approvedBy": "SmokeTest",
                },
            )
            assert created["internal_item_code"].startswith("CYD-"), created
            created_item = next(
                row
                for row in request("/api/items")["rows"]
                if row["internal_item_code"] == created["internal_item_code"]
            )
            assert created_item["value_spec"] == new_row["raw_spec"], created_item

            final_summary = request("/api/summary")
            assert final_summary["total_items"] == 6, final_summary
            assert final_summary["total_mappings"] >= 4, final_summary
            assert final_summary["total_customers"] >= 2, final_summary
            assert final_summary["total_suppliers"] >= 2, final_summary
            assert final_summary["total_products"] == 2, final_summary
            assert final_summary["total_boms"] == 2, final_summary
            assert final_summary["total_pos"] >= 1, final_summary
            assert final_summary["open_pos"] >= 1, final_summary
            assert final_summary["total_work_orders"] >= 1, final_summary
            assert final_summary["active_work_orders"] >= 1, final_summary
            assert final_summary["total_quotations"] >= 1, final_summary
            assert final_summary["open_quotations"] == 0, final_summary
            assert final_summary["total_sales_orders"] >= 2, final_summary
            assert final_summary["open_sales_orders"] == 0, final_summary
            assert final_summary["total_quality_inspections"] == 3, final_summary
            assert final_summary["open_quality_issues"] == 1, final_summary

            request(
                "/api/import",
                method="POST",
                payload={
                    "batchNo": "TEST-IMPORT-REVIEW-GUARDS",
                    "rows": [
                        {"raw_item_name": "Smoke缺规格", "purchase_uom": "PCS"},
                        {"raw_item_name": "Smoke缺单位", "raw_spec": "2.54mm"},
                    ],
                },
            )
            guard_rows = request("/api/cleaning")["rows"]
            missing_spec = next(row for row in guard_rows if row["raw_item_name"] == "Smoke缺规格")
            spec_block = request(
                "/api/cleaning/create-item",
                method="POST",
                payload={"id": missing_spec["id"], "item_category": "OTH", "standard_name": "Smoke缺规格"},
                expected_status=400,
            )
            assert spec_block["code"] == "SPECIFICATION_REVIEW_REQUIRED", spec_block
            missing_unit = next(row for row in guard_rows if row["raw_item_name"] == "Smoke缺单位")
            unit_block = request(
                "/api/cleaning/create-item",
                method="POST",
                payload={"id": missing_unit["id"], "item_category": "OTH", "standard_name": "Smoke缺单位"},
                expected_status=400,
            )
            assert unit_block["code"] == "MATERIAL_UNIT_REQUIRED", unit_block

            clear_without_confirmation = request(
                "/api/cleaning/clear",
                method="POST",
                payload={},
                expected_status=400,
            )
            assert clear_without_confirmation["code"] == "CLEANING_CLEAR_CONFIRMATION_REQUIRED", clear_without_confirmation
            assert request("/api/cleaning")["rows"], "confirmation failure must preserve cleaning rows"
            cleared = request(
                "/api/cleaning/clear",
                method="POST",
                payload={"confirmation": "CLEAR_CLEANING_ROWS"},
            )
            assert cleared["deleted_count"] > 0, cleared
            assert cleared["backup"]["name"].startswith("erp-backup-"), cleared
            assert request("/api/cleaning")["rows"] == [], cleared

            print("SMOKE_TEST_OK")
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    main()
