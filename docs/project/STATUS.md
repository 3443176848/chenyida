# 晨亿达ERP状态快照

最后更新时间：2026-08-09（Asia/Shanghai）

## SELFHOST-UAT-FIX-38 服务端日期驱动的收货预检门禁（需求已决定，实现未开始）

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DECISION RECORDED — IMPLEMENTATION NOT STARTED | `DOING`；D-107和FIX38基线已记录。未修改源码/测试，未build、deploy或restart；计划alpha.42尚未产生 |
| 严格起点 | PASS | 唯一worktree、clean`main@7d8f3cf6aa58808698ae6100424bc0e5df248b3d`、Parent`20a9123741862d81ac18af9e6bdee896674fe95c`、behind0/ahead178；alpha.41、40/head0040、Web`0cf98937…d5f19`完全匹配 |
| 决策 | D-107 / ACCEPTED | Receipt preview日期以服务端事务Asia/Shanghai业务日期为权威；过账后果只投影实际inspection mode；四种关闭路径统一为返回修改并保留未提交编辑草稿 |
| 唯一确认缺陷 | PREVIEW FAIL-CLOSED GAP | `openPreview`未传`evidence_document_date`，preview合同未校验，`confirmationReady`只检查非空，故未来日期可进入可执行确认窗 |
| 最终写/数据库防线 | PRESERVED / SAFE | 最终Receipt POST仍在自己的写事务中用Asia/Shanghai日期返回`RECEIPT_EVIDENCE_FUTURE_DATE`；0040触发器独立约束。两者未改，现有数据安全 |
| 后续preview验收 | HTTP 422 / MODAL UNREACHABLE | 实现后未来日期须由GET preview返回稳定code/message/request_id且确认窗不可达；今天/过去日期继续可预览，浏览器时间和仅HTML `max`不具权威性 |
| NORMAL/IQC验收 | ACTUAL MODE ONLY | NORMAL不描述RML/FROZEN/UNFREEZE；实际IQC行显示RML、FROZEN、`IQC_RECEIPT`、可用量0及quality RELEASE→UNFREEZE。NORMAL缺少假设IQC不是缺陷 |
| 返回修改验收 | POST 0 / DRAFT PRESERVED | 取消、关闭、ESC、背景均放弃当前确认并返回编辑；清除modal/preview/loading/submitted/error/提交锁/幂等状态，但不`form.reset()`且保留未发送输入。字段保留不是状态泄漏 |
| 延期 | EXPLICIT | 教学模式比较、清空本行、显式清空及成功提交后自动清空另立任务；FIX38不实现 |
| Schema/API/版本 | NO CHANGE IN THIS PHASE | 本阶段无Schema/Migration/API/运行代码变化；源码与UAT仍alpha.41/0040，Web镜像不变，alpha.42仅为后续候选计划 |
| 本阶段验证 | PASS / DOCS-ONLY | 文档范围/一致性/diff检查通过；测试脚本确认无数据库或网络路径。宿主npm缺失后以既有Node镜像在断网、源码只读、自动删除容器中通过lint（0 error、11 warning）和UI contract 5/5；未运行全量npm、PG写测试、Migration或build |
| UAT/数据保护 | PRESERVED / ZERO WRITE | 未登录UAT、未调用Receipt preview、业务POST0、warehouse Session0；PO/Line/Plan/queue`1/4/4/4`，Receipt/Evidence/Lot/IQC/Ledger/AP/Payment/生产全0 |
| 下一阶段 | FIX38 SOURCE + ISOLATED TESTS ONLY | 先实现UI和server preview门禁并运行隔离测试；不得从本决定自动进入UAT部署或真实收货 |

## SELFHOST-UAT-FIX-37 Warehouse Receipt Readiness and Date Safeguards（完成）

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | WAREHOUSE RECEIPT READINESS FIXED — UAT RECEIPT NOT POSTED | 关系化证据、最小权限DTO、两阶段确认、日期/提前到货门禁、事务保护、IQC职责隔离、正式备份恢复、0040、Web-only部署及warehouse-only主UAT全部完成 |
| 严格起点 | PASS | 唯一worktree、clean`main@a40660cc3ba8e74495c919ba0f2602485597fc38`、Parent`bdb4fd07e76e405f418833aeaf5b0c9c4b5e5ae7`、behind0/ahead175；alpha.40、0039、Web`664e0ac6…a4ec89`及主业务`1/4/4/4+下游0`完全吻合 |
| Schema/版本 | alpha.41 / 0040 DEPLOYED | 现有Schema不能关系化保存必需送货证据，故唯一新增不可变`warehouse_receipt_evidence`及约束/索引/服务触发器；0040 SHA`b6781c94…a5a93`，0039及更早未改 |
| 只读DTO/数据域 | PASS / MINIMUM | `WAREHOUSE_RECEIPT_READINESS_V1`展示PO商务/创建凭证、四Line/Plan/queue及下游计数；跨域403，warehouse无`system.audit.read`，不返回正文、Cookie、Session或敏感Header |
| 两阶段/日期证据 | PASS | “核对收货”只发权威GET；取消/关闭/ESC/背景零业务POST。最终POST使用服务端实际时间并锁定PO/Line/Plan/queue，重验CAS/剩余量/CSRF/Origin/权限/幂等；未来证据日期拒绝，提前到货缺凭证/理由/显式确认返回稳定中文错误 |
| IQC/库存语义 | PASS / MODE-SPECIFIC | IQC物料收货生成Receipt+RML冻结Lot、`IQC_RECEIPT` Ledger、可用量0并交quality；NORMAL物料不生成RML/IQC冻结或IQC队列，生成普通`RECEIPT` Ledger并重算可用量。主Material 533—536均为STOCKED/NORMAL；warehouse IQC写403，quality既有授权通过 |
| 自动/隔离测试 | PASS | Unit/UI/Dashboard/Procurement 22/22；Identity UI/Unit19、Mapping11、Sourcing36、Fulfillment21；0040 Migration3/3；隔离NORMAL/IQC专项2/2；完整Fulfillment PG9/9；typecheck、production build、Origin、敏感扫描和`git diff --check`通过 |
| 写保护覆盖 | PASS | 空/0/负数/超量、未来日期、提前缺证据/完整成功、PO/Line/Plan/queue陈旧CAS、幂等重放/异正文冲突/并发单胜、CSRF/Origin/角色/限流、故障回滚、IQC权限及Receipt/Lot/Ledger真实语义均在隔离PostgreSQL验证；Chromium写路径未连接主库 |
| 备份/恢复 | PASS | root:root0600 dump 2,298,941 bytes、SHA`28e07b9d…0868`、`pg_restore --list`3,359行；第二新库恢复39/head0039后核对`1/4/4/4+下游0`，升级0040并重放无变化，随后精确删除 |
| 部署 | WEB + MIGRATION ONLY | 主库受控应用0040；Web`664e0ac6…→0cf98937…`（88,678,839 bytes），仅recreate Web。PostgreSQL/Worker/Caddy容器未替换，四个受保护Volume未更换，旧Web保留精确回退tag |
| 主UAT | PASS / WAREHOUSE READ-ONLY | `uat_20260729_warehouse`未改密；完整谱系、四行、下游0、桌面四种取消、390×844取消及back/forward/refresh/退出通过；`business_post=0`、Session0，前后浏览器业务指纹同为`48e2f213…013` |
| 最终业务事实 | PRESERVED | PO 1/v1/OPEN；Line/Plan/queue`4/4/4`且各v1/未收；Receipt/Evidence/Lot/IQC/Ledger/AP/Payment/Work Order/生产记录全0；D-105受控对象未删除、修改、取消、重建或再次转换 |
| 资源/清理 | PASS | 起点available约2.0GiB、Swap273MiB、根盘17GiB且1分钟Load低于4；最终收口available2.1GiB、Swap285MiB/1GiB、根盘17GiB、Load`0.45/0.37/0.44`。内核OOM0，四服务restart0/OOM false；临时数据库/验证容器精确清理，Playwright目录移入可恢复Trash，未prune，正式备份/回退镜像保留 |
| 下一门禁 | NEW AUTHORIZATION REQUIRED | 本次只证明readiness；任何真实收货必须提供真实实物/送货证据并另获最终POST授权。IQC决定、AP、付款和生产均不在本任务授权内 |

## SELFHOST-UAT-FIX-36 PO History Traceability（完成）

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | PO HISTORY TRACEABILITY FIXED — UAT DOWNSTREAM UNCHANGED | 受限DTO、响应式详情、隔离测试、正式备份恢复、Web-only部署及purchase-only主UAT全部完成 |
| 读模型 | PASS / READ ONLY | `PO_HISTORY_TRACEABILITY_V1`在purchase数据域校验后，以单一repeatable-read/read-only事务投影PO、完整上游谱系、四Line、四Plan/queue、凭证和下游计数 |
| 权限/凭证 | PASS / MINIMIZED | 跨数据域403且列表不泄漏；purchase无`system.audit.read`。DTO只给目标PO Event/Audit/Idempotency状态和摘要，不给正文、Cookie、Session或Header |
| D-105 | FORWARD ONLY / NON-RETROACTIVE | 产品不硬编码D-105或目标PO，也不声称授权已验证；原始写入无法绑定事前授权的判断不变 |
| 主库保护 | PASS / ZERO WRITE | PO/Line/Plan/queue`1/4/4/4`、下游全0、business POST0；状态指纹`721f25f8…05194`、历史指纹`d11b46bc…14ae7`及浏览器指纹`ae02a432…cc68`前后不变 |
| 请求ID核对 | DATABASE VALUE PRESERVED | 实际为`773c23b6-0923-4ab5-a451-bb80aa4bdf9d`；任务原文少末尾`d`，产品按数据库真实UUID展示，未补写或截断 |
| 自动/隔离 | PASS | Unit/UI9、Fulfillment PG6+偏移ID专项、Sourcing/Binding PG20、upgrade`3+5+6`、安全/Identity/Origin、typecheck2、lint、npm3、Python三项、credentials功能1287/最终1288、Chromium1通过 |
| 响应式/重开 | PASS | 桌面与390×844、刷新、back/forward、Web进程重启重开、无页面横向溢出、Session0均在隔离Chromium通过 |
| 备份/恢复 | PASS | root:root0600 dump 2,297,975 bytes、SHA`0e6f8215…38f1`、list3,359行/3,348 TOC；第二新库恢复39/head0039、226表、`1/4/4/4`及下游0后精确删除 |
| Schema/Web-only | NO 0040 / DEPLOYED | alpha.40、0039 SHA`3cbf5738…e3f37`不变；Web`83c1bff3…→664e0ac6…`，仅recreate Web，PostgreSQL/Worker/Caddy及四卷不变，连续health`7/7` |
| 主UAT/会话 | PASS / PURCHASE ONLY | 1440和390×844聚合/谱系/Line/Plan/queue/凭证/下游0、刷新和重开通过；只登录purchase，business POST0，退出后Session0 |
| 资源/清理 | PASS | 最终available约1.9GiB、Swap277MiB、根盘17GiB、Load`0.09/0.23/0.36`；内核OOM0，四服务restart0/OOM false；临时库/容器/Volume精确清理，正式备份及回退镜像保留 |
| 下一门禁 | INDEPENDENT RECEIVING AUTHORIZATION REQUIRED | 技术前置已具备，但本任务未登录warehouse或验证主UAT写路径；到货/仓库收货、IQC、入库、AP和生产均须新的独立授权 |

## SELFHOST-UAT-DECISION-35 Controlled Retention Decision for Unauthorized UAT PO

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | CONTROLLED UAT PO RETENTION DECISION RECORDED | D-105已记录受控保留；本书面决定与提交构成控制事件，只提供前向授权并明确“不追溯性授权” |
| 决策 | D-105 / ACCEPTED | 标题`Controlled retention of unauthorized UAT PO-00000001`；分类保持为未经事前授权但结构完整的UAT写入，即数据结构完整但来源授权不可证明 |
| PO事实 | PRESERVED 1/4/4/4 | `PO ID 1 / PO-00000001`；request`773c23b6-0923-4ab5-a451-bb80aa4bdf9d`、actor`uat_20260729_purchase`、2026-08-08 14:11:45.086372 Asia/Shanghai；Award`1/v1/AWARDED`、Supplier`1/SUP-000001`、480.00 CNY |
| 证据保护 | CONTROLLED RETENTION | PO、四条Line、四条Plan、四条queue及Event/Audit/Idempotency证据原样保留；不删除、修改、取消、重建或重复转换，Award→PO不再重试 |
| 下游 | MUST REMAIN ZERO | Receipt、Ledger、IQC、AP、付款及生产记录保持0；本任务没有数据库连接或业务写，未改变`SELFHOST-UAT-AUDIT-34`记录的基线 |
| 授权边界 | READ-ONLY PO TRACEABILITY ONLY | 正式提交后现有PO作为固定UAT起点；只授权后续只读PO追溯验收。warehouse、quality、finance及到货/收货/IQC/入库/库存/AP/付款/生产仍未授权，每个写阶段须独立明确授权 |
| 下一任务 | PO HISTORY TRACEABILITY ONLY | 只能修复/验收PO历史追溯页面并先补齐完整谱系和凭证；不是仓库收货或IQC任务 |
| 范围 | DOCS ONLY / NO UAT ACCESS | 仅更新MASTER/TASKS/PROJECT_CONTEXT/DECISIONS/CHANGELOG/STATUS和本任务报告；未登录UAT、连接PostgreSQL、调用Identity/业务API、改凭据、Migration、build、deploy或restart |
| 非数据库验证 | PASS / ISOLATED | 文档7份/本地引用38、`git diff --check`、credentials 1,280文件、Python self-test/smoke、临时SQLite go-live及轻量`npm test` 3/3串行收口；宿主npm缺失后使用本机已有Node镜像的断网只读自动删除容器复验 |
| 资源/清理 | PASS | available约`1.9→1.9GiB`，Swap`238→238MiB`，根盘18GiB，最终Load`0.01/0.10/0.10`；内核OOM0，四服务restart0/OOM false。任务临时目录/容器/网络/Volume清零，四个受保护Volume保留 |
| Git | ONE DOCS COMMIT / NO PUSH | 起点clean`main@e67c9209bc24314000f70760b7b79282c4a9b469`、Parent`9a8a3bd8a84bacb2836ac116d3b8a80783e96fe6`、behind0/ahead172；提交消息`docs: retain unauthorized UAT purchase order under control`，提交后ahead173，实际SHA以Git log为准 |

## SELFHOST-UAT-AUDIT-34 Existing UAT PO Provenance and Integrity Audit

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | UNAUTHORIZED UAT PO WRITE CONFIRMED — DATA PRESERVED | 采用分支B；结构和关系化来源完整，但不能证明成功写入属于仓库内获授权任务。数据原样保留，不追认、不修复、不继续下游 |
| 起点门禁 | PASS | 唯一worktree、clean`main@9a8a3bd8a84bacb2836ac116d3b8a80783e96fe6`、Parent`1f205af0bf81379345a09353d9d32ab5c7545971`、behind0/ahead171；alpha.40、Migration0001—0039、Web`83c1bff3…`，无并发Award/PO/履约流 |
| 成功创建 | EXACTLY ONCE / SOURCE IDENTIFIED | PO ID1/`PO-00000001`/v1/OPEN；request`773c23b6-0923-4ab5-a451-bb80aa4bdf9d`，actor`uat_20260729_purchase`，2026-08-08 14:11:45.086372；Audit1491 SUCCESS、Idempotency201、PO CREATED Event1一致 |
| 授权来源 | NOT PROVABLE | 成功请求位于purchase LOGIN/LOGOUT时间窗，但关系化记录不保存task/runner/browser/session绑定；FIX33在约43分44秒前仍明确business POST0、正式转换须新授权，仓库内没有后续转换任务、授权记录或提交。不能证明也不能排除浏览器/隔离runner误连，不推断凭据泄露或自然人身份 |
| 历史失败 | ZERO BUSINESS RECORDS | request`f30a7801-1cd0-4849-95a8-9c61d5c52e67`，Audit1482 failed/`AWARD_SUPPLIER_MAPPING_NOT_UNIQUE`；FIX33报告HTTP422，PO/Link/Plan/Event/Idempotency均0 |
| PO/Line | EXACT 1/4 | Supplier1/SUP-000001；CNY、40 PCS、已收0、480.00；四行Material533—536各10 PCS×12.00=120.00，Award Line1—4、Candidate2/4/6/8、Quote Line1—4、Binding/Mapping fact1—4闭合，Supplier B0、重复0、第五行0 |
| 备注偏差 | SEMANTIC UAT / NOT EXACT TEXT | 实际`纯虚拟UAT采购订单,仅用于黑盒验收,不对应真实采购。`使用两个半角逗号，不等于要求的全角原文；本审计不改写 |
| Plan/queue | EXACT 4/4 | Plan ID1—4各唯一绑定PO Line/Award Line/Material，10 PCS、2026-10-20、PENDING/v1及CREATED Event；queue ID1—4均OPEN_PENDING/v1。独立Plan Line表不存在，重复/孤儿/错PO/错Material/多重queue均0 |
| Award/RFQ | UNCHANGED / CLOSED | Award1/v1/AWARDED、Line4、digest和内容保持，`po_convertible_now=false`、待转Award0；RFQ1/CLOSED/v7，其v6→v7由先前Award Audit1469证明，本次转换不改CAS。Quote/Comparison/Binding/Mapping计数与状态保持 |
| 下游 | EXACT ZERO | 目标Receipt、Warehouse Receipt、Ledger、Lot、IQC、AP、Payment、Work Order、Production Report/Completion及关联计数全0；45个带request_id的`production_%`表按成功request扫描亦全0 |
| 指纹/浏览器 | UNCHANGED / READ ONLY | 目标谱系SHA-256前后均`12d2c02031f34a5212bec80f5f9a5edcc8b1983fe24b96570f87fb17e2f5af18`。桌面1440×900、390×844及只读detail/queue GET通过；页面无独立详情/Audit组件并如实记录；`business_post=0`、最终Session0 |
| Schema/运行面 | UNCHANGED | alpha.40、0039及Web镜像保持；未Migration、build、deploy、重启或读取日志正文；所有业务查询使用`REPEATABLE READ READ ONLY`事务 |
| 测试 | PASS / ISOLATED | 项目`.venv`串行通过Python self-test、smoke和临时SQLite `go_live_check --no-backup`；首次系统Python smoke因缺`openpyxl`在导入阶段停止，切回既有项目环境后通过。未安装依赖、未连接主UAT |
| 资源/清理 | PASS | 起点/浏览器后/文档测试后available约2.1/1.8/1.9GiB，Swap235/237/237MiB，根盘18GiB，最终Load`0.07/0.12/0.09`；内核OOM0、四服务restart0/OOM false。任务容器/临时目录/库/网络/持久文件清零，未prune，受保护卷未改 |
| Git/放行 | ONE DOCS COMMIT / RECEIPT BLOCKED | 仅报告及MASTER/TASKS/STATUS/CHANGELOG，提交消息`docs: audit existing UAT PO provenance`；不push/PR/改历史。项目负责人书面决定前不得开始仓库收货/IQC或其他下游 |

## SELFHOST-UAT-FIX-33 Award to PO Supplier Mapping Validation Diagnosis and Fix

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | AWARD TO PO SUPPLIER MAPPING VALIDATION FIXED — UAT PO NOT CREATED | 分支A实现、回归、备份恢复、Web-only部署及purchase-only取消UAT全部完成；主UAT没有最终转换 |
| 诊断分支/根因 | BRANCH A / FIXED / DEPLOYED | GET只信任Award历史粗粒度`po_convertible_now`；POST另行动态重查Mapping、忽略固定Binding，并以`material.base_unit_id=unit.id`错误过滤四条legacy `base_unit_id=NULL/base_uom=PCS`合法Mapping |
| 四条Mapping | AUTHORITATIVE / QUALIFIED | Supplier1/SUP-000001，Material533—536，Mapping UUID`224d1965…07ff8`、`43ca04d8…18030`、`aa16f7e7…f257e`、`9659ad2d…c63f`，fact1—4/v1/row CAS3，ACTIVE、PCS→PCS、正数1:1、2026-08-05起长期有效、两类冲突0 |
| 四条谱系 | STABLE IDS / NO NAME BRIDGE | Award Line1—4→Candidate`2/4/6/8`→Quote Line1—4→RFQ Binding1—4→上述固定Mapping fact；Event join不参与基数 |
| GET/POST资格 | SAME LOADER / SAME DTO | 共用`AWARD_PO_MAPPING_QUALIFICATION_V1`、transaction as-of、`[from,to)`、bigint字符串ID和相同逐行错误；确认正文断言资格digest |
| Unit/冲突 | FAIL CLOSED | 优先关系化base Unit；legacy仅按`base_uom`唯一解析启用Unit；Supplier/Internal/RFQ Unit一致且比率为正数等值；Supplier/Material及Supplier Part两类冲突均核验 |
| 事务/漂移 | LOCKED / ATOMIC | 锁定Award/Line/Candidate/Quote/Binding/Mapping/Supplier/Material/Unit，和Mapping写共用part→material advisory顺序；固定状态/version/CAS/digest/有效期漂移拒绝，无关Mapping变化不阻断，PO Line只用固定fact |
| 隔离成功/失败 | EXACT 1/4/4/4 / FAILURES 0 | 成功为PO/PO Line/Delivery Plan/queue `1/4/4/4`；缺失、冲突、状态、日期、Unit、比例、漂移、并发和故障路径业务记录全0 |
| 自动/浏览器 | PASS | 无DB93、Unit22、Fulfillment PG5、Mapping PG10、0038/0039`5/6`、Sourcing PG9、Binding PG18、upgrade3、npm3、Python三项、三个typecheck、build、lint0 error/11既有warning、最终credentials1278、diff及Chromium1通过；桌面/390×844四行凭证可读 |
| 备份/恢复 | PASS | root:root0600单硬链接dump 2,294,665 bytes，SHA-256`d3cf053f09948c6e4ae54caff028a7663a3750249bcaf3e8758e2f0ace49c5c2`，`pg_restore --list`3,359项；第二新库单事务恢复39/head0039、226表及全部保护事实后删除 |
| Web-only部署 | PASS / NO MIGRATION | Web`2396c8bc…→83c1bff3…`；旧Web精确回退tag保留。只recreate Web；PostgreSQL/Worker/Caddy身份和四卷不变，未运行Migration |
| 主UAT | CANCEL ONLY / NO BUSINESS POST | purchase只执行一次桌面与390×844预览，四行均qualified、`po_convertible_now=true`，填本地备注后取消；`preview_get=1`、`business_post=0`、Session0 |
| Schema/最终业务事实 | UNCHANGED | alpha.40、0001—0039且无0040；失败请求`f30a7801-1cd0-4849-95a8-9c61d5c52e67`仍恰好一次，成功转换0；RFQ CLOSED/v7、Award1/v1/AWARDED、Line4、四条Mapping不变，PO/Line/Plan/queue `0/0/0/0` |
| 资源/清理 | PASS | 起点/收口available约2.1GiB，Swap`233→250MiB`，根盘18GiB；收口Load`0.55/0.39/0.39`，任务时段内核OOM0，四服务restart0/OOM false；七个隔离库、恢复库、临时容器/网络/runtime/目录已精确清理，正式dump和回退镜像保留，未prune |
| Git/再次转换 | FUNCTION COMMIT / NEW AUTH REQUIRED | 功能提交`1f205af0bf81379345a09353d9d32ab5c7545971`，独立运维提交消息`ops: deploy Award to PO mapping validation fix`；未push/PR/改写历史。技术门禁已具备，但正式转换仍须新的明确授权并重验当前事实 |

## SELFHOST-UAT-FIX-32 Award to PO Conversion Confirmation Contract Fix

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | AWARD TO PO CONFIRMATION FIXED — UAT PO NOT CREATED | 两阶段源码、服务端同事务保护、隔离测试、正式备份恢复、Web-only部署及主UAT取消验收全部通过 |
| 根因 | FIXED / DEPLOYED | 旧入口首击直接POST；新入口首击只GET权威预览并打开窗口，最终确认才POST |
| 确认窗口 | COMPLETE / FAIL CLOSED | 展示Award/RFQ/Comparison/Quote谱系、Event actor/时间/request_id/SUCCESS、两类摘要、Supplier/付款条件、四条Line、PO/Line/Plan数量、上游不修改及下游零自动创建范围 |
| 字段模型 | REMARK YES / EXTERNAL REF NO | 正常PO备注最多2,000字；无外部参考字段并准确提示，未挪用字段、未新增0040 |
| 聚合语义 | EXACT 1 / 4 / 4 | 隔离正式转换为1个PO、4条PO Line、4个直接绑定PO Line的Delivery Plan；模型没有独立计划Line |
| 服务端保护 | PASS | purchase、Origin/CSRF、Award/RFQ CAS、摘要、完整唯一Line、Supplier/Mapping、PO0、幂等正文、并发单胜和故障回滚均由服务端重验，不信任浏览器价格或范围 |
| 事务边界 | ONE CONNECTION / ONE TRANSACTION | 同事务创建PO/Line/Link/Plan/Queue/Event/Audit/幂等结果；故障注入所有半记录为0 |
| 下游保护 | ZERO AUTO-CREATE | Receipt/Warehouse Receipt/Ledger/IQC/AP/Payment/Work Order及其他生产/财务记录不自动创建 |
| 自动/隔离验收 | PASS | Fulfillment 4/3/3、Sourcing 12/24、PG27、upgrade3+3+6、安全30、npm3、Python三项、typecheck/build/lint/credentials/diff及Chromium通过 |
| 备份恢复 | PASS | root:root0600 dump 2,294,098 bytes、SHA`75e45758…3d97`、list3359；第二新库恢复39/head、226表、四basis、Award/Line/Event及下游0后删除 |
| Web-only部署 | PASS / NO MIGRATION | Web`bb544f89…→2396c8bc…`；旧Web有精确回退tag，PostgreSQL/Worker/Caddy及四卷不变，未运行Migration |
| 主UAT | PASS / CANCEL ONLY | 只登录purchase；桌面/390×844打开、核验、填备注并取消，`preview_get=1`、`business_post=0`、Session0，PO/Plan前后0 |
| 最终数据 | UNCHANGED | RFQ CLOSED/v7、Quote2、Comparison v1、Award/Line/Event/PO/Plan`1/4/1/0/0`，`po_convertible_now=true`、`awardable_now=false` |
| 资源/清理 | PASS | available约2.1→2.1GiB、Swap274→239MiB、根盘18GiB、最终Load`0.71/0.38/0.62`；内核OOM0、四服务restart0/OOM false，临时库/容器/runtime/SQLite清零 |
| Git/下一步 | TWO COMMITS / NEW AUTH REQUIRED | 功能`a4ffb8e`及独立ops收口；具备重新执行正式转换的技术前置，但必须新任务、新授权并重验全部事实 |

## SELFHOST-UAT-FIX-31 RFQ Award History Traceability Fix

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | RFQ AWARD HISTORY TRACEABILITY FIXED — UAT PO NOT CREATED | Award历史读模型、响应式页面、状态投影、备份恢复、Web-only部署和purchase-only主UAT全部完成；没有创建PO |
| Award身份 | ID 1 / NO BUSINESS NUMBER / v1 / AWARDED | 稳定数据库ID和真实Version/状态直接来自Award Header；无独立业务编号时准确说明，不伪造字段 |
| 四行引用 | PASS / STABLE IDS | Award Line 1—4闭合到Comparison Line 1—4、Candidate 2/4/6/8、Quote Line 1—4、Quote 1/v1、Supplier 1、Material 533—536；Supplier B Award Line 0 |
| 摘要 | PERSISTED + DERIVED / SEPARATED | 持久化`award_digest=7ac6bf2e…a66e55`不冒充decision digest；无持久化decision字段，按`AWARD_DECISION_V1`从不可变事实稳定重算 |
| Event/CAS | EVENT 1 / AUDIT v6→v7 | 唯一AWARDED Event没有版本转换字段；同request_id唯一成功Audit独立证明v6→v7，当前v7来自RFQ Head，不回填或显示vnull |
| 状态投影 | CURRENT + NOT AWARDABLE | Comparison仍CURRENT，但Award存在后`awardable_now=false`；`po_convertible_now`基于Award/RFQ/四行/引用/来源PRQ/PO计数只读计算 |
| UI/写边界 | READ ONLY | Award存在后不显示创建表单或确认按钮；历史页无Award/PO写调用，转PO只显示资格和独立任务边界 |
| 自动验证 | PASS | typecheck、Unit12/12、UI24/24、PG27/27、0039 6/6、安全30/30、Chromium5/5、npm3/3、environment6/6、Python三项、lint/credentials/diff通过 |
| Schema/版本 | UNCHANGED | alpha.40、0001—0039保持；没有0040、历史回填或主UAT业务字段修改 |
| decision digest | DERIVED / VERIFIED | `AWARD_DECISION_V1`重算值`7beca9f364718d9161cc4205e282279cdcc97e3fee91073f3494b76abfa7651a`；非持久化且与Comparison output/持久化Award摘要明确分离 |
| 备份恢复 | PASS | root:root0600 dump 2,293,634 bytes、SHA`7a3eb872…d4fa`、list3359；第二新库恢复39/head、226表与Award/Line/Event/PO`1/4/1/0`后删除 |
| Web-only部署 | PASS / NO MIGRATION | Web更新为`sha256:bb544f89ac405c9565fa551c4120c89d4cc58022220db9a3f46c548a6533a81d`；旧`f1184385…`有精确回退tag，PostgreSQL/Worker/Caddy及四卷不变 |
| 主UAT | PASS / READ ONLY | 只登录purchase；桌面/390×844、刷新、重开通过，`business_post=0`、Session0；RFQ v7、Quote2、Comparison v1、Award/Line/Event/PO `1/4/1/0`前后不变 |
| 资源/清理 | PASS | available约2.1→2.2GiB、Swap252→273MiB、根盘18GiB、最终Load`0.11/0.20/0.37`；内核OOM0、四服务restart0/OOM false，临时库/容器/runtime/SQLite清零 |
| Git/下一步 | TWO COMMITS / NEW AUTH REQUIRED | 功能`a014742`及独立ops收口；`po_convertible_now=true`允许另立转PO任务，但实际转换必须重新校验并取得明确授权 |

## SELFHOST-UAT-FIX-30 RFQ Award Confirmation Contract Fix

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | RFQ AWARD CONFIRMATION FIXED — UAT AWARD NOT CREATED | 正式确认合同、隔离Award、备份恢复、Web-only部署和主UAT取消验收全部完成 |
| 固定Quote | PASS / DIRECT DTO | A为Quote`1/v1`、Supplier`1 / SUP-000001`、`UAT-Q-A-042576`、480.00 CNY、2026-10-20、ON_TIME/提前10天；B为Quote`2/v1`、Supplier`2 / SUP-000002`、`UAT-Q-B-042576`、400.00 CNY、2026-11-05、LATE/延期6天；不反向查找 |
| Award聚合/行 | EXACT 1 / 4 | 明确一次不可变Award操作、恰好四条Award Line；Comparison Line1—4对应Candidate`2/4/6/8`，均为Supplier A且不拆分数量 |
| 上游不可变 | PASS / EXPLICIT | 逐项声明RFQ冻结范围、Quote1/v1、Quote2/v1、Comparison Version1、Comparison Line/Candidate、Binding/Mapping均不修改 |
| 下游保护 | PASS / EXPLICIT ZERO AUTO-CREATE | 逐项列出PO、Delivery Plan、Receipt、Inventory Ledger、AP、Work Order、其他生产记录和其他财务记录均不自动创建 |
| 下一阶段 | INDEPENDENT TASK | 明确通过独立“定标转PO与到货计划”任务处理；本次不自动执行，处理人未指定、时限未配置如实显示 |
| DTO/服务端 | UNCHANGED / GUARDED | Award提交DTO未变；CURRENT/Quote/Candidate/CAS/basis/output、原因、purchase权限、Origin/CSRF、幂等、并发、审计和回滚保护未放宽 |
| UI/可访问性 | PASS | RFQ/Round/CAS、四basis/output digest、Material533—536各10 PCS、金额/价差/交期差、原因/完整理由保留；默认焦点取消，桌面/390×844、长理由/digest/request_id均无页面级横向溢出 |
| 自动/隔离验收 | PASS | Unit11/11、UI22/22、PG27/27、0039 6/6、安全20/20、浏览器5/5及适用typecheck/build/npm/Python通过；取消/关闭/ESC POST0，同步双击只产生Award1/Line4/PO0 |
| 备份恢复 | PASS | root:root0600 dump 2,292,405 bytes，SHA`19d563f4…e39e`，list3359；第二新库恢复39/head0039、226表、0/0/0与保护指纹一致后删除 |
| Web-only部署 | PASS / NO MIGRATION | Web更新为`sha256:f11843852426478828c87cf6ec1e889949614beb5ce54df49c23557d16b75e34`；旧`f239ffe3…`有FIX30精确回退tag，PostgreSQL/Worker/Caddy及四卷未重建，未运行Migration |
| 主UAT | PASS / CANCEL ONLY | 只登录purchase，桌面/390×844本地选择Candidate`2/4/6/8`并打开确认后取消；刷新草稿清空，business POST0、Session0 |
| 最终数据 | UNCHANGED | RFQ ISSUED v6、Quote2、Comparison v1/CURRENT、Line4、Candidate8、Award/Award Line/PO`0/0/0`；output digest`79554d88…619ec`与保护指纹`16d70f18…cf5bc`不变 |
| 资源/清理 | PASS | available约`2.1→2.2GiB`，Swap`242→252MiB`、根盘18GiB、Load最终`0.16/0.34/0.58`；内核OOM0，四服务restart0/OOM false，任务临时资源清零且四个受保护Volume保留 |
| Git/下一步 | TWO COMMITS / STOP | 功能`22aa4dc`与独立ops收口；不push/PR/改写历史。具备技术条件但正式Award仍须新授权和事实重验，转PO/到货计划另立任务 |

## SELFHOST-UAT-FIX-29 RFQ Award Candidate Selection Fix

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | RFQ AWARD CANDIDATE SELECTION FIXED — UAT AWARD NOT CREATED | Candidate选择、服务端重验、确认窗口、隔离Award、Web-only部署和主UAT取消验收全部完成 |
| 根因 | FIXED | RFQ Line bigint由PostgreSQL返回字符串，旧Quote Line路径投影为数字，前端严格比较使四行过滤为空；旧UI还错误使用Quote Line ID作为选择/提交值 |
| Candidate DTO | STABLE STRING IDS | Candidate、Comparison Line、Quote/Quote Line、RFQ Line等bigint在JSON中均为规范十进制字符串；关联仅使用Candidate→Comparison Line→RFQ Line及Candidate→固定Quote Line外键 |
| 四行分组 | PASS / EXACT TWO EACH | Line 1—4分别为Candidate`1/2`、`3/4`、`5/6`、`7/8`；B固定Quote 2/v1、A固定Quote 1/v1，无跨Material混入 |
| 选择合同 | PASS | 每行默认“请选择”并恰好两个Supplier option，value为Candidate ID；A rank2与B rank1均可选，不按Supplier名、位置、价格、RESPONDED或不存在的Candidate状态过滤 |
| 确认窗口 | PASS | 显示RFQ/Round/CAS、v1/CURRENT、basis/output digest、四行身份、A480/B400、差80/20%、提前10/延期6/早16天、`DELIVERY_PRIORITY / 交期优先`及完整理由；默认焦点取消并明确不自动创建PO |
| 服务端保护 | PASS | 同事务锁RFQ并重验CURRENT、固定Quote、CAS、basis/output、全行集、Candidate归属、数量/币种/价格和非最低价理由；Origin/CSRF/purchase权限/幂等/并发/审计/回滚未放宽 |
| 拒绝回归 | PASS | 跨Line、历史Version、错Quote、缺行/重复/额外行、过期CAS、输入/输出漂移、非CURRENT、数字Candidate ID和不适用理由全部拒绝 |
| 自动/隔离验收 | PASS | Unit/UI 33/33、Sourcing PG9/9、既有Binding/Quote/0039 PG18/18、upgrade6/6、安全20/20；隔离Chromium取消POST0，正式只POST一次，Award1/Line4/PO0，桌面与390×844无页面级溢出 |
| 备份恢复 | PASS | root:root0600 dump 2,291,936 bytes，SHA`151910bc…e712`，list3359；第二新库恢复39/head0039、226表、保护指纹一致后精确删除 |
| Web-only部署 | PASS / NO MIGRATION | Web更新为`sha256:f239ffe3059cfbd5cbb26a45d0960249450ec61989a8f91fb4e17dff3e26e4c1`；旧`0dfcc0a8…`有精确回退tag，PostgreSQL/Worker/Caddy及四卷未重建，未运行Migration |
| 主UAT | PASS / CANCEL ONLY | 只登录purchase，本地选择A Candidate`2/4/6/8`、打开桌面/390×844确认窗口后取消并退出；business POST0、Session0 |
| 最终数据 | UNCHANGED | RFQ ISSUED v6、Binding8、Quote2、Comparison v1/CURRENT、Line4、Candidate8、Award/Award Line/PO`0/0/0`；output digest`79554d88…619ec`与保护指纹`16d70f18…cf5bc`不变 |
| 资源/清理 | PASS | 起点/最终available约2.1GiB，Swap`272→250MiB`、根盘18GiB、最终Load`0.04/0.10/0.16`；内核OOM0，四服务restart0/OOM false，任务临时库/容器/runtime清零且四个受保护Volume保留 |
| Git/下一步 | TWO COMMITS / STOP | 功能`99a5e6b`与独立ops收口；不push/PR/改写历史。已具备技术条件，但正式点击创建Award仍需新授权及当前CAS/摘要/Quote/Candidate重验 |

## SELFHOST-UAT-FIX-28 RFQ Comparison聚合读模型与摘要修复

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | RFQ COMPARISON AGGREGATE READ MODEL FIXED — UAT AWARD NOT CREATED | 复用既有逐RFQ Line关系模型完成聚合读模型、Web-only部署和purchase-only只读验收；未创建Award/PO |
| 身份/Schema | COMPOSITE / NO 0040 | Comparison Line稳定ID为1—4；无独立Header ID，Version身份为RFQ 1、Round 1、Version 1及四个持久化basis；alpha.40/0039保持 |
| 状态/输入 | CURRENT / NO DRIFT | 状态为服务端投影而非数据库列；Quote ID 1/v1、2/v1及固定Quote Line均当前，历史Version投影SUPERSEDED，漂移时INPUT_DRIFT并禁用定标 |
| 输出摘要 | PASS / DETERMINISTIC | Material→Supplier→Comparison Line→Candidate稳定排序，摘要`79554d88…619ec`；输入basis持久化，输出摘要与Supplier/Material汇总为服务端派生 |
| 金额/交期 | PASS | A `480.00 CNY / ON_TIME / 提前10天`，B `400.00 CNY / LATE / 延期6天`；差额80、以B为基准20%、A早16天 |
| Event分组 | 4 DATABASE EVENTS / 1 UI RECEIPT | 四条真实Line级Event按同actor/时间/request_id/result显示为一个生成操作凭证；不是四次点击或四个Version，历史未改 |
| 生成治理 | PASS / IDEMPOTENT | 当前输入按钮禁用且刷新保持；隔离同输入返回现有v1零Comparison/Event/CAS增量，Quote修订后才形成v2，v1不可变 |
| 自动验证 | PASS | Unit/UI `10/10+18/18`、隔离PG`3/3`、0039`6/6`、Chromium`1/1+4/4`、typecheck/build/npm/Python/environment/credentials/diff通过；lint 0 error/11既有warning |
| 备份/恢复 | PASS | root:root0600 dump 2,291,624 bytes、SHA`8e858983…bffa`、list3,359；第二新库39/head/226表与同指纹后删除 |
| Web-only部署 | PASS | Web`89e76775…→0dfcc0a8…`；仅重建Web，无Migration，PostgreSQL/Worker/Caddy和四卷不变；旧Web精确rollback tag保留 |
| 主UAT | PASS / READ ONLY | purchase-only桌面/390×844通过；生成禁用，定标仅可见未打开，`business_post=0`、Session0、Quote2、Comparison4/8/4、Award/PO0/0 |
| 数据保护 | PASS / UNCHANGED | 保护指纹`16d70f1865e3a2e3b0e840f289d13b340e4f6b87800b1c79d98865112d0cf5bc`在主库起点、恢复库、部署前和UAT后完全一致 |
| 资源/清理 | PASS | available约2.2→1.9GiB、Swap275→269MiB、根盘18GiB、最终Load`0.11/0.26/0.44`；内核OOM0，四服务restart0/OOM false，临时资源清零 |
| Git/后续 | TWO FOCUSED COMMITS / NEW AUTH REQUIRED | 功能`80e1ad6`；收口消息`ops: deploy RFQ comparison aggregate read model`。`awardable_now=true`只允许另立任务，不构成定标授权 |

## SELFHOST-UI-STATUS-LOCALIZATION-DEPLOY-06 ERP 可见状态中文化 Web-only 部署

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | STATUS LOCALIZATION DEPLOYED — ANONYMOUS READ-ONLY VERIFIED | 项目负责人明确授权的`943c7fa`状态中文化已部署到当前18888非生产UAT |
| 严格范围 | WEB ONLY / ANONYMOUS READ ONLY | 只替换Web；不运行Migration，不登录、不发业务POST，不替换PostgreSQL/Worker/Caddy或四卷 |
| 候选/回退 | PASS | 新Web`sha256:89e767753875…`、88,572,838bytes；旧Web`sha256:f45d734becf2…`已固定精确rollback tag |
| 备份/恢复 | PASS | root-only dump 2,291,624bytes、SHA-256`2beeaeb2…d99`、list3,359；第二新库恢复39/head、226表、文件卷和相同业务指纹后删除 |
| Web-only部署 | PASS | 仅`--no-deps --no-build --force-recreate web`替换Web；PostgreSQL/Caddy身份不变，Worker仅一致性窗口短停后以原容器恢复，migrate未运行，四卷不变 |
| 在线验收 | PASS / ANONYMOUS | HTTP308，HTTPS根页/health/legacy/status asset/app.js200；在线SHA、中文状态词典、private/no-store、安全头、匿名无Cookie和Summary/Materials401通过 |
| 数据保护 | PASS / UNCHANGED | 指纹`59057998…bdbc24`部署前/恢复库/部署后一致；39/head、Session209、Audit1455、RFQ ISSUED v6、Binding8、Supplier A/B Quote1/1、Quote/Award/PO2/0/0保持 |
| 自动验证 | PASS | 候选build/postbuild、三组UI合同13/13、npm3/3、候选健康、部署收口Python三项及1,249文件credentials通过；完整源码回归沿用功能提交证据 |
| 稳定性 | PASS | 公开域名连续60秒health7/7，SwapFree`766600→766676KiB`；内核OOM0，Web/PostgreSQL/Worker/Caddy均restart0/OOM false |
| 资源/清理 | PASS | available约2.2→2.2GiB、Swap272→276MiB、根盘19GiB、Load`0.25/0.24/0.43`→`0.21/0.20/0.24`；临时worktree/容器/恢复库/文件/SQLite清零，正式备份和镜像保留 |
| Git/后续 | TWO FOCUSED COMMITS / NEW AUTH REQUIRED | 功能`943c7fa`；收口消息`ops: deploy localized ERP statuses`。登录式浏览器验收、业务操作、Migration或生产切流须新授权 |

## SELFHOST-UI-STATUS-LOCALIZATION-05 ERP 可见状态中文化

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | VISIBLE ERP STATUSES LOCALIZED — SOURCE ONLY | 原生与legacy已统一中文展示业务状态、角色、审核/执行结果和启停状态 |
| 展示边界 | PASS / RAW VALUES IMMUTABLE | 共享`statusLabel/statusPairLabel/roleLabel`只转换最终可见文本；未知枚举保留原值，API/筛选/比较/提交/CSS/审计继续使用稳定原码 |
| 页面覆盖 | PASS | 状态徽标、列表/详情、筛选显示、决策/操作凭证、审计结果与当前角色均已接入；纯英文眉题中文化，ERP/BOM/RFQ/PO/IQC/IPQC/FQC/AR/AP/ID/CAS保留 |
| 自动验证 | PASS | 38个UI/物料/状态测试文件、10组typecheck、production build/postbuild、npm3/3、Python三项、1,247文件credentials和diff check通过；lint 0 error/11既有warning |
| 浏览器边界 | SOURCE VERIFIED / UAT NOT RUN | 五个受影响浏览器验证脚本语法和中文期望已更新；未登录或连接公开UAT执行旅程 |
| API/数据库/版本 | UNCHANGED | 认证、权限、业务、Schema/Migration、数据库枚举、alpha.40/0039均未改 |
| UAT/部署 | DEPLOYED BY FOLLOW-UP | 源码任务自身未部署；后续`SELFHOST-UI-STATUS-LOCALIZATION-DEPLOY-06`已完成Web-only部署与匿名只读验收 |
| 资源/清理 | PASS | available约2.2→2.2GiB、Swap260→272MiB、根盘19GiB、Load`0.04/0.19/0.37`→`0.18/0.78/0.72`；内核OOM0、四服务restart0/OOM false，任务容器/挂载点/临时SQLite清零 |

## SELFHOST-DASHBOARD-ROLE-HUB-DEPLOY-04 八角色工作台 Web-only 部署

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | ROLE-BASED WORKBENCH DEPLOYED — ANONYMOUS READ-ONLY VERIFIED | 项目负责人明确授权的 `4767c3d` 八角色工作台已部署到当前18888非生产UAT |
| 严格范围 | WEB ONLY / ANONYMOUS READ ONLY | 只替换Web；不运行Migration，不登录、不发业务POST，不替换PostgreSQL/Worker/Caddy或四卷 |
| 候选/回退 | PASS | 新Web `sha256:f45d734becf2…`、88,560,525 bytes；旧Web `sha256:f139257b6b6b…`已固定精确rollback tag |
| 备份/恢复 | PASS | root:root 0600 dump 2,288,824 bytes、SHA-256 `dad839eff68d649e1098b0df33ba3316245a93f65893aea985d012362df266d6`、list3,359；第二新库恢复39/head、226表及相同指纹后删除 |
| Web-only部署 | PASS | 仅`--no-deps --no-build --force-recreate web`替换Web；PostgreSQL/Caddy容器身份不变，Worker仅为备份窗口短停并恢复，migrate未运行，四卷不变 |
| 在线验收 | PASS / ANONYMOUS | HTTP 308，HTTPS根页/health/legacy 200，新bundle含八角色入口和新CSS；private/no-store、安全头、匿名无Cookie、Summary/Materials 401通过 |
| 数据保护 | PASS / UNCHANGED | 指纹`597eb456…9f9f`在部署前/恢复库/部署后一致；39/head、Session207/有效1、Audit1446、RFQ ISSUED v4、Binding8、Supplier A/B Quote1/0、Quote/Award/PO1/0/0不变 |
| 稳定性 | PASS | 60秒health7/7、SwapFree无下降；内核OOM0，Web/PostgreSQL/Worker/Caddy均restart0/OOM false |
| 资源/清理 | PASS | available约2.2→2.1GiB、Swap306→260MiB、根盘19GiB、Load`2.51/1.97/1.03`→`0.40/0.38/0.57`；无效dump、恢复库、临时目录/容器清零，正式备份和current/candidate/rollback镜像保留 |
| 过程修正 | RECORDED / NO DATA CHANGE | 运行类别门禁和一次遗漏Compose项目名均在正式部署前失败关闭；无效dump已删，旧服务恢复后按精确项目名完成一致性备份与部署 |
| Git/后续 | TWO FOCUSED COMMITS / NEW AUTH REQUIRED | 功能`4767c3d`；收口消息`ops: deploy role-based ERP workbench`。登录式浏览器验收、业务操作、迁移或生产切流须新授权 |

## SELFHOST-DASHBOARD-ROLE-HUB-03 登录后八角色工作台

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | ROLE-BASED WORKBENCH COMPLETE — SOURCE ONLY | 根工作台已改为管理员、采购、市场、计划、工程、财务、生产、仓库八入口与单一当前部门清单 |
| 严格范围 | ROOT UI ONLY | 只改根工作台组件、共享样式和 UI 契约；认证、权限定义、API、业务、Schema/Migration、版本及业务页面不变 |
| 权限与覆盖 | PASS | 当前40个Dashboard模块完整唯一归入八部门；实际链接只取服务端Summary裁剪结果，未授权部门不可进入 |
| 密度与响应式 | PASS | 指标/风险/治理/事件/全模块方块退出首屏；桌面左右分栏，720px以下纵向，焦点/禁用/reduced-motion/无页面级溢出保持 |
| 自动验证 | PASS | UI 73/73、五组typecheck、lint、生产build/postbuild、npm3/3、Python三项、1,241文件credentials及diff check通过 |
| UAT/部署 | DEPLOYED BY FOLLOW-UP | 源码任务自身未部署；后续 `SELFHOST-DASHBOARD-ROLE-HUB-DEPLOY-04` 已完成Web-only部署与匿名只读验收 |
| 资源/清理 | PASS | available约2.1→2.2GiB、Swap292→306MiB、根盘19GiB、Load`0.07/0.18/0.32`→`2.51/1.97/1.03`；四服务restart0/OOM false，临时容器清零 |

## SELFHOST-UI-REFRESH-DEPLOY-02 企业级 UI Web-only 部署

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | ENTERPRISE UI DEPLOYED — ANONYMOUS READ-ONLY VERIFIED | 项目负责人明确授权的 `aac6f34` UI 已部署到当前 18888 非生产 UAT |
| 严格范围 | WEB ONLY / ANONYMOUS READ ONLY | 只替换 Web；不运行 Migration，不登录、不执行业务 POST，不替换 PostgreSQL/Worker/Caddy/四卷 |
| 严格起点 | PASS | clean `main@aac6f34`、behind0/ahead154；alpha.40/0039；旧Web `20b41bd3…`，线上 legacy 仍为旧缓存版本 |
| 资源起点 | PASS | available约2.2GiB、Swap289MiB、根盘18GiB、Load`0.21/0.35/0.43`；Web/PostgreSQL healthy，Worker/Caddy running |
| 候选/部署 | PASS / WEB ONLY | Docker build/postbuild、UI 4/4、Dashboard 5/5、静态/运行合同通过；Web `20b41bd3…→f139257b…`，旧镜像精确rollback tag保留 |
| 基线回归 | PASS | npm3/3、Python三项、1,240文件credentials和diff check通过；测试SQLite已精确删除 |
| 在线验收 | PASS / ANONYMOUS | HTTPS根页/health/legacy/CSS 200，新bundle/缓存/设计令牌/安全头通过；匿名Session false/null且不发Cookie，Summary/Materials 401 |
| 数据保护 | PASS / UNCHANGED | dump 2,288,827 bytes、SHA`8dd0141b…`、list3,359及第二新库恢复通过；39/head、226表、Session207/有效10、Audit1446和指纹`597eb456…9f9f`前后一致 |
| 服务边界 | PASS | PostgreSQL/Worker/Caddy容器身份与四卷不变，migrate未运行；四服务restart0/OOM false，60秒health7/7、Swap无增长 |
| 资源/清理 | PASS | available约2.2→2.2GiB、Swap289→292MiB、根盘18→19GiB、Load`0.21/0.35/0.43`→`0.28/0.49/0.49`；临时容器/恢复库/工作区输出清零，正式备份和镜像保留 |

## SELFHOST-UI-REFRESH-01 自托管 ERP 企业级 UI 统一改造

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | SELF-HOSTED ERP UI REFRESH COMPLETE — SOURCE ONLY | 参考用友式一体化门户、角色工作台和紧凑信息密度，统一晨亿达自有视觉；不复制商标或素材 |
| 严格范围 | UI ONLY | 登录、经营工作台、原生共享业务壳、Supplier Mapping/RFQ 扩展和 legacy 兼容台；API/认证/权限/业务/Schema/Migration 不变 |
| 严格起点 | PASS | clean `main@70045998`、behind 0/ahead 153；alpha.40、0039；Web/PostgreSQL healthy，Worker/Caddy running |
| 资源起点 | PASS | available 约2.2 GiB、Swap286 MiB、根盘18 GiB、Load `0.01/0.12/0.16`；四服务restart0/OOM false |
| 视觉实现 | PASS | 统一企业级设计令牌、响应式认证区、紧凑经营工作台、原生业务壳及 legacy 兼容台；缓存版本统一，焦点可见并支持 reduced motion |
| 自动验证 | PASS | 静态 UI 72/72、五组 typecheck、生产 build/postbuild、npm 3/3、Python三项、1,238文件 credentials 和 diff check通过；lint 0 error/11既有warning |
| UAT/部署 | NOT AUTHORIZED / UNCHANGED | 未登录或写入UAT，未构建镜像、重启服务或部署；当前18888运行Web保持改造前界面，alpha.40/0039不变 |
| 资源/清理 | PASS | available约2.2→2.2GiB、Swap286→289MiB、根盘18→18GiB、Load`0.01/0.12/0.16`→`0.38/0.62/0.52`；OOM0、四服务restart0/OOM false。任务参考图、容器、Python测试备份及活动行清零，历史数据/备份和四卷不变 |

## SELFHOST-UAT-FIX-27 RFQ Quote Version语义与追溯

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | RFQ QUOTE VERSION SEMANTICS FIXED — SUPPLIER A RETAINED | 采用分支A；错误漂移已修复并Web-only部署，Supplier A Quote ID 1保留，主UAT未创建Supplier B Quote |
| 严格起点 | PASS | clean`main@119dd04`、Parent`f6f7d2a`、behind0/ahead151；alpha.40、0001—0039、0039 SHA、Web`c8c3fdd5…`、主RFQ保护事实和资源完全吻合 |
| RFQ CAS | AGGREGATE / EXPECTED v3→v4 | Quote首版事务锁定RFQ并推进aggregate CAS；0039允许ISSUED→ISSUED且Version+1。v3→v4不是范围漂移，不回退 |
| 邀请状态 | EXPECTED INVITED→RESPONDED | Supplier A成功Quote后为RESPONDED；Supplier B独立保持INVITED、Quote0且服务端入口可用 |
| 漂移根因/修复 | FIXED / FAIL-CLOSED | 旧`eligible`混入邀请INVITED并被固定Binding阻断项复用；现以Binding/Supplier-Line/Mapping ID-Version-Row CAS-content-status-effective/唯一性和摘要判断，真实漂移仍阻断 |
| 固定范围 | PASS / IMMUTABLE | Binding 1—8、Mapping ID/Version/Row CAS/content digest与Supplier/Line集合不变；重算摘要`9765f8fdef768335a25b314867dd3e077429a84848cba067ff8394c8a017848d`一致 |
| Quote身份/状态 | ID 1 / SUBMITTED v1 | 无独立业务编号，精确显示“未设置独立Quote业务编号”；Supplier ID1/SUP-000001、RFQ ID1/Round1、外部参考`UAT-Q-A-042576`、有效期2026-09-30 |
| Event语义 | DIRECT SUBMIT / NO CREATE | 唯一`QUOTE_SUBMITTED/SUCCESS`；单事务直接提交没有CREATE。历史Event无版本列，不回填，显示“事件未记录版本转换”，当前v1独立显示，无`vnull` |
| 金额/交期 | SERVER AUTHORITATIVE | 四行各10 PCS×12.00 CNY=120.00，总额480.00；需求2026-10-30、承诺2026-10-20、`ON_TIME`/准时提前10天，均由服务端读模型投影 |
| Supplier B隔离验证 | PASS / MAIN ZERO | 隔离环境可成功提交且并发单胜；临时库已删。主UAT只确认入口，不进入/填写/提交，Supplier B Quote仍0 |
| 自动验证 | PASS | Unit/UI 9/9+12/12、隔离PG21/21、Chromium3/3、0018 3/3、0039 6/6、npm3/3、environment6/6、Python三项；typecheck/build/credentials/diff通过，lint0 error/11既有warning |
| 备份/恢复 | PASS | root:root 0600 dump 2,286,915 bytes、SHA-256`4fa038e093a846ae0d8380f383b5fc9a89cb926aded1c3bc98746269f89a400d`；list3,359行，第二新库39/head/226表与保护指纹一致后已删 |
| Web-only部署 | PASS | Web`c8c3fdd5…→20b41bd34741758e707f3748baaa1018232df6be5d44cd63bed290fd49c9f4f9`、88,551,279 bytes；无Migration，PostgreSQL/Worker/Caddy身份和四卷不变，旧Web rollback tag保留 |
| 主UAT | PASS / READ ONLY | purchase-only桌面/390×844准确核对Quote追溯、金额、交期和无漂移；Supplier B入口仅观察；`business_post=0`、Session0。首次仅runner连续字符串断言错误，安全退出且哈希不变，修正后通过 |
| 主UAT数据 | PASS / UNCHANGED | 指纹`597eb456837e0cda35d3544c1aeae94f3a190eed373d1145de5a72261fe37f9f`；RFQ ISSUED v4、Binding8、Mapping/Issued Event1/1、Supplier A/B Quote1/0、Quote/Award/PO1/0/0 |
| 资源/清理 | PASS | 起点/最终available约2.1/2.2GiB、Swap290/287MiB、根盘19/18GiB、最终Load`0.14/0.17/0.33`；瞬时Load未持续越界，内核OOM0、四服务restart0/OOM false。临时库/容器/runtime/SQLite清零，未prune |
| Git/后续 | TWO FOCUSED COMMITS / NEW AUTH REQUIRED | 功能`1be492e`；收口消息`ops: deploy rfq quote traceability fix`。后续Supplier B Quote、A修订、Comparison/Award/PO均须新授权 |

## SELFHOST-UAT-FIX-26 RFQ 发出确认硬性合同

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | RFQ ISSUANCE CONFIRMATION FIXED — UAT RFQ STILL DRAFT | 确认合同已Web-only部署；主RFQ未发出、未重新固定、未创建任何下游 |
| 严格起点 | PASS | clean `main@f0202b0`、Parent `08af2f4`、behind 0/ahead149；alpha.40、0001—0039、0039 SHA、Web`315f0b79…`、主RFQ保护事实与资源均吻合 |
| Binding状态分支 | INDEPENDENT FIELD / ACTIVE | 0039有独立`binding_status`并CHECK ACTIVE；页面分栏显示Binding ACTIVE、Mapping ACTIVE、邀请INVITED，固定来源、状态漂移和版本漂移独立；无Binding行不伪造ACTIVE |
| 按钮/默认焦点 | PASS | 入口“发出询价并冻结范围”；最终写按钮精确“确认发出”；默认焦点取消。取消/关闭/ESC/背景关闭0业务请求，确认同步禁用 |
| 下游保护 | PASS / EXHAUSTIVE | Quote、Award、PO、Delivery Plan、Receipt/收货、Inventory Ledger/库存流水、AP/采购应付、Work Order/生产工单、其他生产记录、财务记录逐项列出为不自动创建或修改 |
| Binding关联/排序 | PASS / 1—8 | 主表按稳定Binding ID升序；1—4为Supplier1/Line1—4/Material533—536，5—8为Supplier2/Line1—4/Material533—536，八个Mapping UUID逐行与数据库一致 |
| 摘要消歧 | PASS / IMMUTABLE | 主UI不再把`3,4,1,2,7,8,5,6`作为身份字段；摘要规范化与身份展示解耦。Binding、算法、Event和固定摘要`9765f8fd…4848d`均未改 |
| 自动验证 | PASS | UI 10/10、Unit 8/8、隔离PG 20/20、Chromium 2/2、0039 Migration 6/6、npm 3/3、Python 3/3；typecheck/build/credentials/diff通过，lint 0 error/11既有warning |
| 隔离发出/失败关闭 | PASS | 双击仅1个issue POST、1条`RFQ_ISSUED`和1次CAS；Quote/Award/PO及全部下游0。权限、CSRF、Origin、过期CAS、幂等冲突均fail closed；桌面/390×844无溢出 |
| 备份/恢复 | PASS | root:root 0600 dump 2,284,946 bytes，SHA-256`b810d5a588a0a262ace478569815e1ca7e8c84dab7218368d435d8400263497d`；list 3,359行，第二空库39/head/226表和指纹一致，恢复库已删 |
| Web-only部署 | PASS | Web`sha256:315f0b79…→sha256:c8c3fdd52236b84e3ceb67f7b81ca2e5530bfaba964a92ebd22dab9f7da19989`、88,546,098 bytes；无Migration，PostgreSQL/Worker/Caddy身份及四卷不变，旧Web rollback tag保留 |
| 主 UAT | PASS / READ ONLY | purchase-only桌面/390×844两次打开窗口并只取消；Binding IDs `1,2,3,4,5,6,7,8`，`business_post=0`、Session0 |
| 主 UAT数据 | PASS / UNCHANGED | 指纹`9c7b43774e1d0562785933729d40329a69a3230b5b1580473ac29a2463037d3f`；RFQ DRAFT v2、Binding8、Mapping Event1、ISSUED/Quote/Award/PO及全部下游0 |
| 资源/清理 | PASS | 起点/最终available约2.1/2.0GiB、Swap279/283MiB、根盘19/19GiB、最终Load`0.12/0.17/0.32`；内核OOM0、四服务restart0/OOM false。临时库/容器/runtime/SQLite清零，正式备份/镜像/四卷保留 |
| Git/后续 | TWO FOCUSED COMMITS / NEW AUTH REQUIRED | 功能`f6f7d2a`；收口消息`ops: deploy rfq issuance confirmation contract`。正式发出必须新任务重新校验并明确授权 |

## SELFHOST-UAT-FIX-25 RFQ Binding 关联基线更正

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | RFQ BINDING BASELINE CORRECTED — UAT RFQ STILL DRAFT | 采用分支 B；数据库和页面身份正确，只替代由显示顺序位置 zip 产生的错误验收基线 |
| 严格起点 | PASS | clean `main@08af2f4`、Parent `e329931`、behind 0/ahead 148；alpha.40、0001—0039、0039 SHA、Web `315f0b79…`、服务/资源和主 RFQ保护状态全部吻合 |
| 权威关联 | PASS / 8 OF 8 | 按 PK 为 1→S1/M533/`224d…`、2→S1/M534/`43ca…`、3→S1/M535/`aa16…`、4→S1/M536/`9659…`、5→S2/M533/`45a3…`、6→S2/M534/`5bd2…`、7→S2/M535/`3ac2…`、8→S2/M536/`5432…`；Supplier/Line/Material/Mapping fact/version/part/Unit/1:1/状态逐项匹配 |
| 完整性 | PASS | Binding 8、ID唯一 8、Supplier×Line唯一 8；RFQ Supplier、RFQ Line/Material、Mapping外键错配 0，重复/孤儿/跨 RFQ 0 |
| 固定摘要 | PASS / IMMUTABLE | 源码现有 `canonicalDigest` 重算为 `9765f8fdef768335a25b314867dd3e077429a84848cba067ff8394c8a017848d`，与唯一 `RFQ_MAPPING_CONFIRMED/SUCCESS` Event一致，未改摘要 |
| 查询/DTO/UI | CORRECT | Repository 直接投影 `b.id::text` 并用稳定 FK关联；Service/UI排序完整行对象，不使用数组位置、Material/Supplier顺序或 `index + 1` 生成/重配 ID |
| 根因 | BASELINE POSITION ZIP | FIX-24 明细表正确；摘要性序列 `3,4,1,2,7,8,5,6` 只代表当次显示顺序，却被按位置配到 Material 533—536，产生错误旧基线 |
| 页面旧值/新值 | UNCHANGED / NO DEPLOY | 没有 UI代码或值变化；现有页面逐行身份保持正确，只把文档改为权威关联表并明确显示顺序不是身份 |
| 数据/运行面 | ZERO CHANGE | 未修改 RFQ/Binding/Event/Audit/PRQ/Supplier/Mapping/Material或下游；无 Migration、备份恢复、部署、UAT登录或业务 POST，PostgreSQL/Worker/Caddy/Web和四卷均未更换 |
| 主 UAT 前后 | PASS / READ ONLY | 前后均为 RFQ 1 DRAFT v2、Binding 8、Mapping Event 1、ISSUED 0、Quote/Award/PO 0/0/0 |
| 测试/资源/Git | PASS | Node `3/3 + 8/8 + 9/9`、Python三项、1,228文件凭据扫描、diff check和终点只读计数通过；资源约 2.2→2.1 GiB available、Swap 279→278 MiB、根盘19 GiB，内核 OOM 0、四服务 restart 0/OOM false，任务临时资源清零。提交消息 `docs: correct rfq binding association baseline`，实际 SHA以 Git为准，未 push/PR或改写历史 |

## SELFHOST-UAT-FIX-24 RFQ Binding 稳定 ID 与发出前固定凭证

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | RFQ BINDING IDENTIFIERS DEPLOYED — UAT RFQ STILL DRAFT | 真实 Binding PK、独立 Mapping固定凭证和发出前完整检查已 Web-only 部署；主 RFQ未再次固定、未发出、未录报价或定标 |
| 严格起点 | PASS | clean `main@3bea653`、Parent `f919890`、behind 0/ahead 146；alpha.40、0001—0039、0039 SHA、Web `5fe40694…`、服务/资源及主 RFQ DRAFT v2/Binding 8/Event 1/下游 0全部吻合 |
| 主键模型 | BRANCH A / NO 0040 | 0039 已有 `id bigserial PRIMARY KEY NOT NULL`，运行时 `bigint`、sequence-backed、唯一且稳定。显式文本 `binding_id` 贯通 Repository/DTO/Service/Handler/UI；复合键/序号/哈希未冒充 ID |
| 详情/排序 | PASS | 八条按 Supplier code、Material code、Binding ID稳定排序；逐卡显示 RFQ/Line/Supplier/Material/Mapping稳定 ID及双方名称、part、单位/1:1、有效期、固定/当前状态、两类漂移和摘要归属，四类 ID标签分离 |
| 固定凭证 | PASS / IMMUTABLE | 唯一 `RFQ_MAPPING_CONFIRMED` SUCCESS Event投影 actor、上海时间、request_id、v1→v2、Binding 8、八 ID、固定摘要和不可变说明；刷新、重登和 Web重启后可重开 |
| 发出窗口/门禁 | PASS / CANCEL ONLY | 创建 Audit、完整固定 Event、八 Binding及 Mapping ID/Version、4 Material、2 Supplier、截止日/CNY、漂移与后果齐全；缺失/重复/跨 RFQ或凭证不完整禁用。主 UAT桌面/390px均可确认但只取消 |
| 权限/零写 | PASS | 详情/发出预览为 purchase权限和 RFQ/PRQ数据域内只读事务；未授权/跨域403。POST继续重验 CAS、数量、摘要、Mapping漂移、PRQ、截止日、幂等/并发/回滚，不因展示放宽 |
| 自动验证 | PASS | Unit/UI `17/17`、PostgreSQL `20/20`、Chromium `2/2`、0039 `6/6`、0018 `3/3`、Material Requirement `18/18`、npm `3/3`、environment `6/6`、Python三项；typecheck/Schema/build/credentials/diff通过，lint 0 error/11既有 warning |
| 备份/恢复 | PASS | root:root 0600 dump 2,284,331 bytes，SHA-256 `e937d7bcabbc78cc415dacf8565a58e7255724997b9332834acff8d5ec705ab6`；list 3,359行，第二空库 39/head/226表、八 ID和指纹一致，恢复库已删 |
| Web-only 部署 | PASS | Web `sha256:5fe40694…→sha256:315f0b7945a7b3eb27841ffaae8a444fba45dd94791519dc856173a95d830635`、88,545,226 bytes；无 Migration，PostgreSQL/Worker/Caddy身份及四卷/Origin/端口保持，旧 Web rollback tag保留 |
| 主 UAT | PASS / READ ONLY | purchase-only 按当次页面显示顺序读取 ID `3,4,1,2,7,8,5,6`、重开固定凭证、刷新，并在桌面/390×844两次打开窗口后取消；该序列不定义与 RFQ Line/Material 的位置关联。`business_post=0`、安全退出 Session 0 |
| 主 UAT 数据 | PASS / UNCHANGED | 最终指纹 `9c7b43774e1d0562785933729d40329a69a3230b5b1580473ac29a2463037d3f`；RFQ DRAFT v2、Binding 8、Mapping Event 1、ISSUED/Quote/Award/PO及全部下游 0 |
| 资源/清理 | PASS | final-deploy前/最终 available约 2.2/2.2 GiB，Swap 284/283 MiB，根盘 18/19 GiB，最终 Load `0.19/0.48/0.44`；内核 OOM 0、四服务 restart 0/OOM false。临时库/恢复库/容器/runtime/SQLite/过期候选镜像清零，未 prune |
| Git/后续 | TWO FOCUSED COMMITS / NEW AUTH REQUIRED | 功能 `e329931`；收口消息 `ops: deploy rfq binding traceability`。技术凭证完整，但正式发出必须在新任务中重新校验并获明确授权；本任务停止 |

## SELFHOST-UAT-FIX-23 RFQ Mapping 固定权威预览与凭证措辞

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | RFQ BINDING PREVIEW FIXED — UAT BINDINGS STILL ZERO | 权威 Mapping 固定预览、共享 POST 重验、不可变说明和 Audit/Event 分列已 Web-only 部署；主 RFQ 未固定、未发出、未录报价或定标 |
| 严格起点 | PASS | clean `main@7cd9cd0`、Parent `b339acd`、behind 0/ahead 144；alpha.40、0001—0039、0039 SHA、Web `58d97778…`、服务/资源和主 RFQ DRAFT/四行/两 Supplier/八 ACTIVE Mapping/零下游全部吻合 |
| 权威预览 | PASS / ZERO BUSINESS WRITE | manage 权限、RFQ/PRQ 数据域、repeatable-read/read-only；返回 RFQ/PRQ CAS、四行、两 Supplier、逐组合 Mapping/Unit/1:1/有效期/冲突、observed_at/timezone和资格摘要。成功/失败均不写 Audit/Event/Idempotency/Binding |
| 冲突与资格 | PASS | Supplier/Material 当前有效 ACTIVE 1:1 数必须为 1；同 Supplier 标准化 part 不得多 ACTIVE 或跨 Mapping UID 稳定占用。主 UAT两家各 4/4、缺失 0、两类冲突 0、候选/预期 8、当前 Binding 0 |
| POST 失败关闭 | PASS | 预览和固定共用同一 Service 加载器；POST 锁后复核 actor 数据域、RFQ/PRQ/Supplier/Material/Mapping/Binding和摘要。预览不是锁，CAS/幂等/并发单胜/事务回滚未放宽；漂移生成零 Binding |
| UI/措辞 | PASS | 加载态、observed_at、默认取消、取消/关闭/ESC零业务写、八 Mapping、两家4/4与零冲突、Binding 0→8、不可变关系化快照和零自动下游说明完整；桌面/390×844无溢出。历史“RFQ 创建成功审计”与独立 `RFQ_CREATED 业务 Event` 分列 |
| 自动验证 | PASS | Unit/UI `16/16`、PostgreSQL `19/19`、隔离 Chromium `2/2`、0018 `3/3`、0039 Migration `6/6`、Material Requirement `18/18`、npm `3/3`、environment `6/6`、Python三项；typecheck/build/credentials/diff通过，lint 0 error/11既有 warning |
| Schema consistency | PASS CONTRACT / PRE-EXISTING GENERATOR DRIFT | 0039 schema/snapshot/journal契约 `6/6`；任务树与原始 HEAD 的 `db:generate` 均提出两个语义等价 CHECK 表限定化 0040。生成物已丢弃，未新增/修改 Migration或Schema |
| 备份/恢复 | PASS | root:root 0600 dump 2,282,691 bytes，SHA-256 `ef5855252729ec072886e14a0dc4d40bac839b407989a63c8f3baab9fe7ece77`；list 3,359 行，第二空库 39/head/226 表与指纹一致，恢复库已删 |
| Web-only 部署 | PASS | Web `sha256:58d97778…→sha256:5fe406949d4678d5beb06ba6db4d931f88f5f24989332654b557b8a4f9df6e4b`、88,543,673 bytes；未运行 Migration，PostgreSQL/Worker/Caddy容器身份及四卷/Origin/端口保持，旧 Web rollback tag保留 |
| 主 UAT | PASS / READ ONLY | purchase-only 一次通过：创建成功 Audit 准确、两家4/4、两类冲突0、八 Mapping及不可变说明；桌面 ESC、390px取消，预览 GET 2、`business_post=0`、安全退出 Session 0 |
| 主 UAT 数据 | PASS / UNCHANGED | 最终指纹 `9d4641b1b6324de4e3a1a26e7461ca2e15bd7613cb99a277c11e6bca869ac66e`；RFQ DRAFT v1、Binding/Event/ISSUED/Quote/Award/PO 0，四行/两 Supplier/八 ACTIVE Mapping保持 |
| 资源/清理 | PASS | available memory 约 2.1→2.3 GiB，Swap 234→268 MiB，根盘 20→19 GiB，最终 Load `0.43/0.36/0.54`；内核 OOM 0、四服务 restart 0/OOM false。临时库/恢复库/容器/runtime/validation image清零，未 prune |
| Git/后续 | TWO FOCUSED COMMITS / NEW AUTH REQUIRED | 功能 `f919890436662265bb22e2bec9ae00f5c2761372`；收口消息 `ops: deploy rfq binding preview safeguards`。可在新明确授权任务中执行 Mapping 固定；固定后仍 DRAFT，实际发出另需授权 |

## SELFHOST-UAT-FIX-22 RFQ 草稿创建凭证、Mapping 追溯与发出保护

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | RFQ TRACEABILITY DEPLOYED — UAT RFQ STILL DRAFT | alpha.40/0039、RFQ 创建凭证、精确 Mapping 绑定和安全发出确认已部署；主 RFQ 未固定 Mapping、未发出、未录报价或定标 |
| 严格起点 | PASS | clean `main@60538d08509f91eeb0df91718c7276172c23557d`、Parent `a86d9ad…`、behind 0/ahead 142；alpha.39、0001—0038、Web `c98d3e8a…`、服务/资源和主 RFQ DRAFT/四行/双 Supplier/八 ACTIVE Mapping/下游 0 全部吻合 |
| 模型分支 | BRANCH B / 0039 | 原 Schema 没有 RFQ Supplier×Line→精确 Supplier Mapping version 关系，只存邀请摘要。新增不可变绑定表和 generation 2 lifecycle credential；现有 generation 1 草稿不回填、不伪造 |
| Migration/版本 | PASS / DEPLOYED | `0.1.0-alpha.40`，39/head `0039_rfq_traceability.sql`，SHA-256 `3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`；0001—0038 未修改，0038 SHA 保持 |
| 创建凭证 | PASS / FAIL CLOSED | 新 RFQ 使用同事务不可变 `RFQ_CREATED/SUCCESS` Event；历史 RFQ 仅以唯一精确成功 Audit 投影 `EXACT_SUCCESS_AUDIT`，不由“页面可打开”反推。主 RFQ 显示真实 actor/上海时间/request_id/不存在→v1并说明未伪造 Event |
| Mapping 追溯 | PASS | 新 RFQ 创建时保存 Supplier/Material、精确 Mapping row/UID、Version/CAS/digest、supplier part、Unit、1:1、有效期、绑定来源/状态/actor/time/request_id。主 RFQ Binding 0，八条只显示当前资格/拟绑定和上海业务日期 |
| 发出确认/门禁 | PASS | 四行、两 Supplier、八 Mapping、PRQ、截止日/CNY和后果完整；默认取消，取消/关闭/ESC 零请求，同步双击保护。服务/数据库重验状态/CAS/PRQ/Supplier/Material/Mapping/截止日并按组合失败关闭；成功不自动建下游 |
| 自动验证 | PASS | Migration 6/6；Unit/UI 14/14、PostgreSQL 12/12（合计 26/26）；Material Requirement 12/12；真实 Sourcing→Award→Fulfillment 2/2；最终隔离 Chromium 1/1；typecheck、Schema、build、credentials、diff、Python三项通过，lint 0 error/11 既有 warning |
| 隔离发出 | PASS | 草稿创建、取消/关闭/ESC、Mapping 漂移阻断、正式发出、刷新和 Web 重启通过；创建 Event 1、Binding 8、发出 Event 1、双击 issue POST 1，Quote/Award/PO 0，Session 0，桌面/390px通过 |
| 备份/恢复 | PASS | root:root 0600 dump 2,232,310 bytes，SHA-256 `960cd6a882b1ab923f2ee38dd83e9fc41f53942048bd5c1c07fcc44f1f3ae6c2`；list 3,321 行。第二新空库恢复 0038、匹配指纹、升级 0039 后再匹配，恢复库已删 |
| 部署 | PASS | 最终 Web `sha256:58d97778d88d6103ca4d6cc3e0bfe8033bf0921a6c1b7ecbec31254403792651`、88,531,959 bytes；PostgreSQL/Worker/Caddy和四卷未更换，内外 health 通过，四服务 restart 0/OOM false，精确回滚标签保留 |
| 主 UAT | PASS / READ ONLY | purchase-only 核验创建凭证、DRAFT双语义、历史未固定和八条拟 Mapping；桌面/390×844 各打开确认并取消，安全退出。`business_post=0`、Session 0 |
| 主 UAT 数据 | PASS / UNCHANGED | 指纹部署前/迁移后/Web更新后/UAT后均为 `9d4641b1b6324de4e3a1a26e7461ca2e15bd7613cb99a277c11e6bca869ac66e`；RFQ DRAFT v1、PRQ ACCEPTED、Binding/Event 0、Quote/Award/PO及全部下游 0 |
| 资源/清理 | PASS | available memory 约 2.0→2.1 GiB，Swap 259→239 MiB，根盘 20→20 GiB，Load `0.24/0.20/0.13`→`0.16/0.30/0.41`；临时数据库/容器/standalone/Playwright目录为 0，未 prune，正式备份/镜像/四卷保留 |
| Git/后续 | TWO FOCUSED COMMITS / NEW AUTH REQUIRED | 功能 `b339acd`；收口消息 `ops: deploy rfq issuance safeguards`。未 push/PR/改历史；主 RFQ 必须先在新授权任务中显式固定当前 Mapping，实际发出仍须明确授权，不能直接发出 |

## SELFHOST-UAT-FIX-21 Supplier Mapping 批准确认、审核意见与成功凭证

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | SUPPLIER MAPPING APPROVAL SAFEGUARDS DEPLOYED — UAT 1 ACTIVE 7 PENDING | 审核保护已 Web-only 部署，operations-only 主 UAT 只读验收通过；没有批准/退回剩余七条或创建 RFQ |
| 严格起点 | PASS | clean `main@2d0cf5f033cad724bf2215e77e4fda953a499cd4`、behind 0/ahead 140；alpha.39、0001—0038、Web `c1576bd2…`、服务/资源、1 ACTIVE / 7 PENDING、PRQ ACCEPTED 和下游 0 全部吻合 |
| 模型分支 | BRANCH A / NO 0039 | 0038 的不可变 APPROVED Event 已关系化保存 actor/time/request/result/status，通用 `reason` 可保存批准意见；成功 Audit 保存 CAS 前后。保持 alpha.39/0038，不改 0001—0038、不伪造回填 |
| 审核意见 | PASS / INDEPENDENT | APPROVE 正文只接受必填 `review_comment` 并原样保存到 APPROVED Event.reason；REJECT 继续只接受 `reason` 并保存到 Mapping.review_reason。批准意见不进入退回字段或不必要日志 |
| 预览权威 | PASS / ZERO WRITE | repeatable-read/read-only 预览读取 Mapping、Supplier/Material/Unit、创建/提交 Event、Supplier part claim、ACTIVE 1:1 有效期冲突与摘要；Supplier/Material 状态取主表。GET 正常/失败均不写 Audit或业务事实 |
| 确认/安全 | PASS | 点击批准只打开窗口；意见必填，默认焦点在意见；取消/关闭/ESC 零业务请求。确认前二次预览，按钮同步锁、幂等/CAS/并发单胜、自审/越权、CSRF/Origin、限流、冲突和故障整事务回滚保持 |
| 成功/历史凭证 | PASS | Mapping/Event/Audit 投影 actor、上海时间、request_id、SUCCESS、意见、V/CAS 前后、终态、稳定 Supplier/Material、料号、单位换算和有效期；刷新、重登和 Web 重启后可重开 |
| 旧 ACTIVE 真实性 | PASS / UNCHANGED | `224d1965-44ef-4c3e-901e-1926b6b07ff8` 的真实 APPROVE 为 operations actor、`2026-08-05 09:34:45.436464`、request `b38c84b9-29a1-47ab-b68b-a6baf56e7121`、SUCCESS、V1/CAS 2→V1/CAS 3、ACTIVE；既有意见为空，页面显示“历史批准未采集审核意见” |
| 列表/响应式 | PASS | operations 可按状态、Supplier、Material、后缀、Mapping ID 搜索；展示 Version/CAS、双方状态、冲突与创建/提交/审核 provenance；待审核/已生效/已退回区分，桌面与 390×844 无页面级横向溢出 |
| 自动验证 | PASS | Supplier Mapping Unit `6/6`、UI `5/5`、隔离 PostgreSQL `10/10`、Migration 0038 `5/5`、隔离 Chromium `1/1`；Sourcing/FIX-19 PG `5/5`、Identity PG `10/10`，适用静态/UI/npm/CSRF/Origin 回归、Python `3/3`、typecheck、Schema consistency、production build、credentials、diff check 通过；lint 0 error/10 既有 warning |
| 备份/恢复 | PASS | `/var/backups/chenyida-erp/supplier-mapping-fix21-predeploy-20260805T031625Z.dump` 为 root:root 0600、2,227,987 bytes、SHA-256 `fb14cf1ba9220ca8eafd564eb673b62cacd5ac2db92bf928e8fec99222e77f71`；list 3,306 项，第二新空库恢复同一 38/head/225 表和保护指纹后已删除 |
| Web-only 部署 | PASS | Web `sha256:c1576bd2…→sha256:c98d3e8a…`；旧镜像保留 `rollback-approval-safeguards-fix21-predeploy-20260805T031959Z`。没有运行 Migration；PostgreSQL/Worker/Caddy 容器身份和四卷不变，四服务 restart 0/OOM false |
| 主 UAT | PASS / READ ONLY | 只登录 operations：默认 7 待审，打开指定 PENDING 完整预览、核验独立意见后取消；重开唯一 ACTIVE 真实凭证；状态/后缀/Mapping ID 与桌面/390px通过。业务 POST 0，最终 Session 0 |
| 保护事实 | PASS / UNCHANGED | 部署前、备份恢复副本、部署后、两次只读 runner 前后均为 `2562f52e82eebbede265e367a5e13e31aa13ab34b5fee16b279d074b10266cd8`；8/1/7/0、Event 8/8/1、PRQ ACCEPTED、RFQ/Quote/Award/PO 0/0/0/0 保持 |
| Git/后续 | TWO FOCUSED COMMITS / NEW AUTH REQUIRED | 功能 `a86d9adceefb45efca1c43f1f8475703e8fa943d`；文档/部署以 `ops: deploy supplier mapping approval safeguards` 收口。未 push/PR/改历史；剩余七条只有在新的明确授权任务中才可继续决定，本任务不授权 RFQ |

## SELFHOST-OPS-OPERATIONS-BROWSER-VERIFICATION-14 operations Identity 合同修复与只读浏览器复验

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | OPERATIONS IDENTITY RECOVERED — BROWSER VERIFICATION STILL INCOMPLETE | 登录响应合同、operations 工作台身份/角色与非强制改密已由唯一实际 Chromium 通过；logout 已安全撤销且最终 Session 0，但 back/forward/refresh 与最终 protected DOM 未执行 |
| 严格起点 | PASS | clean `main@7864905`、Parent `7b95b13`、behind 0/ahead 137；alpha.39、0001—0038、Canonical v2/v2.1 10/0/PASS、operations role/active/must-change/version、Session 0、业务零事实与 PRQ ACCEPTED 全部吻合 |
| 登录权威合同 | PASS / SERVER UNCHANGED | HTTP 200、`application/json`、`ok=true`、结构化 `user`、精确 username/role；返回 active/must-change 时必须 true/false，无错误代码。`authenticated` 只属于 `/api/session`，不能替代 `ok/user` |
| verifier 新断言 | PASS / OFFLINE TOOL | 必须同时通过网络合同与已认证“经营工作台” DOM；当前用户标签精确绑定响应 display_name/username、角色 operations/运营；登录页与强制改密页为 0。拒绝仅 authenticated、错身份、错误 Content-Type/状态/JSON 和页面未认证伪成功 |
| 合成测试 | PASS 8/8 | 覆盖两个合法响应及用户要求的全部拒绝集，并覆盖 inactive、错误码、logout transport 和正式 runner 接线；不含真实密码或 Canonical 内容 |
| 相关回归 | PASS | targeted recovery 5/5、legacy recovery 9/9、Identity unit 9/9、Identity UI 10/10、npm 3/3、全仓 lint 0 error/10 既有 warning、1,205 文件 credentials、Node 静态检查、Python self-test/smoke/go-live 三项与 diff check |
| 浏览器登录/页面 | PASS / ONE ACTUAL CHROMIUM | 模块 preflight 失败未启动浏览器；恢复临时模块后唯一实际流程通过 login HTTP/JSON/ok/user、精确 operations username/role、active=true/must-change=false、两次工作台、当前用户 display-name 标签和角色；精确账号字符串由 login/session 证明，现有 Web 按 `display_name || username` 显示。未进入 Mapping 或其他业务模块 |
| logout | SERVER PASS / VERIFIER RACE | 页面点击“退出”，最新验证 Session 为 `LOGOUT` 且最终有效 Session 0。runner 在 `location.replace` 后重读已释放 body 报 `TARGETED_BROWSER_LOGOUT_JSON_INVALID`；随后补丁改用 transport+匿名页/Session 作为持久证明，但未重跑 |
| back/forward/refresh | NOT VERIFIED | 唯一实际流程在匿名页断言前停止，故 back、forward、refresh 与最终受保护 DOM=0 均不能报告通过；没有第二次 Chromium |
| Canonical/身份 | PASS / UNCHANGED | 正式 Canonical 字节与 root:root 0600/nlink1 元数据不变，post diagnosis 仍 v2/v2.1、10 账号、0 错误/PASS；operations password/role/active/must-change=false/version 7 不变，其他身份不变 |
| 业务保护 | PASS / UNCHANGED | 指纹前后 `c55aff391533a1c508fdfdaa42fa3ebc4d0868a25b7585ccdeefaf14b3554b36`（217 表/203 序列）；Mapping/RFQ/Quote/Award `0/0/0/0`，PRQ ACCEPTED，Supplier 1/2 ACTIVE，Material 533—536 ACTIVE/PCS/legacy unit 保持；业务 POST 0 |
| 部署/服务 | PASS / NO DEPLOY | 未 build/redeploy/restart Web、Worker、PostgreSQL 或 Caddy，未运行 Migration/备份，未改 Origin/端口/Volume。四服务原镜像与状态保持，RestartCount 0、OOM false，任务期内核 OOM/restart event 0 |
| 资源/清理 | PASS | 起点/终点 available memory 约 2.2/2.2 GiB，Swap 256/256 MiB，根盘可用 20/20 GiB，Load `0.19/0.15/0.11`→`0.01/0.10/0.12`。临时模块、Profile、evidence、runner、测试目录、容器、网络和浏览器进程均 0；Recovery-13 正式备份及四个受保护 Volume 保留 |
| Git/后续 | THREE FOCUSED COMMITS / MAPPING NOT RELEASED | `1dcfc5a7d93d5f4092d088cecd3cc7c6c744b8b9` 修 login contract，`82f29c9157ceea1602969f4301477a7b2d18aa61` 修 logout body 生命周期竞态，文档提交消息 `ops: verify operations UAT identity`。未 push/PR/改历史；需新授权补做 history，且另获 Mapping 授权后才可开始八条 Mapping |

## SELFHOST-OPS-TARGETED-OPERATIONS-IDENTITY-RECOVERY-13 operations 定向离线身份最终化

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | OPERATIONS IDENTITY RECOVERED — BROWSER VERIFICATION INCOMPLETE | 数据库与 Canonical 身份最终化、Session 收口、备份恢复、业务保护和服务恢复通过；浏览器真实 LOGIN/LOGOUT success，但完整页面/历史断言未完成 |
| 严格起点 | PASS | clean `main@b7221a94375487a9656fff84f46dbabb95a5a26a`、behind 0/ahead 135；alpha.39、0001—0038、0038 SHA、Web `c1576bd2…`、Canonical v2/v2.1、目标 v6/must-change=true、Mapping/下游零事实全部吻合 |
| 定向能力 | PASS / FAIL CLOSED | 固定 operations、role/active/version、UUID run-id、确认短语、root、非生产数据库、0038、Web/Worker 停写和镜像；拒绝通配/列表/其他账号/重复 run-id。密码只经 CSPRNG+匿名管道进入 CLI/候选 |
| 自动验证 | PASS | targeted unit 5/5、legacy unit 9/9、隔离 PostgreSQL 4/4、适用 typecheck/lint、npm 3/3、credentials 1,202 文件与 diff check；覆盖单目标、其他账号秘密/非秘密保持、Session/审计、故障零半记录与候选补偿 |
| 备份/恢复 | PASS | root:root 0600 dump 2,212,808 bytes，SHA-256 `9b18cb329dfe8775b03f5288a900b31f0ebb7d5d6599c91d1a40a6a8605269cd`；`pg_restore --list` 3,321 项，第二空库 38/head 0038、225 表、身份计数和 FIX-20 保护事实一致，恢复库已删，正式备份保留 |
| 正式事务 | PASS | run-id `e0fec2fb-3894-4a19-93af-79eb85d9dfd4`；只把 operations must-change `true→false`、version `6→7`，username/role/active 保持；恢复审计 1，事务撤销既有 Session 0 |
| 其他身份 | PASS / UNCHANGED | 其他十个受控账号的非敏感与秘密指纹、全部其他账号及其他 Session 指纹在事务内相同；Canonical 其他九个 UAT 账号全部字段和密码保持，正式后十个其他受控账号仍精确 active |
| Canonical | SCHEMA_PASS / CONSISTENT | 候选 10 账号、0 错误、差异恰好 2；正式 v2、validator v2.1、writer v2，10 账号/0 错误/PASS、operations false、root:root 0600、单硬链接、候选消失；受控内存比对与真实登录证明密码和数据库 hash 一致 |
| Session/审计 | PASS | 正式事务撤销 0；attempt-2 创建的验证 Session 由 logout 撤销 1；两次失败 cleanup 各撤销 0。最终 operations 未撤销/有效 Session `0/0`；`OFFLINE_IDENTITY_RECOVERY` 恰好 1，cleanup 与 LOGIN/LOGOUT 为独立审计动作 |
| 浏览器 | INCOMPLETE / SAFE LOGOUT | attempt-1 在登录前因缺临时模块 fail closed；attempt-2 通过匿名页并产生 LOGIN success，但 verifier 错误要求 `/api/login` 返回 `authenticated` 而提前失败，随后 `/api/session` 识别认证并 LOGOUT success。未完成浏览器 must-change/角色页面和 back/forward/refresh，不再重跑 |
| 业务保护 | PASS / UNCHANGED | 排除身份/系统表的全业务指纹前后为 `c55aff391533a1c508fdfdaa42fa3ebc4d0868a25b7585ccdeefaf14b3554b36`（217 表/203 序列）；Mapping/RFQ/Quote/Award `0/0/0/0`，PRQ ACCEPTED、Supplier 1/2、Material 533—536 与 PO/收货/库存/财务/生产下游均保持 |
| 服务 | PASS | Web/PostgreSQL healthy，Worker/Caddy running；Web/Worker 原镜像保持，四服务 RestartCount 0、OOM false，HTTP health 200；无版本、Migration、Compose、Volume 或部署变化 |
| 资源/清理 | PASS | 起点 available memory 约 2.2 GiB、Swap 257 MiB、根盘 20 GiB、Load `0.03/0.16/0.22`；终点 2.2 GiB、256 MiB、20 GiB、Load `0.45/0.61/0.36`，任务期内核 OOM 0、Docker OOM/restart event 0。临时库/恢复库/runner/网络/Profile/模块/候选/证据已清零，正式备份与四个受保护 Volume 保留，未 prune |
| Git/后续 | TWO FOCUSED COMMITS / MAPPING NOT RELEASED | 功能 `7b95b13cd1e6c64d0f7fd4536e3456ca2a9d25db`；收口消息 `ops: activate operations UAT identity safely`。不 push/PR；先另立 verifier 只读复验任务，完成后仍需独立 Mapping 授权，当前不创建八条 Mapping |

## SELFHOST-OPS-CANONICAL-SCHEMA-RECONCILIATION-12 Canonical UAT 凭据 Schema 对齐

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | CANONICAL VALIDATOR FIXED — FILE UNCHANGED | 根因 A 已修复；正式 Canonical 未改，未执行任何身份或业务变化 |
| 严格起点 | PASS | clean `main@2f2a62b81622afd708538da5f9cfd9afc835dda6`、Parent `1e9221d90db621becc2badf40b3e0ed3017b73e6`、behind 0/ahead 134；alpha.39、0001—0038、0038 SHA、Web `c1576bd2…`、服务/四卷全部吻合 |
| 脱敏诊断 | ROOT CAUSE A | 10 账号、3 错误；仅 `/accounts/2|3|4/must_change_password` 命中旧 `const`，预期/实际类型均为 boolean，对应 engineering/planning/purchase；没有其他 Schema 或密码策略错误 |
| 精确根因 | FIXED / VALIDATOR STALE | 恢复 writer 的初始全 true 被误当成 v2 Canonical 永久状态；后续受控 UAT 已证明这三个账号当前 false 状态有效，而 operations 仍为 true |
| 版本 | PASS | Schema `chenyida-erp-uat-credentials-v2`；validator/parser `offline-identity-recovery-uat-validator-v2.1`；writer `offline-identity-recovery-credential-writer-v2` |
| 修复边界 | PASS / STRICT | 长期 Schema 要求严格 boolean；固定 10 账号、顺序、用户名、角色、密码策略、唯一性、字段与 run-id 不变；恢复 writer/Stage/提升/最终化继续单独强制初始 true |
| 安全诊断 | PASS | `--diagnose-schema` 固定正式/演练路径、root、deployment class、run-id、0600/nlink1、`O_NOFOLLOW` 和 64 KiB 上限，在创建 PostgreSQL Pool 前返回；秘密字段固定 `<redacted>`，异常只输出稳定代码 |
| 正式复验 | SCHEMA_PASS | 账号 10、错误 0；正式文件仍为 root:root 0600、单硬链接、size 1,944/inode 193179676/mtime 不变；候选不存在，全部账号语义保持 |
| 自动验证 | PASS WITH EXPLICIT PG EXCLUSION | 离线恢复 unit 9/9、npm 3/3、Python compile/self-test/smoke/go-live 4 项、lint 0 error/10 既有 warning、credentials 1,194 文件和 diff check 通过；按绝对禁令不运行 PostgreSQL 集成测试 |
| 运行/业务保护 | PASS / ZERO WRITE | 无 Chromium、登录、正式 API、PostgreSQL、Migration、服务/镜像/Compose/Volume 或身份/业务写；Mapping 0、RFQ/Quote/Award 0/0/0、PRQ ACCEPTED 与账号/Session 状态保持 |
| 资源/清理 | PASS | available memory 约 2.2→2.2 GiB，Swap 258→258 MiB，根盘 20→20 GiB，Load `0.01/0.23/0.28`→`0.45/0.46/0.47`；内核 OOM 0、四服务 RestartCount 0/OOM false。测试串行、一次一个容器；Python 任务目录、容器 tmpfs、任务容器和 Canonical 副本/候选均为 0，未 prune，四卷保留 |
| Git/后续 | ONE FOCUSED COMMIT / IDENTITY RETRY READY | 独立消息 `fix: diagnose canonical credential schema safely`；operations 首次改密的 Schema 阻断已解除，但只能在新的明确授权 Identity 任务执行；本任务停止且不开始 Mapping |

## SELFHOST-UAT-FIX-20 受控 Supplier Mapping 维护、审核与 RFQ 覆盖门禁

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | SUPPLIER MAPPING GOVERNANCE DEPLOYED — MAIN UAT NOT VERIFIED | alpha.39/0038、purchase 维护、operations 只读异人审核、不可变版本/Event 和 RFQ 当前有效 1:1 Mapping 门禁已部署；主 UAT 未创建 Mapping 或任何下游单据 |
| 严格起点 | PASS | clean `main@2cdbc43d1293b6f13bf5bba1e140ec6808b05dd5`、Parent `23d654c383015864be9a2ade71e78d94eb77adaf`、behind 0/ahead 131；alpha.38、0001—0037、0037 SHA、Web `6622029f…`、服务/四卷和主 UAT 保护事实全部吻合 |
| 模型诊断 | BRANCH B / SINGLE AUTHORITY | 既有 `supplier_mappings` 已是关系化权威，但不能表达草稿、审核与不可变决策；保留该表为唯一正文/版本权威，仅新增 0038，不建第二套模型 |
| Migration/版本 | PASS / DEPLOYED | `0.1.0-alpha.39`，38/head `0038_supplier_mapping_governance.sql`，SHA-256 `2da259364151af098641795da55604dc3012b6adf92aec67038c0554e0592941`；0001—0037 未修改 |
| 权限/职责分离 | PASS | purchase=`read/create/edit_draft/submit`；operations=`read/review_queue/approve/reject`；engineering 只读；operations 无正文编辑，purchase 无审核，自审禁止，admin/manager 仍受自审门禁 |
| 生命周期 | PASS | DRAFT→PENDING_REVIEW→ACTIVE/REJECTED；提交后冻结、退回原因必填、ACTIVE 不原改，替代版本同事务固化；Supplier part 与 ACTIVE 1:1 有效期唯一性由数据库保护 |
| RFQ 合同 | PASS | page/create/issue 共用权威 coverage 查询；0/4、3/4 禁选并返回精确缺失组合和 `SUPPLIER_MAPPING_INCOMPLETE`，4/4 才可创建 DRAFT；不自动创建 Quote/Award/PO |
| legacy Unit 兼容 | PASS | Material 主单位优先 `base_unit_id`；为空时仅允许 `base_uom` 精确匹配唯一 enabled Unit.code。主 UAT 533—536 的 PCS 被稳定解析；无匹配继续 fail closed，无数据回填或 0039 |
| 自动验证 | PASS | Unit/UI 最终 12/12；Supplier Mapping PG 8/8；Migration 5/5；跨域 PG 42/42 + sourcing 5/5 + master 6/6；静态/UI 87/87，npm 3/3，Python 3/3；typecheck、build、lint 0 error/10 既有 warning、credentials 和 diff check 通过 |
| 隔离 Chromium | PASS | purchase 创建/提交 8 条、operations 逐条异人批准、两家 4/4、RFQ DRAFT 1；Quote/Award/PO 0，Session 0，桌面与 390×844 通过 |
| 备份/恢复 | PASS | root:root 0600 custom dump 2,189,463 bytes，SHA-256 `2d1fe44fd42c7a7281fd50d0d7d20144228ee4b26f62c2fe6c93e2df24dcb96c`；list 3,285 项，第二空库 37/head 0037 恢复后升级 38/head 0038、重复 runner 与保护事实通过，恢复库已删 |
| 部署 | PASS | 停 Web/Worker 阻断写入并确认连接 0 后串行应用 0038、替换 Web、原样启动 Worker；兼容修复后仅 Web-only 替换。最终 Web `sha256:c1576bd22a209fb6f524e304bcf12cc38af4d67a35c76f37fa8dc1311c2922c8`；PostgreSQL/Caddy/四卷未更换 |
| 主 UAT purchase | PASS / READ ONLY | 新建/保存/提交入口和有界 Material 搜索存在；Supplier 1/2 均 0/4、分别精确缺 533—536且不可选；桌面/390×844、退出和 Session 失效通过，业务 POST 0 |
| 主 UAT operations | NOT VERIFIED / SAFE STOP | Canonical 与数据库账号均既有 `must_change_password=true`；runner 在登录前停止。未修改 Canonical/密码/身份，也未以 admin/manager 绕过；当前队列页面因此未在主 UAT 登录验证 |
| 主 UAT 数据 | PASS / UNCHANGED | 部署前恢复副本与部署后主库业务指纹均为 `8ad0c2e19863808ed9fed62b0da8f5ef4e78bbaf586fe1be146a286bcf3f0ce0`；Mapping/RFQ/Quote/Award/PO 和全部下游为 0，两条历史失败请求原样保留，最终 Session 0 |
| 资源/清理 | PASS | available memory 约 2.2→2.2 GiB，Swap 265→263 MiB（峰值约 301），根盘约 20 GiB，Load `0.20/0.11/0.09`→`0.37/0.38/0.38`；内核 OOM 0、四服务 RestartCount 0/OOM false；临时库/容器/目录 0，未 prune，四卷保留 |
| Git/后续 | TWO FEATURE COMMITS + OPS CLOSEOUT | `ddab02a57e0e87255c7a35d125959ac750b108e1`、`1e9221d90db621becc2badf40b3e0ed3017b73e6`，收口消息 `ops: deploy supplier mapping governance`；operations 身份阻断解除并获得新授权前，不开始主 UAT 八条 Mapping |

## SELFHOST-UAT-FIX-19 RFQ 草稿稳定 Purchase Request ID 绑定

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | RFQ PURCHASE REQUEST ID BINDING FIXED — UAT RFQ NOT CREATED | 稳定 ID/DTO/幂等修复、隔离 RFQ 旅程、回归、备份恢复、Web-only 部署和主 UAT 未提交表单验收完成 |
| 严格起点 | PASS | clean `main@5a7cb547a07b1e113d89c51366fc099d851fe1cb`、Parent `9d6ed0d0bc728bdaafc619fe609d92d87ebcb188`、behind 0/ahead 129；alpha.38、0001—0037、0037 SHA、FIX-18 Web、四服务/四卷和主 UAT 保护事实全部吻合 |
| 精确根因 | FIXED | PostgreSQL bigint ID 为字符串 `"1"`，旧 UI 用 `row.id === Number("1")` 比较而丢失 request；序列化省略 `purchase_request_id/expected_version`。不是字段名、闭包、重置或按标签反查 |
| 功能提交 | PASS | `23d654c383015864be9a2ade71e78d94eb77adaf`（`fix: bind rfq draft to stable purchase request id`）；无 0038、Schema、版本或状态机变化 |
| DTO/幂等 | PASS | option 仅保存稳定 PR/Supplier ID；UI 一次正整数规范，Supplier 验证/去重/排序；Handler/Service 统一规范四字段 DTO 并以规范正文摘要。空/0/负数/小数/NaN/非十进制/布尔/数组/对象继续拒绝 |
| 服务端门禁 | PASS / UNCHANGED | PRQ 存在、ACCEPTED/latest、purchase 权限/对象范围、Supplier ACTIVE/Mapping、四行来源、活动 Round 唯一、CAS、CSRF、Origin、事务/审计/幂等均保持 |
| 隔离 RFQ | PASS | 合成 PR ID 1、四条 Material、Supplier 1/2 创建一个 DRAFT；四行/双 Supplier 精确绑定，规范重放同 RFQ、异正文冲突、并发单胜、故障零半记录，Quote/Award/全部下游 0 |
| 自动验证 | PASS | RFQ unit/UI 6/6+4/4、RFQ PG 5/5、Chromium 1/1、适用静态/UI 68/68+guard 6/6、Schema 4/4、sourcing upgrade 3/3、相关 PG 33/33、`npm test` 3/3、Python 3/3；typecheck/build/credentials/diff/lint 通过 |
| 备份/恢复 | PASS | root:root 0600 custom dump 2,188,178 bytes，SHA-256 `55e169b4ad372391117aea6c042aa1ec3d87a9e85e01dbbba1456b9f9ecc3a28`；list 3,285 项，第二空库 37/head 0037/checksum/身份计数/保护指纹一致，恢复库已删 |
| Web-only 部署 | PASS | Web `6eeba640…→6622029f…`，旧 Web 精确 rollback tag 保留；`--no-deps --no-build` 只替换 Web，PostgreSQL/Worker/Caddy、Migration、Origin、端口和四卷不变，内外 health 通过 |
| 主 UAT 浏览器 | PASS / UNSAVED ONLY | 仅 purchase 登录；PRQ value 1、Supplier value 集合 1/2、四行/40 PCS、合法表单、桌面/390px 通过，随后清空并退出。建立草稿未点击，业务 POST 0、Session revoked |
| 主 UAT 数据 | PASS / UNCHANGED | 正式保护指纹在主库、恢复库、部署/UAT 前后和 runner 安全停止后均为 `fc48f001fe3b0afaff69ac245a1fefc8bf6731d38358004314cc12daa308cff4`；RFQ/Quote/Award 前后 `0/0/0`，PRQ、Supplier、失败证据和全部下游不变 |
| 资源/清理 | PASS WITH RECOVERED TEST OOM | 起点约 2.2 GiB available/258 MiB Swap/21 GiB，终点约 2.2 GiB/266 MiB/20 GiB/Load `0.19/0.22/0.45`；内核 OOM 0、四服务 RestartCount 0/OOM false。Lint 曾因任务临时生成树产生两次 Node V8 heap exhaustion，精确清理后完整通过；任务临时库/容器/Playwright/Python/SQLite 路径 0 |
| Git | TWO FOCUSED COMMITS | 功能提交如上；收口提交为 `ops: accept rfq draft binding fix`，实际 SHA 以 `git log` 为准；不 push/PR/amend/rebase/reset/stash/restore |
| 后续 | SOURCING BLACK-BOX MAY RESUME WITH NEW AUTH | 可以在新的明确授权任务中从单个 RFQ 草稿重新开始采购寻源黑盒试用；Quote、Award、转 PO 和其他下游仍需独立授权，本任务停止 |

## SELFHOST-UAT-FIX-18 采购接收历史凭证与 Plan 状态投影

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | PURCHASE ACCEPTANCE HISTORY FIXED — UAT ACCEPTANCE VERIFIED | 历史/即时 Purchase 决策凭证、SUCCESS 语义、Plan 分支 A 标注、自动/隔离验收、备份恢复、Web-only 部署和主 UAT 只读验收全部完成 |
| 严格起点 | PASS | clean `main@eff3df28e1781f13dc5a529f13e83e621bda5a28`、Parent `13da8a14d037d279278ef8c8ea86e52d79552512`、behind 0/ahead 127；alpha.38、0001—0037、0037 SHA、FIX-17 Web、四服务/四卷和已接收主 UAT 基线全部吻合 |
| 功能提交 | PASS | `9d6ed0d0bc728bdaafc619fe609d92d87ebcb188`（`fix: expose purchase acceptance history`）；无 0038、Schema、版本、状态机或历史数据变化 |
| Purchase 权威 | PASS / IMMUTABLE EVENT | 当前 Plan+PRQ 的唯一 `PURCHASE_ACCEPTED/RETURNED` Event 提供 action/type/actor/time/request_id 与独立计数；PRQ 表提供稳定 ID/状态。禁止由 Session、页面/队列状态或 Audit 补值，事实缺失/矛盾统一 409 失败关闭 |
| SUCCESS 语义 | PASS / COMMITTED PROJECTION | Event、PRQ/Plan 转换、成功 Audit、Idempotency 同事务提交；只在提交后可读，故完整不可变 Event 投影为 SUCCESS。没有 result 列、失败 Event 或占位 actor/request_id |
| Plan 投影 | BRANCH A / PASS | 数据库 Plan 和 PRQ 确实分别转为 ACCEPTED；页面分别显示“采购交接状态”和“PRQ 状态”，明确 Plan v1 计算快照/行/分配/来源摘要仍不可变 |
| 历史/即时 UI | PASS | 独立“采购决策凭证”显示 PR ID/PRQ/决策/Event/Actor/上海时间/SUCCESS/1/0/可复制请求号；与 Package ACCEPT、Plan GENERATE、PRQ SUBMIT 分区；终态无接收/退回/编辑控件 |
| 自动验证 | PASS | FIX-18 unit/UI 10/10、PG 8/8、隔离 Chromium 1/1、适用静态/UI 63/63、跨域 PG 34/34、Schema/Migration 7/7、npm 3/3、Python 3/3；typecheck/build、lint 0 error/10 warning、1,159 文件凭据扫描和 diff check 通过 |
| 并发/权限/零写 | PASS | 0/0→1/0、同键重放不重复、异键并发单胜、诱饵隔离、未授权/跨项目 403、历史 GET 零业务写、故障零半记录；接收后全部采购/库存/生产/财务下游仍为 0 |
| 备份/恢复 | PASS | root:root 0600 custom dump 2,186,157 bytes，SHA-256 `3041980fa1d79e489360bdeacacfe15ee4686673334ee7b8158cea3ca6b7247a`；list 3,285 项、第二空库 37/head 0037/checksum/身份计数/保护指纹一致，恢复库已删 |
| Web-only 部署 | PASS | Web `97dcabe8…→6eeba640…`，旧 Web 精确 rollback tag 保留；`--no-deps --no-build` 仅替换 Web，PostgreSQL/Worker/Caddy、Migration、Origin、端口和四卷不变，内外 health 通过 |
| 主 UAT 浏览器 | PASS / READ ONLY | 仅 purchase 登录和目标 PRQ GET；完整凭证、SUCCESS、1/0、Plan/PRQ 状态、三段上游、四行/九供应、复制、刷新、桌面/390px、logout 后历史保护通过。业务 POST 0、其他对象 GET 0、Session revoked |
| 主 UAT 数据 | PASS / UNCHANGED | 正式保护指纹在部署前、恢复库、UAT 前/旁路停止后/最终后均为 `814811509c476e270f9cd82badb85aa8bb1bf8e1f01e8bb72b4cd9fec9c9a4ff`；PRQ/Plan ACCEPTED、决策 1/0、四行/九供应、Inventory/Allocation 和全部下游不变 |
| 资源/清理 | PASS | 起点约 2.2 GiB available/309 MiB Swap/21 GiB，终点约 2.1 GiB/257 MiB/21 GiB/Load `0.16/0.33/0.34`；内核 OOM 0、四服务 RestartCount 0/OOM false。任务临时库/容器/网络/Playwright/Python/SQLite/build 路径 0，未 prune，四卷与正式备份/镜像保留 |
| Git | TWO FOCUSED COMMITS | 功能提交如上；收口提交为 `ops: accept purchase history traceability`，实际 SHA 以 `git log` 为准；不 push/PR/amend/rebase/reset/stash/restore |
| 后续 | SOURCING PREREQUISITES READY / NEW AUTH REQUIRED | 已接收 PRQ 与完整凭证满足寻源/询价前置条件；实际 RFQ、询价、报价比较或任何下游写必须另立明确授权任务，本任务未创建下游 |

## SELFHOST-UAT-FIX-17 采购接收确认完整追溯、计数与九项供应

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | PURCHASE DECISION CONFIRMATION FIXED — MAIN UAT NOT VERIFIED | 功能、自动/隔离验收、备份恢复与 Web-only 部署完成；主 UAT 唯一一次打开确认窗后 runner 因“状态”定位二义安全中止，遵守一次打开限制未重跑 |
| 严格起点 | PASS | clean `main@af7496babe8b704d04b22ad33bbb98a270519529`、Parent `ce3f14a0c989875e7527e42136967f9efe6ee548`、behind 0/ahead 125；alpha.38、0001—0037、0037 SHA、FIX-16 Web、服务/四卷和主 UAT 基线吻合 |
| 功能提交 | PASS | `13da8a14d037d279278ef8c8ea86e52d79552512`（`fix: complete purchase acceptance confirmation`）；无 0038、Schema、版本或业务状态机变化 |
| 权威读取 | PASS / READ ONLY | Package ACCEPT、Plan GENERATED/REGENERATED、PRQ SUBMIT 和 Purchase ACCEPT/RETURN 计数均来自精确对象范围不可变 Event；九项供应复用 MAIN Inventory、有效 Planning Allocation 和有效 PO/Delivery Plan 投影，不从状态/队列/Audit 推断 |
| 失败关闭 | PASS | 三段事件、摘要/行、显式计数、观察时间或任一 Material 九项供应缺失时，服务端返回稳定 `409 PURCHASE_REQUEST_CONFIRMATION_INCOMPLETE`；客户端保持确认禁用。GET 在授权后的 repeatable-read/read-only 事务内且零业务/Audit/Idempotency/Inventory 写 |
| 确认窗口 | PASS / ISOLATED | 打开先显示“正在重新读取当前供应”，默认取消焦点；完整后显示查询时间、PRQ/Project、Package/Plan/PRQ 三段凭证、0/0 计数、四个 Material 七项固定量与九项当前供应、公式/边界/后果。桌面与 390px 无页面溢出 |
| 自动验证 | PASS | FIX-17 unit/UI 10/10、适用静态/UI 62/62、FIX-17 PG 8/8、跨域 PG 34/34、隔离 Chromium 1/1、Schema 4/4、npm 3/3、CSRF/Origin 11/11、Python 3/3；typecheck/build、lint 0 error/10 warning、1,155 文件凭据扫描和 diff check 通过 |
| 非零/并发边界 | PASS | 12−2−1=9，库存 Allocation 3 后未分配 6；在途 8、Allocation 2 后未分配 6。重新打开读取新值；单 ACCEPT、幂等重放、异正文/CAS/并发、故障回滚及零下游均在隔离库通过 |
| 备份/恢复 | PASS | root:root 0600 custom dump 2,185,361 bytes，SHA-256 `896b92493480fe3aa08d3b84600e1804df60794108c776ef29aabee2fce0e8e8`；`pg_restore --list` 3,285 项，第二空库 37/head 0037/checksum/身份非敏感计数/保护指纹一致，恢复库已删 |
| Web-only 部署 | PASS | Web `d7ced686…→97dcabe8…`，旧 Web 精确 rollback tag 保留；PostgreSQL/Worker/Caddy 容器未重建，Migration/Origin/端口/四卷保持，restart 0/OOM false |
| 主 UAT 浏览器 | NOT VERIFIED / SAFE STOP | 仅 purchase login；已核对队列 1/0、详情 ACCEPT/RETURN 0/0、加载窗、安全焦点并打开一次完整确认窗。runner 在读取两个“状态”字段时中止；未确认/退回/重跑或创建下游，最新任务 Session 为 `LOGOUT` |
| 主 UAT 数据 | PASS / UNCHANGED | 正式保护指纹在部署前、恢复库、UAT 前后均为 `e80ed1795079a3467ba4f05e2751fd8a9575e1b441b2433b371651479ca2cab0`；PRQ/Plan SUBMITTED、Package 2/v2 ACCEPTED、决策 0/0、四行/九项供应、Inventory/Allocation 与全部下游不变 |
| 资源/清理 | PASS | 起点约 2.1 GiB available/302 MiB Swap/21 GiB，终点约 2.2 GiB/304 MiB/21 GiB/Load `0.24/0.32/0.27`；内核 OOM 0、四服务 restart 0/OOM false。临时库/容器/网络/Playwright/Python 路径 0，未 prune，四卷/正式备份/镜像保留 |
| Git | TWO FOCUSED COMMITS | 功能提交如上；收口提交为 `ops: accept purchase confirmation fix`，实际 SHA 以 `git log` 为准；不 push/PR/amend/rebase/reset/stash/restore |
| 后续 | NEW EXPLICIT UAT AUTHORIZATION REQUIRED | 本任务立即停止。若需补做主 UAT 完整逐项核对，必须另行授权；不得在本任务接收/退回主 PRQ 或开始 RFQ |

## SELFHOST-OPS-UAT-PURCHASE-SUPPLY-BREAKDOWN-FIX-16 采购审核当前供应分解修复

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | PURCHASE SUPPLY BREAKDOWN FIXED — UAT PRQ STILL PENDING | 权威当前供应投影、快照/当前/差异分区、确认刷新、范围授权、隔离验收、备份恢复、Web-only 部署和 purchase-only 主 UAT 取消均完成；未接收/退回主 PRQ |
| 严格起点 | PASS | clean `main@231813f4cbb7db364a26fba5d358d76e06c69604`、Parent `22ea9a282ef4d7a7e58e84b9db73061a0ef6e109`、behind 0/ahead 123；alpha.38、0001—0037、0037 SHA、FIX-15 Web 镜像、Canonical、服务/四卷和主 UAT 基线全部吻合 |
| 功能提交 | PASS | `ce3f14a0c989875e7527e42136967f9efe6ee548`（`fix: expose purchase current supply breakdown`）；无 0038、Schema、版本或业务状态机变化 |
| 库存口径 | PASS / AUTHORITATIVE | 授权 PRQ 行范围内聚合 MAIN 的全部无 Lot/Lot 位置；库存可用为 Σ在手−ΣInventory 正式预留−Σ冻结，计划库存 Allocation 仅计 SUBMITTED/ACCEPTED Plan 且单独显示，未分配库存再取 max；模型无其他不可用独立数量 |
| 在途口径 | PASS / AUTHORITATIVE | 仅计 OPEN/PARTIALLY_RECEIVED PO/Line 和截止日前有效剩余；Delivery Plan 只取 PENDING/PARTIAL 的 planned−received，无 Plan 才取 PO order−received。完成/取消/关闭、已收货部分和无效来源 Allocation 排除；模型无已到货未入库独立数量 |
| 快照/差异 | PASS / IMMUTABLE | 四条分别显示提交时毛需求、库存/在途可用与分配、净采购、PRQ 和截止时间；当前查询另区，差异只提示正式退回/调整，不重算或改写 PRQ/快照 |
| 接收确认 | PASS / FRESH READ | 打开前重新 GET；四条只读摘要含 PRQ、当前在手/预留/有效在途、未分配库存/在途、差异和查询时间，并明确接收不改库存或自动创建 RFQ/PO；既有 CAS/幂等/状态/事务门禁未改 |
| 权限/零写 | PASS / SCOPED | purchase 先通过 PRQ 对象范围授权，再查询精确行集；诱饵 PRQ 403，不可枚举其他库存/Lot/项目或供应商敏感价格。GET 正常/失败、确认刷新对 Inventory、Allocation、Audit 和下游均零业务写；未增加 Inventory/Ledger 写或 `system.audit.read` |
| 自动验证 | PASS | unit/UI 10/10、静态/跨域回归 78/78、当前供应 PG 6/6、跨域 PG 32/32、隔离 Chromium 1/1、`npm test` 3/3、Python 3/3；typecheck/build、lint 0 error/10 warning、credentials/diff 通过 |
| 边界覆盖 | PASS | 覆盖 on_hand/reserved 0 与正数、冻结、reserved/Allocation 分离、多 Lot 聚合守恒、有效/部分收货/完成/取消在途、在途 Allocation 守恒、快照差异不改 PRQ、诱饵 403、查询零写及接收确认刷新 |
| 390px | PASS | 390×844 每个 Material 独立卡片，快照/当前分区清楚，公式可折叠；在手、预留、库存可用、在途和 PRQ 数量不拆字，无页面级横向溢出 |
| 备份/恢复 | PASS | root:root 0600 custom dump 2,185,039 bytes，SHA-256 `43f4e4620e51c5b2ee5876e13556907e38817399dd0eac0fedd2320bc95c75c6`；`pg_restore --list` 3,285 项，第二新空库 37/head 0037/checksum 与业务/供应指纹一致，恢复库已删 |
| Web-only 部署 | PASS | Web `d5c514ab…→d7ced686…`，旧 Web 精确 rollback tag 保留；PostgreSQL/Worker/Caddy 容器未重建，四卷保持，restart 0/OOM false |
| 主 UAT 浏览器 | PASS / CANCEL ONLY | 仅 purchase login；分别核对 Material 533—536 的九项当前供应均为 0 PCS，确认窗口 fresh GET 1 后取消并 logout；业务 POST 0、ACCEPT/RETURN 0、下游 0 |
| 主 UAT 数据 | PASS / UNCHANGED | 部署前/恢复库/验收后业务指纹 `cc6a9d4f4350b6aa2846a9f681e6f47c451ba8bdf5f49c6a42848885633f6d66`、供应指纹 `c93374feeeb48fe1a978bfb6e844cdf3f32b9fab26477e022956932364d9efb1`；PRQ/Plan SUBMITTED、Package 2/v2 ACCEPTED、四条各 10 PCS、Allocation/全部下游 0 |
| 资源/清理 | PASS | 起点约 2.3 GiB available/295 MiB Swap/22 GiB，终点 2.3 GiB/303 MiB/21 GiB/Load `0.19/0.20/0.29`；内核 OOM 0、四服务 restart 0/OOM false。FIX-16 临时库/容器/Volume/`/tmp` 路径 0，四个受保护 Volume、备份及当前/回退镜像保留，未 prune |
| Git | TWO FOCUSED COMMITS | 功能提交如上；收口提交为 `ops: accept purchase supply review fix`，实际 SHA 以 `git log` 为准；不 push/PR/amend/rebase/reset/stash/restore |
| 后续 | EXPLICIT PURCHASE DECISION AUTHORIZATION REQUIRED | 当前立即停止。下一次明确授权前不得接收/退回主 PRQ；任何当前供应差异不自动重算 PRQ，接收本身不创建 RFQ、PO 或其他下游单据 |

## SELFHOST-OPS-UAT-PURCHASE-REQUEST-TRACEABILITY-FIX-15 采购需求接收追溯与确认修复

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | PURCHASE REQUEST TRACEABILITY FIXED — UAT PRQ STILL PENDING | 关系化追溯、提交快照/当前供应分栏、确认 UX、隔离写验收、备份恢复、Web-only 部署和 purchase-only 主 UAT 打开后取消均完成；未接收或退回主 PRQ |
| 严格起点 | PASS | clean `main@977fa3d942a5af830ec36981a1a3cb3e9adcc8cc`、behind 0/ahead 121；alpha.38、0001—0037、0037 SHA、指定 Web 镜像、Canonical、服务/四卷和主 UAT 状态全部吻合 |
| 功能提交 | PASS | `22ea9a282ef4d7a7e58e84b9db73061a0ef6e109`（`fix: expose purchase request traceability`）；未新增 Schema/Migration/package 版本，未改既有业务记录/Event |
| 权威 DTO | PASS | 单一 repeatable-read/read-only 快照投影 Package 2/v2 ACCEPT Event、Plan ID 1/v1 GENERATED、PRQ ID 1 SUBMIT 与四行稳定 Material/Unit；当前供应独立计算，不替换提交快照 |
| 诚实展示 | PASS | 完整 Package 摘要、Product A0/BOM V1/Unit Resolution v1、actor/上海时间/请求号/SUCCESS 可见；Plan/PRQ 无说明准确显示未采集，PRQ 准确标注未单独业务版本化，供应商/价格/接收人/时限均为空状态 |
| 数量/矛盾文案 | PASS | 533—536 均为 10、库存 0/0、在途 0/0、净采购 10、PRQ 10 PCS；实际公式可见。非零净采购不再误报 0；零 PRQ 未接收不再误报“采购已接收” |
| 确认与 390px | PASS | 接收/退回均为 POST 前确认；默认取消、关闭/ESC/背景取消零业务请求、确认立即保护、双击单请求。四行卡片默认显示稳定 ID/编码/毛需求/净采购/申请量，详细分配可展开，PCS 不拆分且无页面横向溢出 |
| 权限/安全 | PASS / SCOPED | purchase 仅见待接收队列和本人已处理历史；其他 purchase 已处理诱饵 403，Package/PRQ Event 查询精确对象范围。未增加 `system.audit.read` 或扩大写权限；CSRF/Origin/CAS/幂等/状态/事务门禁保持，全局跨角色导航继续为 HIGH |
| 自动验证 | PASS | 分组执行 `47/47` 定向静态/安全、Material PG `5/5`、跨域 PG `32/32`、跨域 UI `31/31`、最终 Material unit/UI `10/10`、隔离 Chromium `1/1`；typecheck/build、lint 0 error/10 warning、credentials/diff 和 Python `3/3` 通过 |
| 隔离 Chromium | PASS 1/1 | 390×844 下接收取消/关闭/ESC、退回取消均零写；双击接收只形成一个 ACCEPT 并可从已处理重开，CAS/幂等和全部下游 0；只发生在专用隔离库，资源已清理 |
| 备份/恢复 | PASS | root:root 0600 custom dump 2,184,317 bytes，SHA-256 `b1fbf44297b52e151b597d9c9f31a3297e6ee25c73d02ba6e4429a07aba853bb`；容器内 `pg_restore --list` 3,285 项，第二新空库 37/0037 checksum、主 UAT 谱系/四行/零下游与主库一致，恢复库已删 |
| Web-only 部署 | PASS | Web `a6327f59…→d5c514ab…`，旧 Web 精确 rollback tag 保留；PostgreSQL/Worker/Caddy 容器 ID/启动时间不变，四卷保持，restart 0/OOM false |
| 主 UAT 浏览器 | PASS / CANCEL ONLY | 仅 purchase login；详情与四行展开通过，打开 `PRQ-00000001` 接收确认并取消，最终 login/logout 1/1、业务 POST 0、ACCEPT/RETURN 0、下游 0。本任务最近三条 Session 均 LOGOUT；四条更早有效 Session 未越权撤销 |
| 主 UAT 数据 | PASS / UNCHANGED | 业务指纹前后 `c3c1cfbecee7dcb2199bacc6425dcc02d875cb546049eacc5982ca4a6eb22fca`；PRQ/Plan 仍 SUBMITTED，Package 2/v2 仍 ACCEPTED，四行仍各 10 PCS，PRQ 1、Purchase ACCEPT/RETURN 与 RFQ/Quote/Award/PO/Receipt/Ledger/AP 全为 0 |
| 资源/清理 | PASS | 起点约 2.2 GiB available/270 MiB Swap/22 GiB/低 Load；终点 2.3 GiB/289 MiB/22 GiB/Load `0.15/0.20/0.31`。内核 OOM 0、四服务 restart 0/OOM false；任务临时库/容器/Volume/venv/SQLite 均清理，备份、候选/回退 Web 和四卷保留，未 prune |
| 后续 | EXPLICIT PURCHASE DECISION AUTHORIZATION REQUIRED | 本任务立即停止。下一次明确授权前不得接收/退回主 PRQ；接收本身仍不得自动创建 RFQ、定标、PO、收货或 AP |

## SELFHOST-OPS-UAT-PLANNING-HANDOFF-CONFIRMATIONS-FIX-14 最终接收与重新提交确认修复

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | HANDOFF DECISION CONFIRMATIONS FIXED — UAT V2 STILL SUBMITTED | 确认 UX、隔离写验收、备份恢复、Web-only 部署与主 UAT planning 打开后取消均完成；未接收主 v2 |
| 严格起点 | PASS | clean `main@9c2a7ea436e9b8b5e95ad8eb82e52a43090b109a`、behind 0/ahead 119；alpha.38、0001—0037、0037 SHA、指定 Web 镜像、服务、四卷和主 UAT 状态均吻合 |
| 功能提交 | PASS | `f19a91b680a58150378626d4800e9fb0af12f484`（`fix: complete planning handoff confirmations`）；仅 UI/CSS/前端保护和测试，无 API/Schema/Migration/package/版本变化 |
| ACCEPT 窗口 | PASS | 目标 v2、前驱 v1 RETURN、Response、完整摘要/正文/请求号/操作者/上海时间、A0/V1/Unit Resolution v1/四项 10 PCS、不可变谱系、五项后果和精确下一阶段全部在窗口内部 |
| RESUBMIT 窗口 | PASS / ISOLATED WRITE ONLY | 项目、源 v1、RETURN/原因、Response、目标 v2、固定 Product/BOM/Unit/四项物料、待接收队列和不自动下游完整；主 UAT 未重放 RESUBMIT |
| 权威下一阶段 | D-059 / D-060 / TASK03 | ACCEPT 只形成交接事实；计划部门随后基于最新 ACCEPTED v2 独立执行物料需求计算与缺料分析，再以独立操作形成采购需求交接。当前无 assignee/SLA，接收不自动执行下一阶段 |
| 交互/可访问性 | PASS | 默认取消焦点、焦点约束、ESC/关闭/背景关闭零请求、确认立即禁用、同步双击单请求、稳定 Package ID、无自动重试；390×844 无页面横向溢出，长正文/摘要/请求号换行且固定操作区不遮挡 |
| 权限/并发 | PASS / UNCHANGED | planning/engineering 对应对象范围门禁；越权 403、过期 CAS 409、幂等与单事件通过。CSRF/Origin/状态/事务门禁未改，未增加 `system.audit.read` 或扩大权限；全局跨角色导航债务继续为 HIGH |
| 自动验证 | PASS 74/74 + PYTHON 3/3 | UI 12、静态/安全 35、Planning PG 12、0037 migration 4、Identity PG 10、Chromium 1；另有 Python self-test/smoke/隔离 go-live、typecheck、production build、lint 0 error/10 既有 warning |
| 隔离 Chromium | PASS 1/1 | v1 退回→回复→v2；RESUBMIT 与 ACCEPT 均先以取消/关闭/ESC 验证零业务请求，再双击确认只形成单一事件；v1 继续 RETURNED、v2 最终仅在隔离库 ACCEPTED、下游记录 0，资源已清理 |
| 备份/恢复 | PASS | root:root 0600 custom dump 2,179,303 bytes，SHA-256 `518bf47f797ff2e4817458b5c7e5e4090b0f8aaf77519c80c5c1598e9690efee`；`pg_restore --list` 3285 项、第二新空库 37/head 0037/checksum/业务对象/指纹恢复通过，恢复库已删 |
| Web-only 部署 | PASS | Web `694a3190…→a6327f59…`，旧 Web 精确 rollback tag 保留；PostgreSQL/Worker/Caddy 未重建，四卷保持，restart 0/OOM false |
| 主 UAT 浏览器 | PASS / CANCEL ONLY | 仅 planning login；390×844 打开 Package 2/v2 ACCEPT 窗并核对字段，点击取消，页面业务 POST 0、ACCEPT 0；未登录 engineering。本次新 Session 已正常 LOGOUT 并确认失效；一条 22:03 创建的既有有效 planning Session 早于本次验收，未冒充本次 Session、未越权撤销 |
| 主 UAT 数据 | PASS / UNCHANGED | 指纹前后 `5ddca35cab36890c20b88ecadc758a32bd60b87e2a136c477d8fde6c7e4538c2`；v1 RETURNED/摘要 `9d7a6a7e…`，v2 SUBMITTED/摘要 `d67acce3…`，Response/RETURN/RESUBMIT/ACCEPT/v3 `1/1/1/0/0`，物料需求计划/采购需求 0 |
| 资源/清理 | PASS | 起点约 2.2 GiB available/252 MiB Swap/22 GiB/低 Load，终点约 2.2 GiB/258 MiB/22 GiB/Load `0.20/0.23/0.28`；内核 OOM 0、四服务 restart 0/OOM false。任务临时数据库/容器/恢复库/提取目录/venv/SQLite 均清理，备份、候选/回滚 Web 和四卷保留，未 prune |
| 后续 | READY FOR SEPARATE PLANNING FINAL ACCEPTANCE | 确认窗口阻断已解除；需下一次明确授权后才可 ACCEPT。当前停止，不创建物料需求或采购交接 |

## SELFHOST-OPS-UAT-PLANNING-REVISION-RESPONSE-13 Planning 工程修订回复与后继谱系

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | PLANNING REVISION RESPONSE DEPLOYED — UAT V1 UNCHANGED | alpha.38/0037 功能、迁移、恢复、Web-only 部署与 engineering-only 主 UAT 只读验收完成 |
| 严格起点 | PASS | clean `main@174181991c0bf51ee397627ea8fce546d1b64e68`、Parent `180f6b58b583bd2dba350f017504be916db9673d`、behind 0/ahead 117；alpha.37/0036、镜像、Canonical、四服务和主 UAT 指纹均吻合 |
| Schema 决定 | 0037 REQUIRED | 0036 没有关系化 Response Version、RETURN 独立 Head 或 Package 后继谱系；唯一新增 0037，0001—0036 未修改 |
| 数据模型 | PASS | append-only Response Version + CAS Head；Package 固定 previous/RETURN/Response 复合 FK；唯一后继、Response 单次消费、快照复制、摘要绑定与 SQL guard |
| 服务/UI | PASS | NFC/LF/10—2000、权限/owner/责任队列、CSRF/Origin、幂等/限流、CAS/并发/事务审计；RETURNED v1 回复/固定复用/确认窗口和 v2 完整谱系，选择器在仅回复模式移除 |
| 自动验证 | PASS 67 EXECUTIONS | 静态/安全 49/49、Planning PostgreSQL 12/12、Migration 4/4、隔离 Chromium 同一 1 项在新库和真实恢复升级库各通过一次；三项 Python 基线、typecheck、production build、lint 0 error、credentials 和 diff check 通过 |
| 备份/恢复 | PASS | root:root 0600 dump 2,140,261 bytes，SHA-256 `653b239b65f31a89b0a29281f8f68c1c0ab26d43df4cd936bb544b0d69bbad69`；list、第二空库 0036 恢复、另一恢复库 0036→0037+完整旅程通过，恢复库已删 |
| Migration/运行面 | PASS / DEPLOYED | 37/head 0037，SHA-256 `139f2623a184ae3d6927c95b56569cc438deffc2a0b46c325c9f04d59471d99f`；Web `fb88dd8a…→694a3190…`，Worker 保持 `32d1ae33…`，PostgreSQL/Worker/Caddy 与四卷未重建 |
| 主 UAT | PASS / UNCHANGED | 跨迁移保护指纹前后均 `a25be9c924bb2e7af54acd36c1c5f758e0caf0b2f4d8ccf426bf428aee41d739`；v1/RETURN/Response/v2 `1/1/0/0`，CREATE/SUBMIT/RETURN/ACCEPT `1/1/1/0`，Product/BOM/Unit/四条 10 PCS 不变 |
| 主 UAT 浏览器 | PASS / READ ONLY | engineering login/logout 1/1、业务 POST 0、Response/v2 write 0、planning login 0；空回复输入、v2 禁用、选择器 0、390px 与退出 Session 0 通过 |
| 资源/清理 | PASS | 起点约 2.1 GiB available/227 MiB Swap/22 GiB/低 Load；最终 2.1 GiB/240 MiB/22 GiB/Load `0.04/0.16/0.27`。内核 OOM 0、四服务 restart 0/OOM false；临时库/容器/app 提取/Playwright/Python 目录均清零，备份、候选/回滚 Web 和四卷保留，未 prune |

## SELFHOST-OPS-UAT-PLANNING-DECISION-HISTORY-FIX-12 Planning 决策历史修复与主 UAT 回看

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | PLANNING DECISION HISTORY FIXED — UAT V1 RETURN VERIFIED | 功能、隔离测试、备份恢复、Web-only 部署与 planning-only 主 UAT 均完成；已停止，未登录 engineering、未创建 v2 |
| 严格起点 | PASS | clean `main@eaeae1c816256eb48355bdb117ecc20f6ac8545f`、behind 0/ahead 115；alpha.37、36/head 0036、Package ID 1/v1/RETURNED、RETURN 1、ACCEPT 0、v2 0 全部吻合 |
| Unicode 门禁 | PASS / LOW | 预期与数据库原文精确不等；仅 U+FF1A→U+003A、U+FF0C→U+002C 两处，分别 NFKC 后完全相等。原始文本经过全半角规范化，语义核对 PASS；数据库原文权威，历史未修改 |
| 功能提交 | PASS | `180f6b58b583bd2dba350f017504be916db9673d`（`fix: expose planning decision history`）；未新增 Migration、Schema、版本或权限 |
| 队列/历史 | PASS | Planning 明确提供“待接收 / 已处理”；已处理只含 RETURNED/ACCEPTED 并可重开稳定 Package ID/version，完整显示 CREATE/SUBMIT/RESUBMIT/RETURN/ACCEPT |
| 决策 UX | PASS | 接收/退回均有 POST 前确认；服务端成功响应生成操作者、时间、请求号、结果与完整原因凭证，并提供“查看已处理详情”；终态按钮隐藏 |
| 快照与权限 | PASS / READ ONLY | Product A0、BOM V1、Unit Resolution v1、四项 Material 的 1 PCS/10 PCS 固定快照只读；未增加 `system.audit.read` 或扩大 planning 权限，未处理全局跨角色导航 |
| 定向/回归 | PASS | Planning unit/UI/PG `4/7/11`；Identity/Project/Master-BOM PG `10/5/6`；0036 upgrade `6/6`；适用静态/安全回归 `65/65`，覆盖权限、诱饵审计、CSRF、Origin、幂等、并发与回滚 |
| Chromium | PASS 1/1 + MAIN UAT | 隔离 390×844 合成退回→确认→完成凭证→已处理重开通过；主 UAT 只登录 planning，网络只允许 login/GET/logout，Package 1/v1 从已处理重开、390px、退出及匿名 401 通过 |
| 构建/静态门禁 | PASS | Planning/Project typecheck、production build、`git diff --check`、1,137 文件断网凭据扫描通过；lint `0 error / 10 existing warnings` |
| 备份/恢复 | PASS | root:root 0600 custom dump 2,139,142 bytes，SHA-256 `1d5cdd88257f2e53830598a498b609ac7208b792f7fcfdae2f8306b37d36eb5f`；list、第二空库恢复、36/head 0036 与对象核对通过，恢复库已删，备份保留 |
| Web-only 部署 | PASS | Web 更新为 `sha256:fb88dd8afb8b7f08cf6c8dff9aa66566ad9aec0a203460e7fd09bc32af728edc`；旧 `sha256:6b94a9c73a18...` 有精确 rollback tag。PostgreSQL/Worker/Caddy ID、0036 和四卷未变 |
| 主 UAT 最终对象 | PASS / UNCHANGED | 1/v1/RETURNED、RETURN 1、ACCEPT 0、v2 0；数据库实际原因、RETURN 操作者、Asia/Shanghai 时间、请求号、SUCCESS、工程/项目部责任队列、assignee/SLA 空状态均可见；planning 活跃 Session 0 |
| 业务保护 | PASS / UNCHANGED | 部署前备份恢复库与主 UAT 后主库同源摘要均为 `3960cf1f1fc3fdaca0bacd246732d27a0ff223e894953e7be2427fa22b150dca`（217 tables / 201 sequences）；除允许的 login/logout 身份记录外无业务写 |
| 资源/清理 | PASS | 起点约 2.2 GiB available/217 MiB Swap/20 GiB/Load `0.10/0.14/0.12`；最终约 2.1 GiB/221 MiB/22 GiB/`0.08/0.10/0.21`。内核 OOM 0、四服务 restart 0/OOM false；任务临时库/容器/网络/模块/脚本/指纹 0，四卷保持，未 prune |
| Git | TWO FOCUSED COMMITS | 功能提交如上；收口提交为 `ops: accept planning decision history in parallel environment`，实际 SHA 以 `git log` 为准；未 push/PR 或改写历史 |

## SELFHOST-OPS-OFFLINE-IDENTITY-RECOVERY-11 受控离线身份恢复与 Canonical 凭据激活

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | OFFLINE IDENTITY RECOVERY COMPLETED — CANONICAL CREDENTIALS ACTIVE | 方案 B 已在当前并行非生产 UAT 完整执行；正式 run-id `3b03aaab-11ef-4dfe-963b-001a6ece660f`，完成后停止，未开始 Planning 核验 |
| 严格起点 | PASS | clean `main@753c68c84427de93536a1f282b6e80987f7c9466`、behind 0/ahead 113；alpha.37、36/head 0036、指定 Web 镜像、四服务、四卷、旧文件元数据与资源门禁全部吻合；旧凭据正文未读 |
| CLI 守卫 | PASS | 不接 Web 路由；拒绝 production、非 root、未知数据库身份、非 0036、Web/Worker 可写、缺少确认和重复 run-id；禁 core、umask 077、错误与输出去敏，复用现有 Password/Identity/PostgreSQL 事务边界 |
| 定向/隔离测试 | PASS | unit 7/7、隔离 PostgreSQL 12/12；覆盖 11 账号原子更新、角色/active 保持、目标 Session 撤销、其他用户 Session 不变、11 审计、故障零半记录、run-id、Stage 失败、提升失败恢复和最终化幂等 |
| 最终隔离演练 | PASS | 从 0036 主库备份恢复后，以 run-id `08ab9e35-07c5-467d-9b45-7ceccc78dec3` 完成 11 账号/12 Session/11 审计、Canonical、单 Chromium 1+10 登录/门禁/退出和零有效目标 Session；指纹不变，演练资源已清理 |
| 正式备份/恢复 | PASS | root:root 0600 dump 2,134,619 bytes，SHA-256 `4c071223172d8a0fcb8c196690ec57c0f414eb83fde40f316449d5200f6bc42a`；`pg_restore --list` 与第二新空库 36/head 0036、非敏感身份计数和两类业务指纹核对通过；恢复库已删，正式备份保留 |
| 正式事务 | PASS / ATOMIC | 11 个目标账号锁定并更新，用户名/角色/active 保持；撤销 12 条目标既有 Session；写 11 条 `OFFLINE_IDENTITY_RECOVERY` 审计和唯一 run-id 证据；其他用户/Session 与业务表不在写入范围 |
| 业务保护 | PASS / UNCHANGED | 业务指纹 `04cdbc8a49112bc43b5652760408d46d10dbdda1801c1c9b816aa9891a5b5c3c`、受保护指纹 `5414589704ac085792cab1a546e658a61b39c2988800a23ad091e756275e7d41` 正式执行前后相同；版本、Migration、Schema、镜像未变。Planning 表仅被受控备份/恢复与整体指纹核对覆盖读取，未做 Package 对象级核验、修改或业务操作 |
| Canonical/Stage | PASS / ACTIVE | Admin/UAT Canonical 均为标准 JSON、单硬链接普通文件、`root:root 0600`，Schema PASS；两份 Stage 最终删除，旧 UAT candidate 仅在双文件成功后删除；PREPARED/COMPLETED 标记与浏览器证据保留 |
| 主 UAT 浏览器 | PASS 1+10 | admin 登录成功、不强制改密并安全退出；十个固定 UAT 账号均登录成功、仅到强制改密页、未实际改密并安全退出；历史导航/刷新不恢复受保护内容，未进入经营或 Planning 页面 |
| 最终 Session | PASS / ZERO RISK OPEN | 正式浏览器后 11 个目标账号有效且未撤销 Session 均为 0；无需单账号 fallback，没有本任务遗留 Session 风险 |
| 停服/服务 | PASS / 113 SECONDS | Web/Worker 两次停写 92 秒与 21 秒；PostgreSQL/Caddy 保持运行。原 Web/Worker 容器 ID 与镜像恢复，Web/PostgreSQL healthy、Worker/Caddy running，restart 0/OOM false；未 build/换镜像/重建 Volume |
| 自动基线 | PASS | Site lint、`npm test` 3/3、Python self-test/smoke/隔离 go-live、仓库凭据扫描和 `git diff --check` 通过；未读取 `shujvbiao/` |
| 资源/清理 | PASS | 起点约 2.1 GiB available/227 MiB Swap/21 GiB 根盘/Load `0.06/0.26/0.34`；最终约 2.2 GiB/218 MiB/20 GiB/`0.11/0.41/0.41`，内核 OOM 0、四服务 restart 0/OOM false，未触发门禁。隔离库、临时容器/网络/浏览器运行材料/测试 Stage/临时 SQLite 均清理，四个受保护 Volume 保持；未 prune |
| Git | TWO FOCUSED COMMITS | 工具/测试提交 `a48dcc8a290b96da1ea6e426aaa2c6d73416c2fc`；完成记录提交 `ops: complete canonical credential recovery` 的实际 SHA 以 `git log` 为准；不 push/PR/amend/rebase/reset/stash/restore |

## SELFHOST-OPS-UAT-CREDENTIAL-RECONCILIATION-10 管理员与 UAT 凭据安全收口

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | BLOCKED — NO FURTHER IDENTITY CHANGE | 单一受控进程在凭据结构预检返回 FAIL 后立即停止；Chromium、Identity API 和业务 API 均未启动，身份变更 0 |
| 严格起点 | PASS | clean `main@a4eff293668e24f4f780eb5df840bfc7e510365e`、Parent `615fe3ab4913c1964cfeb7337196f0d3e1a8d787`、behind 0/ahead 112；alpha.37、36/head 0036、指定 Web 镜像、文件元数据及四服务状态吻合 |
| 结构预检 | FAIL CLOSED | 受控进程未取得允许继续的结构 PASS，且没有输出凭据正文。无法据此区分文件事实异常与解析器格式覆盖不足；严格规则禁止本轮重跑或继续身份步骤 |
| 管理员 | NOT RUN / UNCHANGED | 本人改密、旧密码拒绝、新密码登录、不触发 must-change 和页面退出均未执行；正式管理员文件未变，未遗留本轮管理员候选 |
| manager | NOT RUN / RISK OPEN | 未执行第二次重置，上一轮 manager Session 风险未被本任务撤销 |
| 十账号验证 | NOT RUN 0/10 | manager、sales、engineering、planning、purchase、warehouse、production、quality、finance、operations 的旧密码拒绝、新密码认证、强制改密、安全退出和 Session 失效均无新增结果 |
| 角色/启用状态 | NOT RECHECKED | 没有进入管理员页面；沿用上一轮记录，不冒充本轮验证 |
| Identity 审计 | NOT QUERIED / TASK EVENTS 0 | 本任务未发送 Identity 请求，因此未生成本任务 Identity 事件；未读取或导出审计日志 |
| 文件 | RETAINED / UNCHANGED | 管理员与正式 UAT 文件仍为 `root:root 0600`；既有 `/etc/chenyida-erp/.uat-role-accounts.txt.candidate-20260801025603-b821881a80` 仍为 `root:root 0600`，未提升/覆盖/删除；本轮三个隐藏阶段路径最终不存在 |
| Session 风险 | LEGACY RISK OPEN / NO NEW SESSION | 本任务没有创建 Session；ROLE-CREDENTIAL-ROTATION-09 遗留的 Admin 与 manager Session 风险保持开放 |
| 业务保护 | PASS / ZERO REQUEST | 没有打开 Identity/强制改密/经营/Planning 页面，也没有发送 API 请求；未读 Package、数据库身份数据或 Session 表，未执行任何业务动作 |
| 版本/服务 | UNCHANGED | alpha.37、0001—0036、Web/Worker/PostgreSQL/Caddy 保持；未 build、Migration、PostgreSQL 测试、Compose 重建、重启或部署，四服务 restart 0/OOM false、内核 OOM 0 |
| 资源/清理 | PASS | 起点约 2.2 GiB available/218 MiB Swap/22 GiB/Load `0.19/0.14/0.10`；最终约 2.2 GiB/217 MiB/22 GiB/`0.40/0.23/0.20`。临时容器自动删除，无浏览器 profile；控制脚本、临时依赖/cache 和精确 `/run` 目录已清理。按保护规则未删除镜像/Volume/备份 |
| Git/检查 | DOCS-ONLY CLOSURE / PASS | 起点 `a4eff293668e24f4f780eb5df840bfc7e510365e`；1,119 文件凭据扫描、`git diff --check`、Python self-test/smoke/隔离 go-live 通过。只提交无秘密阻断报告，提交消息 `ops: record blocked credential reconciliation`，实际 SHA 以 Git log 为准；不 push/PR/改写历史 |
| 后续 | NEW EXPLICIT AUTHORIZATION REQUIRED | 保留既有候选并停止 UAT/Planning 登录；另立安全格式核验与身份收口任务。Admin/manager 风险、十账号退出 10/10 和正式文件提升全部完成前不得开始 planning 核验 |

## SELFHOST-OPS-UAT-ROLE-CREDENTIAL-ROTATION-09 UAT 角色凭据轮换与恢复候选

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | PARTIAL UAT CREDENTIAL ROTATION — RECOVERY CANDIDATE RETAINED | 十个密码重置已提交，但页面退出/Session 失效及其余账号验证未完成；正式凭据文件未提升 |
| 严格起点 | PASS | clean `main@615fe3ab4913c1964cfeb7337196f0d3e1a8d787`、Parent `682e79378660ef7859617655836f02e2112df244`、behind 0/ahead 111；alpha.37、36/head 0036、指定 Web 镜像及四服务状态吻合 |
| 重置范围 | PASS 10/10 | 只通过管理员网页逐个重置十个指定 UAT 角色账号；逐项角色和 active 状态保持。`admin`、UAT admin-check 及其他账号未重置，管理员凭据文件未修改 |
| Identity 审计 | PASS | 本任务窗口内目标 `USER_PASSWORD_RESET` 成功 10、失败 0；未展示或复制敏感正文 |
| 旧密码拒绝 | PARTIAL 1/10 | 首个账号返回 `LOGIN_FAILED`；其余九个因安全停止未验证 |
| 新密码/强制改密 | PARTIAL 1/10 | 首个账号认证成功并停在首次强制改密页，未实际改密、未越过该页；其余九个未验证 |
| 页面退出/Session | FAIL CLOSED / RISK OPEN | 首个 UAT 与管理员页面退出、Session 失效没有完成证明；其余九个未登录验证。未读取全局 Session 表或直接 SQL 撤销 Session，不能用关闭 Chromium 冒充退出成功 |
| 恢复候选 | RETAINED | `/etc/chenyida-erp/.uat-role-accounts.txt.candidate-20260801025603-b821881a80` 为 `root:root 0600`；每次重置后原子更新并 fsync。未提升、未删除，正式文件仍为 `root:root 0600` 且十个旧密码均已失效 |
| 业务保护 | PASS / NO BUSINESS REQUEST | 没有打开经营工作台或 Planning Package 详情，没有发起接收、退回、v2、项目/主数据或任何业务域请求。本轮未读 Package 数据，不能冒充新的黑盒状态证据 |
| 版本/服务 | UNCHANGED | alpha.37、0001—0036 和 Web 镜像保持；未 build、Migration、PostgreSQL 测试、Compose 重建或服务重启，四服务 restart 0/OOM false |
| 资源/清理 | PASS WITH CANDIDATE RETAINED | 起点约 2.3 GiB available/218 MiB Swap/22 GiB/Load `0.44/0.31/0.21`；最终约 2.3 GiB/218 MiB/22 GiB/`0.13/0.18/0.20`。内核 OOM 0，四服务 restart 0/OOM false；临时容器、profile/cache、依赖、控制脚本和目录已清理，未 prune、删除镜像/Volume/备份，恢复候选按规则保留 |
| Git | DOCS CLOSURE | 起点 `615fe3ab4913c1964cfeb7337196f0d3e1a8d787`；1,118 文件凭据扫描和 `git diff --check` 通过，仅提交无秘密的状态/任务报告，提交消息 `ops: rotate exposed UAT role credentials`，实际 SHA 以 Git log 为准；不 push/PR/改写历史 |
| 后续 | EXPLICIT RECOVERY AUTHORIZATION REQUIRED | 保留候选并停止所有 UAT/Planning 登录；另行授权后先处置管理员和首个 UAT Session 风险，再完成十账号验证。全部退出/失效通过前不得提升候选或开始 planning-only 核验 |

## SELFHOST-OPS-UAT-PLANNING-REVIEW-TRACEABILITY-FIX-08 Planning 审核追溯修复与安全停止

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | BLOCKED — NO UNSAFE CHANGE | 只读追溯功能、隔离验证、备份恢复和 Web-only 部署已完成；主 UAT planning 浏览器核验因凭据输出事件停止，不能标记为完成 |
| Git | FEATURE COMMITTED / OPS CLOSURE | 起点 `a254bca5d59dd3f17047c9d6495dfdf2df1a798e`、Parent `91c0fd29d534246c55ddd669e894cdde9b774e52`、behind 0/ahead 109；功能提交 `682e79378660ef7859617655836f02e2112df244`，安全停止/运维文档以独立提交收口；未 push/PR/历史改写 |
| 历史追溯缺口 | NOT FOUND | Package ID/version/digest/创建事实、CREATE 请求号、SUBMIT Event、固定 Unit Resolution v1、稳定 Product/BOM/Material 关联均已有权威事实；未补写、重建或伪造历史 |
| 查询与权限 | PASS / PACKAGE SCOPED | 单连接 `REPEATABLE READ READ ONLY`；先校验 `planning.read` 和 Package 对象范围，再读取该 Package 的创建审计与 Event。另一 Package 审计诱饵、DRAFT/跨项目 403 通过；未授予 `system.audit.read` |
| DTO/页面 | PASS / SYNTHETIC VERIFIED | 显示 Package ID/version/完整摘要/状态/责任队列/assignee 与 SLA 空状态、CREATE/SUBMIT/后续决策时间线、Asia/Shanghai、Product/BOM 稳定 ID、创建门禁证据与当前状态、销售源单位 pending、固定 Resolution v1、Material 533—536 ID/编码/名称/1 PCS/损耗/10 PCS |
| 操作与响应式 | PASS / SYNTHETIC VERIFIED | 退回文案为“退回工程/项目部修订”，接收/退回后果和必填原因明确，终态无可操作按钮；390×844 无页面级或物料区横向溢出，宽表切换卡片，摘要和请求号可换行/复制 |
| 自动测试 | PASS | 适用 Node 103/103；Planning unit 4/4、UI 7/7、PostgreSQL 11/11；两个 typecheck 通过，lint 0 error/10 既有 warning，仓库凭据扫描 1,117 文件通过 |
| 隔离 Chromium | PASS 1/1 | 合成库完成查看→退回；v1 仅 1 个、v2/ACCEPT 0，源销售单位仍 NULL/pending，退出 Session 失效。首次断言运行在退回前因时区说明计数问题结束，修正断言后重跑通过 |
| 版本/Migration | UNCHANGED | 源码与运行面保持 alpha.37；0001—0036 未修改、不新增 0037，0036 SHA-256 `a5ad532837acb0c9704f5c885206cf2ec10c891628c7fe4ed660233468b134a0`；主 UAT 未运行 Migration |
| 正式备份/恢复 | PASS | root:root 0600 custom dump 2,131,480 bytes，SHA-256 `25c302316d415602825d1d9d85e8456a5c46db5c4167cc5f8da27b0ea8f42ff2`；`pg_restore --list` 与第二新空库 36/head 0036 恢复、0036 hash 和业务指纹核对通过，恢复库已删除 |
| 部署 | PASS / WEB ONLY | Web `sha256:6667bd2ca64e...→sha256:6b94a9c73a18...`，旧 Web 精确回退 tag 保留；PostgreSQL、Worker、Caddy 未重建，Origin/端口、四卷保持 |
| UAT 数据 | PASS / UNCHANGED | 部署前后业务指纹均为 `a7869b3ae5d75b7b68fac1234e04288c755622ee3f549497b2c96dc366701679`；Package ID 1/v1/SUBMITTED/摘要前缀 `9d7a6a7ec9aefbaf`，总数 1、v2/RETURN/ACCEPT 0，Resolution/Product/BOM/Material/Event/Audit 未修改 |
| 主 UAT 浏览器 | NOT RUN / SAFETY STOP | 没有登录 planning 或 engineering，没有创建 Session，没有填写原因、点击接收/退回或产生 v2；不得把隔离结果描述成主 UAT 证据 |
| 凭据事件 | PARTIAL ROTATION / BLOCKER OPEN | 后续 ROLE-CREDENTIAL-ROTATION-09 已通过网页重置十账号，但验证在首个账号退出前安全停止；正式文件未提升，恢复候选保留，管理员和首个 UAT Session 风险未解除。文档和 Git 不记录凭据值、摘要、Cookie、Token 或 Session 信息 |
| 运行健康/资源 | PASS | 最终 available 2.2 GiB、Swap 214 MiB/1 GiB、根盘 22 GiB、Load `0.17/0.54/0.74`；Web/PostgreSQL healthy、Worker/Caddy running，四服务 restart 0/OOM false。任务检查范围约 2.1—2.3 GiB available、196—224 MiB Swap、根盘最低 21 GiB，未触发停止阈值 |
| 清理 | PASS | 本任务隔离测试/恢复库、临时 runner/builder/Playwright 基础镜像和精确临时目录已删除；正式备份、当前/回退 Web 保留。未 prune，四个受保护 Volume 保持 |
| 后续 | EXPLICIT RECOVERY AUTHORIZATION REQUIRED | 先在独立授权下处理恢复候选、Session 风险和十账号完整验证；正式文件原子提升后，仍须另立 planning-only 只读核验。此前不得重新开始 planning 退回试用 |

## SELFHOST-OPS-UAT-PLANNING-UNIT-RESOLUTION-IMPLEMENT-07 版本化需求单位解析实施与并行 UAT 部署

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | VERSIONED REQUIREMENT UNIT RESOLUTION DEPLOYED — UAT PACKAGE UNCHANGED | alpha.37/0036 已实现、隔离验证并部署到并行非生产 UAT；未执行业务单位确认或 Package 创建 |
| Git | PASS | 起点 `d06b44f5958527707f38e4c12f0d3143ce31875b`、Parent `525ad2907287d736ecd40d3df24b77c6c5be8ff4`；功能提交 `91c0fd29d534246c55ddd669e894cdde9b774e52`，独立 ops 提交以 Git log 为准；未 push/PR/历史改写 |
| 版本/Migration | PASS / DEPLOYED TO UAT | package alpha.37；36/head `0036_project_requirement_unit_resolution.sql`，SHA-256 `a5ad532837acb0c9704f5c885206cf2ec10c891628c7fe4ed660233468b134a0`。0001—0035 汇总 `504ba2fd...11c0`、0035 `d64ec733...9714` 未变 |
| 数据模型 | PASS | Resolution Version 只追加；每 Requirement Item 独立 Head/CAS；稳定 Unit 与复合需求链 FK；Version UPDATE/DELETE 和直接 Head 推进禁止；新 Package Item 固定精确 `unit_resolution_id` provenance |
| 服务端安全/事务 | PASS | engineering 项目负责人、manager、admin 可确认；planning/sales/operations 等拒绝。Session、Origin、CSRF、权限、Idempotency-Key、CAS、enabled Unit、Audit 与故障回滚同一服务事务，中文稳定错误码带 request_id |
| UI | PASS | pending 行显示 enabled Unit `中文名 · CODE`，不预选 PCS；Product/BOM 和 Unit 分别显示状态，缺失行明确；未完整时保存/生成受控，刷新显示 Resolution 版本，390px 无页面级横向溢出 |
| 自动测试 | PASS | Migration 6/6、Project PG 5/5、Planning PG 10/10、静态回归 89/89、适用 PG 25/25、npm 3/3；两个 typecheck、lint 0 error/10 既有 warning、production build 通过 |
| 隔离浏览器 | PASS / REAL CHROMIUM | 390×844 全旅程 1/1：无 PCS 预选、停用 Unit 隐藏、未知 Origin 拒绝、保存刷新 v1、退回修订重提接收、四行各 10 PCS、Package v1/v2 固定各自 Resolution、源 Requirement NULL/pending、退出失效；只用合成隔离数据 |
| 隔离升级/回退 | PASS | 空库 0001→0036、0035→0036、0034 dump 恢复后 0035→0036、重放、失败回滚和约束通过；回退恢复到另一新空库为 34/head 0034，保护事实一致，临时库已删除 |
| 正式备份/第二库恢复 | PASS | root:root 0600 custom dump SHA-256 `75e1ffbf2ea846761ece1d4c73dea96e871eca5fcde86d28f24782b10f862df7`；`pg_restore --list` 与第二新空库 34/head 0034/保护事实恢复通过；备份保留 |
| 部署 | PASS / WEB ONLY | 并行 UAT 串行应用 0035、0036；Web `7e0a3040acd1...→6667bd2ca64e...`。Worker 保持 `32d1ae335610...`，Caddy 不重建，PostgreSQL Volume、Origin/端口与四卷不变；旧 Web 精确回退 tag 保留 |
| UAT 数据 | PASS / UNCHANGED | 指纹 `fb71309bf73dce907f0bcb2e294d1b31` 前后相同；Requirement Item NULL/pending/10，Product/BOM Resolution 7/7/7/7，Unit Resolution/Head 0/0，Package/Item/Event/待接收 0/0/0/0；Material 533—536 V3/ACTIVE/PCS、四行各 1 PCS 保持 |
| 主 UAT 只读验收 | PASS | Engineering 390px 显示空单位选择器和缺失状态；未选择/保存 PCS、未生成 Package、未登录 planning。退出后 Session 失效。此前一次格式探测登录 401 没有 Session 或业务写，不影响指纹 |
| 运行健康/资源 | PASS | 最终清理后 available 2.3 GiB、Swap 210 MiB/1 GiB、根盘 26 GiB、Load `0.30/0.30/0.40`；Web/PostgreSQL healthy、Worker/Caddy running，四服务 restart 0/OOM false，任务 OOM 0；临时库/容器/worktree/runner/在线隔离 dump/Playwright 镜像已清理，正式备份、当前/回退 Web 镜像和四个受保护卷保留 |
| 范围保护 | PASS | 未访问生产数据库、迁移真实公司数据、修改 Python/SQLite、切流、push/PR 或登录 planning；未读取/修改 `shujvbiao/`，未删除四个受保护 Volume |
| 后续 | READY FOR SEPARATE ENGINEERING BLACK-BOX TASK | Schema 阻断已解除；业务续测必须另立任务并从 Unit Resolution 0、Package 0 起点显式确认，不得自动推断 PCS |

## SELFHOST-OPS-UAT-PLANNING-UNIT-RESOLUTION-FIX-06 需求单位解析 Schema 缺口诊断

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | SCHEMA CHANGE REQUIRED — UAT PACKAGE UNCHANGED | 分支 B；只完成根因、数据边界与 0036 方案，不实现、不部署、不继续试用 |
| 起点门禁 | PASS | clean `main`/`525ad2907287d736ecd40d3df24b77c6c5be8ff4`，behind 0/ahead 106；alpha.36/0035 源码、alpha.34/0034 常驻面、Web `sha256:7e0a3040acd1...`、新公网 Origin 全部吻合；无其他执行流/重型容器 |
| 根因 | CONFIRMED | Requirement Item 是 `unit_id=NULL/unit_pending=true`；Product/BOM Resolution 不含 Unit；快照 INNER JOIN 排除 NULL 后统一误报。源 Requirement Item 有 DB 不可变 trigger，不能写回 |
| Product/BOM 关系 | PRESERVED | Resolution ID 1 已稳定引用 Product/Product Version/BOM Header/BOM Version `7/7/7/7`；Unit Resolution 是缺失的独立事实，不能从 BOM 四行 PCS 推断 |
| Schema | REQUIRED / NOT CREATED | proposed D-086：0036 追加式 Unit Resolution 版本表、独立 CAS Head、复合 FK/唯一/索引、enabled Unit 校验、Package Item provenance；未修改 0035、未创建 0036 |
| 安全/事务 | DESIGN REQUIRED | 后续 engineering/`planning.prepare`、严格 Origin/CSRF、幂等正文摘要、独立 CAS、并发单胜、Unit+Product/BOM+Audit 同事务/零半记录；本轮无写端点可验收，不宣称通过 |
| 错误/UI | DESIGN REQUIRED | 后续拆分 Unit 与 Product/BOM 缺失、无效/停用 Unit 稳定码；pending 行显示 enabled Unit 选择器和逐行缺失项，未完整时禁用生成，刷新持久，390px 无横向溢出 |
| 自动测试 | DOCS BASELINE ONLY | Planning 功能测试 0、隔离 PostgreSQL 写测试 0；Python self-test/smoke/隔离 go-live 三项通过。Node unit/UI 因镜像看不到沙箱源码挂载而在测试发现前退出，断言 0、容器已删；后续 0036 必测矩阵完整保留，不伪造通过 |
| UAT 保护 | UNCHANGED | 当前 Requirement Item 仍 pending；Project ACCEPTED/10、Product 7/A0 RELEASED、BOM 7/V1 RELEASED、四行 533—536/1 PCS/0 保持；Resolution/Package/Item/Event `1/0/0/0`，待接收 0，三条指定失败记录保持 |
| UAT 指纹 | UNCHANGED | 同一只读查询的前后综合指纹均为 `b239c62091cf51de8fa5b3ff6fb6521a` |
| 版本/部署 | UNCHANGED | 源码 alpha.36/0035；运行 alpha.34/0034；Web 镜像、Origin、PostgreSQL/Worker/Caddy 保持。无 build/Migration/backup/restore/deploy/restart |
| 资源/清理 | PASS | 起点/终态 available memory 均约 2.3 GiB，Swap 约 `223→222 MiB`，根盘 28 GiB，终态 Load `0.09/0.11/0.09`；四服务 restart 0/OOM false。临时 SQLite/容器均删除，四个受保护 Volume 保持 |
| Git/边界 | DOCS ONLY | 只允许 `docs: diagnose planning unit resolution schema gap` 独立提交；无功能/ops 验收提交，无 reset/stash/restore/checkout/rebase/amend，不访问 `shujvbiao/`，不输出凭据 |
| engineering 试用 | BLOCKED | 未选择/提交 PCS，未生成 Package，未登录 planning；0036 完成独立迁移、测试、恢复和部署前不能重新开始黑盒交接 |

## SELFHOST-OPS-UAT-PLANNING-CSRF-BOM-IMMUTABILITY-FIX-05 Planning CSRF 与 RELEASED BOM 不可变修复

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | PLANNING CSRF AND RELEASED BOM IMMUTABILITY FIXED — UAT HANDOFF NOT CREATED | 共享客户端、BOM 前后端不可变、默认最小披露、隔离写旅程、兼容部署和主库只读验收完成 |
| Git | PASS | 起点 `3cb5c38`/ahead 103；功能提交 `2b923da`、`fbaf34a`，验收提交 `ops: accept planning csrf and bom immutability fixes`。无 push/PR/amend/rebase/reset/stash/restore，未读取、修改或提交 `shujvbiao/`/工作簿 |
| CSRF 根因 | FIXED | Planning 路由未被共享客户端的 protected-write 分类识别，普通 POST 分支丢失 `X-CSRF-Token` 和调用方幂等键；Header 名和 same-origin credentials 本身正确，重新登录无法修复“根本未发 Header” |
| 共享客户端 | PASS / CURRENT SESSION | 所有 Planning 写统一 `sessionPost`；每次发送读当前 `CYD_ERP_CSRF` Cookie，POST+same-origin+`X-CSRF-Token`；页内幂等键绑当前 Token/method/path/canonical 正文，logout/重新登录/认证失效/页历史变化清旧上下文 |
| 服务端安全 | PASS / UNCHANGED | Origin/CSRF/Session/权限/限流/审计未放宽；缺失/错误/旧 Session Token、旧公网/未知 Origin 拒绝，不信任 Forwarded/X-Forwarded；错误仍为中文稳定码+request_id，不记录 Token/Cookie/敏感正文 |
| RELEASED BOM UI | PASS / 0 MUTATION CONTROLS | 只显示“已发布，只读；如需修改请创建新版本”和四行事实；Material、行号、数量、损耗率编辑器及新增/编辑/删除/保存/发布动作为 0，旧 DRAFT 输入不泄漏到 RELEASED |
| RELEASED BOM 服务 | PASS / FAIL CLOSED | DRAFT 在获权下可增改删；RELEASED POST/PATCH/DELETE 均 `409 BOM_RELEASED_IMMUTABLE`，Line/Version/Event/成功 Audit 零半记录；数据库 trigger 仍在 |
| 默认披露 | PASS / EXPLICIT SELECTION | 初次进入显示“请选择或搜索 BOM”且 BOM Line 请求 0；有界 Header/Product 搜索支持 BOM 编码、Product 编码/名称，明确选择后才读明细；390px 通过 |
| 隔离 Planning 写旅程 | PASS / REAL CHROMIUM / 0034 | 合成项目完成 current/缺失/错误/旧 Token、logout→login、公网/回环/拒绝 Origin、保存→生成→提交→退回→修订→重提→接收、幂等/异正文/CAS；18 次共享受保护写、11 次 Planning 写、18 次 Cookie/Header 匹配，v1 RETURNED/v2 ACCEPTED |
| 自动回归 | PASS | 当前源码相关 unit/UI/handler/PG、Identity/Origin/logout/no-store、Project/Planning、Product/BOM、Material selector、Dashboard、TASK09、typecheck、218-table Schema consistency、lint 0 error、build、credentials、diff check 通过；文档收口后断网只读合同 20/20，稀疏 credentials 1,108 files；兼容源 140/140、PG `16+19`、209-table consistency、typecheck/lint/build/credentials 通过；Python 三项通过 |
| 版本/Migration | COMPATIBLE HOTFIX | 源码 alpha.36/0035；运行 alpha.34/0034。无 Schema diff/0036，0035 未运行，TASK09/完整 alpha.36 未部署 |
| 备份/恢复 | PASS | dump 2,027,218 bytes/0600/root，SHA-256 `b30fa30408da026bd4114a52011e56485956fb72529e6e3467dfa5e4d5aa0d44`，3,065 list 行/213 TABLE DATA；独立 0034 恢复的 migration、210 表、保护 UAT、Planning 0 和三条旧 CSRF 失败一致，恢复库已删除 |
| 部署/回退 | PASS / WEB ONLY | Web `cb6a5c1fae89...→7e0a3040acd1...`，旧镜像以 `rollback-fix05-predeploy-20260731T022228Z` 保留；PostgreSQL/Worker/Caddy ID 不变，四服务 restart 0/OOM false，34/head 0034，Origin 保持新公网值 |
| 主库验收 | PASS / READ ONLY | engineering 仅 login/logout POST；初次明细请求 0，选择 BOM 7 后只读四行，写控件 0，Planning 识别 A0/V1，退出后 back/forward/refresh 匿名。未登录 planning，未点击任何 Planning/BOM 写动作 |
| UAT 保护 | UNCHANGED | Project ACCEPTED/10、Product 7/A0 RELEASED、BOM 7/V1 RELEASED、四行 533—536/1 PCS/0 不变；Planning resolution/package/item/event `0/0/0/0`，三条历史 `CSRF_INVALID` 不变；只新增 1 LOGIN/1 LOGOUT，Session 已撤销 |
| 资源/清理 | PASS | 起点约 2.2 GiB available/196—197 MiB Swap/29 GiB；最终扫描及清理后约 2.3 GiB/223 MiB/28 GiB/Load `0.12/0.14/0.17`，未触发门禁。内核 OOM 0、restart 0；测试/恢复库、临时容器、runner、Playwright 镜像、worktree/candidate tag 已清理，备份/当前/回退镜像保留，未 prune |
| engineering 试用 | READY AFTER NEW AUTHORIZATION | 技术 blocker 已解除，可在项目负责人重新授权后开始 Planning Handoff 试用；本任务已停止，未创建交接包 |

## SELFHOST-OPS-UAT-BOM-SELECTOR-FIX-04 正式编码优先 BOM 物料选择与发布流程

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | BOM CODE-FIRST MATERIAL SELECTION FIXED — UAT BOM NOT CREATED | code-first 选择、事务校验、生命周期说明、隔离回归、alpha.34/0034 兼容部署和只读浏览器验收完成 |
| Git | PASS | 起点 `28b79d2`/ahead 101；功能 `b66e742`，验收提交 `ops: accept bom selector fix`。无 push/PR/amend/rebase/reset/stash/restore，无工作簿访问或提交 |
| 根因 | FIXED | `/api/items` 当前字段与旧 `internal_item_code` 前端适配不一致；option/提交依赖编码回退、无搜索且全量长下拉。正式编码不是主数据缺失 |
| Selector DTO | PASS / BOUNDED | `/api/bom-material-candidates` 返回 material_id/internal_code/name/unit_id/unit/status/version；只含 ACTIVE+非空正式编码+enabled 主单位，最多 20；精确编码单一匹配，否则前缀/名称 |
| UI/值语义 | PASS | 显示 `编码 · 名称 · 单位`，隐藏/提交只用 material_id/unit_id；空/等待/加载/无结果/错误/清除明确，重复行客户端拦截，桌面与 390px 无整页横向滚动 |
| 服务端校验 | PASS / TRANSACTIONAL | 保存及发布都锁定并验证稳定 ID、ACTIVE、正式编码、Unit enabled、主单位；同 BOM Version 重复 material_id 拒绝。正数/六位数量、幂等、CAS、审计、回滚和不可变保持 |
| 权威模型 | PASS / ONE MODEL | Product Version、BOM Version、BOM Line 与 Planning Resolution/Package 共用 PostgreSQL 稳定 ID。BOM 属于 Product Version，Project 在 Planning Handoff 关联，不用名称桥接 |
| 发布流程 | PASS / EXISTING SERVICE | 真实 Product/BOM release API 和 engineering 既有权限存在；UI 明确先草稿/校验、草稿后显示发布、发布后不可原地修改、RELEASED 后才进入 Planning。没有伪按钮或新状态机 |
| 自动验证 | PASS | 0034 隔离 PG Master 5、Planning 3、Identity 10、Material 7、operations 4、Dashboard 2；兼容 unit/UI 120、TASK09 14、typecheck、209-table Schema consistency、lint、build、File Storage/Environment、代码阶段 credentials 1,029 files 与最终暂存阶段稀疏 credentials 1,105 repository paths、Python 三项及 diff check 通过；最终扫描工作树未检出受保护目录或工作簿 |
| 版本/Migration | COMPATIBLE HOTFIX | 源码 alpha.36/0035；运行仍 alpha.34/0034。无 Schema diff、无 0036，0035 未运行，TASK09/完整 alpha.36 未部署 |
| 备份/恢复 | PASS | dump 2,023,590 bytes/0600/root，SHA-256 `8facc469c6bbdf3d2dedce57ce2d8a740d58cd2d2f8cd6e85c714421d05c35b9`；3,050 entries，独立 0034 恢复与候选 API smoke 通过 |
| 部署/回滚 | PASS / WEB ONLY | Web `881c033dc97e...→cb6a5c1fae896...`；旧镜像回退 tag 保留。PostgreSQL/Worker/Caddy 完整 ID 不变，四服务 restart 0/OOM false，34/head 0034/0035 count 0 |
| 公网浏览器 | PASS / READ ONLY | engineering 在新 Origin 搜索 PCB/SENSOR/CONN/METAL 四码，各 1 条、IDs 533—536、实际名称/PCS；仅未保存选择后清除。A0/V1、状态、项目关系与发布说明清楚 |
| UAT 保护 | UNCHANGED | 项目 ACCEPTED/10，产品 ACTIVE+A0/DRAFT/样品，四物料 V3/ACTIVE/PCS/指纹不变；目标/全部 UAT BOM `0/0`，Planning `0`，无 BOM/Planning 写审计 |
| logout/no-store | PASS | 测试路由只允许 login/logout POST；本轮 2 LOGIN/2 LOGOUT，最终 engineering ACTIVE Session 0。直接重访、back/forward/refresh 均未恢复受保护页面，响应 no-store |
| 安全记录 | ACTION RECOMMENDED | root-only engineering 账号材料曾因本地分隔符错误只在授权工具输出中显示；未入 Git/文件/日志/外部系统，凭据未改。遵守本轮禁改密，建议可写试用前另行授权轮换 |
| 资源/清理 | PASS | 首次约 2.3 GiB available/198 MiB Swap/29 GiB；最终约 2.3 GiB/204 MiB/29 GiB，未触发门禁。测试/恢复库、临时容器、浏览器、Playwright 镜像、worktree/candidate tag/task cache 已清理，备份/部署/回退镜像保留 |
| engineering 试用 | READ-ONLY READY | 可恢复只读选择器试用；该 UAT Product Version 仍为 DRAFT，保存/发布 BOM 与 Planning 继续禁止。可写试用需单独发布授权并建议先轮换凭据 |

## SELFHOST-OPS-PUBLIC-IP-CUTOVER-07 公网 IP 与可信 HTTPS 入口切换

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | PUBLIC IP HTTPS CUTOVER COMPLETE | 项目负责人明确授权“切换”；当前唯一公网入口为 `https://43.135.148.43.nip.io:18888` |
| DNS/TLS | PASS / TRUSTED | 新名称解析到 `43.135.148.43`；Let's Encrypt `YE2` 证书 CN/SAN 精确匹配，有效期至 2026-10-28；旧主机名 SNI 已失败 |
| HTTP/HTTPS | PASS | 外部只读探针实际读取登录页；HTTPS 首页/health 200，HTTP 80 308 到新 HTTPS 18888，HSTS/nosniff/DENY/referrer/permissions 头保持，匿名 `/api/materials` 401 |
| 配置/回退 | PASS | root-only env 只改变 `ERP_DOMAIN`/`ERP_PUBLIC_ORIGIN` 且仍 0600；原配置 0600 副本保留，其他 env 内容安全比较一致 |
| 部署边界 | PASS / MINIMAL | 使用原镜像串行重建 Web/Caddy；Web `sha256:881c033dc97e...`、Caddy `sha256:4c6e91c6ed0...`。PostgreSQL/Worker ID/镜像/启动时间不变，无 build/pull/Migration/alpha.36 |
| 数据/Migration | PASS WITH CONCURRENT PRE-CUTOVER DELTA | 34/head 0034、核心 `536/7/7/6/6/316` 保持。切换前外部身份流程使 Session/Audit/Idempotency `103/1147/43→105/1152/44`，最晚 18:03:01Z，早于 Web 重建 18:03:29Z；切换后三类新增 0，本任务未调用身份/业务写接口 |
| 既有物料状态 | OBSERVED / OUT OF SCOPE | 533—536 已在本任务前的 13:45—13:48Z 成为 ACTIVE/version 3/有编码，当前 536 Material 全部 ACTIVE；本任务不调查、撤销、审核或改写该既有业务事实 |
| 自动验证 | PASS | request-origin+Identity unit `15/15`、基础 FileStorage `3/3`、lint `0 error / 8 个既有 warning`、1103 仓库文件凭据扫描及 diff/scope 检查通过 |
| 服务/Volume | PASS | PostgreSQL/Web healthy，Worker/Caddy running；四服务 restart 0/OOM false，Web 只绑定 127.0.0.1:3000，PostgreSQL 无宿主端口，四个受保护卷 metadata 不变 |
| 资源/清理 | PASS | 起点约 2.1 GiB/193 MiB/29 GiB/Load `0.24/0.28/0.17`；最终 `2,474,940 KiB`/`204,964 KiB`/30 GiB/`0.02/0.29/0.28`，60 秒 Swap -4 KiB、内核 OOM 0、Caddy error 0；临时测试容器已自动删除 |
| Git/外部边界 | PASS | 提交 `ops: record public IP cutover`，实际 SHA 以 Git log 为准；不提交 env/私钥/凭据/数据库正文/备份，未 push/PR、未修改安全组/systemd/Python/SQLite |

## SELFHOST-OPS-UAT-MATERIAL-REVIEW-BLOCKERS-03-RETRY 审核上下文、精确待办与退出缓存修复

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | MATERIAL REVIEW DECISION CONTEXT AND LOGOUT CACHE FIXED | 三项 blocker 已修复、部署并只读验收；完成后停止，不开始物料审核 |
| 审核详情 | PASS / HONEST | 完整名称、分类/单位/来源、创建/提交人和时间、V2/状态、SUBMIT 工程说明、编码状态、审核范围、批准/退回后果与工程 BOM 下一步可见；当前说明为空时明确“未保存”，不伪造外部字段 |
| Dashboard | PASS / 4 = 4 | operations 卡片“物料审核待办 4”链接原生队列；搜索 `042576` 后 total/列表为 4，非零时无“当前没有立即待办”；legacy 全局 DRAFT+PENDING_REVIEW 口径已标注 |
| 权限 | PASS / UNCHANGED | operations 增量仍仅 `material.review.queue/approve/reject`；正文编辑 403、无关角色 403，无身份/admin/审计/BOM 或其他业务写增量 |
| 退出缓存 | PASS / FAIL CLOSED | 双入口 POST logout 撤销 Session 并清 Cookie；实际 Chromium back/forward/refresh 保持登录页，受保护 DOM 0。实际 Chrome 因 no-store/Cookie 变化未复用 bfcache，真实 back_forward 与同浏览器 persisted pageshow 分支均通过；未禁用历史 |
| 自动测试 | PASS | 隔离 PG `4+10+2+7`；最终相关 unit/UI/handler/API 118 项，TASK09 14 项；typecheck、218 表 Schema consistency、lint 0 error、build、credentials、Python 三项和 diff check 通过 |
| 版本/Migration | COMPATIBLE HOTFIX | 源码 alpha.36/0035；运行 Web alpha.34/0034 hotfix `sha256:881c033dc97e...`。无 0036，0035 未运行，完整 alpha.36/标准化工作台未部署 |
| 备份/恢复 | PASS | root-only dump 2,019,961 bytes、SHA-256 `281e2597...972b`，3,065 entries/213 table-data；独立 0034 恢复的 migration/表/Material/User/Audit 和保护摘要一致，恢复库已删除 |
| 服务/回滚 | PASS | 只重建 Web；PostgreSQL/Worker/Caddy 容器 ID 不变，四服务 restart 0/OOM false，四卷创建事实不变。旧 Web 以 `rollback-review-blockers-03-20260730T114146Z` 保留 |
| 保护记录 | UNCHANGED | 533—536 均 PENDING_REVIEW/version 2/MANUAL/PCS/空编码；保护摘要前后 `51d81e45e03656033c4db7a16e0a8b96`，APPROVE/REJECT version/change/audit 和审核 POST 均为 0 |
| Session | CLEAN | 使用既有 operations 账号且未改密；最终 operations 有效 Session 0，临时浏览器资源已删除 |
| 资源/清理 | PASS | 起点约 2.4 GiB/163 MiB Swap/31 GiB；最终约 2.3 GiB/187 MiB/30 GiB/Load `0.21/0.45/0.68`，内核 OOM 0。测试/恢复库、容器、脚本、buildcheck 镜像和 worktree 已清理 |
| Git | PASS | 起点 `35aa8f6`；功能 `c14505d`、`8d8a494`、`a4de64f`，验收提交消息 `ops: accept material review blocker fixes`。未改写 `9d21d39`/`35aa8f6`，未 push/PR/amend/rebase/reset |

## SELFHOST-LANDING-TASK09 供应商导入 13 列标准整理工作台

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / SOURCE ONLY / NOT DEPLOYED | `SUPPLIER IMPORT 13-COLUMN STANDARDIZATION WORKBENCH IMPLEMENTED — SOURCE ONLY, NOT DEPLOYED` |
| 用户路径 | PASS | `/materials/imports` 明确为供应商物料导入；解析结构准备完成后 `AWAITING_MAPPING` 默认进入“标准整理”，仍可进入来源表头、高级 Mapping、Normalization 和 Review |
| 13 列规则 | PASS / FAIL CLOSED | `CYD-MATERIAL-13C-v1` 顺序固定；模板精确命中直通，其他来源只用明确表头/Mapping/标题/主替证据；未知留空，供应商料号不冒充内部型号，公式/错误不执行 |
| 数量/替代 | PASS | 字符串+BigInt 精确计算需求与购买数量；购买量最低 0。只有显式替代状态才折叠，来源行号和稳定问题代码保留在预览 DTO |
| API/安全 | PASS | owner/`material.import.read_any`、repeatable-read read-only、5,000 行/32 MiB、分页、`private, no-store`、稳定中文错误/X-Request-ID；CSV 有 UTF-8 BOM、RFC 4180、公式注入保护和成功导出审计 |
| 自动测试 | PASS | Standardization `7+4+3=14`；Mapping 5、Normalization 12、Review 10、Adaptive 5、FileStorage 3；standardization/governance typecheck 通过 |
| 静态/本地基线 | PASS | lint `0 error / 8 个既有 warning`；credentials 1,096 文件通过；Python 临时 SQLite self-test/smoke/go-live 通过；diff check 通过 |
| 版本/Migration | SOURCE ONLY | 源码 alpha.36/0035；运行 Web/Worker/PostgreSQL 仍 alpha.34/0034。无 Schema/Migration 增删改或应用，无 build/restart/deploy |
| 数据边界 | UNCHANGED | 未读取新业务表格正文、未修改 `shujvbiao/`、未写常驻 PostgreSQL/SQLite/D1、未创建 Draft/ACTIVE/编码/替代关系；没有跨文件/跨批合并 |
| 资源/清理 | PASS | 起点约 2.1 GiB available、98 MiB Swap、31 GiB 根盘、Load `0.08/0.15/0.13`；最终 `2,458,736 KiB` available、`167,948 KiB` Swap、31 GiB、Load `1.36/0.98/0.68`。四服务 restart 0/OOM false、内核 OOM 0；一次最多一个 1 GiB/1 CPU 临时容器，任务容器和临时 SQLite 已清理，四个受保护卷存在且未删除 |
| Git/外部边界 | PASS | 独立提交 `feat: add supplier material standardization workbench`，实际 SHA 以 Git log 为准；未 push/PR、未部署或外发业务数据 |

## SELFHOST-LANDING-TASK08 大批量物料分批与跨对话流程

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / DOCS-ONLY PROCESS DESIGNED | `BULK MATERIAL STANDARDIZATION PROCESS DESIGNED — GENERIC RUNNER NOT IMPLEMENTED` |
| 模板/规则 | FROZEN V1 | `CYD-MATERIAL-13C-v1` 绑定 `moban.xlsx` SHA 与 13 列；`CYD-MATERIAL-NORMALIZATION-v1`。变化必须新版本，不覆盖旧结果 |
| 批次边界 | DEFINED | `CYD-MAT-YYYYMMDD-NNN/Rxxx`；默认最多 10 文件、5,000 候选行、100 MiB，异常/超限文件独立批次 |
| 来源档案 | FAIL CLOSED | 结构指纹命中已批准档案才复用；未知布局进入 `PROFILE_PENDING`，文件名相似不能替代结构证据 |
| 状态/恢复 | PASS | 私有总索引+batch-card+manifest+决定日志；每批只有一个 `checkpoint.next_action`，新对话不依赖旧聊天 |
| 审核/汇总 | HUMAN GATED | Codex 最高到 `REVIEW_REQUIRED`；项目负责人批准后才进批准汇总。临时汇总禁止入库，批准汇总仍不等于主数据去重/编码完成 |
| 示例/决策 | PASS | SOP、3 份合法 JSON 示例、README 入口和 D-083 完成；实际业务实例 root-only，不进入 Git |
| 自动验证 | PASS | JSON 3/3、文档一致性、Python self-test/smoke/临时 go-live、Node 3/3、lint 0 error、credentials 1,083 文件和 diff/scope 检查通过 |
| 数据/运行边界 | UNCHANGED | 未读取新业务文件、修改 TASK07 输出、实现通用执行器、连接数据库、运行 Migration/build/restart/deploy；四服务未重建、restart 0/OOM false |
| 资源/清理 | PASS | 检查时约 2.1 GiB available、Swap 98 MiB、根盘 31 GiB、Load `0.06/0.11/0.15`；最终约 2.0 GiB/98 MiB/31 GiB/`0.04/0.11/0.15`。临时 SQLite 和测试容器已清理 |
| Git | PASS | 只含流程、无业务数据 JSON 示例和脱敏治理文档；未 push/PR |

## SELFHOST-OPS-UAT-MATERIAL-REVIEW-FIX-02 operations 人工物料审核队列修复

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | OPERATIONS MATERIAL REVIEW QUEUE FIXED — UAT APPROVAL NOT EXECUTED | 精确权限修复、隔离回归、备份恢复、alpha.34/0034 hotfix、部署健康和 operations Chromium 只读验收通过；未执行 UAT 审核 |
| 权限差异 | PASS / EXACT | operations 仅新增 `material.review.queue/approve/reject`；明确没有 `material.draft.edit_any`、身份/admin、`system.audit.read`、工程正文代编辑或其他业务写增量 |
| 服务端边界 | PASS / FAIL CLOSED | 跨创建人 PENDING_REVIEW 队列和详情可见；engineering 创建人自审拒绝，无关角色 403 中文提示。批准/退回复用稳定编码、必填原因、幂等正文冲突、expected version/CAS、并发唯一成功、事务回滚和审计 |
| UI/口径 | PASS | 队列 total/筛选/列表/详情/按钮同口径；legacy 清洗入口明确退役并引导原生审核/导入；Dashboard 显式标为全局 DRAFT+PENDING_REVIEW |
| 自动测试 | PASS | UI/Identity/Dashboard 66 项；适用非数据库回归 275 项；隔离 PostgreSQL 52 项；typecheck、Schema consistency、lint 0 error、build、credentials、diff check 和 Python 三项通过 |
| 版本/Migration | UNCHANGED | 源码 alpha.35/0035；运行 Web alpha.34 hotfix，PostgreSQL/Worker alpha.34/0034。无 Migration 增删改或运行；0035 SHA-256 `d64ec733...9714` |
| 备份/恢复 | PASS | root-only dump 2,013,262 bytes、SHA-256 `afe2cc5...e15`；pg_restore list 3,050 entries/426 table entries/213 table-data，独立恢复关键计数和受保护记录摘要一致，恢复库已删除 |
| 兼容 hotfix | PASS / DEPLOYED | alpha.34 基线叠加当前已有 Origin/CSRF/logout 与本任务权限/UI 最小差异，镜像 `sha256:f31199de3b8...`；0034 candidate smoke 通过。只重建 Web，旧 `sha256:273aa687e741...` 以回滚 tag 保留 |
| 浏览器只读 | PASS | operations 搜索 `042576` 得 4/4：533—536 全部可见、详情可开、批准/退回按钮存在、正文编辑控件 0；未点击保护动作，logout 成功，旧 Session `SESSION_REVOKED` |
| 保护记录 | UNCHANGED | 533—536 均 PENDING_REVIEW/version 2(V2)/MANUAL/PCS/空正式编码；material version/change/audit 的 APPROVE/REJECT 计数全部 0 |
| 服务/Volume | PASS | PostgreSQL/Web healthy，Worker/Caddy running；四服务 restart 0/OOM false，Web 只绑定 127.0.0.1:3000，四个受保护卷 driver/created metadata 不变 |
| 安全事件 | ACTION RECOMMENDED | 凭据材料和一个 Session 摘要曾因工具输出脱敏/约束错误只在本次授权会话中显露；未进入仓库、文件、服务日志或外部系统，凭据文件未改，任务 Session 已撤销。建议独立试用前另行轮换 operations UAT 凭据 |
| 资源/清理 | PASS | 起点约 2.3 GiB available/47 MiB Swap/33 GiB 根盘；最终 2,307,512 KiB available、66,456 KiB Swap used、31 GiB 根盘、Load `0.16/0.42/0.47`，112 秒 Swap 增长 0，内核 OOM 0。测试/恢复库、临时容器、runner/worktree 已清理；备份与回滚镜像按设计保留 |
| Git | PASS | 功能 `54f6480` Parent `78701d16`；验收提交 `ops: accept operations material review queue fix` 以功能提交为 Parent，SHA 以 Git log 为准。未 push/PR/amend/rebase/reset/stash/restore |

## SELFHOST-LANDING-TASK07 按原始模板逐表标准化并汇总

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / OFFLINE WORKBOOK / REVIEW REQUIRED | `OFFLINE STANDARDIZED BOM WORKBOOK CREATED — REVIEW REQUIRED`；工作簿供人工审阅和后续独立数据库导入，不代表已入库或生效 |
| 模板合同 | PASS | `moban.xlsx` 第一张 `原BOM` 为真实原始数据、第二张 `Sheet1` 为目标；53/53 主料组规格证据、上下文和用量匹配，40 条备选折叠、2 条板件本体按模板排除 |
| 标准明细 | 591 | 1928C 22、A118 233、A200 BOM 53、A200 物料清单 57、A200 注意事项 0、G20-G15G 56、J587 46、V700 124；8 张逐来源页后合并到一张总表 |
| 追溯/替代 | PASS | 来源追溯 591/591；150 行带替代料。A118 一个 42 行完全重复区段只保留一次并留异常证据，不做跨项目/板型模糊去重 |
| 待确认 | 94 | 用量待确认 57、板型待确认 21、板件本体排除 9、A200 模板/旧版差异 4、说明档 1、J587 版本冲突 1、A118 重复区段 1 |
| 工作簿安全 | PASS | 2,364 个受控需求/购买公式；ZIP/openpyxl/13 列合同通过，宏/外链/电话样式/敏感连接或凭据 0；输出 197,821 bytes、0600、SHA `aeea74c2...1c91` |
| 自动验证 | PASS | 专项 7/7、既有回归 3/3、py_compile、Python self-test/smoke/临时 go-live、Node 3/3、lint 0 error、credentials 1,076 文件通过 |
| 数据/运行边界 | UNCHANGED | 未连接或写 PostgreSQL/SQLite/D1，未运行 Migration/build/restart/deploy；四服务未重建、restart 0/OOM false，四卷保持 |
| 资源/清理 | PASS | 起点约 2.4 GiB available、Swap 47 MiB、根盘 33 GiB、Load `0.36/0.24/0.17`；最终约 2.3 GiB/47 MiB/33 GiB/`0.34/0.69/0.56`。临时 SQLite 已清理，任务测试容器自动删除，内核 OOM 0 |
| Git/下载 | PASS | Git 只含通用工具、合成测试和脱敏文档；业务工作簿未提交。GPT 下载副本与工作文件 SHA 一致，未 push/PR |

## SELFHOST-LANDING-TASK06 按整理后模板生成内部物料库

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / OFFLINE EXPORT / REVIEW REQUIRED | `OFFLINE INTERNAL MATERIAL LIBRARY CREATED — REVIEW REQUIRED`；结果是离线审核工作簿，不是数据库入库或生产生效 |
| 模板合同 | PASS | `moban.xlsx` 第一张 `原BOM` 仅对照，第二张 `Sheet1` 为唯一标准；首行 13 列逐字匹配，后续分段错位已归一 |
| 输入完整性 | PASS / UNCHANGED | 8 份来源/13 Sheet/1,113 行与 LANDING-TASK02 manifest 完全一致；源文件和模板前后 filename/size/inode/mode/uid/gid/mtime/SHA 无变化 |
| 内部物料库 | 724 / REVIEW REQUIRED | 532 个既有正式编码、147 个来源隔离候选、45 个模板隔离候选；正式编码唯一，候选正式编码为空，不做模糊归并或新编码 |
| 标准明细/追溯 | PASS | 997 条标准BOM明细，项目/板型/内部型号/规格空值 0；1,006 条来源映射覆盖 953 条非归档来源+53 条模板。未知用量留空，110 个未知内部型号明确“待确认” |
| 待确认 | 484 | 438 条来源分类问题、45 条模板严格关联问题、1 条文件名/表内标题版本冲突；物料身份 147、BOM 数量/结构 291 |
| 工作簿安全 | PASS | 1,994 个受控需求/购买公式；宏/外链/电话样式/敏感连接或凭据均 0，ZIP/openpyxl 重开通过；输出 345,691 bytes、0600、SHA `01d0239a...5fa0` |
| 自动验证 | PASS | 专项+classifier 7/7、py_compile、Python self-test/smoke/临时 go-live、Node 3/3、lint 0 error/8 既有 warning、最终 credentials 1,070 文件、diff/scope 检查通过 |
| 数据/运行边界 | UNCHANGED | 未连接 PostgreSQL/SQLite/D1，未运行 Migration、build/restart/deploy；四服务最终 healthy/healthy/running/running，restart 0/OOM false，四卷保持 |
| 资源/清理 | PASS | 起点/最终 available 约 2.4 GiB、Swap 47 MiB、根盘 33 GiB；最终 Load `0.79/0.67/0.50`、内核 OOM 0。探查进程、Node 容器和临时 SQLite 目录无残留 |
| Git/保密 | PASS | `shujvbiao/` 已忽略；Git 只含通用离线工具、合成测试和脱敏文档，不含源表、结果表、逐行业务报告或凭据；未 push/PR |

## SELFHOST-OPS-UAT-BLOCKER-FIX 用户创建来源校验与退出登录修复

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | ADMIN IDENTITY CSRF AND LOGOUT BLOCKERS FIXED IN PARALLEL ENVIRONMENT | 完成聚焦诊断、修复、隔离回归、备份、alpha.34 Web 更新和真实 Chromium 验收；停止，不开始角色业务试用 |
| 根因/修复 | PASS | 受控浏览器/SSH 转发使用动态回环 Origin，而运行面原只允许公网单值 HTTPS；两个前端又吞掉 logout 403 并乐观清状态。现仅显式 UAT deployment class 可用双端严格 loopback，两个工作台复用失败可见的安全 POST logout |
| 安全边界 | PASS / FAIL CLOSED | 生产类别仍只接受显式可信 HTTPS Origin；未知外部 Origin、错误/缺失 CSRF、单边回环和非法配置均拒绝。不信任 Host/Forwarded/X-Forwarded，不使用通配/CORS `*`/GET logout，不降低 Secure/HttpOnly/SameSite/Path、Session、权限、密码、幂等或审计 |
| 自动测试 | PASS | 来源/身份/unit/UI `24/24`；隔离 PostgreSQL `10/10`；alpha.34 candidate build；Identity API smoke 初次/重启均通过。测试数据库、临时容器和 runner 已删除，未写主库 |
| 浏览器创建用户 | PASS / DISABLED | 唯一 `uat_fixcheck_manager_5317094938` 以“经营负责人”从网页创建、列表可见并有 `USER_CREATED/success`；未做业务试用，最终通过页面停用且有 `USER_STATUS_CHANGED/success` |
| 两个退出入口 | PASS | 经营与兼容工作台均 logout 200、回登录页、旧 Session 为 `REVOKED`；两次之间和之后重新登录成功，匿名重复 logout 200，无 500；设置/清理 Cookie 属性对称 |
| Session/审计 | PASS WITH RECORDED HARNESS ARTIFACT | 部署后审计 908—920 全部成功；两个目标退出及完整复验的旧 Session 均撤销。首次脚本在停用后刷新检查提前结束，遗留一个丢失令牌、等待 8 小时 TTL 的会话，按禁令未直接 SQL 删除；最终 Session/有效 `14/5`、Audit `920` |
| 版本/Migration | UNCHANGED | 源码 alpha.35/0035；运行 Web alpha.34 hotfix、PostgreSQL/Worker alpha.34/0034。本任务无结构变化，不新增、修改或运行 Migration；业务 `532/6/6/316` 保持 |
| 部署/回滚 | PASS / READY | 只重建 Web，镜像 `sha256:273aa687e741...`；旧 Web `sha256:f9c34a11b900...` 以任务回滚 tag 保留。PostgreSQL/Worker/Caddy 容器未重建，四卷创建时间不变 |
| 备份/清理 | PASS | pre-deploy custom dump 1,985,741 bytes、SHA-256 `d8951686192b500bee1770be258c8ee3eddb5e8d8509c0664cb6ca7b64714c79`，list 与新库恢复关键计数一致；备份/root-only env 副本保留。恢复库、测试库、临时容器、浏览器/测试脚本、端口和 build worktree 已清理，未 prune |
| 最终资源 | PASS | available 2.3 GiB、Swap 3.2 MiB、根盘可用 34 GiB、Load `0.01/0.21/0.30`；60 秒 Swap `3,252→3,252 KiB`，增长 0。四服务 restart 0/OOM false，内核 OOM 0；PostgreSQL/Web healthy、Worker/Caddy running |
| Git | PASS | 代码提交 `dfa30bf`，Parent `5fc1266b`；文档/验收记录以代码提交为 Parent 独立提交，实际 SHA 以 Git log 为准。未 push/PR/amend/rebase/reset，最终 tracked clean，受保护未跟踪 `shujvbiao/` 保留 |

## SELFHOST-OPS-ADMIN2-FIRST-CHANGE-WAIVER-06 单账号首次改密豁免

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / SINGLE-ACCOUNT WAIVER APPLIED | 项目负责人明确要求 `admin2` 无需首次改密；账号已可直接使用 |
| 账号状态 | PASS | active admin 保持，must-change `true→false`、version `2→3`；密码二次指纹不变，未读取/重置/输出密码或摘要 |
| 事务/审计 | PASS / IDEMPOTENT | serializable 事务、advisory lock、行锁、预期 version/CAS；新增唯一 `USER_FIRST_PASSWORD_CHANGE_WAIVED/success` Identity Audit，重放为 no-op |
| 会话/全局策略 | UNCHANGED | Session/有效 `3/1`、`admin2` 有效 Session 1；未撤销会话。D-045 新建/重置用户强制首次改密继续生效，无通用豁免 API |
| 数据/Migration | UNCHANGED | Audit/Identity `887/15→888/16`，幂等 3；34/head 0034、manifest `b2ff69f7...13b8b`、Material/Product/BOM/Line `532/6/6/316` 不变 |
| 服务/资源 | PASS | Identity unit 8/8；本机/TLS health 与匿名 Session 200。四服务容器未重建、restart 0/OOM false；约 2.3 GiB available、142 MiB Swap、34 GiB 根盘、内核 OOM 0 |
| 清理/Git | PASS | task-only SQL 已删除，无临时容器/数据库，四卷保留。仅脱敏文档，不含密码/摘要/Token/Cookie/凭据/业务数据；未 build/restart/deploy、push/PR 或操作 Python/Sites/D1 |

## SELFHOST-OPS-TRUSTED-ORIGIN-05 公网 HTTPS 请求来源校验修复

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / DEPLOYED / USER RETRY REQUIRED | 合法公网 Origin 已不再被 Caddy 内部 HTTP 转发误判；`admin2` 已登录，仍须本人重新提交首次改密 |
| 根因/修复 | PASS | 旧逻辑比较浏览器 HTTPS `Origin` 与代理后内部 HTTP `Request.url`。现改为规范化、单值 `ERP_PUBLIC_ORIGIN`；配置存在时仅允许精确协议/主机/端口，不接受通配、路径、凭据或任意转发头 |
| CSRF/身份边界 | PASS / FAIL CLOSED | 身份写仍强制 Origin；Cookie/Header Token 仍常量时间双提交。错误、缺失、HTTP 内部或错误端口 Origin 与错误 Token 均拒绝；Session、must-change、幂等、限流、权限和审计未放宽 |
| 自动验证 | PASS | 来源+身份 unit `11/11`、隔离 PostgreSQL Identity `9/9`、部署 UI 合同 `4/4`、alpha.34 hotfix build 与候选 health 200；公网合法 Origin 无凭据探针返回 `AUTH_REQUIRED/401`，不再返回来源校验失败 |
| 运行版本 | PASS / MINIMAL HOTFIX | 最终 Web 基于 `0.1.0-alpha.34` 基线，仅叠加 Origin 修复，镜像 `sha256:f9c34a11b900...`。首个 alpha.35 候选镜像在最终验收前被发现超出最小边界，未应用 0035、无治理请求/写入，随后由 alpha.34 hotfix 替换并删除 |
| 数据/Migration | UNCHANGED | 34/head 0034，checksum manifest `b2ff69f7...13b8b`；用户/admin `2/2`、Session/有效 `3/1`、幂等 3、Material/Product/BOM/Line `532/6/6/316`。两次公网无凭据验收使 Audit/Identity `885/13→887/15`，均为合法 `AUTH_REQUIRED` |
| 服务/回滚 | PASS / READY | 仅重建 Web；PostgreSQL/Worker/Caddy 容器 ID/启动时间不变。内网/TLS health 200，四服务 restart 0/OOM false。旧 Web 镜像保留为 `origin05-predeploy-alpha34-20260729`，旧 root-only env 保留在任务专用 0600 回滚副本 |
| 资源/清理 | PASS | 起点约 2.3 GiB available/126—127 MiB Swap/35 GiB/低 Load；最终约 2.2 GiB/142 MiB/34 GiB/`1.08/0.48/0.29`。临时数据库、runner、容器、候选镜像和 worktree 已清理，四个 ERP 卷保留；2.789 GB Build Cache 未 prune |
| Git/外部边界 | PASS | 只提交代码、测试和脱敏文档；不含密码、摘要、Cookie、Token、env、备份或真实业务数据。未 push/PR，未发布历史 Sites/D1，未操作 Python 服务 |

## SELFHOST-OPS-ADMIN-ACCOUNT-04 新增第二管理员账号

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / FIRST-LOGIN CHANGE REQUIRED | `admin2` 已是 active admin、version 2、`must_change_password=true`，尚未登录 |
| 密码/权限 | PASS | 最终 PBKDF2-SHA256/310,000 次新随机盐摘要与临时密码验证通过；admin `*`/用户管理权限映射通过 |
| 安全门禁 | PASS WITH REMEDIATION | 首次弱密码被 `PASSWORD_WEAK` 拒绝；创建时旧摘要误入工具输出后立即由正式 reset 生成新盐并失效，事件和补救完整记录 |
| 身份 delta | PASS | 用户/admin `1/1→2/2`；Session/有效 `2/0→2/0`；Audit/Identity `877/5→881/9`；幂等 `0→3`；限流 attempt/new/rejected `0/0/0→3/3/0` |
| 业务/Migration | UNCHANGED | 34/head 0034，Material/Product/BOM/Line `532/6/6/316`；现有管理员、Schema、角色映射、四卷不变 |
| 服务/测试 | PASS | 本机/TLS health 200、匿名用户 API 401；PostgreSQL/Web/Worker/Caddy healthy/healthy/running/running，restart 0/OOM false；Identity unit 8/8、部署 Web UI 4/4 |
| 资源/清理 | PASS | 起点 2.3 GiB/126 MiB/35 GiB/Load `0.05/0.12/0.14`，最终 2.3 GiB/126 MiB/35 GiB/`0.10/0.14/0.13`；runner/临时目录全部删除 |
| Git/部署 | PASS | 仅脱敏文档；无密码、摘要、Token、凭据或业务数据。未 build/restart/Migration/deploy、push/PR 或操作 Python 服务 |

## SELFHOST-LANDING-TASK05 PostgreSQL 业务数据重置与 V9 主数据重导入

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / STAGING ONLY | `STAGING COMPLETE — MAIN DATABASE NOT MODIFIED` |
| 输入完整性 | PASS | 单个 XLSX 为 25,014 bytes、0600、SHA `cfd1e290...49df`；1 Sheet/197 行/12 列、公式/外链 0，解析前后 inode/size/mode/mtime/SHA 不变 |
| 编码/重复/追踪 | PASS | 197 个 ERP 编码有效、唯一、连续 `00001`—`00197`；精确身份重复组 0，来源追踪 197/197；使用次数合计 519 仅作追踪 |
| 单位/BOM 门禁 | REVIEW REQUIRED | 显式单位 0、缺单位 197；无产品编码/版本、BOM 版本/行号/数量/位号/单位，故 Material ready/Product/BOM/Line 均 0，不猜测 PCS 或 BOM 数量 |
| staging/幂等 | PASS | 0034 恢复库首次 staged 197、重放新增 0；唯一 code/source_ref/row digest 197，`NEEDS_REVIEW=197`，`ELIGIBLE=0`；不写 public |
| 拟删除/主库 | NOT EXECUTED / UNCHANGED | 213 表只读清单计划删除 5,556 条旧业务/导入记录；因无 ELIGIBLE 行没有执行。主库前后 table-count manifest 均为 `f59469...c792`，差异 0 |
| pre-clean 备份 | PASS | `bom-v9-preclean-20260728T235231Z.dump` 1,982,039 bytes、SHA `b21b484b...16e2`；list 3,065 项，新空恢复 213 表逐项一致 |
| post-import 备份 | N/A | 主库未清理、未导入，因此没有创建或伪造 post-import dump |
| 系统/健康 | PASS | 34 migrations/checksum、唯一 login-ready admin、setup、2 Session/4 Identity audit 不变；有效 Session 1；PostgreSQL/Web/Caddy healthy，Worker running，匿名业务 API 401 |
| 资源/清理 | PASS | 起点 available `2,351,184 KiB`、Swap `130,592 KiB`、Load `0.06/0.09/0.11`、根盘 35 GiB；提交后约 2.2 GiB/126 MiB/`0.08/0.14/0.14`/35 GiB。60 秒 Swap 增长 0，restart 0/OOM false；staging 库/runner/cache 删除，四卷保留 |
| Git/保密 | PASS | Git 仅 staging 工具、4 项合成单测与脱敏文档；原 XLSX、逐行 CSV/JSON、dump、凭据、真实 DB 内容均未提交。未 push/PR/deploy |

## SELFHOST-PHASE6-TASK01 BOM 物料规格标准化与主数据治理

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / ISOLATED NON-PRODUCTION VERIFIED | 完成提交 `feat: add BOM material governance pipeline`，实际 SHA 以 Git log 为准；不是并行运行面或生产部署验收 |
| 版本/运行边界 | PASS / SOURCE ONLY | 源码 `0.1.0-alpha.35`/`0035`；当前 18888 Web/Worker/PostgreSQL/Caddy 仍为 alpha.34/0034。0035 未应用常驻库，未 build/restart/deploy |
| Pipeline/规则 | PASS | 复用已发布 Parser/Mapping/Normalization；版本化 `bom-material-governance-v1` 完成分类、精确十进制规格解析、标准规格、严格身份分组、候选/异常/替代建议；缺项或冲突 fail closed |
| 验收样例 | PASS | `0201WMJ0000TCE` 与 `0201,0R,±5%` 在明示厂商规则+0201 默认功率下同组；`0201 1uF` 与 `0201 100pF` 不同组；型号敏感类的不同 MPN/来源只形成待审替代候选；追溯为 `material <- group <- row <- batch/BOM` |
| 数据库 | PASS / EXPAND ONLY | 唯一 0035 新增 9 张 governance 表、Mapping 自适应结构证据 6 列、metadata v2 4 属性/6 分类节点/更严精度和叶子绑定；外键、CHECK、唯一/查询索引、事实不可变与服务写入守卫生效，0001—0034 未改 |
| API/安全 | PASS | latest/list/create run，run/group/rows，5 类报告和 `BIND_EXISTING/CREATE_DRAFT/EXCLUDE`；Session/capability、owner/read_any、CSRF、Idempotency-Key+digest、CAS、限流、事务审计、稳定中文错误、X-Request-ID/no-store 通过 |
| 全局身份/并发 | PASS / FAIL CLOSED | 治理建稿、普通/治理 Draft 批准共享 advisory identity lock，`CREATED_DRAFT` 保留身份；绑定时 live revalidation 可收敛快照后新 ACTIVE。旧 Review 对受治理类 CREATE/BIND 旁路被禁止；无法安全重建的旧正式身份阻断新建稿/批准 |
| Migration 验证 | PASS | contract `5/5`、0034→0035 upgrade `5/5`；另在空隔离库串行应用 0001—0035 全量成功，覆盖重复执行、失败回滚、约束和升级后汇总 |
| 业务/回归测试 | PASS | Governance unit `61/61`、PG `16/16`；Material PG `7/7`、Normalization PG `5/5`、Import Worker PG `1/1`、Review PG `4/4`；Material unit/UI `63/63`，`npm test` `3/3`，typecheck 通过，lint `0 error / 8 既有 warning`，credentials 最终 1,050 文件通过 |
| 已知限制 | ENFORCED / FOLLOW-UP | 旧 ACTIVE/FROZEN/INACTIVE 兼容冲突只检测和阻断，无 ACTIVE 属性修订流程；`MECH/OTHER` 为 `UNSUPPORTED`；旧治理 Draft 不支持跨规则版本；替代项不自动生效，无 UI/真实回填/生产迁移/部署 |
| 数据/Git 边界 | PASS WITH RECORDED DEVIATION | 治理实现/测试未打开、解析或回填真实 BOM，未改常驻业务计数。`shujvbiao/` 未修改、暂存或提交；但凭据扫描器原默认 `git ls-files --others` 曾在断网只读容器中对其路径发起读取，未输出/传输内容。偏差已记录，扫描器已在打开内容前排除该受保护未跟踪目录并复扫通过；未 push/PR |
| 资源/清理 | PASS | 起点 available 约 2.1 GiB、Swap 131—132 MiB、根盘 35 GiB；最终 2.2 GiB/135 MiB/35 GiB，Load `0.21/0.76/0.69`。四容器 running，restart 0/OOM false；测试时只有一个临时容器。`material_governance_task01_test`/`material_governance_upgrade_test` 及任务容器已删除，四个受保护卷均存在且未删除 |

## SELFHOST-LANDING-TASK04 兼容业务台供应商导入入口收敛

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / DEPLOYED | 功能提交 `cda8c7e` 已经 2026-07-29 单独授权部署到当前 18888 Web；公网兼容页已不再显示旧 CSV-only 表单 |
| 入口/缓存 | PASS / FOLLOW-UP RESOLVED | “供应商导入”直达 `/materials/imports/new`；兼容页明确 CSV/XLS/XLSX。LANDING-TASK04 部署时响应含 `private, no-store` 但并列框架 `public`；该矛盾头已由 MATERIAL-REVIEW-BLOCKERS-03-RETRY 的动态 legacy route 精确消除 |
| 退役保护 | PASS | 删除 CSV 文本、`file.text()` 和旧 API 调用；`sample-import`/`import`/`import-file` 继续返回 410，不恢复一步直写 |
| 自动/镜像/在线验证 | PASS | Dashboard UI/Unit/API coverage 12/12、Material Import UI 102/102、Parser 38/38（合计 152/152）、build 与新镜像静态合同通过。公网 `index.html`/`app.js` SHA 精确匹配源码，旧控件/API 标记消失；未做 Excel→PG E2E |
| 数据/运行边界 | PASS | 版本仍 alpha.34、Migration 仍 0034；Material/Product/Product Version/BOM/BOM Version/Line 仍 `532/6/6/6/6/316`，Inventory/PO/Receipt/WO/Shipment/Finance 仍 0。仅以 `--no-deps` 重建 Web；PostgreSQL/Worker/Caddy 容器未更换，未运行 Migration 或写数据 |
| 服务/回滚 | PASS / READY | 新 Web 镜像 `sha256:2db38e312586...` 且 healthy；旧镜像 `sha256:1c07cb1b5708...` 保留为 `task04-predeploy-20260729`。公网/回环 health 200，匿名 `/api/materials` 401，旧 Python 仍在 `127.0.0.1:18889` |
| 资源/清理 | PASS | 起点 available 2.1 GiB/Swap 114 MiB/根盘 36 GiB，最终 2.2 GiB/123 MiB/35 GiB；build 后 60 秒 Swap +100 KiB，部署后 -24 KiB。四容器 restart 0/OOM false，内核 OOM 0；临时验证容器无残留，Build Cache 1.401 GB 与回滚镜像有意保留 |
| 后续风险 | SEPARATE TASK REQUIRED | 列表实际 `{items,next_cursor}` 与页面期望 `{data,total,page}` 失配且 cursor 被忽略；解析失败终态、创建/上传幂等及版本/SHA/重复/安全契约、Excel→PG E2E 与冗余缓存头清理也未验收 |

## SELFHOST-LANDING-TASK03 18888 公网 HTTPS 入口

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PUBLIC HTTPS ACTIVE | `https://43.135.157.211.nip.io:18888` 已可访问；用户明确授权公网入口并指定 `18888` |
| TLS/跳转 | PASS | Let's Encrypt 可信证书主机名/链校验通过；80 返回 308 到 HTTPS 18888；HSTS、nosniff、DENY frame、Referrer/Permissions Policy 生效 |
| 网络隔离 | PASS | 公网仅 80/18888 进入 Caddy；Web 继续 `127.0.0.1:3000`，PostgreSQL 无宿主端口；旧 Python active/enabled 且仅 `127.0.0.1:18889` |
| 身份安全 | PASS | `ERP_ENV=production`，setup token 已轮换且未记录；唯一 admin 启用、must-change 0、切换前 active session 0；生产 Cookie 单元测试 8/8，匿名 `/api/materials` 返回 401 |
| 数据不变 | PASS | 34 migrations；ACTIVE Material 532、Product/Version 6/6、DRAFT BOM/Version 6/6、BOM Line 316；Inventory/PO/Receipt/WO/Shipment/Finance 0 |
| 服务/资源 | PASS | PostgreSQL/Web/Worker/Caddy 为 healthy/healthy/running/running；四服务 restart 0/OOM false，Python NRestarts 0；60 秒 Swap 增长 0，最终 available 2.2 GiB、Swap 114 MiB、磁盘可用 36 GiB |
| 持久资源 | PASS | 原四个 ERP 卷不变；新增 Caddy data/config 两卷用于证书自动续期。post-import dump、alpha.34 灾备包和 root-only 导入报告均保留 |
| 外部边界 | PASS / FOLLOW-UP | DNS 名称只提供解析、不代理 ERP 流量；未部署 Sites/D1、未上传真实数据、未修改云安全组。建议后续用公司自有域名替换临时解析域名，并完成 post-import 备份异机复制 |
| 回退 | READY | 停止 Caddy 后可把 `/etc/systemd/system/chenyida-erp.service` 恢复到 `0.0.0.0:18888` 并重启；数据库和四个 ERP 卷无需变化 |

## SELFHOST-LANDING-TASK02 真实 BOM/物料隔离试导入

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARTIAL IMPORT | `PARTIAL REAL BOM IMPORT COMPLETED — REVIEW REQUIRED` |
| 输入门禁 | PASS | 8 个文件的数量、名称、SHA-256 全匹配；13 Sheet 离线只读解析，原件 inode/size/mode/mtime/SHA 不变 |
| 脱敏分类 | REVIEW REQUIRED | 1,113 条：ELIGIBLE 515、NEEDS_REVIEW 438、ARCHIVE_ONLY 160、BLOCKED 0；物料级 806 条可映射、147 条隔离，BOM 级 488 条可映射、291 条隔离 |
| A200 | FAIL CLOSED | 注意事项只归档；BOM 与物料清单没有严格稳定身份交集，不模糊合并、不重复物化 |
| pre-import 备份 | PASS | `real-bom-preimport-20260728T143430Z.dump` custom format、SHA、list 和新空库恢复通过；恢复后 34 migrations、业务 0 |
| staging | PASS / IDEMPOTENT | clean-0034 首次导入 532 Material/6 Product/6 BOM/316 Line；同批重放新增 0，孤儿/重复编码/非法数量单位/交易副作用 0 |
| 模型门禁 | PASS / MIGRATION PROVENANCE | 复用既有 Material mapping 与受控 migration_tool 来源分类/target link；1,318 条来源链接，未新增业务 Migration，0034 不变 |
| 主库前后 | CONTROLLED WRITE | 0→532 Material、0→6 Product/Version、0→6 DRAFT BOM/Version、0→316 Line；交易事实保持 0；同批重放新增 0 |
| post-import | PASS / OFFHOST PENDING | `real-bom-postimport-20260728T143621Z.dump` list/第二空库恢复通过，主库/恢复库关键摘要一致；仍需用户异机复制 |
| 保密/Git | PASS | 真实正文、逐行 CSV/JSON、dump 均未进入 Git；详细结果只在仓库外 root-only 目录 |
| 清理 | PASS | staging/恢复库/容器内 dump/bytecode 已删除；pre-import 备份、alpha.34 灾备包、resource-guard 和四卷保留 |
| 资源 | PASS | 最终 available 2.3 GiB、Swap 129 MiB、根盘 36 GiB；60 秒 Swap `132452→132452 KiB`；三容器 restart 0/OOM false，Python PID `13737`/NRestarts 0 |

## SELFHOST-LANDING-TASK01 alpha.34 灾备封存

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / READY_FOR_OFFHOST_COPY | 本机 root-only 包已生成并验证；`offhost_copy_completed=false`，未执行外部传输 |
| Git | PASS | 起点 `82e9f07ce1666ace2677853408c7fb4339808cfc`、behind 0/ahead 76、clean；fsck、76 本地提交、TASK01—TASK10、无 gitlink/嵌套仓库和凭据扫描通过；docs-only 提交后 Bundle clone 验证 |
| 版本/Migration | PASS | `0.1.0-alpha.34`；0001—0034 共 34 个，仓库/数据库 checksum 全一致；0034 SHA `29b380050d7d7003df82df981aea061e7287845dde773f181caf918a49d47b2d` |
| PostgreSQL | PASS / SECRET | custom dump 1,677,933 bytes、SHA `72e8cbc6c3c4666b0e95dbcacf395787c5b520eb05a2bf3a8837ed4cfc68d702`；固定新空库单事务恢复、210 表/205 零业务表、Audit/Session 安全字段通过后删除。dump 含身份哈希/Session，0600 |
| 文件卷 | PASS | uploads/attachments/backup-status 三 tar 均通过路径、SHA、uid/gid/mode/mtime 和源不变核验；临时恢复目录清理，未创建 Docker Volume |
| 运行保护 | PASS | Web/Worker 停服 dump 后按 Web healthy→Worker running 恢复；PostgreSQL 未停止/重启。restart 0/OOM false、Build Cache 0B、四卷/resource-guard/Python/SQLite 保持 |
| 灾备目录 | ROOT ONLY | `/var/backups/chenyida-erp/landing-alpha34-20260728T042820Z`，root:root 0700；全部文件 root:root 0600，`SHA256SUMS` 全通过 |
| 下一步 | USER ACTION REQUIRED | 经受控 scp/SFTP/VPN 下载整个目录，在异机运行 `sha256sum -c SHA256SUMS` 并返回结果；此前不得宣称 OFFHOST BACKUP COMPLETE |

## SELFHOST-PHASE5-TASK10 供应商来料 Inventory Lot 与 IQC 隔离放行

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `a10264020738d5ff281db9a6f7b6774df8cbb61b` 严格 Parent `55f8fe9693ebc0f630920e92eca1f74584d852af`；Compose/回归修正 `b4f3f5f5de30259e44d5b00a5587dee29331539f`；独立 ops 验收提交以 Git log 为准 |
| 版本/Migration | PASS | `0.1.0-alpha.34`；唯一 `0034` SHA/checksum `29b380050d7d7003df82df981aea061e7287845dde773f181caf918a49d47b2d`；0001—0033 未改，Schema/snapshot/journal 一致 |
| Receipt Lot/IQC | PASS | IQC Receipt Line 唯一 RML Lot；收货同步 on-hand/frozen；IQC 沿稳定关系 RELEASE passed 范围，failed 保持冻结；无下游整单冲销只反向原 Lot |
| 实际 HTTP | PASS | 两条 Project→Planning→Purchase Request→Award→PO→Plan 完整业务链；主链 Receipt 10、Source 120、初始 10/10/0，IQC 10/8/2、RELEASE 8/Close 后 10/2/8；AP/Production Issue 0。3 件支线同 Lot 冲销为 REVERSED；主链已有 IQC 的冲销 409；四页面 200 |
| 权限/幂等/CAS/并发 | PASS | purchase/warehouse/quality/production/finance 职责边界与 403；同 Key 重放/异正文冲突、stale CAS、并发 Receipt/Release、过量放行、故障零半记录、SQL guard 和非 IQC null Lot 通过 |
| 自动验证 | PASS | TASK10 unit/UI/PG/migration `2/2 + 2/2 + 3/3 + 3/3`；Procurement 7/7、Quality 12/12、TASK08 PG/migration 2/2+4/4、TASK09 PG/migration 2/2+3/3、共享 unit/UI 42/42；`npm test` 3/3、typecheck、Drizzle consistency、lint 0 error/8 既有 warning、双 build、credentials、Python 临时 SQLite 三项和 diff check 通过 |
| 重启/恢复 | PASS | Web/Worker 串行重启后事实保持；最终完整 HTTP 接受态备份 1,706,164 bytes、SHA `e4548ed8b264b078a34c7856c1338d5fb6ce712158d0453dc018945b5e27b791` 恢复固定第二库并核对 Project/Planning/Purchase Request/Award/PO/Receipt/Lot=`2/2/2/2/2/2/2`、10/2/8、REVERSED、Source 120/0、AP/领料 0；临时库删除 |
| 最终基线 | PASS | 主库由 clean-0034 SHA `44e064442eac5af0df56abf54989dd75a9fe6d39a030427439cf4996c9889c25` 恢复；migrations/admin/audit/session=`34/1/1/1`，原 Audit/Session 不变；205 个业务表、幂等/文件均 0 |
| 资源 | PASS | 最终 available 2.3 GiB、Swap 139 MiB、60 秒 `142452→142372 KiB`（增长 -80 KiB）、根盘 36 GiB、Load `0.03/0.11/0.21`；Build Cache 峰值 2.569 GB，经一次授权 prune 回到 0B；任务依赖镜像删除，alpha.34 tagged images、三容器、四受保护卷保留；restart 0/OOM false |
| Python/SQLite | PASS / PROTECTED | PID `13737`、NRestarts 0，未重启 Python；项目虚拟环境 self-test/smoke/临时 SQLite go-live 全部通过，系统 Python 缺 openpyxl 的首次 smoke 未进入测试后即改用项目虚拟环境 |
| 排除事项 | ENFORCED | 未执行生产领料 Lot、FIFO/FEFO、效期、序列号/标签、MRB/退货/报废、AP/付款、真实迁移、生产部署、push/PR 或后续任务 |
| 完成结论 | PASS | `SUPPLIER RECEIPT LOT AND IQC RELEASE ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE5-TASK09 FQC Lot 放行与销售发货 Lot 精确消费

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `02dfa0d3c18c16b0e8ee07af94f11de7a0ca77e7` 严格 Parent `279d284738b8ee01f6579a91333ad958a6c36dc8`；独立 ops 验收提交以 Git log 为准 |
| 版本/Migration | PASS | `0.1.0-alpha.33`；唯一 `0033` SHA/checksum `ca01cbc6a40ebfe9c17e9c3133f8704748d12b64c21d56155313ff73ce0c3d44`；0001—0032 未改，Schema/snapshot/journal 一致 |
| Lot FQC/Shipment | PASS | BATCH Allocation/FQC/Shipment/FQC Fact/Ledger 全部保存同一 Lot；warehouse 显式选择，ORDER 全链 null Lot |
| 实际 HTTP | PASS | Lot A/B `4/6`；A 发 4 后冻结 B 2，B 发 6 返回 409 且零半记录；解冻发 B 6；冲销 A 4 恢复原 Lot/FQC 后同一 A 再发 4。最终有效 Shipment/FQC `4/6`、Material 0、Source 200、AR/Settlement 0 |
| 权限/幂等/CAS/并发 | PASS | quality/sales/warehouse/production/finance 权限分离；同 Key 重放/异正文冲突、Lot/FQC/Delivery/SO CAS 与并发额度、冻结/耗尽/跨 Lot/Material/Unit/SO Line、故障和 SQL guard 通过 |
| 自动验证 | PASS | TASK09 unit/UI/PG/migration `2/2 + 2/2 + 2/2 + 3/3`；`npm test` 3/3、适用回归 75/75、11 typecheck、Drizzle consistency、lint 0 error/8 既有 warning、双 build、1003 文件 credentials、Python 临时库三项和 diff check 通过 |
| 重启/恢复 | PASS | PostgreSQL→Web→Worker 串行重启后事实保持；接受态 SHA `feb1c4afbc37aabf1057105cb9904503f40340e8d0ce27b8ef72d96ac741e8fd` 恢复固定第二库并核对 `{4,6,4}`/`{A,B,A}`/A reversal/ORDER null Lot；主库由 clean-0033 SHA `52def540e06bb2eecfbf8a2a0d5e7a45a782e0861fb31b0120de6da9b259706f` 恢复 |
| 最终基线 | PASS | migrations/admin/session/audit=`33/1/1/1`，原合法 Audit/Session 集合和时间完全不变；业务/幂等/uploads/attachments 0，任务库/备份/容器/SQLite 已清理 |
| 资源 | PASS | 最终 available 2.38 GiB、Swap 146 MiB、根盘 36 GiB、Load `0.55/0.37/0.46`；64 秒 Swap 增长 -45056 bytes；restart 0/OOM false。最终 Build Cache `2.105 GB→0B`，四卷/tagged image/resource-guard 保持 |
| Python/SQLite | PASS / PROTECTED | PID `13737`、NRestarts 0；SQLite 1544192 bytes、mode 600、mtime 不变，仅核验 metadata；三项测试使用临时 SQLite |
| 排除事项 | ENFORCED | 未执行原材料/供应商/Receipt/领料 Lot、序列号/标签、自动选 Lot、AR/Settlement、真实迁移、生产部署、push/PR 或 TASK10 |
| 完成结论 | PASS | `FINISHED GOODS LOT RELEASE AND SHIPMENT ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-OPS-PARALLEL-DB-CREDENTIAL-ROTATION-03 并行 PostgreSQL 凭据轮换

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 严格 Parent `0d24eddcc5176602370214bfc8f8003844ab2b80`；独立提交消息 `ops: rotate parallel database credential safely`，实际 SHA 以 Git log 为准 |
| 版本/Migration | UNCHANGED | `0.1.0-alpha.32`；`0001`—`0032` 共 32 个 migration，`0032` SHA-256 `3a2fc22ff73706d226641119135b68d042d393124c89233a63d774f76aa2d4fa` |
| 凭据轮换 | PASS / SECRET NOT RECORDED | 使用 256-bit 随机 URL-safe 密码，角色与 env 原子切换；`parallel.env` 保持 root:root 0600，临时回滚副本成功后安全删除；报告不含密码或连接字符串 |
| 密码验证 | PASS | 新密码从 Worker 经 Compose 网络执行 `SELECT 1` 成功；旧密码经 `scram-sha-256` 路径返回 PostgreSQL `28P01`。PostgreSQL 容器 ID/StartedAt 未变且始终 healthy |
| Web/Worker | PASS | Web、Worker 停止和重建严格串行；最终 Web healthy、Worker running，RestartCount 0、OOMKilled false |
| 登录基线 | PASS / ACCEPTED | 唯一审计为 `IDENTITY/LOGIN/success`，唯一 session 为同时间创建的 ACTIVE session；属于同一次合法管理员登录，不删除不可变审计。未重复 POST 登录，避免制造第二条审计/会话；health 与 `/api/session` 均可用 |
| 数据基线 | PASS | schema_migrations 32、app_meta 1、唯一启用 admin 1；其余 public 业务/幂等表 0，uploads/attachments 0 |
| 自动验证 | PASS | Compose config、new-password `SELECT 1`、old-password `28P01`、HTTP health/session、`npm test` 3/3、lint 0 error/9 warning、credentials 994 files、diff/scope 检查通过 |
| 资源/容器 | PASS | 起点 available 2.3 GiB、Swap 138 MiB 且 60 秒增长 0、根盘可用 37 GiB、Load `0.07/0.15/0.17`；最终 available 2.3 GiB、Swap 约 138 MiB/60 秒增长 -304 KiB、Load `0.17/0.22/0.19`。Build Cache 0B、三容器/四受保护卷保持 |
| Python/SQLite | PASS / PROTECTED | Python PID `13737`、NRestarts 0；SQLite inode `53827608`、size `1544192`、mode 600、mtime `2026-07-26 01:03:51.761827070 +0800`，未读写正文或重启服务 |
| TASK09 规则 | NOT STARTED | TASK09 未授权；未来必须保存基线主键或不可逆摘要（无敏感数据），按 baseline-delta 验收并返回完全相同记录集/计数，不得删除合法不可变审计 |
| 完成结论 | PASS | `PARALLEL POSTGRESQL CREDENTIAL ROTATED AND LOGIN BASELINE ACCEPTED` |

## SELFHOST-PHASE5-TASK08 成品 Inventory Lot、批次余额与完工入库绑定

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `43808f85bc3a662825cc2421d97e9eb631e0c469` 严格 Parent `809efadd2cafd1a7b55a0824b87c67c70ad2814b`；其后仅追加聚焦修正；独立 ops 提交以 Git log 为准 |
| 版本/Migration | PASS | `0.1.0-alpha.32`；唯一 `0032` SHA-256/checksum `3a2fc22ff73706d226641119135b68d042d393124c89233a63d774f76aa2d4fa`；0001—0031 未改，Schema/journal/snapshot/manifest 一致 |
| Lot 身份与守恒 | PASS | 一个 Manufacturing Batch 唯一一个 Finished Goods Lot；同批多 Completion/冲销恢复复用。Ledger/Balance 稳定 Lot ID 一致，Lot Balance `4+6=10` = Material Aggregate = 有效 Completion 净量 |
| 实际 HTTP | PASS | Batch A/B `4/6`、全 IPQC 通过、Lot A/B `4/6`；Lot B freeze/unfreeze 2；Lot A `-4` 冲销至 REVERSED 后同 Lot `+4` 恢复；ORDER null/空 Lot兼容 |
| Ledger/Genealogy | PASS | on-hand delta `+4,+6,0,0,-4,+4`，零 delta 为冻结事件；genealogy 返回 Lot、Completion、Ledger、Balance；FQC/Shipment/Sales Source/AR/Settlement 0 |
| 权限/并发/故障 | PASS | production freeze 实际 403；同 Idempotency-Key 并发 Completion 只一次有效；CAS、冻结冲销门禁、故障零半记录、跨 Batch/Material/错误 code/重复 Lot SQL guard 通过 |
| 自动验证 | PASS | 212 项不重复 Node 测试、13 组适用 typecheck、Drizzle consistency、lint、双 build、992 文件 credentials scan、diff 和 Python 三项通过 |
| 重启/恢复 | PASS | Compose 串行 restart 后接受事实保持；接受态 dump 1,684,486 bytes/SHA `416541cb78062657640458f6dd104c86a8cf3432332302cb2c58ab683a4b3949` 恢复固定第二库并核对 32 migrations、Lot `4/6`、Material 10 |
| 清理 | PASS | 主库 32 migrations、app_meta 1、唯一启用 admin；其余公共业务/Audit/Idempotency/临时账号/uploads/attachments 0；任务库/角色/临时文件/备份删除，resource-guard 保留 |
| Build Cache/资源 | PASS | Cache 起点 0B→峰值 2.627 GB→一次授权 prune 后 0B；磁盘 35→37 GiB。最终 available 约 2.4 GiB、Swap 150 MiB、Load `0.04/0.37/0.62`；60 秒 Swap 正增长 0，restart 0/OOM false |
| Python/SQLite | PASS / PROTECTED | PID `13737` 未操作；SQLite metadata inode `53827608`、size `1544192`、mode 600、mtime `2026-07-26 01:03:51.761827070 +0800`，未读真实正文 |
| 排除事项 | ENFORCED | 原材料、供应商/Receipt、领料、Shipment/FQC Lot、序列号/标签、事务外自动 Lot、设备/OEE、外协、产能、成本、历史迁移、Python 操作、HTTPS/防火墙、生产部署/切流、push/PR、TASK09 均未执行 |
| 完成结论 | PASS | `FINISHED GOODS INVENTORY LOTS ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-OPS-DOCKER-CACHE-CLEANUP-02 安全清理 Docker 构建缓存

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 严格 Parent `dfece35cda381ff31c376aad9ed78242861ada73`；独立提交消息 `ops: clean docker build cache safely`，实际 SHA 以 Git log 为准 |
| BuildKit | PASS | 默认且唯一 `default*` docker builder、BuildKit v0.30.0；确认无构建/测试/migration 后，`docker buildx prune --all --force` 退出 0、`Total: 25.11GB`；Build Cache 25.11 GB→0B |
| Image | PASS | Images 13/27.45 GB→12/6.511 GB；唯一无引用 dangling image `sha256:ccce71ed69856b11e1980148ad4ed6aa5183012cab1a7a68dd121719413f6612` 逐 ID 删除，最终 dangling 0；所有 tagged image 保留 |
| 磁盘 | PASS | 根分区可用 14→37 GiB，超过 30 GiB 目标，无需第二阶段清理 |
| 容器/网络 | PASS / UNINTERRUPTED | PostgreSQL/Web/Worker 容器 ID 与镜像不变；RestartCount 0、OOMKilled false；PostgreSQL/Web healthy、Worker running；Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口 |
| Volume/Trae | PASS / PROTECTED | 四个 ERP 卷名称、local driver、scope 与创建时间不变；`trae-app-1`、`trae-mysql-1`、`trae_mysql_data` 和六个匿名卷保留，未删除任何 Volume |
| 数据/备份 | PASS / PROTECTED | 31 migrations、唯一启用 admin 1，其余 public 业务/Audit/Idempotency 表 0、uploads/attachments 0；resource-guard SHA-256 仍为 `ffd176e43192c575a0b5c7e3f2469f93f779605ca445bcfc6218ed8c810b6570` |
| Python/SQLite | PASS / PROTECTED | Python PID `13737`、systemd restart 0；SQLite inode `53827608`、size `1544192`、mode 600、mtime `2026-07-26 01:03:51.761827070 +0800`，仅核验 metadata，未读正文 |
| 60 秒观察 | PASS | available `2503064→2499940` KiB；Swap `151064→151064` KiB、增长 0；Load `0.79/0.60/0.44→0.37/0.52/0.42`；三容器 restart 0/OOM false，PostgreSQL/Web 全程 healthy |
| 串行验证 | PASS | `git diff --check`、`npm test` 3/3、lint 0 error/9 warning、credentials 980 files；受限 `--rm` 容器逐个运行且已清理，无 Volume，Build Cache 保持 0B |
| 版本/Migration | UNCHANGED | `0.1.0-alpha.31`；`0001`—`0031`，未修改业务代码、Schema、Migration、Compose 或版本 |
| 完成结论 | PASS | `DOCKER BUILD CACHE SAFELY CLEANED`；未启动 TASK08 |

## SELFHOST-PHASE5-TASK07 生产批次身份与全过程谱系

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `3162edf5559512dd82ec363cf859d39bae2d5a0d` 严格 Parent `93902d9c3f7be94044cf9903af6e6fbebc685cc3`；聚焦修正 `dfd1581bc2e3cb072cd7f238e6a1b0097f8912f4`、`cd9f016570cf94eb2990362b56e8f51ef5d43db1`；独立 ops 验收提交以 Git log 为准 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.31`；`0031` SHA-256/数据库 checksum `ac0f6a63cfdb30d42edf50741afc7c8af632f74ff6fb08398d6b6e398a637fd4`；0001—0030 未修改，Schema/journal/snapshot 一致 |
| Batch 身份 | PASS | 每 Work Order 至多一个 Batch Set；DRAFT CAS 编辑，RELEASE 合计严格等于 planned，服务端 Batch code 和稳定 canonical digest；发布后快照/Batch 不可变 |
| 实际 HTTP | PASS | Batch A 4 完成四工序/IPQC；Batch B 原检 `6/4/2/4`、NCR v1 RETURNED/v2 ACCEPTED、同批 REWORK `2/2/0`、复检 `2/2/0/2`、AOI `4/2`；B REFLOW 加工次数 8、净量 6 |
| Report/Completion/Inventory | PASS / NOT INVENTORY LOT | 两条 Final Output/Report/Completion/Ledger 为 `4/6`，Ledger `lot_code=''`、MAIN Balance 10；Batch A/B 均 COMPLETED，工单 `10/10/10/0/10 COMPLETED`。生产批次谱系已建立，但仓库批次库存尚未启用 |
| 谱系/WIP | PASS | 列表、详情、code 精确查询、Batch WIP、genealogy、Work Order 汇总沿稳定 ID 返回 Batch Set/digest、快照、NORMAL/REWORK、品质/NCR/复检、Report/Completion 和 Inventory Adjustment/Ledger ID |
| 门禁/权限 | PASS | 数量不等发布、发布后修改、跨 Batch 下游消费、Report/Completion 混批、结构化 legacy 绕过均拒绝；planning/warehouse 越权写实际 403，quality/warehouse/engineering 按职责只读；ORDER 模式实际兼容 |
| 幂等/CAS/并发/回滚 | PASS | 持久 Idempotency 重放/异正文、Batch Set/Batch CAS、并发唯一发布/编码、固定锁序、故障零半记录、事实不可变和直接 SQL guard 通过 |
| 自动验证 | PASS | 208 项不重复 Node 测试：unit/UI 82、PostgreSQL/API 67、migration 40、npm/environment/manifest/coverage 19；9 组 typecheck、Schema consistency、lint、双 build、credentials、diff 与 Python 三项通过 |
| 重启/恢复 | PASS | 串行重启后 31 migrations、Batch `4/6`、NORMAL 9、REWORK 1、ORDER Run 1、Inspection 3、NCR 1、Report/Completion 2、Ledger `4/6`、Audit 85、Idempotency 71 保持；接受态备份恢复至固定第二空库复核完整链 |
| 清理 | PASS | 主库 31 migrations、app_meta 1、唯一启用 admin，其他公共业务/Audit/Idempotency/临时账号 0；uploads/attachments 0；仅 PostgreSQL/Web/Worker 三容器和四卷；TASK07 数据库/备份/临时资源删除，resource-guard 保留 |
| Python/SQLite | PASS / PROTECTED | Python PID `13737` 未停止或重启；真实 SQLite metadata `53827608:1544192:1784999031:1784356951`、mode 600 未变且未读正文；三项 Python 基线通过 |
| 资源观测 | PASS | 起点 available 约 2.4 GiB、Swap 148 MiB、磁盘 15 GiB；最终 2.4 GiB/148 MiB/14 GiB、Load `0.81/0.91/0.71`；最终 60 秒 Swap 增长 0，三容器 RestartCount 0/OOMKilled false |
| 排除事项 | ENFORCED | 未实现 Inventory Lot Balance、原材料/供应商/仓库批次、冻结/Shipment 消费、序列号/标签、自动 Batch、设备/OEE、外协、产能、成本会计、FQC/Shipment/AR/财务、历史迁移、Python 操作、HTTPS/防火墙、生产部署、push/PR 或 TASK08 |
| 完成结论 | PASS | `MANUFACTURING BATCH GENEALOGY ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE5-TASK06 返工执行、复检与生产流恢复

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `1f6a143adbf78d7fb70fbed1ea7d7dfea62cfd4b` 严格 Parent `11bc680a91c59258c94f8ddca3d56af71981811e`；独立 ops 验收提交以 Git log 为准 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.30`；`0030` SHA-256/数据库 checksum `37fd53b02f517023a3fc6aba22b0904a4881273b8752de2946f0c5432a2d050c`；0001—0029 未修改，Schema/journal/snapshot 一致 |
| 权威与守恒 | PASS | REWORK 复用既有 Operation Run/Report、Quality、WIP、正式 Report/Completion/Inventory；稳定关联 Request/NCR/原检/来源 Report/目标快照/工单/operator，Execution 返回 accepted/待派/在制/good/scrap/待复检/released/completed/unresolved |
| 实际 HTTP 数量 | PASS | 原检 `10/8/2/8`；v1 RETURNED/v2 ACCEPTED 2；REWORK report `2/2/0`；复检 `2/2/0/2`；AOI available `8→10`，后续 AOI/Final Output/Report/Completion/Ledger=`8/2`，Balance 10 |
| 加工次数与净产品 | PASS | SMT-PRINT 10、SMT-MOUNT 10、REFLOW NORMAL 10、REFLOW REWORK 2、AOI 10；REFLOW 加工次数 12，但 Work Order planned/reported/good/scrap/completed=`10/10/10/0/10`，状态 COMPLETED 未自动 CLOSED |
| 最终投影 | PASS | Rework Execution COMPLETED、NCR RESOLVED、accepted/reworked/released=`2/2/2`、unresolved 0；原 Inspection failed 2 保持；FQC/Shipment/Sales Source/AR/Settlement 0 |
| 权限/职责/门禁 | PASS | production 显式派工/执行/受控冲销，quality 创建复检/结果/缺陷，manager 异人处置，engineering 只读；warehouse 等实际 403。未复检不得派满 AOI，复检放行后才恢复 2 |
| 幂等/CAS/并发/回滚 | PASS | Idempotency 重放/异正文、CAS、固定锁序、并发派工/取消/开工/报工、超量、错误状态/目标、active operator、NORMAL/REWORK 伪造、故障零半记录和直接 SQL guard 通过；已有复检阻止冲销 |
| 自动验证 | PASS | 178 项不重复 Node 自动测试：unit/UI 78、PG/API 46、migration 37、npm 3、environment 6、manifest 8；8 组 typecheck、Schema consistency、lint 0 error、build、965 文件 credentials scan、`git diff --check` 和 Python 三项通过 |
| 重启/恢复 | PASS | Compose 整体重启后 30 migrations、NORMAL Run 5、REWORK 1、两次 Inspection/Report/Completion、Balance 10、Audit 56、Idempotency 46 保持；接受态备份 SHA `f5e8011c4ef55b0393cceedfbb2ebbbf8171e44fe8cccea92012452d77f8e379` 恢复到固定第二新空库并核对完整 `8+2` 链 |
| 清理 | PASS | 主库 30 migrations、app_meta 1、唯一启用 admin，其他公共业务/Audit/Idempotency/临时账号 0；uploads/attachments 0；仅 PostgreSQL/Web/Worker 三容器和四卷；TASK06 库/备份/临时资源删除，resource-guard 保留 |
| Python/SQLite | PASS / PROTECTED | 常驻 Python PID `13737` 未停止或重启；真实 SQLite 仅核验 metadata `53827608:1544192:1784999031:1784356951`、mode 600，未读业务正文；三项 Python 基线使用内部/临时库通过 |
| 资源观测 | PASS | 起点 available 2.4 GiB、Swap 141 MiB、磁盘 18 GiB；最终 2.4 GiB/153 MiB/15 GiB、Load `0.13/0.90/1.25`；60 秒 Swap 160,477,184→160,473,088 bytes（正增长 0），RestartCount 0/OOMKilled false |
| 排除事项 | ENFORCED | 未自动派工/复检、未返工补料、SCRAP Inventory、自动补产、批次/设备/产能/FQC/Shipment/AR/财务、真实迁移、Python 操作、HTTPS/防火墙、生产部署/切流、push、PR 或 TASK07 |
| 完成结论 | PASS | `PRODUCTION REWORK EXECUTION AND REINSPECTION ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE5-TASK05 IPQC 不合格处置与返工申请交接

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `1de057a6a248ca3346d7d2b0f201252a3965eced` 严格 Parent `736f14b9510ca52ce39fea7154872dffe7818986`；独立 ops 验收提交以 Git log 为准 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.29`；`0029` SHA-256/数据库 checksum `6814a728f4d04e4fbceb83c7a288fa214a9ec64317b547cc6cbaebfec456b40c`；0001—0028 未修改，Schema/journal/snapshot 一致 |
| NCR 与数量守恒 | PASS | 只接受 failed>0、FAIL Result+Defect 的结构化 Run Report IPQC；服务端继承稳定来源；`failed = active rework + final scrap + unresolved`，RETURNED/CANCELLED 释放，ACCEPTED 占用，SCRAP 不可逆且不写库存 |
| 实际 HTTP 数量 | PASS | planned/issued 10；REFLOW inspected 10/passed 8/failed 2；AOI available 8、Hold 2；v1 RETURNED、v2 ACCEPTED；active rework 2、final scrap 0、unresolved 0、NCR REWORK_ACCEPTED |
| 请求版本/目标 | PASS | target 为同工单 REFLOW Snapshot Operation；v1/v2 各有不可变提交快照和 64 位 digest；后序/跨工单目标拒绝，SUBMITTED/ACCEPTED 内容不可改，ACCEPTED 不可取消 |
| 权限/职责分离 | PASS | quality 创建/编辑/提交，production RETURN/ACCEPT 且不能接收自己创建的请求，manager/admin SCRAP，engineering 只读；warehouse/sales 等实际 403 |
| 门禁/并发/回滚 | PASS | Idempotency 重放/异正文、CAS、固定锁顺序、并发 draft/submit/accept/SCRAP、直接 SQL、故障零半记录通过；已有处置阻止 Inspection reopen 与来源 Run 冲销 |
| 下游零事实 | PASS | AOI available 保持 8；Rework Run、额外 Run Report、Production Report、Completion、Finished Goods Ledger/Balance、FQC/Shipment/AR/Settlement 均 0 |
| 自动验证 | PASS | 166 项不重复 Node 自动测试：unit/UI 72、PG/API 47、migration 38、npm 3、environment 6；正式 typecheck、Schema consistency、lint、build、955 文件 credentials scan、`git diff --check` 和 Python 三项通过 |
| 重启/恢复 | PASS | 整体重启后 NCR/v1/v2、2 提交快照、6 请求事件、digest、Audit 44、Idempotency 30 保持；接受态备份 SHA-256 `440fae8efd3427a341d7c8d2d24ebf516de9ef9dfd9acb50b5e841ebf069afbc` 恢复到固定第二新空库并核对完整链 |
| 清理 | PASS | 主库 29 migrations、app_meta 1、唯一启用 admin，其他公共业务/Audit/Idempotency/临时账号 0；uploads/attachments 0；仅 PostgreSQL/Web/Worker 三容器和四卷；TASK05 库/备份/临时容器/辅助镜像删除，resource-guard 保留 |
| Python/SQLite | PASS / PROTECTED | `server.py --self-test`、`smoke_test.py`、临时 SQLite `go_live_check.py --no-backup` 通过；常驻 Python PID `13737` 未重启，真实 SQLite metadata `53827608:1544192:1784999031:1784356951`、mode 600 未变，未读业务正文 |
| 资源观测 | PASS | 起点 available 约 2.4 GiB、Swap 约 111 MiB、磁盘约 21 GiB；最终 available 2.4 GiB、Swap 150 MiB、磁盘 17 GiB、Load `0.18/0.31/0.82`；独立 60 秒 Swap 157,892,608→157,872,128 bytes（正增长 0），全程 RestartCount 0、OOMKilled false |
| 排除事项 | ENFORCED | 未执行 Rework Run/派工/开工/报工/再检、SCRAP 库存过账、补产/补料、批次/设备/产能、FQC/Shipment/AR、真实迁移、Python 服务操作、HTTPS/防火墙、生产部署、push、PR 或 TASK06 |
| 完成结论 | PASS | `IPQC NONCONFORMANCE TO REWORK REQUEST ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE5-TASK04 工序质量门禁、IPQC 稳定来源与受控放行

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `5379550d0381818ad970518ac4fb8261c4679989` 严格 Parent `f6e5ff2e8344e79a35f56311b02b514613484f59`；聚焦修正 `56f63ca714ed6f359bc51f681b6a532259747f1b`；独立 ops 验收提交以 Git log 为准 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.28`；`0028` SHA-256/数据库 checksum `a7a55f7c6c81b1c5a80df59a1b3f639187cc2c2ce8658087ceb392b1f2ada912`；0001—0027 未修改，Schema/journal/snapshot 一致 |
| 门禁与稳定来源 | PASS | Routing `NONE/IPQC` 进入 digest 并固化 Snapshot；工序 IPQC 显式引用有效 Run Report，服务端确定同工单/快照/工序/工作中心/物料/单位/数量，与历史 Report IPQC 来源互斥且兼容 |
| 实际 HTTP 数量 | PASS | REFLOW good `4/6` 后 Hold 10、released 0、AOI available 0；IPQC inspected/passed/released=`4/6` 后 Hold `10→6→0`、AOI available `0→4→10`；最终 AOI/Report/Completion/Ledger `4/6`、Balance 10，Work Order `10/10/10/0/10 COMPLETED` |
| 权限/职责分离 | PASS | engineering 配置 DRAFT；production 执行和只读；quality 显式创建/记录/关闭，manager 异人处置；warehouse 实际越权 403。Dashboard 五项指标按权限返回且不创建 Inspection |
| 守恒/并发/更正 | PASS | inspected/released 不超 good/passed；OPEN/HOLD/REWORK/SCRAP 不释放；幂等重放/异正文、CAS、并发 close/reopen/消费、直接 SQL 和故障零半记录通过；存在 IPQC 阻止来源 Run 冲销，下游消费阻止 reopen |
| 自动验证 | PASS | TASK04 专项 15；完整 unit/UI 回归 56、PG/API 40、migration 回归 16、manifest 8、coverage 2、环境 6、npm 3 均通过；正式 typecheck、Schema consistency、lint、Vinext build、credentials scan、`git diff --check` 和 Python 三项通过 |
| 重启/恢复 | PASS | Compose 整体重启后 8 Run/Report、2 Inspection/Result、6 Quality Event、2 Report/Final Allocation/Completion、2 Ledger、Balance 10 保持；接受态备份 SHA-256 `4da56e4303afae15ac0e5e7e8f550711ec66cbcae669dcac8b4b1f4c8e360a65` 恢复到固定第二新空库并核对 28 migrations 和完整 4/6 链 |
| 清理/资源 | PASS | 主库 28 migrations、唯一启用管理员、业务/Audit/Idempotency/验收账号/uploads/attachments 0；仅 PostgreSQL/Web/Worker 三容器和四卷；任务库/备份/临时目录/测试镜像/build 产物删除，resource-guard 保留 |
| Python/SQLite | PASS / PROTECTED | 三项基线使用内部/临时 SQLite 通过；常驻 Python PID `13737` 未重启，真实 SQLite metadata `53827608:1544192:1784999031:1784999031`、mode 600 不变，未读写业务正文 |
| 资源观测 | PASS | 起点 available 约 2.4 GiB、Swap 约 86 MiB、磁盘约 21 GiB；最终 available 2.4 GiB、Swap 111 MiB、磁盘 21 GiB、Load `0.49/0.44/0.51`；独立 60 秒 Swap 正增长 0，RestartCount 0、OOMKilled false |
| 排除事项 | ENFORCED | 未自动创建 IPQC/FQC，未执行 FQC/Shipment/AR/财务、返工/返修、failed/scrap 库存、批次/设备/产能、真实迁移、Python 服务操作、HTTPS/防火墙、生产部署、push、PR 或 TASK05 |
| 完成结论 | PASS | `PRODUCTION OPERATION IPQC GATE ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE5-TASK03 末工序产出绑定、正式报工与成品入库

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `1dae9661d07f7af7e866a1654804742372b8bc76` 严格基于 `a6448ac42da737e31fee76085fb699e80f3c621b`；聚焦修正 `1a01172f14e9d4b3b51ec10430b188aa79efa96d`、`2eb5120bf98c9d45705cf96e2a25afb37cc154a3`；独立 ops 验收提交以 Git log 为准 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.27`；`0027` SHA-256/数据库 checksum `b226cc958215400c38f48c925e4b33c4e97723340aaf729d4da75322213b9c76`；0001—0026 未修改，Schema/journal/snapshot 一致 |
| 结构化来源权威 | PASS | 只消费同 Work Order 最后 Snapshot Operation 的有效 Run Report good；稳定 Allocation、numeric、CAS/行锁/幂等和 deferred guard 防超量/跨工单/非末序/伪造/修改，legacy 无 Snapshot 兼容 |
| 实际 HTTP 数量 | PASS | 四工序分批 `4/6`；final output `10→6→0`；有效 Report/Final Allocation/Completion/Completion Allocation 均 `4/6`；Ledger `+4/+6`、Balance 10，Work Order `10/10/10/0/10 COMPLETED` |
| 冲销与下游 | PASS | 无下游 Report 冲销恢复 final output 后重新报工；已有 Completion 阻止 Report 冲销；有效 Report 消费阻止 Run 冲销；IPQC/FQC/Shipment/Sales Source/AR/Settlement 0 |
| 权限/并发/回滚 | PASS | production/warehouse/manager/admin/quality 边界、sales 403、同 Key 重放/异正文冲突、Work Order/WIP/Report CAS、并发唯一消费、Completion 并发守恒、直接 SQL guard 和故障零半记录通过 |
| 自动验证 | PASS | TASK03 专项 12、适用回归 82，共 94 项；正式 typecheck、Schema consistency、lint 0 error/8 个既有 warning、Vinext build、928 文件凭据扫描、`git diff --check` 和 Python 三项通过 |
| 重启/恢复 | PASS | 整体串行停/启后完整事实与 Audit 51/Idempotency 41 保持；接受态停服备份 SHA-256 `16d63e5cbe1f85aa1a70f1414edb5a66d008faefe076b9739e92f9a71976f9f6` 恢复到第二新空库，核对 27 migrations 和完整 4/6 链 |
| 清理/资源 | PASS | 主库 27 migrations、唯一启用管理员、业务/Audit/Idempotency/验收账号/uploads/attachments 0；仅 PostgreSQL/Web/Worker 三容器和四卷；任务测试/恢复库、备份/恢复目录和迁移容器删除，resource-guard 备份保留 |
| Python/SQLite | PASS / PROTECTED | Python PID `13737`、NRestarts 0；真实 SQLite inode `53827608`、size `1544192`、mode `600`、mtime 不变，只核验 metadata，未读写正文或重启服务 |
| 排除事项 | ENFORCED | 未自动创建品质、发货或财务事实；未执行返工/批次/设备/产能、真实迁移、HTTPS/80/443、防火墙、切流、生产部署、push、PR 或 TASK04 |
| 完成结论 | PASS | `STRUCTURED FINAL OUTPUT TO FINISHED GOODS ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-OPS-RESOURCE-GUARD-01 低资源服务器保护

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 严格 Parent `120e1524eaebd9d921cab6a036b3203bf7d39226`；独立提交消息 `ops: add low-resource server safeguards`，实际哈希以 Git log 为准 |
| 事故事实 | ROOT CAUSE UNKNOWN | 2026-07-27 曾发生服务器重启/不可用；没有证据证明 OOM，不做无证据归因 |
| Python 源保护 | PASS | 默认 16 活跃请求线程、1 秒 admission、去敏 503、30 秒 socket timeout，正常/异常可靠释放；专项 2/2 通过 |
| Python 运行保护 | CGROUP ACTIVE / THREAD CAP SOURCE ONLY | 起点 installed unit 已与源一致，实际 CPU 75%/MemoryHigh 512M/MemoryMax 768M/Tasks 256/NOFILE 4096；PID `13737`、restart 0、SQLite metadata 不变。本任务未复制、reload 或重启，16 线程源码须未来获准重启后生效 |
| Compose 配置 | PASS | PostgreSQL 0.75/768M/1G/128；Web 0.75/512M/768M/128；Worker 0.50/512M/768M/128；Migrate 0.75/768M/1G/128；Admin 0.50/512M/768M/128；Caddy 0.25/128M/192M/64 |
| Node/数据库边界 | PASS | Web/Worker heap 384 MiB；Worker 单 Job；每进程 pool max 10、PostgreSQL max 100；`/dev/shm` 64M 使用 9.1M，shared buffers 128MB，26 migrations 正常 |
| 运行更新 | PASS | 已验证 custom dump；不 build，以 `COMPOSE_PARALLEL_LIMIT=1` 逐个重建 Web/Worker，PostgreSQL 原容器保持 |
| Inspect/网络 | PASS | 三容器 NanoCPU/Memory/MemorySwap/PIDs 与目标一致；Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口 |
| 数据/卷 | PASS | 26 migrations、唯一启用管理员、Audit/Idempotency/Operation Run 0；四卷名称、driver/scope、创建时间前后一致 |
| 60 秒观察 | PASS | available 约 2.2 GiB，Swap 43,180 KiB、增长 0，磁盘可用 26 GiB，Load 最终 0.05/0.14/0.32；restart 0、OOM false，PostgreSQL/Web healthy、Worker running |
| 验证 | PASS | 专项、self-test、smoke、临时 SQLite go-live、Compose config、systemd verify、受限 TypeScript check、环境守卫、凭据与 Git 检查串行通过 |
| 生产保护 | ENFORCED | 未启动 TASK03、未 push、未迁真实数据、未切流、未生产部署；资源保护不等于上线 |
| 完成结论 | PASS | `LOW RESOURCE SERVER SAFEGUARDS ACTIVE` |

## SELFHOST-PHASE5-TASK02 工序派工、执行事件与线性 WIP 流转

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `77ff520e8dbd4b04fdb96a4281934e2d7f2d8d9c` 严格基于 `d6554fcaea77cfe16320d98afcf9aed9c794bc3f`；独立 ops 验收提交以 Git log 为准 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.26`；`0026` SHA-256/数据库 checksum `b00e49aa4d4f8279372c5aab291ccfcbd54afc09ab284a6390a50fea9e66aca0`；0001—0025 未修改，Schema/journal/snapshot 一致 |
| Snapshot Operation 权威 | PASS | 执行稳定引用 Work Order Routing Snapshot Operation/Work Center/前后工序/assigned operator；不引用可变 Routing Version Operation，不以 `process_stage` 作为权威 |
| 实际 HTTP 数量 | PASS | 四工序锡膏印刷、SMT贴片、回流焊、AOI 分两批 `4/6` 贯穿；每工序 processed/good/scrap=`10/10/0`，前三工序未转移 WIP 0，末工序 final output available 10 |
| 最终报工边界 | PASS | Work Order `IN_PROGRESS`；Production Report 0、Completion 0、Finished Goods Ledger 0、Balance 0、IPQC/FQC 0；WIP 不写库存 |
| 权限/UI/Dashboard | PASS | production dispatch/execute，manager/admin 管理与 reverse，warehouse/quality 只读，其他写 403；三条原生页面和 READY/IN_PROGRESS/工序间 WIP/末序输出/WAITING 五项指标通过 |
| 并发/幂等/CAS | PASS | 重复/并发派工不超量，重复/并发开工仅一成功；同 Key 重放原结果、异正文冲突、expected version 与稳定锁顺序通过 |
| 守恒/冲销/回滚 | PASS | 前序 good 精确 Allocation，scrap 不流转，processed 不超派工；下游消费阻止冲销，无下游冲销恢复 WIP；事实不可变、直接 SQL guard 和故障零半记录通过 |
| 自动验证 | PASS | TASK02 unit/UI/PG/migration、Phase 4 TASK01—TASK10 PG/API 与 migration upgrade、Phase 5 TASK01、Production/Routing/Inventory/Dashboard、20 组正式 typecheck、Schema consistency、lint/build、916 文件凭证扫描、Python 三项及 `git diff --check` 通过 |
| 重启/恢复 | PASS | 整体重启后 `8|8|24|4|4|10|24` 的 Run/Report/Event/Operation Projection/WIP/final output/Audit 保持；停服备份 `backup-20260726T235722Z-77ff520e8dbd` 校验，新空恢复核对 `26|2|1|4|8|8|24|4|10|0|0|0` |
| 清理/资源 | PASS | 主库 26 migrations、唯一启用管理员、所有合成业务/审计/幂等与 uploads/attachments 0；仅 PostgreSQL/Web/Worker 三容器和四卷；临时库/备份/恢复/测试 SQLite/依赖卷/迁移容器删除 |
| Python/SQLite | PROTECTED / EXTERNAL PID CHANGE RECORDED | 可信起点 PID `277640` 与 SQLite metadata 均匹配；任务未执行 Python 重启或真实 SQLite 读写。并行等待期间外部变更使最终 Python PID 为 `13737`；最终 SQLite metadata 仍为 `64769:53827608:1784999031:1544192` |
| Git/生产保护 | PASS | 起点 clean、behind 0/ahead 40；本任务不 push、不建 PR、不改写历史，三个外部用户修改未纳入提交；未迁真实数据、未切流、未启 HTTPS、未生产部署 |
| 完成结论 | PASS | `PRODUCTION OPERATION EXECUTION AND WIP ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE5-TASK01 工艺路线、工作中心与工单工艺快照

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `8eedfa07573c37e46d93f208162a0842c8d90a48` 严格基于 `7485bb93dc4dad16fa5cfe54651bb8f82306a7d2`；独立 ops 验收提交以 Git log 为准 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.25`；`0025` SHA-256/数据库 checksum `39b1212df99d392739aa20b95859f3e2789fa287e23061006a34efc342c258f9`；0001—0024 未修改，Schema/journal/snapshot 一致 |
| Work Center | PASS | 实际 HTTP 创建 ACTIVE `SMT-PRINT`、`SMT-MOUNT`、`REFLOW`、`AOI`；code 标准化、唯一、不可改，启停 CAS/幂等/审计，历史引用不受停用影响 |
| Routing | PASS | v1 异人发布后含 10/20/30/40 四工序；v2 修改回流焊标准时间并发布，v1 保留 SUPERSEDED；服务端 digest、职责分离与并发唯一 current 通过 |
| Work Order Snapshot | PASS | 首张 released 工单固化 v1/4 Operations，新工单固化 v2；已发布路线和工单快照不可修改/删除；历史工单不猜测回填并显示 `LEGACY_UNSTRUCTURED` |
| 原子性 | PASS | Work Order RELEASE 同事务完成 BOM Snapshot、Requirement、Reservation=10、Routing Snapshot/Operations、Event/Audit/Idempotency；路线缺失及故障注入零半记录，Material Issue/Report/Completion 0 |
| 权限/UI/Dashboard | PASS | operations、engineering、manager/admin、production、planning 最小分权与越权 403；三条原生页面和四项权限裁剪指标通过，无工序开工/完工/报工按钮 |
| 并发/幂等/CAS/回滚 | PASS | 并发发布唯一 current、职责分离、同 Key 重放/异正文冲突、expected version、数据库 guard 与事务故障回滚通过 |
| 自动验证 | PASS | TASK01 unit/UI/PG/migration、Phase 4 TASK01—TASK10 与关联模块回归、正式 typecheck、Schema consistency、build、902 文件凭证扫描和 Python 三项通过；lint 0 error/6 既有 warning |
| 重启/恢复 | PASS | 整体重启后 4 Work Center、2 Routing、2 Snapshot、8 Snapshot Operations、7 Routing Event、11 Audit 保持；停服备份 `backup-20260726T144314Z-8eedfa07573c` 校验，新空恢复核对 `25|4|2|2|7|0|0|0` |
| 清理/资源 | PASS | 主库 25 migrations、唯一启用管理员、所有合成业务/审计/幂等与 uploads/attachments 0；仅 PostgreSQL/Web/Worker 三容器和四卷；临时库/备份/恢复/迁移资源删除 |
| Python/SQLite | PASS / PROTECTED | Python PID `277640` 未重启；真实 SQLite metadata `64769:53827608:1784999031:1544192` 不变，未读取/修改业务正文 |
| 排除事项 | ENFORCED | 未执行派工、开工、完工、工序报工、WIP、返工、批次、设备、库存过账、真实数据迁移、切流、生产部署、push 或 PR |
| 完成结论 | PASS | `PRODUCTION ROUTING AND WORK ORDER SNAPSHOT ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE4-TASK10 客户收款、供应商付款与项目收支追溯

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `23fef6098a88466b94fcac104bba9317ba310d15` 严格基于 `e63c726e0d274a8b7b654819794b4bd1044c6f82`；独立 ops 验收提交以 Git log 为准 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.24`；`0024` SHA-256/数据库 checksum `cab6f7679e91589cfe2c7fdecf9750b222b9212acbbd3341301c7a67ec2e9624`；0001—0023 未修改，Schema/journal/snapshot 一致 |
| Settlement 权威 | PASS | 复用 Finance Document/Settlement/Reversal；AR→RECEIPT、AP→PAYMENT，部分/多次核销、不可变追加式冲销、单事务 Event/Audit/Idempotency 与余额/version 投影 |
| 项目归属 | PASS | Sales/Purchase Source 行沿稳定外键归属 Project；缺链明确 UNATTRIBUTED；服务端数量×单价、digest、唯一/外键/守恒/直接 SQL guard，不回写历史来源 |
| 实际金额 | PASS | AR `80/120`、AP `48/72`；收款 `30/50/120`、付款 `48/30/42`；来源 `200/120`，AR/AP 未结 `0/0`，交易贡献/净现金 `80/80 CNY`，UNATTRIBUTED 0、冲销 0、银行写入 0 |
| 权限/UI/Dashboard | PASS | finance 写与冲销、manager/admin 项目汇总、sales/purchase 职责只读、engineering 本人项目去敏；越权 403；两条原生页面和六项按币种/权限指标通过 |
| 并发/幂等/CAS/回滚 | PASS | 并发核销不超额、同 Key 重放/异正文冲突、expected version、全额/重复/并发冲销、故障零半记录及 TASK05/TASK09 上游门禁通过 |
| 自动验证 | PASS | TASK10 unit/UI/PG/migration、TASK01—TASK09 PG/API 与 migration upgrade、相关模块回归、十组 Phase 4 typecheck、Schema consistency、build、884 文件凭证扫描和 Python 三项通过；lint 0 error/6 既有 warning |
| 重启/恢复 | PASS | 整体重启后全部 Document/Settlement/Allocation/Event/Audit/项目汇总保持；停服备份 `backup-20260726T133340Z-23fef6098a88` 校验，新空恢复精确核对 24 migrations、200/120 收支和归属 |
| 清理/资源 | PASS | 主库 24 migrations、唯一启用管理员、所有合成业务和 uploads/attachments 0；仅 PostgreSQL/Web/Worker 三容器和四卷；临时库/备份/恢复/检查资源删除 |
| Python/SQLite | PASS / PROTECTED | Python PID `277640` 未重启；真实 SQLite metadata `64769:53827608:1784999031:1544192` 不变，未读取/修改业务正文 |
| 排除事项 | ENFORCED | 未连接银行、未迁真实数据，未实现总账/税票/汇率/成本会计/正式利润，未切流、生产部署、push 或 PR |
| 完成结论 | PASS | `PROJECT RECEIPT PAYMENT AND CASHFLOW ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE4-TASK09 销售发货、成品出库与应收交接

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `dfda1c5597cc576cd96f495e272e9fc59c851fa4` 严格基于 `d9ebfb4644bb9e0d07bfbf81d168d7babcd4bdea`；独立 ops 验收提交以 Git log 为准 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.23`；`0023` SHA-256/数据库 checksum `5f07c7aebe9513e040fa0ab2f31f5cd5a51faf64fe78516794cd0fd46309221d`；0001—0022 未修改，Schema/journal/snapshot 一致 |
| 关系与事务 | PASS | 发货指令/行/事件、执行行和 Shipment Line→FQC Release Allocation 关系化；单事务复用 Shipment、Inventory Ledger/Balance、SO 投影、Sales Source、Event/Audit/Idempotency |
| 权限 | PASS | sales 创建/提交/取消，warehouse 接收/退回/执行/受控冲销，finance 显式 AR，quality 只读消费；实际越权 403 通过 |
| 数量与金额 | PASS | Instruction 10；Shipment/FQC `4/6`；库存 `10→6→0`；SO `OPEN→PARTIALLY_SHIPPED→SHIPPED`；Sales Source `80/120`；显式 AR `80/120`；Settlement 0 |
| 并发/幂等/CAS | PASS | 指令/FQC/库存/订单容量、并发同指令与同 FQC、同 Source 并发 AR、同正文重放/异正文冲突、expected version 和稳定锁顺序均通过 |
| 冲销与回滚 | PASS | 无 AR 全额冲销恢复库存/SO/Instruction/FQC 并追加负来源；已有 AR 阻止冲销；审计/库存故障注入均零半记录，TASK08 FQC Reopen 门禁回归通过 |
| UI/Dashboard | PASS | `/sales/delivery`、`/warehouse/shipping`、`/finance/receivables` 实际 HTTP 200；五项权限裁剪指标完成 |
| 自动验证 | PASS | TASK09 unit/UI/PG/migration、TASK01—TASK08 及 Inventory/Finance/Dashboard 回归、28 个相关 unit/UI、17 个正式 typecheck、Schema consistency、build、874 文件凭证扫描和 Python 三项通过；lint 0 error/6 warnings |
| 重启/恢复 | PASS | Compose 整体重启后全事实保持；停服备份 `backup-20260726T105516Z-dfda1c5597cc` 校验，新空库恢复为 `23|7|1|2|10|-10|200|200|0` |
| 清理/资源 | PASS | 主库 23 migrations、唯一启用管理员、所有合成业务及 uploads/attachments 0；仅 PostgreSQL/Web/Worker 三容器和四卷；临时库/备份/恢复目录已删除 |
| Python/SQLite | PASS / PROTECTED | Python PID `277640` 未重启；真实 SQLite metadata `64769:53827608:1784999031:1544192` 不变，未读取/修改业务正文 |
| 排除事项 | ENFORCED | 未收款、未创建 Settlement、未执行银行/总账/税票/收入确认、真实迁移、HTTPS/80/443、切流、生产部署、push 或 PR |
| 完成结论 | PASS | `FQC RELEASE TO SHIPMENT AND RECEIVABLE ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE4-TASK08 生产过程检验、成品订单归属与 FQC 放行

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `4a638522b7ca295b41d2f35adbc464b23762b007` 严格基于 `7d9c2dbaf62664e46c4f984822bb43903999f5fd`；独立 ops 验收提交以 Git log 为准 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | 源码和并行环境均为 `0.1.0-alpha.22`；`0022` SHA-256/数据库 checksum `65b31aec91ad30ffd309796f58500a73c47a20bc12f855e010a4b4f17e808155`；0001—0021 未修改，Schema/journal/snapshot 一致 |
| 关系与事务 | PASS | 复用唯一 `quality-selfhost`；Completion Line→Sales Order Line Allocation/Event 为关系化稳定来源，FQC 只接收 Allocation ID，Inspection/Result/Defect/Event、处置、关闭、审计和幂等保持同事务 |
| 权限与职责 | PASS | sales 创建/取消分配，quality 创建/关闭检验，manager/admin 处置/重开，production/warehouse 受限读取；实际 403 和创建人不得最终处置通过 |
| 规则与保护 | PASS | 客户/产品/版本/成品/单位一致、双侧容量、并发锁、CAS、超检、FAIL/Defect 守恒、RELEASE/CONCESSION 上限、REWORK/SCRAP HOLD、已消费放行门禁和故障零半记录通过 |
| UI/Dashboard | PASS | `/sales/finished-goods-allocation`、`/quality/production` 真实 HTTP 200；loading/empty/403/CAS/幂等未知状态契约及五项权限裁剪指标通过 |
| 实际 HTTP | PASS | Report `4/6`、Completion `4/6`、Allocation `4/6`、IPQC `4/6`、FQC `4/6`；FQC inspected/passed/released=`10/10/10`，订单行 available=10 |
| 零副作用 | PASS | IPQC 前后 Work Order version、Completion 数量与库存不变；最终成品库存 10，Shipment、Sales Financial Source、AR 均为 0 |
| 专项与回归 | PASS | TASK08 unit/UI 5/5、PG 12/12、migration 3/3；TASK01—TASK07、Production/Quality/Sales/Inventory/Dashboard 回归、16 组正式 typecheck、Schema consistency、lint 0 error/5 既有 warning、build、858 文件凭证扫描和 Python 三项通过 |
| 重启/恢复 | PASS | Compose 整体重启后 Allocation/Inspection/Result/Event/放行额度/库存/审计持久；停服备份 `backup-20260726T062301Z-4a638522b7ca` 校验并恢复到新空库，精确核对 `22:2:4:4:12:10:10:0:0:0` |
| 清理/资源 | PASS | 主库 22 migrations、唯一启用管理员、业务表与 uploads/attachments 0；仅 PostgreSQL/Web/Worker 三容器和四卷；临时数据库、备份、恢复目录、容器和镜像已删除 |
| Python/SQLite | PASS / PROTECTED | Python systemd active、PID `277640`、监听 18888；真实 SQLite 只核验 metadata `64769:53827608:1784999031:1544192`，未读取/修改业务正文且未重启 |
| 排除事项 | ENFORCED | 未执行 Shipment、库存扣减、销售金额来源、AR、收款、真实迁移、HTTPS/80/443、切流、生产部署、push 或 PR |
| 完成结论 | PASS | `PRODUCTION QUALITY RELEASE ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE4-TASK07 生产报工 → 分批完工 → 成品入库

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 功能提交 `323e85d44a2a4202811944591d0a4f6b96ae6751` 严格基于 `26ccb95782478645720c8284c59b0afadca68649`；独立 ops 验收提交以 Git log 为准 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | 源码和并行环境均为 `0.1.0-alpha.21`；`0021` SHA-256/数据库 checksum `1cf953d98da2d3a7703f3866b852cbe10bdb37b33e1826cb78b24079fc5a11ec`；0001—0020 未修改，Schema/journal/snapshot 一致 |
| 关系与事务 | PASS | 复用既有 Report/Completion/Inventory；Allocation 显式消费 good，Completion 与成品 Ledger/Balance、工单状态、事件、审计和幂等同事务 |
| 规则与保护 | PASS | 领料支持量、good/scrap、Report/工单余量、CAS/并发/幂等/故障回滚、403、scrap 零库存以及 IPQC/FQC/Shipment 冲销门禁均通过隔离测试 |
| UI/Dashboard | PASS | `/production/reporting`、`/warehouse/production-completions`、工单八项进度和四项权限裁剪指标完成；待品质仅为只读提示 |
| 专项与回归 | PASS | TASK07 unit/UI/PG/migration，TASK01—TASK06、Production/Inventory/Quality/Sales/Dashboard、正式 typecheck、Schema consistency、lint/build、凭证扫描和 Python 隔离三项通过 |
| 实际 HTTP | PASS | 完整领料 10 后 Report `4/6`、Completion/Allocation/Ledger `4/6`；reported/good/completed=10、scrap=0、Balance=10、Work Order=`COMPLETED` 且不 `CLOSED` |
| 下游零事实 | PASS | IQC/IPQC/FQC、Shipment、销售金额来源、AR 均为 0；报工/入库未自动创建后续事实 |
| 重启/恢复 | PASS | 整体重启持久；接受态与干净态停服备份均校验并恢复到新空库，分别核对完整 4/6 链与 21 migrations/唯一管理员/业务 0 |
| 清理/资源 | PASS | 主库 21 migrations、唯一启用管理员、业务表合计 0、uploads/attachments 0；仅 PostgreSQL/Web/Worker 三容器和四卷，临时数据库/备份/恢复点/容器/镜像已删除 |
| 排除事项 | ENFORCED | 未创建品质、发货或财务事实；未迁真实数据、启用 HTTPS/80/443、切流、生产部署、push 或 PR |
| 完成结论 | PASS | `PRODUCTION REPORTING AND FINISHED GOODS RECEIPT ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE4-TASK06 计划 → 生产工单 → 齐套预留 → 仓库领料

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `a8272b7c968e0fdcbce017aa0e41bad281702e50`，严格 Parent `b45616e1115aab7d22d1b9a7e58f792005291524`；独立 ops 提交消息为 `ops: accept production material issue workflow in parallel environment`。PHASE0-TASK03/TASK05 保持历史 DONE |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.20`；仅新增 `0020_production_handoff_reservations.sql`，SHA-256 `1164536d51fbcf2f022c45aeab54b2b1ebc3d20cb2e4caabba9341d63fb4e182`；0001—0019 不修改，Schema/journal/snapshot/并行数据库 checksum 一致 |
| 关系模型 | PASS / ISOLATED | 版本化 Handoff/Item/Event、Handoff Item→Work Order 唯一链接、Reservation/Event；完整稳定外键、numeric/状态/digest 约束、来源 trigger、Service GUC 和不可变 guard |
| 事务复用 | PASS / ISOLATED | 交接调用既有 Production Work Order 事务入口；RELEASE 原子创建既有 BOM Snapshot/Requirement 和新 Reservation 来源事实；Issue/Return 原子复用既有 Inventory Ledger/Balance |
| 权限/API/UI | PASS / HTTP | planning 准备/提交，production 退回/接收/建单/释放，warehouse 领退料，manager/admin 管理；三条原生页面实际 HTTP 200，四项 Dashboard 待办按权限裁剪 |
| 实际主旅程 | PASS / HTTP | ACCEPTED Package 数量 10、BOM `1×10`、采购收货库存 10；v1 RETURNED→新 v2 ACCEPTED→唯一 DRAFT；DRAFT reserved/Issue/Ledger=0；RELEASE required/on-hand/reserved/available=`10/10/10/0`；领 4 后 `6/6/4`，再领 6 后 `0/0/10`、WO IN_PROGRESS、出库 Ledger 合计 -10 |
| 下游零写入 | PASS | Production Report 0、Completion 0、Finished Goods Ledger 0、IQC/IPQC/FQC 0；未触发报工、完工、成品或品质链 |
| 关键保护 | PASS | 缺料零半记录、并发预留、重复工单、超领、幂等重放/冲突、CAS、故障注入、未领取消释放、已领取消阻止、退料恢复和未授权 403 通过 |
| Migration | PASS / ISOLATED | 空库、0019→0020、重复执行、失败回滚通过；Drizzle `check` 通过 |
| 全量回归 | PASS / LOCAL+ISOLATED | TASK01—TASK05、Planning、Inventory、Production、Dashboard、14 组正式 typecheck、lint 0 error、Vinext build、凭证/环境/API coverage、Python 三项与 `git diff --check` 通过 |
| Compose/恢复 | PASS | 0019 前置备份已校验；整栈重启后 Handoff/WO/Reservation/Issue/余额及下游零事实保持；接受态 0020 停服备份恢复到新空库为 `20/2/1/1/2`；最终干净 0020 备份再次恢复为 20 migrations/唯一管理员/业务 0 |
| 清理/最终环境 | PASS | `chenyida-erp-parallel` 最终仅 PostgreSQL/Web/Worker 三容器和四个持久卷；20 migrations、唯一启用管理员、所有业务表 0、uploads/attachments 0；Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口 |
| Python/SQLite | PASS / PROTECTED | Python 三项使用隔离临时库通过；systemd `enabled/active`、PID `277640`、监听 18888；真实 SQLite metadata `64769:53827608:1784999031:1544192` 不变，Python 代码无差异且未重启 |
| 完成结论 | PASS | `PLANNING TO PRODUCTION MATERIAL ISSUE ACCEPTED IN PARALLEL ENVIRONMENT` |
| 排除事项 | ENFORCED | 报工、完工、成品库存、IQC/IPQC/FQC、发货、付款/银行/总账/税票、真实迁移、HTTPS、切流和生产部署未授权 |

## PHASE0-TASK03 统一发布、迁移与回退追踪基线复核

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 2026-07-24 原始发布基线保持不变；2026-07-26 按实际代码、Git、运行环境和只读数据库状态追加复核，独立提交消息为 `docs: establish self-hosted release tracking baseline` |
| Git 起点 | PASS | `main` / `3ae79f167a22bd8c5bb8120e2b5e8356f59d89b4`，起始工作区 clean；`git ls-remote` 核验 `origin/main=39946f6b854a985b5c19106eaa6c938bddaf9c7c`，任务开始时本地领先 27 个提交 |
| 发布版本 | PASS / NON-PRODUCTION | 原始自托管发布定义保留为 `0.1.0-alpha.1`/PG `0001`—`0005`；当前 package 与 lock 根包均为 `chenyida-erp-selfhosted@0.1.0-alpha.19`，没有修改 package 或依赖 |
| Migration | PASS / READ-ONLY | PostgreSQL 仓库及并行库均为 `0001`—`0019` 且 19 个 checksum 一致；D1 仓库为 `0000`—`0008`；SQLite 仓库及本机只读记录均为 `0001`—`0004` |
| 运行面 | PASS / READ-ONLY | Python systemd `enabled/active`，PID `277640`、`0.0.0.0:18888`，部署 unit 与仓库源码 SHA-256 一致；并行 Compose PostgreSQL/Web healthy、Worker running，Web 仅 `127.0.0.1:3000`、PostgreSQL 无宿主端口 |
| 业务迁移 | NOT MIGRATED | Node/PostgreSQL 已有完整 ERP API 非生产实现及合成/并行验收，但真实业务数据、账号和文件未迁移；采购、库存、生产、销售、品质、财务的实际业务继续依赖 Python/SQLite |
| Node 验证 | PASS | 一次性 Node 22 容器：lint 0 error/5 个既有 warning；`npm test` 3/3；`typecheck:review`；Vinext build 5/5；凭证扫描 819 个仓库文件。凭证扫描首次因只挂载子目录导致非 Git 工作区而未执行，改为只读挂载完整仓库后通过，未降低断言 |
| Python 验证 | PASS | `/opt/erp/.venv/bin/python`：`server.py --self-test`、`smoke_test.py`、临时 `CYD_ERP_DB` 的 `go_live_check.py --no-backup` 全部通过；临时数据库已清理 |
| 范围检查 | PASS | 仅修改项目/任务/自托管文档；未修改业务代码、Schema、migration、package、依赖或部署配置；`git diff --check` 与最终 diff 范围在提交前复核 |
| 生产影响 | NONE | 未访问公开生产 Site、生产 D1 或生产数据库；未部署、未迁移真实数据、未创建云资源、未修改或重启 systemd、未 push 或创建 PR |
| 下一任务 | HISTORICAL STOP | PHASE0-TASK03 当时已停止；之后 TASK06 由项目负责人单独明确授权。真实迁移、HTTPS、生产备份恢复、容量、安全整改和切流仍须另立任务批准 |

## SELFHOST-PHASE4-TASK05 定标 → 采购订单 → 收货 → 应付交接

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 功能提交 `859454c97acddbff8c5199d91c41d636a6ca24e0`；独立 ops 验收提交 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.19`；仅新增 `0019_sourcing_purchase_fulfillment.sql`；SHA-256 `6e517f6d2beffc74c94dcd5c5d60c9bcdc5baf9c93711a6add6cec4a08ed989a`；0001—0018 不修改 |
| 关系模型 | PASS | Award Line→PO Line 唯一来源、到货计划/待入库队列、Receipt Line 分配和不可变状态事件；外键、唯一约束、numeric 精度、索引和数据库 guard 完整 |
| 事务复用 | PASS | 编排服务在同一事务调用既有 Procurement/Inventory 权威入口，原子提交 Receipt、PO/Plan、Ledger/Balance、purchase source、Event/Audit/Idempotency；Finance 仍显式创建 AP |
| 权限/API | PASS | purchase 转单/计划、warehouse 收货/按规则冲销、finance 生成 AP，manager/admin 管理；无权限请求 403；CSRF、正文上限、持久幂等、CAS、行锁和稳定错误通过 |
| UI/Dashboard | PASS | `/procurement/fulfillment`、`/warehouse/receiving`、`/finance/payables` 均实际 HTTP 200 且可操作；Dashboard 区分“已收货待生成应付”和“已生成应付” |
| 实际数量金额 | PASS | Award/PO/Plan `10 × 12 CNY`；计划时 Receipt/Ledger/AP=0；首收 4→PARTIAL/库存4/来源48/AP48；次收6→COMPLETED/PO RECEIVED/库存10/来源72/AP72；AP 总额120 |
| 保护/并发 | PASS | 同正文重放、异正文冲突、CAS、并发唯一转单、超收、故障注入零半记录通过；有 PO 阻止 Award 撤销，有 AP 阻止 Receipt 冲销 |
| 专项/共享回归 | PASS | TASK05 unit/UI/PG/migration；TASK01—TASK04、Identity、Master Data、Supplier Mapping、Procurement、Inventory、Finance、Dashboard、FileStorage、环境与 Worker 回归通过 |
| 静态与构建 | PASS | 全部正式 typecheck、Schema consistency、ESLint 0 error/5 既有 warning、Vinext build 5/5、凭证扫描、`git diff --check` |
| 备份/重启/恢复 | PASS | 0018 前置恢复点和干净 0019 恢复点校验；Compose 整体重启后全链持久；停服备份恢复到第二个新空库为 19 migrations/唯一用户，随后恢复当前干净 0019 |
| 清理/最终数据库 | PASS | 19 migrations、唯一启用管理员、0 临时账号；Customer/Product/Material/BOM/Project/Planning/PR/RFQ/Award/PO/Plan/Receipt/Ledger/Balance/Source/AP 均为 0，uploads/attachments 文件为 0 |
| Python/SQLite | PASS / PROTECTED | Python 三项通过；PID `277640`、18888 HTTP 200；真实 SQLite metadata `64769:53827608:1784999031:1544192` 不变且未读业务正文 |
| Compose/资源 | PASS | PostgreSQL/Web healthy、Worker running；Web 仅 `127.0.0.1:3000`，PG 无宿主端口；最终三容器约 233.1 MiB，宿主可用内存约 2.12 GiB、磁盘可用约 25 GiB |
| 完成结论 | PASS | `SOURCING TO PAYABLE HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`；未启动 TASK06 |

## SELFHOST-PHASE4-TASK04 供应商询价、报价、比价与人工定标

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 功能提交 `4506db2579c07080afe27b33bb2e50623c3d1366`；独立 ops 验收提交 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.18`；expand-only `0018_procurement_sourcing.sql`；SHA-256 `64276e1292c0696ae097a322115662b958156ba6486b1cd16752cf84b6c987c9`；0001—0017 不修改 |
| 模型/比较 | PASS | 十表关系模型；CNY/Unit/Tax/Freight 分组，PostgreSQL numeric 按单价/交期/Supplier ID 排序；过期不排名，浏览器不重算 |
| API/安全 | PASS | 9 组路由、purchase/planning 分权、CSRF、128 KiB、持久幂等、CAS、并发唯一、request_id、Audit/Event 同事务 |
| UI/Dashboard | PASS | `/procurement/sourcing` 与详情页；报价历史、横向比较、MOQ/交期/税费/运费、人工理由/撤销；三项 Dashboard 待办 |
| 专项 | PASS | unit/UI 6/6、PG/API 2/2、migration 3/3、Schema consistency、目标 typecheck；覆盖两供应商、两次修订、过期/口径/MOQ/晚交期、非最低价、SOLE_SOURCE、并发与故障回滚 |
| 共享回归 | PASS | Identity、Supplier Mapping/Master Data、Procurement、Project、Planning、Material Requirement、Dashboard 的 unit/UI/PG/migration 通过；FileStorage 3/3、API coverage 2/2、environment 6/6 |
| 静态与构建 | PASS | 全仓 ESLint 0 error（5 个既有 warning）、Vinext build 5/5、800 文件凭证扫描、`git diff --check` |
| Python/SQLite | PASS / PROTECTED | Python self-test、smoke、临时 SQLite go-live 通过；PID `277640`/18888 保持，真实 SQLite metadata `64769:53827608:1784999031:1544192` 不变，未读业务内容 |
| 下游保护 | PASS | 隔离验收 Award=1 时 PO/Receipt/Inventory Ledger/Finance/Planning Allocation 均为 0，`reserved_qty` 不变 |
| 实际定标 | PASS | A `12.000000`/排名 2/准时，B `10.000000`/排名 1/晚交；以 `DELIVERY_PRIORITY` 和“交期优先，避免项目延期”人工选择 A；5 个 Sourcing Event、6 个成功采购审计 |
| 并行环境 | PASS | 0017 与干净 0018 root-only 恢复点均校验；真实 HTTP、planning 只读/purchase 写入、UI 200、幂等重放、Compose 整体重启持久通过；随后整体恢复干净 0018 点并删除临时工件 |
| 清理/最终状态 | PASS | 18 migrations/唯一启用管理员；临时账号及 Customer/Supplier/Material/Project/PR/RFQ/Quote/Comparison/Award 全为 0；PO/Receipt/Inventory/Finance/Planning Allocation 全为 0 |
| Compose/资源 | PASS | PostgreSQL/Web healthy、Worker running；Web 仅 `127.0.0.1:3000`；三容器约 180.4 MiB，宿主可用内存约 1812 MiB、磁盘可用 27 GiB |
| 完成结论 | PASS | `PROCUREMENT SOURCING AWARD ACCEPTED IN PARALLEL ENVIRONMENT`；TASK05 不启动 |

## SELFHOST-PHASE4-TASK03 计划物料需求 → 采购申请交接

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 功能提交 `5009b9118901a01af6a5faed194b8444d0c1e969`；独立 ops 验收提交 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.17`；并行 PostgreSQL `0001`—`0017`；`0017` SHA-256 `33cb162e5e32aeaca015a9d6e25a33f048166c7c895ebbc242819f6bbe2b6b28`；0001—0016 未修改 |
| 来源/数量 | PASS | 只读取最新 ACCEPTED Package 固化快照，Material+Unit 聚合；全部数量由 PostgreSQL `numeric(24,6)` 计算与保存 |
| 分配/并发 | PASS | 提交时锁定重算；其他有效计划库存/在途分配扣减，双计划不重复占用；Planning Allocation 不修改 Inventory `reserved_qty` |
| 状态/不可变 | PASS | DRAFT→SUBMITTED→RETURNED；新 v2→SUBMITTED→ACCEPTED；计划行、分配、申请行、事件不可变，退回后旧分配不再有效 |
| API/安全 | PASS | 7 组路由、planning/purchase 分权、manager/admin 全能力、CSRF、持久幂等、稳定冲突、request_id、Audit 和单事务 |
| UI/Dashboard | PASS | 计划需求和采购接收两条原生路由；已接收包、版本、重算结果、分配、事件、待采购接收指标可见 |
| 专项/共享回归 | PASS | TASK03 unit/UI 6/6、PG/API 3/3、migration 3/3；TASK02 12/12、Dashboard PG 2/2、migration tool 8/8、FileStorage 3/3、相关单元 34/34 |
| 静态与构建 | PASS | TASK03 typecheck、全仓 ESLint、Vinext 5/5 build、780 文件凭证扫描、`git diff --check` |
| 实际核算 | PASS | `100.000000 - 55.000000 - 40.000000 = 5.000000`；v1 退回释放，v2 重算重提并接收；`reserved_qty=10.000000` 不变 |
| 下游边界 | PASS | 接收不新增 RFQ/供应商/比价/PO；新增 PO 0、Receipt 0、Work Order 0，不进入生产 |
| 持久/恢复 | PASS | Compose 重启后 v2 Plan/PR ACCEPTED；恢复干净 `0016` 点后重新应用 `0017`，最终 17 migrations/唯一管理员/业务 0 |
| Python/SQLite | PASS / PROTECTED | Python PID `277640` alive、18888 HTTP 200；Python 三项通过，未读取或修改真实 SQLite 业务内容 |
| Compose/资源 | PASS | PostgreSQL/Web healthy、Worker running、仅回环 3000；三容器约 293.5 MiB，宿主可用内存约 1749 MiB、磁盘 29 GiB |
| 完成结论 | PASS | `PLANNING MATERIAL REQUIREMENT TO PURCHASE REQUEST ACCEPTED IN PARALLEL ENVIRONMENT`；TASK04 不自动启动 |

## SELFHOST-PHASE4-TASK02 项目 → 计划交接

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 功能提交 `9236884f6cd96385c9c7050b29f57e7268142208`；独立 ops 验收提交 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.16`；并行 PostgreSQL `0001`—`0016`；`0016` SHA-256 `26d6e4cc609a53403b377d8550fcf5d8fd88f677178681f4cca1692544bb2076`；0001—0015 未修改 |
| 角色/权限 | PASS | planning 正式角色；engineering prepare/submit，planning accept，manager/admin 全部；production 无接收/提交能力 |
| 状态/快照 | PASS | DRAFT→SUBMITTED→RETURNED；新 v2→RESUBMITTED→ACCEPTED；Product/BOM/Material/文件安全快照不可变 |
| API/安全 | PASS | 8 API、CSRF、正文上限、持久幂等、CAS、并发唯一接收、职责分离、单事务 Audit/request_id |
| UI | PASS | engineering 解析/预览/历史/重提，planning 待办/详情/退回/接收/历史，Dashboard 计划部门入口 |
| 专项 | PASS | unit/UI 6/6、PostgreSQL/API 3/3、migration upgrade 3/3；故障注入零半记录、文件路径/正文不披露 |
| 共享回归 | PASS | Identity/Master/Material/Project unit/UI 31/31、PG/API 21/21、migration 10/10；Dashboard 10/10、manifest 8/8、FileStorage 3/3、environment 6/6 |
| 静态与构建 | PASS | Schema consistency、TASK02 typecheck、全仓 lint、Vinext 5/5 build、761 文件凭证扫描、`git diff --check` |
| Python/SQLite | PASS / PROTECTED | 临时 SQLite self-test/smoke/go-live；PID 277640/18888 与真实 SQLite metadata `53827608:1544192:1784963637:600` 不变，未读业务内容 |
| 并行环境 | PASS | 真实 HTTP 完成项目接收、解析、v1 提交/退回、v2 修订重提/最终接收；Compose 重启后数据库、队列 API 与 UI 持久 |
| 清理/最终状态 | PASS | 恢复干净 0016 点；16 migrations、唯一启用管理员；临时账号及 Customer/Product/Material/BOM/Project/Planning/采购/生产记录为 0 |
| Compose/资源 | PASS | PostgreSQL/Web healthy、Worker running；三容器约 133 MiB，宿主可用内存约 1971 MiB、磁盘可用 31 GiB |
| 下游边界 | PASS | 未计算净需求，未创建物料需求、采购申请、采购订单或生产事实；不自动启动 TASK03 |
| 完成结论 | PASS | `PROJECT TO PLANNING HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE4-TASK01 市场 → 项目交接

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 功能提交 `6bbec3f490033dcfef0dd00d3c8af179f5674b60`；独立 ops 验收提交 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.15`；`0015` SHA-256 `419a80cb1ec3daad614f23b89895c9e8e3679bee40f506b0d0a811aba98a546f`；0001—0014 未修改 |
| 状态机 | PASS | DRAFT→SUBMITTED→ACCEPTED、SUBMITTED→RETURNED→修订→RESUBMITTED→ACCEPTED；需求/事件不可变 |
| API/安全 | PASS | sales/engineering 分权、CSRF、持久幂等/CAS、并发一次接收、职责分离、事务 Audit/request_id、文件安全引用 |
| UI | PASS | 市场/项目两条原生路由、加载/空/错误/权限/刷新恢复、退回原因和安全元数据合同通过 |
| Migration | PASS | 空库 0001→0015、0014 管理员升级、重复执行、失败回滚、约束/索引/服务写守卫 3/3 |
| 专项/共享回归 | PASS | Project unit/UI 7/7、PG/API 3/3；Identity/Master/Sales unit/UI 21/21、PG/API 14/14；manifest 8/8 |
| 静态与构建 | PASS | TASK01 typecheck、全仓 lint、Vinext build 5/5、凭证扫描、`git diff --check` |
| Python/SQLite | PASS / PROTECTED | 临时 SQLite self-test/smoke/go-live 通过；PID 277640/18888 保持；真实 SQLite 只做 metadata stat，未读取或修改 |
| 实际闭环 | PASS | 双账号覆盖直接接收与退回→需求 v2→重提→最终接收；重启后 2 ACCEPTED/3版本/完整事件/9 Audit 持久 |
| 清理/最终状态 | PASS | 恢复 0015 空数据点；15 migrations、唯一管理员；临时账号/Customer/Project/Event=0；Web/PG healthy、Worker running |
| 完成结论 | PASS | `MARKET TO PROJECT HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE3-TASK05 同机并行 HTTP 验收环境

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 恢复点 | PASS | `main`、父提交 `7c39ff9b2c50786a225fe788ec5e3b6fb9f91dc2`；独立提交消息 `ops: deploy parallel self-hosted acceptance environment` |
| Compose | PASS / RUNNING | 项目 `chenyida-erp-parallel`；PostgreSQL healthy、migrate exited 0、Web healthy、Worker running，四个持久 Volume 保留 |
| HTTP 安全边界 | PASS | `ERP_ENV=development`；Web 仅 `127.0.0.1:3000`，通过 SSH 隧道验收；PostgreSQL 无宿主端口，Caddy/80/443/DNS/防火墙未变 |
| Migration/版本 | PASS | PostgreSQL 17.10；`0001`—`0014` 共 14 个；版本保持 `0.1.0-alpha.14`，未创建 `0015` |
| 管理员 | PASS | 唯一 `admin`，重复初始化 `SETUP_COMPLETE`；setup token 已轮换；临时密码只存 root-only 0600 文件且未进长期 env/Git |
| HTTP 验收 | PASS | health、根工作台、login/session/logout、空 Dashboard、23/23 legacy GET 均通过；0 个物料、无真实业务数据 |
| Worker 重启韧性 | PASS | 修复 PostgreSQL restart 的 Pool `57P01` 未捕获错误；专项 2/2、typecheck/lint/build、Worker 容器连续性与最终 HTTP 回归通过 |
| 资源 | PASS | 最终可用内存约 2.2GiB、swap 约 441MiB 已用且 20 秒复测未继续增长、磁盘可用 36GB、load `0.63/0.90/0.85`；三常驻容器约 145MiB，未触发停止条件 |
| Python/SQLite | PASS / UNCHANGED | PID `277640`、18888 HTTP 200；SQLite inode `53827608`、mode 0600、size 1544192 bytes、mtime 不变；未读取/迁移/修改真实业务数据 |
| 完成结论 | PASS | `PARALLEL HTTP ACCEPTANCE ENVIRONMENT RUNNING`；未切流、未启 HTTPS、未生产上线、未 push/PR |

## SELFHOST-PHASE3-TASK04 本机真实 SQLite 只读盘点与脱敏 Dry-run

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 恢复点 | PASS | `main`、可信起点 `a541360eefe12869c090b2408bbcf07485fc77cb`；独立提交消息 `feat: add authorized readonly migration inventory` |
| 只读快照 | PASS | SQLite online backup；`integrity_check=ok`；29 表、3,619 条、Schema fingerprint 已完成；源 inode/mode/权限不变 |
| 运行面保护 | PASS | Python PID 前后 `277640`；未停止/重启；快照与临时目录已删除、不可恢复 |
| 脱敏 Dry-run | PASS | planned 49、archive-only 3,566、needs-review 4、blocked/model-gap/orphan 0；target `NONE`，materialization/files `DISABLED` |
| Opening 计划 | PASS / NOT MATERIALIZED | Inventory 4 条、on-hand 20,010、frozen 0；Finance 0；创建数均为 0 |
| 报告安全 | PASS | 只保留聚合和 opaque reference 模板；绝对源路径、source ID、PII/业务正文、凭证和逐单金额未入报告 |
| 专项/回归 | PASS | TASK04 3/3、tool 8/8、unit/UI 98/98、npm 3/3、PG/API 73、upgrade 30、backup/restore、全 HTTP journey、8 组 typecheck、lint/build/environment/credentials 与 Python 三项通过 |
| Migration/版本 | PASS / NOT RELEASED | `0.1.0-alpha.14`；保持 0001—0014、未创建 0015，checksum 与 `db/schema.ts` 不变；未发布或部署 |
| 完成结论 | PASS | `REAL LOCAL SQLITE READONLY INVENTORY COMPLETE` |
| 生产准入 | NO-GO | 未执行真实 PostgreSQL 试迁移、D1/文件盘点、附件核对、生产恢复、部署或切换 |

## SELFHOST-PHASE3-TASK03 合成全域业务表物化与 Dashboard 核对

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 恢复点 | PASS | `main`、可信起点 `8f30798464476b53f435d53022c45ed731804e95`；独立提交消息 `feat: materialize synthetic migration into business tables` |
| Public materializer | PASS | 仅显式 CLI；30 条合成来源形成 18 个 actual public targets、12 个 archive-only；actual ID/source/target digest、request/operation/checkpoint 齐全 |
| Identity/主数据/BOM | PASS | 迁移账号 disabled+must-change 且无旧 hash；稳定 Unit/Category/Material/Party/Product/Version/Mapping/BOM ID；code/引用/有效期冲突 fail closed |
| Opening/文件 | PASS | Inventory on-hand/frozen `112.000000/4.000000`；Opening AR/AP `6.500000/7.250000`；17-byte 文件原子写与 SHA `19ae05a8872e4000652f2efe7e9123cfc5e64aa2d69f9afb5511f80e21d66346` |
| Post-cutover journey | PASS | 正常 Service/API 完成 Procurement、Production、Sales、IQC/IPQC/FQC 和 Finance；不重放来源历史活动 |
| Dashboard/API | PASS | AR/AP `56.500001/27.250000`，Quality CLOSED 4，23/23 legacy GET；角色裁剪通过，`erp_records=0` |
| 恢复/重放 | PASS | backup/verify→第二个新空目标；14 migrations、18 maps、关键业务表和文件 SHA 一致；同 manifest replay 无重复，PG/Web/Worker 整体重启后再核对通过 |
| 专项/回归 | PASS | tool 8/8、materializer PG 3/3、Opening/TASK01 专项、TASK02—TASK10 unit/UI、全部 PG/API 与 migration upgrade、8 组 typecheck、Schema consistency、npm test、lint/build/environment/credentials、Python 三项 |
| Migration/版本 | PASS / NOT RELEASED | `0.1.0-alpha.13`；保持 0001—0014、未创建 0015、旧 checksum 与 `db/schema.ts` 不变；未发布或部署 |
| 合成结论 | PASS | `PASS FOR SYNTHETIC PUBLIC-TABLE MATERIALIZATION` |
| 生产准入 | NO-GO | 未读取真实 source/账号/历史活动/文件，未验证真实容量、安全、生产恢复或切换；`NO-GO FOR REAL DATA / PRODUCTION` |
| 资源/生产影响 | NONE | TASK03 临时 Compose/数据库/文件/备份最终清理；Python PID `277640` 未重启，未访问生产、部署、push 或 PR |

## SELFHOST-PHASE3-TASK02 库存与财务期初来源及迁移物化边界

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 恢复点 | PASS | `main`、可信起点 `2c808f7a2ba2c293ff22e5dcc3ca3647a479a91c`；独立提交消息 `feat: add controlled migration opening balances` |
| MG-001 | RESOLVED IN SYNTHETIC NON-PRODUCTION MODEL | 关系化 `OPENING_AR/AP`，不伪造 Shipment/Receipt；主体互斥、CNY、正数六位金额、核销/冲销和 Dashboard 通过 |
| MG-002 | RESOLVED IN SYNTHETIC NON-PRODUCTION MODEL | `MIGRATION_OPENING` Adjustment/Ledger/Balance 同事务；Base Unit、MAIN/空 lot、冻结边界、消费后冲销拒绝通过 |
| Migration | PASS | expand-only `0014_migration_openings.sql`，SHA-256 `61f65ef3d588bfbf178f3dd9ba196886fa18fb3ecca119a151f6a3bc0bc5a99b`；空库/0013升级/重复/失败回滚/零回填通过，旧 checksum 不变 |
| 安全/事务 | PASS | 无 HTTP 写路由；内部 GUC + DB trigger；digest conflict、幂等、并发和注入失败整体回滚通过 |
| 合成核对 | PASS | 4 来源；库存 2 条、Ledger/Balance 均为 on-hand `112.000000` / frozen `4.000000`；AR `6.500000 CNY`、AP `7.250000 CNY` |
| 专项/回归 | PASS | unit 3/3、PG 2/2、migration 3/3、tool 8/8；既有 PG/API 42/42、Material/Mapping/Normalization/Review 20/20、upgrade 30/30；typecheck/build/lint/environment/credentials/Python 三项通过 |
| Compose/恢复 | PASS | PostgreSQL/Web/Worker 构建、健康和重启通过；停服 backup/verify 恢复到全新空库后 14 migrations、来源、Ledger/Balance、AR/AP 全部一致 |
| 版本 | PASS / NOT RELEASED | `chenyida-erp-selfhosted@0.1.0-alpha.12`；未发布、部署、迁真实数据或批准生产 |
| 生产准入 | NO-GO | 未读取真实源，未验证真实余额/主体/单位/冻结/规模/附件/异故障域；`NO-GO FOR REAL DATA / PRODUCTION` |
| 资源/生产影响 | NONE | 隔离容器/网络/卷/数据库/备份/临时目录已清理；Python PID `277640` 未重启，未访问生产、部署、push 或 PR |

## SELFHOST-PHASE3-TASK01 生产前数据迁移框架与合成试迁移

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 恢复点 | PASS | `main`、起点 `14bc68791a34ece9086b889f23d473e84a761cf0`；独立提交消息 `feat: add synthetic migration readiness tooling` |
| 迁移框架 | PASS | 显式 CLI、SQLite/D1 export、manifest、mapping/ID map、digest checkpoint、dry-run、synthetic commit、reconcile、去敏报告 |
| 安全守卫 | PASS | source read/target connect 前拒绝 production、真实路径、非回环/非测试/非空目标、备份/上传/附件/归档和敏感 manifest 字段 |
| 合成 E2E | PASS | 28 records、45 relations、28 ID maps、0 orphan；库存 `112.000000`、AR/AP `19.000000`；中断恢复和重复执行后 `RECONCILED` |
| Backup/Compose | PASS | 新空目标 restore 后 13 migrations 与合成 staging 一致；PostgreSQL/Web/Worker 重启后健康和数据保持 |
| 专项/回归 | PASS | tool 8/8、PG E2E 1/1、非数据库 87/87、PG/API 67/67、upgrade 27/27、typecheck 8/8、build/lint/credentials 与 Python 三项 |
| PostgreSQL migration | PASS / NO CHANGE | 0001—0013 checksum 不变，head `0013_finance.sql`，未创建 `0014`，业务 schema 未修改 |
| 版本 | PASS / NOT RELEASED | `chenyida-erp-selfhosted@0.1.0-alpha.11`；非生产、尚未发布、部署、迁真实数据或批准 |
| 生产准入 | NO-GO | staging 未物化真实业务表；真实 source、Dashboard、Finance opening、文件、容量和生产恢复未验证 |
| 资源/生产影响 | NONE | 最终清理隔离 PostgreSQL/Compose/临时目录；未打开真实数据库、重启 Python、访问生产、部署、push 或创建 PR |

## SELFHOST-PHASE2-TASK10 自托管经营与运维工作台

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 恢复点 | PASS | `main`、起点 `06a4413403869f4f41872c7a5cb98c434a44f095`；任务独立提交消息 `feat: add self-hosted operations workbench` |
| Dashboard | PASS | 独立实时只读 Query Service；TASK02—TASK09 权威关系表、权限裁剪、numeric 文本、库存不跨单位聚合、系统审计最小披露 |
| 根工作台/legacy | PASS | 根 `/` 无 iframe；setup/login/must-change/logout 与卡片独立状态通过；`/erp/index.html` 仅显式白名单 tab 深链 |
| API 覆盖 | PASS | Python 64 项最终为 COVERED 52、REPLACED 2、RETIRED 10、未知/404 0；legacy 23 个刷新 GET 在源全域库和恢复目标均逐项运行 200；浏览器备份 create/restore 返回稳定离线操作错误 |
| Backup/restore | PASS | custom dump、文件 tar、manifest、migration/SHA/size 校验；隔离 PostgreSQL 新空目标恢复 13 个 migration 与合成文件逐字节一致；危险/损坏/非空目标拒绝 |
| Compose | PASS | 空卷依次贯穿 TASK02→TASK10；恢复到第二个新空 Compose 后 PostgreSQL/Web/Worker 整体重启，角色裁剪、23 GET、`0013`、跨域事实、Session、文件 SHA 和 backup `VERIFIED` 持久 |
| 专项/回归 | PASS | Dashboard unit/UI/coverage 10/10；全量非数据库 selfhost 87/87、PostgreSQL/API 67/67、migration upgrade 27/27、environment 6/6、TASK03—TASK10 typecheck、build、lint 0 error/1 条既有 warning、623 文件凭证与 Python 三项通过 |
| PostgreSQL migration | PASS / NO CHANGE | 保持 `0001`—`0013`；实时查询不需要 projection/outbox，未创建 `0014` |
| 版本 | PASS / NOT RELEASED | `chenyida-erp-selfhosted@0.1.0-alpha.10`；非生产、尚未发布、部署或批准 |
| 资源/生产影响 | NONE | TASK10 隔离 PostgreSQL/Compose/临时文件在最终核对后清理；未访问生产、迁真实数据、执行生产备份恢复、部署、push 或 PR |

## SELFHOST-PHASE2-TASK09 自托管应收应付与不可变收付款

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 恢复点 | PASS | `main`、起点 `ee3e6585d5f0366187f62ef3f6012c3abaf28150`；0001—0012 checksum 保持不变 |
| 模块/数据边界 | PASS | 独立 `finance-selfhost`；AR=Shipment 金额来源、AP=Receipt 金额来源，稳定 Customer/Supplier/User ID，不写 D1/`erp_records` |
| 金额/状态/不可变 | PASS | PostgreSQL numeric(24,6)；OPEN/PARTIALLY_SETTLED/SETTLED，Document 事实与 Settlement/Event append-only，直接数据库越权写 fail closed |
| 收付款/冲销 | PASS | 每笔核销单一 Document、不超余额、expected version；原 Receipt/Payment 最多一次全额负事实冲销，投影和 Event 同事务恢复 |
| 上游门禁 | PASS | 已形成财务 Document 的 Shipment/Receipt 来源不能再由 Sales/Procurement 直接冲销；未财务过账的既有冲销流程回归通过 |
| 权限与安全 | PASS | post/pay/reverse 与 scoped read 分离；must-change、CSRF、正文上限、持久幂等、限流、CAS、请求编号、中文安全错误和事务审计通过 |
| PostgreSQL migration | PASS | `0013` 空库、0012 存量、重复、失败回滚、约束/索引/guard、legacy 保留通过；SHA-256 `8c52efe69d836fadf4f2841caab6dad140c51d0b78e37612cbcbac46076c45a1` |
| 专项/Compose | PASS | Finance unit/UI 4/4、PG/API 3/3、migration 3/3；Compose 首次及 Web/Worker 重启持久性通过 |
| 适用回归 | PASS | Procurement PG 7/7、Sales 3/3、Quality 8/8、FileStorage 3/3、environment 6/6、lint/typecheck/build/credentials、Python 三项通过 |
| 版本 | PASS / NOT RELEASED | `chenyida-erp-selfhosted@0.1.0-alpha.9`；非生产、尚未发布、部署或批准 |
| 资源/生产影响 | NONE | TASK09 Compose 容器/网络/卷、隔离 PostgreSQL 和临时 SQLite 均已清理；未访问生产、迁真实金额、部署、push 或 PR |

## SELFHOST-PHASE2-TASK08 自托管品质闭环与 FQC 发货门禁

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 恢复点 | PASS | `main`、起点 `0ad0687a7b2f2502f68babbef1455df2a983421b`；0001—0011 checksum 保持不变 |
| 模块/数据边界 | PASS | 独立 `quality-selfhost`；IQC=Receipt Line、IPQC=Production Report、FQC=Completion Line+SO Line，稳定 Material/Unit/User ID，不写 D1/`erp_records` |
| 状态与不可变 | PASS | OPEN/PENDING、异人处置、关闭、manager/admin 重开；Result/Defect/Event append-only，Header 仅受控投影，直接数据库越权写 fail closed |
| FQC 联动 | PASS | Shipment 只消费 CLOSED/RELEASED 额度；不足阻断、冲销恢复额度、已消费时禁止重开；与 SO/Inventory 原事务及锁顺序整合 |
| IQC/IPQC 边界 | PASS | 只建立 Receipt Line/Report 品质权威记录，不改已过账采购/生产事实；无批次/隔离库位时不伪造 pooled inventory freeze |
| 权限与安全 | PASS | read/inspect/defect/disposition/close/reopen 分离；职责分离、must-change、CSRF、正文上限、持久幂等、限流、CAS、请求编号和事务审计通过 |
| PostgreSQL migration | PASS | `0012` 空库、0011 存量、重复、失败回滚、约束/索引/guard、legacy 保留通过；SHA-256 `64f065783769c0913af482402199b10f9224a1a81e52c30a3b8a087978bcd5bf` |
| 专项/Compose | PASS | unit/UI 5/5、Quality PG/API 8/8、migration 3/3、Sales PG 3/3；Compose 初始及 Web/Worker 重启持久性通过 |
| 适用回归 | PASS | shared unit/UI 70/70、Identity/Master/Inventory/Procurement/Production PG、FileStorage 3/3、environment 6/6、lint/typecheck/build/credentials、Python 三项通过 |
| 版本 | PASS / NOT RELEASED | `chenyida-erp-selfhosted@0.1.0-alpha.8`；非生产、尚未发布、部署或批准 |
| 资源/生产影响 | NONE | TASK08 Compose 容器/网络/卷和隔离测试资源已清理；未访问生产、迁真实检验数据、部署、push 或 PR |

## SELFHOST-PHASE2-TASK07 自托管销售与库存联动

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 恢复点 | PASS | `main`、起点 `97d541ecfb7fe6fff551c750c69f5cf30e3ff5bc`；合法 TASK07 dirty 全部保留并原地续作，0001—0010 无变化 |
| 模块/数据边界 | PASS | 独立 `sales-selfhost`；稳定 Customer/Product Version/Material/Unit/Inventory/User ID，不写 Python、D1 或 `erp_records` |
| 报价/转单 | PASS | DRAFT Version/Line、显式状态事件、只有 ACCEPTED 可原子转换一次；SO/Link/投影/audit/idem 同事务 |
| 发货/冲销原子性 | PASS | Shipment/全额 reversal、SO 投影、TASK04 Ledger/Balance、状态、金额来源、audit、idem 同事务；故障注入和审计失败整体回滚 |
| 金额/约束/并发 | PASS | CNY numeric(24,6) 服务端计算；ACTIVE/STOCKED/基础单位/客户限制、超发/负库存、并发编码/转换/发货和 expected version 均 fail closed |
| 权限与兼容 | PASS | quote/order/ship/reverse/finance source 服务端分离；legacy API/UI 只转换稳定 ID 并委托同一 Service，CSRF/限流/请求编号/中文错误通过 |
| PostgreSQL migration | PASS | `0011` 空库、0010 存量、重复、失败回滚、约束/索引/不可变 guard、旧数据保留通过；SHA-256 `6d97c854ecd2fd47f4540c0403de097332f406c7d9f5155c2355dd44d5a57e3b`，0001—0010 不变 |
| 专项/Compose | PASS | unit/UI 5/5、PostgreSQL/API 3/3、migration 3/3、Schema consistency；Compose 初始及 PostgreSQL/Web/Worker 重启持久性通过 |
| 全量回归 | PASS | shared unit/UI 65/65、PG 54/54、升级 21/21、Import 53/53、FileStorage/environment、lint/build/typecheck/credentials、Python 三项通过 |
| 版本 | PASS / NOT RELEASED | `chenyida-erp-selfhosted@0.1.0-alpha.7`；非生产、尚未发布、部署或批准 |
| 资源/生产影响 | NONE | 隔离 PostgreSQL、Compose、临时 SQLite/文件已清理；未访问生产、迁真实销售数据、部署、push 或 PR |

## SELFHOST-PHASE2-TASK06 自托管生产与库存联动

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 恢复点 | PASS | `main`、起点 `b4a7d5cde06df0b8982e7f120afd9f72c13af8d2`、clean、本地相对 `origin/main +6/-0`；无嵌套仓库或来源不明修改 |
| 模块/数据边界 | PASS | 独立 `production-selfhost`；稳定 Product/BOM/Material/Unit/Inventory/User ID，不写 Python、D1 或 `erp_records` |
| 工单/快照 | PASS | 固定状态机、并发安全编码、RELEASE 单事务复制不可变 BOM 快照并用 PostgreSQL numeric 计算需求；新 BOM 不影响旧 WO |
| 领退料/完工原子性 | PASS | Production 事实、TASK04 Ledger/Balance、状态、audit、idem 同事务；故障注入与审计失败整体回滚 |
| 约束/并发 | PASS | 客户专用料、ACTIVE/STOCKED/基础单位、超领/超退/错误报工/超产、expected version、并发完工和幂等冲突均 fail closed |
| 权限与兼容 | PASS | plan/issue/report/complete/close 服务端分离；legacy API 只转换 DTO 并委托同一 Service，CSRF/限流/请求编号/中文错误通过 |
| PostgreSQL migration | PASS | `0010` 空库、0009 存量、重复、失败回滚、约束/索引/不可变 guard、旧数据保留通过；SHA-256 `d60c4100f726d6572a9969c78cf06f64aa2f789d3a31d3be5fd58c22fa7dec35`，0001—0009 不变 |
| 专项/Compose | PASS | unit/UI 4/4、PostgreSQL/API 5/5、migration 3/3、Schema consistency；Compose 初始及 PostgreSQL/Web/Worker 重启持久性通过 |
| 全量回归 | PASS | shared unit/UI 60/60、PG 51/51、升级 18/18、Import 53/53、FileStorage/environment、lint/build/typecheck/credentials、Python 三项通过 |
| 版本 | PASS / NOT RELEASED | `chenyida-erp-selfhosted@0.1.0-alpha.6`；非生产、尚未发布、部署或批准 |
| 资源/生产影响 | NONE | 隔离 PostgreSQL、Compose、临时 SQLite/依赖/文件已清理；未访问生产、迁真实生产数据、部署、push 或 PR |

## SELFHOST-PHASE2-TASK05 自托管采购与收货

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 恢复点 | PASS | `main`、HEAD `41b451de04d4bc4b5e3f6fe765ff64fbc19a9121`；合法 TASK05 dirty 全部保留并原地续作，0001—0008 无变化 |
| 模块/数据边界 | PASS | 独立 `procurement-selfhost`；PO/Receipt 使用稳定 Supplier/Material/Unit/Mapping ID，不写 Python、D1 或 `erp_records` |
| 状态与不可变 | PASS | `OPEN -> PARTIALLY_RECEIVED -> RECEIVED -> CLOSED`；Receipt/Line/Status/Source/Financial append-only，全额冲销追加反向事实 |
| 收货原子性 | PASS | Receipt、PO 投影、TASK04 Ledger/Balance、状态事件、财务来源、audit、idem 同一事务；故障注入/审计失败整体回滚 |
| 建议与引用 | PASS | RELEASED 当前 BOM + 可用库存 + ACTIVE Material/Supplier/Unit/Mapping + 当前价格；阻断项不自动建 PO，不允许超收或单位换算 |
| 权限与安全 | PASS | 管理/收货/只读/财务来源能力分离；must-change、CSRF、持久幂等、限流、expected version、请求编号和中文安全错误通过 |
| PostgreSQL migration | PASS | `0009` 空库、0008 存量、重复、失败回滚、约束/索引、旧数据保留通过；SHA-256 `351b322f562e39bf0e17cf16cd6da20de6d801ff33f7692300a85c15403874d7`，0001—0008 不变 |
| 专项/Compose | PASS | unit/UI 5/5、PostgreSQL/API 7/7、migration 3/3、Schema consistency；Compose 初始及 PostgreSQL/Web/Worker 重启持久性通过 |
| 全量回归 | PASS | shared unit/UI 56/56、PG 46/46、升级 15/15、Import 53/53、FileStorage/environment、lint/build/typecheck/credentials、Python 三项通过 |
| 版本 | PASS / NOT RELEASED | `chenyida-erp-selfhosted@0.1.0-alpha.5`；非生产、尚未发布、部署或批准 |
| 资源/生产影响 | NONE | 隔离 PostgreSQL、Compose、临时 SQLite/依赖/文件已清理；未访问生产、部署、push 或 PR |

## SELFHOST-PHASE2-TASK04 自托管不可变库存账本

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 起点 | PASS | `main`、HEAD `3565d56f24ca904dd0b8d0c55960c702a8895406`、clean、本地相对 `origin/main +4/-0`；无 submodule/gitlink/嵌套仓库 |
| 模块/数据边界 | PASS | 独立 `inventory-selfhost`；稳定 Material/Unit ID，旧文本库存表仅作迁移来源，不回填/双写/返回，不实现 PO/WO/SO 单据 |
| 不可变与余额 | PASS | Ledger 为权威、Balance 为同事务可核对投影；数据库拒绝直接余额写及已过账 Header/Line/Ledger UPDATE/DELETE |
| 业务与并发 | PASS | RECEIPT/ISSUE/ADJUSTMENT/FREEZE/UNFREEZE/REVERSAL；禁止负库存/负可用量，expected version、稳定多行锁、一次全额冲销和失败回滚通过 |
| API/UI/BOM | PASS | inventory/ledger/reconciliation/adjustment/detail/post/reverse；legacy 写引用稳定 ID；BOM readiness 读取新投影并返回真实 shortage |
| 权限与安全 | PASS | read/adjust/reverse 分离；Session/must-change、CSRF、正文上限、限流、24h 幂等、请求编号、安全错误及成功/失败审计通过 |
| PostgreSQL migration | PASS | `0008` 空库、0007存量、重复、强制失败回滚、约束/索引、旧用户/session/legacy库存保留通过；SHA-256 `49334afa405d03b61568559edcdffa68c232c899251181e3a27ff271aa1da80b`，0001—0007不变 |
| 专项/Compose | PASS | unit 3/3、UI 2/2、PostgreSQL/API 3/3、migration 3/3；Compose 初始与 PostgreSQL/Web/Worker 重启持久性通过，容器/网络/卷清理 |
| 适用回归 | PASS WITH BASELINE DEBT | Identity/Material/Mapping/Normalization/Review/Phase0、build/lint/typecheck/凭证、Python三项通过；旧导入 UI 未改文件的 6 条源码正则断言为起点既有失败，未跨域修补，parser/file-inspector/adaptive 49/49通过 |
| 版本 | PASS / NOT RELEASED | `chenyida-erp-selfhosted@0.1.0-alpha.4`；非生产、尚未发布、部署或批准 |
| 资源/生产影响 | NONE | 隔离资源清理；未访问生产、迁移真实库存、部署、重启 Python systemd、push 或 PR |

## SELFHOST-PHASE2-TASK03 自托管主数据与 BOM

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 起点 | PASS | `main`、HEAD `2784a9a064838ebbb76f2bce8c97ebeb1eb8befb`、clean、本地相对 `origin/main +3/-0`；无 submodule/gitlink/嵌套仓库 |
| 模块边界 | PASS | 独立 `master-data-selfhost`、`bom-selfhost`；Node/PostgreSQL 权威，不写 Python/SQLite、D1 或 `erp_records` |
| 数据模型 | PASS | Customer/Supplier/Product/Product Version/BOM Header/Version/Line 与 business code sequence 关系化；Supplier Mapping 扩展稳定 FK、状态/版本/有效期，价格历史只追加 |
| 发布不可变 | PASS | Product/BOM DRAFT→RELEASED；数据库 trigger 拒绝发布版本及 BOM Lines UPDATE/DELETE，修订创建新版本 |
| API 与 legacy 契约 | PASS | items/mappings/products/customers/suppliers/boms/bom-lines/bom-readiness 兼容路径和版本/状态/价格路径通过；ACTIVE Material 投影，readiness 不查库存 |
| 权限与安全 | PASS | sales/purchase/engineering 固定服务端能力；Session/must-change、CSRF、正文上限、60/20 限流、24h 幂等、CAS/锁、请求编号和安全错误通过 |
| 事务与审计 | PASS | 业务、审计、幂等结果同事务；失败回滚不留业务/idempotency，失败审计最小披露；并发 code 唯一、mapping 有效期不重叠 |
| PostgreSQL migration | PASS | `0007` 空库、0006升级、重复、失败回滚、约束/索引、旧用户/session/mapping 保留通过；SHA-256 `0e9cf9327b37673eb09483035117d15789047862f348cd5eb7098476d62fd3a6`，0001—0006不变 |
| 专项测试 | PASS | unit 2/2、UI 2/2、PostgreSQL/API 3/3、migration 3/3；typecheck 与 Schema consistency 通过 |
| Compose | PASS | 空库迁移与 Customer→Product→BOM→Supplier Mapping/Price E2E；PostgreSQL/Web 重启后数据和审计持久，容器/网络/卷已清理 |
| 回归 | PASS | Node 基础、Identity、Material、Mapping、Normalization、Review、Phase0 PostgreSQL/Worker、旧升级、build/lint/typecheck/凭证及 Python 三项通过 |
| 版本 | PASS / NOT RELEASED | `chenyida-erp-selfhosted@0.1.0-alpha.3`；非生产、尚未发布、部署或批准 |
| 资源/生产影响 | NONE | 隔离测试资源清理；未访问生产、迁移真实数据、部署、重启 Python systemd、push 或 PR |

## SELFHOST-PHASE2-TASK02 自托管身份安全边界

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 模块边界 | PASS | 独立 `identity-selfhost` Types/Errors/Password/Permissions/Repository/Service/Handler；`selfhost-api.ts` 只委托并注入可信 actor/全局门禁 |
| API | PASS | setup/login/logout/session 安全重构；本人改密、用户列表/创建/启停/重置及系统审计查询均通过隔离 API 测试 |
| 权限与 must-change | PASS | 十角色只由服务端映射；admin-only 管理/审计；must-change 只允许 session/logout/本人改密，Material 与其他受保护 API 统一 403 |
| 密码与 Cookie | PASS | 12—128、四类至少三类、弱口令/用户名/相同密码拒绝；PBKDF2-SHA256 310k；development HTTP 不强制 Secure，production 内部 HTTP 仍强制 Secure |
| 会话撤销 | PASS | token 只存 SHA-256；停用/重置撤销全部，本人改密保留当前并撤销其他；旧会话立即 `SESSION_REVOKED` |
| 限流/幂等/CAS | PASS | 登录 5/15min；身份写 60 attempts/20 new keys/min；完成重放不计新 Key；四接口持久幂等、异正文冲突、expected version 和失败回滚通过 |
| 并发保护 | PASS | 用户名并发唯一；事务 advisory lock + CAS 使并发停用管理员后仍至少保留一个 active admin；禁止自停用、自重置 |
| 系统审计 | PASS | admin-only、有界分页/筛选、最小 DTO；actor/target/action/result/request/operation/version/error/time 可查，无密码、Token、Cookie、hash 或正文 |
| PostgreSQL migration | PASS | `0006` 空库、0005升级、重复、失败回滚、约束/索引、旧合成用户/session 保留通过；SHA-256 `6e185d01a69c4bd132c577793ae72baceaa075e5beecc738bcdf4310430d7079`，0001—0005不变 |
| 专项测试 | PASS | unit 8/8、UI 4/4、PostgreSQL/API 8/8、migration 4/4 |
| Compose | PASS | setup→admin login→purchase创建/临时登录/must-change/改密/Material读取→停用/撤销→启用/重置/再次must-change→审计；Web/PostgreSQL 重启后 user version、审计与撤销持久 |
| 回归 | PASS | npm基础、Material、Mapping、Normalization、Review、Phase0 PostgreSQL/Worker、旧升级、typecheck、build、lint、凭证及 Python 三项通过 |
| 版本 | PASS / NOT RELEASED | `chenyida-erp-selfhosted@0.1.0-alpha.2`；非生产、尚未发布、部署或批准 |
| 资源/生产影响 | NONE | 一次性 Compose 与 PostgreSQL 资源清理；未访问生产、迁移真实用户、部署、重启 Python systemd、push 或 PR |

## SELFHOST-PHASE2-TASK01 完整 ERP API 盘点与迁移计划

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 起始基线 | PASS | 根仓库 `main`、HEAD `12d3ea30d21cce6918de0c525d81f19af289f5ac`、工作区 clean；本地 `main` 领先 `origin/main` 1 个提交 |
| 运行面结论 | CONFIRMED | Python/SQLite 仍支撑完整 ERP；Node/PostgreSQL 只完成 Material、Import Mapping、Normalization、Review，不得由已存在表推断业务 API 已迁移 |
| Python API | PASS | 共 64 个 HTTP 操作：身份与系统 11、基础主数据/工程/物料治理 22、采购与库存 9、生产 6、销售 7、品质 3、财务 6 |
| 自托管覆盖 | RECORDED | 等价覆盖 4、部分覆盖 9、未覆盖 51；“部分覆盖”不代表 legacy method/path 可用 |
| legacy iframe | BROKEN | 根页面仍加载 `/erp/index.html`；登录后 `refreshAll()` 的 23 个并发业务 GET 均不在 `selfhost-api.ts` 路由中并返回 404，整批刷新失败 |
| 数据与事务 | RECORDED | 稳定 ID、BOM 引用、库存/订单/应收应付联动、不可原地修改的过账记录，以及单事务、幂等、CAS、request id、审计要求均已列明 |
| 迁移顺序 | PROPOSED | 建议 `TASK02`—`TASK10` 依次覆盖身份、主数据、库存、采购、生产、销售、品质、财务、看板/备份/退出 iframe；均待项目负责人逐项授权 |
| 变更边界 | PASS | 仅新增/更新项目文档；未修改业务代码、Schema、migration、依赖或部署配置 |
| 验证 | PASS WITH EXISTING WARNING | lint 0 error/1 个既有 warning；npm test 3/3；review typecheck、Vinext build、凭证扫描、Python self-test/smoke/临时 SQLite go-live 与 diff check 通过 |
| 生产影响 | NONE | 未访问公开生产 Site、生产 D1 或生产数据库；未读取真实业务数据、部署、执行 migration、重启服务、push 或创建 PR |

## PHASE0-TASK03 统一发布、迁移与回退追踪基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 基线 | PASS | 任务开始时根仓库 `main`、HEAD `39946f6b854a985b5c19106eaa6c938bddaf9c7c`、工作区 clean；缓存和 `git ls-remote` 均确认 `origin/main` 同一提交；只有根 `.git` |
| TASK04 后续提交 | PASS | SELFHOST Phase 0 与 Phase 1 Task01—04 已由 `39946f6` 汇总提交；TASK04 完成报告保留原任务结束时 dirty/未提交事实并追加后续结果 |
| 发布版本 | PASS | 新自托管包名 `chenyida-erp-selfhosted`，版本 `0.1.0-alpha.1`；明确为非生产、尚未发布、未批准 |
| 运行面 | PASS | Python/SQLite systemd 开发服务 `enabled/active`，监听 `0.0.0.0:18888`；unit 源码与安装文件一致；Node/PostgreSQL 无运行中 Compose 项目 |
| PostgreSQL migration | PASS | `0001`—`0005` 文件及 SHA-256 已建立基线；只在既有隔离 PostgreSQL 17/Compose 验收，未生产执行 |
| D1 migration | PASS | 历史 `0000`—`0008` 文件及 SHA-256 已建立基线；未访问生产 D1，生产实际版本未核验 |
| SQLite migration | PASS | 文件 `0001`—`0004` 及 SHA-256 已建立基线；开发库只读记录四个版本，数据库表本身不保存 checksum |
| 业务迁移范围 | RECORDED | 自托管 API 仅完成 Material/Import/Normalization/Review 关键链路；完整 ERP 尚未迁移，采购、库存、生产、销售、品质、财务仍依赖 Python/SQLite |
| 发布/回退模板 | PASS | `RELEASES.md` 覆盖 Git/version、migration 前后、快照恢复点、四类 migration 验证、测试、安全、HTTPS、备份恢复、容量、批准执行和回退条件 |
| 本任务验证 | PASS WITH RECORDED WARNING | lint 0 error/1既有warning；npm test 3/3；review typecheck；Vinext build 5/5；凭证扫描455文件；项目虚拟环境 Python self-test/smoke/临时库go-live；diff check通过 |
| 生产影响 | NONE | 未访问公开生产 Site、生产 D1 或生产数据库；未部署、迁移真实数据、重启 systemd、创建云资源、push 或 PR |

## SELFHOST-PHASE1-TASK04 人工复核与 Material 安全衔接

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 数据分层 | PASS | Parser raw、Mapping snapshot、Normalization candidates/attributes/lineage/issues保持不可变；人工覆盖独立保存 |
| PostgreSQL migration | PASS | `0005`十一表、42个索引、FK/唯一/大小/互斥/终态trigger；空库、重复runner、0004升级通过，0001～0004未改 |
| Session/版本/CAS | PASS | 固定published run/mapping digest，Review历史和supersedes可读；Session/Row expected_version冲突409 |
| 覆盖和值模型 | PASS | 核心/动态属性SET/CLEAR/REVERT revision历史；effective只按override→candidate，不回退raw |
| Issue | PASS | 原Issue不改；WARNING确认、ERROR排除/对应SET覆盖解决；Worker validation issue稳定key去重 |
| ACTIVE绑定 | PASS | 服务端分页精确选择，Worker最终重查ACTIVE，唯一binding和安全快照；不修改ACTIVE |
| Material Draft | PASS | 调用TASK01 Material Service；结果DRAFT、无code、未submit/approve；稳定link/operation防重 |
| Finalization | PASS | Outbox、100行prepare/50行process、行级事务、lease/heartbeat、部分失败和retry；全部完成才FINALIZED |
| 权限与API | PASS | Session、细粒度权限、CSRF、Idempotency-Key+正文摘要、分页/筛选、稳定400/401/403/404/409/422/500 |
| UI | PASS | 保留七步、view/row/Drawer；增加三层值、覆盖、决定、Issue、ACTIVE、Draft、批量、历史、进度和冲突提示 |
| 专项测试 | PASS | unit7/7、UI3/3、PG3/3，共13/13 |
| 回归 | PASS | 39个unit/UI/environment、25个PG和2个旧migration upgrade，共66个Node test；101行跨chunk和lease接管通过 |
| Build/Lint/安全 | PASS WITH EXISTING WARNING | strict定向TS、Vinext build、454文件凭证扫描、diff check通过；lint 0 error/1任务前warning |
| Compose | PASS | 3行VALID/WARNING/ERROR完成覆盖/排除/绑定/Draft/finalize；整栈重启后2版本、binding和DRAFT保持 |
| 资源清理 | PASS | TASK04 Compose容器、网络和卷已删除；独立PG测试容器在最终检查后删除 |
| 生产影响 | NONE | 未连接生产、迁移真实数据、部署、提交、push或PR |
| 已知限制 | RECORDED | Compose批次仅3行，101行与lease失效接管由PG集成验证；无真实样本容量验收和多租户schema |

## SELFHOST-PHASE1-TASK03 行级 Normalization PostgreSQL 全链路

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 唯一运行数据库 | PASS | 自托管 Normalizer、Review API 与 Worker 只访问 PostgreSQL；D1/Miniflare/Cloudflare 仅保留为迁移参照 |
| PostgreSQL migration | PASS | `0004`、schema、journal、snapshot 对齐；空库0001→0004、重复runner、0003存量升级、约束和不可变trigger通过 |
| 候选与证据 | PASS | 核心字段、动态属性、lineage和稳定ERROR/WARNING issue关系化保存；动态属性使用稳定attribute_code |
| 状态与恢复 | PASS | QUEUED→RUNNING→PUBLISHING→SUCCEEDED/SUPERSEDED，FAILED同run重试、新run重跑和CANCEL_REQUESTED/CANCELLED通过 |
| 原子发布 | PASS | run隔离暂存不可见；lease/CAS、pointer、统计、Event/Audit和Job success同事务；失败/丢lease/取消不发布 |
| API与安全 | PASS | Session、权限、行级可见性、CSRF、强幂等、expected version、分页/筛选边界、稳定错误和请求编号通过 |
| Review UI | PASS | 运行历史、run-specific Rows/Issues、状态/问题筛选、raw/candidates/attributes/lineage及重试/重跑/取消通过 |
| 专项测试 | PASS | unit4/4、UI3/3、PG/API4/4、旧数据升级1/1，共12/12 |
| 回归 | PASS | FileStorage、Phase0 Worker、Material、Mapping和环境保护共41/41；strict定向类型检查和build通过 |
| Lint | PASS WITH WARNING | 0 error；保留任务前 workbook 脚本1个unused warning |
| Compose | PASS | CSV解析→Mapping确认→Normalization v1发布→v2重跑→v3取消；整栈stop/up后3行、2 issues、3次run历史和lineage保持 |
| 资源清理 | PASS | 一次性Compose容器/网络/卷、独立PG测试容器和临时migration目录已删除，核对列表为空 |
| 生产影响 | NONE | 未连接生产、迁移真实数据、部署、提交、push或PR |
| 后续范围 | RECORDED | 人工最终复核、保留/排除、ACTIVE绑定、Draft Commit、真实迁移和生产切换必须独立任务与授权 |

## SELFHOST-PHASE1-TASK02 Import Mapping PostgreSQL 全链路

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 唯一运行数据库 | PASS | 自托管 Mapping、版本、复用和动态 Catalog 只访问 PostgreSQL；不导入 D1/Miniflare/Cloudflare 运行时 |
| PostgreSQL migration | PASS | `0003`、schema、journal、snapshot 对齐；空库、旧数据升级、runner 重复执行、约束和不可变 trigger 通过 |
| Parse 原子发布 | PASS | Worker 同事务发布 parse run、Sheet、Header 建议、不可变 Rows、初始 DRAFT、pointer 和事件；Compose 实际 CSV 3 行 |
| Mapping/Catalog | PASS | ACTIVE 动态属性稳定 code、BASIC/SPECIAL 目标、源结构/metadata/mapping digest、保存/预览/确认通过 |
| 版本不可变 | PASS | CONFIRMED/STALE/SUPERSEDED 内容和 Items 受 DB trigger 保护；重复 digest 拒绝，新确认版本使旧确认版本 SUPERSEDED |
| 复用与失效 | PASS | exact 为 AUTO_RECOMMEND；metadata 漂移需重确认；已用目标类型变化为 STALE；应用复用只生成/更新 DRAFT 且来源不变 |
| 安全与事务 | PASS | Session、权限、行级可见性、CSRF、Idempotency-Key+正文摘要、乐观锁、并发、稳定错误、Event/Audit同事务 |
| 专项测试 | PASS | 规则3/3、UI2/2、PG/API6/6、旧数据升级1/1 |
| 回归 | PASS | Material 6/6+2/2+7/7、FileStorage3/3、PG/Worker5/5、环境6/6、strict定向类型检查、build通过 |
| Lint | PASS WITH WARNING | 0 error；保留任务前 workbook 脚本 1 个 unused warning |
| Compose | PASS | 空卷迁移、登录、上传、Worker解析、DRAFT保存、2行预览、v2确认、版本查询；Web/Worker重启后状态仍为确认 |
| 生产影响 | NONE | 未连接生产、迁移真实数据、部署、提交、push 或 PR |
| 后续范围 | RECORDED | 行级 Normalizer/Review/Draft Commit、真实迁移和生产切换必须独立任务与授权 |

## SELFHOST-PHASE1-TASK01 Material PostgreSQL 全链路

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 唯一运行数据库 | PASS | 自托管 Material Draft/Review/Active 只经 `material-selfhost` Repository访问 PostgreSQL；不导入D1/Miniflare/Cloudflare运行时 |
| PostgreSQL migration | PASS | `0002` 新增编码序列、2个索引和2个状态/编码约束；空库应用、重复执行和Schema/snapshot/journal一致性通过 |
| 草稿与属性 | PASS | 实际页面契约覆盖创建、完整替换编辑、详情、列表/筛选、四级分类和TEXT/INTEGER/DECIMAL/BOOLEAN/ENUM类型化属性 |
| 固定审批 | PASS | DRAFT→PENDING_REVIEW→ACTIVE、驳回→DRAFT；创建人/最后修改人自审403，无审核权限403，第二名授权用户通过 |
| 编码并发 | PASS | PostgreSQL原子分类序列，不使用MAX+1；不同连接并发批准生成不同 `CYD-*` 编码，失败事务无半记录 |
| 安全与一致性 | PASS | Session、细粒度权限、CSRF、Idempotency-Key+正文摘要、重放/冲突、expected_version、行锁、统一安全错误与请求编号通过 |
| 版本/变更/审计 | PASS | 创建、编辑、提交、通过/驳回的主记录、属性、版本、变更、审计和幂等结果均为单事务；新增受权审计历史页面 |
| 单元/UI/PG/API | PASS | 6/6、2/2、7/7；既有Material UI 142/142回归通过 |
| Phase 0回归 | PASS | FileStorage 3/3、PostgreSQL/Worker 5/5、Vinext build通过 |
| Lint | PASS WITH WARNING | 0 error；最小修复既有prefer-const阻断，保留workbook脚本1个任务前unused warning |
| 凭证/差异/依赖扫描 | PASS | 402个文件凭证扫描、`git diff --check`通过；新Material模块无Cloudflare/D1/R2/Queue/Miniflare运行引用 |
| Compose冒烟 | PASS | 真实Web登录、创建/编辑/提交、两类拒绝、第二用户批准、ACTIVE/4版本/8变更/6审计查询；重启PG/Web/Worker后持久 |
| 生产影响 | NONE | 未连接生产、迁移真实数据、部署、提交、推送或创建PR |
| 后续范围 | RECORDED | TASK02移植Import Mapping/版本/复用；行级Normalizer、真实数据迁移与生产切换继续独立授权 |

## SELFHOST-PHASE0-TASK01 自托管基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 运行架构 | PASS | Vinext standalone Node Web + PostgreSQL 17 + 本地持久卷 + 独立 Node Worker；运行入口不依赖 OpenAI Site/Cloudflare |
| PostgreSQL baseline | PASS | 新 `0001` 共 46 表：现有 45 张业务/治理结构加 `background_jobs`；Drizzle PostgreSQL schema/snapshot 对齐，空库和重复执行通过 |
| 管理员与分类 | PASS | 无默认密码；一次性 CLI 初始化 1 个 admin、101 分类、34 属性；登录和会话 cookie/CSRF 通过 |
| Material | PASS (CORE) | 分类 tree/schema、草稿创建/查询、权限与审计链路通过；完整旧 Draft/Review/Query Repository 仍待逐域移植 |
| 文件 | PASS | 随机路径、路径穿越拒绝、SHA-256/大小/MIME/原名、临时文件+fsync+原子 rename、持久卷和非 root 读取通过 |
| Worker | PASS | Outbox、`FOR UPDATE SKIP LOCKED`、租约、心跳、CAS、重试、超时恢复、幂等、原子结果发布和安全停机；CSV 实际解析 3 行，CSV/XLS/XLSX 共用既有有界 Parser，纯 Parser 38/38 |
| 单元测试 | PASS 3/3 | 路径安全、原子写、失败清理 |
| PostgreSQL 集成 | PASS 5/5 | migration/约束、transaction rollback、Outbox 幂等、4 Worker 并发唯一领取、heartbeat/retry/expired recovery |
| Compose 冒烟 | PASS | build、health、admin、login、101 分类、草稿、上传、任务完成；PostgreSQL/Web/Worker 整体重启后 2 Material、2 File、2 SUCCEEDED Job 和 SHA 文件保持 |
| 备份恢复 | PASS | 隔离实例生成 PostgreSQL custom dump、uploads/attachments tar 和 SHA256SUMS；恢复到显式新空库/空目录后 1 User、2 Material、2 SUCCEEDED Job 一致 |
| 生产影响 | NONE | 未连接生产数据库、迁移真实数据、部署公网、修改真实服务器、提交、推送或创建 PR |
| 已知阻断 | RECORDED | 全量 lint 被既有 `xls-parser.ts:170 prefer-const` 阻断；新增自托管文件定向 lint 和 Vinext build 通过；旧 API/完整行级 Normalizer 仍待移植 |

## 自动统计摘要

| 指标 | 当前值 | 统计口径 |
| --- | ---: | --- |
| 总代码量 | 约 56,000 行 | 新增服务器本地 spreadsheet parser、迁移、API/UI 和专项测试；不含依赖、运行数据库、备份和截图 |
| 源码文件 | 150+ | 新增本地 parser、2 份专项测试、版本化 migration、依赖清单和完成报告 |
| 根仓库跟踪项 | Site 自适应 Import + 服务器本地 CSV/XLSX/XLS | 本轮修改本地 Python 运行面和 systemd 源码配置，未修改 Site |
| 主要目录 | 4 类 | `chenyida_erp_app/`、`chenyida_erp_site/`、`物料主数据治理落地包/`、`docs/` |
| 数据库实现 | 3 | 当前开发 SQLite、历史 Cloudflare D1、自托管开发 PostgreSQL |
| 数据表 | 分运行面追踪 | SQLite 29 张；D1/Drizzle 45 张；PostgreSQL `0001` 基线 46 张并有 `0002`—`0006` 增量；不能跨运行面相加冒充同一数据库 |
| 在线 API 路径 | 89 | 开发代码新增 Draft Generation 查询、Normalization Approval 和 Draft Commit；生产公开站点尚未部署 |
| 页面入口 | 14 | 既有 11 个入口加 3 条 Material Import 路由 |
| 测试文件 | 35 | 本轮新增本地 Spreadsheet 和 Migration 两份专项测试 |

## 当前版本与环境

| 项目 | 当前值 |
| --- | --- |
| 根仓库 Branch | `main` |
| 任务开始 HEAD | TASK04 起点 `a541360eefe12869c090b2408bbcf07485fc77cb` |
| 自托管开发版本 | `chenyida-erp-selfhosted@0.1.0-alpha.14`；非生产、尚未发布 |
| 当前实际常驻服务 | Python 3.11.6 / SQLite，systemd `enabled/active`，`0.0.0.0:18888` |
| 自托管部署状态 | Node/PostgreSQL 未生产部署；当前无运行中 Compose 项目 |
| PostgreSQL migration | `0001`—`0014`；TASK02 新增合成受控期初模型，未迁移任何真实数据 |
| SQLite migration | `0001`—`0004` 已记录；数据库不保存 migration checksum |
| 历史 D1 migration | 仓库 `0000`—`0008`；生产实际应用版本未访问、未核验 |
| PM-000 前根提交 | `bbefb2e388323213b51531fec117d67d5a28fe70` |
| Site 开发基线 | `9f2c2dca9ccde237cb2db6c01d2e3792b284e6e9`；已作为普通目录纳入根仓库 |
| 历史 Site | 历史记录 `v3`，源码提交 `2b4f1787ddbc7e0941ab2d5f5cadea6e817e8f12`；本任务未访问公网重新确认 |
| 当前主机工具 | Git 2.43.7、Docker 29.5.2、Compose v5.1.4、Python 3.11.6；宿主机无 Node/npm，Node 验收使用 `node:22-bookworm` 一次性容器 |
| 环境配置 | `development` / `test` / `production`；生产地址运行时注入，不在发布记录硬编码 |
| 测试数据库 | Node 基线使用隔离/一次性环境；Python go-live 使用临时 SQLite；不连接生产 |

Node 验收因宿主机无 Node/npm，在一次性 `node:22-bookworm` 容器执行。`npm ci` 报告 12 个既有依赖审计项（1 low、4 moderate、7 high），依照本任务禁止事项未升级依赖。Python 首轮误用系统解释器时 smoke 在导入 `openpyxl` 前停止；改用 systemd 实际使用的项目虚拟环境后，self-test、smoke 和临时 SQLite go-live 全部通过。

## Git 状态

SELFHOST-PHASE2-TASK02 开始时，根仓库 `main` 位于 `e8cb7ebc0fa9d45575aeaffc0732183d2533f577`，工作区 clean，本地分支领先 `origin/main` 2 个提交。TASK02 独立提交和最终 clean 状态以完成报告及 `git show` 为准；未 push 或创建 PR。

SELFHOST-PHASE2-TASK01 开始时，根仓库 `main` 位于 `12d3ea30d21cce6918de0c525d81f19af289f5ac`，工作区 clean，本地分支领先 `origin/main` 1 个提交。本任务只修改 `docs/`；完成提交和最终 clean 状态以任务完成报告及该提交的 `git show` 为准。

PHASE0-TASK03 开始时，根仓库 `main` 位于 `39946f6`，工作区 clean；`origin/main` 的本地跟踪引用和远端只读查询均为同一提交。当前任务只修改项目发布文档以及 `package.json`/`package-lock.json` 的名称和版本；最终提交与工作区状态以本任务完成报告为准。

`PHASE3-MATERIAL-LIBRARY-02` 开始时，根仓库 `main` 位于 `c660cc3` 且工作区干净。功能提交 `b3d26c3` 覆盖本地只读 inspect、治理状态、安全汇总、重复阻断和专项测试；未修改 Schema/Migration、hosting、本地旧版业务代码或生产资源。

`PHASE3-MATERIAL-LIBRARY-SUPPLIER-ADAPTIVE-IMPORT` 功能提交为 `41e293f`，覆盖自适应结构识别、Supplier Profile、多来源 Mapping/规格、Canonical Row、Review/Draft 门禁、`0008` 和专项测试；没有真实供应商样本，没有生产迁移或部署。

`PHASE3-MATERIAL-LIBRARY-REAL-SAMPLE-01` 功能提交为 `cea940a`；只读验证 A118/V700，未跟踪附件或业务行，未连接生产、上传、dry-run、创建 Draft 或部署。

正式规格确认更新开始时，根仓库位于 `c694045`；用户明确回复“规格确认”。本次只更新主规格的 14 项决策状态和项目治理记录，不实施 Review UI。

转换前，`git ls-files --stage -- chenyida_erp_site` 只显示一个 mode `160000` gitlink。转换后，根仓库直接跟踪 Site 的 77 个 mode `100644` 文件，仓库中不再存在 mode `160000`。暂存 Site 子树 hash `541decf5a685a0efc238868ef958d3ae500174e5` 与原 `9f2c2dc` tree 完全一致。

本任务未创建生产版本、未推送、未连接或部署生产 D1/R2/Queue。

实时状态必须使用：

```powershell
git status --short
git -C chenyida_erp_site status --short
```

## PHASE3-MATERIAL-LIBRARY-REAL-SAMPLE-01 真实 BOM 只读验证

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 功能提交 `cea940a`；脱敏报告、测试与项目记录完成 |
| 文件类型 | PASS WITH WARNING | A118/V700 均为 XLSX 内容、`.csv` 后缀；以内容签名解析并记录 `XLSX_CONTENT_WITH_CSV_EXTENSION` |
| V700 Sheet | PASS | 正确选择 `BOM`，不再误选 `变更记录`；表头 1～2，数据从 3 开始 |
| V700 Mapping | PARTIAL | 规格、型号、数量 EXACT；标准名称、单位未确认，继续 fail closed |
| V700 行估计 | READ-ONLY | 229 DATA；219 有规格、10 空规格、222 有型号 |
| A118 表头/Mapping | PASS (STRUCTURE ONLY) | 第 44 行；名称、规格、厂商料号、用量 EXACT |
| A118 解析 | EXPECTED BLOCK | 第 197～203 行扩展到 XFD；不截断，稳定返回 `IMPORT_PARSE_LIMIT_EXCEEDED` |
| A118 行估计 | DIAGNOSTIC ONLY | 前 9 列只读估计 310 DATA、266 有规格、44 空规格；不是成功 Parse |
| 专项/全量 | PASS | 自适应 11/11、Parser 37/37、Inspector 4/4、Batch API 12/12、Node 593/593 |
| 其他基线 | PASS | build、lint 0 error/1 个既有 warning、隔离 API smoke、凭证扫描、Python self-test/smoke/go-live、`git diff --check` |
| 生产影响 | NONE | 未提交附件、连接生产、上传、dry-run、创建 Draft、迁移或部署 |

## Excel 文件格式兼容增强

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| `.xlsx` | 保持 | 继续使用既有有界 OOXML/ZIP 安全检查和解析器 |
| `.xls` | 已接入 | 前端预检、服务端 OLE 安全边界、BIFF Sheet/单元格读取和现有 Raw Row/Mapping 链路 |
| `.csv` | 保持 | 既有编码、分隔符和 CSV 安全检查不变 |
| 兼容策略 | 已记录 | 批次 `source_kind`/文件 `detected_file_type` V1 分类保持 `XLSX`，`.xls` 通过 `filename_extension` 选择独立 BIFF 路径并写入 `XLS_LEGACY_BINARY` 警告 |
| 生产影响 | NONE | 未连接生产资源、未迁移、未上传、未创建 Draft、未部署 |

## 服务器本地 CSV/XLSX/XLS 自适应导入

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 实际运行面 | DEPLOYED / DEVELOPMENT | `chenyida_erp_app` 和 systemd 常驻服务已更新，不再只有 Site 代码支持 Excel |
| 文件类型 | PASS | CSV、OOXML XLSX、OLE/BIFF XLS；按内容签名识别，10 MiB 上限 |
| Sheet/表头 | PASS | 全部 Sheet、前 50 行、1～3 行、合并父级表头、数据起始行 |
| Mapping/规格 | PASS | 集中别名、样本评分、EXACT/HIGH_CONFIDENCE/SUGGESTED/UNMAPPED/CONFLICT、多列规格组合 |
| 原始数据 | PASS | `material_import_batches` + 不可变 `material_import_raw_rows`；清洗行保存来源和置信度 |
| Migration | PASS 3/3 | 空库、已有数据、重复执行、失败回滚和约束；迁移前快照和副本试迁移完整性 `ok` |
| Parser/API | PASS 6/6 | 包含多行 XLSX、真实 BIFF XLS、CSV、错后缀、缺名称阻断和 A118/V700 回归 |
| 本地基线 | PASS | 联合单元 13/13、self-test、含二进制 XLSX 上传的 smoke、go-live |
| 服务 | PASS | `/opt/erp/.venv/bin/python`、systemd `enabled/active`、`0.0.0.0:18888` |
| 真实样本 | SUPERSEDED | 此处记录初始严格拒绝结果；用户确认业务语义后，已由下节的待审核入库方案替代 |

## A118 / V700 正式 BOM 待审核入库

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 用户确认 | ACCEPTED | 两份是正确且需要导入库内的正式表格 |
| A118 | STAGED | `REAL-A118-20260718`，第 44 行表头，314 Cleaning Rows |
| V700 | STAGED | `REAL-V700-20260718`，BOM 第 1～2 行，229 Cleaning Rows |
| 原文件 | PASS | 两份按 SHA 完整归档；A118 XFD 原始内容不丢失 |
| Raw Rows | 766 | A118 457；V700 293+16 |
| Review | 543/543 | 两批次全部 NEEDS_REVIEW |
| 必填门禁 | PASS | 22 空规格、543 空单位；建档接口继续拒绝空值 |
| Material | 4→4 | 没有自动建档、编码或正式物料写入 |
| Migration | PASS | 本地 `0002`、迁移前快照、副本试迁移和完整性检查 |
| 自动测试 | PASS | 联合单元 15/15、self-test、smoke |

## 电容匹配测试基线 1～5

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 用户最终输入 | ACCEPTED | 采用更正后的 5%、10%、20%、10%、5% 五条规格 |
| 备份 | PASS | `erp-backup-20260718-182230.sqlite3`，副本事务试跑通过 |
| 内部物料 | 4→9 | 新增临时编码 1～5，均启用、CAP、PCS |
| Cleaning Rows | 543→0 | 按用户指令清空，事务失败时整体回滚 |
| 原始追溯 | PRESERVED | 2 Batch、766 Raw Rows、两份原文件归档均保留 |
| 匹配 | PASS 5/5 | 输入 1～5 分别自动匹配编码 1～5，置信度均 1.00 |
| 数据库 | PASS | `PRAGMA integrity_check=ok` |
| 服务 | PASS | systemd `enabled/active`，公网首页 HTTP 200 |

## 清洗审核匹配置信度排序

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| API 参数 | PASS | `newest/desc/asc` 固定白名单，未知值回退 newest |
| 全局顺序 | PASS | 服务端排序后再应用 500 条上限 |
| 稳定顺序 | PASS | 同分按 ID 降序 |
| 页面 | PASS | 最新记录、由高到低、由低到高 |
| 单元测试 | PASS 4/4 | 升序、降序、回退、排序后 limit |
| 集成基线 | PASS | smoke、self-test、go-live |
| 真实 V700 | PASS | 229 条、21 个置信度层级；升序 0.00→1.00，降序 1.00→0.00 |
| 开发部署 | PASS | systemd `enabled/active`，公网 HTML/JS 已更新 |

## 清洗审核安全清空

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 权限 | PASS | `system`，仅管理员 |
| 双重确认 | PASS | 浏览器确认 + 固定服务端 confirmation |
| 自动备份 | PASS | 删除前创建 SQLite 备份并返回信息 |
| 事务/审计 | PASS | 删除和审计同事务，记录操作者与数量 |
| 保留边界 | PASS | Batch、Raw、归档、物料、映射不删除 |
| 单元测试 | PASS 3/3 | 删除审计、空队列幂等、权限 |
| 联合/Smoke | PASS | 7/7；拒绝路径不删除，成功路径备份并清空 |
| 真实队列 | PRESERVED | 部署未执行真实清空，V700 229 条保持不变 |

## 1928C / G20-G15G / J587 规格与编号

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 1928C | PASS | 25/25 有规格，工作表及 2～4 行表头正确 |
| G20 | PASS WITH REVIEW | 69/74 有规格；5 条原始 Description 为空 |
| J587 | PASS | 122/122 有规格，描述不再与备注冲突 |
| 三文件隔离导入 | PASS | 3 Batch、316 Raw、221 Cleaning、216 有规格 |
| 名称解耦 | PASS | 名称不参与编号评分 |
| 唯一编号 | PASS | 完整规格唯一一致才自动确认编号；部分唯一候选保持疑似，歧义不随机选码 |
| 等价规格 | PASS | 0.1uF=100nF、5.0V=5V、+5%=5% |
| 当前 1～5 | EXPECTED REVIEW | 无完整唯一匹配；J587 5 条缺误差，对应 1/2/3 歧义 |
| 自动建档 | NONE | 0 个内部物料自动创建 |
| 部署 | PASS | systemd `enabled/active`，公网 HTTP 200 |

## 1928C 分项规格匹配

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 匹配输入 | PASS | raw spec/model/description/MPN 分开取证，不比较整体文字相似度 |
| 截图行 | PASS | CAP、0201、5%、C0G/NP0、50V、10PF、MPN 分项提取 |
| 单项冲突 | PASS | 任一来源关键属性与候选冲突即淘汰 |
| 供应商简写 | PASS | NPO/NP0/COG/C0G、100P/100PF 确定性归一 |
| 数据模型 | PASS | 本地 `0003` 扩展现有 Cleaning，不新建重复导入表 |
| 旧数据 | PRESERVED | 当前 25 条 1928C Cleaning 不回填、不重算 |
| 当前编号 | EXPECTED NEW | 截图 10PF 规格未存在于当前内部测试库，不能伪造编号 |
| 回归 | PASS | 联合单元 37/37、self-test、smoke、go-live |
| 部署 | PASS | 迁移前快照完整；`0003` 已应用，systemd active/enabled，公网 HTTP 200 |

## 清洗审核分项规格对照

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 来源规格 | PASS | 八项分开展示，型号/MPN 不冒充电气规格 |
| 候选规格 | PASS | 从内部物料只读展示同组字段，空值明确“未维护” |
| 人工证据 | PASS | 候选编码、候选名称、来源规格、候选规格同一行核对 |
| 服务端边界 | PASS | 浏览器不计算匹配、不改编号、不自动确认 |
| 置信度 | PASS | 来源介质未覆盖时疑似上限 0.95 |
| 数据影响 | NONE | 无 Schema/Migration、无旧行回填、无业务数据写入 |
| 回归/部署 | PASS | 联合单元 38/38、self-test、smoke、go-live；systemd active/enabled，公网 HTTP 200 |

## 通用规格来源识别与无序参数匹配

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 规格来源 | PASS | 明确规格、多列组合、描述和物料名称按确定性参数丰富度选择，保存完整 raw spec 和来源列 |
| 通用参数 | PASS | 品类、封装、容量、阻值、电感值、电流、电压、功率、频率、百分比/绝对误差、材质和尺寸 |
| 无序匹配 | PASS | 参数以类型和归一值集合比较，前后顺序不影响相似度；同类型冲突排除，缺项降级 |
| 型号边界 | PASS | MPN/品牌独立保存和展示，不进入通用规格相似度；MPN 相同不能替代规格 |
| 审核页面 | PASS | 型号/MPN、完整原始详细规格、规格来源、来源参数和候选内部参数同时可见 |
| 数据模型 | PASS | `0004` 只扩展既有 Cleaning 四个证据列，不新建第二套导入系统 |
| 旧数据 | PRESERVED | 9 Material、444 Cleaning、16 Batch、3037 Raw 均未变化；旧 Cleaning 不重算 |
| 恢复 | PASS | 部署前备份 `erp-backup-20260718-203624.sqlite3`，SHA-256 `04286e386f9a799400c4ec0dc675110419d5f77fdf7dc54e3366cb2287651262`，完整性 `ok` |
| 自动测试 | PASS | 联合单元 48/48、self-test、smoke、go-live |
| 部署 | PASS | systemd active/enabled，本机和公网首页 HTTP 200，`0004` 已应用 |

## 规格匹配精度门禁

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 大类误匹配 | PASS | CATEGORY 不计入鉴别参数；只识别大类的来源返回“规格不足”、无候选、置信度 0 |
| 自动匹配门禁 | PASS | 双方至少三类鉴别参数、包含锚点、集合完整一致、无冲突且候选唯一 |
| 参数扩展 | PASS | 分数功率、范围、频率/阻抗、带宽、dB、嵌入电阻码、长度、针数、间距、铜厚和接口 |
| 上下文消歧 | PASS | Type-C `16P` 识别为针数且不生成电容；电容短写 P 只在电容上下文启用 |
| 来源 Mapping | PASS | 样本值丰富度可定位未知标题规格列；型号不直接冒充规格 |
| 审核页面 | PASS | 显示规格不足、鉴别参数类数、候选内部缺项和歧义候选数 |
| 真实 J587 回归 | PASS | 隔离复算 105 新/5 疑似/12 规格不足；4 条连接器大类错误候选归零 |
| 数据影响 | PRESERVED | 9 Material、122 Cleaning、17 Batch、3176 Raw；旧 Cleaning 不回填、不重算 |
| 恢复 | PASS | `erp-backup-20260719-133841.sqlite3`，SHA-256 `898b3dab3da5b3e4239773789afebca73f1c91428646c2c2c3f476e2d8efc536`，integrity `ok` |
| 自动测试 | PASS | 联合单元 58/58、self-test、smoke、go-live 和 Python 编译检查 |
| 部署 | PASS | systemd active/enabled，`0.0.0.0:18888`，本机与公网健康检查和新版静态资源通过 |

## 服务器本地交付运行面

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 默认应用 | 已切换 | `chenyida_erp_app/server.py` 及启动脚本在公网验证期间使用 `0.0.0.0:18888` |
| 本地基线 | PASS | `server.py --self-test`、`smoke_test.py`、`go_live_check.py --no-backup` 通过 |
| Site 关系 | 已记录 | Site 保留为历史/参考代码，后续新功能不再默认整合到 Site |
| 外部暴露 | DEVELOPMENT ALWAYS-ON | `chenyida-erp.service` 已 `enabled/active`；`43.135.157.211:18888` 健康接口和登录页均返回 200，页面不再预填默认密码 |
| 服务恢复 | PASS | systemd 开机自启、失败自动重启；正式投用迁移到公司服务器前仍需密码轮换、HTTPS、反向代理和访问控制 |

## PHASE3-MATERIAL-LIBRARY-SUPPLIER-ADAPTIVE-IMPORT 非生产实现

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 功能提交 `41e293f`、测试和治理文档完成 |
| 现有链路复用 | PASS | 继续使用 Batch/Parser/Raw Rows/Mapping/Normalization/Review/Validation/Event/Audit/Draft，没有第二套导入系统 |
| Sheet/表头 | PASS (SYNTHETIC) | 全部可见 Sheet、前 50 行、1～3 行与合并父级表头评分；保存范围、置信度和证据 |
| 行分类 | PASS (SYNTHETIC) | DATA/BLANK/说明/重复表头/小计/合计/页脚；原始行保留，非数据行在 Normalization 标记 SKIPPED/REJECTED |
| Mapping | PASS (SYNTHETIC) | 集中别名、样本统计、相邻信息和 Supplier Profile；五级状态及低置信度人工确认 |
| 规格 | PASS (SYNTHETIC) | 独立规格、多来源确定性组合、名称/描述候选；不调用 AI，空规格 ERROR 阻断 Draft |
| Canonical Row | PASS | 进入既有 Normalization payload/队列列，完整原始值仍只存不可变 Raw Row |
| `0008` | PASS | 45 表 Drizzle 基线；空库/已有数据/约束/失败原子性和受保护兼容回退通过，完整结构恢复依赖迁移前快照 |
| 初始真实样本 | INITIAL_BASELINE | 功能首次完成时受控目录无样本；后续 A118/V700 结果见上方真实 BOM 验证 |
| 专项/全量 | PASS | 自适应 9/9、Migration 3/3、运行时闭环 2/2；Vinext build + Node 589/589 |
| 其他隔离基线 | PASS | lint 0 error/1 个既有 warning、API smoke、1k/10k/100k 查询计划、最终文档范围 328 文件凭证扫描、Python self-test/smoke/go-live、`git diff --check` |
| 生产影响 | NONE | 未连接生产 D1/R2/Queue，未迁移、上传真实文件、创建 Draft、Sites 保存或部署 |

## PHASE3-MATERIAL-LIBRARY-02 初始治理（历史 NO_REAL_DATA_MODE）

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 当时任务状态 | HISTORICAL / SAMPLE DELIVERED | 此节记录 `b3d26c3` 当时无真实文件的事实；后续 A118/V700 结果见上方真实 BOM 验证 |
| 当时文件扫描 | COMPLETE | 当时仅扫描 `/opt/erp`、`/home`；20 路径去重为 1 个 10-Sheet XLSX + 9 CSV，全部是已跟踪模板/样例镜像 |
| 本地 inspect | PASS | 只读类型/大小/SHA、Sheet/CSV、行列、编码/分隔符、表头候选和可能字段；不回显业务行、不改源文件 |
| Mapping | VERIFIED / UNCHANGED | 既有关系化 Mapping 可保存、版本 CAS、metadata digest、确认、事件和审计；未硬编码实际映射、未改 Schema |
| 分类治理 | PASS (SYNTHETIC) | code=`EXACT`、唯一名称=`MATCHED`、未命中/冲突=`NEEDS_REVIEW` 并给有界疑似候选；不自动建分类 |
| 单位治理 | PASS (SYNTHETIC) | 标准 code=`EXACT`、alias=`MATCHED`、未命中/冲突=`NEEDS_REVIEW`；不自动建单位 |
| 品牌治理 | PASS (SYNTHETIC) | code/name/alias 分级匹配，空品牌独立标识，未命中作为新候选待审；不自动建品牌 |
| 重复治理 | PASS (SYNTHETIC) | EXACT 阻断；HIGH_CONFIDENCE 阻断并要求人工确认；POSSIBLE 提示；不自动合并 |
| dry-run 汇总 | PASS (SYNTHETIC) | CLI 只输出总数、成功/错误/警告/重复/待审及分类/单位/品牌/重复等级计数，不打印完整物料正文 |
| 真实 dry-run / DRAFT | NOT RUN / 0 | 未把模板冒充真实数据，未上传、批准、commit 或创建 Material DRAFT |
| 专项/全量 | PASS | 治理专项 9/9；Node 575/575；Vinext build；lint 0 error/1 个任务外既有 warning |
| 隔离基线 | PASS | 本机一次性 D1 API smoke、319 文件凭证扫描；临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore、go-live |
| Schema/生产影响 | NONE | D1/Drizzle 仍为 44 表、最新 `0007`；未连接生产、迁移、部署或创建资源 |

## PHASE3-MATERIAL-LIBRARY-01 Internal Material Library 非生产实现

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 审计、实现、测试、功能提交 `2ff8d9c` 和治理文档完成 |
| 数据库技术 | CONFIRMED | Cloudflare D1 / SQLite 语义，Drizzle schema + SQL migration + snapshot/journal |
| 模型复用 | PASS | 复用 `material_master`、分类、动态属性、别名、供应商映射、版本/审计和既有 Draft/Review；没有第二套 `materials` |
| `0007` | PASS | 新增单位/别名、品牌/别名、Approval、Draft Link、Duplicate Candidate；Material 增加品牌、单位和批次/文件/行外键；受保护 Down/re-up |
| Import 闭环 | PASS | Current Normalization digest 审批后调用既有 Validation/Draft Service；单行原子写来源/候选；结果仅 `DRAFT`、无正式编码 |
| 权限/安全 | PASS | admin/manager `material.import.commit`，owner/read_any、CSRF、版本/摘要、WARNING 明确确认、强幂等、安全错误和审计 |
| 重复检测 | PASS | material/legacy/supplier code、名称、品牌、型号、规格、制造商料号；EXACT/HIGH_CONFIDENCE 阻断、POSSIBLE 提示，均不自动合并 |
| 命令 | PASS | inspect/dry-run/commit/report 复用 API；只允许回环 URL，commit 只允许 test/local/development |
| 迁移/闭环专项 | PASS | Migration 3/3；Import→Draft、权限、CSRF、追溯、请求/行幂等 3/3；既有生命周期 14/14 |
| Site 全量 | PASS | Vinext build；Node 569/569；lint 0 error、1 个任务外既有 warning；Drizzle 44 表无漂移 |
| 隔离基线 | PASS | 一次性 D1 API smoke、314 文件凭证扫描、远程 URL 拒绝、本地临时 SQLite 五项基线通过 |
| 文件/dry-run | NOT RUN | `/opt/erp` 只发现两套相同治理模板/样例，`/home` 无候选；未发现真实首批物料文件，因此未上传或 dry-run |
| 生产影响 | NONE | 未连接生产 D1/R2/Queue，未执行迁移、真实导入、Sites 保存或部署 |

## PHASE3-TASK04 Material Import Normalization Review UI V1 非生产实现

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 14 项既定 UI 决策按规格实现，未重新设计业务语义 |
| 页面/状态 | PASS | 统一 `/materials/imports/:batchId`、七步 Stepper、`normalize/normalized/issues/confirmed`、Batch/Current/Latest 双轨 |
| 写与轮询 | PASS | 固定 Processor、启动/重试/重跑/取消、独立冻结 Operation、`RESULT_UNKNOWN`、2/5/10 复合轮询、Retry-After、真实行进度 |
| 结果审阅 | PASS | Current 汇总、Rows/Issues 50/100 opaque cursor、Row Drawer、200 Attributes、有界值与 Safe Details、Current Run 失效清理 |
| 局部门禁 | PRESERVED | 无精确完整 Row Issues API；只显示计数、当前单条 Issue 和按来源行筛选，不扫描或伪造完整集合 |
| 计划测试 | PASS | `NUI-RS-001`—`NUI-PF-008` 104/104；矩阵唯一性元检查通过 |
| 直接回归 | PASS | Import Workspace `UI-001`—`UI-100` 100/100；联合 206/206（含两项矩阵元检查） |
| Playwright | PASS | 隔离本地 Mock；50 Rows 801 ms、Drawer 398 ms、100 Issues、204 Candidate、700px Drawer 实宽 700px、0 console warning/error |
| 安全/存储 | PASS | 无详情 N+1、无 Catalog 冒充历史标签、Storage 0、History 正文键 0、权限失效清理与安全归属核验覆盖 |
| Build/Lint | PASS | Vinext build 成功；lint 0 error，仅保留任务外既有 workbook unused warning |
| 范围 | PASS | 无后端 API、Schema、Migration、业务服务、依赖、hosting 或生产环境改动；`.obsidian/` 保持未跟踪且未修改 |

## PHASE3-TASK03 Material Import Normalization Review UI V1 书面设计

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / SPECIFICATION CONFIRMED | 项目负责人于 2026-07-17 在设计提交后回复“规格确认”；14 项决定全部 `APPROVED` |
| 正式交付 | COMPLETE | 主规格、37 状态线框、状态矩阵、104 项测试计划共 4 份新文档 |
| 路由/状态 | DESIGNED | 统一 Batch 工作区、七步 Stepper、`batch/current_run/latest_attempt`、合法 View 与 History Marker |
| 写与进度 | DESIGNED | 固定 Processor Version、启动/业务重试/重跑、冻结幂等 Body、`RESULT_UNKNOWN`、2/5/10 轮询、真实行进度、取消竞争 |
| 结果审阅 | DESIGNED | Current Run 汇总、Rows/Issues opaque cursor、Row Drawer、Candidate/Lineage、有界 Safe Details、权限与错误矩阵 |
| 局部门禁 | RECORDED | Drawer 内“该行全部 Issues”缺少精确有界查询；不阻断其他 Review UI 流程，本任务不改 API |
| 全局门禁 | REQUIRED | `PERFORMANCE_AND_ACCESSIBILITY_VALIDATION_REQUIRED`；未来实施后实测，文档阶段未声称通过 |
| 非阻塞限制 | RECORDED | 完整历史、Batch Pointer、Issue Row Status/Sheet 筛选、Rows 候选摘要、Batch List 状态筛选和选中 Issue 刷新恢复 |
| 增量验证 | PASS | 设计提交已通过 104/104 测试编号、37/37 线框、错误矩阵和门禁检查；规格确认更新另核对 14/14 `APPROVED`、ADR、治理状态、`git diff --check` 与 docs-only 范围 |
| 生产影响 | NONE | 未修改或运行前端/API/Schema/Migration/业务服务，未连接生产资源、迁移或部署 |

## PHASE3-TASK02 Material Import Normalization & Staging V1 非生产实现

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 16 项正式决定全部 `APPROVED`，运行时与隔离实现完成 |
| 状态与运行 | PASS | 批次排队/运行/发布；独立 run、Outbox、租约/心跳、CAS、失败恢复与 SUPERSEDED 历史 |
| 数据契约 | PASS | 每行版本化 JSON payload、完整 lineage、payload hash、独立 issue、关系约束与绑定 trigger |
| 类型/空值 | PASS | MISSING/EMPTY/BLANK_TEXT/NULL_VALUE/PRESENT、受控默认、类型/属性/公式禁用与稳定 issue code |
| Validation | PASS | 只运行 Normalization 规则并输出 Deferred Validation；不调用 Material Validation 或 Draft 写服务 |
| API/权限 | PASS | 5 个路由、opaque cursor、`material.import.normalize`、owner/read_any、404/403、CSRF/幂等/读写限流 |
| `0006` | PASS | Up、三表、batch pointer、events/outbox/batches 重建、索引/trigger、受保护 Down、重升与失败整批回滚 |
| 专项测试 | PASS | 稳定发布、ERROR 行共存、幂等、分页、重跑、取消清理、五 API、安全与 429；一次性 Miniflare D1 |
| Site 全量 | PASS | 正式矩阵 54/54；Normalization/Migration 专项 18/18；`npm test` 458/458；`npm run build` 成功；`npm run lint` 0 error、1 个任务外既有 unused warning |
| API/OpenAPI | PASS | 隔离 `npm run test:api` 通过；6 份 OpenAPI、33 个 operation、533 个本地引用均有效 |
| Drizzle | PASS | 37 tables；生成漂移检查返回 `No schema changes, nothing to migrate` |
| 凭证/本地基线 | PASS | 304 个仓库文件凭证扫描通过；临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore、go-live 全通过并清理 |
| 生产影响 | NONE | 未连接 production/公共 URL/远程 D1/R2/Queue，未迁移、部署、创建 binding/Cron、Draft 或正式物料 |

## PHASE3-TASK01 Material Import Normalization & Staging V1 书面设计

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / WAITING FOR SPEC CONFIRMATION | 正式规格、OpenAPI 草案、数据流/状态图完成；16 项决定全部 `PROPOSED` |
| 状态与运行 | DESIGNED | 批次排队/运行/发布；独立 run、租约、Outbox、CAS、失败恢复与 SUPERSEDED 历史 |
| 数据契约 | DESIGNED | 每行版本化 JSON payload + 常用关系列 + 独立 issue；完整 lineage，不覆盖原始行 |
| 类型/空值 | DESIGNED | MISSING/EMPTY/BLANK_TEXT/NULL_VALUE/PRESENT、受控默认、基础字段/动态属性、公式禁用 |
| Validation | DESIGNED | 只运行 Normalization 规则；完整 Material Validation 延迟到真实 category_id，Draft 写服务不调用 |
| API/权限 | DESIGNED | 5 个路由、opaque cursor、`material.import.normalize`、owner/read_any、404/403、CSRF/幂等/限流 |
| `0006` | DESIGN ONLY | 三个新表、batch current pointer、events/outbox/batches 重建、索引/Down/重升；未创建 Migration 或改 Drizzle |
| 测试计划 | COMPLETE | 54 项最低未来测试及完整 docs-only 基线 |
| 验证 | PASS | OpenAPI 3.1 为 5 个操作/98 个本地引用；16 项决定逐项 11 字段、54 项测试/docs-only 检查通过；lint 0 error/1 个既有 warning；build 与 Node 440/440；隔离 API smoke；Drizzle 34 表无漂移；296 文件凭证扫描；临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore、go-live 均通过并清理 |
| 生产影响 | NONE | 未连接 production/公共 URL/远程 D1/R2/Queue，未迁移、部署或创建 binding/Cron |

## PHASE2-TASK08 Material Import Workspace UI V1 非生产实现

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 16 项正式决定已批准并实施；Catalog 与性能/可访问性门禁均通过 |
| 页面路由 | PASS | `/materials/imports`、`/materials/imports/new`、`/materials/imports/:batchId`；权限入口与单状态工作区 |
| 文件/SHA/XHR | PASS | 10 MiB 单文件预检；`@noble/hashes@2.2.0` MIT、1 MiB 分块 Worker；单 file part XHR、浏览器 boundary、真实进度 |
| 状态/恢复 | PASS | 服务端状态权威、URL allowlist、独立 Key/不可变载荷、RESULT_UNKNOWN、重复新批次、2/5/10 轮询、Retry-After、取消竞争 |
| Rows/Mapping | PASS | 完整 256 列、20/50 服务端分页、Sheet/Header、动态 Catalog、保存/preview/confirm 新鲜度、confirmed 只读 |
| UI 专项 | PASS | UI-001—UI-100 全部通过；含 10 MiB SHA 分块边界、权限、URL、错误、键盘与焦点 |
| Playwright 门禁 | PASS | Chromium 1366×768：50×256 + 256 Mapping，初渲染 1751 ms、翻页 1083 ms、横滚 197 ms、30,285 DOM、123,423,127 bytes JS heap；末列 IV、sticky、语义、键盘、700 窄屏和 0 console error/warning通过 |
| Site 全量 | PASS | build 成功，Node 440/440；首次并行高负载触发历史迁移 120 秒超时，串行全量通过 |
| lint | PASS | 0 error；1 个任务外既有 `build_material_workbook.mjs` unused warning |
| API/OpenAPI | PASS | 隔离 API smoke；仓库 5 份 OpenAPI 3.1、434 个本地引用、Batch 6 个操作通过 |
| Drizzle | PASS | 34 tables，`No schema changes, nothing to migrate`；未创建 0006 |
| 凭证/本地基线 | PASS | 289 文件凭证扫描；临时 SQLite self-test、smoke、go-live 通过并清理 |
| 生产影响 | NONE | 未连接 production/公共 URL/远程 D1/R2/Queue，未创建 binding/Cron、迁移、修改 hosting 或部署 |
| 已知限制 | RECORDED | page_size=100 未开放；File、unknown 操作与 preview 只在页面内存；远程生产容量/冷启动未验收 |

## PHASE2-TASK07 Mapping Target Catalog V1 非生产实现

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 12 项正式决定已批准并实施；Catalog 门禁已 `RESOLVED` |
| API | PASS | `GET /api/material-master/import-batches/:batchId/mapping-targets`；仅支持 namespace/q/limit/cursor，DTO/OpenAPI 一致 |
| Registry/Snapshot | PASS | BASIC/SPECIAL 单一 Registry + 运行时 D1 ACTIVE ATTRIBUTE；Catalog、准备、保存、preview、confirm 共享 `material-import-mapping-metadata-v1` |
| digest/cursor | PASS | 业务语义进入 Mapping SHA-256；展示文案不进入 Mapping digest但进入 cursor 搜索摘要；稳定排序、条件绑定和旧 cursor 409 通过 |
| 权限/安全 | PASS | AUTH/read/map/owner/read_any、隐藏 404、可见无 map 403、读取限流、request_id、no-store 和安全审计通过；无 attribute_id/数据库内部信息 |
| Catalog 专项 | PASS | 51/51，覆盖正式 43 项最低契约和共享规则/历史失效/空结果/Repository 失败/日志去敏回归 |
| Site 全量 | PASS | build 成功，Node 339/339；原 288 基线全部保留 |
| lint/凭证 | PASS | lint 0 error/1 个既有 warning；凭证扫描通过 |
| API/OpenAPI | PASS | 一次性隔离 D1 API smoke 通过；OpenAPI 3.1 YAML、路由、参数、DTO、错误和 no-store 契约检查通过 |
| Drizzle | PASS | `db/schema.ts`、`drizzle/`、snapshot/journal 无差异；未创建 0006 |
| 本地基线 | PASS | 临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore、go-live 通过并清理 |
| 生产影响 | NONE | 未连接 production/公共 URL/远程 D1/R2/Queue，未创建 binding/Cron、迁移、修改 hosting 或部署 |
| UI 状态 | IMPLEMENTED BY PHASE2-TASK08 | Catalog 门禁已被真实 Workspace 使用；50×256 性能与可访问性门禁通过 |

## PHASE2-TASK06 Mapping Target Catalog V1 书面设计基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / CONFIRMED BY TASK07 | 规格、OpenAPI 和 12 项决定已形成；全部决定由 PHASE2-TASK07 批准 |
| 推荐路由 | APPROVED / IMPLEMENTED | 批次作用域 `GET .../:batchId/mapping-targets`；全局路由与混入 Mapping 仅保留比较 |
| 权限/可见性 | DESIGNED | read + map + owner/read_any；隐藏批次 404，`read_any` 不隐含 map |
| Catalog 来源 | DESIGNED | BASIC/SPECIAL 来自共享 Registry；ATTRIBUTE 来自运行时 D1 ACTIVE metadata；禁止 seed/fixture/历史 Mapping |
| target DTO | DESIGNED | 保留现有小写 namespace 与大写 code，返回分组、类型、必填、mapping modes、default/unit/value constraints、enabled/selectable；不返回内部 ID/列名 |
| digest 审计 | RESOLVED BY TASK07 | 已抽共享 Registry + Snapshot，Catalog、准备、保存、preview、confirm 使用同一算法 |
| 搜索/cursor | DESIGNED | 三组统一有界分页；q 最大 64、limit 默认 50/最大 100、稳定排序、cursor 绑定业务与展示搜索快照，旧 cursor 409 |
| 缓存/历史目标 | DESIGNED | `private, no-store`；历史 Mapping code 保留，Catalog miss 由 UI 标失效，不新增 resolver、不自动替换 |
| 测试计划 | COMPLETE | 43 项未来实施测试，含权限、D1 metadata、digest、cursor、限流、审计、OpenAPI、隔离 D1 和 288 项回归 |
| 文档阶段验证 | PASS | 5 份 OpenAPI YAML/本地引用、规格 43 项编号/12 项决定、lint 0 error/1 个既有 warning、build 与 Node 288/288、隔离 API smoke、Drizzle 34 表无漂移、272 文件凭证扫描通过；首次 `npm test` 因 183 秒工具时限被终止并产生 reporter EPIPE，干净重跑 288/288 |
| 本地基线 | PASS | Python 3.12 临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore、go-live 通过并清理 |
| 生产影响 | NONE | 未连接 production/公共 URL/远程 D1/R2/Queue，未迁移、修改 Metadata、部署或修改 hosting |

## PHASE2-MAINT-01 Protected Down 注释语句测试修复基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 只恢复测试基线，不实施新功能 |
| 根因 | FIXED | 既有 helper 以 breakpoint 分割后仅 `trim().filter(Boolean)`；尾部 `-- End of protected 0005 rollback.` 非空，因而被作为无可执行 SQL 的 D1 statement 提交 |
| 修复层级 | PASS | 新增共享 breakpoint-aware 过滤辅助器；识别空白、行注释、块注释、单/双引号及成对引号转义，原样返回可执行片段；未闭合字符串/块注释 fail-closed 保留给 D1 报错，不支持嵌套块注释 |
| Migration 语义 | UNCHANGED | `0003`、`0004`、`0005` Up/Down、Schema、snapshot、journal 均未修改；0005 尾部保护说明保留 |
| Migration 专项 | PASS | 共享辅助器 10/10，0003/0004/0005 Down 与其他专项合计 20/20 |
| Site 全量基线 | PASS | build 与 Node 288/288、隔离 API smoke、4 份 OpenAPI、Drizzle 34 表无漂移、凭证扫描通过；lint 0 error/1 个既有 warning |
| 本地基线 | PASS | Python 3.12 临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore、go-live 通过并清理 |
| 生产影响 | NONE | 未连接 production/公共 URL/远程 D1，未迁移、部署或修改生产配置 |

## PHASE2-TASK05 Material Import Workspace UI V1 书面设计基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / SPECIFICATION CONFIRMED | 完整规格与 16 项决定已由项目负责人确认；Catalog 门禁已由 PHASE2-TASK07 解除，运行时 UI 实施仍受 50×256 性能与可访问性门禁限制 |
| 正式交付 | COMPLETE | `material-import-ui-v1.md`、wireframes、state matrix 三份独立文档 |
| 路由/恢复 | DESIGNED | 三条路由、单状态工作区 Stepper、view 非权威、allowlist/replaceState、单向 opaque cursor 单批结果导航 |
| 创建/上传 | DESIGNED | 客户端有限预检、Worker 增量 SHA、确认后创建、共享 Client 内 XHR、真实字节进度、独立幂等/RESULT_UNKNOWN、重复文件新批次恢复 |
| 解析/取消 | DESIGNED | parse 前重读与独立 Key、2/5/10 秒轮询、网络/429 退避、粗粒度真实状态、五状态协作式取消与 CAS 竞争 |
| Sheet/Rows/Header | DESIGNED | Sheet 可见性、真实 Rows 分页、稀疏 cell/DATE/FORMULA/ERROR、原始行与 Mapping 样本分离、Sheet/Header 随 Mapping 保存 |
| Mapping | IMPLEMENTED BY PHASE2-TASK08 | 三列编辑、显式保存、已保存版本 preview、当前页面最新 preview 门禁、服务端 confirm 最终裁决、confirmed 只读已实现 |
| Catalog 门禁 | RESOLVED BY PHASE2-TASK07 | 已实现批次作用域动态 Catalog 与共享 Registry/Snapshot/digest；仍禁止 seed、前端硬编码或历史 Mapping 绕过 |
| 表格门禁 | PASSED BY PHASE2-TASK08 | 50×256 的渲染、翻页、横滚、sticky、键盘、DOM、内存、语义、1366/窄屏均有 Playwright 记录 |
| 线框/矩阵/测试设计 | COMPLETE | 覆盖 22 个指定状态、集中主状态/URL/preparation/unknown/dirty/权限/门禁矩阵，100 个唯一未来实施测试编号 |
| 文档检查 | PASS | 100 项编号、16 项决定、22 状态结构、无 TBD/TODO 占位、`git diff --check` 与 docs-only 范围在提交前复核 |
| Site 静态/安全 | PASS | lint 0 error/1 个既有 warning；环境守卫 6/6；4 份 OpenAPI YAML 解析；268 文件凭证扫描；隔离 API smoke 通过 |
| Site 全量基线 | RESTORED BY PHASE2-MAINT-01 | 原 docs-only 任务发现的 0005 comment-only statement 失败已在共享测试辅助层修复；build 与 Node 288/288 通过，Migration 业务语义未变 |
| 本地基线 | PASS | Python 3.12 临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore、go-live 通过并清理 |
| 生产影响 | NONE | 未连接 production/公共 URL/远程 D1/R2/Queue，未创建 binding/Cron、迁移、修改 hosting 或部署 |

## PHASE2-TASK04 Excel/CSV Parser 与字段 Mapping V1 实施基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 16 项决定和非生产范围已批准；实现、测试和文档完成后停止 |
| Parser | PASS | 有界 XLSX/CSV 流式解析；UTF-8/BOM/GB18030、三种分隔符、类型化 cell、公式不执行、1900/1904、隐藏 Sheet、XML/ZIP 安全与组合资源上限 |
| 调度与恢复 | PASS / INJECTABLE | D1 Outbox、可注入 scheduler、Queue adapter、至少一次去重、租约领取/接管/心跳、Sheet 恢复、原子发布和 Mapping 准备独立重试；未创建生产 Queue/binding |
| Shared Strings/行 | PASS | run 级 D1 分块、有界 LRU、稳定 raw row hash、100 行逻辑批次与幂等冲突检测；发布前行不成为 current |
| Mapping/API | PASS | 关系化 Mapping、静态/动态 target allowlist、metadata 摘要、完整替换、100 行预览、确认 CAS、七个精确路由、权限/owner/read_any/CSRF/幂等/审计；不创建 Material Draft |
| `0005` | PASS / NOT APPLIED TO PRODUCTION | Up、Drizzle snapshot/journal、受保护 Down、legacy 行保留回填、批次/current-run 等价引用触发器、失败回滚和重升 4/4 |
| 兼容门禁 | PASS LOCALLY | 固定 `@zip.js/zip.js@2.8.26`、`sax-wasm@3.1.4`、`csv-parse@7.0.1`；Miniflare/WASM/Web Streams/R2 Range 替身/Bundle/64 MiB heap 门禁 3/3 |
| 依赖审计 | KNOWN BASELINE | `npm audit --omit=dev` 报告 Next 内置 PostCSS 的 2 个 moderate；建议的 force fix 会产生破坏性版本变化，未在本任务自动修改。三项新增 Parser 依赖的固定版本与许可证门禁通过 |
| 专项测试 | PASS | Parser 36、集成 11、migration 4、兼容 3，共 54/54 |
| Site 基线 | PASS | `npm test` 构建成功、Node 278/278；独立 build、Parser 类型夹具、隔离 API smoke、OpenAPI YAML、Drizzle 无漂移和 265 文件凭证扫描通过；lint 0 error/1 个任务外既有 warning |
| 全仓 TypeScript | KNOWN BASELINE | `tsc --noEmit` 仍有 10 个任务外既有错误，位于 multipart/service、Material list 与既有 schema 自引用；本任务未降低检查或扩大范围修复 |
| 本地基线 | PASS | 项目 Python 3.12 的环境守卫 4/4、self-test、smoke、backup/restore 和临时 SQLite go-live 检查通过；临时数据已清理 |
| 生产影响 | NONE | 未连接 production、公共 URL、远程 D1/R2/Queue，未创建 binding/Cron、执行生产 migration、修改 hosting 或部署 |

## PHASE2-TASK03 Excel/CSV Parser 与字段 Mapping V1 书面设计基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / CONFIRMED BY TASK04 | 16 项决定已由项目负责人批准并在 PHASE2-TASK04 非生产实现 |
| 正式交付 | COMPLETE | Parser 主规格、OpenAPI 草案、Mapping 规格、Mermaid 流程图和 16 项 `PROPOSED` 决策表 |
| `PARSED` 语义 | DESIGNED | 当前策略允许的可见 Sheet 原始行、元数据和汇总完整核验后，run 状态、旧 run、current pointer、批次版本、事件、审计和幂等在单事务发布 |
| 调度 | PROPOSED | D1 同事务写 Outbox，提交后至少一次发送；Queue `max_batch_size=1` 与低并发仍需压测和基础设施审批，不宣称 D1/Queue 原子 |
| 恢复 | DESIGNED | 七个持久阶段；Sheet 是 V1 真正恢复边界，500 行/约 10 秒检查点只用于观测、预算、心跳和幂等写入 |
| 解析候选 | UNVERIFIED / PROPOSED | `zip.js + sax-wasm + 受限 OOXML`、`csv-parse` browser ESM；尚未通过 Vinext、Miniflare、Workers、WASM、R2 Range、Bundle 或内存矩阵 |
| 原始契约 | DESIGNED | sparse cells + `source_column_count`，区分缺失与 EMPTY；日期保留 source/raw/format/system/解释状态；公式不执行 |
| Shared Strings | PROPOSED | run 级 D1 分块和有界预取为推荐候选，R2 分块索引为备选；禁止逐 cell 查询或默认全量常驻内存 |
| 资源限制 | PROPOSED | 32 Sheet、50k 行、256 列、2m 非空 cell、256 MiB 规范化总量等组合限制；最终值需脱敏样本与容量/并发压测 |
| Mapping | DESIGNED / PROPOSED | Sheet/header suggestion、关系化主从、target allowlist、`category_hint`、版本 CAS、旧 Mapping STALE/SUPERSEDED 和有界预览 |
| API | CONTRACT ONLY | 七个拟议路由，包含权限、owner/read_any、CSRF、幂等、批次/Mapping 版本、metadata 摘要和稳定错误；未实施 |
| `0005` | DESIGN ONLY | 设计新表、状态 CHECK、rows 重建、外键/索引、Up/Down/重升/失败回滚；未创建 SQL、schema 或 snapshot |
| 文档验证 | PASS | OpenAPI YAML 与 115 个本地引用通过；规格约束/16 项决策检查通过；lint 0 error/1 个既有 warning、build 与 Node 224/224、隔离 API smoke、251 文件凭证扫描通过；临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore、go-live 通过并清理；`git diff --check` 和文档-only 范围核对通过 |
| 生产影响 | NONE | 未连接 production、D1、R2 或 Queue，未迁移、创建资源、修改部署配置或发布 |

## PHASE2-TASK02 Material Import Batch Foundation V1 实施基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING ACCEPTANCE | 12 项决定已批准；非生产实现、测试和文档完成，停止等待验收或新任务 |
| 正式交付 | COMPLETE | 正式规格、OpenAPI、Mermaid 图、`0004`、运行时模块、集成与测试全部同步 |
| 基础设施现状 | SAFE / LOCAL ONLY | `.openai/hosting.json` 的 `r2` 仍为 `null`；只新增抽象、R2 适配代码和内存替身，没有创建生产资源 |
| 存储与上传 | IMPLEMENTED | 私有对象存储抽象 + D1 元数据；恰好一个 file part、10 MiB 流式计数、增量 SHA、类型探测、条件写入且不公开对象定位信息 |
| Saga 与状态 | PASS | D1 意图、对象存储不可覆盖写入、STORED、安全检查、FILE_READY 分层；对象不一致和提交结果不确定进入 `RECONCILIATION_REQUIRED` |
| 数据模型 | PASS | `0004` 创建四张业务表和专用幂等表；V1 六种批次状态、外键/唯一/CHECK/终态约束及 Down 数据保护均有测试 |
| API/权限 | PASS | 六个精确路由；Session、capability + owner/`read_any`、隐藏 404、CSRF、限流、request_id、CAS、稳定错误码；无下载端点 |
| 幂等/并发 | PASS | multipart 摘要排除 boundary/原始字节/Content-Length；条件写不覆盖；覆盖响应未知、并发单文件、取消/完成 CAS 与 D1 后提交失败 |
| 保留/清理 | IMPLEMENTED / NOT SCHEDULED | 30/1095 天终态字段和两阶段手工清理服务已实现；未创建生产生命周期或 Cron |
| Migration | PASS / NOT APPLIED TO PRODUCTION | 生成 `0004` SQL、Drizzle schema/快照和带数据保护 Down；空库/已有数据/约束/回滚/原子失败 3/3 通过 |
| 文件安全 | PASS | XLSX OOXML/ZIP 边界、宏/加密/路径/压缩风险和 CSV UTF-8/GB18030/NUL/二进制/HTML 伪装均有覆盖；不宣称杀毒能力 |
| Site 基线 | PASS | build、全量 Node 224/224、导入专项 12/12、迁移 3/3、隔离 API smoke 和 247 文件凭证扫描通过；lint 0 error/1 个既有 warning |
| 本地基线 | PASS | 项目 Python 3.12 临时 SQLite `server.py --self-test`、`smoke_test.py` 和 `go_live_check.py --no-backup` 通过；临时数据已清理 |
| 运行时范围 | IMPLEMENTED AS AUTHORIZED | 仅在线生产方向新增基础模块；没有解析业务行、写入 `material_import_rows`、创建 Material Draft 或扩展本地旧版业务逻辑 |
| 生产影响 | NONE | 未连接 production、公共 URL、远程 D1/R2 binding，未迁移真实数据、创建 bucket/密钥或部署 |

## PHASE1-TASK14 Material Review UI 实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING ACCEPTANCE | 非生产前端实现、自动测试、浏览器验收、文档和独立功能提交完成；未自动开始后续任务 |
| 页面路由 | IMPLEMENTED | 新增 `/materials/review`、`/materials/:materialId/review`；入口只由 `material.review.queue` 控制 |
| 队列 | PASS | URL 权威筛选、300ms keyword、四种 allowlist 排序、20/50/100 服务端分页、叶子分类、创建人和提交日期；展示但不筛选 `submitted_by`，服务端 `total` 为权威 |
| 工作台 | PASS | 方案 A；左侧完整只读详情，右侧实测 310px sticky Validation/职责分离/审核操作；基本信息、职责、属性、Validation 和历史展示复用共享组件 |
| 批准与驳回 | PASS | 最终动作前重读统一详情；ERROR 禁止批准，WARNING 明示确认；批准返回正式编码与 ACTIVE，驳回返回 DRAFT 并复读 `last_rejection` |
| 权限与职责 | PASS | queue/approve/reject 独立能力；创建人或最后修改人禁审、提交人本身不禁审；前端无角色名推断，服务端继续最终裁决 |
| 安全与并发 | PASS | 复用 Session/共享 Client/CSRF；approve/reject 独立页面内存 Key 和不可变载荷；RESULT_UNKNOWN 仅原请求安全重试，覆盖版本冲突、状态变化、429、dirty 和离开保护 |
| 状态与可访问性 | PASS | 400/401/403/404/422/429/5xx、request_id、加载/空/无结果、焦点定位、对话框初始焦点/Tab/Escape/恢复和 live region 均有实现或测试 |
| UI 测试 | PASS | Review UI 51/51；只读 UI 回归 37/37；全量 Node 209/209 |
| 浏览器验收 | PASS | 本地 Vinext + Playwright 1366×768；队列 2 行、sticky 右栏 310px、WARNING 复选确认、批准写入模拟与成功返回原队列完整往返通过 |
| Site 基线 | PASS | build、lint 0 error/1 个既有 warning、一次性隔离 D1 API smoke、233 文件凭证扫描通过 |
| 本地基线 | PASS | 临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 `go_live_check --no-backup` 通过；临时数据已清理 |
| 数据库/API 范围 | UNCHANGED | 未修改 API、Schema、migration、索引、Material 业务服务、Legacy SQLite 或部署配置 |
| 生产影响 | NONE | 未连接生产 URL/D1，未迁移真实数据、部署或修改生产配置 |
| 已知限制 | RECORDED | 队列 API 不支持 `submitted_by` 筛选；公开 Site 仍为旧版本；生产迁移/部署、候选索引及 `PENDING_APPROVAL` 收缩需独立任务 |

## PHASE1-TASK13 Material Review UI 书面设计基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING SPECIFICATION CONFIRMATION | 五段设计和补充约束已确认；正式规格与低保真线框完成，停止并等待“规格确认” |
| 页面路由 | DESIGNED | `/materials/review`、`/materials/:materialId/review`；队列 URL 保存筛选、排序和分页，`return_to` 仅接受审核队列路径 |
| 推荐布局 | APPROVED | 方案 A：左侧完整只读详情，右侧 sticky Validation、职责分离和审核操作；方案 B 仅作线框比较 |
| 权限与职责 | APPROVED | 能力权限驱动；创建人或最后实质修改人禁审，提交人本身不禁审；前端提示，服务端 403 code 最终裁决 |
| 批准与驳回 | APPROVED | 批准前重读详情并单一最终确认；WARNING 明示确认；驳回原因 1–1000 字；成功返回原队列状态 |
| Validation | APPROVED | 确认绑定 material_id、current_version 和当前规范化摘要；摘要仅用于前端新鲜度，服务端重新校验是唯一安全边界 |
| API 兼容 | RECORDED | 队列无 `submitted_by` 筛选；职责分离使用既有 HTTP 403；不新增 metadata version API，三项均不阻断前端实施 |
| 组件边界 | DESIGNED | 后续实施仅最小提取现有只读详情展示，不复制逻辑、不改变契约、不引入大型依赖；本任务未改代码 |
| 测试设计 | COMPLETE | 分组保留全部 51 项，覆盖 A/B、队列/工作台、两类确认、职责分离、冲突/结果未知、HTTP 错误和 1366×768 |
| 文档阶段验证 | PASS | lint 0 error/1 个既有 warning；构建与 Node 158/158、隔离 API smoke、226 文件凭证扫描通过 |
| 本地基线 | PASS | 临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 `go_live_check --no-backup` 通过；临时数据已清理 |
| 运行时范围 | UNCHANGED | 无前端运行时代码、API、Schema、Migration、索引、业务服务、测试业务代码或部署配置变化 |
| 生产影响 | NONE | 未连接 production、公共 URL、远程 D1 binding，未迁移真实数据或部署 |

## PHASE1-TASK12 Material Draft UI 实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING ACCEPTANCE | 非生产前端实现、隔离验证、文档和独立功能提交完成；未自动开始后续任务 |
| 页面路由 | IMPLEMENTED | 新增 `/materials/new`、`/materials/:materialId/edit`；列表与 DRAFT 详情入口由 `user.permissions` 和所有权能力驱动 |
| 布局与表单 | PASS | 布局 C；分类/基础信息并列、动态属性全宽、200px 快速定位与 Validation、sticky 操作区；TEXT/INTEGER/DECIMAL/BOOLEAN/ENUM 和单位由当前 D1 Schema 驱动 |
| 数据语义 | PASS | 严格整数/小数、完整属性聚合、0/false 保留、空可选属性省略、MANUAL 固定来源、source_ref 只读、未知旧属性显式删除保护 |
| 写链路 | PASS | 创建 POST 后进入编辑页；编辑采用 PATCH 完整替换、GET 回读、WARNING 确认和 submit；保存/同步/提交期间禁用输入 |
| 安全与并发 | PASS | 复用 Session/CSRF/同源 Cookie；Material 写请求缺少显式 Key 或 CSRF 时 Client fail-closed；原 Key/原载荷安全重试、RESULT_UNKNOWN、SAVED_UNSYNCED、VERSION_CONFLICT 对照和 429 Retry-After 已覆盖 |
| 状态与可访问性 | PASS | 401/403/404/409/422/429/5xx、request_id、dirty/beforeunload、分类切换、离开确认、焦点定位、Tab/Escape/焦点恢复和 last_rejection 只读展示均有实现或测试 |
| UI 测试 | PASS | Draft UI 54/54；Material 只读 UI 回归 37/37；全量 Node 158/158 |
| 浏览器验收 | PASS | 一次性本地 D1 完成创建、编辑、PATCH/GET/submit 至 PENDING_REVIEW；1366/1280/1024/768 均无横向溢出，三列按断点降为两列/一列，离开保护与成功跳转通过 |
| Site 基线 | PASS | build、lint 0 error/1 个既有 warning、一次性 D1 API smoke、224 文件凭证扫描通过 |
| 本地基线 | PASS | 临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 `go_live_check --no-backup` 通过；临时数据已清理 |
| 数据库/API 范围 | UNCHANGED | 未修改 API、Schema、migration、索引、Material 写服务、Legacy SQLite 或部署配置 |
| 生产影响 | NONE | 未连接生产 URL/D1，未迁移真实数据、部署或修改生产配置 |
| 已知限制 | RECORDED | 详情契约没有历史 `schema_version`；V1 以当前 Schema、未知 code 保护和服务端 422 重新加载 fail-closed，不自动迁移旧属性 |

## PHASE1-TASK11 Material Detail last_rejection 投影状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING ACCEPTANCE | 非生产实现、隔离验证、文档和独立功能提交完成；未开始 PHASE1-TASK12 |
| 历史规范来源 | PASS | 单一使用不可变 `material_versions` REJECT 行；当前写事务完整保存版本、原因、审核人和审核时间，不需要关联 change logs |
| 统一 Query Service | IMPLEMENTED | `/materials/:id` 与 `/drafts/:id` 共用 `lastRejection()`；先完成既有行级可见性，隐藏对象仍为 404 |
| 确定性与有界性 | PASS | `version_no DESC, reviewed_at DESC, id DESC LIMIT 1`；不读取最近 5 条推断，不加载全部历史，不影响列表或引入 N+1 |
| 安全与损坏历史 | PASS | reason 作为纯文本原样返回；缺少版本、原因、审核人或有效时间时 fail-closed 为脱敏 `INTERNAL_ERROR` 并保留 request_id |
| 查询计划 | PASS / NO MIGRATION | `SEARCH material_versions USING INDEX material_versions_material_version_uq (material_id=?)`；无全表扫描，未新增索引；极大单物料历史需后续复测 |
| 回归覆盖 | PASS | null、单次/多次驳回、摘要外驳回、重新编辑/提交、最终 ACTIVE、两接口一致、drafts 状态限制、隐藏 404、纯文本、损坏历史和分页/摘要不变 |
| Site 基线 | PASS | build、Node 104/104、lint 0 error/1 个既有 warning、一次性 D1 API smoke、219 文件凭证扫描和 OpenAPI YAML 解析通过 |
| 本地基线 | PASS | 临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 `go_live_check --no-backup` 通过；临时数据已清理 |
| 数据库/API 范围 | UNCHANGED STRUCTURE | 只扩展两个既有详情响应字段；无新路由、Schema、migration、索引、历史修改或写服务变化 |
| 生产影响 | NONE | 未连接生产 URL/D1，未迁移、部署或修改生产配置 |

## 统计复现方式

1. 使用 `rg --files` 获取两个运行面的源码文件。
2. 排除 `data/`、`node_modules/`、`.next/`、`dist/`、`.wrangler/`、生成物和嵌套仓库中的重复导入目录。
3. 代码扩展名：`.py`、`.ps1`、`.ts`、`.tsx`、`.js`、`.mjs`、`.html`、`.css`、`.sql`。
4. API 统计从在线集中式处理器提取具体 `/api/...` 字符串并去重。
5. 数据表统计来自本地 `server.py` 建表语句及在线 `db/schema.ts`。

## 下次更新触发条件

- 任务状态或 Branch 变化
- 新提交、发布或生产 Site 版本变化
- 数据库迁移或表数量变化
- API、页面、测试或主要目录变化
- 统计口径变化

## PHASE1-TASK10 Material Draft UI 书面设计基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING ACCEPTANCE | 五节设计及全部补充约束已确认；只完成规格和线框稿 |
| 页面路由 | DESIGNED / IMPLEMENTED BY TASK12 | `/materials/new`、`/materials/:materialId/edit` 已由后续 PHASE1-TASK12 实施 |
| 布局 | APPROVED | 布局 C；分类/基础信息首屏并列、动态属性全宽、约 200px 快速定位与 Validation、sticky 操作区和窄宽降级 |
| 表单与 Schema | APPROVED | 当前 D1 Schema、完整 PATCH、严格数值、0/false、未知属性保护、分类切换确认和 Schema 漂移 fail-closed |
| 写状态 | APPROVED | POST 后 GET、PATCH/GET/submit、WARNING 确认、Idempotency 状态机、RESULT_UNKNOWN、SAVED_UNSYNCED、dirty 和版本冲突对照 |
| 权限 | APPROVED | `/api/session -> user.permissions`；不硬编码角色；服务端继续最终校验权限、所有权、状态和 expected_version |
| API 兼容 | PREREQUISITE COMPLETE | Session/创建响应/validate-only 未调整；统一详情 `last_rejection` 已由 PHASE1-TASK11 在非生产开发代码实现 |
| 测试设计 | COMPLETE | 单元、组件、集成、原 47 项加 7 项扩展 E2E，以及 1366×768 人工视觉/键盘验收 |
| 文档阶段基线 | PASS | lint 0 error/1 个既有 warning；Node 103/103；隔离 API、凭证扫描、临时 SQLite 五项基线和 `git diff --check` 通过 |
| 代码/API/schema 变化 | NONE IN TASK10 | TASK10 未修改运行时代码；后续 TASK12 仅实施前端与测试，仍未修改 API、Schema、Migration、索引或业务服务 |
| 生产影响 | NONE | 未连接生产 D1、未迁移真实物料、未部署或修改生产配置 |

## PHASE1-TASK09 Material 只读管理界面实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING ACCEPTANCE | 规格已确认，非生产实现、测试和文档完成 |
| 页面路由 | IMPLEMENTED | `/materials`、详情、版本和变更日志四条原生 Vinext 路由；本地开发运行面深链接均返回 200 |
| 布局 | PASS | 高密度企业表格列表；高密度分区卡片详情；独立 URL 历史页签；首屏无统计卡片 |
| URL 与分类 | PASS | URL 权威筛选/排序/分页、300ms keyword debounce、popstate、安全 return_to、叶子 ID/非叶子 path 语义均有测试 |
| 认证与请求 | PASS | 复用现有 Cookie 和根页面登录遮罩；legacy 与 Material 共同委托唯一共享浏览器 Client；未硬编码生产地址或直连 D1 |
| 状态与错误 | PASS | INACTIVE 独立兼容、OBSOLETE/REPLACED 防御映射、unknown fallback；401/403/404/400/500、request_id、加载和空状态均覆盖 |
| UI 测试 | PASS | 37/37，覆盖任务要求的 36 类场景；无写操作、无界请求或客户端行级权限过滤 |
| Site 基线 | PASS | build、全量 Node 103/103、lint 0 error/1 个任务外既有 warning、一次性 D1 smoke 通过 |
| 本地基线 | PASS | 临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 go-live 检查通过；临时目录已清理 |
| 安全检查 | PASS | 217 个仓库文件凭证扫描通过；`git diff --check` 通过 |
| 生产影响 | NONE | 未连接生产 D1、未迁移真实物料、未部署或修改生产配置 |

## PHASE1-TASK08 Reference & Query API 实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING ACCEPTANCE | 规格与 metadata 兼容规则已确认，非生产实现和验证完成 |
| 运行时代码 | IMPLEMENTED | 统一 Material Query Service、Reference Service、共享可见性和单位策略已接入；未修改前端或 legacy SQLite |
| 数据库 | UNCHANGED | 未修改 `db/schema.ts`、`drizzle/` 或任何 migration，未增加索引 |
| 统一查询 | PASS | `/materials` 覆盖全部生命周期；`/drafts` 复用统一可见性与详情组装；`/review-queue` 保持独立权限 |
| 行级可见性 | PASS | 正式状态全 read；DRAFT/PENDING_REVIEW 按创建人、edit-any、review-queue；隐藏详情/历史 404，列表及 total 完全过滤 |
| Reference | PASS | 完整启用分类 tree/flat、无 parent 懒加载；叶子 Schema 只读 D1 metadata；description/label fallback 和强 ETag/304 已验证 |
| 历史 | PASS | 详情每类最多 5 条摘要；版本和变更日志独立分页默认 20、最大 50；损坏 JSON fail-closed |
| 缓存与批量 | PASS | Reference 私有可验证缓存；物料及历史 private/no-store；列表 metadata 查询次数不随页大小增长 |
| 索引证据 | COMPLETE / NO MIGRATION | 1k/10k/100k 计划与采样完成；发现创建人 OR 可见范围等候选方向，只形成报告，未创建 migration |
| 非生产基线 | PASS | Site build、Node 66/66、lint 0 error/1 个既有 warning、一次性 D1 smoke、201 文件凭证扫描及临时 SQLite 完整基线通过 |
| TypeScript 全量检查 | EXISTING FAILURE | 仅 `db/schema.ts:147`、`:332` 的既有 Drizzle 自引用 TS2740；TASK08 文件未出现类型错误，按授权未修改任务外问题 |
| 生产影响 | NONE | 未连接生产 D1、未迁移真实数据、未部署或修改生产配置 |

## PHASE1-TASK07 草稿生命周期实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 九项方案 A 已确认、实现、验证并记录；等待人工验收 |
| 规格文档 | APPROVED/IMPLEMENTED | 生命周期规格和 OpenAPI 明确 PATCH 非 Merge Patch、提交、队列、审核状态及稳定错误 |
| 状态命名 | PASS | 新代码只写/只返回 `PENDING_REVIEW`；通用查询双读旧/新值；历史快照旧文字不改写 |
| 职责字段 | PASS | 新增 `last_modified_by`、`submitted_by`、`submitted_at`；创建人永久禁审，当前版本最后修改人禁审，提交人本身不禁审 |
| API | IMPLEMENTED | PATCH 完整替换、POST 提交、GET 审核队列已实现；approve/reject 只处理 `PENDING_REVIEW` |
| 权限 | PASS | edit-own/edit-any/submit/review-queue 在服务端独立校验；admin/manager 无职责分离例外，purchase/engineering 仅自己的草稿 |
| Migration | PASS | `0003`、Down、snapshot/journal、旧状态可恢复回填、失败预检、子表保全、约束、索引、空库 Down/重升通过 |
| 代码/API/schema 变化 | IMPLEMENTED | 仅修改在线服务端生命周期、Schema、Migration、测试和文档；未开发页面或下游业务 |
| 非生产基线 | PASS | Site build、Node 62/62、lint 0 error/1 个既有 warning、一次性 D1 API smoke、194 文件凭证扫描及本地临时 SQLite 完整基线通过 |
| TypeScript 全量检查 | EXISTING FAILURE | TASK07 新增代码无类型错误；`db/schema.ts` 两组既有 Drizzle 自引用类型诊断仍保留，按范围要求未修复 |
| 生产影响 | NONE | 未连接生产 D1、未迁移真实数据、未部署或修改生产配置 |

## PHASE1-TASK06 Draft/Review API 实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 项目负责人已确认八项业务/安全选择；实现、测试和项目文档完成，等待功能提交后人工验收 |
| 规格文档 | APPROVED/IMPLEMENTED | `docs/material-master/draft-review-api-v1.md` 已记录确认选择和实施结果 |
| 认证边界 | VERIFIED | 复用 `app_users`/`app_sessions` 和服务端会话 actor；未使用未接入 ERP 的 ChatGPT Header 身份；禁止客户端伪造操作者 |
| 授权边界 | PASS | admin/manager 审核，purchase/engineering 创建，其他角色只读；所有角色包括 admin 禁止自审 |
| CSRF | PASS | 登录轮换 host-only 双提交 Token；Material POST 严格验证同源 Origin、Cookie/Header，Session Cookie 继续 HttpOnly |
| 幂等与限流 | PASS | 专用持久表保存 canonical 请求摘要、租约和 24 小时结果；完成/成功审计与业务 batch 原子提交；60 次写/20 个新 Key，测试可降低阈值 |
| Query | PASS | 列表默认 20/最大 100；详情当前 metadata 校验、分类路径、版本和变更日志均有界分页 |
| Migration | PASS | `0002` Up/Down、schema、snapshot/journal、已有数据升级、约束、防重、空状态回滚和重升通过 |
| 代码/API/schema 变化 | IMPLEMENTED | 新增 5 路由、Material API 五模块、共享 Validation 映射、2 张安全表和审计扩展；未开发页面或下游业务 |
| Site 基线 | PASS | build 成功；Node 58/58；lint 0 error/1 个既有 warning；一次性 D1 登录/CSRF/API smoke 和凭证检查通过 |
| 本地基线 | PASS | 项目 Python 3.12 的环境守卫 4/4、self-test、smoke、backup/restore 和临时 SQLite `go_live_check --no-backup` 通过 |
| 差异检查 | PASS | `git diff --check` 通过；敏感正文、原始 Key、Session/CSRF Token 不进入 Material 审计或错误响应 |
| 生产影响 | NONE | 未连接生产 D1、未迁移真实数据、未部署或修改生产配置 |

## PHASE1-TASK05 草稿创建与审核写服务状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 2026-07-13 完成实现、验证、文档和独立功能提交 |
| 模块边界 | PASS | Types、D1 Repository、Draft Service、Review Service、Code Service 和统一导出保持独立；PHASE1-TASK06 通过受信适配调用，未复制业务规则 |
| 创建草稿 | PASS | Validation 无 ERROR 后原子写 `DRAFT`、类型化属性、`CREATE` 版本和 `CREATE_DRAFT` 审计；正式编码为空 |
| 批准启用 | PASS | 从 D1 重载并重新校验；单一 batch 原子领取序号、转 `ACTIVE`、写编码/批准信息、`APPROVE` 版本及两条审计 |
| 拒绝 | PASS | 保持 `DRAFT`、version + 1、追加 `REJECT` 版本和审计；不读取或消耗编码规则 |
| 属性存储 | PASS | 按 definition 类型列保存 TEXT/ENUM/INTEGER/DECIMAL/BOOLEAN，DECIMAL 精确缩放；保留 unit、source_type、source_ref、created_by/created_at |
| 并发与编码 | PASS | 同草稿双审核一成功一版本冲突；同规则双草稿读取同一旧序列后 CAS 重试并生成不同编码；唯一索引竞争路径跳过占用序号 |
| 规则漂移保护 | PASS | 创建和批准均比较 metadata/属性守卫；校验后品类/属性规则变化时事务冲突回滚 |
| 事务回滚 | PASS | 故障注入使最后一条编码审计失败，规则、物料状态、版本和审计全部保持事务前值 |
| 服务测试 | PASS | 新增 12/12 隔离 D1 场景；完整 Node 52/52 |
| Site 基线 | PASS | build 成功；lint 0 error/1 个既有 warning；隔离 API smoke、176 文件凭证检查和 `git diff --check` 通过 |
| TypeScript 全量检查 | EXISTING FAILURE | 新增模块无类型错误；`db/schema.ts` 第 129、243 行仍为既有 Drizzle 自引用类型错误 |
| 数据库/API 变化 | NONE | 未修改 schema、migration、API、页面、导入、BOM、采购、库存或生产 |
| 生产影响 | NONE | 未连接生产 D1，未迁移真实数据，未部署或修改生产 metadata |
| 已知限制 | RECORDED | 无多角色节点、草稿编辑/重新提交、API 权限/幂等；拒绝状态复用 `DRAFT`；编码规则仍需后续受控初始化 |

## PHASE1-TASK04 物料校验服务状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 2026-07-12 完成实现、验证、文档和独立功能提交 |
| 设计审批 | PASS | 采用 Repository + Rules + Service；D1 metadata 是运行时分类和属性规则唯一来源 |
| 接口边界 | PASS | attributes 按稳定大写 attribute code 索引；禁止 attribute_id；保留 source/confidence 扩展字段 |
| 服务实现 | PASS | Types、D1/Memory Repository、Rules、Service 和统一导出已完成；25 个结构化 code 中 24 ERROR、1 WARNING |
| Metadata 变化 | PASS | 隔离 D1 中标准单位、枚举、必填、属性定义/绑定/分类状态变化均在下一次校验生效 |
| 校验测试 | PASS | 新增 22 个顶层测试和 6 个子测试，共 28/28；Memory Repository 与指定 FR4/电阻/锡膏矩阵通过 |
| Site 基线 | PASS | build 成功；Node 40/40；lint 0 错误/1 个既有警告；隔离 API 烟测和凭证检查通过 |
| TypeScript 全量检查 | EXISTING FAILURE | 新增模块无类型错误；`db/schema.ts` 第 129、243 行仍有 PHASE1-TASK02 已记录的 Drizzle 自引用类型错误 |
| 业务变化 | NONE | 未修改 API、页面、迁移、真实物料或 BOM/采购/库存 |
| 生产影响 | NONE | 未连接生产 D1，未部署或修改生产 metadata |
| 已知限制 | RECORDED | 无品牌字典、不做单位数值换算、不支持 DATE、不检测跨物料冲突，source/confidence 暂不参与决策 |

## PHASE1-TASK03 分类与属性模板状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 分类数据 | PASS | 101 个节点、5 个一级分类、39 个四级叶子；父子级别连续 |
| 属性定义 | PASS | 34 个复用定义；覆盖 TEXT、INTEGER（NUMBER 语义）、DECIMAL、BOOLEAN、ENUM 与要求单位 |
| 属性绑定 | PASS | 228 条绑定全部指向四级叶子；叶子 39/39 均有完整模板，不存在父级继承 |
| Seed 幂等 | PASS | 首次写入后第二次 inserted 为 0，记录总数不变并输出 updated 统计 |
| 环境保护 | PASS | 仅接受 test/local；production 和 `--remote` 在数据库访问前拒绝 |
| 数据库影响 | NONE | `0001` migration、schema 和快照未修改；未连接生产 D1 |
| Site 基线 | PASS | lint 0 错误/1 个既有警告；build 成功；Node 12/12（包含 migration）通过 |
| TypeScript 全量检查 | EXISTING FAILURE | 本任务新增文件无类型错误；`db/schema.ts` 第 129、243 行存在 PHASE1-TASK02 已有的 Drizzle 自引用类型错误 |

## PHASE1-TASK02 Schema 实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 目标运行面 | CONFIRMED | 仅在线 Site/D1 schema；本地 SQLite 未修改 |
| 设计审批 | PASS | 已吸收正式编码审核后生成、生命周期、变更日志、供应商五要素时效唯一性和应用层校验调整 |
| 数据库变化 | IMPLEMENTED | 新增 12 张 V2 表的 Drizzle schema、`0001` Up/Down、snapshot 和 journal |
| 业务变化 | NONE | 未修改 BOM、采购、库存、生产、导入、AI、API 或页面 |
| 数据操作 | NONE | 未连接生产 D1，未迁移真实数据，未创建生产表 |
| 隔离迁移 | PASS | 空库 Up、防重、结构/约束、Down、重建通过；临时 D1 已清理 |
| 完整基线 | PASS | lint 0 错误/1 个既有警告；build 成功；Node 9/9；隔离 API 烟测、本地三项临时基线、凭证扫描和 `git diff --check` 通过 |

## PHASE0-TASK02 验证结果

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Site 环境守卫 | PASS | Node 6/6；production、公开 URL、非临时 D1 路径和非法环境名均拒绝 |
| 本地环境守卫 | PASS | Python 4/4；production/development 在数据库创建前拒绝 |
| 一次性 D1 API 烟测 | PASS | 完成合成写入、备份、恢复与错误提示验证；测试后数据库目录和进程均清理 |
| production 入口拒绝 | PASS | 退出码 1，未创建新临时目录 |
| 凭证检查 | PASS | `.env` 未跟踪；仓库文件、常见令牌格式和 hosting 键检查通过 |
| `server.py --self-test` | PASS | 输出 `SELF_TEST_OK`，使用临时 SQLite |
| `smoke_test.py` | PASS | 输出 `SMOKE_TEST_OK`，数据库和备份均位于临时目录 |
| `backup_restore_test.py` | PASS | 创建、恢复、非法名称提示和最终数据清理通过 |
| `go_live_check.py --no-backup` | PASS | 使用临时 SQLite；未写正式数据或备份 |
| `npm run lint` | PASS with warning | 0 错误、1 个既有未使用变量警告 |
| `npm test` | PASS | 构建成功，Node 测试 8/8 通过；沙箱缓存写入限制下获准在沙箱外重跑 |
| `npm run build` | PASS | 最终独立构建通过，未连接数据库或网络 |
| 最终仓库检查 | PASS | 149 个仓库文件凭证扫描通过；`git diff --check` 无空白错误；代码中无生产地址硬编码 |

任务没有创建云端 D1、连接生产 D1、修改生产数据、保存 Site 版本或执行部署。

## PHASE0-TASK01-B 验证结果

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| `server.py --self-test` | PASS | 输出 `SELF_TEST_OK`，使用临时数据库 |
| `go_live_check.py --no-backup` | PASS | 数据库检查通过；本地服务未启动，不要求在线健康检查 |
| `smoke_test.py` | FAIL（既有环境问题） | 临时测试进行到备份创建时返回 `unable to open database file`；与 PM-000 基线一致，未接触生产数据 |
| `npm run lint` | PASS with warning | 0 错误、1 个既有未使用变量警告，位于 Site 中此前合入的治理工具 |
| `npm test` | PASS | 沙箱内首次因 Vite 无权写 `node_modules/.vite-temp` 失败；按环境规则在沙箱外重跑后构建成功，渲染测试 2/2 通过 |
| Site tree 对比 | PASS | 纳管后的暂存子树 hash 与原 `9f2c2dc` tree hash 均为 `541decf5a685a0efc238868ef958d3ae500174e5` |
| Git 索引检查 | PASS | `chenyida_erp_site` 显示 77 个普通文件，仓库无 mode `160000` |
| 新 clone 恢复 | PASS | 使用 `git clone --no-local` 创建全新工作区；Site 为 77 个普通文件、0 个 gitlink，关键源码和文档完整存在，工作区干净 |
| 新 clone 依赖与测试 | PASS | Site 执行 `npm ci --offline` 安装 502 个包且 0 漏洞；`npm test` 构建成功、2/2 通过；本地 ERP `--self-test` 输出 `SELF_TEST_OK` |
| `git diff --check` | FAIL（继承内容） | 报告原 `9f2c2dc` tree 中既有的行尾空白和 EOF 空行；为保持 Site tree 完全一致，本任务未修改这些文件 |
| 在线 `erp-api-smoke.mjs` | NOT RUN | 脚本会写数据且尚无生产地址拒绝，禁止对公开生产 Site 执行 |

测试前后 `chenyida_erp_app/data/erp.sqlite3` 均为 233,472 字节，最后修改时间戳保持不变，本任务未修改正式本地数据库。
