# SELFHOST-UAT-MIGRATION-COMMIT-74 UAT晋升Migration数据库执行与提交回执

> 状态：`DONE / REPOSITORY FENCED MIGRATION COMMIT ADAPTER VERIFIED / DYNAMIC DATABASE VALIDATION DEFERRED / NO REAL DATABASE OR UAT ACTION / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@302661c5d49722c6c4b4bcfe18749417e3688e52` / tree `0a05618b217878c9dd71bb0226bebfb16f5e4a78`
> 责任：Codex主智能体唯一写入、轻量测试串行、证据集成和Git提交；项目负责人保留真实数据库连接/围栏、Migration、凭据、host、UAT/生产及部署专项授权

## 1. 背景与目标

TASK73/D-148已关闭checkpoint 7：同一promotion、candidate、runtime、数据库和Migration allowlist获得内容寻址的一次性批准，但执行范围明确为`APPROVAL_ONLY_NO_SQL_NO_DATABASE_FENCE`，受控路径在数据库pool创建前失败关闭。checkpoint 8仍缺精确数据库client/session/role围栏、逐文件结果、最终reconciliation、不可覆盖提交回执和partial恢复。

本任务只在仓库、fake-root和可注入数据库客户端中实现`MIGRATION_COMMIT_RECEIPT`适配器。真实数据库连接、CONNECT/role/ACL变更和Migration SQL仍需未来专项授权；资源停止线解除前不启动隔离PostgreSQL，动态验证继续归TASK70。

## 2. 验收标准

- [x] 完整核对checkpoint 7批准、Migration runner、运行角色/凭据、`pg_stat_activity`/catalog、CONNECT/read-only fence、`schema_migrations`、journal和恢复责任，记录可证明边界。
- [x] 新增独立`RUN_UAT_PROMOTION_MIGRATION`短时一次性Supervisor授权；不得复用checkpoint 7授权SHA，须精确绑定其receipt/binding、ordinal-7前代、promotion/candidate/runtime/database、current/target head、allowlist、Migration角色、三方actor和窗口。
- [x] migration execution intent必须在执行授权消费前持久化；production路径只接受Supervisor派生、内容寻址、单次消费的执行输入，legacy环境确认和测试client不得形成真实权限。
- [x] SQL前建立并重验数据库级围栏：只允许精确Migration client/session/role，拒绝额外业务backend、未知可连接LOGIN角色、数据库/system identifier/marker漂移、旧quiesce或调用者自报状态；失败时保持writer静默并在业务SQL前拒绝。
- [x] 只接受manifest完整allowlist、逐文件checksum和预期current→target head；每个文件单事务提交后核对`schema_migrations`，最终再核对数据库、session、角色、head及全部Migration row摘要。
- [x] 生成promotion-bound、不可覆盖的commit receipt，checkpoint 8按history→receipt→current原子发布非零fence/result binding，并保留完整且唯一的授权摘要链。
- [x] 已消费但未执行、部分文件提交、全部提交但回执未发布、会话/fence/head/checksum未知及三个发布崩溃点均有确定恢复或quarantine；不执行down SQL、不猜测重跑、不释放writer、不删除事故证据。
- [x] fake-root、断网、无真实数据库测试覆盖正向/重放、跨检查点授权复用、额外client/role、身份/head/checksum漂移、每文件边界、source替换、hardlink/symlink和quarantine；生产adapter与测试adapter不可互换。资源停止线下的真实PostgreSQL/Docker执行留给TASK70，不冒充本项静态验收。
- [x] 机器审计仅在真实生产调用链和负向门完整时把checkpoint 8转为SUPPORTED；Compose及以后adapter继续MISSING，`assert-ready`仍拒绝。
- [x] 更新MASTER、TASKS、PROJECT_CONTEXT、CHANGELOG、STATUS、DECISIONS和投产授权包；通过适用轻量测试、资源/敏感/diff检查，形成独立source→manifest提交链并自动进入下一未阻塞任务。

## 3. 禁止事项

- 不连接UAT/生产数据库，不读取业务行、日志、`.env`、凭据、备份、外部对象或Volume正文；不执行真实Migration SQL或修改数据库CONNECT/role/ACL。
- 不启动Compose/PostgreSQL、build、镜像、部署、回滚或业务API写；不停止/启动真实容器，不修改账号、systemd、网络、Swap、Docker daemon或持久卷。
- 不把checkpoint 7批准、环境变量、advisory lock、单次`pg_stat_activity`快照、进程退出0或最终head单独当作Migration提交回执。

