# SELFHOST-UAT-FIX-19 完成报告

## 最终结论

`RFQ PURCHASE REQUEST ID BINDING FIXED — UAT RFQ NOT CREATED`

合法 Purchase Request ID `1` 的 RFQ 草稿绑定问题已经修复。代码、隔离 PostgreSQL、隔离 Chromium、适用回归、正式备份恢复、Web-only 部署和主 UAT 未提交表单验收全部完成。主 UAT 没有创建 RFQ、Quote、Award 或任何下游记录。

## 严格起点与范围

- 起点为 clean `main@5a7cb547a07b1e113d89c51366fc099d851fe1cb`，Parent `9d6ed0d0bc728bdaafc619fe609d92d87ebcb188`，`origin/main...HEAD` behind 0/ahead 129。
- 版本为 `0.1.0-alpha.38`，Migration 为 `0001`—`0037`；0037 SHA-256 始终为 `139f2623a184ae3d6927c95b56569cc438deffc2a0b46c325c9f04d59471d99f`。
- 起点 Web 为 `sha256:6eeba6409f51605fe422c39d674ddfa03d5f5079bb546566288336f15296df64`；PostgreSQL/Web healthy，Worker/Caddy running，四服务 RestartCount 0、OOM false。
- 唯一业务范围是 RFQ 草稿的 Purchase Request 稳定 ID 绑定；未增加 0038、未改 Schema、状态机、Origin、端口、凭据、Worker、Caddy 或四个受保护 Volume。

## 精确根因与请求 DTO

PostgreSQL 驱动把 `bigint` Purchase Request ID 返回为字符串 `"1"`。页面 `<option>` 的可见值和实际 value 都来自同一个稳定数据库 ID `1`，但旧提交代码执行：

```text
requests.find(row => row.id === Number(form.get("purchase_request_id")))
```

因此运行时比较为 `"1" === 1`，结果为 false。选中的 request 被丢成 `undefined`，并不是字段名不一致、用户清空、失效闭包、表单重置或按标签反向解析。系统从未按 PRQ 编号、项目名或显示文本反查 ID。

修复前，页面 FormData 明明含 `purchase_request_id="1"`，但构造的对象为：

```javascript
{
  purchase_request_id: undefined,
  "supplier_ids": [1, 2],
  "response_deadline": "2026-08-31",
  expected_version: undefined
}
```

`JSON.stringify` 会省略两个 `undefined` 字段，故真正发送的正文为：

```json
{"supplier_ids":[1,2],"response_deadline":"2026-08-31"}
```

旧幂等正文摘要也因此错误绑定该残缺正文，SHA-256 为 `e1198033af6320925fc21c5fa79804ecb1237473a4b3eeb3304d6ccb9f84d5a7`。Handler 收到缺失 ID 后按原有门禁返回 `REQUEST_VALIDATION_FAILED / purchase_request_id 必须是正整数`；失败 request_id `e2d8caab-a39d-4756-894b-329ae548e3f5` 及失败审计保持不变。

修复后，主 UAT 当前 PRQ version 只读值为 `2`，对应规范 DTO 为：

```json
{"purchase_request_id":1,"supplier_ids":[1,2],"response_deadline":"2026-08-31","expected_version":2}
```

该主 UAT DTO 只在未提交表单边界核验，没有发送。隔离环境以自己的当前 version `1` 实际发送并成功创建 RFQ。

## 稳定 ID、校验与幂等规则

- Purchase Request `<option value>` 只使用稳定数据库 ID 的十进制字符串；显示仍为 PRQ 编号和项目编号/名称。Supplier checkbox 同样只使用稳定 Supplier ID。
- `buildCreateRfqDraftRequest` 在请求边界执行一次明确的 canonical decimal→safe positive integer 转换；不接受标签、PRQ 编号、对象字符串、布尔值、数组或对象。
- Supplier 选择先验证仍属于当前 ACTIVE 列表，再转换、去重并按数值排序；本轮目标精确规范为 `[1,2]`，不依赖 API 返回顺序。
- UI、Handler、Service 和测试统一使用 `purchase_request_id`、`supplier_ids`、`response_deadline`、`expected_version`。
- Handler 在创建路由先规范正文，再计算 canonical idempotency digest；Service 对直接调用再次规范，并以同一规范正文覆盖 digest。数字 `1/[2,1]` 与十进制字符串 `"1"/["1","2"]` 规范为同一摘要；相同 key 异正文仍冲突。
- 服务端继续拒绝空值、0、负数、小数、NaN、指数/十六进制/带空格等非规范十进制文本、布尔值、数组和对象；错误仍有稳定代码、中文提示和 request_id。
- PRQ 存在/ACCEPTED/latest、purchase 权限与对象范围、Supplier 存在/ACTIVE/Mapping、四条来源、同 PRQ 活动 Round 唯一、CAS、CSRF、Origin、事务、审计和幂等门禁均未放宽。

