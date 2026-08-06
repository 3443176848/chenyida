# SELFHOST-UI-REFRESH-DEPLOY-02 完成报告

## 最终状态

`ENTERPRISE UI DEPLOYED — ANONYMOUS READ-ONLY VERIFIED`

`aac6f34` 的企业级 UI 已 Web-only 部署到当前 18888 非生产 UAT。登录/设置/改密认证壳、经营工作台、原生业务壳和 legacy 兼容业务台均由新镜像提供；版本保持 alpha.40，PostgreSQL 保持 39/head 0039。

## 发布与回退

- 新 Web：`sha256:f139257b6b6b845bebbf9aa97eb909895158d637956f069b2c82f99b2b1d5b6d`，88,560,352 bytes，镜像标签保留 current/candidate。
- 旧 Web：`sha256:20b41bd34741758e707f3748baaa1018232df6be5d44cd63bed290fd49c9f4f9`，以 `rollback-ui-refresh-deploy02-predeploy-20260806T080240Z` 精确保留。
- 只替换 Web；PostgreSQL `f3a2f3cb…`、Worker `fb68d9a8…`、Caddy `c209765b…` 的容器身份和启动时间不变，Migration 未运行，四卷未更换。

## 备份与数据保护

- predeploy custom dump 为 root:root 0600、2,288,827 bytes、SHA-256 `8dd0141bb047d75b0bfea87011d7ac56db46d27b7fe51907045b8a173c93de7d`，list 3,359 项。
- 第二新库恢复 39/head、226 表、Session/Audit 聚合与保护指纹一致后已精确删除；正式备份保留。
- 部署前后主库均为 Session 207/有效 10、Audit 1,446，保护指纹 `597eb456837e0cda35d3544c1aeae94f3a190eed373d1145de5a72261fe37f9f`。RFQ ISSUED v4、Binding 8、Supplier A/B Quote 1/0、Quote/Award/PO 1/0/0 不变。

## 验收

- Docker 生产 build/postbuild、企业 UI 4/4、Dashboard UI 5/5、npm 3/3、Python三项、1,240文件credentials、diff check和候选静态/运行合同通过。
- 线上 `/`、`/api/health`、legacy 和 CSS 均为 200；新 bundle/CSS/缓存版本、private/no-store 与安全响应头通过。
- 匿名 Session false/null 且不发 Cookie；Summary/Materials 401。没有登录、Session 新增、Audit 增量或业务 POST。
- 60 秒 7 次健康检查全为 200，Swap 未增长；四服务 restart 0/OOM false，内核 OOM 0。

## 资源与清理

- 起点：available 约 2.2 GiB、Swap 289 MiB、根盘 18 GiB、Load `0.21/0.35/0.43`。
- 收口：available 约 2.2 GiB、Swap 292 MiB、根盘 19 GiB、Load `0.28/0.49/0.49`。
- 临时容器、恢复库、Python临时SQLite和工作区构建输出清零；未 prune。正式备份、当前/候选/rollback Web 镜像和四个受保护 Volume 保留。

## 停止边界

本任务到匿名只读验收结束。登录式浏览器验收、Supplier B Quote、Supplier A 修订、Comparison/Award/PO、真实数据迁移或生产切流均须新的明确授权。
