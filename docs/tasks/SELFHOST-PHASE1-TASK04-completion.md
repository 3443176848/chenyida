# SELFHOST-PHASE1-TASK04 完成报告

日期：2026-07-24（Asia/Shanghai）

结论：Normalization 人工复核、人工覆盖、保留/排除、ACTIVE 精确绑定、Material Draft 创建、版本历史、CAS/幂等和可恢复 finalization 已迁入自托管 PostgreSQL，并接入现有七步 Import Workspace 与 TASK01 Material Workflow Service。未访问生产、未迁移真实数据、未部署、未提交、未推送、未创建 PR。

## 1. 修改文件

主要新增/修改：

- `drizzle-postgres/0005_material_import_review.sql`
- `drizzle-postgres/meta/0005_snapshot.json`、`meta/_journal.json`
- `db/schema.ts`
- `app/lib/material-import-review-selfhost/{types,errors,state-machine,values,repository,service,handler,worker}.ts`
- `app/lib/material-selfhost/service.ts`、`validation.ts`
- `app/lib/selfhost-api.ts`、`app/lib/selfhost-worker.ts`、`worker/selfhost.ts`
- `app/materials/_components/material-import-review-workspace.tsx`
- `app/materials/_components/material-import-{workspace,primitives,normalization-review}.tsx`
- `app/materials/_lib/material-import.ts`
- `tests/selfhost-review-{unit,postgres,ui-contract}.test.mjs`
- `scripts/selfhost-compose-smoke.mjs`、`scripts/selfhost-review-restart-smoke.mjs`
- `tsconfig.task04.json`、`package.json`
- TASK04 诊断、PostgreSQL 设计、完成报告和项目治理文档

工作区原有 Phase 0、TASK01～TASK03 未提交内容全部保留，未冒充为 TASK04 独立修改。

## 2. PostgreSQL migration

新增 `drizzle-postgres/0005_material_import_review.sql`；没有修改 `0001`～`0004`。最终 SHA-256：

- `0001` `c1cd71803b0f504594a41234a82eb13ce8e6713f5d346f3e49247b4921ff1702`
- `0002` `2d8d4facf54c950fa19d1346705aa0f549669544da1a87c2fc584c1fe8b7eb80`
- `0003` `8ce859551198a8a5a334665f68eee503590fa5472f3a6396f44670d2110dddbf`
- `0004` `1bb0eb9b7b3ddbe6c6058a75a04a4bbc69a088e201856f258a4c75728f64aa39`
- `0005` `e4f2dc62afb8908c7d5a1a0202639809c9dd3f3be3fc09f0ad469224e46ecdcc`

空库 runner 应用 `0001 -> 0005`、重复执行、从已记录 `0004` 升级到 `0005` 均通过；两个数据库的 `schema_migrations` 都按顺序列出五个版本。Drizzle schema、journal 和 snapshot 已同步。

## 3. 表、索引、外键和约束

新增 11 表：

- review sessions、rows
- field overrides、attribute overrides
- normalization issue resolutions、review validation issues
- finalizations、finalization rows
- ACTIVE material bindings、Material Draft links
- review history

数据库中有 42 个 `material_import_review_%` 索引。关键约束包括：

- run/mapping/digest 固定引用及 insert trigger 复核；
- active session、review version、row/normalized row 唯一；
- row disposition 与 material 引用互斥；
- override/issue revision 唯一；
- final payload/digest/operation key 唯一；
- review row 的 binding 和 Draft link 唯一；
- JSONB 类型和 16/256 KiB 大小限制；
- FK 全部 restrict，防止删除被复核的 run/row/material/user；
- Finalizing/Finalized 后人工决定与覆盖不可修改；
- published Normalization 和 Parser raw 继续由旧 migration 的不可变边界保护。

## 4. 模块边界

