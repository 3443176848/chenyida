# SELFHOST-PHASE3-TASK05：同机并行部署自托管 ERP 验收环境

状态：`DONE`

开始日期：2026-07-25（Asia/Shanghai）

## 可信起点

- Branch `main`，HEAD `7c39ff9b2c50786a225fe788ec5e3b6fb9f91dc2`，工作区 clean，相对 `origin/main` ahead 16 / behind 0。
- 自托管版本保持 `0.1.0-alpha.14`；PostgreSQL migration 严格保持 `0001`—`0014`，不得创建 `0015`。
- Python PID `277640`，监听 `0.0.0.0:18888`；真实 SQLite 为 `/opt/erp/chenyida_erp_app/data/erp.sqlite3`，开始时 inode `53827608`、mode `0600`、size `1544192` bytes。
- 根文件系统可用约 42GB；开始时可用内存约 2.4GiB，swap 已用约 307MiB，load average `0.26/0.20/0.27`。
- Docker 中没有运行中的容器；现有 `trae` Compose 项目为 exited，本任务不修改或删除其资源。

## 唯一范围

在同一服务器以 Compose 项目 `chenyida-erp-parallel` 启动 PostgreSQL 17、migration、Web 和 Worker，创建空环境管理员并完成 HTTP 验收。旧 Python/SQLite 继续独立运行于 18888；新 Web 只使用 3000；不启动 Caddy，不使用 80/443，不改防火墙、DNS、Python systemd 或真实 SQLite。

服务器存在历史公网访问记录，当前 RFC1918 网卡不能证明只经可信内网访问，因此 Web 必须绑定 `127.0.0.1:3000`。验收只通过 SSH 隧道访问，环境明确标记为 `PARALLEL HTTP ACCEPTANCE ONLY`，并使用 `ERP_ENV=development`。

## 安全与数据边界

- 配置只保存到 root 专用 `/etc/chenyida-erp/parallel.env`，owner `root:root`、mode `0600`；强随机 PostgreSQL 密码和 setup token 不进入终端输出、日志或 Git。
- 管理员为 `admin` / `系统管理员`，临时密码至少 24 字符，只保存到 `/etc/chenyida-erp/parallel-admin.txt`，owner `root:root`、mode `0600`；不得写入长期 Compose env。
- 初始化完成后确认重复初始化安全拒绝，随后轮换 setup token 并重建 Web/Worker。
- 不读取、复制或迁移真实业务行、D1、远程 PostgreSQL、附件或 SQLite 正文；不双写、不切流。

## 验收计划

1. Compose 配置、镜像构建、`0001`—`0014` migration 与四服务状态。
2. Web 健康检查、Worker、管理员 login/session/logout、根工作台、Dashboard 空状态和 23 个 legacy GET。
3. PostgreSQL 无宿主机端口，Web 仅 `127.0.0.1:3000`。
4. 重启 PostgreSQL/Web/Worker 后 migration、管理员和登录持久，Web/Worker 恢复健康。
5. 部署前后资源、Python PID/18888 和 SQLite inode/mode/size 不变性核对。
6. `git diff --check`、凭证扫描、配置泄漏检查、文档同步和独立提交。

## 停止条件

若可用内存持续低于 500MB、swap 快速增长、load 持续异常、磁盘低于 15GB、Python 异常或任何禁止边界被触发，立即停止 `chenyida-erp-parallel` 服务但保留 Volume，记录诊断并标记 `BLOCKED`；不得终止其他系统进程。

完成结论只能是 `PARALLEL HTTP ACCEPTANCE ENVIRONMENT RUNNING`。TASK05 完成后停止，不自动开始真实数据迁移、HTTPS、切流或业务切换。

完成报告：`docs/tasks/SELFHOST-PHASE3-TASK05-completion.md`。
