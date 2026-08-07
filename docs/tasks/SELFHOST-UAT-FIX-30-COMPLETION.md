# SELFHOST-UAT-FIX-30 — RFQ Award Confirmation Contract Fix 完成报告

最终状态：`RFQ AWARD CONFIRMATION FIXED — UAT AWARD NOT CREATED`

## 范围、起点与Git

- 从唯一worktree、clean `main@92adf4646ec45c6ae317c81e974219e75ab54612`、Parent `99a5e6bfe255cb46a0384106eb8ec0a08ec96832`、behind 0/ahead 163、`0.1.0-alpha.40`、Migration `0001—0039`起步；起点Web为`sha256:f239ffe3059cfbd5cbb26a45d0960249450ec61989a8f91fb4e17dff3e26e4c1`。
- 功能提交为`22aa4dc053c9e0a8dc523956afe7742cf5d66fbc`（`fix: complete RFQ award confirmation contract`）；部署、主UAT、清理与项目文档由独立`ops: deploy RFQ award confirmation contract fix`提交收口，实际SHA以Git log为准。
- 保持alpha.40；0039 SHA-256仍为`3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`，没有修改0039、没有新增0040、没有运行Migration。未push、未建PR、未改写历史。

## 新增确认字段与固定Quote引用

- 窗口继续显示RFQ ID `1`、`RFQ-00000001`、Round `1`、CAS `v6`，Comparison Version `1 / CURRENT`、四个`basis_digest`、output digest、Material 533—536各`10 PCS`、Candidate `2/4/6/8`、金额/价差/交期差、原因码和完整理由；新增显示只读`request_id`，长理由、digest和request_id均可换行且不截断。
- Supplier A固定显示：Quote ID `1/v1`、Supplier ID `1 / SUP-000001`、外部引用`UAT-Q-A-042576`、`480.00 CNY`、`2026-10-20`、`ON_TIME / 提前10天`。
- Supplier B固定显示：Quote ID `2/v1`、Supplier ID `2 / SUP-000002`、外部引用`UAT-Q-B-042576`、`400.00 CNY`、`2026-11-05`、`LATE / 延期6天`。
- 窗口同时显示Supplier A总额480.00、Supplier B最低价400.00、价差80.00/20%、A提前10天、B延期6天及A早16天。固定理由为：`交期优先，避免项目延期；供应商A承诺2026-10-20交付，满足2026-10-30需求日期，供应商B承诺2026-11-05交付，已晚于需求日期。`
- Quote摘要直接来自CURRENT Comparison DTO的`fixed_quote_inputs`、`supplier_summaries`及Candidate外键身份，并逐项校验Supplier ID、Quote ID/version和Candidate引用一致性；没有按Supplier名称、金额、价格或日期反向查找。Quote ID和Candidate ID保持规范十进制字符串语义。

## Award操作、行数量与提交边界

- 窗口逐字显示：“本次确认只创建一次不可变Award操作，并在该操作下创建恰好四条Award Line。”，并单独显示Award操作`1`、Award Line`4`、四条均为Supplier A、不拆分数量。
- 四条行逐项对应Comparison Line `1→4`与Candidate `2/4/6/8`，Material 533—536各`10 PCS`；没有以“一个Award及其Award Line”等不确定措辞代替精确计数。
- 本地草稿只增加确认展示所需的Quote摘要和Comparison request_id；实际Award提交DTO未改变。单元测试对顶层和逐行提交字段做精确键集合断言。
- 服务端仍在单事务内重验purchase权限、Origin、CSRF、CURRENT Comparison Version、固定Quote、CAS、basis/output digest、完整行集、Candidate归属、金额/数量/币种、非最低价原因、幂等、并发、审计及故障回滚；没有放宽任何写保护。

## 上游不可变与下游保护文案

- 上游逐项声明：不修改RFQ已冻结范围；不修改Quote ID 1/v1；不修改Quote ID 2/v1；不修改Comparison Version 1；不修改Comparison Line或Candidate；不修改Binding或Mapping。
- 下游逐项声明本次定标不会自动创建：PO、Delivery Plan、Receipt／收货、Inventory Ledger／库存流水、AP／采购应付、Work Order／生产工单、其他生产记录、其他财务记录。
- 下一阶段逐字显示：“下一业务阶段：通过独立的‘定标转PO与到货计划’任务，将已生效Award转换为采购订单及到货计划。本次定标不会自动执行该阶段。”；并如实显示“具体处理人：未指定”“处理时限：未配置”。
- “取消”和最终确认按钮均保留，打开窗口默认焦点位于取消；取消按钮、右上关闭、ESC和遮罩关闭均不发送业务POST。

## 自动测试与隔离Award结果

