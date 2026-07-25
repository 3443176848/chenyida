# SELFHOST-PHASE2-TASK07：自托管报价、销售订单与发货

状态：`DONE`（非生产；独立提交完成后以 `git log -1 -- docs/tasks/SELFHOST-PHASE2-TASK07-completion.md` 解析 final HEAD/commit SHA）

开始日期：2026-07-25（Asia/Shanghai）

负责人：Codex（诊断、实现、隔离测试、文档与本地提交），项目负责人（通过连续任务指令批准 TASK07 范围、原子转单/发货与禁止事项）

## 1. 起始基线

- Branch：`main`；Task start HEAD：`97d541ecfb7fe6fff551c750c69f5cf30e3ff5bc`，Parent 为 TASK05 提交 `b4a7d5cde06df0b8982e7f120afd9f72c13af8d2`。
- 起始工作区 clean；本地 `main` 相对 `origin/main +7/-0`；无 gitlink、submodule、嵌套仓库或 TASK06 临时资源。
- 自托管版本 `chenyida-erp-selfhosted@0.1.0-alpha.6`；PostgreSQL `0001`—`0010`，下一合法版本为 `0011_sales.sql`。
- `0010_production.sql` SHA-256 为 `d60c4100f726d6572a9969c78cf06f64aa2f789d3a31d3be5fd58c22fa7dec35`；`0001`—`0010` 已逐文件核验。

## 2. 范围与数据边界

- 关系化报价 Header/Version/Line、销售订单 Header/Version/Line、Quote→SO 唯一来源 Link、状态事件、Shipment/Line/全额冲销和 TASK09 可消费的稳定销售金额来源。
- 所有业务关系使用 Customer、Product/Product Version、Material、Unit、可选 BOM/WO、Inventory Source 和 User 内部 ID；名称/编码只作显示快照，不作写主键。
- 新建 `sales-selfhost/` Repository/Service/Handler；稳定 API 与 legacy `/api/quotations`、`/api/quotations/to-sales-order`、`/api/sales-orders`、`/api/shipments`、`/api/shipments/from-order` 统一委托该 Service。

## 3. 首期业务决定

- 货币固定为 `CNY`，金额由 PostgreSQL numeric 计算至六位；TASK07 不支持税、折扣、汇率或含税/未税换算，报价和订单金额均按未税记录。
- Quote 使用 DRAFT 当前版本；修订创建新 Version/Lines，不修改旧版本。显式转换后 Quote/Version 为 CONVERTED，唯一 Source Link 保证只能生成一个 SO。
- SO 直接 OPEN，不引入未批准的销售审批；Line/版本创建后不可原地修改。发货投影为 `OPEN -> PARTIALLY_SHIPPED -> SHIPPED`，已全部发货可关闭。
- 成品必须显式引用既有 ACTIVE/STOCKED Material 和 enabled 基础单位；不按 Product code 自动创建 Material。legacy UI 增加稳定成品 Material 选择。
- 销售角色创建/修订/转换 Quote 和创建 SO；warehouse 执行 Shipment 和全额 reversal；admin/manager 全域。FQC/hold/release 属于 TASK08，TASK07 不伪造检验结论或品质记录。
- Shipment 锁定 SO Line 与成品余额，禁止超发和负库存，调用 TASK04 Inventory Service 事务入口；Shipment、SO 投影、Ledger/Balance、状态、销售金额来源、audit、idem 单事务。
- 已发货事实不可修改/删除；首期只允许一次全额冲销，追加 reversal Shipment、反向库存流水与负金额来源，并恢复未关闭 SO 的可发投影。

## 4. 安全、验收与禁止事项

- 权限固定 `sales.read/quote/order/ship/reverse/finance_source.read`；写接口执行 Session/must-change、CSRF、256 KiB、输入校验、24h 幂等、请求摘要、expected version、限流、请求编号、中文安全错误和事务审计。
- 验收覆盖 quote version、原子转换、唯一来源、并发编码/转换/发货、部分/全部发货、超发/库存不足、全额冲销、numeric 金额、故障回滚、权限、legacy UI、migration、Compose restart 和全部适用回归。
- 不实现 AI 报价、税/折扣/汇率、信用额度、销售审批、预留库存、退货入库/换货、部分冲销、FQC 处置、自动应收/收款/总账、真实数据迁移或 Python 新业务；不访问生产、不部署、不 push、不创建 PR；TASK07 完成前不创建 TASK08 代码或 migration。

## 5. 完成结果

- 已新增 `0011_sales.sql`、独立 `sales-selfhost` Repository/Service/Handler、稳定与 legacy API 委托、权限矩阵及旧销售页面稳定 ID 接入；版本推进至非生产 `0.1.0-alpha.7`。
- 报价版本/状态事件、ACCEPTED 原子转单、直接 OPEN 订单、部分/全部发货、一次全额冲销、库存 Ledger/Balance、销售金额来源、审计和幂等均按上述边界实现。
- 专项、迁移、Schema consistency、Compose 整栈重启、全量 Node/PostgreSQL 与 Python 基线全部通过；正式记录见 `SELFHOST-PHASE2-TASK07-test-acceptance.md` 和 `SELFHOST-PHASE2-TASK07-completion.md`。
- 未迁移真实销售/库存/金额数据，未创建应收、收款、总账或品质结论，未访问生产、部署、push 或创建 PR。
