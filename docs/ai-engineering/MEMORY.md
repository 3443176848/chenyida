# 上下文与长期记忆

## 1. 原则

系统不依赖无限聊天历史，也不让每个Agent反复读取全仓。上下文是带来源、摘要、版本和过期规则的最小事实集合；长期权威仍在Git文档、源码、测试工件和未来独立控制状态中。

## 2. 分层上下文

| 层 | 内容 | 典型来源 | 更新规则 |
| --- | --- | --- | --- |
| L0 宪法 | 安全、数据库、测试、资源、Git和生产硬规则 | 根`AGENTS.md` | 每次任务必读全文；摘要不能替代 |
| L1 项目事实 | 当前阶段、运行面、版本、风险、决策 | MASTER、TASKS、PROJECT_CONTEXT、DECISIONS | 启动/恢复/收口刷新；保存blob摘要 |
| L2 当前合同 | 当前Task、依赖、验收、非目标、Task Packet | `docs/tasks/<id>.md`和packet | revision变更使旧能力失效 |
| L3 领域切片 | 与任务相关的模块合同、Schema、权限、历史决策 | Context Manifest精确列出的文件/符号 | 由领域守门人选择，不全仓灌入 |
| L4 候选变更 | base/candidate SHA、diff、影响图、测试选择 | Git对象和生成摘要 | 每个新candidate重建 |
| L5 运行证据 | 命令、测试、资源、HTTP/DB去敏工件 | 临时artifact + digest索引 | 有保留期；敏感正文不入库 |
| L6 检查点 | 阶段、完成动作、未决问题、lease/fencing、副作用 | 控制事件 | 每个有界动作原子追加 |

## 3. Context Manifest

每个角色收到独立Manifest，至少包含：

- `task_id`、packet revision、角色和允许问题；
- L0/L1/L2文件的Git blob或文件摘要；
- L3允许读取的路径、符号和选择原因；
- base/candidate commit与diff摘要；
- 可读取的Evidence ID；
- 明确排除的内容、数据分类、Token上限和过期时间；
- `manifest_digest`。

R1.5的机器合同是[`context-manifest-v1.schema.json`](../agent-control/schemas/context-manifest-v1.schema.json)：固定`task_id`、packet revision、`agent_id`/`instance_id`、机器角色、能力profile、candidate、lease generation、visibility、带摘要的document清单、六项禁止上下文和`manifest_digest`。Manifest摘要按移除`manifest_digest`后的规范JSON计算；document摘要不是locator自摘要，而必须匹配Bundle显式artifact注册表中重算后的规范JSON payload。当前合成试点还按角色、agent和candidate生成唯一document白名单，要求每个实例只出现一次；Message必须逐字段匹配对应Manifest。

`BLACK_BOX_PUBLIC_ONLY`Manifest只允许`blackbox://` locator和`PUBLIC_INTERFACE`、`PUBLIC_PERSONA`、`PUBLIC_OBSERVATION`三种分类。产品源码、Git元数据、负责人未跟踪输入、真实业务数据、秘密和UAT/生产均显式禁止。该约束已由无状态验证器和断网fixture试验验证，但原生LLM身份本身仍不是OS级强制隔离。

文件漂移、任务revision或candidate变化使Manifest过期。Agent不得自行扩展L3；发现缺项时发`CONTEXT_REQUEST`，由Orchestrator验证必要性并生成新Manifest。

## 4. 角色隔离

- **实施者**看到合同、相关模块和前置审查，但不接收未来Reviewer结论。
- **Reviewer/安全/QA**看到冻结合同、candidate diff、必要源码和原始Evidence；不接收实施者的私有推理、说服性总结或未提交工作区。
- **Black-box**只看到用户可见契约、角色权限、入口、合成fixture和环境身份；不提供源码、`.git`、内部表名、测试期待或开发者结论。
- **动态专家**只看一个明确问题的最小切片；任务完成后会话退出。
- **Orchestrator**保存结构化摘要和引用，不把全部子Agent聊天拼成下一轮Prompt。

这降低相关性偏差，但不能保证同一模型族完全独立。高风险门禁仍需独立测试、确定性检查和必要的人工审阅。

## 5. 长期知识的准入

只有下列结论进入长期层：

- 项目负责人接受的重大选择进入`DECISIONS.md`；
- 当前权威事实进入MASTER/PROJECT_CONTEXT；
- 状态、依赖、责任人和验收进入TASKS；
- 已完成事实进入CHANGELOG/STATUS；
- 稳定模块合同进入对应领域文档；
- 运行控制元数据未来进入与产品数据库分离的Control Store。

Agent偏好、猜测、失败草稿、思维过程、临时路径、凭据、真实业务正文和未处置Minority Report不得沉淀为知识。假设只有被Evidence确认后才能提升为事实；过期事实要追加失效记录，不能静默覆盖历史。

## 6. Context Refresh

发生以下任一事件必须停止当前动作并刷新：

- Task Packet revision、HEAD、candidate SHA或允许路径变化；
- TASKS/DECISIONS/MASTER blob变化；
- Migration head、package version或运行面身份变化；
- 会话使用超过上下文预算的60%，出现重复读取或摘要矛盾；
- 中断超过租约期限、恢复到新Agent实例；
- Reviewer提出未在Manifest中的跨域影响。

刷新流程是：保存结构化检查点 → 释放能力/重资源 → 重新核验L0—L2 → 只加载受影响L3/L4 → 生成新digest → 恢复一个有界动作。不得通过继续堆叠聊天来“续命”。

## 7. 存储边界

未来控制存储只保存任务、租约、消息、摘要、检查点和证据locator。它不能使用ERP产品的D-112五张`ai_governance_suggestion_*`表，也不能把开发Agent输出伪装成物料候选。详情见[ERP领域边界](ERP_DOMAIN_BOUNDARIES.md#5-研发-agent-与产品-ai-governance)。
