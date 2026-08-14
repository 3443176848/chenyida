# SELFHOST-AUTHORIZATION-ROLE-PERMISSION-MATRIX-66 11角色机器权限矩阵与路由漂移门

> 状态：`DOING / READ-ONLY AUTHORIZATION AUDIT AND LIGHTWEIGHT REPOSITORY IMPLEMENTATION / BUSINESS APPROVAL PENDING / RESOURCE STOP LINE ACTIVE / NO ACCOUNT OR DATABASE ACTION / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@7c69385c5ee35d517e9611fe04f55ae17be4f194` / tree `7d19d1d9fa161dc273652ce21f1478708035d507`
> 责任：Codex主智能体唯一写入、轻量测试调度、证据集成和Git提交；项目负责人/业务负责人保留岗位职责批准、真实账号、角色分配、UAT/生产及数据访问专项授权

## 1. 背景与目标

源码实际定义11个员工角色及动态权限集合，但当前权限证明散落在`IDENTITY_ROLES`、`permissionsForRole`、各handler的`requirePermission`、Dashboard domain裁剪和大量手写测试中。既有API inventory只证明历史64条legacy路径有实现，不能证明当前全部服务端路由都有明确permission、每个角色的允许/拒绝结果可重放，也不能发现新增planning等权限后测试矩阵漂移。

本任务只在仓库建立版本化、机器可生成的“角色→permission→API method/path→data domain”证据和负向合同。技术矩阵只能记录当前实现事实与待批准差异，不替代业务负责人对职责分离的批准；不创建或修改账号、Session、数据库角色/ACL、UAT/生产数据或运行配置。

## 2. 验收标准

- [ ] 完整审计11个`IDENTITY_ROLES`、`permissionsForRole`动态组合、Dashboard domains、全部self-hosted handler和现有权限测试，列出机器源、重复/漂移和无法静态证明的边界。
- [ ] 建立版本化canonical权限目录，精确枚举11角色、所有permission、API method/path pattern、所需permission、读写性质、CSRF/幂等/审计期望和data domain；禁止用文档手填副本代替源码校验。
- [ ] 生成11角色对每个受保护API操作的ALLOW/DENY矩阵，并显式记录`BUSINESS_APPROVAL_PENDING/APPROVED/REJECTED`，技术生成不得把未获业务批准的职责判断标成已接受。
- [ ] 失败关闭检测角色增删、permission未使用/未定义、handler路由未纳入、路由无服务端permission、方法或路径漂移、Dashboard domain越权及通配`*`意外扩散。
- [ ] 对每个路由至少证明一个允许角色和一个拒绝角色；敏感写操作覆盖跨岗拒绝、CSRF、幂等和审计合同，admin通配不能成为唯一正向证据。
- [ ] 机器生成制品确定性、内容摘要可重放，并纳入release test inventory/候选绑定；旧手写矩阵仅保留补充证据。
- [ ] 只执行不连接数据库/网络的轻量Node/静态测试；Swap超过80%期间不启动build、全量Node/PostgreSQL、Docker数据库、typecheck或镜像任务。
- [ ] 更新MASTER、TASKS、PROJECT_CONTEXT、CHANGELOG、STATUS、DECISIONS和投产授权包，执行敏感信息与`git diff --check`，创建独立Git提交后自动选择下一安全任务。

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

`DOING / READ-ONLY AUTHORIZATION AUDIT AND LIGHTWEIGHT REPOSITORY IMPLEMENTATION / BUSINESS APPROVAL PENDING / RESOURCE STOP LINE ACTIVE / NO ACCOUNT OR DATABASE ACTION / PRODUCTION NO-GO`。先收集精确角色、权限、路由和data-domain机器源，再以最小代码改动建立可重放矩阵与漂移门；真实岗位批准和账号变更保持外部阻塞。
