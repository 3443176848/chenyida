# SELFHOST-OPS-MONITORING-NOTIFIER-EGRESS-65 监控通知目标绑定与出口策略闭环

> 状态：`DONE / REPOSITORY AND SYNTHETIC FAKE-ROOT VERIFIED / REAL TARGET AND HOST ACTIVATION NOT AUTHORIZED / RESOURCE STOP LINE ACTIVE / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@0e2328b58bc68cf09dc6b0638bb5ded82b0cf347` / tree `585b3c8d1d38f695422c5378eaa24691627de932`
> 责任：Codex主智能体唯一写入、测试调度、证据集成和Git提交；项目负责人保留真实渠道/目标/凭据、账号、systemd、网络出口、host安装、UAT/生产和真实通知专项授权

## 1. 背景与目标

TASK61/D-137已经提供三身份monitor host delivery、HTTPS remote ACK和默认`IPAddressDeny=any`的notifier；TASK62与TASK64又补齐权威投影和受控恢复政策激活链。当前缺口是：配置中的`target_id/endpoint`仍不能自动形成内容寻址、可审阅、可回退并能核验effective systemd网络限制的出口授权，手工drop-in或放宽全网会破坏A5a失败关闭边界。

本任务只在仓库和合成fake-root/effective-unit fixture中建立目标绑定出口合同。它不选择或联系真实通知渠道，不解析真实DNS，不读取或创建真实凭据，不写`/etc`/systemd，不开放防火墙或网络，也不发送通知。

## 2. 验收标准

- [x] 完整审计notification config、HTTPS adapter、remote ACK、monitor installer/launcher、systemd unit与A5a授权依赖，记录现有目标重绑、DNS、代理环境和effective policy缺口。
- [x] 定义版本化、canonical、内容寻址的notifier egress policy；绑定deployment、target ID/generation、HTTPS host/SNI/path、固定目标地址集合、端口、adapter、credential metadata、on-call/escalation摘要、当前monitor/Supervisor bundle和有效期。
- [x] 默认继续deny-all；只允许显式批准目标的最小地址族/地址，不允许通配CIDR、DNS运行时重绑定、代理环境、HTTP、跳转、调用者自报地址或手改unit/drop-in形成ready。
- [x] installed Supervisor使用一次性授权执行prepare→consume→publish/rollback/recover；绑定原始授权、当前generation、previous receipt、固定目标与effective unit摘要，消费前后重复核验且不能复用。
- [x] 生成的systemd网络策略只作为内容寻址候选制品；fake-root验证`IPAddressDeny=any`与精确allow集合、无未知drop-in/transient覆盖、unit身份及回退目标，不调用真实`systemctl`。
- [x] HTTPS adapter在合成注入中使用固定地址映射同时保持目标Host/TLS server name，拒绝运行时DNS结果、重定向、代理变量、非目标remote address及配置/credential/target代次漂移。
- [x] target/credential rotation与target rebind严格区分；重绑必须新generation和独立授权，rollback只能回到精确已提交前代，partial/unknown/replaced状态保全并quarantine，不自动删除。
- [x] delivery readiness除现有完整ACK链外还必须绑定当前已提交egress activation；只有配置、adapter、credential、target、effective policy和ACK同代时才可ready。
- [x] 只使用合成目标、fake credential和断网轻量fixture；不连接真实网络、host、UAT/生产、数据库、备份或受保护Volume。
- [x] 适用轻量测试、inventory/manifest重放、敏感信息检查、静态检查和`git diff --check`通过；Swap超过80%期间不启动build、全量Node/PostgreSQL、Docker数据库、typecheck或镜像任务。
- [x] 更新项目治理文档、运行手册和独立Git提交，完成后自动选择下一安全任务。

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

## 5. 实施结果

