# SELFHOST-UAT-FIX-28 — RFQ Comparison聚合读模型与摘要修复

## 状态与唯一范围

- 状态：`DONE`
- 开始：2026-08-06（Asia/Shanghai）
- 负责人：Codex（严格门禁、主UAT只读核验、服务端聚合读模型、移动端展示、隔离测试、备份恢复、Web-only部署和purchase-only只读验收）；项目负责人（固定Comparison保护边界及实现、部署、只读验收授权）
- 依赖：`SELFHOST-PHASE4-TASK04`、`SELFHOST-UAT-FIX-27`、D-061、D-062、D-090、D-095—D-099
- 唯一范围：复用既有逐RFQ Line Comparison关系模型，补齐Comparison Version复合身份、状态投影、固定Quote输入、输入/输出摘要、Supplier金额与交期汇总、Event操作分组和桌面/390px展示。保留主UAT现有Comparison，不创建Award或PO。

## 严格起点

- `main@0d4e28842130a3289bea24c4eb9762c250de9809`，Parent `943c7fa5da44182617fa8a4f1d75b49b6d6c3795`，`origin/main...HEAD` behind 0 / ahead 159，工作区clean且仅一个worktree。
- 源码/运行Web版本`0.1.0-alpha.40`；Migration `0001—0039`，head `0039_rfq_traceability.sql`，不得修改0039或默认新增0040。
- 现有权威能力保持：逐行Comparison稳定ID、Comparison Version、持久化`basis_digest`、不可变Quote Line引用、确定性价格排名、Award对具体Comparison及最新Version的服务端/数据库门禁、独立Event查询。

## 主UAT保护合同

- 只读对象限于RFQ ID 1 / `RFQ-00000001` / Round 1、现有两份Quote、当前四条Comparison、`COMPARISON_GENERATED` Event及Award/PO计数。
- 必须保留RFQ `ISSUED v6`、Binding 8、Quote 2且均`SUBMITTED v1`、Comparison Line 4、Award 0、PO 0。
- 主UAT不得点击或提交生成最新比价、定标、Award或转PO；验收`business POST=0`，安全退出后Session失效。

## 权威模型与读模型合同

- `procurement_quote_comparisons`是逐RFQ Line的Comparison稳定事实，不是独立aggregate Header；不存在独立Header时必须显示：“未设置独立Comparison Header ID；版本身份由RFQ、Round、Comparison Version及basis_digest共同确定。”
- Version复合身份由RFQ ID、Round、Comparison Version和按RFQ Line稳定排序的全部持久化`basis_digest`共同组成；不得伪造整数Header ID或单个持久化aggregate digest。
- 每个版本必须完整显示逐行Comparison数据库ID、固定Quote Header ID/Version/外部参考、固定Quote Line ID、Material ID/正式编码和完整`basis_digest`。
- `CURRENT`表示该RFQ/Round最新Comparison Version且固定Quote输入仍是当前允许定标的版本；存在更新Version时为`SUPERSEDED`。这是服务端读模型投影，不是独立数据库状态列，Award继续由服务端和数据库验证最新Version。
- 输入摘要直接来自逐行持久化`basis_digest`；输出摘要按Material ID、Supplier ID、Comparison Line ID、Comparison候选行ID排序，根据已保存Comparison及不可变Quote Line确定性重算，明确标注为读模型字段。
- Event必须独立查询并按actor、时间、request_id、result分组；真实四条Line级Event只显示为一个生成操作凭证，并逐条列出Comparison Line/Material，不能解释成四次点击或四个Version。

## 汇总与交互合同

- 服务端返回每Supplier的固定Quote身份、总额、有效期、付款条件、税费/运费口径、最晚承诺日及最坏交期状态；UAT应准确显示A `480.00 CNY / 2026-10-20 / ON_TIME / 提前10天`，B `400.00 CNY / 2026-11-05 / LATE / 延期6天`。
- 服务端返回两Supplier之间`80.00 CNY`、以B为基准A高`20%`、A早`16天`，最低价格B、满足需求日期A和B延期风险；明确“比价不等于定标”“不自动产生Award”。
- 当前Quote输入与持久化`basis_digest`一致时，页面禁用生成按钮并显示“当前Quote输入已生成最新比价”；刷新后仍禁用。隔离环境相同输入幂等返回当前Version，不新增Comparison/Event/CAS；Quote修订后才允许v2且v1不可变。
- 桌面使用对比表；390×844使用Supplier汇总卡、Material逐项卡和可折叠追溯凭证，无页面级横向溢出，digest/request_id可换行和复制，定标入口保持可见但本任务不打开。

## 测试、备份、部署与验收

- 串行覆盖Version身份、CURRENT/SUPERSEDED、固定Quote引用、完整basis、输出摘要、金额/百分比/日期差、交期、单Event/四Line Event分组、无join扇出、同输入幂等、Quote修订v2/v1不可变、Award拒绝历史Version、权限/CSRF/Origin/CAS/故障回滚及桌面/390×844 Chromium。
- 运行Schema consistency、现有0039回归及适用采购寻源回归；不新增Migration。
- 全部测试通过后创建root-only正式备份，记录权限、大小、SHA-256，运行`pg_restore --list`并恢复到第二新数据库核验；只替换Web，不运行Migration，不重建PostgreSQL、Worker或Caddy，不修改四个受保护Volume。
- 主UAT只登录purchase并只读打开现有Comparison，核对全部聚合与按钮禁用，桌面/390×844通过；不打开定标窗口，Award/PO保持0/0，安全退出并验证Session失效。

## 允许最终状态

- `RFQ COMPARISON AGGREGATE READ MODEL FIXED — UAT AWARD NOT CREATED`
- `RFQ COMPARISON GOVERNANCE REQUIRES SCHEMA — UAT UNCHANGED`
- `BLOCKED — NO UNSAFE CHANGE`

完成后立即停止，不创建Award或PO。

## 完成证据

- 功能提交`80e1ad60fa1272017545e150721c8b71f7c68828`；服务端聚合读模型、幂等生成保护、桌面/390×844页面、保护/UAT runner和自动测试已实现，无0040。
- Unit/UI/隔离PostgreSQL、0039回归、Schema consistency、Chromium、typecheck/lint/build、npm/Python/environment/credentials全部通过；正式备份/list/第二新库恢复和Web-only部署通过。
- 主UAT purchase-only只读验收`business POST=0`、Session 0；RFQ ISSUED v6、Binding 8、Quote 2、Comparison `4/8/4`、Award/PO `0/0`，保护指纹`16d70f1865e3a2e3b0e840f289d13b340e4f6b87800b1c79d98865112d0cf5bc`前后不变。
- 最终结论与全部证据见[完成报告](SELFHOST-UAT-FIX-28-COMPLETION.md)：`RFQ COMPARISON AGGREGATE READ MODEL FIXED — UAT AWARD NOT CREATED`。
