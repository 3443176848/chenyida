# 晨亿达ERP项目总控

> 最高优先级：任何新的 Codex 对话必须先阅读本文件，再继续当前任务。

## 项目名称

晨亿达ERP（Chenyida ERP）

## 项目目标

打造适用于 PCB、FPC、SMT 行业的 ERP，以统一内部编码连接物料、产品、BOM、采购、库存、生产、销售、财务和品质。

长期目标是建立 AI 物料主数据中心（Material Master），最终实现：

- AI 物料治理
- AI 采购
- AI 报价
- AI 生产辅助
- 行业物料知识库

AI 只提供建议、证据和辅助决策，不得未经审核直接创建、合并或覆盖正式物料数据。

## 文档权威顺序

1. `AGENTS.md`：全仓库不可放宽的工程、安全和生产保护规则。
2. 本文件：项目目标、当前结论、当前任务和下一任务。
3. `TASKS.md`：任务状态、依赖和责任人。
4. `PROJECT_CONTEXT.md`：新对话恢复上下文的事实基线。
5. `DECISIONS.md`：已确认决策及仍待确认事项。
6. 当前任务文档：本次工作范围和验收标准。

实际代码和生产状态与文档冲突时，必须先核验并更新文档，不得凭聊天记忆继续开发。

## 当前状态

快照时间：2026-07-17（Asia/Shanghai）

| 项目 | 当前值 |
| --- | --- |
| 当前版本 | 尚未建立统一 ERP 发布版本；在线 Site `package.json` 为 `0.1.0` |
| 当前 Branch | 根仓库 `main` |
| 当前根仓库基线提交 | `0b01c13`，`docs: approve import normalization review ui`；`PHASE3-TASK04` 开始时仅有用户既有未跟踪 `.obsidian/`，本任务未修改或提交该目录 |
| PM-000 基线父提交 | `bbefb2e`，`feat: add chenyida erp site project files` |
| 当前生产版本 | Sites 项目状态 `active`、公开访问，线上版本 `v3` |
| 当前 Site 源码版本 | 生产对应提交 `2b4f178`；纳入根仓库前的开发提交为 `9f2c2dc`；根仓库直接跟踪其完整源码 |
| 当前生产网址 | `https://chenyida-erp-online.sjin74376.chatgpt.site` |
| 当前数据库 | 本地 SQLite 26 张业务表；在线 D1 开发 schema 在 `0006` 新增 3 张 Normalization 表；`0006` 仅在一次性隔离 D1 验证，尚未执行生产迁移 |
| 当前开发环境 | Windows / PowerShell 5.1 / Git 2.52 / Node 26.3 / npm 11.16 / 项目绑定 Python 3.12.13 |
| 当前阶段 | Phase 3 Normalization 后端与 Review UI V1 非生产实现完成；生产环境未改变 |
| 当前任务 | `PHASE3-TASK04` 已完成本地实施与增量验证；计划提交消息为 `feat: add import normalization review ui` |
| 下一任务 | 当前无活动任务；分类、匹配、Draft、生产迁移或部署仍需另行授权 |

## 当前完成模块

以下模块已有可运行代码，但“已实现”不代表已达到 V2、审计或生产成熟度标准：

