# 晨亿达ERP变更日志

本文件记录可审计的项目变化。每个任务提交前必须增加一条记录，包含 Git Commit、功能、数据库、API 和文档影响。当前提交无法在自身内容中稳定写入自身哈希，因此使用“任务编号 + 提交消息”作为本条标识，实际哈希以 `git log` 为准。

## 2026-07-14

### PHASE1-TASK09 设计评审 - `docs: design material master read ui`

- Git Commit：书面规格、文字线框稿和项目治理文档在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `4d2f54b`。
- 新增功能：无；本阶段只完成 Material Master 只读管理界面 V1 书面设计。
- 页面设计：列表采用高密度紧凑筛选和企业表格，详情采用高密度分区卡片；版本历史与变更日志保留独立 URL 并作为详情工作区页签。
- URL 与交互：定义列表查询规范化、keyword debounce、前进后退、深链接、安全 `return_to`、分类 ID/path 语义、服务端分页/排序和固定关键列。
- 权限与错误：前端不复制行级权限；隐藏对象统一 404；定义 401/403/400/500、网络失败、request_id、Material 嵌套错误和 private/no-store 边界。
- 历史与属性：定义 TEXT/INTEGER/DECIMAL/BOOLEAN/ENUM/单位/空值展示、Validation ERROR/WARNING、最近 5 条摘要、有界版本快照和变更详情。
- 架构：记录现有 iframe/tab、无通用组件和 legacy 错误包装差异；建议使用真正 Vinext 路由、唯一共享浏览器请求边界，不新增大型状态或请求依赖。
- 验证：规格占位符/路由/范围自检通过；Site build、Node 66/66、lint 0 error/1 个既有 warning、一次性 D1 smoke、203 文件凭证扫描和临时 SQLite 完整基线通过；临时数据已清理。
- 数据库/API/代码：无变化；未修改前端、API、Schema、Migration、索引、业务服务或 legacy SQLite。
- 生产影响：无；未连接生产 D1、未迁移真实数据、未部署或修改生产配置。

### PHASE1-TASK08 实施 - `feat: add material reference and query api`

- Git Commit：实现、测试、查询计划证据和项目文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，前置规格提交为 `928e08f`。
- Query Service：统一 materials/drafts 的列表、可见性、详情聚合、类型化属性、当前 metadata 校验和历史读取；drafts 只保留工作流兼容字段与分页外壳，审核队列保持独立。
- API：新增分类 tree/flat、四级叶子 Schema、`/materials` 列表/详情、版本分页和变更日志分页 6 个路由；详情历史摘要各最多 5 条，完整历史默认 20、最大 50。
- 权限与隐藏：正式状态对全部 material.read 可见；DRAFT/PENDING_REVIEW 按创建人、edit-any、review-queue 扩展；授权谓词与筛选在 SQL/count 取交集，隐藏记录不返回、不计 total，不可见详情/历史返回 404。
- Metadata 与缓存：Schema 只读当前 D1，不读 seed；description 缺失为空字符串，enum label 缺失等于 code；共享 Validation 单位策略；Reference 使用强内容摘要 ETag/304，物料及历史使用 `private, no-store`。
- 性能：列表分类路径与审核 metadata 批量加载，新增查询次数防 N+1 回归；1k/10k/100k 查询计划和采样已记录，发现候选优化方向但未创建索引或 migration。
- 测试：Site build、Node 66/66、隔离 API smoke、lint 0 error/1 个任务外既有 warning、201 文件凭证扫描、查询计划脚本和临时 SQLite 完整基线通过；全量 tsc 仍只有 `db/schema.ts` 两处既有 Drizzle TS2740，按范围未修改。
- 已知限制：继续双读 `PENDING_APPROVAL`；leading-wildcard keyword 没有专用全文索引；候选索引需再次审批；无前端、写接口、导入、AI、候选匹配、真实迁移或下游业务变化。
- 生产影响：无；未连接生产 D1、未迁移真实物料、未部署或修改生产配置。

### PHASE1-TASK08 设计评审 - `docs: design material reference and query api`

