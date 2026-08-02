# SELFHOST-OPS-UAT-PLANNING-HANDOFF-CONFIRMATIONS-FIX-14

## 状态与边界

- 状态：`DONE`
- 开始/完成：2026-08-02（Asia/Shanghai）
- 严格起点：clean `main@9c2a7ea436e9b8b5e95ad8eb82e52a43090b109a`，`origin/main...HEAD` 为 behind 0/ahead 119；版本 `0.1.0-alpha.38`，Migration `0001`—`0037`。
- 0037 SHA-256：`139f2623a184ae3d6927c95b56569cc438deffc2a0b46c325c9f04d59471d99f`。
- 起点运行面：Web `sha256:694a3190f517c94e36be3993e4b06e96b9194ea4e22e9add7f7ea533f09cab25` 与 0037 完成报告一致；Web/PostgreSQL healthy，Worker/Caddy running，四服务 restart 0/OOM false。
- 唯一范围：补齐 Planning 最终 ACCEPT 与 Engineering RESUBMIT 确认界面，并增加前端单次提交保护。未接收主 UAT v2，未修改或重放 Package、Response、Event、物料需求或其他业务数据；未修改 API、服务端门禁、Schema、Migration、package 或版本。
- Git 禁止项、生产保护与资料边界均遵守：没有 reset/stash/restore/rebase/amend/push/PR，没有读取或修改 `shujvbiao/`，没有把凭据、连接信息、Token、Cookie、Session 或备份正文写入输出/Git。

## 主 UAT 保护基线与终态

| 对象 | 起点与终态 |
| --- | --- |
| Package 1/v1 | ID 1、`RETURNED`、SHA-256 `9d7a6a7ec9aefbaf21be5dcb5eb3a556a47c6ef00c96f111f3be0476ade3a241` |
| Package 2/v2 | ID 2、`SUBMITTED`、SHA-256 `d67acce3f1e1a049a4025b29adbc3ec1651f398cd43000a445368b04a28bd822` |
| Response | ID 1/v1，共 1 条 |
| Handoff Event | RETURN 1、RESUBMIT 1、ACCEPT 0；CREATED/SUBMITTED 各 1 |
| 后继 | v3 0 |
| 下游 | 项目物料需求计划 0、采购需求 0；本任务没有创建工单、库存或财务记录 |
| 保护指纹 | 部署前、备份恢复副本与主 UAT 取消验收后均为 `5ddca35cab36890c20b88ecadc758a32bd60b87e2a136c477d8fde6c7e4538c2` |

## 权威流程依据

- D-059 明确 ACCEPT 只形成不可变 Planning Handoff 接收事实，不自动启动下一业务阶段。
- D-060 与 `SELFHOST-PHASE4-TASK03` 明确计划部门以最新 ACCEPTED Package 为输入执行物料需求计算和缺料分析，再通过独立提交形成采购需求交接。
- 因此窗口使用准确文案：`下一业务阶段：计划部门基于已接收的Package v2进行物料需求计算和缺料分析，随后通过独立操作形成采购需求交接。`
- 同时明确“当前未指定具体处理人”“当前未配置处理时限”“接收本身不会自动执行下一阶段”。本任务没有形成新业务/架构决定，故不新增或改写 ADR。

## Planning ACCEPT 确认窗口

窗口内部完整显示：

- 当前目标：项目 `PRJ-00000001`、Package ID 2/v2、`SUBMITTED`、可展开完整 SHA-256、提交人及 RESUBMIT 时间。
- 前驱退回：Package ID 1/v1、`RETURNED`、RETURN Event 2、操作者、Asia/Shanghai 时间、请求号和完整退回原因。
- 工程回复：Response ID 1/v1、回复操作者、时间、请求号和完整正文。
- 固定快照：Product A0、BOM V1、Unit Resolution v1 / 件 · PCS、四项物料及各 10 PCS 毛需求，并明确窗口取自不可变 v2 谱系。
- 接收后果：新增一条不可变 ACCEPT；v2 转 ACCEPTED；v1 继续 RETURNED；当前版本不可再次退回/接收；不自动创建采购申请、工单、库存或财务记录。
- 下一阶段：上述权威中文说明、无具体处理人、无时限及不自动执行边界。

## Engineering RESUBMIT 确认窗口

窗口内部显示项目、源 Package v1、RETURN Event 与完整原因、Engineering Response、目标 Package v2、Product/BOM/Unit Resolution、四项物料与数量、提交后进入计划部待接收队列及不自动创建下游单据，并提供取消与确认。主 UAT v2 已存在，故该写路径只在隔离 PostgreSQL/Chromium 中验收，没有在主 UAT 重放 RESUBMIT。

## 交互、安全与可访问性

- 共用可访问确认模态框；有可访问标题、焦点约束和焦点恢复，默认焦点落在取消而非确认。
- 取消、ESC、关闭按钮和背景关闭等价；关闭前不发送业务请求。固定底部操作区不会遮挡可滚动正文。
- 使用同步 `ref` 锁覆盖同一事件循环双击，确认后按钮立即禁用；每个操作只发送一个请求，失败或结果不明确时不自动重试。
- 模态框保存打开时的稳定 Package DTO/ID/version，不使用后来切换的行；服务端继续以状态和 CAS 拒绝过期对象。
- 成功凭证显示 Package、状态、操作者、时间、请求号及下一队列；前端确认从不替代服务端权限、CSRF、Origin、CAS、幂等、状态、对象范围和事务门禁。
- 390×844 与桌面均无页面级横向溢出；完整原因/回复、摘要和请求号可换行，谱系可读，两个按钮完整可见。
- planning 只对获准的 SUBMITTED Package 有 ACCEPT 入口，engineering 只对获准的 DRAFT v2 有 RESUBMIT 入口；越权 API 为 403。没有新增 `system.audit.read` 或扩大角色权限。全局跨角色导航问题不在本任务范围，继续登记为 HIGH。

