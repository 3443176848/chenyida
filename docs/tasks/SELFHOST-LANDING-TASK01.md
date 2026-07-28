# SELFHOST-LANDING-TASK01 — 封存 alpha.34 并生成可异机复制的完整灾备包

## 授权与目标

项目负责人授权且仅授权在当前回环非生产服务器封存 `0.1.0-alpha.34`：固定根仓库完整历史，生成 clean-0034 PostgreSQL custom dump，归档 uploads、attachments、backup-status 三个文件卷，形成无秘密的恢复清单，并实际验证 Git、数据库和文件卷恢复。

灾备目录固定为 `/var/backups/chenyida-erp/landing-alpha34-20260728T042820Z`，owner/mode 为 `root:root`/`0700`。灾备包只保留在本机，禁止自动 push、上传、scp 或发送到任何外部目标。

## 严格起点

- `main` / `82e9f07ce1666ace2677853408c7fb4339808cfc`，工作区 clean，`origin/main...HEAD` 为 behind 0/ahead 76。
- package `0.1.0-alpha.34`；PostgreSQL migration `0001`—`0034` 共 34 个；`0034_supplier_receipt_lot_iqc.sql` SHA-256 为 `29b380050d7d7003df82df981aea061e7287845dde773f181caf918a49d47b2d`。
- PostgreSQL/Web healthy、Worker running；RestartCount 0、OOMKilled false；Web 只绑定 `127.0.0.1:3000`，PostgreSQL 无宿主端口；Build Cache 0B。
- 四个受保护 ERP Volume 与 `resource-guard-20260727-0824.dump` 存在；Python PID/NRestarts 和 SQLite metadata 只读记录。
- 数据库为 clean-0034：migrations/admin/audit/session=`34/1/1/1`、`setup_completed=1`，其余 205 张表均为 0；不读取 token/hash、密码哈希、请求正文或 Cookie。

## 交付物与验证

最终目录至少包含 Git Bundle、PostgreSQL dump、三个 Volume tar、migration/repository/image/environment/volume 清单、`RESTORE.md`、`MANIFEST.json` 和 `SHA256SUMS`。所有文件为 root:root 0600。

执行顺序：

1. 完成 Git fsck、完整可达历史、TASK01—TASK10、无 gitlink/嵌套仓库与凭据扫描核验。
2. 严格停止 Worker、Web，PostgreSQL 保持 healthy；生成 custom dump 后优先恢复 Web healthy、Worker running。
3. 从精确 Mountpoint 只读打包三个文件卷，不跟随符号链接，不归档 PostgreSQL 原始 Volume。
4. 只创建固定新空验证库 `chenyida_erp_landing_alpha34_restore_verify`，以单事务恢复并核对 schema、checksum、非敏感基线，成功后删除。
5. 分别恢复三个 tar 到 root-only 临时目录，核对路径、文件 SHA、uid/gid/mode/mtime 和源不变后删除临时目录。
6. 仅提交项目文档，提交消息 `ops: prepare alpha.34 disaster recovery package`，Parent 必须为严格起点。
7. 以提交后的最终 `main` 创建并实际 clone Git Bundle；最后生成 MANIFEST/SHA256SUMS 并完整校验。

## 安全与停止边界

PostgreSQL dump 含身份哈希与 Session 数据，必须始终按机密文件处理。`parallel.env` 正文、数据库 URL、密码、Token、Session Digest、Cookie、密码哈希和请求正文不得进入仓库、清单或聊天。

本任务不 build、不改代码/Schema/Migration/package/lock/Compose，不访问生产，不迁移真实业务数据，不操作真实 SQLite 正文，不重启 Python/systemd，不修改防火墙/HTTPS/Swap/dockerd/内核，不删除受保护 Volume 或 resource-guard，不执行通用 prune。任一硬门禁、资源停止线、恢复或 checksum 失败即停止并保留诊断证据。

异机复制必须由用户通过受控 scp/SFTP/VPN 完成；本机生成成功只允许标记 `DONE / READY_FOR_OFFHOST_COPY`，不得宣称 `OFFHOST BACKUP COMPLETE`。
