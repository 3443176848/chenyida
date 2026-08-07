# SELFHOST-UAT-FIX-32 — Award to PO Conversion Confirmation Contract Fix

## 状态、授权与起点

- 状态：`DONE`。
- 日期：2026-08-07（Asia/Shanghai）。
- 授权：把现有“显式生成采购订单”入口改为安全两阶段合同；完成服务端权威预览、最终确认事务、隔离正式转换测试、正式备份恢复、Web-only 部署和 purchase-only 主 UAT 打开/核验/取消。主 UAT 明确禁止最终确认或创建 PO、到货计划及任何收货、库存、品质、财务或生产记录。
- 精确起点：`main` / `c5af2fa1f8dbcfbb523b91cd00b63a91e9d72a8a`，Parent `a0147429d9b463650242c2115f0222b75008edeb`，behind 0 / ahead 167，工作区 clean，单一 worktree，无并发 Award/PO 任务；`0.1.0-alpha.40`；Migration 0001—0039；Web `sha256:bb544f89ac405c9565fa551c4120c89d4cc58022220db9a3f46c548a6533a81d`。
- 起点只读核验：RFQ 1 `CLOSED/v7`、Quote 2、Comparison Version 1、Award 1 `AWARDED/v1`、Award Line 4、PO 0、Delivery Plan 0、`po_convertible_now=true`、`awardable_now=false`。

## 根因与模型结论

1. 当前履约工作区按钮的单次点击直接调用 `POST /api/procurement/awards/:id/purchase-orders`，把“打开确认界面”和“提交不可逆业务写”合并为一次动作。
2. `purchase_orders` 有正常的 header `remark` 字段，现有采购服务约束为最多 2,000 字；没有外部参考字段。页面允许填写 PO 备注，并准确显示“当前PO模型未采集外部参考”；不得挪用税务、地址、物料或其他字段，也不得新增 0040。
3. Delivery Plan 模型没有独立 header/line 两层：`purchase_delivery_plans` 的每个记录是一个独立计划聚合，并以唯一约束直接绑定一条 PO Line。主样本应由服务端计算为一个转换操作、一个 PO、四条 PO Line、四个 Delivery Plan、四个收货队列条目和四个计划 CREATED Event；不存在独立 Delivery Plan Line 记录。

## 两阶段确认合同

- 第一次点击只发权威 GET，重新读取 Award、RFQ、Comparison、固定 Quote、Award Event、两类摘要、完整四行、当前 PO/计划计数、Supplier/付款条件和模型能力；GET 使用只读一致快照且不产生业务 POST。
- 窗口的取消、关闭、ESC和背景关闭均只关闭本地界面；默认焦点位于取消。最终按钮第一次触发即同步锁定；双击只能发一个 POST，失败后不自动重试。
- 最终 POST 只提交 CAS、摘要、完整行 ID 集、当前 PO 计数等确认断言和可选 PO 备注。浏览器不得提交或决定 Supplier、Material、数量、单价、币种或 Award Line 范围。
- 服务端必须重新计算预览并在事务中锁定和复核 Award/RFQ/PRQ、完整且唯一的 Award Line、Comparison/Quote 来源、Supplier/Mapping、Award/RFQ CAS、两类摘要、PO 零计数及正文摘要；任一漂移失败关闭。

## 最终事务边界与下游保护

- 成功事务按 `supplier_id + currency` 确定性聚合 PO；每条 Award Line 固定创建一条 PO Line和一条直接绑定该 PO Line 的 Delivery Plan，并同事务写 Award→PO Line Link、PO/计划 Event、收货队列、成功 Audit 和幂等响应。
- 故障必须回滚 PO、PO Line、Link、Delivery Plan、队列、Event、Audit和幂等成功结果，不留半记录；不同幂等键并发只有一个成功，同键同正文重放原响应。
- 转换不得自动创建 Receipt、Warehouse Receipt、Inventory Ledger、IQC、AP、Payment、Work Order 或其他生产/财务记录；供应商到货、仓库收货和 IQC 必须由后续独立任务执行。

## 测试、部署与主 UAT

- 串行覆盖入口/全部退出零 POST、默认焦点、完整谱系/摘要/四行、字段模型提示、单 POST/双击、`1 PO / 4 PO Line / 4 Delivery Plan`、固定 Award Line 引用、上游不变、下游全零、幂等、错 Award、过期 CAS、缺/重行、并发、故障回滚、桌面与 390×844、既有 RFQ/Award/PO/0039/安全回归。
- 不新增或运行 Migration。自动测试通过后执行 root:root 0600 正式 custom dump、SHA-256、`pg_restore --list` 和第二新数据库恢复验证；只构建并替换 Web，不重建 PostgreSQL、Worker 或 Caddy，不修改受保护 Volume。
- 主 UAT 只登录 purchase，打开 Award 1 的转换窗口、核对桌面与 390×844、填写备注但不最终确认、取消、刷新并安全退出。业务 POST 必须为 0，PO和Delivery Plan前后均为0，Award仍AWARDED/v1，RFQ仍CLOSED/v7。

