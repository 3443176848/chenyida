# SELFHOST-OPS-POSTGRES-CLUSTER-RECOVERY-POLICY-V2-63 PostgreSQL集群恢复策略V2闭环

> 状态：`DONE / REPOSITORY AND SYNTHETIC-ISOLATED VERIFIED / HOST ACTIVATION NOT IMPLEMENTED / RESOURCE STOP LINE ACTIVE / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@672a0695b761a50093c15401cf8d9e39951ced36` / tree `2d5b30bf72a5b1b08ad9ccdb35cf16008c376e76`
> 责任：Codex主智能体唯一写入、测试调度、证据集成和Git提交；项目负责人保留真实备份/恢复、host安装、凭据、账号/ACL、UAT/生产和数据专项授权

## 1. 背景与目标

TASK62证明现有D-132集群恢复策略V1只能支持合成/legacy恢复，V4必须以`READINESS_V4_LEGACY_POLICY_ACTUAL_FORBIDDEN`拒绝其成为`ACTUAL_OFFHOST + RECOVERY_READY`。本任务新增不可变的集群恢复策略V2合同，明确真实恢复所需目标、身份、安全、核对、时效和责任边界，并让V4只在V2证据完整时允许实际正向结果。

本任务只实施仓库合同、向后兼容读取、合成fixture和轻量隔离测试。它不读取真实备份或数据库，不生成真实ready回执，不执行备份/恢复、Migration、部署或host配置。

## 2. 验收标准

- [x] 完整审计V1 policy、V4 readiness、cluster catalog/security、tablespace、role/ACL、runtime privilege及monitor投影的调用链，记录V1不能升级为actual的精确原因。
- [x] 以新增schema/version实现V2，不修改已发布V1语义；明确environment、目标主机/集群身份、PostgreSQL major/system identifier、四域、tablespace映射、roles/ACL/default privileges、extensions、owner、LOGIN/secret重绑定、large objects和连接围栏要求。
- [x] V2固定真实恢复验证的独立目标、非源集群、不可覆盖、最小权限、root-only凭据输入、policy generation、RPO/RTO、验证时间/过期、责任人/批准引用和恢复后销毁/保全决策；不把手填成功、synthetic或同机副本视为actual。
- [x] V4对V1继续失败关闭，对完整V2 actual链才允许正向；错误版本、未知字段、身份/摘要漂移、过期/未来、降级、旧代、跨环境和policy替换均有稳定错误代码及负向测试。
- [x] backup monitor投影、Dashboard和release/backup inventory使用同一V2边界；任何兼容适配都显式且不能把V1映射成生产ready。
- [x] policy文件、schema/validator、生成入口和运行手册保持内容寻址、canonical JSON及一次性授权边界；host发布器没有实现且保持失败关闭，转交TASK64。
- [x] 合成fixture覆盖V1拒绝、V2正常、非源集群、四域/roles/ACL/tablespace/extension/secret/large-object差异、RPO/RTO和时效、崩溃/重复/替换；不连接真实systemd、Docker、网络、UAT/生产或业务数据库。
- [x] 适用轻量测试、inventory/manifest重放、敏感信息检查、静态检查和`git diff --check`通过；重任务继续服从Swap停止线。
- [x] 更新`MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md`、`DECISIONS.md`及运行手册，形成独立提交并自动选择下一安全任务。

## 3. 禁止事项

- 不修改已执行Migration或已有V1政策含义，不以兼容模式、测试validator或调用者参数绕过V4的V1 actual拒绝。
- 不读取`.env`、凭据、日志、业务行、真实数据库/回执/备份、受保护Volume正文或用户未跟踪状态报告。
- 不执行真实backup/restore、PostgreSQL连接、Migration、build、deploy、restart、外部传输或数据写。
- 不安装host、创建/修改账号或权限、写systemd、修改网络/防火墙/Swap/Docker daemon，不删除备份、Volume或业务数据。

## 4. 起点事实与依赖

- TASK55/D-132已有V1 cluster recovery policy、严格catalog、安全/角色/ACL/tablespace恢复、加密联合传输和V4 readiness合成闭环；它明确没有真实异机、真实凭据或当前数据恢复。
- TASK56/D-133—D-134已有9角色/5 LOGIN、1261条ACL、受控operator、secret重绑定、large-object与CONNECT围栏合同；V2必须引用而不是复制或弱化这些规则。
- TASK62/D-138已完成权威monitor projection producer，但默认backup正向路径会拒绝V1 actual；只有V2 policy及其完整证据才能解除该仓库级阻断。
- 当前源码alpha.47/0046，UAT仍alpha.42/0040。没有源码匹配镜像、installed Supervisor、真实异机恢复、A1—A8授权或员工试用；Swap超过80%，禁止新重任务。

