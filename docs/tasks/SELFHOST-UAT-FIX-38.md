# SELFHOST-UAT-FIX-38 — 收货预检与Web运行时版本合同修复

## 状态、阶段与授权边界

- 任务状态：`DOING`。
- 当前阶段：`VERSION_CONTRACT_SOURCE_READY / REBUILD_REQUIRED`；允许结论仅为`SELFHOST-UAT-FIX-38 VERSION CONTRACT SOURCE READY — REBUILD REQUIRED`。
- 决策状态：`DECISION_RECORDED`；收货预检与运行时版本合同源码状态：`IMPLEMENTED_AND_ISOLATED_TESTED`；本阶段构建状态：`NOT BUILT`；部署状态：`NOT DEPLOYED`。
- 日期：2026-08-09（Asia/Shanghai）。
- 本阶段授权仅限运行时版本读取、health版本投影、Dockerfile最小运行时package metadata、无数据库专项测试和状态文档。未修改Schema、Migration、依赖、Compose、Caddy、systemd、Worker或业务逻辑；未build、Docker build、启动候选容器、部署、重启、登录UAT、调用UAT Receipt preview或发送UAT业务POST。
- 本任务不授权真实收货、IQC决定、Ledger、AP、Payment、Work Order或生产操作；`PO-00000001`继续受D-105保护。

## 严格起点与受保护事实

- 运行时版本合同补救阶段从唯一worktree、clean `main@780075e0940a124410a72f9e39eac76cc5d9224e`、Parent `401e16b04e3b8cb70ddfd3508661353ff758fdec`、`origin/main...HEAD = behind 0 / ahead 181`起步；没有嵌套仓库、submodule或gitlink。
- 源码候选现为`0.1.0-alpha.42`；运行中的并行非生产UAT仍为`0.1.0-alpha.41`。PostgreSQL仍为40/head `0040_warehouse_receipt_readiness.sql`，0040 SHA-256仍为`b6781c94da3f52a8f719ce57cdf13acbb4e3fe1c66f2a0480bdb6a9ff10a5a93`；当前UAT Web镜像仍为`sha256:0cf98937f3ae28fe68e84436ab85c12ef5e8922f50a04973641cb79b8a0d5f19`。
- 上一次构建产生的候选镜像`sha256:81126136c63714be2a53812b3512549ed1fa4eb9deb7c8c6462b715eafe4278e`（tag `chenyida-erp-parallel-web:0.1.0-alpha.42-fix38-780075e`）仍完整保留并固定为`REJECTED — DO NOT DEPLOY`：其`/app/package.json`缺少version且当时health没有version。它没有`latest`标签、没有关联容器，也不得作为新源码合同的通过证据。
- Web、PostgreSQL、Worker、Caddy均为RestartCount 0、OOM false；Web/PostgreSQL healthy，Worker/Caddy running。warehouse账号`uat_20260729_warehouse`为active、`must_change_password=false`，有效Session为0。
- 只读事务确认PO为`1/v1/OPEN`，PO Line/Delivery Plan/queue为`4/4/4`且已收数量0；Receipt/Receipt Line/Evidence/Lot/IQC/Ledger/Purchase Financial Source/AP/Payment/Work Order及生产Issue/Return/Report/Completion均为0。
- 本阶段起点资源：available memory约2.2 GiB，Swap已用约300 MiB/1 GiB，根分区可用17 GiB，Load约`0.54/0.24/0.14`；内核OOM计数0。测试前无任务临时容器、数据库、文件或网络。

## 运行时版本合同补救背景