- Git Commit：书面规格、OpenAPI 和项目治理文档在独立文档提交完成；实际哈希以根仓库 `git log -1` 为准，提交前基线为 `0edede0`。
- 新增功能：无；本阶段只完成 Material Master Reference & Query API V1 书面设计。
- API 设计：新增统一 `/materials` 列表/详情、分类树、叶子 Schema、版本分页和变更日志分页契约；`/drafts` 保留为复用统一 Query Service 的兼容层，`/review-queue` 保持独立。
- 权限与隐藏：正式状态对全部 material.read 可见；DRAFT/PENDING_REVIEW 按创建人、edit-any、review-queue 取交集；列表在 SQL/count 中过滤，不可见详情返回 `404 MATERIAL_NOT_FOUND`。
- 缓存与性能：分类 tree/flat 和叶子 Schema 使用规范化内容摘要 ETag 与私有可验证缓存；物料、历史和工作流响应统一 private/no-store；列表不逐项 Validation，详情只执行单物料当前校验，历史有界分页。
- 数据库变化：无；未创建 migration 或索引。只列出候选组合索引，要求后续先完成 1k/10k/100k 合成数据的 `EXPLAIN QUERY PLAN` 和延迟证据，并再次审批。
- 文档变化：新增 `reference-query-api-v1.md` 和 OpenAPI；D-014 记录已确认架构与读取范围；同步更新 MASTER、TASKS、STATUS。
- 待确认：规格最终字段、分页、缓存 Header，以及现有 metadata 无 description/枚举显示名时采用空 description 和 `label = code` 的 V1 表达。
- 验证：OpenAPI YAML、9 个路由/35 个 schema 引用和占位符检查通过；Site build、Node 62/62、lint 0 error/1 个既有 warning、一次性 Miniflare API smoke、196 文件凭证扫描通过；本地临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 go-live 检查通过；临时数据已清理，`git diff --check` 通过。
- 生产影响：无；未修改 Schema、migration、API 代码、业务服务或前端，未连接生产 D1、迁移真实数据或部署。

### PHASE1-TASK07 实施 - `feat: add material draft lifecycle`

- Git Commit：实现、迁移、测试和项目文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，前置设计提交为 `3dbf2b0`。
- 状态机：实现 `DRAFT -> PENDING_REVIEW -> ACTIVE` 和 `PENDING_REVIEW -> DRAFT`；驳回后允许完整替换编辑并重新提交，批准/驳回不再接受 `DRAFT`。
- API：新增 PATCH 草稿完整可编辑聚合替换、POST 提交和 GET 审核队列；补充 OpenAPI 非 Merge Patch 契约、稳定状态错误、默认分页/排序、allowlist 筛选和当前 metadata 校验摘要。
- 权限与职责：新增 edit-own/edit-any/submit/review-queue；提交同时校验 own/edit-any；创建人永久禁审、当前提交版本最后修改人禁审，无 admin 例外，`submitted_by` 本身不构成禁审。
- 数据库：新增 `0003_material_draft_lifecycle.sql`、受保护 Down 和 Drizzle snapshot/journal；增加三个职责字段、双状态过渡约束、PATCH 幂等 method 和四个审核队列索引；可验证旧待审数据回填，无法恢复职责时预检失败，历史快照不改写。
- 并发与安全：PATCH、submit、approve、reject 继续使用严格 Origin/CSRF、24 小时幂等、60/20 限流和乐观锁；业务、属性、版本、变更日志、幂等完成与 API 成功审计在单一 D1 batch 提交。并发 PATCH/提交/审核均验证仅一个成功。
- 测试：build 和 Node 62/62 通过；lint 0 error/1 个既有 warning；`0003` 升级、失败预检、约束、索引、空库 Down/重升、完整生命周期、职责分离、N+1 边界及一次性 D1 smoke 通过；194 文件凭证扫描和本地临时 SQLite 基线通过。
- 已知限制：过渡 schema 仍接受 `PENDING_APPROVAL`，破坏性收缩必须另建任务；无页面、多级审核、break-glass、导入、AI、真实物料迁移或下游业务修改；既有 Drizzle 自引用 TypeScript 诊断未在本任务修复。
- 生产影响：无；未连接生产 D1、未迁移真实物料、未部署或修改生产配置。

