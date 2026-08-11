# 角色目录与动态专家

> 适用说明：本文件同时位于一个受根`AGENTS.md`约束的子目录。它是PM-002角色设计，不会激活任何Agent或授予运行权限；以后修改本目录仍须先遵守根规则、项目权威文档和正式任务授权，且只能增加更严格边界。

## 1. 角色不是常驻进程

本文的“Agent”是任务期独立责任与能力身份。除四个由单进程承载的逻辑控制职责外，所有认知角色按Task Packet动态创建、产出结构化交付后退出。角色数量由风险触发器决定，不按固定人数填满。

## 2. 必需任务角色

| 角色 | 何时创建 | 核心交付 | 默认能力 | 不得兼任 |
| --- | --- | --- | --- | --- |
| 任务编排负责人 `Delivery Conductor` | 每项正式任务 | 事实清单、DAG、角色/预算、门禁状态、最终汇总 | READ_ONLY、控制消息 | 产品实施者、最终QA或安全签核人 |
| 实施构建者 `Change Builder` | 需要仓库变更时 | 有界diff、候选commit、变更说明、自测证据 | WORKTREE_WRITE、受限TEST_EXECUTION；按任务可GIT_COMMIT | 本候选的领域/安全/QA批准者 |
| ERP合同守门人 `ERP Contract Guardian` | 所有业务、数据、权限或流程变化 | 业务不变量、交接链、权威服务和运行面审查 | READ_ONLY | 实施者 |
| 反证审查员 `Adversarial Examiner` | 所有非机械变更 | 失败假设、边界/并发/幂等/CAS/兼容性问题、Minority Report | READ_ONLY，可执行静态只读检查 | 实施者、QA签核人 |
| 安全边界审查员 `Security Boundary Examiner` | API、Auth、上传、数据、AI、UAT/生产、依赖或网络变化 | 威胁模型、越权/泄漏/注入审查、安全门禁 | READ_ONLY，受限TEST_EXECUTION | 实施者 |
| 独立验证员 `Independent Verifier` | 所有代码/配置变化；高风险文档变化 | 自主测试计划、原始结果、缺口、PASS/FAIL | TEST_EXECUTION；需要时DATABASE_TEST | 实施者、同候选自测身份 |
| 黑盒场景导演 `Workflow Simulation Director` | 用户流程、API、权限、状态机或UX变化 | Persona集合、接口级场景、观察结果、业务验收 | 隔离BLACKBOX_TEST | 源码审查、产品写入、候选修复 |
| 治理收口员 `Ledger Closer` | 所有任务完成时 | MASTER/TASKS/CHANGELOG/STATUS一致性、决策引用、范围清单 | 只写授权文档路径，可GIT_COMMIT | 不能改变尚未通过的技术结论 |

纯文档任务可省略黑盒导演和部分专家，但领域/安全/独立验证的适用性判断必须写入Task Packet，不能无声省略。Schema/Migration、权限、财务、库存、生产、AI治理或UAT任务不得省略对应门禁。

## 3. 动态专家生成机制

### 3.1 触发规则

Orchestrator根据变更路径、任务标签和风险声明匹配专家；未匹配但出现新风险时，任何门禁角色都可请求创建专家。

| 触发器 | 临时专家 | 必查事实 |
| --- | --- | --- |
| `db/schema.ts`或`drizzle-postgres/` | 数据库与Migration专家 | expand/backfill/switch/contract、journal一致性、升级/重放/回滚、FK/index/precision |
| Material Master/Import/Governance | 物料治理专家 | 一物一码、稳定内部ID、属性/单位、审核、替代/客户限制、0035边界 |
| Supplier Mapping/采购来源 | 供应商映射专家 | supplier item只作映射、版本/证据、精确绑定、采购谱系 |
| Planning/Production/Quality | 制造与质量专家 | 固化包、预留/领料/退料、批次、IQC/IPQC/FQC、异人处置和不可变事实 |
| Inventory/Finance | 库存与财务专家 | 过账不可原改、冲销链、数量/金额精度、来源闭合、余额投影 |
| AI建议、模型、Evaluator或去敏数据 | AI治理专家 | D-110—D-112、ABSTAIN、证据、人工责任、数据外发和产品/研发控制面隔离 |
| 页面、交互、移动端 | 前端体验专家 | 权限诚实性、确认/取消、可访问性、390px、状态文案与API事实一致 |
| 查询/批处理/大量数据 | 性能专家 | 查询计划、索引、界限、内存、队列与低资源退化 |
| backup/restore/中断/幂等恢复 | 恢复专家 | 快照、恢复点、重放、RESULT_UNKNOWN、清理与protected volumes |
| branch/commit/push/release/deploy | Git与发布专家 | 基线、父提交、远端边界、可恢复性、候选/发布身份、回滚 |

### 3.2 Spawn合同

每次动态创建必须记录：

- `expert_id`、`task_id`、触发证据和唯一问题；
- 冻结输入SHA和Context Manifest；
- 默认READ_ONLY能力、时间/Token/命令预算；
- 期望输出、完成条件、过期时间；
- 是否拥有门禁权。默认专家只提供建议，只有Task Packet预先声明的强制专家拥有领域否决。

不得以“多找几个Agent投票”解决不确定性。相同问题最多创建一名主专家和一名明确的反证专家；需要更多意见时先形成冲突陈述并由负责人决定是否扩大成本。

### 3.3 退出

专家在交付`COMPLETE`、`FAILED`或`BLOCKED`消息后撤销能力、释放租约、固定输出摘要并终止会话。输出不会成为永久Prompt记忆；被接受的结论应进入Task Packet、DECISIONS或模块知识摘要。

## 4. 责任分离最小规则

1. 实施者可以自测，但自测不能满足QA门禁。
2. Reviewer可以给出修复建议，但不能在候选worktree改代码；修复必须回到实施者并产生新SHA。
3. QA自行查看diff、选择测试并读取原始结果，不只接收实施者摘要。
4. Black-box角色不知道内部目录、表名、实现策略或开发者预期，只接收公开接口、角色权限和业务目标。
5. Orchestrator汇总签核但不代替任何必需签核，也不能以多数票覆盖否决。
6. 同一个Agent实例不得通过“切换角色Prompt”兼任同一候选的实施与批准。

## 5. 与实际业务身份的关系

产品已有`admin`、`manager`、`purchase`、`engineering`、`planning`、`production`、`warehouse`、`quality`、`sales`、`finance`和`operations`等业务身份。它们是黑盒Persona和AuthZ验收输入，不是研发Agent权限。研发Agent不得因为模拟`admin`而获得UAT/生产管理员凭证；Persona的权限必须由隔离fixture提供。
