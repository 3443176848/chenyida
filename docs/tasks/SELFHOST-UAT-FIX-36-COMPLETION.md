# SELFHOST-UAT-FIX-36 — PO History Traceability 完成报告

## 最终结论

`PO HISTORY TRACEABILITY FIXED — UAT DOWNSTREAM UNCHANGED`

- 日期：2026-08-08（Asia/Shanghai）。
- 范围：仅为既有PO提供受限、只读、可刷新重开的历史读模型与响应式详情；没有修改PO、Line、Delivery Plan、queue或任何上下游业务数据。
- Schema：`0.1.0-alpha.40`、Migration 0001—0039不变；未新增0040、未修改0039、未运行Migration。

## D-105控制边界

- PO业务结构完整；原始写入无法绑定到事前授权任务。
- 项目负责人依据D-105决定受控保留。D-105只提供前向授权，不是追溯性授权，也不是补办授权；后续每个阶段仍需独立授权。
- 产品代码没有硬编码`PO-00000001`或D-105，页面只显示关系化业务事实，不声称“授权已验证”。

## PO聚合身份

| 字段 | 权威实值 |
| --- | --- |
| PO | 数据库ID `1`；`PO-00000001`；v1；`OPEN / 处理中` |
| Supplier | ID `1`；`SUP-000001`；`UAT快速交付供应商A-042576` |
| 商务 | CNY；未税；不含运费；订购`40 PCS`；已收`0 PCS`；总额`480.00 CNY` |
| 付款条件 | `纯虚拟UAT付款条件，仅用于表单验收。` |
| 实际存储备注 | `纯虚拟UAT采购订单,仅用于黑盒验收,不对应真实采购。`（两个半角逗号原样保留） |
| 创建事实 | actor `uat_20260729_purchase`；`2026-08-08 14:11:45.086372 Asia/Shanghai` |
| 成功request | `773c23b6-0923-4ab5-a451-bb80aa4bdf9d` |
| operation | `ac0638af-3263-4c3d-93c0-7327033ce71c` |
| Action | `SOURCING_AWARD_CONVERTED` |
| 当前转换投影 | `po_convertible_now=false` |

任务原文给出的成功request少了末尾`d`，且不是合法UUID。数据库、既有审计证据和页面均使用上表的真实值；没有直接SQL补写、截断或伪造显示字段。

## 完整上游谱系与摘要

`Project 1 → MRP 1 → PRQ 1 → RFQ 1 / v7 → Comparison Version 1 → Quote 1 / v1 → Award 1 / v1 → PO 1 / v1`

- Comparison output digest：`79554d88ccdb643a860c0c69e77222abce80eb4d3d8314d88135d3966fb619ec`
- Award持久化摘要：`7ac6bf2eb579b13460d2d0b9496127c4a75cda73efa605e8ec291b4212a66e55`
- Award派生决策摘要：`7beca9f364718d9161cc4205e282279cdcc97e3fee91073f3494b76abfa7651a`

## 四条PO Line稳定谱系

四条均为Supplier A、`10 PCS`、`12.00 CNY/PCS`、`120.00 CNY`、计划日期`2026-10-20`、已收数量0；Material无重复，Supplier B行数0。

| PO Line | Award Line | Candidate | Quote Line | Binding | Material | Mapping |
| ---: | ---: | ---: | ---: | ---: | --- | --- |
| 1 | 1 | 2 | 1 | 1 | `533 / CYD-RB_PCB-000016` | `Fact 1/v1/CAS3 / 224d1965-44ef-4c3e-901e-1926b6b07ff8` |
| 2 | 2 | 4 | 2 | 2 | `534 / CYD-RB_SENSOR-000003` | `Fact 2/v1/CAS3 / 43ca04d8-9933-4dac-ba21-b7fb85741830` |
| 3 | 3 | 6 | 3 | 3 | `535 / CYD-RB_CONN-000075` | `Fact 3/v1/CAS3 / aa16f7e7-904d-4ae2-9f73-d34e7aaf257e` |
| 4 | 4 | 8 | 4 | 4 | `536 / CYD-RB_METAL-000015` | `Fact 4/v1/CAS3 / 9659ad2d-406a-4c4c-b575-51329badc63f` |