- 多用户登录、会话、角色权限、密码修改、账号管理和操作审计
- 物料、供应商映射、CSV 导入、清洗队列和新物料建档基础流程
- 客户、供应商、产品、BOM 和 BOM 齐套分析
- 采购建议、采购订单、收货、库存余额和库存调整
- 工单、领料、完工和生产报工
- 询价、报价、销售订单和发货
- 品质检验、缺陷记录、财务单据、收付款和经营看板
- 本地备份/恢复入口及在线同库快照入口
- 根仓库可直接恢复 `chenyida_erp_site/` 完整源码；生产 `2b4f178` 与开发基线 `9f2c2dc` 的提交关系已保留
- development/test/production 统一环境清单、本机一次性 Miniflare D1、生产 URL 拒绝、测试数据销毁和凭证扫描基线
- Material Master V2 数据契约与迁移框架：12 张关系表、Drizzle schema、`0001` Up/Down、快照和隔离迁移测试；未接入业务或生产
- Material Master V2 行业基础：`material-category-v1` 提供 101 个四级分类节点、34 个属性定义、39 个叶子模板和 228 条显式绑定；只允许 test/local 初始化
- Material Master V2 独立物料校验：Repository + Rules + Service 三层按 D1 metadata 校验基础字段、四级叶子、必填、类型、单位和枚举；25 个结构化 code、28 个校验测试；已由草稿/审核写服务调用并通过 Draft/Review API 间接开放
- Material Master V2 草稿/审核写服务：六模块封装类型化属性、`DRAFT -> ACTIVE`、拒绝历史、版本/审计、编码序列 CAS、乐观锁及 metadata/属性守卫；12 个隔离 D1 服务测试通过，已由 Draft/Review API 调用，尚未接生产
- Material Master V2 Draft/Review/Lifecycle API：八个精确路由复用现有会话，支持完整替换编辑、提交/重新提交、审核队列、批准和驳回；实施细粒度权限、创建人/最后修改人职责分离、Origin/CSRF、24 小时持久幂等、60/20 限流、乐观锁、1095 天 API 审计及 `0002`/`0003` 隔离迁移；未接生产
- Material Master V2 Reference & Query API：方案 A 已实现统一 `/materials`、收紧 `/drafts` 行级可见性并保留独立 `/review-queue`；完整启用分类 tree/flat、四级叶子 Schema、内容摘要 ETag、有界详情摘要、独立历史分页、批量 metadata 与稳定错误均通过隔离测试；未接生产
- Material Detail 最近驳回投影：`/materials/:materialId` 与 `/drafts/:materialId` 复用统一 Query Service，从完整不可变 `material_versions` REJECT 历史按版本、审核时间和事件 ID 确定性 `LIMIT 1` 投影；无记录为 null，损坏历史 fail-closed；未改 Schema、migration、索引或写服务
- Material Master 只读管理界面 V1：四条原生 Vinext 路由实现高密度列表、分区详情、独立历史页签、URL 状态、安全返回、状态/属性/Validation 展示和完整加载/空/错误状态；legacy 与新页面共用浏览器请求边界和现有登录流程；未接生产
- Material Draft 创建、编辑与提交审核界面 V1：实现 `/materials/new`、`/materials/:materialId/edit`、布局 C、Schema 驱动五类属性与完整 PATCH、PATCH/GET/submit、权限入口、页面内存幂等安全重试、VERSION_CONFLICT 对照、Schema 漂移/未知属性/dirty/驳回信息保护；54 项 UI 验收与隔离浏览器链路通过，未改 API、Schema、Migration 或业务服务，未接生产
- Material Review Queue 与审核工作台 V1：实现 `/materials/review`、`/materials/:materialId/review`、服务端分页 URL 队列、方案 A 完整只读工作台、共享详情展示、批准/驳回、Validation 新鲜度确认、职责分离、页面内存幂等/结果未知/并发/离开保护及 51 项 UI 验收；未改 API、Schema、Migration、索引或业务服务，未接生产
- Material Import Batch Foundation V1：12 项决定已批准；新增 `0004` 五表数据契约、Drizzle schema/快照/Down、可注入对象存储与 R2/内存适配器、10 MiB 流式 multipart、XLSX/CSV 文件级安全检查、六个 API、专用幂等、可恢复 Saga、权限/行级可见性、重复策略、取消和手工清理服务；未创建生产资源、Cron、迁移或部署
- Material Import Parser 与 Mapping V1：16 项决定已批准并完成非生产实现；新增 `0005` Up/受保护 Down、parse run/Sheet/Shared Strings/Outbox/Mapping 关系模型、有界 XLSX/CSV Parser、可注入调度与租约恢复、原子发布、Mapping 准备及七个 API；54 项专项与全量 Node 278/278 通过，未创建生产资源、执行生产迁移或部署
- Material Import Workspace UI V1：完成三条路由、状态驱动 Stepper、opaque cursor、文件预检、增量 SHA Worker、受控 multipart XHR、解析轮询/取消、Sheet/Rows/Header、三列 Mapping 保存/预览/确认和 confirmed 只读；UI-001—UI-100、50×256 Playwright 门禁与 Node 440/440 通过，未接生产
- Material Import Mapping Target Catalog V1：12 项决定已批准；实现批次作用域 `GET .../:batchId/mapping-targets`、BASIC/ATTRIBUTE/SPECIAL DTO、运行时 D1 ACTIVE 属性、共享 Target Registry 与 Metadata Snapshot/digest、有界搜索/cursor、read+map/行级可见性、no-store、读取限流和安全审计；51 项专项与全量 Node 339/339 通过，未改 Schema/Migration/前端或生产环境
- Material Import Normalization & Staging V1：16 项决定已批准；实现独立 normalization run、版本化 JSON 行快照、独立 issue、Mapping/Metadata 绑定、确定性类型与空值语义、Outbox/租约/心跳、原子 pointer 发布、不同 processor 版本重跑、取消清理、五个 API、权限/限流、`0006` Up/受保护 Down/Drizzle 快照及隔离测试；未创建 Draft/正式物料，未接生产
- Material Import Normalization Review UI V1：统一 Batch 工作区、七步 Stepper、`current_run/latest_attempt` 双轨状态、启动/重试/重跑/取消、Rows/Issues opaque cursor、批次作用域 Row Drawer、安全有界值、权限清理和 104 项测试已完成；50 Rows、100 Issues、200 Attributes、1366/700px 本地门禁通过，未改变 API/Schema/Migration/生产环境

