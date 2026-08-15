# SELFHOST-UAT-WRITER-QUIESCE-72 UAT晋升writer持续停写回执适配器

> 状态：`DONE / REPOSITORY CONTINUED-QUIESCENCE ADAPTER VERIFIED / EXACT COMPOSE WRITERS ONLY / EXTERNAL DATABASE CLIENTS DEFERRED TO MIGRATION FENCE / NO REAL CONTAINER OR DATABASE ACTION / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@bc339b6b1533acdd1123cebea818bc3302332440` / tree `f7fd37bd3a79d9f99ecbfc7b3151e13291710c7c`
> 责任：Codex主智能体唯一写入、轻量测试串行、证据集成和Git提交；项目负责人保留真实writer停止/启动、备份/异机恢复、数据库、凭据、host、UAT/生产及部署专项授权

## 1. 背景与目标

TASK71/D-146已关闭checkpoint 5：promotion事务可用独立一次性授权接受本窗口新产生、内容寻址、root-published的V4 actual-offhost四域恢复证据。实际backup入口要求精确Web/Worker在采集前后均已停止，且不会替operator重启writer。

下一P0为checkpoint 6 `WRITER_QUIESCE_RECEIPT`。本任务只在仓库和fake-root中实现受控证明：同一promotion的checkpoint 5之后，精确Web/Worker仍保持停止、没有替代writer，容器/Compose/runtime/数据库身份未跨绑，并由新的短时一次性授权接续停写责任。它不实际停止、启动或修改当前UAT容器。

## 2. 验收标准

- [x] 完整核对Compose、backup、release runtime和Migration入口如何识别Web/Worker、项目、容器替换、停止状态及替代writer；记录“持续停写”可证明与不可证明边界。
- [x] `QUIESCE_UAT_WRITERS`使用新的短时一次性Supervisor授权，精确绑定当前ordinal-5回执、promotion intent、snapshot binding、candidate/database/runtime、Compose project/deployment、Web/Worker身份、三方actor和时间窗；授权消费前持久化quiesce intent。
- [x] adapter只接受checkpoint 5已证明采集时writer停止且当前同一Web/Worker仍停止、没有同project替代writer的输入；running/restarted/replaced/额外同project writer、跨project/跨promotion/跨数据库或调用者自报状态均失败关闭。未标注容器和外部数据库客户端明确不在本检查点证明范围，并转交Migration数据库围栏。
- [x] checkpoint 6回执写入非零`writer_quiesce_binding_sha256`并绑定快照后连续停止区间、容器/镜像/runtime身份和检查时间；history/receipt/current按前代原子发布，不得停止真实容器、覆盖证据或跳步。
- [x] 崩溃恢复使用新授权绑定原已消费授权与quiesce intent；可证明partial收敛，未知或不一致状态保全并quarantine，不自动启动/停止容器或删除证据。
- [x] fake-root、断网、无数据库测试覆盖正向重放、running/restart/replacement、额外writer、source替换、hardlink/symlink、授权消费边界、各发布崩溃点和quarantine；测试adapter不得进入生产路径。精确Docker Go template另以当前daemon只读metadata验证语法，不执行容器动作。
- [x] 机器审计在真实生产路径和负向门完整后把`WRITER_QUIESCE_RECEIPT`转为SUPPORTED；Migration及以后adapter继续NOT_IMPLEMENTED，`assert-ready`仍拒绝。
- [x] 更新MASTER、TASKS、PROJECT_CONTEXT、CHANGELOG、STATUS、DECISIONS和投产授权包；通过适用测试、资源/敏感/diff检查，形成独立source→manifest提交链并自动进入下一未阻塞任务。

## 3. 禁止事项

- 不执行`docker stop/start/restart`或Compose up/down/stop，不连接UAT/生产数据库，不读取业务行、日志、`.env`、备份、外部对象或Volume正文。
- 不运行backup、restore、Migration、build、镜像、部署、回滚或业务API写；不修改账号、凭据、systemd、网络、Swap、Docker daemon或持久卷。
- 不把checkpoint 5中的历史“采集时已停止”描述为当前持续停写，不接受operator手填、容器名、exit code或单次`running=false`作为完整quiesce证据。