## 5. 审计结论

- 冻结V1政策与执行器只认识3个legacy角色和2份LOGIN凭据回执；TASK56当前运行权限基线是9角色、5 LOGIN、4条membership和1261条ACL。直接修改V1会破坏已经发布的恢复证据，直接把V1映射为actual则会伪造当前权限来源。
- V2因此采用独立编排/控制层：嵌入V1政策原始SHA和文件身份，同时固定当前runtime privilege、operator、catalog、roles、ACL/default privileges、Migration、镜像和四域摘要。V1只证明基础恢复，V2控制回执与当前runtime privilege `BOOTSTRAP`回执共同证明五份当前LOGIN凭据及完整权限重建。
- repository template只允许合成`TEST`；实际恢复必须使用已激活、最长24小时、逐代、独立授权/批准/操作身份的actual policy，并绑定独立TEST目标、源/目标位置、system identifier、机器、运行/发布/运维身份、RPO/RTO和恢复后处置。V1 actual、模板actual、同机/同源、过期/未来、跨环境、降级、替换及连同摘要一起重签名的伪政策全部失败关闭。

## 6. 实施结果

- 新增`operations/postgresql-cluster-recovery-policy-v2.json`、V2 contract、V2 builder和专项测试；V2 raw SHA-256为`1a092993b1dda00bd8a2aac0899cb4e1eee83e9b336022bdb72f3e4d23e317aa`，canonical logical SHA-256为`c30951ad74a827c06e8256cfc124f61bd5672bca9daa7abda21c0896523378b8`。
- 冻结V1 contract与executor逐字节保持`d11ba513f43d69d3bc4918dbd523d32973904bf98beec585de084cc2bdea3cfa`和`b555d4c9a3c250b700abf54a5ad200f793217f5b7beed0e2ecf163c97ec2a4be`；V1 policy raw SHA固定为`7e24d900b3445ca6b4f406b7330919cc1269f34fdf6bef193eedacf0d2e5bd13`。
- V4、Dashboard和monitor backup projection共用同一V2 actual边界；默认路径没有测试validator旁路。repository template不能生成actual ready，host固定路径当前也没有publisher，故实际恢复继续明确不可用。

## 7. 验证、提交与资源

- V2/V1/Dashboard/monitor专项`41/41`，release contracts`29/29`；此前同任务Python Supervisor launcher/monitoring`28/28`，manifest后installer+launcher`25/25`。
- release inventory为`251 total / 227 required / 24 N/A`；inventory SHA-256为`64bb79d70d960ffcb8a63db03cc6c816042a4bc4b69934c49dc647b99fe0a2be`，test runtime policy SHA-256为`cecb2293f758421f632f153a24aaf02e794b6e813d07d5b2ba0da9024abb5245`。V2/V1政策校验、JSON/JS静态、manifest重放、1,705文件凭据扫描和diff门通过。
- 源码提交`de993c0326b959f7f7c451504a6ef3a753e09c11`/tree`5d427f26eeafec4fbaf7c4faa6abf9516d0a8921`；Supervisor manifest-only提交`e527fcfe5fa0f779cbe4514ffa82376e1d0f3462`/tree`778b24a550215271bba248ea6367adc8d1b3fb92`固定117文件，manifest raw SHA-256为`4c3b801fc2fa33f3f047bc8a40dabf003376c079187a576a5c3108cf7f665582`。
- 收口available约2.0GiB、Swap 870MiB/1GiB且超过80%、根盘13GiB、Load低于1、`oom_kill=0`；四服务restart0/OOM false，Web/PostgreSQL healthy，Worker/Caddy无healthcheck。无任务临时容器/目录遗留，未启动build、全量Node/PostgreSQL、Docker数据库、typecheck或镜像任务。

## 8. 未完成边界与下一任务

没有在host发布或激活actual policy，没有真实异机目标、凭据、备份、恢复、RPO/RTO测量或责任人批准；UAT仍alpha.42/0040。系统继续`PRODUCTION NO-GO`。下一唯一任务为`SELFHOST-OPS-POSTGRES-CLUSTER-RECOVERY-POLICY-ACTIVATION-64`，只在仓库与合成fake-root中实现受控发布、回退和quarantine；真实host激活仍需专项授权。
