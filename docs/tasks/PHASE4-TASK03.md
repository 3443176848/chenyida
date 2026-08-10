# PHASE4-TASK03 — AI Suggestion/Evidence 关系化候选层源码实现

## 任务状态

`DOING / SOURCE_READY / HOLDOUT_REVALIDATION_REQUIRED / RELEASE_NOT_AUTHORIZED`

日期：2026-08-10（Asia/Shanghai）

负责人：Codex（0041、Schema、确定性候选服务、受保护API、隔离测试、文档与独立提交）、项目负责人（D-112、源码实施范围及发布边界确认）

依赖：`PHASE4-TASK02`、`D-110`、`D-111`、Migration `0035_bom_material_governance.sql`

## 严格起点

- Branch：`main`。
- HEAD：`0d6b5961b2ed280ca80b15678ac42665aad1b45e`；Parent：`df254a6f8018292708f60c712c451368484deac7`。
- 唯一 worktree：`/opt/erp`；工作区和索引 clean；没有嵌套 Git 仓库。
- public `origin/main`：`39946f6b854a985b5c19106eaa6c938bddaf9c7c`，behind `0` / ahead `195`。
- `recovery-private/main`：`0d6b5961b2ed280ca80b15678ac42665aad1b45e`，behind `0` / ahead `0`。
- 源码候选版本：`0.1.0-alpha.43`；并行非生产 UAT：`0.1.0-alpha.42`，source revision `569aa954d764309e239d1f6c174e582596d33a24`。
- Migration：`0001`—`0040`，head `0040_warehouse_receipt_readiness.sql`。
- `0035_bom_material_governance.sql` SHA-256：`d64ec733bb937d8cde11d93d5370605fb7e754ffb0c93d2f9795c8d7b66c9714`。
- `0040_warehouse_receipt_readiness.sql` SHA-256：`b6781c94da3f52a8f719ce57cdf13acbb4e3fe1c66f2a0480bdb6a9ff10a5a93`。
- UAT Web、Worker、PostgreSQL、Caddy 起点均为 `RestartCount=0`、`OOMKilled=false`；本任务不访问 UAT 登录、API或数据库。
- 资源起点约为 available memory `2.2 GiB`、Swap `348 MiB / 1 GiB`、根盘可用 `17 GiB`且Load低于停止阈值。

任一关键起点不匹配均应失败关闭。本轮起点逐项匹配，因此进入D-112授权的源码实施；没有回退、reset、历史改写或重复执行`PHASE4-TASK02`。

## 本阶段授权范围

- 新增唯一Migration `0041_ai_governance_suggestion_evidence.sql`，同步`db/schema.ts`、snapshot和journal，实现D-112五表、约束、索引、写门禁和延迟完整性触发器。
- 有界修正历史Migration合同测试中把旧Migration误当全局journal head的机械断言，不修改`0001`—`0040`。
- 新增独立`ai-governance-suggestion-selfhost`模块，实现`LOCAL_DETERMINISTIC`四能力、稳定摘要、事务持久化、幂等、CAS、审计、过期及漂移失败关闭。
- 接入受保护POST/GET候选API；只复用既有读取/运行权限，不增加人工审核、丢弃、批准或正式提交API。
- 源码候选升至`0.1.0-alpha.44`，新增专项typecheck、Unit/Handler、Migration和隔离PostgreSQL测试。
- 更新任务指令列出的九份Markdown并创建三个独立提交。

详细合同见[AI Suggestion/Evidence 关系化候选合同 V1](../material-master/ai-suggestion-evidence-relational-v1.md)，治理前提见[AI 治理评估与审批边界 V1](../material-master/ai-governance-evaluation-and-approval-v1.md)。

## 明确禁止事项

- 不修改`0001`—`0040`、D-111阈值、Evaluator逻辑、calibration、holdout、manifest、标签、既有机器报告或`RELEASES.md`。
- 不执行正式all-splits/holdout CLI，不生成新的正式评估报告，不以开发测试宣称D-111重验通过。
- 不调用模型或外部 AI 服务，不创建/读取模型凭据，不发送真实数据。
- 不登录UAT，不调用UAT API，不访问或修改UAT数据库；PostgreSQL只允许全新隔离测试库。
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

## 第二阶段源码实现结果