## 隔离 RFQ 旅程与回归

| 验证组 | 结果 | 关键证据 |
| --- | --- | --- |
| RFQ unit/UI | PASS 6/6 + 4/4 | ID 1 数字 DTO、标签/对象拒绝、Supplier 1/2 去重、切换/重渲染、日期/四行、中文错误和 390×844 |
| RFQ PostgreSQL | PASS 5/5 | 既有 2 项加 FIX-19 3 项；稳定 ID、重放/冲突、并发、权限/状态/供应商、故障回滚 |
| 隔离 Chromium | PASS 1/1 | purchase 登录，选择 PRQ 1 与 Supplier 1/2，唯一创建一个 DRAFT，刷新后四行/双 Supplier 保持，桌面/390×844，退出 Session 失效 |
| 适用静态/UI | PASS 68/68 + guard 6/6 | Purchase Request、Sourcing、Supplier、Inventory、Identity、CSRF、Origin、CAS、Idempotency |
| Schema/Migration | PASS 4/4 + sourcing upgrade 3/3 | 空库/0036→0037/重放/失败回滚；0037 与 checksum 一致 |
| 适用 PostgreSQL | PASS | Material Requirement 8/8、Master/Supplier/BOM 6/6、Mapping 6/6、Inventory 3/3、Identity/CSRF/Origin/CAS/Idempotency 10/10 |
| 基线与构建 | PASS | procurement typecheck、`npm test` 3/3、production build、credentials 1,166 files、`git diff --check`、Python 3/3 |
| Lint | PASS | 最终 0 error / 10 个既有 warning；未修改或降低断言 |

隔离 PostgreSQL 使用合成 ACCEPTED PRQ、Material 533—536 各 10 PCS 和两个 ACTIVE Supplier：

- 合法稳定 ID 创建一个 DRAFT RFQ，头固定引用 PR ID 1，四行分别绑定四条 PRQ 行，两个 Supplier 各一次。
- 同 key 的规范等价正文重放返回同一 RFQ；异正文冲突。同 PRQ 两个不同 key 并发结果为一个 201、一个 409。
- 非 ACCEPTED、不存在、额外跨项目字段/越权、重复/停用/无 Mapping Supplier 均拒绝。
- `after_rfq_saved` 故障注入后 RFQ 头、四行、Supplier 邀请、Event、成功 Audit 和 Idempotency 全部零增量。
- 创建隔离 RFQ 后 Quote、Award、PO、Delivery Plan、Receipt、Ledger、AP、Work Order 仍全部为 0。

Mapping 套件第一次在 0037 全库运行时，5 个业务断言通过，唯一静态断言因该历史套件要求 migration head 恰好为 0035 而失败；未修改断言，随后在专用 0001—0035 空库完整通过 6/6。Lint 最初两次分别在 768 MiB/1024 MiB Node heap 出现 V8 heap exhaustion，定位为本任务临时 Chromium standalone 的 1,795 个生成文件被 ESLint 扫描；精确删除该临时目录后，同一完整 lint 命令通过。

## 正式保护、备份与恢复

- 主 UAT 保护指纹在任务起点、部署前主库、第二新空恢复库、部署后/UAT 前、每次只读 runner 安全中止后和最终 UAT 后均为：`fc48f001fe3b0afaff69ac245a1fefc8bf6731d38358004314cc12daa308cff4`。
- 指纹固定 PR ID 1 / `PRQ-00000001` / `PRJ-00000001` / ACCEPTED、Purchase ACCEPT/RETURN `1/0`、Material 533—536 各 10 PCS、Supplier ID 1/2、原失败证据、非敏感身份计数和全部下游零事实。
- 正式备份：`/var/backups/chenyida-erp/rfq-binding-fix19-predeploy-20260804T042603Z.dump`，root:root 0600，2,188,178 bytes。
- 备份 SHA-256：`55e169b4ad372391117aea6c042aa1ec3d87a9e85e01dbbba1456b9f9ecc3a28`；`pg_restore --list` 3,285 项通过。
- 第二新空库 `erp_fix19_restore_verify` 恢复为 223 个 public table、37/head 0037；0037 checksum、身份计数及完整保护指纹与主库一致。首次恢复调用的客户端参数在读取 dump 前被 `pg_restore` 拒绝；确认该库仍为 0 表后使用正确参数完整恢复并通过。恢复库已精确删除，正式备份保留。

