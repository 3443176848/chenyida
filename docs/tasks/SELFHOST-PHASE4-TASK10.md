# SELFHOST-PHASE4-TASK10 — 客户收款、供应商付款与项目收支追溯

## 状态与授权

- 状态：`DONE / PARALLEL ACCEPTED`
- 日期：2026-07-26（Asia/Shanghai）
- 合法起点：`main` / `e63c726e0d274a8b7b654819794b4bd1044c6f82`，工作区 clean，`origin/main...HEAD` behind 0/ahead 36。
- 依赖：`SELFHOST-PHASE4-TASK05`、`SELFHOST-PHASE4-TASK09`、既有 Finance/Procurement/Sales/Project/Dashboard 权威模块。
- 目标版本：`0.1.0-alpha.24`；唯一新增迁移 `0024_finance_project_settlements.sql`。
- 授权仅覆盖隔离测试与 `chenyida-erp-parallel` 回环并行环境中的合成收付款验收；不授权真实银行、真实资金、真实数据迁移或生产动作。

## 唯一业务链

```text
Purchase Receipt → Purchase Financial Source → AP → PAYMENT
Shipment → Sales Financial Source → AR → RECEIPT
→ stable source-line chain → Business Project / UNATTRIBUTED
→ project and currency scoped source, settlement and outstanding summary
```

继续复用 `finance_documents`、`finance_settlements`、Settlement Reversal、Sales/Purchase Financial Source、TASK05 Receipt→AP、TASK09 Shipment→AR 及既有幂等、CAS、事务、事件、审计和权限框架。不得创建第二套 AR、AP、收款或付款权威。

## 已确认业务规则

1. AR 只允许 `RECEIPT`，AP 只允许 `PAYMENT`；类型、金额上限、币种、往来单位和 Document 类型由服务端决定。支持部分及多次核销，累计不得超过未结余额。
2. Document、Settlement、Event、Audit、幂等结果和项目来源分配在一个事务内提交；Document 行锁和 `expected_version` 防止并发超额。相同 Key/正文重放原结果，异正文冲突。
3. 已过账 Settlement 不修改、不删除。原正向 Settlement 最多追加一次等额负数全额冲销；冲销本身不可再次冲销，Document 投影原子恢复为 `PARTIALLY_SETTLED` 或 `OPEN`。
4. `account_name` 只是不对外证明余额的内部记账标签；系统不连接银行、支付网关或真实账户。
5. Sales 归属只沿 Shipment Line→Shipment/FQC Consumption→Completion→Work Order→Production Handoff→Planning Package→Business Project；Purchase 归属只沿 Receipt Line→Delivery/PO Line→Award/RFQ/Purchase Request→Material Requirement Plan→Planning Package→Business Project。不得按名称、单号文本或浏览器 Project 选择猜测。
6. 每个正向 Financial Source 在 Finance 过账事务内生成不可变的来源行分配事实；数量、单价、Project、金额和 SHA-256 digest 均由服务端重建。来源不完整时保存 `UNATTRIBUTED`，不修改历史 Shipment、Receipt、AR 或 AP。
7. 每个来源金额按来源行守恒；同一来源可分配多个 Project。部分 Settlement 按 Document 来源分配比例逐笔分摊，六位小数尾差固定分配给稳定排序首行，保证每笔和总计守恒。
8. 项目视图必须按 Project 与 Currency 分组，禁止跨币种汇总。`net_cash = customer_receipts - supplier_payments`；`transaction_contribution = sales_source_amount - purchase_source_amount` 仅为交易贡献，不是毛利、净利润或会计利润。

## 数据库、API、页面与 Dashboard

- `0024_finance_project_settlements.sql` expand-only 增加 Financial Source→Project Allocation、digest、外键、唯一性、查询索引、不可变和来源一致性直接 SQL guard；不修改 `0001`—`0023`。
- 历史没有项目来源的 Finance 数据继续可读，并明确投影为 `UNATTRIBUTED`；不得为报表回写历史业务事实。
- API 增加项目/币种财务汇总；Settlement 写入显式校验 `settlement_type`，浏览器不能覆盖服务端投影字段。
- 原生页面为 `/finance/settlements`、`/finance/projects`。项目/engineering 只见去敏项目汇总，不返回 `account_name`。
- Dashboard 按权限增加 AR 未结、AP 未结、本期客户收款、本期供应商付款、项目未归属金额和项目净现金流。

## 验收门禁

- TASK10 unit/UI、PostgreSQL/API、migration；空库、`0023→0024`、重复执行、失败回滚、约束和直接 SQL guard。
- AR/AP 类型错配、零/负/超额、并发、幂等异正文、CAS、全额冲销、重复/并发冲销和故障注入零半记录。
- 多 Project 行级精确归属、UNATTRIBUTED、不猜测、rounding 守恒、币种隔离、权限 403 和 TASK05/TASK09 上游冲销门禁。
- TASK01—TASK09、Finance/Procurement/Sales/Project/Dashboard、正式 typecheck、Schema consistency、lint/build、credentials、Python 隔离基线和 `git diff --check`。
- `chenyida-erp-parallel` 实际 AR `80/120`、AP `48/72`；收款 `30/50/120`、付款 `48/30/42`；来源 `200/120`、未结 `0/0`、净现金 `80`、UNATTRIBUTED `0`；重启、停服备份、新空恢复和最终清理。

## 明确排除

真实银行或支付接口、真实账户余额核验、总账、税票、外币/汇率、成本会计、人工/制造/公司费用、库存成本、收入确认、正式利润、真实数据迁移、HTTPS、80/443、切流、生产部署、push 和 PR 均不属于本任务。完成后停止。

## 完成记录

- 功能提交 `23fef6098a88466b94fcac104bba9317ba310d15`，严格 Parent `e63c726e0d274a8b7b654819794b4bd1044c6f82`；独立 ops 验收提交以 Git log 为准。
- `0.1.0-alpha.24` / `0024`，Migration SHA-256 `cab6f7679e91589cfe2c7fdecf9750b222b9212acbbd3341301c7a67ec2e9624`。
- 所有门禁、实际 HTTP、整体重启、停服备份、新空库恢复和最终清理通过；详细证据见 `SELFHOST-PHASE4-TASK10-COMPLETION.md`。
- 结论：`PROJECT RECEIPT PAYMENT AND CASHFLOW ACCEPTED IN PARALLEL ENVIRONMENT`。
