# SELFHOST-UAT-FIX-20 完成报告

最终状态：`SUPPLIER MAPPING GOVERNANCE DEPLOYED — MAIN UAT NOT VERIFIED`

完成时间：2026-08-04（Asia/Shanghai）

## 1. 结论

Supplier Mapping 治理能力、0038、alpha.39、purchase 维护页、operations 只读审核页和 RFQ 覆盖率门禁均已部署到自托管并行非生产 UAT。隔离环境完成八条 Mapping 的完整创建、提交、异人批准与两家 4/4 RFQ 草稿旅程；主 UAT 没有创建八条 Mapping，也没有创建 RFQ、Quote、Award、PO 或其他下游事实。

purchase 主 UAT 只读验收通过。operations Canonical 账号和数据库均为既有 `must_change_password=true`；完整 runner 在发送登录请求前安全停止。本任务明确禁止修改 Canonical 凭据，也没有绕过身份门禁，因此 operations 主 UAT 页面未验证，最终状态必须如实使用 `MAIN UAT NOT VERIFIED`。

## 2. 严格起点

- `main@2cdbc43d1293b6f13bf5bba1e140ec6808b05dd5`，Parent `23d654c383015864be9a2ade71e78d94eb77adaf`，behind 0/ahead 131，tracked 工作区 clean。
- 源码 `0.1.0-alpha.38`，Migration `0001`—`0037`；0037 SHA-256 `139f2623a184ae3d6927c95b56569cc438deffc2a0b46c325c9f04d59471d99f`。
- Web `sha256:6622029fb3c401d1b71f10047e53021147bb386cf3dedb3208d1dfba6c7636d0`；PostgreSQL/Web healthy，Worker/Caddy running，四服务 RestartCount 0、OOM false。
- 起点约 2.2 GiB available、Swap 265 MiB/1 GiB、根盘可用约 20 GiB、Load `0.20/0.11/0.09`；无其他重型执行流。

## 3. 现有模型诊断与 0038

既有 `supplier_mappings` 已是导入、采购、收货和 RFQ 共用的关系化权威，具有 Supplier/Material 稳定 FK、Unit、整数换算、有效期和 row version；但只有 ACTIVE/INACTIVE，legacy API 会一步生成 ACTIVE，没有 DRAFT/PENDING_REVIEW/REJECTED、稳定跨版本 ID、提交/审核事实、不可变 Event 或审核队列。因此采用分支 B：保留 `supplier_mappings` 为唯一正文/版本权威，仅新增 0038，不修改 0001—0037。

- 文件：`0038_supplier_mapping_governance.sql`
- SHA-256：`2da259364151af098641795da55604dc3012b6adf92aec67038c0554e0592941`
- 新增稳定 `mapping_uid`、`mapping_version_no`、提交/审核 provenance、正文摘要、前后版本关系、不可变 Event 和 Supplier part claim。
- partial unique、GIST exclusion、CHECK、FK、索引和写入 guard 保护生命周期、Supplier 内 part number、ACTIVE 1:1 有效期不重叠及历史不可变。
- 旧 ACTIVE/INACTIVE 只回填稳定身份和既有 request provenance，不虚构提交或审核事实。
- 源码版本升级为 `0.1.0-alpha.39`；主库最终 38/head 0038、225 张 public 表。

## 4. 权限矩阵与职责分离

| 角色 | 权限 | 明确禁止 |
| --- | --- | --- |
| purchase | `supplier_mapping.read/create/edit_draft/submit` | approve、reject、review_queue |
| operations | `supplier_mapping.read/review_queue/approve/reject` | create、edit_draft、submit、正文代改 |
| engineering | 既有 `supplier_mapping.read` | 创建、提交、审核 |
| admin/manager | 按既有继承 | 创建人自审仍禁止 |

DRAFT 仅创建者可改；提交后正文冻结；退回原因必填；ACTIVE 不原地修改，变更必须创建受控新版本。自审、purchase 审核和 operations 正文编辑均由服务端 403，幂等/CAS/并发/故障回滚均有隔离 PostgreSQL 证据。