## Web-only 部署与主 UAT

- Web 镜像从 `sha256:6eeba6409f51605fe422c39d674ddfa03d5f5079bb546566288336f15296df64`（88,472,258 bytes）更新为 `sha256:6622029fb3c401d1b71f10047e53021147bb386cf3dedb3208d1dfba6c7636d0`（88,474,348 bytes）。
- 旧镜像保留为 `chenyida-erp-parallel-web:rollback-rfq-binding-fix19-predeploy-20260804T042812Z`。部署使用 `--no-deps --no-build --force-recreate web`；没有运行 Migration。
- 只有 Web 容器 ID 变化。PostgreSQL `f3a2f3cb…`、Worker `fb68d9a8…`、Caddy `c209765b…` 的容器 ID/创建时间不变；内外 health 200，四服务 RestartCount 0、OOM false。
- 主 UAT 最终 runner 只使用 `uat_20260729_purchase`，通过浏览器上下文登录后直接打开采购寻源页；唯一可选 PRQ value 为 `1`，唯一 Supplier value 集合为 `1/2`。页面显示 PRQ/项目、四行和 40.000000 PCS；选择两个 Supplier 和日期后表单为合法可提交状态，但没有点击“建立询价草稿”。
- 桌面和 390×844 均无页面级横向溢出；选择在 viewport 重渲染后保持。随后显式清空 PRQ、Supplier 和日期并安全退出。
- 最终 runner：business POST 0、auth POST 仅 login/logout、非允许 API GET 0、Session revoked。前置 runner 曾分别因折叠 `<option>` 的 visibility 语义、Supplier 返回顺序和被主动阻断的工作台 `/api/summary` 断言安全中止；都发生在提交前，写路由始终拦截，保护指纹和活动 Session 每次复核均不变。最终 runner 改为 attached/集合核验并直接进入目标页，完整通过。
- 主 UAT 前后 RFQ/Quote/Award 均为 `0/0/0`；PO、Delivery Plan、Receipt、Ledger、AP、Work Order 均为 0。现有 PRQ、两个 Supplier 和失败证据未修改。

## 资源、OOM 与清理

- 起点：available memory 约 2.2 GiB，Swap 258 MiB / 1 GiB，根分区可用约 21 GiB，Load `0.42/0.35/0.31`。
- 终点：available memory 约 2.2 GiB，Swap 266 MiB / 1 GiB，根分区可用约 20 GiB，Load `0.19/0.22/0.45`。
- 任务窗口内核 OOM 0；四个常驻容器 RestartCount 0、OOMKilled false。上述两次 lint 是临时 Node 进程自身的 V8 heap exhaustion，不是内核 OOM，也未影响常驻容器；精确清理后 lint 通过。
- FIX-19 隔离/迁移/恢复 PostgreSQL 数据库 0、临时 Chromium/Node/Python 容器 0、Playwright/Python/SQLite 任务目录 0、Worker 临时保护脚本 0。未 prune，四个受保护 Volume 完整保留。
- 正式备份、当前/候选/回退 Web 镜像按设计保留；没有删除任何未知资源。

## Git 与后续边界

- 功能提交：`23d654c383015864be9a2ade71e78d94eb77adaf`，`fix: bind rfq draft to stable purchase request id`。
- 运维/验收提交：`ops: accept rfq draft binding fix`，实际 SHA 以 `git log` 为准。
- 未 push、创建 PR、amend、rebase、reset、stash、restore 或改写历史。
- 可以在新的明确授权任务中重新开始采购寻源黑盒试用，并从单个 RFQ 草稿开始；Quote、Award、转 PO 和其他下游仍须按各自授权边界执行。本任务立即停止，不自动创建主 UAT RFQ。
