# SELFHOST-PHASE5-TASK05 — IPQC 不合格处置与返工申请交接

## 状态与授权

- 状态：`DONE / PARALLEL ACCEPTED`
- 日期：2026-07-27（Asia/Shanghai）
- 授权：项目负责人明确授权仅执行 TASK05，包括代码、`0029`、隔离测试、回环并行 HTTP 验收、Compose 串行重启、停服备份恢复、最终清理、文档和独立 Git 提交。
- 合法起点：`main` / `736f14b9510ca52ce39fea7154872dffe7818986`；工作区 clean，`origin/main...HEAD` behind 0/ahead 50。
- 依赖：`SELFHOST-PHASE5-TASK04`、`SELFHOST-PHASE5-TASK03`、`SELFHOST-PHASE5-TASK02`、`SELFHOST-PHASE5-TASK01`，以及既有 Quality、Production Operation、Routing、Inventory、Identity、Dashboard 与备份恢复权威模块。
- 结论门槛：功能、Migration、专项与适用全回归、实际 HTTP passed 8 / failed 2 / v1 RETURNED / v2 ACCEPTED、Compose 重启持久、停服备份/第二新空库恢复和最终清理全部通过后，才能标记完成。

## 唯一业务链

```text
Operation Run Report good
  -> 显式 IPQC inspected 10 / passed 8 / failed 2
  -> passed 8 按 TASK04 放行并进入 AOI
  -> failed 2 保持 Quality Hold 并形成唯一稳定 NCR
  -> quality 创建并提交 Rework Request v1
  -> production 退回 v1
  -> quality 创建不可变修订 v2 并重新提交
  -> production 接收 v2
  -> ACCEPTED Rework Request 等待 TASK06 执行
```

本任务复用既有 Quality Inspection/Result/Defect/Event、Production Operation/WIP 与 Routing Snapshot Operation，不创建第二套品质、工序、WIP 或库存权威。ACCEPTED 只表示生产接收返工申请，不创建 Rework Run、派工、领料、报工、库存或完工事实。

## 已确认业务规则

1. NCR 只能由 failed quantity 大于零、包含 FAIL Result 与有效 Defect、且来源为同一工单 IPQC Snapshot Operation 的结构化 Operation Run Report Inspection 建立；每个 Inspection 只有一个稳定 NCR，编号由服务端生成。
2. NCR 的 Material、Unit、Work Order、Snapshot Operation、Work Center、Run Report 与 failed quantity 全部由服务端继承，浏览器不得提交可信来源字段或累计投影。
3. 每个 NCR 满足 `failed_qty = active rework allocation + final scrap allocation + unresolved_qty`；所有数量为 PostgreSQL numeric，任何路径都不得超量、重复占用或产生负 unresolved。
4. RETURNED/CANCELLED 返工申请释放占用；SUBMITTED/ACCEPTED 持续占用；ACCEPTED 等待后续执行。SCRAP 是不可变最终处置，不写 Inventory Ledger/Balance、不补产、不写财务。
5. passed 与 failed 严格分离：passed 8 可按 TASK04 进入 AOI；failed 2 始终保持 Quality Hold/Rework Queue。创建或接收返工申请不增加 AOI available，不创建新的 Run Report。
6. 返工目标只能选择同一 Work Order Routing Snapshot 中 sequence 不晚于来源的稳定 Snapshot Operation；允许原工序或更早工序，禁止 Routing Version Operation、自由文本工序和跨工单目标。
7. Rework Request 状态固定 `DRAFT/SUBMITTED/ACCEPTED/RETURNED/CANCELLED`。DRAFT 可用 CAS 修改；submit 锁定来源与数量并生成 canonical digest；SUBMITTED 后内容不可修改；production 只能 ACCEPT/RETURN，RETURN 原因必填，创建人不得接收自己的申请。
8. RETURNED 不原地修改提交快照；重提必须创建新修订/请求并保留历史。ACCEPTED 后不得取消、修改或减少数量。
9. NCR 状态是服务端受控投影：`OPEN/REWORK_PENDING/REWORK_ACCEPTED/DISPOSED/CANCELLED`。事实、提交快照、Allocation、Disposition 和 Event 不可变或只按状态机追加。
10. 已有 NCR 时 Inspection 不得无约束 reopen；存在 SUBMITTED/ACCEPTED 或 SCRAP 时禁止 reopen、降低 failed 或改变来源；来源 Run 已有 Inspection/NCR 时继续禁止冲销。无有效处置且无下游时才允许安全 reopen 并保留 NCR 取消事件。
11. quality 查看 NCR、创建/编辑/提交返工申请；production 查看并接收/退回；manager/admin 管理及 SCRAP；engineering 只读 Snapshot 上下文；其他角色不得写，实际验证 403。
12. 所有写操作执行 Session/must-change、CSRF、正文上限、速率限制、持久 Idempotency-Key、CAS/version、固定锁顺序、request_id、中文安全错误、单事务 Audit 和故障整体回滚。

