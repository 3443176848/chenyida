# SELFHOST-UAT-MIGRATION-TRANSACTION-73 UAT晋升一次性Migration批准检查点

> 状态：`DONE / REPOSITORY ONE-TIME MIGRATION APPROVAL VERIFIED / SQL EXECUTION FAILS CLOSED / NO REAL DATABASE OR UAT ACTION / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@ad98661b78e5f9fb989a7d56d78992c24592b27d` / tree `8912ce1005ebd22982fc65e0a1169ed68c4769a1`
> 最终链：source `32860b86be13cab880b5cf0cd8e9cfb255956809` / tree `b950a29944c48a73be78bab730f252b6f5ccf9c4` → monitor `18b93e90ecd8f90b084d82596f847e7651aec6ee` / tree `a5967c5bfbe853bb322bb77a11eadecd6a495f33` → Supervisor `302661c5d49722c6c4b4bcfe18749417e3688e52` / tree `0a05618b217878c9dd71bb0226bebfb16f5e4a78`
> 责任：Codex主智能体唯一写入、轻量测试串行、证据集成和Git提交；项目负责人保留真实数据库连接/围栏、Migration、凭据、host、UAT/生产及部署专项授权

## 1. 完成结论

TASK72/D-147只证明精确Compose Web/Worker持续静默，不能证明数据库外部客户端已围栏。只读核对进一步确认，checkpoint 7的Migration批准和checkpoint 8的数据库执行不能共用一次授权：事务合同要求每个检查点使用唯一授权SHA，而数据库围栏、精确Migration session和提交结果只能在执行窗口证明。

因此本任务按D-148收敛为checkpoint 7 `ONE_TIME_MIGRATION_AUTHORIZATION`。它建立独立、短时、三方职责分离、内容寻址的一次性批准证据，同时在任何数据库pool创建和SQL执行前强制返回`MIGRATION_SUPERVISOR_EXECUTION_ADAPTER_NOT_IMPLEMENTED`。checkpoint 8拆为`SELFHOST-UAT-MIGRATION-COMMIT-74`，不得复用本任务授权或把环境变量确认升级为执行权。

## 2. 验收结果

- [x] 完整核对Migration runtime、release authorization、角色/secret、`schema_migrations`、数据库CONNECT/read-only围栏、journal与release gate依赖，固定批准与执行必须分离的边界。
- [x] Supervisor v6新增`AUTHORIZE_UAT_PROMOTION_MIGRATION`；短时授权精确绑定ordinal-6回执、promotion/quiesce intent与binding、ELIGIBLE manifest、candidate/runtime、数据库稳定身份、current/target head、allowlist摘要、Migration角色、三方actor和时间窗。
- [x] `UAT_PROMOTION_MIGRATION_AUTHORIZATION_INTENT_CONTRACT`在授权消费前持久化；prepare前、消费前、消费后重验四个权威source的inode、mode、owner、单硬链接、可信目录链和SHA-256。
- [x] checkpoint 7按history→receipt→current无覆盖发布非零`migration_authorization_binding_sha256`，授权摘要链保持唯一；重放、漂移、source替换和冲突失败关闭。
- [x] 恢复覆盖history、receipt和current三个发布崩溃点；过期未提交、替换、hardlink/symlink或未知状态只保全并quarantine，不删除证据、不执行SQL、不释放writer。
- [x] 批准intent固定`execution_scope: APPROVAL_ONLY_NO_SQL_NO_DATABASE_FENCE`。受控release evidence存在时，`migrate-postgres.ts`在创建数据库pool前调用执行adapter门并拒绝；`ERP_ALLOW_PRODUCTION_MIGRATION`/`ERP_MIGRATION_CONFIRM`只可验证legacy release evidence，不能授权受控SQL。
- [x] 隔离测试入口保持独立；测试client、fake-root或可重复环境变量均不能进入production执行路径。
- [x] 机器审计仅把checkpoint 7转为SUPPORTED；checkpoint 8仍为MISSING，审计为9项SUPPORTED、6项阻断（P0=5、P1=1），`assert-ready`继续返回`UAT_PROMOTION_EXECUTOR_NOT_READY`。
- [x] 更新机器审计说明与两层内容寻址manifest；未连接数据库、运行Migration、修改UAT/生产或触碰真实数据。

## 3. 验证证据

- Supervisor专项：`python3 -m unittest chenyida_erp_site/tests/test_release_supervisor_uat_promotion.py`，9/9通过。
- 受限、断网、只读Node容器串行运行事务journal、Migration allowlist和Migration tool专项，合计37/37通过；其中checkpoint 7正向、重放拒绝、漂移、source替换、三个发布崩溃点、hardlink/symlink quarantine均覆盖。
- `test_release_supervisor_monitoring_host_delivery.py` 14/14、`test_release_supervisor_installer.py` 17/17通过；targeted ESLint、Python compile、Node syntax、凭据扫描和`git diff --check`通过。
- 审计artifact self SHA-256为`ed37e9803633d2331c30df244c472b8b1f6d95406be7ba80a77d2e1f07b5e520`，verify为PASS/BLOCKED，`assert-ready`按预期exit 1。
- monitor/Supervisor manifest raw SHA-256分别为`59ea10842df37d47dcf598a08fd2e56bf417680a61ded714897f647f1e6077c0`、`090c3a23c0d3e4680dec3f909e60f62824ed1eef36ae1bff3621f5edee924800`。

## 4. 资源、安全与运行面

- 起点与收口available约1.9GiB，Swap 868MiB/1GiB（超过80%停止线），根盘可用13GiB，Load低且未持续越线；四个项目容器restart 0、OOM false。
- 只运行轻量Python及单个192MiB/0.5 CPU、断网、只读、自动删除的Node测试容器；未运行build、全量Node/PostgreSQL、Docker数据库、typecheck、backup/restore、Migration、镜像或Compose变更。
- 当前UAT继续alpha.42/0040且四服务running；没有停止writer、连接数据库、读取业务行/日志/`.env`/凭据/备份/Volume或修改账号、systemd、网络、Swap、Docker daemon。
- 项目负责人未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`保持不读、不改、不提交；本任务临时审计输出已精确清理。

## 5. 剩余边界

checkpoint 7只是“一次性批准存在且输入精确”的证明，不是数据库围栏、Migration执行或提交回执。TASK74必须使用新的`RUN_UAT_PROMOTION_MIGRATION`授权，证明精确数据库会话与角色围栏、逐文件提交、最终reconciliation、不可覆盖回执和partial恢复。TASK70继续等待完整执行器与Swap停止线解除；系统仍为`PRODUCTION NO-GO`。
