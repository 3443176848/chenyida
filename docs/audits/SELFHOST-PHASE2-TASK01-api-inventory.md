# SELFHOST-PHASE2-TASK01 完整 ERP API 盘点

盘点日期：2026-07-24（Asia/Shanghai）

源码基线：`12d3ea30d21cce6918de0c525d81f19af289f5ac`

数据边界：只读源码、Schema 与 migration；未查询或输出任何业务数据库正文。

> 2026-07-25 TASK05 更新：下表主数据、库存与采购相关项已按 `0.1.0-alpha.5` 实际实现修正；本节 4/9/51 数字保留 TASK01 原始盘点基线，不冒充当前重新汇总。

## 1. 口径与结论

`chenyida_erp_app/server.py` 的 `AppHandler` 共暴露 **64 个 HTTP 操作**：GET 34、POST 30。按迁移业务域统计如下：

| 业务域 | GET | POST | 合计 |
| --- | ---: | ---: | ---: |
| 身份与系统管理 | 6 | 5 | 11 |
| 基础主数据、工程与物料治理 | 12 | 10 | 22 |
| 采购与库存 | 5 | 4 | 9 |
| 生产 | 3 | 3 | 6 |
| 销售 | 3 | 4 | 7 |
| 品质 | 2 | 1 | 3 |
| 财务 | 3 | 3 | 6 |
| **总计** | **34** | **30** | **64** |

以“是否存在等价的 Node/PostgreSQL 服务端能力”而不是“PostgreSQL 是否有同名表”为口径：

| 覆盖状态 | 数量 | 说明 |
| --- | ---: | --- |
| 已覆盖 | 4 | `health`、`session`、`login`、`logout`；路径和核心用途均已存在 |
| 部分覆盖 | 9 | 物料/导入/复核已有更严格的新工作流但不兼容旧路径/DTO；备份恢复只有受控 CLI 脚本、没有 API |
| 未覆盖 | 51 | 没有等价 Node 服务层/API；`erp_records` 或库存占位表不能改变此结论 |

页面位置缩写：`P` = `chenyida_erp_app/static/app.js`，`L` = `chenyida_erp_site/public/erp/app.js`，`H` = 两套 `index.html`。`P:init` 指 P:1104—1126 的登录后并发加载，`L:init` 指 L:1075—1097。自托管状态缩写：`C` 已覆盖、`P` 部分覆盖、`N` 未覆盖。风险：`H/M/L` 为高/中/低。

所有受保护 Python GET 默认需要 `read`；下面只写例外或写权限。Python 审计均为 `activity_log` 简单文本，没有 request ID、结果、对象 ID 或失败审计；“无审计”表示连该文本日志也没有。

## 2. 身份与系统管理（11）

