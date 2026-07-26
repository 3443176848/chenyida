# SELFHOST-PHASE4-TASK05 完成报告

## 结论

`SOURCING TO PAYABLE HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`

本结论仅适用于 2026-07-26 的隔离测试和 `chenyida-erp-parallel` 回环并行环境，不构成生产发布、真实数据迁移或切流批准。

## Git、版本与 Migration

- 起始 HEAD：`990279a5ff30a7ee4a23d2cb5b2c3142e1b81374`，分支 `main`，工作区 clean。
- 功能提交：`859454c97acddbff8c5199d91c41d636a6ca24e0`，Parent 严格为起始 HEAD，消息 `feat: connect sourcing awards to receiving and payables`。
- 验收提交：消息 `ops: accept sourcing fulfillment workflow in parallel environment`；实际哈希以 `git log` 为准。
- 包版本：`chenyida-erp-selfhosted@0.1.0-alpha.19`。
- 唯一新增 Migration：`0019_sourcing_purchase_fulfillment.sql`；`0001`—`0018` 未修改。
- SHA-256：`6e517f6d2beffc74c94dcd5c5d60c9bcdc5baf9c93711a6add6cec4a08ed989a`，仓库、manifest 与并行数据库记录一致。
- Schema、Drizzle journal/snapshot 和运行时查询一致；Schema generator 无待生成差异。

## 实施范围与事务边界

- 新增稳定的 Award Line→PO Line 来源关系、关系化到货计划、待入库队列、Receipt Line→计划分配与不可变计划事件。
- 新增的 `procurement-fulfillment-selfhost` 只做编排；PO/Receipt、Inventory Ledger/Balance、purchase financial source 和 Finance AP 继续由既有 Procurement、Inventory、Finance 权威服务负责。
- Award 转单由 purchase 显式触发，按供应商和币种确定性分组；唯一约束、行锁、持久幂等和 CAS 保证每个 Award Line 最多转换一次。
- warehouse 收货在单一数据库事务中提交 Receipt/Lines、PO/计划投影、Ledger/Balance、purchase source、事件、审计和幂等结果，失败不保留半记录。
- 收货只创建采购财务来源，不自动创建 AP；finance 必须显式核对并消费来源。已有 PO 阻止 Award 撤销，已有 AP 阻止破坏来源链的 Receipt 冲销。

## 实际多账号 HTTP 旅程

1. 在隔离环境建立已接收采购需求、TASK04 RFQ/报价/比较/Award，Award 为供应商 A、数量 `10.000000`、单价 `12.000000`、CNY。
2. warehouse 越权转 PO 返回 403；purchase 显式转单并创建计划 `10.000000`。此时 Receipt、Inventory Ledger、AP 均为 0。
3. 同正文 `Idempotency-Key` 重放返回原结果并标记 replay；同 Key 异正文返回 `IDEMPOTENCY_CONFLICT`。
4. warehouse 首收 `4.000000`：计划 `PARTIAL`，已收 4、未收 6，库存增加到 4，第一笔 purchase source 为 `48.000000`。
5. finance 显式生成 AP `48.000000`；过期 expected version、超收请求均被稳定拒绝。
6. warehouse 次收 `6.000000`：计划 `COMPLETED`、PO `RECEIVED`，库存累计 10，第二笔 purchase source 为 `72.000000`。
7. finance 显式生成 AP `72.000000`；两笔 AP 合计 `120.000000`，与 `10 × 12` 精确一致。
8. Award→PO→Plan→Receipt→Ledger/Balance→purchase source→AP 来源链可追溯；有 PO 后 Award 撤销返回 `AWARD_HAS_PURCHASE_ORDER`，有 AP 后 Receipt 冲销返回 `RECEIPT_REVERSAL_BLOCKED_BY_AP`。
9. `/procurement/fulfillment`、`/warehouse/receiving`、`/finance/payables` 三条原生页面均实际返回 HTTP 200。
10. Compose 整体重启后 19 migrations、Award 1、PO 1、Receipt 2、库存 10、来源/AP 120、3 个计划事件和审计保持。

专项 PostgreSQL 测试另覆盖并发唯一转单、故障注入零半记录、CAS、超收、权限和约束，未通过降低断言或跳过用例取得结果。

## 测试、构建与恢复

- TASK05 unit/UI、PostgreSQL/API、migration 全部通过；migration 覆盖空库、`0018→0019`、重复执行、失败回滚和约束。
- TASK01—TASK04、Identity、Master Data、Supplier Mapping、Procurement、Inventory、Finance、Dashboard、FileStorage、环境和 Worker 回归通过。
- 全部正式 typecheck、Schema consistency、ESLint（0 error，5 个既有 warning）、Vinext build（5/5）、凭证扫描和 `git diff --check` 通过。
- Python `server.py --self-test`、`smoke_test.py`、临时 SQLite `go_live_check.py --no-backup` 通过；测试未写真实 SQLite。
- 建立并校验 `0018` 升级前恢复点和干净 `0019` 恢复点；停服备份成功恢复到第二个新空数据库，核对 19 migrations 和唯一用户。验收后当前并行数据库整体恢复为干净 `0019`。

## 最终环境与清理

- Compose：PostgreSQL/Web healthy，Worker running；Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口，不占用 80/443。
- 数据库：19 migrations、唯一启用管理员、0 临时账号；Customer、Supplier、Material、Product、BOM、Project、Planning、Purchase Request、RFQ、Award、PO、Delivery Plan、Receipt、Ledger、Balance、purchase source 和 AP 均为 0；uploads/attachments 文件为 0。
- Python：PID `277640` 保持，18888 HTTP 200，未重启或修改 systemd。
- 真实 SQLite 仅核验 metadata，最终仍为 `64769:53827608:1784999031:1544192`，未读业务正文、未迁移或修改。
- 最终资源采样：PostgreSQL 约 103.2 MiB、Web 约 69.4 MiB、Worker 约 60.6 MiB，合计约 233.1 MiB；宿主可用内存约 2.12 GiB、磁盘可用约 25 GiB。
- 本任务临时账号、合成数据、测试数据库、恢复点、临时容器/网络/镜像和脚本均在最终核对后清理；当前并行持久卷保留。

## 明确未执行

- 未 push、未创建 PR、未切流、未启 HTTPS、未部署生产。
- 未读取或迁移真实 SQLite 业务数据，未访问生产 D1 或生产 PostgreSQL。
- 未实现付款、银行流水、总账、税票、项目收入或公司费用。
- 未实现或启动 TASK06；工单、领料、报工、完工、IQC/IPQC/FQC 均不在本任务范围。
