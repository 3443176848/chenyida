# SELFHOST-UAT-FIX-29 — RFQ Award Candidate Selection Fix

## 状态与唯一范围

- 状态：`DONE`
- 开始：2026-08-07（Asia/Shanghai）
- 负责人：Codex（严格门禁、精确只读诊断、候选关联与确认合同修复、隔离测试、备份恢复、Web-only 部署、purchase-only 主 UAT 取消验收）；项目负责人（固定 Candidate/Award/PO 保护事实及实现、部署、只读验收授权）
- 依赖：`SELFHOST-PHASE4-TASK04`、`SELFHOST-UAT-FIX-19`、`SELFHOST-UAT-FIX-22`、`SELFHOST-UAT-FIX-27`、`SELFHOST-UAT-FIX-28`、D-061、D-062、D-095—D-101
- 唯一范围：修复 RFQ ID 1 / `RFQ-00000001` 四行定标下拉框未展示现有 Supplier Candidate 的问题，保持 Candidate、Comparison、Quote、RFQ、Binding 与全部主 UAT 业务事实不变；主 UAT 只验证候选选择和确认窗口，取消后退出，不创建 Award 或 PO。

## 严格起点与主 UAT 保护

- 起点必须为唯一 worktree、clean `main@8665f21577f2b5f5ab2b9e5ac442487dd6c2335d`、Parent `80e1ad60fa1272017545e150721c8b71f7c68828`、behind 0/ahead 161。
- 源码与运行 Web 保持 `0.1.0-alpha.40`；Migration 保持 `0001—0039`，0039 SHA-256 `3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`，不得修改0039或新增0040。
- 主 UAT 只读基线必须为 RFQ `ISSUED/v6`、Binding 8、Quote 2、Comparison Version 1/CURRENT、Comparison Line 4、Candidate 8、Award/Award Line/PO `0/0/0`，保护指纹 `16d70f1865e3a2e3b0e840f289d13b340e4f6b87800b1c79d98865112d0cf5bc`。
- 主 UAT 禁止创建 Award/PO/到货计划，禁止修改 Quote、Comparison、Candidate、RFQ、Binding，禁止重新生成 Comparison 或直接 SQL 修复，只允许 purchase 登录和最终取消验收。

## Candidate 与 UI 合同

- Comparison Line 1—4 分别只关联 Candidate `1/2`、`3/4`、`5/6`、`7/8`；每行 Supplier B 为 rank 1、Supplier A 为 rank 2，均为 `awardable=true`。
- PostgreSQL bigint ID 在 DTO 与浏览器中使用规范十进制字符串；Line/Candidate 只能以稳定 Comparison Line ID 外键关联，option value 只能使用稳定 Candidate ID，不得使用数组位置、名称、标签或价格。
- 四个选择框初始为“请选择”，每个恰好两个 Supplier 选项；标签完整显示 Supplier、Candidate、Quote/version、单价/行金额、承诺日期、ON_TIME/LATE、提前/延期天数和价格排名。
- `CURRENT` 是 Comparison Version 服务端投影，不得与不存在的 Candidate 状态字段混用；不得只允许最低价，也不得因 Supplier 已 `RESPONDED` 排除既有 Candidate。

## Award 服务端与确认窗口

- 服务端继续重验 Candidate 属于指定 Comparison Line，四行属于同一 CURRENT Version并固定正确 Quote Version；RFQ/Round/CAS、Comparison 输入、数量/币种/价格、历史 Version、跨 Line、缺行/重复/额外行和非最低价理由均失败关闭。
- `DELIVERY_PRIORITY` 中文显示“交期优先”。非最低价 Supplier A 四行可在完整理由下定标；CSRF、Origin、权限、幂等、并发、事务与故障回滚不放宽。
- 隔离确认窗口必须显示 RFQ/Round/CAS、Comparison Version/CURRENT、basis/output digest、四行 Material、四行 Candidate/Supplier、A总额480.00、B最低价400.00、价差80.00/20%、A提前10天/B延期6天/A早16天、原因码及完整理由，并明确只新增 Award、不自动创建 PO或其他下游。
- 主 UAT 只选择 Supplier A、填写 `DELIVERY_PRIORITY` 与完整理由、打开桌面及390×844确认窗口后取消；business POST 必须为0，清空/离开未提交表单并安全退出。

## 测试、备份、部署与提交

- 串行覆盖 bigint字符串、逐行两候选、默认空选、A/B均可选、非最低价理由、跨Line/历史Version/错Quote、缺/重/额外行、过期CAS/输入漂移/非CURRENT、幂等/并发/回滚、隔离Chromium取消零POST和正式Award一次四行/PO0，以及桌面/390×844无横向溢出。
- 运行现有 Comparison、Quote、0039、权限、安全及 Python 基线；不降低断言或跳过失败。
- 全部通过后建立 root:root 0600正式备份，记录大小/SHA、`pg_restore --list`和第二新库恢复；只替换Web，不运行Migration，不重建PostgreSQL/Worker/Caddy，不修改四个受保护Volume。
- 功能与部署验收分别独立提交；不push、不PR、不改写历史。