| # | Method / path；页面调用 | Python 权限；输入与校验 | SQLite / 文件读写 | 事务、联动、审计与过账 | 自托管、PG 结构、缺口、风险与依赖 |
| --- | --- | --- | --- | --- | --- |
| S01 | `GET /api/health`；无业务页面直接调用 | public；无输入 | 无 | 无事务、无审计、无业务过账 | `C`；自托管查询 PostgreSQL 并返回 storage/worker；L |
| S02 | `GET /api/session`；P:228，L:122 | public；Cookie token | 读 `app_sessions/app_users`；删除过期 session | GET 会提交过期 session 清理；无审计 | `C`；PG `app_users/app_sessions`；自托管另续期 8h；M（会话语义需统一） |
| S03 | `GET /api/summary`；P:init，L:init | `read`；无输入 | 读 items、mapping、cleaning、customers、suppliers、products、BOM、PO、WO、quote、SO、quality、financial | 只读聚合；无审计；披露跨域数量/金额 | `N`；PG 仅相关零散表/`erp_records`；缺 Dashboard query service 与跨域测试；M；依赖全部业务域 |
| S04 | `GET /api/management-dashboard`；P:1017，L:906 | `dashboard`；无输入 | 读 S03 全部表、PO lines、inventory、quality、WO、shipments、activity_log | 只读跨域金额/库存/合格率/活动；无审计 | `N`；无服务/API；H（经营与权限披露）；依赖 TASK02—09 |
| S05 | `GET /api/users`；P:1022，L:911 | `system`（仅 admin `*`） | 读 `app_users`，不返回 hash | 只读；无审计 | `N`；PG 有 `app_users`，但没有用户管理 API；M；依赖身份治理 |
| S06 | `GET /api/backups`；P:1021，L:910 | `system` | 列举本地 `backups/erp-backup-*.sqlite3` | 文件只读；无校验和/异故障域结论；无审计 | `P`；自托管有 CLI backup/restore 脚本但无列表 API；H；依赖运维/授权 |
| S07 | `POST /api/login`；P:1036，L:930 | public；username trim、active、PBKDF2 密码 | 写 session；更新 user last_login；写 activity | 单连接提交三项；旧 session 删除；审计“用户登录” | `C`；PG token 只存摘要、310k PBKDF2、请求 ID/成功失败审计；M（失败限流仍需专项） |
| S08 | `POST /api/logout`；P:1051，L:983 | public；Cookie token | 删除 `app_sessions` | 单提交；无审计；清 Cookie | `C`；PG 删除 token hash；无业务过账；L |
| S09 | `POST /api/me/password`；P:1071，L:1003 | `read`；old/new；新密码至少 8 位、校验旧密码 | 更新 `app_users.password_hash`；删除除最新外的 sessions；activity | 单连接提交；未撤销当前/全部会话；审计文本 | `N`；PG 有 must_change/password hash，无此 API；H；当前 legacy 修改密码按钮 404，依赖 TASK02 |
| S10 | `POST /api/backups/create`；P:1083，L:1055 | `system`；无正文要求 | SQLite backup API 写文件；写 activity | 文件快照后日志提交，不是跨介质事务；修改运维状态、不改业务过账 | `P`；PG/files backup CLI 有 SHA，但无 API/权限审计；H；依赖最终运维任务与生产授权 |
| S11 | `POST /api/backups/restore`；P:1092，L:1064 | `system`；`name` 必须匹配固定文件名且位于目录 | 以备份覆盖当前 DB；再向恢复后 DB 写 activity | 数据覆盖与恢复审计不是单一事务；高破坏性；会回退所有已过账记录 | `P`；restore CLI 只允许新空目标，不覆盖现库；无 API；**H**；必须独立生产授权，不应兼容原地覆盖 |

Python 当前**没有**用户创建、启停、重置密码 API。legacy iframe 仍调用 `POST /api/users`、`POST /api/users/status`、`POST /api/users/reset-password`；这些不是 Python 64 项的一部分，也未在自托管实现。

## 3. 基础主数据、工程与物料治理（22）

