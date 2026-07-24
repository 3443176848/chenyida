# 完整 ERP API 分阶段自托管迁移计划

状态：`PROPOSED`（迁移顺序建议，未获逐项实施或生产授权）

来源任务：`SELFHOST-PHASE2-TASK01`

日期：2026-07-24（Asia/Shanghai）

## 1. 规划原则

1. 一次只授权、开发、测试、提交一个任务编号；候选任务不能因本计划存在而视为批准。
2. Node 服务端 API + PostgreSQL 是未来唯一业务权威；Python/SQLite 与历史 D1 只作行为/迁移来源，不双写。
3. 每域先扩展关系模型，再实现 Repository/Service/API，最后接页面；不得用 `erp_records` JSON 或浏览器规则代替服务端业务边界。
4. 库存账本先于收货、领料、完工和发货；主数据先于所有交易；财务只消费已稳定的采购/销售来源关系。
5. 已过账库存、出货、品质处置和财务记录只追加调整/冲销/反向记录，不原地改写。
6. 每一候选任务只使用合成数据和隔离 PostgreSQL；真实数据试迁移、生产 migration、备份恢复、部署和切换另立任务授权。

## 2. 推荐依赖顺序

```text
TASK02 身份/用户/密码/审计
  -> TASK03 客户/供应商/产品/BOM/供应商物料映射
      -> TASK04 库存账本与调整
          -> TASK05 采购、收货与库存联动
          -> TASK06 生产、领料、完工与库存联动
              -> TASK07 报价、销售订单、发货与库存联动
      -> TASK08 品质（依赖 TASK05/TASK06/TASK07 的稳定对象）
      -> TASK09 财务（依赖 TASK05/TASK07 的稳定来源）
TASK02—TASK09
  -> TASK10 经营看板、备份恢复治理与 legacy iframe 退出
```

相对最初候选编号，本计划把“库存账本”从“采购”中拆出作为 TASK04。原因是采购收货、生产领料/完工和销售发货都修改同一库存权威；先单独验收不可变流水、余额投影、并发锁和调整/冲销，能让三个下游域分别开发和回滚。因此完整建议序列为 `TASK02`—`TASK10`。

## 3. 统一 API 与工程基线

所有候选任务必须遵守：

- 精确路由委托到独立 `app/lib/<domain>-selfhost/`；`selfhost-api.ts` 只处理共享认证和分发，不堆业务 SQL。
- 写路径分为 API（Session、CSRF、解析）、Service（权限、状态机、不变量）、Repository（事务、锁、持久化）。
- 写接口要求 request ID、稳定 code、中文安全消息、CSRF、正文上限、速率限制、`Idempotency-Key + canonical body digest`、`expected_version`/CAS；成功业务、审计和幂等结果同事务。
- 使用 bigint/UUID 内部 ID 和 numeric 数量/金额；业务编码通过并发安全序列表或唯一键生成，不用 `COUNT/MAX + 1`。
- 关系表声明 FK、唯一约束、状态 CHECK、常用队列/列表索引；migration 只追加，不修改任何已执行 migration（当前 PostgreSQL 为 `0001`—`0007`）。
- migration 测试覆盖空库、已有数据升级、重复 runner、失败回滚、约束、索引和汇总核对。
- 每域至少有 unit、isolated PostgreSQL integration、API contract、安全/并发/回滚、UI contract 和 Compose E2E；测试拒绝 production URL。
- 旧路径是否临时兼容必须由该任务的书面 API 规格决定；兼容层只能调用新 Service，不能复制规则。

## 4. 候选任务总表

