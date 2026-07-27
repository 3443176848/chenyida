# SELFHOST-PHASE5-TASK06 — 返工执行、复检与生产流恢复

## 状态与授权

- 状态：`DOING`
- 日期：2026-07-27（Asia/Shanghai）
- 授权：项目负责人明确授权只执行 TASK06，包括代码、`0030`、隔离测试、现有回环并行环境实际 HTTP 验收、Compose 串行重启、停服备份恢复、清理、文档和独立 Git 提交。
- 合法起点：`main` / `11bc680a91c59258c94f8ddca3d56af71981811e`，Parent `1de057a6a248ca3346d7d2b0f201252a3965eced`；工作区 clean，`origin/main...HEAD` behind 0/ahead 52。
- 依赖：`SELFHOST-PHASE5-TASK05`、`SELFHOST-PHASE5-TASK04`、`SELFHOST-PHASE5-TASK03`、`SELFHOST-PHASE5-TASK02`、`SELFHOST-PHASE5-TASK01`，以及既有 Production Operation、Quality、Nonconformance、Inventory、Identity、Dashboard 与备份恢复权威模块。
- 完成门槛：代码、Migration、专项与适用回归、实际 HTTP 8+2、Compose 重启持久、接受态停服备份/固定第二新空库恢复、主库干净 0030、资源清理、文档和独立提交全部通过后才能改为 DONE。

## 唯一业务链

```text
ACCEPTED Rework Request
  -> production 显式返工派工
  -> 既有 Operation Run（run_kind=REWORK）
  -> start / immutable Run Report
  -> good 进入目标 Snapshot Operation 的既有 IPQC 门禁
  -> quality 显式创建新的稳定来源复检
  -> 异人 RELEASE + CLOSED
  -> 按原 Routing Snapshot 顺序恢复后续 WIP
  -> TASK03 Final Output / Production Report / Completion
  -> Finished Goods Ledger / Balance
```

不得创建第二套 Operation Run、Run Report、Quality、WIP、Production Report、Completion 或 Inventory 权威。返工加工次数不增加 Work Order 净产品数量，不读取 Inventory Balance、不再次领料、不改变 Material Requirement/Reservation 或 MAIN Inventory。

## 已确认业务规则

1. 只允许状态为 ACCEPTED、提交 digest 与固化快照一致、ACTIVE NCR Allocation 有效且仍有未派余额的 Rework Request 执行；其他状态、跨工单、错误目标和超量一律拒绝。
2. 扩展既有 `production_operation_runs` 区分 `NORMAL/REWORK`。REWORK Run 稳定关联 Request、NCR、原 Inspection、原 Run Report、目标 Snapshot Operation、Work Order、operator 与 dispatched quantity；分批派工使用稳定 Allocation。
3. 复用 TASK02 READY→IN_PROGRESS、追加式 Report、数量守恒、幂等/CAS/审计/故障回滚。REWORK processed 是重复加工次数，不是 Work Order 新产量。
4. 原 failed 历史不改写。REWORK good 是新来源事实；目标为 IPQC 时必须显式建立新的 Run Report Inspection，只有 CLOSED+RELEASED 才形成下游额度。原检与复检释放额度分别核算。
5. WIP/Execution 查询明确返回 accepted、waiting dispatch、dispatched、in progress、reported good/scrap、pending reinspection、released、completed、unresolved，且 accepted 数量守恒、不重复计算原 failed 与 rework good。
6. 请求内容和提交版本保持不可变；独立 Execution Projection 投影 `ACCEPTED/IN_PROGRESS/WAITING_REINSPECTION/COMPLETED/COMPLETED_WITH_SCRAP`。主验收 2/2 放行后 Execution=COMPLETED、NCR=RESOLVED、unresolved=0，原 failed=2 保持。
7. 未开工 REWORK Run 可取消并恢复可派数量；已报工只能追加式全额冲销。已有复检、下游 Run Input Allocation、Final Output Allocation、Production Report 等引用时拒绝冲销；无法证明安全一律 fail closed。
8. production 派工/开工/报工/受控冲销；quality 创建复检/记录结果和缺陷；manager/admin 管理；engineering 只读 Snapshot；其他角色不得写。全部写操作执行 Session/must-change、CSRF、正文上限、限速、持久幂等、CAS、固定锁序、request_id、中文安全错误、单事务 Audit 与故障整体回滚。

