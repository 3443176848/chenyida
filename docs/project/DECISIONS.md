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

## 待确认业务决策

完整清单位于 `docs/material-master/business-decisions.md`。`B01` 已通过 D-006 确认，`B03` 已通过 D-011 确认；数据责任人、多角色审核节点、其他生命周期细则和首期迁移范围仍需人工确认。未确认项不得写入生产业务规则，任何生产迁移或部署仍需单独授权。
