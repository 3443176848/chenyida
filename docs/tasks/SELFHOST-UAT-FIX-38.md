# SELFHOST-UAT-FIX-38 — 收货预检与Web运行时版本合同修复

## 状态、阶段与授权边界

- 任务状态：`DONE`。
- 当前阶段：`WEB_ONLY_UAT_DEPLOYED / ZERO_WRITE_REVALIDATED`；最终结论为`SELFHOST-UAT-FIX-38 DEPLOYED AND REVALIDATED — NO UAT RECEIPT`。
- 决策状态：`DECISION_RECORDED`；收货预检与运行时版本合同源码、构建、版本门禁、隔离烟测、Web-only部署及唯一warehouse零业务写黑盒状态均为`PASS`。
- 日期：2026-08-09（Asia/Shanghai）。
- 最终部署阶段按单独书面授权只把并行非生产UAT Web从alpha.41替换为已通过候选alpha.42，并使用一个隔离Chromium、一个临时Profile、warehouse恰好一次登录/一次退出完成零业务写复验。未修改Schema、Migration、依赖、Compose、Caddy、systemd、Worker或业务逻辑；未运行Migration、未重建PostgreSQL/Worker/Caddy、未执行生产部署，也未push Git或镜像。
- 本任务不授权真实收货、IQC决定、Ledger、AP、Payment、Work Order或生产操作；`PO-00000001`继续受D-105保护。

## 最终Web-only部署与零写复验

- 严格部署起点为唯一worktree、clean `main@fc551c6571b57593a3232a14617935b3e3c3171f`、Parent `569aa954d764309e239d1f6c174e582596d33a24`、`origin/main...HEAD = behind 0 / ahead 185`。旧运行Web为容器`1e5394349c49895ca14aba09cd8f765cd88a7fff94b593ff675e165481b8865f`、镜像`sha256:0cf98937f3ae28fe68e84436ab85c12ef5e8922f50a04973641cb79b8a0d5f19`；候选、OCI labels和最小运行时package再次精确匹配alpha.42/revision `569aa954…d33a24`。
- 先创建本地精确回退tag `chenyida-erp-parallel-web:0.1.0-alpha.41-fix38-rollback`，再把通过候选标记为`latest`；固定`COMPOSE_PARALLEL_LIMIT=1`且只执行一次`docker compose ... up -d --no-deps --no-build --pull never --force-recreate web`。新Web容器为`f0066fe6fb07bd2542caf39f8409571125b0b8009592d7dfd3b754c91981a35f`，实际镜像`sha256:e7761e2c61bfe77c6aab526fb0b6cbd840ad1bf6300381f4319f6e279af94964`；PostgreSQL、Worker、Caddy容器ID逐字节不变。
- 本地和公开`/api/health`均为HTTP200，返回`version=0.1.0-alpha.42`、`database=postgresql`、`storage=local`、`worker=postgresql-jobs`及合法time；公开入口保留HSTS、nosniff、DENY、Referrer-Policy、Permissions-Policy、no-store和request ID。匿名warehouse页面/API的PO、Supplier、Material及创建审计标记均为0，API为401；Web日志敏感内容和SQL堆栈命中0。
- 登录前只读事务并ROLLBACK确认40/head0040、warehouse Session0、PO/Line/Plan/queue `1/4/4/4`、已收0及Receipt全部下游0。migration指纹`822e0e5bf92d4c267aa316668936a196ea23ec6c49a83ac82c777ce2c7fa2b19`和业务指纹`89915aaecad46c5a754ba3239c8bc9d8d4e4039dfad24827267614d32b06dd3b`保持。
- 唯一Chromium从根工作台记录初始实际选中分组“管理员”，通过可见分组控件切到“仓库”，再通过可见“仓库待入库”进入页面。完整草稿用`2099-12-31`触发恰好一次preview HTTP422，稳定code `RECEIPT_EVIDENCE_FUTURE_DATE`、中文提示和正文/header request ID一致；编辑卡显示三项证据，确认窗和最终按钮不可达，草稿保留。
- 合法日期只取登录前PostgreSQL只读事务的Asia/Shanghai日期`2026-08-09`。同一登录/浏览器内执行4次合法preview HTTP200并打开4次确认窗；NORMAL只投影普通Purchase Receipt/Receipt Line、普通`RECEIPT`及available立即重算，不包含`IQC_RECEIPT`、FROZEN、UNFREEZE或quality假设结果。“返回修改”为默认焦点，按钮、右上关闭、ESC和背景点击四种路径均清除modal/提交状态并保留底层草稿；390×844下无横向溢出且“返回修改”可键盘操作。
- 最终请求计数为login POST 1、logout POST 1、未来日期preview GET 422为1、合法preview GET 200为4、确认窗打开4、Business POST/PUT/PATCH/DELETE为0、Receipt POST为0、UAT收货过账为0。退出后的Back/Forward/Refresh和直接匿名warehouse路由均未恢复PO、Supplier、Material或确认窗。
- 退出后只读事务并ROLLBACK确认warehouse Session0，成功认证审计从LOGIN/LOGOUT `9/8`精确增至`10/9`；Migration、PO/Line/Plan/queue、已收数量、Receipt及全部库存/质量/财务/生产下游保持不变。候选运行稳定且无需回滚；`latest`最终指向alpha.42，旧alpha.41回退tag和被拒`sha256:81126136…278e`均保留。
- 部署前约available 1.9 GiB、Swap312 MiB/1 GiB、根盘17 GiB、Load `0.06/0.20/0.25`；收口约2.0 GiB、Swap320 MiB、根盘17 GiB、Load `0.05/0.16/0.16`。四服务restart0/OOM false，Docker和内核OOM/restart事件0；13 MiB浏览器Profile/模块/runner及任务容器已精确删除，四个受保护Volume完整保留。
- 最新正式FIX37备份仍在本机且未新增备份；异机复制仍未完成。部署和文档提交均未push，镜像无远端digest。结论只适用于`NON-PRODUCTION UAT ONLY / NOT PRODUCTION READY`，不能声称真实收货验收完成。

