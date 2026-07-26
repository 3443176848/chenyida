# SELFHOST-PHASE4-TASK09 完成报告

## 结论

`FQC RELEASE TO SHIPMENT AND RECEIVABLE ACCEPTED IN PARALLEL ENVIRONMENT`

- 日期：2026-07-26（Asia/Shanghai）
- 状态：`DONE / PARALLEL ACCEPTED`
- 功能提交：`dfda1c5597cc576cd96f495e272e9fc59c851fa4`
- 严格 Parent：`d9ebfb4644bb9e0d07bfbf81d168d7babcd4bdea`
- 验收提交：`ops: accept sales delivery receivable workflow in parallel environment`，实际哈希以 Git log 为准。
- 版本：`0.1.0-alpha.23`
- Migration：`0023_sales_delivery_receivable.sql`
- SHA-256：`5f07c7aebe9513e040fa0ab2f31f5cd5a51faf64fe78516794cd0fd46309221d`

## 交付边界

`0023` 以 expand-only 方式增加 Sales Delivery Instruction/Line/Event、执行行以及 Shipment Line→FQC Release Allocation；不复制 Sales Order、Shipment、Inventory Ledger/Balance、Sales Financial Source 或 Finance Document。sales 创建/提交/取消指令，warehouse 接收/退回/分批执行和受控冲销，finance 显式消费正向 Shipment Source 创建 AR，quality 只读精确消费状态。

发货事务按稳定顺序锁定 Instruction、SO/Line、CLOSED/RELEASED FQC 来源及 Inventory Balance，在一个 PostgreSQL 事务内提交 Shipment/Line、FQC Allocation、库存 Ledger/Balance、SO/Instruction 投影、唯一金额来源、Event/Audit/Idempotency。指令创建不扣库存、不消费 FQC、不创建金额来源或 AR；每个 FQC 可跨批消费，一批 Shipment Line 也可由多个来源拼足，累计与并发由锁和数据库 guard 限制。无 AR 的 Shipment 全额冲销恢复库存、SO、Instruction 与 FQC 可用量；已有 AR 时 fail closed。

AR 仍复用既有 Finance Service，Customer/Currency/Amount 只继承服务器可信来源，金额按 Shipment quantity × SO unit price 计算。Shipment 不自动创建 AR；本任务没有调用或创建 Finance Settlement/Receipt。

## 实际 HTTP 验收

在 `chenyida-erp-parallel` 使用 production、sales、warehouse、quality、manager、finance 临时账号复现 TASK08 来源并完成：

| 阶段 | Instruction / SO | FQC 消费/可用 | 成品库存 | Sales Source | AR |
| --- | --- | --- | ---: | ---: | ---: |
| 指令 10 创建 | DRAFT / OPEN | 0 / 10 | 10 | 0 | 0 |
| 第一批 Shipment 4 | PARTIAL / PARTIALLY_SHIPPED | 4 / 6 | 6 | 80 CNY | 80 CNY（finance 显式） |
| 第二批 Shipment 6 | COMPLETED / SHIPPED | 6 / 0 | 0 | 120 CNY | 120 CNY（finance 显式） |

最终 Shipment Line=`4/6`、FQC Allocation=`4/6`、Inventory Ledger 合计 `-10`、Sales Source 合计 `200`、AR 合计 `200`、Finance Settlement/客户收款=`0`。页面 `/sales/delivery`、`/warehouse/shipping`、`/finance/receivables` 均返回 200；实际验证同正文幂等重放、quality 越权 403 和已有 AR 的 Shipment 冲销拒绝。Compose 整体重启后全部数量、金额、事件和审计事实保持。

## 自动验证

- TASK09 unit/UI、PostgreSQL/API 3/3、migration 3/3 通过；migration 覆盖空库、0022→0023、重复执行和 DDL 失败事务回滚。
- TASK01—TASK08、Inventory、Finance、Dashboard 隔离 PostgreSQL 回归通过；TASK08 Quality 12/12 覆盖 FQC Reopen 消费门禁。
- 相关 unit/UI 契约 28/28 通过；17 个正式 TypeScript 配置全部通过。
- 并发执行同一 Instruction/FQC、同一 Source 并发 AR、超订单/指令/库存/FQC、幂等异正文、CAS、权限 403、审计/库存故障注入零半记录、无 AR 冲销恢复及有 AR 冲销门禁均通过。
- Drizzle consistency、Vinext build、credentials scan 874 files、`git diff --check` 通过；ESLint 0 error、6 warnings（既有/非阻断未使用变量）。
- Python `/opt/erp/.venv/bin/python` 的 `server.py --self-test`、隔离端口 `smoke_test.py`、临时 SQLite `go_live_check.py --no-backup` 通过；临时库已删除。

## Compose、恢复与最终清理

- 只更新 `chenyida-erp-parallel`；Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口，未启用 Caddy/HTTPS/80/443。
- 接受态停服备份 `backup-20260726T105516Z-dfda1c5597cc` 通过 artifact SHA/size、归档路径和 23 migration 清单校验；恢复到新空 `task09_restore_test` 后精确为 `23|7|1|2|10|-10|200|200|0`，恢复 uploads/attachments 均为 0。
- 验收后主库清理为 23 migrations、唯一启用管理员、Delivery/Shipment/FQC/Inventory/Sales Source/Finance/Settlement 等合成业务 0，uploads/attachments 0。
- 恢复库、全部隔离测试库、一次性容器和临时备份/恢复目录均已删除；临时备份不可从本机工件恢复。最终只保留 PostgreSQL/Web/Worker 三容器和 `erp_postgres`、`erp_uploads`、`erp_attachments`、`erp_backup_status` 四卷。

## 生产保护与 Git

Python 常驻进程仍为 PID `277640`，未重启；真实 SQLite 只核验 metadata `64769:53827608:1784999031:1544192`，未读取或修改业务正文。未 push、未创建 PR、未迁真实数据、未切流、未生产部署。本任务未启动客户收款、银行、总账、税票或收入确认。
