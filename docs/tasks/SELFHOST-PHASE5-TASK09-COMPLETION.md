# SELFHOST-PHASE5-TASK09 完成报告

## 结论与 Git

- 状态：`DONE / PARALLEL ACCEPTED`；仅完成 TASK09，未启动 TASK10。
- 起始 HEAD：`279d284738b8ee01f6579a91333ad958a6c36dc8`，`main`，behind 0/ahead 71，工作区 clean。
- 功能提交：`02dfa0d3c18c16b0e8ee07af94f11de7a0ca77e7`（`feat: add finished goods lot shipment flow`），Parent 严格为起始 HEAD。
- 聚焦修正提交：无；功能提交未 amend、未 rebase、未 reset。
- 验收提交：本报告所在提交，消息 `ops: accept finished goods lot shipment in parallel environment`，Parent 为功能提交；提交 SHA 由 `git log -1 -- docs/tasks/SELFHOST-PHASE5-TASK09-COMPLETION.md` 解析。
- 最终 HEAD：本报告所在验收提交；预期 `origin/main...HEAD` 为 behind 0/ahead 73，最终以提交后的只读 Git 核验为准，工作区必须 clean。
- 版本：`0.1.0-alpha.33`。唯一新增 migration：`0033_finished_goods_lot_fqc_shipment.sql`，完整 SHA-256 `ca01cbc6a40ebfe9c17e9c3133f8704748d12b64c21d56155313ff73ce0c3d44`。
- `0001`—`0032` 与起始提交逐文件 diff 为 0；已应用 checksum 与文件一致。Schema、0033 snapshot、journal 一致，Drizzle generator 返回无额外 schema 变化。

## 交付边界

- BATCH Completion→Sales Allocation→FQC→Shipment Line→FQC Consumption Fact 全部保存同一稳定 `inventory_lot_id`；Lot code 只显示和校验。
- FQC Lot 从 Allocation 的 Completion Lot 服务端推导；调用者提交 Lot 被拒绝。warehouse 必须显式选择 Lot，Inventory ISSUE、Shipment、FQC 消费、Delivery/SO 投影、Sales Source、事件、审计和幂等在同一 PostgreSQL 事务。
- Lot/FQC/Delivery/SO 均使用 CAS 与固定锁序；冻结、耗尽、余额不足、跨 Lot/Material/Unit/SO Line、并发超用、直接 SQL 绕过和故障注入均 fail closed。
- Shipment 冲销只沿原 Shipment Line 的原 Lot 追加反向 Ledger/FQC/Source；已有 AR 或其他不可逆下游继续阻止冲销。已消费 FQC 不能不安全 reopen，已有 FQC/Shipment 的 Completion 不能冲销。
- ORDER 历史模式保持 null Lot、空 lot_code Balance 和订单级 FQC/Shipment，不猜测或自动绑定 BATCH Lot。

## 自动验证

- TASK09 专项：unit `2/2`、UI `2/2`、PostgreSQL/API `2/2`、migration upgrade `3/3`；空库 0001→0033、0032→0033、重复执行、失败回滚、约束、guard 和 manifest 均通过。
- 正式 `npm test` `3/3`；Phase 4 TASK08/TASK09、Phase 5 TASK03/TASK07/TASK08、Production、Inventory、Quality、Sales、Finance Source、Dashboard、Identity/Permissions、Environment 与 ORDER 适用 unit/UI 回归 `75/75`；历史边界收紧后的最终聚焦复核 `10/10`。
- 11 组相关 typecheck 通过：Production、Sales、Quality、Finance、Dashboard、Phase 4 TASK08/TASK09、Phase 5 TASK03/TASK07/TASK08/TASK09。
- `npm run lint` 为 0 error、8 个既有无关 warning；`npm run security:credentials` 扫描 1003 个仓库文件通过；Web 与 Worker 分开 build 通过；`git diff --check` 通过。
- Python 仅用临时 SQLite：`server.py --self-test`、`smoke_test.py`、`go_live_check.py --no-backup` 全部通过；go-live 临时库 282624 bytes，退出后已删除。

## 实际 HTTP 与恢复证据

