# SELFHOST-UAT-FIX-20 — 建立受控供应商物料映射维护与审核流程

## 状态与唯一范围

- 状态：`DOING`
- 开始时间：2026-08-04 14:59 CST（Asia/Shanghai）
- 负责人：Codex（严格门禁、现有模型诊断、权限与生命周期、API/UI、RFQ 覆盖率、隔离测试、备份恢复、自托管 UAT 部署、主 UAT 只读验收、文档与独立提交）；项目负责人（固定职责边界、主 UAT 零业务写与部署授权）
- 依赖：`SELFHOST-PHASE2-TASK03`、`SELFHOST-PHASE4-TASK04`、`SELFHOST-UAT-FIX-18`、`SELFHOST-UAT-FIX-19`、D-003、D-040、D-045、D-046、D-061、D-079、D-080、D-082
- 唯一范围：在自托管 Vinext/Node.js/PostgreSQL 运行面复用现有 `supplier_mappings` 权威边界，建立 purchase 创建/编辑草稿/提交与 operations 只读审核/批准/退回流程，并让 RFQ 候选显示同一权威规则计算的映射覆盖率、缺失组合和可选状态。
- 明确禁止：不在主 UAT 创建八条 Supplier Mapping，不创建 RFQ、Quote、Award、PO 或其他下游业务事实；不修改历史 Sites/D1 或 Python/SQLite 业务逻辑；不改写 `0001`—`0037`；不 reset、stash、restore、rebase、amend 或覆盖未知文件。

## 严格起点

- Branch：`main`。
- HEAD：`2cdbc43d1293b6f13bf5bba1e140ec6808b05dd5`。
- Parent：`23d654c383015864be9a2ade71e78d94eb77adaf`。
- `origin/main...HEAD`：behind 0 / ahead 131；tracked/untracked 工作区 clean；根仓库内无嵌套 Git 仓库。
- 源码版本：`0.1.0-alpha.38`。
- 源码 Migration：`0001`—`0037`；0037 SHA-256 为 `139f2623a184ae3d6927c95b56569cc438deffc2a0b46c325c9f04d59471d99f`。
- 运行 Web：`sha256:6622029fb3c401d1b71f10047e53021147bb386cf3dedb3208d1dfba6c7636d0`。
- Web/PostgreSQL healthy，Worker/Caddy running；四服务 RestartCount 0、OOM false；未发现并发 build/test/migration 或其他重型执行流。
- 起点资源：available memory 约 2.2 GiB，Swap 265 MiB / 1 GiB，根分区可用约 20 GiB，Load `0.20/0.11/0.09`。

## 主 UAT 保护基线

- PRQ ID 1 / `PRQ-00000001`：`ACCEPTED`，Purchase ACCEPT/RETURN 为 `1/0`。
- Supplier ID 1/2：`SUP-000001` / `SUP-000002`，均为 `ACTIVE`。
- Material ID 533—536：`CYD-RB_PCB-000016`、`CYD-RB_SENSOR-000003`、`CYD-RB_CONN-000075`、`CYD-RB_METAL-000015`，均为 `ACTIVE` 且有正式编码和 PCS 主单位。
- 上述 2×4 目标 Supplier Mapping：`0`。
- RFQ/Quote/Award：`0/0/0`；PO、Delivery Plan、Receipt、Inventory Ledger、AP、Work Order 均为 `0`。
- 历史失败 request_id `e2d8caab-a39d-4756-894b-329ae548e3f5` 为 `REQUEST_VALIDATION_FAILED`；`1f8c3cf4-22f9-4b39-a0ed-d25a742e3e28` 为 `SUPPLIER_MAPPING_REQUIRED`。两条均为 `RFQ_CREATED/failed`、空 detail，必须原样保留。
- 起点脱敏保护指纹：`d8fb204a61b008c14342050c7cde410b92d9c398e0cf85bf99970b3770e2ef06`。输入只含稳定 ID/编码/状态、Migration 摘要、计数和去正文失败证据，不含名称、凭据、Token、Cookie、Session、连接串或备注正文。
- 主 UAT 只允许最终 purchase/operations 浏览器只读验收与登录/退出；业务 POST 必须为 0。

## 诊断与分支门禁

必须先核验现有 `supplier_mappings` 表、状态/版本/有效期/单位换算/唯一约束、人工写 API、页面空表头原因、RFQ 当前有效 1:1 查询和角色权限，不建立第二套 Supplier Mapping 权威模型。

