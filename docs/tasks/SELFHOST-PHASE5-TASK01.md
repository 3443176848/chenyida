# SELFHOST-PHASE5-TASK01 — 工艺路线、工作中心与工单工艺快照

## 状态与授权

- 状态：`DOING`
- 日期：2026-07-26（Asia/Shanghai）
- 授权：项目负责人已明确选择继续细化生产，本轮仅执行本任务。
- 合法起点：`main` / `7485bb93dc4dad16fa5cfe54651bb8f82306a7d2`；工作区 clean，`origin/main...HEAD` behind 0/ahead 38。
- 依赖：`SELFHOST-PHASE4-TASK06`、`SELFHOST-PHASE4-TASK07`、既有 Production、Master Data、BOM、Identity、Inventory 与 Dashboard 权威模块。
- 结论门槛：功能、0025、隔离测试、实际 HTTP、Compose 重启、停服备份/新空恢复及最终清理全部通过后，才能写入 `PRODUCTION ROUTING AND WORK ORDER SNAPSHOT ACCEPTED IN PARALLEL ENVIRONMENT`。

## 唯一业务链

```text
ACTIVE Work Center
  -> Product / Product Version Routing Header + Draft Version
  -> engineering 编辑并提交
  -> manager/admin 异人审核发布
  -> Work Order 显式 RELEASE
  -> 既有 BOM Snapshot / Requirement / Reservation
  -> 不可变 Routing Snapshot / ordered Snapshot Operations
```

Routing 是未来结构化工序权威；既有 BOM Line 与 Production Report 的 `process_stage` 继续仅作历史兼容，不自动转换、不回填、不删除。本任务不执行工序派工、开工、完工、报工、WIP 转移、库存过账、设备联网、班次、产能日历、维护或 OEE。

## 已确认业务规则

1. Work Center code 服务端 NFKC/trim/uppercase，创建后不可修改且唯一；启停使用 CAS、持久幂等和事务审计。已进入 Released Routing 或 Work Order Snapshot 的工作中心不得删除，停用不改历史。
2. Routing Header 稳定绑定 Product；Routing Version 稳定绑定同一 Product 的 Product Version；Operation 稳定引用 Work Center。
3. 状态机固定 `DRAFT -> SUBMITTED -> RELEASED`，退回固定 `SUBMITTED -> DRAFT`。只有 DRAFT 可编辑；RELEASED Version/Operation 不得修改或删除。
4. engineering 创建、编辑、提交；manager/admin 发布或退回；创建人和最后修改人不得最终发布。
5. 发布时服务端锁定并复核 ACTIVE Product、RELEASED Product Version、至少一条工序、正整数且唯一 sequence、必填 code/name、ACTIVE Work Center、非负六位 numeric 标准时间，并重新计算 canonical SHA-256 digest。
6. 每个 Product Version 同时最多一个当前 RELEASED Routing Version；新版本发布后旧版本保留为 SUPERSEDED。
7. Work Order RELEASE 在 TASK06 既有单一事务中复核当前 RELEASED Routing 与 digest，并复制唯一不可变 Routing Snapshot 及有序 Operations；任何失败使 BOM Snapshot、Requirement、Reservation、Routing Snapshot、Work Order Event、Audit 和 Idempotency 一起回滚。
8. 迁移前 RELEASED/COMPLETED 历史工单不猜测路线、不从自由文本回填，只读显示 `LEGACY_UNSTRUCTURED`。
9. 服务端不接受浏览器提交 digest、状态、版本号、操作者或审计字段；所有新写接口使用 Session/must-change、CSRF、正文上限、持久幂等、CAS、稳定中文错误、request_id 和事务 Audit。

## 数据库、版本与页面

- 版本：`0.1.0-alpha.24` → `0.1.0-alpha.25`
- 唯一新增：`drizzle-postgres/0025_production_routings.sql`
- 关系：Work Center、Routing Header/Version/Operation/Event、Work Order Routing Snapshot/Operation。
- 同步：`db/schema.ts`、journal、`0025_snapshot.json`；不修改 `0001`—`0024`。
- 页面：`/operations/work-centers`、`/engineering/routings`、`/production/dispatch`。
- Dashboard：待审核 Routing、缺少 Released Routing 的 Product Version、已释放待首工序工单、Legacy Unstructured Work Order；按权限裁剪。

## 验收清单

- [ ] 0025、Schema、journal、snapshot、SHA-256
- [ ] Work Center 与 Routing Service/API、权限、职责分离、并发、幂等、CAS、回滚
- [ ] Work Order 释放原子 Routing Snapshot 与历史兼容
- [ ] 三条原生页面与 Dashboard 指标
- [ ] unit/UI/PostgreSQL/migration、Phase 4 TASK01—TASK10 与关联全回归
- [ ] 实际 HTTP v1/v2、v1 工单快照不变、新工单使用 v2
- [ ] Compose 整体重启、停服备份/新空恢复、最终清理
- [ ] 功能与验收两个独立提交

## 明确排除

工序派工、开工、完工、工序报工、WIP、返工、批次、设备、外协、成本、库存过账、真实数据迁移、HTTPS、80/443、切流、生产部署、push 和 PR 均不属于本任务。完成后停止。
