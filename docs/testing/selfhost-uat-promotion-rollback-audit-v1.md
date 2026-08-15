# 晨亿达 ERP UAT 晋升与快照回滚执行器审计 v1

> 当前结论：`BLOCKED / EXECUTOR INCOMPLETE / NOT AUTHORIZED TO PROMOTE OR ROLLBACK`。本报告是源码摘要绑定的机器审计，不是UAT、Migration、部署、恢复或回滚授权。

## 1. 审计结论

- artifact SHA-256：`a7004c2eaa732563d28cf3eace61ca82fcf53edc829361bb9ab2288f7991eae9`
- source manifest SHA-256：`0bbcaf63a774e094559646acf619d9c6588c9423bfc3d60f1acf1a8176354c0f`（18文件）
- release inventory SHA-256：`b785d86ad7e851efeeb5916025001d9d766efe9201a62768b7645ec50d7b1bc2`（257项）
- 执行判定：`UAT_PROMOTION_EXECUTOR_NOT_READY`；P0=7，P1=1，may_start=`false`。
- 当前只允许继续仓库实施和隔离验证；不得执行UAT Migration、Compose部署、业务写、快照回灌或回滚。

仓库已有候选source snapshot、ELIGIBLE manifest、pre-deploy runtime guard、promotion intent/journal、promotion-bound actual-offhost snapshot验收、postdeploy probe和runtime identity；但尚未把writer quiesce、Migration、Compose部署、业务UAT和回退适配器全部接入同一耐久逐检查点事务。

## 2. Supervisor操作面

当前识别22个Supervisor操作；所需7个UAT晋升/回退操作中实现3个、缺失4个。

缺失操作：

- `QUIESCE_UAT_WRITERS`
- `RUN_UAT_PROMOTION_MIGRATION`
- `DEPLOY_UAT_RELEASE`
- `ROLLBACK_UAT_RELEASE`

## 3. 逐检查点能力

| 序号 | 检查点 | 状态 | 未闭合风险 |
| ---: | --- | --- | --- |
| 1 | `CANDIDATE_SOURCE_SNAPSHOT` | `SUPPORTED` | 已由当前源码合同支持 |
| 2 | `ELIGIBLE_RELEASE_MANIFEST` | `SUPPORTED` | 已由当前源码合同支持 |
| 3 | `PRE_DEPLOY_RUNTIME_STABILITY` | `SUPPORTED` | 已由当前源码合同支持 |
| 4 | `PROMOTION_INTENT_AND_DURABLE_JOURNAL` | `SUPPORTED` | 已由当前源码合同支持 |
| 5 | `PROMOTION_BOUND_RECOVERABLE_SNAPSHOT` | `SUPPORTED` | 已由当前源码合同支持 |
| 6 | `WRITER_QUIESCE_RECEIPT` | `PARTIAL` | 备份入口要求Web/Worker已经停止并检查writer，但没有由晋升控制面停止精确容器并发布不可变quiesce receipt。 |
| 7 | `ONE_TIME_MIGRATION_AUTHORIZATION` | `PARTIAL` | Migration绑定ELIGIBLE manifest和目标身份，但授权来自可重复环境变量；Supervisor没有一次性迁移操作或消费回执。 |
| 8 | `MIGRATION_COMMIT_RECEIPT` | `MISSING` | Migration逐文件事务和最终数据库核对存在，但没有promotion-bound、不可覆盖的提交回执和partial/recover状态。 |
| 9 | `COMPOSE_DEPLOYMENT_RECEIPT` | `MISSING` | 镜像digest override存在，但没有一次性授权的Compose部署执行器、前后容器身份回执或未知partial恢复。 |
| 10 | `POST_DEPLOY_RUNTIME_CONFIGURATION` | `SUPPORTED` | 已由当前源码合同支持 |
| 11 | `POST_DEPLOY_IDENTITY` | `SUPPORTED` | 已由当前源码合同支持 |
| 12 | `CROSS_ROLE_UAT_EXECUTION` | `CONTRACT_ONLY` | TASK67只提供BLOCKED合成合同；没有事前批准、账号映射、真实执行回执或三方签字。 |
| 13 | `PROMOTION_FINAL_RECEIPT` | `MISSING` | 没有聚合Migration、部署、postdeploy、恢复能力和UAT结果的单调promotion COMMITTED receipt。 |
| 14 | `ROLLBACK_TO_UAT_EXECUTOR` | `MISSING` | 当前恢复器显式拒绝UAT目标；没有恢复精确数据库/三文件域、前代镜像和运行配置的UAT回退执行器。 |
| 15 | `ROLLBACK_POSTVERIFY_AND_FINAL_RECEIPT` | `MISSING` | 严格postdeploy验证可复用设计，但当前没有绑定rollback intent/target generation的回退后核验及终态回执。 |

