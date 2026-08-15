# SELFHOST-UAT-PROMOTION-TRANSACTION-JOURNAL-69 UAT晋升事务日志与恢复基座

> 状态：`DONE / DURABLE TRANSACTION JOURNAL VERIFIED / BEGIN+RECOVER FAIL-CLOSED / REAL ADAPTERS NOT EXECUTED / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@1c70602282902c79066452d14fd836f868e94efb` / tree `46ec0e9a827b11d6d5d346b87f2eafab9f53ea96`
> 责任：Codex主智能体唯一写入、轻量测试调度、证据集成和Git提交；项目负责人保留host、账号、systemd、网络、凭据、备份恢复、UAT/生产、数据、Migration、部署与回滚专项授权

## 1. 背景与目标

TASK68/D-144以15文件源码摘要证明：候选、ELIGIBLE manifest、预部署稳定性、postdeploy配置和identity已有合同，但晋升意图/耐久日志、晋升绑定快照、writer quiesce、一次性Migration、Migration/Compose回执、终态、UAT回滚及回退后核验仍有10个阻断点。当前审计artifact明确返回`UAT_PROMOTION_EXECUTOR_NOT_READY`，不得靠root手工命令绕过。

本任务只关闭最先决的`PROMOTION_INTENT_AND_DURABLE_JOURNAL`控制面：建立内容寻址、单调、崩溃可恢复的UAT晋升事务记录和一次性开始/恢复入口，使后续快照、quiesce、Migration、部署、postdeploy、UAT与回滚适配器只能向同一事务追加受约束回执。任务不执行任何真实步骤，也不把“日志可用”描述为“晋升执行器已就绪”。

## 2. 验收标准

- [x] 版本化policy固定UAT deployment、候选commit/tree/version、ELIGIBLE manifest、Web/Worker完整digest引用、Migration head/manifest、当前runtime identity、升级前恢复证据、授权时间窗、三方actor及15检查点顺序；字段缺失、跨代或摘要漂移失败关闭。
- [x] 状态根采用可信祖先、固定marker、root-only metadata、no-follow、单硬链接、canonical JSON、无覆盖内容发布和file/directory fsync；测试只能使用显式fake-root，正式默认路径不可由普通环境变量改写。
- [x] `BEGIN_UAT_PROMOTION`以新一次性Supervisor授权先持久化完整intent、再消费授权、再发布generation/history/receipt/current；相同intent可幂等收敛，不同intent或复用ID拒绝。
- [x] checkpoint只能按政策单调推进并绑定上一回执；未知/partial不允许后续步骤或整体成功，不覆盖前代证据，不允许跳步、跨候选、跨数据库、跨快照或跨授权复用。
- [x] `RECOVER_UAT_PROMOTION`使用新的恢复授权绑定原已消费授权和原intent；可证明partial继续，不一致对象只保全并形成quarantine/recovery证据，不递归删除或猜测终态。
- [x] 在本任务范围内，所有backup/quiesce/Migration/Compose/postdeploy/UAT/rollback适配器保持`NOT_IMPLEMENTED`，`assert-ready`继续以`UAT_PROMOTION_EXECUTOR_NOT_READY`拒绝；后续任务必须逐项关闭。
- [x] 增加fake-root、断网、无数据库的正负向测试并纳入release inventory/runtime policy；覆盖重放、冲突、跳步、断链、替换、hardlink/symlink、崩溃点、恢复和quarantine。
- [x] 更新MASTER、TASKS、PROJECT_CONTEXT、CHANGELOG、STATUS、DECISIONS和投产授权包；通过适用测试、敏感信息及diff检查后创建独立提交并自动进入下一项。

## 3. 禁止事项

- 不安装host Supervisor，不创建或修改真实状态根、authorization、账号、systemd、网络、凭据或外部目标。
- 不连接UAT/生产数据库，不读取业务行、日志、`.env`、备份或Volume正文，不执行Backup、Restore、Migration、Compose、镜像、部署、回滚或业务写。
- 不把fake-root、合成receipt、静态门或新增Supervisor操作描述为A6授权、真实快照、真实恢复或人工UAT已通过。
- 不修改既有Migration，不用down SQL、删表、改账或直接SQL清理代替环境级快照恢复与业务冲销。

## 4. 起点与当前判定

