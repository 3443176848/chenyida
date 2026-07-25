# SELFHOST-PHASE2-TASK06 完成报告

完成日期：2026-07-25（Asia/Shanghai）

状态：`DONE`（非生产；独立提交完成后以 `git log -1 -- docs/tasks/SELFHOST-PHASE2-TASK06-completion.md` 解析 final HEAD/commit SHA）

## 1. Git、版本与 Migration

- Task start HEAD：`b4a7d5cde06df0b8982e7f120afd9f72c13af8d2`；branch `main`；起始工作区 clean，本地相对 `origin/main +6/-0`。
- Final HEAD / commit SHA：承载本报告的 `feat: add self-hosted production` 独立提交；提交无法在自身受哈希保护的正文中自引用最终 SHA。
- 版本：`chenyida-erp-selfhosted@0.1.0-alpha.5` → `0.1.0-alpha.6`；package/lock 一致，没有依赖升级。
- 新增 PostgreSQL `0010_production.sql`，SHA-256：`d60c4100f726d6572a9969c78cf06f64aa2f789d3a31d3be5fd58c22fa7dec35`；`0001`—`0009` 保持不变，Schema/snapshot/journal/generator consistency 对齐。

## 2. 数据模型与业务规则

- 关系化新增工单、状态事件、BOM 快照/行、物料需求、领料/行、退料/行、报工、完工/行及客户专用 Material 限制；全部使用稳定 Product/Product Version/BOM/Material/Unit/Inventory/User ID。
- 工单状态固定为 `DRAFT -> RELEASED -> IN_PROGRESS -> COMPLETED -> CLOSED`，允许满足条件的 DRAFT/RELEASED 取消；终态与已过账事实不可原地修改。
- RELEASE 在一个事务锁定 RELEASED Product/BOM Version，复制不可变快照并用 PostgreSQL numeric 计算六位小数需求；新 BOM 版本不改变既有工单。
- 成品必须显式引用既有 ACTIVE/STOCKED Material；客户专用料按产品 Customer 一致性 fail closed；不自动创建 Material、不做单位换算、替代料、超领或超产。

## 3. 服务、库存原子性与 API

- `production-selfhost/{types,rules,errors,repository,service,handler}.ts` 提供工单创建/修改/释放/取消/关闭、快照/需求/进度、领退料、报工和完工。
- 领料、退料和完工复用 TASK04 Inventory Service 的事务内入口；Production 事实、Ledger/Balance、状态事件、audit 和 idem 在同一 PostgreSQL 事务提交。注入库存/审计故障均整体回滚。
- 稳定 API 与 legacy `/api/work-orders`、`/api/work-order-materials`、`/api/production-reports`、`/api/work-orders/from-bom`、`/api/work-orders/issue-materials`、`/api/work-orders/complete` 由同一 Service 执行；兼容层不直接写库、不复制状态机、不调用 Python。
- 首笔领料或报工推进 IN_PROGRESS；报工只追加且数量受约束；完工只入成品库存、不重复扣原料，累计到计划量自动 COMPLETED。

## 4. 权限与安全

- 服务端固定 `production.read/plan/issue/report/complete/close`：admin/manager 全域，production 计划/报工，warehouse 领退料/完工，其他角色按需只读；legacy 一键操作不能绕过职责边界。
- 写接口统一执行 Session/must-change、CSRF、正文限制、输入校验、持久幂等/请求摘要、expected version、限流、请求编号、中文安全错误和事务审计。
- 数据库 guard 禁止非服务写工单/需求投影，并保护快照、状态事件、领退料、报工、完工及行不可变。

## 5. 验收结果

- TASK06：unit/UI 4/4；PostgreSQL/API 5/5；migration 3/3；typecheck、Schema consistency、Compose 初始/整栈重启 PASS。
- 回归：shared unit/UI 60/60；PostgreSQL/API 51/51；旧升级 18/18；Import 53/53；FileStorage 3/3；environment 6/6；lint 0 error/1 既有 warning；build 5/5；四项 typecheck、credentials 和 Python 三项 PASS。
- 首次全量 Material/Mapping PostgreSQL 回归发现当前迁移清单仍止于 `0009`；只把两条精确版本断言推进到合法 `0010`，全套复测通过。

## 6. 排除与生产保护

- 未实现 MRP/排程、设备、工时工资、完整成本、品质判定、销售发货、应收应付、自动替代、批次/序列、多库位、WIP、单位换算或历史业务更正流程。
- 未迁移真实 WO/BOM 快照/库存/用户/主数据；未访问生产 PostgreSQL/D1/公开 Site/SQLite，未执行生产 migration、部署、push 或创建 PR。
- TASK06 启动的隔离 PostgreSQL、Compose、网络、卷、临时 SQLite、上传和依赖均已清理；TASK07 代码或 migration 未提前创建。
