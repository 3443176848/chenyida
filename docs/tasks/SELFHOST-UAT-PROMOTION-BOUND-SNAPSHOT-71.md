# SELFHOST-UAT-PROMOTION-BOUND-SNAPSHOT-71 UAT晋升绑定可恢复快照适配器

> 状态：`DONE / PROMOTION-BOUND ACTUAL-OFFHOST SNAPSHOT ADAPTER VERIFIED / REAL BACKUP AND WRITER ACTION NOT EXECUTED / RESOURCE STOP LINE ACTIVE / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@a3fbbfd01987388be919fdaa0ca506d170e93197` / tree `5e275be8854f6752a776ceeb3c80d39797c7b196`
> 责任：Codex主智能体唯一写入、轻量测试串行、证据集成和Git提交；项目负责人保留真实writer停止、备份/异机传输/恢复、数据库、凭据、host、UAT/生产及部署专项授权

## 1. 背景与目标

TASK69/D-145已建立内容寻址promotion intent/history/receipt/current、Supervisor v6一次性BEGIN/RECOVER和保全式恢复，机器审计由5项SUPPORTED/10项阻断收敛为6项SUPPORTED/9项阻断。下一P0为`PROMOTION_BOUND_RECOVERABLE_SNAPSHOT`：现有V4 recovery-readiness可作为BEGIN前置恢复能力证明，但还没有一次性操作把本次promotion、精确数据库、PostgreSQL/uploads/attachments/backup_status四域、实际异机对象及新鲜恢复回执追加为checkpoint 5。

本任务只实现仓库内受控snapshot adapter、回执发布和恢复合同，不执行真实备份、writer停止、异机传输或恢复。若实际`backup-selfhost.sh`证明必须先停写，则先以代码事实记录checkpoint依赖调整，不得用旧readiness、合成摘要或文档声明绕过。

## 2. 验收标准

- [x] 完整核对backup/transfer/readiness入口、writer停止前置、四域对象、V4 actual-offhost与恢复证据，明确checkpoint 5与writer-quiesce的真实依赖；D-146保持检查点顺序并同步机器policy。
- [x] `CAPTURE_UAT_PROMOTION_SNAPSHOT`使用新的短时一次性Supervisor授权，精确绑定当前ordinal-4回执、intent、候选、数据库、原恢复基线、四域、目标policy/identity和时间窗；授权消费前持久化操作intent。
- [x] adapter只接受由受控backup入口在本次操作窗口产生、内容寻址且root-published的输出；旧V4 readiness、TEST-only restore、同机伪异机、未知/partial或跨数据库证据均失败关闭。
- [x] checkpoint 5回执写入非零`promotion_snapshot_binding_sha256`，绑定PostgreSQL/uploads/attachments/backup_status四域对象与恢复验证证据，并通过history/receipt/current原子发布；不得覆盖前代或跳过事务链。
- [x] 崩溃恢复使用新的恢复授权绑定原已消费授权与snapshot intent；可证明partial收敛，不一致对象保全并quarantine，不删除备份、外部对象或业务数据。
- [x] fake-root、断网、无数据库测试覆盖重放、旧证据、跨promotion/数据库、四域缺失、source替换、hardlink/symlink、消费边界、各发布崩溃点和quarantine；未伪造真实备份或恢复PASS。
- [x] 机器审计只在完整执行路径和负向门存在时把`PROMOTION_BOUND_RECOVERABLE_SNAPSHOT`转为SUPPORTED；其余adapter继续NOT_IMPLEMENTED，`assert-ready`仍拒绝。
- [x] 更新MASTER、TASKS、PROJECT_CONTEXT、CHANGELOG、STATUS、DECISIONS和投产授权包；通过适用测试、资源/敏感/diff检查后形成独立source→monitor→Supervisor提交链并自动进入TASK72。

## 3. 禁止事项

- 不连接UAT/生产数据库，不读取业务行、日志、`.env`、备份、外部对象或Volume正文，不执行backup、restore、Migration、Compose、镜像、部署、回滚或API写。
- 不停止真实writer，不安装host Supervisor，不修改账号、凭据、systemd、网络、Swap、Docker daemon或持久卷。
- 不把BEGIN已绑定的旧恢复readiness重命名为promotion snapshot，不把fake-root或合成receipt描述为真实异机备份/恢复。

## 4. 起点与当前判定

- TASK69最终source`175873a`→monitor`c2d9944`→Supervisor`a3fbbfd`形成30/128文件链；事务专项7/7、审计8/8、release57/57、Supervisor108/108及inventory257/233/24通过。
- 当前审计artifact self SHA-256为`353abf12…5a67`，结论6项SUPPORTED、9项阻断（P0=8、P1=1）；`PROMOTION_BOUND_RECOVERABLE_SNAPSHOT`仍为PARTIAL。
- available约1.9GiB、Swap867MiB/1GiB、根盘13GiB、Load低，四服务restart0/OOM false。Swap超过80%，本任务只允许仓库静态、Python与受限Node轻量验证；TASK70保持BLOCKED。