| # | Method / path；页面调用 | Python 权限；输入与校验 | SQLite / 文件读写 | 事务、联动、审计与过账 | 自托管、PG 结构、缺口、风险与依赖 |
| --- | --- | --- | --- | --- | --- |
| M01 | `GET /api/items`；P:init，L:init | `read` | 读 `items` | 只读；无审计 | `C`；TASK03 提供 legacy path 投影且只返回 PG ACTIVE Material；不复制 SQLite item 主键/状态行为 |
| M02 | `GET /api/mappings`；P:init，L:init | `read` | 读 `supplier_mappings` | 只读；无审计 | `C`；TASK03 由关系化 Supplier/Material/Unit 映射与价格历史服务提供；旧无 supplier FK 行只保留作迁移来源 |
| M03 | `GET /api/cleaning`；P:init/P:1182，L:init | `read`；`confidence_sort` 白名单 newest/desc/asc，最多 500 | 读 `cleaning_rows` | 只读；无审计 | `P`；Import Normalization/Review 有更强分页/证据模型，但路径、状态和 DTO 不等价；M |
| M04 | `GET /api/products`；P:init，L:init | `read` | 读 `products` | 只读；无审计 | `C`；TASK03 Product Header/Version、Customer ID 和服务端权限已接通 |
| M05 | `GET /api/customers`；P:init，L:init | `read` | 读 `customers` | 只读；无审计 | `C`；TASK03 关系表、稳定 ID、分页和能力权限已接通 |
| M06 | `GET /api/suppliers`；P:init，L:init | `read` | 读 `suppliers` | 只读；无审计 | `C`；TASK03 Supplier 主体与稳定 ID 已接通，不以 mapping 文本代替主体 |
| M07 | `GET /api/boms`；P:init，L:init | `read` | 读 `product_boms`，按 product_code 连接 `products` | 只读；无审计 | `C`；TASK03 BOM Header/Version、Product ID 与发布状态已接通 |
| M08 | `GET /api/bom-lines`；P:1390，L:1303 | `read`；`bom_id` 转 int，默认 0 | 读 `bom_lines/items/inventory_balances` | 只读但混入库存可用量；无审计 | `P`；TASK03 关系化 BOM Line/Material/Unit 已接通，但刻意不返回库存可用量；等待 TASK04 |
| M09 | `GET /api/bom-readiness`；P:1400，L:1313 | `read`；bom_id int、order_qty float，默认 1；未拒绝负数 | 读 M08 表 | 计算 required/available/shortage；无写/审计 | `P`；TASK03 只计算结构与 required quantity，明确 `inventory_evaluated=false/all_ready=false`；库存齐套依赖 TASK04 |
| M10 | `GET /api/sample-import`；P:1205，L:1152 | `read`；无输入 | 读仓库模板 CSV 文件 | 只读；无审计 | `N`；新 Import UI 不提供该 legacy 样例 API；L；是否保留待产品决定 |
| M11 | `GET /api/export/items.csv`；H:22 | `read` | 读 `items`，生成 CSV | 数据导出；无导出审计 | `N`；Material API 无 CSV 导出；M（数据披露）；依赖导出权限/审计 |
| M12 | `GET /api/export/cleaning.csv`；H:23 | `read` | 读最多 10000 `cleaning_rows` | 数据导出；无审计 | `N`；Review 无等价导出；M；依赖最小披露与审计 |
| M13 | `POST /api/import`；P:1247，L:1164 | `material`；`rows` 或 CSV text；几乎无结构/大小/批次唯一校验 | 写 `cleaning_rows/activity_log`；读 items/mappings 作匹配 | 全批单连接提交；生成候选，不写正式物料；无幂等 | `P`；PG Import Batch/Mapping/Normalization/Review 已覆盖目标但协议完全不同；H；旧直写入口应退出而非复刻 |
| M14 | `POST /api/import-file`；P:1227；L 无调用 | `material`；filename basename、10 MiB、CSV/XLS/XLSX 内容安全、batch ≤80且唯一 | 写归档文件、`material_import_batches/raw_rows/cleaning_rows/activity_log` | DB 单事务；文件先写，DB 失败时删除新归档；已存在同 SHA 文件复用；无 API 幂等 | `P`；PG 有批次→文件→parse→mapping→normalize→review 完整链；路径/步骤不同；H；需迁移/页面切换策略 |
| M15 | `POST /api/cleaning/clear`；P:1196；L 无调用 | `system`；固定 confirmation | 先创建 DB 备份；事务删除全部 `cleaning_rows` 并写 activity | 备份提交与删除事务分开；破坏性但不删 raw/batch/material | `N`；Review 不提供全清；**H**；不应迁移为常规业务 API，需数据保留策略 |
| M16 | `POST /api/cleaning/confirm`；P:1258，L:1175 | `material`；id int、记录存在、必须有 candidate code | 读 cleaning；写 supplier_mappings、cleaning 状态、activity | 单事务；确认供应商映射；未重验 item 状态/并发；无幂等 | `P`；Review 可人工精确绑定 ACTIVE，但没有等价 supplier mapping 落地语义；H；依赖供应商 mapping 服务 |
| M17 | `POST /api/cleaning/create-item`；P:1280，L:1195 | `material`；id；名称/规格/单位必填；类别/环境/客户专用等弱校验 | 写 `items/supplier_mappings/cleaning_rows/activity_log` | 单事务；用“最后编码+1”生成 ACTIVE 物料并直接建映射；无审核/幂等/锁 | `P`；Review 只能调用 Material Service 建未编码 DRAFT，故更安全但非旧语义；**H**；禁止兼容“直接 ACTIVE” |
| M18 | `POST /api/products`；P:1314，L:1227 | `engineering`；PRODUCT_FIELDS；product_code/name 必填 | 写 `products/activity_log` | 单事务；`INSERT OR IGNORE` 可能静默忽略重复；无版本/幂等 | `C`；TASK03 Product Header/Version、稳定 Customer ID、幂等/审计/并发编码与发布不可变已接通 |
| M19 | `POST /api/customers`；P:1333，L:1246 | `sales`；CUSTOMER_FIELDS；name 必填 | upsert `customers` by name；activity | 单事务；编码用 COUNT+1，名称作为更新键；无版本/幂等 | `C`；TASK03 使用稳定 ID、原子 code、CAS 状态、幂等和事务审计；不再按名称 upsert |
| M20 | `POST /api/suppliers`；P:1353，L:1266 | `purchase`；SUPPLIER_FIELDS；name 必填 | upsert `suppliers` by name；activity | 单事务；编码 COUNT+1、名称更新键；无版本/幂等 | `C`；TASK03 使用稳定 ID、原子 code、CAS 状态、幂等和事务审计；不再按名称 upsert |
| M21 | `POST /api/boms`；P:1367，L:1280 | `engineering`；bom_code/product_code 必填；未验证产品存在 | 写 `product_boms/activity_log` | 单事务；重复 code 可能静默复用；无版本/审批状态机 | `C`；TASK03 验证 ACTIVE Product/RELEASED Product Version，创建 Header+DRAFT Version 并支持发布/修订 |
| M22 | `POST /api/bom-lines`；P:1383，L:1296 | `engineering`；bom_id/item_code 必填，物料存在；qty/loss 转数值 | 写/替换 `bom_lines`；读 items；activity | 单事务；`INSERT OR REPLACE` 可原地覆盖，未验证 BOM/ACTIVE/单位/客户限制 | `C`；TASK03 只允许 DRAFT 加行并验证 ACTIVE Material/enabled Unit；RELEASED Version/Line 由数据库禁止修改或删除 |