- 分支 A：现有 Schema 足以表达草稿、提交、审核、版本、有效期、换算和不可变审核事实；不新增 Migration。
- 分支 B：现有 Schema 无法安全表达生命周期或不可变审核事实；新增 ADR 和唯一 `0038`，不得修改既有 Migration。
- 无论是否新增 Migration，完整用户能力发布版本升级为 `0.1.0-alpha.39`。
- 若正式决定与本任务指定的 operations 审核角色冲突，或严格起点/保护事实发生变化，立即停止并报告。

## 权限与生命周期合同

- purchase：`supplier_mapping.read/create/edit_draft/submit`。
- operations：`supplier_mapping.read/review_queue/approve/reject`。
- purchase 不得审核；operations 不得编辑正文；创建人不得审核自己创建的映射；engineering 保持既有只读，不新增审核权；admin/manager 只按既有服务端继承规则处理。
- 至少支持 `DRAFT -> PENDING_REVIEW -> ACTIVE` 与 `PENDING_REVIEW -> REJECTED`。DRAFT 仅创建者可改；提交后正文冻结；退回原因必填；ACTIVE 不原地修改，变更创建受控新版本；历史版本不 UPDATE/DELETE。
- 每个 Supplier/Material 同一有效期最多一个当前 ACTIVE 1:1 Mapping；同一 Supplier 内 supplier part number 唯一；Unit、换算精度、有效期、Supplier/Material ACTIVE、正式编码和主单位均由服务端校验。

## API、UI 与 RFQ 合同

- purchase 页面提供新建、草稿、待审核、已生效、搜索/筛选、稳定 Mapping ID/版本、Supplier/Material 稳定 ID+编码+名称、单位换算、有效期、状态、创建/提交/审核事实、Asia/Shanghai 时间、request_id 和结果。
- 创建表单使用编码优先的有界服务端搜索，只提交稳定 ID，不按名称反向解析。
- operations 队列只显示获准范围的 `PENDING_REVIEW`；正文完整只读，提供批准/退回并明确只有批准后的当前有效映射可供 RFQ 使用。
- 创建、编辑、提交、批准、退回均执行服务端权限、Origin/CSRF、正文上限、限流、Idempotency-Key、canonical digest、expected_version/CAS、并发唯一性、单事务业务/版本/事件/Audit/Idempotency 和故障回滚。
- RFQ 选择 PRQ 后逐 Supplier 显示 ID/编码/名称/状态、覆盖 `x/4`、缺失 Material ID/正式编码、可选状态和原因；建立前逐行展示四条 PRQ 明细。
- 只有全部行都存在当前有效、相同单位、1:1 换算的 ACTIVE Mapping 才可选择。前端展示与服务端创建/发出复用同一权威查询；服务端继续 fail closed。
- 缺失错误使用稳定代码 `SUPPLIER_MAPPING_INCOMPLETE`，中文提示只披露当前候选 Supplier 和缺失的当前 PRQ Material 组合。

## 现有模型诊断与实施选择

- 诊断结论：`supplier_mappings` 已是物料导入、采购、收货和 RFQ 共用的关系化权威表，已有 Supplier/Material 稳定 FK、采购 Unit、整数换算、有效期和版本字段；但既有状态仅为 `ACTIVE/INACTIVE`，旧 `/api/mappings` 人工写接口会一步生成 ACTIVE，且没有草稿/提交/审核事实、稳定跨版本 Mapping ID、审核队列或不可变事件。
- 既有页面只渲染 legacy 表头和导入结果，没有接入人工维护 Service；RFQ 页面只列 ACTIVE Supplier。服务端虽逐行检查 ACTIVE Mapping，却没有向前端提供同口径覆盖率，也没有在 RFQ issue 时再次核验。
- 现有 Schema 无法安全表达不可变审核事实，故选择分支 B：继续以 `supplier_mappings` 为唯一正文/版本权威，新增唯一 `0038_supplier_mapping_governance.sql`，没有建立第二套 Mapping 正文模型，也没有修改 `0001`—`0037`。
- 0038 增加稳定 `mapping_uid`、版本号、提交/审核事实、正文摘要、前后版本关系、不可变 `supplier_mapping_events` 和 Supplier 内 part-number claim；通过 partial unique、GIST exclusion、检查约束和服务写入 guard 保护唯一性、生命周期与历史不可变。旧 ACTIVE/INACTIVE 只回填稳定身份和创建 request provenance，不虚构提交或审核事实。
- 0038 SHA-256：`2da259364151af098641795da55604dc3012b6adf92aec67038c0554e0592941`；源码版本升级为 `0.1.0-alpha.39`。

## 已实现边界

