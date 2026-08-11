# AGENT-R1-5 — Native-Orchestrated Design MVP

## 任务状态

`DONE / NATIVE_PROTOCOL_MVP_COMPLETE / SYNTHETIC_DOCS_TEST_ONLY / NO_RUNTIME_AUTHORITY`

日期：2026-08-11（Asia/Shanghai）

负责人：Codex主Agent（唯一实施写者、编排与收口）、临时原生Agent（ERP合同、安全、对抗、QA及黑盒只读验证）、项目负责人（接受D-114并授权R1.5限定范围）

依赖：`PM-001`、`PM-002`、`D-113`、`D-114`、`AGENT-R1`、`AGENTS.md`及`docs/ai-engineering/`

## 项目负责人授权

项目负责人于2026-08-11明确：

> 接受 D-114。创建并启动 AGENT-R1-5，按 R1.5 Native-Orchestrated Design MVP 实施；仅使用合成 docs/test 试点，不修改 ERP 业务、Schema/Migration，不访问 UAT/生产，不部署，并继续冻结 PHASE4-TASK03。

该授权允许实现研发控制协议及合成验证，不授予ERP业务、数据库、网络、UAT、部署、生产、远端Git或R2能力。

## 严格起点

- Branch：`main`；HEAD：`4dd4abea02fe876665c8721e57d81f300da94c0a`；Parent：`2c8f8b2e224e4a9b0a2ec9e01a5998898ff95aaf`。
- 唯一worktree：`/opt/erp`；无嵌套Git仓库或submodule。
- 工作区只有项目负责人既有未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`；本任务不得读取、修改、删除、暂存或提交该文件。
- public本地跟踪差异为behind 0/ahead 204；本任务不fetch、push、改remote/upstream或访问远端。
- 源码候选仍为`0.1.0-alpha.44`；源码Migration仍为41/head `0041_ai_governance_suggestion_evidence.sql`，SHA-256为`676626b9dcb78f31643612e5662cf5c36e06259c72ff922287bb913394071bf2`。
- UAT只继承权威文档声明的alpha.42/0040；不连接、登录、调用或刷新运行事实。
- 起点资源：available memory约2.2 GiB、Swap 354 MiB/1 GiB、根分区可用17 GiB、Load `0.07/0.16/0.24`；四个既有服务running、restart0、OOM false，内核OOM匹配0。
- `COMPOSE_PARALLEL_LIMIT=1 docker compose -f chenyida_erp_site/compose.yml ps`因当前Shell没有`DATABASE_URL`而失败关闭；不读取env或重试连接运行面。

## 目标交付

1. 新增`chenyida-erp-agent-task/v2`、`erp-agent-message/v1`和`erp-agent-context/v1`三份版本化JSON Schema。
2. 扩展R1只读控制器兼容v1/v2 Task Packet；v2必须验证D-113与D-114、单写者、角色分离、能力上限、禁止能力和低资源预算。
3. 新增Python标准库无状态协议验证CLI，只读取明确传入的本地合成bundle并向stdout输出确定性JSON，不写控制状态、不联网、不连接数据库。
4. 建立合成docs/test试点：candidate v1失败、candidate v2修复，覆盖ERP/对抗/安全/QA拒绝后重新签核、旧候选签核失效及Minority Report处置。
5. 建立角色专属Context Manifest及摘要校验；实现者与ERP/对抗/安全/QA/Black-box身份和Context不得复用。
6. 建立只包含公开合成接口/Persona/预期的黑盒fixture；用断网单容器只挂载该fixture运行，不挂载仓库源码或`.git`。
7. 覆盖缺字段、未知字段、错误SHA/digest、过期revision、重复消息、越权角色/能力、Reviewer写入、黑盒看到source、旧签核复用、未处置Minority Report、旧lease、`RESULT_UNKNOWN`重放等失败关闭测试。
8. 使用Codex原生临时Agent对冻结实现commit执行ERP合同、安全、对抗、独立QA和源盲黑盒复核；Agent只读、不得修复候选，输出结构化结论。
9. 运行R1前后巡检、专项测试、Markdown/链接/范围/敏感信息及低资源基线；更新项目治理文档并创建聚焦提交。

## 允许修改路径

- `tools/erp_agent_control/**`
- `docs/agent-control/**`
- `docs/ai-engineering/**`
- `docs/tasks/AGENT-R1-5.md`
- `docs/AI_AGENT_TEAM_DESIGN.md`
- `docs/project/MASTER.md`
- `docs/project/TASKS.md`
- `docs/project/PROJECT_CONTEXT.md`
- `docs/project/ROADMAP.md`
- `docs/project/DECISIONS.md`
- `docs/project/STATUS.md`
- `docs/project/CHANGELOG.md`

除上述路径外全部拒绝。主Agent是唯一仓库写者；临时Agent只能读取冻结commit并给出消息，不能直接修改文件。

## 明确禁止事项

- 不修改`chenyida_erp_site/`、`chenyida_erp_app/`中的ERP业务/测试代码、Schema、Migration、snapshot/journal、API/Service/UI/Worker、package、版本或部署配置。
- 不创建Control Store、数据库、daemon、后台调度器、消息队列、Unix/容器身份、真实lease/Capability Broker、秘密代理或R2/R3运行时。
- 不执行holdout、模型调用、真实数据读取、业务导入、Migration、build、备份恢复、Compose restart、部署、发布或切流。
- 不连接UAT/生产网页、API、SSH、数据库或业务对象；不登录，不读取protected volume正文、真实附件、日志、备份或凭据。
- 不fetch/push，不创建PR，不修改Git远端/历史，不读取项目负责人未跟踪文档正文。
- 不恢复`PHASE4-TASK03`，不启动R2—R5、TASK04或TASK05。
- 不把D-112五张产品`ai_governance_suggestion_*`表用于研发Agent消息、上下文、证据或状态。

## 角色与独立门禁

| 身份 | 当前任务职责 | 写权限 |
| --- | --- | --- |
| `builder-r1-5` | 协议、验证器、fixture和测试的唯一实施者 | 仅允许路径 |
| `erp-guardian-r1-5` | ERP运行面、产品AI边界和任务范围复核 | 无 |
| `adversarial-r1-5` | 主动寻找失败关闭、状态/摘要/候选失效漏洞 | 无 |
| `security-r1-5` | 路径、symlink/hardlink、数据、网络、命令和越权复核 | 无 |
| `qa-r1-5` | 独立选择并执行适用测试，核对原始结果 | 无产品写权 |
| `blackbox-r1-5` | 只接收公开合成接口与隔离执行观察，验证Persona结果 | 无source/Git/写权 |

ERP、安全、QA和黑盒任一必需门禁未通过时不得收口；对抗Minority Report必须有证据化处置。主Agent不能代签这些结论。

## 验收标准

- R1在任务DOING时对活动Packet返回`READY`，完成后在零DOING返回`IDLE`；errors为空且不自动认领下一任务。
- 三份Schema为严格对象、拒绝未知字段，手写标准库验证器与Schema语义一致；不引入依赖。
- 有效合成bundle重复运行输出逐字节一致，CLI和库调用前后仓库/fixture无变化。
- 所有角色绑定唯一Agent、Manifest摘要、Task revision与candidate；只有唯一Builder允许非空`changes`。
- 最终ERP/Security/QA/Black-box签核全部绑定最新candidate；旧candidate PASS不得复用。
- Reviewer失败、Security veto、QA失败、Minority Report、checkpoint恢复和`RESULT_UNKNOWN`均有成功及反例测试。
- 黑盒容器断网，只挂载合成blackbox目录且不含`.git`或产品源码；Persona数量按合成任务动态决定。
- 专项测试、R1回归、Python基线、适用Node最小测试/lint、Markdown链接、敏感/范围/checksum和`git diff --check`通过；不得降低断言或skip失败。
- 资源检查无阈值突破，临时容器/目录清理，四个受保护Volume不变；未执行任何禁止事项。
- 完成后同步MASTER/TASKS/CHANGELOG/STATUS，D-114记录实施结果，创建独立commit并回到零DOING；R2与TASK03继续不自动启动。

## 当前非承诺能力

R1.5验证的是Git内协议、原生Agent职责分离和合成隔离流程。它不提供OS级Agent身份、强制路径租约、秘密代理、持久Control Store、后台持续调度或生产拒绝机制；这些仍属于未授权R2。任何只能由Prompt维持的边界必须在完成报告中如实标注，不能宣称已技术强制。

## 完成结果

- 2026-08-11完成R1.5限定MVP。交付`chenyida-erp-agent-task/v2`、`erp-agent-message/v1`、`erp-agent-context/v1`三份严格Schema，R1 v1/v2只读巡检，Python标准库无状态验证CLI，以及仅含合成合同、候选、故障恢复、Minority Report和公开黑盒Persona的试点包。
- 最终实现候选固定为`25cbbfab87925a8601b844fe59c634ae0b651297`；从任务协议起点`1f55696b124c899d49f4505c9ad0cd238d910b24`到该候选恰好20条允许路径，均在`docs/agent-control/**`、`docs/ai-engineering/**`或`tools/erp_agent_control/**`，没有ERP产品、产品测试、Schema/Migration或部署路径。历次修复均为独立聚焦提交，最终审查证据提交为`ace4dc5`。
- ERP合同、安全、对抗、QA和全新源码盲审Black-box五道门禁全部对同一candidate、Task Packet revision 2、lease generation 1及各自Context Manifest摘要给出`PASS`。最终五份Message均通过最终Schema，输入locator与Evidence逐项相等，全部Context Manifest canonical digest及声明工件摘要匹配，26个历史/最终Message ID无重复。
- 历史审查收据保持不可变；其中旧候选`security-r1-5-2843b3d.json`按设计被最终条件Schema拒绝，不以篡改历史收据制造兼容。最终接受集和历史边界记录于[审查证据说明](../agent-control/reviews/AGENT-R1-5/README.md)。
- 协议专项87/87、只读控制器专项47/47，共134项通过；有效合成bundle由validator `0.5.4`连续运行两次，stdout逐字节一致，SHA-256为`f9923bb07c39e0bf3d62fb1383b200551429a7a7678d3b33bbf0c6339dc235d2`。R1在任务DOING时返回`READY`且errors为空；收口后必须返回`IDLE`且不得自动启动下一任务。
- 本地Python基线`server.py --self-test`、`smoke_test.py`及`go_live_check.py --host 127.0.0.1 --port 18889 --require-running --no-backup`分别返回`SELF_TEST_OK`、`SMOKE_TEST_OK`、`GO_LIVE_CHECK_OK`。它们只验证既有本地开发基线；未连接UAT/生产且未创建备份。
- 黑盒只使用公开合成interface、四个按风险派生的Persona及观察报告。第一次容器以UID 65534读取root-owned mode-0600 fixture时在执行前失败关闭；第二次在只读rootfs、network none、cap-drop ALL、no-new-privileges、单一只读fixture挂载、256 MiB、1 CPU、64 PID限制下通过。两次均无OOM，`docker diff`只见`/fixture`挂载，两个精确容器均已删除；全新Blind-box Agent随后只读三份公开工件并独立PASS。
- 起点/最终available memory约`2.2/2.2 GiB`、Swap`354/357 MiB`（总计1 GiB）、根盘可用`17/17 GiB`、Load`0.07/0.16/0.24`→`0.05/0.13/0.20`。任务窗口内核OOM匹配0，四个既有运行容器restart0/OOM false，四个受保护Volume保持；Compose状态检查因必需环境值缺失而失败关闭，未读取env或重试。临时黑盒容器和五个任务期Python缓存文件已精确清理，未创建测试数据库、镜像或Volume，未执行prune。
- 没有修改`chenyida_erp_site/`或`chenyida_erp_app/`业务/测试、产品Schema/Migration、package、版本和部署配置；没有执行holdout、模型、网络、UAT/生产、业务数据库、build、Migration、备份恢复、Compose变更、部署、远端Git或push。项目负责人既有未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`保持不读、不改、不暂存、不提交。
- 完成后项目回到零DOING/`IDLE`。`PHASE4-TASK03`继续`BLOCKED / OWNER_PRIORITY_HOLD / SOURCE_READY / HOLDOUT_REVALIDATION_REQUIRED / RELEASE_NOT_AUTHORIZED`；R2—R5、OS/容器身份、Control Store、强制lease/fencing、Capability Broker、daemon、UAT和生产能力均未实施或授权。
