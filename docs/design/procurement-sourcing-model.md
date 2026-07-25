# 采购询比价与人工定标关系模型（TASK04）

状态：`IMPLEMENTED / PENDING PARALLEL ACCEPTANCE`

## 聚合与稳定引用

- `procurement_rfqs` 是采购申请某一询价 Round 的聚合根；只引用最新 `ACCEPTED` `planning_purchase_requests.id`，以 `source_purchase_request_version` 和 `source_digest` 固化来源。
- `procurement_rfq_lines` 一对一引用采购申请行，并固化稳定 Material、Unit、数量和需求日期；`procurement_rfq_suppliers` 只引用 ACTIVE Supplier，并保存完整 1:1 Supplier Mapping 集合摘要。
- RFQ 发出后范围、行和邀请不可改。相同采购申请由部分唯一索引限制同时只有一个 DRAFT/ISSUED Round；撤销定标后只能新建下一 Round。

## 报价、比较与定标

- 报价头/行关系化保存，首期固定 CNY。每家供应商每个 RFQ 只有一个当前 `SUBMITTED` 报价；改价把旧版本置为 `SUPERSEDED` 并追加新版本，报价正文与行不可修改或删除。
- 比较以 RFQ Line 为粒度保存版本和 `basis_digest`。比较行由 PostgreSQL 从当前 `SUBMITTED` 报价生成，不接受浏览器排名：先按 Currency、Unit、Tax Included、Freight Included 分组，再按 Unit Price、Promised Delivery Date、Supplier ID 排序。
- 过期报价保留在比较证据中但 `NOT_COMPARABLE`、无排名且不可定标；MOQ 和晚交期分别显式标记。不同税/运费口径各自从 rank 1 开始，不跨组混排。
- Award 引用每行最新 Comparison 和仍为当前、未过期的 Quote Line；一条 RFQ Line 只有一条 Award Line。单一有效报价要求 `SOLE_SOURCE`；非最低价需要明确选型理由；晚交期需要 `LATE_DELIVERY_ACCEPTED`；超申请数量需要超量原因。
- Award 只允许 `AWARDED -> REVERSED`，Award Line 永不更新/删除。撤销保留全部历史，不回写报价或申请。

## 一致性与保护

- 数量与价格均为 PostgreSQL `numeric(24,6)`；Node 和浏览器只传递 decimal 字符串。
- 全部写入使用 `expected_version`、聚合锁、部分唯一索引和持久 Idempotency；业务、Event、Audit 和 Idempotency 同事务提交。
- `cyd.procurement_sourcing_service_write` 与 trigger 拒绝直接插入投影、更新已发 RFQ/已提交报价/定标或删除任何历史事实；Award insert trigger 再核对当前报价和最新比较。
- 本模型不引用或写入 Purchase Order、Receipt、Inventory Ledger/Balance、Finance Document、Planning Allocation；TASK05 才能消费 Award 建立后续采购执行事实。
