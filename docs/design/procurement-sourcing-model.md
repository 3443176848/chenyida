# 采购询比价与人工定标关系模型（TASK04）

状态：`IMPLEMENTED / PARALLEL ACCEPTED`

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

## Award 到 PO 的显式确认合同（FIX-32）

- `/api/procurement/awards/:id/purchase-order-conversion-preview` 是只读权威预览；入口第一次点击只调用该GET。预览从Award历史读模型重新核验RFQ/CAS、Comparison/固定Quote、Event、持久化Award摘要、派生decision digest、完整Award Line及PO/计划计数，任一缺失或漂移失败关闭。
- 最终POST只接受上述确认断言、完整Award Line ID集合及正常PO备注。Supplier、Material、Unit、数量、单价、币种、交期和转换范围均从不可变Award/Comparison/Quote重新读取，浏览器字段不构成权威。
- PO按Supplier+Currency聚合；每条Award Line固定对应一条PO Line。`purchase_delivery_plans`每条记录本身就是直接绑定PO Line的计划聚合，没有独立Delivery Plan Line实体。因此当前四行样本是一次转换、一个PO、四条PO Line、四条计划聚合。
- 幂等回放在业务工作前判定；新请求在Award advisory lock下复用同一事务连接重算预览，再锁定Award/RFQ/PRQ/Line/Quote/Mapping并一次提交PO、Line、来源Link、Plan、收货队列、PO/Plan Event、Audit和幂等结果。失败零半记录，并发只有一个转换成功。
- 转换不会自动创建Receipt、Warehouse Receipt、Inventory Ledger、IQC、AP、Payment、Work Order或其他生产/财务记录；这些动作属于后续独立任务。
