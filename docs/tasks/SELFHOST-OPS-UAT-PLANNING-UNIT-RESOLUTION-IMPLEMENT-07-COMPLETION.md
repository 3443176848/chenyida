# SELFHOST-OPS-UAT-PLANNING-UNIT-RESOLUTION-IMPLEMENT-07 完成报告

## 最终结论

`VERSIONED REQUIREMENT UNIT RESOLUTION DEPLOYED — UAT PACKAGE UNCHANGED`

D-086 已由 alpha.37/0036 正式落地到源码和并行非生产 UAT。Project Requirement Unit Resolution 现在是追加式版本事实，每个 Requirement Item 有独立 CAS Head；新 Planning Package Item 固定引用生成时采用的精确 Resolution Version，不再从 nullable 源需求或 BOM Line 推断单位。

全部业务写旅程只在隔离 PostgreSQL 和合成数据中执行。主 UAT 只迁移 Schema、部署 Web并做 Engineering 只读验收：没有选择或保存 PCS，没有生成 Planning Package，没有登录 planning。Requirement Item、Product/BOM/Material 与 Package 基线保持。

## Git、版本与范围

- 起点：`main@d06b44f5958527707f38e4c12f0d3143ce31875b`，Parent `525ad2907287d736ecd40d3df24b77c6c5be8ff4`，`origin/main...HEAD = behind 0 / ahead 107`，工作区 clean。
- 功能提交：`91c0fd29d534246c55ddd669e894cdde9b774e52`，`feat: add versioned requirement unit resolution`。
- 运维/文档提交：`ops: deploy requirement unit resolution in parallel environment`。该提交包含本报告，不能在自身内容中稳定写入自身 SHA；最终 SHA、ahead 数和 clean 状态以提交后的 `git log`、`git status --short --branch` 为准。
- 包版本由 `0.1.0-alpha.36` 升至 `0.1.0-alpha.37`，`package.json` 与 `package-lock.json` 同步。
- 唯一新增 Migration：`0036_project_requirement_unit_resolution.sql`；SHA-256 `a5ad532837acb0c9704f5c885206cf2ec10c891628c7fe4ed660233468b134a0`。
- `0001`—`0035` 相对起点没有 diff，逐文件 SHA 汇总仍为 `504ba2fdc555135935436fccc8d618225fad47e3de169af9fd9cb7ae99a511c0`；0035 SHA-256 仍为 `d64ec733bb937d8cde11d93d5370605fb7e754ffb0c93d2f9795c8d7b66c9714`。
- 未修改 Python/SQLite 或历史 Sites/D1，未访问生产数据库、迁移真实公司数据、切流、push、创建 PR 或改写历史。
- 未读取、修改或提交 `shujvbiao/`；env、连接串、账号、密码、Cookie、Token、Session 摘要、备份与数据库正文未进入 Git 或本报告。

## 0036 数据模型与不可变边界

`project_requirement_unit_resolution_versions` 是追加式事实表，保存稳定 Project、Requirement Version、Requirement Item、Unit、来源类型、supersedes、actor、request 和 canonical digest。复合外键证明 Version 属于同一需求链；稳定 Unit ID 由外键保护。

`project_requirement_unit_resolution_heads` 为每个 Requirement Item 保存 current resolution 和独立单调 `head_version`。正式 API 必须显式提交 `requirement_item_id`、`unit_id` 与 `expected_head_version`；Repository 在事务内锁定 Head 并执行 CAS，并发相同 expected version 只有一个成功。该版本不复用不会随单位确认递增的 Project Version。

- Version 只允许受控服务事务 INSERT；数据库 trigger 禁止 UPDATE/DELETE。
- Head 只能由受控服务设置写 guard 后逐步推进；调用者不能直接更新或跳版本。
- `ENGINEERING_CONFIRMED` 只表示获准工程/管理角色通过正式 API 明确确认。
- `REQUIREMENT_DECLARED` 只用于 Migration 可由既有 `unit_pending=false` 且稳定 `unit_id` 直接证明的来源单位；不会冒充工程人工确认。
- `unit_pending=true`、NULL、名称、Product、BOM 或 BOM Line Unit 一律不回填、不猜测。当前主 UAT 因此产生 0 个 Resolution。
- 新 Package Item 保存精确 `unit_resolution_id`；Package/source digest 覆盖 Resolution。后续 Head 变化或 Unit 停用不改变历史 Package。
- 新确认和新 Package 都重新校验 Unit 存在且 enabled；历史 Package 在 Unit 后续停用时仍可追溯读取。
- 0036 前既有 Package 的 nullable provenance 不猜测回填；本次主 UAT原本且最终都没有 Package。

