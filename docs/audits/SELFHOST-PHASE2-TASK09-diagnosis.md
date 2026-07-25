# SELFHOST-PHASE2-TASK09 诊断与设计记录

日期：2026-07-25（Asia/Shanghai）

## Legacy 风险

- SQLite 财务单据从 SO/PO 头人工输入或 float 计算金额，来源名称/类型为自由文本；SO 路径甚至要求浏览器提交总额，不能证明已发货/已收货。
- 编码使用日期 + `COUNT(*)`，无并发锁；付款直接 UPDATE `paid_amount/status`，没有 expected version、幂等、反向事实或不可变保护。
- 浏览器提交 `created_by`、`handled_by` 和 payment type；无稳定 Customer/Supplier FK、无请求编号、无审计失败回滚，历史 D1 仅为 JSON 占位。

## 设计结论

- TASK05/TASK07 已提供每次 Receipt/Shipment 的不可变 `numeric(24,6)` 金额来源，因此财务只能消费这些稳定来源，不再从 PO/SO 或客户端重算金额。
- Header 是余额/状态投影；Document Event 和 Settlement/Reversal 是不可变事实。所有投影、事实、审计和幂等在单一 PostgreSQL 事务提交。
- 首期不建立总账分录、发票或期间关闭；`accounting_date` 只作为事实日期，不冒充会计期间控制。
