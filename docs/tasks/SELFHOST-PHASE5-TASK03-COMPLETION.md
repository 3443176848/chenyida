# SELFHOST-PHASE5-TASK03 完成报告

## 结论

`STRUCTURED FINAL OUTPUT TO FINISHED GOODS ACCEPTED IN PARALLEL ENVIRONMENT`

本结论只适用于现有 `chenyida-erp-parallel` 回环非生产环境。TASK03 已完成并停止；未启动 `SELFHOST-PHASE5-TASK04`。

## Git、版本与 Migration

- 起始 Branch/HEAD：`main` / `a6448ac42da737e31fee76085fb699e80f3c621b`；Parent `120e1524eaebd9d921cab6a036b3203bf7d39226`；起点 clean、behind 0/ahead 43。
- 功能提交：`1dae9661d07f7af7e866a1654804742372b8bc76`，Parent 严格为起始 HEAD，消息 `feat: bind final operation output to production reporting`。
- 聚焦修正一：`1a01172f14e9d4b3b51ec10430b188aa79efa96d`，Parent `1dae9661d07f7af7e866a1654804742372b8bc76`，只修正验收脚本 Routing 发布职责分离。
- 聚焦修正二：`2eb5120bf98c9d45705cf96e2a25afb37cc154a3`，Parent `1a01172f14e9d4b3b51ec10430b188aa79efa96d`，只把 restore phase 限定到固定第二恢复库。
- 独立 ops 验收提交消息：`ops: accept structured final output workflow in parallel environment`；实际哈希以 `git log` 为准，不 amend/rebase。
- 版本：`0.1.0-alpha.26` → `0.1.0-alpha.27`。
- 唯一新增 Migration：`0027_production_final_output_reporting.sql`；完整 SHA-256 和并行数据库 checksum 均为 `b226cc958215400c38f48c925e4b33c4e97723340aaf729d4da75322213b9c76`。
- `0001`—`0026` 未修改；`db/schema.ts`、Drizzle journal、`0027_snapshot.json`、Migration 与运行时查询一致。

## 交付边界

- 新增稳定且不可变的 `production_report_operation_allocations`，只把同一 Work Order 最后 Snapshot Operation 的有效 Run Report good 分配给既有 Production Report。
- 结构化 Report 的 reported/good、scrap=0、末工序阶段和 operator 全部由服务端生成；浏览器不提交 final-output 投影或自由工序/操作员字段。
- 复用 TASK07 的 Production Report、Receipt Projection、warehouse Completion、Report→Completion Allocation 和 Inventory Service，没有第二套 Report、Completion 或库存权威。
- 数据库外键、numeric、唯一/索引、服务写入/不可变 trigger 和 deferred reconciliation 阻止超量、跨工单、非末工序、无 Allocation、投影失配与事实修改；应用层叠加 CSRF、权限、正文/速率限制、持久幂等、CAS、固定锁顺序、request_id 与同事务 Audit。
- 无 Routing Snapshot 的历史 Work Order 保留明确标记的兼容路径；结构化 Work Order 拒绝 legacy 自由文本 Report 和自动 report+completion 快捷路径。

## 自动验证

- TASK03 专项 12 项：unit 2、UI contract 3、PostgreSQL/API 3、Migration 4。
- 适用回归 82 项：Phase 4 TASK06/TASK07、Phase 5 TASK01/TASK02、Production、Routing、Inventory、Dashboard、Identity。
- 合计 94 项自动测试通过；另有 Compose acceptance 的 `initial`、`restart`、`restore`、`cleanup` 四阶段通过。
- Migration 覆盖空库、`0026→0027`、重复执行、失败事务回滚、历史兼容、结构化 guard、checksum 与 Schema consistency。
- 正式 TASK03 typecheck、lint 0 error（8 个既有 warning）、Vinext build、928 个仓库文件 credentials scan、`git diff --check` 与 Python `server.py --self-test`、`smoke_test.py`、临时 SQLite `go_live_check.py --no-backup` 全部通过。
- 初次 acceptance 在路线发布职责分离处被正确拒绝，受控 cleanup 恢复 `27/1/0/0/0` 后追加聚焦修正；没有通过降低断言或绕过职责分离处理。restore 目标安全门随后收紧为固定恢复库并追加第二聚焦修正。

## 实际 HTTP 4/6 旅程

