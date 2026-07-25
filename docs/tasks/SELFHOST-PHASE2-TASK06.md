# SELFHOST-PHASE2-TASK06：自托管生产、领退料、报工与完工

状态：`DONE`（非生产；由 `feat: add self-hosted production` 独立提交承载）

开始日期：2026-07-25（Asia/Shanghai）

负责人：Codex（诊断、实现、隔离测试、文档与本地提交），项目负责人（通过连续任务指令批准本任务范围、最低业务规则和禁止事项）

## 1. 起始基线

- Branch：`main`；Task start HEAD：`b4a7d5cde06df0b8982e7f120afd9f72c13af8d2`。
- 起始工作区 clean；本地 `main` 相对 `origin/main +6/-0`；无 gitlink、submodule 或嵌套仓库。
- 自托管版本 `chenyida-erp-selfhosted@0.1.0-alpha.5`；PostgreSQL `0001`—`0009`，下一合法版本为 `0010_production.sql`。
- `0001`—`0009` checksum 已逐文件核验，`0009` 为 `351b322f562e39bf0e17cf16cd6da20de6d801ff33f7692300a85c15403874d7`。
- 附件所称 `docs/project/API-INVENTORY.md` 与 `MIGRATION-PLAN.md` 实际不存在；已读取仓库中的权威等价文件 `docs/audits/SELFHOST-PHASE2-TASK01-api-inventory.md` 与 `docs/self-hosting/full-erp-api-migration-plan.md`。

## 2. 任务范围

- 关系化工单、状态事件、不可变 BOM 快照与快照行、物料需求投影、领料/退料、生产报工和成品完工入库。
- 工单先以 DRAFT 创建，显式 RELEASE 时锁定 PUBLISHED/RELEASED BOM Version 并在同一事务形成快照与需求；发布后计划产品、计划数量和快照不可原地修改。
- 领料、退料和完工调用 TASK04 Inventory Service 的事务内入口，业务记录、Ledger/Balance、状态、审计和幂等必须单事务提交。
- 支持稳定 API 及 legacy `/api/work-orders`、`/api/work-order-materials`、`/api/production-reports`、`/api/work-orders/from-bom`、`/api/work-orders/issue-materials`、`/api/work-orders/complete` DTO 兼容。

## 3. 固定业务边界

- 状态机：`DRAFT -> RELEASED -> IN_PROGRESS -> COMPLETED -> CLOSED`，DRAFT 可取消为 `CANCELLED`；RELEASED 只有尚无领退料、报工或完工时可取消。终态不可变。
- 工单编码使用事务内 `business_code_sequences`，格式 `WO-000001`；禁止 COUNT/MAX 取号。
- 数量统一 numeric(24,6)。需求量为 `round(plan_qty * quantity_per * (1 + loss_rate), 6)`，使用 PostgreSQL numeric 计算，半离零舍入；TASK06 不做单位换算。
- Release 必须引用 RELEASED Product Version 和 BOM Version；BOM 行 Material 必须 ACTIVE/STOCKED、基础单位启用且 BOM Unit 等于基础单位。客户专用 Material 只允许用于同一客户产品；缺少可证明的客户一致性时 fail closed。
- 成品必须显式引用既有 ACTIVE/STOCKED Material，基础单位启用；不得按产品编码自动创建或激活成品 Material。
- 净领料不得超过快照需求，退料不得超过该需求的净领料；首笔有效领料或报工把工单推进到 IN_PROGRESS。
- 报工记录只追加；`reported_qty > 0`，good/scrap 均非负且二者之和不得超过 reported。TASK06 不实施品质判定。
- 完工数量必须大于零且不得超过计划剩余量；完工入库不会再次扣原料。累计完工等于计划量时自动 COMPLETED。
- 首期只使用 TASK04 的 MAIN/空 lot/基础单位库存，不实现批次、序列、多库位、WIP 库位、单位换算、自动替代或超产。

## 4. 权限、安全与验收

- `production.read/plan/issue/report/complete/close` 分离。admin/manager 全域；production 可创建/释放/报工，warehouse 执行领退料和完工入库；engineering/quality/purchase/finance/sales/operations 只获得确有必要的读取。
- legacy 一键领料和完工仍必须经过同一 Service、权限、CSRF、Idempotency-Key、expected version、库存 expected balance version、请求编号、限流和事务审计。
- 验收覆盖 unit、legacy UI contract、隔离 PostgreSQL/API、migration 空库/0009 升级/重复/失败回滚/约束/索引、并发、幂等、故障回滚、库存一致性、Compose restart 和全部适用回归。

## 5. 禁止事项

不实现 MRP/排程、设备、工时工资、完整成本、品质流程、销售发货、应收应付、自动替代料、真实数据迁移或 Python 新业务；不访问生产、不部署、不 push、不创建 PR；TASK06 完成并恢复 clean 前不创建 TASK07 代码或 migration。

## 6. 完成结果

- 版本已推进至 `0.1.0-alpha.6`，新增 `0010_production.sql`，SHA-256 为 `d60c4100f726d6572a9969c78cf06f64aa2f789d3a31d3be5fd58c22fa7dec35`。
- 正式验收见 `SELFHOST-PHASE2-TASK06-test-acceptance.md`，完成边界见 `SELFHOST-PHASE2-TASK06-completion.md`。
- 所有专项、Compose restart、适用全回归与 Python 隔离基线通过；未访问生产、迁移真实数据、部署、push 或创建 PR。