- 真实 Node/PostgreSQL HTTP 建立 SO `10 × 20 CNY`、Batch/Lot A `4`、Batch/Lot B `6`，分别建立 Allocation 和 FQC `4/4/4`、`6/6/6`；调用者伪造 FQC Lot 返回 400。
- warehouse 明确选择 Lot A 发货 4：A/B Balance `0/6`、FQC available `0/6`、SO `PARTIALLY_SHIPPED`、有效 Source `80`、AR/Settlement 0；同幂等 Key 重放只返回同一事实。
- 冻结 Lot B `2` 后尝试发货 `6` 返回 409；B 保持 on-hand/frozen/available `6/2/4`、FQC available 6，Shipment/Ledger/Source/Delivery/SO 的前后快照完全相同。解冻 2 后从 B 发货 6，A/B Balance `0/0`、FQC `0/0`、SO `SHIPPED`、有效 Source `80/120=200`。
- 冲销原 Lot A Shipment 4 后，A Balance/FQC 恢复 `4/4`、原 Shipment/Source 保留冲销事实；再次选择同一个 Lot A 发货 4。最终正向历史数量 `{4,6,4}`、Lot `{A,B,A}`，A 原单有唯一 reversal，有效 Shipment `4/6`、FQC 净消费 `4/6`、Material 0、SO `SHIPPED`、Source 200、AR/Settlement 0。
- ORDER 实际回归通过：Completion/Allocation/FQC/Shipment/Inventory Ledger/FQC fact 的 Lot 全为 null。
- PostgreSQL→Web→Worker 严格串行重启后，BATCH 三笔正向 Shipment、一个 reversal、Lot issued/reversed `3/1` 与 ORDER 正向 Shipment 均持久。
- clean-0033 停服备份非零、0600、`pg_restore --list` 通过，SHA-256 `52def540e06bb2eecfbf8a2a0d5e7a45a782e0861fb31b0120de6da9b259706f`。接受态备份同样通过，SHA-256 `feb1c4afbc37aabf1057105cb9904503f40340e8d0ce27b8ef72d96ac741e8fd`。
- 接受态恢复到固定第二新空数据库 `chenyida_erp_task09_restore`，核对 33 migrations、BATCH Shipment `{4,6,4}`、Lot `{1,2,1}`、reversal 1、Lot Balance `{0,0}`、FQC 净消费 `{4,6}`、Source 200、SO SHIPPED、ORDER null Lot 1、Lot event `3/1` 后精确删除第二库。
- 第一次回灌 clean 主库的临时 restore 容器因环境变量在宿主提前展开而未导入；Web/Worker 随即停止，使用仍完好的 clean 备份改为容器内展开后恢复成功。没有数据丢失或生产影响。
- 最终主库：migrations/admin/session/audit/idempotency/work_order/lot/quality/shipment/FQC fact=`33/1/1/1/0/0/0/0/0/0`。Audit 保持 `id=1`、`2026-07-27 12:32:57.201019+00`、`admin/LOGIN/success`；Session 保持同一 username/created_at 和 `2026-07-27 20:35:57.691909+00` expires_at；未读取 token digest。uploads/attachments 均为 0。

## 低资源与清理

- 起点约 available 2.3 GiB、Swap 137 MiB、根盘 37 GiB、Load `0.42/0.37/0.28`；最终 available 2.38 GiB、Swap 146 MiB、根盘 36 GiB、Load `0.55/0.37/0.46`。
- 明确 64 秒窗口 Swap `145588224→145543168` bytes，增长 `-45056` bytes；未触发 available、Swap、磁盘、Load、OOM 或健康停止线。
- Build Cache 起点 0B，验收中峰值 4.134 GB；首次清理后 0B。最终分开 build 后 `2.105 GB→0B`，根盘 `35→36 GiB`；只执行允许的 `docker buildx prune --all --force`。误为只读卷计数拉取的临时 `alpine:3.22` 镜像已按精确 tag 删除。
- PostgreSQL/Web/Worker 最终 healthy/running，RestartCount 全 0、OOMKilled 全 false；四卷 `erp_postgres/erp_uploads/erp_attachments/erp_backup_status`、当前 tagged image 和 resource-guard 备份均保留。resource-guard 为 0600、1383645 bytes、SHA-256 `ffd176e43192c575a0b5c7e3f2469f93f779605ca445bcfc6218ed8c810b6570`。
- 所有 TASK09 临时数据库、容器、备份和测试 SQLite 已删除。Python systemd PID `13737`、NRestarts 0；实际 SQLite 只核验 metadata：1544192 bytes、mode 600、mtime `2026-07-26 01:03:51.761827070 +0800`，未读业务正文。

## 未执行范围

未执行原材料/供应商/采购 Receipt/生产领料 Lot、序列号/条码/标签、自动选 Lot/FIFO/FEFO、AR/Settlement/银行/税票/总账、成本利润、Routing/WIP/返工规则变更、真实数据迁移、生产部署、HTTPS/防火墙/切流、push、PR 或 `SELFHOST-PHASE5-TASK10`。Compose build 报告既有依赖审计项，本任务未越权升级依赖。

`FINISHED GOODS LOT RELEASE AND SHIPMENT ACCEPTED IN PARALLEL ENVIRONMENT`
