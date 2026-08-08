# SELFHOST-UAT-FIX-37 — Warehouse Receipt Readiness and Date Safeguards 完成报告

## 最终结论

`WAREHOUSE RECEIPT READINESS FIXED — UAT RECEIPT NOT POSTED`

- 日期：2026-08-08（Asia/Shanghai）。
- 交付：仓库收货页已具备最小权限只读谱系、关系化证据、服务端日期保护、两阶段最终确认、单事务重验及准确的IQC职责/库存会计说明。
- 主UAT边界：只使用`uat_20260729_warehouse`读取`PO-00000001`、打开桌面/390×844确认预览并取消；未填写虚假证据，业务POST为0，最终有效warehouse Session为0。
- 最终业务状态：PO/Line/Delivery Plan/queue为`1/4/4/4`；Receipt、Warehouse Receipt Evidence、Lot、IQC、Inventory Ledger、AP、Payment、Work Order和生产记录全部为0。

## 严格起点与D-105保护

| 门禁 | 核验结果 |
| --- | --- |
| Git | 唯一worktree、clean `main@a40660cc3ba8e74495c919ba0f2602485597fc38`；Parent `bdb4fd07e76e405f418833aeaf5b0c9c4b5e5ae7`；behind0/ahead175 |
| 版本/Schema | `0.1.0-alpha.40`；Migration 0001—0039；0039 SHA-256 `3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37` |
| Web | `sha256:664e0ac6bd289251f289a8785ac05d955470064a3f921c3ae834f79665a4ec89` |
| PO | ID1 / `PO-00000001` / v1 / OPEN；Supplier 1 / `SUP-000001`；40 PCS；已收0；480.00 CNY |
| 明细 | PO Line、Delivery Plan、queue为`4/4/4`；各Line 10 PCS/已收0；Plan 1—4均PENDING/v1/2026-10-20；queue 1—4均OPEN_PENDING/v1 |
| 下游 | Receipt、Evidence、Lot、IQC、Ledger、AP、Payment、Work Order和生产记录全0 |
| warehouse身份 | active；`must_change_password=false`；version5；有效Session0；未再次轮换密码 |
| 保护指纹 | 状态`721f25f875e4e3af7cc8401f9bff9dadcc959092047844d446461999afa60594`；历史`d11b46bc41f59bcc7b10a19041940664c37c0753c65160a17551322652b14ae7` |

D-105继续只提供前向控制，不追溯授权原始PO写入。产品代码没有硬编码`PO-00000001`或D-105，没有删除、修改、取消、重建或再次转换该PO，也没有为页面建立特殊PO治理标记。

## Schema诊断、0040与版本

现有`purchase_receipts`、`purchase_receipt_lines`和`purchase_receipt_delivery_allocations`能保存收货及分配，但不能关系化保存送货来源凭证、证据日期、提前到货原因/显式确认，以及最终POST所依据的PO/Line/Plan/queue CAS快照；自由备注不适合承载这些结构化事实。因此采用用户指定的新Migration分支：

- 版本从`0.1.0-alpha.40`升至`0.1.0-alpha.41`。
- 唯一新增`0040_warehouse_receipt_readiness.sql`；SHA-256为`b6781c94da3f52a8f719ce57cdf13acbb4e3fe1c66f2a0480bdb6a9ff10a5a93`。
- 0039及更早Migration未修改或重排；Drizzle Schema、0040 snapshot和journal已同步。
- 新`warehouse_receipt_evidence`逐Receipt唯一绑定Receipt、Receipt Line、Delivery Plan和queue；Receipt Line继续沿既有Allocation关系绑定PO/PO Line。
- 字段关系化保存证据类型/引用、证据日期、提前到货布尔值/原因/显式确认、物理收货确认、固定目标`MAIN`、PO/Line/Plan/queue及库存余额预期版本、actor、request_id和服务端created_at。
- 外键、唯一索引、CHECK与不可变服务触发器验证完整谱系、服务写上下文、actor/request/time一致、四类业务版本从预览值推进1、Ledger balance version、MAIN位置、未来证据日期及提前到货投影；UPDATE/DELETE失败关闭。

Supplier批次不塞入Evidence自由字段：需要IQC/批次管理的物料继续由既有内部RML Lot模型保存Supplier lot；不适用时DTO明确显示`NOT_APPLICABLE`。当前主样本四个Material均为`STOCKED/NORMAL`，因此Supplier批次不适用，也没有伪造批次。

## warehouse最小权限只读谱系

新增`WAREHOUSE_RECEIPT_READINESS_V1`，只对warehouse获准数据域公开：

- PO稳定ID、编号、Version、状态、Project、Supplier、币种、含税/运费、金额和付款条件。
- 唯一成功PO创建凭证的actor、Asia/Shanghai时间、request_id、operation、Action与SUCCESS。
- 每条PO Line稳定ID、Award Line、Material ID/编码、订购/已收/未收数量。
- 每条Delivery Plan ID/Version/状态/计划日期，以及对应queue ID/Version/状态。
- Receipt、Evidence、Lot、IQC、Ledger、AP、Payment、Work Order和生产对象当前计数。
- 服务端当前时间/业务日期、收货时间生成规则、计划日期、提前到货投影、Supplier批次适用性、固定MAIN、本次/剩余数量、经办账号及事务后果。

