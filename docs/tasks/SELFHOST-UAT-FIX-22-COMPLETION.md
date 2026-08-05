# SELFHOST-UAT-FIX-22 完成报告

## 结论

`RFQ TRACEABILITY DEPLOYED — UAT RFQ STILL DRAFT`

自托管并行非生产 UAT 已部署 RFQ 草稿创建凭证、逐 Supplier×RFQ Line Mapping 追溯和发出前安全确认。主 UAT `RFQ-00000001` 未固定 Mapping、未发出、未录报价、未定标、未创建 PO；最终仍为 `DRAFT` v1，Quote/Award/PO 为 `0/0/0`，有效 Session 为 0。

## 创建事件权威来源

- 新 generation 2 RFQ：创建事务同时保存 RFQ 头、四行、Supplier 邀请、精确 Mapping bindings、成功 Audit/Idempotency 和唯一 `RFQ_CREATED` credential v2 业务 Event。Event 保存稳定 RFQ ID、actor、`created_at`、request_id、SUCCESS、Idempotency-Key 摘要、scope digest、`null→v1` 和 `null→DRAFT`，数据库禁止改写或删除。
- 主 UAT generation 1 RFQ：0039 前不存在独立 `RFQ_CREATED` 业务 Event，系统没有补造历史 Event。详情只在唯一 Audit 同时精确匹配 RFQ object ID、actor、request_id、创建时间、SUCCESS、Idempotency 摘要和 `null→v1` 时显示 `EXACT_SUCCESS_AUDIT`；否则显示 `UNVERIFIED` 并禁止发出。
- 主 UAT 的精确创建事实为 actor `uat_20260729_purchase`、Asia/Shanghai `2026-08-05 15:24:26.684817`、request_id `75078325-3b3a-4d1e-b911-99cbd5f802db`、结果 SUCCESS、版本不存在→v1。页面明确说明这不是伪造的历史不可变业务 Event。

## Mapping 绑定模型

- 原有关系继续保留：`procurement_rfq_lines.purchase_request_line_id` 证明 RFQ Line→Purchase Request Line；`procurement_rfq_suppliers.supplier_id` 证明 RFQ Supplier→Supplier。
- 唯一新增 `procurement_rfq_supplier_line_mapping_bindings`，逐 RFQ Supplier×RFQ Line 保存精确 Supplier Mapping version row 外键、稳定 Mapping UID、Mapping Version/CAS/content digest、Supplier part、Unit、1:1 换算、有效期、绑定状态、来源、actor、时间和 request_id；关系 FK、唯一约束和 commit guard 证明完整 2×4 覆盖。
- 新 RFQ 在创建事务中固定 Mapping，发出只重验并沿用同一不可变绑定；不在每次读取时把当前 ACTIVE Mapping 当成历史绑定。
- 既有主 RFQ 不回填，最终 Binding 数仍为 0。页面显示“历史草稿尚未固定 Mapping”，八条 Mapping 仅为当前资格检查和拟绑定；purchase 后续只能通过独立、显式、幂等且带 CAS 的“确认并固定当前 Mapping”事务建立绑定。

## Migration 与版本

- 采用 Schema 分支 B；版本由 `0.1.0-alpha.39` 升级到 `0.1.0-alpha.40`。
- 唯一新增 `0039_rfq_traceability.sql`，SHA-256：`3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`。
- `0001`—`0038` 未修改；0038 SHA-256 仍为 `2da259364151af098641795da55604dc3012b6adf92aec67038c0554e0592941`。
- 最终源码和并行 UAT PostgreSQL 均为 39/head `0039_rfq_traceability.sql`、226 张 public 表。

## 发出前与发出成功保护

- “发出询价并冻结范围”只打开确认窗口；默认焦点为取消，取消、关闭、ESC 都是零业务请求。确认按钮首次点击同步禁用，双击只允许一个事件。
- 窗口显示 RFQ/PRQ、Round/Version、创建凭证、四条各 10 PCS、两家 Supplier、八条 Mapping ID/Version、截止日、CNY、当前资格、冻结后不可原改及零自动下游说明。
- 服务端和 PostgreSQL 在发出事务中重验 DRAFT/CAS、来源 PRQ ACCEPTED/版本/最新性、上海日期截止日、Supplier/邀请、Material、精确 Mapping ID/Version/CAS/content/status/effective period/1:1/唯一性。任何漂移或冲突按 Supplier/Material 组合失败关闭。
- 隔离环境成功发出只产生一个 `RFQ_ISSUED/SUCCESS` credential、Audit 和 Idempotency 结果，版本 v1→v2，最终 ISSUED；绑定/范围保持，Quote 入口启用但 Quote/Award/PO 仍为 0。

## 自动测试

