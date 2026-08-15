# SELFHOST-UAT-WRITER-QUIESCE-72 UAT晋升writer持续停写回执适配器

> 状态：`DOING / REPOSITORY CONTINUED-QUIESCENCE ADAPTER / RESOURCE STOP LINE ACTIVE / NO REAL CONTAINER OR DATABASE ACTION / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@bc339b6b1533acdd1123cebea818bc3302332440` / tree `f7fd37bd3a79d9f99ecbfc7b3151e13291710c7c`
> 责任：Codex主智能体唯一写入、轻量测试串行、证据集成和Git提交；项目负责人保留真实writer停止/启动、备份/异机恢复、数据库、凭据、host、UAT/生产及部署专项授权

## 1. 背景与目标

TASK71/D-146已关闭checkpoint 5：promotion事务可用独立一次性授权接受本窗口新产生、内容寻址、root-published的V4 actual-offhost四域恢复证据。实际backup入口要求精确Web/Worker在采集前后均已停止，且不会替operator重启writer。

下一P0为checkpoint 6 `WRITER_QUIESCE_RECEIPT`。本任务只在仓库和fake-root中实现受控证明：同一promotion的checkpoint 5之后，精确Web/Worker仍保持停止、没有替代writer，容器/Compose/runtime/数据库身份未跨绑，并由新的短时一次性授权接续停写责任。它不实际停止、启动或修改当前UAT容器。

## 2. 验收标准

- [ ] 完整核对Compose、backup、release runtime和Migration入口如何识别Web/Worker、项目、容器替换、停止状态及替代writer；记录“持续停写”可证明与不可证明边界。
- [ ] `QUIESCE_UAT_WRITERS`使用新的短时一次性Supervisor授权，精确绑定当前ordinal-5回执、promotion intent、snapshot binding、candidate/database/runtime、Compose project/deployment、Web/Worker身份、三方actor和时间窗；授权消费前持久化quiesce intent。
- [ ] adapter只接受checkpoint 5已证明采集时writer停止且当前同一Web/Worker仍停止、没有同project替代writer或未知业务writer的输入；running/restarted/replaced/跨project/跨promotion/跨数据库或调用者自报状态均失败关闭。
- [ ] checkpoint 6回执写入非零`writer_quiesce_binding_sha256`并绑定快照后连续停止区间、容器/镜像/runtime身份和检查时间；history/receipt/current按前代原子发布，不得停止真实容器、覆盖证据或跳步。
- [ ] 崩溃恢复使用新授权绑定原已消费授权与quiesce intent；可证明partial收敛，未知或不一致状态保全并quarantine，不自动启动/停止容器或删除证据。
- [ ] fake-root、断网、无Docker daemon/无数据库测试覆盖正向重放、running/restart/replacement、额外writer、source替换、hardlink/symlink、授权消费边界、各发布崩溃点和quarantine；测试adapter不得进入生产路径。
- [ ] 机器审计只有在真实执行路径和负向门完整时把`WRITER_QUIESCE_RECEIPT`转为SUPPORTED；Migration及以后adapter继续NOT_IMPLEMENTED，`assert-ready`仍拒绝。
- [ ] 更新MASTER、TASKS、PROJECT_CONTEXT、CHANGELOG、STATUS、DECISIONS和投产授权包；通过适用测试、资源/敏感/diff检查，形成独立source→manifest提交链并自动进入下一未阻塞任务。

## 3. 禁止事项

- 不执行`docker stop/start/restart`或Compose up/down/stop，不连接UAT/生产数据库，不读取业务行、日志、`.env`、备份、外部对象或Volume正文。
- 不运行backup、restore、Migration、build、镜像、部署、回滚或业务API写；不修改账号、凭据、systemd、网络、Swap、Docker daemon或持久卷。
- 不把checkpoint 5中的历史“采集时已停止”描述为当前持续停写，不接受operator手填、容器名、exit code或单次`running=false`作为完整quiesce证据。

## 4. 起点与当前判定

- TASK71 source`e8dea20`→monitor`7c645ab`→Supervisor`bc339b6`形成30/128文件canonical链；audit现为7项SUPPORTED、8项阻断（P0=7、P1=1），三个必需Supervisor操作已实现且`assert-ready`继续拒绝。
- 当前运行UAT仍为alpha.42/0040且四服务running、restart0/OOM false；本任务没有真实停写授权，也不得因实现operation而调用它。
- available约1.9GiB、Swap868MiB/1GiB、根盘13GiB、Load低；Swap超过80%，只允许仓库静态、Python和受限Node轻量验证。TASK70继续`BLOCKED / RESOURCE STOP LINE + EXECUTOR DEPENDENCIES`。