- Repository：PostgreSQL transaction、CAS、幂等记录、Session/Row/覆盖/Issue/历史/分页/搜索和数据库错误映射。
- Service：权限、已发布 run 校验、状态机、值/属性校验、决定语义、ACTIVE 选择、预检、审计和 API DTO。
- Worker：快照、lease/heartbeat、100 行准备、50 行处理、绑定/Draft Service 协调、行级结果、失败和完成汇总。
- API：Session actor、Origin/CSRF、body/query/page 限制、Idempotency-Key、expected_version、稳定错误和 request id。
- React：只负责交互；不承担状态机、物料状态或最终校验。

## 5. 旧功能迁移对照

| 能力 | 结果 |
| --- | --- |
| run/current/history 与已发布结果 | 固定引用并保留 |
| raw/candidate/attribute/lineage/issues Drawer | 保留 |
| 行状态和 Review 展示 | 从 normalized row 展示值升级为独立 Review Row |
| 字段和动态属性修改 | 新增不可覆盖候选的 revision 历史 |
| ERROR/WARNING | 原 issue 不变，新增 resolution/validation issue |
| 分页与筛选 | PostgreSQL 服务端 keyset/page 限制 |
| Draft 关联 | 改为显式人工决定 + finalization + TASK01 Service |
| Review Session/version | 旧实现缺失，新增历史版本和 supersedes |
| ACTIVE binding | 旧实现缺失，新增人工精确选择和最终重验 |
| 批处理/失败恢复 | 旧实现缺失，新增 sealed snapshot 和可恢复 Worker |

旧代码实际不存在提示中所述完整 `erp-api.ts` 复核闭环；保留其可验证契约并补齐关系模型，差异见诊断报告。

## 6. Session 与版本

Session 保存 batch、run id/version/result digest、mapping id/digest、review version、status、创建/提交/完成/失败时间、统计、CAS 和 supersedes。只有完整 published SUCCEEDED/SUPERSEDED run 可创建。新版本不覆盖旧版本；FINALIZED/CANCELLED/失败版本保留为只读历史。

状态为 DRAFT、IN_REVIEW、READY_TO_FINALIZE、FINALIZING、FINALIZED、FINALIZE_FAILED、CANCELLED。当前验证 API 是只读预检，READY_TO_FINALIZE 是保留的显式扩展状态；finalize 可从编辑态以 CAS 直接进入 FINALIZING。

## 7. 行决定

实现 PENDING、KEEP、EXCLUDE、BIND_EXISTING、CREATE_DRAFT。KEEP 是“保留但尚未选择最终物料动作”，因此会阻止 finalization。EXCLUDE 要求原因；binding 与 draft 互斥；已 finalized 行不可编辑。

## 8. 核心字段覆盖

服务端白名单、类型/长度/必填/枚举校验；SET、CLEAR、REVERT 语义分离。每次修改追加 revision/supersedes，保存原 candidate、安全原因/备注、操作者和时间。标量字符串写 JSONB 时使用 canonical JSON；Compose 首轮实际发现并修复了该边界，新增 PostgreSQL 回归。

## 9. 动态属性覆盖

只用稳定 attribute code。保存名称/类型快照、原 raw/normalized、override、单位/格式、validation status、revision 和 actor。写入时查询当前 metadata；Material Draft 创建时由 TASK01 Service 再验属性启用、分类绑定、类型、枚举、必填、数字、布尔和 DATE。

## 10. 三层值分离

raw 表、TASK03 candidate 表和 Review override 表完全分离。Row Detail 同时返回三层；effective value 只按最新 override -> candidate 计算，从不回退 raw。CLEAR 返回 null，REVERT 恢复 candidate。测试确认 raw/candidate 在复核、绑定和建稿后不变。

## 11. Issue

Normalization issue 不修改。WARNING 需人工确认；ERROR 可排除，或在对应 SET override 存在时记录 `RESOLVED_BY_OVERRIDE`。Worker 的状态漂移/Material 校验失败写独立 validation issue，稳定 key+generation upsert 防重复；成功重试关闭活动问题。

## 12. 状态机

