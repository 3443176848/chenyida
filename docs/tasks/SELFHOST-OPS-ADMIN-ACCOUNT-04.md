# SELFHOST-OPS-ADMIN-ACCOUNT-04 新增第二管理员账号

## 状态与授权

- 状态：`DONE / ACCOUNT ACTIVE / FIRST-LOGIN CHANGE REQUIRED`。
- 日期：2026-07-29（Asia/Shanghai）。
- 授权：项目负责人明确要求在当前 `chenyida-erp-parallel` PostgreSQL ERP 新增用户名 `admin2` 的管理员账号，并提供一次性临时密码。

## 执行结果与安全事件

- 首次受控调用已由密码策略以 `PASSWORD_WEAK` 拒绝：临时密码包含明确禁止的常见弱片段。`admin2` 未创建，用户/active admin 仍为 `1/1`，Session 与核心业务计数不变。
- 正式服务按设计保留 1 条失败 `USER_CREATED` Identity 审计、1 条 HTTP 400 幂等结果和 1 次未被限流的写尝试；这些安全记录不删除或改写。
- 项目负责人提供新的合规临时密码后，第二次受控调用成功创建 `admin2`。创建时为 version 1；最终只读 SQL 的分隔符写法错误，曾把当时的密码摘要输出到本任务工具结果。明文未由 runner 输出，但摘要仍按敏感材料处置。
- 立即通过正式 `resetPassword` 服务用同一临时密码生成新随机盐摘要，使已输出摘要失效；最终账号为 version 2、active admin、`must_change_password=true`。该补救保留成功重置审计/幂等记录，不删除或改写安全证据。

## 执行边界

1. 只操作当前 `chenyida-erp-parallel` PostgreSQL 身份数据；不访问或修改 SQLite、D1、其他数据库或外部服务。
2. 必须复用现有 `IdentityService.createUser`，由现有 active admin 作为受授权操作者，执行密码策略、PBKDF2-SHA256 强哈希、持久幂等、事务和 `USER_CREATED` 审计；禁止直接拼接或写入明文密码 SQL。
3. 新账号固定为 `username=admin2`、`display_name=管理员2`、`role=admin`、`is_active=true`、`must_change_password=true`；因安全摘要轮换，最终 `version=2`。
4. 临时密码只从无回显标准输入进入一次性 root-only runner；不得进入命令参数、环境文件、进程参数、日志、报告或 Git。
5. 不修改 Schema、Migration、角色权限映射、现有管理员、Session、业务数据、四个持久卷或部署配置；不 build、restart、deploy、push 或创建 PR。
6. 创建前确认目标账号不存在；创建后只读核对账号状态、密码验证、管理员权限映射、审计、幂等、Migration、核心业务计数及服务健康。
7. 本任务不模拟用户首次登录，不生成无用 Session；用户首次登录后必须立即设置不含用户名的新密码。

## 验收

- 用户数 `1→2`、active admin `1→2`，且只新增 `admin2`。
- `admin2` 为 active admin、首次改密、version 2，最终存储内容为合规 PBKDF2-SHA256/310,000 次新摘要且所提供临时密码可验证；已输出的旧摘要不再有效。
- 保留 `PASSWORD_WEAK` 失败创建、成功创建、安全重置和一次匿名认证门禁检查的 4 条 Identity 审计；幂等结果为 HTTP 400/201/200 各 1 条，限流尝试 3、新 key 3、拒绝 0。
- 临时密码未进入命令参数、环境文件、脚本、系统日志、报告或 Git；旧摘要输出事件及补救如实记录，最终摘要、密码和令牌均未进入 Git。
- Migration 仍为 34/head 0034，Session 和业务核心计数不变；PostgreSQL/Web/Worker/Caddy 健康，restart/OOM 为 0。
