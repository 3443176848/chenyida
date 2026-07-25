# SQLite 一致性只读快照协议

## 目的与授权边界

协议仅适用于 `SELFHOST-PHASE3-TASK04` 对获准的本机 Python 运行库进行一次一致性只读盘点。源路径必须经 `realpath` 后与代码中固定授权路径完全一致，并同时满足：非符号链接、普通文件、父目录精确一致、systemd unit/工作目录与 Python 默认配置推导一致、非 backup/test/unknown path。

路径不一致时立即 `BLOCKED`；不得探测或读取替代数据库。

## 前置守卫

在读取任何业务行前必须同时验证：

- 显式真实只读模式与固定确认文字；
- `--no-materialize`、`--no-files`；
- 不存在 PostgreSQL target URL 或其他 target 参数；
- 快照 manifest、快照 SHA-256、当前 Git commit 和工具版本逐项匹配；
- 输入快照和输出目录位于同一个带任务标记的 `mktemp -d` 根目录，权限为 `0700`，均不在仓库、源数据、backup、upload、attachment 或 archive 下；
- 快照是普通文件且不是符号链接，manifest 是普通文件，输出目录为空；
- ERP 环境没有 D1 binding，进程参数和环境没有远程来源。

## Online backup

1. 创建仓库外任务目录并收紧为 `0700`。
2. 以 SQLite URI `mode=ro` 打开源连接，立即设置连接级 `query_only=ON`。
3. 使用 Python 标准库 `sqlite3.Connection.backup()` 将一致性页映像写入任务专用快照；禁止写事务、DDL、持久 PRAGMA、VACUUM 和 WAL checkpoint。
4. 对快照执行 `PRAGMA integrity_check`，结果必须严格为 `ok`；记录 SQLite version、页数、文件大小、时间、SHA-256 和安全 Schema fingerprint。
5. manifest 只记录 source path digest，不记录绝对源路径。
6. 记录源文件前后 inode、mode 与权限一致性，以及 Python PID 前后相等；源业务进程的正常写入不得被误报为任务写入。

## 失败与清理

快照创建器采用 `try/finally`：失败时删除已创建快照和 manifest；真实执行结束后删除整个任务临时目录。快照和 task-local HMAC key 不进入仓库、backup 或日志，删除结果必须明确记录为“已删除、不可恢复”。本协议不停止服务，也不读取 WAL/SHM 裸文件组合。
