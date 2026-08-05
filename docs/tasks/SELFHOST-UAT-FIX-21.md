# SELFHOST-UAT-FIX-21 — 补齐供应商映射审核确认、审核意见和成功凭证

## 状态与唯一范围

- 状态：`DONE`
- 开始时间：2026-08-05 09:52 CST（Asia/Shanghai）
- 完成时间：2026-08-05 11:29 CST（Asia/Shanghai）
- 负责人：Codex（严格门禁、权威模型诊断、审核预览/确认/凭证、隔离测试、备份恢复、自托管 UAT Web 部署、主 UAT operations-only 只读验收、文档与独立提交）；项目负责人（固定部分批准事实、部署与只读验收授权）
- 依赖：`SELFHOST-UAT-FIX-20`、`SELFHOST-OPS-OPERATIONS-BROWSER-VERIFICATION-14`、D-003、D-040、D-045、D-046、D-061、D-079、D-080、D-082、D-091
- 唯一范围：只修复自托管 Vinext/Node.js/PostgreSQL 运行面的 operations Supplier Mapping 审核体验与可追溯性，包括服务端审核预览、批准确认窗口、独立必填审核意见、成功/历史凭证和列表筛选。
- 明确禁止：不批准或退回剩余七条主 UAT Mapping，不撤销或重做已批准 Mapping，不补写历史审核意见，不创建 RFQ/Quote/Award/PO，不修改历史 Sites/D1 或 Python/SQLite 业务逻辑，不改写 `0001`—`0038`，不 reset/stash/restore/rebase/amend/push/PR。

## 必读材料

- `/opt/erp/AGENTS.md`
- `docs/project/MASTER.md`
- `docs/project/TASKS.md`
- `docs/project/PROJECT_CONTEXT.md`
- `docs/tasks/SELFHOST-UAT-FIX-20.md`
- `docs/tasks/SELFHOST-UAT-FIX-20-COMPLETION.md`
- `docs/material-master/supplier-mapping-governance-v1.md`
- `docs/project/DECISIONS.md` 中 D-091 及其依赖决定
- operations 黑盒部分批准事实：以项目负责人本任务指令为报告基线，并由 PostgreSQL 不可变 Mapping/Event/Audit 事实逐项复核；仓库内没有另存一份同名报告。

## 严格起点

- Branch：`main`；HEAD：`2d0cf5f033cad724bf2215e77e4fda953a499cd4`；`origin/main...HEAD` behind 0 / ahead 140。
- tracked/untracked 工作区 clean；无嵌套 Git 仓库、额外 worktree、其他 DOING 或并发 build/test/Migration。
- 源码版本 `0.1.0-alpha.39`；Migration `0001`—`0038`，0038 SHA-256 `2da259364151af098641795da55604dc3012b6adf92aec67038c0554e0592941`。
- Web 镜像 `sha256:c1576bd22a209fb6f524e304bcf12cc38af4d67a35c76f37fa8dc1311c2922c8`；Web/PostgreSQL healthy，Worker/Caddy running，四服务 RestartCount 0、OOMKilled false。
- 起点资源：available memory 约 2.2 GiB，Swap 288 MiB / 1 GiB，根分区可用约 20 GiB，Load `1.97/0.97/0.43`；未发现内核 OOM。

## 主 UAT 保护事实

- Mapping 总数 8：ACTIVE 1、PENDING_REVIEW 7、REJECTED 0；RFQ/Quote/Award 0/0/0；PO 0。
- 唯一 ACTIVE Mapping ID：`224d1965-44ef-4c3e-901e-1926b6b07ff8`；Supplier 1 / `SUP-000001`；Material 533 / `CYD-RB_PCB-000016`；supplier part `UAT-A-PCBA-042576`；PCS→PCS、1:1；生效日 2026-08-05。
- 该 Mapping 为业务 Version 1、当前 CAS 3、ACTIVE；创建/提交人为 `uat_20260729_purchase`，批准人为 `uat_20260729_operations`。
- APPROVED Event 已真实保存：`PENDING_REVIEW→ACTIVE`、actor、occurred_at、request_id、`SUCCESS`；对应 Audit 已真实保存 CAS 2→3。Event.reason 与 Mapping.review_reason 均为空，必须显示“历史批准未采集审核意见”，不得回填。
- 其余七条均为业务 Version 1、CAS 2、PENDING_REVIEW；不得改变状态、版本、CAS、事件或审核事实。
- `PRQ-00000001` 仍为 ACCEPTED；最终有效 Session 0。

## 模型分支门禁