## 5. 实际依赖结论

- `backup-selfhost.sh`在采集前、采集中和采集后都要求精确Compose Web/Worker处于stopped，且拒绝替代writer；它生成PostgreSQL dump及uploads、attachments、backup-status三个文件域，释放数据库fence但不重启writer。
- 因此不调整15检查点顺序。checkpoint 5只接受V4 actual-offhost恢复链中已经包含的`EXACT_COMPOSE_WEB_WORKER_STOPPED`采集证明；它不负责停止writer。checkpoint 6必须另以一次性授权证明同一Web/Worker从快照采集后持续停止、没有替代writer且执行责任已接续，才能进入Migration授权。
- 该结论写入D-146和`uat-promotion-transaction-policy-v1.json`。仓库能力不能证明当前UAT已经停写，也不能替代未来真实备份和隔离恢复授权。

## 6. 实现与失败关闭

- Supervisor authorization v6新增`CAPTURE_UAT_PROMOTION_SNAPSHOT`，使用与promotion ID不同的短时一次性operation ID、三方互异actor和精确参数集合；launcher在prepare前、授权消费前及消费后复核current/runtime/V4 readiness/policy/activation的path、SHA、bytes、dev/inode、owner、mode和单硬链接。
- journal新增snapshot intent合同及checkpoint 5发布器。生产路径调用完整V4、V2 policy及activation validator，只接受同一UAT deployment/database/runtime/candidate、`ACTUAL_OFFHOST + RECOVERY_READY`、已激活policy、内容寻址history readiness、四域对象及本次授权窗口内的新备份/恢复证据。
- snapshot binding覆盖四域文件名、SHA、bytes、entries，inner restore、joint transfer、cluster security、credential、tablespace、final state和policy activation回执；history→receipt→current逐级fsync且无覆盖发布。
- recovery/quarantine合同升级为v2并兼容BEGIN和CAPTURE。新恢复授权精确引用原已消费授权和原snapshot intent；三个发布崩溃点可证明收敛，source替换、冲突、hardlink/symlink或未知状态保全并隔离。
- 机器审计现为7项SUPPORTED、8项阻断（P0=7、P1=1），三个必需Supervisor操作已实现；`assert-ready`继续返回`UAT_PROMOTION_EXECUTOR_NOT_READY`。

## 7. 验证、资源与偏差

- 受限断网Node专项62/62通过：cross-role 9、Dashboard/V4 10、cluster transfer 4、release gate 20、promotion audit 8、transaction journal 11；monitor delivery另15/15通过。
- Python Supervisor完整110/110通过；monitor delivery专项14/14通过。release inventory为257/233/24，cross-role contract为4链/32步骤，audit artifact self SHA-256为`a7004c2e…1eae9`且保持BLOCKED。
- 生成器第一次只挂载Site目录时以`UNSAFE_REPOSITORY_PATH`失败关闭，改为保持仓库根布局的受限容器后逐字节生成/验证通过；未降低校验。凭据扫描第一次因固定Node镜像没有Git而返回`git ls-files failed`，随后由宿主Git生成排除受保护未跟踪路径的排序显式清单，在同一断网只读容器中扫描1742个文件通过；临时清单精确清理。只读`docker compose ps`因未读取`.env`且缺必需插值变量而退出1，改用精确`docker inspect`确认四服务running、restart0、OOM false，没有修改Compose或环境。
- 起点/收口available约1.9GiB，Swap约867→868MiB/1GiB，根盘13GiB，Load低于1；Swap持续超过80%硬停线。仅运行192MiB、0.5 CPU、无网络、只读或精确写挂载的单个Node临时容器和轻量Python；没有build、全量Node/PostgreSQL、Docker数据库、typecheck、Migration、镜像或Compose动作，临时容器自动清理。

## 8. 不可变提交链与剩余风险

- source：`e8dea203547788d3cb1159adc892c1f84917457b` / tree `8c29bc22e328886773bbbe7f9689e1c55a8938c6`；journal SHA-256 `2152e30e…a6ac4`。
- monitor manifest-only：`7c645ab669cf37219e30623f7b4f0dbbd01d3ad7` / tree `8861d4445e9abd4cfe9a58f3aa3fe463257c750e`；30文件manifest SHA-256 `5c0ccda1…b27b`。
- Supervisor manifest-only：`bc339b6b1533acdd1123cebea818bc3302332440` / tree `f7fd37bd3a79d9f99ecbfc7b3151e13291710c7c`；128文件manifest SHA-256 `5889e746…cabe`，launcher SHA-256 `b2154d44…ab32`。
- 该链只证明仓库和fake-root适配器。真实异机四域快照、当前数据隔离恢复、writer停写、源码匹配镜像、正式19步门、Migration/deploy、业务批准、人工UAT和员工试运行均不存在；系统继续`PRODUCTION NO-GO`。下一P0为TASK72 `WRITER_QUIESCE_RECEIPT`，TASK70保持资源与执行器双重阻塞。
