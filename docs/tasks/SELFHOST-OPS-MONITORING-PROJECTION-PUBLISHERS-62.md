# SELFHOST-OPS-MONITORING-PROJECTION-PUBLISHERS-62 权威运行与恢复投影发布闭环

> 状态：`DONE / REPOSITORY AND SYNTHETIC-ISOLATED VERIFIED / RESOURCE STOP LINE ACTIVE / NO HOST OR DATA ACTION / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@222584c03cd016c69daa96013c6420dfcbfc5647` / tree `2286082369969dd6c8b94df2aeb227dbac2f3e72`
> 责任：Codex主智能体唯一写入、测试调度、证据集成和Git提交；项目负责人保留host安装、账号/systemd、网络出口、真实渠道、备份/恢复、UAT/生产和数据专项授权

## 1. 目标

把TASK61只读解析的`components.json`与`backup.json`补成由Release Supervisor和备份恢复权威回执生成的内容寻址、最小去敏、单调且崩溃安全的root投影发布链，使monitor不能依赖调用者手填摘要或把旧release/恢复证据解释为当前健康。任务只实现仓库工具和合成隔离测试，不安装host、不读取真实回执正文或业务数据、不运行真实备份/恢复。

## 2. 验收标准

- [x] 明确release/postdeploy与backup V4权威源集合、最小公开字段、时效、身份和producer bundle边界；未知字段、旧contract、synthetic/legacy或调用者自报摘要失败关闭。
- [x] components投影只从已提交且当前的postdeploy/runtime identity证据派生，绑定deployment、activation、Git/Migration、四服务和发布manifest，不读取API正文、环境、日志、数据库或业务行。
- [x] backup投影只从当前runtime identity匹配的V4 `ACTUAL_OFFHOST + RECOVERY_READY`链派生，绑定policy/RPO、四域、transfer/encryption/schedule/retention、恢复点、过期时间和producer身份；旧代、未来时间或回退拒绝。
- [x] 发布器通过installed Supervisor固定入口、一次性root-only授权和全局release锁运行；输入路径、dev/inode/mode/nlink/owner、摘要和bundle均在授权消费前后重验。
- [x] 投影采用generation、previous SHA、source receipt SHA、canonical JSON、no-clobber临时项、file/directory fsync和原子replace；崩溃、并发、部分发布、替换和回退不伪造新鲜状态。
- [x] producer与TASK61 evaluator watermark闭合，首次必须从generation 1/零前驱启动，后续严格连续；release切换或backup身份漂移不能被旧投影恢复为绿色。
- [x] 合成fake-root/fake-receipt测试覆盖正常发布、过期/未来、错误身份、legacy/synthetic、摘要/路径漂移、崩溃各相位、并发、代次跳跃和重复执行；不连接真实systemd、Docker、数据库、网络、UAT/生产或备份。
- [x] release inventory、monitor/Supervisor bundle和运行手册按实际消费边界同步；适用轻量测试、敏感信息、Markdown/JSON/Python静态及`git diff --check`通过。
- [x] 更新项目总控文档并形成独立提交；任务完成后自动选择下一安全任务。

## 3. 禁止事项

- 不读取或修改`.env`、凭据正文、业务行、日志、真实release/backup回执正文、备份正文、受保护Volume正文或用户未跟踪状态报告。
- 不安装host、创建账号、写systemd、修改网络/防火墙/Swap/Docker daemon，不开放notifier出口或发送通知。
- 不连接UAT/生产API或数据库，不执行Migration、backup、restore、build、deploy、restart、外部push或数据写。
- 不以合成receipt、手填JSON、旧runtime identity或legacy/synthetic恢复证据生成“当前健康”投影。

## 4. 起点事实

- TASK61已形成source`b057f81`→monitor manifest-only`3327be4`→Supervisor manifest-only`222584c`链；27文件monitor manifest为`6782ec58…aea07`，105文件Supervisor manifest为`56157a68…efcb`。
- TASK61已有严格components/backup投影解析、future-time/回退拒绝和evaluator watermark，但仓库尚无从权威postdeploy/V4 recovery receipt生成root投影的producer，缺失时会如实`NOT_COLLECTED`。
- notifier默认`IPAddressDeny=any`且真实出口另需仓库合同与专项授权；本任务不扩大到网络策略。
- UAT仍alpha.42/0040、共享superuser和环境秘密；当前无源码匹配镜像、installed Supervisor、真实异机恢复、host monitor或A1—A8授权。Swap仍超过80%停止线，只运行轻量源码/fixture。

## 5. 实施结果

