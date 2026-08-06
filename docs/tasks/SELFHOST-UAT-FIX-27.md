# SELFHOST-UAT-FIX-27 — RFQ Quote Version语义与追溯诊断

## 状态与唯一范围

- 状态：`DONE`
- 开始：2026-08-06（Asia/Shanghai）
- 负责人：Codex（严格门禁、限定只读诊断、0039权威语义、服务端读模型/UI修复、隔离测试、备份恢复、Web-only部署和purchase-only只读验收）；项目负责人（主UAT保护边界及代码修复、部署、只读验收授权）
- 依赖：`SELFHOST-UAT-FIX-20`、`SELFHOST-UAT-FIX-22`、`SELFHOST-UAT-FIX-24`、`SELFHOST-UAT-FIX-26`、D-061、D-091、D-094—D-098
- 唯一范围：确认Quote提交对RFQ aggregate CAS和Supplier邀请状态的权威语义；修复正常响应被误判为Mapping/范围漂移的问题；补齐现有Quote的稳定ID、版本、状态、Event、金额与交期差追溯。保留Supplier A现有Quote，禁止在主UAT创建Supplier B Quote。

## 严格起点

- `main@119dd04f724fccb0ef2b849b974d3e93c5c55008`，Parent `f6f7d2ac492ca6d278c99dc991b20f26d882f682`，`origin/main...HEAD` behind 0 / ahead 151，工作区clean。
- 源码/运行Web `0.1.0-alpha.40`；Migration `0001—0039`，head `0039_rfq_traceability.sql`，没有0040。
- 起点Web `sha256:c8c3fdd52236b84e3ceb67f7b81ca2e5530bfaba964a92ebd22dab9f7da19989`；Web/PostgreSQL healthy，Worker/Caddy running，四服务restart 0/OOM false。
- 起点资源：available memory约2.1 GiB，Swap约290 MiB/1 GiB，根盘可用19 GiB，Load `0.04/0.09/0.08`。

## 主UAT保护合同

- 只读诊断对象限于RFQ ID 1 / `RFQ-00000001`、RFQ Supplier 1/2、Binding 1—8、Supplier A现有Quote及Event，以及该RFQ的Quote/Award/PO计数。
- 必须保留RFQ `ISSUED v4`、Binding 8、`RFQ_MAPPING_CONFIRMED` 1、`RFQ_ISSUED` 1、Supplier A Quote 1、Supplier B Quote 0、Award/PO 0/0。
- 不删除、撤销、修订或重建Supplier A Quote；不把RFQ CAS由v4回退到v3；不修改Binding、Mapping、RFQ范围或历史Event；不创建Supplier B Quote、Award、PO或其他下游；不以直接SQL修复主UAT。
- 固定摘要必须继续为 `9765f8fdef768335a25b314867dd3e077429a84848cba067ff8394c8a017848d`。

## 权威诊断结论与分支

- 采用分支A。`recordQuote`在单一Repository事务中插入Quote Header/Line、把对应邀请由`INVITED`推进为`RESPONDED`、把RFQ aggregate CAS递增一次、写唯一`QUOTE_SUBMITTED` Event，并与Audit/幂等结果一并提交。
- 0039投影保护允许`ISSUED→ISSUED`且要求`version=old+1`，并只允许邀请`INVITED→RESPONDED|DECLINED`；因此Supplier A报价导致RFQ `v3→v4`及邀请`INVITED→RESPONDED`均为正式成功语义。
- Quote没有独立业务编号字段；稳定数据库ID为权威身份。现有模型是单事务直接提交，只产生`QUOTE_SUBMITTED`，不伪造CREATE Event。现有Quote Event未记录版本转换，历史Event不回填、不改写。
- 主UAT只读复算证明4行、2个Supplier、8条Binding构成的固定摘要仍为 `9765f8fd…4848d`；Binding、固定Mapping ID/Version/row CAS/content digest均未变。Supplier B独立保持`INVITED`且无Quote。
- 当前错误来自读模型把`rs.status='INVITED'`混入Binding `eligible`，详情页又把所有`!eligible`行并入“当前阻断项”；Supplier A正常`RESPONDED`遂被兜底文案错误描述为“Mapping Version/CAS已漂移”。范围漂移必须只看固定Binding完整性、Supplier/Line集合、Mapping ID/Version/状态/有效性及固定摘要，不得用邀请响应生命周期或RFQ当前CAS与发出时CAS不同判定。

## Quote追溯与金额/交期合同

