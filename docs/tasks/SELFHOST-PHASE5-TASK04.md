# SELFHOST-PHASE5-TASK04 — 工序质量门禁、IPQC 稳定来源与受控放行

## 状态与授权

- 状态：`DOING`
- 日期：2026-07-27（Asia/Shanghai）
- 授权：项目负责人明确授权仅执行 TASK04，包括代码、`0028`、隔离测试、回环并行 HTTP 验收、Compose 串行重启、停服备份恢复、最终清理、文档和独立 Git 提交。
- 合法起点：`main` / `f6e5ff2e8344e79a35f56311b02b514613484f59`，工作区 clean，`origin/main...HEAD` behind 0/ahead 47。
- 依赖：`SELFHOST-PHASE5-TASK03`、`SELFHOST-PHASE5-TASK02`、`SELFHOST-PHASE5-TASK01`、`SELFHOST-PHASE4-TASK08`，以及既有 Quality、Production、Inventory、Identity、Dashboard 与备份恢复权威模块。
- 结论门槛：功能、Migration、专项与适用全回归、实际 HTTP 4/6、Compose 重启持久、停服备份/第二新空库恢复和最终清理全部通过后，才能标记完成。

## 唯一业务链

```text
Released Routing Operation
  -> Work Order Routing Snapshot Operation 固化 quality_gate_mode
  -> Operation Run Report good
  -> IPQC Quality Hold
  -> quality 显式创建稳定来源 Inspection
  -> Result / Defect / Disposition / Close
  -> CLOSED + RELEASED 形成可消费额度
  -> 下一 Snapshot Operation Run Input Allocation 精确消费
  -> 末工序继续复用 TASK03 Final Output / Report / Completion / Inventory
```

本任务复用既有 Quality Inspection/Result/Defect/Event、Production Operation/WIP、TASK03 Production Report/Completion 和 Inventory Ledger/Balance，不创建第二套权威。

## 已确认业务规则

1. Routing Operation 的 `quality_gate_mode` 固定为 `NONE` 或 `IPQC`；只允许 engineering 在 DRAFT 编辑，进入 canonical digest，发布后不可变，并在 Work Order RELEASE 时固化到 Snapshot Operation。历史默认 `NONE`。
2. Operation Run Report 不自动创建 IPQC。IPQC 工序的 good 在品质放行前全部进入 Quality Hold，不得供下一工序或末工序正式报工消费；NONE 保持 TASK02/TASK03 直通语义。
3. 新 IPQC 稳定引用 `production_operation_run_report_id`，服务端确定 Work Order、Snapshot Operation、Work Center、Material、Unit 和来源数量；保留既有 `production_report_id` IPQC 兼容且两类来源互斥。
4. 同一 Run Report 累计 inspected 不得超过 good；`passed + failed = inspected`。只有 `CLOSED/RELEASED` 的 released quantity 形成额度，且累计不得超过 passed 与来源 good；其他状态均不释放。
5. 下游 Run Input Allocation 和 TASK03 Final Output Allocation 必须消费质量调整后的额度。已消费后禁止 reopen、降低放行或改变处置；无消费时按既有职责分离安全 reopen，并把释放额度归零。
6. Run Report 已存在任何 IPQC 后禁止来源 Run 冲销。Inspection、Result、Defect、Event、Allocation 与质量来源事实不原地改写或删除；并发 close/reopen/消费只能一个成功。
7. engineering 配置门禁；production 执行并只读质量状态；quality 显式创建 IPQC、记录结果和缺陷；最终处置/关闭继续遵守现有职责分离；其他角色越权写 403。
8. 所有写接口继续执行 Session/must-change、CSRF、正文上限、速率限制、持久幂等、CAS、固定锁顺序、request_id、中文安全错误、同事务 Audit 和故障整体回滚。

## 数据库、版本、API 与页面

- 版本：`0.1.0-alpha.27` → `0.1.0-alpha.28`。
- 唯一新增：`drizzle-postgres/0028_production_operation_quality_gates.sql`；不修改 `0001`—`0027`。
- `0028` 完整 SHA-256：`a7a55f7c6c81b1c5a80df59a1b3f639187cc2c2ce8658087ceb392b1f2ada912`。
- 历史迁移工具继续只把固定且逐项校验 checksum 的 `0001`—`0017` 作为迁移目标基线；目录允许存在后续已版本化 migration，不把 `0018`—`0028` 错纳入该历史导入 manifest。
- 同步 `db/schema.ts`、Drizzle journal、`0028_snapshot.json`、package 版本和 migration checksum 文档。
- 扩展 Routing Operation/Snapshot Operation、Quality Inspection 稳定 Run Report 来源及必要关系、索引、CHECK、不可变 guard 与 deferred reconciliation。
- 扩展现有 Routing、Production Operation/WIP、Quality API 和 Dashboard；更新 `/engineering/routings`、`/production/dispatch`、`/production/operations`、`/production/wip`、`/quality/production`。

## 验收清单

- [x] 0028、Schema、journal、snapshot、完整 SHA-256、版本升级
- [ ] TASK04 unit/UI/PostgreSQL/API/migration（已通过）/Compose acceptance（待实际环境）
- [ ] NONE 直通与 IPQC Hold→显式检验→受控 Release→精确消费
- [ ] 4/6 Run Report、IPQC、AOI、Final Output、Report、Completion、Ledger/Balance 实际 HTTP 链
- [ ] 权限、职责分离、幂等、CAS、并发、超量、直接 SQL、故障回滚、reopen/冲销门禁
- [x] Phase 4 TASK07/TASK08、Phase 5 TASK01/TASK02/TASK03 与相关 Node/PostgreSQL 全回归
- [ ] 正式 typecheck、Schema consistency、lint、build、credentials、`git diff --check`（已通过）、Python 三项基线（待执行）
- [ ] 主库修改前停服备份、Compose 重启持久、接受态停服备份、第二新空库恢复
- [ ] 最终主库干净 0028、唯一启用管理员、业务/Audit/Idempotency/临时账号/文件 0，仅保留原三容器四卷
- [ ] 功能提交与独立 ops 验收提交

## 低资源与排除边界

固定 `COMPOSE_PARALLEL_LIMIT=1`，所有重任务串行，宿主 Node heap 1024 MiB，Web/Worker heap 384 MiB；每项重任务前后记录资源与容器状态，触发阈值立即停止。保留四个持久卷和 resource-guard 备份。

不自动创建 IPQC/FQC，不执行 FQC、Shipment、AR/财务、返工/返修、failed/scrap 库存过账、批次/序列/追溯、设备/OEE、外协、产能、成本、真实数据迁移、Python 服务操作、HTTPS/防火墙、生产部署/切流、push/PR 或 TASK05。完成后立即停止。
