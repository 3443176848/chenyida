# SELFHOST-PHASE2-TASK06 启动诊断与设计记录

日期：2026-07-25（Asia/Shanghai）

## 启动核验

- `main` HEAD 为 `b4a7d5cde06df0b8982e7f120afd9f72c13af8d2`，提交信息 `feat: add self-hosted procurement`，父提交 `41b451de04d4bc4b5e3f6fe765ff64fbc19a9121`。
- 工作区 clean，`origin/main +6/-0`，仓库只有根 `.git`，没有嵌套仓库或来源不明修改。
- `0001`—`0009` SHA-256：`c1cd7180…1702`、`2d8d4fac…eb80`、`8ce85955…dbf`、`1bb0eb9b…aa39`、`e4f2dc62…cdcc`、`6e185d01…079`、`0e9cf932…3a6`、`49334afa…a80b`、`351b322f…74d7`；TASK05 未修改 0001—0008。
- TASK05 Compose/临时资源已由完成报告记录清理；启动时无工作区临时产物。未访问公开 Site、生产数据库或常驻 Python 数据。

## 现状诊断

- Python legacy 只有 3 GET + 3 POST 生产操作。`from-bom` 创建后即为“已下达”，动态复制 BOM 到 `work_order_materials`；一键领完剩余需求并直接减库存；`complete` 同时写报工、增加 `FG-{product_code}` 文本库存和累计完工。它缺少稳定 Product/BOM/Material/Unit 外键、快照来源、CAS、幂等、并发锁、退料、冲销和不可变保护，且会自动制造成品编码，因此只能保留 UI 行为证据，不能机械移植。
- PostgreSQL 已有关系化 Product/Product Version/BOM/BOM Line、ACTIVE Material/Unit 和 TASK04 Ledger/Balance；没有生产语义表。`erp_records` 及 0001 文本库存表不得成为新写目标。
- TASK04 已提供 `InventoryService.postInTransaction()`，能在调用者事务中以稳定物料顺序锁定、写 Inventory Adjustment/Ledger/Balance。TASK06 应复用该边界，并把生成的 adjustment/ledger ID 关系化写回生产单据。
- legacy 前端真实路径为 `/api/work-orders`、`/api/work-order-materials`、`/api/production-reports`、`/api/work-orders/from-bom`、`/api/work-orders/issue-materials`、`/api/work-orders/complete`；现有页面没有 expectedVersion/幂等辅助字段，需要兼容 adapter 从服务端读取当前版本与库存版本，但不能复制状态机。

## 设计选择

1. 新增 `0010_production.sql`，不改 0001—0009；建立 WO、状态事件、BOM snapshot/header/line、requirement、issue/return header/line、report、completion/line，全部稳定 FK。
2. 成品 Material 作为工单必需外键。稳定新 API 要求客户端显式提供；legacy from-BOM adapter 只在 Product 有且仅有一个可证明的 ACTIVE/STOCKED 客户一致 Material 映射时允许，否则返回安全阻断，不自动创建。
3. DRAFT 创建与 RELEASE 分开；legacy from-BOM 以一个 Service 事务完成 create+release，保持用户体验而不放松快照与状态规则。
4. Release 在 PostgreSQL numeric 内计算六位需求，`round(..., 6)`，避免 JavaScript 浮点。快照行保存 quantity/loss/unit，需求保存 required/net issued 投影。
5. 领料/退料/完工以业务 Header/Line 为稳定来源；Inventory Adjustment 是 TASK04 的实际库存来源，生产 Line 保存 ledger 外键。业务投影更新只能通过 production service GUC，已过账明细/快照使用 trigger 禁止 UPDATE/DELETE。
6. 首期职责分离：production 管计划/报工，warehouse 管库存过账；manager/admin 可全域。legacy production 用户的一键库存动作会得到 403，这比绕过仓库职责更安全。
7. CLOSED/CANCELLED 不产生库存反向动作；已有库存动作的撤回只能通过显式退料。完工冲销不在附件 TASK06 最低范围内，故已完工入库不可修改；更正能力作为后续受控 reversal 扩展记录，不伪造本期支持。

## 执行顺序

1. 追加 Schema/migration/journal/snapshot 和迁移专项测试。
2. 新建 `production-selfhost` rules/repository/service/handler，接入身份权限与 selfhost dispatcher。
3. 增补 legacy UI DTO/安全写辅助和 unit/UI/PostgreSQL/Compose 测试。
4. 运行全量适用回归，修复本任务引入问题；更新全部治理文档与完成报告。
5. 检查 staged 范围、checksum、凭证和临时资源后创建唯一提交 `feat: add self-hosted production`。
