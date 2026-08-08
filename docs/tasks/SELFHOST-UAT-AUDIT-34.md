# SELFHOST-UAT-AUDIT-34 Existing UAT PO Provenance and Integrity Audit

## 结论

`UNAUTHORIZED UAT PO WRITE CONFIRMED — DATA PRESERVED`

采用用户定义的分支 B。`PO-00000001` 的关系化来源和 `1/4/4/4` 结构完整、唯一，下游为零；但仓库内最后一个受控任务 `SELFHOST-UAT-FIX-33` 明确以主 UAT `business_post=0`、PO/Line/Plan/queue `0/0/0/0` 收口，成功转换发生在该报告之后，仓库内没有新的转换任务、授权记录或提交能把成功请求绑定到一个获授权执行流。该结论不推断凭据泄露或操作者身份，只表示现有证据不能满足本审计要求的任务授权链。

数据原样保留。本任务没有创建、修改、删除、停用或补偿任何业务记录；不得开始仓库收货、IQC、AP、付款或生产下游，等待项目负责人决定。

## 起点与只读边界

| 门禁 | 结果 |
| --- | --- |
| Git | `main@9a8a3bd8a84bacb2836ac116d3b8a80783e96fe6`；Parent `1f205af0bf81379345a09353d9d32ab5c7545971`；behind 0/ahead 171；唯一 worktree；起点 clean |
| 版本/Migration | `0.1.0-alpha.40`；`0001`—`0039`，head `0039_rfq_traceability.sql`，checksum `3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`；无 `0040` |
| Web | `sha256:83c1bff341294d1bee2db8fd2ee963204012cfac63f1289ba7d3755ca2920664`；StartedAt `2026-08-08 13:08:36`（Asia/Shanghai） |
| 并发 | 审计起点非本连接活跃客户端 `0`、idle-in-transaction `0`、已授予 advisory lock `0`；无并发 Award/PO/履约 runner 或临时容器 |
| PostgreSQL | 所有业务取证均在 `REPEATABLE READ READ ONLY` 事务中，`transaction_read_only=on`，带 statement/lock timeout；查询只覆盖 Award ID 1、目标 PO 和直接谱系 |
| 浏览器 | 数据库来源和结构明确后才登录 purchase；网络守卫只允许 GET/HEAD/OPTIONS 及 Identity LOGIN/LOGOUT，业务非 GET 一律阻断 |

没有读取或输出密码、Token、Cookie、Session 正文、幂等原始 key、请求正文、服务日志正文或非目标业务正文。

## 创建时间线与授权判断

| 时间（Asia/Shanghai） | 事实 |
| --- | --- |
| 2026-08-08 00:08:05.263762 | 历史请求 `f30a7801-1cd0-4849-95a8-9c61d5c52e67`，Audit ID 1482，actor `uat_20260729_purchase`，`SOURCING_AWARD_CONVERTED / failed / AWARD_SUPPLIER_MAPPING_NOT_UNIQUE`。FIX33 报告记录 HTTP 422；数据库 Audit 本身不保存 HTTP status。该请求对应 PO/Link/Plan/Plan Event/PO Event/Idempotency 均为 0。 |
| 2026-08-08 13:08:36 | 当前 FIX33 Web 启动。 |
| 2026-08-08 13:28:01 | `ops: deploy Award to PO mapping validation fix` 提交完成；权威报告仍声明主 UAT `preview_get=1`、`business_post=0`、PO/Line/Plan/queue `0/0/0/0`，正式转换须新授权。 |
| 2026-08-08 14:09:11.181688 | purchase LOGIN success，request `f2b42250-1315-4142-95c9-bd9a4c5838bf`。 |
| 2026-08-08 14:11:45.086372 | 唯一成功转换请求 `773c23b6-0923-4ab5-a451-bb80aa4bdf9d` 原子创建 PO/Line/Plan/queue。比 Web 启动晚约 1 小时 3 分，比 FIX33 运维提交晚约 43 分 44 秒。 |
| 2026-08-08 14:14:51.088962 | purchase LOGOUT success，request `6ffd6655-8a53-4672-959c-119dcc848061`。 |

判断：