编辑态进入 FINALIZING；全部成功才 FINALIZED；行失败则 FINALIZE_FAILED。非法转换、终态修改、旧 expected version 和已被替换 Job 均返回冲突。修正业务内容通过新 Review version，安全暂时性失败可 retry 同一 snapshot。

## 13. ACTIVE 绑定

只允许用户从分页 ACTIVE 搜索结果精确选择 ID。Service 保存选择前验证；Worker 最终事务重新查询状态。Binding 保存 material ID 和安全显示快照，不更新 ACTIVE。状态漂移产生行失败和 validation issue，要求新选择/新版本。

## 14. Material Draft

Worker 调用 `MaterialWorkflowService.createDraftWithClient`，实际复用 TASK01 校验、版本、change log、audit 和状态约束。结果必须保持 DRAFT、无正式编码、未提交、未批准。Review Repository 没有直接插入 material master。

## 15. 最终提交事务边界

Web 事务只做预检、Session CAS、finalization/Outbox 创建。Worker 每行事务原子执行 lease 校验、binding 或 Material Service Draft、link、history 和结果。批次不是虚假的全局原子；已成功行真实保留。

## 16. 部分失败和恢复

存在失败行时 Session 为 FINALIZE_FAILED，显示 completed/failed 和安全错误。Retry 换新 Job，只恢复失败行；已完成行不重做。业务规则已变化应创建新 Review version，而不是无限重试旧 snapshot。

## 17. CAS 和幂等

Session/Row 写均要求 expected version。幂等 scope 包含 actor/route/batch/session/row/issue，请求摘要为 canonical body digest；同 key 同正文重放并带 `Idempotency-Replayed`，异正文 409。Final payload、row operation、binding、draft link、Material idempotency 形成四层防重。

## 18. 防重复绑定和建稿

`operation_key`、binding row/finalization row、draft row/finalization row 唯一索引；Draft `source_ref` 和 Material Service operation key 稳定。重复 Worker 投递和 finalized Worker 重入均不生成第二个 binding 或 Draft。

## 19. API

已接入 Session 创建/当前/历史/统计、行分页/筛选/详情、字段/属性覆盖、Issue resolution、决定、批量、validate、finalize/progress/retry 和 ACTIVE 搜索。所有列表有限制；状态码区分 400/401/403/404/409/422/500。

## 20. 前端

保留 `/materials/imports/:batchId`、七步流程、`view=normalized/issues`、`row=<normalizedRowId>` 和 Drawer；新增 `view=review`、版本/历史、三层值、覆盖/CLEAR/REVERT、决定、原因、Issue、ACTIVE 搜索、Draft 选择、批量、摘要、进度、失败和 retry。历史只读，409 要求刷新。没有任何自动匹配、ACTIVE 创建、自动审批或编码按钮。

## 21. 性能

- Rows 最大 100、ACTIVE 搜索最大 50、bulk 最大 200。
- issue/lineage 按 Row Detail 按需读取。
- snapshot prepare 100 行/chunk；operation process 50 行/chunk。
- 101 行 PostgreSQL 专项实际跨 2 个 prepare chunk 和 3 个 process chunk。
- 不据此声称百万行容量。

## 22. 测试命令和真实结果

专项：

- `npm run test:review:unit`：7/7
- `npm run test:review:ui`：3/3
- `npm run test:review:postgres`：3/3
- `npm run typecheck:review`：通过

回归 Node：

- File Storage 3/3
- Material unit/UI/PG 6/6 + 2/2 + 7/7
- Mapping unit/UI/PG/upgrade 3/3 + 2/2 + 6/6 + 1/1
- Normalization unit/UI/PG/upgrade 4/4 + 3/3 + 4/4 + 1/1
- Phase 0 PostgreSQL/Worker 5/5
- Environment guard 6/6

最终累计：39 个 unit/UI/environment、25 个 PostgreSQL、2 个 legacy migration upgrade，合计 66 个 Node test 全部通过。

其他：

