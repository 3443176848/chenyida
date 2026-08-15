# SELFHOST-UAT-CROSS-ROLE-TRANSACTION-77 UAT晋升跨岗验收checkpoint 12事务化

> 状态：`DOING / CROSS-ROLE CHECKPOINT 12 ADAPTER / HUMAN EXECUTION BLOCKED / RESOURCE STOP LINE ACTIVE / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格代码起点：`main@694f485cad3a6e9fbdc499c10cc801f0de77cafe` / tree `45007b67fb606bd423043d769efefd12acc67ab7`
> 责任：Codex主智能体唯一写入、轻量测试串行、证据集成和Git提交；项目负责人及业务负责人保留真实账号、员工、UAT业务写、数据库、凭据、host和生产专项授权

## 1. 背景与目标

TASK76/D-151已把checkpoint 10/11接入独立授权、不可变journal、发布前control binding和保全恢复。promotion仍停在`IN_PROGRESS`，因为checkpoint 12必须证明经批准的真实岗位、范围、窗口、逐步请求/数据库增量/冲销证据及三方签字；TASK67只定义合成合同，不能冒充员工已执行。

本任务只实现checkpoint 12的Supervisor事务适配器、内容寻址证据摄取、严格验证、恢复与拒绝门，并用fake-root合成证据验证。不得创建员工账号、访问真实UAT/数据库、执行业务写、伪造签字、发布checkpoint 13 final receipt或运行rollback。

## 2. 验收标准

- [ ] 完整核对TASK67跨岗合同、TASK66授权矩阵、checkpoint 11回执、promotion journal、真实员工执行边界及最终回执依赖，记录不可复用和需扩展边界。
- [ ] checkpoint 12使用独立短时一次性Supervisor授权；验收intent必须先于消费落盘，并绑定同一promotion、checkpoint 11 current/receipt、全部authorization摘要链、candidate/runtime/database/deployment/postdeploy身份和三方actor。
- [ ] 只接受内容寻址、root-owned、单硬链接、无symlink、未过期的cross-role result；结果必须绑定已批准的账号映射、岗位矩阵、测试范围、窗口、执行人/观察人/业务批准人，以及TASK67的4链/32步骤/6检查点与冲销分支。
- [ ] 每一步必须具备去敏request ID、预期/实际状态、数据库增量摘要、审计摘要、拒绝/幂等/CAS/零半记录证据；有冲销要求的步骤必须证明追加式反向记录，不得原地改写。
- [ ] 三方签字必须是不同actor的非空、不可变批准证据，并绑定精确result摘要；synthetic、空白、占位、过期、跨窗口、角色冲突、缺步骤或缺冲销证据均不得发布checkpoint 12。
- [ ] journal按history→receipt→current无覆盖发布checkpoint 12并保持`IN_PROGRESS`；不得越过checkpoint 13 final receipt，且实际人工UAT未执行时机器审计继续`BLOCKED`。
- [ ] 未消费、已消费未执行、result已落盘但journal未发布、source替换、binding漂移和三个发布崩溃点均有确定恢复或quarantine；未知结果不得重跑员工业务动作或伪造成功。
- [ ] fake-root/断网测试覆盖正向合成fixture、授权重放、身份/步骤/签字/窗口/数据库增量漂移、partial发布、恢复和quarantine；promotion、cross-role、audit、launcher、installer及inventory适用回归通过。
- [ ] 更新MASTER、TASKS、CHANGELOG、STATUS、DECISIONS、当前任务文档和授权包，完成资源、敏感信息和diff检查，形成独立source→manifest提交链并自动进入下一未阻塞任务。

## 3. 禁止事项

- 不创建或修改账号、岗位、权限、会话、凭据；不访问真实UAT/生产、数据库、日志、env、Volume、备份或业务数据。
- 不执行真实员工业务流程，不采集个人信息，不把合成fixture、operator声明或空签字描述为人工验收。
- 不运行Docker/Compose、build、Migration、backup/restore、部署、final receipt、rollback或正式切换；不修改Swap、systemd、网络、防火墙或Docker daemon。

## 4. 起点与资源判定

- TASK76当前source`8c7d51c`→binding fix`2309927`→Supervisor`694f485`形成134文件bundle`ccb0e462…f03d`；checkpoint 10/11仓库事务闭合，机器审计仍为11项SUPPORTED、4项阻断。
- checkpoint 12真实执行依赖业务负责人确认账号映射、范围、窗口、职责分离、冲销责任和三方签字；这些外部输入未提供，因此本任务只关闭可安全实现的adapter，不声称actual UAT完成。
- available约1.9GiB、Swap889MiB/1GiB、根盘约13GiB，Swap超过80%。只允许运行仓库静态、Python和受限Node轻量验证；TASK70继续`BLOCKED / RESOURCE STOP LINE + EXECUTOR DEPENDENCIES`。