## 候选形成阶段历史记录

> 以下“未部署”“部署未授权”等表述记录FIX38各历史阶段当时的事实；当前最终状态以上述Web-only部署与零写复验为准，不改写历史证据。

## 严格起点与受保护事实

- 本镜像阶段从唯一worktree、clean `main@569aa954d764309e239d1f6c174e582596d33a24`、Parent `61f0b56788ef68b9b7aa6d34583d2ddc3bde3f66`、`origin/main...HEAD = behind 0 / ahead 184`起步；health提交`13f72b5f7aa51905af597733356420cc7b017b74`与Dockerfile提交`61f0b56788ef68b9b7aa6d34583d2ddc3bde3f66`均在祖先链，工作区、任务状态、镜像、UAT和资源门禁全部匹配。
- 运行时版本合同补救阶段从唯一worktree、clean `main@780075e0940a124410a72f9e39eac76cc5d9224e`、Parent `401e16b04e3b8cb70ddfd3508661353ff758fdec`、`origin/main...HEAD = behind 0 / ahead 181`起步；没有嵌套仓库、submodule或gitlink。
- 源码候选现为`0.1.0-alpha.42`；运行中的并行非生产UAT仍为`0.1.0-alpha.41`。PostgreSQL仍为40/head `0040_warehouse_receipt_readiness.sql`，0040 SHA-256仍为`b6781c94da3f52a8f719ce57cdf13acbb4e3fe1c66f2a0480bdb6a9ff10a5a93`；当前UAT Web镜像仍为`sha256:0cf98937f3ae28fe68e84436ab85c12ef5e8922f50a04973641cb79b8a0d5f19`。
- 上一次构建产生的候选镜像`sha256:81126136c63714be2a53812b3512549ed1fa4eb9deb7c8c6462b715eafe4278e`（tag `chenyida-erp-parallel-web:0.1.0-alpha.42-fix38-780075e`）仍完整保留并固定为`REJECTED — DO NOT DEPLOY`：其`/app/package.json`缺少version且当时health没有version。它没有`latest`标签、没有关联容器，也不得作为新源码合同的通过证据。
- Web、PostgreSQL、Worker、Caddy均为RestartCount 0、OOM false；Web/PostgreSQL healthy，Worker/Caddy running。warehouse账号`uat_20260729_warehouse`为active、`must_change_password=false`，有效Session为0。
- 只读事务确认PO为`1/v1/OPEN`，PO Line/Delivery Plan/queue为`4/4/4`且已收数量0；Receipt/Receipt Line/Evidence/Lot/IQC/Ledger/Purchase Financial Source/AP/Payment/Work Order及生产Issue/Return/Report/Completion均为0。
- 本阶段起点资源：available memory约2.2 GiB，Swap已用约300 MiB/1 GiB，根分区可用17 GiB，Load约`0.54/0.24/0.14`；内核OOM计数0。测试前无任务临时容器、数据库、文件或网络。

