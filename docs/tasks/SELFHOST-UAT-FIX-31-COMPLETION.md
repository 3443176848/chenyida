# SELFHOST-UAT-FIX-31 完成报告 — RFQ Award History Traceability Fix

## 最终状态

`RFQ AWARD HISTORY TRACEABILITY FIXED — UAT PO NOT CREATED`

完成时间：2026-08-07（Asia/Shanghai）。本任务只补齐现有 RFQ ID 1 / Comparison Version 1 / Award ID 1 的历史追溯与只读投影；没有再次定标、撤销、修改Award、创建PO或到货计划。

## 起点与分支

- 严格起点完全匹配：`main@b725ae8e8d985b79cd26b1353974919300e79f3e`，Parent `22aa4dc053c9e0a8dc523956afe7742cf5d66fbc`，behind 0 / ahead 165，clean、单一worktree、无并发RFQ/Award/PO任务；alpha.40、0001—0039、当前Web `sha256:f11843852426478828c87cf6ec1e889949614beb5ce54df49c23557d16b75e34`。
- 主UAT起点为RFQ 1 / `RFQ-00000001` / Round 1 / CLOSED v7、Quote 2、Comparison Version 1、Award 1、Award Line 4、Award Event 1、PO 0。
- 采用分支A并叠加分支B的准确显示：所需关系事实完整，只缺读模型/UI；Schema没有独立Award业务编号，但存在真实Version。不存在分支C阻断，不新增Migration或0040，不回填历史。

## Award身份与不可变语义

| 项目 | 权威结果 |
| --- | --- |
| 聚合表 / 主键 | `procurement_sourcing_awards.id`，现有Award ID `1` |
| 显示身份 | `定标 #1`；数据库稳定ID，不冒充业务编号 |
| 独立业务编号 | 不存在；页面显示“未设置独立Award业务编号。” |
| Version | 存在真实字段，现有`v1` |
| 权威状态 | `procurement_sourcing_awards.status=AWARDED` |
| 不可变语义 | Award Header与四条Line由一次定标事务形成；本任务不原地改写，合法撤销才会推进Version |
| RFQ / Comparison | RFQ ID1 / RFQ-00000001 / Round1；Comparison v1 / CURRENT；output digest `79554d88ccdb643a860c0c69e77222abce80eb4d3d8314d88135d3966fb619ec` |
| 固定Quote | Quote 1/v1 / Supplier 1（页面标签Supplier A）；Quote 2/v1 / Supplier 2（页面标签Supplier B） |

## 四条Award Line与固定引用

`procurement_sourcing_award_lines.id`是稳定Line主键。Candidate不是虚构字段，而是由Award Line保存的Comparison ID与Quote Line ID在不可变Comparison关系中唯一解析。

| Award Line ID | Comparison Line ID | Candidate ID | Quote Line ID | Quote | Supplier | Material | 数量 | 单价 | 金额 |
| ---: | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: | ---: |
| 1 | 1 | 2 | 1 | 1/v1 | Supplier 1 / A | 533 | 10 PCS | 12.00 CNY | 120.00 CNY |
| 2 | 2 | 4 | 2 | 1/v1 | Supplier 1 / A | 534 | 10 PCS | 12.00 CNY | 120.00 CNY |
| 3 | 3 | 6 | 3 | 1/v1 | Supplier 1 / A | 535 | 10 PCS | 12.00 CNY | 120.00 CNY |
| 4 | 4 | 8 | 4 | 1/v1 | Supplier 1 / A | 536 | 10 PCS | 12.00 CNY | 120.00 CNY |

汇总为Award Line 4、Supplier A 480.00 CNY、Supplier B Award Line 0 / 0.00 CNY；无拆单、无重复Material。服务端同时核验RFQ、Line、Comparison、Candidate、Quote/Quote Line、Supplier、Material、Unit和币种引用闭合；缺失、重复、歧义或跨RFQ时返回稳定`AWARD_READ_MODEL_INCONSISTENT`并零写失败关闭。