## 4. 采购与库存（9）

| # | Method / path；页面调用 | Python 权限；输入与校验 | SQLite 读写 | 事务、联动、审计与过账 | 自托管、PG 结构、缺口、风险与依赖 |
| --- | --- | --- | --- | --- | --- |
| P01 | `GET /api/purchase-suggestions`；P:1413，L:1326 | `read`；bom_id int、order_qty float，未统一正数门禁 | 读 BOM/lines/items/inventory/supplier_mappings | 计算缺料并按最低可解析价格选供应商；无审计 | `C`；TASK05 用 PostgreSQL numeric、RELEASED 当前 BOM、TASK04 可用库存和 ACTIVE/有效 Mapping+价格返回 READY/BLOCKED，读取无建单副作用 |
| P02 | `GET /api/purchase-orders`；P:init，L:init | `read` | 读 PO/lines | 只读汇总；无审计 | `C`；TASK05 提供关系化 PO list/detail/status events 和有界分页，不读 `erp_records` |
| P03 | `GET /api/purchase-order-lines`；P:init/P:1439，L:init/L:1352 | `read`；可选 po_id int | 读 PO/lines/items | 只读；无审计 | `C`；TASK05 提供关系化 line/receivable projection、稳定 Material/Unit/Mapping ID 和版本 |
| P04 | `GET /api/inventory`；P:init，L:init | `read` | 读 items + inventory_balances | 只读余额；无流水查询 API、无审计 | `C`；TASK04 使用稳定 Material/Unit ID 的新余额投影，并增加 ledger/reconciliation 查询；旧文本表不返回 |
| P05 | `GET /api/inventory-adjustments`；P:init，L:init | `read` | 读 adjustments/items，最多 200 | 只读；无审计 | `C`；TASK04 提供关系化 adjustment list/detail、不可变 lines/ledger 与有界分页 |
| P06 | `POST /api/purchase-orders/from-shortage`；P:1426，L:1339 | `purchase`；bom_id、order_qty>0 | 读缺料/映射；写多张 PO/lines/activity | 所有供应商分组在单事务；编码 COUNT+1；不预留库存、不幂等 | `C`；TASK05 显式请求才按 Supplier/Currency 分组建单，并发安全编码、持久幂等、审计和稳定 BOM Version 来源同事务 |
| P07 | `POST /api/purchase-orders`；当前页面无手工调用 | `purchase`；supplier 必填；lines 中 item 必须存在，数量/价格仅数值转换 | 写 PO/lines/activity；读 items | 末尾单提交；无 expected_version/幂等/供应商 ID；已创建 header 后遇坏 line 依赖连接关闭回滚 | `C`；TASK05 使用稳定 Supplier/Material/Unit/Mapping ID、numeric、事务序列、权限/CSRF/幂等/审计；只允许未收货 OPEN Header 以 expected version 改交期/备注 |
| P08 | `POST /api/purchase-receive`；P:1451，L:1364 | `purchase`；line_id；receive_qty>0且≤未收 | 锁语义缺失；写 inventory balance/transaction、PO line/header、activity | 单 SQLite 事务完成收货、库存、流水和状态；属于库存过账；无幂等/并发版本 | `C`；TASK05 legacy DTO 委托同一 Receipt Service；Receipt/PO/TASK04 Ledger+Balance/状态/财务来源/audit/idem 同事务，支持一次全额冲销 |
| P09 | `POST /api/inventory-adjustments`；P:1467，L:1380 | `inventory`；item 存在、counted_qty≥0 | 写 balance/transaction/adjustment/activity | 单事务；直接把余额改到实盘数，属于库存过账；无复核/幂等/版本 | `C`；TASK04 使用稳定 ID、CSRF/幂等/expected balance version、行锁、不可变 Ledger、事务余额投影和全额冲销；无采购/生产/销售来源语义 |

