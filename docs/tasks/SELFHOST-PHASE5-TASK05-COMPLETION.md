# SELFHOST-PHASE5-TASK05 完成报告

## 完成结论

`SELFHOST-PHASE5-TASK05 — IPQC 不合格处置与返工申请交接` 已在现有 `chenyida-erp-parallel` 回环非生产环境完成并停止。

固定结论：`IPQC NONCONFORMANCE TO REWORK REQUEST ACCEPTED IN PARALLEL ENVIRONMENT`

本结论只表示 IPQC failed quantity 已通过稳定 NCR 交接为 production 接收的返工申请；没有执行 Rework Run、派工、开工、报工、再检、库存报废、补产或 TASK06。

## Git、版本与 Migration

- 起始 Branch/HEAD：`main` / `736f14b9510ca52ce39fea7154872dffe7818986`；起点工作区 clean，`origin/main...HEAD` behind 0/ahead 50。
- 功能提交：`1de057a6a248ca3346d7d2b0f201252a3965eced`，消息 `feat: add production nonconformance handoff`，Parent 严格为 `736f14b9510ca52ce39fea7154872dffe7818986`。
- 验收提交：本报告所在独立提交，消息 `ops: accept production rework request workflow in parallel environment`；实际 SHA 以最终 `git log -1` 为准，不 amend、不 rebase、不 push。
- 验收提交后最终预期：工作区 clean，`origin/main...HEAD` behind 0/ahead 52；最终实测写入交接输出。
- 版本：`0.1.0-alpha.28` → `0.1.0-alpha.29`。
- 唯一新增 Migration：`0029_production_nonconformance_rework_handoff.sql`；`0001`—`0028` 未修改。
- `0029` 文件 SHA-256 与主库 checksum：`6814a728f4d04e4fbceb83c7a288fa214a9ec64317b547cc6cbaebfec456b40c`。
- `db/schema.ts`、Drizzle journal、`0029_snapshot.json` 与 generator consistency 一致；generator 返回 `No schema changes, nothing to migrate`。

## 实现边界

- 新增关系化 NCR Header/Event、Rework Request/不可变提交 Version/Event、Nonconformance Allocation 与不可变 Scrap Disposition；没有创建第二套 Quality、Inspection、Defect、Operation Run、WIP 或 Inventory 权威。
- NCR 只能从 failed>0、存在 FAIL Result 与有效 Defect 的结构化 Operation Run Report IPQC 创建；Work Order、Snapshot Operation、Work Center、Material、Unit、Run Report 与 failed quantity 均由服务端继承。
- PostgreSQL 在事务提交时核对 `failed_qty = active_rework_qty + final_scrap_qty + unresolved_qty`；numeric、外键、唯一约束、不可变 trigger、服务写 guard 与 deferred conservation 同时阻止超量、重复消费、跨工单和直接 SQL 伪造。
- DRAFT 可 CAS 编辑但不占用数量；SUBMITTED 固化 64 位 canonical digest 与不可变版本并占用；RETURNED/CANCELLED 释放；ACCEPTED 持续占用且不可修改/取消。返工目标只能是同一 Work Order Snapshot 中原工序或更早工序。
- manager/admin 的 SCRAP 是不可逆工序不合格事实，不写 Inventory Ledger/Balance，不补产、不写财务。
- 页面新增 `/quality/nonconformances`、`/quality/rework-requests`、`/production/rework-requests`；Dashboard 新增五项权限裁剪只读指标，不自动处置。

## 自动测试

按不重复测试用例统计共 166 项 Node 自动测试通过：

- unit/UI contract：72 项，覆盖 Phase 4 TASK07/TASK08、Phase 5 TASK01—TASK05、Production、Quality、Inventory、Dashboard、Identity 与 API coverage。
- PostgreSQL/API：47 项，覆盖 passed/failed 分离、failed=0、FAIL/Defect 证据、数量守恒、RETURN 释放、ACCEPT 不可变、SCRAP 不可逆、目标/跨工单、职责分离、403、幂等、CAS、并发唯一结果、故障回滚、直接 SQL 和 TASK02—TASK04 回归。
- Migration upgrade：38 项，覆盖 Identity/Inventory/Production/Quality、Phase 4 TASK07/TASK08、Phase 5 TASK01—TASK05 的空库、历史升级、重复执行、失败回滚、兼容、checksum 与 schema/snapshot/journal。
- 基础 `npm test`：3 项；environment guard：6 项。

其他验证全部通过：正式 `typecheck:phase5-task05`、Drizzle consistency、lint 0 error（8 个既有 warning）、Vinext build、955 个仓库文件 credentials scan、`git diff --check`；Python `server.py --self-test`、`smoke_test.py` 和 TASK05 临时 SQLite `go_live_check.py --no-backup`。

测试期间一次 TASK05 并发用例暴露错误优先级不稳定：accept 与 SCRAP 并发时失败方可能先得到 stale NCR 409，而非未分配数量不足 422。实现已在同一 NCR 锁内先验证当前 unresolved，再验证 CAS，使业务错误稳定；原并发唯一结果和数据库守恒断言保持。一次历史 0028 测试假定 journal 最后一项永远为 0028，已改为精确核对 idx/tag 28，同时 TASK05 测试继续强制 0029 为最后项。两项修正后完整回归通过。

## 实际 HTTP 验收

