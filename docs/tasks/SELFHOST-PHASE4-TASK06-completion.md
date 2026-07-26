# SELFHOST-PHASE4-TASK06 完成报告

## 结论

`PLANNING TO PRODUCTION MATERIAL ISSUE ACCEPTED IN PARALLEL ENVIRONMENT`

- 日期：2026-07-26（Asia/Shanghai）
- 功能提交：`a8272b7c968e0fdcbce017aa0e41bad281702e50`
- 功能 Parent：`b45616e1115aab7d22d1b9a7e58f792005291524`
- 功能消息：`feat: add planning to production material handoff`
- 验收消息：`ops: accept production material issue workflow in parallel environment`
- 版本：`0.1.0-alpha.20`
- Migration：`0020_production_handoff_reservations.sql`
- SHA-256：`1164536d51fbcf2f022c45aeab54b2b1ebc3d20cb2e4caabba9341d63fb4e182`

## 实际 HTTP 验收

在唯一获准的 `chenyida-erp-parallel` 回环非生产环境中，动态创建 planning、production、warehouse 三个真实隔离账号及会话；purchase 只用于通过既有采购收货权威链获得库存，manager 只用于验证权限裁剪 Dashboard。

1. 建立当前有效 `ACCEPTED` Planning Package，计划成品 10；BOM 每件原材料 1、损耗率 0。
2. 通过既有 Purchase Order/Receipt HTTP 链收货原材料 10。
3. planning 提交 v1，production 以“资料需修订”退回；旧 v1 冻结，不能原地重提。
4. planning 准备并提交新 v2，production 接收；每个 Handoff Item 只创建一张既有权威 DRAFT Work Order。
5. DRAFT 阶段核对 `reserved_qty=0`、Issue=0、生产领料 Ledger=0。
6. production 显式释放后：`required_qty=10`、`on_hand_qty=10`、`reserved_qty=10`、`available_qty=0`。
7. warehouse 首批领料 4 后：`on_hand_qty=6`、`reserved_qty=6`、`net_issued_qty=4`。
8. warehouse 第二批领料 6 后：`on_hand_qty=0`、`reserved_qty=0`、`net_issued_qty=10`、Work Order=`IN_PROGRESS`；两条生产领料 Ledger 合计 `-10`。
9. 明确核对 Production Report=0、Completion=0、Finished Goods Ledger=0、IQC/IPQC/FQC=0。
10. `/planning/production-handoffs`、`/production/work-orders`、`/warehouse/production-issues` 和 health 实际 HTTP 均为 200。

## 自动化与安全验证

- TASK06 unit 3/3、UI 2/2、PostgreSQL 2/2、migration 3/3 通过。
- TASK01—TASK05、Planning、Material Requirement、Procurement Sourcing/Fulfillment、Inventory、Production、Dashboard 的适用 unit/UI/PostgreSQL/migration 回归通过；既有 Production PostgreSQL 5/5、Dashboard PostgreSQL 2/2 通过。
- 14 组正式 typecheck、Drizzle Schema consistency、ESLint 0 error（5 个既有 warning）、Vinext 5/5 build、833 文件凭证扫描、environment 6/6、API coverage 2/2 和 `git diff --check` 通过。
- 缺料释放零半记录、两个工单并发预留、重复工单、超需求/预留/库存、幂等重放与异正文冲突、CAS、故障注入回滚、未领料取消释放、已领料取消阻止、退料恢复和未授权角色 403 均通过。
- `server.py --self-test`、`smoke_test.py`、临时 SQLite `go_live_check.py --no-backup` 通过；没有读取或修改真实 SQLite 业务正文。

## Compose、备份恢复与清理

- 0019 升级前停服备份 `backup-20260726T032937Z-3ae79f167a22` 已通过 checksum/归档校验。
- 整栈 Compose 重启后，2 个 Handoff、1 个 Work Order、1 个 Reservation、2 个 Issue、2 个 Ledger 链接及库存/预留/下游零事实保持。一次性 migrate 与 PostgreSQL 同时重启曾出现预期启动竞态；数据库健康后幂等 migrate 成功，未改变事实或降低断言。
- 接受态停服备份 `backup-20260726T033400Z-a8272b7c968e` 恢复到新空数据库后为 20 migrations、Handoff 2、WO 1、Reservation 1、Issue 2、库存/预留 0、Report/Completion/Quality 0。
- 最终干净点备份 `backup-20260726T033437Z-a8272b7c968e` 再次恢复到第二个新空数据库后为 20 migrations、唯一管理员、业务 0。
- 并行主库最终通过逐表计数：20 migrations、唯一启用管理员、所有业务表 0；uploads/attachments 文件均为 0。
- 最终仅保留 `chenyida-erp-parallel` PostgreSQL/Web/Worker 三容器和四个既有持久卷；Web 为 `127.0.0.1:3000`，PostgreSQL 无宿主端口。全部临时测试/恢复数据库、备份与恢复目录、临时容器及本轮拉取的辅助镜像已删除。
- Python systemd 仍 `enabled/active`，PID `277640`，监听 `0.0.0.0:18888`；真实 SQLite metadata `64769:53827608:1784999031:1544192` 与开始时一致，Python 未重启且代码无差异。

## 未授权事项

未执行生产报工、完工入库、成品库存、IQC/IPQC/FQC、销售发货、付款、银行、总账、税票、真实数据迁移、HTTPS、80/443、切流或生产部署；未 push、未创建 PR。TASK06 完成后停止，不启动后续任务。
