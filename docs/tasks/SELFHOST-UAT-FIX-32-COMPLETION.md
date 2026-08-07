# SELFHOST-UAT-FIX-32 完成报告 — Award to PO Conversion Confirmation Contract Fix

## 最终状态

`AWARD TO PO CONFIRMATION FIXED — UAT PO NOT CREATED`

完成时间：2026-08-07（Asia/Shanghai）。功能、隔离正式转换、正式备份恢复、Web-only部署和purchase-only主UAT取消验收均完成；主UAT没有创建PO或Delivery Plan。

## 起点与范围

- 严格起点完全匹配：`main@c5af2fa1f8dbcfbb523b91cd00b63a91e9d72a8a`，Parent`a0147429d9b463650242c2115f0222b75008edeb`，behind0/ahead167、clean、单一worktree、无并发Award/PO任务；alpha.40、0001—0039、Web`sha256:bb544f89ac405c9565fa551c4120c89d4cc58022220db9a3f46c548a6533a81d`。
- 主基线：RFQ1 CLOSED/v7、Quote2、Comparison Version1、Award1/v1/AWARDED、Award Line1—4、Award Event9、PO0、Delivery Plan0、`po_convertible_now=true`、`awardable_now=false`。
- 本任务只修Award→PO确认合同和既有转换端点保护；不新增或运行Migration，不修改主UAT Award、Quote、Comparison、RFQ、Binding或任何下游业务事实。

## 根因与两阶段合同

旧“显式生成采购订单”按钮第一次点击即调用`POST /api/procurement/awards/1/purchase-orders`，把查看范围与不可逆业务写合并成一次动作。

修复后：

1. 首次点击只发送无缓存权威GET并打开本地Loading/确认窗口。
2. 取消、关闭、ESC和背景关闭均为0业务POST，默认焦点为取消。
3. 只有明确最终确认才发送POST；按钮在DOM事件中立即禁用并由同步ref阻止React重绘前双击。
4. 失败后本窗口保持锁定，不自动重试；重新尝试必须关闭窗口并重新读取权威预览。
5. 延迟GET在窗口取消后返回不会复活旧窗口。

## 确认窗口权威字段

- Award ID1/v1/AWARDED、`po_convertible_now=true`、PO计数0。
- RFQ ID1 / RFQ-00000001 / CLOSED / v7、Comparison Version1/CURRENT、Quote1/v1。
- Supplier ID1 / SUP-000001 / Supplier A；付款条件“纯虚拟UAT付款条件，仅用于表单验收。”；CNY、未税、不含运费。
- Award Event ID9，actor`uat_20260729_purchase`，时间`2026-08-07 20:02:24.641511 Asia/Shanghai`，request_id`4634fff1-988d-465b-92c6-34ffe214ddda`，SUCCESS。
- 持久化Award摘要`7ac6bf2eb579b13460d2d0b9496127c4a75cda73efa605e8ec291b4212a66e55`。
- 派生`AWARD_DECISION_V1`摘要`7beca9f364718d9161cc4205e282279cdcc97e3fee91073f3494b76abfa7651a`。

| Award Line | Material | 数量 | 单价 | 金额 | 计划日期 |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | 533 / CYD-RB_PCB-000016 | 10 PCS | 12.00 CNY | 120.00 CNY | 2026-10-20 |
| 2 | 534 / CYD-RB_SENSOR-000003 | 10 PCS | 12.00 CNY | 120.00 CNY | 2026-10-20 |
| 3 | 535 / CYD-RB_CONN-000075 | 10 PCS | 12.00 CNY | 120.00 CNY | 2026-10-20 |
| 4 | 536 / CYD-RB_METAL-000015 | 10 PCS | 12.00 CNY | 120.00 CNY | 2026-10-20 |

