# SELFHOST-OPS-UAT-PURCHASE-SUPPLY-BREAKDOWN-FIX-16

## 任务状态

- 状态：`DONE`
- 开始时间：2026-08-03
- 完成时间：2026-08-03 16:15 CST
- 责任人：Codex（严格门禁、权威供应投影、范围授权、响应式 UI、隔离测试、备份恢复、Web-only 部署与 purchase-only 只读 UAT）、项目负责人（固定主 UAT 保护状态与执行边界）
- 依赖：`SELFHOST-OPS-UAT-PURCHASE-REQUEST-TRACEABILITY-FIX-15`
- 目标：在采购需求审核详情和接收确认中补齐当前库存、正式预留、冻结、有效计划分配和有效在途分解；不改写提交快照或 PRQ 数量。

## 严格起点

- Branch：`main`。
- 完整 HEAD：`231813f4cbb7db364a26fba5d358d76e06c69604`。
- 完整 Parent：`22ea9a282ef4d7a7e58e84b9db73061a0ef6e109`。
- `origin/main...HEAD`：behind 0 / ahead 123；根工作区 clean；无嵌套 gitlink。
- 源码版本 `0.1.0-alpha.38`；源码与 PostgreSQL Migration 均为 `0001`—`0037`；0037 SHA-256 为 `139f2623a184ae3d6927c95b56569cc438deffc2a0b46c325c9f04d59471d99f`。
- Web 镜像为 `sha256:d5c514ab8ef497c702ef5c16c69da4d58c5ce849b96d09fa781fa679963c29dc`，与 FIX-15 完成报告一致；Worker 镜像为 `sha256:32d1ae335610c097d9fa38dd411acabc525c0fe17cfcb863271e32317afe96aa`。
- Web/PostgreSQL healthy，Worker/Caddy running；四服务 RestartCount 0、OOM false；Canonical purchase 凭据文件为单硬链接普通文件、`root:root 0600`，账号角色/active/密码摘要核验有效，`must_change=false`。核验过程未输出任何凭据或摘要正文。
- 起点资源：available memory 约 2.3 GiB，Swap 295 MiB / 1 GiB，根分区可用 22 GiB，Load `0.14/0.11/0.09`；未发现其他 build/test 执行流。

## 起点主 UAT 只读基线

- `PRQ-00000001` 为 `SUBMITTED`（待采购接收），Purchase ACCEPT/RETURN 为 `0/0`。
- Package ID 2/v2 为 `ACCEPTED`；Material Requirement Plan ID 1/v1 为 `SUBMITTED`。
- PRQ 四条 Material 533—536 各 10 PCS；每条提交快照均为毛需求 10、库存可用/分配 0/0、在途可用/分配 0/0、净采购 10、PRQ 10。
- 四条当前权威汇总均为在手、正式预留、冻结、库存可用、有效计划库存分配、未分配库存、有效在途、有效计划在途分配、未分配在途全部 0 PCS。
- RFQ、Quote、Award、PO、Delivery Plan、Receipt、Ledger、AP、Work Order 均为 0；Planning Allocation 为 0。
- 本任务固定的起点业务指纹：`fc5bc99c56b3d6bd21195d0f031d8f0eb1e19913dea32157de97e9f8cb4cc0c1`。
- 本任务固定的起点供应指纹：`9a94f42ad0dfbc91b537e04f735e1e3c9ef2fd9237306499bdbd9562eff48d2f`。

## 权威口径

- 当前库存按 `inventory_stock_balances` 的 Material + Unit、`location_code='MAIN'` 汇总全部无批次及批次位置：`库存可用 = sum(on_hand_qty) - sum(reserved_qty) - sum(frozen_qty)`；每个位置由数据库数量约束保证非负。
- `reserved_qty` 是 Inventory 正式预留；`planning_material_allocations` 只在来源计划为 `SUBMITTED`/`ACCEPTED` 时计为有效计划分配，两者独立展示，不互相冒充。
- `未分配库存可用 = max(库存可用 - 有效计划库存分配, 0)`。
- 当前模型只允许 `MAIN` 位置域，不存在多仓库字段；存在多批次位置。数据库没有独立“其他不可用”数量字段，接口和页面必须显示“模型未单独记录”，不得伪造数量。
- 当前有效在途仅含 PO 头和行均为 `OPEN`/`PARTIALLY_RECEIVED` 且截止 PRQ 需求日的剩余数量。存在 Delivery Plan 时仅以 `PENDING`/`PARTIAL` 和 `planned_quantity-received_quantity` 为准；`COMPLETED`/`CANCELLED`/`CLOSED` 排除。无 Delivery Plan 的兼容 PO 使用 `expected_at` 和 `order_qty-received_qty`。
- `未分配在途可用 = max(有效在途 - 有效计划在途分配, 0)`。已过账收货通过 received quantity 从有效在途排除并进入库存；模型没有独立“已到货但未完成入库数量”字段，必须如实标注未单独记录。
- 提交时计划/PRQ 快照和当前供应投影严格分区；当前值及差异只读，不自动重算或改写 PRQ。

