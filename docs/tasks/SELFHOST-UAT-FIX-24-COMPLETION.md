# SELFHOST-UAT-FIX-24 完成报告

## 结论

`RFQ BINDING IDENTIFIERS DEPLOYED — UAT RFQ STILL DRAFT`

RFQ 详情和发出确认现已公开 0039 中真实、独立的 Binding 主键，并用唯一成功的 `RFQ_MAPPING_CONFIRMED` Event、八条不可变 Binding 和固定范围摘要组成可重新打开的固定凭证。主 UAT 仅执行 purchase 登录、详情/凭证读取、桌面与 390×844 发出窗口打开后取消及安全退出；没有再次固定 Mapping、发出 RFQ、录入 Quote、定标或创建 PO。

## 严格起点与保护边界

- 起点为 clean `main@3bea653`，Parent `f919890`，`origin/main...HEAD` behind 0 / ahead 146；版本 `0.1.0-alpha.40`，Migration `0001—0039`。
- 0039 SHA-256 保持 `3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`；起点 Web 为 `sha256:5fe406949d4678d5beb06ba6db4d931f88f5f24989332654b557b8a4f9df6e4b`。
- 起点主 UAT 为 RFQ ID 1 / `RFQ-00000001`、Round 1、DRAFT v2、Binding 8、`RFQ_MAPPING_CONFIRMED` 1、`RFQ_ISSUED` 0、Quote/Award/PO 0/0/0；固定摘要和 request_id 与任务指定值完全一致。
- 部署前、恢复副本、部署后及最终 UAT 后的保护指纹均为 `9c7b43774e1d0562785933729d40329a69a3230b5b1580473ac29a2463037d3f`。指纹覆盖 RFQ、八条 Binding、Event、Audit/幂等凭证、Quote/Award/PO及采购、库存、财务、生产全部下游。

## Binding 真实主键模型

- 0039 表 `procurement_rfq_supplier_line_mapping_bindings` 已定义 `id bigserial PRIMARY KEY NOT NULL`；运行时类型为 PostgreSQL `bigint`，默认值来自独立 sequence。主键同时保证非空和全表唯一，因此它是数据库持久、稳定且可独立引用的 Binding ID。
- 表上另有 Supplier×Line 等业务唯一约束，但这些复合键不是 Binding ID；数组序号、组合索引、哈希截断和临时拼接均未使用。
- 旧写路径的 `returning *` 和内部查询可以得到通用 `id`，但 Repository、显式 DTO、Handler 合同和 UI 没有将其命名并公开为 `binding_id`。本任务新增 `RfqBindingDto`，Repository 显式投影 `b.id::text AS binding_id`，避免 JavaScript bigint 精度损失，再贯通 Service、Handler 和 UI。
- 采用分支 A：**没有新增 0040**，故 0040 SHA 不适用；没有修改 `0001—0039`、Schema、既有八条 Binding 或任何业务记录，版本保持 alpha.40。

## 主 UAT 八条 Binding

页面按 Supplier code、Material code、Binding ID 确定性排序；刷新、重新登录和 Web 重启后顺序与 ID 均保持：

