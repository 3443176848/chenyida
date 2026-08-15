# SELFHOST-UAT-POSTDEPLOY-TRANSACTION-76 UAT晋升postdeploy checkpoint 10/11事务化

> 状态：`DONE / REPOSITORY POSTDEPLOY CHECKPOINT 10/11 TRANSACTION VERIFIED / PREPUBLICATION CONTROL BINDING VERIFIED / NO REAL DEPLOYMENT OR DATABASE ACTION / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格代码起点：`main@86be6d4b139e6626067a6a1782a3636d076f058a` / tree `006c230976d8dd985394b59a7b0965f90b2e1a51`
> 责任：Codex主智能体唯一写入、轻量测试串行、证据集成和Git提交；项目负责人保留真实容器、数据库、UAT/生产、凭据、host、账号及部署专项授权

## 1. 背景与目标

TASK75/D-150已完成checkpoint 9仓库适配器，并把checkpoint 8 active migration fence以内容寻址transfer交给精确Compose部署结果。机器审计把既有`postdeploy-runtime-configuration-probe`和`postdeploy-release-verifier`静态来源分别视为checkpoint 10/11 SUPPORTED，但promotion journal当前只能由Supervisor推进至checkpoint 9；两个独立工具的成功回执尚未绑定同一promotion、checkpoint 9 receipt、deployment result/fence transfer及逐检查点授权链。

本任务先把checkpoint 10 `POST_DEPLOY_RUNTIME_CONFIGURATION`与checkpoint 11 `POST_DEPLOY_IDENTITY`纳入同一promotion transaction和保全恢复，作为checkpoint 13 final receipt的必要前置。人工跨岗UAT、最终提交、rollback、真实Compose/PostgreSQL及动态TASK70均不在本任务执行范围。

## 2. 验收标准

- [x] 完整核对现有postdeploy probe、严格四服务runtime验证、identity发布、checkpoint 9 result/transfer、active fence interlock及失败后containment责任，记录不可复用与需扩展边界。
- [x] checkpoint 10和11各使用不同的短时一次性Supervisor授权；intent必须先于消费落盘，并精确绑定同一promotion、ordinal前代、checkpoint 9 receipt、deployment result/fence transfer、release manifest、Compose project/working directory、四服务身份、runtime policy及三方actor。
- [x] checkpoint 10只接受新部署之后生成、未过期、root-owned、单硬链接、内容寻址的runtime configuration probe receipt；旧probe、predeploy runtime、路径名、operator声明或单次health不得形成回执。
- [x] checkpoint 11只接受与checkpoint 10、manifest和checkpoint 9完全一致的postdeploy receipt及发布后runtime identity；identity必须复核Web/Worker digest、四服务runtime policy、Migration head、deployment、runtime configuration和不可变证据。
- [x] 两个检查点均按history→receipt→current发布，保持既有snapshot/quiesce/migration/deployment binding与不同authorization SHA链；checkpoint 11完成后journal仍为IN_PROGRESS，不得越过未执行的人工cross-role checkpoint 12。
- [x] 未消费、已消费未运行、probe/identity已落盘但journal未发布、source替换、过期、hardlink/symlink、跨promotion、跨deployment、runtime漂移及三个发布崩溃点均有确定恢复或quarantine；未知结果不得伪造成功。
- [x] 失败路径继续保全checkpoint 9 deployment/result/transfer和事故证据，并调用精确、受测的containment边界；不得猜测回滚、删除容器、释放/改写数据库状态或覆盖postdeploy证据。
- [x] fake-root/断网测试覆盖正向、重放、授权复用、所有绑定漂移、发布崩溃、恢复和quarantine；现有postdeploy、promotion、launcher、installer、audit及inventory适用回归通过。
- [x] 机器审计继续`BLOCKED`，不得因checkpoint 10/11事务化而把人工UAT、final receipt或rollback标为完成；`assert-ready`仍拒绝。
- [x] 更新MASTER、TASKS、CHANGELOG、STATUS、DECISIONS、当前任务文档和投产授权包，完成资源/敏感/diff检查并形成独立source→manifest提交链；随后自动选择下一未阻塞任务。

## 3. 禁止事项

- 不运行真实Docker/Compose、pull/build/recreate/start/stop，不连接数据库或读取/修改active fence，不访问env、日志、Volume、备份或业务数据。
- 不把现有静态审计`SUPPORTED`、checkpoint 9 fake result、旧postdeploy receipt或runtime identity单独当作promotion checkpoint 10/11 actual证据。
- 不实现或执行人工跨岗UAT、final receipt、rollback，不触碰账号、systemd、网络、防火墙、Swap、Docker daemon、UAT/生产或四个受保护Volume。

## 4. 起点与资源判定

- TASK75最终source`d383c10`→cap fix`c6c4864`→Supervisor manifest-only`86be6d4`形成132文件bundle`249d28fe…3071`；机器审计11项SUPPORTED、4项阻断（P0=3、P1=1），`assert-ready`继续拒绝。
- 当前UAT仍为alpha.42/0040；源码匹配Web/Worker镜像、actual checkpoint 8/9、postdeploy回执和真实恢复证据均不存在，本任务不得调用当前运行面。
- available约1.9GiB、Swap881MiB/1GiB、根盘约13GiB，Swap超过80%。只允许仓库静态、Python和受限Node轻量验证；TASK70继续`BLOCKED / RESOURCE STOP LINE + EXECUTOR DEPENDENCIES`。

## 5. 实施与不可变证据

- Supervisor v6新增`VERIFY_UAT_POSTDEPLOY_RUNTIME_CONFIGURATION`与`VERIFY_UAT_POSTDEPLOY_IDENTITY`两个互不复用的授权操作。两个intent均在授权消费前落盘，并把checkpoint 9 receipt、deployment result、active-fence transfer、eligible manifest、四服务身份、runtime policy、Compose身份和三方actor绑定到同一promotion。
- postdeploy工具统一由Supervisor持有的受信Node runtime执行；shell包装器不再选择任意宿主runtime。子进程位于独立process group，退出按TERM→最多30秒→KILL收敛；失败写入阶段化containment/anomaly并保持全局interlock。
- checkpoint 10/11各自按history→receipt→current无覆盖发布，checkpoint 11完成后仍为`IN_PROGRESS`。旧结果、过期结果、source或binding漂移、hardlink/symlink、未知partial、跨promotion及跨deployment均失败关闭或quarantine。
- 修正了“外部result SHA只在结果发布后才交叉核对”的窗口：只有原始postdeploy execute可接收Supervisor传入的外部control digest；journal必须先把单一、不可变、自摘要的`postdeploy-control-bindings`持久化并复核，再允许任何history/receipt/current发布。缺失、不匹配、重复或不同binding均失败关闭，恢复只接受同一精确binding。
- runtime identity的`.publish.tmp`被明确归类为partial；checkpoint 9 result/transfer和既有事故证据在所有失败路径中保全。最终只读复核未发现仍可复现的P0/P1/P2，历史5项问题全部闭合。

## 6. 验证结果

- promotion journal专项40/40；Python launcher与UAT专项37/37；postdeploy runtime probe与release identity专项17/17。
- promotion audit与cross-role生成物18/18；release gate与manifest合同29/29；installer/generator 18/18。
- release inventory为258项，其中234项REQUIRED、24项NOT_APPLICABLE；bundle、audit、cross-role、inventory与runtime policy均逐字节重放且0 mismatch。
- Python compile、Node语法、shell语法、`git diff --check`和高置信凭据扫描通过。未降低断言、未跳过适用轻量测试。
- 机器审计仍为`BLOCKED`：11项SUPPORTED、4项阻断，剩余为checkpoint 12人工跨岗UAT、checkpoint 13 final receipt及rollback 14/15；`assert-ready`继续拒绝。

## 7. 提交链、资源与结论

- feature source：`8c7d51c09b058d66ebd509338f8f325d6ed7fb73` / tree `49ac3a2cc347dc92690f1c3d4f6ca48c0e48f10e`。
- prepublication binding修正：`2309927b9354a1449fb298119df6611574668cab` / tree `ddae09547b1740c313bf9de6eee96b6d731297a1`。
- Supervisor manifest-only：`694f485cad3a6e9fbdc499c10cc801f0de77cafe` / tree `45007b67fb606bd423043d769efefd12acc67ab7`；134文件bundle raw SHA-256为`ccb0e462d354011383db35ff32dee752b27b9b3e49de512f1f1c9e5127fab03d`，launcher SHA-256为`0ad45eb10893f1f857ffc842f99680f2f1a09d81736ef6b6a1611b0760731f84`。
- 起点available约1.8—1.9GiB、Swap约887MiB/1GiB；收口available约1.9GiB、Swap889MiB/1GiB、根盘约13GiB、Load`2.76/1.38/0.73`。四服务restart0/OOM false；未出现本任务可归因的新OOM或反复重启。
- Swap持续超过80%，因此未运行build、全量测试、Compose/PostgreSQL、Migration、backup/restore、镜像、部署或回滚。任务专用临时Node目录已按精确路径清理；四个受保护Volume未触碰。
- 收口只读资源复核显示available约1.9GiB、Swap888MiB/1GiB、根盘13GiB、Load`0.13/0.30/0.45`，四服务restart0/OOM false。显式`--env-file /dev/null`的`docker compose ps`在解析阶段因缺少必填`ERP_DEPLOYMENT_CLASS`失败关闭；未读取`.env`、未绕过配置门且无运行面变化。
- 结论：checkpoint 10/11仓库事务闭环完成，但不代表actual postdeploy或UAT已执行。系统仍为`PRODUCTION NO-GO`；下一安全任务是把checkpoint 12跨岗验收证据接入同一promotion事务，真实员工执行和签字继续需要专项授权与业务输入。