## 当前未完成模块

- `PENDING_APPROVAL` 兼容值的破坏性收缩尚未实施；必须在旧值计数为零、旧实例全部退出且取得生产授权后另建任务
- break-glass 紧急审批、多节点会签和自动生产审计归档/清理调度尚未设计或实现
- 在线导入中心的真实候选匹配、冲突分流和可解释评分
- 新物料多角色审核节点、冻结/停用状态机和其他待确认职责分离规则
- 动态属性、单位换算、替代料及客户专用料的下游拦截
- SQLite、在线 D1 和治理模板之间的受控迁移与核对
- 独立生产备份、生产恢复演练、远程 Test D1 和完整应用安全测试
- AI 治理、AI 采购、AI 报价、AI 生产辅助及行业知识库
- Material Master 只读页面尚未在生产 Site 发布；当前公开版本仍不具备本任务的新路由和查询 API
- Material Draft 页面尚未在生产 Site 发布；当前公开版本不具备创建、编辑或提交审核界面
- Material Review Queue 与审核工作台尚未在生产 Site 发布；当前公开版本不具备审核队列、批准或驳回工作台
- Material Import 的规范化已完成非生产运行时、`0006` 与 API；自动分类、候选匹配、Material Draft 创建和正式物料写入仍未实现，生产 Queue/binding、生产迁移和部署仍需独立授权
- Material Import Workspace 尚未在生产 Site 部署；生产公开版本不具备本任务三条路由。真实远程 R2/Queue、生产配额/冷启动、page_size=100 和低端终端容量仍未验收

## 当前风险

