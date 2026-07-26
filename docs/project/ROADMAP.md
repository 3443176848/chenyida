# 晨亿达ERP路线图

状态枚举：`PLANNED`、`DOING`、`DONE`、`BLOCKED`。任务数量为当前规划估算，业务确认后可调整，但必须记录在 `DECISIONS.md`。

## 总览

| 阶段 | 名称 | 预计任务数 | 当前状态 |
| --- | --- | ---: | --- |
| Phase 0 | 基础架构 | 4 | DONE |
| Phase 1 | 物料主数据 | 6 | PLANNED |
| Phase 2 | 导入采集与 Mapping | 8 | DONE（非生产） |
| Phase 3 | 导入规范化、暂存与审阅 | 4 | DONE（非生产实现完成） |
| Phase 4 | AI治理 | 5 | PLANNED |
| Phase 5 | ERP融合 | 9 个建议任务（待逐项授权） | PLANNED |
| Phase 6 | 行业物料库 | 4 | PLANNED |

## 部门业务主线（SELFHOST-PHASE4）

已确认第一阶段顺序为：客户 → 市场部门 → 项目部门 → 计划部门 → 采购部门 → 仓库部门 → 财务部门。生产、品质、完工和发货在后续阶段接入。每一段独立授权、独立状态机和独立验收，前段不得自动创建后段单据。

- `SELFHOST-PHASE4-TASK01`：市场部门 → 项目部门需求交接（DONE；`0.1.0-alpha.15` / PostgreSQL `0015` 已通过并行双账号、重启持久与清理验收）。
- `SELFHOST-PHASE4-TASK02`：项目部 → 计划部，产品/BOM/规格交接（DONE；`0.1.0-alpha.16` / PostgreSQL `0016` 已通过并行退回→v2→重提→接收、重启持久与清理验收）。
- `SELFHOST-PHASE4-TASK03`：计划部 → 采购部，固化需求聚合、独立库存/在途分配与采购申请交接（DONE；`0.1.0-alpha.17` / PostgreSQL `0017` 已通过并行 v1 退回释放→v2 重算重提→接收、重启与恢复清理；不自动启动询价/供应商/比价）。
- `SELFHOST-PHASE4-TASK04`：采购询价、报价、服务端比较与人工定标（DONE；`0.1.0-alpha.18` / PostgreSQL `0018`，不自动创建 PO）。
- `SELFHOST-PHASE4-TASK05`：采购定标 → PO → 到货 → 仓库分批收货 → 库存 → 采购来源 → 财务显式 AP（DONE；`0.1.0-alpha.19` / PostgreSQL `0019`，重启与清理验收通过）。
- `SELFHOST-PHASE4-TASK06`：最新已接收计划包 → 生产交接版本 → 唯一 DRAFT 工单 → 显式释放/BOM 快照/需求 → 齐套预留 → 仓库分批领料（DOING；项目负责人已明确授权；报工、完工和品质排除）。
- 后续阶段：报工、完工、品质和发货接入（PLANNED，均未授权）。

## Phase 0 基础架构

**目标**：让源码、项目文档、测试、环境和生产基线可以被新对话与新机器可靠恢复。

**完成标准**：

- 根仓库新克隆可获得完整 Backend、Site、配置、文档和测试源码。
- 历史 Site、当前 Python 开发运行面和未来自托管版本的源码提交、数据库迁移版本和恢复责任可追踪。
- 测试环境与生产完全隔离，写测试拒绝生产 URL。
- 默认凭证、备份和恢复的高风险项有明确处置结果。
- 项目文档在每个任务结束时同步更新。

**计划任务**：`PM-000`、`PHASE0-TASK01`、`PHASE0-TASK02`、`PHASE0-TASK03`。

## Phase 1 物料主数据

**目标**：建立一物一码、品类属性、生命周期、供应商映射和审核的关系化权威数据源。

**完成标准**：

- 业务负责人确认权威系统、编码、状态、责任人和首期品类。
- 关系化 schema、版本化迁移、约束、索引和迁移测试通过。
- 正式物料只能经审核启用，AI 或导入结果不能直接写正式数据。
- 物料、属性、别名、映射和历史变更可审计。

**建议任务数**：9（由 `SELFHOST-PHASE2-TASK01` 源码盘点提出，逐项独立验收）。**当前状态**：DONE（仅非生产实施）；TASK02—TASK10 已完成，真实数据与生产门禁不在本阶段授权内。

**覆盖演进**：`SELFHOST-PHASE2-TASK01` 起点为等价覆盖 4、部分 9、未覆盖 51，且 23 个业务 GET 全部 404；TASK10 最终为 COVERED 52、REPLACED 2、RETIRED 10、未知/404 0，根页已退出 iframe。

**执行顺序（TASK02—TASK10 已完成非生产实施与独立验收）**：