- Migration：6/6，覆盖空库、0038→0039、重复执行、失败回滚、历史 DRAFT 不伪造绑定和历史 ISSUED v1 后续兼容。
- Unit/UI/PostgreSQL：无数据库 Unit/UI 14/14；Sourcing/FIX-22 PostgreSQL 12/12，合计 26/26。覆盖精确创建事件、诱饵隔离、2×4 Mapping、漂移/失效/冲突、幂等异正文、CAS/并发单胜、故障零半记录和零自动下游。
- 相关回归：Material Requirement 12/12；真实 Sourcing→Award→Fulfillment 2/2；typecheck 通过；lint 0 error/11 个既有 warning；Schema consistency、build/postbuild、凭据扫描、`git diff --check` 通过。
- Python 基线：`server.py --self-test`、`smoke_test.py`、`go_live_check.py` 全部通过，使用隔离临时数据；测试创建的本地临时备份已精确删除。
- 最终隔离 Chromium 1/1：草稿创建→取消/关闭/ESC→Mapping 漂移阻断→正式发出；创建 Event 1、Binding 8、发出 Event 1、双击发出 POST 1，刷新/Web 重启证据保持，Quote 入口只在发出后启用，Quote/Award/PO 0，桌面/390×844、退出历史保护和 Session 0 通过。
- 最终部署镜像：`sha256:58d97778d88d6103ca4d6cc3e0bfe8033bf0921a6c1b7ecbec31254403792651`，88,531,959 bytes。

## 备份、恢复与部署

- 正式备份：`/var/backups/chenyida-erp/rfq-traceability-fix22-predeploy-20260805T094629Z.dump`，root:root、0600、单硬链接、2,232,310 bytes。
- 备份 SHA-256：`960cd6a882b1ab923f2ee38dd83e9fc41f53942048bd5c1c07fcc44f1f3ae6c2`；`pg_restore --list` 3,321 行。
- 第二新空库恢复为 38/head 0038 后与主 UAT保护指纹一致；再升级 0039 后仍一致。恢复库随后精确删除。
- 正式部署按停写→备份→指纹→0039→核对→Web 更新串行执行。PostgreSQL、Worker、Caddy 容器和四个受保护 Volume 未更换；旧 Web 保留精确 rollback 标签。
- 首次只读 UAT runner 在窗口打开前暴露响应合同断言错误并安全退出；第二次在窗口打开前暴露 Mapping `timestamptz` 被 UTC 截日的问题。两次均为业务写 0、Session 0、指纹不变。修复运行器合同和只读 `Asia/Shanghai` 日期投影、补回归并重新构建隔离验收后，仅 Web 更新到最终镜像。

## 主 UAT 草稿追溯结果

- purchase-only 最终只读 Chromium 核验 RFQ ID 1 / `RFQ-00000001` / Round 1 / v1 / `DRAFT / 草稿 / 待发出`。
- 来源为 PRQ ID 1 / `PRQ-00000001` / ACCEPTED；四条 Material 533—536 各 10 PCS；Supplier 1/2 各一次；截止日 `2026-08-31`；CNY。
- 创建凭证为精确成功 Audit；Mapping 模式为 `UNBOUND_LEGACY_DRAFT`，Binding 0，八条当前资格/拟绑定 Mapping 的稳定 ID、Version、Supplier part、PCS→PCS、1:1、上海业务日期和当前 ACTIVE 状态完整显示。
- 桌面与 390×844 各打开发出确认窗口并点击取消；确认按钮因历史草稿尚未固定 Mapping而禁用。
- 最终结果：`business_post=0`、Quote/Award/PO `0/0/0`、RFQ Event 0、Session 0；保护指纹始终为 `9d4641b1b6324de4e3a1a26e7461ca2e15bd7613cb99a277c11e6bca869ac66e`。

## Git、资源与清理

- 功能提交：`b339acd97f08e4cc09451173b48580015817d9f8`，`fix: expose rfq draft traceability`。
- 部署、只读日期投影修复、最终 UAT 和文档：独立提交 `ops: deploy rfq issuance safeguards`，实际 SHA 以 Git log 为准。
- 起点为 clean `main@60538d0`、behind 0/ahead 142；完成后预计 ahead 144。未 push、创建 PR、amend、rebase、reset、stash 或改写历史。
- 起点资源约为 available memory 2.0 GiB、Swap 259 MiB、根盘 20 GiB、Load `0.24/0.20/0.13`；最终约为 2.1 GiB、239 MiB、20 GiB、Load `0.16/0.30/0.41`。
- 全程串行、一次最多一个临时容器；最终四服务 RestartCount 0、OOMKilled false。两个 FIX-22 测试库、浏览器数据库、恢复库、临时容器和 standalone/Playwright 目录均为 0；未执行全局 prune。正式备份、当前/回滚镜像和四个受保护 Volume 保留。

## 是否可以开始正式发出 RFQ

不可以直接发出。主 RFQ 仍没有历史 Mapping 绑定；本任务明确未执行补救确认。下一任务必须取得新的业务授权，先显式确认并固定当前八条 Mapping，记录 actor/时间/request_id 并重新核对 PRQ、Mapping、指纹和下游；确认成功后，实际发出仍须再次获得明确授权。该边界不授权 Quote、Award 或 PO。