## 运行时版本合同补救背景

- 上一次候选构建门禁在任何候选容器或烟测启动前失败：standalone产物用仅含`private/type`的package JSON覆盖了源码metadata，最终镜像文件系统没有`0.1.0-alpha.42`，OCI version label不能替代应用运行时证据。
- 同一候选的`/api/health`只有既有`ok/database/storage/worker/time`字段，无法证明正在运行的应用版本；因此该镜像拒绝部署，运行UAT继续使用alpha.41。
- 前一源码阶段只修复源码和构建合同；本镜像阶段已从固定新HEAD构建并验证新的候选，但没有部署。已拒绝镜像继续原样保留，不得重新解释、重新标记或部署。

## 背景与需求审计

- FIX37后续黑盒补充发现：用户在Receipt编辑区填写晚于服务端Asia/Shanghai业务日期的送货凭证日期后，仍可进入可执行的最终确认窗口。最终Receipt POST已有服务端事务日期复核，0040触发器也有独立约束，因此该现象没有形成主UAT写入或数据损坏，但预检门禁没有失败关闭。
- 同一黑盒补充还把“当前NORMAL订单没有展示假设IQC结果”和“关闭确认窗后编辑区仍保留未提交字段”列为FAIL。需求复核确认，这两项不是直接缺陷：本次过账后果必须只描述当前Material的实际inspection mode；关闭确认窗返回编辑时保留尚未发送的草稿正是所需语义。
- FIX38只修复并验证已确认的预检缺口，同时把实际模式投影和返回修改语义固化为回归合同；不借本任务扩展教学比较或草稿清空功能。

## 已修复缺陷基线

- 实施前`openPreview`只把`quantity`加入`GET /api/procurement/delivery-plans/:id/receipt-preview`查询，没有传递`evidence_document_date`；现已使用`URLSearchParams`安全传递非空日期，且不把其他凭证字段放入URL。
- 实施前Receipt preview不接收证据日期；现已在既有`REPEATABLE READ READ ONLY`事务中，以PostgreSQL `transaction_timestamp()`的Asia/Shanghai日期执行严格日历解析和未来日期门禁。
- 实施前`confirmationReady`只检查日期非空；现同时要求草稿日期等于服务端已验证日期且不晚于preview返回的`server_date_shanghai`，浏览器当前时间不参与权威判断。最终POST和0040继续独立拒绝未来日期。

## D-107实施合同

### 1. 服务端日期驱动的预检