## 原因与决策摘要

- 原因代码：`DELIVERY_PRIORITY`。
- 原因正文：`交期优先，避免项目延期；供应商A承诺2026-10-20交付，满足2026-10-30需求日期，供应商B承诺2026-11-05交付，已晚于需求日期。`
- 既有持久化`award_digest`：`7ac6bf2eb579b13460d2d0b9496127c4a75cda73efa605e8ec291b4212a66e55`。来源为`procurement_sourcing_awards.award_digest`；它不含数据库生成的Award/Line ID，不冒充decision digest。
- Schema没有持久化`decision_digest`。服务端以`AWARD_DECISION_V1`，按Award Line ID数值升序，从Award ID、RFQ/Round、Comparison Version/output digest、Award Line/Comparison/Candidate/Quote/Quote Line/Supplier/Material/Unit、数量、单价、金额、币种、行理由及聚合理由规范化值确定性重算。
- 最终decision digest：`7beca9f364718d9161cc4205e282279cdcc97e3fee91073f3494b76abfa7651a`。页面明确显示：“确定性决策摘要，由不可变Award事实重算；不是伪造的历史持久化字段。”

## Event与CAS证据边界

- 唯一聚合级凭证是Event ID `9` / 真实类型`AWARDED` / actor `uat_20260729_purchase` / 时间`2026-08-07 20:02:24.641511 Asia/Shanghai` / request_id `4634fff1-988d-465b-92c6-34ffe214ddda` / result `SUCCESS`。Event数量1、用户操作1、Award Line 4。
- 该历史Event的`old_version/new_version/from_status/to_status`均为空；页面准确显示“历史Award Event未记录版本转换。”，不显示`vnull`、不反推、不回填。
- 同actor、同request_id的唯一成功Audit ID `1469`独立记录RFQ CAS `v6→v7`；提交前v6来源为Audit `old_version`，Audit推进值v7来源为Audit `new_version`，当前v7另由`procurement_rfqs.version`读取。Audit不冒充Event字段。

## Award后状态投影

- Comparison Version 1继续为`CURRENT`，只表达它仍是当前有效比较；存在Award后`awardable_now=false`。页面显示“Comparison仍是当前版本，但RFQ已完成定标，不可再次创建Award。”，定标表单和确认按钮消失，也不再显示“允许进入定标”。
- `po_convertible_now=true`：Award为AWARDED、RFQ为CLOSED、四条Line完整、固定引用闭合、来源采购申请仍ACCEPTED、当前PO计数0均为true。
- 历史页只展示资格与独立“定标转单与到货计划”边界，没有转PO链接、按钮或业务POST。本任务未进入或点击转PO；真正转换仍需独立任务重新校验purchase权限、Award CAS、Supplier、Mapping、幂等和当前数据。

## 自动测试

- Procurement Sourcing typecheck通过；Unit `12/12`；UI `24/24`；Sourcing/Binding PostgreSQL `27/27`；0039 upgrade `6/6`。
- Origin/CSRF/Identity安全回归`30/30`；越权和跨RFQ诱饵不泄漏；Award/Comparison/Quote/0039既有回归通过。
- 隔离Chromium `5/5`：Award创建阶段恰为Award1/Line4/PO0；历史阶段business POST0，桌面、390×844、刷新、重开和Session清理通过。
- production build与Docker build通过；lint 0 error / 11 existing warnings；npm `3/3`；environment guard `6/6`；credentials扫描1,268个仓库文件；`git diff --check`通过。
- Python隔离基线全部通过：`server.py --self-test`、`smoke_test.py`、`go_live_check.py`；测试SQLite及其临时备份已删除。

## 正式备份与第二新库恢复

