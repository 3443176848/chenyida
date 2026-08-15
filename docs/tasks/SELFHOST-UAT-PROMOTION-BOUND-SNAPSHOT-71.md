# SELFHOST-UAT-PROMOTION-BOUND-SNAPSHOT-71 UAT晋升绑定可恢复快照适配器

> 状态：`DOING / REPOSITORY SNAPSHOT ADAPTER FIRST / RESOURCE STOP LINE ACTIVE / NO BACKUP OR DATABASE ACTION / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@a3fbbfd01987388be919fdaa0ca506d170e93197` / tree `5e275be8854f6752a776ceeb3c80d39797c7b196`
> 责任：Codex主智能体唯一写入、轻量测试串行、证据集成和Git提交；项目负责人保留真实writer停止、备份/异机传输/恢复、数据库、凭据、host、UAT/生产及部署专项授权

## 1. 背景与目标

TASK69/D-145已建立内容寻址promotion intent/history/receipt/current、Supervisor v6一次性BEGIN/RECOVER和保全式恢复，机器审计由5项SUPPORTED/10项阻断收敛为6项SUPPORTED/9项阻断。下一P0为`PROMOTION_BOUND_RECOVERABLE_SNAPSHOT`：现有V4 recovery-readiness可作为BEGIN前置恢复能力证明，但还没有一次性操作把本次promotion、精确数据库、PostgreSQL/uploads/attachments/backup_status四域、实际异机对象及新鲜恢复回执追加为checkpoint 5。

本任务只实现仓库内受控snapshot adapter、回执发布和恢复合同，不执行真实备份、writer停止、异机传输或恢复。若实际`backup-selfhost.sh`证明必须先停写，则先以代码事实记录checkpoint依赖调整，不得用旧readiness、合成摘要或文档声明绕过。

## 2. 验收标准

- [ ] 完整核对backup/transfer/readiness入口、writer停止前置、四域对象、V4 actual-offhost与恢复证据，明确checkpoint 5与writer-quiesce的真实依赖；需要调整顺序时新增ADR并同步机器policy。
- [ ] `CAPTURE_UAT_PROMOTION_SNAPSHOT`使用新的短时一次性Supervisor授权，精确绑定当前ordinal-4回执、intent、候选、数据库、原恢复基线、四域、目标policy/identity和时间窗；授权消费前必须持久化操作intent。
- [ ] adapter只接受由受控backup入口在本次操作窗口产生、内容寻址且root-published的输出；旧V4 readiness、TEST-only restore、同机伪异机、未知/partial或跨数据库证据不得成为checkpoint成功。
- [ ] checkpoint 5回执写入非零`promotion_snapshot_binding_sha256`，绑定实际PostgreSQL/uploads/attachments/backup_status对象与恢复验证证据，并通过history/receipt/current原子发布；不得覆盖前代或跳过事务链。
- [ ] 崩溃恢复使用新的恢复授权绑定原已消费授权与snapshot intent；可证明partial收敛，不一致对象保全并quarantine，不删除备份、外部对象或业务数据。
- [ ] fake-root、断网、无数据库测试覆盖重放、旧证据、跨promotion/数据库、四域缺失、source替换、hardlink/symlink、消费边界、各发布崩溃点和quarantine；不伪造真实备份或恢复PASS。
- [ ] 机器审计只能在完整执行路径和负向门存在时把`PROMOTION_BOUND_RECOVERABLE_SNAPSHOT`转为SUPPORTED；其余adapter继续NOT_IMPLEMENTED，`assert-ready`仍拒绝。
- [ ] 更新MASTER、TASKS、PROJECT_CONTEXT、CHANGELOG、STATUS、DECISIONS和投产授权包；通过适用测试、资源/敏感/diff检查后形成独立source→manifest提交链并自动进入下一未阻塞任务。

## 3. 禁止事项

- 不连接UAT/生产数据库，不读取业务行、日志、`.env`、备份、外部对象或Volume正文，不执行backup、restore、Migration、Compose、镜像、部署、回滚或API写。
- 不停止真实writer，不安装host Supervisor，不修改账号、凭据、systemd、网络、Swap、Docker daemon或持久卷。
- 不把BEGIN已绑定的旧恢复readiness重命名为promotion snapshot，不把fake-root或合成receipt描述为真实异机备份/恢复。

## 4. 起点与当前判定

- TASK69最终source`175873a`→monitor`c2d9944`→Supervisor`a3fbbfd`形成30/128文件链；事务专项7/7、审计8/8、release57/57、Supervisor108/108及inventory257/233/24通过。
- 当前审计artifact self SHA-256为`353abf12…5a67`，结论6项SUPPORTED、9项阻断（P0=8、P1=1）；`PROMOTION_BOUND_RECOVERABLE_SNAPSHOT`仍为PARTIAL。
- available约1.9GiB、Swap867MiB/1GiB、根盘13GiB、Load低，四服务restart0/OOM false。Swap超过80%，本任务只允许仓库静态、Python与受限Node轻量验证；TASK70保持BLOCKED。
