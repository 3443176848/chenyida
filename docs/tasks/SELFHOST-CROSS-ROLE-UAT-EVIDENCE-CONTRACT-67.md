# SELFHOST-CROSS-ROLE-UAT-EVIDENCE-CONTRACT-67 跨岗位UAT证据与签字合同

> 状态：`DOING / REPOSITORY AND SYNTHETIC EVIDENCE CONTRACT ONLY / BUSINESS APPROVAL PENDING / RESOURCE STOP LINE ACTIVE / NO ACCOUNT OR UAT WRITE / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@9b657f2458427482f6ed28c0178999d3d62877f2` / tree `2f1046654d710d2af0bdba8abbef7601676a3f97`
> 责任：Codex主智能体唯一写入、轻量测试调度、证据集成和Git提交；业务负责人批准岗位与流程，项目负责人保留账号、UAT写、真实数据、部署和试运行专项授权

## 1. 背景与目标

TASK66已把当前11角色、158个permission和186条服务端操作生成为可重放矩阵，但技术矩阵不等于真实岗位批准，也没有形成可由观察人逐步执行、核对数据库增量、审计、异常和回退的统一跨岗位UAT合同。现有自动测试与历史浏览器记录分散在各业务任务，不能直接作为A7e/A7f签字包。

本任务只在仓库建立版本化、机器可校验的合成UAT场景目录、步骤合同、预期证据和签字模板。它引用TASK66矩阵及现有服务端事实，不创建账号、不登录UAT、不连接数据库、不执行业务写，也不把模板标成业务已批准或已验收。

## 2. 验收标准

- [ ] 审计现有采购、收货/IQC、库存/AP、生产、销售/FQC/AR、付款/冲销、权限与浏览器验收资料，列出可复用证据、冲突和缺口。
- [ ] 建立canonical场景目录，固定合成对象、角色、前置状态、API method/path、permission、请求/响应、request ID、CSRF、Idempotency-Key、CAS、审计及预期数据库增量；禁止包含密码、Token、Cookie或真实业务值。
- [ ] 覆盖采购→收货/IQC→库存/AP、生产领退→工序/IPQC→完工、销售→FQC→出货/AR及付款/冲销四条核心链，并明确跨岗handoff和职责分离。
- [ ] 每条核心链同时覆盖越权403、CSRF、重复提交/幂等重放、CAS冲突、失败零半记录、冲销/反向记录和审计/request ID核对。
- [ ] 建立观察人、执行人、业务验收人分离的逐步签字模板；业务批准、账号映射、允许写范围、窗口、停止条件和回退责任为空时必须失败关闭。
- [ ] 机器校验场景引用的角色、permission和route operation均存在于TASK66矩阵，矩阵/源码摘要漂移时拒绝；制品确定性并纳入release test inventory。
- [ ] 只运行断网、无数据库的轻量静态/Node测试；Swap超过80%期间不启动build、全量Node/PostgreSQL、Docker数据库、typecheck、镜像或Migration。
- [ ] 更新MASTER、TASKS、PROJECT_CONTEXT、CHANGELOG、STATUS、DECISIONS和投产授权包，执行敏感信息及`git diff --check`，创建独立提交后自动选择下一安全任务。

## 3. 禁止事项

- 不创建、重置、启用、停用或登录任何真实/UAT账号，不分配角色，不撤销Session。
- 不连接UAT/生产PostgreSQL或SQLite，不读取业务行、日志、凭据、备份/Volume正文，不执行API业务写、Migration或部署。
- 不把当前源码权限、合成场景、自动测试或签字空模板描述为岗位已批准、人工UAT已通过或员工已试运行。
- 不用直接删表/改账作为清理；未来执行只能使用场景定义的业务冲销或已验证快照恢复，并须另获专项授权。

## 4. 起点事实与依赖

- TASK66矩阵固定11角色、158个permission、186条操作（175条受保护、110条受保护写），artifact SHA-256为`741bb74249fe9a88468a70c6d1f05b18cf6989ea7a6a7d10dd38b0b7ceb29a34`；21条全员只读和2个legacy grant仍为业务待处置。
- 现有测试已分别证明大量服务端规则，但缺少一个把角色、跨岗顺序、预期数据库增量、审计、异常、回退和签字统一绑定的A7e执行合同。
- 0017→0046合成升级需要PostgreSQL/Migration重任务，当前Swap约860MiB/1GiB超过80%停止线；因此调度先执行可完全断网、无数据库的UAT证据合同，迁移任务保持开放而非降级验证。

## 5. 当前判定

`DOING / REPOSITORY AND SYNTHETIC EVIDENCE CONTRACT ONLY / BUSINESS APPROVAL PENDING / RESOURCE STOP LINE ACTIVE / NO ACCOUNT OR UAT WRITE / PRODUCTION NO-GO`。先只读盘点现有业务流程和测试机器源，再建立失败关闭的合成场景与签字合同；A7d岗位批准、A7e真实跨岗写和A7f员工试运行均保持外部阻塞。
