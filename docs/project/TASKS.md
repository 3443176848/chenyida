# 晨亿达ERP任务台账

## 状态定义

- `TODO`：范围已定义，尚未开始。
- `DOING`：当前唯一执行任务。
- `DONE`：实现、测试、文档和独立提交均已完成，并等待或已经通过人工验收。
- `BLOCKED`：存在明确阻断条件，已记录责任人和解除条件。

任何时刻原则上只能有一个 `DOING` 任务。任务完成后必须更新负责人、时间、依赖、说明，并同步更新 `MASTER.md`、`CHANGELOG.md` 和 `STATUS.md`。

## 已完成任务

| 任务编号 | 任务名称 | 状态 | 负责人 | 开始时间 | 完成时间 | 依赖任务 | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PHASE3-MATERIAL-LIBRARY-CLEANING-CLEAR-01 | 清洗审核安全清空 | DONE | Codex（权限、备份、事务、审计、页面、测试与部署）、项目负责人（功能要求） | 2026-07-18 18:45 CST | 2026-07-18 18:51 CST | PHASE3-MATERIAL-LIBRARY-CONFIDENCE-SORT-01 | 管理员页面新增清空按钮；`POST /api/cleaning/clear` 要求 system 权限和固定确认字段，先自动备份，再在单事务删除 Cleaning Rows 并记录操作者/数量。保留 Batch、Raw Rows、归档、物料和映射。专项 3/3、联合 7/7、smoke 通过；部署未实际清空，229 条 V700 记录保持不变。 |
| PHASE3-MATERIAL-LIBRARY-CONFIDENCE-SORT-01 | 清洗审核匹配置信度升降序 | DONE | Codex（服务端排序、页面控件、测试与开发部署）、项目负责人（功能要求及 V700 网页重导入） | 2026-07-18 18:28 CST | 2026-07-18 18:34 CST | PHASE3-MATERIAL-LIBRARY-MATCH-SEED-01 | `GET /api/cleaning` 增加 `newest/desc/asc` 白名单参数，服务端全局排序后应用 500 条上限，同分按 ID 降序；页面提供最新、由高到低、由低到高并只刷新清洗列表。单元 4/4、smoke/self-test、公网页面资源检查通过；用户重导入的 V700 形成 229 条/21 个置信度层级，真实升降序均通过。 |
| PHASE3-MATERIAL-LIBRARY-MATCH-SEED-01 | 建立编号 1～5 的电容匹配测试基线并清空清洗队列 | DONE | Codex（备份、试跑、受控写入与验证）、项目负责人（提供最终五条规格并授权清空） | 2026-07-18 18:18 CST | 2026-07-18 18:24 CST | PHASE3-MATERIAL-LIBRARY-REAL-SAMPLE-IMPORT-02 | 采用用户更正后的五条规格，以临时内部编码 1～5、CAP、PCS 建入开发库；单事务清空 543 条 Cleaning Rows，保留 2 Batch、766 Raw Rows 和原文件归档。内部物料 4→9，五条现场匹配均为对应编码、自动匹配 1.00；备份副本试跑和数据库完整性通过。 |
| PHASE3-MATERIAL-LIBRARY-REAL-SAMPLE-IMPORT-02 | A118/V700 正式 BOM 待审核入库兼容 | DONE | Codex（服务器本地实现、隔离验证与受控入库）、项目负责人（确认两份为正式待导入表） | 2026-07-18 17:36 CST | 2026-07-18 17:51 CST | PHASE3-MATERIAL-LIBRARY-EXCEL-COMPAT | 完整原文件按 SHA 归档；A118 从第 44 行可信表头生成 314 条，V700 用规格描述作为待审核名称候选生成 229 条，共 2 Batch/766 Raw/543 Cleaning。543 条全部 NEEDS_REVIEW，22 条空规格、543 条空单位；内部物料保持 4 条，未自动建档。 |
| PHASE3-MATERIAL-LIBRARY-REAL-SAMPLE-01 | A118/V700 真实 BOM 自适应导入验证 | DONE | Codex（只读样本审计与非生产修正）、项目负责人（提供两份样本） | 2026-07-18 16:30 CST | 2026-07-18 16:35 CST | PHASE3-MATERIAL-LIBRARY-SUPPLIER-ADAPTIVE-IMPORT | 功能提交 `cea940a`；只读验证两份真实附件，V700 已正确选择 BOM 并识别规格/型号/数量，A118 已识别第 44 行表头和正确字段但因 7 行扩展到 16,384 列而保持安全阻断；修正错后缀 XLSX 告警兼容、Change Log 降权、厂商料号限定、“用量”和安全错误，Node 593/593。未提交样本、上传生产或创建 Draft |
| PHASE3-MATERIAL-LIBRARY-EXCEL-COMPAT | `.xlsx/.xls` 网页识别与导入兼容 | DONE | Codex（服务器本地实现与部署）、项目负责人（运行面及公网开发部署授权） | 2026-07-18 | 2026-07-18 17:28 CST | PHASE3-MATERIAL-LIBRARY-REAL-SAMPLE-01、PHASE3-MATERIAL-LIBRARY-SERVER-RUNTIME | 实际 Python 网页接受 CSV/XLSX/XLS 二进制并自适应识别 Sheet、前 50 行、1～3 行合并表头、集中 Mapping 和多列规格；本地 `0001` 保存批次、不可变 Raw Rows 和 Canonical 来源/置信度。专项 9/9、联合单元 13/13、self-test/smoke/go-live、公网页面检查通过，systemd 已部署；V700/A118 既有业务门禁不放宽。 |
| PHASE3-MATERIAL-LIBRARY-SERVER-RUNTIME | 服务器本地运行面与 18888 端口切换 | DONE | Codex（开发服务器配置与验证） | 2026-07-18 | 2026-07-18 | PHASE3-MATERIAL-LIBRARY-EXCEL-COMPAT | 根据 D-028/D-030 将 Python 应用作为后续默认交付目标，统一端口为 `18888`；systemd 服务已 `enabled/active`，本机及公网健康检查通过。后续 EXCEL-COMPAT 已把 CSV/XLSX/XLS 迁入该运行面。 |
| PHASE3-MATERIAL-LIBRARY-PUBLIC-VERIFY | 18888 公网访问验证 | DONE | Codex（受控运行验证） | 2026-07-18 | 2026-07-18 | PHASE3-MATERIAL-LIBRARY-SERVER-RUNTIME | 本机与 `43.135.157.211:18888/api/health` 均返回 HTTP 200，登录页可达且不再预填默认密码；根据用户后续确认，开发服务改由 systemd 常驻。长期投用仍需密码轮换、HTTPS、反向代理和访问控制。 |
| PM-000 | 建立AI项目管理体系 | DONE | Codex（执行）、项目负责人（确认） | 2026-07-11 | 2026-07-11 | 无 | 建立 `docs/project/` 九份权威文档并更新 `AGENTS.md`；未修改业务代码、数据库、页面或生产环境 |
| PHASE0-TASK01-B | 解除Site gitlink并纳入根仓库管理 | DONE | Codex（执行）、项目负责人（目录决策确认） | 2026-07-11 | 2026-07-11 | PM-000 | 保留 `chenyida_erp_app/` 与 `chenyida_erp_site/` 路径；将 1 个 gitlink 转为 77 个普通跟踪文件，并保留 `2b4f178`、`9f2c2dc` 的版本和历史关系；未修改业务代码或生产环境 |
| PHASE0-TASK02 | 建立隔离测试与安全基线 | DONE | Codex（执行）、项目负责人（本机一次性 D1 方案确认） | 2026-07-11 | 2026-07-11 | PHASE0-TASK01 | 建立三环境清单、production/公开 URL 拒绝、本机一次性 Miniflare D1、自动销毁、去敏日志、凭证检查和临时 SQLite 备份恢复验证；未访问生产 D1 |
| PHASE1-TASK01 | 设计 Material Master V2 数据模型 | DONE | Codex（设计）、项目负责人（审批） | 2026-07-11 | 2026-07-12 | PHASE0-TASK01、PHASE0-TASK02 | 设计已批准；正式编码仅审核通过后生成，增加生命周期、变更日志和五要素时效供应商映射唯一性 |
| PHASE1-TASK02 | 实现V2数据契约与迁移测试基线 | DONE | Codex（执行）、项目负责人（设计审批） | 2026-07-12 | 2026-07-12 | PHASE1-TASK01 | 新增 12 张 D1 V2 表、Drizzle schema、Up/Down、快照和隔离迁移测试；未接业务、未迁移数据、未访问生产 |
| PHASE1-TASK03 | 建立PCB/FPC/SMT行业物料分类体系和属性模板 | DONE | Codex（执行）、项目负责人（设计与叶子绑定决策确认） | 2026-07-12 | 2026-07-12 | PHASE1-TASK02 | 版本化 TypeScript seed 包含 101 个分类、34 个属性和 228 条叶子显式绑定；本地事务批次、幂等统计、环境拒绝和 migration 回归通过；未访问生产 |
| PHASE1-TASK04 | 建立 Material Master V2 物料校验服务 | DONE | Codex（执行）、项目负责人（设计与书面规格确认） | 2026-07-12 | 2026-07-12 | PHASE1-TASK03 | Repository + Rules + Service 三层实现按 D1 metadata 返回 25 个结构化 code；Memory 与隔离 D1 metadata 变化测试共 28 个，全量 Node 40/40；未接 API、未创建真实物料、未访问生产 |
| PHASE1-TASK05 | 建立 Material Master Draft 创建与审核写服务 | DONE | Codex（执行）、项目负责人（任务规格与编码时点确认） | 2026-07-12 | 2026-07-13 | PHASE1-TASK04 | 新增 Draft/Review/Code 六模块，以 D1 batch 原子写草稿、属性、版本、审计和审核编码；乐观锁、规则 CAS、metadata/属性守卫及 12 个隔离 D1 用例通过，全量 Node 52/52；未接 API、未改 migration、未访问生产 |
| PHASE1-TASK06 | 设计并实现受认证授权的 Material Master Draft/Review API | DONE | Codex（执行）、项目负责人（规格与八项业务选择确认） | 2026-07-13 | 2026-07-14 | PHASE1-TASK05 | 五个 API、现有会话认证、细粒度权限、禁止自审、Origin/CSRF、24 小时持久幂等、60/20 限流、乐观锁、1095 天审计、只读 Query Service 和 `0002` 已完成；Node 58/58、隔离 API smoke 及安全检查通过，未连接或部署生产 |
| PHASE1-TASK07 | 完善物料草稿生命周期、重新提交和审核队列 | DONE | Codex（实施）、项目负责人（九项方案 A 确认） | 2026-07-14 | 2026-07-14 | PHASE1-TASK06 | 已实现完整替换编辑、提交/驳回/再编辑/重新提交、`PENDING_REVIEW`、审核队列、职责分离、`0003` 和隔离并发/迁移测试；未连接或部署生产 D1 |
| PHASE1-TASK08 | 实施 Material Master Reference & Query API | DONE | Codex（实施）、项目负责人（规格与 metadata 兼容规则确认） | 2026-07-14 | 2026-07-14 | PHASE1-TASK07 | 统一 Query/Reference Service、6 个新增查询路由、drafts 兼容层、行级可见性、ETag/no-store、历史分页及批量 metadata 已实现；Node 66/66、隔离 smoke、1k/10k/100k 计划证据和全量本地基线通过；未改 schema/index migration，未连接或部署生产 |
| PHASE1-TASK09 | 设计并实施 Material Master 只读管理界面 V1 | DONE | Codex（设计与实施）、项目负责人（布局及规格确认） | 2026-07-14 | 2026-07-14 | PHASE1-TASK08 | 实现四条原生 Vinext 路由、高密度列表、分区详情、独立历史页签、URL 状态、安全 return_to、共享 HTTP Client 和现有登录回跳；UI 37/37、全量 Node 103/103、隔离 API smoke、路由冒烟、凭证扫描及临时 SQLite 基线通过；未修改 API/schema/migration/索引/业务服务，未连接或部署生产 |
| PHASE1-TASK10 | 设计 Material Draft 创建、编辑与提交审核界面 V1 | DONE | Codex（设计）、项目负责人（五节设计与补充约束确认） | 2026-07-14 | 2026-07-14 | PHASE1-TASK09 | 完成正式书面规格和低保真线框稿；批准布局 C、Schema 驱动完整替换、PATCH/GET/submit、权限、Validation、Schema 漂移、幂等、并发、dirty、SAVED_UNSYNCED/RESULT_UNKNOWN 和 54 项 E2E 计划；未实施前端或 API |
| PHASE1-TASK11 | 实现 Material Detail last_rejection 只读历史投影 | DONE | Codex（实施）、项目负责人（任务范围确认） | 2026-07-15 | 2026-07-15 | PHASE1-TASK10 | materials/drafts 统一详情从完整 REJECT 版本历史确定性投影最近一次驳回；隔离测试和查询计划通过，未改 schema/migration/索引/写服务，未连接或部署生产 D1 |
| PHASE1-TASK12 | 实现 Material Draft 创建、编辑与提交审核界面 V1 | DONE | Codex（实施）、项目负责人（任务范围确认） | 2026-07-15 | 2026-07-15 | PHASE1-TASK11 | 新增创建/编辑路由、布局 C、Schema 驱动五类属性、权限入口、完整 PATCH、PATCH/GET/submit、Validation/WARNING、幂等安全重试、冲突、dirty、未知属性与驳回信息保护；Draft UI 54/54、全量 Node 158/158、隔离浏览器/API 和本地基线通过；未改 API/schema/migration/业务服务，未连接或部署生产 |
| PHASE1-TASK13 | 设计 Material Review Queue 与审核工作台 V1 | DONE | Codex（设计）、项目负责人（五段设计及补充约束确认） | 2026-07-15 | 2026-07-15 | PHASE1-TASK12 | 完成正式规格和低保真线框；批准布局 A、队列返回恢复、权限与职责分离、批准/驳回、Validation 确认绑定、错误/幂等/可访问性和 51 项实施测试计划；仅文档，未修改运行时代码、API、Schema、Migration、索引或部署配置 |
| PHASE1-TASK14 | 实现 Material Review Queue 与审核工作台 V1 | DONE | Codex（实施）、项目负责人（任务范围确认） | 2026-07-15 | 2026-07-15 | PHASE1-TASK13 | 实现审核队列、方案 A 单条工作台、共享只读详情、批准/驳回、Validation 新鲜度确认、职责分离、页面内存幂等/并发/离开保护和完整错误状态；Review UI 51/51、全量 Node 209/209、1366×768 浏览器验收、隔离 API smoke、凭证扫描和本地基线通过；未改 API/schema/migration/业务服务，未连接或部署生产 |
| PHASE2-TASK01 | 设计 Material Import Batch Foundation V1 | DONE | Codex（设计）、项目负责人（两节方向确认，待完整规格确认） | 2026-07-15 | 2026-07-15 | PHASE1-TASK14 | 完成正式规格、OpenAPI 草案、数据流图和 12 项 `PROPOSED` 决策表；设计私有 R2、D1 元数据、单文件代理上传、可恢复 Saga、状态机、原始行契约、权限、幂等、清理与 Migration 边界；仅文档，未创建 Schema、Migration、R2、Binding、API、前端或部署配置，停止等待“规格确认” |
| PHASE2-TASK02 | 实现 Material Import Batch Foundation V1 | DONE | Codex（实施）、项目负责人（12 项决定与任务范围批准） | 2026-07-15 | 2026-07-15 | PHASE2-TASK01 | 新增 `0004` 五表契约及 Down/快照、可注入对象存储与 R2/内存适配器、10 MiB 流式单文件 multipart、XLSX/CSV 基础安全检查、六个 API、专用幂等、Saga/协调、权限/行级可见性、重复策略、取消与手工清理服务；Node 224/224、迁移 3/3、导入专项 12/12 通过；无生产 R2 binding、Cron、迁移或部署 |
| PHASE2-TASK03 | 设计 Excel/CSV Parser 与字段 Mapping V1 | DONE | Codex（设计）、项目负责人（16 项正式规格确认） | 2026-07-16 | 2026-07-16 | PHASE2-TASK02 | 完成 Parser 主规格、OpenAPI 草案、Mapping 规格和流程图；定义 `PARSED` 原子发布、parse run 隔离、Outbox、Sheet 级恢复、Shared Strings/总字节预算、Mapping 准备恢复、`0005` 设计；16 项决定已由 `PHASE2-TASK04` 指令批准 |