- UI在打开权威GET预览时必须传递当前编辑行的`evidence_document_date`；浏览器`Date`、`Date.now()`、时区或HTML `max`不得成为权威判断。
- Receipt preview必须接受并规范化该字段，在服务端只读事务内以`transaction_timestamp() at time zone 'Asia/Shanghai'`取得当次业务日期并检查证据日期。
- 证据日期晚于该服务端业务日期时，预览返回HTTP 422、稳定代码`RECEIPT_EVIDENCE_FUTURE_DATE`、中文提示`送货凭证日期不能晚于服务端实际收货日期`和`request_id`；UI在编辑区展示代码、提示与请求编号，且不得打开可执行确认窗口。
- 今日及过去日期继续进入现有权威预览。最终Receipt POST必须在自己的写事务中重新计算Asia/Shanghai业务日期并独立复核；预览不能替代POST门禁。0040触发器继续作为独立数据库防线，不修改其语义。

### 2. 只投影当前实际检验模式

- 确认窗口的“本次过账后果”只展示当前Material权威inventory/inspection mode会真实产生的结果。
- `STOCKED/NORMAL`只展示普通Receipt、普通`RECEIPT` Ledger和按现有余额公式立即重算可用库存；不得描述RML、FROZEN、IQC队列或RELEASE→UNFREEZE。
- 实际`STOCKED/IQC`行才展示内部RML Lot、初始FROZEN、`IQC_RECEIPT` Ledger、可用量0以及quality RELEASE后追加UNFREEZE的责任边界。
- 不得在NORMAL订单上混入“如果是IQC”的假设结果。面向培训的模式对比若需要，必须另立任务并明确标记为非当前过账事实。

### 3. 返回修改与本地草稿

- 取消按钮、右上角关闭、ESC和背景点击统一表示“放弃本次最终确认，返回编辑”，全部保持业务POST 0；实施阶段把确认窗底部“取消”改名为“返回修改”。
- 关闭时必须清除确认modal、权威preview snapshot、preview loading、submitted、dialog error、同步提交锁及idempotency state，防止旧确认或旧提交状态复活。
- 编辑区尚未发送的数量、凭证、日期、Supplier批次、提前原因/确认、物理到货确认和说明必须保留，供用户继续修改；不得调用`form.reset()`。字段在modal关闭后仍存在是草稿保留，不是状态泄漏。
- modal、preview、提交锁或幂等状态未清除才属于状态泄漏缺陷。本任务不增加“清空本行”按钮；显式清空或成功提交后的自动清空策略延后单独决定。

## 源码实现结果

- 新增小型共享日期模块，使用纯日历规则拒绝非规范格式、空值、`0000`、不真实日期和时间戳；preview与最终POST复用稳定代码`RECEIPT_EVIDENCE_DATE_INVALID`及`RECEIPT_EVIDENCE_FUTURE_DATE`。
- warehouse UI预览GET现携带`evidence_document_date`；未来日期422在对应编辑卡片显示code/message/request_id，清除modal、preview、loading、submitted、dialog error、提交锁及幂等状态，最终按钮不可达。
- 确认窗底部已改为“返回修改”，按钮、右上角关闭、ESC和背景点击复用同一清理路径；未调用`form.reset()`，未增加“清空本行”，未提交表单DOM值保留供继续修改。
- NORMAL只投影普通Purchase Receipt/Receipt Line、普通`RECEIPT`和available立即重算；实际IQC模式继续投影RML/FROZEN、`IQC_RECEIPT`、quality责任队列及RELEASE后的`UNFREEZE`。
- 源码候选版本保持`0.1.0-alpha.42`，不提升alpha.43。收货预检功能提交为`401e16b04e3b8cb70ddfd3508661353ff758fdec`；后续运行时版本与health提交为`13f72b5f7aa51905af597733356420cc7b017b74`，Docker metadata提交为`61f0b56788ef68b9b7aa6d34583d2ddc3bde3f66`。源码阶段当时未重新构建；本镜像阶段已构建通过候选但未部署或发布，运行UAT仍为alpha.41。

## 运行时版本单一来源与health合同