## 4. 关键边界事实

- UAT恢复目标：`TEST_ONLY`；当前恢复器只能写不同cluster上的可丢弃TEST目标。
- Migration授权：`REPEATABLE_ENVIRONMENT_CONFIRMATION`；尚无Supervisor一次性消费与promotion journal。
- Compose发布：`DIGEST_OVERRIDE_WITHOUT_PROMOTION_RECEIPT`；digest override不等于受控部署回执。
- TASK67人工UAT状态：`BLOCKED`。

## 5. 失败关闭要求

任何工具、手册或operator在本artifact仍为BLOCKED时调用晋升断言，必须得到`UAT_PROMOTION_EXECUTOR_NOT_READY`。不得用root手工Compose、可重复环境变量、TEST恢复回执、旧postdeploy receipt或最终health页面绕过缺失检查点。

下一实现必须接入writer quiesce，并继续沿用内容寻址history/receipts/current、每步一次性授权、精确前代回退及unknown/partial保全；执行器完整后才可在合成Compose和隔离PostgreSQL做动态验证。

## 6. 源码manifest

| 路径 | SHA-256 |
| --- | --- |
| `chenyida_erp_site/compose.release.yml` | `1f921685f73efd592700a2ad3db1ee0abe709a1564c96f576a24d19fea25ff57` |
| `chenyida_erp_site/compose.yml` | `2f4b8aad65bcefb4d603825543ebd6ec09674f9e5cfef7b30e88afa5944a0bfa` |
| `chenyida_erp_site/operations/cross-role-uat-evidence-contract-v1.json` | `9fb9e8eb939ba138a819b1e774ce425730d8103ac4a6bf807a72e1927d63dbc2` |
| `chenyida_erp_site/operations/uat-promotion-transaction-policy-v1.json` | `fa719c27557b92054d5d1fd8f126a7a922b033170f4451d1f1e721ab079ef976` |
| `chenyida_erp_site/scripts/backup-recovery-readiness-v4.mjs` | `a0bf58d1f0afa7b5d5b98caf239f034bad910cfa2023fdc8b62b22630e45adda` |
| `chenyida_erp_site/scripts/backup-selfhost.sh` | `adb7047631660c20a01c56d6c0393c08e67db5502a3eeeb64f2eaf392daf902a` |
| `chenyida_erp_site/scripts/migrate-postgres.ts` | `bb2ede0cb967a736dda09d9a0deaa7e4c68af3ed2be27671b78ea08f19b124e1` |
| `chenyida_erp_site/scripts/postdeploy-release-contract.mjs` | `5f8c2e7e97707161cc6e473a9437fd1c7a6273a2d58f411c26fa95cbe1b221a7` |
| `chenyida_erp_site/scripts/postdeploy-release-verifier.mjs` | `4de8085198e3e500a109a5092ea0309ba77f8dbf9ebbdeab1990b2d815c15d32` |
| `chenyida_erp_site/scripts/postdeploy-runtime-configuration-probe.mjs` | `5de62cc7de848a2c3c4f3373b3dac71b42872abd56ed382992653d3c848867da` |
| `chenyida_erp_site/scripts/release-candidate-snapshot.py` | `296f61efb552a5fdd327e7b60b567a4dc2a569f9ec1c93bd57ef4dfe0f4fe98d` |
| `chenyida_erp_site/scripts/release-gate-runner.mjs` | `172c99a33bac72f78b58453e11cca1632e2ad4f461b42f40ff264e11dc92077d` |
| `chenyida_erp_site/scripts/release-lifecycle-contract.mjs` | `3b6945a9b7374abf3f892492bf3811b7b105e435ca4ab43020d53bba0d0e8f1e` |
| `chenyida_erp_site/scripts/release-manifest-contract.mjs` | `066c29193999711c9197c03c1807842c8376a38508d4be815154c51df3a77750` |
| `chenyida_erp_site/scripts/release-migration-authorization.ts` | `bf99fa5ce5a793b0212a806066b9f68a5494d2968110a6d9d34ceab699bfa878` |
| `chenyida_erp_site/scripts/release-supervisor-launcher.py` | `b2154d44f06486d040d99a5c737ee84ddeda8d1a73f32ec628962955da14ab32` |
| `chenyida_erp_site/scripts/restore-selfhost.sh` | `c648db054afdcec661ffc293eec71f3087315412aa222078aabea3a4de102b22` |
| `chenyida_erp_site/scripts/uat-promotion-transaction-journal.mjs` | `2152e30e1db813a275ad38f1206b80f598a083a7cf86020ad51a8691125a6ac4` |