## 5. 生产（6）

| # | Method / path；页面调用 | Python 权限；输入与校验 | SQLite 读写 | 事务、联动、审计与过账 | 自托管、PG 结构、缺口、风险与依赖 |
| --- | --- | --- | --- | --- | --- |
| W01 | `GET /api/work-orders`；P:init，L:init | `read` | 读 WO/BOM/products/material lines | 只读汇总；无审计 | `N`；仅 `erp_records`；H |
| W02 | `GET /api/work-order-materials`；P:init/P:1507，L:init/L:1420 | `read`；可选 work_order_id | 读 WO materials/WO/items/inventory | 只读；无审计 | `N`；无关系表/API；H |
| W03 | `GET /api/production-reports`；P:init/P:1508，L:init/L:1421 | `read`；可选 work_order_id | 读 reports/WO | 只读；无审计 | `N`；无关系表/API；H |
| W04 | `POST /api/work-orders/from-bom`；P:1488，L:1401 | `production`；BOM 存在、有 lines、order_qty>0 | 读 BOM/lines；可能写 FG item；写 WO/material lines/activity | 单事务；复制 BOM 快照但仍仅文本 code；编码 COUNT+1；不幂等 | `N`；无 PG 生产表/API；**H**；依赖 TASK03 BOM + TASK04 inventory/material policy |
| W05 | `POST /api/work-orders/issue-materials`；P:1520，L:1433 | `production`；work_order_id，预检查全部未领数量和可用库存 | 写多个 balances/transactions、WO materials、WO status、activity | 单事务，多料一次全领；库存过账；无幂等/行锁/部分领料接口 | `N`；无服务；**H**；依赖并发安全库存账本 |
| W06 | `POST /api/work-orders/complete`；P:1535，L:1448 | `production`；good>0、scrap≥0、≤未完工且全部领料 | 可能建 FG item；写 FG balance/transaction、production_report、WO、activity | 单事务；完工入库和报工联动；库存过账；报废只记 report 不形成独立处置 | `N`；无服务；**H**；依赖 WO、成品 material、库存、品质规则 |

Python 没有独立“生产报工 POST”；报工只能随 `work-orders/complete` 创建。也没有已过账领料/完工的冲销接口。

## 6. 销售（7）

| # | Method / path；页面调用 | Python 权限；输入与校验 | SQLite 读写 | 事务、联动、审计与过账 | 自托管、PG 结构、缺口、风险与依赖 |
| --- | --- | --- | --- | --- | --- |
| A01 | `GET /api/quotations`；P:init，L:init | `read` | 读 quotations/products | 只读金额；无审计 | `N`；仅 `erp_records`；M |
| A02 | `GET /api/sales-orders`；P:init，L:init | `read` | 读 SO/product/BOM/WO/inventory | 只读订单与成品库存；无审计 | `N`；无关系服务；H |
| A03 | `GET /api/shipments`；P:init，L:init | `read`；可选 sales_order_id | 读 shipments/SO/products | 只读已过账出货；无审计 | `N`；无表/API；H |
| A04 | `POST /api/quotations`；P:1569，L:1482 | `sales`；customer/product、qty>0、unit_price>0；product 存在 | 写 quotation/activity | 单事务；金额 float×float round；客户用名称、不验证 customer；无版本/幂等 | `N`；无表/API；H；依赖 customer/product/decimal money |
| A05 | `POST /api/quotations/to-sales-order`；P:1576，L:1489 | `sales`；quote_id、未转单 | 写 SO/activity，然后更新 quote/activity | `create_sales_order()` 内先 commit，再更新 quote 第二次 commit，**不是原子转换**；重复/中断可产生孤立 SO | `N`；无服务；**H**；迁移必须单事务+幂等+唯一来源约束 |
| A06 | `POST /api/sales-orders`；P:1600，L:1513 | `sales`；product/customer、qty>0；可选 BOM/WO 必须属于产品 | 写 SO/activity；读 product/BOM/WO | 单事务；名称引用客户；无幂等/版本 | `N`；无关系表/API；H；依赖主数据 |
| A07 | `POST /api/shipments/from-order`；P:1612，L:1525 | `sales`；SO 存在、ship_qty>0且≤未出；库存必须足 | 写 FG balance/transaction、shipment、SO shipped/status、activity | 单事务；出货与库存过账；无幂等/并发版本/品质放行门禁 | `N`；PG inventory 占位不能代替发货服务；**H**；依赖 inventory、FQC/放行、SO |