DTO和页面明确：PO OPEN不代表已到货，Plan PENDING不代表已收货，queue OPEN_PENDING不代表库存增加；当前操作是实际物理收货，不是Supplier通知或在途登记。warehouse未获`system.audit.read`，DTO不返回请求/响应正文、Cookie、Session、敏感Header、密码/Token摘要；跨数据域对象返回403。

## 两阶段确认与服务端门禁

1. 第一阶段只填写空白数量/说明/证据字段并点击“核对收货”。
2. 浏览器仅发送权威GET，服务端重新读取PO、Line、Plan、queue、剩余量、版本、服务器时间和后果，再打开确认窗口。
3. 确认窗口默认焦点为“取消”；取消、关闭按钮、ESC和背景关闭均不发送业务POST。
4. 只有证据及显式物理收货确认完整时“确认过账收货”才可用；点击后立即禁用，不自动重试。
5. 最终POST拒绝客户端实际收货时间，重新锁定PO/Line/Plan/queue并验证状态、剩余量、PO/Line/Plan/queue CAS、权限、CSRF、Origin、限流、正文幂等和服务端当前日期。

证据日期晚于服务端Asia/Shanghai当前日期时以稳定错误拒绝；服务端事务时间早于计划日期时属于提前到货，必须同时具有送货单/物流交接/等价凭证、提前到货原因和显式提前确认，缺失返回`EARLY_ARRIVAL_EVIDENCE_REQUIRED`及中文提示。计划日期只作为比较基准，不写成实际到货时间。Receipt、Line、Allocation、Evidence、Plan/queue状态、Lot/IQC/Ledger、Audit和幂等结果在同一事务；任一异常全部回滚。

## IQC、Lot与库存会计实际边界

本任务没有为了统一文案修改既有库存会计语义；页面根据服务端Material模式逐行投影：

| Material模式 | 收货事务实际结果 | 下一责任 |
| --- | --- | --- |
| 需要IQC的库存物料 | 创建Receipt；创建内部RML冻结Lot；生成`IQC_RECEIPT` Ledger；冻结数量增加，可用量保持0；创建Supplier incoming IQC队列 | quality独立判定；合格后按既有流程解冻/增加可用量 |
| `STOCKED/NORMAL` | 创建Receipt；不创建RML Lot、IQC冻结或IQC队列；生成普通`RECEIPT` Ledger并立即重算可用库存 | warehouse收货事务完成；没有Supplier IQC步骤 |

主样本Material 533—536当前均为`STOCKED/NORMAL`，所以主UAT确认预览准确显示第二行语义。首次只读UAT发现旧静态说明错误宣称这些物料需要IQC，runner立即安全停止；当次business POST为0、Session0、业务状态不变。修正为按mode投影并完成隔离NORMAL/IQC双路径验证后，才重建、Web-only替换并执行最终UAT。

warehouse对Supplier IQC写接口返回403，quality保持既有授权。warehouse首页不再把“供应商来料IQC”列为其获准业务。不合格、退货、让步接收均为独立操作；收货不会自动创建AP、Payment、Work Order或生产记录。

## 测试与隔离验收

- Unit/UI/Dashboard/Procurement组合`22/22`通过；Origin运行时精确匹配专项通过。
- Identity Unit/UI `9/9 + 10/10`、Supplier Mapping `6/6 + 5/5`、Sourcing `12/12 + 24/24`、Fulfillment `16/16 + 5/5`、Dashboard `7/7 + 6/6`回归通过。
- 完整隔离Fulfillment PostgreSQL `9/9`通过；随后按真实mode修正后，NORMAL只读投影和IQC成功路径专项`2/2`通过。
- 0040 Migration隔离`3/3`：空库升级和重复执行、0039已有数据升级及约束、失败回滚；恢复库又独立验证0039→0040及重复执行。
- 写路径覆盖数量空/0/负/超剩余、未来日期、提前到货缺证据、提前到货完整证据成功、陈旧PO/Line/Plan/queue CAS、幂等重放、异正文冲突、并发单胜、CSRF、Origin、warehouse/quality权限、限流和中途故障零半记录。
- 实际事务断言覆盖Receipt、Allocation、Evidence、RML Lot、冻结库存、普通/IQC Ledger、可用量和下游零自动创建；所有PostgreSQL及Chromium写路径只连接隔离数据库。
- UI覆盖取消/关闭/ESC/背景关闭零POST、最终按钮同步禁用/不重试、桌面和390×844无页面级横向溢出，以及logout后back/forward/refresh与Session失效。
- 既有PO、Award、RFQ、Quote、Comparison和Mapping回归通过；TypeScript typecheck、production Docker build、敏感信息扫描及`git diff --check`通过。
- 当前package没有`lint` script，因此未伪称执行`npm run lint`；以现有typecheck、专项/回归测试和production build作为本任务适用静态/构建验证。Docker build报告16项既有依赖审计告警（1 low、4 moderate、11 high），未通过本任务扩大范围升级依赖。