- `chenyida_erp_site/package.json.version`是源码版本唯一权威。新增`app/lib/application-version.ts`从`process.cwd()/package.json`读取、解析并按当前SemVer格式严格校验version；成功值在进程内安全缓存一次，不读取OCI、Docker socket、tag、`npm_package_version`或未校验环境变量。
- package不可读、JSON损坏、version缺失/空/非字符串/格式非法时统一抛出不含文件路径或原始JSON的元数据错误；不回退为`unknown`、`latest`或`development`。
- `/api/health`保留`ok/database/storage/worker/time`及原数据库检查，只新增来自上述模块的`version`。成功响应继续`Cache-Control: no-store`和`X-Request-ID`；元数据或数据库失败返回现有通用非2xx错误结构，不返回`ok:true`、伪版本、堆栈、路径、环境值或原始异常。

## Dockerfile最小运行时metadata合同

- 既有builder stage以Node内联命令读取源码`package.json`，验证对象、name、SemVer version、`private=true`及`type=module/commonjs`，确定性生成只含`name/version/private/type`的`/tmp/chenyida-runtime-package.json`；缺失或非法version会使构建失败。
- Web final stage先复制既有standalone产物，再以`--chown=node:node`把生成文件覆盖到`/app/package.json`。未复制scripts、dependencies、devDependencies或其他构建信息，也未在Dockerfile硬编码alpha.42。
- 基础镜像、非root `node`用户、端口、`node server.js`、运行布局与Worker stage保持不变；没有自动Migration，也未修改Compose、Caddy或systemd。

## Standalone与Caddy安全头责任边界

- 本阶段新候选独立容器未经过Caddy；standalone烟测只验证应用负责的health、version、Cache-Control、匿名保护和无业务数据泄露，现已通过并清理容器。
- HSTS、X-Frame-Options、nosniff、Referrer-Policy和Permissions-Policy继续由Caddy边缘层负责，必须在后续Web-only部署后通过公开入口验证。
- 不为迁就隔离烟测而在Node重复新增上述边缘安全头。实际standalone响应中这些边缘头为空，按既定责任边界不判失败；必须等另获部署授权后再从公开Caddy入口验证。

## 明确排除与延期

- 不在NORMAL订单展示假设IQC结果，不新增教学比较面板。
- 不新增“清空本行”按钮，不决定显式清空或成功提交后的自动清空策略。
- 不改变Receipt POST事务结构、库存会计、IQC放行流程或0040 Migration/触发器。
- 不扩展采购会计、quality、finance、Python/SQLite或历史Sites/D1；不修改生产配置。
- 不执行真实UAT Receipt、UAT Receipt preview、UAT业务POST、UAT登录、UAT PostgreSQL写、UAT Migration、部署或服务重启。本镜像阶段只执行已授权的唯一build、隔离库Migration装载和临时候选容器烟测；这些临时资源已全部清理。

## D-107源码阶段历史验收结果

1. PASS：缺省日期兼容；D−1和D返回200；D+1与2099返回422；非规范格式和不真实日期返回稳定日期错误，响应code/message/request_id与`X-Request-ID`一致。
2. PASS：业务日期D来自隔离PostgreSQL的Asia/Shanghai事务时间；客户端业务代码不读取浏览器当前时间，`confirmationReady`只使用服务端已验证日期和服务端日期。
3. PASS：最终Receipt POST继续在独立写事务中重验未来日期；0040空库、0039升级、重复执行、约束和失败回滚3/3通过，preview成功不替代POST重验。
4. PASS：NORMAL当前结果不含RML/FROZEN/UNFREEZE/quality假设；实际IQC结果继续显示RML/FROZEN、`IQC_RECEIPT`、quality及UNFREEZE。
5. PASS：返回修改、关闭、ESC和背景点击均无业务POST，清除受保护确认状态且保留未提交表单值；无`form.reset()`或“清空本行”。
6. PASS：隔离preview失败前后Receipt、Evidence、Ledger、Lot、采购金额来源、AP及生产等全部保护计数和Plan/queue状态不变。
7. PASS：两个唯一测试数据库均明确不为`chenyida_erp`，脚本URL guard拒绝UAT/生产URL；测试后逐一强制删除，所有`cyd-fix38-*`临时容器自动删除，未创建网络或持久目录。
8. PASS：文档提交前以`REPEATABLE READ READ ONLY`事务再次复核UAT；40/head0040、PO/Line/Plan/queue为`1/4/4/4`、总已收0，warehouse账号active/version5/Session0，Receipt/Evidence/Lot/IQC/Ledger/AP/Payment/生产记录均为0，事务以ROLLBACK结束。

