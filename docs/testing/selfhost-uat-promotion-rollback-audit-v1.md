# 晨亿达 ERP UAT 晋升与快照回滚执行器审计 v1

> 当前结论：`BLOCKED / CONTROL PLANE AND TRUSTED GATEWAY COMPLETE / EXECUTOR ACTIVATION AND REAL EVIDENCE MISSING`。本报告是源码摘要绑定的机器审计，不是UAT、Migration、部署、恢复或回滚授权。

## 1. 审计结论

- artifact SHA-256：`e2d57cc84807cd3ac5bac0685751af949bf27b998c0f32afd99a73e5dae02364`
- source manifest SHA-256：`b4ca700641d3ea071892e29db5992f79673f4b156e35eca10426ef6c092e12b9`（34文件）
- release inventory SHA-256：`74094fe2a98de757ecab741aa81858666f42d58df4f13fdde5bec082f13251b4`（262项）
- 执行判定：`UAT_PROMOTION_EXECUTOR_NOT_READY`；检查点缺口=0，全部阻塞=3，P0=2，P1=1，may_start=`false`。
- 仓库检查点控制链与受信回退网关已闭合，但真实运行时执行器/激活、隔离回退演练和人工UAT证据尚未闭合；不得执行UAT Migration、Compose部署、业务写、快照回灌或回滚。

仓库已有checkpoint 4—15的内容寻址意图、结果、恢复与隔离控制链，其中checkpoint 14/15绑定精确前代、四数据域、独立授权和ROLLED_BACK终态；受信无shell网关已进入bundle，但固定数据库/卷/容器物化执行器及其激活仍不存在，隔离UAT回退演练与人工UAT也尚未执行。

## 2. Supervisor操作面

当前识别35个Supervisor操作；所需16个UAT晋升/回退操作中实现16个、缺失0个。

缺失操作：

- 无（仅表示Supervisor操作入口和仓库控制链存在）

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
| 14 | `ROLLBACK_TO_UAT_EXECUTOR` | `SUPPORTED` | 已由当前源码合同支持 |
| 15 | `ROLLBACK_POSTVERIFY_AND_FINAL_RECEIPT` | `SUPPORTED` | 已由当前源码合同支持 |

## 4. 关键边界事实

- UAT恢复目标：`TEST_ONLY`；当前恢复器只能写不同cluster上的可丢弃TEST目标。
- Migration授权：`SUPERVISOR_ONE_TIME_EXECUTION_DATABASE_FENCED`；checkpoint 7与独立checkpoint 8授权、数据库围栏、逐文件事务、最终核对和不可覆盖提交回执已形成同一内容寻址链。
- Compose发布：`SUPERVISOR_CHECKPOINT_9_FENCED_WEB_WORKER_REPLACEMENT`；checkpoint 9绑定精确digest、受保护资源身份、数据库围栏交接和unknown/partial保全，但不代表后续postdeploy与业务UAT检查点已提交。
- Postdeploy事务：`SUPERVISOR_CHECKPOINT_10_11_CONTENT_ADDRESSED_AND_RECOVERABLE`；checkpoint 10/11使用彼此独立的一次性授权，绑定checkpoint 9结果、围栏交接、manifest、四服务运行身份；Supervisor外部控制摘要先形成不可变binding，journal核对后才按history→receipt→current单调提交。
- 跨岗位UAT事务：`SUPERVISOR_CHECKPOINT_12_CONTENT_ADDRESSED_AND_RECOVERABLE`；checkpoint 12只摄取已由事前人工授权、精确账号/人员映射、结构化步骤与控制、共同证据主题及三方签字闭合的结果；人工执行授权与后续Supervisor摄取授权必须不同，恢复只续写journal且不重跑人工步骤。
- 晋升终态事务：`SUPERVISOR_CHECKPOINT_13_AGGREGATED_AND_RECOVERABLE`；checkpoint 13以独立一次性授权聚合checkpoint 4—12 receipt、evidence、intent和authorization链，最终证据绑定checkpoint 12完整result摘要；不释放数据库或备份保护，也不声明checkpoint 14/15回退就绪。
- 回退事务：`SUPERVISOR_CHECKPOINT_14_15_CONTENT_ADDRESSED_AND_RECOVERABLE`；checkpoint 14逐阶段先写intent再调用适配器并绑定精确前代，checkpoint 15用独立授权逐项核验后只允许写入ROLLED_BACK；partial/unknown只能隔离，恢复不得重跑阶段。
- 回退运行时：`BUNDLED_FIXED_EXECUTOR_AND_RECOVERABLE_ACTIVATION_PROTOCOL_CAPABILITIES_BLOCKED_HOST_NOT_ACTIVATED`；固定执行器、v2内容寻址激活/恢复、Supervisor v7一次性授权和bundle切换互锁均已纳入受信链，但生产catalog仍显式拒绝缺失的UAT数据库、四数据域及Web/Worker处理器，且没有主机激活证据。
- 回退演练：`NOT_EXECUTED_NO_TRUSTED_UAT_RECEIPT`；fake-root自动测试不是UAT恢复或回退证据。
- Writer静默回执只覆盖精确Compose项目与working directory；checkpoint 8在SQL前重验静默并以数据库级围栏拒绝未标记或外部业务客户端，围栏保持至后续部署或保全恢复接管。
- TASK67人工UAT状态：`BLOCKED`。

