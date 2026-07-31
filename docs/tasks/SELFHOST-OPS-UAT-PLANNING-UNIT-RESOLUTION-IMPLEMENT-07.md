# SELFHOST-OPS-UAT-PLANNING-UNIT-RESOLUTION-IMPLEMENT-07

## 状态

- 状态：`DONE`
- 开始日期：2026-07-31（Asia/Shanghai）
- 完成日期：2026-07-31（Asia/Shanghai）
- 起点：`main@d06b44f5958527707f38e4c12f0d3143ce31875b`，Parent `525ad2907287d736ecd40d3df24b77c6c5be8ff4`，behind 0 / ahead 107，工作区 clean。
- 起点源码：`0.1.0-alpha.36` / `0001`—`0035`；起点运行面：`0.1.0-alpha.34` / `0034`。完成时源码与并行非生产 UAT 均为 alpha.37/0036。
- 最终允许状态：`VERSIONED REQUIREMENT UNIT RESOLUTION DEPLOYED — UAT PACKAGE UNCHANGED`、`0036 IMPLEMENTED AND VERIFIED — DEPLOYMENT NOT PERFORMED` 或 `BLOCKED — NO UNSAFE CHANGE`。

## 唯一目标

按已确认 D-086 新增版本化 Project Requirement Unit Resolution，解除 Planning Handoff 的单位解析 Schema 阻断；在全部隔离升级、恢复、浏览器和回归门禁通过后，把并行非生产 UAT 串行升级到 0035/0036 并部署 alpha.37。主 UAT 只做升级后只读核对，不确认 PCS、不创建 Planning Package、不登录 planning。

## 数据与服务边界

1. 只新增 `0036_project_requirement_unit_resolution.sql`；0001—0035 不得修改。
2. Unit Resolution Version 只追加，Head 按 Requirement Item 独立单调 CAS；稳定 Unit FK、复合需求归属、服务写 guard、不可 UPDATE/DELETE 和 package provenance 必须由数据库与服务共同保护。
3. `REQUIREMENT_DECLARED` 只用于迁移可证明已有 `unit_pending=false/unit_id` 的明确源单位；`ENGINEERING_CONFIRMED` 只用于获准工程确认。pending/NULL 不回填、不猜测、不从 BOM 推断。
4. 正式 Unit Resolution 写接口显式提交 `requirement_item_id`、`unit_id`、`expected_head_version`，执行 Session、Origin、Cookie/Header CSRF、权限、Idempotency-Key、CAS、输入校验、事务 Audit 与故障零半记录。
5. 只允许 engineering 项目负责人、manager、admin 确认；planning、sales、operations 和其他角色不可确认。
6. 新 Package Item 引用生成时的精确 Unit Resolution Version；后续 Head 变化和 Unit 停用不改历史包。新确认与新包生成都拒绝停用 Unit，历史包仍可读。
7. 错误码区分 `REQUIREMENT_UNIT_UNRESOLVED`、`REQUIREMENT_UNIT_INVALID`、`REQUIREMENT_UNIT_DISABLED`、`REQUIREMENT_UNIT_VERSION_CONFLICT`、`REQUIREMENT_PRODUCT_BOM_UNRESOLVED`，中文提示给出下一步和请求号。

## UI 与测试门禁

- pending 行显示不预选的 enabled Unit 选择器，选项为 `中文名 · CODE`；Product/BOM 与 Unit 分别显示完成状态和缺失项，说明确认不改销售原始需求。
- 所有行完整前禁用生成；保存刷新显示确认单位和 Resolution Version；390px 无页面级横向溢出，角色与错误提示使用中文业务含义。
- 写测试仅使用隔离 PostgreSQL/合成数据，覆盖权限、CSRF/Origin、幂等/CAS/并发、故障注入、Unit 生命周期、不可变事实、多行完整性、固定 package provenance、四物料各 10 PCS、完整退回修订重提接收和 RELEASED BOM 回归。
- 迁移必须覆盖空库 0001→0036、0035→0036、0034→0035→0036、重复执行、失败回滚、约束和脱敏回填/拒绝统计。

## 部署门禁与禁止事项

