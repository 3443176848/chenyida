# PHASE4-TASK03 — AI Suggestion/Evidence 关系化候选合同

## 任务状态

`DOING / RELATIONAL_CONTRACT_ACCEPTED / IMPLEMENTATION_NOT_STARTED`

日期：2026-08-10（Asia/Shanghai）

负责人：Codex（0035复用审计、关系模型蓝图、D-112、文档验证与独立提交）、项目负责人（范围、D-112及实施/发布边界确认）

依赖：`PHASE4-TASK02`、`D-110`、`D-111`、Migration `0035_bom_material_governance.sql`

## 严格起点

- Branch：`main`。
- HEAD：`df254a6f8018292708f60c712c451368484deac7`；Parent：`d5f4e970f0570c7838c23e3813ee9b4deaf0e2d8`。
- 唯一 worktree：`/opt/erp`；工作区和索引 clean；没有嵌套 Git 仓库。
- public `origin/main`：`39946f6b854a985b5c19106eaa6c938bddaf9c7c`，behind `0` / ahead `194`。
- `recovery-private/main`：`df254a6f8018292708f60c712c451368484deac7`，behind `0` / ahead `0`。
- 源码候选版本：`0.1.0-alpha.43`；并行非生产 UAT：`0.1.0-alpha.42`，source revision `569aa954d764309e239d1f6c174e582596d33a24`。
- Migration：`0001`—`0040`，head `0040_warehouse_receipt_readiness.sql`。
- `0035_bom_material_governance.sql` SHA-256：`d64ec733bb937d8cde11d93d5370605fb7e754ffb0c93d2f9795c8d7b66c9714`。
- `0040_warehouse_receipt_readiness.sql` SHA-256：`b6781c94da3f52a8f719ce57cdf13acbb4e3fe1c66f2a0480bdb6a9ff10a5a93`。
- UAT Web、Worker、PostgreSQL、Caddy 起点均为 `RestartCount=0`、`OOMKilled=false`；本任务不访问 UAT 数据库。

任一关键起点不匹配均应失败关闭。本轮起点逐项匹配，因此只进入 docs-only 合同工作；没有回退、reset、历史改写或重复执行 `PHASE4-TASK02`。

## 本阶段授权范围

- 完整审计 Migration 0035 的九张 `material_governance_*` 表、对应确定性治理服务和测试。
- 审计现有 Material Import、Material Master、Supplier Mapping 的关系化身份、版本、状态、审核和正式写入边界。
- 创建唯一决定 `D-112 — AI Suggestion/Evidence Relational Candidate Contract`。
- 固定五张未来候选表、稳定引用、不可变性、证据、过期、失效、丢弃、替代、CAS、幂等和审计合同。
- 记录下一实施阶段拟新增的唯一 Migration 名称 `0041_ai_governance_suggestion_evidence.sql`，但不创建该文件。
- 只新增或修改任务指令列出的九份 Markdown。

详细合同见[AI Suggestion/Evidence 关系化候选合同 V1](../material-master/ai-suggestion-evidence-relational-v1.md)，治理前提见[AI 治理评估与审批边界 V1](../material-master/ai-governance-evaluation-and-approval-v1.md)。

## 明确禁止事项

- 不创建或修改 Migration、Schema、API、UI、Service、Evaluator、评估数据集、机器报告、测试或 `package.json`。
- 不修改 `0035`、`0040` 或 `RELEASES.md`，不把 `0041`、alpha.44、实现、构建或部署描述成已存在。
- 不调用模型或外部 AI 服务，不创建/读取模型凭据，不发送真实数据。
- 不访问或修改 UAT 数据库，不运行 PostgreSQL 测试库或 Migration 测试。
- 不 build、不部署、不重启或替换服务，不读取受保护 Volume 正文。
- 不把本任务标记为 `DONE`，不启动 `PHASE4-TASK04` 或 `PHASE4-TASK05`，不授权试点、发布或生产使用。

## 0035 复用与隔离结论