## 禁止事项与验收边界

- 本轮不得接收或退回 `PRQ-00000001`，不得修改 Inventory、Planning Allocation、Ledger 或 Audit 业务记录，不得创建 RFQ、Quote、Award、PO、Delivery Plan、Receipt、AP 或 Work Order。
- purchase 只能在既有 PRQ 对象范围授权通过后读取该 PRQ 行的 Material + Unit 汇总；诱饵 PRQ/非授权 Material 必须 403 或不可见；不得增加 Inventory/Ledger 写权限或 `system.audit.read`。
- 不读取或修改 `shujvbiao/`；不输出凭据、连接串、Token、Cookie、Session 或密码摘要。
- 不新增 0038、不修改 0001—0037、不修改 alpha.38；预期只替换 Web，PostgreSQL、Worker、Caddy 不重建。
- 低资源重任务全部串行，固定 `COMPOSE_PARALLEL_LIMIT=1`，一次一个临时容器；达到 AGENTS.md 阈值立即停止。

## 验收结果

### 实现与安全边界

- 功能提交：`ce3f14a0c989875e7527e42136967f9efe6ee548`（`fix: expose purchase current supply breakdown`）。新增边界明确的 `current-supply.ts` 批量投影，并接入既有 Purchase Request 详情服务；没有新增 0038、修改 0001—0037、修改 Schema/alpha.38 或改变接收 POST。
- 详情 GET 在 repeatable-read/read-only 事务中先完成既有 purchase 对象范围授权，再以该 PRQ 的精确 Material+Unit 行集一次读取当前供应。诱饵 PRQ 403；查询不能枚举其他 Material、Lot、项目、供应商或价格。GET 失败不再创建 Audit，正常/失败查询与确认刷新均对 Inventory、Allocation、Audit 和下游零业务写。
- 库存按 MAIN 全部无 Lot/Lot 位置聚合：`库存可用 = Σ在手 - ΣInventory 正式预留 - Σ品质冻结`；SUBMITTED/ACCEPTED Plan 的 Allocation 独立展示，`未分配库存可用 = max(库存可用 - 有效计划库存分配, 0)`。当前模型无多仓库和其他不可用独立字段，页面明确“模型未单独记录”。
- 有效在途只含截止需求日内 OPEN/PARTIALLY_RECEIVED 的 PO 头/行；有 Delivery Plan 时只取 PENDING/PARTIAL 的 planned−received，无 Plan 才取 PO order−received。COMPLETED/CANCELLED/CLOSED、已收货部分及无效来源 Allocation 排除；`未分配在途可用 = max(有效在途 - 有效计划在途分配, 0)`。模型没有已到货未入库独立字段，未伪造数量。
- 页面为每个 Material 明确提供“提交时快照 / 当前供应状态 / 差异提示”三区和真实公式；当前值不覆盖快照或 PRQ。接收确认打开前重新 GET，显示四条只读摘要、查询时间和差异，并明确接收不修改库存或自动创建 RFQ/PO。390×844 卡片、折叠公式、数量不拆字且无页面横向溢出。
- 历史 Sites 运行面及其 `.openai/hosting.json` 保持原样；本任务只修改并部署自托管 Web，没有跨运行面复制逻辑或执行 Sites 发布。

### 自动与隔离验收

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 定向 unit/UI | PASS 10/10 | 当前供应 DTO、快照/当前/差异、确认 fresh GET、四条卡片和 390px 合同通过 |
| 静态/安全回归 | PASS 78/78 | Material、Inventory、Procurement、Planning、Identity、CSRF、Origin 适用回归通过 |
| 当前供应 PostgreSQL | PASS 6/6 | 覆盖零值、on_hand/reserved/frozen、多 Lot 守恒、Allocation 分离、有效/部分收货/完成/取消/未来在途、在途 Allocation、诱饵 403、无敏感字段和查询零写；组合样例为 positions 3、lots 2、80−10−15=55、计划库存分配 55、有效在途 75、在途分配 40、未分配在途 35 |
| 跨域 PostgreSQL | PASS 32/32 | Inventory 3、Procurement 7、Planning 12、Identity 10，包含 CSRF/Origin |
| 隔离 Chromium | PASS 1/1 | 390×844 打开详情、核对供应、接收取消/关闭/ESC与退回取消均零写；只在隔离库执行一次接收以保留既有 CAS/幂等回归，主 UAT 从未接收 |
| 构建/静态 | PASS | 两组 typecheck、alpha.38 production build、lint 0 error/10 warning、`npm test` 3/3、仓库凭据扫描和 `git diff --check` 通过 |
| Python 基线 | PASS 3/3 | `server.py --self-test`、`smoke_test.py`、`go_live_check.py` 在一次性任务 venv/临时 SQLite 中通过并清理；首次直接宿主 smoke 仅因宿主缺少 `openpyxl` 在 import 前停止，没有连接或写入常驻数据 |

