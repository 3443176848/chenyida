# SELFHOST-UAT-FIX-25 完成报告

## 最终结论

`RFQ BINDING BASELINE CORRECTED — UAT RFQ STILL DRAFT`

本任务采用分支 B。PostgreSQL 的八条 Binding 外键链、对应 Mapping fact/version 和固定范围摘要全部一致；当前 Repository/DTO/UI 也直接携带同一行的真实 `binding.id`，没有身份重配错误。错误来自把某次页面的显示顺序 ID 列表 `3,4,1,2,7,8,5,6` 与 RFQ Line/Material 顺序 `533,534,535,536` 按位置做 zip。该派生基线现已作废并由下表取代。

## 严格起点与只读保护

- 起点为 clean `main@08af2f4`，Parent `e329931`，behind 0 / ahead 148；源码/运行面 `0.1.0-alpha.40`，Migration `0001—0039`。
- 0039 SHA-256 为 `3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`；Web 为 `sha256:315f0b7945a7b3eb27841ffaae8a444fba45dd94791519dc856173a95d830635`。
- 只对 RFQ ID 1、两个 RFQ Supplier、四条 RFQ Line、八条 Binding、对应八条 Mapping、唯一 Mapping Event 及 Quote/Award/PO 计数执行 `REPEATABLE READ READ ONLY` 查询。未运行会扩大读取范围的旧保护脚本。
- 没有使用直接 SQL 修复，没有读取或输出主 UAT/运行面凭据、Token、Cookie 或 Session 内容，没有登录任何角色，没有发出 RFQ 或创建 Quote/Award/PO。

## 根因与页面旧值/新值

- 数据库按 Binding 主键排序时为 `1—8`；FIX-24 页面源码按 Supplier code、Material code、Binding ID 对完整 DTO 行排序，因此其已记录的显示顺序为 `3,4,1,2,7,8,5,6`。两者只是不同排序视图。
- Repository 明确投影 `b.id::text AS binding_id`，并以 RFQ Supplier、RFQ Line 和 Mapping fact/version 外键连接；Service 和 UI 对完整行对象排序、分组和渲染。排序不拆开字段，也不根据位置生成 ID。
- FIX-24 完成报告的逐行明细表原本正确；高层文档只写“八个 ID 为 `3,4,1,2,7,8,5,6`”，没有强调它只是显示顺序。把该列表与 Material 533—536 的 RFQ 行顺序做位置 zip，形成了错误关联。
- 页面旧值与新值：**无 UI 值变化、无 Web 部署**。页面逐行身份保持正确；本次只把文档从含混的“显示顺序列表”更正为“逐行权威关联表”，并明确禁止位置 zip。显示顺序以后即使变化，也不得改变身份配对。

## 作废的错误基线

以下关联是由位置 zip 派生的错误基线，现被明确替代：

| 错误 Binding ID | 错误 Supplier / Material | 被错误配对的 Mapping UUID |
| ---: | --- | --- |
| 3 | 1 / 533 | `224d1965-44ef-4c3e-901e-1926b6b07ff8` |
| 4 | 1 / 534 | `43ca04d8-9933-4dac-ba21-b7fb85741830` |
| 1 | 1 / 535 | `aa16f7e7-904d-4ae2-9f73-d34e7aaf257e` |
| 2 | 1 / 536 | `9659ad2d-406a-4c4c-b575-51329badc63f` |
| 7 | 2 / 533 | `45a3daf1-4e97-4a01-a94d-1f3089d3961b` |
| 8 | 2 / 534 | `5bd2ced5-6696-4e69-a833-e886cf5e273f` |
| 5 | 2 / 535 | `3ac2ab72-c0dc-4fcf-b1dc-b21e43c3c0d6` |
| 6 | 2 / 536 | `5432e7fc-463a-4cea-99fe-f3db8cf0af83` |

## 权威八条 Binding 关联表

下表按数据库 `binding.id` 排序。`RFQ Supplier/Supplier` 和 `RFQ Line/Material` 分别是稳定外键两端；Unit 均为内部 Unit ID 1 与供应商 Unit ID 1，换算均为 `1:1`。