隔离门禁全部通过后，创建 root:root 0600 停服 custom dump、SHA-256 和 `pg_restore --list`，恢复第二新空库核对；暂停 Web/Worker 写入后串行执行 0035/0036，保持 PostgreSQL Volume、Caddy、公网 Origin/端口不变，只在共享代码确有依赖时更新 Worker。失败立即停止并按已验证恢复方案处理。

禁止访问生产数据库、迁移真实公司数据、修改 Python/SQLite、push、PR、切流、修改 Swap/dockerd/内核/防火墙/systemd、删除受保护 Volume，或读取/修改 `shujvbiao/`。完成后立即停止，业务黑盒续测留给下一独立任务。

## 功能实现与隔离门禁证据

- 源码已更新为 `0.1.0-alpha.37`；只新增 `0036_project_requirement_unit_resolution.sql`，SHA-256 为 `a5ad532837acb0c9704f5c885206cf2ec10c891628c7fe4ed660233468b134a0`。`0001`—`0035` 相对起点无 diff，逐文件 SHA 汇总仍为 `504ba2fdc555135935436fccc8d618225fad47e3de169af9fd9cb7ae99a511c0`，0035 仍为 `d64ec733bb937d8cde11d93d5370605fb7e754ffb0c93d2f9795c8d7b66c9714`。
- 0036 已实现追加式 Resolution Version、Requirement Item 独立 Head/CAS、稳定 Unit FK、同一需求链复合 FK、服务事务写 guard、Version 不可 UPDATE/DELETE、Head 单步推进及 Package Item 精确 provenance。迁移只把 `unit_pending=false/unit_id` 的明确来源记录为 `REQUIREMENT_DECLARED`；pending/NULL 保持未解析。
- 专项测试通过：Migration 6/6、Project PostgreSQL 5/5、Planning PostgreSQL 10/10；适用静态回归 89/89；Identity/Product-BOM/Production Handoff/Routing/Dashboard/Material Requirement PostgreSQL 最终 25/25；`npm test` 3/3；两个 typecheck、lint（0 error，10 条既有 warning）和 Vinext production build 通过。
- 候选镜像：Web `sha256:6667bd2ca64e7255befe4398b4e73ec1fe554418d76062d2d378de8edaa7143e`，Migration runner `sha256:24fcacdc89baf3fdc11afb78441e5b3137d6a775c7cd60c9ff10854b33dcf98f`。Worker 不引用本次 Planning/Project/Schema 共享代码，部署阶段不应替换 Worker。
- 主 UAT 0034 的在线一致隔离备份为 root:root `0600`，SHA-256 `52bd21d05dcb9fda9d98a3a4b8949e2513ba8b818a8c2e60e243cded9f6c19a1`，`pg_restore --list` 通过。恢复库实际按 0035、0036 升级到 36/head 0036，重放无输出；0035/0036 checksum、25 个相关约束、两个业务触发器和全部受保护事实通过核对。
- 回退演练已把升级后的任务恢复库删除，并从同一 0034 备份恢复到第二个新空库；恢复后为 34/head 0034，Requirement、Product/BOM Resolution、Material 533—536、四行 BOM 与 Package `0/0/0` 全部一致。两个演练库均已精确删除。
- 真实 Chromium `1.51.1` 在单个受限临时容器内完成 390×844 全旅程 1/1：PCS 未预选、停用 Unit 不显示、保存刷新 v1、未知 Origin 403、v1 提交/退回、SET v2 修订/重提、四行各 10 PCS、planning 接收、Package v1/v2 精确固定各自 Unit Resolution、源 Requirement 保持 NULL/pending、logout 后 Session 失效。合成业务数据和浏览器容器已清空；没有写主 UAT。
- 隔离门禁结束时 available memory 2.2 GiB、Swap 279 MiB、根盘可用 22 GiB、load `0.61/0.58/0.69`；Web/Worker/PostgreSQL/Caddy 均 restart 0、OOM false，Web/PostgreSQL healthy。

## 正式备份、升级与部署证据