## 运行时版本合同源码阶段历史验证

- 现有`node:22-bookworm-slim`镜像、仓库既有依赖、源码只读挂载、单容器/单CPU、1,280 MiB内存与Swap硬上限、`NODE_OPTIONS=--max-old-space-size=1024`及串行执行贯穿全部Node测试；全部使用`network none`，未安装依赖、下载镜像或创建测试数据库。
- 最终串行结果：版本模块4/4、health合同3/3、Dockerfile合同4/4、FIX38 Unit组合17/17、UI contract 6/6、`typecheck:procurement-fulfillment`通过、`npm run lint` 0 error/0 warning、`npm test`3/3。
- Dockerfile合同测试首轮因测试内Worker历史快照与实际HEAD基线不一致而3/4；核对`780075e`中的完整Worker stage后只修正测试fixture，未改Worker，原精确断言重跑及最终串行均4/4。专项typecheck首次无诊断通过但清理门禁发现Node compile cache；精确删除该任务目录、禁用compile cache后原命令重跑通过且临时资源为0。
- 最终只读`REPEATABLE READ READ ONLY`事务并ROLLBACK确认40/head0040、warehouse active/version5/Session0、PO/Line/Plan/queue `1/4/4/4`、已收0，Receipt/Evidence/Lot/IQC/Ledger/Purchase Source/AP/Payment/Work Order和生产Issue/Return/Report/Completion全0。
- 起点/测试后available约2.2/2.2 GiB，Swap约300/311 MiB（1 GiB），根分区可用17 GiB，测试后Load `1.18/0.87/0.45`；四服务容器身份不变、restart0/OOM false、内核OOM 0。所有`cyd-fix38-*`临时容器、目录、网络、数据库和Volume增量均为0。
- 被拒镜像`sha256:81126136c63714be2a53812b3512549ed1fa4eb9deb7c8c6462b715eafe4278e`及唯一FIX38 tag原样保留为`REJECTED — DO NOT DEPLOY`；`latest`和运行Web仍指向alpha.41的`sha256:0cf98937f3ae28fe68e84436ab85c12ef5e8922f50a04973641cb79b8a0d5f19`。
- 上述源码阶段当时未运行`npm run build`、Docker build、候选容器、Migration、部署、服务重启、UAT登录、UAT Receipt preview、UAT业务POST、备份、恢复、push或PR。
- 上述源码阶段当时只允许`SELFHOST-UAT-FIX-38 VERSION CONTRACT SOURCE READY — REBUILD REQUIRED`；当前状态已由下方镜像阶段接续，已拒镜像仍不能复用。

## alpha.42版本化镜像重建与隔离烟测

### 唯一构建与镜像证据

