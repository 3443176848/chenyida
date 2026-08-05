# SELFHOST-UAT-FIX-22 — 补齐 RFQ 草稿来源凭证、Mapping 追溯及发出前确认

## 状态与唯一范围

- 状态：`DOING`
- 开始时间：2026-08-05 15:48 CST（Asia/Shanghai）
- 负责人：Codex（严格门禁、权威模型诊断、0039/alpha.40、RFQ 追溯与发出保护、串行测试、备份恢复、自托管 UAT 部署、purchase-only 主 UAT 只读取消验收）；项目负责人（固定主 RFQ 草稿事实、Migration/部署与只读验收授权）
- 依赖：`SELFHOST-UAT-FIX-19`、`SELFHOST-UAT-FIX-20`、`SELFHOST-UAT-FIX-21`、D-003、D-040、D-045、D-046、D-061、D-080、D-082、D-091、D-094、D-095
- 唯一范围：只修复自托管 Vinext/Node.js/PostgreSQL 运行面的 RFQ 草稿创建凭证、逐 Supplier×RFQ Line 的 Supplier Mapping 稳定 ID/Version 追溯，以及“发出询价并冻结范围”的确认、重验和成功凭证。
- 明确禁止：不得发出主 UAT `RFQ-00000001`，不得修改其截止日期、范围或 Supplier，不得录入 Quote、创建 Award/PO、删除或重建 RFQ，也不得把隔离测试事件写入主 UAT；不修改历史 Sites/D1 或 Python/SQLite 业务逻辑，不改写 `0001`—`0038`，不 push/PR/amend/rebase/reset/stash/restore。

## 必读与报告基线

- `/opt/erp/AGENTS.md`、`docs/project/MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`。
- `docs/material-master/supplier-mapping-governance-v1.md`、`SELFHOST-UAT-FIX-20/21` 任务及完成报告。
- `SELFHOST-UAT-FIX-19` 任务及完成报告。
- `docs/design/procurement-sourcing-model.md`、`docs/testing/procurement-sourcing-acceptance.md`。
- `DECISIONS.md` 中 Procurement Sourcing、Event、Audit、Idempotency、版本/范围冻结及 Supplier Mapping 决策。
- 最新 RFQ 草稿黑盒事实由项目负责人本任务指令提供；仓库没有同名独立报告，必须由 PostgreSQL 关系事实和成功审计逐项复核，不以聊天记忆替代数据库证据。

## 已核验严格起点

- Branch `main`；HEAD `60538d08509f91eeb0df91718c7276172c23557d`；Parent `a86d9adceefb45efca1c43f1f8475703e8fa943d`；`origin/main...HEAD` behind 0/ahead 142。
- tracked/untracked 工作区 clean；唯一 worktree；无嵌套仓库或并发 build/test/Migration。
- 源码 `0.1.0-alpha.39`；Migration `0001`—`0038`；0038 SHA-256 `2da259364151af098641795da55604dc3012b6adf92aec67038c0554e0592941`。
- Web 镜像 `sha256:c98d3e8aeef8087d9daa951d0f0c3c7ceb97307edd2d13e92c582c42935f3978`；Web/PostgreSQL healthy，Worker/Caddy running；四服务 RestartCount 0、OOMKilled false。
- 起点资源：available memory 约 2.0 GiB，Swap 259 MiB/1 GiB，根盘可用 20 GiB，Load `0.24/0.20/0.13`；内核 OOM 0。

## 主 UAT 保护事实

- RFQ ID 1 / `RFQ-00000001` / Round 1 / RFQ Version 1 / `DRAFT`；截止日 `2026-08-31`，币种 CNY，未发出。
- 来源 PRQ ID 1 / `PRQ-00000001` / Version 2 / `ACCEPTED`；项目 `PRJ-00000001`。
- RFQ Line 1—4 分别稳定引用 Purchase Request Line 1—4；Material 533—536 各 `10.000000 PCS`。
- Supplier ID 1/2 各有一个 `INVITED` 邀请；八条目标 Mapping 均为 ACTIVE、Mapping Version 1、CAS 3，稳定 ID 与项目负责人给定清单精确一致。
- RFQ 创建 actor `uat_20260729_purchase`，Asia/Shanghai 时间 `2026-08-05 15:24:26.684817`，request_id `75078325-3b3a-4d1e-b911-99cbd5f802db`。
- 同 request_id 的 `RFQ_CREATED/success` 精确 Audit 保存 new version 1 和 Idempotency-Key 摘要；当前没有 RFQ_CREATED 业务 Event。
- Quote/Award/PO 为 `0/0/0`；Delivery Plan/Receipt/Ledger/AP/Work Order 均为 0；有效 Session 0。
- 2026-08-05 17:44 CST 已以最终保护脚本在只读 `REPEATABLE READ` 事务生成并复核部署前脱敏业务指纹 `9d4641b1b6324de4e3a1a26e7461ca2e15bd7613cb99a277c11e6bca869ac66e`；覆盖 RFQ/PRQ、四行、两邀请、八条当前 Mapping、全库 Mapping 总数/ACTIVE 数、精确成功 Audit、RFQ Event/Binding、RFQ 创建幂等记录及全部下游计数，排除 Schema、非 RFQ 幂等临时行及 Session；同时逐项比对 `0001`—当前 Migration ledger 与源码 SHA。后续每个风险阶段必须以该值重新核对。

## 权威模型诊断与 Schema 分支