- 上一次候选构建门禁在任何候选容器或烟测启动前失败：standalone产物用仅含`private/type`的package JSON覆盖了源码metadata，最终镜像文件系统没有`0.1.0-alpha.42`，OCI version label不能替代应用运行时证据。
- 同一候选的`/api/health`只有既有`ok/database/storage/worker/time`字段，无法证明正在运行的应用版本；因此该镜像拒绝部署，运行UAT继续使用alpha.41。
- 本阶段只修复源码和构建合同。成功仍必须等待新的、基于当前源码重新构建的候选镜像；不得重新解释或重新标记已拒绝镜像。

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
- 源码候选版本保持`0.1.0-alpha.42`，不提升alpha.43。收货预检功能提交为`401e16b04e3b8cb70ddfd3508661353ff758fdec`；后续运行时版本与health提交为`13f72b5f7aa51905af597733356420cc7b017b74`，Docker metadata提交为`61f0b56788ef68b9b7aa6d34583d2ddc3bde3f66`。本阶段未重新构建、部署或发布，运行UAT仍为alpha.41。

## 运行时版本单一来源与health合同

- `chenyida_erp_site/package.json.version`是源码版本唯一权威。新增`app/lib/application-version.ts`从`process.cwd()/package.json`读取、解析并按当前SemVer格式严格校验version；成功值在进程内安全缓存一次，不读取OCI、Docker socket、tag、`npm_package_version`或未校验环境变量。
- package不可读、JSON损坏、version缺失/空/非字符串/格式非法时统一抛出不含文件路径或原始JSON的元数据错误；不回退为`unknown`、`latest`或`development`。
- `/api/health`保留`ok/database/storage/worker/time`及原数据库检查，只新增来自上述模块的`version`。成功响应继续`Cache-Control: no-store`和`X-Request-ID`；元数据或数据库失败返回现有通用非2xx错误结构，不返回`ok:true`、伪版本、堆栈、路径、环境值或原始异常。

## Dockerfile最小运行时metadata合同

- 既有builder stage以Node内联命令读取源码`package.json`，验证对象、name、SemVer version、`private=true`及`type=module/commonjs`，确定性生成只含`name/version/private/type`的`/tmp/chenyida-runtime-package.json`；缺失或非法version会使构建失败。
- Web final stage先复制既有standalone产物，再以`--chown=node:node`把生成文件覆盖到`/app/package.json`。未复制scripts、dependencies、devDependencies或其他构建信息，也未在Dockerfile硬编码alpha.42。
- 基础镜像、非root `node`用户、端口、`node server.js`、运行布局与Worker stage保持不变；没有自动Migration，也未修改Compose、Caddy或systemd。

## Standalone与Caddy安全头责任边界

- 后续获授权的新候选独立容器不经过Caddy；其standalone烟测只验证应用负责的health、version、Cache-Control、匿名保护和无业务数据泄露。
- HSTS、X-Frame-Options、nosniff、Referrer-Policy和Permissions-Policy继续由Caddy边缘层负责，必须在后续Web-only部署后通过公开入口验证。
- 不为迁就隔离烟测而在Node重复新增上述边缘安全头。本阶段没有候选容器，因此没有把Caddy头缺失误记为standalone失败或通过。

## 明确排除与延期

- 不在NORMAL订单展示假设IQC结果，不新增教学比较面板。
- 不新增“清空本行”按钮，不决定显式清空或成功提交后的自动清空策略。
- 不改变Receipt POST事务结构、库存会计、IQC放行流程或0040 Migration/触发器。
- 不扩展采购会计、quality、finance、Python/SQLite或历史Sites/D1；不修改生产配置。
- 不执行真实UAT Receipt、UAT Receipt preview、UAT业务POST、UAT登录、UAT PostgreSQL写、任何Migration、build、Docker build、候选容器、部署或服务重启；本运行时版本合同阶段也不创建隔离测试数据库。

## D-107源码阶段历史验收结果

