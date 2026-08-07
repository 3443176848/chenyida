# SELFHOST-UAT-FIX-30 — RFQ Award Confirmation Contract Fix

## 状态与唯一范围

- 状态：`DONE`
- 开始：2026-08-07（Asia/Shanghai）
- 完成：2026-08-07（Asia/Shanghai）
- 负责人：Codex（严格门禁、确认合同修复、串行隔离测试、正式备份恢复、Web-only 部署、purchase-only 主 UAT 取消验收）；项目负责人（固定实现、部署及只读验收边界）
- 依赖：`SELFHOST-PHASE4-TASK04`、`SELFHOST-PHASE4-TASK05`、`SELFHOST-UAT-FIX-22`、`SELFHOST-UAT-FIX-27`、`SELFHOST-UAT-FIX-28`、`SELFHOST-UAT-FIX-29`、D-061、D-062、D-095—D-101
- 唯一范围：补齐正式定标确认窗口中的固定 Quote 引用、一次 Award 操作/恰好四条 Award Line 语义、上游不可变边界、完整下游零自动创建保护及独立下一阶段说明。主 UAT 只选择 Candidate、打开窗口并取消，不创建 Award、PO 或其他下游。

## 严格起点与主 UAT 保护

- 唯一 worktree、clean `main@92adf4646ec45c6ae317c81e974219e75ab54612`、Parent `99a5e6bfe255cb46a0384106eb8ec0a08ec96832`、behind 0/ahead 163。
- 源码/运行 Web `0.1.0-alpha.40`；Migration `0001—0039`，0039 SHA-256 `3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`；当前 Web `sha256:f239ffe3059cfbd5cbb26a45d0960249450ec61989a8f91fb4e17dff3e26e4c1`。
- 主 RFQ ID 1 / `RFQ-00000001` 保持 `ISSUED v6`、Comparison Version 1 / CURRENT、Line/Candidate `4/8`、Quote `1/v1`与`2/v1`、Award/Award Line/PO `0/0/0`。
- output digest 固定为 `79554d88ccdb643a860c0c69e77222abce80eb4d3d8314d88135d3966fb619ec`；保护指纹固定为 `16d70f1865e3a2e3b0e840f289d13b340e4f6b87800b1c79d98865112d0cf5bc`。
- 禁止修改 Quote、Comparison、Candidate、RFQ、Binding、Mapping，禁止重新生成 Comparison、运行/新增 Migration、创建主 UAT Award/PO/下游，禁止登录非 purchase 角色。

## 确认窗口合同

- Supplier A 必须显示 Quote ID `1/v1`、Supplier ID `1 / SUP-000001`、`UAT-Q-A-042576`、`480.00 CNY`、`2026-10-20`、`ON_TIME / 提前10天`；Supplier B 对应 Quote ID `2/v1`、Supplier ID `2 / SUP-000002`、`UAT-Q-B-042576`、`400.00 CNY`、`2026-11-05`、`LATE / 延期6天`。
- 必须逐字显示：“本次确认只创建一次不可变Award操作，并在该操作下创建恰好四条Award Line。”，并显示 Award操作 `1`、Award Line `4`、Comparison Line `1—4`、Candidate `2/4/6/8`、四条均为 Supplier A 且不拆分数量。
- 必须逐项声明不修改 RFQ 已冻结范围、Quote ID 1/v1、Quote ID 2/v1、Comparison Version 1、Comparison Line/Candidate、Binding/Mapping。
- 必须逐项声明不会自动创建 PO、Delivery Plan、Receipt/收货、Inventory Ledger/库存流水、AP/采购应付、Work Order/生产工单、其他生产记录和其他财务记录。
- 必须显示：“下一业务阶段：通过独立的‘定标转PO与到货计划’任务，将已生效Award转换为采购订单及到货计划。本次定标不会自动执行该阶段。”；具体处理人未指定、处理时限未配置时如实显示。
- 继续显示 RFQ/Round/CAS、Comparison Version/CURRENT、四个 basis、output digest、Material 533—536 各 10 PCS、Candidate 2/4/6/8、金额/价差/交期差、`DELIVERY_PRIORITY / 交期优先`、完整理由、取消和最终确认按钮；默认焦点为取消。
- 数据只来自现有 Comparison/Candidate/Quote DTO 与本地未提交选择；不得按 Supplier 名称或价格反向查找 Quote；稳定 ID 保持字符串；不得改变 Award 提交 DTO或放宽服务端权限、CSRF、Origin、CAS、Comparison/Candidate、原因、幂等、并发及事务回滚保护。

## 测试、备份、部署与 UAT

- 串行覆盖确认合同、默认焦点、取消/关闭/ESC 零业务 POST、隔离双击最终确认一次 Award/四条 Line/PO 0、桌面/390×844无页面级横向溢出及长理由/digest/request_id布局。
- 运行现有 RFQ、Quote、Comparison、Award、0039、权限/CSRF/Origin/CAS/幂等/并发/回滚与 Python 基线；不降低断言或跳过失败。
- 全部测试通过后创建 root:root 0600 正式备份，记录大小/SHA，运行 `pg_restore --list`并恢复到第二新数据库核对。
- 只替换 Web；不运行 Migration，不重建 PostgreSQL、Worker、Caddy，不修改四个受保护 Volume。
- 主 UAT 只登录 purchase，选择 Candidate `2/4/6/8`、`DELIVERY_PRIORITY`和完整理由，桌面与390×844打开确认窗口后取消；刷新后草稿清空，business POST 0，RFQ仍v6，Award/Award Line/PO仍`0/0/0`，安全退出并验证Session失效。
- 采购工作台跨角色导航只记录为既有治理债务，本任务不进入、不测试、不修改权限。

## 允许最终状态

- `RFQ AWARD CONFIRMATION FIXED — UAT AWARD NOT CREATED`
- `RFQ AWARD CONFIRMATION PARTIALLY FIXED — UAT AWARD NOT CREATED`
- `BLOCKED — NO UNSAFE CHANGE`

完成后立即停止，不创建主 UAT Award 或 PO。

## 完成结果

- 最终状态：`RFQ AWARD CONFIRMATION FIXED — UAT AWARD NOT CREATED`。
- 功能提交：`22aa4dc053c9e0a8dc523956afe7742cf5d66fbc`（`fix: complete RFQ award confirmation contract`）；部署、UAT、清理和项目文档由独立 `ops: deploy RFQ award confirmation contract fix` 提交收口，实际 SHA 以 Git log 为准。
- 正式确认窗口、隔离 Award、备份恢复、Web-only 部署及 purchase-only 主 UAT 取消验收均通过；主 UAT `business POST 0`，最终 RFQ 仍为 `ISSUED v6`，Award/Award Line/PO 仍为 `0/0/0`。
- 详细证据见[完成报告](SELFHOST-UAT-FIX-30-COMPLETION.md)。