- 先确认 APPROVED Event、Mapping 审核 provenance、Audit CAS 版本和通用 reason 字段能否安全表达批准意见与持久凭证。
- 分支 A：现有字段足以关系化保存审核意见并从 Mapping/Event/Audit 投影完整凭证；不新增 Migration，保持 alpha.39/0038。
- 分支 B：现有模型无法关系化保存审核意见或凭证；新增唯一 0039、ADR 和 alpha.40，不修改 0001—0038。旧 APPROVED 意见允许为空，禁止伪造回填。

## 审核预览与确认合同

- 打开“批准并生效”时先从服务端重新读取只读审核预览；展示 Mapping ID、Version/CAS、PENDING_REVIEW、Supplier/Material 稳定 ID/编码/名称/当前 ACTIVE 状态、supplier part、双方 Unit、换算、有效期、创建/提交 actor/time/request_id/SUCCESS。
- 预览同时返回同 Supplier/Material 当前 ACTIVE 数、同 Supplier 内 supplier part 冲突数、可批准条件、批准后 Version/CAS 语义、RFQ 覆盖结果及“不自动创建下游”说明。
- Supplier/Material 失效、ACTIVE 冲突、part 冲突、CAS 过期或数据不完整时稳定失败关闭，禁用确认且不发送批准请求。
- 点击批准只打开确认窗口，不写业务；审核意见为独立必填字段，不复用退回原因。默认焦点位于取消或意见；取消、关闭、ESC 业务请求为 0。
- 确认前服务端再次核验 expected Version/CAS、当前状态和冲突；确认按钮同步禁用，双击/幂等/并发只允许一个 APPROVED Event。

## 成功凭证、历史与列表合同

- 新批准成功后及历史重开均显示 Mapping ID、APPROVE、actor、Asia/Shanghai 时间、request_id、SUCCESS、审核意见全文、批准前后 Version/CAS、最终 ACTIVE、Supplier/Material 稳定标识、supplier part、单位/换算和有效期。
- 旧 ACTIVE 只显示真实既有凭证；意见为空时固定显示“历史批准未采集审核意见”。
- operations 列表补齐状态、Supplier ID/编码/名称、Material ID/编码/名称、supplier part/后缀、Mapping ID、Version、CAS、双方 ACTIVE 状态、当前 ACTIVE 冲突、创建/提交/批准人和时间；待审核、已生效、已退回可区分。

## 安全与测试

- 保持 purchase 不可审核、operations 不可编辑、自审禁止、未授权 403、Origin/CSRF、幂等、CAS、并发单胜、限流、事务、故障回滚与 ACTIVE 不可原地修改；审核意见不进入不必要日志。
- 严格串行执行 Unit/UI、隔离 PostgreSQL、Chromium、适用回归、typecheck、Schema consistency、lint、production build、credentials scan、`git diff --check` 与 Python 三项基线；一次最多一个临时容器并执行重任务前后资源门禁。
- 若采用分支 B，另覆盖空库、0038→0039、重复执行、失败回滚和旧无意见 APPROVED 兼容。

## 备份、部署与主 UAT

- 部署前生成脱敏保护指纹，建立 root:root 0600 PostgreSQL custom dump，记录大小/SHA，`pg_restore --list` 和第二新空库恢复通过；核验 1 ACTIVE / 7 PENDING 与完整保护事实。
- 分支 A 只替换 Web；分支 B 按停写、备份、串行 Migration、核对和 Web 更新执行。不得重建无关服务或更换 Volume。
- 主 UAT 仅登录 operations：只读核验 1/7、打开一条 PENDING 的批准窗口并取消、打开历史 ACTIVE 凭证、测试筛选、桌面/390×844、安全退出。业务 POST 必须为 0，最终 Session 0，状态、下游和保护指纹不变。

## 允许的最终状态

- `SUPPLIER MAPPING APPROVAL SAFEGUARDS DEPLOYED — UAT 1 ACTIVE 7 PENDING`
- `SUPPLIER MAPPING APPROVAL SAFEGUARDS DEPLOYED — MAIN UAT NOT VERIFIED`
- `BLOCKED — NO UNSAFE CHANGE`

完成后立即停止；不得批准剩余七条，不得创建 RFQ。

## 完成结论

- 最终状态：`SUPPLIER MAPPING APPROVAL SAFEGUARDS DEPLOYED — UAT 1 ACTIVE 7 PENDING`
- 模型：分支 A，无 0039，保持 `0.1.0-alpha.39` / 0038。
- 功能提交：`a86d9adceefb45efca1c43f1f8475703e8fa943d`。
- 完成报告：`docs/tasks/SELFHOST-UAT-FIX-21-COMPLETION.md`。
- 主 UAT 最终事实：1 ACTIVE / 7 PENDING_REVIEW / 0 REJECTED；RFQ/Quote/Award/PO 0/0/0/0；业务 POST 0；Session 0；保护指纹 `2562f52e82eebbede265e367a5e13e31aa13ab34b5fee16b279d074b10266cd8` 不变。
