# SELFHOST-PHASE5-TASK04 完成报告

## 结论

`PRODUCTION OPERATION IPQC GATE ACCEPTED IN PARALLEL ENVIRONMENT`

本结论只适用于现有 `chenyida-erp-parallel` 回环非生产环境。TASK04 已完成并停止；未启动 `SELFHOST-PHASE5-TASK05`。

## Git、版本与 Migration

- 起始 Branch/HEAD：`main` / `f6e5ff2e8344e79a35f56311b02b514613484f59`；起点 clean、behind 0/ahead 47。
- 功能提交：`5379550d0381818ad970518ac4fb8261c4679989`，Parent 严格为起始 HEAD，消息 `feat: add production operation quality gates`。
- 聚焦修正：`56f63ca714ed6f359bc51f681b6a532259747f1b`，Parent `5379550d0381818ad970518ac4fb8261c4679989`，只修正 Compose 验收脚本的既有 Dashboard 路径并补充对已形成事实的认证核验阶段。
- 独立 ops 验收提交消息：`ops: accept production quality gate workflow in parallel environment`；Parent 为 `56f63ca714ed6f359bc51f681b6a532259747f1b`，实际哈希以 `git log` 为准，不 amend/rebase。
- 版本：`0.1.0-alpha.27` → `0.1.0-alpha.28`。
- 唯一新增 Migration：`0028_production_operation_quality_gates.sql`；完整 SHA-256 和并行数据库 checksum 均为 `a7a55f7c6c81b1c5a80df59a1b3f639187cc2c2ce8658087ceb392b1f2ada912`。
- `0001`—`0027` 未修改；`db/schema.ts`、Drizzle journal、`0028_snapshot.json`、Migration 和运行时查询一致。历史导入 manifest 仍严格绑定并逐项校验 `0001`—`0017`，但允许目录存在后续版本化 migration。

## 交付边界

- Routing Operation 新增受控 `NONE/IPQC`。engineering 只在 DRAFT 编辑；门禁进入 v2 canonical digest，Released Routing 不可变，并在 Work Order RELEASE 时固化到 Snapshot Operation。历史默认 `NONE`。
- IPQC 工序的 Run Report good 不自动创建 Inspection，而是先形成稳定待检来源和 Quality Hold。quality 显式引用 `production_operation_run_report_id` 创建既有 Quality Inspection；服务端确定 Work Order、Snapshot Operation、Work Center、Material、Unit 和来源数量。
- 新 Operation Run Report 来源与历史 `production_report_id` IPQC 来源互斥且兼容，不批量改写历史 Inspection，不复制 Quality/Result/Defect/Event 权威。
- 只有 `CLOSED + RELEASED` 数量形成下游额度。下一 Snapshot Operation Run Input Allocation 或 TASK03 Final Output Allocation 精确消费；NONE 工序继续使用 TASK02/TASK03 原 good 直通语义。
- WIP 返回 `quality_gate_mode`、required/inspected/released/hold、available-for-next、final-output-available 和 version；Routing、dispatch、operations、WIP、Quality 页面与 Dashboard 五项指标已更新，Dashboard 只读。

## 自动验证

- TASK04 专项 15 项：unit 3、UI contract 4、PostgreSQL/API 4、Migration 4。
- 最终记录的 TAP 验证共 146 个通过结果：专项 15、完整 unit/UI 回归 56、PostgreSQL/API 回归 40、历史 migration upgrade 回归 16、迁移 manifest 8、API coverage 2、环境守卫 6、`npm test` 3；其中为证明修正而重跑的范围可能与专项重叠，未把它们冒充唯一业务用例数。
- Migration 覆盖空库、`0027→0028`、重复执行、失败事务回滚、历史 Routing 默认 NONE、历史 Report IPQC 兼容、新结构化来源/直接 SQL guard、checksum 和 Schema consistency。
- 正式 TASK04 typecheck、Schema consistency、lint、Vinext build、credentials scan 和 `git diff --check` 全部通过；未升级依赖。
- Python `/opt/erp/.venv/bin/python` 的 `server.py --self-test`、`smoke_test.py`、任务专用临时 SQLite `go_live_check.py --no-backup` 全部通过，临时 SQLite 已清理。

## 实际 HTTP 4/6 IPQC 门禁链

- 创建 `SMT-PRINT`、`SMT-MOUNT`、`REFLOW`、`AOI` 四个 Work Center；engineering 创建 `NONE/NONE/IPQC/NONE` Routing 并提交，manager 异人发布。
- 创建 planned 10 Work Order，释放并完整领料 10；SMT-PRINT、SMT-MOUNT、REFLOW 均按 `4/6` 执行，processed/good/scrap=`10/10/0`。
- REFLOW 完成后两条 Run Report good 为 `4/6`；Quality Hold 10、released 0、AOI available/dispatchable 0，未检 AOI 派工返回业务冲突；Production Report/Completion/成品 Ledger/Balance 均为 0。
- quality 显式创建两条稳定来源 IPQC `4/6`，manager 异人处置 RELEASE，quality 关闭。inspected/passed/released=`4/6`，failed 0；Hold `10→6→0`，AOI available `0→4→10`。
- production 在全部放行后执行 AOI `4/6`；复用 TASK03 创建 Final Output Allocation 和 Production Report `4/6`，warehouse 创建 Completion/Report Allocation `4/6`。
- 最终四工序 processed/good/scrap=`10/10/0`；REFLOW IPQC inspected/passed/released=`10/10/10`；Finished Goods Ledger `+4/+6`、Balance 10；Work Order planned/reported/good/scrap/completed=`10/10/10/0/10`，状态 `COMPLETED`。
- FQC、Shipment、Sales Financial Source、AR、Settlement 全部为 0。

