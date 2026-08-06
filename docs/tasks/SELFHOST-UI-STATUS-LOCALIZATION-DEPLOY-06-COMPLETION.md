# SELFHOST-UI-STATUS-LOCALIZATION-DEPLOY-06 完成报告

## 结论

`STATUS LOCALIZATION DEPLOYED — ANONYMOUS READ-ONLY VERIFIED`

项目负责人已明确授权把 `943c7fa5da44182617fa8a4f1d75b49b6d6c3795` 部署到 `https://43.135.148.43.nip.io:18888`。当前 Web 镜像为 `sha256:89e7677538751f2c0a049a113f3d24372a18edaf752bf837038580ac951bd153`，原生 React 与 legacy 兼容台均已使用共享中文状态、角色、审核/执行结果和启停显示。

## 发布与回退证据

| 项目 | 结果 |
| --- | --- |
| 功能基线 | `943c7fa5da44182617fa8a4f1d75b49b6d6c3795` |
| 当前 Web | `sha256:89e7677538751f2c0a049a113f3d24372a18edaf752bf837038580ac951bd153`，88,572,838 bytes |
| 回退 Web | `sha256:f45d734becf2be04dc03477b427762f82e700b615c4722a1001557d56180818a`，标签 `rollback-status-localization-deploy06-predeploy-20260806T110008Z` |
| 备份 | root-only custom dump 2,291,624 bytes，SHA-256 `2beeaeb2ba2d7f7e5c07c7099d0d5985df1bb2ac6a67cc240bcfda0121418d99`，list 3,359 |
| 恢复 | 第二新库恢复 39/head、226 表、文件卷及相同业务指纹后删除 |
| 替换范围 | 仅 Web；PostgreSQL/Caddy 未重建，Worker 仅为一致性窗口短停并恢复，Migration 未运行，四卷不变 |

## 验收

- HTTP 308，HTTPS 根页、health、legacy、状态词典和 legacy bundle 200；在线两个资产 SHA 与源码一致，缓存标识 `20260806-status-localization-05` 及中文状态文本通过。
- 匿名 Session false/null且无 Set-Cookie，Summary/Materials 401；private/no-store、nosniff 和 frame deny 保持。未登录、未发送业务 POST。
- 候选 production build/postbuild、三组 UI 合同 `13/13`、npm `3/3` 和候选健康通过；部署收口 Python 三项及 1,249 文件 credentials 扫描通过。完整源代码验证沿用功能提交的 38 个 UI 文件、10 组 typecheck、lint/build/npm/Python/credentials 证据。
- 部署前、恢复库、部署后与最终业务指纹均为 `590579989e2c2c14d37a3970a2392cd5d486f61385adf171eacbb481d6bdbc24`。39/head、226 表、Session 209、Audit 1,455、RFQ ISSUED v6、Binding 8、Supplier A/B Quote `1/1`、Quote/Award/PO `2/0/0` 保持。
- 公开域名连续 60 秒 health `7/7`，SwapFree `766600→766676 KiB`；最终 OOM 0，四服务 restart 0/OOM false。
- 临时 worktree、容器、恢复库/文件、响应文件和 SQLite 已清零；正式备份与 current/candidate/rollback 镜像保留，未 prune。

## 后续边界

本任务没有执行登录式浏览器旅程、业务操作、Migration、真实公司数据迁移或生产切流。上述动作仍须新的明确授权。
