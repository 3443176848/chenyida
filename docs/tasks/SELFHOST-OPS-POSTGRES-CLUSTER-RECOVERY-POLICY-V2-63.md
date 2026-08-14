# SELFHOST-OPS-POSTGRES-CLUSTER-RECOVERY-POLICY-V2-63 PostgreSQL集群恢复策略V2闭环

> 状态：`DOING / READ-ONLY AUDIT AND LIGHTWEIGHT DESIGN / RESOURCE STOP LINE ACTIVE / NO HOST OR DATA ACTION / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@672a0695b761a50093c15401cf8d9e39951ced36` / tree `2d5b30bf72a5b1b08ad9ccdb35cf16008c376e76`
> 责任：Codex主智能体唯一写入、测试调度、证据集成和Git提交；项目负责人保留真实备份/恢复、host安装、凭据、账号/ACL、UAT/生产和数据专项授权

## 1. 背景与目标

TASK62证明现有D-132集群恢复策略V1只能支持合成/legacy恢复，V4必须以`READINESS_V4_LEGACY_POLICY_ACTUAL_FORBIDDEN`拒绝其成为`ACTUAL_OFFHOST + RECOVERY_READY`。本任务新增不可变的集群恢复策略V2合同，明确真实恢复所需目标、身份、安全、核对、时效和责任边界，并让V4只在V2证据完整时允许实际正向结果。

本任务只实施仓库合同、向后兼容读取、合成fixture和轻量隔离测试。它不读取真实备份或数据库，不生成真实ready回执，不执行备份/恢复、Migration、部署或host配置。

## 2. 验收标准

- [ ] 完整审计V1 policy、V4 readiness、cluster catalog/security、tablespace、role/ACL、runtime privilege及monitor投影的调用链，记录V1不能升级为actual的精确原因。
- [ ] 以新增schema/version实现V2，不修改已发布V1语义；明确environment、目标主机/集群身份、PostgreSQL major/system identifier、四域、tablespace映射、roles/ACL/default privileges、extensions、owner、LOGIN/secret重绑定、large objects和连接围栏要求。
- [ ] V2固定真实恢复验证的独立目标、非源集群、不可覆盖、最小权限、root-only凭据输入、policy generation、RPO/RTO、验证时间/过期、责任人/批准引用和恢复后销毁/保全决策；不把手填成功、synthetic或同机副本视为actual。
- [ ] V4对V1继续失败关闭，对完整V2 actual链才允许正向；错误版本、未知字段、身份/摘要漂移、过期/未来、降级、旧代、跨环境和policy替换均有稳定错误代码及负向测试。
- [ ] backup monitor投影、Dashboard和release/backup inventory使用同一V2边界；任何兼容适配都显式且不能把V1映射成生产ready。
- [ ] policy文件、schema/validator、生成/发布入口和运行手册保持内容寻址、root-only/no-follow、canonical JSON及一次性授权边界；若host发布仍需后续授权，必须明确失败关闭状态。
- [ ] 合成fixture覆盖V1拒绝、V2正常、非源集群、四域/roles/ACL/tablespace/extension/secret/large-object差异、RPO/RTO和时效、崩溃/重复/替换；不连接真实systemd、Docker、网络、UAT/生产或业务数据库。
- [ ] 适用轻量测试、inventory/manifest重放、敏感信息检查、静态检查和`git diff --check`通过；重任务继续服从Swap停止线。
- [ ] 更新`MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md`、`DECISIONS.md`及运行手册，形成独立提交并自动选择下一安全任务。

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

## 5. 当前判定

`DOING / READ-ONLY AUDIT AND LIGHTWEIGHT DESIGN / RESOURCE STOP LINE ACTIVE / PRODUCTION NO-GO`。首个工作项是只读定位V1/V4及runtime privilege的完整数据流，随后在不触碰真实系统的前提下确定最小V2扩展和兼容测试面。