## 正式 API、安全、审计与事务

正式 Unit Resolution API 只允许 engineering 项目负责人、manager、admin 或现有授权等价角色确认；planning、sales、operations 和其他角色由服务端返回 403。浏览器名称、代码和 BOM 只作展示，不参与反向解析。

所有写请求在业务事务前后保持以下合同：

1. Session、可信 Origin、Cookie/Header 双提交 CSRF、角色权限、请求大小与输入校验。
2. `Idempotency-Key` 绑定 canonical body；同正文重放返回同一结果，异正文同 Key 返回 `IDEMPOTENCY_CONFLICT`。
3. Head expected version CAS；并发相同 expected version 单胜，失败返回 `REQUIREMENT_UNIT_VERSION_CONFLICT`。
4. Unit Resolution Version、Head、Audit 与 Idempotency 在同一 PostgreSQL 事务；故障注入后四者都不留半记录。
5. Unit 错误拆分为 `REQUIREMENT_UNIT_UNRESOLVED`、`REQUIREMENT_UNIT_INVALID`、`REQUIREMENT_UNIT_DISABLED`；Product/BOM 缺失为 `REQUIREMENT_PRODUCT_BOM_UNRESOLVED`。中文提示包含下一步和 request_id，不返回 SQL、堆栈或敏感正文。

Planning Package 创建事务锁定并读取当时 Head 的精确 Resolution Version，重验 Unit enabled 与 Product/BOM Resolution 完整性，再把 Unit、Resolution provenance、BOM Snapshot、Audit 和 Idempotency 原子写入。源 Requirement Item 仍不可变。

## UI 结果

- `unit_pending=true` 且尚无 Resolution 的需求行显示只含 enabled Unit 的选择器，文本为 `中文名称 · CODE`；不自动预选 PCS。
- Product/BOM 与 Unit 分别显示完成/缺失；页面列出具体缺失行与缺失项，并说明单位确认不会改写销售原始需求。
- 行未完整解析时生成交接包禁用；保存后刷新显示已确认 Unit 和 Resolution Version。
- engineering、planning 等角色显示中文业务含义；稳定错误码、中文建议和 request_id 同时可见。
- 390×844 的隔离与主 UAT只读验收均无页面级横向溢出。

## 自动测试与隔离浏览器

所有写测试使用隔离 PostgreSQL 和合成数据，串行执行：

- Migration PostgreSQL：6/6。
- Project PostgreSQL：5/5。
- Planning PostgreSQL：10/10。
- 适用静态/handler/UI 回归：89/89。
- Identity、Product/BOM、Production Handoff、Routing、Dashboard、Material Requirement 等适用 PostgreSQL 回归：25/25。
- `npm test`：3/3。
- Project 与 Planning 两组 typecheck：通过。
- lint：0 error，10 个既有 warning。
- Vinext production build：通过。
- 最终凭据扫描：`CREDENTIAL_CHECK_OK`，1,259 个仓库文件；`git diff --check` 通过。

真实 Chromium 1.51.1 的隔离 390×844 全旅程为 1/1，覆盖：

- pending/无 Resolution 时拒绝 Package，PCS 不预选，停用 Unit 不显示。
- 显式选择 enabled PCS 后保存刷新 v1；NULL、未知、停用 Unit 和未知 Origin 拒绝。
- 多行必须全部完成，不从 BOM Line 推断 Requirement Unit。
- Version 追加、旧 Version 不可修改；Head CAS、并发单胜；幂等重放与异正文冲突。
- 无权角色 403、CSRF 拒绝、故障注入零半记录。
- Package v1/v2 分别固定各自 Resolution；Head 后续推进不改变历史 Package。
- 四个 BOM Material 各生成 10 PCS；提交、退回、SET v2 修订、重提、planning 接收完整回归。
- RELEASED Product/BOM 仍不可修改；源 Requirement 仍 NULL/pending；logout 后 Session 失效。

