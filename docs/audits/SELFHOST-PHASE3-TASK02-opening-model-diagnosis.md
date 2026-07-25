# TASK02 期初业务模型诊断

## 已确认缺口

- MG-001：`0013` 要求 AR 只能来自 Shipment、AP 只能来自 Purchase Receipt。历史截止日未结余额若沿用该模型，只能伪造历史单据或留在 staging，均不成立。
- MG-002：TASK01 的 `inventory_balance` 只能生成 `OPENING_PLAN`；`0008` 没有迁移期初来源，直接改余额会绕过 Ledger 权威与库存事务保护。

## 选定边界

`migration_opening_sources` 保存去正文的来源证据摘要；Inventory 与 Finance 各自拥有关系化子表。库存期初复用 `inventory_adjustments`、不可变 Ledger 与单一 Balance 投影，显式使用 `MIGRATION_OPENING` 来源。财务期初扩展同一 `finance_documents` 为 `OPENING_AR`/`OPENING_AP`，不制造 Shipment、Receipt 或 Settlement。

原始事实不更新、不删除。冲销以独立不可变记录和反向事实表达；库存存在下游消耗时拒绝，财务存在未冲销收付款时拒绝。所有业务引用均使用内部 ID，数量与金额均为 `numeric(24,6)`。

## 不采用的方案

- 不把 staging JSON、文件路径或原业务正文作为正式来源。
- 不直接初始化/覆盖 Balance，也不建立第二套库存余额算法。
- 不创建虚假历史收发货、完工、收付款或结清单据。
- 不增加 HTTP 写端点或给普通角色授予 migration capability。
