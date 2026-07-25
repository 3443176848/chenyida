# SELFHOST-PHASE2-TASK08：自托管 IQC/IPQC/FQC、缺陷、处置与关闭

状态：`DONE`（非生产实现、隔离验收、文档与独立提交范围已完成）

开始日期：2026-07-25（Asia/Shanghai）

负责人：Codex（诊断、实现、隔离测试、文档与本地提交），项目负责人（通过连续任务指令批准 TASK08 范围、稳定品质关系及禁止事项）

## 1. 起始基线

- Branch：`main`；Task start HEAD：`0ad0687a7b2f2502f68babbef1455df2a983421b`（`feat: add self-hosted sales`），Parent 为 TASK06 提交 `97d541ecfb7fe6fff551c750c69f5cf30e3ff5bc`。
- TASK07 已独立提交且工作区 clean；本地 `main` 相对 `origin/main +8/-0`；无 TASK07 测试容器、卷、网络或临时数据库。
- 自托管版本 `chenyida-erp-selfhosted@0.1.0-alpha.7`；PostgreSQL `0001`—`0011`，下一合法版本为 `0012_quality.sql`。
- `0011_sales.sql` SHA-256 为 `6d97c854ecd2fd47f4540c0403de097332f406c7d9f5155c2355dd44d5a57e3b`；不得修改 `0001`—`0011`。

## 2. 数据和关系边界

- IQC 只关联稳定 Purchase Receipt Line；IPQC 只关联稳定 Production Report；FQC 同时关联 Production Completion Line 与 Sales Order Line，并校验 Material/Unit 一致。
- Inspection Header 保存不可变来源、Material/Unit、检验/合格/不良数量；Result Lines 和 Defects 只追加。处置、关闭、重开使用不可变 Event，Header 只保留受控投影和 optimistic version。
- 不使用自由 `ref_type/ref_id`、名称、编码或 JSON 作为业务关系。legacy `/api/quality-inspections` 和 `/api/quality-defects` 只转换 DTO 并委托同一 Quality Service。

## 3. 首期业务决定

- 数量统一 PostgreSQL `numeric(24,6)`；`passed_qty + failed_qty = inspected_qty`，失败必须有缺陷，缺陷累计不得超过 failed quantity。
- 新检验一律 `OPEN/PENDING`，即使全部合格也不自动放行。处置由与检验创建人不同的授权用户执行：`RELEASE`、`CONCESSION` 形成明确放行数量；`REWORK`、`RETURN_TO_SUPPLIER`、`SCRAP` 保持 HOLD。
- 只有完成处置后才能关闭；重开只追加事件并恢复 PENDING/零放行。已经被发货消费的 FQC 放行额度不得被降低或重开。
- Shipment 只消费已 `CLOSED/RELEASED` 的 FQC 数量；累计有效发货不得超过 Sales Order Line 的累计有效放行数量。关闭 FQC 时同时校验 Completion Line 与 SO Line 的累计放行上限。
- 当前库存没有批次/隔离库位，无法把 IQC 结果安全映射到某一剩余库存数量；TASK08 只建立 Receipt Line 的可信品质状态，不通过全局 freeze 伪造批次隔离。IPQC 同理只关联不可变 Report，不改写工单/报工历史。

## 4. 安全、验收与禁止事项

- 权限固定 `quality.read/inspect/defect/disposition/close/reopen`；quality 创建检验/缺陷/处置/关闭，manager/admin 全域，reopen 仅 manager/admin；采购、生产、仓库、销售、财务按职责只读。
- 写接口执行 Session/must-change、CSRF、256 KiB、输入校验、24h 幂等、请求摘要、expected version、限流、请求编号、中文安全错误和事务审计。
- 验收覆盖三类来源、数量守恒、缺陷、职责分离、处置/关闭/重开、FQC 可发额度、并发关闭/发货、故障回滚、legacy UI、migration、Compose restart 和全部适用回归。
- 不实现批次/抽样方案/AQL/SPC/实验室仪器、供应商索赔、返工工艺、自动报废/退供、库存批次隔离、退换货、财务过账、真实数据迁移或 Python 新业务；不访问生产、不部署、不 push、不创建 PR；TASK08 完成前不创建 TASK09 代码或 migration。

## 5. 实施结果

- 新增独立 `quality-selfhost` Repository/Service/Handler，以及 inspection/result/defect/event 四类关系表、稳定来源 FK、不可变事实 guard、数量/来源/跨对象一致性约束和 `0012_quality.sql`。
- IQC 绑定已过账 Receipt Line，IPQC 绑定 Production Report，FQC 绑定 Completion Line 与 SO Line；创建失败检验时结果与缺陷原子写入，不从 legacy 自由引用推断或回填。
- Quality 创建、追加缺陷、独立处置、关闭和管理者重开均使用 expected version、事务审计和持久幂等；直接数据库越权写、已关闭事实篡改和超量缺陷 fail closed。
- Sales Shipment 在原有 SO/Inventory 锁事务内检查 `CLOSED/RELEASED` FQC 额度；冲销恢复额度，已消费额度时禁止重开，未改写任何既有 Shipment、Receipt、Report 或 Completion 事实。
- legacy 品质页面改用稳定来源选项和受保护写请求；全部合格仍需明确处置与关闭，不由浏览器计算权威数量或自动放行。

## 6. 验收与版本

- 专项：unit/UI 5/5、PostgreSQL/API 8/8、migration 3/3；Sales PostgreSQL 3/3；跨域 Identity/Master Data/Inventory/Procurement/Production PostgreSQL 回归、共享 unit/UI 70/70、FileStorage 3/3、environment 6/6 均通过。
- Compose：空库执行 `0001`—`0012`，完成 FQC 创建、异人处置/关闭、发货；Web/Worker 重启后 inspection/result/event/audit 持久性通过，测试容器、网络和卷已清理。
- 工程：lint 0 error（仅保留物料工作簿脚本 1 条既有 warning）、TASK08 typecheck、Vinext build 5/5、凭证扫描 581 文件、Python self-test/smoke/go-live 和 `git diff --check` 通过。
- PostgreSQL migration 最终 SHA-256：`64f065783769c0913af482402199b10f9224a1a81e52c30a3b8a087978bcd5bf`；`0001`—`0011` 未修改。包版本为非生产 `0.1.0-alpha.8`。
- 未迁移真实检验/库存/出货数据，未访问生产、部署、push 或创建 PR；完整记录见测试验收与完成报告。