## 7. 品质（3）

| # | Method / path；页面调用 | Python 权限；输入与校验 | SQLite 读写 | 事务、联动、审计与过账 | 自托管、PG 结构、缺口、风险与依赖 |
| --- | --- | --- | --- | --- | --- |
| Q01 | `GET /api/quality-inspections`；P:init，L:init | `read` | 读 inspections/items/products | 只读；无审计 | `N`；仅 `erp_records`；H |
| Q02 | `GET /api/quality-defects`；P:init，L:init | `read`；可选 inspection_id | 读 defects/inspections | 只读；无审计 | `N`；无关系表/API；H |
| Q03 | `POST /api/quality-inspections`；P:1721，L:1634 | `quality`；type∈IQC/IPQC/FQC；数量非负且合计≤检验数；可关联 PO line/WO/SO | 写 inspection；可写 defect；读来源；activity | 单事务；设置合格放行或异常待处理；**不改变收货/工单/发货状态或库存**；无幂等 | `N`；无表/API；**H**；依赖采购/生产/销售对象与处置状态机 |

Python 没有独立缺陷新增/修改、处置、关闭或重开 API；只有创建检验时可附带一条缺陷，`disposition` 只是字段，不能把“品质闭环”描述为完整状态机。

## 8. 财务（6）

| # | Method / path；页面调用 | Python 权限；输入与校验 | SQLite 读写 | 事务、联动、审计与过账 | 自托管、PG 结构、缺口、风险与依赖 |
| --- | --- | --- | --- | --- | --- |
| F01 | `GET /api/finance-summary`；P:init，L:init | `read` | 读 financial_documents/payments | 只读应收应付/收付款汇总；无审计 | `N`；仅 `erp_records`；**H**（金额披露） |
| F02 | `GET /api/financial-documents`；P:init，L:init | `read`；可选 doc_type 未白名单校验 | 读 financial_documents | 只读未结金额；无审计 | `N`；无关系表/API；H |
| F03 | `GET /api/financial-payments`；P:init，L:init | `read`；可选 doc_id | 读 payments/documents | 只读收付款；无审计 | `N`；无表/API；H |
| F04 | `POST /api/financial-documents/from-sales-order`；P:1633，L:1546 | `finance`；SO 存在；total_amount>0；来源唯一约束 | 读 SO；写应收 document/activity | 单事务；手工金额，不从报价/SO line 权威计算；财务过账；无幂等但 DB 唯一防重复来源 | `N`；无服务；**H**；依赖 SO、币种/精度/会计日期决定 |
| F05 | `POST /api/financial-documents/from-purchase-order`；P:1654，L:1567 | `finance`；PO 存在；金额缺省按 order_qty×unit_price；>0 | 读 PO/lines；写应付 document/activity | 单事务；财务过账；按订单而非收货/发票；无幂等但来源唯一 | `N`；无服务；**H**；依赖 PO/收货、金额规则 |
| F06 | `POST /api/financial-payments`；P:1674，L:1587 | `finance`；doc 存在；应收只收款/应付只付款；amount>0且≤余额 | 写 payment；更新 document paid/status；activity | 单事务；金额与余额过账；无行锁/expected_version/幂等，使用 float | `N`；无服务；**H**；依赖财务关系模型、numeric、不可变冲销 |

Python 没有收款/付款冲销、应收应付调整、关账或原单反向记录接口。现有记录若被数据库直接修改将破坏已过账历史。

## 9. 自托管首页断链核验

