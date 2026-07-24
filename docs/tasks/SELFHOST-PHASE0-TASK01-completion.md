# SELFHOST-PHASE0-TASK01 完成报告

## 交付摘要

建立了标准 Node.js/Vinext Web、46 表 PostgreSQL `0001` baseline、本地原子 FileStorage、PostgreSQL Outbox/租约 Worker、Docker Compose/Caddy、migration/admin CLI、备份恢复脚本和隔离测试。核心验收链路覆盖管理员初始化/登录、权限、审计、101 分类、草稿创建/查询、CSV 上传、Worker 解析/规范化、重启持久性以及隔离备份到新空库恢复。

## 保留与适配

React/TypeScript 页面、分类 seed、CSV Parser 依赖、Material 状态/权限/CSRF/审计语义继续使用。D1 SQL Repository、R2/Queue adapter 和 Miniflare 测试没有伪装成 PostgreSQL 可用代码；自托管核心 API 使用新的参数化 PostgreSQL transaction。旧实现保留作迁移参考。

## 已知边界

- 本任务建立新空库基线，不包含旧 SQLite/D1 数据回填或公网切换。
- 核心验收 API 已移植；历史 ERP 大而全 API、完整 Mapping UI 后端和全部审批写路由尚未逐条完成 PostgreSQL Repository 迁移。对应 React 源码和 46 表数据边界保留，后续应按业务流分任务移植，不能宣称所有旧页面已完成端到端验收。
- CSV Worker 已实际解析并发布 raw rows；CSV/XLS/XLSX 均接入既有有界 Parser（Parser 纯测试 38/38），当前 `material.import.normalize` 是受租约/原子发布保护的基线 handler，只发布批次级完成结果，完整既有 Normalizer 行级持久化需后续接入。
- npm audit 报告包含现有前端工具链依赖问题；本任务未用破坏性 `npm audit fix --force` 更新框架。
- 根仓库既有全量 lint 仍被本任务前已存在的 `xls-parser.ts prefer-const` 失败阻断；新增自托管文件的定向 lint 通过。

## 生产保护

没有连接生产数据库、迁移真实数据、部署公网、修改真实服务器、提交、推送或创建 PR。生产迁移、备份恢复演练、HTTPS 域名启用和旧数据切换必须另行授权。
