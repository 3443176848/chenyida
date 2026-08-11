# AGENT-R1 — 晨亿达ERP只读研发控制器

## 任务状态

`DONE / READ_ONLY_CONTROLLER_COMPLETE / NO_RUNTIME_AUTHORITY`

日期：2026-08-11（Asia/Shanghai）

负责人：Codex（只读控制器、机器可读Task Packet、错误注入/恢复测试、文档与独立提交）、项目负责人（接受D-113、固定owner priority hold及R1只读边界）

依赖：`PM-001`、`D-113`、`AGENTS.md`、`docs/AI_AGENT_TEAM_DESIGN.md`

## 严格起点

- Branch：`main`；HEAD：`fd5bf3f7ab1d710053c88aa460614ec79d77e66b`。
- 唯一worktree：`/opt/erp`；没有嵌套Git仓库。
- 起点工作区只有项目负责人既有未跟踪输入`docs/ERP_CURRENT_STATUS_REPORT.md`；本任务不得读取、修改、删除、暂存或提交该文件。
- public `origin/main`：本地记录behind 0/ahead 200；`recovery-private/main`：本地记录behind 0/ahead 2。本任务不fetch、push或修改远端。
- 源码候选：`0.1.0-alpha.44`；源码Migration：41/head `0041_ai_governance_suggestion_evidence.sql`，SHA-256 `676626b9dcb78f31643612e5662cf5c36e06259c72ff922287bb913394071bf2`。
- 受控非生产UAT基线只继承权威文档声明的alpha.42/0040；本任务不连接UAT验证或刷新该事实。
- 起点资源：available memory约2.3 GiB、Swap 354 MiB/1 GiB、根分区可用17 GiB、Load `0.30/0.19/0.13`；四个既有服务容器均running、restart 0、OOM false。`docker compose ps`因未向当前Shell注入受保护env而失败关闭，本任务不读取该env补跑。

## 已授权范围

1. 在独立控制面路径新增Python标准库只读CLI，不引入运行依赖，不接入Node/Python ERP进程。
2. 新增版本化、机器可读的`AGENT-R1` Task Packet；只包含控制元数据，不包含秘密或业务正文。
3. 只读解析`AGENTS.md`、项目权威Markdown、当前任务文档、D-113、Task Packet、Git元数据、`package.json`、PostgreSQL Migration文件、journal和snapshot。
4. 核对零或唯一DOING、活动任务与Packet一致、D-113已接受、Git基线/路径/工作区漂移、源码版本、Migration连续性/head/checksum/journal/snapshot及文档声明的UAT版本边界。
5. 仅向stdout输出确定性JSON清单；发现分歧时用稳定错误码和非零退出码失败关闭，不修复或写回任何状态。
6. 用临时fixture完成错误注入、崩溃后无状态重跑、只读前后指纹和CLI测试；运行轻量、不联网、不启动数据库或容器。
7. 按项目流程更新治理文档并创建聚焦提交。

## 明确禁止事项

- 不修改`chenyida_erp_site/app/`、`db/schema.ts`、任何Migration、snapshot/journal、`package.json`、Evaluator/holdout、ERP API/UI/Service/Worker、Python/SQLite业务代码或部署配置。
- 不建立Control Store、SQLite active slot、lease、fencing、Policy Engine、Capability Broker、独立Agent身份、worktree代理、命令/秘密代理或后台daemon；这些属于R2/R3。
- 不执行holdout、build、全量Node测试、Migration、备份恢复、Compose重启、部署、发布、Git push或远端同步。
- 不连接或调用UAT/生产的网页、API、数据库、SSH或业务对象；不登录、不读取受保护Volume正文。
- 不读取`shujvbiao/`、真实附件、备份、凭据、Token、Cookie、Session或`docs/ERP_CURRENT_STATUS_REPORT.md`正文。
- 不修改ERP业务逻辑，不恢复`PHASE4-TASK03`，不启动R2—R5、TASK04或TASK05。
- 控制器运行时不得创建缓存、日志、报告文件、数据库、锁文件或临时文件；唯一输出通道是stdout/stderr。

## 验收标准

- 正常fixture与仓库实况均生成版本化JSON清单，列出Git、任务、必读文档、版本、Migration和路径漂移结论；输出不含秘密或业务正文。
- 零DOING返回可审计`IDLE`；唯一DOING且Packet一致返回`READY`；多个DOING、缺Packet、任务/状态不一致返回`STATE_RECONCILIATION_REQUIRED`。
- D-113未接受、必读文件缺失/是symlink、Packet非法或越界、Git基线非祖先、未授权路径变化、版本或Migration漂移均稳定失败关闭。
- 迁移检查至少覆盖编号连续/唯一、head文件名与SHA-256、对应snapshot及journal最后tag；不执行SQL。
- 控制器只调用明确白名单的只读Git子命令，并设置`GIT_OPTIONAL_LOCKS=0`；不调用shell、不访问网络或数据库。
- 测试覆盖成功、IDLE、双DOING、缺文件、D-113状态、路径漂移、版本漂移、Migration缺口/checksum/journal/snapshot漂移、symlink、Git失败、损坏Packet及重复运行恢复。
- 对测试fixture和仓库实况执行前后文件指纹一致性检查；控制器重复运行输出与退出码一致，不遗留临时资源。
- `git diff --check`、敏感信息扫描及适用的轻量Python测试通过；未验证范围和资源结果如实记录。