## 数据库、版本、API 与页面

- 版本：`0.1.0-alpha.29` → `0.1.0-alpha.30`。
- 唯一新增：`drizzle-postgres/0030_production_rework_execution.sql`；不修改 `0001`—`0029`。
- 关系至少覆盖 Run 类型/返工来源、Rework Run Allocation、Execution Projection/Event 和必要守恒/直接 SQL guard；使用稳定外键、`numeric(24,6)`、唯一/队列索引、不可变事实和 deferred reconciliation。
- 同步 `db/schema.ts`、Drizzle journal、`0030_snapshot.json`、package/lock 版本和 migration checksum 文档。
- API：ACCEPTED 可派查询、显式 dispatch、REWORK Run/Execution/NCR 查询、Quality 待复检来源；start/report/cancel/reverse 复用既有端点。
- 页面：更新 `/production/rework-requests`、`/production/dispatch`、`/production/operations`、`/production/wip`、`/quality/production`、`/quality/nonconformances`，明确 NORMAL/REWORK 和净产品数量边界。
- Dashboard：按权限增加 ACCEPTED 待派返工、返工在制、返工待复检、返工复检未通过、已完成返工数量；只读且不自动派工或检验。

## 验收清单

- [ ] `0030`、Schema、journal、snapshot、完整 SHA-256、版本升级
- [ ] TASK06 unit、UI contract、PostgreSQL/API、Migration、Compose acceptance
- [ ] 状态、来源、目标、active operator、数量、并发、幂等、CAS、职责、403、故障、取消/冲销和直接 SQL guard
- [ ] Phase 4 TASK07/TASK08、Phase 5 TASK01—TASK05 与 Production/Routing/Quality/Nonconformance/Inventory/Dashboard/Identity 回归
- [ ] 实际 HTTP 原检 10/8/2/8、返工 2/2/0、复检 2/2/0/2、AOI 8/2、成品 Ledger +8/+2、Balance 10、Work Order COMPLETED
- [ ] 未复检不能派满 AOI，复检后才可派剩余 2；已有复检冲销拒绝、超量拒绝、越权 403
- [ ] 正式 typecheck、Schema consistency、lint、build、credentials、`git diff --check` 与 Python 三项只读/临时基线
- [ ] 修改主库前专用停服备份及 SHA/`pg_restore --list`
- [ ] Compose 整体串行重启与完整事实持久
- [ ] 接受态停服备份、固定第二新空 PostgreSQL 恢复和完整 8+2 闭环核对
- [ ] 最终主库干净 0030、唯一启用管理员、业务/Audit/Idempotency/临时账号/文件 0，仅原三容器四卷
- [ ] 功能提交、完成报告与独立 ops 验收提交

## 低资源与排除边界

固定 `COMPOSE_PARALLEL_LIMIT=1`；build、Migration、测试、typecheck、备份恢复和 Compose 重启全部串行；一次最多一个临时容器/测试库；宿主 Node heap 1024 MiB，Web/Worker heap 384 MiB。每项重任务前后记录资源、RestartCount/OOMKilled，磁盘低于 12 GiB 不启动新镜像构建，触发其他停止条件立即停止。只清理 TASK06 明确创建的资源，保留原四卷和 resource-guard 备份。

不自动创建 Rework Run 或复检，不执行返工补料、SCRAP Inventory、自动补产、批次/序列/追溯、设备/OEE、外协、产能、工时/成本、FQC/Shipment/AR/财务、历史迁移、Python 服务操作、HTTPS/防火墙、生产部署/切流、push/PR 或 TASK07。完成后立即停止。
