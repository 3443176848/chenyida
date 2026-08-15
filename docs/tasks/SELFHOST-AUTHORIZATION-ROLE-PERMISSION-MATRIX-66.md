# SELFHOST-AUTHORIZATION-ROLE-PERMISSION-MATRIX-66 11角色机器权限矩阵与路由漂移门

> 状态：`DONE / TECHNICAL MATRIX AND DRIFT GATE VERIFIED / BUSINESS APPROVAL PENDING / RESOURCE STOP LINE ACTIVE / NO ACCOUNT OR DATABASE ACTION / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@7c69385c5ee35d517e9611fe04f55ae17be4f194` / tree `7d19d1d9fa161dc273652ce21f1478708035d507`
> 责任：Codex主智能体唯一写入、轻量测试调度、证据集成和Git提交；项目负责人/业务负责人保留岗位职责批准、真实账号、角色分配、UAT/生产及数据访问专项授权

## 1. 背景与目标

源码实际定义11个员工角色及动态权限集合，但当前权限证明散落在`IDENTITY_ROLES`、`permissionsForRole`、各handler的`requirePermission`、Dashboard domain裁剪和大量手写测试中。既有API inventory只证明历史64条legacy路径有实现，不能证明当前全部服务端路由都有明确permission、每个角色的允许/拒绝结果可重放，也不能发现新增planning等权限后测试矩阵漂移。

本任务只在仓库建立版本化、机器可生成的“角色→permission→API method/path→data domain”证据和负向合同。技术矩阵只能记录当前实现事实与待批准差异，不替代业务负责人对职责分离的批准；不创建或修改账号、Session、数据库角色/ACL、UAT/生产数据或运行配置。

## 2. 验收标准

- [x] 完整审计11个`IDENTITY_ROLES`、`permissionsForRole`动态组合、Dashboard domains、全部self-hosted handler和现有权限测试，列出机器源、重复/漂移和无法静态证明的边界。
- [x] 建立版本化canonical权限目录，精确枚举11角色、所有permission、API method/path pattern、所需permission、读写性质、CSRF/幂等/审计期望和data domain；禁止用文档手填副本代替源码校验。
- [x] 生成11角色对每个受保护API操作的ALLOW/DENY矩阵，并显式记录`BUSINESS_APPROVAL_PENDING/APPROVED/REJECTED`，技术生成不得把未获业务批准的职责判断标成已接受。
- [x] 失败关闭检测角色增删、permission未使用/未定义、handler路由未纳入、路由无服务端permission、方法或路径漂移、Dashboard domain越权及通配`*`意外扩散。
- [x] 每个受保护操作均有允许证据；154条有明确拒绝角色，另21条当前全员只读以`ALL_EMPLOYEE_READ_SCOPE_REQUIRES_APPROVAL`失败关闭而不伪造拒绝。110条受保护写操作覆盖跨岗拒绝、CSRF、幂等和事务审计合同，admin通配不是任何操作的唯一正向证据。
- [x] 机器生成制品确定性、内容摘要可重放，并纳入release test inventory/候选绑定；旧手写矩阵仅保留补充证据。
- [x] 只执行不连接数据库/网络的轻量Node/静态测试；Swap超过80%期间未启动build、全量Node/PostgreSQL、Docker数据库、typecheck或镜像任务。
- [x] 更新MASTER、TASKS、PROJECT_CONTEXT、CHANGELOG、STATUS、DECISIONS和投产授权包，执行敏感信息与`git diff --check`，创建独立Git提交后自动选择下一安全任务。

## 3. 禁止事项

- 不自行决定岗位职责、增加员工权限或把当前代码事实标成业务已批准；发现高风险差异先失败关闭并登记责任人。
- 不创建、修改、停用或登录真实账号，不撤销Session，不修改PostgreSQL角色/ACL，不连接UAT/生产数据库。
- 不通过页面隐藏、前端菜单或Dashboard裁剪替代服务端`requirePermission`；不以admin通配掩盖普通角色缺少正/负向证据。
- 不读取`.env`、凭据、日志、业务行、备份/Volume正文或用户未跟踪状态报告，不执行部署、Migration、网络或host变更。

## 4. 起点事实与依赖