## 保护验证

- warehouse 创建 IPQC 实际返回 403；engineering/production/quality/manager 的配置、执行、检验、异人处置/关闭职责边界通过。
- Idempotency-Key 同正文重放返回同一 Inspection 和 replay 标记；同 Key 异正文冲突。Work Order/Operation/WIP/Inspection CAS 和固定锁顺序通过。
- inspected/released 不超来源 good/passed；OPEN、HOLD、REWORK、SCRAP 和未关闭 Inspection 不释放；failed 必须有 FAIL Result/Defect 证据。
- 并发创建/close/reopen/消费仅允许安全结果；数据库拒绝非 IPQC、跨 Work Order/快照、互斥来源伪造、超量、不可变事实修改和绕过 WIP 投影直接放行。
- 有 IPQC 后 REFLOW Run 冲销被拒绝；AOI 消费后 IPQC reopen 被拒绝；NONE 直通、TASK02 Run 冲销和 TASK03 Report/Completion 门禁回归通过。
- Quality、Projection、Audit、Idempotency 故障注入零半记录；没有部分 Inspection、投影或审计残留。
- 首轮实际链在所有业务事实断言通过后，因脚本误用不存在的 `/api/dashboard/management` 路径以 404 退出。未清除或覆盖已形成事实；追加聚焦修正为仓库权威 `/api/management-dashboard`，随后用新 operations 账号完成实际认证并核对全部五项指标，再完成重启和恢复阶段。没有降低断言或绕过业务门禁。

## 重启、备份恢复与清理

- 修改主库前停 Web/Worker 创建 TASK04 专用 0027 dump：1,399,868 bytes，SHA-256 `99a87fb7986a2622bcb56dc04103188b69d255ef1a2ec8121bc2172f7b5587d1`，非零且 `pg_restore --list` 通过。
- 串行构建并写入 `0028`，Web/Worker 均保持 `NODE_OPTIONS=--max-old-space-size=384`。Compose 整体重启后 28 migrations、8 Run、8 Run Report、2 Inspection、2 Result、6 Quality Event、2 Final Allocation、2 Report、2 Completion/Allocation、2 Ledger、Balance 10、COMPLETED、Audit/Idempotency 全部保持。
- 接受态停服备份为 1,438,390 bytes，SHA-256 `4da56e4303afae15ac0e5e7e8f550711ec66cbcae669dcac8b4b1f4c8e360a65`，custom archive 2,665 TOC entries，`pg_restore --list` 通过。
- 接受态备份恢复到固定第二新空 PostgreSQL 数据库 `chenyida_erp_task04_restore`；核对 28 migrations 与完整 `4/6` IPQC/Report/Completion/Ledger 链后删除该库。
- 主库最终恢复为 28 migrations、唯一启用管理员；全部合成业务、Audit、Idempotency、验收账号、uploads、attachments 为 0。只保留 PostgreSQL/Web/Worker 三容器和原四个持久卷。
- 已删除且只删除 TASK04 的恢复库、两份任务 dump、Drizzle/credentials 临时目录、测试依赖镜像、migrate 临时标签、本地 build 产物和自动清理的临时容器。既有 `/var/backups/chenyida-erp/resource-guard-20260727-0824.dump` 保留，SHA-256 仍为 `ffd176e43192c575a0b5c7e3f2469f93f779605ca445bcfc6218ed8c810b6570`。

## 资源与旧运行面保护

- 起点可用内存约 2.4 GiB、Swap 约 86 MiB、根分区可用约 21 GiB；各 build、Migration、测试、重启和恢复均串行并在前后采样，available memory 始终高于 2.3 GiB，磁盘始终高于 20 GiB，Load 未持续超过 4。
- 最终可用内存 2.4 GiB、Swap 111 MiB、根分区可用 21 GiB、Load `0.49/0.44/0.51`。独立 60 秒观察为 Swap used `113688→113684 KiB`，增长 `-4 KiB`，正增长 0。
- PostgreSQL/Web/Worker 最终 RestartCount 均 0、OOMKilled 均 false；PostgreSQL/Web healthy、Worker running。全程没有 OOM、容器反复重启、SSH 卡顿或数据库失去健康。
- Python systemd 进程保持 PID `13737`，未停止或重启；真实 SQLite 只核验 metadata：inode `53827608`、size `1544192`、mtime/ctime epoch `1784999031`、mode `600`，任务前后一致，未读取或修改业务正文。
- Web 仍只监听 `127.0.0.1:3000`，PostgreSQL 无宿主发布端口；四个持久卷名称和内容边界保持。

## 最终 Git 与未执行边界

- ops 提交前 Git 为 clean、behind 0/ahead 49；ops 提交后预期 behind 0/ahead 50，最终以 `git status` 与 `git rev-list` 为准。
- 未自动创建 IPQC/FQC，未执行 FQC、Shipment、AR 或其他财务动作，未实现返工/返修路线、failed/scrap 库存过账、批次/序列/追溯、设备/OEE、外协、产能排程或成本会计。
- 未读取真实 SQLite 业务正文，未操作 Python 服务，未修改 HTTPS/80/443、防火墙、Swap、dockerd、内核或 systemd；未迁移真实数据、生产部署/切流、push、PR 或启动 TASK05。
