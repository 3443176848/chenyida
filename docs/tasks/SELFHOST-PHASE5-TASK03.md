# SELFHOST-PHASE5-TASK03 — 末工序产出绑定、正式报工与成品入库

## 状态与授权

- 状态：`DOING`
- 日期：2026-07-27（Asia/Shanghai）
- 授权：项目负责人明确授权仅执行 TASK03，包括代码、`0027`、隔离测试、回环并行 HTTP 验收、Compose 串行重启、停服备份恢复、清理、文档和独立 Git 提交。
- 合法起点：`main` / `a6448ac42da737e31fee76085fb699e80f3c621b`，Parent `120e1524eaebd9d921cab6a036b3203bf7d39226`，工作区 clean，`origin/main...HEAD` behind 0/ahead 43。
- 依赖：`SELFHOST-PHASE5-TASK02`、`SELFHOST-PHASE5-TASK01`、`SELFHOST-PHASE4-TASK07`，以及既有 Production、Inventory、Identity、Dashboard 与备份恢复权威模块。
- 结论门槛：功能、Migration、专项与回归测试、实际 HTTP 4/6、重启持久、停服备份/第二新空库恢复和最终清理全部通过后，才能写入固定验收结论。

## 唯一业务链

```text
Work Order Routing Snapshot
  -> 末工序 Operation Run Report good
  -> 稳定 Final Output Allocation
  -> 既有 Work Order Production Report
  -> 既有 Report Receipt Projection
  -> warehouse 显式 Completion
  -> 既有 Report→Completion Allocation
  -> Finished Goods Inventory Ledger/Balance
  -> Work Order COMPLETED（不自动 CLOSED）
```

本任务不创建第二套 Production Report、Completion 或 Inventory 权威。结构化工单复用 TASK02 的 Snapshot Operation/Run/Run Report/WIP，并复用 TASK07 的 Production Report、Completion、Report→Completion Allocation 和 Inventory Service 事务入口。无 Routing Snapshot 的历史工单保持兼容。

## 已确认业务规则

1. 有 Routing Snapshot 的工单不得由浏览器自由输入 `process_stage`、`operator` 或 `reported/good/scrap`；服务端只接受稳定末工序 Run Report 来源分配。
2. 来源必须属于同一 Work Order 的最后 Snapshot Operation，Run/Run Report 有效且未取消、未冲销，good 为正；允许分批消费，但累计不得超过具体来源 good。
3. 结构化 Production Report 的 `reported_qty=good_qty=allocation quantity`、`scrap_qty=0`；工序来自末工序快照，operator 来自稳定执行事实或当前受控 actor。浏览器不得提交 final-output 投影。
4. 新增稳定 `production_report_operation_allocations`，至少保存 Production Report、Operation Run Report、Snapshot Operation、Operation、quantity、actor、request 与时间。Allocation 和原 Report 不可修改或删除。
5. 创建 Report 要求持久 Idempotency-Key、Work Order/final-output CAS、固定锁顺序、并发唯一消费、CSRF、权限、限速、正文上限、安全中文错误、request_id、事务 Audit 和故障零半记录。
6. 结构化 Report 创建后只减少实际 `final_output_available_qty` 和 Dashboard 待办；不写库存，不自动创建 Completion、IPQC 或 FQC。
7. legacy report/complete 快捷路径对结构化工单必须拒绝自由文本或自动 report+completion；历史无 Routing Snapshot 行为保持回归通过。
8. warehouse 继续显式消费既有 Report，按 4/6 在单事务写 Completion、Allocation、Finished Goods Ledger/Balance、Work Order 投影/Event/Audit/Idempotency。
9. 无 Completion/IPQC 下游时，Report 全额追加式冲销恢复末工序来源；已有 Completion 时拒绝。Completion 安全冲销后先恢复 Report 可用良品，随后 Report 冲销才能恢复末工序输出。
10. 末工序 Run/Run Report 被有效 Production Report 消费后禁止 Run 冲销；并发冲销只一个成功，无法证明安全一律 fail closed。
11. 分批 Report 4/6 后 reported/good=10；分批 Completion 4/6 后 completed=10；最终 planned/reported/good/scrap/completed=`10/10/10/0/10`，状态 `COMPLETED` 而非 `CLOSED`。
12. IPQC/FQC、Shipment、Sales Financial Source、AR、Settlement 全部保持 0。