- 持久层提交`8b839a64b219b91f7b83ab8ce5a0819ac2486105`新增`0041_ai_governance_suggestion_evidence.sql`、五表Drizzle Schema、`0041_snapshot.json`和journal entry；同时按各自`idx/tag`修正0034/0035/0037/0039历史journal测试，不删除或降低旧约束断言。
- `0041`为expand-only且不回填旧数据；五表使用真实/复合FK、`ON DELETE RESTRICT`、kind-specific和typed-value CHECK、SHA-256/TTL/score/version约束、业务唯一及部分唯一索引、`cyd.ai_governance_suggestion_service_write`写门禁、五表UPDATE/DELETE拒绝和延迟完整性/版本链/事件链触发器。最终SHA-256为`676626b9dcb78f31643612e5662cf5c36e06259c72ff922287bb913394071bf2`。
- 服务提交`218ef1b483cbd915c6e83013d7193e37c53a0eb1`新增独立types/errors/canonical/config/adapter/repository/service/handler模块并只在`selfhost-api.ts`接线。批准身份固定为`LOCAL_DETERMINISTIC/NONE/NONE`、`bom-material-governance-v1`、`ai-governance-evaluator-v1`、`deterministic-ai-governance-thresholds-v1`、`synthetic-material-governance-v1@1.0.0`和source revision`d69f6dff795377109244e788c2ffee73ef6194ec`；confidence及其semantics均为空。
- `CLASSIFICATION`只接受唯一ACTIVE Category；`ATTRIBUTE_EXTRACTION`只接受ACTIVE定义和严格类型/单位转换；`MATERIAL_MATCH`只接受唯一ACTIVE严格身份候选；`SUPPLIER_MAPPING`只接受唯一ACTIVE Supplier、唯一稳定supplier-part事实、精确ACTIVE Mapping和唯一合格ACTIVE Material。缺失、歧义、冲突、失效、转换失败、证据不足或上限超出均安全`ABSTAIN`。
- 服务端在数据库事务时间重新读取并验证batch/run/group/row/spec/lineage及引用；稳定canonical摘要排除自增ID、随机UUID、请求时间和展示文案。创建在单一事务内完成run、suggestion、items、evidence、CREATED/必要SUPERSEDED事件、Audit和持久幂等响应；相同key+摘要或相同`run_digest`重放原响应，不同正文稳定409，新版本连续分配。
- 读取使用同一只读快照实时派生有效性并重算摘要；过期、终止、输入/group/引用/合同漂移均失败关闭，GET不补写失效事件。候选服务未调用Material、Supplier Mapping或0035正式决定写服务，隔离测试证明正式业务表写入为0。

## API与安全边界

- POST/GET `/api/material-master/import-batches/{batchId}/governance-runs/{runId}/groups/{groupId}/ai-suggestions`及GET detail `.../ai-suggestions/{suggestionUid}`已接入。
- 生成复用`material.import.governance.run`，读取复用`material.import.governance.read`及既有批次可见性；must-change账号禁止写。
- POST要求Origin/CSRF、`Idempotency-Key`、256 KiB流式正文上限和精确`capability + expected_group_version`白名单；响应带request ID和`no-store`，异常返回稳定代码、中文提示或去敏通用500，Audit不记录正文/秘密。
- 没有discard、approve、accept、correct或formalize API；TASK04人工审核仍未开始。

## 状态与后续边界

- `PHASE4-TASK01`保持 `DONE`。
- `PHASE4-TASK02`保持 `DONE / DETERMINISTIC_THRESHOLDS_APPROVED / RELEASE_NOT_AUTHORIZED`。
- `PHASE4-TASK03`是唯一`DOING`，状态固定为`DOING / SOURCE_READY / HOLDOUT_REVALIDATION_REQUIRED / RELEASE_NOT_AUTHORIZED`。
- `PHASE4-TASK04`、`PHASE4-TASK05`保持 `TODO`。
- 源码候选为alpha.44/0041且仅源码就绪；并行非生产UAT继续为alpha.42/0040；外部AI继续默认禁用。
- 下一步必须按D-111对alpha.44完整身份执行独立正式holdout重验；在重验和独立发布授权前不得build、部署、运行UAT Migration或启动TASK04/TASK05。

## 本阶段验证结果

- 0041静态Migration/Schema/snapshot/journal合同5/5，隔离PostgreSQL空库0001→0041、0040已有数据升级、重复执行、失败回滚及约束/守卫7/7；0035既有Migration合同5/5。Schema、snapshot、journal与Migration head 0041一致。
- Suggestion Unit/Handler 9/9、隔离PostgreSQL Service 5/5、专项typecheck通过；既有0035 Governance Unit/Handler/Metadata 61/61、TASK02 Evaluator 17/17及`npm test`3/3通过。lint为0 error/11条既有无关warning，任务新增warning为0。
- PostgreSQL覆盖原子创建/Audit/持久幂等、run digest重放、并发单run、连续v2/SUPERSEDED、服务端过期、group/输入/引用漂移、GET零业务写和Audit故障全回滚；Migration覆盖非Service写、UPDATE/DELETE、四item组合、SUGGEST/ABSTAIN/evidence及非法digest/TTL/version/score/mix/跨group拒绝。
- `0035`/`0040` SHA-256仍为`d64ec733bb937d8cde11d93d5370605fb7e754ffb0c93d2f9795c8d7b66c9714`/`b6781c94da3f52a8f719ce57cdf13acbb4e3fe1c66f2a0480bdb6a9ff10a5a93`；TASK02 calibration、holdout、manifest、标签、机器报告和`RELEASES.md`未修改，正式holdout未重跑。
- 所有Node/PostgreSQL验证串行、断网、源码只读、1 CPU、受控heap且一次一个测试容器/数据库；完成后测试库、容器和目录清零。起点/源码测试完成后available约`2.2/2.3 GiB`、Swap约`348/352 MiB`、根盘可用`17/17 GiB`、最终Load`0.27/0.71/0.53`；内核OOM匹配0，四服务restart0/OOM false，四个受保护Volume保持且未读取正文。

## 本阶段验收结论

关系化合同已按D-112实现为alpha.44/0041源码候选，且开发与隔离数据库验证通过；这只构成source readiness。正式holdout尚未重验，源码未build，0041未部署或应用到UAT，人工审核、模型、真实数据、试点和发布均未获授权。

最终判定：`PHASE4-TASK03 AI SUGGESTION/EVIDENCE SOURCE READY — HOLDOUT REVALIDATION REQUIRED / NOT BUILT / NOT DEPLOYED`
