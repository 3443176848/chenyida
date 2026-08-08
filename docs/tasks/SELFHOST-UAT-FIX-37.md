# SELFHOST-UAT-FIX-37 — Warehouse Receipt Readiness and Date Safeguards

## 状态、授权与严格起点

- 状态：`DOING`。
- 日期：2026-08-08（Asia/Shanghai）。
- 授权：修复仓库收货页的最小权限只读谱系、证据字段、提前到货门禁、两阶段确认、IQC职责边界；完成隔离测试、正式备份恢复、受控部署和warehouse-only主UAT只读/预览取消验收。
- 主UAT硬边界：只允许账号`uat_20260729_warehouse`只读打开`PO-00000001`并在桌面与390×844打开权威确认预览后取消；不得填写虚假凭证、批次、日期或到货说明；`business POST = 0`；最终有效warehouse Session必须为0。
- 禁止：不执行实际到货、收货、IQC、入库、Inventory Ledger、AP、付款、Work Order或生产操作；不修改、取消、删除、重建或再次转换受控PO；不轮换warehouse凭据；不push、不创建PR、不改写历史。
- 严格起点已只读核验通过：唯一clean worktree `main@a40660cc3ba8e74495c919ba0f2602485597fc38`，Parent `bdb4fd07e76e405f418833aeaf5b0c9c4b5e5ae7`，behind0/ahead175；`0.1.0-alpha.40`；Migration 0001—0039且0039 SHA-256为`3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`；Web为`sha256:664e0ac6bd289251f289a8785ac05d955470064a3f921c3ae834f79665a4ec89`；四服务restart0/OOM false。
- 起点业务保护已由既有只读保护器重新核验：PO/Line/Plan/queue `1/4/4/4`，PO `ID 1 / PO-00000001 / v1 / OPEN`，Supplier `ID 1 / SUP-000001`，四行各10 PCS且已收0，金额480.00 CNY，Plan 1—4均`PENDING/v1/2026-10-20`，queue 1—4均`OPEN_PENDING/v1`，Receipt/Warehouse Receipt/IQC/Ledger/Lot/AP/Payment/Work Order/生产记录全0；状态与历史指纹分别为`721f25f8…0594`和`d11b46bc…ae7`。
- warehouse身份只读核验为active warehouse、`must_change_password=false`、version5、有效Session0；本任务不得再次改密。

## D-105与受控PO保护

- D-105只提供前向授权，不构成原始PO写入的追溯性授权；产品代码和页面不得硬编码`PO-00000001`或D-105，也不得声称原始写入已获授权。
- 现有PO、四条PO Line、四条Delivery Plan、四条queue及Event/Audit/Idempotency证据必须原样保留；不得删除、修改、取消、重建或重试Award→PO转换。
- 如需页面治理标记，必须先建立通用关系化模型并单独记录决定；本任务不以硬编码特殊PO方式实现。

## 实现范围与验收合同

### 1. warehouse专用最小权限读模型

- warehouse只读DTO展示PO稳定ID/编号/Version/状态、Project、Supplier、币种、税价/运费/金额/付款条件、PO创建actor/上海时间/request_id/operation/Action/SUCCESS。
- 展示四条PO Line的稳定ID、Award Line、Material ID/编码、订购/已收/未收，四条Delivery Plan ID/Version/状态/计划日期及四条queue ID/Version/状态。
- 展示目标PO关联Receipt、Warehouse Receipt、IQC、Inventory Ledger、Lot、AP、Payment、Work Order及生产记录当前计数；明确OPEN、PENDING和OPEN_PENDING均不代表已到货、已收货或库存增加。
- 不授予warehouse `system.audit.read`，不返回请求/响应正文、Cookie、Session或敏感Header；跨数据域对象必须403。

### 2. 两阶段收货

- 当前直接POST入口改为“核对收货”→权威GET重读→确认窗口→仅“确认过账收货”可POST。
- 数量和说明不得默认预填为可直接提交值；默认焦点为取消；取消、关闭、ESC和背景关闭均为零业务POST；最终按钮点击后同步禁用、不自动重试。
- POST事务内重新锁定并验证PO、Line、Plan、queue、剩余数量、CAS、权限、CSRF、Origin及幂等；任一失败不得留下部分Receipt、Lot、IQC、Ledger或状态推进。

### 3. 日期与关系化证据门禁

- 先核验现有Schema；结构化证据不得塞入自由备注。
- 确认窗口至少展示服务端当前时间、承诺/计划日期、权威收货时间生成规则、提前到货判断、送货单/等价来源凭证、Supplier批次适用性、目标仓库/库位、本次数量/剩余量、经办账号及收货说明。
- 实际过账时间只能由服务端生成；禁止未来日期和以计划日期伪装实际到货日期。
- 提前到货不是永久禁止，但必须有可审计送货凭证、提前到货原因和显式确认；缺失时服务端以稳定错误码和中文提示拒绝。
- 页面明确当前流程是实际物理收货，不是供应商通知或在途登记；没有通知模型时不得临时伪造。
- 若现有模型不能关系化保存必需证据，新增且仅新增`0040`，版本升至`0.1.0-alpha.41`，不得修改0039或更早Migration，并覆盖空库、0039升级、约束、回滚、重复执行及恢复测试；如模型完整支持，则保持alpha.40/0039并在完成报告列出字段来源。

### 4. IQC与库存职责边界

- 页面必须按实际服务端模型说明Receipt/RML Lot、冻结/隔离、可用库存、Ledger生成时点、IQC责任队列以及不合格/退货/让步接收的独立操作边界。
- 收货不得自动创建AP、付款、Work Order或生产记录；不得为了文案预期改变既有库存会计语义。
- warehouse对IQC写接口必须403，quality保留既有授权；warehouse首页不得把“供应商来料IQC”标记为其获准业务。
- 若既有权威决定明确允许warehouse执行IQC，立即停止并请求业务决定；本任务只治理warehouse相关导航，不扩大到其他角色的全局导航债务。

## 测试、部署与主UAT

- 至少覆盖：最小权限DTO/跨域403、确认窗所有取消路径零POST、数量空/0/负数/超量、未来日期、提前到货缺证据/完整证据隔离成功、PO/Line/Plan/queue CAS、幂等重放/异正文冲突/并发单胜、CSRF/Origin/权限/限流、中途故障零半记录、IQC隔离、Receipt/Lot/冻结库存/Ledger真实事务语义、桌面/390×844无页面级横向溢出、退出历史与Session失效，以及PO/Award/RFQ/Quote/Comparison/Mapping回归。
- PostgreSQL与Chromium写路径只在隔离数据库运行；主UAT路由层阻断全部业务POST并核对前后业务指纹。
- 重任务按低资源门禁串行；部署前生成root:root/0600正式custom dump，执行`pg_restore --list`并恢复到第二新数据库；如有0040，再验证0039→0040升级。
- 只替换实际需要的服务；不得prune、不得重建无关服务或四个受保护Volume。
- 功能代码/测试与部署/验收记录使用独立提交；完成时更新MASTER、TASKS、PROJECT_CONTEXT、STATUS、CHANGELOG及本完成报告，只有出现新业务/架构决定时才更新DECISIONS。

## 允许的最终结论

- 成功：`WAREHOUSE RECEIPT READINESS FIXED — UAT RECEIPT NOT POSTED`
- 阻断：`WAREHOUSE RECEIPT READINESS BLOCKED — NO UAT RECEIPT`