| Binding ID | RFQ Line ID | Supplier ID / 编码 | Material ID / 正式编码 | Mapping ID | Version |
| --- | ---: | --- | --- | --- | ---: |
| 3 | 3 | 1 / `SUP-000001` | 535 / `CYD-RB_CONN-000075` | `aa16f7e7-904d-4ae2-9f73-d34e7aaf257e` | 1 |
| 4 | 4 | 1 / `SUP-000001` | 536 / `CYD-RB_METAL-000015` | `9659ad2d-406a-4c4c-b575-51329badc63f` | 1 |
| 1 | 1 | 1 / `SUP-000001` | 533 / `CYD-RB_PCB-000016` | `224d1965-44ef-4c3e-901e-1926b6b07ff8` | 1 |
| 2 | 2 | 1 / `SUP-000001` | 534 / `CYD-RB_SENSOR-000003` | `43ca04d8-9933-4dac-ba21-b7fb85741830` | 1 |
| 7 | 3 | 2 / `SUP-000002` | 535 / `CYD-RB_CONN-000075` | `3ac2ab72-c0dc-4fcf-b1dc-b21e43c3c0d6` | 1 |
| 8 | 4 | 2 / `SUP-000002` | 536 / `CYD-RB_METAL-000015` | `5432e7fc-463a-4cea-99fe-f3db8cf0af83` | 1 |
| 5 | 1 | 2 / `SUP-000002` | 533 / `CYD-RB_PCB-000016` | `45a3daf1-4e97-4a01-a94d-1f3089d3961b` | 1 |
| 6 | 2 | 2 / `SUP-000002` | 534 / `CYD-RB_SENSOR-000003` | `5bd2ced5-6696-4e69-a833-e886cf5e273f` | 1 |

每张卡片独立显示 RFQ ID、RFQ Line ID、Supplier ID/编码/名称、Material ID/正式编码/名称、Mapping ID/Version、supplier part、Supplier/Internal Unit、1:1 换算、有效期、固定/当前 Mapping 状态、状态/版本漂移和固定摘要归属；Binding ID、Mapping ID、RFQ Line ID 与 Material ID 的标签互不混用。

## Mapping 固定凭证与发出确认

- 独立可重新打开的“Mapping 固定凭证”来自 Event ID 1：`RFQ_MAPPING_CONFIRMED`，actor `uat_20260729_purchase`，时间 `2026-08-05 22:50:42.192964（Asia/Shanghai）`，request_id `52ed7a96-3a78-46e2-8ed8-2a1b4076a6e7`，result `SUCCESS`，`v1 → v2`，Binding 8，固定摘要 `9765f8fdef768335a25b314867dd3e077429a84848cba067ff8394c8a017848d`，并列出八个稳定 ID和不可变快照说明。
- 发出窗口同时显示 RFQ ID/编号/Round/v2/DRAFT、创建成功 Audit、上述完整 Event、八个 Binding ID及各自 Mapping ID/Version、四条 Material、两家 Supplier、截止日 `2026-08-31`、币种 CNY、状态/版本漂移检查和发出后范围/报价/零自动下游说明。
- 主 UAT 的完整凭证使确认按钮可用，但桌面和 390×844 均只点击“取消”。缺少、重复、跨 RFQ Binding，或 Event/摘要/范围未验证时，UI 禁用确认；正式 POST 仍重新验证 CAS、数量、摘要、Mapping/状态漂移、PRQ、截止日和数据域，并以稳定代码、中文提示和 request_id 失败关闭。
- 详情与发出预览在 repeatable-read/read-only 事务中读取，隔离测试与主 UAT 均证明零业务写；purchase 权限、RFQ/PRQ 对象范围、403、CSRF、Origin、幂等、并发和回滚保护未放宽。

## 自动测试

- Unit/UI：`8/8 + 9/9`；覆盖真实 ID贯通、标签区分、稳定排序、完整凭证、发出窗口、缺 ID禁用和 390px。
- 隔离 PostgreSQL：`20/20`；覆盖 2×4 稳定唯一 ID、诱饵不泄漏、刷新/重启稳定、GET零写、正式发出复用同八条 Binding、缺失/重复/跨 RFQ阻断、幂等/CAS/并发/故障回滚和零自动 Quote/Award/PO。
- 隔离 Chromium：`2/2`；覆盖详情/凭证、取消零写、正式隔离发出沿用相同八条 Binding、重启、390px和 Session 清理。
- Migration/回归：0039 `6/6`、0018 upgrade `3/3`、Material Requirement `18/18`、`npm test` `3/3`、environment guard `6/6`；因分支 A 无 0040 测试。
- 静态/构建：procurement-sourcing typecheck、Schema consistency、最终 production build/postbuild、1,226 文件凭据扫描、`git diff --check` 均通过；lint 0 error / 11 个既有 warning。`db:generate` 只重现 FIX-23 已记录的两个 Supplier Mapping CHECK 表限定化语义漂移，临时 0040 已删除，正式树没有 0040。
- Python：`server.py --self-test`、`smoke_test.py`、`go_live_check.py` 三项通过；host Python 缺 `openpyxl` 后改用仓库既有 `.venv` 完成 smoke，不修改依赖或降低断言，临时 SQLite 已清理。
- 首次主 UAT 在逐卡核验时发现 Supplier 编码/名称只在分组头而非每张卡片，runner安全停止且自动 logout；指纹和 Session 复核无变化。补齐卡片字段、增加 UI 合同并重建 Web 后，最终主 UAT完整通过。

