# SELFHOST-PHASE3-TASK05 完成报告

完成日期：2026-07-25（Asia/Shanghai）

唯一完成结论：`PARALLEL HTTP ACCEPTANCE ENVIRONMENT RUNNING`

## 部署结果

- 可信起点为 `main` / `7c39ff9b2c50786a225fe788ec5e3b6fb9f91dc2` / clean / ahead 16、behind 0；独立提交父提交保持该值。
- Compose 项目 `chenyida-erp-parallel` 保持运行；PostgreSQL 17.10 healthy、migrate exited 0、Web healthy、Worker running。
- Web 只绑定 `127.0.0.1:3000`。服务器存在历史公网 NAT 记录，不能证明只经可信内网访问，因此不对公网开放明文登录；用户通过 SSH 隧道访问 `http://127.0.0.1:3000`。
- PostgreSQL 没有宿主机端口；Caddy/production profile、80/443、DNS 和防火墙均未启用或修改。
- 持久卷为 `erp_postgres`、`erp_uploads`、`erp_attachments`、`erp_backup_status` 四个项目隔离 Volume。

## 身份与数据库

- `0001_selfhost_baseline.sql` 至 `0014_migration_openings.sql` 共 14 个 migration 成功，版本与 checksum 基线未改；没有 `0015`。
- 创建唯一管理员 `admin` / `系统管理员`；重复初始化安全返回 `SETUP_COMPLETE`。
- PostgreSQL 密码和 setup token 为 64 字符密码学安全随机值；管理员临时密码为 51 字符且满足大小写、数字、特殊字符策略。
- setup token 已轮换并同步重建 Web/Worker。管理员密码不在 Compose 长期 env；凭据只在 `/etc/chenyida-erp/parallel-admin.txt`，owner `root:root`、mode `0600`。
- 数据库为空业务环境：1 个管理员、101 个分类 seed、34 个属性定义、0 个物料；未导入真实账号或业务数据。

## 验收结果

- `docker compose config --quiet`：PASS。
- Web 健康、根工作台、管理员 login/session/logout、Dashboard 空状态：PASS。
- 23/23 legacy 刷新 GET：PASS，无未知 404。
- PostgreSQL/Web/Worker 重启后 14 migrations、管理员、登录、Dashboard 空状态和健康：PASS。
- 专项部署发现 PostgreSQL 重启会让 Worker 空闲 Pool 产生未捕获 `57P01`；已增加去敏 Pool error handler 和 Worker 轮询重试。专项测试 2/2、Dashboard typecheck、目标 lint、镜像 build 通过。
- 修复后只重启 PostgreSQL，Worker 容器 ID/启动时间保持不变；记录 1 个安全 Pool 事件和 1 个轮询重试，无未捕获异常；随后最终 HTTP 流程和 23 GET 再次通过。

## 资源与旧系统保护

- 部署前：可用内存约 2.4GiB，swap 已用约 307MiB，磁盘可用 42GB，load average `0.26/0.20/0.27`。
- 最终稳态核验：可用内存约 2.2GiB，swap 约 441MiB 已用且 20 秒复测未继续增长，磁盘可用 36GB，load average `0.63/0.90/0.85`；Web/Worker/PostgreSQL 合计约 145MiB。停止条件均未触发。
- Python PID 前后均为 `277640`，`http://127.0.0.1:18888` 返回 200。
- SQLite `/opt/erp/chenyida_erp_app/data/erp.sqlite3` 的 inode `53827608`、mode `0600`、owner `root:root`、size `1544192` bytes 和 mtime 均未变化；本任务未读取业务正文、未修改或迁移真实 SQLite。

## 明确排除

未迁移真实数据、未双写、未切流、未启 HTTPS、未启动 Caddy、未对外开放 PostgreSQL、未修改 Python systemd、未访问 D1/远程 PostgreSQL/生产数据库、未 push、未创建 PR。本环境不是生产上线。

运维入口：`docs/self-hosting/parallel-http-acceptance.md`。管理员首次登录后必须改密并删除 `/etc/chenyida-erp/parallel-admin.txt`。