| 候选任务 | 名称 | 依赖 | 主要风险 | 状态 |
| --- | --- | --- | --- | --- |
| SELFHOST-PHASE2-TASK02 | 身份、用户管理、密码和系统审计补齐 | TASK01 | 权限提升、会话撤销、凭证 | DONE（非生产；未发布/部署/迁移真实用户） |
| SELFHOST-PHASE2-TASK03 | 客户、供应商、产品、BOM 与供应商物料映射 | TASK02、现有 Material ACTIVE | 稳定 ID、BOM 版本、重复主数据 | DONE；非生产 `0.1.0-alpha.3`，未迁真实数据或部署 |
| SELFHOST-PHASE2-TASK04 | 库存不可变账本、余额投影与受控调整 | TASK02、TASK03 | 负库存、并发、已过账更正 | 已获连续任务指令授权；待 TASK03 独立提交后开始 |
| SELFHOST-PHASE2-TASK05 | 采购、缺料建议、收货与库存联动 | TASK03、TASK04 | 超收、重复收货、库存过账 | 建议，待授权 |
| SELFHOST-PHASE2-TASK06 | 工单、领料、完工、报工与库存联动 | TASK03、TASK04 | 多料锁、成品入库、冲销 | 建议，待授权 |
| SELFHOST-PHASE2-TASK07 | 询报价、销售订单、发货与库存联动 | TASK03、TASK04、TASK06 | 转单原子性、超发、FQC | 建议，待授权 |
| SELFHOST-PHASE2-TASK08 | IQC/IPQC/FQC、缺陷、处置与关闭 | TASK05、TASK06、TASK07 | 跨域 hold/release、不可变历史 | 建议，待授权 |
| SELFHOST-PHASE2-TASK09 | 应收应付、收付款、余额与冲销 | TASK05、TASK07 | 金额精度、重复过账、期间规则 | 建议，待授权 |
| SELFHOST-PHASE2-TASK10 | 经营看板、备份恢复治理与 legacy iframe 退出 | TASK02—TASK09 | 跨域披露、恢复破坏性、切换 | 建议，待授权 |

## 5. SELFHOST-PHASE2-TASK02（DONE，非生产）：身份、用户、密码和系统审计

### 依赖与代码范围

- 依赖：TASK01 盘点；复用现有 `app_users/app_sessions/audit_log/idempotency_keys` 和身份 Cookie/CSRF。
- 新建 `app/lib/identity-selfhost/` 的 Repository/Service/Handler；只对 `selfhost-api.ts` 做精确委托；补充用户管理 UI/API 契约测试。
- 不实现 Dashboard、备份、客户或任何业务域。

### Schema / migration

- 首先证明现有字段能否支持创建、启停、must-change、版本 CAS、session revoke 和审计；能满足时不为“有 migration”而改表。
- 若需要密码历史/重置事件/权限版本或 idempotency scope，追加下一版本 migration；不得修改 `0001`。
- 角色/能力继续由服务端白名单控制，任何动态角色模型必须先形成 `PROPOSED` 决策并获批。

### API

- 保持 `/api/setup|login|logout|session`。
- 实现 `POST /api/me/password`、`GET|POST /api/users`、`POST /api/users/status`、`POST /api/users/reset-password`。
- 新增有界系统审计查询；是否兼容 legacy response DTO 在任务规格中明确。

### 权限、职责分离与事务

- `system.user.read/create/status/reset` 与 `system.audit.read` 分离；admin 通配不替代自操作/最后管理员保护。
- 创建、启停、重置、改密必须同事务更新 user/version、撤销适用 session、audit、idempotency；重置后的临时密码不写审计正文。
- 写接口要求 CSRF、强幂等、expected user version、速率限制；禁止客户端指定权限集合或 password hash。

### 测试与验收

- Unit：密码策略、角色 allowlist、最后可用管理员、本人/他人会话撤销、错误码。
- Integration/API：并发启停/重置、同 Key 重放/异载荷冲突、失败回滚、失败审计、Cookie 和 must_change。
- Migration：按实际是否追加 migration 执行完整四类验证。
- E2E：setup→登录→创建用户→首次改密→启停→重置→旧 session 失效→授权审计查询。
- 验收：legacy 身份/用户/密码按钮不再 404；非授权用户不能读取用户清单或审计；无真实凭证。