## 根因与实现结果（功能提交阶段）

- 精确根因是详情中RFQ Line的PostgreSQL `bigint`以字符串返回，而旧Quote Line路径把`rfq_line_id`投影为数字；前端把RFQ Line声明为`number`并以严格相等比较，四行过滤结果均为空。旧定标表单又从Quote数组重建候选并提交Quote Line ID，未使用Comparison Candidate权威DTO。
- 修复后Comparison Version DTO逐行提供Comparison Line、Candidate、Quote Header/version、Quote Line、Supplier、数量、币种、金额、承诺日期、交期、排名、`COMPARABLE`、`awardable`及输入是否当前；所有稳定bigint ID均为规范十进制字符串。
- UI只按`candidate.comparison_line_id === line.comparison_line_id`关联。四行option value分别只允许`1/2`、`3/4`、`5/6`、`7/8`，默认保持“请选择”；不按Supplier名、显示标签、价格、数组位置、rank 1或`RESPONDED`状态过滤。
- Award提交DTO每行携带`rfq_line_id`、`comparison_line_id`、`comparison_basis_digest`、`selected_candidate_id`、`expected_quote_id`、`expected_quote_version_no`及逐行理由字段；顶层绑定RFQ编号、Round、RFQ CAS、Comparison Version、output digest、原因码和理由。服务端从Candidate重新解析固定Comparison/Quote Line/Quote Version/价格事实，不信任浏览器显示字段。
- 正式确认窗口已显示完整身份、摘要、四行选择、Supplier A `480.00 CNY`、Supplier B最低价`400.00 CNY`、价差`80.00 CNY / 20%`、A提前10天/B延期6天/A早16天、`DELIVERY_PRIORITY / 交期优先`及完整理由；取消是默认焦点，并明确不自动创建PO或其他下游。

## 四行权威Candidate分组

| Comparison Line | Material | Supplier B Candidate / Quote | Supplier A Candidate / Quote |
| ---: | --- | --- | --- |
| 1 | `533 / CYD-RB_PCB-000016` | `1 / Quote 2 v1` | `2 / Quote 1 v1` |
| 2 | `534 / CYD-RB_SENSOR-000003` | `3 / Quote 2 v1` | `4 / Quote 1 v1` |
| 3 | `535 / CYD-RB_CONN-000075` | `5 / Quote 2 v1` | `6 / Quote 1 v1` |
| 4 | `536 / CYD-RB_METAL-000015` | `7 / Quote 2 v1` | `8 / Quote 1 v1` |

- Supplier A为`1 / SUP-000001`，每行`12.00 CNY / 120.00 CNY / 2026-10-20 / ON_TIME / 提前10天 / rank 2`。
- Supplier B为`2 / SUP-000002`，每行`10.00 CNY / 100.00 CNY / 2026-11-05 / LATE / 延期6天 / rank 1`。

## 已完成的源码与隔离验证

- Sourcing Unit/UI合计`33/33`、隔离PostgreSQL`9/9`、既有Binding/0039 PostgreSQL回归`18/18`、0039 migration upgrade`6/6`、Origin/CSRF/身份安全`20/20`、专项typecheck通过；lint为0 error/11个既有warning。
- PostgreSQL覆盖超过`Number.MAX_SAFE_INTEGER`的Candidate字符串ID、精确四组Candidate与Quote引用、A/B两种合法Award、非最低价理由、跨Line/错Quote/历史Version、缺/重/额外行、CAS/摘要/输入漂移、幂等重放/异正文冲突、并发单胜和故障回滚。
- 隔离Chromium通过：四行A/B均可选择，默认空选，桌面与390×844无页面级溢出；取消路径`business POST 0`；正式路径只提交一次，得到Award 1、Award Line 4、PO 0，最终Session 0。
- 候选Docker Web镜像为`sha256:f239ffe3059cfbd5cbb26a45d0960249450ec61989a8f91fb4e17dff3e26e4c1`、88,599,819 bytes，版本保持alpha.40。`npm test 3/3`、environment guard`6/6`、Python三项和1,260文件凭据扫描通过；两次首次失败分别由测试容器漏挂`/config`及系统Python缺`openpyxl`导致，均在测试执行前失败并按既有只读环境复验通过。
- 正式root-only备份、`pg_restore --list`、第二新库恢复、Web-only替换和主UAT purchase-only取消验收均已通过；主UAT `business POST 0`、Session 0，RFQ仍为ISSUED v6，Award/Award Line/PO仍为`0/0/0`。详细证据见[完成报告](SELFHOST-UAT-FIX-29-COMPLETION.md)。

## 允许最终状态

- `RFQ AWARD CANDIDATE SELECTION FIXED — UAT AWARD NOT CREATED`
- `RFQ AWARD CANDIDATE SELECTION PARTIALLY FIXED — UAT AWARD NOT CREATED`
- `BLOCKED — NO UNSAFE CHANGE`

完成后立即停止，不创建主 UAT Award 或 PO。
