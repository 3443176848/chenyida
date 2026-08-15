# 晨亿达 ERP UAT 晋升与快照回滚执行器审计 v1

> 当前结论：`BLOCKED / EXECUTOR INCOMPLETE / NOT AUTHORIZED TO PROMOTE OR ROLLBACK`。本报告是源码摘要绑定的机器审计，不是UAT、Migration、部署、恢复或回滚授权。

## 1. 审计结论

- artifact SHA-256：`c0a5a5619835bf82d478494ed63d2e2d68c54542634495aae93986090ad6f24d`
- source manifest SHA-256：`eab97c64078d00ff75e0da55710e3c9b9b2b7780d996c35e5e6a7a093f9de093`（15文件）
- release inventory SHA-256：`da85d92555b957c6b9a2d4697f88e96156230b8d37e6951e839c67189dfe187b`（256项）
- 执行判定：`UAT_PROMOTION_EXECUTOR_NOT_READY`；P0=9，P1=1，may_start=`false`。
- 当前只允许继续仓库实施和隔离验证；不得执行UAT Migration、Compose部署、业务写、快照回灌或回滚。

仓库已有候选source snapshot、ELIGIBLE manifest、pre-deploy runtime guard、postdeploy probe和runtime identity；但没有把备份、writer quiesce、Migration、Compose部署、业务UAT和回退串成同一耐久逐检查点事务。

## 2. Supervisor操作面

当前识别19个Supervisor操作；所需7个UAT晋升/回退操作中实现0个、缺失7个。

缺失操作：

- `BEGIN_UAT_PROMOTION`
- `CAPTURE_UAT_PROMOTION_SNAPSHOT`
- `QUIESCE_UAT_WRITERS`
- `RUN_UAT_PROMOTION_MIGRATION`
- `DEPLOY_UAT_RELEASE`
- `ROLLBACK_UAT_RELEASE`
- `RECOVER_UAT_PROMOTION`

## 3. 逐检查点能力

| 序号 | 检查点 | 状态 | 未闭合风险 |
| ---: | --- | --- | --- |
| 1 | `CANDIDATE_SOURCE_SNAPSHOT` | `SUPPORTED` | 已由当前源码合同支持 |
| 2 | `ELIGIBLE_RELEASE_MANIFEST` | `SUPPORTED` | 已由当前源码合同支持 |
| 3 | `PRE_DEPLOY_RUNTIME_STABILITY` | `SUPPORTED` | 已由当前源码合同支持 |
| 4 | `PROMOTION_INTENT_AND_DURABLE_JOURNAL` | `MISSING` | 没有把同一候选、授权、当前运行面、数据库、快照和逐检查点状态绑定的durable promotion intent/journal。 |
| 5 | `PROMOTION_BOUND_RECOVERABLE_SNAPSHOT` | `PARTIAL` | 备份可生成UAT来源回执，但现有恢复只允许不同集群的可丢弃TEST目标；没有绑定本次晋升并可恢复到UAT的执行合同。 |
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

下一实现必须建立内容寻址promotion intent/history/receipts/current、每步一次性授权、精确前代回退、unknown/partial保全与同一候选/数据库/快照/运行面绑定；之后才可在合成Compose和隔离PostgreSQL做动态验证。

## 6. 源码manifest

| 路径 | SHA-256 |
| --- | --- |
| `chenyida_erp_site/compose.release.yml` | `1f921685f73efd592700a2ad3db1ee0abe709a1564c96f576a24d19fea25ff57` |
| `chenyida_erp_site/compose.yml` | `2f4b8aad65bcefb4d603825543ebd6ec09674f9e5cfef7b30e88afa5944a0bfa` |
| `chenyida_erp_site/operations/cross-role-uat-evidence-contract-v1.json` | `b5799f986211d3589cf0f68bcde7b35252f49489deb08ba111d7017821a0fba5` |
| `chenyida_erp_site/scripts/backup-selfhost.sh` | `adb7047631660c20a01c56d6c0393c08e67db5502a3eeeb64f2eaf392daf902a` |
| `chenyida_erp_site/scripts/migrate-postgres.ts` | `bb2ede0cb967a736dda09d9a0deaa7e4c68af3ed2be27671b78ea08f19b124e1` |
| `chenyida_erp_site/scripts/postdeploy-release-contract.mjs` | `5f8c2e7e97707161cc6e473a9437fd1c7a6273a2d58f411c26fa95cbe1b221a7` |
| `chenyida_erp_site/scripts/postdeploy-release-verifier.mjs` | `4de8085198e3e500a109a5092ea0309ba77f8dbf9ebbdeab1990b2d815c15d32` |
| `chenyida_erp_site/scripts/postdeploy-runtime-configuration-probe.mjs` | `5de62cc7de848a2c3c4f3373b3dac71b42872abd56ed382992653d3c848867da` |
| `chenyida_erp_site/scripts/release-candidate-snapshot.py` | `296f61efb552a5fdd327e7b60b567a4dc2a569f9ec1c93bd57ef4dfe0f4fe98d` |
| `chenyida_erp_site/scripts/release-gate-runner.mjs` | `172c99a33bac72f78b58453e11cca1632e2ad4f461b42f40ff264e11dc92077d` |
| `chenyida_erp_site/scripts/release-lifecycle-contract.mjs` | `3b6945a9b7374abf3f892492bf3811b7b105e435ca4ab43020d53bba0d0e8f1e` |
| `chenyida_erp_site/scripts/release-manifest-contract.mjs` | `ec707ccdf1d59ef32495fe8af0776850281e0e43877f125a3a7a1e04a1223986` |
| `chenyida_erp_site/scripts/release-migration-authorization.ts` | `bf99fa5ce5a793b0212a806066b9f68a5494d2968110a6d9d34ceab699bfa878` |
| `chenyida_erp_site/scripts/release-supervisor-launcher.py` | `75d474fcabcd806d61079b22b0b6339ff9c066d643d676bdf37d9c6d56c66df5` |
| `chenyida_erp_site/scripts/restore-selfhost.sh` | `c648db054afdcec661ffc293eec71f3087315412aa222078aabea3a4de102b22` |
