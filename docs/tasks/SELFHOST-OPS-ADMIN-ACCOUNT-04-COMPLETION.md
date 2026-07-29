# SELFHOST-OPS-ADMIN-ACCOUNT-04 完成报告

## 结论

- 状态：`DONE / ACCOUNT ACTIVE / FIRST-LOGIN CHANGE REQUIRED`。
- 当前 `chenyida-erp-parallel` 已新增 `admin2`；账号为 active admin，显示名“管理员2”，最终 version 2、`must_change_password=true`、尚未登录。
- 只操作 PostgreSQL 身份服务；未访问 SQLite、D1、其他数据库或外部服务，未修改 Schema/Migration、业务数据、既有管理员、Session、角色权限映射或四个持久卷。

## 创建、门禁与安全补救

- 起点用户/active admin 为 `1/1`，`admin2` 不存在。首次临时密码含禁止的常见弱片段，正式 `IdentityService.createUser` 以 `PASSWORD_WEAK` 原子拒绝；没有半创建。
- 新的合规临时密码只经关闭回显的 stdin 进入一次性 root-only runner。第二次调用通过现有 admin actor、密码策略、写限流、持久幂等和事务审计成功创建账号。
- 创建后一次只读 SQL 因分隔符写法错误，把当时的密码摘要输出到本任务工具结果。明文未由 runner 输出，但旧摘要按敏感信息事件处理。
- 立即由既有管理员通过正式 `IdentityService.resetPassword` 使用同一临时密码生成新的随机盐摘要；旧摘要已失效。最终摘要为 PBKDF2-SHA256/310,000 次，结构和临时密码验证均通过，账号 version `1→2` 且继续要求首次改密。
- 临时密码没有进入命令参数、环境文件、进程参数、脚本、系统日志、报告或 Git；最终摘要、Session token、数据库凭据均未输出或提交。

## 身份与数据核对

| 项目 | 起点 | 最终 | 结果 |
| --- | ---: | ---: | --- |
| 用户 | 1 | 2 | 只新增 `admin2` |
| active admin | 1 | 2 | 既有管理员完全不变 |
| Session / 当前有效 | 2 / 0 | 2 / 0 | 未模拟登录、未生成 Session |
| Audit / Identity Audit | 877 / 5 | 881 / 9 | 4 条新增安全证据 |
| Idempotency | 0 | 3 | 失败创建 400、成功创建 201、密码重置 200 |
| 写限流 attempt/new key/rejected | 0 / 0 / 0 | 3 / 3 / 0 | 无拒绝 |
| Material/Product/BOM/BOM Line | 532/6/6/316 | 532/6/6/316 | 业务不变 |

4 条新增 Identity Audit 分别为：弱密码创建失败、`admin2` 创建成功、只读匿名 `/api/users` 认证门禁失败和 `admin2` 密码重置成功。审计、幂等和限流记录按安全规则保留，不删除或改写。

## 系统、测试与资源

- Migration 保持 34 条，head `0034_supplier_receipt_lot_iqc.sql`；源码仍为 alpha.35/0035，常驻运行面仍为 alpha.34/0034。
- PostgreSQL/Web/Worker/Caddy 为 healthy/healthy/running/running，本机及 Caddy TLS health 为 200，匿名用户 API 为 401；四容器 RestartCount 0、OOMKilled false，内核 OOM 0。
- 身份单元测试 8/8、部署 Web 资产 UI 合同 4/4 通过。首次把 unit/UI 合并放入 Worker 镜像时因其不含 Web public 资产退出；首次 Web runner 又因 bind 文件权限退出，改为 root 只读 runner 后通过，均未执行断言绕过或写运行服务。
- 起点 available 2.3 GiB、Swap 126 MiB、根盘 35 GiB、Load `0.05/0.12/0.14`；最终 available 2.3 GiB、Swap 126 MiB、根盘 35 GiB、Load `0.10/0.14/0.13`。没有 OOM 或容器 restart。
- 所有账号、语法与测试 runner 及 root-only 临时目录均已删除；无任务容器或临时文件残留。四个 ERP 持久卷全部保留。
- 未 build、restart、Migration、deploy、切流、push、PR 或操作 Python 服务。Git 只记录脱敏任务文档，不包含密码、摘要、Token、凭据或真实业务数据。

## 用户后续动作

使用 `admin2` 和项目负责人刚提供的临时密码登录 `https://43.135.157.211.nip.io:18888`，系统会立即进入首次改密页面。新密码必须不同于临时密码、不包含用户名，并满足当前强密码策略。