### 禁止与生产边界

- 禁止默认密码、批量导入账号、外部 IdP、break-glass、生产用户迁移、部署或真实权限修改。
- 只用隔离用户；生产/真实数据授权：**否，另立任务**。

## 6. SELFHOST-PHASE2-TASK03（DONE，非生产）：客户、供应商、产品、BOM 与供应商物料映射

### 依赖与代码范围

- 依赖 TASK02 和现有 ACTIVE Material 查询。
- 新建 `master-data-selfhost/`、`bom-selfhost/`；供应商物料映射复用现有关系表，增加独立服务，不与 Import column Mapping 混名。
- 页面可先兼容 legacy 主数据/BOM tab；不实现库存、采购或生产写入。

### Schema / migration

- 新增 customer、supplier、product、product version、BOM header/version/line 关系表及 code sequence；supplier mapping 缺失的 supplier FK、版本/有效期约束用扩展 migration 补齐。
- BOM line 使用 material_id FK、numeric qty/loss 和 unit_id；BOM 发布版本不可变。客户/供应商名称只作可变属性，不作引用键。
- 旧 `erp_records` 继续保留为迁移来源，不成为新 Repository 写目标。

### API

- Customer/Supplier/Product CRUD（首期可只 create/read/update status，不做物理 delete）。
- BOM list/detail/version/line、readiness 的结构化只读入口；`/api/items` 可用兼容投影读取 ACTIVE Material。
- Supplier mapping list/create/version/status/price history；BOM readiness 在 TASK04 前只能返回结构完整性，不伪造库存齐套。

### 权限、事务与幂等

- sales 管客户，purchase 管供应商/映射，engineering 管产品/BOM；Material 状态仍由 Material Service 权威判断。
- header+version+lines+audit+idem 同事务；发布后只能新版本，不能替换 lines。
- 所有 upsert 基于内部 ID/expected_version，不以名称命中；业务 code 原子生成且唯一。

### 测试与验收

- Unit：编码、状态、BOM 行唯一、单位、ACTIVE/客户专用/冻结门禁、映射有效期重叠。
- Integration：并发编码/更新、BOM 发布不可变、外键、失败回滚、权限/CSRF/幂等/审计。
- Migration：空库、历史占位数据存在时升级、重复、回滚、孤儿/重复统计。
- E2E：客户→产品→BOM→多行 ACTIVE material→发布→读取版本；supplier→mapping。
- 验收：主数据和 BOM API 不再依赖 `erp_records` JSON；没有库存或采购副作用。

### 禁止与生产边界

- 不导入真实主数据、不自动激活 Material、不实现替代料推断、不写库存/PO/WO。
- 实施结果：PostgreSQL `0007`、独立 `master-data-selfhost/`/`bom-selfhost/`、legacy path 兼容投影、发布不可变、映射有效期/价格历史和结构 readiness 已通过专项、migration、Compose 重启与回归。
- 生产/真实数据授权：**否**。

## 7. SELFHOST-PHASE2-TASK04（建议）：库存不可变账本、余额投影与调整

### 依赖与代码范围

- 依赖 TASK02、TASK03；新建 `inventory-selfhost/`。
- 只实现 inventory query、ledger、reservation 基线（如规格批准）和 adjustment/reversal；不实现收货、领料、完工或发货业务服务。

### Schema / migration

- 扩展现有 balance/transaction：新增 material_id、业务 location/lot 边界（首期是否启用需规格确认）、ledger operation/reversal link、request/actor/source ID、balance version。
- 新增 inventory_adjustments 和 adjustment lines/approval（是否双人复核待确认）；采用 expand→backfill→switch，不删除 item_code 兼容列。
- ledger append-only；balance 可由 ledger 核对重建；numeric 精度和单位换算固定。

### API、权限与事务