1. 生产 Site 仍为 `v3` / `2b4f178`，而根仓库开发基线来自 `9f2c2dc`；虽运行时代码一致，后续发布仍需建立统一版本与回退记录。
2. 本地 SQLite 与在线 D1 存在两套数据模型和两套物料编号行为，尚未确认唯一权威源。
3. 在线业务数据大量保存在 `erp_records.data_json`，关系约束、查询能力和迁移能力有限。
4. 本地数据库缺少外键和正式迁移历史；历史默认账号、弱口令和备份完整性存在风险。
5. 在线导入当前把导入行直接归为新物料，没有执行供应商映射或候选匹配。
6. 在线备份仍位于同一 D1 故障域，不能替代外部灾备。
7. 当前测试基线只覆盖本机一次性 D1；尚未建立远程 Test D1，也未覆盖真实远程权限、配额和网络行为。
8. V2 草稿/审核写服务已接入开发版认证授权 API、持久幂等和隔离测试，但尚未接入生产；供应商历史有效期重叠和其他生命周期仍需后续应用层服务保证，不得据本地测试直接迁移生产。
9. V1 分类模板已覆盖首批行业范围，但尚未经过真实物料样本试配；扩展必须新增 seed 版本，不得直接改写已发布版本或引入隐式继承。
10. Material API 已在开发代码中使用专用强幂等、CSRF、细粒度权限、职责分离和审计边界，但生产仍停留在旧版本且没有执行 `0002`/`0003`；未经生产迁移与部署授权，公开网址不具备本任务新增 API。V1 仍无多节点会签、break-glass 或自动审计归档调度。
11. `0003` 过渡约束仍接受 `PENDING_APPROVAL`，应用只写/只返回 `PENDING_REVIEW`，通用查询双读旧/新值；移除旧值必须另建收缩 migration，不能修改 `0003`。
12. TASK08 行级最小披露已在开发代码和隔离测试实现，但生产仍为旧版本；在另行批准迁移和部署前，公开站点不能视为具备新查询 API 或收紧后的 `/drafts`。
13. 开发代码已增加真正的 `/materials/...` 页面路由，但生产 Site 仍为旧版本；在另行批准部署前，公开网址不能视为具备这些页面。
14. legacy 与 Material 页面已共用 `public/erp/api-client.js`，但根页面仍为 iframe + 静态 tab，其他领域尚未迁移为原生路由；不得据此扩大本任务范围。
15. `last_rejection` 与 Draft UI 已在非生产开发代码中完成，但生产仍为旧版本；不得把隔离实现与本地验收表述为公开站点已具备创建、编辑、提交或驳回信息展示能力，部署仍需独立授权。
16. 当前查询计划使用 `(material_id, version_no)` 唯一索引搜索单物料历史，没有专用 `event_type=REJECT` 索引；现阶段有界详情查询无需 migration，若单物料版本规模显著增长，需另建任务复测并审批索引。
17. 当前审核队列 API 可展示 `submitted_by`，但只支持 `creator` 筛选，不支持 `submitted_by` 筛选；V1 不提供该控件、不在前端全量筛选，后续可另立只读 API 候选任务。
18. Review UI 已在非生产开发代码完成并通过本机浏览器与隔离 D1 API 验证，但生产 Site 仍为旧版本；公开网址不能视为具备审核页面，迁移和部署仍需独立授权。
19. Material Import Batch Foundation 已在本地/隔离环境实现，但 `.openai/hosting.json` 的 `r2` 仍为 `null`，没有生产 R2 binding、bucket、生命周期或 Cron；公开站点也未执行 `0004` 或部署本代码。10 MiB 是获批应用上限，不是平台上限或历史样本容量结论。
20. Parser 栈 `@zip.js/zip.js@2.8.26 + sax-wasm@3.1.4 + 受限 OOXML` 与 `csv-parse@7.0.1` 已通过本机 Vinext、Miniflare、WASM、Web Streams、R2 Range 替身、Bundle 和内存门禁；这些是隔离验证，不等于真实生产 Queue/R2、远程配额、并发容量或冷启动已经验收。
21. 独立只读 Catalog 与 Import Workspace 已在非生产代码实现；50×256 本地 Chromium 门禁已通过，但这不是远程生产 R2/Queue、网络、并发、低端设备或冷启动容量结论。生产 Site 仍为旧版本且未部署。
22. Normalization 的 50,000 行、256 KiB/行、256 MiB/批、20 issue/行和 200,000 issue/批已批准为 V1 应用保护上限，但不是生产容量结论；真实生产 Queue/D1 并发、1k/10k/50k 容量与冷启动仍需独立压测和授权。
23. Normalization Review UI 已完成非生产前端与本地门禁，但 Issue API 仍无 `normalized_row_id`/Sheet 精确筛选，Drawer 内完整行 Issue 集合继续属于局部门禁；完整 Run 历史、Batch Current Pointer、部分筛选和列表候选摘要也未暴露。前端已明确降级且未推断；本地 1366×768、700px、50 Rows、100 Issues、200 Attributes 与有界 Payload 结果不等于远程生产容量结论。

## 当前任务与下一任务

