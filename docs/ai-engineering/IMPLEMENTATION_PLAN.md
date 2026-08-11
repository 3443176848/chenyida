# 实施路线与第一版 MVP

## 1. 当前成熟度

| 能力 | 当前事实 |
| --- | --- |
| D-113设计基线 | 已接受 |
| PM-001总体设计 | 已完成 |
| AGENT-R1只读巡检 | 已完成；24/24专项测试，当前空闲返回IDLE |
| 本PM-002执行协议设计 | 已完成文档；没有运行时 |
| D-114 / AGENT-R1-5 | D-114已接受；AGENT-R1-5限定合成R1.5实施中 |
| 独立Agent身份/worktree强制 | 未实现、未授权 |
| Control Store、lease/fencing、Policy/Capability Broker | 未实现、未授权 |
| 有界自治循环、黑盒沙箱 | 未实现、未授权 |
| UAT/生产能力 | 无授权 |

因此当前系统只能**观察并指导人工/原生编排**，不能声称已强制隔离或自治运行。

## 2. 建议路线

本路线补充而不改写PM-001的R1—R5。每阶段必须另立正式任务，不能自动推进。

### R0 — 设计与事实基线（DONE）

PM-001、D-113、AGENT-R1和本PM-002形成角色、权限、消息、状态、黑盒、恢复、资源及ERP边界。产物只有文档和只读巡检，不改变ERP业务运行面。

### R1.5 — Native-Orchestrated Design MVP（DOING / AGENT-R1-5 / SYNTHETIC ONLY）

目标是在不造daemon和控制数据库的前提下，用Codex原生临时编排验证协议是否可用：

- Task Packet v2与Message Contract的版本化JSON Schema；
- 角色专属Context Manifest及摘要校验；
- 一个任务一个branch/worktree、一个产品写者的人工发放协议；
- 领域/安全/QA独立消息和Minority Report处置；
- 只使用合成数据的真黑盒fixture；
- R1只读前后巡检、Markdown/范围/资源报告；
- 试点限于docs/test-only或专用fixture，不改ERP业务、Migration、UAT或部署。

MVP不包含常驻LLM、自动任务认领、控制数据库、秘密代理、网络、UAT、生产、push或deploy。

### R2 — 隔离执行底座（NOT AUTHORIZED）

实现PM-001既定的独立Unix/容器身份、worktree、路径/领域/Migration租约、Control Store、命令/秘密代理、global heavy lease、追加事件和fencing。必须以越权、symlink/hardlink、路径穿越、秘密泄漏、生产URL、旧lease回写、脑裂及资源触线负测证明默认拒绝。

### R3 — 有界开发循环（NOT AUTHORIZED）

在R2之上实现单任务DAG、一个有界动作、结构化消息验证、独立门禁、candidate失效、retry/failure预算、PARKED事件唤醒、deadlock和崩溃恢复。先用完全合成的小任务证明中断、重复执行、timeout-after-write、RESULT_UNKNOWN和治理收口；不从`TASKS.md`自动认领下一任务。

### R4 — 受控非生产验收（NOT AUTHORIZED）

仅在前序负测通过后，为精确UAT动作提供一次性capability、环境身份、幂等键、前后指纹、审计和回退。每个登录、业务POST、Migration、build和部署分别授权；测试主体和数据可清理且不能影响受控PO或protected volumes。

### R5 — 生产候选能力（NOT AUTHORIZED）

前置条件包括CI、异机Git/镜像/数据恢复锚点、恢复演练、完整UAT、Runbook、安全审查、最小权限和人工双门。生产仍逐任务、逐动作明确授权；多Agent系统永不自行切流。

## 3. 为什么不先开发完整Orchestrator

当前2核/4 GiB服务器、现有受控UAT和单一仓库流程不需要消息队列、微服务集群或多个常驻模型。先使用Codex原生能力能验证角色/协议的实际价值，避免在业务功能之外新建一个未经验证的高权限平台。

自研只用于必须确定性强制且原生会话无法可靠承担的部分：能力、lease/fencing、状态原子性、证据、检查点、资源和恢复。模型负责分析与生成候选，不负责判定自己的权限是否有效。

## 4. 当前服务器能力上限

现在可安全做到：

- R1只读对账和IDLE清单；
- 版本化设计/Task Packet和顺序式Codex临时角色；
- 最多2个轻量只读分析角色，或1个产品写者；
- 一次1个受限临时容器/测试库的隔离测试；
- 完全合成、loopback、无源码挂载的黑盒试点。

现在不可声称安全做到：

- 多个常驻自治LLM或并行build/Migration/数据库测试；
- 多写者并行修改同一产品树；
- 仅凭Prompt实现OS级隔离、秘密保护或production deny；
- 自动UAT登录/业务写、部署、生产访问或恢复被冻结的产品任务。

## 5. R1.5验收标准

1. 只在另立任务的允许路径中实现；不修改ERP业务和现有Migration。
2. Task Packet/Message/Context Schema对缺字段、未知字段、错SHA、过期revision和越权role失败关闭。
3. 一个合成任务完成Implementation → 独立ERP/Security/QA → Black-box → Closure；身份与上下文不复用。
4. Reviewer拒绝、Security veto、QA失败和Minority Report各至少一条故障注入，修复后新SHA使旧签核失效。
5. 中断检查点可恢复；重复消息、旧lease和`RESULT_UNKNOWN`不会重放写操作。
6. 资源门、单重任务、临时资源清理和protected volumes保护通过。
7. R1前后均能核对治理状态；完成后返回IDLE，不自动启动R2或产品任务。

## 6. 从当前HEAD开始的最安全顺序

1. 本PM-002只完成设计、验证、治理同步和独立文档commit，然后停止。
2. 项目负责人审阅D-114，明确接受、修改或拒绝“原生优先/零常驻LLM/四逻辑职责/R1.5”选择。
3. 若接受，另立R1.5任务；启动前重新核验HEAD、用户改动、TASKS唯一槽、资源和`PHASE4-TASK03`冻结事实。
4. 先只实现JSON合同与静态验证，再验证Context Manifest和单写者worktree协议；每个步骤独立测试/提交。
5. 用专用合成docs/test fixture做一次原生编排试点，明确注入veto、失败和恢复；不使用D-112五表或真实ERP数据。
6. 收集资源、误报、遗漏和人工成本；负责人决定是否值得启动R2。
7. R2先做默认拒绝的身份/路径/命令/lease薄层及负测；R3再做有界循环和恢复。
8. R4/R5只有在前序安全证据及独立授权后考虑。整个序列不自动恢复`PHASE4-TASK03`、重跑holdout、build/deploy或连接UAT/生产。

## 7. 主要风险

| 风险 | 控制 |
| --- | --- |
| 同一模型产生相关性错误 | 独立Context、确定性测试、对抗角色、Minority Report、高风险人工复核 |
| Prompt权限被误当强制隔离 | R1.5诚实标记人工边界；R2负测通过前不宣称强制 |
| 控制面复杂度反噬ERP | native-first、单进程薄层、阶段验收、不建微服务群 |
| Agent消耗服务器资源 | 0常驻LLM、最多2轻量角色、全局heavy lease和硬停止线 |
| 状态/证据分裂 | TASKS权威、Git SHA、追加事件、fencing/CAS、只读reconcile |
| 黑盒名不副实 | 新实例、无source/.git挂载、接口级sandbox；否则标GRAY_BOX |
| 研发AI污染产品AI数据 | 独立控制存储和命名空间，禁止使用D-112五表 |
| 路线表被误当授权 | 每阶段`NOT AUTHORIZED`，必须另立任务和负责人状态变更 |
