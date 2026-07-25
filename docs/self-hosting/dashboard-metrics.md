# 自托管经营看板指标口径

`DashboardRepository` 在单个 PostgreSQL `REPEATABLE READ READ ONLY` 事务中读取 0013 权威关系表；不读 `erp_records`、Python/SQLite、D1 或浏览器计算结果。列表最大 20/30 条，数量和金额保持 PostgreSQL decimal 字符串。

| 数据域 | 指标 | 权威来源与口径 |
| --- | --- | --- |
| Material | ACTIVE 物料、映射、草稿/待审核、导入复核分流 | `material_master`、`supplier_mappings`、`material_import_review_rows` |
| Partners | ACTIVE Customer/Supplier | `customers.status`、`suppliers.status` |
| Engineering | RELEASED Product、有效 BOM | `product_versions.status=RELEASED`；`bom_versions=RELEASED` 且 header ACTIVE |
| Inventory | 有库存物料种类、零可用种类、按单位 on-hand/available/frozen | `inventory_stock_balances` + `units`；最多 20 个单位；不同单位不相加 |
| Procurement | PO 总数/未完成 PO、待收货量 | `purchase_orders`；OPEN/PARTIALLY_RECEIVED line 的 `order_qty-received_qty` |
| Production | WO 总数/活动 WO、待领料、待完工、缺料需求数 | `production_work_orders`、`production_material_requirements`；仅非终态 |
| Sales | Quote/SO 总数/未关闭数、待发货量 | `sales_quotations`、`sales_orders`；`ordered_qty-shipped_qty` |
| Quality | IQC/IPQC/FQC 待处理、未关闭异常 | `quality_inspections`；OPEN 分类与 HOLD/failed 异常 |
| Finance | AR/AP 总额、已结、余额；净收款/付款 | `finance_documents`、`finance_settlements`；reversal 负事实计入净额 |
| Operations | pending/failed jobs、migration 状态 | `background_jobs`、`schema_migrations` |
| Events | 最近受控业务事件 | 五类 status/event 表 union，最多 30；仅 domain/action/object code/actor/request id/time |
| Audit | 最近系统审计 | `audit_log`，最多 12；只在 `system.audit.read` 下返回安全字段，不返回 detail JSON |
| Backup | 最近成功校验 | 只读受信 `latest.json`；无文件路径、URL、连接串或正文 |

`dashboard.read` 仅允许读取角色对应数据域。admin/manager/operations 另有 `dashboard.management.read`；系统审计继续要求 `system.audit.read`，备份状态保持 admin-only `system.backup.read`。兼容扁平字段也按相同 domain 裁剪，浏览器隐藏不是授权边界。
