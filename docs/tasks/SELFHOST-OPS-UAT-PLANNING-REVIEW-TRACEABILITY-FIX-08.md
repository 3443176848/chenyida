# SELFHOST-OPS-UAT-PLANNING-REVIEW-TRACEABILITY-FIX-08

## 状态

- 状态：`BLOCKED`
- 开始日期：2026-08-01（Asia/Shanghai）
- 起点：`main@a254bca5d59dd3f17047c9d6495dfdf2df1a798e`，Parent `91c0fd29d534246c55ddd669e894cdde9b774e52`，behind 0 / ahead 109，工作区 clean。
- 源码与运行面：`0.1.0-alpha.37`；PostgreSQL 为 36/head `0036_project_requirement_unit_resolution.sql`，0036 SHA-256 `a5ad532837acb0c9704f5c885206cf2ec10c891628c7fe4ed660233468b134a0`。
- 运行 Web：`sha256:6667bd2ca64e7255befe4398b4e73ec1fe554418d76062d2d378de8edaa7143e`。
- 最终允许状态：`PLANNING REVIEW TRACEABILITY FIXED — UAT V1 STILL PENDING`、`HISTORICAL PACKAGE TRACEABILITY GAP — UAT V1 UNCHANGED` 或 `BLOCKED — NO UNSAFE CHANGE`。

## 唯一目标

只补齐 Planning Handoff 审核详情的只读查询合同、不可变快照来源、固定单位解析来源和 Package 范围事件追溯展示；不修改状态机、Migration、版本、Product、BOM、Material、Package、Resolution、Event、Audit 或 UAT Package v1。

## 权威来源结论

- Package 稳定 ID、版本、完整摘要、创建人/时间在 `project_planning_packages`；创建请求号只从该 Package 的 `PLANNING_PACKAGE_PREPARED/success` 审计事实读取，不把当前可变 `request_id` 冒充创建请求。
- SUBMIT/RETURN/ACCEPT 只从 `project_planning_handoff_events` 读取操作者、时间、请求号、原因和结果。
- Package Item 固定 `unit_resolution_id` 指向 `project_requirement_unit_resolution_versions`；不得读取 Head 冒充 Package 快照。源 Requirement Item 仍为不可变 `unit_id=NULL/unit_pending=true`，与工程 Resolution 并列展示。
- Product/BOM 稳定 ID 来自 Package Item 及其稳定关联；0036 没有生成时状态列，因此页面只能说明“Package 创建时服务端已通过 RELEASED 门禁”，并把当前状态另列，证据指向 Package 创建服务门禁。
- 物料名称、正式编码来自 Package BOM Line 的 `specification_snapshot`，Material ID、单位、单耗、损耗率和毛需求来自同一 Package 固定行事实。

## 受保护 UAT 起点

- `PRJ-00000001`，Package ID 1 / v1 / `SUBMITTED`，摘要前缀 `9d7a6a7ec9aefbaf`；Package 总数 1、v2 为 0、RETURN/ACCEPT 事件为 0。
- Unit Resolution ID 1 / v1 / `ENGINEERING_CONFIRMED` / Unit ID 1 / `件 · PCS`；Package Item 固定引用 Resolution ID 1，源销售单位仍待确认。
- Product `UAT-BB-PROD-042576` / A0 / RELEASED，BOM `BOM-UAT-BB-PROD-042576-V1` / V1 / RELEASED；Material 533—536 各 `1 PCS` 单耗、0 损耗、`10 PCS` 毛需求。
- 本轮不接收、不退回、不创建 v2，不登录 engineering；部署后 planning 只读浏览、退出并确认会话失效。

## 实施与验收边界