- TASK68最终source`79e4e80412fc1d2ba7a4ae19e9902f98313594e7`→monitor`84a2c78e3e664033ce1bd08d6e30de49418e0025`→Supervisor`1c70602282902c79066452d14fd836f868e94efb`形成30/126文件链；manifest SHA-256为`9c1e9052…5ac39`/`56009eb7…12b5`。
- TASK68 artifact SHA-256为`c0a5a5619835bf82d478494ed63d2e2d68c54542634495aae93986090ad6f24d`，结论为5项SUPPORTED、10项阻断（P0=9、P1=1），当前19个Supervisor操作中7个晋升/回滚操作均缺失。
- 资源仍为available约1.9GiB、Swap865MiB/1GiB、根盘13GiB、Load低；Swap超过80%，仅执行仓库静态、Python和受限单容器Node轻量测试。动态Compose/PostgreSQL验收已拆为TASK70并保持`BLOCKED`。

## 5. 完成结果

- 新增固定policy与`uat-promotion-transaction-journal.mjs`：正式状态根为`/var/lib/chenyida-erp/uat-promotion-transactions-v1`，intent先于授权消费持久化，generation/history/receipt为内容寻址无覆盖对象，`current`只作原子指针；文件及目录逐级fsync，root-only、marker、no-follow、单硬链接和可信祖先均失败关闭。
- Supervisor新增v6一次性授权与`BEGIN_UAT_PROMOTION`/`RECOVER_UAT_PROMOTION`，授权窗口最多60分钟且请求、批准、执行三方摘要必须互异。恢复授权精确绑定原已消费授权与原intent；可证明的发布partial收敛，不一致、替换、hardlink/symlink或过期状态只写recovery/quarantine证据并保留原文件。
- 每个checkpoint回执绑定intent、候选、数据库、runtime、恢复证据和promotion snapshot；完整授权摘要链强制唯一，隔步复用、跳步、UNKNOWN/PARTIAL继续、跨候选/数据库/快照或断链均拒绝。
- 机器审计现为6项`SUPPORTED`、9项阻断（P0=8、P1=1）；artifact/self SHA-256为`353abf12ff2779eeed984574eb07b39379f05eb5897a618a1dad6b04f2ce5a67`，source manifest SHA-256为`68fd118d005d00a024cc0a90655c20f069533d81782e56ded763e28e8eda1f91`。所有真实snapshot/quiesce/Migration/Compose/postdeploy/UAT/rollback adapter仍`NOT_IMPLEMENTED`，`assert-ready`继续返回`UAT_PROMOTION_EXECUTOR_NOT_READY`。
- 发布inventory更新为257/233/24（PURE_NODE=130）；事务专项7/7、审计8/8、release合同57/57、Supervisor Python108/108、inventory verify和凭据扫描1,740文件通过。未运行build、Compose/PostgreSQL、Migration、镜像、快照、恢复、部署或业务写。
- 最终canonical链为source`175873ad58fe26af444e54d636722deb2009af3e`/tree`c7bfcfb2089725d1f473ce0c595af387bfcc4ebe`→monitor`c2d994464e208602137fc4e89d7934290a7984e7`/tree`e50b7a505ba5778f8df54b7f4bfa2a820c2b1f90`→Supervisor`a3fbbfd01987388be919fdaa0ca506d170e93197`/tree`5e275be8854f6752a776ceeb3c80d39797c7b196`；30/128文件manifest SHA-256为`292d8aea530b78e26dd7384eeb4188fa7ec1ebc0d38b4948550b79a4428c65b8`/`ff086ff72728c7e7dcf2cbd05b0c8fff3d8d7c291710278809bd2353cc0fa412`。
- 收口资源为available约1.9GiB、Swap867MiB/1GiB、根盘13GiB、Load`0.69/0.37/0.22`；四服务restart0/OOM false，Web/PostgreSQL healthy，Worker/Caddy无health合同，任务临时容器和临时扫描清单均已清理。Swap仍超过80%，停止线不解除。

## 6. 移交

- D-145接受内容寻址事务日志、三方v6授权、完整授权摘要链和保全式恢复；该仓库能力不构成A1、A6或真实UAT授权。
- 下一唯一`DOING`为`SELFHOST-UAT-PROMOTION-BOUND-SNAPSHOT-71`，按审计顺序接入promotion-bound recoverable snapshot；TASK70继续等待执行器完整和资源停止线解除。
