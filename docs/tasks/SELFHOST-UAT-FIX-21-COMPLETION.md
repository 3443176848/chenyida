# SELFHOST-UAT-FIX-21 完成报告

最终状态：`SUPPLIER MAPPING APPROVAL SAFEGUARDS DEPLOYED — UAT 1 ACTIVE 7 PENDING`

完成时间：2026-08-05（Asia/Shanghai）

## 1. 结论与范围

operations Supplier Mapping 审核保护已部署到自托管并行非生产 UAT。批准入口现在先读取服务端零写审核预览，再打开确认窗口；审核意见为独立必填字段，确认前再次核验 Version/CAS、来源状态和冲突。批准成功或历史详情均由持久事实重新投影完整凭证。

本任务采用分支 A：没有新增 0039，没有修改 0001—0038，版本保持 `0.1.0-alpha.39`。主 UAT 只进行了 operations-only 只读验收，业务 POST 为 0；唯一既有 ACTIVE 未撤销、重做或补写，剩余七条未批准或退回，RFQ/Quote/Award/PO 均未创建。

## 2. 严格起点

- Branch `main`，HEAD `2d0cf5f033cad724bf2215e77e4fda953a499cd4`，短 SHA `2d0cf5f`，origin/main...HEAD 为 behind 0/ahead 140，tracked 工作区 clean。
- 源码版本 `0.1.0-alpha.39`；Migration `0001`—`0038`，head `0038_supplier_mapping_governance.sql`，SHA-256 `2da259364151af098641795da55604dc3012b6adf92aec67038c0554e0592941`。
- Web 镜像 `sha256:c1576bd22a209fb6f524e304bcf12cc38af4d67a35c76f37fa8dc1311c2922c8`；PostgreSQL/Web healthy，Worker/Caddy running，四服务 RestartCount 0、OOM false。
- 起点约 2.2 GiB available、Swap 288 MiB/1 GiB、根盘可用约 20 GiB、Load `1.97/0.97/0.43`；没有未知修改或并发重任务。
- 主 UAT 起点为 Mapping 8、ACTIVE 1、PENDING_REVIEW 7、REJECTED 0；RFQ/Quote/Award/PO 0/0/0/0；`PRQ-00000001` 为 ACCEPTED；剩余七条均为 Mapping Version 1、CAS 2。

## 3. 权威模型诊断、审核意见与 0039 结论

既有 0038 模型已足以关系化保存批准事实：不可变 `supplier_mapping_events` 保存 mapping/version、event type、actor、occurred_at、request_id、result、终态和通用可空 `reason`；同 request_id 的成功 `audit_log` 保存批准前后 CAS。`supplier_mappings` 保存当前稳定正文、Mapping Version、CAS、终态及 Supplier/Material 外键。

- APPROVE 的独立 `review_comment` 原样保存到对应 `APPROVED` Event 的 `reason`。
- `supplier_mappings.review_reason` 继续只表示退回原因；批准时保持空字符串，不复用或混淆退回语义。
- 成功/历史凭证由当前 Mapping、不可变 APPROVED Event 和同 request_id 的成功 Audit 投影，不依赖浏览器临时状态。
- 旧 APPROVED Event 允许意见为空，不做伪造回填；UI 固定如实显示“历史批准未采集审核意见”。
- 因此未新增 0039，也没有 0039 SHA；数据库 head 仍为 0038，上述 0038 SHA 保持不变。决定记录于 D-094。

## 4. 预览与冲突权威来源

审核预览在 repeatable-read/read-only 事务中重新读取服务端事实：

- Mapping、Version/CAS、Supplier/Material 稳定外键、supplier part、Unit、整数换算和有效期来自 `supplier_mappings` 及关系化 Unit。
- Supplier 当前 ACTIVE 状态来自 `suppliers.status`；Material 当前 ACTIVE 状态和正式编码来自 `material_master.material_status` 与 `internal_material_code`。
- 创建/提交 actor、时间、request_id 和 SUCCESS 语义来自不可变 `supplier_mapping_events` 及对应成功 Audit。
- 同 Supplier/Material 的当前 ACTIVE 冲突来自 `supplier_mappings` 的 ACTIVE、同稳定外键及有效期重叠查询。
- 同 Supplier 内 `supplier_part_number` 稳定占用来自 `supplier_mapping_supplier_part_keys`，并与当前 Mapping 关系核对。
- 是否可批准由来源 ACTIVE、正文完整、稳定占用、ACTIVE 冲突、expected_version/CAS 和当前 PENDING_REVIEW 状态共同决定；失败返回稳定错误和中文处理建议，不发送 APPROVE。