## 5. 失败关闭要求

任何工具、手册或operator在本artifact仍为BLOCKED时调用晋升断言，必须得到`UAT_PROMOTION_EXECUTOR_NOT_READY`。不得用root手工Compose、可重复环境变量、TEST恢复回执、旧postdeploy receipt或最终health页面绕过缺失检查点。

下一实现必须补齐受信、最小权限且可隔离测试的UAT数据库、四数据域及Web/Worker固定处理器，再经专项授权执行主机激活并形成真实UAT回退演练回执；实际人工UAT仍需独立事前授权、UAT资源、人员映射和签字，不能由仓库测试替代。

## 6. 源码manifest

| 路径 | SHA-256 |
| --- | --- |
| `chenyida_erp_site/compose.release.yml` | `ca8aefc35ed30f7d4c2af9424b3cdf5606b7b2166ef0648fbf545be52ed18661` |
| `chenyida_erp_site/compose.yml` | `2f4b8aad65bcefb4d603825543ebd6ec09674f9e5cfef7b30e88afa5944a0bfa` |
| `chenyida_erp_site/db/index.ts` | `918aa029fbd9bb5532d2be60e848b0517a43bf783d2bdc1e88a880f02effb4dd` |
| `chenyida_erp_site/db/runtime-connection.ts` | `c2ee0b707a25719e5b7280e762a7e89a147d50e37d5531c9d22534a4656f8cd7` |
| `chenyida_erp_site/operations/cross-role-uat-evidence-contract-v1.json` | `50cf7b9cfe5baf0c563d3f6a828d78f4cea56cbff6bbdb76b54084f104537135` |
| `chenyida_erp_site/operations/uat-promotion-transaction-policy-v1.json` | `c1fe967ab455af92ee385925dab53fcfa59ad6db97ca266d4971fbd632eb8075` |
| `chenyida_erp_site/scripts/backup-recovery-readiness-v4.mjs` | `a0bf58d1f0afa7b5d5b98caf239f034bad910cfa2023fdc8b62b22630e45adda` |
| `chenyida_erp_site/scripts/backup-selfhost.sh` | `adb7047631660c20a01c56d6c0393c08e67db5502a3eeeb64f2eaf392daf902a` |
| `chenyida_erp_site/scripts/install-release-supervisor.py` | `9494592df62154cee0e2cd29a4efe4d3ba06675d40bb6a0f521e2c9ce50f6b2b` |
| `chenyida_erp_site/scripts/migrate-postgres.ts` | `46a4aa004307c5b9f26a0b30fd0a3ac3581489eb1f3f88a3bfb5fa614b4d9642` |
| `chenyida_erp_site/scripts/postdeploy-release-contract.mjs` | `45ae8b59ee0cce8d8a48d673e8b4dc36868b7a068d2b0982e9c711951b47098c` |
| `chenyida_erp_site/scripts/postdeploy-release-verifier.mjs` | `4de8085198e3e500a109a5092ea0309ba77f8dbf9ebbdeab1990b2d815c15d32` |
| `chenyida_erp_site/scripts/postdeploy-runtime-configuration-probe.mjs` | `5de62cc7de848a2c3c4f3373b3dac71b42872abd56ed382992653d3c848867da` |
| `chenyida_erp_site/scripts/release-candidate-snapshot.py` | `296f61efb552a5fdd327e7b60b567a4dc2a569f9ec1c93bd57ef4dfe0f4fe98d` |
| `chenyida_erp_site/scripts/release-gate-runner.mjs` | `172c99a33bac72f78b58453e11cca1632e2ad4f461b42f40ff264e11dc92077d` |
| `chenyida_erp_site/scripts/release-lifecycle-contract.mjs` | `3b6945a9b7374abf3f892492bf3811b7b105e435ca4ab43020d53bba0d0e8f1e` |
| `chenyida_erp_site/scripts/release-manifest-contract.mjs` | `3d819c9ced89c80b26f285b40699326aad8f71184ba7de07dd66831b3a8434cc` |
| `chenyida_erp_site/scripts/release-migration-authorization.ts` | `ee700cb7e1ce438f06114c54d8d4d17be9c630003307df7140932d86bce54f4e` |
| `chenyida_erp_site/scripts/release-supervisor-launcher.py` | `96dd8b3b5ee2e976e8161dc9146c3d8185fe467c15bf63910a282436c75e9831` |
| `chenyida_erp_site/scripts/restore-selfhost.sh` | `c648db054afdcec661ffc293eec71f3087315412aa222078aabea3a4de102b22` |
| `chenyida_erp_site/scripts/uat-promotion-compose-deployment-contract.mjs` | `7769e7a3cc7009c3268f4edc0ccd1258ddf5fa2ebc6843512d90153b35365094` |
| `chenyida_erp_site/scripts/uat-promotion-compose-deployment-control.mjs` | `d61a94e0413eb8738f6f90a34aee3af2334fa16f14f49cb43b16c045a15aac5d` |
| `chenyida_erp_site/scripts/uat-promotion-cross-role-evidence-contract.mjs` | `9895be140ca89af62e4a848b9cc8bf175f7736cd60c8b481ac085c98041da766` |
| `chenyida_erp_site/scripts/uat-promotion-migration-control.py` | `16f5eb7fa1e8639056af8cceb51aac54ec1f55f8d299cc1807c30057b9e13f73` |
| `chenyida_erp_site/scripts/uat-promotion-migration-execution-contract.mjs` | `c859a89c79f81c51f8f75d2c61b7ed2ee1884a8868b1349d0b99f7973d176ac2` |
| `chenyida_erp_site/scripts/uat-promotion-rollback-contract.mjs` | `d8e5ca6471f447385997cdd7a0ce86368982e422c9e8f35b032858225dedb621` |
| `chenyida_erp_site/scripts/uat-promotion-rollback-control.mjs` | `2ceb8edeb04db858e3b9978f76febc3613f9ce56ba844fd8a1208a43c4c0a654` |
| `chenyida_erp_site/scripts/uat-promotion-rollback-fixed-executor-contract.mjs` | `22e595519c17a18425bc4e393269bea3d125dae9f4cccf3ef03e04a8084408c0` |
| `chenyida_erp_site/scripts/uat-promotion-rollback-fixed-executor.py` | `71e4f10cff046a0dd90a7e10fcdf96520834805ddd5a7c2979cdb94a203f0cf8` |
| `chenyida_erp_site/scripts/uat-promotion-rollback-runtime-activation-publisher.mjs` | `0efff23ad47431090a01be9a543ab9de2a5c7e59f1d94bcba59c041d79d80f74` |
| `chenyida_erp_site/scripts/uat-promotion-rollback-runtime-adapter.py` | `d68611af48daf32ada0a4b85aec0f24b3c04b33ac2a40fe5239cb4a3ed084e90` |
| `chenyida_erp_site/scripts/uat-promotion-rollback-runtime-contract.mjs` | `037288a8f086cb925d154bf830561f1bcec030b3ec50d0c1198ed701fad55229` |
| `chenyida_erp_site/scripts/uat-promotion-transaction-journal.mjs` | `bf192c88b674cebaa780c96883948d1e8616e443a732a2d4e8ee05176bb78766` |
| `chenyida_erp_site/tests/selfhost-uat-promotion-rollback-fixed-executor.test.mjs` | `943f51b319f62ce487214de8bd8ba241e29dcf044e600abc2bcc88ecc19c1c54` |