## 4. 起点与资源判定

- TASK73最终source`32860b8`→monitor`18b93e9`→Supervisor`302661c`形成当前链；审计为9项SUPPORTED、6项阻断（P0=5、P1=1），checkpoint 8仍MISSING且`assert-ready`继续拒绝。
- 当前运行UAT仍为alpha.42/0040且四个项目容器running、restart0/OOM false；本任务不得因实现operation而调用真实数据库或改变运行面。
- available约1.9GiB、Swap868MiB/1GiB、根盘13GiB；Swap超过80%，只允许仓库静态、Python和受限Node轻量验证。TASK70继续`BLOCKED / RESOURCE STOP LINE + EXECUTOR DEPENDENCIES`。

## 5. 完成证据

- `RUN_UAT_PROMOTION_MIGRATION`使用最长15分钟的独立授权与grant；execution intent先于消费落盘，checkpoint 7授权SHA不能复用。候选完整release artifact目录经root-owned、单硬链接、无symlink、目录前后identity和32 MiB总量门固定后才可进入执行器。
- 控制器先重验精确Compose writer静默和当前released数据库角色/ACL基线，再设置database default read-only、收紧CONNECT/connection limit并拒绝额外backend/LOGIN/ACL；Migration容器只接受精确worker digest、operation/grant label及`MIGRATION_FENCED`运行时身份。每个SQL文件禁止顶层事务控制、独立事务提交并在commit前复核deadline/身份/ledger，最后对完整有序`schema_migrations`摘要和围栏进行二次核对。
- 成功后数据库进入`allow_connections=false`、connection limit 0的主动围栏，checkpoint 8发布history→receipt→current；该active fence必须由checkpoint 9精确接管或由同一operation恢复保全，其他Supervisor操作全部被联锁拒绝。
- 超时或恢复先对精确数据库做emergency seal，再按operation+grant唯一label定位候选并执行stop→kill→已退出证明。已消费但结果未知、部分提交或发布冲突只保全/quarantine，不运行down SQL、不猜测重跑、不删除容器或证据。
- 机器审计artifact为`e4aa3687d08902a8bfb0a7846f45b7ee160db630570898f7223461bc26e5e2fc`，22文件source manifest为`53a1515a315efbba8a3054cc6b042be1c65dbda71a95de5c8a1673d9533f4239`。现为10项SUPPORTED、5项阻断（P0=4、P1=1），6/8必需Supervisor操作实现；Compose、最终收据、人工UAT和rollback仍阻断，`assert-ready`精确返回`UAT_PROMOTION_EXECUTOR_NOT_READY`。
- 受限Node专项120/120、Python专项57/57、inventory `258/234/24`验证、compile/syntax、生成物重放、`git diff --check`及两轮凭据扫描`30+3`文件通过。因Swap持续高于80%，没有运行typecheck、全量测试、Docker build、Compose或PostgreSQL动态测试；该未验证范围归TASK70。
- 源链为`ce7bb230974ac2f7d50ff16b751a5f99915f9d7a`/tree`f5043439aaaecf885305dccda6fc9e9cf82b3909`→边界修正`5610a0db8adadc04cae6f0b239c1fcd7a1e9bc1a`/tree`26edea69c120c7f2d3977d40aab971cf2a90f4e0`→manifest-only`52242f826b542456ee22bae55dcc0b83c746dfea`/tree`6a20ec8fe44238a438401bdf15f777b22df6f47b`。130文件Supervisor bundle raw SHA-256为`17efe85dec35a233090eb97f7f93a9df94b26a3aa8120a6a3fe0b00df757aad5`。
- 收口前资源复核为available 1.9GiB、Swap879/1024MiB、根盘12,699MiB、Load`0.33/0.26/0.16`；四服务restart0/OOM false且Web/PostgreSQL healthy，宿主`oom_kill`计数2。任务没有新建容器、网络、Volume、数据库或持久临时资源；两次临时Node二进制目录均精确清零。宿主OOM计数缺少同窗口起点值，故不作“本任务宿主OOM增量为0”的过度结论。

## 6. 剩余边界

本任务只证明仓库生产调用链与负向门，不表示当前UAT数据库已围栏、Migration已运行或checkpoint 8存在actual回执。当前UAT仍为alpha.42/0040，源码匹配镜像、真实异机恢复、监控激活、职责批准、跨岗签字、员工试运行和切换均未完成。下一P0为checkpoint 9一次性Compose部署回执；TASK70在资源停止线解除且执行器完整前继续BLOCKED，系统保持`PRODUCTION NO-GO`。
