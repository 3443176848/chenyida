# SELFHOST-PHASE2-TASK10 API 覆盖复核

复核日期：2026-07-25（Asia/Shanghai）
基线：Python `AppHandler` 64 个操作（GET 34 / POST 30）；Node/PostgreSQL `0.1.0-alpha.10`；migration `0001`—`0013`。

## 口径与结论

- `COVERED`：同路径兼容适配或新的稳定资源 API 委托关系化 PostgreSQL 服务；兼容 DTO 不改变权威数据源。
- `REPLACED`：旧查询不再返回旧事实，返回稳定替代状态/只读治理投影。
- `RETIRED`：危险或绕过新工作流的旧操作有意退出，返回稳定 409/410 和中文替代说明；不算未知路由。
- 静态断言确认清单仍为 64 项且每项有显式路由；同一隔离 Compose 中对 `refreshAll()` 的 23 个 GET 逐项发起实际请求，全部非 404、均通过认证/权限边界。原生根页不调用该批请求。

最终统计：`COVERED` 52、`REPLACED` 2、`RETIRED` 10、未知/404 0。所有业务事实来自 TASK02—TASK09 关系表；没有读取 `erp_records`、Python/SQLite 或历史 D1。

证据缩写：`S64`=`tests/selfhost-api-coverage.test.mjs`；`R23`=`scripts/selfhost-dashboard-compose-smoke.mjs` 实际 23 GET；`PGxx`=对应 TASK02—TASK09 PostgreSQL/API 测试；`FULL`=同库全域 Compose 编排；`B/R`=隔离 backup/restore 演练。

## 身份、系统与运维（11）

| ID | Legacy method/path | 自托管等价入口 | 状态 | 权威源 / 权限 | 降级或有意禁止 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| S01 | `GET /api/health` | 同路径 | COVERED | PG/Storage/Worker 状态；public | 无 | S64、Compose health |
| S02 | `GET /api/session` | 同路径 | COVERED | `app_users/app_sessions`；Cookie | 无 | S64、PG02、FULL |
| S03 | `GET /api/summary` | 同路径 | COVERED | Dashboard 一致只读快照；`dashboard.read` + 角色域 | 无 | S64、R23、Dashboard PG、FULL |
| S04 | `GET /api/management-dashboard` | 同路径 | COVERED | 同一 Dashboard Service；`dashboard.management.read` | 无权限为 403，不泄露跨域值 | S64、Dashboard unit/PG、FULL |
| S05 | `GET /api/users` | 同路径 | COVERED | `app_users`；`system.user.read` | 不返回密码摘要 | S64、PG02、FULL |
| S06 | `GET /api/backups` | `/api/backups` / `/api/backup-governance` | REPLACED | 只读可信 manifest；admin `system.backup.read` | 不列目录/制品，不声称跨故障域 | S64、Dashboard unit、B/R |
| S07 | `POST /api/login` | 同路径 | COVERED | Identity Service/PG；public+限流 | 无 | S64、PG02、FULL |
| S08 | `POST /api/logout` | 同路径 | COVERED | session 摘要；当前会话 | 无 | S64、PG02 |
| S09 | `POST /api/me/password` | 同路径 | COVERED | user version/session revoke/audit；本人 | 强密码、CSRF、幂等、CAS | S64、PG02、FULL |
| S10 | `POST /api/backups/create` | 同路径稳定 409；离线 `backup-selfhost.sh` | RETIRED | 无浏览器写权限 | `OFFLINE_OPERATION_REQUIRED` | S64、Dashboard unit、FULL、B/R |
| S11 | `POST /api/backups/restore` | 同路径稳定 409；离线 `restore-selfhost.sh` | RETIRED | 仅新空非生产目标 | `IN_PLACE_RESTORE_FORBIDDEN` | S64、Dashboard unit、B/R |

## 物料、主数据与工程（22）