## 备份、恢复与部署

- 备份：`/var/backups/chenyida-erp/rfq-binding-identifiers-fix24-predeploy-20260805T160836Z.dump`，root:root、0600、单硬链接、2,284,331 bytes，SHA-256 `e937d7bcabbc78cc415dacf8565a58e7255724997b9332834acff8d5ec705ab6`。
- `pg_restore --list` 为 3,359 行；第二新空库恢复后为 39/head 0039、226 张 public 表，八条 Binding ID、全部业务事实和保护指纹与主库一致。恢复库已删除，正式备份保留。
- 无 Migration，仅 Web-only 替换：`sha256:5fe406949d4678d5beb06ba6db4d931f88f5f24989332654b557b8a4f9df6e4b` → `sha256:315f0b7945a7b3eb27841ffaae8a444fba45dd94791519dc856173a95d830635`（88,545,226 bytes）。旧 Web 精确保留为 `rollback-rfq-binding-identifiers-fix24-predeploy-20260805T160836Z`。
- PostgreSQL、Worker、Caddy 未重建，四个受保护 Volume 未更换；内外 health 通过，四服务 RestartCount 0、OOMKilled false。

## 主 UAT 最终只读结果

- purchase-only runner 返回：`binding_ids=3,4,1,2,7,8,5,6`、`mapping_event=1`、`receipt=SUCCESS`、`issue_cancel=2`、`business_post=0`、desktop 1、mobile 1、Session 0。
- 最终 RFQ ID 1 / `RFQ-00000001` 仍为 Round 1、DRAFT v2、Binding 8；`RFQ_MAPPING_CONFIRMED` 1、`RFQ_ISSUED` 0、Quote/Award/PO 0/0/0及全部下游 0。固定摘要、Event、request_id和保护指纹均未改变。

## Git、资源与清理

- 功能提交：`e329931`，`fix: expose rfq binding identifiers`。修正版最终镜像、部署、主 UAT、清理和文档由独立 `ops: deploy rfq binding traceability` 提交收口；实际 SHA 以 `git log` 为准。未 push/PR、amend、rebase、reset、stash 或 restore。
- 最终部署前检查约 available memory 2.2 GiB、Swap 284 MiB、根盘可用 18 GiB、Load `0.47/0.59/0.44`；最终为 2.2 GiB、Swap 283 MiB、根盘 19 GiB、Load `0.19/0.48/0.44`。任务窗口内核 OOM 0，四服务 RestartCount 0、OOMKilled false。
- 隔离测试库、第二恢复库、临时容器、Playwright runtime、临时 SQLite和两个过期候选镜像均已精确清理；未 prune。正式备份、当前/精确 rollback Web 镜像和四个受保护 Volume 保留。

## 是否可以正式发出 RFQ

当前固定凭证完整，八条 Binding和 Mapping ID/Version 一致，主 UAT 发出窗口的状态/版本漂移为 0且 `confirmReady=true`，因此技术门禁已经具备正式发出条件。但**本任务不授权发出**；是否正式发出必须在新的明确授权任务中重新读取当前 CAS、Binding、摘要、Mapping、PRQ和截止日后决定。本任务到此停止，不发出、不录报价、不定标。
