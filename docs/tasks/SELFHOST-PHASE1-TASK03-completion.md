# SELFHOST-PHASE1-TASK03 完成报告

日期：2026-07-23（Asia/Shanghai）

结论：行级 Normalizer、核心/动态属性候选、lineage、稳定 issues、重试/重跑/取消、原子发布和现有 Review UI 已完成 PostgreSQL 自托管移植及隔离验收。未访问生产、未迁移真实数据、未部署、未提交、未推送、未创建 PR。

## 1. 修改文件清单

本任务主要新增/修改：

- `drizzle-postgres/0004_material_import_normalization.sql`
- `drizzle-postgres/meta/0004_snapshot.json`、`meta/_journal.json`
- `db/schema.ts`
- `app/lib/material-import-normalization-selfhost/{errors,types,state-machine,normalizer,repository,service,handler,worker}.ts`
- `app/lib/selfhost-api.ts`、`app/lib/selfhost-worker.ts`、`app/lib/infrastructure/background-jobs.ts`
- `worker/selfhost.ts`
- `app/lib/material-import/normalization-model.ts`
- `app/materials/_lib/material-import-normalization.ts`
- `app/materials/_components/material-import-normalization-review.tsx`
- `tests/selfhost-normalization-{unit,postgres,ui-contract,migration-upgrade}.test.mjs`
- `scripts/selfhost-compose-smoke.mjs`、`scripts/selfhost-normalization-restart-smoke.mjs`
- `tests/fixtures/selfhost-smoke.csv`
- `tsconfig.task03.json`、`package.json`
- 本诊断、设计、完成报告和项目状态文档

工作区还包含用户此前 SELFHOST Phase 0、TASK01、TASK02 的未提交内容；未把它们冒充为 TASK03 独立修改，也未清理。

## 2. PostgreSQL migration

新增 `0004_material_import_normalization.sql`，只在新的 PostgreSQL migration 序列中追加，没有修改已经执行约定的 `0001`、`0002`、`0003`。

- 空库 runner 实际应用 `0001 -> 0004` 成功。
- runner 第二次执行无新增 migration，checksum/idempotency 检查通过。
- `0003 -> 0004` 存量升级实际通过。
- 升级会回填 source file/sheet/row、run version、source/mapping/rule snapshot、published time、run/row issue 统计和 normalized bytes。
- Drizzle PostgreSQL schema、journal 和 `0004_snapshot.json` 已同步。

## 3. 新增表、索引、外键和约束

新增：

- `material_import_normalized_field_candidates`
- `material_import_normalized_attribute_candidates`
- `material_import_normalization_lineage`

扩展：

- `material_import_normalization_runs`
- `material_import_normalized_rows`
- `material_import_normalization_issues`

关键数据库保护：

- batch/run version、active run、row source/position、candidate target、issue key、lineage source 唯一索引；
- batch/status/history、row status、issue filter、candidate/lineage row 查询索引；
- source file/sheet/row、Mapping、run、用户 restrict 外键；
- 状态、阶段、摘要、计数、JSONB 类型/大小、取消、失败和发布一致性 check；
- 已发布 Row/Candidate/Lineage/Issue 的数据库不可变 trigger。

## 4. Repository、Service、Normalizer 与 Worker 边界

- Repository：PostgreSQL 事务、可见性、Mapping/source context、暂存替换、分页读取和关系化证据查询。
- Service：confirmed Mapping/source/catalog 重验证、状态机、run version、CAS、幂等、Event/Audit、重试/重跑/取消。
- Normalizer：复用旧确定性规则，输出核心字段候选、动态属性候选、lineage、issues 和 canonical hash；不访问数据库或外部服务。
- Worker：Job lease/heartbeat/CAS、100 行 chunk、暂存、完整性核对、分页摘要、publication callback 和失败/取消 checkpoint。
- API：Session actor、权限、CSRF、body/cursor/page 限制、安全错误和请求编号。

## 5. 旧功能迁移对照

旧 D1 run/row/issue、Outbox/lease、Current/Latest、重试/重跑/取消、Rows/Issues cursor 和 Review Drawer 均已保留。JSON payload 继续作为 UI 兼容快照，但候选、属性和 lineage 已关系化，不再只依赖 JSON 或日志。

有意差异：旧实验性规格抽取的 `NORMALIZATION_SPECIFICATION_REVIEW_REQUIRED` 属于后续 Draft/人工规格闭环，TASK03 不发布该实验能力；旧代码保留为迁移参考，没有删除。

## 6. 标准字段候选

按 TASK02 服务端 Catalog 的 namespace/code 保存 STANDARD_NAME、SPECIFICATION_MODEL、UNIT、BRAND、MANUFACTURER、MANUFACTURER_PART_NUMBER、DESCRIPTION、SOURCE_FIELD、采购/库存/批次/保质期/检验/环保字段，以及 category hint 和 supplier reference。原值、标准化值、空值状态、校验状态、规则版本和显示顺序分开保存。

## 7. 动态属性候选