## 4. 起点与当前判定

- TASK71 source`e8dea20`→monitor`7c645ab`→Supervisor`bc339b6`形成30/128文件canonical链；audit现为7项SUPPORTED、8项阻断（P0=7、P1=1），三个必需Supervisor操作已实现且`assert-ready`继续拒绝。
- 当前运行UAT仍为alpha.42/0040且四服务running、restart0/OOM false；本任务没有真实停写授权，也不得因实现operation而调用它。
- available约1.9GiB、Swap868MiB/1GiB、根盘13GiB、Load低；Swap超过80%，只允许仓库静态、Python和受限Node轻量验证。TASK70继续`BLOCKED / RESOURCE STOP LINE + EXECUTOR DEPENDENCIES`。

## 5. 实施与证据

- `uat-promotion-transaction-policy-v1.json`增加`QUIESCE_UAT_WRITERS`授权和checkpoint 6约束；raw/canonical SHA-256为`162d86b3…c00f`/`f89b377c…f280`。
- promotion journal增加quiesce intent、固定Docker binary与无shell metadata probe、原Web/Worker持续停止区间、同project替代writer拒绝、非零binding、三个发布故障点及保全式恢复/quarantine。生产probe只读Docker metadata，不调用stop/start/restart；test validator只允许显式非`/`fake root。
- Supervisor v6新增`QUIESCE_UAT_WRITERS`及精确确认文本，授权在prepare前、消费前和消费后重验同一source，恢复绑定原已消费授权与intent；launcher SHA-256为`2a69aaf1…121f`。
- 机器审计现为8项SUPPORTED、7项阻断（P0=6、P1=1），4/7必需Supervisor操作实现；artifact self SHA-256为`7085cd75…3fc`，`assert-ready`仍精确返回`UAT_PROMOTION_EXECUTOR_NOT_READY`。跨岗artifact self SHA-256为`7e07b627…7f94`。

## 6. 验证结果

- 受限、断网、只读Node：事务/跨岗/release/audit合计62/62；其中journal 16/16覆盖正向、重放、running、restart、replacement、extra writer、跨绑定、source replacement、三处崩溃恢复、hardlink/symlink和quarantine。
- Python Supervisor：112/112；monitor manifest 31/31；Supervisor manifest专项40/40；release inventory 257 total / 233 required / 24 N/A。
- cross-role和promotion audit生成物逐字节重放通过；`assert-ready`按预期失败关闭。Python compile、Node syntax和精确Docker Go template只读语法验证通过。
- 资源停止线下未运行build、全量Node/PostgreSQL、Docker数据库、typecheck、Migration、镜像或Compose动作；这些动态验证没有被静态结果替代。

## 7. 不可变提交链

- source：`8ab249e7d265112a6130e4ffd26e278f4c6e4aed` / tree `af751336d53f7e5eb9f18c4833147f7cee1da70e`。
- monitor manifest-only：`55c1b91be010e045af485fa045bd83ea712941ff` / tree `2f5005c07532bd48b0aa08ec068c31e81a3ffed8`；30文件manifest SHA-256 `c369bc16…70eb`。
- Supervisor manifest-only：`ad98661b78e5f9fb989a7d56d78992c24592b27d` / tree `8912ce1005ebd22982fc65e0a1169ed68c4769a1`；128文件manifest SHA-256 `4704aad8…ab5`。

## 8. 收口判定

`DONE`只表示仓库和fake-root中的精确Compose writer持续静默检查点已闭合。当前四个UAT容器仍按原状态运行，未实际停写；未标注容器、其他主机或任意数据库客户端仍可能写入，必须由TASK73的一次性Migration数据库连接围栏证明。真实备份、Migration、部署、回滚、A1—A8和生产均未授权，系统继续`PRODUCTION NO-GO`。
