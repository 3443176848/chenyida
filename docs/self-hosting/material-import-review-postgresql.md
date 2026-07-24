# PostgreSQL Material Import 人工复核设计

日期：2026-07-24（Asia/Shanghai）

## 目标与边界

自托管完整链路为：

`Upload -> Parser raw -> immutable Mapping -> published Normalization -> Review -> EXCLUDE / BIND_EXISTING / CREATE_DRAFT -> existing Material submit/review -> ACTIVE + formal code`

Parser raw、Mapping snapshot 和已发布 Normalization candidates/attributes/lineage/issues 都是只读证据。人工行为只写 Review 关系表。Review 不创建或修改 ACTIVE，不自动创建 Draft，不提交审核，不批准，不生成正式编码。

## 三层值模型

| 层 | 权威来源 | 可修改性 |
| --- | --- | --- |
| 原始值 | `material_import_rows.raw_values` | 不可变 |
| 机器候选 | TASK03 candidate/attribute/lineage/issue 表 | 发布后不可变 |
| 人工最终值 | 最新有效 field/attribute override 叠加 candidate | 仅编辑态 Review 可追加修订 |

最终值顺序是 `SET/CLEAR override -> candidate`。`REVERT` 表示撤销覆盖并恢复 candidate；任何情况下都不回退到未经过 Mapping 的 raw value。JSON 摘要使用递归键排序后的 canonical JSON，避免对象键顺序改变 digest。

## PostgreSQL 数据模型

`0005_material_import_review.sql` 增加 11 张表：

1. `material_import_review_sessions`：固定 run/mapping version/digest、版本关系、状态、统计和 CAS。
2. `material_import_review_rows`：固定 normalized/source row，保存决定、绑定选择、Draft 结果、失败和 CAS。
3. `material_import_review_field_overrides`：核心字段 SET/CLEAR/REVERT 的 revision/supersedes 历史。
4. `material_import_review_attribute_overrides`：稳定 attribute code、定义快照、类型、单位、revision 历史。
5. `material_import_review_issue_resolutions`：原 normalization issue 的人工处理记录。
6. `material_import_review_validation_issues`：复核/最终处理层重新验证问题，与原 issue 分离并按 key+generation 去重。
7. `material_import_review_finalizations`：一次最终提交的状态、Job、sealed digest、统计和失败。
8. `material_import_review_finalization_rows`：不可变行级 payload/digest/operation key 与处理结果。
9. `material_import_review_material_bindings`：唯一 ACTIVE binding、显示快照、操作者和 request id。
10. `material_import_review_draft_links`：唯一 review row -> Material Draft 关系。
11. `material_import_review_history`：会话/行操作的安全审计历史。

FK 对已发布 run/row、source row、mapping、material 和 user 使用 `ON DELETE restrict`；关键 JSONB 有 object/type/大小检查。42 个 review 前缀索引覆盖版本、活动会话、分页筛选、问题、队列、唯一 operation/binding/draft link 和历史。

## 复核会话状态机

合法状态：

- `DRAFT -> IN_REVIEW`
- `DRAFT|IN_REVIEW|READY_TO_FINALIZE -> FINALIZING`
- `FINALIZING -> FINALIZED|FINALIZE_FAILED`
- `FINALIZE_FAILED -> FINALIZING`（只重试同一 sealed snapshot 的安全失败）
- `DRAFT|IN_REVIEW|READY_TO_FINALIZE|FINALIZE_FAILED -> CANCELLED`

`FINALIZED` 和 `CANCELLED` 为终态。当前 API 的验证端点是只读预检；`READY_TO_FINALIZE` 作为显式工作流扩展状态保留，当前最终提交可从三个编辑态直接以 CAS 进入 FINALIZING。终态修正通过新 review version 与 `supersedes_review_session_id` 完成，不原地重开。

只有 `published_at` 非空、result digest 完整且状态为 SUCCEEDED/SUPERSEDED 的 Normalization run 能创建 Session。数据库 insert trigger 再核对 run version/result digest、mapping id/digest，防止 Service 漏检。

