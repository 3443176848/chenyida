# SELFHOST-PHASE5-TASK06 完成报告

## 完成结论

`SELFHOST-PHASE5-TASK06 — 返工执行、复检与生产流恢复` 已在现有 `chenyida-erp-parallel` 回环非生产环境完成并停止。

固定结论：`PRODUCTION REWORK EXECUTION AND REINSPECTION ACCEPTED IN PARALLEL ENVIRONMENT`

本结论只证明已接收返工申请可经显式派工、既有 Operation Run/Report、显式复检放行、后续工序、正式报工和成品入库形成受控闭环；不表示真实数据已迁移、系统已生产部署，也未启动 TASK07。

## Git、版本与 Migration

- 起始 Branch/HEAD：`main` / `11bc680a91c59258c94f8ddca3d56af71981811e`；起点 Parent `1de057a6a248ca3346d7d2b0f201252a3965eced`，工作区 clean，`origin/main...HEAD` behind 0/ahead 52。
- 功能提交：`1f6a143adbf78d7fb70fbed1ea7d7dfea62cfd4b`，消息 `feat: add production rework execution`，Parent 严格为起始 HEAD `11bc680a91c59258c94f8ddca3d56af71981811e`。
- 验收提交：本报告所在独立提交，消息 `ops: accept production rework execution in parallel environment`，Parent 为功能提交；实际 SHA 以最终 `git log -1` 为准，不 amend、不 rebase、不 push。
- 版本：`0.1.0-alpha.29` → `0.1.0-alpha.30`。
- 唯一新增 Migration：`0030_production_rework_execution.sql`；`0001`—`0029` 未修改。
- `0030` 文件 SHA-256 与主库 checksum：`37fd53b02f517023a3fc6aba22b0904a4881273b8752de2946f0c5432a2d050c`。
- `db/schema.ts`、Drizzle journal、`0030_snapshot.json` 一致；generator 返回 `No schema changes, nothing to migrate`，主库逐项核对 30 个 migration 源文件与数据库 checksum 全部一致。

## 实现与安全边界

- 既有 `production_operation_runs` 以稳定 `NORMAL/REWORK` 类型区分正常加工和返工；REWORK Run 强制关联 Rework Request、NCR、原 Inspection、原 Run Report、目标 Snapshot Operation、Work Order、Work Center、operator 和派工数量，没有建立第二套 Run、Report、Quality、WIP、Production Report、Completion 或 Inventory 权威。
- 新增 Rework Run Allocation、Execution Projection/Event；查询明确返回 accepted、waiting dispatch、dispatched、in progress、reported good/scrap、pending reinspection、released、completed 和 unresolved，PostgreSQL deferred reconciliation 核对 Request→Run→Report→Inspection 守恒。
- 只有提交 digest/固化快照一致、ACTIVE NCR Allocation 有效且仍有余额的 ACCEPTED Request 可由 production 显式派工；服务端派生工单、目标、来源和工作中心，验证 active production operator，不读取库存、不重复领料、不修改需求/预留。
- REWORK start/report 复用 TASK02；processed 是重复加工次数，不增加 Work Order 净产品。返工 good 在 IPQC 目标上进入新的 Quality Hold，quality 必须显式建立稳定 Run Report 来源复检，只有异人处置后的 `CLOSED + RELEASED` 才形成后续额度。
- 未开工返工 Run 可取消并恢复可派量；无品质/下游时追加式全额冲销恢复投影，已有复检或下游引用时 fail closed。并发派工/取消/开工/报工、持久幂等、CAS、固定锁序、职责分离、403、故障零半记录、事实不可变和直接 SQL guard 均通过。
- production 执行返工与受控冲销，quality 创建复检/结果/缺陷，manager/admin 处置管理，engineering 只读；warehouse/sales/finance/purchase/planning 等无返工写权限。全部写操作保持 Session/must-change、CSRF、64 KiB 正文、限速、Idempotency-Key、request_id、中文安全错误和单事务 Audit。

## 自动测试

按本任务选择的不重复 TAP 用例共 178 项通过：

- unit/UI/API coverage：78 项，覆盖 Phase 4 TASK07/TASK08、Phase 5 TASK01—TASK06、Production、Routing、Quality、Nonconformance、Inventory、Dashboard 和 Identity/Permissions。
- PostgreSQL/API：46 项，覆盖数量守恒、质量 Hold/Release、取消/冲销、权限、职责分离、幂等、CAS、并发、故障回滚、直接 SQL 与 TASK02—TASK05 回归。
- Migration upgrade：37 项，覆盖空库、历史升级、重复执行、失败回滚、NORMAL 兼容、Schema/snapshot/journal/checksum 与 Phase 4/Phase 5 历史 migration 回归。
- 基础 `npm test` 3 项、environment guard 6 项、migration manifest 8 项。

其他验证全部通过：8 组相关正式 typecheck、Drizzle generator consistency、lint 0 error/8 个既有 warning、Vinext build、965 文件 credentials scan、`git diff --check`；Python `server.py --self-test`、`smoke_test.py` 和 TASK06 临时 SQLite `go_live_check.py --no-backup`。

回归期间只修正两类版本契约：TASK02 原测试按 TASK06 授权允许 production 受控冲销；Dashboard 与 TASK05 migration 测试从固定“最后 migration=0029”改为 0030 head/精确 0029 journal 项。未降低业务断言或跳过失败。

## 实际 HTTP 8+2 闭环

