# SELFHOST-OPS-UAT-MATERIAL-REVIEW-BLOCKERS-03-RETRY

## 目标

在不审核或改写 UAT 物料 533—536、不运行 0035、不部署完整 alpha.36 的前提下，完成三项 alpha.34/0034 兼容 Web 修复：

1. 物料审核详情展示完整且诚实的决策上下文；
2. operations Dashboard 的物料审核待办与原生 `PENDING_REVIEW` 队列保持同一口径；
3. 经营工作台和兼容工作台退出后，浏览器后退、前进、`pageshow` 或 bfcache 恢复均不得重新暴露受保护内容。

## 严格边界

- 起点为 `main` / `35aa8f616d9898622d8fb01d62e6d34458fd2a06`，权威 Parent `9d21d39ed3a1e1b7a62e26f1be9d9d448f5313a3` 不回退、不重写。
- 源码保持 `0.1.0-alpha.36` / migration head 0035；运行面保持 `0.1.0-alpha.34` / 0034，只移植本任务和既有 Origin/CSRF/logout、operations 审核修复到兼容 Web。
- 不新增 0036，不运行 0035，不重启 PostgreSQL、Worker 或 Caddy。
- 533—536 只允许最小只读验收；不得批准、退回、编辑正文或生成正式编码。
- operations 的物料审核权限增量只能是 `material.review.queue`、`material.review.approve`、`material.review.reject`；不得新增正文编辑、系统管理或其他业务域写权限。
- 不读取或修改 `shujvbiao/` 及工作簿；所有写测试使用隔离 PostgreSQL 和合成数据。

## 验收合同

### 审核决策信息

- 原样展示完整“待审名称”，不拆分 `·`，不猜测外部标识。
- 展示分类、单位、来源、创建人、提交人、提交时间、版本、状态、工程说明/备注和正式编码状态。
- 若当前提交没有说明，明确显示“未保存”，不得伪造内容；复用现有 `material_versions.change_reason`，无需 Schema。
- 显示审核范围、批准/退回后果及批准后由工程继续建立 BOM 的下一步。
- 不显示伪造的供应商、采购报价、价格或外部编号字段。

### Dashboard

- 当前 `PENDING_REVIEW=4` 时显示“物料审核待办 4”，链接 `/materials/review`。
- 待办、筛选和队列总数一致；非零时不同时显示“当前没有立即待办”。
- legacy 汇总继续明确标注全局 `DRAFT + PENDING_REVIEW` 口径。

### Logout 与浏览器恢复

- 两套工作台继续使用 POST logout、Origin/CSRF 双重校验、服务端 Session 撤销和对称 Cookie 清理。
- `pagehide` 先隐藏受保护视图；`pageshow.persisted` 和 `navigation.type=back_forward` 重新校验 Session。
- 受保护页面响应为 `private, no-store, max-age=0, must-revalidate`，但不禁用浏览器历史。
- 退出、立即后退/前进和刷新均保持未登录，受保护内容不可见。

## 完成标准

- 单元、UI、隔离 PostgreSQL、Identity、Material Review、Dashboard、TASK09 标准化、typecheck、Schema consistency、lint、build、credentials、Python 三项和 `git diff --check` 通过。
- 部署前 PostgreSQL custom dump、清单和新隔离库恢复一致。
- 仅 Web 更新为 alpha.34/0034 兼容镜像，其他三服务容器和四个受保护 Volume 保持。
- 真实 operations Chromium 只读验收完成，审核写请求为 0，有效任务 Session 清零。
- 最终再次证明 533—536 为 PENDING_REVIEW/V2/MANUAL/PCS/空编码，APPROVE/REJECT version、change log、audit 均为 0。