## 行决定

- `PENDING`：未完成。
- `KEEP`：人工确认保留，但尚未选择最终动作；会阻止 finalization。
- `EXCLUDE`：要求 reason code 和 comment，不创建 Draft、不绑定。
- `BIND_EXISTING`：要求人工精确选择 material ID；与 Draft 互斥。
- `CREATE_DRAFT`：表示人工明确选择在最终处理时调用 Material Service 建 DRAFT。

已 Finalizing/Finalized 的决定由数据库 trigger 锁定。Session 和 Row 都有 `expected_version`；每次写同时 CAS 两层，旧页面得到 409。

## 字段和属性覆盖

核心字段只接受服务端白名单 code。TEXT/INTEGER/BOOLEAN/DATE/ENUM/DECIMAL 在服务端重验类型、长度、必填和枚举；文本/JSON 有大小上限。每次改变追加 revision，记录原 candidate、override、reason、comment、actor 和 supersedes。

动态属性长期契约只使用 `attribute_code`。写入时重新查询当前 PostgreSQL metadata，核对属性存在、ACTIVE、类型、分类绑定、枚举和单位。Snapshot 仅用于历史展示；最终建稿仍由 Material Service 重新验证当前分类与属性。

`CLEAR` 与“没有覆盖”不同；必填核心字段/必填属性不能清空。`REVERT` 不删除历史，而是追加一条撤销修订。

## Issue 人工处理

原 `material_import_normalization_issues` 永不修改。

- WARNING 可写 `WARNING_ACKNOWLEDGED`，必须记录 comment/actor/time。
- ERROR 行可以 EXCLUDE；若选择保留动作，只能在其 target 对应最新 SET override 存在时写 `RESOLVED_BY_OVERRIDE`。
- Worker 发现 ACTIVE 状态漂移、Material Service 校验或其他行级最终处理错误时，在 `material_import_review_validation_issues` 写稳定 key 的 ERROR；同一问题安全重试执行 upsert，不重复堆积。
- 行成功后将该行活动 validation issue 关闭并记录 resolved time。

## ACTIVE 物料绑定

搜索 API 强制 keyword、page 和 page_size，page_size 最大 50，只返回 ACTIVE 的安全显示字段。结果不是推荐，也不自动决定。

选择时 Service 按真实 material ID 查询并确认 ACTIVE；finalization Worker 在与 binding 写入同一事务里再次 `FOR SHARE` 查询。状态漂移产生 409 语义的行级失败和复核 validation issue。Binding 保存安全快照，但业务引用为 material ID；它不更新 material master。唯一索引保证同一 review row 和 finalization row 只能有一个 binding。

当前自托管 schema 是单组织作用域，尚无 tenant/organization 列；权限边界沿用当前数据库与 Material read 权限，不声称实现不存在的多租户隔离。

## Material Draft 创建与幂等

Worker 通过 `MaterialWorkflowService.createDraftWithClient` 调用 TASK01 应用层。该入口复用完整基础字段、分类、动态属性、版本、change log、audit 和 DRAFT 状态约束，并允许 Review 在同一 PostgreSQL client/transaction 中原子保存 Draft link。

操作键为 review session/row/final payload digest 的确定性 SHA-256。Material `source_ref` 固定为 `material-import-review:<session>:<row>`。Draft link、operation key 和 Material idempotency 均唯一；重试先返回现有 link，不会产生第二个 Draft。

创建结果必须是 `DRAFT`、`internal_material_code IS NULL`，且不会 submit/approve。正式编码仍只由 TASK01 approve 事务产生。

## Finalization Worker 与失败恢复

1. Web 请求锁 Session + expected_version，执行有界结构预检。
2. 同事务创建 finalization、Outbox 和 FINALIZING 状态。
3. Worker 每次准备最多 100 行，生成不可变 payload/digest/operation key。
4. 全部准备完成后计算 sealed snapshot digest。
5. Worker 每次选择最多 50 行逐行事务处理。
6. 每个 material side effect、binding/draft link、review row 结果都在同一事务中。
7. 每个事务检查 background job status、lease token、expiry、session job id 和 FINALIZING 状态。
8. 失去租约的旧 Worker 得到 `IMPORT_REVIEW_LEASE_LOST`，不能写入。
9. 全部成功才标 FINALIZED；存在失败则 FINALIZE_FAILED，成功过的行和已创建 Draft 被真实保留。
10. Retry 只把失败行恢复为 PENDING 并换新 Job；确定性 key/link 防止重复副作用。

