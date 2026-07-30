# SELFHOST-OPS-UAT-MATERIAL-REVIEW-BLOCKERS-03-RETRY 完成报告

## 1. 结论

`MATERIAL REVIEW DECISION CONTEXT AND LOGOUT CACHE FIXED`

物料审核决策上下文、operations 精确待办和两套工作台的退出后浏览器恢复保护均已修复并部署到 alpha.34/0034 兼容 Web。533—536 全程未批准、未退回、未编辑、未生成正式编码；0035 未运行，完整 alpha.36 未部署。

## 2. Git 与范围

- 起点：`main` / `35aa8f616d9898622d8fb01d62e6d34458fd2a06`，Parent `9d21d39ed3a1e1b7a62e26f1be9d9d448f5313a3`，`origin/main...HEAD = behind 0 / ahead 96`，tracked/untracked clean。
- 功能提交：
  - `c14505d` `fix: clarify material review decision context`
  - `8d8a494` `fix: invalidate protected views after logout`
  - `a4de64f` `fix: enforce no-store on legacy shell`
- 验收文档提交：`ops: accept material review blocker fixes`；实际 SHA 以本报告所在 Git commit 为准。
- 未 amend、rebase、reset、restore、stash、push 或 PR；权威提交 `9d21d39`、`35aa8f6` 未回退、删除或重写。
- `shujvbiao/` 和工作簿正文未读取、未修改、未提交。早期临时完整 worktree 曾把跟踪工作簿路径物化到任务临时目录；发现路径后未打开内容并立即删除，后续所有 worktree 均在 checkout 前显式排除整个工作簿目录。最终 worktree 仅 `/opt/erp`。

## 3. 审核决策上下文

详情 API 使用现有 `material_versions` 当前版本 `SUBMIT` 事实返回 `current_submission`：`comment`、`submitted_by`、`submitted_at`、`version`。现有 0034 Schema 已保存该事实，因此未新增 Schema、0036 或启动时兼容建表。

审核卡展示：

- 待审名称（原始完整值，不拆分 `·`）
- 分类、单位、来源类型
- 创建人、提交人、提交时间
- 版本、状态
- 工程说明/备注
- 正式内部编码“尚未生成”
- 审核范围说明
- 批准后果、退回后果
- 批准后由工程继续使用正式内部物料建立 BOM

固定审核范围为：

> 本页审核物料主数据身份、名称、分类、单位和工程说明。供应商映射、采购报价及价格不属于本次物料审核范围，由对应业务模块独立治理。

533—536 当前四条 `SUBMIT.change_reason` 均为空，页面诚实显示“未保存（当前提交没有可展示的工程说明/备注）”。没有伪造 UAT 外部标识、供应商料号、供应商、采购报价或价格字段。

## 4. Dashboard 与权限

- Dashboard 新增权限绑定的 `material-review-pending` 指标，查询条件精确为 `material_status='PENDING_REVIEW'`。
- 浏览器与 API 均确认指标“物料审核待办 4”，链接 `/materials/review`；搜索 `042576` 后队列总数和可见行均为 4，ID 为 533—536。
- 风险项显示“4 项物料待审核”，不再同时显示“当前没有立即待办”。
- legacy 原统计继续明确写为“全局待处理（DRAFT + PENDING_REVIEW）”，未冒充原生审核队列。
- operations 权限相对 alpha.34 基线的唯一增量仍为 `material.review.queue`、`material.review.approve`、`material.review.reject`。没有增加 `material.draft.*`、用户/角色管理、系统审计、admin 等价、BOM 管理或采购/库存/生产/销售/品质/财务业务写权限。
- 服务端正文 PATCH 对 operations 仍为 403；无关角色 queue/review 仍为 403。全站菜单过宽和角色中文显示按要求留作后续，不在本任务修改。

## 5. 退出与缓存保护

