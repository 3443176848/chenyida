# SELFHOST-PHASE2-TASK10 诊断与设计记录

日期：2026-07-25（Asia/Shanghai）

## 当前断点

- `app/page.tsx` 只有一个全屏 `/erp/index.html` iframe；登录后 legacy `refreshAll()` 固定并发 23 个业务 GET，根页面没有原生会话、错误隔离或模块入口。
- TASK03—TASK09 已接通主要业务 GET，但 `/api/summary`、`/api/management-dashboard` 和备份治理仍未进入 Node/PostgreSQL 自托管边界。
- legacy 浏览器仍保留“创建备份/恢复并覆盖当前数据库”交互；该语义会回退已过账事实，与不可变账本、冲销和生产保护规则冲突，不能迁移。

## 看板结论

- 所需指标已存在于 Material、Master Data、Inventory、Procurement、Production、Sales、Quality、Finance 和 Audit 权威关系表，可实时只读聚合；首期没有必要新增 projection、outbox 或 migration。
- 库存不同 Material/Unit 的数量不能直接求和冒充“库存总量”；看板改为余额记录、冻结记录、待办数量和可核对金额。
- `/api/summary` 提供稳定扁平兼容字段与模块分组；`/api/management-dashboard` 提供 metrics/risks/recent_activity。审计内容继续服从 `system.audit.read`。

## 备份恢复结论

- 现有 `backup-selfhost.sh` 已生成 dump/tar/SHA，但可能留下半成品目录，缺 manifest、独立 verify 命令、archive path 安全检查和可供只读看板消费的去敏状态记录。
- 现有 restore 已拒绝非空数据库/目录，但必须先完整校验 dump/tar，再准备文件 staging，并继续强调新空目标失败后整体丢弃，而不是把它包装成在线恢复事务。
- 新 API 只读取受限状态文件并报告 `VERIFIED/UNVERIFIED/INVALID`、最近校验时间和 migration head；不列绝对目录、不创建制品、不执行 shell、不接受 POST。

## UI 退出策略

- 原生根工作台负责会话与经营总览，彻底移除根 iframe。
- `/erp/index.html` 保留为显式 legacy 业务工作区，根工作台按服务端权限展示模块入口并传递白名单 tab；未授权模块仍由服务端 API 拒绝。
- 本任务不删除 legacy 源码，也不声称全部业务页面已原生 React 化；“退出 iframe”只表示根页面不再自动嵌套或批量加载 legacy UI。