| ID | Legacy method/path | 自托管等价入口 | 状态 | 权威源 / 权限 | 降级或有意禁止 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| M01 | `GET /api/items` | 同路径 ACTIVE Material 投影 | COVERED | `material_master`；`material.read` | 无 | S64、R23、PG Material/Master |
| M02 | `GET /api/mappings` | 同路径 | COVERED | Supplier/Material/Unit mapping；`master.supplier_mapping.read` | 无 | S64、R23、PG03 |
| M03 | `GET /api/cleaning` | 同路径返回 `REPLACED`，入口 `/materials/imports` | REPLACED | 无旧 cleaning 事实；`material.read` | 空 rows + 明确替代，不造假 | S64、R23、FULL |
| M04 | `GET /api/products` | 同路径 | COVERED | Product/Version；`master.product.read` | 无 | S64、R23、PG03 |
| M05 | `GET /api/customers` | 同路径 | COVERED | Customer；`master.customer.read` | 无 | S64、R23、PG03 |
| M06 | `GET /api/suppliers` | 同路径 | COVERED | Supplier；`master.supplier.read` | 无 | S64、R23、PG03 |
| M07 | `GET /api/boms` | 同路径 | COVERED | BOM Header/Version；`master.bom.read` | 无 | S64、R23、PG03 |
| M08 | `GET /api/bom-lines` | 同路径 | COVERED | BOM Line + Material/Unit + 库存投影；`master.bom.read` | 使用稳定 ID/numeric | S64、PG03/04、FULL |
| M09 | `GET /api/bom-readiness` | 同路径 | COVERED | Released BOM + Inventory Balance；`master.bom.read` | 无跨单位伪汇总 | S64、PG03/04、FULL |
| M10 | `GET /api/sample-import` | 同路径稳定 410 | RETIRED | 无业务事实 | 新 Import Workspace 取代固定样例 | S64、Dashboard unit |
| M11 | `GET /api/export/items.csv` | 同路径稳定 410 | RETIRED | 无导出 | 未经批准不恢复批量数据披露 | S64、Dashboard unit |
| M12 | `GET /api/export/cleaning.csv` | 同路径稳定 410 | RETIRED | 无导出 | Review UI/有界 API 取代 | S64、Dashboard unit |
| M13 | `POST /api/import` | 稳定 410；`/api/material-master/import-batches` | RETIRED | Import Batch 服务；细粒度 import 权限 | 禁止旧直写 cleaning | S64、Import PG/Compose |
| M14 | `POST /api/import-file` | 稳定 410；Batch file/parse 链 | RETIRED | FileStorage + Import；import create/parse | 禁止一步直写 | S64、Import PG/Compose |
| M15 | `POST /api/cleaning/clear` | 同路径稳定 410 | RETIRED | 无删除 | 禁止批量破坏性清空 | S64、Dashboard unit |
| M16 | `POST /api/cleaning/confirm` | 稳定 410；Review bind | RETIRED | Review/Mapping Service；review bind | 禁止弱校验直接确认 | S64、Review PG/Compose |
| M17 | `POST /api/cleaning/create-item` | 稳定 410；Review create-draft | RETIRED | Material Draft/Review；review create_draft | 禁止绕过审核直接 ACTIVE | S64、Review PG/Compose |
| M18 | `POST /api/products` | 同路径 | COVERED | Product Header/Version；`master.product.manage` | CSRF/幂等/CAS | S64、PG03/FULL |
| M19 | `POST /api/customers` | 同路径 | COVERED | Customer；`master.customer.manage` | 稳定 ID，不按名称 upsert | S64、PG03/FULL |
| M20 | `POST /api/suppliers` | 同路径 | COVERED | Supplier；`master.supplier.manage` | 稳定 ID，不按名称 upsert | S64、PG03/FULL |
| M21 | `POST /api/boms` | 同路径 | COVERED | BOM Header/Draft Version；`master.bom.manage` | 发布后不可原地改 | S64、PG03/FULL |
| M22 | `POST /api/bom-lines` | 同路径 | COVERED | BOM Draft Line；`master.bom.manage` | ACTIVE Material/Unit 服务端校验 | S64、PG03/FULL |

## 采购与库存（9）

| ID | Legacy method/path | 自托管等价入口 | 状态 | 权威源 / 权限 | 降级或有意禁止 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| P01 | `GET /api/purchase-suggestions` | 同路径 | COVERED | BOM/Balance/Mapping/Price；`procurement.read` | 显式 READY/BLOCKED | S64、PG05 |
| P02 | `GET /api/purchase-orders` | 同路径 | COVERED | PO Header/Line/Event；`procurement.read` | 无 | S64、R23、PG05/FULL |
| P03 | `GET /api/purchase-order-lines` | 同路径 | COVERED | PO Line；`procurement.read` | 无 | S64、R23、PG05 |
| P04 | `GET /api/inventory` | 同路径 | COVERED | Ledger 可重建 Balance；`inventory.read` | 无 | S64、R23、PG04/FULL |
| P05 | `GET /api/inventory-adjustments` | 同路径 | COVERED | Adjustment/Ledger；`inventory.read` | 有界列表 | S64、R23、PG04 |
| P06 | `POST /api/purchase-orders/from-shortage` | 同路径 | COVERED | Procurement Service；`procurement.plan/order` | 无自动副作用读取 | S64、PG05 |
| P07 | `POST /api/purchase-orders` | 同路径 | COVERED | PO/Line/Event；`procurement.order` | 事务、幂等、CAS | S64、PG05/FULL |
| P08 | `POST /api/purchase-receive` | 同路径 adapter → Receipt Service | COVERED | Receipt + Ledger/Balance；`procurement.receive` | 已过账更正仅 reversal | S64、PG05/FULL |
| P09 | `POST /api/inventory-adjustments` | 同路径 | COVERED | Adjustment + Ledger/Balance；`inventory.adjust` | 不直接覆盖 balance | S64、PG04/FULL |

## 生产（6）

