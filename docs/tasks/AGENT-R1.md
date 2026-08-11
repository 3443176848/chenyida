# AGENT-R1 — 晨亿达ERP只读研发控制器

## 任务状态

`DOING / READ_ONLY_CONTROLLER_IMPLEMENTING / NO_RUNTIME_AUTHORITY`

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

## 状态与恢复边界

- `PHASE4-TASK03`保持`BLOCKED / OWNER_PRIORITY_HOLD / SOURCE_READY / HOLDOUT_REVALIDATION_REQUIRED / RELEASE_NOT_AUTHORIZED`，其代码、数据集和运行面不得被本任务读取执行或改写。
- R1只提供观察和失败关闭，不能宣称D-113的OS/容器权限、租约、两阶段状态协议或能力代理已强制实施。
- R1完成后不得自动启动R2或恢复TASK03；下一状态只由项目负责人明确决定。