1. 复用 `planning.read` / `planning.accept`，只允许通过获准 Package 详情读取该 Package 自身的创建事实与事件，不增加 `system.audit.read` 或任何其他权限。
2. DTO 明确区分 Package Snapshot、固定 Unit Resolution、创建时服务门禁证据和当前 Product/BOM 状态；时间统一转换为 Asia/Shanghai 并标注时区。
3. 详情页显示稳定 ID、完整摘要、责任队列、无具体接收人/SLA 空状态、CREATE/SUBMIT/RETURN/ACCEPT 时间线、单位边界、Material ID 与正式编码，并说明接收/退回后果。
4. 约 390px 无页面级横向溢出；物料宽表切换为卡片/摘要，完整摘要和请求号可换行或复制，按钮和退回原因完整可见。
5. 隔离 PostgreSQL 与合成数据串行覆盖 Package 范围授权、不可变来源、固定 Resolution Version、Product/BOM 证据区分、RETURN/ACCEPT 终态按钮、CSRF/Origin/权限和既有 Identity/Planning/Project/BOM/Unit Resolution 回归；隔离 Chromium 完成查看→退回旅程。
6. 不新增 0037、不修改 0001—0036、不改变 alpha.37。全部门禁通过后创建 root:root 0600 PostgreSQL 备份并完成 `pg_restore --list` 与第二新空库恢复，只替换 Web；PostgreSQL、Worker、Caddy不重建，主 UAT 不运行 Migration。

## 部署前实施结果

- 详情查询改为单连接 `REPEATABLE READ READ ONLY`：先校验 `planning.read` 与 Package 对象范围，再只投影该 Package 的创建审计和不可变事件；不存在返回 404，工程跨项目或 planning 猜读 DRAFT 返回稳定 403。
- CREATE 请求号使用 `PLANNING_PACKAGE_PREPARED/success + detail.object_id` 精确匹配，并校验操作者、时间与 Package Snapshot 一致；SUBMIT/RESUBMIT/RETURN/ACCEPT 使用 Package Event，不读取系统级审计，也没有授予 planning `system.audit.read`。
- DTO 显式返回 Package/Version/完整摘要、责任队列、固定 Unit Resolution、Product/BOM 稳定 ID 与当前状态、创建服务门禁证据、Material ID 和不可变物料快照；没有把当前关联状态冒充生成时快照。
- 页面统一以 `Asia/Shanghai` 显示并标注时区；完整摘要和请求号可换行、复制；约 390px 时物料表切换为四张摘要卡，接收/退回说明、必填原因和新文案完整可见，终态显示只读原因。
- 版本仍为 `0.1.0-alpha.37`，Migration 仍为 0001—0036；0036 SHA-256 未变。

## 部署前测试结果

- 适用 Node 回归：103/103，通过 Identity、Project、Planning、Product/BOM、CSRF、Origin、Unit Resolution Migration 与文件存储基线。
- Planning 专项：unit 4/4、UI 7/7、PostgreSQL 11/11；包含另一 Package 审计诱饵、DRAFT/跨项目 403、CREATE/SUBMIT 请求号、固定 Resolution v1、当前状态分栏、四个 Material ID 和 RELEASED BOM 不可变回归。
- `typecheck:planning`、`typecheck:project`：通过；lint：0 error、10 个既有 warning；凭据扫描：通过（1,117 个仓库文件）。
- 隔离 Chromium 1.51.1：1/1。390×844 无页面级或物料区横向溢出；合成 v1 完成查看→退回，Package 仅 1 个、v2/ACCEPT 为 0，销售源单位仍 NULL/pending，退出后 Session 失效。首次运行只因时区说明也被计入事件数量而在退回前结束，不计为通过；收紧断言后重跑通过。
- 候选 Web：`sha256:6b94a9c73a182799ffad6df5f89ecb86e5407162f0f233e8741aea3fd9dc4e25`。该镜像随后按下述 Web-only 边界部署；未登录主 UAT planning。

## 备份、恢复与 Web-only 部署结果

