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
| PHASE2-TASK04 | 实现 Excel/CSV Parser 与字段 Mapping V1 | DONE | Codex（实施）、项目负责人（规格与非生产范围批准） | 2026-07-16 | 2026-07-16 | PHASE2-TASK03 | 完成 `0005` Up/受保护 Down、parse run、Outbox、可注入调度与租约恢复、XLSX/CSV 有界解析、Shared Strings 分块、原始行原子发布、Mapping 准备及七个 API；54 项专项和全量 Node 278/278 通过；未创建生产 Queue/binding、执行生产迁移或部署，未创建 Material Draft/正式物料 |
| PHASE2-TASK05 | 设计 Material Import Workspace UI V1 | DONE | Codex（设计）、项目负责人（六段设计与整体方向确认，待完整规格确认） | 2026-07-16 | 2026-07-16 | PHASE2-TASK04 | 完成正式 UI 规格、22 状态低保真线框、集中状态矩阵、100 项未来实施测试和 16 项 `PROPOSED` 决定；记录 `BLOCKED_BY_MAPPING_TARGET_CATALOG` 与 `PERFORMANCE_AND_ACCESSIBILITY_VALIDATION_REQUIRED`；仅文档，未修改运行时代码、API、Schema、Migration、R2/Queue、hosting 或生产环境 |

当前没有 `DOING` 任务。`PHASE2-TASK05` 已完成并停止等待“规格确认”；16 项 UI 决定不得提前转为 `APPROVED`。Mapping Target Catalog 只读兼容 API 必须先独立设计、实现、测试并更新 OpenAPI，之后才能开始完整 Import Workspace UI；生产 R2/Queue、生产 D1 migration、Cron、部署、清洗/匹配/Material Draft、`submitted_by` 只读筛选、`PENDING_APPROVAL` 收缩和 `PHASE0-TASK03` 仍需独立授权。

## Phase 0 待办

| 任务编号 | 任务名称 | 状态 | 负责人 | 开始时间 | 完成时间 | 依赖任务 | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PHASE0-TASK01 | 修复在线Site源码管理结构 | DONE | Codex（执行）、项目负责人（确认） | 2026-07-11 | 2026-07-11 | PM-000 | 审计后由 `PHASE0-TASK01-B` 完成：移除不可恢复裸 gitlink，把 Site 完整源码纳入根仓库，保留生产版本和历史来源；未改业务逻辑 |
| PHASE0-TASK02 | 建立隔离测试与安全基线 | DONE | Codex（执行）、项目负责人（方案确认） | 2026-07-11 | 2026-07-11 | PHASE0-TASK01 | 本机一次性 D1 烟测与自动清理通过；生产环境和公开 URL 在写入前拒绝；凭证、备份恢复和完整基线测试通过 |
| PHASE0-TASK03 | 建立发布与迁移追踪基线 | TODO | 待指派 | - | - | PHASE0-TASK01、PHASE0-TASK02 | 统一版本号、生产提交、迁移版本、发布验收和回退记录 |

## 后续候选任务

| 任务编号 | 任务名称 | 状态 | 负责人 | 开始时间 | 完成时间 | 依赖任务 | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PHASE3-TASK01 | 建立AI治理评估与审批边界 | TODO | 待指派 | - | - | Phase 2 完成 | 定义评估集、证据、模型版本、人工确认和禁止自动生效规则 |

## 更新模板

新增任务时必须填写：任务编号、任务名称、状态、负责人、开始时间、完成时间、依赖任务、范围说明和验收标准。禁止只在聊天中宣布开始或完成。