## Delivery Plan与queue

模型没有独立Delivery Plan Line；四条Delivery Plan分别直接对应四条PO Line。它们均为`PENDING / v1`、`10 PCS`、计划日期`2026-10-20`、已收0，actor `uat_20260729_purchase`、时间`2026-08-08 14:11:45.086372 Asia/Shanghai`、request `773c23b6-0923-4ab5-a451-bb80aa4bdf9d`。queue是待处理队列，不表示已收货或已入库。

| Plan | PO / PO Line | Award Line | Material | Plan Event | queue |
| ---: | --- | ---: | --- | ---: | --- |
| 1 | `1 / 1` | 1 | `533 / CYD-RB_PCB-000016` | 1 / `CREATED` | 1 / `OPEN_PENDING / v1` |
| 2 | `1 / 2` | 2 | `534 / CYD-RB_SENSOR-000003` | 2 / `CREATED` | 2 / `OPEN_PENDING / v1` |
| 3 | `1 / 3` | 3 | `535 / CYD-RB_CONN-000075` | 3 / `CREATED` | 3 / `OPEN_PENDING / v1` |
| 4 | `1 / 4` | 4 | `536 / CYD-RB_METAL-000015` | 4 / `CREATED` | 4 / `OPEN_PENDING / v1` |

## Event、Audit与Idempotency受限凭证

- PO Event：ID `1`；`CREATED`；`null → OPEN`；actor/时间/request与成功创建事实一致；`SUCCESS`。
- Audit：ID `1491`；`SOURCING_AWARD_CONVERTED`；`SUCCESS`；actor/时间/request与成功创建事实一致。
- Idempotency：HTTP `201`；digest `214d55782672b8e03da9ed80a983ea31572b9ae367b89e2d4a8f2df385b3df2d`；request digest `7afef61364304b15c4cb313d708aa2dd0cbef3bc47f44bb65ef028ef8e6c527a`。
- 历史失败请求：`f30a7801-1cd0-4849-95a8-9c61d5c52e67`；`FAILED / HTTP 422`；业务记录0；以`UNBOUND_PRIOR_ATTEMPT`独立展示，不与成功PO合并为一次操作。HTTP 422来自既有稳定错误合同投影，不冒充数据库新增字段。
- DTO只返回目标PO关联状态和摘要，不返回请求/响应正文、Cookie、Session或敏感Header。purchase没有新增`system.audit.read`。

## 下游零状态

| 下游对象 | 计数 |
| --- | ---: |
| Receipt | 0 |
| Warehouse Receipt | 0 |
| Inventory Ledger | 0 |
| Lot | 0 |
| IQC | 0 |
| AP | 0 |
| Payment | 0 |
| Work Order | 0 |
| 生产报告 | 0 |
| 完工记录 | 0 |

页面明确说明：PO `OPEN`不等于已到货，Delivery Plan `PENDING`不等于已收货，queue `OPEN_PENDING`不等于库存增加，本页面不会自动执行任何下游动作。

## 权限、UI与主UAT

- 服务端先沿PO→Award→RFQ→PRQ校验purchase数据域；跨项目/跨数据域PO返回403。PO、queue和应付列表沿相同既有数据域过滤，不泄漏其他PO、Supplier、Audit或Idempotency。
- 页面只有刷新、返回和复制等只读动作；没有PO/Line/Plan/queue编辑控件或到货、收货、IQC、库存、财务、生产按钮。
- 桌面1440和390×844均通过；移动端使用PO摘要卡、Line卡、Plan/queue卡与折叠凭证，无页面级横向溢出，ID/UUID/digest/request_id可换行和复制，状态不只依赖颜色。
- 主UAT只登录`uat_20260729_purchase`；未登录warehouse、quality、finance或其他角色。刷新、reload、历史重开、退出及匿名历史恢复通过，最终purchase有效Session为0。
- 主UAT业务POST为0（仅登录/退出身份控制请求）；浏览器前后指纹均为`ae02a432618e8128544cb049155628f483b195b78ac177426459039b1509cc68`。主库状态指纹前后均为`721f25f875e4e3af7cc8401f9bff9dadcc959092047844d446461999afa60594`，历史投影指纹均为`d11b46bc41f59bcc7b10a19041940664c37c0753c65160a17551322652b14ae7`。