- 已完成：`PHASE0-TASK01-B`，把 Site gitlink 转为根仓库直接跟踪的普通目录，保留生产版本、开发基线和提交历史关系；未修改业务代码或生产环境。
- 已完成：`PHASE0-TASK02`，以本机一次性 Miniflare D1 建立生产地址拒绝、测试数据销毁、去敏失败日志、凭证扫描和临时 SQLite 备份恢复验证；未创建云端资源、未连接或修改生产 D1。
- 已完成：`PHASE1-TASK01`，数据模型及正式编码、生命周期、变更日志、供应商映射时效唯一性调整已获批准。
- 已完成：`PHASE1-TASK02`，新增关系化 schema、版本化 Up/Down、Drizzle 快照和隔离迁移测试；未改 API、未迁移数据、未连接生产 D1。
- 已完成：`PHASE1-TASK03`，新增版本化行业分类、属性定义、显式叶子绑定、本地事务 seed 与幂等测试；未改 migration、API 或下游业务，未连接生产 D1。
- 已完成：`PHASE1-TASK04`，新增 Repository + Rules + Service 三层物料校验模块、Memory Repository、隔离 D1 metadata 变化测试和 25 个结构化 code；未接 API、未写真实物料、未连接生产 D1。
- 已完成：`PHASE1-TASK05`，新增 Material Master Draft/Review/Code 服务，以 D1 batch 原子创建草稿、批准启用、拒绝、生成编码、保存类型化属性、版本和审计，并用乐观锁、规则 CAS 及 metadata/属性守卫处理并发；未接 API、未改 migration、未连接生产 D1。
- 已完成：`PHASE1-TASK06`，项目负责人确认审核角色、自审、单步审核、24 小时幂等、60/20 限流、1095 天审计和 MANUAL 来源边界；五个 API、`0002`、只读 Query、事务伴随幂等/审计及隔离测试已完成，全量 Node 58/58 和本机 API smoke 通过，未接生产。
- 已完成：`PHASE1-TASK07`，九项方案 A 已记录并实现；草稿完整替换、提交/驳回/再编辑/重新提交、`PENDING_REVIEW`、审核队列、职责分离、并发/幂等、版本审计和 `0003` 隔离迁移测试通过。
- 已完成：`PHASE1-TASK08` 规格确认及非生产实施；统一查询、Reference、drafts 兼容、行级可见性、缓存、历史分页、稳定错误和批量 metadata 通过测试，1k/10k/100k 查询计划报告完成，未创建索引 migration。
- 已完成：`PHASE1-TASK09` 规格确认及非生产实施；四条原生页面路由、高密度列表、分区详情、独立历史页签、URL 状态、安全 return_to、共享请求边界和现有登录回跳通过测试；未修改 API、schema、migration、索引或业务服务。
- 已完成：`PHASE1-TASK10` 书面规格与低保真线框设计；确认布局 C、动态 Schema、完整替换、PATCH/GET/submit、权限、Validation、Schema 漂移、幂等、并发、dirty 和测试边界；未实施前端、API、schema、migration 或业务服务。
- 已完成：`PHASE1-TASK11` 非生产实现；统一详情从完整 REJECT 版本历史确定性返回 `last_rejection`，materials/drafts 共享查询，隔离测试和查询计划通过；未改 schema/migration/索引/写服务，未接生产。
- 已完成：`PHASE1-TASK12` 非生产实现；Material Draft 创建、编辑和提交审核页面、动态 Schema、权限入口、完整替换、写状态机、Validation、冲突/dirty/未知属性保护与 54 项 UI 验收通过；未改 API/schema/migration/业务服务，未接生产。
- 已完成：`PHASE1-TASK13` 书面规格与低保真线框设计；确认布局 A、队列恢复、能力权限、职责分离、批准/驳回、Validation 确认新鲜度、错误和 51 项实施测试边界；未实施前端、API、schema、migration、索引或部署配置。
- 已完成：`PHASE1-TASK14` 非生产实现；审核队列、方案 A 单条工作台、共享只读详情、批准/驳回、Validation 确认、职责分离、页面内存幂等/并发/离开保护和 51 项 UI 验收通过；未改 API/schema/migration/索引/业务服务，未接生产。
- 已完成：`PHASE2-TASK01` 正式书面规格、OpenAPI 草案、数据流图与 12 项 `PROPOSED` 决策表；定义存储/安全分离、批次级协调、原始行契约、权限、幂等、保留、清理和 Migration 设计；仅文档，停止等待“规格确认”。
- 已完成：`PHASE2-TASK02` 非生产实现；`0004`、对象存储抽象、R2/内存适配器、流式上传、安全检查、六个 API、专用幂等、Saga、取消和清理服务通过 Node 224/224 与隔离 D1/R2 替身测试；未创建或访问生产资源。
- 已完成：`PHASE2-TASK03` 正式书面规格、OpenAPI 草案、流程图、Mapping 规格和 16 项决定；定义 Outbox、Sheet 级恢复、原子发布、Shared Strings/总字节预算、Mapping 准备恢复与 `0005` 设计。
- 已完成：`PHASE2-TASK04` 非生产实现；`0005`、Parser、Outbox/调度抽象、租约恢复、Shared Strings 分块、原始行发布、Mapping 准备与七个 API 已通过 54 项专项和全量 Node 278/278；未创建或连接生产 Queue/R2/D1，未部署，也未创建 Material Draft 或正式物料。
- 已完成：`PHASE2-TASK05` Material Import Workspace UI V1 正式规格、22 状态线框、状态矩阵、100 项未来实施测试和 16 项决定；完整规格与决定已确认，仅文档，未修改运行时、API、Schema、Migration 或生产配置。
- 已完成：`PHASE2-MAINT-01` 在共享 breakpoint-aware 测试辅助层忽略空白及纯注释 SQL 片段，同时原样保留可执行片段；`0003`、`0004`、`0005` Down 和全量 Node 288/288 通过，未改变 Migration 业务语义。
- 已完成：`PHASE2-TASK06` Mapping Target Catalog V1 正式规格与 OpenAPI；比较批次/全局/混入 Mapping 三种路由，推荐批次作用域，定义共享 Registry/digest、BASIC/ATTRIBUTE/SPECIAL DTO、统一 cursor、权限/缓存/失效目标边界和 43 项未来测试；设计提交时 12 项决定为 `PROPOSED`，现已由 TASK07 批准。
- 已完成：`PHASE2-TASK07` 批准 12 项 Catalog 决定并完成非生产实现；共享 Registry/Snapshot/digest 被 Mapping 准备、保存、preview、confirm 与 Catalog 共用，51 项专项和全量 Node 339/339 通过，Catalog UI 门禁标记 `RESOLVED`；未改 Schema/Migration/前端或生产环境。
- 已完成：`PHASE2-TASK08` 非生产 Import Workspace UI；三条路由、SHA Worker、共享 XHR、轮询/取消、Rows/Header、Catalog/Mapping、UI-001—UI-100 与 50×256 Playwright 门禁通过；全量 Node 440/440，未改后端 API、Schema/Migration、Metadata 或生产环境。
- 已完成：`PHASE3-TASK01` Material Import Normalization & Staging V1 正式规格、OpenAPI 草案和数据流/状态图；16 项决定保持 `PROPOSED`，仅文档，未实施代码、Schema、Migration、API、前端或生产资源。
- 已完成：`PHASE3-TASK02` 批准全部 16 项决定并完成非生产 Normalization 服务、`0006`、五个 API、权限/限流/取消、隔离迁移与集成测试；未创建 Draft/正式物料，未迁移或部署生产。
- 已完成：`PHASE3-TASK03` Material Import Normalization Review UI V1 docs-only 设计与正式规格确认；四份正式文档覆盖统一路由、七步 Stepper、启动/轮询/取消、Current/Latest、Rows/Drawer/Issues、37 个线框、104 项测试、局部门禁和性能门禁，14 项决定均为 `APPROVED`；未实施运行时代码或改变生产环境。
- 已完成：`PHASE3-TASK04` Material Import Normalization Review UI V1 非生产实施；统一工作区、七步 Stepper、Current/Latest、冻结幂等与 `RESULT_UNKNOWN`、2/5/10 轮询、取消、汇总、Rows/Issues cursor、Row Drawer、安全有界渲染和权限清理均已落地；104/104 计划测试、100/100 Import UI 回归及本地 Playwright 性能/可访问性门禁通过，未改 API/Schema/Migration/业务服务或生产环境。
- 下一：当前无活动任务；Review UI 实施、分类、匹配、Material Draft、生产 Queue/binding、生产迁移/部署、`submitted_by` 候选项、`PENDING_APPROVAL` 收缩和 `PHASE0-TASK03` 均需独立任务与授权。

## 更新规则

每个任务完成前必须更新本文件中的当前提交、阶段、任务、下一任务、完成模块、未完成模块和风险。只写已从代码、Git、数据库只读检查或平台状态确认的事实；计划和建议必须明确标注为计划或待确认。