### PHASE1-TASK07 设计评审 - `docs: design material draft lifecycle`

- Git Commit：第一阶段书面规格和项目文档在独立提交完成，实际哈希以根仓库 `git log -1` 为准；规格确认前停止实施。
- 新增功能：无；当前只完成草稿生命周期、重新提交和审核队列 V1 书面设计。
- 修改功能：无；未修改现有 Validation、Draft/Review Service、Material API、页面或 legacy 运行面。
- 数据库变化：无；规格提出后续前向 migration 增加 `last_modified_by`、`submitted_by`、`submitted_at`，分步统一 `PENDING_REVIEW`，扩展 PATCH 幂等 method 并增加审核队列索引，当前未创建或执行 migration。
- API 变化：无已实现路由；规格拟议 PATCH 草稿、POST 提交和 GET 审核队列，并收紧批准/驳回只能操作 `PENDING_REVIEW`。
- 权限与职责：拟议 edit-own/edit-any/submit/review-queue 权限；所有角色继续禁止创建人自审，并新增最后实质修改人不得审核当前版本。
- 文档变化：新增 `docs/material-master/draft-lifecycle-v1.md`；D-013 记录为 `PROPOSED`；同步登记唯一 DOING 任务、风险和下一步。
- 待确认：当前职责字段方案、物理状态更名、PATCH 完整替换、编辑 Validation 阻断、提交人审核、队列校验口径、提交说明、权限矩阵和 migration 分步方案。
- 验证：Site build 和 Node 58/58 通过；lint 0 error/1 个既有 warning；一次性 Miniflare API smoke、189 文件凭证扫描通过；本地临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore 和 `go_live_check --no-backup` 通过；`git diff --check` 通过。未连接生产 D1。

### PHASE1-TASK06 实施 - `feat: add material draft and review api`

- Git Commit：实现、迁移、测试和项目文档在独立功能提交完成；实际哈希以根仓库 `git log -1` 为准，前置设计提交为 `e55318c`。
- 新增功能：实现创建、列表、详情、批准、驳回 5 个 Material 路由；复用现有会话并增加细粒度权限、全员禁止自审、严格 Origin/双提交 CSRF、稳定错误和只读 Query Service。
- 数据库变化：新增 `0002_material_draft_review_api.sql`、空隔离库 Down、Drizzle snapshot/journal；增加 `material_api_idempotency`、`material_api_rate_limit_buckets`，扩展关系化 API 审计列及 Material 列表/审计索引；未修改 `0000`/`0001`，未执行生产 migration。
- 并发与安全：幂等作用域为用户、方法、具体路径和 Key 摘要；保存 canonical 请求摘要、120 秒租约和 24 小时结果，成功完成/审计与 Material 业务 batch 原子提交；每用户每分钟 60 次写尝试/20 个新 Key，admin 不豁免，测试可降低阈值。
- 审计：Material API 审计关系化记录物理请求、稳定操作、Key 摘要、对象和版本，在线保留目标为 1095 天；admin 完整查看、manager 只读查看，提供受控分页导出，`material_change_logs` 不随 API 或幂等清理删除。
- 业务边界：公共创建只允许 `MANUAL`，非 MANUAL 返回 `SOURCE_TYPE_NOT_ALLOWED`；V1 只提供单步最终审核，不实现页面、草稿编辑、多级会签、break-glass、导入、AI 或下游业务变更。
- 验证：build 和 Node 58/58 通过；lint 0 error/1 个既有 warning；版本化迁移已有数据升级、约束、Down/重升通过；一次性 Miniflare 登录/CSRF/API smoke、凭证扫描、`git diff --check` 和本地临时 SQLite 基线通过。TypeScript 全量检查仍只有 `db/schema.ts` 两处既有自引用类型错误。
- 生产影响：无；未连接生产 D1、未迁移真实物料、未部署、未修改生产配置。