首次浏览器 runner 虽通过业务断言，但复核发现目标保护规则过宽；最终 runner 改为专用 `127.0.0.1:43136` 精确 Origin、阻断 Service Worker、POST 白名单和不忽略 HTTPS 错误后重新取得 1/1。此前容器挂载失败或断言数 0 的执行没有计为通过。

## Migration 隔离升级与回退

Migration 门禁实际完成：

1. 新空 PostgreSQL 串行执行 0001→0036。
2. 0035 基线执行 0035→0036。
3. 从主 UAT 0034 在线一致 dump 恢复隔离库，再严格执行 0035→0036。
4. 对已经到 0036 的隔离库重放 Migration，无重复副作用。
5. 检查 0035/0036 checksum、Schema、25 个相关约束、两个业务 trigger 和业务保护事实。
6. 故障阶段回滚；另把升级测试库删除，并从相同 0034 dump 恢复第二个新空库验证回退到 34/head 0034。

在线一致隔离 dump 为 root:root 0600，SHA-256 `52bd21d05dcb9fda9d98a3a4b8949e2513ba8b818a8c2e60e243cded9f6c19a1`，`pg_restore --list` 通过。0034→0035→0036 后 Requirement、Product/BOM Resolution、Material 533—536、BOM 四行与 Package 0 全部一致；回退恢复结果也相同。两个隔离演练库随后精确删除。

## 正式停服备份与第二库恢复

- custom dump 大小：2,028,536 bytes。
- 所有者/权限：root:root，0600。
- SHA-256：`75e1ffbf2ea846761ece1d4c73dea96e871eca5fcde86d28f24782b10f862df7`。
- `pg_restore --list`：通过。
- 第二新空数据库恢复：通过；结果为 34/head 0034，保护事实和迁移前指纹完全一致。
- 第二恢复库核对后删除；正式备份保留作为 0034 回退点，不冒充异故障域灾备。

## 并行非生产 UAT 升级与镜像

Web/Worker 暂停业务写入，PostgreSQL 与 Caddy 保持运行。第一次 Migration runner 因缺少显式迁移授权开关在连接/迁移前安全拒绝；核对主库仍为 34且 0036 表不存在。随后只对本次用户明确授权的 runner 提供确认开关，严格依次应用 0035、0036，最终为 36/head 0036。

| 组件 | 升级前 | 升级后 | 结论 |
| --- | --- | --- | --- |
| Web | `sha256:7e0a3040acd17277db49fc1b7541c072c566e95e12b70bce9170dd39165a6bde` | `sha256:6667bd2ca64e7255befe4398b4e73ec1fe554418d76062d2d378de8edaa7143e` | 只替换 Web；旧镜像保留精确回退 tag |
| Worker | `sha256:32d1ae335610c097d9fa38dd411acabc525c0fe17cfcb863271e32317afe96aa` | 相同 | 不引用本次 Planning/Project/Schema 共享代码，未替换 |
| Migration runner | N/A | `sha256:24fcacdc89baf3fdc11afb78441e5b3137d6a775c7cd60c9ff10854b33dcf98f` | 只用于受控 0035/0036 串行升级 |
| Caddy | 既有镜像/容器 | 相同 | 未重建；Origin 与端口不变 |
| PostgreSQL Volume | 既有受保护卷 | 相同 | 未重建、删除或替换 |

旧 Web 回退 tag 为 `chenyida-erp-parallel-web:pre-0036-20260731-2143`。公网 `/api/health`、首页 200、匿名业务 API 401、HSTS、Permissions-Policy、Referrer-Policy、nosniff 与 frame deny 通过。

## 主 UAT 升级前后数据证明

本任务采用同一可重复保护查询，在迁移前、正式备份第二库恢复后和主库迁移后都得到 `fb71309bf73dce907f0bcb2e294d1b31`。FIX-06 旧报告的较宽综合查询指纹 `b239c62091cf51de8fa5b3ff6fb6521a` 所覆盖业务组成事实也没有变化；两者不混写为同一查询。

