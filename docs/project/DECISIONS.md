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

## 待确认业务决策

完整清单位于 `docs/material-master/business-decisions.md`。`B01` 已通过 D-006 确认，`B03` 已通过 D-011 确认；数据责任人、多角色审核节点、其他生命周期细则和首期迁移范围仍需人工确认。未确认项不得写入生产业务规则，任何生产迁移或部署仍需单独授权。