## 数据库、版本、API 与页面

- 版本：`0.1.0-alpha.28` → `0.1.0-alpha.29`。
- 唯一新增：`drizzle-postgres/0029_production_nonconformance_rework_handoff.sql`；不修改 `0001`—`0028`。
- 数据模型至少覆盖 NCR Header/Event、Rework Request/不可变提交版本/Event、数量 Allocation 与 Scrap Disposition，并提供稳定外键、numeric、唯一/状态约束、队列索引、不可变 guard、deferred 守恒和直接 SQL 防伪。
- 同步 `db/schema.ts`、Drizzle journal、`0029_snapshot.json`、package/lock 版本和 migration checksum 文档。
- 扩展现有 Quality 与 Production 边界，提供 NCR 队列/详情、Inspection→NCR、Rework DRAFT/submit/accept/return、SCRAP、数量状态及 Work Order/Snapshot Operation 上下文 API。
- 原生页面：`/quality/nonconformances`、`/quality/rework-requests`、`/production/rework-requests`。
- Dashboard 按权限增加待处置 NCR、未分配不合格数量、待生产接收返工申请、已接收待执行返工数量、最终工序报废数量；只读且不自动处置。

## 验收清单

- [x] `0029`、Schema、journal、snapshot、完整 SHA-256、版本升级
- [x] TASK05 unit、UI contract、PostgreSQL/API、Migration、Compose acceptance
- [x] failed=0、证据缺失、超量、重复返工/SCRAP、RETURN/CANCEL 释放、ACCEPT 不可变、目标工序和跨工单门禁
- [x] 权限、职责分离、幂等、CAS、并发唯一结果、故障零半记录和直接 SQL guard
- [x] TASK04 IPQC Gate、TASK02/TASK03 WIP/Final Output/冲销与 Phase 4 TASK07/TASK08 回归
- [x] 实际 HTTP inspected 10 / passed 8 / failed 2 / AOI available 8 / Quality Hold 2
- [x] Rework Request v1 退回、不可变 v2 重提并接收；accepted rework 2、unresolved 0
- [x] Rework Run、额外 Run Report、Production Report、Completion、Finished Goods、FQC/Shipment/AR/Settlement 全为 0
- [x] Inspection reopen、来源 Run 冲销、ACCEPTED Request 修改/取消均拒绝，越权角色 403
- [x] 正式 typecheck、Schema consistency、lint、build、credentials、`git diff --check` 和 Python 三项基线
- [x] 修改主库前 TASK05 专用停服备份及 SHA/`pg_restore --list`
- [x] Compose 整体串行重启、事实与 Audit 持久
- [x] 接受态停服备份、固定第二新空 PostgreSQL 恢复、29 migrations 与完整 NCR→v1/v2 链核对
- [x] 最终主库干净 0029、唯一启用管理员、业务/Audit/Idempotency/临时账号/文件 0，仅保留原三容器四卷
- [x] 功能提交、完成报告与独立 ops 验收提交

## 低资源与排除边界

固定 `COMPOSE_PARALLEL_LIMIT=1`，所有 build、Migration、测试、备份恢复和 Compose 重启串行；宿主 Node heap 1024 MiB，Web/Worker heap 384 MiB。每项重任务前后记录资源、RestartCount/OOMKilled，触发阈值立即停止。保留四个持久卷和 resource-guard 备份。

不执行实际 Rework Run、返工派工/开工/报工/再检、自动创建 NCR/IPQC/返工申请、SCRAP 库存过账、自动补产/补料、批次/序列/追溯、设备/OEE、外协、产能、成本、FQC/Shipment/AR/财务动作、历史迁移、Python 服务操作、HTTPS/防火墙、生产部署/切流、push/PR 或 TASK06。完成后立即停止。