- Unit `11/11`、UI合同`22/22`、隔离Sourcing/Binding/RFQ/Quote/Comparison/Award PostgreSQL `27/27`、0039 migration `6/6`、Origin/CSRF/Identity安全`20/20`、浏览器完整RFQ套件`5/5`全部通过。
- 专项typecheck、lint（0 error、11个既有warning）、production/Docker build、`npm test 3/3`、environment guard `6/6`及Python `server.py --self-test`、`smoke_test.py`、临时SQLite `go_live_check.py --no-backup`通过；最终凭据扫描1,264个仓库文件通过。
- 浏览器覆盖桌面与390×844、长理由/digest/request_id、页面级横向溢出、默认焦点、取消/关闭/ESC零写入，以及同一最终确认按钮同步双击。隔离正式路径只有一次Award业务POST，数据库结果恰为Award操作`1`、Award Line`4`、PO`0`；四条Line对应Comparison Line `1—4`和Candidate `2/4/6/8`。
- 权限、CSRF、Origin、CAS、幂等重放/异正文冲突、并发单胜和故障全回滚继续通过；没有降低断言、跳过失败或写死结果。

## 正式备份、恢复与Web-only部署

- 正式备份：`/var/backups/chenyida-erp/rfq-award-confirmation-fix30-predeploy-20260807T103641Z.dump`，root:root、0600、单硬链接、2,292,405 bytes，SHA-256`19d563f424cb5bd628f2b2dc6114c74cc58eb7c66f3fb75038b14690a281e39e`；`pg_restore --list`为3,359行。
- 第二全新数据库`rfq_comparison_aggregate_restore_20260807`恢复成功，核对39/head 0039、226张public表、Award/Award Line/PO `0/0/0`及保护指纹`16d70f1865e3a2e3b0e840f289d13b340e4f6b87800b1c79d98865112d0cf5bc`一致；验证后精确删除恢复库及容器内临时文件，正式dump保留。
- 最终Web为`sha256:f11843852426478828c87cf6ec1e889949614beb5ce54df49c23557d16b75e34`、88,601,599 bytes；旧Web`sha256:f239ffe3059cfbd5cbb26a45d0960249450ec61989a8f91fb4e17dff3e26e4c1`保留为`rollback-rfq-award-confirmation-fix30-predeploy-20260807T103641Z`。
- 仅以`up -d --no-deps --no-build --force-recreate web`替换Web。PostgreSQL、Worker、Caddy容器未重建，migrate容器不存在且未运行，四个受保护Volume未修改。HTTPS `/api/health`通过，Web/PostgreSQL healthy，Worker/Caddy running。

## 主UAT只读取消验收

- 唯一登录角色为purchase。桌面和390×844依次打开RFQ与Comparison v1，本地选择Candidate `2/4/6/8`、`DELIVERY_PRIORITY`及完整理由，核对全部确认字段后点击取消；没有点击最终确认。
- 刷新后未提交草稿为空；网络保护和runner记录`business_post=0`。安全退出后有效Session为0，受保护会话失效。
- UAT前后保持：RFQ `1 / RFQ-00000001 / ISSUED / v6 / Round 1`，Comparison Version 1/CURRENT、Line 4、Candidate 8、Quote 1/v1与2/v1，Award/Award Line/PO `0/0/0`，output digest`79554d88ccdb643a860c0c69e77222abce80eb4d3d8314d88135d3966fb619ec`及保护指纹`16d70f1865e3a2e3b0e840f289d13b340e4f6b87800b1c79d98865112d0cf5bc`不变。
- 未修改Quote、Comparison、Candidate、RFQ、Binding或Mapping，未重新生成Comparison，未创建主UAT Award、PO或任何下游。

## 资源、清理、范围外债务与下一步

- 重任务全部串行且一次最多一个临时容器。任务起点约available 2.1 GiB、Swap 242 MiB、根盘18 GiB、Load`0.90/0.49/0.28`；最终available 2.2 GiB、Swap 252 MiB、根盘18 GiB、Load`0.16/0.34/0.58`。任务窗口内核OOM 0，Web/PostgreSQL/Worker/Caddy均restart 0、OOM false。
- FIX30临时容器/runtime/SQLite、恢复库、Migration/Browser临时库均清零；起点既有`procurement_sourcing_test_fix22_20260805`恢复为空public Schema。正式dump、current/candidate/rollback Web镜像保留；四个受保护Volume保留且未运行任何prune。
- 采购工作台跨角色导航仅记录为既有权限治理债务；本任务未进入、未测试、未授予或撤销任何权限。
- 当前Comparison仍为CURRENT、固定Quote无漂移、四条Candidate完整，具备重新执行正式人工定标的技术条件；这不是业务批准。真正点击最终确认仍须新的明确授权，并在执行前重新核验RFQ CAS、Comparison Version/basis/output digest、Quote有效性和Candidate资格。其后“定标转PO与到货计划”仍是另一个独立任务，不会由定标自动执行。
- 当前立即停止在主UAT Award/Award Line/PO `0/0/0`。
