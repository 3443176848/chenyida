# SELFHOST-OPS-MONITORING-PROJECTION-PUBLISHERS-62 权威运行与恢复投影发布闭环

> 状态：`DOING / READ-ONLY AUDIT AND LIGHTWEIGHT DESIGN / RESOURCE STOP LINE ACTIVE / NO HOST OR DATA ACTION / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@222584c03cd016c69daa96013c6420dfcbfc5647` / tree `2286082369969dd6c8b94df2aeb227dbac2f3e72`
> 责任：Codex主智能体唯一写入、测试调度、证据集成和Git提交；项目负责人保留host安装、账号/systemd、网络出口、真实渠道、备份/恢复、UAT/生产和数据专项授权

## 1. 目标

把TASK61只读解析的`components.json`与`backup.json`补成由Release Supervisor和备份恢复权威回执生成的内容寻址、最小去敏、单调且崩溃安全的root投影发布链，使monitor不能依赖调用者手填摘要或把旧release/恢复证据解释为当前健康。任务只实现仓库工具和合成隔离测试，不安装host、不读取真实回执正文或业务数据、不运行真实备份/恢复。

## 2. 验收标准

- [ ] 明确release/postdeploy与backup V4权威源集合、最小公开字段、时效、身份和producer bundle边界；未知字段、旧contract、synthetic/legacy或调用者自报摘要失败关闭。
- [ ] components投影只从已提交且当前的postdeploy/runtime identity证据派生，绑定deployment、activation、Git/Migration、四服务和发布manifest，不读取API正文、环境、日志、数据库或业务行。
- [ ] backup投影只从当前runtime identity匹配的V4 `ACTUAL_OFFHOST + RECOVERY_READY`链派生，绑定policy/RPO、四域、transfer/encryption/schedule/retention、恢复点、过期时间和producer身份；旧代、未来时间或回退拒绝。
- [ ] 发布器通过installed Supervisor固定入口、一次性root-only授权和全局release锁运行；输入路径、dev/inode/mode/nlink/owner、摘要和bundle均在授权消费前后重验。
- [ ] 投影采用generation、previous SHA、source receipt SHA、canonical JSON、no-clobber临时项、file/directory fsync和原子replace；崩溃、并发、部分发布、替换和回退不伪造新鲜状态。
- [ ] producer与TASK61 evaluator watermark闭合，首次必须从generation 1/零前驱启动，后续严格连续；release切换或backup身份漂移不能被旧投影恢复为绿色。
- [ ] 合成fake-root/fake-receipt测试覆盖正常发布、过期/未来、错误身份、legacy/synthetic、摘要/路径漂移、崩溃各相位、并发、代次跳跃和重复执行；不连接真实systemd、Docker、数据库、网络、UAT/生产或备份。
- [ ] release inventory、monitor/Supervisor bundle和运行手册按实际消费边界同步；适用轻量测试、敏感信息、Markdown/JSON/Python静态及`git diff --check`通过。
- [ ] 更新项目总控文档并形成独立提交；任务完成后自动选择下一安全任务。

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

## 5. 当前判定

`DOING / READ-ONLY AUDIT AND LIGHTWEIGHT DESIGN / RESOURCE STOP LINE ACTIVE / PRODUCTION NO-GO`。本任务只关闭权威投影生产缺口，不构成host、网络、渠道、备份/恢复、UAT/生产或数据授权；系统仍不能供真实员工使用。
