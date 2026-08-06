# SELFHOST-DASHBOARD-ROLE-HUB-DEPLOY-04 完成报告

## 结论

`ROLE-BASED WORKBENCH DEPLOYED — ANONYMOUS READ-ONLY VERIFIED`

项目负责人已明确授权将 `4767c3db3cf66eb0978f07d044437790c0d4b87f` 部署到 `https://43.135.148.43.nip.io:18888`。当前 Web 镜像为 `sha256:f45d734becf2be04dc03477b427762f82e700b615c4722a1001557d56180818a`，登录后根工作台提供管理员、采购、市场、计划、工程、财务、生产、仓库八入口；每次只展示一个部门的服务端授权模块清单。

## 发布与回退证据

| 项目 | 结果 |
| --- | --- |
| 功能基线 | `4767c3db3cf66eb0978f07d044437790c0d4b87f` |
| 当前 Web | `sha256:f45d734becf2be04dc03477b427762f82e700b615c4722a1001557d56180818a`，88,560,525 bytes |
| 回退 Web | `sha256:f139257b6b6b845bebbf9aa97eb909895158d637956f069b2c82f99b2b1d5b6d`，标签 `rollback-role-hub-deploy04-predeploy-20260806T083541Z` |
| 备份 | root-only custom dump，2,288,824 bytes，SHA-256 `dad839eff68d649e1098b0df33ba3316245a93f65893aea985d012362df266d6`，list 3,359 |
| 恢复 | 第二新库恢复 39/head、226 表及相同业务指纹后删除 |
| 替换范围 | 仅 Web；PostgreSQL/Caddy未重建，Worker仅为一致性窗口短停并恢复，Migration未运行，四卷不变 |

## 验收

- HTTPS 根页、health、legacy、新 bundle 和角色工作台 CSS 通过；HTTP 308、安全头和 private/no-store 保持。
- Dashboard/企业 UI 合同10/10、1,243文件凭据扫描和diff check通过；功能提交已有73/73 UI、五组typecheck、lint、production build/postbuild及npm/Python全通过证据。
- 匿名 Session false/null、无 Set-Cookie，Summary/Materials 401；未登录、未发业务 POST。
- 部署前、恢复库、部署后指纹均为 `597eb456837e0cda35d3544c1aeae94f3a190eed373d1145de5a72261fe37f9f`；Session/Audit及 RFQ/Quote 事实不变。
- 60 秒 health 7/7，SwapFree 无下降；最终内核 OOM 0，四服务 restart 0/OOM false。
- 误用部署类别和遗漏 Compose 项目名的两次保护性中止均未改变数据；无效 dump、恢复库、临时目录和容器已精确清理，正式备份与回退镜像保留。

## 后续边界

本任务没有执行登录式浏览器验收、业务写入、Migration、真实公司数据迁移或生产切流。上述动作仍须新的明确授权。
