# SELFHOST-LANDING-TASK08 完成报告

## 结论

- 状态：`DONE / DOCS-ONLY PROCESS DESIGNED`。
- 固定结论：`BULK MATERIAL STANDARDIZATION PROCESS DESIGNED — GENERIC RUNNER NOT IMPLEMENTED`。
- 后续大量公司物料资料不再依赖单个长对话；每批有稳定 ID/修订、不可变来源 manifest、批次卡、唯一下一动作和独立输出，最终只从已批准批次汇总。
- 本任务没有处理新的业务附件，没有修改 TASK07 工作簿或实现通用执行器；未连接或写入 PostgreSQL、SQLite、D1，未运行 Migration、build、restart 或 deploy。

## 交付物

- `docs/material-master/bulk-material-standardization-sop-v1.md`：完整批次 SOP、13 列模板合同、默认上限、来源角色、映射档案、状态机、异常组、验证门禁、两级汇总、跨对话指令和恢复规则。
- `docs/material-master/templates/bulk-material-pipeline-index-v1.example.json`：私有全局总索引合法 JSON 示例。
- `docs/material-master/templates/bulk-material-batch-card-v1.example.json`：单批状态、输出、人工复核和 `checkpoint.next_action` 合法 JSON 示例。
- `docs/material-master/templates/bulk-material-source-manifest-v1.example.json`：来源文件、Sheet 角色、摘要、结构指纹和映射档案合法 JSON 示例。
- `docs/material-master/README.md` 已增加入口；D-083 记录了项目负责人确认的长期流程选择。

## 固定流程

- 模板固定为 `CYD-MATERIAL-13C-v1`，绑定 `moban.xlsx` SHA-256 和 13 列；规则包为 `CYD-MATERIAL-NORMALIZATION-v1`。任何变化发布新版本，不覆盖旧批次。
- 批次采用 `CYD-MAT-YYYYMMDD-NNN/Rxxx`；默认最多 10 个文件、5,000 条候选物料行、100 MiB，异常大文件单独处理。
- 已知来源只有结构指纹命中已批准映射档案才自动复用；未知布局进入 `PROFILE_PENDING`，一次确认后新增档案版本。
- Codex 只能把结果冻结为 `REVIEW_REQUIRED`；项目负责人明确批准批次 ID、修订和输出摘要后才能进入已批准汇总。
- 临时汇总可包含已验证待确认批次，但明确禁止作为数据库输入；已批准汇总仍不执行跨批模糊去重、正式编码、单位/供应商/替代关系审批或数据库写入。

## 跨对话恢复

- 新对话固定先读 `MASTER.md`、本 SOP、私有 `pipeline-index.json` 和目标 `batch-card.json`，核对摘要后只执行 `checkpoint.next_action`。
- 用户只需说明“新建批次”并上传本批文件，或说明“继续批次 `<batch>/<revision>`”；无需复制旧聊天。
- 对话中断前必须把已完成步骤、输入要求、错误码和唯一下一动作写入批次卡。未写入 checkpoint 的聊天结论不视为已完成事实。
- `/mnt/data` 只作为 GPT 下载副本；稳定输出在私有批次目录，下载副本丢失时按已记录 SHA 重新复制，不重新解析来源。

## 验证与边界

- 三份 JSON 示例均通过 Python JSON 解析；SOP/README 链接、模板/规则 ID、状态和禁止事项一致性检查通过。
- Python 临时 SQLite `server.py --self-test`、`smoke_test.py`、`go_live_check.py --no-backup` 通过，临时目录已精确清理。
- Node 在断网、只读、1 CPU/1 GiB、一次一个自动删除容器中执行：`npm test` 3/3、lint 0 error；credentials 1,083 个仓库文件和 Git diff/scope 检查通过。
- Git 只包含流程、示例和脱敏治理文档；不包含原始表格、标准物料正文、批次实例、私有索引、数据库、备份、凭据或逐行报告。

## 资源与清理

- 检查时约 2.1 GiB available、Swap 98 MiB、根盘 31 GiB、Load `0.06/0.11/0.15`；最终约 2.0 GiB、98 MiB、31 GiB、Load `0.04/0.11/0.15`。
- PostgreSQL/Web/Worker/Caddy 未重建，restart 0、OOMKilled false；没有临时数据库、Node 测试容器或 TASK08 临时 SQLite 残留，四个受保护卷保持。
- 未执行 prune、缓存清理、服务重启、网络写入或生产访问。
