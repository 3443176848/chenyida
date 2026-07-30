# SELFHOST-LANDING-TASK09 完成记录

## 结论

`SUPPLIER IMPORT 13-COLUMN STANDARDIZATION WORKBENCH IMPLEMENTED — SOURCE ONLY, NOT DEPLOYED`

现有供应商导入源码已增加 `CYD-MATERIAL-13C-v1` 标准整理主视图。它从当前已发布 Parse 与当前 Mapping 生成确定性只读投影，提供问题清单和受认证 CSV；没有创建正式物料、编码、替代关系或其他业务事实。

## 交付

- 服务端：规则/类型/错误/Service/Handler 独立边界；exact-template 直通、明确表头与 Mapping 回退、标题上下文、显式替代行折叠、稳定问题代码和字符串十进制运算。
- 一致性/资源：repeatable-read read-only 快照；最多 5,000 个候选来源行和 32 MiB 原始 JSON；公式/错误单元格 fail closed。
- API：分页预览和 UTF-8 CSV；`material.import.read`/`read_any`、owner 可见性、`private, no-store`、请求编号、稳定中文错误；CSV 导出审计、RFC 4180 和公式注入保护。
- UI：供应商导入列表与新建页说明新流程；八步工作区增加“标准整理”，`AWAITING_MAPPING` 默认进入该视图；13 列、来源/Profile、统计、待核对问题、分页与下载齐全，高级 Mapping 和后续 Review 保持。
- 版本：`0.1.0-alpha.36` / migration head `0035`，没有 Schema 或 Migration 变化。

## 验证

- Standardization unit `7/7`、Handler `4/4`、UI contract `3/3`。
- Mapping unit/UI `5/5`、Normalization unit/UI `12/12`、Review unit/UI `10/10`、Adaptive Import `5/5`、基础 FileStorage `3/3`。
- `typecheck:standardization` 与 `typecheck:governance` 通过；全仓 lint `0 error / 8 个既有 warning`。
- 凭据扫描通过（1,096 个仓库文件）；Python 临时 SQLite `server.py --self-test`、`smoke_test.py`、`go_live_check.py --no-backup` 通过；`git diff --check` 通过。

## 数据、部署与恢复边界

- 未读取新业务表格正文，未修改 `shujvbiao/`，未连接或写常驻 PostgreSQL/SQLite/D1，未运行 0035。
- 未 build、restart、deploy、push 或创建 PR；当前 18888 Web/Worker/PostgreSQL 继续为 alpha.34/0034，用户在当前公网页面暂时看不到本功能。
- 没有把 TASK07 的 8 文件专用 Python 脚本嵌入 Web；没有实现一批多文件、跨批合并、标准整理确认态或正式数据库导入。

## 资源与清理

- 起点：available memory 约 2.1 GiB、Swap 98 MiB、根盘可用 31 GiB、Load `0.08/0.15/0.13`。
- 测试严格串行，一次最多一个临时容器，容器上限 1 GiB/1 CPU、Node heap 768 MiB；测试中观察到的单容器峰值约 718 MiB，未触发 768 MiB available、80% Swap、10 GiB 磁盘或 Load 4 停止门槛。
- 最终：available memory `2,458,736 KiB`（约 2.34 GiB）、Swap used `167,948 KiB`（约 164 MiB）、根盘可用 31 GiB、Load `1.36/0.98/0.68`，均未触发停止门槛。
- PostgreSQL/Web healthy，Worker/Caddy running；四个常驻容器 restart `0`、OOM `false`，任务时段内核日志未发现 OOM。四个受保护卷均存在且 driver 为 local。
- `cyd-task09-*` 临时容器和任务临时 SQLite 已清理；没有 prune，也没有清理未知临时文件或任何持久卷。