- `GET /api/inventory`、transactions、adjustments；`POST /api/inventory-adjustments` 和 reversal。
- inventory.read、inventory.adjust、inventory.reverse 分离；普通仓库员不得删除/更新 ledger。
- 调整事务：锁 balance→写 adjustment/ledger→更新 balance/version→audit/idem；确定多物料锁顺序，拒绝负库存和 stale version。

### 测试与验收

- Unit：正负/零、精度、单位、负库存、reversal、状态机。
- Integration：并发相同物料调整、多物料锁顺序、重复 Key、事务失败、余额=ledger 汇总。
- Migration：已有 balance/transaction 合成升级、孤儿 item_code 报告、重复执行/失败回滚。
- E2E：初始余额→调整→流水→反向→余额复原；无 PO/WO/SO 记录。
- 验收：任何库存变化都有不可变 ledger、request ID、actor、source 和可重建余额。

### 禁止与生产边界

- 不回填真实库存、不在启动时对账、不直接改 balance、不实现下游业务过账。
- 生产/真实数据授权：**否**。

## 8. SELFHOST-PHASE2-TASK05（建议）：采购、缺料建议、收货与库存联动

### 依赖与代码范围

- 依赖 TASK03 主数据/BOM/supplier mapping 和 TASK04 inventory service。
- 新建 `procurement-selfhost/`；库存写必须调用 TASK04 Service/Repository 边界，不复制余额 SQL。

### Schema / migration

- 新增 PO header/version/line、receipt header/line、source link、状态事件；material/supplier 使用内部 ID。
- order/received/reversed 使用 numeric；唯一 receipt operation/source/idempotency；PO line 版本和未收数量约束。

### API、权限与事务

- 缺料建议、PO list/detail/create、从缺料生成、receipt create/read/reverse；兼容旧 PO/line/receive 路径可作为 adapter。
- purchase.plan/order/receive/reverse 与 inventory read 分离；收货人是否能创建 PO 待职责规格确认。
- 收货单事务锁 PO line 和 inventory balance，追加 receipt、ledger、余额、PO 汇总、audit、idem；不得超收或重复收。

### 测试与验收

- Unit：缺料、有效 supplier mapping、价格/单位、部分/全部收货、反向、状态机。
- Integration：并发收货、超收、重复、失败回滚、库存一致性、权限和审计。
- Migration：空库/合成已有 PO 升级、来源/孤儿/数量汇总。
- E2E：BOM 缺料→建议→多供应商 PO→部分/全部收货→库存 ledger→反向。
- 验收：每次收货可追溯到 PO line 和库存 ledger；无自动 AP。

### 禁止与生产边界

- 不迁移真实 PO/在途/库存，不自动生成应付，不接供应商门户，不部署。
- 生产/真实数据授权：**否**。

## 9. SELFHOST-PHASE2-TASK06（建议）：生产、领料、完工与报工

### 依赖与代码范围

- 依赖 TASK03 发布 BOM/Product/Material，TASK04 inventory；采购不是硬依赖但完整 E2E 可使用 TASK05。
- 新建 `production-selfhost/`；库存变化只调用 TASK04 边界。

### Schema / migration

- 新增 WO、BOM snapshot/link、WO material、material issue/reversal、production report、completion/reversal、状态事件。
- 成品必须是经 Material workflow 管理的 material_id；禁止运行时自动创建 `FG-{product_code}` ACTIVE 物料。

### API、权限与事务

- WO list/detail/from-BOM、materials、issue/return、report、complete/reverse。
- production.plan、production.issue、production.report、production.complete 分离；页面显隐不替代服务端权限。
- 领料按稳定顺序锁全部余额并原子写 issue/ledger/WO material/status/audit/idem；完工原子写 report/completion/FG ledger/balance/WO。

### 测试与验收