- `app/lib/identity-selfhost/types.ts`当前固定11角色：admin、manager、purchase、engineering、planning、production、warehouse、quality、sales、finance、operations。
- `permissionsForRole`在静态基表之外按角色动态合并planning、requirements、sourcing、fulfillment、handoff、routing、nonconformance、batch和inventory-lot权限；当前搜索到约175处服务端`requirePermission`调用，尚无统一机器路由矩阵。
- Dashboard另有`ROLE_DOMAINS`，API dispatcher又在部分子handler之前要求`material.read`；必须以实际调用链为准，不能只解析一个文件。
- TASK65最终链为source`05502fda`→monitor manifest-only`013e61fd`→Supervisor manifest-only`7c69385c`，30/126文件摘要为`8260bed4…302`/`aab36e62…53a3`。后续Site源码变化会使该Supervisor bundle成为历史输入，并须在最终安全仓库变化收口后统一重建镜像和清单。
- available约1.9GiB、Swap约860MiB/1GiB且超过80%，资源停止线继续有效。

## 5. 当前判定

`DONE / TECHNICAL MATRIX AND DRIFT GATE VERIFIED / BUSINESS APPROVAL PENDING / RESOURCE STOP LINE ACTIVE / NO ACCOUNT OR DATABASE ACTION / PRODUCTION NO-GO`。仓库技术证据已闭合；A7d岗位职责、21条全员只读范围和2个legacy未达权限的保留/删除仍由业务负责人决定，任何批准结果变化都必须先改源码、重生成矩阵并重跑负向门。

## 6. 实施结果

- 新增`application-authorization-policy-v1.json`、186条操作的route contract、机器生成矩阵及生成器；矩阵固定11角色、158个授权permission、154个源码使用permission、30个dispatcher handler、56个授权源码文件和254个路由字面量。
- 175条操作为`PROTECTED`，其中110条写操作全部要求CSRF、幂等与事务审计；154条有普通角色拒绝，21条当前11角色均可读，仅以业务待批准finding放行技术重放。`admin`是唯一通配角色，但没有任何受保护操作只依赖admin通配形成正向证据。
- Dashboard的10个data domain直接复用导出的运行时role-domain源，并逐角色核对所需read permission。`material.import.commit`和`sales.reverse`被精确标为`LEGACY_GRANTED_NOT_REACHABLE`；动态构造的material approve/reject另有显式来源例外。
- 生成器对角色/通配、handler集合、授权源码manifest、permission定义与使用、route literal/prefix、method/path contract、Dashboard domain、允许/拒绝、写安全合同和制品自摘要失败关闭。矩阵SHA-256为`741bb74249fe9a88468a70c6d1f05b18cf6989ea7a6a7d10dd38b0b7ceb29a34`，授权源码manifest SHA-256为`2c4870ca99fc93627f487962182a00c0a530bcdc6df7db8750c4db10af1a1863`。
- release inventory由253/229/24更新为254/230/24，新增矩阵负测并同步runtime policy与release manifest contract；没有新增依赖、Schema、Migration、数据库或业务写。

## 7. 不可变提交与验证证据

- source`925f8a45edd19be7b27a845dadf621bf39883d8d`/tree`922221a6fbed0e03241852c85144755d078c4292`→monitor manifest-only`c1f1d5269e2ed88af8326e59177f7bb1a02eba25`/tree`edc80361ab4a32a9960c04e7670b1a7efd39b1fd`→Supervisor manifest-only`9b657f2458427482f6ed28c0178999d3d62877f2`/tree`2f1046654d710d2af0bdba8abbef7601676a3f97`形成30/126文件canonical链；manifest raw SHA-256为`3a9192af32542aea6bdd88e4a4e4d9e4900bac3210199ee9b99fc18a6f51b6f6`/`66a604fa4f880e3a009d3624894593e5ef4eefd6bc693eb2630ad146004c0da6`，两级生成器逐字节重放一致。
- 最终授权矩阵`10/10`、release gate`20/20`、release manifest contract`9/9`、Supervisor Python`36/36`及inventory verify通过；源码阶段凭据扫描通过1,722个版本化文件，治理收口加入TASK67文档后显式staged-tree凭据扫描通过1,723个文件，10个治理文件的本地Markdown链接检查及`git diff --check`通过。
- 首轮release gate暴露旧Pure Node计数锁并如实失败，已同步更新后重跑通过；Worker工具镜像的BusyBox `flock`不支持正式GNU参数，改用runtime policy锁定的Debian Node镜像重跑同一断言通过。没有跳过或降低断言。
- 起点/收口available均约1.9GiB、Swap约860MiB/1GiB且持续超过80%、根盘13GiB、Load低于1；四个并行环境容器保持running，Web/PostgreSQL healthy，restart 0/OOM false。一次一个的受限临时容器均`--rm`清零，精确凭据扫描临时文件已删除。
- 未读取`.env`、凭据、日志、业务行、备份或Volume正文，也未创建/修改账号、Session、PostgreSQL角色/ACL；未执行build、typecheck、Migration、数据库测试、镜像、部署、host/systemd、网络、UAT/生产或真实数据动作。