该语义不是“全批次全局原子”。它是行级原子、全批可恢复且状态如实反映部分完成。业务数据已变化导致的失败应创建新 review version；同 snapshot retry 只用于安全或暂时性失败。

## API 契约

基础路径：`/api/material-master/import-batches/:batchId/reviews`

- `POST /` 创建 Session
- `GET /current` 当前版本
- `GET /history` 历史版本
- `GET /:sessionId/statistics`
- `GET /:sessionId/rows`
- `GET /:sessionId/rows/:rowId`
- `POST /:sessionId/rows/:rowId/field-overrides`
- `POST /:sessionId/rows/:rowId/attribute-overrides`
- `POST /:sessionId/rows/:rowId/decision`
- `POST /:sessionId/rows/:rowId/issues/:issueId/resolution`
- `POST /:sessionId/bulk-decision`
- `GET /:sessionId/validate`
- `POST /:sessionId/finalize`
- `GET /:sessionId/finalization`
- `POST /:sessionId/finalization/retry`
- `GET /active-materials`

写请求要求 Session、权限、Origin/CSRF、Idempotency-Key 和 expected version。错误区分 400/401/403/404/409/422/500，并只返回稳定 code、中文安全消息和 request id。

## 权限矩阵

| 能力 | 权限 |
| --- | --- |
| 查看行/统计 | `material.import.read` |
| 创建会话 | `material.import.review.create` |
| 历史 | `material.import.review.history` |
| 编辑字段/属性 | `material.import.review.edit` |
| 行决定 | `material.import.review.decide` |
| Issue 处理 | `material.import.review.issue` |
| 搜索 ACTIVE | `material.import.review.search_material` |
| 绑定 ACTIVE | `material.import.review.bind` |
| 选择/创建 Draft | `material.import.review.create_draft` |
| 批量决定 | `material.import.review.bulk` |
| 最终提交 | `material.import.review.finalize` |
| 重试失败 | `material.import.review.retry` |

admin/manager 具有完整能力；purchase/engineering 具有查看、创建、编辑、决定、Issue、搜索/绑定与建稿选择，但不具有 bulk/finalize/retry。所有校验都在服务端，页面隐藏不是授权。

## UI

保留 `/materials/imports/:batchId` 和七步流程。结果审阅步骤增加 `view=review`，继续支持 `view=normalized/issues`、`row=<normalizedRowId>` 和右侧 Drawer。

Review UI 显示版本/历史、三层值、字段/属性覆盖、CLEAR/REVERT、ERROR/WARNING、lineage、决定、ACTIVE 精确搜索、Draft 选择、批量保留/排除、统计、最终摘要、进度、失败和 retry。历史版本只读；409 明确提示刷新。没有创建 ACTIVE、自动匹配、自动审批、正式编码或绕过复核按钮。

## Docker Compose 隔离验收

1. 使用 `ERP_ENV=test`、名称含 test 的独立 PostgreSQL URL、独立 Compose project 和临时凭证。
2. 启动 postgres、migrate、web、worker，tools profile 初始化测试管理员。
3. 在 worker 镜像执行 `scripts/selfhost-compose-smoke.mjs`。
4. 记录 batch/run/review/draft/active IDs。
5. 完整 stop/up PostgreSQL、Web、Worker。
6. 执行 `selfhost-normalization-restart-smoke.mjs` 和 `selfhost-review-restart-smoke.mjs`。
7. `docker compose down -v --remove-orphans`，核对 project 容器、网络和卷为空。

脚本会在连接前拒绝非 test 环境。生产迁移、生产 URL、公网部署和真实文件不在本步骤授权范围。