## 当前任务

| 任务编号 | 任务名称 | 状态 | 负责人 | 开始时间 | 完成时间 | 依赖任务 | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PHASE3-MATERIAL-LIBRARY-SUPPLIER-ADAPTIVE-IMPORT | 多供应商自适应表格识别、字段映射与规格提取 | DONE | Codex（审计与非生产实施）、项目负责人（任务范围确认） | 2026-07-18 | 2026-07-18 16:10 CST | PHASE3-MATERIAL-LIBRARY-02、PHASE3-TASK04 | 复用既有 Batch/Parser/Raw Rows/Mapping/Normalization/Review/Validation/Audit/Draft；功能提交 `41e293f` 实现全部可见 Sheet、前 50 行、1～3 行合并表头、集中别名与样本/Profile 加权、可解释行分类、多列规格、Canonical Row、人工确认和空规格 Draft 阻断；Node 589/589 及完整隔离基线通过。受控目录无真实供应商样本；未执行生产迁移、真实数据写入或部署 |
| PHASE3-MATERIAL-LIBRARY-02 | 真实物料数据导入治理与首批内部物料库建立 | BLOCKED | Codex（真实样本只读治理）、项目负责人（待补充模板语义/重新导出） | 2026-07-18 14:41 CST | - | PHASE3-MATERIAL-LIBRARY-01 | 已完成 `b3d26c3` 治理增强和 `cea940a` 两份真实 BOM 验证。V700 缺少可确认的标准名称、单位等 Draft 必填映射；A118 存在 XFD 超宽重复块，系统不静默截断。未上传、dry-run 或创建 DRAFT；解除条件是确认 V700 标准名称/单位来源，并重新导出或人工清理 A118 异常块后提供新 SHA 文件 |
| PHASE3-MATERIAL-LIBRARY-01 | 内部物料库数据库建立与正式 Material Master 落地 | DONE | Codex（审计与非生产实施）、项目负责人（任务范围确认） | 2026-07-18 14:01 CST | 2026-07-18 14:38 CST | PHASE3-TASK04、PHASE1-TASK07 | 复用既有 `material_master` 和 Import/Normalization/Review；新增 `0007` 单位/品牌、Approval、来源行关联和重复候选，接通 Approved Normalization→DRAFT，提供 inspect/dry-run/commit/report；全量 Node 569/569、build、隔离 API smoke、迁移/权限/幂等/凭证/临时 SQLite 通过；功能提交 `2ff8d9c`，未执行真实文件 dry-run、生产迁移或部署 |
| PHASE3-TASK04 | 实现 Material Import Normalization Review UI V1 | DONE | Codex（实施）、项目负责人（14 项规格与非生产前端范围批准） | 2026-07-17 | 2026-07-17 | PHASE3-TASK03 | 完成统一工作区七步 Stepper、current_run/latest_attempt、启动/重试/重跑/取消、Rows/Issues cursor、Row Drawer、安全有界渲染与权限清理；104/104 计划测试、100/100 Import UI 回归和本地 Playwright 门禁通过，未修改 API、Schema、Migration、Normalization 业务逻辑或生产环境 |
| PHASE2-TASK04 | 实现 Excel/CSV Parser 与字段 Mapping V1 | DONE | Codex（实施）、项目负责人（规格与非生产范围批准） | 2026-07-16 | 2026-07-16 | PHASE2-TASK03 | 完成 `0005` Up/受保护 Down、parse run、Outbox、可注入调度与租约恢复、XLSX/CSV 有界解析、Shared Strings 分块、原始行原子发布、Mapping 准备及七个 API；54 项专项和全量 Node 278/278 通过；未创建生产 Queue/binding、执行生产迁移或部署，未创建 Material Draft/正式物料 |
| PHASE2-TASK05 | 设计 Material Import Workspace UI V1 | DONE | Codex（设计）、项目负责人（完整规格与 16 项决定确认） | 2026-07-16 | 2026-07-16 | PHASE2-TASK04 | 完成并确认正式 UI 规格、22 状态低保真线框、集中状态矩阵、100 项未来实施测试和 16 项决定；保留 `BLOCKED_BY_MAPPING_TARGET_CATALOG` 与 `PERFORMANCE_AND_ACCESSIBILITY_VALIDATION_REQUIRED`；仅文档，未修改运行时代码、API、Schema、Migration、R2/Queue、hosting 或生产环境 |
| PHASE2-MAINT-01 | 修复 0005 Protected Down 注释语句测试失败 | DONE | Codex（实施）、项目负责人（共享 breakpoint-aware 过滤方案确认） | 2026-07-16 | 2026-07-16 | PHASE2-TASK05 | 在 Migration 测试共享层按既有 breakpoint 分割后忽略空白及纯注释片段，原样保留可执行 SQL；覆盖字符串/注释边界和 fail-closed 异常片段，统一复用到 0003/0004/0005 等同语义夹具；全量 Node 288/288，未修改 Migration、Schema、API 或生产配置 |
| PHASE2-TASK06 | 设计 Material Import Mapping Target Catalog V1 | DONE | Codex（设计）、项目负责人（由 TASK07 指令确认） | 2026-07-16 | 2026-07-16 | PHASE2-TASK05、PHASE2-MAINT-01 | 完成只读批次作用域 Catalog 正式规格、OpenAPI 与 43 项未来实施测试；审计确认现有 digest 缺少单位/default/特殊目标等语义，提出共享 Target Registry + Metadata Snapshot 前置重构；12 项决定由 TASK07 批准 |
| PHASE2-TASK07 | 实现 Material Import Mapping Target Catalog V1 | DONE | Codex（实施）、项目负责人（12 项决定与非生产范围批准） | 2026-07-16 | 2026-07-16 | PHASE2-TASK06 | 实现批次作用域只读 Catalog、共享 Registry/Snapshot/digest、运行时 D1 ACTIVE 属性、有界搜索/cursor、read+map/行级可见性、读取限流和安全审计；Mapping 准备/保存/preview/confirm 统一；专项 51/51、全量 Node 339/339、lint/API/OpenAPI/凭证/临时 SQLite 通过；未改 Schema/Migration/前端或生产环境 |
| PHASE2-TASK08 | 实现 Material Import Workspace UI V1 | DONE | Codex（实施）、项目负责人（16 项决定与非生产 UI 范围批准） | 2026-07-17 | 2026-07-17 | PHASE2-TASK07 | 完成三条导入路由、Worker SHA、共享 XHR、列表/上传/解析/轮询、Sheet/Rows/Header、Catalog/Mapping 保存预览确认；UI-001—UI-100、50×256 Playwright 门禁、Node 440/440、lint/API/OpenAPI/Drizzle/凭证/临时 SQLite 通过；未修改 API/Schema/Migration、生产资源、迁移或部署 |
| PHASE3-TASK01 | 设计 Material Import Normalization & Staging V1 | DONE | Codex（设计）、项目负责人（待规格确认） | 2026-07-17 | 2026-07-17 | PHASE2-TASK08 | 完成正式规格、OpenAPI 草案和数据流/状态图；定义独立 run、JSON 行快照、独立 issue、类型/空值/属性规则、Outbox/租约、原子发布、五个 API、`0006` 设计、54 项测试和 16 项 `PROPOSED` 决定；仅文档，未修改运行时代码、Schema、Migration、API、前端或生产环境 |
| PHASE3-TASK03 | 设计 Material Import Normalization Review UI V1 | DONE | Codex（设计）、项目负责人（2026-07-17 正式规格确认） | 2026-07-17 | 2026-07-17 | PHASE3-TASK02 | 完成正式 UI 规格、37 状态低保真线框、集中状态矩阵和 104 项未来实施测试；统一工作区、七步 Stepper、Current/Latest 双轨、Rows/Issues cursor 与 Row Drawer等 14 项决定均已 `APPROVED`；局部 Issue 查询门禁、性能门禁和 7 项非阻塞限制继续有效；仅文档，未修改前端、API、Schema、Migration、业务逻辑或生产环境 |

