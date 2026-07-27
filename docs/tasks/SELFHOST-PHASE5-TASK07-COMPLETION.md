# SELFHOST-PHASE5-TASK07 完成报告

## 完成结论

`SELFHOST-PHASE5-TASK07 — 生产批次身份与全过程谱系` 已在现有 `chenyida-erp-parallel` 回环非生产环境完成并停止。

固定结论：`MANUFACTURING BATCH GENEALOGY ACCEPTED IN PARALLEL ENVIRONMENT`

本任务建立的是 Manufacturing Batch genealogy，不是 Inventory Lot。生产批次谱系已建立，但仓库批次库存尚未启用。Inventory Ledger/Balance 继续按 `MAIN` 聚合，所有验收 Ledger 的 `lot_code` 仍为空，既有 `INVENTORY_LOT_NOT_SUPPORTED` 门禁没有解除。

## Git、版本与 Migration

- 起始 Branch/HEAD：`main` / `93902d9c3f7be94044cf9903af6e6fbebc685cc3`；起点 Parent `1f6a143adbf78d7fb70fbed1ea7d7dfea62cfd4b`，工作区 clean，`origin/main...HEAD` behind 0/ahead 54。
- 功能提交：`3162edf5559512dd82ec363cf859d39bae2d5a0d`，消息 `feat: add manufacturing batch genealogy`，Parent 严格为起始 HEAD `93902d9c3f7be94044cf9903af6e6fbebc685cc3`。
- 聚焦修正：`dfd1581bc2e3cb072cd7f238e6a1b0097f8912f4` 精确查找历史 0030 journal 项，不降低业务、回滚、Schema、snapshot 或 checksum 断言；`cd9f016570cf94eb2990362b56e8f51ef5d43db1` 修正 Batch 页面 effect lint 契约并移除未使用 import。
- 验收提交：本报告所在独立提交，消息 `ops: accept manufacturing batch workflow in parallel environment`，Parent 为 `cd9f016570cf94eb2990362b56e8f51ef5d43db1`；实际 SHA 以最终 `git log -1` 为准，不 amend、不 rebase、不 push。
- 版本：`0.1.0-alpha.30` → `0.1.0-alpha.31`。唯一新增 `drizzle-postgres/0031_production_batch_genealogy.sql`；`0001`—`0030` 逐文件核对未修改。
- `0031` 文件 SHA-256 与主库 checksum：`ac0f6a63cfdb30d42edf50741afc7c8af632f74ff6fb08398d6b6e398a637fd4`。Schema、journal、`0031_snapshot.json` 一致，Drizzle generator 为 `No schema changes`。

## Manufacturing Batch 模型与边界

- 每个 Work Order 至多一个 `DRAFT/RELEASED/CANCELLED` Batch Set。DRAFT Batch 支持 CAS 增删改；服务端生成唯一 Batch code。RELEASE 要求工单 `RELEASED/IN_PROGRESS`、尚无 Run、每批数量大于 0、合计严格等于工单 planned quantity。
- RELEASE 按稳定顺序生成 canonical digest，固化 Work Order、Product Version、BOM Snapshot、Routing Snapshot、Finished Material、Unit 和 planned quantity；发布后的 Batch Set、Batch 和快照不可修改或删除。
- Batch 状态由稳定事实投影为 `PLANNED/READY/IN_PROGRESS/QUALITY_HOLD/REWORK/COMPLETED/CANCELLED`，浏览器不提交累计状态。无 Batch Set 的历史工单继续 ORDER 模式，不猜测、不自动生成 Batch。
- Batch 模式 NORMAL Run 必须绑定同工单已发布 Batch；首序累计投入不得超过该 Batch planned quantity，后序只消费同 Batch 前序 good，跨 Batch Input Allocation 在服务端和数据库均 fail closed。
- REWORK Run 的 Batch 只能沿 Rework Request→NCR→Inspection→源 Run Report 继承，浏览器不能选择或覆盖。原检、返工、复检和后序恢复保持同一 Batch；加工次数与净产品数量分开守恒。
- 结构化 Final Output、Production Report 和 Completion 均为单 Batch；一条 Report/Completion 不能混合 Batch。Completion 继续复用既有 Inventory Service，不建立第二套库存权威。
- Batch 列表、详情、code 精确查询、WIP、genealogy 和 Work Order Batch 汇总沿稳定 ID 返回 Batch Set/digest、BOM/Routing Snapshot、NORMAL/REWORK Run/Report/Input Allocation、IPQC/Result/Defect、NCR/Rework/复检、Final Output、Report、Completion 和 Inventory Adjustment/Ledger 关联。

## 实际 HTTP Batch A 4 / Batch B 6

