# SELFHOST-UAT-FIX-36 — PO History Traceability Read Model and UI Fix

## 状态、授权与起点

- 状态：`DOING（功能与隔离验收已通过；正式备份、恢复、Web-only部署和主UAT待执行）`。
- 日期：2026-08-08（Asia/Shanghai）。
- 授权：为现有 PO ID 1 / `PO-00000001`补齐受限、只读、可刷新重开的聚合谱系、Line、Delivery Plan/queue、Event/Audit/Idempotency及下游零状态；完成隔离测试、正式备份恢复、Web-only部署和purchase-only主UAT只读验收。
- 严格起点：clean单一worktree `main@a67886428570612b21bc372a0a2a53fe90eac439`，Parent `e67c9209bc24314000f70760b7b79282c4a9b469`，behind 0 / ahead 173；`0.1.0-alpha.40`；Migration 0001—0039且无0040；Web `sha256:83c1bff341294d1bee2db8fd2ee963204012cfac63f1289ba7d3755ca2920664`。
- 起点运行保护：PO/Line/Plan/queue `1/4/4/4`；Receipt、Warehouse Receipt、Inventory Ledger/Lot、IQC、AP/Payment、Work Order、生产报告/完工记录全部为0；四服务restart 0/OOM false。

## D-105与业务保护

- PO业务结构完整；原始写入无法绑定到仓库内事前授权任务。D-105是受控保留后的前向只读授权，不是追溯性授权，也不补办原始写入授权。
- 产品页面只展示关系化业务事实，不硬编码PO编号或D-105，不声称“授权已验证”。D-105只记录在本任务报告和项目治理文档。
- 不修改、取消、关闭或删除PO、Line、Plan、queue；不重试Award→PO；不修改Award/RFQ/Quote/Comparison/Binding/Mapping；不新增或运行Migration；不执行到货、收货、IQC、入库、AP、付款或生产动作。

## 受限读模型与UI合同

1. 新增按稳定PO ID读取的受限DTO；先沿PO→Award→RFQ→PRQ执行purchase对象数据域校验，再在同一repeatable-read/read-only事务读取聚合事实。
2. 展示Project→MRP→PRQ→RFQ→Comparison→Quote→Award→PO、三类摘要、四条PO Line稳定引用、四条直接绑定PO Line的Delivery Plan及queue。
3. 只投影与该PO成功转换精确关联的PO Event、Audit和Idempotency摘要，不授予purchase `system.audit.read`，不返回请求正文、响应正文、Cookie、Session或Header。
4. 历史失败Audit没有保存Award/PO对象ID，也没有持久化HTTP状态；仅在同actor/action、Award形成后到成功转换前恰好唯一且业务写计数为0时，作为`UNBOUND_PRIOR_ATTEMPT`单独展示。HTTP 422明确标为旧稳定错误合同投影，不冒充数据库字段或成功PO同一次操作；出现歧义时失败关闭且不泄漏其他Audit。
5. 下游计数只沿目标PO外键、receipt/finance链、目标Project生产链或成功request范围查询，并明确OPEN/PENDING/OPEN_PENDING均不代表收货、库存增加或下游执行。
6. 详情使用独立可重开URL；桌面可读，390×844使用摘要卡、Line卡、Plan/queue卡和折叠凭证，无页面级横向溢出；ID/UUID/digest可换行、选择和复制；状态以文本表达。
7. 页面不提供PO、Line、Plan、queue编辑控件，也不包含到货、收货、IQC、财务或生产写按钮。

## 测试、部署与主UAT

- 串行覆盖聚合、四Line谱系、四Plan/queue、受限凭证、成功/失败区分、下游零、无编辑、跨数据域403、purchase无`system.audit.read`、桌面/390×844、刷新/历史重开及Award/PO/Delivery Plan/0039/安全回归。
- 测试使用隔离PostgreSQL和浏览器；不连接生产写路径，不修改0039或新增0040。
- 全部通过后执行root:root 0600 custom dump、大小/SHA-256、`pg_restore --list`及第二新库恢复；固定`COMPOSE_PARALLEL_LIMIT=1`，只替换Web，不运行Migration，不重建PostgreSQL/Worker/Caddy，不修改四个受保护Volume。
- 主UAT只登录purchase，只读打开目标PO详情，核对桌面/390×844、刷新、重开和全部零状态；路由层阻断业务POST，最终`business_post=0`、保护指纹前后相同、Session失效。
- 功能与部署验收分别创建独立提交；不push、不PR、不改写历史。

## 功能阶段结果

- 已新增通用`PO_HISTORY_TRACEABILITY_V1`受限DTO和独立详情URL。服务端先复用RFQ→PRQ purchase数据域判断，再在同一`REPEATABLE READ READ ONLY`事务投影PO聚合、完整上游谱系、四条Line、四条Plan/queue、受限Event/Audit/Idempotency摘要、独立历史失败Audit及下游计数；不授予purchase `system.audit.read`。
- 成功Audit按真实Award ID关联，不依赖Award ID与PO ID偶然同号；隔离PostgreSQL专门以Award ID 41 / PO ID 1验证通过。GET刷新/重开保持业务指纹不变，跨数据域为403，历史路由非GET为405且不写失败Audit。
- 页面没有表单或PO/Line/Plan/queue编辑控件；桌面使用聚合谱系与表格，390×844改用Line卡、Plan/queue卡和折叠凭证；状态同时显示代码与中文，UUID、digest、request_id可换行和复制。
- 主库只读保护已通过：`state_fingerprint=721f25f875e4e3af7cc8401f9bff9dadcc959092047844d446461999afa60594`、`history_fingerprint=d11b46bc41f59bcc7b10a19041940664c37c0753c65160a17551322652b14ae7`，business POST 0、PO/Line/Plan/queue `1/4/4/4`、下游全0、前后不变。
- 用户任务文本中的成功`request_id`少了末尾`d`且不是合法UUID；数据库、既有审计报告和本读模型的真实值均为`773c23b6-0923-4ab5-a451-bb80aa4bdf9d`。产品只展示数据库值，不补写、不截断。
- 隔离回归通过：PO专项Unit/UI 9/9、Fulfillment PostgreSQL 6/6及偏移ID专项1/1、Sourcing/Binding PostgreSQL 20/20、0019/0038/0039升级`3/3 + 5/5 + 6/6`、安全/Origin/Identity、两个typecheck、全量lint、npm 3/3、Python三项、credentials 1,287文件及隔离Chromium 1/1。Chromium覆盖桌面/390×844、刷新、历史重开、服务重启、Session0和下游0。
- 候选Web为`sha256:664e0ac6bd289251f289a8785ac05d955470064a3f921c3ae834f79665a4ec89`、88,658,388 bytes；尚未部署，当前UAT Web仍为`sha256:83c1bff3…`。没有运行Migration或修改主业务数据。

## 允许的最终状态

- `PO HISTORY TRACEABILITY FIXED — UAT DOWNSTREAM UNCHANGED`
- `PO HISTORY TRACEABILITY REQUIRES SCHEMA — UAT UNCHANGED`
- `BLOCKED — NO UNSAFE CHANGE`

完成后立即停止，不执行到货、收货、IQC、入库或AP。
