# 自托管架构

## 运行组件

- `web`：Vinext standalone Node.js 服务，负责页面、认证、授权、CSRF、审计、业务 API 和后台任务提交。
- `worker`：独立 Node.js 常驻进程，和 Web 共享业务/基础设施模块，但使用独立连接池与启动入口。
- `postgres`：唯一业务数据库和任务协调源。
- 本地文件卷：`uploads` 与 `attachments`，只保存二进制；PostgreSQL 只保存 SHA-256、大小、MIME、原文件名、随机存储名和相对路径。
- `caddy`：可选 production profile，自动申请/续期 HTTPS 证书并反向代理 Web。

## 基础设施边界

`db/index.ts` 提供 PostgreSQL Pool、Drizzle 和显式 transaction；Repository/业务写操作不得依赖浏览器或平台 binding。`FileStorage` 提供原子写、读取和受控删除。`BackgroundJobQueue` 提供 Outbox、claim、heartbeat、complete、fail 和 expired recovery。`Clock`/`IdGenerator` 可在测试中替换。

Web 在业务 transaction 内写 Outbox。Worker 先以 `FOR UPDATE SKIP LOCKED` 发布 Outbox，再用相同锁策略领取任务；领取时写 owner、随机 lease token、过期时间、attempt 和 version。心跳、完成、失败都必须同时匹配 job ID、owner 和 token。业务结果与 job `SUCCEEDED` 在同一 PostgreSQL transaction 发布。

## 数据与故障边界

PostgreSQL 和两个文件目录分别使用命名卷，容器重建不会清空。多个 Worker 可以并发；同一 job 只允许一个有效租约。Worker 异常退出后，恢复器把过期任务重排或转为 `DEAD`。Web/Worker 停机不触发 schema migration，也不自动迁移旧数据。

本地文件写入先使用同目录随机临时文件、`fsync`、原子 rename 和目录 `fsync`；任何用户文件名都只作为受控元数据，不能决定磁盘路径。数据库与文件不是同一事务介质，上传失败协调和备份一致性仍需按运维文档处理。