### 9.1 根页面

`chenyida_erp_site/app/page.tsx` 的根路由只渲染 iframe，固定加载 `/erp/index.html?v=20260714-material-read-ui`。因此自托管根页面展示的仍是 `public/erp/` legacy 单页应用，不是已经迁移的 Material/Import 原生页面集合。

### 9.2 登录后立即请求

`public/erp/app.js` 在登录或 setup 成功后调用 `refreshAll()`，以一个 `Promise.all` 并发请求以下 **23 个 GET**：

`/api/summary`、`/api/items`、`/api/mappings`、`/api/cleaning`、`/api/products`、`/api/customers`、`/api/suppliers`、`/api/boms`、`/api/purchase-orders`、`/api/purchase-order-lines`、`/api/inventory`、`/api/inventory-adjustments`、`/api/work-orders`、`/api/work-order-materials`、`/api/production-reports`、`/api/quotations`、`/api/sales-orders`、`/api/shipments`、`/api/quality-inspections`、`/api/quality-defects`、`/api/finance-summary`、`/api/financial-documents`、`/api/financial-payments`。

TASK02—TASK05 后，以上 23 个路径中的 users 相关独立入口、主数据/BOM、库存和采购子集已接通；summary、cleaning、生产、销售、品质和财务等路径仍有 404。任一未迁移路径都会使整个 `Promise.all` reject，因此登录成功仍不等于 legacy dashboard 可用。

Operations 页面还请求 `/api/management-dashboard` 和 `/api/backups`，两者仍为 404；`/api/users` 已由 TASK02 接通。当前覆盖是逐域兼容子集，生产及后续业务和 Dashboard/backup 仍未迁移。

### 9.3 `selfhost-api.ts` 实际能力

自托管实际支持：

- 身份基础：health、setup、login、logout、session；
- Material：分类/schema、materials、drafts、submit/approve/reject、review queue、versions/change/audit；
- Import：batch/file/parse/job、Sheet/Rows、Mapping/Catalog/版本/复用；
- Normalization：run、retry/rerun/cancel、rows/issues/lineage；
- Review：session/row/override/issue/decision/ACTIVE search/finalize/retry/Draft link。
- Master Data/BOM：items、customers、suppliers、products、BOM/version/line/readiness、supplier mapping/price history；
- Inventory：balance、ledger、reconciliation、adjustment list/detail/post/full reversal。
- Procurement：PO list/detail/lines/receivable/create/update/close、BOM shortage/from-shortage、Receipt list/detail/create/full reversal、financial source read。

其中一部分新路径已被根 iframe 使用，但剩余 404 仍会使整批刷新失败。结论：当前自托管系统**不能描述为“完整 ERP”**；它是 Material/Import、身份、主数据/BOM、通用库存与采购的非生产闭环，根首页仍存在确定性的跨域断链。

## 10. 数据关系与业务不变量

### 10.1 稳定标识

1. PostgreSQL 新业务必须使用 bigint/UUID 内部 ID 作引用；业务编码只作唯一、可显示标识。
2. supplier/customer 名称、供应商料号、原始名称、product_code、BOM code、PO/SO/WO code 不得继续充当关系主键。
3. BOM line、PO line、WO material、inventory ledger 必须引用 `material_master.id`，且业务生效时重验 `ACTIVE`、单位、客户专用、冻结/停用和替代范围。
4. Product、BOM、BOM version 必须分离稳定 ID；工单引用不可变 BOM version/snapshot，不随 BOM 后改而漂移。
5. legacy `FG-{product_code}` 自动物料规则会绕过 Material 审批，迁移时必须改为受控成品 Material ID。

### 10.2 单据与库存

- 采购收货必须在一个 PostgreSQL 事务内锁定 PO line，校验未收数，追加 receipt/库存流水，更新余额与 PO line/header 版本，并写审计/幂等结果。
- 工单领料必须锁定 WO、用料和相关库存余额；流水、用料累计、工单状态、审计必须同事务。部分领料和冲销应作为追加记录，不覆盖原流水。
- 完工必须追加 production report 和成品入库流水，并更新 WO 汇总；报废需独立、可追溯的处置语义。
- 发货必须锁定 SO 与成品库存，检查 FQC/放行策略，追加 shipment 和库存出库流水并更新 SO；禁止原地改已发货记录。
- `inventory_transactions` 是不可变账本；`inventory_balances` 是可重建投影。任何调整、收货、领料、完工、发货更正都使用反向/调整流水。