1. 实际创建 `SMT-PRINT`、`SMT-MOUNT`、`REFLOW`、`AOI` 四个 Work Center，发布 `NONE/NONE/IPQC/NONE` Routing；创建 planned 10 Work Order 并完整领料。
2. 创建 Batch Set，Batch A=`PB-00000001`/4，Batch B=`PB-00000002`/6；数量不等时 RELEASE 返回 409，合计 10 后发布，digest 为 `3b5f55f2ed99de579ce61e1b28346dc39a717d1521d6f970b9745deb75f91c04`；发布后 Batch 修改返回 409。
3. Batch A 四工序执行 4，REFLOW IPQC inspected/passed/failed/released=`4/4/0/4`，无返工；AOI、Final Output、Production Report、Completion、Ledger 均为 4。
4. Batch B 正常执行到 REFLOW 6；原 IPQC=`6/4/2/4`，failed 2 形成 NCR；Rework Request v1 RETURNED、v2 ACCEPTED。REWORK Run 继承 Batch B，processed/good/scrap=`2/2/0`；复检=`2/2/0/2`，AOI 最终执行 `4/2`。
5. Batch B REFLOW 加工次数为 NORMAL 6 + REWORK 2 = 8，但 Batch 净 released/completed 仍为 6；返工没有增加 Work Order 净产品数量，也不存在跨 Batch Input Allocation。
6. Final Output、Production Report、Completion 分别为 Batch A 4 / Batch B 6；实际混合 Report、混合 Completion 和跨 Batch 下游消费均被 409 拒绝。
7. Finished Goods Ledger 为 `+4/+6`，两行 `lot_code=''`，`MAIN` Balance=10。Batch A/B 均 `COMPLETED`；Work Order planned/reported/good/scrap/completed=`10/10/10/0/10`，状态 `COMPLETED`，未自动 `CLOSED`。
8. 两条 genealogy 分别完整返回稳定关系；FQC、Shipment、Sales Financial Source、AR、Settlement 均为 0。额外创建的 ORDER 模式工单实际完成首序 Run/Report，`production_batch_id` 为 null，TASK01—TASK06 历史路径保持兼容。

## 权限、安全与守恒

- production 管理 Batch Set/Batch Run；quality 按权限读取品质谱系；warehouse 读取 Completion 关联；engineering 只读工艺/BOM/Batch 上下文；manager/admin 管理。planning 创建 Batch Set、warehouse 派工 REWORK 等实际写入返回 403。
- 所有写操作继续执行 Session/must-change、CSRF、64 KiB 正文、速率限制、持久 Idempotency-Key、CAS/version、固定锁顺序、request_id、中文安全错误和单事务 Audit；幂等重放返回原结果，异正文冲突、并发唯一发布/编码和故障零半记录均通过。
- PostgreSQL guard 覆盖发布合计、已发布不可变、首序超量、跨工单/跨 Batch Run/Input Allocation、REWORK 继承、Report/Completion 单 Batch、稳定外键和 deferred Work Order/Batch 守恒。直接 SQL 无法伪造跨 Batch、超量或修改已发布事实。
- Dashboard 按权限返回 DRAFT Batch Set、已发布待执行、Batch WIP、Quality Hold、Rework、Final Output 和 Completed Batch 七项指标；页面明确区分 NORMAL/REWORK、Quality Hold、当前工序和 genealogy，并显示非 Inventory Lot 边界。

## 自动测试

本任务记录的不重复 Node 自动测试共 208 项通过：

- unit/UI：82 项，覆盖 TASK07、Phase 4 TASK07/TASK08、Phase 5 TASK01—TASK06、Production、Routing、Quality、Nonconformance、Rework、Inventory、Dashboard 和 Identity/Permissions。
- PostgreSQL/API：67 项，覆盖 Batch code、数量守恒、NORMAL/REWORK 绑定、跨 Batch 拒绝、品质/NCR/复检谱系、Report/Completion 单 Batch、权限、幂等、CAS、并发、故障回滚、直接 SQL 与既有 Production/Quality 回归。
- Migration upgrade：40 项，覆盖新空库、历史升级、重复执行、失败事务回滚、ORDER 模式、Schema/snapshot/journal/checksum，以及 Phase 4 TASK07/TASK08、Phase 5 TASK01—TASK06 历史 migration 回归。
- 基础与治理：`npm test` 3、environment guard 6、migration manifest 8、API coverage 2，共 19 项。

另有 9 组正式 typecheck、Drizzle generator consistency、lint 0 error/9 个 warning、Vinext Web build、Worker build、credentials scan、`git diff --check` 全部通过。Python `/opt/erp/.venv/bin/python` 的 `server.py --self-test`、`smoke_test.py` 和 TASK07 临时 SQLite `go_live_check.py --no-backup` 全部通过。

## Compose 重启、备份恢复与清理

