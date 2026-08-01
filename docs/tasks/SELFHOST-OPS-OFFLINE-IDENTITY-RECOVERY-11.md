# SELFHOST-OPS-OFFLINE-IDENTITY-RECOVERY-11

## 状态

- 状态：`DOING`
- 开始日期：2026-08-01（Asia/Shanghai）
- 起点：clean `main@753c68c84427de93536a1f282b6e80987f7c9466`，`origin/main...HEAD` behind 0 / ahead 113。
- 运行基线：`0.1.0-alpha.37`、36/head `0036_project_requirement_unit_resolution.sql`、Web `sha256:6b94a9c73a182799ffad6df5f89ecb86e5407162f0f233e8741aea3fd9dc4e25`。
- 授权：项目负责人已明确选择方案 B，并授权当前并行非生产 UAT 的离线身份恢复、11 个目标账号密码重置、相关 Session 全部撤销、恢复审计和 Canonical 文件原子安装。

## 唯一目标

通过不接入 Web 路由的受守卫 CLI，在 Web/Worker 停止写入期间，复用现有 Password 与 PostgreSQL Identity Repository/事务边界，对 `admin` 和固定十个 UAT 账号执行一次原子身份恢复；随后原子提升两份 root-only Canonical 凭据文件，并完成身份页范围内的登录、强制改密门禁、退出和 Session 清理验证。

## 固定账号与预期角色

1. `admin / admin`
2. `uat_20260729_manager / manager`
3. `uat_20260729_sales / sales`
4. `uat_20260729_engineering / engineering`
5. `uat_20260729_planning / planning`
6. `uat_20260729_purchase / purchase`
7. `uat_20260729_warehouse / warehouse`
8. `uat_20260729_production / production`
9. `uat_20260729_quality / quality`
10. `uat_20260729_finance / finance`
11. `uat_20260729_operations / operations`

## 实施边界

- CLI 固定拒绝 production deployment class、非 root、未知数据库身份、非 0036、Web/Worker 仍可写、缺少显式确认和重复 run-id。
- 密码由密码学安全随机源生成，逐一通过现有密码策略并由现有 hash 函数处理；不得输出密码、hash、Token、Cookie、Session digest、连接串或 SQL 异常正文。
- 两份 Stage 必须先完成 0600/root:root、写入与目录 fsync、标准 JSON 解析和结构验证，才允许进入单一数据库事务。
- 事务必须锁定并精确核验 11 个账号的用户名、角色、active 状态和数量；只更新密码字段、version 和 must-change，撤销目标 Session，写 11 条 `OFFLINE_IDENTITY_RECOVERY` 审计并持久化唯一 run-id 证据。
- 不新增 Migration、表、HTTP 路由、定时任务或启动时自动恢复逻辑；run-id 证据复用现有 Identity 审计/幂等边界。
- 正式执行前完成单元、隔离 PostgreSQL、0036 主库备份隔离恢复和隔离 Web/Chromium 演练；所有重任务串行且一次一个临时资源。
- 正式事务前后生成排除身份表正文的业务指纹；不得修改其他用户、角色/active、业务表、Planning Package、Migration、Schema、版本或镜像。
- 数据库提交后若文件提升失败，保留 Stage 并以 PARTIAL 停止；不得恢复旧密码。两份正式文件都提升成功后才可删除旧 UAT 候选。
- 浏览器只允许登录、Session、强制改密门禁和 logout；不得进入经营工作台、Planning 或其他业务页面，不执行实际改密。

## 验收与最终状态

- 定向 unit/隔离 PostgreSQL/备份恢复/隔离 Web 演练、Python 三项基线、凭据扫描和 `git diff --check` 通过。
- 正式备份可列出并恢复到第二新空库，36/head 0036、身份非敏感计数和业务指纹一致。
- 11 个账号原子更新、目标现有 Session 全部撤销、11 条恢复审计、唯一 run-id；其他用户/Session 和业务指纹保持。
- Admin 登录后不强制改密；十个 UAT 登录后只到强制改密页；逐一安全退出，历史导航不能恢复受保护内容；最终无任务遗留有效 Session。
- Canonical 文件均为标准 JSON、root:root、0600，Stage 与旧候选按成功/失败规则精确处置。
- 最终只允许：
  - `OFFLINE IDENTITY RECOVERY COMPLETED — CANONICAL CREDENTIALS ACTIVE`
  - `OFFLINE IDENTITY RECOVERY PARTIAL — RECOVERY STAGE RETAINED`
  - `BLOCKED — NO IDENTITY CHANGE`

## 正式执行前验证（2026-08-01）

- 定向 unit：7/7 通过；隔离 PostgreSQL：12/12 通过，覆盖单事务、故障回滚、提交确认丢失、Stage/Canonical 失败恢复、run-id、单账号浏览器失败 Session 撤销，以及 PREPARED 后 Stage/evidence 丢失与超过 16 分钟的幂等续跑。
- 0036 主库备份恢复演练 run-id：`08ab9e35-07c5-467d-9b45-7ceccc78dec3`。恢复库在执行前为 36/head 0036、14 用户、118 Session、11 个固定账号角色/active 全匹配。
- 演练事务：11 个账号原子更新、12 个目标旧 Session 撤销、11 条恢复审计；Canonical Schema/提升通过。
- 单个 Chromium 实例顺序验证：admin 登录/无强制改密/退出通过；十个 UAT 登录/强制改密页/退出全部通过；未进入经营工作台，最终目标有效及未撤销 Session 均为 0。
- 演练前后业务指纹均为 `04cdbc8a49112bc43b5652760408d46d10dbdda1801c1c9b816aa9891a5b5c3c`，受保护数据指纹均为 `5414589704ac085792cab1a546e658a61b39c2988800a23ad091e756275e7d41`；角色、active、Migration 和 Schema 保持。
- 演练库、临时备份、临时 Web 副本、浏览器证据和秘密 Stage 已精确清理；Playwright 固定版本运行材料暂留 `/run`，仅供正式浏览器验证，正式完成后清理。
- Identity、事务/Stage、测试/runner 三个只读复审均已完成；当前未发现正式主库执行代码阻断。

## 明确禁止

不读取旧凭据正文或旧密码 hash，不输出任何秘密，不访问 `shujvbiao/`，不修改业务数据、生产环境、真实数据、Migration、公开部署、Swap/dockerd/内核/防火墙/systemd，不 build、不换镜像、不 push/PR、不 reset/stash/restore/rebase/amend，不启动 Planning 核验或退回流程。
