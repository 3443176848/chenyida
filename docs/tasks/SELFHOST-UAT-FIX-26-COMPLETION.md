# SELFHOST-UAT-FIX-26 完成报告

## 最终状态

`RFQ ISSUANCE CONFIRMATION FIXED — UAT RFQ STILL DRAFT`

RFQ 发出确认硬性合同已完成并仅替换 Web。主 `RFQ-00000001` 未发出、未重新固定 Binding、未修改 Mapping/Event/摘要或任何下游；最终仍为 DRAFT v2。

## 起点与保护范围

- 起点为 clean `main@f0202b083387c4f60eb5537221b1ce51d2dd93de`、behind 0/ahead 149、`0.1.0-alpha.40`、Migration 0001—0039。
- 0039 SHA-256 为 `3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`，起点 Web 为 `sha256:315f0b7945a7b3eb27841ffaae8a444fba45dd94791519dc856173a95d830635`。
- 主 UAT 起点为 RFQ ID 1 / `RFQ-00000001`、DRAFT v2、Binding 8、`RFQ_MAPPING_CONFIRMED` 1、`RFQ_ISSUED` 0、Quote/Award/PO 0/0/0；完整保护指纹为 `9c7b43774e1d0562785933729d40329a69a3230b5b1580473ac29a2463037d3f`。
- 未修改或运行 Migration；未修改 RFQ、Binding、Mapping、Supplier、PRQ、Material、固定 Event、固定摘要、Quote、Award、PO 或其他业务数据。

## Binding 状态权威分支

- 0039 的 `procurement_rfq_supplier_line_mapping_bindings.binding_status` 是独立的 `text NOT NULL` 字段，CHECK 明确限定为 `ACTIVE`，因此采用“Binding 有独立生命周期状态字段”分支。
- 已固定逐行卡片精确分栏显示：`Binding状态：ACTIVE`、`Mapping状态：ACTIVE`、`邀请状态：INVITED`。
- Binding 固定来源、已绑定 Mapping 版本当前值、最新 Mapping 版本、`状态漂移（Binding ↔ Mapping）` 和 `版本漂移（固定 ↔ 当前）` 分开显示，不再把三个状态或两类漂移合并。
- 尚未固定的资格预览如实显示 `尚未固定（无 Binding 记录）`，不虚构 Binding ACTIVE。因权威模型确有独立字段，本任务不采用“模型无独立状态字段”的替代文案。

## 按钮与完整下游保护合同

- 入口和窗口标题继续为“发出询价并冻结范围”；窗口最终写按钮精确为“确认发出”，并保留“取消”和“关闭确认窗口”。
- 窗口打开后默认焦点为“取消”。取消、关闭、ESC和背景关闭均不包含业务请求；确认首次触发立即同步禁用。
- 确认窗口使用标题“本次发出不会自动创建或修改以下下游记录”，逐项列出：
  - Quote（供应商报价）
  - Award（定标）
  - PO（采购订单）
  - Delivery Plan（交付计划）
  - Receipt／收货
  - Inventory Ledger／库存流水
  - AP／采购应付
  - Work Order／生产工单
  - 其他生产记录
  - 财务记录

## 摘要顺序消歧与权威逐行关联

- 已保存 Binding、`canonicalDigest`、固定摘要和 `RFQ_MAPPING_CONFIRMED` Event 均未修改。固定摘要始终为 `9765f8fdef768335a25b314867dd3e077429a84848cba067ff8394c8a017848d`。
- 主展示和固定凭证均按数值 Binding ID 升序显示 `1 · 2 · 3 · 4 · 5 · 6 · 7 · 8`；身份说明固定为数据库 Binding ID及外键字段权威，摘要规范化计算与身份展示相互独立，不按任何摘要输入序列位置配对。
- 旧序列 `3 · 4 · 1 · 2 · 7 · 8 · 5 · 6` 已退出确认窗口身份主字段；文档中的解释口径为：“历史摘要规范化输入顺序，仅用于摘要计算，不表示Binding与Material按位置配对。”

| Binding | Supplier | RFQ Line | Material | Mapping |
| --- | --- | --- | --- | --- |
| 1 | 1 | 1 | 533 | `224d1965-44ef-4c3e-901e-1926b6b07ff8` |
| 2 | 1 | 2 | 534 | `43ca04d8-9933-4dac-ba21-b7fb85741830` |
| 3 | 1 | 3 | 535 | `aa16f7e7-904d-4ae2-9f73-d34e7aaf257e` |
| 4 | 1 | 4 | 536 | `9659ad2d-406a-4c4c-b575-51329badc63f` |
| 5 | 2 | 1 | 533 | `45a3daf1-4e97-4a01-a94d-1f3089d3961b` |
| 6 | 2 | 2 | 534 | `5bd2ced5-6696-4e69-a833-e886cf5e273f` |
| 7 | 2 | 3 | 535 | `3ac2ab72-c0dc-4fcf-b1dc-b21e43c3c0d6` |
| 8 | 2 | 4 | 536 | `5432e7fc-463a-4cea-99fe-f3db8cf0af83` |