1. PASS：缺省日期兼容；D−1和D返回200；D+1与2099返回422；非规范格式和不真实日期返回稳定日期错误，响应code/message/request_id与`X-Request-ID`一致。
2. PASS：业务日期D来自隔离PostgreSQL的Asia/Shanghai事务时间；客户端业务代码不读取浏览器当前时间，`confirmationReady`只使用服务端已验证日期和服务端日期。
3. PASS：最终Receipt POST继续在独立写事务中重验未来日期；0040空库、0039升级、重复执行、约束和失败回滚3/3通过，preview成功不替代POST重验。
4. PASS：NORMAL当前结果不含RML/FROZEN/UNFREEZE/quality假设；实际IQC结果继续显示RML/FROZEN、`IQC_RECEIPT`、quality及UNFREEZE。
5. PASS：返回修改、关闭、ESC和背景点击均无业务POST，清除受保护确认状态且保留未提交表单值；无`form.reset()`或“清空本行”。
6. PASS：隔离preview失败前后Receipt、Evidence、Ledger、Lot、采购金额来源、AP及生产等全部保护计数和Plan/queue状态不变。
7. PASS：两个唯一测试数据库均明确不为`chenyida_erp`，脚本URL guard拒绝UAT/生产URL；测试后逐一强制删除，所有`cyd-fix38-*`临时容器自动删除，未创建网络或持久目录。
8. PASS：文档提交前以`REPEATABLE READ READ ONLY`事务再次复核UAT；40/head0040、PO/Line/Plan/queue为`1/4/4/4`、总已收0，warehouse账号active/version5/Session0，Receipt/Evidence/Lot/IQC/Ledger/AP/Payment/生产记录均为0，事务以ROLLBACK结束。

## 运行时版本合同阶段验证与允许结论

- 现有`node:22-bookworm-slim`镜像、仓库既有依赖、源码只读挂载、单容器/单CPU、1,280 MiB内存与Swap硬上限、`NODE_OPTIONS=--max-old-space-size=1024`及串行执行贯穿全部Node测试；全部使用`network none`，未安装依赖、下载镜像或创建测试数据库。
- 最终串行结果：版本模块4/4、health合同3/3、Dockerfile合同4/4、FIX38 Unit组合17/17、UI contract 6/6、`typecheck:procurement-fulfillment`通过、`npm run lint` 0 error/0 warning、`npm test`3/3。
- Dockerfile合同测试首轮因测试内Worker历史快照与实际HEAD基线不一致而3/4；核对`780075e`中的完整Worker stage后只修正测试fixture，未改Worker，原精确断言重跑及最终串行均4/4。专项typecheck首次无诊断通过但清理门禁发现Node compile cache；精确删除该任务目录、禁用compile cache后原命令重跑通过且临时资源为0。
- 最终只读`REPEATABLE READ READ ONLY`事务并ROLLBACK确认40/head0040、warehouse active/version5/Session0、PO/Line/Plan/queue `1/4/4/4`、已收0，Receipt/Evidence/Lot/IQC/Ledger/Purchase Source/AP/Payment/Work Order和生产Issue/Return/Report/Completion全0。
- 起点/测试后available约2.2/2.2 GiB，Swap约300/311 MiB（1 GiB），根分区可用17 GiB，测试后Load `1.18/0.87/0.45`；四服务容器身份不变、restart0/OOM false、内核OOM 0。所有`cyd-fix38-*`临时容器、目录、网络、数据库和Volume增量均为0。
- 被拒镜像`sha256:81126136c63714be2a53812b3512549ed1fa4eb9deb7c8c6462b715eafe4278e`及唯一FIX38 tag原样保留为`REJECTED — DO NOT DEPLOY`；`latest`和运行Web仍指向alpha.41的`sha256:0cf98937f3ae28fe68e84436ab85c12ef5e8922f50a04973641cb79b8a0d5f19`。
- 未运行`npm run build`、Docker build、候选容器、Migration、部署、服务重启、UAT登录、UAT Receipt preview、UAT业务POST、备份、恢复、push或PR。
- 本阶段允许的成功结论仅为：`SELFHOST-UAT-FIX-38 VERSION CONTRACT SOURCE READY — REBUILD REQUIRED`。FIX38保持`DOING`；后续必须另获授权并从当前源码重新构建新候选，不能部署或复用已拒镜像。