### 10.3 销售、采购与财务

- 报价转 SO 必须以 quote ID + idempotency key 唯一，并在单事务创建 SO、来源 link、quote 状态、审计；修复旧实现的双提交窗口。
- 应收必须引用稳定 SO/出货/发票依据；应付必须引用稳定 PO/收货/发票依据。旧系统“手工输入订单总额”只能作为迁移事实，不能自动成为新会计规则。
- payment 是不可变过账记录；document paid/balance 是投影。更正使用 reversal，不修改原 payment。
- 金额使用明确 currency + `numeric(p,s)`，不得继续使用 float；数量、换算分子/分母和舍入规则必须明确。

### 10.4 品质

- IQC 关联 receipt/PO line，IPQC 关联 WO/operation/report，FQC 关联 WO completion/SO/shipment eligibility，均使用内部 ID 和受控对象类型。
- inspection、defect、disposition、close/reopen 是独立历史事件；原检验及缺陷不得被覆盖。
- 是否阻断库存可用、完工或发货必须在 Task08 前由负责人确认，不能从旧 `disposition` 文本推断。

## 11. 必须原子、幂等、加锁和审计的高风险操作

| 操作 | 必须同事务提交的内容 | 额外保护 |
| --- | --- | --- |
| 用户创建/启停/重置/改密 | user/version、session revoke、audit、idempotency | 职责分离、不得自抬权、强密码、request ID |
| BOM 发布/改版 | BOM version、lines、审批/审计 | expected_version；已被工单使用版本不可改 |
| PO 创建/缺料生成 | header、lines、source link、audit、idem | 唯一来源、numeric、稳定 supplier/material ID |
| 收货 | receipt、PO line/header、inventory ledger/balance、audit、idem | `FOR UPDATE`、不超收、可反向 |
| 库存调整 | adjustment、ledger、balance、approval/audit、idem | 双人/权限策略待确认、不可直接覆写账本 |
| WO 从 BOM 创建 | WO、BOM snapshot、materials、source link、audit、idem | BOM/Material ACTIVE 重验 |
| 领料/退料 | issue/reversal、ledger/balance、WO material/status、audit、idem | 多余额确定锁顺序、防负库存 |
| 完工/撤销完工 | report/reversal、FG ledger/balance、WO、audit、idem | 领料/品质规则、成品 Material ID |
| Quote 转 SO | SO、source link、quote version/status、audit、idem | 修复旧双 commit，来源唯一 |
| 发货/退货 | shipment/reversal、FG ledger/balance、SO、audit、idem | FQC/库存/未发数行锁 |
| 品质处置/关闭 | disposition event、object hold/release、audit、idem | 禁止覆盖 inspection/defect |
| 应收/应付过账 | financial doc、source link、audit、idem | numeric/currency、来源唯一 |
| 收款/付款/冲销 | payment/reversal、document projection、audit、idem | 行锁、不得超余额、期间规则 |
| 恢复 | 新空目标恢复、校验、切换审计 | 单独生产授权；禁止在线原地覆盖 |

所有写 API 都应使用服务端生成/接受的 request ID、稳定错误码、中文安全消息、`Idempotency-Key + canonical body digest`、`expected_version` 或等价 CAS，并记录 actor/action/object/result/request_id/time。旧 Python 64 项中没有通用幂等、乐观锁、请求编号、失败审计或 CSRF；迁移不能照搬该安全缺口。

## 12. PostgreSQL 结构事实

- `app_users/app_sessions/audit_log` 存在，只有 setup/login/logout/session API；用户管理和密码 API 缺失。
- Material/Import/Mapping/Normalization/Review 已有关系表、service/API/test。
- `supplier_mappings` 与 price history 有结构但无自托管业务 API。
- `inventory_balances/inventory_transactions` 只是基线表：以文本 `item_code` 引用、无 Material FK，且没有 receipt/adjustment/reservation/lot/location/reversal 服务。
- customer、supplier 主体、product、BOM、PO、receipt、WO、report、quote、SO、shipment、quality、financial 没有专用关系表；只有 `erp_records(kind,code,data JSONB)` 历史占位。
- 因此后续各域需要新的扩展 migration；不得把 `erp_records` 当作未来生产关系模型，也不得在启动时自动建表或迁移真实数据。
