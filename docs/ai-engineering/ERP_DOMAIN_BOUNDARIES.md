# ERP 领域、运行面与 AI 边界

## 1. 三个运行面

| 运行面 | 当前用途 | Agent硬边界 |
| --- | --- | --- |
| `chenyida_erp_site/`自托管Node/PostgreSQL | 未来唯一生产方向；当前为非生产开发基线 | 新业务逻辑只在明确任务中进入此面；服务端/API/DB为权威，浏览器不作最终判断 |
| `chenyida_erp_app/`Python/SQLite | 当前开发运行、历史完整业务参考和迁移来源 | 除书面决定外不扩展成第二套主系统；测试不得接生产SQLite |
| 历史Sites/D1 | 历史版本、行为证据和迁移来源 | 不恢复为新业务权威，不复制新增逻辑，不连接生产D1 |

Agent必须先在Task Packet声明目标运行面。发现跨面复制业务逻辑时由ERP合同守门人否决。

## 2. 当前真实边界

- 源码候选是alpha.44，PostgreSQL migration为41/head `0041_ai_governance_suggestion_evidence.sql`。
- 并行非生产UAT仍是alpha.42/0040；alpha.44/0041未build、部署或应用到UAT。
- `PHASE4-TASK03`保持`BLOCKED / OWNER_PRIORITY_HOLD / SOURCE_READY / HOLDOUT_REVALIDATION_REQUIRED / RELEASE_NOT_AUTHORIZED`。
- 当前任务不得修改`0035`、`0040`、`0041`、Schema、API/Service、测试、版本或运行环境，也不得运行正式holdout、模型、UAT访问或部署。

输入材料中“0041尚未创建”的状态已被仓库后续历史取代。设计系统必须把这种prompt/现场冲突报告出来，而不是删除或重做现有实现来迎合旧输入。

## 3. ERP硬不变量

| 领域 | 不变量 | 必需门禁 |
| --- | --- | --- |
| Material Master | 一物一码、稳定内部ID、标准属性/单位、审核和版本；供应商/客户料号只能映射 | 物料专家 + ERP + QA |
| Supplier Mapping | 映射绑定稳定对象、来源/版本/证据完整；不能成为BOM/库存主键 | Supplier专家 + ERP |
| Import/Governance | Normalization、确定性候选、人工决定、正式提交分层；原始正文不扩散 | 物料 + 安全 + AI治理（适用时） |
| BOM/Engineering | 只引用有效内部物料；版本、替代范围和客户限制受控 | ERP + DB（结构变化时） |
| Planning/Procurement | 提交时事实固化、数量精确、状态/CAS/幂等、需求到采购谱系闭合 | 制造/采购专家 + QA |
| Inventory | 过账事实不可原地改写；批次、单位、库存/在途/预留口径分离；更正用调整/冲销 | 库存专家 + DB + QA |
| Production/Quality | 工单、领退料、报工、返工、IQC/IPQC/FQC职责与状态清楚；不能自己审核自己 | 制造/品质专家 + Security |
| Sales/Finance | FQC/可发额度、Shipment/Receipt来源、AR/AP/Settlement/Reversal闭合；金额精度明确 | 财务专家 + ERP + DB |
| Auth/Audit | 每个业务接口服务端AuthN/AuthZ；关键写单事务、幂等/CAS、稳定错误/request ID、去敏审计 | Security veto + QA |

跨表写必须在一个事务中完成业务、联动、版本和审计；失败不得留下部分事实。已过账库存、生产消耗、出货和财务记录使用调整、冲销或反向记录，不原地编辑。

## 4. Schema与Migration

任何未来结构变化必须同时满足：

- 新增、不可改写的版本化Migration；Schema、snapshot、journal与运行查询一致；
- expand → backfill → switch → contract，破坏性变化不与业务切换同一步；
- 空库升级、已有数据升级、重放、失败回滚、约束和汇总核对；
- 新关系的FK或等价服务端引用校验、索引、唯一性、类型/精度/合法值；
- 临时隔离数据库、幂等可断点回填、生产前可恢复快照；
- DB专家、ERP、安全和QA独立签核。

启动时`CREATE TABLE IF NOT EXISTS`不能替代生产Migration。Agent不能修改已执行Migration来“修复测试”。

## 5. 研发 Agent 与产品 AI Governance

必须区分两个系统：

| 项目 | 研发多智能体系统 | ERP产品AI Suggestion/Evidence |
| --- | --- | --- |
| 目的 | 组织代码、审查、验证和恢复 | 为物料治理提供受控候选和证据 |
| 权威 | AGENTS/项目文档/Task Packet/Git/独立控制元数据 | D-110—D-112、0035事实、0041五表和产品Service |
| 主体 | 临时研发Agent与人工负责人 | 产品用户、确定性Evaluator/候选Service和人工审核角色 |
| 数据 | 任务、租约、消息、摘要、测试证据 | 绑定Material Governance group/run/version/digest的建议候选 |
| 正式业务写 | 默认无；只能在开发任务修改源码 | AI建议本身不直接写正式物料；人工决定调用权威服务 |

D-112的五张产品表是：

- `ai_governance_suggestion_runs`
- `ai_governance_suggestions`
- `ai_governance_suggestion_items`
- `ai_governance_suggestion_evidence`
- `ai_governance_suggestion_events`

研发控制面不得读取、复用或扩展这些表来保存Agent消息、记忆、投票、检查点或Evidence。未来控制状态必须使用独立命名空间和独立存储；若要改变此边界，必须新建ADR、威胁模型、Migration计划和独立任务，D-112本身不构成授权。

研发Agent还必须继承产品AI治理原则：AI输出是建议而非确定性/人工事实；来源、版本、证据和ABSTAIN边界明确；不得绕过服务端权限、权威业务服务、人工审批或审计；敏感正文不进入未授权模型。

## 6. 测试与验收层级

单元/集成、Migration、黑盒合成验收、并行UAT和生产发布是不同证据层。任何Agent不得把较低层PASS提升为较高层结论。尤其：

- `npm test`并非全仓全部测试；Task Packet必须按改动选取专项脚本。
- Python基线仍是`server.py --self-test`、`smoke_test.py`、`go_live_check.py`。
- UAT写、真实数据、生产Migration和发布都需独立明确授权。
- 测试失败不能通过skip、降低断言或写死结果绕过。
