# 能力与隔离模型

## 1. 默认拒绝

权限不是角色描述中的自然语言承诺，而是未来Capability Broker针对单个`task_id + agent_id + candidate_sha + action + target + expiry + max_uses`发放的短时能力。当前Broker尚未实现；在此之前只能依靠仓库规则、独立worktree、命令审查和人工授权，不能宣称技术强制已完成。

## 2. 基础能力等级

| 等级 | 能力 | 边界 |
| --- | --- | --- |
| `READ_ONLY` | 读取Task Packet允许的仓库文件、Git对象和去敏证据 | 不读取秘密、真实业务正文、protected volume正文或未授权用户文件 |
| `WORKTREE_WRITE` | 在唯一任务worktree及允许路径使用补丁修改 | 不写共享main、其他worktree、运行数据或未列路径 |
| `TEST_EXECUTION` | 执行白名单静态检查和不写生产数据的测试 | 命令、cwd、CPU/RAM/时间、网络与临时路径均受限 |
| `DATABASE_TEST` | 连接任务专属临时数据库并执行批准的Migration/测试 | 目标必须通过环境身份和DB名双重校验；禁止UAT/生产URL |
| `GIT_COMMIT` | 在任务branch创建非签名候选或收口commit | 不push、不改历史、不强推；只能暂存允许路径 |
| `GIT_PUSH` | 将固定branch/SHA普通fast-forward推到固定private remote | 独立人工授权、一次性、禁止public origin与force |
| `DEPLOY` | 对固定非生产环境执行固定artifact部署动作 | 与build/Migration/UAT写分开授权，必须有回滚点 |
| `PRODUCTION_ACCESS` | 对精确生产对象执行精确只读或写动作 | 默认永久拒绝；每次需负责人明确授权、双人/审计和短时凭据 |

`PRODUCTION_ACCESS`不是最高等级通配符；它不能隐含Git、部署、数据库写或业务操作。每种动作必须单独声明。

## 3. 七维权限矩阵

符号：`R`只读，`W*`限租约路径，`X*`限白名单命令，`T`仅隔离测试，`A`逐动作人工授权，`—`拒绝。

| 角色 | READ | WRITE | EXECUTE | DATABASE | NETWORK | GIT | DEPLOY |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Delivery Conductor | R | 控制消息 | 只读巡检 | — | — | 只读 | — |
| Change Builder | R | W* | X* | T（任务需要时） | 默认—；依赖取证另授权 | 候选commit可授权 | — |
| ERP Contract Guardian | R | — | 只读检查 | 只读测试快照（需要时） | — | 只读 | — |
| Adversarial Examiner | R | — | X*只读/负测 | T（只读或回滚夹具） | — | 只读 | — |
| Security Boundary Examiner | R | — | X*安全测试 | T | 默认—；明确外部边界测试时A | 只读 | — |
| Independent Verifier | R | — | X* | T | 默认— | 只读 | — |
| Workflow Simulation Director/Persona | 仅接口合同 | — | 黑盒夹具 | T且无schema权限 | 仅loopback沙箱 | — | — |
| 动态专家 | R | 默认— | 默认只读；按任务X* | 默认—；DB专家可T | 默认— | 只读 | — |
| Ledger Closer | R | 仅治理文档W* | Markdown/状态检查 | — | — | 收口commit可授权 | — |
| Release/SRE候选角色 | R | — | 固定runbook | A | A | push A | A |

任何角色的实际能力是矩阵与Task Packet的**交集**，而不是并集。

## 4. 写入所有权

1. 每个工作项只能有一个`product_writer_agent_id`。
2. 路径租约至少覆盖文件和领域；`db/schema.ts`、`drizzle-postgres/`、Migration journal和同一Service不得被不同Agent并行写。
3. Schema任务若拆出数据库实施者，主实施者失去Migration路径写权，两者通过冻结合同交接；不得出现两个Migration作者。
4. Reviewer/Security/QA/Black-box发现问题后只发消息，不修改候选。候选修复必须回到当前写者或显式撤销旧租约后换写者。
5. 文档收口是独立写阶段，只有候选门禁通过后才发放治理文档路径租约。

## 5. Git隔离

- 实施：`codex/<task-id>-implementation`独立branch/worktree，基于Task Packet固定base。
- 审查：冻结candidate commit的只读快照；不读取实施者未提交工作区。
- QA：从candidate SHA创建干净临时worktree或只读容器挂载；验证工具输出写入任务临时目录。
- Black-box：从预构建artifact或loopback接口测试，不挂载`.git`和源码。
- 集成：门禁通过后由单独集成动作fast-forward或明确merge；禁止Agent自行强推或改写共享历史。

现阶段MVP可以顺序模拟这些边界，但只有R2的真实身份、租约和命令代理完成负测后，才能宣称隔离被技术强制。

R1.5已把上述模拟边界固化为Task Packet v2、严格Message/Context Schema和无状态验证器：唯一`CHANGE_BUILDER`可以报告非空`changes`，ERP/对抗/安全/QA/Black-box必须为空；Packet同时把网络、数据库、UAT、生产、push、deploy、模型调用和daemon列为禁止能力。这是协议拒绝和试点证据，不是R2 Capability Broker或OS身份强制。

## 6. 数据库、网络和秘密

- 数据库连接默认拒绝。`DATABASE_TEST`只能由控制器创建的临时库身份访问，连接串不得来自产品/UAT/生产配置。
- 测试脚本必须检查目标环境并拒绝生产URL；结束后只清理由本任务创建且精确命名的资源。
- 网络默认关闭。文档、代码和本地测试不因“需要资料”自动获得互联网；依赖下载、外部API、Git远端、UAT或模型调用分开授权。
- 秘密由未来Broker按命令注入进程，不进入Prompt、消息、日志、Git或长期状态；Agent只看到能力是否成功，不看到可复用值。
- 真实客户/供应商/价格/生产正文、备份、日志和protected volumes不能进入模型上下文。需要验证时优先合成fixture或去敏摘要。

## 7. 部署与生产

`GIT_PUSH`、`DEPLOY`、UAT业务写、UAT Migration、`PRODUCTION_ACCESS`是互不蕴含的五个授权面。任何一个通过都不授权其他四个。生产变更至少要求：固定artifact digest、恢复点、精确对象、执行者、观察者、时间窗、回滚条件和审计编号；多Agent共识不能替代项目负责人明确授权。