- Unit：BOM snapshot、损耗、部分领/退、部分完工、报废、超领/超完、成品状态。
- Integration：多料并发/死锁顺序、负库存、重复提交、lease 不适用同步路径、失败回滚、reversal。
- Migration：空库与合成未完工数据升级、数量汇总/孤儿核对。
- E2E：发布 BOM→WO→部分领料/退料→报工→部分/全部完工→成品库存→冲销。
- 验收：原料和成品每笔过账都有 ledger；旧 report 不被修改。

### 禁止与生产边界

- 不做 MRP/排程 AI、不迁真实 WO/在制、不自动批准成品、不部署。
- 生产/真实数据授权：**否**。

## 10. SELFHOST-PHASE2-TASK07（建议）：报价、销售订单与发货

### 依赖与代码范围

- 依赖 TASK03 customer/product/BOM，TASK04 inventory，TASK06 成品/完工关系。
- 新建 `sales-selfhost/`；库存出库调用 TASK04。

### Schema / migration

- 新增 quote/version/line、SO/version/line、quote→SO source link、shipment/line/reversal、状态事件。
- customer/product/material 用内部 ID；金额 numeric + currency；来源唯一约束消除旧双 commit 问题。

### API、权限与事务

- quotation list/create/version/convert；SO list/create/detail；shipment create/read/reverse。
- sales.quote/order/ship/reverse 分离；是否允许销售直接出库需职责确认。
- Quote 转 SO 在单事务内创建 SO/link、更新 quote version/status、audit/idem；发货锁 SO line/FG balance，写 shipment/ledger/balance/SO/audit/idem。

### 测试与验收

- Unit：价格/币种/税边界（未决则首期明确不支持）、部分发货、超发、quote 重复转单、FQC 门禁接口。
- Integration：并发转单/发货、重复 Key、库存不足、事务失败、reversal 和状态汇总。
- Migration：合成 quote/SO/shipment 升级、金额和来源核对。
- E2E：quote→SO→生产成品→部分/全部发货→库存→反向；不得自动 AR。
- 验收：quote 转单无孤立 SO；每次发货有不可变 shipment 和 inventory ledger。

### 禁止与生产边界

- 不迁真实客户订单/出货、不自动应收、不做 AI 报价、不部署。
- 生产/真实数据授权：**否**。

## 11. SELFHOST-PHASE2-TASK08（建议）：品质闭环

### 依赖与代码范围

- 依赖 TASK05 receipt、TASK06 WO/report/completion、TASK07 SO/shipment eligibility。
- 新建 `quality-selfhost/`；用受控 object type + internal ID 关联，不使用自由 `ref_type/ref_id`。

### Schema / migration

- 新增 inspection、sample/result、defect、disposition/close/reopen event、object hold/release link。
- IQC/IPQC/FQC 状态、数量和严重度 CHECK；inspection/defect 不可变，处置只追加事件。

### API、权限与事务

- inspection list/detail/create；defect append；disposition、close、reopen；对象查询。
- quality.inspect、quality.disposition、quality.close 分离；是否禁止同人检验和最终处置待确认。
- 处置事务同时写 event、业务对象 hold/release、audit/idem；跨域服务边界和锁顺序必须明确。

### 测试与验收

- Unit：三类检验、数量守恒、缺陷、处置、关闭/重开、对象类型。
- Integration：来源对象不存在/状态漂移、并发处置、失败回滚、FQC 发货门禁、IQC 可用库存门禁（按获批规则）。
- Migration：空库/合成历史检验升级、孤儿 ref 报告、状态核对。
- E2E：receipt→IQC、WO→IPQC/FQC、异常→处置→关闭→下游放行/阻断。
- 验收：品质状态真正联动获批对象，而不是只保存自由文本。

### 禁止与生产边界

- 不推断旧 disposition 为批准规则、不自动报废/放行、不迁真实检验、不部署。
- 生产/真实数据授权：**否**。

## 12. SELFHOST-PHASE2-TASK09（建议）：财务

### 依赖与代码范围