| 对象 | 升级前 0034 | 升级后 0036 | 结论 |
| --- | --- | --- | --- |
| `PRJ-00000001` | ACCEPTED，数量 10 | 相同 | 未变 |
| Requirement Item 1 | `unit_id=NULL`、`unit_pending=true`、数量 10 | 相同 | 未回填 PCS |
| Product/BOM Resolution 1 | Product/Product Version/BOM/BOM Version `7/7/7/7` | 相同 | 未变 |
| Product Version 7 | `UAT-BB-PROD-042576` / A0 / RELEASED | 相同 | 未变 |
| BOM Version 7 | `BOM-UAT-BB-PROD-042576-V1` / V1 / RELEASED | 相同 | 未变 |
| Material 533—536 | V3 / ACTIVE / `base_uom=PCS` | 相同 | 未变 |
| BOM 四行 | 各 1 PCS | 相同 | 未变 |
| Unit Resolution Version/Head | 表不存在 | `0/0` | 未确认 Unit |
| Planning Package/Item/Event | `0/0/0` | `0/0/0` | 未创建 Package |
| Planning 待接收 | 0 | 0 | 未登录 planning |
| Migration | 34/head 0034 | 36/head 0036 | 仅受控 Schema 升级 |

## 主 UAT Engineering 只读验收

真实 Chromium 只允许 `/api/login`、`/api/logout` 两个 POST，其他 POST 由 runner 主动阻断。Engineering 页面确认：

- pending 行出现空 Unit 选择器，enabled 选项包含 `件 · PCS`；没有自动选中。
- Product/BOM 显示完成，Unit 显示缺失；保存/生成交接包不可执行。
- 约 390px 无页面级横向溢出。
- 没有选择/保存 PCS，没有生成/提交 Package，没有登录 planning。
- logout 后 Session 失效，受保护 API 返回 401。

正式只读验收前，一次凭据格式探测产生 engineering 登录 401；没有创建 Session、没有业务写。随后 runner 只在内存中将候选与数据库 PBKDF2 摘要核对后再登录；没有输出账号、密码、摘要、Cookie、Token 或连接信息。该失败认证不影响保护指纹。

## 资源、健康与清理

- 起点：available memory 约 2.2 GiB，Swap 233 MiB/1 GiB，根盘可用 26 GiB，Load `0.24/1.05/0.88`。
- 隔离门禁结束：available 2.2 GiB，Swap 279 MiB，根盘 22 GiB，Load `0.61/0.58/0.69`。
- 部署与主 UAT浏览器验收后、最终清理前：available 2.2 GiB，Swap 210 MiB/1 GiB，根盘 22 GiB，Load `0.36/0.43/0.50`。
- 最终清理后：available memory 2.3 GiB，Swap 210 MiB/1 GiB，根盘可用 26 GiB，Load `0.30/0.30/0.40`；全部值高于 AGENTS.md 停止阈值。
- Web/PostgreSQL healthy，Worker/Caddy running；四服务 RestartCount 均为 0，OOM 均为 false，本任务 OOM 事件为 0。
- Build、Migration、数据库测试、dump/restore、Compose Web 替换和浏览器全部串行，一次只有一个临时重任务容器；未修改 Swap、dockerd、内核、防火墙或 systemd。
- 本任务创建的隔离/恢复数据库、临时 build worktree、浏览器 runner、在线隔离 dump 和任务拉取的 Playwright 镜像均已精确删除；任务临时容器为 0。正式停服备份、当前 Web 镜像、旧 Web 精确回退 tag 与四个受保护 Volume 保留。
- 未执行 `docker system prune -a`、`docker volume prune` 或广泛 cache 清理。

## 后续决定

Project Requirement Unit Resolution 的 Schema、服务、安全和 UI 技术阻断已解除，可以在下一独立任务重新开始 engineering 黑盒续测。下一任务必须从主 UAT 当前 `Unit Resolution=0`、`Planning Package=0` 起点显式选择并确认 enabled Unit；不得自动推断 PCS、改写销售 Requirement Item 或修改 RELEASED Product/BOM。

本任务不授权生产访问/迁移/部署、真实公司数据迁移、Product/BOM 修订、Planning 登录、Package 创建、凭据轮换、push、PR 或切流。

`VERSIONED REQUIREMENT UNIT RESOLUTION DEPLOYED — UAT PACKAGE UNCHANGED`
