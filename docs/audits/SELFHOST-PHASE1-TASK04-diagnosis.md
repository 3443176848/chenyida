# SELFHOST-PHASE1-TASK04 诊断报告

日期：2026-07-24（Asia/Shanghai）

## 结论

TASK04 应在自托管 PostgreSQL 运行面新增独立 Material Import Review 模块，并继续复用 TASK01 Material Workflow Service、Phase 0 PostgreSQL Job/Outbox 与 TASK03 不可变已发布 Normalization 结果。旧 D1 实现提供了已验证的 Normalization 行、Issue、Drawer、分页和 `review_status` 展示语义，但并不存在完整的“复核会话、覆盖历史、ACTIVE 精确绑定、Material Draft 最终处理”服务；因此迁移策略是保留旧可验证契约，同时补齐 PostgreSQL 关系模型和安全边界，而不是把旧 JSON 行状态原样复制。

TASK03 报告中的分支与 HEAD 仍成立，但工作树包含 Phase 0、TASK01、TASK02、TASK03 的大量未提交变化。TASK04 全程在这些变化之上谨慎追加，没有 reset、checkout、clean 或覆盖用户内容。

## Git 与工作树基线

- Branch：`main`
- HEAD：`2c1003f2547b934424c03f216936c43b0f1efd40`
- 相对 `origin/main`：开始诊断时 ahead 23
- 工作树：dirty；包含自托管 Compose、PostgreSQL `0001`～`0004`、Material/Mapping/Normalization 模块、测试和文档
- TASK04 前 `0001`～`0004` SHA-256：
  - `0001`：`c1cd71803b0f504594a41234a82eb13ce8e6713f5d346f3e49247b4921ff1702`
  - `0002`：`2d8d4facf54c950fa19d1346705aa0f549669544da1a87c2fc584c1fe8b7eb80`
  - `0003`：`8ce859551198a8a5a334665f68eee503590fa5472f3a6396f44670d2110dddbf`
  - `0004`：`1bb0eb9b7b3ddbe6c6058a75a04a4bbc69a088e201856f258a4c75728f64aa39`

## 现有自托管基线

| 范围 | 诊断结果 | TASK04 选择 |
| --- | --- | --- |
| Material 状态机 | TASK01 固定 `DRAFT -> PENDING_REVIEW -> ACTIVE`，驳回回到 DRAFT；正式编码只在批准事务生成 | 复核只调用 Draft 创建入口，绝不提交、批准或分配编码 |
| Material Repository/Service | 已有 PostgreSQL Repository、Workflow Service、字段/属性重验证、版本/审计 | 增加受控同事务 `createDraftWithClient` 入口；Review Repository 不直接写物料表 |
| ACTIVE 查询 | `material_master` 是唯一物料权威，状态和可见性由服务端处理 | 只提供分页搜索与明确 ID 选择；Worker 最终处理时重新查 ACTIVE |
| Mapping | `0003` 已实现确认后不可变快照、版本、digest 和历史 | Session 固定保存 mapping id/digest；不修改历史 |
| Normalization | `0004` 已实现 run version、已发布 current、关系化 candidates/attributes/lineage/issues 和不可变 trigger | 只允许已发布 SUCCEEDED/SUPERSEDED run 建会话；保存 run version/result digest |
| Job/Outbox | PostgreSQL Outbox、background_jobs、`SKIP LOCKED`、lease token、heartbeat、retry、CAS | finalization 复用同一机制；每一行事务内重验 lease |
| API 安全 | 现有 Session actor、Origin/CSRF、Idempotency-Key、统一安全错误 | Review API 沿用并细分权限；同 key 异正文 409 |
| UI | `/materials/imports/:batchId`、七步流程、`view=normalized/issues`、`row=` Drawer 已存在 | 新增 `view=review`，保留 URL、七步流程和旧证据查看 |

## 旧 D1 复核功能迁移对照

| 旧能力或事实 | 旧位置 | PostgreSQL TASK04 |
| --- | --- | --- |
| Normalization run/current/latest/history | D1 normalization Repository/Service/API | 继续读取 TASK03 已发布 run；Session 固定 run/digest |
| normalized row `review_status` | D1 normalization row | 独立 `review_rows.row_status/disposition`，不覆盖 normalized row |
| 原始行、候选、Issue、lineage Drawer | Normalization Review UI | 原样保留并增加人工最终值/覆盖/决定 |
| ERROR/WARNING 展示与筛选 | 旧 Review API/UI | 原 issue 不可变；独立 resolution 与 review validation issue |
| 分页行/Issue 查询 | 旧 API | PostgreSQL keyset 分页，最大 100 |
| Approval/Draft 关联 | D1 Internal Material Library 的 approved normalization/draft link | 复核 Finalization 明确分为绑定 ACTIVE、创建 DRAFT、排除 |
| Draft 创建边界 | 旧 Draft Service | 复用 TASK01 PostgreSQL Material Workflow Service |
| 复核会话/版本 | 旧代码无完整稳定实现 | 新增不可覆盖的 Session 版本及 supersedes 关系 |
| 字段/属性覆盖历史 | 旧代码无完整关系模型 | 新增 revision/supersedes 覆盖层，支持 SET/CLEAR/REVERT |
| 批量最终处理/失败恢复 | 旧代码无完整闭环 | 新增不可变快照、Job、分块 Worker、行幂等和部分失败状态 |

## 旧契约差异

1. 用户提示中提到旧 `erp-api.ts` 复核 API；实际 Material Import API 位于 `app/lib/material-import/handler.ts` 及其子模块，`erp-api.ts` 只是更早的 legacy 聚合入口。
2. 旧 D1 没有可直接移植的完整 Review Session/override/finalization 状态机。TASK04 保留已经验证的 raw/candidate/issue/lineage/UI/分页/Draft Service 契约，并新增关系化闭环。
3. 旧系统没有安全的自动 ERROR 豁免。TASK04 只允许排除 ERROR 行，或在对应字段存在有效 SET 覆盖时记录 `RESOLVED_BY_OVERRIDE`；不会改写原 issue。
4. 当前自托管应用没有组织/租户字段。TASK04 的“当前组织可见”落在当前数据库作用域与现有 material 权限上，不虚构租户隔离。
5. `KEEP` 被保留为行级复核状态，但它不是最终物料动作；最终提交前必须转换成 EXCLUDE、BIND_EXISTING 或 CREATE_DRAFT。

## TASK04 范围

- PostgreSQL review session、row、覆盖历史、issue resolution、validation issue、finalization snapshot/row、binding、draft link、history
- 独立 Repository/Service/API/Worker
- TASK01 Material Draft Service 安全接入
- TASK03 Review UI 增量接通
- 权限、CSRF、幂等、CAS、审计、分页、Worker 租约和失败恢复
- 非生产迁移、单元/集成/API/UI/Compose 验收

明确不做：自动匹配、模糊查重、AI、自动分类/Mapping/字段修正、自动绑定、自动建稿、自动提交/批准/编码、ACTIVE 修改、BOM/采购/库存扩展、真实数据迁移、公网部署。

## TASK03 实际核对

TASK03 报告与代码基本一致：已发布结果由数据库 trigger 保护，Worker 使用 run-isolated staging 和发布事务，API 只读已发布结果，D1/Miniflare 不进入自托管依赖图。发现的剩余边界均属于 TASK04：没有人工覆盖历史、最终决定、ACTIVE 绑定、Draft Commit 或 finalization worker。