## 实现结果

- 状态与任务切换提交：`d6bb223bd9381184d50ee8ac65c2a71d5033a58b`（`docs: start read-only ERP agent controller`）。
- 控制器实现提交：`903e2108bf71a1b4488a6b9d69da0e10aae07880`（`feat: add read-only ERP agent controller`）。实现位于`tools/erp_agent_control/readonly_controller.py`，Task Packet位于`docs/agent-control/task-packets/AGENT-R1.json`；没有把控制器接入任何ERP进程。
- CLI使用Python标准库，只调用固定白名单的只读Git命令并设置`GIT_OPTIONAL_LOCKS=0`；固定检查治理文档、任务状态、允许路径、Git祖先/分支/worktree、源码版本及Migration编号、head、checksum、snapshot和journal。所有结果只写stdout JSON，退出码`0`表示`READY/IDLE`、`2`表示`STATE_RECONCILIATION_REQUIRED`。
- 文件读取拒绝缺失、不可读、非UTF-8、超限、symlink和hardlink；Packet拒绝重复键、未知字段、路径穿越、任务文档遗漏和把检查目标重定向到项目负责人输入。Git失败只返回稳定去敏错误，不回显命令环境或敏感正文。
- 当前仓库在`AGENT-R1`为唯一DOING时返回`READY`且errors为空；同一实况连续运行两次输出逐字节一致，运行前后Git状态不变。台账收口为零DOING后返回`IDLE`，不会加载历史完成Packet或自动启动R2/TASK03。
- 台账中有8个历史任务存在状态一致的重复终态行，控制器以`TASK_LEDGER_DUPLICATE_ROWS`告警但不改写历史；重复active/nonterminal或冲突状态仍失败关闭。该既有治理债不在R1授权范围内。

## 验证与资源

- 专项测试：`python3 -B -m unittest discover -s tools/erp_agent_control/tests -p 'test_*.py' -v`，24/24通过；覆盖正常、IDLE、双DOING、D-113/核心文档/Packet/Git/路径/版本/Migration漂移、symlink/hardlink、损坏Packet恢复、确定性及零文件变化。
- 静态边界：控制器不导入网络或数据库客户端，不使用shell、临时文件或文件写API；唯一`subprocess.run`封装在只读Git适配器。增量敏感信息扫描和`git diff --check`通过。
- 本地Python基线：`server.py --self-test`为`SELF_TEST_OK`，`.venv` smoke为`SMOKE_TEST_OK`；`go_live_check.py --host 127.0.0.1 --port 18889 --require-running --no-backup`为`GO_LIVE_CHECK_OK`。最后一项只检查既有本地开发服务和SQLite，不连接UAT/生产且显式禁用备份。
- 资源起点/收口：available memory约`2.3/2.3 GiB`，Swap`354/354 MiB`，根盘可用`17/17 GiB`，Load`0.30/0.19/0.13`→`0.03/0.11/0.09`；任务窗口内核OOM匹配0，四个既有容器均running、restart0/OOM false。`docker compose ps`仍因当前Shell没有受保护env而失败关闭，没有读取env补跑。
- 临时fixture由测试自动清理，控制器目录无`__pycache__`或`.pyc`；没有创建数据库、容器、镜像、Volume、报告/日志/锁文件，也未执行prune。项目负责人既有未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`保持不读、不改、不提交。
- 未执行UAT/生产网页、API、SSH或数据库连接，未运行holdout、Migration、Node全量测试、build、Compose变更、部署、备份恢复、重启、外部AI、Git push，未修改ERP业务逻辑、Schema/Migration、package或部署配置。

## 状态与恢复边界

- `PHASE4-TASK03`保持`BLOCKED / OWNER_PRIORITY_HOLD / SOURCE_READY / HOLDOUT_REVALIDATION_REQUIRED / RELEASE_NOT_AUTHORIZED`，其代码、数据集和运行面不得被本任务读取执行或改写。
- R1只提供观察和失败关闭，不能宣称D-113的OS/容器权限、租约、两阶段状态协议或能力代理已强制实施。
- R1完成后不得自动启动R2或恢复TASK03；下一状态只由项目负责人明确决定。