- `npm run lint`：0 error；1 个任务前已有 `build_material_workbook.mjs` unused warning
- `npm run build`：Vinext 5/5，standalone 成功
- `npm run security:credentials`：PASS，454 repository files
- `git diff --check`：PASS

环境说明：host 没有 Node/npm，命令在 `node:22-bookworm` 一次性容器运行。Environment guard 首次未挂载 `/config/environments.json` 属环境装载失败，补挂 `/opt/erp/config:/config:ro` 后 6/6。没有降低断言。

## 23. Compose 冒烟

隔离 PostgreSQL 17 + migrate + web + worker 实际完成：

- CSV 4 行（header + 3 data）、Parser、Mapping save/preview/confirm、Normalization v1/v2/cancel；
- Review v1 三行覆盖 VALID/WARNING/ERROR；
- 核心字段和动态属性修改、CLEAR/REVERT；
- WARNING 确认、ERROR 排除；
- expected_version 409；
- 精确绑定 1 个 ACTIVE、创建 1 个 DRAFT；
- finalization Idempotency-Key 重放；
- ACTIVE 名称/version 不变；
- Draft 无 code/submitted/approved；
- Review v2 与 v1 history；
- 整栈 stop/up 后 3 rows、2 issues、3 normalization runs、2 review versions、binding 和 draft link 全部持久。

最终输出包含：batch 1、published run 2、review 1、review v2 2、Draft 3、ACTIVE 2。

首轮发现文本属性 JSONB 参数编码缺陷并修复；一次使用 200ms poll 时取消竞争被 Worker 抢先，恢复默认 1000ms 后稳定通过。这些失败没有被隐藏。

## 24. TASK01～TASK03 回归

TASK01 Material 15/15、TASK02 Mapping 12/12 + upgrade 1/1、TASK03 Normalization 11/11 + upgrade 1/1 全部通过；Phase 0 PostgreSQL/Worker 5/5。空库、重复 migration、`0004 -> 0005` 升级均通过。

## 25. Cloudflare/D1 旧代码

旧 D1 migration、API、Repository、Worker 和 Miniflare 测试保留为迁移参考，没有删除。TASK04 自托管模块和生产 Worker 的源码扫描没有 `cloudflare:workers`、D1、R2、Miniflare 或 Cloudflare Queue 依赖。

## 26. 自托管依赖扫描

源码扫描无 Cloudflare/D1/R2/Miniflare 命中。Worker production image：

`npm ls --omit=dev miniflare @cloudflare/workers-types wrangler`

结果为 `(empty)`。

## 27. 未完成项

- 没有真实供应商文件容量基准、远程网络、安全渗透或生产恢复演练。
- Compose 的业务批次只有 3 行；实际“处理中失去租约”由 PostgreSQL 集成测试显式过期旧 lease、恢复并由新 Worker 接管验证，Compose 验证的是整栈停止/重启后的持久化，不把它虚报为大批量运行中容器故障压测。
- 当前 schema 没有组织/租户列，因此 ACTIVE 可见范围是当前数据库作用域与现有权限，不声称多租户隔离。
- READY_TO_FINALIZE 是保留状态，当前 validate 端点不写状态。
- 没有真实数据迁移和生产部署。

## 28. 下一任务建议

建议下一任务先进行真实但脱敏供应商样本的只读容量/冲突演练和复核验收，再单独设计受控旧数据试迁移。生产迁移、备份恢复和部署必须另行授权。

## 29. Git

- Branch：`main`
- HEAD：`2c1003f2547b934424c03f216936c43b0f1efd40`
- Worktree：dirty；包含此前 Phase 0/TASK01～TASK03 与 TASK04 未提交内容
- 未 reset、checkout 覆盖、clean、rebase 或改写历史

## 30. 外部动作

- 生产数据库/URL：未访问
- 真实数据：未迁移
- 部署：未执行
- Git commit：未创建
- Git push：未执行
- PR：未创建
- 一次性 Compose 项目容器、网络、PostgreSQL/uploads/attachments volumes：已删除
- 一次性 PostgreSQL 集成测试容器：完成最终检查后删除