预览同时明确批准后 Mapping Version 不变、CAS 单步推进、终态 ACTIVE，可用于后续 RFQ 覆盖校验，但不会自动创建 RFQ、Quote、Award、PO 或其他下游事实。预览成功与失败均不写业务记录或失败 Audit。

## 5. 确认窗口、凭证和列表

- “批准并生效”首次点击只打开确认窗口，不写业务；窗口完整显示 Mapping、Supplier、Material、料号、Unit/换算、有效期、provenance、冲突和推进语义。
- 审核意见是独立必填字段，最大 500 字；默认焦点位于意见输入而非确认按钮。取消、关闭和 ESC 均为零业务请求。
- 确认按钮同步禁用并有前端单次提交锁；确认前再次 GET 预览，随后批准事务继续执行权限、自审、状态、来源、claim、ACTIVE 冲突、正文摘要、CAS、幂等和故障回滚核验。
- 成功凭证显示 Mapping ID、APPROVE、actor、Asia/Shanghai 时间、request_id、SUCCESS、意见全文、前后 Mapping Version/CAS、最终 ACTIVE、稳定 Supplier/Material、supplier part、Unit/换算和有效期；刷新、重登和 Web 重启后可重新打开。
- operations 列表可按状态、Mapping ID、Supplier ID/编码/名称、Material ID/正式编码/名称和 supplier part/后缀筛选；展示 Version/CAS、双方当前状态、ACTIVE 冲突和创建/提交/审核 provenance。待审核、已生效、已退回可区分，桌面和 390×844 无页面级横向溢出。

## 6. 权限、安全与事务保护

purchase 仍不能批准或退回，operations 仍不能编辑正文，创建人仍不能自审，未授权角色仍返回 403；ACTIVE 仍禁止原地修改或再次批准。CSRF、Origin、限流、幂等键与正文摘要、CAS、并发单胜和单事务 Event/Audit/Idempotency 保护未降低。审核意见不写入不必要日志；故障注入保持零半记录。

## 7. 旧 ACTIVE 真实批准凭证

以下为部署前、恢复副本、部署后和最终只读保护脚本共同核验的真实持久事实；没有补写任何字段：

| 字段 | 真实值 |
| --- | --- |
| Mapping ID | `224d1965-44ef-4c3e-901e-1926b6b07ff8` |
| 决策/结果/终态 | APPROVE / SUCCESS / ACTIVE |
| Actor | `uat_20260729_operations` |
| Asia/Shanghai 时间 | `2026-08-05 09:34:45.436464` |
| request_id | `b38c84b9-29a1-47ab-b68b-a6baf56e7121` |
| 审核意见 | 持久字段为空；页面显示“历史批准未采集审核意见” |
| 前后版本 | Mapping Version 1 / CAS 2 → Mapping Version 1 / CAS 3 |
| Supplier | ID 1 / `SUP-000001` / Supplier 1 |
| Material | ID 533 / `CYD-RB_PCB-000016` |
| supplier_part_number | `UAT-A-PCBA-042576` |
| Unit/换算 | PCS → PCS / 1:1 |
| 有效期 | 2026-08-05 起，无失效日 |
| 创建/提交人 | `uat_20260729_purchase` |

## 8. 自动测试

- Supplier Mapping：Unit `6/6`、UI `5/5`、隔离 PostgreSQL `10/10`、既有 0038 Migration `5/5`、隔离 Chromium `1/1`。
- 隔离 PostgreSQL 覆盖 purchase 创建/提交、operations 零写预览、来源 ACTIVE、两类冲突、正常 APPROVE 单事件、意见持久、Version/CAS、幂等同正文/异正文、并发单胜、CAS 过期、自审/越权 403、故障回滚、零下游和旧空意见兼容。
- 隔离 Chromium 覆盖打开/取消、ESC/关闭零写、正式批准一条隔离 Mapping、双击单事件、凭证刷新/重登/Web 重启保持、桌面/390×844及安全退出；最终隔离事实为 Mapping 8、ACTIVE 1、PENDING 7、APPROVED Event 1、下游 0、Session 0。
- 适用回归：Procurement Sourcing/FIX-19 PostgreSQL `5/5`、Identity PostgreSQL `10/10`；npm `3/3`、Identity Unit/UI `9/9 + 10/10`、Master Unit/UI `2/2 + 6/6`、Sourcing Unit/UI `6/6 + 4/4`、CSRF/Origin `11/11`。
- typecheck、38/38 Migration checksum/Schema consistency、production build/postbuild、credentials scan 和 `git diff --check` 通过；完整 lint 为 0 error、10 个既有 warning。
- Python 基线 `server.py --self-test`、`smoke_test.py`、临时 SQLite `go_live_check.py` 均通过。

