# SELFHOST-PHASE1-TASK03 修改前诊断

日期：2026-07-23（Asia/Shanghai）

## Git 与工作区

- 根仓库：`/opt/erp`
- 目标目录：`/opt/erp/chenyida_erp_site`
- Branch：`main`
- 修改前 HEAD：`2c1003f2547b934424c03f216936c43b0f1efd40`
- 分支相对上游：ahead 23
- 修改前已有未提交内容：SELFHOST Phase 0、Phase 1 Task01/02 的代码、迁移、Compose、测试和文档均在同一工作区；本任务不覆盖、不清理、不提交这些改动。
- 嵌套仓库：Site 已是根仓库普通目录，不是独立 Git 仓库或裸 gitlink。

## 现状结论

1. PostgreSQL `0001` 已提供 Normalization 占位表，`0002` 完成 Material 工作流，`0003` 完成 Parse/Mapping/不可变 Mapping 快照；占位 Normalization 表不足以表达候选字段、动态属性、完整 lineage、运行版本和原子发布约束。
2. 自托管 Worker 已有 PostgreSQL Outbox、`background_jobs`、`FOR UPDATE SKIP LOCKED`、租约令牌、心跳、重试、超时恢复和“业务发布回调 + Job SUCCEEDED”同事务提交能力。
3. Parser 采用 run 隔离后在 Worker completion 事务切换批次指针，适合复用为 Normalization 的小事务原子发布边界。
4. D1 `drizzle/0006_material_import_normalization.sql`、旧 Repository/Service/API/Worker 和 Normalization Review UI 已实现确定性行处理、问题、重跑、取消、Current/Latest 双轨、分页和 Drawer，是行为迁移基准；旧 D1/R2/Queue/Miniflare 不能进入自托管运行图。
5. TASK02 的 CONFIRMED Mapping 已保存 `source_fields`、`items`、所用 `targets`、源结构摘要、metadata digest 和 mapping digest，可作为 Normalizer 唯一输入。DRAFT/STALE/SUPERSEDED 不能启动新运行。
6. Parser 原始行位于 `material_import_rows.raw_values`，具有 `parse_run_id`、Sheet、行号和原始行摘要；Normalizer 应只引用，不更新。
7. 旧确定性规则已覆盖 NFC/trim、缺失与空白语义、安全字符串、整数/十进制/布尔/日期/枚举、必填、长度、公式/错误单元格、未知品牌提示、动态属性及稳定问题代码。
8. 旧实验性 `SPECIFICATION_EXTRACT`/规格审核门禁属于后续自适应 Draft 方向，不属于 TASK03 的确定性 Mapping→候选边界；保留旧代码作为参考，自托管适配器不发布该实验性问题。
9. 现有 `/materials/imports/:batchId` 与 Review UI 可以复用；需要补 run history 选择、run-specific API、关系化候选/lineage 和同运行重试。

## 旧功能迁移对照

| 旧 D1 能力 | PostgreSQL 自托管落点 | 处理 |
| --- | --- | --- |
| normalization run | `material_import_normalization_runs` | 扩展 source/mapping/rule/run version/CAS/统计/取消/发布字段 |
| normalized JSON row | `material_import_normalized_rows` | 保留 JSON 快照，同时增加稳定 source row/sheet 外键和摘要统计 |
| basic/category/supplier candidate | `material_import_normalized_field_candidates` | 关系化保存 raw/normalized/value state/规则 |
| dynamic attribute candidate | `material_import_normalized_attribute_candidates` | 以 `attribute_code` 保存，名称仅作运行时快照 |
| lineage in payload | `material_import_normalization_lineage` | 每一来源列独立记录，保留 Mapping digest 和转换步骤 |
| issues | `material_import_normalization_issues` | 稳定 `issue_key`、code、字段定位、安全详情和规则 |
| Current/Latest | 批次 `current_normalization_run_id` + run history | 新发布后旧运行 SUPERSEDED；失败/取消不改变 current |
| D1 Queue/lease | PostgreSQL Outbox + `background_jobs` | 复用现有领取、心跳、CAS、重试和恢复 |
| 原子 pointer publish | Job completion transaction | 暂存记录发布前不可读；同事务切 run/batch pointer/job status |
| 重试 | 同 run、清理该 run 暂存后重算 | 不创建新 run，不重复 issue/lineage |
| 重跑 | 新 run_version | 保留旧运行和只读结果 |
| 取消 | QUEUED 直接取消；运行中 checkpoint | 未发布行继续不可见；已发布 current 不回退 |
| Review UI | 复用现有组件 | 增加历史运行、关系化证据和 run-specific 操作 |

## 数据模型计划

- 不建立无限扩张的大 JSON 表。
- JSONB 仅保存不可变 Mapping 快照、兼容的 normalized payload、受限 raw/normalized 值和安全详情。
- Run、Row、Field Candidate、Attribute Candidate、Lineage、Issue 分表并使用外键、唯一约束、状态/计数/大小 check 和查询索引。
- 发布后结果表由数据库 trigger 禁止 INSERT/UPDATE/DELETE；历史 Mapping 被 SUPERSEDED 后仍由 restrict 外键保留。

## Worker 与原子发布计划

1. Outbox 创建 `material.import.normalize` Job。
2. Worker 持 Job lease，以 100 行 keyset chunk 读取不可变原始行。
3. 每个 chunk 在短事务内按 run id 替换暂存 Row/Candidate/Lineage/Issue，并 CAS 校验 Job lease 与 run lease token。
4. 完整性核验要求行数、状态计数、问题计数和 lineage 数一致。
5. 结果摘要以 500 行分页流式计算。
6. Worker 返回 publication callback；`PostgresBackgroundJobQueue.complete` 在一个事务内验证 lease、切换旧/新 run、批次 pointer/统计、Event/Audit 和 Job SUCCEEDED。
7. 事务失败整体回滚；普通查询只允许 `published_at IS NOT NULL` 的 SUCCEEDED/SUPERSEDED run。

## 预计修改范围

- `db/schema.ts`
- `drizzle-postgres/0004_material_import_normalization.sql` 与 Drizzle metadata
- `app/lib/material-import-normalization-selfhost/`
- `app/lib/selfhost-api.ts`
- `app/lib/selfhost-worker.ts`
- `worker/selfhost.ts`
- `app/materials/_lib/material-import-normalization.ts`
- `app/materials/_components/material-import-normalization-review.tsx`
- TASK03 单元、PostgreSQL、升级、UI 和 Compose 测试
- 自托管设计、完成报告及六份项目状态文档

## 测试计划

- 确定性规则/状态机单元测试。
- PostgreSQL 空库、`0003 -> 0004`、重复 runner、约束与发布不可变测试。
- API/Service/Worker 集成：权限、CSRF、幂等、CAS、候选、动态属性、lineage、issues、筛选、历史、重试、重跑、取消、租约、并发与发布回滚。
- Review UI 契约和 Cloudflare/D1 运行依赖扫描。
- TASK01、TASK02、Phase 0 回归、定向 strict TypeScript、production build、ESLint、凭证和 diff 检查。
- PostgreSQL 17 一次性 Compose 全链路、整栈重启持久性和资源清理。
