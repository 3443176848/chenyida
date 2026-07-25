# SELFHOST-PHASE4-TASK04 API/UI 与业务验收清单

状态：`AUTOMATED PASS / PARALLEL JOURNEY PENDING`

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

## 原生 UI

- `/procurement/sourcing` 显示已接收申请、RFQ 状态以及待询价/待报价/待定标数量。
- `/procurement/sourcing/:rfqId` 显示来源、邀请、行、报价版本、服务端横向比价、MOQ/交期/税费/运费风险、人工理由和撤销。
- planning 只看到进度；purchase/manager/admin 才看到相应写控件；页面没有创建采购订单入口。

并行真实会话旅程、Compose 重启、恢复清理与最终状态将在独立 ops 提交中补齐。