- `SELFHOST-PHASE2-TASK02`：身份、用户管理、密码、会话撤销与系统审计（DONE，非生产 `0.1.0-alpha.2`；未部署或迁移真实用户）。
- `SELFHOST-PHASE2-TASK03`：客户、供应商、产品、BOM 与供应商物料映射（DONE，非生产 `0.1.0-alpha.3`；PostgreSQL `0007`，未迁真实数据或部署）。
- `SELFHOST-PHASE2-TASK04`：库存不可变账本、余额投影与受控调整（DONE，非生产 `0.1.0-alpha.4`；PostgreSQL `0008`，未回填真实库存或部署）。
- `SELFHOST-PHASE2-TASK05`：采购、缺料建议、收货与库存联动（DONE，非生产 `0.1.0-alpha.5`；PostgreSQL `0009`，未迁真实 PO/在途或创建 AP）。
- `SELFHOST-PHASE2-TASK06`：工单、BOM 快照、领退料、报工、完工与库存联动（DONE，非生产 `0.1.0-alpha.6`；PostgreSQL `0010`，未迁真实生产数据或创建品质/财务过账）。
- `SELFHOST-PHASE2-TASK07`：询报价、销售订单、发货与库存联动（DONE，非生产 `0.1.0-alpha.7`；PostgreSQL `0011`，未迁真实销售数据或创建 AR/收款/品质过账）。
- `SELFHOST-PHASE2-TASK08`：IQC/IPQC/FQC、缺陷、处置与关闭（DONE，非生产 `0.1.0-alpha.8`；PostgreSQL `0012`，FQC 门禁已接入发货，未迁真实检验或伪造 IQC 库存隔离）。
- `SELFHOST-PHASE2-TASK09`：应收应付、收付款、余额与冲销（DONE，非生产 `0.1.0-alpha.9`；PostgreSQL `0013`，稳定 Shipment/Receipt 金额来源、不可变 Settlement/Reversal/Event 与上游冲销门禁通过，未迁真实金额或接入外部财务系统）。
- `SELFHOST-PHASE2-TASK10`：经营看板、备份恢复治理与 legacy iframe 退出（DONE，非生产 `0.1.0-alpha.10`；实时权限裁剪 Dashboard、原生根、离线 backup/verify/新空目标 restore 与 Compose 重启通过，未新增 `0014`、未迁真实数据或部署）。
- `SELFHOST-PHASE3-TASK01`：生产前数据迁移框架与合成试迁移基线（DONE，非生产 `0.1.0-alpha.11`；显式 CLI、双 source adapter、staging、checkpoint、合成 backup/restore 与全回归通过，真实数据和生产 NO-GO）。
- `SELFHOST-PHASE3-TASK02`：库存与财务期初来源及迁移物化安全边界（DONE，非生产 `0.1.0-alpha.12`；PostgreSQL `0014`、受控 Inventory/Finance Opening、冲销、Compose/恢复与全回归通过；MG-001/MG-002 仅在合成模型解决，真实数据和生产 NO-GO）。
- `SELFHOST-PHASE3-TASK03`：合成全域业务表物化与 Dashboard 核对（DONE，非生产 `0.1.0-alpha.13`；18 个 actual public targets、12 个 archive-only、正常全域 API/Dashboard、backup→新空目标 restore、同 manifest replay 与整栈重启通过；migration 保持 0001—0014，真实数据和生产 NO-GO）。
- `SELFHOST-PHASE3-TASK04`：本机真实 SQLite 只读盘点与脱敏 Dry-run（DONE，非生产 `0.1.0-alpha.14`；29 表/3,619 条聚合，planned 49、archive-only 3,566、review 4、blocked/model-gap 0；快照已删除，源/PID 不变，无 target/materialization/file body read；migration 保持 0001—0014，真实 PostgreSQL 与生产 NO-GO）。

库存从采购中拆成独立 TASK04，因为收货、领料、完工和发货都必须复用同一不可变账本、余额投影、锁顺序、幂等和冲销规则。迁移阶段 TASK01 补充合成准备度，TASK02 补充 MG-001/MG-002 合成期初，TASK03 完成合成 public materialization，TASK04 完成一次本机 SQLite 只读脱敏盘点。真实 PostgreSQL 试迁移、逐行人工处置、D1/附件盘点、生产恢复、部署和切换仍需另建任务并明确授权。

## Phase 2 导入中心

**目标**：建立可批量、可重试、可解释、可人工确认的导入、标准化和匹配中心。

**完成标准**：

- 导入批次、原始行、错误、候选、证据和决策全部可追踪。
- 精确匹配、自动建议、疑似匹配、冲突和新物料分流可重复。
- 重复上传与重试幂等，失败不留下半批数据。
- 冲突和新物料不能绕过审核进入正式业务。

**当前任务数**：8。**当前状态**：DONE（非生产；生产资源、迁移和部署未授权）。

**任务顺序**：