- 首次预备份命令误带 Compose 依赖，自动先执行了 0031，随后在写 dump 前因参数未传入容器而退出。该偏差被立即停止：先创建 1,596,444 bytes 的事故安全 custom dump，再在单一事务中移除 0031 对象和 migration row，核对主库恢复为 30 migrations、唯一管理员、业务/Audit/Idempotency 0、Batch 表/列不存在。之后所有一次性容器固定 `--no-deps`。
- 在恢复的精确 0030 起点上，停 Web/Worker 创建正式 TASK07 预变更备份：dump 1,539,552 bytes，SHA-256 `b3c499cf82ea090a65e514f895fd8da963a00551071fabb73cedd6cbdfe5f75b`；30 项源码/数据库 checksum、非零、0600、`pg_restore --list`、uploads/attachments 0 全部通过。
- 正式应用 0031 后串行重建 Web/Worker；实际 HTTP 验收完成后停止 Worker/Web、重启 PostgreSQL，再按顺序启动 Web/Worker。重启后 31 migrations、Batch `4/6`、NORMAL Run 9、REWORK Run 1、ORDER Run 1、Inspection 3、NCR 1、Report/Completion 2、Ledger `4/6`、Audit 85、Idempotency 71 全部保持。
- 接受态停服备份：dump 1,638,643 bytes，SHA-256 `6a19e3a850dbb0014c00497f1916ba6f0c103f3035b631f348a4fe0e76f0f936`；31 项 migration manifest、非零、0600、`pg_restore --list`、空文件卷通过。
- 接受态恢复到固定第二新空 PostgreSQL `chenyida_erp_task07_restore`，再次核对 31 migrations、Batch A 4 / Batch B 6、9 NORMAL + 1 REWORK + 1 ORDER Run、3 Inspection、NCR、两条 Report/Completion、Ledger `4/6`、空 lot、Balance 10、Audit 85、Idempotency 71，随后删除恢复库。
- 主库最终为 31 migrations、app_meta 1、app_users 1、唯一启用且无需改密的 admin；其他所有公共业务/Audit/Idempotency/临时账号为 0，uploads/attachments 文件为 0。
- TASK07 测试/恢复库、临时 SQLite、迁移/Drizzle/清单目录、Compose 环境文件、事故 dump、两份已验证任务备份和辅助镜像均按精确名称删除；任务备份删除后不可恢复。resource-guard 备份 `/var/backups/chenyida-erp/resource-guard-20260727-0824.dump` 保留，SHA-256 `ffd176e43192c575a0b5c7e3f2469f93f779605ca445bcfc6218ed8c810b6570`。
- 最终仅运行 PostgreSQL/Web/Worker 三容器，只保留四个原持久卷；Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口。

## 低资源与 Python/SQLite 保护

- 起点：available memory 约 2.4 GiB、Swap 约 148 MiB、根分区可用约 15 GiB；三个容器 RestartCount 0、OOMKilled false。
- 最终：available memory 约 2.4 GiB、Swap 148 MiB、根分区可用 14 GiB、Load `0.81/0.91/0.71`；三容器 RestartCount 0、OOMKilled false，PostgreSQL/Web healthy、Worker running。
- 最终独立 60 秒 Swap 观测：155,295,744 → 155,295,744 bytes，增长 0；期间 Load1 为 1.25→0.96。没有触发 available<768 MiB、Swap>80%、60 秒增长>256 MiB、构建前磁盘<12 GiB、重任务磁盘<10 GiB、持续 Load>4、OOM、反复重启或 PostgreSQL unhealthy 停止线。
- 全程 `COMPOSE_PARALLEL_LIMIT=1`；Web/Worker 分开构建，Migration、测试、typecheck、备份恢复和 Compose 重启串行；一次最多一个临时容器/数据库；Node 重任务 heap 1024 MiB，Web/Worker heap 384 MiB。
- 常驻 Python PID 始终为 `13737`，未停止或重启。真实 SQLite 只核验 metadata：inode `53827608`、size `1544192`、mtime `1784999031`、birth `1784356951`、mode `600`；未读取或修改业务正文。
- 独立 ops 提交完成后预期 Git 工作区 clean，`origin/main...HEAD` behind 0/ahead 58；最终值以提交后复核为准。

## 明确未执行

未实现或执行 Inventory Lot Balance、原材料批次、供应商批次、成品仓库批次可用量、批次冻结/解冻、Shipment 批次消费、序列号、标签打印/条码/二维码、自动 Batch 创建、设备/OEE、外协、产能排程、成本会计、FQC/Shipment/AR/财务动作、历史数据整理/迁移、Python 服务操作、HTTPS/防火墙、生产部署/切流、push、PR 或 `SELFHOST-PHASE5-TASK08`。
