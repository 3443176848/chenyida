# SELFHOST-PHASE4-TASK02：建立项目部门 → 计划部门产品/BOM/规格交接闭环

状态：`DOING`

开始日期：2026-07-25（Asia/Shanghai）

负责人：Codex（关系模型、服务端状态机、原生界面、隔离测试、并行环境验收、文档与独立提交）；项目负责人（固定业务决定、部署与验收边界授权）

## 可信起点

- Branch `main`，HEAD `0e380d0ae61655c59a27fcf0d3e70e51deb53a9b`，工作区 clean，相对 `origin/main` ahead 19 / behind 0。
- 自托管版本 `0.1.0-alpha.15`；PostgreSQL migration `0001`—`0015`。
- Compose 项目 `chenyida-erp-parallel`，Web 仅 `127.0.0.1:3000`；旧 Python PID `277640` 继续监听 `18888`。
- 真实 SQLite 不读取、不修改；不迁移真实数据、不双写、不切流。

## 唯一范围

只在 Node.js/PostgreSQL 自托管运行面建立已接收项目由项目负责人逐项关联已发布 Product Version 与 BOM Version、生成不可变零件规格快照、提交计划员、计划员接收或退回、项目负责人创建新包版本修订重提的闭环。新增正式 `planning` 角色；engineering 准备/提交，planning 只读/接收或退回，manager/admin 全能力。

## 交付内容

1. 新增 expand-only `0016_project_planning_handoff.sql`、Drizzle schema/journal/snapshot/checksum，保持 `0001`—`0015` 不变，并升级 Identity 角色约束。
2. 新增独立 `planning-handoff-selfhost` Repository/Service/Handler/Validation/Errors/Types 边界及规定的八条 API。
3. 对已 `ACCEPTED` 且由当前 engineering 项目负责人负责的项目执行逐行 Resolution；只接受客户一致的 RELEASED Product Version 及其 RELEASED BOM Version，BOM 全行必须引用 ACTIVE Material 与 enabled Unit。
4. 创建 DRAFT 时由 PostgreSQL numeric 计算毛需求数量并固化 Product/BOM/Material 规格及安全文件元数据快照；SUBMITTED 后包和快照不可修改，RETURNED 后创建新版本，事件只追加。
5. 新增 `/engineering/projects/:projectId/planning`、`/planning/handoffs` 原生页面并更新 Dashboard 计划部门入口和待接收数量。
6. 覆盖 migration、角色兼容、权限/CSRF/幂等/CAS、并发接收、职责分离、关系校验、不可变、故障回滚、文件披露和 TASK01 不退化测试。
7. 版本更新为 `0.1.0-alpha.16`；先创建功能提交，再仅在 `chenyida-erp-parallel` 执行 `0016`，完成实际退回→v2→重提→最终接收并清理验收数据，追加独立 ops 验收提交。

## 明确排除

- 不计算净需求，不读取库存，不创建物料需求、采购申请、采购订单、工单或生产事实。
- 接收不自动启动 TASK03；TASK03—TASK05 只记录后续。
- 不改写或扩写 TASK01 市场→项目交接表、需求版本或历史事件。
- 不读取或迁移真实 SQLite/D1/附件正文，不执行生产 migration、生产部署、HTTPS、公网开放、切流、push 或 PR。

## 完成判定

唯一允许结论：`PROJECT TO PLANNING HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`。

完成报告计划：`docs/tasks/SELFHOST-PHASE4-TASK02-completion.md`。