| 既有结构 | 权威职责 | TASK03 允许的只读复用 | TASK03 禁止行为 |
| --- | --- | --- | --- |
| `material_governance_runs` | 已发布 Normalization 之上的确定性规则运行、版本、配置和结果摘要 | `id`、Normalization/规则/配置/结果摘要及请求追溯 | 不写入 AI run，不伪造为模型运行，不改变确定性结果 |
| `material_governance_groups` | 确定性身份/就绪度候选及 `PENDING v1` 到唯一人工终态 `v2` | 复合主体 `(id, governance_run_id)`、`version`、`group_key`、身份/兼容摘要 | 不改状态，不把 AI 建议当作组决定 |
| `material_governance_rows` | 不可变来源行快照和 Normalization/原始行谱系 | 稳定行 ID、所属组/run、`source_snapshot_digest` | 不复制原始文件或正文，不改来源事实 |
| `material_governance_specs` | 确定性类型化规格组件及证据 | 稳定规格 ID、组件代码、来源行和可重算摘要 | 不把 AI 属性写成确定性规格 |
| `material_governance_material_candidates` | `bom-material-governance-v1` 生成的确定性 ACTIVE 物料候选事实 | 仅可把稳定候选 ID/`candidate_digest`作为证据引用 | 不写入、重排或冒充 AI candidate |
| `material_governance_alternative_candidates` | 同一治理 run 内的确定性兼容性人工复核候选 | 仅可把稳定候选 ID/摘要作为证据引用 | 不把 AI 相似性伪装成确定性替代候选 |
| `material_governance_decisions` | 人工 `BIND_EXISTING`/`CREATE_DRAFT`/`EXCLUDE` 决定 | TASK03 不引用为建议输入；TASK04以后也只能独立读取历史 | AI 不得充当决定人或写决定 |
| `material_governance_material_links` | 人工决定到正式 ACTIVE/DRAFT Material 的受控衔接 | 只用于未来资格重验，不成为 AI 输出 | 不建立、修改或旁路正式链接 |
| `material_governance_events` | 唯一人工终态转换的不可变事件 | 只用于未来资格/历史重验 | 不把 AI 事件写入该表 |

0035 的确定性候选、人工决定和正式链接拥有不同权威语义与数据库守卫。AI 输出具有不确定性、版本、过期、放弃、丢弃和替代语义，若重载 0035 表会污染可复现确定性事实、模糊人工责任并可能绕过正式写入门禁，因此必须使用独立 `ai_governance_*` 边界。

Supplier Mapping 现有 `mapping_uid + mapping_version_no + row version`、稳定 supplier-part claim、职责分离、人工批准和追加事件属于正式映射权威；Material Master 现有稳定 Material ID、生命周期、版本、属性和审批属于正式主数据权威。AI 只能引用其稳定 ID、版本、状态和摘要作为候选目标/证据，不能占用供应商料号、创建 Mapping 草稿、改变 Mapping/Material 状态或写正式属性。

## D-112 收口

D-112 固定以下核心结论：

1. AI 位于确定性治理之后，只绑定一个既有治理 group、其 run、group version 和输入摘要。
2. V1 仅有 `CLASSIFICATION`、`ATTRIBUTE_EXTRACTION`、`MATERIAL_MATCH`、`SUPPLIER_MAPPING` 四项能力。
3. 建议 disposition 只有 `SUGGEST` 或 `ABSTAIN`，绝不表示批准、建档、绑定、合并或正式业务事实。
4. run、suggestion、item、evidence 均为创建后不可变事实；失效、丢弃和替代只追加事件。
5. 所有成功持久化 run 都绑定完整版本合同、强制 `expires_at`、请求/操作者、输入和结果 SHA-256；当前准入只允许 `LOCAL_DETERMINISTIC / NONE / NONE`。
6. 项目采用五表关系模型，建议目标以显式外键和 kind-specific CHECK 表达，不使用任意 polymorphic ID，也不把候选和值全部塞入无约束 JSON。
7. 每个 `SUGGEST` item 必须至少有一条同主体、可定位的证据；证据不足只能 `ABSTAIN` 或不可进入未来审核。
8. 当前有效性由服务端实时派生并失败关闭；浏览器时间、缓存状态或置信度都不是权威。
9. 同一主体、输入、能力和完整版本合同由确定性 `run_digest` 唯一化；重放返回既有结果，变化必须创建新 run 和递增 suggestion version。
10. `PHASE4-TASK04`只能用独立人工决定引用建议并调用既有权威服务；正式表在本任务不增加反向 AI 依赖。