以稳定 `attribute_code` 为业务引用，保存名称快照、TEXT/INTEGER/DECIMAL/BOOLEAN/DATE/ENUM、原值、标准化值、canonical unit、校验状态和规则版本。运行前按 PostgreSQL ACTIVE Catalog 重验证；属性缺失/禁用/类型变化 fail closed。

## 8. Lineage

每个候选至少一条 lineage；多来源列用 ordinal 分开。记录 source Sheet/row/column/name/key、Mapping id/digest、规则 code/version、转换步骤和有界 raw/normalized 摘要。Lineage 与 run 一起发布，SUPERSEDED 历史仍可查询。

## 9. Issue 代码

保留并验证：

- `NORMALIZATION_REQUIRED_VALUE_MISSING`
- `NORMALIZATION_BLANK_VALUE`
- `NORMALIZATION_TYPE_MISMATCH`
- `NORMALIZATION_NUMBER_INVALID`
- `NORMALIZATION_INTEGER_REQUIRED`
- `NORMALIZATION_BOOLEAN_INVALID`
- `NORMALIZATION_DATE_INVALID`
- `NORMALIZATION_ENUM_INVALID`
- `NORMALIZATION_TEXT_TOO_LONG`
- `NORMALIZATION_FORMULA_NOT_EXECUTED`
- `NORMALIZATION_SOURCE_ERROR_CELL`
- `NORMALIZATION_DEFAULT_INVALID`
- `NORMALIZATION_BRAND_UNKNOWN`
- `NORMALIZATION_ATTRIBUTE_DISABLED`
- `NORMALIZATION_ATTRIBUTE_UNIT_REQUIRED`
- `NORMALIZATION_ATTRIBUTE_UNIT_INVALID`
- `NORMALIZATION_ROW_TOO_LARGE`
- `NORMALIZATION_ISSUE_LIMIT_EXCEEDED`

每个问题具有稳定 key、ERROR/WARNING、目标/属性/来源定位、安全信息和规则 code。

## 10. 运行状态机

实现 QUEUED → RUNNING → PUBLISHING → SUCCEEDED → SUPERSEDED；QUEUED/RUNNING/PUBLISHING 可失败，QUEUED 可直接 CANCELLED，RUNNING/PUBLISHING 经 CANCEL_REQUESTED → CANCELLED，FAILED → QUEUED 只用于同 run retry。非法转换单元测试拒绝。

## 11. 重试、重跑和取消

- 重试：同 run id；attempt/retry count 增加，清理该 run 未发布 staging 后确定性重算。
- 重跑：新 run id/run_version，可复用同一 CONFIRMED Mapping；旧发布结果完整保留。
- 取消：QUEUED 原子取消；RUNNING/PUBLISHING 设置 CANCEL_REQUESTED，在 chunk 或 publish checkpoint 胜出。取消运行的 staging 不对普通查询可见。
- 非重试错误现在强制 background Job DEAD；不再出现 run 已 FAILED 但 Job 被普通重试后伪成功。

## 12. 原子发布具体方案

Worker 可分块写入 run-isolated staging，但读取 API 只接受 `published_at IS NOT NULL` 的 SUCCEEDED/SUPERSEDED。全部行完成并核对统计/lineage 后转 PUBLISHING。最终 publication callback 与 `background_jobs` SUCCEEDED 在同一事务：

1. 再验 Job lease/token/expiry；
2. 锁 run 和 batch；
3. 验 Mapping/source/current batch 事实；
4. 旧 current 改 SUPERSEDED；
5. 新 run 写 digest/published/SUCCEEDED；
6. 批次 pointer、统计、Event/Audit；
7. Job SUCCEEDED。

任何一步失败整体回滚，上一 current 保持可见。

## 13. 并发和幂等安全

- active run 部分唯一索引和 batch/run 行锁；
- Idempotency-Key + route scope + canonical body digest；同正文重放，异正文 409；
- batch 和 run `expected_version`；
- Job `FOR UPDATE SKIP LOCKED`、lease token/expiry、heartbeat 和 version CAS；
- publication 条件更新、published immutable trigger 和唯一位置/issue key；
- 集成测试并发调用同 publication，只有一个发布者成功。

## 14. API 接入

已接入 create/summary/run history/run detail/retry/cancel/rows/row detail/issues。Rows/Issues limit 最大 100，历史最大 50；cursor 绑定筛选 scope。权限、CSRF、幂等、CAS、未知参数、非法筛选和安全错误均测试。

## 15. 前端接入

复用七步 Import Workspace 和 Normalization Review：

- Current/Latest 进度；
- 运行历史切换；
- run-specific Rows/Issues；
- VALID/WARNING/ERROR/SKIPPED、Issue level/code/target/row 筛选；
- raw row 与候选分离、动态属性、关系化 lineage；
- 同 run retry、新 run rerun 和取消。

没有人工保存候选、创建 Draft 或绑定 ACTIVE 操作。

## 16. 性能和有界处理

