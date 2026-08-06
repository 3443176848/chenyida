# SELFHOST-UAT-FIX-26 — RFQ 发出确认窗口硬性合同与 Binding 摘要排序消歧

## 状态与唯一范围

- 状态：`DONE`
- 开始：2026-08-06（Asia/Shanghai）
- 负责人：Codex（严格门禁、0039 权威模型核验、确认合同/UI、隔离 PostgreSQL/Chromium、备份恢复、Web-only 部署和 purchase-only 只读取消验收）；项目负责人（固定主 UAT 禁止发出及部署/只读验收授权）
- 完成：2026-08-06（Asia/Shanghai）；见[完成报告](SELFHOST-UAT-FIX-26-COMPLETION.md)
- 依赖：`SELFHOST-UAT-FIX-22`、`SELFHOST-UAT-FIX-24`、`SELFHOST-UAT-FIX-25`、D-061、D-091、D-094、D-095、D-096、D-097
- 唯一范围：补齐 RFQ 发出确认窗口的最终按钮、默认焦点、零请求取消合同、完整下游保护说明、Binding/Mapping/邀请状态语义和 Binding ID 排序；不改变 RFQ 发出服务端业务规则、固定事实或摘要算法。

## 严格起点

- `main@f0202b083387c4f60eb5537221b1ce51d2dd93de`，`origin/main...HEAD` behind 0 / ahead 149，tracked 工作区 clean。
- 源码/运行 Web `0.1.0-alpha.40`；Migration `0001—0039`；0039 SHA-256 `3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`。
- 起点 Web `sha256:315f0b7945a7b3eb27841ffaae8a444fba45dd94791519dc856173a95d830635`；Web/PostgreSQL healthy，Worker/Caddy running，四服务 restart 0/OOM false。
- 起点资源：available memory 约 2.1 GiB，Swap 279 MiB/1 GiB，根盘可用 19 GiB，Load `0.38/0.37/0.30`。

## 主 UAT 保护合同

- 目标只能是 RFQ ID 1 / `RFQ-00000001`，DRAFT v2，Binding 8，`RFQ_MAPPING_CONFIRMED` 1，`RFQ_ISSUED` 0，Quote/Award/PO 0/0/0。
- 不发出主 RFQ，不修改或重建 Binding，不修改 Mapping、Supplier、PRQ、Material、固定摘要或历史 Event，不创建 Quote、Award、PO 或其他下游。
- 固定摘要必须保持 `9765f8fdef768335a25b314867dd3e077429a84848cba067ff8394c8a017848d`；不修改 `canonicalDigest`、已保存 Binding 或 `RFQ_MAPPING_CONFIRMED`。
- 不新增、修改或运行 Migration；不改写 `0001—0039`。

## 0039 权威状态分支

- 0039 的 `procurement_rfq_supplier_line_mapping_bindings` 明确包含独立 `binding_status text NOT NULL`，并以 CHECK 限定为 `ACTIVE`。
- 因此采用“有独立状态字段”分支：显示“Binding状态：ACTIVE”，并与“Mapping状态：ACTIVE”和“邀请状态：INVITED”独立分栏。
- 同时独立展示 Binding 固定关系、Mapping 当前状态、邀请状态、状态漂移和版本漂移；不得把三个状态合并，也不得把 Binding ACTIVE 解释为 Mapping 或邀请状态。

## 确认窗口合同

- 入口可继续显示“发出询价并冻结范围”；确认窗口最终写按钮精确显示“确认发出”，保留“取消”，默认焦点位于取消或其他非破坏性控件。
- 取消、关闭、ESC 均只关闭本地窗口，业务请求必须为 0。
- 窗口逐项说明本次发出不会自动创建或修改 Quote、Award、PO、Delivery Plan、Receipt／收货、Inventory Ledger／库存流水、AP／采购应付、Work Order／生产工单、其他生产记录和财务记录。
- 确认按钮首次触发即同步禁用；双击、幂等和并发只允许一条 `RFQ_ISSUED` Event。权限、CSRF、Origin、CAS、幂等和失败回滚继续 fail closed。

## Binding、摘要与逐行关联合同

- 主展示按稳定 Binding ID `1—8`，不得按 Material code、Supplier code、数组位置或历史摘要输入顺序定义身份。
- 如显示 `3·4·1·2·7·8·5·6`，必须精确标注：“历史摘要规范化输入顺序，仅用于摘要计算，不表示Binding与Material按位置配对。”不得作为主字段或身份表头。
- 权威逐行关联：
  - 1 → Supplier 1 / Line 1 / Material 533 / Mapping `224d1965-44ef-4c3e-901e-1926b6b07ff8`
  - 2 → Supplier 1 / Line 2 / Material 534 / Mapping `43ca04d8-9933-4dac-ba21-b7fb85741830`
  - 3 → Supplier 1 / Line 3 / Material 535 / Mapping `aa16f7e7-904d-4ae2-9f73-d34e7aaf257e`
  - 4 → Supplier 1 / Line 4 / Material 536 / Mapping `9659ad2d-406a-4c4c-b575-51329badc63f`
  - 5 → Supplier 2 / Line 1 / Material 533 / Mapping `45a3daf1-4e97-4a01-a94d-1f3089d3961b`
  - 6 → Supplier 2 / Line 2 / Material 534 / Mapping `5bd2ced5-6696-4e69-a833-e886cf5e273f`
  - 7 → Supplier 2 / Line 3 / Material 535 / Mapping `3ac2ab72-c0dc-4fcf-b1dc-b21e43c3c0d6`
  - 8 → Supplier 2 / Line 4 / Material 536 / Mapping `5432e7fc-463a-4cea-99fe-f3db8cf0af83`

## 测试、备份、部署与主 UAT

- 使用隔离 PostgreSQL 和隔离 Chromium覆盖精确按钮/文案、三类状态分栏、Binding ID 1—8、摘要不变、取消/关闭/ESC 零业务请求、单次发出/CAS/Event、权限/CSRF/Origin/CAS/幂等失败关闭和桌面/390×844零页面横向溢出。
- 所有重任务严格串行并执行低资源门禁；不得降低断言或跳过失败。
- 全部测试通过后才生成 root:root 0600 PostgreSQL custom dump，记录大小/SHA-256，执行 `pg_restore --list`，恢复到第二新空库并核对0039及保护指纹。
- 只替换 Web；不运行 Migration，不重建 PostgreSQL、Worker或Caddy，不修改四个受保护 Volume。
- 部署后只登录 purchase，打开主 RFQ、桌面/390×844打开发出窗口并点击取消；不得点击“确认发出”。业务 POST 0，RFQ保持 DRAFT v2，`RFQ_ISSUED`/Quote/Award/PO仍为0，退出后 Session失效。

## 允许最终状态

- `RFQ ISSUANCE CONFIRMATION FIXED — UAT RFQ STILL DRAFT`
- `RFQ ISSUANCE CONFIRMATION PARTIALLY FIXED — UAT RFQ STILL DRAFT`
- `BLOCKED — NO UNSAFE CHANGE`

完成后立即停止；不发出主 UAT RFQ。