## 正式备份、恢复、迁移与部署

- 正式dump：`/var/backups/chenyida-erp/warehouse-receipt-readiness-fix37-predeploy-20260808T120636Z.dump`；root:root、0600；2,298,941 bytes；SHA-256 `28e07b9dc04e686d5077fe9f68968ffb1a4253979d64b80317307f8543bc0868`。
- `pg_restore --list`为3,359行。第二新库`warehouse_receipt_readiness_fix37_restore_20260808`恢复39/head0039并核对PO/Line/Plan/queue`1/4/4/4`和全部下游0，再升级0040、验证新表/触发器/业务状态并重复执行无变化；完成后精确删除。
- 一次恢复库Migration因测试环境名保护在连接前失败关闭，未建立连接或写入；改用用户已明确授权的production migration显式参数后成功。没有放宽保护器。
- 主库受控应用0040，最终为40/head；新Evidence表0行，全部受控业务事实保持。
- Web最终镜像：`sha256:0cf98937f3ae28fe68e84436ab85c12ef5e8922f50a04973641cb79b8a0d5f19`，88,678,839 bytes。旧Web `sha256:664e0ac6bd289251f289a8785ac05d955470064a3f921c3ae834f79665a4ec89`以`chenyida-erp-parallel-web:rollback-warehouse-receipt-readiness-fix37-predeploy-20260808T120941Z`保留。
- 仅recreate Web；PostgreSQL、Worker和Caddy容器身份/启动时间未更换。Web/PostgreSQL healthy，Worker/Caddy running，四服务restart0/OOM false；四个受保护Volume名称完整保留，未prune。

## 主UAT零写验收

最终runner只使用`uat_20260729_warehouse`并得到：

```text
WAREHOUSE_RECEIPT_READINESS_UAT_READONLY_OK database=chenyida_erp actor=uat_20260729_warehouse po=1 code=PO-00000001 status=OPEN amount=480.00_CNY line=4 plan=4 queue=4 receipt=0 lot=0 iqc=0 ledger=0 ap=0 payment=0 work_order=0 production=0 business_post=0 before_fingerprint=48e2f2138541aea589f3e6a2a5b9c9b312036786ff13f27bb3baf2722c4bd013 after_fingerprint=48e2f2138541aea589f3e6a2a5b9c9b312036786ff13f27bb3baf2722c4bd013 desktop_cancel=4 mobile_cancel=1 back_forward_refresh=1 session=0
```

- 只读核对完整PO创建凭证、四Line/Plan/queue、计划日期2026-10-20和全部下游0；跨数据域PO历史接口403。
- 桌面覆盖取消、关闭、ESC和背景关闭，390×844覆盖取消；没有填写数量、送货单、Supplier批次、日期、提前原因或收货说明，最终按钮保持不可用。
- 浏览器拦截并计数业务POST为0；登录/退出Identity POST不计为业务POST。
- logout后back/forward/refresh均保持匿名；最终warehouse有效Session为0。
- 最终PO v1/OPEN、四Line各v1/OPEN/10 PCS/已收0、四Plan PENDING/v1/2026-10-20/已收0、四queue OPEN_PENDING/v1；Receipt/Evidence/Lot/IQC/Ledger/AP/Payment/Work Order/生产记录全0。

## Git、资源与清理

- 功能提交：`a6fc8b33af73d5ffd0da03566ef1f28d4207722b`，`feat: safeguard warehouse receipt readiness`。
- 语义修正提交：`20a9123741862d81ac18af9e6bdee896674fe95c`，`fix: project receipt accounting by inspection mode`。
- 部署、UAT、D-106和项目文档由独立`ops: deploy warehouse receipt readiness safeguards`提交收口；未push、未创建PR、未amend/rebase/reset或改写历史。
- 起点available约2.0GiB、Swap 273MiB/1GiB、根盘17GiB，1分钟Load低于4；最终收口available 2.1GiB、Swap 285MiB/1GiB、根盘17GiB、Load `0.45/0.37/0.44`。Swap未接近80%，任务内无OOM，四服务restart0/OOM false。
- 隔离/恢复数据库和最终验证容器均精确删除；Playwright临时目录通过`gio trash`移入可恢复Trash且原路径不存在。正式dump、当前/回退Web镜像按恢复要求保留；未执行prune，未删除或重建四个受保护Volume。

## 后续门禁

本任务只证明仓库收货流程已具备安全准备条件，不是实物到货证明，也不授权主UAT最终POST。任何真实收货必须另立任务、重新核验当时PO/Line/Plan/queue状态和真实送货证据，并明确授权最终POST；quality的IQC决定、AP、付款、Work Order及生产操作仍须各自独立授权。
