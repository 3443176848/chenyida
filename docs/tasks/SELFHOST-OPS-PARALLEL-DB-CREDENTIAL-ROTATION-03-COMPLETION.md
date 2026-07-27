# SELFHOST-OPS-PARALLEL-DB-CREDENTIAL-ROTATION-03 完成报告

## 结论

并行非生产 PostgreSQL 角色密码与 `/etc/chenyida-erp/parallel.env` 已完成安全轮换。新密码经 Worker→PostgreSQL Compose 网络执行 `SELECT 1` 成功；旧密码经 `scram-sha-256` 返回 `28P01`。PostgreSQL 容器没有重建或重启，Web/Worker 严格串行重建并恢复正常。报告和仓库均不记录密码或连接字符串。

固定结论：`PARALLEL POSTGRESQL CREDENTIAL ROTATED AND LOGIN BASELINE ACCEPTED`

## 严格起点

- Branch `main`，HEAD `0d24eddcc5176602370214bfc8f8003844ab2b80`，工作区 clean，相对 `origin/main` behind 0/ahead 70。
- 源码与运行版本保持 `0.1.0-alpha.32`；PostgreSQL migration 恰为 `0001`—`0032` 共 32 个。
- `0032_finished_goods_inventory_lots.sql` SHA-256 为 `3a2fc22ff73706d226641119135b68d042d393124c89233a63d774f76aa2d4fa`。
- 唯一启用管理员 1；唯一审计为 `IDENTITY / LOGIN / success`，创建时间 `2026-07-27 12:32:57.201019+00`；唯一 session 同时间创建、状态 ACTIVE。它们属于同一次合法管理员登录。
- 其余公共业务表、全部幂等表、uploads 和 attachments 均为 0；app_meta 1。

## 资源与保护门禁

- 起点 available memory 约 2.3 GiB，Swap used 138 MiB，60 秒增长 0，根分区可用 37 GiB，Load `0.07/0.15/0.17`；未触发停止阈值。
- 最终 available memory 约 2.3 GiB，Swap used 约 138 MiB，60 秒增长 -304 KiB，根分区可用 37 GiB，Load `0.17/0.22/0.19`；无 OOM、异常 restart、容器不健康或负载持续超限。
- PostgreSQL/Web healthy，Worker running，三容器 RestartCount 0、OOMKilled false；Build Cache 0B。
- 四个受保护卷均保持，创建时间均为 `2026-07-25T21:05:58+08:00`：`chenyida-erp-parallel_erp_postgres`、`erp_uploads`、`erp_attachments`、`erp_backup_status`。
- Python 服务 PID `13737`、NRestarts 0；真实 SQLite 仅核验 metadata：inode `53827608`、size `1544192`、mode 600、mtime `2026-07-26 01:03:51.761827070 +0800`。未读写正文、未停止或重启 Python。

## 执行与回滚保护

1. 轮换前创建 root:root 0600 的 env 临时回滚副本；新密码为 256-bit 随机 URL-safe 值，只存在于进程内存、目标 env 和短期回滚副本。
2. 严格串行停止 Web、Worker；PostgreSQL 保持 running/healthy。
3. 角色密码通过 PostgreSQL 容器本地 stdin 修改，SQL 未进入命令参数或输出。
4. 只原子更新 `POSTGRES_PASSWORD` 与 `DATABASE_URL` 的密码段，其他 env 行保持；owner/mode 仍为 root:root 0600，Compose config 通过。
5. 严格先重建并等待 Web healthy，再重建并观察 Worker running；PostgreSQL 容器 ID 和 StartedAt 保持不变。
6. 两次保护性回滚均成功：首次识别到 PG 容器 localhost HBA 为 `trust`，不能用于旧密码失效证明；第二次识别到 Bash `ERR` trap 将预期认证失败误当异常。两次均恢复旧角色与 env、串行恢复服务并安全删除副本。最终使用 Worker→PG 的 `scram-sha-256` 路径和显式条件判断通过。
7. 运行态验收全部通过后，回滚副本安全删除；没有遗留旧凭据临时文件或测试容器。

## 验收结果

- 新密码：Compose 网络 `SELECT 1` PASS。
- 旧密码：PostgreSQL `28P01` rejection PASS。
- HTTP：`/api/health` PASS；`/api/session` 返回 200 且端点可用。为保持不可变基线，没有再次 POST 登录制造第二条审计/会话。
- 数据：schema_migrations 32、app_meta 1、唯一启用 admin 1、audit 1、ACTIVE session 1；其余业务/幂等/uploads/attachments 0。
- `docker compose config -q` PASS。
- `npm test` PASS，3/3；生产 Worker 镜像默认用户首次因 `/app/package.json` 权限未进入测试，改用受限 root 临时容器后同命令通过。
- `npm run lint` PASS，0 error/9 个既有 warning；生产 Worker 镜像不含 devDependency，最终使用现有 Node 镜像只读挂载当前工作区、断网运行。
- `npm run security:credentials` PASS，994 个仓库文件；slim 镜像不含 Git，最终使用已有完整 Node 镜像只读挂载、断网运行。
- 未执行 build、Compose build、migration、restore、全量 PostgreSQL 测试或 Docker cache 生成/清理。

## 登录基线与后续约束

- 当前 audit 1 与 app_sessions 1 是同一次合法管理员登录，不能为恢复“零记录”而删除不可变审计。
- TASK09 未启动、未授权。
- TASK09 若未来单独授权，必须在开始时记录当前基线主键或不可逆摘要；摘要不得包含 token、密码、CSRF、请求正文、密码哈希、连接字符串或 env 内容。
- TASK09 的新增数据和清理只能按 baseline-delta 验收；结束后必须返回与本报告相同的合法审计/会话记录集和计数。

## Git 与范围

- 本任务仅提交本报告及 `MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`STATUS.md`、`CHANGELOG.md`。
- 未修改业务代码、Schema、Migration、Compose、版本、Python、SQLite、部署或生产资源；未 push、未创建 PR。
- 独立提交消息：`ops: rotate parallel database credential safely`；实际提交 SHA 以 `git log -1` 为准。
