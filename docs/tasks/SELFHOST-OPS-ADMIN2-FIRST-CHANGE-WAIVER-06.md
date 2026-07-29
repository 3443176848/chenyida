# SELFHOST-OPS-ADMIN2-FIRST-CHANGE-WAIVER-06 单账号首次改密豁免

## 状态与授权

- 状态：`DONE / SINGLE-ACCOUNT WAIVER APPLIED`。
- 日期：2026-07-29（Asia/Shanghai）。
- 授权：项目负责人明确要求 `admin2` 不再执行首次改密。

## 范围

1. 目标仅为当前 `chenyida-erp-parallel` PostgreSQL 中的 `admin2`。
2. 只把 `must_change_password` 从 `true` 改为 `false`，并按 CAS 递增账号 version；不修改密码摘要、用户名、显示名、角色或 active 状态。
3. 保留当前合法 Session，不模拟登录、不读取或输出密码、摘要、Cookie、Token 或数据库凭据。
4. 在单一 PostgreSQL 事务中锁定目标账号、校验预期状态、更新账号并写入专用 `IDENTITY` 审计；失败整批回滚。
5. 以任务 ID 作为审计幂等标识；同一任务重放不重复更新或重复审计，状态与审计不一致时 fail closed。
6. 这是项目负责人对单账号的一次性明确例外；不修改 D-045 的全局新建/重置用户首次改密策略，不新增通用豁免 API。
7. 不修改 Schema/Migration、业务数据、Web/Worker/Caddy、四个 ERP 持久卷或 Python/SQLite/D1；不 build、restart、deploy、push 或创建 PR。

## 验收标准

- `admin2` 保持 active admin，`must_change_password=false`，version 从 2 增至 3，密码摘要前后摘要指纹相同。
- Session 总数和有效数不变，现有有效会话可在刷新后进入受保护页面。
- 新增且仅新增一条 `USER_FIRST_PASSWORD_CHANGE_WAIVED/success` Identity Audit，安全 detail 明确单账号、未改密码、未撤销会话和项目负责人授权。
- Migration/count/checksum、Material/Product/BOM/Line、身份幂等和四卷不变；健康、restart、OOM、资源与 Git 边界通过。

## 完成记录

- 完成报告：`docs/tasks/SELFHOST-OPS-ADMIN2-FIRST-CHANGE-WAIVER-06-COMPLETION.md`。
- `admin2` 已为 active admin、version 3、`must_change_password=false`；密码指纹和合法 Session 保持，专用成功 Identity Audit 恰好 1 条。