- 实际创建 PO 的请求是 `773c23b6-0923-4ab5-a451-bb80aa4bdf9d`，不是历史失败请求。
- 数据库 actor 确为 `uat_20260729_purchase`；成功写入位于一次该账号 LOGIN/LOGOUT 时间窗内。
- 关系化记录没有 session ID、浏览器实例、User-Agent、runner 名称或任务编号，无法把成功请求绑定到明确的浏览器/任务授权链。
- 写入表现为正常受保护 HTTP 合同：purchase actor、正式 endpoint、LOGIN/LOGOUT 时间窗、Audit、Idempotency 和单事务对象计数一致。但这同样可能由浏览器自动化或误连主库的 runner 产生，现有关系化证据不能排除，也没有证据证明发生过隔离 runner 误连；数据库没有持久化可供本审计独立证明的 CSRF 校验事实。
- 没有部署自身写入的证据：Web 在写入前约一小时已启动，未运行 Migration；转换 Audit 明确归于 purchase actor。审计起点没有并发执行流，成功 request 下也没有其他业务 Audit 或生产写入。
- Award ID 1 只有一个 SUCCESS Audit、一个 SUCCESS request 和一个 201 Idempotency 结果；只成功转换一次。

## PO 聚合

| 字段 | 权威值 |
| --- | --- |
| 稳定 ID / 编号 | `1` / `PO-00000001`；编号计数 1，Award 关联 PO 计数 1 |
| Version / 状态 / 来源 | `v1` / `OPEN` / `SOURCING_AWARD` |
| Award / RFQ / PRQ / MRP / Project | Award `1/v1`；RFQ `1 / RFQ-00000001 / v7`；PRQ `1 / PRQ-00000001`；MRP `1`；Project `1 / PRJ-00000001` |
| Supplier | `1 / SUP-000001 / UAT快速交付供应商A-042576` |
| 币种/税运费/付款条件 | `CNY`；获选 Quote `1/v1` 为未税、运费不含；`纯虚拟UAT付款条件，仅用于表单验收。`。这些商业口径来自获选 Quote，PO Header 没有独立税/运费/付款条件列 |
| 数量/金额 | 订购 `40.000000 PCS`；已收 `0.000000 PCS`；四行合计 `480.000000 CNY` |
| 计划日期 | `2026-10-20` |
| 创建 | `uat_20260729_purchase`；`2026-08-08 14:11:45.086372`；request `773c23b6-0923-4ab5-a451-bb80aa4bdf9d` |
| 备注 | 实际为 `纯虚拟UAT采购订单,仅用于黑盒验收,不对应真实采购。`；语义为纯虚拟 UAT，但两个逗号是半角，**不等于**任务要求的全角原文 `纯虚拟UAT采购订单，仅用于黑盒验收，不对应真实采购。` |

PO Header `operation_id=ee488976-88e2-4ec5-a261-9fe18f788adc`。唯一 Source Link、四条 Award→PO Line Link 和成功 Audit 共享转换 `operation_id=ac0638af-3263-4c3d-93c0-7327033ce71c`。模型没有独立的“转换操作”聚合表；API 201 摘要把这次共享操作计为 `conversion_operation_count=1`，不能把共享 UUID 误称为独立业务记录。

## Audit、Event 与 Idempotency

- Audit ID `1491`：`SOURCING_AWARD_CONVERTED / success / PROCUREMENT`，object ID `1`，actor、时间、request 与 PO 完全一致；`old_version/new_version` 为空，因为转换不更新 Award/RFQ CAS。
- 幂等作用域为 `POST /api/procurement/awards/1/purchase-orders`；这是关系化元数据保存的成功 endpoint/action，不从服务日志或请求正文推断。
- Idempotency key digest：`214d55782672b8e03da9ed80a983ea31572b9ae367b89e2d4a8f2df385b3df2d`。
- Input request digest：`7afef61364304b15c4cb313d708aa2dd0cbef3bc47f44bb65ef028ef8e6c527a`。
- 201 结果摘要：转换操作 1、PO 聚合 1、PO Line 4、Delivery Plan 聚合 4、独立 Delivery Plan Line 0、receiving queue 4。
- 转换没有单一持久化 `scope_digest` 列；范围由四条不可变 Award Link `source_digest`、固定 Mapping fact 和请求摘要共同证明。未读取或输出请求正文或幂等 response 正文。
- PO Event ID `1`：`CREATED`，`null→OPEN`，同 actor/request/time；Event 表没有独立 `result` 列，SUCCESS 结果由同事务 Audit 证明。
- Delivery Plan Event ID `1`—`4`：各一条 `CREATED`，`null→PENDING`，同 actor/request/time。转换没有额外 `procurement_sourcing_events` 行。

## 四条 PO Line 完整谱系

四条均为 PO Line `v1/OPEN`、Supplier 1、Unit `1/PCS`、订购 `10.000000`、单价 `12.000000`、金额 `120.000000 CNY`、已收 0、计划日 `2026-10-20`。Supplier B 行数 0，Material 去重数 4，无第五行。