| Binding ID | RFQ | RFQ Supplier / Supplier | RFQ Line / Material | Mapping fact / Version / CAS | Mapping UUID | supplier_part_number | Unit / 换算 | Binding / Mapping 状态 |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 1 / 1 | 1 / 533 | 1 / v1 / 3 | `224d1965-44ef-4c3e-901e-1926b6b07ff8` | `UAT-A-PCBA-042576` | 1→1 / 1:1 | ACTIVE / ACTIVE |
| 2 | 1 | 1 / 1 | 2 / 534 | 2 / v1 / 3 | `43ca04d8-9933-4dac-ba21-b7fb85741830` | `UAT-A-SENSOR` | 1→1 / 1:1 | ACTIVE / ACTIVE |
| 3 | 1 | 1 / 1 | 3 / 535 | 3 / v1 / 3 | `aa16f7e7-904d-4ae2-9f73-d34e7aaf257e` | `UAT-A-HARNESS` | 1→1 / 1:1 | ACTIVE / ACTIVE |
| 4 | 1 | 1 / 1 | 4 / 536 | 4 / v1 / 3 | `9659ad2d-406a-4c4c-b575-51329badc63f` | `UAT-A-CASE` | 1→1 / 1:1 | ACTIVE / ACTIVE |
| 5 | 1 | 2 / 2 | 1 / 533 | 5 / v1 / 3 | `45a3daf1-4e97-4a01-a94d-1f3089d3961b` | `UAT-B-PCBA` | 1→1 / 1:1 | ACTIVE / ACTIVE |
| 6 | 1 | 2 / 2 | 2 / 534 | 6 / v1 / 3 | `5bd2ced5-6696-4e69-a833-e886cf5e273f` | `UAT-B-SENSOR` | 1→1 / 1:1 | ACTIVE / ACTIVE |
| 7 | 1 | 2 / 2 | 3 / 535 | 7 / v1 / 3 | `3ac2ab72-c0dc-4fcf-b1dc-b21e43c3c0d6` | `UAT-B-HARNESS` | 1→1 / 1:1 | ACTIVE / ACTIVE |
| 8 | 1 | 2 / 2 | 4 / 536 | 8 / v1 / 3 | `5432e7fc-463a-4cea-99fe-f3db8cf0af83` | `UAT-B-CASE` | 1→1 / 1:1 | ACTIVE / ACTIVE |

核验结果为：Binding 8、Binding ID 唯一 8、Supplier×Line 唯一组合 8；RFQ Supplier 外键错配 0、RFQ Line/Material 外键错配 0、Mapping fact/version/UUID/快照错配 0、重复 0、孤儿 0、跨 RFQ 0。

## 固定范围摘要

- 使用当前源码的权威 `canonicalDigest`，对 RFQ 1 的四行、两个 RFQ Supplier 和上表八条不可变 Binding 按服务端 `frozenScope` 规则规范化。
- 重新计算值为 `9765f8fdef768335a25b314867dd3e077429a84848cba067ff8394c8a017848d`。
- 唯一 `RFQ_MAPPING_CONFIRMED/SUCCESS` Event 保存值与重新计算值完全一致；没有修改摘要以使其通过。

## 前后业务状态与数据改写

| 项目 | 起点 | 终点 |
| --- | ---: | ---: |
| RFQ ID / 状态 / Version | 1 / DRAFT / v2 | 1 / DRAFT / v2 |
| Binding | 8 | 8 |
| `RFQ_MAPPING_CONFIRMED` | 1 | 1 |
| `RFQ_ISSUED` | 0 | 0 |
| Quote / Award / PO | 0 / 0 / 0 | 0 / 0 / 0 |

业务数据改写为 **0**；业务 POST 为 **0**。没有重建、删除、重排或重新编号 Binding，没有修改 RFQ、Event、Audit、PRQ、Supplier、Mapping、Material 或任何下游记录。

## 测试、备份、恢复与部署

- 分支 A 的新增代码、隔离 PostgreSQL/Chromium和响应式验收不适用，因为没有代码/UI缺陷需要修复；未连接主 UAT 执行写测试。
- 文档-only 回归全部通过：断网、只读源码挂载的 Node 容器运行 `npm test` 为 `3/3`、采购寻源 Unit 为 `8/8`、UI 合同为 `9/9`；项目 Python venv 在自动/显式临时 SQLite 中运行 `server.py --self-test`、`smoke_test.py`、`go_live_check.py --no-backup` 三项通过。
- 最终凭据扫描为 `CREDENTIAL_CHECK_OK (1228 repository files scanned)`，`git diff --check` 通过。前两次把扫描器放入精简 Web runtime 时因该镜像没有 Git而在扫描前失败；未跳过断言，随后改用仓库既有、断网、只读挂载的 `node:22-bookworm` 完整复验通过。
- 备份、`pg_restore --list`、第二空库恢复和 Web-only 部署均不适用且未执行；没有运行 Migration，没有重建 PostgreSQL、Worker 或 Caddy，没有更换 Volume。

## Git、资源与清理

- 本任务只修改项目治理文档和任务报告；独立提交消息为 `docs: correct rfq binding association baseline`，实际 SHA 以 `git log` 为准。未 push/PR、rebase、amend、reset、stash、restore 或改写历史。
- 重任务全部串行；起点约 available memory 2.2 GiB、Swap 279 MiB、根盘 19 GiB、低 Load，终点为 2.1 GiB、278 MiB、19 GiB、Load `0.36/0.17/0.11`。任务窗口内核 OOM 0，Web/Worker/PostgreSQL/Caddy均 RestartCount 0、OOMKilled false。
- 摘要复算与 Node 回归临时容器均断网、只读挂载、受限内存并自动删除；显式 go-live 临时 SQLite目录已精确删除。最终运行容器仅四个常驻服务，未 prune，四个受保护 Volume不变。

## 停止边界

任务到此停止。`RFQ-00000001` 仍为 DRAFT，不发出 RFQ，不录入报价、不定标、不创建 PO。任何正式发出仍须新的明确授权和当时的 CAS、Binding、摘要、Mapping、PRQ、截止日重验。
