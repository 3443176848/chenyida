# SELFHOST-CROSS-ROLE-UAT-EVIDENCE-CONTRACT-67 跨岗位UAT证据与签字合同

> 状态：`DONE / REPOSITORY AND SYNTHETIC EVIDENCE CONTRACT VERIFIED / BUSINESS APPROVAL AND HUMAN UAT PENDING / RESOURCE STOP LINE ACTIVE / NO ACCOUNT OR UAT WRITE / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@9b657f2458427482f6ed28c0178999d3d62877f2` / tree `2f1046654d710d2af0bdba8abbef7601676a3f97`
> 责任：Codex主智能体唯一写入、轻量测试调度、证据集成和Git提交；业务负责人批准岗位与流程，项目负责人保留账号、UAT写、真实数据、部署和试运行专项授权

## 1. 背景与目标

TASK66已把当前11角色、158个permission和186条服务端操作生成为可重放矩阵，但技术矩阵不等于真实岗位批准，也没有形成可由观察人逐步执行、核对数据库增量、审计、异常和回退的统一跨岗位UAT合同。现有自动测试与历史浏览器记录分散在各业务任务，不能直接作为A7e/A7f签字包。

本任务只在仓库建立版本化、机器可校验的合成UAT场景目录、步骤合同、预期证据和签字模板。它引用TASK66矩阵及现有服务端事实，不创建账号、不登录UAT、不连接数据库、不执行业务写，也不把模板标成业务已批准或已验收。

## 2. 验收标准

- [x] 审计现有采购、收货/IQC、库存/AP、生产、销售/FQC/AR、付款/冲销、权限与浏览器验收资料，列出可复用证据、冲突和缺口。
- [x] 建立canonical场景目录，固定合成对象、角色、前置状态、API method/path、permission、请求/响应、request ID、CSRF、Idempotency-Key、CAS、审计及预期数据库增量；禁止包含密码、Token、Cookie或真实业务值。
- [x] 覆盖采购→收货/IQC→库存/AP、生产领退→工序/IPQC→完工、销售→FQC→出货/AR及付款/冲销四条核心链，并明确跨岗handoff和职责分离。
- [x] 每条核心链同时覆盖越权403、CSRF、重复提交/幂等重放、CAS冲突、失败零半记录、冲销/反向记录和审计/request ID核对。
- [x] 建立观察人、执行人、业务验收人分离的逐步签字模板；业务批准、账号映射、允许写范围、窗口、停止条件和回退责任为空时必须失败关闭。
- [x] 机器校验场景引用的角色、permission和route operation均存在于TASK66矩阵，矩阵/源码摘要漂移时拒绝；制品确定性并纳入release test inventory。
- [x] 只运行断网、无数据库的轻量静态/Node测试；Swap超过80%期间不启动build、全量Node/PostgreSQL、Docker数据库、typecheck、镜像或Migration。
- [x] 更新MASTER、TASKS、PROJECT_CONTEXT、CHANGELOG、STATUS、DECISIONS和投产授权包，执行敏感信息及`git diff --check`，创建独立提交后自动选择下一安全任务。

## 3. 禁止事项

- 不创建、重置、启用、停用或登录任何真实/UAT账号，不分配角色，不撤销Session。
- 不连接UAT/生产PostgreSQL或SQLite，不读取业务行、日志、凭据、备份/Volume正文，不执行API业务写、Migration或部署。
- 不把当前源码权限、合成场景、自动测试或签字空模板描述为岗位已批准、人工UAT已通过或员工已试运行。
- 不用直接删表/改账作为清理；未来执行只能使用场景定义的业务冲销或已验证快照恢复，并须另获专项授权。

## 4. 起点事实与依赖

