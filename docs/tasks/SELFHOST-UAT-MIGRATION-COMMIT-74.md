# SELFHOST-UAT-MIGRATION-COMMIT-74 UAT晋升Migration数据库执行与提交回执

> 状态：`DOING / REPOSITORY DATABASE FENCE AND MIGRATION COMMIT RECEIPT / RESOURCE STOP LINE ACTIVE / NO REAL DATABASE OR UAT ACTION / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@302661c5d49722c6c4b4bcfe18749417e3688e52` / tree `0a05618b217878c9dd71bb0226bebfb16f5e4a78`
> 责任：Codex主智能体唯一写入、轻量测试串行、证据集成和Git提交；项目负责人保留真实数据库连接/围栏、Migration、凭据、host、UAT/生产及部署专项授权

## 1. 背景与目标

TASK73/D-148已关闭checkpoint 7：同一promotion、candidate、runtime、数据库和Migration allowlist获得内容寻址的一次性批准，但执行范围明确为`APPROVAL_ONLY_NO_SQL_NO_DATABASE_FENCE`，受控路径在数据库pool创建前失败关闭。checkpoint 8仍缺精确数据库client/session/role围栏、逐文件结果、最终reconciliation、不可覆盖提交回执和partial恢复。

本任务只在仓库、fake-root和可注入数据库客户端中实现`MIGRATION_COMMIT_RECEIPT`适配器。真实数据库连接、CONNECT/role/ACL变更和Migration SQL仍需未来专项授权；资源停止线解除前不启动隔离PostgreSQL，动态验证继续归TASK70。

## 2. 验收标准

- [ ] 完整核对checkpoint 7批准、Migration runner、运行角色/凭据、`pg_stat_activity`/catalog、CONNECT/read-only fence、`schema_migrations`、journal和恢复责任，记录可证明边界。
- [ ] 新增独立`RUN_UAT_PROMOTION_MIGRATION`短时一次性Supervisor授权；不得复用checkpoint 7授权SHA，须精确绑定其receipt/binding、ordinal-7前代、promotion/candidate/runtime/database、current/target head、allowlist、Migration角色、三方actor和窗口。
- [ ] migration execution intent必须在执行授权消费前持久化；production路径只接受Supervisor派生、内容寻址、单次消费的执行输入，legacy环境确认和测试client不得形成真实权限。
- [ ] SQL前建立并重验数据库级围栏：只允许精确Migration client/session/role，拒绝额外业务backend、未知可连接LOGIN角色、数据库/system identifier/marker漂移、旧quiesce或调用者自报状态；失败时保持writer静默并在业务SQL前拒绝。
- [ ] 只接受manifest完整allowlist、逐文件checksum和预期current→target head；每个文件单事务提交后核对`schema_migrations`，最终再核对数据库、session、角色、head及全部Migration row摘要。
- [ ] 生成promotion-bound、不可覆盖的commit receipt，checkpoint 8按history→receipt→current原子发布非零fence/result binding，并保留完整且唯一的授权摘要链。
- [ ] 已消费但未执行、部分文件提交、全部提交但回执未发布、会话/fence/head/checksum未知及三个发布崩溃点均有确定恢复或quarantine；不执行down SQL、不猜测重跑、不释放writer、不删除事故证据。
- [ ] fake-root、断网、无真实数据库测试覆盖正向/重放、跨检查点授权复用、额外client/role、身份/head/checksum漂移、每文件边界、source替换、hardlink/symlink和quarantine；生产adapter与测试adapter不可互换。
- [ ] 机器审计仅在真实生产调用链和负向门完整时把checkpoint 8转为SUPPORTED；Compose及以后adapter继续MISSING，`assert-ready`仍拒绝。
- [ ] 更新MASTER、TASKS、PROJECT_CONTEXT、CHANGELOG、STATUS、DECISIONS和投产授权包；通过适用轻量测试、资源/敏感/diff检查，形成独立source→manifest提交链并自动进入下一未阻塞任务。

## 3. 禁止事项

- 不连接UAT/生产数据库，不读取业务行、日志、`.env`、凭据、备份、外部对象或Volume正文；不执行真实Migration SQL或修改数据库CONNECT/role/ACL。
- 不启动Compose/PostgreSQL、build、镜像、部署、回滚或业务API写；不停止/启动真实容器，不修改账号、systemd、网络、Swap、Docker daemon或持久卷。
- 不把checkpoint 7批准、环境变量、advisory lock、单次`pg_stat_activity`快照、进程退出0或最终head单独当作Migration提交回执。

## 4. 起点与资源判定

- TASK73最终source`32860b8`→monitor`18b93e9`→Supervisor`302661c`形成当前链；审计为9项SUPPORTED、6项阻断（P0=5、P1=1），checkpoint 8仍MISSING且`assert-ready`继续拒绝。
- 当前运行UAT仍为alpha.42/0040且四个项目容器running、restart0/OOM false；本任务不得因实现operation而调用真实数据库或改变运行面。
- available约1.9GiB、Swap868MiB/1GiB、根盘13GiB；Swap超过80%，只允许仓库静态、Python和受限Node轻量验证。TASK70继续`BLOCKED / RESOURCE STOP LINE + EXECUTOR DEPENDENCIES`。