## 2026-07-13

### PHASE1-TASK06 设计评审 - `docs: design material draft and review api`

- Git Commit：第一阶段书面规格和项目文档在独立提交完成，实际哈希以根仓库 `git log -1` 为准；规格确认前停止实施。
- 新增功能：无；当前只完成受认证授权 Draft/Review API V1 书面设计。
- 修改功能：无；未修改现有 Draft/Review/Validation Service、API、页面或 legacy 运行面。
- 数据库变化：无；只提出后续新增 `0002`、专用 `material_api_idempotency`、有界速率桶、关系化通用审计字段、列表/审计索引和隔离迁移测试，未创建 migration 或连接 D1。
- API 变化：无已实现路由；规格拟议创建、列表、详情、批准、驳回 5 个路由，明确现有会话认证、细粒度权限、Origin/CSRF、持久幂等、乐观锁和稳定错误映射。
- 文档变化：新增 `docs/material-master/draft-review-api-v1.md`；D-012 记录为 `PROPOSED`；同步登记唯一 DOING 任务、风险、下一步和验证状态。
- 待确认：审核角色、创建人自审、多节点审核边界、批准/驳回角色是否相同、幂等与审计保留期、写速率阈值及人工 API 来源范围。
- 验证：Site build、Node 52/52、lint（0 error/1 个既有 warning）、一次性 D1 API smoke、177 文件凭证检查通过；本地环境守卫 4/4、self-test、smoke、backup/restore、临时 SQLite go-live 检查通过；`git diff --check` 通过。未连接生产 D1。

### PHASE1-TASK05 - `feat: add material draft and review service`

- Git Commit：规格、实现、测试和项目文档在本任务独立提交完成，实际哈希以根仓库 `git log -1` 为准。
- 新增功能：新增 `material-master` 六模块，提供 `createDraft()`、`approveDraft()`、`rejectDraft()`、类型化属性持久化、正式编码格式和统一导出。
- 状态流转：创建固定写 `DRAFT` 且无正式编码；批准重新校验后以单一 D1 batch 原子写 `ACTIVE`、编码、批准信息、版本和审计；拒绝保持 `DRAFT`、递增版本并记录拒绝历史。
- 并发与安全：物料使用 `expected_version` 乐观锁，编码规则使用 version/sequence CAS 和唯一索引；创建/批准事务比较 metadata/属性守卫，校验后规则变化会冲突回滚；服务错误不返回 SQL 或底层 D1 异常。
- 数据库变化：无 schema 或 migration 变化；只使用现有 V2 表和约束，未写生产数据。审计业务动作映射为 `CREATE_DRAFT -> CREATE`、`APPROVE -> APPROVAL`、`REJECT -> REJECTION`、`CODE_GENERATE -> CODE_ASSIGNMENT`。
- API 变化：无；未修改路由、`erp-api.ts` 或页面。
- 文档变化：新增草稿/审核服务 V1 规格与实施结果；D-011 确认所有未来来源统一经过该服务及最终审核启用时生成正式编码；同步更新总控、任务和状态。
- 验证：新增 12 个隔离 D1 服务测试，覆盖校验阻断、提交前复核、并发审核、重复编码、防 TOCTOU 和故障回滚；完整 Node 52/52、build、lint（0 error/1 个既有 warning）、隔离 API smoke、176 文件凭证检查和差异检查通过；未连接生产 D1。

## 2026-07-12

### PHASE1-TASK04 - `feat: add material validation service`

- Git Commit：本任务功能独立提交，实际哈希以根仓库 `git log -1` 为准；前置设计提交为 `e239c35`。
- 新增功能：新增 Repository + Rules + Service 三层 `material-validation` 模块，提供创建前和审核前校验、D1/Memory Repository、25 个结构化 code 及稳定错误顺序。
- 修改功能：测试入口显式启用 Node TypeScript stripping，以兼容项目声明的 Node 22.13 最低版本；未修改现有业务行为。
- Bug 修复：无现有业务 Bug；实现期间补足绑定属性优先、未绑定属性随后输出的稳定排序。
- 数据库变化：无 schema、migration 或生产数据变化；D1 Repository 只读现有分类、绑定和属性定义 metadata，不缓存、不读取 seed。
- API 变化：无；未接入路由或现有 `erp-api.ts`。
- 文档变化：完成物料校验服务 V1 规格与实施结果；D-010 记录 D1 metadata 唯一运行时规则来源；同步更新项目状态。
- 验证：新增 28 个校验测试，完整 Node 40/40；lint、build、隔离 API 烟测、凭证检查和差异检查通过；未连接生产 D1。

