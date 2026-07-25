# SELFHOST-PHASE2-TASK10 完成报告

状态：`DONE`（非生产开发基线；未发布、未部署、未迁真实数据）

日期：2026-07-25（Asia/Shanghai）

## 交付结果

- 新增独立 Dashboard Repository/Service/Handler，在 `REPEATABLE READ READ ONLY` 快照中实时聚合 TASK02—TASK09 关系表；固定 DTO 按角色裁剪，金额/数量保留 PostgreSQL numeric 文本，不跨单位合计库存。
- `/api/summary`、`/api/management-dashboard`、运维状态和备份治理状态统一进入自托管 API；只有 `system.audit.read` 可看最近系统审计，只有 admin 的 `system.backup.read` 可看去敏备份状态。
- 根 `/` 改为原生会话与经营工作台，不含 iframe；覆盖 setup/login/must-change/logout、独立卡片加载/重试、指标、风险和权限裁剪模块入口。
- `/erp/index.html` 保留为显式 legacy 工作区及回滚证据，支持白名单 `?tab=` 深链；legacy 浏览器备份创建/恢复控件已移除，相关 POST 返回稳定 `OFFLINE_OPERATION_REQUIRED`。
- 强化离线 backup/verify/restore：完整 manifest、migration checksum、制品大小/SHA、危险 tar/link 拒绝、原子状态文件以及仅新空非生产目标恢复。
- Compose 为 Web 只读挂载去敏 backup-status 卷；版本更新为 `0.1.0-alpha.10`。本任务不需要 projection/outbox，因此 PostgreSQL migration 仍为 `0001`—`0013`，未创建 `0014`。

## 验收证据

- TASK10 typecheck 通过；Dashboard unit/UI/API coverage 共 9/9，隔离 PostgreSQL/API 2/2。
- 64 个 Python HTTP 操作和 legacy 登录后 23 个 GET 均有自托管路由或明确退役行为覆盖。
- Vinext build 通过；lint 为 0 error、1 条仓库既有 unused warning；environment 6/6、FileStorage 3/3、凭证扫描通过。
- Procurement/Production/Sales/Quality/Finance 的适用 unit/UI 回归共 23/23，TASK05—TASK09 定向 typecheck 全部通过。
- 隔离 PostgreSQL 17 完成 backup→verify→全新空数据库/空目录 restore；13 个 migration 一致、合成文件逐字节一致。已有输出、损坏 checksum、`../` tar、危险 link、非空数据库和二次恢复均被拒绝。
- 隔离 Compose 空卷从 TASK02 身份开始，依次贯穿主数据/BOM、库存、采购、生产、销售、品质、财务、Dashboard、角色裁剪与 23 个 legacy GET；Web/Worker 重启后 migration `0013_finance.sql`、跨域事实和合成失败任务仍可读，backup 状态为 `UNVERIFIED`。
- 项目虚拟环境运行 Python `server.py --self-test`、`smoke_test.py`、`go_live_check.py` 全部通过；系统 Python 缺少 `openpyxl` 的首次 smoke 未改代码，按实际 systemd 虚拟环境复验通过。
- `git diff --check` 通过。测试生成的临时 SQLite 备份、隔离 PostgreSQL/Compose、合成文件目录在完成后清理。

## 生产边界

没有连接或写入生产 PostgreSQL/D1/SQLite，没有执行真实数据迁移、生产备份/恢复、部署、切流、systemd 重启、push 或 PR。TASK10 完成不代表可直接投产；真实数据试迁移、异故障域备份恢复演练、容量/安全验收和生产切换必须另立任务并单独授权。
