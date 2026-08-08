# SELFHOST-PHASE4-TASK04 API/UI 与业务验收清单

状态：`AUTOMATED PASS / PARALLEL JOURNEY PASS`

## API 与权限

| 路由 | 权限 | 验收重点 |
| --- | --- | --- |
| `GET/POST /api/procurement/rfqs` | `procurement.rfq.read/manage` | 已接收队列、RFQ 队列、最新申请、ACTIVE Supplier、1:1 Mapping、CAS |
| `GET /api/procurement/rfqs/:id` | `procurement.rfq.read` | 来源、行、候选、报价历史、最新比较、Award、事件 |
| `POST /api/procurement/rfqs/:id/issue` | `procurement.rfq.manage` | 发出时重验 Supplier/Mapping，发出后不可改 |
| `POST /api/procurement/rfqs/:id/quotes` | `procurement.quote.record` | 完整行、CNY、MOQ/价格/交期/条款、当前版本唯一 |
| `POST /api/procurement/quotes/:id/revise` | `procurement.quote.record` | 旧版 SUPERSEDED、新版 SUBMITTED，CAS/并发一次成功 |
| `POST /api/procurement/rfqs/:id/comparisons` | `procurement.quote.compare` | PostgreSQL numeric、固定分组和排序、basis 唯一 |
| `GET /api/procurement/comparisons/:id` | `procurement.rfq.read` | 只返回服务端保存排名与风险，不由浏览器重算 |
| `POST /api/procurement/rfqs/:id/award` | `procurement.sourcing.award` | 当前报价/最新比较、唯一供应商、理由、数量/MOQ/交期 |
| `POST /api/procurement/awards/:id/reversal` | `procurement.sourcing.reverse` | 只追加撤销信息与事件，历史不删除 |
| `GET /api/procurement/awards/:id/purchase-order-conversion-preview` | `procurement.award.convert` | 只读重算完整谱系、摘要、固定Binding/Mapping逐行资格和PO/计划零计数；不写Audit或业务事实 |
| `POST /api/procurement/awards/:id/purchase-orders` | `procurement.award.convert` | 最终显式确认；锁后复用同一资格loader重验CAS/摘要/行集/Quote/Binding/Mapping并创建PO、逐行Line与计划 |

所有写路由均验收 Session/must-change、权限、CSRF、128 KiB 正文上限、Idempotency-Key、expected_version、稳定 request_id/中文错误、单事务 Audit/Event/Idempotency 和安全异常响应。

## 自动化验收覆盖

1. 非 ACCEPTED/非最新申请、非 ACTIVE Supplier、缺 Mapping 阻断。
2. RFQ 发出后行不可改；同申请有效 Round 唯一。
3. 两供应商报价与两次修订，旧报价保留为 SUPERSEDED。
4. 过期报价无排名且不可定标；不同税/运费口径不混排。
5. MOQ 不足和晚交期标记；当前同口径按价格、交期、Supplier ID 排序。
6. 单一报价必须 `SOLE_SOURCE`；非最低价、晚交期、超量均要求显式理由。
7. 一行一个供应商，Award/撤销历史不可改删；定标不产生 PO。
8. 幂等重放、异正文冲突、CAS、并发比较/定标、故障注入回滚。
9. TASK01—TASK03 及 Identity、Supplier Mapping、Procurement、Dashboard 回归。
10. Award 前后 PO/Receipt/Inventory Ledger/Finance/Planning Allocation 计数与 `reserved_qty` 保护。
11. Award转PO入口、取消、关闭、ESC和背景关闭均为0业务POST；取消Loading后迟到preview不得复活窗口，默认焦点为取消。
12. 最终按钮DOM同步禁用，失败后不自动重试；重新打开后双击只有一个POST。隔离四行结果恰为1个PO、4条PO Line、4个直接计划聚合，Award和上游不变，全部收货/库存/IQC/财务/生产记录为0。
13. UAT同构四条ACTIVE 1:1 Mapping在legacy `base_unit_id=NULL/base_uom=PCS`下全部qualified；GET与POST共用`AWARD_PO_MAPPING_QUALIFICATION_V1`行结果和资格摘要。
14. 每行严格闭合Award Line→Candidate→Quote Line→RFQ Binding→固定Mapping fact/version/CAS/digest；bigint保持字符串，三条Mapping Event不得放大为三条ACTIVE Mapping。
15. 缺失、两条ACTIVE冲突、停用、未生效、过期、Supplier/Material停用、Unit不一致、非1:1及固定事实漂移均返回具体Award Line/Supplier/Material错误，失败的PO/Line/Plan/queue全部为0。
16. 无关Mapping变化不改变资格摘要；固定Mapping治理写与转换并发无死锁且只能得到成功或稳定漂移失败。隔离成功计数固定为PO/Line/Plan/queue `1/4/4/4`。
17. 确认窗口桌面表和390×844卡片完整展示四行资格凭证；主UAT验收只能打开、核对、填写备注后取消，business POST必须为0。

## 原生 UI

- `/procurement/sourcing` 显示已接收申请、RFQ 状态以及待询价/待报价/待定标数量。
- `/procurement/sourcing/:rfqId` 显示来源、邀请、行、报价版本、服务端横向比价、MOQ/交期/税费/运费风险、人工理由和撤销。
- planning 只看到进度；purchase/manager/admin 才看到相应写控件；页面没有创建采购订单入口。

并行实际结果：临时 planning/purchase 账号完成 must-change 门禁和分权；Supplier A `12.000000`、准时、价格排名 2，Supplier B `10.000000`、晚交、价格排名 1。采购以 `DELIVERY_PRIORITY` 和“交期优先，避免项目延期”选择 A，Award=1，PO/Receipt/Inventory Ledger/Finance/Planning Allocation 均为 0，`reserved_qty` 保持 `2.000000`。Compose 重启后事实持久；随后整体恢复干净 0018 点，最终 18 migrations、唯一管理员、业务 0。