1. 创建 `SMT-PRINT`、`SMT-MOUNT`、`REFLOW`、`AOI`，发布 `NONE/NONE/IPQC/NONE` Routing；planned 10 Work Order 完整领料 10。
2. 正常执行到 REFLOW 10；原 IPQC 为 inspected/passed/failed/released=`10/8/2/8`，含 FAIL Result 和 Defect 2，AOI available=8。
3. 创建唯一 NCR；Rework Request v1 RETURNED，v2 以不可变提交版本/digest ACCEPTED，quantity 2、target REFLOW。
4. production 显式派工 REWORK 2、开工、报工 processed/good/scrap=`2/2/0`。此时返工待复检 2、Execution=`WAITING_REINSPECTION`，AOI available 仍为 8；直接派 10 被拒绝。
5. quality 显式对新 Run Report 创建 IPQC，inspected/passed/failed/released=`2/2/0/2`；manager 异人 RELEASE/close 后 AOI available `8→10`、Execution=`COMPLETED`、NCR=`RESOLVED`、原 failed 仍为 2、unresolved=0。
6. AOI 分批执行 `8/2`；Final Output Allocation、Production Report、warehouse Completion、Finished Goods Ledger 均为 `8/2`，Balance=10。
7. Work Order planned/reported/good/scrap/completed=`10/10/10/0/10`，状态 `COMPLETED` 且未自动 `CLOSED`；FQC/Shipment/Sales Source/AR/Settlement 均为 0。

正常加工次数与净产品量必须分开理解：SMT-PRINT processed 10、SMT-MOUNT 10、REFLOW NORMAL 10、REFLOW REWORK 2、AOI 10，因此 REFLOW 加工次数为 12；Work Order 净产品、正式报工、完工和成品余额仍严格为 10，没有把返工 good 误算成额外产品。

实际 HTTP 还验证：未复检不能派满 AOI、复检放行后才可派剩余 2、超 ACCEPTED quantity 拒绝、warehouse 返工写入 403、幂等重放返回原结果、已有复检时 Rework Run 冲销拒绝。

## 重启、备份恢复与清理

- 修改主库前停 Web/Worker 创建 TASK06 预变更 custom dump：1,495,969 bytes，SHA-256 `6005f0f92caa4518cb3b6f92b1e6c65634b05d5f70ef5ba21c9a1e8f78e22214`；非零、0600、`pg_restore --list` 通过。
- Compose PostgreSQL/Web/Worker 整体串行重启后，30 migrations、NORMAL Run 5、REWORK Run 1、Execution/NCR、两次 Inspection、两次 Production Report/Completion、成品余额 10、Audit 56、Idempotency 46 全部保持。
- 接受态停服 custom dump：1,569,512 bytes，SHA-256 `f5e8011c4ef55b0393cceedfbb2ebbbf8171e44fe8cccea92012452d77f8e379`；非零、0600、`pg_restore --list` 通过。
- 接受态恢复到固定第二新空 PostgreSQL `chenyida_erp_task06_restore`，再次核对 30 migrations、完整原检/返工/复检/AOI/8+2/成品链、Audit 56、Idempotency 46，随后删除恢复库。
- 并行主库最终为 30 migrations、app_meta 1、app_users 1、唯一启用 admin；其他全部公共业务/Audit/Idempotency/临时账号为 0，uploads/attachments 文件为 0。
- 最终只运行 PostgreSQL/Web/Worker 三服务，只保留四个原持久卷；Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口。TASK06 测试/恢复库、两份任务 dump、临时容器、辅助镜像和 migrate 标签均删除。
- resource-guard 备份 `/var/backups/chenyida-erp/resource-guard-20260727-0824.dump` 保留，SHA-256 `ffd176e43192c575a0b5c7e3f2469f93f779605ca445bcfc6218ed8c810b6570`。

## 低资源与 Python/SQLite 保护

- 起点：available memory 约 2.4 GiB、Swap 约 141 MiB、根分区可用约 18 GiB；三容器 RestartCount 0、OOMKilled false。
- 最终：available memory 2.4 GiB、Swap 153 MiB、根分区可用 15 GiB、Load `0.13/0.90/1.25`；三容器 RestartCount 0、OOMKilled false。
- 独立 60 秒 Swap 观测：160,477,184 → 160,473,088 bytes，增长 `-4,096` bytes，正增长 0。没有触发 available<768 MiB、Swap>80%、60 秒增长>256 MiB、构建前磁盘<12 GiB、重任务磁盘<10 GiB、持续 Load>4、OOM、反复重启或 PostgreSQL unhealthy 停止线。
- 全程 `COMPOSE_PARALLEL_LIMIT=1`；Web/Worker 分开构建，Migration、测试、typecheck、备份恢复、Compose 重启串行；一次最多一个临时容器/测试库；Node 重任务 heap 1024 MiB，Web/Worker heap 384 MiB。
- 常驻 Python PID 始终为 `13737`，未停止或重启。真实 SQLite 只核验 metadata：inode `53827608`、size `1544192`、mtime `1784999031`、birth `1784356951`、mode `600`；未读取或修改业务正文。

## 明确未执行

未自动创建 Rework Run 或复检，未执行返工补料、SCRAP Inventory Ledger、自动补产、批次/序列/追溯、设备/OEE/停机、外协、产能排程、工时/成本会计、FQC/Shipment/AR/财务动作、历史数据整理/迁移、Python 服务操作、HTTPS/防火墙、生产部署/切流、push、PR 或 `SELFHOST-PHASE5-TASK07`。