- 部署前业务指纹为 `a7869b3ae5d75b7b68fac1234e04288c755622ee3f549497b2c96dc366701679`。root:root 0600 PostgreSQL custom dump 为 2,131,480 bytes，SHA-256 `25c302316d415602825d1d9d85e8456a5c46db5c4167cc5f8da27b0ea8f42ff2`；`pg_restore --list` 通过，第二新空库恢复后为 36/head 0036、0036 SHA-256 与预期一致，业务指纹仍为 `a7869b3ae5d75b7b68fac1234e04288c755622ee3f549497b2c96dc366701679`。
- 旧 Web 已保留精确回退 tag，只把 Web 从 `sha256:6667bd2ca64e7255befe4398b4e73ec1fe554418d76062d2d378de8edaa7143e` 替换为 `sha256:6b94a9c73a182799ffad6df5f89ecb86e5407162f0f233e8741aea3fd9dc4e25`。PostgreSQL、Worker、Caddy 容器未重建；公网 Origin、端口边界、四个受保护 Volume、alpha.37 和 0001—0036 均保持。
- 部署后同一业务指纹仍为 `a7869b3ae5d75b7b68fac1234e04288c755622ee3f549497b2c96dc366701679`。受保护对象仍为 Package ID 1/v1/`SUBMITTED`/摘要前缀 `9d7a6a7ec9aefbaf`，Package 总数 1、v2 为 0、RETURN/ACCEPT 为 0；Unit Resolution ID 1/v1、Product/BOM、Material 533—536、事件和审计记录均未修改。
- 部署后 Web/PostgreSQL healthy，Worker/Caddy running；四服务 restart 0/OOM false。最终为 available memory 2.2 GiB、Swap 214 MiB/1 GiB、根盘可用 22 GiB、Load `0.17/0.54/0.74`；Web/Worker/PostgreSQL/Caddy 分别约 36/75/177/15 MiB。全程重任务串行，资源检查约为 available 2.1—2.3 GiB、Swap 196—224 MiB、根盘最低可用 21 GiB、Load 低于停止阈值。
- 本任务创建的隔离测试库、第二恢复库、临时浏览器 runner、builder、Playwright 基础镜像和精确临时目录已删除；正式备份、当前 Web 和精确回退 Web 保留。未执行 Docker system/volume prune，四个受保护 Volume 未删除。

## 安全阻断与最终结论

- 在准备主 UAT planning 只读浏览器核验时，错误地把 root-only UAT 角色凭据资料当作 shell 文本解析，shell 错误输出暴露了其中的凭据正文。发现后立即停止登录；没有使用已暴露凭据创建 Session，没有登录 planning 或 engineering，也没有点击接收、退回或执行其他主 UAT 写操作。
- 后续只读摘要校验仅输出计数，确认资料中的 10 组 UAT 角色凭据当前全部仍有效，其中 1 组为可用 planning 凭据。任何凭据值、用户名、摘要或 Session 信息均不得进入仓库文档。
- 因已暴露凭据不能继续安全使用，而轮换/停用身份属于新的权限变化且尚无项目负责人明确授权，主 UAT planning 的只读浏览器字段核验、退出和 Session 失效核验没有执行；不得把隔离 Chromium 结果冒充主 UAT 结果。
- 功能与权威数据核验没有发现历史追溯缺口，已部署的只读合同和 Package 范围授权测试均通过；但本任务不能标记完成，也不能重新开始 planning 退回试用。解除阻断需要项目负责人明确授权：通过受控 Identity 流程轮换全部 10 组已暴露 UAT 凭据，提供新的安全使用机制，再单独完成 planning-only 只读浏览器核验。
- 最终状态：`BLOCKED — NO UNSAFE CHANGE`。这里的“NO UNSAFE CHANGE”指未对 Package、Resolution、Product、BOM、Material、Event、Audit、Session 或其他业务事实执行不安全修改；凭据输出事件已如实登记，不能视为已消除。
