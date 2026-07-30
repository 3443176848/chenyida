# SELFHOST-LANDING-TASK09：供应商导入接入 13 列标准物料整理工作台

## 状态

- 任务状态：`DONE / NON-PRODUCTION SOURCE VERIFIED`
- 开始日期：2026-07-30（Asia/Shanghai）
- 负责人：Codex（现有导入链路审计、标准化投影、API、页面、测试、文档与独立提交）、项目负责人（确认把 TASK07 整理体验接入“供应商导入”）
- 依赖：`SELFHOST-LANDING-TASK04`、`SELFHOST-LANDING-TASK07`、`SELFHOST-LANDING-TASK08`、`SELFHOST-PHASE1-TASK02`—`TASK04`

## 用户目标

把 TASK07 中得到认可的“原表识别、按固定 13 列整理、异常单列、再进入后续审核”的体验接入现有 `/materials/imports` 供应商导入工作区，减少用户直接面对 Parser、Mapping 和 Normalization 技术状态的负担，同时继续复用既有权限、来源追溯、人工确认和 Material Draft/Review 边界。

## 本次范围

1. 在现有 PostgreSQL Material Import Batch 已发布 Parse 结果之上增加服务端确定性标准化投影，不启动 Python 子进程，也不复制第二套导入数据库。
2. 输出模板固定为 `CYD-MATERIAL-13C-v1`：`序号、项目号、板子类型、内部型号、物料规格描述、品牌、用量、替代料、供应商、订单数量、需求数量、购买数量、库存数`。
3. 对完全命中 13 列模板的来源原样投影；其他来源只使用已解析表头、当前 Mapping 建议、明确标题上下文和显式替代标记。无法证明的项目、板型、型号、数量、供应商或库存保持空白并生成稳定问题代码。
4. 数量计算使用确定性十进制文本；`需求数量=用量×订单数量`、`购买数量=max(需求数量-库存数,0)`，任一输入未知时保持空白。
5. 提供受 `material.import.read`、owner/`read_any` 保护的分页预览与 UTF-8 CSV 下载；响应 `private, no-store`，不返回完整原始行、SQL、路径或服务端异常。
6. 导入工作区在 Parse 发布后默认进入“标准整理”主视图，展示模板/规则版本、来源结构状态、13 列、问题统计和下载入口，并保留“高级字段 Mapping”和既有 Normalization/Review 入口。
7. 版本更新为 `0.1.0-alpha.36`，PostgreSQL migration head 继续保持 `0035`；本任务不增加或应用 Migration。
8. 服务端读取在 repeatable-read 只读事务中完成，并同时限制最多 5,000 个候选来源行和 32 MiB 原始 JSON；避免 Mapping 保存并发造成混合快照，也避免大正文拖垮低资源服务器。

## 明确排除

- 不把 TASK07 绑定 8 个文件的 Python 脚本直接放进 Web 或 Worker 运行时。
- 不在本任务实现一个批次多文件、跨批次合并、XLSX 多 Sheet 导出或来源档案管理写界面。
- 不自动确认未知来源 Profile，不自动确认 Mapping，不自动创建/提交/批准 Material Draft，不生成正式内部编码。
- 不读取或修改 `shujvbiao/` 业务文件，不写现有业务数据，不部署、build、restart 或切换当前 18888 运行面。

## 验收标准

1. 13 列顺序逐字固定，模板直通、普通平表、标题上下文、显式替代料、未知字段留空和精确数量计算均有单元测试。
2. 超过 5,000 个候选来源行、无已发布 Parse、隐藏批次、无权限、未知查询参数和非 GET 方法均 fail closed，并返回稳定中文错误与请求编号。
3. CSV 使用 UTF-8 BOM、RFC 4180 转义和公式注入保护；下载仍受会话和批次行级可见性保护。
4. UI 默认优先展示“标准整理”，清楚区分“整理预览”“高级 Mapping”“正式物料审核”，不得声称预览已经入库。
5. 专项 unit/handler/UI contract、适用 Import/Mapping/Normalization 回归、typecheck/lint、凭据、`git diff --check` 和低资源检查通过。
6. 更新 `MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`DECISIONS.md`、`CHANGELOG.md`、`STATUS.md`，创建独立 Git 提交。

## 完成结果

- 新增 `material-standardization-selfhost` 规则、服务与 Handler；复用现有 Parser/Mapping，未新增业务表或后台任务。
- 新增受保护的 `GET /api/material-master/import-batches/:id/standardization-preview` 和 `GET /api/material-master/import-batches/:id/standardization-export.csv`。
- 供应商导入列表、新建页和工作区已把“标准整理”作为解析后的推荐主路径；固定展示 13 列、结构状态、数量规则、问题统计、分页和 CSV，同时保留高级 Mapping、Normalization 与 Review。
- 精确模板直通；其他结构只按明确表头、Mapping、标题上下文和显式替代标记整理。供应商料号不充当内部型号，公式/错误不执行，未知字段留空。
- 源码版本为 `0.1.0-alpha.36`，Migration head 仍为 `0035`；常驻 18888 仍是 alpha.34/0034，本任务没有 build、restart 或 deploy。

详细验证与资源记录见 `SELFHOST-LANDING-TASK09-COMPLETION.md`。