- 服务端详情读模型必须提供稳定Quote数据库ID、独立业务编号是否存在、Supplier与RFQ稳定标识、Round、Quote Version、权威状态、外部参考、有效期、记录人/时间/request_id，以及服务器核算的行金额、总额、需求日期、承诺日期、日期差和`ON_TIME|LATE`。
- 无独立业务编号时页面精确显示“未设置独立Quote业务编号”，不得由数据库ID或外部参考伪造。
- Supplier A应显示Quote ID 1、Supplier ID 1 / `SUP-000001`、RFQ ID 1 / Round 1、Quote v1 / `SUBMITTED`、`UAT-Q-A-042576`、有效期2026-09-30、四行各`10 PCS × 12.00 CNY = 120.00 CNY`、总额`480.00 CNY`、承诺2026-10-20、需求2026-10-30、`ON_TIME / 准时，提前10天`。
- `QUOTE_SUBMITTED`显示actor、Asia/Shanghai时间、request_id和SUCCESS；当Event版本列为空时显示“事件未记录版本转换”，当前Quote v1另从Quote权威版本显示，禁止出现`vnull`或伪造CREATE Event。

## 测试、备份、部署与验收

- 隔离环境覆盖首家Quote后的RFQ CAS/RESPONDED、第二家仍INVITED且可报价、Binding/摘要不变、正常CAS不触发范围漂移、真实Mapping变化失败关闭、Quote/Event展示、空事件版本、金额/日期差、幂等/异正文/并发、CSRF/Origin/权限/过期CAS和桌面/390×844。
- Supplier B成功报价只允许在隔离环境验证；主UAT不得进入、填写或提交其报价。
- 优先使用0039；不得改0039，不为展示新增Migration。若现有Schema缺少必需权威事实则停止并报告，未经新授权不创建0040。
- 代码修复通过后生成正式custom-format备份，执行`pg_restore --list`并恢复到第二新库核验；只替换Web，不运行Migration，不重建PostgreSQL、Worker或Caddy。
- 主UAT只登录purchase，只读重开RFQ与Supplier A Quote，核对追溯/金额/交期/漂移；只确认Supplier B入口可用，不进入、不填写、不提交；business POST=0，Quote/Award/PO保持1/0/0，安全退出并验证Session失效。

## 功能实现与部署前验证

- Repository新增与邀请生命周期解耦的`scope_intact`；Service仅在DRAFT发出资格中使用`INVITED`，已发出RFQ的范围漂移由固定Binding凭证和当前Mapping事实决定。首版Quote写接口继续以RFQ aggregate CAS串行化，并显式拒绝非`INVITED`邀请。
- 详情读模型由服务端投影稳定Quote数据库ID、业务编号是否存在、Quote/RFQ/Supplier版本与状态、actor/Asia/Shanghai时间/request_id、行金额/总额、需求与承诺日期、提前/延期天数、稳定交期状态和中文说明。页面不计算金额或交期业务语义。
- 页面按Supplier独立展示`RESPONDED`/`INVITED`和首版Quote入口；Supplier A不再出现在首版提交下拉框，Supplier B仍出现但主UAT不得操作。历史`QUOTE_SUBMITTED`的空版本列显示“事件未记录版本转换”，当前Quote v1独立显示；没有伪造Quote CREATE Event或业务编号。
- 部署前保护器以repeatable-read/read-only精确验证主UAT并固定指纹`597eb456837e0cda35d3544c1aeae94f3a190eed373d1145de5a72261fe37f9f`；结果为RFQ ISSUED v4、Supplier A RESPONDED/Quote ID 1 SUBMITTED v1、Supplier B INVITED/Quote 0、Binding 8、摘要完整、Quote/Award/PO 1/0/0。
- 隔离验证通过：Unit 9/9、UI合同12/12、PostgreSQL 21/21、Chromium 3/3、0018 upgrade 3/3、0039 6/6、`npm test` 3/3、环境守卫6/6、Python self-test/smoke/go-live；production build/typecheck通过，lint 0 error/11个既有warning，凭据扫描通过。隔离Supplier B成功报价后测试库已删除；主UAT Supplier B仍为0。

## 允许最终状态

- `RFQ QUOTE VERSION SEMANTICS FIXED — SUPPLIER A RETAINED`
- `RFQ QUOTE BASELINE CORRECTED — SUPPLIER A RETAINED`
- `RFQ QUOTE DATA INTEGRITY BLOCKED — NO UAT CHANGE`

完成后立即停止，不创建Supplier B Quote。

## 完成结果

- 最终状态：`RFQ QUOTE VERSION SEMANTICS FIXED — SUPPLIER A RETAINED`。
- 功能提交：`1be492e68f6635bc00ea3fb8ce461eac0617d8e7`（`fix: correct rfq quote traceability semantics`）；部署和验收由独立`ops: deploy rfq quote traceability fix`收口。
- Web-only部署、正式备份/第二库恢复、最终保护哈希与purchase-only桌面/390×844只读验收均通过；`business_post=0`、Session 0，Supplier A Quote ID 1保留，Supplier B Quote 0，Quote/Award/PO `1/0/0`。
- 详细证据见[完成报告](SELFHOST-UAT-FIX-27-COMPLETION.md)。