- 经营、Material 和 legacy 壳在 `pagehide` 立即切换为 `checking` 并隐藏受保护 DOM。
- `pageshow.persisted=true` 或 Performance Navigation `back_forward` 都重新调用 `/api/session`；验证完成前不重新显示内容。
- legacy 的刷新链改为 fail closed：只有完整 `refreshAll()` 成功后才隐藏登录覆盖层，网络/权限/部分刷新失败都保持隐藏。
- POST `/api/logout`、Origin、CSRF、Session 撤销和两枚 Cookie 的 `Max-Age=0` 对称清理保持。
- `/`、`/materials/:path*` 和 `/erp/index.html` 均实测只有一个 `Cache-Control: private, no-store, max-age=0, must-revalidate`，并有 `Pragma: no-cache`。legacy 静态路径通过 `proxy.ts` 重写到动态只读 HTML route，消除了框架并列的 `public, max-age=3600`。
- 没有调用 `history.replaceState` 清空历史或禁用浏览器后退/前进。

真实 Chromium 结果：经营和 legacy 两条链的 logout、back、forward、refresh 均保持未登录，受保护 DOM 可见数为 0；旧 Session 均已撤销。由于页面为 `private/no-store` 且退出会改变 Cookie，Chrome 实际恢复没有复用 bfcache（`pageshow.persisted=false`），但实际 `navigation.type=back_forward` 两条链均命中；另外在同一真实 Chromium 中分别派发 `pageshow.persisted=true`，两条分支均重新请求 Session 且保持内容隐藏。浏览器历史没有禁用。

## 6. 测试

所有数据库写测试均使用隔离 PostgreSQL 和合成数据，串行执行，一次只有一个临时容器。

| 验证 | 结果 |
| --- | --- |
| operations Material Review PostgreSQL | 4/4；含队列 4、搜索、详情提交说明、正文 403、无关角色 403、Dashboard 4 |
| Identity PostgreSQL | 10/10 |
| Dashboard PostgreSQL | 2/2 |
| Material PostgreSQL | 7/7 |
| 最终 Material/Review/Dashboard/Identity/TASK09 unit/UI/handler | 116/116；API coverage 补充 2/2，总计 118 项通过 |
| TASK09 标准化 | unit/handler/UI 14 项通过，`typecheck:standardization` 通过 |
| TypeScript | `typecheck:review`、`typecheck:dashboard`、`typecheck:standardization` 通过 |
| Schema consistency | 218 表；`No schema changes, nothing to migrate` |
| Lint | 0 error |
| Build | alpha.34/0034 兼容 Web build 通过；alpha.36 源码 buildcheck `sha256:cd0de093...` 通过但未部署并已删除 |
| Credentials | 代码验收 `CREDENTIAL_CHECK_OK (1099 repository files scanned)`；文档收口后稀疏工作树最终复核 `1101 repository files scanned`，受保护目录和工作簿在 checkout 前排除 |
| Python 基线 | `server.py --self-test`、`smoke_test.py`、隔离 `go_live_check.py` 全部通过 |
| Git | `git diff --check` 通过；敏感值、数据库、备份、日志和浏览器资料未进入 Git |

两项测试装配错误均未降低断言：API coverage 首次缺少只读 `/docs` 挂载，补齐后 2/2；credentials 首次缺少 linked-worktree Git metadata 挂载，补齐后扫描通过。浏览器脚本首轮在登录按钮 selector、次轮在登录页一帧状态等待处提前退出；当次 Session 均正常 logout 或为 0，修正测试脚本后完整链从头通过，临时脚本未提交。

文档收口后另在排除 `shujvbiao/` 和所有 XLS/XLSX 的稀疏工作树串行运行 Identity、Material Review、Dashboard 与 TASK09 标准化 UI 合同，70/70 通过；临时工作树与容器均已删除。

## 7. 备份、恢复与兼容部署

- 备份：`/var/backups/chenyida-erp/SELFHOST-OPS-UAT-MATERIAL-REVIEW-BLOCKERS-03-RETRY/postgresql-20260730T112504Z.dump`
- 大小：2,019,961 bytes；mode 0600，owner root:root。
- SHA-256：`281e25978b9db99000488779b858431cb20a2535364f64a01dec13bf7037972b`
- 清单：3,065 restore entries、426 tables、213 table-data。
- 隔离恢复库完整恢复；migration 34/head 0034、Material 536、User 14、Audit 1,132 和受保护摘要与源一致。恢复库只添加一个合成 operations 账号做候选 API smoke，随后连同合成 Session/Audit 一并删除。

