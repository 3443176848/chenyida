# 晨亿达 ERP UAT 晋升与快照回滚执行器审计 v1

> 当前结论：`BLOCKED / EXECUTOR INCOMPLETE / NOT AUTHORIZED TO PROMOTE OR ROLLBACK`。本报告是源码摘要绑定的机器审计，不是UAT、Migration、部署、恢复或回滚授权。

## 1. 审计结论

- artifact SHA-256：`5a5c78e3773e12629c3dd71fdc607543b6ebcf3dd1ef579c797add2235094a6d`
- source manifest SHA-256：`0c19ca77fe6e5beb056ec14adc12e2c22d3211d67f07e5217125ad6c1e313abe`（26文件）
- release inventory SHA-256：`cad3d2b37666aa3e68e02fb770042216577909305a836f1d5c01355b3c630ecd`（259项）
- 执行判定：`UAT_PROMOTION_EXECUTOR_NOT_READY`；P0=2，P1=0，may_start=`false`。
- 当前只允许继续仓库实施和隔离验证；不得执行UAT Migration、Compose部署、业务写、快照回灌或回滚。

仓库已有候选source snapshot、ELIGIBLE manifest、pre-deploy runtime guard、promotion intent/journal、promotion-bound actual-offhost snapshot验收、同一Compose Web/Worker持续静默回执、一次性Migration数据库围栏与提交回执、checkpoint 9受控Compose部署回执、checkpoint 10/11 postdeploy回执、checkpoint 12内容寻址且可恢复的人工UAT证据摄取链，以及checkpoint 13聚合终态回执；人工UAT尚未获批或执行，checkpoint 14/15回退适配器仍未闭合。

## 2. Supervisor操作面

当前识别30个Supervisor操作；所需12个UAT晋升/回退操作中实现11个、缺失1个。

缺失操作：

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
| 9 | `COMPOSE_DEPLOYMENT_RECEIPT` | `SUPPORTED` | 已由当前源码合同支持 |
| 10 | `POST_DEPLOY_RUNTIME_CONFIGURATION` | `SUPPORTED` | 已由当前源码合同支持 |
| 11 | `POST_DEPLOY_IDENTITY` | `SUPPORTED` | 已由当前源码合同支持 |
| 12 | `CROSS_ROLE_UAT_EXECUTION` | `SUPPORTED` | 已由当前源码合同支持 |
| 13 | `PROMOTION_FINAL_RECEIPT` | `SUPPORTED` | 已由当前源码合同支持 |
| 14 | `ROLLBACK_TO_UAT_EXECUTOR` | `MISSING` | 当前恢复器显式拒绝UAT目标；没有恢复精确数据库/三文件域、前代镜像和运行配置的UAT回退执行器。 |
| 15 | `ROLLBACK_POSTVERIFY_AND_FINAL_RECEIPT` | `MISSING` | 严格postdeploy验证可复用设计，但当前没有绑定rollback intent/target generation的回退后核验及终态回执。 |

## 4. 关键边界事实

- UAT恢复目标：`TEST_ONLY`；当前恢复器只能写不同cluster上的可丢弃TEST目标。
- Migration授权：`SUPERVISOR_ONE_TIME_EXECUTION_DATABASE_FENCED`；checkpoint 7与独立checkpoint 8授权、数据库围栏、逐文件事务、最终核对和不可覆盖提交回执已形成同一内容寻址链。
- Compose发布：`SUPERVISOR_CHECKPOINT_9_FENCED_WEB_WORKER_REPLACEMENT`；checkpoint 9绑定精确digest、受保护资源身份、数据库围栏交接和unknown/partial保全，但不代表后续postdeploy与业务UAT检查点已提交。
- Postdeploy事务：`SUPERVISOR_CHECKPOINT_10_11_CONTENT_ADDRESSED_AND_RECOVERABLE`；checkpoint 10/11使用彼此独立的一次性授权，绑定checkpoint 9结果、围栏交接、manifest、四服务运行身份；Supervisor外部控制摘要先形成不可变binding，journal核对后才按history→receipt→current单调提交。
- 跨岗位UAT事务：`SUPERVISOR_CHECKPOINT_12_CONTENT_ADDRESSED_AND_RECOVERABLE`；checkpoint 12只摄取已由事前人工授权、精确账号/人员映射、结构化步骤与控制、共同证据主题及三方签字闭合的结果；人工执行授权与后续Supervisor摄取授权必须不同，恢复只续写journal且不重跑人工步骤。
- 晋升终态事务：`SUPERVISOR_CHECKPOINT_13_AGGREGATED_AND_RECOVERABLE`；checkpoint 13以独立一次性授权聚合checkpoint 4—12 receipt、evidence、intent和authorization链，最终证据绑定checkpoint 12完整result摘要；不释放数据库或备份保护，也不声明checkpoint 14/15回退就绪。
- Writer静默回执只覆盖精确Compose项目与working directory；checkpoint 8在SQL前重验静默并以数据库级围栏拒绝未标记或外部业务客户端，围栏保持至后续部署或保全恢复接管。
- TASK67人工UAT状态：`BLOCKED`。

## 5. 失败关闭要求

任何工具、手册或operator在本artifact仍为BLOCKED时调用晋升断言，必须得到`UAT_PROMOTION_EXECUTOR_NOT_READY`。不得用root手工Compose、可重复环境变量、TEST恢复回执、旧postdeploy receipt或最终health页面绕过缺失检查点。

