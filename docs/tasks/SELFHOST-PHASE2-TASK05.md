# SELFHOST-PHASE2-TASK05：自托管采购、缺料建议与收货

状态：`DONE`（非生产；以独立提交承载最终验收结果）

开始日期：2026-07-25（Asia/Shanghai）

负责人：Codex（诊断、实现、隔离测试、文档与本地提交），项目负责人（通过连续任务指令批准范围与最低边界）

## 1. 起始基线

- Branch：`main`；Task start HEAD：`41b451de04d4bc4b5e3f6fe765ff64fbc19a9121`。
- 起始工作区 clean；本地 `main` 相对 `origin/main +5/-0`；无 gitlink、submodule 或嵌套仓库。
- 自托管版本 `chenyida-erp-selfhosted@0.1.0-alpha.4`；PostgreSQL `0001`—`0008`，下一合法版本为 `0009_procurement.sql`。

## 2. 任务范围

- 关系化 Purchase Order Header/Line、来源 Link、状态事件、Receipt Header/Line、Receipt Reversal 和 append-only 财务来源条目。
- 缺料建议只读取 RELEASED BOM 当前版本、TASK04 可用库存、ACTIVE Supplier Mapping 和当前有效价格；返回稳定内部 ID 与阻断原因。
- 支持手工创建 PO、按缺料按 Supplier/Currency 分组创建 PO、部分/全部收货和一次全额冲销。
- 收货/冲销必须在同一 PostgreSQL 事务更新 Receipt、PO Line/Header 投影、库存 Ledger/Balance、状态事件、财务来源、审计和幂等结果。
- 复用 TASK04 Inventory Service 的事务内边界，不复制库存余额 SQL。

## 3. 固定业务边界

- PO 创建后首期直接为 `OPEN`；仅在尚未收货的 `OPEN` 状态允许携带 `expected_version` 修改 `expected_at` 和 `remark`，Line 与供应商/币种/数量/价格等业务事实不可修改、删除或取消。状态由 `OPEN -> PARTIALLY_RECEIVED -> RECEIVED -> CLOSED` 及未关闭订单冲销后的反向投影变化。
- Material 必须 ACTIVE/STOCKED，Supplier 必须 ACTIVE；PO 和收货只允许 Material 启用基础单位。Supplier Mapping 必须 ACTIVE、在有效期内、1:1 基础单位；TASK05 不实现单位换算。
- 价格使用 `numeric(24,6)`，一张 PO 只有一个三位大写 currency code；数量使用 `numeric(24,6)`。缺少有效 Mapping/价格时建议标为 BLOCKED，不静默选择“未指定供应商”或零价格。
- 同一 PO 不允许重复 Material；收货请求只包含同一 PO、Material 不重复的 1—100 行，并携带 PO Line expected version 和 Inventory balance expected version。
- 收货不得超过未收数量；Receipt/Line、库存 Ledger 和财务来源只追加。原 Receipt 最多一次全额冲销，冲销本身不可再次冲销；冲销必须满足当前库存不变式。
- 财务来源条目只提供 TASK09 可追溯的正/反向金额事实，不创建应付、发票、付款或结算。

## 4. API、权限与验收

- 兼容：`GET /api/purchase-suggestions|purchase-orders|purchase-order-lines`、`POST /api/purchase-orders|purchase-orders/from-shortage|purchase-receive`。
- 新路径：PO detail、Receipt list/detail/create/reversal；具体路径在实现与完成报告中固定。
- `procurement.read`、`procurement.plan`、`procurement.order`、`procurement.receive`、`procurement.reverse` 分离；purchase/manager/admin 可全域，warehouse 仅 read/receive/reverse，其他业务角色只读。
- 验收覆盖 unit、legacy UI contract、PostgreSQL/API、migration、权限、CSRF、幂等、并发、失败回滚、库存/PO/财务来源一致性、Compose smoke/restart 和适用回归。

## 5. 禁止事项

不迁移真实 PO/在途/库存；不自动生成 AP、付款或财务单据；不实现供应商门户、询价、审批、多币种换算、税、退货或单位换算；不访问生产、不部署、不 push、不创建 PR。