## 自动测试与隔离发出

- UI合同 `10/10`、采购寻源 Unit `8/8`、隔离 PostgreSQL `20/20`、隔离 Chromium `2/2`、0039 Migration合同 `6/6`、`npm test` `3/3`、Python self-test/smoke/go-live `3/3` 全部通过。
- procurement-sourcing typecheck、production build/postbuild、`git diff --check` 和凭据扫描通过（功能树1,231文件、最终文档树1,232文件）；lint为0 error / 11个既有任务外 warning。
- 隔离 Chromium验证最终按钮精确文案、完整下游列表、Binding/Mapping/INVITED状态分栏、Binding ID稳定排序、固定摘要不变、桌面及390×844无页面级横向溢出。
- 取消、关闭、ESC等五个零写退出路径均为0业务请求；确认按钮同步禁用，双击只形成一个 issue POST。
- 隔离成功发出只产生一条 `RFQ_ISSUED` Event和一次 `DRAFT v2→ISSUED v3` CAS，canonical摘要保持不变，Quote/Award/PO及全部列明下游为0。
- purchase以外角色、缺失CSRF、错误Origin、过期CAS、幂等正文冲突继续失败关闭；未降低断言、跳过用例或连接生产数据执行写测试。

## 正式备份、恢复与 Web-only 部署

- 正式备份：`/var/backups/chenyida-erp/rfq-issuance-confirmation-fix26-predeploy-20260806T030837Z.dump`，root:root、0600、单硬链接、2,284,946 bytes，SHA-256 `b810d5a588a0a262ace478569815e1ca7e8c84dab7218368d435d8400263497d`。
- `pg_restore --list` 为3,359行。第二个全新数据库 `rfq_issuance_fix26_restore_20260806` 恢复后为39/head 0039、226张 public 表，业务保护指纹仍为 `9c7b43774e1d0562785933729d40329a69a3230b5b1580473ac29a2463037d3f`；恢复库已删除，正式 dump 保留。
- 仅把 Web 从 `sha256:315f0b7945a7b3eb27841ffaae8a444fba45dd94791519dc856173a95d830635`（88,545,226 bytes）替换为 `sha256:c8c3fdd52236b84e3ceb67f7b81ca2e5530bfaba964a92ebd22dab9f7da19989`（88,546,098 bytes）。旧 Web 保留为 `rollback-rfq-issuance-confirmation-fix26-predeploy-20260806T030837Z`。
- 没有运行 Migration；PostgreSQL、Worker、Caddy容器 ID未改变，四个受保护 Volume未重建或修改。内外 health均通过，四服务RestartCount 0、OOMKilled false。

## 主 UAT 只读验收

- 只登录 `uat_20260729_purchase`，只允许 Session和 RFQ详情 GET；浏览器路由直接拦截任何非登录/退出业务写。
- 桌面及390×844均核对 DRAFT v2、八条 Binding 1—8及全部权威关联、三类独立状态、固定摘要、最终“确认发出”按钮和完整下游保护；两次均只点击“取消”，从未点击“确认发出”。
- runner结果：`issue_cancel=2`、`business_post=0`、desktop 1、mobile 1、Session 0。
- 前后均为 Binding 8、`RFQ_MAPPING_CONFIRMED` 1、`RFQ_ISSUED` 0、Quote/Award/PO 0/0/0；Delivery Plan、Receipt、Ledger、AP、Work Order等全部下游仍为0，RFQ保持DRAFT v2，保护指纹完全一致。

## Git、资源与清理

- 功能提交：`f6f7d2a`，`fix: clarify rfq issuance confirmation`。部署、主 UAT、清理、D-098和完成文档由独立 `ops: deploy rfq issuance confirmation contract` 提交收口；该提交的实际SHA以`git log`为准。
- 未push、PR、amend、rebase、reset、stash、restore或改写历史；版本保持alpha.40，Migration保持0001—0039。
- 起点资源约为available memory 2.1 GiB、Swap 279 MiB、根盘19 GiB、Load `0.38/0.37/0.30`；最终为2.0 GiB、Swap 283 MiB、根盘19 GiB、Load `0.12/0.17/0.32`。任务期间Swap最高约296 MiB，所有门禁均高于停止阈值。
- 任务窗口内核OOM记录0，四服务RestartCount 0、OOMKilled false。隔离测试库、恢复库、临时容器、Playwright runtime、standalone目录和临时SQLite均已精确清理；未prune。正式备份、当前/候选/rollback Web镜像和四个受保护Volume保留。

## 后续边界

当前技术确认合同已经完整，但本任务不授权正式发出。后续只有在新的明确任务中重新读取当前CAS、Binding、摘要、Mapping、PRQ和截止日后，项目负责人才可决定是否点击“确认发出”。本任务到此停止，不发出主UAT RFQ。
