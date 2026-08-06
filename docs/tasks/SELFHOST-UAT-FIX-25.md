# SELFHOST-UAT-FIX-25 — RFQ Binding 关联追溯诊断与基线更正

## 状态

- 状态：`DONE`
- 开始：2026-08-06
- 完成：2026-08-06
- 负责人：Codex；项目负责人提供严格只读诊断、分支选择和主 UAT 保护边界
- 依赖：SELFHOST-UAT-FIX-22、SELFHOST-UAT-FIX-24、D-094、D-095、D-096

## 目标与边界

- 查明 `RFQ-00000001` 页面 Binding ID 与此前所述验收关联不一致的根因；权威来源依次为 PostgreSQL 外键事实、不可变 Binding 快照、固定 Event 和现有规范化摘要逻辑，不能预设页面或报告正确。
- 主 UAT 只允许读取 RFQ ID 1、其 RFQ Supplier/RFQ Line、八条 Binding、对应 Mapping/Version、唯一 `RFQ_MAPPING_CONFIRMED` Event 和 Quote/Award/PO 计数。
- 禁止发出 RFQ、改写/重建/重新编号 Binding、改写 Event/摘要/Audit、创建 Quote/Award/PO、修改 PRQ/Supplier/Mapping/Material、用直接 SQL 修复或读取任何凭据、Token、Cookie、Session 正文。
- 若进入分支 B，只更正报告和验收基线；不修改数据库、业务代码、Migration 或运行面，不执行备份、恢复、部署和浏览器登录。

## 严格起点

- clean `main@08af2f4`，Parent `e329931`，`origin/main...HEAD` behind 0 / ahead 148；无嵌套 Git 工作流或并发重任务。
- 源码与 Web 均为 `0.1.0-alpha.40`；Migration `0001—0039`，0039 SHA-256 `3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`。
- Web 为 `sha256:315f0b7945a7b3eb27841ffaae8a444fba45dd94791519dc856173a95d830635`；Web/PostgreSQL healthy，Worker/Caddy running，四服务 restart 0/OOM false。
- 主 UAT 起点为 RFQ ID 1 / `RFQ-00000001`、DRAFT v2、Binding 8、`RFQ_MAPPING_CONFIRMED` 1、`RFQ_ISSUED` 0、Quote/Award/PO 0/0/0。

## 诊断方法与分支

- 在单一 `REPEATABLE READ READ ONLY` 事务中逐条连接 Binding → RFQ Supplier → Supplier、Binding → RFQ Line → Material、Binding → `supplier_mappings`，核对稳定 ID、Mapping UUID/Version/CAS/digest、supplier part、双方 Unit、换算、有效期和状态。
- 使用源码现有 `canonicalDigest` 对同一不可变 Binding 范围重新规范化并计算摘要，不修改摘要或以手工格式替代权威逻辑。
- 审计 Repository/DTO/Service/UI 和 FIX-24 UAT runner：`binding_id` 来自 `b.id::text`，每个 DTO 作为整行对象排序和渲染，不存在数组下标、`index + 1`、Material 顺序或 Supplier 顺序重新配对。
- 诊断采用分支 B：权威数据和页面逐行身份一致；错误基线由把 UI 显示顺序 ID 列表按位置与 RFQ Line/Material 顺序列表做 zip 产生。排序只能决定卡片位置，不能定义 Binding 身份。

## 验收结果

- FIX-24 完成报告原有逐行明细表与权威数据库一致；需要更正的是仅列 `3,4,1,2,7,8,5,6` 的摘要性验收表述及由此派生的错误位置配对。
- 权威关联按 Binding 主键为 `1→Supplier 1/Material 533/224d…`、`2→1/534/43ca…`、`3→1/535/aa16…`、`4→1/536/9659…`、`5→2/533/45a3…`、`6→2/534/5bd2…`、`7→2/535/3ac2…`、`8→2/536/5432…`。完整表见[完成报告](SELFHOST-UAT-FIX-25-COMPLETION.md)。
- 固定范围摘要重新计算为 `9765f8fdef768335a25b314867dd3e077429a84848cba067ff8394c8a017848d`，与 Event 完全一致；外键错配、重复、孤儿、跨 RFQ 和错误 Mapping Version 均为 0。
- 未修改业务代码、Migration、数据库、镜像或部署配置；未登录 UAT、未发送业务 POST。最终仍为 DRAFT v2、Binding 8、Mapping Event 1、ISSUED/Quote/Award/PO 0。
- 最终结论：`RFQ BINDING BASELINE CORRECTED — UAT RFQ STILL DRAFT`。