运行镜像只从 `cda8c7e` alpha.34/0034 基线移植既有 Origin/CSRF/logout、operations 审核和本任务 Web 差异；移植补丁 SHA-256 为 `96a1190ec8209d43f218c767c1bb57d8356a431253b70245e32e6a58fa47d14f`，共 31 个 Web/测试/配置文件。候选中没有 0035 或标准化工作台。

- 部署前 Web：`sha256:f31199de3b8aea025c317b7d67aa26b42a60e037eca7ea7a20f7533dd2e6af38`
- 部署后 Web：`sha256:881c033dc97e7bc121ab6b2f7faf6a010881ee74377da5e352ee603b4e00ea50`
- 回滚 tag：`chenyida-erp-parallel-web:rollback-review-blockers-03-20260730T114146Z`
- 仅 `docker compose ... --no-build --no-deps --force-recreate --wait web`；PostgreSQL、Worker、Caddy 容器 ID 不变。
- 部署后内网和可信 TLS health 200；PostgreSQL/Web healthy，Worker/Caddy running，四服务 restart 0/OOM false。
- PostgreSQL 继续为 34/head 0034；0035 未运行，alpha.36 未部署。

## 8. 真实 operations 只读 UAT

使用当前 `uat_20260729_operations` 凭据；凭据从 root-only 0600 文件读取并以数据库 PBKDF2 摘要只读验证，没有显示、修改或再次改密。

| 检查 | 结果 |
| --- | --- |
| Dashboard | 物料审核待办 4；点击进入 `/materials/review` |
| 搜索 | `042576` 返回 4 行，ID 533—536 |
| 详情 | 4/4 打开；名称原样、分类/PCS/人工、创建/提交事实、V2/待审核、工程说明未保存、正式编码尚未生成均可见 |
| 决策说明 | 审核范围、批准后果、退回后果、工程后续 BOM 说明 4/4 可见 |
| 正文权限 | `.mm-review-main` 编辑控件总数 0；审核动作按钮可见但点击次数 0 |
| 写请求 | approve/reject POST 总数 0 |
| 经营工作台退出 | logout 成功，立即 back/forward 不显示详情，刷新保持登录页 |
| legacy 退出 | logout 成功，立即 back/forward 只显示登录覆盖层，受保护 DOM 隐藏，刷新仍未登录 |
| Session | 任务结束时 operations 有效 Session 0 |

## 9. 533—536 未改变证据

部署前、部署后和浏览器后保护摘要均为 `51d81e45e03656033c4db7a16e0a8b96`。最终只读事实：

| ID | 状态 | 版本 | 来源 | 单位 | 正式编码 |
| ---: | --- | ---: | --- | --- | --- |
| 533 | PENDING_REVIEW | 2 | MANUAL | PCS | 空 |
| 534 | PENDING_REVIEW | 2 | MANUAL | PCS | 空 |
| 535 | PENDING_REVIEW | 2 | MANUAL | PCS | 空 |
| 536 | PENDING_REVIEW | 2 | MANUAL | PCS | 空 |

- `material_versions` APPROVE/REJECT：0；非空 SUBMIT comment：0/4。
- `material_change_logs` APPROVE/REJECT：0。
- `audit_log` material approve/reject：0。
- 没有正式内部编码、批准、退回或正文更新。

## 10. 资源与清理

- 起点约 2.4 GiB available、Swap 163 MiB/1 GiB、根盘可用 31 GiB、Load 低；四服务 restart 0/OOM false。
- 最终约 2.3 GiB available、Swap 187 MiB/1 GiB、根盘可用 30 GiB、Load `0.21/0.45/0.68`；内核 OOM 计数 0，四服务 restart 0/OOM false。
- PostgreSQL/Worker/Caddy 容器 ID 保持；四个受保护 Volume 均为 local、创建时间保持 `2026-07-25T21:05:58+08:00`。
- 隔离测试库、恢复库、候选测试容器、Chromium 容器/配置、临时脚本、buildcheck 镜像、候选临时 tag 和两个 build worktree 已删除；有效 operations 任务 Session 为 0，Git worktree 仅 `/opt/erp`。
- 保留 root-only PostgreSQL 备份、当前 Web 镜像和单一明确回滚 tag。没有执行 `docker system prune -a`、`docker volume prune`，没有删除任何受保护 Volume。

完成后停止；不开始物料审核。
