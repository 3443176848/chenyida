# SELFHOST-OPS-POSTGRES-CLUSTER-RECOVERY-POLICY-ACTIVATION-64 PostgreSQL集群恢复策略受控激活

> 状态：`DONE / REPOSITORY AND SYNTHETIC FAKE-ROOT VERIFIED / HOST ACTIVATION NOT EXECUTED / RESOURCE STOP LINE ACTIVE / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@e527fcfe5fa0f779cbe4514ffa82376e1d0f3462` / tree `778b24a550215271bba248ea6367adc8d1b3fb92`
> 责任：Codex主智能体唯一写入、测试调度、证据集成和Git提交；项目负责人保留host安装/激活、真实备份恢复、凭据、账号/ACL、UAT/生产和数据专项授权

## 1. 背景与目标

TASK63/D-139已经建立不能由冻结V1降级替代的V2恢复政策，但仓库中的`REPOSITORY_TEMPLATE`不能手工复制或编辑后成为actual。当前固定host路径没有内容寻址publisher、一次性授权消费、逐代激活、崩溃恢复或替换隔离合同。

本任务只在仓库及合成fake-root中实现installed Release Supervisor控制的政策prepare/activate/rollback/quarantine闭环。它不在真实host创建路径、不发布或激活实际政策、不读取凭据/备份/数据库、不执行恢复，也不修改UAT/生产。

## 2. 验收标准

- [x] 完整审计现有Supervisor一次性授权、固定policy路径、bundle生成及monitor/recovery消费者，记录最小新增operation和信任边界。
- [x] 固定actual policy host路径、私有状态根、可信祖先、root-only/no-follow、canonical JSON、精确dev/inode/uid/gid/mode/nlink/bytes/SHA及内容寻址history/current语义。
- [x] 一次性Supervisor授权绑定V2 template raw/logical SHA、激活字段、current Supervisor bundle、environment、generation、previous active policy、目标路径metadata、operator/approver及授权时效；消费前后重复核验且不能复用。
- [x] prepare→authorization consume→publish按明确durable顺序执行；no-clobber/atomic rename、file/directory fsync、幂等完成已证明partial和崩溃恢复均有合同测试。
- [x] rollback只能指向精确已提交前代；unknown、replaced、断链、旧代、跳代、symlink/hardlink、owner/mode/inode漂移和不一致partial保全现场并quarantine/失败关闭，不自动删除。
- [x] template、V1、synthetic、跨环境、过期/未来、generation跳跃、授权/批准/操作者复用、source/bundle漂移均不能成为actual active policy。
- [x] monitor backup publisher与V4实际恢复只接受同一已提交current activation；手工JSON或只有政策正文没有activation receipt时明确失败关闭。
- [x] 只使用合成fake-root/fake-authorization测试，不连接真实systemd、网络、UAT/生产、数据库、备份或受保护Volume；Docker只运行断网、只读、受限轻量测试容器。
- [x] 适用轻量测试、inventory/manifest重放、敏感信息检查、静态检查和`git diff --check`通过；Swap超过80%期间未启动重任务。
- [x] 更新项目治理文档、运行手册和独立Git提交，完成后自动选择下一安全任务。

## 3. 禁止事项

- 不在`/etc`、`/var/lib`或其他真实host路径安装、激活、回退或隔离政策，不创建/修改账号、权限、systemd、网络、Swap或Docker daemon。
- 不读取`.env`、凭据、日志、业务行、数据库、真实回执/备份、受保护Volume正文或用户未跟踪状态报告。
- 不执行真实backup/restore、PostgreSQL连接、Migration、build、deploy、restart、外部传输或数据写。
- 不修改冻结V1合同/执行器，不允许调用者参数、测试validator、手工文件或自洽重签名替代受控激活证据。

## 4. 起点事实与依赖

- TASK63 source`de993c0326b959f7f7c451504a6ef3a753e09c11`与Supervisor manifest-only`e527fcfe5fa0f779cbe4514ffa82376e1d0f3462`形成117文件canonical链，manifest raw SHA-256为`4c3b801fc2fa33f3f047bc8a40dabf003376c079187a576a5c3108cf7f665582`。
- V2 repository template raw/logical SHA-256为`1a092993b1dda00bd8a2aac0899cb4e1eee83e9b336022bdb72f3e4d23e317aa`/`c30951ad74a827c06e8256cfc124f61bd5672bca9daa7abda21c0896523378b8`；固定host目标为`/etc/chenyida-erp/recovery/postgresql-cluster-recovery-policy.json`，当前未创建或读取。
- installed Supervisor本身尚未获A1授权安装，真实policy激活、恢复目标、凭据、RPO/RTO和责任人批准均不存在；本任务只能建立未来授权执行所需的仓库合同。
- available约2.0GiB、Swap约870MiB/1GiB且超过80%，新的build、全量Node/PostgreSQL、Docker数据库、typecheck和镜像任务均禁止。

## 5. 完成证据

- 源码提交`83d920b1ac017370270452d334e44fa36a6b3978`/tree`83084e980d794a37bfeb835fcbf89e7c5210fee7`实现activation contract/publisher、Supervisor `ACTIVATE/ROLLBACK/RECOVER`、安装切换联锁、V4/monitor committed-current消费及完整负测。
- manifest-only直接子提交`0e2328b58bc68cf09dc6b0638bb5ded82b0cf347`/tree`585b3c8d1d38f695422c5378eaa24691627de932`只修改canonical Supervisor manifest；121文件manifest raw SHA-256为`728f9a5f321c03c4a9b089ca4c3091c04273e6b7427f1df610c6756fa0735db9`，生成器重放逐字节一致。
- 发布顺序固定为durable intent→authorization消费→history→target→receipt→current；每个已提交receipt必须有且只有一个同哈希intent。恢复使用新的单次授权绑定原已消费授权；未过期且可证明partial才能续发，过期partial只允许保全并quarantine。
- 逐代链验证generation、previous policy/receipt、environment、最长24小时、actor分离和rollback target；安装新Supervisor bundle前会复核完整policy/receipt/intent/recovery链并阻断任何partial或quarantine。
- Python Supervisor专项`37/37`通过并启用`ResourceWarning`为错误；正式Debian Node运行时通过Dashboard、monitor、activation及release合同`52/52`，manifest合同`9/9`、cluster transfer`4/4`，inventory为`252/228/24`且逐文件摘要通过。
- 一次误写不存在的本机镜像tag触发只读pull探测并被registry `403`拒绝，没有拉取或创建镜像；一次非root只读fixture因仓库祖先不可遍历而未启动测试；一次Worker BusyBox `flock`缺少GNU `-E`导致环境失败。后续全部固定`--pull never`并在正式Debian Node发布测试镜像复跑通过，未降低断言。
- 收口资源为available约`2.0 GiB`、Swap`861 MiB/1.0 GiB`、根盘`13 GiB`、Load`0.05/0.16/0.16`；四服务restart0/OOM false，Web/PostgreSQL healthy。轻量测试容器自动删除，manifest临时文件精确清理；未创建数据库、网络、Volume或新镜像。

## 6. 最终判定

`DONE / REPOSITORY AND SYNTHETIC FAKE-ROOT VERIFIED / HOST ACTIVATION NOT EXECUTED / PRODUCTION NO-GO`。仓库现在能生成、恢复和消费严格的受控policy activation链，但真实host尚未安装当前Supervisor，也没有实际policy、真实备份目标、恢复结果或RPO/RTO证据。任何host激活、回退、quarantine处理或真实恢复仍须专项明确授权。