- TASK66矩阵固定11角色、158个permission、186条操作（175条受保护、110条受保护写），artifact SHA-256为`741bb74249fe9a88468a70c6d1f05b18cf6989ea7a6a7d10dd38b0b7ceb29a34`；21条全员只读和2个legacy grant仍为业务待处置。
- 现有测试已分别证明大量服务端规则，但缺少一个把角色、跨岗顺序、预期数据库增量、审计、异常、回退和签字统一绑定的A7e执行合同。
- 0017→0046合成升级需要PostgreSQL/Migration重任务，当前Swap约860MiB/1GiB超过80%停止线；因此调度先执行可完全断网、无数据库的UAT证据合同，迁移任务保持开放而非降级验证。

## 5. 实施结果

- 新增`operations/cross-role-uat-evidence-policy-v1.json`作为人工UAT失败关闭政策，新增由生成器确定性发布的`operations/cross-role-uat-evidence-contract-v1.json`和[逐步执行/签字文档](../testing/selfhost-cross-role-uat-evidence-contract-v1.md)。机器合同固定4条核心链、32个步骤、6个检查点/冲销分支、32个控制项及16类证据源；证据manifest SHA-256为`a79005537170e95854598908f75c044dbe58bd5578585da75429ca9e523d70fc`。
- 每条链均逐项绑定TASK66角色、permission、method/path、data domain与源摘要，并覆盖未授权403、CSRF、幂等重放/冲突、CAS、失败零半记录、追加式业务冲销及audit/request ID。业务批准、账号/角色映射、范围、窗口、停止条件、回退负责人和三方签字仍为空且状态固定`BLOCKED`，合成证据不得升级为人工PASS。
- 生成器、9项专项负测、release gate、manifest、inventory和完整Supervisor Python测试纳入门禁。inventory为255项，其中231 required、24 N/A；合同artifact SHA-256为`0068b8aa9226830f6ebc357fd28a02b18c00d9280def8393a7188115c64946f5`，逐字节重放一致。

## 6. 不可变链与验证

- 最终source为`ac4f294d110c2189fe363eadb41e73e9184fb656`/tree`8ae8a12ae19b97c54dfdc9c4c96401411eea66ff`，monitor manifest-only直接子提交为`c70b6bfc65f32f9e94badb2f3f2ac159130697fe`/tree`3b09213ffc079fb69d690bc9068ed5a0812f9bb9`，Supervisor manifest-only直接子提交为`186e117cdebf2076619c75379edf4e36a1f7394a`/tree`c36d57a969afc720cf12ed032ffb025933617b50`。30/126文件manifest raw SHA-256分别为`f90a660973844e01ccacfc81cedfbb547fb41f322e6d7938cacf512bb8b1eee3`和`5e2f8ba766ff3e49203d44b4b949029da240f203e7a73737d3ce21c4430d7254`，两者均逐字节重放一致。
- 专项9/9、release gate20/20、授权矩阵10/10、release manifest9/9、Supervisor Python105/105、inventory255/231/24、credentials1728和`git diff --check`通过。第一次重建链后完整Supervisor回归诚实暴露1/105旧runtime-policy摘要锚点，修正该精确常量后原断言105/105通过；旧`b8495dc→bb1da17→7b7bbd1`链仅保留历史审计价值。
- 收口时available约1.9GiB、Swap约860MiB/1GiB且超过80%停止线、根盘约13GiB、Load低；四服务restart0/OOM false。未启动build、全量Node/PostgreSQL、Docker数据库、typecheck、镜像或Migration，未遗留任务容器/临时资源。

## 7. 当前判定

`DONE / REPOSITORY AND SYNTHETIC EVIDENCE CONTRACT VERIFIED / BUSINESS APPROVAL AND HUMAN UAT PENDING / RESOURCE STOP LINE ACTIVE / NO ACCOUNT OR UAT WRITE / PRODUCTION NO-GO`。TASK67只证明执行合同确定且失败关闭；A7d岗位批准、A7e真实跨岗写、A7f员工试运行及真实回退仍保持外部阻塞，不能宣布系统可投入使用。