窗口明确显示一次转换、一个PO、四条PO Line、总额480.00 CNY和四个逐行计划聚合；每条PO Line固定引用对应Award Line。Award、RFQ、Quote、Comparison不会被修改，也不会自动创建Receipt、Warehouse Receipt、Inventory Ledger、IQC、AP、Payment、Work Order或其他生产/财务记录。供应商到货、仓库收货和IQC属于后续独立任务。

## 外部参考与备注模型结论

- 现有`purchase_orders`有正常Header`remark`字段，转换DTO允许最多2,000字备注。窗口允许填写“纯虚拟UAT采购订单，仅用于黑盒验收，不对应真实采购。”。
- 现有PO模型没有外部参考字段。窗口准确显示“当前PO模型未采集外部参考”，没有挪用税务、地址、物料规格或其他字段。
- 本任务没有新增0040，验收口径不要求保存`UAT-PO-AWARD-042576`。

## 服务端权威与事务边界

- 最终DTO只接受Award/RFQ CAS、两类摘要、完整Award Line ID、PO零计数等确认断言及正常PO备注；浏览器不提交或决定Supplier、Material、Unit、数量、单价、币种、交期和转换范围。
- 服务端继续验证purchase权限、Origin/CSRF、幂等键和正文摘要；先处理成功幂等回放，再取得Award advisory lock。
- 最终确认在同一事务连接重算完整Sourcing/Award预览并锁定Award、RFQ、PRQ、四条唯一Line、Comparison、固定Quote、Supplier、Material、Unit和Mapping；CAS、摘要、状态、PO计数或任何引用漂移均失败关闭。
- 成功时按Supplier+Currency确定性聚合，并在一个事务创建PO、PO Line、purchase order source link、Award→PO Line link、逐行Delivery Plan、收货队列、PO/计划Event、成功Audit和幂等响应；故障时全部回滚。
- Delivery Plan真实模型没有独立Header/Line两层；每个`purchase_delivery_plans`记录就是直接唯一绑定一条PO Line的计划聚合。

## 自动测试与隔离正式转换

- Fulfillment Unit`4/4`、UI`3/3`、PostgreSQL`3/3`；Sourcing Unit`12/12`、UI`24/24`、Sourcing/Binding PostgreSQL`27/27`。
- 0018/0019/0039隔离升级`3/3 + 3/3 + 6/6`；Origin/CSRF/Identity安全`30/30`；npm`3/3`；Python self-test/smoke/go-live通过。
- typecheck、production build、lint 0 error/11既有warning、1,273文件credentials扫描和`git diff --check`通过。
- 隔离Chromium证明Loading取消不复活、四种退出0 POST、默认取消焦点、失败POST恰好1且500ms内无重试、重新打开后双击成功只新增1 POST，以及桌面/390×844无页面级横向溢出。
- 隔离正式结果：1个PO、4条PO Line、4个Award Link、4个Delivery Plan、4个收货队列；每条固定对应Award Line1—4。Award及全部上游不变，Receipt/Ledger/IQC/AP/Payment/Work Order均0。
- `max=2`连接池双并发结果为一个201和一个409；同Key同正文回放原结果，异正文冲突。强制故障后PO、Line、source/status event、Award link、Plan、queue、Plan event、成功Audit和幂等记录全部0。

## 正式备份与恢复

- 正式dump：`/var/backups/chenyida-erp/award-po-confirmation-fix32-predeploy-20260807T144538Z.dump`。
- 元数据：root:root、mode0600、单硬链接、2,294,098 bytes；SHA-256`75e45758f3f220f118ec98c8e2351274c4e640aa3c046507a2b294cebdaf3d97`；`pg_restore --list`3,359项。
- Web→Worker短停期间主数据库其他连接为0；备份后按Worker→Web启动原容器。
- 第二新库`award_po_confirmation_fix32_restore_20260807t144538z`单事务恢复通过：39/head0039、226表、四个basis摘要、RFQ/Quote/Comparison/Award/Line/Event、四条Material/Candidate、480.00 CNY/2026-10-20及全部下游0均匹配。
- 初始恢复验证SQL误用了不存在的派生`output_digest`列和错误物料表名；恢复本身成功，新库按规则保留。只读确认真实Schema后在同一恢复库完成断言，没有盲目重建；最终连接0并精确删除恢复库。

