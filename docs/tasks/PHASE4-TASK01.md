# PHASE4-TASK01 — 建立 AI 治理评估与审批边界

## 任务状态

`DONE / GOVERNANCE BASELINE ACCEPTED / IMPLEMENTATION NOT STARTED`

日期：2026-08-10（Asia/Shanghai）

负责人：Codex（治理规格、评估合同、文档验证与独立提交）、项目负责人（任务范围、D-110与后续阈值/试点审批边界）

依赖：Material Import 治理链路、Material Master V2 既有权限/审核/审计合同、`SELFHOST-OPS-RECOVERY-FOUNDATION-39`行政收口提交`f17cc31d60bac70d6d3545f1904de6d54feeb4dd`

## 1. 最终判定

`PHASE4-TASK01 AI GOVERNANCE BASELINE ACCEPTED — IMPLEMENTATION NOT STARTED`

本任务只建立 AI 治理、离线评估和人工审批合同。没有实现模型调用、API、页面、Schema、Migration、Evaluator、候选表、试点或部署。

## 2. 严格起点与状态交接

- 本轮总起点：唯一 worktree、clean `main@19b770c0219d2592b6b94aa2a22f0af8465db88b`，Parent `c96f9bfc912cb2a5dc6f4a3ad47bb51260847dbd`。
- public `origin/main`：`39946f6b854a985b5c19106eaa6c938bddaf9c7c`，相对本轮总起点 behind `0` / ahead `189`。
- `recovery-private/main`：本轮总起点 `19b770c0219d2592b6b94aa2a22f0af8465db88b`，behind `0` / ahead `0`。
- 源码和非生产 UAT：`0.1.0-alpha.42`；运行 Web Image ID：`sha256:e7761e2c61bfe77c6aab526fb0b6cbd840ad1bf6300381f4319f6e279af94964`；Migration：`0001`—`0040`。
- 四服务起点 `RestartCount=0`、`OOMKilled=false`；四个受保护 Volume 存在。
- TASK39先以独立提交`f17cc31d60bac70d6d3545f1904de6d54feeb4dd`完成行政收口，随后本任务才成为唯一产品工作范围。

## 3. 交付物

