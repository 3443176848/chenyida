# SELFHOST-SMALL-TEAM-BUSINESS-BASELINE-86 小团队V1业务基线

> 状态：`DONE / BUSINESS BASELINE APPROVED / HEADCOUNT VARIABLE / DOCS ONLY / PRODUCTION NO-GO`
> 日期：2026-08-23（Asia/Shanghai）
> 依赖：D-166、TASK85、项目负责人确认九个业务职能暂按每职能2人估算且不得写死人数
> 责任：项目负责人确认容量原则；Codex核对现有源码、形成业务基线并同步治理文档

## 1. 目标

以第一性原理把“小团队版”从架构方向变成可验收的业务范围：固定V1完成定义、岗位责任、十条核心闭环、必需单据/报表、首期数据范围和源码`KEEP / PARK / REMOVE_LATER`处置。人数只作容量估算，不改变账号、权限或业务规则。

## 2. 源码事实核对

- 身份目录有11个技术角色：`admin`、`manager`、`purchase`、`engineering`、`planning`、`production`、`warehouse`、`quality`、`sales`、`finance`、`operations`。
- `app_users`按账号保存一个服务端角色，没有每角色人数唯一约束或席位计数；创建多少账号由受控用户管理决定。
- 九个业务职能按管理、市场、工程、计划、采购、仓库、生产、品质、财务各2人估算为18人；`admin`和`operations`属于治理职责，不自动追加固定业务人数。
- 自托管源码当前有50个原生`page.tsx`页面、37个`app/lib`一级模块目录、46项PostgreSQL Migration及233张Schema表。现有handler/service覆盖主数据、项目、计划、采购、库存、生产、品质、销售和财务，但源码存在不等于员工UAT完成。
- 源码仍为alpha.47/0046，运行UAT仍为alpha.42/0040；本任务未访问UAT数据库或业务数据，运行状态只沿用权威文档和只读容器metadata。

## 3. 交付结果

- 新增[`docs/business/small-team-v1-baseline.md`](../business/small-team-v1-baseline.md)，固定九个业务职能、可变人数、十条闭环、必需单据/报表、首期试迁移边界、源码处置和完成路线。
- 新增D-167：每职能2人只作18人容量参考，不得成为Schema、Seed、权限、并发、许可证或验收硬条件。
- 现有11个技术角色和单角色账号模型本任务不变；真实员工兼岗需求出现前不新增多角色平台，也不得用共享/重复账号绕过审计。
- 下一任务固定为`SELFHOST-SMALL-TEAM-GOLDEN-JOURNEY-READINESS-87`，在隔离PostgreSQL中证明现有代码的黄金旅程覆盖，再按真实P0缺口拆分实施。

## 4. 禁止范围

- 不修改业务代码、Schema、Migration、API、依赖、镜像、Compose、账号或运行服务。
- 不连接UAT/生产数据库，不读取受保护Volume、真实备份正文、凭据或业务数据。
- 不创建18个账号，不把“2人”写入代码或数据库，不启动Migration、build、部署、员工UAT或生产切换。
- 不删除`PARK`或`REMOVE_LATER`候选；删除必须另立任务并完成依赖审计和恢复保护。

## 5. 验收

- D-167、业务基线、MASTER、TASKS、PROJECT_CONTEXT、CHANGELOG和STATUS对齐，当前回到零`DOING`。
- 变更只涉及Markdown治理/业务文档；用户既有未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`保持不读、不改、不提交。
- 身份/授权/工作台Node合同38/38、发布Node合同76/76、fixed-executor Python合同130/130及Python三项基线通过；lint退出0，最终diff和精确变更文件敏感信息检查通过。
- 前后available均约2.3GiB，Swap 139→143MiB/1GiB，根盘均约11GiB，Load由`0.39/0.38/0.24`到`0.32/0.60/0.43`；四服务restart0/OOM false、宿主`oom_kill=0`，断网只读限额测试容器与任务临时文件均清零。
- 未连接UAT/生产、未启动PostgreSQL测试、build、Migration、部署或账号操作；完成后创建独立Git提交，不push、不部署。