当前没有 `DOING` 任务；两份真实 BOM 的只读验证已完成，`PHASE3-MATERIAL-LIBRARY-02` 仍因 A118 超宽异常块和 V700 缺少必填 Mapping 语义处于 `BLOCKED`。生产 R2/Queue、生产 D1 migration、Cron、部署、真实数据导入、`submitted_by` 只读筛选、`PENDING_APPROVAL` 收缩和 `PHASE0-TASK03` 仍需独立授权。

## Phase 0 待办

| 任务编号 | 任务名称 | 状态 | 负责人 | 开始时间 | 完成时间 | 依赖任务 | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PHASE0-TASK01 | 修复在线Site源码管理结构 | DONE | Codex（执行）、项目负责人（确认） | 2026-07-11 | 2026-07-11 | PM-000 | 审计后由 `PHASE0-TASK01-B` 完成：移除不可恢复裸 gitlink，把 Site 完整源码纳入根仓库，保留生产版本和历史来源；未改业务逻辑 |
| PHASE0-TASK02 | 建立隔离测试与安全基线 | DONE | Codex（执行）、项目负责人（方案确认） | 2026-07-11 | 2026-07-11 | PHASE0-TASK01 | 本机一次性 D1 烟测与自动清理通过；生产环境和公开 URL 在写入前拒绝；凭证、备份恢复和完整基线测试通过 |
| PHASE0-TASK03 | 建立发布与迁移追踪基线 | TODO | 待指派 | - | - | PHASE0-TASK01、PHASE0-TASK02 | 统一版本号、生产提交、迁移版本、发布验收和回退记录 |

## 后续候选任务

| 任务编号 | 任务名称 | 状态 | 负责人 | 开始时间 | 完成时间 | 依赖任务 | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PHASE3-TASK02 | 实现 Material Import Normalization & Staging V1 | DONE | Codex（实施）、项目负责人（批准 16 项决定） | 2026-07-17 | 2026-07-17 | PHASE3-TASK01 | 已实现独立 run、行 JSON 快照、Issue、Outbox/租约/心跳、原子 pointer 发布、不同 processor 版本重跑、取消清理、五个 API、`material.import.normalize`、读写限流、`0006` Up/受保护 Down/快照及隔离测试；未创建 Draft/正式物料，未迁移或部署生产 |
| PHASE4-TASK01 | 建立AI治理评估与审批边界 | TODO | 待指派 | - | - | Material Import 治理链路完成 | 定义评估集、证据、模型版本、人工确认和禁止自动生效规则；原占位编号 `PHASE3-TASK01` 因本次明确任务编号顺延 |

## 更新模板

新增任务时必须填写：任务编号、任务名称、状态、负责人、开始时间、完成时间、依赖任务、范围说明和验收标准。禁止只在聊天中宣布开始或完成。