## 5. RFQ 覆盖率合同

页面、RFQ create 和 RFQ issue 共用同一查询：Supplier ACTIVE、Material ACTIVE/正式编码/主单位匹配、Mapping ACTIVE、Supplier/Material/Unit 精确、当前有效期、分子=分母且唯一命中一条。逐 Supplier 返回 ID/编码/状态、`x/required`、缺失 Material ID/正式编码、selectable 和原因；不完整 checkbox 禁用，伪造请求返回 `SUPPLIER_MAPPING_INCOMPLETE`。

主 UAT 暴露了既有 Material 533—536 的 `base_unit_id=NULL`、`base_uom=PCS` 兼容事实。最终热修复复用 BOM 治理既有规则：优先关系化 base_unit_id，否则把非空 base_uom 与唯一启用 Unit.code 大小写无关精确匹配；无匹配继续失败关闭。不新增 0039、不修改已应用 0038、不回填主 UAT 数据。

## 6. 自动测试

- Supplier Mapping Unit/UI：最终定向 `12/12`；原专项 `5/5 + 5/5`。
- Supplier Mapping 隔离 PostgreSQL：最终 `8/8`，含新增 legacy base_uom 解析；覆盖八条生命周期、职责分离、自审、幂等异正文、CAS、并发单胜、Supplier part/有效期/Unit、ACTIVE 替代、退回原因和故障零半记录。
- Migration：`5/5`，覆盖空库 0001→0038、0037→0038、重复 runner、旧数据保持、模糊 legacy 冲突和 DDL 故障整事务回滚；Schema/snapshot consistency 通过。
- RFQ：0/4、3/4 拒绝，4/4 可创建 DRAFT；Quote/Award/PO 0。
- 跨域：Procurement Sourcing/FIX-19 `5/5`，Master/Supplier/BOM `6/6`，Identity/Material Requirement/Procurement/Fulfillment/Quality/IQC PostgreSQL `42/42`；适用静态/UI `87/87`，`npm test` `3/3`。
- 最终精确镜像 Chromium：`mappings=8 active=8 coverage=4/4x2 rfq=1 quote=0 award=0 po=0 sessions=0 desktop=1 mobile=1`。
- typecheck、完整 lint `0 error / 10 existing warnings`、production build/postbuild asset consistency、credentials scan 1,193 files 和 `git diff --check` 通过。
- Python：项目 venv `server.py --self-test`、`smoke_test.py`、临时 SQLite `go_live_check.py` 为 `3/3`。首次用系统 Python 运行 smoke 时在缺少 openpyxl 的导入阶段停止，未进入用例或写数据；项目 venv 复验通过。

没有降低断言、跳过失败或修改 0001—0037。

## 7. 备份、恢复与部署

- 正式备份：`/var/backups/chenyida-erp/supplier-mapping-fix20-predeploy-20260804T084830Z.dump`
- 权限/大小：root:root、0600、2,189,463 bytes。
- SHA-256：`2d1fe44fd42c7a7281fd50d0d7d20144228ee4b26f62c2fe6c93e2df24dcb96c`。
- 容器 PostgreSQL 客户端 `pg_restore --list`：3,285 项。宿主首次直接调用因没有 `pg_restore` 命令而在读取 dump 前停止，随后只读挂载到固定 PostgreSQL 17 容器验证通过。
- 第二空库恢复：223 张 public 表、37/head 0037、既有 `fc48f001…cff4` 保护指纹、两条失败证据、目标 Mapping=0 与下游 0 一致；再升级为 225 张表、38/head 0038，重复 runner无新增，恢复库已删除。
- 正式部署：停止 Web/Worker 阻断写入，确认应用连接为 0，串行应用 0038并核对后替换 Web，再原样启动 Worker；PostgreSQL/Caddy/四卷未更换或删除。
- 主 UAT 兼容缺口修复后仅 Web-only 替换，没有重跑 Migration；Worker/PostgreSQL/Caddy 未重建。

## 8. 主 UAT 前后保护指纹