- 单次 source chunk 100 行；
- 结果摘要读取 500 行/页；
- 单 run 最大 50,000 来源行、200,000 issue、256 MiB normalized JSON；
- row payload 256 KiB、Mapping snapshot 1 MiB、候选/lineage/issue JSON 16 KiB；
- Rows/Issues 强制 keyset 分页；
- Compose 实测文件为 4 行（1 header + 3 data），专项 PostgreSQL夹具为 5 行（1 header + 4 data）。这是正确性验收，不据此声称大规模性能结论。

## 17. 测试命令与真实结果

专项：

- `npm run test:normalization:unit`：4/4
- `npm run test:normalization:ui`：3/3
- `npm run test:normalization:postgres`：4/4
- `npm run test:normalization:migration-upgrade`：1/1
- `npm run typecheck:normalization`：通过
- `npm run build`：通过，生成 Vinext standalone
- `npm run lint`：0 error；1 个任务前已存在 workbook unused warning
- `npm run security:credentials`：PASS，436 个 repository files
- `git diff --check`：PASS

迁移：

- 空库 `npm run db:migrate`：应用 0001/0002/0003/0004
- 同库再次 `npm run db:migrate`：无重复执行
- `0003 -> 0004` 升级：1/1

说明：根 `tsconfig.json` 的全仓库 `tsc` 仍报告旧 D1/Miniflare、examples 和既有 Material/UI 类型债务；本任务没有扩大范围修复这些旧运行面。TASK03 的 core/repository/service/handler/worker/UI/DB 使用 `tsconfig.task03.json` strict 定向检查通过，production build 通过。

## 18. Compose 冒烟结果

一次性 PostgreSQL 17 + migrate + Web + Worker：

- 登录、CSV 4 行、Parser、Sheet/header、Mapping 保存/预览/确认；
- Run v1 发布 3 data rows：VALID/WARNING/ERROR 各至少一条；
- 读取行详情、raw/candidates/lineage 和 2 条 ERROR/WARNING issue；
- Run v2 重跑发布，v1 SUPERSEDED 且仍可读；
- Run v3 取消，未切换 current，取消 staging 返回 404；
- 每个 normalization run 只有一个 background Job；
- source structure digest 漂移后返回 422；
- Normalization 前后 Material 表同一行、同状态、同版本；
- 整栈 stop/up 后 v2 的 3 rows、2 issues、3 run history 和 lineage 均仍可读。

结束后 `cyd-task03-compose` 容器、网络、PostgreSQL/uploads/attachments 卷、独立 PG 测试容器和临时 migration 文件均已删除；核对列表为空。

## 19. TASK01/TASK02 回归

- FileStorage：3/3
- Phase 0 PostgreSQL/Worker：5/5
- Material unit/UI/PG：6/6 + 2/2 + 7/7
- Mapping unit/UI/PG/upgrade：3/3 + 2/2 + 6/6 + 1/1
- 环境保护：6/6

与 TASK03 专项合计实际执行 53 个 Node test，全部通过。Material/Mapping 因新增 `0004` 更新 migration 列表断言后通过，没有降低业务断言。

## 20. Cloudflare/D1 旧代码

旧 D1 migration、Repository/Service/API/Worker/Miniflare 测试保留为历史迁移参考，没有删除。自托管入口、TASK03 模块和生产 Worker 不导入 `cloudflare:workers`、D1、R2、Cloudflare Queue 或 Miniflare。

## 21. 运行依赖扫描

- 源码扫描 selfhost API/Worker/TASK03 模块：无 `cloudflare:workers`、`D1Database`、`R2Bucket`、Miniflare import。
- Worker production image：`npm ls --omit=dev miniflare @cloudflare/workers-types wrangler` 返回 `(empty)`。

## 22. 未完成项

- 全仓库旧 D1/examples 的 TypeScript 债务未在本任务修复。
- 未做真实供应商 Excel 容量基准、远程网络、生产备份恢复或正式安全验收。
- 未迁移 SQLite/D1 真实数据。
- 未实现人工最终复核、候选修改、保留/排除、查重、ACTIVE 绑定或 Draft 创建。

## 23. 下一任务建议

`SELFHOST-PHASE1-TASK04`：迁移 Normalization 人工复核闭环，在不破坏已发布候选/lineage 的前提下实现人工决定、保留/排除、已有 ACTIVE 绑定或批量创建 Material Draft；正式编码仍只能经过现有 Material 审批。

## 24. Git 状态

- Branch：`main`
- 修改前及当前 HEAD：`2c1003f2547b934424c03f216936c43b0f1efd40`
- 状态：dirty；包含此前 SELFHOST Phase 0/TASK01/TASK02 和本任务未提交内容。
- 未执行 reset、checkout 覆盖、clean、rebase 或历史重写。

## 25. 生产、部署与 Git 外部动作

- 生产数据库/生产 URL：未访问
- 真实数据迁移：未执行
- 部署/公网切换：未执行
- Git commit：未创建
- Git push：未执行
- Pull Request：未创建
