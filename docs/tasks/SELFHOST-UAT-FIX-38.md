# SELFHOST-UAT-FIX-38 — 服务端日期驱动的收货预检门禁

## 状态、阶段与授权边界

- 任务状态：`DOING`。
- 当前阶段：`REQUIREMENT DECIDED — IMPLEMENTATION NOT STARTED`。
- 决策状态：`DECISION_RECORDED`；实现状态：`IMPLEMENTATION_NOT_STARTED`；构建状态：`NOT BUILT`；部署状态：`NOT DEPLOYED`。
- 日期：2026-08-09（Asia/Shanghai）。
- 本阶段授权仅限需求审计、D-107和FIX38文档基线、只读事实核验及不连接UAT/生产数据库的轻量静态验证。不得修改源码、测试、Schema、Migration、依赖或部署配置；不得构建、部署、重启、登录UAT、调用Receipt预览或发送任何业务POST。
- 本任务不授权真实收货、IQC决定、Ledger、AP、Payment、Work Order或生产操作；`PO-00000001`继续受D-105保护。

## 严格起点与受保护事实

- 唯一worktree为`/opt/erp`；根仓库为clean `main@7d8f3cf6aa58808698ae6100424bc0e5df248b3d`，Parent `20a9123741862d81ac18af9e6bdee896674fe95c`，`origin/main...HEAD = behind 0 / ahead 178`；没有嵌套仓库、submodule或gitlink。
- 源码与并行非生产UAT保持`0.1.0-alpha.41`；PostgreSQL Migration共40个，head为`0040_warehouse_receipt_readiness.sql`。当前UAT Web镜像保持`sha256:0cf98937f3ae28fe68e84436ab85c12ef5e8922f50a04973641cb79b8a0d5f19`。
- Web、PostgreSQL、Worker、Caddy均为RestartCount 0、OOM false；Web/PostgreSQL healthy，Worker/Caddy running。warehouse账号`uat_20260729_warehouse`为active、`must_change_password=false`，有效Session为0。
- 只读事务确认PO为`1/v1/OPEN`，PO Line/Delivery Plan/queue为`4/4/4`且已收数量0；Receipt/Receipt Line/Evidence/Lot/IQC/Ledger/Purchase Financial Source/AP/Payment/Work Order及生产Issue/Return/Report/Completion均为0。
- 起点资源：available memory约2.1 GiB，Swap已用282 MiB/1 GiB，根分区可用17 GiB，Load `0.21/0.37/0.26`；内核OOM计数0。未创建任务临时容器、数据库、文件或网络。

## 背景与需求审计

- FIX37后续黑盒补充发现：用户在Receipt编辑区填写晚于服务端Asia/Shanghai业务日期的送货凭证日期后，仍可进入可执行的最终确认窗口。最终Receipt POST已有服务端事务日期复核，0040触发器也有独立约束，因此该现象没有形成主UAT写入或数据损坏，但预检门禁没有失败关闭。
- 同一黑盒补充还把“当前NORMAL订单没有展示假设IQC结果”和“关闭确认窗后编辑区仍保留未提交字段”列为FAIL。需求复核确认，这两项不是直接缺陷：本次过账后果必须只描述当前Material的实际inspection mode；关闭确认窗返回编辑时保留尚未发送的草稿正是所需语义。
- FIX38只修复并验证已确认的预检缺口，同时把实际模式投影和返回修改语义固化为回归合同；不借本任务扩展教学比较或草稿清空功能。

## 唯一已确认缺陷

- `openPreview`当前只把`quantity`加入`GET /api/procurement/delivery-plans/:id/receipt-preview`查询，没有传递`evidence_document_date`。
- 现有Receipt preview服务端合同不接收证据日期，也不在只读事务中用Asia/Shanghai服务端业务日期检查未来日期。
- `confirmationReady`只检查`draft.evidence_document_date`非空，不证明该值已通过服务端日期门禁。因此未来日期可以打开带最终过账按钮的确认窗口；最终POST和0040仍会独立拒绝，不构成已过账事实。

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

## 后续实现范围

