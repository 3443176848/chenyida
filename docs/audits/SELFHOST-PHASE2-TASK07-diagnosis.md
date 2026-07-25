# SELFHOST-PHASE2-TASK07 诊断与设计记录

日期：2026-07-25（Asia/Shanghai）

## 恢复点

- `main` HEAD `97d541ecfb7fe6fff551c750c69f5cf30e3ff5bc`，提交消息 `feat: add self-hosted production`，Parent 精确为 `b4a7d5cde06df0b8982e7f120afd9f72c13af8d2`。
- 工作区 clean，本地相对 `origin/main +7/-0`；TASK06 PostgreSQL/Compose/临时 SQLite 已清理，未 push、PR、部署或访问生产。
- `0001`—`0010` checksum 保持提交基线；下一 migration/版本只能是 `0011` / `0.1.0-alpha.7`。

## Legacy 事实与风险

- Python/SQLite 报价用 `customer_name`、`product_code` 和 REAL 金额；无 Customer FK、Material/Unit、版本、幂等或并发保护。
- `convert_quotation_to_sales_order()` 调用会自行 commit 的 `create_sales_order()` 后才更新 Quote，是明确双 commit 窗口；中断会留下孤立 SO。
- SO 以名称/编码关联，可选 BOM/WO 也只做弱校验；没有不可变 Version/Line 或稳定 Quote Source Link。
- 发货直接构造 `FG-{product_code}`，可能自动创建成品，且缺 expected version、稳定锁、幂等、反向记录和服务端职责分离。
- 历史 D1 使用 `erp_records` JSON 和文本库存，仅作行为证据；不得成为 TASK07 新权威或双写目标。

## 设计结论

- 采用 Quote Header→不可变 Version→Line，SO Header→不可变 Version→Line，Quote Source Link 唯一；转换在一个 PostgreSQL 事务创建全部对象并更新 Quote 投影。
- Quote/SO Line 显式保存 Product/Product Version/Finished Material/Unit、数量、单价、金额和 CNY；金额只由 PostgreSQL numeric 计算。
- Shipment/Line 关联 SO Line 与 TASK04 Inventory Adjustment/Ledger；全额冲销追加反向事实。未来 TASK09 只消费 append-only Sales Financial Source，不反推 JSON。
- TASK08 前不创建或伪造 FQC 记录；本任务保留稳定 SO/Shipment 关系供后续 Quality gate 接入。生产部署前必须由 TASK08/业务决定明确是否阻断发货。

## 实施后核验

- 最终实现未写 Python/SQLite、历史 D1 或 `erp_records`，legacy 路由和页面只适配稳定 ID 并委托同一销售 Service。
- Quote 只有 DRAFT 内容可替换；发布、接受、拒绝、过期、取消、转换均追加状态事件。只有 ACCEPTED 当前版本可在单一事务转换且唯一 Link 防止重复 SO。
- Shipment 与全额 reversal 均调用 TASK04 Inventory Service 的既有事务入口；订单投影、Ledger/Balance、金额来源、audit、idem 任一失败均整体回滚。
- `0011` 空库/0010 存量/重复/失败回滚与 generator 一致性通过；`0001`—`0010` 未修改，最终 SHA-256 记录在验收与完成报告。
