# SELFHOST-UAT-MIGRATION-TRANSACTION-73 UAT晋升一次性Migration事务适配器

> 状态：`DOING / REPOSITORY MIGRATION AUTHORIZATION AND COMMIT RECEIPT / RESOURCE STOP LINE ACTIVE / NO REAL DATABASE OR UAT ACTION / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@ad98661b78e5f9fb989a7d56d78992c24592b27d` / tree `8912ce1005ebd22982fc65e0a1169ed68c4769a1`
> 责任：Codex主智能体唯一写入、轻量测试串行、证据集成和Git提交；项目负责人保留真实数据库连接/围栏、Migration、凭据、host、UAT/生产及部署专项授权

## 1. 背景与目标

TASK72/D-147只证明同一Compose project/working directory内的精确Web/Worker自promotion snapshot后持续停止；它明确不能证明未标注容器、其他主机或数据库客户端没有写入。当前`release-migration-authorization.ts`虽绑定ELIGIBLE manifest和数据库身份，但仍依赖可重复环境变量；`migrate-postgres.ts`逐文件事务和最终核对存在，却没有promotion-bound一次性消费、数据库连接围栏、不可覆盖提交回执或partial恢复。

本任务关闭checkpoint 7 `ONE_TIME_MIGRATION_AUTHORIZATION`与checkpoint 8 `MIGRATION_COMMIT_RECEIPT`的仓库适配器。只在源码、fake-root和可注入数据库客户端中建立一次性授权、迁移intent、精确数据库围栏证明、migration执行结果与保全式恢复；不连接或修改当前UAT/生产数据库，不运行真实Migration。TASK70保留未来隔离PostgreSQL动态验收。

## 2. 验收标准

- [ ] 完整核对Migration runtime、release authorization、角色/secret、`schema_migrations`、数据库CONNECT/read-only围栏、journal与release gate依赖；固定可证明边界和恢复责任。
- [ ] `RUN_UAT_PROMOTION_MIGRATION`使用新的短时一次性Supervisor授权，精确绑定ordinal-6回执、promotion/quiesce binding、ELIGIBLE manifest、candidate/runtime、数据库稳定身份、精确current/target head、迁移角色、三方actor和时间窗；migration intent在消费前持久化。
- [ ] 生产adapter不再接受`ERP_ALLOW_PRODUCTION_MIGRATION`/`ERP_MIGRATION_CONFIRM`作为充分授权；只有Supervisor派生、内容寻址、单次消费的执行输入可进入受控UAT/production路径，隔离测试入口保持独立且不能升级为真实授权。
- [ ] Migration前取得并重验数据库级写入围栏：只允许精确Migration会话，拒绝额外client backend、未知可连接LOGIN角色、围栏身份漂移、旧quiesce回执或调用者自报状态；失败时SQL前拒绝并保全停写状态。
- [ ] 迁移只接受manifest完整allowlist、逐文件checksum和预期current→target head；每个文件事务提交后核对`schema_migrations`，最终再次核对数据库/角色/session/head/全部row摘要，并生成不可覆盖的promotion-bound commit receipt。
- [ ] checkpoint 7/8按前代原子发布非零migration authorization/fence/result binding；已消费但未开始、部分文件已提交、全部提交但回执未发布、摘要或身份未知等状态均有确定恢复或quarantine，不执行down SQL、不猜测重跑、不释放writer。
- [ ] fake-root、断网、无真实数据库测试覆盖正向/重放、授权复用、额外client/role、身份/head/checksum漂移、每个文件边界及发布崩溃、source替换、hardlink/symlink和quarantine；测试client不得进入生产路径。
- [ ] 机器审计只有在真实生产调用链和负向门完整时把两个Migration检查点转为SUPPORTED；Compose及以后adapter继续NOT_IMPLEMENTED，`assert-ready`仍拒绝。
- [ ] 更新MASTER、TASKS、PROJECT_CONTEXT、CHANGELOG、STATUS、DECISIONS和投产授权包；通过适用测试、资源/敏感/diff检查，形成独立source→manifest提交链并自动进入下一未阻塞任务。

## 3. 禁止事项

- 不连接UAT/生产数据库，不读取业务行、日志、`.env`、凭据、备份、外部对象或Volume正文；不执行Migration SQL或修改数据库CONNECT/role/ACL。
- 不启动Compose/PostgreSQL、build、镜像、部署、回滚或业务API写；不停止/启动真实容器，不修改账号、systemd、网络、Swap、Docker daemon或持久卷。
- 不把可重复环境变量、advisory lock、单次`pg_stat_activity`计数、迁移进程退出0或最终head单独当作promotion-bound一次性Migration回执。

## 4. 起点与资源判定

- TASK72最终source`8ab249e`→monitor`55c1b91`→Supervisor`ad98661`形成30/128文件canonical链；audit现为8项SUPPORTED、7项阻断（P0=6、P1=1），4/7必需Supervisor操作已实现且`assert-ready`继续拒绝。
- 当前运行UAT仍为alpha.42/0040且四个项目容器running、restart0/OOM false；TASK73不得因实现operation而调用真实数据库或改变运行面。
- available约1.9GiB、Swap868MiB/1GiB、根盘13GiB；Swap超过80%，只允许仓库静态、Python和受限Node轻量验证。TASK70继续`BLOCKED / RESOURCE STOP LINE + EXECUTOR DEPENDENCIES`。