## 数据库、版本、权限与页面

- 版本：`0.1.0-alpha.26` → `0.1.0-alpha.27`
- 唯一新增：`drizzle-postgres/0027_production_final_output_reporting.sql`
- 同步：`db/schema.ts`、Drizzle journal、`0027_snapshot.json`；不修改 `0001`—`0026`。
- 数据库保护：expand-only、PostgreSQL numeric、稳定外键/索引/唯一约束、不可变 trigger、延迟事务核对和直接 SQL guard；只在 `0027` 中 `CREATE OR REPLACE` 必要的 `0026` 投影核对函数。
- API：末工序可报工来源、结构化 Production Report 创建/详情/冲销、必要的 Work Order/WIP 查询扩展。
- 页面：`/production/reporting`、`/production/wip`、`/warehouse/production-completions`；结构化模式不显示可伪造字段，历史工单明确标记兼容模式。
- Dashboard：末工序待最终报工、已报工待成品入库、部分完成工单、已完成待品质处理，按权限裁剪且不自动建品质。
- 权限：production 读来源并创建结构化 Report；warehouse 创建/冲销 Completion；manager/admin 管理；quality 只读合法来源；其他角色写入实际验证 403。

## 验收清单

- [ ] `0027`、Schema、journal、snapshot、完整 SHA-256、版本升级
- [ ] TASK03 unit/UI/PostgreSQL/API/migration/Compose acceptance 测试
- [ ] 空库、0026→0027、重复执行、失败回滚、历史兼容、结构化 guard、checksum/schema consistency
- [ ] 幂等同正文/异正文、CAS、并发超量、跨工单/非末工序/冲销来源拒绝、直接 SQL guard、故障零半记录、403
- [ ] 实际四工序 4/6、Final Output Allocation 4/6、Report 4/6、Completion 4/6、Ledger +4/+6、Balance 10、Work Order COMPLETED
- [ ] Report 冲销恢复 final output、Completion 下游门禁、Run 冲销门禁
- [ ] Phase 4 TASK06/TASK07、Phase 5 TASK01/TASK02、Production/Routing/Inventory/Dashboard/Identity 回归
- [ ] 正式 typecheck、Schema consistency、lint、build、credentials、`git diff --check` 和 Python 三项基线
- [ ] 修改并行数据库前专用停服备份及 SHA/`pg_restore --list`
- [ ] Compose 整体串行重启与事实持久性
- [ ] 接受态停服备份、第二新空 PostgreSQL 恢复、27 migrations 与完整 4/6 链核对
- [ ] 最终主库干净 0027、唯一启用管理员、业务/Audit/Idempotency/验收账号/文件 0，仅保留原三容器四卷
- [ ] 功能提交、完成文档与独立验收提交

## 低资源与生产边界

固定 `COMPOSE_PARALLEL_LIMIT=1`，重任务串行，宿主 Node heap 1024 MiB，Web/Worker heap 384 MiB；每项重任务前后记录资源、Compose、RestartCount/OOMKilled，触发熔断立即停止。保留四个持久卷和既有 resource-guard 备份。

不授权 IPQC/FQC 创建或自动放行、Shipment/AR/收付款、返工/返修、批次/序列/追溯码、设备/OEE/停机、外协、产能排程、成本会计、真实 SQLite 数据读取/迁移、Python 服务操作、HTTPS/80/443/防火墙、生产部署/切流、push/PR 或 PHASE5-TASK04。完成 TASK03 后立即停止。