### 备份、恢复与部署

- 正式 pre-deploy custom dump：`/var/backups/chenyida-erp/purchase-supply-breakdown-fix16-predeploy-20260803T080434Z.dump`，root:root 0600，2,185,039 bytes，SHA-256 `43f4e4620e51c5b2ee5876e13556907e38817399dd0eac0fedd2320bc95c75c6`；`pg_restore --list` 3,285 项通过。
- 第二新空库 `erp_fix16_restore_verify` 恢复为 37/head 0037，0037 checksum、主 UAT 对象、四行、零 Allocation/下游和正式指纹均与主库一致；核验后精确删除。
- 候选 Web image 为 alpha.38 `sha256:d7ced686803c1f5f71ec101ebe28e3080005d534480dd39bfc8a91913ef12a5d`，88,464,983 bytes。以 `COMPOSE_PARALLEL_LIMIT=1` 只重建 Web；PostgreSQL、Worker、Caddy 的容器 ID/启动时间/镜像保持，四服务 restart 0/OOM false。旧 Web `sha256:d5c514ab8ef497c702ef5c16c69da4d58c5ce849b96d09fa781fa679963c29dc` 保留回退 tag `chenyida-erp-parallel-web:rollback-purchase-supply-fix16-predeploy-20260803T080857Z`。
- 部署命令已使 Web healthy；紧随其后的包装核验曾因错误期待 health 响应含 `version` 字段而返回 code 2，实际服务未异常。按现有 health 合同重新只读验证为 `{ok:true,database:postgresql,storage:local}`，未回退、未二次重建。

### 主 UAT 只读验收与数据保护

- 正式只读浏览器结果：`PURCHASE_SUPPLY_UAT_READONLY_OK lines=4 refresh_get=1 cancel=1 business_post=0 accept=0 return=0 downstream=0`。仅 purchase 登录；390×844 分别核对 Material 533—536，每条当前在手、正式预留、品质冻结、库存可用、计划库存分配、未分配库存、有效在途、在途分配、未分配在途均为 0 PCS；打开 fresh GET 的接收确认后取消并安全退出。
- 最终 `PRQ-00000001` 为 SUBMITTED/v1，Purchase ACCEPT/RETURN 0/0；Package 2/v2 ACCEPTED，Plan 1/v1 SUBMITTED；四条仍各 10 PCS。Inventory 和 Allocation 未变，RFQ、Quote、Award、PO、Delivery Plan、Receipt、Ledger、AP、Work Order 均为 0。
- 起点门禁指纹 `fc5bc99c56b3d6bd21195d0f031d8f0eb1e19913dea32157de97e9f8cb4cc0c1` / `9a94f42ad0dfbc91b537e04f735e1e3c9ef2fd9237306499bdbd9562eff48d2f` 使用起点检查清单。实现后固定的正式部署清单扩大了供应边界覆盖，因此产生不可直接与起点清单互比的业务 `cc6a9d4f4350b6aa2846a9f681e6f47c451ba8bdf5f49c6a42848885633f6d66`、供应 `c93374feeeb48fe1a978bfb6e844cdf3f32b9fab26477e022956932364d9efb1`；同一正式清单在部署前主库、第二新空恢复库和主 UAT 后三次完全一致，逐对象状态/数量也与起点一致。

### 资源、清理与 Git

- 起点约 available memory 2.3 GiB、Swap 295 MiB/1 GiB、根盘可用 22 GiB、Load `0.14/0.11/0.09`；终点 2.3 GiB、303 MiB/1 GiB、21 GiB、`0.19/0.20/0.29`。内核 OOM 匹配 0，四服务 restart 0/OOM false，未触发低资源停止门禁。
- FIX-16 临时容器 0、临时 Volume 0、临时数据库 0、`/tmp/*fix16*` 0；一次性 venv/SQLite/浏览器材料均已精确清理。四个受保护 Volume、正式备份、当前/回退 Web 镜像保留；未执行 prune，未修改 Swap、dockerd、内核、防火墙或 systemd。
- 两个聚焦提交：功能提交如上；runner/ADR/完成报告由 `ops: accept purchase supply review fix` 独立收口，实际 SHA 以 `git log` 为准。未 push、创建 PR、amend、rebase、reset、stash 或 restore。

## 最终结论

`PURCHASE SUPPLY BREAKDOWN FIXED — UAT PRQ STILL PENDING`

完成后立即停止；不接收或退回主 PRQ，不修改库存/分配，不创建 RFQ。