在回环 Web 与受控临时账号上完成：

1. 建立 `SMT-PRINT`、`SMT-MOUNT`、`REFLOW`、`AOI` 四个 Work Center，发布 `NONE/NONE/IPQC/NONE` Routing。
2. 创建并释放 planned 10 Work Order，完整领料 10；前三个 Snapshot Operation 各执行 10。
3. quality 显式创建 REFLOW IPQC：inspected 10、passed 8、failed 2，包含 PASS/FAIL Result 与 Defect 2；manager 异人 RELEASE passed 8，quality close。
4. AOI available=`8.000000`，REFLOW Quality Hold=`2.000000`；唯一 NCR failed=`2.000000`、unresolved=`2.000000`。
5. quality 创建并提交 Rework Request v1 quantity 2/target REFLOW；production 以原因退回，allocation 释放且 unresolved 回到 2。
6. quality 以 `supersedes_request_id` 创建不可变修订 v2，重新提交；production 接收。最终 active accepted rework=`2.000000`、final scrap=`0.000000`、unresolved=`0.000000`、NCR=`REWORK_ACCEPTED`。
7. v1/v2 各保留独立 64 位 digest、提交快照和事件；请求事件 6、NCR 事件 5、active allocation 1。
8. Inspection reopen、来源 REFLOW Run 冲销、ACCEPTED v2 修改/取消均返回冲突；quality 自接收和 engineering/warehouse/sales 等越权写入返回 403。
9. AOI available 仍为 8，Quality Hold/Rework Queue 合计仍为 2；Rework Run 0、额外 Run Report 0、Production Report 0、Completion 0、Finished Goods Ledger/Balance 0、FQC/Shipment/AR/Settlement 0。

## 重启、备份恢复与清理

- 修改主库前停 Web/Worker 创建 TASK05 预变更备份：dump 1,411,142 bytes，SHA-256 `5a5051b8d80d881534bbb0f5a484a9700e5bc3b0c7cd0bfc47dea56a8201d1ce`；非零、manifest/migration checksum 和 `pg_restore --list` 通过。
- Compose 三容器整体串行重启后，29 migrations、NCR、v1 RETURNED/v2 ACCEPTED、2 个提交快照、6 个请求事件、digest、Audit 44、Idempotency 30 与数量守恒全部保持。
- 接受态停服备份：dump 1,517,240 bytes，SHA-256 `440fae8efd3427a341d7c8d2d24ebf516de9ef9dfd9acb50b5e841ebf069afbc`；`verify-backup-selfhost.sh` 和 `pg_restore --list` 通过。
- 接受态备份恢复到固定第二新空 PostgreSQL `chenyida_erp_task05_restore`；核对 29 migrations、NCR failed 2/active 2/unresolved 0、v1/v2 状态、2 个提交快照、6 个事件、3 Run/Report、Audit 44、Idempotency 30；随后删除恢复库和空恢复目录。
- 并行主库最终逐表核对：schema_migrations 29、app_meta 1、app_users 1、唯一启用 admin；其他所有公共业务/Audit/Idempotency/临时账号记录 0。uploads/attachments 文件 0。
- 最终只运行原 PostgreSQL/Web/Worker 三容器，只保留原四个持久卷；三容器 RestartCount 0、OOMKilled false；Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口。
- 两份 TASK05 备份、TASK05 测试/恢复库、临时目录、临时容器与 `chenyida-erp-task05-deps` 辅助镜像已删除。resource-guard 备份 `/var/backups/chenyida-erp/resource-guard-20260727-0824.dump` 保留，SHA-256 `ffd176e43192c575a0b5c7e3f2469f93f779605ca445bcfc6218ed8c810b6570`。

## 低资源与 Python/SQLite 保护

- 起点：available memory 约 2.4 GiB、Swap 约 111 MiB、根分区可用约 21 GiB、Load 约 `0.49/0.44/0.51`；三容器 RestartCount 0、OOMKilled false。
- 最终：available memory 2.4 GiB、Swap 150 MiB、根分区可用 17 GiB、Load `0.18/0.31/0.82`；三容器 RestartCount 0、OOMKilled false。
- 独立 60 秒 Swap：157,892,608 → 157,872,128 bytes，增长 `-20,480` bytes，正增长 0；未触发 768 MiB available、80% Swap、10 GiB disk、持续 Load>4、OOM/restart 或数据库健康停止线。
- 全程 `COMPOSE_PARALLEL_LIMIT=1`；build、Migration、测试、备份恢复和 Compose 重启串行；一次最多一个临时容器/测试库；Node 重任务 heap 1024 MiB，Web/Worker heap 384 MiB。
- 常驻 Python PID 始终为 `13737`，未停止或重启。真实 SQLite 只核验 metadata：inode `53827608`、size `1544192`、mtime `1784999031`、birth `1784356951`、mode `600`；未读取或修改业务正文。

## 明确未执行

未执行实际 Rework Run、返工派工/开工/报工/再检、自动创建 NCR/IPQC/返工申请、SCRAP 库存过账、自动补产/补料、批次/序列/追溯、设备/OEE、外协、产能排程、成本会计、FQC/Shipment/AR/财务动作、历史数据整理/迁移、Python 服务操作、HTTPS/防火墙、生产部署/切流、push、PR 或 `SELFHOST-PHASE5-TASK06`。
