# 晨亿达 ERP UAT 晋升与快照回滚执行器审计 v1

> 当前结论：`BLOCKED / EXECUTOR INCOMPLETE / NOT AUTHORIZED TO PROMOTE OR ROLLBACK`。本报告是源码摘要绑定的机器审计，不是UAT、Migration、部署、恢复或回滚授权。

## 1. 审计结论

- artifact SHA-256：`e4aa3687d08902a8bfb0a7846f45b7ee160db630570898f7223461bc26e5e2fc`
- source manifest SHA-256：`53a1515a315efbba8a3054cc6b042be1c65dbda71a95de5c8a1673d9533f4239`（22文件）
- release inventory SHA-256：`5f2fdff02838d05f42fa4fca768737c63d9bf57bc445aad9a0ea333bb2baa91f`（258项）
- 执行判定：`UAT_PROMOTION_EXECUTOR_NOT_READY`；P0=4，P1=1，may_start=`false`。
- 当前只允许继续仓库实施和隔离验证；不得执行UAT Migration、Compose部署、业务写、快照回灌或回滚。

仓库已有候选source snapshot、ELIGIBLE manifest、pre-deploy runtime guard、promotion intent/journal、promotion-bound actual-offhost snapshot验收、同一Compose Web/Worker持续静默回执、一次性Migration数据库围栏与提交回执、postdeploy probe和runtime identity；但尚未把Compose部署、业务UAT和回退适配器全部接入同一耐久逐检查点事务。

## 2. Supervisor操作面

当前识别25个Supervisor操作；所需8个UAT晋升/回退操作中实现6个、缺失2个。

缺失操作：

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
| 6 | `WRITER_QUIESCE_RECEIPT` | `SUPPORTED` | 已由当前源码合同支持 |
| 7 | `ONE_TIME_MIGRATION_AUTHORIZATION` | `SUPPORTED` | 已由当前源码合同支持 |
| 8 | `MIGRATION_COMMIT_RECEIPT` | `SUPPORTED` | 已由当前源码合同支持 |
| 9 | `COMPOSE_DEPLOYMENT_RECEIPT` | `MISSING` | 镜像digest override存在，但没有一次性授权的Compose部署执行器、前后容器身份回执或未知partial恢复。 |
| 10 | `POST_DEPLOY_RUNTIME_CONFIGURATION` | `SUPPORTED` | 已由当前源码合同支持 |
| 11 | `POST_DEPLOY_IDENTITY` | `SUPPORTED` | 已由当前源码合同支持 |
| 12 | `CROSS_ROLE_UAT_EXECUTION` | `CONTRACT_ONLY` | TASK67只提供BLOCKED合成合同；没有事前批准、账号映射、真实执行回执或三方签字。 |
| 13 | `PROMOTION_FINAL_RECEIPT` | `MISSING` | 没有聚合Migration、部署、postdeploy、恢复能力和UAT结果的单调promotion COMMITTED receipt。 |
| 14 | `ROLLBACK_TO_UAT_EXECUTOR` | `MISSING` | 当前恢复器显式拒绝UAT目标；没有恢复精确数据库/三文件域、前代镜像和运行配置的UAT回退执行器。 |
| 15 | `ROLLBACK_POSTVERIFY_AND_FINAL_RECEIPT` | `MISSING` | 严格postdeploy验证可复用设计，但当前没有绑定rollback intent/target generation的回退后核验及终态回执。 |

## 4. 关键边界事实

- UAT恢复目标：`TEST_ONLY`；当前恢复器只能写不同cluster上的可丢弃TEST目标。
- Migration授权：`SUPERVISOR_ONE_TIME_EXECUTION_DATABASE_FENCED`；checkpoint 7与独立checkpoint 8授权、数据库围栏、逐文件事务、最终核对和不可覆盖提交回执已形成同一内容寻址链。
- Compose发布：`DIGEST_OVERRIDE_WITHOUT_PROMOTION_RECEIPT`；digest override不等于受控部署回执。
- Writer静默回执只覆盖精确Compose项目与working directory；checkpoint 8在SQL前重验静默并以数据库级围栏拒绝未标记或外部业务客户端，围栏保持至后续部署或保全恢复接管。
- TASK67人工UAT状态：`BLOCKED`。

## 5. 失败关闭要求

任何工具、手册或operator在本artifact仍为BLOCKED时调用晋升断言，必须得到`UAT_PROMOTION_EXECUTOR_NOT_READY`。不得用root手工Compose、可重复环境变量、TEST恢复回执、旧postdeploy receipt或最终health页面绕过缺失检查点。