- 新增`projection-publisher.mjs`，由Release Supervisor专用的`PUBLISH_MONITORING_COMPONENTS_PROJECTION`与`PUBLISH_MONITORING_BACKUP_PROJECTION`入口调用。两项操作不能退化到通用命令执行器，必须在既有全局release FLOCK内消费V2一次性授权。
- production固定源为`/var/lib/chenyida-erp/monitoring-v1/active.json`、`/etc/chenyida-erp/monitoring-v1/private/host-config.json`、`/var/lib/chenyida-erp/release-identity/release-identity.json`及`/var/lib/chenyida-erp/postdeploy/<run-id>/<run-id>.postdeploy-receipt.json`；backup另固定`/var/lib/chenyida-erp/backup-status/recovery-readiness.json`与`/etc/chenyida-erp/recovery/postgresql-cluster-recovery-policy.json`。任意替代路径或不可信祖先均拒绝。
- components链同时固定当前monitor activation、private host config、current release identity和canonical postdeploy receipt，并重新构造release identity；四服务严格回执、deployment、Git、Migration、镜像和producer任一不一致均拒绝。
- backup默认链只接受未过期、当前identity一致的V4 `ACTUAL_OFFHOST + RECOVERY_READY`，并固定readiness/policy/RPO。现有D-132集群恢复策略为V1，V4按设计返回`READINESS_V4_LEGACY_POLICY_ACTUAL_FORBIDDEN`；因此仓库没有把legacy证据伪装为实际可恢复。该真实正向路径转交TASK63升级集群恢复策略合同。
- Supervisor在准备Node前、授权消费前和消费后重复验证固定路径及SHA/bytes/dev/inode/uid/gid/mode/nlink；Node发布器再以no-follow方式读取授权中的精确源。投影根使用root/evaluator group边界，marker为`0400`、根及history目录为`0750`、投影为`0440`。
- `components`和`backup`分别维护从generation 1/零前驱开始的完整不可变history、previous SHA、source receipt SHA和精确current alias。发布使用canonical JSON、确定性临时项、file/directory fsync及原子rename；只恢复可证明与同一候选完全一致且未被引用的崩溃点，未知/漂移/回退/跳代失败关闭。

## 6. 不可变提交与验证证据

- 源码提交：`0e38ac2e286abf4f9b95b46258448df5f9bc67cd` / tree `f48b5b08c043119db56421562490db8f5a8dda25`。
- monitor manifest-only提交：`9d0eeb7b3f67855c8e2af57c3296a5c9b9b57a2f` / tree `8585afce3631f5a0cffe93186f1e175d3f27642b`；27文件manifest SHA-256为`d1b0239f9640f72d728816dd6207d61af68ec32c99a027b661b5930dacf98790`。
- Supervisor manifest-only提交：`672a0695b761a50093c15401cf8d9e39951ced36` / tree `2d5b30bf72a5b1b08ad9ccdb35cf16008c376e76`；113文件manifest SHA-256为`9d653c63908db6896d26761a3e2df2a1e725e5e2d9359bb3bf62331dd35196f1`。两个manifest均由生成器逐字节重放一致。
- Python专项回归`28/28`、断网只读受限Node投影测试`6/6`、release gate contract`20/20`通过；release inventory为`250 total / 226 required / 24 not_applicable`。JSON、Python静态、敏感模式和`git diff --check`通过。
- Node测试容器始终串行、最多一个，固定镜像摘要、`--network none`、只读rootfs、256MiB memory/swap、0.5 CPU和64 PIDs；测试结束无残留容器。首次fixture因最小capability下改写`0440`测试文件得到预期的`EACCES`，修复测试辅助函数后完整重跑通过，产品断言未降低。

## 7. 资源、安全与运行面

- 重任务停止线全程有效：available约1.9—2.0GiB，Swap约870—871MiB/1GiB且超过80%，根盘可用13GiB，Load低于1，`oom_kill=0`；没有build、全量Node/PostgreSQL、Docker数据库、typecheck或镜像任务。
- UAT保持Web alpha.42、PostgreSQL 0040；四容器restart 0/OOM false，Web/PostgreSQL healthy、Worker/Caddy health none。没有读取`.env`、日志、业务行、真实回执、备份或受保护Volume正文，也没有安装host、写systemd、开放网络、发送通知、执行备份恢复、Migration或部署。
- 工作区中项目负责人既有未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`继续不读、不改、不提交。

## 8. 最终判定

`DONE / REPOSITORY AND SYNTHETIC-ISOLATED VERIFIED / HOST NOT INSTALLED / ACTUAL BACKUP BLOCKED BY LEGACY CLUSTER POLICY / RESOURCE STOP LINE ACTIVE / PRODUCTION NO-GO`。TASK62关闭了仓库级权威投影发布缺口，但没有产生真实host投影或真实恢复证据；系统仍不能供真实员工使用。下一安全任务为集群恢复策略V2，使V4实际恢复证据拥有严格、可迁移且不复用legacy的政策合同。
