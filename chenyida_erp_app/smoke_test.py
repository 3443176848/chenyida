import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


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
    with tempfile.TemporaryDirectory() as temp_dir:
        env = os.environ.copy()
        env["CYD_ERP_DB"] = str(Path(temp_dir) / "smoke.sqlite3")
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
            assert summary["total_products"] == 1, summary
            assert summary["total_boms"] == 1, summary
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

            html = request("/")
            assert "物料主数据治理工作台" in html
            assert "产品工程" in html
            assert "BOM 管理" in html
            assert "采购与库存" in html
            assert "生产协同" in html
            assert "销售交付" in html

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
                payload={"work_order_id": work_order["work_order_id"], "good_qty": 10, "scrap_qty": 1, "operator": "SmokeTest"},
            )
            assert completed["finished_item_code"] == "FG-CYD-FPC-DEMO-001", completed
            finished_inventory = request("/api/inventory")["rows"]
            finished_item = next(row for row in finished_inventory if row["internal_item_code"] == completed["finished_item_code"])
            assert float(finished_item["on_hand_qty"]) == 10, finished_item
            reports = request(f"/api/production-reports?work_order_id={work_order['work_order_id']}")["rows"]
            assert reports and float(reports[0]["good_qty"]) == 10, reports

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
            assert float(finished_mid["on_hand_qty"]) == 6, finished_mid
            shipped_second = request(
                "/api/shipments/from-order",
                method="POST",
                payload={"sales_order_id": sales_order["sales_order_id"], "ship_qty": 6, "receiver": "Smoke收货人"},
            )
            assert shipped_second["sales_status"] == "已出货", shipped_second
            inventory_done = request("/api/inventory")["rows"]
            finished_done = next(row for row in inventory_done if row["internal_item_code"] == "FG-CYD-FPC-DEMO-001")
            assert float(finished_done["on_hand_qty"]) == 0, finished_done
            shipments = request(f"/api/shipments?sales_order_id={sales_order['sales_order_id']}")["rows"]
            assert len(shipments) == 2, shipments

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
                    "product_code": "CYD-SMOKE-PROD-001",
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
                    "bom_code": "BOM-CYD-SMOKE-PROD-001-A0",
                    "product_code": "CYD-SMOKE-PROD-001",
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
            result = request("/api/import", method="POST", payload={"csvText": sample["csv"], "batchNo": "IMP-SMOKE"})
            assert result["count"] == 4, result

            summary = request("/api/summary")
            assert summary["pending"] == 4, summary
            assert summary["auto_count"] >= 2, summary
            assert summary["suspect_count"] >= 1, summary
            assert summary["new_count"] >= 1, summary

            cleaning = request("/api/cleaning")["rows"]
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

            final_summary = request("/api/summary")
            assert final_summary["total_items"] == 6, final_summary
            assert final_summary["total_mappings"] >= 4, final_summary
            assert final_summary["total_products"] == 2, final_summary
            assert final_summary["total_boms"] == 2, final_summary
            assert final_summary["total_pos"] >= 1, final_summary
            assert final_summary["open_pos"] >= 1, final_summary
            assert final_summary["total_work_orders"] >= 1, final_summary
            assert final_summary["active_work_orders"] >= 1, final_summary
            assert final_summary["total_sales_orders"] >= 1, final_summary
            assert final_summary["open_sales_orders"] == 0, final_summary
            assert final_summary["total_quality_inspections"] == 3, final_summary
            assert final_summary["open_quality_issues"] == 1, final_summary

            print("SMOKE_TEST_OK")
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    main()
