# 晨亿达ERP决策记录

## 使用规则

重大业务、数据、架构、安全和生产决策必须写入本文件，不得只保留在聊天中。状态为：

- `ACCEPTED`：已由项目负责人明确确认，可作为开发约束。
- `PROPOSED`：已有推荐方案，但仍需人工确认，不得写入生产业务规则。
- `SUPERSEDED`：已被后续决策替代，保留历史，不删除。

每条决策必须记录日期、状态、背景、决定、原因、影响和确认人。

## D-001 文档优先恢复项目上下文

- 日期：2026-07-11
- 状态：ACCEPTED
- 确认人：项目负责人（通过 PM-000 指令确认）
- 背景：聊天上下文无法长期、稳定地传递到新的 Codex 对话。
- 决定：任何 Codex 必须先阅读 `MASTER.md`，再阅读 `TASKS.md`、`PROJECT_CONTEXT.md` 和当前任务文档。
- 原因：让范围、状态、风险和决策进入 Git，可审阅、可追踪、可由新对话恢复。
- 影响：任务完成必须更新项目文档并创建独立提交。

## D-002 AI 不得直接写正式物料

- 日期：2026-07-11
- 状态：ACCEPTED
- 确认人：项目工程规则；业务责任人仍需确认具体审核角色
- 背景：AI 匹配和生成可能出现误判，物料错误会传导到 BOM、采购、库存和生产。
- 决定：AI 只能生成建议、候选和证据；不得未经审核直接创建、合并、启用或覆盖正式物料。
- 原因：保证职责分离、可追溯和人工最终责任。
- 影响：未来 AI 接口必须输出置信度与证据，并进入人工审核状态机。

## D-003 使用供应商映射连接外部料号与内部物料

- 日期：2026-07-11
- 状态：ACCEPTED
- 确认人：现有系统设计基线；V2 字段范围待业务确认
- 背景：不同供应商可能使用不同料号、名称、包装、MOQ 和采购单位描述同一内部物料。
- 决定：BOM、库存和生产只引用内部物料；供应商料号通过受控映射关联内部物料。
- 原因：避免外部料号成为内部业务主键，支持一物多供和历史追踪。
- 影响：映射必须保留供应商、料号、品牌/MPN、单位、状态、版本和审核信息。

## D-004 采用动态品类属性模型

- 日期：2026-07-11
- 状态：ACCEPTED
- 确认人：项目负责人（通过 `PHASE1-TASK01` 指令确认采用动态属性体系）
- 背景：电阻、电容、连接器、PI/FPC 材料等品类的关键属性差异明显，固定单表字段会快速膨胀。
- 决定：使用“品类 + 属性定义 + 类型化属性值”模型，属性定义受版本和审核控制。
- 原因：在不频繁改表的前提下支持品类差异，同时保持类型、单位、必填和允许值约束。
- 影响：不能把全部属性退化为无约束 JSON；关键检索字段需要规范化值和索引。

## D-005 采用四级匹配分流

- 日期：2026-07-11
- 状态：PROPOSED
- 确认人：待业务负责人通过标注样本确认阈值
- 背景：导入行既可能精确命中，也可能只有相似候选、存在冲突或确为新物料。
- 建议：分为自动建议、疑似匹配、冲突匹配、新物料四级；所有级别默认不直接写正式主数据。
- 原因：按风险分配人工工作量，并保留可解释证据。
- 影响：需要导入批次、候选评分、冲突原因、人工结论和阈值版本。

## D-006 唯一生产物料权威源

- 日期：2026-07-11
- 状态：ACCEPTED
- 确认人：项目负责人（通过 `PHASE1-TASK01` 明确确认）
- 背景：本地 Python/SQLite 与在线 Site/D1 均可创建业务记录，编码和模型已经分叉。
- 决定：在线 Site/D1 是 Material Master V2 的唯一目标数据库；本地 SQLite 保持不变，仅作为 legacy 数据来源。
- 原因：避免两套系统继续产生冲突主数据。
- 影响：V2 schema、迁移和后续服务只在在线 Site/D1 实现；本地 SQLite 不新增 V2 业务逻辑。未经单独授权，不实施生产迁移、不切断本地写路径。

## D-007 Site 源码由根仓库直接管理

- 日期：2026-07-11
- 状态：ACCEPTED
- 确认人：项目负责人（通过 `PHASE0-TASK01-B` 指令确认）
- 背景：`chenyida_erp_site/` 原为无 `.gitmodules`、无可用远端的 mode `160000` gitlink，新克隆无法恢复 Site 源码。
- 决定：保留 `chenyida_erp_app/` 和 `chenyida_erp_site/` 目录名；解除 gitlink，把 Site 的 77 个跟踪文件作为普通文件纳入根仓库。最终任务提交连接根仓库历史与 Site 开发提交 `9f2c2dc`，生产提交 `2b4f178` 继续可追溯。
- 原因：让一次根仓库克隆即可恢复两个应用，同时避免目录重命名引发启动、构建、托管或部署路径变化。
- 影响：后续 Site 开发直接在根仓库提交，不再在 `chenyida_erp_site/` 内创建独立仓库或执行 submodule 操作；生产发布仍须单独授权。

## D-008 测试默认使用本机一次性 D1

- 日期：2026-07-11
- 状态：ACCEPTED
- 确认人：项目负责人（通过 `PHASE0-TASK02` 指令确认）
- 背景：现有在线烟测可向任意 URL 执行大量写操作，缺少隔离 D1、自动清理和生产拒绝。
- 决定：当前测试基线使用每次运行自动创建并销毁的本机 Miniflare D1；只允许 `ERP_ENV=test` 和 HTTP 回环地址，显式关闭远程绑定。远程 Test D1 仅记录未来受控流程，本任务不创建。
- 原因：在没有云端测试资源和独立凭证的情况下，先建立可重复、默认拒绝、不会触碰生产的写入测试基线。
- 影响：Site 写入型烟测必须通过安全运行器执行；失败仅保留去敏诊断，不保留数据库。未来启用远程 Test D1 必须另行授权并扩展明确测试主机允许列表。

## D-009 分类属性仅显式绑定四级叶子

- 日期：2026-07-12
- 状态：ACCEPTED
- 确认人：项目负责人（通过 `PHASE1-TASK03` 指令确认）
- 背景：三级分类与四级叶子可能共享属性模板，但当前版本优先保证数据明确、AI 分类后可直接匹配模板并简化审核流程。
- 决定：所有属性只显式绑定四级叶子分类，数据关系保持 `category -> attributes`。相同模板允许通过 seed 配置复制为多个独立绑定，但不建立父分类到子分类的继承、覆盖或运行时传播机制。
- 原因：避免继承优先级和覆盖规则产生歧义，使每个叶子的有效属性集合可以直接查询、校验和审计。
- 影响：每个四级叶子必须拥有完整的显式属性绑定；新增叶子时必须复制或新建模板绑定并通过完整性测试，父级属性不得被解释为子级默认值。

## D-010 物料校验运行时规则来自 D1 Metadata

- 日期：2026-07-12
- 状态：ACCEPTED
- 确认人：项目负责人（通过 `PHASE1-TASK04` 指令确认）
- 背景：分类和属性 seed 是初始化手段；若运行时校验直接读取 seed，受控 D1 metadata 变化不会生效，并会产生数据库与应用规则双来源。
- 决定：Material Validation Service 采用 Repository + Rules + Service 三层架构。运行时只按 `category_id` 从 D1 的 `material_categories`、`material_category_attributes` 和 `material_attribute_definitions` 读取当前分类、绑定、必填、类型、标准单位和枚举 metadata；属性输入只使用稳定大写 `attribute_code`，禁止 `attribute_id`。运行时不读取 seed，也不缓存 metadata；Memory Repository 仅用于单元测试。
- 原因：保持 D1 为在线 V2 权威规则源，使受控 metadata 变化在下一次校验中生效，并让规则层可以通过依赖注入独立测试。
- 影响：所有创建和审核入口必须使用结构化校验结果；`ERROR` 阻断、`WARNING` 不阻断。生产 metadata 变化仍需受控流程和单独授权，本决策不授权生产修改或部署。

## D-011 所有物料来源统一经过草稿与审核写服务

- 日期：2026-07-13
- 状态：ACCEPTED
- 确认人：项目负责人（通过 `PHASE1-TASK05` 指令确认）
- 背景：Material Master V2 已有关系化 schema、分类属性 metadata 和独立 Validation Service，但仍缺少唯一受控写边界；人工、Excel、AI 建议确认和供应商同步若各自直写会绕过校验、编码、并发和审计。
- 决定：所有来源未来都必须调用统一 Draft/Review Service。创建前执行 Validation，只有无 `ERROR` 才能原子创建 `DRAFT`、属性、首个版本和审计；草稿不生成正式编码。`approveDraft()` 必须从 D1 重载草稿并重新校验，以 `expected_version` 乐观锁和 metadata/属性守卫在一个 D1 batch 中原子领取编码序列、写入正式编码和批准信息、转为 `ACTIVE`、追加版本及审计。正式编码生成时点固定为最终审核启用事务，确认 B03。
- 审计映射：受现有 schema 约束，业务动作使用 `CREATE_DRAFT -> CREATE`、`APPROVE -> APPROVAL`、`REJECT -> REJECTION`、`CODE_GENERATE -> CODE_ASSIGNMENT`；业务动作字面值写入 `field_name`，不修改已执行迁移。
- 拒绝语义：现有生命周期没有 `REJECTED`。`rejectDraft()` 不生成或消耗编码，保持 `DRAFT`、递增版本并追加 `REJECT` 版本和审计，供未来受控编辑/重新提交服务继续处理。
- 原因：建立一个可复用、可测试、不可由未来来源绕过的服务端写边界，同时维持已批准 schema 和扩展式迁移原则。
- 影响：并发审核只有一个预期版本能成功；编码规则使用序列/version CAS 和唯一索引双重保护；校验后 metadata 或属性变化会触发事务冲突。此决策不确认 B04 数据责任人或 B11 多角色审核节点，也不授权 API、页面、生产迁移、metadata 初始化或部署。

## D-012 Material Draft/Review API 安全与幂等边界

- 日期：2026-07-13
- 状态：ACCEPTED
- 确认人：项目负责人（2026-07-14 回复“规格确认”并逐项确认八项选择）
- 背景：现有 Draft/Review Service 尚无 API；当前 ERP 只有粗粒度权限和 SameSite 会话 Cookie，没有 Origin/CSRF 校验。现有 `idempotency_keys` 没有请求摘要和处理状态，以全局 Key 为主键，并在业务执行后使用 `INSERT OR REPLACE`，不能满足本任务的异载荷冲突、并发占位和事务完成要求。
- 决定：catch-all 先识别 Material namespace，再由独立模块使用服务端请求编号完成认证、授权和错误适配；复用 `app_users`/`app_sessions`，增加四个细粒度权限；三个写路由使用严格 Origin 和 host-only 双提交 CSRF；新增 `material_api_idempotency` 和有界用户/分钟速率桶，以用户、方法、具体路径和 Key 摘要唯一，并让带约束守卫的完成标记和关系化通用成功审计作为可信伴随项加入现有 Material 业务 batch；GET 使用独立只读 Query Service。
- 角色与职责：`admin`、`manager` 可批准和驳回；`purchase`、`engineering` 可创建；其他现有角色只读。所有角色包括 `admin` 均禁止自审，V1 无 break-glass 例外；批准与驳回角色相同，V1 只提供单步最终审核。
- 保留与限流：幂等完成结果保留 24 小时；每用户每分钟最多 60 次写尝试和 20 个新 Key，admin 不豁免且测试可配置更低阈值。API 审计在线保留 1095 天，admin 完整查看、manager 只读查看，其他角色无权查看；到期清理前支持受控导出，`material_change_logs` 不随 API 审计清理。
- 来源：公共人工创建 API 只允许 `MANUAL`，非 MANUAL 返回 `400 SOURCE_TYPE_NOT_ALLOWED`；供应商导入、AI、legacy 和 system 来源等待专用内部服务或独立接口。
- 原因：不复制登录或物料业务规则，同时消除未知 POST 回退 `read`、同 Key 异载荷、并发双执行和业务提交后无幂等记录的窗口。
- 影响：已新增 `0002` Up/Down、schema/snapshot/journal、精确权限、CSRF、持久幂等、有界限流、审计扩展、只读 Query Service 和隔离 API 测试；未修改 `0000`/`0001`，未连接或部署生产。多节点会签、break-glass、自动生产审计归档/清理调度仍为后续独立任务。

## D-013 草稿生命周期、当前职责字段与审核队列

- 日期：2026-07-14
- 状态：ACCEPTED
- 确认人：项目负责人（2026-07-14 回复“规格确认”并逐项确认九项方案 A）
- 背景：现有服务直接审核 `DRAFT`，数据库使用 `PENDING_APPROVAL`，没有编辑、提交、重新提交或独立审核队列；`updated_by` 会被审核动作覆盖，不能证明最后实质修改人。
- 决定：采用 `DRAFT -> PENDING_REVIEW -> ACTIVE`，驳回回到 `DRAFT`；在聚合根增加 `last_modified_by`、`submitted_by`、`submitted_at`，历史继续追加到现有版本、变更日志和 API 审计；PATCH 使用完整可编辑聚合替换；审核者不得是创建人或当前提交版本的最后实质修改人，`submitted_by` 不单独禁审；审核队列只分页返回待审记录并按当前 metadata 提供有界校验摘要。
- 原因：在不引入多节点审核申请表的前提下形成可查询、可重提、可审计的单步生命周期，并保持正式编码只在最终批准事务生成。
- 影响：非生产实现已新增 `0003`，扩展状态和职责字段、PATCH 幂等 method 与待审队列索引，并调整 Draft/Review Service 与 Material API。过渡期双读 `PENDING_APPROVAL`/`PENDING_REVIEW`，只写和只返回新状态；历史快照不改写；破坏性收缩另立任务。生产 migration 和部署仍需单独授权。

完整确认方案见 `docs/material-master/draft-lifecycle-v1.md`；本决策只授权非生产实现，不授权生产 migration、回填或部署。

## D-014 Material Reference 与统一查询采用行级可见性

- 日期：2026-07-14
- 状态：ACCEPTED
- 确认人：项目负责人（通过 `PHASE1-TASK08` 指令确认方案 A 和授权范围）
- 背景：现有 `/api/material-master/drafts` 以 `material.read` 作为唯一读取门槛，可能让普通只读角色看到全部未批准草稿；同时前端缺少稳定的分类树、叶子属性 Schema 和覆盖全部生命周期的统一物料查询入口。
- 决定：新增设计中的 `/materials` 作为统一查询入口；`/drafts` 保留为复用同一 Query Service 和详情组装逻辑的工作流兼容接口；`/review-queue` 继续只允许 `material.review.queue`。全部 `material.read` 用户可见 `ACTIVE`、`FROZEN`、`INACTIVE`；DRAFT 只对创建人或 edit-any 可见；PENDING_REVIEW 只对创建人、edit-any 或 review-queue 可见。列表授权与筛选取交集并在 SQL/count 中过滤；不可见详情返回 `404 MATERIAL_NOT_FOUND`。分类树一次返回完整启用节点并支持 tree/flat；详情只返回有界历史摘要，完整历史使用独立分页子资源。
- 缓存与索引：分类树和分类 Schema 使用基于规范化响应内容的 ETag；物料、历史、drafts 和 review-queue 使用 `private, no-store`。本设计阶段不创建 migration；候选索引必须先经过隔离 D1 的 `EXPLAIN QUERY PLAN` 和 1k/10k/100k 合成数据规模测试，并再次取得审批。
- 原因：让页面只依赖一个稳定物料读取模型，避免两套详情逻辑漂移，同时以最小披露阻止未批准物料被普通业务角色误用或通过数量/状态侧信道发现。
- 影响：项目负责人于 2026-07-14 回复“规格确认”并批准实施查询 API；缺失属性 description 固定返回空字符串，缺失枚举显示名固定 `label = code`，不得从 seed、名称或代码注释生成展示 metadata。实施仍不授权 schema/index migration、生产连接、生产 migration 或部署。完整契约见 `docs/material-master/reference-query-api-v1.md` 和对应 OpenAPI。

## D-015 Material 只读界面采用高密度列表与分区详情

- 日期：2026-07-14
- 状态：ACCEPTED
- 确认人：项目负责人（明确确认方案 A、组合布局方向并于 2026-07-14 回复“规格确认”批准实施）
- 背景：现有在线 Site 只有 iframe 内静态 tab，没有 Material Master 前端页面；PCB/FPC/SMT 日常使用需要在 1366×768 下高频筛选和比较物料，同时详情、校验和审计信息需要清晰分层。
- 决定：列表采用高信息密度企业表格型布局，筛选区默认紧凑展开、首屏不放统计卡片，编码和标准名称优先固定；详情采用基本、职责、类型化属性、校验和历史摘要分区卡片；版本历史与变更日志保留独立 URL，视觉上作为详情工作区页签。V1 只提供查看详情，不展示任何创建、编辑、审核、导入或 AI 操作。
- 原因：优先保证制造企业桌面端的可见数据行数和检索效率，同时用分区详情降低复杂属性与历史信息的阅读成本，并让刷新、深链接和浏览器历史具有确定语义。
- 影响：非生产前端已实现四条原生 Vinext 路由、高密度列表、分区详情、独立历史页签、URL 状态和共享浏览器请求边界；复用现有 Cookie 与根页面登录流程。完整契约和验证见 `docs/material-master/material-read-ui-v1.md`。本决策仍不授权 API/schema/migration 修改、生产连接、迁移或部署。

## D-016 Material Draft 界面采用 Schema 驱动完整聚合与显式写状态

- 日期：2026-07-14
- 状态：ACCEPTED
- 确认人：项目负责人（逐节确认 PHASE1-TASK10 五节设计及全部补充约束）
- 背景：Draft 创建、完整替换编辑和提交 API 已实现，但前端尚无安全处理动态属性、Schema 漂移、幂等重试、部分成功、乐观锁和未保存修改的书面边界；统一详情也不能从最近 5 条摘要可靠取得最近一次驳回。
- 决定：新建和编辑使用 `/materials/new`、`/materials/:materialId/edit` 及布局 C；分类和属性表单只读取当前 D1 Reference Schema，PATCH 发送完整可编辑聚合；“保存并提交”固定为 PATCH、GET 最新详情与 Validation、WARNING 确认、submit。页面以 `user.permissions` 判断动作可见性，以页面内存中的幂等操作状态机、`SAVED_UNSYNCED`、`RESULT_UNKNOWN`、规范化 dirty 和只读冲突对照处理写状态，不使用浏览器持久草稿或强制覆盖。
- API 兼容：Session API、创建响应和 validate-only API 不调整；POST 省略可选 source_ref，PATCH 不发送 source_ref。正式前端实施前必须先由独立任务为统一详情增加从完整不可变历史确定性投影的 `last_rejection`，不得扫描最近 5 条摘要冒充完整历史。
- 原因：保证服务端仍是权限、状态、Validation 和版本的权威边界，同时让网络不确定、Schema 漂移和并发冲突不会产生重复草稿、静默删属性或旧版本覆盖。
- 影响：本任务只新增 `material-draft-ui-v1.md` 和低保真线框稿并更新治理文档；不实施前端、API、Schema、Migration 或业务服务。完整契约见 `docs/material-master/material-draft-ui-v1.md`；任何前端编码、`last_rejection` API、生产迁移或部署仍需独立任务与授权。

## D-017 Material Review UI 采用可恢复队列与右侧审核栏

- 日期：2026-07-15
- 状态：ACCEPTED
- 确认人：项目负责人（逐段确认 PHASE1-TASK13 五段设计及全部补充约束）
- 背景：审核队列、统一详情、批准和驳回 API 已存在，但前端尚无书面定义来处理队列上下文恢复、能力权限、职责分离、Validation 新鲜度、幂等结果未知和可访问性；当前队列 API 还没有 `submitted_by` 筛选。
- 决定：采用 `/materials/review` 和 `/materials/:materialId/review`。推荐方案 A，以左侧完整只读详情配合右侧 sticky Validation、职责分离和审核操作栏；成功后恢复原队列 URL 状态。动作按 `user.permissions` 提供，创建人或最后实质修改人禁审，提交人本身不禁审；前端先提示，服务端结构化 403 错误继续最终裁决。批准前重读最新详情，WARNING 确认绑定 `material_id`、`current_version` 和当前规范化 Validation 摘要，但摘要只作为前端确认新鲜度标记，服务端批准时重新校验仍是唯一业务安全边界。approve/reject 分别维护页面内存幂等状态，`RESULT_UNKNOWN` 只允许原操作原载荷重试。
- API 兼容：V1 展示 `submitted_by`，但不提供筛选控件、不使用 `creator` 冒充、不在前端全量加载后筛选；该能力记录为后续只读 API 候选项且不阻断页面实施。职责分离沿用 `SELF_REVIEW_FORBIDDEN` 和 `LAST_EDITOR_REVIEW_FORBIDDEN` 的 HTTP 403，不改为 409。不新增 metadata version API。
- 组件边界：后续独立实施任务只允许最小提取现有只读详情的基础字段、类型化属性、Validation 和状态/错误展示规则；不得复制两套逻辑、改变现有只读页面行为或契约，或引入新的大型依赖。
- 原因：保持服务端权限、状态、Validation 和版本为权威边界，同时让审核人员在桌面端获得可读、可恢复、可键盘操作且不会因网络不确定执行相反动作的单条审核流程。
- 影响：本任务只形成 `material-review-ui-v1.md`、低保真线框和 51 项实施测试计划；不修改前端运行时代码、API、Schema、Migration、索引、部署配置或生产环境。任何实施、API 候选项、生产迁移或部署均需另立任务并取得授权。

## D-018 Material Import Batch Foundation V1 存储、状态与安全边界

- 日期：2026-07-15
- 状态：ACCEPTED
- 确认人：项目负责人（通过 `PHASE2-TASK02` 指令批准 12 项决定和非生产实施范围）
- 背景：Phase 2 需要为 PCB/FPC/SMT 历史 `.xlsx`/`.csv` 文件建立批次、原始证据、后续解析边界和可恢复上传，但当前 `.openai/hosting.json` 的 `r2` 为 `null`，仓库没有 R2 binding 或 multipart 上传能力；D1 与 R2 也不存在分布式事务。
- 决定：使用私有 R2 保存一个批次的单个原始文件，D1 保存批次、文件元数据、类型化原始行契约、专用幂等记录和不可变事件；Worker 代理流式上传，按 D1 意图、R2 不可覆盖写入、D1 `STORED`、基础安全检查、`FILE_READY` 执行可恢复 Saga，并以批次级 `RECONCILIATION_REQUIRED` 处理不确定结果。
- 安全与并发：对象 key 仅由服务端确定性生成且不得公开；实际 SHA、大小和检测类型为权威；存储完成与安全检查通过分离；owner/`read_any` 行级可见性、CSRF、限流、规范化 multipart 幂等摘要、版本 CAS、终态不可恢复和两阶段清理均由服务端执行。
- 批准选择：私有 R2 + D1 元数据、V1 单批次单文件、10 MiB、原始文件/行终态后 30 天、批次/事件终态后 1095 天、重复默认拒绝且允许显式 `ALLOW_DUPLICATE`、`read_any` capability、普通取消仅 `CREATED`/`UPLOAD_PENDING`/`FILE_READY`、失败重试创建新批次、V1 无下载、仅基础安全检查、对象存储按环境隔离且生产资源仍需另行审批。
- 权限映射：`admin`、`manager` 获得 create/read/cancel/read_any；`purchase`、`engineering` 获得 create/read/cancel；其他角色默认不获导入能力。API 只判断 capability，不硬编码角色。
- 影响：`PHASE2-TASK02` 已完成 `0004`、Drizzle schema/快照/Down、对象存储抽象与 R2/内存适配器、六个 API、流式上传、安全检查、专用幂等、Saga、取消和手工清理服务。未创建生产 bucket/binding/Cron，未连接或迁移生产 D1/R2，未部署；这些操作仍需新的显式授权。

## D-019 Material Import Parser 与 Mapping V1 实施边界

- 日期：2026-07-16
- 状态：ACCEPTED
- 确认人：项目负责人（通过 `PHASE2-TASK04` 指令批准 16 项决定和非生产实施范围）
- 背景：`0004` 已提供 `FILE_READY` 文件和空的原始行表，但没有 workbook/CSV 行解析、parse run、可靠任务投递、Sheet/header 建议或字段 Mapping。D1 与 Queue 不存在分布式事务，ZIP/SAX 行进度也不能未经验证就宣称为可恢复游标。
- 决定：使用持久异步任务、`parse_run_id` 隔离和 `current_parse_run_id` 原子发布；D1 同事务写 Outbox，至少一次投递由 job/run/stage 幂等吸收；以 Sheet 为 V1 真正恢复边界。解析栈固定为 `@zip.js/zip.js@2.8.26 + sax-wasm@3.1.4 + 受限 OOXML` 和 `csv-parse@7.0.1` browser ESM，并通过本机 Vinext、Miniflare、Workers runtime 替身、WASM、R2 Range、Bundle 与内存兼容门禁。
- 数据与 Mapping：可见 Sheet 完整发布后进入持久 `PARSED`；隐藏 Sheet 只保存安全元数据。原始行使用版本化稀疏 cell 契约并保存 `source_column_count`，日期保留原值和解释状态；Shared Strings 使用 run 级分块与有界预取候选。Mapping 永久绑定 parse run，以关系化主/明细表、target allowlist、metadata 摘要和版本 CAS 管理；分类只保存 `category_hint`，不自动分类或写正式物料。
- 资源与状态：批准规格中的组合资源上限、Queue/并发、Shared Strings 总字节、256 MiB 规范化原始行总量、64 MiB 应用内存目标和 `0005` 作为 V1 非生产实施边界。Mapping 准备有独立恢复状态；失败时批次保持 `PARSED`。`MAPPING_CONFIRMED` 在 V1 禁止重新解析。
- 影响：`PHASE2-TASK04` 已完成 `0005` Up/受保护 Down、Parser、Outbox、可注入调度与租约恢复、Mapping 模型和七个 API，54 项专项与全量 Node 278/278 通过。`0004` 未改写；未创建生产 Queue/binding、连接或迁移生产 D1/R2、修改 hosting 或部署，也未实施清洗、分类、AI、Material Draft 或正式物料写入。

## D-020 Material Import Mapping Target Catalog 采用批次作用域共享 Snapshot

- 日期：2026-07-16
- 状态：ACCEPTED
- 确认人：项目负责人（通过 `PHASE2-TASK07` 指令批准正式规格 12 项推荐决定和非生产实施范围）
- 背景：Import Workspace Mapping 编辑器需要权威动态目标来源；原实现的 Parser 准备与 Mapping Service 分别计算只覆盖基础/供应商 code 和属性 code/type/status 的旧 digest，缺少特殊目标、确认必填、default、unit 和其他业务约束，不能作为 Catalog/save/preview/confirm 的共同可信快照。
- 决定：采用批次作用域 `GET /api/material-master/import-batches/:batchId/mapping-targets`；同时要求 `material.import.read`、`material.import.map` 和 owner/`read_any` 行级可见性。BASIC/SPECIAL 由单一 `MaterialImportMappingTargetRegistry` 定义，ATTRIBUTE 只读运行时 D1 ACTIVE metadata；Catalog、Mapping 准备、保存、preview 和 confirm 统一使用 `MaterialImportMappingMetadataSnapshotService` 与 `material-import-mapping-metadata-v1` 规范 JSON SHA-256。展示文案不进入 Mapping digest，cursor 另绑搜索投影摘要；三组统一有界 cursor，缓存固定 `private, no-store`，Catalog 不可用时整体 fail closed。
- 安全与兼容：不返回 attribute_id、表/列/SQL/Repository 内部信息；`read_any` 不隐含 map，隐藏批次 404；GET 不要求 CSRF/幂等，但执行读取限流、request_id 和安全审计。现有 target namespace/code、请求载荷、Mapping 状态机、确认必填、唯一性、category_hint、supplier_reference 和 ignore 语义保持不变；历史失效 target 由 GET Mapping 原样保留，Catalog 不返回 selectable，也不自动删除或替换。
- 影响：`PHASE2-TASK07` 已完成非生产实现、OpenAPI 和 51 项专项测试，全量 Node 339/339；`BLOCKED_BY_MAPPING_TARGET_CATALOG` 标记为 `RESOLVED`。这不代表 Import Workspace UI 已实施；50×256 性能与可访问性门禁仍在。本决策不授权 Schema/Migration、Metadata 数据修改、生产资源、生产连接、迁移或部署。

## D-021 Material Import Workspace UI V1 采用状态驱动单工作区

- 日期：2026-07-17
- 状态：ACCEPTED
- 确认人：项目负责人（通过 `PHASE2-TASK08` 指令批准 UI 规格 16 项决定和非生产实施范围）
- 背景：Import Batch、Parser、Mapping 和批次作用域 Target Catalog 已在非生产代码中形成真实 API，但尚无前端工作区；浏览器侧还需安全处理 File、增量 SHA、multipart 进度、版本、幂等结果未知、轮询、宽表和 Mapping 新鲜度。
- 决定：实现 `/materials/imports`、`/materials/imports/new`、`/materials/imports/:batchId` 三条路由和状态驱动 Stepper；复用 MaterialShell、会话、权限、安全 return_to 与共享 API Client。共享 Client 内扩展受控 multipart XHR、受保护 PUT、request_id/Retry-After 归一化和 RESULT_UNKNOWN；文件仅存页面内存并由专用 Worker 分块计算完整 SHA-256。Rows 使用服务端分页和完整 256 列横向表格；Mapping 使用批次作用域 Catalog、显式保存、当前页面最新 preview 门禁与 confirmed 只读语义。
- 安全与边界：服务端状态、权限、版本、幂等和 confirm 始终是权威；URL 仅是 allowlist 后的非权威视图状态。`MAPPING_CONFIRMED` 只确认字段对应关系，不清洗、分类、匹配、调用 AI、创建 Material Draft、正式物料或编码。任何 RESULT_UNKNOWN 只允许原 Key、endpoint 和不可变载荷重放；不得把 File、SHA 操作上下文、Key、CSRF、Mapping 草稿或 preview 写入浏览器持久存储或 URL。
- 影响：`BLOCKED_BY_MAPPING_TARGET_CATALOG` 已由 `PHASE2-TASK07` 解决；`PHASE2-TASK08` 已完成 UI-001—UI-100 和 50×256 性能/可访问性门禁。Playwright Chromium 1366×768 实测初渲染 1751 ms、翻页 1083 ms、横滚 197 ms、DOM 30,285、JS heap 123,423,127 bytes，末列 IV、sticky/键盘/语义/700 窄屏均通过；仍不开放 page_size=100。本决策不授权后端 API、Schema、Migration、Metadata、生产 R2/Queue/D1、迁移或部署。

## D-022 Material Import Normalization V1 采用独立 run、行 JSON 快照与独立 Issue

- 日期：2026-07-17
- 状态：APPROVED / IMPLEMENTED（NON-PRODUCTION）
- 确认人：项目负责人（`PHASE3-TASK02` 明确批准全部 16 项推荐决定）
- 背景：Import Workspace 已可把批次推进到 `MAPPING_CONFIRMED`，但当前没有把已确认 Mapping 应用于 current parse rows 的运行、暂存行、逐行问题、原子发布或读取契约。现有 Parser 已提供独立 run、Outbox、租约、CAS 和 current pointer 模式，Mapping Target Registry 已提供 digest 保护的类型/default/unit 语义。
- 决定：批次增加 `QUEUED_FOR_NORMALIZATION/NORMALIZING/NORMALIZED`，执行失败只记录 run 并恢复前一稳定批次状态，不新增 `NORMALIZATION_FAILED`；增加 normalization runs、每行版本化 JSON 快照、独立 issue 表和 `current_normalization_run_id`。只使用绑定的 current parse run、CONFIRMED Mapping id/version 和 Metadata digest，行 ERROR 不等同 run 失败；完整核验后以单一 D1 batch 原子切换 pointer。Normalization 只执行确定性 Mapping/类型规则并显式输出 Deferred Validation，不调用需要真实 `category_id` 的完整 Material Validation，也不调用 Draft 写服务。
- 安全与边界：新增 `material.import.normalize`，不由 `read_any` 推导；隐藏批次 404、无能力 403；POST 使用 CSRF、强幂等、限流和版本 CAS。公式不执行且 V1 不使用 cached value；不自动分类、换算单位、清洗自由文本、匹配、去重、创建 Draft 或写正式物料。V1 资源限制批准为 50,000 行、256 KiB/行、256 MiB/批、20 issue/行和 200,000 issue/批；生产容量仍需独立压测和授权。
- 影响：`PHASE3-TASK02` 已实现三张关系表、批次/events/outbox 扩展、受保护 Down、Drizzle snapshot、异步服务、五个 API、权限/限流/取消和隔离测试。16 项选择全部 `APPROVED`；本决定不授权生产迁移或部署。

## D-023 Material Import Normalization Review UI V1 采用统一工作区与 Current Run 审阅

- 日期：2026-07-17
- 状态：APPROVED（SPECIFICATION ONLY）
- 确认人：项目负责人（在正式设计提交 `c694045` 后明确回复“规格确认”）
- 背景：Normalization 后端已能从 Confirmed Mapping 异步生成并原子发布 Current Run，但 Import Workspace 尚无启动、进度、取消、结果行、单行 Lineage 或 Issue 审阅界面；API 又只暴露 Current/Latest、Opaque Cursor 和受限 Issue 筛选，不能由前端补造历史、候选摘要或完整行 Issue 集合。
- 决定：继续使用 `/materials/imports/:batchId` 统一工作区并扩展七步 Stepper；`MAPPING_CONFIRMED` 默认进入数据归一化，`NORMALIZED` 默认进入结果审阅。前端分别保存 Batch、`current_run` 与 `latest_attempt`，进度绑定 Latest Attempt，Rows/Issues/Drawer 只绑定 Current Run。行详情使用右侧 Drawer，700px 下全宽覆盖；轮询采用 2/5/10 秒及网络 5/10/30 秒；行进度只在真实计数合法时显示。Rows 默认 50，只展示真实摘要 DTO；Issues 使用真实筛选和独立 Cursor/History；重跑使用新 Processor Version、必填理由和确认 Dialog。
- 安全与权限：启动/重跑按 `material.import.normalize`，取消按 `material.import.cancel`，读取继续按 owner/`read_any`，不按角色推导。写操作使用页面内存冻结 Body、独立 Key 和 `RESULT_UNKNOWN` 原请求重放；所有结果只读，不编辑 Candidate/Issue、不分类、不创建 Draft 或正式物料。Row Drawer 完整 Issue 查询保持局部门禁，完整历史、部分筛选和 Batch Pointer 等保持非阻塞限制。
- 可访问性与性能：七步状态、表格、筛选、Drawer、焦点恢复、Live Region、1366×768 与 700px 必须在未来实现中验证；50 Rows、100 Issues、200 Attributes 和最大 Payload 等 `PERFORMANCE_AND_ACCESSIBILITY_VALIDATION_REQUIRED` 不因规格确认而解除。
- 影响：`PHASE3-TASK03` 的主规格、37 状态线框、状态矩阵和 104 项未来测试已确认，14 项决定均转为 `APPROVED`。本决定只批准书面规格；前端实现、API 扩展、Schema/Migration、生产连接、迁移或部署仍需独立任务和授权。

## D-024 Internal Material Library 复用既有 Material Master 并以 Approval 接入 Draft

- 日期：2026-07-18
- 状态：ACCEPTED / IMPLEMENTED（NON-PRODUCTION）
- 确认人：项目负责人（通过 `PHASE3-MATERIAL-LIBRARY-01` 明确要求先审计、复用既有 Import/Normalization/Review，并实施正式 Material Master 落地）
- 背景：仓库已存在关系化 `material_master`、分类、动态属性、别名、供应商映射和 Draft/Review/Code 服务，Import 也已到可审阅的 Current Normalization Run；继续新建 `materials` 或重写 Import 会形成第二套权威模型。
- 决定：`material_master` 继续作为唯一正式物料聚合；legacy code/name、spec/model/drawing、供应商料号分别沿用 alias/legacy mapping、动态 attribute 和 supplier mapping 边界。新增标准 units/aliases、brands/aliases、Normalization Approval、Import Row→Draft Link、Duplicate Candidate，以及 Material 的结构化单位/品牌和批次/文件/行来源外键。分类 path 继续由既有 parent 链确定性投影，不增加冗余 path。
- 闭环：只有绑定当前成功 Run 与 `result_digest`、无 ERROR 且 WARNING 已明确确认的 Normalization 才能创建 Draft；写入调用既有 Validation/Draft Service，并在单行事务中保存 DRAFT、属性、版本、变更日志、来源关联和候选。Draft 不分配正式编码、不自动 ACTIVE，后续仍走既有人工提交/审核。候选等级只为 EXACT/HIGH_CONFIDENCE/POSSIBLE，禁止自动合并或删除。
- 安全：新增 `material.import.commit`，只授予 admin/manager；继续执行 owner/`read_any`、CSRF、版本/摘要、持久幂等、安全错误和审计。命令只调用回环 API，commit 只允许 test/local/development，不直接连接 D1。
- 影响：功能提交 `2ff8d9c` 已完成 `0007`、受保护 Down、API/服务/命令和隔离测试。仓库只发现治理模板/样例，真实 dry-run、首批品牌数据、人工冲突处置、生产迁移、资源、备份、部署仍需独立任务和授权。

## D-025 真实物料导入采用先 Inspect、人工治理与 fail-closed 重复门禁

- 日期：2026-07-18
- 状态：ACCEPTED / PARTIALLY IMPLEMENTED（NON-PRODUCTION）
- 确认人：项目负责人（通过 `PHASE3-MATERIAL-LIBRARY-02` 指令确认执行原则、治理等级和禁止事项）
- 背景：首批内部物料库必须来自真实制造业文件，并保留来源、人工判断和回滚边界；仓库与 `/home` 当前只有已跟踪治理模板/样例，没有可作为真实企业物料的数据文件。
- 决定：任何真实文件先做只读 inspect，再进入既有版本化 Mapping、Normalization、Approval 和 Draft 流程；不得虚构数据、修改原文件、自动建分类/品牌、自动合并或直接生成 `ACTIVE`。分类、单位和品牌使用 `EXACT/MATCHED/NEEDS_REVIEW`；重复使用 `EXACT/HIGH_CONFIDENCE/POSSIBLE`。
- 门禁：`EXACT` 阻断；`HIGH_CONFIDENCE` 必须人工确认且在确认前阻断；`POSSIBLE` 只提示。当前代码已 fail-closed 阻断前两级，但 HIGH_CONFIDENCE 的逐行确认、审计和解除流程尚未实现，因此不能把相关真实行 commit 为 Draft。
- 无数据处理：未发现真实文件时进入 `NO_REAL_DATA_MODE`，只完善和验证导入治理，不把模板或合成测试数据冒充首批物料。任务保持 `BLOCKED`，直到用户提供真实 `.xlsx/.csv` 和隔离上传目录。
- 影响：功能提交 `b3d26c3` 未修改 Schema/Migration；没有连接生产、导入模板、执行真实 dry-run 或创建 Draft。真实文件 Mapping、数据质量报告、人工确认、首批 Draft 和生产动作均需后续继续，其中生产迁移或部署仍需单独明确授权。

## D-026 多供应商导入分离结构识别与规格提取，并以 Canonical Row 进入既有 Normalization

- 日期：2026-07-18
- 状态：ACCEPTED / IMPLEMENTED（NON-PRODUCTION）
- 确认人：项目负责人（通过 `PHASE3-MATERIAL-LIBRARY-SUPPLIER-ADAPTIVE-IMPORT` 明确任务范围、标准中间行和禁止事项）
- 背景：真实供应商文件在 Sheet、表头起始行、多行/合并表头和规格列命名上差异显著；旧实现默认第一个 Sheet、前 10 行单表头及单一 Source，无法解释结构判断，也不能安全组合规格来源。
- 决定：Structure Analysis 与 Specification Extraction 必须独立。结构识别对全部可见 Sheet、前 50 行和 1～3 行表头评分，保存父子列路径、行分类、证据和置信度；Mapping 使用集中别名、样本统计和受控 Supplier Profile，允许一个目标使用多个来源列。规格按独立规格列、多列确定性组合、名称/描述候选的顺序处理；候选和低置信度结果必须人工确认，禁止 AI 静默补造。
- 数据边界：不可变 Raw Row 继续作为原始事实；Canonical Import Row 保存于既有 Normalization payload 和关系化队列列，通过 lineage/hash 引用原始值。非数据行不删除，只在 Normalization 标记 `SKIPPED/REJECTED`；空规格产生 ERROR 并阻断既有 Draft Generation。
- 迁移与恢复：`0008` 只扩展既有 Mapping/Normalization 并新增 Supplier Profile。Down 是有业务数据时拒绝、无数据时恢复旧索引的兼容回退，会保留新增可空列；完整结构恢复依赖迁移前快照。
- 影响：功能提交 `41e293f` 通过全量 Node 589/589、专项、隔离 API、查询计划、凭证和本地 SQLite 基线。受控目录没有真实供应商样本，故真实召回率/误判率、Profile 初始化和真实 dry-run 未验证；未连接生产、迁移、写入真实数据或部署。

## D-027 错标 CSV 后缀的 XLSX 以强内容签名解析，但超宽异常不静默截断

- 日期：2026-07-18
- 状态：ACCEPTED / IMPLEMENTED（NON-PRODUCTION）
- 确认人：项目负责人（通过提供 A118/V700 两份真实文件并要求先行试验，确认真实兼容性验证范围）
- 背景：两份真实附件均以 `.csv` 命名，但强文件签名和 OOXML 结构表明实际为 XLSX；A118 另有 7 行周期性横向重复到 XFD。单纯相信后缀会拒绝正常 XLSX，静默截断 XFD 又会破坏原始数据完整性。
- 决定：仅允许“`.csv` 后缀→强签名 XLSX”的单向兼容，仍执行完整 OOXML/ZIP、宏、加密、路径、压缩比和资源上限校验，并在既有安全事件保存原后缀、检测类型和 warning code。CSV 内容伪装 `.xlsx`、宏、加密或其他类型继续拒绝。
- 超宽边界：256 列上限不变；普通或异常超宽工作簿统一 fail closed，不自动删除、截断或折叠列。只读结构诊断可明确标出异常行，但不能作为成功 Parse/Normalization。
- 影响：功能提交 `cea940a` 同时修正 BOM/变更记录 Sheet 评分、厂商料号限定和“用量”别名；V700 可安全 inspect，A118 返回稳定中文超宽错误。附件和业务正文未提交，生产未连接、迁移或部署。

## D-028 后续交付运行面改为服务器本地应用并固定 18888 端口

- 日期：2026-07-18
- 状态：ACCEPTED / IMPLEMENTED
- 确认人：项目负责人（明确要求后续不再将内容整合到 Site，直接在服务器部署，端口为 `18888`）
- 背景：项目同时保留 `chenyida_erp_app` 本地 Python/SQLite 应用和 `chenyida_erp_site` 在线 Site；后续物料库导入功能需要直接在服务器验证和交付，不再以 Site 作为默认发布面。
- 决定：后续新功能的默认实现和部署目标改为 `chenyida_erp_app`，服务默认监听 `127.0.0.1:18888`；启动脚本、后台脚本、停止脚本和上线健康检查统一使用该端口。`chenyida_erp_site` 保留为历史/参考代码，不再作为本任务后续交付目标。
- 安全边界：本次只切换本地默认端口和项目运行面记录，不自动绑定 `0.0.0.0`、修改防火墙、创建公网入口、迁移数据库或启动生产服务。需要外部访问时另行明确监听地址、反向代理、TLS、认证和防火墙授权。
- 实施结果：`PHASE3-MATERIAL-LIBRARY-EXCEL-COMPAT` 已在本地 Python 运行面接入 CSV/XLSX/XLS、自适应 Sheet/表头/Mapping、不可变 Raw Rows 和本地版本化迁移，并部署到开发 systemd 服务。Site 保留参考，不再是该功能运行依赖。

## D-029 公网验证允许服务器绑定 0.0.0.0:18888

- 日期：2026-07-18
- 状态：ACCEPTED / VALIDATION ONLY
- 确认人：项目负责人（提供公网 IP `43.135.157.211`，并提供 TCP 18888 IPv4/IPv6 入站允许规则截图）
- 决定：为公网访问验证，服务器应用绑定 `0.0.0.0:18888`；通过 `http://43.135.157.211:18888` 检查健康接口和登录页可达性。公网规则仅用于本次验证，不自动配置域名、TLS、反向代理或其他端口。
- 安全边界：保留现有认证、权限、CSRF 和审计；不在响应或日志中输出凭证。公网长期运行前必须更换默认管理员凭证并补充 HTTPS、反向代理、访问控制和备份策略。

## D-030 开发阶段公网服务保持常开并由 systemd 托管

- 日期：2026-07-18
- 状态：ACCEPTED / IMPLEMENTED
- 确认人：项目负责人（明确要求开发阶段保持服务常开，正式投用时再迁移到公司服务器）
- 决定：开发服务器使用 `chenyida-erp.service` 监听 `0.0.0.0:18888`，启用开机自启和失败自动重启；运行代码和 SQLite 数据仍位于 `/opt/erp/chenyida_erp_app`。
- 验证：systemd 状态为 `enabled/active`，本机与 `http://43.135.157.211:18888/api/health` 均返回 HTTP 200，公网登录页返回 HTTP 200。
- 边界：这是开发服务器常驻，不代表正式生产投用；迁移到公司服务器前仍需完成密码轮换、HTTPS、反向代理、备份恢复、访问控制和生产验收。

## D-031 正式供应商 BOM 可先进入待审核队列，缺失语义不得升级为整文件拒绝

- 日期：2026-07-18
- 状态：ACCEPTED / IMPLEMENTED
- 确认人：项目负责人（明确确认 A118/V700 是正确且需要导入库内的表格）
- 背景：真实 BOM 可能没有独立名称或单位列，也可能因 Excel 引用/格式导致工作表声明宽度异常；把这些情况直接判为整文件错误会阻止正确业务数据进入治理流程。
- 决定：只要能识别可信 Sheet、表头和至少一种名称/规格语义，文件可以进入 Import Batch、完整原文件归档、Raw Row 投影和 Cleaning Review。缺独立名称时，明确规格描述只能作为 `SUGGESTED` 名称候选；缺规格、缺单位或候选名称一律 `NEEDS_REVIEW`，禁止自动建档。
- 超宽边界：原文件必须按 SHA 完整归档；结构分析仍限定 256 列，Canonical Mapping 只使用可信表头命中的列。Raw Row 明确是分析窗口投影，不得声称替代超宽原文件。
- 影响：A118/V700 已写入开发服务器清洗审核队列，共 543 行，内部物料数保持不变。下一步需要批次级单位/Mapping 人工确认和逐行异常处置。

## D-032 开发匹配验证使用临时内部编码 1～5，并清空旧清洗结果

- 日期：2026-07-18
- 状态：ACCEPTED / IMPLEMENTED（DEVELOPMENT TEST）
- 确认人：项目负责人（提供更正后的五条电容规格，要求按 1～5 排列并删除现有清洗）
- 决定：只采用最后一次提供的五条规格，依次建立内部编码 1～5；使用 CAP、结构化容量/误差/电压/封装和本地 ERP 电子元件基本单位 PCS。首次含重复项的消息被后续输入替换，不写入数据库。
- 清理边界：删除 `cleaning_rows`，保留 Import Batch、不可变 Raw Rows、原文件归档及既有供应商映射；操作前生成可恢复备份，在单一事务中完成删除、新增和审计。
- 影响：内部物料由 4 条变为 9 条，Cleaning Rows 由 543 条变为 0；五条输入分别自动匹配编码 1～5，置信度 1.00。编号 1～5 仅用于开发验证，不等于正式编码规则。

## D-033 清洗审核按匹配置信度在服务端全局排序

- 日期：2026-07-18
- 状态：ACCEPTED / IMPLEMENTED
- 确认人：项目负责人（要求置信度支持由高到低和由低到高）
- 决定：排序对象为清洗行的匹配 `confidence`，不混用 `specification_confidence`；API 支持 newest/desc/asc，页面明确标为“匹配置信度排序”。
- 稳定性与安全：数据库先排序再应用返回上限，同分按 ID 降序；ORDER BY 只从服务端白名单选择，未知参数回退 newest，不直接拼接用户字段。
- 影响：不改 Schema、Mapping、规格提取和审核状态，只改变清洗列表读取顺序。

## D-034 清空 Cleaning Rows 必须管理员、自动备份、双重确认和审计

- 日期：2026-07-18
- 状态：ACCEPTED / IMPLEMENTED
- 确认人：项目负责人（要求在清洗区域增加清空功能）
- 决定：清空仅删除 `cleaning_rows`；不得级联删除 Import Batch、不可变 Raw Rows、归档原文件、内部物料或供应商映射。
- 保护：仅 `system`/管理员可调用；浏览器确认之外必须提交固定服务端 confirmation。成功操作先创建数据库备份，随后在单一事务中删除并写入操作者、数量和时间。
- 空队列：允许幂等执行并审计 0 行，但页面在空队列时禁用按钮。
- 影响：不改 Schema；部署功能不等于自动执行清空，真实数据只有管理员点击确认后才删除。

## D-035 内部编号必须由唯一规格决定，名称不得改变编号匹配结果

- 日期：2026-07-18
- 状态：ACCEPTED / IMPLEMENTED
- 确认人：项目负责人（明确“不是匹配名称，是匹配规格；同一个物料有不同名字很正常，但是要有编号”）
- 决定：供应商名称只展示和追溯，不进入内部编号相似度评分。编号匹配以容量/阻值、误差、电压、封装、品类及明确 MPN 等结构化规格为准。
- 冲突与歧义：来源已提供字段与候选冲突时立即排除；只有完整规格唯一一致才自动返回内部编号。缺误差等情况导致多个候选同分时必须保持疑似且不返回单一编号，禁止按名称或排序随机选码。
- 等价表达：确定性归一电气单位和符号，例如 0.1uF=100nF、5.0V=5V、+5%=5%；不解释未经 Profile 确认的厂商料号编码语义。
- 新规格：内部库未覆盖的规格保持新物料待审核，必须经现有人工建档流程生成编号，不由导入或 AI 静默创建。

## D-036 供应商规格必须分项提取和逐属性匹配

- 日期：2026-07-18
- 状态：ACCEPTED / IMPLEMENTED
- 确认人：项目负责人（以 1928C 截图明确要求匹配机制不得把规格压成一段，必须逐项匹配）
- 决定：原始规格、型号、描述和 MPN 分别保留为证据；确定性提取品类、封装、容量/阻值、耐压、误差、材质/介质和 MPN 后逐项归一比较，不进行整段规格文字相似度匹配。
- 冲突：来源提供的容量/阻值、封装、耐压或误差任一与候选不一致即排除；材质双方有值时也必须一致。来源材质存在但内部候选未维护时只能疑似，不能自动确认。
- 边界：允许确定性等价写法转换，但不猜解厂商料号中的编码含义，不补造原表没有的规格；不可变 Raw Row 和完整原文件继续保留。
- 迁移：`0003_cleaning_structured_specification` 只扩展现有 Cleaning，旧行不回填、不静默重新匹配，重新导入后生效。

## D-037 人工确认必须同时看到来源与候选的分项规格

- 日期：2026-07-18
- 状态：ACCEPTED / IMPLEMENTED
- 确认人：项目负责人（明确“要把规格写出来，不然人工怎么确认”，并指出厂商型号与通用规格不同）
- 决定：清洗审核必须按同一字段集合展示来源和候选内部物料，至少包含品类、封装、容量/阻值、耐压、误差、介质/材质、型号/MPN 和品牌；未维护值不得隐藏。
- 字段边界：厂商型号/MPN 与通用规格分开；当描述包含多项确定性电气规格时，描述作为 raw spec 来源，型号保存至 raw model。
- 权威边界：浏览器只展示服务端结果和内部物料只读字段，不在前端计算匹配、改变候选编号或执行自动确认。
- 置信度：来源存在介质但候选未维护时保持疑似且置信度不得为 1.0；旧行不回填，重导后生效。

## D-038 详细规格按来源丰富度定位并按类型化参数集合无序匹配

- 日期：2026-07-18
- 状态：ACCEPTED / IMPLEMENTED
- 确认人：项目负责人（明确只要求准确识别详细规格所在位置，并让规格类型的排列顺序不影响物料库相似度）
- 来源决定：Structure/Mapping 与规格内容提取继续分离。在已识别的明确规格、多列组合、描述和物料名称中，以可确定提取的参数类型数和参数数选择更完整来源，并保存完整 raw spec、来源列、置信度和证据；只有型号时不得冒充完整通用规格。
- 匹配决定：来源与候选规格转换为 `kind + normalized value` 集合，品类、封装、容量、阻值、电感值、电流、电压、功率、频率、误差、材质和尺寸按量纲归一后比较，原始参数顺序不参与得分。同类型冲突排除候选，缺项降低置信度，完整且唯一一致才自动匹配。
- 标识边界：MPN/型号和品牌与通用规格是不同语义；它们作为独立证据保存和展示，不进入通用规格相似度，MPN 相同也不能替代缺失规格。已确认供应商料号映射的既有权威规则不变。
- 数据边界：`0004_cleaning_general_spec_tokens` 只扩展既有 Cleaning 证据列，不新建第二套 Import/Normalization；旧 Cleaning 不回填、不重算，Raw Row 和原文件不修改，未识别参数保留在完整 raw spec 中人工复核，AI 不补造。
- 建档边界：人工确认建档时内部物料 `value_spec` 保留完整详细规格，现有 package/voltage/tolerance/material 等列只是附加投影；不得因为内部表暂时没有某种参数的独立列而丢弃已确认规格。

## D-039 规格证据不足时禁止返回候选编号

- 日期：2026-07-19
- 状态：ACCEPTED / IMPLEMENTED
- 确认人：项目负责人（要求已提供的不同规格情况都能准确处理，并消除仍不精准的匹配）
- 决定：物料品类只用于约束候选，不作为足以区分内部编号的鉴别证据。来源少于两类鉴别参数时必须返回“规格不足”、置信度 0 且不返回候选；不得用名称、品类或 MPN 补成高置信度。
- 自动边界：只有来源和内部候选都至少三类鉴别参数、包含一个规格锚点、参数集合完整一致、无同类冲突且候选唯一时，才允许自动匹配。部分一致、候选内部缺项或同分歧义都必须人工审核。
- 精准承诺：已支持语法采用确定性归一和测试夹具保证；未知供应商新语法不承诺静默自动识别，必须保留原文并 fail closed。每个新增真实反例先转成脱敏回归夹具，再扩展 Parser/Matcher，AI 不猜测或补造规格。
- 数据边界：不修改不可变 Raw Row、原文件或既有 Cleaning，不创建第二套导入系统，不增加 Schema/Migration；新规则只在重新导入时生成新证据和匹配结果。

## D-040 以 Node.js、PostgreSQL、本地持久化文件和数据库任务 Worker 作为唯一生产方向

- 日期：2026-07-22
- 状态：ACCEPTED / IMPLEMENTING
- 确认人：项目负责人（通过 `SELFHOST-PHASE0-TASK01` 明确架构与实施范围）
- 背景：现有在线实现绑定 OpenAI Site、Cloudflare Worker、D1、R2 和 Queue，本地 Python/SQLite 运行面也不再适合作为未来生产底座；未来系统部署在用户自有 Linux 服务器。
- 决定：生产方向改为标准 Node.js Web 服务、PostgreSQL、Drizzle PostgreSQL dialect、服务器本地持久化文件目录、PostgreSQL Outbox/任务表与独立常驻 Worker、Docker Compose；反向代理优先 Caddy。Web 与 Worker 共享业务服务，但使用独立启动入口和连接池。业务代码只能通过 Database/Repository、FileStorage、BackgroundJob、Clock/ID 边界访问基础设施。
- 数据边界：新建 PostgreSQL `0001` 基线，不机械改写或冒充执行过的 D1 迁移；旧 SQLite/D1 migration 保留为历史和后续迁移映射来源。所有生产数据迁移必须另立任务，先快照、试迁移、核对和授权。
- 兼容边界：尽量保留 `chenyida_erp_site` 的 React/TypeScript、物料、审批、导入、规范化、权限和审计语义；`chenyida_erp_app` 与 Cloudflare 实现均只作参考，不再并行增加新业务逻辑。
- 运行边界：自托管运行时不得导入 `cloudflare:workers`，不得要求 D1/R2/Queue/Durable Object/Miniflare/OpenAI Site binding。Redis 不进入本阶段；任务并发使用 PostgreSQL 事务、`FOR UPDATE SKIP LOCKED`、租约、心跳、重试和幂等控制。
- 安全与部署：本任务只建立非生产基线，不连接或修改正式数据库，不部署公网，不修改真实服务器，不预置默认管理员密码。生产迁移、部署和切换继续需要单独明确授权。
- 替代关系：本决定替代 D-006 中“在线 D1 为唯一业务数据权威”、D-008 中“Miniflare D1 为长期测试底座”和 D-028/D-030 中“Python/SQLite 为默认交付运行面”的未来生产方向；这些决定继续作为历史运行状态记录，不删除。

## D-041 自托管 Material 采用固定单步审批、PostgreSQL原子编码和职责分离

- 日期：2026-07-23
- 状态：ACCEPTED / IMPLEMENTED IN NON-PRODUCTION
- 确认人：项目负责人（通过 `SELFHOST-PHASE1-TASK01` 明确业务规则、验收标准和禁止范围）
- 状态机：只允许 `DRAFT -> PENDING_REVIEW -> ACTIVE`，驳回只允许 `PENDING_REVIEW -> DRAFT`。ACTIVE 不得由普通草稿接口覆盖，不建立批量激活或自由配置审批引擎，不通过删除历史回退。
- 职责分离：创建人和最后修改人都不得批准或驳回，即使持有管理员通配权限；审核能力必须由服务端检查，页面显隐不能替代授权。驳回理由必填。
- 编码：正式编码只在审核通过的 PostgreSQL 事务中生成，格式为 `CYD-{服务端分类代码}-{六位流水号}`。分类序列表使用原子 upsert/递增，不使用无锁 `MAX()+1`；序号、ACTIVE、版本、变更和审计一起提交或回滚。
- 数据与服务边界：Repository 负责 PostgreSQL锁、事务和持久化；Service 负责状态机、权限、Validation、职责分离、幂等及乐观锁；API 负责 Session、CSRF、请求解析和安全错误。新运行链路不得导入 D1/Miniflare/Cloudflare。
- 兼容范围：复用现有字段、101分类、34属性和 React 页面契约。旧 D1 服务、migration 和测试保留为迁移参照；不双写，不在本决定中迁移真实数据。
- 后续边界：Import Mapping、Mapping版本/复用和行级 Normalizer 不属于本任务；下一任务建议 `SELFHOST-PHASE1-TASK02`，生产迁移与部署继续需要单独明确授权。

## D-042 自托管 Mapping 采用不可变确认快照、结构相容复用和显式重确认

- 日期：2026-07-23
- 状态：ACCEPTED / IMPLEMENTED IN NON-PRODUCTION
- 确认人：项目负责人（通过 `SELFHOST-PHASE1-TASK02` 明确范围、验收标准和禁止事项）
- 快照：Mapping 只有 DRAFT 可编辑；CONFIRMED 保存源结构、标准化源字段、Items、已用目标语义和 metadata/mapping digest 的完整快照。CONFIRMED、STALE、SUPERSEDED 的业务内容和 Items 由 PostgreSQL trigger 禁止修改或删除。
- 版本：同批次新版本只能从当前确认快照显式创建 DRAFT。新内容确认后，旧确认版本变为 SUPERSEDED，但快照内容不变；相同 mapping digest 不得重复确认。
- 复用：跨批次候选必须比较来源类型、Sheet、表头模式、表头顺序和目标兼容性。完全相同为 AUTO_RECOMMEND；全局 metadata 变化但已用目标仍兼容为 RECONFIRM_REQUIRED；已用目标类型、单位、枚举、绑定或约束不兼容时为 STALE。
- 人工边界：复用只把候选复制到当前 DRAFT，永远返回需要重新预览和人工确认；不得静默把目标批次设为 CONFIRMED，也不得改变来源批次或来源版本。
- 稳定标识：动态属性使用 PostgreSQL ACTIVE `attribute_code` 作为稳定 Target code，中文名称只作显示；BASIC、ATTRIBUTE、SPECIAL 使用独立 namespace，供应商料号和原始表头不是内部主键。
- 事务与安全：保存、预览审计、确认、版本创建和复用应用必须通过 Session/权限/CSRF、Idempotency-Key+正文摘要、批次/Mapping 乐观锁；业务变化、Import Event、Audit 和幂等结果同事务提交或整体回滚。
- 后续边界：Mapping 确认不自动启动行级 Normalizer，不创建 Material Draft 或正式物料。Normalizer、真实数据迁移、生产 migration 和部署继续独立授权。

## D-043 自托管 Normalization 采用 run 隔离暂存、关系化证据和原子发布

- 日期：2026-07-23
- 状态：ACCEPTED / IMPLEMENTED IN NON-PRODUCTION
- 确认人：项目负责人（通过 `SELFHOST-PHASE1-TASK03` 明确迁移范围、验收标准和禁止事项）
- 数据边界：每次 Normalization 使用独立 run 和 run version；核心字段候选、动态属性候选、lineage 与 issue 关系化保存，JSON 只作有界兼容快照。动态属性以稳定 `attribute_code` 引用，原始表头、供应商料号和显示名称不得成为内部主键。
- 发布边界：Worker 可以按 100 行 chunk 写入 run 隔离暂存，但普通读取只返回已发布的 `SUCCEEDED`/`SUPERSEDED` run。完成统计、摘要与证据核对后，Job lease/CAS、旧 current supersede、新 run publish、批次 pointer、Event/Audit 和 Job success 必须在同一 PostgreSQL 事务提交或整体回滚。
- 恢复语义：FAILED 重试复用同一 run id 并清理未发布暂存；重跑创建新 run/version，旧已发布历史保持可读；QUEUED 可直接取消，RUNNING/PUBLISHING 通过 `CANCEL_REQUESTED` 在 checkpoint 取消，取消或丢失 lease 的结果不得切换 current。
- 安全与并发：所有写操作执行 Session/权限/CSRF、Idempotency-Key+正文摘要、expected version、行锁和稳定错误；active run 唯一索引、发布条件更新和已发布数据不可变 trigger 防止重复发布或历史改写。
- 兼容边界：复用旧 D1 确定性 Normalizer 行为和现有 Review UI 契约，但自托管运行入口不导入 D1、R2、Cloudflare Queue 或 Miniflare。Mapping 确认仍不自动启动 Normalization。
- 后续边界：本决定不包含人工修改候选、保留/排除、查重处置、ACTIVE 绑定、Material Draft 创建、真实数据迁移、生产 migration 或部署；这些能力继续独立任务和授权。

## D-044 自托管人工复核采用独立覆盖层、精确绑定和行级可恢复 Finalization

- 日期：2026-07-24
- 状态：ACCEPTED / IMPLEMENTED IN NON-PRODUCTION
- 确认人：项目负责人（通过 `SELFHOST-PHASE1-TASK04` 明确完整业务边界、验收标准和禁止事项）
- 数据分层：Parser raw、Mapping确认快照和已发布 Normalization candidates/attributes/lineage/issues 都保持不可变。人工字段/属性覆盖、Issue resolution、行决定和备注进入独立 Review Session/Row/History 关系表；有效值只能按最新 SET/CLEAR/REVERT override 叠加 candidate，不得回退未经 Mapping 的 raw。
- 版本与状态：每个 Review Session 固定一个已发布 run version/result digest 和 mapping id/digest。终态结果不原地改写，修正通过 supersedes 新版本；Session/Row 所有写操作使用 expected version、Idempotency-Key 和服务端状态机。
- Issue：原 Normalization issue 不修改。WARNING 可人工确认；ERROR 可排除，或在对应有效 SET override 存在时标记为覆盖解决。最终处理重验证问题进入独立 validation issue，稳定 key 防止安全重试重复堆积。
- ACTIVE：只能由人工分页搜索并精确选择当前 ACTIVE material ID。Service 选择时和 Worker 最终事务都重查状态；binding 只保存真实 ID 和安全显示快照，不修改 ACTIVE，不提供自动匹配、模糊查重或 AI 推荐。
- Draft：只有人工明确选择 CREATE_DRAFT 并最终提交后，Worker 才能调用 TASK01 Material Workflow Service 创建未编码 DRAFT。不得从 Review Repository 直接写物料表，不自动 submit/approve，不分配正式编码。
- Finalization：Web 事务创建 sealed finalization/Outbox；Worker 以 100 行准备、50 行处理的有界 chunk 执行。每一行的 lease 校验、material side effect、link/history/result 在同一事务，全部成功才 FINALIZED；部分失败如实进入 FINALIZE_FAILED，稳定 operation/binding/draft key 防止重试重复副作用。
- 运行边界：自托管模块不得依赖 D1、R2、Cloudflare Queue 或 Miniflare。真实数据迁移、生产 migration、备份恢复、容量验收和部署继续需要独立任务与授权。

## D-045 自托管身份采用服务端固定角色、强制改密、可撤销会话和持久安全控制

- 日期：2026-07-24
- 状态：ACCEPTED / IMPLEMENTED IN NON-PRODUCTION
- 确认人：项目负责人（通过 `SELFHOST-PHASE2-TASK02` 固定业务与安全决定、范围和禁止事项）
- 角色与权限：角色 code 固定为 `admin`、`manager`、`purchase`、`engineering`、`production`、`warehouse`、`quality`、`sales`、`finance`、`operations`；permissions 只由服务端映射。只有 admin 可管理用户、重置他人密码和读取系统审计；用户名创建后不可修改，不提供删除或角色修改。
- 密码：12—128 位，四类字符至少三类，拒绝完整用户名、项目默认口令、常见弱口令和新旧相同；只保存 PBKDF2-SHA256、310,000 次迭代的强哈希并常量时间比较。新建及重置使用管理员输入且不回显/记录的一次性临时密码，目标用户必须改密。
- 用户与并发：创建默认为 active、must-change、version 1；本人改密、启停和重置使用 expected version。禁止自停用、自重置和停用最后一个 active admin；PostgreSQL 行锁、CAS 和事务级 advisory lock 保证并发下至少保留一个 active admin。
- 会话与门禁：session token 只保存 SHA-256 摘要；停用/重置撤销目标全部会话，本人改密撤销其他会话并保留当前会话。must-change 只允许 session、logout 和本人改密，所有其他自托管受保护 API 统一拒绝。生产环境 Cookie 不受内部 HTTP URL 影响，Session/CSRF 均强制 Secure、SameSite=Lax，Session 另为 HttpOnly。
- 限流与幂等：登录按标准化 username digest 每 15 分钟最多 5 次失败；身份写按 actor 每分钟最多 60 次尝试、20 个新 Key。四个身份 POST 要求 CSRF、Idempotency-Key、canonical body digest；scope 至少包含 actor/method/route/target/key digest，同请求重放、异正文冲突。
- 审计与数据：记录 actor/action/target/result/request/operation/version/error/time，不记录密码、Token、Cookie、hash 或请求正文。系统审计只允许 admin，默认 20、最大 100 并支持有界筛选。PostgreSQL `0006` 仅 expand-only 增加必要撤销、限流、约束和索引，不迁移真实用户，不修改 `0001`—`0005`。
- 范围：本决定不授权客户、供应商、BOM、库存、采购、生产、销售、品质、财务、Dashboard、备份、真实数据迁移、生产 migration 或部署。

## D-046 自托管主数据采用稳定内部 ID、不可变发布版本和结构化 BOM readiness

- 日期：2026-07-25
- 状态：ACCEPTED / IMPLEMENTED IN NON-PRODUCTION
- 确认人：项目负责人（通过 `SELFHOST-PHASE2-TASK03` 连续任务指令明确范围、最低边界与禁止事项）
- 主体与编码：Customer、Supplier、Product、BOM 都以 PostgreSQL bigint 内部 ID 建立关系，code 由并发安全序列生成或按有界格式显式提供；名称、供应商料号、客户料号只作属性或映射，不作为关系主键或 upsert 命中键。
- 版本：Product 与 BOM 使用 Header/Version；只有 DRAFT 可编辑，RELEASED 版本及其 BOM Lines 由数据库 trigger 禁止修改或删除，修正必须创建新版本。BOM 发布事务重查 Product Version、Material ACTIVE、Unit enabled 与至少一条有效 Line。
- Supplier Mapping：新映射必须关联 ACTIVE Supplier、ACTIVE Material 与 enabled Unit；ACTIVE 有效期不得重叠，状态变化使用 expected version，价格历史只追加。旧无 Supplier FK 的 mapping 只保留作迁移来源，不由新 API 返回或静默补造。
- readiness：TASK04 前只允许计算 BOM 结构与 required quantity，必须返回 `inventory_evaluated=false`、`all_ready=false`，不得读取库存占位表或伪造齐套。`/api/items` 只投影 ACTIVE Material。

## D-047 自托管库存以不可变 Ledger 为权威并采用受控余额投影

- 日期：2026-07-25
- 状态：ACCEPTED / IMPLEMENTED IN NON-PRODUCTION
- 确认人：项目负责人（通过 `SELFHOST-PHASE2-TASK04` 连续任务指令明确最低边界、不可变账本与冲销要求）
- 权威与兼容：`inventory_ledger_entries` 是新库存数量权威，`inventory_stock_balances` 是服务事务维护且可按 Ledger 核对的投影；`0001` 文本 `item_code` 库存表只保留为迁移证据，不回填、双写或由新 API 返回。
- V1 边界：仅 `MAIN` 逻辑库位、空 lot、Material 基础单位；只允许 ACTIVE/STOCKED Material。暂不支持批次、序列号、多库位、单位换算和 reservation 写入。
- 数量规则：六位小数；on-hand、reserved、frozen 均非负，且 on-hand 不得小于 reserved+frozen。出库、冻结和冲销都重新验证当前余额，禁止为了恢复历史而产生负库存或负可用量。
- 并发与更正：每条请求携带 expected balance version，多余额按稳定键顺序锁定；业务、Ledger、余额、审计和幂等结果单事务。已过账 Header/Line/Ledger 由数据库禁止修改/删除；原操作最多一次全额冲销，冲销本身不可再冲销。
- 跨域：TASK05—TASK07 的收货、领退料、完工和发货必须复用该库存服务边界，不得复制余额 SQL；TASK04 的通用 RECEIPT/ISSUE 不是这些业务单据，也不创建 PO/WO/SO 或财务来源。
- 安全与事务：sales 管 Customer，purchase 管 Supplier/Mapping，engineering 管 Product/BOM；权限由服务端固定 capability 判断。写操作执行 Session/must-change、CSRF、正文上限、限流、24小时幂等、expected version/锁、请求编号，业务、审计和幂等结果同事务提交或整体回滚。
- 范围：本决定不实现或授权库存、采购、生产、销售、品质、财务、真实主数据迁移、生产 migration、备份恢复、部署或切换。

## D-048 自托管采购采用直接 OPEN、不可变收货和库存原子联动

- 日期：2026-07-25
- 状态：ACCEPTED / IMPLEMENTED IN NON-PRODUCTION
- 确认人：项目负责人（通过 `SELFHOST-PHASE2-TASK05` 连续任务指令批准范围、收货原子性、冲销与安全边界）
- PO 状态：TASK05 不引入未获批的采购审批流；PO 直接 `OPEN`，服务端投影 `PARTIALLY_RECEIVED`、`RECEIVED`，全部收货后可显式 `CLOSED`。仅未收货 OPEN Header 可用 `expected_version` 修改交期和备注；Line 与供应商/币种/数量/价格不可原地修改或删除。
- 建议与引用：缺料建议只消费 RELEASED 当前 BOM、TASK04 可用库存及 ACTIVE/有效 Supplier、Material、Unit、Mapping 和价格；缺失引用返回 BLOCKED。建议本身无写副作用，只有显式写请求才能按 Supplier/Currency 分组创建 PO。
- 收货事务：Receipt/Lines、PO Line/Header 投影、TASK04 Ledger/Balance、状态事件、财务来源、审计和幂等结果必须在一个 PostgreSQL 事务完成；Inventory Service 接收既有事务客户端且不自行 commit。并发版本或任何子步骤失败整体回滚。
- 更正：已过账 Receipt 不修改、不删除，只允许一次全额冲销；追加 reversal Receipt/Lines、库存反向流水和负财务来源，并恢复未关闭 PO 的可收投影。部分冲销、超收和库存不能安全反向时一律 fail closed。
- 财务边界：TASK05 只追加 TASK09 可追踪的采购金额来源，不创建应付、发票、付款、结算或总账；不写 legacy `erp_records`，不迁移真实 PO/在途/库存。

## D-049 自托管生产以 Release BOM 快照、受限净领料和库存原子联动为权威

- 日期：2026-07-25
- 状态：ACCEPTED / IMPLEMENTED IN NON-PRODUCTION
- 确认人：项目负责人（通过 `SELFHOST-PHASE2-TASK06` 连续任务指令批准范围、最低状态机、decimal 算法和库存事务边界）
- 工单与状态：编码由事务内 `business_code_sequences` 分配；固定 `DRAFT -> RELEASED -> IN_PROGRESS -> COMPLETED -> CLOSED`，满足无过账事实条件时可取消。RELEASED 后计划产品、数量和 BOM 快照不可原地修改，终态不可逆。
- 快照与精度：RELEASE 只接受 RELEASED Product/BOM Version，并在同一事务复制不可变快照。需求使用 PostgreSQL `numeric(24,6)` 计算 `round(plan_qty * quantity_per * (1 + loss_rate), 6)`，按 PostgreSQL numeric 半离零舍入；后续 BOM 版本不改变既有工单。
- 引用限制：BOM Material 与成品 Material 必须为 ACTIVE/STOCKED 且使用 enabled 基础单位；客户专用 Material 必须与产品 Customer 一致，无法证明时 fail closed。成品必须显式引用既有稳定 Material，不按 Product code 自动创建或激活。
- 领退料与完工：净领料不得超过快照需求，退料不得超过该工单净领料，完工不得超过计划剩余量。领料出原料、退料反向入库、完工入成品且不重复扣原料；全部调用 TASK04 Inventory Service 事务入口，Production、Ledger/Balance、状态、审计和幂等共同提交或回滚。
- 报工与更正：报工只追加，reported 必须大于零，good/scrap 非负且合计不超过 reported；TASK06 不把报工解释为品质判定。快照、状态事件、领退料、报工和完工事实不可更新/删除；复杂更正流程留待独立批准。
- 首期边界：只使用 MAIN/空 lot/基础单位；不实现 WIP、多库位、批次/序列、单位换算、自动替代、MRP/排程、工时成本、品质过账、财务过账或真实生产数据迁移。

## D-050 自托管销售采用报价版本、原子转单和不可变发货/冲销

- 日期：2026-07-25
- 状态：ACCEPTED / IMPLEMENTED IN NON-PRODUCTION
- 确认人：项目负责人（通过 `SELFHOST-PHASE2-TASK07` 连续任务指令批准范围、原子转单/发货、金额和禁止事项）
- 报价：Quote 使用 Header/Version/Line，只有 DRAFT 当前版本内容可替换；发布、接受、拒绝、过期、取消、转换追加状态事件。只有 ACCEPTED 当前版本可转换，Header/Version 转为 CONVERTED 且唯一 Quote→SO Link 保证最多一个订单。
- 订单：转换和直接创建都生成 OPEN、不可变 SO Version/Lines；不引入未批准的销售审批。发货服务端投影 `OPEN -> PARTIALLY_SHIPPED -> SHIPPED`，全部发货后才能显式关闭；未发货 OPEN 可取消。
- 引用与金额：Line 必须引用匹配客户的 Product/RELEASED Product Version、既有 ACTIVE/STOCKED 成品 Material 和 enabled 基础 Unit；客户专用限制不匹配时 fail closed。货币固定 CNY，数量/单价/行金额/总额由 PostgreSQL `numeric(24,6)` 计算，不接受客户端总额；首期不支持税、折扣或汇率。
- 发货事务：Shipment 锁定 SO Header/Lines 和 TASK04 Balance expected version，禁止超发和负库存；Shipment/Lines、SO 投影、Ledger/Balance、状态事件、销售金额来源、审计和幂等必须在一个 PostgreSQL 事务提交或整体回滚。
- 更正：已过账 Shipment/Lines/Financial Source 不修改、不删除；首期每张原发货单只允许一次全额冲销，追加 reversal Shipment/Lines、反向库存和负金额来源，并恢复未关闭 SO 投影。部分冲销、退货/换货另立任务。
- 下游边界：销售金额来源只供 TASK09 读取，不创建应收、收款或总账；TASK08 前不创建或伪造 FQC/hold/release。真实销售数据迁移、生产 migration、部署和发货品质阻断继续需要独立授权。

## D-051 自托管品质使用稳定来源、异人处置和可消费 FQC 放行额度

- 日期：2026-07-25
- 状态：ACCEPTED / IMPLEMENTED IN NON-PRODUCTION
- 确认人：项目负责人（通过 `SELFHOST-PHASE2-TASK08` 连续任务指令批准 IQC/IPQC/FQC、缺陷、处置、关闭及跨域受控关系范围）
- 来源边界：IQC 只绑定已过账 Purchase Receipt Line，IPQC 只绑定 Production Report，FQC 同时绑定 Production Completion Line 与 Sales Order Line；Material/Unit 必须一致。名称、编码、`ref_type/ref_id` 和 legacy JSON 不作为业务关系，也不自动回填旧品质数据。
- 事实与状态：Inspection 来源和数量、Result、Defect、Event 是不可变事实；Header lifecycle/decision/released quantity/version 仅为 Quality Service 事务维护的受控投影。新检验总是 `OPEN/PENDING`，全合格也不自动放行。
- 职责分离：检验创建人与最终处置人必须不同；`RELEASE` 最多放行 passed quantity，`CONCESSION` 最多放行 inspected quantity，`REWORK`/`RETURN_TO_SUPPLIER`/`SCRAP` 保持 HOLD。处置后才能关闭，只有 manager/admin 可重开。
- FQC 门禁：Shipment 在原 Sales/Inventory 事务和锁顺序内消费已 `CLOSED/RELEASED` 的 FQC 额度；累计有效发货不得超过累计有效放行。发货冲销恢复额度；仍被有效发货消费的放行不得降低或重开。
- IQC/IPQC 边界：当前库存只有 MAIN/空 lot 的池化余额，不能证明某 Receipt Line 的剩余量；因此 IQC 不执行全局 freeze 或声称批次隔离，IPQC 也不改写工单/报工。批次、隔离库位、AQL/SPC、自动退供/报废和返工工艺另立任务。
- 过账保护：品质流程不得原地修改 Receipt、Production Report/Completion、Shipment、库存 Ledger 或金额来源；所有关键写与 Event、Audit、Idempotency 同一 PostgreSQL 事务提交或回滚。

## D-052 自托管财务只消费稳定金额来源并以不可变收付款/冲销维护余额

- 日期：2026-07-25
- 状态：ACCEPTED / IMPLEMENTED IN NON-PRODUCTION
- 确认人：项目负责人（通过 `SELFHOST-PHASE2-TASK09` 连续任务指令批准应收应付、收付款、余额与冲销范围）
- 过账来源：AR 只能绑定未冲销的正向 `sales_financial_source_entries` Shipment 来源，AP 只能绑定未冲销的正向 `purchase_financial_source_entries` Receipt 来源；单来源最多一张 Document。SO/PO Header、显示名称和浏览器总额不是财务权威。
- 金额与往来单位：Document 的 Customer/Supplier、currency 和 total amount 原样继承稳定来源，使用 PostgreSQL `numeric(24,6)`；TASK09 不换汇，不接受浏览器覆盖金额、币种、往来单位、操作人或收付款类型。
- 事实与投影：Receipt、Payment、Reversal 和 Document Event 只追加且不可修改/删除；Document 来源/金额等头事实不可修改，settled amount、status 和 version 是 Finance Service 在同一事务维护的可核对投影。
- 结算与更正：首期每笔 Settlement 只核销一张 Document，不得超过未结余额。原正向 Settlement 最多一次全额冲销，追加同 Document 的等额负事实；冲销事实不得再次冲销，已过账事实不得原地更正。
- 跨域保护：一旦 Shipment/Receipt 来源形成财务 Document，上游 Sales/Procurement 不得直接追加会令来源失效的冲销；来源冲销与财务 Document 必须保持单一事务可证明的一致性，无法证明时 fail closed。
- 权限与安全：admin/manager/finance 可过账、结算和冲销；sales 只读 AR，purchase 只读 AP，operations/warehouse 只读两类，其他角色无财务业务可见记录。所有写操作执行 Session/must-change、CSRF、正文上限、24h 幂等、限流、expected version、请求编号、中文安全错误和事务审计。
- 首期边界：不实现银行/支付网关、税务、发票、外币/汇率、信用、会计期间关闭、总账、自动过账、多单核销或付款审批；不迁真实金额，不执行生产 migration、部署或切换。

## D-053 自托管看板使用实时权威查询，备份恢复保持离线且根页退出 iframe

- 日期：2026-07-25
- 状态：ACCEPTED / IMPLEMENTED IN NON-PRODUCTION
- 确认人：项目负责人（通过连续任务指令批准 TASK10 的经营看板、备份恢复治理和 legacy iframe 退出范围）
- 看板权威：`/api/summary` 与 `/api/management-dashboard` 只读聚合 TASK02—TASK09 关系表，不读取 `erp_records`、旧文本库存表或浏览器合计，不复制业务事实。金额/数量使用 PostgreSQL numeric 文本；不同单位库存不求和。首期不建 projection/outbox，因此不新增 migration。
- 披露：全部固定业务角色保留 `dashboard.read`；指标合同由服务端固定。最近系统审计仍要求 `system.audit.read`。备份治理状态只允许 admin 的 `system.backup.read`，且不返回数据库 URL、凭证、绝对路径或制品正文。
- 备份与恢复：浏览器不提供 create/restore；备份、checksum、manifest、校验和恢复全部由离线脚本/运维流程执行。恢复只允许新空数据库和空 uploads/attachments，校验后仍须离线验收才能开放流量；禁止覆盖当前数据库或将“校验通过”冒充“恢复演练通过”。
- UI：根 `app/page.tsx` 改为原生会话与经营工作台，不再创建 iframe 或登录即并发加载 legacy 全页面。`public/erp/` 保留为显式业务工作区和回滚证据，使用白名单 tab 深链；本任务不删除 legacy 源码，也不声称所有业务页面已重写为原生 React。
- 生产边界：不迁真实数据，不执行生产备份/恢复、部署或切流，不访问生产，不删除 Python/SQLite 或历史 Sites/D1 证据。

## D-054 生产前迁移先建立合成 staging 证据，不直接写真实业务数据

- 日期：2026-07-25
- 状态：`ACCEPTED FOR SYNTHETIC READINESS`
- 决定：迁移只能由显式离线 CLI 启动；环境守卫必须先于 source read/target connect。SQLite 与 D1 export 先形成确定 fingerprint、manifest、mapping plan 和稳定 ID，checkpoint 绑定全部输入摘要。
- staging：本阶段 synthetic commit 只写新空测试 PostgreSQL 的独立 `migration_tool` schema，ID map/checkpoint 不成为生产业务表；dry-run 必须保持目标零写入，COMMITTED 后未 Reconcile 不能算完成。
- 不变量：不按名称猜关系、不迁旧 session/弱未知密码 hash、不把余额伪装成历史流水、不伪造 Receipt/Shipment 创建 Finance opening；无来源期初记为 `MODEL_GAP`，不修改 `0013` 或顺手新增 `0014`。
- 生产边界：合成 PASS 不能转换为真实数据或生产批准。真实 source inventory、业务表物化、Dashboard 明细核对、文件迁移、容量和生产恢复必须另立任务并获得明确授权。

## D-055 迁移期初使用独立关系来源并复用库存/财务权威事实模型

- 日期：2026-07-25
- 状态：`ACCEPTED / IMPLEMENTED IN SYNTHETIC NON-PRODUCTION MODEL`
- 确认人：项目负责人（通过 `SELFHOST-PHASE3-TASK02` 指令批准 MG-001/MG-002 范围、安全边界与合成验收）
- 来源：期初必须绑定 manifest、source record、mapping 和 target digest；正式表只保存稳定 ID 与去正文摘要，不保存真实路径、原业务正文或 staging JSON。相同稳定来源只能物化一次，摘要变化 fail closed。
- 库存：余额型期初显式写 `MIGRATION_OPENING` Adjustment、不可变 Ledger 和同事务 Balance，不伪造收货/完工/退货。只支持 ACTIVE/STOCKED Material、enabled Base Unit、MAIN/空 lot、六位精度和 `0 <= frozen <= on-hand`。
- 财务：无 Shipment/Receipt 的历史往来使用 `OPENING_AR`/`OPENING_AP`，Customer/Supplier 严格互斥，首期固定 CNY、正数六位金额。它可复用既有单据核销，但不得伪造业务来源。
- 更正：原期初事实不更新、不删除；只允许追加一次全额冲销。库存余额已被下游消费或财务仍存在有效结算时拒绝冲销；所有事实、投影、Event、审计和幂等结果同事务提交或回滚。
- 调用边界：不新增 HTTP 写路由，不授予普通 admin migration capability；只允许测试迁移 CLI 在回环 `_migration_test` 新空目标中调用内部 Service，数据库 GUC/trigger 拒绝直接 SQL 绕过。
- 生产边界：本决定只解决合成非生产模型，不批准真实数据读取、真实试迁移、生产 migration、部署或切换；生产状态保持 `NO-GO FOR REAL DATA / PRODUCTION`。

## D-056 合成 cutover snapshot 只物化静态/期初事实，历史活动保持 archive-only

- 日期：2026-07-25
- 状态：`ACCEPTED / IMPLEMENTED FOR SYNTHETIC PUBLIC MATERIALIZATION`
- 确认人：项目负责人（通过 `SELFHOST-PHASE3-TASK03` 指令批准 public materialization、post-cutover journey、Dashboard 和恢复验收边界）
- 模式分离：Identity、Reference、Material、Party、Product/BOM、Mapping、Inventory/Finance Opening、File 和 provenance 属于 cutover snapshot；采购、生产、销售、品质和稳定来源财务活动在无法证明逐单历史回放不会重复余额时必须标记 `ARCHIVE_ONLY`。
- 写入边界：public materializer 仅由显式测试 CLI 调用，不暴露 HTTP/浏览器入口；新空目标或同 manifest/run/input digest 的恢复目标才可写。每个聚合在独立事务提交业务记录、actual target ID/digest 和审计，上游失败停止下游。
- 稳定引用：所有关系使用来源 stable key 对应的 actual public ID，不按名称合并。target 缺失、source/mapping/plan/checkpoint/target digest 变化、code/有效期/单位冲突和文件 mismatch 均 fail closed；不写 `erp_records`。
- Post-cutover：PO/Receipt、WO/领退料/报工/完工、Quote/SO/Shipment、IQC/IPQC/FQC 和 AR/AP/Settlement/Reversal 只能通过正常领域 Service/API 创建，用于证明 cutover 后业务链路，不冒充历史数据迁移。
- 生产边界：`PASS FOR SYNTHETIC PUBLIC-TABLE MATERIALIZATION` 只表示完全合成 public 业务表、Dashboard 和恢复证据通过；真实 source inventory、逐行处置、容量、安全、生产恢复、部署与切换仍需独立任务和授权，保持 `NO-GO FOR REAL DATA / PRODUCTION`。

## D-057 真实 SQLite 盘点使用一致性临时快照和不可关联脱敏引用

- 日期：2026-07-25
- 状态：`ACCEPTED / EXECUTED FOR LOCAL READONLY INVENTORY`
- 确认人：项目负责人（通过 `SELFHOST-PHASE3-TASK04` 指令精确授权本机源、online backup、聚合读取和禁止事项）
- 源边界：只允许经 `realpath`/`lstat` 和 systemd/Python 配置一致性确认的唯一本机 SQLite；不读替代路径、backup、D1 export、附件、上传、归档或远程 URL。
- 快照边界：运行中源库使用 `mode=ro`/`query_only` 与 SQLite online backup；所有长时盘点只在仓库外、权限收紧、SHA/manifest 绑定的临时快照上执行，最终删除。
- 脱敏边界：只保留 Schema 摘要、聚合计数、固定枚举分布和数量/金额总量；不对自由文本做 DISTINCT。行级问题使用不保存 key 的 task-local HMAC opaque reference，不保存源 ID 或原始输入。
- 工具边界：`REAL_READONLY_INVENTORY` 要求显式参数并严格禁止 target URL、materialize、files、staging/public/Opening 写入和 Web/API 调用；不削弱 synthetic/production 守卫。
- 生产边界：`REAL LOCAL SQLITE READONLY INVENTORY COMPLETE` 只证明本机源脱敏盘点完成；不批准 PostgreSQL 试迁移、生产数据物化、D1/文件盘点、部署或切换。

## D-058 第一阶段从市场到项目使用稳定项目与不可变需求交接

- 日期：2026-07-25
- 状态：`ACCEPTED / IMPLEMENTED FOR PARALLEL ACCEPTANCE`
- 确认人：项目负责人（通过 `SELFHOST-PHASE4-TASK01` 指令确认部门主线与十一项固定业务决定）
- 角色：现有 `sales` 对应市场部门，`engineering` 对应项目部门；不新增角色，计划员留待后续任务。
- 标识：项目使用稳定内部 ID 和独立 `PRJ-########` 编号；客户名称、客户/供应商料号、订单号均不能作项目主键。
- 版本与事件：提交后的需求正文不可覆盖，修订必须新增不可变 Requirement Version；SUBMITTED、RETURNED、RESUBMITTED、ACCEPTED 是不可变 Handoff Event，并伴随 request_id 和系统审计。
- 职责与事务：市场仅维护本人草稿/退回项目，项目人员接收或填写原因退回；提交人不得接收自己的交接。写入在同一事务执行投影、版本/事件、Audit 和 Idempotency，并使用 expected_version/CAS。
- 文件：仅引用既有受控文件 ID 与安全摘要元数据，项目表/API 不保存或返回正文、相对/绝对路径或无约束 JSON。
- 下游边界：接收只形成稳定项目记录，不自动创建 Product、BOM、销售订单、计划、采购、工单、生产、品质、完工、发货或财务记录。
- 生产边界：TASK01 只在回环并行验收环境交付，不批准真实数据迁移、生产上线、HTTPS、公网或切流。

## D-059 项目到计划采用显式解析与不可变版本交接包

- 日期：2026-07-25
- 状态：`ACCEPTED / IMPLEMENTED / PARALLEL ACCEPTED`
- 确认人：项目负责人（通过 `SELFHOST-PHASE4-TASK02` 指令确认十二项固定业务决定）
- 角色：新增正式 `planning`；engineering 负责准备/提交，planning 只读/接收/退回，production 不代替 planning，manager/admin 具备全能力。
- 前置与引用：只有 TASK01 已接收且操作者为项目负责人的 Project 可准备；每条 Requirement Item 必须显式关联稳定、客户一致的 RELEASED Product Version 及其 RELEASED BOM Version，不按名称猜测。
- BOM 门禁：BOM 必须属于 Product Version，全部行引用 ACTIVE Material 和 enabled Unit；客户关系或专用料范围无法证明时 fail closed。
- 包与版本：DRAFT 生成时用 PostgreSQL numeric 固化需求、BOM、Material 安全规格和受控文件元数据 digest；提交后内容不可变，退回后创建新包版本，不覆盖旧包。
- 状态与职责：planning 只能接收或填写原因退回，不能改 BOM、创建物料需求/采购/生产单据；并发接收仅一次成功，接收不自动启动 TASK03。
- TASK01 保护：`project_handoffs`、`project_handoff_events` 及既有 Requirement Version 事实不扩写、不覆盖；Project→Planning 使用独立六表模型。
- 生产边界：仅授权回环并行验收环境；不批准真实数据迁移、生产上线、HTTPS、公网、切流或 TASK03。
- 验收结果：`0.1.0-alpha.16`/`0016` 已完成真实会话退回→新包 v2→重提→接收、Compose 重启和恢复点清理；最终只保留 Schema/唯一管理员，结论 `PROJECT TO PLANNING HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`。

## D-060 计划物料需求使用提交时重算与独立 Planning Allocation

- 日期：2026-07-26
- 状态：`ACCEPTED / IMPLEMENTED / PARALLEL ACCEPTED`
- 确认人：项目负责人（通过 `SELFHOST-PHASE4-TASK03` 指令确认角色、数量公式、锁与重算、不可变计划、采购申请和任务排除边界）
- 来源：只能使用项目最新 `ACCEPTED` Planning Package；`Material + Unit` 与 gross quantity 只读取固化快照并聚合，不重读或展开当前 BOM。需求日期是计划版本稳定字段。
- 数量：gross、库存可用、有效在途、库存/在途分配和净采购统一由 PostgreSQL `numeric(24,6)` 计算与约束，Node/浏览器只传递 decimal 字符串，不以 JavaScript 浮点数决定结果。
- 并发：DRAFT 只保存预览且不占用来源；SUBMIT 在单一事务中锁定计划、Package、物料分配键、Inventory 同源键及采购在途表，重新核算并比较 Package/余额/PO/Allocation 摘要。任何变化均以稳定冲突要求重新生成，不静默改写预览。
- 分配：Planning Allocation 与 Inventory `reserved_qty` 分离；只有 `SUBMITTED/ACCEPTED` 计划的分配参与其他计划扣减。采购退回把计划投影置为 `RETURNED`，历史分配保持不可变但不再有效，计划部只能创建新版本重算。
- 申请：净采购大于零的计划行一对一进入不可变 `PRQ-########` 采购申请；净采购全为零时保存已提交需求计划但不创建空申请。采购只接收或填写原因退回，接收不自动创建 RFQ、报价、供应商选择、比价、PO 或收货。
- 角色：planning 生成/重新生成/提交；purchase 接收/退回；manager/admin 全能力。服务端权限、CSRF、持久幂等、版本冲突、数据库 trigger、事件与审计共同 fail closed。
- 生产边界：只授权回环并行验收环境；不迁移真实数据，不执行生产 migration/部署/切流，不进入生产、品质、财务或真实采购执行。
- 验收结果：`0.1.0-alpha.17`/`0017` 已完成 `100.000000 - 55.000000 - 40.000000 = 5.000000` 的真实 HTTP 退回→修订重提→最终接收旅程、Compose 重启和恢复清理；正式 `reserved_qty` 不变，未新增 PO/收货/工单，最终只保留 Schema/唯一管理员。

## D-061 采购询比价采用不可变报价版本、确定性比较与人工定标

- 日期：2026-07-26
- 状态：`ACCEPTED / IMPLEMENTED / PARALLEL ACCEPTED`
- 确认人：项目负责人（通过 `SELFHOST-PHASE4-TASK04` 指令确认来源、角色、口径、比较、理由、不可变和下游排除边界）
- 来源与供应商：只有最新 `ACCEPTED` 采购申请可建立 RFQ；候选必须 ACTIVE，且每家候选对每条物料都有当前有效 1:1 Supplier Mapping。发出后范围不可改，重新询价追加新 Round。
- 报价：采购人员代录 Supplier 报价，固定 CNY 和当前 Unit，保存有效期、MOQ、单价、交期、税/运费及条款；当前报价唯一，改价使用新版本，旧版本保持 `SUPERSEDED`。
- 比较：服务端 PostgreSQL 按 RFQ Line 和 Currency/Unit/Tax/Freight 口径分组，以 numeric 单价、交期、Supplier ID 确定性排序；过期报价不排名。比较只保存事实，不产生推荐审批，浏览器不得重算。
- 定标：每行一个 Supplier，必须引用当前未过期报价和最新比较。单一有效报价使用 `SOLE_SOURCE`；非最低价、晚交期 `LATE_DELIVERY_ACCEPTED`、超申请数量分别留存显式理由。Award 不可修改/删除，只能撤销并新建 Round。
- 权限与事务：purchase 负责 RFQ/报价/比较/定标，planning 仅进度只读，manager/admin 全部；写操作执行 CSRF、幂等、CAS、锁、数据库约束，并在同事务保存业务、不可变 Event、Audit 和 Idempotency。
- 下游边界：Sourcing Award 不自动创建 PO、Receipt、Inventory、AP 或生产事实，不修改 TASK03 Planning Allocation 和 `reserved_qty`。后续 TASK05 必须独立授权。
- 验收结果：回环并行环境中 A 报价 `12.000000`、准时、排名 2，B 报价 `10.000000`、晚交、排名 1；采购以 `DELIVERY_PRIORITY` 和“交期优先，避免项目延期”人工选择 A。Award=1 时 PO/Receipt/Inventory Ledger/Finance/Planning Allocation 均为 0，`reserved_qty` 不变；重启持久和整体恢复清理通过。
- 生产边界：只批准回环并行验收；不迁真实数据，不执行生产 migration/部署、HTTPS、公网或切流。TASK05 仅记录，不自动启动。

## D-062 定标转单、到货计划、分批收货与应付采用显式分权交接

- 日期：2026-07-26
- 状态：`ACCEPTED / IMPLEMENTED / PARALLEL ACCEPTED`
- 确认人：项目负责人（通过 `SELFHOST-PHASE4-TASK05` 指令确认）
- 决定：Award 不自动建 PO；purchase 显式转单并按 Supplier/Currency 分组，Award Line 只允许转换一次。每个来源 PO Line 建唯一到货计划和待入库投影；warehouse 可分批收货但不得超收；每批 Receipt 原子形成 Ledger/Balance 与独立采购金额来源；finance 显式且仅一次消费来源生成 AP。
- 完整性：Award/Quote/Material/Quantity/Unit/Currency/Price/Promise 必须一致；所有写操作要求服务端权限、CSRF、持久幂等、CAS、锁、事件和 Audit。已过账 Receipt 不原地改写，已有 AP 时拒绝破坏来源链的冲销。
- 复用：PO/Receipt/Inventory/Financial Source/Finance Document 继续由既有服务和权威表负责，`0019` 只保存 Award→PO、Delivery Plan/Queue、Receipt Allocation 和事件关系。
- 边界：不实现付款、银行、总账、税票、工单、领料、报工、完工或 IQC/IPQC/FQC；不迁真实数据、不部署生产、不切流，不自动启动 TASK06。
- 验收：并行 HTTP 以 `10×12`、收货 `4/6`、来源/AP `48/72` 完成，重启持久、备份/新空恢复和最终清理通过。

## D-063 计划到生产采用版本化交接、释放时齐套预留与基于预留的领退料

- 日期：2026-07-26
- 状态：`ACCEPTED / IMPLEMENTED / PARALLEL ACCEPTED`
- 确认人：项目负责人（明确授权“继续生产线”，并限定只完成计划交接、工单、释放、预留和领退料）
- 来源：只能消费项目当前最新、状态为 `ACCEPTED` 且 version/package digest 不变的 Planning Package。交接版本固化 Package Item、Product Version、BOM Version、成品 Material、Unit、数量与 SHA-256；浏览器不得覆盖 Package 来源字段。
- 成品物料：既有 Planning Package 未保存成品 Material 关系，因此 planning 在 DRAFT 准备阶段显式选择稳定 Material ID；服务端验证 ACTIVE/STOCKED、基础单位和客户限制。该选择随交接版本固化，不反写 Planning Package。
- 工单：Production 接收交接后才能调用既有 Production Service 事务入口创建 DRAFT Work Order；每个 Handoff Item 最多一张工单。Handoff 只保存来源和唯一链接，不复制工单、BOM、需求或领料权威表。
- 释放与预留：RELEASE 在同一 PostgreSQL 事务复核当前 Package/Handoff，复制不可变 BOM Snapshot，用 `numeric(24,6)` 生成 Requirement，锁定 Inventory Position/Balance 并按 `on_hand-reserved-frozen` 校验。缺料整体回滚并返回结构化明细；齐套时写可追溯 Reservation/Event 后原子增加 `reserved_qty`。
- 领退料与取消：warehouse 只能消费 RELEASED/IN_PROGRESS 工单的有效 Reservation；Issue/Return、Ledger、Balance、Requirement、工单 Event、Audit 和 Idempotency 同事务提交。Return 恢复库存和剩余需求预留。未领料 RELEASED 可取消并释放预留，已有领料事实不得直接取消。
- 权限：planning 准备/提交，production 接收/退回、建单/释放，warehouse 分批领退料，manager/admin 具备相应管理能力；其余角色服务端 403。
- 边界：不实现生产报工、完工、成品库存、IQC/IPQC/FQC、发货、付款、银行、总账或税票；不迁真实数据、不部署生产、不启用 HTTPS、不切流。

## D-064 生产报工与成品入库采用 Report 分配关系和追加式全额冲销

- 日期：2026-07-26
- 状态：`ACCEPTED / IMPLEMENTED / PARALLEL ACCEPTED`
- 确认人：项目负责人（明确授权继续生产线，并限定只完成报工、分批完工与成品入库交接）
- 报工来源：只能对 TASK06 已释放且已领料的 `RELEASED/IN_PROGRESS` Work Order 追加 Report；服务端以 BOM Snapshot、Material Requirement 和净领料量在 PostgreSQL `numeric(24,6)` 中计算共同支持量。浏览器不提交累计投影，Report 不直接写库存，也不自动创建 IPQC/FQC。
- 良品消费：既有 Completion 必须通过关系化 Allocation 显式消费一个或多个未冲销 Report 的未消费 `good_qty`；Report 投影保存 allocation/version，稳定加锁、CAS 与数据库 guard 共同防止重复或并发超量消费，scrap 永不成为 Completion。
- 完工入库：warehouse 在单一事务复用既有 Production/Inventory 权威，原子写 Completion/Line、Allocation、成品 Ledger/Balance、Work Order 投影/状态、Event、Audit 和 Idempotency。累计完成等于计划数量才进入 `COMPLETED`，不自动 `CLOSED`。
- 更正：Report/Completion/Allocation/Ledger 均不原地改写或删除。Report 仅在零 Allocation 且无 IPQC 等下游时可全额追加冲销；Completion 仅在无 FQC、Shipment 等消费且成品库存足够时可全额追加冲销，并通过 Inventory Service 创建反向 Ledger、恢复 Report 可用良品和 Work Order 投影。无法证明安全时 fail closed。
- 权限：production 创建 Report，并仅按本人/管理授权冲销；warehouse 创建/冲销 Completion；manager/admin 管理；planning、purchase、finance、sales 等不得写，quality 只读合法来源。
- 边界：不实现工艺路线、WIP/OEE/工时成本、补料返工、品质检验创建、销售发货或财务过账；不迁真实数据、不部署生产、不启用 HTTPS、不切流。
- 验收：并行真实 HTTP 以完整领料 10 的工单分两批 Report `4/6`、Completion `4/6`，形成 Allocation `4/6`、成品 Ledger `+4/+6`、Balance 10 和 Work Order `COMPLETED`；重启、接受态/干净态停服备份与两次新空库恢复、最终清理通过，IQC/IPQC/FQC、Shipment、销售金额来源和 AR 均为 0。

## D-065 成品订单归属采用稳定分配，品质放行只形成可消费额度

- 日期：2026-07-26
- 状态：`ACCEPTED / PARALLEL VERIFIED`
- 确认人：项目负责人（明确授权 `SELFHOST-PHASE4-TASK08` 并固定分配、IPQC/FQC、权限与任务排除边界）
- 分配：Completion Line 必须由 sales 显式分配到当前 `OPEN/PARTIALLY_SHIPPED` Sales Order Line；Customer、Product、Product Version、Finished Material 和 Unit 必须与来源 Work Order 一致。有效分配两侧不得超量，不修改 Inventory `reserved_qty`；已有 FQC 后不能取消，存在有效分配时 Completion 冲销 fail closed。
- IPQC：只绑定未冲销 Production Report，累计检验不超过 reported quantity；数量守恒与 failed 的 FAIL Result/Defect 证据继续由既有 Quality Service 和数据库共同保证。IPQC 不修改生产或库存，不伪造工艺路线/WIP，也不自动决定 FQC。
- FQC：只能引用稳定 Allocation ID，不能由浏览器组合 Completion/Sales Order 来源。RELEASE 最多 passed，CONCESSION 最多 inspected 且必须有原因，REWORK/SCRAP 保持 HOLD；创建人与最终处置人职责分离，处置后才能关闭。
- 额度：只有 CLOSED/RELEASED FQC 形成订单级额度，可用量为 closed released FQC 减有效 Shipment。Shipment 仍由既有 Sales/Inventory 权威事务执行；本任务只证明额度，不创建 Shipment、销售金额来源、AR 或收款。已被有效 Shipment 消费的放行不得重开、降低或撤销。
- 生产边界：仅批准回环 `chenyida-erp-parallel` 验收；不迁真实数据，不执行生产部署、HTTPS、公网或切流，不扩展 IQC 池化隔离、批次/序列、AQL/SPC、返工工艺或报废库存过账。

## D-066 销售发货采用关系化指令、精确 FQC 消费与显式应收交接

- 日期：2026-07-26
- 状态：`ACCEPTED / IMPLEMENTED / PARALLEL ACCEPTED`
- 确认人：项目负责人（明确授权 `SELFHOST-PHASE4-TASK09` 的 Shipment 与显式 AR，并明确排除收款）
- 指令：sales 只能从当前 `OPEN/PARTIALLY_SHIPPED` SO 创建稳定引用 SO Line 的发货指令。DRAFT/提交/接收/退回/取消均受权限、幂等、CAS、容量和事件控制；指令占用订单未发量与 FQC 可用量，但自身不写 Shipment、库存、FQC 消费、金额来源或 AR。
- 发货：warehouse 只执行已接收指令，并在单一 PostgreSQL 事务锁定 Instruction、SO/Line、FQC Sources 与 Inventory Balance，原子提交 Shipment/Line、精确 Shipment→FQC Allocation、Ledger/Balance、SO/Instruction 投影、Sales Financial Source、Event/Audit/Idempotency。任何不完整来源或并发冲突 fail closed。
- FQC：Shipment Line 可以消费一个或多个属于 TASK08 有效 Completion→SO Allocation 的 CLOSED/RELEASED FQC；同一 FQC 可被多次分批消费，但净累计不得超过 released quantity。Shipment 全额冲销按原分配恢复可用额度；已有 AR 时禁止冲销，已消费时禁止 FQC reopen。
- 应收：Shipment 只产生服务端按 quantity × SO unit price 计算的可信 Sales Source，不自动创建 AR。finance 显式消费每个正向来源且最多一次，Customer/Currency/Amount 只能继承来源；浏览器不得提交可信总额或客户。
- 边界：本决定不授权 Finance Settlement、客户收款、银行、总账、税票、收入确认、真实数据迁移、HTTPS、切流或生产部署。

## D-067 收付款沿稳定财务来源按项目和币种追溯，但不形成会计利润

- 日期：2026-07-26
- 状态：`ACCEPTED / IMPLEMENTING FOR PARALLEL ACCEPTANCE`
- 确认人：项目负责人（明确授权 `SELFHOST-PHASE4-TASK10` 的合成客户收款、供应商付款与项目收支追溯）
- Settlement：继续使用 `finance_documents`、`finance_settlements` 和追加式全额冲销。AR 只能登记 RECEIPT，AP 只能登记 PAYMENT；Document 行锁、CAS、幂等、金额上限、事件、审计和事务边界不变。`account_name` 只作内部记账标签，不证明银行连接或余额。
- 项目归属：Finance 过账时从正向 Sales/Purchase Financial Source 的来源行沿稳定外键链确定 Business Project。金额由来源行数量和单价在服务端计算；缺链保存 `UNATTRIBUTED`，不按名称、订单文本或浏览器选择猜测，也不回写历史 Shipment、Receipt、AR 或 AP。
- 不可变与守恒：来源分配保存 Project/UNATTRIBUTED、稳定来源行、数量、单价、金额和 SHA-256 digest；数据库外键、唯一约束、延迟总额核对和直接 SQL guard 防止绕过。部分 Settlement 按 Document 来源比例逐笔分配，六位小数尾差固定落到稳定排序首行，每笔和总额都守恒。
- 查询：项目财务只按 Project 与 Currency 聚合来源、AR/AP、收付款和未结余额；跨币种禁止求和。`net_cash` 只等于客户收款减供应商付款；`transaction_contribution` 只等于销售来源减采购来源，不是毛利、净利润或会计利润，且不包含人工、制造/公司费用、税、折旧、汇率或库存成本。
- 权限：finance 可查看/登记/冲销既有 AR/AP Settlement；manager/admin 可查看全部项目财务；engineering 只读本人负责项目的去敏汇总，不返回内部账户标签；sales/purchase 只读各自 AR/RECEIPT 与 AP/PAYMENT；其他越权写 403。
- 生产边界：只批准隔离测试和回环 `chenyida-erp-parallel` 合成验收；不连接真实银行或支付接口，不迁真实数据，不执行生产 migration/部署、HTTPS、切流、push 或 PR。

## D-068 工艺路线以发布版本为权威，工单释放固化不可变工艺快照

- 日期：2026-07-26
- 状态：`ACCEPTED / IMPLEMENTED / PARALLEL ACCEPTED`
- 确认人：项目负责人（明确授权 `SELFHOST-PHASE5-TASK01`，并明确排除工序执行、WIP 和库存过账）
- 工作中心：Work Center 使用稳定内部 ID 和标准化唯一 code；code 创建后不可修改。启停受 CAS、持久幂等和审计控制；停用不改写历史，已进入 Released Routing 或 Work Order Snapshot 的记录不得删除。本阶段不存设备密码、网络地址或控制参数。
- 路线：Routing Header 稳定绑定 Product，Routing Version 稳定绑定相同 Product 的 Product Version，Operation 稳定引用 ACTIVE Work Center。engineering 编辑/提交，manager/admin 异人发布或退回；发布时服务端重算 canonical digest，并通过事务锁与唯一约束保证一个 Product Version 只有一个 current RELEASED 版本。已发布版本及工序不可修改或删除，新发布版本保留旧版为 SUPERSEDED。
- 工单：DRAFT Work Order 显式 RELEASE 时，在 TASK06 单一事务内复核当前 Released Routing 与 digest，并与 BOM Snapshot、Material Requirement、Inventory Reservation、状态事件、审计和幂等一起固化唯一 Routing Snapshot 及有序 Operations。任一校验或写入失败全部回滚；后续路线版本不得改变既有工单快照。
- 历史边界：BOM Line/Production Report 的自由文本 `process_stage` 继续仅作历史兼容，不自动生成 Work Center/正式 Routing，也不批量改写。迁移前 RELEASED/COMPLETED 工单不猜测路线，只读显示 `LEGACY_UNSTRUCTURED`。
- 生产边界：本决定只批准隔离测试和回环 `chenyida-erp-parallel` 合成验收；不授权工序派工、开工、完工、报工、WIP、返工、批次、设备、外协、库存过账、真实数据迁移、切流或生产部署。

## D-069 工序执行以工单快照工序和不可变事件为权威，WIP 不是库存

- 日期：2026-07-27
- 状态：`ACCEPTED / IMPLEMENTED / PARALLEL ACCEPTED`
- 确认人：项目负责人（明确授权 `SELFHOST-PHASE5-TASK02`，并固定线性 WIP、追加式更正和最终报工排除边界）
- 权威引用：Work Order 执行只引用其不可变 Routing Snapshot Operation、Snapshot Work Center 和前后 Snapshot Operation；不得引用之后可变化的 Routing Version Operation，也不得使用自由文本 `process_stage` 代替稳定工序 ID。迁移前 `LEGACY_UNSTRUCTURED` 工单保持兼容，但不猜测执行投影。
- 数量来源：首工序可用投入由实际净领料共同支持量证明；后序由前序未冲销 good 提供，并通过 Run Input Allocation 精确消费具体上游 Run。跳序、重复消费、超前序 good 和并发超量均 fail closed；scrap 永不进入下一工序。
- 事实与投影：Dispatch/Run、Run Report、Event、Input Allocation 和 Reversal 是不可变事实；Operation/WIP 是受控服务投影并由数据库延迟守恒核对。WIP 只表达 waiting/dispatched/in-progress/good/scrap/transferred/available/final-output 数量，不进入 MAIN Inventory Ledger/Balance。
- 更正：未开工 Run 可取消；已报工 Run 只能追加式全额冲销。已有下一工序消费、末工序输出已被 Production Report 消费或存在品质等下游引用时禁止冲销；无下游时冲销恢复上游可派工量和当前投影。业务事实、投影、审计和幂等在单一事务提交或整体回滚。
- 末工序边界：末工序 good 只形成待 Work Order 最终报工量，不自动创建 Phase 4 Production Report、Completion、Finished Goods Ledger/Balance、IPQC 或 FQC。本决定不授权最终报工绑定、成品入库、返工、批次、设备、外协、产能排程、真实数据迁移、切流或生产部署。

## D-070 结构化最终报工消费末工序稳定 good，成品入库继续复用既有 Completion

- 日期：2026-07-27
- 状态：`ACCEPTED / IMPLEMENTED / PARALLEL ACCEPTED`
- 确认人：项目负责人（明确授权 `SELFHOST-PHASE5-TASK03`，并固定末工序来源、显式 warehouse Completion 与品质/销售/财务排除边界）
- 来源权威：有 Routing Snapshot 的 Work Order 只能消费同一工单最后 Snapshot Operation 的有效 Operation Run Report good；浏览器不得提交 `process_stage`、`operator` 或任意 reported/good/scrap 投影。`production_report_operation_allocations` 用稳定 ID 和 PostgreSQL numeric 保存具体来源，允许分批但累计不得超量。
- 复用边界：Allocation 只绑定既有 Production Report，不复制 Report、Receipt Projection、Completion 或 Inventory 权威。服务端生成 `reported_qty=good_qty=allocation`、`scrap_qty=0`、末工序阶段和受控 operator；正式 Report 不写库存。warehouse 继续显式通过既有 Report→Completion Allocation 在同一事务写 Completion、Finished Goods Ledger/Balance、Work Order 投影、Event/Audit/Idempotency。
- 守恒与更正：结构化写入要求 Work Order/final-output CAS、固定锁顺序、持久幂等和数据库 deferred guard。无下游 Report 全额冲销恢复末工序来源；已有 Completion/IPQC 等下游时 fail closed。Completion 安全冲销后才允许 Report 冲销；有效 Report 消费后阻止对应 Operation Run 冲销。Allocation 和原事实不可修改或删除。
- 历史与下游：无 Routing Snapshot 的历史 Work Order 保留兼容 Report/Completion 路径；结构化工单拒绝 legacy 自由文本和自动 report+completion 快捷路径。本决定不自动创建 IPQC/FQC、Shipment、Sales Financial Source、AR 或 Settlement，也不授权返工、批次、设备、产能、真实数据迁移、切流或生产部署。

## D-071 工序 IPQC 只从稳定 Run Report 显式创建，关闭放行后才形成 WIP 可消费额度

- 日期：2026-07-27
- 状态：`ACCEPTED / IMPLEMENTED / PARALLEL ACCEPTED`
- 确认人：项目负责人（明确授权 `SELFHOST-PHASE5-TASK04`，并固定不自动创建品质、稳定来源、质量 Hold/Release 与下游门禁）
- 门禁固化：engineering 只在 DRAFT Routing Operation 配置 `NONE/IPQC`；门禁进入 canonical digest，随 Released Routing 不可变，并在 Work Order RELEASE 时固化到 Snapshot Operation。历史路线默认 `NONE`，不猜测或批量改写。
- 稳定来源：IPQC 工序完成 Run Report 后只形成待检来源和 Quality Hold；quality 必须显式创建引用 `production_operation_run_report_id` 的 Inspection。Work Order、Snapshot Operation、Work Center、Material、Unit 和来源 good 均由服务端沿稳定外键确定；该来源与既有 `production_report_id` IPQC 兼容来源互斥。
- 数量与消费：同一 Run Report 的累计 inspected 不超 good，`passed + failed = inspected`；只有 `CLOSED + RELEASED` 的 released quantity 形成额度。下一 Snapshot Operation 的 Run Input Allocation 或末工序 Final Output Allocation 精确消费该额度；NONE 工序保持 TASK02/TASK03 原 good 直通语义。
- 更正与并发：存在任何 IPQC 后阻止来源 Run 冲销；下游已消费后阻止 reopen、降低放行或改变处置。无消费时按既有职责分离安全 reopen，并把释放额度归零。Inspection/Result/Defect/Event/Allocation 不原地改写或删除；CAS、固定锁顺序、幂等、数据库 deferred guard 和单事务 Audit 保证并发与故障 fail closed。
- 权限与边界：production 只执行工序和查看质量状态，quality 创建/记录/关闭，manager/admin 处置管理，最终处置与关闭保持异人职责分离，其他角色写入 403。Dashboard 只读且不自动创建 Inspection。本决定不授权 FQC、Shipment、财务、返工/返修、failed/scrap 库存、批次/序列、设备/OEE、产能、真实迁移、切流或生产部署。

## D-072 IPQC failed 以唯一 NCR 守恒分配，返工接收不等于返工执行

- 日期：2026-07-27
- 状态：`ACCEPTED / IMPLEMENTED / PARALLEL ACCEPTED`
- 确认人：项目负责人（明确授权 `SELFHOST-PHASE5-TASK05`，并固定 NCR、不可变返工申请交接、受控 SCRAP 与不执行返工工序边界）
- 稳定来源：NCR 只能由同一 Work Order/Snapshot Operation 的结构化 Operation Run Report IPQC 创建，Inspection 必须 `failed_qty > 0` 且同时存在 FAIL Result 和有效 Defect。每个 Inspection 唯一 NCR；Material、Unit、Work Order、Run Report、Snapshot Operation 和 Work Center 均沿服务端稳定外键继承。
- 数量守恒：`failed_qty = active rework allocation + final scrap allocation + unresolved_qty`。DRAFT 不占用；SUBMITTED/ACCEPTED 占用；RETURNED/CANCELLED 释放；SCRAP 为不可逆 FINAL。PostgreSQL numeric、唯一索引、固定锁顺序和 deferred guard 阻止超量、重复消费、跨工单目标和直接 SQL 伪造。
- 返工交接：quality 创建/编辑 DRAFT，submit 重新锁定来源与数量并生成 canonical digest 和不可变提交版本；production 只能 ACCEPT/RETURN，创建人不得接收自己的申请，RETURN 必须留原因。RETURNED 只能新建修订请求，ACCEPTED 不可修改/取消/减少，也不会自动创建 Run、WIP、领料、报工、再检或库存事实。
- 目标与更正：target 只能是同一 Work Order Routing Snapshot 中 sequence 不晚于来源的稳定 Snapshot Operation。已有 SUBMITTED/ACCEPTED 或 SCRAP 时禁止 Inspection reopen 和来源 Run 冲销；无有效处置和下游时仅允许保留历史的安全取消。无法证明安全一律 fail closed。
- 权限与边界：quality 管理 NCR/返工准备，production 接收/退回，manager/admin 管理并执行不写 Inventory 的工序 SCRAP，engineering 只读，其余角色写入 403。Dashboard 只读显示待处置/未分配/待接收/已接收待执行/最终工序报废。本决定不授权 TASK06、实际返工执行、库存报废、补产/补料、批次/序列、FQC/Shipment/AR、真实迁移、切流或生产部署。

## D-073 返工执行复用既有 Operation/Quality 权威，复检放行后才恢复生产流

- 日期：2026-07-27
- 状态：`ACCEPTED / IMPLEMENTED / PARALLEL ACCEPTED`
- 确认人：项目负责人（明确授权 `SELFHOST-PHASE5-TASK06`，并固定显式派工、既有 Run/Report、显式复检和净产品数量边界）
- 执行来源：只有 digest 与固化提交快照一致、ACTIVE NCR Allocation 有效且尚有余额的 ACCEPTED Rework Request 可执行。production 显式派工，服务端沿稳定外键确定 Work Order、目标 Snapshot Operation、Work Center 和来源；不得再次领料、读取 Inventory Balance 或改写 Material Requirement/Reservation。
- 权威复用：既有 `production_operation_runs` 以 `NORMAL/REWORK` 稳定区分；REWORK Run/Allocation 绑定 Request、NCR、原 Inspection/Run Report、目标工序和 operator，开工/报工复用 TASK02。processed 是重复加工次数，不增加工单净产品数量，也不建立第二套 Run、Report、Quality、WIP、Production Report、Completion 或 Inventory 权威。
- 复检与后序：返工 good 在 IPQC 目标形成新的 Quality Hold，quality 必须显式对新 Run Report 建立复检；只有异人处置后的 `CLOSED + RELEASED` 才形成后序额度。原 Inspection failed 和两次 release 分别核算且历史不改写；更早目标必须按固化 Snapshot 顺序继续流转，禁止跳序或重复计算来源。
- 投影与更正：独立 Execution Projection 明确 ACCEPTED、IN_PROGRESS、WAITING_REINSPECTION、COMPLETED/COMPLETED_WITH_SCRAP；全部释放后 NCR 进入 RESOLVED。未开工 Run 可取消恢复余额；已报工只允许追加式全额冲销，无品质/下游时恢复投影，已有复检、下游 Allocation、正式 Report 或 Completion 时 fail closed。CAS、固定锁序、幂等、事务 Audit、故障回滚、不可变 trigger 和 deferred reconciliation 共同保证守恒。
- 权限与边界：production 派工/执行/受控冲销，quality 创建复检/结果/缺陷，manager/admin 处置管理，engineering 只读，其余角色写入 403。Dashboard 只读。本决定不授权自动创建 Rework Run/复检、返工补料、SCRAP Inventory、自动补产、批次/设备/产能/FQC/Shipment/AR、真实迁移、切流、生产部署或 TASK07。

## D-074 Manufacturing Batch 使用稳定发布身份贯穿生产谱系，但不等于 Inventory Lot

- 日期：2026-07-27
- 状态：`ACCEPTED / IMPLEMENTED / PARALLEL ACCEPTED`
- 确认人：项目负责人（明确授权 `SELFHOST-PHASE5-TASK07`，并固定 Manufacturing Batch genealogy 与仓库 Inventory Lot 的边界）
- Batch Set：每个 Work Order 至多一个 `DRAFT/RELEASED/CANCELLED` Batch Set。DRAFT Batch 通过 CAS 编辑；RELEASE 仅允许工单 `RELEASED/IN_PROGRESS` 且尚无 Run、各 Batch 数量大于 0、合计严格等于 planned quantity。服务端生成唯一 Batch code，并按稳定顺序固化 Work Order、Product Version、BOM/Routing Snapshot、Finished Material、Unit、planned quantity 和 canonical digest；发布后不可修改或删除。
- 执行谱系：Batch 模式新 NORMAL Run 必须提交同工单已发布 Batch，首序累计不超 Batch planned quantity，后序 Input Allocation 只能消费同 Batch 上游 good。REWORK Batch 由 NCR/Inspection/源 Run Report 稳定继承，浏览器不得覆盖；原检、返工、复检保持同批，重复加工次数不得增加净产品数量。无 Batch Set 的历史工单保持 ORDER 模式，不猜测或自动补 Batch。
- 报工与完工：每条结构化 Production Report 和 Completion 只能属于一个 Batch，Final Output 与 Report→Completion Allocation 不得混批。Completion 继续调用既有 Inventory Service；Batch genealogy 可返回 Inventory Adjustment/Ledger ID，但 Ledger `lot_code` 必须为空，Balance 继续按 MAIN 聚合。
- 查询与权限：提供 Batch 列表/详情/code 精确查询/WIP/genealogy/Work Order 汇总；状态由事实投影。production 管理 Batch Set 和 Batch Run，quality/warehouse/engineering 按职责只读，manager/admin 管理，其余角色不得执行 Batch 写操作。全部写入继续受 Session/must-change、CSRF、正文/速率、持久幂等、CAS、固定锁序、request_id、安全中文错误和事务 Audit 保护。
- 明确边界：这是 Manufacturing Batch genealogy，不是 Inventory Lot；该 TASK07 边界已由后续 D-075 对制造成品 Lot 部分扩展。D-074 仍不授权原材料/供应商批次、Shipment 批次消费、序列号、标签/条码/二维码、自动 Batch、设备/OEE、外协、产能、成本会计、真实迁移或生产部署。

## D-075 制造成品 Completion 创建稳定 Inventory Lot，Lot 外键是库存批次权威

- 日期：2026-07-27
- 状态：`ACCEPTED / IMPLEMENTED / PARALLEL ACCEPTED`
- 确认人：项目负责人（明确授权 `SELFHOST-PHASE5-TASK08`，并固定只实现 Finished Goods Inventory Lot）
- Lot 身份：Batch 与 Inventory Lot 是不同对象。首次 Batch Completion 由服务端创建唯一 `MANUFACTURING_FINISHED_GOODS` Lot，稳定继承 Work Order、Product Version、finished Material/Unit 和 Manufacturing Batch；一个 Batch 只有一个 Lot，多次 Completion、冲销后重完工均复用。Lot code 服务端生成、标准化、创建后不可修改，浏览器不得提交最终身份。
- 库存权威：Ledger/Balance 的 nullable `inventory_lot_id` 是批次权威，`lot_code` 只作兼容显示和一致性约束。成品 Lot Balance 唯一键为 Material + Location + Lot；Material aggregate 等于相同单位下所有 Lot Balance 与历史空 Lot Balance 之和，不跨单位求和。ORDER 历史路径继续 null/空 Lot，不猜测。
- 事务与更正：Batch Completion 在一个事务锁定 Batch、Report、Completion、Lot 和 Balance，原子提交 Allocation、Ledger/Balance、Lot/Batch 投影、Event/Audit/Idempotency。Completion 冲销必须向原 Lot 追加反向 Ledger；冻结、FQC、Shipment 或无法证明安全的其他下游 fail closed。净余额为 0 且来源全冲销时投影为 REVERSED，再 Completion 复用原 Lot 恢复。
- Lot 冻结：warehouse 可以对 Lot 执行正数 freeze/unfreeze，复用 Inventory Service 的追加式事实、CAS、幂等和事务审计；冻结不改 on-hand，`available=on_hand-reserved-frozen`，冻结/解冻均不得超量。production/quality/engineering 只按职责读取，其他角色不得执行 Lot 写操作。
- 数据库守卫：唯一/外键/CHECK、不可变 trigger、服务写入口与 deferred reconciliation 阻止跨 Batch/Material/Unit、错误 lot_code、重复 Lot、Batch Completion 空 Lot，以及 Completion→Lot→Ledger→Balance 不守恒的直接 SQL。
- 明确边界：本决定只授权 Completion 事务内受控创建的 Finished Goods Inventory Lot；不授权供应商来料、原材料、采购 Receipt、生产领料、Shipment Lot 消费、FQC Lot 放行、序列号、条码/标签、事务外自动 Lot、设备/OEE、外协、产能、成本会计、历史迁移、生产部署或 TASK09。

## D-076 BATCH 成品 FQC 与 Shipment 必须沿稳定 Inventory Lot 精确放行和消费

- 日期：2026-07-27
- 状态：`ACCEPTED / IMPLEMENTED IN PARALLEL ENVIRONMENT`
- 确认人：项目负责人（明确授权 `SELFHOST-PHASE5-TASK09` 并固定 Lot 精确消费与 ORDER 兼容边界）
- 稳定关系：BATCH 的 Completion→Sales Allocation、FQC Inspection、Shipment Line 和 FQC Consumption Fact 必须保存同一个 `inventory_lot_id`；Lot code 只显示和校验，不参与推断。ORDER 历史来源保持 null/空 Lot，不自动转为某个 Lot。
- 放行与消费：FQC released/consumed/available 按 Lot、Allocation、Sales Order Line、Material 和 Unit 锁定核算。warehouse 必须显式选择 BATCH Lot；Shipment 同时受 Delivery/SO 剩余、Lot `on_hand-frozen-reserved` 和同 Lot FQC available 限制。禁止自动选 Lot、跨 Lot/Batch/Material/Unit/SO Line 消费和冻结 Lot 发货。
- 事务与更正：Shipment 复用 Inventory Service 向同 Lot 写负 Ledger，并与 FQC 消费、Delivery/SO 投影、Sales Source、Event、Audit、Idempotency 同事务。无 AR 等不可逆下游时，冲销只能沿原 Shipment Line 的原 Lot 追加恢复 Ledger 和 FQC reversal；不得重选 Lot。
- 数据库边界：0033 使用 nullable 外键兼容 ORDER，并以 CHECK、索引、服务写 guard、不可变事实与 deferred reconciliation 阻止直接 SQL 绕过和数量不守恒。已被 Shipment 净消费的 FQC 不能 reopen、改写或跨 Lot 转移。
- 明确边界：不授权原材料/供应商/采购 Receipt/生产领料 Lot、序列号/标签、FIFO/FEFO、AR/Settlement/银行/税票/总账、成本/利润、Routing/WIP/返工规则变更、真实迁移、生产部署或 TASK10。
- 验收：`0.1.0-alpha.33`/`0033` 已按真实 HTTP 验证 Lot A/B `4/6`、冻结 B 2 后拒发 6、解冻后发货、冲销 A 后恢复并再次从同一 A 发货，以及 ORDER null Lot；接受态第二空库恢复和最终 clean-0033 主库恢复通过。本状态只代表回环并行非生产环境。

## D-077 供应商来料收货创建独立 Inventory Lot，IQC 合格量才可解冻

- 日期：2026-07-27
- 状态：`ACCEPTED / IMPLEMENTED / PARALLEL ACCEPTED`
- 确认人：项目负责人（明确授权 `SELFHOST-PHASE5-TASK10`，并固定来料隔离与生产领料排除边界）
- Lot 身份：只有 ACTIVE/STOCKED/IQC 内部物料的正常 Receipt 创建 `SUPPLIER_RECEIPT` Lot；内部 `RML-########` 由服务端生成，一条 Receipt Line 唯一一个 Lot。supplier lot code 是不可变外部别名，相同文本不自动合并。
- 隔离：收货数量在一个事务同时增加 on-hand 与 frozen，available 初始为 0。IQC 只能沿 Receipt Line→Lot 稳定关系创建；RELEASE 不超过 passed，并以追加式 UNFREEZE Ledger 原子减少 frozen，failed/HOLD 保持冻结。
- 更正：没有 IQC、AP、领用、调整或其他下游且余额完整时，整单收货冲销沿原 Lot 追加反向 Ledger并置 REVERSED；不得部分冲销、重选或创建替代 Lot。已有 IQC 后禁止冲销，已形成 IQC 放行事实后禁止不安全 reopen。
- 权限：warehouse 收货/安全冲销但不做 IQC；quality 创建检验、结果、缺陷、异人处置和关闭但不能收货/任意调库存；purchase 只读履约/Lot/IQC；production 只读已放行来料 Lot，本任务不授权领料。
- 明确边界：不授权生产领料 Lot、FIFO/FEFO、效期/库龄、序列号/条码/标签、自动退货/报废、MRB/让步/返工、真实迁移、生产部署或后续任务。
- 验收：`0.1.0-alpha.34`/`0034` 已用真实 Node/PostgreSQL HTTP 验证主链 Receipt 10→IQC 10/8/2→RELEASE 8/Close，最终 Lot `10/2/8`、Source 120、AP/Production Issue 0；独立 3 件支线沿原 Lot 全额冲销为 REVERSED，已有 IQC 的主链冲销 409。重启、接受态第二库恢复和最终 clean-0034 主库恢复均通过。本状态只代表回环并行非生产环境。

## D-078 公网 18888 只通过可信 TLS 进入新 PostgreSQL ERP，旧 Python 回环保留

- 日期：2026-07-28
- 状态：`ACCEPTED / IMPLEMENTED / DEPLOYED TO PARALLEL NON-PRODUCTION UAT`
- 确认人：项目负责人（明确要求公网访问入口并指定端口 `18888`）
- 入口：公网 `18888` 由 Caddy 终止 TLS 并反向代理到只绑定 `127.0.0.1:3000` 的 Web；PostgreSQL 不发布宿主端口。80 只用于 ACME 与 308 HTTPS 跳转，不承载明文登录。
- 运行安全：Web/Worker 使用 `ERP_ENV=production`，Cookie 强制 `Secure`；setup token 在切换时轮换。匿名业务 API 必须保持 401，Caddy 添加 HSTS、nosniff、frame deny、Referrer 与 Permissions Policy。
- 名称与数据路径：`43.135.157.211.nip.io` 只把名称解析到本机公网 IP，TLS 与 ERP 请求直接到本机 Caddy，不经过第三方反向代理或存储。该名称是临时入口，后续优先替换为公司自有域名。
- 旧运行面：旧 Python 不删除、不读取或迁移 SQLite 正文，改为 `127.0.0.1:18889` 本机回退入口并保持 systemd active/enabled。
- 数据边界：本决定不修改 Schema/Migration 或业务表，不解决 LANDING-TASK02 的 438 条隔离来源，不上传真实表格、备份、凭据或业务正文，不部署历史 Sites/D1。

## D-079 BOM 物料治理以版本化精确身份生成候选，正式物料仍由人工受控流程生效

- 日期：2026-07-29
- 状态：`ACCEPTED / IMPLEMENTED IN NON-PRODUCTION SOURCE`
- 确认人：项目负责人（本次提供完整治理任务、核心规则和四项验收样例）
- 唯一判定：治理身份必须由类别+类型化关键规格+性能等级组成。物料名称、供应商料号、原始料号和自由文本描述不是通用唯一键，只能作来源、别名或证据。
- 规范化：电子量使用精确十进制量纲和版本化解码/默认，禁止浮点近似判等。只有经审批的 `0201WMJ0000TCE` 规则可解码，且只有 0201 电阻配置可补 `1/20W`；未知厂商编码不猜测。
- 归并边界：只有全部必需项完整且无冲突的 READY 身份才可精确归组；缺项、冲突、无法解析或不支持品类 fail closed。RES 包含封装/阻值/精度/功率，CAP 包含封装/容量/耐压/介质/精度，IND 包含封装/感值/额定电流/精度；IC/二极管/三极管使用完整 MPN+封装，CON 使用品牌+MPN+PIN 数+间距+结构。
- 正式生效：`RES_...`/`CAP_...` 等标准规格 key 是治理候选身份，不是正式 ERP 编码。人工只能精确绑定当前 ACTIVE，或经既有 Material Workflow 建立未编码 DRAFT；只有既有审批事务可生成 `CYD-{CATEGORY}-{SEQUENCE}`。AI/自动化不得批准、覆盖或直接创建 ACTIVE。
- 替代料：同规格不同来源与型号敏感类兼容关系只生成 `PENDING_REVIEW` 候选。不自动写正式 Supplier Mapping 或正式替代关系，优先级/客户范围/生效仍须独立审批。
- 全局一物一码：治理建稿、治理 Draft 批准和普通 Draft 批准共享 PostgreSQL advisory identity lock 与正式身份扫描；已有 DRAFT/PENDING_REVIEW、ACTIVE、FROZEN、INACTIVE 不得被绕过。决策绑定必须 live revalidation，可收敛运行快照后新建的精确 ACTIVE。旧 Import Review 对受治理类别禁止 CREATE/BIND 旁路。
- 兼容门禁：已有正式物料若缺新必需属性、基础字段与属性冲突或无法按当前规则可靠重建，只能生成兼容证据并阻断同类新建稿/批准。本版本不猜测修复，也不提供 ACTIVE 属性修订流程；后续必须另立受控修订任务。
- 授权边界：本决定只授权 alpha.35/0035 源码、隔离迁移/数据库验证和文档。不授权读取/回填真实 BOM，不授权治理 UI、历史 ACTIVE 修订、正式替代料审批、常驻/生产 Migration、build、restart 或 deploy。

## D-080 TLS 终止后的写请求只信任显式公网 Origin，不信任客户端转发头

- 日期：2026-07-29
- 状态：`ACCEPTED / IMPLEMENTED / DEPLOYED AS ALPHA.34 HOTFIX`
- 确认人：项目负责人（提供失败请求证据并明确授权修复当前公网首次改密）
- 来源权威：Caddy 终止公网 TLS 后，浏览器 `Origin` 必须与规范化的单值 `ERP_PUBLIC_ORIGIN` 精确一致；代理后的内部 HTTP `Request.url` 不能代表浏览器来源。配置存在时公网值是唯一允许来源；只有未配置的开发/测试环境才回退原生 request origin。
- 配置门禁：只接受绝对 HTTP(S) origin，禁止凭据、通配、路径、查询和 fragment；production 禁止 HTTP。不得直接信任客户端可伪造的 `Forwarded` 或 `X-Forwarded-*`。切换公司域名、协议或端口时必须通过独立受控配置变更同步更新 allowlist。
- CSRF/身份：身份写仍强制 Origin；通用写保持既有缺失 Origin 语义，但 Cookie/Header Token 双提交继续强制且常量时间比较。Session、must-change、权限、限流、幂等、CAS 和事务审计均不因代理兼容而放宽。
- 发布边界：该任务部署时只允许 `https://43.135.157.211.nip.io:18888`，并以 alpha.34 最小 Web hotfix 部署；后续 UAT 严格回环例外由 D-082 单独授权，不改写本决定的公网边界。0035、PostgreSQL、Worker、Caddy、业务数据和历史 Sites/D1 不在授权范围。

## D-081 `admin2` 可按项目负责人明确授权豁免首次改密，但不形成全局能力

- 日期：2026-07-29
- 状态：`ACCEPTED / APPLIED AS SINGLE-ACCOUNT OPS EXCEPTION`
- 确认人：项目负责人（明确要求 `admin2` 不用首次改密）
- 例外范围：只把当前 `chenyida-erp-parallel` 中 `admin2.must_change_password` 清除；保留当前密码、active admin 角色和合法 Session。账号 version 按 CAS 递增并写专用不可变 Identity Audit。
- 全局策略：D-045 的新建/重置用户强制首次改密继续有效；不修改 Service/API/Schema，不新增管理员日常可调用的通用豁免入口，其他账号不能由此自动获得豁免。
- 安全与追踪：事务必须校验目标、active/role/version/当前标记，账号更新和 `USER_FIRST_PASSWORD_CHANGE_WAIVED` 审计同事务；审计记录项目负责人授权、单账号范围、未改密码、未撤销会话和未改全局策略，不记录密码、摘要、Cookie 或 Token。同任务重放必须 no-op 或 fail closed。
- 授权边界：本决定不授权修改密码策略、删除审计、批量豁免、角色/权限变更、Schema/Migration、业务数据、服务部署、历史 Sites/D1 或 Python 运行面。

## D-082 UAT 回环来源必须显式启用，两个工作台退出统一失败可见的服务端撤销链路

- 日期：2026-07-29
- 状态：`ACCEPTED / IMPLEMENTED / PARALLEL ACCEPTED`
- 确认人：项目负责人（明确授权 `SELFHOST-OPS-UAT-BLOCKER-FIX` 的聚焦修复、非生产部署和真实浏览器验收）
- 根因边界：当前公网只允许单值 HTTPS `ERP_PUBLIC_ORIGIN`，而 SSH 隧道/Codex 浏览器转发实际使用动态端口回环 Origin；合法 Session、CSRF Cookie/Header 和幂等信息因此仍在来源门禁被拒绝。两个工作台又分别吞掉 logout 失败并乐观清理页面状态，导致服务端 Session 仍有效且用户看不到错误。
- UAT 回环：只有 `ERP_DEPLOYMENT_CLASS=uat` 与 `ERP_UAT_ALLOW_LOOPBACK_ORIGIN=true` 同时显式配置时，才额外接受 HTTP(S) 严格字面量 `localhost`、`127.0.0.1` 或 `[::1]`，且浏览器 Origin 和 Request URL origin 必须同时为回环。动态端口可以不同于公网入口，但任意域名、外部 IP、单边回环、通配、客户端 `Host`/`Forwarded`/`X-Forwarded-*` 均不成为信任来源。生产部署类别仍只接受显式可信 HTTPS Origin，并拒绝启用回环例外。
- 统一退出：经营工作台和兼容工作台必须复用同一 `POST /api/logout` 客户端，发送 `credentials: same-origin` 与 Cookie/Header CSRF 双提交。仅在服务端事务撤销 Session、成功审计并对称清除 Session/CSRF Cookie 后跳转登录页；失败必须显示稳定错误码和中文提示，不得吞错、改 GET 或只清浏览器状态。匿名重复 logout 保持幂等成功。
- 授权边界：本决定不降低 Session、Cookie、CSRF、Origin、权限、幂等、密码或审计要求；不授权 Migration、业务数据修改、现有用户修改、角色业务试用、生产部署、历史 Sites/D1 或 Python 运行面操作。

## D-083 大批量物料整理采用固定模板、版本化来源档案和一批一对话

- 日期：2026-07-30
- 状态：`ACCEPTED / PROCESS DESIGNED / IMPLEMENTATION PENDING`
- 确认人：项目负责人（明确后续将持续提供公司资料，要求直接套用 TASK07 模板，并因数量庞大采用跨对话流程）
- 模板权威：当前目标固定为 `CYD-MATERIAL-13C-v1`，绑定 `moban.xlsx` SHA-256 `581a0db72ed6ac207445e39bd8c9640a8765830ddcf385518ba177d74909a58c` 及 13 列顺序；规则包为 `CYD-MATERIAL-NORMALIZATION-v1`。模板或规则变化必须发布新版本，不原地覆盖旧批次。
- 批次权威：采用 `CYD-MAT-YYYYMMDD-NNN/Rxxx`，默认每批不超过 10 个文件、5,000 条候选物料行和 100 MiB。原件、manifest、批次卡、决定日志、输出和报告以私有文件及 SHA 为权威；聊天记录不承担恢复状态。每个批次卡只有一个 `checkpoint.next_action`，新对话先核验总索引和批次卡再继续。
- 来源档案：已知结构只有在结构指纹命中已批准映射档案时才直接套用；未知表头、列位或主料/替代料语义先进入 `PROFILE_PENDING`，一次确认后发布新档案版本。文件名相似、自由文本和模糊匹配不能替代结构证据。
- 审核与汇总：Codex 最高推进到 `REVIEW_REQUIRED`，项目负责人明确批准批次 ID/修订/输出摘要后才能进入已批准汇总。临时汇总可以包含机器验证的待确认批次，但不得作为数据库输入；已批准汇总只拼接最新、未被取代的批准批次，不重新解析原件或跨批模糊去重。
- 授权边界：本决定只确认文档流程和未来批次协作方式。TASK07 现有脚本仍是当前文件专用实现；通用批次执行器、来源档案注册表、首个新资料批次、正式物料去重/编码、数据库导入、Migration、build、restart、deploy 和生产动作均需独立任务与授权。

## D-084 供应商导入以现有 Parse/Mapping 上的只读 13 列投影提供标准整理

- 日期：2026-07-30
- 状态：`ACCEPTED / IMPLEMENTED IN NON-PRODUCTION SOURCE`
- 确认人：项目负责人（明确要求把 TASK07 获认可的整理方式接入现有“供应商导入”，并确认现有导入体验不好用）
- 复用边界：不把绑定 8 个历史文件的 Python 脚本放进 Web，也不新增第二套 Parser、导入批次或业务数据库。服务端只消费现有批次当前已发布 Parse、选中可见 Sheet、当前 Mapping 和不可变原始行，并在 repeatable-read 只读快照中生成 `CYD-MATERIAL-13C-v1`。
- 证据规则：13 列表头逐字且列位完全命中时原样投影；其他来源只使用明确表头、当前 Mapping、可证明的文件/标题上下文和显式主替状态。供应商料号不得冒充内部型号，未知项目/板型/内部型号/规格/数量保持空白并返回稳定问题代码；只有明确标记的替代行才折叠。
- 数量与安全：`需求数量=用量×订单数量`、`购买数量=max(需求数量-库存数,0)` 使用字符串+BigInt 十进制计算，不使用浮点；公式和错误单元格不执行。单次最多 5,000 个候选行且原始 JSON 总量不超过 32 MiB；CSV 使用 UTF-8 BOM、RFC 4180 转义和公式注入保护。
- API/UI：分页预览和 CSV 只允许 `material.import.read`/`read_any` 且继续执行 owner 行级可见性；响应 `private, no-store`，导出写安全审计。解析准备完成后默认进入“标准整理”，同时保留来源表头、高级 Mapping、Normalization 和 Review；页面必须明确预览/下载不等于入库、建稿、审批或编码。
- 授权边界：alpha.36/0035 只完成源码和隔离测试；不新增/应用 Migration，不处理新真实文件，不自动确认 Mapping/Profile，不写 Material Draft/ACTIVE/替代关系，不 build/restart/deploy。当前 18888 仍是 alpha.34/0034；任何部署、真实资料批次、跨批合并或数据库导入必须独立授权。

## D-085 公网 IP 变化时域名与唯一可信 Origin 必须同一受控任务切换

- 日期：2026-07-31
- 状态：`ACCEPTED / DEPLOYED`
- 确认人：项目负责人（告知服务器公网 IP 已变化，并明确回复“切换”）
- 新入口：公网 IPv4 `43.135.148.43` 对应临时 DNS-only 名称 `43.135.148.43.nip.io`；唯一入口固定为 `https://43.135.148.43.nip.io:18888`。nip.io 只提供解析，不代理、不存储 ERP 流量。
- 原子配置边界：Caddy `ERP_DOMAIN` 与 Web `ERP_PUBLIC_ORIGIN` 必须在同一任务切换，避免证书主机名和服务端写请求来源白名单分叉；旧主机名从当前 Caddy 配置退役，不保留双公网 Origin。
- 部署边界：只复用原镜像串行重建 Web/Caddy并复用 Caddy 持久卷签发新证书；不 build、不重建 PostgreSQL/Worker、不修改 Schema/Migration/业务数据/权限/凭据/防火墙。原 root-only env 副本是回退权威。
- 验收边界：DNS、公开可信证书/SAN、外部 18888 登录页、HTTPS 200、HTTP 308、匿名 401、安全头、旧 SNI 失败、资源/OOM/restart、卷和切换后数据库零写增量均须通过；公司自有域名仍是后续推荐方向。

## D-086 Planning 需求单位解析必须使用独立版本事实和 CAS Head

- 日期：2026-07-31
- 状态：`ACCEPTED / IMPLEMENTED / DEPLOYED TO PARALLEL NON-PRODUCTION UAT`
- 确认人：项目负责人（2026-07-31 明确授权独立 0036 实现、全部隔离升级/恢复测试通过后的并行非生产 UAT 0034→0035→0036 升级与 alpha.37 Web 部署）
- 提出依据：项目负责人要求修复 Planning Handoff “单位待确认却无处确认”，并明确禁止改写已提交销售需求、静默推断 PCS 或放宽快照门禁。
- 已确认缺口：0015 的 Requirement Item 以 `unit_id=NULL/unit_pending=true` 合法保留未知单位，并由不可变 trigger 保护。0016/0034 的 `project_requirement_resolutions` 只保存 Product/BOM 稳定 ID，没有 Unit、单位版本或独立 CAS；快照又从源 Requirement Item INNER JOIN enabled Unit，因而无法合规解析当前行。
- 确认模型：0036 新增 append-only `project_requirement_unit_resolution_versions`，保存 project/requirement version/item/unit/source type/supersedes/actor/request/digest，并以复合 FK 证明同一需求链；新增 `project_requirement_unit_resolution_heads`，按 Requirement Item 保存 current resolution 和单调 version，以独立 expected-version CAS 保证并发单胜。版本事实只插入、不更新/删除。
- 来源类型：`ENGINEERING_CONFIRMED` 仅表示获准工程/管理角色通过正式 API 明确确认；`REQUIREMENT_DECLARED` 仅用于迁移时可由既有 `unit_pending=false` 且稳定 `unit_id` 直接证明的源需求单位，并保留原需求创建人和来源摘要。`unit_pending=true`、NULL、名称、BOM 单位或其他间接证据一律不得回填或伪装成人工确认，迁移核对必须单列脱敏拒绝计数。
- 快照来源：新 Package Item 的 `unit_id` 取当前 Unit Resolution，不取源需求或 BOM；建议扩展 nullable `unit_resolution_id` provenance，并对 0036 后新包由服务强制非 NULL。既有包不得猜测回填，package/source digest 必须覆盖 Unit Resolution。
- 有效性与错误：Unit 保存和生成时都锁定校验存在且 enabled；空/未知/停用分别使用 `REQUIREMENT_UNIT_UNRESOLVED`、`REQUIREMENT_UNIT_INVALID`、`REQUIREMENT_UNIT_DISABLED`，Product/BOM 缺失使用 `REQUIREMENT_PRODUCT_BOM_UNRESOLVED`，并指明具体 Requirement Item/line。BOM 组件 Unit 不能推断需求数量 Unit。
- 安全边界：只有 engineering/project owner 的 `planning.prepare` 可写；严格 Origin、Cookie/Header CSRF、Idempotency-Key+canonical body、独立 CAS、Unit/Product/BOM/Audit/幂等同事务和故障零半记录。planning、sales、无关角色 403；Package 非 RETURNED 后锁定依据，退回修订产生新 Resolution/Package 版本。
- 迁移边界：不修改 0035；只可新增 0036，并按 0034→0035→0036 在真实快照的隔离副本验证空库/已有库/重放/回滚/约束/摘要。不得自动把现有 pending 行回填 PCS，不得制作 alpha.34 兼容热修；当前主 UAT Package 必须保持 0。隔离门禁全部通过后才允许执行本次明确授权的并行非生产 UAT 升级，生产数据库和真实公司数据仍未获授权。
- 实施结果：`0.1.0-alpha.37` 以唯一新增 `0036_project_requirement_unit_resolution.sql` 落实上述模型；功能提交为 `91c0fd29d534246c55ddd669e894cdde9b774e52`。空库 0001→0036、0035→0036、真实 0034 快照的 0035→0036、重放、失败回滚、约束、隔离完整浏览器旅程和恢复门禁通过后，并行非生产 UAT 已由 0034 串行升级到 0035/0036并部署 alpha.37 Web。
- 数据保护结果：主 UAT 的 `unit_id=NULL/unit_pending=true` 未回填；Unit Resolution Version/Head 与 Planning Package/Item/Event 都保持 0，Product/BOM Resolution 仍精确指向 7/7/7/7，受保护业务指纹 `fb71309bf73dce907f0bcb2e294d1b31` 升级前后相同。Engineering 只读验收未选择或保存 PCS、未生成 Package，未登录 planning；后续业务黑盒试用必须另立任务。

## D-087 并行 UAT 身份恢复采用停写离线单事务与 Canonical 原子提升

- 日期：2026-08-01
- 状态：`ACCEPTED / IMPLEMENTED FOR PARALLEL NON-PRODUCTION UAT`
- 确认人：项目负责人（明确选择并授权方案 B）
- 背景：TASK09 已重置十个 UAT 账号但未完成 Session 退出和正式文件提升，TASK10 又在旧凭据结构预检阶段 fail closed；管理员与首个 UAT 的 Session 风险、失效正式 UAT 文件和唯一旧候选不能通过继续网页尝试安全收口。
- 决定：建立不接 Web 路由的 root-only 离线恢复 CLI。只有 CLI environment 为 `parallel-uat`、运行配置 `ERP_DEPLOYMENT_CLASS=uat`、数据库身份与 0036 精确吻合、Web/Worker 已停止写入、显式确认和唯一 run-id 全部通过时，才可在一个 PostgreSQL 事务内锁定并核验 admin 与固定十个 UAT 账号、复用现有 Password 模块生成 hash、更新密码/version/must-change、撤销目标 Session、写 11 条 `OFFLINE_IDENTITY_RECOVERY` 审计并持久化 run-id 证据。
- 文件边界：密码由密码学安全随机源产生并先写入两个 root:root 0600 Stage；文件/目录 fsync、标准 JSON 与固定结构验证必须在数据库事务前完成。事务提交后 Stage 是唯一有效恢复材料；只有两份 Canonical 正式文件均原子提升并 fsync 成功后才删除旧 UAT 候选。提升失败不得恢复旧密码，必须保留 Stage 并以 PARTIAL 停止。
- 验证边界：主库写入前必须完成单元、隔离 PostgreSQL、0036 主库备份隔离恢复和隔离 Web/Chromium 演练。正式浏览器只验证 admin 登录/退出和十个 UAT 的强制改密门禁/退出，不执行改密、不进入业务页面；最终撤销本任务遗留的目标 Session。
- 数据与授权边界：不读取旧凭据正文或旧密码 hash，不输出密码/hash/Token/Cookie/Session digest/连接串；不修改用户名、角色、active、其他用户/Session、业务数据、Planning Package、Schema/Migration、版本、镜像、公开部署或生产环境。本决定不授权 Planning 核验或退回流程。
- 实施结果：工具提交 `a48dcc8a290b96da1ea6e426aaa2c6d73416c2fc`。正式 run-id `3b03aaab-11ef-4dfe-963b-001a6ece660f` 在停写窗口完成 11 账号原子恢复、12 条目标既有 Session 撤销、11 条恢复审计与唯一持久证据；Canonical 双文件激活、旧 candidate/Stage 成功处置、admin+十 UAT 单 Chromium 登录/门禁/退出和最终零有效目标 Session 通过。
- 保护结果：正式执行前后业务与受保护数据指纹分别保持 `04cdbc8a49112bc43b5652760408d46d10dbdda1801c1c9b816aa9891a5b5c3c`、`5414589704ac085792cab1a546e658a61b39c2988800a23ad091e756275e7d41`；alpha.37、36/head 0036、Schema、镜像、其他用户/Session 和 Planning Package 均未由本任务改变或操作。结论为 `OFFLINE IDENTITY RECOVERY COMPLETED — CANONICAL CREDENTIALS ACTIVE`。

## D-088 Planning 退回回复采用追加版本、独立 Head 与固定后继谱系

- 日期：2026-08-02
- 状态：`ACCEPTED / IMPLEMENTED / DEPLOYED TO PARALLEL NON-PRODUCTION UAT`
- 确认人：项目负责人（明确授权唯一新增 0037、alpha.38、隔离升级/恢复和门禁通过后的并行非生产 UAT 部署）
- 缺口：0036 可以保存 Product/BOM Resolution、Unit Resolution 和不可变 Package Snapshot，但没有关系化 Engineering Revision Response、按 RETURN 独立 CAS Head、Response 精确消费或 Package 后继外键，不能用 Event/备注/JSON/审计替代业务权威。
- 决定：0037 新增 append-only Revision Response Version 和每 RETURN Event 唯一 Revision Head；Response 保存 source Package/RETURN/Project、递增版本、NFC/LF 正文与 SHA-256、supersedes、actor、时间和 request_id。Head 使用独立 expected version CAS，只能逐一推进。
- 后继谱系：新 v2 必须同时固定 `previous_package_id`、`responds_to_return_event_id` 和 `revision_response_version_id`；复合 FK 证明 Project/Package/RETURN/Response 同源，唯一索引保证一个 RETURN 只有一个直接后继、同项目 Response Version 只消费一次。
- 固定复用：本轮是“仅回复修订”，v2 原样复制 v1 的 Product/BOM/Unit Resolution、需求数量、BOM Material 与 Document Snapshot；已有 Package 后 Product/BOM/Unit Resolution 不得经当前表单改变，未来变更须独立 change-resolution 流程。
- 不可变与摘要：Response Version、Package 稳定字段、Item/BOM/Document Snapshot 与 Event 由 PostgreSQL guard 禁止 UPDATE/DELETE/绕过服务；v2 摘要绑定源 Package、RETURN、精确 Response Version/正文摘要及全部业务快照。后续 Head 变化不影响已生成 v2。
- 事务与安全：保存回复与生成 v2 均在各自单事务内完成业务事实、Head/CAS、Event、Audit 和 Idempotency；权限、owner、责任队列、Origin、CSRF、限流、幂等、唯一性、当前 RELEASED/有效引用和故障回滚 fail closed。Audit 不保存完整正文。
- 历史边界：既有 RETURNED v1 保持无回复原样，不回填、不伪造历史 Response，不改写 v1、RETURN Event 或原因。主 UAT 部署只允许 engineering 只读确认能力存在，禁止填写回复、生成/提交 v2或登录 planning。
- 实施结果：功能提交 `58e011db0c8d9045c3919c36c2c64f1655f050b6`；alpha.38/0037 在空库、0036、真实 0036 备份恢复副本、重放、失败回滚、SQL guard 与两次隔离完整浏览器旅程通过后部署到并行非生产 UAT。主 UAT 只读核验最终 v1/RETURN/Response/v2 `1/1/0/0`，跨迁移保护指纹 `a25be9c924bb2e7af54acd36c1c5f758e0caf0b2f4d8ccf426bf428aee41d739` 不变；未填写回复、生成/提交 v2或登录 planning。

## D-089 采购审核的当前供应必须是授权范围内的只读实时投影

- 日期：2026-08-03
- 状态：`ACCEPTED / IMPLEMENTED / DEPLOYED TO PARALLEL NON-PRODUCTION UAT`
- 确认人：项目负责人（明确要求补齐采购需求审核页当前库存、预留和在途供应分解，并禁止接收/退回主 PRQ、库存写入或创建采购下游单据）
- 库存权威：当前版本按已授权 PRQ 行的稳定 Material+Unit，在 `location_code='MAIN'` 内聚合全部无批次和 Lot 库存位置。`库存可用 = Σon_hand_qty - Σreserved_qty - Σfrozen_qty`；Inventory `reserved_qty` 是正式预留，Planning Allocation 是独立业务事实，禁止互相冒充。只有来源 Plan 为 SUBMITTED/ACCEPTED 的 Allocation 才参与当前计划分配，`未分配库存可用 = max(库存可用 - 有效计划库存分配, 0)`。
- 在途权威：当前有效在途只含 PO 头/行均为 OPEN/PARTIALLY_RECEIVED、在 PRQ 需求截止日内且尚未收货的数量。有 Delivery Plan 时只含 PENDING/PARTIAL 的 `planned_quantity-received_quantity`；无 Delivery Plan 时才使用 PO 的 `order_qty-received_qty`。COMPLETED/CANCELLED/CLOSED、已收货部分及其无效来源 Allocation 均排除，`未分配在途可用 = max(有效在途 - 有效计划在途分配, 0)`。
- 诚实模型：当前 Inventory 位置域只有 MAIN，没有可展示的多仓库维度；数据库没有“其他不可用”或“已到货但未完成入库”的独立数量字段。接口和页面必须明确标注模型未单独记录，不得以 0 伪装存在该字段，也不得暴露供应商价格、PO 明细或其他项目数据。
- 快照边界：Material Requirement Plan/PRQ 的提交时库存、在途、分配和净采购是固化历史快照；当前供应在 repeatable-read/read-only 查询中实时计算，与快照分区展示。差异只提示采购人员通过正式退回/调整流程处理，不自动重算或改写 PRQ、Plan 或快照。
- 授权/写入：purchase 必须先通过既有 PRQ 对象范围授权，再仅以该 PRQ 行集查询供应汇总；诱饵 PRQ/非授权对象 403 或不可见，不开放全局 Inventory/Lot/项目枚举，不增加 Inventory/Ledger 写或 `system.audit.read`。GET 正常及失败不产生 Inventory、Allocation 或 Audit 业务写入。
- 接收边界：接收确认打开前重新查询当前供应并显示查询时间和四条摘要；该展示不参与服务端自动重算。既有状态、CAS、幂等、CSRF、Origin 和单事务门禁保持，接收仍只形成 Purchase ACCEPT 事实，不修改库存或自动创建 RFQ、PO、收货、AP 等下游。
- 实施结果：功能提交 `ce3f14a0c989875e7527e42136967f9efe6ee548`，不新增 0038、不修改 0001—0037或 alpha.38；隔离 PostgreSQL/Chromium、备份恢复和 Web-only 部署通过。主 UAT Material 533—536 的当前九项供应分别均为 0 PCS，purchase 打开刷新后的接收确认并取消；`PRQ-00000001` 仍 SUBMITTED，ACCEPT/RETURN、Inventory/Allocation 和全部下游不变。

## D-090 Purchase 决策成功凭证与 Plan 采购交接状态的投影语义

- 日期：2026-08-04
- 状态：`ACCEPTED / IMPLEMENTED / DEPLOYED TO PARALLEL NON-PRODUCTION UAT`
- 确认人：项目负责人（明确要求补齐已处理 Purchase ACCEPT 权威凭证、澄清 Plan/PRQ 状态并禁止重放主 UAT 决策或创建下游）
- Purchase 权威：采购决定只以 `planning_material_requirement_events` 中同时绑定精确 Plan ID 与 Purchase Request ID 的不可变 `PURCHASE_ACCEPTED` / `PURCHASE_RETURNED` Event 为业务权威。actor、occurred_at、request_id 与 ACCEPT/RETURN 计数直接读取该 Event；稳定 PRQ ID 和状态读取 `planning_purchase_requests`。禁止从当前登录用户、队列数量、页面状态或普通 Audit 反推历史决定。
- SUCCESS 语义：Event 表没有 result 列。Purchase 决策 Event、PRQ/Plan 状态转换、成功 Audit 和 Idempotency 在同一事务中提交，独立读取只能观察到已提交 Event，回滚不会留下它。因此读模型可以把完整且一致的不可变 Event 投影为 `SUCCESS`；该值表示事务提交后可见的成功业务事实，不表示数据库有 result 列，不允许生成或猜测失败 Event。权威 Event 缺失、重复或与 PRQ actor/time/request_id/终态不一致时必须失败关闭。
- Plan 状态：既有 Purchase ACCEPT/RETURN 事务会把 `planning_material_requirement_plans.status` 与 PRQ 分别从 `SUBMITTED` 转为对应 `ACCEPTED`/`RETURNED`，并受状态约束、CAS、同事务 Event/Audit/Idempotency 和回滚保护。该字段正式命名为“采购交接状态”，表示计划部到采购部的交接终态；Plan 版本的计算快照、行项目、Allocation 与来源摘要继续不可变，`ACCEPTED` 不表示重新计算或改写快照。
- UI/DTO 边界：Plan 状态必须读取 `planning_material_requirement_plans.status`，PRQ 状态必须读取 `planning_purchase_requests.status` 并分别展示。Purchase 决策凭证必须与 Package ACCEPT、Plan GENERATE、PRQ SUBMIT 分区，不能冒充 Planning ACCEPT；终态页面不得提供再次接收、退回或编辑动作。
- 后续边界：Purchase ACCEPT 只形成采购交接事实，不自动创建 RFQ、Quote、Award、PO、Delivery Plan、Receipt、Ledger、AP 或 Work Order。完整 ACCEPTED PRQ 与可追溯凭证满足寻源/询价的业务前置条件，但创建下游仍需新的独立授权任务。
- 实施结果：功能提交 `9d6ed0d0bc728bdaafc619fe609d92d87ebcb188`；不新增 0038、不修改 0001—0037或 alpha.38。隔离 PostgreSQL/Chromium、备份恢复、Web-only 部署和 purchase-only 主 UAT 只读验收通过；正式保护指纹 `814811509c476e270f9cd82badb85aa8bb1bf8e1f01e8bb72b4cd9fec9c9a4ff` 前后不变，主 UAT 业务 POST 0、下游 0。

## D-091 Supplier Mapping 单一权威、异人审核与 RFQ 当前有效 1:1 覆盖门禁

- 日期：2026-08-04
- 状态：`ACCEPTED / IMPLEMENTED / DEPLOYED TO PARALLEL NON-PRODUCTION UAT`
- 确认人：项目负责人（明确指定 purchase 创建/提交、operations 只读审核、创建人与审核人分离、RFQ 全覆盖门禁及主 UAT 零业务写）
- 权威模型：`supplier_mappings` 继续作为 Mapping 正文与版本的唯一关系化权威，不建立第二套正文表。0038 增加稳定 `mapping_uid`、只增版本、提交/审核 provenance、不可变 lifecycle Event 和 Supplier part claim；claim/Event 只承担唯一性或证据，不承载 Mapping 正文。
- 职责分离：purchase 精确拥有 read/create/edit_draft/submit；operations 精确拥有 read/review_queue/approve/reject；engineering 保持只读。DRAFT 仅创建人可改，提交后正文冻结，退回原因必填，创建人不得审核自己的 Mapping。admin/manager 继承不绕过自审和状态门禁。
- 生命周期：正式支持 `DRAFT→PENDING_REVIEW→ACTIVE` 和 `PENDING_REVIEW→REJECTED`。ACTIVE 不原地修改；后续变化从 ACTIVE/REJECTED 创建新 DRAFT 版本，获批替代在同一事务内把旧 ACTIVE 固化为 INACTIVE。历史版本、Event 和 part claim 禁止直接 UPDATE/DELETE。
- 单位兼容：Material 必须 ACTIVE、正式编码且具有可证明主单位。优先关系化 `base_unit_id`；既有正式 Material 若该列为空，复用 BOM 治理既有决策，以非空 `base_uom` 精确匹配唯一启用 `units.code` 并使用其稳定 ID。无匹配继续失败关闭；不为本任务回填或猜测主 UAT 数据。
- RFQ 门禁：页面、RFQ create 和 issue 复用同一 coverage 查询。仅 Supplier ACTIVE、Material ACTIVE/正式编码/主单位匹配、Mapping ACTIVE、Unit 相同、当前有效期、1:1 且唯一命中的全部申请行可选；部分或零覆盖禁用，服务端以 `SUPPLIER_MAPPING_INCOMPLETE` 返回限定于当前 Supplier/PRQ 的缺失组合。
- 事务与安全：创建、编辑、提交、批准、退回、新版本均要求权限、可信 Origin、Cookie/Header CSRF、正文上限、限流、Idempotency-Key/canonical digest、CAS、并发唯一性，并在同一事务提交 Mapping/版本/Event/Audit/Idempotency；失败零半记录。
- 实施结果：功能提交 `ddab02a57e0e87255c7a35d125959ac750b108e1`，兼容修复 `1e9221d90db621becc2badf40b3e0ed3017b73e6`；alpha.39/0038 SHA `2da259364151af098641795da55604dc3012b6adf92aec67038c0554e0592941` 已部署。隔离八 Mapping/两家 4/4/RFQ DRAFT 通过；主 UAT purchase 只读通过且 Mapping/RFQ/Quote/Award/PO 仍为 0。operations Canonical `must_change_password=true`，本任务禁止修改凭据，故 operations 主 UAT 未验证，最终为 `SUPPLIER MAPPING GOVERNANCE DEPLOYED — MAIN UAT NOT VERIFIED`。
- 后续边界：处理 operations 强制改密必须另立受控 Identity 任务；创建/审核八条主 UAT Mapping 必须再获独立业务授权。本任务不自动继续。

## D-092 Canonical v2 状态 Schema 与离线恢复初始状态门禁必须分离

- 日期：2026-08-04
- 状态：`ACCEPTED / IMPLEMENTED`
- 确认人：项目负责人（明确授权 `SELFHOST-OPS-CANONICAL-SCHEMA-RECONCILIATION-12` 的脱敏诊断及仅在确定安全时对齐验证器）
- 背景：`chenyida-erp-uat-credentials-v2` 同时被用作离线恢复输出和后续 UAT 当前凭据 Canonical。旧验证器把恢复写入时十个 UAT 账号必须 `must_change_password=true` 的初始状态写成长期 Schema `const`，因此错误拒绝已经由受控首次改密转换为 false、且被后续只读 UAT 证明有效的 engineering、planning、purchase 当前记录。
- 决定：长期 Canonical v2 的 `must_change_password` 必须是必需且严格的 boolean；固定账号数、顺序、用户名、角色、密码策略、密码唯一性、字段集合、run-id 和顶层格式继续严格。离线恢复写入器仍只生成十个 true，并由独立恢复状态校验覆盖写入、Stage、提升和最终化；长期 Schema 绝不能代替或放宽该恢复门禁。
- 诊断边界：权威 CLI 提供 root-only、固定路径、`O_NOFOLLOW`、断网可运行且在建立 PostgreSQL Pool 前返回的 `--diagnose-schema`。输出只含版本、脱敏 Pointer、Schema 关键字、预期/实际类型、白名单用户名/角色、账号数和错误数；密码、秘密、摘要、Token、Cookie、注释和实际字段值不得输出，秘密字段名固定为 `<redacted>`。
- 实施结果：根因唯一分类 A；修复后正式 Canonical 为 10 账号、0 错误、`SCHEMA_PASS`，正式文件字节和全部账号语义未变，没有身份/API/PostgreSQL/服务或业务写入。operations 首次改密可以在新的明确授权 Identity 任务中重新执行，本决定本身不授权登录或改密。

## D-093 单账号最终化必须使用定向离线事务与两项 Canonical 差异

- 日期：2026-08-04
- 状态：`ACCEPTED / IMPLEMENTED / APPLIED TO PARALLEL NON-PRODUCTION UAT`
- 确认人：项目负责人（明确授权只恢复 `uat_20260729_operations`，禁止修改其他账号和业务数据）
- 精确范围：单账号最终化模式只接受固定用户名 `uat_20260729_operations`、role=operations、active=true、预期 version、UUID v4 run-id 和绑定全部参数的显式确认短语；通配符、列表、其他用户名、隐式全账号、重复 run-id、非 root、非 UAT 数据库、非 0038、Web/Worker 未停写或镜像不符全部失败关闭。该模式不是可供日常调用的通用账号重置 API。
- 秘密与 Canonical：新最终密码只能由 CSPRNG 产生，并经匿名管道在受控内存中同时提供给密码哈希和 Canonical v2 写入器；不得进入参数、环境变量、日志或终端。正式文件同目录候选必须 root:root 0600、十账号、v2/v2.1 `SCHEMA_PASS`，且相对正式 Canonical 只允许 operations password 和 `must_change_password true→false` 两项语义差异；其他九个 UAT 账号全部字段与密码保持。
- 事务与补偿：SERIALIZABLE 单事务锁定账号与 Migration，使用预期 role/active/version CAS 更新目标 password hash、must-change、version，撤销该账号全部 Session，并写唯一不可变 `OFFLINE_IDENTITY_RECOVERY` 审计和永久 run-id marker。事务内必须证明其他账号的非敏感/秘密指纹、其他 Session 和业务表不变。数据库成功后才可原子提升并 fsync 候选；提升失败保持停写、保留同一候选，只允许同 run-id 补偿提升，禁止生成第二个密码。
- 浏览器失败边界：正式浏览器只允许目标身份 API、匿名根页与静态资产，不进入业务页面；失败后必须离线撤销目标验证 Session且不改密码。最多 attempt 1/2；第二次仍因运行器或定位失败即按浏览器不完整收口，不得修复后继续重跑。
- 实施结果：run-id `e0fec2fb-3894-4a19-93af-79eb85d9dfd4` 只把 operations must-change `true→false`、version `6→7`，事务既有 Session 撤销 0、恢复审计 1、最终有效 Session 0；Canonical 与数据库秘密一致，其他身份和业务指纹保持。Chromium attempt-2 实际形成 `LOGIN success` 与 `LOGOUT success`，但 verifier 错误要求 `/api/login` 响应含 `authenticated`，未完成页面 must-change 与历史导航断言，因此结论为 `OPERATIONS IDENTITY RECOVERED — BROWSER VERIFICATION INCOMPLETE`。
- 后续边界：本决定不授权 Mapping 业务。完整浏览器验收未补齐前不放行 purchase 创建/提交八条 Mapping；修复 verifier 和只读复验必须是新的明确授权任务，Mapping 创建/提交/异人审核仍需独立业务授权。

## D-094 Supplier Mapping 批准意见复用不可变 Event 通用字段并由零写预览形成凭证

- 日期：2026-08-05
- 状态：`ACCEPTED / IMPLEMENTED / DEPLOYED TO PARALLEL NON-PRODUCTION UAT`
- 确认人：项目负责人（明确要求补齐 operations 审核确认、独立审核意见和可持久重开的批准成功凭证，同时保护主 UAT 既有 1 ACTIVE / 7 PENDING_REVIEW）
- 存储决定：0038 的 `supplier_mapping_events.reason` 是审核生命周期 Event 的通用可空文本字段，且 Event 已关系化保存 Mapping 版本、事件类型、actor、occurred_at、request_id、result 和终态；批准意见保存到对应不可变 `APPROVED` Event 的 `reason`。`supplier_mappings.review_reason` 继续只承载退回原因并在 APPROVED 时保持空字符串，不把批准意见混入退回语义。因此不新增 0039、不修改 0001—0038，版本保持 `0.1.0-alpha.39`。
- 历史真实性：既有 APPROVED Event 的空 `reason` 表示当时未采集审核意见。读模型和页面固定显示“历史批准未采集审核意见”，禁止补写、猜测或以复核时间冒充批准时间；既有 Event、Mapping Version/CAS、actor、时间和 request_id 均保持不变。
- 预览权威：operations 确认前由 repeatable-read/read-only 服务端查询重新读取稳定 Mapping ID/版本/CAS、Supplier、Material、Unit、有效期、创建/提交成功 Event、当前 Supplier/Material ACTIVE 数量、ACTIVE 有效期冲突和 Supplier 内料号占用。Supplier/Material ACTIVE 状态取各自主表，冲突语义与 0038 的 Supplier part claim、ACTIVE 1:1 有效期约束一致；GET 正常或失败均不得写 Audit 或业务事实。
- 确认与事务：批准窗口使用独立必填 `review_comment`，不接受退回 `reason`；确认时再次读取预览，随后批准事务仍执行权限、自审、CSRF、Origin、限流、幂等、CAS、稳定占用、冲突、正文摘要、单事务 Event/Audit/Idempotency 和故障回滚。按钮同步锁阻止双击形成第二请求；ACTIVE 不可再次批准或原地编辑。
- 凭证投影：成功凭证只由当前 Mapping、不可变 APPROVED Event 和同 request_id 的成功 Audit 投影，展示批准前后 Mapping Version/CAS、最终 ACTIVE、稳定 Supplier/Material、料号、单位换算和有效期；刷新、重新登录和 Web 重启后可重新读取。批准不自动创建 RFQ、Quote、Award、PO 或其他下游事实。
- 主 UAT 边界：本决定只授权 Web 审核保护能力和 operations 只读验收；不得批准或退回剩余七条 PENDING_REVIEW，不得撤销或重做既有 ACTIVE 批准，不得创建 RFQ。是否继续批准剩余七条必须取得新的明确业务授权。
- 实施结果：功能提交 `a86d9adceefb45efca1c43f1f8475703e8fa943d`；无 0039，alpha.39/0038 保持。隔离 PostgreSQL/Chromium、跨域回归、备份恢复和 Web-only 部署通过；主 UAT operations-only 打开 PENDING 预览并取消、重开 ACTIVE 历史凭证后安全退出。保护指纹前后为 `2562f52e82eebbede265e367a5e13e31aa13ab34b5fee16b279d074b10266cd8`，最终仍为 1 ACTIVE / 7 PENDING、下游 0、Session 0。

## D-095 RFQ Mapping 绑定采用关系化版本事实，历史草稿必须显式确认后才能发出

- 日期：2026-08-05
- 状态：`ACCEPTED / IMPLEMENTED / DEPLOYED TO PARALLEL NON-PRODUCTION UAT`
- 确认人：项目负责人（明确指定 Schema 分支、0039/alpha.40、主 RFQ 草稿保护、隔离发出与备份恢复通过后的并行非生产 UAT 部署）
- 缺口与分支：0018/0038 只在 RFQ Supplier 邀请保存 Mapping 摘要，未关系化保存 Supplier×RFQ Line 对应的稳定 Mapping ID、Mapping Version 或版本事实外键；既有创建 Audit 也不是完整 RFQ lifecycle Event。当前 ACTIVE Mapping 不能冒充历史创建时绑定，因此采用分支 B：唯一新增 0039，版本升级为 `0.1.0-alpha.40`，不修改 0001—0038。
- 绑定事实：0039 新增不可变 `procurement_rfq_supplier_line_mapping_bindings`，逐 RFQ/Supplier/Line 保存 Supplier、Material、精确 Mapping version row、稳定 `mapping_uid`、Mapping version/CAS/content digest、Supplier part、Unit、1:1 换算、有效期、绑定状态、来源、actor、时间和 request_id，并以关系 FK/唯一索引证明完整 Supplier×Line 覆盖。新 RFQ 为 traceability generation 2，在创建事务中固定绑定；既有 RFQ 保持 generation 1，迁移不回填任何绑定。
- 创建与确认凭证：新 RFQ 创建事务追加唯一、不可变、credential v2 的 `RFQ_CREATED/SUCCESS` Event，保存 actor、Asia/Shanghai 可投影时间、request_id、Idempotency-Key 摘要、scope digest、`null→v1` 和 `null→DRAFT`。历史 DRAFT 只能由 purchase 通过独立幂等、CAS 的“确认并固定当前 Mapping”事务生成 `LEGACY_DRAFT_CONFIRMATION` 绑定和 `RFQ_MAPPING_CONFIRMED` Event；缺失、重复或不一致时失败关闭。主 `RFQ-00000001` 本任务禁止执行该确认。
- 发出边界：发出前由服务端和 PostgreSQL 共同重验当前 DRAFT/CAS、来源 PRQ 仍为当前 ACCEPTED、上海日期截止日、Supplier/邀请、Material、精确 Mapping stable ID/version/CAS/content/ACTIVE/有效期/1:1/唯一性。成功事务只推进 `DRAFT→ISSUED`，写唯一 `RFQ_ISSUED/SUCCESS` Event、Audit 和 Idempotency 结果；范围与绑定保持不可变，不自动创建 Quote、Award、PO、库存、财务或生产记录。
- 数据库完整性：generation insert/scope/binding/event guards 与 deferred commit guard 防止 header-only、binding-only、缺 Event、缺精确 Audit/Idempotency 或单事务二次 CAS 的半记录。deferred guard 只对本事务 RFQ INSERT、DRAFT Mapping 确认、DRAFT→ISSUED、Binding INSERT 和三类 lifecycle Event执行完整校验；0038 已存在且无绑定的历史 ISSUED RFQ可继续 Quote/Comparison/Award/Close，不伪造 v2 凭证。
- UI 语义：详情明确区分 `DRAFT / 草稿 / 待发出`、历史未绑定草稿的“当前资格/拟绑定”与发出后冻结快照。发出按钮只打开确认窗口；取消、关闭、ESC 零业务请求，默认焦点为取消，确认同步禁用并防双击。窗口列出创建凭证、PRQ、四行、两 Supplier、八 Mapping ID/Version、截止日/CNY、重验结果和发出后不可变/下游零自动创建说明。
- 验证与主 UAT 边界：0039 空库/0038升级/重放/回滚/历史 DRAFT及历史 ISSUED兼容、Unit/UI/PostgreSQL、Material Requirement、真实 Sourcing→Award→Fulfillment、隔离 Chromium、typecheck/lint/build/凭据扫描和 Python 基线均在隔离环境验证。主 UAT 部署和验收只能读取 `RFQ-00000001`、打开发出确认并取消后退出；不得固定 Mapping、发出、录报价或定标。正式发出必须另立任务并重新授权。
- 实施结果：功能提交 `b339acd97f08e4cc09451173b48580015817d9f8`，alpha.40/0039 已部署到受控并行非生产 UAT；0039 SHA-256 为 `3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`，最终 Web 为 `sha256:58d97778d88d6103ca4d6cc3e0bfe8033bf0921a6c1b7ecbec31254403792651`。正式备份/第二库恢复/升级、隔离发出和主 UAT purchase-only 只读取消验收通过。主 `RFQ-00000001` 最终仍为 DRAFT v1、generation 1、Binding 0、Quote/Award/PO 0/0/0；业务 POST 0、Session 0，保护指纹保持 `9d4641b1b6324de4e3a1a26e7461ca2e15bd7613cb99a277c11e6bca869ac66e`。下一任务必须先另获授权显式固定当前 Mapping，不能直接发出。

## D-096 RFQ Binding 直接公开 0039 独立主键并以固定 Event 校验发出凭证

- 日期：2026-08-05
- 状态：`ACCEPTED / IMPLEMENTED`
- 确认人：项目负责人（明确要求诊断 0039 Binding 标识模型，并按已有独立 ID 的分支 A 贯通详情、固定凭证和发出确认；禁止再次固定或发出主 RFQ）
- 主键结论：`procurement_rfq_supplier_line_mapping_bindings.id` 是 `bigserial PRIMARY KEY NOT NULL`，由 PostgreSQL 持久、唯一并可独立引用；它已经存在于 0039，但此前 Repository/DTO/UI 没有明确公开。数组序号、Supplier×Line 复合位置、摘要截断或临时拼接均不得冒充 Binding ID。
- 迁移结论：采用分支 A，不新增 0040、不修改 0001—0039、不回填或重排既有八条 Binding，版本保持 `0.1.0-alpha.40`。Repository 以文本投影 bigint 主键避免 JavaScript 精度损失，并按 Supplier code/ID、Material code/ID、Binding ID 稳定排序。
- 凭证权威：固定凭证必须同时验证预期 lifecycle generation 的唯一 SUCCESS Event、稳定且唯一的 Binding ID、完整 Supplier×RFQ Line 组合、Binding 的 RFQ/Line/Supplier 归属、来源/状态、actor/时间/request_id 归属以及由不可变 Binding 快照重新计算的 scope digest。任一不一致时详情如实标为 UNVERIFIED，UI 禁用发出，POST 返回稳定 `RFQ_MAPPING_CREDENTIAL_UNVERIFIED` 并保持事务零业务写。
- 展示与安全：详情和发出确认明确分列 Binding ID、Mapping ID、RFQ Line ID、Material ID，并显示 Supplier/Material 名称、Mapping Version、supplier part、单位换算、有效期、固定/当前状态和漂移。Mapping 固定凭证可重新打开；所有 GET 使用 read-only 事务且失败不写 Audit，仍执行 purchase 权限和 RFQ/PRQ 数据域。发出 POST 继续重验 CAS、范围数量、摘要、当前 Mapping、PRQ、截止日和下游状态。
- 主 UAT 边界：`RFQ-00000001` 的八个真实 Binding ID、固定 Event 和发出窗口只允许 purchase 读取；桌面/390px均必须取消并安全退出。不得再次固定 Mapping、发出 RFQ、录 Quote、定标或创建 PO；是否正式发出必须由后续独立任务重新授权。
- 实施结果：功能提交 `e329931`，保持 alpha.40/0039且没有 0040；最终 Web `sha256:315f0b7945a7b3eb27841ffaae8a444fba45dd94791519dc856173a95d830635` 已 Web-only 部署。主 UAT 当次页面显示顺序中的 Binding ID 为 `3,4,1,2,7,8,5,6`；该序列只描述整行卡片的排序，不能脱离同行 Supplier/Material/Mapping 后按位置配对。固定 Event、桌面/390px发出窗口和安全退出通过；业务 POST 0、Session 0，RFQ仍 DRAFT v2、Binding 8、ISSUED/Quote/Award/PO 0，保护指纹保持 `9c7b43774e1d0562785933729d40329a69a3230b5b1580473ac29a2463037d3f`。正式发出仍须新的明确授权。

## D-097 RFQ Binding 身份基线以数据库行和稳定外键为准，禁止位置 zip

- 日期：2026-08-06
- 状态：`ACCEPTED / DOCUMENTED`
- 确认人：项目负责人（要求在禁止主 UAT 写入和发出的前提下，逐条诊断 Binding 关联并按 A/B/C 分支处置）
- 权威身份：Binding ID 必须取 `procurement_rfq_supplier_line_mapping_bindings.id`，并与同一数据库行的 `rfq_supplier_id`、`rfq_line_id`、`supplier_mapping_version_id`、`mapping_uid` 和 `mapping_version_no` 一起解释。显示排序、数组位置、Material 顺序、Supplier 顺序或 `index + 1` 均不构成身份。
- 基线结论：主 RFQ 的权威关联按 Binding PK 为 1→Supplier 1/Material 533/Mapping `224d…`、2→1/534/`43ca…`、3→1/535/`aa16…`、4→1/536/`9659…`、5→Supplier 2/Material 533/`45a3…`、6→2/534/`5bd2…`、7→2/535/`3ac2…`、8→2/536/`5432…`。完整 UUID、RFQ Supplier/Line、Mapping fact/version、part、Unit、换算与状态见 FIX-25 完成报告。
- 更正范围：FIX-24 的逐行明细表本来正确；被替代的是将其 UI 显示顺序 `3,4,1,2,7,8,5,6` 与 Material 533—536 列表按位置 zip 的派生旧基线。以后摘要性文档必须标注序列是“显示顺序”，或直接给出逐行关联表。
- 完整性结果：限定范围只读事务确认八条 FK/Mapping Version 全部匹配，重复、孤儿、跨 RFQ和错配均为 0；现有 `canonicalDigest` 重算固定摘要为 `9765f8fdef768335a25b314867dd3e077429a84848cba067ff8394c8a017848d`，与唯一成功 Event 一致。
- 实施边界：采用分支 B，只更正文档和验收基线；不修改代码、Migration、数据库、Web镜像或运行面，不登录主 UAT，不执行备份/恢复/部署，不发送业务 POST。RFQ保持 DRAFT v2、Binding 8、Mapping Event 1、ISSUED/Quote/Award/PO 0。

## D-098 RFQ 发出确认以独立 Binding 状态、稳定 ID 行和穷举下游保护为硬性合同

- 日期：2026-08-06
- 状态：`ACCEPTED / IMPLEMENTED / DEPLOYED TO PARALLEL NON-PRODUCTION UAT`
- 确认人：项目负责人（明确要求补齐发出确认硬性合同、消除 Binding状态与摘要排序歧义，并禁止发出主 UAT RFQ）
- 状态模型：0039 权威表具有独立 `binding_status text NOT NULL` 且CHECK限定 `ACTIVE`，因此确认窗口必须把“Binding状态：ACTIVE”“Mapping状态：ACTIVE”“邀请状态：INVITED”分栏，并另列固定来源、状态漂移和版本漂移。尚未固定的资格行必须显示无Binding记录，不得伪造ACTIVE。
- 操作合同：入口可保持“发出询价并冻结范围”，最终写按钮只能显示“确认发出”；默认焦点为取消等非破坏性控件。取消、关闭、ESC和背景关闭均为零业务请求，确认首次触发同步禁用；服务端既有权限、CSRF、Origin、CAS、幂等、并发、事务和审计门禁不得因UI措辞放宽。
- 下游保护：窗口必须逐项声明本次发出不会自动创建或修改Quote、Award、PO、Delivery Plan、Receipt/收货、Inventory Ledger/库存流水、AP/采购应付、Work Order/生产工单、其他生产记录和财务记录；“库存或财务”等概括不能替代收货、AP和生产记录。
- 身份与摘要：身份主展示固定按数值Binding ID升序并以同一数据库行的Supplier、RFQ Line、Material和Mapping外键解释。摘要规范化排序只服务`canonicalDigest`，不得以数组位置定义身份；旧`3,4,1,2,7,8,5,6`序列不得进入易被理解为配对关系的主字段。已保存Binding、摘要算法、固定摘要和`RFQ_MAPPING_CONFIRMED` Event保持不可变。
- 实施结果：功能提交`f6f7d2a`，保持alpha.40/0039且没有0040；最终Web `sha256:c8c3fdd52236b84e3ceb67f7b81ca2e5530bfaba964a92ebd22dab9f7da19989`已Web-only部署。隔离发出、正式备份/第二库恢复及purchase-only桌面/390×844只读取消通过；`business_post=0`、Session 0，保护指纹保持`9c7b43774e1d0562785933729d40329a69a3230b5b1580473ac29a2463037d3f`。
- 主 UAT边界：主`RFQ-00000001`仍为DRAFT v2、Binding 8、Mapping Event 1、ISSUED/Quote/Award/PO 0。本决定和本次部署不授权发出；正式点击“确认发出”必须另立任务并重新校验当前CAS、Binding、摘要、Mapping、PRQ和截止日。

## D-099 RFQ聚合CAS包含Supplier响应，固定范围漂移与邀请生命周期必须解耦

- 日期：2026-08-06
- 状态：`ACCEPTED / IMPLEMENTED / DEPLOYED TO PARALLEL NON-PRODUCTION UAT`
- 确认人：项目负责人（明确要求诊断Quote提交后的RFQ CAS与邀请状态权威语义，保留Supplier A Quote并禁止在主UAT创建Supplier B Quote）
- 聚合语义：RFQ Head `version`是整个询价聚合的CAS，不只保护RFQ Header或发出范围。Supplier首版Quote提交在一个Repository事务内锁定RFQ并校验CAS，插入Quote Header/Lines，把对应邀请`INVITED→RESPONDED`，推进RFQ Version一次并写Quote Event/Audit/幂等结果。因此主RFQ`ISSUED v3→ISSUED v4`和Supplier A `INVITED→RESPONDED`均为正常成功语义，不得回退到v3或把RESPONDED纠正为INVITED。
- 范围漂移：冻结范围完整性只由固定Binding数量/稳定ID/归属、Supplier与RFQ Line固定集合、Mapping ID/Version/Row CAS/content digest/状态/有效期/唯一性和固定scope digest决定。邀请响应状态及RFQ当前聚合CAS相对发出Event的变化不是Mapping漂移谓词；真实Binding/Mapping变化继续失败关闭。
- Supplier独立性：每个RFQ Supplier邀请具有独立生命周期。Supplier A成功报价后为RESPONDED且不再允许直接提交首版；Supplier B保持INVITED、无Quote且可独立提交首版。页面和服务端必须按Supplier投影入口，不能因另一Supplier已响应而关闭整个RFQ报价入口。
- Quote身份与Event：现有0039/0018模型没有独立Quote业务编号列，稳定数据库ID是当前权威身份；页面必须明确“未设置独立Quote业务编号”，不得伪造。Quote由单事务直接提交，只产生`QUOTE_SUBMITTED`，没有独立CREATE Event。现有Event未记录Quote版本转换时必须显示“事件未记录版本转换”，当前Quote v1从Quote Header独立显示；禁止渲染`vnull`、反推或回填历史Event。
- 金额与交期：详情服务端必须投影或核对数量、单价、行金额、总额、需求日期、承诺日期、提前/延期天数、`ON_TIME|LATE`和中文解释；浏览器只做显示格式化，不能成为金额或交期业务语义的唯一权威。
- 迁移决定：0039已经保存全部必需权威事实，故不修改0039、不新增0040、不回填历史Event，版本保持`0.1.0-alpha.40`。
- 实施结果：功能提交`1be492e68f6635bc00ea3fb8ce461eac0617d8e7`，最终Web`sha256:20b41bd34741758e707f3748baaa1018232df6be5d44cd63bed290fd49c9f4f9`已Web-only部署。正式备份/第二库恢复、隔离PostgreSQL/Chromium和purchase-only主UAT只读验收通过；保护指纹始终为`597eb456837e0cda35d3544c1aeae94f3a190eed373d1145de5a72261fe37f9f`。最终RFQ ISSUED v4、Binding 8、固定摘要`9765f8fdef768335a25b314867dd3e077429a84848cba067ff8394c8a017848d`、Supplier A Quote ID 1/SUBMITTED v1、Supplier B Quote 0、Quote/Award/PO 1/0/0、business POST 0、Session 0。
- 后续边界：本决定只确认当前语义和展示，不授权Supplier B报价、Supplier A修订、Comparison、Award、PO或其他下游。任何后续写入必须另立任务并重新读取当前CAS和保护事实。

## D-100 Comparison Version采用关系化复合身份、服务端状态投影和确定性摘要

- 日期：2026-08-06
- 状态：`ACCEPTED / IMPLEMENTED / DEPLOYED TO PARALLEL NON-PRODUCTION UAT`
- 确认人：项目负责人（明确要求复用逐RFQ Line Comparison模型，补齐版本级追溯、聚合摘要、Event操作分组和移动端展示；禁止创建Award/PO或默认新增0040）
- 身份决定：`procurement_quote_comparisons.id`继续是每条Comparison Line的稳定数据库ID；现有关系模型没有独立Comparison Header ID，不伪造整数Header。Comparison Version的权威复合身份由RFQ ID、Round、Comparison Version以及按RFQ Line稳定排列的全部持久化`basis_digest`共同确定，页面必须如实说明该边界。
- 状态投影：Schema没有独立Comparison状态列。服务端将RFQ/Round最新Version且其固定Quote输入仍为当前可定标版本投影为`CURRENT`；存在更新Version的历史版本投影为`SUPERSEDED`；最新Version若固定输入已漂移则失败关闭定标并投影`INPUT_DRIFT`。这些都是读模型状态，Award仍由服务端和数据库按最新Comparison Version、固定Quote Line和当前资格重新验证，不能信任页面标签。
- 输入与输出摘要：输入摘要直接展示逐Comparison Line持久化`basis_digest`，不创造单一aggregate持久化摘要。输出摘要由服务端按Material ID、Supplier ID、Comparison Line ID、Comparison Candidate ID稳定排序，从已保存Comparison Candidate和不可变Quote Line重算Version、固定Quote Line、Material、Supplier、数量、单价、行金额、排名、承诺日期、交期状态及提前/延期天数；该摘要是确定性读模型字段，不回填历史数据库字段。
- 聚合与Event：Supplier总额、最晚承诺日、交期风险、Supplier间金额/百分比/日期差和逐Material对比均由同一确定性服务端读模型投影。Comparison Event必须独立查询，按actor、时间、request_id和result形成一次“Comparison生成操作凭证”；主UAT真实四条Line级Event应逐条关联Comparison Line/Material，但不得解释为四次点击或四个Comparison Version，也不得删除、合并或改写历史Event。
- 生成与迁移：当前Quote输入摘要已存在于任一完整Comparison Version时，生成操作幂等返回该Version且不新增Comparison Line、Candidate、Event或RFQ CAS；Quote修订形成新当前输入后才允许生成下一Version，旧Version永久不可变。0039已保存稳定Comparison/Quote Line引用、basis、排名、金额、日期及Event身份，足以重算读模型，因此不修改0039、不新增0040，版本保持`0.1.0-alpha.40`。
- UI与任务边界：桌面使用对比表，390×844使用Supplier汇总卡、Material逐项卡和可折叠追溯凭证；长digest/request_id可换行复制，生成按钮按服务端状态禁用，定标入口保持可见。本决定只授权Comparison读模型、幂等保护、Web-only部署和purchase-only只读验收；不授权打开定标窗口、创建Award、转PO或其他业务写入。
- 实施结果：功能提交`80e1ad60fa1272017545e150721c8b71f7c68828`，最终Web`sha256:0dfcc0a8639e09e6ca0380292d979a2f73510a76cdcd23d46001bfb9c145273d`已Web-only部署。主UAT确定性输出摘要`79554d88ccdb643a860c0c69e77222abce80eb4d3d8314d88135d3966fb619ec`，保护指纹`16d70f1865e3a2e3b0e840f289d13b340e4f6b87800b1c79d98865112d0cf5bc`前后不变；purchase-only桌面/390×844只读通过，business POST 0、Session 0、Award/PO 0/0。当前`awardable_now=true`只表示具备另立人工定标任务的技术前置条件，不构成本任务授权。

## D-101 Award候选必须绑定稳定Comparison Candidate并由服务端重验非最低价理由

- 日期：2026-08-07
- 状态：`ACCEPTED / IMPLEMENTED / DEPLOYED TO PARALLEL NON-PRODUCTION UAT`
- 确认人：项目负责人（明确指定RFQ 1四行Candidate权威分组、允许有完整理由选择非最低价Supplier A，并禁止主UAT创建Award或PO）
- 候选身份：浏览器提交的每行选择值只能是`procurement_quote_comparison_lines.id`的规范十进制字符串；Candidate必须经`comparison_id`关联指定Comparison Line，并经固定`quote_line_id`关联不可变Quote Line与Quote Header/version。数组位置、Supplier名称、价格、显示标签和RFQ Line编号均不得替代Candidate身份。
- bigint合同：Comparison Line、Candidate、Quote、Quote Line、RFQ Line、Material和Supplier等PostgreSQL bigint在DTO边界保持字符串；只允许对业务金额、数量和显示顺序做明确数值处理，不得以JavaScript `Number`严格比较决定候选归属。
- 当前与可定标：`CURRENT`是D-100定义的Version级服务端投影，不是Candidate数据库字段。候选必须同时属于同一最新Version、固定Quote输入仍当前、`COMPARABLE`且`awardable=true`；不得因Supplier已`RESPONDED`、Candidate为rank 2或不是最低价而从合法候选中删除。
- Award重验：服务端按当前RFQ/Round/CAS锁定聚合，要求四个Material各且仅一次、无缺行/重复/额外行，逐项重验Candidate归属、Comparison Version、Quote/Quote Version/Quote Line、Supplier、数量、单位、币种、价格、交期、输入与输出摘要。Award Line保存的Comparison Line与固定Quote Line组合必须唯一回溯所选Candidate；历史Version、跨Line、错Quote、输入漂移、过期CAS和非CURRENT均失败关闭。
- 非最低价原因：rank大于1的选择只接受适用的原因语义；本任务正式验证`DELIVERY_PRIORITY / 交期优先`及完整理由。已知但不适用的代码不得仅因枚举合法而放行。Origin、CSRF、purchase权限、幂等正文摘要、并发单胜、事务、审计和故障回滚保持。
- 确认合同：四行初始均不默认获选；确认窗口必须显示RFQ/Round/CAS、Version/CURRENT、逐行basis与output digest、四行Material/Candidate/Quote/Supplier、总额/最低价/差额/百分比、交期差、原因与完整理由，并明确只新增Award及四条Award Line，不自动创建PO、到货计划或其他下游。安全默认焦点为取消，取消、ESC和遮罩关闭均为零业务POST。
- Schema与任务边界：0018/0039已提供无歧义Candidate、Comparison与Quote Line关系以及Award Line约束，不修改0039、不新增0040、不改历史Candidate ID或Comparison数据。隔离环境可创建一次Award验证事务结果；主UAT只允许purchase选择Supplier A、打开桌面/390×844确认窗口并取消，最终必须保持Award/Award Line/PO`0/0/0`。
- 实施结果：功能提交`99a5e6bfe255cb46a0384106eb8ec0a08ec96832`已Web-only部署为`sha256:f239ffe3059cfbd5cbb26a45d0960249450ec61989a8f91fb4e17dff3e26e4c1`。隔离Chromium选择Candidate`2/4/6/8`并仅POST一次，结果Award 1、Award Line 4、PO 0；主UAT只登录purchase并在桌面/390×844确认窗取消，business POST 0、Session 0、Award/Award Line/PO`0/0/0`。正式备份/第二新库恢复通过，保护指纹保持`16d70f1865e3a2e3b0e840f289d13b340e4f6b87800b1c79d98865112d0cf5bc`。真正人工定标仍须新的明确授权及当时CAS/摘要/Quote/Candidate重验。

## D-102 Award历史以稳定关系事实、派生决策摘要和分离的Event/Audit证据为准

- 日期：2026-08-07
- 状态：`ACCEPTED / IMPLEMENTED / DEPLOYED TO PARALLEL NON-PRODUCTION UAT`
- 确认人：项目负责人（要求补齐现有Award 1的聚合身份、四条Line引用、原因、摘要、Event/CAS和状态投影；禁止重做、撤销、回填、转PO或新增0040）
- 聚合身份：`procurement_sourcing_awards.id`是Award稳定数据库主键；当前Schema没有独立Award业务编号，不得由ID拼造业务编号。模型有真实`version`字段；现有Award为v1/AWARDED。AWARDED Header与四条Line是同一用户事务形成的事实，不得为展示原地改写。
- Line引用：`procurement_sourcing_award_lines.id`是稳定Line主键。Candidate身份由Award Line已保存的Comparison Line与Quote Line组合在不可变Comparison关系中唯一解析，并继续闭合到Quote Header/version、Supplier、RFQ Line、Material和Unit；任何缺失、重复、歧义或跨RFQ引用都必须失败关闭，不得Migration或SQL回填主UAT事实。
- 摘要边界：既有`procurement_sourcing_awards.award_digest`是创建事务保存的Award请求摘要，不含数据库生成的Award/Line ID，不能冒充完整decision digest。当前Schema没有持久化`decision_digest`；服务端按`AWARD_DECISION_V1`、Award Line ID数值升序，从Award/RFQ/Round、Comparison Version/output digest、Line/Comparison/Candidate/Quote/Quote Line/Supplier/Material/Unit、数量、单价、金额、币种及规范化理由确定性重算。页面必须明确标注其为非持久化派生值，不回写数据库，也不得以Comparison output digest代替。
- Event/CAS边界：Award操作凭证只接受与Award actor、时间、request_id、结果及理由精确一致的唯一AWARDED Event。Event没有old/new version时必须显示“历史Award Event未记录版本转换”，禁止显示`vnull`或反推字段；只有同request_id、同actor且唯一成功的精确Audit才可独立证明提交前CAS与推进值，当前CAS仍直接来自RFQ Head。Audit不得冒充Event字段。
- 状态投影：Comparison的`CURRENT`只表示它仍是当前有效比较版本，不等于仍可定标。RFQ已有Award后`awardable_now`必须为false，创建表单和确认按钮必须消失。`po_convertible_now`是服务端只读投影，至少同时要求Award为AWARDED、RFQ为CLOSED、Line完整、引用闭合、来源采购申请仍ACCEPTED且PO计数为0；真正转换仍由独立任务在写事务重新验证权限、Award CAS、Supplier、Mapping和幂等。
- 实施结果：采用现有事实充分的分支A并叠加无业务编号的准确显示，不新增Migration或0040。功能提交`a014742`，派生decision digest为`7beca9f364718d9161cc4205e282279cdcc97e3fee91073f3494b76abfa7651a`；最终Web`sha256:bb544f89ac405c9565fa551c4120c89d4cc58022220db9a3f46c548a6533a81d`已Web-only部署。正式备份/第二库恢复和purchase-only桌面/390×844主UAT通过，business POST0、Session0，Award/Line/Event/PO保持`1/4/1/0`。真正转PO仍须新的独立明确授权和事实重验。

## D-103 Award转PO必须使用权威只读预览和单事务最终确认

- 日期：2026-08-07
- 状态：`ACCEPTED / IMPLEMENTED / DEPLOYED TO PARALLEL NON-PRODUCTION UAT`
- 确认人：项目负责人（明确要求修复“显式生成采购订单”直接POST，授权隔离正式转换、备份恢复、Web-only部署和purchase-only主UAT打开/取消，禁止主UAT创建PO）
- 两阶段合同：入口点击只允许通过只读一致快照重新读取Award、RFQ、Comparison、固定Quote、Award Event、两类摘要、完整Line、当前PO/计划计数、Supplier和付款条件后打开确认窗口。取消、关闭、ESC和背景关闭均为零业务POST，默认焦点为取消；只有明确最终确认才发送POST，按钮同步锁定，失败不自动重试。
- 服务端权威：最终请求中的CAS、摘要、PO计数和Line ID只作为确认断言；Supplier、Material、单位、数量、价格、币种、交期和转换范围必须从不可变Award及其Comparison/Quote来源重新读取。服务端继续执行purchase权限、Origin/CSRF、幂等正文摘要、Award/RFQ CAS、完整唯一行集、当前Supplier/Mapping、并发单胜和故障回滚；任何漂移失败关闭。
- 聚合与计划：PO按`Supplier ID + Currency`确定性聚合；每条Award Line只允许转换一次并固定对应一条PO Line。现有Delivery Plan模型没有独立Header/Line分层，每个`purchase_delivery_plans`记录本身就是直接唯一绑定一条PO Line的计划聚合。因此主样本权威结果是1次转换、1个PO、4条PO Line、4个Delivery Plan，不存在独立计划Line记录。
- 事务与下游：最终确认在一个服务端事务中创建PO、PO Line、Award→PO Line Link、逐Line Delivery Plan、收货队列、PO/计划Event、成功Audit和幂等结果；失败零半记录。该事务不创建Receipt、Warehouse Receipt、Inventory Ledger、IQC、AP、Payment、Work Order或其他生产/财务记录，后续到货、收货和IQC必须另立任务。
- 字段与迁移：现行PO模型有正常header备注字段但没有外部参考字段。窗口允许最多2,000字PO备注并准确显示“当前PO模型未采集外部参考”；不得挪用其他字段，不新增或运行0040，版本保持alpha.40/0039。
- 主UAT边界：主UAT只允许purchase打开Award 1转换窗口、核对桌面与390×844、填写备注后取消、刷新和安全退出；业务POST必须为0，PO与Delivery Plan前后均为0。真正转换仍须新的独立明确授权。
- 实施结果：入口、权威预览、确认窗口、最终转换DTO和同事务写保护均已实现；最终确认在幂等回放检查之后复用外层事务连接读取完整Award历史，避免低容量连接池嵌套取连接。隔离结果为`1 PO / 4 PO Line / 4 Delivery Plan`，`max=2`连接池并发单胜、强制故障全部半记录为0；延迟/失败Chromium证明立即禁用、失败不重试和迟到预览不复活。Web`sha256:2396c8bc4fd5658c26cef11c4a438b2edb474607b73b2b8ee7fe337b125575ed`已Web-only部署；正式备份/第二库恢复和主UATpurchase-only桌面/390×844打开后取消通过，`preview_get=1`、`business_post=0`、Session0，PO/Delivery Plan保持0。

## D-104 Award转PO的Supplier Mapping资格必须沿固定RFQ Binding复用统一服务端合同

- 日期：2026-08-08
- 状态：`ACCEPTED / IMPLEMENTED / DEPLOYED TO PARALLEL NON-PRODUCTION UAT`
- 确认人：项目负责人（要求诊断并修复Award 1转PO时四条已固定Supplier A Mapping被误判的问题，授权分支A实现、隔离测试、备份恢复、Web-only部署和purchase-only取消UAT；禁止重试主UAT转换、修改Mapping或创建主UAT PO）
- 权威身份：每条资格只能沿Award Line→Comparison Candidate→固定Quote Line→RFQ Supplier/Line→唯一RFQ Binding→固定Mapping fact追溯。Mapping身份使用UUID、fact ID、固定version、row CAS和content digest；Supplier名称、supplier part、价格、数组位置及名称桥接均不得决定身份。
- 统一资格合同：GET预览与最终POST必须复用同一个服务端资格函数和`AWARD_PO_MAPPING_QUALIFICATION_V1`行级DTO；每次调用使用单一明确as-of及`[valid_from, valid_to)`边界。结果逐行返回Award Line、Candidate、Quote Line、Binding、Supplier、Material、Mapping、状态、Unit、换算、有效期、digest、冲突数、`qualified`、稳定错误代码和中文原因。
- Unit与兼容边界：关系化`material.base_unit_id`存在时直接使用；legacy Material仅可按D-091由`base_uom`精确解析唯一启用Unit。Supplier/Internal Unit必须一致，换算分子分母必须为正且数值相等；不得把合法legacy PCS物料误判为缺失Mapping，也不得放宽非1:1或歧义Unit。
- 冲突与类型边界：资格基于固定Mapping fact，而非动态反向选择Mapping；同时核验Supplier/Material当前ACTIVE冲突及Supplier内supplier part冲突。Mapping Event/Version join不得改变fact基数；PostgreSQL bigint在DTO和比较边界保持规范十进制字符串。
- 预览与漂移：`po_convertible_now=true`只允许在完整四行全部qualified且PO/PO Line/Delivery Plan为0时返回。确认窗口必须展示四行资格凭证；最终POST在当前事务as-of重新计算同一资格摘要，并拒绝预览后的Binding、Mapping状态/version/CAS/digest、有效期或相关身份漂移，无关Mapping变化不得阻断。
- 事务边界：最终POST锁定Award、Award Line及固定资格事实，不信任浏览器传入Supplier、Material、价格或Mapping ID；PO Line固定保存对应Mapping fact引用。PO、四条PO Line、四条Delivery Plan、四条queue及Event/Audit/幂等结果继续在单事务创建，任一失败全部为0。
- 主UAT边界：失败请求`f30a7801-1cd0-4849-95a8-9c61d5c52e67`及其唯一HTTP 422事实必须保留。主UAT只允许purchase打开Award 1预览、核对桌面/390×844、填写备注后取消并退出；`business_post=0`，Award、Mapping、PO及计划前后不变。
- 实施结果：采用分支A，不新增或运行0040。功能提交`1f205af0bf81379345a09353d9d32ab5c7545971`；GET/POST共享资格服务、逐行凭证、事务锁后重算和固定Mapping fact的PO Line谱系已通过隔离测试。Web由`sha256:2396c8bc4fd5658c26cef11c4a438b2edb474607b73b2b8ee7fe337b125575ed`Web-only替换为`sha256:83c1bff341294d1bee2db8fd2ee963204012cfac63f1289ba7d3755ca2920664`；正式dump SHA-256`d3cf053f09948c6e4ae54caff028a7663a3750249bcaf3e8758e2f0ace49c5c2`已list并恢复第二新库。主UATpurchase-only桌面/390×844核对四行qualified后取消，`preview_get=1`、`business_post=0`、Session0；失败请求、四条Mapping及Award/RFQ保持，PO/PO Line/Delivery Plan/queue仍为0。

## D-105 Controlled retention of unauthorized UAT PO-00000001

- 日期：2026-08-08
- 状态：`ACCEPTED / CONTROLLED RETENTION / FORWARD AUTHORIZATION ONLY`
- 确认人：项目负责人（明确要求对未经事前授权的UAT PO作出受控保留决定，并限定后续只读追溯边界）
- 控制事件与授权属性：本书面决定及其独立Git提交构成控制事件，只提供前向授权，并采用“不追溯性授权”原则；它不改变原始写入的授权判断。该对象继续分类为“未经事前授权但结构完整的UAT写入”，即数据结构完整但来源授权不可证明。
- 事实基线：PO为`ID 1 / PO-00000001`；唯一成功创建请求为`773c23b6-0923-4ab5-a451-bb80aa4bdf9d`，actor为`uat_20260729_purchase`，创建时间为`2026-08-08 14:11:45.086372 Asia/Shanghai`。结构`PO / PO Line / Delivery Plan / queue = 1 / 4 / 4 / 4`；来源Award为`ID 1 / v1 / AWARDED`，Supplier为`ID 1 / SUP-000001`，金额为`480.00 CNY`。Receipt、Ledger、IQC、AP、付款和生产记录均为0。权威取证见[SELFHOST-UAT-AUDIT-34](../tasks/SELFHOST-UAT-AUDIT-34.md)。
- 控制结论：
  1. 原始PO写入无法绑定到仓库内事前授权的任务执行流。
  2. 不把该写入追溯描述为具有事前授权。
  3. 分类继续为“未经事前授权但结构完整的UAT写入”。
  4. 原样保留该PO、四条PO Line、四条Delivery Plan、四条queue，以及Event、Audit和Idempotency证据。
  5. 不删除、不修改、不取消、不重建该PO，也不重试或重复执行Award→PO转换。
  6. 从本书面决定正式提交后，允许把现有`PO-00000001`作为后续UAT的固定起点。
  7. 本决定只授权后续只读PO追溯验收。
  8. 本决定不自动授权到货、收货、IQC、入库、库存、AP、付款或生产操作。
  9. 每个后续写阶段仍须获得独立明确授权。
  10. 在进入仓库或IQC前，必须先补齐并验收PO历史页面的完整谱系和凭证。
- 后续门禁：Award→PO转换不再重试。下一任务只能是PO历史追溯页面修复/验收，且本决定对UAT的授权范围仅为只读追溯验收；warehouse、quality和finance试用仍未授权。Receipt、IQC、Ledger、AP和生产记录必须保持0，任何偏离都必须立即停止并重新取证。

## D-106 仓库实际收货采用关系化证据、服务端时间和按检验模式分流

- 日期：2026-08-08
- 状态：`ACCEPTED / IMPLEMENTED / DEPLOYED TO PARALLEL NON-PRODUCTION UAT`
- 确认人：项目负责人（明确要求修复仓库收货最小权限追溯、两阶段确认、日期/提前到货证据门禁及IQC职责边界，并授权隔离写测试、正式备份恢复、0040、Web-only部署和warehouse-only零业务POST主UAT）
- 业务动作边界：当前收货模型只表示实物已到并执行实际物理收货，不表示Supplier通知或在途登记；系统没有独立通知模型时不得借用Receipt伪造。实际过账时间只能由服务端事务生成，不接收浏览器实际到货时间，也不得把计划日期冒充实际时间。证据日期不能在服务端当前业务日期之后。
- 提前到货规则：早于承诺/计划日期不是永久禁止，但最终POST必须关系化保存可审计送货单或等价来源凭证、提前到货原因和显式提前确认；缺任一项以稳定`EARLY_ARRIVAL_EVIDENCE_REQUIRED`及中文提示失败关闭。正常到货仍须送货凭证；Supplier批次只在对应Material批次策略适用时必填，否则保存明确不适用投影。目标仓库/库位当前为权威固定`MAIN`，浏览器不能改写。
- 关系化存储：现有Receipt/Allocation及自由备注不能完整承载上述证据，也没有Plan/queue CAS谱系，故采用新分支：唯一新增`0040_warehouse_receipt_readiness.sql`并升级`0.1.0-alpha.41`，不修改0039及更早Migration。`warehouse_receipt_evidence`不可变绑定Receipt、Receipt Line、Allocation、PO、PO Line、Delivery Plan和queue，保存凭证、证据日期、提前事实、原因/确认、Supplier批次适用值、MAIN、预期版本、actor、request和服务端时间；索引、外键、CHECK与服务触发器共同校验完整关系和版本推进。
- 两阶段与事务：第一阶段只允许warehouse用最小权限DTO执行权威GET预览；数量、说明及证据默认空，取消为默认焦点，关闭/ESC/背景均零业务POST。只有显式“确认过账收货”发送一次POST，按钮同步锁定且不重试。最终事务重新锁定PO/Line/Plan/queue，验证状态、剩余量、四类CAS、权限、CSRF、Origin、限流和正文幂等；Receipt、Line、Allocation、Evidence、Plan/queue推进、Lot/IQC/Ledger、Audit/幂等结果要么全部提交，要么全部回滚。
- 最小权限读模型：warehouse可查看PO稳定身份/商务、唯一成功创建actor/上海时间/request/operation/action/result、Line→Award Line→Material、Plan/queue版本状态及下游计数；不能获得`system.audit.read`，不能读取请求正文、Cookie、Session、敏感Header或跨数据域对象。产品不得硬编码D-105或目标PO，也不得把D-105前向控制事件描述为原始写入已获授权。
- IQC和库存会计：收货结果必须按当前Material库存/检验模式从实际服务端模型投影，而不是统一宣称均需IQC。需要IQC的库存物料在收货事务生成Receipt、内部RML冻结Lot与`IQC_RECEIPT` Ledger，可用量保持0并移交quality；quality作出合格等独立决定后才按既有流程解冻/增加可用量。普通`STOCKED/NORMAL`物料不生成RML Lot、IQC冻结或IQC队列，收货事务生成普通`RECEIPT` Ledger并立即重算可用量。warehouse无Supplier IQC写权限，quality保持既有授权；不合格、退货和让步接收都是独立操作。
- 下游隔离：收货不会自动创建AP、Payment、Work Order或其他生产记录；本决定不改变既有库存会计语义，也不授权任何主UAT实际Receipt、IQC、Ledger、AP、付款或生产操作。主样本Material 533—536当前均为`STOCKED/NORMAL`，这只决定当次权威预览文案，不被硬编码为通用事实。
- 实施结果：功能提交`a6fc8b33af73d5ffd0da03566ef1f28d4207722b`，mode语义修正提交`20a9123741862d81ac18af9e6bdee896674fe95c`；0040 SHA-256`b6781c94da3f52a8f719ce57cdf13acbb4e3fe1c66f2a0480bdb6a9ff10a5a93`。隔离迁移/写路径、正式dump/list/第二新库恢复、0039→0040和Web-only部署通过，最终Web`sha256:0cf98937f3ae28fe68e84436ab85c12ef5e8922f50a04973641cb79b8a0d5f19`。warehouse-only主UAT只读/预览取消，`business_post=0`、Session0，PO/Line/Plan/queue保持`1/4/4/4`，Receipt/Evidence/Lot/IQC/Ledger/AP/付款/生产全0。

## D-107 收货预检日期、实际检验模式投影与返回修改语义

- 日期：2026-08-09
- 状态：`ACCEPTED / REQUIREMENT DECIDED / IMPLEMENTATION NOT STARTED`
- 标题：`D-107：收货预检日期、实际检验模式投影与返回修改语义`
- 确认人：项目负责人（要求先完成需求决策，只记录服务端日期预检、实际模式投影和返回修改语义；本阶段禁止源码、构建、Migration、部署及UAT收货操作）

### Context

- FIX37黑盒补充证明，当前`openPreview`只向Receipt preview传`quantity`，没有传`evidence_document_date`；preview合同也没有未来日期校验，而`confirmationReady`只检查日期非空。因此未来证据日期可进入可执行确认窗口。
- 最终Receipt POST已在自己的事务中用Asia/Shanghai服务端业务日期拒绝未来日期，0040触发器也独立约束Evidence日期不晚于Receipt服务端时间；当前主UAT Receipt及全部下游仍为0，未发生数据安全事件。
- 黑盒补充对NORMAL样本缺少“假设IQC结果”和确认窗关闭后编辑字段保留的FAIL判断不成立：前者与实际模式投影原则冲突，后者是返回编辑所需的未提交草稿保留。

### Decision

1. Receipt preview必须接收`evidence_document_date`，并在服务端只读事务中用该事务的`transaction_timestamp() at time zone 'Asia/Shanghai'`业务日期验证；浏览器`Date`、`Date.now()`、客户端时区或HTML `max`不得成为权威。
2. 未来日期必须返回HTTP 422、`RECEIPT_EVIDENCE_FUTURE_DATE`、`送货凭证日期不能晚于服务端实际收货日期`和request_id；UI展示这三项且不得打开可执行确认窗口。今天及过去日期继续预览。
3. 最终Receipt POST必须在自己的写事务中重新计算Asia/Shanghai业务日期并独立验证；preview不替代POST。0040触发器继续独立兜底，本决定不修改Migration。
4. “本次过账后果”只投影当前Material的实际inspection mode。NORMAL不得描述RML、FROZEN或RELEASE→UNFREEZE；实际IQC行必须显示内部RML Lot、初始FROZEN、`IQC_RECEIPT` Ledger、可用量0及quality RELEASE后UNFREEZE。NORMAL订单没有假设IQC结果不是缺陷。
5. 取消、右上角关闭、ESC和背景关闭均表示“放弃本次最终确认，返回编辑”，保持业务POST 0。实施时按钮改名“返回修改”；关闭必须清除modal、preview snapshot、loading、submitted、dialog error、提交锁与idempotency state，同时保留编辑区尚未发送的草稿，且不得调用`form.reset()`。
6. modal关闭后字段仍保留是预期草稿语义，不是状态泄漏；modal、preview、提交或幂等状态未清除才是缺陷。

### Consequences

- FIX38的唯一已确认缺陷是未来证据日期没有在权威GET预检阶段失败关闭；最终POST和0040既有防线保持有效且仍需回归验证。
- 实现需要调整Receipt UI、preview Handler/Service及Unit/UI contract/隔离PostgreSQL测试，但不需要Schema或Migration；计划候选版本为alpha.42，目前未实现、构建、部署或发布。
- 关闭确认窗不清空业务编辑表单；用户可以修改原值后重新请求新的权威preview。旧preview、请求错误、提交锁及幂等身份不得跨确认周期复用。

### Rejected alternatives

- 拒绝用浏览器`Date`、`Date.now()`或客户端时区判定业务日期。
- 拒绝只依赖HTML date input的`max`属性；它只能提供交互提示，不能成为安全门禁。
- 拒绝把假设IQC结果混入NORMAL订单的“本次过账后果”。
- 拒绝在关闭确认窗时清空全部输入；这会破坏返回修改语义并迫使重复录入。
- 拒绝让preview成功替代最终POST的事务内日期复核或数据库约束。

### Deferred work

- 面向培训的NORMAL/IQC比较面板延后单独任务，且必须明确标记为非当前过账事实。
- “清空本行”按钮、显式清空及成功提交后的自动清空策略延后决定；FIX38不实现。
- 采购会计、quality、finance、Python/SQLite和历史Sites/D1均不在本决定范围。

### Verification boundary

- 当前仅记录需求和实施验收基线；不修改代码、测试、Schema、Migration、依赖或部署配置，不构建、不部署、不重启。
- 可只读核验Git、容器、资源、Migration ledger、warehouse账号/Session及PO/下游计数；不得登录UAT、调用Receipt preview或发送业务POST。
- 轻量lint和UI contract测试必须先确认无数据库URL、网络访问和UAT/生产写路径；后续PostgreSQL写测试只能使用隔离数据库。
- 本决定不授权任何主UAT Receipt POST、IQC、Ledger、AP、Payment或生产写入；PO/Line/Plan/queue必须保持`1/4/4/4`，Receipt及全部下游保持0。

## D-108 私有Git恢复远端与alpha.42三锚点恢复策略

- 日期：2026-08-10
- 状态：`ACCEPTED / PHASED IMPLEMENTATION / GIT PRIVATE RECOVERY ANCHOR ESTABLISHED`
- 确认人：项目负责人（在`GITHUB AUTHORIZATION BLOCKED`后明确要求Codex协助配置GitHub CLI、认证并继续建立私有恢复远端）

### Context

- 当前`main`相对公开`origin/main`领先186个纯fast-forward提交，全部对象、拓扑和秘密扫描已通过，但出站历史包含内部项目文档、UAT标识、服务器路径、网络/容器和备份拓扑，不能推送到public仓库`3443176848/chenyida`。
- alpha.42源码历史、通过镜像和最新PostgreSQL/文件卷恢复材料仍主要位于同一服务器，存在单机故障域风险。Git、镜像和数据库/文件卷必须分别建立可独立验证的恢复锚点。
- 前次执行因本机无`gh`且GitHub应用没有创建仓库接口而在任何变更前停止；项目负责人现授权安装并配置`gh`，但设备授权仍由项目负责人在GitHub页面亲自完成。

### Decision

1. 保留现有public `origin`及其fetch/push URL、upstream和远端main，不向它推送当前内部历史，也不改变其visibility。
2. 新建空private仓库`3443176848/chenyida-erp-recovery-private`，本地remote固定命名为`recovery-private`；创建后必须由认证元数据证明owner和visibility，不能只依赖匿名404或仓库名称推断。
3. Git恢复锚点只接受普通、非强制的精确`<commit>:refs/heads/main`推送；禁止force、mirror、all、tags、历史改写、删除远端引用和覆盖非空未知历史，不建立PR或release。
4. 本机GitHub认证采用`gh auth login --web`设备授权，不通过聊天、命令行参数、任务文档或仓库文件传递PAT；活动账号必须精确为`3443176848`，否则停止。
5. 原任务范围固定为`SELFHOST-OPS-RECOVERY-FOUNDATION-39`三锚点：Git private remote只是第一阶段，不能仅因Git或镜像锚点成功就宣称三锚点完成或production ready。项目负责人随后明确主动延期数据锚点并行政关闭该任务；因此最终`DONE`只表示负责人关闭当前范围，不表示PostgreSQL dump和文件卷异机锚点已经完成。
6. 每个锚点都必须保留来源SHA/digest/checksum、目标、可见性/访问边界和实际恢复验证；任一锚点只能关闭自身故障域风险，不能替代另外两项。

### Consequences

- `SELFHOST-OPS-RECOVERY-FOUNDATION-39`在Git阶段保持`DOING / PHASE_GIT_PRIVATE_REMOTE`；私有push完成后只记录`GIT PRIVATE RECOVERY ANCHOR ESTABLISHED`。Git与private GHCR镜像锚点均已建立；项目负责人随后主动延期数据锚点，并把任务行政收口为`DONE / OWNER-CLOSED AFTER GIT AND IMAGE ANCHORS / DATA ANCHOR DEFERRED`。这不改变D-109的独立范围和门禁，也不等于三锚点全部完成。
- 新私有仓库将包含完整内部Git历史，因此必须保持private并按内部恢复材料治理；本决定不授权公开其中任何文档、拓扑或UAT标识。
- `RELEASES.md`不因恢复remote而更新；Git恢复锚点不是产品release、生产部署或真实数据迁移。
- 本决定不授权UAT登录/API、业务写、Migration、build、Compose、数据库或Volume读取/写入，也不授权镜像push或备份上传。

### Implementation progress

- GitHub官方RPM源和签名指纹核对后已安装`gh 2.97.0`；项目负责人经设备页完成授权，活动账号精确为`3443176848`。认证正文未读取，root配置文件元数据为`root:root / 0600`。
- 认证视图先证明目标仓库不存在，随后创建空`3443176848/chenyida-erp-recovery-private`；GitHub元数据为`PRIVATE / ADMIN / non-fork / size 0`，分支、tag和release均为0。
- 治理提交`e1eff533eb7cb38d169f266bdf3a97b0d3dc7e71`已通过增量扫描并以普通精确SHA推送；本次镜像预检起点验证`recovery-private/main`逐字节等于该提交、behind0/ahead0，private仓库为`PRIVATE / ADMIN / main`，公开`origin/main`仍为`39946f6b854a985b5c19106eaa6c938bddaf9c7c`且URL、upstream、visibility未变。Git阶段结论为`GIT PRIVATE RECOVERY ANCHOR ESTABLISHED`。
- 后续治理提交仍须按同一秘密门禁普通推送到private main；这只维护Git锚点，不能替代已经独立验证的镜像锚点，也不能建立PostgreSQL/文件卷锚点。

### Rejected alternatives

- 拒绝直接fast-forward到public `origin/main`，即使Git拓扑和秘密扫描通过。
- 拒绝通过改写、拆分或删除186个本地提交来适配公开仓库；内部历史使用private恢复remote完整保留。
- 拒绝把PAT粘贴到聊天、环境命令、remote URL或Git配置。
- 拒绝把本机Git bundle、Docker本地tag或同盘dump单独称为异机恢复完成。

## D-109 私有GHCR镜像恢复锚点与最小凭据策略

- 日期：2026-08-10
- 状态：`ACCEPTED / PRIVATE GHCR IMAGE ANCHOR ESTABLISHED / DIGEST VERIFIED`
- 确认人：项目负责人（先授权alpha.42私有镜像出站预检；随后以`GHCR CREDENTIAL READY`明确授权使用一次性临时凭据执行唯一tag、一次push、一次按digest pull及私有性验证）

### Context

- D-108的Git私有恢复锚点已经建立，但已验收alpha.42 Web镜像仍只有本机Docker Image ID和本地tag，没有可从异机验证的private registry manifest digest；Git锚点不能替代镜像锚点。
- 唯一准入候选为运行Web实际引用的`sha256:e7761e2c61bfe77c6aab526fb0b6cbd840ad1bf6300381f4319f6e279af94964`，版本`0.1.0-alpha.42`，source revision`569aa954d764309e239d1f6c174e582596d33a24`。alpha.41回退镜像和`sha256:81126136…278e`被拒候选不在上传范围。
- GitHub官方[Container registry认证说明](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)规定命令行认证使用Personal Access Token (classic)，上传需要`write:packages`；`delete:packages`只用于删除，不属于本任务最小权限。官方[package访问与可见性说明](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)说明个人账号首次发布默认private，但实际push阶段仍必须由认证元数据再次验证visibility。
- 预检结束时没有package-scoped GHCR凭据，匿名不可见或404不能可靠证明目标package不存在，因此当时不能据此创建、覆盖或声称名称空闲。项目负责人随后在任务外准备仅含`write:packages`的临时classic PAT；本阶段用认证API与registry先证明目标package和精确tag均不存在，完成唯一授权push后已清理本机凭据。

### Decision

1. 候选目标固定为`ghcr.io/3443176848/chenyida-erp-web`；唯一计划immutable-intent tag固定为`0.1.0-alpha.42-fix38-569aa954d764309e239d1f6c174e582596d33a24`。
2. 不使用或推送`latest`，不上传alpha.41回退镜像或被拒候选，不覆盖任何既有tag、未知package或未知manifest。package必须始终保持private。
3. 预检时目标存在性精确记录为`TARGET EXISTENCE UNRESOLVED — CREDENTIAL REQUIRED`；项目负责人随后给出`GHCR CREDENTIAL READY`，实际push前已在认证视图中核对identity、scope、owner、package和tag冲突，push后由认证元数据确认visibility。
4. 最小凭据仅接受用户在任务外安全创建、仅含`write:packages`的Personal Access Token (classic)；不要求、不接受也不记录`delete:packages`。PAT不得进入聊天、日志、Git、remote URL、命令参数或扫描报告，不读取Docker认证文件正文，也不使用`gh auth token`替代GHCR凭据。
5. push阶段必须是新的独立执行范围；认证就绪之前禁止`docker login`、`docker tag`和`docker push`。已执行阶段只允许创建一个精确本地tag并向唯一目标push一次；不创建release、Git tag、Actions secret或持久Docker认证文件。
6. push成功后必须记录实际GHCR registry manifest digest，并从private package按该registry digest拉取验证。registry digest、本地Docker Image ID、archive SHA-256、config digest和layer digest分别记录，不得互相冒充。

### Image preflight evidence

- 运行容器、完整Image ID、version/revision/task labels、`linux/amd64`、非root`node`、`/app`、`docker-entrypoint.sh`、`node server.js`、`3000/tcp`和88,679,975 bytes逐项匹配。config digest为`sha256:72452032…32c7`，本地linux/amd64 manifest digest为`sha256:36fd3118…482f`。
- 在唯一`mktemp`目录只执行一次`docker image save`。archive为88,699,904 bytes、SHA-256`d7c78654…bea2`；15个OCI blob、9个压缩layer digest及对应rootfs diff ID全部匹配，path traversal、逃逸/非法link、层内重复路径和world-writable regular file均为0。
- config/Env/history/labels/provenance及8,112个regular file/metadata record、266,026,785 bytes完成多规则扫描：`CONFIRMED_SECRET=0`、`POSSIBLE_SECRET=0`、`TEST_FIXTURE=10`、`DOCUMENTATION_PLACEHOLDER=1`、`FALSE_POSITIVE=566`。10个fixture均由GnuTLS ELF内`crypto-selftests-pk.c`边界和`gnutls_pk_self_test`符号证明为密码算法自检向量。
- 最终镜像没有Docker auth、SSH/PEM/P12/PFX私钥文件、数据库/dump/业务备份、浏览器Profile/Cookie/Session或上传/附件/客户供应商原始文件。保留的空npm `.npmrc`、Debian公共GPG keyring、apt/dpkg日志、source map、TypeScript声明/源码和test路径已记录为运行镜像最小化后续风险，但无confirmed/possible secret。
- 审计结束后精确删除唯一任务目录，archive、解包layer、报告及扫描进程均无残留。本地archive没有异机副本，明确不是恢复锚点。

### Private GHCR implementation evidence

- 严格起点为`c96f9bfc912cb2a5dc6f4a3ad47bb51260847dbd`；public `origin/main`仍为`39946f6b854a985b5c19106eaa6c938bddaf9c7c`，private `recovery-private/main`与起点一致。运行Web仍精确引用验收Image ID，alpha.41和被拒候选身份均未变化。
- 独立root-only临时配置验证PAT身份为`3443176848`，normalized scope只有`write:packages`且没有`delete:packages`或其他scope；认证package API返回目标不存在，认证registry查询返回精确tag不存在。PAT正文未进入聊天、日志、Git、remote URL、命令参数或文档。
- 只创建`ghcr.io/3443176848/chenyida-erp-web:0.1.0-alpha.42-fix38-569aa954d764309e239d1f6c174e582596d33a24`一个本地tag，并只执行一次精确push且成功，没有重试或第二目标。
- push返回、认证registry顶层manifest与带唯一tag的GitHub package version三方registry digest完全一致：`sha256:e7761e2c61bfe77c6aab526fb0b6cbd840ad1bf6300381f4319f6e279af94964`。
- registry OCI index精确包含`linux/amd64` child `sha256:36fd3118a4725aa8546ca28d1f21fe53ca472e81da4d0febff576ba88e4b482f`和attestation child `sha256:f4a82ba3ef6234037ff270c38685adeed3374db341376a8ac95652ff0cd4621b`；platform config为`sha256:72452032dfdec71e55376a511ec762aeb5265f758f257a5b6c858b76372732c7`，9个compressed layer digest均与预检逐项一致。
- GitHub package元数据为owner `3443176848`、container `chenyida-erp-web`、`PRIVATE`且无repository association。三个预期OCI对象中仅顶层index携带唯一计划tag；没有`latest`、额外tag、alpha.41或被拒候选。
- 只执行一次精确按registry digest拉取并成功；回拉Image ID、`linux/amd64`、config、9层、labels、User、WorkingDir、Entrypoint、Cmd和`3000/tcp`均匹配验收基线。没有运行、替换或部署回拉镜像，运行Web容器及四服务身份、健康状态、restart/OOM状态均未变化。
- 独立空Docker配置的匿名manifest查询被`HTTP_401_AUTHENTICATION_REQUIRED`拒绝。验证后执行精确`docker logout ghcr.io`，逐项核对并清理`/run/cyd-ghcr-auth`、PAT、Docker config、临时GitHub API配置及匿名配置目录；默认`gh`身份仍为`3443176848`，默认Docker配置未触碰。

### Consequences

- 阶段结论更新为`ALPHA.42 PRIVATE GHCR IMAGE ANCHOR ESTABLISHED — DATA RECOVERY ANCHOR PENDING`；镜像内容、远端私有性、registry digest与按digest回拉均已验证。
- `SELFHOST-OPS-RECOVERY-FOUNDATION-39`已由项目负责人行政收口为`DONE / OWNER-CLOSED AFTER GIT AND IMAGE ANCHORS / DATA ANCHOR DEFERRED`。PostgreSQL dump和文件卷异机锚点仍未开始，系统仍为非生产且非production ready；数据锚点延期后单机数据恢复风险继续`OPEN`。
- 镜像锚点只关闭镜像故障域，不能替代Git或数据库/文件卷恢复锚点。项目负责人提供“`GHCR ONE-TIME PAT REVOKED`”证明，明确已通过GitHub网页撤销一次性classic PAT；本项目只记录该用户证明，没有读取、恢复、测试或验证PAT正文、scope或远端认证状态。

### Administrative closure

- 项目负责人选择不在本任务继续PostgreSQL dump或uploads、attachments、backup-status文件卷的异机锚点、校验和或恢复演练；未来如需执行必须重新立项并取得明确方案与授权。
- 该范围收口不删除或修改当前、回退、被拒镜像，不读取或清理任何受保护Volume，也不改变alpha.42、0040、非生产UAT或`NO UAT RECEIPT`边界。

### Rejected alternatives

- 拒绝把本地Docker Image ID、本地tag、同机archive或archive SHA称为异机镜像恢复锚点。
- 拒绝用匿名404推断package不存在，拒绝在目标状态未知时试推创建或覆盖。
- 拒绝借用现有GitHub CLI token、在聊天中索取PAT、使用带凭据的命令参数或申请`delete:packages`。
- 拒绝推送`latest`、alpha.41回退镜像、被拒候选，或把本次出站审计解释为生产发布。

### Verification boundary

- 预检阶段只读检查精确alpha.42镜像，并在`/var/tmp`一次性保存、离线扫描和清理；没有build或重建。本次获授权阶段只执行唯一tag、一次精确push、一次按registry digest pull以及认证/匿名只读验证。
- 不登录UAT、不调用业务API、不查询或写入业务数据库，不运行Migration、备份、恢复、Compose更新、部署或服务重启；没有运行或替换回拉镜像。
- 只允许六份治理Markdown、独立提交、提交增量秘密扫描及精确private Git push；public `origin`和`RELEASES.md`保持不变。

## D-110 AI治理评估、审批与外部模型准入边界

- 日期：2026-08-10
- 状态：`ACCEPTED / GOVERNANCE BASELINE / IMPLEMENTATION NOT STARTED`
- 确认人：项目负责人（通过`PHASE4-TASK01`任务指令确认治理、评估、审批及后续实施边界）

### Context

- Material Import和Material Master V2已经具有确定性规范化、冲突门禁、候选分流、人工审核、正式提交、权限、事务、CAS、幂等和审计合同；AI只能在这些权威控制之外提供可丢弃建议，不能成为第二套业务权威。
- 项目当前没有AI模型、AI API、Suggestion/Evidence候选层、评估器、模型凭据或已批准试点。若在建立证据、评估和人工责任前接入模型，会把不可解释输出、数据外发和自动生效风险带入正式主数据链。
- 准确率阈值没有可审计的已标注样本基线。本决定不虚构阈值，后续必须先测量再由项目负责人逐能力批准。

### Decision

1. AI只允许生成品类、属性、既有内部物料候选和供应商映射建议及其证据；输出是可丢弃候选，不是正式业务事实。
2. AI不得直接创建、合并、启用、冻结、停用或覆盖正式物料，不得写正式属性、supplier/legacy mapping、BOM、库存、采购、生产、品质、财务或正式内部编码。
3. 既有服务端认证授权、权限域、CSRF、事务、CAS、幂等、并发、状态机、审核和审计继续控制所有正式写入；AI不得替代或降低任何节点。
4. 确定性冲突、客户专用、单位不兼容、冻结、停用和生命周期门禁始终优先于AI建议；AI不得覆盖确定性拒绝或把冲突解释为放行。
5. 超时、模型异常、证据不足、非法Schema、低置信度、未知品类或版本漂移必须失败关闭为`NEEDS_REVIEW`或无建议，不得回退为猜测或部分正式写入。
6. 外部AI供应商默认禁用；本任务不选择模型、不创建或读取凭据，也不向外部服务发送真实供应商文件、价格、个人信息、客户专用资料或生产正文。
7. 未来外部模型准入必须另行完成数据分类、最小化和去标识化、保留/训练/删除条款、处理地域和跨境边界、合同与分包商审查以及凭据创建/保管/轮换/撤销授权；缺一项即保持禁用。
8. 每条建议必须以稳定`suggestion_id`记录输入摘要、数据集、规则、provider/model、prompt、参数、输出Schema、逐字段证据、置信度、`request_id`和生成/过期时间；追溯不完整的建议不得进入审核工作台。
9. 人工决定必须与AI建议分开保存，绑定建议版本、正式对象版本、审核人角色、逐字段采用/更正、理由、证据、时间、CAS和审计结果；人工反馈不得自动训练、调阈值、改prompt、改规则或发布。
10. 采购负责来源和供应商事实，工程负责技术规格与同物判断，品质负责质量/合规字段，主数据管理员负责规则完整性和最终受控建档/合并；AI不是审批人，本矩阵不授予新权限。
11. provider、模型、prompt、参数、规则、门禁、阈值、Schema、参考数据或分类属性定义变化都必须形成新版本并重新通过固定评估集；禁止供应商自动升级后静默沿用旧批准。
12. 未来实现必须提供全局及按能力停用开关、最近批准版本回退、漂移检测、结果过期和定期/事件触发复评；关键安全违规或漂移时立即停止消费建议，任何生产试点另行授权。

### Evaluation contract

- 评估集必须版本化、不可静默改写且仅含合成或去标识化数据；每版记录稳定`dataset_id`、语义版本、样本清单摘要、去敏策略版本和整体SHA-256。开发/校准集与固定holdout隔离，holdout不得用于prompt、规则、阈值或示例调优，泄漏或标签修订必须创建新版本。
- 场景必须覆盖正例、反例、近似非同物、重复、冲突、缺字段、噪声、单位可换算/不兼容、客户专用、冻结/停用、PCB/FPC/SMT特殊规格、非法Schema、越界/提示注入式正文和应放弃回答场景。
- 分类建议、属性提取、候选匹配、供应商映射建议四类能力必须分别评估并按品类、来源、风险和缺失模式分层，不得用综合分掩盖高风险能力失败。
- 最低指标包括逐字段precision/recall/F1、整条exact match、top-k recall、错误候选率、abstention rate、coverage、coverage内准确性、稳定复现率和关键安全违规数。直接正式写入、绕过审核、覆盖确定性门禁、未授权外发或停用后继续消费建议的允许值固定为`0`。
- 本决定不设未经测量的业务准确率阈值。`PHASE4-TASK02`只能先用已标注样本测量确定性基线与候选方案，阈值、最低coverage和试点准入仍须项目负责人批准。
- 每次评估必须记录run ID、环境、数据集/holdout摘要、规则/模型/prompt/参数/Schema/evaluator版本、分层指标、安全违规、去敏失败样本、结果制品摘要和批准/拒绝事实，使结果可复现、可独立审阅并可审计。

### Consequences

- Phase 4固定为五个独立任务：TASK01治理基线；TASK02去敏评估集、确定性基线和离线Evaluator；TASK03关系化Suggestion/Evidence候选层；TASK04人工审核API/UI和受控正式提交；TASK05非生产试点、发布门禁、漂移、停用和回退验收。TASK01完成不自动开始TASK02。
- AI不可用时，确定性规则和人工流程必须继续运行；模型质量、可用性或供应商变化不能放宽正式写入门禁。
- 本决定不实现或授权模型调用、API、页面、Schema、Migration、Evaluator、候选数据、真实数据处理、试点、部署或生产切换。

### Rejected alternatives

- 拒绝把模型置信度、自然语言解释或人工一次接受当作正式物料、映射或业务事实。
- 拒绝在没有版本化去敏数据集和固定holdout时凭空声明准确率、设置生产阈值或选择供应商。
- 拒绝把人工反馈直接用于在线学习、自动调参、自动修改规则或自动发布。
- 拒绝让外部模型凭据、真实供应商/客户资料或生产正文进入本治理任务。

## D-111 确定性AI治理评估阈值与TASK02收口

- 日期：2026-08-10
- 状态：`ACCEPTED / DETERMINISTIC BASELINE ONLY / RELEASE NOT AUTHORIZED`
- 确认人：项目负责人（明确授权按当前实际基线作出阈值决定并以docs-only方式收口`PHASE4-TASK02`）

### Context

- `PHASE4-TASK02`已从冻结功能提交`d69f6dff795377109244e788c2ffee73ef6194ec`交付`synthetic-material-governance-v1@1.0.0`、四项本地确定性基线和一次正式all-splits报告；calibration/holdout各32条，决策精确匹配、证据合规和稳定复现均为1.000000，关键安全违规和错误候选均为0。
- 该机器报告生成时尚无批准阈值，因此其中`threshold_status=UNAPPROVED`和`release_decision=NOT_AUTHORIZED`是不可改写的历史事实。阈值决定必须作为后续治理记录追加，不能修改Evaluator、数据集、标签、机器报告或重新运行正式holdout。
- coverage较低主要来自对冲突、歧义、生命周期、客户专用、未知品类和证据不足场景的安全放弃。阈值不能以追求覆盖率为由迫使系统猜测，也不能把64条静态合成样本外推为真实业务或外部模型质量。

### Decision

1. 批准阈值档案`deterministic-ai-governance-thresholds-v1`，仅适用于以下完整身份：provider=`LOCAL_DETERMINISTIC`、model/prompt=`NONE/NONE`、rule=`bom-material-governance-v1`、evaluator=`ai-governance-evaluator-v1`、dataset=`synthetic-material-governance-v1@1.0.0`及冻结source revision `d69f6dff795377109244e788c2ffee73ef6194ec`。
2. 数据完整性必须为`PASS`；禁止数据/身份命中、formal action、关键安全违规均必须为0；记录决策exact、证据合规、稳定复现和coverage内准确率均必须为1.000000。任一门禁失败即整体失败，不能由平均分抵消。
3. 分类的已定义micro/macro precision、recall、F1及记录exact必须为1.000000，最低coverage为0.750000。
4. 属性提取的已定义逐字段precision、recall、F1、整行exact及coverage内准确率必须为1.000000；最低记录coverage和最低字段coverage均为0.750000。
5. 物料候选匹配和供应商映射建议的top-1/top-3 recall及coverage内准确率必须为1.000000，错误候选数/率必须为0，二者最低coverage分别为0.250000。
6. 四项能力合计最低coverage为0.500000。coverage只衡量发出建议的比例；所有ABSTAIN继续留在记录分母，不能删除、改标签或以猜测补齐。
7. 对有样本的品类、scenario和风险分层，决策exact与证据合规必须为1.000000、关键安全违规必须为0。零support指标保持`0/0 / defined=false`，不得解释为通过或失败；`MECH/OTHER/UNKNOWN`等零coverage层只表示未获建议能力，不能据此宣称支持。
8. 当前冻结报告在不重跑holdout、不修改任何制品的前提下满足上述档案：calibration/holdout总体coverage分别为0.562500/0.593750；分类为0.750000/0.750000；属性记录为1.000000/0.875000、字段为0.937500/0.766667；物料匹配和供应商映射分别均为0.250000/0.375000。治理层评估结论为`THRESHOLD_ASSESSMENT=PASS`，机器报告原历史字段保持不变。
9. provider、模型、prompt、参数、规则、门禁、阈值、Schema、参考数据、数据集或分类属性定义任一变化都必须形成新版本并重新评估；本档案不得自动套用于外部模型、真实数据或新数据集，也不得在未获项目负责人批准时降低。
10. `PHASE4-TASK02`据此标记`DONE / DETERMINISTIC_THRESHOLDS_APPROVED / RELEASE_NOT_AUTHORIZED`。这不授权`PHASE4-TASK03`、模型调用、Suggestion/Evidence Schema、真实数据、试点、Migration、部署或生产切换；`PHASE4-TASK03`继续为`TODO`且不得自动开始。

### Consequences

- TASK02的交付和治理阈值闭合，但只证明当前静态合成数据集上的本地确定性回归基线；`release_decision`继续为`NOT_AUTHORIZED`，外部AI继续禁用。
- 安全放弃是批准行为的一部分。提高coverage必须通过新版本、新样本和独立批准完成，不能放宽确定性冲突、客户专用、单位、生命周期或人工审核门禁。
- 本决定不替代D-005尚待业务样本确认的四级匹配分流业务阈值，也不批准任何正式物料自动写入。

### Rejected alternatives

- 拒绝回写机器报告，把其历史`UNAPPROVED`或`NOT_AUTHORIZED`字段改成事后批准。
- 拒绝把100% coverage设为目标并因此减少ABSTAIN、猜测缺失值或发出歧义候选。
- 拒绝把64条合成样本的100%决策匹配解释为production ready、真实分布准确率或外部模型准入。
- 拒绝因TASK02完成而自动开始TASK03、接入模型、创建候选层或执行任何运行环境动作。

## D-112 — AI Suggestion/Evidence Relational Candidate Contract

- 日期：2026-08-10
- 状态：`ACCEPTED / RELATIONAL CONTRACT / IMPLEMENTATION NOT STARTED`
- 确认人：项目负责人（通过`PHASE4-TASK03 AI SUGGESTION/EVIDENCE RELATIONAL CONTRACT`指令明确批准关系化候选边界、D-112及docs-only范围）

### Context

- Migration 0035 已用九张 `material_governance_*` 表分离确定性运行/分组/来源/规格/候选、人工决定及正式 Material 衔接，并通过复合外键、唯一约束、单次 group CAS 和数据库不可变守卫证明其语义。AI输出具有不同的来源身份、版本、放弃、过期、失效和替代语义，不能写入或冒充这些确定性/人工事实。
- Material Import 已有 Batch、Parse、Mapping、Normalization、Normalized Row、Field/Attribute Candidate、Issue 和 Lineage；Material Master 已有稳定 ID、类型化属性、生命周期、版本与审核；Supplier Mapping 已有稳定 `mapping_uid`、version chain、supplier-part claim、职责分离和追加事件。候选层应引用这些权威事实，不能复制正文或形成第二套主数据/映射状态机。
- D-110 已规定 AI 只建议、失败关闭、证据和人工责任分离；D-111 只批准当前冻结 `LOCAL_DETERMINISTIC` 身份的阈值。本决定需要在不创建 Schema/Migration/API/UI/Service、不调用模型和不访问 UAT 数据库的前提下，固定下一实施阶段的数据合同。

### Decision

1. AI候选层使用独立 `ai_governance_*` 边界，不重载、扩写或改变0035的 `material_governance_material_candidates`、`material_governance_alternative_candidates`、`material_governance_decisions`、material links或events语义。
2. V1 suggestion主体只绑定一个既有 `material_governance_group`及其 `governance_run_id`、group version和canonical input SHA-256；创建时group必须为同run的`PENDING v1`。AI必须位于已发布Normalization和确定性治理之后。
3. V1只支持`CLASSIFICATION`、`ATTRIBUTE_EXTRACTION`、`MATERIAL_MATCH`、`SUPPLIER_MAPPING`四项能力；每个item kind必须与run capability相同。
4. suggestion disposition只有`SUGGEST`和`ABSTAIN`。二者都不是批准、建档、绑定、合并、启用、映射或正式业务事实；`ABSTAIN`是安全放弃且不能进入后续审核。
5. run、suggestion payload、item、score、evidence和source locator创建后不可原地修改；任何输入、输出或版本合同变化必须创建新run和递增suggestion version，历史事实保留。
6. 每个run必须记录capability，schema/evaluator/rule/config版本与摘要，provider/model/model version/prompt身份，参数摘要，input version及SHA-256，`request_id`、`operation_id`、idempotency key摘要、发起principal、服务端创建时间、强制`expires_at`、`contract_digest`、`run_digest`和`result_digest`。
7. 当前实现准入只允许`execution_mode/provider=LOCAL_DETERMINISTIC`、model/model version/prompt=`NONE/NONE/NONE`；没有prompt制品所以prompt digest为空，没有概率语义所以confidence semantics为空。外部AI继续默认禁用，不创建凭据或发送真实数据。
8. 采用五表蓝图：`ai_governance_suggestion_runs`、`ai_governance_suggestions`、`ai_governance_suggestion_items`、`ai_governance_suggestion_evidence`、`ai_governance_suggestion_events`。全部外键默认`ON DELETE RESTRICT`，事实/事件拒绝UPDATE/DELETE。
9. item必须使用显式关系字段：Classification引用Category FK；Attribute引用Attribute Definition FK和单一类型值列；Material Match引用Material FK/观察版本；Supplier Mapping引用Supplier+Material FK及supplier-part摘要。禁止任意`target_type/target_id` polymorphic ID，也不得把候选、字段值和引用全部塞入无约束JSON。
10. 每个`SUGGEST`至少一个item，每个item至少一条同主体、逐字段或逐候选evidence；延迟数据库约束和服务事务必须在提交前验证。证据不足必须整体`ABSTAIN`或拒绝不完整输出，不能让无证据item进入审核。
11. evidence只保存安全field locator、稳定内部FK、观察版本和SHA-256，可引用0035 row/spec/确定性候选、Normalization lineage、Material/Supplier/Mapping version或受控rule trace；不得保存原始供应商文件、原始行/模型正文、价格、联系信息、凭据、个人信息或客户专用正文。
12. confidence允许为空；当前确定性基线必须为空，不能伪装成概率。未来非空值必须在0—1内并绑定已批准`confidence_semantics_version`，该变化需要新版本和重新评估。
13. 当前有效性不保存为可更新status，而由服务端在同一快照中失败关闭派生：完整摘要/证据、`SUGGEST`、服务端时间未过期、无终止事件、输入版本/摘要仍匹配、group仍`PENDING`且version匹配、所有Category/Attribute/Material/Supplier/Unit/Mapping引用仍有资格且版本/摘要匹配、完整版本合同/阈值仍获批准、对应停用开关允许消费。
14. `expires_at`必须晚于创建时间且V1最多30日，版本化config可设置更短TTL；过期仅由服务端/数据库业务时间判断，浏览器时钟、倒计时或缓存不具权威性。
15. `INVALIDATED`、`DISCARDED`、`SUPERSEDED`只通过追加event记录，每个suggestion最多一个互斥终止事件；不得删除或改写原建议伪造历史。过期为服务端时间派生，不依赖可缺失的`EXPIRED`事件。
16. 物理清理和保留期限不在TASK03实现范围。未来只有在无审核/审计/正式操作引用、满足保留政策和恢复要求并经独立任务授权后才可设计；当前全部RESTRICT且不可删除。
17. 同一治理主体、group version、capability、input version/digest和完整contract digest必须形成确定性`run_digest`及唯一约束；相同请求重放返回既有完整结果，相同key不同请求冲突，不能产生重复或半成品建议。
18. 正式业务表在TASK03不增加指向AI suggestion的反向依赖。AI表不得写Supplier Mapping claim、Material Master、0035决定/link/event或任何BOM、库存、采购、生产、品质、财务事实。
19. TASK04只能通过独立人工review/decision引用`suggestion_uid + version + digest`，记录审核人/角色/逐项采用或更正/理由/CAS/审计，再调用既有权威Material Workflow或Supplier Mapping Service完成正式写入；禁止SQL直写或降低权限、职责分离、事务、CAS、幂等、审核和审计。
20. D-111阈值原样继承：正确性、证据、稳定复现和coverage内准确率均为1.000000；安全违规、formal action和错误候选为0；overall/classification/attribute record/attribute field/material match/supplier mapping最低coverage为0.50/0.75/0.75/0.75/0.25/0.25。ABSTAIN保留在分母，零support保持undefined。
21. provider、模型、prompt、参数、规则、阈值、Schema、证据合同、config、数据集、参考Category/Attribute定义或其他影响结果的版本变化都必须形成新版本并重新评估，不能静默沿用旧批准。
22. 下一实施阶段计划新增唯一Migration `0041_ai_governance_suggestion_evidence.sql`，同时保持`db/schema.ts`、snapshot/journal、服务、数据库守卫和隔离测试一致。本阶段只接受蓝图，不创建0041，不修改0035/0040。

### Consequences

- `PHASE4-TASK03`状态为`DOING / RELATIONAL_CONTRACT_ACCEPTED / IMPLEMENTATION_NOT_STARTED`；关系合同已接受，但实现、测试迁移和人工审核衔接仍须后续独立授权，不能把合同接受解释成任务实现完成。
- 0035的确定性候选继续由`bom-material-governance-v1`单独负责，人工决定和正式Material/Supplier Mapping服务继续是唯一写入权威。AI不可用、过期或失效时，确定性和人工流程仍可运行。
- 本决定不实现或授权Schema、Migration、API、UI、Service、Evaluator变更、模型调用、真实数据、试点、build、部署、生产迁移或发布；源码保持alpha.43，UAT保持alpha.42/0040。
- 详细逐表字段、FK、唯一约束、CHECK、索引、CAS、事件链和空值原因记录在[AI Suggestion/Evidence关系化候选合同V1](../material-master/ai-suggestion-evidence-relational-v1.md)。

### Rejected alternatives

- 拒绝把AI结果写入0035确定性候选表、人工decision/event表、Supplier Mapping或Material Master，以免混淆来源和绕过权威服务。
- 拒绝单表`jsonb payload`、任意polymorphic ID或只保存自然语言解释/总分，因为它们不能提供类型、引用完整性、逐项证据和稳定查询约束。
- 拒绝原地更新status/payload/evidence、删除旧建议或用浏览器时间决定过期，因为这些做法会破坏历史和并发一致性。
- 拒绝用当前64条合成集阈值批准外部模型、真实数据或发布，也拒绝因建立表结构合同而自动开始TASK04/TASK05。

### Implementation record — 2026-08-10

- 项目负责人随后以`PHASE4-TASK03 AI SUGGESTION/EVIDENCE CANDIDATE LAYER SOURCE IMPLEMENTATION`指令单独授权D-112源码实施；本记录是D-112的实施结果，不新建D-113，也不改变原关系合同。
- 状态更新为`DOING / SOURCE_READY / HOLDOUT_REVALIDATION_REQUIRED / RELEASE_NOT_AUTHORIZED`。持久层提交`8b839a64b219b91f7b83ab8ce5a0819ac2486105`和服务提交`218ef1b483cbd915c6e83013d7193e37c53a0eb1`将源码升至alpha.44/head 0041；`0041_ai_governance_suggestion_evidence.sql` SHA-256为`676626b9dcb78f31643612e5662cf5c36e06259c72ff922287bb913394071bf2`，0035/0040保持原checksum。
- 五表Schema、snapshot/journal、真实/复合FK、CHECK、唯一/部分唯一索引、service-only INSERT门禁、UPDATE/DELETE拒绝和延迟完整性/版本/事件链触发器均已实现。历史0034/0035/0037/0039 journal合同测试只机械改为按自身`idx/tag`定位；旧Migration、约束和测试数量未改写或降低。
- 独立`LOCAL_DETERMINISTIC`模块实现四项能力、安全`ABSTAIN`、稳定canonical摘要、数据库时间、输入/引用重验、单事务run/suggestion/item/evidence/event/Audit/幂等、连续版本/SUPERSEDED和只读快照有效性。POST/GET复用既有治理权限及批次可见性，具备CSRF、正文上限、精确字段、request ID、稳定中文错误和去敏失败；没有TASK04人工审核或正式提交API。
- 0041静态合同5/5、隔离Migration/约束7/7、Suggestion Unit/Handler 9/9、隔离Service 5/5、专项typecheck、0035回归61/61、TASK02 Evaluator17/17、`npm test`3/3和lint 0 error/11条既有warning通过；正式业务表写入为0，临时数据库/容器/目录已清理。
- D-111身份、阈值、calibration、holdout、manifest、标签及机器报告均未修改，正式holdout没有重跑。因此alpha.44只是source ready；UAT仍为alpha.42/0040，0041未应用，未build、部署、调用模型或启动TASK04/TASK05。下一门禁是对alpha.44完整身份正式重验holdout并取得独立发布授权。

## D-113 晨亿达ERP多智能体研发控制面采用单一任务、最小能力与可恢复有界循环

- 日期：2026-08-11
- 状态：`ACCEPTED / R1 COMPLETE / ENFORCEMENT NOT IMPLEMENTED`
- 提案人：Codex（按`PM-001`设计要求形成提案）
- 确认人：项目负责人（2026-08-11明确“接受 D-113”，并单独授权`AGENT-R1`只读控制器）

### Context

- 提案形成时，仓库同时保留自托管Node/PostgreSQL未来生产方向、Python/SQLite历史开发/迁移来源和历史Sites/D1证据，且`PHASE4-TASK03`是唯一`DOING / SOURCE_READY / HOLDOUT_REVALIDATION_REQUIRED / RELEASE_NOT_AUTHORIZED`。通用Agent若不理解运行面、Migration、UAT受控PO、资源和业务交接，很容易把源码完成误报为发布或产生跨运行面重复逻辑；当前TASK03已由后续owner指令暂停。
- Prompt中的“只读”“不部署”不能强制共享root Shell下的实际权限。并行实现者、测试库、Migration、状态文档、UAT写和低资源重任务必须由独立控制面防止覆盖、脑裂、重复副作用和生产越权。
- 项目需要Agent在对话/进程结束后继续同一正式任务，但持续运行不能绕过人工决策、无限重试或自动开始下一任务。

### Decision

1. `TASKS.md`继续只使用`TODO / DOING / DONE / BLOCKED`且同时最多一个正式`DOING`；交付阶段、qualifier和工作项运行态分层管理，不扩充台账状态语义。
2. 每个正式任务建立版本化Task Packet，冻结Task ID、基线SHA、目标运行面、允许路径/动作、业务不变量、验收、风险、授权、资源、证据和退出条件。Packet改变会使受影响的旧测试、Agent审查和人工决定引用失效。
3. Agent按24个逻辑角色启用最小集合，Planning、Production、Warehouse和Quality独立；业务/领域、数据库、安全、QA和代码审查拥有独立否决权。被审实现者不得兼任其独立审核者，批准绑定精确产品tree、Closure Docs Commit、最终SHA和Packet revision。
4. 权限通过独立Unix/容器身份、只读或限定挂载、worktree、命令/秘密代理、网络策略、数据库指纹和短时capability强制；能力绑定Task、Agent、Role、产品tree/最终SHA、动作、对象、方法、次数和有效期。UAT metadata、业务读取和写入三权分离且默认无连接；普通Agent无Docker socket、privileged、生产、真实资料、秘密或部署能力。
5. 同一时间只有一个路径/领域/Migration/状态文档写者；Git集成、Migration、共享测试库、Docker build、全量测试、备份恢复、Compose、UAT和发布串行，并以全局heavy锁遵守2核/4GiB/1GiB Swap保护。
6. 外部控制器每轮只执行一个可验证的有界动作，使用lease token、版本、心跳、hard deadline、fencing epoch、CAS、幂等、追加事件、修复预算和完整检查点恢复。等待态释放租约并由事件唤醒；达到完成条件时DONE，出现人工/安全/数据/资源/恢复阻塞或预算耗尽时BLOCKED，不无限循环或自动开始下一任务。
7. Git文档和Commit是长期项目权威，独立Control Store只保存去敏控制元数据、租约、事件和证据引用，不进入ERP PostgreSQL，也不保存秘密或业务正文；关键事件/授权/命令审计拒绝UPDATE/DELETE、形成哈希链并由独立身份外部只追加封存。
8. 所有工作继续遵守运行面唯一、稳定内部ID、Migration不可破坏、生产数据默认拒绝、服务端权限优先、关键写单事务/幂等/CAS/审计、已过账事实只追加调整/冲销、业务闭环优先和历史逻辑禁止删除；旧逻辑只能停写、冻结、标记deprecated并追加替代版本。
9. UAT业务写、Migration、真实资料、外部AI、备份恢复、部署、生产访问和发布必须由项目负责人对精确对象另行授权；生产能力采用互异人类批准集合与quorum，Agent PASS不计作人类批准。`UAT_ACCEPTED`不能自动发布，必须另有`RELEASE_AUTHORIZED`人工事件。
10. Migration作者、持`DB_REVIEW`的独立审查者和共享/UAT/生产执行者必须三方互异；Integration为不能编辑文件或解决冲突的非Agent身份，只能把产品tree、Closure Docs Commit和最终tree身份已审的精确SHA fast-forward集成。
11. Git中的`TASKS.md`与SQLite active slot使用PREPARED→精确状态Commit→COMMITTED两阶段协议；启动先RESERVED、Git确认后ACTIVE，结束先DRAINING、Git确认后释放。分支HEAD、TASKS blob、state commit或slot不一致时全局失败关闭，禁止任何Orchestrator认领工作项。

### Consequences

- [多智能体研发系统设计](../AI_AGENT_TEAM_DESIGN.md)成为后续R1只读控制器、R2隔离底座、R3有界开发循环、R4受控UAT和R5生产候选的提案基线；每一阶段必须另立任务、验收和授权。
- `PM-001`按owner priority hold顺序成为唯一DOING并完成，随后恢复`PHASE4-TASK03`原DOING状态；无并行DOING。这是PM-001收口时点事实；后续项目负责人另行接受本决定并启动R1。即使R1观察器完成，也不能声称角色已被OS、容器、凭据代理或策略技术隔离。
- 本提案不修改业务代码、Schema/Migration、API、测试、版本或部署配置，不授权holdout、build、UAT Migration、部署、生产、TASK04或TASK05，也不改变`PHASE4-TASK03`状态。

### Acceptance and R1 authorization

- 2026-08-11，项目负责人接受D-113作为后续控制面实施的权威设计决定；接受设计不等于R2—R5、OS/容器隔离、控制库、租约、命令代理、Capability Broker或运行时已经实现。
- 同一指令要求`PHASE4-TASK03 DOING → BLOCKED / OWNER_PRIORITY_HOLD`并新建、启动`AGENT-R1`。TASK03的source-ready、holdout待重验和release未授权限定原样保留，恢复必须另获项目负责人明确指示。
- `AGENT-R1`只授权R1无状态只读控制器、机器可读Task Packet、错误注入/恢复测试和项目文档；控制器只能读取本地仓库权威材料并向stdout输出清单，不得写控制状态、连接UAT/生产、运行Migration/build/deploy或修改ERP业务逻辑。
- 原Consequences中“本提案不改变PHASE4-TASK03状态”是提案形成时点事实；本次状态变化来自项目负责人新的明确调度指令，不是D-113自动启动后续阶段。

### R1 implementation record

- `AGENT-R1`已于2026-08-11完成：状态提交`d6bb223bd9381184d50ee8ac65c2a71d5033a58b`，只读控制器实现提交`903e2108bf71a1b4488a6b9d69da0e10aae07880`，治理收口使用独立`docs: complete read-only ERP agent controller`提交。
- R1为无状态观察器：只读取本地Git、治理文档、package与Migration文件，向stdout输出确定性JSON；24/24错误注入/恢复测试、仓库`READY`、重复输出/工作区不变及零DOING `IDLE`通过。它不实现本决定第4、6、7、10、11项中的OS/容器隔离、Control Store、lease/fencing、能力代理、Agent Runtime或两阶段状态强制。
- `PHASE4-TASK03`继续`BLOCKED / OWNER_PRIORITY_HOLD / SOURCE_READY / HOLDOUT_REVALIDATION_REQUIRED / RELEASE_NOT_AUTHORIZED`；R1完成不构成恢复TASK03或启动R2—R5的授权。

### Rejected alternatives

- 拒绝让多个Agent各自认领正式任务并直接并行写`main`，或依赖聊天记忆协调共享Migration、Service、测试数据库和项目状态文档。
- 拒绝以Prompt、角色名或Agent自报PASS代替命令层权限、独立测试、人工授权、恢复点和审计。
- 拒绝无限自循环、自动降低断言、盲目重试结果未知的写动作，或在当前Task完成后自动启动下一Task。
- 拒绝把多智能体系统的运行状态、秘密或真实ERP业务数据写入项目PostgreSQL或发送给外部模型。

## D-114 研发多智能体采用原生编排优先、零常驻LLM与真黑盒隔离

- 日期：2026-08-11
- 状态：`ACCEPTED / AGENT-R1-5 COMPLETE / R1.5 NATIVE PROTOCOL MVP COMPLETE / R2-R5 NOT AUTHORIZED`
- 提案人：Codex（按`PM-002`执行设计要求形成提案）
- 确认人：项目负责人（2026-08-11明确接受D-114并授权`AGENT-R1-5`限定实施）

### Context

- D-113和PM-001已经接受单一正式任务、最小能力、单写者、独立否决、可恢复有界循环和人工发布；AGENT-R1只读观察器已完成，但R2—R5尚未实施或授权。
- 当前仓库有三种运行面、41个PostgreSQL Migration、34个`app/lib`领域目录、31个Service、21个Repository、31个Handler、225个测试文件和11类业务身份。职责分离有价值，但2核、约4 GiB内存、1 GiB Swap不适合多个常驻模型、并行重任务或新的微服务群。
- PM-001的24个逻辑角色是完整能力目录，不表示每项任务都应启动24个Agent。现有设计还需明确结构化消息、真正不读源码的Black-box Persona、动态专家退出、Minority Report和使用Codex原生编排与自研控制器的顺序。
- 研发Agent Team与D-112产品AI Suggestion/Evidence属于不同信任域；产品五表不能作为研发Agent消息、记忆或控制状态存储。

### Decision

1. 保留D-113全部硬边界，将常驻控制职责折叠为Flow Steward、Boundary Sentinel、Evidence Registrar和Recovery Reconciler四个逻辑模块，由一个低资源确定性进程承载；常驻LLM数量固定为0。
2. PM-001的24角色继续作为能力目录。每个Task只创建最小任务团队：实施、ERP合同、对抗、安全、独立QA、真黑盒及适用专家；任务完成即撤销能力并退出。
3. 同一正式任务只允许一个产品写者；Reviewer、Security、QA和Black-box默认只读且不得修复被审候选。ERP、安全、QA及适用数据库门禁拥有不可由多数覆盖的否决权，项目负责人独占范围、UAT、发布和生产授权。
4. Agent交接采用`erp-agent-message/v1`结构化合同，至少记录task_id、agent、role、input、assumptions、evidence、changes、tests、risks、blockers、recommendation和status；重要结论无Evidence即无效。
5. 任何关键角色均可提交Minority Report。Orchestrator必须以新证据、修复、新决定或确认veto处置，不能以多数票关闭。
6. 真Black-box必须使用未参与实现/审查的新Agent、无源码或`.git`挂载的隔离sandbox、合成身份/数据和browser/公开HTTP通道；条件不足只能标为GRAY_BOX或NOT_RUN。
7. 第一实施候选定为`R1.5 Native-Orchestrated Design MVP`：优先使用Codex原生临时编排和现有R1，验证Task Packet v2、消息/上下文合同、单写者、独立门禁和合成黑盒。不先开发daemon、消息总线、控制数据库或常驻模型。
8. R2以后只自研原生会话无法强制的确定性薄层：身份/路径/命令策略、lease/fencing、Capability Broker、追加事件、检查点、资源门和恢复对账。R2负测通过前不得声称Prompt边界等同技术隔离。
9. 控制状态未来使用与ERP产品数据库分离的存储和命名空间；禁止使用`ai_governance_suggestion_runs`、`ai_governance_suggestions`、`ai_governance_suggestion_items`、`ai_governance_suggestion_evidence`和`ai_governance_suggestion_events`。
10. 当前服务器最多并行两个轻量只读认知角色，产品写者一个，Docker build/全量测试/Migration/备份恢复/Compose/临时测试库全局串行；每阶段另立任务且完成后返回IDLE。

### Consequences

- [PM-002执行设计包](../ai-engineering/README.md)成为本提案的详细规范；D-113仍为已接受上位原则，若有冲突按更严格边界处理并提交新决策。
- 提案减少常驻资源和新平台复杂度，同时承认R1.5仍主要依靠现有仓库规则与人工能力门，不是R2级技术强制。
- 接受本提案也只批准架构选择，不自动授权R1.5实现、R2—R5、`PHASE4-TASK03`恢复、holdout、模型、业务/测试代码、Schema/Migration、UAT、部署或生产。
- D-114接受后只授权`AGENT-R1-5`的合成docs/test协议MVP；R2—R5、ERP产品任务和任何运行面能力仍保持`NOT AUTHORIZED`。

### Acceptance and AGENT-R1-5 authorization

- 2026-08-11，项目负责人明确“接受 D-114”，并要求创建、启动`AGENT-R1-5`，按R1.5 Native-Orchestrated Design MVP实施。
- 授权精确限定为合成docs/test试点、版本化Task/Message/Context合同、无状态验证、原生临时角色和源盲黑盒fixture；不修改ERP业务、Schema/Migration，不访问UAT/生产，不部署，并继续冻结`PHASE4-TASK03`。
- 在授权时点，接受决定不等于R1.5已经完成；它也不授权Control Store、daemon、OS/容器身份、强制lease、Capability Broker、网络、数据库、Git push或R2—R5。后续完成事实由下节独立记录。

### R1.5 implementation record

- `AGENT-R1-5`已于2026-08-11按精确授权完成。Task Packet v2、Message v1、Context Manifest v1三份严格Schema，R1 v2只读巡检，Python标准库无状态validator，确定性合成候选/拒绝/修复/Minority Report/RESULT_UNKNOWN试点及公开源盲黑盒fixture均已交付。
- 最终实现候选为`25cbbfab87925a8601b844fe59c634ae0b651297`。ERP合同、安全、对抗、QA与全新Black-box Agent五道独立门禁都绑定该候选、revision 2、lease 1及各自Context摘要并PASS；审查证据由独立提交`ace4dc5`固化，历史失败/VETO收据保持不可变。
- 协议专项87/87、控制器专项47/47通过；validator `0.5.4`双跑stdout逐字节一致。本地Python `SELF_TEST_OK`、`SMOKE_TEST_OK`、loopback/no-backup `GO_LIVE_CHECK_OK`通过。黑盒只挂载公开合成fixture、断网、只读rootfs且资源受限；首次权限错误在执行前失败关闭，修正后的第二次运行PASS，两个临时容器均删除。
- R1.5完成只证明Git内协议、证据绑定和原生临时角色流程可在合成范围运行；Prompt/会话边界不等于OS强制身份或运行时授权。Control Store、daemon、持久lease/fencing、Capability Broker、秘密/命令代理、UAT/生产和R2—R5继续为`NOT_IMPLEMENTED / NOT_AUTHORIZED`。
- 实施未修改ERP业务/测试、产品Schema/Migration、package、版本或部署配置，未访问UAT/生产、网络或业务数据库，未执行holdout、模型、build、Migration、备份恢复、Compose变更、部署或Git push。完成后零DOING/`IDLE`，`PHASE4-TASK03`继续原`BLOCKED / OWNER_PRIORITY_HOLD / SOURCE_READY / HOLDOUT_REVALIDATION_REQUIRED / RELEASE_NOT_AUTHORIZED`。

### Rejected alternatives

- 拒绝把PM-001的24个逻辑角色全部作为常驻Agent或容器运行。
- 拒绝在验证协议前先建设高权限Orchestrator微服务、消息队列或模型集群。
- 拒绝由同一Agent切换Prompt后完成实施、QA、安全和批准，或让看过源码的角色自称Black-box。
- 拒绝复用D-112产品五表、ERP PostgreSQL或真实业务正文作为研发Agent长期记忆。

## D-115 备份恢复 V2 采用四域不可变证据链、不同故障域/集群证明与运行身份失败关闭

- 日期：2026-08-12
- 状态：`ACCEPTED AS G1 IMPLEMENTATION BASELINE / SYNTHETIC-ISOLATED VERIFIED / PRODUCTION USE NOT AUTHORIZED`
- 提案与实施：Codex 持续交付负责人及数据迁移、应用测试、运维安全智能体
- 确认边界：项目负责人已授权仓库内安全实施和隔离测试；真实四卷读取、异机传输、恢复、部署和生产使用仍需专项明确授权

### Context

- `SELFHOST-PRODUCTION-READINESS-40`确认旧工具把数据库 URL 放入 argv，只备份 PostgreSQL/uploads/attachments，只信任调用者声称 writer 已停止，恢复后顺序移动文件且最终失败可能留下部分目标；单个 `VERIFIED`也不能证明异机副本或恢复。
- Git/private GHCR 锚点不能保护业务数据。PostgreSQL、uploads、attachments、backup-status 仍在单一服务器故障域，当前没有真实异机目标、RPO/RTO、加密、保留、调度或告警证据。
- Dashboard 若只相信仓库期望值或静态环境变量，会把源码、运行镜像和数据库漂移误报为可恢复；恢复成功与回执发布之间也存在结果不确定窗口。

### Decision

1. 备份边界固定为 PostgreSQL、uploads、attachments、backup-status 四个数据域；manifest 同时绑定 deployment、数据库稳定身份/profile/bytes、应用版本、完整 Git SHA、实际 Web/Worker 容器与镜像 digest、完整 Migration manifest/head 和四制品摘要。
2. 数据库认证只接受固定 credential root 内 root-owned、单硬链接、`0400/0600` libpq service 文件；秘密不得进入 argv、stdout、manifest、receipt、Git 或聊天。service 中外部 `passfile`/`sslkey`引用失败关闭。
3. 一致性采用精确 Compose writer 已停止、持久数据库 fence intent、connection limit/默认只读/连接清退和备份前后全关系内容 reconciliation。该设计信任唯一串行 root/PostgreSQL superuser 运维边界，不声称抵御恶意并发 root。
4. 证据分为不可变 `LOCAL_VERIFIED`、`OFFHOST_VERIFIED`和`RESTORE_VERIFIED`。本机回执绑定 source machine/root，异机回执必须来自不同 machine identity 并绑定 receiver root，恢复回执必须来自与源不同 system identifier 的带 marker 隔离 TEST 集群；别名和 latest 只能单调前进。
5. 恢复只接受不存在的 `_restore_test`数据库和文件目标，异机字节先 private durable pin 再验证，数据库单事务恢复、文件 staging/原子晋升、最终数据库/文件 reconciliation。只清理本任务精确创建且身份闭合的目标；任何身份歧义隔离保留。
6. active inspection 完成后先写 root-only prepared receipt，再进入保全边界。发布失败保留已验证 TEST 目标和 prepared evidence；独立补发器只消费 prepared evidence，不重新连接数据库或读取可变文件。
7. Dashboard 只有在最新 `RESTORE_VERIFIED`、运行 release identity、数据库/Migration、policy/RPO、异机 receiver 和隔离恢复 target 全部匹配且未过期时才返回 `recovery_ready=true`。旧 V1 固定为 `LEGACY_LOCAL_ONLY`；缺失、伪造、替换、过期或不完整配置均失败关闭。
8. Runtime release identity 必须由 root 从已经运行的实际 Compose Web/Worker ID、镜像 digest、OCI version/revision和 baked version/Git生成并以只读文件提供给 Web；发布器不得控制容器。并发发布锁、完整 release manifest、Migration allowlist 和强制 release suite 留给 G3 独立任务。
9. PostgreSQL V2 使用 `--no-owner --no-acl`的完整应用数据库逻辑 dump；集群角色、角色密码、tablespace和集群级 ACL 明确排除，必须在正式灾备前另建恢复方案。

### Consequences

- `SELFHOST-OPS-BACKUP-RECOVERY-V2-41`以 41/41 合同测试和双独立 PostgreSQL 集群恢复测试证明 G1 工具路径；守卫 SIGKILL 恢复、普通故障注入清理、建库响应歧义和 prepared receipt 补发均通过。该证据只使用合成/隔离数据。
- PR-002 的旧工具缺口在 V2 仓库路径关闭，但 PR-001、真实异机备份、真实隔离恢复、角色/ACL恢复、调度/保留/告警和真实 RTO 仍保持阻断；`recovery_ready`当前不得被人工伪置为 true。
- 不可捕获的恢复进程/宿主硬故障可能留下带任务 marker 的隔离 TEST 目标。工具选择隔离保留而非猜测删除；后续只能按精确身份另行处置。
- 本决定不授权读取当前数据库或四卷、真实备份、外传、恢复、UAT build/Migration/deploy、账号权限、员工试用、生产切换或清理任何持久数据。

### Rejected alternatives

- 拒绝用同盘副本、Git/镜像锚点、单次 SHA 校验或本机 `VERIFIED`冒充异机可恢复。
- 拒绝在命令行传递数据库 URL/密码，或仅凭调用者参数声明服务静止。
- 拒绝原地恢复、覆盖已有数据库/目录、对身份不明目标执行 drop/delete，或在回执发布不确定时删除已验证恢复结果。
- 拒绝把浏览器按钮、静态期望 env、旧 V1 回执或“测试通过”单独解释为生产就绪。

## D-116 发布候选采用不可变证据包、精确 Migration Allowlist 与失败关闭串行门

- 日期：2026-08-12
- 状态：`ACCEPTED / REPOSITORY TOOLING VERIFIED / CANDIDATE EVIDENCE BLOCKED`
- 提案与实施：Codex 持续交付负责人及数据迁移、应用测试、运维安全智能体
- 确认边界：项目负责人已授权仓库内安全实施和隔离测试；镜像build、联网漏洞评估、UAT/生产Migration或部署、runtime identity发布和正式晋升仍须专项明确授权

### Context

- 源码alpha.44/0041、非生产UAT alpha.42/0040、历史GHCR锚点和发布台账不是同一候选，不能证明已验代码、镜像、Migration和运行面一致。
- 旧Migration runner会排序执行目录内全部SQL，虽有checksum和advisory lock，但没有冻结完整发布allowlist、目标数据库稳定身份或预期当前/目标head。
- 默认`npm test`只覆盖单一文件存储测试；没有固定资源阈值、全局锁、无skip、timeout、容器残留、SBOM和漏洞证据约束，也没有机器可审计的最终报告。

### Decision

1. 候选身份由一个严格、不可变release manifest定义，同时绑定完整Git commit/tree及clean源码、package版本、Dockerfile/Compose摘要、实际Web/Worker镜像digest与OCI/baked版本身份、完整有序Migration allowlist/head、版本化gate plan/report、镜像级SBOM和新鲜漏洞评估。未知字段、重复key、替换、过期、不完整或摘要漂移全部失败关闭。
2. manifest只能由root在仓库外固定权限证据根中创建；证据根和marker必须root-owned，制品必须普通文件、单硬链接、只读且采用无覆盖原子发布。创建器只读检查已经存在的精确镜像，不负责build、pull、run或deploy。
3. `test:release`使用固定root全局锁和版本化18步计划串行运行，其中独立包含安装后supervisor Python合同、80文件PostgreSQL回归、6文件Browser E2E和4文件POSIX专用门。必需步骤不能省略或以无理由N/A代替；缺失、skip/todo、失败、超时、命令输出禁用模式、资源越线、临时容器残留、既有容器restart/OOM或证据不新鲜都阻止晋升。计划和报告先写入不可消费的隐藏prepared文件，只有外层再次核验Git和镜像身份后才按精确摘要发布正式文件；报告仅持久化stdout/stderr摘要，不传播测试输出中的潜在秘密。
4. 资源门固定执行`COMPOSE_PARALLEL_LIMIT=1`和Node heap上限，并检查available memory、Swap使用率、60秒Swap增长、根盘、Load和临时容器数；一次只允许一个临时容器，失败后后续必需步骤记录为BLOCKED。
5. UAT/PRODUCTION Migration只接受`promotion_status=ELIGIBLE`的精确manifest及摘要、明确permission/confirmation、允许的deployment class、部署ID、数据库名/system identifier/OID/database comment marker、预期当前head和manifest目标head。应用运行连接和Migration连接必须分别由`DATABASE_URL`与必填`ERP_MIGRATION_DATABASE_URL`提供；Migration会话必须使用精确命名、可登录但非superuser/createrole/createdb/replication/bypassrls/pg_monitor、无任何角色成员关系和role/database级配置的专用数据库owner。进入advisory lock前后都重验目标与历史，目录外文件、重排、checksum漂移、历史越界或身份不符均在业务SQL前拒绝。
6. 离线lockfile清单只能标记`SOURCE_LOCKFILE`，漏洞状态必须为`NOT_EVALUATED`；它可证明合同失败关闭，但不能生成合格候选。只有实际Web/Worker镜像级SBOM和新鲜漏洞库PASS可以满足发布门。
7. `npm test`改为快速release合同门；实际候选还必须执行`test:release:all-node`的build+全部Node测试、全部tsconfig、lint、隔离Migration、备份恢复、Python三基线、Compose和安全证据。仓库既有完整typecheck失败不得被忽略、降级或改写为通过。
8. runtime release identity发布采用固定root锁、严格单调和同一证据幂等；先把新身份写入事务目录，外层第二次读取实际容器并精确比对后才commit，漂移则abort且旧正式身份保持不变。并发旧证据不得覆盖新证据，发布器仍只观察/写入身份文件，不控制运行容器。
9. 高权限发布动作不得直接信任候选仓库脚本；采用两提交生成的content-addressed supervisor bundle、root-only短时一次性授权和固定动作映射。安装器以全局锁、PREPARED/COMMITTED journal、不可变launcher store、receipt v2和明确previous launcher identity提供可恢复安装；PREPARED会完整保存规范授权且立即归档原授权，授权随后过期或pending文件消失也能按journal精确恢复，journal/receipt均采用同目录临时文件加原子rename。首次执行installer仍只允许来自root-owned、不可由group/world写的审阅路径，并须专项授权。

### Consequences

- `SELFHOST-OPS-RELEASE-GATE-42`的早期合同和隔离测试曾被三名只读审计智能体判定存在证据替换/过期、弱计划、宿主环境继承、高权限候选代码、Migration隔离旁路与并发锁等失败关闭缺口；这些缺口已经按上述合同修复，并以第二轮只读复核、合同测试、定向typecheck和隔离PostgreSQL/备份恢复验证收口。早期测试不作为最终证据。
- 完整多配置typecheck已实际运行并因既有ES2017 BigInt、历史声明和示例依赖等错误失败；没有候选镜像、镜像SBOM或联网漏洞PASS，因此真实release gate未运行且alpha.44/0041没有获得`ELIGIBLE`manifest。PR-003/PR-005只能记为`TOOLING READY / CANDIDATE EVIDENCE BLOCKED`，不能记为通过。
- `RELEASES.md`不新增虚假release；UAT继续alpha.42/0040。G3仓库工具通过本任务范围验收后，候选build、镜像级SBOM/漏洞评估、host supervisor安装和UAT对齐仍作为后续受控阶段，分别等待适用专项授权。
- 本决定不授权访问当前业务数据或四卷、构建/推送镜像、联网扫描、UAT/生产Migration/deploy、账号权限、员工试用、正式切换或清理持久数据。

### Rejected alternatives

- 拒绝用Git tag、package版本、镜像tag、单个测试PASS或手工清单代替同一候选manifest。
- 拒绝让Migration自动执行目录新增文件、仅凭数据库URL或调用者声明识别目标，或在锁后不复核历史。
- 拒绝把lockfile依赖清单称为镜像SBOM，把离线未评估称为零漏洞，或为完成任务跳过既有typecheck失败。
- 拒绝由release gate隐式build、pull、deploy或输出完整命令日志，也拒绝并发运行重型门禁。

## D-117 物料导入 fallback 采用持久幂等、staging 原子提升与可恢复协调

- 日期：2026-08-12
- 状态：`ACCEPTED / IMPLEMENTED AND ISOLATED-VERIFIED / RUNTIME NOT DEPLOYED / PRODUCTION USE NOT AUTHORIZED`
- 提案与实施：Codex 持续交付负责人，依据项目负责人持续推进G4和仓库内安全实施授权
- 确认边界：该技术决定只授权源码、expand-only Migration和隔离测试；UAT/生产Migration、部署、真实数据、账号与正式使用仍须专项明确授权

### Context

- 客户端导入流程已经生成可重用操作标识，并发送预期批次版本、客户端SHA-256、大小和重复策略；自托管fallback却忽略这些字段，建批没有持久幂等。
- 上传当前先把multipart文件写进永久uploads，再在数据库核验批次owner并写文件行；越权、状态冲突、数据库失败或进程中断可能留下孤儿文件，且单批次可重复上传。
- 文件DTO只按扩展名推断类型并无条件声称`BASIC_CHECK_PASSED`；后台job读取也没有通过aggregate批次复核行级可见性。
- PostgreSQL事务无法与普通本地文件系统rename组成真正分布式ACID。安全设计必须承认结果未知窗口，持久化意图和事实，并支持确定性协调。

### Decision

1. 建批和上传都使用既有`material_import_idempotency`作为持久操作记录，唯一作用域绑定username、method、精确route scope和key digest，请求摘要绑定业务载荷；同请求重放原状态/响应，异请求409，并发只有一个执行者。
2. 上传在读取大请求体前先完成认证、权限、CSRF、必填元数据头、owner、允许状态、CAS和幂等意图检查。不可见批次统一404，失败前不得创建任何staging或正式文件。
3. 文件先写入同一uploads根下不可由业务读取的私有staging命名空间；路径由服务端operation identity决定，禁止使用原始文件名作为路径。写入采用临时文件、fsync、无覆盖发布和目录fsync。
4. 服务端独立计算实际SHA-256和大小，检测文件签名，并把扩展名、声明MIME/摘要/大小、检测类型、实际摘要/大小及基础安全检查状态持久化。声明与实际不一致、危险签名、宏/压缩包限制、二进制伪CSV等全部失败关闭，不再由DTO推断通过。
5. 通过检查后，只能把已验证staging文件在同一文件系统无覆盖原子提升到确定性正式路径；最终数据库事务再次锁定幂等记录、batch和file，验证版本/状态/事实后才发布`FILE_READY`及成功响应。
6. 跨数据库/文件系统采用saga而非虚假ACID。每一阶段持久化operation/file状态；重试或协调器按确定性路径和摘要安全继续、补偿已知staging，或把批次标为`RECONCILIATION_REQUIRED`。身份不明、摘要不符或可能已发布的文件不得猜测删除。
7. 单批次只允许一个有效文件；状态机、唯一索引和CAS共同阻止并发双上传。重复内容默认拒绝；只有明确`ALLOW_DUPLICATE`且`retry_of_batch_id`关系闭合时允许新批次继续，原失败批次不改写。
8. `/api/jobs/:id`必须把`background_jobs`经material import outbox aggregate关联到batch，再执行owner或`material.import.read_any`可见性；无记录和不可见统一404。响应只提供有界状态字段，不返回payload、原始错误正文或未经允许的跨批次结果。
9. 数据模型先由0042扩展；0042发布后保持不可变。发现终态完整性约束需修正时，只能追加0043，不得回写0042；因此0001—0042全部不可变，Schema、0042/0043 snapshot、journal、运行查询和空库/升级/重放/回滚测试必须一致。

### Consequences

- TASK43已新增独立fallback服务边界并缩小`selfhost-api.ts`职责；源码提交`5767c92e51e4f25ba49fa4431299f265ef4cb7aa`及manifest-only直接子提交`dad7468`绑定最终实现和证据包，bundle SHA-256为`b948e08861e5114660650e21faa9374cef879b354cb59c6c0d0bdb62960228e9`。
- 0042建立关系化fallback安全模型，0043以append-only方式修正终态约束；fallback unit/handler 20/20、worker resilience 8/8、UI 107/107、Migration 4/4、parser/API client 45/45、隔离PostgreSQL fallback 17/17与真实XLSX worker 1/1通过。release inventory现为230/206/24。
- 成功关闭PR-004仍只代表源码候选安全边界通过；在同候选build、UAT Migration/deploy、真实源分析和人工验收完成前，运行UAT仍保留旧风险且系统继续`PRODUCTION NO-GO`。
- 协调记录和私有staging会增加受控运维对象；必须提供只处理身份闭合任务的reconcile/reaper入口和运行手册，不允许无界扫描或删除未知文件。
- 本决定不授权真实供应商文件、当前uploads/数据库读取、UAT/生产Migration、部署、员工试用、正式切换或清理任何持久数据。

### Rejected alternatives

- 拒绝继续把客户端摘要、扩展名或MIME当作服务端安全事实。
- 拒绝先写永久文件再验权，或仅在异常catch中best-effort删除而没有持久意图/协调状态。
- 拒绝用数据库事务包装文件rename后声称跨介质原子，也拒绝遇到不确定状态时覆盖、重复创建或猜测删除。
- 拒绝只隐藏job按钮或按UUID存在性授权读取。

## D-118 会话采用8小时 idle、24小时 absolute、数据库时钟原子认证与单次超时审计

- 日期：2026-08-12
- 状态：`ACCEPTED AND IMPLEMENTED IN SOURCE / ISOLATED TESTS VERIFIED / RUNTIME NOT AUTHORIZED`
- 提案与实施：Codex 持续交付负责人，依据项目负责人持续推进G4和仓库内安全实施授权
- 确认边界：只授权源码、append-only Migration和合成/隔离测试；UAT/生产Migration、部署、账号权限、员工试用和正式使用仍须专项明确授权

### Context

- `app_sessions`只有可滑动的`expires_at`，没有创建时固定且不可延长的绝对截止；持续访问可无限续期。
- 当前认证先SELECT、用Node `Date.now()`判断，再单独UPDATE延期且不核对row count；并发撤销或用户停用可能已经生效，但旧actor仍被返回，应用与数据库时钟漂移也会改变安全判定。
- 过期没有持久终态原因或一次性Audit；`/api/session`及通用受保护API对expired/unknown token没有一致清除Session和CSRF Cookie。
- 岗位权限矩阵需要业务负责人确认，health/Worker/storage真实性属于独立运维边界；两者不并入本任务。

### Decision

1. 会话保留8小时idle期限，并在创建时增加固定24小时`absolute_expires_at`；续期只能取`least(now()+8 hours, absolute_expires_at)`，absolute deadline不可改写或延长。
2. 0044按expand/backfill/constraint实施：已有会话回填`created_at+24 hours`并向下夹紧idle deadline。升级时已经超过24小时的旧会话失效，这是明确安全结果；0001—0043保持不可变。
3. 认证授权使用PostgreSQL `now()`，并遵循用户→会话一致锁序，在一个事务内判定用户active、撤销、idle与absolute期限及续期。状态已变化或续期未生效时不得返回AUTHENTICATED actor。
4. 首次观察到idle或absolute超时的请求分别原子写入`IDLE_TIMEOUT`或`ABSOLUTE_TIMEOUT`终态，并写一条不含token、摘要或时间细节的Identity Audit；并发重复请求不得重复终态化或重复审计。
5. 已撤销保持`SESSION_REVOKED`；超时返回稳定`SESSION_EXPIRED`和中文提示；携带expired、revoked或unknown token的`/api/session`及通用受保护API都清除Session与CSRF Cookie。无Cookie匿名请求不产生副作用。
6. 0044增加deadline约束、不可变guard和待过期索引；Schema、snapshot、journal、运行查询、release allowlist及空库/0043升级/重放/回滚测试必须一致。
7. API不暴露absolute/idle内部时间、撤销原因、token摘要、SQL、堆栈或敏感审计正文。request ID、`no-store`和既有Cookie安全属性保持。

### Consequences

- TASK44已把源码推进到alpha.45/head 0044：源码`e7b0298f90ba85a5018709be1360a40dacbbaa59`与manifest-only直接子提交`c730fefe0857d2e4546f28364ca53d5e6506d099`形成证据链，0044 SHA-256为`a24df944…aa7e`。定向55/55、隔离PostgreSQL 21/21、官方Migration harness、release合同与232项inventory通过；因此仓库风险已关闭，但运行UAT未部署，不能据此批准真实使用。
- 0044应用后，创建已超过24小时的历史会话会在下次认证时终态化；升级/部署计划必须提前告知受影响用户重新登录，不得静默延长旧会话。
- 每次有效访问仍有受控数据库写入；后续容量任务应验证真实会话并发，但不得以性能理由绕过锁、deadline或审计。
- 本决定不修改岗位角色、业务权限、MFA、密码策略、登录失败阈值、并发会话数、health/Worker/storage探针，也不授权运行面变更。

### Rejected alternatives

- 拒绝只依赖Cookie `Max-Age`、浏览器过期或Node应用时钟承担服务端授权。
- 拒绝继续SELECT后独立UPDATE并忽略row count，或通过重试把absolute deadline滑动延长。
- 拒绝每次过期请求重复写审计、把未知token细分给客户端，或只在`/api/session`清Cookie而让普通受保护API继续携带失效凭据。
- 拒绝回写已发布Migration或把岗位权限、health和会话安全混成同一任务。

## D-119 运行健康采用完整 Migration Manifest、Worker 数据库租约与双侧文件卷探针

- 日期：2026-08-12
- 状态：`ACCEPTED AND IMPLEMENTED IN SOURCE / ISOLATED TESTS VERIFIED / RUNTIME NOT AUTHORIZED`
- 提案与实施：Codex 持续交付负责人及数据迁移、应用测试、运维安全只读智能体，依据项目负责人持续推进G4和仓库内安全实施授权
- 确认边界：只授权源码、append-only Migration、合成文件目录和隔离PostgreSQL测试；build、UAT/生产Migration、部署、当前卷读取、监控凭据、账号权限和员工试用仍须专项明确授权

### Context

- 当前`/api/health`读取package version后只执行`select 1`，随后固定声明`storage=local`和`worker=postgresql-jobs`；Worker停止、数据库Migration漂移或本地卷不可写时仍可能HTTP 200。
- `background_jobs.heartbeat_at`只证明某一运行任务的租约，不证明空闲Worker进程存活；Compose Worker没有healthcheck，`running`不能代表能够安全消费任务。
- Web和Worker都挂载uploads/attachments，但没有启动/运行探针；权限、只读挂载、路径替换、容量或fsync故障只能在真实业务写入后暴露。
- TASK41已经为备份、RPO、异机回执和隔离恢复建立独立带权限治理。备份过期必须阻止投产并告警，但不应通过公开HTTP readiness主动下线仍可服务的应用；本任务不复制或弱化该边界。

### Decision

1. 新增append-only 0045运行租约表，以固定service key、instance UUID、application version、Git commit、Migration head/manifest digest、started/heartbeat/lease/stopped时间、状态和CAS version保存Worker运行事实；有效租约不得被第二实例覆盖，只有过期或已停止租约可由数据库时钟受控接管。
2. Worker启动前验证package与baked version/Git、数据库完整有序Migration manifest以及自身uploads/attachments挂载可写；运行期间单飞续租。每次启动原子生成容器内`0600` instance UUID文件，Docker healthcheck只认可该进程精确租约；续租CAS失败、租约已过期、身份漂移或文件卷持续不可用时不得继续伪报健康。
3. Web readiness从`ONLY public.schema_migrations`完整有序行生成规范manifest并与镜像内root-owned不可变allowlist精确比对，拒绝缺失、额外、重排、重复或checksum漂移；Worker租约必须新鲜且版本/Git/Migration身份与Web一致。统一digest算法为release合同的`sha256(canonicalJson([{ordinal,filename,sha256},...]))`，不得与备份合同的文本digest同名混用。
4. 文件卷探针必须在配置根内创建随机私有临时目录和文件，执行有界写、文件fsync、unlink/rmdir及目录fsync；成功和失败都只清理本次明确创建的路径，不扫描、覆盖或删除业务文件，不把路径或原始错误返回客户端。匿名Web health采用模块级single-flight和短TTL缓存，缓存不得越过租约有效期，防止公开请求写放大。
5. `/api/live`在初始化数据库Pool前分流，只证明Web进程和版本元数据可读取；`/api/health`作为readiness保留既有兼容字段并新增有界revision、Migration head和component结果。任何数据库、Migration、Worker、Web文件卷或生产runtime identity失败返回503、稳定中文代码、request ID和`no-store`；客户端与日志都不返回SQL、连接串、路径、instance ID、堆栈或原始异常。
6. Compose Web继续使用readiness healthcheck；Worker新增独立脚本查询同一运行租约并形成Docker health。runtime release identity publisher必须看到Web和Worker都`healthy`，不再把Worker `running/health=none`当作可发布事实。
7. 0045发布后不可修改；Schema、snapshot、journal、运行查询、release allowlist和空库/0044升级/重放/失败回滚测试必须一致，0001—0044保持不可变。
8. 备份/RPO/隔离恢复继续由TASK41 Dashboard/recovery governance和外部运维告警负责；公开readiness不返回备份ID、位置或回执，也不因备份过期直接让Web退出服务，但正式投产/切换门必须继续要求`recovery_ready=true`。

### Consequences

- TASK45已把源码推进到alpha.46/head 0045。源码`74940866f7deac7b2751278479e8cefb4df35c1c`/tree`d4673e36b6822deb0f6d2d6058b36c6ffb3cf2f1`与manifest-only直接子提交`dcef6f67c75d771ad3a3dd9fe6f5aa385fc81f92`形成证据链，bundle SHA-256为`090f72189bab8c61fec11810550da4426f123adac6d3d4391da5d49b62028606`。
- 0045 SHA-256为`cc4685a08d97d49717e3c65c069131be17e9fc1cddd52b429ef64202c40180fc`；0001—0044未修改，Schema/233表snapshot/journal/运行查询/release allowlist一致。runtime readiness定向42/42、隔离PostgreSQL5/5、官方Migration harness、release合同44/44、supervisor15/15、TASK45/release-contract定向typecheck及235项inventory通过。
- 这些证据只关闭仓库与隔离环境风险。当前非生产UAT仍为alpha.42/0040、Worker health=none且运行旧health逻辑；在同候选完整gate、获准build、Migration/deploy和运行验收前，不能声明运行面已修复或允许真实使用。
- 每个Web health周期和Worker heartbeat都会产生极小、可清理的文件元数据I/O与数据库写；探针频率必须有界，低资源测试需串行并验证无残留、无Swap/OOM/restart异常。
- 新Worker在有效旧租约存在时失败关闭；部署编排必须等待旧实例停止或租约自然过期，不得人工篡改运行租约来绕过排他。
- 本决定不授权读取当前持久卷正文、真实数据、build、UAT/生产Migration/deploy、账号权限、监控外发、员工试用、正式切换或清理任何持久对象。

### Rejected alternatives

- 拒绝继续使用`select 1`、Docker `running`、业务Job heartbeat或固定字符串冒充完整readiness。
- 拒绝只检查Unix mode、目录存在或可读而不实际写入/fsync/清理，也拒绝用固定探针文件覆盖或扫描业务目录。
- 拒绝只比较Migration count/head而忽略每个checksum，或只相信环境变量而不比对package、数据库和Worker写入身份。
- 拒绝把liveness、readiness、备份恢复和岗位权限合并为一个公开端点，或用备份过期把仍可服务的Web主动下线。

## D-120 发布TypeScript门采用Node 22 / ES2022与精确38配置失败关闭清单

- 日期：2026-08-12
- 状态：`ACCEPTED / IMPLEMENTED / SOURCE ONLY / RUNTIME NOT AUTHORIZED`
- 提案与实施：Codex持续交付负责人，依据项目负责人持续推进、仓库安全实施和隔离测试授权
- 确认边界：只适用于仓库TypeScript编译合同；Browser、候选镜像、UAT/生产Migration/deploy、真实数据和正式晋升仍须各自证据或专项授权

### Context

- D-116要求完整发布门逐个执行全部TypeScript配置，但既有根配置仍以ES2017为target，不能表达项目已经依赖的BigInt、现代正则和Node 22运行能力。
- 仓库有38份`tsconfig*.json`，历史上只有任务定向配置通过；动态glob如果没有精确集合合同，会允许新增、删除、重命名或漏跑后仍提前成功。
- 干净Git快照为只读，TypeScript默认增量写入会尝试生成`tsconfig.tsbuildinfo`，这属于执行器副作用而非源码错误。

### Decision

1. 自托管发布TypeScript运行合同固定为Node 22和ES2022；根配置采用ES2022 target，任务级配置继续继承或保持等价的现代运行边界。
2. 发布门维护精确、排序的38份配置清单，并在执行前后核对配置集合、普通文件身份与内容SHA-256；新增、删除、重命名、漏跑、执行中漂移或提前成功全部失败关闭。
3. 每份配置固定以`--incremental false`执行，使干净只读提交快照不产生build info，同时保留`strict`、`noEmit`和`isolatedModules`等既有严格性。
4. 只允许从根配置排除历史D1示例和已经废弃的本地D1 seed脚本；不得排除任何自托管可发布源码，不得用`skip`、ignore、空声明或弱化类型掩盖失败。
5. 完整门必须在固定离线Node镜像和资源限制中对干净已提交快照38/38通过，并至少重复一次证明执行器和集合合同稳定；定向typecheck不能替代该证据。

### Consequences

- TASK46已修复真实类型问题并在源码`f3bac028bdb9ccf4c79be279ea7c4f698cbdd4f5`/tree`87fb1340bc1b7067e67be29677960546b0f8cd5c`及bundle直接子提交`3d1243e294236602975d3beb29e8f991b84db96d`的两个干净快照分别完成38/38；bundle manifest SHA-256为`a92c0a4088693b7bd23493a4820457b3f9dae4e2807e416f20218cb0e1d3b97b`。
- PR-005中的完整TypeScript子门在仓库候选层关闭；固定Browser运行时、候选镜像、镜像SBOM/新鲜漏洞PASS和完整18步同候选门仍开放，不能据此生成`ELIGIBLE`manifest或部署UAT。
- 本决定没有修改Schema/Migration、业务规则、权限、事务、API、版本或运行面；UAT继续alpha.42/0040，系统保持`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝仅运行根配置或任务定向配置、动态发现后不锁集合、跳过失败配置或把配置移出清单。
- 拒绝继续用ES2017再为BigInt/正则添加伪声明，也拒绝用`skipLibCheck`、`@ts-ignore`、空声明或扩大exclude隐藏自托管源码。
- 拒绝让类型检查在只读候选快照写入增量制品，或把工作区缓存当作可重复发布证据。

## D-121 Browser 发布门采用内容寻址 Playwright、同容器 PostgreSQL 与历史精确 Migration 模板

- 日期：2026-08-12
- 状态：`ACCEPTED / IMPLEMENTED / 6 FILES 11 TESTS VERIFIED / RUNTIME NOT DEPLOYED / PRODUCTION NO-GO`
- 提案与实施：Codex 持续交付负责人，依据项目负责人持续推进、智能体团队组织和隔离测试授权
- 确认边界：只适用于仓库发布测试运行时和合成隔离数据库；候选镜像、UAT/生产 Migration/deploy、真实数据、账号、员工试用和正式晋升仍须分别满足证据或专项授权

### Context

- D-116 的官方发布清单已经把 6 个 Browser 文件标为 REQUIRED，但执行器固定返回运行时不可用；因此任何候选都不可能完成 18 步发布门。
- 六个文件需要真实 Chromium、standalone Web 和 PostgreSQL 17，并分别断言历史 Migration head 0036—0039；把它们改跑当前 head 会弱化既有迁移边界，而连接 UAT 则违反隔离和生产保护规则。
- 宿主没有 Node/Chromium，当前依赖也没有 Playwright。动态下载浏览器、使用浮动tag或从工作区未提交源码构建都会让发布证据不可重放。
- 低资源规则只允许一个临时容器；独立 Web、Browser、PostgreSQL 三容器并行会突破资源和临时容器合同。

### Decision

1. Browser runtime 固定为官方 Playwright `linux/amd64`镜像完整Repo/config digest，固定`playwright-core 1.51.1`、Chromium revision 1161/version `134.0.6998.35`以及实际可执行文件路径和SHA-256；依赖树、lock、镜像或可执行文件任一漂移均失败关闭且不得隐式pull。
2. 发布动作只接受干净HEAD。源码通过Git archive进入不可变快照，在已固定Node 22镜像、无网络和受限资源下以非root用户生成测试专用standalone；源码文件只读，只允许`.vinext`、`dist`和明确tmpfs写入。
3. PostgreSQL使用既有内容寻址17镜像。执行器先创建、导出并删除唯一临时容器，再把rootfs作为本任务私有可写目录挂入唯一Browser容器；同一网络命名空间仅启用loopback，外部网络为`none`，不挂载Docker socket、UAT或四个持久卷。
4. Browser容器仅增加`SYS_CHROOT`、`SETUID`、`SETGID`以用UID 999启动隔离PostgreSQL并降权到UID 1000运行Node/Chromium；保持只读rootfs、`no-new-privileges`、memory/swap/CPU/PID限制和有界tmpfs。成功、失败和信号路径都按精确label/name停止数据库、终止进程组并清理本任务资源。
5. 执行器从官方inventory复核恰好6个`BROWSER_E2E` REQUIRED文件及摘要，并固定每项数据库名、确认变量、loopback端口和Migration head。先事务性建立0036/0037/0038/0039模板，再逐库创建、逐文件串行执行和删除；新增、删除、重排、skip/todo、超时、端口/进程泄漏或总计不是11项全部失败关闭。
6. 发布runtime policy和gate report必须绑定Browser镜像digest及Chromium可执行SHA；supervisor bundle必须包含Browser shell、runner与Python负向合同。Browser动作不再允许“运行时不可用”占位成功或人工替代。
7. npm报告的既有依赖漏洞不因加入测试运行时而降级或隐藏；镜像级SBOM与新鲜漏洞零发现仍由后续候选安全门独立失败关闭。

### Consequences

- 仓库具备可重放、无外网、历史Migration精确且不接触UAT的Browser门实现；正式6文件/11项已在干净提交快照全部通过，supervisor合同、release合同和最终39文件bundle也已验证并固化。
- Browser镜像和导出的PostgreSQL rootfs增加临时磁盘占用，故执行前后必须检查至少10 GiB根盘、available memory、Swap、Load、OOM/restart并确认精确临时目录/容器清零。
- 本决定只关闭Browser子门，不证明候选Web/Worker镜像安全，也不授权镜像push、UAT/生产运行面变更、真实数据或员工使用；候选镜像级SBOM、新鲜漏洞PASS及完整18步同候选门仍失败关闭，系统继续`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝动态`npx playwright install`、浮动镜像tag、宿主浏览器或未锁定可执行文件，也拒绝把缺失运行时标为N/A/PASS。
- 拒绝把六个历史数据库断言改到当前head、共享一个污染数据库、连接UAT，或以mock/HTTP桩替代真实浏览器和服务端流程。
- 拒绝并行启动独立数据库/Web/Browser容器、挂载Docker socket或为方便扩大capability，也拒绝在失败时按模糊名称批量删除容器和目录。

## D-122 隔离候选构建只授权本机证据链，不授权外部推送、宿主发布能力或运行面变更

- 日期：2026-08-13
- 状态：`ACCEPTED / TASK48 IN PROGRESS / PRODUCTION NO-GO`
- 提案与实施：Codex 持续交付负责人，依据项目负责人本轮持续目标和明确隔离构建授权
- 确认边界：本机隔离测试、构建和Migration演练已授权；生产数据、外部上传、正式备份恢复、host supervisor、UAT/生产Migration/deploy、账号权限、系统配置、员工写入和切换仍须专项明确授权

### Context

- D-116最初明确把候选镜像build、联网漏洞评估和host supervisor安装留给后续专项授权；本轮项目负责人随后明确允许仓库内安全修改以及“隔离环境中的测试、构建和迁移演练”。
- TASK47已关闭Browser子门，但PR-003/PR-005仍缺精确Web/Worker候选、registry digest、镜像级SBOM、新鲜漏洞数据库PASS和完整同候选18步报告。
- 发布脚本只接受registry digest并要求installed content-addressed supervisor；当前host上没有launcher、bundle、安装回执或release authorization目录。直接设置内部环境变量会破坏D-116高权限边界。

### Decision

1. TASK48可从精确已提交Git commit/tree在本机串行build Web/Worker，允许只下载内容寻址的公共基础/工具镜像及漏洞数据库；所有下载仅为输入，不上传仓库、业务数据、凭据或候选制品。
2. 为取得严格registry digest，可使用仅绑定loopback、任务专用且完成后精确清理的临时registry。候选不得推送到GHCR或其他外部registry，不创建`latest`、浮动tag或对现行Compose可解析的部署tag。
3. Trivy必须固定到D-116策略的0.70.0完整镜像digest；数据库和证据均不超过72小时，扫描覆盖Web/Worker全部severity。任一已知漏洞或未知状态拒绝候选，不使用ignore、waiver、严重度降级或lockfile替代。
4. 构建、registry、数据库准备、扫描和测试遵守一次一个临时容器及低资源停止线；不挂载UAT/生产数据库或四个受保护Volume，不读取真实业务数据。
5. 正式镜像证据和18步门仍只允许installed content-addressed supervisor与一次性root授权调用。当前授权不包含把launcher/bundle/authorization持久写入`/usr/local`或`/var/lib`；未安装时必须记录失败关闭，不得直接调用脚本并伪造正式PASS。
6. TASK48可先完成不依赖host安装的候选build、身份核验、漏洞发现/修复和隔离测试；若最终只剩host supervisor安装，则记录精确影响与最小专项授权需求，并自动转向其他安全未阻塞任务。
7. 18步门可按既有D-116合同只读观察`chenyida-erp-parallel`四服务的Docker状态、restart、OOM和health元数据，并要求前后完全一致；这不授权访问UAT网络、API、数据库、日志、卷正文或执行任何服务变更。元数据漂移直接拒绝候选。

### Consequences

- 本机候选镜像、loopback registry digest和扫描制品仍只是隔离证据，不是UAT/生产release，不得更新运行identity或把`RELEASES.md`写成已部署版本。
- 新鲜漏洞数据库需要公共网络下载，但不会向外部发送真实数据、仓库源码或候选镜像；下载来源、digest、时间和数据库payload必须可复核。
- host supervisor安装、UAT对齐、真实异机恢复、岗位矩阵、真实迁移、员工试用和切换继续保持独立门禁。

### Rejected alternatives

- 拒绝把本地image ID、浮动tag、lockfile清单或过期扫描当作registry digest/SBOM/漏洞PASS。
- 拒绝向外部registry推送未晋升候选，或为取得RepoDigest修改Docker daemon配置。
- 拒绝直接设置`ERP_RELEASE_SUPERVISOR_LAUNCHED=YES`、复制候选脚本到可信路径或持久安装host supervisor来绕过专项授权。

## D-123 候选构建采用精确 Git archive、内容寻址构建输入与强绑定本地构建回执

- 日期：2026-08-13
- 状态：`ACCEPTED / SOURCE IMPLEMENTED / ISOLATED CONTRACTS VERIFIED / EXACT CANDIDATE BUILD VERIFIED / FORMAL GATE PENDING`
- 提案与实施：Codex 持续交付负责人，依据 D-122 的本机隔离构建授权及三条只读审计结论
- 确认边界：只适用于本机隔离候选构建、回执和发布证据合同；不构成外部镜像恢复锚点、可复现构建证明、host supervisor 安装、UAT/生产 Migration/deploy 或正式晋升授权

### Context

- 既有 Dockerfile 使用浮动 Node tag 和浮动 Dockerfile frontend；没有单一受控构建入口证明镜像来自精确已提交 tree，普通 worktree build 可能把未跟踪文件带入上下文。
- 严格发布证据原先能证明“扫描了哪个镜像”，但不能证明该镜像由哪个 Git archive、Dockerfile、lockfile、builder/frontend/base 和构建策略产生。
- TASK42 supervisor bundle有意不携带业务 Migration 正文。既有 gate wrapper却从installed bundle相对路径计算allowlist，正式installed布局会在开始测试前确定性失败。
- D-122只允许临时loopback registry。本地registry digest在registry清理后仍可由当前Docker engine解析和保存，但不是异机或外部恢复锚点，必须显式披露。

### Decision

1. 候选构建入口只接受当前clean HEAD的精确commit/tree，并用禁用replace refs、hooks、fsmonitor、外部Git配置和textconv的`git archive`生成唯一构建上下文；Site下任何未跟踪文件都会在构建前后阻断。
2. Dockerfile frontend固定为linux/amd64 manifest digest，三个Node阶段固定同一完整Node 22 digest；构建前要求固定Node与registry镜像已在本机，buildx使用固定`default`/`docker` driver、`--pull=false --provenance=false --platform linux/amd64`并记录Docker/buildx/BuildKit版本。Web和Worker按目标严格串行构建且OCI/baked version/revision绑定同一commit。
3. 依赖安装仍需访问公共npm registry，完整性由已提交`package-lock.json`和`npm ci --ignore-scripts --no-audit --no-fund`约束；应用`npm run build`阶段显式`--network=none`。回执必须写明`PUBLIC_NPM_FETCH_WITH_LOCKFILE_INTEGRITY`，不得把本流程称为完全离线或可复现构建证明。
4. 临时registry只绑定随机loopback端口、使用固定Registry 2.8.3 digest和任务私有存储；Web/Worker只以精确commit tag推入该registry，随后解析registry manifest digest、按digest回拉并核对config identity。registry容器和私有数据必须在生成“已移除”回执前精确删除；不创建`latest`、不登录或推送外部registry。
5. root在仓库外受信制品根无覆盖写入`candidate-build-provenance/v1`：绑定Git commit/tree、archive摘要/字节数、Dockerfile/.dockerignore/lockfile/构建器/producer摘要、frontend/base/registry身份、Docker/buildx版本、两目标registry/config digest、OCI/baked身份、USER/CMD、策略和局限。失败路径只删除本任务明确拥有的tag/digest引用、容器和临时目录。
6. 镜像扫描provenance升级为v2并强制引用同run ID、同candidate、同Web/Worker digest reference的root-owned `0440`构建回执；回执缺失、替换、摘要漂移、候选不符或本地digest引用不符都在发布证据产生前失败关闭。
7. 正式installed gate继续从content-addressed supervisor bundle加载合同代码，但Migration allowlist必须显式读取精确候选仓库的`chenyida_erp_site/drizzle-postgres`。语义回归必须构造“不含Migration正文的installed bundle + 独立候选目录”，证明可信代码/候选数据边界没有混淆。
8. 本地回执和digest只可标记`LOCAL_ISOLATED_CANDIDATE / NO_EXTERNAL_REGISTRY_ANCHOR / NO_REPRODUCIBLE_BUILD_ATTESTATION / LOCAL_ENGINE_ONLY`。只有未来建立经授权的外部不可变镜像锚点并完成正式supervisor证据与18步门后，候选才可能晋升。

### Consequences

- TASK48源码层已固定Dockerfile frontend/Node基础镜像、候选构建器、构建回执和scan provenance v2，并修复installed supervisor Migration目录缺陷；定向固定Node 38/38、官方release-contract 6文件/48项及lint 0 error通过。
- 构建器会访问公共npm依赖源并把候选层写入本机Docker engine；它不上传源码、候选或业务数据。运行前后仍须执行低资源和UAT元数据核验，且不得挂载四个受保护Volume。
- 回执中的loopback digest reference在临时registry删除后不具备外部可恢复性。若本机镜像被删除，现有回执不能自行恢复镜像；这会阻止正式`ELIGIBLE`和任何部署。
- host supervisor仍未安装。仓库脚本或等价手工测试不能被记为正式镜像证据、18步PASS或release manifest；最小解除条件仍是项目负责人对精确bundle安装和一次性发布动作另行专项授权。

### Rejected alternatives

- 拒绝从脏worktree、目录复制、浮动tag/frontend/base或未记录的builder直接构建候选。
- 拒绝把`package-lock.json`称为完全离线依赖来源，或把BuildKit cache命中称为可复现构建证明。
- 拒绝让扫描证据只绑定最终image ID而不绑定构建来源，也拒绝使用手工JSON回执或可覆盖文件。
- 拒绝把Migration复制进supervisor bundle，或让installed可信代码从自身缺失的相对业务目录计算候选allowlist。

## D-124 发布镜像身份分离 registry manifest、运行时本地身份与 OCI config digest

- 日期：2026-08-13
- 状态：`ACCEPTED / SOURCE IMPLEMENTED / ISOLATED CONTRACTS VERIFIED / EXACT CANDIDATE REBUILD VERIFIED / FORMAL GATE PENDING`
- 提案与实施：Codex 持续交付负责人，依据 TASK48 首次真实候选归档核验结果
- 确认边界：只修正本机候选构建、扫描和发布证据的镜像身份语义；不授权外部推送、host supervisor 安装、UAT/生产 Migration/deploy 或正式晋升

### Context

- Docker 29 的 containerd image store 对按 registry digest 拉取的镜像把 `docker image inspect .Id` 和容器 `.Image`报告为 registry manifest digest；它不再保证该值是 OCI image config digest。
- TASK48 首个候选的 Web 引用/`.Id`为`sha256:fbff…`，但`docker image save`内 `manifest.json.Config` 为`sha256:ddfb…`；Worker 同样分别为`sha256:ec84…`与`sha256:f471…`。既有回执和扫描合同把两者强制相等，正式证据会在归档核验处确定性失败。
- registry manifest 对应可拉取、可部署和容器运行时引用；config digest 对应归档内配置对象及 Trivy `ImageID`。二者都是必要身份，但不能共用一个字段或名称。

### Decision

1. 候选、release manifest、运行identity和安全报告中的`web_image_digest`/`worker_image_digest`统一表示镜像引用中的registry manifest digest；必须等于`image_reference`的`@sha256:`值。
2. 构建回执每个target继续同时保存`registry_manifest_digest`和`image_config_digest`。前者来自精确digest reference并与Docker本地manifest身份核对；后者来自该已构建manifest的`Descriptor.annotations["config.digest"]`，缺失或格式错误即拒绝候选。
3. 扫描前必须按精确manifest reference执行`docker image save`，从归档`manifest.json.Config`独立取得config digest；严格兼容传统`<digest>.json`与Docker 29 containerd store的`blobs/sha256/<digest>`布局，并实际重算配置blob SHA-256。结果必须与构建回执target逐项相等，扫描前后manifest inspect必须稳定；任何manifest/config/reference不闭合都不生成SBOM或安全PASS。
4. Trivy原生漏洞报告和CycloneDX中的`ImageID`绑定config digest；规范化安全报告的target `image_digest`仍绑定registry manifest digest。可信bundle复核时同时交叉验证构建回执、扫描provenance、归档config、原生报告和digest reference。
5. 固定Trivy自身以完整registry manifest digest、linux/amd64、本地inspect身份、版本及二进制SHA-256联合识别，不再把Docker `.Id`误命名为scanner config digest。
6. `candidate-build-provenance`升为v2，`image-scan-provenance`升为v3；v1/v2旧语义回执失败关闭，不兼容接受或静默改写。D-123中把manifest/config视为同一值的表述由本决定取代。

### Consequences

- 首个`5ba0e43`候选的存活、入口和Migration内容检查仍是有效诊断，但其v1构建回执不能进入正式镜像证据，必须从修正后的新提交重新构建。
- 修正不降低零漏洞策略，也不把本地ID、tag或config digest冒充可恢复registry锚点；外部不可变镜像锚点仍是独立未满足条件。
- 定向release合同会证明manifest/config使用不同fixture时仍能闭合，并会拒绝归档config与构建回执漂移；真实Docker 29归档另证明containerd blob路径和blob内容摘要均受约束。完整inventory、supervisor bundle刷新和真实候选重建仍须继续完成。

### Rejected alternatives

- 拒绝为迁就Docker版本继续把`.Id`命名为config digest，或跳过归档config核验后直接扫描。
- 拒绝只使用config digest作为部署引用，因为它不是现有本地registry回执中的可拉取manifest reference；也拒绝只使用manifest digest而不约束Trivy实际扫描到的config。
- 拒绝兼容接受旧回执、手工修改既有不可变回执或把首次失败检查记为漏洞扫描PASS。

## D-125 最终运行层采用固定 Wolfi Node 22 最小包并删除可证明仅构建使用的 image-size

- 日期：2026-08-13
- 状态：`ACCEPTED / CURRENT 8952a81 CANDIDATE BUILT / 6 FILES 48 CONTRACT TESTS VERIFIED / DIAGNOSTIC ZERO / FORMAL SUPERVISOR GATE BLOCKED`
- 提案与实施：Codex 持续交付负责人，依据 TASK48 两镜像首次新鲜 Trivy 诊断结果和 D-122 隔离构建授权
- 确认边界：只修改候选源码、依赖锁、最终运行层和本机构建回执；不授权外部推送、host supervisor 安装、UAT/生产 Migration/deploy、真实数据或正式晋升

### Context

- `c42d802`候选在新鲜 Trivy 数据库下被严格拒绝：Web 186项、Worker 200项，主要来自 Debian 最终层、随官方 Node 镜像进入运行层的 npm CLI 包，以及 Next 16.2.6 带入的旧 PostCSS/Sharp/Nanoid；继续使用同一完整开发镜像作为最终层无法满足零已知漏洞门。
- 官方 Node 22 bookworm-slim 当前诊断仍有大量 OS 发现，distroless Debian 12 Node 22 仍有40项；固定 Wolfi 基础镜像的 linux/amd64 manifest 诊断为零发现，公开签名 APK 仓库提供精确 `nodejs-22-minimal=22.23.2-r1`，且已隔离验证 Node 22 TypeScript stripping、crypto 和 fs 能力。
- Vinext 0.0.50 把 `image-size@2.0.2`复制进 Web standalone。该版本存在无修复版本的已知高危问题；实际 standalone 中只有 Vinext build plugin 和 metadata build-data 两个源码文件引用它，生产入口 `vinext/server/prod-server`的静态运行图不可达这两个文件，生成的运行 bundle也不引用该包。
- Next 16.3.0、React/React DOM/React Server DOM 19.2.8 已发布并保持现有 Vinext peer 范围；Next 16.3.0把相关运行依赖提升到 PostCSS 8.5.23和Sharp 0.35.3。升级固定版本比对旧运行包做扫描豁免更可审阅。

### Decision

1. 依赖安装、应用构建和发布工具继续使用既有固定官方 Node 22 digest；Web/Worker最终层改为固定 Wolfi `linux/amd64` manifest digest，仅从基础镜像内已信任密钥的`https://apk.cgr.dev/chainguard`安装精确`nodejs-22-minimal=22.23.2-r1`，并在层内核对`v22.23.2`。最终进程统一使用数值身份`65532:65532`。
2. Worker production `node_modules`在固定 build stage中由同一 lockfile离线`npm prune --omit=dev`产生，再复制到最终层；最终 Worker 不携带 npm、完整 package-lock或源码 package metadata，只携带共享验证后生成的最小 runtime package。Web继续只复制 Vinext standalone。
3. 固定升级 Next至16.3.0、React/React DOM/React Server DOM至19.2.8、eslint-config-next至16.3.0并提交机械生成的 lockfile；不在本任务升级 Vinext到beta主版本。
4. postbuild删除`image-size`前必须同时证明 lock entry仍为`2.0.2/dev-only`、目标包身份精确、目标及父目录均为非符号链接真实目录、全 standalone引用集合恰为两个已知 Vinext构建文件，且二者不在生产入口静态运行图中。任一事实漂移立即失败，删除后再次确认目录不存在；不得只改包版本标签、保留易受攻击代码或添加扫描ignore。
5. `candidate-build-provenance`升为v3，分别绑定固定 build base与runtime base manifest/local identity、精确 APK仓库/包/Node版本，并披露`PUBLIC_WOLFI_APK_FETCH_WITH_SIGNED_EXACT_PACKAGE`。公共 APK和npm下载仍使构建不具备完整离线或可复现证明。
6. 候选必须重新从干净新提交构建，并重新执行运行身份、Node版本、Migration只读属性、Web live/核心浏览器流程、Worker入口及新鲜完整severity扫描；只有两镜像零发现才可能继续正式证据门。
7. Trivy原生报告必须恰好同时覆盖`os-pkgs/wolfi`与`lang-pkgs/node-pkg`且两组均有包清单，Metadata OS必须为`wolfi 20230201`；CycloneDX必须有唯一同身份操作系统组件，并至少包含一个`pkg:apk/wolfi/`和一个`pkg:npm/`。Debian、未知生态、缺少任一清单或重复OS组件一律失败关闭。

### Consequences

- 最终镜像不再继承 Debian/npm CLI 的运行攻击面，仍保持 D-120 的 Node 22/ES2022合同；构建和测试镜像不等于生产运行层，必须在回执中分开识别。
- Wolfi APK是在线、签名且精确版本的输入，但包仓库可滚动，现阶段仍缺离线包镜像和外部可恢复候选锚点；回执必须保留无可复现attestation及无外部registry锚点限制。
- `image-size`裁剪依赖 Vinext 0.0.50当前输出结构，未来 Vinext升级或引用图变化会主动阻断build并要求重新审阅，而不会静默删除潜在运行依赖。
- 精确`cc9ebbf`前序候选已用新鲜Trivy数据库完成无Docker socket、无网络的归档诊断：Web覆盖25个Wolfi包和63个npm包，Worker覆盖25个Wolfi包和60个npm包，两镜像全部severity均为零发现；非root、Node版本、无npm、Web live与Worker失败关闭也已通过。该候选早于本条严格覆盖合同提交，只能作为诊断证据，不能冒充当前正式候选。
- 修正后的6文件发布合同共48项、release typecheck及lint（0 error，11项既有warning）通过，并直接接受真实诊断报告。最终`8952a81`候选已从干净精确tree重建：Web/Worker registry manifest分别为`sha256:278688…92288`/`sha256:e85ce2…ee77c`，config分别为`sha256:161ea6…f6c53`/`sha256:f8dc4a…817c1`；Web 25+63、Worker 25+60包在新鲜数据库下全部severity零发现，扫描前后数据库树摘要一致。
- 本决定已在隔离诊断层证明当前精确候选零发现，但尚无installed supervisor生成的正式provenance/SBOM/security evidence或完整18步PASS，也未改变UAT alpha.42/0040；系统继续`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝对现有漏洞使用 ignore、waiver、severity过滤、只扫HIGH/CRITICAL或把无修复版本写成接受风险来绕过D-122零发现合同。
- 拒绝在最终镜像保留完整npm、编译工具、package-lock和无运行需要的构建依赖，也拒绝仅删除`image-size/package.json`来欺骗SBOM识别。
- 拒绝切换到浮动Wolfi/Chainguard tag、Node 26或未经固定版本/摘要的包；也拒绝把在线APK安装描述为完全离线或可复现构建。
- 拒绝未经运行图证明直接删除整个 Vinext依赖，或在本次安全修复中同时升级到 Vinext beta 并扩大兼容范围。

## D-126 运行监控采用最小去敏快照、单调原子状态和失败关闭告警交付

- 日期：2026-08-13
- 状态：`ACCEPTED / REPOSITORY CONTRACT IMPLEMENTED / HOST INSTALL AND REAL DELIVERY NOT AUTHORIZED`
- 提案与实施：Codex 持续交付负责人，依据 TASK49 三条只读投产差距审计及现行资源、发布、运行健康与恢复治理合同
- 确认边界：只授权仓库工具、合成/隔离测试和宿主 Docker/`/proc` 去敏 metadata 只读诊断；不授权安装宿主服务、读取日志/环境/卷/数据库/业务数据、访问 UAT API、配置真实通知或执行部署

### Context

- 仓库已经分别具备低资源停止线、Docker health、应用 liveness/readiness、Worker 租约、发布身份、Migration allowlist 和备份恢复回执，但此前没有统一快照、持续窗口、告警生命周期、交付状态和可恢复状态文件。单次绿色检查不能证明监控持续工作，也不能证明事件已通知值班人。
- 低资源阈值同时出现在仓库治理、发布门和运维文档中。若监控复制一份可独立漂移的数值，边界条件可能在构建门与运行告警间产生相反结论。
- Docker metadata、应用响应、发布 manifest 和备份回执包含不同敏感面。采集运行所需的 Docker socket/root 能力不得下放给 Web 或普通通知进程；原始环境、挂载、网络、日志、SQL、异常、备份位置和机器身份不应进入监控事件。
- UAT 当前 Worker/Caddy 没有 Docker health，且镜像仍是 alpha.42 tag；alpha.46 合同要求 PostgreSQL/Web/Worker healthy，Caddy 可无 health。缺失键在不同 Docker 版本的 Go template 中会报错，不能将报错或 `none` 静默映射为健康。

### Decision

1. `operations/monitoring-policy-v1.json`是监控时间窗、服务健康和恢复证据要求的版本化合同；宿主资源数值不在其中复制，而是按精确 SHA-256 绑定唯一`release/release-gate-plan-v1.json.resource_policy`。摘要、字段或边界漂移均拒绝评估。
2. 监控输入使用严格、未知字段拒绝、确定性排序的去敏 observation。宿主仅采集`/proc`资源、boot identity摘要和根分区可用字节；Docker仅采集固定Compose project/service、容器/镜像身份、running/health/restart/OOM。禁止读取或输出容器环境、日志、挂载、网络、数据库、业务行、秘密、完整URL、备份位置、机器ID正文或原始异常。
3. Docker health使用`{{with (index .State "Health")}}...{{else}}none{{end}}`安全处理不存在的key。Caddy允许`none`；PostgreSQL、Web和alpha.46 Worker必须`healthy`。未知服务、缺失服务、tag与受控digest不符或无法采集一律失败关闭。
4. 应用readiness只证明其公开的version、revision和Migration head；完整Migration manifest摘要必须由受控release evidence独立提供并与配置交叉核对，不从HTTP响应猜测。备份只投影verification、identity、policy、assurance、recovery-ready及必要时间/RPO枚举，不暴露原始回执正文。
5. 每60秒采样，最大间隔90秒；Swap增长必须形成真实60秒窗口，Load必须连续3分钟高于4。间隔、重启或boot变化重建窗口并产生显式warning，绝不以缺样本推断健康。快照最长120秒、允许300秒时钟偏差，release identity最长3600秒。
6. 告警状态机固定为首次`FIRING`、有界去重、3600秒`REMINDER`、严重性`ESCALATED`和证据恢复后的`RECOVERED`。损坏、倒退、过期、UNKNOWN或缺失证据不能关闭既有告警；事件使用稳定code、中文摘要、去重键、观测时间和固定runbook引用。
7. 状态根必须同一运行身份所有、`0700`并带`0400`marker，`current.json`为`0600`；单调sequence、previous hash与integrity hash形成链。非阻塞目录锁、`O_EXCL`临时文件、file/directory fsync和原子rename把样本、活动告警和pending事件作为一个事务写入。锁、临时项、权限、链接或hash异常均失败关闭，禁止自动猜测清理。
8. TEST可显式采用`EVENT_FILE_ONLY`；UAT/PRODUCTION配置必须要求固定通知target。未配置或尚未投递的事件以`NOT_CONFIGURED/PENDING`保留并返回非零，不得写成delivered。未来通知器只能以最小权限、至少一次语义读取有界pending队列并做幂等确认；真实渠道、root-only凭据、值班人、升级表和投递演练属于专项授权。
9. 未来host部署采用root采集、非特权评估/通知和root-only配置分离；不得把Docker group/socket授予应用用户。systemd/调度安装、状态目录创建、通知渠道和回滚必须有精确版本、责任人及项目负责人授权，仓库验证不得冒充已安装生产监控。

### Consequences

- TASK49能够在不触碰UAT API、数据库、卷或秘密的情况下形成真实宿主metadata快照，并对旧UAT正确产生关键告警；这只证明合同和失败关闭行为，不证明生产告警已经送达。
- 首次样本必然产生Swap/Load窗口未完成；已有非零OOM/restart也必须人工核验并建立新的可信基线，不能为了绿色状态重置计数或删状态。
- 监控状态损坏、遗留锁或超限pending队列会让任务非零退出并停止覆盖旧状态。处置必须保全证据、确认无并发任务和精确身份后另行恢复，不能在定时任务里自动删除。
- 生产就绪仍依赖host安装、真实通知和值班演练、异机备份与隔离恢复、同候选UAT、真实迁移、跨岗验收和受控试用；本决定不改变`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝让Prometheus/脚本各自硬编码另一套资源阈值、只检查瞬时值，或把缺失数据视为零/健康。
- 拒绝让Web进程读取Docker socket、root状态或通知凭据，也拒绝把`docker inspect`完整对象、API/回执原文或异常正文写入事件。
- 拒绝仅靠HTTP readiness推导完整release/Migration身份，或把Caddy与alpha.46 Worker的health要求混为同一规则。
- 拒绝把写到stdout或本机文件等同于外部通知成功，拒绝无界重试/无界队列，也拒绝状态损坏后自动清空并恢复绿色。

## D-127 容器运行合同采用完整服务集合、精确写路径和内核态最小权限复核

- 日期：2026-08-13
- 状态：`ACCEPTED / REPOSITORY AND ISOLATED RUNTIME VERIFIED / UAT NOT DEPLOYED / PRODUCTION NO-GO`
- 提案与实施：Codex 持续交付负责人，依据 TASK50 三路只读审计、Docker 29.5.2 / Compose 5.1.4 实际解析结果及六服务隔离运行证据
- 确认边界：只授权仓库 Compose、策略、发布门和任务私有隔离容器；不授权修改现行 UAT、受保护卷、账号、网络、宿主服务、真实数据或正式部署

### Context

- 现行 UAT PostgreSQL、Web、Worker、Caddy 的实际 metadata 均为可写 rootfs，且没有显式 capability drop 或 `no-new-privileges`；仓库原 Compose 也只对 Migrate 形成了部分最小权限约束。页面与应用权限并不能限制容器逃逸后的宿主攻击面。
- Web/Worker 必须写 uploads/attachments，Web 还要只读 backup/release identity；PostgreSQL 入口需要数据目录与 Unix socket，Caddy 需要证书/配置持久化并绑定 80/443。把所有服务机械改为同一用户或零写路径会造成不可用或把写权限重新扩散到 rootfs。
- Compose 的 profile、锚点、环境替换、长短挂载语法和规范化默认值会隐藏实际服务字段。只对 YAML 文本做正则检查无法证明 Admin/Caddy 等 profile 服务、最终端口、顶层卷/网络或恶意 host namespace 没有漂移。
- 现有发布门只执行 `compose config --quiet`，能发现语法错误但不能证明最小权限字段完整，更不能证明固定镜像在当前内核/Engine 下能以这些约束启动和持久化。

### Decision

1. `operations/container-runtime-policy-v1.json`作为唯一版本化运行合同，按精确 SHA-256 绑定 Dockerfile、基础 Compose、release overlay 和 Caddyfile，并固定 linux/amd64、Docker Engine 29.5.2、Compose 5.1.4。解析器或任一源文件变化必须显式刷新策略与 supervisor，不能静默兼容。
2. 发布解析必须带 `--profile '*'`并得到恰好 Admin、Caddy、Migrate、PostgreSQL、Web、Worker 六服务；顶层服务、卷、网络和扩展字段以及每个服务的最终字段集合全部精确匹配。未知字段、额外服务、privileged、host PID/IPC/network、device、Docker/Podman socket、host root bind、外部卷/驱动选项和不受控 security option 一律失败关闭。
3. 六服务统一使用只读 rootfs、`cap_drop: [ALL]`和`no-new-privileges:true`。Admin、Web、Worker 固定`65532:65532`；Migrate 固定`65532:0`只读 root-owned release candidate；Web 仅通过受控 supplementary GID读取 release identity。不得保留通用 root shell 或额外 capability。
4. PostgreSQL 固定官方内容摘要、`999:999`、零 capability、64 MiB shm，并只允许数据库卷、32 MiB `/tmp`和16 MiB socket tmpfs写入。隔离首次初始化、SQL写入和同卷热重启均必须成功，rootfs写入必须失败。
5. Caddy 固定官方内容摘要，保留经实测所需的`0:0 + NET_BIND_SERVICE`唯一例外；其 rootfs仍只读，只允许`/data`和`/config`卷以及只读 Caddyfile。进程有效 capability 必须恰为 bit 10、`NoNewPrivs=1`，并实际监听 TCP 80/443和UDP 443且热重启成功。未来若改用高端口或具备等价非 root 入口，应另立策略版本移除此例外。
6. Web/Worker 只允许 uploads/attachments业务卷写入；Web 的 backup status和release identity必须只读。所有应用/工具服务只获得有界`rw,nosuid,nodev,noexec` `/tmp`；Worker实例文件留在该 tmpfs。后端网络设为 internal，只有Web同时连接backend/edge，Caddy只连接edge；宿主绑定IP和容器目标端口不允许环境变量改写。
7. `container-runtime-policy.py`只从stdin内存读取已解析Compose JSON，不落盘、不回显环境值，只输出成功摘要或稳定错误码；策略/JSON重复键、大小、类型、源摘要、镜像/config摘要、用户/GID、能力、tmpfs、挂载、端口、依赖、资源、restart、日志、health和环境键均严格验证。
8. 正式 release gate新增必需的`CONTAINER_RUNTIME_TEST/RUNTIME_POLICY`重步骤。隔离探针使用任务标签与随机精确名称，每次最多一个临时容器，不发布宿主端口、不连接现行 UAT或受保护卷；它核对镜像声明卷、Docker inspect、`/proc/<pid>/status`、写入/拒写、tmpfs不可执行、PostgreSQL数据热重启和Caddy监听/热重启，并在成功、失败或信号路径核对容器、网络、卷和目录清零。
9. 本决定不自动迁移现有卷所有权或重建 UAT。未来部署前必须在专项授权下只读核对 PostgreSQL/Caddy及uploads/attachments/release路径的实际owner/mode，先形成可恢复快照和精确变更/回滚方案；不得让Compose启动时递归chown生产卷。现行 UAT保持旧运行事实并继续失败关闭。

### Consequences

- 仓库候选现在具有机器可执行的最小权限合同和内核态兼容证据；`compose config`语法成功不再足以通过发布门。策略包含三个有界例外（Caddy低端口、Migrate root group读取、Web release supplementary GID），其余服务无 capability。
- Docker/Compose升级、基础镜像digest、Caddy端口、挂载、网络、用户或资源策略变化会主动阻断发布，需要重新审计、更新内容寻址策略并重复六服务隔离演练。这是预期的可追溯升级成本。
- TASK50没有重建当前 alpha.46镜像，没有安装更新后的 supervisor，也没有修改 UAT alpha.42/0040。现有受保护卷owner/mode、正式同候选gate、UAT部署和长时稳定性仍是后续授权门，系统继续`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝只运行`compose config --quiet`、只用正则扫描YAML、遗漏profile服务，或把静态字段存在当作内核实际生效。
- 拒绝保留镜像默认root/默认capability、使用`privileged`、host namespace、Docker socket、任意host bind或为了排障扩大写路径。
- 拒绝为了形式上的全非root让Caddy使用未经验证的入口/端口，也拒绝给它保留默认capability集合；当前只接受实测的单一`NET_BIND_SERVICE`例外。
- 拒绝在隔离测试中挂载现行四个持久卷、读取业务数据/日志/环境，或在未来部署时用启动脚本自动递归chown生产数据。
- 拒绝把本次隔离成功写成UAT已加固、正式发布门已PASS或系统可供员工使用。

## D-128 Docker 29运行探针必须分别闭合manifest引用与OCI config身份

- 日期：2026-08-13
- 状态：`ACCEPTED / RUNTIME IDENTITY FIX IMPLEMENTED / CURRENT CANDIDATE REVALIDATED / UAT NOT DEPLOYED`
- 提案与实施：Codex 持续交付负责人，依据 TASK51 当前候选的真实 Docker 29.5.2/containerd image store inspect结果及D-124既有身份分离原则
- 确认边界：只修正仓库运行探针、自动化测试和运维说明，并在任务私有隔离容器中重验；不授权安装host supervisor、修改UAT、访问持久卷正文、执行Migration或部署

### Context

- TASK51从精确源码构建Web/Worker候选后，静态Compose合同通过，但实际运行探针以`IMAGE_CONFIG_DIGEST_MISMATCH`失败。只读inspect证明Docker Engine 29.5.2的containerd image store对按digest拉取的镜像将`.Id`和`.Descriptor.digest`报告为registry manifest digest；真实OCI config digest位于`.Descriptor.annotations["config.digest"]`。
- TASK50探针仍把`.Id`与候选config digest比较。TASK50调用时又错误地把manifest digest作为config参数，因此旧候选隔离演练掩盖了探针语义错误；该次证据不能证明manifest/config双身份闭合，必须由修正后的当前候选重验取代。
- D-124已经规定可部署引用的manifest digest与归档/扫描身份的config digest不得混用。运行探针若继续依赖旧Docker graphdriver时代的`.Id == config`假设，会让正确候选失败，也可能让错误参数伪装成成功。

### Decision

1. 运行探针从精确`name@sha256:<64hex>`引用取得期望manifest digest，并要求Docker inspect的`.Id`、`.Descriptor.digest`和`.RepoDigests`中的精确引用同时闭合；任一不符返回稳定错误`IMAGE_MANIFEST_DIGEST_MISMATCH`。
2. 候选构建回执中的Web/Worker config digest必须作为独立参数传给运行探针，并只与`.Descriptor.annotations["config.digest"]`比较；缺失、类型错误或不符返回`IMAGE_CONFIG_DIGEST_MISMATCH`。不得把manifest值填入config参数，也不得从`.Id`猜测config。
3. 自动化测试必须分别覆盖正确双身份、错误config和错误manifest，防止两个摘要再次被合并。最终候选还必须由修正后clean HEAD重新构建，并以真实构建回执中的两个config digest完成六服务隔离演练。
4. TASK51首次从`79f8dee0cadc`构建的候选只保留为发现此缺陷的中间诊断，不得成为正式release evidence或晋升依据；修正后的候选、扫描诊断和失败关闭gate入口必须重新建立同一源码链。
5. 本修正不降低零漏洞、最小权限、内容寻址或supervisor授权要求。host supervisor未安装时，正式scan/gate仍必须在任何制品写入前失败关闭。

### Consequences

- 镜像可拉取manifest、Docker运行对象和OCI config分别获得可审计身份，Docker 29行为不再被错误映射到旧`.Id`语义；未来Engine/store变化会因稳定字段不闭合而显式失败。
- TASK50的静态Compose、最小权限字段与六服务行为结果仍可作为问题定位参考，但其镜像双身份断言被撤销；TASK51修正后重验成功前，容器运行候选状态保持失败关闭。
- 该决定只关闭仓库探针缺陷，不代表当前UAT已加固、正式release gate已通过或系统可投入使用，整体继续`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝把TASK51候选的config参数改成manifest digest以继续取得绿色结果，或删除config核验只保留`.Id`。
- 拒绝仅检查tag/本地短ID、接受任意`RepoDigests`成员，或在manifest/config不一致时继续启动六服务。
- 拒绝修改既有构建回执来迎合探针；身份来源必须保持构建时不可变，错误应在消费端修正并重新构建、重验。

## D-129 投产外部动作采用逐项授权并先闭合首次晋升依赖环

- 日期：2026-08-13
- 状态：`ACCEPTED / AUTHORIZATION CONTROL PLANE DOCUMENTED / REPOSITORY PREREQUISITES OPEN / NO EXTERNAL ACTION AUTHORIZED`
- 提案与实施：Codex 持续交付负责人，依据 TASK52 数据迁移、应用测试、运维安全三线只读审计及主智能体对supervisor、release gate、manifest、备份恢复、监控和权限源码的复核
- 确认边界：只记录授权依赖、影响、停止、验收和回滚控制面并修正当前文档漂移；不创建可消费授权/nonce，不安装host组件、不push、不连接或修改UAT/生产/真实数据/账号/网络

### Context

- TASK51形成了本机候选和零发现诊断，但installed supervisor不存在。若只笼统请求“安装并跑门”，项目负责人无法分辨host文件变化、正式证据、外部push、UAT部署和真实数据动作的不同影响。
- installer在读取授权前要求install authorization根与`pending`已由root建立为`0700`；安装本身又会创建content-addressed bundle/launcher、receipt/journal和release authorization根。首次安装没有previous launcher，物理卸载不能被冒充为自动回滚。
- 正式gate runner当前在19步前要求现行Worker `healthy`，而alpha.42 UAT实际health为`none`；因此A1成功后直接A2也会以`GATE_REQUIRED_RUNTIME_UNHEALTHY`阻断。候选隔离runtime已经能够强制新Worker health，legacy运行面保护和候选要求不应形成首次晋升自锁。
- 正式image evidence及manifest绑定完整registry digest reference。TASK51删除后的loopback registry引用只在当前engine可解析；先以该引用签发manifest、后推相同digest到私有registry不能改变既有证据绑定，必须重新签发。
- V2备份在部署前提供回滚恢复点，但部署后runtime/Migration身份变化会使旧回执不再证明当前运行面可恢复；监控同样需要先具备真实投递能力，再在部署和新恢复回执后取得绿色窗口。
- 数据物化仍绑定0017基线而候选为0045；11角色权限存在服务端事实但没有业务负责人批准。把数据、权限、跨岗写和员工试用合在一次授权会扩大权限并掩盖未决项。

### Decision

1. 采用[投产专项授权执行包](../self-hosting/production-authorization-packet.md)为唯一当前授权控制面。任何文档中的“需要授权”必须映射到`A1`—`A8`及其子检查点；计划、代码存在或上游PASS不得自动批准下游。
2. A1只安装固定source/manifest/bundle/installer/launcher。root可在安装前bootstrap install authorization根和`pending`两个`0700`目录并放置短时`0400`canonical授权；其余bundle、launcher、receipt、journal及consumed根必须由固定installer管理。回退首先停止签发后续授权，物理清理或切换另行批准。
3. 首次正式发布链固定为：先修release gate legacy runtime自锁；A1安装supervisor；A3把同一候选源码/镜像锚定到批准的私有Git/registry；A2只用外部完整digest引用生成正式evidence、19步gate和UAT-class manifest。loopback引用不得形成可部署manifest。
4. A4拆成三故障域设计、本机四域备份、加密异机传输、第三域恢复及部署后同身份/常态重验。真实数据读取、外传和第三位置写入分别批准；cluster roles/ACL/tablespace另有合同前不得宣称完整集群可恢复。
5. A5拆成旧UAT上的安装/真实投递能力和A6/A4e后的当前身份绿色窗口。旧运行面CRITICAL可以证明告警诚实送达；不能为了先变绿而隐藏Worker、release或backup缺口。
6. A6只在正式候选、升级前真实恢复回执和告警交付能力存在时执行技术晋升；部署后必须再做A4e/A5b。跨岗业务写不包含在技术部署授权内。
7. A7拆为当前源只读盘点、业务处置、隔离试迁移、岗位矩阵批准、跨岗UAT写和员工试运行。0017→当前head合成升级合同及岗位批准分别是试迁移/真实账号的前置；不得用一次“同意A7”扩权。
8. 在仍有安全仓库任务时继续自动推进，不提前索取注定失败或会绑定错误身份的外部授权。每次实现改变`chenyida_erp_site`候选输入后，旧候选、扫描和manifest状态必须诚实标为stale并重建。

### Consequences

- 当前不向项目负责人请求A1/A2；先立独立仓库任务修复首次晋升gate自锁并生成新bundle。新bundle重新核验后，A1仍可作为独立host安装授权，且不会自动运行四个supervisor动作。
- A3必须提供私有目标和root-only短时凭据；其成功只证明恢复锚点，不代表候选已通过正式门。A4a的非秘密三故障域/RPO/RTO/责任决策也可提前准备。
- 真实备份要至少执行升级前和部署后两个身份阶段；监控也至少有投递能力和当前身份绿色两个阶段。这增加操作次数，但避免旧证据冒充当前可恢复/可观测。
- 系统在A2、A4、A5、A6、A7和A8证据完成前继续`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝把持续交付总授权解释为host安装、真实数据、UAT部署、账号或切换授权，也拒绝一次“全部同意”跨越多个故障域。
- 拒绝在现行Worker health不满足时消耗A2授权只为生成预知BLOCKED报告，或简单删除运行面保护而不增加legacy稳定与候选health负向合同。
- 拒绝先用loopback引用生成`ELIGIBLE`再把digest推到外部registry，或手改既有evidence/manifest引用。
- 拒绝复用升级前备份回执作为部署后current identity恢复证据，或把pending/stdout当作真实告警已送达。
- 拒绝将数据盘点、冲突处置、试迁移、权限批准、账号创建和员工业务写合并授权。

## D-130 发布证据按部署前、隔离候选和部署后三阶段闭合

- 日期：2026-08-13
- 状态：`ACCEPTED / SOURCE IMPLEMENTED / ISOLATED CONTRACTS VERIFIED / CONTENT-ADDRESSED BUNDLE REFRESHED / NO HOST OR UAT ACTION`
- 提案与实施：Codex 持续交付负责人，依据 TASK53 三线只读审计、D-129 首次晋升依赖环和现行 alpha.42 UAT 运行元数据
- 确认边界：只修改仓库发布合同、受限 supervisor 动作、自动化测试和治理资料；不授权安装 host supervisor、生成可消费授权、推送镜像、执行 UAT/生产 Migration 或部署、读取真实数据或发布 runtime identity

### Context

- 现行非生产 UAT 的 PostgreSQL/Web 为 `healthy`，Worker/Caddy 没有 Docker health；旧发布门却在候选测试前无条件要求 Worker `healthy`，使首次晋升在验证候选之前确定性自锁。
- 候选隔离运行合同已经要求 PostgreSQL/Web/Worker `healthy`。为兼容旧运行面而放宽同一合同会把历史缺口传播到新候选和部署后运行面，无法证明实际切换结果。
- 既有 release manifest PASS 只证明候选获准部署，旧 runtime identity v2 又直接从 manifest 与一次容器 inspect 生成；两者都不能独立证明部署后的四服务集合、运行策略、完整 Migration 身份和 readiness 与获准候选一致。
- 发布后回执和 runtime identity 需要两个原子发布边界。进程可能在回执发布后、身份提交前中断；若该状态既不幂等恢复又不显式拒绝冲突，操作员只能手工删除受信证据或永久更换运行 ID。

### Decision

1. 发布生命周期固定为 `chenyida-erp-release-lifecycle/v1` 的三个互不替代模式：`PRE_DEPLOY_EXISTING_RUNTIME_STABILITY`、`ISOLATED_CANDIDATE_STRICT`、`POST_DEPLOY_CURRENT_RUNTIME_STRICT`。authorization、版本化计划、gate report、release manifest、supervisor action、部署后回执和 runtime identity 必须显式绑定适用模式；缺失、未知或跨阶段复用失败关闭。
2. 部署前门只接受版本化计划列出的现行四服务，并在整个门禁期间逐项冻结服务集合、容器 ID、镜像 ID/引用、running/restarting/paused/dead、restart、OOM、healthcheck 是否存在及当前健康语义。PostgreSQL/Web 必须持续 `healthy`；Caddy 必须保持版本化的无 healthcheck 状态；旧 Worker 只允许保持“无 healthcheck + health none”，任何状态或身份转换均阻断。
3. 隔离候选继续由内容寻址运行策略验证完整候选，不继承 legacy 例外；PostgreSQL/Web/Worker 必须存在 healthcheck 且为 `healthy`，Caddy 按固定策略验证。正式 REQUIRED 测试、类型检查、lint、Migration、备份恢复和安全证据步骤不得减少或改为可选。
4. release gate plan/report、release manifest 和 supervisor authorization 分别升级为 v2；manifest 必须同时保存完整三阶段 lifecycle，且 eligibility 仍只来自部署前 gate PASS、两镜像原生 SBOM/零发现安全证据及完整受信 companion 重组。部署前 PASS 不生成或暗示部署后身份。
5. 部署后只允许受限动作 `VERIFY_AND_PUBLISH_POST_DEPLOY_IDENTITY`。它必须在同一全局发布锁内读取 eligible manifest、固定 runtime policy、精确 Compose project 及 Caddy/PostgreSQL/Web/Worker 四个不同容器；禁止记录容器环境、日志、挂载、网络或数据库正文。
6. 部署后回执必须独立闭合：四服务唯一集合、running、restart 0、OOM false、Caddy 版本化无 healthcheck、其余三服务 `healthy`；固定基础镜像引用和候选 Web/Worker 外部完整 registry digest；OCI version/revision；应用 deployment class/id、版本、提交前 12 位、Migration head、完整 allowlist 摘要和全部 readiness components。local-only/loopback Web 或 Worker 引用、第五个残留 Compose 容器、时钟差超过 5 分钟或两次复核漂移均失败。
7. runtime identity 升为 `chenyida-erp-runtime-release-identity/v3`，只能由规范化部署后 PASS 回执及其真实 SHA-256 派生，并新增 git tree、完整 Migration 身份、runtime policy、Caddy/PostgreSQL 容器与镜像身份。旧 direct CLI 和 manifest-to-identity publisher 保留为稳定失败入口，不兼容生成 v3。
8. 回执与身份使用受信 root、严格 mode/owner、无覆盖硬链接和 fsync 的两阶段发布。重试必须验证并恢复 `PREPARED`、同 inode 发布中断或已 `PUBLISHED` 状态；同一回执可在重新严格复核当前运行面后继续身份提交或幂等返回，两个不同 payload 同时存在、摘要伪造、授权变化或运行漂移一律拒绝。已发布回执不因后续身份失败而删除。
9. canonical supervisor bundle 必须在 TASK53 源码提交之后，由只修改 bundle manifest 的直接子提交重建。TASK51 候选、测试证据、bundle 和任何基于 v1/v2 旧生命周期的授权输入均标记 `STALE / NOT AUTHORIZABLE`；A1/A2 只能引用新内容寻址链。

### Consequences

- 首次正式 gate 可以在不美化旧 Worker 健康缺口的前提下证明现行 UAT 在长门禁期间没有退化；候选及部署后 Worker 健康要求仍保持严格。
- 运维人员能够区分“候选可部署”与“当前部署已严格验证”，并在发布后中断时通过同一授权和运行 ID 安全续跑，而不手工覆盖受信证据。
- release plan、test inventory、test runtime policy、runtime policy、authorization、manifest、receipt 和 identity 的版本/摘要构成更长的内容寻址链；任何源文件或测试变化都必须刷新下游摘要、bundle 和候选。
- 本决定没有安装 supervisor、生成正式 PASS、修改现行 UAT 或恢复其 Worker health。源码`08608eb19ba0d82d60b248e2a0759dfc70fa2125`与manifest-only直接子提交`d246cbde0bc559bb3555da65a82d49727b33a938`已形成47文件bundle；A1、A2、A3及所有真实数据/部署授权继续未授予，系统保持`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝把现行 Worker `none`全局解释为健康、删除 Worker health 要求或让操作员用环境变量临时切换模式。
- 拒绝把部署前 gate report 或 release manifest 直接写成当前 runtime identity，也拒绝只检查 Web/Worker 而遗漏 Caddy、PostgreSQL、完整 Compose inventory 和 Migration allowlist。
- 拒绝接受 local-only registry 引用作为部署后可恢复身份、从容器环境读取秘密来证明版本，或在回执/身份不一致时手工编辑、覆盖或删除不可变证据。
- 拒绝让一次宽泛授权同时执行 gate、manifest、部署和身份发布；三个阶段必须分别受版本化动作和专项授权控制。

## D-131 备份恢复保持内层 V2，并以签名密文来源和 V3 就绪回执闭合

- 日期：2026-08-13
- 状态：`ACCEPTED / REPOSITORY AND SYNTHETIC-ISOLATED VERIFIED / ACTUAL OFFHOST BLOCKED / PRODUCTION NO-GO`
- 提案与实施：Codex 持续交付负责人，依据 TASK54 三线只读审计、TASK41 四域恢复基线及合成密文双集群恢复证据
- 确认边界：只修改仓库合同、Dashboard、监控、测试和运行手册，并在任务私有合成目录/隔离 PostgreSQL 中验证；不授权真实密钥、异机目标、数据读取或外传、host 调度、删除、UAT/生产恢复或部署

### Context

- TASK41 的 V2 已稳定证明 PostgreSQL、uploads、attachments、backup-status 四域一致性捕获、数据库 fence、严格 manifest、不可变分层回执和不同集群恢复；重写内层会扩大已经通过故障测试的恢复面。
- V2 的“异机”步骤仍是明文人工复制后由调用者提供 `transfer_id`。攻击者若能替换制品、manifest 和回执，仍可制造内部一致但来源不可信的副本；同时没有客户端加密、接收 ACK、重放边界或失败恢复状态。
- 旧 Dashboard 可把完整 V2 恢复链解释为 ready，但它不能证明密文跨故障域、真实接收方、调度准时或保留策略安全。仓库也没有统一的 backup/export/import/restore 单飞合同、漏跑状态或可审阅保留计划。
- 本任务没有真实异机、密钥托管、timer、WORM 或删除授权。仓库机制必须能证明其自身边界，并阻止合成证据或旧人工复制回执被误写成真实灾备。

### Decision

1. 保持 `chenyida-erp-backup/v2` 与既有 V2 恢复核心稳定；外层另行版本化为 `chenyida-erp-offhost-transfer/v1`、receiver receipt、source acceptance 和 materialization receipt。任何外层变化不得降低内层文件集合、Migration、内容 reconciliation 或恢复故障断言。
2. 源端只接受仍新鲜且完整复验的 `LOCAL_VERIFIED`。四域以随机 content key 做 AES-256-GCM；接收方 X25519 公钥与临时 X25519 密钥经 HKDF-SHA256 包装 content key；源端和接收端分别用 Ed25519 对 canonical evidence 签名。私钥只允许来自 owner/mode/link/ancestor 均通过检查的专用文件，禁止进入 argv、环境、回执或日志。
3. 发送、接收和确认采用 `PREPARED → SEALED/VERIFIED/ACCEPTED` 的 durable intent、私有 staging、fsync、无覆盖原子晋升和 payload 冲突检测。相同 ID/相同 payload 可幂等续跑；截断、tag/AAD/signature/key/recipient 篡改、跨代混合、重放、错误 key 或相同 ID/不同 payload 一律失败关闭。
4. 恢复入口必须先验证 envelope、源签名、接收签名回执、源端 acceptance、策略与精确摘要链，再在专用私有根短暂物化内层 V2；恢复回执绑定 envelope/receiver/acceptance/offhost receipt。成功或失败后的明文 staging 必须按精确身份清理或显式隔离，旧 V2 人工复制链只能标为 `LEGACY_V2_INNER_ONLY`，不能产生当前就绪状态。
5. `chenyida-erp-backup-operations-policy/v1`固定 UTC anchor、cadence/RPO/grace、最大运行时间、最少成功/恢复代次、hold、受保护代次和 key allowlist。状态以 flock、CAS、单调历史和完整性链推进；锁忙、漏跑、未来时间或时钟倒退不算成功。retention 只生成 canonical `DRY_RUN_DELETION_FORBIDDEN` 计划，latest、inflight、hold、RPO 内及最低恢复代次永不列为可删对象；本版本没有删除执行器。
6. Dashboard 权威别名升级为 root 发布的 `recovery-readiness.json`，合同为 `chenyida-erp-backup-verification/v3`。只有 `ACTUAL_OFFHOST + RECOVERY_READY`、完整内层恢复/外层传输/操作策略交叉绑定、实际安装且观察到的调度、有效 dry-run 保留以及当前 runtime/database/Migration/trust 全匹配且新鲜时，才允许 `recovery_ready=true`。`SYNTHETIC_ISOLATED`只能发布合成证据且永远 false；V1/V2 均保持历史解析但失败关闭。
7. 浏览器只接收去敏的 evidence scope、transfer、encryption、schedule、retention、identity、policy、assurance 和 ready 枚举，不暴露路径、密钥指纹或内部摘要。监控分别发出 legacy、synthetic-only、transfer、encryption、schedule、retention 告警，并仅在各自证据恢复后写 `RECOVERED`。
8. 实际 `RECOVERY_READY` 发布必须由 root 使用精确确认词；真实密钥托管/轮换、异故障域/WORM、timer 安装、真实保留删除、当前数据快照/外传/第三域恢复、cluster roles/ACL/default privileges/tablespace 和真实 RPO/RTO 继续按 A4 分项授权。仓库 PASS 不得替代这些外部证据。

### Consequences

- TASK54 在不触碰当前数据或运行面的前提下，关闭了异机传输来源、静态机密性、双向 ACK、重试、调度评估、只读保留计划及 Dashboard/监控误报的仓库缺口；合成密文链已在不同 PostgreSQL 集群恢复成功。
- 旧 V2 回执仍可审计和执行内层兼容验证，但升级后不会再使 Dashboard 变绿。操作员必须看到外层链、调度、保留和证据范围的独立状态，不能把缺字段当作默认健康。
- 源码 `fd0a9cff751ad3e6619600066693403b7ace0655` 与只改 canonical manifest 的直接子提交 `315b1f3dac21a9d8cd634ba9d3dcdcbff4fe0806`形成 47 文件 bundle；TASK53 bundle及TASK51候选均为`STALE / NOT AUTHORIZABLE`。
- 真实 G2 仍为阻断项。系统在外部异机恢复、集群级对象恢复、正式候选/门、监控投递、真实迁移、岗位/员工验收和切换完成前继续 `PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝修改稳定内层 V2 来承载网络信任，也拒绝继续把 `cp -a`、调用者声明的 transfer ID 或单一 SHA 校验称为异机来源证明。
- 拒绝服务端传输明文后再由存储端加密、把长期明文 materialization 当作加密备份，或把私钥/口令放入环境、命令行和 JSON。
- 拒绝只由源端自签“接收成功”、只由接收端自称来源可信，或允许同一 transfer ID 覆盖不同 payload；双向独立证据和 no-clobber 是强制边界。
- 拒绝把 synthetic receipt、仓库 evaluator、逻辑 no-clobber 或 dry-run retention 写成真实异机、已安装 timer、WORM、执行过删除或达到 RPO/RTO。
- 拒绝为了兼容旧 Dashboard 继续让 V2 `RESTORE_VERIFIED`直接 ready，或在缺少任一 transfer/encryption/schedule/retention 维度时合并成笼统绿色状态。

## D-132 PostgreSQL 集群安全恢复采用独立加密 capsule、联合 transfer v2 与 readiness v4

- 日期：2026-08-13
- 状态：`ACCEPTED / DESIGN FIXED / REPOSITORY IMPLEMENTATION IN PROGRESS / SYNTHETIC-ISOLATED ONLY / PRODUCTION NO-GO`
- 提案与实施：Codex 持续交付负责人，依据 TASK55 数据迁移、应用测试、运维安全三线只读审计及 PostgreSQL 17 catalog/恢复行为复核
- 确认边界：只授权仓库合同、合成 fixture、最多一个临时 PostgreSQL 容器、Dashboard/监控和release inventory；不授权真实数据库/凭据、当前卷、异机传输、host路径、账号、UAT/生产、部署或切换

### Context

- TASK41 的V2数据核心是精确七文件集合，TASK54的outer v1也拒绝额外文件；向任一已发布集合直接加入cluster sidecar会破坏D-115/D-131兼容性。
- 当前backup仅`pg_dump --no-owner --no-acl`且无globals，restore同样排除owner/ACL；数据库、Schema、对象、large object、default privileges、角色、membership、GUC和custom tablespace都不能被完整重建。现有V3因此可能在缺少最小权限安全状态时显示ready。
- `pg_dumpall --globals-only`包含可执行SQL并需要高权限，且不能自然表达allowlist、秘密排除、策略不变量、grantor/options、对象级闭包或目标tablespace映射；它不作为本项目唯一权威。
- 当前restore在首次`CREATE DATABASE`前没有durable intent，trap清理不能覆盖SIGKILL。custom tablespace与数据库创建又不能置于transaction block；响应丢失后若只依赖进程内状态会使操作员只能猜测删除。
- 当前Compose仍共享初始化superuser式身份、通过环境传秘密，也没有PGDATA外custom tablespace持久mount。忠实复制这一现状不能证明最小权限，也不能由TASK55合成测试冒充实际运行面闭合。

### Decision

1. 保持`chenyida-erp-backup/v2`七文件和`chenyida-erp-offhost-transfer/v1`完全稳定。cluster snapshot位于独立私有根，经独立签名密文capsule异机传输；联合transfer v2只交叉绑定data envelope v1与cluster capsule链，不改写两者payload。
2. `chenyida-erp-backup-verification/v4`是唯一未来current-ready合同。V1—V3继续可解析，但V3固定显示`LEGACY_V3_NO_CLUSTER_SECURITY`且永不ready；synthetic V4也永不ready。V4必须绑定data restore、joint transfer、cluster、credential、tablespace和operations policy同一代次。
3. canonical cluster snapshot只读取非秘密catalog，禁止`pg_authid`和密码/verifier。它覆盖批准角色属性、membership及PG16+ options、四种role/database GUC scope、database属性、对象/列ACL、default privileges、large object、extension/publication owner、parameter ACL门禁及custom tablespace owner/CREATE privilege。
4. ACL以`aclexplode()`tuple和NULL/empty/effective语义表达；overloaded routine使用identity arguments。`PUBLIC`与`pg_database_owner`仅作为固定语义引用，其他系统角色端点拒绝。FDW/user mapping/subscription及未知用户对象类失败关闭，不把可能含秘密的catalog写入capsule。
5. 快照先通过独立最小权限policy，再验证源目标等价。runtime不得为owner或拥有DDL/SET ROLE；migration owner必须保持release gate不变量；PUBLIC不得拥有业务Schema CREATE或敏感CONNECT。源越权时capture失败，不能把越权状态忠实复制后称为安全。
6. source capture在同一全局运维锁和V2 fence内前后各执行一次；临时`datconnlimit=0`与`default_transaction_read_only=on`按durable intent原值精确剔除，两次canonical digest必须相等并绑定V2 recovery point、source system ID/OID/marker和Migration身份。
7. 恢复在任何mutation前fsync immutable intent。角色骨架与可事务化安全状态单事务应用且全为`NOLOGIN/PASSWORD NULL`；custom tablespace和database按非事务逐步dispatch/reconcile/verify；数据库保持connlimit0，archive由批准migration owner以`--no-owner --no-acl --single-transaction`恢复，再单事务应用owner/ACL/default privileges/membership/settings并独立重捕获比较。
8. custom tablespace保留源logical name，目标map必须exact 1:1到数据库服务器同一已证明namespace内的新空批准持久路径。逐组件no-follow、inode/owner/mode/capacity和禁止重叠强制执行；location内不放marker。Compose缺批准mount时custom tablespace实际恢复保持NO-GO。
9. actual/controlled credential binding与receipt发布强制UID0；秘密只从root-only、no-follow、单硬链接文件经FD/stdin/进程内存处理，不进argv、环境、输出、日志、hash或回执。公开证据只绑定非秘密generation与role-set指纹；全部角色保持NOLOGIN直到最终激活事务与正/负权限探针完成。
10. 每个非事务步骤固定`INTENT_DURABLE → COMMAND_DISPATCHED → RECONCILED_APPLIED → VERIFIED`。相同run/payload可resume，冲突拒绝；补偿只删除本任务精确身份且无依赖的对象，任何歧义只quarantine并保持NOLOGIN/connlimit0，禁止trap-only或递归猜删。
11. Dashboard只投影cluster/credential/tablespace状态枚举和必要时间。monitor通过可信adapter读取root发布的V4而非调用者自报，并分别产生三个CRITICAL条件。发布inventory、runtime policy与supervisor bundle必须随新增测试和源码摘要刷新。
12. TASK55只关闭仓库与合成隔离协议。实际高权限共享角色、环境变量秘密、superuser operator、custom tablespace mount、真实异机/密钥/恢复、WAL/PITR/HA/RPO/RTO继续作为独立P0，不因TASK55通过而解除。

### Consequences

- V2数据核心和既有outer v1仍可审计/恢复，但不再足以宣称当前灾备ready；cluster capsule若没有进入加密异机链也不能由摘要伪装成ready。
- 恢复实现会增加显式policy、catalog闭包、状态机、路径映射和凭据输入，复杂度高于`pg_dumpall`；换来的边界是秘密不进入制品、越权源失败关闭、非事务崩溃可判断且可精确补偿。
- PostgreSQL major、支持对象类、role职责或Compose tablespace namespace变化均需新合同版本和重新演练，不能静默兼容。
- 当前系统继续`PRODUCTION NO-GO`；真实A4、runtime role拆分与secret delivery修复前，不请求或生成实际cluster-ready证据。

### Rejected alternatives

- 拒绝向V2七文件或outer v1精确集合追加sidecar，也拒绝只把本机cluster文件摘要写入V4而不异机传输其正文。
- 拒绝以`pg_dumpall --globals-only`可执行SQL、`aclitem::text`或源目标摘要相等作为唯一安全权威。
- 拒绝保存密码/SCRAM verifier、credential文件SHA、连接串、角色清单或tablespace路径到公开回执/浏览器。
- 拒绝遇到custom tablespace自动创建host目录/chown、在location放marker、跨namespace猜测路径或递归删除失败目标。
- 拒绝在SIGKILL后依赖trap清理、手工DROP提示或把不确定对象当作本任务创建；恢复必须resume/inspect/compensate且歧义隔离。
- 拒绝为了让当前Compose通过而接受superuser runtime、环境秘密或PUBLIC越权，也拒绝把合成角色fixture写成真实最小权限已完成。

## D-133 PostgreSQL 运行权限采用独立登录、NOLOGIN 权限组、文件秘密与离线控制面

- 日期：2026-08-13
- 状态：`ACCEPTED / DESIGN FIXED / REPOSITORY IMPLEMENTATION IN PROGRESS / NO RUNTIME CHANGE / PRODUCTION NO-GO`
- 提案与实施：Codex 持续交付负责人，依据 TASK56 数据迁移、应用测试、运维安全三线只读审计和现有 PostgreSQL 17、Compose、Migration、backup/restore、release/runtime 合同复核
- 确认边界：只授权仓库内版本化策略、运行时消费者、Compose/release 合同、合成秘密和隔离 PostgreSQL 测试；不授权当前 UAT/生产角色、密码、ACL、数据库、Volume、host 目录、备份恢复、Migration、部署或切换

### Context

- 当前 Web、Worker 和 Admin 继承同一个环境 `DATABASE_URL` 与 Setup Token，Migration 只替换另一条环境 DSN；PostgreSQL 初始化口令和管理员临时口令也在环境中。连接池没有核对 `session_user/current_user`、数据库 owner、危险能力、membership 或对象权限。
- 当前 UAT 只有一个非内置 LOGIN，且同时是 superuser、数据库 owner、全部 433 个 public relation owner 和 Web/Worker 活动连接身份；源码 45 个 Migration，UAT 仍为 40 个。本任务不得借权限修复升级 UAT。
- D-132 v1 只有 owner、单 runtime login 与单 RW group，且非 owner 可获全表 DML、序列 UPDATE/USAGE、routine EXECUTE 和 large object UPDATE；它是 TASK55 合成恢复证据，不能表达 Web/Worker/Admin/Backup 的实际边界。
- Web 覆盖全部业务域并参与导入 enqueue；Worker 处理 parse、normalize、review-finalize、上传恢复和 DRAFT 物料创建。两者必然共享部分队列、导入、物料和审计对象，表级 ACL 不能进一步约束“只改某状态、某列或自己领取的行”。
- 当前 backup 由同一 superuser service file 完成 `ALTER DATABASE`、终止连接、reconciliation、Migration 历史读取和 `pg_dump`。把该用户名直接替换成普通读取角色会在 `CONNECTION LIMIT 0` 后阻断 capture 自身，并不构成职责分离。

### Decision

1. 保留“数据库/对象 owner 与 Migration 登录合一”的现有 release 不变量，不静默改成 `SET ROLE owner`。`chenyida_erp_owner`是只供一次性 Migration 使用的 LOGIN、数据库及应用对象 owner，连接上限 1，固定 `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`，无 membership；角色骨架只能由离线 bootstrap 控制面创建。
2. 稳态应用角色图使用五个互不复用凭据的 LOGIN：owner/Migration、`chenyida_erp_web`、`chenyida_erp_worker`、`chenyida_erp_admin`和`chenyida_erp_backup`；Web、Worker、Admin、Backup 各自只继承一个同名职责的 NOLOGIN privilege group。membership exact 为`ADMIN FALSE / INHERIT TRUE / SET FALSE`，禁止通往 owner、运维或内置危险角色的直接、间接 membership。
3. Web pool/role 上限分别为 10/12，Worker 为 4/6，Migration、Admin 和 Backup pool 均为 1、role 上限分别为 1/1/2。全部 LOGIN 都是 `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`；Admin 是 root 调度的一次性工具身份，Backup 由 root-only service file 消费，二者不挂入常驻 Web/Worker 容器。
4. 从 PUBLIC 撤销业务数据库 `CONNECT,TEMPORARY` 以及 public Schema `CREATE,USAGE`。各 privilege group 只获数据库 CONNECT、Schema USAGE 和版本化对象/操作清单；不授 TEMP、`pg_read_all_data`、`pg_write_all_data`、`GRANT ... ON ALL`、通配 routine/type、未批准 large object 或 tablespace 权限。
5. `schema_migrations`对 Web、Worker、Backup 仅 SELECT，只有 owner/Migration 可写；`worker_runtime_leases`对 Web 仅 SELECT、对 Worker 为 SELECT/INSERT/UPDATE。Worker 的队列、解析、标准化、复核和 DRAFT 建立权限按实际 SQL 精确列举；Web、Admin 和 Backup 也按实际对象/操作列举，INSERT 所需 sequence 只授 USAGE，Backup sequence 只授 SELECT。
6. owner 的 default privileges 明确撤销 PUBLIC 对 tables、sequences、routines 和 types 的隐式权限，不向应用组设置宽泛未来默认授权。每次 Migration 后、服务启动前由同版本 reconciler 原子应用 exact ACL；未知角色、membership、对象、ACL、default privilege、routine/type/sequence/large-object 或策略摘要漂移均失败关闭。
7. TASK56 先关闭数据库对象/操作级边界，不声称已经实现共享表的行、列或状态级隔离。若受控试用证明该边界不足，queue transition、review finalization、upload reconciliation 和 DRAFT 创建必须改为 owner-owned、固定 `search_path`、参数化、可审计的 `SECURITY DEFINER` 命令接口，或拆分 command/result 表后再撤销 Worker 底表 DML。
8. Web、Worker、Migration 和 Admin 的 Pool 在每个新物理连接交付前阻塞式核验：`session_user=current_user=预期 LOGIN`、目标数据库/owner、application name、精确 role flags/connection limit/membership，以及数据库、Schema、`schema_migrations`和服务 canary 权限。角色互换、owner/superuser、错误数据库、可 `SET ROLE owner`、危险内置 membership 或 ACL 摘要漂移均以稳定去敏错误失败。
9. UAT/PRODUCTION 不再接受 `DATABASE_URL`、`ERP_MIGRATION_DATABASE_URL`、`POSTGRES_PASSWORD`、`ERP_ADMIN_PASSWORD`或`ERP_SETUP_TOKEN`值。数据库 host/port/name/user 是受合同约束的非秘密配置，独立文件只保存 password/token；消费者使用固定绝对目标、`O_NOFOLLOW`、regular/single-link、root owner、精确 group/mode、有限单值 UTF-8和打开前后 inode/metadata 一致性检查，错误不包含值、路径、DSN或角色清单。
10. Compose 使用逐服务、只读、`create_host_path:false`的固定 bind file，而不把 Compose `secrets`误称为加密保险库。Web只挂Web DB password，Worker只挂Worker DB password，Migration只挂owner password，Admin只挂Admin DB password与管理员临时password，PostgreSQL只挂bootstrap password并用`POSTGRES_PASSWORD_FILE`；source path、target path和inode必须互异。受控部署不创建或挂载Setup Token。
11. UAT/PRODUCTION关闭浏览器`/api/setup`，初始化只允许root调度的一次性Admin工具从独立文件读取临时密码并写审计；Setup Token不得进入浏览器或Web容器。Development/test的环境秘密兼容只允许显式非生产部署类别与隔离目标防护；UAT/PRODUCTION无fallback。Worker不再加载Setup Token，非秘密`RuntimeConfig`不再返回数据库连接串；Pool/secret初始化错误进入统一安全错误边界，日志只保留稳定code。
12. Backup 升级为两个独立 root-only service file：控制身份只写 durable fence intent、核对固定目标、暂时撤销 Web/Worker/Admin/Migration CONNECT、终止非 allowlist backend并精确恢复原状态；非 superuser、非 owner的`chenyida_erp_backup`保留 CONNECT，只执行批准关系/sequence/large object SELECT、reconciliation、Migration SELECT和`pg_dump --no-owner --no-acl`。capture 无 DML/DDL/TEMP/`pg_signal_backend`/SET ROLE/BYPASSRLS。
13. Backup control、restore/bootstrap和unauthorized probe是策略中的离线语义身份，不是常驻应用 privilege group。需要 superuser/ALTER DATABASE/terminate/CREATE TABLESPACE/CREATEROLE 的会话只能由UID0、root-only独立凭据、固定目标/命令和一次性授权窗口执行；其凭据不得挂入应用容器，完成后必须撤销并发布去敏回执。
14. D-132 v1 policy、fixture、snapshot和摘要保持不可变、只作 legacy/synthetic 解析。新增 cluster/runtime policy v2表达完整角色图与逐对象 ACL；v1恢复结果保持 NOLOGIN/connlimit0且标记`LEGACY_TASK55_SINGLE_RUNTIME`，必须经独立批准的v2升级事务、正负探针和v2重捕获后才能激活，禁止把旧 runtime 自动映射成 Web+Worker或复用旧凭据。
15. Compose仅声明未来 named volume `erp_postgres_tablespaces`，只读写挂载给PostgreSQL的`/var/lib/postgresql/tablespaces`；其他服务不得挂载。每个custom tablespace只能映射到该namespace下新空、999:999/0700、逐组件no-follow且与PGDATA/uploads/attachments/backup-status不重叠的子目录，CREATE只由离线operator执行。本任务不创建或chown当前Volume。
16. 实际切换遵循扩展、回填、切换、收缩：先在隔离PG17证明角色/ACL和秘密消费者，受控环境再由专项授权创建角色/凭据及reconcile，逐服务验证后切换连接，最后才撤销共享superuser运行身份。任何一步失败都保持旧服务与数据不变并回滚到已核验凭据/ACL快照。

### Consequences

- Web/Worker 的数据库身份、凭据和无关业务域访问被分离；共享导入对象仍按必要操作授权，不能用本决策冒充行级职责分离。
- 源权限artifact必须同时保存文件图候选和经过复核的显式排除；只由Worker触发的lease写入、dispatch、初始表头发布和normalization暂存替换必须通过单向模块边界从Web候选图中消失，不得依赖长期dormant exclusion静默剔除。当前唯一reviewed exclusion为既有`app_meta INSERT`。
- D-132 v1 policy只保留legacy/synthetic解释：V4 validate/create/publish及Dashboard消费端必须拒绝v1 `ACTUAL_OFFHOST/RECOVERY_READY`并返回稳定去敏错误，v1 synthetic永不ready；只有新v2 policy及完整正负权限重验后才可产生实际ready。既有alias必须先验证再写immutable history，防止无效alias制造孤儿证据。
- 运行 Compose、runtime policy、release inventory、D-132恢复、backup fence和Migration ACL断言必须同时升级；只改应用连接串或只增 GRANT 都不能通过。
- 旧 TASK55 bundle和TASK51候选在TASK56源码变化后为`STALE / NOT AUTHORIZABLE`。完成仓库与隔离测试仍不等于当前UAT已加固，真实角色/秘密/ACL、候选、部署和运行复核继续需要专项授权。
- 当前系统继续`PRODUCTION NO-GO`；本决策没有生成真实密码、创建Volume、连接/修改数据库、运行Migration、备份恢复或部署。

### Rejected alternatives

- 拒绝继续让单一superuser承担Web、Worker、Migration、backup capture和owner，也拒绝把同一密码复制到不同文件后称为身份分离。
- 拒绝修改已发布D-132 v1、允许额外角色来兼容v2、自动角色映射，或把legacy恢复结果直接激活。
- 拒绝让Web/Worker获得owner、数据库/Schema CREATE、TEMP、通配全表DML、`pg_read_all_data`、危险membership、SET ROLE owner或未批准large object/routine权限。
- 拒绝只把backup用户名改成普通角色却保留`CONNECTION LIMIT 0`，也拒绝让non-superuser capture承担ALTER DATABASE/terminate。
- 拒绝把环境fallback、Compose渲染值、argv、日志、回执或浏览器当作秘密交付渠道，也拒绝把bind file或Compose secret描述为静态加密保险库。
- 拒绝在本任务自动创建host secret目录、tablespace Volume/子目录、修改当前角色/ACL、升级UAT Migration或触发任何真实数据动作。

## D-134 PostgreSQL 运行权限变更采用直接消费者凭据、全局锁与崩溃可恢复日志

- 日期：2026-08-13
- 状态：`ACCEPTED / REPOSITORY IMPLEMENTED / SYNTHETIC-ISOLATED VERIFIED / ACTUAL ACTIVATION NOT AUTHORIZED / PRODUCTION NO-GO`
- 提案与实施：Codex 持续交付负责人，依据 TASK56 三线只读审计、D-133边界、Release Supervisor生命周期和真实PostgreSQL 17 system adapter故障注入
- 确认边界：只授权仓库实现、合成凭据、一次一个临时PostgreSQL容器、故障恢复及发布合同测试；不授权host安装、真实角色/口令/ACL、当前Volume、UAT/生产Migration/deploy、备份恢复或切换

### Context

- D-133已经固定五个数据库LOGIN、六个runtime secret文件和独立backup capture service，但此前只有静态consumer/reconciler；没有生产root入口、跨发布/备份的全局互斥、authorization消费前durable intent或进程被SIGKILL后的确定恢复。
- 把五个数据库口令再次汇总到operator专属文件会新增一个拥有全部登录秘密的长期副本，并可能使真实消费者文件与operator输入漂移；同一口令复制到不同文件也不能证明职责分离。
- `BOOTSTRAP`发生在新Web/Worker成为current runtime之前，不能要求一个尚未存在的postdeploy四服务严格回执；`RECONCILE`发生在current runtime上，又不能退回仅凭调用者参数的predeploy判断。
- PostgreSQL事务可能已提交但client在收到结果前退出。只用trap、单一“正在执行”文件或重复执行命令无法区分未dispatch、未知提交、已提交待捕获和回执双写中断。
- 发布、备份、Migration和权限变更都会消费同一数据库/运行身份。如果各自只持局部锁，存在release换bundle、backup启fence与operator变ACL交叉执行的窗口。

### Decision

1. 实际权限变更只能由安装后的content-addressed Release Supervisor执行。launcher在验证bundle、authorization、target、secret和runtime probe之前取得`/run/lock/chenyida-erp-release-gate-v1.lock`，并将同一已核验FD继承给runner，直到事务、独立核验、journal和receipt完成；独立contender必须证明锁处于busy。发布和backup入口复用同一锁与operator interlock。
2. Operator只读取直接消费者的最终来源：runtime secret根中的Admin DB、Migration、Web、Worker口令，以及物理独立backup credential根中的libpq capture service。Admin应用口令与PostgreSQL bootstrap口令只参与七值不复用检查。禁止aggregate password file、operator专属provisioner、外部`passfile`或把消费者口令复制到journal/authorization。
3. 七值都必须满足D-133的规范32-byte/43字符base64url、至少16个不同字符和两两不同；文件执行root/owner/mode/nlink/no-follow与打开前后metadata核对。跨崩溃只记录路径和稳定metadata identity，不记录秘密或秘密摘要。Backup service解析后的口令buffer在任一后续语法/字段/语义错误时立即清零。
4. `BOOTSTRAP`和`RECONCILE`使用不同信任时点。BOOTSTRAP只接受`PRE_DEPLOY_POSTGRESQL_BOOTSTRAP_BOUND`，由精确manifest、runtime configuration、目标container/database/system identity生成确定binding，不伪造postdeploy receipt；RECONCILE只接受`POST_DEPLOY_CURRENT_RUNTIME_STRICT`的同bundle新鲜probe receipt。RECOVER必须继承原操作的guard和精确identity。
5. Runner在authorization从pending移动到consumed之前，先以内容寻址pending写、原子发布、文件及父目录fsync完成`PREPARED` intent。状态采用append-only摘要链：`PREPARED → AUTHORIZATION_CONSUMED → TRANSACTION_DISPATCHED → POSTCOMMIT_CAPTURED → VERIFIED → COMMITTED`；完成证据归档而不删除。未知第三状态、冲突记录、backup fence并存或目标漂移只进入`QUARANTINED`。
6. role/owner/membership/ACL/default privilege/setting和五LOGIN口令在一个PostgreSQL事务内执行。口令仅经受控进程内buffer和`psql` stdin，事务内抑制statement/duration日志并在使用后清零。即使结构计划是no-op，RECONCILE也必须重置并用正确/错误凭据核验五个LOGIN，不能把结构相等解释为凭据已同步。
7. 原进程中断后禁止重复投递原authorization。新的RECOVER v3 authorization必须精确绑定原operation ID、原authorization SHA和active intent SHA；受信判断只允许resume authorization、dispatch/retry transaction、postcommit capture/verify、finish publication、archive committed或quarantine。事务已提交但进程立即SIGKILL的路径必须能从实际catalog和持久journal完成`CAPTURE_AND_VERIFY`。
8. intent、authorization、runtime probe、manifest、runtime policy、operator policy、数据库OID/system identifier/marker、container ID、credential generation及backup root身份形成同一证据闭包。正常执行要求当前受信release artifact仍合格；恢复可以使用过期但内容与来源精确匹配的原artifact解释已发生状态，不允许换新bundle或policy续跑旧intent。
9. Active/preparing/quarantine operator证据阻断release和backup；固定backup根上的`.backup-fence-v2.json`阻断operator。两者并存不是可自动选择先后顺序的状态，只能quarantine。任何入口不得删除对方的锁、fence、intent或receipt来恢复可用性。
10. 公开结果只允许稳定状态、operation ID和内容摘要，不输出角色清单、对象清单、口令、SCRAM verifier、DSN、service正文、SQL、堆栈或敏感路径正文。固定PG17 system adapter测试必须覆盖真实事务、提交后立即杀进程、journal恢复、结构no-op口令轮换、正确/错误口令探针以及stdout/stderr/PostgreSQL日志秘密扫描。

### Consequences

- Operator不再制造第八份秘密副本；五个数据库口令若与实际消费者不一致会在变更前或登录探针中失败，而不是留下“数据库已改、服务文件未改”的虚假成功。
- BOOTSTRAP可在服务切换前建立最小角色而不弱化postdeploy门，RECONCILE则不能脱离当前严格runtime证据运行。两种操作都需要独立专项授权，成功也不自动授权部署或切换。
- 崩溃后可能需要一份新的RECOVER authorization和人工判断；这是区分未知提交与确定回执所需的安全成本。Quarantine优先于自动可用性，禁止基于名称猜测反向SQL。
- 共享全局锁降低并发吞吐，但本项目本就要求低资源串行执行；换来的边界是release、backup与权限变更不能在相互不知情时改变同一证据。
- 仓库和隔离测试通过只证明实现可执行。当前UAT共享superuser、环境变量秘密和旧运行配置不因此改变；安装Supervisor、生成真实凭据、创建角色/ACL及激活仍须专项授权和同候选运行复核。

### Rejected alternatives

- 拒绝aggregate password JSON、operator专属secret root、从环境变量/argv读取口令，或以口令hash作为跨崩溃身份。
- 拒绝BOOTSTRAP伪造postdeploy四服务receipt，也拒绝RECONCILE复用predeploy稳定门或调用者自报`runtime_configuration_sha256`。
- 拒绝在authorization消费后仅靠trap删除intent、无journal重跑事务、把client断连当作回滚，或手工检查一张表后宣布已提交。
- 拒绝结构no-op时跳过五口令重置/探针、让正确口令失败仍发布receipt，或为方便调试打开SQL/口令日志。
- 拒绝release、backup和operator各持独立锁，也拒绝删除backup fence、active intent或quarantine证据来绕过联锁。
- 拒绝用新bundle、新policy、新credential generation继续旧intent；任何代次变化都必须先隔离原状态，再形成新的审阅和授权。

## D-135 正式发布候选采用独立detached快照、不可变回执和守恒式恢复

- 日期：2026-08-14
- 状态：`ACCEPTED / REPOSITORY IMPLEMENTED / SYNTHETIC-ISOLATED VERIFIED / HOST AND A2 NOT AUTHORIZED / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK59三轮独立安全攻击复核、Release Supervisor调用链和低资源运行约束
- 确认边界：只授权仓库工具、合成Git fixture、内容寻址bundle及测试；不授权host安装、外部push、正式A2、UAT/生产、真实数据、账号、网络或受保护Volume动作

### Context

- 原A2允许调用者给出任意Git根。它只能核对HEAD/tree和局部clean，不能证明该根是本任务独立detached worktree；launcher又在取得全局release锁前验证候选，存在验证后替换窗口。
- manifest-only候选必须绑定唯一source parent。更晚治理HEAD、共享主工作区、branch worktree或本机可变镜像引用都不能冒充同一候选。
- detached worktree不包含被Git忽略的`node_modules`和`.venv`。复制约806MiB依赖会扩大低资源风险，因此测试运行时必须作为只读借用对象另行绑定，且生命周期工具永不删除它。
- Git worktree命令可能在中断后留下target/admin一侧残留。强制remove/prune、根据名称猜测所有权或删除未知对象会破坏用户仓库；旧恢复audit跨代复用和quarantine丢失后回退旧成功也会掩盖证据损失。

### Decision

1. 正式候选只允许由`chenyida-erp-release-candidate-snapshot/v1`在全局release锁和snapshot lifecycle锁内创建，使用固定状态根、精确source commit/tree、唯一manifest-only父子关系以及`git worktree add --detach --lock --reason`；共享主工作区不得switch/reset/stash/clean。
2. PREPARE intent、prepared receipt、REMOVE intent、removal receipt及recovery intent/audit均采用canonical JSON、0400、file+directory fsync和no-clobber原子发布。VERIFY必须重核source、candidate、bundle、runtime、target、gitfile/admin/index、detached HEAD、tracked clean、未知Git状态和inode/mount/权限。
3. A2授权固定`candidate_snapshot_receipt`、其SHA-256和canonical `test_runtime_root`。launcher先取得全局锁，再调用bundle内snapshot verifier，随后才消费authorization；image evidence、release gate和manifest包装器在首次制品变化前及最终发布前各复核一次。
4. 借用运行时为`BORROWED_NEVER_REMOVE`。回执绑定从`/`开始的可信祖先、Node/Python依赖完整树、lock/requirements、固定解释器路径/dev/inode/mode/bytes/digest及source policy；六个消费者只读挂载该根，REMOVE不得清理或变更它。
5. 可证明split-brain恢复只能以同设备`renameat2(RENAME_NOREPLACE)`移动到root-only quarantine，永久标记`RETAINED_REQUIRES_SEPARATE_AUTHORIZATION`。每一代绑定lifecycle digest、generation、对象完整身份和固定Git运行时；全代必须连续唯一并逐代验证intent-audit-quarantine守恒，任何缺失、替换、pending冲突或旧tombstone漂移失败关闭。
6. PREPARE admin-only只有精确Task59 lock reason存在才可自动隔离；REMOVE target/admin-only还必须匹配prepared receipt中的root inode或完整admin tree。PREPARE target-only在没有创建前reservation receipt时无法区分Task59对象与foreign worktree，必须返回`SNAPSHOT_PREPARE_TARGET_PROVENANCE_UNPROVEN`且保持对象原样。
7. 要解除target-only操作阻断，后续版本必须先在同设备私有staging创建空目录，发布0400 reservation receipt并绑定root dev/inode/mode，再以NOREPLACE把同一inode提升为target；Git add前后和恢复时都必须验证同一inode。receipt前崩溃、inode替换、非空、跨设备或Git未保留root inode一律失败关闭。

### Consequences

- TASK59的最终source`7b9abec45a50da5655a2e78a0f42647536321290`与manifest-only直接子提交`89504045e4066bbe5236b19cf1a8bfa09701d508`形成78文件bundle，manifest SHA-256为`7927bb242cad9784a48ebaa8269ac9cc53cf56808c7dffc8f3d148111c7e5855`；脚本SHA-256为`71361ac9…d9add8a`。
- TASK57的76文件bundle及Web/Worker本机镜像因Site输入变化立即成为`STALE / NOT AUTHORIZABLE`。A1只能审阅新的TASK59 bundle；A3必须在后续最终源码上重建并锚定镜像，A2仍受A1、A3和target reservation阻断。
- 仓库测试通过不代表host已安装、快照已实际创建或正式19步门已运行。Quarantine内容不得由自动清理、任务trap或无专项授权命令删除。
- 系统继续`PRODUCTION NO-GO`；下一安全仓库任务为reservation所有权闭环，真实外部锚点、异机恢复、UAT晋升、真实迁移、员工试用和切换仍需各自证据与专项授权。

### Rejected alternatives

- 拒绝在共享主工作区切换到候选、把更晚治理HEAD写成镜像revision、接受branch/dirty snapshot，或仅靠路径名和HEAD摘要证明所有权。
- 拒绝复制或在REMOVE中删除借用依赖，拒绝在浏览器、授权参数或环境中把依赖路径当作未经核验的可信事实。
- 拒绝`git worktree remove --force`、`prune`、递归猜删、覆盖最终回执，或在最新quarantine/audit证据缺失时退回旧代成功。
- 拒绝在没有创建前reservation的情况下自动隔离PREPARE target-only；安全失败和单独人工处置优先于误删foreign worktree。

## D-136 发布候选target以创建前reservation、同inode提升和逐代终态链证明所有权

- 日期：2026-08-14
- 状态：`ACCEPTED / REPOSITORY IMPLEMENTED / SYNTHETIC-ISOLATED VERIFIED / HOST AND A2 NOT AUTHORIZED / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK60只读攻击审计、Git 2.43.7/POSIX探针和23项合成隔离fixture
- 确认边界：只授权仓库实现、内容寻址bundle与隔离测试；不授权host安装、A1—A3、外部传输、镜像重建、UAT/生产、真实数据、账号、网络、systemd、Swap或Docker daemon动作

### Context

- D-135能证明完整worktree、admin-only和REMOVE单边状态，却无法仅凭target路径判断PREPARE target-only是否由本任务创建。路径名、`.git`内容或旧audit都不是所有权证明。
- Git会跟随target或祖先symlink并写入referent；但Git 2.43.7使用标准`worktree add --detach --lock --reason`时，会保留预建root-owned `0700`空目录的dev/inode/mode。`renameat2(RENAME_NOREPLACE)`同设备提升也保留inode，EEXIST/EXDEV不会改写两侧对象。
- staging mkdir与最终receipt之间存在不可消除的未回执窗口。没有更早不可变创建意图时，该对象不能按名称猜测处置；完整`.publishing`则已经包含可验证的canonical所有权字节，可以完成no-clobber发布。

### Decision

1. 每代PREPARE先在固定root-owned `0700` staging根创建空普通目录，再发布`chenyida-erp-release-candidate-snapshot-target-reservation/v1` canonical `0400`单链接receipt，最后才允许target出现。
2. receipt直接绑定prepare intent路径/摘要、source repository/state、candidate、Supervisor bundle、借用runtime、lock reason、expected admin、generation、上一代terminal recovery、staging/target及可信祖先、父目录、mount identity和root dev/inode/mode/uid/gid；prepared/remove/recovery回执继续引用其路径与摘要。
3. 提升只使用已打开并fstat固定的两侧父目录FD执行`renameat2(RENAME_NOREPLACE)`，要求同设备并fsync两侧目录；禁止copy fallback、覆盖、删除、自动清理或跨设备退化。EEXIST时staging和foreign target保持原样。
4. Git派发前以`O_DIRECTORY|O_NOFOLLOW`持有reserved root FD，验证空目录、`0700`、可信祖先、无nested/bind mount及精确inode；Git后再次要求路径和持有FD仍指向receipt inode。只允许标准detach+lock+reason，不使用force/no-checkout/prune。
5. receipt后未提升、已提升空target和完整Git状态可幂等续跑；完整temp-only publication只在canonical bytes、单链接、精确binding和reserved inode都匹配时完成。mkdir后无receipt、partial temp、双方均缺失或证据漂移保持原样并失败关闭。
6. PREPARE target-only只有root inode与最新reservation精确匹配时才允许显式RECOVER移入永久quarantine；foreign/replaced inode、symlink、mount、非空、错误admin/backlink/lock或两侧不安全组合不得隔离或删除。admin-only继续要求D-135 Git身份。
7. 新reservation代次只有在上一代recovery intent、audit及永久quarantine全部验证后才能创建，并在新receipt中绑定上一代terminal audit路径/摘要；缺失、篡改或pending最新receipt/audit/quarantine不得回退复用旧代成功。
8. root-owned私有祖先是Git路径调用的信任边界；本合同防止非特权替换和误处置，不宣称能抵御已取得root并可同时改写所有受信状态的攻击者。

### Consequences

- TASK60源码`15501787f5cd304dfe5f8c75fb5df15d4e9a2258`/tree`3718593b8b6d362922bc4e84be6b6cf4adbd00a6`与manifest-only直接子提交`ffaaa9091cf09afa80918e87664ed6660f0556cf`/tree`9d42de1626ed6f8cf13308c7bbc2e83685f7341e`形成78文件bundle，manifest SHA-256为`17fb9f99af2aae24390d060344114d1d1089c1fb19a87280c83161e277fab5b8`；专项23/23、Supervisor72/72及credentials1671通过。
- D-135的target-only操作阻断已在仓库合同层关闭；TASK59 bundle立即成为`STALE / NOT AUTHORIZABLE`。当前仍没有源码匹配Web/Worker镜像、installed Supervisor、A1/A3或正式A2，不得把本任务fixture写成host快照或19步PASS。
- Swap仍超过80%停止线，本任务没有build、全量Node/PostgreSQL、Docker数据库、typecheck或镜像重建。下一安全任务为TASK49监控的内容寻址host delivery包；真实安装和外部投递仍需专项授权。

### Rejected alternatives

- 拒绝用路径名、空目录、`.git`正文、candidate HEAD、旧audit或目录link count代替创建前receipt，拒绝自动处置unreceipted staging。
- 拒绝让Git创建可跟随的任意路径，或在Git后才发现target/ancestor symlink；拒绝0755根、非空根、未知mount、父inode漂移和跨设备copy。
- 拒绝覆盖foreign target、递归删除、force/prune、回收quarantine、删除最新失败证据或用旧代audit授权新代对象。

## D-137 监控宿主交付采用三身份内容寻址事务与远端精确 ACK

- 日期：2026-08-15
- 状态：`ACCEPTED / REPOSITORY IMPLEMENTED / SYNTHETIC-ISOLATED VERIFIED / HOST, EGRESS AND REAL DELIVERY NOT AUTHORIZED / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK61三条只读审计、崩溃/并发攻击复核和低资源串行测试
- 确认边界：只授权仓库工具、内容寻址bundle、固定unit/timer和合成fake-root/fake-systemd/fake-channel测试；不授权host安装、账号、systemd、网络出口、真实渠道/凭据、UAT/生产、备份恢复或数据动作

### Context

- TASK49/D-126已有严格去敏观察、统一资源阈值、状态机和本地pending，但依赖可变Git checkout，没有host installer、运行身份隔离、固定unit/timer、真实adapter的ACK证据或可验证升级/回退事务。
- root采集需要有限`/proc`和Docker socket metadata；评估只需要去敏observation与root发布的组件/恢复投影；通知只需要不可变event和单独凭据。让三者共用root或Docker组会把日志、环境、卷、网络和凭据边界混在一起。
- HTTP 2xx、进程exit 0、本机文件和“send后崩溃”均不能证明远端按同一event/target确认；先标记delivered再发网络会在崩溃时制造永久假成功。
- 安装active指针、systemd启动、COMMITTED journal和activation receipt若顺序错误，会出现未提交版本开始运行、失败后又写冲突回退终态，或同一授权重试覆盖证据。
- 当前真实通知target、值班人和出口均未获授权；安全默认必须能安装后保留pending并显式失败，而不是为演示开放任意网络。

### Decision

1. Monitor bundle、Node runtime和activation全部内容寻址。源码提交只包含业务字节，紧随的monitor manifest-only提交固定27文件，随后Supervisor manifest-only提交把monitor manifest和三项受控操作纳入一个105文件bundle；任一缺失、额外文件或摘要/模式漂移在执行前拒绝。
2. 固定三身份：collector为root且只读有界host/Docker metadata；evaluator使用独立非特权uid/gid且无网络；notifier使用另一非特权uid/gid且无Docker、`/proc`、完整状态或root配置。跨边界只允许canonical observation、最小投影、immutable event和delivery回执。
3. 七个固定systemd unit/timer使用绝对launcher、单飞继承FLOCK、60秒采集/90秒最大间隔、超时、资源限额、`NoNewPrivileges`、strict文件系统与精确读写路径。运行Node使用`--jitless`以保持`MemoryDenyWriteExecute=true`；effective `FragmentPath`、无drop-in/transient、User/Group/ExecStart/credential/hardening均须复核。
4. Installer只能从installed Release Supervisor在同一已核验全局锁FD下运行，并再取得独立install锁。候选bundle/runtime/config、uid/gid、前一activation及authorization全绑定；先物化不可变内容，再冻结timer/service与三phase lock，随后切换active、验证effective systemd、发布durable COMMITTED journal/receipt，最后发布activation receipt使launcher可运行。
5. 失败只恢复切换前精确文件和unit状态；durable COMMITTED后不再写冲突rollback。稳定重试只能补齐同一commit的缺失activation receipt。显式rollback必须指向唯一已验证COMMITTED activation；disable只停止并禁用精确unit，重复验证inactive/disabled并记录bundle/runtime/config/state/outbox/delivery/journal保全摘要，物理删除始终需要新的专项授权。
6. 状态和投递发布采用canonical JSON、精确owner/mode/nlink、no-follow、临时文件fsync、no-clobber hard-link或原子rename和父目录fsync。识别出的完整prepare crash point可恢复；未知临时项、断链、回退、跳代、路径或inode漂移失败关闭，不递归猜删。
7. Evaluator先原子提交状态，再确保由该状态确定生成的event envelope/grant；下次运行可修复“state已提交、outbox未发布”崩溃窗口。Notifier依次发布claim、attempt、result；只有远端返回严格canonical ACK且精确匹配event、target generation、idempotency key与attempt，才发布ack和原子`readiness/current.json`。超时/断连/响应歧义保留至少一次重试，同一event不能被新target重新解释，耗尽旧事件仍保持可见但不饿死后续事件。
8. Components/backup输入只接受独立root投影及单调watermark；首次必须generation 1/零前驱，未来时间、旧activation、producer/policy/identity漂移和generation回退拒绝。TASK61只实现解析/消费边界，权威postdeploy/V4 recovery producer转交TASK62，缺失时保持`NOT_COLLECTED`。
9. 当前notifier unit固定`IPAddressDeny=any`。HTTPS adapter及精确ACK语义可以在合成fixture验证，但真实出口必须由后续内容寻址目标绑定策略和项目负责人专项网络授权显式开放；不得以drop-in、手工unit编辑或放宽effective验证绕过。

### Consequences

- TASK61源码`b057f81b989eab07a4a40603c6a2a4486f326ee1`/tree`a571800f83d38209603e2bfe2a3e35b71bd2eb2b`、monitor manifest-only`3327be43d026d83477fff9e79a0eb0f090902e86`/tree`23da2f11b1ae9f6612063c0b8b4634cbf2ac11b7`和Supervisor manifest-only`222584c03cd016c69daa96013c6420dfcbfc5647`/tree`2286082369969dd6c8b94df2aeb227dbac2f3e72`形成canonical链；两个manifest SHA-256为`6782ec58536826e76e3954e73fb24d5f3b9ee9a8d720f1b1515435d4fa5aea07`和`56157a6878e7e0b2c405185ac0845922cd953fcb317f6df3449f2e486976efcb`。
- Node监控/交付30/30、Supervisor launcher/delivery23/23、release contract20/20及Python AST、JSON、inventory和双manifest重放通过。实际host `systemd-analyze`、重启持续、真实渠道ACK和资源开销仍须A5a授权后重新验证。
- TASK60 bundle及所有既有Web/Worker镜像因Site输入变化为`STALE / NOT AUTHORIZABLE`；最终安全仓库输入收口后必须统一重建候选、外部锚点和正式证据。
- 系统继续`PRODUCTION NO-GO`。没有host安装、网络出口、权威投影producer、真实异机恢复、同候选UAT、岗位/员工验收和切换，不得宣称持续监控或真实告警可用。

### Rejected alternatives

- 拒绝root一体进程、把应用账号加入Docker组、给Web/Worker挂Docker socket，或让notifier读取完整root配置、状态、日志、数据库、备份/Volume正文。
- 拒绝可变Git checkout、系统Node路径、tag、手填摘要、可覆盖active/receipt、无fsync JSON和在启动时自动迁移/清空状态。
- 拒绝把HTTP 2xx、exit 0、stdout、本机文件、人工口头确认或send调用返回当作`DELIVERED`，也拒绝在网络前发布readiness。
- 拒绝自动删除unknown/foreign对象、旧版本、state/pending/journal/receipt，拒绝用旧COMMITTED或跳代配置冒充安全rollback。
- 拒绝默认开放网络、接受任意drop-in或以“未来会配置渠道”为由把当前deny-all写成A5a已就绪。

## D-138 监控权威投影只由installed Supervisor发布且legacy集群策略不能证明实际恢复

- 日期：2026-08-15
- 状态：`ACCEPTED / REPOSITORY IMPLEMENTED / SYNTHETIC-ISOLATED VERIFIED / HOST AND ACTUAL RECOVERY NOT AUTHORIZED / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK62对postdeploy、V4 recovery、monitor watermark和崩溃恢复边界的只读审计与合成攻击测试
- 确认边界：只授权仓库发布器、一次性授权入口、内容寻址bundle和合成fake-root/fake-receipt测试；不授权host安装、读取真实回执、备份/恢复、网络、UAT/生产或数据动作

### Context

- TASK61只消费root控制的`components.json`与`backup.json`，若允许调用者手填摘要、在可变checkout运行或复用旧release/恢复证据，monitor可以把错误身份显示为当前健康。
- Release健康必须同时闭合当前monitor activation、private host config、current release identity和canonical postdeploy receipt；只核对一个Git SHA、镜像tag或API health不足以证明四服务、Migration和deployment同源。
- V4实际恢复必须由当前runtime identity、真实异机传输及恢复证据和集群政策共同证明。D-132的V1政策只在合成边界建立，缺少真实恢复批准、独立目标和完整runtime privilege合同；将其兼容映射成actual会把“测试通过”误写为“真实可恢复”。
- 投影current alias、history和source receipt跨崩溃存在部分发布窗口。覆盖写、只保留current、按路径名清理temp或允许跳代会破坏回退检测和审计链。

### Decision

1. 只允许installed Release Supervisor在同一全局release FLOCK内通过`PUBLISH_MONITORING_COMPONENTS_PROJECTION`和`PUBLISH_MONITORING_BACKUP_PROJECTION`消费V2一次性root授权；专用操作不得落入通用命令执行路径。
2. 授权固定每个权威源的路径、SHA-256、bytes、dev/inode、uid/gid、mode和nlink。Supervisor在Node准备前、授权消费前后重复核验；bundle内Node发布器再次no-follow读取精确授权源。
3. components必须同时验证当前monitor activation、private config、release identity和postdeploy receipt，并重新构造完整runtime identity及四服务严格回执。调用者自报deployment、Git、Migration、镜像、producer或时间不能替代权威源。
4. backup默认只接受当前identity匹配、未过期的V4 `ACTUAL_OFFHOST + RECOVERY_READY`及canonical policy/RPO。V1集群恢复政策始终返回`READINESS_V4_LEGACY_POLICY_ACTUAL_FORBIDDEN`；测试注入validator只能验证发布存储，不得进入生产默认路径。
5. 两类投影各自从generation 1/零前驱开始，完整history不可变并绑定previous/source SHA。current alias必须逐字节等于精确history对象；canonical JSON、确定性temp、file/directory fsync和原子rename形成崩溃安全提交。
6. 只允许恢复未被alias引用、与当前候选canonical bytes及全部metadata完全一致的已识别partial；alias引用差异、history替换、未知temp、未来时间、回退、跳代或source漂移保持证据并失败关闭。
7. root投影根marker为root-only `0400`，根/history为root:monitor-evaluator group `0750`，投影为`0440`；发布内容仅含monitor需要的最小去敏字段，不读取或投影API正文、环境、日志、数据库、业务行、凭据或备份位置。

### Consequences

- TASK62源码`0e38ac2e286abf4f9b95b46258448df5f9bc67cd`、monitor manifest-only`9d0eeb7b3f67855c8e2af57c3296a5c9b9b57a2f`和Supervisor manifest-only`672a0695b761a50093c15401cf8d9e39951ced36`形成27/113文件canonical链；两个manifest SHA-256为`d1b0239f…8790`和`9d653c63…96f1`。
- Python专项28/28、受限Node投影6/6、release contract20/20和inventory 250/226/24通过。仓库可确定性地产生并恢复投影，但当前host未安装、没有真实权威源，因此不能宣称持续监控或备份ready。
- V1政策的actual正向路径仍故意阻断。TASK63必须新增不可变V2政策和兼容测试，不能修改V1或删除拒绝；真实异机恢复、凭据、目标和批准仍须专项授权。
- TASK61/TASK60及更早bundle、现有Web/Worker候选继续为`STALE / NOT AUTHORIZABLE`；最终安全仓库输入稳定后必须重新生成镜像、外部锚点和正式授权输入。

### Rejected alternatives

- 拒绝浏览器/API、普通调用者、monitor evaluator或手工JSON直接发布root投影，拒绝依赖可变Git checkout、系统Node、tag或单一摘要。
- 拒绝用V1、V2/V3旧readiness、synthetic、同机副本、未过期但旧runtime identity或测试注入validator生成实际backup绿色结果。
- 拒绝覆盖history/current、只保留最新代、从旧代回退、跳过fsync、递归清理未知temp或用路径名代替inode/owner/mode/nlink验证。
- 拒绝为形成正向fixture而降低V4生产默认断言；实际正向能力必须由后续V2政策合同和真实授权证据获得。

## D-139 PostgreSQL实际恢复采用冻结V1执行引擎与V2运行权限编排双层证据

- 日期：2026-08-15
- 状态：`ACCEPTED / REPOSITORY IMPLEMENTED / SYNTHETIC-ISOLATED VERIFIED / HOST ACTIVATION AND ACTUAL RECOVERY NOT AUTHORIZED / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK63对冻结V1、V4 readiness、TASK56 runtime privilege和monitor projection的只读审计与41项合成攻击测试
- 确认边界：只授权仓库V2政策、validator/builder、V4/Dashboard/monitor兼容链和合成fixture；不授权host发布/激活、真实凭据、备份/恢复、数据库、UAT/生产或数据动作

### Context

- D-132的V1恢复合同与执行器已经形成不可变证据，只认识3个legacy角色和2份LOGIN凭据回执；D-133/D-134当前运行权限基线则是9角色、5 LOGIN、4条membership和1261条ACL。修改V1会破坏旧证据，宣称V1已经证明当前权限则会伪造来源。
- V4 actual既要证明基础cluster恢复，也要证明当前发布/运行身份、全部角色/ACL/default privileges、五份LOGIN secret、四域、tablespace、extension、large object和连接围栏。任何单一“成功”字段或同机合成恢复都不足以形成真实就绪。
- 单纯验证政策正文内部摘要不能阻止攻击者替换正文并重新计算全部自描述摘要。政策必须外部固定已审阅模板、源码及Supervisor bundle，并通过受控逐代激活形成权威current。

### Decision

1. 冻结V1 policy、contract和executor字节及语义；V2不得修改其回执格式或用兼容映射把V1升级为actual。
2. V2 generation 1作为独立编排/控制政策，嵌入精确V1 policy原始SHA和文件身份，并固定当前runtime privilege/operator来源及roles、identities、extensions、ACL/default privileges、Migration、镜像与四域摘要。
3. 基础恢复继续产生V1 recovery/2-login credential证据；V2 recovery control intent和当前runtime privilege `BOOTSTRAP` receipt作为分离证据，共同证明5个当前LOGIN凭据、9角色和完整权限重建。两层证据不得相互冒充。
4. actual policy必须绑定environment、policy generation及previous policy、当前Supervisor bundle、分离的authorization/approval/operator/approver、RPO/RTO、激活/过期且最长24小时、恢复后销毁或保全决定；repository template只允许合成TEST。
5. actual recovery必须使用独立TEST目标，并绑定不同的source/target location、system identifier和machine、release/runtime/operations身份、四域及runtime credential generation/role set；目标必须为空或已围栏，禁止覆盖源cluster。
6. V4 actual链由V1基础回执、V2 recovery control和当前runtime privilege receipt共同形成；V1 actual、template actual、synthetic、同源/同机、过期/未来、旧代/跳代、跨环境、身份/摘要漂移及连同摘要一起重签名的替换政策全部以稳定代码失败关闭。
7. Dashboard与monitor backup projection使用同一默认V2验证器，不允许测试validator或调用者参数进入生产路径。仓库template本身不构成host active policy或恢复ready。
8. TASK63不实现host publisher。固定路径只能由后续installed Supervisor内容寻址、一次性授权、root-only/no-follow和崩溃安全激活合同发布；在TASK64及专项授权完成前保持缺失并失败关闭。

### Consequences

- TASK63源码`de993c0326b959f7f7c451504a6ef3a753e09c11`/tree`5d427f26eeafec4fbaf7c4faa6abf9516d0a8921`与Supervisor manifest-only`e527fcfe5fa0f779cbe4514ffa82376e1d0f3462`/tree`778b24a550215271bba248ea6367adc8d1b3fb92`形成117文件canonical链；manifest raw SHA-256为`4c3b801f…5582`。
- V2 policy raw/logical SHA-256为`1a092993…7aa`/`c30951ad…8b8`；冻结V1 contract/executor SHA保持`d11ba513…cfa`/`b555d4c9…a4be`。V2/V1/Dashboard/monitor 41/41、release29/29及适用Supervisor、inventory、凭据与静态门通过。
- 该实现只证明仓库能够严格验证完整actual证据，不证明当前存在actual policy、异机副本、凭据、恢复目标或真实RPO/RTO。系统继续`PRODUCTION NO-GO`，TASK64负责仓库级受控激活合同。

### Rejected alternatives

- 拒绝修改冻结V1、把V1 actual映射为V2、把2份legacy credential receipt解释为5份当前LOGIN secret，或只看roles名称近似相等。
- 拒绝信任自描述且可整体重签名的替换政策、手工JSON、路径名、调用者自报摘要、synthetic/同机副本或测试validator形成真实ready。
- 拒绝在没有内容寻址publisher、一次性授权、逐代current和activation receipt时手工复制政策到host固定路径。

## D-140 PostgreSQL集群恢复策略采用内容寻址逐代激活与保全式恢复

- 日期：2026-08-15
- 状态：`ACCEPTED / REPOSITORY IMPLEMENTED / SYNTHETIC FAKE-ROOT VERIFIED / HOST ACTIVATION AND ACTUAL RECOVERY NOT AUTHORIZED / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK64对Supervisor、固定policy消费者、崩溃边界和bundle切换联锁的实现及Python37/37、Node52/52合成验证
- 确认边界：只授权仓库activation contract/publisher、Supervisor操作、安装联锁、V4/monitor消费和fake-root测试；不授权真实host路径、policy激活/回退、凭据、数据库、备份恢复、UAT/生产或数据动作

### Context

- D-139已经固定V2 repository template与actual验证语义，但模板正文和内部摘要不能证明它由当前installed Supervisor审阅、授权并发布到host固定路径。
- policy正文、activation receipt和current alias跨多个持久对象。若先消费一次性授权后进程中断，简单重试可能复用授权、覆盖前代或把不完整文件误判为current；若自动删除未知partial，又会破坏取证和恢复决策。
- V4 readiness、monitor backup projection和Supervisor bundle切换必须看到同一条已提交链。只检查目标JSON、只检查receipt或允许手工补current都会形成不同权威源。

### Decision

1. actual目标固定为`/etc/chenyida-erp/recovery/postgresql-cluster-recovery-policy.json`，私有状态根固定为`/var/lib/chenyida-erp/postgresql-cluster-recovery-policy-v2`；目录、marker、history、receipts、intents、recoveries、quarantine和current均使用可信祖先、root-only/no-follow、单硬链接、canonical JSON及精确metadata。
2. Supervisor authorization v4只允许`ACTIVATE_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2`、`ROLLBACK_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2`和`RECOVER_POSTGRESQL_CLUSTER_RECOVERY_POLICY_V2_ACTIVATION`；原操作绑定template raw/logical SHA、release identity、current bundle、environment、generation/previous、固定源metadata、三方actor、RPO/RTO、处置及最长24小时，恢复另用新授权绑定原已消费授权和intent。
3. 原操作必须在消费authorization前持久化完整intent并重复核验所有来源；发布durable顺序固定为content-addressed history→0440 target→content-addressed receipt→0400 current，每步执行file/directory fsync、no-clobber或同字节幂等验证。
4. 每个generation必须有且只有一个同自哈希intent、policy和receipt；current精确等于末代receipt，target精确等于末代history。generation连续、previous policy/receipt和environment一致；rollback从generation 3起只能引用当前前一代之前的精确已提交receipt，并继承其environment、RPO/RTO和处置。
5. 中断后只有新RECOVER授权可续发。已完整提交返回幂等终态；可证明且政策未过期的partial可继续；不一致、替换、断链或过期partial一律保全原对象并发布quarantine/recovery证据，不自动删除，也不允许过期政策被恢复为active。
6. V4 actual readiness与monitor backup projection必须读取固定状态根的完整committed chain，且输入activation receipt必须逐字节等于current并绑定当前release identity和不可变history；repository template、V1、synthetic、手工JSON、policy-only或receipt-only均失败关闭。
7. 安装或切换Release Supervisor bundle前必须复核完整policy/history/receipt/intent/recovery链；存在partial、quarantine、目标漂移、缺intent或无效rollback时阻断切换，避免新代码接管无法证明的旧事务。
8. TASK64交付的是未来专项授权可执行的仓库合同，不表示当前host已安装Supervisor、存在actual policy或完成真实恢复；实际ACTIVATE/ROLLBACK/RECOVER仍须逐次专项明确授权。

### Consequences

- TASK64源码`83d920b1ac017370270452d334e44fa36a6b3978`/tree`83084e980d794a37bfeb835fcbf89e7c5210fee7`与manifest-only直接子提交`0e2328b58bc68cf09dc6b0638bb5ded82b0cf347`/tree`585b3c8d1d38f695422c5378eaa24691627de932`形成121文件canonical链；manifest raw SHA-256为`728f9a5f…35db9`。
- Python Supervisor专项37/37、正式Debian Node合同52/52、manifest合同9/9、cluster transfer4/4和inventory252/228/24通过；没有运行build、全量Node/PostgreSQL、数据库或真实网络测试。
- 真实A4恢复链仍缺异机目标、密钥/凭据、实际policy activation、当前数据备份/恢复与RPO/RTO；系统继续`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝手工复制模板、环境变量指定policy路径、只校验内部摘要、overwrite current、复用已消费授权或在启动时自动迁移/激活政策。
- 拒绝仅保留latest、原地改写receipt/history、对unknown partial执行递归清理、从任意旧代回滚或允许cross-environment chain。
- 拒绝让V4、monitor和installer分别接受不同宽松证据，也拒绝把fake-root测试或仓库publisher描述为真实host可恢复性。

## D-141 监控通知出口采用目标绑定内容寻址政策与effective systemd双重证明

- 日期：2026-08-15
- 状态：`ACCEPTED / REPOSITORY IMPLEMENTED / SYNTHETIC FAKE-ROOT VERIFIED / REAL TARGET AND HOST ACTIVATION NOT AUTHORIZED / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK65对notifier配置、HTTPS adapter、Supervisor、launcher、systemd unit和delivery readiness的只读审计及受限Node25/25、Python36/36、release20/20验证
- 确认边界：只授权仓库policy/publisher、Supervisor操作、合成effective-unit和断网adapter合同；不授权真实target/DNS、凭据、账号、systemd、网络、通知、host安装、UAT/生产或数据动作

### Context

- TASK61/D-137的notifier已要求HTTPS、结构化远端ACK并以`IPAddressDeny=any`默认失败关闭，但private config中的endpoint不能证明对应出口由当前installed Supervisor逐项审阅和激活。
- 运行时DNS、代理、redirect、宽CIDR、调用者自报remote address或未知systemd drop-in都可能让“配置目标”和实际连接目标分离；仅校验policy JSON也不能证明systemd真正加载了同一政策。
- policy、drop-in、activation receipt、effective-unit和delivery readiness跨多个持久对象。崩溃、回退、credential rotation和target rebind必须保持一条逐代可恢复权威链。

### Decision

1. V1 egress policy绑定deployment/environment、target ID/generation、固定HTTPS Host/SNI/path、端口443、最多8个精确公网IPv4/IPv6地址、adapter、credential metadata、on-call/escalation摘要、monitor/Supervisor bundle及最长24小时有效期；拒绝通配CIDR、私网/保留地址、HTTP、proxy和redirect。
2. base notifier unit保持`IPAddressDeny=any`。每代只允许由policy生成的内容寻址专用drop-in增加精确`IPAddressAllow`；launcher必须同时核验root-owned物理base unit、专用drop-in目录唯一成员及内容、systemd loaded properties、unit身份和零环境覆盖。
3. Supervisor authorization V5只允许ACTIVATE/ROLLBACK/RECOVER，绑定source metadata、current/previous、高水位generation、policy/drop-in/effective摘要和最长24小时；先持久化intent，再消费授权，再apply并核验effective systemd，最后发布receipt/current。已提交恢复也必须重验effective状态。
4. publisher使用可信祖先、no-follow、canonical JSON、content-addressed history/intents/receipts/recoveries、atomic no-clobber和file/directory fsync。相同intent可幂等继续；不同intent即使复用activation ID也拒绝。未知drop-in、partial或替换对象只保全并quarantine，不自动删除。
5. target rebind必须新generation和新授权；credential rotation只有在目标身份不变时才可保留目标，仍须新generation。下一代由历史高水位决定，rollback只允许精确当前前代，不能在回退后复用旧generation。
6. HTTPS adapter把连接固定到批准地址同时保持Host/TLS server name，禁用agent、proxy、redirect和运行时DNS，并核对socket remote address。delivery readiness V2同时绑定当前policy、activation receipt和effective-unit摘要；legacy V1仅可读，不能形成READY。
7. TASK65仓库合同不表示真实渠道可达或A5a已获授权。真实target、固定IP、root-only credential、值班责任人、host账号/systemd/网络及每次ACTIVATE/ROLLBACK/RECOVER均须项目负责人专项明确授权。

### Consequences

- source`05502fda0bcac7952d12374dfab78cccf8284bb3`→monitor manifest-only`013e61fd16f679f453ab0a1abfeade65dbd9de7d`→Supervisor manifest-only`7c69385c5ee35d517e9611fe04f55ae17be4f194`形成30/126文件canonical链，manifest raw SHA-256为`8260bed4…302`/`aab36e62…53a3`且逐字节重放一致。
- 受限断网Node25/25、Python Supervisor36/36、release20/20、inventory253/229/24及适用静态/敏感/diff门通过。完全cap-drop初跑的7个`chown EPERM`是fake-root fixture能力不足，以最小`CHOWN/FOWNER/DAC_OVERRIDE`重跑后原断言通过。
- 当前host未安装该bundle、未激活policy、未配置真实target/credential或发送通知；A5a、真实异机恢复、同候选UAT、真实迁移和员工验收仍未完成，系统继续`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝全网放行、域名运行时解析、代理环境、HTTP/redirect、任意CIDR、只按Host字符串判断或信任调用者自报remote address。
- 拒绝手工编辑unit/drop-in、只检查仓库模板、不核对loaded systemd、overwrite current、复用授权/activation ID或回退后复用generation。
- 拒绝把HTTP 2xx、send返回、stdout/本机文件或legacy readiness当成远端已送达，也拒绝把合成fake-root结果描述为真实host/渠道已就绪。

## D-142 应用授权采用源码摘要机器矩阵且全员可读范围必须业务批准

- 日期：2026-08-15
- 状态：`ACCEPTED / REPOSITORY IMPLEMENTED / TECHNICAL GATE VERIFIED / BUSINESS APPROVAL PENDING / NO ACCOUNT OR DATABASE ACTION / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK66对11角色、动态permission、Dashboard domain、30个self-hosted handler及既有权限测试的只读审计和矩阵10/10、release20/20验证
- 确认边界：只接受源码事实的机器证据和失败关闭漂移门；不批准岗位职责、数据可见域、账号映射、真实UAT写、数据库角色/ACL或部署

### Context

- 角色权限来自静态基表、多个动态组合、dispatcher的`material.read`前置、子handler细粒度检查和Dashboard domain裁剪；只审阅某一文件或手写角色表会遗漏实际调用链。
- 当前若干角色测试只覆盖选定操作且历史上遗漏planning；新增handler、route、permission或Dashboard domain时没有一个统一门证明11角色对全部服务端操作的结果。
- 当前有21条受保护读操作对11角色全部允许，另有`material.import.commit`和`sales.reverse`两项授权但当前dispatcher不可达。技术实现不能自行把这些范围认定为业务最小权限，也不能伪造一个拒绝角色让门变绿。

### Decision

1. 以`IDENTITY_ROLES`、`permissionsForRole`、导出的Dashboard role-domain源、`selfhost-api.ts` dispatcher、全部30个handler及其授权依赖作为机器权威；canonical route contract只描述经过源码摘要锁定的method/path、permission、data domain和安全期望。
2. 每次生成固定11角色对每个操作的ALLOW/DENY、显式/通配原因、dispatcher前置permission、源码行和源码manifest。角色增删、通配扩散、handler集合、授权依赖、route literal/prefix、permission定义/使用或源码摘要漂移均失败关闭。
3. 受保护操作必须有普通角色正向证据；admin通配不能成为唯一允许来源。受保护写必须有拒绝角色，并固定CSRF、幂等和事务审计合同。
4. 当前没有拒绝角色的受保护操作只允许是安全读方法，并自动附`CURRENT_ALL_EMPLOYEE_READ_SCOPE_REQUIRES_BUSINESS_APPROVAL`；制品readiness保持`BLOCKED`，不得写成岗位已批准。业务若收窄或接受范围，必须形成A7d记录并重生成矩阵。
5. 已授予但静态不可达的permission只能以精确分类、理由和责任人保留；不得被静默忽略。动态构造permission另以独立分类绑定源码。业务处置后删除或保留都必须修改源码和负向测试。
6. 矩阵artifact使用canonical排序、自摘要和授权源码manifest，矩阵测试纳入正式release inventory及runtime policy；任何候选必须在同一源码快照重放一致。

### Consequences

- TASK66 source`925f8a45edd19be7b27a845dadf621bf39883d8d`→monitor manifest-only`c1f1d5269e2ed88af8326e59177f7bb1a02eba25`→Supervisor manifest-only`9b657f2458427482f6ed28c0178999d3d62877f2`形成30/126文件canonical链，manifest raw SHA-256为`3a9192af…b6f6`/`66a604fa…0da6`。
- artifact固定11角色、158 permission、186操作、175受保护及110受保护写；154条有拒绝角色，21条全员只读和2个legacy grant保持业务阻断。artifact/source-manifest SHA-256为`741bb742…9a34`/`2c4870ca…1863`。
- 矩阵10/10、release gate20/20、manifest contract9/9、Supervisor36/36及inventory254/230/24通过；这些证据只证明当前源码授权事实可追溯，不证明真实岗位合理或已被员工验收。
- A7d仍须业务负责人逐项批准职责分离、财务/数据域、管理员/break-glass、账号生命周期和审计责任。批准前不得启用真实员工账号；系统继续`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝以页面菜单、Dashboard隐藏、角色名称、文档手填表或少量正向测试代替服务端调用链和逐角色负向证据。
- 拒绝让admin通配成为唯一正向证据、让写操作对所有角色开放、用虚构拒绝角色掩盖全员读取，或把业务待批准字段改成`APPROVED`以通过测试。
- 拒绝忽略未使用permission、动态字符串、prefix route、dispatcher前置权限或新增handler，也拒绝在候选构建时临时生成未提交矩阵。

## D-143 跨岗位UAT采用事前授权、逐步数据库增量与三方签字的失败关闭合同

- 日期：2026-08-15
- 状态：`ACCEPTED / REPOSITORY IMPLEMENTED / SYNTHETIC CONTRACT VERIFIED / BUSINESS APPROVAL AND HUMAN UAT NOT AUTHORIZED / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK67对核心业务链、TASK66授权矩阵和既有服务端/浏览器测试的只读审计及专项9/9、Supervisor105/105验证
- 确认边界：只接受仓库内合成场景、预期增量、异常/冲销证据与空签字模板；不批准岗位、账号、UAT业务写、真实数据、快照恢复、员工试运行或部署

### Context

- TASK66证明当前源码中11角色对186项操作的技术授权结果，但技术授权不等于业务负责人批准，也不能证明多个真实员工按职责分离完成端到端流程。
- 既有专项测试分别覆盖服务端规则，缺少统一合同把角色、API、数据域、预期数据库增量、审计/request ID、异常和回退逐步绑定。只汇总“测试通过”会掩盖跨岗handoff和半记录风险。
- UAT执行涉及账号、业务写、快照与恢复等专项授权。若允许事后补批、空字段继续或用直接SQL清理，证据将不可审计且可能改写已过账事实。

### Decision

1. canonical UAT合同固定采购→收货/IQC→库存/AP、生产领退→工序/IPQC→完工、销售→FQC→出货/AR、付款/冲销四条链，共32个逐步动作、6个检查点/冲销分支、32个控制项和16类证据源；每步绑定TASK66角色、permission、method/path、data domain及源码摘要。
2. 每条链必须同时证明未授权403、CSRF、Idempotency-Key重放/冲突、CAS冲突、事务失败零半记录、追加式业务冲销及audit/request ID；禁止用UI隐藏、HTTP成功或最终余额单点代替中间数据库增量和审计证据。
3. 执行人、观察人和业务验收人必须分离。业务批准、账号/角色映射、命名合成对象、允许写范围、时间窗、停止条件、回退责任、逐步结果与三方签字任一为空，整体只能为`BLOCKED`，不能事后回填为事前批准。
4. 业务更正优先使用系统定义的追加式冲销/反向记录；不得直接删表、改账或覆写已过账记录。环境级快照恢复须另有已验证快照、逐检查点执行器和专项授权，不能与业务冲销混为一谈。
5. policy、生成器、artifact和人读文档必须确定性一致，并在release inventory及runtime policy中固定；TASK66 artifact/source摘要、角色、permission、route、步骤、控制、证据或签字政策漂移均失败关闭。
6. 合成合同与自动测试只证明执行包结构和当前源码绑定，不证明岗位已批准、人工UAT已执行或员工试运行已完成；A7d、A7e、A7f保持独立外部门。

### Consequences

- TASK67最终source`ac4f294d110c2189fe363eadb41e73e9184fb656`→monitor manifest-only`c70b6bfc65f32f9e94badb2f3f2ac159130697fe`→Supervisor manifest-only`186e117cdebf2076619c75379edf4e36a1f7394a`形成30/126文件canonical链；manifest raw SHA-256为`f90a6609…eee3`/`5e2f8ba7…7254`并逐字节重放一致。
- 合同artifact/证据manifest SHA-256为`0068b8aa…6f5`/`a7900553…0fc`；专项9/9、release20/20、矩阵10/10、manifest9/9、Supervisor105/105及inventory255/231/24通过。
- 完整Supervisor初跑诚实发现旧runtime policy摘要锚点1/105失败；精确更新锚点后原断言105/105通过，旧中间bundle只保留历史价值。
- 未创建或登录账号，未连接数据库、执行UAT写、快照恢复、Migration、build或部署。业务批准与真实验收仍缺，系统继续`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝把自动测试或合成fixture标记为人工UAT PASS，拒绝事后授权、默认账号映射、空签字继续、执行人与验收人合一或把密码/Token写入证据。
- 拒绝用直接SQL删除/改写清理业务记录，用最终余额代替逐步增量，或只验证正常路径而跳过403、CSRF、幂等、CAS、半记录和审计。
- 拒绝从HEAD临时生成未提交场景、容忍TASK66摘要漂移，或让旧候选/旧bundle的证据为当前源码背书。

## D-144 UAT晋升必须由源码摘要审计与内容寻址事务链失败关闭

- 日期：2026-08-15
- 状态：`ACCEPTED / SOURCE-BOUND STATIC AUDIT VERIFIED / EXECUTOR INCOMPLETE / DYNAMIC VALIDATION BLOCKED / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK68对release lifecycle、candidate snapshot/reservation、backup/restore、Migration、Compose、postdeploy、TASK67跨岗UAT和Supervisor操作面的只读审计及专项8/8、release29/29、Supervisor105/105验证
- 确认边界：只接受仓库机器审计、失败关闭断言和后续实现顺序；不授权host、账号、凭据、备份恢复、UAT/生产、真实数据、Migration、Compose、部署或回滚

### Context

- 现有仓库分别具备candidate source snapshot、ELIGIBLE manifest、pre-deploy runtime guard、postdeploy runtime configuration与release identity，但这些独立证据不能证明同一晋升窗口中的备份、停写、Migration、部署、业务UAT和回退是一条可恢复事务。
- `release-migration-authorization.ts`仍依赖可重复环境确认；`compose.release.yml`的digest override不是部署回执；backup入口要求writer已停止但不产生promotion-bound quiesce receipt；restore入口只允许可丢弃TEST目标，不能据此声称可回退UAT。
- 直接允许root按手册串行执行会留下半完成、跨候选/跨代复用、旧证据冒充、unknown partial被覆盖及无法证明恢复目标等P0风险。

### Decision

1. 以版本化policy和确定性generator审计15个有序检查点及15个权威源码文件；artifact必须包含源码manifest、release inventory摘要、自摘要、观察事实和逐项finding。源码marker、操作集合、人工UAT状态或生成结果漂移一律失败关闭。
2. 当前只有候选快照、ELIGIBLE manifest、预部署稳定性、postdeploy配置和postdeploy identity 5项`SUPPORTED`；其余10项保持阻断（P0=9、P1=1）。任何检查点不是`SUPPORTED`时，晋升断言必须返回`UAT_PROMOTION_EXECUTOR_NOT_READY`。
3. 不得用root手工Compose、可重复环境变量、旧TEST恢复回执、旧postdeploy receipt、最终health或文档签字绕过机器阻断。失败/unknown/partial不能推进后续步骤或整体成功，也不能覆盖前代证据。
4. 环境级快照回滚必须绑定同一promotion、精确数据库与三个文件域、前代镜像/配置及回退后核验；业务更正继续使用追加式冲销/反向记录，禁止直接删表、改账或覆写已过账事实。
5. 实施顺序固定为先完成TASK69内容寻址promotion intent/history/receipt/current、一次性BEGIN/RECOVER和保全式恢复，再逐项接入snapshot/quiesce/Migration/deploy/postdeploy/UAT/rollback adapter；每关闭一项必须更新机器审计而非仅改文档状态。
6. 因Swap超过80%，Compose/隔离PostgreSQL动态验收从TASK68拆为TASK70并保持`BLOCKED`，直至资源门恢复且全部执行器依赖完成。静态/fake-root通过不构成A6、A7或生产授权。

### Consequences

- TASK68 artifact/source-manifest SHA-256为`c0a5a5619835bf82d478494ed63d2e2d68c54542634495aae93986090ad6f24d`/`eab97c64078d00ff75e0da55710e3c9b9b2b7780d996c35e5e6a7a093f9de093`；当前19个Supervisor操作中7个必需晋升/回滚操作实现0个。
- 最终source`79e4e80412fc1d2ba7a4ae19e9902f98313594e7`/tree`a756b1b05ec5027ecc7c1f9184629d601e042bd7`→monitor`84a2c78e3e664033ce1bd08d6e30de49418e0025`/tree`4de5f2472d2989694a9d7bfda4e28e25cfbbb22f`→Supervisor`1c70602282902c79066452d14fd836f868e94efb`/tree`46ec0e9a827b11d6d5d346b87f2eafab9f53ea96`形成30/126文件canonical链；manifest SHA-256为`9c1e9052…5ac39`/`56009eb7…12b5`。
- 专项8/8、release合同29/29、Supervisor105/105、inventory256/232/24和credentials 1,734文件通过；第一次完整Supervisor复跑发现旧runtime-policy摘要锚点1/105失败，精确修正后同一断言集全通过。
- 未运行build、Compose/PostgreSQL测试、Migration、镜像、快照、恢复、部署或业务写。A1—A8仍全部未授权，系统继续`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝以运维手册、shell顺序、最终health、人工备注或环境变量确认代替耐久事务、一次性授权和逐步不可变回执。
- 拒绝把TEST-only恢复器扩权解释为UAT回退已实现，也拒绝在缺少已验快照时声称“可回滚”。
- 拒绝把静态审计、fake-root或合成测试标记为真实晋升/回滚PASS，或因资源停止线而跳过动态验证。

## D-145 UAT晋升事务采用三方一次性授权、内容寻址回执链与保全式恢复

- 日期：2026-08-15
- 状态：`ACCEPTED / REPOSITORY IMPLEMENTED / BEGIN+RECOVER VERIFIED / REAL ADAPTERS AND UAT NOT AUTHORIZED / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK69对TASK68机器缺口、既有Supervisor一次性授权、内容寻址激活事务与崩溃恢复模式的实施及事务7/7、审计8/8、Supervisor108/108验证
- 确认边界：只接受仓库内promotion intent/journal、BEGIN/RECOVER和fake-root证据；不授权真实快照、writer停止、数据库、Migration、Compose、UAT、回滚、host安装或数据访问

### Context

- TASK68证明候选、ELIGIBLE manifest、预部署稳定性、postdeploy配置和identity虽各自存在，但没有一条把同一候选、数据库、恢复证据、授权和15个检查点串联起来的耐久事务；root手工顺序无法证明崩溃边界或阻止跨代复用。
- 既有Supervisor v2—v5已经形成短时一次性授权及“先持久化intent、再消费授权、再发布回执”的成熟模式，但晋升操作仍为0/7，任何直接加入真实backup/Migration/Compose都会放大partial与不可恢复风险。
- 仅保存当前状态或最终health会覆盖前代证据；仅比较当前与上一步授权又无法阻止隔步复用。恢复时删除不一致文件则会破坏事故调查和后续人工处置证据。

### Decision

1. 固定`chenyida-erp-uat-promotion-transaction-policy/v1`和15检查点顺序；intent必须绑定候选commit/tree/version、prepared candidate receipt、ELIGIBLE manifest、Web/Worker完整引用、Migration head/allowlist、当前runtime identity、精确UAT数据库、升级前actual-offhost恢复证据、授权窗口与三方actor。
2. `BEGIN_UAT_PROMOTION`和`RECOVER_UAT_PROMOTION`使用Supervisor authorization v6，最长60分钟且requester/approver/executor三方摘要互异。BEGIN必须先持久化完整intent，再消费授权，再依次发布generation/history/receipt/current。
3. generation、history、receipt、intent、recovery和quarantine采用root-only、canonical JSON、no-follow、单硬链接、内容寻址无覆盖对象并执行file/directory fsync；`current`仅为核验前代后原子替换的派生指针，不能代替不可变历史。
4. 每个checkpoint必须严格单调、绑定上一回执及同一intent/candidate/database/runtime/recovery/snapshot，并保存完整且唯一的授权摘要链。跳步、跨代、隔步授权复用、UNKNOWN/PARTIAL继续或终态猜测全部失败关闭。
5. 恢复必须使用新授权精确绑定原已消费授权和原intent；可证明的发布partial才允许收敛。源码替换、断链、hardlink/symlink、冲突或过期状态只写recovery/quarantine证据并保留原文件，不递归删除或自动宣称成功。
6. TASK69只关闭`PROMOTION_INTENT_AND_DURABLE_JOURNAL`。snapshot/quiesce/Migration/Compose/postdeploy/UAT/rollback adapter仍逐项为`NOT_IMPLEMENTED`，机器`assert-ready`在任一阻断存在时必须继续返回`UAT_PROMOTION_EXECUTOR_NOT_READY`。

### Consequences

- 机器审计由5项SUPPORTED/10项阻断收敛为6项SUPPORTED/9项阻断（P0=8、P1=1）；artifact/source-manifest SHA-256为`353abf12…5a67`/`68fd118d…1f91`，没有把仓库事务能力误报为真实UAT就绪。
- 最终source`175873ad58fe26af444e54d636722deb2009af3e`→monitor`c2d994464e208602137fc4e89d7934290a7984e7`→Supervisor`a3fbbfd01987388be919fdaa0ca506d170e93197`形成30/128文件canonical链；manifest raw SHA-256为`292d8aea…65b8`/`ff086ff7…a412`。
- 事务专项7/7、审计8/8、release合同57/57、Supervisor108/108、inventory257/233/24和credentials 1,740文件通过。未执行backup、restore、writer停止、Migration、Compose、镜像、部署、UAT或业务写。
- 下一P0为TASK71 promotion-bound recoverable snapshot adapter；TASK70继续等待执行器完整和Swap停止线解除。系统保持`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝用shell手册、环境变量确认、旧恢复readiness、最终health、可变状态文件或人工备注代替一次性授权与不可变逐检查点回执。
- 拒绝只比较原始/上一步授权而允许隔步复用，拒绝覆盖history/current、删除不一致对象、在过期窗口继续猜测partial结果或自动清空quarantine。
- 拒绝把fake-root、静态审计或BEGIN成功描述为promotion snapshot、Migration、部署、回滚、人工UAT或A6已通过。

## D-146 promotion-bound快照采用V4 actual-offhost四域绑定，writer持续停写由下一检查点独立证明

- 日期：2026-08-15
- 状态：`ACCEPTED / REPOSITORY IMPLEMENTED / SNAPSHOT CHECKPOINT VERIFIED / REAL BACKUP AND WRITER ACTION NOT AUTHORIZED / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK71对`backup-selfhost.sh`、offhost transfer、V4 readiness、policy activation、release identity和promotion journal的源码核对及Node62/62、Supervisor110/110验证
- 确认边界：只接受仓库内snapshot adapter、一次性授权、内容寻址回执和fake-root证据；不授权真实writer停止、备份、异机传输/恢复、数据库、Migration、Compose、host或UAT/生产动作

### Context

- 受控backup入口要求精确Compose Web/Worker在采集前、采集中和采集后均停止，拒绝替代writer；它采集PostgreSQL、uploads、attachments、backup_status四域，结束时只释放数据库fence，不负责重启writer。
- TASK69的BEGIN只绑定升级前既有恢复基线，不能证明本次promotion窗口产生了新快照；旧V4、TEST-only、同机、自洽重签名或跨数据库证据不能成为回滚锚点。
- 15检查点把`PROMOTION_BOUND_RECOVERABLE_SNAPSHOT`置于`WRITER_QUIESCE_RECEIPT`之前。机械换序会破坏既有审计和事务链，也无法解决“谁证明采集时已停写”与“谁证明Migration前仍停写”是两个时点的问题。

### Decision

1. 保持检查点顺序。checkpoint 5只接受V4 `ACTUAL_OFFHOST + RECOVERY_READY`中已经绑定的`EXACT_COMPOSE_WEB_WORKER_STOPPED`采集证明；snapshot adapter不停止、启动或重启writer。
2. `CAPTURE_UAT_PROMOTION_SNAPSHOT`使用与promotion ID不同、最长60分钟、requester/approver/executor互异的Supervisor v6一次性授权。snapshot intent必须在授权消费前持久化，并精确引用ordinal-4回执、原promotion intent/authorization、candidate/database/runtime/recovery baseline及当前policy activation。
3. 正向证据必须是本授权窗口内新产生、未过期、内容寻址且root-published的V4 history文件；完整生产validator同时验证V2 policy/activation、inner restore、joint transfer、cluster security、credential、tablespace、recovery final state和policy activation。fake validator只允许显式非`/`测试根。
4. promotion snapshot binding必须覆盖PostgreSQL dump、uploads、attachments、backup-status四个对象的固定文件名、SHA-256、bytes和entries，以及精确UAT deployment/database、candidate/runtime/Migration、backup/restore ID和全部恢复证明。缺域、旧证据、synthetic、same-host、cross-database或unknown/partial一律失败关闭。
5. checkpoint 5通过history→receipt→current无覆盖发布非零snapshot binding；新恢复授权精确绑定原已消费snapshot授权和intent。可证明partial才能收敛，替换、冲突、hardlink/symlink或未知状态只保全/quarantine，不删除备份、外部对象或业务数据。
6. checkpoint 6另行证明快照采集后同一Web/Worker持续停止、没有替代writer且操作责任已接续，才能进入Migration授权。TASK71完成不表示当前UAT停写、已有真实快照或A4/A6已获授权。

### Consequences

- 机器审计由6项SUPPORTED/9项阻断收敛为7项SUPPORTED/8项阻断（P0=7、P1=1）；三个必需Supervisor操作实现，artifact self SHA-256为`a7004c2e…1eae9`，`assert-ready`继续返回`UAT_PROMOTION_EXECUTOR_NOT_READY`。
- source`e8dea203547788d3cb1159adc892c1f84917457b`/tree`8c29bc22e328886773bbbe7f9689e1c55a8938c6`→monitor`7c645ab669cf37219e30623f7b4f0dbbd01d3ad7`/tree`8861d4445e9abd4cfe9a58f3aa3fe463257c750e`→Supervisor`bc339b6b1533acdd1123cebea818bc3302332440`/tree`f7fd37bd3a79d9f99ecbfc7b3151e13291710c7c`形成30/128文件canonical链；manifest raw SHA-256为`5c0ccda1…b27b`/`5889e746…cabe`。
- Node专项62/62、monitor15/15、Supervisor110/110、monitor Python14/14及inventory257/233/24通过；未执行真实备份、恢复、writer、数据库、Migration、Compose、镜像、部署、回滚或UAT写。
- 下一P0为TASK72 `WRITER_QUIESCE_RECEIPT`仓库适配器；TASK70继续等待执行器完整和Swap停止线解除。系统保持`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝把BEGIN绑定的旧恢复基线、TEST-only restore、synthetic fixture、同机副本、文件名或operator声明重新标记为promotion-bound快照。
- 拒绝只绑定PostgreSQL而遗漏三个文件域，或只比较最终readiness摘要而不绑定内层恢复、transfer、cluster/credential/tablespace和policy activation。
- 拒绝因backup入口需要停写就静默换序、让snapshot adapter自行操控当前容器，或把采集时停写证明冒充Migration前持续停写回执。

## D-147 writer持续静默只覆盖精确Compose成员，外部数据库写入方由Migration连接围栏关闭

- 日期：2026-08-15
- 状态：`ACCEPTED / REPOSITORY IMPLEMENTED / EXACT COMPOSE WRITERS VERIFIED / EXTERNAL DATABASE CLIENTS DEFERRED / NO REAL WRITER OR DATABASE ACTION / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK72对Compose labels、backup fence、release runtime、Migration入口和当前Docker metadata的只读核对及受限Node62/62、Supervisor112/112验证
- 确认边界：只接受仓库内quiesce adapter、一次性授权、内容寻址回执、fake-root证据和当前daemon精确metadata只读语法核验；不授权真实writer停止/启动、数据库、Migration、Compose、host或UAT/生产动作

### Context

- TASK71的checkpoint 5证明V4 snapshot采集时精确Web/Worker已停止，但snapshot adapter完成后只释放数据库CONNECT/read-only fence，且不会重启writer。进入Migration前必须重新证明原writer自采集结束后没有启动或被同project替换。
- Docker/Compose metadata只能枚举当前daemon中带精确project、working directory、service和deployment labels的容器。它不能证明未标注容器、其他主机进程或直接数据库client不存在；把“精确Compose成员静默”表述为“所有业务writer静默”会制造错误安全结论。
- 当前`migrate-postgres.ts`只有schema advisory lock，`release-migration-authorization.ts`仍接受可重复环境确认。advisory lock只串行Migration实例，不能排除其他业务写入连接，也不是一次性promotion授权或提交回执。

### Decision

1. checkpoint 6固定为`EXACT_COMPOSE_PROJECT_AND_WORKING_DIRECTORY_ONLY_EXTERNAL_CLIENTS_DEFERRED_TO_MIGRATION_FENCE`。它精确绑定ordinal-5 snapshot、promotion/candidate/database/runtime、Compose project/working directory和原Web/Worker完整容器/镜像身份。
2. `QUIESCE_UAT_WRITERS`使用新的最长60分钟、requester/approver/executor互异的Supervisor v6一次性授权。quiesce intent在授权消费前持久化；source在prepare前、消费前和消费后按同一inode metadata与SHA-256重验。
3. production probe固定`/usr/bin/docker`且不用shell，只接受单硬链接root-owned安全binary和有界、净化的只读metadata输出。原Web/Worker必须同ID/名称/镜像/runtime/Migration，处于stopped/exited 0、restart0/OOM false，且snapshot verify后没有重启；同project相同service出现额外或替代容器即拒绝。
4. checkpoint 6的非零`writer_quiesce_binding_sha256`覆盖snapshot后连续停止区间、两容器身份、检查时点、范围限制和授权摘要；history/receipt/current保持内容寻址、单调、无覆盖发布。
5. 恢复新授权精确绑定原已消费quiesce授权与intent。可证明partial才收敛；source替换、容器状态/身份漂移、冲突、hardlink/symlink或未知状态只保全/quarantine，不自动停止、启动或删除任何容器/证据。
6. checkpoint 7/8必须另行取得一次性Migration授权和数据库级连接/写入围栏，只允许精确Migration会话并拒绝额外client/可连接未知LOGIN角色，才能关闭本决策留下的外部writer边界。TASK72完成不表示当前UAT已停写、数据库已围栏或A6已获授权。

### Consequences

- 机器审计由7项SUPPORTED/8项阻断收敛为8项SUPPORTED/7项阻断（P0=6、P1=1）；四个必需Supervisor操作实现，artifact self SHA-256为`7085cd75…3fc`，`assert-ready`继续返回`UAT_PROMOTION_EXECUTOR_NOT_READY`。
- source`8ab249e7d265112a6130e4ffd26e278f4c6e4aed`/tree`af751336d53f7e5eb9f18c4833147f7cee1da70e`→monitor`55c1b91be010e045af485fa045bd83ea712941ff`/tree`2f5005c07532bd48b0aa08ec068c31e81a3ffed8`→Supervisor`ad98661b78e5f9fb989a7d56d78992c24592b27d`/tree`8912ce1005ebd22982fc65e0a1169ed68c4769a1`形成30/128文件canonical链；manifest raw SHA-256为`c369bc16…70eb`/`4704aad8…ab5`。
- 受限Node62/62、Supervisor112/112、monitor manifest31/31、Supervisor manifest40/40及inventory257/233/24通过；当前四个UAT容器仍running，未执行真实writer、数据库、Migration、Compose、镜像、部署、回滚或UAT写。
- 下一P0为TASK73 checkpoint 7/8一次性Migration事务适配器；TASK70继续等待执行器完整和Swap停止线解除。系统保持`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝把容器名、一次`running=false`、exit 0、restart 0或operator声明单独当作持续静默；也拒绝让quiesce adapter隐式执行stop/start/restart。
- 拒绝把同project容器检查扩写成对未标注容器、其他Docker daemon、主机进程或数据库client的全局证明。
- 拒绝用Migration advisory lock或可重复环境变量补写checkpoint 6范围；外部writer与一次性执行必须由后续数据库围栏和promotion-bound Migration回执独立证明。

## D-148 Migration批准与数据库执行使用独立一次性授权且批准检查点禁止SQL

- 日期：2026-08-15
- 状态：`ACCEPTED / REPOSITORY APPROVAL CHECKPOINT VERIFIED / SQL EXECUTION FAILS CLOSED / DATABASE FENCE DEFERRED TO TASK74 / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK73对Migration runtime、release authorization、角色/secret、`schema_migrations`、数据库围栏和promotion journal的源码核对及Node37/37、Supervisor9/9验证
- 确认边界：只接受仓库内批准intent、一次性授权、内容寻址checkpoint 7回执和fake-root证据；不授权数据库连接/围栏、Migration SQL、CONNECT/role/ACL、Compose、host或UAT/生产动作

### Context

- TASK72只证明精确Compose Web/Worker自snapshot后持续静默；未标注容器、其他主机和直接数据库client仍须数据库级围栏。该围栏只能在精确Migration session存在的执行窗口建立和重验，批准时无法诚实证明。
- promotion journal要求每个检查点的授权SHA唯一且完整保留授权摘要链。若checkpoint 7批准和checkpoint 8执行共用一份授权，既违反防重放不变量，也无法区分“同意执行”与“已经建立围栏并执行SQL”。
- 旧`release-migration-authorization.ts`的环境变量确认可重复，不能形成一次性promotion执行权；现有advisory lock只能串行Migration实例，不能排除业务writer或证明提交回执。

### Decision

1. 原TASK73的checkpoint 7/8范围拆分。TASK73只关闭`ONE_TIME_MIGRATION_AUTHORIZATION`；checkpoint 8 `MIGRATION_COMMIT_RECEIPT`由TASK74使用新的独立执行授权完成。
2. `AUTHORIZE_UAT_PROMOTION_MIGRATION`使用Supervisor authorization v6，最长60分钟且requester/approver/executor摘要互异。批准intent必须先于授权消费持久化，并精确绑定ordinal-6、promotion/quiesce/candidate/runtime/database、current/target head、allowlist、Migration角色及四个权威source。
3. checkpoint 7只发布`execution_scope: APPROVAL_ONLY_NO_SQL_NO_DATABASE_FENCE`及非零`migration_authorization_binding_sha256`。history/receipt/current保持内容寻址、单调、无覆盖；授权SHA不得被后续检查点复用。
4. 受控release evidence存在时，Migration入口必须在创建数据库pool和运行任何SQL前调用执行adapter；adapter未实现或证据不完整时固定返回`MIGRATION_SUPERVISOR_EXECUTION_ADAPTER_NOT_IMPLEMENTED`。可重复环境变量和测试client不得旁路该门。
5. TASK74必须使用独立`RUN_UAT_PROMOTION_MIGRATION`授权，持久化执行intent，证明精确数据库client/session/role与CONNECT/read-only围栏、逐文件提交、最终reconciliation和不可覆盖checkpoint 8回执。
6. checkpoint 7恢复只收敛可证明的history/receipt/current发布partial；source替换、过期、冲突、hardlink/symlink或未知状态保全/quarantine，不连接数据库、不执行SQL、不释放writer。

### Consequences

- 机器审计由8项SUPPORTED/7项阻断收敛为9项SUPPORTED/6项阻断（P0=5、P1=1）；五个必需Supervisor操作实现，artifact self SHA-256为`ed37e980…e520`，`assert-ready`继续返回`UAT_PROMOTION_EXECUTOR_NOT_READY`。
- source`32860b86be13cab880b5cf0cd8e9cfb255956809`/tree`b950a29944c48a73be78bab730f252b6f5ccf9c4`→monitor`18b93e90ecd8f90b084d82596f847e7651aec6ee`/tree`a5967c5bfbe853bb322bb77a11eadecd6a495f33`→Supervisor`302661c5d49722c6c4b4bcfe18749417e3688e52`/tree`0a05618b217878c9dd71bb0226bebfb16f5e4a78`形成30/128文件canonical链；manifest raw SHA-256为`59ea1084…7c0`/`090c3a23…800`。
- 受限Node37/37、Supervisor9/9、monitor14/14、installer17/17及targeted lint/compile/syntax/credentials/diff门通过；未执行真实数据库、Migration、writer、Compose、镜像、部署、回滚或UAT写。
- 下一P0为TASK74 checkpoint 8数据库执行与提交回执；TASK70继续等待执行器完整和Swap停止线解除。系统保持`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝让批准与执行共用授权SHA、让批准adapter隐式连接数据库，或把operator声明/环境变量/advisory lock视为数据库围栏。
- 拒绝因为执行adapter未实现就让legacy production路径继续创建pool；受控证据存在时必须在SQL和连接之前失败关闭。
- 拒绝把fake-root、测试client、checkpoint 7回执或Migration最终head描述为真实数据库围栏、提交回执、A6通过或UAT已迁移。

## D-149 checkpoint 8采用独立短时执行grant，数据库围栏保持到部署接管且未知结果只保全不重跑

- 日期：2026-08-15
- 状态：`ACCEPTED / REPOSITORY FENCED MIGRATION COMMIT ADAPTER VERIFIED / DYNAMIC DATABASE VALIDATION DEFERRED / NO REAL DATABASE OR UAT ACTION / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK74对checkpoint 7批准、Migration runner、PostgreSQL角色/ACL/session、CONNECT/read-only fence、`schema_migrations`、promotion journal及恢复责任的源码核对，以及受限Node120/120、Python57/57验证
- 确认边界：只接受仓库内execution intent/grant、fake-root、模拟数据库/Docker adapter、内容寻址checkpoint 8回执与负向门；不授权真实数据库连接/围栏、Migration SQL、CONNECT/role/ACL、Compose、host或UAT/生产动作

### Context

- checkpoint 7只表达一次性批准，不能证明执行时数据库client、角色和ACL仍满足released基线，也不能证明任何SQL提交。批准授权SHA若被执行复用，会破坏逐检查点单次消费和完整授权摘要链。
- 每个Migration文件独立事务意味着故障可能发生在零文件、部分文件、全部文件但结果未落盘或结果已落盘但journal未发布。仅看最终head会把“已经精确提交”和“未知部分提交”混为一谈，自动重跑可能扩大事故。
- checkpoint 8完成后新Web/Worker尚未建立。此时恢复数据库CONNECT或启动writer会在checkpoint 9之前留下未受控写窗口；因此Migration成功不能等同于围栏释放。

### Decision

1. `RUN_UAT_PROMOTION_MIGRATION`使用与checkpoint 7不同的Supervisor v6一次性授权，窗口最长15分钟，requester/approver/executor摘要互异。execution intent和内容寻址grant必须先于授权消费落盘，精确绑定ordinal-7、approval receipt/binding、promotion/candidate/runtime/database/snapshot/quiesce、current/target head、完整allowlist、Migration/control角色及Supervisor bundle。
2. production入口只接受固定Supervisor派生grant和精确release artifact目录。源root、manifest及每个文件必须root-owned、单硬链接、无symlink、权限/bytes/SHA受限，目录identity在复制前后相同；环境变量和测试client不能形成真实执行权。
3. 任何业务SQL前先重验精确Compose writer静默、released数据库/system identifier/OID/marker、9角色、5 LOGIN、4 membership、数据库ACL/owner privileges、唯一platform superuser、零额外backend/unknown CONNECT。只有这些基线完全一致才设置default-read-only、收紧CONNECT/connection limit并建立只允许精确Migration会话的数据库围栏。
4. Migration容器必须使用manifest绑定的worker digest、固定network/mount/user/read-only/capability/resource/label，并由operation+grant唯一识别。SQL lexer拒绝顶层BEGIN/COMMIT/ROLLBACK等事务控制；每文件单事务、commit前deadline/身份/ledger复核，成功后核对完整有序`schema_migrations`摘要和围栏，数据库最终seal为`allow_connections=false`、connection limit 0。
5. checkpoint 8回执绑定before/after fence、engine result、每文件outcome、最终ledger、approval receipt、execution grant及授权摘要链，并按history→receipt→current无覆盖发布。active fence在checkpoint 9显式交接或同operation恢复/quarantine解决前保持，其他Supervisor操作全部失败关闭。
6. 超时/恢复先对精确数据库执行emergency seal，再按operation+grant唯一label定位候选并stop→kill→退出证明。已消费未执行、部分提交、全部提交但结果/回执未知、身份/head/checksum/fence漂移或发布冲突只保全/quarantine；禁止down SQL、猜测重跑、自动释放writer、删除未知容器或事故证据。

### Consequences

- 机器审计由9项SUPPORTED/6项阻断收敛为10项SUPPORTED/5项阻断（P0=4、P1=1）；6/8必需Supervisor操作实现，artifact/source-manifest SHA-256为`e4aa3687…e2fc`/`53a1515a…4239`，`assert-ready`继续返回`UAT_PROMOTION_EXECUTOR_NOT_READY`。
- source`ce7bb230974ac2f7d50ff16b751a5f99915f9d7a`/tree`f5043439aaaecf885305dccda6fc9e9cf82b3909`→边界修正`5610a0db8adadc04cae6f0b239c1fcd7a1e9bc1a`/tree`26edea69c120c7f2d3977d40aab971cf2a90f4e0`→Supervisor manifest-only`52242f826b542456ee22bae55dcc0b83c746dfea`/tree`6a20ec8fe44238a438401bdf15f777b22df6f47b`形成130文件canonical链；manifest raw SHA-256为`17efe85d…aad5`。
- 受限Node120/120、Python57/57及inventory258/234/24通过。Swap停止线下未运行typecheck、全量测试、PostgreSQL或Docker动态执行；该范围归TASK70，不能由静态证据冒充。
- 下一P0为TASK75 checkpoint 9一次性Compose部署与active fence交接；TASK70继续等待执行器完整和Swap停止线解除。系统保持`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝复用checkpoint 7授权、把环境变量/advisory lock/最终head/进程退出0当作执行权或提交回执。
- 拒绝在角色/ACL/session基线未知时先修改数据库，或只靠单次`pg_stat_activity`、容器名、operator声明证明全局围栏。
- 拒绝把多文件Migration包进一个不可恢复大事务、允许迁移文件自行控制事务，或对未知部分提交自动重跑/down。
- 拒绝在checkpoint 8成功后立即恢复CONNECT、启动writer或删除Migration容器/证据；围栏必须由checkpoint 9或同一operation恢复路径显式接管。

## D-150 checkpoint 9只替换精确Web/Worker并以数据库围栏交接和双结果回执提交

- 日期：2026-08-15
- 状态：`ACCEPTED / REPOSITORY COMPOSE DEPLOYMENT RECEIPT VERIFIED / DYNAMIC VALIDATION DEFERRED / NO REAL DEPLOYMENT OR DATABASE ACTION / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK75对release Compose、checkpoint 8 active fence、旧/新四服务身份、数据库handoff、postdeploy合同及partial恢复的源码核对，以及Node61/61、Python50/50验证
- 确认边界：只接受仓库内deployment intent、一次性授权、可注入Compose/database adapter、内容寻址result/transfer/checkpoint 9回执和fake-root证据；不授权真实Compose、数据库围栏交接、容器、镜像、网络、Volume、host或UAT/生产动作

### Context

- checkpoint 8成功后数据库保持主动围栏；仅有Migration完成和新镜像digest不能证明新Web/Worker已按精确Compose身份启动、健康且可安全取得writer责任。
- Compose project可能同时包含PostgreSQL、Caddy、网络和四个持久Volume。允许root手工`up`、隐式build/pull或整项目recreate会扩大影响范围，也无法把实际替换对象绑定到promotion授权。
- 部署可能在单服务创建、启动、health、数据库handoff、result、transfer或journal发布之间崩溃。仅看当前容器或退出码会把未知partial误判为成功并可能错误释放数据库。

### Decision

1. checkpoint 9使用独立最长15分钟的`DEPLOY_UAT_RELEASE` Supervisor v6授权；requester/approver/executor互异，精确绑定ordinal-8、promotion/candidate/runtime/database/snapshot、Migration receipt/result/active fence、eligible manifest、Web/Worker digest、Compose project/working directory和三份权威部署source。
2. deployment intent及精确旧/新容器计划必须先于授权消费和任何Docker变化落盘。production只接受Supervisor派生的单次消费输入；环境变量、手工Compose、旧授权SHA或测试注入不能形成实际回执。
3. adapter只允许精确Web/Worker执行`create --no-build --pull never --force-recreate --no-deps`。PostgreSQL、Caddy、project/network、四个受保护Volume及其完整inspect基线必须前后相同；镜像、labels、mount、network、user和runtime配置全部来自manifest/合同。
4. checkpoint 8 active fence在两个新容器都通过身份、digest、启动、health及runtime configuration独立验证前不得交接。database handoff是显式单一阶段；失败必须先emergency seal且不得留下未知writer窗口。
5. deployment result与active-fence transfer分别内容寻址、不可覆盖并互相绑定；journal随后按history→receipt→current发布checkpoint 9。回执绑定旧/新容器、保护面、数据库交接、执行授权和完整前代链。
6. 恢复只从精确result+transfer继续发布；malformed/partial/漂移先seal数据库并只停止精确operation+authorization候选，随后保全/quarantine。不得猜测重跑、删除未知容器/证据或自行恢复数据库writer。

### Consequences

- 机器审计由10项SUPPORTED/5项阻断收敛为11项SUPPORTED/4项阻断（P0=3、P1=1）；7/8必需promotion operation已实现，artifact/source-manifest SHA-256为`881ca1cf…c7119`/`b6f01c11…a98c`，`assert-ready`继续拒绝。
- feature source`d383c105eef1b3f718105faa7a9d1fa6516ebd4e`/tree`d900fd6b849a3c254209cc93865cabe82b72c7af`→bundle cap fix`c6c4864dc99afb9c2bbb2c4b164e1f1e2beff5ee`/tree`2627d383699005e58c58b4dae6c8880e11fa84e7`→manifest-only`86be6d4b139e6626067a6a1782a3636d076f058a`/tree`006c230976d8dd985394b59a7b0965f90b2e1a51`形成132文件canonical链；manifest raw SHA-256为`249d28fe…3071`。
- 受限Node事务/部署35/35、跨岗/manifest/审计26/26、Python50/50及inventory258/234/24通过；Swap停止线下未运行Compose、PostgreSQL、build或全量测试，动态范围仍归TASK70。
- 下一前置任务TASK76把现有postdeploy runtime configuration和identity工具接入promotion checkpoint 10/11的逐授权不可变事务链；final receipt、人工UAT和rollback仍阻断。系统保持`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝整项目`compose up`、隐式pull/build、按容器名猜测替换或把Caddy/PostgreSQL/Volume一起纳入部署授权。
- 拒绝在任一新服务身份/health未知时释放数据库、把一次health或退出0当作checkpoint 9，或在partial后盲目重跑Compose。
- 拒绝把fake-root回执描述为实际UAT已部署、数据库已交接或回滚能力已存在。

## D-151 checkpoint 10/11在发布前持久绑定Supervisor外部控制摘要且未知postdeploy状态只保全

- 日期：2026-08-15
- 状态：`ACCEPTED / REPOSITORY POSTDEPLOY CHECKPOINT 10/11 TRANSACTION VERIFIED / PREPUBLICATION CONTROL BINDING VERIFIED / NO REAL DEPLOYMENT OR DATABASE ACTION / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK76对checkpoint 9 result/transfer、runtime configuration probe、strict postdeploy identity、promotion journal、Supervisor runtime和partial恢复责任的源码核对，以及Node/Python轻量专项与只读攻击复核
- 确认边界：只接受仓库内postdeploy intent、独立一次性授权、Supervisor受信runtime、不可变control binding、内容寻址result/checkpoint 10/11回执和fake-root证据；不授权真实Compose、数据库、容器、postdeploy、host或UAT/生产动作

### Context

- TASK75完成checkpoint 9后，两个独立postdeploy工具虽能生成runtime configuration和runtime identity证据，但未进入同一promotion授权摘要链；独立成功不能证明其使用相同deployment result、active-fence transfer、manifest和四服务身份。
- 若Supervisor只在postdeploy工具完成并发布结果后再比较外部期望摘要，结果发布与journal消费之间存在不可接受的交叉核对窗口；恢复还可能在缺失或多份binding时猜测应采用哪个结果。
- legacy shell wrapper选择宿主Node且子进程不属于Supervisor统一process group，无法为超时、失败containment和进程清理提供单一责任边界；`.publish.tmp`若被视为普通临时文件也会掩盖identity部分发布。

### Decision

1. checkpoint 10和11分别使用`VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION`与`VERIFY_UAT_POSTDEPLOY_IDENTITY`两个不同的Supervisor v6一次性授权。各自intent在消费前落盘，并绑定同一promotion、精确前代、checkpoint 9 receipt/result/transfer、manifest、Compose身份、四服务/runtime policy和三方actor。
2. postdeploy执行只使用Supervisor持有的受信Node runtime；子进程进入独立process group，失败或超时按TERM→最多30秒→KILL收敛，并写入阶段化containment/anomaly与全局interlock。
3. 只有Supervisor发起的原始postdeploy execute可以接收外部control digest。journal在任何history/receipt/current发布之前必须持久化单一、不可变、自摘要的`postdeploy-control-bindings`并复核结果；缺失、不匹配、重复或不同binding全部失败关闭并在恢复时保全/quarantine。
4. checkpoint 10/11均按history→receipt→current无覆盖发布并保持完整授权摘要链；checkpoint 11完成后promotion仍为`IN_PROGRESS`，不得越过未执行的checkpoint 12人工跨岗UAT。
5. source替换、过期、链接异常、跨promotion/deployment、runtime漂移、未知result和`.publish.tmp`均按partial处理。失败保全checkpoint 9 result/transfer、postdeploy结果和事故证据，不猜测重跑、删除容器、修改数据库或伪造成功。

### Consequences

- feature source`8c7d51c09b058d66ebd509338f8f325d6ed7fb73`/tree`49ac3a2cc347dc92690f1c3d4f6ca48c0e48f10e`→prepublication binding fix`2309927b9354a1449fb298119df6611574668cab`/tree`ddae09547b1740c313bf9de6eee96b6d731297a1`→Supervisor manifest-only`694f485cad3a6e9fbdc499c10cc801f0de77cafe`/tree`45007b67fb606bd423043d769efefd12acc67ab7`形成134文件canonical链；manifest raw SHA-256为`ccb0e462…f03d`。
- promotion journal40/40、Python launcher/UAT37/37、postdeploy17/17、audit/cross-role18/18、release gate/manifest29/29、installer/generator18/18及inventory258/234/24通过；最终只读复核未发现仍可复现的P0/P1/P2。
- 机器审计仍为11项SUPPORTED、4项阻断：人工checkpoint 12、final checkpoint 13和rollback 14/15；`assert-ready`继续拒绝。下一安全前置为TASK77把跨岗证据合同接入checkpoint 12事务，实际员工执行仍需专项授权和业务输入。
- Swap持续超过80%，未运行build、全量测试、Compose/PostgreSQL、Migration、backup/restore、镜像、部署或回滚。系统保持`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝让checkpoint 10/11复用同一授权、让工具自行选择Node/runtime，或以退出0、路径名、旧probe、单次health和operator声明代替精确promotion binding。
- 拒绝在结果发布后才首次比较外部摘要、允许多份binding择一、用current存在推断前置binding已提交，或在未知partial时自动重跑postdeploy。
- 拒绝把fake-root结果、checkpoint 11仓库回执或静态SUPPORTED描述为actual postdeploy、人工UAT、final receipt或可投产结论。

## D-152 checkpoint 12采用预签名全局证据主题与最终结果双摘要且内部落盘后仅恢复journal

- 日期：2026-08-15
- 状态：`ACCEPTED / REPOSITORY CROSS-ROLE CHECKPOINT 12 TRANSACTION VERIFIED / HUMAN EXECUTION NOT PERFORMED / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK77对TASK67跨岗合同、TASK66授权矩阵、checkpoint 11、逐步结构化证据、三方签字、Supervisor全局联锁及partial恢复的源码核对，以及Node/Python轻量专项和独立只读攻击复核
- 确认边界：只接受仓库证据合同、独立一次性摄取授权、内容寻址result、不可变intent/history/receipt/current及fake-root合成fixture；不授权或声称真实员工账号、业务写、人工签字、UAT/生产、数据库、部署或回滚已发生

### Context

- 签字如果直接包含最终`result_sha256`会形成哈希循环，因为最终结果自身包含签字及其摘要；若只按每条workflow局部完成时间允许签字，早期workflow还可能在后续workflow证据产生前签署一个声称覆盖全局的主题。
- TASK67静态模板只定义所需步骤与证据来源，不能表达实际逐请求结果、数据库delta、audit/idempotency/CAS、账号人员映射和签字，也不能冒充人工已执行。
- 外部cross-role staging在原始摄取时必须未过期且精确source-bound；但一旦相同raw/logical SHA的受信只读副本已同步进入promotion内部results，崩溃恢复继续依赖外部路径会把可恢复journal误送quarantine。

### Decision

1. checkpoint 12使用独立`VERIFY_UAT_CROSS_ROLE_EXECUTION` Supervisor v6一次性授权。cross-role intent必须先于授权消费落盘，精确绑定checkpoint 11、promotion/candidate/database/runtime/snapshot/Migration/deployment/postdeploy身份、Supervisor bundle、TASK67合同、TASK66矩阵、外部result raw/final SHA和三方Supervisor actor；人工执行授权必须与摄取授权及既有authorization chain不同。
2. 每条workflow的全部步骤、control和追加式reversal先完成。系统从所有workflow的执行证据计算唯一`evidence_subject_sha256`，该主题排除所有签字、workflow封装摘要和signoff完成时间；所有执行人、观察人和业务验收人只能在全局`execution_completed_at`之后签署同一主题。
3. 签字加入后再计算各`workflow_evidence_sha256`与最终`result_sha256`。因此`evidence_subject_sha256`明确表示“签名前精确执行payload”，`result_sha256`明确表示“含全部签字的最终封装”；checkpoint 12只发布后者，同时响应暴露两者及approval subject供审计，不得把两种摘要互换或声称签字循环绑定自身。
4. 外部result首次摄取必须通过root marker、owner/mode、单硬链接、source identity、canonical、窗口、actor/approval及完整内容验证。内部`results/<operation>.<result_sha256>.json`同步成功后，恢复只使用该精确raw SHA副本、不可变bundle合同和checkpoint 11 current；外部staging删除、替换或窗口届满不得触发人工UAT重跑。
5. checkpoint 12按internal result→history→receipt→current无覆盖发布并保持`IN_PROGRESS`。全局Supervisor pending-intent联锁在提交前只允许精确原操作或精确恢复；未知、冲突或内部副本不匹配只保全/quarantine。

### Consequences

- feature source`018586d8e2ecf36bbe773f8bb7e1e8754c9f620b`/tree`e7da71065ab1effdded1fbf74b5a72a27d68b25e`→manifest-only`2798862ebdd7df85748a0a69d6b3ddeea765d808`/tree`2c74e6b0e110d28e345588c79060d8ff29ab9c1e`形成138文件canonical链；manifest raw SHA-256为`d5398d78854fcec0d9a8339a7eb4be7a0e5d722904e530b5afed0a55d1cb2ce2`。
- 机器审计由11项SUPPORTED/4项阻断收敛为12项SUPPORTED/3项P0阻断；checkpoint 13与rollback 14/15仍缺失，`assert-ready`继续拒绝，静态cross-role readiness仍为`HUMAN_CROSS_ROLE_UAT_NOT_EXECUTED`。
- Node组合62/62、journal cross-role4/4、Python UAT29/29、launcher/installer31/31、manifest定向4/4及inventory259/235/24通过；内部result后的external remove/replace/expiry恢复已有组合测试。
- Swap持续超过80%，未运行build、全量测试、Compose/PostgreSQL、Migration、backup/restore、镜像、部署、真实UAT或回滚。系统保持`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝让签字直接循环引用包含自身的最终摘要、让早期workflow在后续证据产生前签全局主题，或把任意evidence digest、空签字、占位批准ID和同人多账号冒充验收。
- 拒绝把TASK67静态模板、合成fixture、Supervisor操作者声明或checkpoint 12仓库回执描述为真实员工已执行。
- 拒绝在内部result已持久化后因外部staging清理而重跑业务动作；也拒绝在内部副本不存在或不匹配时绕过外部source复验。

## D-153 checkpoint 13只从完整单调前代链聚合并以独立授权提交终态

- 日期：2026-08-15
- 状态：`ACCEPTED / REPOSITORY PROMOTION CHECKPOINT 13 FINAL RECEIPT VERIFIED / ACTUAL HUMAN UAT NOT PERFORMED / ROLLBACK 14/15 OPEN / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK78对checkpoint 1—12前置、ordinal 4—12事务回执、授权链、Migration/deployment/postdeploy/cross-role结果、Supervisor全局联锁和bundle切换的源码核对，以及Node/Python轻量专项与独立只读攻击复核
- 确认边界：只接受仓库/fake-root内容寻址finalization、不可变intent/history/receipt/current及合成证据；不授权或声称真实员工UAT、数据库、Compose、部署、回滚、备份恢复或生产动作已发生

### Context

- checkpoint 12仍为`IN_PROGRESS`，且其evidence存在预签名`evidence_subject_sha256`与含全部签字的最终`result_sha256`两种摘要。最终回执若只看current或任意非零摘要，可能跳过历史回执、拼接跨promotion证据或把未签名主题误当人工验收结果。
- finalization落盘后、current切换前允许出现本操作唯一可计算的history/receipt staged文件；恢复必须只忽略这一个精确目标，不能放宽目录校验或把其他未知文件视为合法partial。
- Supervisor bundle切换如果只检查运行入口而不检查pending finalization intent，可能让已消费授权但未提交的终态事务失去精确恢复代码。

### Decision

1. checkpoint 13使用独立`FINALIZE_UAT_PROMOTION`一次性授权，最长15分钟且请求人、批准人、执行人不同。finalization intent必须先于授权消费内容寻址落盘，授权不得复用promotion开始、checkpoint 4—12或人工UAT执行授权。
2. journal必须从同generation的canonical generation/history/receipt/intent/result逐份重建ordinal 4—12链。检查点严格连续、前代COMMITTED、时间单调、promotion expiry稳定、authorization chain严格追加；candidate/database/runtime/snapshot/writer/Migration/deployment binding必须连续且非零。
3. checkpoint 12 evidence必须等于内部cross-role最终`result_sha256`，并与其intent、人工执行授权、预签名主题及批准主题一致；不得用`evidence_subject_sha256`、静态模板状态或任意重签外壳代替。
4. final intent聚合九份receipt/evidence/intent摘要、既有九份authorization摘要和全部前代binding。checkpoint 13再追加独立finalization授权，按history→receipt→current无覆盖发布`PROMOTION_FINAL_RECEIPT / COMMITTED`；同一结果可幂等读取，其他冲突失败关闭。
5. 三个发布failpoint仅能用新的精确恢复授权续写。恢复只排除由intent和前代计算出的唯一目标history/receipt文件；source替换、链漂移、未知partial或摘要不一致必须保全/quarantine。Supervisor全局pending联锁及installer bundle-switch联锁同时阻断未完成finalization。
6. finalization明确记录rollback checkpoint 14/15仍为`NOT_IMPLEMENTED`，不释放数据库/备份保护、不赋予UAT/生产执行权，也不把仓库COMMITTED回执解释为actual员工UAT已完成。

### Consequences

- feature source`c39caad889b31c03cdacca4be8c6947bc9ad4339`/tree`f4deb34e4ed7d0799a75f66ae345d57cf4c29f0c`→manifest-only`1baa01a829e9475f21ed01493d4bbbde2a318955`/tree`e3e6b435703fcdc16466444b6cbb91fe1c840698`形成138文件canonical链；manifest raw SHA-256为`7dd7a83cd2619e113ccc1793b43eda55ccebc7e491a7c4471c7ac82c4dd591c3`。
- 机器审计由12项SUPPORTED/3项P0阻断收敛为13项SUPPORTED/2项P0阻断；只剩rollback checkpoint 14/15，`assert-ready`继续以`UAT_PROMOTION_EXECUTOR_NOT_READY`拒绝，人工readiness仍为`HUMAN_CROSS_ROLE_UAT_NOT_EXECUTED`。
- Node轻量组合111/111、Python Supervisor65/65、inventory259/235/24、bundle逐字节重放、generator/语法/JSON/敏感/diff门通过。首次journal 47/48暴露精确staged回执恢复缺口，修复后定向1/1及完整48/48通过，未降低断言。
- Swap持续超过80%，未运行build、全量测试、Compose/PostgreSQL、Migration、backup/restore、镜像、部署、真实UAT或回滚。系统保持`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝只凭ordinal 12 current、操作者声明或单个result摘要直接提交终态，也拒绝复用既有授权、跨promotion/generation拼接或允许时间/expiry倒退。
- 拒绝把预签名subject、静态TASK67模板、fake-root fixture或仓库checkpoint 13描述为真实员工验收或actual UAT晋升。
- 拒绝用宽泛目录白名单恢复partial、覆盖current、删除未知证据或在恢复中重跑UAT/Migration/Compose/postdeploy；也拒绝让bundle切换绕过pending finalization。

## D-154 checkpoint 14/15采用精确前代分阶段回退、独立postverify授权且unknown永不自动重跑

- 日期：2026-08-15
- 状态：`ACCEPTED / REPOSITORY ROLLBACK CHECKPOINT 14/15 CONTROL PLANE VERIFIED / RUNTIME ADAPTER AND REAL ROLLBACK ABSENT / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK79对checkpoint 13、promotion-bound四域快照、前代镜像/运行配置、数据库围栏、postdeploy identity、TEST-only恢复器和Supervisor授权/恢复边界的源码核对，以及Node/Python轻量专项与只读团队复核
- 确认边界：只接受仓库/fake-root/可注入无副作用adapter中的内容寻址回退控制平面；不授权或声称真实数据库、Volume、Compose、UAT/生产回退、数据恢复或业务冲销已发生

### Context

- checkpoint 13的`COMMITTED`只证明仓库final receipt事务完成，不能自动赋予回退权；数据库、uploads、attachments、backup_status、前代Web/Worker和运行配置必须共同回到同一个promotion前代，任一对象漂移都不能发布成功。
- 外部restore或切换发生后若进程在result落盘前崩溃，自动重跑可能重复rename、覆盖目标、再次切换卷或容器；仅凭最终对象看似正确也不能反推出第一次动作的授权、输入和结果。
- 生产runtime adapter尚无受信实现。若先消费授权再发现工具缺失，就会把一次性授权耗尽在没有任何可执行路径的事务中，也可能诱使operator绕过Supervisor手工回退。

### Decision

1. checkpoint 14使用独立短时`ROLLBACK_UAT_RELEASE`授权，checkpoint 15使用另一份`VERIFY_AND_FINALIZE_UAT_ROLLBACK`授权；两者不得复用checkpoint 13、人工UAT或彼此的授权。execution package绑定promotion/generation、checkpoint 13、精确前代、四域snapshot、数据库、Web/Worker digest、Compose、运行配置、三方actor和最多2小时执行期限。
2. checkpoint 14固定九个有序阶段。每阶段必须先耐久写入canonical intent、复核全部immutable source，再调用唯一adapter并落盘typed result；数据库策略限定为staging恢复后受控rename且保留candidate quarantine，文件域限定新命名volume/目标后切换，Web/Worker限定精确前代digest。禁止down SQL、直接删表改账或自动业务冲销。
3. 生产adapter preflight必须在授权消费前成功；当前adapter文件故意不存在，因此真实入口失败且授权保持pending。只有fake-root测试可注入无副作用adapter，不能将该路径解释为UAT能力。
4. checkpoint 15固定十三项postverify，重新绑定数据库/四域摘要、Migration head、Caddy/PostgreSQL/Web/Worker身份、runtime configuration、strict identity、health和保护对象。全部typed check result精确闭合后才按history→receipt→current提交`ROLLED_BACK`，不得复用旧postdeploy/finalization回执。
5. 任一stage/check处于intent-only、结果不完整、source替换、摘要冲突或journal要求`QUARANTINE`时，RECOVER只能调用containment并保全证据；即使外部对象看似完成，也不得自动重跑或发布成功。全局pending-intent与installer bundle-switch在checkpoint 15前持续阻断。

### Consequences

- feature source`1015b53ec1e0c90cc1ed4e9761255c204ad866f4`/tree`d8dc52cb0b88a1c4f3cdad505a3131924b99afa1`→manifest-only`cd9c9dee3bcf6aa859f177c699b754a129e2c54f`/tree`e6f035b180ab4be8f1613268b3f5e745ced05cac`形成141文件canonical链；manifest raw SHA-256为`e635792db65107d165d443325b1b70c15b325a499fb145dc404df07e2ce4645d`。
- 机器审计15项checkpoint全部`SUPPORTED`，但执行仍被runtime adapter缺失、隔离UAT回退演练缺失和人工跨岗UAT缺失三项条件阻断（P0=2、P1=1）；artifact/source-manifest SHA-256为`cc12d613…56187`/`74893a76…39605`，`assert-ready`继续返回`UAT_PROMOTION_EXECUTOR_NOT_READY`。
- journal52/52、release contract83/83、审计/跨岗21/21、Python Supervisor71/71、manifest9/9及inventory260/236/24通过。定向ESLint在192MiB V8 heap下退出134，未提高heap；内核`oom_kill`仍为2，四服务restart0/OOMKilled false。
- 下一P0为TASK80受信rollback runtime adapter；TASK70继续等待该adapter完成及Swap≤80%后才能运行合成Compose/隔离PostgreSQL动态验收。没有真实UAT、数据库、Volume、备份恢复、部署或回滚动作，系统保持`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝用root手工命令、TEST-only恢复器、旧备份路径、最终health或operator声明代替受信adapter、逐阶段result和精确postverify。
- 拒绝在授权消费后才做runtime preflight、让checkpoint 14/15共用授权，或以同一stage/check名称覆盖旧结果。
- 拒绝在unknown/partial时猜测重跑、删除证据、直接回退Migration或改写已过账业务事实；也拒绝把15/15静态SUPPORTED描述为真实回退已验或可投产。

## D-155 回退运行时采用内容寻址root受信gateway与有界可审计containment刷新

- 日期：2026-08-15
- 状态：`ACCEPTED / TRUSTED ROLLBACK RUNTIME GATEWAY VERIFIED / FIXED EXECUTOR AND ACTIVATION ABSENT / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK80对cluster recovery、四域restore、Compose deployment、postdeploy probe、identity工具和TASK79执行包的逐项核对，以及Node/Python轻量专项和数据/运行安全只读复审
- 确认边界：只接受仓库/fake-root中的受信gateway、运行观察和containment控制；不授权或声称固定executor已安装/激活、真实数据库/Volume/Compose/UAT回退、数据恢复或人工UAT已发生

### Context

- TASK79只固定了Supervisor控制平面，生产adapter故意不存在。直接把root脚本路径或operator命令接入控制器，会使被替换的路径、继承环境、自由参数、daemon化子进程或不完整运行观察获得不可审计的回退权。
- unknown/partial发生后，writer、数据库、candidate volume或容器可能在PROBE与CONTAIN之间变化。仅写最终contain结果会丢失每次尝试的输入、观察与因果关系，并诱使恢复逻辑对新对象执行旧intent。
- 当前仓库已有TEST-only恢复/部署工具，但它们的目标、权限、幂等和真实UAT前置并不等价。gateway源码存在也不能证明固定executor、host activation或隔离动态演练已完成。

### Decision

1. runtime gateway只接受Supervisor生成的newline-terminated canonical JSON，精确绑定runtime plan、execution package、intent、operation/generation、action/label、deadline、activation、executor、Docker、deployment identity及所有source摘要。协议或摘要漂移在授权消费/外部动作前失败。
2. activation、executor、Docker与source必须位于root-owned且不可组/全局写的父链，打开后复核device/inode/mode/owner/size/SHA；executor通过`/proc/self/fd`启动，Docker及source只以继承descriptor manifest传入。环境、argv、超时、输出和process group均固定，路径swap-back、子孙/daemon残留或超限输出均失败并收敛。
3. 每次运行观察必须完整列出Compose project全部成员与writer inventory，且unexpected writer不得复用任何已知服务container ID；数据库、Caddy/PostgreSQL/Web/Worker、active volumes、retained candidate volumes、derived targets及保护对象均须精确且自摘要。
4. unknown/partial containment最多三次。每次先无覆盖发布包含attempt序号及前一intent/receipt摘要的intent，再执行PROBE→CONTAIN→PROBE并写内容寻址attempt receipt；before drift、`STALE_INTENT`、after drift、refresh拒绝或非法contain响应都必须留下receipt，下一状态不得伪造为contained。
5. 重试只允许停止同一ledger已知或观察到的新Web/Worker writer；数据库identity、Caddy/PostgreSQL、active/retained candidate volumes、derived targets和保护对象必须跨attempt不变。candidate数据库与四域只保全，不自动删除、覆盖、重建或猜测重跑。
6. 本任务不实现或激活固定executor。正式gateway在executor/activation缺失时继续失败；下一任务TASK81独立实现固定executor和content-addressed activation合同，TASK70随后仍须在资源门允许时完成隔离Compose/PostgreSQL动态演练。

### Consequences

- feature source`dff6793959d0cf0ac14d8bf3d84a2be53b8b037c`/tree`71fb080f77b337f5414ba14baed9d333d18862c4`→manifest-only`3509a71848d682153c18e139617def56132e4890`/tree`c7d063db001978aea711c9bd29dc2338c72d9c6d`形成145文件canonical链；manifest raw SHA-256为`b3ecdf114009531332e3e19c25d9a20fdb5b80e550cb07ef97906f4b8f8ab7e5`。
- runtime contract9/9、Python gateway17/17、containment定向11/11、Python Supervisor/installer59/59、发布链Node48/48、manifest20/20和inventory261/237/24通过；cross-role/audit artifact SHA-256为`8532ee92…f1e79`/`ee87cbf9…5cc94`。
- 机器审计仍为`BLOCKED`，固定executor/activation、隔离回退演练和人工UAT三项条件未满足，`assert-ready`继续返回`UAT_PROMOTION_EXECUTOR_NOT_READY`。静态/fixture证据不能替代actual checkpoint 8—15或真实回退回执。
- 收口available约1.3GiB、Swap813/1024MiB、根盘约12GiB，宿主`oom_kill=2`无任务内增量；未运行全量lint/build、Docker/Compose/PostgreSQL、Migration、backup/restore、部署、真实UAT或回退。系统保持`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝直接执行路径名、shell、operator自由argv/env，或只在exec前校验一次而不使用打开descriptor及返回后复核。
- 拒绝只观察Web/Worker而遗漏同project成员、unexpected writer、数据库/Volume/保护对象，或允许未知writer复用Caddy/PostgreSQL等已知container ID。
- 拒绝无限重试、覆盖旧intent/result、用新观察改写旧attempt，或在漂移后仍称contain成功；也拒绝自动删除candidate数据库/Volume以“清理”unknown状态。
- 拒绝把gateway存在、15/15静态SUPPORTED、fake-root containment或当前bundle描述为固定executor已激活、真实回退已验或可投产。

## D-158 资源停止线不得以低PSI或扩大Swap绕过，先释放Codex运行时并只清理BuildKit cache

- 日期：2026-08-16
- 状态：`ACCEPTED / BUILDKIT-ONLY REMEDIATION COMPLETE / POST-CLEANUP RESOURCE GATE VERIFIED / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK83进程/cgroup只读归因、两段60秒稳定窗口、Docker容量摘要和低资源保护规则
- 确认边界：2026-08-16只确认压力来源与恢复顺序；项目负责人于2026-08-21另行专项授权仅执行一次精确BuildKit命令，仍不授权kill/restart、Swap/内核/systemd/Docker daemon修改、其他prune、镜像/容器/卷删除或任何UAT/生产/数据动作

### Context

- TASK82收口后Swap约85.2%，超过不可放宽的80%硬线；根盘约11GiB，仅高于10GiB最低值约1GiB，无法安全启动隔离PostgreSQL、Compose、候选build或完整发布门。
- 两段60秒窗口的memory PSI为0、OOM不增且Swap基本稳定，说明不是当前持续失控；但长期驻留的Codex session约317MiB Swap/2.01GiB memory，Docker/四ERP容器也持有大量历史换出页。低PSI不能证明重任务启动后仍安全。
- BuildKit约10.79GB、其中private至少约7.87GB可回收；Docker同时把13.81GB镜像和380.1MB卷标为部分reclaimable，但这些可能包含历史回退/证据镜像或受保护边界，不能随缓存一并删除。

### Decision

1. Swap使用率≤80%继续作为独立硬门；不得用PSI=0、60秒增长低、available暂时高于768MiB或服务healthy替代。
2. 最低业务影响的内存恢复先由项目负责人从客户端重启长期Codex运行时。当前智能体不得自行kill，因为无法保证任务回复、状态持久化或自动重连；不得为释放Swap重启ERP、PostgreSQL、Docker daemon或其他systemd服务。
3. 磁盘恢复只允许在专项授权后执行一次`docker builder prune --force --filter until=24h`，目标限于超过24小时未访问且标记reclaimable的BuildKit cache。cache可重建，执行前后必须验证有引用镜像、容器和四个受保护卷集合未变。
4. 明确禁止`docker system prune`、image prune、volume prune、镜像/容器/Volume删除，以及清理`/root/.codex`、日志或用户文件。
5. `swapoff/swapon`在当前约1GiB available下可能把约848MiB换出页压回RAM并跌破768MiB；增加Swap只稀释比例而掩盖压力。两者均拒绝作为当前恢复方案。
6. 重连和BuildKit-only清理后重新完成60秒资源门。仅当available≥768MiB、Swap≤80%、60秒Swap增长≤256MiB、根盘>10GiB、Load/OOM/restart/health均通过，TASK70才能从BLOCKED转DOING；任何一项失败继续停止。

### Consequences

- TASK83转DONE后，TASK84曾登记为`BLOCKED / OWNER-SIDE CODEX RUNTIME RESTART + BUILDKIT-ONLY CLEANUP AUTHORIZATION REQUIRED`；该历史阻断已由2026-08-21专项授权、唯一一次清理、对象复核和清理后门解除。
- 两段稳定窗口和进程/cgroup/Docker容量证据进入治理文档；未创建临时资源，未修改host、服务、Swap、Docker对象、数据库或Volume。
- 系统继续`PRODUCTION NO-GO`。即使TASK84解除资源门，也只允许进入TASK70隔离动态验证，不自动获得A1—A8、真实数据、UAT/生产或切换授权。

### Implementation progress

- 2026-08-21原样执行唯一一次`docker builder prune --force --filter until=24h`，退出0、回收475MB；Build Cache由192项/10.79GB变为174项/10.31GB，active保持0。
- 容器/镜像/Volume数量6/75/277及三组集合SHA-256前后一致；四ERP服务ID、镜像、restart0/OOM false、Web/PostgreSQL health和四个受保护Volume均不变。
- 清理后约60秒窗口最低available约1.82GiB、Swap最高3.14%且增长约1.16MiB、根盘最低约10.39GiB、Load1最高1.51、PSI/OOM增量0。TASK84转DONE，TASK70仅获得隔离合成动态验证准入；根盘上界和每任务资源门继续强制。

### Rejected alternatives

- 拒绝因“Swap只是冷页”而修改80%阈值，或在available尚未触线时抢跑重任务。
- 拒绝用重启PostgreSQL/Worker/Docker、清理所有reclaimable镜像/卷或全局prune换取资源余量。
- 拒绝让当前智能体自行终止Codex进程并假定会自动重连，也拒绝未授权执行BuildKit删除。

## D-157 UAT回退能力采用逐副作用耐久回执与派生身份，仓库handler不得解除动态能力阻断

- 日期：2026-08-16
- 状态：`ACCEPTED / REPOSITORY HANDLERS AND FAKE-ROOT VERIFIED / DYNAMIC PG17 AND HOST ACTIVATION BLOCKED / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK82三路只读复核、固定executor/runtime gateway边界、PostgreSQL与四文件域恢复语义、前代运行面激活及201项轻量fake-root回归
- 确认边界：只确认仓库固定handler、物化规则和失败关闭证据；不确认或授权host安装/激活、真实数据库/卷读取、restore、Compose、UAT/生产回退或人工UAT

### Context

- TASK81已能内容寻址安装fixed executor，但catalog只声明能力名称；若handler只在单一终态写receipt，外部副作用提交后进程崩溃会留下无法区分“未执行”与“已提交未回执”的窗口，自动重试可能重复restore、数据库rename或服务激活。
- PostgreSQL、uploads、attachments和backup_status不能原地覆盖active/candidate；回退运行配置也不能被错误要求等于历史前代配置摘要。postverify若复用预激活事实，会把服务启动后的session、ACL、Migration或identity漂移遗漏。
- 当前宿主Swap持续超过80%，且仓库没有可信host activation或隔离PG17双rename证明。把源码存在直接解释成`SUPPORTED`会绕过资源、运行身份和真实副作用边界。

### Decision

1. 九个stage和十三个check各自使用固定schema、固定FD、固定argv及PREPARE/EXECUTE/PROBE/CONTAIN协议；禁止shell、自由路径、自由SQL、自由环境扩展和operator tag。
2. 幂等身份至少绑定`action`与`execution_mode`。每个外部副作用先持久化intent和started，再逐项写不可覆盖receipt；terminal必须绑定完整有序receipt集合。receipt前缀、timeout、signal、daemon、输出越界或身份漂移一律typed UNKNOWN并保全。
3. commit-before-receipt不得盲目重放。数据库switch只在当前layout精确为`NEW_SEALED`且OID/marker与restore intents一致时补写`RECOVERED_COMMITTED`；release unseal只在精确`NEW_RELEASED`时恢复。观察摘要必须非零并进入追加链。
4. PostgreSQL restore只物化新staging身份；switch从独立管理库以一个显式事务执行`active→quarantine`和`staging→active`，并在操作前拒绝连接、prepared transaction、OID/name/marker漂移。PG17事务、锁和故障窗口必须由TASK70动态证明，不能仅依赖文档或mock。
5. uploads、attachments、backup_status只恢复到与active/candidate均不重叠的新卷；内容摘要、条目、owner/group/mode、目录及隔离读写探针必须同时闭合。backup_status历史快照不得成为回退后当前actual-offhost就绪证明。
6. 前代Web/Worker只接受execution package固定的完整registry digest及已验证本机content identity；禁止pull、build、latest和任意tag。Caddy、PostgreSQL容器、网络和受保护卷必须不变。历史`predecessor_runtime_configuration_sha256`与派生`rollback_runtime_configuration_sha256`分别绑定。
7. postactivation必须重新读取数据库内容、完整46项Migration ledger、live ACL/default privileges、角色、session、数据库/服务identity和layout；writer session仅允许Web 0—10、Worker 0—4且unexpected为0，不能复用preactivation证据。
8. 卷helper镜像证据必须绑定source labels、archive config、SBOM、固定漏洞政策、受信且稳定的Trivy数据库树、零漏洞和跨阶段资源门。没有外部registry锚点或Trivy数据库更新回执时明确记录限制，不得提升为正式证据。
9. catalog继续`BLOCKED_MISSING_UAT_CAPABLE_HANDLERS`，直到隔离动态证明、内容身份和host activation全部闭合；activation publisher、gateway、Supervisor、机器审计及fixture不得以仓库文件存在解除阻断。

### Consequences

- feature source`c2f071ce474460e2be7aa3e0911a34fcfe948f08`/tree`3e262bd047f76747c4822f5f12322db170dbb90f`→manifest-only`aa777324b08d06a27b1ade72a01d8d850b9a1688`/tree`a734aa13e4cb732ffc3726b56e9a62d82c34f3d0`形成156文件canonical链；manifest raw SHA-256为`3674e01121b09bf11014f1bcc68fd9743c4d2b60f340aa9f3089731d46c235fb`。
- inventory为262/238/24；最终轻量组合201/201、manifest后installer21/21、生成制品self/source/inventory链、语法、敏感信息和diff门通过，数据/应用/运维三路复核均未发现残留P0/P1。
- 收口available约1.2GiB、Swap897/1024MiB、根盘约11GiB，宿主`oom_kill=2`无任务内增量；四服务running、Web/PostgreSQL healthy、restart0/OOM false。未运行Node全量、build、Docker/Compose/PostgreSQL、Migration、backup/restore、部署、真实UAT或回退。
- TASK82仓库范围完成，但TASK70仍受资源停止线和动态证明阻断。下一任务TASK83只读归因资源；系统继续`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝以单一终态receipt、control层dangling intent或“幂等命令”猜测副作用结果，也拒绝在UNKNOWN后自动重放restore、rename、unseal或service activation。
- 拒绝覆盖active/candidate卷、复用TEST-only目标、把旧backup_status当新就绪证据，或让派生运行态伪装成历史前代哈希。
- 拒绝因fake-root、静态catalog、源码摘要或当前容器healthy而跳过隔离PG17/文件域动态演练、host activation和人工UAT。

## D-156 固定回退执行器先闭合身份与激活事务，缺少UAT能力处理器时不得消费授权

- 日期：2026-08-16
- 状态：`ACCEPTED / FIXED EXECUTOR BOUNDARY AND ACTIVATION V2 VERIFIED / UAT-CAPABLE HANDLERS ABSENT / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK81对九阶段/十三检查、现有TEST-only恢复工具、gateway trusted descriptor、Supervisor授权及installer切换联锁的逐项核对，以及Node/Python fake-root专项回归
- 确认边界：只接受仓库/fake-root中的固定executor、activation v2和失败关闭能力声明；不授权或声称host已安装/激活、UAT-capable restore handler、真实数据库/Volume/Compose/UAT回退或人工UAT已发生

### Context

- TASK80 gateway已能安全启动一个受信executor，但固定路径缺失；若直接指向现有TEST-only恢复器，就会绕过其TEST目标限制并把合成能力错误提升为UAT执行权。
- executor和activation升级跨越多个内容寻址对象。只覆盖一个`current`或软链接会在崩溃后留下无法判定的plan/executor代际，且可能使新bundle读取旧执行器或旧授权。
- 真实UAT数据库、四文件域和前代运行面物化器仍未实现；静态catalog完整不等于这些能力存在。授权必须在能力检查成功前保持未消费。

### Decision

1. 固定catalog锁定九个stage和十三个check的handler、tool、argv、source、timeout、idempotency及unknown策略；无shell、无自由路径/参数，TEST restore和前向Compose控制明确禁止。catalog状态固定为`BLOCKED_MISSING_UAT_CAPABLE_HANDLERS`，后续只能由独立任务实现专用能力后提升。
2. fixed executor只接受gateway newline-terminated canonical request和trusted-FD manifest v2，精确复核operation/action/label/deadline、plan/intent/source、activation/current/executor/Docker及打开描述符身份。当前在全部验证完成后稳定返回`ROLLBACK_FIXED_EXECUTOR_UAT_CAPABILITY_UNAVAILABLE`，不得执行外部工具。
3. activation v2采用content-addressed intent/executor/plan/history/receipt/current/alias/recovery对象；install、upgrade、rollback都追加generation而不覆盖历史。七个已知发布崩溃点只允许同一精确recovery intent加fresh authorization续写，未知partial或外来alias保全并阻断。
4. Supervisor v7为ACTIVATE/ROLLBACK/RECOVER分别使用短时、精确bundle/executor/plan绑定授权。prepare在能力缺失时返回`BLOCKED_CAPABILITY_UNAVAILABLE`且不创建activation state、不消费授权；未来支持路径只能在prepare成功与commit之间消费。
5. installer在切换bundle前验证activation intent/history/receipt/current/alias/recovery的精确字段、代际、内容身份和链关系；任一partial、extra field、alias/current漂移或未闭合rollback必须失败关闭。
6. 下一任务TASK82独立实现UAT-capable handler与物化边界；TASK70仍须等待这些能力完成且资源停止线解除后，才能运行合成Compose/隔离PostgreSQL动态演练。

### Consequences

- feature source`57f1f4aa78b80d7fd4d1bcbd16916340a29a65d4`/tree`ea4a53b08e68d84eed9386b57ac00d9777429e5f`→manifest-only`7a1ef5619c4fd5258f0e3acd40d0979c92217993`/tree`cf81fb7b8f22456f329a2feeae5a60ff8d7b6d37`形成149文件canonical链；manifest raw SHA-256为`bd8cf7c381f3581f649161980e163920e3a04054bebf81ff28a43fc21d903fc1`且逐字节重放一致。
- inventory为262/238/24；Node合同80/80、transaction journal71/71、Python installer/launcher/adapter56/56、manifest9/9及installer21/21通过。跨岗与晋升审计self-digest为`47eff0cc…78a8`/`6c3cdceb…29b5`。
- 机器审计仍为`BLOCKED`，P0继续包含UAT能力/host activation和隔离回退演练，P1为人工跨岗UAT；`assert-ready`继续拒绝。当前固定executor是安全边界，不是可执行UAT回退能力。
- 收口available约1.4GiB、Swap832/1024MiB、根盘约12GiB，宿主`oom_kill=2`无任务内增量；未运行build、Docker/Compose/PostgreSQL、Migration、backup/restore、部署、真实UAT或回退。系统保持`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝把TEST-only restore、现有前向Compose controller、operator shell或自由argv重标为UAT handler，也拒绝以catalog条目或fixture通过声称能力已存在。
- 拒绝覆盖activation current/alias、复用过期原授权恢复、猜测未知partial，或在能力检查前消费一次性授权。
- 拒绝因15个checkpoint静态SUPPORTED、固定executor已进bundle或fake-root激活成功而移除动态回退与人工UAT阻断。

## D-159 TASK70动态证据分离仓库能力、隔离证明、host激活与真实UAT，首版只允许PARTIAL_ONLY

- 日期：2026-08-21
- 状态：`ACCEPTED / VERSIONED DYNAMIC EVIDENCE CONTRACT VERIFIED / FIRST PG CASE PENDING / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据TASK70三条只读审计、TASK82固定handler边界、单临时容器与低资源保护规则，以及版本化policy/verifier和17项失败关闭测试
- 确认边界：只接受仓库与隔离合成证据；不授权或声称host安装/激活、真实UAT/生产、受保护Volume/备份读取、数据恢复/迁移、员工验收或切换已发生

### Context

- TASK82源码中固定handler已实现但生产catalog仍故意失败关闭。若把“代码存在”“隔离case通过”“host已激活”和“真实UAT回退成功”合并成一个布尔值，任何局部测试都可能错误放行高权限回退入口。
- 当前最多允许一个任务临时容器，完整Compose演练需要多个同时运行的服务，不能在该资源规则下被诚实声明为已覆盖。首个可安全动态切片只能是一个全tmpfs PostgreSQL 17容器。
- 生产opcode字面量必须继续要求UAT候选marker，但本任务实际执行目标只能是TEST隔离cluster；两种身份若不显式区分，合成fixture可能被误报为真实UAT证据。

### Decision

1. 审计分别记录仓库handler能力、隔离动态证据、host activation、真实UAT回退和人工跨岗UAT。任何一项不得从其他项推断；当前固定为4个执行阻断（动态、host、真实UAT回退、人工UAT）。
2. 动态policy v1固定`ISOLATED_SYNTHETIC_ONLY / TEST / PARTIAL_ONLY`，只列`DV70-PG-SWITCH-01`。即使该case通过，也不得清除动态总阻断、host/真实UAT/人工UAT阻断或声称TASK70/生产就绪。
3. 首case只验证现有executor生成的`PG_RB_ATOMIC_SWITCH_V1`机制：原样成功切换、重复执行失败关闭、前置漂移拒绝、首rename故障事务回滚、COMMIT响应丢失后只读判定且不重放。dump、Migration、ACL、文件域、Compose及九阶段/十三检查整体均不在证明范围。
4. 运行只使用本机已有固定摘要PG17镜像；禁止build/pull/network/Volume，rootfs只读，PGDATA/socket/temp使用精确UID/GID/mode和有界tmpfs。宿主最坏磁盘增量固定≤64MiB，启动前根盘必须满足10GiB硬线再加该上界。
5. receipt必须绑定源码、版本、Migration head、镜像与Docker身份，记录至少60秒Swap、180秒Load停止线、OOM/restart、全局容器/镜像/Volume、四保护卷、四服务以及精确任务对象清理；任何类型、摘要、权限、时序、资源或对象漂移均失败关闭。
6. 生产base spec中的UAT marker只作为opcode fixture；actual target guard必须同时证明TEST隔离cluster、本机local-only、无真实凭据/端点、无受保护Volume挂载。六项non-claim进入artifact并由verifier逐字节要求。

### Consequences

- 新policy/verifier、审计状态拆分及篡改/弱化测试通过；审计保持`BLOCKED`，artifact self-digest`b6b3c244…58d4b`，`assert-ready`稳定返回`UAT_PROMOTION_EXECUTOR_NOT_READY`。
- 两份生成器与17/17专项测试在一个断网只读Node容器内通过；容器、镜像、Volume和四服务指纹前后一致，任务零残留。未运行PostgreSQL、Compose、Migration、恢复、部署或真实UAT。
- TASK70继续为唯一`DOING`，下一切片按本决策运行`DV70-PG-SWITCH-01`。完成该case后仍只能发布`VERIFIED_PARTIAL_ONLY`证据。

### Rejected alternatives

- 拒绝因handler源码存在而把catalog标为ready，或因一个隔离PG case通过而删除动态、host、真实UAT或人工UAT阻断。
- 拒绝在单容器硬规则下把模拟依赖或顺序启动描述为完整Compose；也拒绝挂载现有服务socket、数据库或受保护Volume以缩短测试。
- 拒绝允许自由镜像tag、pull/build、宽泛临时目录清理、仅记录最终资源快照，或用operator声明替代源码/对象/清理收据。

## D-160 TASK70第二个数据库case先绑定完整Migration状态与精确生产回执，恢复语义不得超出实际故障模型

- 日期：2026-08-21
- 状态：`ACCEPTED / V3 SOURCE VERIFIED / ISOLATED DYNAMIC ARTIFACT PENDING / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据两条独立跨语言/fixed-executor终审、现有生产handler与V2证据边界、低资源单容器规则及Python/Node专项回归
- 确认边界：只接受仓库源码和后续隔离合成PG17证据；不授权或声称dump/Volume、真实备份恢复、fresh-process恢复、host activation、UAT/生产、受保护数据、员工验收或切换已发生

### Context

- D-159首个case只证明原子双rename机制，未把46项Migration、角色/ACL/default privileges、内容摘要和生产fixed executor真实执行回执放在同一证据链中。原计划直接命名为`DV70-PG-RESTORE-02`会把“staging数据如何由dump/Volume物化”与“已物化数据库如何受守卫切换及恢复”混为一谈。
- fixed executor此前只能返回语义evidence；producer若在执行后自行重建argv/stdout，会留下“声称执行内容”与实际子进程调用不一致的空间。observer若默认启用，又会改变全部生产路径的内存、失败或敏感信息边界。
- 旧的“commit response loss”“crash recovery”措辞可能被误读为传输层COMMIT ACK丢失或进程终止后的新进程恢复，而当前可安全合成的模型实际是同一进程内调用方丢弃已完成结果、runtime重建和副作用后异常。证据必须精确命名，不得外推。
- artifact以hardlink无覆盖发布时，link成功后的unlink、目录fsync或metadata失败可能留下本任务最终路径与临时硬链并阻断重试。失败清理必须证明inode所有权，不能用宽泛目录清理解决。

### Decision

1. 原`DV70-PG-RESTORE-02`拆分。当前case命名为`DV70-PG-GUARDED-SWITCH-02`，只验证完整46项Migration/权限/内容状态上的守卫切换和一次性恢复；dump及四文件Volume恢复继续作为独立未证明边界，不因本case通过而关闭。
2. policy v3固定唯一case、全部46项Migration source、9个受管角色、4项membership、canonical relation/large-object content report、runtime privilege来源和历史V2五文件字节冻结。任何source、ledger、角色、ACL/default privilege、内容或安全摘要漂移都必须在rename前拒绝。
3. `ClosedDockerRunner`只增加可选且默认`None`的完成态observer；默认生产路径不得为observer额外哈希/copy stdin或回调。仅隔离V3 runner注入observer，并且只能在stdin发送完成、stdout/stderr读到EOF、子进程退出且无遗留daemon后形成回执。
4. 每次受观察调用绑定精确argv、固定env、stdin presence/bytes/SHA、timeout、maximum output、side-effect、return code、原始stdout/stderr及daemon state。V3必须得到固定1—9序列；Node独立重建SQL/argv/env/limits/输出和回执自摘要。副作用后observer异常按`SIDE_EFFECT_OUTCOME_UNKNOWN / AFTER_SIDE_EFFECT`处理，不得假定失败或重放。
5. 恢复场景只允许：OLD布局的一个耐久恢复attempt；attempt结果unknown时不得第二次重放；NEW_SEALED调用方丢弃已完成delegate结果时不得重放。artifact必须显式记录`same-process runtime reconstruction`、`in-process exception after durable reservation`及`caller-discarded completed result`，并非fresh-process或transport-level证明。
6. SQL压缩只接受单一mtime=0 canonical gzip member；artifact读取要求root-owned `0400`、普通文件、单硬链接及稳定inode/mtime/ctime。整件负向harness必须在每次mutation后合法重算assertion evidence、case和artifact摘要，使拒绝原因落在被测语义而非陈旧上层哈希。
7. 资源样本必须同时绑定monotonic elapsed与UTC wall clock，最大漂移1.5秒；容器创建晚于≥60秒前检，总窗口≥180秒。只允许一个断网、只读rootfs、全有界tmpfs且无bind/Volume/build/pull的既有固定摘要PG17容器。
8. artifact发布过程中记录本次创建文件的device/inode；任一后链接失败只删除精确临时/最终路径中仍匹配该inode的普通root文件并fsync目录。外来或身份不匹配路径必须保留并失败关闭，禁止宽泛删除。
9. V3 source先以独立提交完成测试、敏感信息检查和`recovery-private/main`普通fast-forward；只有clean source才能执行动态producer。最终artifact仍最多为`PARTIAL_ONLY`，且必须再经Node verifier与独立整件篡改harness；通过后TASK70也不得自动转DONE。

### Consequences

- V3源码验收为Python16/16与129/129、Node13/13、受影响合同108/108、release29/29、inventory263/239/24；两条独立终审P0=0/P1=0。首次drop-all Node容器的35个EACCES被证明为夹具需要覆盖`0440`文件及chown reader GID，离线容器仅增加`DAC_OVERRIDE`/`CHOWN`后108/108，不降低断言。
- V2五文件SHA-256保持`888e8da9…6308`、`a62db066…2c3`、`43de9dc9…5b01`、`fe9932e2…c6b8`、`8e7b9c65…f91`；V3 policy raw SHA-256为`9245a099…dc22`，release inventory/runtime policy为`c4775f60…6485`/`8f6fb710…85d2`。
- 当前没有V3动态artifact，因此状态只能是`SOURCE READY / DYNAMIC RUN PENDING`。系统继续`PRODUCTION NO-GO`；UAT alpha.42/0040和四个受保护Volume均未访问或修改。

### Rejected alternatives

- 拒绝用一个“restore”case同时声称dump物化、Migration、权限、guarded switch、进程恢复和Volume恢复；也拒绝因完整Migration fixture存在而称其为真实数据试迁移或恢复。
- 拒绝在fixed executor调用外重建一份“推定执行回执”，或让observer默认启用、在子进程结束前回调、吞掉回调异常、记录自由环境/敏感正文或在UNKNOWN后重放。
- 拒绝将same-process runtime重建描述成进程崩溃恢复，将调用方丢弃返回值描述成PostgreSQL传输层COMMIT ACK丢失，或以这些合成证据解除host/真实UAT/人工UAT阻断。
- 拒绝用rename覆盖artifact、宽泛glob/rmtree清理失败发布，或为追求可重跑而删除身份不明的路径。

## D-161 fixed executor撤销ACL后必须显式恢复owner，tablespace只在fresh synthetic fixture物化

- 日期：2026-08-21
- 状态：`ACCEPTED / OWNER ACL CORRECTIVE SOURCE VERIFIED / CLEAN DYNAMIC RETRY PENDING / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据第二次TASK70隔离PG17失败回执、只读首差异诊断、两条独立Python/Node与PostgreSQL ACL审计及定向回归
- 确认边界：只修改仓库fixed executor和全新合成cluster fixture；不授权连接或修改UAT/生产、受保护Volume、真实备份、业务数据、host配置或运行服务

### Context

- `dv70-aazofvib`已完成60秒前检、PG17.10启动和baseline物化，但在rename前由security state守卫失败关闭；`dv70-mz485olk`只读诊断将首差异固定为database ACL item count实际4、期望5。
- fixed executor先对owner、`CURRENT_USER`、`pg_database_owner`及service endpoints执行REVOKE，再只恢复4个service group。对象owner仍有PostgreSQL隐式权限，但`aclexplode`状态中缺少合同要求的显式owner aclitem，因此不能与canonical Node reconciler生成的期望状态相等。
- tablespace是cluster-global对象，不能由针对单一staging database的生产reconciler修改；但全新合成cluster必须建立与版本化runtime policy一致的可观测初始ACL，否则测试夹具会把自身差异误报为生产executor缺陷。

### Decision

1. fixed executor在全部REVOKE后、任何service grant前显式恢复owner权限：database、schema、all tables、all sequences、394个routine及6个standalone type，共404条`GRANT ALL PRIVILEGES`。routine按声明owner映射到migration owner或`CURRENT_USER`，standalone type映射到`CURRENT_USER`。
2. 不向生产reconciliation SQL加入任何tablespace GRANT/REVOKE；既有forbidden token测试继续锁定该边界。custom tablespace仍不由该opcode创建、删除或授权。
3. 仅TASK70 fresh synthetic PG setup对`pg_default`和`pg_global`执行`GRANT ALL PRIVILEGES ... TO CURRENT_USER`，并先逐字段验证policy恰为两项built-in、零custom、`PLATFORM_OWNER`、零service privilege；Python和Node必须生成完全相同的setup bytes及摘要。
4. security parser、期望ACL计数和漂移断言保持不变，不把4改成5以外的弱化值，也不忽略owner。动态producer只有在修复形成clean提交、敏感门通过并普通快进到private main后才可重跑。

### Consequences

- reconciliation normalized SHA-256更新为`067255c7e6b319dbea1660bebca1b3259bb6e61363f5818ec88f226fc99ce339`；V3 policy raw/canonical为`e62b16ccd7b4d0228f07c31a35a3f49085cfa7c0888f029812b24d12e81a5e4d`/`90188fadc024e62912c5c6cfc85e97f254757ee274aba1e8bb55bd2c6e951d12`。setup为2,538 bytes、SHA-256`919ec37296b6d65b3ddb33ba4ba3c8f4cf8f9b6d5883a762a7af56e9c4cfd626`。
- 定向Python V3 16/16、fixed executor 129/129、Node V3 13/13、release 29/29及inventory263/239/24通过；当前修复后的受影响合同必须按inventory实际集合在clean source上串行验证，D-162随后确认当前组合为110项。
- 两次失败run及一次诊断run均无artifact、任务容器、tmp根或进程残留；系统仍为`PRODUCTION NO-GO`，本决策不关闭dump/Volume、fresh-process、host activation、真实UAT、人工验收或正式切换阻断。

### Rejected alternatives

- 拒绝修改security parser、忽略owner aclitem或把期望count降为4来适配错误输出；也拒绝把PostgreSQL owner隐式权限误当作显式ACL状态已经相等。
- 拒绝在生产staging reconciliation中修改cluster-global tablespace，或把合成fixture的tablespace物化外推为UAT/生产权限变更。
- 拒绝在dirty source上直接重跑、手改artifact、跳过受影响完整合同组合，或因rename尚未发生而忽略此次安全守卫失败。

## D-162 冻结动态证据按artifact绑定Git blobs验证，当前审计manifest仍按当前源码生成

- 日期：2026-08-21
- 状态：`ACCEPTED / HISTORICAL SOURCE BINDING CORRECTIVE SOURCE VERIFIED / CLEAN DYNAMIC RETRY PENDING / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据d7ce clean-source 110项回归的四个失败、V2 artifact source bindings、现有Git ancestry投影、两条独立只读安全审计和audit20/20+110/110复验
- 确认边界：只修正仓库审计读取历史证据的source时态并重生成审计文件；不改五个冻结V2文件，不授权或执行UAT/生产、数据库、Volume、真实备份、host或部署动作

### Context

- V2 artifact由c793源码生成并绑定14个source path的SHA-256与Git blob。后续V3和D-161合法修改inventory、runtime policy、fixed executor及测试；若当前audit把历史artifact与当前文件正文组合，冻结verifier必然返回`TASK70_DYNAMIC_SOURCE_BINDING_MISMATCH`。
- `loadTask70DynamicRepositoryInputs()`已经从artifact commit验证tree、HEAD祖先关系及每个`commit:path` blob，但此前同时返回当前工作树的source bodies。Git projection正确不等于正文时态正确。
- 当前UAT promotion audit本身必须反映最新inventory、handler与控制平面；若把其全部source manifest回退到c793，又会掩盖当前仓库漂移。历史动态证据验证与当前能力审计必须使用两个明确source map。

### Decision

1. 五个冻结V2 producer/verifier/audit-test/policy/artifact保持字节不变，不重新生成、不修改校验语义。历史artifact仍只声明`VERIFIED_PARTIAL_ONLY`。
2. 当前audit loader在V2 artifact存在时，使用已由artifact commit派生的严格顺序`source_blobs`，通过固定`/usr/bin/git cat-file blob <40hex>`读取14个历史正文；只有artifact SHA仍精确等于loader最初读取值时才使用该map。
3. synthetic、tamper或调用方替换的artifact SHA不同，继续使用caller/current bodies，使既有负向测试落在被测语义而非被历史map掩盖。当前audit的45文件source manifest、capability和release inventory检查始终读取当前工作树。
4. Git子进程禁止shell、replace refs、lazy fetch、交互prompt和用户/system config；固定PATH/locale/TZ、5秒timeout、2MiB maxBuffer及fatal UTF-8。path、顺序、重复和object格式先验证；冻结V2 verifier随后必须重算每个SHA-256、Git blob SHA-1及commit/tree/ancestor。
5. 任一Git、blob、UTF-8、大小、摘要或projection异常都进入`dynamicEvidenceLoadError`并生成`INVALID_FAIL_CLOSED`，不得fallback到当前正文后把历史artifact标为有效。

### Consequences

- 当前audit generator SHA-256为`66c83fa5157e6b5a076088da63090efc74d46e9e4628633c2e8d52e1e5839cfd`；重生成audit semantic/raw/Markdown/source-manifest SHA-256分别为`6aa3f2bf7f593f0cb0ea4f472f518bac1335a17e23efb1c94cb267c72147a4a3`、`de3a5b49c6fe96c618b9bf46c61becb61f5d5bbe5288398ef045adea5a8257d6`、`53418ec4088bb364448aabe329cc8af8d18b5972546b788254e87c7d07232bbb`、`758044cf645ecdc6bf8b8593d835f19c2e713a7e71a9b6d9d76e5a8ead45fbf2`。
- audit继续PASS但BLOCKED：4 blockers、P0=3、P1=1、`may_start=false`。audit20/20、clean-source110/110、V3 13/13、release29/29及inventory263/239/24通过，两条只读终审P0=0/P1=0。
- 冻结V2五文件SHA继续为`888e8da9…6308`、`a62db066…2c3`、`43de9dc9…5b01`、`fe9932e2…c6b8`、`8e7b9c65…f91`。如果未来历史source path从当前工作树彻底删除，冻结loader会先失败关闭；支持path删除需要新的非冻结读取入口，不在本修复范围。
- 系统仍为`PRODUCTION NO-GO`；本决策不关闭V3 dynamic artifact、dump/Volume、fresh-process、host activation、真实UAT、人工验收或切换阻断。

### Rejected alternatives

- 拒绝修改或重生成冻结V2文件，也拒绝把历史artifact直接与current bodies比较后将预期失败视为无害。
- 拒绝把当前audit manifest整体回退到c793，或仅按artifact自报path读取当前文件；两者都会混淆历史证据真实性与当前能力状态。
- 拒绝自由Git argv、shell、replace refs、网络lazy fetch、无大小/超时边界读取，或在历史blob读取失败后fallback并继续标记动态证据有效。

## D-163 TASK70 SQL证据按content类型与精确动态槽位归一，重复路径使用有界摘要

- 日期：2026-08-21
- 状态：`ACCEPTED / SQL NORMALIZATION CORRECTIVE SOURCE VERIFIED / CLEAN DYNAMIC RETRY PENDING / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据clean run`dv70-nc3x52ls`、三次隔离诊断、完整448行报告双实现重放和独立跨语言安全复核
- 确认边界：只修改TASK70 V3合成证据producer/verifier、policy、测试和发布摘要链；不修改五个冻结V2文件，不授权或执行UAT/生产、真实数据、受保护Volume、真实备份、host、Migration部署或服务变更

### Context

- D-162提交`63c301f`完成敏感门并普通快进到private main后，`dv70-nc3x52ls`通过60秒资源门与隔离PG17启动，但在发布artifact前由`TASK70_V3_SQL_NORMALIZATION_INVALID`失败关闭，且任务容器、tmp根、进程和artifact均为0。
- 旧算法对任意连续64位小写hex做全局摘要替换和残留拒绝。完整content report中的relation/sequence identity本身是可超过64位的UTF-8 hex；其中139个片段被误识别为未知摘要。全局替换system/OID还可能误改row count、sequence last value或identity正文。
- 一个摘要可能出现在大量roots路径中。旧算法把全部路径以`|`拼成标签并在每个SQL出现点重复展开；完整234 relation、211 sequence、2 extension和1 large-object行使production normalized约为raw的4.48倍、约2.9MiB，超过policy 1MiB且没有独立normalized上界。
- 旧production golden `058a924…c0a`来自只有app_users与large-object的2行单元夹具；实际完整生产SQL在旧算法下得到不同的`f71ba275…`诊断摘要，不能把小夹具值作为当前完整报告的权威golden。

### Decision

1. Python与Node先按既有content report合同严格解析每一行。RELATION/SEQUENCE identity及EXTENSION三字段只在属于该已验证报告、且在SQL中由匹配的单引号或双引号包围时作为content hex保护；未绑定的64位或更长hex继续失败关闭。
2. system identifier、restored staging OID、candidate active OID及security JSON target OID只允许在四个精确、各出现一次的SQL语法槽位替换。RECONCILIATION与PRODUCTION采用显式类型；缺失、重复或上下文漂移均按对应阶段错误码拒绝，不再全局替换相同数字。
3. roots中的普通SHA-256只匹配不嵌入更长hex的精确64位token。相同值绑定多个路径时改为`PATH_SET_<count>_SHA256_<SHA256(canonical sorted paths)>`；零摘要和空摘要保留固定短标签，单路径保留精确路径。这样仍绑定完整路径集合而不随路径数线性膨胀。
4. producer在归一化前先拒绝raw超过1MiB，并在之后分别限制normalized及gzip为1MiB；Node verifier同时限制metadata/base64、单一mtime-zero gzip member、gunzip输出和normalized。不得以增大上限掩盖算法膨胀。
5. 完整448行报告的reconciliation normalized SHA-256保持`067255c7e6b319dbea1660bebca1b3259bb6e61363f5818ec88f226fc99ce339`，production更新为`b4e0c24f4e7852980fd090c073912957782571723ef502e8c21763c67f96a140`。该golden只有在clean/private一致源码上的成功动态artifact再由独立Node verifier和整件篡改harness通过后才形成最终接受证据。

### Consequences

- V3 policy raw/canonical SHA-256为`6c66291a698f9aa7ef75d8e80e7e0616023adf3aa55351770c40587cea467486`/`87cadfcfa6c30e167426b6aeed12c7b4b1ce07f50f6dad2b577a3ac792e6bd50`；release inventory/runtime policy为`91caeaca1ba20bd3e5e147f625a6b6c2405e474d4788037efc55e7f08eea4419`/`16e4428bec578bcfafb40d80067286bd9a6fb8548760605f0910cec196786711`。
- inventory变化由固定audit生成器机械重放；promotion audit semantic/raw/Markdown/source-manifest SHA-256为`072cf6a2b0a7c0ab5dbffd96c21f56e84053b34a71a5bdb3a6360c6c94048cbe`/`688179d83fa677e176180652bcfd58f8395e5d0449dc7296c190d7c9cfc15aa7`/`40f807be1cf0dfa1b29b2fb7d91fa1abccd260d0573cd789c58677b7d305dd5a`/`78990c03069724a6a6d952bdff5bf87b28a44fbbf45786fbc59ae1c5be2cd80e`，结论仍为4 blockers、`may_start=false`。
- Python/Node共享测试向量覆盖含candidate OID子串的长relation identity、精确64位sequence identity、JSON双引号中的长extension identity、动态system/candidate/restored槽位、无关数值保持、未知hex拒绝及raw小于1MiB但normalized超过1MiB的膨胀拒绝；共享normalized SHA-256为`9d3eea6b…713b`。
- 提交前完整受影响组合110/110、Python V3 18/18、fixed executor129/129、Node V3 14/14、promotion audit/rollback34/34、release gate/manifest29/29、扩展release组合76/76、inventory263/239/24及policy verify通过；audit组合首跑33/34准确拦截旧生成物，重放后原断言全绿。独立只读复核未发现可复现P0/P1，五个V2文件继续逐字节不变。
- 系统仍为`PRODUCTION NO-GO`。本决策不证明成功V3动态case、dump/Volume、fresh-process恢复、传输层COMMIT响应丢失、host activation、真实UAT、员工试运行或正式切换。

### Rejected alternatives

- 拒绝把所有64位及更长hex一律删除、截断或当成摘要，也拒绝全局替换OID/系统标识；这些做法会抹去业务数量和content identity并产生伪稳定证据。
- 拒绝继续使用2行小夹具golden、只提高1MiB上限、拼接全部重复路径或在normalized超界时跳过验证。
- 拒绝手工修改artifact、在dirty或未private同步源码上运行，或修改/重生成五个冻结V2文件来适配V3缺陷。

## D-164 TASK70 guarded-switch SQL使用PostgreSQL内建`COALESCE`语法，不允许schema qualification

- 日期：2026-08-21
- 状态：`ACCEPTED / GUARDED SQL COALESCE CORRECTIVE SOURCE VERIFIED / CLEAN DYNAMIC RETRY PENDING / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据D-163 clean-source正式失败回执、两次有界隔离诊断、完整448行SQL golden重放和Node/Python串行回归
- 确认边界：只修正仓库fixed executor生成的六处PostgreSQL语法及其V3摘要链；不修改Migration、数据库结构、内容/权限/事务守卫，不授权或执行UAT/生产、真实数据、受保护Volume、真实备份、host、部署或服务变更

### Context

- D-163提交`4dbe266c271eb90ca4e02fcb632ef26b24986cd4`先后通过候选及committed-tree各1,791文件敏感门，并从private main `63c301f`普通快进到`recovery-private/main`；local/private精确一致。精确历史组合在clean source通过110/110。
- 首个producer`dv70-9cvw_3r_`只因核对精确测试门而在创建PostgreSQL前主动中止；正式run`dv70-6kvqa_9c`通过60秒资源门并创建唯一隔离PG17.10容器，但第二条生产调用返回`SIDE_EFFECT_OUTCOME_UNKNOWN`，没有artifact且清理为零。UNKNOWN边界正确阻止runner推断副作用结果或重放。
- 有界诊断`dv70-mqr7yjwr`证明第一条fixed reconciliation调用rc=0、stderr为0、observer PASS；`dv70-q51u17a0`固定第二条guarded switch调用rc=3，stderr为`function pg_catalog.coalesce(numeric, integer) does not exist`。PostgreSQL解析`COALESCE`为内建条件表达式而非可通过schema限定调用的普通函数。
- fixed executor中恰有六处非法`pg_catalog.coalesce(...)`：四个content聚合分片、extension inventory及Migration inventory。D-163此前因归一化失败而没有执行到该SQL；修复D-163后该缺陷才由真实隔离执行暴露。

### Decision

1. 只把上述六处改为未限定的`coalesce(...)`。不得通过把numeric强转integer、忽略stderr、放宽observer或接受UNKNOWN来掩盖语法错误。
2. 既有内容、Migration、ACL/default privilege、ordinary-role、事务rename、一次恢复及UNKNOWN/no-replay断言保持不变；测试必须精确拒绝fixed executor源码中再次出现`pg_catalog.coalesce(`。
3. 完整448行production SQL必须重新生成并绑定normalized SHA-256 `fd129b85c4f23937d62e2f6838e113a609d9cf5d305b3424480f096391e39e24`；reconciliation golden保持`067255c7e6b319dbea1660bebca1b3259bb6e61363f5818ec88f226fc99ce339`。
4. policy→V3 producer/verifier→release inventory/runtime policy→release manifest→promotion audit摘要链必须机械更新并由固定生成器重放；audit仍须失败关闭为4 blockers、P0=3、P1=1、`may_start=false`。
5. 修复只有在独立提交、候选与committed-tree敏感门、`recovery-private/main`普通fast-forward及clean-source精确110项通过后才能再次运行动态producer。最终接受仍要求成功artifact、Node verifier和整件篡改harness共同通过。

### Consequences

- V3 policy raw/canonical SHA-256为`56b571203b42fdc2f4c474c6ebd0878abf8d5461edaf9aa412af95de4c65c34a`/`192b1cab9ee7edd52786d6a14c906dfbec817ee189e64a714f6e8bf4b9ec773f`；release inventory/runtime policy为`a378c049d1a5874fc2ec179e642ebdb2ef7b70f906e7634d95945c2bcf0cf993`/`9dfc7f9fc068e8967a3ac394c847e4cb22207aacfbe551ab9588b6533ca21c40`，release manifest source为`6835057009870d5d6616f613d018c95aae422ac4830cad8a4e852b56efedc00c`。
- 固定生成器重放后的promotion audit semantic/raw/Markdown/source-manifest SHA-256为`9ee02ef4823ebd638a79fac1a951ed89d04d503ce8d5b407b42cfe6b6207f22b`/`f0a8a64cfe50db5a1b98c305ce16f0419a96eafbc76923576b3380c0c174630d`/`ab4d4197271bc75d1d4eda8830e716ce7d3f400086a199f826f2b04ad63dd1f7`/`ed3974f7fb22d7f76df114e60d86b3fa09a96c721eaca12069098fd9b3aace80`；结论继续为4 blockers、`may_start=false`。
- 提交前12个去重Node文件完整并集195/195且0 skip/todo/fail，Python V3+fixed executor147/147，inventory263/239/24、V3 policy verify、audit verify和预期`assert-ready`失败关闭通过。首次组合门包装器误期望exit 3而自失败；源码合同固定exit 1，随后以exit 1加精确错误码重跑通过，产品输出未改变。一个以全文件`coalesce(`总数为6的过宽测试会把35个既有合法未限定用法计入；该测试被纠正为精确禁止非法token，没有降低产品断言。
- 所有正式及诊断run均没有V3 artifact、任务容器、网络、Volume、tmp根或进程残留；五个冻结V2文件逐字节不变。系统仍为`PRODUCTION NO-GO`，本决策不证明dump/Volume、fresh-process恢复、host activation、真实UAT、人工验收、员工试运行或正式切换。

### Rejected alternatives

- 拒绝把`numeric`强制转换为`integer`、创建同名wrapper、忽略PostgreSQL stderr或仅调整预期return code；错误在schema-qualified语法本身，且这些替代会改变精度或掩盖执行失败。
- 拒绝把`SIDE_EFFECT_OUTCOME_UNKNOWN`当作已失败可安全重放或已成功可继续；observer和no-replay边界必须保持。
- 拒绝手工编辑动态artifact、跳过clean/private source binding、修改冻结V2文件，或借合成PG诊断访问UAT/生产数据库及受保护数据。

## D-165 TASK70不得以带状态的psql `\quit`模拟失败，必须由服务端异常和`ON_ERROR_STOP`形成精确失败关闭回执

- 日期：2026-08-21
- 状态：`ACCEPTED / PSQL FAIL-CLOSED CORRECTIVE SOURCE VERIFIED / PG17 REFRESH AND DYNAMIC RETRY RESOURCE-BLOCKED / PRODUCTION NO-GO`
- 提案与实施：Codex持续交付负责人，依据D-164 clean-source正式失败回执、PostgreSQL 17.10有界诊断及PostgreSQL语义、Node回执、Python/摘要链三条独立只读审计
- 确认边界：只修正生产可达psql失败语义、精确动态回执、零副作用负测及其派生摘要链；不修改Migration、业务Schema/API，不授权UAT/生产、真实数据、受保护Volume、真实备份、host、部署或服务变更

### Context

- D-164提交`28128de0ca03453234f760f5b5b3fa8b0562319c`完成1,791文件committed-tree敏感信息检查并由private main普通快进接收。clean正式run`dv70-g2g36ygu`在发布artifact前由`TASK70_V3_GUARDED_FAILURE_EXECUTION_INVALID`拒绝且零任务残留。
- 有界诊断`dv70-1bzn9rfk`证明旧security-drift分支实际rc=0、stdout含guard marker、stderr为`\quit: extra argument "3" ignored`。PostgreSQL 17.10的psql `\quit`/`\q`不接受退出状态，带参写法只警告并忽略参数；因此`\quit 3`不能实现调用方依赖的rc=3失败关闭合同。
- 全仓审计发现同类写法还存在于cluster catalog、runtime privilege catalog/state、operator、reconciler、fixed executor及集成测试fixture。只修V3 producer会让生产可达operator/恢复路径继续把守卫失败误报为成功。
- 根盘在本修复收口门禁中精确可用10,717,696,000 bytes，低于10GiB硬线10,737,418,240 bytes；故真实PG17 integration、官方catalog refresh/test和正式producer必须停止，静态或fixture结果不得冒充动态通过。

### Decision

1. 生产可达SQL不得再使用任何带参数的psql `\quit`或`\q`。所有守卫失败改为server-side `DO ... RAISE EXCEPTION`，并继续依赖既有`ON_ERROR_STOP`产生rc=3；显式事务内必须先`ROLLBACK`再抛错，避免异常事务吞掉预期消息或留下副作用。
2. V3 guarded-failure执行回执只接受rc=3、stdout逐字节等于单个换行、stderr逐字节等于`ERROR:  guarded switch runtime privilege mismatch`加单换行。旧rc=0 warning、stdout marker、CRLF、宽松substring或伪造rc=3均必须拒绝。
3. `SECURITY_DRIFT_REJECTED`必须在失败调用前后各捕获一次非空、最多32MiB的canonical security state，要求逐字节相等，并在artifact中记录两个非零且相等的SHA-256。调用失败而安全状态变化时不得发布证据。
4. PostgreSQL 17 integration脚本必须真实覆盖state/catalog缺失`expected_database`、非法marker target、reconciler/operator强制advisory-lock失败，并在每个失败后重捕获状态与结构性catalog进行字节核对。静态门同时扫描`.cjs/.js/.mjs/.mts/.py/.sh/.sql/.ts`并禁止带参quit回归。
5. V3 policy、compiled catalog、runtime/operator/cluster policy、release inventory/runtime/manifest及promotion audit必须由固定生成器按新源码重放；audit仍保持4 blockers、P0=3、P1=1、`may_start=false`。五个V2冻结文件和历史`release-supervisor-bundle-v1.json`不得更新。
6. D-132 dashboard中的cluster catalog源码SHA断言属于当前安全回归锁，不是允许坏语义永久冻结的历史artifact。D-165仅更新该断言以绑定修复后源码；D-132原提交、tree、当时运行结果和历史报告不改写，且文档明确这是生产安全修正例外。
7. D-165先在非PG适用回归、diff及敏感门后形成独立提交并普通快进到`recovery-private/main`；该前置已由提交`e192f1d7bb63bfafcd39d77a3d543d604364c9c6`及精确远端回读满足。只有根盘恢复到至少10GiB且内存、Swap、Load、OOM/restart/health门同时通过，才串行执行真实PG17 refresh/test和clean/private一致源码上的60/180秒正式producer。

### Consequences

- V3 reconciliation/production normalized SHA-256为`067255c7e6b319dbea1660bebca1b3259bb6e61363f5818ec88f226fc99ce339`/`56700c1f2cbbae092a7fc2635e53da836ef37a30e48549173f91e0c5bf616abb`；policy raw/canonical为`e8c642ec5f6d419a8b0a8104d7c784f7022e2a802e2c6751177d9504579cedcd`/`30b81e0683d9dde3ef175d68d9c29013b28630d81e132fe86cba2040f0eb90e9`。
- compiled catalog raw/semantic/artifact为`915ee9bf1a10199abbae9139600bd4d8e83429c2dc5011c7953374c515ad7a41`/`e0070514bdaaa998f114583ed820047688ef8945aa5ea3cafdfb873e3df02e8c`/`a386c38457e6e3e36f6409b90b08e6a0bac284c3fc97e139cceff5e9f125aa53`；runtime/operator/cluster policy raw为`2aba8ed96202117761ba88212fb84e3d475afbf19e5447fabe2f658bbe9d8a7c`/`4767a070ed8695fc770052619c3e78c5474686378ef5d1a538c58db9f78eb9fa`/`3537a90acc094f166bd4fab6cad11e5d27f98d041432fa92f3288eee5d703016`。
- release inventory为263/239/24，raw SHA-256 `97e599dab466ed256821b0980075660c7aac9e7a053c4c92c1ede4c8436451e6`；test runtime policy及release manifest contract source raw为`1b0637e2092d63e491be72c64f1ce49f4368eef257a8fbe0867a5d17b9d0efc8`/`eafe78d1c1b1d1d7846fad70f838665a44d540cc3cd5f5ed7da49b6f1744fae5`。
- promotion audit semantic/raw/Markdown/source-manifest为`ab52a0958c854179fbecfb4afca58a5ecfc454d3a07b3dd1dfa410a43078b123`/`c180f6f71018b349a42fb8593f40b9afb63603e8d217afabc328f28290a5b8ef`/`5b1175d1f1e1e0b5e89505edd033b366c7fbd95c8e2d9235ac0fc16cd52b5f45`/`605cdacc99935ae80449252a516ebbe4a0fdba0e55639429c629f528f827bdf8`；`assert-ready`继续以exit 1和`UAT_PROMOTION_EXECUTOR_NOT_READY`拒绝。
- 非PG适用回归已通过Node68/68+35/35、Python19/19+130/130+46/46、audit20/20、inventory263/239/24及policy/audit直接门；真实PG17范围明确保持`NOT RUN / RESOURCE-BLOCKED`。系统仍为`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝保留`\quit 3`并在调用方把rc=0 warning解释成失败，也拒绝用stdout marker、shell wrapper或手工`exit 3`伪造psql服务端执行结果；这些做法无法证明SQL守卫实际失败且无副作用。
- 拒绝只修V3 verifier而留下operator/reconciler/cluster catalog同类路径，或放宽精确stderr/stdout合同来接受旧行为。
- 拒绝因历史D-132哈希锁而冻结已证实的fail-open语义；同样拒绝重写D-132历史证据、修改五个V2冻结文件或历史Supervisor V1 bundle来适配当前源码。
- 拒绝在根盘低于10GiB时启动PG17、Docker或正式producer，也拒绝重复已消耗的TASK84命令。资源恢复必须来自自然释放或新的精确专项授权。

## D-166 少于20人ERP采用单体优先、业务闭环优先并冻结平台级治理扩展

- 日期：2026-08-23
- 状态：`ACCEPTED / SMALL-TEAM RESET / GOVERNANCE ONLY / PRODUCTION NO-GO`
- 提案人：项目负责人提出系统少于20人使用并质疑当前复杂度；Codex完成只读量化复核
- 确认人：项目负责人明确确认“按小团队版重置”

### Context

- 排除生成目录后，自托管核心应用、数据库、Worker和PostgreSQL Migration约7.3万行；运维脚本和工具约13.5万行，其中UAT晋升/回滚相关约11.3万行。发布控制逻辑已大于ERP核心实现。
- 当前Schema有233张PostgreSQL表、46项Migration和238份任务文档；源码为alpha.47/0046，运行UAT仍为alpha.42/0040，系统保持`PRODUCTION NO-GO`。继续补合成控制面没有优先解决真实员工使用、真实数据迁移和业务验收。
- 少于20名用户不降低物料、BOM、库存、生产、出货或财务数据正确性要求，但显著降低了自建多层发布平台、多智能体Runtime、Capability Broker和十五检查点晋升事务的收益。

### Decision

1. 未来生产方向继续是自托管，但默认部署边界固定为Caddy、一个Node Web/API单体、PostgreSQL和本地文件存储；只有确需异步导入或后台处理时才保留一个Worker，不新增微服务群、消息平台或集群控制面。
2. 必须保留稳定内部ID、关系约束、事务、幂等、并发控制、服务端权限、审计、版本化Migration、可恢复备份和已过账事实的调整/冲销规则。这些属于业务安全底线，不以用户数为由放宽。
3. 发布流程目标收敛为“可恢复备份 → 版本化Migration → 替换Web/必要Worker → 健康检查 → 回退上一已知可用版本”。TASK59—TASK82已实现的内容寻址Supervisor、监控/授权/回退控制面保留为历史，不继续扩展或激活。
4. `SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70`立即从`DOING`转为`BLOCKED / OWNER-REQUESTED SMALL-TEAM RESCOPE`。历史部分证据和D-165安全修复保留；磁盘恢复不再触发自动续跑。只有新的项目负责人明确决定才能恢复。
5. D-113/D-114的R2—R5、多智能体Runtime、Control Store、强制lease/fencing及Capability Broker继续`NOT AUTHORIZED`，并从当前路线移除。研发默认保持单一写者和按需只读复核，不建设新的Agent平台。
6. 外部AI、AI采购、AI报价、AI生产辅助及未启动的产品AI任务继续冻结。后续只有在核心业务闭环稳定、真实数据迁移和员工UAT完成后，才能重新评估。
7. 下一阶段先由项目负责人确认实际岗位、8—10条真实端到端流程、必须单据/报表和首期数据范围，再形成现有代码的`KEEP / PARK / REMOVE_LATER`清单。该基线确认前不新增表、Migration、角色、模块或基础设施。
8. 本决定不授权立即删除现有代码、Migration、测试或历史文档。任何删除必须另立任务，先证明无运行时依赖、建立恢复点并通过适用回归。

### Consequences

- `SELFHOST-SMALL-TEAM-SCOPE-RESET-85`只更新治理文档并暂停TASK70；不修改业务代码、Schema/Migration、API、镜像、Compose、数据库或运行服务。
- 当前UAT继续保持alpha.42/0040，源码继续保持alpha.47/0046；该差距必须在小团队业务基线中决定是复用、摘取还是放弃，不能直接部署或回退猜测。
- 实际异机备份、恢复验证、认证授权和数据完整性仍是上线底线；冻结的是超出小团队收益的平台级实现，不是灾备或安全责任。
- 系统保持`PRODUCTION NO-GO`，直到真实数据范围、员工UAT、备份恢复和明确切换授权完成。

### Rejected alternatives

- 拒绝继续按原TASK70路线消耗资源，只为扩大合成证据覆盖而不验证真实业务。
- 拒绝因用户少而取消权限、事务、审计、备份、Migration或数据约束。
- 拒绝立即大规模删除233张表、46项Migration或历史脚本；未经依赖盘点的清理会制造新的恢复和数据风险。
- 拒绝同时维护Python/SQLite、历史Sites/D1和Node/PostgreSQL三套新增业务逻辑；旧运行面只作迁移和行为参照。

## D-167 小团队V1按可变岗位容量和十大业务闭环验收，不把每岗两人写入系统

- 日期：2026-08-23
- 状态：`ACCEPTED / BUSINESS BASELINE / HEADCOUNT VARIABLE / PRODUCTION NO-GO`
- 提案人：项目负责人补充工程、计划和市场等职能，并要求各职能先按2人估算但不得写死
- 确认人：项目负责人要求以第一性原理推进项目完成

### Context

- 现有自托管身份目录有11个技术角色，`app_users`每账号保存一个服务端角色，但没有每角色人数唯一约束、席位计数或2人上限。现有源码有50个原生页面、37个一级模块目录、233张表和46项Migration；继续按模块数量推进会重复D-166已停止的复杂度路线。
- 九个实际业务职能是管理、市场/销售、工程/项目、计划/PMC、采购、仓库、生产、品质和财务。每职能2人得到约18人的当前容量参考，但实际人数会变化，`admin`和`operations`也只是治理职责，不应被误算为固定业务部门。
- ERP的有效结果是跨岗位共享事实守恒和责任交接闭环，而不是把某个组织结构或人数写入产品。真实员工是否兼岗尚未提供，不能在没有需求证据时预先建设多角色平台。

### Decision

1. 九个业务职能首期均按2人做容量、培训和UAT排班估算，合计约18人；该数字不是最少/最多人数、许可证席位、并发上限、Seed数量、Schema约束、权限条件或自动测试断言。
2. 人数变化只通过受控账号创建、停用和岗位分配处理，不要求业务代码、数据库或部署变化。不得使用共享账号；也不得为同一员工复制多个账号来伪造职责覆盖。实际出现兼岗后，再以真实名单和最小权限另立决策，不预建复杂角色平台。
3. `admin`和`operations`保留为技术治理职责，不自动新增固定业务人数。现有11个技术角色、服务端permission映射和每账号单角色模型在本任务中保持不变。
4. V1只按[小团队V1业务基线](../business/small-team-v1-baseline.md)的十条闭环验收：主数据、市场→工程、工程→计划、计划分流、询价→PO、到货→库存/AP、计划→完工、品质/返工、订单→出货/AR、结算/冲销/经营对账。
5. 首期数据采用“有效主数据 + 切换日可核对Opening + 必须续办的未结事项 + 旧系统只读历史”。不迁移旧密码/Session，不为追求完整历史而重演全部关闭交易；任何真实数据盘点和试迁移仍需明确授权。
6. 源码按`KEEP / PARK / REMOVE_LATER`处置：核心Node/PostgreSQL闭环和数据安全底线保留；AI、高级控制面、历史Sites/D1和Python新增业务开发暂停；只有依赖审计、恢复点和回归齐备时才能在独立任务删除候选代码。已执行Migration和审计历史不得重写。
7. 下一任务先在隔离PostgreSQL证明现有代码的单一黄金旅程，逐段标记`READY / FIX_REQUIRED / PARKED`；没有实际P0阻断前不新增模块、角色、表或基础设施。

### Consequences

- `SELFHOST-SMALL-TEAM-BUSINESS-BASELINE-86`只更新业务和治理文档，不创建账号、不修改源码/数据库或访问UAT。
- 项目完成度以后按十条闭环、数据迁移、员工UAT、恢复和切换结果衡量，不再按技术任务累计量衡量。
- 现有源码覆盖面较广，但alpha.47/0046与UAT alpha.42/0040分叉、完整员工UAT和真实数据试迁移仍是实际阻断；系统继续`PRODUCTION NO-GO`。

### Rejected alternatives

- 拒绝在代码、数据库、Seed、测试或授权中硬编码“每岗2人”或总人数18。
- 拒绝把admin/operations机械追加为两个新部门，或因小团队可能兼岗就预先建设多角色/组织平台。
- 拒绝继续补齐所有设想页面和控制面后才做跨岗旅程，也拒绝把局部单元测试或页面存在解释为员工可用。
- 拒绝一次性删除历史代码或Migration来追求表面简洁；先冻结、再证明无依赖、最后独立清理。

## D-168 TASK87以九条READY和ST-04日期型P0收口，先做单一最小修复再进入真实样本

- 日期：2026-08-23
- 状态：`ACCEPTED / 9 READY + 1 FIX_REQUIRED / DATE-ONLY P0 / PRODUCTION NO-GO`
- 提案与实施：Codex依据D-167业务基线、当前alpha.47/0046源码、194项Unit/UI合同和隔离PostgreSQL动态证据
- 确认边界：只决定ST-01—ST-10源码就绪分类、唯一P0和后续任务顺序；不授权UAT/生产、真实数据、账号、备份、Migration、部署或运行服务变化

### Context

- 44个相关Unit/UI文件`194/194 PASS`；21组现代Service在全新隔离PostgreSQL 17.10、46项Migration下以UTC运行`99/99 PASS`，主数据套件另为`6/6 PASS`。
- ST-04的Material Requirement套件在UTC为`8/8 PASS`，同一源码在Asia/Shanghai仅`1/8 PASS`。PostgreSQL `date`返回JavaScript `Date`后，`toISOString().slice(0,10)`把上海本地零点转换为前一UTC日，造成提交重算摘要不一致。
- 当前UAT Web容器使用UTC，只是偶然掩盖问题。业务日期是日历日，不应依赖Node所在时区。
- 现有全ERP smoke在alpha.42和源码修订`78d96c61…`对应的历史alpha.47本机镜像中都先通过Identity，再因调用已退役的`POST /api/mappings`而收到`409 SUPPLIER_MAPPING_GOVERNANCE_REQUIRED`。现代Supplier Mapping要求草稿→提交→异人审核，不能为迁就旧测试而恢复直写。
- 首次准备补跑现代Supplier Mapping PG 10项前，根盘只比10 GiB硬线高约3.5 MiB，按低资源规则停止并清理；空间自然恢复且新鲜门再次通过后，以另一全新隔离库补跑`10/10 PASS`。现代模块尚未串成同一数据库连续旅程仍是验证工具缺口，不是已复现产品P0。

### Decision

1. ST-01、ST-02、ST-03、ST-05、ST-06、ST-07、ST-08、ST-09、ST-10标为`READY`，表示可在修复P0后进入真实样本/员工UAT；ST-04标为`FIX_REQUIRED`。十条闭环没有`PARKED`项。
2. 唯一产品P0是Material Requirement date-only时区漂移。PostgreSQL `date`必须按日历日期规范化，不得经本地时间→UTC时间点转换来决定业务日。
3. 下一任务固定为`SELFHOST-MATERIAL-REQUIREMENT-DATE-ONLY-FIX-88`：只修复date-only规范化与两个已知消费点，并在UTC/Asia/Shanghai下运行同一PG回归；不新增页面、角色、表、Migration或基础设施，不顺带重构其他业务。
4. 现有全ERP smoke必须在P0之后由独立任务更新到现代Supplier Mapping和Project→Planning→Requirement→Sourcing→Production/Quality/Sales/Finance接口，并在同一隔离库连续运行。局部套件不得冒充该统一旅程已通过。
5. `READY`和合成隔离PASS都不等于当前UAT可用或生产准入。真实样本试迁移、九职能实名UAT、可恢复备份/恢复演练和上线授权仍是独立强制条件。

### Consequences

- TASK87以`9 READY / 1 FIX_REQUIRED / 0 PARKED`完成，TASK88成为唯一明确待启动任务；TASK70及AI/高级控制面保持冻结。
- TASK88通过前不得进入真实Material Requirement UAT；通过后仍先补现代同库整链证据，再申请真实数据和员工动作授权。
- 每职能2人、约18人继续只作容量参考，不进入修复实现、测试数量、权限、Schema或验收条件。
- 系统保持`PRODUCTION NO-GO`，UAT alpha.42/0040及全部常驻服务不因本决定改变。

### Rejected alternatives

- 拒绝通过强制生产容器永远使用UTC来掩盖date-only错误；基础设施约定不能替代正确业务语义。
- 拒绝恢复旧`/api/mappings`直写、放宽Supplier Mapping审核或修改全ERP smoke的预期状态来制造假PASS。
- 拒绝把测试脚本过期或缺失统一旅程误报为已通过；也拒绝把验证工具缺口和日期型产品P0混进一个大任务。
- 拒绝因九条`READY`就直接部署源码、迁移UAT、创建真实账号或开始员工操作。

## D-169 PostgreSQL date按日历分量规范化，UTC时间点不得决定Material Requirement业务日

- 日期：2026-08-23
- 状态：`ACCEPTED / TASK88 P0 FIXED / 10 READY / PRODUCTION NO-GO`
- 提案与实施：Codex依据D-168最小修复边界和UTC/Asia/Shanghai隔离回归
- 确认边界：仅固定Material Requirement的date-only读取合同与后续验证顺序；不授权UAT/生产、真实数据、账号、Migration、build或部署

### Context

- node-postgres把PostgreSQL `date`解析为Node进程本地零点的JavaScript `Date`。在Asia/Shanghai调用`toISOString()`会先转换为UTC时间点，从而把`2026-10-01`错误投影为`2026-09-30`。
- Material Requirement的提交重算摘要和采购追溯当前供应截止日都依赖同一需求日；任何一个消费点漂移都会造成错误重算拒绝或错误在途边界。
- 该字段是无时区日历日，不是一个全球时间点。强制容器使用UTC只能隐藏错误，不能形成正确业务合同。

### Decision

1. Material Requirement建立单一`normalizeDateOnly`边界。规范`YYYY-MM-DD`字符串必须通过真实日历往返校验；无效Date、非法字符串、带时间值或其他类型明确返回既有`REQUIRED_DATE_INVALID / 422`。
2. 对node-postgres返回的有效`Date`读取`getFullYear/getMonth/getDate`本地日历分量，再生成并复核规范字符串；不得使用`toISOString`、UTC getter或时间戳偏移决定PostgreSQL `date`的业务日。
3. 请求日期、Package回退日期、提交重算和采购追溯截止日复用同一规则。计算摘要、库存/在途SQL、Allocation、事务、权限、幂等、CAS、审计和既有失败关闭语义保持不变。
4. UTC与Asia/Shanghai必须运行同一Material Requirement隔离PG套件并各自`8/8 PASS`。局部通过只把ST-04提升为源码/隔离库`READY`，不构成统一旅程、UAT或生产准入。
5. 下一任务为`SELFHOST-SMALL-TEAM-UNIFIED-GOLDEN-JOURNEY-89`：在一个隔离数据库中把现代Supplier Mapping和当前跨域API串成连续旅程；若复现新的产品P0，应独立登记，不把修复塞入测试脚本重写。

### Consequences

- TASK88完成后十条闭环源码就绪分类为`10 READY / 0 FIX_REQUIRED / 0 PARKED`；TASK87记录的Asia/Shanghai `1/8`仍保留为修复前证据，不改写历史。
- 源码、测试和文档变化不包含Schema、Migration、角色、页面、依赖或运行配置；UAT继续alpha.42/0040，源码仍为alpha.47/0046且尚未部署。
- 真实样本/试迁移、九职能实名UAT、可恢复备份/恢复演练和明确上线授权继续是强制后续条件，系统保持`PRODUCTION NO-GO`。
- 每职能2人、约18人仍只作可变容量参考，不进入实现或验收硬条件。

### Rejected alternatives

- 拒绝强制所有Node进程永久使用UTC来掩盖date-only错误。
- 拒绝对PostgreSQL `date`使用UTC getter、固定8小时偏移或任意字符串截断；这些做法会把运行环境假设写进业务日期。
- 拒绝全局修改pg类型解析器或顺带重构其他业务模块；TASK88只修复已证实的Material Requirement边界。
- 拒绝把UTC/Asia双时区局部PG通过描述为现代同库整链、员工UAT或可上线。

## D-170 现代同库合成黄金旅程成为当前基线，历史全ERP smoke不再作为正式入口

- 日期：2026-08-23
- 状态：`ACCEPTED / TASK89 MODERN GOLDEN JOURNEY PASS / REAL UAT REQUIRED / PRODUCTION NO-GO`
- 提案与实施：Codex依据D-167—D-169业务范围、当前alpha.47/0046服务和全新隔离PostgreSQL动态证据
- 确认边界：只固定合成测试入口、跨域守恒证据和下一授权门；不授权真实数据、账号、UAT/生产、Migration、build、deploy或运行服务变化

### Context

- TASK87发现历史全ERP smoke仍调用退役`POST /api/mappings`，治理门正确返回409，因此旧脚本无法证明当前服务的连续整链。TASK88关闭唯一已知产品P0后，局部套件仍不能代替同一数据库旅程。
- TASK89在一个全新0046隔离库中改用现代Supplier Mapping草稿→提交→异人审核及当前Project、Planning、Requirement、Sourcing、Fulfillment、Production、Quality、Sales和Finance服务。
- 同一稳定原料ID贯穿Mapping、BOM、计划包、净需求、RFQ、PO和生产；采购、领料、完工和出货数量均为10，采购金额120、销售金额200。退役接口409、无权写403、幂等、CAS、异人审核和追加式付款冲销均有明确断言。
- 首次运行在采购接收后继续提交PRQ旧版本1，服务正确返回`409 VERSION_CONFLICT`；读取当前版本2后，两次全新空库旅程均`1/1 PASS`。这是测试工具CAS假设，不是产品P0。
- 合成测试每个相关角色只创建一个账号来表达职责交接；账号数量不是岗位编制、席位、最少/最多用户、并发或验收约束。

### Decision

1. `tests/selfhost-small-team-unified-golden-journey-postgres.test.mjs`成为现代小团队合成黄金旅程；`test:small-team:golden-journey:postgres`和兼容入口`test:full-erp:compose`均选择它。
2. 历史`scripts/selfhost-full-erp-compose-smoke.mjs`保留为审计证据，但不再由正式包脚本选择。不得恢复退役Mapping直写或放宽现代审核来迁就历史脚本。
3. 当前合成通过标准固定为同一全新0046数据库、稳定ID贯穿、关键数量金额守恒、授权拒绝、幂等/CAS、异人审核及合法追加式更正；独立模块PASS不得冒充整链。
4. TASK89结果为`MODERN GOLDEN JOURNEY PASS`，只关闭测试工具缺口。它不证明UAT alpha.42/0040已升级、不证明真实数据可迁移、不证明员工能完成岗位操作，也不构成生产准入。
5. 下一任务为`SELFHOST-SMALL-TEAM-REAL-SAMPLE-UAT-PLAN-90`。启动真实写入前，项目负责人必须提供并批准样本、实际责任人/参与者、目标环境、数量金额口径、清理/回退方式和逐项授权；人数按真实名单变化。

### Consequences

- 十条闭环从“源码/局部隔离READY”提升为“现代同库合成旅程PASS”，但项目阶段仍为`PRODUCTION NO-GO`。
- 后续缺口集中到真实样本试迁移、实名员工UAT、恢复演练、源码/UAT版本收敛及明确上线授权；没有新证据前不新增模块、角色、表或基础设施。
- 产品源码、Schema、Migration、API、权限和运行面未因TASK89改变；UAT继续alpha.42/0040，TASK70及AI/高级控制面继续冻结。

### Rejected alternatives

- 拒绝把历史全ERP脚本的409改成预期成功，或恢复退役Mapping直写来制造表面PASS。
- 拒绝用直接SQL造业务状态、降低数量金额/权限/CAS/冲销断言，或把多个独立数据库的局部测试拼成统一旅程结论。
- 拒绝把每职能2人或合成账号数写成测试、权限、Seed、Schema或许可证限制。
- 拒绝从合成PASS自动进入真实UAT、迁移、部署或生产；这些动作必须由新的明确输入和授权启动。

## D-171 无真实样本时先建立可人工复算的虚构UAT准备包，商务启动门保持待确认

- 日期：2026-08-24
- 状态：`ACCEPTED / SYNTHETIC STARTER PACK READY / BUSINESS GATE PENDING / NO UAT EXECUTED / PRODUCTION NO-GO`
- 提案与实施：项目负责人确认当前没有样本并要求先推进；Codex依据D-167、D-170和TASK89现代同库证据形成L0文档准备包
- 确认边界：只接受虚构样本、员工清单、核对表和授权分层；不授权目标环境访问、账号、真实数据、build、Migration、部署、UAT写入或生产动作

### Context

- TASK89已证明当前alpha.47/0046源码可在全新隔离库完成现代同库合成旅程，但项目负责人当前没有真实或脱敏业务样本，不能据此创建真实账号或直接升级UAT。
- 小团队需要一个员工能看懂、数字可手工复算的起点，不需要再建设平台。10件、采购单价12 CNY、销售单价20 CNY可以清楚验证采购120、销售200、原料/成品/WIP期末归零和收款冲销。
- TASK89的合成旅程在正式销售订单前已经进入采购和生产。常规订单是否必须先有已接受销售订单，样品/打样/备货是否可由负责人例外授权，是业务决定而不是测试工具可以替公司决定的技术细节。

### Decision

1. 在没有真实样本时，TASK90以完全虚构的`CYD-UAT-SYN-001`作为首个员工UAT准备样本。所有名称、联系人、地址、价格和账号均为合成占位，不得复制真实业务信息。
2. 样本固定数量10、BOM用量1:1、采购12 CNY/PCS、销售20 CNY/PCS，只为了人工复算；这些数值不是批量下限、金额限制、默认价格或产品规则。日期以D0偏移表达，人数按实际名单变化。
3. 准备包必须覆盖主数据、现代Mapping、项目/工程/计划、需求、商务门、采购/收货/IQC/AP、生产、FQC/出货/AR、收款冲销、稳定ID、守恒、权限拒绝、幂等、CAS和P0停止线。
4. 商务启动门保持待确认：常规流程推荐`SO_REQUIRED`；样品/打样/备货可选`PRE_SALES_EXCEPTION`，但需负责人授权编号、金额上限和有效期。在负责人确认前，不把任一选项写入Schema、权限、服务或Migration。
5. 授权采用L0—L5清晰分层。项目负责人本轮“先下一步、没有样本”只授权L0文档准备；L1目标环境只读核对、L2部署/Migration/账号、L3虚构UAT写入、L4真实样本和L5生产必须分别明确授权。
6. 下一任务为`SELFHOST-SMALL-TEAM-UAT-ENVIRONMENT-READINESS-91`，项目负责人先指定现有并行UAT或新建隔离UAT，并定义L1只读范围；在此之前保持TODO。

### Consequences

- TASK90可以在不等待真实样本、不触碰任何运行数据的情况下完成，为后续员工讨论提供一套共同、可复算的业务语言。
- 该准备包不是试运行结果。当前UAT仍为alpha.42/0040，候选源码为alpha.47/0046；版本、恢复点、账号和业务写均未改变。
- IQC、销售前采购/投产门及真实员工兼岗会在实际UAT中显式暴露，不因TASK89最小合成PASS而假定已经通过。

### Rejected alternatives

- 拒绝因没有样本就停留在抽象讨论，也拒绝从旧系统擅自读取或复制真实客户、供应商、价格、联系人或银行信息。
- 拒绝把TASK89的固定10件、单角色合成账号或价格写成系统默认值、人数要求或业务限制。
- 拒绝直接把现有并行UAT升级到0046、创建账号或写入虚构数据；这些动作超出L0授权。
- 拒绝用口头约定掩盖“销售订单前能否采购/投产”的产品控制缺口；必须由负责人明确业务门并在UAT验证是否服务端强制。

## D-172 新隔离UAT从空库0046建立，L1通过但同机L2因控制根、镜像和磁盘失败关闭

- 日期：2026-08-24
- 状态：`ACCEPTED / L1 READ-ONLY COMPLETE / SAME-HOST L2 NO-GO / NEW UAT NOT CREATED / PRODUCTION NO-GO`
- 发起与授权：项目负责人明确选择新建隔离UAT并授权L1只读核对
- 核对与提案：Codex依据当前alpha.47/0046源码、Compose/运行身份合同和宿主Docker/resource metadata
- 确认边界：只固定新环境数据边界、L1事实和下一授权门；不授权主机采购、配置改造、清理、build、Migration、deploy、账号、UAT写入或生产动作

### Context

- 当前源码有46项Migration/head 0046和233张public表snapshot；TASK89已证明同一全新0046隔离数据库的合成黄金旅程，但本轮没有运行数据库或访问现有UAT业务内容。
- Compose项目名可以隔离网络、命名Volume和loopback端口；无副作用渲染以`chenyida-erp-uat-synthetic`通过。但secret、release candidate/identity、runtime privilege operator、全局lock及backup继续使用固定宿主root，仓库没有新UAT专用override。
- 本机唯一alpha.47 Web/Worker镜像绑定旧提交`78d96c6198ab4b7255572186ea580c463b5eeba3`；其后运行代码、Dockerfile和发布合同已变化，当前HEAD没有匹配镜像。
- 根盘起点/收口只高于10 GiB硬线约51.79/43.23 MiB。内存、Swap、Load、PSI、OOM及四服务状态正常，但磁盘余量不允许启动任何重任务或新运行资源。
- 首轮只有完全虚构样本，失败时可以精确销毁该隔离环境并从空库重建；这不能冒充真实备份恢复或生产灾备。

### Decision

1. 新UAT必须从`EMPTY → 0046`建立，使用独立数据库、uploads、attachments、backup-status、网络、secret、运行角色、release identity和端口；不得复制、恢复或升级现有alpha.42/0040 UAT。
2. 任何候选必须绑定批准后的精确当前Git提交、alpha.47、Migration allowlist和Web/Worker digest。旧`78d96c6` alpha.47镜像继续`STALE / NOT AUTHORIZABLE`。
3. Compose项目名前缀不是完整隔离证明。只要固定宿主控制root仍可能共享，同机L2就保持NO-GO。
4. 首轮回退模式固定为`DISPOSABLE_SYNTHETIC / RECREATE_FROM_EMPTY`；不发布或伪造`RECOVERY_READY`。真实样本前必须另立恢复策略。
5. 第一性原则下推荐独立UAT主机/VM，让固定控制root和Docker资源天然独占；是否提供独立主机仍由项目负责人确认。若坚持当前主机，必须分别授权隔离配置改造和精确BuildKit-only清理，并重做资源门。
6. TASK92只处理所选宿主路径和前置阻断。L2a空环境build/Migration/deploy、账号/HTTPS、L3虚构业务写、L4真实样本和L5生产继续逐层授权。

### Consequences

- TASK91以L1完成关闭，但“新UAT已建立”“可以试运行”和“可以上线”均为假；当前运行面没有变化。
- 0041 AI表随不可变Migration存在但AI功能继续冻结；小团队人数、每职能约2人及10件样本不进入基础设施、Schema、权限或容量硬条件。
- D-171商务启动门不阻止空环境准备，但在员工执行采购/投产步骤前仍必须确认。

### Rejected alternatives

- 拒绝直接升级或克隆现有UAT，也拒绝读取其业务数据来制造样本。
- 拒绝因版本号同为alpha.47就复用旧镜像，或在磁盘只剩几十MiB硬线余量时尝试build。
- 拒绝把Docker项目名、synthetic recreate或Dashboard占位解释为secret/control隔离、可恢复备份或生产准入。
- 拒绝同时建设独立主机和同机多环境两套方案；TASK92只执行负责人选定的一条最小路径。

### TASK92后续证据

- 项目负责人随后专项授权先清理磁盘。TASK92只清理未使用BuildKit cache，Cache从174项/10.31GB降为0，根盘available恢复到`17,909,628,928` bytes；容器、镜像、Volume、网络、四服务和四个受保护卷保持不变。
- 该证据只移除D-172的磁盘阻断，不改写空库0046、精确镜像、宿主控制root、合成重建或逐层授权决策。当前源码匹配镜像和固定root隔离仍缺失，`SAME-HOST L2 NO-GO`继续成立。
- 磁盘清理不等于项目负责人已选择同机路径；独立主机仍为推荐方案，TASK92继续等待宿主路径选择。

## D-173 选择当前主机同机隔离，先冻结Compose消费者边界并保持运行失败关闭

- 日期：2026-08-24
- 状态：`ACCEPTED / SAME-HOST B SELECTED / COMPOSE CONSUMER ISOLATION PASS / RUNTIME NOT AUTHORIZED / PRODUCTION NO-GO`
- 发起与确认：项目负责人明确选择`B`，接受新隔离UAT与现有运行面处于同一宿主故障域
- 实施范围：Codex只实现仓库内独立host-root/Compose override、非Secret示例和静态正负验证；不创建或修改运行资源

### Context

- TASK92已清空未使用BuildKit cache并恢复约16.68GiB根盘可用空间；项目负责人随后选择当前主机，而非同时建设独立主机和同机两套方案。
- 少于20人和各职能暂按约2人只影响人员排班，不要求多租户平台。真正需要隔离的是数据库/文件/Secret/发布身份/端口与Docker命名资源，人数不能成为项目名、账号数、容量或验收硬编码。
- 基础Compose固定生产Secret和release bind；单独改变Compose项目名只隔离网络和命名Volume。release supervisor和runtime privilege operator还固定生产producer/state/secret/backup root，不能由消费者overlay自动解决。

### Decision

1. 接受同一宿主故障域，但不降低数据边界：UAT必须使用独立Compose项目、网络、全部命名Volume、loopback端口、Secret root、release candidate root和release identity root；不得读取或覆盖生产及现有UAT对应对象。
2. 新增独立`compose.uat-isolated.yml`，用`!override`替换所有宿主控制bind和发布端口。必要变量为空即渲染失败；Caddy从`production` profile改为显式`uat-edge`且仍只绑定loopback。
3. 非Secret示例中的项目名、root和端口是L2a前待核对输入，不是人数、并发、容量、许可证或产品规则。实际值必须通过碰撞核对后才能授权使用。
4. 独立静态validator固定服务/Volume/网络/挂载/端口/环境/镜像形状，并拒绝缺失root、生产root、生产项目名、生产Web端口或遗漏overlay。该门只消费`docker compose config` JSON，不连接数据库或创建Docker对象。
5. 生产Compose和生产container/runtime-secret/operator/supervisor政策保持原样。共享全局release lock以后只可作为跨环境串行协调，不得承载环境数据；本次没有启用或修改该锁。
6. 当前只关闭Compose消费者侧阻断。release producer/operator的独立root适配、精确当前源码Web/Worker镜像及L2a空环境运行包仍缺失，所以TASK92继续`DOING`且新UAT仍未创建。

### Consequences

- 同机路径从“只有项目名前缀”提升为可机器验证的消费者隔离合同；生产配置行为不变，也没有第二套运行资源。
- 下一最小仓库工作是为release producer/operator定义同一UAT namespace的失败关闭适配，并保持生产策略独立；完成后才可提交L2a build/Secret/角色/空库0046/deploy授权申请。
- 首轮恢复模式仍为`DISPOSABLE_SYNTHETIC / RECREATE_FROM_EMPTY`，不能冒充备份恢复；真实样本、账号、公开HTTPS、业务写和生产仍按L3—L5分别授权。

### Rejected alternatives

- 拒绝把生产Compose改成宽泛的任意root参数，避免扩大生产策略和既有发布合同的攻击面。
- 拒绝只用`--project-name`后直接启动，也拒绝把静态Compose PASS解释为producer/operator、精确镜像、Migration或运行健康已通过。
- 拒绝为少于20人的系统建设通用多租户控制平面；只实现新UAT实际需要的一个隔离namespace，值可配置且不编码人员数量。

## D-174 同机UAT先冻结非执行控制请求合同，生产发布控制面保持独立

- 日期：2026-08-24
- 状态：`ACCEPTED / CONTROL REQUEST CONTRACT PASS / EXECUTION NOT IMPLEMENTED / RUNTIME NOT AUTHORIZED / PRODUCTION NO-GO`
- 发起：项目负责人要求继续下一步，并要求从第一性原理避免为少于20人的系统扩大平台复杂度
- 实施范围：只新增仓库policy、验证器、静态测试和非Secret输入；不创建运行对象或执行控制动作

### Context

- D-173已经关闭Compose消费者侧隔离，但生产release supervisor仍把authorization、artifact、identity、postdeploy、runtime secret、operator state和backup等root固定到生产namespace；直接参数化会同时扩大大量生产授权、摘要和安装边界。
- PostgreSQL operator的角色/reconciler/journal原语可复用，但其`ACTUAL_CONTROLLED` runner受生产policy和已安装supervisor约束。生产Migration入口同样要求完整release manifest和受控grant，不能用换项目名绕开。
- 小团队规模不会减少一物一码、事务、权限和数据隔离底线，也不要求复制一套通用多租户控制平面。当前只需要一个从空库建立的、可销毁重建的UAT namespace。

### Decision

1. 先建立`chenyida-erp-isolated-uat-control-plane-policy/v1`非执行请求合同。Policy固定`deployment_authorized=false`、运行动作空列表，并把下一授权明确为L2a精确build/Secret/角色/空库Migration/deploy；仓库合同本身不构成执行授权。
2. 六类host root必须由同一可配置Compose项目名机械派生：runtime Secret、operator credential、release candidate、release identity、operator state和synthetic backup。root彼此不得重叠或落入生产受保护范围；共享global lock只用于跨环境串行，不保存环境数据。
3. release producer和PostgreSQL operator后续只允许一个专用one-shot UAT入口。该请求明确禁止生产`release-supervisor-launcher.py`和`postgresql-runtime-privilege-runner.mjs`，生产policy、路径和默认行为不改。
4. 复用既有PostgreSQL角色、reconciler和append-only journal业务原语，不复制五套角色SQL。五个数据库登录角色是Web、Worker、Migration、Admin和Backup技术边界；员工人数、工程/计划/市场各约2人和总席位不进入基础设施合同。
5. 请求必须绑定当前package、`EMPTY → 0046`、46项Migration allowlist、精确Git commit/tree、Web/Worker registry/config digest及resolved Compose SHA-256。浮动tag、旧head、生产root/入口、额外动作、未知人员数字段或source digest漂移全部失败关闭。
6. 首个policy状态故意保持`CONTRACT_ONLY_NOT_EXECUTABLE`。只有专用adapter实现、静态/隔离测试及精确镜像完成后，TASK92才可形成L2a执行申请；本决策不允许先创建半成品目录或数据库。

### Consequences

- producer/operator的环境边界、角色/凭据映射、精确输入和合成重建范围已成为机器可验证请求，且不会改变生产supervisor攻击面。
- TASK92仍为`DOING`：当前缺口从“未定义producer/operator边界”收敛为“专用one-shot adapter未实现 + 当前源码精确镜像缺失”。新UAT仍未创建，不能试运行。
- 首轮失败只允许保留quarantine证据后删除精确UAT namespace并从空库重建；该策略不能替代真实备份或生产恢复。

### Rejected alternatives

- 拒绝把巨大生产supervisor改造成任意环境/任意root的通用平台，也拒绝复制一套完整生产控制面给单个UAT。
- 拒绝用生产runner、生产Secret/root或旧alpha.47镜像临时启动；消费者隔离不能替代producer授权和镜像身份。
- 拒绝为了人数少而合并为单一数据库超级用户，或把员工人数写死到角色、账号、容量、Schema或验收条件。
- 拒绝把静态request PASS解释为producer已实现、L2a已授权、环境已建立或可以试运行。

## D-175 隔离UAT的一次性入口先固定确定性计划，执行权限与动作实现继续分离

- 日期：2026-08-24
- 状态：`ACCEPTED / READ-ONLY PLAN ENTRYPOINT PASS / EXECUTION DISABLED / RUNTIME NOT AUTHORIZED / PRODUCTION NO-GO`
- 发起：项目负责人要求继续下一步；Codex按D-174和小团队第一性原理实现最小、可审阅入口
- 实施范围：只新增计划编译入口、失败关闭执行门和静态测试；不实现或调用任何运行时动作

### Context

- D-174已经冻结一个UAT namespace的输入，但仅有请求验证器时，目录、凭据、PostgreSQL、Migration、发布身份和服务启动的先后关系仍只存在于文字中。
- 当前既无精确HEAD镜像，也无L2a运行授权。若入口在此时直接带Docker、文件或数据库副作用，就会把“定义流程”误当成“允许执行”。
- 少于20人的规模不需要通用工作流引擎；当前只需一个固定顺序、无人员数量字段、可在授权前审阅的计划。

### Decision

1. 新增`isolated-uat-one-shot.py`作为唯一专用入口。默认命令只读取并验证D-174 request，输出规范JSON计划及内容摘要；不读取Secret值，不创建目录，也不调用Docker、数据库、Migration或生产控制面。
2. 计划固定九步：精确输入核对、私有root准备、独立凭据准备、仅启动PostgreSQL、复用既有PostgreSQL权限原语、`EMPTY → 0046` Migration、发布身份、启动Web/Worker、loopback只读就绪核对。步骤数是技术依赖，不是员工人数或席位。
3. `execute`命令在当前`deployment_authorized=false`、空运行动作和`CONTRACT_ONLY_NOT_EXECUTABLE`状态下必须在输出计划或调用执行器前返回`ISOLATED_UAT_ONE_SHOT_EXECUTION_NOT_AUTHORIZED`。
4. 计划明确把生产`release-supervisor-launcher.py`和`postgresql-runtime-privilege-runner.mjs`列为禁用入口；生产policy、路径、代码和运行面保持不变。
5. 本入口只关闭“顺序未机械定义”和“默认可能误执行”两个缺口。它不是可执行adapter、L2a授权、精确镜像、已建环境或试运行证据；下一步仍需实现固定动作绑定并单独取得精确build/运行授权。

### Consequences

- 当前request可以得到确定、可复算且不含人员基数的九步计划；重复输入得到相同`plan_sha256`，篡改步骤或请求运行动作均失败关闭。
- TASK92继续`DOING`，缺口收敛为“固定动作执行绑定 + 当前源码精确Web/Worker镜像”。新UAT没有创建，系统仍不能试运行。
- 后续实现动作时不得把当前计划入口扩为任意namespace平台，也不得以修改policy布尔值替代真实执行实现和隔离测试。

### Rejected alternatives

- 拒绝在无L2a授权时加入目录、Secret、Docker或数据库副作用，也拒绝输出可由shell直接拼接执行的自由命令列表。
- 拒绝复制生产supervisor、复用生产runner，或新增通用队列、daemon、多租户调度器。
- 拒绝把九步技术顺序解释为九个岗位、固定人数、并发或账号数量。

## D-176 隔离UAT九步动作使用封闭绑定目录，宿主执行器继续保持未实现

> 2026-08-24勘误：D-177证明本节v1顺序只能作为历史审计记录，不能作为runtime实现依据；v1文件和摘要保留不改，由v2取代。

- 日期：2026-08-24
- 状态：`ACCEPTED / FIXED ACTION BINDING CONTRACT PASS / RUNTIME ADAPTER NOT IMPLEMENTED / PRODUCTION NO-GO`
- 发起：项目负责人要求继续下一步；Codex依据D-175把计划动作绑定到最小既有原语
- 实施范围：只新增动作绑定目录、source binding和静态顺序测试；不实现宿主副作用

### Context

- D-175已把九步顺序机械化，但动作仍只有抽象executor名称；如果后续执行器可以自行选择脚本、命令或输入，就不能证明它执行的是已审阅流程。
- PostgreSQL权限、Migration和release identity已有可复用模块，但生产runner/supervisor及其授权/root不能用于新UAT。目录、凭据和Compose生命周期仍需要独立UAT宿主适配方法。
- 当前仍无精确HEAD镜像或L2a授权，因此本阶段只能冻结绑定，不得创建“半执行”的目录、Secret或数据库。

### Decision

1. 新增`chenyida-erp-isolated-uat-one-shot-action-bindings/v1`，固定九项`handler_id + adapter_method + sources + inputs + outputs`；步骤顺序、effect和跨步凭证依赖均失败关闭。
2. 绑定目录禁止shell、自由argv和生产入口。`release-supervisor-launcher.py`与`postgresql-runtime-privilege-runner.mjs`不得作为source或handler；当前CLI仍在任何动作前拒绝`execute`。
3. Compose动作只绑定基础、release和isolated三份Compose；PostgreSQL权限动作只绑定既有policy、operator、reconciler和append-only journal原语；Migration绑定现有engine/authorization模块；release identity绑定现有原子身份合同。
4. Migration动作必须从`EMPTY`精确到绑定head，并同时产出`release_candidate_receipt`和`migration_execution_receipt`；release identity随后消费两者。不得绕过Migration回执发布identity，也不得在identity通过前启动Web/Worker。
5. 所有绑定source都进入control policy摘要。Binding body SHA-256为`b5b3a7eb5a1a782290e2a37c5fed0ae8e09230696ae9da26d80398b0b2070276`；当前policy SHA-256更新为`01e35bd96971b45cf596767d7db7c554fd93225ec4c68223e092119c736ecb47`。
6. Binding状态固定为`FIXED_BINDINGS_RUNTIME_ADAPTER_NOT_IMPLEMENTED`。本决定不实现host root、凭据、Compose、PostgreSQL或Migration执行器，不修改`deployment_authorized=false`和空运行动作列表。

### Consequences

- 九步计划不再允许未来执行器自由选择实现来源；计划输出现在绑定binding ID/SHA/status和每步精确方法。
- TASK92继续`DOING`。当前剩余缺口为专用runtime adapter实现及其合成隔离测试、精确当前Web/Worker镜像和L2a授权；新UAT仍未创建、不能试运行。
- 人员数量仍不进入binding、输入、输出、动作数、角色、容量或验收；九步只是技术依赖。

### Rejected alternatives

- 拒绝输出可复制执行的shell/argv清单、允许执行器选择任意脚本，或使用环境变量指定handler。
- 拒绝直接调用生产runner/supervisor，也拒绝复制完整生产控制面。
- 拒绝把source binding和顺序静态PASS描述为runtime adapter、Migration执行或UAT健康。

## D-177 隔离UAT v2先修正物理依赖，生产发布身份不得冒充隔离证据

- 日期：2026-08-24
- 状态：`ACCEPTED / V1 SUPERSEDED / V2 DEPENDENCY ORDER PASS / RUNTIME PATH NOT IMPLEMENTED / PRODUCTION NO-GO`
- 发起：项目负责人要求继续下一步；Codex在实现adapter前对D-176绑定和既有原语做只读可执行性审计
- 实施范围：只新增v2绑定、补充确定性输入和静态测试；不实现或调用宿主、Docker、数据库、Migration、HTTP或发布动作

### Context

- D-176 v1虽通过跨步字段检查，但把完整runtime privilege reconcile放在空库Migration之前；现有reconciler要求0046完整对象和ACL，该顺序在物理上不能执行。
- v1又要求在Web/Worker启动前发布release identity，而生产v3 identity必须包含Caddy、PostgreSQL、Web、Worker四个真实容器身份及postdeploy receipt；manifest-only预造路径已被现有合同禁止。
- 生产v3 identity还绑定生产runtime policy和supervisor/authorization语义。新隔离UAT明确不复用生产supervisor，因此不能用伪摘要把生产身份合同冒充UAT证据。
- Compose Web主GID是`65532`，应用读取身份文件时核对主GID；若错误填写`1000`，它只会成为supplemental group，造成静态渲染通过但运行读取失败。UAT strict readiness还需要精确expected version/git。
- 当前source binding只证明动作列出的直接source有摘要，不证明其传递依赖闭包；现有Migration isolated测试入口也不产v2要求的UAT candidate/execution receipts。两者必须在runtime path实现前继续失败关闭。

### Decision

1. D-176的`isolated-uat-one-shot-action-bindings-v1.json`保持原文件和摘要不变，仅作历史证据；新增`chenyida-erp-isolated-uat-one-shot-action-bindings/v2`并由one-shot入口切换使用。v2 body SHA-256为`6f28881beb767f25e469b60f6ef9ae15e62d703659619ce3e7c8aa63e76d463a`。
2. v2固定九步为：精确输入核对；准备七类私有namespace roots；生成独立凭据；仅启动PostgreSQL并取得未标记集群身份；初始化UAT数据库身份和登录角色；`EMPTY → 0046` Migration；在完整Schema上收敛最终runtime privileges；启动Caddy/Web/Worker绑定服务；核对loopback并发布隔离UAT专用postdeploy/runtime identity evidence。
3. 第5步只允许建立数据库marker、owner/Migration和技术登录角色所需的最小前置，不得假称完整表级ACL已存在；现有完整privilege原语不能实现该前置，因此v2不把它列为第5步source，专用database-bootstrap合同仍未实现。第7步才绑定完整权限原语，并必须消费Migration execution receipt后执行最终reconcile。第6步同样不把现有生产受控/临时TEST migration入口列为UAT实现来源，专用授权与双回执合同未完成前保持未实现。
4. 第9步不再绑定生产`release-identity-contract.mjs`或生产postdeploy identity。隔离UAT evidence使用独立语义和`one_shot_state_root`；其专用合同、传递source闭包和typed runtime adapter尚未实现，不能把当前输出名当作已生成回执。
5. `release_identity_reader_gid`不再由请求任意提供，control policy机械固定为Web主GID`65532`；Compose source、非Secret示例和policy三者同源核对。`package_version`和`git_commit`显式进入服务启动输入，用于未来填充strict readiness的expected version/git。
6. 新增第七类`one_shot_state_root`承载幂等/失败账本和隔离证据。当前control policy SHA-256为`2197a633db282423f40ba0ac22e94dc27206bca6ed20f8eb332165811eac6271`；v2状态固定为`FIXED_BINDINGS_DEPENDENCY_ORDER_CORRECTED_RUNTIME_PATH_NOT_IMPLEMENTED`。
7. `deployment_authorized=false`、空`runtime_actions_authorized`和执行前拒绝保持不变。D-177只纠正合同，未授权创建目录、Secret、Docker对象、数据库、角色、Migration、部署或证据文件。
8. 只有action binding升级v2：D-176已把v1 body SHA作为独立不可变目录发布，必须保留勘误链。Control policy v1从D-174起就是由`policy_sha256`标识精确revision的未投产滚动envelope；本次仍无外部消费者且plan JSON字段集合未变化，因此不额外复制一套policy/plan文件。进入可执行门前必须冻结并重新评估其版本兼容性。

### Consequences

- 当前九步不再包含已知的空库ACL和预造生产identity矛盾，但仍不是可执行路径。TASK92继续`DOING`，新UAT仍未创建、不能试运行。
- 下一安全切片是先定义隔离UAT专用database-bootstrap、Migration和evidence回执与传递source闭包，再以注入式fake ports做合成runtime adapter测试；真实host filesystem、Docker/Compose、PostgreSQL、HTTP和发布端口继续未实现。
- 人员约2人、总用户少于20人仍只影响后续账号配置，不进入九步、GID、角色数量、容量或验收硬编码。`65532`是容器技术身份，不是席位数。

### Rejected alternatives

- 拒绝在v1文件上原地覆盖历史摘要，也拒绝在已知物理冲突上直接补executor。
- 拒绝预造Web/Worker/Caddy容器身份、复用生产runtime policy SHA或伪造supervisor/authorization证据。
- 拒绝把直接source摘要描述为传递依赖闭包，或把fake adapter PASS描述为Docker/数据库可执行。

## D-178 隔离UAT先冻结三族纯意图和回执字段描述，合成端口不得冒充运行证据

- 日期：2026-08-24
- 状态：`ACCEPTED / PURE INTENTS STRUCTURE VALID / SYNTHETIC PORT ORDER VERIFIED / RECEIPT VALIDATORS NOT IMPLEMENTED / RUNTIME BACKENDS NOT IMPLEMENTED / PRODUCTION NO-GO`
- 发起：项目负责人要求继续下一步；Codex按少于20人、小团队不建设通用平台的第一性原理收敛为单一纯模块
- 实施范围：只新增一份合同policy、一个无运行能力的纯函数模块、内存fake-port测试及只读计划摘要绑定；不实现或调用真实端口

### Context

- D-177/v2已纠正动作顺序，但第5、6、9步仍只有输出名；没有专用database-bootstrap、Migration双回执或隔离evidence语义时，输出名不能证明数据库、Migration或服务实际完成。
- 当前既没有L2a授权，也没有精确HEAD镜像。此时实现host filesystem、Docker、PostgreSQL、HTTP或publisher会把仓库合同误当成运行许可。
- v2自身明确只绑定直接source。为避免再建通用依赖图平台，本切片只给新纯合同模块冻结一个单文件、固定hash、固定import allowlist的source closure；它不是Python sandbox，也不声称覆盖v2全部动作的传递依赖。

### Decision

1. 新增`chenyida-erp-isolated-uat-runtime-contract-policy/v1`，只描述三族意图：数据库身份/五个技术登录角色最小bootstrap、`EMPTY → 0046` Migration与release candidate字段目录、以及loopback隔离evidence字段目录。当前package、46项allowlist、标准数据库marker、角色到独立凭据文件映射和Web技术GID`65532`均失败关闭；人员数量不进入合同。
2. 合同产物固定为`STRUCTURE_VALID / NOT_EXECUTED / NOT_PUBLISHED / NOT_AVAILABLE / predecessor chain NOT_VALIDATED`。receipt field semantics明确为`INCOMPLETE_DESCRIPTOR_ONLY`，真实receipt validator、publisher和runtime backend全部为`NOT_IMPLEMENTED`；合成fixture不得被当作真实回执消费。
3. 新增一个仅使用标准库纯函数的合同模块。其source closure固定为该单一仓库文件、无本地传递import、固定外部import allowlist和原始文件SHA；校验范围明确为source hash/import allowlist/direct builtin guard，`NOT_A_SANDBOX`。生产runner、supervisor、postdeploy、release identity和TEST执行入口继续禁止成为纯合同source。
4. 注入式合成adapter只调用三种typed fake port，验证`DATABASE_BOOTSTRAP → MIGRATION → EVIDENCE`的结构顺序、字段目录、失败即停和端口输入隔离。它明确输出`SYNTHETIC_CONTRACT_FIXTURE_ONLY`、`predecessor_chain_status=NOT_VALIDATED`，不生成、发布或验证任何真实receipt摘要链。
5. one-shot只读计划新增runtime contract policy/source closure SHA和能力状态；由于JSON字段集合发生不兼容变化，计划合同和entrypoint ID明确升级为v2，不沿用历史plan/v1名称。`execute`真实控制流在授权门之后只有一个runtime backend seam；当前policy仍在该seam之前返回`ISOLATED_UAT_ONE_SHOT_EXECUTION_NOT_AUTHORIZED`，backend固定未调用。
6. binding v1/v2文件保持字节不变；v2仍为当前动作顺序且继续声明`DIRECT_CONTRACT_REFERENCES_ONLY`。Runtime contract policy SHA-256为`5f24335aa436309427465b6cb1c5c7ecb3778f0945f3d7ed48598008a0456586`，纯模块closure SHA-256为`978741a0bf244cd40076cca49fbedd0a3e3045e047b795c488e40a40436bc939`，control policy SHA-256更新为`dd442418af220070b133063ea555dde0a1e1b4cfcc266ad1aa1706829b5c6150`。

### Consequences

- 第5、6、9步现在有可审阅的意图结构和未来回执字段目录，fake-port能证明三段调用顺序及首错停止；这仍不等于真实回执合同完整、前驱摘要链通过或runtime可执行。
- TASK92继续`DOING`。下一仓库切片只可补完整receipt字段语义/validator、前驱摘要链和binding v3接线；真实host/Docker/PostgreSQL/HTTP/publisher端口及精确镜像仍是L2a前阻断，新UAT没有创建。
- 小团队只承担一个隔离namespace和一个固定流程，不新增队列、daemon、通用工作流引擎、多租户控制平面或人员基数配置。

### Rejected alternatives

- 拒绝把required-fields目录命名为已实现receipt validator，也拒绝用格式正确但任意的SHA声称前驱已核验。
- 拒绝把AST denylist冒充Python capability sandbox，或把单文件纯合同closure描述为v2全动作传递closure。
- 拒绝在没有精确镜像、真实backend和专项授权时切换`deployment_authorized`、创建资源或执行Migration。

## D-179 隔离UAT只验证内部回执链，未验证外部根不得升级为运行证据

- 日期：2026-08-24
- 状态：`ACCEPTED / PURE INTERNAL RECEIPT CHAIN VALID / EXTERNAL ANCHORS NOT EVALUATED / PUBLISHERS AND RUNTIME BACKENDS NOT IMPLEMENTED / PRODUCTION NO-GO`
- 发起：项目负责人要求继续下一步；Codex按小团队单一namespace、固定流程和最小能力边界完成D-178的下一仓库切片
- 实施范围：只新增纯回执policy/validator、binding v3和静态测试；不读取运行环境、创建资源、发布回执或执行任何UAT/生产动作

### Context

- D-178已经冻结三族意图与字段目录，但`INCOMPLETE_DESCRIPTOR_ONLY / predecessor NOT_VALIDATED`不能证明字段值、前驱连续性、角色/ACL、Migration ledger或容器身份一致。
- 调用方能够提供一个格式正确且自洽重签的JSON时，若validator只验摘要格式或允许调用方自选binding/intent validator，就会把自签声明误当成受策略约束的证据。
- 当前没有L2a、精确HEAD镜像、外部root/credential/cluster validator或publisher。纯函数可以验证内部语义与引用闭包，但不能观察一个目录、容器、数据库或HTTP请求是否真实存在。

### Decision

1. 新增独立`runtime-receipt-policy/v1`和单一纯函数validator。它只消费注入JSON及source bytes，不具备文件系统、Docker、数据库、网络、时钟、随机数、进程、Secret、publisher或任意回调能力；不为少于20人的系统增加队列、daemon、通用证据平台或多租户控制面。Intent/privilege/binding三个依赖raw SHA由执行validator常量固定；receipt policy raw/internal SHA只匹配调用方传入的expected roots，不能把调用方本身描述为受信根。
2. 冻结八类回执和五类证据体的精确字段、producer及语义，机械验证project/request/operation、数据库身份、46项Migration allowlist/applied ledger、五角色完整属性、ACL、release/image、非零且唯一的容器身份、网络/health、loopback、规范时间和前驱摘要连续性。控制请求在进入plan前同样拒绝全零Git commit/tree、Compose摘要及Web/Worker manifest/config摘要；策略摘要非字符串、深层恶意嵌套、自洽policy/receipt重签、跨项目/跨意图拼接、非法Unicode和PostgreSQL身份越界均转换为稳定合同错误并失败关闭。一小时链龄从首个bootstrap observation起算，但仅相对调用方注入、未认证的verification time成立。
3. 成功结果只允许命名为`VALIDATED_PURE_INTERNAL_CONTRACT_CHAIN_FROM_UNVERIFIED_EXTERNAL_DIGEST_ANCHORS`；四个业务外部摘要根及control plan的状态固定为`NOT_EVALUATED`，verification time固定为`CALLER_INJECTED_NOT_ATTESTED`，runtime evidence固定为`NOT_ESTABLISHED_BY_PURE_VALIDATION`。格式/引用有效不等于对应root、credential、cluster、one-shot状态、plan或宿主时钟真实可信。
4. 新增action binding v3和18节点predecessor目录，并由receipt policy同时钉住v3 body/raw SHA；调用方不得提供任意expected binding SHA。历史v1/v2文件保持字节不变，one-shot因输出字段不兼容明确升级为plan/v3。计划阶段只输出`NOT_RUN_NO_RECEIPTS`和成功输出合同模板，不把尚未消费回执的模板称作验证结果；在返回计划前必须二次读取source state并与请求/策略包核对，检测到并发漂移即失败关闭。
5. Runtime privilege仅作为既有policy的隔离UAT acceptance projection；owner侧完成日志尚无隔离operator profile。D-178 evidence intent v1未承载Caddy server name，因此Host/SNI信任绑定明确不在当前证明范围，必须由后续intent v2补齐。
6. 原子publisher、外部anchor validator、全动作传递source closure和host/Docker/PostgreSQL/HTTP adapter继续为`NOT_IMPLEMENTED`。`require_receipt_publisher()`固定失败关闭；即使未来先改变执行授权，也不得绕过publisher门进入旧runtime backend。
7. `deployment_authorized=false`、空运行动作和生产入口禁用保持不变。本决策不授权目录、Secret、容器、网络、Volume、数据库、角色、Migration、build、deploy、restart、账号或业务写。

### Consequences

- 第5、6、7、9步现在有受执行validator固定dependency roots及调用方expected receipt roots约束、可重复验证的内部语义与摘要链；重签一个局部对象不能跨过固定producer、连续性、ledger、binding和相对时间门。该结论不把caller-supplied roots或caller-injected time升级为受信运行根。
- TASK92仍为`DOING`，新UAT仍未创建且不能试运行。下一安全切片是补外部root/credential/cluster与owner完成日志validator、Caddy Host/SNI intent v2和全动作传递closure；再实现原子publisher/runtime adapters及精确镜像，最后才形成L2a申请。
- 纯validator输出可用于未来运行端口的验收，但在publisher和外部anchor validator落地前只能作为仓库合同证据，不能写成运行完成、UAT健康或可试运行。

### Rejected alternatives

- 拒绝让调用方注入任意intent validator、expected binding SHA或泛化publisher，也拒绝只验JSON摘要后把自签对象标为真实证据。
- 拒绝把四个业务外部摘要根、control plan或调用方时钟的格式/相对检查描述为已验证来源，或把合成fixture、loopback leaf observation描述为Host/SNI/容器/数据库实测。
- 拒绝在缺少精确镜像、publisher、runtime backend和专项授权时创建隔离UAT或复用生产supervisor/runner。

## D-180 隔离UAT外部锚点只建立纯合同连续性，不建立宿主运行事实

- 日期：2026-08-24
- 状态：`ACCEPTED / PURE EXTERNAL ANCHOR CONTRACTS VALID / SOURCE CALLER-INJECTED NOT ATTESTED / PUBLISHER AND RUNTIME BACKEND NOT IMPLEMENTED / PRODUCTION NO-GO`
- 发起：项目负责人继续要求“下一步”；Codex按单一小团队UAT、最小仓库切片和失败关闭原则推进D-179之后的第一个外部边界
- 实施范围：只新增external anchor policy/纯validator、binding v4及静态测试；不观察宿主、不创建资源、不发布回执，也不执行UAT或生产动作

### Context

- D-179已经能验证18节点内部回执语义与前驱摘要链，但四个external digest anchors和control plan仍是未验证入口。没有固定外层语义时，调用方可以用格式正确、相互自洽的root、credential、container或cluster声明喂给内部链。
- 一个纯函数可以核对注入对象的精确字段、摘要和跨对象连续性，却不能证明目录、文件、容器、网络或PostgreSQL cluster真实存在。把纯合同通过写成运行事实，会绕过后续host observer、publisher和授权边界。
- 本系统少于20人且只有一个目标UAT namespace；不需要通用证据服务、队列、daemon、多租户控制面或按员工人数扩容。员工数量继续只属于应用账号配置，不进入基础设施合同。

### Decision

1. 新增`external-anchor-policy/v1`和单一纯函数validator，只消费调用方注入JSON及显式source bytes。模块不导入filesystem runtime observer、Docker、数据库、网络、时钟、随机数、进程、shell或Secret能力；source closure明确只是静态hash边界，不是sandbox或运行证明。
2. Control plan必须精确为plan/v4，并由执行模块常量固定action binding body/status、runtime contract policy与source closure/capability、runtime receipt policy与source closure/capability/success template、receipt validation状态和完整receipt-chain binding。调用方不得通过重签把publisher/backend改为已实现、把runtime evidence改为已建立或把chain替换为任意版本。
3. Namespace root receipt必须覆盖同一可配置project派生的七个root，并提供从`/`到每个parent的完整ancestor chain。祖先必须为root所有、不可被group/other写、类型为directory且非symlink；root固定uid/gid/mode。每个身份同时携带device/inode、mount ID/point/root/source；路径必须是单前导斜杠、无`..`组件的规范绝对路径，mount root/source不得落入三类生产保护树。物理别名按`device+inode`拒绝，不能靠更换mount ID绕过。七root还必须彼此不重叠。该规则验证调用方提供的metadata合同，不声称模块亲自执行`stat`、`findmnt`或观察mount。
4. Credential generation receipt只允许七份普通文件metadata：六份runtime Secret和独立backup service。固定consumer/root/filename/uid/gid/mode/nlink/size、`REGULAR_FILE`、非symlink、与所属root一致的mount描述及唯一物理identity；凭据不得与任何namespace root/ancestor物理别名。严格字段集拒绝Secret正文和内容摘要。`all_values_distinct`仅保留为producer assertion，状态必须明确`NOT_REVALIDATED_WITHOUT_SECRET_EXPOSURE`。
5. PostgreSQL container identity固定project、Compose摘要、非零容器ID、digest-pinned PostgreSQL镜像/config digest、唯一内部backend网络与network mode、`published_ports=[]`、两个项目Volume、只读bootstrap Secret bind、三项精确tmpfs、runtime secret root identity及running/healthy；任何额外network、port、mount或tmpfs漂移都失败关闭。Database cluster identity固定数据库名、container/credential前驱和合法system identifier投影。四个对象时间只验证规范UTC毫秒与单调顺序，不冒充可信宿主时钟。
6. 成功输出只允许`PURE_EXTERNAL_ANCHOR_CONTRACTS_VALID`、`SOURCE_CALLER_INJECTED_NOT_ATTESTED`、`CONTROL_PLAN_CONTRACT_CONTINUITY_VALID_SOURCE_NOT_ATTESTED`、`AUTHORIZATION_NOT_ESTABLISHED`和`NOT_ESTABLISHED_BY_PURE_VALIDATION`。外锚结果尚未在运行时与D-179内部链机械join；任何运行或L2状态升级前必须由后续受控端口完成同一plan和四anchor等值桥接。
7. 新增binding v4，但对v3九动作和18节点只允许`EXACT_NO_OVERRIDE`继承；仅在相关步骤增加external policy/validator source及五个外层节点/四个anchor映射。历史v1—v3保持字节不变，v3继续只作为D-179内部链基座。
8. `require_external_anchor_publisher()`固定失败，且位于旧receipt publisher/runtime backend之前。`deployment_authorized=false`、空运行动作和生产入口禁用不变；本决策不授权目录、Secret、容器、网络、Volume、数据库、角色、Migration、build、deploy、restart、账号或业务写。

### Consequences

- 调用方不能再仅靠自洽重签把外层plan capability、成功模板、root、credential、container或cluster结构升级为可接受合同；畸形source类型、不安全祖先权限、受保护mount、跨mount-ID别名、非普通凭据、跨plan拼接、额外网络/端口/bind、生产Volume名、非法system identifier和非单调时间均以稳定合同码失败关闭。
- 通过结果仍只是“这些注入对象满足当前执行validator的固定规则”。由于source和观察值不是由本模块认证产生，它不能被写成UAT已创建、目录/Secret已生成、PostgreSQL已启动或运行证据已发布。
- TASK92继续`DOING`。下一安全切片只补隔离operator owner完成日志纯合同，并把`operator_state_root`身份纳入连续性；之后再分别处理Caddy Host/SNI、全动作source closure、publisher/runtime adapters、精确镜像和L2a申请。

### Rejected alternatives

- 拒绝让调用方提供expected binding/policy/closure/capability/success-template roots，或只检查这些字段是64位摘要后接受自签计划。
- 拒绝在纯validator中读取Secret值或保存Secret内容摘要来证明“各值不同”；producer assertion与后续受控生成器责任保持分离。
- 拒绝把v4复制成第二套九步动作目录、修改冻结v3，或把owner日志、Host/SNI、全动作closure、publisher和runtime backend一次塞入同一大切片。
- 拒绝因本切片静态测试通过而创建同机UAT、连接PostgreSQL、build镜像或申请运行授权。

## D-181 隔离UAT owner完成日志必须重验两条固定上游链并保持operator root身份连续

- 日期：2026-08-25
- 状态：Accepted（仓库纯合同边界；不授权L2a或任何运行副作用）
- 发起：项目负责人继续要求“下一步”；Codex按单一小团队UAT、最小静态切片和失败关闭原则推进D-180之后的owner边界

### Context

- D-179能验证内部receipt chain，D-180能验证外部namespace/credential/PostgreSQL anchors，但二者的validation output若由调用方直接传入owner层，仍可被伪造后自签；生产operator的journal成功语义也尚未投影到隔离UAT合同。
- One-shot active plan升级后同时存在当前控制计划摘要和冻结外锚/内部回执使用的v4摘要。继续使用模糊`plan_sha256`会让adapter无法确定每类回执应绑定哪一个计划。
- 不到20人的单一内部UAT不需要新建工作流平台、证据服务或通用编排器；只需要一个可审阅的owner完成日志纯合同，并继续保持运行端口关闭。

### Decision

1. 新增`chenyida-erp-isolated-uat-owner-completion-policy/v1`和纯validator。它不信任调用方提供的D-179/D-180 validation envelope，而是从原始外锚、intent、receipt和evidence bundle调用固定绑定模块重新执行`validate_control_plan`、`validate_external_anchor_contracts`和`validate_receipt_chain`。
2. External policy必须逐对象等于owner source closure中固定raw文件；owner closure成员的usage按path精确固定。生产journal/operator/reconciler仅作`REFERENCE_PRIMITIVES_ONLY_NOT_EXECUTABLE`语义参照，生产runner/supervisor仍禁止成为隔离执行入口。
3. Owner完成日志必须同时绑定active v5控制摘要和base v4收据摘要、同一operation/request/project、namespace/credential/container/cluster/database/Migration/runtime privilege前驱，以及同一`operator_state_root`准备/完成identity。正常成功路径的recovery authorization必须为空。
4. Journal成功阶段固定为`PREPARED → AUTHORIZATION_CONSUMED → TRANSACTION_DISPATCHED → POSTCOMMIT_CAPTURED → VERIFIED → COMMITTED`；终态只接受`COMPLETED/VERIFIED`。隔离receipt使用`final_privilege_projection_sha256`，不得冒充生产operator的structure report摘要。
5. 因果时间固定为cluster observation不晚于Migration observation/completion和owner intent；runtime observation必须位于transaction dispatch与postcommit capture之间，runtime receipt不晚于COMMITTED，owner receipt不晚于调用方verification time。所有时间仍是caller-injected、not-attested。
6. 新增binding/plan v5但只对v4作additive extension。`plan_digest_routing`显式区分active v5控制摘要与v4 legacy receipt摘要；action 7/9的新增输入、三个runtime bundle、validator完整参数映射和固定四步验证顺序必须机械闭合。v1—v4原字节不得修改。
7. 成功输出仍必须包含`SOURCE_CALLER_INJECTED_NOT_ATTESTED`、`AUTHORIZATION_NOT_ESTABLISHED`、`NOT_PUBLISHED`和`NOT_ESTABLISHED_BY_PURE_VALIDATION`。Publisher、runtime observer和runtime backend继续固定失败关闭；本决策不授权创建目录、Secret、容器、Volume、数据库、Migration、账号或业务数据。

### Consequences

- D-181现在能在纯函数边界内机械join D-179、D-180和owner journal，并拒绝自签plan/policy/validation/observation、双计划摘要混用、operator root替换、阶段跳转、终态漂移及跨链时间倒置。
- Binding v5 body/raw SHA为`349fb247d271d3c749129c151ebb0b3c7054b64f5ee0c5646ea9e1d238c49c3f`/`95bbf9a263818886072a29f486a53acb752687dcd4d5cd086283336dcbb77363`；owner policy内部/raw/closure为`47d70021…87d0`/`e86831d5…5cf5`/`4238653e…055b`。v1—v4 raw SHA保持不变。
- 69项聚合Unit、隔离Compose双门及两路独立最终复核P0=0/P1=0只证明仓库静态合同成立，不证明宿主目录、Secret、PostgreSQL、权限、journal或网络事实已被观察。
- TASK92继续`DOING`。下一独立切片只处理Caddy Host/SNI纯intent/contract；全动作closure、publisher/runtime adapter、精确镜像及L2a仍分别受阻。

### Rejected alternatives

- 拒绝信任调用方传入且仅自摘要正确的D-179/D-180 validation output。
- 拒绝让active v5和base v4共用一个含义不明的`plan_sha256`，或修改冻结v4及更早binding。
- 拒绝把`desired_state_sha256`称为`final_structure_sha256`，以及在没有structure report bytes时声称生产结构报告已验证。
- 拒绝在本切片实现publisher、宿主observer/runtime backend，或因纯合同PASS而创建同机UAT。

## D-182 隔离UAT的连接地址、HTTP Host、TLS SNI与Public Origin必须形成同一localhost合同

- 日期：2026-08-25
- 状态：Accepted（仓库纯intent/contract；未观察TLS、HTTP或运行事实）
- 发起：项目负责人继续要求“下一步”；Codex按少于20人的单一同机UAT、最小静态切片和失败关闭原则推进D-181之后的Caddy边界

### Context

- D-178 evidence intent v1只绑定loopback端口和任意叶证书摘要，历史readiness状态明确为`NOT_VALIDATED_MISSING_BOUND_SERVER_NAME`；它不能证明请求Host、TLS SNI、证书hostname和应用Public Origin属于同一个名字。
- 既有隔离示例在`ERP_ENV=production`下使用`http://127.0.0.1:<web-port>`作为Public Origin，未来Web会按现有配置校验拒绝HTTP；隔离overlay又未绑定`ERP_DOMAIN`，Caddy会回退到`erp.invalid`。这两项静态矛盾必须先于任何运行申请关闭。
- 单一同机UAT不需要DNS服务、证书平台、通用探针系统或按员工人数配置基础设施。固定连接loopback、固定本地server name并保留后续受控运行观察即可。

### Decision

1. 同机隔离边界固定连接地址为`127.0.0.1`，server name、HTTP authority host、Host header、TLS SNI、`ERP_DOMAIN`和Public Origin host全部固定为`localhost`；Public Origin固定为`https://localhost:<published-caddy-https-port>`。Web直接loopback端口只保留运维探针用途，不再作为Public Origin。
2. `compose.uat-isolated.yml`必须显式设置Caddy `ERP_DOMAIN=localhost / ERP_HTTPS_PORT=443`，并用隔离Caddy HTTPS发布端口覆盖Web的`ERP_PUBLIC_ORIGIN`。`.env.uat-isolated.example`同步表达同一非Secret示例；Compose纯静态validator同时拒绝HTTP Origin、非localhost Caddy环境和端口漂移。
3. 新增独立`caddy-host-sni-policy/v1`及纯模块。模块只消费调用方注入JSON/source bytes，固定Host/SNI expectation、证书必须满足受信链与精确DNS name、禁用insecure skip verify、runtime DNS、proxy环境和redirect following；不导入网络、HTTP、TLS、Docker、进程、文件系统运行观察、时钟、Secret或publisher能力。
4. Source closure固定绑定隔离env/Compose、基础Compose、Caddyfile、应用Origin配置、D-178/D-179 policy及执行纯模块。通过只表示这些调用方注入bytes与已审阅摘要一致；`STATIC_CONFIG_CONTRACT_BOUND_RUNTIME_NOT_OBSERVED`不得改写为Caddy已加载或证书已签发。
5. Evidence intent v2必须完整重验嵌入的evidence intent v1，并同时携带、按固定角色校验active v6、owner base v5和external/receipt base v4三个互不相同的完整计划；v6→v5→v4必须按确定性投影精确一致，计划中的request/project/ports/policy、源码身份、Compose摘要及Web/Worker镜像必须与Host/SNI expectation和v1基础证据连续。该检查不冒充九步计划的全语义重验；v1 readiness receipt及原18个内部、5个外部节点保持原字节/原语义，不能借v2把历史`NOT_VALIDATED_MISSING_BOUND_SERVER_NAME`升级为运行通过。
6. Binding/plan v6只对冻结v5作additive extension：action 8声明生成Host/SNI expectation，action 9消费expectation和原evidence intent v1并声明v2/validation输出；v1—v5字节不得修改。One-shot默认仍只输出只读计划，`execute`仍在任何backend前因未授权失败。
7. 纯合同不证明Caddy本地CA已被客户端信任、证书SAN匹配、错误SNI/Host被拒绝、反向代理健康或HTTP高端口重定向Location正确。尤其容器内443与宿主高端口转换未经运行观察，redirect状态必须保持`NOT_ESTABLISHED_CONTAINER_HOST_PORT_TRANSLATION_UNOBSERVED`。
8. 本决策不授权创建UAT、目录、Secret、证书、容器、网络、Volume、数据库、Migration、账号或业务数据，也不授权build、deploy、restart、HTTP/TLS探针或发布回执。

### Consequences

- 静态配置不再同时表达production-mode HTTP Origin与`erp.invalid`默认站点；未来受控运行端口获得了唯一、可测试的`127.0.0.1 + localhost Host/SNI + HTTPS Origin`输入合同。
- Binding v6 body/raw SHA为`f1a3fd38d0a49eea284caa704016d92de336e2eafb4d46a4fd23c59113266dc5`/`459bb65d42c71551797bf4cbf56a022700780caeb8a3d987b51bd96560d9f1f0`；Host/SNI policy内部/raw/closure为`dad404daf3d0d6348242184e9157fa8e80615a3b2b630f5c54708896fb753010`/`c3edf759d2b342f91931c4b529f993c89cae72656a4fa951b06b9be72c30f39a`/`cde30bd66d1973768ac0be29f41c1b077843ca69cef9496350ddd28ca250cedc`。所有公开入口重验固定policy/source bytes，且D-178/D-179 upstream raw锚点与closure成员、注入bytes必须三方一致；v1—v5 raw SHA保持不变。
- 聚合80项Unit与隔离Compose静态双门通过，只证明合同与投影成立；新UAT仍未创建、不能试运行。TASK92继续`DOING`，下一独立切片处理全动作传递source closure，随后才分别处理publisher/runtime observer/backend、精确镜像和L2a申请。

### Rejected alternatives

- 拒绝为单一loopback UAT引入公共DNS、独立证书服务、探针平台、队列或按“每部门两人”硬编码容量/账号数。
- 拒绝把`127.0.0.1`同时当作TLS server name，或继续让HTTP Web直连地址充当production Public Origin。
- 拒绝仅凭Location摘要、叶证书摘要或静态配置摘要声称TLS hostname、信任链、错误SNI拒绝和反向代理运行正常。
- 拒绝修改冻结v1—v5、给旧receipt链追加伪运行节点，或因本切片PASS而创建/启动同机UAT。

## 待确认业务决策

完整清单位于 `docs/material-master/business-decisions.md`。`B01` 已通过 D-006 确认，`B03` 已通过 D-011 确认；数据责任人、多角色审核节点、其他生命周期细则和首期迁移范围仍需人工确认。未确认项不得写入生产业务规则，任何生产迁移或部署仍需单独授权。
