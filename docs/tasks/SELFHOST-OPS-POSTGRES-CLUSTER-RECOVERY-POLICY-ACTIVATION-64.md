# SELFHOST-OPS-POSTGRES-CLUSTER-RECOVERY-POLICY-ACTIVATION-64 PostgreSQL集群恢复策略受控激活

> 状态：`DOING / READ-ONLY AUDIT AND LIGHTWEIGHT REPOSITORY IMPLEMENTATION / RESOURCE STOP LINE ACTIVE / NO HOST OR DATA ACTION / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@e527fcfe5fa0f779cbe4514ffa82376e1d0f3462` / tree `778b24a550215271bba248ea6367adc8d1b3fb92`
> 责任：Codex主智能体唯一写入、测试调度、证据集成和Git提交；项目负责人保留host安装/激活、真实备份恢复、凭据、账号/ACL、UAT/生产和数据专项授权

## 1. 背景与目标

TASK63/D-139已经建立不能由冻结V1降级替代的V2恢复政策，但仓库中的`REPOSITORY_TEMPLATE`不能手工复制或编辑后成为actual。当前固定host路径没有内容寻址publisher、一次性授权消费、逐代激活、崩溃恢复或替换隔离合同。

本任务只在仓库及合成fake-root中实现installed Release Supervisor控制的政策prepare/activate/rollback/quarantine闭环。它不在真实host创建路径、不发布或激活实际政策、不读取凭据/备份/数据库、不执行恢复，也不修改UAT/生产。

## 2. 验收标准

- [ ] 完整审计现有Supervisor一次性授权、固定policy路径、bundle生成及monitor/recovery消费者，记录最小新增operation和信任边界。
- [ ] 固定actual policy host路径、私有状态根、可信祖先、root-only/no-follow、canonical JSON、精确dev/inode/uid/gid/mode/nlink/bytes/SHA及内容寻址history/current语义。
- [ ] 一次性Supervisor授权绑定V2 template raw/logical SHA、激活字段、current Supervisor bundle、environment、generation、previous active policy、目标路径metadata、operator/approver及授权时效；消费前后重复核验且不能复用。
- [ ] prepare→authorization consume→publish按明确durable顺序执行；no-clobber/atomic rename、file/directory fsync、幂等完成已证明partial和崩溃恢复均有合同测试。
- [ ] rollback只能指向精确已提交前代；unknown、replaced、断链、旧代、跳代、symlink/hardlink、owner/mode/inode漂移和不一致partial保全现场并quarantine/失败关闭，不自动删除。
- [ ] template、V1、synthetic、跨环境、过期/未来、generation跳跃、授权/批准/操作者复用、source/bundle漂移均不能成为actual active policy。
- [ ] monitor backup publisher与V4实际恢复只接受同一已提交current activation；手工JSON或只有政策正文没有activation receipt时明确失败关闭。
- [ ] 只使用合成fake-root/fake-authorization测试，不连接真实systemd、Docker、网络、UAT/生产、数据库、备份或受保护Volume。
- [ ] 适用轻量测试、inventory/manifest重放、敏感信息检查、静态检查和`git diff --check`通过；Swap超过80%期间不启动重任务。
- [ ] 更新项目治理文档、运行手册和独立Git提交，完成后自动选择下一安全任务。

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

## 5. 当前判定

`DOING / READ-ONLY AUDIT AND LIGHTWEIGHT REPOSITORY IMPLEMENTATION / RESOURCE STOP LINE ACTIVE / PRODUCTION NO-GO`。首项工作是只读复核Supervisor授权消费与现有固定路径消费者，随后以最小新增operation实现合成fake-root发布事务；不触碰真实host或数据。