## 实施、部署与验收记录

- 前端已把入口改为无缓存权威 GET；Loading 与最终确认窗口均可取消。最终按钮在 DOM 事件内同步禁用，并由同步 ref 锁保证 React 重绘前双击也只有一个请求；失败后本窗口保持锁定，不自动重试，必须关闭后重新获取权威预览。
- 服务端预览严格校验原生整数计数、Quote 未过期、税费/运费布尔值及非空付款条件。最终 POST 只接受确认断言和正常 PO `remark`；当前模型没有外部参考字段。金额显示使用六位十进制 BigInt half-up 到分，不截断。
- 最终写事务先完成幂等回放判定，再在 Award advisory lock 下复用同一事务连接重算完整 Sourcing/Award 预览；不会在持有写连接时再次从连接池取连接。随后锁定 Award/RFQ/PRQ/Line/Quote/Mapping 并创建 PO、Line、Link、逐行 Plan、队列、Event、成功 Audit 和幂等响应。
- 隔离 PostgreSQL 通过：强制故障后 PO/Line/source link/status event/Award link/Plan/queue/Plan event/成功 Audit/幂等键全部为0；`max=2`连接池双并发得到一个201和一个409。四行正式隔离转换为`1 PO / 4 PO Line / 4 Delivery Plan / 4 queue`，上游不变，Receipt/Ledger/IQC/AP/Payment/Work Order均为0。
- 隔离 Chromium 通过：延迟 preview 在 Loading 窗口取消后不会复活；取消、关闭、ESC、背景关闭均0 POST；失败最终 POST恰好1且500ms内0重试；重新打开后成功双击只新增1 POST。桌面与390×844无页面级横向溢出。
- 回归通过：Fulfillment Unit4/UI3/PG3，Sourcing Unit12/UI24、Sourcing/Binding PG27，0018/0019/0039隔离升级`3/3 + 3/3 + 6/6`，安全30，npm3，Python self-test/smoke/go-live，typecheck、production build、lint 0 error/11既有warning、1,273文件凭证扫描及diff check。候选Web为`sha256:2396c8bc4fd5658c26cef11c4a438b2edb474607b73b2b8ee7fe337b125575ed`、88,626,192 bytes，受限临时容器health 200/ok。
- 正式dump为`/var/backups/chenyida-erp/award-po-confirmation-fix32-predeploy-20260807T144538Z.dump`，root:root、0600、单硬链接、2,294,098 bytes，SHA-256`75e45758f3f220f118ec98c8e2351274c4e640aa3c046507a2b294cebdaf3d97`，`pg_restore --list`3,359项。第二新库恢复39/head、226表、四个basis摘要、Award/Line/Event和下游全0后删除。
- 仅替换Web`bb544f89…→2396c8bc…`；旧Web保留FIX32精确回退tag。PostgreSQL、Worker、Caddy与四个受保护Volume未重建或更换，未运行Migration。
- 主UAT只登录purchase；桌面与390×844打开转换窗口、核验完整合同、填写备注、取消、刷新和安全退出通过：`preview_get=1`、`business_post=0`、PO/Plan前后0、Session0。首次流程已完成取消和logout，但验收器错误等待该履约页未维护的sourcing专用auth dataset而超时；只读核验Session/PO/Plan均0后，断言改为该页真实“请先登录。”匿名UI，复验通过。
- 最终available约2.1 GiB、Swap239 MiB、根盘18 GiB、Load`0.71/0.38/0.62`；任务时段和本次启动内核OOM0，四服务restart0/OOM false。隔离/恢复库、临时容器、浏览器runtime和Python测试临时资源已清零；正式dump、当前/候选/回退镜像及四卷保留。
- 功能提交`a4ffb8ee022234ea25add4ce636050366ac6887a`；部署/UAT/完成文档由独立`ops: deploy Award to PO confirmation fix`提交收口。未push、未PR、未改写历史。

最终状态：`AWARD TO PO CONFIRMATION FIXED — UAT PO NOT CREATED`。真正执行主UAT转换必须另立任务、重新取得明确授权并重验当时全部权威事实。

## 完成条件

- 更新 `MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`DECISIONS.md`、`CHANGELOG.md`、`STATUS.md`、`RELEASES.md`、采购设计文档和本任务完成报告。
- 功能与部署验收分别创建独立提交；不 push、不 PR、不改写历史。
- 最终状态只能是 `AWARD TO PO CONFIRMATION FIXED — UAT PO NOT CREATED`、`AWARD TO PO CONFIRMATION PARTIALLY FIXED — UAT PO NOT CREATED` 或 `BLOCKED — NO UNSAFE CHANGE`。