- 创建 `SMT-PRINT`、`SMT-MOUNT`、`REFLOW`、`AOI` 四 Work Center，异人发布四工序 Routing Snapshot，释放 planned 10 工单并完整领料 10。
- 四工序各按 `4/6` 派工、开工、Run Report，全部 good、scrap 0；末工序 final output available 为 10。
- AOI 两个稳定 Run Report 来源分别建立 Production Report `4/6`，final output `10→6→0`。其中首次 4 Report 在无下游时全额冲销使 final output 恢复 10，再重新报工完成有效链；原 Report/Allocation 保持不可变并追加 Reversal。
- 正式 Completion 前：Completion 0、成品 Ledger 0、Balance 0、IPQC/FQC 0。
- warehouse 显式创建 Completion `4/6`；有效 Final Output Allocation、Production Report、Report→Completion Allocation 均为 `4/6`，Finished Goods Ledger 为 `+4/+6`，Balance 10。
- Work Order 最终 planned/reported/good/scrap/completed=`10/10/10/0/10`，状态 `COMPLETED`，未自动 `CLOSED`。
- IPQC/FQC、Shipment、Sales Financial Source、AR、Settlement 全部为 0。

## 保护验证

- Idempotency-Key 同正文重放返回同一 Report 并带 replay 标记；同 Key 异正文返回 `IDEMPOTENCY_CONFLICT`。
- Work Order、WIP/final-output、Report CAS 通过；两个请求并发消费同一来源不能超量，同一 Run Report 不能重复超额消费。
- 跨 Work Order、非末工序、已冲销来源和直接 SQL 伪造/超量均被拒绝。
- Report、Allocation、WIP、Work Order、Audit、Idempotency 故障注入零半记录；既有 Completion 并发唯一消费和故障零半记录回归通过。
- production/warehouse/manager/admin/quality 按既有职责工作；sales 等越权角色实际返回 403。
- 无下游 Report 冲销恢复 final output；已有 Completion 时 Report 冲销被阻止；有效 Report 消费后 Operation Run 冲销被阻止；并发冲销只能一次成功。

## 重启、备份恢复与清理

- 修改主库前停 Web/Worker 创建 0026 专用备份：dump SHA-256 `7444c8ae7c6d61a3ff7ea0c333e04efbbab8a11a8598f7bbbc4f43bd7f0bd8bf`，`pg_restore --list` 2649 行。
- Compose 串行停止 Worker→Web→PostgreSQL，再启动 PostgreSQL→Migrate→Web→Worker。重启后 27 migrations、8 Run、8 Run Report、3 Report（1 冲销）、3 Final Allocation、2 Completion、2 Completion Allocation、2 Ledger、Balance 10、COMPLETED、Audit 51、Idempotency 41 全部保持。
- 接受态停服备份 dump SHA-256 `16d63e5cbe1f85aa1a70f1414edb5a66d008faefe076b9739e92f9a71976f9f6`，`pg_restore --list` 2671 行；恢复到固定第二新空 PostgreSQL 数据库后再次核对上述完整 4/6 事实与 27 migrations。
- 最终删除 TASK03 测试库、恢复库、恢复目录、两份任务备份和退出的 migrate 容器；既有 `/var/backups/chenyida-erp/resource-guard-20260727-0824.dump` 保留且 SHA-256 `ffd176e43192c575a0b5c7e3f2469f93f779605ca445bcfc6218ed8c810b6570`。
- 并行主库最终为 27 migrations、唯一启用管理员；其余业务表、Audit、Idempotency、验收账号、uploads、attachments 全部 0。只保留 PostgreSQL/Web/Worker 三容器和原四个持久卷。

## 资源与旧运行面保护

- 任务起点门禁：available memory 约 2.2 GiB、Swap 约 42 MiB、根分区可用约 26 GiB、Load 低于 4；起点 60 秒 Swap `43180→41748 KiB`，正增长 0。
- 最终 60 秒观察结束：available memory 2.4 GiB、Swap 90 MiB、根分区可用 22 GiB、Load `0.06/0.32/0.57`；删除 TASK03 工具镜像后的最终交接为 available memory 2.3 GiB、Swap 90 MiB、根分区可用 23 GiB、Load `0.37/0.31/0.54`。
- 最终 60 秒：Swap `92908→92908 KiB`，增长 0；六次采样 available memory 始终约 2.4 GiB，Load 均远低于 4。
- PostgreSQL/Web/Worker 最终 RestartCount 均 0、OOMKilled 均 false；PostgreSQL/Web healthy、Worker running。全程无 OOM、重启循环、数据库 unhealthy 或资源熔断。
- Python systemd 保持 active，PID `13737`、NRestarts 0；真实 SQLite 仅核验 metadata：inode `53827608`、size `1544192`、mode `600`、mtime `2026-07-26 01:03:51.761827070 +0800`，未读取或修改业务正文，未停止或重启 Python。

## 未执行的生产边界

未创建或自动放行 IPQC/FQC，未执行 Shipment、AR、收付款、返工/返修、批次/序列/追溯、设备/OEE/停机、外协、产能排程、成本会计、真实 SQLite 数据迁移、HTTPS/80/443、防火墙、Python 服务操作、生产部署/切流、push 或 PR；未启动 PHASE5-TASK04。