### PHASE1-TASK03 - `feat: add material category and attribute templates`

- Git Commit：本任务功能独立提交，实际哈希以根仓库 `git log -1` 为准；前置设计提交为 `ebef667`。
- 新增功能：新增 `material-category-v1` TypeScript 声明数据和 test/local 专用 seed 执行器，输出分类、属性、绑定的插入/更新统计。
- 修改功能：无现有业务功能变化；不接入 AI、Excel、真实物料、BOM、采购、库存或生产。
- Bug 修复：无。
- 数据库变化：无 schema 或 migration 变化；seed 可向已迁移的隔离 D1 幂等写入 101 个分类、34 个属性定义和 228 条四级叶子显式绑定，使用本地 D1 原子 batch。
- API 变化：无。
- 文档变化：新增分类标准 V1 与设计规格；D-009 明确模板复制而非父子继承；同步更新项目状态文档。
- 验证：seed 声明、父子层级、关键必填模板、幂等、环境拒绝和原 migration 测试通过；未连接生产 D1。

### PHASE1-TASK02 - `feat: implement material master v2 schema`

- Git Commit：本任务独立提交，实际哈希以根仓库 `git log -1` 为准。
- 新增功能：无业务功能；新增 Material Master V2 数据契约与可回滚迁移框架。
- 修改功能：无；现有 API、页面、BOM、采购、库存和 legacy SQLite 不变。
- Bug 修复：无。
- 数据库变化：新增 12 张在线 D1 V2 表的 Drizzle schema、`0001` Up、Down、快照、约束与索引；正式编码仅允许审核后生命周期，供应商映射唯一身份包含 supplier/code/manufacturer/mpn/revision 与有效期。
- API 变化：无。
- 文档变化：更新设计基线和项目状态，新增 `docs/audits/phase1-task02-schema-report.md`。
- 验证：本机一次性 D1 完成空库 Up、防重、结构/约束、Down 和重建；完整基线结果见审计报告。未连接生产 D1。

## 2026-07-11

### PHASE1-TASK01 设计评审 - `docs: design material master v2 data model`

- Git Commit：设计评审独立提交，完成后实际哈希以根仓库 `git log -1` 为准。
- 新增功能：无；当前只完成设计。
- 修改功能：无。
- Bug 修复：无。
- 数据库变化：无；仅设计 11 张在线 D1 V2 关系表、约束、索引和 Up/Down 迁移顺序，未创建数据库对象。
- API 变化：无。
- 文档变化：新增 `docs/material-master/database-model-v2.md`，包含 ER 图、字段说明、`legacy_material_mapping`、来源追踪、迁移/回滚方案、测试矩阵、AI 接入边界和风险；记录在线 D1 唯一目标及动态属性决策。
- 验证：文档占位符、内部一致性、11/11 表级 `created_at` 覆盖和 `git diff --check` 通过；Site lint 0 错误/1 个既有警告、构建与 Node 测试 8/8、凭证检查通过；本地 ERP 自测、烟测和上线检查在一次性临时 SQLite 中通过且目录已清理。等待人工设计审批。

### PHASE0-TASK02 - `security: establish environment isolation baseline`

