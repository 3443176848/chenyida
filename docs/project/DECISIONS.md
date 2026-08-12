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
- 状态：`ACCEPTED AS IMPLEMENTATION BASELINE / IMPLEMENTATION IN PROGRESS / RUNTIME NOT AUTHORIZED`
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

- TASK44会把源码版本推进到alpha.45、Migration head推进到0044，并新增并发、Migration、Handler及隔离PostgreSQL证据；在实现和验收完成前，本决定不构成风险关闭。
- 0044应用后，创建已超过24小时的历史会话会在下次认证时终态化；升级/部署计划必须提前告知受影响用户重新登录，不得静默延长旧会话。
- 每次有效访问仍有受控数据库写入；后续容量任务应验证真实会话并发，但不得以性能理由绕过锁、deadline或审计。
- 本决定不修改岗位角色、业务权限、MFA、密码策略、登录失败阈值、并发会话数、health/Worker/storage探针，也不授权运行面变更。

### Rejected alternatives

- 拒绝只依赖Cookie `Max-Age`、浏览器过期或Node应用时钟承担服务端授权。
- 拒绝继续SELECT后独立UPDATE并忽略row count，或通过重试把absolute deadline滑动延长。
- 拒绝每次过期请求重复写审计、把未知token细分给客户端，或只在`/api/session`清Cookie而让普通受保护API继续携带失效凭据。
- 拒绝回写已发布Migration或把岗位权限、health和会话安全混成同一任务。

## 待确认业务决策

完整清单位于 `docs/material-master/business-decisions.md`。`B01` 已通过 D-006 确认，`B03` 已通过 D-011 确认；数据责任人、多角色审核节点、其他生命周期细则和首期迁移范围仍需人工确认。未确认项不得写入生产业务规则，任何生产迁移或部署仍需单独授权。
