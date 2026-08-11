# 晨亿达 ERP 多智能体研发系统

> 任务：`PM-002`
> 状态：`DESIGN COMPLETE / IMPLEMENTATION NOT STARTED`
> 日期：2026-08-11（Asia/Shanghai）
> 基线：设计取证开始时为 `main@2c8f8b2e224e4a9b0a2ec9e01a5998898ff95aaf`
> 决策：继承已接受的 [D-113](../project/DECISIONS.md#d-113-晨亿达erp多智能体研发控制面采用单一任务最小能力与可恢复有界循环)；新增选择见待负责人确认的 D-114
> 边界：本目录是研发控制面设计，不是 Agent Runtime，也不是 ERP 产品中的 AI Suggestion 功能

## 1. 结论

晨亿达 ERP 适合引入受控多智能体研发，但不适合在当前服务器上运行一群常驻自治 LLM。仓库同时具有 3 个必须区分的运行面、41 个 PostgreSQL Migration、34 个 `app/lib` 领域目录、31 个 Service、21 个 Repository、31 个 Handler、225 个测试文件、11 类业务身份，以及严格的 UAT、恢复和低资源约束。复杂度足以要求职责分离；资源和风险又要求单任务、单写者、重任务串行、人工发布。

推荐形态是：

- 4 个常驻**逻辑控制职责**，由 1 个低资源、确定性进程承载；常驻 LLM 数量为 0。
- 每个正式任务按风险动态创建实施、领域、对抗、安全、QA、黑盒及专项专家角色；角色完成交付即退出。
- 第一版利用 Codex 原生任务/多智能体能力提供临时认知编排，复用现有 `AGENT-R1` 只读巡检器；只在后续明确授权后补建租约、能力代理、检查点和证据索引等确定性薄控制层。
- 任何业务写入、Migration、UAT、部署和生产动作继续服从仓库任务、决策和人工授权，不因“Agent 同意”获得权限。

## 2. 仓库事实与输入冲突

本设计以现场仓库为权威，记录而不静默覆盖以下冲突：

| 项目 | 输入中的旧事实 | 2026-08-11现场事实 | 设计处理 |
| --- | --- | --- | --- |
| Git HEAD | `0d6b5961…` | `2c8f8b2e…` | 采用现场HEAD；不改Git拓扑、不fetch/push |
| public差异 | ahead 195 | `main...origin/main [ahead 203]` | 采用本地只读引用；不向public推送 |
| private同步 | 与旧HEAD同步 | 本地tracking ref停在`545261353…`，当前HEAD ahead 5 | 只记录；不访问远端或同步 |
| 工作区 | clean | 有项目负责人既有未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md` | 保持不读、不改、不暂存、不提交 |
| TASK03 | 合同已接受、实现未开始 | alpha.44/0041及确定性候选源码已实现，任务因owner优先级冻结 | 保持`BLOCKED / OWNER_PRIORITY_HOLD / SOURCE_READY / HOLDOUT_REVALIDATION_REQUIRED / RELEASE_NOT_AUTHORIZED` |
| 多智能体设计 | 尚待设计 | PM-001、D-113及AGENT-R1已完成 | PM-002只补充可执行协议与缺口，不重开PM-001或实现R2—R5 |

`AGENT-R1`当前是无状态只读观察器：能核验本地Git、文档、版本和Migration漂移，空闲时返回`IDLE`；它不是调度器、策略引擎、能力代理或隔离边界。

## 3. 文档地图

| 文档 | 回答的问题 |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 拓扑、常驻职责、原生编排与自研边界 |
| [AGENTS.md](AGENTS.md) | 核心角色、动态专家、责任与退出条件 |
| [ORCHESTRATION.md](ORCHESTRATION.md) | DAG、阶段门、独立复核、冲突和少数报告 |
| [PERMISSIONS.md](PERMISSIONS.md) | READ/WRITE/EXECUTE/DATABASE/NETWORK/GIT/DEPLOY能力模型 |
| [MESSAGE_PROTOCOL.md](MESSAGE_PROTOCOL.md) | 结构化消息、证据、状态和交接合同 |
| [STATE_MACHINE.md](STATE_MACHINE.md) | TASKS四态、交付状态机和非法迁移 |
| [MEMORY.md](MEMORY.md) | 分层上下文、长期记忆和污染隔离 |
| [RESOURCE_GUARD.md](RESOURCE_GUARD.md) | Token、CPU、RAM、Swap、Docker与并发保护 |
| [BLACK_BOX_SIMULATION.md](BLACK_BOX_SIMULATION.md) | 真黑盒边界、动态Persona和验收证据 |
| [FAILURE_RECOVERY.md](FAILURE_RECOVERY.md) | 有界重试、死锁、检查点、中断恢复和真BLOCKED |
| [ERP_DOMAIN_BOUNDARIES.md](ERP_DOMAIN_BOUNDARIES.md) | ERP领域硬门禁、运行面与D-112隔离 |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | 低风险分期、MVP、停止线和实施前置授权 |
| [PM-002任务文档](../tasks/PM-002.md) | 本次设计范围、验收与不实施声明 |

历史 [PM-001系统设计](../AI_AGENT_TEAM_DESIGN.md) 仍是D-113的设计依据。本目录是面向实施的补充规范；若二者冲突，已接受的D-113、项目权威文档和更严格的安全边界优先，冲突必须形成决策，不得由Orchestrator自行解释。

## 4. 十五项直接回答

1. **当前 ERP 是否适合引入多 Agent？** 适合受控引入。领域、权限、迁移和测试复杂度需要职责分离；当前资源与生产风险不适合无界自治。
2. **应该使用多少个常驻 Agent？** 4个常驻逻辑职责，由1个确定性轻进程承载；常驻LLM为0。任务期间最多并行2个轻量认知角色，重任务始终1个。
3. **哪些 Agent 应该动态创建？** 实施构建者、ERP合同守门人、对抗审查员、安全审查员、独立验证员、黑盒场景导演，以及按触发条件创建的数据库/Migration、物料、供应商、生产/品质、库存/财务、AI治理、UX、性能、恢复、Git/Release专家。
4. **谁拥有代码写权限？** 每个工作项唯一的实施构建者；若有Migration，则由独立指定的数据库实施者持有该文件唯一写租约。文档收口者只写授权文档路径。Reviewer、Security、QA和Black-box默认无产品写权限。
5. **谁拥有最终否决权？** ERP合同守门人对业务/数据不变量、安全审查员对安全与数据边界、独立QA对证据与回归拥有门禁否决；Migration任务还需数据库门禁。项目负责人独占任务范围、UAT、发布和生产授权。否决不能以多数票覆盖。
6. **如何防止上下文污染？** 使用角色专属Context Manifest、冻结SHA/摘要、独立worktree或只读快照；Reviewer只看合同、候选diff和证据，黑盒角色只看公开界面/协议/夹具，不接收实现笔记或开发者结论。
7. **如何避免自己实现、自己测试、自己批准？** 写入身份、验证身份和门禁身份分离；候选提交冻结后，QA在干净环境自行选测和执行；至少领域、安全、QA必需角色不能与实施者同一身份，Orchestrator不得代签。
8. **如何长时间运行？** 外部确定性事件循环每轮只执行一个有界动作，落检查点后退出或继续；等待时释放租约，由文档/Git/队列/人工授权事件唤醒，而不是保持长对话或忙轮询。
9. **如何恢复中断任务？** 从Task Packet、冻结基线、worktree状态、lease/fencing、最后完整检查点和副作用清单重建；先只读对账，`RESULT_UNKNOWN`不得重放写操作，无法证明安全时进入真BLOCKED。
10. **如何控制资源？** 使用分层Context预算、摘要替代全量历史、最多2个轻量角色并发、全局重任务锁、一次1个临时容器/测试库、`COMPOSE_PARALLEL_LIMIT=1`及仓库既有内存/Swap/磁盘/Load停止线。
11. **如何结合现有流程？** `MASTER → TASKS → PROJECT_CONTEXT → Task Packet → 开发/验证 → MASTER/TASKS/CHANGELOG/STATUS → 独立Commit`；重大选择进`DECISIONS`，TASKS仍只有TODO/DOING/DONE/BLOCKED，控制层阶段不得反向改写台账事实。
12. **自研Orchestrator还是Codex原生编排？** MVP优先Codex原生临时编排加现有R1；不先造微服务。后续只自研确定性、可测试且原生能力无法强制的薄层：策略、租约、能力代理、检查点、证据索引和恢复对账。
13. **当前服务器能实现到什么程度？** 可安全承载R1、文档/协议、顺序式原生角色、轻量只读对账和单个隔离测试任务；在未做R2隔离与负测前，不适合常驻多LLM、并行build/数据库、自治UAT或生产控制。
14. **第一版MVP是什么？** `R1.5 Native-Orchestrated Design MVP`：Task Packet v2、消息合同、Context Manifest、单写者worktree、人工能力门、独立QA/安全/领域签核、一个完全合成的黑盒试点；不含daemon、数据库控制库、自动部署或产品业务修改。
15. **从当前HEAD最安全的顺序是什么？** 先由负责人审阅并接受/修改D-114；另立并授权R1.5任务；冻结协议和试点范围；用docs/test-only合成任务验证角色隔离；再实施R2策略/租约薄层并做越权与恢复负测；然后才考虑R3有界开发循环。期间不自动恢复PHASE4-TASK03、不运行holdout、不build/deploy、不连接UAT/生产。

## 5. 本设计的停止线

本文完成后停止。它不授权创建控制数据库、`.ai-team/`运行目录、daemon、Agent账号、worktree、测试库或容器，也不授权修改产品代码、Schema/Migration、D-112五表、测试、版本、UAT或部署。任何下一阶段必须有新的任务编号、明确状态迁移、允许路径、资源预算和人工授权。
