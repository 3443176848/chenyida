# SELFHOST-OPS-UAT-PLANNING-REVIEW-TRACEABILITY-FIX-08

## 状态

- 状态：`DOING`
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
- 候选 Web：`sha256:6b94a9c73a182799ffad6df5f89ecb86e5407162f0f233e8741aea3fd9dc4e25`。此时现网仍为原 Web，尚未备份、部署或登录主 UAT planning。