- 本任务文档。
- [`AI 治理评估与审批边界 V1`](../material-master/ai-governance-evaluation-and-approval-v1.md)。
- [`D-110 AI治理评估、审批与外部模型准入边界`](../project/DECISIONS.md#d-110-ai治理评估审批与外部模型准入边界)。
- Phase 4 五任务路线和项目状态文档同步。

## 4. 已固化治理边界

1. AI只生成建议和证据，不能直接创建、合并、启用、冻结、停用或覆盖正式物料。
2. AI不能直接写物料主数据、正式属性、supplier/legacy mapping、BOM、库存、采购、生产、品质或财务事实。
3. 正式写入继续由服务端权限、事务、CAS、幂等、审核和审计控制，AI不得降低既有节点。
4. 确定性冲突、客户专用、单位不兼容、冻结和生命周期门禁优先。
5. 超时、无证据、非法Schema、版本漂移、低置信度和模型异常失败关闭为`NEEDS_REVIEW`或无建议。
6. 外部AI供应商默认禁用；本任务不选供应商、不创建Key、不发送真实受限数据。
7. 未来外部模型准入必须先完成数据分类、脱敏、保留期、地域、合同和凭据授权。
8. 每条建议必须有稳定ID和完整输入/数据/规则/模型/prompt/参数/Schema/字段证据/置信度/request/time追溯链。
9. 人工决定与AI建议分开保存；反馈不得自动训练、调阈值或改变生产规则。
10. 采购、工程、品质和主数据管理员继续承担来源、规格、合规和最终建档/合并责任；AI不是审批人。
11. 模型、prompt、规则或阈值变化必须新版本并重新通过固定评估集，禁止静默升级。
12. 未来实现必须有停用开关、回退版本和漂移复评；任何生产试点另行授权。

## 5. 评估集与指标合同

- 评估集版本化、不可静默改写、使用可校验摘要且只含合成或去敏数据。
- 固定holdout不得用于prompt、规则、阈值调优或示例检索；发生泄漏必须新建版本。
- 场景覆盖正例、反例、冲突、重复、缺字段、单位不兼容、客户专用、冻结、行业特殊规格、越界输入和应放弃回答。
- 分类、属性提取、候选匹配、供应商映射建议分别评估和分层报告。
- 指标至少包含逐字段precision/recall/F1、exact match、top-k recall、错误候选率、abstention/coverage、稳定复现率和关键安全违规数。
- 直接正式写入或绕过审核的关键安全违规允许值固定为0。
- 本任务不设拍脑袋准确率阈值；`PHASE4-TASK02`用已标注样本测量后由项目负责人批准。
- 评估运行、失败样本和批准记录必须可复现、可审计。

## 6. 后续五任务路线

| 任务 | 状态 | 范围 |
| --- | --- | --- |
| `PHASE4-TASK01` | DONE | AI治理评估与审批边界；本次完成 |
| `PHASE4-TASK02` | TODO | 版本化去敏评估集、确定性基线和离线Evaluator |
| `PHASE4-TASK03` | TODO | AI Suggestion/Evidence关系化合同及候选层 |
| `PHASE4-TASK04` | TODO | 人工审核API/UI及受控正式提交衔接 |
| `PHASE4-TASK05` | TODO | 非生产试点、发布门禁、漂移监控、停用和回退验收 |

不得从本任务自动开始`PHASE4-TASK02`。

## 7. 明确未执行

- 未调用任何AI模型或外部AI服务。
- 未创建或读取任何模型API Key、Token或新凭据。
- 未读取供应商文件、价格、个人信息、生产正文或数据库业务数据。
- 未登录UAT、未调用业务API、未运行Migration。
- 未修改业务代码、测试代码、`package.json`、Dockerfile、Schema、Migration或部署配置。
- 未build、Docker build、Compose更新、部署或重启服务。
- 未备份、dump、读取Volume、恢复、上传或清理恢复材料。
- 未进行GHCR认证、tag、push或pull；未向public origin推送。

## 8. 验收标准

- [x] D-110唯一且覆盖十二项治理边界。
- [x] AI禁止边界和四角色人工审批矩阵明确。
- [x] 建议追溯与人工决定分离合同明确。
- [x] 版本化去敏评估集、固定holdout和场景覆盖明确。
- [x] 四类能力和最低指标合同明确，关键安全违规允许值为0。
- [x] 具体业务准确率阈值留待TASK02测量和项目负责人批准。
- [x] 模型/prompt/规则/阈值版本、停用、回退和漂移复评边界明确。
- [x] TASK02—TASK05只列为TODO，未自动开始。
- [x] 项目总控、任务台账、上下文、路线图、决定、变更日志和状态同步。
- [x] alpha.42、0040、运行服务和受保护Volume保持不变。

## 9. 验证边界

验证只允许：

- `git diff --check`；
- Markdown本地链接、唯一性、状态一致性和精确变更路径检查；
- 禁止路径与敏感信息只读扫描；
- 既有本地Node镜像在`network none`、源码只读、1 CPU和受限内存下串行执行lint及只读UI合同；
- 测试前后资源、Compose、RestartCount和OOM只读核验。

Git提交消息固定为`docs: define AI governance approval boundaries`。

## 10. 实际验证结果

- 变更路径精确为九份Markdown，`RELEASES.md`、业务代码、测试代码、package、Docker、Schema、Migration和部署配置均未修改；`git diff --check`通过。
- 九份目标文档的53个本地Markdown引用全部解析；D-110标题、任务H1及TASK01—TASK05台账行各自唯一，`DOING`行数为0，五份状态文档含一致最终判定。
- 九份变更文档的私钥、GitHub/OpenAI/AWS Token、JWT及凭据赋值规则扫描命中0；提交前还须对最终增量复扫。
- 既有本地`node:22-bookworm-slim`镜像在`network none`、源码只读、1 CPU、1,280 MiB/Node heap 1,024 MiB限制下执行lint：退出码0、0 error、11条既有warning。
- 同一既有镜像在`network none`、源码只读、1 CPU、768 MiB/Node heap 512 MiB限制下执行只读采购履约UI合同：6/6通过。
- 本任务验证前后available memory约`2.2/2.2 GiB`，Swap`338/343 MiB`，根盘可用`17/17 GiB`，Load`0.01/0.12/0.20`→`0.14/0.14/0.19`；未触发低资源停止阈值。
- 内核OOM匹配0；Web、Worker、PostgreSQL、Caddy均`RestartCount=0`、`OOMKilled=false`并保持running，Web/PostgreSQL healthy。两个Node验证容器均自动删除，四个受保护Volume只核验元数据且全部存在；没有创建或清理其他临时目录、镜像、网络或Volume。

详细结果同步记录在`docs/project/STATUS.md`和`docs/project/CHANGELOG.md`。
