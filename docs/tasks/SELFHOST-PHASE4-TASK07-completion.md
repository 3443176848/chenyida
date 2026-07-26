# SELFHOST-PHASE4-TASK07 完成报告

## 结论

`PRODUCTION REPORTING AND FINISHED GOODS RECEIPT ACCEPTED IN PARALLEL ENVIRONMENT`

- 日期：2026-07-26（Asia/Shanghai）
- 功能提交：`323e85d44a2a4202811944591d0a4f6b96ae6751`
- 功能 Parent：`26ccb95782478645720c8284c59b0afadca68649`
- 功能消息：`feat: add production reporting and completion handoff`
- 验收消息：`ops: accept production completion workflow in parallel environment`
- 版本：`0.1.0-alpha.21`
- Migration：`0021_production_reporting_completions.sql`
- SHA-256：`1cf953d98da2d3a7703f3866b852cbe10bdb37b33e1826cb78b24079fc5a11ec`

## 实际 HTTP 验收

只在 `chenyida-erp-parallel` 回环非生产环境中使用真实 production/warehouse 隔离账号与 Session/CSRF/Idempotency，先复现 TASK06 合成链路：Work Order planned=10、原材料完整领料 10、初始成品库存 0。

1. production 首批 Report：reported/good/scrap=`4/4/0`；warehouse 首批 Completion/Allocation=`4/4`，成品 Ledger `+4`、Balance 4，工单 `IN_PROGRESS`，Report 可用良品归零。
2. production 第二批 Report：reported/good/scrap=`6/6/0`；warehouse 第二批 Completion/Allocation=`6/6`，成品 Ledger `+6`、Balance 10。
3. 最终 Work Order planned/reported/good/scrap/completed=`10/10/10/0/10`，状态 `COMPLETED`，没有 `CLOSED` 事件。
4. 两份 Report、两份 Allocation、两份 Completion/Line 与两条成品 Ledger 按 `4/6` 完整追溯；TASK06 的 2 Handoff、1 Reservation、2 Issue 也在重启后保持。
5. IQC/IPQC/FQC、Shipment、Sales Financial Source、AR 均为 0；没有自动品质、销售或财务事实。

## 自动化与安全验证

- TASK07 unit 3/3、UI 2/2、PostgreSQL/API 3/3、migration 3/3 通过。
- TASK01—TASK06 unit/UI/PostgreSQL/migration，Production、Inventory、Quality、Sales、Dashboard 及关联 Planning/Procurement 回归通过。
- 覆盖未领/少领超量报工、good+scrap、Report/工单余量、同 Report 并发消费、同正文重放/异正文冲突、CAS、故障注入零半记录、越权 403 和 scrap 零库存。
- Report 全额冲销、Completion 全额冲销/库存恢复、IPQC/FQC/Shipment 下游阻止及生产人员本人授权门禁通过。
- 全部正式 typecheck、Drizzle 168 表一致且无 Schema 漂移、ESLint 0 error/5 既有 warning、Vinext build 5/5、845 文件凭证扫描、environment/API coverage、`git diff --check` 通过。
- Python `server.py --self-test`、`smoke_test.py`、临时 SQLite go-live 通过；真实 SQLite 未打开或修改。

## Compose、备份恢复与清理

- 只更新 `chenyida-erp-parallel`；Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口，Caddy/HTTPS/80/443 未启动。
- PostgreSQL/Web/Worker 整体重启后 21 migrations、Handoff/Reservation/Issue、Report/Allocation/Completion、5 条全链 Ledger、Balance、Event 和 Audit 均保持。
- 接受态停服备份 `backup-20260726T050445Z-323e85d44a2a` 通过 checksum/归档校验，恢复到新空库为 21 migrations、Report/Allocation/Completion 各 2、成品 Balance 10、Quality/Shipment/AR 0。
- 清理后停服备份 `backup-20260726T050530Z-323e85d44a2a` 再恢复到第二个新空库，结果为 21 migrations、唯一启用管理员、所有业务表合计 0、uploads/attachments 0。
- 两个恢复库、全部隔离测试库、两份临时备份及恢复目录、辅助容器/镜像已删除，临时工件不可恢复；最终只保留 PostgreSQL/Web/Worker 三容器和四个既有持久卷。
- 最终容器内存约 PostgreSQL 121 MiB、Web 32.64 MiB、Worker 58.38 MiB；宿主可用内存约 2039 MiB、磁盘可用 20 GiB。

## 生产保护与 Git

- Python systemd 仍为 PID `277640`；SQLite metadata 始终为 `64769:53827608:1784999031:1544192`。
- 未读取或迁移真实 SQLite 数据，未重启 Python，未访问/修改生产 D1，未 push、未建 PR、未切流、未生产部署。
- 未启动品质、发货或财务任务；TASK07 完成后停止。
