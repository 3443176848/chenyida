# SELFHOST-UAT-FIX-38 — 收货预检与Web运行时版本合同修复完成报告

日期：2026-08-09（Asia/Shanghai）

## 1. 最终判定

`SELFHOST-UAT-FIX-38 DEPLOYED AND REVALIDATED — NO UAT RECEIPT`

本结论只适用于18888并行非生产UAT。alpha.42收货日期预检和运行时版本合同已Web-only部署并完成warehouse零业务写复验；不表示真实收货、真实数据迁移、生产发布或生产就绪。

## 2. 授权范围与严格起点

- 唯一worktree、clean `main@fc551c6571b57593a3232a14617935b3e3c3171f`，Parent `569aa954d764309e239d1f6c174e582596d33a24`，`origin/main=39946f6b854a985b5c19106eaa6c938bddaf9c7c`，behind0/ahead185；无嵌套仓库、submodule或并行任务。
- 授权只允许把并行非生产UAT Web从旧alpha.41完整镜像替换为已通过alpha.42候选，失败时只回滚Web；只允许一个隔离Chromium、一个Profile、warehouse恰好一次登录/一次退出以及业务GET。
- 禁止并实际未执行：生产访问/部署、Migration、Receipt POST或其他业务写、PostgreSQL/Worker/Caddy重建或重启、数据修正、备份、Git或镜像push、系统配置变更。
- 起点数据库为40/head `0040_warehouse_receipt_readiness.sql`；warehouse active/version5/must-change=false/Session0；PO/Line/Plan/queue为`1/4/4/4`、已收0，Receipt及全部下游0。四个受保护Volume均存在。

## 3. Web-only部署命令与实际镜像

部署前建立精确回退tag `chenyida-erp-parallel-web:0.1.0-alpha.41-fix38-rollback`，再把通过候选标记为`chenyida-erp-parallel-web:latest`。唯一Compose替换命令为：

```text
COMPOSE_PARALLEL_LIMIT=1 docker compose \
  --env-file /etc/chenyida-erp/parallel.env \
  -p chenyida-erp-parallel \
  -f /opt/erp/chenyida_erp_site/compose.yml \
  up -d --no-deps --no-build --pull never --force-recreate web
```

新Web完整容器ID为`f0066fe6fb07bd2542caf39f8409571125b0b8009592d7dfd3b754c91981a35f`，实际Image ID为`sha256:e7761e2c61bfe77c6aab526fb0b6cbd840ad1bf6300381f4319f6e279af94964`。镜像内最小package为`chenyida-erp-selfhosted / 0.1.0-alpha.42 / private=true / type=module`；OCI version/revision/task为`0.1.0-alpha.42`、`569aa954d764309e239d1f6c174e582596d33a24`和`SELFHOST-UAT-FIX-38`。

## 4. 四服务容器ID前后对比

| 服务 | 部署前完整容器ID | 最终完整容器ID | 结果 |
| --- | --- | --- | --- |
| Web | `1e5394349c49895ca14aba09cd8f765cd88a7fff94b593ff675e165481b8865f` | `f0066fe6fb07bd2542caf39f8409571125b0b8009592d7dfd3b754c91981a35f` | 仅此服务按授权recreate |
| Worker | `fb68d9a81b87fc625f5a78407b9e1020c7c65daa6b39079f6564ac860a57f6e0` | 同前 | 未重建、未重启 |
| PostgreSQL | `f3a2f3cb32f4f76cf8a31a4db9b1276adb36484c912925889e909114a332ead3` | 同前 | 未重建、未重启 |
| Caddy | `c209765be0b4abb867870949f9e9d1a37eef44aa0f97862af742f87f7cc518df` | 同前 | 未重建、未重启 |

## 5. 本地及公开alpha.42 health

- `http://127.0.0.1:3000/api/health`与`https://43.135.148.43.nip.io:18888/api/health`均为HTTP200。
- 两个入口均返回`ok=true`、`database=postgresql`、`storage=local`、`worker=postgresql-jobs`、`version=0.1.0-alpha.42`及合法time。
- 公开health为`Cache-Control: no-store`并有合法`X-Request-ID`；正文不含路径、环境、数据库URL、镜像ID或异常。

## 6. Caddy公开安全头

公开入口确认以下边缘头存在且符合合同：

- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: same-origin`
- `Permissions-Policy: camera=(), geolocation=(), microphone=()`
- health另有`Cache-Control: no-store`及`X-Request-ID`

## 7. 匿名保护

- 登录前公开warehouse页面不包含`PO-00000001`、`SUP-000001`、Material 533—536、四个内部编码或创建审计信息；受保护queue API为401，敏感标记0。
- 正常退出后，Back、Forward、Refresh均未恢复认证或受保护内容；直接匿名访问`/warehouse/receiving`只显示“请先登录”，PO、Supplier、Material和确认窗均为0。
- Web从新容器启动后的日志只有启动/请求级非敏感行；凭据、DATABASE_URL、Token、SQL堆栈和敏感正文命中0。

## 8. 未来日期422黑盒证据

唯一warehouse会话在桌面视口填写完整但未提交的非敏感草稿，数量为1、证据类型为其他等价来源、凭证编号为`FIX38-ZERO-WRITE-PREVIEW`、凭证日期为`2099-12-31`，并填写提前到货原因、两个明确确认及说明。

- preview GET查询同时包含`quantity=1`和`evidence_document_date=2099-12-31`。
- 响应为HTTP422、code `RECEIPT_EVIDENCE_FUTURE_DATE`、message `送货凭证日期不能晚于服务端实际收货日期`；正文`request_id`与`X-Request-ID`一致。
- 对应编辑卡显示code、中文提示和request ID；确认窗口未出现，最终确认按钮不可达。
- 其余表单草稿全部保留；Receipt POST和所有业务写请求均为0。

## 9. 合法日期与四种返回修改证据

合法业务日期`2026-08-09`只来自登录前PostgreSQL只读事务的Asia/Shanghai日期，不使用浏览器时间。同一登录、同一Chromium内按该日期执行4次全新preview GET，均为HTTP200并各打开一次全新确认窗。

- 每次确认窗的“返回修改”均为默认焦点，最终确认按钮因完整合法草稿而可用，但从未点击。
- NORMAL当前结果只显示普通Purchase Receipt/Receipt Line、普通`RECEIPT` Ledger及available按现有权威公式立即重算；不出现`IQC_RECEIPT`、初始FROZEN、追加UNFREEZE或quality下一责任队列等假设结果。
- 依次验证右上关闭、ESC、背景点击和“返回修改”四种路径；每次Dialog消失、最终按钮不可达、loading/旧modal可见状态清除，重新打开均产生新的preview请求ID。
- 四种关闭路径后数量、凭证类型/编号/日期、Supplier批次空值、提前原因/确认、物理到货确认和说明均保持原值，业务写0。保留草稿符合D-107，不是状态泄漏。

## 10. 桌面与390×844

- 桌面工作区、未来日期错误及三种关闭路径通过，无页面级横向溢出。
- 390×844工作区和确认窗无横向溢出；“返回修改”可见、为默认焦点，并通过键盘Enter激活。
- 移动视口关闭后草稿保持，Dialog与最终按钮均消失，没有点击最终确认。

## 11. 请求计数

| 请求 | 最终计数 |
| --- | ---: |
| warehouse登录POST | 1 |
| warehouse退出POST | 1 |
| 未来日期preview GET 422 | 1 |
| 合法日期preview GET 200 | 4 |
| 确认窗口打开 | 4 |
| Business POST/PUT/PATCH/DELETE | 0 |
| Receipt POST | 0 |
| UAT收货过账 | 0 |

浏览器路由在登录前即安装：只允许同源GET/HEAD/OPTIONS和恰好一次login/logout POST；所有其他POST、PUT、PATCH、DELETE在发送前失败关闭。未记录Cookie、Authorization、密码、Session token或敏感正文。

## 12. Session与认证审计

- Canonical warehouse凭据文件在容器内以只读方式使用，元数据为root:root0600、单硬链接；验证器确认唯一匹配账号，未输出密码、摘要或正文。
- warehouse账号保持active、role=warehouse、must-change=false、version5；有效Session从0经唯一登录变为1，并由页面“安全退出”正常撤销，最终回到0；没有直接删除Session。
- 成功认证审计：LOGIN `9→10`，LOGOUT `8→9`，精确增量各1；未删除或修改审计。

## 13. 数据库及业务指纹前后对比

登录前和成功退出后都使用`REPEATABLE READ READ ONLY`事务，设置statement/lock timeout并以ROLLBACK结束。

| 项目 | 前 | 后 |
| --- | --- | --- |
| Migration | 40/head0040 | 不变 |
| Migration指纹 | `822e0e5bf92d4c267aa316668936a196ea23ec6c49a83ac82c777ce2c7fa2b19` | 不变 |
| 业务指纹 | `89915aaecad46c5a754ba3239c8bc9d8d4e4039dfad24827267614d32b06dd3b` | 不变 |
| PO/Line/Plan/queue | `1/4/4/4` | 不变 |
| PO | `1 / PO-00000001 / v1 / OPEN / SUP-000001 / 480.00 CNY` | 不变 |
| 数量 | 四行各10 PCS、已收0；四Plan PENDING/v1/2026-10-20、queue OPEN_PENDING/v1 | 不变 |
| Receipt及下游 | Receipt/Line/Evidence/Lot/IQC/Ledger/Purchase Source/AP/Payment/Work Order/Production全0 | 全0 |
| warehouse有效Session | 0 | 0 |

## 14. 回滚锚点与最终latest

- 最终`chenyida-erp-parallel-web:latest`精确指向通过候选`sha256:e7761e2c61bfe77c6aab526fb0b6cbd840ad1bf6300381f4319f6e279af94964`。
- 旧alpha.41精确回退tag `chenyida-erp-parallel-web:0.1.0-alpha.41-fix38-rollback`指向`sha256:0cf98937f3ae28fe68e84436ab85c12ef5e8922f50a04973641cb79b8a0d5f19`。
- 已拒镜像`sha256:81126136c63714be2a53812b3512549ed1fa4eb9deb7c8c6462b715eafe4278e`及tag `0.1.0-alpha.42-fix38-780075e`原样保留，仍为`REJECTED — DO NOT DEPLOY`。
- 全部门禁通过，未执行回滚；候选、旧回退和被拒镜像均未删除或push。

## 15. Git与项目文档

- 成功后只更新`SELFHOST-UAT-FIX-38.md`、本完成报告、`MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md`、`RELEASES.md`及`PROJECT_CONTEXT.md`中当前自托管版本/镜像字段。
- 收口提交消息为`ops: deploy warehouse receipt date guard`，实际SHA以`git log`为准；提交只含上述Markdown，不含日志、截图、凭据、数据库、备份、runner、Profile或镜像导出。
- 起点behind0/ahead185；收口提交后预期behind0/ahead186。未push、未创建PR、未amend/rebase/reset/stash/restore。

## 16. 资源、RestartCount与OOM

| 时点 | available memory | Swap used | 根盘可用 | Load |
| --- | --- | --- | --- | --- |
| Web替换前 | 约1.9 GiB | 约312 MiB / 1 GiB | 17 GiB | `0.06/0.20/0.25` |
| 浏览器及清理后 | 约2.0 GiB | 约320 MiB / 1 GiB | 17 GiB | `0.05/0.16/0.16` |

Web、Worker、PostgreSQL、Caddy最终RestartCount均为0、OOMKilled均为false；Web/PostgreSQL healthy，Worker/Caddy running。任务窗口Docker OOM/restart event均为0，内核OOM计数0；未触发内存、Swap、磁盘或Load停止阈值。

## 17. 临时资源清理

- 唯一实际浏览器容器使用固定Playwright 1.51.1镜像、一个临时Profile和任务内只读模块；两个离线模块准备预检在创建Chromium、读取凭据或建立Session前失败关闭，随后以本机npm缓存中校验过的精确1.51.1 tarball只读提取完成模块准备。
- 唯一实际Chromium正常关闭后，容器自动删除；浏览器、Chrome残留进程为0。runner、Profile、模块共518个文件/13 MiB的精确任务目录已删除且不可恢复，`/run`匹配残留0。
- 未创建测试数据库、角色、网络或Volume；任务名临时容器0。四个受保护Volume完整存在，未执行Docker system/volume prune，也未删除备份、候选或回退镜像。

## 18. 备份、远端与生产阻塞风险

- 本任务未新增备份；最新正式备份仍是FIX37的`warehouse-receipt-readiness-fix37-predeploy-20260808T120636Z.dump`，root:root0600、2,298,941 bytes、SHA-256 `28e07b9dc04e686d5077fe9f68968ffb1a4253979d64b80317307f8543bc0868`。
- 异机备份仍未完成；Git领先提交和alpha.42镜像只在本机，Git未push，镜像没有远端registry digest。服务器、仓库和镜像仍有单机恢复风险。
- 未迁移真实公司数据、未做生产恢复/切流验收、未建立生产发布批准；当前只能标记`NON-PRODUCTION UAT ONLY / NOT PRODUCTION READY`。
- 任何真实Receipt必须基于当时真实实物和凭证另获明确授权；quality IQC、Ledger后续、AP、Payment、Work Order和生产操作继续分别受控。

## 19. 明确声明

- UAT收货过账为0。
- 未运行Migration。
- 未重建PostgreSQL、Worker或Caddy。
- 未执行生产部署。
- 未push Git或镜像。
