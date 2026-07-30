# SELFHOST-OPS-UAT-BOM-SELECTOR-FIX-04

## 状态

- 状态：`DONE`
- 开始日期：2026-07-31
- 执行面：源码 `0.1.0-alpha.36` / `0035`；运行面 `0.1.0-alpha.34` / `0034`
- 部署边界：只允许从 alpha.34 与现有 hotfix 链构建兼容 Web；不得运行 `0035`、新增 `0036` 或部署完整 alpha.36。

## 目标

1. 为 BOM 提供有界、可搜索、正式内部编码优先的物料候选；展示 `正式内部编码 · 名称 · 单位`，选择值及提交引用均为稳定 `material_id`。
2. 在 BOM 写事务内重新验证物料存在、`ACTIVE`、正式编码非空、所选单位与主数据一致，并拒绝同一 BOM Version 重复 `material_id`。
3. 明确区分 Product Version、BOM Version、产品状态和 BOM 草稿/发布状态；复用既有 DRAFT→RELEASED 服务、权限、幂等、CAS、审计和不可变规则。
4. 核实 Planning Handoff 只接受同一关系模型中的 RELEASED Product Version/BOM Version 与稳定 ID。
5. 在隔离 PostgreSQL 使用合成数据完成测试，随后以 alpha.34/0034 兼容 hotfix 只替换 Web，并仅做不保存的浏览器验收。

## 受保护 UAT 基线

- 项目：`PRJ-00000001`，`ACCEPTED`，需求数量 `10.000000`。
- 产品：`UAT-BB-PROD-042576`，`A0 / DRAFT / 样品`。
- 物料：`CYD-RB_PCB-000016`、`CYD-RB_SENSOR-000003`、`CYD-RB_CONN-000075`、`CYD-RB_METAL-000015`，均为 `V3 / ACTIVE / PCS`。
- 只读基线：目标 BOM `0`、该产品全部 BOM `0`、该项目 Planning Package `0`；按 `id|code|name|version|status|base_uom` 固定序列计算的四物料比较指纹为 `56f19dee12d72109f7d631cec6e58022`。
- 禁止创建、发布或修改任何 UAT BOM、Planning、项目、产品或物料记录。

## 已核实根因与架构结论

- 旧兼容页从 `/api/items` 获得 `id/internal_material_code/standard_name/base_uom`，却按旧字段 `internal_item_code` 渲染并把它作为 `<select>` value；没有搜索且一次加载全部物料，提交也仍是编码和自由文本单位。
- BOM 服务已在事务中锁定草稿并验证 ACTIVE，但尚未验证单位等于物料主单位，也未禁止跨工序重复同一 `material_id`。
- Product Version、BOM Version 与 Planning Handoff 共用 PostgreSQL 关系模型及稳定 ID；真实 BOM 发布 API、engineering 权限、幂等、CAS、审计、回滚与 RELEASED 不可变规则均已存在，只是兼容 UI 未展示。
- 本任务不需要 Schema/Migration；如后续事实推翻此结论，立即停止而不创建 `0036`。

## 验收与停止边界

- 代码、专项与回归、资源门禁、备份清单/隔离恢复、0034 候选 smoke、只换 Web、浏览器只读验收及最终数据指纹全部通过后方可完成。
- 无法证明当前 hotfix 链兼容、候选夹带 0035/TASK09/alpha.36、需要 Schema、触及 UAT 写入或会重建 PostgreSQL/Worker/Caddy 时立即停止。
- 最终结论只能使用任务指定的三种状态之一。

## 完成结果

- 功能提交 `b66e742abe866aa7e1644c09c4fc28efb5e373e4` 新增 `/api/bom-material-candidates`，只返回 ACTIVE、正式编码非空、主单位可解析的候选；DTO、显示、检索和稳定 ID 合同已落实。
- BOM 行保存与发布事务均重新验证 `material_id`、正式编码、ACTIVE、enabled Unit 和主单位；同一 BOM Version 重复物料被服务端拒绝，既有数量精度、幂等、CAS、权限、审计、回滚与发布不可变规则保持。
- Product Version、BOM Version 与 Planning Handoff 已确认共用关系化 PostgreSQL 稳定 ID；真实 DRAFT→RELEASED 发布路径存在并由 UI 调用，没有新状态机或伪按钮。
- 隔离 PostgreSQL、unit/UI、TASK09、Identity/no-store、typecheck、Schema consistency、lint、build、credentials 和 Python 三项基线通过；没有运行 0035 或新增 0036。
- PostgreSQL custom dump 2,023,590 bytes、SHA-256 `8facc469c6bbdf3d2dedce57ce2d8a740d58cd2d2f8cd6e85c714421d05c35b9` 已完成清单和独立 0034 恢复验证。
- alpha.34/0034 兼容 Web `sha256:cb6a5c1fae89608e07e72d458b4466e0b571e36374b16f3b592248280f8dc6e1` 已部署；仅 Web 容器更换，Origin、PostgreSQL、Worker、Caddy、0034、CSRF/logout、审核和 no-store hotfix 保持。
- 公网 Chromium 对四个正式编码各得到唯一正确结果并完成未保存选择/清除；A0/V1、产品/BOM 状态、项目关系和发布说明清楚，桌面与 390px 无横向滚动。
- 最终项目数量 `10.000000`、产品 A0/DRAFT/样品、四物料 V3/ACTIVE/PCS 和比较指纹不变；目标/全部 UAT BOM `0/0`，Planning Package `0`，engineering ACTIVE Session `0`。

## 最终结论

`BOM CODE-FIRST MATERIAL SELECTION FIXED — UAT BOM NOT CREATED`

详细证据见 `docs/tasks/SELFHOST-OPS-UAT-BOM-SELECTOR-FIX-04-COMPLETION.md`。