## 自动与隔离验收

| 验证组 | 结果 |
| --- | --- |
| Planning UI contract | 12/12 |
| Planning、Revision Response、Identity、CSRF、Origin 静态/安全回归 | 35/35 |
| Planning 隔离 PostgreSQL | 12/12 |
| 0037 Migration | 4/4 |
| Identity 隔离 PostgreSQL | 10/10 |
| 隔离 Chromium | 1/1 |
| 合计 | 74/74 |

- 另有 Planning typecheck、production build、lint 0 error/10 个既有 warning 通过。
- Python 基线 `server.py --self-test`、依赖齐备的一次性 venv `smoke_test.py`、本任务专属临时 SQLite `go_live_check.py --no-backup` 为 3/3；临时 venv/SQLite 已清理。宿主第一次 smoke 在断言前因缺 `openpyxl` 停止，没有业务副作用，随后按固定 requirements 重跑通过。
- 隔离 Chromium 串行完成 v1 RETURN、Engineering Response、生成 v2；RESUBMIT 和 ACCEPT 都先分别以取消、关闭和 ESC 验证业务请求/事件为 0，再对确认按钮双击并证明只有一个请求和一个事件。
- 权限与并发覆盖：engineering 调 ACCEPT、planning 调 RESUBMIT 均 403；过期 ACCEPT CAS 为 409；幂等重放、同 tick 双击和状态终态都不能产生第二事件。隔离最终 v1 仍 RETURNED，v2 仅在隔离库 ACCEPTED，RESUBMIT/ACCEPT 各 1，下游五类业务记录 0。

## 备份、恢复与部署

- 部署前 custom dump：`/var/backups/chenyida-erp/handoff-confirmation-fix-20260802T1510Z.dump`，root:root、0600、2,179,303 bytes，SHA-256 `518bf47f797ff2e4817458b5c7e5e4090b0f8aaf77519c80c5c1598e9690efee`。
- 标准输入方式 `pg_restore --list` 通过，共 3285 项；第二新空库恢复通过，恢复库为 37/head 0037、checksum 精确一致，主 UAT 对象和保护指纹一致，随后精确删除恢复库。
- 没有新增 0038、没有修改 0001—0037、版本保持 alpha.38，主 UAT 未执行 Migration。
- 只把 Web 从 `sha256:694a3190f517c94e36be3993e4b06e96b9194ea4e22e9add7f7ea533f09cab25` 更新为 `sha256:a6327f593a6d084c609127e1bdb09e60b2bd07ff6a2c85213b36f1315c622a78`；旧镜像保留精确 rollback tag。PostgreSQL、Worker、Caddy 容器未重建，四个受保护 Volume 保持。

## 主 UAT planning-only 验收

- 单个受限 Chromium 以 390×844 登录 planning，只打开 Package 2/v2 ACCEPT 确认窗口；网络门禁阻断除 login/logout 外所有页面 POST。
- 验证当前目标、前驱退回、工程回复、固定快照、完整摘要、五项后果、权威下一阶段、无 assignee/SLA、不自动执行、默认取消焦点、按钮可见和无横向溢出后点击取消。
- 页面记录 login/logout 各 1、业务 POST 0、ACCEPT 0；未登录 engineering。本次创建的 planning Session 经正常 LOGOUT 撤销，随后会话接口返回未认证。
- 只读数据库终态断言再次通过；另发现一条 22:03 创建、早于本次主 UAT 的既有 planning 有效 Session。本任务没有证据证明其归属，故未越权撤销，也不把它冒充为本次 Session；本次安全退出结论只对应本次浏览器会话。

## Git、资源与清理

- 功能提交：`f19a91b680a58150378626d4800e9fb0af12f484`（`fix: complete planning handoff confirmations`）。只读主 UAT runner、项目状态与完成报告由独立 `ops: accept handoff confirmation fix` 提交收口，实际 SHA 以 Git log 为准。
- 全部 build、测试、备份恢复和 Web 更新串行，`COMPOSE_PARALLEL_LIMIT=1`；一次仅有一个临时测试/构建容器。
- 起点约 2.2 GiB available、252 MiB Swap、根盘 22 GiB、低 Load；终点约 2.2 GiB available、258 MiB Swap、22 GiB、Load `0.20/0.23/0.28`。未触发 768 MiB/80% Swap/10 GiB/Load/OOM 门槛，四服务 restart 0/OOM false。
- 隔离测试库、第二恢复库、临时容器、候选 app 提取目录、一次性 Playwright/npm/Python venv/SQLite 均精确清理；正式备份、当前/候选/回退 Web 镜像和四个受保护 Volume 有意保留。未执行任何 prune。
- 未 push、未创建 PR、未改写历史。

## 结论

确认窗口阻断已解除，可在下一次明确授权任务重新开始 planning 最终接收；本任务停止，不接收主 UAT v2，不创建物料需求。

`HANDOFF DECISION CONFIRMATIONS FIXED — UAT V2 STILL SUBMITTED`