## 测试与构建

- PO专项Unit/UI `9/9`；Fulfillment PostgreSQL `6/6`及Award ID41/PO ID1偏移身份专项`1/1`；Sourcing/Binding PostgreSQL合计`20/20`。
- Migration 0019/0038/0039分别`3/3 + 5/5 + 6/6`；无0040，0039 SHA-256仍为`3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`。
- Identity/Origin/安全、两组typecheck、全量lint、`npm test 3/3`、Python `server.py --self-test`/`smoke_test.py`/`go_live_check.py --no-backup`、功能阶段credentials 1,287文件、最终文档后credentials 1,288文件和production Docker build均通过。
- 隔离Chromium `1/1`：PO/Line/Plan/queue `1/4/4/4`、下游0、只读GET、刷新/重开/服务重启、桌面/390×844和Session0全部通过。一次测试环境挂载缺少既有依赖文件、一次viewport未复位均在补齐测试环境后以原业务断言重跑通过，不是产品代码或数据失败。

## 备份、恢复与Web-only部署

- 正式dump：`/var/backups/chenyida-erp/po-history-traceability-fix36-predeploy-20260808T091428Z.dump`；root:root 0600；2,297,975 bytes；SHA-256 `0e6f8215512eb28c1dc72d2dec84b1d645a173bd9cbf93127adf1a2205df38f1`。
- `pg_restore --list`：3,359行、3,348 TOC项。第二新数据库`po_history_traceability_restore_task36_20260808`单事务恢复，核对39/head0039/checksum、226个public表、PO `1/v1/OPEN`、Line/Plan/queue `4/4/4`和全部下游0。主库/恢复库比较指纹均为`9fa0f427228b1667c5fa2dd82a13d4cd422d97fa26d660c57adbb9ba6d8d7ff5`；恢复库随后精确删除，正式dump保留。
- Web从`sha256:83c1bff341294d1bee2db8fd2ee963204012cfac63f1289ba7d3755ca2920664`仅替换为`sha256:664e0ac6bd289251f289a8785ac05d955470064a3f921c3ae834f79665a4ec89`；新镜像inspect大小88,658,388 bytes。旧镜像以`chenyida-erp-parallel-web:rollback-po-history-traceability-fix36-predeploy-20260808T091428Z`精确保留。
- 仅recreate Web；未运行Migration，PostgreSQL、Worker、Caddy容器身份未更换，四个受保护Volume名称和mountpoint未变化。HTTPS/直接health和连续60秒`7/7`通过；四服务restart 0、OOM false。

## Git、资源与清理

- 严格起点：唯一worktree、clean `main@a67886428570612b21bc372a0a2a53fe90eac439`，Parent `e67c9209bc24314000f70760b7b79282c4a9b469`，behind0/ahead173。
- 功能提交：`bdb4fd07e76e405f418833aeaf5b0c9c4b5e5ae7`，`feat: add restricted PO history traceability`。部署/验收/文档由独立`ops: deploy PO history traceability fix`提交收口；未push、未PR、未amend/rebase/reset或改写历史。
- 起点资源约available 1.9GiB、Swap 238MiB、根盘18GiB。收口为available 1.9GiB、Swap 277MiB/1GiB、根盘17GiB、Load `0.09/0.23/0.36`；本任务窗口内核OOM事件0，四服务restart0/OOM false。
- 隔离/恢复数据库、测试容器、独立staging与Playwright临时Volume、Python测试镜像和测试依赖镜像已精确清理；未执行prune。正式dump、当前/候选/回退Web镜像按回退要求保留；四个受保护Volume未删除或修改。

## 下一轮技术条件

当前PO读模型、稳定Line→Plan→queue关系、零下游基线及隔离Fulfillment回归，已提供另立“到货/仓库收货”试用任务的技术前置条件；本任务没有登录warehouse，也没有在主UAT验证任何写路径，因此不构成执行授权或业务验收。开始前仍须新的独立任务和明确授权、重新执行只读门禁与正式备份，并只登录获准warehouse账号；IQC、入库后续处理、AP和付款仍须各自独立授权。

本任务完成后立即停止，未执行到货、收货、IQC、入库或AP。
