# SELFHOST-UAT-FIX-31 — RFQ Award History Traceability Fix

## 状态、授权与起点

- 状态：`IMPLEMENTED / DEPLOYMENT AND MAIN UAT PENDING`。
- 日期：2026-08-07（Asia/Shanghai）。
- 授权：补齐现有 RFQ ID 1 / Comparison Version 1 / Award ID 1 的只读历史追溯、状态投影、测试、正式备份恢复、Web-only 部署及 purchase-only 主 UAT 验收；禁止再次定标、撤销、转 PO、建立到货计划、改写既有 Quote/Comparison/Candidate/Binding/Mapping/Event 或直接 SQL 回填业务字段。
- 起点：`main` / `b725ae8e8d985b79cd26b1353974919300e79f3e`，Parent `22aa4dc053c9e0a8dc523956afe7742cf5d66fbc`，`origin/main...HEAD` behind 0 / ahead 165，工作区 clean，单一 worktree，无并发 RFQ/Award/PO 任务；`0.1.0-alpha.40`；PostgreSQL 0001—0039；Web `sha256:f11843852426478828c87cf6ec1e889949614beb5ce54df49c23557d16b75e34`。

## 权威模型与分支

采用分支 A，并叠加分支 B 的准确显示要求；不存在分支 C 阻断：

1. `procurement_sourcing_awards.id` 是 Award 聚合稳定主键；模型没有独立 Award 业务编号，页面必须显示“未设置独立Award业务编号。”。
2. Award 有独立 `version` 字段；现有 Award 为 `version=1`、权威 `status=AWARDED`。AWARDED 事实一次性不可变，只有合法撤销会推进 Version，页面不得声称模型无 Version。
3. `procurement_sourcing_award_lines.id` 是四条明细稳定主键，现有 ID 为 1—4；每条均经不可变 `comparison_id` 与 `selected_quote_line_id` 唯一解析 Candidate 2/4/6/8，并闭合到 Quote 1/v1、Supplier 1、Material 533—536。
4. 模型已有持久化 `award_digest=7ac6bf2eb579b13460d2d0b9496127c4a75cda73efa605e8ec291b4212a66e55`。该摘要来自创建时 RFQ/Comparison/理由/选择请求快照，不包含数据库生成的 Award/Line ID，不能冒充本任务的 decision digest。
5. 模型没有 `decision_digest` 持久化字段。本任务以固定 `AWARD_DECISION_V1` canonical 规则，从不可变 Award、Award Line、RFQ、Comparison/Candidate、Quote/Quote Line 稳定 ID与数值事实确定性重算；不新增 0040、不写回历史数据。
6. Award Event ID 9 / 类型 `AWARDED` / 数量 1，真实 `result=SUCCESS`，但 `old_version/new_version/from_status/to_status` 均为空。页面显示“历史Award Event未记录版本转换。”；同 request_id 的唯一成功 Audit ID 1469 是 RFQ CAS `v6→v7` 的独立证据，不冒充 Event 字段。

## 实现边界

- 扩展 RFQ detail 的服务端 Award 历史 DTO：聚合身份、固定 Quote、四条引用链、原因、持久化 `award_digest`、派生 decision digest、唯一 Event、独立 Audit CAS、汇总及 PO 转换资格。
- Comparison `CURRENT` 继续只表达最新固定 Quote 输入未漂移；`awardable_now` 同时要求 RFQ 仍为 `ISSUED` 且不存在 Award。现有 Award 后保持 `CURRENT`，但 `awardable_now=false`。
- `po_convertible_now` 只读投影必须至少核验 Award `AWARDED`、RFQ `CLOSED`、Award Line 完整且引用闭合、未存在 Award→PO Link；真正转 PO 仍须独立任务在写事务重验权限、CAS、Supplier 与 Mapping。
- Award 已存在时，采购寻源页只展示历史，不显示创建 Award 的表单、确认按钮或撤销表单；可展示独立转 PO 模块的只读入口，但本任务不点击、不调用转换 POST。
- 所有查询继续在 RFQ 数据域授权后、repeatable-read read-only 事务内执行；跨 RFQ 或缺失引用失败关闭，不泄漏诱饵数据。

## 测试、部署与主 UAT

- 串行覆盖 Award ID、四个 Line ID、Comparison/Candidate/Quote Line 引用、Supplier B 零行、编号/Version语义、两类摘要、唯一 Event、无 `vnull`、Award 后状态投影、PO 资格、刷新重开、越权/跨 RFQ、390×844、既有 RFQ/Comparison/Quote/0039/安全回归。
- 不新增 Migration。全部测试通过后执行正式 custom dump、权限/大小/SHA-256、`pg_restore --list` 和第二新库恢复核验；只构建并替换 Web，不重建 PostgreSQL、Worker 或 Caddy，不修改受保护 Volume。
- 主 UAT 只使用 purchase 角色，只读打开 RFQ/Award 历史并验证桌面与 390×844；business POST 必须为 0，不点击转 PO，结束时安全退出并验证 Session 失效。前后保持 RFQ CLOSED/v7、Quote 2、Comparison Version 1、Award/Award Event/PO 1/1/0。

## 功能提交前验证

- 服务端读模型、DTO、历史页面、状态投影及 FIX-31 只读 UAT runner 已实现；没有修改 Award 写接口、数据库结构、0039 或运行数据，也没有新增 0040。
- 自动验证通过：Procurement Sourcing typecheck；Unit `12/12`；UI `24/24`；Sourcing/Binding PostgreSQL `27/27`；0039 upgrade `6/6`；Origin/CSRF/Identity安全回归 `30/30`；隔离 Chromium `5/5`；lint `0 error / 11 existing warnings`；npm `3/3`；environment guard `6/6`；Python `server.py --self-test`、`smoke_test.py`、隔离 `go_live_check.py`；credentials扫描 `1,268` 个仓库文件及 `git diff --check`。
- 隔离浏览器验证形成 Award 1 / Award Line 4 / PO 0，历史只读阶段 `business_post=0`，桌面、390×844、刷新、重开和退出清理均通过；该数据只存在于任务测试库，测试库已删除或恢复为空。
- production Docker候选镜像为 `sha256:bb544f89ac405c9565fa551c4120c89d4cc58022220db9a3f46c548a6533a81d`，88,616,950 bytes；当前UAT Web仍为起点镜像 `sha256:f11843852426478828c87cf6ec1e889949614beb5ce54df49c23557d16b75e34`，尚未部署。

## 完成条件

- 更新 `MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md`；必要的决策边界写入 `DECISIONS.md`。
- 功能与部署验收分别创建独立提交；不 push、不 PR、不改写历史。
- 最终状态只能是 `RFQ AWARD HISTORY TRACEABILITY FIXED — UAT PO NOT CREATED`、`RFQ AWARD GOVERNANCE REQUIRES SCHEMA — UAT UNCHANGED` 或 `BLOCKED — NO UNSAFE CHANGE`。