- 构建只执行一次，输入严格为Git tree `HEAD:chenyida_erp_site`（tree `19384bbc10f15f382d6ac70040827125e839653f`）；Dockerfile SHA-256 `3131dd62ded36d1ac058f7a0e3f8869a401c878851ae895bfa8f595b7ef40e49`，`.dockerignore` SHA-256 `53fce31d86668faca3449ca8e9c0c14b58c89276399e7e4708eedcad6f529a69`，package和lock根版本均为`0.1.0-alpha.42`。903个跟踪文件、49,341,766 bytes的context路径未命中环境文件、数据库、备份、日志、上传、附件、缓存或凭据；没有传递数据库、Session、Token或业务环境变量。
- 精确候选tag为`chenyida-erp-parallel-web:0.1.0-alpha.42-fix38-569aa95`，完整Image ID为`sha256:e7761e2c61bfe77c6aab526fb0b6cbd840ad1bf6300381f4319f6e279af94964`，本地内容digest为`chenyida-erp-parallel-web@sha256:e7761e2c61bfe77c6aab526fb0b6cbd840ad1bf6300381f4319f6e279af94964`，未push且没有远端registry digest。创建时间`2026-08-09T21:11:11.69732358+08:00`，`linux/amd64`，88,679,975 bytes；比alpha.41增加1,136 bytes（0.001281%），比已拒候选增加966 bytes（0.001089%），远低于20%停止阈值。
- OCI labels精确为version `0.1.0-alpha.42`、revision `569aa954d764309e239d1f6c174e582596d33a24`、task `SELFHOST-UAT-FIX-38`；9个rootfs layer，`User=node`、`Workdir=/app`、Entrypoint `docker-entrypoint.sh`、Cmd `node server.js`、暴露`3000/tcp`、镜像内无Healthcheck且不自动运行Migration。Worker运行镜像与源码target均未改变。
- `network none`、只读、自动删除的版本门禁容器确认`/app/package.json`为合法JSON且恰好只有`name/version/private/type`，值为`chenyida-erp-selfhosted / 0.1.0-alpha.42 / true / module`；无scripts、devDependencies、registry、Token或数据库URL。2,298个文件中版本命中1处，`RECEIPT_EVIDENCE_FUTURE_DATE`、`evidence_document_date`和`返回修改`全部命中；Docker history敏感内容和敏感ARG/ENV均为0。

### 隔离数据库与standalone smoke

- 唯一测试库和角色最终名均为`fix38_image_smoke_569aa95_test351669cd`，密码与setup token只在root-only mode600任务文件保存且未打印。角色为LOGIN但非superuser/createdb/createrole/inherit/replication/bypassrls，connection limit 4，只拥有一个目标库、无成员关系、无UAT表读写或数据库CREATE权限；目标库撤销PUBLIC CONNECT，运行URL精确为`postgres:5432`及该库/角色，不存在UAT fallback。
- 运行Worker镜像历史上只含0001—0034，首个初始化容器如实把新空库装载到34/head0034后删除；一次root-only工作树bind尝试在任何SQL前以EACCES失败并自动删除。随后从当前Git tree归档40个migration到任务临时目录，逐文件SHA与HEAD一致、0040 SHA仍为`b6781c94…a5a93`，由同一既有runner非root只读挂载补齐0035—0040。最终目标库为40/head0040、227张public表，Session、Receipt及全部下游为0；所有初始化容器先删除，才启动Web。
- 唯一候选Web容器使用restart=no、0.75 CPU、512 MiB memory、768 MiB memory+swap、128 PID、只读rootfs、内部临时网络及三个任务临时bind目录；未挂UAT uploads/attachments/backup-status或任何受保护Volume，未接Caddy、未启动Worker、未建账号、未登录或公开暴露。Docker的`127.0.0.1::3000`随机映射没有产生HostPort，因此烟测改用容器内localhost及同一内部网络的等价非公开连接，没有扩大暴露面。启动后restart0/OOM false，约52.87 MiB；日志只有一条Vinext启动信息，密码/URL/Token、SQL堆栈和自动Migration命中均为0，最后migration时间早于Web启动。
- health返回HTTP200、`ok=true`、`database=postgresql`、`storage=local`、`worker=postgresql-jobs`、`version=0.1.0-alpha.42`及合法time；`Cache-Control: no-store`与指定`X-Request-ID`一致，正文不含路径、环境、数据库URL或镜像ID。根页HTTP200且`private, no-store, max-age=0, must-revalidate`；匿名Session为false/null。`/warehouse/receiving`响应及初始DOM不含`PO-00000001`、`SUP-000001`、Material 533—536、四个Material code或创建审计凭证；仅调用health、根页、warehouse页和anonymous Session，Receipt preview与业务POST均为0。
- Standalone没有HSTS、X-Frame-Options、nosniff、Referrer-Policy或Permissions-Policy，这是Caddy边缘责任且不构成失败。隔离库最终User/Session/Receipt/Evidence/Lot/IQC/Ledger/Purchase Source/AP/Payment/Work Order/生产全部为0。

