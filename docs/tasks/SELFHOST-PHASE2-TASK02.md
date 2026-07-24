# SELFHOST-PHASE2-TASK02：自托管身份安全边界

状态：`DONE`（非生产实施；未发布、未部署）

日期：2026-07-24（Asia/Shanghai）

负责人：Codex（诊断、实现、隔离测试、文档与本地提交），项目负责人（业务与安全决策、范围和禁止事项确认）

## 1. 任务目的

把集中在 `chenyida_erp_site/app/lib/selfhost-api.ts` 的身份逻辑拆分为独立 Repository、Service 和 Handler，补齐用户生命周期、密码、会话撤销、全局 must-change 门禁、登录与身份写限流、持久幂等、系统审计查询和安全 Cookie。

本任务只建立后续业务域共用的身份安全边界。它不实现 Dashboard、备份、客户、供应商、产品、BOM、库存、采购、生产、销售、品质、财务或 legacy 全域兼容。

## 2. 起始基线

- Branch：`main`。
- 起始 HEAD：`e8cb7ebc0fa9d45575aeaffc0732183d2533f577`。
- 起始工作区：clean；本地 `main` 领先 `origin/main` 2 个提交。
- 自托管版本：`chenyida-erp-selfhosted@0.1.0-alpha.1`，非生产、尚未发布。
- PostgreSQL migration：`0001`—`0005`；SHA-256 与 `RELEASES.md` 一致。
- Python/SQLite 常驻开发运行面不修改、不重启。

## 3. 固定实施边界

- 角色仅允许 `admin`、`manager`、`purchase`、`engineering`、`production`、`warehouse`、`quality`、`sales`、`finance`、`operations`。
- 只有 admin 管理用户和读取系统审计；本人改密允许所有 active 已认证用户。
- 密码 12—128 位，四类字符至少三类，拒绝用户名、默认口令和常见弱口令；PBKDF2-SHA256 保持 310,000 次。
- 用户创建、启停、管理员重置和本人改密使用 CSRF、`Idempotency-Key`、服务端限流、CAS、事务审计和安全响应。
- 会话只保存 SHA-256 摘要；停用/重置撤销全部会话，本人改密保留当前会话并撤销其他会话。
- must-change 用户只允许 session、logout 和本人改密；所有其他受保护 API 返回 `PASSWORD_CHANGE_REQUIRED`。
- PostgreSQL `0006` 仅以 expand-only 增加身份安全必要结构，不修改 `0001`—`0005`，不迁移真实用户。

## 4. API 范围

保留并重构：

- `POST /api/setup`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/session`

新增或补齐：

- `POST /api/me/password`
- `GET /api/users`
- `POST /api/users`
- `POST /api/users/status`
- `POST /api/users/reset-password`
- `GET /api/system/audit-logs`

## 5. 验收与禁止事项

验收覆盖单元、UI 契约、一次性 PostgreSQL 17 API、migration 空库/升级/重复/失败回滚/约束、Compose 身份生命周期与重启持久性，以及全部指定 Node/Python 回归。完成后版本更新为 `0.1.0-alpha.2`，同步项目文档并创建一个独立本地提交。

禁止访问或修改生产、迁移真实身份数据、部署、重启 Python systemd、实现其他业务域、处理依赖审计风险、push 或创建 PR。