- 依赖 TASK05 稳定 PO/receipt 来源和 TASK07 稳定 SO/shipment 来源；品质是否影响开票由规格确认。
- 新建 `finance-selfhost/`，与销售/采购通过 source link 交互，不复制单据数据。

### Schema / migration

- 新增 financial document/version/source、payment、reversal、currency/amount、状态事件和期间字段。
- 全部金额 numeric；source 唯一、payment operation 唯一；paid/balance 为可核对投影。

### API、权限与事务

- finance summary、documents、from-SO/from-PO（最终来源规则待确认）、payments、reversals。
- finance.read/post/pay/reverse 分离；制单与付款职责分离是否强制需业务批准。
- 创建 AR/AP、付款/收款、冲销均锁来源/财务 doc，在单事务写不可变记录、投影、audit、idem。

### 测试与验收

- Unit：币种/精度/舍入、部分/全部结清、超余额、重复来源、reversal、期间状态。
- Integration：并发付款、重复 Key、事务失败、来源状态变化、汇总=明细。
- Migration：合成金额升级、逐单/总额核对、失败回滚；真实金额不在本任务读取。
- E2E：PO/receipt→AP→付款→冲销；SO/shipment→AR→收款→冲销；dashboard summary 准备数据。
- 验收：原 payment/document 不被修改，所有更正有反向记录，金额核对一致。

### 禁止与生产边界

- 不迁真实金额、不接银行/税务、不关账、不自动过账、不部署。
- 生产/真实数据授权：**否**。

## 13. SELFHOST-PHASE2-TASK10（建议）：看板、备份恢复与 legacy iframe 退出

### 依赖与代码范围

- 依赖 TASK02—TASK09 全部通过独立验收；这是切换 UI/运维聚合任务，不补写缺失业务规则。
- 新建 dashboard query service 和原生根工作台；逐项替换 `app/page.tsx` iframe，最终删除运行依赖前先保留可回滚静态文件。
- 备份/恢复继续使用受控脚本/运维流程；是否提供只读 backup status API 另行规格确认。

### Schema / migration

- Dashboard 优先实时/受控投影，不为卡片复制业务事实；若需 projection/outbox，必须有独立 migration 和重建测试。
- 备份目录不入数据库正文；恢复坚持新空目标、checksum、PostgreSQL+uploads+attachments 一致性。

### API、权限与事务

- `/api/summary`、`/api/management-dashboard` 的新 query contract，按能力最小披露；必要的 audit export/status。
- 不建议恢复 legacy “浏览器原地覆盖数据库”语义；恢复为离线、明确批准的运维动作。
- iframe 退出采用开关/路由回退：新根页失败可回到旧 Python 运行面，而不是双写数据库。

### 测试与验收

- Unit/query：每个指标来源、权限裁剪、空数据、金额/数量精度。
- Integration：跨域合成数据汇总、审计、projection 重建（若有）、备份/新空目标恢复。
- E2E：登录后根页不再发出 23 个 404；各域入口、权限、刷新/深链、错误态完整；legacy iframe 不再是默认运行依赖。
- Compose：空卷启动、全域最小旅程、整体重启、备份→新空目标恢复；仍不接真实数据。
- 验收：系统才可描述为“自托管完整 ERP API 非生产候选”；仍不能描述为生产已上线或真实数据已迁移。

### 禁止与生产边界

- 不在本任务生产切流、不原地恢复生产、不删除 legacy 源码/SQLite、不迁真实数据、不发布公网。
- 生产/真实数据授权：**否**；后续必须另建试迁移、生产备份恢复演练、部署和切换任务。

## 14. 下一条最小实施任务建议

TASK02 已完成用户生命周期、密码、session revoke、能力与审计公共边界；TASK03 已完成非生产主数据/BOM。下一任务按连续任务指令为 `SELFHOST-PHASE2-TASK04`；Dashboard、备份 API、其他业务域、真实数据迁移和部署继续保持独立任务与生产授权。
