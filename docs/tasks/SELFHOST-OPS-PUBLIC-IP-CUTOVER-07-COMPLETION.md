# SELFHOST-OPS-PUBLIC-IP-CUTOVER-07 完成报告

## 结论

`PUBLIC IP HTTPS CUTOVER COMPLETE`

当前公网入口已从 `https://43.135.157.211.nip.io:18888` 切换为 `https://43.135.148.43.nip.io:18888`。新地址已由公开外部只读探针实际读取登录页；Caddy 使用 Let's Encrypt 可信证书，Web 继续只绑定回环，PostgreSQL 不暴露宿主端口。

## 配置、证书与回退

- `/etc/chenyida-erp/parallel.env` 只改变 `ERP_DOMAIN` 和 `ERP_PUBLIC_ORIGIN`，其余内容经安全归一化比较与回退副本一致；文件保持 root:root 0600。
- 原配置保存在 `/var/backups/chenyida-erp/SELFHOST-OPS-PUBLIC-IP-CUTOVER-07-parallel.env.pre-change`，root:root 0600；恢复后串行重建 Web/Caddy 即可回退运行配置。
- 新证书 CN/SAN 均为 `43.135.148.43.nip.io`，issuer 为 Let's Encrypt `YE2`，有效期为 2026-07-30 17:05:14Z 至 2026-10-28 17:05:13Z；主机名校验通过。
- HTTP 80 返回 308 到新 HTTPS 18888；HTTPS 首页和 `/api/health` 为 200，HSTS、nosniff、DENY frame、same-origin referrer 与 permissions policy 保持；匿名 `/api/materials` 为 `AUTH_REQUIRED/401`。旧主机名 SNI 在当前 Caddy TLS 握手失败。

## 运行与数据边界

- 只用既有镜像串行重建 Web/Caddy；Web 镜像仍为 `sha256:881c033dc97e...`，Caddy 仍为 `sha256:4c6e91c6ed0...`。PostgreSQL/Worker 容器 ID、镜像和启动时间不变，四服务 restart 0/OOM false。
- Migration 保持 34/head `0034_supplier_receipt_lot_iqc.sql`；Material/Product/Product Version/BOM Header/BOM Version/Line 保持 `536/7/7/6/6/316`。
- 本任务没有调用身份或业务写接口。任务初始只读快照为 Session/Audit/Idempotency `103/1147/43`；Web 重建前发生一组并发外部登录/本人改密/退出/失败登录/再登录，使其变为 `105/1152/44`。这些动作最晚为 18:03:01Z，早于 Web 重建 18:03:29Z；切换后对应新增均为 0，记录未删除或改写。
- 预检还发现 533—536 已于本任务开始前的 13:45—13:48Z 经正式流程成为 ACTIVE/version 3/有正式编码；当前 536 个 Material 全部 ACTIVE。该既有外部业务变化不属于本任务，本任务没有审核、退回、编辑或编码任何物料。
- 未 build/pull 镜像、运行 Migration、修改防火墙/安全组/systemd/Swap、重启 PostgreSQL/Worker/Python，未部署 alpha.36 或读取业务表格正文；四个受保护卷 metadata 保持。

## 验证与资源

- 来源/身份单元测试 `15/15`，基础 FileStorage `3/3`；全仓 lint `0 error / 8 个既有 warning`。
- 断网、只读、资源受限的最终凭据扫描通过：`CREDENTIAL_CHECK_OK (1103 repository files scanned)`。
- 起点约 2.1 GiB available、193 MiB Swap、29 GiB 根盘、Load `0.24/0.28/0.17`；最终 `2,474,940 KiB` available、`204,964 KiB` Swap、30 GiB、Load `0.02/0.29/0.28`。
- 60 秒观察窗口 Swap `192,596→192,592 KiB`，增长 -4 KiB；内核 OOM 0，Caddy error-level 日志 0。临时测试容器自动删除，没有任务临时数据库或其他临时容器。
- 未 push/PR、未改写历史；Git 只记录脱敏任务/状态文档，不包含 env、证书私钥、凭据、Cookie、Token、摘要、数据库正文或备份。