| PO Line | Award Line / RFQ Line | Comparison / Candidate | Quote / Quote Line | Binding / Mapping fact | Material | Mapping UUID | Link source digest |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 / 1 | 1/v1 / 2 | 1/v1 / 1 | 1 / 1/v1/row CAS 3 | 533 / `CYD-RB_PCB-000016` | `224d1965-44ef-4c3e-901e-1926b6b07ff8` | `7eb20cade6244abd8948be098f3018668030e2025b2a487f2960028cfeff1096` |
| 2 | 2 / 2 | 2/v1 / 4 | 1/v1 / 2 | 2 / 2/v1/row CAS 3 | 534 / `CYD-RB_SENSOR-000003` | `43ca04d8-9933-4dac-ba21-b7fb85741830` | `4f6ca69a9aac7dfa739345af90740d0f5a394a2fd4e839061714b8d6a7585213` |
| 3 | 3 / 3 | 3/v1 / 6 | 1/v1 / 3 | 3 / 3/v1/row CAS 3 | 535 / `CYD-RB_CONN-000075` | `aa16f7e7-904d-4ae2-9f73-d34e7aaf257e` | `a2cfa549f9d713974c25a884146221df68e8c1c0330af12eb17e10cdf3b07c4f` |
| 4 | 4 / 4 | 4/v1 / 8 | 1/v1 / 4 | 4 / 4/v1/row CAS 3 | 536 / `CYD-RB_METAL-000015` | `9659ad2d-406a-4c4c-b575-51329badc63f` | `1700cb936f5db4c3d267bf9531ad293f454cce43db46a1584216a1188983998b` |

四个 Link source digest 已按服务端 `JSON.stringify([...]) → SHA-256` 逐条重算，全部精确一致。Binding 的 Mapping content digest 与当前 fact content digest 逐条一致，PO Line 保存的 `supplier_mapping_id` 也与 Binding fact 一致；数量、价格、Supplier、Material 和 Unit 错配均为 0。

## Delivery Plan 与 queue

| Plan / PO Line / Award Line | Material | 数量/日期 | Plan 状态/CAS/Event | queue |
| --- | --- | --- | --- | --- |
| 1 / 1 / 1 | 533 / `CYD-RB_PCB-000016` | 10 PCS / 2026-10-20 | `PENDING/v1`；Event 1 `CREATED` | ID 1，`OPEN_PENDING/v1` |
| 2 / 2 / 2 | 534 / `CYD-RB_SENSOR-000003` | 10 PCS / 2026-10-20 | `PENDING/v1`；Event 2 `CREATED` | ID 2，`OPEN_PENDING/v1` |
| 3 / 3 / 3 | 535 / `CYD-RB_CONN-000075` | 10 PCS / 2026-10-20 | `PENDING/v1`；Event 3 `CREATED` | ID 3，`OPEN_PENDING/v1` |
| 4 / 4 / 4 | 536 / `CYD-RB_METAL-000015` | 10 PCS / 2026-10-20 | `PENDING/v1`；Event 4 `CREATED` | ID 4，`OPEN_PENDING/v1` |

四个 Plan、四个 Event 和四个 queue 的 actor、时间、request 均与成功转换一致；queue 的 closed 字段为空。每个 PO Line 恰有一个 Plan，每个 Plan 恰有一个 queue；错 PO/Material/Unit/Supplier/数量、重复、孤儿、多重 queue 均为 0。模型没有 `purchase_delivery_plan_lines` 表，因此权威结构为 PO `1`、PO Line `4`、Delivery Plan 聚合 `4`、独立 Plan Line `0`、queue `4`。

## Award、RFQ 与上游不可变性

- Award `1/v1/AWARDED`、四条 Award Line、`award_digest=7ac6bf2eb579b13460d2d0b9496127c4a75cda73efa605e8ec291b4212a66e55` 保持；转换没有改写 Award 内容或 CAS。
- RFQ `1 / RFQ-00000001 / CLOSED / v7` 保持。RFQ 的 `v6→v7` 来自先前 Award request `4634fff1-988d-465b-92c6-34ffe214ddda`，由 Audit ID 1469 `SOURCING_AWARDED / success / old 6 / new 7` 证明；不是本次 PO 转换造成。
- `po_convertible_now=false`；目标待转 Award 数量 0；浏览器不再显示转换入口。Comparison 仍为 Version 1/CURRENT，但 `awardable_now=false`。
- Quote Header/Line `2/8`、Comparison Line/Candidate `4/8`、Binding `8`、Mapping fact `8` 与 FIX33 基线一致。获选四条 Binding/Mapping 仍 ACTIVE、v1/row CAS 3、content digest 一致；Quote 1/2 仍 SUBMITTED/v1。没有转换 request 对应的上游 Event 或 CAS 变化。

## 下游零写入

仅沿目标 PO 外键、目标 receipt 链和成功 request_id 计数：