## Web-only部署

- 新Web：`sha256:2396c8bc4fd5658c26cef11c4a438b2edb474607b73b2b8ee7fe337b125575ed`，88,626,192 bytes。
- 旧Web：`sha256:bb544f89ac405c9565fa551c4120c89d4cc58022220db9a3f46c548a6533a81d`，88,616,950 bytes；精确回退tag`chenyida-erp-parallel-web:rollback-award-po-confirmation-fix32-predeploy-20260807T144538Z`保留。
- 固定`COMPOSE_PARALLEL_LIMIT=1`，只以`--no-deps --no-build --pull never --force-recreate web`替换Web。PostgreSQL、Worker、Caddy身份和部署前启动时间不变；未运行Migration，不重建三者，不修改四个受保护Volume。
- Web/PostgreSQL healthy，Worker/Caddy running，HTTPS`/api/health`返回ok；四服务restart0/OOM false。

## 主UAT只读取消验收

- 只登录`uat_20260729_purchase`（purchase），没有登录其他角色。浏览器路由层阻断除login/logout外全部业务POST。
- 桌面1440×900打开Award1转换窗口，权威preview GET恰好1；完整谱系、Event、两类摘要、Supplier/付款条件、四行、数量/金额/日期、上下游边界全部匹配。
- 390×844无页面级横向溢出；填写UAT备注后没有点击最终确认，点击取消并刷新，PO和Delivery Plan仍为0。
- 首次流程已完成上述取消和`POST /api/logout=200`，Session API已为anonymous，但验收器错误等待该履约页未维护的sourcing专用auth dataset而超时。只读核验Session0、PO0、Plan0和Award/RFQ不变后，仅把断言改为该页真实“请先登录。”匿名UI，再执行一次完整复验并通过。
- 最终输出：`preview_get=1 business_post=0 desktop=1 mobile=1 cancelled=1 session=0`；PO前后0、Delivery Plan前后0。
- 最终主数据：RFQ CLOSED/v7、Quote2、Comparison v1、Award1/v1/AWARDED、Award Line4、Award Event9、PO/Plan0；全部Receipt/Ledger/IQC/AP/Payment/Work Order0。

## 资源、OOM/restart与清理

- 起点available约2.1GiB、Swap约274MiB、根盘18GiB；正式运维前Load约`0.47/0.91/0.94`。最终available约2.1GiB、Swap239MiB、根盘18GiB、Load`0.71/0.38/0.62`。
- 全部重任务串行；available未低于768MiB，Swap未接近80%，Load未持续超过4。任务时段和当前启动内核OOM记录均0；四服务restart0、OOMKilled false。
- 隔离/恢复数据库、临时容器、Playwright runtime、Python venv/SQLite临时备份和测试资源均精确清零。删除项只属于本任务且不可恢复；正式dump、当前/候选/回退镜像及四个受保护Volume保留。未执行任何prune。

## Git与后续条件

- 功能提交：`a4ffb8ee022234ea25add4ce636050366ac6887a`，`fix: add Award to PO conversion confirmation`。
- 部署/UAT/完成文档由独立`ops: deploy Award to PO confirmation fix`提交收口；实际SHA以`git log`为准。
- 未push、未PR、未amend/rebase/reset或改写历史；最终工作区应clean，behind0/ahead169。
- 当前具备重新执行正式Award→PO转换的技术前置条件，但不具备业务授权。新任务必须重新核验Award/RFQ/Comparison/Quote/Event/摘要/四行、PO0、Supplier/Mapping、权限、CAS、幂等、审计和备份，并取得明确最终确认授权；随后仍需独立任务处理供应商到货、仓库收货和IQC。

完成后立即停止；本任务没有创建主UAT PO。
