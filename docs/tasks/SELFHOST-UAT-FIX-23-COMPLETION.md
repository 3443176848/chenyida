# SELFHOST-UAT-FIX-23 完成报告

## 结论

`RFQ BINDING PREVIEW FIXED — UAT BINDINGS STILL ZERO`

RFQ Mapping 固定确认现已显示服务端当前权威资格、两家 Supplier 各 4/4、两类冲突计数、八条逐组合 Mapping 证据及不可变关系化快照说明。主 UAT `RFQ-00000001` 只执行 purchase 登录、预览、ESC/取消和安全退出；未生成 Binding、未发出 RFQ、未录 Quote、未定标、未创建 PO。

## 严格起点与范围

- 起点：clean `main@7cd9cd011e…`，Parent `b339acd97f…`，`origin/main...HEAD` behind 0 / ahead 144；唯一 worktree，无嵌套 Git。
- 版本保持 `0.1.0-alpha.40`；Migration 保持 `0001—0039`，0039 SHA-256 为 `3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`。未新增或修改 Migration/Schema。
- 起点 Web 为 `sha256:58d97778d88d6103ca4d6cc3e0bfe8033bf0921a6c1b7ecbec31254403792651`；PostgreSQL/Web healthy，Worker/Caddy running，四服务 RestartCount 0、OOM false。
- 起点与最终保护指纹均为 `9d4641b1b6324de4e3a1a26e7461ca2e15bd7613cb99a277c11e6bca869ac66e`。

## 预览权威查询与冲突定义

- 新增受 `procurement.rfq.manage` 和 RFQ/PRQ 数据域保护的 `GET /api/procurement/rfqs/:id/mapping-bindings/preview?expected_version=...`。服务以 `REPEATABLE READ READ ONLY` 事务重新读取 RFQ/PRQ CAS、四条 Line、两家 Supplier、Material、当前 Mapping、有效期、单位、1:1 换算、稳定 Supplier part claim、已有 Binding 与下游计数；成功或失败都不写 Audit、Event、Idempotency 或 Binding。
- 预览返回 RFQ/PRQ 稳定 ID 和当前 Version、`observed_at`、`Asia/Shanghai`、总体计数、逐 Supplier 覆盖和逐 Supplier×RFQ Line Mapping ID/Version/CAS/content/status/有效期/冲突/资格，以及稳定 `qualification_digest`。
- Supplier/Material 冲突定义为同一组合当前有效、ACTIVE、1:1 Mapping 数量不等于 1；供应商料号冲突定义为同一 Supplier 内相同标准化 supplier part 存在多个 ACTIVE Mapping或稳定占用属于其他 Mapping UID。缺失、失效、Supplier/Material 非 ACTIVE、邀请漂移、重复 ACTIVE、part 冲突、PRQ/RFQ/CAS 漂移、非 DRAFT、既有任意 Binding 或下游均失败关闭，并返回稳定代码、中文原因和处理建议。
- 正式固定 POST 与预览共用同一个 Service 资格加载器；事务内先锁 RFQ、PRQ、Line、Supplier、Material、Mapping，再复核 actor 数据域、全部资格和预览摘要。摘要不是提交锁，CAS、幂等、并发单胜、故障回滚及关系化 Binding 约束均未放宽；预览后数据变化返回稳定冲突且生成零 Binding。

## UI 与创建凭证措辞

- 点击“确认并固定当前 Mapping”先显示权威查询加载态；取消为默认焦点。通过后直接显示服务端观测时间、两家 `4/4`、缺失 0、Supplier/Material 冲突 0、供应商料号冲突 0、候选/预期 8、当前 Binding 0及八张可读 Mapping 卡；资格通过前确认按钮禁用。
- 窗口明确：“确认后将生成8条关系化、不可变的Supplier×RFQ Line Mapping Binding”；每条 Binding 固定本次 Mapping ID/Version，后续 Mapping 变化不会自动替换或改写。固定不等于发出，RFQ 继续 DRAFT，不创建 Quote/Award/PO/库存/财务，正式发出仍需独立确认。
- 主历史 RFQ 标题改为“RFQ 创建成功审计”，明确这是与 RFQ ID、actor、时间、request_id 和 Version 变化精确匹配的 SUCCESS Audit，不是独立 `RFQ_CREATED` 业务 Event。新 RFQ 的 `RFQ_CREATED` 使用“RFQ_CREATED 业务 Event”独立标签；Event 与 Audit 在页面分列。
- 取消、关闭、ESC 都只关闭本地窗口；桌面和 390×844 无页面级或窗口级横向溢出，长 Mapping ID、request_id 与资格摘要可换行复制。

## 自动测试