- `PHASE2-TASK01`：设计 Material Import Batch Foundation V1（DONE）。
- `PHASE2-TASK02`：实现 Import Batch Foundation（DONE，非生产；无 R2 资源、生产迁移或部署）。
- `PHASE2-TASK03`：设计 Excel/CSV Parser 与字段 Mapping V1（DONE；16 项决定已确认）。
- `PHASE2-TASK04`：实施 Parser、`0005`、Outbox 和 Mapping API（DONE；54 项专项与全量 Node 278/278 通过，仅非生产，不含生产资源、迁移或部署）。
- `PHASE2-TASK05`：设计 Material Import Workspace UI V1（DONE；该任务仅文档，完整 UI 后由 TASK08 实施）。
- `PHASE2-TASK06`：设计 Material Import Mapping Target Catalog V1（DONE；12 项决定已由 TASK07 批准）。
- `PHASE2-TASK07`：实现批次作用域 Catalog 与共享 Registry/Snapshot/digest（DONE；51 项专项、Node 339/339；Catalog 门禁已解除，未改 Schema/Migration/前端或生产环境）。
- `PHASE2-TASK08`：实现 Material Import Workspace UI V1（DONE；100 项专项、50×256 Playwright 门禁和全量 Node 440/440 通过，仅非生产前端，不含部署）。

Import Workspace UI 已由 `PHASE2-TASK08` 独立实施；Catalog 与 50×256 性能/可访问性两项门禁均已通过。Normalization 进入 Phase 3；分类、匹配、Material Draft、生产资源、迁移和部署仍需独立任务与授权。

## Phase 3 导入规范化与暂存

**目标**：把确认后的 Mapping 确定性应用到已发布原始行，形成可追溯、可分页、可审计且可原子发布的标准物料候选快照。

**完成标准**：

- 独立 normalization run、行快照、issue、租约、重放和 current pointer 契约通过审阅。
- 空值、默认值、基础字段、动态属性、类型、Validation 延迟边界和资源限制获业务负责人确认。
- `0006`、API、隔离 D1/调度器及 54 项最低测试在非生产实施通过。
- ERROR 行不会被误当成执行失败；未分类候选不得创建 Draft 或写正式物料。

**任务顺序**：

- `PHASE3-TASK01`：设计 Material Import Normalization & Staging V1（DONE；16 项决定由 TASK02 全部批准）。
- `PHASE3-TASK02`：实施 Normalization、`0006`、API 和隔离测试（DONE；不含生产迁移/部署、分类、匹配或 Draft）。
- `PHASE3-TASK03`：设计 Material Import Normalization Review UI V1（DONE；四份 docs-only 交付、37 线框、104 项测试和 14 项 `APPROVED` 决定）。
- `PHASE3-TASK04`：实现 Material Import Normalization Review UI V1（DONE；统一工作区、七步 Stepper、Current/Latest、Rows/Issues/Drawer、104 项测试与本地性能/可访问性门禁）。

**当前状态**：Normalization 后端与 Review UI 非生产实现完成；行完整 Issue 查询局部门禁及七项非阻塞限制继续有效。生产迁移、远程容量和部署仍需独立任务与授权。

## Phase 4 AI治理

**目标**：在确定性规则和人工审核之上增加受控 AI 辅助能力。

**完成标准**：

- AI 输出带来源、置信度、规则证据和模型版本。
- AI 只生成建议，不直接创建、合并、启用或覆盖正式物料。
- 评估集覆盖正例、反例、冲突和行业特殊场景。
- 人工确认结果可形成质量指标，但不自动改变生产阈值。

**预计任务数**：5。**当前状态**：PLANNED。

## Phase 5 ERP融合

**目标**：让 BOM、采购、库存、生产、销售、品质和财务统一引用受控物料主数据。

**完成标准**：

- 新业务只引用有效内部物料 ID/编码。
- 单位、替代、客户专用、冻结和停用规则在服务端拦截。
- 旧数据通过交叉映射分模块切换，历史单据不丢失。
- 库存、在途采购、未完工工单和关键金额核对通过。

**预计任务数**：6。**当前状态**：IN PROGRESS。自托管全域 API、合成迁移框架、受控 Inventory/Finance Opening 及完全合成 public materialization/Dashboard/恢复已完成非生产验收；真实 source inventory、逐行人工处置、容量、安全、生产恢复、部署和切换尚未开始。

## Phase 6 行业物料库

**目标**：在权限、来源和质量可控的前提下沉淀 PCB/FPC/SMT 行业物料知识库。

**完成标准**：

- 知识条目有来源、版本、适用范围、质量等级和版权边界。
- 公司私有主数据与行业公共知识严格隔离。
- 搜索、推荐和复用不泄露客户、供应商、价格或生产信息。
- AI 采购、报价和生产辅助只能消费已授权、可追踪的数据。

**预计任务数**：4。**当前状态**：PLANNED。