没有降低断言、跳过失败或修改 0001—0038。隔离 Chromium 首次诊断发现测试数据库的 Migration ledger fixture 缺少既有 `applied_at`，在业务操作前失败；fixture 对齐生产 Schema 后 PostgreSQL 和 Chromium 均重新完整通过。

## 9. 备份、恢复与部署

- 正式 predeploy backup：`/var/backups/chenyida-erp/supplier-mapping-fix21-predeploy-20260805T031625Z.dump`。
- 权限/大小：root:root、0600、2,227,987 bytes。
- SHA-256：`fb14cf1ba9220ca8eafd564eb673b62cacd5ac2db92bf928e8fec99222e77f71`。
- `pg_restore --list` 通过，共 3,306 项。
- 第二新空库恢复通过：38/head 0038、225 张 public 表、1 ACTIVE / 7 PENDING、完整业务指纹一致；恢复数据库随后精确删除。因采用分支 A，无 0038→0039 升级。
- production candidate build/postbuild 通过，Web 镜像为 `sha256:c98d3e8aeef8087d9daa951d0f0c3c7ceb97307edd2d13e92c582c42935f3978`，88,509,325 bytes。
- 仅替换 Web，没有运行 Migration，没有重建 PostgreSQL/Worker/Caddy或更换 Volume。旧 Web 镜像保留为 `chenyida-erp-parallel-web:rollback-approval-safeguards-fix21-predeploy-20260805T031959Z`。
- 部署后 Web/PostgreSQL healthy，Worker/Caddy running；四服务 RestartCount 0、OOMKilled false。

## 10. 主 UAT 只读验收与保护指纹

脱敏保护指纹在部署前、备份恢复副本、部署后、主 UAT 前后及最终清理后始终为：

`2562f52e82eebbede265e367a5e13e31aa13ab34b5fee16b279d074b10266cd8`

operations-only 最终只读 Chromium 验收通过：默认显示七条待审核；打开一条 PENDING 的完整批准预览，核验独立审核意见后点击取消；重开唯一 ACTIVE 的真实凭证并看到历史空意见提示；状态、supplier part 后缀、Mapping ID、桌面和 390×844 均通过；最后安全退出。

首次只读 runner 在打开任何预览前，因测试断言预期旧卡片文案 `V1 · CAS2`，而已部署页面显示更完整的 `Version 1 · Version Fact #2 · CAS2`，安全停止并在 finally 撤销 Session；指纹不变。断言收紧为实际完整文案后复验通过，没有降低产品断言。

最终证据：

- 业务 POST：0。
- Mapping：总数 8、ACTIVE 1、PENDING_REVIEW 7、REJECTED 0。
- Event：CREATED 8、SUBMITTED 8、APPROVED 1。
- `PRQ-00000001`：ACCEPTED。
- RFQ/Quote/Award/PO：0/0/0/0。
- 有效 Session：0。
- 唯一 ACTIVE 和剩余七条 Version/CAS/状态均未改变。

## 11. Git、资源与清理

- 功能提交：`a86d9adceefb45efca1c43f1f8475703e8fa943d`（`fix: add supplier mapping approval confirmation`）。
- 部署/文档提交：`ops: deploy supplier mapping approval safeguards`；实际 SHA 以 `git log` 为准。
- 未 push、创建 PR、amend、rebase、reset、stash 或 restore；未提交凭据、数据库、备份、日志或 Session 数据。
- 起点→终点：available memory 约 2.2→1.9 GiB；Swap 288→251 MiB；根盘可用约 20→20 GiB；Load `1.97/0.97/0.43`→`0.06/0.17/0.25`。
- 任务窗口内内核 OOM 0；最终四服务 RestartCount 0、OOMKilled false。Web/PostgreSQL healthy，Worker/Caddy running。
- 两个 FIX-21 隔离数据库、standalone/Playwright 临时目录和临时容器均已精确清理为 0；没有执行 Docker system prune、Volume prune 或全局缓存清理。
- 四个受保护 Volume 全部保留；正式备份、当前镜像和精确回退镜像保留。

最终清理后的额外指纹核验第一次因运行镜像不包含脚本、第二次因精简镜像不包含 `pg` 包，均在模块加载阶段、建立数据库连接前停止；使用同一具名 `--rm` 容器只读挂载脚本和仓库既有依赖后，repeatable-read/read-only 核验通过，容器无残留。

## 12. 是否可以继续批准剩余七条

技术保护和页面流程已就绪，但本任务不授权继续批准或退回剩余七条。任何后续决定必须另立任务并取得新的明确业务授权；批准时仍需逐条核验预览并填写真实审核意见。本任务不授权创建 RFQ、Quote、Award、PO 或其他下游事实。

本任务到此立即停止。