下一实现必须接入独立的一次性Compose部署执行授权、精确digest容器替换回执和unknown/partial恢复，并继续沿用内容寻址history/receipts/current、每步一次性授权、精确前代回退及unknown/partial保全；执行器完整后才可在合成Compose和隔离PostgreSQL做动态验证。

## 6. 源码manifest

| 路径 | SHA-256 |
| --- | --- |
| `chenyida_erp_site/compose.release.yml` | `1f921685f73efd592700a2ad3db1ee0abe709a1564c96f576a24d19fea25ff57` |
| `chenyida_erp_site/compose.yml` | `2f4b8aad65bcefb4d603825543ebd6ec09674f9e5cfef7b30e88afa5944a0bfa` |
| `chenyida_erp_site/db/index.ts` | `918aa029fbd9bb5532d2be60e848b0517a43bf783d2bdc1e88a880f02effb4dd` |
| `chenyida_erp_site/db/runtime-connection.ts` | `c2ee0b707a25719e5b7280e762a7e89a147d50e37d5531c9d22534a4656f8cd7` |
| `chenyida_erp_site/operations/cross-role-uat-evidence-contract-v1.json` | `51c92819078a1ffb29c616e14bb169a3efdfdf611bccb26a2098b2fe863ee95c` |
| `chenyida_erp_site/operations/uat-promotion-transaction-policy-v1.json` | `756c1249776499d8096ec2ed8041bd68aa41ce253ce49ee9b5b46650f163b093` |
| `chenyida_erp_site/scripts/backup-recovery-readiness-v4.mjs` | `a0bf58d1f0afa7b5d5b98caf239f034bad910cfa2023fdc8b62b22630e45adda` |
| `chenyida_erp_site/scripts/backup-selfhost.sh` | `adb7047631660c20a01c56d6c0393c08e67db5502a3eeeb64f2eaf392daf902a` |
| `chenyida_erp_site/scripts/migrate-postgres.ts` | `46a4aa004307c5b9f26a0b30fd0a3ac3581489eb1f3f88a3bfb5fa614b4d9642` |
| `chenyida_erp_site/scripts/postdeploy-release-contract.mjs` | `5f8c2e7e97707161cc6e473a9437fd1c7a6273a2d58f411c26fa95cbe1b221a7` |
| `chenyida_erp_site/scripts/postdeploy-release-verifier.mjs` | `4de8085198e3e500a109a5092ea0309ba77f8dbf9ebbdeab1990b2d815c15d32` |
| `chenyida_erp_site/scripts/postdeploy-runtime-configuration-probe.mjs` | `5de62cc7de848a2c3c4f3373b3dac71b42872abd56ed382992653d3c848867da` |
| `chenyida_erp_site/scripts/release-candidate-snapshot.py` | `296f61efb552a5fdd327e7b60b567a4dc2a569f9ec1c93bd57ef4dfe0f4fe98d` |
| `chenyida_erp_site/scripts/release-gate-runner.mjs` | `172c99a33bac72f78b58453e11cca1632e2ad4f461b42f40ff264e11dc92077d` |
| `chenyida_erp_site/scripts/release-lifecycle-contract.mjs` | `3b6945a9b7374abf3f892492bf3811b7b105e435ca4ab43020d53bba0d0e8f1e` |
| `chenyida_erp_site/scripts/release-manifest-contract.mjs` | `95ee3ca43a93d7aeaa2029069439bd0875b94631ffa1be2a8c256385b348370b` |
| `chenyida_erp_site/scripts/release-migration-authorization.ts` | `ee700cb7e1ce438f06114c54d8d4d17be9c630003307df7140932d86bce54f4e` |
| `chenyida_erp_site/scripts/release-supervisor-launcher.py` | `eba153081614ac4ad893242086aea066df2bdc78414104d2b86d2dca47e8295f` |
| `chenyida_erp_site/scripts/restore-selfhost.sh` | `c648db054afdcec661ffc293eec71f3087315412aa222078aabea3a4de102b22` |
| `chenyida_erp_site/scripts/uat-promotion-migration-control.py` | `16f5eb7fa1e8639056af8cceb51aac54ec1f55f8d299cc1807c30057b9e13f73` |
| `chenyida_erp_site/scripts/uat-promotion-migration-execution-contract.mjs` | `c859a89c79f81c51f8f75d2c61b7ed2ee1884a8868b1349d0b99f7973d176ac2` |
| `chenyida_erp_site/scripts/uat-promotion-transaction-journal.mjs` | `49ab4a3b670144b56a30b75ebde4d71789fe044339274778e74eae0d881e2390` |
