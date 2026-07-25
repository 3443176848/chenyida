# SELFHOST-PHASE4-TASK01：建立市场部门 → 项目部门需求交接闭环

状态：`DOING`

开始日期：2026-07-25（Asia/Shanghai）

负责人：Codex（关系模型、服务端状态机、原生界面、隔离测试、并行环境验收、文档与独立提交）；项目负责人（固定业务决定、部署与验收边界授权）

## 可信起点

- Branch `main`，HEAD `0f15f271cc458343116cb6639f0d118eea37521b`，工作区 clean，相对 `origin/main` ahead 17 / behind 0。
- 自托管版本 `0.1.0-alpha.14`；PostgreSQL migration `0001`—`0014`。
- Compose 项目 `chenyida-erp-parallel`，Web 仅 `127.0.0.1:3000`；旧 Python PID `277640` 继续监听 `18888`。
- 真实 SQLite 不读取、不修改；不迁移真实数据、不双写、不切流。

## 唯一范围

在现有 Node.js/PostgreSQL 自托管运行面新增客户需求从市场部门整理、提交项目部门、项目部门接收或退回、市场修订重提并最终形成稳定项目记录的闭环。底层角色继续复用 `sales` 与 `engineering`；不新增角色，不自动创建 Product、BOM、销售订单、采购单、工单或任何计划/采购/生产流程。

## 交付内容

1. 新增 expand-only `0015_market_project_handoff.sql`、Drizzle schema/journal/snapshot/checksum，保持 `0001`—`0014` 不变。
2. 新增独立 `project-selfhost` Repository/Service/Handler/Validation/Errors/Types 边界，提供项目、交接和受控文件引用 API。
3. 强制 `DRAFT -> SUBMITTED -> ACCEPTED` 与 `SUBMITTED -> RETURNED -> RESUBMITTED` 状态机；需求内容按不可变版本保存，交接事件与系统审计只追加。
4. 实现 `/business/projects` 与 `/engineering/projects` 原生页面并更新 Dashboard 入口。
5. 覆盖 migration、权限、CSRF、持久幂等、CAS、并发接收、职责分离、文件安全引用、故障回滚、审计/request_id 和 UI 恢复测试。
6. 版本更新为 `0.1.0-alpha.15`，先创建功能提交，再仅在 `chenyida-erp-parallel` 执行 `0015` 并用独立 sales/engineering 测试账号完成实际闭环验收；清理测试业务记录但保留 Schema 与管理员，追加独立 ops 验收提交。

## 明确排除

- 不启动 TASK02，不进入计划、采购询价、生产、品质、完工、发货或财务成本。
- 不读取或迁移真实 SQLite、D1、附件正文或其他真实业务数据。
- 不执行生产迁移、生产部署、HTTPS、公网开放、切流、push 或 PR。
- 不重新实现 Customer、FileStorage、Idempotency、Audit 或 Identity 权限基础设施。

## 完成判定

唯一允许结论：`MARKET TO PROJECT HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`。

完成报告计划：`docs/tasks/SELFHOST-PHASE4-TASK01-completion.md`。