- 正式dump：`/var/backups/chenyida-erp/rfq-award-history-fix31-predeploy-20260807T130616Z.dump`。
- 元数据：root:root、mode 0600、单硬链接、2,293,634 bytes；SHA-256 `7a3eb8720a0a7075a56288543ee9aeaaa0d3901d0699fdb2b4cd4d5b289cd4fa`；`pg_restore --list` 3,359项。
- 第二新库`rfq_award_history_fix31_restore_20260807t130616z`恢复通过：39/head`0039_rfq_traceability.sql`、226表、RFQ CLOSED v7、Quote2、Comparison Version1、Award/Line/Event/PO `1/4/1/0`、四条Candidate引用和Audit v6→v7均一致。
- 恢复库及PostgreSQL容器内临时dump核验后已精确删除；正式dump保留用于恢复。未触碰四个受保护Volume。

## Web-only部署

- 新Web：`sha256:bb544f89ac405c9565fa551c4120c89d4cc58022220db9a3f46c548a6533a81d`，88,616,950 bytes。
- 旧Web：`sha256:f11843852426478828c87cf6ec1e889949614beb5ce54df49c23557d16b75e34`，保留精确回退标签`chenyida-erp-parallel-web:rollback-rfq-award-history-fix31-predeploy-20260807T130616Z`。
- 固定`COMPOSE_PARALLEL_LIMIT=1`，只以`--no-deps --no-build --pull never --force-recreate web`替换Web。PostgreSQL容器`f3a2f3cb32f4…`、Worker`fb68d9a81b87…`、Caddy`c209765be0b4…`身份和启动时间不变；未运行Migration，不重建PostgreSQL/Worker/Caddy，不修改四卷。
- 新Web健康，公开HTTPS `/api/health`返回PostgreSQL/local/PostgreSQL jobs正常；四服务restart 0/OOM false。

## 主UAT只读验收

- 只登录`uat_20260729_purchase`（role purchase）；没有登录其他角色。Runner在网络层只允许login/logout、Session、RFQ 1 detail和静态GET，拦截所有其他业务请求。
- 桌面1440×900与390×844均核对Award聚合、两份固定Quote、四条稳定Line、引用链、原因、两类摘要、单一Event、Audit CAS、状态投影；刷新和带重开标记重新进入均通过，无页面级横向溢出。
- 未点击转PO；`business_post=0`。安全logout后Session失效、受保护内容不留在DOM，最终purchase有效Session为0。
- 主UAT前后完全一致：RFQ CLOSED/v7、Quote2、Comparison Version1、Award1、Award Line4、Award Event1、PO0；没有第二Award、没有PO、没有任何历史改写。

## 资源、OOM/restart与清理

- 起点约available 2.1 GiB、Swap 252 MiB、根盘18 GiB、Load `0.04/0.13/0.16`；最终检查约2.2 GiB、Swap273 MiB、根盘18 GiB、Load `0.11/0.20/0.37`。期间Swap最高约277 MiB、构建后根盘最低17 GiB、已观察1分钟Load最高约2.41，均未触发停止阈值。
- 所有重任务串行，一次一个临时容器；内核任务时段OOM记录0，Web/PostgreSQL/Worker/Caddy restart均0且OOMKilled false。
- FIX31隔离/恢复数据库和临时容器均清零；既有Sourcing测试库恢复为空；51 MiB Playwright runtime、go-live临时SQLite/备份、容器内dump均已精确删除。删除的临时资源不可恢复且只属于本任务；正式dump、新旧Web镜像/回退标签和四个受保护Volume保留，未执行prune。

## Git与后续条件

- 功能提交：`a014742`，`fix: add RFQ award history traceability`。
- 部署/UAT/完成文档由独立提交`ops: deploy RFQ award history traceability fix`收口；实际SHA以`git log`为准。
- 未push、未PR、未amend/rebase/reset或改写历史；最终工作区应clean，ahead 167。
- 当前`po_convertible_now=true`，因此具备另立“定标转PO与到货计划”任务的只读技术前置条件；这不是转换授权。新任务必须再次核验当前Award/RFQ/Line/PO、权限、CAS、Supplier、Mapping、幂等、审计、备份与恢复，并明确授权后才能创建PO。

完成后立即停止；本任务没有创建PO。
