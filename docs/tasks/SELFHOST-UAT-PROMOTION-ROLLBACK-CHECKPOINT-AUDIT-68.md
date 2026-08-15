# SELFHOST-UAT-PROMOTION-ROLLBACK-CHECKPOINT-AUDIT-68 UAT晋升与快照回滚逐检查点失败关闭审计

> 状态：`DOING / REPOSITORY STATIC AUDIT FIRST / RESOURCE STOP LINE ACTIVE / NO UAT OR DATABASE ACTION / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@186e117cdebf2076619c75379edf4e36a1f7394a` / tree `c36d57a969afc720cf12ed032ffb025933617b50`
> 责任：Codex主智能体唯一写入、轻量测试调度、证据集成和Git提交；项目负责人保留Compose/PostgreSQL重任务、UAT/生产、备份恢复、部署和回滚专项授权

## 1. 背景与目标

TASK53、TASK59—TASK60及TASK67已经分别固定发布生命周期、独立candidate snapshot/reservation和跨岗位UAT证据合同，但尚未从“同一候选晋升、逐检查点验证、失败停止、快照回退、回退后再核对”的端到端视角证明执行器不存在绕过、半完成、陈旧证据复用或错误恢复缺口。

本任务先对仓库现有release gate、candidate snapshot/reservation、postdeploy/runtime identity、backup/recovery和UAT合同做只读/静态审计，形成逐检查点状态机与缺口清单；只对确认的失败关闭缺口实施仓库代码及轻量合成测试。当前Swap超过80%，不得启动Compose/PostgreSQL、build、Migration、镜像或部署；相关隔离动态验证保持为资源条件恢复后的同一任务验收项，不以静态测试替代。

## 2. 验收标准

- [ ] 枚举从prepared candidate、预部署稳定性、快照/备份、Migration、部署、postdeploy严格验证到业务UAT及回退后复核的全部权威入口、状态、receipt和锁边界。
- [ ] 建立可机读逐检查点合同，固定前置证据、成功输出、允许重试/恢复、停止条件和回退触发器；候选、源码、镜像、Migration、数据库、授权、时间窗或receipt跨代/漂移必须失败关闭。
- [ ] 证明任一检查点失败不会把后续步骤或整体标成成功，不会覆盖前代证据，也不会在缺失已验快照时声称可回退；未知/partial状态必须保全并要求显式恢复。
- [ ] 核对快照回滚只处理精确受控对象，数据库已过账事实不以直接删表/改账清理；业务冲销与环境级快照恢复边界明确分离。
- [ ] 对发现的仓库缺口补充最小实现及负向测试，并纳入release inventory/manifest；不得靠文档声明替代执行器约束。
- [ ] 资源停止线解除后，只在合成Compose/隔离PostgreSQL运行适用的晋升失败、恢复和回退测试；不得连接或部署UAT/生产。若停止线仍有效，明确登记未验证范围并保持任务`DOING`或拆分为受阻验收项。
- [ ] 更新MASTER、TASKS、PROJECT_CONTEXT、CHANGELOG、STATUS、DECISIONS和投产授权包；通过适用测试、敏感信息及diff检查后创建独立提交，并自动选择下一项。

## 3. 禁止事项

- 不连接UAT/生产数据库，不读取业务行、日志、环境秘密、备份或Volume正文，不执行Migration、部署、回滚、Compose重建或真实API写。
- 不创建、修改或登录账号，不授予A1—A8，不安装host Supervisor，不修改systemd、网络、Swap、Docker daemon或持久卷。
- 不把静态状态机、合成fixture或历史回执描述为真实UAT晋升、真实恢复或正式回滚已通过。

## 4. 起点与当前判定

- TASK67最终链为source`ac4f294d`→monitor`c70b6bfc`→Supervisor`186e117c`，30/126文件manifest逐字节重放，完整Supervisor Python105/105通过；该链是本任务唯一严格审计起点。
- UAT运行面仍为alpha.42/0040，源码为alpha.47/0046，当前没有源码匹配镜像、正式A1/A3、19步PASS、真实快照/恢复或A7e授权。
- `DOING / REPOSITORY STATIC AUDIT FIRST / RESOURCE STOP LINE ACTIVE / NO UAT OR DATABASE ACTION / PRODUCTION NO-GO`。先完成可安全的仓库证据图和失败关闭审计；任何真实运行面动作继续等待专项授权。
