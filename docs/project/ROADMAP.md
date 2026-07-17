# 晨亿达ERP路线图

状态枚举：`PLANNED`、`DOING`、`DONE`、`BLOCKED`。任务数量为当前规划估算，业务确认后可调整，但必须记录在 `DECISIONS.md`。

## 总览

| 阶段 | 名称 | 预计任务数 | 当前状态 |
| --- | --- | ---: | --- |
| Phase 0 | 基础架构 | 4 | DOING |
| Phase 1 | 物料主数据 | 6 | PLANNED |
| Phase 2 | 导入采集与 Mapping | 8 | DONE（非生产） |
| Phase 3 | 导入规范化与暂存 | 2 | DONE（非生产实现完成） |
| Phase 4 | AI治理 | 5 | PLANNED |
| Phase 5 | ERP融合 | 6 | PLANNED |
| Phase 6 | 行业物料库 | 4 | PLANNED |

## Phase 0 基础架构

**目标**：让源码、项目文档、测试、环境和生产基线可以被新对话与新机器可靠恢复。

**完成标准**：

- 根仓库新克隆可获得完整 Backend、Site、配置、文档和测试源码。
- 生产 Site 版本、源码提交、数据库迁移版本和恢复责任可追踪。
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

**预计任务数**：6。**当前状态**：PLANNED。

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

**当前状态**：Normalization 后端非生产实现完成，Review UI 正式规格已确认；前端实施尚未开始，必须另立任务。行完整 Issue 查询局部门禁及性能/可访问性门禁继续有效。

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

**预计任务数**：6。**当前状态**：PLANNED。

## Phase 6 行业物料库

**目标**：在权限、来源和质量可控的前提下沉淀 PCB/FPC/SMT 行业物料知识库。

**完成标准**：

- 知识条目有来源、版本、适用范围、质量等级和版权边界。
- 公司私有主数据与行业公共知识严格隔离。
- 搜索、推荐和复用不泄露客户、供应商、价格或生产信息。
- AI 采购、报价和生产辅助只能消费已授权、可追踪的数据。

**预计任务数**：4。**当前状态**：PLANNED。