- 起点补充指纹：`d8fb204a61b008c14342050c7cde410b92d9c398e0cf85bf99970b3770e2ef06`；部署前 FIX-19 完整指纹仍为 `fc48f001fe3b0afaff69ac245a1fefc8bf6731d38358004314cc12daa308cff4`。
- 从正式部署前备份恢复副本和部署后主库执行同一脱敏、排除 Migration 头的业务指纹，前后均为 `8ad0c2e19863808ed9fed62b0da8f5ef4e78bbaf586fe1be146a286bcf3f0ce0`。
- 预期 Schema 差异：37/head 0037/223 表→38/head 0038/225 表；业务指纹不变。
- PRQ 1 仍 ACCEPTED，Supplier 1/2 ACTIVE，Material 533—536 原样；目标 Mapping 0；RFQ/Quote/Award/PO/Delivery Plan/Receipt/Ledger/AP/Work Order 全为 0。
- 两条历史失败 request_id、错误 code 和空 detail 原样保留。

## 9. 主 UAT 只读 Chromium

- purchase：PASS。新建、保存草稿、提交入口存在；有界搜索可找到 Material 533—536；两家 Supplier 均 0/4，每家准确列出四个缺失组合，checkbox 和建立 RFQ 按钮禁用；桌面/390×844 通过；业务 POST 0，安全退出后 Session 失效。
- operations：NOT VERIFIED。Canonical 和数据库中的 `uat_20260729_operations` 均为 active 但 `must_change_password=true`；full runner 在任何 login 前停止。本任务没有修改 Canonical、密码、must-change 或数据库身份，也没有以 admin/manager 绕过职责分离。
- 相关安全停止和 purchase 重跑期间只发生授权的 login/logout；最终 active Session 0，业务事实指纹不变。

## 10. 镜像与 Git

- 功能提交：`ddab02a57e0e87255c7a35d125959ac750b108e1`（`feat: add governed supplier material mappings`）。
- 兼容修复提交：`1e9221d90db621becc2badf40b3e0ed3017b73e6`（`fix: resolve legacy material units for supplier mappings`）。
- 运维/文档收口：`ops: deploy supplier mapping governance`，实际 SHA 以 `git log` 为准。
- 最终 Web：`sha256:c1576bd22a209fb6f524e304bcf12cc38af4d67a35c76f37fa8dc1311c2922c8`，88,495,899 bytes。
- 回退：原 alpha.38 `sha256:6622029f…` 保留 tag `rollback-supplier-mapping-fix20-predeploy-20260804T085116Z`；首次 alpha.39 `sha256:28a08d40…` 保留 tag `rollback-supplier-mapping-fix20-pre-hotfix-20260804T090544Z`。
- 未 push/PR/amend/rebase/reset/stash/restore。

## 11. 资源与清理

- 起点→终点：available memory 约 2.2→2.2 GiB；Swap 265→263 MiB（测试峰值约 301 MiB）；根盘可用约 20→20 GiB；Load `0.20/0.11/0.09`→`0.37/0.38/0.38`。
- 内核 OOM 0；PostgreSQL/Web/Worker/Caddy 最终 RestartCount 均为 0、OOMKilled false，Web/PostgreSQL healthy。
- FIX-20 临时测试/恢复/指纹数据库 0、临时容器 0、standalone/Playwright 临时目录 0；未执行 Docker prune 或 Volume prune。
- 四个受保护 Volume 全部保留；正式备份、当前镜像和精确回退镜像保留。

## 12. 是否可以开始 purchase 创建八条 UAT Mapping

技术上 purchase 页面、稳定搜索、服务端创建/提交和 RFQ 0/4 门禁已就绪，但当前不能开始八条端到端主 UAT Mapping：operations Canonical 账号仍要求首次改密，无法在不违反本任务“不得修改 Canonical 凭据”的边界下完成异人审核。应先另立受控 Identity 任务处理 operations 强制改密并完成只读登录验收，再由新的明确业务授权任务创建和审核八条 Mapping。

本任务到此停止；没有创建主 UAT Mapping、RFQ、Quote、Award 或 PO。