- 隔离门禁全部通过后暂停 Web/Worker 业务写入，创建 root:root `0600` PostgreSQL custom dump；文件大小 2,028,536 bytes，SHA-256 `75e1ffbf2ea846761ece1d4c73dea96e871eca5fcde86d28f24782b10f862df7`，`pg_restore --list` 通过。
- 正式备份恢复到第二个新空数据库后为 34/head 0034；Requirement Item、Product/BOM Resolution、Material 533—536、四行 BOM、Package 0 和保护指纹全部与主 UAT 停服基线一致。恢复测试库随后精确删除；备份作为本任务回退点保留。
- 第一次 Migration runner 在未设置显式生产迁移确认开关时按设计安全拒绝，发生在数据库连接/迁移前；主库仍为 34且 0036 表不存在。随后只对本次用户明确授权的 runner 提供确认开关，按顺序成功应用 0035、0036，最终为 36/head 0036。
- Web 由 `sha256:7e0a3040acd17277db49fc1b7541c072c566e95e12b70bce9170dd39165a6bde` 替换为 alpha.37 `sha256:6667bd2ca64e7255befe4398b4e73ec1fe554418d76062d2d378de8edaa7143e`；旧 Web 保留精确回退 tag。Worker 不引用本次 Planning/Project/Schema 共享代码，继续使用 `sha256:32d1ae335610c097d9fa38dd411acabc525c0fe17cfcb863271e32317afe96aa`；Caddy 未重建，PostgreSQL Volume、公网 Origin/端口和四个受保护卷保持。
- 部署后 `/api/health`、公网首页、匿名业务 401 和安全响应头通过；Web/PostgreSQL healthy，Worker/Caddy running，四服务 RestartCount 0、OOM false。

## 主 UAT 只读验收与保护结论

- 升级前后同一保护查询的指纹均为 `fb71309bf73dce907f0bcb2e294d1b31`。旧 FIX-06 记录的综合指纹 `b239c62091cf51de8fa5b3ff6fb6521a` 所覆盖业务组成事实也未改变；本任务采用可重复的新保护查询作为迁移前后比较值。
- `PRJ-00000001` 仍 ACCEPTED/10；Requirement Item 1 仍 `unit_id=NULL/unit_pending=true`；Product/BOM Resolution 1 仍精确指向 7/7/7/7；Product `UAT-BB-PROD-042576` A0 和 BOM `BOM-UAT-BB-PROD-042576-V1` V1 均 RELEASED；Material 533—536 仍 V3/ACTIVE/PCS，BOM 四行各 1 PCS。
- Unit Resolution Version/Head 为 `0/0`；Planning Package/Item/Event 和待接收为 `0/0/0/0`。没有把 PCS 写回 Requirement Item，没有改变销售需求版本，没有从 BOM 推断 Requirement Unit。
- Engineering 只读 Chromium 在约 390px 视口确认页面显示未预选的 Unit 选择器、`件 · PCS` enabled 选项、Product/BOM 完成、Unit 缺失、保存/生成禁用和无页面级横向溢出；未选择或保存 PCS、未生成 Package、未登录 planning。退出后 Session 失效且受保护 API 返回 401。
- 在正式只读验收前，一次凭据格式探测产生 engineering 登录 401；没有建立 Session、没有业务写或业务指纹变化。后续只在内存中把候选与数据库 PBKDF2 摘要核对，输出不包含账号、密码、摘要、Cookie、Token 或连接信息。
- 浏览器验收后、清理前资源为 available memory 2.2 GiB、Swap 210 MiB/1 GiB、根盘可用 22 GiB、Load `0.36/0.43/0.50`。最终精确清理后为 2.3 GiB/210 MiB/26 GiB/Load `0.30/0.30/0.40`；四服务 restart 0/OOM false，任务 OOM 0。临时库、容器、build worktree、runner、在线隔离 dump 和 Playwright 镜像已清理，正式备份、当前/回退 Web 镜像与四个受保护卷保留。

## 最终结论

技术 Schema 阻断已解除，可由项目负责人在下一独立任务重新开始 engineering 黑盒续测。本任务到此停止，不选择 PCS、不创建或提交主 UAT Planning Package、不登录 planning。

`VERSIONED REQUIREMENT UNIT RESOLUTION DEPLOYED — UAT PACKAGE UNCHANGED`