- purchase 原生页：`/procurement/supplier-mappings`；operations 原生只读审核页：`/operations/supplier-mappings`。旧 `/api/mappings` 创建和状态修改均以 `SUPPLIER_MAPPING_GOVERNANCE_REQUIRED` 失败关闭。
- 新 API 覆盖创建、草稿 CAS 编辑、提交、批准、退回、新版本、队列、历史列表和编码优先的有界 Supplier/Material/Unit 选项；所有写入统一走权限、CSRF/Origin、64 KiB 正文、限流、Idempotency-Key、canonical digest、CAS、事务、事件和审计边界。
- RFQ coverage/create/issue 共用一条当前有效 1:1 查询：Supplier ACTIVE，Material ACTIVE 且有正式编码/主单位，Mapping ACTIVE，在有效期内，Unit 与申请行一致，分子等于分母且唯一命中。错误统一为 `SUPPLIER_MAPPING_INCOMPLETE` 并只列当前候选的缺失组合。
- production build 暴露 Vinext RSC manifest 引用已清除 CSS-only chunk 的既有缺口；受控 postbuild 只对白名单 `planning-*`/`sourcing-*` 且每个引用方均有同名前缀 CSS 的缺失空 chunk 生成 `export {}`，其他缺失 JS 直接使构建失败。

## 部署前验证记录

- Supplier Mapping：Unit/UI `5/5 + 5/5`，隔离 PostgreSQL `7/7`，Migration `5/5`；覆盖八条生命周期、职责分离、自审/越权、唯一性、Unit/1:1、有效期、幂等/异正文、CAS、并发单胜、退回原因、ACTIVE 不可原地修改和故障零半记录。
- RFQ：隔离 PostgreSQL 已验证 `0/4`、`3/4` 拒绝和 `4/4` 创建；Quote/Award/PO 保持 0。Procurement Sourcing/FIX-19 回归 `5/5`，Master/Supplier/BOM `6/6`，Identity/Material Requirement/Procurement/Fulfillment/Quality/IQC 跨域回归 `42/42`。
- 隔离 Chromium `1/1`：purchase 页面创建并提交八条，operations 逐条批准，两家 Supplier 均为 `4/4`，仅建立一个 RFQ DRAFT；Quote/Award/PO 0，桌面和 390×844 无页面级横向溢出，两个账号最终 Session 0。最终精确候选镜像 `sha256:28a08d406aff6e49aad9c6576cfc8cfb2a54dc3ae0eda35eeba957930324fd1e`（88,495,506 bytes）复验同样通过。
- 适用静态/UI 回归最终 `87/87`；`npm test` `3/3`、typecheck、Schema/snapshot consistency、credentials `1,189` 文件、production build、lint `0 error / 10 existing warnings` 和 `git diff --check` 通过。
- Python：项目 venv 下 self-test、smoke 和本任务临时 SQLite go-live `3/3`；首次误用系统 Python 时 smoke 在导入 `openpyxl` 前停止，未进入用例或接触常驻数据，随后按固定项目 venv 复验通过。

## 验证、备份、部署与完成边界

- 串行完成 Unit/UI、隔离 PostgreSQL、必要 Migration、隔离 Chromium、适用回归、typecheck、Schema consistency、lint、production build、credentials scan、`git diff --check` 和 Python 三项基线；不得降低断言或跳过失败。
- 隔离数据库覆盖八条合成 Mapping 完整生命周期、唯一性/单位/有效期、职责分离、幂等/CAS/并发/回滚、3/4 拒绝与 4/4 RFQ 成功、零 Quote/Award/PO。
- 隔离 Chromium 覆盖 purchase 创建提交八条、operations 逐条批准、两家 4/4、仅创建一个隔离 RFQ 草稿、Quote/Award/PO 0、桌面/390×844和安全退出。
- 部署前创建 root:root 0600 PostgreSQL custom dump，记录大小/SHA，`pg_restore --list` 和第二新空库恢复通过；若新增 0038，恢复副本还需完成 0037→0038。
- 分支 A 只替换 Web；分支 B 按停写、备份、串行 Migration、核对、Web 更新执行。PostgreSQL、Worker、Caddy 和四个受保护 Volume 不更换或删除。
- 主 UAT 最终只读验收 purchase 入口与两家 0/4/缺失 533—536/不可选、operations 入口与空队列/无编辑控件；两账号退出，业务 POST 0，保护指纹保持。

## 允许的最终状态

- `SUPPLIER MAPPING GOVERNANCE DEPLOYED — UAT MAPPINGS NOT CREATED`
- `SUPPLIER MAPPING GOVERNANCE DEPLOYED — MAIN UAT NOT VERIFIED`
- `BLOCKED — NO UNSAFE CHANGE`

完成后立即停止；不得继续创建主 UAT Mapping、RFQ、Quote、Award 或 PO。