### 清理、UAT不变与部署门禁

- 严格按候选容器→测试数据库→测试角色→临时网络→任务目录顺序清理；临时容器、数据库、角色、网络和目录最终均为0，随机秘密删除前覆盖。候选镜像、已拒镜像、alpha.41、build cache及四个受保护Volume全部保留，未prune。
- UAT migration指纹`822e0e5bf92d4c267aa316668936a196ea23ec6c49a83ac82c777ce2c7fa2b19`与业务指纹`89915aaecad46c5a754ba3239c8bc9d8d4e4039dfad24827267614d32b06dd3b`在初始化前、初始化后和清理后逐字节一致：40/head0040、warehouse Session0、PO/Line/Plan/queue `1/4/4/4`、已收0，Receipt/Evidence/Lot/IQC/Ledger/AP/Payment/Work Order/生产全0。
- UAT Web/Worker/PostgreSQL/Caddy完整容器ID分别保持`1e5394349c49895ca14aba09cd8f765cd88a7fff94b593ff675e165481b8865f`、`fb68d9a81b87fc625f5a78407b9e1020c7c65daa6b39079f6564ac860a57f6e0`、`f3a2f3cb32f4f76cf8a31a4db9b1276adb36484c912925889e909114a332ead3`、`c209765be0b4abb867870949f9e9d1a37eef44aa0f97862af742f87f7cc518df`；四服务restart0/OOM false，本地和公开health仍是运行alpha.41的原合同响应，当前Web及`latest`仍为`sha256:0cf98937…d5f19`。
- 已拒镜像`sha256:81126136c63714be2a53812b3512549ed1fa4eb9deb7c8c6462b715eafe4278e`及唯一tag `0.1.0-alpha.42-fix38-780075e`继续`REJECTED — DO NOT DEPLOY`，无latest或容器。新通过候选只保留本机；下一阶段只有另获授权后才能把Compose Web精确目标设为`sha256:e7761e2c61bfe77c6aab526fb0b6cbd840ad1bf6300381f4319f6e279af94964`，只替换Web、不运行Migration、不重建PostgreSQL/Worker/Caddy。失败时只把Web回滚到`sha256:0cf98937f3ae28fe68e84436ab85c12ef5e8922f50a04973641cb79b8a0d5f19`并复核health、Caddy安全头、匿名保护、Restart/OOM、业务指纹、Session及未来日期422/零业务POST。
- 最新正式备份仍为`/var/backups/chenyida-erp/warehouse-receipt-readiness-fix37-predeploy-20260808T120636Z.dump`，2026-08-08 20:07:23 +0800、2,298,941 bytes、SHA-256 `28e07b9dc04e686d5077fe9f68968ffb1a4253979d64b80317307f8543bc0868`。异机复制仍未完成；远端`origin/main`为`39946f6b854a985b5c19106eaa6c938bddaf9c7c`，本阶段提交前behind0/ahead184、文档提交后预期ahead185；源码增量和新候选镜像都只在本机，仍有单机恢复风险，不能称生产就绪。
- 资源起点为available约2.2 GiB、Swap311 MiB/1 GiB、根盘17 GiB、Load `0.23/0.29/0.27`；收口为available约1.9 GiB、Swap313 MiB/1 GiB、根盘17 GiB、Load `0.52/0.31/0.28`，最终60秒Swap增量0，Kernel OOM0，四服务restart0/OOM false。Docker images 57→58、build cache 97→105；未清理缓存或Volume。
- 本阶段允许结论仅为`FIX38 ALPHA.42 VERSIONED IMAGE CANDIDATE READY — NOT DEPLOYED`。FIX38保持`DOING / IMAGE_READY / DEPLOYMENT_NOT_AUTHORIZED`；没有完成报告，没有把RELEASES标记为alpha.42已发布。