| ID | Legacy method/path | 自托管等价入口 | 状态 | 权威源 / 权限 | 降级或有意禁止 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| W01 | `GET /api/work-orders` | 同路径 | COVERED | WO/BOM Snapshot；`production.read` | 无 | S64、R23、PG06/FULL |
| W02 | `GET /api/work-order-materials` | 同路径 | COVERED | Requirement/Issue/Return；`production.read` | 无 | S64、R23、PG06 |
| W03 | `GET /api/production-reports` | 同路径 | COVERED | Report；`production.read` | 无 | S64、R23、PG06 |
| W04 | `POST /api/work-orders/from-bom` | 同路径 adapter → `/api/work-orders` | COVERED | WO + immutable BOM snapshot；`production.plan` | 稳定成品 Material ID | S64、PG06/FULL |
| W05 | `POST /api/work-orders/issue-materials` | 同路径 adapter → material issue | COVERED | Issue + Ledger/Balance；`production.issue` | 支持受控部分领料/反向 | S64、PG06/FULL |
| W06 | `POST /api/work-orders/complete` | 同路径 adapter → report/completion | COVERED | Report/Completion + Ledger；`production.report/complete` | 不原地改完工 | S64、PG06/FULL |

## 销售（7）

| ID | Legacy method/path | 自托管等价入口 | 状态 | 权威源 / 权限 | 降级或有意禁止 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| A01 | `GET /api/quotations` | 同路径 | COVERED | Quote/Version/Line；`sales.read` | 无 | S64、R23、PG07/FULL |
| A02 | `GET /api/sales-orders` | 同路径 | COVERED | SO/Version/Line；`sales.read` | 无 | S64、R23、PG07/FULL |
| A03 | `GET /api/shipments` | 同路径 | COVERED | Shipment/Line/Reversal；`sales.read` | 无 | S64、R23、PG07/FULL |
| A04 | `POST /api/quotations` | 同路径 | COVERED | Quote Service；`sales.quote` | numeric + 稳定 ID | S64、PG07/FULL |
| A05 | `POST /api/quotations/to-sales-order` | 同路径 adapter → accept/convert | COVERED | Quote→SO 单事务；`sales.order` | 唯一来源/幂等 | S64、PG07/FULL |
| A06 | `POST /api/sales-orders` | 同路径 | COVERED | SO Service；`sales.order` | 无 | S64、PG07 |
| A07 | `POST /api/shipments/from-order` | 同路径 adapter → Shipment Service | COVERED | Shipment + FQC + Ledger；`sales.ship` | FQC 门禁/反向记录 | S64、PG07/08/FULL |

## 品质（3）

| ID | Legacy method/path | 自托管等价入口 | 状态 | 权威源 / 权限 | 降级或有意禁止 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| Q01 | `GET /api/quality-inspections` | 同路径 | COVERED | Inspection/Result/Event；`quality.read` | 角色域裁剪 | S64、R23、PG08/FULL |
| Q02 | `GET /api/quality-defects` | 同路径 | COVERED | Defect + Inspection；`quality.read` | 有界只读 | S64、R23、PG08 |
| Q03 | `POST /api/quality-inspections` | 同路径 | COVERED | IQC/IPQC/FQC Service；`quality.inspect` | 稳定来源、处置/关闭追加历史 | S64、PG08/FULL |

## 财务（6）

| ID | Legacy method/path | 自托管等价入口 | 状态 | 权威源 / 权限 | 降级或有意禁止 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| F01 | `GET /api/finance-summary` | 同路径 | COVERED | Finance Document/Settlement；`finance.read` | decimal 字符串 | S64、R23、PG09/FULL |
| F02 | `GET /api/financial-documents` | 同路径 | COVERED | AR/AP Document；`finance.read` | 无 | S64、R23、PG09/FULL |
| F03 | `GET /api/financial-payments` | 同路径 | COVERED | Settlement/Reversal；`finance.read` | 不可变历史 | S64、R23、PG09/FULL |
| F04 | `POST /api/financial-documents/from-sales-order` | 同路径 adapter → AR from Shipment source | COVERED | Finance Service；`finance.post` | 不接受手工覆盖权威金额 | S64、PG09/FULL |
| F05 | `POST /api/financial-documents/from-purchase-order` | 同路径 adapter → AP from Receipt source | COVERED | Finance Service；`finance.post` | 不按未收订单过账 | S64、PG09/FULL |
| F06 | `POST /api/financial-payments` | 同路径 | COVERED | Settlement Service；`finance.pay` | numeric、CAS、冲销而非改写 | S64、PG09/FULL |

## Legacy `refreshAll()` 23 GET 运行结果

`summary/items/mappings/cleaning/products/customers/suppliers/boms/purchase-orders/purchase-order-lines/inventory/inventory-adjustments/work-orders/work-order-materials/production-reports/quotations/sales-orders/shipments/quality-inspections/quality-defects/finance-summary/financial-documents/financial-payments` 共 23 项。

在全域合成事实创建后与备份恢复后的新 Compose 目标中各运行一次，均返回 200；`cleaning` 明确返回 `deprecated=true,status=REPLACED`，其他 22 项返回受服务端权限保护的关系化数据。原生根 UI 契约确认无 iframe、无 `refreshAll`/`Promise.all` 批请求依赖，单卡失败独立呈现。