完整决定见[D-112](../project/DECISIONS.md#d-112-ai-suggestionevidence-relational-candidate-contract)。

## 下一实施阶段蓝图

拟新增且仅拟新增的 Migration：

`0041_ai_governance_suggestion_evidence.sql`

该实施阶段至少应同时交付：

- `db/schema.ts` 与 `0041` 一致的五表定义、外键、唯一/部分唯一索引、CHECK、不可变数据库守卫和延迟完整性约束；
- 单一 AI Suggestion Service 事务、权限、CSRF、持久幂等、CAS、请求编号、审计和稳定中文错误；
- 空库升级、0040已有数据升级、重复执行、失败回滚、约束/守卫及 Schema/snapshot/journal 一致性测试；
- 不连接 UAT/生产的隔离 PostgreSQL 集成测试；
- `LOCAL_DETERMINISTIC` 适配和 D-111 完整身份/阈值重验，不接外部模型。

本阶段没有创建 `0041`、没有保留 Migration 草稿，也没有实施上述项目。

## 状态与后续边界

- `PHASE4-TASK01`保持 `DONE`。
- `PHASE4-TASK02`保持 `DONE / DETERMINISTIC_THRESHOLDS_APPROVED / RELEASE_NOT_AUTHORIZED`。
- `PHASE4-TASK03`是唯一 `DOING`，状态固定为 `DOING / RELATIONAL_CONTRACT_ACCEPTED / IMPLEMENTATION_NOT_STARTED`。
- `PHASE4-TASK04`、`PHASE4-TASK05`保持 `TODO`。
- 源码继续为 alpha.43；UAT继续为 alpha.42/0040；外部 AI 继续默认禁用。

## 本阶段验证结果

- 精确九份 Markdown、61 个本地链接、D-112/任务标题/唯一 `DOING`、TASK01—TASK05 状态矩阵、无 `0041` 文件和 `git diff --check` 均通过。
- `0035`/`0040` SHA-256 分别仍为 `d64ec733bb937d8cde11d93d5370605fb7e754ffb0c93d2f9795c8d7b66c9714` / `b6781c94da3f52a8f719ce57cdf13acbb4e3fe1c66f2a0480bdb6a9ff10a5a93`；`chenyida_erp_site/`、`package.json`、Evaluator、数据集、机器报告、测试和 `RELEASES.md` 无差异。
- 全仓 1,325 文件/1,303 文本与九文件增量敏感扫描通过。
- 断网、源码只读、单容器、1 CPU 串行验证：lint 0 error/11 条既有 warning；`npm test` 3/3；TASK02 Evaluator 17/17；0035 治理无数据库 Unit 61/61。
- 额外纯读 journal/schema 合同检查为 4/5；唯一失败来自既有测试将 migration journal 总数/head 写死为 35，而当前合法 head 已为 40（`40 !== 35`）。其余 0035 结构、约束和不可变守卫 4 项通过；该命令未连接数据库或执行 Migration，本 docs-only 任务没有修改测试或降低断言。
- 验证前后 available memory 约 `2.2/2.2 GiB`、Swap `346/347 MiB`、根盘可用 `17/17 GiB`、Load `0.02/0.13/0.11`→`0.81/0.75/0.38`；内核 OOM 匹配 0，四服务 `RestartCount=0` / `OOMKilled=false`，临时 Node 容器清零，四个受保护 Volume 保持。

## 本阶段验收结论

关系化合同和 D-112 已被任务授权接受，但实现明确未开始。后续任何 Schema/Migration、服务、API/UI、模型、真实数据、试点、构建、部署或生产动作都必须另立任务并取得明确授权。

最终判定：`PHASE4-TASK03 RELATIONAL CONTRACT ACCEPTED — IMPLEMENTATION NOT STARTED`