- 修改warehouse Receipt UI，使预览GET带`evidence_document_date`，并以现有安全错误合同显示HTTP 422的code/message/request_id且保持modal不可达。
- 扩展Receipt preview Handler/Service合同，在服务端只读事务内执行Asia/Shanghai日期复核；最终POST继续独立复核，0040保持不变。
- 将确认窗底部按钮改为“返回修改”，统一四种关闭路径的modal/preview/loading/submitted/error/idempotency清理，同时保留编辑区未提交草稿且不使用`form.reset()`。
- 固化NORMAL/IQC实际模式投影，不在NORMAL样本中加入假设IQC说明。
- 增加对应Unit、UI contract和隔离PostgreSQL测试；计划源码候选版本为`0.1.0-alpha.42`。alpha.42目前未实现、未构建、未部署或发布。

## 明确排除与延期

- 不在NORMAL订单展示假设IQC结果，不新增教学比较面板。
- 不新增“清空本行”按钮，不决定显式清空或成功提交后的自动清空策略。
- 不改变Receipt POST事务结构、库存会计、IQC放行流程或0040 Migration/触发器。
- 不扩展采购会计、quality、finance、Python/SQLite或历史Sites/D1；不修改生产配置。
- 不执行真实UAT Receipt、Receipt preview、业务POST、登录、PostgreSQL写、Migration、build、Docker build、部署或服务重启。

## 后续实现验收标准

1. 未来证据日期的preview稳定返回HTTP 422、`RECEIPT_EVIDENCE_FUTURE_DATE`、指定中文提示和request_id；确认modal及最终按钮不可达。
2. 服务端当日和过去日期仍可完成只读预览；浏览器时钟、时区、`Date`、`Date.now()`及仅HTML `max`均不能决定结果。
3. 最终Receipt POST继续在独立事务中重验未来日期，0040数据库防线继续有效；preview成功不是POST授权或替代门禁。
4. “本次过账后果”严格随实际Material mode变化：NORMAL无RML/FROZEN/UNFREEZE，实际IQC行完整显示RML/FROZEN及quality RELEASE→UNFREEZE。
5. 取消、关闭、ESC和背景点击均业务POST 0并返回编辑；保留未提交表单值，同时清除modal/preview/loading/submitted/error/idempotency及提交锁状态。
6. 不出现“清空本行”，不使用`form.reset()`，不把草稿保留误报为状态泄漏。
7. Unit/UI contract/隔离PostgreSQL写测试只连接隔离数据库；任何失败零半记录、零UAT写。
8. 主UAT PO/Line/Plan/queue保持`1/4/4/4`，warehouse Session、Receipt/Evidence/Lot/IQC/Ledger/AP/Payment/生产记录保持0。

## 本阶段验证与允许结论

- 本阶段仅运行`git diff --check`、文档一致性/范围扫描、`npm run lint`和`node --test tests/selfhost-procurement-fulfillment-ui-contract.test.mjs`；测试脚本必须先经人工源码检查，确认不解析数据库URL、不访问网络、不写UAT/生产数据库。
- 测试脚本51行已完整检查，只用Node内置`test`、`assert`和本地`readFile`读取源码，不导入数据库驱动、不读取数据库URL、不调用`fetch`或其他网络接口。宿主机没有Node/npm，直接lint命令在测试启动前以127退出；随后复用本机已有`node:22-bookworm-slim`与仓库现有依赖，在断网、源码只读、1 CPU、1,280 MiB内存上限、自动删除的唯一临时容器中执行相同命令。`npm run lint`通过（0 error、11条既有warning），专项UI contract为5/5通过；没有安装或修改依赖。
- 不运行全量`npm test`、PostgreSQL写测试、Migration测试、build或Docker build。资源门禁检查必须串行且前后记录。
- 文档差异、编号标题唯一性、MASTER/TASKS/STATUS状态、alpha.42未部署措辞、FIX38非DONE和六文件范围检查均通过。收口资源为available memory约2.2 GiB、Swap已用290 MiB/1 GiB、根分区可用17 GiB、Load `0.43/0.43/0.32`；四服务restart0/OOM false、内核OOM 0，临时测试容器已自动删除，没有临时数据库、依赖、Profile或文件。
- 本阶段允许的成功结论仅为：`SELFHOST-UAT-FIX-38 DECISION RECORDED — IMPLEMENTATION NOT STARTED`。
- 后续源码实现、隔离写测试、候选构建、部署和任何UAT验收均须进入后续阶段并重新核验当时基线；本任务不自动放行。