下一实现必须补齐checkpoint 14/15精确前代回退；checkpoint 12摄取和checkpoint 13终态提交适配器已闭合，但实际人工UAT仍需独立事前授权、UAT资源、人员映射和签字，不能由仓库测试替代。

## 6. 源码manifest

| 路径 | SHA-256 |
| --- | --- |
| `chenyida_erp_site/compose.release.yml` | `ca8aefc35ed30f7d4c2af9424b3cdf5606b7b2166ef0648fbf545be52ed18661` |
| `chenyida_erp_site/compose.yml` | `2f4b8aad65bcefb4d603825543ebd6ec09674f9e5cfef7b30e88afa5944a0bfa` |
| `chenyida_erp_site/db/index.ts` | `918aa029fbd9bb5532d2be60e848b0517a43bf783d2bdc1e88a880f02effb4dd` |
| `chenyida_erp_site/db/runtime-connection.ts` | `c2ee0b707a25719e5b7280e762a7e89a147d50e37d5531c9d22534a4656f8cd7` |
| `chenyida_erp_site/operations/cross-role-uat-evidence-contract-v1.json` | `a3d58180cd8d7f731a6e8978a20629fce92048f715b27e6e3532444f426455a3` |
| `chenyida_erp_site/operations/uat-promotion-transaction-policy-v1.json` | `8b41e61e1e53a4c60833eb0f25cdca8d55c13b01142ab59dea956cd62e45f558` |
| `chenyida_erp_site/scripts/backup-recovery-readiness-v4.mjs` | `a0bf58d1f0afa7b5d5b98caf239f034bad910cfa2023fdc8b62b22630e45adda` |
| `chenyida_erp_site/scripts/backup-selfhost.sh` | `adb7047631660c20a01c56d6c0393c08e67db5502a3eeeb64f2eaf392daf902a` |
| `chenyida_erp_site/scripts/install-release-supervisor.py` | `bd51e0bf39f0094d48ab3199328c363cc895fd3b33bce6ca25cf02ae6066190d` |
| `chenyida_erp_site/scripts/migrate-postgres.ts` | `46a4aa004307c5b9f26a0b30fd0a3ac3581489eb1f3f88a3bfb5fa614b4d9642` |
| `chenyida_erp_site/scripts/postdeploy-release-contract.mjs` | `5f8c2e7e97707161cc6e473a9437fd1c7a6273a2d58f411c26fa95cbe1b221a7` |
| `chenyida_erp_site/scripts/postdeploy-release-verifier.mjs` | `4de8085198e3e500a109a5092ea0309ba77f8dbf9ebbdeab1990b2d815c15d32` |
| `chenyida_erp_site/scripts/postdeploy-runtime-configuration-probe.mjs` | `5de62cc7de848a2c3c4f3373b3dac71b42872abd56ed382992653d3c848867da` |
| `chenyida_erp_site/scripts/release-candidate-snapshot.py` | `296f61efb552a5fdd327e7b60b567a4dc2a569f9ec1c93bd57ef4dfe0f4fe98d` |
| `chenyida_erp_site/scripts/release-gate-runner.mjs` | `172c99a33bac72f78b58453e11cca1632e2ad4f461b42f40ff264e11dc92077d` |
| `chenyida_erp_site/scripts/release-lifecycle-contract.mjs` | `3b6945a9b7374abf3f892492bf3811b7b105e435ca4ab43020d53bba0d0e8f1e` |
| `chenyida_erp_site/scripts/release-manifest-contract.mjs` | `b299a4fdeef5190dc8a4ad0d5b98916bea54d0c57d186bd3edc0540e75ef80ee` |
| `chenyida_erp_site/scripts/release-migration-authorization.ts` | `ee700cb7e1ce438f06114c54d8d4d17be9c630003307df7140932d86bce54f4e` |
| `chenyida_erp_site/scripts/release-supervisor-launcher.py` | `9e040adc28ca6e380e18db382ed85a22d600e89f6917571b519654871fb7237c` |
| `chenyida_erp_site/scripts/restore-selfhost.sh` | `c648db054afdcec661ffc293eec71f3087315412aa222078aabea3a4de102b22` |
| `chenyida_erp_site/scripts/uat-promotion-compose-deployment-contract.mjs` | `7769e7a3cc7009c3268f4edc0ccd1258ddf5fa2ebc6843512d90153b35365094` |
| `chenyida_erp_site/scripts/uat-promotion-compose-deployment-control.mjs` | `d61a94e0413eb8738f6f90a34aee3af2334fa16f14f49cb43b16c045a15aac5d` |
| `chenyida_erp_site/scripts/uat-promotion-cross-role-evidence-contract.mjs` | `9895be140ca89af62e4a848b9cc8bf175f7736cd60c8b481ac085c98041da766` |
| `chenyida_erp_site/scripts/uat-promotion-migration-control.py` | `16f5eb7fa1e8639056af8cceb51aac54ec1f55f8d299cc1807c30057b9e13f73` |
| `chenyida_erp_site/scripts/uat-promotion-migration-execution-contract.mjs` | `c859a89c79f81c51f8f75d2c61b7ed2ee1884a8868b1349d0b99f7973d176ac2` |
| `chenyida_erp_site/scripts/uat-promotion-transaction-journal.mjs` | `831ffb2b38613793747984cd457f4acd2e75f92c034f8eeb5fc44238e1524e6b` |