- Git Commit：本任务独立提交，完成后实际哈希以根仓库 `git log -1` 为准。
- 新增功能：统一 development/test/production 环境清单；本机一次性 Miniflare D1 烟测运行器；生产/公开 URL/非临时路径拒绝；凭证扫描；本地 SQLite 环境与备份恢复测试。
- 修改功能：仅修改开发与测试配置；Site 本地 Cloudflare 绑定关闭远程资源，烟测数据采用 `TEST-` 标识并自动销毁；本地数据目录支持环境覆盖以隔离测试。
- Bug 修复：本地烟测备份不再写入正式数据目录；在线写入型烟测不能再直接指向任意远程 URL。
- 数据库变化：无 schema 或迁移变化；未创建云端 D1，未连接或修改生产 D1。
- API 变化：无业务 API 新增、删除或行为修改；备份/恢复只在一次性测试数据库验证。
- 文档变化：新增测试环境说明、安全隔离审计和设计规格；更新 README、MASTER、TASKS、PROJECT_CONTEXT、ARCHITECTURE、DECISIONS、STATUS。
- 验证：Site lint、build、Node 测试、一次性 D1 API 烟测、凭证扫描及本地 ERP 自测/烟测/上线检查/备份恢复均通过。

### PHASE0-TASK01-B - `fix: convert site gitlink to tracked source`

- Git Commit：本任务独立合并提交；第一父提交为任务开始时根仓库 `a1a8d6a`，第二父提交为 Site 开发基线 `9f2c2dc`；完成后实际哈希以根仓库 `git log -1` 为准。
- 新增功能：无。
- 修改功能：无。
- Bug 修复：移除无 `.gitmodules`、无可用远端的 Site gitlink；把原 Site tree 的 77 个文件按普通文件纳入根仓库，使新克隆可恢复完整源码。
- 数据库变化：无；未修改 schema、迁移或生产 D1。
- API 变化：无。
- 文档变化：更新根 README、项目总控、状态、任务、架构、上下文和决策记录；新增 `docs/audits/phase0-task01-source-management-report.md`。
- 版本关系：生产 Site `2b4f178`；纳管前开发 Site `9f2c2dc`；两者运行时代码一致，且 `2b4f178` 是 `9f2c2dc` 的祖先。

### PM-000 - `docs: establish project operating system`

- Git Commit：本任务独立提交，完成后以根仓库 `git log -1` 为准。
- 新增功能：无。
- 修改功能：无。
- Bug 修复：无。
- 数据库变化：无。
- API 变化：无。
- 文档变化：新增 `docs/project/` 项目管理体系；更新 `AGENTS.md` 的文档驱动开发流程；纳入现有技术审计和物料 V2 准备文档作为上下文基线。

### `bbefb2e` - `feat: add chenyida erp site project files`

- 新增功能：根仓库记录在线 Site 项目入口。
- 修改功能：无本次重新审计的业务行为变化。
- Bug 修复：无。
- 数据库变化：无。
- API 变化：无。
- 文档变化：无。
- 已知问题：该入口为无 `.gitmodules` 的 gitlink，新克隆不可恢复完整 Site 源码。

### `3e45f05` - `Document online ERP architecture`

- 新增功能：无。
- 修改功能：无。
- 数据库变化：无。
- API 变化：无。
- 文档变化：记录在线 ERP 架构。

## 历史基线

下列提交已存在于根仓库历史。本次只建立索引，不重新解释未审计的每一行变化：

| Commit | 提交消息 | 主要类别 |
| --- | --- | --- |
| `7654d45` | `Add quotation workflow` | 功能 |
| `42bdd8c` | `Add customer and supplier master data` | 功能 |
| `1255f6f` | `Add inventory count adjustments` | 功能 |
| `a58c20d` | `Add finance settlement module` | 功能 |
| `07562bc` | `Add go-live operations package` | 功能/运维 |
| `8d0138b` | `Add ERP login and operations controls` | 功能/安全 |
| `7748ade` | `Merge remote-tracking branch 'origin/main'` | Git 历史 |
| `f189de9` | `Initial ChenYida ERP system` | 初始系统 |
| `a4b63b3` | `Initial commit` | 初始化 |

## 记录模板

```text
### TASK-ID - `type: commit message`
- Git Commit：提交后以 git log 为准
- 新增功能：
- 修改功能：
- Bug 修复：
- 数据库变化：
- API 变化：
- 文档变化：
```