- Unit/UI：`8/8 + 8/8`，覆盖通过、两家 4/4、零冲突、不可变说明、缺失/部分覆盖/冲突/失效、Audit/Event 区分、加载/错误/取消/关闭/ESC及 390px。
- 隔离 PostgreSQL：Sourcing/FIX-23 `19/19`。覆盖正常 2×4 预览且零写、3/4、重复 Supplier/Material ACTIVE、supplier part 冲突、Mapping 失效/版本漂移、部分 Binding、越权/跨数据域 403、预览后漂移 POST 零 Binding、正常恰好 8、幂等、并发单胜和 Quote/Award/PO 0。
- 隔离 Chromium：`2/2`。FIX-23 场景证明取消/关闭/ESC 零业务写，隔离正式固定一次恰好 8，RFQ 仍 DRAFT、ISSUED/Quote/Award/PO 0，桌面/390px和 Audit/Event 措辞通过，Session 0。
- Migration/回归：0018 upgrade `3/3`；FIX-22/0039 `6/6`（空库/升级/重复/失败回滚及 schema/snapshot/journal 契约）；Material Requirement `18/18`；基础 `npm test` `3/3`；environment guard `6/6`。
- 静态/构建：最终 procurement-sourcing typecheck、目标 lint、production build/postbuild、1,222 文件 credentials scan、`git diff --check` 通过；全量 lint 为 0 error / 11 个既有 warning。Python `server.py --self-test`、`smoke_test.py`、隔离 `go_live_check.py` 三项通过，临时 SQLite/备份已删除。
- Schema consistency 说明：FIX-22 的 0039 schema/snapshot/journal 契约为 `6/6`。`db:generate` 在任务树与原始 `7cd9cd0` 独立副本均会提出只将两个既有 `supplier_mappings` CHECK 表达式表限定化的语义等价 0040；这是起点既有 Drizzle 表达漂移。生成物已立即丢弃，本任务没有新增 0040、修改 0001—0039 或改 Schema。

## 备份、恢复与 Web-only 部署

- 备份：`/var/backups/chenyida-erp/rfq-binding-preview-fix23-predeploy-20260805T131610Z.dump`，root:root、0600、单硬链接、2,282,691 bytes，SHA-256 `ef5855252729ec072886e14a0dc4d40bac839b407989a63c8f3baab9fe7ece77`。
- `pg_restore --list` 为 3,359 行；第二新空库恢复后为 39/head 0039、226 张 public 表，保护指纹与主库完全一致。恢复库和 list 临时文件已精确删除，正式备份保留。
- 只替换 Web：`sha256:58d97778d88d6103ca4d6cc3e0bfe8033bf0921a6c1b7ecbec31254403792651` → `sha256:5fe406949d4678d5beb06ba6db4d931f88f5f24989332654b557b8a4f9df6e4b`（88,543,673 bytes）。旧 Web 保留 `rollback-rfq-binding-preview-fix23-predeploy-20260805T131610Z`。
- 未运行 Migration，未重建 PostgreSQL/Worker/Caddy，三者容器 ID、Worker 镜像、Origin、端口和四个受保护 Volume 保持；Web/PostgreSQL healthy，Worker/Caddy running，四服务 RestartCount 0、OOM false。

## 主 UAT 只读结果

- 唯一 purchase-only Chromium 一次通过：RFQ ID 1 / `RFQ-00000001` / Round 1 / DRAFT v1，PRQ ID 1 / `PRQ-00000001` 固定/current v2，四条 Line、两家 ACTIVE Supplier和八条 ACTIVE Mapping不变。
- 创建区域准确显示“RFQ 创建成功审计”：actor `uat_20260729_purchase`、Asia/Shanghai `2026-08-05 15:24:26.684817`、request_id `75078325-3b3a-4d1e-b911-99cbd5f802db`、SUCCESS、`不存在→v1`，并明确不是独立 RFQ_CREATED Event；业务 Event 区独立且为空。
- 两次预览 GET 均返回 `qualification_passed=true`、Supplier 1 `4/4`、Supplier 2 `4/4`、缺失 0、Supplier/Material 冲突 0、供应商料号冲突 0、八条 Mapping、预期 Binding 8、当前 Binding 0。桌面按 ESC、390×844 按取消；没有点击确认。
- 最终：`business_post=0`、Binding 0、RFQ DRAFT v1、RFQ Event/ISSUED 0、Quote/Award/PO `0/0/0`、Session 0；最终保护指纹仍为 `9d4641b1b6324de4e3a1a26e7461ca2e15bd7613cb99a277c11e6bca869ac66e`。

## Git、资源与清理

- 功能提交：`f919890436662265bb22e2bec9ae00f5c2761372`，`fix: expose rfq mapping qualification evidence`。部署、只读 runner、最终 UAT 和项目文档由独立 `ops: deploy rfq binding preview safeguards` 收口；实际 SHA 以 Git log 为准。
- 起点资源约 available memory 2.1 GiB、Swap 234 MiB、根盘 20 GiB、Load `0.09`；最终约 2.3 GiB、Swap 268 MiB、根盘 19 GiB、Load `0.43/0.36/0.54`。任务期内核 OOM 0，四服务 RestartCount 0、OOMKilled false。
- 五个隔离测试库、第二恢复库、临时 Chromium runtime、go-live SQLite/备份、list 文件、临时容器和 validation image 均已精确清理；未执行全局 prune。正式备份、当前/rollback Web 镜像和四个受保护 Volume 保留。

## 是否可以重新执行 Mapping 固定

技术资格证据已补齐，主 UAT 当前两家 4/4、两类冲突 0、八条 Mapping均通过，因此可以在**新的明确业务授权任务**中重新执行一次显式 Mapping 固定。该操作仍必须使用新预览和 CAS/幂等保护；本任务不授权也未执行。固定成功后 RFQ 仍应保持 DRAFT，实际发出还必须再次取得独立授权；当前不得直接发出或录报价。
