# SELFHOST-OPS-MONITORING-NOTIFIER-EGRESS-65 监控通知目标绑定与出口策略闭环

> 状态：`DOING / READ-ONLY AUDIT AND LIGHTWEIGHT REPOSITORY IMPLEMENTATION / RESOURCE STOP LINE ACTIVE / NO REAL NETWORK OR HOST ACTION / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@0e2328b58bc68cf09dc6b0638bb5ded82b0cf347` / tree `585b3c8d1d38f695422c5378eaa24691627de932`
> 责任：Codex主智能体唯一写入、测试调度、证据集成和Git提交；项目负责人保留真实渠道/目标/凭据、账号、systemd、网络出口、host安装、UAT/生产和真实通知专项授权

## 1. 背景与目标

TASK61/D-137已经提供三身份monitor host delivery、HTTPS remote ACK和默认`IPAddressDeny=any`的notifier；TASK62与TASK64又补齐权威投影和受控恢复政策激活链。当前缺口是：配置中的`target_id/endpoint`仍不能自动形成内容寻址、可审阅、可回退并能核验effective systemd网络限制的出口授权，手工drop-in或放宽全网会破坏A5a失败关闭边界。

本任务只在仓库和合成fake-root/effective-unit fixture中建立目标绑定出口合同。它不选择或联系真实通知渠道，不解析真实DNS，不读取或创建真实凭据，不写`/etc`/systemd，不开放防火墙或网络，也不发送通知。

## 2. 验收标准

- [ ] 完整审计notification config、HTTPS adapter、remote ACK、monitor installer/launcher、systemd unit与A5a授权依赖，记录现有目标重绑、DNS、代理环境和effective policy缺口。
- [ ] 定义版本化、canonical、内容寻址的notifier egress policy；绑定deployment、target ID/generation、HTTPS host/SNI/path、固定目标地址集合、端口、adapter、credential metadata、on-call/escalation摘要、当前monitor/Supervisor bundle和有效期。
- [ ] 默认继续deny-all；只允许显式批准目标的最小地址族/地址，不允许通配CIDR、DNS运行时重绑定、代理环境、HTTP、跳转、调用者自报地址或手改unit/drop-in形成ready。
- [ ] installed Supervisor使用一次性授权执行prepare→consume→publish/rollback/recover；绑定原始授权、当前generation、previous receipt、固定目标与effective unit摘要，消费前后重复核验且不能复用。
- [ ] 生成的systemd网络策略只作为内容寻址候选制品；fake-root验证`IPAddressDeny=any`与精确allow集合、无未知drop-in/transient覆盖、unit身份及回退目标，不调用真实`systemctl`。
- [ ] HTTPS adapter在合成注入中使用固定地址映射同时保持目标Host/TLS server name，拒绝运行时DNS结果、重定向、代理变量、非目标remote address及配置/credential/target代次漂移。
- [ ] target/credential rotation与target rebind严格区分；重绑必须新generation和独立授权，rollback只能回到精确已提交前代，partial/unknown/replaced状态保全并quarantine，不自动删除。
- [ ] delivery readiness除现有完整ACK链外还必须绑定当前已提交egress activation；只有配置、adapter、credential、target、effective policy和ACK同代时才可ready。
- [ ] 只使用合成目标、fake credential和断网轻量fixture；不连接真实网络、host、UAT/生产、数据库、备份或受保护Volume。
- [ ] 适用轻量测试、inventory/manifest重放、敏感信息检查、静态检查和`git diff --check`通过；Swap超过80%期间不启动build、全量Node/PostgreSQL、Docker数据库、typecheck或镜像任务。
- [ ] 更新项目治理文档、运行手册和独立Git提交，完成后自动选择下一安全任务。

## 3. 禁止事项

- 不请求用户在聊天粘贴URL中的秘密、Token、证书、密码或私钥；未来真实凭据只允许root-only文件。
- 不访问或探测真实endpoint/DNS，不发送HTTP(S)、邮件、Slack/Teams或其他外部通知，不创建防火墙、账号、systemd或网络变更。
- 不用`0.0.0.0/0`、`::/0`、域名运行时解析、代理、redirect或手工drop-in绕过目标绑定；本任务也不宣称真实渠道已可达。
- 不安装host Supervisor/monitor，不修改UAT/生产、Docker daemon、Swap、数据库、备份、Volume或业务数据。

## 4. 起点事实与依赖

- TASK64 source`83d920b1ac017370270452d334e44fa36a6b3978`与Supervisor manifest-only`0e2328b58bc68cf09dc6b0638bb5ded82b0cf347`形成121文件canonical链，manifest raw SHA-256为`728f9a5f321c03c4a9b089ca4c3091c04273e6b7427f1df610c6756fa0735db9`。
- 当前notifier已经要求HTTPS、Host=SNI、Bearer credential摘要、target generation和结构化remote ACK；systemd unit同时固定`IPAddressDeny=any`，所以仓库代码能够模拟发送，但真实host按设计不能出网。
- 真实渠道类型、目标、固定地址、凭据、值班表、systemd账号/网络授权和A1/A5a均不存在；本任务只能建立未来专项授权可消费的仓库合同。
- available约2.0GiB、Swap约861MiB/1GiB且超过80%，新的build、全量Node/PostgreSQL、Docker数据库、typecheck和镜像任务均禁止。

## 5. 当前判定

`DOING / READ-ONLY AUDIT AND LIGHTWEIGHT REPOSITORY IMPLEMENTATION / RESOURCE STOP LINE ACTIVE / NO REAL NETWORK OR HOST ACTION / PRODUCTION NO-GO`。先完成现有target/adapter/unit/Supervisor只读信任边界审计，再实现最小内容寻址egress activation与合成effective-policy负测。