- 新增V1 canonical target-bound policy/template/receipt：只接受最多8个精确公网`/32`或`/128`地址、HTTPS 443、固定Host/SNI/path和最长24小时有效期；默认unit继续`IPAddressDeny=any`，批准地址仅由独立内容寻址drop-in开放。
- Supervisor authorization V5固定`ACTIVATE`、`ROLLBACK`、`RECOVER`三类操作，按intent→授权消费→policy/drop-in/effective验证→receipt→current顺序提交；相同intent可幂等恢复，不同intent即使复用activation ID也被联锁拒绝。历史最高generation决定下一代，回退只允许精确当前前代。
- publisher使用可信祖先、no-follow、canonical JSON、内容寻址history/intents/receipts/recoveries/current、原子no-clobber和file/directory fsync；未知drop-in、partial或替换对象只保全并quarantine，不自动删除。
- HTTPS adapter把连接固定到批准IP，同时保持Host和TLS server name，禁用agent/proxy/redirect及运行时DNS，并核对实际remote address。collector、notifier和delivery readiness共同绑定当前policy、activation receipt及effective-unit摘要；legacy V1 readiness可读但不能形成READY。
- launcher持续核验root-owned物理base unit、专用drop-in目录精确成员/内容、systemd loaded properties和零环境覆盖；installer拒绝unresolved/quarantined/partial egress链。

## 6. 不可变提交与验证证据

- source提交`05502fda0bcac7952d12374dfab78cccf8284bb3`/tree`3dcb05738561e16d866675f1349a9ba5d2cd7832`，monitor manifest-only直接子提交`013e61fd16f679f453ab0a1abfeade65dbd9de7d`/tree`d9dbf8ebef7edbe3b84b61a75f862c16256719c4`，Supervisor manifest-only直接子提交`7c69385c5ee35d517e9611fe04f55ae17be4f194`/tree`7d19d1d9fa161dc273652ce21f1478708035d507`。
- monitor/Supervisor manifest分别固定30/126文件，raw SHA-256为`8260bed4ef9742093ff9188acc87deb3fcef1fc1cac18c547817b0e3a8b32302`和`aab36e62a407834e8ebe3fc4b28a7439ecd90c32b91e71e86b91100ceada53a3`；两级生成器均从精确source提交逐字节重放一致。
- 受限断网Node合同`25/25`、Python Supervisor专项`36/36`、release gate合同`20/20`、inventory`253/229/24`、Python AST 7文件、JSON 4文件、bundle计数、模板logical摘要、敏感模式和`git diff --check`通过。第一次完全cap-drop Node运行有7个fixture `chown EPERM`，按fake-root写入所需最小`CHOWN/FOWNER/DAC_OVERRIDE`能力重跑后原断言全部通过，未降低断言。
- 治理收口首次从仓库根调用宿主`node`和Site Python模块分别因宿主无`node`、工作目录错误失败；随后以显式11文件Python本地链接校验通过，并从`chenyida_erp_site/`重跑同一Python专项`36/36`通过。该偏差未触发代码、网络、数据库或运行面变化，也没有跳过测试。
- 测试前后available约2.0→1.9GiB，Swap858→860MiB/1GiB且持续超过80%，根盘13GiB，Load低于1；四服务restart0/OOM false，Web/PostgreSQL healthy，Worker/Caddy无healthcheck。临时容器使用`--rm`且清零。

## 7. 授权边界与结论

本任务没有选择、解析或访问真实target/DNS，没有读取或创建凭据，没有发送通知，没有创建账号、安装host、写systemd或修改网络，也没有连接数据库、读取备份/Volume或修改UAT/生产。真实A5a仍须项目负责人对渠道、固定地址、root-only凭据、值班/升级责任人、host账号/systemd/网络和实际ACTIVATE逐项专项授权。

`DONE / REPOSITORY AND SYNTHETIC FAKE-ROOT VERIFIED / REAL TARGET AND HOST ACTIVATION NOT AUTHORIZED / RESOURCE STOP LINE ACTIVE / PRODUCTION NO-GO`。下一安全任务为`SELFHOST-AUTHORIZATION-ROLE-PERMISSION-MATRIX-66`，只在仓库生成11角色→permission→API/data-domain机器矩阵与负向漂移合同；业务批准和真实账号变更不在其自主范围。