- `procurement_rfq_lines.purchase_request_line_id` 已关系化保存 RFQ Line → Purchase Request Line。
- `procurement_rfq_suppliers.supplier_id` 已关系化保存 RFQ Supplier → Supplier。
- 现有 Schema 只在邀请行保存 `supplier_mapping_digest`；没有逐 Supplier×RFQ Line 的 Mapping version fact、稳定 Mapping ID 或版本外键，无法证明创建时/发出时精确绑定。
- 当前 create 和 issue 都动态调用当前 ACTIVE 1:1 coverage；create 只保存摘要，issue 再查当前 Mapping，未冻结精确 Mapping 版本。不得把当前八条 ACTIVE Mapping 冒充历史创建时绑定。
- 因此采用分支 B：新增唯一 `0039_rfq_traceability.sql`、ADR/D-095，版本升级为 `0.1.0-alpha.40`；不修改 `0001`—`0038`。
- 新 RFQ 在创建事务内保存逐 Supplier×RFQ Line 的 Mapping 稳定 ID、Mapping Version 和版本事实外键，并追加不可变 `RFQ_CREATED` Event。
- 0039 前既有草稿不回填、不伪造。`RFQ-00000001` 显示“历史草稿尚未固定 Mapping”；purchase 可通过显式“确认并固定当前 Mapping”操作建立绑定并记录 actor/time/request_id，但本任务不得在主 UAT 执行该操作。

## 实现与验收合同

- RFQ 详情展示真实创建凭证、DRAFT/草稿/待发出双语义、来源 PRQ/项目/截止日/币种、创建前后 Version/CAS 及持久事实来源说明。
- Mapping 按 Supplier 分组，展示稳定 Supplier/Material、supplier part、Mapping ID/Version、PCS→PCS、1:1、有效期、当前状态、绑定来源/状态与漂移；历史未绑定草稿明确区分当前资格检查、拟绑定与发出后不可变快照。
- 发出按钮只打开确认窗口；完整冻结范围、创建凭证、四行、两 Supplier、八 Mapping、截止日/CNY、当前冲突与后果均可见。取消、关闭、ESC 业务请求 0，默认焦点安全，确认同步禁用，双击单事件。
- 服务端在固定/发出前重新核验 PRQ、Supplier、Mapping ID/Version/状态/有效期/唯一性、截止日期、RFQ 状态和 CAS；漂移、失效或冲突列出具体 Supplier/Material 组合并失败关闭。
- 正常隔离发出只产生一个 ISSUED Event；发出后范围/绑定不可变、Quote 入口启用但数量仍 0，Award/PO 仍 0；业务/Event/Audit/Idempotency 单事务，故障零半记录。
- 自动测试、0039 迁移、隔离 PostgreSQL/Chromium、适用回归、typecheck、Schema consistency、lint、build、凭据扫描、diff check 和 Python 三项基线严格串行。
- 部署前 root:root 0600 PostgreSQL custom dump、SHA、`pg_restore --list`、第二空库恢复和 0038→0039 升级通过；正式部署串行停写、备份、Migration、核对和仅必要 Web 更新，不重建无关服务或更换受保护 Volume。
- 主 UAT 只登录 purchase，打开 RFQ、核验凭证/历史未固定状态、打开完整发出确认后取消，桌面/390×844及安全退出；业务 POST 0、RFQ 仍 DRAFT、Quote/Award/PO 0、保护指纹不变、最终 Session 0。

## 部署前实现与验证结果

- 唯一新增 Migration `0039_rfq_traceability.sql`，SHA-256 `3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`；`0038` SHA 保持 `2da259364151af098641795da55604dc3012b6adf92aec67038c0554e0592941`。版本已更新为 `0.1.0-alpha.40`。
- 新 RFQ 创建时保存精确 2×4 Mapping version bindings 并写 `RFQ_CREATED` credential；既有主 RFQ 仍为未绑定历史 DRAFT，只显示当前资格和拟绑定，不执行补救确认。
- 发出确认窗口、同步单击门禁、取消/关闭/ESC 零请求、服务端与数据库双重重验、ISSUED 成功凭证、范围冻结和 Quote 入口状态已实现。
- Migration 6/6；Unit/UI/Sourcing/FIX-22 PostgreSQL 26/26；Material Requirement 12/12；真实 Sourcing→Award→Fulfillment 2/2；隔离 Chromium 1/1。隔离浏览器证明创建事件 1、绑定 8、发出事件 1、双击单 POST、Quote/Award/PO 0、Web 重启持久、桌面/390px和 Session 0。
- typecheck 通过；lint 0 error/11 个既有 warning；build、凭据扫描 1217 文件、`git diff --check`、Python `server.py --self-test`/`smoke_test.py`/`go_live_check.py` 通过。最终候选 Web 镜像 `sha256:eb2a0cc9441b87a70ac33b34452b7616d0f394ef41a7030cd80aa3451677d758`，大小 88,531,882 bytes。
- 两轮独立静态复审发现并闭合 Material Requirement project advisory 锁序死锁风险与历史 ISSUED v1 兼容风险；最终结论无部署阻断。

## 允许的最终状态

- `RFQ TRACEABILITY DEPLOYED — UAT RFQ STILL DRAFT`
- `RFQ TRACEABILITY DEPLOYED — MAIN UAT NOT VERIFIED`
- `BLOCKED — NO UNSAFE CHANGE`

完成后立即停止；不发出主 UAT RFQ、不录报价、不定标。