| 下游 | 数量 |
| --- | ---: |
| Purchase Receipt aggregate | 0 |
| Warehouse Receipt line / Delivery allocation / Inventory adjustment | 0 / 0 / 0 |
| Inventory Ledger / Inventory Lot | 0 / 0 |
| IQC | 0 |
| Purchase financial source / project allocation | 0 / 0 |
| AP / Payment | 0 / 0 |
| Work Order / Handoff Work Order Link | 0 / 0 |
| Production Report / Completion | 0 / 0 |

Schema 中没有 Production 表到 PO/PO Line 的直接外键；另对全部 45 个带 `request_id` 的 `production_%` 表按成功 request 精确扫描，非零表为 0。

## 保护指纹与浏览器只读复核

- 浏览器前目标谱系 SHA-256：`12d2c02031f34a5212bec80f5f9a5edcc8b1983fe24b96570f87fb17e2f5af18`。
- 浏览器后目标谱系 SHA-256：`12d2c02031f34a5212bec80f5f9a5edcc8b1983fe24b96570f87fb17e2f5af18`。
- 指纹覆盖 Award/RFQ、Award Lines、Sourcing Events、Quotes、Comparison、Bindings/Mapping facts、PO/Source/Lines/Links/Events、Plans/Events/queue、目标转换 Audit/Idempotency 元数据和下游计数；排除预期新增的 Identity LOGIN/LOGOUT。
- 文档测试后的末端只读门禁再次返回PO/Line/Plan/queue `1/4/4/4`、PO/Plan Event `1/4`、Receipt 0、成功Audit 1、目标Idempotency 1、purchase有效Session 0；事务再次确认`transaction_read_only=on`。
- 桌面 1440×900 与移动端 390×844 均显示唯一 PO、订购 40、已收 0、4/4 行已有计划、PO v1、待转 Award 0，无转换/建计划按钮且无横向溢出。
- 当前页面没有可展开的 PO Detail、Plan 或 Audit 组件。浏览器因此打开只读 `GET /api/purchase-orders/1` 核对 Header、四行和 PO CREATED Event，并读取只读 receiving-queue GET 核对四 Plan/queue；Audit 仅以数据库关系化事实核验，未伪称页面已展示。
- 最终成功 runner：detail GET 2、queue GET 1、`business_post=0`、LOGIN 1、LOGOUT 1、Session 0。整个浏览器阶段因一次 ISO 日期字符串过严断言产生两组 LOGIN/LOGOUT；两组均安全退出，数据库窗口内 Identity LOGIN/LOGOUT 为 2/2、非 Identity Audit 0、最终有效 Session 0。

## 资源、清理与 Git

- 起点：Mem available 约 2.1 GiB，Swap 235 MiB/1.0 GiB，根盘可用 18 GiB，Load `0.13/0.20/0.17`。
- 浏览器后：Mem available 约 1.8 GiB，Swap 237 MiB/1.0 GiB，根盘可用 18 GiB，Load `0.61/0.19/0.12`；未触发任何资源停止条件。
- 文档测试后：Mem available 约 1.9 GiB，Swap 237 MiB/1.0 GiB，根盘可用 18 GiB，Load `0.07/0.12/0.09`。
- Web/Worker/PostgreSQL/Caddy 均 restart 0、OOM false；当前启动内核 OOM 记录 0。
- 任务浏览器 runner 的失败尝试均使用 `--rm`：一次因未传 stdin 未启动脚本，一次在导入阶段发现镜像缺 Node package、一次因 ISO 日期字符串断言过严而在保护退出后停止；最终规范化日期后通过。匹配运行库只装在容器 tmpfs；最终任务容器、临时目录、测试库、网络和持久文件均为 0，未 prune，四个受保护卷未改。
- 文档-only适用基线以项目既有`/opt/erp/.venv`串行通过：`server.py --self-test`、`smoke_test.py`、临时SQLite且`--no-backup`的`go_live_check.py`。第一次误用系统Python执行smoke时因缺少`openpyxl`在导入阶段停止，未启动临时服务或数据库；切回项目环境后通过，未安装或变更依赖。三项均未连接主UAT。
- 本任务不修改代码、Migration、部署配置、镜像或业务数据。只更新本报告及 `MASTER.md`、`TASKS.md`、`STATUS.md`、`CHANGELOG.md`，并创建一个聚焦文档提交；不 push、不建 PR、不改写历史。

## 放行状态

不可以开始下一轮仓库收货/IQC。项目负责人必须先对未经任务授权证明的 PO 写入作出书面决定；若决定保留并追认，也必须另立任务重新核验当前 PO/Plan/queue CAS、零收货、Supplier Lot、库存版本、IQC 权限和备份恢复边界。本审计不构成追认。
